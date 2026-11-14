/**
 * Walk-in Cottage Interior Visit — Part 2 Door-Tap Trigger & Camera Cut (Slice 86)
 *
 * Purpose:
 *   Pure, DOM-free state machine and door hit-test for entering and exiting
 *   the shared interior_room group in staging-polyfork/staging.js.
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
 */

const DOOR_HALF_X = 0.6;
const DOOR_MAX_Y = 2.1;
const DOOR_Z_TOLERANCE = 0.2;
const KIT_FRONT_Z = 1.60;
const MILO_FRONT_Z = 1.70;

export const INTERIOR_EYE_LOCAL = Object.freeze({ x: 0, y: 1.55, z: 0.9 });
export const INTERIOR_TARGET_LOCAL = Object.freeze({ x: 0, y: 1.15, z: -1.3 });

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
 * Create the enter/exit state machine for the shared interior room.
 * @param {object} deps
 * @param {object} deps.room
 * @param {object} deps.camera
 * @param {object} deps.controls
 * @param {function} deps.setVisible
 * @param {function} deps.setPalette
 * @returns {{ enter: (cottage: object) => boolean, exit: () => boolean, isInside: () => boolean }}
 */
export function createInteriorVisit({ room, camera, controls, setVisible, setPalette }) {
  let inside = false;
  let savedCameraPos = null;
  let savedTarget = null;

  function isInside() {
    return inside;
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
    inside = false;
    return true;
  }

  return { enter, exit, isInside };
}
