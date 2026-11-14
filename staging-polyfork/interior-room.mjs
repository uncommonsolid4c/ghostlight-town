/**
 * Walk-in Cottage Interior Room — Part 1 Feasibility Proof (Slice 85)
 *
 * Purpose:
 *   Standalone procedural interior room module proving that a walk-in cottage
 *   interior can be built as a separate THREE.Group toggled on entry, rather
 *   than walking through the Polyfork kit cottage's closed shell.
 *
 * Kit envelope fit:
 *   The Polyfork kit cottage (kit-medieval/cottage-small.mjs) is a 6 x 5.06 x 3.97 m
 *   single-material closed shell with no real interior geometry. This room fits
 *   comfortably inside it: 5.4 m (X) x 4.4 m (Z) floor plan, 2.6 m wall height,
 *   and open rafters peaking at 2.72 m (overall bounds: 5.4 x 2.72 x 4.4 m).
 *
 * Open rafters choice:
 *   There is no solid ceiling; 4 open rafters span the top of the walls so the
 *   thatch roofline above can still read from inside when toggled on.
 *
 * Mesh count: 16 meshes total (1 floor, 5 wall segments + 1 lintel, 2 window glows,
 *   4 open rafters, 3 furnishings: desk, rug, tea kettle).
 *
 * Verdict demonstrated:
 *   A separate interior_room group (hidden by default, toggled via
 *   setInteriorVisible) builds cleanly, stays deterministic, fits inside the
 *   kit shell with wall thickness to spare, and avoids modifying the closed kit
 *   mesh. Part 2 will wire the door-tap trigger and camera cut into staging.js.
 */

// Palette ledger colors from CONCEPT.md (no unledgered hexes).
const PALETTE = {
  wood: '#6b492b',
  plaster: '#f5efe0',
  miloAccent: '#a8d8ea',
  windowGlow: '#ffbe5c',
  rug: '#5a4332',
  kettle: '#b59449',
};

const ROOM_WIDTH = 5.4;
const ROOM_DEPTH = 4.4;
const WALL_HEIGHT = 2.6;
const WALL_THICKNESS = 0.12;
const FLOOR_THICKNESS = 0.08;
const DOOR_WIDTH = 1.0;
const DOOR_HEIGHT = 2.0;

