import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TOWN_LAYOUT,
  SEED_HOME_PADS,
  createAvatarCapsule,
  setAvatarStatusText,
  getPlotTargetPosition,
  pickBandstandSpot,
} from './avatar.mjs';

function createFakeTHREE() {
  class Object3D {
    constructor() {
      this.name = '';
      this.children = [];
      this.userData = {};
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set: (x, y, z) => {
          this.position.x = x;
          this.position.y = y;
          this.position.z = z;
        },
      };
      this.rotation = { x: 0, y: 0, z: 0 };
      this.scale = {
        x: 1,
        y: 1,
        z: 1,
        set: (x, y, z) => {
          this.scale.x = x;
          this.scale.y = y;
          this.scale.z = z;
        },
      };
    }
    add(child) {
      this.children.push(child);
    }
  }

  class Group extends Object3D {}
  class Mesh extends Object3D {
    constructor(geometry, material) {
      super();
      this.geometry = geometry;
      this.material = material;
    }
  }
  class Sprite extends Object3D {
    constructor(material) {
      super();
      this.material = material;
    }
  }
  class MeshStandardMaterial {
    constructor(opts = {}) {
      Object.assign(this, opts);
    }
  }
  class SpriteMaterial {
    constructor(opts = {}) {
      Object.assign(this, opts);
    }
  }
  class CylinderGeometry {
    constructor(...args) {
      this.kind = 'cylinder';
      this.args = args;
    }
  }
  class SphereGeometry {
    constructor(...args) {
      this.kind = 'sphere';
      this.args = args;
    }
  }
  class CanvasTexture {
    constructor(canvas) {
      this.canvas = canvas;
      this.needsUpdate = false;
    }
  }

  return {
    Group,
    Mesh,
    Sprite,
    MeshStandardMaterial,
    SpriteMaterial,
    CylinderGeometry,
    SphereGeometry,
    CanvasTexture,
  };
}

function withFakeDocument(fn) {
  const prevDoc = globalThis.document;
  const drawnTexts = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, '2d');
          return {
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            font: '',
            textAlign: '',
            textBaseline: '',
            fillRect() {},
            strokeRect() {},
            fillText(text, x, y) {
              drawnTexts.push({ text, x, y });
            },
          };
        },
      };
    },
  };
  try {
    return fn(drawnTexts);
  } finally {
    if (prevDoc === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = prevDoc;
    }
  }
}

test('createAvatarCapsule builds npc and muse capsules with role colors, nametag text, and nametagLift', () => {
  const THREE = createFakeTHREE();

  // Headless (no document) works cleanly via makeCanvas stub.
  const headless = createAvatarCapsule(THREE, { handle: 'sol', role: 'muse', nametagLift: 0 });
  assert.equal(headless.name, 'avatar_sol');
  assert.equal(headless.userData.role, 'muse');
  assert.equal(headless.userData.nametagSprite.position.y, 1.8);

  withFakeDocument((drawnTexts) => {
    const npc = createAvatarCapsule(THREE, { handle: 'wick', role: 'npc', nametagLift: 0.5 });
    assert.equal(npc.name, 'avatar_wick');
    assert.equal(npc.userData.role, 'npc');
    assert.equal(npc.children[0].material.color, '#d49a45');
    assert.equal(npc.children[1].material.color, '#f2dcc4');
    assert.equal(npc.userData.nametagSprite.position.y, 2.3);

    const muse = createAvatarCapsule(THREE, { handle: 'lampmoth', role: 'muse', nametagLift: 0 });
    assert.equal(muse.name, 'avatar_lampmoth');
    assert.equal(muse.userData.role, 'muse');
    assert.equal(muse.children[0].material.color, '#6cb4d8');
    assert.equal(muse.children[1].material.color, '#f2dcc4');
    assert.equal(muse.userData.nametagSprite.position.y, 1.8);

    assert.deepEqual(
      drawnTexts.map((d) => d.text),
      ['[NPC] wick', '[MUSE] lampmoth']
    );
  });
});

test('pickBandstandSpot handles preferred slot, first-free fallback, and overflow ring', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({
    slot: i,
    x: i,
    y: 0.6,
    z: i,
    rotY: 0,
  }));
  const used = new Set();

  // Preferred slot free
  const s1 = pickBandstandSpot(spots, used, 3);
  assert.equal(s1.slot, 3);
  assert.equal(s1.y, 0.6);
  assert.equal(s1.nametagLift, 0.5);

  // Preferred slot already used -> falls back to first free (0)
  const s2 = pickBandstandSpot(spots, used, 3);
  assert.equal(s2.slot, 0);
  assert.equal(s2.nametagLift, 0);

  // Fill remaining 8 spots
  for (let i = 0; i < 8; i++) {
    pickBandstandSpot(spots, used, null);
  }
  assert.equal(used.size, 10);

  // 11th avatar -> overflow ring at bandstand.radius + 1.2 + 0.9 = 6.6 m
  // (overflowIdx 10 lands on the second ring row)
  const overflow = pickBandstandSpot(spots, used, null);
  assert.equal(overflow.slot, 10);
  assert.equal(overflow.y, 0);
  const r = Math.hypot(overflow.x, overflow.z);
  assert.ok(Math.abs(r - 6.6) < 0.01, `expected overflow ring radius ~6.6, got ${r}`);
});

test('getPlotTargetPosition places 3.6 m in front of plot and staggers laterally', () => {
  const plot1 = TOWN_LAYOUT.plots[0];
  const p0 = getPlotTargetPosition(plot1, 0);
  const dist0 = Math.hypot(p0.x - plot1.x, p0.z - plot1.z);
  assert.ok(Math.abs(dist0 - 3.6) < 0.01, `expected 3.6 m in front of plot, got ${dist0}`);
  assert.equal(p0.rotY, plot1.rotY);

  const p1 = getPlotTargetPosition(plot1, 1);
  const p2 = getPlotTargetPosition(plot1, 2);
  const lateral1 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const lateral2 = Math.hypot(p2.x - p0.x, p2.z - p0.z);
  assert.ok(Math.abs(lateral1 - 0.9) < 0.01, `expected 0.9 m lateral stagger, got ${lateral1}`);
  assert.ok(Math.abs(lateral2 - 0.9) < 0.01, `expected 0.9 m lateral stagger, got ${lateral2}`);
  // Opposite sides of p0
  const dot = (p1.x - p0.x) * (p2.x - p0.x) + (p1.z - p0.z) * (p2.z - p0.z);
  assert.ok(dot < 0, 'visitor 1 and 2 must stagger to opposite sides');
});

test('TOWN_LAYOUT plot ring matches formula with plot 1 at ~(17.92, 4.60) and SEED_HOME_PADS', () => {
  assert.equal(TOWN_LAYOUT.plots.length, 8);
  const p1 = TOWN_LAYOUT.plots[0];
  assert.equal(p1.plotNumber, 1);
  assert.ok(Math.abs(p1.x - 17.92) < 0.005, `plot 1 x=${p1.x} should be ~17.92`);
  assert.ok(Math.abs(p1.z - 4.60) < 0.005, `plot 1 z=${p1.z} should be ~4.60`);

  for (const pl of TOWN_LAYOUT.plots) {
    const r = Math.hypot(pl.x, pl.z);
    assert.ok(Math.abs(r - 18.5) < 0.01, `plot ${pl.plotNumber} radius ${r} should be 18.5`);
  }

  assert.deepEqual(SEED_HOME_PADS, { wick: 2, maren: 3, tomas: 4 });
});

