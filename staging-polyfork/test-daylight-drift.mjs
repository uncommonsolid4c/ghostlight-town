import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DAYLIGHT_DRIFT_CONFIG,
  daylightAt,
  buildDaylightDrift,
} from './daylight-drift.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(__dirname, 'daylight-drift.mjs');

const KIT_NIGHT = {
  sky: 0x070b1c,
  horizon: 0x1b2748,
  hemiSky: 0x53659e,
  hemiGround: 0x1b2032,
  hemi: 0.70,
  key: 0xaec6ff,
  keyI: 0.75,
  rim: 0x5a6cc0,
  rimI: 0.45,
  elev: 40,
  fog: 0.75,
  night: 1,
};

const KIT_DAWN = {
  sky: 0x8fa9d8,
  horizon: 0xffc9b4,
  hemiSky: 0xdfe6ff,
  hemiGround: 0x8d879c,
  hemi: 0.82,
  key: 0xffcdb8,
  keyI: 1.95,
  rim: 0xa4b4ff,
  rimI: 0.80,
  elev: 11,
  fog: 0.80,
  night: 0.35,
};

const KIT_OVERCAST = {
  sky: 0xb4bfca,
  horizon: 0xd8dde2,
  hemiSky: 0xffffff,
  hemiGround: 0xaeb0b2,
  hemi: 1.50,
  key: 0xeef2f6,
  keyI: 0.85,
  rim: 0xdde4ee,
  rimI: 0.45,
  elev: 58,
  fog: 0.72,
  night: 0,
};

function makeStubColor(initial = 0) {
  return {
    hex: initial,
    setHex(v) {
      this.hex = v;
    },
  };
}

function makeStubLook() {
  const vertices = [0, 60, 0, 60, 0, 0, 0, 30, 52];
  const colorArr = new Float32Array(vertices.length);
  const posAttr = {
    count: vertices.length / 3,
    getY(i) {
      return vertices[i * 3 + 1];
    },
  };
  const colAttr = {
    array: colorArr,
    needsUpdate: false,
    setXYZ(i, r, g, b) {
      colorArr[i * 3] = r;
      colorArr[i * 3 + 1] = g;
      colorArr[i * 3 + 2] = b;
    },
  };
  return {
    hemi: {
      color: makeStubColor(),
      groundColor: makeStubColor(),
      intensity: 0.70,
    },
    key: {
      color: makeStubColor(),
      intensity: 0.75,
    },
    rim: {
      color: makeStubColor(),
      intensity: 0.45,
    },
    sky: {
      geometry: {
        attributes: {
          position: posAttr,
          color: colAttr,
        },
      },
    },
    elevation: 40,
    night: 1,
    setTime() {
      throw new Error('look.setTime must never be called by daylight-drift');
    },
  };
}

test('keyframe exactness: daylightAt(0, 0.25, 0.5, 0.75, 1.0) match kit night/dawn/overcast values', () => {
  assert.equal(DAYLIGHT_DRIFT_CONFIG.cycleSeconds, 1800);
  assert.deepEqual(daylightAt(0), KIT_NIGHT);
  assert.deepEqual(daylightAt(0.25), KIT_DAWN);
  assert.deepEqual(daylightAt(0.5), KIT_OVERCAST);
  assert.deepEqual(daylightAt(0.75), KIT_DAWN);
  assert.deepEqual(daylightAt(1.0), KIT_NIGHT);
});

test('cap invariants: 1% sampling stays below noon and keyframes exclude banned presets', () => {
  const forbidden = new Set(['noon', 'day', 'golden', 'dusk', 'moonlit', 'space']);
  for (const kf of DAYLIGHT_DRIFT_CONFIG.keyframes) {
    assert.ok(!forbidden.has(kf.name), `Forbidden preset in keyframes: ${kf.name}`);
    assert.ok(['night', 'dawn', 'overcast'].includes(kf.name), `Unexpected keyframe: ${kf.name}`);
  }

  for (let i = 0; i <= 100; i++) {
    const p = daylightAt(i / 100);
    assert.ok(p.keyI <= 1.95 + 1e-12, `keyI exceeded cap at ${i}%: ${p.keyI}`);
    assert.ok(p.hemi <= 1.50 + 1e-12, `hemi exceeded cap at ${i}%: ${p.hemi}`);
    assert.ok(p.night >= 0 && p.night <= 1, `night out of [0,1] at ${i}%: ${p.night}`);
    assert.ok(p.fog >= 0.72 - 1e-12 && p.fog <= 0.80 + 1e-12, `fog out of [0.72,0.80] at ${i}%: ${p.fog}`);
    assert.notEqual(p.sky, 0x66aef2, `sky top color must never equal noon blue 0x66aef2 at ${i}%`);
  }
});

