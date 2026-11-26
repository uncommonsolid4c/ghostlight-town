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

test('night quantization: look.night writes only on >= 0.01 moves, with exact 0/1 endpoints forced', () => {
  const look = { night: 1 };
  const drift = buildDaylightDrift(look);

  drift.update(1);
  assert.equal(look.night, 1);

  drift.update(59);
  assert.equal(look.night, 0.9684148148148146);
  assert.equal(look.night, daylightAt(60 / 1800).night);

  const look2 = { night: 1 };
  const drift2 = buildDaylightDrift(look2);
  drift2.update(899);
  assert.ok(Math.abs(look2.night - 0.000005177503429321106) < 1e-9);
  drift2.update(1);
  assert.equal(look2.night, 0);
});

test('clock discipline: bad dt never advances the clock and phase wraps', () => {
  const drift = buildDaylightDrift({ night: 1 });

  drift.update(0);
  drift.update(-5);
  drift.update(NaN);
  drift.update('60');
  drift.update(undefined);
  assert.equal(drift.phase, 0);

  drift.update(1800);
  assert.equal(drift.phase, 0);

  drift.update(900);
  assert.equal(drift.phase, 0.5);

  assert.deepEqual(daylightAt(NaN), daylightAt(0));
});

test('sky-dome gradient: vertex colors are linear-RGB gradient between horizon and sky', () => {
  const look = makeStubLook();
  const drift = buildDaylightDrift(look, {});
  drift.update(450);

  const arr = look.sky.geometry.attributes.color.array;
  const topExpected = [0.274677, 0.396755, 0.686685];
  const horExpected = [1, 0.584078, 0.456411];
  const k = Math.pow(0.5, 0.55);

  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(arr[c] - topExpected[c]) < 1e-6, `top channel ${c}: ${arr[c]}`);
    assert.ok(Math.abs(arr[3 + c] - horExpected[c]) < 1e-6, `horizon channel ${c}: ${arr[3 + c]}`);
    const midExpected = horExpected[c] + (topExpected[c] - horExpected[c]) * k;
    assert.ok(Math.abs(arr[6 + c] - midExpected) < 1e-6, `mid channel ${c}: ${arr[6 + c]}`);
  }
});

test('graceful degradation + fog fallback chain', () => {
  const minimal = { night: 1 };
  const minimalDrift = buildDaylightDrift(minimal);
  const params = minimalDrift.update(0);
  assert.equal(params.night, 1);

  const sceneFog = { color: makeStubColor(), near: 0, far: 0 };
  const sceneDrift = buildDaylightDrift(makeStubLook(), { scene: { fog: sceneFog } });
  sceneDrift.update(450);
  assert.equal(sceneFog.near, 102.4);
  assert.equal(sceneFog.far, 281.6);
  assert.equal(sceneFog.color.hex, KIT_DAWN.horizon);

  const lookWithFog = { ...makeStubLook(), fog: { color: makeStubColor(), near: 0, far: 0 } };
  const lookFogDrift = buildDaylightDrift(lookWithFog);
  lookFogDrift.update(450);
  assert.equal(lookWithFog.fog.near, 102.4);

  const stars = { visible: false };
  const starsDrift = buildDaylightDrift(makeStubLook(), { stars });
  starsDrift.update(0);
  assert.equal(stars.visible, true);
});

function mkFog() {
  return { color: makeStubColor(), near: 0, far: 0 };
}

test('mid-leg interpolation: smoothstep easing pins exact numeric + hex values at f=0.125 and f=0.0625', () => {
  const p125 = daylightAt(0.125);
  assert.deepEqual(p125, {
    sky: 0x687ca0,
    horizon: 0xbc958c,
    hemiSky: 0xacb5d6,
    hemiGround: 0x686476,
    hemi: 0.76,
    key: 0xdbcadf,
    keyI: 1.35,
    rim: 0x8696e2,
    rimI: 0.625,
    elev: 25.5,
    fog: 0.775,
    night: 0.675,
  });

  const p0625 = daylightAt(0.0625);
  assert.equal(p0625.sky, 0x3c4860);
  assert.equal(p0625.horizon, 0x715d63);
  assert.equal(p0625.hemiSky, 0x7885b2);
  assert.equal(p0625.hemiGround, 0x403f4f);
  assert.equal(p0625.hemi, 0.71875);
  assert.equal(p0625.key, 0xbec7f6);
  assert.equal(p0625.keyI, 0.9375);
  assert.equal(p0625.rim, 0x6a7bcc);
  assert.ok(Math.abs(p0625.rimI - 0.5046875) < 1e-12);
  assert.equal(p0625.elev, 35.46875);
  assert.equal(p0625.fog, 0.7578125);
  assert.equal(p0625.night, 0.8984375);
});

test('daylightAt input discipline: non-finite and non-number fractions fall back to night', () => {
  const night = daylightAt(0);
  for (const bad of [Infinity, -Infinity, NaN, '0.5', null, undefined, {}]) {
    assert.deepEqual(daylightAt(bad), night);
  }
  assert.deepEqual(daylightAt(2.5), daylightAt(0.5));
  assert.deepEqual(daylightAt(-1.5), daylightAt(0.5));
});

test('update returns the applied params: deep-equal to daylightAt(phase)', () => {
  const drift1 = buildDaylightDrift({ night: 1 });
  assert.deepEqual(drift1.update(450), daylightAt(0.25));
  assert.deepEqual(drift1.update(450), daylightAt(0.5));

  const drift2 = buildDaylightDrift({ night: 1 });
  drift2.update(100);
  drift2.update(100);
  const third = drift2.update(100);
  assert.ok(Math.abs(drift2.phase - 1 / 6) < 1e-12);
  assert.deepEqual(third, daylightAt(1 / 6));
});

