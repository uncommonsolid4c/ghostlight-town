import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ORBIT_GLIDE_MAX_RADIUS,
  stepGlide,
  deriveGlideMaxRadius,
  clampGlideTarget,
  stepOrbitGlide,
  createPointerTracker,
} from './tap-glide.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

test('stepGlide in tap-glide.mjs matches town-3d/town.js verbatim', async () => {
  const [townSrc, tapGlideSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'tap-glide.mjs'), 'utf8'),
  ]);

  const marker = 'export function stepGlide(';
  const start = townSrc.indexOf(marker);
  assert.ok(start !== -1, 'Could not locate stepGlide in town-3d/town.js');
  const endMarker = '\n}\n';
  const end = townSrc.indexOf(endMarker, start);
  assert.ok(end !== -1, 'Could not locate end of stepGlide in town-3d/town.js');

  const verbatimBlock = townSrc.slice(start, end + endMarker.length);
  assert.ok(
    tapGlideSrc.includes(verbatimBlock),
    'staging-polyfork/tap-glide.mjs stepGlide drifted from town-3d/town.js'
  );
});

test('deriveGlideMaxRadius, clampGlideTarget, and stepOrbitGlide keep orbit target on island and move camera by same delta', () => {
  assert.equal(deriveGlideMaxRadius({ width: 128 }), 38);
  assert.equal(deriveGlideMaxRadius(null), DEFAULT_ORBIT_GLIDE_MAX_RADIUS);

  const clamped = clampGlideTarget(60, 0, 38);
  assert.equal(clamped.x, 38);
  assert.equal(clamped.z, 0);

  const noop = stepOrbitGlide({ x: 0, z: 0 }, { x: 0, z: 58 }, { x: 10, z: 0 }, 0);
  assert.deepEqual(noop, { targetX: 0, targetZ: 0, cameraX: 0, cameraZ: 58, arrived: false });

  const step1 = stepOrbitGlide({ x: 0, z: 0 }, { x: 0, z: 58 }, { x: 14, z: 0 }, 0.5, {
    speed: 14,
    maxRadius: 38,
    arriveDist: 0.3,
  });
  assert.equal(step1.targetX, 7);
  assert.equal(step1.targetZ, 0);
  assert.equal(step1.cameraX, 7);
  assert.equal(step1.cameraZ, 58);
  assert.equal(step1.arrived, false);

  const step2 = stepOrbitGlide({ x: step1.targetX, z: step1.targetZ }, { x: step1.cameraX, z: step1.cameraZ }, { x: 14, z: 0 }, 0.5, {
    speed: 14,
    maxRadius: 38,
    arriveDist: 0.3,
  });
  assert.equal(step2.targetX, 14);
  assert.equal(step2.cameraX, 14);
  assert.equal(step2.arrived, true);
});

