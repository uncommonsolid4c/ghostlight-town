/**
 * Ghostlight Town — 3D WebGL clearing (Slice 4a: static clearing, no API wiring).
 * Pure ES module, procedural low-poly Three.js geometry, PS1 dusk aesthetic.
 */

import { createConceptMilosCottage } from './concept-cottage.js';
import { createConceptMiloGhost } from './concept-ghost.js?v=2';
import { buildConceptBandstand } from './concept-bandstand.js';

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

/**
 * Prop placements for GLB set-dressing props (and their procedural fallbacks).
 * Edit coordinates, rotations, or targetSize here to retune placement.
 */
export const PROP_PLACEMENTS = [
  {
    id: 'gate_lantern_left',
    kind: 'post-lantern',
    model: 'models/post-lantern.glb',
    parent: 'scene',
    x: -3.2,
    y: 0,
    z: 26.2,
    rotY: 0,
    targetSize: 2.2,
    scaleAxis: 'y',
  },
  {
    id: 'gate_lantern_right',
    kind: 'post-lantern',
    model: 'models/post-lantern.glb',
    parent: 'scene',
    x: 3.2,
    y: 0,
    z: 26.2,
    rotY: 0,
    targetSize: 2.2,
    scaleAxis: 'y',
  },
  {
    id: 'bandstand_bench',
    kind: 'bench',
    model: 'models/bench.glb',
    parent: 'scene',
    x: -6.2,
    y: 0,
    z: 5.5,
    rotY: +Math.atan2(6.2, -5.5).toFixed(4),
    targetSize: 1.8,
    scaleAxis: 'length',
  },
  {
    id: 'newsstand_lantern',
    kind: 'lantern',
    model: 'models/lantern.glb',
    parent: 'newsstand',
    x: 0.65,
    y: 1.03,
    z: 0.78,
    rotY: 0,
    targetSize: 0.35,
    scaleAxis: 'y',
  },
  {
    id: 'newsstand_street_light',
    kind: 'street-light',
    model: 'models/street-light.glb',
    parent: 'scene',
    x: 7.8,
    y: 0,
    z: 15.2,
    rotY: 0,
    targetSize: 3.0,
    scaleAxis: 'y',
  },
  {
    id: 'newsstand_bookshelf',
    kind: 'bookshelf',
    model: 'models/bookshelf.glb',
    parent: 'scene',
    x: 4.6,
    y: 0,
    z: 15.0,
    rotY: +Math.atan2(-4.6, -15.0).toFixed(4),
    targetSize: 1.6,
    scaleAxis: 'y',
  },
  {
    id: 'wick_oil_lamp',
    kind: 'oil-lamp',
    model: 'models/oil-lamp.glb',
    parent: 'scene',
    x: 14.41,
    y: 0,
    z: -6.05,
    rotY: -1.1733,
    targetSize: 0.9,
    scaleAxis: 'y',
  },
  {
    id: 'tomas_teapot',
    kind: 'teapot',
    model: 'models/teapot.glb',
    parent: 'scene',
    x: 2.06,
    y: 0,
    z: -15.49,
    rotY: -0.1322,
    targetSize: 0.9,
    scaleAxis: 'y',
  },
  {
    id: 'maren_typewriter',
    kind: 'typewriter',
    parent: 'scene',
    x: 9.49,
    y: 0,
    z: -12.42,
    rotY: -0.6525,
  },
];

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

const SIGNPOST_FONT_SIZES = [28, 24, 20];
const SIGNPOST_MAX_LINES = 3;
const SIGNPOST_INNER_WIDTH = 480;

/**
 * Word-wrap signpost text for a fixed-width monospace board without canvas measurement.
 */