test('fog precedence: explicit fog beats scene.fog beats look.fog', () => {
  const fogA = mkFog();
  const fogB = mkFog();
  const fogC = mkFog();
  const drift1 = buildDaylightDrift(
    { ...makeStubLook(), fog: fogC },
    { fog: fogA, scene: { fog: fogB } }
  );
  drift1.update(450);
  assert.equal(fogA.near, 102.4);
  assert.equal(fogA.color.hex, 0xffc9b4);
  assert.equal(fogB.near, 0);
  assert.equal(fogB.color.hex, 0);
  assert.equal(fogC.near, 0);
  assert.equal(fogC.color.hex, 0);

  const fogB2 = mkFog();
  const fogC2 = mkFog();
  const drift2 = buildDaylightDrift(
    { ...makeStubLook(), fog: fogC2 },
    { scene: { fog: fogB2 } }
  );
  drift2.update(450);
  assert.equal(fogB2.near, 102.4);
  assert.equal(fogC2.near, 0);
});

test('stars dawn boundary + custom far scales fog', () => {
  const stars = { visible: false, material: { opacity: 0 } };
  const driftStars = buildDaylightDrift(makeStubLook(), { stars });
  driftStars.update(450);
  assert.equal(stars.material.opacity, 0.35);
  assert.equal(stars.visible, true);

  const fog = mkFog();
  const driftFog = buildDaylightDrift(makeStubLook(), { fog, far: 100 });
  driftFog.update(900);
  assert.ok(Math.abs(fog.near - 28.8) < 1e-9);
  assert.equal(fog.far, 79.2);
});

test('partial look robustness + frozen config: missing color objects and sky geometry never throw', () => {
  const partialLook = { night: 1, hemi: { intensity: 0 }, key: {}, rim: {}, sky: {} };
  const drift1 = buildDaylightDrift(partialLook);
  const res = drift1.update(450);
  assert.equal(partialLook.hemi.intensity, 0.82);
  assert.equal(partialLook.key.intensity, 1.95);
  assert.deepEqual(res, daylightAt(0.25));

  const noColorAttrLook = {
    night: 1,
    sky: { geometry: { attributes: { position: { count: 1, getY: () => 60 } } } },
  };
  const drift2 = buildDaylightDrift(noColorAttrLook);
  drift2.update(0);

  assert.equal(Object.isFrozen(DAYLIGHT_DRIFT_CONFIG), true);
  assert.equal(Object.isFrozen(DAYLIGHT_DRIFT_CONFIG.keyframes), true);
  for (const kf of DAYLIGHT_DRIFT_CONFIG.keyframes) {
    assert.equal(Object.isFrozen(kf), true);
  }
  assert.deepEqual(
    DAYLIGHT_DRIFT_CONFIG.keyframes.map((kf) => kf.at),
    [0, 0.25, 0.5, 0.75, 1]
  );
  assert.deepEqual(
    DAYLIGHT_DRIFT_CONFIG.keyframes.map((kf) => kf.name),
    ['night', 'dawn', 'overcast', 'dawn', 'night']
  );
});

const KIT_STAGE_PATH = path.join(__dirname, 'kit-campground', '_internal', 'stage.mjs');

test('other-leg midpoints: daylightAt(0.375, 0.625, 0.875) pin exact values and leg symmetry', () => {
  const p375 = daylightAt(0.375);
  assert.deepEqual(p375, {
    sky: 0xa3b4d1,
    horizon: 0xedd3cd,
    hemiSky: 0xf0f3ff,
    hemiGround: 0x9f9da7,
    hemi: 1.16,
    key: 0xf7e1da,
    keyI: 1.4,
    rim: 0xc3cef7,
    rimI: 0.625,
    elev: 34.5,
    fog: 0.76,
    night: 0.175,
  });

  assert.deepEqual(daylightAt(0.625), p375);

  assert.deepEqual(daylightAt(0.875), {
    sky: 0x687ca0,
    horizon: 0xbc958c,
    hemiSky: 0xacb5d6,
    hemiGround: 0x686476,
    hemi: 0.76,
    key: 0xdbcadf,
    keyI: 1.35,
    rim: 0x8696e2,
    rimI: 0.625,
    elev: 25.5,
    fog: 0.775,
    night: 0.675,
  });

  assert.equal(p375.hemi, (0.82 + 1.50) / 2);
  assert.equal(p375.keyI, (1.95 + 0.85) / 2);
  assert.equal(p375.elev, (11 + 58) / 2);
  assert.equal(p375.fog, (0.80 + 0.72) / 2);
  assert.equal(p375.night, (0.35 + 0) / 2);
});

test('daylightAt returns fresh objects: mutating a result never touches the config', () => {
  const a = daylightAt(0.25);
  const b = daylightAt(0.25);
  assert.notEqual(a, b);
  assert.deepEqual(a, b);

  a.night = 999;
  a.sky = 0;

  assert.deepEqual(daylightAt(0.25), KIT_DAWN);
  assert.equal(DAYLIGHT_DRIFT_CONFIG.keyframes[1].night, 0.35);
  assert.equal(DAYLIGHT_DRIFT_CONFIG.keyframes[1].sky, 0x8fa9d8);
});

test('night quantization counts writes: sub-0.01 moves write nothing', () => {
  let storedNight = 1;
  let writes = 0;
  const look = {};
  Object.defineProperty(look, 'night', {
    configurable: true,
    get() {
      return storedNight;
    },
    set(v) {
      writes++;
      storedNight = v;
    },
  });

  const drift = buildDaylightDrift(look);

  drift.update(1);
  assert.equal(writes, 0);

  drift.update(59);
  assert.equal(writes, 1);
  assert.equal(storedNight, 0.9684148148148146);

  drift.update(1);
  assert.equal(writes, 1);

  drift.update(839);
  assert.equal(storedNight, 0);
  assert.ok(writes >= 2);
});

