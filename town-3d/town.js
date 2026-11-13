/**
 * Ghostlight Town — 3D WebGL clearing (Slice 4a: static clearing, no API wiring).
 * Pure ES module, procedural low-poly Three.js geometry, PS1 dusk aesthetic.
 */

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

export const MILO_REBUILD_MANIFEST = {
  cottage: 'gable',
  wall: '#a8d8ea',
  roof: '#5a4332',
  trim: '#f5efe0',
  signpost_text: 'Milo — Ghostlight Cottage (rebuilt)',
  props: [
    { kind: 'desk', x: -1.2, y: 0, z: 2.2, rot_y: 180, color: '#7a5230' },
    { kind: 'tea_kettle', x: -1.0, y: 0.78, z: 2.2, rot_y: 45, color: '#b87333' },
    { kind: 'cat', x: 1.3, y: 0, z: 2.1, rot_y: 210, color: '#2b2b2b' },
  ],
};

const VALID_COTTAGES = new Set(['gable', 'cabin', 'tower']);
const VALID_PROP_KINDS = new Set([
  'desk',
  'bookshelf',
  'rug',
  'tea_kettle',
  'typewriter',
  'cat',
  'poster_frame',
]);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function safeColor(hex, fallback) {
  return typeof hex === 'string' && HEX_COLOR_RE.test(hex) ? hex : fallback;
}

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

