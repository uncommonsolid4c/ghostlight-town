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

test('enter passes cottage handle directly to setPalette (including wick and unknown handles)', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const paletteCalls = [];
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette(targetRoom, handle) {
      paletteCalls.push({ targetRoom, handle });
      return setInteriorPalette(targetRoom, handle);
    },
  });

  const backWall = room.children.find((m) => m.name === 'interior_wall_back');

  const wick = new THREE.Group();
  wick.userData = { handle: 'wick' };
  wick.position.set(-10, 0, -8);
  assert.equal(visit.enter(wick), true);
  assert.equal(paletteCalls.length, 1);
  assert.equal(paletteCalls[0].targetRoom, room);
  assert.equal(paletteCalls[0].handle, 'wick');
  assert.equal(backWall.material.color, '#c8922e');
  assert.equal(visit.exit(), true);

  const stranger = new THREE.Group();
  stranger.userData = { handle: 'raul' };
  stranger.position.set(5, 0, 5);
  assert.equal(visit.enter(stranger), true);
  assert.equal(paletteCalls.length, 2);
  assert.equal(paletteCalls[1].targetRoom, room);
  assert.equal(paletteCalls[1].handle, 'raul');
  assert.equal(backWall.material.color, '#f5efe0');
  assert.equal(visit.exit(), true);
});

test('interior-visit.mjs contains no campfire term, fetch(, Math.random, or DOM access', async () => {
  const src = await fs.readFile(path.join(__dirname, 'interior-visit.mjs'), 'utf8');
  assert.equal(src.toLowerCase().includes('campfire'), false, 'Must not contain campfire');
  assert.equal(src.includes('fetch('), false, 'Must not contain fetch(');
  assert.equal(src.includes('Math.random'), false, 'Must not contain Math.random');
  assert.equal(/\b(document|window)\b/.test(src), false, 'Must not access DOM globals');
});

test('isDoorHit named door wins outside the rect, walk stops at the cottage root, and missing point', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  cottage.userData = { clickable: true, kind: 'cottage', handle: 'ada' };

  const door = new THREE.Group();
  door.name = 'door';
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), {});
  leaf.name = 'door-leaf';
  door.add(leaf);
  cottage.add(door);

  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3.2), {});
  wall.name = 'cottage-wall';
  cottage.add(wall);

  // Named door / door-leaf wins even when hit.point is far outside the local rect
  assert.equal(isDoorHit(cottage, { object: leaf, point: makeVec3(5, 9, 9) }), true);
  assert.equal(isDoorHit(cottage, { object: door, point: makeVec3(5, 9, 9) }), true);

  // Detached door subtree (never added to cottage): the ancestor-name check does
  // not verify attachment; staging.js only ever raycasts the cottage's own
  // subtree, so this is a documented seam, not a bug.
  const detachedDoor = new THREE.Group();
  detachedDoor.name = 'door';
  const detachedLeaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1), {});
  detachedLeaf.name = 'door-leaf';
  detachedDoor.add(detachedLeaf);
  const stubCottage = { userData: { handle: 'ada' } };
  assert.equal(isDoorHit(stubCottage, { object: detachedLeaf, point: { x: 5, y: 1, z: 1.7 } }), true);

  // Ancestor walk stops at the cottage root
  const outerDoorParent = new THREE.Group();
  outerDoorParent.name = 'door';
  outerDoorParent.add(cottage);
  assert.equal(isDoorHit(cottage, { object: wall, point: makeVec3(5, 1, 1.7) }), false);

  // Missing hit.point: named door wins, non-door fails, non-door with in-rect point passes
  assert.equal(isDoorHit(cottage, { object: leaf }), true);
  assert.equal(isDoorHit(cottage, { object: wall }), false);
  assert.equal(isDoorHit(cottage, { object: wall, point: makeVec3(0, 1, 1.6) }), true);
});

test('isDoorHit local-rect exact boundaries for kit and Milo cottages', () => {
  const kitStub = { userData: { handle: 'ada' } };
  const hitObj = {};

  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0.6, y: 1, z: 1.6 } }), true);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: -0.6, y: 1, z: 1.6 } }), true);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0.61, y: 1, z: 1.6 } }), false);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: -0.61, y: 1, z: 1.6 } }), false);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0, y: 0, z: 1.6 } }), true);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0, y: 2.1, z: 1.6 } }), true);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0, y: 2.11, z: 1.6 } }), false);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0, y: -0.01, z: 1.6 } }), false);

  // IEEE-754 float seam: 1.60 - 0.2 evaluates to 1.4000000000000001 in doubles,
  // so literal 1.40 sits 1 ULP below the computed threshold and returns false.
  const kitZ = 1.60 - 0.2;
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0, y: 1, z: 1.40 } }), false);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0, y: 1, z: kitZ } }), true);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0, y: 1, z: kitZ - 1e-9 } }), false);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0, y: 1, z: 1.39 } }), false);

  const miloStub = { userData: { handle: 'milo' } };
  assert.equal(isDoorHit(miloStub, { object: hitObj, point: { x: 0, y: 1, z: 1.50 } }), true);
  assert.equal(isDoorHit(miloStub, { object: hitObj, point: { x: 0, y: 1, z: 1.49 } }), false);
  assert.equal(isDoorHit(kitStub, { object: hitObj, point: { x: 0, y: 1, z: 1.49 } }), true);
});