test('sky-dome clamping: below-horizon vertices take the horizon color, above-dome vertices extrapolate', () => {
  const ys = [-30, 0, 120];
  const colorArr = new Float32Array(ys.length * 3);
  const look = {
    night: 1,
    sky: {
      geometry: {
        attributes: {
          position: {
            count: ys.length,
            getY(i) {
              return ys[i];
            },
          },
          color: {
            array: colorArr,
            needsUpdate: false,
            setXYZ(i, r, g, b) {
              colorArr[i * 3] = r;
              colorArr[i * 3 + 1] = g;
              colorArr[i * 3 + 2] = b;
            },
          },
        },
      },
    },
  };

  buildDaylightDrift(look).update(0);

  const hor = [0.010960, 0.020289, 0.064803];
  const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const top = [7 / 255, 11 / 255, 28 / 255].map(srgbToLin);
  const k = Math.pow(2, 0.55);

  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(colorArr[c] - hor[c]) < 1e-6, `y=-30 channel ${c}: ${colorArr[c]}`);
    assert.ok(Math.abs(colorArr[3 + c] - hor[c]) < 1e-6, `y=0 channel ${c}: ${colorArr[3 + c]}`);
    const expectedTop = hor[c] + (top[c] - hor[c]) * k;
    assert.ok(Math.abs(colorArr[6 + c] - expectedTop) < 1e-6, `y=120 channel ${c}: ${colorArr[6 + c]}`);
  }
  assert.equal(look.sky.geometry.attributes.color.needsUpdate, true);
});

test('fog pins: night and overcast near/far, 2.75 ratio at every phase, custom far', () => {
  const fogNight = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogNight, far: 320 }).update(0);
  assert.equal(fogNight.near, 96);
  assert.equal(fogNight.far, 264);
  assert.equal(fogNight.color.hex, 0x1b2748);

  const fogOvercast = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogOvercast, far: 320 }).update(900);
  assert.ok(Math.abs(fogOvercast.near - 92.16) < 1e-9);
  assert.ok(Math.abs(fogOvercast.far - 253.44) < 1e-9);
  assert.equal(fogOvercast.color.hex, 0xd8dde2);

  for (let i = 0; i <= 20; i++) {
    const fog = mkFog();
    buildDaylightDrift(makeStubLook(), { fog, far: 320 }).update((1800 * i) / 20);
    assert.ok(Math.abs(fog.far / fog.near - 2.75) < 1e-9, `ratio at step ${i}`);
  }

  const fogCustom = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogCustom, far: 100 }).update(0);
  assert.equal(fogCustom.near, 30);
  assert.ok(Math.abs(fogCustom.far - 82.5) < 1e-9);
});

test('kit fidelity: drift presets are verbatim copies of kit stage.mjs TIMES night + LOOKS dawn/overcast', async () => {
  const src = await fs.promises.readFile(KIT_STAGE_PATH, 'utf8');
  const nightMatch = src.match(/\{ at: 1\.00, name: 'night',([^}]+)\}/);
  const dawnMatch = src.match(/dawn:\s*\{([^}]+)\}/);
  const overcastMatch = src.match(/overcast:\s*\{([^}]+)\}/);
  const noonMatch = src.match(/noon:\s*\{([^}]+)\}/);

  assert.ok(nightMatch, 'TIMES night row missing');
  assert.ok(dawnMatch, 'LOOKS dawn row missing');
  assert.ok(overcastMatch, 'LOOKS overcast row missing');
  assert.ok(noonMatch, 'LOOKS noon row missing');

  const parseFields = (body) => {
    const out = {};
    for (const m of body.matchAll(/(\w+):\s*(0x[0-9a-fA-F]+|-?\d+(?:\.\d+)?)/g)) {
      out[m[1]] = m[2].startsWith('0x') ? Number.parseInt(m[2], 16) : Number(m[2]);
    }
    return out;
  };

  const baseKeys = ['sky', 'horizon', 'hemiSky', 'hemiGround', 'hemi', 'key', 'keyI', 'rim', 'rimI', 'elev', 'fog'];
  const nightFields = parseFields(nightMatch[1]);
  const dawnFields = parseFields(dawnMatch[1]);
  const overcastFields = parseFields(overcastMatch[1]);
  const noonFields = parseFields(noonMatch[1]);

  for (const k of baseKeys) {
    assert.equal(DAYLIGHT_DRIFT_CONFIG.keyframes[0][k], nightFields[k], `night.${k}`);
  }
  assert.equal(nightFields.night, undefined);
  assert.equal(DAYLIGHT_DRIFT_CONFIG.keyframes[0].night, 1);

  for (const k of [...baseKeys, 'night']) {
    assert.equal(DAYLIGHT_DRIFT_CONFIG.keyframes[1][k], dawnFields[k], `dawn.${k}`);
    assert.equal(DAYLIGHT_DRIFT_CONFIG.keyframes[2][k], overcastFields[k], `overcast.${k}`);
  }

  assert.equal(noonFields.sky, 0x66aef2);
  for (const kf of DAYLIGHT_DRIFT_CONFIG.keyframes) {
    assert.notEqual(kf.sky, 0x66aef2);
  }
});

test('staging.js wires the drift: import, init next to stage(night), update before look.update()', async () => {
  const src = await fs.promises.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const importLine = "import { buildDaylightDrift } from './daylight-drift.mjs?v=40';";
  const stageCall = "stage(renderer, scene, { time: 'night'";
  const initCall = 'buildDaylightDrift(look, { stars, scene })';
  const updateCall = 'daylightDrift.update(dt)';
  const lookUpdate = 'look.update(); // drives the night glow';

  assert.ok(src.includes(importLine), 'missing ?v=40 daylight-drift import');
  assert.ok(src.includes("scene.getObjectByName('sky')?.getObjectByName('stars')"), 'missing stars lookup');
  assert.ok(src.includes('if (stars) stars.visible = true;'), 'missing forced stars.visible = true');

  const iStage = src.indexOf(stageCall);
  const iInit = src.indexOf(initCall);
  const iUpdate = src.indexOf(updateCall);
  const iLookUpdate = src.indexOf(lookUpdate);

  assert.ok(iStage >= 0, 'missing stage(night) call');
  assert.ok(iInit > iStage, 'buildDaylightDrift init must follow stage(night)');
  assert.ok(iUpdate > iInit, 'daylightDrift.update(dt) must follow init');
  assert.ok(iLookUpdate > iUpdate, 'look.update() must follow daylightDrift.update(dt)');
});

