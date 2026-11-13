import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TOWN_LAYOUT,
  MILO_REBUILD_MANIFEST,
  PROP_PLACEMENTS,
  SEED_HOME_PADS,
  applyPlotManifest,
  buildTown,
  buildProceduralStreetLight,
  buildProceduralBookshelf,
  buildProceduralOilLamp,
  buildProceduralTypewriter,
  buildProceduralTeapot,
  createCottage,
  createAvatarCapsule,
  loadTownProps,
} from './town.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Minimal recording THREE stub for headless Node verification.
 */
function createThreeStub() {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    multiplyScalar(s) {
      this.x *= s;
      this.y *= s;
      this.z *= s;
      return this;
    }
  }

  class Euler {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    multiplyScalar(s) {
      this.x *= s;
      this.y *= s;
      this.z *= s;
      return this;
    }
  }

  class Matrix4 {
    constructor() {
      this.elements = new Array(16).fill(0);
    }
  }

  class Object3D {
    constructor() {
      this.name = '';
      this.children = [];
      this.parent = null;
      this.position = new Vector3();
      this.rotation = new Euler();
      this.scale = new Vector3(1, 1, 1);
      this.matrix = new Matrix4();
      this.userData = {};
    }
    add(...objs) {
      for (const obj of objs) {
        obj.parent = this;
        this.children.push(obj);
      }
      return this;
    }
    remove(...objs) {
      for (const obj of objs) {
        const idx = this.children.indexOf(obj);
        if (idx !== -1) {
          this.children.splice(idx, 1);
          obj.parent = null;
        }
      }
      return this;
    }
    updateMatrix() {}
  }

  class Scene extends Object3D {
    constructor() {
      super();
      this.type = 'Scene';
      this.fog = null;
    }
  }

  class Group extends Object3D {
    constructor() {
      super();
      this.type = 'Group';
    }
  }

  class Mesh extends Object3D {
    constructor(geometry, material) {
      super();
      this.type = 'Mesh';
      this.isMesh = true;
      this.geometry = geometry;
      this.material = material;
    }
  }

  class InstancedMesh extends Mesh {
    constructor(geometry, material, count) {
      super(geometry, material);
      this.type = 'InstancedMesh';
      this.isInstancedMesh = true;
      this.count = count;
      this.matrices = new Array(count);
    }
    setMatrixAt(index, matrix) {
      this.matrices[index] = matrix;
    }
  }

  class Sprite extends Object3D {
    constructor(material) {
      super();
      this.type = 'Sprite';
      this.isSprite = true;
      this.material = material;
    }
  }

  class BoxGeometry {
    constructor(width, height, depth) {
      this.type = 'BoxGeometry';
      this.parameters = { width, height, depth };
    }
  }

  class CylinderGeometry {
    constructor(radiusTop, radiusBottom, height, radialSegments) {
      this.type = 'CylinderGeometry';
      this.parameters = { radiusTop, radiusBottom, height, radialSegments };
    }
  }

  class ConeGeometry {
    constructor(radius, height, radialSegments) {
      this.type = 'ConeGeometry';
      this.parameters = { radius, height, radialSegments };
    }
  }

  class SphereGeometry {
    constructor(radius, widthSegments, heightSegments) {
      this.type = 'SphereGeometry';
      this.parameters = { radius, widthSegments, heightSegments };
    }
  }

  class CircleGeometry {
    constructor(radius, segments) {
      this.type = 'CircleGeometry';
      this.parameters = { radius, segments };
    }
  }

  class PlaneGeometry {
    constructor(width, height) {
      this.type = 'PlaneGeometry';
      this.parameters = { width, height };
    }
  }

  class MeshStandardMaterial {
    constructor(params = {}) {
      this.type = 'MeshStandardMaterial';
      Object.assign(this, params);
    }
  }

  class MeshBasicMaterial {
    constructor(params = {}) {
      this.type = 'MeshBasicMaterial';
      Object.assign(this, params);
    }
  }

  class SpriteMaterial {
    constructor(params = {}) {
      this.type = 'SpriteMaterial';
      Object.assign(this, params);
    }
  }

  class CanvasTexture {
    constructor(image) {
      this.type = 'CanvasTexture';
      this.image = image;
      this.needsUpdate = false;
    }
  }

  class PointLight extends Object3D {
    constructor(color, intensity, distance) {
      super();
      this.type = 'PointLight';
      this.isPointLight = true;
      this.color = color;
      this.intensity = intensity;
      this.distance = distance;
    }
  }

  class DirectionalLight extends Object3D {
    constructor(color, intensity) {
      super();
      this.type = 'DirectionalLight';
      this.color = color;
      this.intensity = intensity;
    }
  }

  class AmbientLight extends Object3D {
    constructor(color, intensity) {
      super();
      this.type = 'AmbientLight';
      this.color = color;
      this.intensity = intensity;
    }
  }

  class Box3 {
    constructor() {
      this.min = new Vector3(0, 0, 0);
      this.max = new Vector3(0, 0, 0);
    }
    setFromObject(obj) {
      const b = obj && obj.userData && obj.userData.stubBounds;
      if (b) {
        this.min.set(b.min[0], b.min[1], b.min[2]);
        this.max.set(b.max[0], b.max[1], b.max[2]);
      }
      return this;
    }
    getSize(target) {
      return target.set(
        this.max.x - this.min.x,
        this.max.y - this.min.y,
        this.max.z - this.min.z
      );
    }
    getCenter(target) {
      return target.set(
        (this.min.x + this.max.x) / 2,
        (this.min.y + this.max.y) / 2,
        (this.min.z + this.max.z) / 2
      );
    }
  }

  class Fog {
    constructor(color, near, far) {
      this.color = color;
      this.near = near;
      this.far = far;
    }
  }

  return {
    BackSide: 1,
    Vector3,
    Euler,
    Matrix4,
    Object3D,
    Scene,
    Group,
    Mesh,
    InstancedMesh,
    Sprite,
    BoxGeometry,
    CylinderGeometry,
    ConeGeometry,
    SphereGeometry,
    CircleGeometry,
    PlaneGeometry,
    MeshStandardMaterial,
    MeshBasicMaterial,
    SpriteMaterial,
    CanvasTexture,
    PointLight,
    DirectionalLight,
    AmbientLight,
    Box3,
    Fog,
  };
}

