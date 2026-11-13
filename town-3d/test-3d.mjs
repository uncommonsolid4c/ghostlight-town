import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TOWN_LAYOUT,
  MILO_REBUILD_MANIFEST,
  buildTown,
  createCottage,
  createAvatarCapsule,
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
test('Draw-call budget: total mesh count in built town is < 120', () => {
  const THREE = createThreeStub();
  const { scene } = buildTown(THREE);
  const meshes = collectNodes(scene, (n) => n.isMesh);
  assert.ok(meshes.length < 120, `Expected < 120 meshes, got ${meshes.length}`);
});

test('No campfire terminology, no .glb references, and no fetch() in town.js', async () => {
  const townJs = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');
  const indexHtml = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');

  assert.equal(/campfire/i.test(townJs), false, 'town.js must not contain campfire terminology');
  assert.equal(/campfire/i.test(indexHtml), false, 'index.html must not contain campfire terminology');
  assert.equal(/\.glb/i.test(townJs), false, 'town.js must not reference .glb');
  assert.equal(/\bfetch\s*\(/.test(townJs), false, 'town.js must not call fetch() in slice 4a');
});

test('Pinned Three.js CDN import-map URL resolves with HTTP 200', async () => {
  const indexHtml = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const match = indexHtml.match(/"three":\s*"([^"]+)"/);
  assert.ok(match, 'index.html importmap must pin "three"');
  const cdnUrl = match[1];
  assert.equal(cdnUrl, 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');

  const res = await fetch(cdnUrl, { method: 'HEAD' });
  assert.equal(res.status, 200, `Expected HTTP 200 from ${cdnUrl}, got ${res.status}`);
});