test('staging.js re-applies Inn dimming when a quantized night step lands', async () => {
  const src = await fs.promises.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const prevNightLine = 'const prevNight = look.night;';
  const updateCall = 'daylightDrift.update(dt)';
  const lookUpdate = 'look.update(); // drives the night glow';
  const resyncCond = 'if (look.night !== prevNight && liveStore.lastState?.inn) {';
  const innCall = 'updateStagingInnOccupancy(tavernGroup, liveStore.lastState.inn);';

  const iPrev = src.indexOf(prevNightLine);
  const iUpdate = src.indexOf(updateCall);
  const iLookUpdate = src.indexOf(lookUpdate);
  const iCond = src.indexOf(resyncCond);
  const iInnCall = src.indexOf(innCall, iLookUpdate);

  assert.ok(iPrev >= 0, 'missing const prevNight = look.night;');
  assert.ok(iUpdate > iPrev, 'prevNight must be captured before daylightDrift.update(dt)');
  assert.ok(iCond > iLookUpdate, 'Inn re-sync condition must follow look.update()');
  assert.ok(iInnCall > iCond, 'updateStagingInnOccupancy must sit inside the re-sync block after look.update()');
});

test('staging-polyfork/README.md drift bullets match the module + staging.js', async () => {
  const raw = await fs.promises.readFile(path.join(__dirname, 'README.md'), 'utf8');
  const norm = raw.replace(/\s+/g, ' ');

  assert.ok(norm.includes('30-minute town-clock cycle (night → dawn → overcast → dawn → night)'));
  assert.ok(norm.includes('capped below noon so windows and ghostlight always win'));
  assert.ok(norm.includes('quantized `look.night` updates and star fade'));

  assert.ok(norm.includes('starting at night on every load'));
  assert.ok(norm.includes('Shadow span raised from the default 70'));
  assert.ok(norm.includes('Stars start visible (`night` preset leaves them off) and fade with the drift'));
});

test('applier at night: update(0) pins all lights, elevation, fog, stars', () => {
  const look = makeStubLook();
  const fog = mkFog();
  const stars = { visible: false, material: { opacity: 0 } };
  buildDaylightDrift(look, { fog, stars, far: 320 }).update(0);

  assert.equal(look.hemi.color.hex, 0x53659e);
  assert.equal(look.hemi.groundColor.hex, 0x1b2032);
  assert.equal(look.hemi.intensity, 0.70);
  assert.equal(look.key.color.hex, 0xaec6ff);
  assert.equal(look.key.intensity, 0.75);
  assert.equal(look.rim.color.hex, 0x5a6cc0);
  assert.equal(look.rim.intensity, 0.45);
  assert.equal(look.elevation, 40);
  assert.equal(fog.color.hex, 0x1b2748);
  assert.equal(fog.near, 96);
  assert.equal(fog.far, 264);
  assert.equal(stars.material.opacity, 1);
  assert.equal(stars.visible, true);
});

test('applier at overcast: update(900) pins all lights, elevation, fog, stars', () => {
  const look = makeStubLook();
  const fog = mkFog();
  const stars = { visible: true, material: { opacity: 1 } };
  buildDaylightDrift(look, { fog, stars, far: 320 }).update(900);

  assert.equal(look.hemi.color.hex, 0xffffff);
  assert.equal(look.hemi.groundColor.hex, 0xaeb0b2);
  assert.equal(look.hemi.intensity, 1.50);
  assert.equal(look.key.color.hex, 0xeef2f6);
  assert.equal(look.key.intensity, 0.85);
  assert.equal(look.rim.color.hex, 0xdde4ee);
  assert.equal(look.rim.intensity, 0.45);
  assert.equal(look.elevation, 58);
  assert.equal(look.night, 0);
  assert.equal(fog.color.hex, 0xd8dde2);
  assert.ok(Math.abs(fog.near - 92.16) < 1e-9);
  assert.ok(Math.abs(fog.far - 253.44) < 1e-9);
  assert.equal(stars.material.opacity, 0);
  assert.equal(stars.visible, false);
});

test('night quantization exact-1 endpoint: forced from 0.005 away, silent from a near-1 value', () => {
  const makeCountingLook = (initialNight) => {
    let storedNight = initialNight;
    let writes = 0;
    const look = {};
    Object.defineProperty(look, 'night', {
      configurable: true,
      get() {
        return storedNight;
      },
      set(v) {
        writes++;
        storedNight = v;
      },
    });
    return {
      look,
      get storedNight() {
        return storedNight;
      },
      get writes() {
        return writes;
      },
    };
  };

  const caseA = makeCountingLook(0.995);
  buildDaylightDrift(caseA.look).update(0);
  assert.equal(caseA.writes, 1);
  assert.equal(caseA.storedNight, 1);

  const caseB = makeCountingLook(0.995);
  buildDaylightDrift(caseB.look).update(1);
  assert.equal(caseB.writes, 0);

  const caseC = makeCountingLook(1);
  const driftC = buildDaylightDrift(caseC.look);
  driftC.update(1799);
  assert.equal(caseC.writes, 0);
  driftC.update(1);
  assert.equal(caseC.writes, 0);
  assert.equal(caseC.storedNight, 1);
  assert.equal(driftC.phase, 0);
});

test('phase accumulates across small updates and wraps exactly', () => {
  const d1 = buildDaylightDrift({ night: 1 });
  for (let i = 0; i < 30; i++) d1.update(60);
  assert.equal(d1.phase, 0);

  const d2 = buildDaylightDrift({ night: 1 });
  for (let i = 0; i < 3; i++) d2.update(450);
  assert.ok(Math.abs(d2.phase - 0.75) < 1e-12);

  const d3 = buildDaylightDrift({ night: 1 });
  for (let i = 0; i < 2; i++) d3.update(450);
  assert.ok(Math.abs(d3.phase - 0.5) < 1e-12);
});

