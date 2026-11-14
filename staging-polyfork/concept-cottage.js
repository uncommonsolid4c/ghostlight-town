// Vendored from town-3d/concept-cottage.js — keep byte-identical after this header line.
/**
 * Proof-of-concept: Milo's Cottage matched to concept/milos-cottage.webp
 * Pure Three.js (0.160.0) procedural geometry, zero external dependencies.
 *
 * Key upgrades over the current box-and-prism createCottage() in town.js:
 *  1. Cream (#f5efe0) gable-end walls + ridge pedestal instead of a solid brown
 *     triangular prism roof (fixing the brown-gable mismatch vs. concept).
 *  2. Real two-slope pitched gable roof (#5a4332) with overhanging bargeboards,
 *     stepped low-poly shingle courses, and under-eave corbel/rafter tails.
 *  3. Chunky faceted low-poly masonry block relief on both the ice-blue (#a8d8ea)
 *     ground floor (corner quoins + 3 courses) and cream (#f5efe0) upper story,
 *     laid out cleanly around every window and door opening (zero Z-fighting).
 *  4. Widow's walk rooftop terrace sitting on a cream ridge curb with a full
 *     8-post, double-rail timber balustrade.
 *  5. Recessed paneled wood door with cross-rails, brass handle, and stone step.
 *  6. Eight 4-pane casement windows (emissive #ffbe5c glass + dark wood frames,
 *     projecting sills, and cross-muntins).
 *
 * Draw-call discipline: static detail boxes are merged per material into shared
 * BufferGeometries (with automatic fallback for minimal test stubs), keeping
 * total mesh count at 13 meshes (down from 20 in current town.js).
 */

export const CONCEPT_PALETTE = {
  iceBlue: '#a8d8ea',
  cream: '#f5efe0',
  roofBrown: '#5a4332',
  darkTimber: '#422f22',
  doorWood: '#6b492b',
  warmWindow: '#ffbe5c',
  windowGlassBase: '#ffd489',
  stoneStep: '#6e7278',
  brass: '#b59449',
};

/**
 * Push an axis-aligned or rotated/tilted hexahedron (box) into a triangle
 * position + normal array for merged low-poly BufferGeometry construction.
 */
