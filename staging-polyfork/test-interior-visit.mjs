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
import {
  isDoorHit,
  rayHitsInteriorDoor,
  createInteriorVisit,
  INTERIOR_LOOK_SENSITIVITY,
  INTERIOR_PITCH_LIMIT,
} from './interior-visit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeVec3(x = 0, y = 0, z = 0) {
  return {
    x,
    y,
    z,
    set(nx, ny, nz) {
      this.x = nx;
      this.y = ny;
      this.z = nz;
      return this;
    },
    copy(other) {
      this.x = other.x;
      this.y = other.y;
      this.z = other.z;
      return this;
    },
    clone() {
      return makeVec3(this.x, this.y, this.z);
    },
  };
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
      this.position = makeVec3();
      this.rotation = { x: 0, y: 0, z: 0 };
      this.parent = null;
      this.children = [];
    }
    add(child) {
      child.parent = this;
      this.children.push(child);
    }
  }
  class Group {
    constructor() {
      this.name = '';
      this.visible = true;
      this.children = [];
      this.position = makeVec3();
      this.rotation = { x: 0, y: 0, z: 0 };
      this.userData = {};
      this.parent = null;
    }
    add(child) {
      child.parent = this;
      this.children.push(child);
    }
    worldToLocal(vec) {
      const dx = vec.x - this.position.x;
      const dy = vec.y - this.position.y;
      const dz = vec.z - this.position.z;
      const ry = -(this.rotation?.y ?? 0);
      const cos = Math.cos(ry);
      const sin = Math.sin(ry);
      vec.x = dx * cos + dz * sin;
      vec.y = dy;
      vec.z = -dx * sin + dz * cos;
      return vec;
    }
    localToWorld(vec) {
      const ry = this.rotation?.y ?? 0;
      const cos = Math.cos(ry);
      const sin = Math.sin(ry);
      const wx = this.position.x + vec.x * cos + vec.z * sin;
      const wy = this.position.y + vec.y;
      const wz = this.position.z - vec.x * sin + vec.z * cos;
      vec.x = wx;
      vec.y = wy;
      vec.z = wz;
      return vec;
    }
  }
  return { BoxGeometry, CylinderGeometry, ConeGeometry, MeshStandardMaterial, Mesh, Group };
}

function makeFakeCameraAndControls() {
  const camera = {
    position: makeVec3(0, 26, 58),
    lookAtCalls: [],
    lookAt(x, y, z) {
      this.lookAtCalls.push({ x, y, z });
    },
  };
  const controls = {
    target: makeVec3(0, 2, 0),
    enabled: true,
  };
  return { camera, controls };
}

test('isDoorHit detects named door / door-leaf ancestors on kit cottages', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  cottage.userData = { clickable: true, kind: 'cottage', handle: 'ada' };

  const door = new THREE.Group();
  door.name = 'door';
  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), {});
  doorLeaf.name = 'door-leaf';
  const handleMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), {});
  handleMesh.name = 'door-handle';

  door.add(doorLeaf);
  doorLeaf.add(handleMesh);
  cottage.add(door);

  assert.equal(isDoorHit(cottage, { object: doorLeaf, point: makeVec3(0, 1, 0) }), true);
  assert.equal(isDoorHit(cottage, { object: handleMesh, point: makeVec3(0, 1, 0) }), true);
  assert.equal(isDoorHit(cottage, { object: door, point: makeVec3(0, 1, 0) }), true);
});

test('isDoorHit detects local-rect door hits for Milo (frontZ 1.70) and kit cottages (frontZ 1.60)', () => {
  const THREE = makeFakeThree();

  const milo = new THREE.Group();
  milo.userData = { clickable: true, kind: 'cottage', handle: 'milo' };
  milo.position.set(17.92, 0, 4.6);
  milo.rotation.y = Math.PI / 4;

  // Local (0, 1.0, 1.70) transformed to world
  const miloDoorWorld = milo.localToWorld(makeVec3(0, 1.0, 1.70));
  assert.equal(isDoorHit(milo, { object: milo, point: miloDoorWorld }), true);

  // Just inside z tolerance: 1.70 - 0.2 = 1.50
  const miloEdgeWorld = milo.localToWorld(makeVec3(0.55, 2.05, 1.50));
  assert.equal(isDoorHit(milo, { object: milo, point: miloEdgeWorld }), true);

  // Too far back in z for Milo (1.45 < 1.50), even though it would pass kit (1.60 - 0.2 = 1.40)
  const miloTooFarBack = milo.localToWorld(makeVec3(0, 1.0, 1.45));
  assert.equal(isDoorHit(milo, { object: milo, point: miloTooFarBack }), false);

  // Kit cottage fallback (frontZ 1.60 -> z >= 1.40)
  const kit = new THREE.Group();
  kit.userData = { clickable: true, kind: 'cottage', handle: 'ada' };
  const kitShell = new THREE.Mesh(new THREE.BoxGeometry(4.8, 3, 3.2), {});
  kitShell.name = 'cottage-shell';
  kit.add(kitShell);
  assert.equal(isDoorHit(kit, { object: kitShell, point: makeVec3(0, 1.0, 1.45) }), true);

  // Headless stub without worldToLocal accepts pre-transformed local point
  const stubCottage = { userData: { handle: 'milo' } };
  assert.equal(isDoorHit(stubCottage, { object: stubCottage, point: { x: 0, y: 1.0, z: 1.70 } }), true);
});