test('sky-dome gradient at night and overcast', () => {
  const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const hexToLin = (hex) =>
    [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255].map(srgbToLin);

  const nightLook = makeStubLook();
  buildDaylightDrift(nightLook, {}).update(0);
  const nightArr = nightLook.sky.geometry.attributes.color.array;
  const nightTop = hexToLin(0x070b1c);
  const nightHor = hexToLin(0x1b2748);
  const k = Math.pow(0.5, 0.55);

  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(nightArr[c] - nightTop[c]) < 1e-6, `night top channel ${c}`);
    assert.ok(Math.abs(nightArr[3 + c] - nightHor[c]) < 1e-6, `night horizon channel ${c}`);
    const expectedMid = nightHor[c] + (nightTop[c] - nightHor[c]) * k;
    assert.ok(Math.abs(nightArr[6 + c] - expectedMid) < 1e-6, `night mid channel ${c}`);
  }

  const overcastLook = makeStubLook();
  buildDaylightDrift(overcastLook, {}).update(900);
  const overcastArr = overcastLook.sky.geometry.attributes.color.array;
  const overcastTop = hexToLin(0xb4bfca);
  const overcastHor = hexToLin(0xd8dde2);

  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(overcastArr[c] - overcastTop[c]) < 1e-6, `overcast top channel ${c}`);
    assert.ok(Math.abs(overcastArr[3 + c] - overcastHor[c]) < 1e-6, `overcast horizon channel ${c}`);
  }
});

test('stars without material hide at overcast + look.night written when missing or non-number', () => {
  const stars = { visible: true };
  buildDaylightDrift(makeStubLook(), { stars }).update(900);
  assert.equal(stars.visible, false);

  const bareLook = {};
  buildDaylightDrift(bareLook).update(0);
  assert.equal(bareLook.night, 1);

  const nonNumberLook = { night: 'night' };
  buildDaylightDrift(nonNumberLook).update(0);
  assert.equal(nonNumberLook.night, 1);
});

test('near-wrap continuity: night and elevation rejoin across the 0/1 seam', () => {
  assert.ok(daylightAt(0.999).night > 0.99);
  assert.ok(Math.abs(daylightAt(0.999).night - daylightAt(0.001).night) < 0.01);
  assert.ok(daylightAt(0.9999).night > 0.999);
  assert.ok(Math.abs(daylightAt(0.999).elev - 40) < 0.5);
  assert.ok(Math.abs(daylightAt(0.001).elev - 40) < 0.5);
});

test('mirror symmetry across cycle midpoint + exact values at f=0.1875', () => {
  const hexKeys = ['sky', 'horizon', 'hemiSky', 'hemiGround', 'key', 'rim'];
  const numKeys = ['hemi', 'keyI', 'rimI', 'elev', 'fog', 'night'];

  for (const f of [0.0625, 0.1875, 0.3125, 0.4375]) {
    const a = daylightAt(f);
    const b = daylightAt(1 - f);
    for (const k of hexKeys) {
      assert.equal(a[k], b[k], `mirror hex ${k} at f=${f}`);
    }
    for (const k of numKeys) {
      assert.ok(Math.abs(a[k] - b[k]) < 1e-12, `mirror num ${k} at f=${f}: ${a[k]} vs ${b[k]}`);
    }
  }

  assert.equal(
    JSON.stringify(daylightAt(0.1875)),
    JSON.stringify({
      sky: 0x849dc9,
      horizon: 0xedbba9,
      hemiSky: 0xd1d8f3,
      hemiGround: 0x837d92,
      hemi: 0.8012499999999999,
      key: 0xf5ccc5,
      keyI: 1.7625,
      rim: 0x9babf7,
      rimI: 0.7453125,
      elev: 15.53125,
      fog: 0.7921875,
      night: 0.4515625,
    })
  );
});

test('exact interpolated values at f=0.4375 and f=0.3125', () => {
  assert.equal(
    JSON.stringify(daylightAt(0.4375)),
    JSON.stringify({
      sky: 0xafbccc,
      horizon: 0xdfdadc,
      hemiSky: 0xfafbff,
      hemiGround: 0xa9aaaf,
      hemi: 1.39375,
      key: 0xf1edee,
      keyI: 1.0218749999999999,
      rim: 0xd5ddf1,
      rimI: 0.5046875,
      elev: 50.65625,
      fog: 0.7324999999999999,
      night: 0.0546875,
    })
  );

  assert.equal(
    JSON.stringify(daylightAt(0.3125)),
    JSON.stringify({
      sky: 0x96add6,
      horizon: 0xf9ccbc,
      hemiSky: 0xe4eaff,
      hemiGround: 0x938ea0,
      hemi: 0.92625,
      key: 0xfcd3c3,
      keyI: 1.778125,
      rim: 0xafbdfc,
      rimI: 0.7453125,
      elev: 18.34375,
      fog: 0.7875000000000001,
      night: 0.2953125,
    })
  );
});

test('fractional-dt accumulation + ignored dt values + near-cycle wrap', () => {
  const d1 = buildDaylightDrift({ night: 1 });
  for (let i = 0; i < 18000; i++) d1.update(0.1);
  assert.ok(Math.abs(d1.phase - 1) < 1e-9, `expected phase near 1, got ${d1.phase}`);

  const d2 = buildDaylightDrift({ night: 1 });
  for (let i = 0; i < 3600; i++) d2.update(0.5);
  assert.equal(d2.phase, 0);

  for (const badDt of [-0, Infinity, -Infinity]) {
    const dBad = buildDaylightDrift({ night: 1 });
    dBad.update(badDt);
    assert.equal(dBad.phase, 0);
  }

  const d4 = buildDaylightDrift({ night: 1 });
  d4.update(1799.999);
  assert.ok(Math.abs(d4.phase - 1799.999 / 1800) < 1e-12);
  const wrapped = d4.update(0.001);
  assert.deepEqual(wrapped, daylightAt(0));
});

test('bare look gets elevation and night only + existing values are overwritten', () => {
  const bare = {};
  buildDaylightDrift(bare).update(450);
  assert.equal(bare.elevation, 11);
  assert.equal(bare.night, 0.35);
  assert.deepEqual(Object.keys(bare).sort(), ['elevation', 'night']);

  const preset = { elevation: 999, night: 0.5 };
  buildDaylightDrift(preset).update(0);
  assert.equal(preset.elevation, 40);
  assert.equal(preset.night, 1);
});