test('rayHitsInteriorDoor plane and boundary edges plus degenerate inputs', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);

  assert.equal(rayHitsInteriorDoor(room, { x: 0.5, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }), true);
  assert.equal(rayHitsInteriorDoor(room, { x: -0.5, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }), true);
  assert.equal(rayHitsInteriorDoor(room, { x: 0.51, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }), false);

  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 0, z: 0.9 }, { x: 0, y: 0, z: 1 }), true);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 2.0, z: 0.9 }, { x: 0, y: 0, z: 1 }), true);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 2.01, z: 0.9 }, { x: 0, y: 0, z: 1 }), false);

  // Origin on plane (t = 0) and beyond plane (t < 0)
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 1.44 }, { x: 0, y: 0, z: 1 }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 1.5 }, { x: 0, y: 0, z: 1 }), false);

  // Degenerate and non-unit inputs
  assert.equal(rayHitsInteriorDoor(room, { x: NaN, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: Infinity }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1e-10 }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 2 }), true);

  // Rising ray overshoots lintel (hit y = 1.9 + 0.54 = 2.44 > 2.0)
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 1.9, z: 0.9 }, { x: 0, y: 1, z: 1 }), false);

  // Rotated 180 deg: world +z points into room -z
  const rotatedRoom = buildInteriorRoom(THREE);
  rotatedRoom.rotation.y = Math.PI;
  assert.equal(rayHitsInteriorDoor(rotatedRoom, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }), false);
});

test('lookBy yaw accumulates across calls, drag-left mirrors, diagonal clamps pitch, and lookAt call counts', () => {
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

  const cottage = new THREE.Group();
  cottage.userData = { handle: 'milo' };

  assert.equal(visit.enter(cottage), true);
  assert.equal(camera.lookAtCalls.length, 1);

  assert.equal(visit.lookBy(100, 0), true);
  assert.equal(visit.lookBy(100, 0), true);
  assert.equal(camera.lookAtCalls.length, 3);

  const dist = Math.sqrt(5);
  const pitch0 = Math.asin(-0.4 / dist);
  const expectedYawOnlyX = -Math.sin(-1.0) * Math.cos(pitch0) * dist;
  const expectedYawOnlyY = 1.55 + Math.sin(pitch0) * dist;
  const expectedYawOnlyZ = 0.9 - Math.cos(-1.0) * Math.cos(pitch0) * dist;

  let localTarget = room.worldToLocal(controls.target.clone());
  assert.ok(Math.abs(localTarget.x - expectedYawOnlyX) < 1e-6);
  assert.ok(Math.abs(localTarget.y - expectedYawOnlyY) < 1e-6);
  assert.ok(Math.abs(localTarget.z - expectedYawOnlyZ) < 1e-6);

  // Exit and re-enter; drag-left mirrors drag-right; exit calls no lookAt
  assert.equal(visit.exit(), true);
  camera.lookAtCalls.length = 0;
  assert.equal(visit.enter(cottage), true);
  assert.equal(visit.lookBy(-100, 0), true);
  assert.equal(camera.lookAtCalls.length, 2);

  localTarget = room.worldToLocal(controls.target.clone());
  assert.ok(localTarget.x > -1.1 && localTarget.x < -1.0, `expected target.x in (-1.1, -1.0), got ${localTarget.x}`);

  assert.equal(visit.exit(), true);
  assert.equal(camera.lookAtCalls.length, 2);

  // Re-enter and drag diagonally with pitch clamped to +0.6
  assert.equal(visit.enter(cottage), true);
  assert.equal(visit.lookBy(200, -20000), true);

  const clampedPitch = 0.6;
  const expectedDiagX = -Math.sin(-1.0) * Math.cos(clampedPitch) * dist;
  const expectedDiagY = 1.55 + Math.sin(clampedPitch) * dist;
  const expectedDiagZ = 0.9 - Math.cos(-1.0) * Math.cos(clampedPitch) * dist;

  localTarget = room.worldToLocal(controls.target.clone());
  assert.ok(Math.abs(localTarget.x - expectedDiagX) < 1e-6);
  assert.ok(Math.abs(localTarget.y - expectedDiagY) < 1e-6);
  assert.ok(Math.abs(localTarget.z - expectedDiagZ) < 1e-6);
});

test('enter and exit edge cases: null cottage, missing deps, rotation-less cottage, omitted optional deps, double exit, re-enter moves room', () => {
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

  assert.equal(visit.enter(null), false);
  assert.equal(visit.enter(undefined), false);
  assert.equal(visit.isInside(), false);

  const cottage = new THREE.Group();
  cottage.userData = { handle: 'milo' };

  assert.equal(createInteriorVisit({ room: undefined, camera, controls }).enter(cottage), false);
  assert.equal(createInteriorVisit({ room, camera: undefined, controls }).enter(cottage), false);
  assert.equal(createInteriorVisit({ room, camera, controls: undefined }).enter(cottage), false);

  // Rotation-less cottage resets room.rotation.y to 0
  room.rotation.y = 0.9;
  const stubCottage = { userData: { handle: 'ada' }, position: makeVec3(3, 0.5, -4) };
  assert.equal(visit.enter(stubCottage), true);
  assert.equal(room.rotation.y, 0);
  assert.equal(room.position.x, 3);
  assert.equal(visit.exit(), true);

  // Omitted optional deps (setVisible, setPalette, setDressing)
  const freshRoom = buildInteriorRoom(THREE);
  const backWall = freshRoom.children.find((m) => m.name === 'interior_wall_back');
  const bareVisit = createInteriorVisit({ room: freshRoom, camera, controls });

  const wick = new THREE.Group();
  wick.userData = { handle: 'wick' };
  wick.position.set(-10, 0, -8);

  assert.equal(bareVisit.enter(wick), true);
  assert.equal(freshRoom.visible, false);
  assert.equal(backWall.material.color, '#f5efe0');
  assert.equal(bareVisit.exit(), true);
  assert.equal(bareVisit.exit(), false);

  // Full-dep visit: enter wick, exit, then re-enter milo at new pose
  const fullBackWall = room.children.find((m) => m.name === 'interior_wall_back');
  assert.equal(visit.enter(wick), true);
  assert.equal(fullBackWall.material.color, '#c8922e');
  assert.equal(visit.exit(), true);

  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };
  milo.position.set(17.92, 0.25, 4.6);
  milo.rotation.y = Math.PI / 2;
  assert.equal(visit.enter(milo), true);
  assert.equal(room.position.x, 17.92);
  assert.equal(room.position.z, 4.6);
  assert.equal(fullBackWall.material.color, '#a8d8ea');
  assert.equal(visit.exit(), true);
});

