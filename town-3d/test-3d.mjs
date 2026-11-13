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
  applyState,
  buildTown,
  buildProceduralStreetLight,
  buildProceduralBookshelf,
  buildProceduralOilLamp,
  buildProceduralTypewriter,
  buildProceduralTeapot,
  createCottage,
  createAvatarCapsule,
  getPlotTargetPosition,
  loadTownProps,
  updateTownAnimations,
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
    updateMatrix() {
      // Compose translation and scale into the matrix so tests can read
      // instance positions back from InstancedMesh.matrices. Rotation is
      // ignored: it never moves the translation part.
      const e = this.matrix.elements;
      e[0] = this.scale.x;
      e[5] = this.scale.y;
      e[10] = this.scale.z;
      e[12] = this.position.x;
      e[13] = this.position.y;
      e[14] = this.position.z;
      e[15] = 1;
    }
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
      // Real THREE copies the elements into the instance buffer; storing the
      // reference would leave every instance holding the last matrix written
      // (town.js reuses one dummy Object3D for all instances).
      this.matrices[index] = { elements: [...matrix.elements] };
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

  // Concept bandstand (Argon, 2026-11-12): timber A-frame roof, front steps,
  // brass pendant + lantern hardware, emissive post-lantern glass
  const aframeMesh = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_aframe')[0];
  const stepsMesh = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_steps')[0];
  const brassMesh = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_brass_fixtures')[0];
  const lanternGlass = collectNodes(parts.bandstand, (n) => n.name === 'bandstand_lantern_glass')[0];
  assert.ok(aframeMesh, 'Bandstand must have a timber A-frame roof (bandstand_aframe)');
  assert.ok(stepsMesh, 'Bandstand must have front steps and rim fascia (bandstand_steps)');
  assert.ok(brassMesh, 'Bandstand must have brass pendant and lantern hardware (bandstand_brass_fixtures)');
  assert.ok(lanternGlass && lanternGlass.material.emissive, 'Bandstand post lanterns must have emissive glass');

  // Stage props stay on: the Nightly Call card is the topic's physical home
  const callCard = collectNodes(parts.bandstand, (n) => n.name === 'nightly_call_card')[0];
  const samovar = collectNodes(parts.bandstand, (n) => n.name === 'copper_samovar')[0];
  assert.ok(callCard, 'Bandstand must keep the Nightly Call card (includeStageProps)');
  assert.ok(samovar, 'Bandstand must keep the copper samovar (includeStageProps)');

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

  // Milo's permanent ghost stands at spot 0: dome + flared sheet + short wisp,
  // face decal (starry eyes, smile, pink cheeks), translucent ice-blue,
  // facing the gate, footlight lit
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
  assert.ok(ghostBody.every((m) => m.material.opacity >= 0.8),
    'Ghost body must be solid enough to read ice-blue — 0.7 washed out live (2026-11-12)');
  assert.ok(ghostBody.every((m) => m.material.color === '#a8d8ea'),
    'Ghost body must be ice-blue');
  // Pure-decal mode (concept-ghost swap, 2026-11-12): the face decal carries
  // the eyes, so the old ghost_eye spheres are gone — they'd read as dark
  // blobs through the translucent sheet from behind or the side.
  const faceDecal = collectNodes(ghost, (n) => n.name === 'ghost_face_decal')[0];
  assert.ok(faceDecal, 'Ghost must have a front ghost_face_decal mesh');
  assert.ok(faceDecal.material.map, 'Ghost face decal must have a CanvasTexture map');
  const ghostEyes = collectNodes(ghost, (n) => n.name === 'ghost_eye');
  assert.equal(ghostEyes.length, 0, 'Ghost must not have eye spheres in pure-decal mode');
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
  const museSprites = collectNodes(muse, (n) => n.isSprite);
  const npcSprites = collectNodes(npc, (n) => n.isSprite);
  assert.equal(museSprites.length, 1);
  assert.equal(npcSprites.length, 1);

  assert.equal(muse.userData.nametagLift, 0);
  assert.equal(muse.userData.nametagSprite, museSprites[0]);
  assert.equal(museSprites[0].scale.x, 1.5);
  assert.equal(museSprites[0].scale.y, 0.375);
  assert.equal(museSprites[0].position.y, 1.8);

  const lifted = createAvatarCapsule(THREE, { handle: 'wick', role: 'npc', nametagLift: 0.5 });
  assert.equal(lifted.userData.nametagLift, 0.5);
  assert.equal(lifted.userData.nametagSprite.position.y, 2.3);
});