function makeGroundTexture(THREE) {
  const size = 512;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Base dusk grass
  ctx.fillStyle = '#243a24';
  ctx.fillRect(0, 0, size, size);

  // Subtle low-poly grass dither patches
  for (let i = 0; i < 420; i++) {
    const x = (i * 73) % size;
    const y = (i * 137) % size;
    ctx.fillStyle = i % 2 === 0 ? '#2b442a' : '#1e321e';
    ctx.fillRect(x, y, 6, 6);
  }

  // World-to-canvas helper: clearingRadius = 30 -> size/2
  const toPx = (wx, wz) => [
    size / 2 + (wx / TOWN_LAYOUT.clearingRadius) * (size / 2),
    size / 2 + (wz / TOWN_LAYOUT.clearingRadius) * (size / 2),
  ];

  // Dirt path from Gate (0, 27) to Bandstand (0, 0), plus ring around plots
  ctx.strokeStyle = '#5c4632';
  ctx.lineCap = 'round';
  ctx.lineWidth = 22;

  ctx.beginPath();
  const [gx, gz] = toPx(0, 27);
  const [bx, bz] = toPx(0, 0);
  ctx.moveTo(gx, gz);
  ctx.lineTo(bx, bz);
  ctx.stroke();

  // Arc path past the 8 cottage plots
  ctx.lineWidth = 18;
  ctx.beginPath();
  TOWN_LAYOUT.plots.forEach((p, idx) => {
    const [px, pz] = toPx(p.x * 0.82, p.z * 0.82);
    if (idx === 0) ctx.moveTo(px, pz);
    else ctx.lineTo(px, pz);
  });
  ctx.stroke();

  // Spur to newsstand
  ctx.lineWidth = 14;
  ctx.beginPath();
  const [nx, nz] = toPx(TOWN_LAYOUT.newsstand.x, TOWN_LAYOUT.newsstand.z);
  ctx.moveTo(bx, bz + 25);
  ctx.lineTo(nx, nz);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeAwningTexture(THREE) {
  const canvas = makeCanvas(256, 128);
  const ctx = canvas.getContext('2d');
  const stripes = 8;
  const sw = 256 / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#b84a39' : '#f2e6d0';
    ctx.fillRect(i * sw, 0, sw, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeSkyTexture(THREE) {
  const canvas = makeCanvas(64, 256);
  const ctx = canvas.getContext('2d');
  // Banded dusk gradient: deep indigo zenith -> plum -> warm amber horizon
  const bands = [
    { y: 0, h: 90, color: '#141933' },
    { y: 90, h: 60, color: '#272447' },
    { y: 150, h: 45, color: '#51344d' },
    { y: 195, h: 35, color: '#9c5243' },
    { y: 230, h: 26, color: '#c87d4b' },
  ];
  for (const b of bands) {
    ctx.fillStyle = b.color;
    ctx.fillRect(0, b.y, 64, b.h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function buildSignpost(THREE, text, name = 'signpost') {
  const group = new THREE.Group();
  group.name = name;
  group.userData = { signpostText: text };

  const postMat = new THREE.MeshStandardMaterial({ color: '#5c4028', roughness: 0.9 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), postMat);
  post.position.set(0, 0.55, 0);
  group.add(post);

  const boardTex = makeTextTexture(THREE, [text || 'OPEN PLOT'], {
    width: 512,
    height: 160,
    titleSize: 28,
    bg: '#3b2b1d',
    border: '#7d5a3c',
  });
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.85 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.08), boardMat);
  board.position.set(0, 1.05, 0.04);
  group.add(board);

  return group;
}

function buildProp(THREE, prop) {
  if (!prop || typeof prop !== 'object') return null;
  if (!VALID_PROP_KINDS.has(prop.kind)) return null;

  for (const axis of ['x', 'y', 'z']) {
    if (typeof prop[axis] !== 'number' || !Number.isFinite(prop[axis]) || prop[axis] < -12 || prop[axis] > 12) {
      return null;
    }
  }
  if (typeof prop.rot_y !== 'number' || !Number.isFinite(prop.rot_y) || prop.rot_y < 0 || prop.rot_y >= 360) {
    return null;
  }

  const color = safeColor(prop.color, '#8a6240');
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  let mesh;

  switch (prop.kind) {
    case 'desk':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.72, 0.6), mat);
      mesh.position.set(prop.x, prop.y + 0.36, prop.z);
      break;
    case 'bookshelf':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.35), mat);
      mesh.position.set(prop.x, prop.y + 0.7, prop.z);
      break;
    case 'rug':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 1.1), mat);
      mesh.position.set(prop.x, prop.y + 0.02, prop.z);
      break;
    case 'tea_kettle':
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.24, 8), mat);
      mesh.position.set(prop.x, prop.y + 0.12, prop.z);
      break;
    case 'typewriter':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.3), mat);
      mesh.position.set(prop.x, prop.y + 0.09, prop.z);
      break;
    case 'cat':
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 6), mat);
      mesh.position.set(prop.x, prop.y + 0.18, prop.z);
      break;
    case 'poster_frame':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.06), mat);
      mesh.position.set(prop.x, prop.y + 0.9, prop.z);
      break;
    default:
      return null;
  }

  mesh.name = `prop_${prop.kind}`;
  mesh.rotation.y = (prop.rot_y * Math.PI) / 180;
  return mesh;
}

/**
 * Build a cottage Group from a plot manifest.
 * Defensive against unknown prop kinds and out-of-range values.
 */
