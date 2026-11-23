import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildInteriorRoom,
  setInteriorVisible,
  setInteriorPalette,
  setInteriorDressing,
  buildProceduralOilLamp,
  buildProceduralTypewriter,
  buildProceduralTeapot,
} from './interior-room.mjs';

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
      this.emissive = opts.emissive;
      this.emissiveIntensity = opts.emissiveIntensity;
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
      this.visible = true;
      this.children = [];
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

function meshBounds(mesh) {
  const { x, y, z } = mesh.position;
  if (mesh.geometry.type === 'BoxGeometry') {
    const [w, h, d] = mesh.geometry.args;
    return {
      minX: x - w / 2,
      maxX: x + w / 2,
      minY: y - h / 2,
      maxY: y + h / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
    };
  }
  if (mesh.geometry.type === 'CylinderGeometry') {
    const [rt, rb, h] = mesh.geometry.args;
    const r = Math.max(rt, rb);
    return {
      minX: x - r,
      maxX: x + r,
      minY: y - h / 2,
      maxY: y + h / 2,
      minZ: z - r,
      maxZ: z + r,
    };
  }
  if (mesh.geometry.type === 'ConeGeometry') {
    const [r, h] = mesh.geometry.args;
    return {
      minX: x - r,
      maxX: x + r,
      minY: y - h / 2,
      maxY: y + h / 2,
      minZ: z - r,
      maxZ: z + r,
    };
  }
  throw new Error(`Unsupported geometry type: ${mesh.geometry.type}`);
}

function computeGroupBounds(group) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const ox = group.position?.x ?? 0;
  const oy = group.position?.y ?? 0;
  const oz = group.position?.z ?? 0;

  for (const child of group.children) {
    const b = Array.isArray(child.children) ? computeGroupBounds(child) : meshBounds(child);
    minX = Math.min(minX, b.minX + ox);
    maxX = Math.max(maxX, b.maxX + ox);
    minY = Math.min(minY, b.minY + oy);
    maxY = Math.max(maxY, b.maxY + oy);
    minZ = Math.min(minZ, b.minZ + oz);
    maxZ = Math.max(maxZ, b.maxZ + oz);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    sizeX: maxX - minX,
    sizeY: maxY - minY,
    sizeZ: maxZ - minZ,
  };
}

test('buildInteriorRoom builds interior_room hidden by default', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  assert.equal(room.name, 'interior_room');
  assert.equal(room.visible, false);
  assert.ok(room.children.length > 0);
});

test('setInteriorVisible toggles visibility and is null-safe', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  assert.equal(room.visible, false);

  assert.equal(setInteriorVisible(room, true), true);
  assert.equal(room.visible, true);

  assert.equal(setInteriorVisible(room, false), false);
  assert.equal(room.visible, false);

  assert.doesNotThrow(() => setInteriorVisible(null, true));
  assert.doesNotThrow(() => setInteriorVisible(undefined, false));
  assert.equal(setInteriorVisible(null, true), false);
});

test('room bounding box is 3.7 x 2.72 x 3.0 m and fits inside both kit (4.8 x 3.2) and Milo (4.0 x 3.4) wall boxes', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const bounds = computeGroupBounds(room);

  assert.ok(bounds.sizeX <= 4.0, `Expected sizeX <= 4.0 (Milo wall box), got ${bounds.sizeX}`);
  assert.ok(bounds.sizeZ <= 3.2, `Expected sizeZ <= 3.2 (kit wall box), got ${bounds.sizeZ}`);
  assert.ok(Math.abs(bounds.sizeX - 3.7) < 1e-9, `Expected floor width 3.7, got ${bounds.sizeX}`);
  assert.ok(Math.abs(bounds.sizeY - 2.72) < 1e-9, `Expected height 2.72, got ${bounds.sizeY}`);
  assert.ok(Math.abs(bounds.sizeZ - 3.0) < 1e-9, `Expected floor depth 3.0, got ${bounds.sizeZ}`);
  assert.ok(bounds.minY >= 0, `Expected minY >= 0, got ${bounds.minY}`);
});

