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
