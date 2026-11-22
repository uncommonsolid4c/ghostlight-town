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

test('attachPorchTrim attaches 2 posts, 1 step, 2 front rails, and 2 balusters, #6b492b', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  const trim = attachPorchTrim(THREE, cottage);
  assert.ok(trim);
  assert.equal(cottage.children.length, 1);
  assert.equal(trim.name, 'cottage_porch_trim');
  assert.equal(trim.children.length, 7, 'trim must contain exactly 7 meshes');

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

  const rails = trim.children
    .filter((c) => c.name === 'cottage_porch_rail')
    .sort((a, b) => a.position.x - b.position.x);
  assert.equal(rails.length, 2);
  for (const [idx, expectedX, xMin, xMax] of [[0, -1.5, -2.3, -0.7], [1, 1.5, 0.7, 2.3]]) {
    const rail = rails[idx];
    assert.equal(rail.geometry.type, 'BoxGeometry');
    assert.deepEqual(rail.geometry.args, [1.6, 0.08, 0.08]);
    assert.equal(rail.material.color, '#6b492b');
    assert.ok(Math.abs(rail.position.x - expectedX) < 1e-12, `rail x = ${expectedX}`);
    assert.ok(Math.abs(rail.position.x - 0.8 - xMin) < 1e-12, `rail x min = ${xMin}`);
    assert.ok(Math.abs(rail.position.x + 0.8 - xMax) < 1e-12, `rail x max = ${xMax}`);
    assert.ok(Math.abs(rail.position.y - 0.95) < 1e-12, 'rail center y = 0.95');
    assert.ok(Math.abs(rail.position.y - 0.04 - 0.91) < 1e-12, 'rail underside y = 0.91');
    assert.ok(Math.abs(rail.position.y + 0.04 - 0.99) < 1e-12, 'rail top y = 0.99');
    assert.ok(Math.abs(rail.position.z - 3.44) < 1e-12, 'rail z = 3.44');
  }
  assert.ok(Math.abs((rails[1].position.x - 0.8) - (rails[0].position.x + 0.8) - 1.4) < 1e-12, 'rail gap = 1.4');

  const balusters = trim.children
    .filter((c) => c.name === 'cottage_porch_baluster')
    .sort((a, b) => a.position.x - b.position.x);
  assert.equal(balusters.length, 2);
  for (const [idx, expectedX] of [[0, -1.5], [1, 1.5]]) {
    const baluster = balusters[idx];
    assert.equal(baluster.geometry.type, 'BoxGeometry');
    assert.deepEqual(baluster.geometry.args, [0.05, 0.73, 0.05]);
    assert.equal(baluster.material.color, '#6b492b');
    assert.ok(Math.abs(baluster.position.x - expectedX) < 1e-12, `baluster x = ${expectedX}`);
    assert.ok(Math.abs(baluster.position.y - 0.545) < 1e-12, 'baluster center y = 0.545');
    assert.ok(Math.abs(baluster.position.y - 0.365 - 0.18) < 1e-12, 'baluster bottom y = 0.18');
    assert.ok(Math.abs(baluster.position.y + 0.365 - 0.91) < 1e-12, 'baluster top y = 0.91');
    assert.ok(Math.abs(baluster.position.z - 3.44) < 1e-12, 'baluster z = 3.44');
  }
});

test('staging.js wires attachPorchTrim at both cottage sites', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  assert.ok(stagingSrc.includes('attachPorchTrim(THREE, cottage);'), 'missing attachPorchTrim in applyStagingPlotManifest');
  assert.ok(stagingSrc.includes('attachPorchTrim(THREE, milosCottage);'), 'missing attachPorchTrim for milosCottage');
});

