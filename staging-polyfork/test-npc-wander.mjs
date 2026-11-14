/**
 * Ghostlight Town — NPC wandering + Walk clip tests (Slice 71)
 *
 * Headless node --test suite: no browser, no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOWN_LAYOUT, SEED_HOME_PADS, getPlotTargetPosition } from './avatar.mjs';
import {
  SEED_WANDER_CONFIG,
  getStagingNewsstandFrontPosition,
  buildStagingWanderFigures,
  updateStagingWander,
} from './npc-wander.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WALK_CLIP_SHA256 = '41a931b763a88061e49c2eac86cbd19d3f290ab509768496dde755939dbbf03a';

// All 22 Mixamo bone names built by kit-medieval/villager.mjs and tradesman.mjs
// (checked against clips.mjs required bones Hips, Spine2, LeftForeArm, RightUpLeg).
const MIXAMO_HUMANOID_BONES = new Set([
  'Hips',
  'Spine',
  'Spine1',
  'Spine2',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'LeftToeBase',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
  'RightToeBase',
]);

function makeFakeGroup(x = 0, y = 0, z = 0, rotY = 0) {
  return {
    visible: true,
    position: {
      x,
      y,
      z,
      set(nx, ny, nz) {
        this.x = nx;
        this.y = ny;
        this.z = nz;
      },
    },
    rotation: { y: rotY },
  };
}

function makeFakeBandstandSpots() {
  return Array.from({ length: 10 }, (_, slot) => {
    const angle = (slot / 10) * Math.PI * 2;
    const x = +(Math.sin(angle) * 3.8).toFixed(4);
    const z = +(Math.cos(angle) * 3.8).toFixed(4);
    return {
      slot,
      x,
      y: 0.6,
      z,
      rotY: +Math.atan2(-x, -z).toFixed(4),
    };
  });
}

test('vendored anim-walk.json matches pinned sha256, schema, and villager/tradesman Mixamo bones', () => {
  const clipPath = path.join(__dirname, 'anim', 'anim-walk.json');
  const rawBytes = fs.readFileSync(clipPath);
  const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');
  assert.equal(sha256, WALK_CLIP_SHA256, 'anim-walk.json sha256 must match vendored bytes');
  assert.ok(rawBytes.length <= 500 * 1024, 'anim-walk.json must stay under 500 KB');

  const data = JSON.parse(rawBytes.toString('utf8'));
  assert.ok(data && typeof data === 'object', 'clip JSON must parse to an object');
  assert.ok(Array.isArray(data.times) && data.times.length >= 2, 'times must be an array of length >= 2');
  assert.ok(
    Array.isArray(data.hips) && data.hips.length === data.times.length * 3,
    'hips length must equal times.length * 3'
  );
  assert.ok(
    data.tracks && typeof data.tracks === 'object' && !Array.isArray(data.tracks),
    'tracks must be a plain object'
  );
  const trackKeys = Object.keys(data.tracks);
  assert.ok(trackKeys.length > 0, 'tracks must be non-empty');

  const villagerSrc = fs.readFileSync(path.join(__dirname, 'kit-medieval', 'villager.mjs'), 'utf8');
  const tradesmanSrc = fs.readFileSync(path.join(__dirname, 'kit-medieval', 'tradesman.mjs'), 'utf8');
  for (const bone of trackKeys) {
    assert.ok(MIXAMO_HUMANOID_BONES.has(bone), `unexpected track bone "${bone}"`);
    assert.ok(villagerSrc.includes(bone), `villager.mjs must contain bone "${bone}"`);
    assert.ok(tradesmanSrc.includes(bone), `tradesman.mjs must contain bone "${bone}"`);
  }
});

test('SEED_WANDER_CONFIG pins live wander handles, slots, speeds, and linger durations', () => {
  assert.deepEqual(SEED_WANDER_CONFIG, [
    { handle: 'wick', bandstandSlot: 1, speed: 0.5, lingers: { home: 10, bandstand: 14, newsstand: 12 } },
    { handle: 'maren', bandstandSlot: 2, speed: 0.45, lingers: { home: 12, bandstand: 16, newsstand: 10 } },
    { handle: 'tomas', bandstandSlot: 3, speed: 0.6, lingers: { home: 9, bandstand: 12, newsstand: 15 } },
  ]);
});

test('buildStagingWanderFigures builds 3 figures with terrain-aware home, bandstand, and newsstand waypoints', () => {
  const groundAt = (x, z) => +(0.25 + x * 0.01 - z * 0.005).toFixed(4);
  const bandstandGroundY = groundAt(0, 0);
  const bandstandSpots = makeFakeBandstandSpots();
  const newsstandFront = getStagingNewsstandFrontPosition(TOWN_LAYOUT);

  const dx = TOWN_LAYOUT.bandstand.x - TOWN_LAYOUT.newsstand.x;
  const dz = TOWN_LAYOUT.bandstand.z - TOWN_LAYOUT.newsstand.z;
  const dist = Math.hypot(dx, dz) || 1;
  assert.equal(newsstandFront.x, +(TOWN_LAYOUT.newsstand.x + (dx / dist) * 2.0).toFixed(4));
  assert.equal(newsstandFront.z, +(TOWN_LAYOUT.newsstand.z + (dz / dist) * 2.0).toFixed(4));

  const standIns = new Map([
    ['wick', { group: makeFakeGroup(4.16, 0, 4.99), home: { x: 4.16, z: 4.99 }, anim: null }],
    ['maren', { group: makeFakeGroup(-3.53, 0, 5.46), home: { x: -3.53, z: 5.46 }, anim: null }],
    ['tomas', { group: makeFakeGroup(0.76, 0, -6.46), home: { x: 0.76, z: -6.46 }, anim: null }],
  ]);

  const figures = buildStagingWanderFigures({
    standIns,
    plots: TOWN_LAYOUT.plots,
    bandstandSpots,
    bandstandGroundY,
    newsstandFront,
    groundAt,
    getPlotTargetPosition,
    homePads: SEED_HOME_PADS,
  });

  assert.equal(figures.length, 3);
  for (let i = 0; i < SEED_WANDER_CONFIG.length; i += 1) {
    const cfg = SEED_WANDER_CONFIG[i];
    const fig = figures[i];
    assert.equal(fig.handle, cfg.handle);
    assert.equal(fig.speed, cfg.speed);
    assert.equal(fig.targetIndex, 1);
    assert.equal(fig.state, 'walking');
    assert.equal(fig.lingerRemaining, 0);
    assert.equal(fig.yielded, false);
    assert.deepEqual(
      fig.waypoints.map((w) => w.label),
      ['home', 'bandstand', 'newsstand']
    );

    const plotLayout = TOWN_LAYOUT.plots.find((pl) => pl.plotNumber === SEED_HOME_PADS[cfg.handle]);
    const expectedHome = getPlotTargetPosition(plotLayout, 0);
    assert.deepEqual(fig.waypoints[0], {
      x: expectedHome.x,
      y: groundAt(expectedHome.x, expectedHome.z),
      z: expectedHome.z,
      rotY: expectedHome.rotY,
      linger: cfg.lingers.home,
      label: 'home',
    });

    const spot = bandstandSpots[cfg.bandstandSlot];
    assert.deepEqual(fig.waypoints[1], {
      x: spot.x,
      y: bandstandGroundY + spot.y,
      z: spot.z,
      rotY: spot.rotY,
      linger: cfg.lingers.bandstand,
      label: 'bandstand',
    });

    assert.deepEqual(fig.waypoints[2], {
      x: newsstandFront.x,
      y: groundAt(newsstandFront.x, newsstandFront.z),
      z: newsstandFront.z,
      linger: cfg.lingers.newsstand,
      label: 'newsstand',
    });
    assert.equal('rotY' in fig.waypoints[2], false);
  }
});

test('updateStagingWander steps toward target, switches Walk/Idle clips, lingers, advances, and tolerates null anim', () => {
  const locoCalls = [];
  const group = makeFakeGroup(0, 0, 0, 0);
  const figure = {
    handle: 'wick',
    standIn: { anim: { locomotion: (speed) => locoCalls.push(speed) } },
    group,
    speed: 0.5,
    waypoints: [
      { x: 0, y: 0, z: 0, rotY: 0, linger: 10, label: 'home' },
      { x: 0, y: 0, z: 2, rotY: Math.PI, linger: 14, label: 'bandstand' },
      { x: 2, y: 0, z: 2, linger: 12, label: 'newsstand' },
    ],
    targetIndex: 1,
    state: 'walking',
    lingerRemaining: 0,
    yielded: false,
  };

  // Step 1: 1.0 s -> moves 0.5 m toward (0, 0, 2) and calls locomotion(0.5)
  updateStagingWander([figure], 1.0, new Map());
  assert.ok(Math.abs(group.position.z - 0.5) < 1e-6);
  assert.equal(group.position.x, 0);
  assert.ok(Math.abs(group.rotation.y) < 1e-6); // heading toward +z is atan2(0, 1.5) = 0
  assert.deepEqual(locoCalls, [0.5]);

  // Step 2: 3.0 s -> remaining distance 1.5 <= maxStep 1.5, snaps to target, enters lingering, calls locomotion(0)
  updateStagingWander([figure], 3.0, new Map());
  assert.equal(group.position.z, 2);
  assert.equal(figure.state, 'lingering');
  assert.equal(figure.lingerRemaining, 14);
  assert.deepEqual(locoCalls, [0.5, 0]);

  // Step 3: linger counts down without moving or calling locomotion
  updateStagingWander([figure], 5.0, new Map());
  assert.equal(figure.state, 'lingering');
  assert.equal(figure.lingerRemaining, 9);
  assert.equal(locoCalls.length, 2);

  // Step 4: linger expires -> advances targetIndex to 2 and returns to walking
  updateStagingWander([figure], 9.0, new Map());
  assert.equal(figure.state, 'walking');
  assert.equal(figure.targetIndex, 2);
  assert.equal(figure.lingerRemaining, 0);

  // Null anim figure walks without throwing
  const nullAnimGroup = makeFakeGroup(0, 0, 0, 0);
  const nullAnimFigure = {
    handle: 'maren',
    standIn: { anim: null },
    group: nullAnimGroup,
    speed: 0.45,
    waypoints: [
      { x: 0, y: 0, z: 0, rotY: 0, linger: 12, label: 'home' },
      { x: 3, y: 0, z: 0, rotY: 0, linger: 16, label: 'bandstand' },
      { x: 3, y: 0, z: 3, linger: 10, label: 'newsstand' },
    ],
    targetIndex: 1,
    state: 'walking',
    lingerRemaining: 0,
    yielded: false,
  };
  updateStagingWander([nullAnimFigure], 1.0, new Map());
  assert.ok(Math.abs(nullAnimGroup.position.x - 0.45) < 1e-6);
  assert.ok(nullAnimGroup.rotation.y > 0);
});

test('updateStagingWander yields to live presence, restores at waypoints[0], and ignores dt <= 0', () => {
  const locoCalls = [];
  const group = makeFakeGroup(5, 0.2, 5, 1.0);
  const figure = {
    handle: 'tomas',
    standIn: { anim: { locomotion: (speed) => locoCalls.push(speed) } },
    group,
    speed: 0.6,
    waypoints: [
      { x: -1, y: 0.3, z: -2, rotY: 0.75, linger: 9, label: 'home' },
      { x: 4, y: 0.6, z: 4, rotY: 0, linger: 12, label: 'bandstand' },
      { x: 5, y: 0.1, z: 12, linger: 15, label: 'newsstand' },
    ],
    targetIndex: 2,
    state: 'lingering',
    lingerRemaining: 4,
    yielded: false,
  };

  // dt <= 0 or non-finite is a no-op
  updateStagingWander([figure], 0, new Map([['tomas', {}]]));
  updateStagingWander([figure], -1, new Map([['tomas', {}]]));
  updateStagingWander([figure], Number.NaN, new Map([['tomas', {}]]));
  assert.equal(group.visible, true);
  assert.equal(figure.yielded, false);
  assert.equal(locoCalls.length, 0);

  // Live presence present -> hide, yielded=true, no movement, no locomotion call
  const liveAvatars = new Map([['tomas', {}]]);
  updateStagingWander([figure], 0.5, liveAvatars);
  assert.equal(group.visible, false);
  assert.equal(figure.yielded, true);
  assert.equal(group.position.x, 5);
  assert.equal(group.position.z, 5);
  assert.equal(locoCalls.length, 0);

  // Live presence cleared -> restore visible at waypoints[0], targetIndex=1, walking
  liveAvatars.delete('tomas');
  updateStagingWander([figure], 0.5, liveAvatars);
  assert.equal(group.visible, true);
  assert.equal(figure.yielded, false);
  assert.equal(group.position.x, -1);
  assert.equal(group.position.y, 0.3);
  assert.equal(group.position.z, -2);
  assert.equal(group.rotation.y, 0.75);
  assert.equal(figure.targetIndex, 1);
  assert.equal(figure.state, 'walking');
  assert.equal(figure.lingerRemaining, 0);
});

test('npc-wander.mjs contains no fetch(, no polyfork.dev, no Math.random, and no banned term', () => {
  const src = fs.readFileSync(path.join(__dirname, 'npc-wander.mjs'), 'utf8');
  assert.equal(src.includes('fetch('), false, 'npc-wander.mjs must not contain fetch(');
  assert.equal(src.includes('polyfork.dev'), false, 'npc-wander.mjs must not contain polyfork.dev');
  assert.equal(src.includes('Math.random'), false, 'npc-wander.mjs must not contain Math.random');
  assert.equal(new RegExp('camp' + 'fire', 'i').test(src), false, 'npc-wander.mjs must not contain banned term');
});

test('staging.js wires attachNpcAnimation, updateStagingWander, and removes stand-in yield from applyStagingPresence', () => {
  const src = fs.readFileSync(path.join(__dirname, 'staging.js'), 'utf8');
  const mapIdx = src.indexOf('const npcStandIns = new Map([');
  const attachIdx = src.indexOf('attachNpcAnimation(THREE, standIn.group');
  const buildIdx = src.indexOf('buildStagingWanderFigures({');
  const loopIdx = src.indexOf('(function loop() {');
  const wanderUpdateIdx = src.indexOf('updateStagingWander(wanderFigures, dt, liveStore.avatars);');

  assert.ok(mapIdx !== -1, 'staging.js must define npcStandIns');
  assert.ok(attachIdx > mapIdx, 'attachNpcAnimation must be called after npcStandIns is built');
  assert.ok(buildIdx > attachIdx, 'buildStagingWanderFigures must be called after attachNpcAnimation');
  assert.ok(loopIdx !== -1, 'staging.js must define the render loop');
  assert.ok(wanderUpdateIdx > loopIdx, 'updateStagingWander must be called inside the render loop');

  const presenceStart = src.indexOf('function applyStagingPresence(');
  const presenceEnd = src.indexOf('function applyStagingState(');
  assert.ok(presenceStart !== -1 && presenceEnd > presenceStart);
  const presenceBody = src.slice(presenceStart, presenceEnd);
  assert.equal(presenceBody.includes('standIn.group.visible'), false, 'applyStagingPresence must not touch standIn.group.visible');
  assert.equal(presenceBody.includes('standIn.group.position'), false, 'applyStagingPresence must not touch standIn.group.position');
});