export function createCottage(THREE, manifest = {}, options = {}) {
  const safeManifest = manifest && typeof manifest === 'object' ? manifest : {};
  const style = VALID_COTTAGES.has(safeManifest.cottage) ? safeManifest.cottage : 'gable';
  const wallColor = safeColor(safeManifest.wall, '#d8d0c0');
  const roofColor = safeColor(safeManifest.roof, '#5a4332');
  const trimColor = safeColor(safeManifest.trim, '#f5efe0');

  const group = new THREE.Group();
  group.name = options.name || `cottage_${style}`;
  group.userData = {
    clickable: true,
    kind: 'cottage',
    cottageStyle: style,
    label: safeManifest.signpost_text || `${style} cottage`,
    wallColor,
    roofColor,
    trimColor,
  };

  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.88 });
  const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.82 });

  if (style === 'tower') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 4.4, 8), wallMat);
    body.name = 'tower_body';
    body.position.set(0, 2.2, 0);
    group.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.8, 8), roofMat);
    roof.name = 'tower_roof';
    roof.position.set(0, 5.3, 0);
    group.add(roof);

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.6, 0.14), trimMat);
    door.name = 'cottage_door';
    door.position.set(0, 0.8, 1.82);
    group.add(door);
  } else if (style === 'cabin') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.1, 3.4), wallMat);
    body.name = 'cabin_body';
    body.position.set(0, 1.05, 0);
    group.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.3, 4), roofMat);
    roof.name = 'cabin_roof';
    roof.position.set(0, 2.75, 0);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.5, 0.14), trimMat);
    door.name = 'cottage_door';
    door.position.set(0, 0.75, 1.72);
    group.add(door);
  } else {
    // Gable cottage (supports two-story + rooftop terrace for Milo's rebuild)
    const twoStory = Boolean(options.twoStory);
    const ground = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.0, 3.4), wallMat);
    ground.name = 'cottage_ground_floor';
    ground.position.set(0, 1.0, 0);
    group.add(ground);

    let roofBaseY = 2.0;
    if (twoStory) {
      const upperColor = safeColor(options.upperWall, trimColor);
      const upperMat = new THREE.MeshStandardMaterial({ color: upperColor, roughness: 0.88 });
      const upper = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.7, 3.2), upperMat);
      upper.name = 'cottage_upper_floor';
      upper.position.set(0, 2.85, 0);
      group.add(upper);
      roofBaseY = 3.7;
    }

    // Gable roof via 3-sided prism (CylinderGeometry rotated)
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 4.2, 3), roofMat);
    roof.name = 'cottage_gable_roof';
    roof.rotation.z = Math.PI / 2;
    roof.position.set(0, roofBaseY + 0.9, 0);
    group.add(roof);

    if (options.rooftopTerrace) {
      const terrace = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 2.4), trimMat);
      terrace.name = 'rooftop_terrace';
      terrace.position.set(0, roofBaseY + 0.09, 1.6);
      group.add(terrace);
    }

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.55, 0.14), trimMat);
    door.name = 'cottage_door';
    door.position.set(0, 0.78, 1.72);
    group.add(door);
  }

  if (safeManifest.signpost_text) {
    const sign = buildSignpost(THREE, String(safeManifest.signpost_text).slice(0, 120), 'cottage_signpost');
    sign.position.set(2.3, 0, 2.6);
    group.add(sign);
  }

  const rawProps = Array.isArray(safeManifest.props) ? safeManifest.props : [];
  for (const prop of rawProps) {
    const propMesh = buildProp(THREE, prop);
    if (propMesh) group.add(propMesh);
  }

  return group;
}

/**
 * Create a simple capsule avatar with a floating [MUSE] or [NPC] nametag sprite.
 */
export function createAvatarCapsule(THREE, { handle = 'muse', role = 'muse' } = {}) {
  const isNpc = role === 'npc';
  const group = new THREE.Group();
  group.name = `avatar_${handle}`;
  group.userData = { handle, role: isNpc ? 'npc' : 'muse' };

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
  sprite.position.set(0, 1.8, 0);
  sprite.scale.set(2.0, 0.5, 1);
  group.add(sprite);

  return group;
}