test('setAvatarStatusText renders 2-line status, truncates at 24 chars, is idempotent, and restores badge-only', () => {
  const THREE = createFakeTHREE();

  withFakeDocument((drawnTexts) => {
    const avatar = createAvatarCapsule(THREE, { handle: 'maren', role: 'npc' });
    const sprite = avatar.userData.nametagSprite;
    const initialMap = sprite.material.map;
    assert.equal(initialMap.canvas.width, 384);
    assert.equal(initialMap.canvas.height, 96);
    assert.equal(sprite.scale.x, 1.5);
    assert.equal(sprite.scale.y, 0.375);

    // Null / empty / whitespace-only keeps badge-only without re-creating texture.
    setAvatarStatusText(THREE, avatar, null);
    assert.equal(avatar.userData.statusText, null);
    assert.equal(sprite.material.map, initialMap);

    setAvatarStatusText(THREE, avatar, '   ');
    assert.equal(avatar.userData.statusText, null);
    assert.equal(sprite.material.map, initialMap);

    // Setting a status swaps to 384x144, scale y = 0.5625, and disposes old map.
    let disposedCount = 0;
    initialMap.dispose = () => { disposedCount += 1; };
    drawnTexts.length = 0;
    setAvatarStatusText(THREE, avatar, '  Quiet tea  ');
    assert.equal(disposedCount, 1);
    assert.equal(avatar.userData.statusText, 'Quiet tea');
    const statusMap = sprite.material.map;
    assert.notEqual(statusMap, initialMap);
    assert.equal(statusMap.canvas.width, 384);
    assert.equal(statusMap.canvas.height, 144);
    assert.equal(sprite.scale.x, 1.5);
    assert.equal(sprite.scale.y, 0.5625);
    assert.deepEqual(drawnTexts.map((d) => d.text), ['[NPC] maren', 'Quiet tea']);

    // Idempotent: calling again with same trimmed status reuses the same texture object.
    drawnTexts.length = 0;
    setAvatarStatusText(THREE, avatar, 'Quiet tea');
    assert.equal(sprite.material.map, statusMap);
    assert.equal(drawnTexts.length, 0);

    // Truncates > 24 chars with trailing ellipsis inside 24 chars.
    drawnTexts.length = 0;
    setAvatarStatusText(THREE, avatar, 'Listening by the gatehouse tonight');
    assert.equal(avatar.userData.statusText.length, 24);
    assert.ok(avatar.userData.statusText.endsWith('…'));
    assert.equal(avatar.userData.statusText, 'Listening by the gateho…');
    assert.deepEqual(drawnTexts.map((d) => d.text), ['[NPC] maren', 'Listening by the gateho…']);

    // Clearing status restores badge-only (384x96, scale 1.5 x 0.375, statusText null).
    drawnTexts.length = 0;
    setAvatarStatusText(THREE, avatar, '');
    assert.equal(avatar.userData.statusText, null);
    assert.equal(sprite.material.map.canvas.width, 384);
    assert.equal(sprite.material.map.canvas.height, 96);
    assert.equal(sprite.scale.x, 1.5);
    assert.equal(sprite.scale.y, 0.375);
    assert.deepEqual(drawnTexts.map((d) => d.text), ['[NPC] maren']);
  });
});

test('createAvatarCapsule defaults, unknown role fallback, geometry, and negative nametagLift', () => {
  const THREE = createFakeTHREE();

  withFakeDocument((drawnTexts) => {
    const def = createAvatarCapsule(THREE);
    assert.equal(def.name, 'avatar_muse');
    assert.equal(def.userData.handle, 'muse');
    assert.equal(def.userData.role, 'muse');
    assert.equal(def.userData.nametagLift, 0);
    assert.equal(def.children[0].material.color, '#6cb4d8');

    const body = def.children[0];
    assert.equal(body.geometry.kind, 'cylinder');
    assert.deepEqual(body.geometry.args, [0.28, 0.32, 1.0, 8]);
    assert.equal(body.position.y, 0.5);

    const head = def.children[1];
    assert.equal(head.geometry.kind, 'sphere');
    assert.deepEqual(head.geometry.args, [0.24, 8, 6]);
    assert.equal(head.position.y, 1.2);

    const sprite = def.children[2];
    assert.equal(def.userData.nametagSprite, sprite);
    assert.equal(sprite.name, 'nametag_sprite');
    assert.equal(sprite.scale.x, 1.5);
    assert.equal(sprite.scale.y, 0.375);
    assert.equal(sprite.scale.z, 1);

    const unknown = createAvatarCapsule(THREE, { handle: 'guest', role: 'admin', nametagLift: -0.25 });
    assert.equal(unknown.userData.role, 'muse');
    assert.equal(unknown.children[0].material.color, '#6cb4d8');
    assert.equal(unknown.userData.nametagLift, -0.25);
    assert.equal(unknown.userData.nametagSprite.position.y, 1.55);

    assert.deepEqual(
      drawnTexts.map((d) => d.text),
      ['[MUSE] muse', '[MUSE] guest']
    );
  });
});

test('pickBandstandSpot rejects invalid preferredSlot values and places overflowIdx 20 on third ring', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({
    slot: i,
    x: i,
    y: 0.6,
    z: i,
    rotY: 0,
  }));
  const used = new Set();

  assert.equal(pickBandstandSpot(spots, used, -1).slot, 0);
  assert.equal(pickBandstandSpot(spots, used, 10).slot, 1);
  assert.equal(pickBandstandSpot(spots, used, 3.5).slot, 2);
  assert.equal(pickBandstandSpot(spots, used, '3').slot, 3);

  for (let i = 4; i < 20; i++) {
    pickBandstandSpot(spots, used, null);
  }
  assert.equal(used.size, 20);

  const ring3 = pickBandstandSpot(spots, used, null);
  assert.equal(ring3.slot, 20);
  assert.equal(ring3.nametagLift, 0);
  const r = Math.hypot(ring3.x, ring3.z);
  assert.ok(Math.abs(r - 7.5) < 0.01, `expected third overflow ring radius ~7.5, got ${r}`);
  assert.equal(ring3.rotY, +Math.atan2(-ring3.x, -ring3.z).toFixed(4));
});

test('getPlotTargetPosition handles wider stagger indices 3 and 4 and plot 8', () => {
  const plot1 = TOWN_LAYOUT.plots[0];
  const p0 = getPlotTargetPosition(plot1, 0);
  const sideX = Math.cos(plot1.rotY);
  const sideZ = -Math.sin(plot1.rotY);

  const p3 = getPlotTargetPosition(plot1, 3);
  const p4 = getPlotTargetPosition(plot1, 4);
  for (const p of [p0, p3, p4]) {
    assert.equal(p.y, 0);
    assert.equal(p.rotY, plot1.rotY);
  }

  // Source formula: odd index -> +1, even index >= 2 -> -1, times ceil(index / 2) * 0.9
  const proj3 = (p3.x - p0.x) * sideX + (p3.z - p0.z) * sideZ;
  const proj4 = (p4.x - p0.x) * sideX + (p4.z - p0.z) * sideZ;
  assert.ok(Math.abs(proj3 - 1.8) < 0.01, `expected index 3 lateral +1.8, got ${proj3}`);
  assert.ok(Math.abs(proj4 + 1.8) < 0.01, `expected index 4 lateral -1.8, got ${proj4}`);

  const plot8 = TOWN_LAYOUT.plots[7];
  const endAngle = 1.58 * Math.PI;
  assert.equal(plot8.x, +(Math.sin(endAngle) * 18.5).toFixed(3));
  assert.equal(plot8.z, +(Math.cos(endAngle) * 18.5).toFixed(3));
  const target8 = getPlotTargetPosition(plot8, 0);
  const dist8 = Math.hypot(target8.x - plot8.x, target8.z - plot8.z);
  assert.ok(Math.abs(dist8 - 3.6) < 0.01, `expected 3.6 m in front of plot 8, got ${dist8}`);
  assert.equal(target8.y, 0);
  assert.equal(target8.rotY, plot8.rotY);
});