test('far option defaults to 320 when omitted or undefined, and respects far: 0', () => {
  const fogDefault = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogDefault }).update(0);
  assert.equal(fogDefault.near, 96);
  assert.equal(fogDefault.far, 264);

  const fogZero = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogZero, far: 0 }).update(0);
  assert.equal(fogZero.near, 0);
  assert.equal(fogZero.far, 0);

  const fogUndef = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogUndef, far: undefined }).update(0);
  assert.equal(fogUndef.near, 96);
  assert.equal(fogUndef.far, 264);
});

test('night-write counting from arbitrary initial night (0.5 -> 1 -> wrap -> 0)', () => {
  let storedNight = 0.5;
  let writes = 0;
  const look = {};
  Object.defineProperty(look, 'night', {
    configurable: true,
    get() {
      return storedNight;
    },
    set(v) {
      writes++;
      storedNight = v;
    },
  });

  const drift = buildDaylightDrift(look);
  drift.update(0);
  assert.equal(storedNight, 1);
  assert.equal(writes, 1);

  drift.update(1);
  assert.equal(writes, 1);

  drift.update(1799);
  assert.equal(drift.phase, 0);
  assert.equal(storedNight, 1);
  assert.equal(writes, 1);

  drift.update(900);
  assert.equal(storedNight, 0);
  assert.equal(writes, 2);
});

test('DAYLIGHT_DRIFT_CONFIG shape: exact top-level keys, 14 keyframe keys, endpoints match', () => {
  assert.deepEqual(Object.keys(DAYLIGHT_DRIFT_CONFIG).sort(), ['cycleSeconds', 'keyframes']);
  assert.equal(DAYLIGHT_DRIFT_CONFIG.cycleSeconds, 1800);
  assert.equal(DAYLIGHT_DRIFT_CONFIG.keyframes.length, 5);

  const expectedKfKeys = [
    'at', 'elev', 'fog', 'hemi', 'hemiGround', 'hemiSky',
    'horizon', 'key', 'keyI', 'name', 'night', 'rim', 'rimI', 'sky',
  ];
  for (const kf of DAYLIGHT_DRIFT_CONFIG.keyframes) {
    assert.deepEqual(Object.keys(kf).sort(), expectedKfKeys);
  }

  const { at: at0, ...rest0 } = DAYLIGHT_DRIFT_CONFIG.keyframes[0];
  const { at: at4, ...rest4 } = DAYLIGHT_DRIFT_CONFIG.keyframes[4];
  assert.equal(at0, 0);
  assert.equal(at4, 1);
  assert.deepEqual(rest0, rest4);
});

test('staging.js drift wiring: exact occurrence counts and declaration-first ordering', async () => {
  const src = await fs.promises.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  assert.equal((src.match(/daylightDrift/g) || []).length, 2);
  assert.equal((src.match(/daylightDrift\.update\(dt\)/g) || []).length, 1);
  assert.equal((src.match(/const daylightDrift = buildDaylightDrift/g) || []).length, 1);

  const firstLine = src.split(/\r?\n/).find((line) => line.includes('daylightDrift'));
  assert.ok(firstLine && firstLine.trim().startsWith('const daylightDrift'));
});

test('update returns fresh, mutation-isolated params objects', () => {
  const drift = buildDaylightDrift(makeStubLook());
  const a = drift.update(0);
  const b = drift.update(0);
  assert.notEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));

  a.night = 999;
  a.sky = 0;

  const c = drift.update(0);
  assert.equal(c.night, 1);
  assert.equal(c.sky, 0x070b1c);
});

test('daylight-drift.mjs source discipline (comments-only setTime, no wall-clock APIs) + exact export surface', async () => {
  const src = await fs.promises.readFile(MODULE_PATH, 'utf8');
  const setTimeLines = src.split(/\r?\n/).filter((line) => line.includes('setTime'));
  assert.equal(setTimeLines.length, 2);
  for (const line of setTimeLines) {
    assert.ok(line.trim().startsWith('*'), `expected comment line for setTime, got: ${line}`);
  }

  assert.ok(!src.includes('look.setTime('), 'must not invoke look.setTime(');
  assert.ok(!src.includes('Date.now'), 'must not use Date.now');
  assert.ok(!src.includes('performance.now'), 'must not use performance.now');
  assert.ok(!src.includes('setInterval'), 'must not use setInterval');
  assert.ok(!src.includes('setTimeout'), 'must not use setTimeout');

  const mod = await import('./daylight-drift.mjs');
  assert.deepEqual(
    Object.keys(mod).sort(),
    ['DAYLIGHT_DRIFT_CONFIG', 'buildDaylightDrift', 'daylightAt']
  );
});

test('exact interpolated values at f=0.09375, f=0.15625, f=0.21875 (night-to-dawn leg)', () => {
  assert.equal(
    JSON.stringify(daylightAt(0.09375)),
    JSON.stringify({
      sky: 0x546483,
      horizon: 0x9a7b78,
      hemiSky: 0x939dc4,
      hemiGround: 0x555364,
      hemi: 0.73796875,
      key: 0xccc8ec,
      keyI: 1.1296875,
      rim: 0x7888d7,
      rimI: 0.5607421875,
      elev: 30.82421875,
      fog: 0.7658203125,
      night: 0.7943359375,
    })
  );

  assert.equal(
    JSON.stringify(daylightAt(0.15625)),
    JSON.stringify({
      sky: 0x788eb7,
      horizon: 0xd8ab9c,
      hemiSky: 0xc1c9e6,
      hemiGround: 0x777386,
      hemi: 0.78203125,
      key: 0xe9cbd2,
      keyI: 1.5703125,
      rim: 0x92a2ed,
      rimI: 0.6892578125000001,
      elev: 20.17578125,
      fog: 0.7841796875,
      night: 0.5556640625,
    })
  );

  assert.equal(
    JSON.stringify(daylightAt(0.21875)),
    JSON.stringify({
      sky: 0x8ca6d4,
      horizon: 0xfac5b1,
      hemiSky: 0xdbe2fc,
      hemiGround: 0x8a8499,
      hemi: 0.81484375,
      key: 0xfccdbc,
      keyI: 1.8984375,
      rim: 0xa2b2fd,
      rimI: 0.7849609375000001,
      elev: 12.24609375,
      fog: 0.7978515625,
      night: 0.3779296875,
    })
  );
});