test('exported interior constants are frozen with exact values', async () => {
  const { INTERIOR_EYE_LOCAL, INTERIOR_TARGET_LOCAL } = await import('./interior-visit.mjs');

  assert.deepEqual(INTERIOR_EYE_LOCAL, { x: 0, y: 1.55, z: 0.9 });
  assert.deepEqual(INTERIOR_TARGET_LOCAL, { x: 0, y: 1.15, z: -1.3 });
  assert.equal(Object.isFrozen(INTERIOR_EYE_LOCAL), true);
  assert.equal(Object.isFrozen(INTERIOR_TARGET_LOCAL), true);

  assert.equal(INTERIOR_LOOK_SENSITIVITY, 0.005);
  assert.equal(INTERIOR_PITCH_LIMIT, 0.6);

  const dist = Math.hypot(0, 1.15 - 1.55, -1.3 - 0.9);
  assert.ok(Math.abs(dist - Math.sqrt(5)) < 1e-12);
  const pitch0 = Math.asin((1.15 - 1.55) / Math.sqrt(5));
  assert.ok(Math.abs(pitch0 - -0.1798534997924783) < 1e-12);
});

test('isDoorHit handle case and clone discipline: non-milo handles use kit frontZ, worldToLocal clones the point, null local fails', () => {
  const hitObj = {};
  assert.equal(isDoorHit({ userData: { handle: 'MILO' } }, { object: hitObj, point: { x: 0, y: 1, z: 1.45 } }), true);
  assert.equal(isDoorHit({ userData: { handle: 'milo' } }, { object: hitObj, point: { x: 0, y: 1, z: 1.45 } }), false);
  assert.equal(isDoorHit({ userData: {} }, { object: hitObj, point: { x: 0, y: 1, z: 1.45 } }), true);
  assert.equal(isDoorHit({}, { object: hitObj, point: { x: 0, y: 1, z: 1.45 } }), true);

  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  cottage.position.set(2, 0, 3);
  cottage.rotation.y = Math.PI / 2;
  const point = makeVec3(0, 1, 1.7);
  let cloneCount = 0;
  const origClone = point.clone;
  point.clone = () => {
    cloneCount += 1;
    return origClone.call(point);
  };
  isDoorHit(cottage, { object: hitObj, point });
  assert.equal(cloneCount, 1);
  assert.deepEqual({ x: point.x, y: point.y, z: point.z }, { x: 0, y: 1, z: 1.7 });

  assert.equal(
    isDoorHit({ worldToLocal: () => null }, { object: hitObj, point: { x: 0, y: 1, z: 1.6 } }),
    false
  );
  assert.equal(
    isDoorHit({ worldToLocal: () => undefined }, { object: hitObj, point: { x: 0, y: 1, z: 1.6 } }),
    false
  );
});

test('rayHitsInteriorDoor rotated-room direction transform and degenerate inputs', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  room.rotation.y = Math.PI / 2;

  assert.equal(rayHitsInteriorDoor(room, { x: 0.9, y: 1.55, z: 0 }, { x: 1, y: 0, z: 0 }), true);
  assert.equal(rayHitsInteriorDoor(room, { x: 0.9, y: 1.55, z: 0 }, { x: 0, y: 0, z: 1 }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0.9, y: 1.55, z: 0 }, { x: -1, y: 0, z: 0 }), false);

  assert.equal(rayHitsInteriorDoor(room, { x: 0.9, y: 1.55, z: 0 }, { x: 0, y: 0, z: 0 }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0.9, y: 1.55, z: 0 }, { x: 1, y: NaN, z: 0 }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0.9, y: 1.55, z: undefined }, { x: 1, y: 0, z: 0 }), false);

  const stubRoom = { rotation: { y: 0 } };
  assert.equal(rayHitsInteriorDoor(stubRoom, { x: 0, y: 1.55, z: 1.43 }, { x: 0, y: 0, z: 1 }), true);
  assert.equal(rayHitsInteriorDoor(stubRoom, { x: 0, y: 1.55, z: 1.44 }, { x: 0, y: 0, z: 1 }), false);
});

test('lookBy keeps the target on the sqrt(5) sphere for extreme yaw, works without lookAt, and NaN drag propagates', () => {
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
  milo.position.set(17.92, 0, 4.6);
  milo.rotation.y = Math.PI / 4;

  assert.equal(visit.enter(milo), true);
  const eye = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  assert.equal(visit.lookBy(20000, 0), true);
  const dist = Math.hypot(
    controls.target.x - eye.x,
    controls.target.y - eye.y,
    controls.target.z - eye.z
  );
  assert.ok(Math.abs(dist - Math.sqrt(5)) < 1e-9, `expected sqrt(5), got ${dist}`);
  assert.deepEqual({ x: camera.position.x, y: camera.position.y, z: camera.position.z }, eye);

  const noLookAtCam = { position: makeVec3(0, 26, 58) };
  const { controls: controls2 } = makeFakeCameraAndControls();
  const room2 = buildInteriorRoom(THREE);
  const visit2 = createInteriorVisit({
    room: room2,
    camera: noLookAtCam,
    controls: controls2,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });
  const originMilo = new THREE.Group();
  originMilo.userData = { handle: 'milo' };
  assert.equal(visit2.enter(originMilo), true);
  assert.equal(visit2.lookBy(100, 0), true);
  assert.ok(
    controls2.target.x > 1.0 && controls2.target.x < 1.1,
    `expected target.x in (1.0, 1.1), got ${controls2.target.x}`
  );

  assert.equal(visit2.lookBy(NaN, 0), true);
  assert.equal(Number.isNaN(controls2.target.x), true);
});