// Budget raised 80 -> 120 (owner decision, 2026-11-12): lit windows and the
// widow's-walk posts are worth their meshes, and Argon's review notes 120
// standard meshes run at 120fps on a 2015 integrated GPU. Still guards bloat.
// Budget raised 120 -> 125 (owner decision, 2026-11-12): the growth since 120
// is the completed planned prop set — slice 11 (street light + bookshelf) and
// slices 12–13 (the three seed NPC character props); no further prop slices are
// planned. 112 is the worst case (all procedural fallbacks) as live town swaps
// GLBs in for fewer — down from 122 after the 2026-11-12 concept-cottage swap
// (Argon's merged cottage replaces the old multi-mesh build), down one more
// after the concept-ghost swap the same night (pure-decal ghost: 4 meshes,
// no eye spheres), and down one more after the concept-bandstand swap
// (26 meshes + 4 stage props vs the old 31) — and 112 is under the
// 120fps/2015-iGPU reference point. 125 keeps the guardrail meaningful so
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

test('Slice 14: seed NPC wanderers and Milo ghost waypoints are layout-derived and within clearing bounds', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const { scene, parts } = town;

  for (const handle of ['wick', 'maren', 'tomas']) {
    const group = scene.children.find((c) => c.name === `avatar_${handle}`);
    assert.ok(group, `wanderer avatar_${handle} must be in scene`);
    assert.equal(parts.wanderers[handle], group, `parts.wanderers.${handle} must reference the scene group`);
    assert.equal(group.userData.role, 'npc', `${handle} wanderer must have role npc`);
    assert.equal(group.userData.handle, handle, `${handle} wanderer must have handle ${handle}`);
    const nametag = group.children.find((c) => c.name === 'nametag_sprite');
    assert.ok(nametag && nametag.isSprite, `${handle} wanderer must have nametag_sprite`);
    const expectedY = handle === 'maren' ? 1.8 : 2.3;
    assert.equal(nametag.position.y, expectedY, `${handle} wanderer nametag y must be ${expectedY}`);
    assert.equal(town._live?.avatars?.has(handle) ?? false, false, `${handle} wanderer must not be in live.avatars`);

    const plotLayout = TOWN_LAYOUT.plots.find((pl) => pl.plotNumber === SEED_HOME_PADS[handle]);
    const expectedHome = getPlotTargetPosition(plotLayout, 0);
    assert.ok(Math.hypot(group.position.x - expectedHome.x, group.position.z - expectedHome.z) < 1e-4,
      `${handle} must start at its home plot front`);
  }

  const maxR = TOWN_LAYOUT.clearingRadius - 1.5;
  for (const w of town._wander.figures) {
    assert.ok(w.waypoints.length >= 3, `${w.handle} must have at least 3 waypoints`);
    for (const wp of w.waypoints) {
      const r = Math.hypot(wp.x, wp.z);
      assert.ok(r <= maxR, `${w.handle} waypoint (${wp.x}, ${wp.z}) radius ${r} exceeds ${maxR}`);
    }
  }

  const ghostWander = town._wander.figures.find((w) => w.handle === 'milo');
  assert.ok(ghostWander, 'milo ghost must be in wander figures');
  const spot0 = parts.avatarSpots[0];
  const hasSpot0 = ghostWander.waypoints.some(
    (wp) => Math.abs(wp.x - spot0.x) < 1e-4 && Math.abs(wp.z - spot0.z) < 1e-4 && wp.y === spot0.y
  );
  assert.ok(hasSpot0, 'spot 0 must be in ghost waypoint loop');
  const spot0Wp = ghostWander.waypoints.find(
    (wp) => Math.abs(wp.x - spot0.x) < 1e-4 && Math.abs(wp.z - spot0.z) < 1e-4
  );
  for (const wp of ghostWander.waypoints) {
    assert.equal(wp.y, TOWN_LAYOUT.bandstand.height, 'every ghost waypoint must be at deck height 0.6');
    const r = Math.hypot(wp.x, wp.z);
    if (wp === spot0Wp) {
      assert.ok(r <= TOWN_LAYOUT.bandstand.radius, `spot 0 radius ${r} must be on bandstand`);
    } else {
      assert.ok(r <= 4.0, `ghost deck waypoint (${wp.x}, ${wp.z}) radius ${r} must be <= 4.0`);
      assert.ok(spot0Wp.linger > wp.linger, 'ghost must linger longest at spot 0');
    }
  }
});

