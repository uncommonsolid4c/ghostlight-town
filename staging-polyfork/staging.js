// Ghostlight Town — Polyfork staging trial (read-only live state layer: polling + footlights + Prompt Book).
// Bandstand, Milo's cottage, and Milo's blue ghost ported from town-3d/ onto
// the Polyfork ground + Medieval Village buildings. Never deployed to live.
//
// Composition: Campground & Lake terrain (span 2, 128 m) + procedural Bandstand,
// Milo's cottage + blue ghost + Medieval Village buildings, recolored to the
// town palette + Village Tavern as the Inn + humanoid stand-ins for Wick,
// Maren and Tomas. Pines from Nature & Forest.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildKit } from './kit-campground/kit.mjs';
import stage from './kit-campground/stage.mjs';
import * as Cottage from './kit-medieval/cottage-small.mjs';
import * as Tavern from './kit-medieval/tavern.mjs';
import * as Gatehouse from './kit-medieval/gatehouse.mjs';
import * as Well from './kit-medieval/well.mjs';
import * as LampPost from './kit-medieval/lamp-post.mjs';
import * as Windmill from './kit-medieval/windmill.mjs';
import * as Villager from './kit-medieval/villager.mjs';
import * as Tradesman from './kit-medieval/tradesman.mjs';
import { createAsset as tallPine } from './parts/tall-pine-tree-ab4108.mjs';
import { createAsset as youngPine } from './parts/young-pine-0d7695.mjs';
import { buildConceptBandstand, lightFootlightSlot } from './concept-bandstand.js';
import { createConceptMilosCottage } from './concept-cottage.js';
import { createConceptMiloGhost } from './concept-ghost.js';
import { renderPromptBook } from './prompt-book.mjs';

// CONCEPT.md palette.
const ICE = '#a8d8ea';    // ice blue — cottage plaster
const CREAM = '#f5efe0';  // cream — inn plaster, gatehouse plaster
const ROOF = '#5a4332';   // roof brown — thatch, tile, shingle
const CEDAR = '#6b492b';  // cedar — timber, Wick's apron

const TERRAIN_PARAMS = {
  span: 2, clearing: 30, flatten: 0.5, lake: 0.3,
  colorway: 'golden-evening', edges: 'island',
  // Level pads under each building. The kit's baked camp pads (tent pitches
  // at assorted heights, y 3.4–8, with 3 m blend ramps) stamped steps and
  // ramps across the clearing, so the tavern sat half-buried and the
  // cottages half-floated (Werther, 2026-11-13). Passing pads here REPLACES
  // the baked array (buildKit merges terrainParams over the kit row); the
  // terrain's own auto pitches survive — they are generated inside, before
  // o.pads, and our pads come last so they win any overlap.
  // World coords: worldX = sceneX - 192, worldZ = sceneZ + 384
  // (cx -4, cz 5, CHUNK 64, mid 64). No y: each pad levels itself from the
  // flattened height at its centre, snapped to 0.25 m.
  pads: [
    { x: -203, z: 404, w: 17, d: 15 }, // tavern / Inn (-11, 20)
    { x: -177, z: 376, w: 8, d: 8 },   // cottage (15, -8)
    { x: -208, z: 375, w: 8, d: 8 },   // cottage (-16, -9)
    { x: -174.08, z: 388.6, w: 10, d: 9 }, // Milo's cottage (17.92, 4.60)
    { x: -192, z: 411, w: 11, d: 10 }, // gatehouse (0, 27)
    { x: -186, z: 392, w: 4, d: 4 },   // well (6, 8)
    { x: -214, z: 364, w: 8, d: 8 },   // windmill (-22, -20)
    { x: -192, z: 384, w: 8, d: 8 },   // bandstand spot (0, 0) — for slice 61
  ],
};

const statusEl = document.getElementById('status');
function status(msg, isError = false) {
  console.log('[staging]', msg);
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

// Deterministic PRNG (no Math.random — town convention).
let seed = 20261113;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// Every Polyfork asset faces +Z by default; this turns it toward the centre.
const faceCenter = (x, z) => Math.atan2(-x, -z);

const counts = { bandstand: 0, ghost: 0, buildings: 0, pines: 0, lamps: 0, npcs: 0 };

// --- renderer / scene / camera ---------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 26, 58);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 4;
controls.maxDistance = 160;
controls.maxPolarAngle = 1.45; // stay above the ground
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// WASD / arrow keys pan the orbit target across the ground.
const keys = new Set();
window.addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); });
window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); });
function walkView(dt) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const move = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) move.add(fwd);
  if (keys.has('s') || keys.has('arrowdown')) move.sub(fwd);
  if (keys.has('d') || keys.has('arrowright')) move.add(right);
  if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
  if (move.lengthSq() === 0) return;
  move.normalize().multiplyScalar(14 * dt);
  controls.target.add(move);
  camera.position.add(move);
}