test('enter/exit with plain-object positions use the setVec3 fallbacks, and a position-less cottage leaves the room pose alone', () => {
  const room = { position: { x: 10, y: 0, z: 5 }, rotation: { y: 0 }, visible: false, children: [] };
  const camera = { position: { x: 0, y: 26, z: 58 } };
  const controls = { target: { x: 0, y: 2, z: 0 }, enabled: true };
  const visibleCalls = [];
  const paletteCalls = [];
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible(r, v) {
      visibleCalls.push({ r, v });
      r.visible = v;
    },
    setPalette(r, h) {
      paletteCalls.push({ r, h });
    },
  });

  const wick = {
    userData: { handle: 'wick' },
    position: { x: 3, y: 0.5, z: -4 },
    rotation: { y: Math.PI / 2 },
  };
  assert.equal(visit.enter(wick), true);
  assert.deepEqual(room.position, { x: 3, y: 0.5, z: -4 });
  assert.equal(room.rotation.y, Math.PI / 2);
  assert.ok(Math.abs(camera.position.x - 3.9) < 1e-9);
  assert.ok(Math.abs(camera.position.y - 2.05) < 1e-9);
  assert.ok(Math.abs(camera.position.z - -4) < 1e-9);
  assert.ok(Math.abs(controls.target.x - 1.7) < 1e-9);
  assert.ok(Math.abs(controls.target.y - 1.65) < 1e-9);
  assert.ok(Math.abs(controls.target.z - -4) < 1e-9);
  assert.equal(visibleCalls.length, 1);
  assert.equal(paletteCalls.length, 1);
  assert.equal(visit.exit(), true);
  assert.deepEqual(camera.position, { x: 0, y: 26, z: 58 });
  assert.deepEqual(controls.target, { x: 0, y: 2, z: 0 });

  const room2 = { position: { x: 7, y: 1, z: 2 }, rotation: { y: 0.7 }, visible: false, children: [] };
  const visit2 = createInteriorVisit({ room: room2, camera, controls });
  assert.equal(visit2.enter({ userData: { handle: 'ada' } }), true);
  assert.deepEqual(room2.position, { x: 7, y: 1, z: 2 });
  assert.equal(room2.rotation.y, 0);
  assert.ok(Math.abs(camera.position.x - 7) < 1e-9);
  assert.ok(Math.abs(camera.position.y - 2.55) < 1e-9);
  assert.ok(Math.abs(camera.position.z - 2.9) < 1e-9);
  assert.ok(Math.abs(controls.target.x - 7) < 1e-9);
  assert.ok(Math.abs(controls.target.y - 2.15) < 1e-9);
  assert.ok(Math.abs(controls.target.z - 0.7) < 1e-9);
});

test('createInteriorVisit dep edges: no-arg call throws, missing-room visit stays inert, two visits are independent closures', () => {
  assert.throws(() => createInteriorVisit(), TypeError);
  assert.throws(() => createInteriorVisit(null), TypeError);

  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();

  const noRoomVisit = createInteriorVisit({ room: undefined, camera, controls });
  assert.equal(noRoomVisit.isInside(), false);
  assert.equal(noRoomVisit.exit(), false);
  assert.equal(noRoomVisit.lookBy(10, 10), false);

  const visitA = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });
  const visitB = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });

  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };
  milo.position.set(17.92, 0, 4.6);

  const wick = new THREE.Group();
  wick.userData = { handle: 'wick' };
  wick.position.set(-10, 0, -8);

  assert.equal(visitA.enter(milo), true);
  const poseAtBEnter = {
    cam: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
  };
  assert.equal(visitB.isInside(), false);
  assert.equal(visitB.enter(wick), true);
  assert.equal(room.position.x, -10);
  assert.equal(room.position.z, -8);

  assert.equal(visitA.exit(), true);
  assert.deepEqual({ x: camera.position.x, y: camera.position.y, z: camera.position.z }, { x: 0, y: 26, z: 58 });
  assert.equal(visitB.isInside(), true);

  assert.equal(visitB.exit(), true);
  assert.ok(Math.abs(camera.position.x - poseAtBEnter.cam.x) < 1e-9);
  assert.ok(Math.abs(camera.position.y - poseAtBEnter.cam.y) < 1e-9);
  assert.ok(Math.abs(camera.position.z - poseAtBEnter.cam.z) < 1e-9);
  assert.ok(Math.abs(controls.target.x - poseAtBEnter.target.x) < 1e-9);
  assert.ok(Math.abs(controls.target.y - poseAtBEnter.target.y) < 1e-9);
  assert.ok(Math.abs(controls.target.z - poseAtBEnter.target.z) < 1e-9);
});

test('exit with omitted setVisible leaves visibility untouched, and re-enter saves the new pose', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const bareVisit = createInteriorVisit({ room, camera, controls });

  room.visible = true;
  const wick = new THREE.Group();
  wick.userData = { handle: 'wick' };
  wick.position.set(-10, 0, -8);

  assert.equal(bareVisit.enter(wick), true);
  assert.equal(room.visible, true);
  assert.equal(bareVisit.exit(), true);
  assert.equal(room.visible, true);
  assert.equal(controls.enabled, true);

  camera.position.set(99, 99, 99);
  controls.target.set(1, 2, 3);
  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };
  milo.position.set(17.92, 0, 4.6);

  assert.equal(bareVisit.enter(milo), true);
  assert.equal(bareVisit.exit(), true);
  assert.deepEqual({ x: camera.position.x, y: camera.position.y, z: camera.position.z }, { x: 99, y: 99, z: 99 });
  assert.deepEqual({ x: controls.target.x, y: controls.target.y, z: controls.target.z }, { x: 1, y: 2, z: 3 });
});

test('enter calls room.updateMatrixWorld(true) when present and works when it is absent', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const mwCalls = [];
  room.updateMatrixWorld = (deep) => mwCalls.push(deep);
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
  milo.position.set(1, 0, 2);

  assert.equal(visit.enter(milo), true);
  assert.deepEqual(mwCalls, [true]);
  assert.equal(visit.exit(), true);

  const roomNoMw = buildInteriorRoom(THREE);
  assert.equal(typeof roomNoMw.updateMatrixWorld, 'undefined');
  const { camera: camera2, controls: controls2 } = makeFakeCameraAndControls();
  const visit2 = createInteriorVisit({
    room: roomNoMw,
    camera: camera2,
    controls: controls2,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });
  assert.equal(visit2.enter(milo), true);
  assert.equal(visit2.exit(), true);
});

