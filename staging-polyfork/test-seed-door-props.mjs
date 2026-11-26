import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachSeedDoorProp } from './seed-door-props.mjs';
import { CHARACTERS } from '../town-npc/characters.mjs';
import { TOWN_LAYOUT, SEED_HOME_PADS } from './avatar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELF_PATH = fileURLToPath(import.meta.url);
const MODULE_PATH = path.join(__dirname, 'seed-door-props.mjs');
const TOWN_JS_PATH = path.join(__dirname, '..', 'town-3d', 'town.js');

function assertPos(obj, x, y, z) {
  assert.deepEqual({ x: obj.position.x, y: obj.position.y, z: obj.position.z }, { x, y, z });
}

function makeFakeThree() {
  class BoxGeometry {
    constructor(w, h, d) {
      this.type = 'BoxGeometry';
      this.args = [w, h, d];
    }
  }
  class CylinderGeometry {
    constructor(rt, rb, h, seg) {
      this.type = 'CylinderGeometry';
      this.args = [rt, rb, h, seg];
    }
  }
  class MeshStandardMaterial {
    constructor(opts) {
      this.type = 'MeshStandardMaterial';
      this.opts = opts;
      this.color = opts.color;
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.name = '';
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        },
      };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
  }
  class Group {
    constructor() {
      this.name = '';
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        },
      };
      this.rotation = { x: 0, y: 0, z: 0 };
      this.children = [];
    }
    add(child) {
      this.children.push(child);
    }
  }
  return {
    BoxGeometry,
    CylinderGeometry,
    MeshStandardMaterial,
    Mesh,
    Group,
  };
}

test('attachSeedDoorProp attaches oil lamp for wick at (-2.9, 0, 2.9) with pinned rotY', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();

  const prop = attachSeedDoorProp(THREE, cottage, 'wick');
  assert.ok(prop);
  assert.equal(prop.name, 'seed_door_prop_wick');
  assert.equal(cottage.children.length, 1);
  assert.equal(cottage.children[0], prop);
  assert.equal(prop.position.x, -2.9);
  assert.equal(prop.position.y, 0);
  assert.equal(prop.position.z, 2.9);
  assert.ok(Math.abs(prop.position.x) > 2.4, 'must sit clear of the porch deck [-2.4, 2.4]');
  assert.equal(prop.rotation.y, -1.1733);

  assert.equal(prop.children.length, 3);
  const [base, globe, handle] = prop.children;
  assert.equal(base.geometry.type, 'CylinderGeometry');
  assert.equal(base.material.color, '#9a7b3e');
  assert.equal(globe.geometry.type, 'CylinderGeometry');
  assert.equal(globe.material.color, '#fff1c9');
  assert.equal(globe.material.opts.emissive, '#ffcf70');
  assert.equal(globe.material.opts.emissiveIntensity, 1.1);
  assert.equal(handle.geometry.type, 'BoxGeometry');
  assert.equal(handle.material.color, '#9a7b3e');
});

test('attachSeedDoorProp attaches typewriter for maren at (-2.9, 0, 2.9) with pinned rotY', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();

  const prop = attachSeedDoorProp(THREE, cottage, 'maren');
  assert.ok(prop);
  assert.equal(prop.name, 'seed_door_prop_maren');
  assert.equal(cottage.children.length, 1);
  assert.equal(cottage.children[0], prop);
  assert.equal(prop.position.x, -2.9);
  assert.equal(prop.position.y, 0);
  assert.equal(prop.position.z, 2.9);
  assert.ok(Math.abs(prop.position.x) > 2.4, 'must sit clear of the porch deck [-2.4, 2.4]');
  assert.equal(prop.rotation.y, -0.6525);

  assert.equal(prop.children.length, 3);
  const [stand, body, roller] = prop.children;
  assert.equal(stand.geometry.type, 'BoxGeometry');
  assert.equal(stand.material.color, '#6b492b');
  assert.equal(body.geometry.type, 'BoxGeometry');
  assert.equal(body.material.color, '#2b2f33');
  assert.equal(roller.geometry.type, 'CylinderGeometry');
  assert.equal(roller.material.color, '#d8d2c5');
  assert.ok(Math.abs(roller.rotation.z - Math.PI / 2) < 1e-12);
});

test('attachSeedDoorProp attaches teapot for tomas at (-2.9, 0, 2.9) with pinned rotY', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();

  const prop = attachSeedDoorProp(THREE, cottage, 'tomas');
  assert.ok(prop);
  assert.equal(prop.name, 'seed_door_prop_tomas');
  assert.equal(cottage.children.length, 1);
  assert.equal(cottage.children[0], prop);
  assert.equal(prop.position.x, -2.9);
  assert.equal(prop.position.y, 0);
  assert.equal(prop.position.z, 2.9);
  assert.ok(Math.abs(prop.position.x) > 2.4, 'must sit clear of the porch deck [-2.4, 2.4]');
  assert.equal(prop.rotation.y, -0.1322);

  assert.equal(prop.children.length, 3);
  const [body, spout, lid] = prop.children;
  assert.equal(body.geometry.type, 'CylinderGeometry');
  assert.deepEqual(body.geometry.args, [0.16, 0.2, 0.28, 8]);
  assert.equal(spout.geometry.type, 'BoxGeometry');
  assert.deepEqual(spout.geometry.args, [0.14, 0.05, 0.05]);
  assert.equal(lid.geometry.type, 'CylinderGeometry');
  assert.deepEqual(lid.geometry.args, [0.06, 0.12, 0.08, 8]);
  assert.equal(body.material.color, '#8f6b47');
});

test('attachSeedDoorProp returns null and adds zero children for milo and unknown handles', () => {
  const THREE = makeFakeThree();
  for (const handle of ['milo', 'lampmoth', '', null, undefined, 42]) {
    const cottage = new THREE.Group();
    const res = attachSeedDoorProp(THREE, cottage, handle);
    assert.equal(res, null);
    assert.equal(cottage.children.length, 0);
  }
});

test('seed-door-props.mjs and test-seed-door-props.mjs contain no banned term or fetch(', async () => {
  const [modSrc, selfSrc] = await Promise.all([
    fs.readFile(MODULE_PATH, 'utf8'),
    fs.readFile(SELF_PATH, 'utf8'),
  ]);
  assert.ok(!/camp[f]ire/i.test(modSrc), 'seed-door-props.mjs must not contain the banned term');
  assert.ok(!/camp[f]ire/i.test(selfSrc), 'test-seed-door-props.mjs must not contain the banned term');
  assert.ok(!/\bfetch\s*\(/.test(modSrc), 'seed-door-props.mjs must not call fetch(');
});

test('oil-lamp geometry detail (wick): exact args, child positions, and brass roughness', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const prop = attachSeedDoorProp(THREE, cottage, 'wick');

  const [base, globe, handle] = prop.children;
  assert.deepEqual(base.geometry.args, [0.14, 0.18, 0.14, 8]);
  assert.deepEqual(globe.geometry.args, [0.09, 0.12, 0.24, 8]);
  assert.deepEqual(handle.geometry.args, [0.04, 0.18, 0.04]);

  assertPos(base, 0, 0.07, 0);
  assertPos(globe, 0, 0.26, 0);
  assertPos(handle, 0.13, 0.22, 0);

  assert.equal(base.material, handle.material);
  assert.equal(base.material.opts.roughness, 0.65);
});