test('Slice 93: buildProp builds lantern and planter groups with worked child geometry, porch remap, tinting, and fallback', () => {
  const THREE = makeFakeThree();
  assert.equal(VALID_PROP_KINDS.has('lantern'), true);
  assert.equal(VALID_PROP_KINDS.has('planter'), true);

  const lantern = buildProp(THREE, {
    kind: 'lantern',
    x: -1.8,
    y: 0,
    z: 0,
    rot_y: 90,
    color: '#6b492b',
  });
  assert.ok(lantern);
  assert.equal(lantern.name, 'prop_lantern');
  assert.equal(lantern.position.x, -1.8);
  assert.ok(Math.abs(lantern.position.y - 0.18) < 1e-12);
  assert.ok(lantern.position.z >= 2.05 && lantern.position.z <= 3.45);
  assert.ok(Math.abs(lantern.position.z - 2.75) < 1e-12);
  assert.ok(Math.abs(lantern.rotation.y - Math.PI / 2) < 1e-12);
  assert.equal(lantern.children.length, 3);

  const post = lantern.children.find((c) => c.name === 'prop_lantern_post');
  assert.ok(post);
  assert.equal(post.geometry.type, 'BoxGeometry');
  assert.deepEqual(post.geometry.args, [0.08, 0.9, 0.08]);
  assert.equal(post.material.color, '#6b492b');
  assert.equal(post.position.x, 0);
  assert.equal(post.position.y, 0.45);
  assert.equal(post.position.z, 0);

  const glass = lantern.children.find((c) => c.name === 'prop_lantern_glass');
  assert.ok(glass);
  assert.equal(glass.geometry.type, 'BoxGeometry');
  assert.deepEqual(glass.geometry.args, [0.16, 0.24, 0.16]);
  assert.equal(glass.material.color, '#ffbe5c');
  assert.equal(glass.material.opts.emissive, '#ffbe5c');
  assert.equal(glass.material.opts.emissiveIntensity, 1.4);
  assert.equal(glass.position.x, 0);
  assert.equal(glass.position.y, 0.78);
  assert.equal(glass.position.z, 0);

  const cap = lantern.children.find((c) => c.name === 'prop_lantern_cap');
  assert.ok(cap);
  assert.equal(cap.geometry.type, 'BoxGeometry');
  assert.deepEqual(cap.geometry.args, [0.2, 0.05, 0.2]);
  assert.equal(cap.material.color, '#6b492b');
  assert.equal(cap.position.x, 0);
  assert.equal(cap.position.y, 0.93);
  assert.equal(cap.position.z, 0);

  const planter = buildProp(THREE, {
    kind: 'planter',
    x: 1.5,
    y: 0,
    z: 2.5,
    rot_y: 180,
    color: '#7a5230',
  });
  assert.ok(planter);
  assert.equal(planter.name, 'prop_planter');
  assert.equal(planter.position.x, 1.5);
  assert.ok(Math.abs(planter.position.y - 0.18) < 1e-12);
  assert.equal(planter.position.z, 2.5);
  assert.ok(Math.abs(planter.rotation.y - Math.PI) < 1e-12);
  assert.equal(planter.children.length, 5);

  const box = planter.children.find((c) => c.name === 'prop_planter_box');
  assert.ok(box);
  assert.equal(box.geometry.type, 'BoxGeometry');
  assert.deepEqual(box.geometry.args, [0.6, 0.3, 0.4]);
  assert.equal(box.material.color, '#7a5230');
  assert.equal(box.position.x, 0);
  assert.equal(box.position.y, 0.15);
  assert.equal(box.position.z, 0);

  const soil = planter.children.find((c) => c.name === 'prop_planter_soil');
  assert.ok(soil);
  assert.equal(soil.geometry.type, 'BoxGeometry');
  assert.deepEqual(soil.geometry.args, [0.54, 0.04, 0.34]);
  assert.equal(soil.material.color, '#4d3522');
  assert.equal(soil.position.x, 0);
  assert.equal(soil.position.y, 0.30);
  assert.equal(soil.position.z, 0);

  const foliages = planter.children
    .filter((c) => c.name === 'prop_planter_foliage')
    .sort((a, b) => a.position.x - b.position.x);
  assert.equal(foliages.length, 3);
  for (const [idx, expectedX] of [[0, -0.18], [1, 0], [2, 0.18]]) {
    const f = foliages[idx];
    assert.equal(f.geometry.type, 'ConeGeometry');
    assert.deepEqual(f.geometry.args, [0.12, 0.35, 6]);
    assert.equal(f.material.color, '#1f3f26');
    assert.equal(f.position.x, expectedX);
    assert.equal(f.position.y, 0.48);
    assert.equal(f.position.z, 0);
  }

  const fallbackLantern = buildProp(THREE, { kind: 'lantern', x: 0, y: 0, z: 2.2, rot_y: 0, color: 'bad' });
  assert.equal(fallbackLantern.children.find((c) => c.name === 'prop_lantern_post').material.color, '#8a6240');
  assert.equal(fallbackLantern.children.find((c) => c.name === 'prop_lantern_cap').material.color, '#8a6240');
  assert.equal(fallbackLantern.children.find((c) => c.name === 'prop_lantern_glass').material.color, '#ffbe5c');

  const fallbackPlanter = buildProp(THREE, { kind: 'planter', x: 0, y: 0, z: 2.2, rot_y: 0, color: 'bad' });
  assert.equal(fallbackPlanter.children.find((c) => c.name === 'prop_planter_box').material.color, '#8a6240');
  assert.equal(fallbackPlanter.children.find((c) => c.name === 'prop_planter_soil').material.color, '#4d3522');
  assert.equal(fallbackPlanter.children.find((c) => c.name === 'prop_planter_foliage').material.color, '#1f3f26');

  assert.equal(buildProp(THREE, { kind: 'fountain', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#ffffff' }), null);
});

test('buildProp builds bookshelf, rug, typewriter, and poster_frame with expected geometry, position, rotation, name, and color', () => {
  const THREE = makeFakeThree();

  const bookshelf = buildProp(THREE, { kind: 'bookshelf', x: 0.5, y: 0, z: 2.2, rot_y: 90, color: '#5a4332' });
  assert.ok(bookshelf);
  assert.equal(bookshelf.name, 'prop_bookshelf');
  assert.equal(bookshelf.geometry.type, 'BoxGeometry');
  assert.deepEqual(bookshelf.geometry.args, [0.9, 1.4, 0.35]);
  assert.equal(bookshelf.position.x, 0.5);
  assert.ok(Math.abs(bookshelf.position.y - 0.88) < 1e-12);
  assert.equal(bookshelf.position.z, 2.2);
  assert.ok(Math.abs(bookshelf.rotation.y - Math.PI / 2) < 1e-12);
  assert.equal(bookshelf.material.color, '#5a4332');

  const rug = buildProp(THREE, { kind: 'rug', x: -0.4, y: 0, z: 2.2, rot_y: 0, color: '#a83232' });
  assert.ok(rug);
  assert.equal(rug.name, 'prop_rug');
  assert.equal(rug.geometry.type, 'BoxGeometry');
  assert.deepEqual(rug.geometry.args, [1.6, 0.04, 1.1]);
  assert.equal(rug.position.x, -0.4);
  assert.ok(Math.abs(rug.position.y - 0.20) < 1e-12);
  assert.equal(rug.position.z, 2.2);
  assert.equal(rug.rotation.y, 0);
  assert.equal(rug.material.color, '#a83232');

  const typewriter = buildProp(THREE, { kind: 'typewriter', x: 0.9, y: 0.72, z: 2.2, rot_y: 270, color: '#222222' });
  assert.ok(typewriter);
  assert.equal(typewriter.name, 'prop_typewriter');
  assert.equal(typewriter.geometry.type, 'BoxGeometry');
  assert.deepEqual(typewriter.geometry.args, [0.36, 0.18, 0.3]);
  assert.equal(typewriter.position.x, 0.9);
  assert.ok(Math.abs(typewriter.position.y - 0.99) < 1e-12);
  assert.equal(typewriter.position.z, 2.2);
  assert.ok(Math.abs(typewriter.rotation.y - (270 * Math.PI) / 180) < 1e-12);
  assert.equal(typewriter.material.color, '#222222');

  const poster = buildProp(THREE, { kind: 'poster_frame', x: -1.1, y: 0.3, z: 2.2, rot_y: 180, color: '#f5efe0' });
  assert.ok(poster);
  assert.equal(poster.name, 'prop_poster_frame');
  assert.equal(poster.geometry.type, 'BoxGeometry');
  assert.deepEqual(poster.geometry.args, [0.7, 0.9, 0.06]);
  assert.equal(poster.position.x, -1.1);
  assert.ok(Math.abs(poster.position.y - 1.38) < 1e-12);
  assert.equal(poster.position.z, 2.2);
  assert.ok(Math.abs(poster.rotation.y - Math.PI) < 1e-12);
  assert.equal(poster.material.color, '#f5efe0');
});

test('buildProp validation boundaries: null/non-object/missing kind, coordinate edges, rot_y edges, color fallback variants', () => {
  const THREE = makeFakeThree();

  assert.equal(buildProp(THREE, null), null);
  assert.equal(buildProp(THREE, undefined), null);
  assert.equal(buildProp(THREE, 'desk'), null);
  assert.equal(buildProp(THREE, { x: 0, y: 0, z: 0, rot_y: 0, color: '#ffffff' }), null);
  assert.equal(buildProp(THREE, { kind: null, x: 0, y: 0, z: 0, rot_y: 0, color: '#ffffff' }), null);

  assert.ok(buildProp(THREE, { kind: 'desk', x: 12, y: 0, z: 2.2, rot_y: 0, color: '#ffffff' }));
  assert.ok(buildProp(THREE, { kind: 'desk', x: -12, y: 0, z: 2.2, rot_y: 0, color: '#ffffff' }));
  assert.equal(buildProp(THREE, { kind: 'desk', x: 12.0001, y: 0, z: 2.2, rot_y: 0, color: '#ffffff' }), null);
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: Number.NaN, z: 2.2, rot_y: 0, color: '#ffffff' }), null);
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: '2.2', rot_y: 0, color: '#ffffff' }), null);
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, color: '#ffffff' }), null);

  const maxRot = buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: 359.9, color: '#ffffff' });
  assert.ok(maxRot);
  assert.ok(Math.abs(maxRot.rotation.y - (359.9 * Math.PI) / 180) < 1e-12);
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: -0.1, color: '#ffffff' }), null);
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: Number.NaN, color: '#ffffff' }), null);
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: '90', color: '#ffffff' }), null);

  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#ABCDEF' }).material.color, '#ABCDEF');
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#abc' }).material.color, '#8a6240');
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: 0 }).material.color, '#8a6240');
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: 0, color: '' }).material.color, '#8a6240');
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: 0, color: null }).material.color, '#8a6240');
  assert.equal(buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: 0, color: 123 }).material.color, '#8a6240');
});