function collectNodes(root, predicate, out = []) {
  if (predicate(root)) out.push(root);
  if (Array.isArray(root.children)) {
    for (const child of root.children) {
      collectNodes(child, predicate, out);
    }
  }
  return out;
}

test('buildTown builds Bandstand, Ghostlight, 10 footlights, Gate, Newsstand, Milo cottage, 7 open plots, and 10 avatar spots', () => {
  const THREE = createThreeStub();
  const { scene, parts } = buildTown(THREE);

  assert.ok(scene);
  assert.ok(parts.bandstand);

  // Bandstand base is an 8-sided cylinder (octagon)
  const baseMesh = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_base')[0];
  assert.ok(baseMesh, 'bandstand_base mesh must exist');
  assert.equal(baseMesh.geometry.type, 'CylinderGeometry');
  assert.equal(baseMesh.geometry.parameters.radialSegments, 8);

  // Exactly 10 footlights
  assert.equal(parts.footlights.length, 10);

  // Exactly 1 Ghostlight bulb with emissive material and 1 PointLight
  assert.ok(parts.ghostlight.bulb);
  assert.ok(parts.ghostlight.bulb.material.emissive, 'Ghostlight bulb must have emissive material');
  assert.ok((parts.ghostlight.bulb.material.emissiveIntensity ?? 1) > 0);
  assert.ok(parts.ghostlight.light.isPointLight, 'Ghostlight must include a PointLight');
  const allPointLights = collectNodes(scene, (n) => n.isPointLight);
  assert.equal(allPointLights.length, 1);

  // Town Gate present with town name
  assert.ok(parts.gate);
  assert.equal(parts.gate.userData.townName, 'GHOSTLIGHT TOWN');

  // Newsstand ~15 m from bandstand center (12-18 m)
  assert.ok(parts.newsstand);
  const newsDist = Math.hypot(
    parts.newsstand.position.x - TOWN_LAYOUT.bandstand.x,
    parts.newsstand.position.z - TOWN_LAYOUT.bandstand.z
  );
  assert.ok(newsDist >= 12 && newsDist <= 18, `Expected newsstand 12-18m from bandstand, got ${newsDist}`);

  // Milo's cottage: ice-blue walls, cream upper, gable style, rooftop terrace
  assert.ok(parts.milosCottage);
  assert.equal(parts.milosCottage.userData.cottageStyle, 'gable');
  const groundFloor = collectNodes(parts.milosCottage, (n) => n.name === 'cottage_ground_floor')[0];
  const upperFloor = collectNodes(parts.milosCottage, (n) => n.name === 'cottage_upper_floor')[0];
  const terrace = collectNodes(parts.milosCottage, (n) => n.name === 'rooftop_terrace')[0];
  assert.equal(groundFloor.material.color, MILO_REBUILD_MANIFEST.wall);
  assert.equal(upperFloor.material.color, '#f5efe0');
  assert.ok(terrace, 'Milo cottage must have a rooftop_terrace mesh');
  const windows = collectNodes(parts.milosCottage, (n) => n.name === 'cottage_window');
  assert.ok(windows.length >= 6, `Milo cottage must have lit windows, got ${windows.length}`);
  assert.ok(windows.every((w) => w.material.emissive), 'Cottage windows must be emissive (lit)');

  // Exactly 7 empty plot pads, each with OPEN PLOT signpost, within 30m, facing inward
  assert.equal(parts.plotPads.length, 7);
  for (const pad of parts.plotPads) {
    const r = Math.hypot(pad.position.x, pad.position.z);
    assert.ok(r <= TOWN_LAYOUT.clearingRadius, `Plot pad radius ${r} exceeds clearingRadius`);

    const signNode = collectNodes(pad, (n) => n.userData?.signpostText?.includes('OPEN PLOT'))[0];
    assert.ok(signNode, `Plot pad ${pad.name} must have an OPEN PLOT signpost`);

    // Forward vector in Three.js local +Z rotated by rotation.y is (sin(rotY), cos(rotY))
    const fwdX = Math.sin(pad.rotation.y);
    const fwdZ = Math.cos(pad.rotation.y);
    const toCenterLen = Math.hypot(-pad.position.x, -pad.position.z);
    const dot = (fwdX * -pad.position.x + fwdZ * -pad.position.z) / toCenterLen;
    assert.ok(dot > 0.99, `Plot pad ${pad.name} should face bandstand (dot=${dot})`);
  }

  // 10 avatar spots evenly spaced around the bandstand rim
  assert.equal(parts.avatarSpots.length, 10);
  const seenCoords = new Set();
  for (const spot of parts.avatarSpots) {
    const spotR = Math.hypot(spot.x, spot.z);
    assert.ok(
      Math.abs(spotR - TOWN_LAYOUT.bandstand.radius) < 0.01,
      `Avatar spot radius ${spotR} should equal bandstand radius ${TOWN_LAYOUT.bandstand.radius}`
    );
    const key = `${spot.x.toFixed(2)},${spot.z.toFixed(2)}`;
    assert.ok(!seenCoords.has(key), `Duplicate avatar spot at ${key}`);
    seenCoords.add(key);
  }

  // Milo's permanent ghost stands at spot 0: dome + tapering tail + two eyes,
  // translucent ice-blue, facing the gate, footlight lit
  const ghost = parts.milosGhost;
  assert.ok(ghost, 'buildTown must expose parts.milosGhost');
  assert.equal(ghost.position.x, parts.avatarSpots[0].x);
  assert.equal(ghost.position.z, parts.avatarSpots[0].z);
  assert.ok(Math.abs(ghost.rotation.y) < 0.01, 'Ghost must face the gate (rotY ~ 0)');
  const ghostBody = collectNodes(ghost, (n) =>
    n.name === 'ghost_dome' || n.name === 'ghost_body' || n.name === 'ghost_wisp');
  assert.equal(ghostBody.length, 3, 'Ghost must have a dome, a body, and a wisp');
  const wisp = collectNodes(ghost, (n) => n.name === 'ghost_wisp')[0];
  assert.ok(wisp.geometry.parameters.height <= 0.4,
    'The wisp must be short — a long taper reads as an ice cream cone');
  assert.ok(ghostBody.every((m) => m.material.transparent && m.material.opacity < 1),
    'Ghost body must be translucent');
  assert.ok(ghostBody.every((m) => m.material.color === '#a8d8ea'),
    'Ghost body must be ice-blue');
  const ghostEyes = collectNodes(ghost, (n) => n.name === 'ghost_eye');
  assert.equal(ghostEyes.length, 2, 'Ghost must have two eyes');
  assert.ok(ghostEyes.every((m) => !m.material.transparent),
    'Ghost eyes must be opaque (dark, readable)');
  const fl0 = parts.footlights[0];
  assert.equal(fl0.userData.lit, true, 'Milo footlight (slot 0) must be lit');
  assert.equal(fl0.userData.handle, 'milo');
  assert.equal(fl0.userData.permanent, true);
});