// --- placement helpers ------------------------------------------------------
let camp = null;   // the campground place (terrain + scatter)
let look = null;   // the stage lighting controller
let sails = null;  // windmill sails group, turned in the render loop

// Light a hand-placed part through the campground place. Each module's `night`
// export names the zones that glow; `from` is the zone's built albedo, `to`
// the night colour. The place's night controller then drives the glow with
// the rest of the scene (kit-level night pairs are empty in folder mode, so
// explicit pairs are required).
function lightUp(mod, obj, params) {
  const pairs = [];
  for (const [zone, n] of Object.entries(mod.night || {})) {
    const from = params[zone] ?? mod.params?.[zone]?.default;
    if (from == null) continue;
    pairs.push({ from, to: n.color, intensity: n.intensity ?? 1 });
  }
  if (pairs.length) camp.light(obj, pairs);
}

// Build a part, stand it on the terrain at (x, z), face the centre, light it.
function place(mod, params, x, z, opts = {}) {
  const obj = mod.createAsset(params);
  obj.position.set(x, camp.groundAt(x, z), z);
  obj.rotation.y = opts.rotY ?? faceCenter(x, z);
  if (opts.scale) obj.scale.setScalar(opts.scale);
  scene.add(obj);
  if (opts.remove) {
    const g = obj.getObjectByName(opts.remove);
    if (g) obj.remove(g);
  }
  lightUp(mod, obj, params);
  return obj;
}

// Minimal staging-local signpost for Milo's cottage (mirrors town.js proportions).
function buildStagingSignpost(text) {
  const group = new THREE.Group();
  group.name = 'cottage_signpost';

  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 1.1, 0.12),
    new THREE.MeshStandardMaterial({ color: '#5c4028', roughness: 0.9 })
  );
  post.position.set(0, 0.55, 0);
  group.add(post);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3b2b1d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#7d5a3c';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  ctx.fillStyle = '#f4ead5';
  ctx.font = 'bold 26px "Courier New", Courier, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const parts = String(text).split(' — ');
  if (parts.length === 2) {
    ctx.fillText(`${parts[0]} —`, canvas.width / 2, 58);
    ctx.fillText(parts[1], canvas.width / 2, 104);
  } else {
    ctx.fillText(String(text), canvas.width / 2, 80);
  }

  const boardTex = new THREE.CanvasTexture(canvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.5, 0.08),
    new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.85 })
  );
  board.position.set(0, 1.05, 0.04);
  group.add(board);

  return group;
}

// --- live state layer (read-only: footlights + Prompt Book) -----------------
function applyStagingState(bandstandBuilt, state = {}, promptBookLinesEl = null) {
  const footlights = bandstandBuilt?.footlights || [];
  // Slot 0 / 'milo' is permanent and must never be lit, unlit, or relabeled from state.
  const footlightRows = (Array.isArray(state?.footlights) ? state.footlights : [])
    .filter((r) => r?.handle !== 'milo');
  const litBySlot = new Map();
  for (const row of footlightRows) {
    if (row && Number.isInteger(row.slot) && row.slot >= 1 && row.slot < footlights.length) {
      litBySlot.set(row.slot, row);
    }
  }

  for (const flGroup of footlights) {
    const slot = flGroup.userData?.slot;
    if (slot === 0 || flGroup.userData?.permanent) continue;
    const row = litBySlot.get(slot);
    if (row) {
      const role = row.role === 'npc' ? 'npc' : 'muse';
      const handle = typeof row.handle === 'string' ? row.handle : '';
      if (!flGroup.userData.lit || flGroup.userData.handle !== handle || flGroup.userData.role !== role) {
        lightFootlightSlot(THREE, flGroup, { handle, role });
      }
    } else {
      const { shell, placard } = flGroup.userData;
      shell.material.color.set('#7a6230');
      shell.material.emissive.set('#000000');
      shell.material.emissiveIntensity = 0;

      placard.rotation.x = 0;
      placard.position.y = 0.06;
      placard.material.map = null;
      placard.material.color.set('#4d301c');
      placard.material.needsUpdate = true;

      flGroup.userData.lit = false;
      flGroup.userData.handle = null;
      flGroup.userData.role = null;
    }
  }

  if (promptBookLinesEl) {
    renderPromptBook(promptBookLinesEl, state?.prompt_book, document);
    promptBookLinesEl.scrollTop = promptBookLinesEl.scrollHeight;
  }
}

