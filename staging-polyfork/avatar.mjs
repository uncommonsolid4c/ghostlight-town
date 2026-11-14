// Copied verbatim from town-3d/town.js:
//   - TOWN_LAYOUT (lines 10-54)
//   - makeCanvas (lines 200-233)
//   - makeTextTexture (lines 235-265)
//   - createAvatarCapsule (lines 757-794)
//   - SEED_HOME_PADS (line 1806)
//   - getPlotTargetPosition (lines 2134-2146)
//   - pickBandstandSpot (lines 2148-2174)
// Keep in step with town-3d/town.js; no THREE import (passed in), no top-level document access.

export const TOWN_LAYOUT = {
  clearingRadius: 30,
  bandstand: {
    x: 0,
    y: 0,
    z: 0,
    radius: 4.5,
    height: 0.6,
  },
  gate: {
    x: 0,
    y: 0,
    z: 27,
  },
  newsstand: {
    x: 6,
    y: 0,
    z: 14,
  },
  noticeBoard: {
    x: -6,
    y: 0,
    z: 14,
  },
  inn: {
    x: -11,
    y: 0,
    z: 20,
  },
  plotRadius: 18.5,
  plots: Array.from({ length: 8 }, (_, i) => {
    const startAngle = 0.42 * Math.PI;
    const endAngle = 1.58 * Math.PI;
    const angle = startAngle + (i / 7) * (endAngle - startAngle);
    const x = +(Math.sin(angle) * 18.5).toFixed(3);
    const z = +(Math.cos(angle) * 18.5).toFixed(3);
    return {
      plotNumber: i + 1,
      x,
      y: 0,
      z,
      rotY: +Math.atan2(-x, -z).toFixed(4),
    };
  }),
};

export const SEED_HOME_PADS = { wick: 2, maren: 3, tomas: 4 };

/**
 * Create a 2D canvas (browser DOM or minimal headless Node mock).
 */
function makeCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  const noop = () => {};
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '16px monospace',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fillText: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
  };
  return {
    width,
    height,
    getContext: () => ctx,
  };
}

function makeTextTexture(THREE, lines, opts = {}) {
  const width = opts.width || 512;
  const height = opts.height || 256;
  const bg = opts.bg || '#2e2218';
  const border = opts.border || '#8b6a4b';
  const fg = opts.fg || '#f6ecd9';
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = border;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, width - 16, height - 16);

  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lineList = Array.isArray(lines) ? lines : [String(lines || '')];
  const step = height / (lineList.length + 1);
  lineList.forEach((line, idx) => {
    const fontSize = idx === 0 ? (opts.titleSize || 34) : (opts.subSize || 22);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillText(String(line), width / 2, step * (idx + 1));
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create a simple capsule avatar with a floating [MUSE] or [NPC] nametag sprite.
 */
export function createAvatarCapsule(THREE, { handle = 'muse', role = 'muse', nametagLift = 0 } = {}) {
  const isNpc = role === 'npc';
  const group = new THREE.Group();
  group.name = `avatar_${handle}`;
  group.userData = { handle, role: isNpc ? 'npc' : 'muse', nametagLift };

  const bodyColor = isNpc ? '#d49a45' : '#6cb4d8';
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.0, 8), bodyMat);
  body.position.set(0, 0.5, 0);
  group.add(body);

  const headMat = new THREE.MeshStandardMaterial({ color: '#f2dcc4', roughness: 0.75 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), headMat);
  head.position.set(0, 1.2, 0);
  group.add(head);

  const badge = isNpc ? `[NPC] ${handle}` : `[MUSE] ${handle}`;
  const fg = isNpc ? '#ffbe55' : '#9be0ff';
  const tex = makeTextTexture(THREE, [badge], {
    width: 384,
    height: 96,
    titleSize: 30,
    bg: '#161b28',
    border: fg,
    fg,
  });
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.name = 'nametag_sprite';
  sprite.position.set(0, 1.8 + nametagLift, 0);
  sprite.scale.set(1.5, 0.375, 1);
  group.add(sprite);
  group.userData.nametagSprite = sprite;

  return group;
}