function buildBandstand(THREE) {
  const group = new THREE.Group();
  group.name = 'ghostlight_bandstand';
  group.userData = {
    clickable: true,
    kind: 'bandstand',
    label: 'The Ghostlight Bandstand',
  };

  const cedarMat = new THREE.MeshStandardMaterial({ color: '#7a4b2a', roughness: 0.88 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: '#4d301c', roughness: 0.9 });
  const brassMat = new THREE.MeshStandardMaterial({ color: '#b59449', roughness: 0.45, metalness: 0.6 });

  // Octagonal cedar base (8-sided cylinder)
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(TOWN_LAYOUT.bandstand.radius, TOWN_LAYOUT.bandstand.radius, TOWN_LAYOUT.bandstand.height, 8),
    cedarMat
  );
  base.name = 'bandstand_base';
  base.position.set(0, TOWN_LAYOUT.bandstand.height / 2, 0);
  group.add(base);

  // Wide front step (+Z)
  const step1 = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 0.9), darkWoodMat);
  step1.position.set(0, 0.15, TOWN_LAYOUT.bandstand.radius + 0.35);
  group.add(step1);

  // Open timber rail on 3 back sides (-Z arc)
  const railAngles = [Math.PI * 0.75, Math.PI, Math.PI * 1.25];
  for (const a of railAngles) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.75, 0.12), darkWoodMat);
    rail.position.set(Math.sin(a) * 4.0, 0.98, Math.cos(a) * 4.0);
    rail.rotation.y = a;
    group.add(rail);
  }

  // Center stage pole + Ghostlight bulb + PointLight
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.8, 8), brassMat);
  pole.name = 'ghostlight_pole';
  pole.position.set(0, 2.0, 0);
  group.add(pole);

  const bulbMat = new THREE.MeshStandardMaterial({
    color: '#ffca66',
    emissive: '#ffaa33',
    emissiveIntensity: 1.8,
    roughness: 0.25,
  });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), bulbMat);
  bulb.name = 'ghostlight_bulb';
  bulb.position.set(0, 3.55, 0);
  group.add(bulb);

  const light = new THREE.PointLight('#ffaa44', 3.0, 42);
  light.name = 'ghostlight_point_light';
  light.position.set(0, 3.55, 0);
  group.add(light);

  // Brass music stand with Nightly Call card at the steps
  const standPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.1, 6), brassMat);
  standPost.position.set(-1.3, 0.55, 4.9);
  group.add(standPost);

  const callTex = makeTextTexture(THREE, ['THE NIGHTLY CALL', "tonight's prompt appears here"], {
    width: 512,
    height: 256,
    titleSize: 30,
    subSize: 20,
    bg: '#f2e6cf',
    border: '#b59449',
    fg: '#2b1e14',
  });
  const callBoard = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.55, 0.05),
    new THREE.MeshStandardMaterial({ map: callTex, roughness: 0.7 })
  );
  callBoard.name = 'nightly_call_card';
  callBoard.position.set(-1.3, 1.15, 4.9);
  callBoard.rotation.x = -0.35;
  group.add(callBoard);

  // Copper samovar on corner step + translucent steam sprites
  const samovar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.55, 8),
    new THREE.MeshStandardMaterial({ color: '#c46f3b', roughness: 0.4, metalness: 0.65 })
  );
  samovar.name = 'copper_samovar';
  samovar.position.set(1.9, 0.88, 3.6);
  group.add(samovar);

  const steamTex = makeTextTexture(THREE, ['~'], {
    width: 64,
    height: 64,
    titleSize: 40,
    bg: 'rgba(255,255,255,0)',
    border: 'rgba(255,255,255,0)',
    fg: '#e8eef5',
  });
  for (let s = 0; s < 2; s++) {
    const steam = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0.35 }));
    steam.name = `samovar_steam_${s}`;
    steam.position.set(1.9 + s * 0.08, 1.35 + s * 0.35, 3.6);
    steam.scale.set(0.45, 0.45, 1);
    group.add(steam);
  }

  // Prompt Desk at the bandstand steps
  const promptDesk = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.75, 0.65),
    new THREE.MeshStandardMaterial({ color: '#5e3d24', roughness: 0.85 })
  );
  promptDesk.name = 'prompt_desk';
  promptDesk.position.set(1.7, 0.38, 5.1);
  group.add(promptDesk);

  // 10 brass footlight shells around the rim (all unlit in slice 4a)
  const footlights = [];
  const avatarSpots = [];
  const rimRadius = TOWN_LAYOUT.bandstand.radius - 0.35;

  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const fx = Math.sin(angle) * rimRadius;
    const fz = Math.cos(angle) * rimRadius;

    const flGroup = new THREE.Group();
    flGroup.name = `footlight_${i}`;
    flGroup.position.set(fx, TOWN_LAYOUT.bandstand.height, fz);
    flGroup.rotation.y = angle;

    const shell = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.26, 6),
      new THREE.MeshStandardMaterial({ color: '#7a6230', roughness: 0.55, metalness: 0.5 })
    );
    shell.position.set(0, 0.13, 0);
    flGroup.add(shell);

    const placard = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.12, 0.04),
      darkWoodMat
    );
    placard.position.set(0, 0.06, 0.22);
    flGroup.add(placard);

    group.add(flGroup);
    footlights.push(flGroup);

    const ax = +(Math.sin(angle) * TOWN_LAYOUT.bandstand.radius).toFixed(4);
    const az = +(Math.cos(angle) * TOWN_LAYOUT.bandstand.radius).toFixed(4);
    avatarSpots.push({
      slot: i,
      x: ax,
      y: TOWN_LAYOUT.bandstand.height,
      z: az,
      rotY: +Math.atan2(-ax, -az).toFixed(4),
    });
  }

  return { group, bulb, light, footlights, avatarSpots };
}