test('TOWN_LAYOUT fixed landmarks and per-plot rotY match expected coordinates', () => {
  assert.equal(TOWN_LAYOUT.clearingRadius, 30);
  assert.deepEqual(TOWN_LAYOUT.bandstand, { x: 0, y: 0, z: 0, radius: 4.5, height: 0.6 });
  assert.deepEqual(TOWN_LAYOUT.gate, { x: 0, y: 0, z: 27 });
  assert.deepEqual(TOWN_LAYOUT.newsstand, { x: 6, y: 0, z: 14 });
  assert.deepEqual(TOWN_LAYOUT.noticeBoard, { x: -6, y: 0, z: 14 });
  assert.deepEqual(TOWN_LAYOUT.inn, { x: -11, y: 0, z: 20 });
  assert.equal(TOWN_LAYOUT.plotRadius, 18.5);

  for (const pl of TOWN_LAYOUT.plots) {
    assert.equal(pl.rotY, +Math.atan2(-pl.x, -pl.z).toFixed(4));
  }
});

test('setAvatarStatusText handles missing sprite/material, muse badge, 24/25-char boundary, and dispose counts', () => {
  const THREE = createFakeTHREE();

  const noSprite = { userData: { handle: 'x' } };
  setAvatarStatusText(THREE, noSprite, 'hi');
  assert.deepEqual(noSprite.userData, { handle: 'x' });

  const noMat = { userData: { handle: 'y', nametagSprite: {} } };
  setAvatarStatusText(THREE, noMat, 'hi');
  assert.equal('statusText' in noMat.userData, false);

  withFakeDocument((drawnTexts) => {
    const muse = createAvatarCapsule(THREE, { handle: 'sol', role: 'muse' });
    drawnTexts.length = 0;
    setAvatarStatusText(THREE, muse, 'Sketching by the gate');
    assert.deepEqual(drawnTexts.map((d) => d.text), ['[MUSE] sol', 'Sketching by the gate']);

    const exact24 = '123456789012345678901234';
    assert.equal(exact24.length, 24);
    setAvatarStatusText(THREE, muse, exact24);
    assert.equal(muse.userData.statusText, exact24);
    assert.equal(muse.userData.statusText.includes('…'), false);

    const over25 = '1234567890123456789012345';
    assert.equal(over25.length, 25);
    setAvatarStatusText(THREE, muse, over25);
    assert.equal(muse.userData.statusText, '12345678901234567890123…');
    assert.equal(muse.userData.statusText.length, 24);

    let disposed = 0;
    muse.userData.nametagSprite.material.map.dispose = () => { disposed += 1; };
    setAvatarStatusText(THREE, muse, over25);
    assert.equal(disposed, 0);

    setAvatarStatusText(THREE, muse, 'Resting');
    assert.equal(disposed, 1);
  });
});

test('avatar.mjs copied declarations stay verbatim with town-3d/town.js', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const avatarSrc = fs.readFileSync(path.join(dir, 'avatar.mjs'), 'utf8');
  const townSrc = fs.readFileSync(path.join(dir, '..', 'town-3d', 'town.js'), 'utf8');

  function extractDeclaration(src, name) {
    const re = new RegExp(`(?:export\\s+)?(?:const|function)\\s+${name}\\b`);
    const match = re.exec(src);
    assert.ok(match, `missing declaration for ${name}`);
    const start = match.index;
    const braceIdx = src.indexOf('{', start);
    assert.ok(braceIdx !== -1, `missing opening brace for ${name}`);
    let depth = 0;
    let end = braceIdx;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth += 1;
      else if (src[end] === '}') {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    if (src[end] === ';') end += 1;
    return src.slice(start, end).replace(/^export\s+/, '').replace(/\s+/g, ' ').trim();
  }

  const symbols = [
    'TOWN_LAYOUT',
    'makeCanvas',
    'makeTextTexture',
    'createAvatarCapsule',
    'SEED_HOME_PADS',
    'getPlotTargetPosition',
    'pickBandstandSpot',
  ];
  for (const sym of symbols) {
    assert.equal(
      extractDeclaration(avatarSrc, sym),
      extractDeclaration(townSrc, sym),
      `${sym} drifted between staging-polyfork/avatar.mjs and town-3d/town.js`
    );
  }
});

function withRecordingDocument(fn) {
  const prevDoc = globalThis.document;
  const calls = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, '2d');
          const ctx = {
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            font: '',
            textAlign: '',
            textBaseline: '',
            fillRect(x, y, w, h) {
              calls.push(['fillRect', ctx.fillStyle, x, y, w, h]);
            },
            strokeRect(x, y, w, h) {
              calls.push(['strokeRect', ctx.strokeStyle, ctx.lineWidth, x, y, w, h]);
            },
            fillText(text, x, y) {
              calls.push(['fillText', ctx.font, ctx.fillStyle, text, x, y]);
            },
          };
          return ctx;
        },
      };
    },
  };
  try {
    return fn(calls);
  } finally {
    if (prevDoc === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = prevDoc;
    }
  }
}

test('TOWN_LAYOUT all eight plot coordinates match the angle formula', () => {
  const startAngle = 0.42 * Math.PI;
  const endAngle = 1.58 * Math.PI;
  for (let i = 0; i < 8; i++) {
    const angle = startAngle + (i / 7) * (endAngle - startAngle);
    const plot = TOWN_LAYOUT.plots[i];
    assert.equal(plot.x, +(Math.sin(angle) * 18.5).toFixed(3));
    assert.equal(plot.z, +(Math.cos(angle) * 18.5).toFixed(3));
    assert.equal(plot.y, 0);
    assert.equal(plot.plotNumber, i + 1);
  }
});

test('createAvatarCapsule structure, roughness, and texture flags', () => {
  const THREE = createFakeTHREE();
  const capsule = createAvatarCapsule(THREE, { handle: 'sol' });
  assert.equal(capsule.children.length, 3);
  assert.equal(capsule.children[0].material.roughness, 0.7);
  assert.equal(capsule.children[1].material.roughness, 0.75);
  const spriteMat = capsule.children[2].material;
  assert.equal(spriteMat.transparent, true);
  assert.equal(spriteMat.map.needsUpdate, true);
  assert.equal(spriteMat.map.canvas.width, 384);
  assert.equal(spriteMat.map.canvas.height, 96);
});

test('createAvatarCapsule badge texture draws bg, border, and centered badge text', () => {
  const THREE = createFakeTHREE();
  withRecordingDocument((calls) => {
    createAvatarCapsule(THREE, { handle: 'wick', role: 'npc' });
    assert.deepEqual(calls, [
      ['fillRect', '#161b28', 0, 0, 384, 96],
      ['strokeRect', '#ffbe55', 8, 8, 8, 368, 80],
      ['fillText', 'bold 30px monospace', '#ffbe55', '[NPC] wick', 192, 48],
    ]);

    calls.length = 0;
    createAvatarCapsule(THREE, { handle: 'sol' });
    const textCall = calls.find((c) => c[0] === 'fillText');
    assert.ok(textCall);
    assert.equal(textCall[2], '#9be0ff');
    assert.equal(textCall[3], '[MUSE] sol');
  });
});

