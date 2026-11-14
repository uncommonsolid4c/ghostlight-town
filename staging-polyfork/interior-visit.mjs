/**
 * Walk-in Cottage Interior Visit — Part 2 & 3 (Slices 86–87)
 *
 * Purpose:
 *   Pure, DOM-free state machine, door hit-test, look-around, and interior
 *   doorway exit ray-test for the shared interior_room group in
 *   staging-polyfork/staging.js.
 *
 * Door-detection rule (checked before the plot-overlay branch):
 *   1. Named door: walk hit.object's ancestors for a node named 'door' or
 *      'door-leaf' (kit cottages: kit-medieval/cottage-small.mjs:420-436).
 *   2. Local-rect fallback (Milo's cottage is merged geometry with no named
 *      door mesh): transform hit.point into the cottage's local space via
 *      cottage.worldToLocal (or accept a pre-transformed local hit.point when
 *      running against a headless stub without worldToLocal) and test:
 *        |x| <= 0.6, 0 <= y <= 2.1, z >= frontZ - 0.2
 *      where frontZ is 1.60 for kit cottages (HZ) and 1.70 for Milo's
 *      cottage (halfSpanZ in concept-cottage.js), selected by handle === 'milo'.
 *
 * Camera pose inside the room (room-local coords, transformed via room matrix):
 *   - Eye:     (0, 1.55, 0.9)
 *   - Look-at: (0, 1.15, -1.3)
 *
 * Look-around (Slice 87):
 *   - Sensitivity: INTERIOR_LOOK_SENSITIVITY = 0.005 rad/px.
 *   - Pitch clamp: [-INTERIOR_PITCH_LIMIT, +INTERIOR_PITCH_LIMIT] = [-0.6, +0.6] rad.
 *   - Derived constants from INTERIOR_EYE_LOCAL and INTERIOR_TARGET_LOCAL:
 *     DIST = |TARGET - EYE| = Math.sqrt(5),
 *     PITCH0 = Math.asin((TARGET.y - EYE.y) / DIST) (≈ -0.1799 rad).
 *   - Sign convention: drag right (dxPx > 0) -> yaw -= dxPx * 0.005 (look right);
 *     drag up (dyPx < 0) -> pitch -= dyPx * 0.005 (look up), clamped after delta.
 *   - Room-local direction: (-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch)).
 *   - Camera position stays fixed; exit() resets yaw = 0, pitch = PITCH0.
 *
 * Interior door-ray exit rule (Slice 87 — rayHitsInteriorDoor):
 *   - Transform world origin into room-local space via room.worldToLocal
 *     (headless stub seam: if worldToLocal is absent, treat origin as already
 *     room-local). Transform world direction rotation-only by -room.rotation.y.
 *   - Intersect with the front (+z) wall center plane z = 1.44
 *     (ROOM_DEPTH / 2 - WALL_THICKNESS / 2 = 1.5 - 0.06): require dz > 1e-9
 *     and t = (1.44 - oz) / dz > 0, and hit point |x| <= 0.5, 0 <= y <= 2.0.
 */

const DOOR_HALF_X = 0.6;
const DOOR_MAX_Y = 2.1;
const DOOR_Z_TOLERANCE = 0.2;
const KIT_FRONT_Z = 1.60;
const MILO_FRONT_Z = 1.70;

const INTERIOR_FRONT_PLANE_Z = 1.44;
const INTERIOR_DOOR_HALF_X = 0.5;
const INTERIOR_DOOR_MAX_Y = 2.0;

export const INTERIOR_EYE_LOCAL = Object.freeze({ x: 0, y: 1.55, z: 0.9 });
export const INTERIOR_TARGET_LOCAL = Object.freeze({ x: 0, y: 1.15, z: -1.3 });
export const INTERIOR_LOOK_SENSITIVITY = 0.005;
export const INTERIOR_PITCH_LIMIT = 0.6;

