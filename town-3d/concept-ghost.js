/**
 * Proof-of-concept: Milo's Ghost matched to concept/milos-ghost-bandstand.webp
 * Pure Three.js (0.160.0) procedural geometry + 2D CanvasTexture face decal,
 * zero external dependencies.
 *
 * Key upgrades over the current cylinder-and-cone buildMilosGhost() in town.js:
 *  1. Rounded low-poly dome head (`ghost_dome`) that blends smoothly into the sheet.
 *  2. Flared sheet body (`ghost_body`) that drapes outward from the head toward
 *     the bottom with 6 vertical drapery pleat ridges/valleys and a multi-pointed
 *     wavy/zig-zag hem (matching the Tripo 3D reference and concept illustration,
 *     replacing the inverted-taper cylinder).
 *  3. Short curved wisp tail (`ghost_wisp`) emerging from beneath the center of
 *     the draped sheet, curving gently to the right (+X) and forward (+Z) with a
 *     fine pointed tip, strictly within `height <= 0.4` (0.35 m).
 *  4. Curved front-facing face decal (`ghost_face_decal`, facing +Z toward the
 *     gate/path) textured with a 512x512 CanvasTexture drawn from Milo's avatar
 *     reference: big glossy anime eyes with navy-to-azure iris gradients, large
 *     catchlights + 4-point starry sparkles, arched eyebrows, small cute smile,
 *     and rosy pink oval cheeks.
 *  5. Headless-safe CanvasTexture builder (`makeGhostFaceTexture`) following the
 *     exact `makeCanvas` pattern from `town.js` so `test-3d.mjs` and headless Node
 *     runs execute every canvas drawing call against a safe mock when `document`
 *     is absent.
 *  6. Optional `includeEyeSpheres` flag (default `true` for 100% backward
 *     compatibility with existing `test-3d.mjs` assertions): places the two
 *     opaque `#16202e` `ghost_eye` spheres nested slightly inside the dark pupil
 *     centers of the face decal (`depthWrite: false` on the decal or recessed Z)
 *     so they do not occlude the starry catchlights on the front decal, or omits
 *     them cleanly when `{ includeEyeSpheres: false }` is passed.
 */

export const GHOST_PALETTE = {
  iceBlue: '#a8d8ea',
  eyeDark: '#16202e',
  irisMid: '#1f4f82',
  irisBright: '#58b8f0',
  irisRim: '#0d1522',
  cheekPink: '#ff9ebb',
  mouthDark: '#1d2b3a',
  browDark: '#1d354d',
  nametagBg: '#161b28',
  nametagFg: '#9be0ff',
};

/**
 * Create a 2D canvas in browser DOM or a complete no-op mock in headless Node
 * (matching `makeCanvas` in `town-3d/town.js`, extended with ellipse/bezier/gradient
 * methods used by the detailed face decal painter).
 */
export function makeGhostCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  const noop = () => {};
  const gradientStub = { addColorStop: noop };
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalAlpha: 1,
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
    ellipse: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    createRadialGradient: () => gradientStub,
    createLinearGradient: () => gradientStub,
  };
  return {
    width,
    height,
    getContext: () => ctx,
  };
}

/**
 * Draw a 4-point star sparkle centered at (cx, cy) onto a 2D canvas context.
 */
function drawFourPointStar(ctx, cx, cy, outerR, innerR) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Paint Milo's cute ghost face onto a 2D context (`width` x `height`, default 512x512).
 * Exported separately so verification scripts and software renderers can inspect or
 * replay the exact drawing operations.
 */