test('pickBandstandSpot overflow exact coordinates and empty-spots fallback', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({
    slot: i,
    x: i,
    y: 0.6,
    z: i,
    rotY: 0,
  }));
  const used = new Set();
  for (let i = 0; i < 10; i++) {
    pickBandstandSpot(spots, used, null);
  }

  const slot10 = pickBandstandSpot(spots, used, null);
  assert.equal(slot10.slot, 10);
  assert.equal(slot10.x, +(Math.sin(0.15) * 6.6).toFixed(4));
  assert.equal(slot10.z, +(Math.cos(0.15) * 6.6).toFixed(4));
  assert.equal(slot10.y, 0);
  assert.equal(slot10.nametagLift, 0);

  const slot11 = pickBandstandSpot(spots, used, null);
  assert.equal(slot11.slot, 11);
  assert.equal(slot11.x, +(Math.sin((1 / 10) * Math.PI * 2 + 0.15) * 6.6).toFixed(4));
  assert.equal(slot11.nametagLift, 0.5);
  assert.equal(slot11.rotY, +Math.atan2(-slot11.x, -slot11.z).toFixed(4));

  const emptyFallback = pickBandstandSpot([], new Set(), null);
  assert.equal(emptyFallback.slot, 0);
  assert.equal(emptyFallback.y, 0);
  assert.equal(emptyFallback.x, +(Math.sin(0.15) * 5.7).toFixed(4));
  assert.equal(emptyFallback.z, +(Math.cos(0.15) * 5.7).toFixed(4));
});

test('getPlotTargetPosition edges: undefined index, indices 5 and 6, negative index', () => {
  const plot1 = TOWN_LAYOUT.plots[0];
  const p0 = getPlotTargetPosition(plot1, 0);
  assert.deepEqual(getPlotTargetPosition(plot1), p0);

  const sideX = Math.cos(plot1.rotY);
  const sideZ = -Math.sin(plot1.rotY);
  const p5 = getPlotTargetPosition(plot1, 5);
  const p6 = getPlotTargetPosition(plot1, 6);
  for (const p of [p5, p6]) {
    assert.equal(p.y, 0);
    assert.equal(p.rotY, plot1.rotY);
  }
  const proj5 = (p5.x - p0.x) * sideX + (p5.z - p0.z) * sideZ;
  const proj6 = (p6.x - p0.x) * sideX + (p6.z - p0.z) * sideZ;
  assert.ok(Math.abs(proj5 - 2.7) < 0.01, `expected index 5 lateral +2.7, got ${proj5}`);
  assert.ok(Math.abs(proj6 + 2.7) < 0.01, `expected index 6 lateral -2.7, got ${proj6}`);

  assert.deepEqual(getPlotTargetPosition(plot1, -1), p0);
});

test('setAvatarStatusText edges: non-string status, undefined map, role-undefined badge, 23-char status', () => {
  const THREE = createFakeTHREE();
  withFakeDocument((drawnTexts) => {
    const npc1 = createAvatarCapsule(THREE, { handle: 'maren', role: 'npc' });
    const initialMap = npc1.userData.nametagSprite.material.map;

    for (const bad of [42, {}, true]) {
      setAvatarStatusText(THREE, npc1, bad);
      assert.equal(npc1.userData.statusText, null);
      assert.equal(npc1.userData.nametagSprite.material.map, initialMap);
    }

    setAvatarStatusText(THREE, npc1, '  On watch  ');
    assert.equal(npc1.userData.statusText, 'On watch');
    setAvatarStatusText(THREE, npc1, 42);
    assert.equal(npc1.userData.statusText, null);
    assert.equal(npc1.userData.nametagSprite.material.map.canvas.height, 96);

    const npc2 = createAvatarCapsule(THREE, { handle: 'maren', role: 'npc' });
    npc2.userData.nametagSprite.material.map = undefined;
    setAvatarStatusText(THREE, npc2, 'Tea is on');
    assert.ok(npc2.userData.nametagSprite.material.map);
    assert.equal(npc2.userData.statusText, 'Tea is on');

    const noRole = createAvatarCapsule(THREE, { handle: 'anon' });
    drawnTexts.length = 0;
    setAvatarStatusText(THREE, noRole, 'Hello');
    assert.deepEqual(drawnTexts.map((d) => d.text), ['[MUSE] anon', 'Hello']);

    const len23 = '12345678901234567890123';
    assert.equal(len23.length, 23);
    setAvatarStatusText(THREE, noRole, len23);
    assert.equal(noRole.userData.statusText, len23);
    assert.equal(noRole.userData.statusText.includes('…'), false);
  });
});

test('setAvatarStatusText status texture draws two-line badge with 30/22px fonts, and flips needsUpdate', () => {
  const THREE = createFakeTHREE();
  withRecordingDocument((calls) => {
    const npc = createAvatarCapsule(THREE, { handle: 'maren', role: 'npc' });
    calls.length = 0;
    setAvatarStatusText(THREE, npc, 'Quiet tea');
    assert.deepEqual(calls, [
      ['fillRect', '#161b28', 0, 0, 384, 144],
      ['strokeRect', '#ffbe55', 8, 8, 8, 368, 128],
      ['fillText', 'bold 30px monospace', '#ffbe55', '[NPC] maren', 192, 48],
      ['fillText', 'bold 22px monospace', '#ffbe55', 'Quiet tea', 192, 96],
    ]);
    const sprite = npc.userData.nametagSprite;
    assert.equal(sprite.material.needsUpdate, true);
    assert.deepEqual({ x: sprite.scale.x, y: sprite.scale.y, z: sprite.scale.z }, { x: 1.5, y: 0.5625, z: 1 });
  });
});

test('createAvatarCapsule role is case-sensitive: "NPC", empty, and null all fall back to muse', () => {
  const THREE = createFakeTHREE();
  withFakeDocument((drawnTexts) => {
    const upper = createAvatarCapsule(THREE, { handle: 'x', role: 'NPC' });
    const empty = createAvatarCapsule(THREE, { handle: 'y', role: '' });
    const nil = createAvatarCapsule(THREE, { handle: 'z', role: null });

    for (const av of [upper, empty, nil]) {
      assert.equal(av.userData.role, 'muse');
      assert.equal(av.children[0].material.color, '#6cb4d8');
    }

    assert.deepEqual(
      drawnTexts.map((d) => d.text),
      ['[MUSE] x', '[MUSE] y', '[MUSE] z']
    );
  });
});

test('getPlotTargetPosition target sits 3.6 m toward the clearing centre: exact plot 1 and plot 5 targets', () => {
  const plot1 = TOWN_LAYOUT.plots[0];
  const t1 = getPlotTargetPosition(plot1, 0);
  assert.deepEqual(t1, { x: 14.4321, y: 0, z: 3.7058, rotY: -1.8221 });
  const r1 = Math.hypot(t1.x, t1.z);
  assert.ok(Math.abs(r1 - 14.9) < 0.01, `expected plot 1 target radius ~14.9, got ${r1}`);
  const dot1 = (t1.x - plot1.x) * (0 - plot1.x) + (t1.z - plot1.z) * (0 - plot1.z);
  assert.ok(dot1 > 0, `expected forward step toward origin, got dot=${dot1}`);

  const plot5 = TOWN_LAYOUT.plots[4];
  const t5 = getPlotTargetPosition(plot5, 0);
  assert.deepEqual(t5, { x: -3.8345, y: 0, z: -14.3983, rotY: 0.2603 });
  const r5 = Math.hypot(t5.x, t5.z);
  assert.ok(Math.abs(r5 - 14.9) < 0.01, `expected plot 5 target radius ~14.9, got ${r5}`);
});

