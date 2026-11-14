import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VALID_PROP_KINDS,
  buildProp,
  MILO_PLOT_PROPS,
  attachPlotProps,
  attachPorchDeck,
  attachPorchTrim,
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
  assert.ok(Math.abs(desk.position.y - (0.18 + 0.36)) < 1e-12);
  assert.equal(desk.position.z, 2.2);
  assert.ok(Math.abs(desk.rotation.y - Math.PI) < 1e-12);
  assert.equal(desk.material.color, '#7a5230');

  const kettle = buildProp(THREE, MILO_PLOT_PROPS[1]);
  assert.ok(kettle);
  assert.equal(kettle.name, 'prop_tea_kettle');
  assert.equal(kettle.geometry.type, 'CylinderGeometry');
  assert.deepEqual(kettle.geometry.args, [0.14, 0.18, 0.24, 8]);
  assert.equal(kettle.position.x, -1.0);
  assert.ok(Math.abs(kettle.position.y - (0.78 + 0.18 + 0.12)) < 1e-12);
  assert.equal(kettle.position.z, 2.2);
  assert.ok(Math.abs(kettle.rotation.y - (45 * Math.PI) / 180) < 1e-12);
  assert.equal(kettle.material.color, '#b87333');

  const cat = buildProp(THREE, MILO_PLOT_PROPS[2]);
  assert.ok(cat);
  assert.equal(cat.name, 'prop_cat');
  assert.equal(cat.geometry.type, 'ConeGeometry');
  assert.deepEqual(cat.geometry.args, [0.16, 0.36, 6]);
  assert.equal(cat.position.x, 1.3);
  assert.ok(Math.abs(cat.position.y - (0.18 + 0.18)) < 1e-12);
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