export function paintGhostFace(ctx, width = 512, height = 512) {
  ctx.clearRect(0, 0, width, height);

  const sx = width / 512;
  const sy = height / 512;

  // 1. Arched cute eyebrows above the eyes
  ctx.strokeStyle = GHOST_PALETTE.browDark;
  ctx.lineWidth = 7.0 * sx;
  ctx.lineCap = 'round';

  // Left brow
  ctx.beginPath();
  ctx.moveTo(124 * sx, 138 * sy);
  ctx.quadraticCurveTo(154 * sx, 114 * sy, 184 * sx, 134 * sy);
  ctx.stroke();

  // Right brow
  ctx.beginPath();
  ctx.moveTo(328 * sx, 134 * sy);
  ctx.quadraticCurveTo(358 * sx, 114 * sy, 388 * sx, 138 * sy);
  ctx.stroke();

  // 2. Soft rosy pink oval cheeks (drawn before eyes so eye rims sit cleanly over them)
  const cheeks = [
    { cx: 108 * sx, cy: 312 * sy, rx: 38 * sx, ry: 21 * sy },
    { cx: 404 * sx, cy: 312 * sy, rx: 38 * sx, ry: 21 * sy },
  ];
  for (const ch of cheeks) {
    const grad = ctx.createRadialGradient(ch.cx, ch.cy, 2 * sx, ch.cx, ch.cy, ch.rx);
    grad.addColorStop(0.0, 'rgba(255, 148, 182, 0.85)');
    grad.addColorStop(0.65, 'rgba(255, 158, 187, 0.55)');
    grad.addColorStop(1.0, 'rgba(255, 158, 187, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(ch.cx, ch.cy, ch.rx, ch.ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Big glossy anime eyes with starry catchlights
  const eyes = [
    { cx: 156 * sx, cy: 232 * sy, rx: 52 * sx, ry: 58 * sy },
    { cx: 356 * sx, cy: 232 * sy, rx: 52 * sx, ry: 58 * sy },
  ];

  for (const eye of eyes) {
    // Crisp white outer sclera rim (subtle halo as in concept & avatar)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy, eye.rx + 4.5 * sx, eye.ry + 4.5 * sy, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dark navy outer iris ring
    ctx.fillStyle = GHOST_PALETTE.irisRim;
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy, eye.rx, eye.ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rich deep-blue to sky-blue lower iris gradient
    const irisGrad = ctx.createLinearGradient(
      eye.cx,
      eye.cy - eye.ry * 0.8,
      eye.cx,
      eye.cy + eye.ry * 0.9
    );
    irisGrad.addColorStop(0.0, '#0e192d');
    irisGrad.addColorStop(0.48, '#1b3860');
    irisGrad.addColorStop(0.82, '#2e6da4');
    irisGrad.addColorStop(1.0, '#63c5f8');
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy, eye.rx * 0.88, eye.ry * 0.88, 0, 0, Math.PI * 2);
    ctx.fill();

    // Lower crescent azure glow
    ctx.fillStyle = 'rgba(115, 210, 255, 0.42)';
    ctx.beginPath();
    ctx.ellipse(
      eye.cx,
      eye.cy + eye.ry * 0.36,
      eye.rx * 0.62,
      eye.ry * 0.34,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Deep dark pupil center
    ctx.fillStyle = '#09101d';
    ctx.beginPath();
    ctx.ellipse(eye.cx, eye.cy - eye.ry * 0.04, eye.rx * 0.54, eye.ry * 0.56, 0, 0, Math.PI * 2);
    ctx.fill();

    // Primary upper-left glossy white catchlight oval
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(
      eye.cx - eye.rx * 0.32,
      eye.cy - eye.ry * 0.32,
      eye.rx * 0.25,
      eye.ry * 0.28,
      -0.25,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Secondary lower-right catchlight dot
    ctx.beginPath();
    ctx.ellipse(
      eye.cx + eye.rx * 0.30,
      eye.cy + eye.ry * 0.34,
      eye.rx * 0.12,
      eye.ry * 0.12,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Tiny upper-right pinprick dot
    ctx.beginPath();
    ctx.arc(eye.cx + eye.rx * 0.34, eye.cy - eye.ry * 0.22, 3.8 * sx, 0, Math.PI * 2);
    ctx.fill();

    // 4-point starry sparkle inside the iris (signature detail from Milo's avatar & concept)
    drawFourPointStar(
      ctx,
      eye.cx + eye.rx * 0.16,
      eye.cy + eye.ry * 0.04,
      13.5 * sx,
      3.8 * sx
    );
    drawFourPointStar(
      ctx,
      eye.cx - eye.rx * 0.18,
      eye.cy + eye.ry * 0.26,
      7.5 * sx,
      2.2 * sx
    );
  }

  // 4. Small cute upturned smile between the cheeks
  ctx.strokeStyle = GHOST_PALETTE.mouthDark;
  ctx.lineWidth = 6.5 * sx;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(226 * sx, 304 * sy);
  ctx.quadraticCurveTo(256 * sx, 330 * sy, 286 * sx, 304 * sy);
  ctx.stroke();
}

/**
 * Create the Three.js CanvasTexture for Milo's ghost face decal.
 */
export function makeGhostFaceTexture(THREE, opts = {}) {
  const width = opts.width || 512;
  const height = opts.height || 512;
  const canvas = makeGhostCanvas(width, height);
  const ctx = canvas.getContext('2d');
  paintGhostFace(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create a simple text texture (for the `[MUSE] milo` nametag sprite) using the
 * same headless-safe canvas pattern as `town.js`.
 */
function makeNametagTexture(THREE, text) {
  const width = 384;
  const height = 96;
  const canvas = makeGhostCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = GHOST_PALETTE.nametagBg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = GHOST_PALETTE.nametagFg;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, width - 16, height - 16);

  ctx.fillStyle = GHOST_PALETTE.nametagFg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px monospace';
  ctx.fillText(String(text), width / 2, height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Helper to append a triangle with flat face normal (or per-vertex normals/UVs)
 * into a position/normal/uv array set.
 */
function pushTriangle(positions, normals, uvs, va, vb, vc, uva = null, uvb = null, uvc = null) {
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
  if (uvs && uva && uvb && uvc) {
    uvs.push(uva[0], uva[1], uvb[0], uvb[1], uvc[0], uvc[1]);
  }
}

/**
 * Helper to evaluate a vertex on the ghost's continuous dome + flared pleated
 * sheet surface so `ghost_dome`, `ghost_body`, and `ghost_face_decal` share an
 * exact, seamless low-poly silhouette.
 *
 * Total ghost height: y = 0.03 m (wisp tip) to y = 1.46 m (top of dome), ~1.43 m tall.
 * - Dome (`ghost_dome`): y in [1.04, 1.46], radius 0.345 m at equator (y = 1.12).
 * - Flared sheet (`ghost_body`): y in [0.27, 1.04], flaring from r = 0.342 m at
 *   neck/shoulders out to r ~ 0.49 m at the bottom with 6 drapery folds and a
 *   6-pointed wavy/scalloped hem (peaks at y ~ 0.36, tips at y ~ 0.27).
 * - Short wisp (`ghost_wisp`): y in [0.03, 0.38], height = 0.35 m (<= 0.4 m).
 */
function evalSheetRadiusAndHem(theta, tBody) {
  // Base flare profile from top of body (t=0, y=1.04) to bottom hem (t=1, y~0.35)
  const baseR = 0.342 + 0.118 * Math.pow(tBody, 1.18) + 0.024 * Math.sin(tBody * Math.PI);

  // 6 vertical drapery folds phased with -cos(6 * theta) so at theta = 0 (center front)
  // the hem lifts into an inverted V arch directly over the curved wisp tail, while two
  // prominent pointed drapery corners frame the wisp at theta = +-30 deg (matching
  // concept/milos-ghost-bandstand.webp).
  const foldEnvelope = Math.pow(tBody, 1.45);
  const primaryFold = -0.034 * foldEnvelope * Math.cos(6 * theta);
  const secondaryFold = 0.014 * foldEnvelope * Math.cos(2 * theta);
  const r = baseR + primaryFold + secondaryFold;

  // Wavy / zig-zag bottom hem:
  // At theta = 0 (center front), -cos(6*theta) = -1 -> hem lifts up to y ~ 0.405 so the
  // entire 0.35 m curved wisp is clearly visible below it. At theta = +-30 deg and +-90 deg,
  // -cos(6*theta) = +1 -> hem drops into pointed tips at y ~ 0.295.
  const hemWave = -0.052 * Math.cos(6 * theta) + 0.010 * Math.cos(2 * theta);
  const topY = 1.04;
  const baseBottomY = 0.355;
  const y = topY - tBody * (topY - (baseBottomY - hemWave * tBody));

  return { r, y };
}

/**
 * Build the pure geometry arrays for `ghost_dome`, `ghost_body`, `ghost_wisp`,
 * and `ghost_face_decal`.
 */
export function buildGhostGeometryData() {
  const radialSegs = 24; // Low-poly faceted look matching the Tripo wireframe

  // ---------------------------------------------------------------------------
  // 1. DOME HEAD (`ghost_dome`): y from 1.04 up to 1.46
  // Center of curvature at y = 1.11, radiusRx = 0.345, radiusRy = 0.35
  // ---------------------------------------------------------------------------
  const domePos = [], domeNorm = [];
  const domeRings = [
    // phi = 0 is top pole (y = 1.46); last ring meets top of ghost_body at y = 1.04, r = 0.342
    { y: 1.460, r: 0.000 },
    { y: 1.438, r: 0.112 },
    { y: 1.380, r: 0.214 },
    { y: 1.295, r: 0.292 },
    { y: 1.195, r: 0.335 },
    { y: 1.105, r: 0.346 },
    { y: 1.040, r: 0.342 },
  ];

  for (let rIdx = 0; rIdx < domeRings.length - 1; rIdx++) {
    const ringA = domeRings[rIdx];
    const ringB = domeRings[rIdx + 1];
    for (let s = 0; s < radialSegs; s++) {
      const th0 = (s / radialSegs) * Math.PI * 2;
      const th1 = ((s + 1) / radialSegs) * Math.PI * 2;

      const p00 = [Math.sin(th0) * ringA.r, ringA.y, Math.cos(th0) * ringA.r];
      const p10 = [Math.sin(th1) * ringA.r, ringA.y, Math.cos(th1) * ringA.r];
      const p01 = [Math.sin(th0) * ringB.r, ringB.y, Math.cos(th0) * ringB.r];
      const p11 = [Math.sin(th1) * ringB.r, ringB.y, Math.cos(th1) * ringB.r];

      if (rIdx === 0) {
        pushTriangle(domePos, domeNorm, null, p00, p01, p11);
      } else {
        pushTriangle(domePos, domeNorm, null, p00, p01, p11);
        pushTriangle(domePos, domeNorm, null, p00, p11, p10);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. FLARED PLEATED SHEET BODY (`ghost_body`): y from 1.04 down to wavy hem (~0.27..0.37)
  // ---------------------------------------------------------------------------
  const bodyPos = [], bodyNorm = [];
  const bodySteps = 8;
  const bodyGrid = [];

  for (let i = 0; i <= bodySteps; i++) {
    const t = i / bodySteps;
    const row = [];
    for (let s = 0; s < radialSegs; s++) {
      const theta = (s / radialSegs) * Math.PI * 2;
      const { r, y } = evalSheetRadiusAndHem(theta, t);
      row.push([Math.sin(theta) * r, y, Math.cos(theta) * r]);
    }
    bodyGrid.push(row);
  }

  for (let i = 0; i < bodySteps; i++) {
    const rowA = bodyGrid[i];
    const rowB = bodyGrid[i + 1];
    for (let s = 0; s < radialSegs; s++) {
      const sNext = (s + 1) % radialSegs;
      const p00 = rowA[s];
      const p10 = rowA[sNext];
      const p01 = rowB[s];
      const p11 = rowB[sNext];

      pushTriangle(bodyPos, bodyNorm, null, p00, p01, p11);
      pushTriangle(bodyPos, bodyNorm, null, p00, p11, p10);
    }
  }

  // Subtle inward-turning bottom hem rim (closes the sheet underside cleanly to an inner ring
  // around the wisp base so the hem has crisp low-poly thickness when viewed from any angle)
  const hemRow = bodyGrid[bodySteps];
  const innerHemRadius = 0.16;
  const innerHemY = 0.34;
  for (let s = 0; s < radialSegs; s++) {
    const sNext = (s + 1) % radialSegs;
    const th0 = (s / radialSegs) * Math.PI * 2;
    const th1 = (sNext / radialSegs) * Math.PI * 2;
    const outer0 = hemRow[s];
    const outer1 = hemRow[sNext];
    const inner0 = [Math.sin(th0) * innerHemRadius, innerHemY, Math.cos(th0) * innerHemRadius];
    const inner1 = [Math.sin(th1) * innerHemRadius, innerHemY, Math.cos(th1) * innerHemRadius];

    pushTriangle(bodyPos, bodyNorm, null, outer0, inner0, inner1);
    pushTriangle(bodyPos, bodyNorm, null, outer0, inner1, outer1);
  }

  // ---------------------------------------------------------------------------
  // 3. SHORT CURVED WISP TAIL (`ghost_wisp`): height = 0.35 m (<= 0.4 m constraint!)
  // Emerges at y = 0.38 (tucked 4 cm inside the lower hem) and tapers to a
  // curved S-hook point at y = 0.03 (total wisp height = 0.35 m).
  // ---------------------------------------------------------------------------
  const wispPos = [], wispNorm = [];
  const wispHeight = 0.35;
  const wispTopY = 0.38;
  const wispSegs = 12;
  const wispRings = [
    { t: 0.00, r: 0.165, cx:  0.000, cz: 0.000 },
    { t: 0.25, r: 0.122, cx: -0.018, cz: 0.015 },
    { t: 0.50, r: 0.082, cx: -0.032, cz: 0.035 },
    { t: 0.72, r: 0.046, cx: -0.020, cz: 0.055 },
    { t: 0.88, r: 0.020, cx:  0.008, cz: 0.070 },
    { t: 1.00, r: 0.000, cx:  0.028, cz: 0.082 },
  ];

  for (let i = 0; i < wispRings.length - 1; i++) {
    const rA = wispRings[i];
    const rB = wispRings[i + 1];
    const yA = wispTopY - rA.t * wispHeight;
    const yB = wispTopY - rB.t * wispHeight;

    for (let s = 0; s < wispSegs; s++) {
      const th0 = (s / wispSegs) * Math.PI * 2;
      const th1 = ((s + 1) / wispSegs) * Math.PI * 2;

      const p00 = [rA.cx + Math.sin(th0) * rA.r, yA, rA.cz + Math.cos(th0) * rA.r];
      const p10 = [rA.cx + Math.sin(th1) * rA.r, yA, rA.cz + Math.cos(th1) * rA.r];
      const p01 = [rB.cx + Math.sin(th0) * rB.r, yB, rB.cz + Math.cos(th0) * rB.r];
      const p11 = [rB.cx + Math.sin(th1) * rB.r, yB, rB.cz + Math.cos(th1) * rB.r];

      if (i === wispRings.length - 2) {
        pushTriangle(wispPos, wispNorm, null, p00, p01, p10);
      } else {
        pushTriangle(wispPos, wispNorm, null, p00, p01, p11);
        pushTriangle(wispPos, wispNorm, null, p00, p11, p10);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. FRONT FACE DECAL PATCH (`ghost_face_decal`):
  // Conforms to the front (+Z) curvature of the upper body/lower dome
  // (y in [0.81, 1.25], theta in [-0.55, +0.55] rad), offset outward by 0.009 m
  // along the surface radial vector so it never Z-fights with `ghost_dome` or `ghost_body`.
  // ---------------------------------------------------------------------------
  const decalPos = [], decalNorm = [], decalUv = [];
  const decalCols = 10;
  const decalRows = 8;
  const thetaMax = 0.55; // ~31.5 deg half-angle across front (+Z)
  const yTop = 1.25;
  const yBot = 0.81;
  const decalOutset = 0.009;

  function evalDecalPoint(u, v) {
    // u in [0, 1] left-to-right (-X to +X when looking at the front +Z face)
    // v in [0, 1]: in Three.js CanvasTexture (default flipY = true), v = 1 is the TOP
    // of the canvas (y = 0 in 2D ctx) and v = 0 is the BOTTOM of the canvas (y = height in 2D ctx).
    const theta = (u - 0.5) * 2 * thetaMax;
    const y = yBot + v * (yTop - yBot);

    let rSurface;
    if (y >= 1.04) {
      // Interpolate along domeRings
      rSurface = 0.342;
      for (let k = 0; k < domeRings.length - 1; k++) {
        const topR = domeRings[k];
        const botR = domeRings[k + 1];
        if (y <= topR.y && y >= botR.y) {
          const frac = (topR.y - y) / (topR.y - botR.y || 1);
          rSurface = topR.r + frac * (botR.r - topR.r);
          break;
        }
      }
    } else {
      const tBody = (1.04 - y) / (1.04 - 0.355);
      rSurface = evalSheetRadiusAndHem(theta, tBody).r;
    }

    const r = rSurface + decalOutset;
    return [Math.sin(theta) * r, y, Math.cos(theta) * r];
  }

  for (let row = 0; row < decalRows; row++) {
    const v0 = 1 - row / decalRows;
    const v1 = 1 - (row + 1) / decalRows;
    for (let col = 0; col < decalCols; col++) {
      const u0 = col / decalCols;
      const u1 = (col + 1) / decalCols;

      const p00 = evalDecalPoint(u0, v0);
      const p10 = evalDecalPoint(u1, v0);
      const p01 = evalDecalPoint(u0, v1);
      const p11 = evalDecalPoint(u1, v1);

      pushTriangle(decalPos, decalNorm, decalUv, p00, p01, p11, [u0, v0], [u0, v1], [u1, v1]);
      pushTriangle(decalPos, decalNorm, decalUv, p00, p11, p10, [u0, v0], [u1, v1], [u1, v0]);
    }
  }

  return {
    dome: {
      positions: domePos,
      normals: domeNorm,
      parameters: { radius: 0.345, height: 0.42, widthSegments: radialSegs, heightSegments: domeRings.length - 1 },
    },
    body: {
      positions: bodyPos,
      normals: bodyNorm,
      parameters: { radiusTop: 0.342, radiusBottom: 0.49, height: 0.77, radialSegments: radialSegs },
    },
    wisp: {
      positions: wispPos,
      normals: wispNorm,
      parameters: { radius: 0.165, height: wispHeight, radialSegments: wispSegs },
    },
    decal: {
      positions: decalPos,
      normals: decalNorm,
      uvs: decalUv,
      parameters: { width: 0.35, height: 0.40 },
    },
    eyeCenters: [
      { x: -0.118, y: 1.045, z: 0.305, radius: 0.032 },
      { x:  0.118, y: 1.045, z: 0.305, radius: 0.032 },
    ],
    bounds: {
      minY: 0.03,
      maxY: 1.46,
      totalHeight: 1.43,
      maxRadius: 0.50,
      wispHeight,
    },
  };
}

/**
 * Build a Three.js BufferGeometry from position/normal/uv arrays, or fall back
 * to the matching primitive geometry class when running under the minimal
 * `test-3d.mjs` stub (which does not define `BufferGeometry`) while always
 * attaching `.parameters` and `.attributes` so both test assertions and export
 * scripts can inspect the mesh.
 */
function buildPartGeometry(THREE, partData, fallbackFactory) {
  let geo;
  if (typeof THREE.BufferGeometry === 'function' && typeof THREE.Float32BufferAttribute === 'function') {
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(partData.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(partData.normals, 3));
    if (partData.uvs) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(partData.uvs, 2));
    }
  } else {
    geo = fallbackFactory();
  }
  geo.parameters = { ...(geo.parameters || {}), ...partData.parameters };
  geo.userData = {
    positions: partData.positions,
    normals: partData.normals,
    uvs: partData.uvs || null,
  };
  return geo;
}

/**
 * Create the concept-matched Milo's Ghost Three.js Group (`milos_ghost`).
 *
 * Options:
 *  - `name`: Group name (default `'milos_ghost'`)
 *  - `label`: Clickable label (default `'Milo'`)
 *  - `includeNametag`: Whether to include the floating `[MUSE] milo` Sprite (default `true`)
 *  - `includeEyeSpheres`: Whether to include the two opaque `ghost_eye` sphere meshes
 *    asserted by `town-3d/test-3d.mjs` (default `true`). When `true`, the spheres sit
 *    slightly behind the curved `ghost_face_decal` (`z = 0.305` vs decal `z ~ 0.354`)
 *    inside the dark pupil centers so the decal's starry catchlights render cleanly in
 *    front without sphere protrusion. Pass `false` if integrating after updating tests.
 *  - `spot`: Optional `{ x, y, z }` bandstand spot to position & orient the ghost.
 */
export function createConceptMiloGhost(THREE, options = {}) {
  const data = buildGhostGeometryData();

  const ghost = new THREE.Group();
  ghost.name = options.name || 'milos_ghost';
  ghost.userData = {
    clickable: true,
    kind: 'ghost',
    handle: 'milo',
    label: options.label || 'Milo',
    role: 'muse',
    permanent: true,
  };

  // Translucent ice-blue sheet material (#a8d8ea, opacity 0.85 — governed by CONCEPT.md).
  // Owner tweak 2026-11-12: Argon's proof used 0.7, but the live render read too
  // washed-out against the night scene and the bulb (Werther's eye), so 0.85.
  const ghostMat = new THREE.MeshStandardMaterial({
    color: GHOST_PALETTE.iceBlue,
    transparent: true,
    opacity: 0.85,
    roughness: 0.55,
    flatShading: true,
  });

  // 1. Rounded low-poly dome (`ghost_dome`)
  const domeGeo = buildPartGeometry(
    THREE,
    data.dome,
    () => new THREE.SphereGeometry(data.dome.parameters.radius, 12, 8)
  );
  const dome = new THREE.Mesh(domeGeo, ghostMat);
  dome.name = 'ghost_dome';
  dome.position.set(0, 0, 0);
  ghost.add(dome);

  // 2. Flared pleated sheet body with wavy hem (`ghost_body`)
  const bodyGeo = buildPartGeometry(
    THREE,
    data.body,
    () => new THREE.CylinderGeometry(
      data.body.parameters.radiusTop,
      data.body.parameters.radiusBottom,
      data.body.parameters.height,
      12
    )
  );
  const body = new THREE.Mesh(bodyGeo, ghostMat);
  body.name = 'ghost_body';
  body.position.set(0, 0, 0);
  ghost.add(body);

  // 3. Short curved wisp tail (`ghost_wisp`, height = 0.35 <= 0.4)
  const wispGeo = buildPartGeometry(
    THREE,
    data.wisp,
    () => new THREE.ConeGeometry(
      data.wisp.parameters.radius,
      data.wisp.parameters.height,
      10
    )
  );
  const wisp = new THREE.Mesh(wispGeo, ghostMat);
  wisp.name = 'ghost_wisp';
  wisp.position.set(0, 0, 0);
  ghost.add(wisp);

  // 4. Curved front-facing CanvasTexture face decal (`ghost_face_decal`)
  const faceTexture = makeGhostFaceTexture(THREE, { width: 512, height: 512 });
  const decalMat = new THREE.MeshBasicMaterial
    ? new THREE.MeshBasicMaterial({
        map: faceTexture,
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
      })
    : new THREE.MeshStandardMaterial({
        map: faceTexture,
        transparent: true,
        roughness: 0.4,
      });
  const decalGeo = buildPartGeometry(
    THREE,
    data.decal,
    () => new THREE.PlaneGeometry(data.decal.parameters.width, data.decal.parameters.height)
  );
  const faceDecal = new THREE.Mesh(decalGeo, decalMat);
  faceDecal.name = 'ghost_face_decal';
  faceDecal.renderOrder = 2;
  ghost.add(faceDecal);

  // 5. Eye sphere nodes (`ghost_eye`): preserved by default so existing test-3d.mjs
  // assertions (`ghostEyes.length === 2`, `!m.material.transparent`) pass without
  // modification, tucked behind the front face decal inside the dark pupil cores.
  const includeEyeSpheres = options.includeEyeSpheres !== false;
  if (includeEyeSpheres) {
    const eyeMat = new THREE.MeshStandardMaterial({
      color: GHOST_PALETTE.eyeDark,
      roughness: 0.5,
      transparent: false,
    });
    for (const ec of data.eyeCenters) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(ec.radius, 6, 5),
        eyeMat
      );
      eye.name = 'ghost_eye';
      eye.position.set(ec.x, ec.y, ec.z);
      ghost.add(eye);
    }
  }

  // 6. Floating `[MUSE] milo` nametag sprite at y = 1.8 (matching town.js fixture)
  if (options.includeNametag !== false && typeof THREE.Sprite === 'function' && typeof THREE.SpriteMaterial === 'function') {
    const tex = makeNametagTexture(THREE, '[MUSE] milo');
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.name = 'nametag_sprite';
    sprite.position.set(0, 1.8, 0);
    sprite.scale.set(2.0, 0.5, 1);
    ghost.add(sprite);
  }

  // Optional placement on bandstand spot (matches buildMilosGhost in town.js)
  if (options.spot) {
    const { x = 0, y = 0, z = 0 } = options.spot;
    ghost.position.set(x, y, z);
    ghost.rotation.y = Math.atan2(x, z);
  }

  return ghost;
}