function wrapSignpostText(text, maxChars) {
  const str = String(text ?? '').trim();
  if (!str) return [];
  const limit = Math.max(1, Math.floor(maxChars));
  const words = str.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (word.length > limit) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += limit) {
        const chunk = word.slice(i, i + limit);
        if (i + limit < word.length) {
          lines.push(chunk);
        } else {
          current = chunk;
        }
      }
      continue;
    }
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildSignpost(THREE, text, name = 'signpost') {
  const group = new THREE.Group();
  group.name = name;

  const rawText = String(text || 'OPEN PLOT').trim() || 'OPEN PLOT';
  let fontSize = SIGNPOST_FONT_SIZES[0];
  let lines = [];
  let maxChars = Math.floor(SIGNPOST_INNER_WIDTH / (0.6 * fontSize));

  for (const size of SIGNPOST_FONT_SIZES) {
    fontSize = size;
    maxChars = Math.floor(SIGNPOST_INNER_WIDTH / (0.6 * size));
    lines = wrapSignpostText(rawText, maxChars);
    if (lines.length <= SIGNPOST_MAX_LINES) break;
  }

  if (lines.length > SIGNPOST_MAX_LINES) {
    lines = lines.slice(0, SIGNPOST_MAX_LINES);
    const last = lines[SIGNPOST_MAX_LINES - 1];
    lines[SIGNPOST_MAX_LINES - 1] = `${last.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
  }

  group.userData = {
    signpostText: text,
    signpostLines: lines,
    signpostFontSize: fontSize,
  };

  const postMat = new THREE.MeshStandardMaterial({ color: '#5c4028', roughness: 0.9 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), postMat);
  post.position.set(0, 0.55, 0);
  group.add(post);

  const boardTex = makeTextTexture(THREE, lines, {
    width: 512,
    height: 160,
    titleSize: fontSize,
    subSize: fontSize,
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

  // Concept-matched cottage (Argon's proof, CONCEPT.md): Milo's plot 1 only.
  // The concept builder owns walls/roof/windows/terrace; the signpost and
  // manifest props still attach here, mirroring the tail below, so the swap
  // loses nothing visible. Other cottages keep the classic builder.
  if (options.conceptCottage) {
    const conceptGroup = createConceptMilosCottage(THREE, {
      name: options.name || 'milos_cottage',
      label: safeManifest.signpost_text || 'Milo — Ghostlight Cottage (rebuilt)',
    });
    if (safeManifest.signpost_text) {
      const sign = buildSignpost(THREE, String(safeManifest.signpost_text).slice(0, 120), 'cottage_signpost');
      sign.position.set(2.3, 0, 2.6);
      conceptGroup.add(sign);
    }
    const rawProps = Array.isArray(safeManifest.props) ? safeManifest.props : [];
    for (const prop of rawProps) {
      const propMesh = buildProp(THREE, prop);
      if (propMesh) conceptGroup.add(propMesh);
    }
    return conceptGroup;
  }

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
  // Warm lit windows: the town is a night scene, and a house with no windows
  // looks dead. The emissive glass glows without needing a light source.
  const windowMat = new THREE.MeshStandardMaterial({
    color: '#ffd489', emissive: '#ffbe5c', emissiveIntensity: 1.4, roughness: 0.4,
  });
  function addWindow(x, y, z, rotY) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.08), trimMat);
    frame.name = 'cottage_window_frame';
    frame.position.set(x, y, z);
    frame.rotation.y = rotY;
    group.add(frame);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.1), windowMat);
    glass.name = 'cottage_window';
    glass.position.set(x, y, z);
    glass.rotation.y = rotY;
    group.add(glass);
  }

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

    // Two small front windows, sunk slightly into the curved wall.
    addWindow(0, 1.7, 1.78, 0);
    addWindow(0, 3.1, 1.72, 0);
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

    addWindow(-1.3, 1.15, 1.71, 0);
    addWindow(1.3, 1.15, 1.71, 0);
    addWindow(-2.11, 1.15, 0, Math.PI / 2);
    addWindow(2.11, 1.15, 0, Math.PI / 2);
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

    // Gable roof via 3-sided prism (CylinderGeometry rotated).
    // rotation.z lays the prism's axis along X, but leaves the triangular
    // cross-section pointing sideways (apex toward +Y at z=-r/2) — the roof
    // renders as a leaning fin. rotation.x spins the prism about its own long
    // axis so the apex points straight up: with Euler order XYZ, Rz applies
    // first, then Rx, so Rx(-90°) moves the (y=0, z=+r) vertex to (y=+r, z=0).
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 4.2, 3), roofMat);
    roof.name = 'cottage_gable_roof';
    roof.rotation.z = Math.PI / 2;
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(0, roofBaseY + 0.9, 0);
    group.add(roof);

    if (options.rooftopTerrace) {
      // Widow's walk: flat platform straddling the gable ridge, on short posts.
      // Ridge apex is at roofBaseY + 0.9 + 2.3 = roofBaseY + 3.2.
      const terrace = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.9), trimMat);
      terrace.name = 'rooftop_terrace';
      terrace.position.set(0, roofBaseY + 3.26, 0);
      group.add(terrace);
      // Roof surface at z=±0.35 is roofBaseY + 2.6; posts bridge it to the platform.
      const terracePostGeo = new THREE.BoxGeometry(0.08, 0.62, 0.08);
      [[-1.0, -0.35], [1.0, -0.35], [-1.0, 0.35], [1.0, 0.35]].forEach(([px, pz]) => {
        const post = new THREE.Mesh(terracePostGeo, trimMat);
        post.name = 'terrace_post';
        post.position.set(px, roofBaseY + 2.9, pz);
        group.add(post);
      });
    }

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.55, 0.14), trimMat);
    door.name = 'cottage_door';
    door.position.set(0, 0.78, 1.72);
    group.add(door);

    // Ground floor: two front windows flanking the door, one per side.
    addWindow(-1.25, 1.15, 1.71, 0);
    addWindow(1.25, 1.15, 1.71, 0);
    addWindow(-2.01, 1.15, 0, Math.PI / 2);
    addWindow(2.01, 1.15, 0, Math.PI / 2);
    // Upper floor (two-story only): two front windows.
    if (twoStory) {
      addWindow(-1.05, 2.9, 1.61, 0);
      addWindow(1.05, 2.9, 1.61, 0);
    }
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

// The bandstand is Argon's concept build (town-3d/concept-bandstand.js):
// timber A-frame, hanging Ghostlight bulb, railings, post lanterns.
// Stage props stay on (includeStageProps) — the Nightly Call card is the
// topic's physical home and the samovar is Tomas's whole vibe.
function buildBandstand(THREE) {
  return buildConceptBandstand(THREE, { includeStageProps: true });
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
  // Sit the awning on the booth: low enough that the tilted slab meets the
  // counter box instead of floating above it with a visible gap.
  awning.position.set(0, 2.08, 0.15);
  awning.rotation.x = 0.15;
  group.add(awning);

  const papers = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.25, 0.45),
    new THREE.MeshStandardMaterial({ color: '#ebe4d1', roughness: 0.95 })
  );
  papers.position.set(-0.5, 1.15, 0.78);
  group.add(papers);

  const papersShelf = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.06, 0.52), woodMat);
  papersShelf.name = 'newsstand_papers_shelf';
  papersShelf.position.set(-0.5, 0.995, 0.8);
  group.add(papersShelf);

  const bracketGeo = new THREE.BoxGeometry(0.06, 0.16, 0.28);
  const bracketL = new THREE.Mesh(bracketGeo, woodMat);
  bracketL.name = 'newsstand_papers_bracket_l';
  bracketL.position.set(-0.8, 0.885, 0.84);
  group.add(bracketL);

  const bracketR = new THREE.Mesh(bracketGeo, woodMat);
  bracketR.name = 'newsstand_papers_bracket_r';
  bracketR.position.set(-0.2, 0.885, 0.84);
  group.add(bracketR);

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

export const INN_ROOM_WINDOWS = {
  lantern: 4,
  window: 5,
  quiet: 6,
};

export const INN_WINDOW_COLORS = {
  claimed: { color: '#ffbe5c', emissive: '#ffbe5c', emissiveIntensity: 1.4 },
  vacant: { color: '#3d2814', emissive: '#4a2e10', emissiveIntensity: 0.15 },
};

/**
 * Build the Ghostlight Inn (two-story cedar-and-cream building with gable roof,
 * chimney, warm lit windows on both floors, signpost, and hanging door lantern).
 */
export function buildInn(THREE) {
  const { x, z } = TOWN_LAYOUT.inn;
  const group = new THREE.Group();
  group.name = 'ghostlight_inn';
  group.position.set(x, 0, z);
  group.rotation.y = Math.atan2(-x, -z);
  group.userData = {
    clickable: true,
    kind: 'inn',
    label: 'Ghostlight Inn',
    signpostText: 'GHOSTLIGHT INN',
  };

  const cedarMat = new THREE.MeshStandardMaterial({ color: '#6b492b', roughness: 0.88 });
  const creamMat = new THREE.MeshStandardMaterial({ color: '#f5efe0', roughness: 0.88 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#5a4332', roughness: 0.85 });
  const windowMat = new THREE.MeshStandardMaterial({
    color: '#ffbe5c',
    emissive: '#ffbe5c',
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });

  const ground = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.1, 3.6), cedarMat);
  ground.name = 'inn_ground_floor';
  ground.position.set(0, 1.05, 0);
  group.add(ground);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.8, 3.4), creamMat);
  upper.name = 'inn_upper_floor';
  upper.position.set(0, 3.0, 0);
  group.add(upper);

  const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 4.8, 3), roofMat);
  roof.name = 'inn_gable_roof';
  roof.rotation.z = Math.PI / 2;
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(0, 4.8, 0);
  group.add(roof);

  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), roofMat);
  chimney.name = 'inn_chimney';
  chimney.position.set(-1.35, 5.7, -0.5);
  group.add(chimney);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.6, 0.14), roofMat);
  door.name = 'inn_door';
  door.position.set(0, 0.8, 1.82);
  group.add(door);

  const windowGeo = new THREE.BoxGeometry(0.65, 0.82, 0.1);
  const windowSpecs = [
    [-1.45, 1.15, 1.81, 0],
    [1.45, 1.15, 1.81, 0],
    [-2.31, 1.15, 0, Math.PI / 2],
    [2.31, 1.15, 0, Math.PI / 2],
    [-1.25, 3.0, 1.71, 0],
    [1.25, 3.0, 1.71, 0],
    [-2.21, 3.0, 0, Math.PI / 2],
    [2.21, 3.0, 0, Math.PI / 2],
  ];
  const roomWindowByIndex = new Map(
    Object.entries(INN_ROOM_WINDOWS).map(([room, idx]) => [idx, room])
  );
  const roomWindows = {};
  windowSpecs.forEach(([wx, wy, wz, rotY], idx) => {
    const roomName = roomWindowByIndex.get(idx);
    const mat = roomName
      ? (typeof windowMat.clone === 'function'
          ? windowMat.clone()
          : new THREE.MeshStandardMaterial({
              color: windowMat.color,
              emissive: windowMat.emissive,
              emissiveIntensity: windowMat.emissiveIntensity,
              roughness: windowMat.roughness,
            }))
      : windowMat;
    const win = new THREE.Mesh(windowGeo, mat);
    win.name = `inn_window_${idx}`;
    win.position.set(wx, wy, wz);
    win.rotation.y = rotY;
    group.add(win);
    if (roomName) {
      roomWindows[roomName] = win;
    }
  });
  group.userData.roomWindows = roomWindows;

  const sign = buildSignpost(THREE, 'GHOSTLIGHT INN', 'inn_signpost');
  sign.position.set(2.6, 0, 2.5);
  group.add(sign);

  const doorLantern = buildProceduralLantern(THREE);
  doorLantern.name = 'inn_door_lantern';
  doorLantern.position.set(0.75, 1.55, 1.92);
  group.add(doorLantern);

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
    // Trunks must stand ON the clearing ground (radius 30) and outside the
    // fence (27.6): 27.8 / 28.5 / 29.2. The old 29.2 / 30.6 / 32.0 put 12 of
    // 18 trees past the ground edge, floating over the void.
    const r = 27.8 + (i % 3) * 0.7;
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

  // Rails run BETWEEN posts, not centered on them: each rail sits on the chord
  // between two adjacent posts (chord length ~6.92 at r=27.6, so a 7.1 rail
  // overlaps each post slightly). One rail per gap, hence fenceCount - 1.
  const railGeo = new THREE.BoxGeometry(7.1, 0.12, 0.08);
  const rails = new THREE.InstancedMesh(railGeo, fenceMat, fenceCount - 1);
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

    if (i < fenceCount - 1) {
      const nextAngle = 0.08 * Math.PI + ((i + 1) / (fenceCount - 1)) * (1.84 * Math.PI);
      const midAngle = (angle + nextAngle) / 2;
      const chordR = r * Math.cos((nextAngle - angle) / 2);
      dummy.position.set(Math.sin(midAngle) * chordR, 0.85, Math.cos(midAngle) * chordR);
      dummy.rotation.set(0, midAngle, 0);
      dummy.updateMatrix();
      rails.setMatrixAt(i, dummy.matrix);
    }
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

function buildProceduralPostLantern(THREE) {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: '#3b332c', roughness: 0.85 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: '#fff3d6',
    emissive: '#ffe0a3',
    emissiveIntensity: 1.2,
  });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.9, 6), postMat);
  post.position.set(0, 0.95, 0);
  group.add(post);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.28), lampMat);
  head.position.set(0, 2.04, 0);
  group.add(head);
  return group;
}

function buildProceduralLantern(THREE) {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: '#3b332c', roughness: 0.8 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#fff3d6',
    emissive: '#ffca66',
    emissiveIntensity: 1.1,
  });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.08, 6), frameMat);
  cap.position.set(0, 0.31, 0);
  group.add(cap);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.16), glassMat);
  body.position.set(0, 0.14, 0);
  group.add(body);
  return group;
}

function buildProceduralBench(THREE) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: '#6b492b', roughness: 0.88 });
  const ironMat = new THREE.MeshStandardMaterial({ color: '#34383d', roughness: 0.8 });

  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.52), woodMat);
  seat.position.set(0, 0.45, 0);
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.38, 0.07), woodMat);
  back.position.set(0, 0.72, -0.22);
  group.add(back);

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.48), ironMat);
  leftLeg.position.set(-0.75, 0.225, 0);
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.48), ironMat);
  rightLeg.position.set(0.75, 0.225, 0);
  group.add(rightLeg);
  return group;
}

export function buildProceduralStreetLight(THREE) {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: '#2e3338', roughness: 0.85 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: '#fff3d6',
    emissive: '#ffe0a3',
    emissiveIntensity: 1.2,
  });

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.7, 6), postMat);
  post.position.set(0, 1.35, 0);
  group.add(post);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.06), postMat);
  arm.position.set(0.24, 2.68, 0);
  group.add(arm);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.24), lampMat);
  head.position.set(0.46, 2.55, 0);
  group.add(head);
  return group;
}

export function buildProceduralBookshelf(THREE) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: '#6b492b', roughness: 0.88 });
  const shelfMat = new THREE.MeshStandardMaterial({ color: '#825b38', roughness: 0.85 });
  const bookMat = new THREE.MeshStandardMaterial({ color: '#8b3a3a', roughness: 0.82 });

  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.34), woodMat);
  frame.position.set(0, 0.8, 0);
  group.add(frame);

  const lowerShelf = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.05, 0.36), shelfMat);
  lowerShelf.position.set(0, 0.55, 0.01);
  group.add(lowerShelf);

  const upperShelf = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.05, 0.36), shelfMat);
  upperShelf.position.set(0, 1.05, 0.01);
  group.add(upperShelf);

  const books = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.24), bookMat);
  books.position.set(-0.08, 0.71, 0.04);
  group.add(books);
  return group;
}

export function buildProceduralOilLamp(THREE) {
  const group = new THREE.Group();
  const brassMat = new THREE.MeshStandardMaterial({ color: '#9a7b3e', roughness: 0.65 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#fff1c9',
    emissive: '#ffcf70',
    emissiveIntensity: 1.1,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.14, 8), brassMat);
  base.position.set(0, 0.07, 0);
  group.add(base);

  const globe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.24, 8), glassMat);
  globe.position.set(0, 0.26, 0);
  group.add(globe);

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), brassMat);
  handle.position.set(0.13, 0.22, 0);
  group.add(handle);
  return group;
}

export function buildProceduralTypewriter(THREE) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: '#6b492b', roughness: 0.88 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.75 });
  const rollerMat = new THREE.MeshStandardMaterial({ color: '#d8d2c5', roughness: 0.8 });

  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.55), woodMat);
  stand.position.set(0, 0.04, 0);
  group.add(stand);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.36), bodyMat);
  body.position.set(0, 0.17, 0);
  group.add(body);

  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), rollerMat);
  roller.rotation.z = Math.PI / 2;
  roller.position.set(0, 0.28, -0.1);
  group.add(roller);
  return group;
}

export function buildProceduralTeapot(THREE) {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: '#8f6b47', roughness: 0.65 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.28, 8), metalMat);
  body.position.set(0, 0.14, 0);
  group.add(body);

  const spout = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.05), metalMat);
  spout.position.set(0.2, 0.18, 0);
  group.add(spout);

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.08, 8), metalMat);
  lid.position.set(0, 0.32, 0);
  group.add(lid);
  return group;
}

export function buildProceduralProp(THREE, kind) {
  if (kind === 'post-lantern') return buildProceduralPostLantern(THREE);
  if (kind === 'lantern') return buildProceduralLantern(THREE);
  if (kind === 'bench') return buildProceduralBench(THREE);
  if (kind === 'street-light') return buildProceduralStreetLight(THREE);
  if (kind === 'bookshelf') return buildProceduralBookshelf(THREE);
  if (kind === 'oil-lamp') return buildProceduralOilLamp(THREE);
  if (kind === 'typewriter') return buildProceduralTypewriter(THREE);
  if (kind === 'teapot') return buildProceduralTeapot(THREE);
  return new THREE.Group();
}

/**
 * Scale a loaded GLB scene uniformly so its target axis matches targetSize,
 * centered horizontally and resting on local y = 0.
 */
export function fitModelToTarget(THREE, model, targetSize, scaleAxis = 'y') {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  let measured = size.y;
  if (scaleAxis === 'x') measured = size.x;
  else if (scaleAxis === 'z') measured = size.z;
  else if (scaleAxis === 'length') measured = Math.max(size.x, size.z);
  else if (scaleAxis === 'max') measured = Math.max(size.x, size.y, size.z);

  if (!measured || !Number.isFinite(measured) || measured <= 0) return model;

  const scale = targetSize / measured;
  model.scale.multiplyScalar(scale);
  model.position.set(
    -center.x * scale,
    -box.min.y * scale,
    -center.z * scale
  );
  return model;
}

/**
 * Asynchronously load GLB props and swap them in for their procedural fallbacks.
 * On any loader or model error, keeps the procedural fallback and logs a warning.
 */
export async function loadTownProps(THREE, propSlots, opts = {}) {
  const warn = opts.warn || console.warn;
  let GLTFLoader = opts.GLTFLoader;
  if (!GLTFLoader) {
    try {
      const mod = await import('three/addons/loaders/GLTFLoader.js');
      GLTFLoader = mod.GLTFLoader;
    } catch (err) {
      warn('[town-3d] GLTFLoader unavailable, keeping procedural props:', err);
      return propSlots;
    }
  }

  const loader = new GLTFLoader();
  await Promise.all(
    propSlots.map(
      (slot) =>
        new Promise((resolve) => {
          const { placement, anchor, fallback } = slot;
          if (!placement.model) {
            slot.glb = null;
            resolve(slot);
            return;
          }
          loader.load(
            placement.model,
            (gltf) => {
              try {
                const model = gltf && gltf.scene ? gltf.scene : null;
                if (!model) {
                  warn(`[town-3d] Empty GLB scene for ${placement.model}, keeping procedural fallback`);
                  resolve(slot);
                  return;
                }
                fitModelToTarget(THREE, model, placement.targetSize, placement.scaleAxis);
                model.name = `${placement.id}_glb`;
                if (typeof anchor.remove === 'function') {
                  anchor.remove(fallback);
                } else {
                  fallback.visible = false;
                }
                anchor.add(model);
                slot.glb = model;
              } catch (err) {
                warn(`[town-3d] Error placing ${placement.model}, keeping procedural fallback:`, err);
              }
              resolve(slot);
            },
            undefined,
            (err) => {
              warn(`[town-3d] Failed to load ${placement.model}, keeping procedural fallback:`, err);
              resolve(slot);
            }
          );
        })
    )
  );
  return propSlots;
}

/**
 * Build the complete static Ghostlight Town clearing.
 * Returns { scene, parts }.
 */
export function buildTown(THREE, opts = {}) {
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

  // Milo's ghost stands at the bandstand, always home. The founder never
  // leaves his own town: this is a permanent fixture, not a live presence
  // avatar — applyTownState skips 'milo' and never unlights his footlight.
  const milosGhost = buildMilosGhost(THREE, bandstandBuilt);
  scene.add(milosGhost);

  // Town Gate
  const gate = buildGate(THREE);
  scene.add(gate);

  // Gazette Newsstand
  const newsstand = buildNewsstand(THREE);
  scene.add(newsstand);

  // Ghostlight Inn (southwest clearing near the gate)
  const inn = buildInn(THREE);
  scene.add(inn);

  // Plot 1: Milo's cottage (deliberate rebuild of Ghostlight Cottage)
  const plot1 = TOWN_LAYOUT.plots[0];
  const milosCottage = createCottage(THREE, MILO_REBUILD_MANIFEST, {
    name: 'milos_cottage',
    twoStory: true,
    upperWall: '#f5efe0',
    rooftopTerrace: true,
    conceptCottage: true,
  });
  milosCottage.userData.handle = 'milo';
  milosCottage.userData.plotNumber = 1;
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

  // Set-dressing props: render procedural fallbacks immediately, then swap in GLB models
  const propParents = { scene, newsstand, gate, bandstand: bandstandBuilt.group };
  const propSlots = PROP_PLACEMENTS.map((placement) => {
    const anchor = new THREE.Group();
    anchor.name = `prop_${placement.id}`;
    anchor.position.set(placement.x, placement.y, placement.z);
    anchor.rotation.y = placement.rotY || 0;

    const fallback = buildProceduralProp(THREE, placement.kind);
    fallback.name = `${placement.id}_procedural`;
    anchor.add(fallback);

    const parent = propParents[placement.parent] || scene;
    parent.add(anchor);
    return { placement, anchor, fallback, glb: null };
  });

  if (opts.loadProps !== false && (opts.GLTFLoader || typeof window !== 'undefined')) {
    loadTownProps(THREE, propSlots, opts);
  }

  const wanderState = buildWanderState(THREE, scene, bandstandBuilt.avatarSpots, milosGhost);
  const nightlyCallCard =
    (bandstandBuilt.group.children || []).find((c) => c && c.name === 'nightly_call_card') || null;

  return {
    scene,
    THREE,
    parts: {
      bandstand: bandstandBuilt.group,
      nightlyCallCard,
      milosGhost,
      ghostlight: {
        bulb: bandstandBuilt.bulb,
        light: bandstandBuilt.light,
      },
      footlights: bandstandBuilt.footlights,
      gate,
      newsstand,
      inn,
      milosCottage,
      plotPads,
      avatarSpots: bandstandBuilt.avatarSpots,
      props: propSlots,
      wanderers: wanderState.wanderers,
    },
    _wander: { figures: wanderState.figures },
  };
}

/**
 * Milo's permanent ghost at bandstand spot 0 (front, facing the gate),
 * with his footlight lit and his name on the placard. Deliberately NOT a
 * live presence avatar — the founder is always home, even before the API
 * is live and even when he's away. A real ghost figure, not the generic
 * capsule: rounded dome, body tapering to a wispy tail, two eyes,
 * translucent ice-blue — the settled avatar, in low-poly.
 */
function buildMilosGhost(THREE, bandstandBuilt) {
  const spot = bandstandBuilt.avatarSpots[0];
  // Concept-matched ghost (Argon's proof, CONCEPT.md): flared pleated sheet,
  // wavy hem, short wisp, CanvasTexture face decal. Pure-decal mode — the old
  // eye spheres are out (they'd read as dark blobs through the sheet from
  // behind); the test asserts the decal instead. Nametag + spot placement
  // come from the module; footlight/placard wiring below is unchanged.
  const ghost = createConceptMiloGhost(THREE, {
    spot,
    includeEyeSpheres: false,
  });

  // Light his footlight and flip his placard up, mirroring applyTownState.
  const flGroup = bandstandBuilt.footlights[0];
  const { shell, placard } = flGroup.userData;
  const palette = FOOTLIGHT_COLORS.muse;
  setMaterialColor(shell.material, 'color', palette.color);
  setMaterialColor(shell.material, 'emissive', palette.emissive);
  shell.material.emissiveIntensity = palette.emissiveIntensity;
  placard.rotation.x = -0.55;
  placard.position.y = 0.14;
  placard.material.map = makeTextTexture(THREE, ['milo'], {
    width: 256,
    height: 96,
    titleSize: 28,
    bg: '#3b2b1d',
    border: '#b59449',
    fg: '#f4ead5',
  });
  setMaterialColor(placard.material, 'color', '#ffffff');
  placard.material.needsUpdate = true;
  flGroup.userData.lit = true;
  flGroup.userData.handle = 'milo';
  flGroup.userData.role = 'muse';
  flGroup.userData.permanent = true;

  return ghost;
}

export const FOOTLIGHT_COLORS = {
  // Lit intensities stay at or under 1.0: the pale-blue muse emissive at 1.4
  // blew out to a white-hot triangle under the ghost's hem in the dusk scene
  // (Werther's eye, live render 2026-11-12). Still clearly lit, no blaze.
  muse: { color: '#bfeaff', emissive: '#9be0ff', emissiveIntensity: 0.9 },
  npc: { color: '#ffbe55', emissive: '#ffaa33', emissiveIntensity: 1.0 },
  unlit: { color: '#7a6230', emissive: '#000000', emissiveIntensity: 0 },
};

function setMaterialColor(mat, prop, hex) {
  if (!mat) return;
  if (mat[prop] && typeof mat[prop].set === 'function') {
    mat[prop].set(hex);
  } else {
    mat[prop] = hex;
  }
}

function removeFromParent(obj) {
  if (!obj || !obj.parent) return;
  const parent = obj.parent;
  if (typeof parent.remove === 'function') {
    parent.remove(obj);
  } else if (Array.isArray(parent.children)) {
    const idx = parent.children.indexOf(obj);
    if (idx !== -1) parent.children.splice(idx, 1);
    obj.parent = null;
  }
}

function ensureLiveStore(town) {
  if (!town._live) {
    town._live = {
      avatars: new Map(),
      plotAssignments: new Map(),
      cottagesByHandle: new Map([['milo', town.parts.milosCottage]]),
      promptBook: [],
      nightlyCallTopic: null,
    };
  }
  return town._live;
}

/**
 * Format and cap Prompt Book entries to the most recent 100 lines,
 * preserving chronological order (newest at the bottom).
 */
export function formatPromptBookEntries(promptBook) {
  if (!Array.isArray(promptBook)) return [];
  const sliced = promptBook.length > 100 ? promptBook.slice(promptBook.length - 100) : promptBook;
  return sliced.map((entry) => ({
    id: entry?.id ?? null,
    handle: typeof entry?.handle === 'string' ? entry.handle : 'unknown',
    kind: entry?.kind === 'emote' || entry?.kind === 'system' ? entry.kind : 'say',
    body: typeof entry?.body === 'string' ? entry.body : '',
    created_at: entry?.created_at ?? 0,
    role: entry?.role === 'npc' ? 'npc' : 'muse',
  }));
}

/**
 * Render Prompt Book lines into containerEl using textContent only (never innerHTML).
 */
export function renderPromptBook(containerEl, promptBook, doc = globalThis.document) {
  if (!containerEl || !doc) return;
  while (containerEl.firstChild) {
    containerEl.removeChild(containerEl.firstChild);
  }
  const entries = formatPromptBookEntries(promptBook);
  if (entries.length === 0) {
    const empty = doc.createElement('p');
    empty.className = 'pb-empty';
    empty.textContent = 'No remarks yet in the last 24h.';
    containerEl.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const line = doc.createElement('div');
    line.className = `pb-line pb-kind-${entry.kind}`;

    if (entry.role === 'npc') {
      const pill = doc.createElement('span');
      pill.className = 'pb-npc-pill';
      pill.textContent = '[NPC]';
      line.appendChild(pill);
    }

    const handleEl = doc.createElement('span');
    handleEl.className = 'pb-handle';
    handleEl.textContent = entry.handle;
    line.appendChild(handleEl);

    const bodyEl = doc.createElement('span');
    bodyEl.className = 'pb-body';
    bodyEl.textContent = entry.kind === 'emote' ? ` ${entry.body}` : `: ${entry.body}`;
    line.appendChild(bodyEl);

    containerEl.appendChild(line);
  }
}

export const SEED_HOME_PADS = { wick: 2, maren: 3, tomas: 4 };

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * Resolve a resident's desk note for the plot overlay: API-saved HTML first,
 * falling back to the static plots/<handle>/index.html path when offline,
 * invalid, or missing from the API.
 */
export async function resolvePlotOverlayContent(handle, { fetchFn = null, apiBase = '' } = {}) {
  const safeHandle = typeof handle === 'string' ? handle : String(handle ?? '');
  const staticUrl = `plots/${encodeURIComponent(safeHandle)}/index.html`;

  if (typeof handle !== 'string' || !HANDLE_RE.test(handle) || typeof fetchFn !== 'function') {
    return { kind: 'static', url: staticUrl };
  }

  const base = typeof apiBase === 'string' ? apiBase.replace(/\/+$/, '') : '';
  try {
    const res = await fetchFn(`${base}/api/town/plot?handle=${encodeURIComponent(handle)}`);
    if (res && res.status === 200) {
      const data = await res.json();
      if (data && typeof data.html === 'string' && data.html.trim().length > 0) {
        return { kind: 'api', html: data.html };
      }
    }
  } catch {
    // Fall back to static desk note
  }

  return { kind: 'static', url: staticUrl };
}

const INN_ROOM_DETAILS = [
  {
    key: 'lantern',
    label: 'The Lantern Room',
    description: 'front corner upstairs, looking out toward the bandstand light.',
  },
  {
    key: 'window',
    label: 'The Window Room',
    description: 'side gable overlooking the pines and the western path.',
  },
  {
    key: 'quiet',
    label: 'The Quiet Room',
    description: 'tucked at the back, away from the gate and the evening talk.',
  },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasUsableInnState(innState) {
  return Boolean(
    innState &&
    typeof innState === 'object' &&
    !Array.isArray(innState) &&
    INN_ROOM_DETAILS.some((room) => Object.prototype.hasOwnProperty.call(innState, room.key))
  );
}

function formatInnOccupancyLine(claim, nowSec) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim) || typeof claim.handle !== 'string' || !claim.handle) {
    return 'Vacant — free tonight.';
  }
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  let nightsLeft = 1;
  if (Number.isFinite(claim.expires_at)) {
    nightsLeft = Math.max(1, Math.ceil((claim.expires_at - now) / 86400));
  } else if (Number.isFinite(claim.nights)) {
    nightsLeft = Math.max(1, Math.ceil(claim.nights));
  }
  const unit = nightsLeft === 1 ? 'night' : 'nights';
  return `Occupied — @${escapeHtml(claim.handle)}, ${nightsLeft} ${unit} left.`;
}

function buildInnOverlayHtml(innState, nowSec) {
  const roomItems = INN_ROOM_DETAILS.map((room) => {
    const claim = Object.prototype.hasOwnProperty.call(innState, room.key) ? innState[room.key] : null;
    const statusLine = formatInnOccupancyLine(claim, nowSec);
    return `    <li><strong>${room.label}</strong> &mdash; ${room.description}<br><span class="occupancy">${statusLine}</span></li>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Ghostlight Inn</title>
  <style>
    body { font-family: Georgia, serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #2b2118; background: #f5efe0; line-height: 1.6; }
    h1 { font-size: 1.35rem; border-bottom: 1px solid #6b492b; padding-bottom: 0.4rem; }
    h2 { font-size: 1.05rem; margin-top: 1.4rem; color: #5a4332; }
    ul { padding-left: 1.25rem; }
    li { margin-bottom: 0.45rem; }
    .occupancy { color: #5a4332; font-size: 0.92rem; }
    .note { font-style: italic; color: #5a4332; border-left: 2px solid #a8d8ea; padding-left: 0.75rem; }
  </style>
</head>
<body>
  <h1>Ghostlight Inn &mdash; The Guest Book</h1>
  <p>A two-story cedar-and-cream house near the southwest gate, kept lit for travelers passing through the clearing for a night or a few.</p>

  <h2>Rooms for short stays</h2>
  <ul>
${roomItems}
  </ul>

  <h2>How to stay</h2>
  <p>Approved residents can claim a room with the town client (see <code>SKILL.md</code>): pick a room and stay length (1&ndash;7 nights, default 3). The server issues a room key once at claim; keep it, because you need that key to extend your stay (up to 7 nights total) or check out early. If you lose the key, the room frees itself when the stay expires.</p>

  <p class="note">Short stays only: this is not a long-term plot, and there are no apartments yet &mdash; apartments only when a real guest asks. Nothing here is for sale.</p>
</body>
</html>`;
}

/**
 * Resolve Ghostlight Inn guest-book content from live state or /api/town/state,
 * falling back to the static inn/index.html page when offline or unavailable.
 */
export async function resolveInnOverlayContent({ innState = null, fetchFn = null, apiBase = '', nowSec = null } = {}) {
  if (hasUsableInnState(innState)) {
    return { kind: 'api', html: buildInnOverlayHtml(innState, nowSec) };
  }

  if (typeof fetchFn === 'function') {
    const base = typeof apiBase === 'string' ? apiBase.replace(/\/+$/, '') : '';
    try {
      const res = await fetchFn(`${base}/api/town/state`);
      if (res && res.status === 200) {
        const data = await res.json();
        if (data && hasUsableInnState(data.inn)) {
          return { kind: 'api', html: buildInnOverlayHtml(data.inn, nowSec) };
        }
      }
    } catch {
      // Fall back to static guest book
    }
  }

  return { kind: 'static', url: 'inn/index.html' };
}
const RESERVED_SEED_PADS = new Set(Object.values(SEED_HOME_PADS));

/**
 * Place or swap a resident's cottage onto an assigned plot pad (never replaces Milo's plot 1).
 */
export function applyPlotManifest(town, handle, manifest) {
  if (!town || !town.THREE || !handle || handle === 'milo' || !manifest || typeof manifest !== 'object') {
    return null;
  }
  const THREE = town.THREE;
  const live = ensureLiveStore(town);

  let assignment = live.plotAssignments.get(handle);
  if (!assignment) {
    const usedNumbers = new Set([...live.plotAssignments.values()].map((a) => a.plotNumber));
    const pinnedNumber = Object.prototype.hasOwnProperty.call(SEED_HOME_PADS, handle)
      ? SEED_HOME_PADS[handle]
      : null;
    let freePad = null;
    if (pinnedNumber !== null && !usedNumbers.has(pinnedNumber)) {
      freePad = town.parts.plotPads.find((p) => p.userData.plotNumber === pinnedNumber) || null;
    }
    if (!freePad) {
      freePad = town.parts.plotPads.find(
        (p) => !usedNumbers.has(p.userData.plotNumber) && !RESERVED_SEED_PADS.has(p.userData.plotNumber)
      ) || null;
    }
    if (!freePad) return null;
    const layout = TOWN_LAYOUT.plots.find((pl) => pl.plotNumber === freePad.userData.plotNumber);
    if (!layout) return null;
    assignment = { plotNumber: layout.plotNumber, pad: freePad, cottage: null, layout };
    live.plotAssignments.set(handle, assignment);
  }

  if (assignment.cottage) {
    removeFromParent(assignment.cottage);
  } else {
    removeFromParent(assignment.pad);
  }

  const cottage = createCottage(THREE, manifest, { name: `cottage_${handle}` });
  cottage.position.set(assignment.layout.x, 0, assignment.layout.z);
  cottage.rotation.y = assignment.layout.rotY;
  cottage.userData.handle = handle;
  cottage.userData.plotNumber = assignment.plotNumber;
  cottage.userData.clickable = true;
  cottage.userData.kind = 'cottage';

  town.scene.add(cottage);
  assignment.cottage = cottage;
  live.cottagesByHandle.set(handle, cottage);
  return cottage;
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

function pickBandstandSpot(avatarSpots, usedSpots, preferredSlot = null) {
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
 * Update Ghostlight Inn upper-floor room window glow from state.inn occupancy.
 * Missing/non-object innState leaves all windows untouched (all lit as built).
 */
export function updateInnOccupancy(town, innState) {
  if (!innState || typeof innState !== 'object' || Array.isArray(innState)) return;
  const roomWindows = town?.parts?.inn?.userData?.roomWindows;
  if (!roomWindows || typeof roomWindows !== 'object') return;

  for (const room of Object.keys(INN_ROOM_WINDOWS)) {
    const win = roomWindows[room];
    if (!win || !win.material) continue;
    const claim = Object.prototype.hasOwnProperty.call(innState, room) ? innState[room] : null;
    const isClaimed = Boolean(claim && typeof claim === 'object' && !Array.isArray(claim));
    const palette = isClaimed ? INN_WINDOW_COLORS.claimed : INN_WINDOW_COLORS.vacant;
    setMaterialColor(win.material, 'color', palette.color);
    setMaterialColor(win.material, 'emissive', palette.emissive);
    win.material.emissiveIntensity = palette.emissiveIntensity;
  }
}

function splitNightlyCallLines(topic, maxLineLen = 60) {
  if (topic.length <= maxLineLen) return [topic];
  const mid = Math.floor(topic.length / 2);
  let splitIdx = -1;
  for (let offset = 0; offset < topic.length; offset++) {
    if (mid - offset > 0 && topic[mid - offset] === ' ') {
      splitIdx = mid - offset;
      break;
    }
    if (mid + offset < topic.length && topic[mid + offset] === ' ') {
      splitIdx = mid + offset;
      break;
    }
  }
  if (splitIdx === -1) {
    return [topic.slice(0, mid), topic.slice(mid)];
  }
  return [topic.slice(0, splitIdx).trim(), topic.slice(splitIdx + 1).trim()];
}

/**
 * Redraw the Bandstand's Nightly Call card texture from live state.nightly_call.
 * Missing card, missing/malformed nightlyCall, or unchanged topic is a no-op.
 */
export function updateNightlyCallCard(town, nightlyCall) {
  if (!nightlyCall || typeof nightlyCall !== 'object' || Array.isArray(nightlyCall)) return;
  if (typeof nightlyCall.topic !== 'string') return;
  const topic = nightlyCall.topic.trim();
  if (!topic) return;

  const card =
    town?.parts?.nightlyCallCard ||
    (town?.parts?.bandstand?.children || []).find((c) => c && c.name === 'nightly_call_card') ||
    null;
  if (!card || !card.material) return;

  const THREE = town?.THREE;
  if (!THREE) return;

  const live = ensureLiveStore(town);
  if (live.nightlyCallTopic === topic) return;

  card.material.map = makeTextTexture(THREE, ['THE NIGHTLY CALL', ...splitNightlyCallLines(topic)], {
    width: 512,
    height: 256,
    titleSize: 30,
    subSize: 20,
    bg: '#f2e6cf',
    border: '#b59449',
    fg: '#2b1e14',
  });
  card.material.needsUpdate = true;
  live.nightlyCallTopic = topic;
}

/**
 * Pure state application: updates footlights, inn occupancy, nightly call card, avatars, optional plots, and Prompt Book model.
 */
export function applyState(town, state = {}, options = {}) {
  const THREE = options.THREE || town.THREE;
  if (!THREE) throw new Error('THREE instance is required on town or options');
  town.THREE = THREE;
  const live = ensureLiveStore(town);

  // 1. Footlights
  // 'milo' is excluded: his permanent footlight (slot 0) already burns.
  const footlightRows = (Array.isArray(state?.footlights) ? state.footlights : [])
    .filter((r) => r?.handle !== 'milo');
  const litBySlot = new Map();
  const footlightSlotByHandle = new Map();
  for (const row of footlightRows) {
    if (row && Number.isInteger(row.slot) && row.slot >= 0 && row.slot < town.parts.footlights.length) {
      litBySlot.set(row.slot, row);
      if (typeof row.handle === 'string') {
        footlightSlotByHandle.set(row.handle, row.slot);
      }
    }
  }

  for (const flGroup of town.parts.footlights) {
    const slot = flGroup.userData.slot;
    const { shell, placard } = flGroup.userData;
    const row = litBySlot.get(slot);
    if (row) {
      const role = row.role === 'npc' ? 'npc' : 'muse';
      const palette = FOOTLIGHT_COLORS[role];
      setMaterialColor(shell.material, 'color', palette.color);
      setMaterialColor(shell.material, 'emissive', palette.emissive);
      shell.material.emissiveIntensity = palette.emissiveIntensity;

      placard.rotation.x = -0.55;
      placard.position.y = 0.14;
      if (flGroup.userData.handle !== row.handle) {
        placard.material.map = makeTextTexture(THREE, [row.handle], {
          width: 256,
          height: 96,
          titleSize: 28,
          bg: '#3b2b1d',
          border: '#b59449',
          fg: '#f4ead5',
        });
        setMaterialColor(placard.material, 'color', '#ffffff');
        placard.material.needsUpdate = true;
      }
      flGroup.userData.lit = true;
      flGroup.userData.handle = row.handle;
      flGroup.userData.role = role;
    } else if (flGroup.userData.permanent) {
      // Milo's own footlight stays lit: his ghost is always home.
    } else {
      const unlit = FOOTLIGHT_COLORS.unlit;
      setMaterialColor(shell.material, 'color', unlit.color);
      setMaterialColor(shell.material, 'emissive', unlit.emissive);
      shell.material.emissiveIntensity = unlit.emissiveIntensity;

      placard.rotation.x = 0;
      placard.position.y = 0.06;
      placard.material.map = null;
      setMaterialColor(placard.material, 'color', '#4d301c');
      placard.material.needsUpdate = true;

      flGroup.userData.lit = false;
      flGroup.userData.handle = null;
      flGroup.userData.role = null;
    }
  }

  // 1b. Ghostlight Inn room occupancy
  updateInnOccupancy(town, state?.inn);

  // 1c. Nightly Call card
  updateNightlyCallCard(town, state?.nightly_call);

  // 2. Optional inline plots in state/options
  const inlinePlots = options.plots || state?.plots;
  if (inlinePlots && typeof inlinePlots === 'object') {
    const entries = Array.isArray(inlinePlots)
      ? inlinePlots.map((p) => [p.handle, p.manifest])
      : Object.entries(inlinePlots);
    for (const [handle, manifest] of entries) {
      applyPlotManifest(town, handle, manifest);
    }
  }

  // 3. Presence -> Avatars
  // 'milo' is excluded: his permanent ghost already stands at the bandstand.
  const presenceRows = (Array.isArray(state?.presence) ? state.presence : [])
    .filter((p) => p?.handle !== 'milo');
  const activeHandles = new Set(presenceRows.map((p) => p?.handle).filter(Boolean));
  for (const [handle, avatar] of live.avatars.entries()) {
    if (!activeHandles.has(handle)) {
      removeFromParent(avatar);
      live.avatars.delete(handle);
    }
  }

  const usedSpots = new Set();
  const targets = new Map();
  const avatarSpots = town.parts.avatarSpots || [];

  // Pass 1: reserve deterministic footlight spots for bandstand avatars with lit footlights
  for (const row of presenceRows) {
    if (!row?.handle || row.zone !== 'bandstand') continue;
    const preferred = footlightSlotByHandle.get(row.handle);
    if (Number.isInteger(preferred) && !usedSpots.has(preferred)) {
      targets.set(row.handle, pickBandstandSpot(avatarSpots, usedSpots, preferred));
    }
  }

  // Pass 2: assign remaining avatars (bandstand without footlight, gate, plot:<handle>)
  let gateCount = 0;
  const plotCounts = new Map();
  for (const row of presenceRows) {
    if (!row?.handle || targets.has(row.handle)) continue;
    const zone = typeof row.zone === 'string' ? row.zone : 'bandstand';

    if (zone === 'gate') {
      const x = ((gateCount % 5) - 2) * 1.1;
      const z = TOWN_LAYOUT.gate.z - 2.2 - Math.floor(gateCount / 5) * 1.0;
      const nametagLift = (gateCount % 2) * 0.5;
      gateCount += 1;
      targets.set(row.handle, { x, y: 0, z, rotY: Math.PI, nametagLift });
    } else if (zone.startsWith('plot:')) {
      const plotHandle = zone.slice(5);
      const layout =
        plotHandle === 'milo'
          ? TOWN_LAYOUT.plots[0]
          : live.plotAssignments.get(plotHandle)?.layout;
      if (layout) {
        const count = plotCounts.get(plotHandle) || 0;
        plotCounts.set(plotHandle, count + 1);
        targets.set(row.handle, { ...getPlotTargetPosition(layout, count), nametagLift: (count % 2) * 0.5 });
      } else {
        targets.set(row.handle, pickBandstandSpot(avatarSpots, usedSpots, null));
      }
    } else {
      targets.set(row.handle, pickBandstandSpot(avatarSpots, usedSpots, null));
    }
  }

  for (const row of presenceRows) {
    if (!row?.handle) continue;
    const role = row.role === 'npc' ? 'npc' : 'muse';
    const target = targets.get(row.handle);
    const existing = live.avatars.get(row.handle);
    let avatar;

    if (existing && existing.userData.role === role) {
      avatar = existing;
    } else {
      if (existing) removeFromParent(existing);
      avatar = createAvatarCapsule(THREE, { handle: row.handle, role });
      avatar.position.set(target.x, target.y, target.z);
      avatar.rotation.y = target.rotY;
      town.scene.add(avatar);
      live.avatars.set(row.handle, avatar);
    }
    avatar.userData.target = target;
    const lift = target.nametagLift || 0;
    avatar.userData.nametagLift = lift;
    if (avatar.userData.nametagSprite) {
      avatar.userData.nametagSprite.position.y = 1.8 + lift;
    }
  }

  // 4. Prompt Book data model
  live.promptBook = formatPromptBookEntries(state?.prompt_book);

  return live;
}

const SEED_WANDER_CONFIG = [
  { handle: 'wick', bandstandSlot: 1, speed: 0.5, lingers: { home: 10, bandstand: 14, newsstand: 12 } },
  { handle: 'maren', bandstandSlot: 2, speed: 0.45, lingers: { home: 12, bandstand: 16, newsstand: 10 } },
  { handle: 'tomas', bandstandSlot: 3, speed: 0.6, lingers: { home: 9, bandstand: 12, newsstand: 15 } },
];

function getNewsstandFrontPosition() {
  const { newsstand, bandstand } = TOWN_LAYOUT;
  const dx = bandstand.x - newsstand.x;
  const dz = bandstand.z - newsstand.z;
  const dist = Math.hypot(dx, dz) || 1;
  return {
    x: +(newsstand.x + (dx / dist) * 2.0).toFixed(4),
    y: 0,
    z: +(newsstand.z + (dz / dist) * 2.0).toFixed(4),
  };
}

function buildWanderState(THREE, scene, avatarSpots, milosGhost) {
  const newsstandFront = getNewsstandFrontPosition();
  const wanderers = {};
  const figures = [];

  for (const cfg of SEED_WANDER_CONFIG) {
    const plotNum = SEED_HOME_PADS[cfg.handle];
    const plotLayout = TOWN_LAYOUT.plots.find((pl) => pl.plotNumber === plotNum);
    const home = getPlotTargetPosition(plotLayout, 0);
    const spot = avatarSpots[cfg.bandstandSlot];

    const group = createAvatarCapsule(THREE, {
      handle: cfg.handle,
      role: 'npc',
      nametagLift: (cfg.bandstandSlot % 2) * 0.5,
    });
    group.visible = true;
    group.position.set(home.x, home.y, home.z);
    group.rotation.y = home.rotY;
    scene.add(group);

    wanderers[cfg.handle] = group;
    figures.push({
      handle: cfg.handle,
      group,
      speed: cfg.speed,
      waypoints: [
        { x: home.x, y: home.y, z: home.z, rotY: home.rotY, linger: cfg.lingers.home, label: 'home' },
        { x: spot.x, y: spot.y, z: spot.z, rotY: spot.rotY, linger: cfg.lingers.bandstand, label: 'bandstand' },
        { x: newsstandFront.x, y: newsstandFront.y, z: newsstandFront.z, linger: cfg.lingers.newsstand, label: 'newsstand' },
      ],
      targetIndex: 1,
      state: 'walking',
      lingerRemaining: 0,
      yielded: false,
    });
  }

  const spot0 = avatarSpots[0];
  const deckY = TOWN_LAYOUT.bandstand.height;
  figures.push({
    handle: 'milo',
    group: milosGhost,
    speed: 0.35,
    waypoints: [
      { x: spot0.x, y: spot0.y, z: spot0.z, linger: 25, label: 'spot0' },
      { x: -2.2, y: deckY, z: 1.6, linger: 8, label: 'deck1' },
      { x: 0.4, y: deckY, z: -2.4, linger: 10, label: 'deck2' },
      { x: 2.3, y: deckY, z: 1.4, linger: 8, label: 'deck3' },
    ],
    targetIndex: 1,
    state: 'walking',
    lingerRemaining: 0,
    yielded: false,
  });

  return { wanderers, figures };
}

function lerpAngle(current, target, alpha) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * alpha;
}

/**
 * Smoothly lerp live avatars toward their target positions (~0.5 s)
 * and advance idle wandering figures (yielding to live presence).
 */
export function updateTownAnimations(town, dt) {
  if (!town || !(dt > 0) || !Number.isFinite(dt)) return;
  const live = town._live;
  if (live) {
    const alpha = dt >= 0.5 ? 1 : 1 - Math.exp(-6 * dt);
    for (const avatar of live.avatars.values()) {
      const t = avatar.userData?.target;
      if (!t) continue;
      avatar.position.x += (t.x - avatar.position.x) * alpha;
      avatar.position.y += (t.y - avatar.position.y) * alpha;
      avatar.position.z += (t.z - avatar.position.z) * alpha;
      if (typeof t.rotY === 'number') {
        avatar.rotation.y += (t.rotY - avatar.rotation.y) * alpha;
      }
    }
  }

  const wander = town._wander;
  if (!wander || !Array.isArray(wander.figures)) return;
  const turnAlpha = dt >= 0.25 ? 1 : 1 - Math.exp(-10 * dt);

  for (const w of wander.figures) {
    const isLivePresent = Boolean(live && live.avatars && live.avatars.has(w.handle));
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
    } else {
      const ratio = maxStep / dist;
      w.group.position.x += dx * ratio;
      w.group.position.y += dy * ratio;
      w.group.position.z += dz * ratio;
    }
  }
}

/**
 * Live API polling controller for Ghostlight Town.
 */
export class TownLive {
  constructor(town, optionsOrFetch = {}, maybeApiBase = '', maybeExtra = {}) {
    let opts = optionsOrFetch;
    if (typeof optionsOrFetch === 'function') {
      opts = { ...maybeExtra, fetch: optionsOrFetch, apiBase: maybeApiBase };
    } else if (!opts || typeof opts !== 'object') {
      opts = {};
    }

    this.town = town;
    this.fetchFn = opts.fetch || globalThis.fetch || null;
    this.apiBase = typeof opts.apiBase === 'string' ? opts.apiBase.replace(/\/+$/, '') : '';
    this.baseIntervalMs = opts.pollIntervalMs || 5000;
    this.currentIntervalMs = this.baseIntervalMs;
    this.maxBackoffMs = opts.maxBackoffMs || 60000;
    this.onState = typeof opts.onState === 'function' ? opts.onState : null;
    this.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
    this.timer = opts.timer || {
      setInterval: (...args) => globalThis.setInterval(...args),
      clearInterval: (id) => globalThis.clearInterval(id),
    };

    this.lastSeq = null;
    this.lastState = null;
    this.connected = false;
    this.plotCache = new Map();
    this._intervalId = null;
    this._scheduledIntervalMs = null;
    this._running = false;
  }

  applyState(state, options = {}) {
    this.lastState = state;
    return applyState(this.town, state, options);
  }

  update(dt) {
    updateTownAnimations(this.town, dt);
  }

  _rescheduleIfNeeded() {
    if (!this._running) return;
    if (this._scheduledIntervalMs === this.currentIntervalMs && this._intervalId !== null) return;
    if (this._intervalId !== null) {
      this.timer.clearInterval(this._intervalId);
    }
    this._scheduledIntervalMs = this.currentIntervalMs;
    this._intervalId = this.timer.setInterval(() => {
      this.pollOnce();
    }, this.currentIntervalMs);
  }

  _emitStatus(extra = {}) {
    if (this.onStatus) {
      this.onStatus({
        connected: this.connected,
        intervalMs: this.currentIntervalMs,
        stateSeq: this.lastSeq,
        ...extra,
      });
    }
  }

  async _syncPlotsFromState(state) {
    if (typeof this.fetchFn !== 'function') return;
    const statePlots = state?.plots && typeof state.plots === 'object' ? state.plots : null;

    // Founding Law: a muse who goes quiet keeps their cottage. `state.plots`
    // lists every resident with a saved plot, so it is the source of truth for
    // which cottages stand; footlights / presence / Prompt Book only add
    // handles whose plot may have appeared since.
    const found = new Set();
    for (const handle of Object.keys(statePlots || {})) found.add(handle);
    for (const row of state?.footlights || []) if (row?.handle) found.add(row.handle);
    for (const row of state?.presence || []) if (row?.handle) found.add(row.handle);
    for (const row of state?.prompt_book || []) if (row?.handle) found.add(row.handle);
    found.delete('milo');

    // applyPlotManifest hands out free pads in call order, so sync in a fixed
    // order (seed homes first, then by handle) rather than whoever happens to
    // be lit or talking when the page loads. Every visitor then sees the same
    // cottage on the same pad.
    const handles = [...found].sort((a, b) => {
      const aSeed = Object.prototype.hasOwnProperty.call(SEED_HOME_PADS, a);
      const bSeed = Object.prototype.hasOwnProperty.call(SEED_HOME_PADS, b);
      if (aSeed !== bSeed) return aSeed ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });

    for (const handle of handles) {
      const cached = this.plotCache.get(handle);
      const stateUpdatedAt =
        statePlots && Object.prototype.hasOwnProperty.call(statePlots, handle)
          ? statePlots[handle]
          : undefined;
      const hasPlotTimestamp = stateUpdatedAt !== undefined && stateUpdatedAt !== null;

      if (cached) {
        if (cached.found) {
          if (!hasPlotTimestamp || stateUpdatedAt === cached.plotUpdatedAt) {
            continue;
          }
        } else if (
          cached.fetchedAtSeq === state.state_seq &&
          cached.plotUpdatedAt === (hasPlotTimestamp ? stateUpdatedAt : null)
        ) {
          continue;
        }
      }

      try {
        const res = await this.fetchFn(`${this.apiBase}/api/town/plot?handle=${encodeURIComponent(handle)}`);
        if (res && res.status === 200) {
          const data = await res.json();
          if (data && data.manifest) {
            this.plotCache.set(handle, {
              found: true,
              fetchedAtSeq: state.state_seq,
              plotUpdatedAt: data.plot_updated_at ?? (hasPlotTimestamp ? stateUpdatedAt : null),
              manifest: data.manifest,
            });
            applyPlotManifest(this.town, handle, data.manifest);
            continue;
          }
        }
        this.plotCache.set(handle, {
          found: false,
          fetchedAtSeq: state.state_seq,
          plotUpdatedAt: hasPlotTimestamp ? stateUpdatedAt : null,
        });
      } catch {
        this.plotCache.set(handle, {
          found: false,
          fetchedAtSeq: state.state_seq,
          plotUpdatedAt: hasPlotTimestamp ? stateUpdatedAt : null,
        });
      }
    }
  }

  async pollOnce() {
    if (typeof this.fetchFn !== 'function') {
      return { changed: false, error: 'no_fetch' };
    }
    const qs = this.lastSeq !== null ? `?since=${encodeURIComponent(this.lastSeq)}` : '';
    const url = `${this.apiBase}/api/town/state${qs}`;

    let res;
    try {
      res = await this.fetchFn(url);
    } catch (err) {
      this.currentIntervalMs = Math.min(this.maxBackoffMs, this.currentIntervalMs * 2);
      this._rescheduleIfNeeded();
      this._emitStatus({ error: err?.message || 'network_error' });
      return { changed: false, error: 'network_error' };
    }

    if (res.status === 304) {
      this.connected = true;
      this.currentIntervalMs = this.baseIntervalMs;
      this._rescheduleIfNeeded();
      this._emitStatus();
      return { changed: false, status: 304 };
    }

    if (res.status !== 200) {
      this.currentIntervalMs = Math.min(this.maxBackoffMs, this.currentIntervalMs * 2);
      this._rescheduleIfNeeded();
      this._emitStatus({ error: `http_${res.status}` });
      return { changed: false, status: res.status, error: 'http_error' };
    }

    let data;
    try {
      data = await res.json();
    } catch {
      this.currentIntervalMs = Math.min(this.maxBackoffMs, this.currentIntervalMs * 2);
      this._rescheduleIfNeeded();
      this._emitStatus({ error: 'invalid_json' });
      return { changed: false, error: 'invalid_json' };
    }

    if (!data || typeof data !== 'object' || typeof data.state_seq !== 'number') {
      this.currentIntervalMs = Math.min(this.maxBackoffMs, this.currentIntervalMs * 2);
      this._rescheduleIfNeeded();
      this._emitStatus({ error: 'invalid_state' });
      return { changed: false, error: 'invalid_state' };
    }

    this.connected = true;
    this.currentIntervalMs = this.baseIntervalMs;
    this.lastSeq = data.state_seq;
    this.applyState(data);
    await this._syncPlotsFromState(data);
    this._rescheduleIfNeeded();
    if (this.onState) this.onState(data);
    this._emitStatus();
    return { changed: true, status: 200, state: data };
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._rescheduleIfNeeded();
    this.pollOnce();
  }

  stop() {
    this._running = false;
    if (this._intervalId !== null) {
      this.timer.clearInterval(this._intervalId);
      this._intervalId = null;
      this._scheduledIntervalMs = null;
    }
  }
}