test('isDoorHit returns false for non-door taps (side wall, roof, ground in front)', () => {
  const THREE = makeFakeThree();
  const milo = new THREE.Group();
  milo.userData = { clickable: true, kind: 'cottage', handle: 'milo' };
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3.4), {});
  wall.name = 'milo-walls';
  milo.add(wall);

  // Wall beside the door (|x| > 0.6)
  assert.equal(isDoorHit(milo, { object: wall, point: makeVec3(1.1, 1.0, 1.70) }), false);
  // Roof above the door (y > 2.1)
  assert.equal(isDoorHit(milo, { object: wall, point: makeVec3(0, 2.8, 1.70) }), false);
  // Ground in front of the cottage (y < 0)
  assert.equal(isDoorHit(milo, { object: wall, point: makeVec3(0, -0.05, 1.80) }), false);
  // Null safety
  assert.equal(isDoorHit(null, { object: wall, point: makeVec3(0, 1, 1.7) }), false);
  assert.equal(isDoorHit(milo, null), false);
});

test('enter positions/rotates/shows room, sets palette, cuts camera inside room bounds, and disables controls', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });

  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };
  milo.position.set(17.92, 0.25, 4.6);
  milo.rotation.y = Math.PI / 2;

  assert.equal(visit.isInside(), false);
  assert.equal(visit.enter(milo), true);
  assert.equal(visit.isInside(), true);

  assert.equal(room.visible, true);
  assert.equal(room.position.x, 17.92);
  assert.equal(room.position.y, 0.25);
  assert.equal(room.position.z, 4.6);
  assert.equal(room.rotation.y, Math.PI / 2);

  const backWall = room.children.find((m) => m.name === 'interior_wall_back');
  assert.equal(backWall.material.color, '#a8d8ea');
  assert.equal(controls.enabled, false);

  // Transform camera position back into room-local space and verify it is inside 3.7 x 2.6 x 3.0 bounds
  const localCam = room.worldToLocal(camera.position.clone());
  assert.ok(Math.abs(localCam.x) < 3.7 / 2 - 0.12, `localCam.x out of bounds: ${localCam.x}`);
  assert.ok(localCam.y > 0.08 && localCam.y < 2.6, `localCam.y out of bounds: ${localCam.y}`);
  assert.ok(Math.abs(localCam.z) < 3.0 / 2 - 0.12, `localCam.z out of bounds: ${localCam.z}`);

  const localTarget = room.worldToLocal(controls.target.clone());
  assert.ok(Math.abs(localTarget.x - 0) < 1e-6);
  assert.ok(Math.abs(localTarget.y - 1.15) < 1e-6);
  assert.ok(Math.abs(localTarget.z - -1.3) < 1e-6);
});

test('exit hides room, restores saved camera position and target exactly, and re-enables controls', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE, { palette: 'milo' });
  const { camera, controls } = makeFakeCameraAndControls();
  camera.position.set(12.5, 8.25, -14.75);
  controls.target.set(3.5, 1.5, -2.5);

  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });

  const resident = new THREE.Group();
  resident.userData = { handle: 'ada' };
  resident.position.set(-10, 0, -8);
  resident.rotation.y = 0.4;

  assert.equal(visit.enter(resident), true);
  const backWall = room.children.find((m) => m.name === 'interior_wall_back');
  assert.equal(backWall.material.color, '#f5efe0');

  assert.equal(visit.exit(), true);
  assert.equal(visit.isInside(), false);
  assert.equal(room.visible, false);
  assert.equal(controls.enabled, true);
  assert.deepEqual(
    { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    { x: 12.5, y: 8.25, z: -14.75 }
  );
  assert.deepEqual(
    { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    { x: 3.5, y: 1.5, z: -2.5 }
  );
});