test('front (+z) wall has a clear door gap for x in [-0.5, 0.5] and y in [0, 2.0]', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);

  const frontLeft = room.children.find((m) => m.name === 'interior_wall_front_left');
  const frontRight = room.children.find((m) => m.name === 'interior_wall_front_right');
  const frontLintel = room.children.find((m) => m.name === 'interior_wall_front_lintel');

  assert.ok(frontLeft, 'Expected interior_wall_front_left');
  assert.ok(frontRight, 'Expected interior_wall_front_right');
  assert.ok(frontLintel, 'Expected interior_wall_front_lintel');

  const bLeft = meshBounds(frontLeft);
  const bRight = meshBounds(frontRight);
  const bLintel = meshBounds(frontLintel);

  assert.ok(bLeft.maxX <= -0.5 + 1e-9, `Left front segment must end at x <= -0.5, got ${bLeft.maxX}`);
  assert.ok(bRight.minX >= 0.5 - 1e-9, `Right front segment must start at x >= 0.5, got ${bRight.minX}`);
  assert.ok(bLintel.minY >= 2.0 - 1e-9, `Front lintel must start at y >= 2.0, got ${bLintel.minY}`);

  // Verify no wall mesh in the entire room intersects the door opening volume (x in (-0.5, 0.5), y in (0, 2.0), z > 0)
  const frontWalls = room.children.filter((m) => m.name.startsWith('interior_wall_front'));
  for (const seg of frontWalls) {
    const b = meshBounds(seg);
    const overlapsX = b.minX < 0.5 - 1e-9 && b.maxX > -0.5 + 1e-9;
    const overlapsY = b.minY < 2.0 - 1e-9 && b.maxY > 0 + 1e-9;
    assert.equal(overlapsX && overlapsY, false, `${seg.name} overlaps door opening`);
  }
});

test('window glow meshes (2), open rafters, and furnishings (desk, rug, kettle) exist', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const byName = new Map(room.children.map((m) => [m.name, m]));

  const glows = room.children.filter((m) => m.name.startsWith('interior_window_glow_'));
  assert.equal(glows.length, 2);
  for (const glow of glows) {
    assert.equal(glow.material.emissive, '#ffbe5c');
    assert.equal(glow.material.emissiveIntensity, 1.4);
  }

  const rafters = room.children.filter((m) => m.name.startsWith('interior_rafter_'));
  assert.equal(rafters.length, 4);

  assert.ok(byName.has('interior_floor'));
  assert.ok(byName.has('interior_wall_back'));
  assert.ok(byName.has('interior_wall_left'));
  assert.ok(byName.has('interior_wall_right'));
  assert.ok(byName.has('interior_desk'));
  assert.ok(byName.has('interior_rug'));
  assert.equal(byName.has('interior_tea_kettle'), false, 'tea kettle moved into milo dressing group');

  const miloDressing = byName.get('interior_dressing_milo');
  assert.ok(miloDressing, 'Expected interior_dressing_milo');
  const kettle = miloDressing.children.find((m) => m.name === 'interior_tea_kettle');
  const cat = miloDressing.children.find((m) => m.name === 'interior_cat');
  assert.ok(kettle, 'Expected interior_tea_kettle inside interior_dressing_milo');
  assert.ok(cat, 'Expected interior_cat inside interior_dressing_milo');

  // Furnishings clear inner walls (x in [-1.73, 1.73], z in [-1.38, 1.38]) by >= 0.1 m
  const innerX = 3.7 / 2 - 0.12;
  const innerZ = 3.0 / 2 - 0.12;
  const furnishings = [
    ['interior_desk', byName.get('interior_desk')],
    ['interior_rug', byName.get('interior_rug')],
    ['interior_tea_kettle', kettle],
    ['interior_cat', cat],
  ];
  for (const [name, mesh] of furnishings) {
    const b = meshBounds(mesh);
    assert.ok(b.minX >= -innerX + 0.1 - 1e-9, `${name} too close to left wall`);
    assert.ok(b.maxX <= innerX - 0.1 + 1e-9, `${name} too close to right wall`);
    assert.ok(b.minZ >= -innerZ + 0.1 - 1e-9, `${name} too close to back wall`);
    assert.ok(b.maxZ <= innerZ - 0.1 + 1e-9, `${name} too close to front wall`);
  }
  for (const rafter of rafters) {
    const b = meshBounds(rafter);
    assert.ok(b.minZ >= -innerZ + 0.1 - 1e-9, `${rafter.name} too close to back wall`);
    assert.ok(b.maxZ <= innerZ - 0.1 + 1e-9, `${rafter.name} too close to front wall`);
  }

  // Milo palette applies ice-blue accent wall
  const miloRoom = buildInteriorRoom(THREE, { palette: 'milo' });
  const miloBack = miloRoom.children.find((m) => m.name === 'interior_wall_back');
  assert.equal(miloBack.material.color, '#a8d8ea');
});