test('exact interpolated values at f=0.28125 and f=0.46875 (dawn-to-overcast leg)', () => {
  assert.equal(
    JSON.stringify(daylightAt(0.28125)),
    JSON.stringify({
      sky: 0x91aad7,
      horizon: 0xfdcab6,
      hemiSky: 0xe1e7ff,
      hemiGround: 0x8f899d,
      hemi: 0.8492187499999999,
      key: 0xfecfbb,
      keyI: 1.9027343749999999,
      rim: 0xa7b6fe,
      rimI: 0.7849609375000001,
      elev: 13.01953125,
      fog: 0.7965625000000001,
      night: 0.3349609375,
    })
  );

  assert.equal(
    JSON.stringify(daylightAt(0.46875)),
    JSON.stringify({
      sky: 0xb3becb,
      horizon: 0xdadce0,
      hemiSky: 0xfefeff,
      hemiGround: 0xadaeb1,
      hemi: 1.47078125,
      key: 0xeff1f4,
      keyI: 0.897265625,
      rim: 0xdbe2ef,
      rimI: 0.4650390625,
      elev: 55.98046875,
      fog: 0.7234375,
      night: 0.015039062499999978,
    })
  );
});

test('stars visibility threshold: visible at night 0.0139, hidden at 0.0064', () => {
  for (const f of [0.3, 0.4, 0.6, 0.7]) {
    const stars = { visible: true, material: { opacity: -1 } };
    buildDaylightDrift({ night: 1 }, { stars }).update(1800 * f);
    assert.equal(stars.material.opacity, daylightAt(f).night, `opacity at f=${f}`);
    assert.equal(stars.visible, daylightAt(f).night > 0.01, `visible at f=${f}`);
  }

  const visBefore = { visible: false, material: { opacity: -1 } };
  buildDaylightDrift({ night: 1 }, { stars: visBefore }).update(1800 * 0.47);
  assert.equal(visBefore.material.opacity, daylightAt(0.47).night);
  assert.equal(visBefore.visible, true);

  const hidAfter = { visible: true, material: { opacity: -1 } };
  buildDaylightDrift({ night: 1 }, { stars: hidAfter }).update(1800 * 0.48);
  assert.equal(hidAfter.material.opacity, daylightAt(0.48).night);
  assert.equal(hidAfter.visible, false);

  const hidBefore = { visible: true, material: { opacity: -1 } };
  buildDaylightDrift({ night: 1 }, { stars: hidBefore }).update(1800 * 0.52);
  assert.equal(hidBefore.material.opacity, daylightAt(0.52).night);
  assert.equal(hidBefore.visible, false);

  const visAfter = { visible: false, material: { opacity: -1 } };
  buildDaylightDrift({ night: 1 }, { stars: visAfter }).update(1800 * 0.53);
  assert.equal(visAfter.material.opacity, daylightAt(0.53).night);
  assert.equal(visAfter.visible, true);
});

test('sky-dome gradient at y=15/45/90 (dawn): mid and extrapolated heights', () => {
  const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const hexToLin = (hex) =>
    [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255].map(srgbToLin);

  const ys = [15, 45, 90];
  const colorArr = new Float32Array(ys.length * 3);
  const look = {
    night: 1,
    sky: {
      geometry: {
        attributes: {
          position: {
            count: ys.length,
            getY(i) {
              return ys[i];
            },
          },
          color: {
            array: colorArr,
            needsUpdate: false,
            setXYZ(i, r, g, b) {
              colorArr[i * 3] = r;
              colorArr[i * 3 + 1] = g;
              colorArr[i * 3 + 2] = b;
            },
          },
        },
      },
    },
  };

  buildDaylightDrift(look).update(450);

  const hor = hexToLin(0xffc9b4);
  const top = hexToLin(0x8fa9d8);
  const expected = [
    [0.661625, 0.496689, 0.563838],
    [0.380823, 0.424169, 0.652986],
    [0.093472, 0.349957, 0.744214],
  ];

  for (let v = 0; v < 3; v++) {
    const h = ys[v] / 60;
    const k = Math.pow(h, 0.55);
    for (let c = 0; c < 3; c++) {
      const fromFormula = hor[c] + (top[c] - hor[c]) * k;
      assert.ok(Math.abs(fromFormula - expected[v][c]) < 1e-6, `formula y=${ys[v]} channel ${c}`);
      assert.ok(Math.abs(colorArr[v * 3 + c] - expected[v][c]) < 1e-6, `dome y=${ys[v]} channel ${c}`);
    }
  }
  assert.equal(look.sky.geometry.attributes.color.needsUpdate, true);
});

test('elevation monotonic per leg + numeric bounds at 1% sampling', () => {
  const legs = [
    { start: 0.00, end: 0.25, dir: -1 },
    { start: 0.25, end: 0.50, dir: 1 },
    { start: 0.50, end: 0.75, dir: -1 },
    { start: 0.75, end: 1.00, dir: 1 },
  ];
  for (const leg of legs) {
    let prev = daylightAt(leg.start).elev;
    for (let step = 1; step <= 25; step++) {
      const f = leg.start + ((leg.end - leg.start) * step) / 25;
      const cur = daylightAt(f).elev;
      if (leg.dir < 0) {
        assert.ok(cur <= prev + 1e-12, `Expected non-increasing elev on [${leg.start}, ${leg.end}]`);
      } else {
        assert.ok(cur >= prev - 1e-12, `Expected non-decreasing elev on [${leg.start}, ${leg.end}]`);
      }
      prev = cur;
    }
  }

  for (let i = 0; i <= 100; i++) {
    const p = daylightAt(i / 100);
    assert.ok(p.elev >= 11 - 1e-12 && p.elev <= 58 + 1e-12, `elev out of [11,58] at ${i}%: ${p.elev}`);
    assert.ok(p.rimI >= 0.45 - 1e-12 && p.rimI <= 0.80 + 1e-12, `rimI out of [0.45,0.80] at ${i}%: ${p.rimI}`);
    assert.ok(p.hemi >= 0.70 - 1e-12 && p.hemi <= 1.50 + 1e-12, `hemi out of [0.70,1.50] at ${i}%: ${p.hemi}`);
    assert.ok(p.keyI >= 0.75 - 1e-12 && p.keyI <= 1.95 + 1e-12, `keyI out of [0.75,1.95] at ${i}%: ${p.keyI}`);
  }

  assert.deepEqual(
    [0, 0.25, 0.5, 0.75, 1].map((f) => daylightAt(f).elev),
    [40, 11, 58, 11, 40]
  );
  assert.deepEqual(
    [0, 0.25, 0.5, 0.75, 1].map((f) => daylightAt(f).rimI),
    [0.45, 0.8, 0.45, 0.8, 0.45]
  );
});