const LOOK_DELTA_X = INTERIOR_TARGET_LOCAL.x - INTERIOR_EYE_LOCAL.x;
const LOOK_DELTA_Y = INTERIOR_TARGET_LOCAL.y - INTERIOR_EYE_LOCAL.y;
const LOOK_DELTA_Z = INTERIOR_TARGET_LOCAL.z - INTERIOR_EYE_LOCAL.z;
const INTERIOR_LOOK_DIST = Math.hypot(LOOK_DELTA_X, LOOK_DELTA_Y, LOOK_DELTA_Z);
const PITCH0 = Math.asin(LOOK_DELTA_Y / INTERIOR_LOOK_DIST);

function hasDoorAncestor(obj, root) {
  let cur = obj;
  while (cur) {
    if (cur.name === 'door' || cur.name === 'door-leaf') return true;
    if (cur === root) break;
    cur = cur.parent || null;
  }
  return false;
}

function toCottageLocalPoint(cottage, point) {
  if (typeof cottage.worldToLocal === 'function') {
    const vec = typeof point.clone === 'function'
      ? point.clone()
      : { x: point.x, y: point.y, z: point.z };
    return cottage.worldToLocal(vec);
  }
  // Headless stub seam: when cottage.worldToLocal is absent, hit.point is
  // treated as already in cottage-local coordinates.
  return point;
}

/**
 * Determine whether a raycast hit on a cottage struck its front door.
 * @param {object|null|undefined} cottage
 * @param {object|null|undefined} hit
 * @returns {boolean}
 */
export function isDoorHit(cottage, hit) {
  if (!cottage || !hit) return false;
  if (hit.object && hasDoorAncestor(hit.object, cottage)) {
    return true;
  }
  if (!hit.point) return false;

  const local = toCottageLocalPoint(cottage, hit.point);
  if (!local) return false;

  const frontZ = cottage.userData?.handle === 'milo' ? MILO_FRONT_Z : KIT_FRONT_Z;
  return (
    Math.abs(local.x) <= DOOR_HALF_X &&
    local.y >= 0 &&
    local.y <= DOOR_MAX_Y &&
    local.z >= frontZ - DOOR_Z_TOLERANCE
  );
}

function copyVec3(v) {
  return { x: v.x, y: v.y, z: v.z };
}

function setVec3(target, src) {
  if (typeof target.set === 'function') {
    target.set(src.x, src.y, src.z);
  } else {
    target.x = src.x;
    target.y = src.y;
    target.z = src.z;
  }
}

function roomLocalToWorld(room, camera, local) {
  if (typeof room.localToWorld === 'function') {
    const vec = typeof camera.position?.clone === 'function'
      ? camera.position.clone()
      : { x: local.x, y: local.y, z: local.z };
    setVec3(vec, local);
    const out = room.localToWorld(vec);
    return { x: out.x, y: out.y, z: out.z };
  }
  const ry = room.rotation?.y ?? 0;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  const px = room.position?.x ?? 0;
  const py = room.position?.y ?? 0;
  const pz = room.position?.z ?? 0;
  return {
    x: px + local.x * cos + local.z * sin,
    y: py + local.y,
    z: pz - local.x * sin + local.z * cos,
  };
}

/**
 * Test whether a world-space ray intersects the interior room's front (+z)
 * doorway gap on the plane z = 1.44 (|x| <= 0.5, 0 <= y <= 2.0).
 * @param {object|null|undefined} room
 * @param {{ x: number, y: number, z: number }|null|undefined} origin
 * @param {{ x: number, y: number, z: number }|null|undefined} direction
 * @returns {boolean}
 */
export function rayHitsInteriorDoor(room, origin, direction) {
  if (!room || !origin || !direction) return false;
  if (
    !Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z) ||
    !Number.isFinite(direction.x) || !Number.isFinite(direction.y) || !Number.isFinite(direction.z)
  ) {
    return false;
  }

  // Headless stub seam: when room.worldToLocal is absent, treat origin as already room-local.
  const localOrigin = toCottageLocalPoint(room, origin);
  if (!localOrigin) return false;

  const rot = room.rotation?.y ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const lx = direction.x * cos - direction.z * sin;
  const ly = direction.y;
  const lz = direction.x * sin + direction.z * cos;

  if (lz <= 1e-9) return false;

  const t = (INTERIOR_FRONT_PLANE_Z - localOrigin.z) / lz;
  if (t <= 0) return false;

  const hx = localOrigin.x + t * lx;
  const hy = localOrigin.y + t * ly;
  return Math.abs(hx) <= INTERIOR_DOOR_HALF_X && hy >= 0 && hy <= INTERIOR_DOOR_MAX_Y;
}