test('typewriter geometry detail (maren): exact args, child positions, and material roughness', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const prop = attachSeedDoorProp(THREE, cottage, 'maren');

  const [stand, body, roller] = prop.children;
  assert.deepEqual(stand.geometry.args, [0.7, 0.08, 0.55]);
  assert.deepEqual(body.geometry.args, [0.46, 0.18, 0.36]);
  assert.deepEqual(roller.geometry.args, [0.05, 0.05, 0.42, 8]);

  assertPos(stand, 0, 0.04, 0);
  assertPos(body, 0, 0.17, 0);
  assertPos(roller, 0, 0.28, -0.1);

  assert.equal(stand.material.opts.roughness, 0.88);
  assert.equal(body.material.opts.roughness, 0.75);
  assert.equal(roller.material.opts.roughness, 0.8);
});

test('teapot geometry detail (tomas): child positions and shared metalMat with roughness 0.65', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const prop = attachSeedDoorProp(THREE, cottage, 'tomas');

  const [body, spout, lid] = prop.children;
  assertPos(body, 0, 0.14, 0);
  assertPos(spout, 0.2, 0.18, 0);
  assertPos(lid, 0, 0.32, 0);

  assert.equal(spout.material, body.material);
  assert.equal(lid.material, body.material);
  assert.equal(body.material.opts.roughness, 0.65);
});

test('attachSeedDoorProp yields distinct groups per cottage and appends on repeat attach', () => {
  const THREE = makeFakeThree();
  const cWick = new THREE.Group();
  const cMaren = new THREE.Group();
  const cTomas = new THREE.Group();

  const pWick = attachSeedDoorProp(THREE, cWick, 'wick');
  const pMaren = attachSeedDoorProp(THREE, cMaren, 'maren');
  const pTomas = attachSeedDoorProp(THREE, cTomas, 'tomas');

  assert.notEqual(pWick, pMaren);
  assert.notEqual(pWick, pTomas);
  assert.notEqual(pMaren, pTomas);

  assert.equal(pWick.name, 'seed_door_prop_wick');
  assert.equal(pMaren.name, 'seed_door_prop_maren');
  assert.equal(pTomas.name, 'seed_door_prop_tomas');

  assert.equal(pWick.rotation.y, -1.1733);
  assert.equal(pMaren.rotation.y, -0.6525);
  assert.equal(pTomas.rotation.y, -0.1322);

  // Repeat attach on the same cottage adds a second group (no dedup guard)
  const second = attachSeedDoorProp(THREE, cWick, 'wick');
  assert.equal(cWick.children.length, 2);
  assert.equal(cWick.children[0], pWick);
  assert.equal(cWick.children[1], second);
  assert.notEqual(second, pWick);
  assert.equal(cWick.children[0].name, 'seed_door_prop_wick');
  assert.equal(cWick.children[1].name, 'seed_door_prop_wick');
});

test('attachSeedDoorProp rejects handle-shape edges, prototype keys, and Symbol handles', () => {
  const THREE = makeFakeThree();
  const edges = [
    'Wick',
    ' wick',
    'wick ',
    'wick2',
    'MILO',
    'constructor',
    'toString',
    '__proto__',
    Symbol('wick'),
  ];
  for (const handle of edges) {
    const cottage = new THREE.Group();
    const res = attachSeedDoorProp(THREE, cottage, handle);
    assert.equal(res, null, `expected null for handle ${String(handle)}`);
    assert.equal(cottage.children.length, 0);
  }
});

