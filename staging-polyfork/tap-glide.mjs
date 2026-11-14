// Orbit tap-to-glide + multi-pointer suppression helpers for staging-polyfork.
// stepGlide is vendored verbatim from town-3d/town.js (lines 2653-2704).
// Pure JS (no THREE import, no top-level document/window access) so Node tests
// can exercise every function directly.

export const DEFAULT_ORBIT_GLIDE_MAX_RADIUS = 38;

/**
 * Step an {x, z} position toward a target by at most speed * dt, clamping
 * inside maxRadius and snapping to the target once within arriveDist.
 */
export function stepGlide(
  position,
  target,
  dt,
  { speed = 7.5, maxRadius = 28.5, arriveDist = 0.3 } = {}
) {
  if (!Number.isFinite(dt) || dt <= 0) {
    return { x: position.x, z: position.z, arrived: false };
  }

  let tx = target.x;
  let tz = target.z;
  const targetDist = Math.hypot(tx, tz);
  if (targetDist > maxRadius && targetDist > 0) {
    const scale = maxRadius / targetDist;
    tx *= scale;
    tz *= scale;
  }

  const dx = tx - position.x;
  const dz = tz - position.z;
  const dist = Math.hypot(dx, dz);
  const maxStep = speed * dt;

  let nextX;
  let nextZ;
  if (dist <= maxStep || dist === 0) {
    nextX = tx;
    nextZ = tz;
  } else {
    const ratio = maxStep / dist;
    nextX = position.x + dx * ratio;
    nextZ = position.z + dz * ratio;
  }

  const nextDist = Math.hypot(nextX, nextZ);
  if (nextDist > maxRadius && nextDist > 0) {
    const clampScale = maxRadius / nextDist;
    nextX *= clampScale;
    nextZ *= clampScale;
  }

  const rem = Math.hypot(tx - nextX, tz - nextZ);
  if (rem <= arriveDist) {
    return { x: tx, z: tz, arrived: true };
  }
  return { x: nextX, z: nextZ, arrived: false };
}

/**
 * Derive a safe island-bound glide radius from the terrain's userData.terrain.
 * On the span-2 (128 m) island, half-width is 64 m and the lake/cliff edge
 * begins around 40-47 m (staging.js keepClear/pine-ring bounds), so 38 m keeps
 * the orbit target on the island while reaching all buildings (windmill ~29.7 m).
 */
export function deriveGlideMaxRadius(terrainUserData) {
  const width = terrainUserData?.width;
  if (!Number.isFinite(width) || width <= 0) {
    return DEFAULT_ORBIT_GLIDE_MAX_RADIUS;
  }
  return Math.max(28.5, Math.min(DEFAULT_ORBIT_GLIDE_MAX_RADIUS, width / 2 - 26));
}

/**
 * Clamp an {x, z} glide target inside maxRadius.
 */
export function clampGlideTarget(x, z, maxRadius = DEFAULT_ORBIT_GLIDE_MAX_RADIUS) {
  let tx = x;
  let tz = z;
  const dist = Math.hypot(tx, tz);
  if (dist > maxRadius && dist > 0) {
    const clampScale = maxRadius / dist;
    tx *= clampScale;
    tz *= clampScale;
  }
  return { x: tx, z: tz };
}

/**
 * Step an OrbitControls target toward glideTarget using stepGlide and translate
 * the camera by the exact same (dx, dz) delta so the view follows.
 */
export function stepOrbitGlide(
  target,
  cameraPos,
  glideTarget,
  dt,
  { speed = 14, maxRadius = DEFAULT_ORBIT_GLIDE_MAX_RADIUS, arriveDist = 0.3 } = {}
) {
  const next = stepGlide(
    { x: target.x, z: target.z },
    glideTarget,
    dt,
    { speed, maxRadius, arriveDist }
  );
  const dx = next.x - target.x;
  const dz = next.z - target.z;
  return {
    targetX: next.x,
    targetZ: next.z,
    cameraX: cameraPos.x + dx,
    cameraZ: cameraPos.z + dz,
    arrived: next.arrived,
  };
}

/**
 * Track active pointers so a two-finger pinch (or >4 px drag) cancels any
 * in-flight glide and suppresses click/tap-glide on pointerup.
 */
export function createPointerTracker({ dragThreshold = 4 } = {}) {
  const activePointers = new Map();
  let downPos = null;
  let didDrag = false;
  let gestureHadMultiPointer = false;

  function reset() {
    activePointers.clear();
    downPos = null;
    didDrag = false;
    gestureHadMultiPointer = false;
  }

  function onPointerDown(pointerId, x, y, { overlayHidden = true, pointerType = 'mouse', button = 0 } = {}) {
    if (!overlayHidden) {
      return { started: false, isPinch: false, cancelGlide: false };
    }
    if (activePointers.size === 0 && pointerType === 'mouse' && button !== 0) {
      return { started: false, isPinch: false, cancelGlide: false };
    }
    activePointers.set(pointerId, { x, y });
    if (activePointers.size === 1) {
      downPos = { x, y };
      didDrag = false;
      gestureHadMultiPointer = false;
      return { started: true, isPinch: false, cancelGlide: false };
    }
    didDrag = true;
    gestureHadMultiPointer = true;
    return { started: true, isPinch: true, cancelGlide: true };
  }

  function onPointerMove(pointerId, x, y, { overlayHidden = true } = {}) {
    if (!activePointers.has(pointerId)) {
      return { moved: false, isPinch: false, cancelGlide: false };
    }
    activePointers.set(pointerId, { x, y });
    if (!overlayHidden) {
      return { moved: false, isPinch: false, cancelGlide: false };
    }
    if (activePointers.size >= 2) {
      didDrag = true;
      gestureHadMultiPointer = true;
      return { moved: true, isPinch: true, cancelGlide: true };
    }
    if (
      downPos &&
      (Math.abs(x - downPos.x) > dragThreshold || Math.abs(y - downPos.y) > dragThreshold)
    ) {
      didDrag = true;
      return { moved: true, isPinch: false, cancelGlide: true };
    }
    return { moved: true, isPinch: false, cancelGlide: false };
  }

  function onPointerUp(pointerId, x, y, { overlayHidden = true, allowTap = true } = {}) {
    if (!activePointers.has(pointerId)) {
      return { ended: false, shouldClick: false };
    }
    activePointers.delete(pointerId);
    if (activePointers.size > 0) {
      return { ended: false, shouldClick: false };
    }
    const withinThreshold =
      downPos !== null &&
      Math.abs(x - downPos.x) <= dragThreshold &&
      Math.abs(y - downPos.y) <= dragThreshold;
    const shouldClick = Boolean(
      allowTap && overlayHidden && !didDrag && !gestureHadMultiPointer && withinThreshold
    );
    downPos = null;
    didDrag = false;
    gestureHadMultiPointer = false;
    return { ended: true, shouldClick };
  }

  return {
    get size() {
      return activePointers.size;
    },
    reset,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