test("Milo's cottage uses the concept-matched builder: cream gable walls, no brown prism", () => {
  const THREE = createThreeStub();
  const { parts } = buildTown(THREE);
  const roof = collectNodes(parts.milosCottage, (n) => n.name === 'cottage_gable_roof')[0];
  assert.ok(roof, 'Milo cottage must have a cottage_gable_roof mesh');
  assert.equal(roof.material.color, MILO_REBUILD_MANIFEST.roof);
  // Regression guard for the concept-comparison catch (2026-11-12): the old
  // builder made the roof a 3-sided brown prism whose end caps WERE the gable
  // walls, so the gable ends rendered brown instead of cream. The concept
  // builder uses a true two-slope roof over cream gable walls — no 3-sided
  // prism anywhere in the cottage.
  const prisms = collectNodes(
    parts.milosCottage,
    (n) => n.isMesh && n.geometry?.type === 'CylinderGeometry' && n.geometry?.parameters?.radialSegments === 3
  );
  assert.equal(prisms.length, 0, 'Milo cottage must not contain the old 3-sided roof prism');
});

test('createCottage honors tower manifest, custom colors, 0 props, and ignores unknown props', () => {
  const THREE = createThreeStub();

  const tower = createCottage(THREE, {
    cottage: 'tower',
    wall: '#123456',
    roof: '#654321',
    trim: '#abcdef',
    signpost_text: 'Archivist Tower',
    props: [
      { kind: 'bookshelf', x: 0, y: 0, z: 0, rot_y: 90 },
      { kind: 'unknown_contraption', x: 1, y: 0, z: 1, rot_y: 0 },
      { kind: 'desk', x: 999, y: 0, z: 0, rot_y: 0 },
    ],
  });

  const towerBody = collectNodes(tower, (n) => n.name === 'tower_body')[0];
  const towerRoof = collectNodes(tower, (n) => n.name === 'tower_roof')[0];
  const towerDoor = collectNodes(tower, (n) => n.name === 'cottage_door')[0];
  assert.equal(towerBody.material.color, '#123456');
  assert.equal(towerRoof.material.color, '#654321');
  assert.equal(towerDoor.material.color, '#abcdef');

  const propMeshes = collectNodes(tower, (n) => n.name.startsWith('prop_'));
  assert.equal(propMeshes.length, 1);
  assert.equal(propMeshes[0].name, 'prop_bookshelf');

  const emptyCabin = createCottage(THREE, {
    cottage: 'cabin',
    wall: '#ccbbaa',
    roof: '#443322',
    trim: '#ffffff',
    props: [],
  });
  assert.equal(emptyCabin.userData.cottageStyle, 'cabin');
  assert.equal(collectNodes(emptyCabin, (n) => n.name.startsWith('prop_')).length, 0);
});

