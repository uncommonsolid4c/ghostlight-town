// Ghostlight Town — Polyfork staging trial (live state layer: polling + footlights + Prompt Book + presence avatars + plot sync + Inn occupancy + Nightly Call card).
// Bandstand, Milo's cottage, and Milo's blue ghost ported from town-3d/ onto
// the Polyfork ground + Medieval Village buildings. Never deployed to live.
//
// Composition: Campground & Lake terrain (span 2, 128 m) + procedural Bandstand,
// Milo's cottage + blue ghost + Medieval Village buildings, recolored to the
// town palette + Village Tavern as the Inn + resident cottages from live state +
// humanoid stand-ins for Wick, Maren and Tomas. Pines from Nature & Forest.
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
import { buildConceptBandstand, lightFootlightSlot, makeBandstandTextTexture } from './concept-bandstand.js';
import { createConceptMilosCottage } from './concept-cottage.js';
import { createConceptMiloGhost } from './concept-ghost.js';
import { renderPromptBook } from './prompt-book.mjs';
import {
  updateStagingInnOccupancy,
  updateStagingNightlyCallCard,
} from './inn-nightly-call.mjs';
import {
  TOWN_LAYOUT,
  SEED_HOME_PADS,
  createAvatarCapsule,
  getPlotTargetPosition,
  pickBandstandSpot,
} from './avatar.mjs';
import {
  openPlotOverlay,
  openGazetteOverlay,
  closePlotOverlay,
} from './plot-overlay.mjs';
import {
  openInnOverlay,
  openGuestbookOverlay,
} from './inn-guestbook-overlay.mjs';
import {
  deriveGlideMaxRadius,
  clampGlideTarget,
  stepOrbitGlide,
  createPointerTracker,
} from './tap-glide.mjs';
import { animate } from './kit-medieval/clips.mjs';
import { attachNpcAnimation, updateNpcAnimations } from './npc-animation.mjs';
import {
  buildStagingWanderFigures,
  buildStagingGhostDrift,
  updateStagingWander,
  getStagingNewsstandFrontPosition,
} from './npc-wander.mjs';
import { attachPlotProps, MILO_PLOT_PROPS } from './cottage-props.mjs';

// CONCEPT.md palette.
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
  // Terrain pad coords from town/scene coords: padX = sceneX - 192, padZ = sceneZ + 384
  // (cx -4, cz 5, CHUNK 64, mid 64). No y: each pad levels itself from the
  // flattened height at its centre, snapped to 0.25 m.
  pads: [
    { x: -203, z: 404, w: 17, d: 15 }, // tavern / Inn (-11, 20)
    { x: -174.08, z: 388.6, w: 10, d: 9 }, // Milo's cottage / plot 1 (17.92, 4.60)
    ...TOWN_LAYOUT.plots.slice(1).map((p) => ({
      x: +(p.x - 192).toFixed(3),
      z: +(p.z + 384).toFixed(3),
      w: 10,
      d: 9,
    })),
    { x: -192, z: 411, w: 11, d: 10 }, // gatehouse (0, 27)
    { x: -186, z: 392, w: 4, d: 4 },   // well (6, 8)
    { x: -186, z: 398, w: 4, d: 4 },   // newsstand (6, 14)
    { x: -214, z: 364, w: 8, d: 8 },   // windmill (-22, -20)
    { x: -192, z: 384, w: 8, d: 8 },   // bandstand spot (0, 0)
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
let glideTarget = null;
const plotOverlayEl = document.getElementById('plot-overlay');
const plotOverlayTitleEl = document.getElementById('plot-overlay-title');
const plotOverlayCloseEl = document.getElementById('plot-overlay-close');
const plotIframeEl = document.getElementById('plot-iframe');

function handleClosePlotOverlay() {
  closePlotOverlay({
    overlayEl: plotOverlayEl,
    iframeEl: plotIframeEl,
    onAfterClose: () => {
      keys.clear();
      controls.enabled = true;
      renderer.domElement.focus?.();
    },
  });
}

plotOverlayCloseEl?.addEventListener('click', handleClosePlotOverlay);

window.addEventListener('keydown', (e) => {
  if (plotOverlayEl && !plotOverlayEl.hidden) {
    if (e.code === 'Escape' || e.key === 'Escape') handleClosePlotOverlay();
    return;
  }
  glideTarget = null;
  keys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); });