test('live-rotation drift guard against town-3d/town.js and shared builder imports', async () => {
  const [townSrc, modSrc] = await Promise.all([
    fs.readFile(TOWN_JS_PATH, 'utf8'),
    fs.readFile(MODULE_PATH, 'utf8'),
  ]);

  const expected = [
    ['wick', 'wick_oil_lamp'],
    ['maren', 'maren_typewriter'],
    ['tomas', 'tomas_teapot'],
  ];
  const THREE = makeFakeThree();
  for (const [handle, propId] of expected) {
    const match = townSrc.match(new RegExp(`id:\\s*'${propId}'[^}]*?rotY:\\s*(-?\\d+(?:\\.\\d+)?)`));
    assert.ok(match, `expected PROP_PLACEMENTS entry for ${propId} in town-3d/town.js`);
    const liveRotY = Number(match[1]);
    const prop = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    assert.equal(prop.rotation.y, liveRotY, `${handle} rotY must match ${propId} in town-3d/town.js`);
  }

  const importMatch = modSrc.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/interior-room\.mjs['"]/);
  assert.ok(importMatch, 'seed-door-props.mjs must import builders from ./interior-room.mjs');
  for (const fn of ['buildProceduralOilLamp', 'buildProceduralTypewriter', 'buildProceduralTeapot']) {
    assert.ok(importMatch[1].includes(fn), `expected ${fn} in ./interior-room.mjs import`);
  }
  assert.ok(
    !/function\s+buildProcedural(?:OilLamp|Typewriter|Teapot)\b/.test(modSrc),
    'seed-door-props.mjs must not re-vendor procedural builders'
  );
});

test('shared placement constant and clearance from signpost and porch deck', async () => {
  const THREE = makeFakeThree();
  for (const handle of ['wick', 'maren', 'tomas']) {
    const prop = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    assertPos(prop, -2.9, 0, 2.9);
  }

  const first = attachSeedDoorProp(THREE, new THREE.Group(), 'wick');
  const second = attachSeedDoorProp(THREE, new THREE.Group(), 'wick');
  assert.notEqual(first.position, second.position);

  assert.ok(Math.hypot(-2.9 - 2.3, 2.9 - 2.6) > 5);
  assert.ok(Math.abs(-2.9) > 2.4);

  const modSrc = await fs.readFile(MODULE_PATH, 'utf8');
  assert.ok(modSrc.includes('const SEED_DOOR_PROP_POS = [-2.9, 0, 2.9];'));
});

test('rotY ordering and range, group shape, and total child count', () => {
  const THREE = makeFakeThree();
  const pWick = attachSeedDoorProp(THREE, new THREE.Group(), 'wick');
  const pMaren = attachSeedDoorProp(THREE, new THREE.Group(), 'maren');
  const pTomas = attachSeedDoorProp(THREE, new THREE.Group(), 'tomas');

  assert.ok(pWick.rotation.y < pMaren.rotation.y && pMaren.rotation.y < pTomas.rotation.y);

  const props = [pWick, pMaren, pTomas];
  let totalChildren = 0;
  for (const prop of props) {
    assert.ok(prop.rotation.y > -Math.PI && prop.rotation.y < 0);
    assert.equal(prop.rotation.x, 0);
    assert.equal(prop.rotation.z, 0);
    assert.ok(prop instanceof THREE.Group);
    for (const child of prop.children) {
      assert.ok(child instanceof THREE.Mesh);
    }
    totalChildren += prop.children.length;
  }
  assert.equal(totalChildren, 9);
});

test('handle validation precedes cottage use', () => {
  const THREE = makeFakeThree();

  assert.equal(attachSeedDoorProp(THREE, null, 'nobody'), null);
  assert.equal(attachSeedDoorProp(THREE, null, 'milo'), null);
  assert.equal(attachSeedDoorProp(THREE, undefined, 'lampmoth'), null);

  assert.throws(() => attachSeedDoorProp(THREE, null, 'wick'), TypeError);
  assert.throws(() => attachSeedDoorProp(THREE, undefined, 'maren'), TypeError);
  assert.throws(() => attachSeedDoorProp(THREE, {}, 'tomas'), TypeError);
  assert.throws(() => attachSeedDoorProp(THREE, { add: 'not-a-function' }, 'wick'), TypeError);
});

test('throwing builder leaves the cottage untouched', () => {
  for (const missing of ['CylinderGeometry', 'MeshStandardMaterial']) {
    const THREE = makeFakeThree();
    delete THREE[missing];
    for (const handle of ['wick', 'maren', 'tomas']) {
      const cottage = new THREE.Group();
      assert.throws(() => attachSeedDoorProp(THREE, cottage, handle), TypeError);
      assert.equal(cottage.children.length, 0);
    }
  }
});

test('seed-handle set matches CHARACTERS and export shape', async () => {
  const characterHandles = CHARACTERS.map((c) => c.handle).sort();
  assert.deepEqual(characterHandles, ['maren', 'tomas', 'wick']);

  const modSrc = await fs.readFile(MODULE_PATH, 'utf8');
  const propsMatch = modSrc.match(/const SEED_DOOR_PROPS = \{([\s\S]*?)\n\};/);
  assert.ok(propsMatch, 'expected SEED_DOOR_PROPS object literal in seed-door-props.mjs');
  const propKeys = [...propsMatch[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(propKeys, characterHandles);

  assert.ok(modSrc.includes('const SEED_DOOR_PROP_POS = [-2.9, 0, 2.9];'));

  const exports = [...modSrc.matchAll(/^export (function|const|class) (\w+)/gm)].map((m) => m[2]);
  assert.deepEqual(exports, ['attachSeedDoorProp']);
});

test('attach order and mutation independence', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const pMaren = attachSeedDoorProp(THREE, cottage, 'maren');
  const pWick = attachSeedDoorProp(THREE, cottage, 'wick');
  assert.deepEqual(cottage.children, [pMaren, pWick]);

  const cFirst = new THREE.Group();
  const cSecond = new THREE.Group();
  const first = attachSeedDoorProp(THREE, cFirst, 'wick');
  const second = attachSeedDoorProp(THREE, cSecond, 'wick');

  first.position.x = 99;
  first.rotation.y = 0;
  first.name = 'changed';
  first.children.push({ fake: true });

  assert.equal(second.position.x, -2.9);
  assert.equal(second.rotation.y, -1.1733);
  assert.equal(second.name, 'seed_door_prop_wick');
  assert.equal(second.children.length, 3);
  assert.equal(cSecond.children.length, 1);
});

function serializeGroup(group) {
  return {
    name: group.name,
    position: { x: group.position.x, y: group.position.y, z: group.position.z },
    rotation: { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z },
    children: group.children.map((child) => ({
      geometry: {
        type: child.geometry.type,
        args: [...child.geometry.args],
      },
      material: {
        type: child.material.type,
        color: child.material.color,
        opts: { ...child.material.opts },
      },
      position: { x: child.position.x, y: child.position.y, z: child.position.z },
      rotation: { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z },
    })),
  };
}

test('attachSeedDoorProp returns exactly what the direct builder builds', async () => {
  const {
    buildProceduralOilLamp,
    buildProceduralTypewriter,
    buildProceduralTeapot,
  } = await import('./interior-room.mjs');

  const builders = [
    ['wick', buildProceduralOilLamp],
    ['maren', buildProceduralTypewriter],
    ['tomas', buildProceduralTeapot],
  ];

  const THREE = makeFakeThree();
  for (const [handle, buildFn] of builders) {
    const attached = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    const direct = buildFn(THREE);
    assert.equal(direct.name, '');
    assert.deepEqual(serializeGroup(attached).children, serializeGroup(direct).children);
  }
});

test('staging.js wires attachSeedDoorProp after the porch and plot props', async () => {
  const stagingPath = path.join(__dirname, 'staging.js');
  const stagingSrc = await fs.readFile(stagingPath, 'utf8');

  assert.ok(
    stagingSrc.includes("import { attachSeedDoorProp } from './seed-door-props.mjs?v=38';"),
    'expected exact ?v=38 import of attachSeedDoorProp in staging.js'
  );
  assert.ok(
    stagingSrc.includes('attachSeedDoorProp(THREE, cottage, handle);'),
    'expected attachSeedDoorProp(THREE, cottage, handle); call in staging.js'
  );

  const plotIdx = stagingSrc.indexOf('attachPlotProps(THREE, cottage,');
  const doorIdx = stagingSrc.indexOf('attachSeedDoorProp(THREE, cottage, handle);');
  assert.ok(plotIdx !== -1, 'expected attachPlotProps(THREE, cottage, call in staging.js');
  assert.ok(doorIdx !== -1, 'expected attachSeedDoorProp(THREE, cottage, handle); call in staging.js');
  assert.ok(
    plotIdx < doorIdx && doorIdx - plotIdx < 300,
    `expected attachPlotProps before attachSeedDoorProp within 300 chars (plotIdx=${plotIdx}, doorIdx=${doorIdx})`
  );

  assert.ok(
    stagingSrc.includes('sign.position.set(2.3, 0.18, 2.6);'),
    'expected signpost placement at (2.3, 0.18, 2.6) in staging.js'
  );
});

test('GLB fallback parity: town.js placements carry the same three prop kinds', async () => {
  const townSrc = await fs.readFile(TOWN_JS_PATH, 'utf8');

  const wickBlock = townSrc.match(/\{[^}]*?id:\s*'wick_oil_lamp'[^}]*?\}/);
  assert.ok(wickBlock, 'expected wick_oil_lamp block in town-3d/town.js');
  assert.match(wickBlock[0], /kind:\s*'oil-lamp'/);
  assert.match(wickBlock[0], /model:\s*'models\/oil-lamp\.glb'/);

  const tomasBlock = townSrc.match(/\{[^}]*?id:\s*'tomas_teapot'[^}]*?\}/);
  assert.ok(tomasBlock, 'expected tomas_teapot block in town-3d/town.js');
  assert.match(tomasBlock[0], /kind:\s*'teapot'/);
  assert.match(tomasBlock[0], /model:\s*'models\/teapot\.glb'/);

  const marenBlock = townSrc.match(/\{[^}]*?id:\s*'maren_typewriter'[^}]*?\}/);
  assert.ok(marenBlock, 'expected maren_typewriter block in town-3d/town.js');
  assert.match(marenBlock[0], /kind:\s*'typewriter'/);
  assert.ok(!/\bmodel\s*:/.test(marenBlock[0]), 'maren_typewriter must have no model: field');

  const modelsDir = path.join(__dirname, '..', 'town-3d', 'models');
  const oilLampStat = await fs.stat(path.join(modelsDir, 'oil-lamp.glb'));
  assert.ok(oilLampStat.isFile());
  const teapotStat = await fs.stat(path.join(modelsDir, 'teapot.glb'));
  assert.ok(teapotStat.isFile());
  await assert.rejects(() => fs.stat(path.join(modelsDir, 'typewriter.glb')), { code: 'ENOENT' });
});