test('createAvatarCapsule builds [MUSE] and [NPC] capsules', () => {
  const THREE = createThreeStub();
  const muse = createAvatarCapsule(THREE, { handle: 'milo', role: 'muse' });
  const npc = createAvatarCapsule(THREE, { handle: 'trimmer', role: 'npc' });
  assert.equal(muse.userData.role, 'muse');
  assert.equal(npc.userData.role, 'npc');
  assert.ok(collectNodes(muse, (n) => n.isSprite).length === 1);
  assert.ok(collectNodes(npc, (n) => n.isSprite).length === 1);
});

// Budget raised 80 -> 120 (owner decision, 2026-11-12): lit windows and the
// widow's-walk posts are worth their meshes, and Argon's review notes 120
// standard meshes run at 120fps on a 2015 integrated GPU. Still guards bloat.
// Budget raised 120 -> 125 (owner decision, 2026-11-12): the growth since 120
// is the completed planned prop set — slice 11 (street light + bookshelf) and
// slices 12–13 (the three seed NPC character props); no further prop slices are
// planned. 114 is the worst case (all procedural fallbacks) as live town swaps
// GLBs in for fewer — down from 122 after the 2026-11-12 concept-cottage swap
// (Argon's merged cottage replaces the old multi-mesh build) — and 114 is under
// the 120fps/2015-iGPU reference point. 125 keeps the guardrail meaningful so
// any future prop addition requires a deliberate revisit.
test('Draw-call budget: total mesh count in built town is < 125', () => {
  const THREE = createThreeStub();
  const { scene } = buildTown(THREE);
  const meshes = collectNodes(scene, (n) => n.isMesh);
  assert.ok(meshes.length < 125, `Expected < 125 meshes, got ${meshes.length}`);
});

