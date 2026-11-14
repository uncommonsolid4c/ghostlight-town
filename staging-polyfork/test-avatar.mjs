import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOWN_LAYOUT,
  SEED_HOME_PADS,
  createAvatarCapsule,
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

  // 11th avatar -> overflow ring at bandstand.radius + 1.2 = 5.7 m
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
