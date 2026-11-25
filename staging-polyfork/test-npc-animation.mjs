/**
 * Ghostlight Town — NPC stand-in Idle animation tests (Slice 68)
 *
 * Headless node --test suite: no browser, no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachIdleAnimation, attachNpcAnimation, updateNpcAnimations } from './npc-animation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IDLE_CLIP_SHA256 = '762fb5825302e92b0c36fe44223cefd5c97d985ca2050c2014411fe825b8c17c';

// All 22 Mixamo bone names built by kit-medieval/villager.mjs and tradesman.mjs.
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

test('vendored anim-idle.json matches pinned sha256, schema, and villager/tradesman Mixamo bones', () => {
  const clipPath = path.join(__dirname, 'anim', 'anim-idle.json');
  const rawBytes = fs.readFileSync(clipPath);
  const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');
  assert.equal(sha256, IDLE_CLIP_SHA256, 'anim-idle.json sha256 must match vendored bytes');
  assert.ok(rawBytes.length <= 500 * 1024, 'anim-idle.json must stay under 500 KB');

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

test('attachIdleAnimation calls animateFn with { clips: ["Idle"], base: "./anim/" } and returns handle', async () => {
  const fakeGroup = { name: 'wick' };
  const fakeHandle = { update() {} };
  const calls = [];
  const fakeAnimate = async (group, opts) => {
    calls.push({ group, opts });
    return fakeHandle;
  };

  const result = await attachIdleAnimation({}, fakeGroup, { animateFn: fakeAnimate });
  assert.equal(result, fakeHandle);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].group, fakeGroup);
  assert.deepEqual(calls[0].opts, { clips: ['Idle'], base: './anim/' });
});

test('attachIdleAnimation catches rejecting animateFn, warns once, and returns null', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await attachIdleAnimation({}, { name: 'bad' }, {
      animateFn: async () => {
        throw new Error('missing Mixamo bones');
      },
    });
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = origWarn;
  }
});

test('attachNpcAnimation calls animateFn with { clips: ["Idle", "Walk"], base: "./anim/" } and returns handle', async () => {
  const fakeGroup = { name: 'wick' };
  const fakeHandle = { update() {}, locomotion() {} };
  const calls = [];
  const fakeAnimate = async (group, opts) => {
    calls.push({ group, opts });
    return fakeHandle;
  };

  const result = await attachNpcAnimation({}, fakeGroup, { animateFn: fakeAnimate });
  assert.equal(result, fakeHandle);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].group, fakeGroup);
  assert.deepEqual(calls[0].opts, { clips: ['Idle', 'Walk'], base: './anim/' });
});

test('attachNpcAnimation catches rejecting animateFn, warns once, and returns null', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await attachNpcAnimation({}, { name: 'bad' }, {
      animateFn: async () => {
        throw new Error('missing Mixamo bones');
      },
    });
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = origWarn;
  }
});

test('updateNpcAnimations calls update(dt) once per live handle and skips nulls', () => {
  const callsA = [];
  const callsB = [];
  const standIns = new Map([
    ['wick', { anim: { update: (dt) => callsA.push(dt) } }],
    ['maren', { anim: null }],
    ['tomas', { anim: { update: (dt) => callsB.push(dt) } }],
    ['extra', {}],
  ]);

  updateNpcAnimations(standIns, 0.016);
  assert.deepEqual(callsA, [0.016]);
  assert.deepEqual(callsB, [0.016]);
});

test('npc-animation.mjs contains no fetch(, no polyfork.dev, no Math.random, and no banned term', () => {
  const src = fs.readFileSync(path.join(__dirname, 'npc-animation.mjs'), 'utf8');
  assert.equal(src.includes('fetch('), false, 'npc-animation.mjs must not contain fetch(');
  assert.equal(src.includes('polyfork.dev'), false, 'npc-animation.mjs must not contain polyfork.dev');
  assert.equal(src.includes('Math.random'), false, 'npc-animation.mjs must not contain Math.random');
  assert.equal(new RegExp('camp' + 'fire', 'i').test(src), false, 'npc-animation.mjs must not contain banned term');
});

test('staging.js attaches Idle/Walk after npcStandIns and updates animations in the render loop', () => {
  const src = fs.readFileSync(path.join(__dirname, 'staging.js'), 'utf8');
  const mapIdx = src.indexOf('const npcStandIns = new Map([');
  const attachIdx = src.indexOf('attachNpcAnimation(THREE, standIn.group');
  const loopIdx = src.indexOf('(function loop() {');
  const updateIdx = src.indexOf('updateNpcAnimations(npcStandIns, dt);');

  assert.ok(mapIdx !== -1, 'staging.js must define npcStandIns');
  assert.ok(attachIdx > mapIdx, 'attachNpcAnimation must be called after npcStandIns is built');
  assert.ok(loopIdx !== -1, 'staging.js must define the render loop');
  assert.ok(updateIdx > loopIdx, 'updateNpcAnimations must be called inside the render loop');
});

test('attachIdleAnimation and attachNpcAnimation return null for null group without calling animateFn', async () => {
  let calls = 0;
  const countingFake = async () => {
    calls += 1;
    return { update() {} };
  };

  assert.equal(await attachIdleAnimation({}, null, { animateFn: countingFake }), null);
  assert.equal(await attachNpcAnimation({}, null, { animateFn: countingFake }), null);
  assert.equal(calls, 0);
});

test('attachIdleAnimation and attachNpcAnimation pass custom base through to animateFn', async () => {
  const seen = [];
  const fakeAnimate = async (_group, opts) => {
    seen.push(opts);
    return { update() {} };
  };

  await attachIdleAnimation({}, { name: 'idle' }, { animateFn: fakeAnimate, base: './custom/' });
  await attachNpcAnimation({}, { name: 'walk' }, { animateFn: fakeAnimate, base: './custom/' });

  assert.deepEqual(seen, [
    { clips: ['Idle'], base: './custom/' },
    { clips: ['Idle', 'Walk'], base: './custom/' },
  ]);
});

test('updateNpcAnimations handles null/undefined standIns, array inputs, and non-function update handles', () => {
  assert.doesNotThrow(() => {
    updateNpcAnimations(null, 0.016);
    updateNpcAnimations(undefined, 0.016);
  });

  const arrayCalls = [];
  updateNpcAnimations([{ anim: { update: (dt) => arrayCalls.push(dt) } }], 0.016);
  assert.deepEqual(arrayCalls, [0.016]);

  const nonFuncMap = new Map([
    ['a', { anim: {} }],
    ['b', { anim: { update: 'not-a-function' } }],
    ['c', {}],
  ]);
  assert.doesNotThrow(() => updateNpcAnimations(nonFuncMap, 0.016));
});

test('updateNpcAnimations contains a throwing anim.update, warns once, and updates remaining handles', () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const goodCalls = [];
    const standIns = new Map([
      ['bad', { anim: { update: () => { throw new Error('boom'); } } }],
      ['good', { anim: { update: (dt) => goodCalls.push(dt) } }],
    ]);

    assert.doesNotThrow(() => updateNpcAnimations(standIns, 0.016));
    assert.deepEqual(goodCalls, [0.016]);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('[npc-animation]'), 'warning must include [npc-animation]');
    assert.ok(warnings[0].includes('boom'), 'warning must include error message');
  } finally {
    console.warn = origWarn;
  }
});

test('vendored anim-idle.json times are strictly increasing 0..2.5 and all tracks/hips are finite quaternion streams', () => {
  const clipPath = path.join(__dirname, 'anim', 'anim-idle.json');
  const data = JSON.parse(fs.readFileSync(clipPath, 'utf8'));

  assert.equal(data.times[0], 0);
  assert.equal(data.times[data.times.length - 1], 2.5);
  for (let i = 1; i < data.times.length; i++) {
    assert.ok(data.times[i] > data.times[i - 1], `times[${i}] must be strictly greater than times[${i - 1}]`);
  }

  for (let i = 0; i < data.hips.length; i++) {
    assert.ok(Number.isFinite(data.hips[i]), `hips[${i}] must be finite`);
  }

  const expectedLen = data.times.length * 4;
  for (const [bone, values] of Object.entries(data.tracks)) {
    assert.ok(Array.isArray(values), `track ${bone} must be an array`);
    assert.equal(values.length, expectedLen, `track ${bone} length must equal times.length * 4`);
    for (let i = 0; i < values.length; i++) {
      assert.ok(Number.isFinite(values[i]), `track ${bone}[${i}] must be finite`);
    }
  }
});

test('attach-failure warning text is label-specific and carries the error message', async () => {
  const origWarn = console.warn;
  try {
    const idleWarnings = [];
    console.warn = (...args) => idleWarnings.push(args.join(' '));
    const idleResult = await attachIdleAnimation({}, { name: 'bad-idle' }, {
      animateFn: async () => {
        throw new Error('missing Mixamo bones');
      },
    });
    assert.equal(idleResult, null);
    assert.equal(idleWarnings.length, 1);
    assert.ok(idleWarnings[0].includes('[npc-animation]'));
    assert.ok(idleWarnings[0].includes('Idle clip'));
    assert.ok(idleWarnings[0].includes('failed to attach'));
    assert.ok(idleWarnings[0].includes('stand-in stays still'));
    assert.ok(idleWarnings[0].includes('missing Mixamo bones'));

    const npcWarnings = [];
    console.warn = (...args) => npcWarnings.push(args.join(' '));
    const npcResult = await attachNpcAnimation({}, { name: 'bad-npc' }, {
      animateFn: async () => {
        throw new Error('no Walk clip');
      },
    });
    assert.equal(npcResult, null);
    assert.equal(npcWarnings.length, 1);
    assert.ok(npcWarnings[0].includes('[npc-animation]'));
    assert.ok(npcWarnings[0].includes('Idle/Walk clips'));
    assert.ok(npcWarnings[0].includes('no Walk clip'));
  } finally {
    console.warn = origWarn;
  }
});

test('attachIdleAnimation warns with the thrown value itself when a non-Error is thrown', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await attachIdleAnimation({}, { name: 'plain-err' }, {
      animateFn: async () => {
        throw 'plain failure';
      },
    });
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('plain failure'));
  } finally {
    console.warn = origWarn;
  }
});

test('THREE argument is ignored and animateFn return value is passed through verbatim', async () => {
  const handle = { update() {} };
  const group = { name: 'wick' };

  assert.equal(await attachIdleAnimation(null, group, { animateFn: async () => handle }), handle);
  assert.equal(await attachNpcAnimation(undefined, group, { animateFn: async () => handle }), handle);
  assert.equal(await attachIdleAnimation({}, group, { animateFn: async () => undefined }), undefined);
  assert.equal(await attachNpcAnimation({}, group, { animateFn: async () => 0 }), 0);
});

test('updateNpcAnimations passes dt through exactly in call order', () => {
  const recorded = [];
  const standIns = new Map([
    ['wick', { anim: { update: (dt) => recorded.push(dt) } }],
  ]);

  updateNpcAnimations(standIns, 0);
  updateNpcAnimations(standIns, -0.5);
  updateNpcAnimations(standIns, 1);
  updateNpcAnimations(standIns, 0.016);

  assert.deepEqual(recorded, [0, -0.5, 1, 0.016]);
});

test('updateNpcAnimations accepts Set and generator inputs and warns per throwing handle', () => {
  const origWarn = console.warn;
  try {
    const setWarnings = [];
    const goodCalls = [];
    console.warn = (...args) => setWarnings.push(args.join(' '));
    const standInSet = new Set([
      { anim: { update: () => { throw new Error('first boom'); } } },
      { anim: { update: (dt) => goodCalls.push(dt) } },
      { anim: { update: () => { throw new Error('second boom'); } } },
    ]);
    updateNpcAnimations(standInSet, 0.016);
    assert.deepEqual(goodCalls, [0.016]);
    assert.equal(setWarnings.length, 2);
    assert.ok(setWarnings[0].includes('first boom'));
    assert.ok(setWarnings[1].includes('second boom'));

    const genCalls = [];
    function* genStandIns() {
      yield { anim: { update: (dt) => genCalls.push(dt) } };
    }
    updateNpcAnimations(genStandIns(), 0.033);
    assert.deepEqual(genCalls, [0.033]);

    const plainWarnings = [];
    console.warn = (...args) => plainWarnings.push(args.join(' '));
    const plainMap = new Map([
      ['bad', { anim: { update: () => { throw 'plain boom'; } } }],
    ]);
    updateNpcAnimations(plainMap, 0.016);
    assert.equal(plainWarnings.length, 1);
    assert.ok(plainWarnings[0].includes('plain boom'));
  } finally {
    console.warn = origWarn;
  }
});

test('vendored anim-idle.json quaternions are unit-length and staging.js uses only Idle/Walk', () => {
  const clipPath = path.join(__dirname, 'anim', 'anim-idle.json');
  const data = JSON.parse(fs.readFileSync(clipPath, 'utf8'));
  for (const [bone, values] of Object.entries(data.tracks)) {
    for (let i = 0; i < values.length; i += 4) {
      const norm = Math.hypot(values[i], values[i + 1], values[i + 2], values[i + 3]);
      assert.ok(
        Math.abs(norm - 1) <= 1e-3,
        `track ${bone} quaternion at ${i / 4} has norm ${norm} outside 1e-3 of 1`
      );
    }
  }

  const stagingSrc = fs.readFileSync(path.join(__dirname, 'staging.js'), 'utf8');
  assert.ok(
    stagingSrc.includes("import { attachNpcAnimation, updateNpcAnimations } from './npc-animation.mjs';"),
    'staging.js must import attachNpcAnimation and updateNpcAnimations from ./npc-animation.mjs'
  );
  assert.equal(stagingSrc.includes('attachIdleAnimation('), false, 'staging.js must not call attachIdleAnimation(');
  assert.ok(
    stagingSrc.includes('attachNpcAnimation(THREE, standIn.group, { animateFn: animate })'),
    'staging.js must pass real Polyfork animate as animateFn'
  );
});

test('attachIdleAnimation and attachNpcAnimation return null for falsy groups without calling animateFn', async () => {
  let calls = 0;
  const countingFake = async () => {
    calls++;
    return { update() {} };
  };

  for (const group of [0, '', false, undefined]) {
    assert.equal(await attachIdleAnimation({}, group, { animateFn: countingFake }), null);
    assert.equal(await attachNpcAnimation({}, group, { animateFn: countingFake }), null);
  }
  assert.equal(calls, 0);
});

test('attachNpcAnimation catches a synchronously throwing animateFn, warns once, and returns null', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await attachNpcAnimation({}, { name: 'sync-bad' }, {
      animateFn: () => {
        throw new Error('sync boom');
      },
    });
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('sync boom'));
  } finally {
    console.warn = origWarn;
  }
});

test('attachIdleAnimation warns with the Error object itself when the thrown Error has an empty message', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await attachIdleAnimation({}, { name: 'empty-err' }, {
      animateFn: async () => {
        throw new Error('');
      },
    });
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('Error'));
  } finally {
    console.warn = origWarn;
  }
});

test('updateNpcAnimations skips primitive entries and non-object anim values without throwing', () => {
  const goodCalls = [];
  const standIns = new Map([
    ['null-entry', null],
    ['num-entry', 42],
    ['str-entry', 'wick'],
    ['num-anim', { anim: 42 }],
    ['str-anim', { anim: 'x' }],
    ['good', { anim: { update: (dt) => goodCalls.push(dt) } }],
    ['undef-entry', undefined],
  ]);

  assert.doesNotThrow(() => updateNpcAnimations(standIns, 0.016));
  assert.deepEqual(goodCalls, [0.016]);
});

test('updateNpcAnimations passes undefined and NaN dt through verbatim', () => {
  const recorded = [];
  const standIns = new Map([
    ['wick', { anim: { update: (dt) => recorded.push(dt) } }],
  ]);

  updateNpcAnimations(standIns, undefined);
  updateNpcAnimations(standIns, NaN);

  assert.equal(recorded.length, 2);
  assert.equal(recorded[0], undefined);
  assert.equal(Number.isNaN(recorded[1]), true);
});

test('updateNpcAnimations follows Map insertion order across calls', () => {
  const order = [];
  const standIns = new Map([
    ['wick', { anim: { update: () => order.push('wick') } }],
    ['maren', { anim: { update: () => order.push('maren') } }],
    ['tomas', { anim: { update: () => order.push('tomas') } }],
  ]);

  updateNpcAnimations(standIns, 0.016);
  updateNpcAnimations(standIns, 0.033);

  assert.deepEqual(order, ['wick', 'maren', 'tomas', 'wick', 'maren', 'tomas']);
});

const WALK_CLIP_SHA256 = '41a931b763a88061e49c2eac86cbd19d3f290ab509768496dde755939dbbf03a';

test('vendored anim-walk.json matches pinned sha256, size cap, and top-level schema', () => {
  const clipPath = path.join(__dirname, 'anim', 'anim-walk.json');
  const rawBytes = fs.readFileSync(clipPath);
  const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');
  assert.equal(sha256, WALK_CLIP_SHA256, 'anim-walk.json sha256 must match vendored bytes');
  assert.ok(rawBytes.length <= 500 * 1024, 'anim-walk.json must stay under 500 KB');

  const data = JSON.parse(rawBytes.toString('utf8'));
  assert.equal(data.name, 'Walk');
  assert.equal(data.cc0, true);
  assert.deepEqual(Object.keys(data).sort(), ['cc0', 'hips', 'name', 'times', 'tracks']);
});

test('vendored anim-walk.json times are strictly increasing 0..1.3333 at ~30 fps and hips are finite', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'anim', 'anim-walk.json'), 'utf8'));

  assert.equal(data.times.length, 41);
  assert.equal(data.times[0], 0);
  assert.equal(data.times[40], 1.3333);

  const steps = new Set();
  for (let i = 1; i < data.times.length; i++) {
    assert.ok(data.times[i] > data.times[i - 1], `times[${i}] must be strictly greater than times[${i - 1}]`);
    steps.add(Number((data.times[i] - data.times[i - 1]).toFixed(4)));
  }
  assert.deepEqual([...steps].sort((a, b) => a - b), [0.0333, 0.0334]);

  assert.equal(data.hips.length, 123);
  for (let i = 0; i < data.hips.length; i++) {
    assert.equal(Number.isFinite(data.hips[i]), true, `hips[${i}] must be finite`);
  }
});

test('vendored anim-walk.json tracks are the 22 Mixamo bones with finite unit quaternions in both builders', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'anim', 'anim-walk.json'), 'utf8'));
  const trackKeys = Object.keys(data.tracks);
  assert.equal(trackKeys.length, 22);

  const villagerSrc = fs.readFileSync(path.join(__dirname, 'kit-medieval', 'villager.mjs'), 'utf8');
  const tradesmanSrc = fs.readFileSync(path.join(__dirname, 'kit-medieval', 'tradesman.mjs'), 'utf8');

  for (const [bone, values] of Object.entries(data.tracks)) {
    assert.ok(MIXAMO_HUMANOID_BONES.has(bone), `unexpected track bone "${bone}"`);
    assert.ok(villagerSrc.includes(bone), `villager.mjs must contain bone "${bone}"`);
    assert.ok(tradesmanSrc.includes(bone), `tradesman.mjs must contain bone "${bone}"`);
    assert.equal(values.length, 164, `track ${bone} must have 41 * 4 values`);
    for (let i = 0; i < values.length; i++) {
      assert.equal(Number.isFinite(values[i]), true, `track ${bone}[${i}] must be finite`);
    }
    for (let i = 0; i < values.length; i += 4) {
      const norm = Math.hypot(values[i], values[i + 1], values[i + 2], values[i + 3]);
      assert.ok(
        Math.abs(norm - 1) <= 1e-3,
        `track ${bone} quaternion at ${i / 4} has norm ${norm} outside 1e-3 of 1`
      );
    }
  }
});

test('vendored anim-walk.json hips bob ranges match exact min/max bounds', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'anim', 'anim-walk.json'), 'utf8'));
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < data.hips.length; i += 3) {
    const x = data.hips[i];
    const y = data.hips[i + 1];
    const z = data.hips[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  assert.deepEqual([minX, maxX], [-0.0327, 0.0407]);
  assert.deepEqual([minY, maxY], [-0.0534, 0.0011]);
  assert.deepEqual([minZ, maxZ], [0, 0.0003]);
});

test('vendored anim-idle.json and anim-walk.json drive the exact same 22 bones and carry clip metadata', () => {
  const idle = JSON.parse(fs.readFileSync(path.join(__dirname, 'anim', 'anim-idle.json'), 'utf8'));
  const walk = JSON.parse(fs.readFileSync(path.join(__dirname, 'anim', 'anim-walk.json'), 'utf8'));

  assert.deepEqual(Object.keys(walk.tracks).sort(), Object.keys(idle.tracks).sort());
  assert.equal(idle.name, 'Idle');
  assert.equal(idle.cc0, true);
  assert.equal(walk.name, 'Walk');
  assert.equal(walk.cc0, true);
});

test('default animate path wires npc-animation.mjs through kit-medieval/clips.mjs to _internal/clips.mjs', () => {
  const npcAnimSrc = fs.readFileSync(path.join(__dirname, 'npc-animation.mjs'), 'utf8');
  assert.ok(npcAnimSrc.includes("await import('./kit-medieval/clips.mjs')"));
  assert.ok(npcAnimSrc.includes('.animate'));

  const clipsWrapperSrc = fs.readFileSync(path.join(__dirname, 'kit-medieval', 'clips.mjs'), 'utf8');
  assert.ok(clipsWrapperSrc.includes("export * from './_internal/clips.mjs'"));

  const internalClipsSrc = fs.readFileSync(path.join(__dirname, 'kit-medieval', '_internal', 'clips.mjs'), 'utf8');
  assert.ok(internalClipsSrc.includes('export const CLIP_NAMES'));
  assert.ok(internalClipsSrc.includes("'Idle'"));
  assert.ok(internalClipsSrc.includes("'Walk'"));
  assert.ok(internalClipsSrc.includes('export async function animate('));
});

test('attachIdleAnimation and attachNpcAnimation strip extra option keys before calling animateFn', async () => {
  const seen = [];
  const fakeAnimate = async (_group, opts) => {
    seen.push(opts);
    return { update() {} };
  };

  await attachIdleAnimation({}, { name: 'idle' }, {
    animateFn: fakeAnimate,
    base: './custom/',
    fade: 0.2,
    inPlace: false,
  });
  await attachNpcAnimation({}, { name: 'npc' }, {
    animateFn: fakeAnimate,
    extra: 'nope',
  });

  assert.deepEqual(seen, [
    { clips: ['Idle'], base: './custom/' },
    { clips: ['Idle', 'Walk'], base: './anim/' },
  ]);
});

test('attachIdleAnimation and attachNpcAnimation resolve handles from synchronous animateFn', async () => {
  const handle = { update() {} };
  const handle2 = { update() {}, locomotion() {} };

  const res1 = await attachIdleAnimation({}, { name: 'sync-idle' }, { animateFn: () => handle });
  const res2 = await attachNpcAnimation({}, { name: 'sync-npc' }, { animateFn: () => handle2 });

  assert.equal(res1, handle);
  assert.equal(res2, handle2);
});

test('thrown null or undefined in attachIdleAnimation and updateNpcAnimations warns once with empty value', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const resNull = await attachIdleAnimation({}, { name: 'null-throw' }, {
      animateFn: async () => {
        throw null;
      },
    });
    assert.equal(resNull, null);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('[npc-animation]'));
    assert.ok(warnings[0].includes('Idle clip'));
    assert.ok(warnings[0].includes('stand-in stays still'));
    assert.equal(warnings[0].endsWith('stand-in stays still: '), true);

    warnings.length = 0;
    const resUndef = await attachIdleAnimation({}, { name: 'undef-throw' }, {
      animateFn: async () => {
        throw undefined;
      },
    });
    assert.equal(resUndef, null);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].endsWith('stand-in stays still: '), true);

    warnings.length = 0;
    const goodCalls = [];
    const standIns = new Map([
      ['bad', { anim: { update: () => { throw null; } } }],
      ['good', { anim: { update: (dt) => goodCalls.push(dt) } }],
    ]);
    updateNpcAnimations(standIns, 0.025);
    assert.deepEqual(goodCalls, [0.025]);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('[npc-animation] anim.update failed:'));
    assert.equal(warnings[0].endsWith('anim.update failed: '), true);
  } finally {
    console.warn = origWarn;
  }
});

test('updateNpcAnimations honors custom .values(), rejects non-iterable objects, and staging.js stores standIn.anim', () => {
  const calls = [];
  const customContainer = {
    values() {
      return [{ anim: { update: (dt) => calls.push(dt) } }][Symbol.iterator]();
    },
  };
  updateNpcAnimations(customContainer, 0.04);
  assert.deepEqual(calls, [0.04]);

  assert.throws(() => updateNpcAnimations({ a: 1 }, 0.016), TypeError);

  const stagingSrc = fs.readFileSync(path.join(__dirname, 'staging.js'), 'utf8');
  assert.ok(stagingSrc.includes('attachNpcAnimation(THREE, standIn.group, { animateFn: animate }).then((anim) => {'));
  assert.ok(stagingSrc.includes('standIn.anim = anim;'));
  assert.ok(stagingSrc.includes("['wick', {"));
  assert.ok(stagingSrc.includes("['maren', {"));
  assert.ok(stagingSrc.includes("['tomas', {"));
});

test('vendored anim-idle.json top-level schema and exact 22-bone Mixamo track set', () => {
  const idle = JSON.parse(fs.readFileSync(path.join(__dirname, 'anim', 'anim-idle.json'), 'utf8'));
  assert.deepEqual(Object.keys(idle).sort(), ['cc0', 'hips', 'name', 'times', 'tracks']);
  assert.equal(Object.keys(idle.tracks).length, 22);
  assert.deepEqual(new Set(Object.keys(idle.tracks)), MIXAMO_HUMANOID_BONES);
  assert.equal(idle.name, 'Idle');
  assert.equal(idle.cc0, true);
});

test('vendored anim-idle.json has 76 times at ~30 fps steps, 228 hips values, and 304 values per track', () => {
  const idle = JSON.parse(fs.readFileSync(path.join(__dirname, 'anim', 'anim-idle.json'), 'utf8'));
  assert.equal(idle.times.length, 76);
  assert.equal(idle.times[0], 0);
  assert.equal(idle.times[75], 2.5);

  const steps = new Set();
  for (let i = 1; i < idle.times.length; i++) {
    steps.add(Number((idle.times[i] - idle.times[i - 1]).toFixed(4)));
  }
  assert.deepEqual([...steps].sort((a, b) => a - b), [0.0333, 0.0334]);

  assert.equal(idle.hips.length, 228);
  for (const [bone, values] of Object.entries(idle.tracks)) {
    assert.equal(values.length, 304, `track ${bone} must have 76 * 4 values`);
  }
});

test('vendored anim-idle.json hips bob ranges match exact min/max bounds', () => {
  const idle = JSON.parse(fs.readFileSync(path.join(__dirname, 'anim', 'anim-idle.json'), 'utf8'));
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < idle.hips.length; i += 3) {
    const x = idle.hips[i];
    const y = idle.hips[i + 1];
    const z = idle.hips[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  assert.deepEqual([minX, minY, minZ], [-0.0026, -0.0498, -0.0395]);
  assert.deepEqual([maxX, maxY, maxZ], [0.0055, -0.041, -0.0374]);
});

test('attachNpcAnimation warns with thrown string value and Idle/Walk label when non-Error is thrown', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const result = await attachNpcAnimation({}, { name: 'plain-npc' }, {
      animateFn: async () => {
        throw 'plain failure';
      },
    });
    assert.equal(result, null);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('[npc-animation]'));
    assert.ok(warnings[0].includes('Idle/Walk clips'));
    assert.ok(warnings[0].includes('failed to attach'));
    assert.ok(warnings[0].includes('stand-in stays still'));
    assert.ok(warnings[0].includes('plain failure'));
  } finally {
    console.warn = origWarn;
  }
});

test('attachIdleAnimation warns with stringified thrown number and plain object', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const numResult = await attachIdleAnimation({}, { name: 'num-err' }, {
      animateFn: async () => {
        throw 42;
      },
    });
    assert.equal(numResult, null);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('42'));

    warnings.length = 0;
    const objResult = await attachIdleAnimation({}, { name: 'obj-err' }, {
      animateFn: async () => {
        throw {};
      },
    });
    assert.equal(objResult, null);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('[object Object]'));
  } finally {
    console.warn = origWarn;
  }
});

test('attachIdleAnimation and attachNpcAnimation with no options warn once and return null', async () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const idleResult = await attachIdleAnimation({}, { name: 'no-opts-idle' });
    assert.equal(idleResult, null);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('[npc-animation]'));
    assert.ok(warnings[0].includes('failed to attach'));

    warnings.length = 0;
    const npcResult = await attachNpcAnimation({}, { name: 'no-opts-npc' });
    assert.equal(npcResult, null);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('[npc-animation]'));
    assert.ok(warnings[0].includes('failed to attach'));
  } finally {
    console.warn = origWarn;
  }
});

test('attachIdleAnimation passes empty string base verbatim while explicit undefined falls back to default', async () => {
  const seen = [];
  const fakeAnimate = async (_group, opts) => {
    seen.push(opts);
    return { update() {} };
  };

  await attachIdleAnimation({}, { name: 'empty-base' }, { animateFn: fakeAnimate, base: '' });
  await attachNpcAnimation({}, { name: 'undef-base' }, { animateFn: fakeAnimate, base: undefined });

  assert.deepEqual(seen, [
    { clips: ['Idle'], base: '' },
    { clips: ['Idle', 'Walk'], base: './anim/' },
  ]);
});

test('updateNpcAnimations handles mid-call self-nulling anim, return values, string input, and non-iterable .values()', () => {
  const recorded = [];
  const selfNulling = {
    anim: {
      update(dt) {
        recorded.push(dt);
        selfNulling.anim = null;
      },
    },
  };
  const surviving = {
    anim: {
      update(dt) {
        recorded.push(dt);
      },
    },
  };
  const standIns = new Map([
    ['first', selfNulling],
    ['second', surviving],
  ]);

  updateNpcAnimations(standIns, 0.016);
  assert.deepEqual(recorded, [0.016, 0.016]);

  recorded.length = 0;
  updateNpcAnimations(standIns, 0.033);
  assert.deepEqual(recorded, [0.033]);

  const nextCalls = [];
  const retStandIns = new Map([
    ['ret', { anim: { update: () => 'ok' } }],
    ['next', { anim: { update: (dt) => nextCalls.push(dt) } }],
  ]);
  assert.doesNotThrow(() => updateNpcAnimations(retStandIns, 0.02));
  assert.deepEqual(nextCalls, [0.02]);

  assert.doesNotThrow(() => updateNpcAnimations('wick', 0.016));
  assert.throws(() => updateNpcAnimations({ values: () => 42 }, 0.016), TypeError);
});

test('staging.js NPC stand-in wiring has exact call-site counts, homes, and figure specs', () => {
  const src = fs.readFileSync(path.join(__dirname, 'staging.js'), 'utf8');
  assert.equal(src.split('attachNpcAnimation(').length - 1, 1);
  assert.equal(src.split('updateNpcAnimations(').length - 1, 1);
  assert.ok(src.includes('updateNpcAnimations(npcStandIns, dt);'));
  assert.ok(src.includes('counts.npcs = npcStandIns.size;'));

  assert.ok(src.includes('{ x: 4.16, z: 4.99 }'));
  assert.ok(src.includes('{ x: -3.53, z: 5.46 }'));
  assert.ok(src.includes('{ x: 0.76, z: -6.46 }'));

  assert.ok(src.includes("figure: 'masculine', age: 'adult', expression: 'alert', build: 0.9"));
  assert.ok(src.includes("tunic: '#7a6a55'"));
  assert.ok(src.includes("figure: 'feminine', age: 'old', expression: 'warm', build: 0.9"));
  assert.ok(src.includes("tunic: '#6a7a8a'"));
  assert.ok(src.includes("figure: 'masculine', age: 'old', expression: 'warm', build: 1.0"));
  assert.ok(src.includes("tunic: '#8a7a5a'"));
});

test('file hygiene: 45 unique names, 7 imports, zero banned terms, pinned as-true counts', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-npc-animation.mjs'), 'utf8');
  const lines = src.split('\n');

  const names = [];
  for (const line of lines) {
    const m = /^test\('([^']+)'/.exec(line);
    if (m) names.push(m[1]);
  }
  assert.equal(names.length, 45);
  assert.equal(new Set(names).size, 45);

  const importLines = lines.filter((l) => l.startsWith('import '));
  assert.equal(importLines.length, 7);

  const countLines = (needle) => lines.filter((l) => l.includes(needle)).length;
  assert.equal(countLines('TO' + 'DO'), 0);
  assert.equal(countLines('FIX' + 'ME'), 0);
  assert.equal(countLines('Date' + '.now'), 0);
  assert.equal(countLines('fet' + 'ch('), 2);
  assert.equal(countLines('Math' + '.random'), 2);
});