test('No campfire terminology and no fetch() in town.js; .glb allowed only for props (not pine.glb)', async () => {
  const townJs = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');
  const indexHtml = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');

  assert.equal(/campfire/i.test(townJs), false, 'town.js must not contain campfire terminology');
  assert.equal(/campfire/i.test(indexHtml), false, 'index.html must not contain campfire terminology');
  assert.equal(/\bfetch\s*\(/.test(townJs), false, 'town.js must not call fetch()');
  assert.equal(/pine\.glb/i.test(townJs), false, 'town.js must NOT reference pine.glb');
  assert.ok(/models\/post-lantern\.glb/.test(townJs), 'town.js must reference post-lantern.glb prop');
  assert.ok(/models\/lantern\.glb/.test(townJs), 'town.js must reference lantern.glb prop');
  assert.ok(/models\/bench\.glb/.test(townJs), 'town.js must reference bench.glb prop');
  assert.ok(/models\/street-light\.glb/.test(townJs), 'town.js must reference street-light.glb prop');
  assert.ok(/models\/bookshelf\.glb/.test(townJs), 'town.js must reference bookshelf.glb prop');
  assert.ok(/models\/oil-lamp\.glb/.test(townJs), 'town.js must reference oil-lamp.glb prop');
  assert.ok(/models\/teapot\.glb/.test(townJs), 'town.js must reference teapot.glb prop');
});

test('Pinned Three.js CDN import-map URL and three/addons/ entry resolve cleanly', async () => {
  const indexHtml = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const match = indexHtml.match(/"three":\s*"([^"]+)"/);
  assert.ok(match, 'index.html importmap must pin "three"');
  const cdnUrl = match[1];
  assert.equal(cdnUrl, 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');

  const addonsMatch = indexHtml.match(/"three\/addons\/":\s*"([^"]+)"/);
  assert.ok(addonsMatch, 'index.html importmap must pin "three/addons/"');
  assert.equal(addonsMatch[1], 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/');

  const res = await fetch(cdnUrl, { method: 'HEAD' });
  assert.equal(res.status, 200, `Expected HTTP 200 from ${cdnUrl}, got ${res.status}`);
});

test('Adopted GLB models exist, have glTF magic bytes, and are under 250 KB', async () => {
  const expectedModels = [
    'post-lantern.glb',
    'lantern.glb',
    'bench.glb',
    'street-light.glb',
    'bookshelf.glb',
    'oil-lamp.glb',
    'teapot.glb',
  ];
  for (const file of expectedModels) {
    const buf = await fs.readFile(path.join(__dirname, 'models', file));
    assert.ok(buf.length > 12, `${file} must be a non-empty binary`);
    assert.ok(buf.length <= 250 * 1024, `${file} must be under 250 KB, got ${buf.length}`);
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'glTF', `${file} must start with glTF magic bytes`);
  }
});