test('safeColor, HEX_COLOR_RE, and VALID_PROP_KINDS exact membership', async () => {
  const { HEX_COLOR_RE, safeColor } = await import('./cottage-props.mjs');

  assert.equal(safeColor('#aabbcc', '#8a6240'), '#aabbcc');
  assert.equal(safeColor('#AABBCC', '#8a6240'), '#AABBCC');
  assert.equal(safeColor('#abc', '#8a6240'), '#8a6240');
  assert.equal(safeColor('red', '#8a6240'), '#8a6240');
  assert.equal(safeColor(null, '#8a6240'), '#8a6240');
  assert.equal(safeColor(42, '#8a6240'), '#8a6240');
  assert.equal(safeColor('#aabbccdd', '#8a6240'), '#8a6240');
  assert.equal(safeColor('#12345g', '#8a6240'), '#8a6240');

  assert.equal(HEX_COLOR_RE.test('#123456'), true);
  assert.equal(HEX_COLOR_RE.test('#ABCDEF'), true);
  assert.equal(HEX_COLOR_RE.test('#12345'), false);
  assert.equal(HEX_COLOR_RE.test('123456'), false);
  assert.equal(HEX_COLOR_RE.test('#gggggg'), false);
  assert.equal(HEX_COLOR_RE.test('#1234567'), false);

  assert.equal(VALID_PROP_KINDS.size, 9);
  for (const kind of ['desk', 'bookshelf', 'rug', 'tea_kettle', 'typewriter', 'cat', 'poster_frame', 'lantern', 'planter']) {
    assert.equal(VALID_PROP_KINDS.has(kind), true, `expected ${kind} in VALID_PROP_KINDS`);
  }
  assert.equal(VALID_PROP_KINDS.has('piano'), false);
  assert.equal(VALID_PROP_KINDS.has('fountain'), false);
});