test('getPlotTargetPosition indices 7 and 8 continue the ±0.9 stagger ladder', () => {
  const plot1 = TOWN_LAYOUT.plots[0];
  const p0 = getPlotTargetPosition(plot1, 0);
  const sideX = Math.cos(plot1.rotY);
  const sideZ = -Math.sin(plot1.rotY);

  const p7 = getPlotTargetPosition(plot1, 7);
  const p8 = getPlotTargetPosition(plot1, 8);
  for (const p of [p7, p8]) {
    assert.equal(p.y, 0);
    assert.equal(p.rotY, plot1.rotY);
  }

  const proj7 = (p7.x - p0.x) * sideX + (p7.z - p0.z) * sideZ;
  const proj8 = (p8.x - p0.x) * sideX + (p8.z - p0.z) * sideZ;
  assert.ok(Math.abs(proj7 - 3.6) < 0.01, `expected index 7 lateral +3.6, got ${proj7}`);
  assert.ok(Math.abs(proj8 + 3.6) < 0.01, `expected index 8 lateral -3.6, got ${proj8}`);
});

test('pickBandstandSpot overflow slot 30 lands on the fourth ring at 8.4 m and never mutates avatarSpots', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({
    slot: i,
    x: i,
    y: 0.6,
    z: i,
    rotY: 0,
  }));
  const snapshot = spots.map((s) => ({ ...s }));
  const used = new Set();

  for (let i = 0; i < 30; i++) {
    pickBandstandSpot(spots, used, null);
  }
  assert.equal(used.size, 30);
  assert.deepEqual(spots, snapshot);

  const slot30 = pickBandstandSpot(spots, used, null);
  assert.equal(slot30.slot, 30);
  assert.equal(slot30.y, 0);
  assert.equal(slot30.nametagLift, 0);
  assert.equal(slot30.x, 1.2553);
  assert.equal(slot30.z, 8.3057);
  assert.equal(slot30.rotY, -2.9916);
  const r = Math.hypot(slot30.x, slot30.z);
  assert.ok(Math.abs(r - 8.4) < 0.01, `expected fourth overflow ring radius ~8.4, got ${r}`);
});

test('setAvatarStatusText undefined clears, disposes once per change, and keeps scale z at 1', () => {
  const THREE = createFakeTHREE();
  withFakeDocument(() => {
    const muse = createAvatarCapsule(THREE, { handle: 'sol', role: 'muse' });
    const sprite = muse.userData.nametagSprite;

    setAvatarStatusText(THREE, muse, 'First');
    assert.equal(muse.userData.statusText, 'First');
    assert.equal(sprite.material.needsUpdate, true);
    assert.deepEqual({ x: sprite.scale.x, y: sprite.scale.y, z: sprite.scale.z }, { x: 1.5, y: 0.5625, z: 1 });

    let disposed = 0;
    sprite.material.map.dispose = () => { disposed += 1; };
    setAvatarStatusText(THREE, muse, 'Second');
    assert.equal(disposed, 1);
    assert.equal(muse.userData.statusText, 'Second');
    assert.equal(sprite.material.needsUpdate, true);

    sprite.material.map.dispose = () => { disposed += 1; };
    setAvatarStatusText(THREE, muse, undefined);
    assert.equal(disposed, 2);
    assert.equal(muse.userData.statusText, null);
    assert.equal(sprite.material.map.canvas.width, 384);
    assert.equal(sprite.material.map.canvas.height, 96);
    assert.deepEqual({ x: sprite.scale.x, y: sprite.scale.y, z: sprite.scale.z }, { x: 1.5, y: 0.375, z: 1 });
  });
});

test('pickBandstandSpot preferred slot on a short spots array and when full', () => {
  const spots = Array.from({ length: 3 }, (_, i) => ({
    slot: i,
    x: i,
    y: 0.6,
    z: i,
    rotY: 0,
  }));
  const used = new Set();

  const s1 = pickBandstandSpot(spots, used, 1);
  assert.equal(s1.slot, 1);
  assert.equal(s1.nametagLift, 0.5);

  const s5 = pickBandstandSpot(spots, used, 5);
  assert.equal(s5.slot, 0);
  assert.equal(s5.nametagLift, 0);

  pickBandstandSpot(spots, used, null);
  assert.equal(used.size, 3);

  const overflow = pickBandstandSpot(spots, used, 1);
  assert.equal(overflow.slot, 3);
  assert.equal(overflow.y, 0);
  const r = Math.hypot(overflow.x, overflow.z);
  assert.ok(Math.abs(r - 5.7) < 0.01, `expected overflow radius ~5.7, got ${r}`);
  assert.equal(overflow.x, +(Math.sin((3 / 10) * Math.PI * 2 + 0.15) * 5.7).toFixed(4));
  assert.equal(overflow.z, +(Math.cos((3 / 10) * Math.PI * 2 + 0.15) * 5.7).toFixed(4));
});

test('getPlotTargetPosition synthetic rotY 0 and rotY PI/2 layouts pin the forward/side basis', () => {
  const gate = { x: 0, y: 0, z: 27, rotY: 0 };
  assert.deepEqual(getPlotTargetPosition(gate, 0), { x: 0, y: 0, z: 30.6, rotY: 0 });
  assert.deepEqual(getPlotTargetPosition(gate, 1), { x: 0.9, y: 0, z: 30.6, rotY: 0 });
  assert.deepEqual(getPlotTargetPosition(gate, 2), { x: -0.9, y: 0, z: 30.6, rotY: 0 });

  const east = { x: 0, y: 0, z: 0, rotY: Math.PI / 2 };
  assert.deepEqual(getPlotTargetPosition(east, 0), { x: 3.6, y: 0, z: 0, rotY: Math.PI / 2 });
  assert.deepEqual(getPlotTargetPosition(east, 1), { x: 3.6, y: 0, z: -0.9, rotY: Math.PI / 2 });
});

test('getPlotTargetPosition indices 9 and 10 continue the ±0.9 stagger ladder', () => {
  const plot1 = TOWN_LAYOUT.plots[0];
  const p0 = getPlotTargetPosition(plot1, 0);
  const sideX = Math.cos(plot1.rotY);
  const sideZ = -Math.sin(plot1.rotY);

  const p9 = getPlotTargetPosition(plot1, 9);
  const p10 = getPlotTargetPosition(plot1, 10);
  assert.equal(p9.y, 0);
  assert.equal(p10.rotY, plot1.rotY);

  const proj9 = (p9.x - p0.x) * sideX + (p9.z - p0.z) * sideZ;
  const proj10 = (p10.x - p0.x) * sideX + (p10.z - p0.z) * sideZ;
  assert.ok(Math.abs(proj9 - 4.5) < 0.01, `expected index 9 lateral +4.5, got ${proj9}`);
  assert.ok(Math.abs(proj10 + 4.5) < 0.01, `expected index 10 lateral -4.5, got ${proj10}`);
});

test('setAvatarStatusText null/undefined avatar and null material return silently', () => {
  const THREE = createFakeTHREE();
  setAvatarStatusText(THREE, null, 'x');
  setAvatarStatusText(THREE, undefined, 'x');
  setAvatarStatusText(THREE, {}, 'x');

  const noSprite = { userData: { handle: 'x' } };
  setAvatarStatusText(THREE, noSprite, 'x');
  assert.equal('statusText' in noSprite.userData, false);

  const nullMat = { userData: { handle: 'y', nametagSprite: { material: null } } };
  setAvatarStatusText(THREE, nullMat, 'x');
  assert.equal('statusText' in nullMat.userData, false);
});

