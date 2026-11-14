// Vendored from town-3d/concept-bandstand.js — keep byte-identical after this header line.
/**
 * Proof-of-concept: The Ghostlight Bandstand matched to concept/milos-ghost-bandstand.webp
 * Pure Three.js (0.160.0) procedural geometry + headless-safe 2D CanvasTexture support,
 * zero external dependencies.
 *
 * Key upgrades over the current buildBandstand() in town-3d/town.js:
 *  1. Timber A-frame roof structure (`bandstand_aframe`): two sturdy vertical posts
 *     (x = ±1.35 m) with base plinths and notched finial tops, a horizontal tie-beam /
 *     crossbeam (y = 4.30 m) with projecting pegged ends, a pitched A-frame gable roof
 *     truss rising to a central ridge peak (y = 4.98 m) with a central king-post block,
 *     and two 45° angled knee braces supporting the crossbeam.
 *  2. Hanging Ghostlight pendant & bulb: instead of a floor pole rising from the deck
 *     center (`ghostlight_pole` at y = 2.0 m), the Ghostlight bulb (`ghostlight_bulb`
 *     at y = 3.55 m) hangs from the center of the A-frame crossbeam via a stepped brass
 *     bell shade and suspension rod (`bandstand_brass_fixtures`), with 1.49 m of vertical
 *     clearance above Milo's 1.43 m ghost (top at y = 2.06 m) and 0.90 m above the
 *     floating `[MUSE] milo` nametag sprite (y = 2.40 m, top at 2.65 m).
 *  3. Octagonal perimeter railings (posts + two horizontal rails) around all 7 closed
 *     sides of the deck plus front entrance newel posts framing the wide front steps (+Z).
 *  4. Two-tier wide front wooden steps (`bandstand_steps`) with side stringers, octagonal
 *     rim fascia boards, and under-deck diagonal timber braces matching the concept image.
 *  5. Six brass post-mounted lanterns around the front/side railing posts with warm
 *     emissive amber glass globes (`bandstand_lantern_glass`) that glow without adding
 *     any extra PointLights (preserving the strict 1-PointLight scene-wide constraint).
 *  6. Exactly 10 brass footlights (`footlight_0`..`footlight_9`) and 10 `avatarSpots`
 *     in the exact same slots/positions and `userData` shape (`{ slot, shell, placard,
 *     lit, handle, role }`) expected by `town.js`, `buildMilosGhost`, and `TownLive`.
 *  7. Draw-call discipline: static timber, dark-wood step/trim, brass hardware, and
 *     lantern glass parts are merged per material into shared BufferGeometries (with
 *     automatic primitive fallback for minimal test stubs), keeping total bandstand mesh
 *     count at 26 meshes — 5 FEWER meshes than the current 31-mesh `buildBandstand()` in
 *     `town.js` (reducing worst-case town mesh count from 113 to 108, well under < 125).
 */

export const BANDSTAND_PALETTE = {
  cedar: '#6b492b',
  warmTimber: '#7a4b2a',
  darkWood: '#4d301c',
  brass: '#b59449',
  footlightUnlit: '#7a6230',
  bulbColor: '#ffca66',
  bulbEmissive: '#ffaa33',
  pointLightColor: '#ffaa44',
  lanternGlass: '#ffd489',
  lanternEmissive: '#ffbe5c',
  placardBg: '#3b2b1d',
  placardBorder: '#b59449',
  placardFg: '#f4ead5',
};

export const BANDSTAND_LAYOUT = {
  x: 0,
  y: 0,
  z: 0,
  radius: 4.5,
  height: 0.6,
  rimRadius: 4.15,
  footlightCount: 10,
  avatarSpotCount: 10,
  bulbY: 3.55,
  crossbeamY: 4.30,
  ridgePeakY: 4.98,
  postSpanHalfX: 1.35,
};

export const BANDSTAND_FOOTLIGHT_COLORS = {
  // Owner sync 2026-11-12: Argon's proof carried the pre-fix 1.4/1.5 values;
  // the pale-blue muse emissive at 1.4 blew out white under the ghost's hem
  // live, so these match town.js FOOTLIGHT_COLORS (0.9/1.0). Keep in step.
  muse: { color: '#bfeaff', emissive: '#9be0ff', emissiveIntensity: 0.9 },
  npc: { color: '#ffbe55', emissive: '#ffaa33', emissiveIntensity: 1.0 },
  unlit: { color: '#7a6230', emissive: '#000000', emissiveIntensity: 0 },
};

/**
 * Create a 2D canvas in browser DOM or a headless-safe mock when `document` is absent
 * (matching `makeCanvas` in `town-3d/town.js`).
 */
export function makeBandstandCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  const noop = () => {};
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '16px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fillText: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
  };
  return {
    width,
    height,
    getContext: () => ctx,
  };
}

/**
 * Headless-safe CanvasTexture builder matching `makeTextTexture` in `town-3d/town.js`.
 */