test('CREDITS.md documents all adopted CC0 models with Poly Pizza IDs', async () => {
  const credits = await fs.readFile(path.join(__dirname, 'CREDITS.md'), 'utf8');
  assert.ok(/CC0 1\.0/.test(credits), 'CREDITS.md must state CC0 1.0');
  for (const [file, id] of [
    ['post-lantern.glb', 'ZSQ65S4lEu'],
    ['lantern.glb', 'CtHBJ1ufeW'],
    ['bench.glb', '6d92UYCIC1'],
    ['street-light.glb', 'nFwrlcLvM5'],
    ['bookshelf.glb', '30Iealxb0p'],
    ['oil-lamp.glb', 'RsWYHKkDhD'],
    ['teapot.glb', 'XggUrd5f03'],
  ]) {
    assert.ok(credits.includes(file), `CREDITS.md must name ${file}`);
    assert.ok(credits.includes(id), `CREDITS.md must include Poly Pizza id ${id}`);
  }
});

test('Procedural fallback builders exist and GLB load failure keeps procedural props', async () => {
  const townJs = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(/three\/addons\/loaders\/GLTFLoader\.js/.test(townJs), 'town.js must import GLTFLoader from three/addons/loaders/GLTFLoader.js');
  assert.ok(/function buildProceduralProp/.test(townJs), 'town.js must keep procedural prop builders');
  assert.ok(/keeping procedural fallback/.test(townJs), 'town.js must have an error path keeping procedural fallback');

  // Verify runtime fallback when GLTFLoader errors
  const THREE = createThreeStub();
  const warnings = [];
  class FailingLoader {
    load(url, onLoad, onProgress, onError) {
      onError(new Error(`Simulated 404 for ${url}`));
    }
  }
  const { parts } = buildTown(THREE, { loadProps: false });
  assert.equal(parts.props.length, PROP_PLACEMENTS.length);
  await loadTownProps(THREE, parts.props, {
    GLTFLoader: FailingLoader,
    warn: (...args) => warnings.push(args.join(' ')),
  });
  assert.equal(warnings.length, PROP_PLACEMENTS.filter((p) => p.model).length);
  for (const slot of parts.props) {
    assert.equal(slot.glb, null, `${slot.placement.id} must have no glb on error`);
    assert.ok(slot.anchor.children.includes(slot.fallback), `${slot.placement.id} must retain procedural fallback`);
  }

  // Verify runtime bounding-box scaling and swap-in when GLTFLoader succeeds
  const { parts: okParts } = buildTown(THREE, { loadProps: false });
  class MockLoader {
    load(url, onLoad) {
      const glbScene = new THREE.Group();
      glbScene.userData.stubBounds = { min: [-0.002, 0, -0.001], max: [0.002, 0.01, 0.001] };
      onLoad({ scene: glbScene });
    }
  }
  await loadTownProps(THREE, okParts.props, { GLTFLoader: MockLoader, warn: () => {} });
  for (const slot of okParts.props) {
    if (slot.placement.model) {
      assert.ok(slot.glb, `${slot.placement.id} must swap in glb on load`);
      assert.ok(!slot.anchor.children.includes(slot.fallback), `${slot.placement.id} must remove procedural fallback`);
      assert.ok(slot.glb.scale.y > 1, `${slot.placement.id} must be scaled up from tiny GLB units`);
    } else {
      assert.equal(slot.glb, null, `${slot.placement.id} without model must keep glb null`);
      assert.ok(slot.anchor.children.includes(slot.fallback), `${slot.placement.id} without model must keep procedural fallback`);
    }
  }
});

