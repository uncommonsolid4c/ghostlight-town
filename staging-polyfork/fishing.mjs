// Minimal lakeside fishing spot for staging-polyfork:
// Deterministic shore-crossing finder + propped rod, tackle box, line, bobber, and ripples.

const CREAM = '#f5efe0';
const CEDAR = '#6b492b';

// 45 degrees measured from south (+z) toward east (+x).
const BEARING_RAD = Math.PI / 4;
const DIR_X = Math.sin(BEARING_RAD);
const DIR_Z = Math.cos(BEARING_RAD);

const SEARCH_MIN_R = 10;
const SEARCH_MAX_R = 60;
const SEARCH_STEP = 0.25;
const PULLBACK_M = 1.5;
const VALID_MIN_R = 25;
const VALID_MAX_R = 50;
const DRY_FEET_CLEARANCE = 0.3;

const BOBBER_OUT_M = 2.5;
const RIPPLE_RADII = [0.3, 0.6, 0.9];

/**
 * Find a deterministic lakeside fishing spot along the 45-degree bearing from (0, 0).
 * Returns null if no valid shore crossing is found or the spot fails dry-feet / radius bounds.
 */
export function findFishingSpot({ groundAt, waterY, groundY }) {
  if (typeof groundAt !== 'function' || !Number.isFinite(waterY)) {
    return null;
  }

  let lastLandR = null;
  let crossingFound = false;

  for (let r = SEARCH_MIN_R; r <= SEARCH_MAX_R + 1e-9; r += SEARCH_STEP) {
    const x = DIR_X * r;
    const z = DIR_Z * r;
    const y = groundAt(x, z);
    if (!Number.isFinite(y)) return null;

    if (y < waterY) {
      if (lastLandR === null) return null;
      crossingFound = true;
      break;
    }
    lastLandR = r;
  }

  if (!crossingFound || lastLandR === null) {
    return null;
  }

  const spotR = lastLandR - PULLBACK_M;
  if (spotR < VALID_MIN_R || spotR > VALID_MAX_R) {
    return null;
  }

  const x = DIR_X * spotR;
  const z = DIR_Z * spotR;
  const y = groundAt(x, z);
  if (!Number.isFinite(y) || y < waterY + DRY_FEET_CLEARANCE) {
    return null;
  }
  if (Number.isFinite(groundY) && y <= groundY + 0.01) {
    return null;
  }

  return {
    x,
    y,
    z,
    r: spotR,
    shoreR: lastLandR,
    bearingRad: BEARING_RAD,
    dirX: DIR_X,
    dirZ: DIR_Z,
  };
}

/**
 * Build the 3D fishing-spot group at `spot` facing the water.
 */
export function buildFishingSpot(THREE, spot, { waterY, createRod, createTackleBox } = {}) {
  const group = new THREE.Group();
  group.name = 'fishing-spot';
  group.position.set(spot.x, spot.y, spot.z);
  group.rotation.y = spot.bearingRad;

  const rod = typeof createRod === 'function' ? createRod() : new THREE.Group();
  rod.name = 'propped-fishing-rod';
  rod.position.set(0, 0, 0);
  group.add(rod);

  const tackleBox = typeof createTackleBox === 'function' ? createTackleBox() : new THREE.Group();
  tackleBox.name = 'tackle-box';
  tackleBox.position.set(-0.55, 0, -0.25);
  group.add(tackleBox);

  const localWaterY = waterY - spot.y;
  const bobberY = localWaterY + 0.05;
  const bobberZ = BOBBER_OUT_M;

  const tipY = 0.95;
  const tipZ = 0.75;
  const dy = bobberY - tipY;
  const dz = bobberZ - tipZ;
  const lineLen = Math.hypot(dy, dz);

  const lineMat = new THREE.MeshStandardMaterial({ color: CEDAR, roughness: 0.9 });
  const lineGeom = new THREE.CylinderGeometry(0.008, 0.008, lineLen, 6);
  const line = new THREE.Mesh(lineGeom, lineMat);
  line.name = 'fishing-line';
  line.position.set(0, (tipY + bobberY) / 2, (tipZ + bobberZ) / 2);
  line.rotation.x = Math.atan2(dz, dy);
  group.add(line);

  const creamMat = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.7 });
  const bobberGeom = new THREE.SphereGeometry(0.06, 12, 8);
  const bobber = new THREE.Mesh(bobberGeom, creamMat);
  bobber.name = 'bobber';
  bobber.position.set(0, bobberY, bobberZ);
  group.add(bobber);

  const rippleY = localWaterY + 0.02;
  for (let i = 0; i < RIPPLE_RADII.length; i++) {
    const outerR = RIPPLE_RADII[i];
    const innerR = outerR - 0.025;
    const rippleGeom = new THREE.RingGeometry(innerR, outerR, 24);
    const ripple = new THREE.Mesh(rippleGeom, creamMat);
    ripple.name = `ripple-${i}`;
    ripple.position.set(0, rippleY, bobberZ);
    ripple.rotation.x = -Math.PI / 2;
    group.add(ripple);
  }

  return group;
}