test('far option edges: negative, string, NaN, null', () => {
  const fogNeg = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogNeg, far: -100 }).update(0);
  assert.equal(fogNeg.near, -30);
  assert.equal(fogNeg.far, -82.50000000000001);

  const fogStr = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogStr, far: '320' }).update(0);
  assert.equal(fogStr.near, 96);
  assert.equal(fogStr.far, 264);

  const fogNaN = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogNaN, far: NaN }).update(0);
  assert.ok(Number.isNaN(fogNaN.near));
  assert.ok(Number.isNaN(fogNaN.far));

  const fogNull = mkFog();
  buildDaylightDrift(makeStubLook(), { fog: fogNull, far: null }).update(0);
  assert.equal(fogNull.near, 0);
  assert.equal(fogNull.far, 0);
});

test('look.night initial NaN / undefined: endpoint force writes', () => {
  const counting = (initial) => {
    let stored = initial;
    let writes = 0;
    const look = {};
    Object.defineProperty(look, 'night', {
      configurable: true,
      get() {
        return stored;
      },
      set(v) {
        writes++;
        stored = v;
      },
    });
    return {
      look,
      get stored() {
        return stored;
      },
      get writes() {
        return writes;
      },
    };
  };

  const cNaN = counting(NaN);
  buildDaylightDrift(cNaN.look).update(0);
  assert.equal(cNaN.writes, 1);
  assert.equal(cNaN.stored, 1);

  const cUndef = counting(undefined);
  buildDaylightDrift(cUndef.look).update(0);
  assert.equal(cUndef.writes, 1);
  assert.equal(cUndef.stored, 1);

  const cNaN2 = counting(NaN);
  buildDaylightDrift(cNaN2.look).update(900);
  assert.equal(cNaN2.writes, 1);
  assert.equal(cNaN2.stored, 0);

  const plainNaN = { night: NaN };
  buildDaylightDrift(plainNaN).update(0);
  assert.equal(plainNaN.night, 1);
});

test('fog target without color or setHex + scene:{} fall-through', () => {
  const fogNoColor = { near: -1, far: -1 };
  buildDaylightDrift({ night: 1 }, { fog: fogNoColor }).update(0);
  assert.equal(fogNoColor.near, 96);
  assert.equal(fogNoColor.far, 264);
  assert.equal(fogNoColor.color, undefined);

  const fogNoSetHex = { color: {}, near: 0, far: 0 };
  buildDaylightDrift({ night: 1 }, { fog: fogNoSetHex }).update(450);
  assert.equal(fogNoSetHex.near, 102.4);
  assert.equal(fogNoSetHex.far, 281.6);

  const lookFog = {
    night: 1,
    fog: {
      color: makeStubColor(),
      near: 0,
      far: 0,
    },
  };
  buildDaylightDrift(lookFog, { scene: {} }).update(450);
  assert.equal(lookFog.fog.near, 102.4);
  assert.equal(lookFog.fog.color.hex, 0xffc9b4);

  const bare = { night: 1 };
  const params = buildDaylightDrift(bare, { fog: null, scene: null }).update(450);
  assert.deepEqual(params, daylightAt(0.25));

  const sceneNoFog = { night: 1 };
  const p2 = buildDaylightDrift(sceneNoFog, { scene: {} }).update(0);
  assert.equal(p2.night, 1);
});

test('result key list: exact 12 keys, update deep-equals daylightAt(phase)', () => {
  const keys = ['elev', 'fog', 'hemi', 'hemiGround', 'hemiSky', 'horizon', 'key', 'keyI', 'night', 'rim', 'rimI', 'sky'];
  assert.deepEqual(Object.keys(daylightAt(0.3)).sort(), keys);

  const drift = buildDaylightDrift({ night: 1 });
  const r1 = drift.update(450);
  assert.deepEqual(Object.keys(r1).sort(), keys);
  assert.deepEqual(r1, daylightAt(0.25));

  const r2 = drift.update(450);
  assert.deepEqual(r2, daylightAt(0.5));

  const r3 = drift.update(1800 * 0.123);
  assert.deepEqual(r3, daylightAt(0.623));
  assert.ok(Math.abs(drift.phase - 0.623) < 1e-12);
});

test('file hygiene: 53 tests, unique names, import lines verbatim, banned-literal counts', async () => {
  const src = await fs.promises.readFile(
    path.join(__dirname, 'test-daylight-drift.mjs'),
    'utf8'
  );
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 53);
  assert.equal(new Set(names).size, 53);

  const importLines = src.split(/\r?\n/).filter((line) => line.startsWith('import '));
  assert.deepEqual(importLines, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'import {',
  ]);
  assert.deepEqual(src.split(/\r?\n/).slice(6, 11), [
    'import {',
    '  DAYLIGHT_DRIFT_CONFIG,',
    '  daylightAt,',
    '  buildDaylightDrift,',
    "} from './daylight-drift.mjs';",
  ]);

  const count = (needle) => (src.match(new RegExp(needle, 'g')) || []).length;
  assert.equal(count('camp' + 'fire'), 3);
  assert.equal(count('fet' + 'ch\\('), 3);
  assert.equal(count('Math.' + 'random'), 3);
  assert.equal(count('Date.' + 'now'), 2);
  assert.equal(count('TO' + 'DO'), 0);
  assert.equal(count('FIX' + 'ME'), 0);
  assert.equal(count('100' + '.' + '105'), 0);
  assert.equal(count('81' + '23'), 0);
  assert.equal(count('81' + '24'), 0);
  assert.equal(count('81' + '25'), 7);
});