test('attachPlotProps attaches wick/maren/tomas manifest props with expected counts, names, colors, and valid kinds', async () => {
  const THREE = makeFakeThree();
  const expectedCounts = { wick: 3, maren: 4, tomas: 4 };

  for (const [handle, expectedCount] of Object.entries(expectedCounts)) {
    const raw = await fs.readFile(path.join(REPO_ROOT, 'town-npc', 'plots', handle, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    assert.equal(manifest.props.length, expectedCount, `${handle} manifest props length`);

    for (const prop of manifest.props) {
      assert.ok(VALID_PROP_KINDS.has(prop.kind), `${handle} prop kind ${prop.kind} must be in VALID_PROP_KINDS`);
    }

    const cottage = new THREE.Group();
    const attached = attachPlotProps(THREE, cottage, manifest.props);
    assert.equal(attached, expectedCount, `${handle} attached count`);
    assert.equal(cottage.children.length, expectedCount, `${handle} children count`);

    for (let i = 0; i < manifest.props.length; i++) {
      assert.equal(cottage.children[i].name, `prop_${manifest.props[i].kind}`);
      assert.equal(cottage.children[i].material.color, manifest.props[i].color);
    }
  }
});

test('attachPlotProps skips an invalid prop mixed into Maren manifest props', async () => {
  const THREE = makeFakeThree();
  const raw = await fs.readFile(path.join(REPO_ROOT, 'town-npc', 'plots', 'maren', 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);

  const cottage = new THREE.Group();
  const mixedProps = [
    manifest.props[0],
    { kind: 'invalid_prop', x: 0, y: 0, z: 0, rot_y: 0, color: '#000000' },
    ...manifest.props.slice(1),
  ];
  const attached = attachPlotProps(THREE, cottage, mixedProps);
  assert.equal(attached, 4);
  assert.equal(cottage.children.length, 4);
});

test('buildProp remaps interior z onto porch band [2.05, 3.45] and lifts porch props by PORCH_FLOOR_Y=0.18 while preserving x, rot_y, and stacking', () => {
  const THREE = makeFakeThree();
  const cases = [
    { label: 'interior door boundary z=2.0', prop: { kind: 'desk', x: -0.5, y: 0, z: 2.0, rot_y: 90 }, expectedZ: 2.05, expectedY: 0.54 },
    { label: 'back wall boundary z=-2.0', prop: { kind: 'desk', x: 0.5, y: 0, z: -2.0, rot_y: 0 }, expectedZ: 3.45, expectedY: 0.54 },
    { label: 'center z=0', prop: { kind: 'bookshelf', x: 0, y: 0, z: 0, rot_y: 90 }, expectedZ: 2.75, expectedY: 0.88 },
    { label: 'Wick desk z=-0.6', prop: { kind: 'desk', x: -1.0, y: 0, z: -0.6, rot_y: 0 }, expectedZ: 2.96, expectedY: 0.54 },
    { label: 'Maren desk z=-0.5', prop: { kind: 'desk', x: -0.9, y: 0, z: -0.5, rot_y: 0 }, expectedZ: 2.925, expectedY: 0.54 },
    { label: 'Maren typewriter z=-0.5', prop: { kind: 'typewriter', x: -0.9, y: 0.72, z: -0.5, rot_y: 0 }, expectedZ: 2.925, expectedY: 0.99 },
    { label: 'Wick rug z=0.9', prop: { kind: 'rug', x: 0, y: 0, z: 0.9, rot_y: 0 }, expectedZ: 2.435, expectedY: 0.20 },
    { label: 'Tomas rug z=0.3', prop: { kind: 'rug', x: 0, y: 0, z: 0.3, rot_y: 0 }, expectedZ: 2.645, expectedY: 0.20 },
    { label: 'poster_frame y=0.3', prop: { kind: 'poster_frame', x: 1.1, y: 0.3, z: -1.4, rot_y: 0 }, expectedZ: 3.24, expectedY: 1.38 },
    { label: 'clamped z=-12', prop: { kind: 'cat', x: 1.1, y: 0, z: -12, rot_y: 45 }, expectedZ: 3.45, expectedY: 0.36 },
    { label: 'pass-through boundary z=2.05', prop: { kind: 'tea_kettle', x: 0.4, y: 0.5, z: 2.05, rot_y: 180 }, expectedZ: 2.05, expectedY: 0.80 },
  ];

  for (const c of cases) {
    const mesh = buildProp(THREE, c.prop);
    assert.ok(mesh, c.label);
    assert.equal(mesh.position.x, c.prop.x, `${c.label} x unchanged`);
    assert.ok(Math.abs(mesh.position.y - c.expectedY) < 1e-12, `${c.label} y=${mesh.position.y} expected ${c.expectedY}`);
    assert.ok(Math.abs(mesh.position.z - c.expectedZ) < 1e-12, `${c.label} z=${mesh.position.z} expected ${c.expectedZ}`);
    assert.ok(Math.abs(mesh.rotation.y - (c.prop.rot_y * Math.PI) / 180) < 1e-12, `${c.label} rot_y unchanged`);
  }

  // Maren's desk + typewriter share z=-0.5 and stay stacked flush on the porch (typewriter bottom = 0.90 = desk top)
  const marenDesk = buildProp(THREE, cases[4].prop);
  const marenTypewriter = buildProp(THREE, cases[5].prop);
  assert.equal(marenDesk.position.z, marenTypewriter.position.z);
  assert.equal(marenDesk.position.x, marenTypewriter.position.x);
  assert.ok(Math.abs((marenDesk.position.y + 0.36) - (marenTypewriter.position.y - 0.09)) < 1e-12);
});

test('attachPorchDeck attaches wooden porch deck slab at top y=0.18, z in [2.3, 3.5], width 4.8, #6b492b', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const deck = attachPorchDeck(THREE, cottage);
  assert.ok(deck);
  assert.equal(cottage.children.length, 1);
  assert.equal(deck.name, 'cottage_porch_deck');
  assert.equal(deck.geometry.type, 'BoxGeometry');
  assert.deepEqual(deck.geometry.args, [4.8, 0.18, 1.2]);
  assert.ok(Math.abs(deck.position.x) < 1e-12);
  assert.ok(Math.abs(deck.position.y + 0.09 - 0.18) < 1e-12, 'deck top y = 0.18');
  assert.ok(Math.abs(deck.position.z - 0.6 - 2.3) < 1e-12, 'deck z starts at 2.3');
  assert.ok(Math.abs(deck.position.z + 0.6 - 3.5) < 1e-12, 'deck z ends at 3.5');
  assert.equal(deck.material.color, '#6b492b');
});

test('staging buildPorchTrim matches town-3d/town.js verbatim (no drift)', async () => {
  const [townSrc, propsSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'cottage-props.mjs'), 'utf8'),
  ]);

  const fnMarker = 'function buildPorchTrim(THREE) {';
  const fnStart = townSrc.indexOf(fnMarker);
  assert.ok(fnStart !== -1, 'Could not locate buildPorchTrim in town-3d/town.js');
  const fnEndMarker = '\n}\n';
  const fnEnd = townSrc.indexOf(fnEndMarker, fnStart);
  assert.ok(fnEnd !== -1, 'Could not locate end of buildPorchTrim in town-3d/town.js');
  const verbatimBlock = townSrc.slice(fnStart, fnEnd + fnEndMarker.length);
  assert.ok(
    propsSrc.includes(verbatimBlock),
    'staging-polyfork/cottage-props.mjs buildPorchTrim drifted from town-3d/town.js'
  );
});