test('wrap continuity: daylightAt(0) deep-equals daylightAt(1) and keyframes have no jumps', () => {
  assert.deepEqual(daylightAt(0), daylightAt(1));
  assert.deepEqual(daylightAt(-0.25), daylightAt(0.75));
  assert.deepEqual(daylightAt(1.5), daylightAt(0.5));

  for (const kf of [0, 0.25, 0.5, 0.75]) {
    const before = daylightAt(kf - 0.001);
    const at = daylightAt(kf);
    const after = daylightAt(kf + 0.001);
    assert.ok(Math.abs(before.night - at.night) < 0.01, `night jump before ${kf}`);
    assert.ok(Math.abs(after.night - at.night) < 0.01, `night jump after ${kf}`);
    assert.ok(Math.abs(before.hemi - at.hemi) < 0.01, `hemi jump before ${kf}`);
    assert.ok(Math.abs(after.hemi - at.hemi) < 0.01, `hemi jump after ${kf}`);
  }
});

test('easing: night factor moves monotonically within each leg', () => {
  const legs = [
    { start: 0.00, end: 0.25, dir: -1 },
    { start: 0.25, end: 0.50, dir: -1 },
    { start: 0.50, end: 0.75, dir: 1 },
    { start: 0.75, end: 1.00, dir: 1 },
  ];
  for (const leg of legs) {
    let prev = daylightAt(leg.start).night;
    for (let step = 1; step <= 25; step++) {
      const f = leg.start + ((leg.end - leg.start) * step) / 25;
      const cur = daylightAt(f).night;
      if (leg.dir < 0) {
        assert.ok(cur <= prev + 1e-12, `Expected non-increasing night on [${leg.start}, ${leg.end}]`);
      } else {
        assert.ok(cur >= prev - 1e-12, `Expected non-decreasing night on [${leg.start}, ${leg.end}]`);
      }
      prev = cur;
    }
  }
});

test('stars: buildDaylightDrift sets opacity and visibility from night factor (1 at night, 0 + hidden at overcast)', () => {
  const look = makeStubLook();
  const stars = { visible: false, material: { opacity: 0 } };
  const drift = buildDaylightDrift(look, { stars });

  drift.update(0);
  assert.equal(stars.material.opacity, 1);
  assert.equal(stars.visible, true);

  drift.update(DAYLIGHT_DRIFT_CONFIG.cycleSeconds * 0.5);
  assert.equal(stars.material.opacity, 0);
  assert.equal(stars.visible, false);
});

test('applier: update(dt) sets hemi/key/rim, elevation, night, dome colors, fog, and never calls setTime', () => {
  const look = makeStubLook();
  const fog = { color: makeStubColor(), near: 0, far: 0 };
  const drift = buildDaylightDrift(look, { fog, far: 320 });

  drift.update(DAYLIGHT_DRIFT_CONFIG.cycleSeconds * 0.25);

  assert.equal(look.hemi.color.hex, KIT_DAWN.hemiSky);
  assert.equal(look.hemi.groundColor.hex, KIT_DAWN.hemiGround);
  assert.equal(look.hemi.intensity, KIT_DAWN.hemi);
  assert.equal(look.key.color.hex, KIT_DAWN.key);
  assert.equal(look.key.intensity, KIT_DAWN.keyI);
  assert.equal(look.rim.color.hex, KIT_DAWN.rim);
  assert.equal(look.rim.intensity, KIT_DAWN.rimI);
  assert.equal(look.elevation, KIT_DAWN.elev);
  assert.equal(look.night, KIT_DAWN.night);
  assert.equal(look.sky.geometry.attributes.color.needsUpdate, true);
  assert.equal(fog.color.hex, KIT_DAWN.horizon);
  assert.equal(fog.near, 320 * 0.4 * KIT_DAWN.fog);
  assert.equal(fog.far, 320 * 1.1 * KIT_DAWN.fog);
  assert.ok(Math.abs(drift.phase - 0.25) < 1e-12);
});

test('static hygiene: daylight-drift.mjs contains no campfire, fetch(, or Math.random', async () => {
  const src = await fs.promises.readFile(MODULE_PATH, 'utf8');
  assert.ok(!/campfire/i.test(src), 'daylight-drift.mjs must not mention campfire');
  assert.ok(!src.includes('fetch('), 'daylight-drift.mjs must not call fetch(');
  assert.ok(!src.includes('Math.random'), 'daylight-drift.mjs must not use Math.random');
});