test('enter while inside and exit while outside are no-ops', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });

  // Exit while outside is a no-op
  assert.equal(visit.exit(), false);
  assert.equal(visit.isInside(), false);
  assert.equal(controls.enabled, true);

  const first = new THREE.Group();
  first.userData = { handle: 'milo' };
  first.position.set(17.92, 0, 4.6);

  const second = new THREE.Group();
  second.userData = { handle: 'ada' };
  second.position.set(-10, 0, -8);

  assert.equal(visit.enter(first), true);
  // Enter while inside is a no-op (does not move room or overwrite saved pose)
  assert.equal(visit.enter(second), false);
  assert.equal(room.position.x, 17.92);
  assert.equal(room.position.z, 4.6);

  assert.equal(visit.exit(), true);
  assert.deepEqual(
    { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    { x: 0, y: 26, z: 58 }
  );
});

test('rayHitsInteriorDoor hits front doorway gap and rejects misses, rotated rooms, stubs, and nulls', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);

  // a. Straight ahead through the gap
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }),
    true
  );

  // b. Ray pointing away from the front (-z)
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: -1 }),
    false
  );

  // c. Ray parallel to the front plane (dz = 0)
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, { x: 1, y: 0, z: 0 }),
    false
  );

  // d. Ray through the plane at x = 0.9 (beside the door, |x| > 0.5)
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0.9, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }),
    false
  );

  // e. Ray through the plane above the door (y = 2.5) and at the lintel (y = 2.3)
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 2.5, z: 0.9 }, { x: 0, y: 0, z: 1 }),
    false
  );
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 2.3, z: 0.9 }, { x: 0, y: 0, z: 1 }),
    false
  );

  // f. Rotated room: position (10, 0, 0), rotation.y = pi/2
  const rotatedRoom = buildInteriorRoom(THREE);
  rotatedRoom.position.set(10, 0, 0);
  rotatedRoom.rotation.y = Math.PI / 2;
  assert.equal(
    rayHitsInteriorDoor(rotatedRoom, { x: 10.9, y: 1.55, z: 0 }, { x: 1, y: 0, z: 0 }),
    true
  );

  // g. Headless stub without worldToLocal + null safety
  const stubRoom = { rotation: { y: 0 } };
  assert.equal(
    rayHitsInteriorDoor(stubRoom, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }),
    true
  );
  assert.equal(rayHitsInteriorDoor(null, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }), false);
  assert.equal(rayHitsInteriorDoor(room, null, { x: 0, y: 0, z: 1 }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, null), false);
});