test('setAvatarStatusText whitespace-only clears a set status; same status with new padding is idempotent', () => {
  const THREE = createFakeTHREE();
  withFakeDocument((drawnTexts) => {
    const muse = createAvatarCapsule(THREE, { handle: 'sol', role: 'muse' });
    const sprite = muse.userData.nametagSprite;

    setAvatarStatusText(THREE, muse, 'Tea is on');
    assert.equal(muse.userData.statusText, 'Tea is on');

    drawnTexts.length = 0;
    setAvatarStatusText(THREE, muse, '   ');
    assert.equal(muse.userData.statusText, null);
    assert.equal(sprite.material.map.canvas.height, 96);
    assert.deepEqual(drawnTexts.map((d) => d.text), ['[MUSE] sol']);

    setAvatarStatusText(THREE, muse, 'Tea is on');
    const statusMap = sprite.material.map;
    drawnTexts.length = 0;
    setAvatarStatusText(THREE, muse, '  Tea is on  ');
    assert.equal(sprite.material.map, statusMap);
    assert.equal(drawnTexts.length, 0);
    assert.equal(muse.userData.statusText, 'Tea is on');
  });
});

test('setAvatarStatusText trims before truncating and tolerates a map without dispose', () => {
  const THREE = createFakeTHREE();
  withFakeDocument(() => {
    const muse = createAvatarCapsule(THREE, { handle: 'sol', role: 'muse' });
    const sprite = muse.userData.nametagSprite;
    assert.equal(typeof sprite.material.map.dispose, 'undefined');

    setAvatarStatusText(THREE, muse, 'First status here');
    const firstMap = sprite.material.map;

    setAvatarStatusText(THREE, muse, 'Second status here');
    assert.notEqual(sprite.material.map, firstMap);
    assert.equal(muse.userData.statusText, 'Second status here');

    setAvatarStatusText(THREE, muse, `  ${'a'.repeat(30)}  `);
    assert.equal(muse.userData.statusText, `${'a'.repeat(23)}…`);
    assert.equal(muse.userData.statusText.length, 24);
  });
});

test('setAvatarStatusText missing handle defaults badge to muse', () => {
  const THREE = createFakeTHREE();
  withFakeDocument((drawnTexts) => {
    const npc = createAvatarCapsule(THREE, { handle: 'maren', role: 'npc' });
    npc.userData.handle = undefined;
    drawnTexts.length = 0;
    setAvatarStatusText(THREE, npc, 'Hi');
    assert.deepEqual(drawnTexts.map((d) => d.text), ['[NPC] muse', 'Hi']);

    const muse = createAvatarCapsule(THREE, { handle: 'sol', role: 'muse' });
    muse.userData.handle = '';
    drawnTexts.length = 0;
    setAvatarStatusText(THREE, muse, 'Hello');
    assert.deepEqual(drawnTexts.map((d) => d.text), ['[MUSE] muse', 'Hello']);
  });
});

test('setAvatarStatusText 24-char status with trailing spaces keeps full text; 25-char trims then truncates', () => {
  const THREE = createFakeTHREE();
  withFakeDocument(() => {
    const muse = createAvatarCapsule(THREE, { handle: 'sol', role: 'muse' });

    setAvatarStatusText(THREE, muse, `${'x'.repeat(24)}   `);
    assert.equal(muse.userData.statusText, 'x'.repeat(24));
    assert.equal(muse.userData.statusText.includes('…'), false);

    setAvatarStatusText(THREE, muse, `${'y'.repeat(25)}   `);
    assert.equal(muse.userData.statusText, `${'y'.repeat(23)}…`);
    assert.equal(muse.userData.statusText.length, 24);
  });
});

test('createAvatarCapsule muse badge texture draws bg, border, and centered badge text (full call list)', () => {
  const THREE = createFakeTHREE();
  withRecordingDocument((calls) => {
    createAvatarCapsule(THREE, { handle: 'sol' });
    assert.deepEqual(calls, [
      ['fillRect', '#161b28', 0, 0, 384, 96],
      ['strokeRect', '#9be0ff', 8, 8, 8, 368, 80],
      ['fillText', 'bold 30px monospace', '#9be0ff', '[MUSE] sol', 192, 48],
    ]);
  });
});

test('getPlotTargetPosition every plot target sits 3.6 m toward the centre at radius 14.9', () => {
  for (const plot of TOWN_LAYOUT.plots) {
    const t = getPlotTargetPosition(plot, 0);
    const dist = Math.hypot(t.x - plot.x, t.z - plot.z);
    assert.ok(Math.abs(dist - 3.6) < 0.01, `plot ${plot.plotNumber} dist=${dist} should be ~3.6`);
    const r = Math.hypot(t.x, t.z);
    assert.ok(Math.abs(r - 14.9) < 0.01, `plot ${plot.plotNumber} target radius=${r} should be ~14.9`);
    assert.equal(t.y, 0);
    assert.equal(t.rotY, plot.rotY);
  }
});

test('staging badge rule is two-way (npc vs muse); role guest falls back to [MUSE] (pins town.js drift)', () => {
  const THREE = createFakeTHREE();
  withFakeDocument((drawnTexts) => {
    const g = createAvatarCapsule(THREE, { handle: 'visitor', role: 'guest' });
    assert.equal(g.userData.role, 'muse');
    assert.equal(g.children[0].material.color, '#6cb4d8');

    drawnTexts.length = 0;
    setAvatarStatusText(THREE, g, 'Hello');
    assert.deepEqual(
      drawnTexts.map((d) => d.text),
      ['[MUSE] visitor', 'Hello']
    );
  });

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const townSrc = fs.readFileSync(path.join(dir, '..', 'town-3d', 'town.js'), 'utf8');
  const avatarSrc = fs.readFileSync(path.join(dir, 'avatar.mjs'), 'utf8');
  assert.equal(townSrc.includes("role === 'guest' ? `[guest] ${handle}`"), true);
  assert.equal(avatarSrc.includes('[guest]'), false);
});

test('getPlotTargetPosition exact index-0 targets for plots 2, 3, 4, 6, 7, 8', () => {
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[1], 0), { x: 14.3627, y: 0, z: -3.9642, rotY: -1.3015 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[2], 0), { x: 10.4889, y: 0, z: -10.583, rotY: -0.7809 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[3], 0), { x: 3.8345, y: 0, z: -14.3983, rotY: -0.2603 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[5], 0), { x: -10.4889, y: 0, z: -10.583, rotY: 0.7809 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[6], 0), { x: -14.3627, y: 0, z: -3.9642, rotY: 1.3015 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[7], 0), { x: -14.4321, y: 0, z: 3.7058, rotY: 1.8221 });
});

test('TOWN_LAYOUT plots exact rotY list for all 8 plots', () => {
  assert.deepEqual(
    TOWN_LAYOUT.plots.map((p) => p.rotY),
    [-1.8221, -1.3015, -0.7809, -0.2603, 0.2603, 0.7809, 1.3015, 1.8221]
  );
});

test('pickBandstandSpot preferredSlot 0, omitted, and null; exact return keys and fresh objects', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({
    slot: i,
    x: i,
    y: 0.6,
    z: i,
    rotY: 0,
  }));
  const used = new Set();

  const a = pickBandstandSpot(spots, used, 0);
  assert.equal(a.slot, 0);
  assert.deepEqual(Object.keys(a), ['x', 'y', 'z', 'rotY', 'slot', 'nametagLift']);

  const b = pickBandstandSpot(spots, used);
  assert.equal(b.slot, 1);

  const c = pickBandstandSpot(spots, used, null);
  assert.equal(c.slot, 2);

  assert.notEqual(a, b);
  a.x = 999;
  assert.equal(spots[0].x, 0);
});