export function getPlotTargetPosition(layout, indexAtPlot = 0) {
  const fwdX = Math.sin(layout.rotY);
  const fwdZ = Math.cos(layout.rotY);
  const sideX = Math.cos(layout.rotY);
  const sideZ = -Math.sin(layout.rotY);
  const lateral = indexAtPlot === 0 ? 0 : ((indexAtPlot % 2 === 1 ? 1 : -1) * Math.ceil(indexAtPlot / 2) * 0.9);
  return {
    x: +(layout.x + fwdX * 3.6 + sideX * lateral).toFixed(4),
    y: 0,
    z: +(layout.z + fwdZ * 3.6 + sideZ * lateral).toFixed(4),
    rotY: layout.rotY,
  };
}

export function pickBandstandSpot(avatarSpots, usedSpots, preferredSlot = null) {
  if (
    Number.isInteger(preferredSlot) &&
    preferredSlot >= 0 &&
    preferredSlot < avatarSpots.length &&
    !usedSpots.has(preferredSlot)
  ) {
    usedSpots.add(preferredSlot);
    const s = avatarSpots[preferredSlot];
    return { x: s.x, y: s.y, z: s.z, rotY: s.rotY, slot: preferredSlot, nametagLift: (preferredSlot % 2) * 0.5 };
  }
  for (let i = 0; i < avatarSpots.length; i++) {
    if (!usedSpots.has(i)) {
      usedSpots.add(i);
      const s = avatarSpots[i];
      return { x: s.x, y: s.y, z: s.z, rotY: s.rotY, slot: i, nametagLift: (i % 2) * 0.5 };
    }
  }
  // Overflow (>10 avatars at bandstand): place on an outer ring so capsules never stack
  const overflowIdx = usedSpots.size;
  usedSpots.add(overflowIdx);
  const angle = ((overflowIdx % 10) / 10) * Math.PI * 2 + 0.15;
  const r = TOWN_LAYOUT.bandstand.radius + 1.2 + Math.floor(overflowIdx / 10) * 0.9;
  const x = +(Math.sin(angle) * r).toFixed(4);
  const z = +(Math.cos(angle) * r).toFixed(4);
  return { x, y: 0, z, rotY: +Math.atan2(-x, -z).toFixed(4), slot: overflowIdx, nametagLift: (overflowIdx % 2) * 0.5 };
}

/**
 * Update an avatar's nametag sprite in place to show or clear a 1-line status below the badge.
 * @param {object} THREE
 * @param {object} avatar
 * @param {string|null|undefined} statusText
 */
export function setAvatarStatusText(THREE, avatar, statusText) {
  const sprite = avatar?.userData?.nametagSprite;
  if (!sprite || !sprite.material) return;

  const raw = typeof statusText === 'string' ? statusText.trim() : '';
  const nextStatus = raw ? (raw.length > 24 ? `${raw.slice(0, 23)}…` : raw) : null;
  const prevStatus = avatar.userData.statusText ?? null;
  if (prevStatus === nextStatus) {
    avatar.userData.statusText = nextStatus;
    return;
  }

  const handle = avatar.userData.handle || 'muse';
  const isNpc = avatar.userData.role === 'npc';
  const badge = isNpc ? `[NPC] ${handle}` : `[MUSE] ${handle}`;
  const fg = isNpc ? '#ffbe55' : '#9be0ff';

  const lines = nextStatus ? [badge, nextStatus] : [badge];
  const opts = nextStatus
    ? { width: 384, height: 144, titleSize: 30, subSize: 22, bg: '#161b28', border: fg, fg }
    : { width: 384, height: 96, titleSize: 30, bg: '#161b28', border: fg, fg };

  sprite.material.map?.dispose?.();
  sprite.material.map = makeTextTexture(THREE, lines, opts);
  sprite.material.needsUpdate = true;
  sprite.scale.set(1.5, nextStatus ? 0.5625 : 0.375, 1);
  avatar.userData.statusText = nextStatus;
}
