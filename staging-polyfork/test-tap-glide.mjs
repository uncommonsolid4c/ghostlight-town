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