test('pickBandstandSpot overflow exact coords for idx 19 and idx 29 plus pre-filled empty-spots fallback', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({
    slot: i,
    x: i,
    y: 0.6,
    z: i,
    rotY: 0,
  }));
  const used = new Set();

  for (let i = 0; i < 19; i++) {
    pickBandstandSpot(spots, used, null);
  }
  const slot19 = pickBandstandSpot(spots, used, null);
  assert.equal(slot19.slot, 19);
  assert.equal(slot19.x, +(Math.sin((9 / 10) * Math.PI * 2 + 0.15) * 6.6).toFixed(4));
  assert.equal(slot19.z, +(Math.cos((9 / 10) * Math.PI * 2 + 0.15) * 6.6).toFixed(4));
  assert.equal(slot19.y, 0);
  assert.equal(slot19.nametagLift, 0.5);

  for (let i = 0; i < 9; i++) {
    pickBandstandSpot(spots, used, null);
  }
  const slot29 = pickBandstandSpot(spots, used, null);
  assert.equal(slot29.slot, 29);
  assert.equal(slot29.x, +(Math.sin((9 / 10) * Math.PI * 2 + 0.15) * 7.5).toFixed(4));
  assert.equal(slot29.z, +(Math.cos((9 / 10) * Math.PI * 2 + 0.15) * 7.5).toFixed(4));
  assert.equal(slot29.y, 0);
  assert.equal(slot29.nametagLift, 0.5);

  const emptyFallback = pickBandstandSpot([], new Set([0, 1]), null);
  assert.equal(emptyFallback.slot, 2);
  assert.equal(emptyFallback.x, +(Math.sin((2 / 10) * Math.PI * 2 + 0.15) * 5.7).toFixed(4));
  assert.equal(emptyFallback.z, +(Math.cos((2 / 10) * Math.PI * 2 + 0.15) * 5.7).toFixed(4));
  assert.equal(emptyFallback.y, 0);
});

test('createAvatarCapsule child positions, userData key order, and long-handle badge verbatim', () => {
  const THREE = createFakeTHREE();
  withFakeDocument((drawnTexts) => {
    const av = createAvatarCapsule(THREE, {
      handle: 'a-very-long-handle-name-that-keeps-going',
      role: 'muse',
      nametagLift: 0.25,
    });
    for (const child of av.children) {
      assert.equal(child.position.x, 0);
      assert.equal(child.position.z, 0);
    }
    assert.equal(av.children[0].position.y, 0.5);
    assert.equal(av.children[1].position.y, 1.2);
    assert.equal(av.children[2].position.y, 2.05);
    assert.deepEqual(Object.keys(av.userData), ['handle', 'role', 'nametagLift', 'nametagSprite']);
    assert.equal(av.name, 'avatar_a-very-long-handle-name-that-keeps-going');
    assert.deepEqual(
      drawnTexts.map((d) => d.text),
      ['[MUSE] a-very-long-handle-name-that-keeps-going']
    );
  });
});

test('setAvatarStatusText dispose tally across set/set/set/clear lifecycle and undefined-map null-status no-op', () => {
  const THREE = createFakeTHREE();
  withFakeDocument(() => {
    const muse = createAvatarCapsule(THREE, { handle: 'sol', role: 'muse' });
    const sprite = muse.userData.nametagSprite;
    let disposed = 0;
    const arm = () => {
      sprite.material.map.dispose = () => {
        disposed += 1;
      };
    };

    arm();
    setAvatarStatusText(THREE, muse, 'First');
    assert.equal(disposed, 1);

    arm();
    setAvatarStatusText(THREE, muse, 'Second');
    assert.equal(disposed, 2);

    arm();
    setAvatarStatusText(THREE, muse, 'Third');
    assert.equal(disposed, 3);
    assert.equal(muse.userData.statusText, 'Third');

    arm();
    setAvatarStatusText(THREE, muse, '');
    assert.equal(disposed, 4);
    assert.equal(muse.userData.statusText, null);

    const npc2 = createAvatarCapsule(THREE, { handle: 'maren', role: 'npc' });
    npc2.userData.nametagSprite.material.map = undefined;
    setAvatarStatusText(THREE, npc2, null);
    assert.equal(npc2.userData.nametagSprite.material.map, undefined);
    assert.equal(npc2.userData.statusText, null);
  });
});

test('setAvatarStatusText muse status texture full call list and badge-only restore call list', () => {
  const THREE = createFakeTHREE();
  withRecordingDocument((calls) => {
    const muse = createAvatarCapsule(THREE, { handle: 'sol', role: 'muse' });

    calls.length = 0;
    setAvatarStatusText(THREE, muse, 'Quiet tea');
    assert.deepEqual(calls, [
      ['fillRect', '#161b28', 0, 0, 384, 144],
      ['strokeRect', '#9be0ff', 8, 8, 8, 368, 128],
      ['fillText', 'bold 30px monospace', '#9be0ff', '[MUSE] sol', 192, 48],
      ['fillText', 'bold 22px monospace', '#9be0ff', 'Quiet tea', 192, 96],
    ]);

    calls.length = 0;
    setAvatarStatusText(THREE, muse, '');
    assert.deepEqual(calls, [
      ['fillRect', '#161b28', 0, 0, 384, 96],
      ['strokeRect', '#9be0ff', 8, 8, 8, 368, 80],
      ['fillText', 'bold 30px monospace', '#9be0ff', '[MUSE] sol', 192, 48],
    ]);
  });
});

test('TOWN_LAYOUT plot objects have exact key order, plotNumber 1..8, and y 0', () => {
  for (let i = 0; i < 8; i++) {
    const plot = TOWN_LAYOUT.plots[i];
    assert.deepEqual(Object.keys(plot), ['plotNumber', 'x', 'y', 'z', 'rotY']);
    assert.equal(plot.plotNumber, i + 1);
    assert.equal(plot.y, 0);
  }
});

test('avatar.mjs source discipline, export surface, and test-avatar.mjs hygiene', () => {
  const selfPath = fileURLToPath(import.meta.url);
  const dir = path.dirname(selfPath);
  const avatarSrc = fs.readFileSync(path.join(dir, 'avatar.mjs'), 'utf8');
  const selfSrc = fs.readFileSync(selfPath, 'utf8');

  const fetchToken = 'fet' + 'ch(';
  const randomToken = 'Math.' + 'random';
  const legacyToken = 'camp' + 'fire';

  assert.equal(/^import /m.test(avatarSrc), false);
  assert.equal(avatarSrc.includes(fetchToken), false);
  assert.equal(avatarSrc.includes(randomToken), false);
  assert.equal(avatarSrc.includes(legacyToken), false);

  const exports = Array.from(avatarSrc.matchAll(/^export (?:const|function) (\w+)/gm), (m) => m[1]).sort();
  assert.deepEqual(exports, [
    'SEED_HOME_PADS',
    'TOWN_LAYOUT',
    'createAvatarCapsule',
    'getPlotTargetPosition',
    'pickBandstandSpot',
    'setAvatarStatusText',
  ]);
  assert.equal(avatarSrc.startsWith('// Copied verbatim from town-3d/town.js:'), true);

  assert.equal(selfSrc.includes(fetchToken), false);
  assert.equal(selfSrc.includes(randomToken), false);
  assert.equal(selfSrc.includes(legacyToken), false);
});

test('TOWN_LAYOUT plots exact x/z literal list for all 8 plots', () => {
  assert.deepEqual(
    TOWN_LAYOUT.plots.map((p) => [p.x, p.z]),
    [
      [17.919, 4.601],
      [17.833, -4.922],
      [13.023, -13.14],
      [4.761, -17.877],
      [-4.761, -17.877],
      [-13.023, -13.14],
      [-17.833, -4.922],
      [-17.919, 4.601],
    ]
  );
});

