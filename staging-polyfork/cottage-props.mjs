// Staging-local cottage plot props builder (Slice 69).
// No top-level THREE or document access so unit tests can run headless in Node.

// Verbatim from town-3d/town.js (:177-190)
const VALID_PROP_KINDS = new Set([
  'desk',
  'bookshelf',
  'rug',
  'tea_kettle',
  'typewriter',
  'cat',
  'poster_frame',
]);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function safeColor(hex, fallback) {
  return typeof hex === 'string' && HEX_COLOR_RE.test(hex) ? hex : fallback;
}

// Verbatim from town-3d/town.js (:447-513)
function buildProp(THREE, prop) {
  if (!prop || typeof prop !== 'object') return null;
  if (!VALID_PROP_KINDS.has(prop.kind)) return null;

  for (const axis of ['x', 'y', 'z']) {
    if (typeof prop[axis] !== 'number' || !Number.isFinite(prop[axis]) || prop[axis] < -12 || prop[axis] > 12) {
      return null;
    }
  }
  if (typeof prop.rot_y !== 'number' || !Number.isFinite(prop.rot_y) || prop.rot_y < 0 || prop.rot_y >= 360) {
    return null;
  }

  // Cottages are solid boxes/shells, so interior z props would be invisible inside them.
  // Unfold interior z onto a front porch band [PORCH_NEAR, PORCH_FAR]; props already >= PORCH_NEAR pass through.
  const PORCH_NEAR = 2.05;
  const PORCH_FAR = 3.45;
  const INTERIOR_HALF = 2.0;
  const PORCH_FLOOR_Y = 0.18;
  let propZ = prop.z;
  if (propZ < PORCH_NEAR) {
    const clampedZ = Math.max(-INTERIOR_HALF, Math.min(INTERIOR_HALF, propZ));
    propZ = PORCH_NEAR + ((INTERIOR_HALF - clampedZ) / (2 * INTERIOR_HALF)) * (PORCH_FAR - PORCH_NEAR);
  }
  const baseY = prop.y + (propZ >= PORCH_NEAR ? PORCH_FLOOR_Y : 0);

  const color = safeColor(prop.color, '#8a6240');
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  let mesh;

  switch (prop.kind) {
    case 'desk':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.72, 0.6), mat);
      mesh.position.set(prop.x, baseY + 0.36, propZ);
      break;
    case 'bookshelf':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.35), mat);
      mesh.position.set(prop.x, baseY + 0.7, propZ);
      break;
    case 'rug':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 1.1), mat);
      mesh.position.set(prop.x, baseY + 0.02, propZ);
      break;
    case 'tea_kettle':
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.24, 8), mat);
      mesh.position.set(prop.x, baseY + 0.12, propZ);
      break;
    case 'typewriter':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.3), mat);
      mesh.position.set(prop.x, baseY + 0.09, propZ);
      break;
    case 'cat':
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 6), mat);
      mesh.position.set(prop.x, baseY + 0.18, propZ);
      break;
    case 'poster_frame':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.06), mat);
      mesh.position.set(prop.x, baseY + 0.9, propZ);
      break;
    default:
      return null;
  }

  mesh.name = `prop_${prop.kind}`;
  mesh.rotation.y = (prop.rot_y * Math.PI) / 180;
  return mesh;
}

// Verbatim from town-npc/plots/milo/manifest.json props
export const MILO_PLOT_PROPS = [
  { kind: 'desk', x: -1.2, y: 0, z: 2.2, rot_y: 180, color: '#7a5230' },
  { kind: 'tea_kettle', x: -1.0, y: 0.78, z: 2.2, rot_y: 45, color: '#b87333' },
  { kind: 'cat', x: 1.3, y: 0, z: 2.1, rot_y: 210, color: '#2b2b2b' },
];

/**
 * Build and attach valid plot props to a cottage group in cottage-local coordinates.
 * Skips invalid props (null from buildProp) and returns the number attached.
 */
export function attachPlotProps(THREE, cottage, props) {
  if (!cottage || !Array.isArray(props)) return 0;
  let count = 0;
  for (const prop of props) {
    const mesh = buildProp(THREE, prop);
    if (mesh) {
      cottage.add(mesh);
      count++;
    }
  }
  return count;
}

/**
 * Attach a wooden porch deck slab (4.8 × 0.18 × 1.2, top y = 0.18, z ∈ [2.3, 3.5])
 * to a cottage group in cottage-local coordinates.
 */
export function attachPorchDeck(THREE, cottage) {
  if (!cottage) return null;
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 0.18, 1.2),
    new THREE.MeshStandardMaterial({ color: '#6b492b', roughness: 0.9 })
  );
  deck.name = 'cottage_porch_deck';
  deck.position.set(0, 0.09, 2.9);
  cottage.add(deck);
  return deck;
}

export { VALID_PROP_KINDS, HEX_COLOR_RE, safeColor, buildProp };