export function makeBandstandTextTexture(THREE, lines, opts = {}) {
  const width = opts.width || 512;
  const height = opts.height || 256;
  const bg = opts.bg || '#2e2218';
  const border = opts.border || '#8b6a4b';
  const fg = opts.fg || '#f6ecd9';
  const canvas = makeBandstandCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = border;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, width - 16, height - 16);

  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lineList = Array.isArray(lines) ? lines : [String(lines || '')];
  const step = height / (lineList.length + 1);
  lineList.forEach((line, idx) => {
    const fontSize = idx === 0 ? (opts.titleSize || 34) : (opts.subSize || 22);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillText(String(line), width / 2, step * (idx + 1));
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Push an axis-aligned or rotated/tapered hexahedron (box) into a triangle
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
    // 1. Roll around Z
    const x1 = x * czr - y * szr;
    const y1 = x * szr + y * czr;
    const z1 = z;
    // 2. Pitch around X
    const x2 = x1;
    const y2 = y1 * cxr - z1 * sxr;
    const z2 = y1 * sxr + z1 * cxr;
    // 3. Yaw around Y
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
 * Push a low-poly cylinder / frustum (e.g. brass bell shade, lantern cap, footlight ring)
 * into position + normal arrays.
 */
function pushCylinder(positions, normals, {
  cx = 0, cy = 0, cz = 0,
  radiusTop = 0.1, radiusBottom = 0.1, height = 0.2,
  segments = 8,
}) {
  const yTop = cy + height / 2;
  const yBot = cy - height / 2;

  for (let i = 0; i < segments; i++) {
    const th0 = (i / segments) * Math.PI * 2;
    const th1 = ((i + 1) / segments) * Math.PI * 2;
    const s0 = Math.sin(th0), c0 = Math.cos(th0);
    const s1 = Math.sin(th1), c1 = Math.cos(th1);

    const b0 = [cx + s0 * radiusBottom, yBot, cz + c0 * radiusBottom];
    const b1 = [cx + s1 * radiusBottom, yBot, cz + c1 * radiusBottom];
    const t0 = [cx + s0 * radiusTop,    yTop, cz + c0 * radiusTop];
    const t1 = [cx + s1 * radiusTop,    yTop, cz + c1 * radiusTop];

    // Side quad
    const ux = b1[0] - b0[0], uy = b1[1] - b0[1], uz = b1[2] - b0[2];
    const vx = t0[0] - b0[0], vy = t0[1] - b0[1], vz = t0[2] - b0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    for (const pt of [b0, b1, t1, b0, t1, t0]) {
      positions.push(pt[0], pt[1], pt[2]);
      normals.push(nx, ny, nz);
    }

    // Top cap
    if (radiusTop > 0.001) {
      const topCenter = [cx, yTop, cz];
      for (const pt of [topCenter, t0, t1]) {
        positions.push(pt[0], pt[1], pt[2]);
        normals.push(0, 1, 0);
      }
    }
    // Bottom cap
    if (radiusBottom > 0.001) {
      const botCenter = [cx, yBot, cz];
      for (const pt of [botCenter, b1, b0]) {
        positions.push(pt[0], pt[1], pt[2]);
        normals.push(0, -1, 0);
      }
    }
  }
}

/**
 * Build the complete procedural geometry arrays for the concept-matched bandstand.
 * Separated from THREE so headless verification scripts and software renderers can
 * inspect vertex bounds and triangles directly.
 */
export function buildBandstandGeometryData() {
  const timberPos = [], timberNorm = [];
  const darkWoodPos = [], darkWoodNorm = [];
  const brassPos = [], brassNorm = [];
  const lanternGlassPos = [], lanternGlassNorm = [];

  const R = BANDSTAND_LAYOUT.radius; // 4.5 m
  const H = BANDSTAND_LAYOUT.height; // 0.6 m

  // ---------------------------------------------------------------------------
  // 1. TIMBER A-FRAME ROOF STRUCTURE (two posts + crossbeam + pitched gable + angled braces)
  // Sized so the Ghostlight bulb hangs at (0, 3.55, 0) and Milo's ghost (1.43 m tall,
  // nametag at 1.8 m local / 2.4 m world) fits comfortably underneath.
  // ---------------------------------------------------------------------------
  const postX = BANDSTAND_LAYOUT.postSpanHalfX; // 1.35 m (2.70 m center-to-center, 2.42 m inner clearance)
  const postBottomY = H; // 0.60 m (deck surface)
  const postTopY = 4.70;
  const postHeight = postTopY - postBottomY; // 4.10 m

  for (const sx of [-1, 1]) {
    const px = sx * postX;
    // Main vertical square timber post
    pushBox(timberPos, timberNorm, {
      cx: px,
      cy: postBottomY + postHeight / 2,
      cz: 0,
      w: 0.26,
      h: postHeight,
      d: 0.26,
    });

    // Chunky molded base plinth collar where each post meets the cedar deck
    pushBox(timberPos, timberNorm, {
      cx: px,
      cy: H + 0.20,
      cz: 0,
      w: 0.36,
      h: 0.40,
      d: 0.36,
      taperTopX: 0.88,
      taperTopZ: 0.88,
    });
    pushBox(darkWoodPos, darkWoodNorm, {
      cx: px,
      cy: H + 0.04,
      cz: 0,
      w: 0.42,
      h: 0.08,
      d: 0.42,
    });

    // Decorative post cap / finial at top of vertical post (above the rafter joint)
    pushBox(timberPos, timberNorm, {
      cx: px,
      cy: postTopY + 0.05,
      cz: 0,
      w: 0.30,
      h: 0.10,
      d: 0.30,
      taperTopX: 0.82,
      taperTopZ: 0.82,
    });
  }

  // Horizontal tie-beam / crossbeam spanning between the two posts and projecting outward
  const crossY = BANDSTAND_LAYOUT.crossbeamY; // 4.30 m (underside at 4.18 m, top at 4.42 m)
  pushBox(timberPos, timberNorm, {
    cx: 0,
    cy: crossY,
    cz: 0,
    w: 3.48,
    h: 0.24,
    d: 0.28,
  });

  // Wooden tenon / peg bosses on the projecting outer ends of the crossbeam (as in concept image)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pushBox(darkWoodPos, darkWoodNorm, {
        cx: sx * 1.54,
        cy: crossY,
        cz: sz * 0.15,
        w: 0.09,
        h: 0.09,
        d: 0.06,
      });
    }
  }

  // Angled 45° knee braces connecting the vertical posts (y = 3.50 m) to the crossbeam underside (y = 4.18 m)
  for (const sx of [-1, 1]) {
    pushBox(timberPos, timberNorm, {
      cx: sx * 0.98,
      cy: 3.84,
      cz: 0,
      w: 1.02,
      h: 0.17,
      d: 0.18,
      rz: -sx * 0.72,
    });
  }

  // Pitched A-frame gable rafters rising from the crossbeam ends (x = ±1.68, y = 4.34)
  // to the central ridge peak (x = 0, y = 4.98)
  const rafterDx = 1.68;
  const rafterDy = 4.94 - 4.34; // 0.60 m
  const rafterLen = Math.hypot(rafterDx, rafterDy) + 0.16; // ~1.94 m
  const rafterAngle = Math.atan2(rafterDy, rafterDx); // ~0.343 rad (19.6 deg)

  for (const sx of [-1, 1]) {
    pushBox(timberPos, timberNorm, {
      cx: sx * (rafterDx / 2),
      cy: 4.34 + rafterDy / 2 + 0.04,
      cz: 0,
      w: rafterLen,
      h: 0.22,
      d: 0.30,
      rz: -sx * rafterAngle,
    });
    // Darker upper weather-cap strip along each A-frame rafter slope
    pushBox(darkWoodPos, darkWoodNorm, {
      cx: sx * (rafterDx / 2),
      cy: 4.34 + rafterDy / 2 + 0.15,
      cz: 0,
      w: rafterLen + 0.04,
      h: 0.06,
      d: 0.34,
      rz: -sx * rafterAngle,
    });
  }

  // Central vertical king-post block & ridge capstone locking the apex to the crossbeam
  pushBox(timberPos, timberNorm, {
    cx: 0,
    cy: 4.64,
    cz: 0,
    w: 0.32,
    h: 0.68,
    d: 0.32,
  });
  pushBox(darkWoodPos, darkWoodNorm, {
    cx: 0,
    cy: 5.02,
    cz: 0,
    w: 0.40,
    h: 0.10,
    d: 0.38,
    taperTopX: 0.85,
    taperTopZ: 0.85,
  });

  // ---------------------------------------------------------------------------
  // 2. OVERHEAD BRASS PENDANT FIXTURE (suspending the Ghostlight bulb from the crossbeam)
  // Connects crossbeam underside (y = 4.18 m) to ghostlight_bulb at (0, 3.55, 0)
  // ---------------------------------------------------------------------------
  // Upper mounting flange under the king-post / crossbeam center
  pushCylinder(brassPos, brassNorm, {
    cx: 0, cy: 4.14, cz: 0,
    radiusTop: 0.14, radiusBottom: 0.11, height: 0.08, segments: 8,
  });
  // Vertical suspension stem/pipe
  pushCylinder(brassPos, brassNorm, {
    cx: 0, cy: 4.02, cz: 0,
    radiusTop: 0.035, radiusBottom: 0.035, height: 0.22, segments: 8,
  });
  // Upper bell dome of lamp holder
  pushCylinder(brassPos, brassNorm, {
    cx: 0, cy: 3.91, cz: 0,
    radiusTop: 0.09, radiusBottom: 0.20, height: 0.10, segments: 8,
  });
  // Wide flared brass reflector shade above the bulb (matching concept image)
  pushCylinder(brassPos, brassNorm, {
    cx: 0, cy: 3.84, cz: 0,
    radiusTop: 0.20, radiusBottom: 0.36, height: 0.07, segments: 8,
  });
  // Brass bulb socket collar meeting the top of the 0.32 m radius bulb sphere
  pushCylinder(brassPos, brassNorm, {
    cx: 0, cy: 3.77, cz: 0,
    radiusTop: 0.13, radiusBottom: 0.13, height: 0.08, segments: 8,
  });

  // ---------------------------------------------------------------------------
  // 3. OCTAGONAL DECK PLANK RELIEF, FASCIA RIM, AND UNDER-DECK BRACES
  // The main `bandstand_base` mesh is an 8-sided CylinderGeometry(4.5, 4.5, 0.6, 8)
  // rotated by Math.PI / 8 so its 8 flat sides face k * 45 deg (k = 0 is +Z front).
  // ---------------------------------------------------------------------------
  const apothem = R * Math.cos(Math.PI / 8); // 4.1575 m
  const sideLen = 2 * R * Math.sin(Math.PI / 8); // 3.444 m

  for (let k = 0; k < 8; k++) {
    const sideAngle = (k * Math.PI) / 4;
    const sinA = Math.sin(sideAngle);
    const cosA = Math.cos(sideAngle);

    // Top rim fascia molding around the 8 sides of the octagon
    pushBox(darkWoodPos, darkWoodNorm, {
      cx: sinA * (apothem - 0.02),
      cy: H - 0.07,
      cz: cosA * (apothem - 0.02),
      w: sideLen + 0.06,
      h: 0.16,
      d: 0.14,
      ry: sideAngle,
    });

    // Bottom skirt beam around the 8 sides
    pushBox(darkWoodPos, darkWoodNorm, {
      cx: sinA * (apothem - 0.08),
      cy: 0.08,
      cz: cosA * (apothem - 0.08),
      w: sideLen - 0.04,
      h: 0.14,
      d: 0.14,
      ry: sideAngle,
    });

    // Chunky vertical corner/mid support blocks & diagonal knee-braces under the deck rim
    for (const sOff of [-1, 1]) {
      const along = sOff * (sideLen * 0.28);
      const bx = sinA * (apothem - 0.10) + cosA * along;
      const bz = cosA * (apothem - 0.10) - sinA * along;
      pushBox(darkWoodPos, darkWoodNorm, {
        cx: bx,
        cy: H * 0.50,
        cz: bz,
        w: 0.42,
        h: 0.10,
        d: 0.12,
        ry: sideAngle,
        rz: sOff * 0.55,
      });
    }
  }

  // Radial + concentric dark-wood plank seam grooves sitting 4 mm above y = 0.60 m
  // so the octagonal cedar floor reads as fitted radial wedge floorboards (matching concept).
  for (let k = 0; k < 8; k++) {
    const cornerAngle = ((k + 0.5) * Math.PI) / 4;
    // Radial miter seam from center out to each of the 8 octagon corners
    pushBox(darkWoodPos, darkWoodNorm, {
      cx: Math.sin(cornerAngle) * (R * 0.50),
      cy: H + 0.003,
      cz: Math.cos(cornerAngle) * (R * 0.50),
      w: 0.025,
      h: 0.006,
      d: R * 0.96,
      ry: cornerAngle,
    });
  }
  for (const seamR of [0.85, 1.50, 2.15, 2.80, 3.45, 4.02]) {
    const seamSide = 2 * seamR * Math.sin(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const sideAngle = (k * Math.PI) / 4;
      pushBox(darkWoodPos, darkWoodNorm, {
        cx: Math.sin(sideAngle) * seamR,
        cy: H + 0.003,
        cz: Math.cos(sideAngle) * seamR,
        w: seamSide + 0.02,
        h: 0.006,
        d: 0.022,
        ry: sideAngle,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. WIDE TWO-TIER FRONT STEPS (+Z, angle = 0)
  // ---------------------------------------------------------------------------
  // Upper step tread (step 2: y = 0.40 m)
  pushBox(darkWoodPos, darkWoodNorm, {
    cx: 0, cy: 0.20, cz: apothem + 0.34,
    w: 3.16, h: 0.40, d: 0.56,
  });
  pushBox(timberPos, timberNorm, {
    cx: 0, cy: 0.41, cz: apothem + 0.35,
    w: 3.24, h: 0.05, d: 0.60,
  });
  // Lower step tread (step 1: y = 0.20 m)
  pushBox(darkWoodPos, darkWoodNorm, {
    cx: 0, cy: 0.10, cz: apothem + 0.84,
    w: 3.28, h: 0.20, d: 0.54,
  });
  pushBox(timberPos, timberNorm, {
    cx: 0, cy: 0.21, cz: apothem + 0.85,
    w: 3.36, h: 0.05, d: 0.58,
  });
  // Heavy side stringer cheeks flanking the front steps
  for (const sx of [-1, 1]) {
    pushBox(darkWoodPos, darkWoodNorm, {
      cx: sx * 1.66, cy: 0.24, cz: apothem + 0.56,
      w: 0.16, h: 0.48, d: 1.12,
      rx: 0.32,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. OCTAGONAL PERIMETER RAILINGS (posts + two horizontal rails) & POST LANTERNS
  // Placed at radius r_rail = 3.74 m so all 10 footlights at rimRadius = 4.15 m
  // sit cleanly on the outer deck ledge in front of the railings (zero collisions),
  // while leaving the front (+Z, side k = 0) open for the steps and spot 0.
  // ---------------------------------------------------------------------------
  const railPostR = 3.74;
  const railPostBottomY = H; // 0.60 m
  const railPostHeight = 0.90; // top at y = 1.50 m

  // 8 corner posts at the octagon vertex angles: c_k = (k + 0.5) * PI / 4
  const cornerPosts = [];
  for (let k = 0; k < 8; k++) {
    const cAngle = ((k + 0.5) * Math.PI) / 4;
    const px = Math.sin(cAngle) * railPostR;
    const pz = Math.cos(cAngle) * railPostR;
    cornerPosts.push({ k, angle: cAngle, x: px, z: pz });

    pushBox(timberPos, timberNorm, {
      cx: px,
      cy: railPostBottomY + railPostHeight / 2,
      cz: pz,
      w: 0.20,
      h: railPostHeight,
      d: 0.20,
      ry: cAngle,
    });
    // Chamfered post cap
    pushBox(darkWoodPos, darkWoodNorm, {
      cx: px,
      cy: railPostBottomY + railPostHeight + 0.03,
      cz: pz,
      w: 0.24,
      h: 0.06,
      d: 0.24,
      ry: cAngle,
      taperTopX: 0.80,
      taperTopZ: 0.80,
    });
  }

  // Two horizontal rails (upper rail at y = 1.32 m, lower rail at y = 0.96 m)
  // across the 7 closed sides (k = 1..7; k = 0 is the front +Z step entrance)
  for (let k = 1; k < 8; k++) {
    const pA = cornerPosts[k - 1];
    const pB = cornerPosts[k];
    const midX = (pA.x + pB.x) / 2;
    const midZ = (pA.z + pB.z) / 2;
    const span = Math.hypot(pB.x - pA.x, pB.z - pA.z);
    const sideAngle = (k * Math.PI) / 4;

    // Upper horizontal rail
    pushBox(timberPos, timberNorm, {
      cx: midX,
      cy: H + 0.72,
      cz: midZ,
      w: span,
      h: 0.11,
      d: 0.09,
      ry: sideAngle,
    });
    // Lower horizontal rail
    pushBox(timberPos, timberNorm, {
      cx: midX,
      cy: H + 0.36,
      cz: midZ,
      w: span,
      h: 0.11,
      d: 0.09,
      ry: sideAngle,
    });
    // Short vertical center baluster block between the two rails
    pushBox(darkWoodPos, darkWoodNorm, {
      cx: midX,
      cy: H + 0.48,
      cz: midZ,
      w: 0.10,
      h: 0.70,
      d: 0.07,
      ry: sideAngle,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. PERIMETER BRASS POST LANTERNS (mounted on the 6 front & side railing posts)
  // Uses emissive glass (`bandstand_lantern_glass`) + brass cages (`bandstand_brass_fixtures`)
  // so no additional PointLight is added to the scene.
  // ---------------------------------------------------------------------------
  // Corner posts k = 0 (+22.5°), k = 7 (-22.5°), k = 1 (+67.5°), k = 6 (-67.5°), k = 2 (+112.5°), k = 5 (-112.5°)
  const lanternPostIndices = [0, 7, 1, 6, 2, 5];
  const lanternPositions = [];

  for (const idx of lanternPostIndices) {
    const post = cornerPosts[idx];
    const outX = Math.sin(post.angle);
    const outZ = Math.cos(post.angle);
    const lx = post.x + outX * 0.19;
    const lz = post.z + outZ * 0.19;
    const ly = H + 0.46; // y = 1.06 m
    lanternPositions.push({ x: lx, y: ly, z: lz, angle: post.angle });

    // Brass wall bracket arm connecting post face to lantern base
    pushBox(brassPos, brassNorm, {
      cx: post.x + outX * 0.11,
      cy: ly - 0.14,
      cz: post.z + outZ * 0.11,
      w: 0.06,
      h: 0.08,
      d: 0.18,
      ry: post.angle,
    });
    // Brass lantern pedestal base
    pushCylinder(brassPos, brassNorm, {
      cx: lx, cy: ly - 0.16, cz: lz,
      radiusTop: 0.09, radiusBottom: 0.11, height: 0.06, segments: 6,
    });
    // Brass lower cup
    pushCylinder(brassPos, brassNorm, {
      cx: lx, cy: ly - 0.10, cz: lz,
      radiusTop: 0.11, radiusBottom: 0.08, height: 0.06, segments: 6,
    });
    // Glowing amber glass globe (merged into `bandstand_lantern_glass`)
    pushCylinder(lanternGlassPos, lanternGlassNorm, {
      cx: lx, cy: ly + 0.02, cz: lz,
      radiusTop: 0.10, radiusBottom: 0.09, height: 0.20, segments: 6,
    });
    // Brass upper dome cap + vent chimney
    pushCylinder(brassPos, brassNorm, {
      cx: lx, cy: ly + 0.15, cz: lz,
      radiusTop: 0.05, radiusBottom: 0.13, height: 0.07, segments: 6,
    });
    pushCylinder(brassPos, brassNorm, {
      cx: lx, cy: ly + 0.21, cz: lz,
      radiusTop: 0.03, radiusBottom: 0.05, height: 0.05, segments: 6,
    });
  }

  // ---------------------------------------------------------------------------
  // 7. STEPPED BRASS FOOTLIGHT BASE RINGS & SHELL GEOMETRY (10 slots around rim)
  // Matches the sleek brass cap-stud footlights in concept/milos-ghost-bandstand.webp
  // ---------------------------------------------------------------------------
  const rimRadius = BANDSTAND_LAYOUT.rimRadius; // 4.15 m
  for (let i = 0; i < BANDSTAND_LAYOUT.footlightCount; i++) {
    const angle = (i / BANDSTAND_LAYOUT.footlightCount) * Math.PI * 2;
    const fx = Math.sin(angle) * rimRadius;
    const fz = Math.cos(angle) * rimRadius;
    // Sleek brass deck flange ring under each footlight
    pushCylinder(brassPos, brassNorm, {
      cx: fx, cy: H + 0.014, cz: fz,
      radiusTop: 0.14, radiusBottom: 0.16, height: 0.028, segments: 8,
    });
  }

  // Individual brass cap-stud footlight shell geometry (local to each `footlight_${i}` group,
  // where shell.position is (0, 0.13, 0) so local y = -0.10 sits on the base ring at y = 0.03)
  const shellPos = [], shellNorm = [];
  // Lower collar on top of base flange
  pushCylinder(shellPos, shellNorm, {
    cx: 0, cy: -0.085, cz: 0,
    radiusTop: 0.095, radiusBottom: 0.125, height: 0.035, segments: 8,
  });
  // Cylindrical brass neck
  pushCylinder(shellPos, shellNorm, {
    cx: 0, cy: -0.035, cz: 0,
    radiusTop: 0.068, radiusBottom: 0.068, height: 0.075, segments: 8,
  });
  // Slightly wider flat brass top cap (matching the brass floor studs in concept image)
  pushCylinder(shellPos, shellNorm, {
    cx: 0, cy: 0.012, cz: 0,
    radiusTop: 0.082, radiusBottom: 0.088, height: 0.024, segments: 8,
  });

  return {
    timber: {
      positions: timberPos,
      normals: timberNorm,
      fallbackDims: [3.48, 4.40, 3.74],
    },
    darkWood: {
      positions: darkWoodPos,
      normals: darkWoodNorm,
      fallbackDims: [3.40, 0.60, 1.20],
    },
    brass: {
      positions: brassPos,
      normals: brassNorm,
      fallbackDims: [0.72, 0.45, 0.72],
    },
    lanternGlass: {
      positions: lanternGlassPos,
      normals: lanternGlassNorm,
      fallbackDims: [0.22, 0.22, 0.22],
    },
    footlightShell: {
      positions: shellPos,
      normals: shellNorm,
      parameters: { radius: 0.18, height: 0.26, radialSegments: 8 },
    },
    lanternPositions,
    bounds: {
      deckRadius: R,
      deckHeight: H,
      bulbY: BANDSTAND_LAYOUT.bulbY,
      crossbeamY: BANDSTAND_LAYOUT.crossbeamY,
      ridgePeakY: BANDSTAND_LAYOUT.ridgePeakY,
      postSpanHalfX: BANDSTAND_LAYOUT.postSpanHalfX,
      ghostClearanceUnderBulb: BANDSTAND_LAYOUT.bulbY - 0.32 - (H + 1.46),
      nametagClearanceUnderBulb: BANDSTAND_LAYOUT.bulbY - 0.32 - (H + 2.05),
    },
  };
}

function buildMergedGeometry(THREE, partData) {
  let geo;
  if (typeof THREE.BufferGeometry === 'function' && typeof THREE.Float32BufferAttribute === 'function') {
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(partData.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(partData.normals, 3));
  } else {
    const [w, h, d] = partData.fallbackDims || [1, 1, 1];
    geo = new THREE.BoxGeometry(w, h, d);
  }
  if (partData.parameters) {
    geo.parameters = { ...(geo.parameters || {}), ...partData.parameters };
  }
  geo.userData = {
    positions: partData.positions,
    normals: partData.normals,
  };
  return geo;
}

function setMaterialColor(mat, prop, hex) {
  if (!mat) return;
  if (mat[prop] && typeof mat[prop].set === 'function') {
    mat[prop].set(hex);
  } else {
    mat[prop] = hex;
  }
}

/**
 * Helper to light a footlight slot and flip its placard up with a headless-safe
 * CanvasTexture (mirroring `buildMilosGhost` and `applyState` in `town-3d/town.js`).
 */
export function lightFootlightSlot(THREE, flGroup, { handle = 'milo', role = 'muse', permanent = false } = {}) {
  if (!flGroup || !flGroup.userData) return flGroup;
  const { shell, placard } = flGroup.userData;
  const palette = BANDSTAND_FOOTLIGHT_COLORS[role === 'npc' ? 'npc' : 'muse'];
  setMaterialColor(shell.material, 'color', palette.color);
  setMaterialColor(shell.material, 'emissive', palette.emissive);
  shell.material.emissiveIntensity = palette.emissiveIntensity;

  placard.rotation.x = -0.55;
  placard.position.y = 0.14;
  placard.material.map = makeBandstandTextTexture(THREE, [handle], {
    width: 256,
    height: 96,
    titleSize: 28,
    bg: BANDSTAND_PALETTE.placardBg,
    border: BANDSTAND_PALETTE.placardBorder,
    fg: BANDSTAND_PALETTE.placardFg,
  });
  setMaterialColor(placard.material, 'color', '#ffffff');
  placard.material.needsUpdate = true;

  flGroup.userData.lit = true;
  flGroup.userData.handle = handle;
  flGroup.userData.role = role === 'npc' ? 'npc' : 'muse';
  if (permanent) flGroup.userData.permanent = true;
  return flGroup;
}

/**
 * Build the concept-matched Ghostlight Bandstand Three.js Group (`ghostlight_bandstand`).
 *
 * Options:
 *  - `name`: Group name (default `'ghostlight_bandstand'`)
 *  - `label`: Clickable label (default `'The Ghostlight Bandstand'`)
 *  - `lightMiloFootlight`: Whether to pre-light slot 0 (`'milo'`) during construction
 *    (default `false` so `buildMilosGhost` in `town.js` can light it as usual, or `true`
 *    for standalone preview/testing).
 *  - `includeStageProps`: Whether to also include the legacy Slice 4a stage meshes
 *    (`nightly_call_card`, `copper_samovar` + steam sprites, `prompt_desk`) (default `false`
 *    for clean concept match).
 */
export function createConceptBandstand(THREE, options = {}) {
  const data = buildBandstandGeometryData();

  const group = new THREE.Group();
  group.name = options.name || 'ghostlight_bandstand';
  group.userData = {
    clickable: true,
    kind: 'bandstand',
    label: options.label || 'The Ghostlight Bandstand',
  };

  const cedarMat = new THREE.MeshStandardMaterial({
    color: BANDSTAND_PALETTE.cedar,
    roughness: 0.88,
    flatShading: true,
  });
  const warmTimberMat = new THREE.MeshStandardMaterial({
    color: BANDSTAND_PALETTE.warmTimber,
    roughness: 0.85,
    flatShading: true,
  });
  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: BANDSTAND_PALETTE.darkWood,
    roughness: 0.90,
    flatShading: true,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: BANDSTAND_PALETTE.brass,
    roughness: 0.45,
    metalness: 0.60,
    flatShading: true,
  });
  const lanternGlassMat = new THREE.MeshStandardMaterial({
    color: BANDSTAND_PALETTE.lanternGlass,
    emissive: BANDSTAND_PALETTE.lanternEmissive,
    emissiveIntensity: 1.4,
    roughness: 0.30,
  });

  // 1. Octagonal cedar deck base (`bandstand_base` — 8-sided CylinderGeometry required by test-3d.mjs)
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(
      BANDSTAND_LAYOUT.radius,
      BANDSTAND_LAYOUT.radius,
      BANDSTAND_LAYOUT.height,
      8
    ),
    cedarMat
  );
  base.name = 'bandstand_base';
  base.position.set(0, BANDSTAND_LAYOUT.height / 2, 0);
  // Rotate by PI/8 (22.5 deg) so the 8 flat sides align with 0, 45, 90.. deg (+Z front steps)
  base.rotation.y = Math.PI / 8;
  group.add(base);

  // 2. Merged warm-timber A-frame roof structure + 7-sided perimeter railings + deck plank courses
  const aframeMesh = new THREE.Mesh(buildMergedGeometry(THREE, data.timber), warmTimberMat);
  aframeMesh.name = 'bandstand_aframe';
  group.add(aframeMesh);

  // 3. Merged dark-wood two-tier front steps + octagonal rim fascia + under-deck braces
  const stepsMesh = new THREE.Mesh(buildMergedGeometry(THREE, data.darkWood), darkWoodMat);
  stepsMesh.name = 'bandstand_steps';
  group.add(stepsMesh);

  // 4. Merged brass hardware (overhead Ghostlight pendant shade/rod, 6 lantern cages, 10 footlight base rings)
  const brassMesh = new THREE.Mesh(buildMergedGeometry(THREE, data.brass), brassMat);
  brassMesh.name = 'bandstand_brass_fixtures';
  group.add(brassMesh);

  // 5. Merged emissive amber glass for the 6 perimeter post lanterns (0 extra PointLights)
  const lanternGlassMesh = new THREE.Mesh(
    buildMergedGeometry(THREE, data.lanternGlass),
    lanternGlassMat
  );
  lanternGlassMesh.name = 'bandstand_lantern_glass';
  group.add(lanternGlassMesh);

  // 6. The Ghostlight bulb (emissive, hanging from the center of the A-frame crossbeam) + 1 PointLight
  const bulbMat = new THREE.MeshStandardMaterial({
    color: BANDSTAND_PALETTE.bulbColor,
    emissive: BANDSTAND_PALETTE.bulbEmissive,
    emissiveIntensity: 1.8,
    roughness: 0.25,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), bulbMat);
  bulb.name = 'ghostlight_bulb';
  bulb.position.set(0, BANDSTAND_LAYOUT.bulbY, 0);
  group.add(bulb);

  const light = new THREE.PointLight(BANDSTAND_PALETTE.pointLightColor, 3.0, 42);
  light.name = 'ghostlight_point_light';
  light.position.set(0, BANDSTAND_LAYOUT.bulbY, 0);
  group.add(light);

  // Optional legacy stage props (`nightly_call_card`, `copper_samovar`, `prompt_desk`) if requested
  if (options.includeStageProps) {
    const standPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.1, 6), brassMat);
    standPost.position.set(-1.3, 0.55, 4.9);
    group.add(standPost);

    const callTex = makeBandstandTextTexture(THREE, ['THE NIGHTLY CALL', "tonight's prompt appears here"], {
      width: 512,
      height: 256,
      titleSize: 30,
      subSize: 20,
      bg: '#f2e6cf',
      border: '#b59449',
      fg: '#2b1e14',
    });
    const callBoard = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.55, 0.05),
      new THREE.MeshStandardMaterial({ map: callTex, roughness: 0.7 })
    );
    callBoard.name = 'nightly_call_card';
    callBoard.position.set(-1.3, 1.15, 4.9);
    callBoard.rotation.x = -0.35;
    group.add(callBoard);

    const samovar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.55, 8),
      new THREE.MeshStandardMaterial({ color: '#c46f3b', roughness: 0.4, metalness: 0.65 })
    );
    samovar.name = 'copper_samovar';
    samovar.position.set(1.9, 0.88, 3.6);
    group.add(samovar);

    if (typeof THREE.Sprite === 'function' && typeof THREE.SpriteMaterial === 'function') {
      const steamTex = makeBandstandTextTexture(THREE, ['~'], {
        width: 64,
        height: 64,
        titleSize: 40,
        bg: 'rgba(255,255,255,0)',
        border: 'rgba(255,255,255,0)',
        fg: '#e8eef5',
      });
      for (let s = 0; s < 2; s++) {
        const steam = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0.35 }));
        steam.name = `samovar_steam_${s}`;
        steam.position.set(1.9 + s * 0.08, 1.35 + s * 0.35, 3.6);
        steam.scale.set(0.45, 0.45, 1);
        group.add(steam);
      }
    }

    const promptDesk = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.75, 0.65),
      new THREE.MeshStandardMaterial({ color: '#5e3d24', roughness: 0.85 })
    );
    promptDesk.name = 'prompt_desk';
    promptDesk.position.set(1.7, 0.38, 5.1);
    group.add(promptDesk);
  }

  // 7. Exactly 10 brass footlights & 10 avatar spots in the exact slots/positions expected by town.js
  const footlights = [];
  const avatarSpots = [];
  const rimRadius = BANDSTAND_LAYOUT.rimRadius;

  // Shared geometry for the 10 footlight shells (ConeGeometry fallback under test-3d.mjs stub)
  const shellGeo =
    typeof THREE.BufferGeometry === 'function' && typeof THREE.Float32BufferAttribute === 'function'
      ? buildMergedGeometry(THREE, data.footlightShell)
      : new THREE.ConeGeometry(0.18, 0.26, 6);

  for (let i = 0; i < BANDSTAND_LAYOUT.footlightCount; i++) {
    const angle = (i / BANDSTAND_LAYOUT.footlightCount) * Math.PI * 2;
    const fx = Math.sin(angle) * rimRadius;
    const fz = Math.cos(angle) * rimRadius;

    const flGroup = new THREE.Group();
    flGroup.name = `footlight_${i}`;
    flGroup.position.set(fx, BANDSTAND_LAYOUT.height, fz);
    flGroup.rotation.y = angle;

    const shell = new THREE.Mesh(
      shellGeo,
      new THREE.MeshStandardMaterial({
        color: BANDSTAND_PALETTE.footlightUnlit,
        roughness: 0.55,
        metalness: 0.5,
      })
    );
    shell.name = 'footlight_shell';
    shell.position.set(0, 0.13, 0);
    flGroup.add(shell);

    const placardMat = new THREE.MeshStandardMaterial({
      color: BANDSTAND_PALETTE.darkWood,
      roughness: 0.9,
    });
    const placard = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.12, 0.04),
      placardMat
    );
    placard.name = 'footlight_placard';
    placard.position.set(0, 0.06, 0.22);
    flGroup.add(placard);

    flGroup.userData = {
      slot: i,
      shell,
      placard,
      lit: false,
      handle: null,
      role: null,
    };

    group.add(flGroup);
    footlights.push(flGroup);

    const ax = +(Math.sin(angle) * BANDSTAND_LAYOUT.radius).toFixed(4);
    const az = +(Math.cos(angle) * BANDSTAND_LAYOUT.radius).toFixed(4);
    avatarSpots.push({
      slot: i,
      x: ax,
      y: BANDSTAND_LAYOUT.height,
      z: az,
      rotY: +Math.atan2(-ax, -az).toFixed(4),
    });
  }

  // Headless-safe default placard texture warm-up (ensures CanvasTexture creation works even when document is absent)
  const defaultPlacardTexture = makeBandstandTextTexture(THREE, ['The Ghostlight Bandstand'], {
    width: 256,
    height: 96,
    titleSize: 22,
    bg: BANDSTAND_PALETTE.placardBg,
    border: BANDSTAND_PALETTE.placardBorder,
    fg: BANDSTAND_PALETTE.placardFg,
  });
  group.defaultPlacardTexture = defaultPlacardTexture;

  if (options.lightMiloFootlight) {
    lightFootlightSlot(THREE, footlights[0], { handle: 'milo', role: 'muse', permanent: true });
  }

  // Attach references on group so callers expecting either a Group or
  // `{ group, bulb, light, footlights, avatarSpots }` can wire it cleanly.
  group.bulb = bulb;
  group.light = light;
  group.footlights = footlights;
  group.avatarSpots = avatarSpots;

  return group;
}

/**
 * Direct drop-in replacement for `buildBandstand(THREE)` in `town-3d/town.js`,
 * returning `{ group, bulb, light, footlights, avatarSpots }`.
 */
export function buildConceptBandstand(THREE, options = {}) {
  const group = createConceptBandstand(THREE, options);
  return {
    group,
    bulb: group.bulb,
    light: group.light,
    footlights: group.footlights,
    avatarSpots: group.avatarSpots,
  };
}
