/**
 * Walk-in Cottage Interior Room — Part 1 & 2 (Slices 85–86)
 *
 * Purpose:
 *   Standalone procedural interior room module built as a separate THREE.Group
 *   toggled on entry, rather than walking through the Polyfork kit cottage's
 *   closed shell. Part 2 (interior-visit.mjs + staging.js) wires the door-tap
 *   trigger and camera cut.
 *
 * Envelope fit (corrected in Slice 86):
 *   Slice 85's 5.4 x 4.4 m room did NOT fit: the kit cottage's 6 x 5.06 x 3.97 m
 *   spec bbox is width x height x depth, not a floor plan. The real wall boxes
 *   are 4.8 x 3.2 m for the kit cottage (HX = 2.40, HZ = 1.60 in
 *   kit-medieval/cottage-small.mjs) and 4.0 x 3.4 m for Milo's cottage
 *   (widthX = 4.0, halfSpanZ = 1.7 in concept-cottage.js). Shrunk to
 *   3.7 m (X) x 3.0 m (Z) floor plan, 2.6 m wall height, and open rafters
 *   peaking at 2.72 m (overall bounds: 3.7 x 2.72 x 3.0 m), this room fits
 *   inside both shells with margin.
 *
 * Open rafters choice:
 *   There is no solid ceiling; 4 open rafters span the top of the walls so the
 *   thatch roofline above can still read from inside when toggled on.
 *
 * Mesh count: 16 meshes total (1 floor, 5 wall segments + 1 lintel, 2 window glows,
 *   4 open rafters, 3 furnishings: desk, rug, tea kettle).
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

const ROOM_WIDTH = 3.7;
const ROOM_DEPTH = 3.0;
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

  // Floor (3.7 x 0.08 x 3.0, y in [0, 0.08])
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
  const rafterZPositions = [-1.05, -0.35, 0.35, 1.05];
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
  // Positioned to clear all inner walls (x in [-1.73, 1.73], z in [-1.38, 1.38]) by >= 0.1 m.
  const deskHeight = 0.72;
  group.add(
    makeMesh(
      THREE,
      'interior_desk',
      new THREE.BoxGeometry(1.1, deskHeight, 0.6),
      woodMat,
      -0.95,
      FLOOR_THICKNESS + deskHeight / 2,
      -0.85
    )
  );

  const rugHeight = 0.04;
  group.add(
    makeMesh(
      THREE,
      'interior_rug',
      new THREE.BoxGeometry(1.6, rugHeight, 1.1),
      rugMat,
      0.25,
      FLOOR_THICKNESS + rugHeight / 2,
      0.15
    )
  );

  const kettleHeight = 0.24;
  group.add(
    makeMesh(
      THREE,
      'interior_tea_kettle',
      new THREE.CylinderGeometry(0.14, 0.18, kettleHeight, 8),
      kettleMat,
      -0.8,
      FLOOR_THICKNESS + deskHeight + kettleHeight / 2,
      -0.85
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

/**
 * Recolor the back accent wall for Milo ('#a8d8ea') or default cream plaster ('#f5efe0').
 * Null-safe: returns false if room or interior_wall_back is missing.
 * @param {THREE.Group|null|undefined} room
 * @param {string} [palette]
 * @returns {boolean}
 */
export function setInteriorPalette(room, palette) {
  if (!room || !Array.isArray(room.children)) return false;
  const backWall = room.children.find((m) => m && m.name === 'interior_wall_back');
  if (!backWall || !backWall.material) return false;
  const hex = palette === 'milo' ? PALETTE.miloAccent : PALETTE.plaster;
  if (backWall.material.color && typeof backWall.material.color.set === 'function') {
    backWall.material.color.set(hex);
  } else {
    backWall.material.color = hex;
  }
  return true;
}