test("only wick's globe glows: emissive lives on the oil lamp alone", () => {
  const THREE = makeFakeThree();
  const wickProp = attachSeedDoorProp(THREE, new THREE.Group(), 'wick');
  const [base, globe, handleMesh] = wickProp.children;
  assert.equal(globe.material.opts.emissive, '#ffcf70');
  assert.equal(globe.material.opts.emissiveIntensity, 1.1);
  assert.equal(base.material.opts.emissive, undefined);
  assert.equal(handleMesh.material.opts.emissive, undefined);

  for (const handle of ['maren', 'tomas']) {
    const prop = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    for (const child of prop.children) {
      assert.equal(child.material.opts.emissive, undefined, `${handle} prop must not have emissive`);
    }
  }
});

test('attachSeedDoorProp is deterministic: no randomness, no clock, identical repeats', async () => {
  const modSrc = await fs.readFile(MODULE_PATH, 'utf8');
  assert.ok(!/\bMath\.rand[o]m\b/.test(modSrc), 'seed-door-props.mjs must not use randomness');
  assert.ok(!/\bDate\b/.test(modSrc), 'seed-door-props.mjs must not use Date');
  assert.ok(!/\bcrypto\b/.test(modSrc), 'seed-door-props.mjs must not use crypto');

  const THREE = makeFakeThree();
  for (const handle of ['wick', 'maren', 'tomas']) {
    const first = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    const second = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    assert.deepEqual(serializeGroup(first), serializeGroup(second));
  }
});

test("door-prop kinds trace to each NPC's own record, as written", async () => {
  const plotsDir = path.join(__dirname, '..', 'town-npc', 'plots');
  const [wickNote, marenNote, tomasNote, marenManifestRaw, tomasManifestRaw] = await Promise.all([
    fs.readFile(path.join(plotsDir, 'wick', 'desk-note.html'), 'utf8'),
    fs.readFile(path.join(plotsDir, 'maren', 'desk-note.html'), 'utf8'),
    fs.readFile(path.join(plotsDir, 'tomas', 'desk-note.html'), 'utf8'),
    fs.readFile(path.join(plotsDir, 'maren', 'manifest.json'), 'utf8'),
    fs.readFile(path.join(plotsDir, 'tomas', 'manifest.json'), 'utf8'),
  ]);

  const marenKinds = JSON.parse(marenManifestRaw).props.map((p) => p.kind);
  const tomasKinds = JSON.parse(tomasManifestRaw).props.map((p) => p.kind);

  assert.match(wickNote, /\blamp\b/i);

  assert.ok(marenKinds.includes('typewriter'));
  assert.doesNotMatch(marenNote, /\btypewriter\b/i);
  assert.doesNotMatch(marenNote, /\blamp\b/i);

  assert.match(tomasNote, /\blamp\b/i);
  assert.match(tomasNote, /\bsamovar\b/i);
  assert.doesNotMatch(tomasNote, /\bteapot\b/i);
  assert.ok(tomasKinds.includes('tea_kettle'));
  assert.ok(!tomasKinds.includes('teapot'));
});

function makeRecordingThree() {
  const THREE = makeFakeThree();
  const BaseGroup = THREE.Group;
  THREE.Group = class RecordingGroup extends BaseGroup {
    constructor() {
      super();
      this.positionSetCalls = [];
      const origPosSet = this.position.set.bind(this.position);
      this.position.set = (...args) => {
        this.positionSetCalls.push(args);
        origPosSet(...args);
      };
      this.rotationSetCalls = [];
      this.rotation.set = (...args) => {
        this.rotationSetCalls.push(args);
      };
    }
  };
  return THREE;
}

test('invalid handle never reaches the builder', () => {
  const THREE = makeFakeThree();
  THREE.MeshStandardMaterial = class {
    constructor() {
      throw new Error('builder must not run');
    }
  };
  for (const handle of ['milo', 'lampmoth', '', 42, null, undefined]) {
    const cottage = new THREE.Group();
    const res = attachSeedDoorProp(THREE, cottage, handle);
    assert.equal(res, null);
    assert.equal(cottage.children.length, 0);
  }
  assert.throws(
    () => attachSeedDoorProp(THREE, new THREE.Group(), 'wick'),
    /builder must not run/
  );
});

test('attachSeedDoorProp rejects prototype keys, String objects, and object handles', () => {
  const THREE = makeFakeThree();
  for (const handle of ['hasOwnProperty', 'valueOf', '42', new String('wick'), {}, ['wick']]) {
    const cottage = new THREE.Group();
    const res = attachSeedDoorProp(THREE, cottage, handle);
    assert.equal(res, null, `expected null for handle ${String(handle)}`);
    assert.equal(cottage.children.length, 0);
  }
});

test('attachSeedDoorProp sets the prop position with exactly one set call', () => {
  const THREE = makeRecordingThree();
  for (const handle of ['wick', 'maren', 'tomas']) {
    const prop = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    assert.deepEqual(prop.positionSetCalls, [[-2.9, 0, 2.9]]);
  }
});

test('name, position, and rotation are set before cottage.add', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const origAdd = cottage.add.bind(cottage);
  const snapshots = [];
  cottage.add = (child) => {
    snapshots.push({
      name: child.name,
      x: child.position.x,
      y: child.position.y,
      z: child.position.z,
      rotY: child.rotation.y,
    });
    origAdd(child);
  };
  const prop = attachSeedDoorProp(THREE, cottage, 'maren');
  assert.deepEqual(snapshots, [
    { name: 'seed_door_prop_maren', x: -2.9, y: 0, z: 2.9, rotY: -0.6525 },
  ]);
  assert.equal(cottage.children[0], prop);
});

test('rotation is assigned directly, never via rotation.set', () => {
  const THREE = makeRecordingThree();
  for (const handle of ['wick', 'maren', 'tomas']) {
    const prop = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    assert.deepEqual(prop.rotationSetCalls, []);
    assert.equal(prop.rotation.x, 0);
    assert.equal(prop.rotation.z, 0);
  }
  const wickProp = attachSeedDoorProp(THREE, new THREE.Group(), 'wick');
  assert.equal(wickProp.rotation.y, -1.1733);
});