test('createPointerTracker suppresses click/glide on pinch, >4px drag, pointercancel, and open overlay', () => {
  const tracker = createPointerTracker({ dragThreshold: 4 });

  // Single tap within 4px -> shouldClick: true
  assert.deepEqual(tracker.onPointerDown(1, 100, 100, { pointerType: 'touch' }), {
    started: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(tracker.onPointerMove(1, 103, 102), {
    moved: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(tracker.onPointerUp(1, 103, 102), {
    ended: true,
    shouldClick: true,
  });

  // Drag >4px -> cancels glide and suppresses click
  tracker.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  const dragMove = tracker.onPointerMove(1, 106, 100);
  assert.equal(dragMove.cancelGlide, true);
  assert.deepEqual(tracker.onPointerUp(1, 100, 100), {
    ended: true,
    shouldClick: false,
  });

  // Two-finger pinch -> cancels glide on second pointer and suppresses click even if last finger lifts at start pos
  tracker.onPointerDown(1, 200, 200, { pointerType: 'touch' });
  const pinchDown = tracker.onPointerDown(2, 260, 200, { pointerType: 'touch' });
  assert.equal(pinchDown.isPinch, true);
  assert.equal(pinchDown.cancelGlide, true);
  assert.deepEqual(tracker.onPointerUp(2, 260, 200), { ended: false, shouldClick: false });
  assert.deepEqual(tracker.onPointerUp(1, 200, 200), { ended: true, shouldClick: false });

  // pointercancel -> suppresses click
  tracker.onPointerDown(1, 50, 50, { pointerType: 'touch' });
  assert.deepEqual(tracker.onPointerUp(1, 50, 50, { allowTap: false }), {
    ended: true,
    shouldClick: false,
  });

  // Overlay open -> ignored
  assert.deepEqual(tracker.onPointerDown(1, 50, 50, { overlayHidden: false }), {
    started: false,
    isPinch: false,
    cancelGlide: false,
  });
});

test('staging-polyfork/index.html includes Move-in CTA, footer bar, 44px mobile tap targets, and coarse-pointer hint swap', async () => {
  const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');

  assert.match(html, /id=["']move-in-cta["'][^>]*href=["']move-in\.html["']/);
  assert.match(html, /id=["']footer-bar["']/);
  assert.match(html, /id=["']controls-hint["']/);
  assert.match(html, /href=["']https:\/\/milo\.4167360\.xyz\/["'][^>]*target=["']_blank["'][^>]*rel=["']noopener noreferrer["']/);
  assert.match(html, /\(pointer:\s*coarse\)/);
  assert.match(html, /Tap ground: walk/);

  // 44px minimum tap targets in @media (max-width: 640px)
  const mobileBlock = html.slice(html.indexOf('@media (max-width: 640px)'));
  assert.match(mobileBlock, /#move-in-cta[\s\S]*?min-height:\s*44px/);
  assert.match(mobileBlock, /#prompt-book-toggle[\s\S]*?min-height:\s*44px/);
  assert.match(mobileBlock, /#plot-overlay-close[\s\S]*?min-height:\s*44px/);
});

test('stepGlide handles dt edges, already-at-target, and clamps out-of-bounds targets', () => {
  const pos = { x: 3, z: -4 };
  const target = { x: 10, z: 0 };

  assert.deepEqual(stepGlide(pos, target, 0), { x: 3, z: -4, arrived: false });
  assert.deepEqual(stepGlide(pos, target, -1), { x: 3, z: -4, arrived: false });
  assert.deepEqual(stepGlide(pos, target, Number.NaN), { x: 3, z: -4, arrived: false });

  assert.deepEqual(stepGlide({ x: 5, z: -2 }, { x: 5, z: -2 }, 0.016), {
    x: 5,
    z: -2,
    arrived: true,
  });

  // Target (60, 0) exceeds default maxRadius 28.5 and is clamped before stepping
  assert.deepEqual(stepGlide({ x: 0, z: 0 }, { x: 60, z: 0 }, 10), {
    x: 28.5,
    z: 0,
    arrived: true,
  });
});

test('stepGlide computes partial steps, snaps within arriveDist, and pulls out-of-bounds positions inside maxRadius', () => {
  const partial = stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 1, { speed: 7.5 });
  assert.deepEqual(partial, { x: 7.5, z: 0, arrived: false });

  // maxStep = 7.5 * 2.65 = 19.875 -> remaining 0.125 <= arriveDist (0.3) -> snaps to target
  const snapped = stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 2.65, {
    speed: 7.5,
    arriveDist: 0.3,
  });
  assert.deepEqual(snapped, { x: 20, z: 0, arrived: true });

  // Position starting outside maxRadius is clamped back inside maxRadius on step
  const pulled = stepGlide({ x: 40, z: 0 }, { x: 0, z: 0 }, 0.1, {
    speed: 7.5,
    maxRadius: 28.5,
  });
  assert.ok(Math.abs(pulled.x - 28.5) < 1e-9);
  assert.equal(pulled.z, 0);
  assert.equal(pulled.arrived, false);
});

test('deriveGlideMaxRadius enforces floor, cap, linear middle, and invalid-input fallback', () => {
  assert.equal(DEFAULT_ORBIT_GLIDE_MAX_RADIUS, 38);

  assert.equal(deriveGlideMaxRadius({ width: 128 }), 38);
  assert.equal(deriveGlideMaxRadius({ width: 64 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 200 }), 38);
  assert.equal(deriveGlideMaxRadius({ width: 110 }), 29);

  assert.equal(deriveGlideMaxRadius({ width: 0 }), 38);
  assert.equal(deriveGlideMaxRadius({ width: -50 }), 38);
  assert.equal(deriveGlideMaxRadius({ width: Number.NaN }), 38);
  assert.equal(deriveGlideMaxRadius({ width: undefined }), 38);
  assert.equal(deriveGlideMaxRadius(undefined), 38);
  assert.equal(deriveGlideMaxRadius(null), 38);
});

test('clampGlideTarget handles interior, boundary, diagonal, origin, and custom maxRadius', () => {
  assert.deepEqual(clampGlideTarget(10, -20), { x: 10, z: -20 });
  assert.deepEqual(clampGlideTarget(38, 0), { x: 38, z: 0 });
  assert.deepEqual(clampGlideTarget(-60, 0), { x: -38, z: 0 });

  const diag = clampGlideTarget(30, 30);
  const expectedCoord = 38 / Math.SQRT2;
  assert.ok(Math.abs(diag.x - expectedCoord) < 1e-9);
  assert.ok(Math.abs(diag.z - expectedCoord) < 1e-9);
  assert.ok(Math.abs(Math.hypot(diag.x, diag.z) - 38) < 1e-9);

  assert.deepEqual(clampGlideTarget(0, 0), { x: 0, z: 0 });
  assert.deepEqual(clampGlideTarget(10, 0, 5), { x: 5, z: 0 });
});

test('stepOrbitGlide translates camera by exact target delta on dt=0, arrival, and clamped destination', () => {
  const dtZero = stepOrbitGlide({ x: 2, z: -3 }, { x: 10, z: 45 }, { x: 15, z: 5 }, 0);
  assert.deepEqual(dtZero, {
    targetX: 2,
    targetZ: -3,
    cameraX: 10,
    cameraZ: 45,
    arrived: false,
  });

  const withinArrive = stepOrbitGlide(
    { x: 5, z: -3 },
    { x: 12, z: 40 },
    { x: 5.2, z: -3 },
    0.01,
    { speed: 14, arriveDist: 0.3 }
  );
  assert.deepEqual(withinArrive, {
    targetX: 5.2,
    targetZ: -3,
    cameraX: 12.2,
    cameraZ: 40,
    arrived: true,
  });

  const clamped = stepOrbitGlide(
    { x: 0, z: 0 },
    { x: 5, z: 50 },
    { x: 40, z: 0 },
    5,
    { speed: 14, maxRadius: 20, arriveDist: 0.3 }
  );
  assert.deepEqual(clamped, {
    targetX: 20,
    targetZ: 0,
    cameraX: 25,
    cameraZ: 50,
    arrived: true,
  });
});

test('createPointerTracker handles mouse buttons, reset, unknown ids, multi-touch lift, and 4px threshold', () => {
  const tracker = createPointerTracker({ dragThreshold: 4 });

  // Non-left mouse button with no active pointers is ignored
  assert.deepEqual(tracker.onPointerDown(1, 50, 50, { pointerType: 'mouse', button: 1 }), {
    started: false,
    isPinch: false,
    cancelGlide: false,
  });
  assert.equal(tracker.size, 0);

  // Left mouse button starts normally
  assert.deepEqual(tracker.onPointerDown(1, 50, 50, { pointerType: 'mouse', button: 0 }), {
    started: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.equal(tracker.size, 1);

  // reset() clears state and allows a fresh tap to click
  tracker.reset();
  assert.equal(tracker.size, 0);
  tracker.onPointerDown(2, 10, 10, { pointerType: 'touch' });
  assert.deepEqual(tracker.onPointerUp(2, 10, 10), { ended: true, shouldClick: true });

  // Unknown pointerId returns moved/ended false
  assert.deepEqual(tracker.onPointerMove(999, 20, 20), {
    moved: false,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(tracker.onPointerUp(999, 20, 20), { ended: false, shouldClick: false });

  // Lifting one finger while another is still down returns ended: false
  tracker.onPointerDown(10, 100, 100, { pointerType: 'touch' });
  tracker.onPointerDown(11, 150, 100, { pointerType: 'touch' });
  assert.equal(tracker.size, 2);
  assert.deepEqual(tracker.onPointerUp(11, 150, 100), { ended: false, shouldClick: false });
  assert.equal(tracker.size, 1);
  assert.deepEqual(tracker.onPointerUp(10, 100, 100), { ended: true, shouldClick: false });
  assert.equal(tracker.size, 0);

  // Move of exactly 4px threshold still clicks
  tracker.onPointerDown(20, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(tracker.onPointerMove(20, 104, 100), {
    moved: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(tracker.onPointerUp(20, 104, 100), { ended: true, shouldClick: true });

  // Move of 5px cancels glide and suppresses click
  tracker.onPointerDown(21, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(tracker.onPointerMove(21, 105, 100), {
    moved: true,
    isPinch: false,
    cancelGlide: true,
  });
  assert.deepEqual(tracker.onPointerUp(21, 100, 100), { ended: true, shouldClick: false });
});

test('stepGlide handles Infinity and string dt, zero speed, and arriveDist 0', () => {
  assert.deepEqual(stepGlide({ x: 3, z: -4 }, { x: 10, z: 0 }, Infinity), {
    x: 3,
    z: -4,
    arrived: false,
  });
  assert.deepEqual(stepGlide({ x: 3, z: -4 }, { x: 10, z: 0 }, '0.5'), {
    x: 3,
    z: -4,
    arrived: false,
  });
  assert.deepEqual(stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 1, { speed: 0 }), {
    x: 0,
    z: 0,
    arrived: false,
  });
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 5, z: 0 }, 1, { speed: 7.5, arriveDist: 0 }),
    { x: 5, z: 0, arrived: true }
  );
  // 0.125 remainder does NOT snap with arriveDist: 0 (unlike the 0.3 default)
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 2.65, { speed: 7.5, arriveDist: 0 }),
    { x: 19.875, z: 0, arrived: false }
  );
});

test('stepOrbitGlide uses default speed 14 and radius 38, and ignores negative dt', () => {
  assert.deepEqual(stepOrbitGlide({ x: 0, z: 0 }, { x: 0, z: 58 }, { x: 14, z: 0 }, 0.5), {
    targetX: 7,
    targetZ: 0,
    cameraX: 7,
    cameraZ: 58,
    arrived: false,
  });
  assert.deepEqual(stepOrbitGlide({ x: 0, z: 0 }, { x: 5, z: 50 }, { x: 60, z: 0 }, 5), {
    targetX: 38,
    targetZ: 0,
    cameraX: 43,
    cameraZ: 50,
    arrived: true,
  });
  assert.deepEqual(stepOrbitGlide({ x: 2, z: -3 }, { x: 10, z: 45 }, { x: 15, z: 5 }, -0.5), {
    targetX: 2,
    targetZ: -3,
    cameraX: 10,
    cameraZ: 45,
    arrived: false,
  });
});

test('createPointerTracker honors a custom dragThreshold and the 4px default', () => {
  const custom = createPointerTracker({ dragThreshold: 10 });
  custom.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(custom.onPointerMove(1, 108, 100), {
    moved: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(custom.onPointerUp(1, 108, 100), { ended: true, shouldClick: true });

  const customDrag = createPointerTracker({ dragThreshold: 10 });
  customDrag.onPointerDown(2, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(customDrag.onPointerMove(2, 111, 100), {
    moved: true,
    isPinch: false,
    cancelGlide: true,
  });
  assert.deepEqual(customDrag.onPointerUp(2, 100, 100), { ended: true, shouldClick: false });

  const def = createPointerTracker();
  def.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(def.onPointerMove(1, 105, 100), {
    moved: true,
    isPinch: false,
    cancelGlide: true,
  });
});

test('createPointerTracker move during a pinch cancels glide and suppresses the tap', () => {
  const tracker = createPointerTracker();
  tracker.onPointerDown(1, 200, 200, { pointerType: 'touch' });
  tracker.onPointerDown(2, 260, 200, { pointerType: 'touch' });
  assert.deepEqual(tracker.onPointerMove(1, 205, 200), {
    moved: true,
    isPinch: true,
    cancelGlide: true,
  });
  assert.deepEqual(tracker.onPointerUp(2, 260, 200), { ended: false, shouldClick: false });
  assert.deepEqual(tracker.onPointerUp(1, 205, 200), { ended: true, shouldClick: false });

  tracker.onPointerDown(3, 50, 50, { pointerType: 'touch' });
  assert.deepEqual(tracker.onPointerUp(3, 50, 50), { ended: true, shouldClick: true });
});

test('createPointerTracker suppresses taps while the overlay is open at move and up', () => {
  const tracker = createPointerTracker();
  tracker.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(tracker.onPointerMove(1, 101, 101, { overlayHidden: false }), {
    moved: false,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(tracker.onPointerUp(1, 101, 101, { overlayHidden: false }), {
    ended: true,
    shouldClick: false,
  });

  // Current behavior (pinned as-is): a move while the overlay is open does not mark a drag,
  // so if the overlay closes before pointerup the tap still clicks.
  const tracker2 = createPointerTracker();
  tracker2.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  tracker2.onPointerMove(1, 101, 101, { overlayHidden: false });
  assert.deepEqual(tracker2.onPointerUp(1, 101, 101, { overlayHidden: true }), {
    ended: true,
    shouldClick: true,
  });
});

test('createPointerTracker reset mid-gesture clears the pointer and a third finger is a pinch', () => {
  const tracker = createPointerTracker();
  tracker.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  tracker.reset();
  assert.equal(tracker.size, 0);
  assert.deepEqual(tracker.onPointerUp(1, 100, 100), { ended: false, shouldClick: false });

  tracker.onPointerDown(9, 10, 10, { pointerType: 'touch' });
  assert.deepEqual(tracker.onPointerUp(9, 10, 10), { ended: true, shouldClick: true });

  tracker.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  tracker.onPointerDown(2, 150, 100, { pointerType: 'touch' });
  assert.deepEqual(tracker.onPointerDown(3, 300, 200, { pointerType: 'touch' }), {
    started: true,
    isPinch: true,
    cancelGlide: true,
  });
  assert.equal(tracker.size, 3);
  assert.deepEqual(tracker.onPointerUp(3, 300, 200), { ended: false, shouldClick: false });
  assert.deepEqual(tracker.onPointerUp(2, 150, 100), { ended: false, shouldClick: false });
  assert.deepEqual(tracker.onPointerUp(1, 100, 100), { ended: true, shouldClick: false });
});

test('stepGlide steps diagonally with exact direction and clamps a diagonal out-of-bounds target', () => {
  const partialDiag = stepGlide({ x: 0, z: 0 }, { x: 30, z: 40 }, 1, { speed: 7.5 });
  assert.ok(Math.abs(partialDiag.x - 4.5) < 1e-9);
  assert.ok(Math.abs(partialDiag.z - 6) < 1e-9);
  assert.equal(partialDiag.arrived, false);

  const clampedDiag = stepGlide({ x: 0, z: 0 }, { x: 60, z: 80 }, 10);
  assert.ok(Math.abs(clampedDiag.x - 17.1) < 1e-9);
  assert.ok(Math.abs(clampedDiag.z - 22.8) < 1e-9);
  assert.equal(clampedDiag.arrived, true);
});

test('stepGlide boundary conditions: dist equals maxStep, remainder equals arriveDist, target exactly at maxRadius', () => {
  assert.deepEqual(stepGlide({ x: 0, z: 0 }, { x: 7.5, z: 0 }, 1, { speed: 7.5 }), {
    x: 7.5,
    z: 0,
    arrived: true,
  });
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 1.9, { speed: 10, arriveDist: 1 }),
    { x: 20, z: 0, arrived: true }
  );
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 1.9, { speed: 10, arriveDist: 0.9 }),
    { x: 19, z: 0, arrived: false }
  );
  assert.deepEqual(stepGlide({ x: 0, z: 0 }, { x: 28.5, z: 0 }, 10), {
    x: 28.5,
    z: 0,
    arrived: true,
  });
});

test('stepGlide with out-of-bounds position and target, and negative speed', () => {
  assert.deepEqual(
    stepGlide({ x: 60, z: 0 }, { x: 60, z: 0 }, 1, { speed: 7.5, maxRadius: 28.5 }),
    { x: 28.5, z: 0, arrived: true }
  );
  assert.deepEqual(stepGlide({ x: 0, z: 0 }, { x: 10, z: 0 }, 1, { speed: -7.5 }), {
    x: -7.5,
    z: 0,
    arrived: false,
  });
});

test('deriveGlideMaxRadius floor boundary and non-numeric widths', () => {
  assert.equal(deriveGlideMaxRadius({ width: 109 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 108 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 120 }), 34);
  assert.equal(deriveGlideMaxRadius({ width: '128' }), 38);
  assert.equal(deriveGlideMaxRadius({}), 38);
  assert.equal(deriveGlideMaxRadius({ width: 128.5 }), 38);
});

test('stepOrbitGlide arrival at origin, negative-delta snap, and camera follows exactly', () => {
  assert.deepEqual(stepOrbitGlide({ x: 0, z: 0 }, { x: 3, z: 40 }, { x: 0, z: 0 }, 0.5), {
    targetX: 0,
    targetZ: 0,
    cameraX: 3,
    cameraZ: 40,
    arrived: true,
  });
  assert.deepEqual(
    stepOrbitGlide({ x: 5, z: 5 }, { x: 10, z: 10 }, { x: -5, z: -5 }, 1, { speed: 14 }),
    { targetX: -5, targetZ: -5, cameraX: 0, cameraZ: 0, arrived: true }
  );
});

test('createPointerTracker second-pointer right mouse is a pinch, pen starts, sequential taps reset', () => {
  const tracker = createPointerTracker();
  tracker.onPointerDown(1, 100, 100, { pointerType: 'mouse', button: 0 });
  assert.deepEqual(tracker.onPointerDown(2, 120, 100, { pointerType: 'mouse', button: 2 }), {
    started: true,
    isPinch: true,
    cancelGlide: true,
  });
  assert.deepEqual(tracker.onPointerUp(2, 120, 100), { ended: false, shouldClick: false });
  assert.deepEqual(tracker.onPointerUp(1, 100, 100), { ended: true, shouldClick: false });

  const penTracker = createPointerTracker();
  assert.deepEqual(penTracker.onPointerDown(1, 50, 50, { pointerType: 'pen' }), {
    started: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(penTracker.onPointerUp(1, 50, 50), { ended: true, shouldClick: true });

  const seqTracker = createPointerTracker();
  seqTracker.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  seqTracker.onPointerMove(1, 120, 100);
  assert.deepEqual(seqTracker.onPointerUp(1, 120, 100), { ended: true, shouldClick: false });
  seqTracker.onPointerDown(2, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(seqTracker.onPointerUp(2, 100, 100), { ended: true, shouldClick: true });
});

test('stepGlide snaps to the target from far away when arriveDist covers the remaining distance', () => {
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 5, z: 0 }, 0.1, { speed: 7.5, arriveDist: 5 }),
    { x: 5, z: 0, arrived: true }
  );
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 5, z: 0 }, 0.1, { speed: 7.5 }),
    { x: 0.75, z: 0, arrived: false }
  );
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: -5, z: 0 }, 0.1, { speed: 7.5, arriveDist: 5 }),
    { x: -5, z: 0, arrived: true }
  );
});

test('stepGlide collapses an out-of-bounds position onto a clamped target and arrives, and clamps a negative diagonal', () => {
  assert.deepEqual(
    stepGlide({ x: 60, z: 0 }, { x: 60, z: 0 }, 1, { speed: 7.5, maxRadius: 28.5 }),
    { x: 28.5, z: 0, arrived: true }
  );

  const negDiag = stepGlide({ x: 0, z: 0 }, { x: -60, z: -80 }, 10);
  assert.ok(Math.abs(negDiag.x - -17.1) < 1e-9);
  assert.ok(Math.abs(negDiag.z - -22.8) < 1e-9);
  assert.equal(negDiag.arrived, true);

  assert.deepEqual(
    stepGlide({ x: -28.5, z: 0 }, { x: -60, z: 0 }, 10),
    { x: -28.5, z: 0, arrived: true }
  );
});

test('deriveGlideMaxRadius linear middle values, cap above 128, and Infinity fallback', () => {
  assert.equal(deriveGlideMaxRadius({ width: 116 }), 32);
  assert.equal(deriveGlideMaxRadius({ width: 113 }), 30.5);
  assert.equal(deriveGlideMaxRadius({ width: 111 }), 29.5);
  assert.equal(deriveGlideMaxRadius({ width: 129 }), 38);
  assert.equal(deriveGlideMaxRadius({ width: 130 }), 38);
  assert.equal(deriveGlideMaxRadius({ width: 140 }), 38);
  assert.equal(deriveGlideMaxRadius({ width: Infinity }), 38);
});

test('clampGlideTarget zero radius, negative diagonal, and custom-radius interior', () => {
  assert.deepEqual(clampGlideTarget(10, 0, 0), { x: 0, z: 0 });

  const negDiag = clampGlideTarget(-30, -30, 38);
  const expected = -38 / Math.SQRT2;
  assert.ok(Math.abs(negDiag.x - expected) < 1e-9);
  assert.ok(Math.abs(negDiag.z - expected) < 1e-9);
  assert.ok(Math.abs(Math.hypot(negDiag.x, negDiag.z) - 38) < 1e-9);

  assert.deepEqual(clampGlideTarget(3, 4, 10), { x: 3, z: 4 });
  assert.deepEqual(clampGlideTarget(-60, 0, 20), { x: -20, z: 0 });
});

test('stepOrbitGlide translates the camera diagonally by the exact step delta, holds still on invalid dt, and moves it by the snap delta on arrival', () => {
  const diag = stepOrbitGlide({ x: 0, z: 0 }, { x: 100, z: -50 }, { x: 30, z: 40 }, 1, {
    speed: 14,
  });
  assert.ok(Math.abs(diag.targetX - 8.4) < 1e-9);
  assert.ok(Math.abs(diag.targetZ - 11.2) < 1e-9);
  assert.ok(Math.abs(diag.cameraX - 108.4) < 1e-9);
  assert.ok(Math.abs(diag.cameraZ - -38.8) < 1e-9);
  assert.equal(diag.arrived, false);

  assert.deepEqual(
    stepOrbitGlide({ x: 2, z: -3 }, { x: 10, z: 45 }, { x: 15, z: 5 }, NaN),
    { targetX: 2, targetZ: -3, cameraX: 10, cameraZ: 45, arrived: false }
  );

  assert.deepEqual(
    stepOrbitGlide({ x: 0, z: 0 }, { x: 10, z: 20 }, { x: 0.2, z: 0 }, 1, { speed: 14 }),
    { targetX: 0.2, targetZ: 0, cameraX: 10.2, cameraZ: 20, arrived: true }
  );
});

test('createPointerTracker ignores an overlay-open second pointer so the tap still clicks, and reset mid-pinch clears cleanly', () => {
  const tracker = createPointerTracker();
  tracker.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(
    tracker.onPointerDown(2, 200, 200, { pointerType: 'touch', overlayHidden: false }),
    { started: false, isPinch: false, cancelGlide: false }
  );
  assert.equal(tracker.size, 1);
  assert.deepEqual(tracker.onPointerUp(2, 200, 200), { ended: false, shouldClick: false });
  assert.deepEqual(tracker.onPointerUp(1, 100, 100), { ended: true, shouldClick: true });

  const pinchTracker = createPointerTracker();
  pinchTracker.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  pinchTracker.onPointerDown(2, 150, 100, { pointerType: 'touch' });
  assert.equal(pinchTracker.size, 2);
  pinchTracker.reset();
  assert.equal(pinchTracker.size, 0);
  assert.deepEqual(pinchTracker.onPointerUp(1, 100, 100), { ended: false, shouldClick: false });
  pinchTracker.onPointerDown(3, 50, 50, { pointerType: 'touch' });
  assert.deepEqual(pinchTracker.onPointerUp(3, 50, 50), { ended: true, shouldClick: true });
});

test('staging.js imports exactly the four tap-glide helpers it uses', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const match = stagingSrc.match(/import \{([^}]*)\} from '\.\/tap-glide\.mjs';/);
  assert.ok(match, 'Could not locate tap-glide.mjs import block in staging.js');
  assert.equal(
    match[1],
    '\n  deriveGlideMaxRadius,\n  clampGlideTarget,\n  stepOrbitGlide,\n  createPointerTracker,\n'
  );
  assert.ok(!/\bstepGlide\b/.test(match[1]));
  assert.ok(!match[1].includes('DEFAULT_ORBIT_GLIDE_MAX_RADIUS'));
  assert.ok(!stagingSrc.includes('DEFAULT_ORBIT_GLIDE_MAX_RADIUS'));
});

test('staging.js wires tap-glide drag threshold, radius, speed, cancel, and gates', async () => {
  const [stagingSrc, tapGlideSrc, indexHtml] = await Promise.all([
    fs.readFile(path.join(__dirname, 'staging.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'tap-glide.mjs'), 'utf8'),
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8'),
  ]);

  assert.ok(stagingSrc.includes('createPointerTracker({ dragThreshold: 4 })'));
  assert.ok(stagingSrc.includes('deriveGlideMaxRadius(camp.terrain?.userData?.terrain)'));
  assert.ok(stagingSrc.includes('{ speed: 14, maxRadius: glideMaxRadius, arriveDist: 0.3 }'));
  assert.ok(stagingSrc.includes('const dt = Math.min(clock.getDelta(), 0.1);'));
  assert.equal(
    stagingSrc.split('if (res.cancelGlide) {\n      glideTarget = null;\n    }').length - 1,
    2
  );
  assert.ok(
    stagingSrc.includes("window.addEventListener('pointercancel', (e) => finishPointer(e, false));")
  );
  assert.ok(stagingSrc.includes("if (!hitClickable && e.pointerType === 'touch') {"));
  assert.ok(
    stagingSrc.includes(
      'if (glideTarget && (!plotOverlayEl || plotOverlayEl.hidden) && !interiorVisit.isInside()) {'
    )
  );
  assert.ok(stagingSrc.includes('glideTarget = null;\n    pointerTracker.reset();'));
  assert.ok(!stagingSrc.includes('pinchFov'));
  assert.ok(!tapGlideSrc.includes('pinchFov'));
  assert.ok(!indexHtml.includes('pinchFov'));
});

test('stepGlide loop glides 20 m in 158 frames, monotonic, inside maxRadius', () => {
  let pos = { x: 0, z: 0 };
  let steps = 0;
  let maxR = 0;
  let prevX = 0;
  let arrived = false;

  for (let i = 1; i <= 500; i += 1) {
    const next = stepGlide(pos, { x: 20, z: 0 }, 1 / 60, { speed: 7.5 });
    assert.ok(next.x >= prevX - 1e-12);
    prevX = next.x;
    maxR = Math.max(maxR, Math.hypot(next.x, next.z));
    pos = { x: next.x, z: next.z };
    steps = i;
    if (next.arrived) {
      arrived = true;
      break;
    }
  }

  assert.equal(arrived, true);
  assert.equal(steps, 158);
  assert.deepEqual(pos, { x: 20, z: 0 });
  assert.ok(maxR <= 28.5);
});

test('stepOrbitGlide glides to the clamped target in 3 steps with the camera offset invariant', () => {
  let target = { x: 0, z: 0 };
  let camera = { x: 100, z: -50 };
  let steps = 0;
  let arrived = false;

  for (let i = 1; i <= 100; i += 1) {
    const next = stepOrbitGlide(target, camera, { x: 30, z: 40 }, 1, { speed: 14 });
    assert.ok(Math.abs(next.cameraX - next.targetX - 100) < 1e-9);
    assert.ok(Math.abs(next.cameraZ - next.targetZ - -50) < 1e-9);
    target = { x: next.targetX, z: next.targetZ };
    camera = { x: next.cameraX, z: next.cameraZ };
    steps = i;
    if (next.arrived) {
      arrived = true;
      break;
    }
  }

  assert.equal(arrived, true);
  assert.equal(steps, 3);
  assert.ok(Math.abs(target.x - 22.8) < 1e-9);
  assert.ok(Math.abs(target.z - 30.4) < 1e-9);
  assert.ok(Math.abs(camera.x - 122.8) < 1e-9);
  assert.ok(Math.abs(camera.z - -19.6) < 1e-9);
});

test('stepGlide handles zero radius, Infinity and NaN targets, and negative maxRadius', () => {
  assert.deepEqual(
    stepGlide({ x: 3, z: -4 }, { x: 10, z: 0 }, 1, { maxRadius: 0 }),
    { x: 0, z: 0, arrived: true }
  );

  const infRes = stepGlide({ x: 0, z: 0 }, { x: Infinity, z: 0 }, 1);
  assert.ok(Number.isNaN(infRes.x));
  assert.ok(Number.isNaN(infRes.z));
  assert.equal(infRes.arrived, false);

  const nanRes = stepGlide({ x: 0, z: 0 }, { x: NaN, z: 0 }, 1);
  assert.ok(Number.isNaN(nanRes.x));
  assert.ok(Number.isNaN(nanRes.z));
  assert.equal(nanRes.arrived, false);

  const negRes = stepGlide({ x: 3, z: -4 }, { x: 10, z: 0 }, 1, { speed: 7.5, maxRadius: -5 });
  assert.ok(Number.isFinite(negRes.x) && Number.isFinite(negRes.z));
  assert.ok(Math.abs(negRes.x - 4.925835939721843) < 1e-9);
  assert.ok(Math.abs(negRes.z - 0.8579861857539625) < 1e-9);
  assert.equal(negRes.arrived, false);
});

test('deriveGlideMaxRadius linear middle values at half-metre widths', () => {
  assert.equal(deriveGlideMaxRadius({ width: 109.5 }), 28.75);
  assert.ok(Math.abs(deriveGlideMaxRadius({ width: 109.9 }) - 28.95) < 1e-9);
  assert.equal(deriveGlideMaxRadius({ width: 111.5 }), 29.75);
  assert.equal(deriveGlideMaxRadius({ width: 127 }), 37.5);
  assert.ok(Math.abs(deriveGlideMaxRadius({ width: 127.9 }) - 37.95) < 1e-9);
});

test('clampGlideTarget handles Infinity radius, negative radius, and NaN inputs', () => {
  assert.deepEqual(clampGlideTarget(100, 0, Infinity), { x: 100, z: 0 });

  const neg = clampGlideTarget(10, 0, -5);
  assert.ok(neg.x === -5);
  assert.ok(neg.z === 0);

  const nanPos = clampGlideTarget(NaN, 0);
  assert.ok(Number.isNaN(nanPos.x));
  assert.ok(nanPos.z === 0);

  assert.deepEqual(clampGlideTarget(10, 0, NaN), { x: 10, z: 0 });
});

test('createPointerTracker defaults, overlay-open first down, and unknown-id move while active', () => {
  const defaultTracker = createPointerTracker();
  assert.deepEqual(defaultTracker.onPointerDown(1, 50, 50), {
    started: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(defaultTracker.onPointerUp(1, 50, 50), {
    ended: true,
    shouldClick: true,
  });

  const overlayTracker = createPointerTracker();
  assert.deepEqual(overlayTracker.onPointerDown(1, 50, 50, { overlayHidden: false }), {
    started: false,
    isPinch: false,
    cancelGlide: false,
  });
  assert.equal(overlayTracker.size, 0);
  assert.deepEqual(overlayTracker.onPointerUp(1, 50, 50), {
    ended: false,
    shouldClick: false,
  });
  assert.deepEqual(overlayTracker.onPointerDown(2, 60, 60, { pointerType: 'touch' }), {
    started: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(overlayTracker.onPointerUp(2, 60, 60), {
    ended: true,
    shouldClick: true,
  });

  const unknownTracker = createPointerTracker();
  unknownTracker.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(unknownTracker.onPointerMove(999, 120, 100), {
    moved: false,
    isPinch: false,
    cancelGlide: false,
  });
  assert.equal(unknownTracker.size, 1);
});

test('createPointerTracker zero threshold and Y-only drag threshold', () => {
  const zeroTracker = createPointerTracker({ dragThreshold: 0 });
  zeroTracker.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(zeroTracker.onPointerMove(1, 101, 100), {
    moved: true,
    isPinch: false,
    cancelGlide: true,
  });

  const zeroClick = createPointerTracker({ dragThreshold: 0 });
  zeroClick.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(zeroClick.onPointerUp(1, 100, 100), {
    ended: true,
    shouldClick: true,
  });

  const yExact = createPointerTracker();
  yExact.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(yExact.onPointerMove(1, 100, 104), {
    moved: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(yExact.onPointerUp(1, 100, 104), {
    ended: true,
    shouldClick: true,
  });

  const yOver = createPointerTracker();
  yOver.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(yOver.onPointerMove(1, 100, 105), {
    moved: true,
    isPinch: false,
    cancelGlide: true,
  });
  assert.deepEqual(yOver.onPointerUp(1, 100, 100), {
    ended: true,
    shouldClick: false,
  });
});

test('staging-polyfork README 65c and index.html tap hints match the live files', async () => {
  const [readmeSrc, indexHtml, tapGlideSrc, townSrc] = await Promise.all([
    fs.readFile(path.join(__dirname, 'README.md'), 'utf8'),
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8'),
    fs.readFile(path.join(__dirname, 'tap-glide.mjs'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
  ]);

  assert.ok(readmeSrc.includes('38 m on the span-2 128 m island'));
  assert.ok(readmeSrc.includes('4 px drag threshold'));
  assert.ok(readmeSrc.includes('`pinchFov` is'));
  assert.ok(readmeSrc.includes('deliberately not ported because OrbitControls handles pinch as dolly'));

  const vMatch = indexHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(vMatch, 'Could not locate staging.js?v= in index.html');
  const bulletStart = readmeSrc.indexOf('`tap-glide.mjs` (65c)');
  assert.ok(bulletStart !== -1, 'Could not locate 65c bullet in staging-polyfork/README.md');
  assert.ok(readmeSrc.slice(bulletStart).includes('(`?v=' + vMatch[1] + '`)'));

  const header = tapGlideSrc.split('\n').slice(0, 5).join('\n');
  const lineMatch = header.match(/lines (\d+)-(\d+)/);
  assert.ok(lineMatch, 'Could not locate line range in tap-glide.mjs header');
  const startIdx = townSrc.indexOf('export function stepGlide(');
  assert.ok(startIdx !== -1, 'Could not locate stepGlide in town-3d/town.js');
  const endIdx = townSrc.indexOf('\n}\n', startIdx);
  assert.ok(endIdx !== -1, 'Could not locate end of stepGlide in town-3d/town.js');
  const startLine = townSrc.slice(0, startIdx).split('\n').length;
  const endLine = townSrc.slice(0, endIdx).split('\n').length + 1;
  assert.equal(Number(lineMatch[1]), startLine);
  assert.equal(Number(lineMatch[2]), endLine);

  assert.ok(
    indexHtml.includes(
      'Drag: orbit &middot; Scroll / Pinch: zoom &middot; WASD / Arrows: pan &middot; Tap ground: glide &middot; Click: inspect'
    )
  );
  assert.ok(
    indexHtml.includes(
      'Tap ground: walk \\u00b7 Drag: look \\u00b7 Pinch: zoom \\u00b7 Tap: inspect'
    )
  );
  assert.ok(
    indexHtml.includes(
      'Tap ground to glide; tap a cottage, newsstand, Inn, or gatehouse to inspect.'
    )
  );
});

test('stepGlide pulls an out-of-bounds position inside the radius while stepping', () => {
  // The 28.5 clamp lands at 28.499999999999996 in floating point, so use a 1e-9 band.
  const a = stepGlide({ x: 40, z: 0 }, { x: 10, z: 0 }, 1, { speed: 7.5 });
  assert.ok(Math.abs(a.x - 28.5) < 1e-9);
  assert.equal(a.z, 0);
  assert.equal(a.arrived, false);
  const b = stepGlide({ x: 40, z: 0 }, { x: 10, z: 0 }, 0.1, { speed: 7.5 });
  assert.ok(Math.abs(b.x - 28.5) < 1e-9);
  assert.equal(b.z, 0);
  assert.equal(b.arrived, false);
  const diag = stepGlide({ x: 30, z: 40 }, { x: 0, z: 0 }, 1, { speed: 7.5 });
  assert.ok(Math.abs(diag.x - 17.1) < 1e-9);
  assert.ok(Math.abs(diag.z - 22.8) < 1e-9);
  assert.equal(diag.arrived, false);
  assert.deepEqual(stepGlide({ x: 5, z: 5 }, { x: 15, z: 5 }, 1, { speed: 7.5 }), {
    x: 12.5,
    z: 5,
    arrived: false,
  });
  // From (40, 0) toward (0, 0) at 7.5 m/s for 2 s the position steps 15 m to 25,
  // already inside 28.5 — no clamp fires, rem 25 > 0.3.
  assert.deepEqual(stepGlide({ x: 40, z: 0 }, { x: 0, z: 0 }, 2, { speed: 7.5 }), {
    x: 25,
    z: 0,
    arrived: false,
  });
});

test('deriveGlideMaxRadius floor widths and non-object inputs', () => {
  // Widths 100–108.1 all sit on the 28.5 floor (width/2 − 26 < 28.5); the floor
  // boundary is width 109 (existing test); 112–126 are the linear middle.
  assert.equal(deriveGlideMaxRadius({ width: 100 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 104 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 105 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 106 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 107 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 107.9 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 108.1 }), 28.5);
  assert.equal(deriveGlideMaxRadius({ width: 112 }), 30);
  assert.equal(deriveGlideMaxRadius({ width: 115 }), 31.5);
  assert.equal(deriveGlideMaxRadius({ width: 118 }), 33);
  assert.equal(deriveGlideMaxRadius({ width: 119 }), 33.5);
  assert.equal(deriveGlideMaxRadius({ width: 121 }), 34.5);
  assert.equal(deriveGlideMaxRadius({ width: 122 }), 35);
  assert.equal(deriveGlideMaxRadius({ width: 125 }), 36.5);
  assert.equal(deriveGlideMaxRadius({ width: 126 }), 37);
  assert.equal(deriveGlideMaxRadius({ width: 128.5 }), 38);
  // Non-object / width-less inputs all fall back to the 38 m default.
  assert.equal(deriveGlideMaxRadius(128), 38);
  assert.equal(deriveGlideMaxRadius('128'), 38);
  assert.equal(deriveGlideMaxRadius({ width: null }), 38);
  assert.equal(deriveGlideMaxRadius({ width: 'abc' }), 38);
  assert.equal(deriveGlideMaxRadius(true), 38);
  assert.equal(deriveGlideMaxRadius(0), 38);
  assert.equal(deriveGlideMaxRadius([]), 38);
});

test('clampGlideTarget zero radius diagonal and NaN inputs', () => {
  assert.deepEqual(clampGlideTarget(5, 0, 0), { x: 0, z: 0 });
  assert.deepEqual(clampGlideTarget(0, 5, 0), { x: 0, z: 0 });
  assert.deepEqual(clampGlideTarget(-38, 0), { x: -38, z: 0 });
  assert.deepEqual(clampGlideTarget(0, -38), { x: 0, z: -38 });
  assert.deepEqual(clampGlideTarget(3, 4, 5), { x: 3, z: 4 });
  assert.deepEqual(clampGlideTarget(1, 1, 5), { x: 1, z: 1 });
  const onDiag = clampGlideTarget(38, 38);
  assert.ok(Math.abs(onDiag.x - 38 / Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(onDiag.z - 38 / Math.SQRT2) < 1e-9);
  const farDiag = clampGlideTarget(100, 100, 38);
  assert.ok(Math.abs(farDiag.x - 38 / Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(farDiag.z - 38 / Math.SQRT2) < 1e-9);
  const negDiag = clampGlideTarget(-100, -100, 38);
  assert.ok(Math.abs(negDiag.x - -38 / Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(negDiag.z - -38 / Math.SQRT2) < 1e-9);
  const nanBoth = clampGlideTarget(NaN, NaN);
  assert.ok(Number.isNaN(nanBoth.x));
  assert.ok(Number.isNaN(nanBoth.z));
  const nanZ = clampGlideTarget(10, NaN);
  assert.equal(nanZ.x, 10);
  assert.ok(Number.isNaN(nanZ.z));
});

test('stepOrbitGlide Infinity dt zero speed and large arriveDist snap', () => {
  assert.deepEqual(
    stepOrbitGlide({ x: 2, z: -3 }, { x: 10, z: 45 }, { x: 15, z: 5 }, Infinity),
    { targetX: 2, targetZ: -3, cameraX: 10, cameraZ: 45, arrived: false }
  );
  assert.deepEqual(
    stepOrbitGlide({ x: 0, z: 0 }, { x: 5, z: 50 }, { x: 14, z: 0 }, 1, { speed: 0 }),
    { targetX: 0, targetZ: 0, cameraX: 5, cameraZ: 50, arrived: false }
  );
  assert.deepEqual(
    stepOrbitGlide({ x: 5, z: 5 }, { x: 10, z: 10 }, { x: 5, z: 5 }, 1, { speed: 0 }),
    { targetX: 5, targetZ: 5, cameraX: 10, cameraZ: 10, arrived: true }
  );
  // The (30, 40) target is clamped to the 38 m radius (22.8, 30.4) BEFORE the
  // 50 m arriveDist snaps — the snap lands on the clamped target, not (30, 40).
  assert.deepEqual(
    stepOrbitGlide({ x: 0, z: 0 }, { x: 100, z: -50 }, { x: 30, z: 40 }, 0.1, {
      speed: 14,
      arriveDist: 50,
    }),
    { targetX: 22.8, targetZ: 30.4, cameraX: 122.8, cameraZ: -19.6, arrived: true }
  );
  // The (30, 40) target clamps to (12, 16) at radius 20, but one 14 m step only
  // covers 14 of those 20 m — the step lands at (8.4, 11.2), not the target.
  const partial = stepOrbitGlide({ x: 0, z: 0 }, { x: 100, z: -50 }, { x: 30, z: 40 }, 1, {
    speed: 14,
    maxRadius: 20,
  });
  assert.ok(Math.abs(partial.targetX - 8.4) < 1e-9);
  assert.ok(Math.abs(partial.targetZ - 11.2) < 1e-9);
  assert.ok(Math.abs(partial.cameraX - 108.4) < 1e-9);
  assert.ok(Math.abs(partial.cameraZ - -38.8) < 1e-9);
  assert.equal(partial.arrived, false);
});

test('createPointerTracker same-id re-down diagonal threshold and button defaults', () => {
  // Re-down with the same pointerId resets downPos (size stays 1) — the next
  // move/up are judged against the NEW down position, not the first one.
  const tracker = createPointerTracker();
  assert.deepEqual(tracker.onPointerDown(1, 100, 100, { pointerType: 'touch' }), {
    started: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(tracker.onPointerDown(1, 120, 100, { pointerType: 'touch' }), {
    started: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.equal(tracker.size, 1);
  assert.deepEqual(tracker.onPointerMove(1, 121, 100), {
    moved: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(tracker.onPointerUp(1, 121, 100), { ended: true, shouldClick: true });

  // Diagonal threshold: (3, 3) is within 4 px on both axes and still clicks;
  // (3, 5) exceeds on Y and cancels the glide.
  const diag = createPointerTracker();
  diag.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(diag.onPointerMove(1, 103, 103), {
    moved: true,
    isPinch: false,
    cancelGlide: false,
  });
  assert.deepEqual(diag.onPointerUp(1, 103, 103), { ended: true, shouldClick: true });
  diag.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(diag.onPointerMove(1, 103, 105), {
    moved: true,
    isPinch: false,
    cancelGlide: true,
  });
  assert.deepEqual(diag.onPointerUp(1, 103, 105), { ended: true, shouldClick: false });

  // Mouse button defaults to 0 (left) so a bare mouse down starts; the button
  // check applies to mouse only, so a touch down with button 1 still starts.
  const mouse = createPointerTracker();
  assert.deepEqual(mouse.onPointerDown(1, 50, 50, { pointerType: 'mouse' }), {
    started: true,
    isPinch: false,
    cancelGlide: false,
  });
  const touchButton = createPointerTracker();
  assert.deepEqual(touchButton.onPointerDown(1, 50, 50, { pointerType: 'touch', button: 1 }), {
    started: true,
    isPinch: false,
    cancelGlide: false,
  });

  // Overlay opening between down and up (no move) still suppresses the tap.
  const overlay = createPointerTracker();
  overlay.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(overlay.onPointerUp(1, 100, 100, { overlayHidden: false }), {
    ended: true,
    shouldClick: false,
  });
});

test('glide loops frame counts for stepGlide and stepOrbitGlide', () => {
  // Orbit glide: 14 m at 14 m/s, dt 1/60 -> 0.2333 m/frame; the 0.3 arriveDist
  // snaps on frame 59 (13.7667 m, rem 0.2333 <= 0.3).
  let target = { x: 0, z: 0 };
  let camera = { x: 0, z: 58 };
  let steps = 0;
  let arrived = false;
  for (let i = 1; i <= 200; i += 1) {
    const next = stepOrbitGlide(target, camera, { x: 14, z: 0 }, 1 / 60, { speed: 14 });
    target = { x: next.targetX, z: next.targetZ };
    camera = { x: next.cameraX, z: next.cameraZ };
    steps = i;
    if (next.arrived) {
      arrived = true;
      break;
    }
  }
  assert.equal(arrived, true);
  assert.equal(steps, 59);
  assert.deepEqual(target, { x: 14, z: 0 });
  assert.deepEqual(camera, { x: 14, z: 58 });

  // Walk glide: 20 m at 7.5 m/s, dt 1/30 -> 0.25 m/frame; snaps on frame 79.
  let pos = { x: 0, z: 0 };
  steps = 0;
  arrived = false;
  for (let i = 1; i <= 500; i += 1) {
    const next = stepGlide(pos, { x: 20, z: 0 }, 1 / 30, { speed: 7.5 });
    pos = { x: next.x, z: next.z };
    steps = i;
    if (next.arrived) {
      arrived = true;
      break;
    }
  }
  assert.equal(arrived, true);
  assert.equal(steps, 79);
  assert.deepEqual(pos, { x: 20, z: 0 });

  // Orbit glide to the clamped (30, 40) target at dt 0.5: 7 m/frame over 38 m,
  // 6 steps, camera offset (100, -50) invariant on every step.
  target = { x: 0, z: 0 };
  camera = { x: 100, z: -50 };
  steps = 0;
  arrived = false;
  for (let i = 1; i <= 100; i += 1) {
    const next = stepOrbitGlide(target, camera, { x: 30, z: 40 }, 0.5, { speed: 14 });
    assert.ok(Math.abs(next.cameraX - next.targetX - 100) < 1e-9);
    assert.ok(Math.abs(next.cameraZ - next.targetZ - -50) < 1e-9);
    target = { x: next.targetX, z: next.targetZ };
    camera = { x: next.cameraX, z: next.cameraZ };
    steps = i;
    if (next.arrived) {
      arrived = true;
      break;
    }
  }
  assert.equal(arrived, true);
  assert.equal(steps, 6);
  assert.ok(Math.abs(target.x - 22.8) < 1e-9);
  assert.ok(Math.abs(target.z - 30.4) < 1e-9);
  assert.ok(Math.abs(camera.x - 122.8) < 1e-9);
  assert.ok(Math.abs(camera.z - -19.6) < 1e-9);
});

test('tap-glide source pins header signatures and pure JS claim', async () => {
  const src = await fs.readFile(path.join(__dirname, 'tap-glide.mjs'), 'utf8');
  for (const line of [
    '// Orbit tap-to-glide + multi-pointer suppression helpers for staging-polyfork.',
    'lines 3081-3128',
    'Pure JS (no THREE import, no top-level document/window access)',
    'export const DEFAULT_ORBIT_GLIDE_MAX_RADIUS = 38;',
    'export function stepGlide(',
    'export function deriveGlideMaxRadius(',
    'export function clampGlideTarget(',
    'export function stepOrbitGlide(',
    'export function createPointerTracker(',
    '{ speed = 7.5, maxRadius = 28.5, arriveDist = 0.3 } = {}',
    '{ speed = 14, maxRadius = DEFAULT_ORBIT_GLIDE_MAX_RADIUS, arriveDist = 0.3 } = {}',
    '{ dragThreshold = 4 } = {}',
    'Step an {x, z} position toward a target by at most speed * dt, clamping',
    'Derive a safe island-bound glide radius from the terrain',
    'Clamp an {x, z} glide target inside maxRadius.',
    'Step an OrbitControls target toward glideTarget using stepGlide and translate',
    'Track active pointers so a two-finger pinch (or >4 px drag) cancels any',
  ]) {
    assert.ok(src.includes(line), `Missing source line: ${line}`);
  }
  // 'document' and 'window' each occur exactly once — both inside the header
  // comment on line 3, never as code. Use split needles so this body adds no
  // occurrence of the counted literal below.
  const occ = (needle) => src.split(needle).length - 1;
  assert.equal(occ('docu' + 'ment'), 1, 'document occurs once, in the header comment');
  assert.equal(occ('win' + 'dow'), 1, 'window occurs once, in the header comment');
  assert.equal(occ('fet' + 'ch('), 0, 'no fetch in the pure-JS module');
  assert.equal(src.split('export function ').length - 1, 5, 'five exported functions');
});

test('staging.js wires pointerdown move up finishPointer and glide target', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const countIn = (src, needle) => src.split(needle).length - 1;
  assert.equal(countIn(stagingSrc, 'glideTarget = null;'), 11);
  assert.equal(
    countIn(stagingSrc, 'interiorLook'),
    13,
    'grep -c counts lines (10); split counts occurrences (13) — two lines carry it twice'
  );
  assert.equal(countIn(stagingSrc, 'setGlideTargetFromTap'), 2, 'definition + call');
  assert.equal(countIn(stagingSrc, 'finishPointer'), 3, 'definition + pointerup + pointercancel');
  assert.ok(stagingSrc.includes("window.addEventListener('pointerup', (e) => finishPointer(e, true));"));
  assert.ok(stagingSrc.includes("const ground = camp?.terrain?.getObjectByName('ground');"));
  assert.ok(
    stagingSrc.includes(
      'const clamped = clampGlideTarget(hits[0].point.x, hits[0].point.z, glideMaxRadius);'
    )
  );
  assert.ok(stagingSrc.includes('const gy = camp.groundAt(clamped.x, clamped.z);'));
  assert.ok(stagingSrc.includes('if (gy <= camp.groundY + 0.01 || gy < waterY) return;'));
  assert.ok(stagingSrc.includes('glideTarget = clamped;'));
  assert.ok(
    stagingSrc.includes('interiorVisit.lookBy(e.clientX - interiorLook.x, e.clientY - interiorLook.y);')
  );
  assert.ok(stagingSrc.includes('interiorLook = { id: e.pointerId, x: e.clientX, y: e.clientY };'));
  assert.ok(stagingSrc.includes('let interiorLook = null;'));
  assert.ok(stagingSrc.includes("renderer.domElement.addEventListener('pointerdown', (e) => {"));
  assert.ok(stagingSrc.includes('function setGlideTargetFromTap(e) {'));
  assert.ok(stagingSrc.includes('function finishPointer(e, allowTap) {'));
});

test('index.html tap hints swap script HUD paragraph and controls hint style', async () => {
  const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  for (const line of [
    '// Swap controls hint on coarse-pointer (touch) devices before module load.',
    "var controlsHint = document.getElementById('controls-hint');",
    "if (controlsHint && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {",
    'Tap ground: walk \\u00b7 Drag: look \\u00b7 Pinch: zoom \\u00b7 Tap: inspect',
    'The tavern is the Inn; Milo&rsquo;s ghost stands on the bandstand; Wick, Maren and Tomas stand around the deck. Tap ground to glide; tap a cottage, newsstand, Inn, or gatehouse to inspect.',
    'background: rgba(10, 12, 26, 0.78);',
    '<script type="module" src="./staging.js?v=41"></script>',
    'Move in &rarr;',
    "&larr; back to Milo&apos;s corner",
    '// Collapsible HUD intro: on narrow screens the intro starts collapsed',
  ]) {
    assert.ok(html.includes(line), `Missing index.html line: ${line}`);
  }
  const hintBlock = html.slice(html.indexOf('#controls-hint {'));
  assert.ok(hintBlock.includes('font-size: 11px;'), 'mobile controls-hint font size');
});

test('file hygiene 58 unique names 6 imports pinned counts', async () => {
  const self = await fs.readFile(path.join(__dirname, 'test-tap-glide.mjs'), 'utf8');
  const lines = self.split('\n');
  const names = [...self.matchAll(/^test\((['"])(.*?)\1, /gm)].map((m) => m[2]);
  assert.equal(names.length, 58);
  assert.equal(new Set(names).size, 58); // every top-level test name unique
  assert.deepEqual(lines.filter((l) => l.startsWith('import ')), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'import {',
  ]); // no new top-level imports
  const importEnd = self.indexOf("from './tap-glide.mjs'");
  const importBlock = self.slice(self.indexOf('import {', Math.max(0, importEnd - 400)), importEnd);
  for (const name of [
    'DEFAULT_ORBIT_GLIDE_MAX_RADIUS',
    'stepGlide',
    'deriveGlideMaxRadius',
    'clampGlideTarget',
    'stepOrbitGlide',
    'createPointerTracker',
  ]) {
    assert.equal(importBlock.split(name).length - 1, 1, `import block names ${name} exactly once`);
  }
  const occ = (needle) => self.split(needle).length - 1;
  assert.equal(occ('fet' + 'ch('), 0);
  assert.equal(occ('Date' + '.now'), 0);
  assert.equal(occ('Math' + '.random'), 0);
  assert.equal(occ('TO' + 'DO'), 0);
  assert.equal(occ('FIX' + 'ME'), 0);
  assert.equal(occ('camp' + 'fire'), 0);
  assert.equal(occ('inner' + 'HTML'), 0);
});

test('P1 stepGlide dist-vs-maxStep vs rem-vs-arriveDist interplay', () => {
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 0.75, z: 0 }, 0.1, { speed: 7.5 }),
    { x: 0.75, z: 0, arrived: true }
  );
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 0.76, z: 0 }, 0.1, { speed: 7.5 }),
    { x: 0.76, z: 0, arrived: true }
  );
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 1.1, z: 0 }, 0.1, { speed: 7.5 }),
    { x: 0.75, z: 0, arrived: false }
  );
});

test('P2 stepGlide custom maxRadius smaller than the target distance', () => {
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 10, z: 0 }, 1, { speed: 7.5, maxRadius: 5 }),
    { x: 5, z: 0, arrived: true }
  );
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 0.5, { speed: 7.5, maxRadius: 5 }),
    { x: 3.75, z: 0, arrived: false }
  );
  assert.deepEqual(
    stepGlide({ x: 8, z: 0 }, { x: 0, z: 0 }, 1, { speed: 7.5, maxRadius: 5 }),
    { x: 0.5, z: 0, arrived: false }
  );
});

test('P3 deriveGlideMaxRadius more linear-middle widths', () => {
  assert.equal(deriveGlideMaxRadius({ width: 114 }), 31);
  assert.equal(deriveGlideMaxRadius({ width: 117 }), 32.5);
  assert.equal(deriveGlideMaxRadius({ width: 124 }), 36);
  assert.ok(Math.abs(deriveGlideMaxRadius({ width: 110.5 }) - 29.25) < 1e-9);
  assert.equal(deriveGlideMaxRadius({ width: -0 }), 38);
  assert.equal(deriveGlideMaxRadius({ width: 0.5 }), 28.5);
});

test('P4 clampGlideTarget custom 28.5 radius', () => {
  assert.deepEqual(clampGlideTarget(30, 0, 28.5), { x: 28.5, z: 0 });
  assert.deepEqual(clampGlideTarget(0, 40, 28.5), { x: 0, z: 28.5 });
  assert.deepEqual(clampGlideTarget(20, 20, 28.5), { x: 20, z: 20 });
  const diag = clampGlideTarget(21, 21, 28.5);
  assert.ok(Math.abs(diag.x - 20.152543263816604) < 1e-9);
  assert.ok(Math.abs(diag.z - 20.152543263816604) < 1e-9);
});

test('P5 stepOrbitGlide out-of-bounds start clamps and camera follows delta', () => {
  assert.deepEqual(
    stepOrbitGlide({ x: 60, z: 0 }, { x: 100, z: -50 }, { x: 0, z: 0 }, 1, { speed: 14 }),
    { targetX: 38, targetZ: 0, cameraX: 78, cameraZ: -50, arrived: false }
  );
  const small = stepOrbitGlide({ x: 0, z: 0 }, { x: 0, z: 58 }, { x: 14, z: 0 }, 0.1, { speed: 14 });
  assert.ok(Math.abs(small.targetX - 1.4) < 1e-9);
  assert.ok(Math.abs(small.cameraX - 1.4) < 1e-9);
  assert.equal(small.targetZ, 0);
  assert.equal(small.cameraZ, 58);
  assert.equal(small.arrived, false);
});

test('P6 pointerup is judged against downPos even with no move event', () => {
  const dragNoMove = createPointerTracker();
  dragNoMove.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(dragNoMove.onPointerUp(1, 120, 100), { ended: true, shouldClick: false });

  const tapNoMove = createPointerTracker();
  tapNoMove.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(tapNoMove.onPointerUp(1, 103, 104), { ended: true, shouldClick: true });

  const bothOff = createPointerTracker();
  bothOff.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(
    bothOff.onPointerUp(1, 100, 100, { overlayHidden: false, allowTap: false }),
    { ended: true, shouldClick: false }
  );

  const pinchUnknown = createPointerTracker();
  pinchUnknown.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  pinchUnknown.onPointerDown(2, 150, 100, { pointerType: 'touch' });
  assert.deepEqual(pinchUnknown.onPointerMove(999, 120, 100), {
    moved: false,
    isPinch: false,
    cancelGlide: false,
  });
  assert.equal(pinchUnknown.size, 2);
});

test('P7 staging.js animation-loop glide call-site source lines', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const sl = stagingSrc.split('\n');
  assert.equal(
    sl[1544],
    '    if (glideTarget && (!plotOverlayEl || plotOverlayEl.hidden) && !interiorVisit.isInside()) {'
  );
  assert.equal(sl[1545], '      const next = stepOrbitGlide(');
  assert.equal(sl[1546], '        controls.target,');
  assert.equal(sl[1547], '        camera.position,');
  assert.equal(sl[1548], '        glideTarget,');
  assert.equal(sl[1549], '        dt,');
  assert.equal(sl[1550], '        { speed: 14, maxRadius: glideMaxRadius, arriveDist: 0.3 }');
  assert.equal(sl[1551], '      );');
  assert.equal(sl[1552], '      controls.target.x = next.targetX;');
  assert.equal(sl[1553], '      controls.target.z = next.targetZ;');
  assert.equal(sl[1554], '      camera.position.x = next.cameraX;');
  assert.equal(sl[1555], '      camera.position.z = next.cameraZ;');
  assert.equal(sl[1556], '      if (next.arrived) {');
  assert.equal(sl[1557], '        glideTarget = null;');
});

test('P8 stepGlide Infinity / NaN speed and a tiny dt', () => {
  assert.deepEqual(
    stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 1, { speed: Infinity }),
    { x: 20, z: 0, arrived: true }
  );
  const nanSpeed = stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 1, { speed: NaN });
  assert.ok(Number.isNaN(nanSpeed.x));
  assert.ok(Number.isNaN(nanSpeed.z));
  assert.equal(nanSpeed.arrived, false);

  const tinyDt = stepGlide({ x: 0, z: 0 }, { x: 20, z: 0 }, 1e-9, { speed: 7.5 });
  assert.ok(Math.abs(tinyDt.x - 7.5e-9) < 1e-15);
  assert.equal(tinyDt.z, 0);
  assert.equal(tinyDt.arrived, false);
});

test('P9 createPointerTracker negative dragThreshold', () => {
  const negMove = createPointerTracker({ dragThreshold: -1 });
  negMove.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(negMove.onPointerMove(1, 100, 100), {
    moved: true,
    isPinch: false,
    cancelGlide: true,
  });
  assert.deepEqual(negMove.onPointerUp(1, 100, 100), { ended: true, shouldClick: false });

  const negUpOnly = createPointerTracker({ dragThreshold: -1 });
  negUpOnly.onPointerDown(1, 100, 100, { pointerType: 'touch' });
  assert.deepEqual(negUpOnly.onPointerUp(1, 100, 100), { ended: true, shouldClick: false });
});

test('P10 stepOrbitGlide diagonal clamp + snap with negative camera offset and partial diagonal step', () => {
  assert.deepEqual(
    stepOrbitGlide({ x: 0, z: 0 }, { x: -100, z: 200 }, { x: 30, z: 40 }, 0.1, {
      speed: 14,
      arriveDist: 50,
    }),
    { targetX: 22.8, targetZ: 30.4, cameraX: -77.2, cameraZ: 230.4, arrived: true }
  );
  const partialDiag = stepOrbitGlide({ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 30, z: 40 }, 0.5, {
    speed: 14,
  });
  assert.ok(Math.abs(partialDiag.targetX - 4.2) < 1e-9);
  assert.ok(Math.abs(partialDiag.cameraX - 4.2) < 1e-9);
  assert.ok(Math.abs(partialDiag.targetZ - 5.6) < 1e-9);
  assert.ok(Math.abs(partialDiag.cameraZ - 5.6) < 1e-9);
  assert.equal(partialDiag.arrived, false);
});