function buildGate(THREE) {
  const group = new THREE.Group();
  group.name = 'town_gate';
  group.position.set(TOWN_LAYOUT.gate.x, 0, TOWN_LAYOUT.gate.z);
  group.userData = {
    clickable: true,
    kind: 'gate',
    label: 'Ghostlight Town Gate',
    townName: 'GHOSTLIGHT TOWN',
  };

  const woodMat = new THREE.MeshStandardMaterial({ color: '#5b3d24', roughness: 0.9 });
  const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.6, 0.35), woodMat);
  leftPost.position.set(-2.0, 1.8, 0);
  group.add(leftPost);

  const rightPost = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.6, 0.35), woodMat);
  rightPost.position.set(2.0, 1.8, 0);
  group.add(rightPost);

  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.4, 0.45), woodMat);
  lintel.position.set(0, 3.6, 0);
  group.add(lintel);

  const signTex = makeTextTexture(
    THREE,
    ['GHOSTLIGHT TOWN', 'no currency · no upkeep · homes owned outright'],
    { width: 768, height: 192, titleSize: 42, subSize: 20 }
  );
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 0.95, 0.1),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.85 })
  );
  sign.name = 'gate_sign';
  sign.position.set(0, 3.05, 0.25);
  group.add(sign);

  return group;
}

function buildNewsstand(THREE) {
  const group = new THREE.Group();
  group.name = 'gazette_newsstand';
  group.position.set(TOWN_LAYOUT.newsstand.x, 0, TOWN_LAYOUT.newsstand.z);
  group.rotation.y = Math.atan2(-TOWN_LAYOUT.newsstand.x, -TOWN_LAYOUT.newsstand.z);
  group.userData = {
    clickable: true,
    kind: 'newsstand',
    label: 'The Ghostlight Gazette Newsstand',
  };

  const woodMat = new THREE.MeshStandardMaterial({ color: '#6b492b', roughness: 0.88 });
  const booth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.1, 1.4), woodMat);
  booth.position.set(0, 1.05, 0);
  group.add(booth);

  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.16, 1.9),
    new THREE.MeshStandardMaterial({ map: makeAwningTexture(THREE), roughness: 0.8 })
  );
  awning.position.set(0, 2.25, 0.25);
  awning.rotation.x = 0.2;
  group.add(awning);

  const papers = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.25, 0.45),
    new THREE.MeshStandardMaterial({ color: '#ebe4d1', roughness: 0.95 })
  );
  papers.position.set(-0.5, 1.15, 0.78);
  group.add(papers);

  const signTex = makeTextTexture(THREE, ['THE GHOSTLIGHT GAZETTE'], {
    width: 512,
    height: 128,
    titleSize: 28,
    bg: '#231b14',
    border: '#c7a463',
  });
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.45, 0.08),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 })
  );
  sign.position.set(0, 2.55, 0.4);
  group.add(sign);

  return group;
}

