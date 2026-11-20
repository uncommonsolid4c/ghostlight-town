// Dynamic minimal daylight for staging-polyfork:
// A slow 30-minute town clock (night -> dawn -> overcast -> dawn -> night)
// capped well below noon so windows, lanterns, and the ghostlight always win.
//
// Preset values copied verbatim from kit-campground/_internal/stage.mjs
// lines 9 (TIMES night) and 13-15 (LOOKS dawn, overcast; noon is excluded).

const PRESETS = Object.freeze({
  night: Object.freeze({
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
  }),
  dawn: Object.freeze({
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
  }),
  overcast: Object.freeze({
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
  }),
});

export const DAYLIGHT_DRIFT_CONFIG = Object.freeze({
  cycleSeconds: 30 * 60,
  keyframes: Object.freeze([
    Object.freeze({ at: 0.00, name: 'night', ...PRESETS.night }),
    Object.freeze({ at: 0.25, name: 'dawn', ...PRESETS.dawn }),
    Object.freeze({ at: 0.50, name: 'overcast', ...PRESETS.overcast }),
    Object.freeze({ at: 0.75, name: 'dawn', ...PRESETS.dawn }),
    Object.freeze({ at: 1.00, name: 'night', ...PRESETS.night }),
  ]),
});

const SKY_DOME_RADIUS = 60;
const NIGHT_STEP_QUANTUM = 0.01;

function srgbChannelToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(c) {
  const clamped = Math.min(1, Math.max(0, c));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function hexToLinearRgb(hex) {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
}

function linearRgbToHex(r, g, b) {
  const ri = Math.round(linearChannelToSrgb(r) * 255);
  const gi = Math.round(linearChannelToSrgb(g) * 255);
  const bi = Math.round(linearChannelToSrgb(b) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

function mixHex(a, b, s) {
  if (s <= 0) return a;
  if (s >= 1) return b;
  const [ar, ag, ab] = hexToLinearRgb(a);
  const [br, bg, bb] = hexToLinearRgb(b);
  return linearRgbToHex(
    ar + (br - ar) * s,
    ag + (bg - ag) * s,
    ab + (bb - ab) * s
  );
}

function lerpNum(a, b, s) {
  if (s <= 0) return a;
  if (s >= 1) return b;
  return a + (b - a) * s;
}

/**
 * Pure interpolation across DAYLIGHT_DRIFT_CONFIG.keyframes for cycle fraction
 * in [0, 1) (wraps any real number into [0, 1)). Uses smoothstep easing within
 * each leg and replicates stage.mjs setTime numeric/hex-color interpolation.
 */
export function daylightAt(fraction) {
  const f = Number.isFinite(fraction) ? ((fraction % 1) + 1) % 1 : 0;
  const frames = DAYLIGHT_DRIFT_CONFIG.keyframes;
  let i = 0;
  while (i < frames.length - 2 && f > frames[i + 1].at) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const raw = (f - a.at) / (b.at - a.at || 1);
  const t = Math.min(1, Math.max(0, raw));
  const s = t * t * (3 - 2 * t);

  return {
    sky: mixHex(a.sky, b.sky, s),
    horizon: mixHex(a.horizon, b.horizon, s),
    hemiSky: mixHex(a.hemiSky, b.hemiSky, s),
    hemiGround: mixHex(a.hemiGround, b.hemiGround, s),
    hemi: lerpNum(a.hemi, b.hemi, s),
    key: mixHex(a.key, b.key, s),
    keyI: lerpNum(a.keyI, b.keyI, s),
    rim: mixHex(a.rim, b.rim, s),
    rimI: lerpNum(a.rimI, b.rimI, s),
    elev: lerpNum(a.elev, b.elev, s),
    fog: lerpNum(a.fog, b.fog, s),
    night: lerpNum(a.night, b.night, s),
  };
}

/**
 * Build a stateful daylight-drift controller against a Polyfork stage `look`.
 * Advances an internal town clock (starting at night on every page load),
 * updates lights, elevation, quantized night factor, sky-dome vertex colors,
 * fog, and town star opacity/visibility without ever calling `look.setTime`.
 */
export function buildDaylightDrift(look, { stars = null, fog = null, scene = null, far = 320 } = {}) {
  let elapsedSeconds = 0;
  let lastAppliedNight = typeof look?.night === 'number' ? look.night : null;

  function applySkyDome(dome, topHex, horHex) {
    const pos = dome?.geometry?.attributes?.position;
    const col = dome?.geometry?.attributes?.color;
    if (!pos || !col) return;
    const [horR, horG, horB] = hexToLinearRgb(horHex);
    const [topR, topG, topB] = hexToLinearRgb(topHex);
    for (let n = 0; n < pos.count; n++) {
      const h = Math.max(0, pos.getY(n) / SKY_DOME_RADIUS);
      const k = Math.pow(h, 0.55);
      col.setXYZ(
        n,
        horR + (topR - horR) * k,
        horG + (topG - horG) * k,
        horB + (topB - horB) * k
      );
    }
    col.needsUpdate = true;
  }

  function applyNightQuantized(nightValue) {
    // Quantize look.night writes to >= 0.01 steps (plus exact 0 and 1 endpoints)
    // so stage.mjs lamps() does not fire every frame; callers that also drive
    // per-room Inn dimming re-sync after look.update() when look.night moves.
    const movedEnough =
      lastAppliedNight === null ||
      Math.abs(nightValue - lastAppliedNight) >= NIGHT_STEP_QUANTUM ||
      (nightValue === 0 && lastAppliedNight !== 0) ||
      (nightValue === 1 && lastAppliedNight !== 1);
    if (movedEnough) {
      look.night = nightValue;
      lastAppliedNight = nightValue;
    }
  }

  return {
    get phase() {
      return (elapsedSeconds / DAYLIGHT_DRIFT_CONFIG.cycleSeconds) % 1;
    },
    update(dt) {
      if (typeof dt === 'number' && Number.isFinite(dt) && dt > 0) {
        elapsedSeconds += dt;
      }
      const params = daylightAt(this.phase);

      if (look.hemi) {
        look.hemi.color?.setHex?.(params.hemiSky);
        look.hemi.groundColor?.setHex?.(params.hemiGround);
        look.hemi.intensity = params.hemi;
      }
      if (look.key) {
        look.key.color?.setHex?.(params.key);
        look.key.intensity = params.keyI;
      }
      if (look.rim) {
        look.rim.color?.setHex?.(params.rim);
        look.rim.intensity = params.rimI;
      }
      look.elevation = params.elev;
      applyNightQuantized(params.night);

      if (look.sky) {
        applySkyDome(look.sky, params.sky, params.horizon);
      }

      const targetFog = fog || scene?.fog || look.fog || null;
      if (targetFog) {
        targetFog.color?.setHex?.(params.horizon);
        targetFog.near = far * 0.4 * params.fog;
        targetFog.far = far * 1.1 * params.fog;
      }

      if (stars) {
        if (stars.material) stars.material.opacity = params.night;
        stars.visible = params.night > 0.01;
      }

      return params;
    },
  };
}