test('TOWN_LAYOUT and SEED_HOME_PADS exact key order', () => {
  assert.deepEqual(Object.keys(TOWN_LAYOUT), [
    'clearingRadius',
    'bandstand',
    'gate',
    'newsstand',
    'noticeBoard',
    'inn',
    'plotRadius',
    'plots',
  ]);
  assert.deepEqual(Object.keys(TOWN_LAYOUT.bandstand), ['x', 'y', 'z', 'radius', 'height']);
  assert.deepEqual(Object.keys(SEED_HOME_PADS), ['wick', 'maren', 'tomas']);
});

test('avatar.mjs header comment lines are exact', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const avatarSrc = fs.readFileSync(path.join(dir, 'avatar.mjs'), 'utf8');
  assert.deepEqual(avatarSrc.split('\n').slice(0, 9), [
    '// Copied verbatim from town-3d/town.js:',
    '//   - TOWN_LAYOUT (lines 10-54)',
    '//   - makeCanvas (lines 200-233)',
    '//   - makeTextTexture (lines 235-265)',
    '//   - createAvatarCapsule (lines 757-794)',
    '//   - SEED_HOME_PADS (line 1806)',
    '//   - getPlotTargetPosition (lines 2134-2146)',
    '//   - pickBandstandSpot (lines 2148-2174)',
    '// Keep in step with town-3d/town.js; no THREE import (passed in), no top-level document access.',
  ]);
});

test('pickBandstandSpot preferred slot exact coords with distinct spot values', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({
    slot: i,
    x: i * 2,
    y: 0.6,
    z: i * 3,
    rotY: i,
  }));
  const used = new Set();

  const s7 = pickBandstandSpot(spots, used, 7);
  assert.deepEqual(s7, { x: 14, y: 0.6, z: 21, rotY: 7, slot: 7, nametagLift: 0.5 });

  const s8 = pickBandstandSpot(spots, used, 8);
  assert.deepEqual(s8, { x: 16, y: 0.6, z: 24, rotY: 8, slot: 8, nametagLift: 0 });

  assert.deepEqual([...used].sort((a, b) => a - b), [7, 8]);

  s7.x = 999;
  assert.equal(spots[7].x, 14);
});

test('getPlotTargetPosition indices 11 and 12 continue the ±0.9 stagger ladder', () => {
  const plot1 = TOWN_LAYOUT.plots[0];
  const p0 = getPlotTargetPosition(plot1, 0);
  const sideX = Math.cos(plot1.rotY);
  const sideZ = -Math.sin(plot1.rotY);

  const p11 = getPlotTargetPosition(plot1, 11);
  const p12 = getPlotTargetPosition(plot1, 12);
  for (const p of [p11, p12]) {
    assert.equal(p.y, 0);
    assert.equal(p.rotY, plot1.rotY);
  }

  const proj11 = (p11.x - p0.x) * sideX + (p11.z - p0.z) * sideZ;
  const proj12 = (p12.x - p0.x) * sideX + (p12.z - p0.z) * sideZ;
  assert.ok(Math.abs(proj11 - 5.4) < 0.01, `expected index 11 lateral +5.4, got ${proj11}`);
  assert.ok(Math.abs(proj12 + 5.4) < 0.01, `expected index 12 lateral -5.4, got ${proj12}`);
});

test('pickBandstandSpot overflow slots 39 and 40: fourth ring 8.4 m, fifth ring 9.3 m', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({
    slot: i,
    x: i,
    y: 0.6,
    z: i,
    rotY: 0,
  }));
  const used = new Set();

  for (let i = 0; i < 39; i++) {
    pickBandstandSpot(spots, used, null);
  }
  const slot39 = pickBandstandSpot(spots, used, null);
  assert.deepEqual(slot39, {
    x: -3.8664,
    y: 0,
    z: 7.4573,
    rotY: 2.6633,
    slot: 39,
    nametagLift: 0.5,
  });
  assert.ok(Math.abs(Math.hypot(slot39.x, slot39.z) - 8.4) < 0.01, 'slot 39 must sit on the fourth ring at 8.4 m');

  const slot40 = pickBandstandSpot(spots, used, null);
  assert.deepEqual(slot40, {
    x: 1.3898,
    y: 0,
    z: 9.1956,
    rotY: -2.9916,
    slot: 40,
    nametagLift: 0,
  });
  assert.ok(Math.abs(Math.hypot(slot40.x, slot40.z) - 9.3) < 0.01, 'slot 40 must sit on the fifth ring at 9.3 m');
});

test('setAvatarStatusText with a null map creates a new texture instead of throwing', () => {
  const THREE = createFakeTHREE();
  const npc = createAvatarCapsule(THREE, { handle: 'maren', role: 'npc' });
  npc.userData.nametagSprite.material.map = null;

  setAvatarStatusText(THREE, npc, 'Tea is on');
  assert.ok(npc.userData.nametagSprite.material.map, 'a null map must be replaced by a new texture');
  assert.equal(npc.userData.statusText, 'Tea is on');
  assert.equal(npc.userData.nametagSprite.material.map.canvas.width, 384);
  assert.equal(npc.userData.nametagSprite.material.map.canvas.height, 144);
  assert.equal(npc.userData.nametagSprite.scale.y, 0.5625);
});

test('getPlotTargetPosition exact index-1 targets for plots 1 and 5', () => {
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[0], 1), {
    x: 14.2083,
    y: 0,
    z: 4.5775,
    rotY: -1.8221,
  });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[4], 1), {
    x: -2.9648,
    y: 0,
    z: -14.6299,
    rotY: 0.2603,
  });
});

test('pickBandstandSpot pre-filled used set with a gap beyond spots length overflows by used.size', () => {
  const spots = Array.from({ length: 3 }, (_, i) => ({
    slot: i,
    x: i,
    y: 0.6,
    z: i,
    rotY: 0,
  }));
  const used = new Set([0, 1, 2, 5]);

  const over = pickBandstandSpot(spots, used, null);
  assert.deepEqual(over, {
    x: 2.6236,
    y: 0,
    z: -5.0603,
    rotY: -0.4783,
    slot: 4,
    nametagLift: 0,
  });
  assert.ok(Math.abs(Math.hypot(over.x, over.z) - 5.7) < 0.01, 'gap overflow must sit on the first ring at 5.7 m');
  assert.equal(used.size, 5);
  assert.equal(used.has(4), true);
});

test('File hygiene for test-avatar.mjs at 53 tests', () => {
  const selfPath = fileURLToPath(import.meta.url);
  const self = fs.readFileSync(selfPath, 'utf8');
  const names = [...self.matchAll(/^test\(['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.equal(names.length, 53, 'test-avatar.mjs must have 53 top-level tests');
  assert.equal(new Set(names).size, 53, 'test names must be unique');
  const imports = [...self.matchAll(/^import .+$/gm)].map((m) => m[0]);
  assert.deepEqual(imports, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'import {',
  ]);
  assert.equal(self.includes('camp' + 'fire'), false, 'test-avatar.mjs must not contain the banned term');
  const loopbackRe = new RegExp(`127\\.0\\.0\\.${'0.1'}|local${'host'}`);
  assert.equal(loopbackRe.test(self), false, 'test-avatar.mjs must not hardcode loopback host');
  assert.equal(/:\d{4,5}\b/.test(self), false, 'test-avatar.mjs must not hardcode a port');
  assert.equal(self.includes('fet' + 'ch('), false, 'test-avatar.mjs must not call fetch');
  assert.equal(self.includes('Math.' + 'random'), false, 'test-avatar.mjs must not call the random-number helper');
  assert.equal(self.includes('Date.' + 'now'), false, 'test-avatar.mjs must not read the wall clock');
  assert.equal(self.includes('TO' + 'DO'), false, 'test-avatar.mjs must not contain a to-do marker');
  assert.equal(self.includes('FIX' + 'ME'), false, 'test-avatar.mjs must not contain a fix-me marker');
});
