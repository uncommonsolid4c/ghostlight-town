/**
 * Walk-in Cottage Interior Room — Part 1, 2 & 3 (Slices 85–86, 88)
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
 * Per-cottage dressing (Slice 88):
 *   One signature per resident handle on the desk-top slot (-0.8, 0.8, -0.85),
 *   all four dressing groups hidden at build and toggled by setInteriorDressing:
 *   - milo:  tea kettle + floor cat (1.35, 0.26, -0.9); also the fallback for
 *            unknown / null / undefined / empty handles.
 *   - wick:  oil lamp (vendored verbatim from town-3d/town.js:1417-1438).
 *   - maren: typewriter (vendored verbatim from town-3d/town.js:1440-1459).
 *   - tomas: teapot (vendored verbatim from town-3d/town.js:1461-1477).
 *
 * Direct-child count: 19 (1 floor, 5 wall segments + 1 lintel, 2 window glows,
 *   4 open rafters, 2 shared furnishings [desk, rug], 4 dressing groups).
 */

// Palette ledger colors from CONCEPT.md (no unledgered hexes).
// Per-resident interior accents come from town-npc/plots/<handle>/manifest.json
// (wick trim, maren roof, tomas roof, milo wall).
const PALETTE = {
  wood: '#6b492b',
  plaster: '#f5efe0',
  miloAccent: '#a8d8ea',
  wickAccent: '#c8922e',
  marenAccent: '#43505c',
  tomasAccent: '#b5633a',
  windowGlow: '#ffbe5c',
  rug: '#5a4332',
  kettle: '#b59449',
  cat: '#2b2b2b',
};

const ACCENT_BY_HANDLE = {
  milo: PALETTE.miloAccent,
  wick: PALETTE.wickAccent,
  maren: PALETTE.marenAccent,
  tomas: PALETTE.tomasAccent,
};

const DRESSING_HANDLES = ['milo', 'wick', 'maren', 'tomas'];

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

  // Procedural furnishings (desk, rug) + per-cottage dressing groups.
  // Positioned to clear all inner walls (x in [-1.73, 1.73], z in [-1.38, 1.38]) by >= 0.1 m.
  const deskHeight = 0.72;
  const deskTopY = FLOOR_THICKNESS + deskHeight;
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

  // Per-cottage dressing groups (all hidden at build; toggled by setInteriorDressing).
  const miloGroup = new THREE.Group();
  miloGroup.name = 'interior_dressing_milo';
  miloGroup.visible = false;

  const kettleHeight = 0.24;
  miloGroup.add(
    makeMesh(
      THREE,
      'interior_tea_kettle',
      new THREE.CylinderGeometry(0.14, 0.18, kettleHeight, 8),
      kettleMat,
      -0.8,
      deskTopY + kettleHeight / 2,
      -0.85
    )
  );

  const catMat = new THREE.MeshStandardMaterial({ color: PALETTE.cat, roughness: 0.85 });
  const catHeight = 0.36;
  miloGroup.add(
    makeMesh(
      THREE,
      'interior_cat',
      new THREE.ConeGeometry(0.16, catHeight, 6),
      catMat,
      1.35,
      FLOOR_THICKNESS + catHeight / 2,
      -0.9
    )
  );
  group.add(miloGroup);

  const wickGroup = buildProceduralOilLamp(THREE);
  wickGroup.name = 'interior_dressing_wick';
  wickGroup.visible = false;
  wickGroup.position.set(-0.8, deskTopY, -0.85);
  group.add(wickGroup);

  const marenGroup = buildProceduralTypewriter(THREE);
  marenGroup.name = 'interior_dressing_maren';
  marenGroup.visible = false;
  marenGroup.position.set(-0.8, deskTopY, -0.85);
  group.add(marenGroup);

  const tomasGroup = buildProceduralTeapot(THREE);
  tomasGroup.name = 'interior_dressing_tomas';
  tomasGroup.visible = false;
  tomasGroup.position.set(-0.8, deskTopY, -0.85);
  group.add(tomasGroup);

  return group;
}

// Vendored verbatim from town-3d/town.js:1417-1477.
export function buildProceduralOilLamp(THREE) {
  const group = new THREE.Group();
  const brassMat = new THREE.MeshStandardMaterial({ color: '#9a7b3e', roughness: 0.65 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#fff1c9',
    emissive: '#ffcf70',
    emissiveIntensity: 1.1,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.14, 8), brassMat);
  base.position.set(0, 0.07, 0);
  group.add(base);

  const globe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.24, 8), glassMat);
  globe.position.set(0, 0.26, 0);
  group.add(globe);

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), brassMat);
  handle.position.set(0.13, 0.22, 0);
  group.add(handle);
  return group;
}

export function buildProceduralTypewriter(THREE) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: '#6b492b', roughness: 0.88 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.75 });
  const rollerMat = new THREE.MeshStandardMaterial({ color: '#d8d2c5', roughness: 0.8 });

  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.55), woodMat);
  stand.position.set(0, 0.04, 0);
  group.add(stand);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.36), bodyMat);
  body.position.set(0, 0.17, 0);
  group.add(body);

  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), rollerMat);
  roller.rotation.z = Math.PI / 2;
  roller.position.set(0, 0.28, -0.1);
  group.add(roller);
  return group;
}

export function buildProceduralTeapot(THREE) {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: '#8f6b47', roughness: 0.65 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.28, 8), metalMat);
  body.position.set(0, 0.14, 0);
  group.add(body);

  const spout = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.05), metalMat);
  spout.position.set(0.2, 0.18, 0);
  group.add(spout);

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.08, 8), metalMat);
  lid.position.set(0, 0.32, 0);
  group.add(lid);
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
 * Recolor the back accent wall by resident handle ('milo' | 'wick' | 'maren' | 'tomas'),
 * falling back to cream plaster ('#f5efe0') for any other handle or undefined.
 * Null-safe: returns false if room or interior_wall_back is missing.
 * @param {THREE.Group|null|undefined} room
 * @param {string|null|undefined} [palette]
 * @returns {boolean}
 */
export function setInteriorPalette(room, palette) {
  if (!room || !Array.isArray(room.children)) return false;
  const backWall = room.children.find((m) => m && m.name === 'interior_wall_back');
  if (!backWall || !backWall.material) return false;
  const hex = Object.hasOwn(ACCENT_BY_HANDLE, palette) ? ACCENT_BY_HANDLE[palette] : PALETTE.plaster;
  if (backWall.material.color && typeof backWall.material.color.set === 'function') {
    backWall.material.color.set(hex);
  } else {
    backWall.material.color = hex;
  }
  return true;
}

/**
 * Show the dressing group matching handle ('milo' | 'wick' | 'maren' | 'tomas')
 * and hide the other three. Unknown / null / undefined / empty handle falls
 * back to 'milo' (kettle + cat). Null-safe and idempotent.
 * @param {THREE.Group|null|undefined} room
 * @param {string|null|undefined} handle
 * @returns {boolean}
 */
export function setInteriorDressing(room, handle) {
  if (!room || !Array.isArray(room.children)) return false;
  const groups = DRESSING_HANDLES.map((h) =>
    room.children.find((c) => c && c.name === `interior_dressing_${h}`)
  );
  if (groups.some((g) => !g)) return false;

  const target = DRESSING_HANDLES.includes(handle) ? handle : 'milo';
  for (let i = 0; i < DRESSING_HANDLES.length; i++) {
    const nextVisible = DRESSING_HANDLES[i] === target;
    if (groups[i].visible !== nextVisible) {
      groups[i].visible = nextVisible;
    }
  }
  return true;
}