test('setInteriorPalette recolors back wall only and is null-safe', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const backWall = room.children.find((m) => m.name === 'interior_wall_back');
  const leftWall = room.children.find((m) => m.name === 'interior_wall_left');

  assert.equal(backWall.material.color, '#f5efe0');

  const expectedByHandle = [
    ['milo', '#a8d8ea'],
    ['wick', '#c8922e'],
    ['maren', '#43505c'],
    ['tomas', '#b5633a'],
    ['default', '#f5efe0'],
    ['raul', '#f5efe0'],
    [undefined, '#f5efe0'],
  ];
  for (const [handle, expectedHex] of expectedByHandle) {
    assert.equal(setInteriorPalette(room, handle), true);
    assert.equal(backWall.material.color, expectedHex, `handle ${String(handle)} -> ${expectedHex}`);
    assert.equal(leftWall.material.color, '#f5efe0', `left wall unchanged for handle ${String(handle)}`);
  }

  assert.doesNotThrow(() => setInteriorPalette(null, 'milo'));
  assert.doesNotThrow(() => setInteriorPalette(undefined, 'default'));
  assert.equal(setInteriorPalette(null, 'milo'), false);
  assert.equal(setInteriorPalette({ children: [] }, 'milo'), false);
});

test('setInteriorDressing toggles per-handle groups, falls back to milo, is null-safe and idempotent', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const handles = ['milo', 'wick', 'maren', 'tomas'];
  const groups = Object.fromEntries(
    handles.map((h) => [h, room.children.find((c) => c.name === `interior_dressing_${h}`)])
  );

  // All 4 dressing groups exist and start hidden
  for (const h of handles) {
    assert.ok(groups[h], `Expected interior_dressing_${h}`);
    assert.equal(groups[h].visible, false, `interior_dressing_${h} must start hidden`);
  }

  // Each known handle shows only its group and hides the other three
  for (const h of handles) {
    assert.equal(setInteriorDressing(room, h), true);
    for (const other of handles) {
      assert.equal(groups[other].visible, other === h, `for handle '${h}', ${other}.visible`);
    }
  }

  // Unknown, undefined, and empty handles fall back to milo
  for (const fallbackHandle of ['raul', undefined, '']) {
    assert.equal(setInteriorDressing(room, 'wick'), true);
    assert.equal(setInteriorDressing(room, fallbackHandle), true);
    assert.equal(groups.milo.visible, true);
    assert.equal(groups.wick.visible, false);
    assert.equal(groups.maren.visible, false);
    assert.equal(groups.tomas.visible, false);
  }

  // Idempotent when called twice with the same handle
  assert.equal(setInteriorDressing(room, 'tomas'), true);
  assert.equal(setInteriorDressing(room, 'tomas'), true);
  assert.equal(groups.tomas.visible, true);
  assert.equal(groups.milo.visible, false);

  // Null-safe and missing-groups-safe
  assert.doesNotThrow(() => setInteriorDressing(null, 'milo'));
  assert.doesNotThrow(() => setInteriorDressing(undefined, 'wick'));
  assert.equal(setInteriorDressing(null, 'milo'), false);
  assert.equal(setInteriorDressing(undefined, 'wick'), false);
  assert.equal(setInteriorDressing({ children: [] }, 'milo'), false);

  // Kettle sits on desk top (minY === 0.8), cat stands on floor (minY === 0.08)
  const kettle = groups.milo.children.find((m) => m.name === 'interior_tea_kettle');
  const cat = groups.milo.children.find((m) => m.name === 'interior_cat');
  const kettleBounds = meshBounds(kettle);
  const catBounds = meshBounds(cat);
  assert.ok(Math.abs(kettleBounds.minY - 0.8) < 1e-9, `Expected kettle minY 0.8, got ${kettleBounds.minY}`);
  assert.ok(Math.abs(catBounds.minY - 0.08) < 1e-9, `Expected cat minY 0.08, got ${catBounds.minY}`);
});

test('vendored dressing builders in interior-room.mjs stay byte-identical to town-3d/town.js', async () => {
  const [townSrc, roomSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'interior-room.mjs'), 'utf8'),
  ]);
  for (const fnName of ['buildProceduralOilLamp', 'buildProceduralTypewriter', 'buildProceduralTeapot']) {
    const re = new RegExp(`export function ${fnName}\\(THREE\\)[\\s\\S]*?\\n\\}`);
    const townMatch = townSrc.match(re);
    const roomMatch = roomSrc.match(re);
    assert.ok(townMatch, `town-3d/town.js must export ${fnName}`);
    assert.ok(roomMatch, `staging-polyfork/interior-room.mjs must export ${fnName}`);
    assert.equal(roomMatch[0], townMatch[0], `${fnName} drifted from town-3d/town.js`);
  }
});

test('mesh count is bounded (<= 25)', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  assert.ok(room.children.length <= 25, `Expected <= 25 direct children, got ${room.children.length}`);
  assert.equal(room.children.length, 19);
});

test('interior-room.mjs contains no campfire term, fetch(, or Math.random', async () => {
  const src = await fs.readFile(path.join(__dirname, 'interior-room.mjs'), 'utf8');
  assert.equal(src.toLowerCase().includes('campfire'), false, 'Must not contain campfire');
  assert.equal(src.includes('fetch('), false, 'Must not contain fetch(');
  assert.equal(src.includes('Math.random'), false, 'Must not contain Math.random');
});