test('enter calls deps in order: setPalette, then setDressing, then setVisible', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const order = [];
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible(r, v) {
      order.push('visible');
      setInteriorVisible(r, v);
    },
    setPalette(r, h) {
      order.push('palette');
      setInteriorPalette(r, h);
    },
    setDressing(r, h) {
      order.push('dressing');
      setInteriorDressing(r, h);
    },
  });

  const wick = new THREE.Group();
  wick.userData = { handle: 'wick' };
  wick.position.set(-10, 0, -8);

  assert.equal(visit.enter(wick), true);
  assert.deepEqual(order, ['palette', 'dressing', 'visible']);
  assert.equal(visit.exit(), true);
});

test('isDoorHit handles point-only hits and a cottage named door', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  cottage.userData = { clickable: true, kind: 'cottage', handle: 'ada' };

  assert.equal(isDoorHit(cottage, { point: { x: 0, y: 1, z: 1.6 } }), true);
  assert.equal(isDoorHit(cottage, { point: { x: 0, y: 1, z: 1.39 } }), false);
  assert.equal(isDoorHit(cottage, { object: undefined, point: { x: 0, y: 1, z: 1.6 } }), true);

  const doorCottage = new THREE.Group();
  doorCottage.name = 'door';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), {});
  doorCottage.add(mesh);
  assert.equal(isDoorHit(doorCottage, { object: mesh, point: makeVec3(5, 9, 9) }), true);
});

test('isDoorHit copies a clone-less point before worldToLocal and leaves the original untouched', () => {
  const THREE = makeFakeThree();
  const cottage = new THREE.Group();
  cottage.userData = { clickable: true, kind: 'cottage', handle: 'ada' };
  cottage.position.set(2, 0, 3);
  cottage.rotation.y = Math.PI / 2;

  const origWorldToLocal = cottage.worldToLocal.bind(cottage);
  const recordedArgs = [];
  cottage.worldToLocal = (vec) => {
    recordedArgs.push(vec);
    return origWorldToLocal(vec);
  };

  const point = { x: 3.7, y: 1, z: 3 };
  assert.equal(isDoorHit(cottage, { object: {}, point }), true);
  assert.equal(recordedArgs.length, 1);
  assert.notEqual(recordedArgs[0], point);
  assert.deepEqual(point, { x: 3.7, y: 1, z: 3 });
});

test('enter with a position-less room succeeds and leaves the camera eye at eye-local-as-world', () => {
  const room = { rotation: { y: 0 }, visible: false, children: [] };
  const camera = { position: { x: 0, y: 26, z: 58 } };
  const controls = { target: { x: 0, y: 2, z: 0 }, enabled: true };
  const visit = createInteriorVisit({ room, camera, controls });

  const cottage = {
    userData: { handle: 'ada' },
    position: { x: 5, y: 0, z: 5 },
    rotation: { y: 0 },
  };
  assert.equal(visit.enter(cottage), true);
  assert.deepEqual(camera.position, { x: 0, y: 1.55, z: 0.9 });
  assert.deepEqual(controls.target, { x: 0, y: 1.15, z: -1.3 });

  assert.equal(visit.exit(), true);
  assert.deepEqual(camera.position, { x: 0, y: 26, z: 58 });
});

test('lookBy works with plain-object camera and controls (no set/clone/lookAt)', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const camera = { position: { x: 0, y: 26, z: 58 } };
  const controls = { target: { x: 0, y: 2, z: 0 }, enabled: true };
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
  });

  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };
  assert.equal(visit.enter(milo), true);
  assert.equal(visit.lookBy(100, 0), true);
  assert.ok(
    controls.target.x > 1.0 && controls.target.x < 1.1,
    `expected target.x in (1.0, 1.1), got ${controls.target.x}`
  );
  assert.ok(Math.abs(controls.target.y - 1.15) < 1e-9);
  assert.deepEqual(camera.position, { x: 0, y: 1.55, z: 0.9 });
  assert.equal(visit.exit(), true);
});

test('createInteriorVisit({}) is inert on all four methods', () => {
  const THREE = makeFakeThree();
  const v = createInteriorVisit({});
  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };

  assert.equal(v.isInside(), false);
  assert.equal(v.enter(milo), false);
  assert.equal(v.exit(), false);
  assert.equal(v.lookBy(10, 10), false);
  assert.equal(v.isInside(), false);
});

test('rayHitsInteriorDoor with rotation-less stub rooms and missing origin/direction fields', () => {
  const THREE = makeFakeThree();
  assert.equal(rayHitsInteriorDoor({}, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }), true);
  assert.equal(
    rayHitsInteriorDoor({ rotation: undefined }, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0, z: 1 }),
    true
  );

  const room = buildInteriorRoom(THREE);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, z: 0.9 }, { x: 0, y: 0, z: 1 }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, { x: 0, y: 0 }), false);
  assert.equal(rayHitsInteriorDoor(room, { x: 0, y: 1.55 }, { x: 0, y: 0, z: 1 }), false);
});

test('enter with rotation pi/2 places the eye and lookAt target at exact world coords', () => {
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
  milo.position.set(17.92, 0, 4.6);
  milo.rotation.y = Math.PI / 2;

  assert.equal(visit.enter(milo), true);
  assert.ok(Math.abs(camera.position.x - 18.82) < 1e-9);
  assert.ok(Math.abs(camera.position.y - 1.55) < 1e-9);
  assert.ok(Math.abs(camera.position.z - 4.6) < 1e-9);
  assert.equal(camera.lookAtCalls.length, 1);
  assert.ok(Math.abs(camera.lookAtCalls[0].x - 16.62) < 1e-9);
  assert.ok(Math.abs(camera.lookAtCalls[0].y - 1.15) < 1e-9);
  assert.ok(Math.abs(camera.lookAtCalls[0].z - 4.6) < 1e-9);
  assert.equal(visit.exit(), true);
});