function makeMesh(THREE, name, geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Build a standalone walk-in cottage interior group, hidden by default.
 * @param {object} THREE - Three.js module or headless stub.
 * @param {object} [opts]
 * @param {string} [opts.palette] - Pass 'milo' for Milo's ice-blue accent wall.
 * @returns {THREE.Group}
 */
export function buildInteriorRoom(THREE, opts = {}) {
  const group = new THREE.Group();
  group.name = 'interior_room';
  group.visible = false;

  const isMilo = opts && opts.palette === 'milo';

  const woodMat = new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.85 });
  const plasterMat = new THREE.MeshStandardMaterial({ color: PALETTE.plaster, roughness: 0.9 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: isMilo ? PALETTE.miloAccent : PALETTE.plaster,
    roughness: 0.9,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: PALETTE.windowGlow,
    emissive: PALETTE.windowGlow,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });
  const rugMat = new THREE.MeshStandardMaterial({ color: PALETTE.rug, roughness: 0.95 });
  const kettleMat = new THREE.MeshStandardMaterial({ color: PALETTE.kettle, roughness: 0.5 });

  // Floor (5.4 x 0.08 x 4.4, y in [0, 0.08])
  group.add(
    makeMesh(
      THREE,
      'interior_floor',
      new THREE.BoxGeometry(ROOM_WIDTH, FLOOR_THICKNESS, ROOM_DEPTH),
      woodMat,
      0,
      FLOOR_THICKNESS / 2,
      0
    )
  );

  const halfW = ROOM_WIDTH / 2;
  const halfD = ROOM_DEPTH / 2;
  const wallCenterY = WALL_HEIGHT / 2;
  const sideSpanZ = ROOM_DEPTH - WALL_THICKNESS * 2;

  // Back wall (-z): Milo's ice-blue accent wall when opts.palette === 'milo'
  group.add(
    makeMesh(
      THREE,
      'interior_wall_back',
      new THREE.BoxGeometry(ROOM_WIDTH, WALL_HEIGHT, WALL_THICKNESS),
      accentMat,
      0,
      wallCenterY,
      -(halfD - WALL_THICKNESS / 2)
    )
  );

  // Left and right walls (-x, +x)
  group.add(
    makeMesh(
      THREE,
      'interior_wall_left',
      new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, sideSpanZ),
      plasterMat,
      -(halfW - WALL_THICKNESS / 2),
      wallCenterY,
      0
    )
  );
  group.add(
    makeMesh(
      THREE,
      'interior_wall_right',
      new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, sideSpanZ),
      plasterMat,
      halfW - WALL_THICKNESS / 2,
      wallCenterY,
      0
    )
  );

  // Front (+z) wall split into left/right segments around a centered 1.0 x 2.0 m door opening
  const frontZ = halfD - WALL_THICKNESS / 2;
  const sideSegWidth = (ROOM_WIDTH - DOOR_WIDTH) / 2;
  const sideSegOffsetX = DOOR_WIDTH / 2 + sideSegWidth / 2;

  group.add(
    makeMesh(
      THREE,
      'interior_wall_front_left',
      new THREE.BoxGeometry(sideSegWidth, WALL_HEIGHT, WALL_THICKNESS),
      plasterMat,
      -sideSegOffsetX,
      wallCenterY,
      frontZ
    )
  );
  group.add(
    makeMesh(
      THREE,
      'interior_wall_front_right',
      new THREE.BoxGeometry(sideSegWidth, WALL_HEIGHT, WALL_THICKNESS),
      plasterMat,
      sideSegOffsetX,
      wallCenterY,
      frontZ
    )
  );

  const lintelHeight = WALL_HEIGHT - DOOR_HEIGHT;
  group.add(
    makeMesh(
      THREE,
      'interior_wall_front_lintel',
      new THREE.BoxGeometry(DOOR_WIDTH, lintelHeight, WALL_THICKNESS),
      plasterMat,
      0,
      DOOR_HEIGHT + lintelHeight / 2,
      frontZ
    )
  );

  // Two warm emissive window glow planes (no dynamic lights)
  const glowOffsetX = halfW - WALL_THICKNESS - 0.01;
  group.add(
    makeMesh(
      THREE,
      'interior_window_glow_left',
      new THREE.BoxGeometry(0.02, 0.8, 0.9),
      glowMat,
      -glowOffsetX,
      1.45,
      0
    )
  );
  group.add(
    makeMesh(
      THREE,
      'interior_window_glow_right',
      new THREE.BoxGeometry(0.02, 0.8, 0.9),
      glowMat,
      glowOffsetX,
      1.45,
      0
    )
  );

  // Open rafters above (no solid ceiling, so the thatch roofline reads from inside)
  const rafterZPositions = [-1.5, -0.5, 0.5, 1.5];
  const rafterHeight = 0.12;
  for (let i = 0; i < rafterZPositions.length; i++) {
    group.add(
      makeMesh(
        THREE,
        `interior_rafter_${i + 1}`,
        new THREE.BoxGeometry(ROOM_WIDTH - WALL_THICKNESS * 2, rafterHeight, 0.14),
        woodMat,
        0,
        WALL_HEIGHT + rafterHeight / 2,
        rafterZPositions[i]
      )
    );
  }

  // Procedural furnishings (reusing manifest prop kinds: desk, rug, tea_kettle)
  const deskHeight = 0.72;
  group.add(
    makeMesh(
      THREE,
      'interior_desk',
      new THREE.BoxGeometry(1.1, deskHeight, 0.6),
      woodMat,
      -1.4,
      FLOOR_THICKNESS + deskHeight / 2,
      -1.2
    )
  );

  const rugHeight = 0.04;
  group.add(
    makeMesh(
      THREE,
      'interior_rug',
      new THREE.BoxGeometry(1.6, rugHeight, 1.1),
      rugMat,
      0.2,
      FLOOR_THICKNESS + rugHeight / 2,
      0.1
    )
  );

  const kettleHeight = 0.24;
  group.add(
    makeMesh(
      THREE,
      'interior_tea_kettle',
      new THREE.CylinderGeometry(0.14, 0.18, kettleHeight, 8),
      kettleMat,
      -1.2,
      FLOOR_THICKNESS + deskHeight + kettleHeight / 2,
      -1.2
    )
  );

  return group;
}

/**
 * Toggle visibility of an interior room group. Safe if room is null/undefined.
 * @param {THREE.Group|null|undefined} room
 * @param {boolean} visible
 * @returns {boolean}
 */
export function setInteriorVisible(room, visible) {
  if (!room || typeof room !== 'object') return false;
  room.visible = Boolean(visible);
  return room.visible;
}