test("the builder receives the caller's THREE, not a cached one", () => {
  const THREE_A = makeFakeThree();
  const THREE_B = makeFakeThree();
  const a = attachSeedDoorProp(THREE_A, new THREE_A.Group(), 'wick');
  const b = attachSeedDoorProp(THREE_B, new THREE_B.Group(), 'wick');

  assert.ok(a instanceof THREE_A.Group);
  assert.ok(!(a instanceof THREE_B.Group));
  assert.ok(b instanceof THREE_B.Group);
  assert.ok(!(b instanceof THREE_A.Group));
  assert.ok(a.children[0] instanceof THREE_A.Mesh);
  assert.ok(b.children[0] instanceof THREE_B.Mesh);
  assert.ok(!(b.children[0] instanceof THREE_A.Mesh));
});

test('all three handles in one cottage keep attach order', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const pMaren = attachSeedDoorProp(THREE, cottage, 'maren');
  const pWick = attachSeedDoorProp(THREE, cottage, 'wick');
  const pTomas = attachSeedDoorProp(THREE, cottage, 'tomas');

  assert.deepEqual(cottage.children, [pMaren, pWick, pTomas]);
  assert.deepEqual(
    cottage.children.map((c) => c.name),
    ['seed_door_prop_maren', 'seed_door_prop_wick', 'seed_door_prop_tomas']
  );
  assert.deepEqual(
    cottage.children.map((c) => c.rotation.y),
    [-0.6525, -1.1733, -0.1322]
  );
  for (const prop of cottage.children) {
    assertPos(prop, -2.9, 0, 2.9);
  }
});

test('door prop clears the live porch deck laterally, derived from cottage-props.mjs', async () => {
  const { attachPorchDeck } = await import('./cottage-props.mjs');
  const THREE = makeFakeThree();
  const deck = attachPorchDeck(THREE, new THREE.Group());
  assert.deepEqual(deck.geometry.args, [4.8, 0.18, 1.2]);
  assertPos(deck, 0, 0.09, 2.9);

  const [w, h, d] = deck.geometry.args;
  const xRange = [deck.position.x - w / 2, deck.position.x + w / 2];
  const zRange = [deck.position.z - d / 2, deck.position.z + d / 2];
  const deckTopY = deck.position.y + h / 2;
  assert.deepEqual(xRange, [-2.4, 2.4]);
  assert.deepEqual(zRange, [2.3, 3.5]);
  assert.equal(deckTopY, 0.18);

  for (const handle of ['wick', 'maren', 'tomas']) {
    const prop = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    assert.ok(prop.position.x < xRange[0]);
    assert.ok(prop.position.z >= zRange[0] && prop.position.z <= zRange[1]);
    assert.equal(prop.position.y, 0);
    assert.ok(prop.position.y < deckTopY);
  }
});

test('a throwing cottage.add propagates and leaves prior children intact', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const existing = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#000000' })
  );
  cottage.add(existing);
  cottage.add = () => {
    throw new Error('add boom');
  };

  assert.throws(() => attachSeedDoorProp(THREE, cottage, 'wick'), /add boom/);
  assert.equal(cottage.children.length, 1);
  assert.equal(cottage.children[0], existing);
});

test('a duck-typed cottage works, with no instanceof gate', () => {
  const THREE = makeFakeThree();
  const added = [];
  const cottage = {
    children: [],
    add(child) {
      this.children.push(child);
      added.push(child);
    },
  };
  const prop = attachSeedDoorProp(THREE, cottage, 'tomas');
  assert.ok(prop);
  assert.equal(added.length, 1);
  assert.equal(added[0], prop);
  assert.equal(cottage.children[0], prop);
  assert.equal(prop.name, 'seed_door_prop_tomas');
});

test('town-3d/town.js PROP_PLACEMENTS full blocks pin coordinates, rotY, and GLB sizing fields', async () => {
  const townSrc = await fs.readFile(TOWN_JS_PATH, 'utf8');

  const wickMatch = townSrc.match(/\{[^}]*?id:\s*'wick_oil_lamp'[^}]*?\}/);
  assert.ok(wickMatch, 'expected wick_oil_lamp block in town-3d/town.js');
  for (const literal of ['x: 14.41,', 'z: -6.05,', 'rotY: -1.1733,', 'targetSize: 0.9,', "scaleAxis: 'y',"]) {
    assert.ok(wickMatch[0].includes(literal), `expected ${literal} in wick_oil_lamp block`);
  }

  const tomasMatch = townSrc.match(/\{[^}]*?id:\s*'tomas_teapot'[^}]*?\}/);
  assert.ok(tomasMatch, 'expected tomas_teapot block in town-3d/town.js');
  for (const literal of ['x: 2.06,', 'z: -15.49,', 'rotY: -0.1322,', 'targetSize: 0.9,', "scaleAxis: 'y',"]) {
    assert.ok(tomasMatch[0].includes(literal), `expected ${literal} in tomas_teapot block`);
  }

  const marenMatch = townSrc.match(/\{[^}]*?id:\s*'maren_typewriter'[^}]*?\}/);
  assert.ok(marenMatch, 'expected maren_typewriter block in town-3d/town.js');
  for (const literal of ['x: 9.49,', 'z: -12.42,', 'rotY: -0.6525,']) {
    assert.ok(marenMatch[0].includes(literal), `expected ${literal} in maren_typewriter block`);
  }
  assert.ok(!marenMatch[0].includes('targetSize'), 'maren_typewriter block must not have targetSize');
  assert.ok(!marenMatch[0].includes('scaleAxis'), 'maren_typewriter block must not have scaleAxis');
});