function assertNear(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`
  );
}

function assertBoxAt(mesh, expectedArgs, expectedPos, label) {
  assert.ok(mesh, `Expected ${label}`);
  assert.equal(mesh.geometry.type, 'BoxGeometry', `${label} geometry type`);
  assert.equal(mesh.geometry.args.length, 3, `${label} args length`);
  for (let i = 0; i < 3; i++) {
    assertNear(mesh.geometry.args[i], expectedArgs[i], `${label} arg[${i}]`);
  }
  assertNear(mesh.position.x, expectedPos[0], `${label} x`);
  assertNear(mesh.position.y, expectedPos[1], `${label} y`);
  assertNear(mesh.position.z, expectedPos[2], `${label} z`);
}

function assertCylinderAt(mesh, expectedArgs, expectedPos, label) {
  assert.ok(mesh, `Expected ${label}`);
  assert.equal(mesh.geometry.type, 'CylinderGeometry', `${label} geometry type`);
  assert.equal(mesh.geometry.args.length, 4, `${label} args length`);
  for (let i = 0; i < 4; i++) {
    assertNear(mesh.geometry.args[i], expectedArgs[i], `${label} arg[${i}]`);
  }
  assertNear(mesh.position.x, expectedPos[0], `${label} x`);
  assertNear(mesh.position.y, expectedPos[1], `${label} y`);
  assertNear(mesh.position.z, expectedPos[2], `${label} z`);
}

test('floor and wall geometry are exact', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const byName = new Map(room.children.map((m) => [m.name, m]));

  assertBoxAt(byName.get('interior_floor'), [3.7, 0.08, 3.0], [0, 0.04, 0], 'interior_floor');
  assertBoxAt(byName.get('interior_wall_back'), [3.7, 2.6, 0.12], [0, 1.3, -1.44], 'interior_wall_back');
  assertBoxAt(byName.get('interior_wall_left'), [0.12, 2.6, 2.76], [-1.79, 1.3, 0], 'interior_wall_left');
  assertBoxAt(byName.get('interior_wall_right'), [0.12, 2.6, 2.76], [1.79, 1.3, 0], 'interior_wall_right');
  assertBoxAt(byName.get('interior_wall_front_lintel'), [1.0, 0.6, 0.12], [0, 2.3, 1.44], 'interior_wall_front_lintel');
});

test('rafters are four, evenly spaced, peaking at 2.72', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const rafters = room.children.filter((m) => m.name.startsWith('interior_rafter_'));
  const expectedZ = [-1.05, -0.35, 0.35, 1.05];

  assert.equal(rafters.length, 4);
  for (let i = 0; i < expectedZ.length; i++) {
    const rafter = rafters[i];
    assert.equal(rafter.name, `interior_rafter_${i + 1}`);
    assertBoxAt(rafter, [3.46, 0.12, 0.14], [0, 2.66, expectedZ[i]], rafter.name);
    assertNear(meshBounds(rafter).maxY, 2.72, `${rafter.name} maxY`);
  }
});

test('window glows sit inside the side walls', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const leftGlow = room.children.find((m) => m.name === 'interior_window_glow_left');
  const rightGlow = room.children.find((m) => m.name === 'interior_window_glow_right');

  assertBoxAt(leftGlow, [0.02, 0.8, 0.9], [-1.72, 1.45, 0], 'interior_window_glow_left');
  assertBoxAt(rightGlow, [0.02, 0.8, 0.9], [1.72, 1.45, 0], 'interior_window_glow_right');

  for (const glow of [leftGlow, rightGlow]) {
    const b = meshBounds(glow);
    assert.ok(b.minX >= -1.73 - 1e-9, `${glow.name} minX ${b.minX} exceeds left inner wall`);
    assert.ok(b.maxX <= 1.73 + 1e-9, `${glow.name} maxX ${b.maxX} exceeds right inner wall`);
  }
});

test('dressing builders have the exact geometry, materials, and group offsets', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const byName = new Map(room.children.map((c) => [c.name, c]));

  const milo = byName.get('interior_dressing_milo');
  assertNear(milo.position.x, 0, 'milo.position.x');
  assertNear(milo.position.y, 0, 'milo.position.y');
  assertNear(milo.position.z, 0, 'milo.position.z');
  const kettle = milo.children.find((m) => m.name === 'interior_tea_kettle');
  const cat = milo.children.find((m) => m.name === 'interior_cat');
  assertCylinderAt(kettle, [0.14, 0.18, 0.24, 8], [-0.8, 0.92, -0.85], 'milo kettle');
  assert.ok(cat, 'Expected milo cat');
  assert.equal(cat.geometry.type, 'ConeGeometry');
  assert.deepEqual(cat.geometry.args, [0.16, 0.36, 6]);
  assertNear(cat.position.x, 1.35, 'milo cat x');
  assertNear(cat.position.y, 0.26, 'milo cat y');
  assertNear(cat.position.z, -0.9, 'milo cat z');

  const wick = byName.get('interior_dressing_wick');
  assertNear(wick.position.x, -0.8, 'wick.position.x');
  assertNear(wick.position.y, 0.8, 'wick.position.y');
  assertNear(wick.position.z, -0.85, 'wick.position.z');
  assert.equal(wick.children.length, 3);
  assertCylinderAt(wick.children[0], [0.14, 0.18, 0.14, 8], [0, 0.07, 0], 'wick base');
  assert.equal(wick.children[0].material.color, '#9a7b3e');
  assertCylinderAt(wick.children[1], [0.09, 0.12, 0.24, 8], [0, 0.26, 0], 'wick globe');
  assert.equal(wick.children[1].material.color, '#fff1c9');
  assert.equal(wick.children[1].material.emissive, '#ffcf70');
  assert.equal(wick.children[1].material.emissiveIntensity, 1.1);
  assertBoxAt(wick.children[2], [0.04, 0.18, 0.04], [0.13, 0.22, 0], 'wick handle');
  assert.equal(wick.children[2].material.color, '#9a7b3e');

  const maren = byName.get('interior_dressing_maren');
  assertNear(maren.position.x, -0.8, 'maren.position.x');
  assertNear(maren.position.y, 0.8, 'maren.position.y');
  assertNear(maren.position.z, -0.85, 'maren.position.z');
  assert.equal(maren.children.length, 3);
  assertBoxAt(maren.children[0], [0.7, 0.08, 0.55], [0, 0.04, 0], 'maren stand');
  assert.equal(maren.children[0].material.color, '#6b492b');
  assertBoxAt(maren.children[1], [0.46, 0.18, 0.36], [0, 0.17, 0], 'maren body');
  assert.equal(maren.children[1].material.color, '#2b2f33');
  assertCylinderAt(maren.children[2], [0.05, 0.05, 0.42, 8], [0, 0.28, -0.1], 'maren roller');
  assertNear(maren.children[2].rotation.z, Math.PI / 2, 'maren roller rotation.z');
  assert.equal(maren.children[2].material.color, '#d8d2c5');

  const tomas = byName.get('interior_dressing_tomas');
  assertNear(tomas.position.x, -0.8, 'tomas.position.x');
  assertNear(tomas.position.y, 0.8, 'tomas.position.y');
  assertNear(tomas.position.z, -0.85, 'tomas.position.z');
  assert.equal(tomas.children.length, 3);
  assertCylinderAt(tomas.children[0], [0.16, 0.2, 0.28, 8], [0, 0.14, 0], 'tomas body');
  assert.equal(tomas.children[0].material.color, '#8f6b47');
  assertBoxAt(tomas.children[1], [0.14, 0.05, 0.05], [0.2, 0.18, 0], 'tomas spout');
  assert.equal(tomas.children[1].material.color, '#8f6b47');
  assertCylinderAt(tomas.children[2], [0.06, 0.12, 0.08, 8], [0, 0.32, 0], 'tomas lid');
  assert.equal(tomas.children[2].material.color, '#8f6b47');
});

test("every dressing group's world bounds fit the room", () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const handles = ['milo', 'wick', 'maren', 'tomas'];

  for (const h of handles) {
    const group = room.children.find((c) => c.name === `interior_dressing_${h}`);
    const b = computeGroupBounds(group);
    assert.ok(b.minX >= -1.73 - 1e-9, `${h} minX ${b.minX} outside room`);
    assert.ok(b.maxX <= 1.73 + 1e-9, `${h} maxX ${b.maxX} outside room`);
    assert.ok(b.minZ >= -1.38 - 1e-9, `${h} minZ ${b.minZ} outside room`);
    assert.ok(b.maxZ <= 1.38 + 1e-9, `${h} maxZ ${b.maxZ} outside room`);
    assert.ok(b.maxY <= 2.72 + 1e-9, `${h} maxY ${b.maxY} exceeds rafter peak`);
  }

  const wick = room.children.find((c) => c.name === 'interior_dressing_wick');
  const maren = room.children.find((c) => c.name === 'interior_dressing_maren');
  const tomas = room.children.find((c) => c.name === 'interior_dressing_tomas');

  assertNear(computeGroupBounds(wick).maxY, 1.18, 'wick globe world top');
  const roller = maren.children[2];
  assertNear(maren.position.y + roller.position.y + roller.geometry.args[0], 1.13, 'maren roller world top');
  assertNear(computeGroupBounds(tomas).maxY, 1.16, 'tomas lid world top');
});

test('setter edge cases: non-object rooms, plain-color assignment, partial dressing groups, build-time palette', () => {
  const THREE = makeFakeThree();

  // (a) non-object rooms in setInteriorVisible
  assert.doesNotThrow(() => setInteriorVisible(42, true));
  assert.doesNotThrow(() => setInteriorVisible('room', true));
  assert.equal(setInteriorVisible(42, true), false);
  assert.equal(setInteriorVisible('room', true), false);

  // (b) plain-color assignment and missing material in setInteriorPalette
  const plainRoom = { children: [{ name: 'interior_wall_back', material: { color: '#f5efe0' } }] };
  assert.equal(setInteriorPalette(plainRoom, 'wick'), true);
  assert.equal(plainRoom.children[0].material.color, '#c8922e');

  const noMatRoom = { children: [{ name: 'interior_wall_back' }] };
  assert.equal(setInteriorPalette(noMatRoom, 'milo'), false);

  // (c) partial dressing groups in setInteriorDressing
  const partialRoom = { children: [{ name: 'interior_dressing_milo', visible: false }] };
  assert.equal(setInteriorDressing(partialRoom, 'milo'), false);

  // (d) build-time palette only applies accent for 'milo'
  for (const opts of [{ palette: 'wick' }, undefined, { palette: undefined }]) {
    const r = buildInteriorRoom(THREE, opts);
    const back = r.children.find((m) => m.name === 'interior_wall_back');
    assert.equal(back.material.color, '#f5efe0');
  }
});

test('direct children are the exact 19 named meshes and groups in build order', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  assert.equal(room.children.length, 19);
  assert.deepEqual(
    room.children.map((c) => c.name),
    [
      'interior_floor',
      'interior_wall_back',
      'interior_wall_left',
      'interior_wall_right',
      'interior_wall_front_left',
      'interior_wall_front_right',
      'interior_wall_front_lintel',
      'interior_window_glow_left',
      'interior_window_glow_right',
      'interior_rafter_1',
      'interior_rafter_2',
      'interior_rafter_3',
      'interior_rafter_4',
      'interior_desk',
      'interior_rug',
      'interior_dressing_milo',
      'interior_dressing_wick',
      'interior_dressing_maren',
      'interior_dressing_tomas',
    ]
  );
});

test('desk and rug have exact geometry, positions, and materials', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const desk = room.children.find((c) => c.name === 'interior_desk');
  const rug = room.children.find((c) => c.name === 'interior_rug');

  assertBoxAt(desk, [1.1, 0.72, 0.6], [-0.95, 0.44, -0.85], 'interior_desk');
  assert.equal(desk.material.color, '#6b492b');
  assertNear(desk.material.opts.roughness, 0.85, 'desk roughness');

  assertBoxAt(rug, [1.6, 0.04, 1.1], [0.25, 0.1, 0.15], 'interior_rug');
  assert.equal(rug.material.color, '#5a4332');
  assertNear(rug.material.opts.roughness, 0.95, 'rug roughness');
});

test('front wall segments have exact geometry and plaster material', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const frontLeft = room.children.find((c) => c.name === 'interior_wall_front_left');
  const frontRight = room.children.find((c) => c.name === 'interior_wall_front_right');

  assertBoxAt(frontLeft, [1.35, 2.6, 0.12], [-1.175, 1.3, 1.44], 'interior_wall_front_left');
  assertBoxAt(frontRight, [1.35, 2.6, 0.12], [1.175, 1.3, 1.44], 'interior_wall_front_right');
  assert.equal(frontLeft.material.color, '#f5efe0');
  assert.equal(frontRight.material.color, '#f5efe0');
});

test('material roughness ledger matches the palette', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const byName = new Map(room.children.map((c) => [c.name, c]));

  assertNear(byName.get('interior_floor').material.opts.roughness, 0.85, 'floor roughness');
  assertNear(byName.get('interior_wall_back').material.opts.roughness, 0.9, 'back wall roughness');
  assertNear(byName.get('interior_wall_left').material.opts.roughness, 0.9, 'left wall roughness');
  assertNear(byName.get('interior_window_glow_left').material.opts.roughness, 0.4, 'window glow roughness');

  const milo = byName.get('interior_dressing_milo');
  const kettle = milo.children.find((c) => c.name === 'interior_tea_kettle');
  const cat = milo.children.find((c) => c.name === 'interior_cat');
  assertNear(kettle.material.opts.roughness, 0.5, 'milo kettle roughness');
  assertNear(cat.material.opts.roughness, 0.85, 'milo cat roughness');

  const lamp = buildProceduralOilLamp(THREE);
  assertNear(lamp.children[0].material.opts.roughness, 0.65, 'oil lamp brass roughness');
  assert.equal(lamp.children[1].material.opts.roughness, undefined, 'oil lamp glass globe has no roughness');

  const typewriter = buildProceduralTypewriter(THREE);
  assertNear(typewriter.children[0].material.opts.roughness, 0.88, 'typewriter stand roughness');
  assertNear(typewriter.children[1].material.opts.roughness, 0.75, 'typewriter body roughness');
  assertNear(typewriter.children[2].material.opts.roughness, 0.8, 'typewriter roller roughness');

  const teapot = buildProceduralTeapot(THREE);
  assertNear(teapot.children[0].material.opts.roughness, 0.65, 'teapot body roughness');
});

test('build-time palette and setInteriorPalette edge cases fall back to plaster', () => {
  const THREE = makeFakeThree();

  for (const opts of [null, { palette: 'MILO' }, { palette: 42 }, { palette: '' }, {}]) {
    const r = buildInteriorRoom(THREE, opts);
    const back = r.children.find((c) => c.name === 'interior_wall_back');
    assert.equal(back.material.color, '#f5efe0', `buildInteriorRoom(${JSON.stringify(opts)})`);
  }

  const room = buildInteriorRoom(THREE);
  const backWall = room.children.find((c) => c.name === 'interior_wall_back');
  for (const p of [null, 42, 'Milo', 'WICK', '']) {
    assert.equal(setInteriorPalette(room, 'milo'), true);
    assert.equal(setInteriorPalette(room, p), true);
    assert.equal(backWall.material.color, '#f5efe0', `setInteriorPalette(${String(p)})`);
  }

  assert.equal(setInteriorPalette({ children: 'x' }, 'milo'), false);
  assert.equal(setInteriorPalette({ children: [{ name: 'other' }] }, 'milo'), false);
  assert.equal(setInteriorPalette({ children: [{ name: 'interior_wall_back' }] }, 'milo'), false);
});

test('setter coercion and dressing edges', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);

  for (const [input, expected] of [
    [1, true],
    [0, false],
    ['yes', true],
    ['', false],
    [undefined, false],
    [null, false],
  ]) {
    assert.equal(setInteriorVisible(room, input), expected);
    assert.equal(room.visible, expected);
  }

  const handles = ['milo', 'wick', 'maren', 'tomas'];
  const groups = Object.fromEntries(
    handles.map((h) => [h, room.children.find((c) => c.name === `interior_dressing_${h}`)])
  );
  for (const badHandle of [42, 'MILO', null]) {
    assert.equal(setInteriorDressing(room, 'wick'), true);
    assert.equal(setInteriorDressing(room, badHandle), true);
    assert.equal(groups.milo.visible, true);
    assert.equal(groups.wick.visible, false);
    assert.equal(groups.maren.visible, false);
    assert.equal(groups.tomas.visible, false);
  }

  const roomWithExtras = buildInteriorRoom(THREE);
  const marker = { name: 'extra_prop', visible: false };
  roomWithExtras.children.unshift(null, undefined, marker);
  assert.equal(setInteriorDressing(roomWithExtras, 'tomas'), true);
  const tomasGroup = roomWithExtras.children.find((c) => c && c.name === 'interior_dressing_tomas');
  assert.equal(tomasGroup.visible, true);
  assert.equal(marker.visible, false);

  for (const builder of [buildProceduralOilLamp, buildProceduralTypewriter, buildProceduralTeapot]) {
    const group = builder(THREE);
    assert.equal(group.name, '');
    assert.equal(group.visible, true);
    assert.equal(group.children.length, 3);
  }
});

test('interior accent colors match the plot manifests', async () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const backWall = room.children.find((m) => m.name === 'interior_wall_back');

  const manifestFields = [
    ['milo', 'wall'],
    ['wick', 'trim'],
    ['maren', 'roof'],
    ['tomas', 'roof'],
  ];
  const manifestColors = {};
  for (const [handle, field] of manifestFields) {
    const raw = await fs.readFile(
      path.join(REPO_ROOT, 'town-npc', 'plots', handle, 'manifest.json'),
      'utf8'
    );
    const manifest = JSON.parse(raw);
    const expected = manifest[field];
    manifestColors[handle] = expected;
    assert.equal(setInteriorPalette(room, handle), true);
    assert.equal(backWall.material.color, expected, `${handle} manifest ${field}`);
  }

  const miloRoom = buildInteriorRoom(THREE, { palette: 'milo' });
  const miloBack = miloRoom.children.find((m) => m.name === 'interior_wall_back');
  assert.equal(miloBack.material.color, '#a8d8ea');
  assert.equal(miloBack.material.color, manifestColors.milo);
});

test('every hex in interior-room.mjs is a ledgered CONCEPT.md color', async () => {
  const [roomSrc, conceptSrc] = await Promise.all([
    fs.readFile(path.join(__dirname, 'interior-room.mjs'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'CONCEPT.md'), 'utf8'),
  ]);

  const found = [...new Set((roomSrc.match(/#[0-9a-fA-F]{6}/g) ?? []).map((h) => h.toLowerCase()))].sort();

  // CONCEPT.md palette (#6b492b #f5efe0 #a8d8ea #c8922e #43505c #b5633a #ffbe5c #5a4332),
  // brass (#b59449), cat (#2b2b2b), vendored dressing colors (#9a7b3e #fff1c9 #ffcf70 #2b2f33 #d8d2c5 #8f6b47).
  const vendored = ['#9a7b3e', '#fff1c9', '#ffcf70', '#2b2f33', '#d8d2c5', '#8f6b47'];
  const allowed = [
    '#6b492b',
    '#f5efe0',
    '#a8d8ea',
    '#c8922e',
    '#43505c',
    '#b5633a',
    '#ffbe5c',
    '#5a4332',
    '#b59449',
    '#2b2b2b',
    ...vendored,
  ].sort();

  assert.equal(found.length, 16);
  assert.deepEqual(found, allowed);

  const conceptLower = conceptSrc.toLowerCase();
  for (const hex of vendored) {
    assert.ok(conceptLower.includes(hex), `CONCEPT.md must name vendored dressing color ${hex}`);
  }
});

test('shared material instances', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const byName = new Map(room.children.map((c) => [c.name, c]));

  const woodMat = byName.get('interior_floor').material;
  for (const name of [
    'interior_rafter_1',
    'interior_rafter_2',
    'interior_rafter_3',
    'interior_rafter_4',
    'interior_desk',
  ]) {
    assert.equal(byName.get(name).material, woodMat, `${name} must share woodMat`);
  }

  const plasterMat = byName.get('interior_wall_left').material;
  for (const name of [
    'interior_wall_right',
    'interior_wall_front_left',
    'interior_wall_front_right',
    'interior_wall_front_lintel',
  ]) {
    assert.equal(byName.get(name).material, plasterMat, `${name} must share plasterMat`);
  }

  const backMat = byName.get('interior_wall_back').material;
  assert.equal(backMat.color, plasterMat.color);
  assert.notEqual(backMat, plasterMat, 'back wall accentMat must be distinct from plasterMat');

  const glowMat = byName.get('interior_window_glow_left').material;
  assert.equal(byName.get('interior_window_glow_right').material, glowMat, 'window glows must share glowMat');
  assert.notEqual(glowMat, woodMat, 'glowMat must be distinct from woodMat');
  assert.notEqual(glowMat, plasterMat, 'glowMat must be distinct from plasterMat');
});

test('furniture rests exactly on surfaces, nothing floats or sinks', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const byName = new Map(room.children.map((c) => [c.name, c]));

  const floorTop = meshBounds(byName.get('interior_floor')).maxY;
  assertNear(floorTop, 0.08, 'floor top');
  assertNear(meshBounds(byName.get('interior_desk')).minY, floorTop, 'desk minY');
  assertNear(meshBounds(byName.get('interior_rug')).minY, floorTop, 'rug minY');

  const miloCat = byName.get('interior_dressing_milo').children.find((m) => m.name === 'interior_cat');
  assertNear(meshBounds(miloCat).minY, floorTop, 'milo cat minY');

  const deskTop = meshBounds(byName.get('interior_desk')).maxY;
  assertNear(deskTop, 0.8, 'desk top');

  for (const handle of ['wick', 'maren', 'tomas']) {
    const group = byName.get(`interior_dressing_${handle}`);
    const worldBase = group.position.y + Math.min(...group.children.map((c) => meshBounds(c).minY));
    assertNear(worldBase, deskTop, `${handle} dressing world base`);
  }
});

test('rafters rest exactly on wall tops', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const rafters = room.children.filter((m) => m.name.startsWith('interior_rafter_'));
  assert.equal(rafters.length, 4);

  for (const rafter of rafters) {
    const b = meshBounds(rafter);
    assertNear(b.minY, 2.6, `${rafter.name} minY`);
    assertNear(b.maxY, 2.72, `${rafter.name} maxY`);
    assertNear(b.maxX - b.minX, 3.46, `${rafter.name} length`);
  }
});

test('interior-room.mjs stays dependency-free with exactly 7 exports', async () => {
  const src = await fs.readFile(path.join(__dirname, 'interior-room.mjs'), 'utf8');
  assert.equal(/^\s*import\s/m.test(src), false, 'Must not contain import statements');
  assert.equal(src.includes('require('), false, 'Must not contain require(');

  const mod = await import('./interior-room.mjs');
  assert.deepEqual(Object.keys(mod).sort(), [
    'buildInteriorRoom',
    'buildProceduralOilLamp',
    'buildProceduralTeapot',
    'buildProceduralTypewriter',
    'setInteriorDressing',
    'setInteriorPalette',
    'setInteriorVisible',
  ]);
});