test('exit calls only setVisible, never palette/dressing again, and leaves the room pose alone', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  let paletteCalls = 0;
  let dressingCalls = 0;
  const visibleCalls = [];

  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible(r, v) {
      visibleCalls.push(v);
      setInteriorVisible(r, v);
    },
    setPalette(r, h) {
      paletteCalls += 1;
      setInteriorPalette(r, h);
    },
    setDressing(r, h) {
      dressingCalls += 1;
      setInteriorDressing(r, h);
    },
  });

  const wick = new THREE.Group();
  wick.userData = { handle: 'wick' };
  wick.position.set(-10, 0, -8);

  assert.equal(visit.enter(wick), true);
  assert.deepEqual(visibleCalls, [true]);
  assert.equal(paletteCalls, 1);
  assert.equal(dressingCalls, 1);

  const poseSnapshot = {
    x: room.position.x,
    y: room.position.y,
    z: room.position.z,
    ry: room.rotation.y,
  };

  assert.equal(visit.exit(), true);
  assert.deepEqual(visibleCalls, [true, false]);
  assert.equal(paletteCalls, 1);
  assert.equal(dressingCalls, 1);
  assert.deepEqual(
    { x: room.position.x, y: room.position.y, z: room.position.z, ry: room.rotation.y },
    poseSnapshot
  );
});

test('enter with rotation pi/4 places eye and lookAt target at exact world coords', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
    setDressing: setInteriorDressing,
  });

  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };
  milo.position.set(17.92, 0, 4.6);
  milo.rotation.y = Math.PI / 4;

  assert.equal(visit.enter(milo), true);
  assert.ok(Math.abs(camera.position.x - 18.556396103067893) < 1e-9);
  assert.ok(Math.abs(camera.position.y - 1.55) < 1e-9);
  assert.ok(Math.abs(camera.position.z - 5.236396103067893) < 1e-9);
  assert.ok(Math.abs(controls.target.x - 17.000761184457488) < 1e-9);
  assert.ok(Math.abs(controls.target.y - 1.15) < 1e-9);
  assert.ok(Math.abs(controls.target.z - 3.680761184457488) < 1e-9);
  assert.equal(camera.lookAtCalls.length, 1);
  assert.ok(Math.abs(camera.lookAtCalls[0].x - 17.000761184457488) < 1e-9);
  assert.ok(Math.abs(camera.lookAtCalls[0].y - 1.15) < 1e-9);
  assert.ok(Math.abs(camera.lookAtCalls[0].z - 3.680761184457488) < 1e-9);
  assert.deepEqual(camera.lookAtCalls[0], {
    x: controls.target.x,
    y: controls.target.y,
    z: controls.target.z,
  });
  assert.equal(visit.exit(), true);
});

test('lookBy combined drag updates local target exactly while keeping camera eye fixed', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette: setInteriorPalette,
    setDressing: setInteriorDressing,
  });

  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };
  milo.position.set(17.92, 0, 4.6);
  milo.rotation.y = Math.PI / 4;

  assert.equal(visit.enter(milo), true);
  const eyeBefore = {
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
  };

  assert.equal(visit.lookBy(50, -40), true);
  const localTarget = room.worldToLocal(controls.target.clone());
  assert.ok(Math.abs(localTarget.x - 0.5530998053285574) < 1e-6);
  assert.ok(Math.abs(localTarget.y - 1.595045896612638) < 1e-6);
  assert.ok(Math.abs(localTarget.z - -1.2661143719905184) < 1e-6);
  assert.deepEqual(
    { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    eyeBefore
  );
  assert.equal(visit.exit(), true);
});

test('rayHitsInteriorDoor diagonal and rising-ray doorway boundaries', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);

  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, { x: -0.5, y: 0, z: 0.54 }),
    true
  );
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 1.55, z: 0.9 }, { x: -0.51, y: 0, z: 0.54 }),
    false
  );
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0.2, y: 1.55, z: 0.9 }, { x: 0.3, y: 0, z: 0.54 }),
    true
  );
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0.2, y: 1.55, z: 0.9 }, { x: 0.31, y: 0, z: 0.54 }),
    false
  );

  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 1.45, z: 0.9 }, { x: 0, y: 1, z: 1 }),
    true
  );
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 1.46, z: 0.9 }, { x: 0, y: 1, z: 1 }),
    true
  );
  assert.equal(
    rayHitsInteriorDoor(room, { x: 0, y: 1.47, z: 0.9 }, { x: 0, y: 1, z: 1 }),
    false
  );
});