test('Slice 14: wanderers move deterministically, linger, advance, and Milo returns home to spot 0', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const wickState = town._wander.figures.find((w) => w.handle === 'wick');
  const wickGroup = wickState.group;
  const startPos = { x: wickGroup.position.x, y: wickGroup.position.y, z: wickGroup.position.z };

  // dt <= 0 must not move anything
  updateTownAnimations(town, 0);
  updateTownAnimations(town, -0.5);
  assert.deepEqual(
    { x: wickGroup.position.x, y: wickGroup.position.y, z: wickGroup.position.z },
    startPos,
    'dt <= 0 must produce no movement'
  );

  // Step with fixed dt and verify step distance <= speed * dt + epsilon
  const dt = 0.1;
  const prev = { ...startPos };
  updateTownAnimations(town, dt);
  const moved = Math.hypot(wickGroup.position.x - prev.x, wickGroup.position.y - prev.y, wickGroup.position.z - prev.z);
  assert.ok(moved > 0, 'wick must move on positive dt');
  assert.ok(moved <= wickState.speed * dt + 1e-5, `step ${moved} exceeded speed*dt (${wickState.speed * dt})`);

  // Step until wick arrives at waypoint 1 (bandstand), lingers, and advances to waypoint 2 (newsstand)
  let arrivedAtBandstand = false;
  let advancedToNewsstand = false;
  for (let i = 0; i < 600; i++) {
    updateTownAnimations(town, 0.1);
    if (wickState.state === 'lingering' && wickState.targetIndex === 1) {
      arrivedAtBandstand = true;
    }
    if (arrivedAtBandstand && wickState.state === 'walking' && wickState.targetIndex === 2) {
      advancedToNewsstand = true;
      break;
    }
  }
  assert.ok(arrivedAtBandstand, 'wick must arrive and linger at bandstand');
  assert.ok(advancedToNewsstand, 'wick must advance toward newsstand after lingering');

  // Verify facing direction of travel within tolerance after several walking steps toward newsstand
  for (let i = 0; i < 10; i++) updateTownAnimations(town, 0.1);
  const newsstandWp = wickState.waypoints[2];
  const expectedYaw = Math.atan2(newsstandWp.x - wickGroup.position.x, newsstandWp.z - wickGroup.position.z);
  let yawDiff = Math.abs(((wickGroup.rotation.y - expectedYaw + Math.PI) % (Math.PI * 2)) - Math.PI);
  if (yawDiff > Math.PI) yawDiff = Math.abs(yawDiff - Math.PI * 2);
  assert.ok(yawDiff < 0.05, `wick rotation.y diff ${yawDiff} must face travel direction`);

  // Drive Milo's ghost through its loop until it returns to spot 0
  const ghostState = town._wander.figures.find((w) => w.handle === 'milo');
  const spot0 = town.parts.avatarSpots[0];
  let returnedHome = false;
  for (let i = 0; i < 1200; i++) {
    updateTownAnimations(town, 0.1);
    if (ghostState.targetIndex === 0 && ghostState.state === 'lingering') {
      returnedHome = true;
      break;
    }
  }
  assert.ok(returnedHome, 'milo ghost must complete loop and return to spot 0');
  assert.ok(
    Math.hypot(ghostState.group.position.x - spot0.x, ghostState.group.position.z - spot0.z) < 1e-4,
    'milo ghost must be at spot 0'
  );
  assert.equal(ghostState.group.position.y, spot0.y);
  assert.equal(town.parts.footlights[0].userData.lit, true, 'footlight 0 must remain lit');
});

test('Slice 14: wanderers yield to live presence avatars and resume from home when presence clears', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const wickState = town._wander.figures.find((w) => w.handle === 'wick');
  const wickGroup = wickState.group;
  const home = wickState.waypoints[0];

  // Move wick away from home first
  for (let i = 0; i < 20; i++) updateTownAnimations(town, 0.1);
  const awayPos = { x: wickGroup.position.x, y: wickGroup.position.y, z: wickGroup.position.z };
  assert.ok(Math.hypot(awayPos.x - home.x, awayPos.z - home.z) > 0.1, 'wick should have walked away from home');

  // Live presence arrives for wick
  applyState(town, {
    presence: [{ handle: 'wick', role: 'npc', zone: 'bandstand' }],
  });
  assert.equal(town._live.avatars.has('wick'), true);

  updateTownAnimations(town, 0.1);
  assert.equal(wickGroup.visible, false, 'wick wander figure must hide when live avatar is present');
  assert.deepEqual(
    { x: wickGroup.position.x, y: wickGroup.position.y, z: wickGroup.position.z },
    awayPos,
    'wick wander figure must not move while yielded'
  );

  // Live presence clears
  applyState(town, { presence: [] });
  assert.equal(town._live.avatars.has('wick'), false);

  updateTownAnimations(town, 0.1);
  assert.equal(wickGroup.visible, true, 'wick wander figure must be visible again after presence clears');
  assert.ok(
    Math.hypot(wickGroup.position.x - home.x, wickGroup.position.z - home.z) < 1e-4,
    'wick wander figure must reset to its home waypoint when resuming'
  );
});