class StagingLive {
  constructor({ onState = null, onStatus = null, pollIntervalMs = 5000, maxBackoffMs = 60000 } = {}) {
    this.baseIntervalMs = pollIntervalMs;
    this.currentIntervalMs = this.baseIntervalMs;
    this.maxBackoffMs = maxBackoffMs;
    this.onState = typeof onState === 'function' ? onState : null;
    this.onStatus = typeof onStatus === 'function' ? onStatus : null;
    this.lastSeq = null;
    this.connected = false;
    this._intervalId = null;
    this._scheduledIntervalMs = null;
    this._running = false;
  }

  _rescheduleIfNeeded() {
    if (!this._running) return;
    if (this._scheduledIntervalMs === this.currentIntervalMs && this._intervalId !== null) return;
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
    }
    this._scheduledIntervalMs = this.currentIntervalMs;
    this._intervalId = setInterval(() => {
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

  _backoff(error) {
    this.connected = false;
    this.currentIntervalMs = Math.min(this.maxBackoffMs, this.currentIntervalMs * 2);
    this._rescheduleIfNeeded();
    this._emitStatus({ error });
  }

  async pollOnce() {
    const qs = this.lastSeq !== null ? `?since=${encodeURIComponent(this.lastSeq)}` : '';

    let res;
    try {
      res = await fetch(`/api/town/state${qs}`);
    } catch (err) {
      this._backoff(err?.message || 'network_error');
      return;
    }

    if (res.status === 304) {
      this.connected = true;
      this.currentIntervalMs = this.baseIntervalMs;
      this._rescheduleIfNeeded();
      this._emitStatus();
      return;
    }

    if (res.status !== 200) {
      this._backoff(`HTTP ${res.status}`);
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      this._backoff('invalid_json');
      return;
    }

    if (!data || typeof data !== 'object' || typeof data.state_seq !== 'number') {
      this._backoff('invalid_state');
      return;
    }

    this.connected = true;
    this.currentIntervalMs = this.baseIntervalMs;
    this.lastSeq = data.state_seq;
    if (this.onState) this.onState(data);
    this._rescheduleIfNeeded();
    this._emitStatus();
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
      clearInterval(this._intervalId);
      this._intervalId = null;
      this._scheduledIntervalMs = null;
    }
  }
}

// --- build ------------------------------------------------------------------
async function init() {
  status('Lighting the night…');
  look = stage(renderer, scene, { time: 'night', shadowSpan: 120 });

  status('Growing the ground — campground terrain, span 2 (128 m)…');
  camp = await buildKit({
    folder: './kit-campground/',
    setting: 0.4,
    // The campfire is in the scatter pool and CONCEPT.md forbids it; the
    // swing tree reads wrong in a town centre. Both are skipped.
    skip: ['stone-ring-campfire', 'lakeside-swing-tree'],
    // The four water-scatter keys stay UNMERGED so the prune below can
    // remove the off-island ones individually: buildKit merges everything
    // else into one 'scenery' mesh, and a merged piece can't be pruned
    // (the first prune attempt removed the originals, not the visible mesh).
    keep: ['reed-bed', 'exposed-tree-roots', 'lily-pads', 'lake-pebbles'],
    terrainParams: TERRAIN_PARAMS,
  });
  scene.add(camp.group);
  // buildKit has no counts object; placed.length is the scatter count.
  status(`Ground done — ${camp.placed.length} scatter pieces placed` +
    (camp.missing.length ? `, ${camp.missing.length} missing (tolerated in folder mode).` : '.'));

  // Prune water floaters (Werther, 2026-11-13): the kit's own scatter puts
  // reed beds, roots, lily pads and pebbles in the open sea beyond the
  // island edge, where no view reaches. Anything off the island goes; the
  // on-shore and in-lake ones stay. Saves objects as well as looking right.
  // Works because the four keys are in buildKit's `keep` above — merged
  // scenery can't be pruned per piece.
  const FLOATER_KEYS = ['reed-bed', 'exposed-tree-roots', 'lily-pads', 'lake-pebbles'];
  let pruned = 0;
  for (const p of camp.placed) {
    if (!FLOATER_KEYS.includes(p.key)) continue;
    const { x, z } = p.object.position;
    if (camp.groundAt(x, z) <= camp.groundY + 0.01) {
      p.object.removeFromParent();
      pruned++;
    }
  }
  if (pruned) console.log(`[staging] pruned ${pruned} off-island scatter pieces`);

  status('Raising the bandstand and buildings…');

  // The Ghostlight Bandstand at the clearing centre (0, 0), with stage props
  // and Milo's permanent footlight pre-lit at slot 0.
  const bandstandBuilt = buildConceptBandstand(THREE, {
    includeStageProps: true,
    lightMiloFootlight: true,
  });
  bandstandBuilt.group.position.set(0, camp.groundAt(0, 0), 0);
  scene.add(bandstandBuilt.group);
  counts.bandstand = 1;

  // Milo's blue ghost at bandstand avatar spot 0 (deck height 0.6, rim z = 4.5),
  // added as a child of the bandstand group so world y = groundAt(0, 0) + 0.6.
  const ghost = createConceptMiloGhost(THREE, {
    spot: bandstandBuilt.avatarSpots[0],
    includeEyeSpheres: false,
  });
  bandstandBuilt.group.add(ghost);
  counts.ghost = 1;

  // The Ghostlight Inn (Village Tavern), width 10, at the Inn's spot.
  // The hanging sign bears a painted mug — a shop visual — so it comes off.
  place(Tavern, { width: 10, plaster: CREAM, tile: ROOF, timber: CEDAR }, -11, 20, { remove: 'sign' });
  counts.buildings++;

  // Two thatched cottages, ice-blue plaster, roof-brown thatch.
  place(Cottage, { plaster: ICE, thatch: ROOF, timber: CEDAR, chimney: false }, 15, -8);
  place(Cottage, { plaster: ICE, thatch: ROOF, timber: CEDAR, chimney: false, ridgeSag: 0.8, roofBulk: 1.1 }, -16, -9);
  counts.buildings += 2;

  // Plot 1: Milo's cottage (procedural concept shell + staging-local signpost),
  // replacing the third thatched cottage at live plot-1 coordinates (17.92, 4.60).
  const MILO_PLOT = { x: 17.92, z: 4.60 };
  const milosCottage = createConceptMilosCottage(THREE, {
    name: 'milos_cottage',
    label: 'Milo — Ghostlight Cottage (rebuilt)',
  });
  const sign = buildStagingSignpost('Milo — Ghostlight Cottage (rebuilt)');
  sign.position.set(2.3, 0, 2.6);
  milosCottage.add(sign);
  milosCottage.position.set(MILO_PLOT.x, camp.groundAt(MILO_PLOT.x, MILO_PLOT.z), MILO_PLOT.z);
  milosCottage.rotation.y = faceCenter(MILO_PLOT.x, MILO_PLOT.z);
  scene.add(milosCottage);
  counts.buildings++;

  // Village Gatehouse, gates wide open, roof-brown shingles.
  place(Gatehouse, { shingle: ROOF, plaster: CREAM, gateState: 'wide', windows: 2 }, 0, 27);
  counts.buildings++;

  // Village Well.
  place(Well, {}, 6, 8);
  counts.buildings++;

  // Lamp posts: a pair flanking the gate, one by the tavern door, one by the well.
  for (const [x, z, s] of [[-3.2, 26.2, 1.8], [3.2, 26.2, 1.8], [-8.5, 17.5, 1.4], [8.5, 6.5, 1.4]]) {
    place(LampPost, { scale: s }, x, z, { rotY: 0 });
    counts.lamps++;
  }

  // Windmill, landmark to the north-west, tallest setting.
  // NOTE: (-38, -32) floated in the water, and (-30, -26) sat right on the
  // cliff edge (Werther's verdict, 2026-11-13). (-22, -20) puts it on the
  // low rise just inside the clearing edge, with land on all sides.
  const mill = place(Windmill, { tallness: 1.18, stone: CREAM }, -22, -20);
  sails = mill.getObjectByName('sails');
  counts.buildings++;

  // Pines around the clearing edge, deterministic ring scatter.
  // Water plane in scene coordinates, from the terrain module's own data.
  const waterY = camp.terrain?.userData?.terrain?.waterY ?? -Infinity;
  const keepClear = [
    [-11, 20, 10], [15, -8, 9], [-16, -9, 9], [17.92, 4.60, 9],
    [0, 27, 8], [6, 8, 7], [-22, -20, 11],
  ];
  let attempts = 0;
  while (counts.pines < 30 && attempts++ < 120) {
    // Ring 33–42 m: the 33–47 m ring put one pine in the water south of the
    // island, so the outer edge is pulled in.
    const a = rnd() * Math.PI * 2, r = 33 + rnd() * 9;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 5 && z > 24) continue; // keep the gate path clear
    if (keepClear.some(([bx, bz, d]) => Math.hypot(x - bx, z - bz) < d)) continue;
    // Land test: groundAt returns camp.groundY (the island's foot) when the
    // downward ray misses the terrain, i.e. off the island — and anything
    // below the water plane is in the lake. Skip both.
    const y = camp.groundAt(x, z);
    if (y <= camp.groundY + 0.01) continue;
    if (y < waterY) continue;
    const make = counts.pines % 2 === 0 ? tallPine : youngPine;
    const tree = make({});
    tree.position.set(x, y, z);
    tree.rotation.y = rnd() * Math.PI * 2;
    tree.scale.setScalar(0.85 + rnd() * 0.5);
    scene.add(tree);
    counts.pines++;
  }