test('Slice 11 placements (street light + bookshelf) and procedural fallback builders', () => {
  const streetLightPlacement = PROP_PLACEMENTS.find((p) => p.id === 'newsstand_street_light');
  assert.ok(streetLightPlacement, 'PROP_PLACEMENTS must include newsstand_street_light');
  assert.equal(streetLightPlacement.kind, 'street-light');
  assert.equal(streetLightPlacement.parent, 'scene');
  assert.equal(streetLightPlacement.targetSize, 3.0);

  const bookshelfPlacement = PROP_PLACEMENTS.find((p) => p.id === 'newsstand_bookshelf');
  assert.ok(bookshelfPlacement, 'PROP_PLACEMENTS must include newsstand_bookshelf');
  assert.equal(bookshelfPlacement.kind, 'bookshelf');
  assert.equal(bookshelfPlacement.parent, 'scene');
  assert.equal(bookshelfPlacement.targetSize, 1.6);

  const THREE = createThreeStub();
  const streetLightGroup = buildProceduralStreetLight(THREE);
  const streetLightMeshes = collectNodes(streetLightGroup, (n) => n.isMesh);
  assert.ok(streetLightMeshes.length >= 2 && streetLightMeshes.length <= 4,
    `street light fallback must have 2-4 meshes, got ${streetLightMeshes.length}`);

  const bookshelfGroup = buildProceduralBookshelf(THREE);
  const bookshelfMeshes = collectNodes(bookshelfGroup, (n) => n.isMesh);
  assert.ok(bookshelfMeshes.length >= 2 && bookshelfMeshes.length <= 4,
    `bookshelf fallback must have 2-4 meshes, got ${bookshelfMeshes.length}`);
});

test('Slice 12: SEED_HOME_PADS pins seed NPCs to fixed plots and reserves them from strangers', () => {
  assert.deepEqual(SEED_HOME_PADS, { wick: 2, maren: 3, tomas: 4 });

  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const sampleManifest = {
    cottage_type: 'a-frame',
    wall_color: '#6b7d8c',
    roof_color: '#34414d',
    trim_color: '#d8cfb8',
    props: [],
  };

  assert.equal(applyPlotManifest(town, 'milo', sampleManifest), null, 'milo must never be reassigned');

  const marenCottage = applyPlotManifest(town, 'maren', sampleManifest);
  assert.ok(marenCottage);
  assert.equal(marenCottage.userData.plotNumber, 3, 'maren applied first must get plot 3');

  const strangerBefore = applyPlotManifest(town, 'stranger_early', sampleManifest);
  assert.ok(strangerBefore);
  assert.equal(strangerBefore.userData.plotNumber, 5, 'unknown handle must skip reserved seed pads');

  const wickCottage = applyPlotManifest(town, 'wick', sampleManifest);
  assert.ok(wickCottage);
  assert.equal(wickCottage.userData.plotNumber, 2, 'wick must get pinned plot 2');

  const tomasCottage = applyPlotManifest(town, 'tomas', sampleManifest);
  assert.ok(tomasCottage);
  assert.equal(tomasCottage.userData.plotNumber, 4, 'tomas must get pinned plot 4');

  const strangerAfter = applyPlotManifest(town, 'stranger', sampleManifest);
  assert.ok(strangerAfter);
  assert.equal(strangerAfter.userData.plotNumber, 6, 'next unknown handle gets next free unreserved pad');
});

