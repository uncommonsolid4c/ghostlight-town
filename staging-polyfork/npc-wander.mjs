// Staging-local NPC stand-in wandering loop (Slice 71).
// Faithful port of the live wander loop in town-3d/town.js, adapted for
// terrain heights, stand-in humanoid groups, and Walk/Idle clip switching.
// No top-level THREE or document access so unit tests can run headless in Node.

export const SEED_WANDER_CONFIG = [
  { handle: 'wick', bandstandSlot: 1, speed: 0.5, lingers: { home: 10, bandstand: 14, newsstand: 12 } },
  { handle: 'maren', bandstandSlot: 2, speed: 0.45, lingers: { home: 12, bandstand: 16, newsstand: 10 } },
  { handle: 'tomas', bandstandSlot: 3, speed: 0.6, lingers: { home: 9, bandstand: 12, newsstand: 15 } },
];

export const GHOST_DRIFT_CONFIG = {
  handle: 'milo',
  speed: 0.35,
  lingers: { spot0: 25, deck1: 8, deck2: 10, deck3: 8 },
  deckPoints: [
    { x: -2.2, z: 1.6, label: 'deck1' },
    { x: 0.4, z: -2.4, label: 'deck2' },
    { x: 2.3, z: 1.4, label: 'deck3' },
  ],
};

export function buildStagingGhostDrift({ ghost, bandstandSpots } = {}) {
  const spot0 = Array.isArray(bandstandSpots) ? bandstandSpots[0] : null;
  if (!ghost || !spot0) return null;
  const deckY = spot0.y;
  return {
    handle: GHOST_DRIFT_CONFIG.handle,
    group: ghost,
    speed: GHOST_DRIFT_CONFIG.speed,
    waypoints: [
      { x: spot0.x, y: spot0.y, z: spot0.z, linger: GHOST_DRIFT_CONFIG.lingers.spot0, label: 'spot0' },
      ...GHOST_DRIFT_CONFIG.deckPoints.map((pt) => ({
        x: pt.x,
        y: deckY,
        z: pt.z,
        linger: GHOST_DRIFT_CONFIG.lingers[pt.label],
        label: pt.label,
      })),
    ],
    targetIndex: 1,
    state: 'walking',
    lingerRemaining: 0,
    yielded: false,
  };
}

export function getStagingNewsstandFrontPosition(layout) {
  const { newsstand, bandstand } = layout;
  const dx = bandstand.x - newsstand.x;
  const dz = bandstand.z - newsstand.z;
  const dist = Math.hypot(dx, dz) || 1;
  return {
    x: +(newsstand.x + (dx / dist) * 2.0).toFixed(4),
    y: 0,
    z: +(newsstand.z + (dz / dist) * 2.0).toFixed(4),
  };
}

function lerpAngle(current, target, alpha) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * alpha;
}

export function buildStagingWanderFigures({
  standIns,
  plots,
  bandstandSpots,
  bandstandGroundY,
  newsstandFront,
  groundAt,
  getPlotTargetPosition,
  homePads,
}) {
  const figures = [];
  for (const cfg of SEED_WANDER_CONFIG) {
    const standIn = typeof standIns?.get === 'function'
      ? standIns.get(cfg.handle)
      : standIns?.[cfg.handle];
    if (!standIn?.group) continue;

    const plotNum = homePads[cfg.handle];
    const plotLayout = plots.find((pl) => pl.plotNumber === plotNum);
    const home = getPlotTargetPosition(plotLayout, 0);
    const spot = bandstandSpots[cfg.bandstandSlot];

    figures.push({
      handle: cfg.handle,
      standIn,
      group: standIn.group,
      speed: cfg.speed,
      waypoints: [
        {
          x: home.x,
          y: groundAt(home.x, home.z),
          z: home.z,
          rotY: home.rotY,
          linger: cfg.lingers.home,
          label: 'home',
        },
        {
          x: spot.x,
          y: bandstandGroundY + spot.y,
          z: spot.z,
          rotY: spot.rotY,
          linger: cfg.lingers.bandstand,
          label: 'bandstand',
        },
        {
          x: newsstandFront.x,
          y: groundAt(newsstandFront.x, newsstandFront.z),
          z: newsstandFront.z,
          linger: cfg.lingers.newsstand,
          label: 'newsstand',
        },
      ],
      targetIndex: 1,
      state: 'walking',
      lingerRemaining: 0,
      yielded: false,
    });
  }
  return figures;
}

export function updateStagingWander(figures, dt, liveAvatars) {
  if (!Array.isArray(figures) || !(dt > 0) || !Number.isFinite(dt)) return;
  const turnAlpha = dt >= 0.25 ? 1 : 1 - Math.exp(-10 * dt);

  for (const w of figures) {
    const isLivePresent = Boolean(liveAvatars && typeof liveAvatars.has === 'function' && liveAvatars.has(w.handle));
    if (isLivePresent) {
      w.group.visible = false;
      w.yielded = true;
      continue;
    }

    if (w.yielded) {
      w.yielded = false;
      w.group.visible = true;
      const home = w.waypoints[0];
      w.group.position.set(home.x, home.y, home.z);
      if (typeof home.rotY === 'number') {
        w.group.rotation.y = home.rotY;
      }
      w.targetIndex = 1 % w.waypoints.length;
      w.state = 'walking';
      w.lingerRemaining = 0;
      continue;
    }

    if (w.state === 'lingering') {
      w.lingerRemaining -= dt;
      if (w.lingerRemaining <= 0) {
        w.targetIndex = (w.targetIndex + 1) % w.waypoints.length;
        w.state = 'walking';
        w.lingerRemaining = 0;
      }
      continue;
    }

    const target = w.waypoints[w.targetIndex];
    const dx = target.x - w.group.position.x;
    const dy = target.y - w.group.position.y;
    const dz = target.z - w.group.position.z;
    const dist = Math.hypot(dx, dy, dz);
    const maxStep = w.speed * dt;

    if (Math.hypot(dx, dz) > 1e-6) {
      const travelRotY = Math.atan2(dx, dz);
      w.group.rotation.y = lerpAngle(w.group.rotation.y, travelRotY, turnAlpha);
    }

    if (dist <= maxStep + 1e-6) {
      w.group.position.set(target.x, target.y, target.z);
      w.state = 'lingering';
      w.lingerRemaining = target.linger;
      w.standIn?.anim?.locomotion?.(0);
    } else {
      const ratio = maxStep / dist;
      w.group.position.x += dx * ratio;
      w.group.position.y += dy * ratio;
      w.group.position.z += dz * ratio;
      w.standIn?.anim?.locomotion?.(w.speed);
    }
  }
}