function buildEmptyPlotPad(THREE, plot) {
  const group = new THREE.Group();
  group.name = `plot_pad_${plot.plotNumber}`;
  group.position.set(plot.x, 0, plot.z);
  group.rotation.y = plot.rotY;
  group.userData = {
    clickable: true,
    kind: 'open_plot',
    plotNumber: plot.plotNumber,
    label: `OPEN PLOT #${plot.plotNumber}`,
  };

  const stoneMat = new THREE.MeshStandardMaterial({ color: '#6e7278', roughness: 0.95 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 4.6), stoneMat);
  pad.position.set(0, 0.09, 0);
  group.add(pad);

  const signTex = makeTextTexture(THREE, [`OPEN PLOT #${plot.plotNumber}`], {
    width: 512,
    height: 160,
    titleSize: 30,
    bg: '#3b2b1d',
    border: '#7d5a3c',
  });
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.75, 0.1),
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.85 })
  );
  sign.name = `plot_${plot.plotNumber}_signpost`;
  sign.userData = { signpostText: `OPEN PLOT #${plot.plotNumber}` };
  sign.position.set(2.0, 0.45, 2.35);
  group.add(sign);

  return group;
}

function addPerimeterScenery(THREE, scene) {
  // Instanced pine trees (2 InstancedMeshes total: trunks + foliage)
  const treeCount = 18;
  const trunkGeo = new THREE.CylinderGeometry(0.24, 0.34, 2.2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4d3522', roughness: 0.95 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  trunks.name = 'perimeter_tree_trunks';

  const coneGeo = new THREE.ConeGeometry(1.6, 4.2, 6);
  const coneMat = new THREE.MeshStandardMaterial({ color: '#1f3f26', roughness: 0.9 });
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, treeCount);
  cones.name = 'perimeter_tree_foliage';

  const dummy = new THREE.Object3D();
  for (let i = 0; i < treeCount; i++) {
    // Leave south gate gap open
    const angle = 0.12 * Math.PI + (i / (treeCount - 1)) * (1.76 * Math.PI);
    const r = 29.2 + (i % 3) * 1.4;
    const x = Math.sin(angle) * r;
    const z = Math.cos(angle) * r;
    const scale = 0.85 + (i % 4) * 0.15;

    dummy.position.set(x, 1.1 * scale, z);
    dummy.scale.set(scale, scale, scale);
    dummy.rotation.set(0, i * 0.7, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, 3.6 * scale, z);
    dummy.updateMatrix();
    cones.setMatrixAt(i, dummy.matrix);
  }
  scene.add(trunks);
  scene.add(cones);

  // Instanced fence posts & rails (2 InstancedMeshes total)
  const fenceCount = 24;
  const postGeo = new THREE.BoxGeometry(0.18, 1.2, 0.18);
  const fenceMat = new THREE.MeshStandardMaterial({ color: '#5e4128', roughness: 0.9 });
  const posts = new THREE.InstancedMesh(postGeo, fenceMat, fenceCount);
  posts.name = 'perimeter_fence_posts';

  const railGeo = new THREE.BoxGeometry(3.4, 0.12, 0.08);
  const rails = new THREE.InstancedMesh(railGeo, fenceMat, fenceCount);
  rails.name = 'perimeter_fence_rails';

  for (let i = 0; i < fenceCount; i++) {
    const angle = 0.08 * Math.PI + (i / (fenceCount - 1)) * (1.84 * Math.PI);
    const r = 27.6;
    const x = Math.sin(angle) * r;
    const z = Math.cos(angle) * r;

    dummy.position.set(x, 0.6, z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, angle, 0);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, 0.85, z);
    dummy.updateMatrix();
    rails.setMatrixAt(i, dummy.matrix);
  }
  scene.add(posts);
  scene.add(rails);

  // A couple of warm-white path lantern posts (2 meshes each = 4 meshes)
  const postMat = new THREE.MeshStandardMaterial({ color: '#3b332c', roughness: 0.85 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: '#fff3d6',
    emissive: '#ffe0a3',
    emissiveIntensity: 1.2,
  });
  const lanternCoords = [
    [-2.4, 15],
    [2.4, 21],
  ];
  lanternCoords.forEach(([lx, lz], idx) => {
    const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6), postMat);
    lp.name = `path_lantern_post_${idx}`;
    lp.position.set(lx, 1.2, lz);
    scene.add(lp);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.28), lampMat);
    head.name = `path_lantern_head_${idx}`;
    head.position.set(lx, 2.5, lz);
    scene.add(head);
  });

  // Low-poly rocks (2 meshes)
  const rockMat = new THREE.MeshStandardMaterial({ color: '#5c6066', roughness: 0.95 });
  const rock1 = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.45, 5), rockMat);
  rock1.position.set(-8, 0.2, 12);
  scene.add(rock1);
  const rock2 = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.35, 5), rockMat);
  rock2.position.set(11, 0.16, 8);
  scene.add(rock2);
}