test('Slice 12: adopted NPC character prop placements and procedural fallback builders', () => {
  const wickLamp = PROP_PLACEMENTS.find((p) => p.id === 'wick_oil_lamp');
  assert.ok(wickLamp, 'PROP_PLACEMENTS must include wick_oil_lamp');
  assert.equal(wickLamp.kind, 'oil-lamp');
  assert.equal(wickLamp.parent, 'scene');
  assert.equal(wickLamp.targetSize, 0.9);

  const tomasTeapot = PROP_PLACEMENTS.find((p) => p.id === 'tomas_teapot');
  assert.ok(tomasTeapot, 'PROP_PLACEMENTS must include tomas_teapot');
  assert.equal(tomasTeapot.kind, 'teapot');
  assert.equal(tomasTeapot.parent, 'scene');
  assert.equal(tomasTeapot.targetSize, 0.9);

  const THREE = createThreeStub();
  for (const [name, fn] of [
    ['oil-lamp', buildProceduralOilLamp],
    ['typewriter', buildProceduralTypewriter],
    ['teapot', buildProceduralTeapot],
  ]) {
    const group = fn(THREE);
    const meshes = collectNodes(group, (n) => n.isMesh);
    assert.ok(meshes.length >= 1 && meshes.length <= 3,
      `${name} fallback must have 1-3 meshes, got ${meshes.length}`);
  }
});

test('Slice 13: maren_typewriter is procedural-only and skipped by loadTownProps', async () => {
  const marenTypewriter = PROP_PLACEMENTS.find((p) => p.id === 'maren_typewriter');
  assert.ok(marenTypewriter, 'PROP_PLACEMENTS must include maren_typewriter');
  assert.equal(marenTypewriter.kind, 'typewriter');
  assert.equal(marenTypewriter.parent, 'scene');
  assert.equal(marenTypewriter.x, 9.49);
  assert.equal(marenTypewriter.y, 0);
  assert.equal(marenTypewriter.z, -12.42);
  assert.equal(marenTypewriter.rotY, -0.6525);
  assert.equal('model' in marenTypewriter, false, 'maren_typewriter must have no model property');

  const THREE = createThreeStub();
  const { parts } = buildTown(THREE, { loadProps: false });
  const loadedUrls = [];
  const warnings = [];
  class RecordingLoader {
    load(url, onLoad) {
      loadedUrls.push(url);
      const glbScene = new THREE.Group();
      glbScene.userData.stubBounds = { min: [-0.002, 0, -0.001], max: [0.002, 0.01, 0.001] };
      onLoad({ scene: glbScene });
    }
  }
  await loadTownProps(THREE, parts.props, {
    GLTFLoader: RecordingLoader,
    warn: (...args) => warnings.push(args.join(' ')),
  });

  assert.equal(warnings.length, 0, 'model-less placement must emit no warning');
  assert.equal(loadedUrls.length, PROP_PLACEMENTS.filter((p) => p.model).length);
  assert.equal(loadedUrls.some((u) => !u || /typewriter/i.test(u)), false, 'loader.load must never be called for maren_typewriter');

  const slot = parts.props.find((s) => s.placement.id === 'maren_typewriter');
  assert.ok(slot, 'maren_typewriter slot must exist');
  assert.equal(slot.glb, null, 'maren_typewriter slot.glb must stay null');
  assert.ok(slot.anchor.children.includes(slot.fallback), 'maren_typewriter procedural fallback must remain in anchor');
});
