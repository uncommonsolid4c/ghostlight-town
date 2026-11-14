import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildProp,
  MILO_PLOT_PROPS,
  attachPlotProps,
} from './cottage-props.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

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
  class ConeGeometry {
    constructor(r, h, seg) {
      this.type = 'ConeGeometry';
      this.args = [r, h, seg];
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
      this.children = [];
    }
    add(child) {
      this.children.push(child);
    }
  }
  return {
    BoxGeometry,
    CylinderGeometry,
    ConeGeometry,
    MeshStandardMaterial,
    Mesh,
    Group,
  };
}

test('buildProp builds desk, tea_kettle, and cat with expected geometry, position, rotation, name, and color', () => {
  const THREE = makeFakeThree();

  const desk = buildProp(THREE, MILO_PLOT_PROPS[0]);
  assert.ok(desk);
  assert.equal(desk.name, 'prop_desk');
  assert.equal(desk.geometry.type, 'BoxGeometry');
  assert.deepEqual(desk.geometry.args, [1.1, 0.72, 0.6]);
  assert.equal(desk.position.x, -1.2);
  assert.equal(desk.position.y, 0.36);
  assert.equal(desk.position.z, 2.2);
  assert.ok(Math.abs(desk.rotation.y - Math.PI) < 1e-12);
  assert.equal(desk.material.color, '#7a5230');

  const kettle = buildProp(THREE, MILO_PLOT_PROPS[1]);
  assert.ok(kettle);
  assert.equal(kettle.name, 'prop_tea_kettle');
  assert.equal(kettle.geometry.type, 'CylinderGeometry');
  assert.deepEqual(kettle.geometry.args, [0.14, 0.18, 0.24, 8]);
  assert.equal(kettle.position.x, -1.0);
  assert.ok(Math.abs(kettle.position.y - (0.78 + 0.12)) < 1e-12);
  assert.equal(kettle.position.z, 2.2);
  assert.ok(Math.abs(kettle.rotation.y - (45 * Math.PI) / 180) < 1e-12);
  assert.equal(kettle.material.color, '#b87333');

  const cat = buildProp(THREE, MILO_PLOT_PROPS[2]);
  assert.ok(cat);
  assert.equal(cat.name, 'prop_cat');
  assert.equal(cat.geometry.type, 'ConeGeometry');
  assert.deepEqual(cat.geometry.args, [0.16, 0.36, 6]);
  assert.equal(cat.position.x, 1.3);
  assert.equal(cat.position.y, 0.18);
  assert.equal(cat.position.z, 2.1);
  assert.ok(Math.abs(cat.rotation.y - (210 * Math.PI) / 180) < 1e-12);
  assert.equal(cat.material.color, '#2b2b2b');
});

test('buildProp rejects unknown kind and out-of-range coordinates, and falls back on bad color', () => {
  const THREE = makeFakeThree();

  assert.equal(buildProp(THREE, { kind: 'piano', x: 0, y: 0, z: 0, rot_y: 0, color: '#ffffff' }), null);
  assert.equal(buildProp(THREE, { kind: 'desk', x: 13, y: 0, z: 0, rot_y: 0, color: '#ffffff' }), null);
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: -13, z: 0, rot_y: 0, color: '#ffffff' }), null);
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 0, rot_y: 360, color: '#ffffff' }), null);

  const fallbackMesh = buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0, color: 'not-a-hex' });
  assert.ok(fallbackMesh);
  assert.equal(fallbackMesh.material.color, '#8a6240');
});

test('MILO_PLOT_PROPS deep-equals props in town-npc/plots/milo/manifest.json', async () => {
  const raw = await fs.readFile(path.join(REPO_ROOT, 'town-npc', 'plots', 'milo', 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  assert.deepEqual(MILO_PLOT_PROPS, manifest.props);
});

test('buildProp and helpers in cottage-props.mjs match town-3d/town.js verbatim', async () => {
  const [townSrc, propsSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'cottage-props.mjs'), 'utf8'),
  ]);

  const helperMarker = 'const VALID_PROP_KINDS = new Set([';
  const helperStart = townSrc.indexOf(helperMarker);
  assert.ok(helperStart !== -1, 'Could not locate VALID_PROP_KINDS in town-3d/town.js');
  const helperEndMarker = 'function safeColor(hex, fallback) {\n  return typeof hex === \'string\' && HEX_COLOR_RE.test(hex) ? hex : fallback;\n}';
  const helperEnd = townSrc.indexOf(helperEndMarker, helperStart);
  assert.ok(helperEnd !== -1, 'Could not locate safeColor end in town-3d/town.js');
  const helpersBlock = townSrc.slice(helperStart, helperEnd + helperEndMarker.length);
  assert.ok(
    propsSrc.includes(helpersBlock),
    'staging-polyfork/cottage-props.mjs VALID_PROP_KINDS/HEX_COLOR_RE/safeColor drifted from town-3d/town.js'
  );

  const fnMarker = 'function buildProp(THREE, prop) {';
  const fnStart = townSrc.indexOf(fnMarker);
  assert.ok(fnStart !== -1, 'Could not locate buildProp in town-3d/town.js');
  const fnEndMarker = '\n}\n';
  const fnEnd = townSrc.indexOf(fnEndMarker, fnStart);
  assert.ok(fnEnd !== -1, 'Could not locate end of buildProp in town-3d/town.js');
  const verbatimBlock = townSrc.slice(fnStart, fnEnd + fnEndMarker.length);
  assert.ok(
    propsSrc.includes(verbatimBlock),
    'staging-polyfork/cottage-props.mjs buildProp drifted from town-3d/town.js'
  );
});

test('attachPlotProps attaches valid props and skips invalid ones', () => {
  const THREE = makeFakeThree();

  const cottage = new THREE.Group();
  const count = attachPlotProps(THREE, cottage, MILO_PLOT_PROPS);
  assert.equal(count, 3);
  assert.equal(cottage.children.length, 3);

  const mixedCottage = new THREE.Group();
  const mixedCount = attachPlotProps(THREE, mixedCottage, [
    MILO_PLOT_PROPS[0],
    { kind: 'invalid_prop', x: 0, y: 0, z: 0, rot_y: 0, color: '#000000' },
    MILO_PLOT_PROPS[2],
  ]);
  assert.equal(mixedCount, 2);
  assert.equal(mixedCottage.children.length, 2);
});

test('staging.js wires attachPlotProps(THREE, milosCottage, MILO_PLOT_PROPS) after signpost add', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const signAddIdx = stagingSrc.indexOf('milosCottage.add(sign);');
  const propsCallIdx = stagingSrc.indexOf('attachPlotProps(THREE, milosCottage, MILO_PLOT_PROPS);');
  assert.ok(signAddIdx !== -1, 'Expected milosCottage.add(sign); in staging.js');
  assert.ok(propsCallIdx !== -1, 'Expected attachPlotProps(THREE, milosCottage, MILO_PLOT_PROPS); in staging.js');
  assert.ok(propsCallIdx > signAddIdx, 'attachPlotProps must be called after milosCottage.add(sign)');
});

test('cottage-props.mjs contains no fetch( literal and no .glb reference', async () => {
  const propsSrc = await fs.readFile(path.join(__dirname, 'cottage-props.mjs'), 'utf8');
  assert.equal(propsSrc.includes('fetch('), false, 'cottage-props.mjs must not contain fetch(');
  assert.equal(propsSrc.includes('.glb'), false, 'cottage-props.mjs must not contain .glb');
});
