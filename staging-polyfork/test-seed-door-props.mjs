import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachSeedDoorProp } from './seed-door-props.mjs';
import { CHARACTERS } from '../town-npc/characters.mjs';

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
