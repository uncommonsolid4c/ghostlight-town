import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachSeedDoorProp } from './seed-door-props.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELF_PATH = fileURLToPath(import.meta.url);
const MODULE_PATH = path.join(__dirname, 'seed-door-props.mjs');

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