test('Slice 15: newsstand paper stack sits on a wood shelf with two support brackets', () => {
  const THREE = createThreeStub();
  const { parts } = buildTown(THREE, { loadProps: false });
  const newsstand = parts.newsstand;
  const meshes = collectNodes(newsstand, (n) => n.isMesh);

  const booth = meshes.find((m) => m.geometry?.parameters?.width === 2.2);
  const papers = meshes.find((m) => m.material?.color === '#ebe4d1');
  const shelf = meshes.find((m) => m.name === 'newsstand_papers_shelf');
  const bracketL = meshes.find((m) => m.name === 'newsstand_papers_bracket_l');
  const bracketR = meshes.find((m) => m.name === 'newsstand_papers_bracket_r');

  assert.ok(booth, 'newsstand booth mesh must exist');
  assert.ok(papers, 'newsstand papers mesh must exist');
  assert.ok(shelf, 'newsstand_papers_shelf mesh must exist');
  assert.ok(bracketL, 'newsstand_papers_bracket_l mesh must exist');
  assert.ok(bracketR, 'newsstand_papers_bracket_r mesh must exist');

  assert.equal(shelf.material.color, booth.material.color, 'shelf must use booth wood color');
  assert.equal(bracketL.material.color, booth.material.color, 'left bracket must use booth wood color');
  assert.equal(bracketR.material.color, booth.material.color, 'right bracket must use booth wood color');

  const papersP = papers.geometry.parameters;
  const shelfP = shelf.geometry.parameters;
  const boothP = booth.geometry.parameters;

  const papersBottomY = papers.position.y - papersP.height / 2;
  const shelfTopY = shelf.position.y + shelfP.height / 2;
  const shelfBottomY = shelf.position.y - shelfP.height / 2;
  assert.ok(
    Math.abs(shelfTopY - papersBottomY) <= 0.03,
    `shelf top (${shelfTopY}) must meet papers bottom (${papersBottomY}) within 0.03m`
  );

  assert.ok(shelfP.width > papersP.width, 'shelf must be wider than papers');
  assert.ok(shelfP.depth > papersP.depth, 'shelf must be deeper than papers');
  assert.ok(
    shelf.position.x - shelfP.width / 2 < papers.position.x - papersP.width / 2 &&
    shelf.position.x + shelfP.width / 2 > papers.position.x + papersP.width / 2,
    'shelf X footprint must cover papers X footprint'
  );
  assert.ok(
    shelf.position.z - shelfP.depth / 2 < papers.position.z - papersP.depth / 2 &&
    shelf.position.z + shelfP.depth / 2 > papers.position.z + papersP.depth / 2,
    'shelf Z footprint must cover papers Z footprint'
  );

  const boothFrontZ = booth.position.z + boothP.depth / 2;
  for (const [label, b] of [['left', bracketL], ['right', bracketR]]) {
    const bP = b.geometry.parameters;
    const bTopY = b.position.y + bP.height / 2;
    const bBackZ = b.position.z - bP.depth / 2;
    assert.ok(
      Math.abs(bTopY - shelfBottomY) <= 0.01,
      `${label} bracket top (${bTopY}) must touch shelf underside (${shelfBottomY})`
    );
    assert.ok(
      Math.abs(bBackZ - boothFrontZ) <= 0.02,
      `${label} bracket back (${bBackZ}) must touch booth front face (${boothFrontZ})`
    );
    assert.ok(
      b.position.x >= shelf.position.x - shelfP.width / 2 &&
      b.position.x <= shelf.position.x + shelfP.width / 2,
      `${label} bracket must sit under the shelf width`
    );
  }
  assert.ok(
    bracketL.position.x < shelf.position.x && bracketR.position.x > shelf.position.x,
    'brackets must be positioned on opposite sides under the shelf'
  );
});