function walkView(dt) {
  if (plotOverlayEl && !plotOverlayEl.hidden) return;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
  const move = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) move.add(fwd);
  if (keys.has('s') || keys.has('arrowdown')) move.sub(fwd);
  if (keys.has('d') || keys.has('arrowright')) move.add(right);
  if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
  if (move.lengthSq() === 0) return;
  glideTarget = null;
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

// Gazette newsstand ported from town-3d/town.js (makeAwningTexture + buildNewsstand).
function makeAwningTexture(THREE) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
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

  const signTex = makeBandstandTextTexture(THREE, ['THE GHOSTLIGHT GAZETTE'], {
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

// --- live state layer (footlights + Prompt Book + presence avatars + plots) ---
const RESERVED_SEED_PADS = new Set(Object.values(SEED_HOME_PADS));

function createStagingLiveStore() {
  return {
    avatars: new Map(),
    plotAssignments: new Map(),
    plotCache: new Map(),
    lastState: null,
    nightlyCallTopic: null,
  };
}

function applyStagingPlotManifest(liveStore, handle, manifest) {
  if (!handle || handle === 'milo' || !manifest || typeof manifest !== 'object') {
    return null;
  }

  let assignment = liveStore.plotAssignments.get(handle);
  if (!assignment) {
    const usedNumbers = new Set([...liveStore.plotAssignments.values()].map((a) => a.plotNumber));
    const pinnedNumber = Object.prototype.hasOwnProperty.call(SEED_HOME_PADS, handle)
      ? SEED_HOME_PADS[handle]
      : null;
    const candidateLayouts = TOWN_LAYOUT.plots.slice(1); // Plot 1 is Milo's, never reassigned.
    let layout = null;
    if (pinnedNumber !== null && !usedNumbers.has(pinnedNumber)) {
      layout = candidateLayouts.find((pl) => pl.plotNumber === pinnedNumber) || null;
    }
    if (!layout) {
      layout = candidateLayouts.find(
        (pl) => !usedNumbers.has(pl.plotNumber) && !RESERVED_SEED_PADS.has(pl.plotNumber)
      ) || null;
    }
    if (!layout) return null;
    assignment = { plotNumber: layout.plotNumber, layout, cottage: null };
    liveStore.plotAssignments.set(handle, assignment);
  }

  if (assignment.cottage) {
    assignment.cottage.removeFromParent();
  }

  const cottage = place(
    Cottage,
    {
      plaster: manifest.wall || '#e8dcc0',
      thatch: manifest.roof || '#b89b72',
      timber: manifest.trim || '#6f4e37',
      chimney: false,
    },
    assignment.layout.x,
    assignment.layout.z,
    { rotY: assignment.layout.rotY }
  );
  cottage.name = `cottage_${handle}`;
  cottage.userData.clickable = true;
  cottage.userData.kind = 'cottage';
  cottage.userData.handle = handle;
  cottage.userData.plotNumber = assignment.plotNumber;

  if (manifest.signpost_text) {
    const sign = buildStagingSignpost(String(manifest.signpost_text).slice(0, 120));
    sign.position.set(2.3, 0, 2.6);
    cottage.add(sign);
  }

  attachPlotProps(THREE, cottage, Array.isArray(manifest.props) ? manifest.props : []);

  assignment.cottage = cottage;
  return cottage;
}

async function syncStagingPlotsFromState(liveStore, state) {
  const statePlots = state?.plots && typeof state.plots === 'object' ? state.plots : null;
  const found = new Set();
  for (const handle of Object.keys(statePlots || {})) found.add(handle);
  for (const row of state?.footlights || []) if (row?.handle) found.add(row.handle);
  for (const row of state?.presence || []) if (row?.handle) found.add(row.handle);
  for (const row of state?.prompt_book || []) if (row?.handle) found.add(row.handle);
  found.delete('milo');

  const handles = [...found].sort((a, b) => {
    const aSeed = Object.prototype.hasOwnProperty.call(SEED_HOME_PADS, a);
    const bSeed = Object.prototype.hasOwnProperty.call(SEED_HOME_PADS, b);
    if (aSeed !== bSeed) return aSeed ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  let placedAny = false;
  for (const handle of handles) {
    const cached = liveStore.plotCache.get(handle);
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
      const res = await fetch(`/api/town/plot?handle=${encodeURIComponent(handle)}`);
      if (res && res.status === 200) {
        const data = await res.json();
        if (data && data.manifest) {
          liveStore.plotCache.set(handle, {
            found: true,
            fetchedAtSeq: state.state_seq,
            plotUpdatedAt: data.plot_updated_at ?? (hasPlotTimestamp ? stateUpdatedAt : null),
            manifest: data.manifest,
          });
          if (applyStagingPlotManifest(liveStore, handle, data.manifest)) {
            placedAny = true;
          }
          continue;
        }
      }
      liveStore.plotCache.set(handle, {
        found: false,
        fetchedAtSeq: state.state_seq,
        plotUpdatedAt: hasPlotTimestamp ? stateUpdatedAt : null,
      });
    } catch {
      liveStore.plotCache.set(handle, {
        found: false,
        fetchedAtSeq: state.state_seq,
        plotUpdatedAt: hasPlotTimestamp ? stateUpdatedAt : null,
      });
    }
  }
  return placedAny;
}

function applyStagingPresence(liveStore, bandstandBuilt, npcStandIns, footlightSlotByHandle, state = {}) {
  const presenceRows = (Array.isArray(state?.presence) ? state.presence : [])
    .filter((p) => p?.handle !== 'milo');
  const activeHandles = new Set(presenceRows.map((p) => p?.handle).filter(Boolean));
  for (const [handle, avatar] of liveStore.avatars.entries()) {
    if (!activeHandles.has(handle)) {
      avatar.removeFromParent();
      liveStore.avatars.delete(handle);
    }
  }

  const usedSpots = new Set();
  const targets = new Map();
  const avatarSpots = bandstandBuilt?.avatarSpots || [];
  const bandstandGroundY = camp.groundAt(0, 0);
  const toStagingBandstandTarget = (spot) => ({
    ...spot,
    y: spot.slot < avatarSpots.length ? bandstandGroundY + spot.y : camp.groundAt(spot.x, spot.z),
  });

  // Pass 1: reserve deterministic footlight spots for bandstand avatars with lit footlights.
  for (const row of presenceRows) {
    if (!row?.handle || row.zone !== 'bandstand') continue;
    const preferred = footlightSlotByHandle.get(row.handle);
    if (Number.isInteger(preferred) && !usedSpots.has(preferred)) {
      targets.set(row.handle, toStagingBandstandTarget(pickBandstandSpot(avatarSpots, usedSpots, preferred)));
    }
  }

  // Pass 2: assign remaining avatars (bandstand without footlight, gate, plot:<handle>).
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
      targets.set(row.handle, { x, y: camp.groundAt(x, z), z, rotY: Math.PI, nametagLift });
    } else if (zone.startsWith('plot:')) {
      const plotHandle = zone.slice(5);
      const layout =
        plotHandle === 'milo'
          ? TOWN_LAYOUT.plots[0]
          : liveStore.plotAssignments.get(plotHandle)?.layout;
      if (layout) {
        const count = plotCounts.get(plotHandle) || 0;
        plotCounts.set(plotHandle, count + 1);
        const pos = getPlotTargetPosition(layout, count);
        targets.set(row.handle, { ...pos, y: camp.groundAt(pos.x, pos.z), nametagLift: (count % 2) * 0.5 });
      } else {
        targets.set(row.handle, toStagingBandstandTarget(pickBandstandSpot(avatarSpots, usedSpots, null)));
      }
    } else {
      targets.set(row.handle, toStagingBandstandTarget(pickBandstandSpot(avatarSpots, usedSpots, null)));
    }
  }

  for (const row of presenceRows) {
    if (!row?.handle) continue;
    const role = row.role === 'npc' ? 'npc' : 'muse';
    const target = targets.get(row.handle);
    const existing = liveStore.avatars.get(row.handle);
    let avatar;

    if (existing && existing.userData.role === role) {
      avatar = existing;
    } else {
      if (existing) existing.removeFromParent();
      avatar = createAvatarCapsule(THREE, { handle: row.handle, role });
      avatar.position.set(target.x, target.y, target.z);
      avatar.rotation.y = target.rotY;
      scene.add(avatar);
      liveStore.avatars.set(row.handle, avatar);
    }
    avatar.userData.target = target;
    const lift = target.nametagLift || 0;
    avatar.userData.nametagLift = lift;
    if (avatar.userData.nametagSprite) {
      avatar.userData.nametagSprite.position.y = 1.8 + lift;
    }
  }
}

function applyStagingState(liveStore, bandstandBuilt, npcStandIns, state = {}, promptBookLinesEl = null, tavernGroup = null) {
  const footlights = bandstandBuilt?.footlights || [];
  // Slot 0 / 'milo' is permanent and must never be lit, unlit, or relabeled from state.
  const footlightRows = (Array.isArray(state?.footlights) ? state.footlights : [])
    .filter((r) => r?.handle !== 'milo');
  const litBySlot = new Map();
  const footlightSlotByHandle = new Map();
  for (const row of footlightRows) {
    if (row && Number.isInteger(row.slot) && row.slot >= 1 && row.slot < footlights.length) {
      litBySlot.set(row.slot, row);
      if (typeof row.handle === 'string') {
        footlightSlotByHandle.set(row.handle, row.slot);
      }
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

  applyStagingPresence(liveStore, bandstandBuilt, npcStandIns, footlightSlotByHandle, state);

  updateStagingInnOccupancy(tavernGroup, state?.inn);
  updateStagingNightlyCallCard(
    {
      THREE,
      bandstandBuilt,
      liveStore,
      makeTextTexture: makeBandstandTextTexture,
    },
    state?.nightly_call
  );

  if (promptBookLinesEl) {
    renderPromptBook(promptBookLinesEl, state?.prompt_book, document);
    promptBookLinesEl.scrollTop = promptBookLinesEl.scrollHeight;
  }

  return footlightSlotByHandle;
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
  const tavernGroup = place(Tavern, { width: 10, plaster: CREAM, tile: ROOF, timber: CEDAR }, -11, 20, { remove: 'sign' });
  tavernGroup.userData.clickable = true;
  tavernGroup.userData.kind = 'inn';
  counts.buildings++;

  // Plot 1: Milo's cottage (procedural concept shell + staging-local signpost),
  // at live plot-1 coordinates (17.92, 4.60). Resident plots 2–8 are synced
  // from live state after polling.
  const MILO_PLOT = { x: 17.92, z: 4.60 };
  const milosCottage = createConceptMilosCottage(THREE, {
    name: 'milos_cottage',
    label: 'Milo — Ghostlight Cottage (rebuilt)',
  });
  const sign = buildStagingSignpost('Milo — Ghostlight Cottage (rebuilt)');
  sign.position.set(2.3, 0, 2.6);
  milosCottage.add(sign);
  attachPlotProps(THREE, milosCottage, MILO_PLOT_PROPS);
  milosCottage.position.set(MILO_PLOT.x, camp.groundAt(MILO_PLOT.x, MILO_PLOT.z), MILO_PLOT.z);
  milosCottage.rotation.y = faceCenter(MILO_PLOT.x, MILO_PLOT.z);
  scene.add(milosCottage);
  counts.buildings++;

  // Village Gatehouse, gates wide open, roof-brown shingles.
  const gatehouseGroup = place(Gatehouse, { shingle: ROOF, plaster: CREAM, gateState: 'wide', windows: 2 }, 0, 27);
  gatehouseGroup.userData.clickable = true;
  gatehouseGroup.userData.kind = 'gate';
  counts.buildings++;

  // Village Well.
  place(Well, {}, 6, 8);
  counts.buildings++;

  // Gazette Newsstand.
  const newsstand = buildNewsstand(THREE);
  newsstand.position.set(
    TOWN_LAYOUT.newsstand.x,
    camp.groundAt(TOWN_LAYOUT.newsstand.x, TOWN_LAYOUT.newsstand.z),
    TOWN_LAYOUT.newsstand.z
  );
  scene.add(newsstand);
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
    [-11, 20, 10],
    [17.92, 4.60, 9],
    ...TOWN_LAYOUT.plots.slice(1).map((p) => [p.x, p.z, 9]),
    [0, 27, 8], [6, 8, 7], [TOWN_LAYOUT.newsstand.x, TOWN_LAYOUT.newsstand.z, 5], [-22, -20, 11],
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
  const npcStandIns = new Map([
    ['wick', {
      group: place(Villager, {
        figure: 'masculine', age: 'adult', expression: 'alert', build: 0.9,
        tunic: '#7a6a55', apron: CEDAR, hair: '#5a4632',
      }, 4.16, 4.99),
      home: { x: 4.16, z: 4.99 },
    }],
    ['maren', {
      group: place(Tradesman, {
        figure: 'feminine', age: 'old', expression: 'warm', build: 0.9,
        tunic: '#6a7a8a', apron: CREAM, hair: '#e8e8e8',
      }, -3.53, 5.46),
      home: { x: -3.53, z: 5.46 },
    }],
    ['tomas', {
      group: place(Tradesman, {
        figure: 'masculine', age: 'old', expression: 'warm', build: 1.0,
        tunic: '#8a7a5a', apron: ROOF, hair: '#cfcfcf',
      }, 0.76, -6.46),
      home: { x: 0.76, z: -6.46 },
    }],
  ]);
  counts.npcs = npcStandIns.size;
  for (const standIn of npcStandIns.values()) {
    attachNpcAnimation(THREE, standIn.group, { animateFn: animate }).then((anim) => {
      standIn.anim = anim;
    });
  }
  const wanderFigures = buildStagingWanderFigures({
    standIns: npcStandIns,
    plots: TOWN_LAYOUT.plots,
    bandstandSpots: bandstandBuilt.avatarSpots,
    bandstandGroundY: camp.groundAt(0, 0),
    newsstandFront: getStagingNewsstandFrontPosition(TOWN_LAYOUT),
    groundAt: (x, z) => camp.groundAt(x, z),
    getPlotTargetPosition,
    homePads: SEED_HOME_PADS,
  });
  const ghostDrift = buildStagingGhostDrift({ ghost, bandstandSpots: bandstandBuilt.avatarSpots });
  if (ghostDrift) wanderFigures.push(ghostDrift);

  look.shadows(scene);
  // Apply night glow once before live polling starts so `camp.group.userData.nightSet`
  // is initialized and later frames in `loop()` do not overwrite state-driven Inn dimming.
  look.update();

  // Stars: the 'night' preset leaves them off; the town's sky has stars.
  const stars = scene.getObjectByName('sky')?.getObjectByName('stars');
  if (stars) stars.visible = true;

  const liveStore = createStagingLiveStore();
  function updateCountsLine() {
    document.getElementById('counts').textContent =
      `${counts.bandstand} bandstand · ${counts.ghost} ghost · ${counts.buildings + liveStore.plotAssignments.size} buildings (incl. Milo's cottage + ${liveStore.plotAssignments.size} resident) · ${counts.lamps} lamp posts · ${counts.pines} pines · ${counts.npcs} NPC stand-ins · ${liveStore.avatars.size} live avatars · terrain span 2 (128 m)`;
  }
  updateCountsLine();
  status('Ready — connecting to town API…');
  window.__stagingReady = true;
  window.__staging = { counts: { ...counts }, terrain: { ...TERRAIN_PARAMS }, liveStore };

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
      liveStore.lastState = state;
      const footlightSlotByHandle = applyStagingState(
        liveStore,
        bandstandBuilt,
        npcStandIns,
        state,
        promptBookLinesEl,
        tavernGroup
      );
      updateCountsLine();
      syncStagingPlotsFromState(liveStore, state).then((placedAny) => {
        if (placedAny && liveStore.lastState) {
          applyStagingPresence(
            liveStore,
            bandstandBuilt,
            npcStandIns,
            footlightSlotByHandle,
            liveStore.lastState
          );
          updateCountsLine();
        }
      });
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

  // Raycast click & tap-to-glide handling for cottages, Gazette, Inn, Gatehouse, and ground.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointerTracker = createPointerTracker({ dragThreshold: 4 });
  const glideMaxRadius = deriveGlideMaxRadius(camp.terrain?.userData?.terrain);

  function findClickableAncestor(obj) {
    let cur = obj;
    while (cur) {
      if (cur.userData && cur.userData.clickable) return cur;
      cur = cur.parent;
    }
    return null;
  }

  function onBeforeOverlayOpen() {
    glideTarget = null;
    pointerTracker.reset();
    keys.clear();
    controls.enabled = false;
  }

  function handleCanvasClick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const fetchFn = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      const target = findClickableAncestor(hit.object);
      if (target) {
        const kind = target.userData.kind;
        if (kind === 'cottage' && target.userData.handle) {
          openPlotOverlay(target.userData.handle, {
            overlayEl: plotOverlayEl,
            titleEl: plotOverlayTitleEl,
            iframeEl: plotIframeEl,
            fetchFn,
            onBeforeOpen: onBeforeOverlayOpen,
          });
          return true;
        }
        if (kind === 'newsstand') {
          openGazetteOverlay({
            overlayEl: plotOverlayEl,
            titleEl: plotOverlayTitleEl,
            iframeEl: plotIframeEl,
            fetchFn,
            onBeforeOpen: onBeforeOverlayOpen,
          });
          return true;
        }
        if (kind === 'inn') {
          openInnOverlay({
            overlayEl: plotOverlayEl,
            titleEl: plotOverlayTitleEl,
            iframeEl: plotIframeEl,
            innState: liveStore.lastState?.inn,
            fetchFn,
            onBeforeOpen: onBeforeOverlayOpen,
          });
          return true;
        }
        if (kind === 'gate') {
          openGuestbookOverlay({
            overlayEl: plotOverlayEl,
            titleEl: plotOverlayTitleEl,
            iframeEl: plotIframeEl,
            fetchFn,
            onBeforeOpen: onBeforeOverlayOpen,
          });
          return true;
        }
        return false;
      }
    }
    return false;
  }

  function setGlideTargetFromTap(e) {
    const ground = camp?.terrain?.getObjectByName('ground');
    if (!ground) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(ground, false);
    if (hits.length === 0) return;

    const clamped = clampGlideTarget(hits[0].point.x, hits[0].point.z, glideMaxRadius);
    const gy = camp.groundAt(clamped.x, clamped.z);
    if (gy <= camp.groundY + 0.01 || gy < waterY) return;
    glideTarget = clamped;
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    const overlayHidden = !plotOverlayEl || plotOverlayEl.hidden;
    const res = pointerTracker.onPointerDown(e.pointerId, e.clientX, e.clientY, {
      overlayHidden,
      pointerType: e.pointerType,
      button: e.button,
    });
    if (res.cancelGlide) {
      glideTarget = null;
    }
  });

  window.addEventListener('pointermove', (e) => {
    const overlayHidden = !plotOverlayEl || plotOverlayEl.hidden;
    const res = pointerTracker.onPointerMove(e.pointerId, e.clientX, e.clientY, {
      overlayHidden,
    });
    if (res.cancelGlide) {
      glideTarget = null;
    }
  });

  function finishPointer(e, allowTap) {
    const overlayHidden = !plotOverlayEl || plotOverlayEl.hidden;
    const res = pointerTracker.onPointerUp(e.pointerId, e.clientX, e.clientY, {
      overlayHidden,
      allowTap,
    });
    if (!res.ended || !res.shouldClick) return;
    glideTarget = null;
    const hitClickable = handleCanvasClick(e);
    if (!hitClickable && e.pointerType === 'touch') {
      setGlideTargetFromTap(e);
    }
  }

  window.addEventListener('pointerup', (e) => finishPointer(e, true));
  window.addEventListener('pointercancel', (e) => finishPointer(e, false));

  const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);
    walkView(dt);
    if (glideTarget && (!plotOverlayEl || plotOverlayEl.hidden)) {
      const next = stepOrbitGlide(
        controls.target,
        camera.position,
        glideTarget,
        dt,
        { speed: 14, maxRadius: glideMaxRadius, arriveDist: 0.3 }
      );
      controls.target.x = next.targetX;
      controls.target.z = next.targetZ;
      camera.position.x = next.cameraX;
      camera.position.z = next.cameraZ;
      if (next.arrived) {
        glideTarget = null;
      }
    }
    const alpha = dt >= 0.5 ? 1 : 1 - Math.exp(-6 * dt);
    for (const avatar of liveStore.avatars.values()) {
      const t = avatar.userData?.target;
      if (!t) continue;
      avatar.position.x += (t.x - avatar.position.x) * alpha;
      avatar.position.y += (t.y - avatar.position.y) * alpha;
      avatar.position.z += (t.z - avatar.position.z) * alpha;
      if (typeof t.rotY === 'number') {
        avatar.rotation.y += (t.rotY - avatar.rotation.y) * alpha;
      }
    }
    if (sails) sails.rotation.z -= dt * 0.12; // slow windmill turn
    updateStagingWander(wanderFigures, dt, liveStore.avatars);
    updateNpcAnimations(npcStandIns, dt);
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