test('attachPorchTrim attaches 2 posts (bottom 0.18, top 2.0, x ±2.3, z 3.44) + 1 step (top 0.09, x ±0.6, z 3.5..3.8), #6b492b', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const trim = attachPorchTrim(THREE, cottage);
  assert.ok(trim);
  assert.equal(cottage.children.length, 1);
  assert.equal(trim.name, 'cottage_porch_trim');
  assert.equal(trim.children.length, 3, 'trim must contain exactly 3 meshes');

  const posts = trim.children
    .filter((c) => c.name === 'cottage_porch_post')
    .sort((a, b) => a.position.x - b.position.x);
  assert.equal(posts.length, 2);
  for (const [idx, expectedX] of [[0, -2.3], [1, 2.3]]) {
    const post = posts[idx];
    assert.equal(post.geometry.type, 'BoxGeometry');
    assert.deepEqual(post.geometry.args, [0.12, 1.82, 0.12]);
    assert.equal(post.material.color, '#6b492b');
    assert.ok(Math.abs(post.position.x - expectedX) < 1e-12, `post x = ${expectedX}`);
    assert.ok(Math.abs(post.position.y - 1.09) < 1e-12, 'post center y = 1.09');
    assert.ok(Math.abs(post.position.y - 0.91 - 0.18) < 1e-12, 'post bottom y = 0.18');
    assert.ok(Math.abs(post.position.y + 0.91 - 2.0) < 1e-12, 'post top y = 2.0');
    assert.ok(Math.abs(post.position.z - 3.44) < 1e-12, 'post z = 3.44');
  }

  const steps = trim.children.filter((c) => c.name === 'cottage_porch_step');
  assert.equal(steps.length, 1);
  const step = steps[0];
  assert.equal(step.geometry.type, 'BoxGeometry');
  assert.deepEqual(step.geometry.args, [1.2, 0.09, 0.3]);
  assert.equal(step.material.color, '#6b492b');
  assert.ok(Math.abs(step.position.x) < 1e-12, 'step x = 0');
  assert.ok(Math.abs(step.position.x - 0.6 - (-0.6)) < 1e-12, 'step x min = -0.6');
  assert.ok(Math.abs(step.position.x + 0.6 - 0.6) < 1e-12, 'step x max = 0.6');
  assert.ok(Math.abs(step.position.y + 0.045 - 0.09) < 1e-12, 'step top y = 0.09');
  assert.ok(Math.abs(step.position.z - 0.15 - 3.5) < 1e-12, 'step z starts at 3.5');
  assert.ok(Math.abs(step.position.z + 0.15 - 3.8) < 1e-12, 'step z ends at 3.8');
});

test('staging.js wires attachPorchTrim at both cottage sites', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  assert.ok(stagingSrc.includes('attachPorchTrim(THREE, cottage);'), 'missing attachPorchTrim in applyStagingPlotManifest');
  assert.ok(stagingSrc.includes('attachPorchTrim(THREE, milosCottage);'), 'missing attachPorchTrim for milosCottage');
});