test('Slice 36: signpost text wraps deterministically without measureText', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const charBudget = (size) => Math.floor(480 / (0.6 * size));

  // 1. "OPEN PLOT #1" stays exactly 1 line at 28 px
  assert.ok(applyPlotManifest(town, 'signpost-open', { ...MILO_REBUILD_MANIFEST, signpost_text: 'OPEN PLOT #1' }));
  const openSign = collectNodes(town.scene, (n) => n.name === 'cottage_signpost' && n.userData?.signpostText === 'OPEN PLOT #1')[0];
  assert.ok(openSign, 'cottage_signpost with OPEN PLOT #1 must exist');
  assert.deepEqual(openSign.userData.signpostLines, ['OPEN PLOT #1']);
  assert.equal(openSign.userData.signpostFontSize, 28);

  // 2. "Milo — Ghostlight Cottage (rebuilt)" wraps to 2 lines at 28 px
  const miloText = 'Milo — Ghostlight Cottage (rebuilt)';
  assert.ok(applyPlotManifest(town, 'signpost-milo', { ...MILO_REBUILD_MANIFEST, signpost_text: miloText }));
  let sign = collectNodes(town.scene, (n) => n.userData?.signpostText === miloText)[0];
  assert.ok(sign, 'Milo signpost must exist after applyPlotManifest');
  assert.equal(sign.userData.signpostFontSize, 28);
  assert.equal(sign.userData.signpostLines.length, 2);
  assert.ok(sign.userData.signpostLines.every((l) => l.length > 0 && l.length <= 28));
  assert.equal(sign.userData.signpostLines.join(' ').replace(/\s+/g, ' '), miloText);

  // 3. 120-char signpost text fits in <= 3 lines within its font-size char budget
  const longText = 'The Grand Ghostlight Observatory & Archive of Midnight Cartography, Field Notes, Lanterns, and Quiet Tea Studies';
  const worstCase120 = (longText + ' ' + longText).slice(0, 120);
  assert.ok(applyPlotManifest(town, 'signpost-long', { ...MILO_REBUILD_MANIFEST, signpost_text: worstCase120 }));
  sign = collectNodes(town.scene, (n) => n.userData?.signpostText === worstCase120)[0];
  assert.ok(sign, '120-char signpost must exist');
  assert.ok([20, 24, 28].includes(sign.userData.signpostFontSize));
  assert.ok(sign.userData.signpostLines.length >= 1 && sign.userData.signpostLines.length <= 3);
  const longBudget = charBudget(sign.userData.signpostFontSize);
  assert.ok(
    sign.userData.signpostLines.every((l) => l.length > 0 && l.length <= longBudget),
    `every line must be non-empty and <= ${longBudget} chars`
  );

  // 4. Single 40-char word with no spaces splits by character and fits in <= 3 lines
  const word40 = 'A'.repeat(40);
  assert.ok(applyPlotManifest(town, 'signpost-word40', { ...MILO_REBUILD_MANIFEST, signpost_text: word40 }));
  sign = collectNodes(town.scene, (n) => n.userData?.signpostText === word40)[0];
  assert.ok(sign, '40-char word signpost must exist');
  assert.ok([20, 24, 28].includes(sign.userData.signpostFontSize));
  assert.ok(sign.userData.signpostLines.length >= 1 && sign.userData.signpostLines.length <= 3);
  const wordBudget = charBudget(sign.userData.signpostFontSize);
  assert.ok(
    sign.userData.signpostLines.every((l) => l.length > 0 && l.length <= wordBudget),
    `split word lines must be non-empty and <= ${wordBudget} chars`
  );
  assert.equal(sign.userData.signpostLines.join(''), word40);
});

test('Perimeter trees stand on the clearing ground: trunks inside clearingRadius, bases at y=0', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE, { loadProps: false });
  const trunks = collectNodes(town.scene, (n) => n.name === 'perimeter_tree_trunks')[0];
  assert.ok(trunks, 'perimeter_tree_trunks must exist');
  assert.equal(trunks.count, 18, 'there must be 18 perimeter trees');
  const trunkHalfHeight = 2.2 / 2; // CylinderGeometry height in addPerimeterScenery
  for (let i = 0; i < trunks.count; i++) {
    const e = trunks.matrices[i].elements;
    const r = Math.hypot(e[12], e[14]);
    assert.ok(r < TOWN_LAYOUT.clearingRadius, `tree ${i} trunk radius ${r} must be inside clearingRadius ${TOWN_LAYOUT.clearingRadius}`);
    // Trunk center y is 1.1 * scale and half-height is 1.1 * scale, so the base sits at y=0.
    const baseY = e[13] - trunkHalfHeight * e[5];
    assert.ok(Math.abs(baseY) < 1e-9, `tree ${i} trunk base must sit at y=0, got ${baseY}`);
  }
});