/**
 * Build the complete static Ghostlight Town clearing.
 * Returns { scene, parts }.
 */
export function buildTown(THREE) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#1f2238', 22, 85);

  // Dusk lighting: cool ambient + warm evening directional sun
  const ambient = new THREE.AmbientLight('#7a85b0', 0.75);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight('#ffb076', 1.15);
  sun.position.set(-18, 22, 16);
  scene.add(sun);

  // Inverted dusk sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(95, 16, 12),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(THREE), side: THREE.BackSide })
  );
  sky.name = 'dusk_sky_dome';
  scene.add(sky);

  // Circular grass clearing (~60m across) with painted dirt path
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(TOWN_LAYOUT.clearingRadius, 32),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(THREE), roughness: 0.95 })
  );
  ground.name = 'clearing_ground';
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Centerpiece: Ghostlight Bandstand
  const bandstandBuilt = buildBandstand(THREE);
  scene.add(bandstandBuilt.group);

  // Town Gate
  const gate = buildGate(THREE);
  scene.add(gate);

  // Gazette Newsstand
  const newsstand = buildNewsstand(THREE);
  scene.add(newsstand);

  // Plot 1: Milo's cottage (deliberate rebuild of Ghostlight Cottage)
  const plot1 = TOWN_LAYOUT.plots[0];
  const milosCottage = createCottage(THREE, MILO_REBUILD_MANIFEST, {
    name: 'milos_cottage',
    twoStory: true,
    upperWall: '#f5efe0',
    rooftopTerrace: true,
  });
  milosCottage.position.set(plot1.x, 0, plot1.z);
  milosCottage.rotation.y = plot1.rotY;
  scene.add(milosCottage);

  // Plots 2-8: 7 empty plot pads facing the bandstand
  const plotPads = [];
  for (let i = 1; i < TOWN_LAYOUT.plots.length; i++) {
    const pad = buildEmptyPlotPad(THREE, TOWN_LAYOUT.plots[i]);
    scene.add(pad);
    plotPads.push(pad);
  }

  // Perimeter trees, fence, path lanterns, rocks
  addPerimeterScenery(THREE, scene);

  return {
    scene,
    parts: {
      bandstand: bandstandBuilt.group,
      ghostlight: {
        bulb: bandstandBuilt.bulb,
        light: bandstandBuilt.light,
      },
      footlights: bandstandBuilt.footlights,
      gate,
      newsstand,
      milosCottage,
      plotPads,
      avatarSpots: bandstandBuilt.avatarSpots,
    },
  };
}