test('staging-derived live world positions, world-facing rotY, and ~0.9 m gap to town.js placements', () => {
  const THREE = makeFakeThree();
  // Exact gaps between staging-derived world positions and town.js PROP_PLACEMENTS:
  // wick: 0.9074 m, maren: 0.9028 m, tomas: 0.9100 m
  const expected = [
    {
      handle: 'wick',
      plotNumber: 2,
      plotX: 17.833,
      plotZ: -4.922,
      plotRotY: -1.3015,
      wx: 14.265966532668191,
      wz: -6.94592495980825,
      worldRotY: -2.4748,
      townX: 14.41,
      townZ: -6.05,
    },
    {
      handle: 'maren',
      plotNumber: 3,
      plotX: 13.023,
      plotZ: -13.14,
      plotRotY: -0.7809,
      wx: 8.921822160005313,
      wz: -13.121552107531894,
      worldRotY: -1.4334,
      townX: 9.49,
      townZ: -12.42,
    },
    {
      handle: 'tomas',
      plotNumber: 4,
      plotX: 4.761,
      plotZ: -17.877,
      plotRotY: -0.2603,
      wx: 1.2123185233939904,
      wz: -15.821067175807196,
      worldRotY: -0.39249999999999996,
      townX: 2.06,
      townZ: -15.49,
    },
  ];

  for (const spec of expected) {
    assert.equal(SEED_HOME_PADS[spec.handle], spec.plotNumber);
    const plot = TOWN_LAYOUT.plots.find((p) => p.plotNumber === SEED_HOME_PADS[spec.handle]);
    assert.ok(plot, `expected plot ${spec.plotNumber} for ${spec.handle}`);
    assert.equal(plot.x, spec.plotX);
    assert.equal(plot.z, spec.plotZ);
    assert.equal(plot.rotY, spec.plotRotY);

    const prop = attachSeedDoorProp(THREE, new THREE.Group(), spec.handle);
    const wx = plot.x + Math.cos(plot.rotY) * prop.position.x + Math.sin(plot.rotY) * prop.position.z;
    const wz = plot.z + -Math.sin(plot.rotY) * prop.position.x + Math.cos(plot.rotY) * prop.position.z;
    const worldRotY = plot.rotY + prop.rotation.y;

    assert.ok(Math.abs(wx - spec.wx) < 1e-9, `${spec.handle} wx drift: ${wx}`);
    assert.ok(Math.abs(wz - spec.wz) < 1e-9, `${spec.handle} wz drift: ${wz}`);
    assert.ok(Math.abs(worldRotY - spec.worldRotY) < 1e-9, `${spec.handle} worldRotY drift: ${worldRotY}`);

    const gap = Math.hypot(wx - spec.townX, wz - spec.townZ);
    assert.ok(gap > 0.8 && gap < 1, `${spec.handle} gap ${gap} expected in (0.8, 1)`);
  }
});

test('builders never name children; only the prop group is named', () => {
  const THREE = makeFakeThree();
  for (const handle of ['wick', 'maren', 'tomas']) {
    const prop = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    assert.equal(prop.name, `seed_door_prop_${handle}`);
    assert.equal(prop.children.length, 3);
    for (const child of prop.children) {
      assert.equal(child.name, '');
    }
  }
});

test('fresh materials per call and mutation independence at material level', () => {
  const THREE = makeFakeThree();
  const wickA = attachSeedDoorProp(THREE, new THREE.Group(), 'wick');
  const wickB = attachSeedDoorProp(THREE, new THREE.Group(), 'wick');
  assert.notEqual(wickA.children[0].material, wickB.children[0].material);
  assert.notEqual(wickA.children[1].material, wickB.children[1].material);
  wickA.children[0].material.color = '#000000';
  assert.equal(wickB.children[0].material.color, '#9a7b3e');

  const maren = attachSeedDoorProp(THREE, new THREE.Group(), 'maren');
  assert.notEqual(maren.children[0].material, maren.children[1].material);
  assert.notEqual(maren.children[0].material, maren.children[2].material);
  assert.notEqual(maren.children[1].material, maren.children[2].material);

  const tomasA = attachSeedDoorProp(THREE, new THREE.Group(), 'tomas');
  const tomasB = attachSeedDoorProp(THREE, new THREE.Group(), 'tomas');
  assert.notEqual(tomasA.children[0].material, tomasB.children[0].material);
});

test('child rotation table across all nine children', () => {
  const THREE = makeFakeThree();
  for (const handle of ['wick', 'tomas']) {
    const prop = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    for (const child of prop.children) {
      assert.deepEqual(child.rotation, { x: 0, y: 0, z: 0 });
    }
  }

  const maren = attachSeedDoorProp(THREE, new THREE.Group(), 'maren');
  const [stand, body, roller] = maren.children;
  assert.deepEqual(stand.rotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(body.rotation, { x: 0, y: 0, z: 0 });
  assert.equal(roller.rotation.x, 0);
  assert.equal(roller.rotation.y, 0);
  assert.ok(Math.abs(roller.rotation.z - Math.PI / 2) < 1e-12);
});

test('prop vertical extents sit flush at bottom 0 with exact tops under 0.5', () => {
  const THREE = makeFakeThree();
  const expectedTops = { wick: 0.38, maren: 0.33, tomas: 0.36 };

  for (const [handle, expectedTop] of Object.entries(expectedTops)) {
    const prop = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const child of prop.children) {
      const halfH = child.geometry.type === 'CylinderGeometry'
        ? (Math.abs(child.rotation.z - Math.PI / 2) < 1e-6
          ? Math.max(child.geometry.args[0], child.geometry.args[1])
          : child.geometry.args[2] / 2)
        : child.geometry.args[1] / 2;
      minY = Math.min(minY, child.position.y - halfH);
      maxY = Math.max(maxY, child.position.y + halfH);
    }
    assert.equal(minY, 0, `${handle} bottom must be 0`);
    assert.ok(Math.abs(maxY - expectedTop) < 1e-9, `${handle} top ${maxY} expected ${expectedTop}`);
    assert.ok(maxY < 0.5, `${handle} top must be < 0.5`);
  }
});

test('SEED_DOOR_PROPS source order, rotY literals, and builder order', async () => {
  const modSrc = await fs.readFile(MODULE_PATH, 'utf8');
  const propsMatch = modSrc.match(/const SEED_DOOR_PROPS = \{([\s\S]*?)\n\};/);
  assert.ok(propsMatch, 'expected SEED_DOOR_PROPS object literal in seed-door-props.mjs');

  const block = propsMatch[1];
  const keysInOrder = [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(keysInOrder, ['wick', 'maren', 'tomas']);

  for (const literal of ['rotY: -1.1733', 'rotY: -0.6525', 'rotY: -0.1322']) {
    assert.ok(block.includes(literal), `expected ${literal} in SEED_DOOR_PROPS`);
  }

  const lampIdx = block.indexOf('buildProceduralOilLamp');
  const typeIdx = block.indexOf('buildProceduralTypewriter');
  const teaIdx = block.indexOf('buildProceduralTeapot');
  assert.ok(lampIdx !== -1 && typeIdx !== -1 && teaIdx !== -1);
  assert.ok(lampIdx < typeIdx && typeIdx < teaIdx);
});

test('module header comment accuracy against live cottage-props.mjs and staging.js', async () => {
  const [modSrc, stagingSrc] = await Promise.all([
    fs.readFile(MODULE_PATH, 'utf8'),
    fs.readFile(path.join(__dirname, 'staging.js'), 'utf8'),
  ]);

  assert.ok(modSrc.includes('[-2.4, 2.4]'));
  assert.ok(modSrc.includes('[2.3, 3.5]'));
  assert.ok(modSrc.includes('(2.3, 0.18, 2.6)'));

  const { attachPorchDeck } = await import('./cottage-props.mjs');
  const THREE = makeFakeThree();
  const deck = attachPorchDeck(THREE, new THREE.Group());
  assert.deepEqual(deck.geometry.args, [4.8, 0.18, 1.2]);
  assertPos(deck, 0, 0.09, 2.9);
  assert.deepEqual(
    [deck.position.x - deck.geometry.args[0] / 2, deck.position.x + deck.geometry.args[0] / 2],
    [-2.4, 2.4]
  );
  assert.deepEqual(
    [deck.position.z - deck.geometry.args[2] / 2, deck.position.z + deck.geometry.args[2] / 2],
    [2.3, 3.5]
  );

  assert.ok(stagingSrc.includes('sign.position.set(2.3, 0.18, 2.6);'));
});

test('material opts exact key sets across all nine children', () => {
  const THREE = makeFakeThree();
  const wick = attachSeedDoorProp(THREE, new THREE.Group(), 'wick');
  assert.deepEqual(
    wick.children.map((c) => Object.keys(c.material.opts).sort()),
    [
      ['color', 'roughness'],
      ['color', 'emissive', 'emissiveIntensity'],
      ['color', 'roughness'],
    ]
  );
  assert.equal(wick.children[1].material.opts.roughness, undefined);

  const maren = attachSeedDoorProp(THREE, new THREE.Group(), 'maren');
  assert.deepEqual(
    maren.children.map((c) => Object.keys(c.material.opts).sort()),
    [
      ['color', 'roughness'],
      ['color', 'roughness'],
      ['color', 'roughness'],
    ]
  );

  const tomas = attachSeedDoorProp(THREE, new THREE.Group(), 'tomas');
  assert.deepEqual(
    tomas.children.map((c) => Object.keys(c.material.opts).sort()),
    [
      ['color', 'roughness'],
      ['color', 'roughness'],
      ['color', 'roughness'],
    ]
  );
});

test('single import and single call in staging.js, no town.js copy, and single import in module', async () => {
  const [stagingSrc, townSrc, modSrc] = await Promise.all([
    fs.readFile(path.join(__dirname, 'staging.js'), 'utf8'),
    fs.readFile(TOWN_JS_PATH, 'utf8'),
    fs.readFile(MODULE_PATH, 'utf8'),
  ]);

  const stagingImports = stagingSrc.match(
    /import\s*\{[^}]*attachSeedDoorProp[^}]*\}\s*from\s*'[^']*seed-door-props\.mjs[^']*';/g
  ) || [];
  assert.equal(stagingImports.length, 1);

  const callCount = stagingSrc.split('attachSeedDoorProp(THREE, cottage, handle);').length - 1;
  assert.equal(callCount, 1);

  assert.ok(!townSrc.includes('attachSeedDoorProp'), 'town-3d/town.js must not reference attachSeedDoorProp');

  const modImports = modSrc.match(/^import /gm) || [];
  assert.equal(modImports.length, 1);
});