test('isDoorHit rotated kit and milo cottages transform world hits via worldToLocal at pi/2', () => {
  const THREE = makeFakeThree();

  const kit = new THREE.Group();
  kit.userData = { clickable: true, kind: 'cottage', handle: 'ada' };
  kit.position.set(5, 0, 5);
  kit.rotation.y = Math.PI / 2;

  const kitDoorWorld = kit.localToWorld(makeVec3(0, 1, 1.6));
  assert.ok(Math.abs(kitDoorWorld.x - 6.6) < 1e-9);
  assert.ok(Math.abs(kitDoorWorld.y - 1) < 1e-9);
  assert.ok(Math.abs(kitDoorWorld.z - 5) < 1e-9);
  assert.equal(isDoorHit(kit, { object: {}, point: kitDoorWorld }), true);

  const kitWallWorld = kit.localToWorld(makeVec3(1.1, 1, 1.6));
  assert.ok(Math.abs(kitWallWorld.x - 6.6) < 1e-9);
  assert.ok(Math.abs(kitWallWorld.y - 1) < 1e-9);
  assert.ok(Math.abs(kitWallWorld.z - 3.9) < 1e-9);
  assert.equal(isDoorHit(kit, { object: {}, point: kitWallWorld }), false);

  const kitBackWorld = kit.localToWorld(makeVec3(0, 1, 1.39));
  assert.ok(Math.abs(kitBackWorld.x - 6.39) < 1e-9);
  assert.ok(Math.abs(kitBackWorld.y - 1) < 1e-9);
  assert.ok(Math.abs(kitBackWorld.z - 5) < 1e-9);
  assert.equal(isDoorHit(kit, { object: {}, point: kitBackWorld }), false);

  const milo = new THREE.Group();
  milo.userData = { clickable: true, kind: 'cottage', handle: 'milo' };
  milo.position.set(17.92, 0, 4.6);
  milo.rotation.y = Math.PI / 2;

  const miloDoorWorld = milo.localToWorld(makeVec3(0, 1, 1.7));
  assert.ok(Math.abs(miloDoorWorld.x - 19.62) < 1e-9);
  assert.ok(Math.abs(miloDoorWorld.y - 1) < 1e-9);
  assert.ok(Math.abs(miloDoorWorld.z - 4.6) < 1e-9);
  assert.equal(isDoorHit(milo, { object: {}, point: miloDoorWorld }), true);

  const miloBackWorld = milo.localToWorld(makeVec3(0, 1, 1.49));
  assert.ok(Math.abs(miloBackWorld.x - 19.41) < 1e-9);
  assert.ok(Math.abs(miloBackWorld.y - 1) < 1e-9);
  assert.ok(Math.abs(miloBackWorld.z - 4.6) < 1e-9);
  assert.equal(isDoorHit(milo, { object: {}, point: miloBackWorld }), false);
});

test('dressing and palette persist while hidden and re-enter re-applies them', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const { camera, controls } = makeFakeCameraAndControls();
  const dressingCalls = [];
  const paletteCalls = [];

  const visit = createInteriorVisit({
    room,
    camera,
    controls,
    setVisible: setInteriorVisible,
    setPalette(r, h) {
      paletteCalls.push(h);
      setInteriorPalette(r, h);
    },
    setDressing(r, h) {
      dressingCalls.push(h);
      setInteriorDressing(r, h);
    },
  });

  const wick = new THREE.Group();
  wick.userData = { handle: 'wick' };
  const milo = new THREE.Group();
  milo.userData = { handle: 'milo' };

  const backWall = room.children.find((c) => c.name === 'interior_wall_back');
  const wickDressing = room.children.find((c) => c.name === 'interior_dressing_wick');
  const miloDressing = room.children.find((c) => c.name === 'interior_dressing_milo');

  assert.equal(visit.enter(wick), true);
  assert.equal(visit.exit(), true);
  assert.equal(room.visible, false);
  assert.equal(wickDressing.visible, true);
  assert.equal(backWall.material.color, '#c8922e');

  assert.equal(visit.enter(wick), true);
  assert.deepEqual(dressingCalls, ['wick', 'wick']);
  assert.deepEqual(paletteCalls, ['wick', 'wick']);
  assert.equal(wickDressing.visible, true);
  assert.equal(visit.exit(), true);

  assert.equal(visit.enter(milo), true);
  assert.equal(miloDressing.visible, true);
  assert.equal(wickDressing.visible, false);
  assert.equal(visit.exit(), true);
});

test('maren and tomas palette accents, dressing toggles, and buildInteriorRoom palette opts', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);
  const backWall = room.children.find((c) => c.name === 'interior_wall_back');
  const miloDressing = room.children.find((c) => c.name === 'interior_dressing_milo');
  const marenDressing = room.children.find((c) => c.name === 'interior_dressing_maren');
  const tomasDressing = room.children.find((c) => c.name === 'interior_dressing_tomas');

  assert.equal(setInteriorPalette(room, 'maren'), true);
  assert.equal(backWall.material.color, '#43505c');
  assert.equal(setInteriorPalette(room, 'tomas'), true);
  assert.equal(backWall.material.color, '#b5633a');

  assert.equal(setInteriorDressing(room, 'maren'), true);
  assert.equal(marenDressing.visible, true);
  assert.equal(miloDressing.visible, false);

  assert.equal(setInteriorDressing(room, 'tomas'), true);
  assert.equal(tomasDressing.visible, true);
  assert.equal(marenDressing.visible, false);

  const marenBuilt = buildInteriorRoom(THREE, { palette: 'maren' });
  const marenBack = marenBuilt.children.find((c) => c.name === 'interior_wall_back');
  assert.equal(marenBack.material.color, '#f5efe0');

  const miloBuilt = buildInteriorRoom(THREE, { palette: 'milo' });
  const miloBack = miloBuilt.children.find((c) => c.name === 'interior_wall_back');
  assert.equal(miloBack.material.color, '#a8d8ea');
});