function pushBox(positions, normals, {
  cx = 0, cy = 0, cz = 0,
  w = 1, h = 1, d = 1,
  rx = 0, ry = 0, rz = 0,
  taperTopX = 1, taperTopZ = 1,
}) {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  const raw = [
    [-hw, -hh, -hd],
    [ hw, -hh, -hd],
    [ hw, -hh,  hd],
    [-hw, -hh,  hd],
    [-hw * taperTopX,  hh, -hd * taperTopZ],
    [ hw * taperTopX,  hh, -hd * taperTopZ],
    [ hw * taperTopX,  hh,  hd * taperTopZ],
    [-hw * taperTopX,  hh,  hd * taperTopZ],
  ];

  const cxr = Math.cos(rx), sxr = Math.sin(rx);
  const cyr = Math.cos(ry), syr = Math.sin(ry);
  const czr = Math.cos(rz), szr = Math.sin(rz);

  const verts = raw.map(([x, y, z]) => {
    const x1 = x * czr - y * szr;
    const y1 = x * szr + y * czr;
    const z1 = z;

    const x2 = x1;
    const y2 = y1 * cxr - z1 * sxr;
    const z2 = y1 * sxr + z1 * cxr;

    const x3 =  x2 * cyr + z2 * syr;
    const y3 =  y2;
    const z3 = -x2 * syr + z2 * cyr;

    return [x3 + cx, y3 + cy, z3 + cz];
  });

  const faces = [
    [3, 2, 6, 7], // +Z front
    [1, 0, 4, 5], // -Z back
    [2, 1, 5, 6], // +X right
    [0, 3, 7, 4], // -X left
    [7, 6, 5, 4], // +Y top
    [0, 1, 2, 3], // -Y bottom
  ];

  for (const [a, b, c, dIdx] of faces) {
    const va = verts[a], vb = verts[b], vc = verts[c], vd = verts[dIdx];
    const ux = vb[0] - va[0], uy = vb[1] - va[1], uz = vb[2] - va[2];
    const vx = vc[0] - va[0], vy = vc[1] - va[1], vz = vc[2] - va[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    for (const v of [va, vb, vc, va, vc, vd]) {
      positions.push(v[0], v[1], v[2]);
      normals.push(nx, ny, nz);
    }
  }
}

/**
 * Push a triangular prism (for the cream gable-end walls) with ridge along X.
 */
function pushGablePrism(positions, normals, {
  cx = 0, baseY = 0, cz = 0,
  widthX = 4.0, halfSpanZ = 1.7, apexHeight = 1.65,
}) {
  const hx = widthX / 2;
  const v = [
    [-hx, baseY,  halfSpanZ],
    [-hx, baseY, -halfSpanZ],
    [-hx, baseY + apexHeight, 0],
    [ hx, baseY,  halfSpanZ],
    [ hx, baseY, -halfSpanZ],
    [ hx, baseY + apexHeight, 0],
  ].map(([x, y, z]) => [x + cx, y, z + cz]);

  const tris = [
    [v[1], v[0], v[2]], // -X left gable triangle (outward normal -X)
    [v[3], v[4], v[5]], // +X right gable triangle (outward normal +X)
    [v[0], v[3], v[5]], [v[0], v[5], v[2]], // +Z front slope
    [v[4], v[1], v[2]], [v[4], v[2], v[5]], // -Z back slope
  ];

  for (const [va, vb, vc] of tris) {
    const ux = vb[0] - va[0], uy = vb[1] - va[1], uz = vb[2] - va[2];
    const vx = vc[0] - va[0], vy = vc[1] - va[1], vz = vc[2] - va[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const pt of [va, vb, vc]) {
      positions.push(pt[0], pt[1], pt[2]);
      normals.push(nx, ny, nz);
    }
  }
}

function buildMergedGeometry(THREE, positions, normals, fallbackDims = [1, 1, 1]) {
  if (typeof THREE.BufferGeometry === 'function' && typeof THREE.Float32BufferAttribute === 'function') {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
  }
  return new THREE.BoxGeometry(fallbackDims[0], fallbackDims[1], fallbackDims[2]);
}

/**
 * Build the complete geometry recipe for Milo's Cottage.
 */
export function buildCottageGeometryData() {
  const groundPos = [], groundNorm = [];
  const upperPos = [], upperNorm = [];
  const roofPos = [], roofNorm = [];
  const terracePos = [], terraceNorm = [];
  const doorPos = [], doorNorm = [];

  // ---------------------------------------------------------------------------
  // 1. GROUND FLOOR (#a8d8ea ice-blue core + faceted low-poly stone block courses)
  // Core wall box: x in [-1.96, 1.96] (w=3.92), y in [0, 2.04], z in [-1.66, 1.66] (d=3.32)
  // ---------------------------------------------------------------------------
  pushBox(groundPos, groundNorm, { cx: 0, cy: 1.02, cz: 0, w: 3.92, h: 2.04, d: 3.32 });

  // Corner quoins (chunky alternating corner blocks on all 4 vertical edges)
  const quoinCourses = [
    { y: 0.33, h: 0.62, w: 0.50, d: 0.44, tilt:  0.025 },
    { y: 1.00, h: 0.64, w: 0.44, d: 0.50, tilt: -0.022 },
    { y: 1.68, h: 0.64, w: 0.52, d: 0.46, tilt:  0.020 },
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const q of quoinCourses) {
        pushBox(groundPos, groundNorm, {
          cx: sx * 1.82, cy: q.y, cz: sz * 1.52,
          w: q.w, h: q.h, d: q.d,
          rx: sz * q.tilt, rz: -sx * q.tilt,
          taperTopX: 0.96, taperTopZ: 0.96,
        });
      }
    }
  }

  // Front & back masonry courses (framed around door x=[-0.48,0.48] and windows x=[±0.86..±1.62], y=[0.61..1.49])
  const frontBackBlocks = [
    // Bottom plinth stones under windows
    { x: -1.42, y: 0.28, w: 0.56, h: 0.52, tilt:  0.022 },
    { x: -0.88, y: 0.27, w: 0.48, h: 0.50, tilt: -0.018 },
    { x:  0.88, y: 0.27, w: 0.48, h: 0.50, tilt:  0.018 },
    { x:  1.42, y: 0.28, w: 0.56, h: 0.52, tilt: -0.022 },
    // Stones between door and lower windows (x = ±0.66)
    { x: -0.66, y: 0.78, w: 0.34, h: 0.52, tilt: -0.024 },
    { x: -0.66, y: 1.32, w: 0.36, h: 0.50, tilt:  0.020 },
    { x:  0.66, y: 0.78, w: 0.34, h: 0.52, tilt:  0.024 },
    { x:  0.66, y: 1.32, w: 0.36, h: 0.50, tilt: -0.020 },
    // Top lintel course above door and lower windows (y = 1.78)
    { x: -1.25, y: 1.80, w: 0.88, h: 0.42, tilt:  0.018 },
    { x: -0.32, y: 1.78, w: 0.62, h: 0.44, tilt: -0.022 },
    { x:  0.32, y: 1.78, w: 0.62, h: 0.44, tilt:  0.022 },
    { x:  1.25, y: 1.80, w: 0.88, h: 0.42, tilt: -0.018 },
  ];
  for (const sz of [-1, 1]) {
    for (const b of frontBackBlocks) {
      pushBox(groundPos, groundNorm, {
        cx: b.x, cy: b.y, cz: sz * 1.68,
        w: b.w, h: b.h, d: 0.14,
        rx: sz * b.tilt, rz: b.tilt * 0.6,
        taperTopX: 0.96,
      });
    }
  }

  // Side wall masonry blocks (around side window z=[-0.38,0.38], y=[0.61..1.49])
  const sideBlocks = [
    { z: -0.95, y: 0.28, d: 0.82, h: 0.52, tilt:  0.020 },
    { z:  0.00, y: 0.26, d: 0.84, h: 0.48, tilt: -0.018 },
    { z:  0.95, y: 0.28, d: 0.82, h: 0.52, tilt:  0.020 },
    { z: -0.92, y: 0.96, d: 0.78, h: 0.68, tilt: -0.024 },
    { z:  0.92, y: 0.96, d: 0.78, h: 0.68, tilt:  0.024 },
    { z: -0.82, y: 1.78, d: 0.96, h: 0.44, tilt:  0.018 },
    { z:  0.82, y: 1.78, d: 0.96, h: 0.44, tilt: -0.018 },
  ];
  for (const sx of [-1, 1]) {
    for (const b of sideBlocks) {
      pushBox(groundPos, groundNorm, {
        cx: sx * 1.98, cy: b.y, cz: b.z,
        w: 0.14, h: b.h, d: b.d,
        rz: -sx * b.tilt,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. UPPER FLOOR + GABLE WALLS + RIDGE PEDESTAL (#f5efe0 warm cream)
  // Core upper box: x in [-2.02, 2.02] (w=4.04), y in [2.04, 3.74], z in [-1.70, 1.70] (d=3.40)
  // ---------------------------------------------------------------------------
  pushBox(upperPos, upperNorm, { cx: 0, cy: 2.89, cz: 0, w: 4.04, h: 1.70, d: 3.40 });

  // Gable triangular walls (y = 3.74 to apex 5.54) so gable ends are cream, not brown
  pushGablePrism(upperPos, upperNorm, {
    cx: 0, baseY: 3.72, cz: 0,
    widthX: 4.02, halfSpanZ: 1.70, apexHeight: 1.80,
  });

  // Widow's walk cream chimney-pedestal straddling the ridge (as seen in milos-cottage.webp)
  pushBox(upperPos, upperNorm, {
    cx: 0, cy: 5.55, cz: 0,
    w: 1.88, h: 0.64, d: 1.00,
    taperTopX: 0.97, taperTopZ: 0.97,
  });

  // Chunky overhanging cream blocks along the mid-floor belt course & between upper windows
  // Note: upper front windows sit at x = -1.08 and x = +0.86 (w=0.80, y=2.52..3.40)
  const upperFrontBlocks = [
    { x: -1.70, y: 2.24, w: 0.68, h: 0.46, d: 0.16, rx:  0.026 },
    { x: -1.06, y: 2.22, w: 0.56, h: 0.40, d: 0.14, rx: -0.020 },
    { x: -0.44, y: 2.26, w: 0.62, h: 0.48, d: 0.17, rx:  0.022 },
    { x:  0.22, y: 2.24, w: 0.64, h: 0.44, d: 0.16, rx: -0.024 },
    { x:  0.88, y: 2.22, w: 0.62, h: 0.40, d: 0.14, rx:  0.018 },
    { x:  1.62, y: 2.25, w: 0.76, h: 0.48, d: 0.16, rx: -0.022 },
    // Prominent cream stone plaques between & beside upper windows (matching concept image)
    { x: -0.14, y: 2.88, w: 0.78, h: 0.68, d: 0.15, rx:  0.020, rz: -0.015 },
    { x: -1.76, y: 2.86, w: 0.52, h: 0.64, d: 0.15, rx:  0.018 },
    { x:  1.66, y: 2.86, w: 0.68, h: 0.64, d: 0.15, rx: -0.018 },
  ];
  for (const sz of [-1, 1]) {
    for (const b of upperFrontBlocks) {
      pushBox(upperPos, upperNorm, {
        cx: b.x, cy: b.y, cz: sz * 1.72,
        w: b.w, h: b.h, d: b.d,
        rx: sz * (b.rx || 0), rz: b.rz || 0,
      });
    }
  }

  // Side upper cream blocks (framing side upper window z=[-0.38..0.38], y=[2.52..3.40])
  const upperSideBlocks = [
    { z: -1.24, y: 2.24, d: 0.88, h: 0.46, tilt:  0.022 },
    { z:  0.00, y: 2.22, d: 0.84, h: 0.40, tilt: -0.018 },
    { z:  1.24, y: 2.24, d: 0.88, h: 0.46, tilt:  0.022 },
    { z: -1.06, y: 2.88, d: 0.92, h: 0.66, tilt: -0.020 },
    { z:  1.06, y: 2.88, d: 0.92, h: 0.66, tilt:  0.020 },
  ];
  for (const sx of [-1, 1]) {
    for (const b of upperSideBlocks) {
      pushBox(upperPos, upperNorm, {
        cx: sx * 2.04, cy: b.y, cz: b.z,
        w: 0.15, h: b.h, d: b.d,
        rz: sx * b.tilt,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. PITCHED GABLE ROOF + STEPPED SHINGLE COURSES (#5a4332 roof brown)
  // Slope geometry: ridge at (y = 5.62, z = 0), eaves at (y = 3.66, z = ±2.08)
  // ---------------------------------------------------------------------------
  const dySlope = 5.62 - 3.66; // 1.96
  const dzSlope = 2.08;
  const slopeAngle = Math.atan2(dySlope, dzSlope); // ~0.756 rad (43.3 deg)
  const slopeLen = Math.hypot(dySlope, dzSlope) + 0.18; // ~3.04m
  // Outward normal of the roof slope: (0, cos(slopeAngle), sz * sin(slopeAngle))
  const nyRoof = Math.cos(slopeAngle);
  const nzRoof = Math.sin(slopeAngle);

  for (const sz of [-1, 1]) {
    const midY = (5.62 + 3.66) / 2; // 4.64
    const midZ = sz * (dzSlope / 2); // ±1.04

    // Base roof deck slab + gable-end overhanging bargeboards
    pushBox(roofPos, roofNorm, {
      cx: 0, cy: midY, cz: midZ,
      w: 4.56, h: 0.18, d: slopeLen,
      rx: sz * slopeAngle,
    });

    // Thick gable bargeboard trim rafters on left (-X) and right (+X) ends
    for (const sx of [-1, 1]) {
      pushBox(roofPos, roofNorm, {
        cx: sx * 2.24, cy: midY + 0.02, cz: midZ,
        w: 0.18, h: 0.26, d: slopeLen + 0.06,
        rx: sz * slopeAngle,
      });
    }

    // 4 overlapping courses of chunky low-poly roof shingles sitting cleanly ON TOP of the deck slab
    const shingleCourses = [
      { t: 0.12, count: 6, h: 0.12, d: 0.76 },
      { t: 0.37, count: 7, h: 0.12, d: 0.74 },
      { t: 0.62, count: 6, h: 0.12, d: 0.72 },
      { t: 0.85, count: 7, h: 0.11, d: 0.64 },
    ];
    for (let cIdx = 0; cIdx < shingleCourses.length; cIdx++) {
      const course = shingleCourses[cIdx];
      // Point along slope from eaves (t=0) to ridge (t=1), offset outward along roof normal by 0.13m
      // plus slight step-up per course so upper courses overlap lower courses cleanly without self-intersection
      const normalOffset = 0.12 + cIdx * 0.015;
      const baseY = 3.66 + course.t * dySlope + nyRoof * normalOffset;
      const baseZ = sz * (dzSlope * (1 - course.t)) + sz * nzRoof * normalOffset;

      const spanX = 4.30;
      const tileW = spanX / course.count;

      for (let k = 0; k < course.count; k++) {
        const tx = -spanX / 2 + (k + 0.5) * tileW;
        // Leave central opening on top course for the cream widow's-walk pedestal
        if (course.t > 0.72 && Math.abs(tx) < 0.94) continue;

        const jitterPitch = (((k * 3 + cIdx) % 3) - 1) * 0.025;
        const jitterRoll = (((k + cIdx * 2) % 3) - 1) * 0.016;
        const jitterNormal = ((k + cIdx) % 2) * 0.018;
        pushBox(roofPos, roofNorm, {
          cx: tx,
          cy: baseY + nyRoof * jitterNormal,
          cz: baseZ + sz * nzRoof * jitterNormal,
          w: tileW - 0.03,
          h: course.h,
          d: course.d,
          rx: sz * (slopeAngle + jitterPitch),
          rz: jitterRoll,
          taperTopX: 0.96,
        });
      }
    }

    // Under-eave rafter tails / corbels beneath front & back eaves
    for (const rx of [-1.70, -0.82, 0.0, 0.82, 1.70]) {
      pushBox(roofPos, roofNorm, {
        cx: rx, cy: 3.62, cz: sz * 1.88,
        w: 0.16, h: 0.18, d: 0.32,
      });
    }
  }

  // Heavy ridge beam caps flanking the central widow's walk pedestal
  pushBox(roofPos, roofNorm, { cx: -1.62, cy: 5.72, cz: 0, w: 1.40, h: 0.22, d: 0.30 });
  pushBox(roofPos, roofNorm, { cx:  1.62, cy: 5.72, cz: 0, w: 1.40, h: 0.22, d: 0.30 });

  // ---------------------------------------------------------------------------
  // 4. ROOFTOP TERRACE / WIDOW'S WALK BALUSTRADE (#422f22 dark timber)
  // ---------------------------------------------------------------------------
  // Timber deck capping the cream ridge pedestal
  pushBox(terracePos, terraceNorm, { cx: 0, cy: 5.90, cz: 0, w: 2.12, h: 0.14, d: 1.20 });

  // 8 vertical balustrade posts around the terrace deck
  const postCoords = [
    [-0.96, -0.50], [-0.32, -0.50], [0.32, -0.50], [0.96, -0.50],
    [-0.96,  0.50], [-0.32,  0.50], [0.32,  0.50], [0.96,  0.50],
  ];
  for (const [px, pz] of postCoords) {
    pushBox(terracePos, terraceNorm, { cx: px, cy: 6.22, cz: pz, w: 0.10, h: 0.56, d: 0.10 });
  }
  // Top and mid rails (front, back, left, right)
  for (const ry of [6.16, 6.40]) {
    for (const rz of [-0.50, 0.50]) {
      pushBox(terracePos, terraceNorm, { cx: 0, cy: ry, cz: rz, w: 2.06, h: 0.07, d: 0.07 });
    }
    for (const rx of [-0.96, 0.96]) {
      pushBox(terracePos, terraceNorm, { cx: rx, cy: ry, cz: 0, w: 0.07, h: 0.07, d: 1.10 });
    }
  }

  // ---------------------------------------------------------------------------
  // 5. FRONT PANELED WOODEN DOOR + WINDOW FRAMES/MUNTINS/SILLS (#6b492b)
  // Proud of the core wall (z = 1.66) so every rail, stile, and muntin reads cleanly
  // ---------------------------------------------------------------------------
  pushBox(doorPos, doorNorm, { cx: 0, cy: 0.82, cz: 1.70, w: 0.96, h: 1.64, d: 0.14 });
  pushBox(doorPos, doorNorm, { cx: 0, cy: 0.80, cz: 1.74, w: 0.78, h: 1.50, d: 0.10 });
  for (const railY of [0.18, 0.78, 1.44]) {
    pushBox(doorPos, doorNorm, { cx: 0, cy: railY, cz: 1.79, w: 0.80, h: 0.10, d: 0.06 });
  }
  pushBox(doorPos, doorNorm, { cx: 0, cy: 0.80, cz: 1.78, w: 0.07, h: 1.48, d: 0.05 });
  pushBox(doorPos, doorNorm, { cx: -0.29, cy: 0.78, cz: 1.82, w: 0.07, h: 0.12, d: 0.08 });
  // Low threshold step
  pushBox(doorPos, doorNorm, { cx: 0, cy: 0.05, cz: 1.86, w: 1.08, h: 0.10, d: 0.30 });

  // 8 warm lit 4-pane casement windows (proud of the wall surface so glass never Z-fights)
  const windows = [
    // Ground floor front (flanking door, wall face at z = 1.66)
    { x: -1.24, y: 1.05, z: 1.73, rotY: 0, w: 0.76, h: 0.88 },
    { x:  1.24, y: 1.05, z: 1.73, rotY: 0, w: 0.76, h: 0.88 },
    // Ground floor sides (wall face at x = ±1.96)
    { x: -2.03, y: 1.05, z: 0.00, rotY: -Math.PI / 2, w: 0.76, h: 0.88 },
    { x:  2.03, y: 1.05, z: 0.00, rotY:  Math.PI / 2, w: 0.76, h: 0.88 },
    // Upper floor front (wall face at z = 1.70)
    { x: -1.08, y: 2.96, z: 1.77, rotY: 0, w: 0.78, h: 0.88 },
    { x:  0.86, y: 2.96, z: 1.77, rotY: 0, w: 0.82, h: 0.88 },
    // Upper floor sides (wall face at x = ±2.02)
    { x: -2.09, y: 2.96, z: 0.00, rotY: -Math.PI / 2, w: 0.76, h: 0.88 },
    { x:  2.09, y: 2.96, z: 0.00, rotY:  Math.PI / 2, w: 0.76, h: 0.88 },
  ];

  // Add casement frame + projecting sill + 4-pane cross-muntins into doorPos/doorNorm
  for (const win of windows) {
    const isSide = Math.abs(win.rotY) > 0.1;
    const sign = isSide ? Math.sign(win.x) : 1;
    const hw = win.w / 2;
    const hh = win.h / 2;
    const frameThick = 0.08;

    if (!isSide) {
      pushBox(doorPos, doorNorm, { cx: win.x, cy: win.y + hh, cz: win.z + 0.03, w: win.w + 0.12, h: frameThick, d: 0.14 });
      pushBox(doorPos, doorNorm, { cx: win.x, cy: win.y - hh, cz: win.z + 0.06, w: win.w + 0.22, h: 0.09, d: 0.20 });
      pushBox(doorPos, doorNorm, { cx: win.x - hw, cy: win.y, cz: win.z + 0.03, w: frameThick, h: win.h, d: 0.14 });
      pushBox(doorPos, doorNorm, { cx: win.x + hw, cy: win.y, cz: win.z + 0.03, w: frameThick, h: win.h, d: 0.14 });
      // 4-pane crossbars (muntins) proud of the glass
      pushBox(doorPos, doorNorm, { cx: win.x, cy: win.y, cz: win.z + 0.04, w: win.w, h: 0.05, d: 0.08 });
      pushBox(doorPos, doorNorm, { cx: win.x, cy: win.y, cz: win.z + 0.04, w: 0.05, h: win.h, d: 0.08 });
    } else {
      pushBox(doorPos, doorNorm, { cx: win.x + sign * 0.03, cy: win.y + hh, cz: win.z, w: 0.14, h: frameThick, d: win.w + 0.12 });
      pushBox(doorPos, doorNorm, { cx: win.x + sign * 0.06, cy: win.y - hh, cz: win.z, w: 0.20, h: 0.09, d: win.w + 0.22 });
      pushBox(doorPos, doorNorm, { cx: win.x + sign * 0.03, cy: win.y, cz: win.z - hw, w: 0.14, h: win.h, d: frameThick });
      pushBox(doorPos, doorNorm, { cx: win.x + sign * 0.03, cy: win.y, cz: win.z + hw, w: 0.14, h: win.h, d: frameThick });
      pushBox(doorPos, doorNorm, { cx: win.x + sign * 0.04, cy: win.y, cz: win.z, w: 0.08, h: 0.05, d: win.w });
      pushBox(doorPos, doorNorm, { cx: win.x + sign * 0.04, cy: win.y, cz: win.z, w: 0.08, h: win.h, d: 0.05 });
    }
  }

  return {
    ground: { positions: groundPos, normals: groundNorm },
    upper: { positions: upperPos, normals: upperNorm },
    roof: { positions: roofPos, normals: roofNorm },
    terrace: { positions: terracePos, normals: terraceNorm },
    doorAndTrim: { positions: doorPos, normals: doorNorm },
    windows,
  };
}

/**
 * Create the concept-matched Milo's Cottage Three.js Group.
 * Drop-in compatible with town.js expectations and test-3d.mjs assertions.
 */
export function createConceptMilosCottage(THREE, options = {}) {
  const data = buildCottageGeometryData();

  const group = new THREE.Group();
  group.name = options.name || 'milos_cottage';
  group.userData = {
    clickable: true,
    kind: 'cottage',
    cottageStyle: 'gable',
    handle: 'milo',
    plotNumber: 1,
    label: options.label || 'Milo — Ghostlight Cottage (concept match)',
    wallColor: CONCEPT_PALETTE.iceBlue,
    upperWallColor: CONCEPT_PALETTE.cream,
    roofColor: CONCEPT_PALETTE.roofBrown,
    trimColor: CONCEPT_PALETTE.cream,
  };

  const groundMat = new THREE.MeshStandardMaterial({
    color: CONCEPT_PALETTE.iceBlue,
    roughness: 0.88,
    flatShading: true,
  });
  const upperMat = new THREE.MeshStandardMaterial({
    color: CONCEPT_PALETTE.cream,
    roughness: 0.86,
    flatShading: true,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: CONCEPT_PALETTE.roofBrown,
    roughness: 0.84,
    flatShading: true,
  });
  const terraceMat = new THREE.MeshStandardMaterial({
    color: CONCEPT_PALETTE.darkTimber,
    roughness: 0.88,
    flatShading: true,
  });
  const doorTrimMat = new THREE.MeshStandardMaterial({
    color: CONCEPT_PALETTE.doorWood,
    roughness: 0.85,
    flatShading: true,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: CONCEPT_PALETTE.windowGlassBase,
    emissive: CONCEPT_PALETTE.warmWindow,
    emissiveIntensity: 1.4,
    roughness: 0.35,
  });

  const groundMesh = new THREE.Mesh(
    buildMergedGeometry(THREE, data.ground.positions, data.ground.normals, [4.0, 2.0, 3.4]),
    groundMat
  );
  groundMesh.name = 'cottage_ground_floor';
  group.add(groundMesh);

  const upperMesh = new THREE.Mesh(
    buildMergedGeometry(THREE, data.upper.positions, data.upper.normals, [4.1, 3.5, 3.5]),
    upperMat
  );
  upperMesh.name = 'cottage_upper_floor';
  group.add(upperMesh);

  const roofMesh = new THREE.Mesh(
    buildMergedGeometry(THREE, data.roof.positions, data.roof.normals, [4.6, 2.2, 4.2]),
    roofMat
  );
  roofMesh.name = 'cottage_gable_roof';
  group.add(roofMesh);

  const terraceMesh = new THREE.Mesh(
    buildMergedGeometry(THREE, data.terrace.positions, data.terrace.normals, [2.1, 0.7, 1.2]),
    terraceMat
  );
  terraceMesh.name = 'rooftop_terrace';
  group.add(terraceMesh);

  const doorAndTrimMesh = new THREE.Mesh(
    buildMergedGeometry(THREE, data.doorAndTrim.positions, data.doorAndTrim.normals, [0.96, 1.64, 0.16]),
    doorTrimMat
  );
  doorAndTrimMesh.name = 'cottage_door';
  group.add(doorAndTrimMesh);

  for (const win of data.windows) {
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(win.w - 0.08, win.h - 0.08, 0.06),
      windowMat
    );
    glass.name = 'cottage_window';
    glass.position.set(win.x, win.y, win.z);
    glass.rotation.y = win.rotY;
    group.add(glass);
  }

  return group;
}