test('door-prop horizontal footprints: exact x/z extents per prop', () => {
  const THREE = makeFakeThree();
  function footprint(prop) {
    let xMin = Infinity;
    let xMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const child of prop.children) {
      let hx;
      let hz;
      if (child.geometry.type === 'CylinderGeometry') {
        const [rt, rb, h] = child.geometry.args;
        const r = Math.max(rt, rb);
        if (Math.abs(child.rotation.z - Math.PI / 2) < 1e-6) {
          hx = h / 2;
          hz = r;
        } else {
          hx = r;
          hz = r;
        }
      } else {
        hx = child.geometry.args[0] / 2;
        hz = child.geometry.args[2] / 2;
      }
      xMin = Math.min(xMin, child.position.x - hx);
      xMax = Math.max(xMax, child.position.x + hx);
      zMin = Math.min(zMin, child.position.z - hz);
      zMax = Math.max(zMax, child.position.z + hz);
    }
    return { xMin, xMax, zMin, zMax };
  }
  assert.deepEqual(footprint(attachSeedDoorProp(THREE, new THREE.Group(), 'wick')), { xMin: -0.18, xMax: 0.18, zMin: -0.18, zMax: 0.18 });
  assert.deepEqual(footprint(attachSeedDoorProp(THREE, new THREE.Group(), 'maren')), { xMin: -0.35, xMax: 0.35, zMin: -0.275, zMax: 0.275 });
  assert.deepEqual(footprint(attachSeedDoorProp(THREE, new THREE.Group(), 'tomas')), { xMin: -0.2, xMax: 0.27, zMin: -0.2, zMax: 0.2 });
});

test('material color table: exact color per child across all nine children', () => {
  const THREE = makeFakeThree();
  const colors = {};
  for (const handle of ['wick', 'maren', 'tomas']) {
    colors[handle] = attachSeedDoorProp(THREE, new THREE.Group(), handle).children.map((c) => c.material.color);
  }
  assert.deepEqual(colors.wick, ['#9a7b3e', '#fff1c9', '#9a7b3e']);
  assert.deepEqual(colors.maren, ['#6b492b', '#2b2f33', '#d8d2c5']);
  assert.deepEqual(colors.tomas, ['#8f6b47', '#8f6b47', '#8f6b47']);
});

test('rotY spacing: near-equal steps, span, and sum', () => {
  const THREE = makeFakeThree();
  const rotY = {};
  for (const handle of ['wick', 'maren', 'tomas']) {
    rotY[handle] = attachSeedDoorProp(THREE, new THREE.Group(), handle).rotation.y;
  }
  assert.ok(Math.abs((rotY.wick - rotY.maren) - -0.5208) < 1e-9);
  assert.ok(Math.abs((rotY.maren - rotY.tomas) - -0.5203) < 1e-9);
  assert.ok(Math.abs((rotY.wick - rotY.tomas) - -1.0411) < 1e-9);
  assert.ok(Math.abs((rotY.wick + rotY.maren + rotY.tomas) - -1.958) < 1e-9);
});

test('interior dressing reuses the same builders: hidden groups on the desk-top slot', async () => {
  const { buildInteriorRoom } = await import('./interior-room.mjs');
  const THREE = makeFakeThree();
  THREE.ConeGeometry = class ConeGeometry {
    constructor(r, h, seg) {
      this.type = 'ConeGeometry';
      this.args = [r, h, seg];
    }
  };
  const room = buildInteriorRoom(THREE);
  assert.equal(room.children.length, 19);
  function serializeChildren(group) {
    return group.children.map((child) => ({
      type: child.geometry.type,
      args: [...child.geometry.args],
      color: child.material.color,
      opts: { ...child.material.opts },
      pos: [child.position.x, child.position.y, child.position.z],
      rot: [child.rotation.x, child.rotation.y, child.rotation.z],
    }));
  }
  for (const handle of ['wick', 'maren', 'tomas']) {
    const dressing = room.children.find((c) => c && c.name === `interior_dressing_${handle}`);
    assert.ok(dressing, `expected interior_dressing_${handle} in the room`);
    assert.equal(dressing.visible, false);
    assert.equal(dressing.position.x, -0.8);
    assert.ok(Math.abs(dressing.position.y - 0.8) < 1e-9);
    assert.equal(dressing.position.z, -0.85);
    const door = attachSeedDoorProp(THREE, new THREE.Group(), handle);
    assert.deepEqual(serializeChildren(dressing), serializeChildren(door));
  }
});