/**
 * Create the enter/exit/look-around state machine for the shared interior room.
 * @param {object} deps
 * @param {object} deps.room
 * @param {object} deps.camera
 * @param {object} deps.controls
 * @param {function} deps.setVisible
 * @param {function} deps.setPalette
 * @returns {{ enter: (cottage: object) => boolean, exit: () => boolean, isInside: () => boolean, lookBy: (dxPx: number, dyPx: number) => boolean }}
 */
export function createInteriorVisit({ room, camera, controls, setVisible, setPalette }) {
  let inside = false;
  let savedCameraPos = null;
  let savedTarget = null;
  let yaw = 0;
  let pitch = PITCH0;

  function isInside() {
    return inside;
  }

  function applyLook() {
    const cosPitch = Math.cos(pitch);
    const dirX = -Math.sin(yaw) * cosPitch;
    const dirY = Math.sin(pitch);
    const dirZ = -Math.cos(yaw) * cosPitch;
    const targetLocal = {
      x: INTERIOR_EYE_LOCAL.x + dirX * INTERIOR_LOOK_DIST,
      y: INTERIOR_EYE_LOCAL.y + dirY * INTERIOR_LOOK_DIST,
      z: INTERIOR_EYE_LOCAL.z + dirZ * INTERIOR_LOOK_DIST,
    };
    const targetWorld = roomLocalToWorld(room, camera, targetLocal);
    setVec3(controls.target, targetWorld);
    if (typeof camera.lookAt === 'function') {
      camera.lookAt(targetWorld.x, targetWorld.y, targetWorld.z);
    }
  }

  function lookBy(dxPx, dyPx) {
    if (!inside) return false;
    yaw -= dxPx * INTERIOR_LOOK_SENSITIVITY;
    pitch = Math.max(
      -INTERIOR_PITCH_LIMIT,
      Math.min(INTERIOR_PITCH_LIMIT, pitch - dyPx * INTERIOR_LOOK_SENSITIVITY)
    );
    applyLook();
    return true;
  }

  function enter(cottage) {
    if (inside || !cottage || !room || !camera || !controls) return false;

    savedCameraPos = copyVec3(camera.position);
    savedTarget = copyVec3(controls.target);

    if (typeof room.position?.copy === 'function') {
      room.position.copy(cottage.position);
    } else if (room.position && cottage.position) {
      setVec3(room.position, cottage.position);
    }
    if (room.rotation) {
      room.rotation.y = cottage.rotation?.y ?? 0;
    }
    if (typeof room.updateMatrixWorld === 'function') {
      room.updateMatrixWorld(true);
    }

    const handle = cottage.userData?.handle;
    if (typeof setPalette === 'function') {
      setPalette(room, handle === 'milo' ? 'milo' : 'default');
    }
    if (typeof setVisible === 'function') {
      setVisible(room, true);
    }

    yaw = 0;
    pitch = PITCH0;

    const eyeWorld = roomLocalToWorld(room, camera, INTERIOR_EYE_LOCAL);
    const targetWorld = roomLocalToWorld(room, camera, INTERIOR_TARGET_LOCAL);

    setVec3(camera.position, eyeWorld);
    setVec3(controls.target, targetWorld);
    if (typeof camera.lookAt === 'function') {
      camera.lookAt(targetWorld.x, targetWorld.y, targetWorld.z);
    }
    controls.enabled = false;
    inside = true;
    return true;
  }

  function exit() {
    if (!inside) return false;

    if (typeof setVisible === 'function') {
      setVisible(room, false);
    }
    if (savedCameraPos) {
      setVec3(camera.position, savedCameraPos);
    }
    if (savedTarget) {
      setVec3(controls.target, savedTarget);
    }
    controls.enabled = true;

    savedCameraPos = null;
    savedTarget = null;
    yaw = 0;
    pitch = PITCH0;
    inside = false;
    return true;
  }

  return { enter, exit, isInside, lookBy };
}