  // The three NPCs as humanoid stand-ins outside the bandstand deck (~6.5 m
  // from (0, 0), same angles as their original clearing positions).
  // Wick: villager (bearded stagehand), alert. Maren: tradesman, feminine,
  // old, warm — the villager module hard-codes a full beard, so it cannot
  // play her. Tomas: tradesman, old, warm, straw hat, roof-brown apron.
  place(Villager, {
    figure: 'masculine', age: 'adult', expression: 'alert', build: 0.9,
    tunic: '#7a6a55', apron: CEDAR, hair: '#5a4632',
  }, 4.16, 4.99);
  place(Tradesman, {
    figure: 'feminine', age: 'old', expression: 'warm', build: 0.9,
    tunic: '#6a7a8a', apron: CREAM, hair: '#e8e8e8',
  }, -3.53, 5.46);
  place(Tradesman, {
    figure: 'masculine', age: 'old', expression: 'warm', build: 1.0,
    tunic: '#8a7a5a', apron: ROOF, hair: '#cfcfcf',
  }, 0.76, -6.46);
  counts.npcs = 3;

  look.shadows(scene);

  // Stars: the 'night' preset leaves them off; the town's sky has stars.
  const stars = scene.getObjectByName('sky')?.getObjectByName('stars');
  if (stars) stars.visible = true;