test('geometry type table: exact type per child across all nine children', () => {
  const THREE = makeFakeThree();
  const types = {};
  for (const handle of ['wick', 'maren', 'tomas']) {
    types[handle] = attachSeedDoorProp(THREE, new THREE.Group(), handle).children.map((c) => c.geometry.type);
  }
  assert.deepEqual(types.wick, ['CylinderGeometry', 'CylinderGeometry', 'BoxGeometry']);
  assert.deepEqual(types.maren, ['BoxGeometry', 'BoxGeometry', 'CylinderGeometry']);
  assert.deepEqual(types.tomas, ['CylinderGeometry', 'BoxGeometry', 'CylinderGeometry']);
});

test('material sharing matrix: wick shares brass, maren shares nothing, tomas shares all', () => {
  const THREE = makeFakeThree();
  const wick = attachSeedDoorProp(THREE, new THREE.Group(), 'wick');
  assert.equal(wick.children[0].material, wick.children[2].material);
  assert.notEqual(wick.children[0].material, wick.children[1].material);
  assert.notEqual(wick.children[1].material, wick.children[2].material);
  const maren = attachSeedDoorProp(THREE, new THREE.Group(), 'maren');
  assert.notEqual(maren.children[0].material, maren.children[1].material);
  assert.notEqual(maren.children[0].material, maren.children[2].material);
  assert.notEqual(maren.children[1].material, maren.children[2].material);
  const tomas = attachSeedDoorProp(THREE, new THREE.Group(), 'tomas');
  assert.equal(tomas.children[0].material, tomas.children[1].material);
  assert.equal(tomas.children[1].material, tomas.children[2].material);
  assert.equal(tomas.children[0].material, tomas.children[2].material);
});

test('attachSeedDoorProp rejects whitespace, control-char, and lookalike string handles', () => {
  const THREE = makeFakeThree();
  for (const handle of ['\twick', 'wick\n', 'wick\u0000', 'WICK', 'Wick ', ' wick\t', 'wick/wick', 'wick.wick']) {
    const cottage = new THREE.Group();
    const res = attachSeedDoorProp(THREE, cottage, handle);
    assert.equal(res, null, `expected null for handle ${JSON.stringify(handle)}`);
    assert.equal(cottage.children.length, 0);
  }
});

test('per-child vertical extents: exact bottom/top per child', () => {
  const THREE = makeFakeThree();
  function vExtent(child) {
    let halfH;
    if (child.geometry.type === 'CylinderGeometry') {
      halfH = Math.abs(child.rotation.z - Math.PI / 2) < 1e-6
        ? Math.max(child.geometry.args[0], child.geometry.args[1])
        : child.geometry.args[2] / 2;
    } else {
      halfH = child.geometry.args[1] / 2;
    }
    return [child.position.y - halfH, child.position.y + halfH];
  }
  function assertExtents(actual, expected, label) {
    assert.equal(actual.length, expected.length, `${label} child count`);
    for (let i = 0; i < expected.length; i++) {
      assert.ok(Math.abs(actual[i][0] - expected[i][0]) < 1e-9, `${label} child ${i} bottom ${actual[i][0]} expected ${expected[i][0]}`);
      assert.ok(Math.abs(actual[i][1] - expected[i][1]) < 1e-9, `${label} child ${i} top ${actual[i][1]} expected ${expected[i][1]}`);
    }
  }
  assertExtents(attachSeedDoorProp(THREE, new THREE.Group(), 'wick').children.map(vExtent), [[0, 0.14], [0.14, 0.38], [0.13, 0.31]], 'wick');
  assertExtents(attachSeedDoorProp(THREE, new THREE.Group(), 'maren').children.map(vExtent), [[0, 0.08], [0.08, 0.26], [0.23, 0.33]], 'maren');
  assertExtents(attachSeedDoorProp(THREE, new THREE.Group(), 'tomas').children.map(vExtent), [[0, 0.28], [0.155, 0.205], [0.28, 0.36]], 'tomas');
});

test('manifest prop kinds are exact per seed, and no manifest carries a door-prop kind', async () => {
  const plotsDir = path.join(__dirname, '..', 'town-npc', 'plots');
  const kinds = {};
  for (const handle of ['wick', 'maren', 'tomas']) {
    const raw = await fs.readFile(path.join(plotsDir, handle, 'manifest.json'), 'utf8');
    kinds[handle] = JSON.parse(raw).props.map((p) => p.kind);
  }
  assert.deepEqual(kinds.wick, ['desk', 'rug', 'poster_frame']);
  assert.deepEqual(kinds.maren, ['desk', 'typewriter', 'bookshelf', 'poster_frame']);
  assert.deepEqual(kinds.tomas, ['rug', 'bookshelf', 'tea_kettle', 'cat']);
  for (const handle of ['wick', 'maren', 'tomas']) {
    assert.ok(!kinds[handle].includes('oil_lamp'), `${handle} manifest must not carry oil_lamp`);
    assert.ok(!kinds[handle].includes('teapot'), `${handle} manifest must not carry teapot`);
  }
});

test('file hygiene: 53 tests, 8 imports, no banned literals', async () => {
  const [modSrc, selfSrc] = await Promise.all([
    fs.readFile(MODULE_PATH, 'utf8'),
    fs.readFile(SELF_PATH, 'utf8'),
  ]);
  const names = [...selfSrc.matchAll(/^test\(['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.equal(names.length, 53);
  assert.equal(new Set(names).size, 53);
  const importLines = [...selfSrc.matchAll(/^import .*$/gm)].map((m) => m[0]);
  assert.deepEqual(importLines, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { attachSeedDoorProp } from './seed-door-props.mjs';",
    "import { CHARACTERS } from '../town-npc/characters.mjs';",
    "import { TOWN_LAYOUT, SEED_HOME_PADS } from './avatar.mjs';",
  ]);
  function count(src, lit) {
    return src.split(lit).length - 1;
  }
  const banned = 'camp' + '[f]ire';
  assert.equal((modSrc.match(new RegExp(banned, 'g')) || []).length, 0);
  assert.equal((selfSrc.match(new RegExp(banned, 'g')) || []).length, 0);
  const fetchLit = 'fet' + 'ch(';
  assert.equal(count(modSrc, fetchLit), 0);
  assert.equal(count(selfSrc, fetchLit), 2);
  const randomLit = 'Math.rand' + 'om';
  assert.equal(count(modSrc, randomLit), 0);
  assert.equal(count(selfSrc, randomLit), 0);
  const nowLit = 'Date.' + 'now';
  assert.equal(count(modSrc, nowLit), 0);
  assert.equal(count(selfSrc, nowLit), 0);
  const todoLit = 'TO' + 'DO';
  assert.equal(count(modSrc, todoLit), 0);
  assert.equal(count(selfSrc, todoLit), 0);
  const fixmeLit = 'FIX' + 'ME';
  assert.equal(count(modSrc, fixmeLit), 0);
  assert.equal(count(selfSrc, fixmeLit), 0);
  for (const lit of ['100.10' + '5', '81' + '23', '81' + '24', '81' + '25']) {
    assert.equal(count(modSrc, lit), 0, `module must not contain ${lit}`);
    assert.equal(count(selfSrc, lit), 0, `test file must not contain ${lit}`);
  }
});