test('buildInteriorRoom structure inventory matches exact names, dimensions, and positions', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);

  assert.equal(room.name, 'interior_room');
  assert.equal(room.visible, false);
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

  const byName = (n) => room.children.find((c) => c.name === n);
  const floor = byName('interior_floor');
  assert.deepEqual(floor.geometry.args, [3.7, 0.08, 3.0]);
  assert.deepEqual(
    { x: floor.position.x, y: floor.position.y, z: floor.position.z },
    { x: 0, y: 0.04, z: 0 }
  );

  const rafter1 = byName('interior_rafter_1');
  assert.equal(rafter1.position.y, 2.66);
  assert.equal(rafter1.position.z, -1.05);

  const glowLeft = byName('interior_window_glow_left');
  assert.equal(glowLeft.material.color, '#ffbe5c');
  assert.equal(glowLeft.material.emissiveIntensity, 1.4);

  const desk = byName('interior_desk');
  assert.deepEqual(
    { x: desk.position.x, y: desk.position.y, z: desk.position.z },
    { x: -0.95, y: 0.44, z: -0.85 }
  );

  const rug = byName('interior_rug');
  assert.deepEqual(
    { x: rug.position.x, y: rug.position.y, z: rug.position.z },
    { x: 0.25, y: 0.1, z: 0.15 }
  );

  const wickDressing = byName('interior_dressing_wick');
  assert.ok(Math.abs(wickDressing.position.x - -0.8) < 1e-9);
  assert.ok(Math.abs(wickDressing.position.y - 0.8) < 1e-9);
  assert.ok(Math.abs(wickDressing.position.z - -0.85) < 1e-9);

  const miloDressing = byName('interior_dressing_milo');
  const kettle = miloDressing.children.find((c) => c.name === 'interior_tea_kettle');
  assert.ok(Math.abs(kettle.position.x - -0.8) < 1e-9);
  assert.ok(Math.abs(kettle.position.y - 0.92) < 1e-9);
  assert.ok(Math.abs(kettle.position.z - -0.85) < 1e-9);

  const cat = miloDressing.children.find((c) => c.name === 'interior_cat');
  assert.ok(Math.abs(cat.position.x - 1.35) < 1e-9);
  assert.ok(Math.abs(cat.position.y - 0.26) < 1e-9);
  assert.ok(Math.abs(cat.position.z - -0.9) < 1e-9);
});

test('setInterior* null-safety, Boolean coercion, .set color path, and dressing idempotence', () => {
  const THREE = makeFakeThree();
  const room = buildInteriorRoom(THREE);

  assert.equal(setInteriorVisible(null, true), false);
  assert.equal(setInteriorVisible(undefined, false), false);
  assert.equal(setInteriorVisible(room, 'yes'), true);
  assert.equal(room.visible, true);
  assert.equal(setInteriorVisible(room, 0), false);
  assert.equal(room.visible, false);
  assert.equal(setInteriorVisible(room, 1), true);

  assert.equal(setInteriorPalette(null, 'milo'), false);
  assert.equal(setInteriorPalette({ children: [] }, 'milo'), false);
  assert.equal(
    setInteriorPalette({ children: [{ name: 'interior_wall_back' }] }, 'milo'),
    false
  );

  assert.equal(setInteriorDressing(null, 'milo'), false);
  assert.equal(setInteriorDressing({ children: [] }, 'milo'), false);

  const wickDressing = room.children.find((c) => c.name === 'interior_dressing_wick');
  assert.equal(setInteriorDressing(room, 'wick'), true);
  assert.equal(wickDressing.visible, true);
  assert.equal(setInteriorDressing(room, 'wick'), true);
  assert.equal(wickDressing.visible, true);

  const seen = [];
  const setRoom = {
    children: [
      {
        name: 'interior_wall_back',
        material: {
          color: {
            set(v) {
              seen.push(v);
            },
          },
        },
      },
    ],
  };
  assert.equal(setInteriorPalette(setRoom, 'milo'), true);
  assert.deepEqual(seen, ['#a8d8ea']);
  assert.equal(setInteriorPalette(setRoom, 'nope'), true);
  assert.deepEqual(seen, ['#a8d8ea', '#f5efe0']);
});

test('interior-visit.mjs and interior-room.mjs export surfaces and source discipline', async () => {
  const visitSrc = await fs.readFile(path.join(__dirname, 'interior-visit.mjs'), 'utf8');
  const visitExports = [...visitSrc.matchAll(/^export (?:async function|function|const) (\w+)/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(visitExports, [
    'INTERIOR_EYE_LOCAL',
    'INTERIOR_LOOK_SENSITIVITY',
    'INTERIOR_PITCH_LIMIT',
    'INTERIOR_TARGET_LOCAL',
    'createInteriorVisit',
    'isDoorHit',
    'rayHitsInteriorDoor',
  ]);
  assert.equal(/^import /m.test(visitSrc), false);
  assert.equal(visitSrc.startsWith('/**'), true);
  assert.equal(visitSrc.includes('Walk-in Cottage Interior Visit'), true);

  const roomSrc = await fs.readFile(path.join(__dirname, 'interior-room.mjs'), 'utf8');
  const roomExports = [...roomSrc.matchAll(/^export (?:async function|function|const) (\w+)/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(roomExports, [
    'buildInteriorRoom',
    'buildProceduralOilLamp',
    'buildProceduralTeapot',
    'buildProceduralTypewriter',
    'setInteriorDressing',
    'setInteriorPalette',
    'setInteriorVisible',
  ]);
  assert.equal(/^import /m.test(roomSrc), false);
});

test('staging.js interior wiring contract and ?v=34 version pin', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');

  assert.equal(
    stagingSrc.includes(
      "import { buildInteriorRoom, setInteriorVisible, setInteriorPalette, setInteriorDressing } from './interior-room.mjs?v=34';"
    ),
    true
  );
  assert.equal(
    stagingSrc.includes(
      "import { isDoorHit, rayHitsInteriorDoor, createInteriorVisit } from './interior-visit.mjs?v=34';"
    ),
    true
  );
  assert.equal(stagingSrc.includes('const interiorVisit = createInteriorVisit({'), true);
  assert.equal(stagingSrc.includes('  room: interiorRoom,'), true);
  assert.equal(stagingSrc.includes('  setVisible: setInteriorVisible,'), true);
  assert.equal(stagingSrc.includes('  setPalette: setInteriorPalette,'), true);
  assert.equal(stagingSrc.includes('  setDressing: setInteriorDressing,'), true);
  assert.equal(stagingSrc.includes('if (isDoorHit(target, hit)) {'), true);
  assert.equal(
    stagingSrc.includes(
      'if (rayHitsInteriorDoor(interiorRoom, raycaster.ray.origin, raycaster.ray.direction)) {'
    ),
    true
  );

  const roomV34Count = stagingSrc.split('interior-room.mjs?v=34').length - 1;
  const visitV34Count = stagingSrc.split('interior-visit.mjs?v=34').length - 1;
  assert.equal(roomV34Count, 1);
  assert.equal(visitV34Count, 1);
});