  document.getElementById('counts').textContent =
    `${counts.bandstand} bandstand · ${counts.ghost} ghost · ${counts.buildings} buildings (incl. Milo's cottage) · ${counts.lamps} lamp posts · ${counts.pines} pines · ${counts.npcs} NPC stand-ins · terrain span 2 (128 m)`;
  status('Ready — connecting to town API…');
  window.__stagingReady = true;
  window.__staging = { counts: { ...counts }, terrain: { ...TERRAIN_PARAMS } };

  const promptBookEl = document.getElementById('prompt-book');
  const promptBookToggleEl = document.getElementById('prompt-book-toggle');
  const promptBookLinesEl = document.getElementById('prompt-book-lines');
  function setPromptBookVisible(visible) {
    if (!promptBookEl || !promptBookToggleEl) return;
    promptBookEl.hidden = !visible;
    promptBookToggleEl.setAttribute('aria-expanded', String(visible));
    promptBookToggleEl.textContent = visible ? 'Hide Prompt Book' : 'Prompt Book';
  }
  setPromptBookVisible(window.innerWidth >= 640);
  promptBookToggleEl?.addEventListener('click', () => {
    setPromptBookVisible(Boolean(promptBookEl?.hidden));
  });

  const live = new StagingLive({
    onState: (state) => {
      applyStagingState(bandstandBuilt, state, promptBookLinesEl);
    },
    onStatus: ({ connected, stateSeq, error }) => {
      if (connected && stateSeq !== null) {
        status(`Live — seq ${stateSeq}`);
      } else if (error && error.startsWith('HTTP ')) {
        status(`Live API error (${error}) — retrying…`, true);
      } else if (!connected) {
        status('Live API unreachable — retrying…', true);
      }
    },
  });
  window.__staging.live = live;
  live.start();

  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);
    walkView(dt);
    if (sails) sails.rotation.z -= dt * 0.12; // slow windmill turn
    controls.update();
    look.update(); // drives the night glow
    renderer.render(scene, camera);
  })();
}

init().catch((err) => {
  console.error(err);
  status('Build failed: ' + (err?.message || err), true);
  window.__stagingError = String(err?.message || err);
});