test('attachPlotProps / attachPorchDeck / attachPorchTrim null and empty edges, plus double-attach', () => {
  const THREE = makeFakeThree();

  assert.equal(attachPlotProps(THREE, null, MILO_PLOT_PROPS), 0);

  for (const badList of [null, [], [null, undefined, 'x']]) {
    const cottage = new THREE.Group();
    assert.equal(attachPlotProps(THREE, cottage, badList), 0);
    assert.equal(cottage.children.length, 0);
  }

  assert.equal(attachPorchDeck(THREE, null), null);
  assert.equal(attachPorchTrim(THREE, null), null);

  const deckGroup = new THREE.Group();
  attachPorchDeck(THREE, deckGroup);
  attachPorchDeck(THREE, deckGroup);
  assert.equal(deckGroup.children.length, 2);
  for (const child of deckGroup.children) {
    assert.equal(child.name, 'cottage_porch_deck');
  }

  const trimGroup = new THREE.Group();
  attachPorchTrim(THREE, trimGroup);
  attachPorchTrim(THREE, trimGroup);
  assert.equal(trimGroup.children.length, 2);
  for (const child of trimGroup.children) {
    assert.equal(child.name, 'cottage_porch_trim');
  }
});

test('porch-remap pass-through edges and group-prop material sharing', () => {
  const THREE = makeFakeThree();

  const farEdge = buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 3.45, rot_y: 0, color: '#7a5230' });
  assert.ok(farEdge);
  assert.equal(farEdge.position.z, 3.45);
  assert.ok(Math.abs(farEdge.position.y - 0.54) < 1e-12);

  const rangeMax = buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 12, rot_y: 0, color: '#7a5230' });
  assert.ok(rangeMax);
  assert.equal(rangeMax.position.z, 12);
  assert.ok(Math.abs(rangeMax.position.y - 0.54) < 1e-12);

  const stackHigh = buildProp(THREE, { kind: 'desk', x: 0, y: 1.5, z: 2.2, rot_y: 0, color: '#7a5230' });
  assert.ok(stackHigh);
  assert.ok(Math.abs(stackHigh.position.y - 2.04) < 1e-12);

  const stackNeg = buildProp(THREE, { kind: 'desk', x: 0, y: -0.18, z: 2.2, rot_y: 0, color: '#7a5230' });
  assert.ok(stackNeg);
  assert.ok(Math.abs(stackNeg.position.y - 0.36) < 1e-12);

  const nearPass = buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.06, rot_y: 0, color: '#7a5230' });
  assert.ok(nearPass);
  assert.equal(nearPass.position.z, 2.06);

  const lantern = buildProp(THREE, { kind: 'lantern', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#6b492b' });
  assert.ok(lantern);
  assert.equal(lantern.children[0].material, lantern.children[2].material);
  assert.notEqual(lantern.children[1].material, lantern.children[0].material);
  assert.equal(lantern.rotation.y, 0);

  const planter = buildProp(THREE, { kind: 'planter', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#7a5230' });
  assert.ok(planter);
  const box = planter.children.find((c) => c.name === 'prop_planter_box');
  const soil = planter.children.find((c) => c.name === 'prop_planter_soil');
  const foliages = planter.children.filter((c) => c.name === 'prop_planter_foliage');
  assert.equal(box.material.color, '#7a5230');
  assert.notEqual(soil.material, box.material);
  assert.equal(foliages.length, 3);
  assert.equal(foliages[0].material, foliages[1].material);
  assert.equal(foliages[1].material, foliages[2].material);
  assert.notEqual(foliages[0].material, box.material);
});

test('staging.js wires attachPorchDeck at both cottage sites, in order', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');

  const cDeck = stagingSrc.indexOf('attachPorchDeck(THREE, cottage);');
  const cTrim = stagingSrc.indexOf('attachPorchTrim(THREE, cottage);');
  const cProps = stagingSrc.indexOf('attachPlotProps(THREE, cottage, Array.isArray(manifest.props) ? manifest.props : []);');
  assert.ok(cDeck !== -1, 'missing attachPorchDeck(THREE, cottage);');
  assert.ok(cTrim !== -1, 'missing attachPorchTrim(THREE, cottage);');
  assert.ok(cProps !== -1, 'missing attachPlotProps(THREE, cottage, ...);');
  assert.ok(cDeck < cTrim && cTrim < cProps, 'cottage porch wiring order must be deck < trim < props');

  const mProps = stagingSrc.indexOf('attachPlotProps(THREE, milosCottage, MILO_PLOT_PROPS);');
  const mDeck = stagingSrc.indexOf('attachPorchDeck(THREE, milosCottage);');
  const mTrim = stagingSrc.indexOf('attachPorchTrim(THREE, milosCottage);');
  assert.ok(mProps !== -1, 'missing attachPlotProps(THREE, milosCottage, MILO_PLOT_PROPS);');
  assert.ok(mDeck !== -1, 'missing attachPorchDeck(THREE, milosCottage);');
  assert.ok(mTrim !== -1, 'missing attachPorchTrim(THREE, milosCottage);');
  assert.ok(mProps < mDeck && mDeck < mTrim, 'milosCottage porch wiring order must be props < deck < trim');
});

test('buildProp and attachPlotProps do not mutate their inputs', () => {
  const THREE = makeFakeThree();

  const remappedProp = { kind: 'cat', x: 1.1, y: 0, z: -12, rot_y: 45, color: '#2b2b2b' };
  const remappedSnapshot = JSON.stringify(remappedProp);
  const cat = buildProp(THREE, remappedProp);
  assert.ok(cat);
  assert.equal(cat.position.z, 3.45);
  assert.equal(JSON.stringify(remappedProp), remappedSnapshot);

  const groupProp = { kind: 'lantern', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#6b492b' };
  const groupSnapshot = JSON.stringify(groupProp);
  const lantern = buildProp(THREE, groupProp);
  assert.ok(lantern);
  assert.equal(lantern.position.z, 2.2);
  assert.equal(JSON.stringify(groupProp), groupSnapshot);

  const mixedList = [
    MILO_PLOT_PROPS[0],
    { kind: 'nope', x: 0, y: 0, z: 0, rot_y: 0, color: '#000000' },
    MILO_PLOT_PROPS[2],
  ];
  const listSnapshot = JSON.stringify(mixedList);
  const cottage = new THREE.Group();
  const attached = attachPlotProps(THREE, cottage, mixedList);
  assert.equal(attached, 2);
  assert.equal(mixedList.length, 3);
  assert.equal(JSON.stringify(mixedList), listSnapshot);
});

test('buildProp returns fresh materials per call; porch trim children share one material; deck material is distinct', () => {
  const THREE = makeFakeThree();

  const deskProp = { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#7a5230' };
  const deskA = buildProp(THREE, deskProp);
  const deskB = buildProp(THREE, deskProp);
  assert.ok(deskA && deskB);
  assert.notEqual(deskA.material, deskB.material);
  assert.equal(deskA.material.color, deskB.material.color);

  const lanternProp = { kind: 'lantern', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#6b492b' };
  const lanternA = buildProp(THREE, lanternProp);
  const lanternB = buildProp(THREE, lanternProp);
  const glassA = lanternA.children.find((c) => c.name === 'prop_lantern_glass');
  const glassB = lanternB.children.find((c) => c.name === 'prop_lantern_glass');
  assert.ok(glassA && glassB);
  assert.notEqual(glassA.material, glassB.material);

  const cottageA = new THREE.Group();
  const trim = attachPorchTrim(THREE, cottageA);
  assert.ok(trim);
  assert.equal(trim.children.length, 7);
  for (const child of trim.children) {
    assert.equal(child.material, trim.children[0].material);
  }

  const deckA = attachPorchDeck(THREE, cottageA);
  assert.ok(deckA);
  assert.notEqual(deckA.material, trim.children[0].material);

  const cottageB = new THREE.Group();
  const deckB = attachPorchDeck(THREE, cottageB);
  assert.ok(deckB);
  assert.notEqual(deckB.material, deckA.material);
});

test('buildProp and porch builders pin roughness per kind and part', () => {
  const THREE = makeFakeThree();

  const desk = buildProp(THREE, { kind: 'desk', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#7a5230' });
  const kettle = buildProp(THREE, { kind: 'tea_kettle', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#b87333' });
  assert.equal(desk.material.opts.roughness, 0.85);
  assert.equal(kettle.material.opts.roughness, 0.85);

  const cottage = new THREE.Group();
  const deck = attachPorchDeck(THREE, cottage);
  const trim = attachPorchTrim(THREE, cottage);
  assert.equal(deck.material.opts.roughness, 0.9);
  assert.equal(trim.children[0].material.opts.roughness, 0.9);

  const planter = buildProp(THREE, { kind: 'planter', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#7a5230' });
  const box = planter.children.find((c) => c.name === 'prop_planter_box');
  const soil = planter.children.find((c) => c.name === 'prop_planter_soil');
  const foliage = planter.children.find((c) => c.name === 'prop_planter_foliage');
  assert.equal(soil.material.opts.roughness, 0.95);
  assert.equal(foliage.material.opts.roughness, 0.9);
  assert.equal(box.material.opts.roughness, 0.85);

  const lantern = buildProp(THREE, { kind: 'lantern', x: 0, y: 0, z: 2.2, rot_y: 0, color: '#6b492b' });
  const glass = lantern.children.find((c) => c.name === 'prop_lantern_glass');
  assert.equal('roughness' in glass.material.opts, false);
  assert.equal(glass.material.opts.emissiveIntensity, 1.4);
});

test('buildProp porch remap formula spot checks beyond the existing table', () => {
  const THREE = makeFakeThree();
  const cases = [
    { z: 1.0, expectedZ: 2.4 },
    { z: -1.0, expectedZ: 3.1 },
    { z: 1.5, expectedZ: 2.225 },
    { z: 2.04, expectedZ: 2.05 },
    { z: -1.99, expectedZ: 3.4465 },
  ];

  for (const c of cases) {
    const desk = buildProp(THREE, { kind: 'desk', x: 0.25, y: 0.1, z: c.z, rot_y: 30, color: '#7a5230' });
    assert.ok(desk, `z=${c.z}`);
    assert.ok(Math.abs(desk.position.z - c.expectedZ) < 1e-12, `z=${c.z} got ${desk.position.z}`);
    assert.ok(Math.abs(desk.position.y - 0.64) < 1e-12, `z=${c.z} y got ${desk.position.y}`);
    assert.equal(desk.position.x, 0.25);
    assert.ok(Math.abs(desk.rotation.y - (30 * Math.PI) / 180) < 1e-12);
  }
});

test('attachPlotProps preserves order across skipped props; porch attach returns the added child', () => {
  const THREE = makeFakeThree();

  const cottage = new THREE.Group();
  const attached = attachPlotProps(THREE, cottage, [
    MILO_PLOT_PROPS[0],
    { kind: 'invalid_prop', x: 0, y: 0, z: 0, rot_y: 0, color: '#000000' },
    MILO_PLOT_PROPS[2],
    { kind: 'piano', x: 0, y: 0, z: 0, rot_y: 0, color: '#000000' },
    { kind: 'rug', x: -0.4, y: 0, z: 2.2, rot_y: 0, color: '#a83232' },
  ]);
  assert.equal(attached, 3);
  assert.deepEqual(
    cottage.children.map((c) => c.name),
    ['prop_desk', 'prop_cat', 'prop_rug']
  );
  assert.deepEqual(
    cottage.children.map((c) => c.position.x),
    [-1.2, 1.3, -0.4]
  );

  const deckGroup = new THREE.Group();
  const deck = attachPorchDeck(THREE, deckGroup);
  assert.equal(deckGroup.children.length, 1);
  assert.equal(deck, deckGroup.children[0]);

  const trimGroup = new THREE.Group();
  const trim = attachPorchTrim(THREE, trimGroup);
  assert.equal(trimGroup.children.length, 1);
  assert.equal(trim, trimGroup.children[0]);
});

test('every VALID_PROP_KIND builds; attachPlotProps rejects non-array props; MILO props land on the porch band', () => {
  const THREE = makeFakeThree();

  assert.equal(VALID_PROP_KINDS.size, 9);
  for (const kind of [...VALID_PROP_KINDS].sort()) {
    const built = buildProp(THREE, { kind, x: 0, y: 0, z: 2.2, rot_y: 0, color: '#ffffff' });
    assert.ok(built, `expected ${kind} to build`);
    assert.equal(built.name, `prop_${kind}`);
  }

  for (const badProps of ['x', 42, { not: 'array' }]) {
    const cottage = new THREE.Group();
    assert.equal(attachPlotProps(THREE, cottage, badProps), 0);
    assert.equal(cottage.children.length, 0);
  }

  for (const prop of MILO_PLOT_PROPS) {
    const mesh = buildProp(THREE, prop);
    assert.ok(mesh);
    assert.ok(mesh.position.z >= 2.05 && mesh.position.z <= 3.45, `z=${mesh.position.z} outside [2.05, 3.45]`);
    assert.equal(mesh.material.color, prop.color);
  }
});
