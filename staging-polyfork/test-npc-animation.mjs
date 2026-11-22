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
