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