test('lookBy turns view inside, clamps pitch, leaves camera position fixed, and resets on exit', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });

  // Constants exported
  assert.equal(INTERIOR_LOOK_SENSITIVITY, 0.005);
  assert.equal(INTERIOR_PITCH_LIMIT, 0.6);

  // No-op while outside
  assert.equal(visit.lookBy(50, 20), false);
  assert.deepEqual(
    { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    { x: 0, y: 26, z: 58 }
  );
  assert.deepEqual(
    { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    { x: 0, y: 2, z: 0 }
  );

  const cottage = new THREE.Group();
  cottage.userData = { handle: 'milo' };
  cottage.position.set(17.92, 0, 4.6);
  cottage.rotation.y = Math.PI / 4;
  assert.equal(visit.enter(cottage), true);
  const eyeWorld = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

  // lookBy(0, 0) changes nothing (stays at (0, 1.15, -1.3))
  assert.equal(visit.lookBy(0, 0), true);
  let localTarget = room.worldToLocal(controls.target.clone());
  assert.ok(Math.abs(localTarget.x - 0) < 1e-6);
  assert.ok(Math.abs(localTarget.y - 1.15) < 1e-6);
  assert.ok(Math.abs(localTarget.z - -1.3) < 1e-6);

  // Drag right (100 px) -> yaw -= 0.5 -> room-local target x positive (~ +1.05)
  assert.equal(visit.lookBy(100, 0), true);
  localTarget = room.worldToLocal(controls.target.clone());
  assert.ok(localTarget.x > 1.0 && localTarget.x < 1.1, `expected target.x ~ +1.05, got ${localTarget.x}`);
  // Camera position does not move
  assert.deepEqual(
    { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    eyeWorld
  );

  // Exit and re-enter resets yaw/pitch back to (0, 1.15, -1.3)
  assert.equal(visit.exit(), true);
  assert.equal(visit.enter(cottage), true);
  localTarget = room.worldToLocal(controls.target.clone());
  assert.ok(Math.abs(localTarget.x - 0) < 1e-6);
  assert.ok(Math.abs(localTarget.y - 1.15) < 1e-6);
  assert.ok(Math.abs(localTarget.z - -1.3) < 1e-6);

  // Yaw pi -> facing the front door at (0, 1.15, 3.1)
  assert.equal(visit.lookBy(Math.PI / 0.005, 0), true);
  localTarget = room.worldToLocal(controls.target.clone());
  assert.ok(Math.abs(localTarget.x - 0) < 1e-6, `expected x ~ 0, got ${localTarget.x}`);
  assert.ok(Math.abs(localTarget.y - 1.15) < 1e-6, `expected y ~ 1.15, got ${localTarget.y}`);
  assert.ok(Math.abs(localTarget.z - 3.1) < 1e-6, `expected z ~ 3.1, got ${localTarget.z}`);

  // Reset to yaw 0 via exit/enter, then test pitch clamp up (+0.6) and down (-0.6)
  assert.equal(visit.exit(), true);
  assert.equal(visit.enter(cottage), true);

  assert.equal(visit.lookBy(0, -10000), true);
  localTarget = room.worldToLocal(controls.target.clone());
  const expectedUpY = 1.55 + Math.sin(0.6) * Math.sqrt(5);
  const expectedUpZ = 0.9 - Math.cos(0.6) * Math.sqrt(5);
  assert.ok(Math.abs(localTarget.y - expectedUpY) < 1e-6, `expected y ~ ${expectedUpY}, got ${localTarget.y}`);
  assert.ok(Math.abs(localTarget.z - expectedUpZ) < 1e-6, `expected z ~ ${expectedUpZ}, got ${localTarget.z}`);

  assert.equal(visit.lookBy(0, 20000), true);
  localTarget = room.worldToLocal(controls.target.clone());
  const expectedDownY = 1.55 + Math.sin(-0.6) * Math.sqrt(5);
  const expectedDownZ = 0.9 - Math.cos(-0.6) * Math.sqrt(5);
  assert.ok(Math.abs(localTarget.y - expectedDownY) < 1e-6, `expected y ~ ${expectedDownY}, got ${localTarget.y}`);
  assert.ok(Math.abs(localTarget.z - expectedDownZ) < 1e-6, `expected z ~ ${expectedDownZ}, got ${localTarget.z}`);
});

test('enter calls optional setDressing with cottage handle (or undefined) and works when omitted', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const dressingCalls = [];
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
    setDressing(targetRoom, handle) {
      dressingCalls.push({ targetRoom, handle });
      return setInteriorDressing(targetRoom, handle);
    },
  });

  const wick = new THREE.Group();
  wick.userData = { handle: 'wick' };
  wick.position.set(-10, 0, -8);
  assert.equal(visit.enter(wick), true);
  assert.equal(dressingCalls.length, 1);
  assert.equal(dressingCalls[0].targetRoom, room);
  assert.equal(dressingCalls[0].handle, 'wick');
  assert.equal(room.children.find((c) => c.name === 'interior_dressing_wick').visible, true);
  assert.equal(room.children.find((c) => c.name === 'interior_dressing_milo').visible, false);
  assert.equal(visit.exit(), true);

  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };
  milo.position.set(17.92, 0, 4.6);
  assert.equal(visit.enter(milo), true);
  assert.equal(dressingCalls.length, 2);
  assert.equal(dressingCalls[1].handle, 'milo');
  assert.equal(room.children.find((c) => c.name === 'interior_dressing_milo').visible, true);
  assert.equal(room.children.find((c) => c.name === 'interior_dressing_wick').visible, false);
  assert.equal(visit.exit(), true);

  // Cottage with no handle still calls setDressing with undefined (falls back to milo)
  const stranger = new THREE.Group();
  stranger.position.set(5, 0, 5);
  assert.equal(visit.enter(stranger), true);
  assert.equal(dressingCalls.length, 3);
  assert.equal(dressingCalls[2].handle, undefined);
  assert.equal(room.children.find((c) => c.name === 'interior_dressing_milo').visible, true);
  assert.equal(visit.exit(), true);

  // Omitting setDressing dep altogether still enters cleanly
  const visitNoDressing = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });
  assert.equal(visitNoDressing.enter(wick), true);
  assert.equal(visitNoDressing.exit(), true);
});

test('interior-visit.mjs contains no campfire term, fetch(, Math.random, or DOM access', async () => {
  const src = await fs.readFile(path.join(__dirname, 'interior-visit.mjs'), 'utf8');
  assert.equal(src.toLowerCase().includes('campfire'), false, 'Must not contain campfire');
  assert.equal(src.includes('fetch('), false, 'Must not contain fetch(');
  assert.equal(src.includes('Math.random'), false, 'Must not contain Math.random');
  assert.equal(/\b(document|window)\b/.test(src), false, 'Must not access DOM globals');
});
