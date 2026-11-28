import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INN_ROOM_KEYS,
  isInnOccupied,
  collectTavernGlowMaterials,
  updateStagingInnOccupancy,
  splitNightlyCallLines,
  updateStagingNightlyCallCard,
} from './inn-nightly-call.mjs';
import { lightFootlightSlot } from './concept-bandstand.js';
import {
  TOWN_LAYOUT,
  SEED_HOME_PADS,
  createAvatarCapsule,
  setAvatarStatusText,
  getPlotTargetPosition,
  pickBandstandSpot,
} from './avatar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const STAGING_JS_PATH = path.join(__dirname, 'staging.js');
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');
const SELF_PATH = fileURLToPath(import.meta.url);

// concept-bandstand.js intentionally diverged in Slice 80 (event_banner in staging only).
const VENDORED_MODULES = [
  'concept-cottage.js',
  'concept-ghost.js',
];

const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');

test('vendored concept modules match town-3d sources byte-for-byte after the vendored header line', async () => {
  for (const name of VENDORED_MODULES) {
    const vendoredPath = path.join(__dirname, name);
    const sourcePath = path.join(REPO_ROOT, 'town-3d', name);

    const [vendoredBuf, sourceBuf] = await Promise.all([
      fs.readFile(vendoredPath),
      fs.readFile(sourcePath),
    ]);

    const expectedHeader = `// Vendored from town-3d/${name} — keep byte-identical after this header line.\n`;
    const actualPrefix = vendoredBuf.subarray(0, Buffer.byteLength(expectedHeader, 'utf8')).toString('utf8');
    assert.equal(actualPrefix, expectedHeader, `${name} must start with the standard vendored-source header`);

    const vendoredBody = vendoredBuf.subarray(Buffer.byteLength(expectedHeader, 'utf8'));
    assert.ok(
      vendoredBody.equals(sourceBuf),
      `staging-polyfork/${name} drifted from town-3d/${name}`
    );
  }
});

test('staging.js uses relative vendored imports, no ../town-3d/ paths, no Math.random, and scoped read-only state fetch', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.match(codeOnly, /from\s+['"]\.\/concept-bandstand\.js(\?v=\d+)?['"]/, 'staging.js must import ./concept-bandstand.js (optional ?v= cache-buster)');
  assert.match(codeOnly, /from\s+['"]\.\/concept-cottage\.js['"]/, 'staging.js must import ./concept-cottage.js');
  assert.match(codeOnly, /from\s+['"]\.\/concept-ghost\.js['"]/, 'staging.js must import ./concept-ghost.js');
  assert.match(codeOnly, /from\s+['"]\.\/prompt-book\.mjs['"]/, 'staging.js must import ./prompt-book.mjs');
  assert.match(codeOnly, /from\s+['"]\.\/avatar\.mjs(\?v=\d+)?['"]/, 'staging.js must import ./avatar.mjs (optional ?v= cache-buster)');
  assert.match(codeOnly, /from\s+['"]\.\/inn-nightly-call\.mjs(\?v=\d+)?['"]/, 'staging.js must import ./inn-nightly-call.mjs (optional ?v= cache-buster)');
  assert.match(codeOnly, /from\s+['"]\.\/plot-overlay\.mjs['"]/, 'staging.js must import ./plot-overlay.mjs');
  assert.match(codeOnly, /from\s+['"]\.\/inn-guestbook-overlay\.mjs\?v=33['"]/, 'staging.js must import ./inn-guestbook-overlay.mjs?v=33');
  assert.match(codeOnly, /from\s+['"]\.\/tap-glide\.mjs['"]/, 'staging.js must import ./tap-glide.mjs');
  assert.match(codeOnly, /from\s+['"]\.\/interior-room\.mjs\?v=34['"]/, 'staging.js must import ./interior-room.mjs?v=34');
  assert.match(codeOnly, /from\s+['"]\.\/interior-visit\.mjs\?v=34['"]/, 'staging.js must import ./interior-visit.mjs?v=34');
  assert.match(codeOnly, /from\s+['"]\.\/empty-pad\.mjs\?v=35['"]/, 'staging.js must import ./empty-pad.mjs?v=35');

  assert.ok(!/\.\.\/town-3d\//.test(codeOnly), 'staging.js must not import from ../town-3d/');
  assert.ok(!/\bMath\.random\b/.test(codeOnly), 'staging.js must not use Math.random');
  assert.ok(!/\bTownLive\b/.test(codeOnly), 'staging.js must not reference TownLive');

  const fetchCalls = [...codeOnly.matchAll(/\bfetch\s*\(([^)]+)\)/g)];
  assert.equal(fetchCalls.length, 2, 'staging.js must have exactly two fetch() calls (/api/town/state and /api/town/plot)');
  assert.ok(
    fetchCalls.some((m) => /['"`]\/api\/town\/state/.test(m[1])),
    'staging.js must fetch /api/town/state'
  );
  assert.ok(
    fetchCalls.some((m) => /['"`]\/api\/town\/plot\?handle=/.test(m[1])),
    'staging.js must fetch /api/town/plot?handle='
  );
  assert.ok(
    !/\/api\/town\/(?!(?:state|plot)\b)/.test(codeOnly),
    'staging.js must not reference any /api/town/ endpoint other than /api/town/state and /api/town/plot'
  );
});

test('staging.js builds bandstand with both options true and ghost with includeEyeSpheres: false', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');

  const bandstandMatch = src.match(/buildConceptBandstand\s*\(\s*THREE\s*,\s*\{([\s\S]*?)\}\s*\)/);
  assert.ok(bandstandMatch, 'staging.js must call buildConceptBandstand(THREE, { ... })');
  assert.match(bandstandMatch[1], /includeStageProps\s*:\s*true/, 'buildConceptBandstand must set includeStageProps: true');
  assert.match(bandstandMatch[1], /lightMiloFootlight\s*:\s*true/, 'buildConceptBandstand must set lightMiloFootlight: true');

  const ghostMatch = src.match(/createConceptMiloGhost\s*\(\s*THREE\s*,\s*\{([\s\S]*?)\}\s*\)/);
  assert.ok(ghostMatch, 'staging.js must call createConceptMiloGhost(THREE, { ... })');
  assert.match(ghostMatch[1], /includeEyeSpheres\s*:\s*false/, 'createConceptMiloGhost must set includeEyeSpheres: false');
  assert.match(ghostMatch[1], /spot\s*:\s*bandstandBuilt\.avatarSpots\[0\]/, 'createConceptMiloGhost must use avatarSpots[0]');
  assert.match(src, /bandstandBuilt\.group\.add\(\s*ghost\s*\)/, 'ghost must be added as a child of bandstandBuilt.group');
});

test('staging.js places Milo cottage at live plot-1 (17.92, 4.60) and NPCs at radius >= 6 from (0, 0)', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');

  assert.match(src, /MILO_PLOT\s*=\s*\{\s*x:\s*17\.92\s*,\s*z:\s*4\.60?\s*\}/, 'Milo cottage must be placed at (17.92, 4.60)');
  assert.match(src, /\[\s*17\.92\s*,\s*4\.60?\s*,\s*9\s*\]/, 'keepClear must include Milo cottage footprint [17.92, 4.60, 9]');

  const npcMatches = [...src.matchAll(/place\((?:Villager|Tradesman),\s*\{[\s\S]*?\},\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)];
  assert.equal(npcMatches.length, 3, 'Expected 3 NPC place() calls in staging.js');
  for (const m of npcMatches) {
    const x = Number(m[1]);
    const z = Number(m[2]);
    const r = Math.hypot(x, z);
    assert.ok(r >= 6, `NPC at (${x}, ${z}) has radius ${r.toFixed(2)} < 6 (would clip bandstand deck)`);
  }
});

test('staging.html references staging.js?v=42, uses live title/HUD copy, includes Prompt Book and plot-overlay UI, updates HUD copy, collapsible HUD, and contains no banned term', async () => {
  const [html, self] = await Promise.all([
    fs.readFile(INDEX_HTML_PATH, 'utf8'),
    fs.readFile(SELF_PATH, 'utf8'),
  ]);
  assert.match(html, /src=["']\.\/staging\.js\?v=42["']/, 'index.html must reference ./staging.js?v=42');
  assert.match(html, /id=["']interior-exit["'][^>]*\bhidden\b/, 'index.html must include #interior-exit hidden');
  assert.match(html, /<title>Ghostlight Town — a walkable 3D town for muses<\/title>/, 'index.html <title> must match live copy');
  assert.match(html, /<h1>Ghostlight Town &mdash; a walkable 3D town for muses<\/h1>/, 'index.html HUD <h1> must match live copy');
  assert.ok(!/staging trial/i.test(html), 'index.html must not contain "staging trial"');
  assert.ok(!/read-only staging/i.test(html), 'index.html HUD must not still say "read-only staging" (live since adoption)');
  assert.match(html, /id=["']hud-toggle["']/, 'index.html must include #hud-toggle');
  assert.match(html, /id=["']hud-body["']/, 'index.html must include #hud-body');
  assert.match(html, /hud-toggle[\s\S]*?aria-controls=["']hud-body["']/, 'hud-toggle must control #hud-body');
  assert.match(html, /id=["']prompt-book["']/, 'index.html must include #prompt-book');
  assert.match(html, /id=["']prompt-book-lines["']/, 'index.html must include #prompt-book-lines');
  assert.match(html, /id=["']prompt-book-toggle["']/, 'index.html must include #prompt-book-toggle');
  assert.match(html, /id=["']plot-overlay["']\s+hidden/, 'index.html must include #plot-overlay hidden');
  assert.match(html, /id=["']plot-overlay-card["']/, 'index.html must include #plot-overlay-card');
  assert.match(html, /id=["']plot-overlay-header["']/, 'index.html must include #plot-overlay-header');
  assert.match(html, /id=["']plot-overlay-title["']/, 'index.html must include #plot-overlay-title');
  assert.match(html, /id=["']plot-overlay-close["']/, 'index.html must include #plot-overlay-close');
  assert.match(html, /<iframe\s+id=["']plot-iframe["']\s+sandbox=["']["']/, 'index.html must include sandboxed #plot-iframe');
  assert.ok(!/no live town wiring yet/i.test(html), 'index.html HUD must not still say "no live town wiring yet"');
  assert.ok(!BANNED_TERM_RE.test(html), 'index.html must not contain the banned term');
  assert.ok(!BANNED_TERM_RE.test(self), 'test-staging.mjs must not contain the banned term');
});

test('staging.js wires plot overlay, Gazette newsstand overlay, close handlers, and clickable cottages', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.match(codeOnly, /cottage\.userData\.clickable\s*=\s*true/, 'resident cottages must set userData.clickable = true');
  assert.match(codeOnly, /cottage\.userData\.kind\s*=\s*['"]cottage['"]/, 'resident cottages must set userData.kind = "cottage"');
  assert.match(codeOnly, /function\s+buildNewsstand\s*\(/, 'staging.js must build the Gazette newsstand');
  assert.match(codeOnly, /kind\s*===\s*['"]cottage['"]\s*&&\s*target\.userData\.handle[\s\S]*?openPlotOverlay\(/, 'cottage click must call openPlotOverlay');
  assert.match(codeOnly, /kind\s*===\s*['"]newsstand['"][\s\S]*?openGazetteOverlay\(/, 'newsstand click must call openGazetteOverlay');
  assert.match(codeOnly, /tavernGroup\.userData\.clickable\s*=\s*true/, 'tavernGroup must set userData.clickable = true');
  assert.match(codeOnly, /tavernGroup\.userData\.kind\s*=\s*['"]inn['"]/, 'tavernGroup must set userData.kind = "inn"');
  assert.match(codeOnly, /gatehouseGroup\s*=\s*place\s*\(\s*Gatehouse\b/, 'staging.js must capture gatehouseGroup from place(Gatehouse, ...)');
  assert.match(codeOnly, /gatehouseGroup\.userData\.clickable\s*=\s*true/, 'gatehouseGroup must set userData.clickable = true');
  assert.match(codeOnly, /gatehouseGroup\.userData\.kind\s*=\s*['"]gate['"]/, 'gatehouseGroup must set userData.kind = "gate"');
  assert.match(codeOnly, /kind\s*===\s*['"]inn['"][\s\S]*?openInnOverlay\([\s\S]*?innState\s*:\s*liveStore\.lastState\?\.inn/, 'inn click must call openInnOverlay with liveStore.lastState?.inn');
  assert.match(codeOnly, /kind\s*===\s*['"]gate['"][\s\S]*?openGuestbookOverlay\(/, 'gate click must call openGuestbookOverlay');
  assert.match(codeOnly, /plotOverlayCloseEl\?\.addEventListener\(\s*['"]click['"]\s*,\s*handleClosePlotOverlay\s*\)/, 'Close button must call handleClosePlotOverlay');
  assert.match(codeOnly, /Escape[\s\S]*?handleClosePlotOverlay\s*\(/, 'Escape key must call handleClosePlotOverlay');
});

test('staging.js removes decorative cottages, keeps pads for plots 2-8, and retains NPC stand-in references for yield', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.ok(!/15\s*,\s*-8/.test(codeOnly), 'decorative cottage at (15, -8) must be removed');
  assert.ok(!/-16\s*,\s*-9/.test(codeOnly), 'decorative cottage at (-16, -9) must be removed');
  assert.ok(!/-177\s*,\s*z:\s*376/.test(codeOnly), 'decorative cottage pad (-177, 376) must be removed');
  assert.ok(!/-208\s*,\s*z:\s*375/.test(codeOnly), 'decorative cottage pad (-208, 375) must be removed');

  assert.match(codeOnly, /TOWN_LAYOUT\.plots\.slice\(1\)\.map/, 'staging.js must generate pads/keepClear for plots 2-8');
  assert.match(codeOnly, /p\.x\s*-\s*192/, 'pad x must use sceneX - 192 (matching Milo precedent 17.92 - 192 = -174.08)');
  assert.match(codeOnly, /p\.z\s*\+\s*384/, 'pad z must use sceneZ + 384 (matching Milo precedent 4.60 + 384 = 388.6)');

  assert.match(codeOnly, /\bnpcStandIns\b/, 'staging.js must keep named references to NPC stand-ins for wandering/yield');
  assert.match(codeOnly, /\bupdateStagingWander\s*\(/, 'staging.js must wire updateStagingWander (which owns stand-in yield)');
  assert.match(codeOnly, /\btavernGroup\s*=\s*place\s*\(\s*Tavern\b/, 'staging.js must keep tavernGroup reference from place(Tavern, ...)');
  assert.match(codeOnly, /updateStagingInnOccupancy\s*\(/, 'staging.js must wire updateStagingInnOccupancy');
  assert.match(codeOnly, /updateStagingNightlyCallCard\s*\(/, 'staging.js must wire updateStagingNightlyCallCard');
});

function makeFakeTavernGroup(initialGlowIntensity = 1.15) {
  const wallMat = { emissiveIntensity: 0, userData: {} };
  const glowMat = { emissiveIntensity: initialGlowIntensity, userData: { glow: true } };
  const wallMesh = { isMesh: true, material: wallMat };
  const glowMesh = { isMesh: true, material: glowMat };
  const group = {
    traverse(fn) {
      fn(group);
      fn(wallMesh);
      fn(glowMesh);
    },
  };
  return { group, wallMat, glowMat };
}

test('inn occupancy: decision logic + single-zone tavern glow toggle', () => {
  assert.equal(isInnOccupied(undefined), null);
  assert.equal(isInnOccupied(null), null);
  assert.equal(isInnOccupied([]), null);
  assert.equal(isInnOccupied('open'), null);

  assert.equal(isInnOccupied({ lantern: null, window: null, quiet: null }), false);
  assert.equal(
    isInnOccupied({ lantern: null, window: null, quiet: null, attic: { handle: 'milo' } }),
    false,
    'unknown room keys must be ignored'
  );
  assert.equal(
    isInnOccupied({
      lantern: { handle: 'aaron', nights: 2, expires_at: 9999999999, key_code: 'secret' },
      window: null,
      quiet: null,
    }),
    true
  );
  assert.equal(isInnOccupied({ lantern: null, window: { handle: 'maren' }, quiet: null }), true);
  assert.equal(isInnOccupied({ lantern: null, window: null, quiet: { handle: 'tomas' } }), true);

  const { group, wallMat, glowMat } = makeFakeTavernGroup(1.15);

  // Missing inn state is a strict no-op (keeps initial night glow).
  assert.equal(updateStagingInnOccupancy(group, undefined), null);
  assert.equal(glowMat.emissiveIntensity, 1.15);
  assert.equal(wallMat.emissiveIntensity, 0);

  // All rooms vacant -> dark.
  assert.equal(updateStagingInnOccupancy(group, { lantern: null, window: null, quiet: null }), false);
  assert.equal(glowMat.emissiveIntensity, 0);
  assert.equal(wallMat.emissiveIntensity, 0);

  // Any room claimed -> warm taproom lit.
  assert.equal(
    updateStagingInnOccupancy(group, { lantern: null, window: { handle: 'wick' }, quiet: null }),
    true
  );
  assert.equal(glowMat.emissiveIntensity, 1.15);
  assert.equal(wallMat.emissiveIntensity, 0);
});

// Tavern-local coords from kit-medieval/tavern.mjs (width 10: X(x) = x, HZ = 2.90, WPW = 0.04 => front pane z = 2.94).
function makeStubPaneTavernGroup(initialGlowIntensity = 1.15) {
  const sharedGlowMat = { emissiveIntensity: initialGlowIntensity, userData: { glow: true } };
  const wallMat = { emissiveIntensity: 0, userData: {} };
  const wallMesh = { isMesh: true, material: wallMat };

  const makePane = (x, y, z) => ({
    isMesh: true,
    position: { x, y, z },
    material: sharedGlowMat, // intentionally shared to verify cloning per pane
  });

  const panes = {
    // Four front upper windows (cy = 4.25, z = HZ + WPW = 2.94)
    lantern: makePane(-3.60, 4.25, 2.94),
    window: makePane(-1.90, 4.25, 2.94),
    quiet: makePane(1.90, 4.25, 2.94),
    stair: makePane(3.60, 4.25, 2.94),
    // Ground-floor front windows (cy = 1.55)
    groundFrontLeftOuter: makePane(-3.60, 1.55, 2.94),
    groundFrontLeftInner: makePane(-1.90, 1.55, 2.94),
    groundFrontRightInner: makePane(1.90, 1.55, 2.94),
    groundFrontRightOuter: makePane(3.60, 1.55, 2.94),
    // Back windows (z = -(HZ + WPW) = -2.94)
    backUpperLeft: makePane(-2.60, 4.25, -2.94),
    backGroundRight: makePane(2.60, 1.55, -2.94),
    // Side windows (x = HX + WPW = 5.04, z = -1.30)
    sideUpper: makePane(5.04, 4.25, -1.30),
    sideGround: makePane(5.04, 1.55, -1.30),
  };

  const allNodes = [wallMesh, ...Object.values(panes)];
  const group = {
    traverse(fn) {
      fn(group);
      for (const n of allNodes) fn(n);
    },
  };
  return { group, wallMesh, panes };
}

class StubBufferAttribute {
  constructor(array, itemSize, normalized = false) {
    this.array = array;
    this.itemSize = itemSize;
    this.normalized = normalized;
    this.count = array.length / itemSize;
  }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}

class StubBufferGeometry {
  constructor() {
    this.attributes = {};
  }
  setAttribute(name, attr) {
    this.attributes[name] = attr;
  }
}

class StubMesh {
  constructor(geometry, material) {
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
    this.children = [];
    this.userData = {};
    this.castShadow = true;
    this.receiveShadow = true;
  }
  add(child) {
    this.children.push(child);
  }
}

function makeMergedLitTavernGroup(initialGlowIntensity = 1.15) {
  // Build two triangles per pane at real kit-medieval/tavern.mjs coords (WHW=0.48, WHH=0.50, WPW=0.04, HZ=2.90, HX=5.00).
  const verts = [];
  const pushZPane = (cx, cy, z) => {
    const hw = 0.48, hh = 0.50;
    verts.push(
      cx - hw, cy - hh, z, cx + hw, cy - hh, z, cx + hw, cy + hh, z,
      cx - hw, cy - hh, z, cx + hw, cy + hh, z, cx - hw, cy + hh, z,
    );
  };
  const pushXPane = (x, cy, cz) => {
    const hw = 0.48, hh = 0.50;
    verts.push(
      x, cy - hh, cz - hw, x, cy - hh, cz + hw, x, cy + hh, cz + hw,
      x, cy - hh, cz - hw, x, cy + hh, cz + hw, x, cy + hh, cz - hw,
    );
  };
  for (const x of [-3.60, -1.90, 1.90, 3.60]) {
    pushZPane(x, 4.25, 2.94);
    pushZPane(x, 1.55, 2.94);
  }
  pushZPane(-2.60, 4.25, -2.94);
  pushZPane(2.60, 1.55, -2.94);
  pushXPane(5.04, 4.25, -1.30);
  pushXPane(5.04, 1.55, -1.30);

  const geo = new StubBufferGeometry();
  geo.setAttribute('position', new StubBufferAttribute(new Float32Array(verts), 3));
  const mat = {
    emissiveIntensity: initialGlowIntensity,
    userData: { glow: true },
    clone() {
      return {
        emissiveIntensity: this.emissiveIntensity,
        userData: { ...this.userData },
        clone: this.clone,
      };
    },
  };
  const litMesh = new StubMesh(geo, mat);
  litMesh.name = 'tavern-shell:lit';
  const group = {
    traverse(fn) {
      const visit = (node) => {
        fn(node);
        for (const c of node.children || []) visit(c);
      };
      visit({ children: [litMesh] });
    },
  };
  return { group, litMesh };
}

test('inn occupancy: per-room front-upper window glow, stair window dark, any-occupancy ground/back/side', () => {
  // Missing group / missing or malformed innState -> strict no-op (returns null).
  assert.equal(updateStagingInnOccupancy(null, { lantern: { handle: 'a' }, window: null, quiet: null }), null);
  const { group, wallMesh, panes } = makeStubPaneTavernGroup(1.15);
  assert.equal(updateStagingInnOccupancy(group, undefined), null);
  assert.equal(updateStagingInnOccupancy(group, 'bad'), null);
  assert.equal(panes.lantern.material.emissiveIntensity, 1.15);
  assert.equal(wallMesh.material.emissiveIntensity, 0);

  const anyOccupancyKeys = [
    'groundFrontLeftOuter',
    'groundFrontLeftInner',
    'groundFrontRightInner',
    'groundFrontRightOuter',
    'backUpperLeft',
    'backGroundRight',
    'sideUpper',
    'sideGround',
  ];

  // One room claimed (lantern) -> only lantern front-upper + any-occupancy panes lit; window, quiet, stair stay 0.
  assert.equal(
    updateStagingInnOccupancy(group, { lantern: { handle: 'milo' }, window: null, quiet: null }),
    true
  );
  assert.equal(panes.lantern.material.emissiveIntensity, 1.15);
  assert.equal(panes.window.material.emissiveIntensity, 0);
  assert.equal(panes.quiet.material.emissiveIntensity, 0);
  assert.equal(panes.stair.material.emissiveIntensity, 0);
  for (const k of anyOccupancyKeys) {
    assert.equal(panes[k].material.emissiveIntensity, 1.15, `${k} must be lit when any room is claimed`);
  }
  assert.equal(wallMesh.material.emissiveIntensity, 0);

  // Two rooms claimed (window + quiet) -> both lit, lantern + stair dark, any-occupancy lit.
  assert.equal(
    updateStagingInnOccupancy(group, { lantern: null, window: { handle: 'wick' }, quiet: { handle: 'maren' } }),
    true
  );
  assert.equal(panes.lantern.material.emissiveIntensity, 0);
  assert.equal(panes.window.material.emissiveIntensity, 1.15);
  assert.equal(panes.quiet.material.emissiveIntensity, 1.15);
  assert.equal(panes.stair.material.emissiveIntensity, 0);
  for (const k of anyOccupancyKeys) {
    assert.equal(panes[k].material.emissiveIntensity, 1.15);
  }

  // All three claimed -> all three room panes lit, stair window still 0.
  assert.equal(
    updateStagingInnOccupancy(group, {
      lantern: { handle: 'a' },
      window: { handle: 'b' },
      quiet: { handle: 'c' },
    }),
    true
  );
  assert.equal(panes.lantern.material.emissiveIntensity, 1.15);
  assert.equal(panes.window.material.emissiveIntensity, 1.15);
  assert.equal(panes.quiet.material.emissiveIntensity, 1.15);
  assert.equal(panes.stair.material.emissiveIntensity, 0);

  // All vacant -> every pane 0.
  assert.equal(updateStagingInnOccupancy(group, { lantern: null, window: null, quiet: null }), false);
  for (const [name, pane] of Object.entries(panes)) {
    assert.equal(pane.material.emissiveIntensity, 0, `${name} must be 0 when all rooms are vacant`);
  }

  // Merged tavern-shell:lit path (real camp.light() output): splits front-upper panes into child meshes with unique materials.
  const { group: mergedGroup, litMesh } = makeMergedLitTavernGroup(1.15);
  assert.equal(
    updateStagingInnOccupancy(mergedGroup, { lantern: null, window: { handle: 'wick' }, quiet: null }),
    true
  );
  const byName = Object.fromEntries(litMesh.children.map((c) => [c.name, c]));
  assert.equal(byName['tavern-shell:lit:lantern'].material.emissiveIntensity, 0);
  assert.equal(byName['tavern-shell:lit:window'].material.emissiveIntensity, 1.15);
  assert.equal(byName['tavern-shell:lit:quiet'].material.emissiveIntensity, 0);
  assert.equal(byName['tavern-shell:lit:stair'].material.emissiveIntensity, 0);
  assert.equal(litMesh.material.emissiveIntensity, 1.15);
  assert.equal(litMesh.geometry.attributes.position.count, 8 * 6, 'rest geometry keeps 8 non-front-upper panes');
});

test('splitNightlyCallLines greedily word-wraps topics into <=30-char lines (card fit)', () => {
  const shortTopic = 'Tell us a quiet truth.';
  assert.deepEqual(splitNightlyCallLines(shortTopic), [shortTopic]);

  // The live 2026-11-14 topic (51 chars) clipped on one line at the old
  // 60-char threshold; it must wrap to two readable lines.
  const liveTopic = 'What time of dusk do the streetlights feel warmest?';
  const liveLines = splitNightlyCallLines(liveTopic);
  assert.equal(liveLines.length, 2);
  assert.equal(liveLines.join(' '), liveTopic);
  assert.ok(liveLines.every((line) => line.length <= 30));

  const longTopic = 'If you could leave one anonymous lantern lit for a stranger tonight, where would you hang it?';
  const lines = splitNightlyCallLines(longTopic);
  assert.equal(lines.length, 4);
  assert.equal(lines.join(' '), longTopic);
  assert.ok(lines.every((line) => line.length <= 30));

  const unbroken = 'a'.repeat(65);
  const hardSplit = splitNightlyCallLines(unbroken);
  assert.equal(hardSplit.length, 3);
  assert.equal(hardSplit[0].length + hardSplit[1].length + hardSplit[2].length, 65);
  assert.ok(hardSplit.every((line) => line.length <= 30));
});

test('Slice 84: splitNightlyCallLines at 22 chars wraps all 30 curated topics into <=3 lines', async () => {
  const topicsPath = path.join(REPO_ROOT, 'town-api', 'nightly-topics.json');
  const topics = JSON.parse(await fs.readFile(topicsPath, 'utf8'));
  assert.equal(topics.length, 30);
  for (const topic of topics) {
    const lines = splitNightlyCallLines(topic, 22);
    assert.ok(lines.length >= 1 && lines.length <= 3, `Expected 1..3 lines for "${topic}", got ${lines.length}`);
    assert.ok(lines.every((line) => line.length <= 22), `Line > 22 chars for "${topic}": ${JSON.stringify(lines)}`);
    assert.equal(lines.join(' '), topic, `Round-trip mismatch for "${topic}"`);
  }
});

test('Slice 94: Nightly Call card placeholder wraps at <=22 chars and uses 1024x512, titleSize 80, subSize 68, borderWidth 16', async () => {
  const placeholderLines = splitNightlyCallLines("tonight's prompt appears here", 22);
  assert.equal(placeholderLines.length, 2);
  assert.ok(placeholderLines.every((line) => line.length <= 22));
  assert.equal(placeholderLines.join(' '), "tonight's prompt appears here");

  const bandstandSrc = await fs.readFile(path.join(__dirname, 'concept-bandstand.js'), 'utf8');
  const callTexMatch = bandstandSrc.match(/const callTex = makeBandstandTextTexture\([\s\S]*?\}\s*\);/);
  assert.ok(callTexMatch, 'Expected callTex makeBandstandTextTexture call in concept-bandstand.js');
  assert.match(callTexMatch[0], /splitNightlyCallLines\([^)]*,\s*22\s*\)/);
  assert.match(callTexMatch[0], /width:\s*1024\b/);
  assert.match(callTexMatch[0], /height:\s*512\b/);
  assert.match(callTexMatch[0], /titleSize:\s*80\b/);
  assert.match(callTexMatch[0], /subSize:\s*68\b/);
  assert.match(callTexMatch[0], /borderWidth:\s*16\b/);
});

test('Slice 94: makeBandstandTextTexture supports optional borderWidth (default 8) and scales strokeRect', async () => {
  const bandstandSrc = await fs.readFile(path.join(__dirname, 'concept-bandstand.js'), 'utf8');
  const builderMatch = bandstandSrc.match(/export function makeBandstandTextTexture\([\s\S]*?\n\}/);
  assert.ok(builderMatch, 'Expected makeBandstandTextTexture in concept-bandstand.js');
  const body = builderMatch[0];
  assert.match(body, /const borderWidth\s*=\s*opts\.borderWidth\s*\|\|\s*8;/);
  assert.match(body, /ctx\.lineWidth\s*=\s*borderWidth;/);
  assert.match(body, /ctx\.strokeRect\(\s*borderWidth\s*,\s*borderWidth\s*,\s*width\s*-\s*2\s*\*\s*borderWidth\s*,\s*height\s*-\s*2\s*\*\s*borderWidth\s*\)/);

  // Verify default (8) and explicit (16) arithmetic + event-banner placeholder omits borderWidth
  const computeStroke = (bw, width, height) => [bw, bw, width - 2 * bw, height - 2 * bw];
  assert.deepEqual(computeStroke(undefined || 8, 512, 256), [8, 8, 496, 240]);
  assert.deepEqual(computeStroke(16 || 8, 1024, 512), [16, 16, 992, 480]);

  const bannerMatch = bandstandSrc.match(/const eventBannerTex = makeBandstandTextTexture\([\s\S]*?\}\s*\);/);
  assert.ok(bannerMatch, 'Expected eventBannerTex in concept-bandstand.js');
  assert.doesNotMatch(bannerMatch[0], /borderWidth/);
});

test('updateStagingNightlyCallCard redraws on topic change, caches, and no-ops on invalid/unchanged/missing card', () => {
  const calls = [];
  const makeTextTexture = (THREE, lines, opts) => {
    const tex = { THREE, lines, opts };
    calls.push({ lines, opts });
    return tex;
  };
  const fakeTHREE = { CanvasTexture: function FakeTex() {} };
  const initialMap = { initial: true };
  const card = {
    name: 'nightly_call_card',
    material: { map: initialMap, needsUpdate: false },
  };
  const bandstandBuilt = { group: { children: [card] } };
  const liveStore = { nightlyCallTopic: null };

  // Missing / malformed nightly_call -> no-op
  assert.equal(
    updateStagingNightlyCallCard({ THREE: fakeTHREE, bandstandBuilt, liveStore, makeTextTexture }, undefined),
    false
  );
  assert.equal(
    updateStagingNightlyCallCard({ THREE: fakeTHREE, bandstandBuilt, liveStore, makeTextTexture }, { date: '2026-11-14', topic: '   ' }),
    false
  );
  assert.equal(calls.length, 0);
  assert.equal(card.material.map, initialMap);

  // Missing card -> no-op
  assert.equal(
    updateStagingNightlyCallCard(
      { THREE: fakeTHREE, bandstandBuilt: { group: { children: [] } }, liveStore, makeTextTexture },
      { date: '2026-11-14', topic: 'First topic' }
    ),
    false
  );
  assert.equal(calls.length, 0);

  // Valid topic -> redraws with exact card params
  assert.equal(
    updateStagingNightlyCallCard(
      { THREE: fakeTHREE, bandstandBuilt, liveStore, makeTextTexture },
      { date: '2026-11-14', topic: '  Tell us a quiet truth.  ' }
    ),
    true
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].lines, ['THE NIGHTLY CALL', 'Tell us a quiet truth.']);
  assert.deepEqual(calls[0].opts, {
    width: 1024,
    height: 512,
    titleSize: 80,
    subSize: 68,
    borderWidth: 16,
    bg: '#f2e6cf',
    border: '#b59449',
    fg: '#2b1e14',
  });
  assert.equal(card.material.needsUpdate, true);
  assert.equal(liveStore.nightlyCallTopic, 'Tell us a quiet truth.');

  // Unchanged topic -> no redraw
  card.material.needsUpdate = false;
  assert.equal(
    updateStagingNightlyCallCard(
      { THREE: fakeTHREE, bandstandBuilt, liveStore, makeTextTexture },
      { date: '2026-11-14', topic: 'Tell us a quiet truth.' }
    ),
    false
  );
  assert.equal(calls.length, 1);
  assert.equal(card.material.needsUpdate, false);

  // New 74-char topic -> redraws with 4 greedily wrapped <=22-char lines
  const longTopic = 'What small thing in Ghostlight Town made you pause and look twice tonight?';
  assert.equal(
    updateStagingNightlyCallCard(
      { THREE: fakeTHREE, bandstandBuilt, liveStore, makeTextTexture },
      { date: '2026-11-15', topic: longTopic }
    ),
    true
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].lines[0], 'THE NIGHTLY CALL');
  assert.equal(calls[1].lines.length, 5);
  assert.equal(calls[1].lines.slice(1).join(' '), longTopic);
  assert.ok(calls[1].lines.slice(1).every((line) => line.length <= 22));
});

test('staging.js wires tap-to-glide, multi-pointer suppression, ground raycast, and glide cancel paths', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  assert.match(src, /createPointerTracker\s*\(\s*\{\s*dragThreshold:\s*4\s*\}\s*\)/);
  assert.match(src, /deriveGlideMaxRadius\s*\(\s*camp\.terrain\?\.userData\?\.terrain\s*\)/);
  assert.match(src, /camp\?\.terrain\?\.getObjectByName\s*\(\s*['"]ground['"]\s*\)/);
  assert.match(src, /function setGlideTargetFromTap\s*\(/);
  assert.match(src, /e\.pointerType === ['"]touch['"]/);
  assert.match(src, /stepOrbitGlide\s*\(/);
  assert.match(src, /window\.addEventListener\s*\(\s*['"]pointercancel['"]/);
  assert.match(src, /function onBeforeOverlayOpen\s*\(\)\s*\{[\s\S]*?glideTarget\s*=\s*null;/);
});

test('applyStagingPlotManifest wires attachPlotProps with manifest.props after signpost add', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function applyStagingPlotManifest(');
  assert.ok(fnStart !== -1, 'Expected applyStagingPlotManifest in staging.js');
  const fnEnd = src.indexOf('\n  assignment.cottage = cottage;', fnStart);
  assert.ok(fnEnd !== -1, 'Expected assignment.cottage = cottage; in applyStagingPlotManifest');
  const fnBody = src.slice(fnStart, fnEnd);

  const signAddIdx = fnBody.indexOf('cottage.add(sign);');
  const propsCallIdx = fnBody.indexOf('attachPlotProps(THREE, cottage, Array.isArray(manifest.props) ? manifest.props : []);');
  assert.ok(signAddIdx !== -1, 'Expected cottage.add(sign); in applyStagingPlotManifest');
  assert.ok(propsCallIdx !== -1, 'Expected attachPlotProps(THREE, cottage, Array.isArray(manifest.props) ? manifest.props : []); in applyStagingPlotManifest');
  assert.ok(propsCallIdx > signAddIdx, 'attachPlotProps must be called after cottage.add(sign)');
});

test('Slice 78: staging.js builds town notice board with byte-identical notice texts, pad (-198, 398), keepClear [-6, 14, 5], and makeBandstandTextTexture', async () => {
  const [stagingSrc, townSrc] = await Promise.all([
    fs.readFile(STAGING_JS_PATH, 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
  ]);

  assert.match(stagingSrc, /function\s+buildNoticeBoard\s*\(\s*THREE\s*\)/, 'staging.js must define buildNoticeBoard(THREE)');
  assert.match(stagingSrc, /\{\s*x:\s*-198\s*,\s*z:\s*398\s*,\s*w:\s*4\s*,\s*d:\s*4\s*\}/, 'staging.js pads must include { x: -198, z: 398, w: 4, d: 4 }');
  assert.match(stagingSrc, /\[\s*-6\s*,\s*14\s*,\s*5\s*\]/, 'staging.js keepClear must include [-6, 14, 5]');
  assert.ok(!/\bmakeTextTexture\s*\(/.test(stagingSrc), 'staging.js must not call makeTextTexture(');

  const stagingPapers = stagingSrc.match(/const NOTICE_BOARD_PAPERS = \[[\s\S]*?\];/);
  const townPapers = townSrc.match(/const NOTICE_BOARD_PAPERS = \[[\s\S]*?\];/);
  assert.ok(stagingPapers, 'staging.js must define NOTICE_BOARD_PAPERS');
  assert.ok(townPapers, 'town.js must define NOTICE_BOARD_PAPERS');
  assert.equal(stagingPapers[0], townPapers[0], 'NOTICE_BOARD_PAPERS in staging.js must be byte-identical to town.js');

  const boardFnStart = stagingSrc.indexOf('function buildNoticeBoard(');
  const boardFnEnd = stagingSrc.indexOf('\nfunction ', boardFnStart + 1);
  const boardFnBody = stagingSrc.slice(boardFnStart, boardFnEnd === -1 ? undefined : boardFnEnd);
  assert.match(boardFnBody, /makeBandstandTextTexture\s*\(/, 'buildNoticeBoard in staging.js must use makeBandstandTextTexture');
});

test('Slice 79: staging.js makes town notice board clickable and wires openNoticeBoardOverlay', async () => {
  const stagingSrc = await fs.readFile(STAGING_JS_PATH, 'utf8');

  assert.match(
    stagingSrc,
    /import\s*\{\s*openNoticeBoardOverlay\s*\}\s*from\s*['"]\.\/notice-board-overlay\.mjs['"]\s*;/,
    'staging.js must import openNoticeBoardOverlay from ./notice-board-overlay.mjs'
  );
  assert.match(
    stagingSrc,
    /if\s*\(\s*kind\s*===\s*['"]notice_board['"]\s*\)[\s\S]*?openNoticeBoardOverlay\s*\(/,
    'staging.js handleCanvasClick must handle kind === notice_board via openNoticeBoardOverlay'
  );

  const boardFnStart = stagingSrc.indexOf('function buildNoticeBoard(');
  const boardFnEnd = stagingSrc.indexOf('\nfunction ', boardFnStart + 1);
  const boardFnBody = stagingSrc.slice(boardFnStart, boardFnEnd === -1 ? undefined : boardFnEnd);
  assert.match(
    boardFnBody,
    /group\.userData\s*=\s*\{\s*clickable:\s*true\s*,\s*kind:\s*['"]notice_board['"]\s*,\s*label:\s*['"]Notice Board['"]\s*\}/,
    'buildNoticeBoard in staging.js must set clickable notice_board userData'
  );
});

test('Slice 80: staging.js wires event banner, index.html has #prompt-book-event, and concept-bandstand.js builds hidden event_banner', async () => {
  const [stagingSrc, html, bandstandSrc] = await Promise.all([
    fs.readFile(STAGING_JS_PATH, 'utf8'),
    fs.readFile(INDEX_HTML_PATH, 'utf8'),
    fs.readFile(path.join(__dirname, 'concept-bandstand.js'), 'utf8'),
  ]);

  assert.match(
    stagingSrc,
    /import\s*\{[\s\S]*?\bloadEvents\b[\s\S]*?\bupdateEventBanner\b[\s\S]*?\}\s*from\s*['"]\.\/event-banner\.mjs['"]\s*;/,
    'staging.js must import loadEvents and updateEventBanner from ./event-banner.mjs'
  );
  assert.match(stagingSrc, /\bloadEvents\s*\(/, 'staging.js must call loadEvents()');
  assert.match(
    stagingSrc,
    /function\s+applyStagingState\s*\([\s\S]*?\bupdateEventBanner\s*\(/,
    'staging.js applyStagingState must call updateEventBanner()'
  );
  assert.match(html, /id=["']prompt-book-event["']\s+hidden/, 'index.html must include #prompt-book-event hidden');
  assert.match(bandstandSrc, /eventBanner\.name\s*=\s*['"]event_banner['"]/, 'concept-bandstand.js must name event_banner');
  assert.match(bandstandSrc, /eventBanner\.visible\s*=\s*false/, 'concept-bandstand.js must start event_banner hidden');
});

function makeFakeFootlightSlot(slot = 1) {
  return {
    userData: {
      slot,
      shell: {
        material: {
          color: '#7a6230',
          emissive: '#000000',
          emissiveIntensity: 0,
        },
      },
      placard: {
        rotation: { x: 0 },
        position: { y: 0.06 },
        material: {
          map: null,
          color: '#4d301c',
          needsUpdate: false,
        },
      },
      lit: false,
      handle: null,
      role: null,
      statusText: null,
    },
  };
}

function withRecordingCanvas(fn) {
  const prevDoc = globalThis.document;
  const draws = [];
  const fakeTHREE = {
    CanvasTexture: function FakeCanvasTexture(canvas) {
      this.image = canvas;
    },
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const ctx = {
        font: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        textAlign: 'left',
        textBaseline: 'alphabetic',
        fillRect() {},
        strokeRect() {},
        fillText(text, x, y) {
          draws.push({ text, x, y, font: ctx.font, width: canvas.width, height: canvas.height });
        },
      };
      const canvas = { width: 0, height: 0, getContext: () => ctx };
      return canvas;
    },
  };
  try {
    return fn({ fakeTHREE, draws });
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
}

test('Slice 82: lightFootlightSlot renders handle-only placard unchanged when statusText is absent or empty', () => {
  withRecordingCanvas(({ fakeTHREE, draws }) => {
    const fl = makeFakeFootlightSlot(1);
    lightFootlightSlot(fakeTHREE, fl, { handle: 'wick', role: 'npc' });

    assert.equal(fl.userData.lit, true);
    assert.equal(fl.userData.handle, 'wick');
    assert.equal(fl.userData.role, 'npc');
    assert.equal(fl.userData.statusText, null);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].text, 'wick');
    assert.equal(draws[0].font, 'bold 28px monospace');
    assert.equal(draws[0].width, 256);
    assert.equal(draws[0].height, 96);

    draws.length = 0;
    lightFootlightSlot(fakeTHREE, fl, { handle: 'wick', role: 'npc', statusText: '' });
    assert.equal(fl.userData.statusText, null);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].text, 'wick');
    assert.equal(draws[0].font, 'bold 28px monospace');

    draws.length = 0;
    lightFootlightSlot(fakeTHREE, fl, { handle: 'wick', role: 'npc', statusText: '   ' });
    assert.equal(fl.userData.statusText, null);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].font, 'bold 28px monospace');
  });
});

test('Slice 82: lightFootlightSlot wraps statusText with smaller subSize, updates on change, and truncates 120-char status with ellipsis', () => {
  withRecordingCanvas(({ fakeTHREE, draws }) => {
    const fl = makeFakeFootlightSlot(2);
    lightFootlightSlot(fakeTHREE, fl, {
      handle: 'maren',
      role: 'npc',
      statusText: 'Listening by the gatehouse',
    });

    assert.equal(fl.userData.statusText, 'Listening by the gatehouse');
    assert.equal(draws.length, 3);
    assert.equal(draws[0].text, 'maren');
    assert.equal(draws[0].font, 'bold 22px monospace');
    assert.equal(draws[1].font, 'bold 16px monospace');
    assert.equal(draws[2].font, 'bold 16px monospace');
    assert.ok(draws[1].text.length <= 20);
    assert.ok(draws[2].text.length <= 20);
    assert.equal(`${draws[1].text} ${draws[2].text}`, 'Listening by the gatehouse');

    // Changing statusText updates an already-lit slot.
    draws.length = 0;
    lightFootlightSlot(fakeTHREE, fl, {
      handle: 'maren',
      role: 'npc',
      statusText: 'Quiet tea',
    });
    assert.equal(fl.userData.statusText, 'Quiet tea');
    assert.equal(draws.length, 2);
    assert.equal(draws[0].text, 'maren');
    assert.equal(draws[1].text, 'Quiet tea');
    assert.equal(draws[1].font, 'bold 16px monospace');

    // 120-char status wraps to at most 2 status lines (3 total) and truncates with ellipsis.
    draws.length = 0;
    const longStatus = 'Reading old letters beside the warm lantern while the night wind moves across the quiet town square and cobbles';
    assert.ok(longStatus.length <= 120 && longStatus.length > 80);
    lightFootlightSlot(fakeTHREE, fl, {
      handle: 'maren',
      role: 'npc',
      statusText: longStatus,
    });
    assert.equal(draws.length, 3, '120-char status must cap at 1 handle + 2 status lines');
    assert.equal(draws[0].text, 'maren');
    assert.ok(draws[1].text.length <= 20);
    assert.ok(draws[2].text.length <= 20);
    assert.ok(draws[2].text.endsWith('…'), 'truncated status must end with ellipsis');
  });
});

test('Slice 82: staging.js passes row.status_text, re-lights on status change, and clears statusText on unlight', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function applyStagingState(');
  assert.ok(fnStart !== -1, 'Expected applyStagingState in staging.js');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  assert.match(fnBody, /row\.status_text/, 'applyStagingState must read row.status_text');
  assert.match(fnBody, /flGroup\.userData\.statusText/, 'applyStagingState must check/clear flGroup.userData.statusText');
  assert.match(
    fnBody,
    /lightFootlightSlot\s*\(\s*THREE\s*,\s*flGroup\s*,\s*\{\s*handle\s*,\s*role\s*,\s*statusText:/,
    'applyStagingState must pass statusText to lightFootlightSlot'
  );
  assert.match(
    fnBody,
    /flGroup\.userData\.statusText\s*=\s*null\s*;/,
    'applyStagingState unlit branch must clear flGroup.userData.statusText = null'
  );
});

test('Slice 83: applyStagingPresence passes footlight status_text to avatar nametag and clears back to badge-only', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function applyStagingPresence(');
  assert.ok(fnStart !== -1, 'Expected applyStagingPresence in staging.js');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  const buildApplyPresence = new Function(
    'THREE',
    'scene',
    'camp',
    'TOWN_LAYOUT',
    'createAvatarCapsule',
    'setAvatarStatusText',
    'getPlotTargetPosition',
    'pickBandstandSpot',
    `${fnBody}\nreturn applyStagingPresence;`
  );

  withRecordingCanvas(({ fakeTHREE, draws }) => {
    fakeTHREE.Group = class Group {
      constructor() {
        this.name = '';
        this.children = [];
        this.userData = {};
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
        this.rotation = { x: 0, y: 0, z: 0 };
      }
      add(c) { this.children.push(c); }
      removeFromParent() {}
    };
    fakeTHREE.MeshStandardMaterial = class MeshStandardMaterial { constructor(o = {}) { Object.assign(this, o); } };
    fakeTHREE.SpriteMaterial = class SpriteMaterial { constructor(o = {}) { Object.assign(this, o); } };
    fakeTHREE.Mesh = class Mesh { constructor(g, m) { this.geometry = g; this.material = m; this.position = { set() {} }; } };
    fakeTHREE.Sprite = class Sprite {
      constructor(m) {
        this.material = m;
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
        this.scale = { x: 1, y: 1, z: 1, set: (x, y, z) => { this.scale.x = x; this.scale.y = y; this.scale.z = z; } };
      }
    };
    fakeTHREE.CylinderGeometry = class CylinderGeometry {};
    fakeTHREE.SphereGeometry = class SphereGeometry {};

    const scene = { children: [], add(obj) { this.children.push(obj); } };
    const camp = { groundAt: () => 0 };
    const applyStagingPresence = buildApplyPresence(
      fakeTHREE,
      scene,
      camp,
      TOWN_LAYOUT,
      createAvatarCapsule,
      setAvatarStatusText,
      getPlotTargetPosition,
      pickBandstandSpot
    );

    const liveStore = { avatars: new Map(), plotAssignments: new Map() };
    const bandstandBuilt = {
      avatarSpots: [{ x: 1, y: 0.6, z: 1, rotY: 0 }, { x: 2, y: 0.6, z: 2, rotY: 0 }],
    };
    const footlightSlotByHandle = new Map([['wick', 1]]);

    // 1. Lit footlight with status_text sets 2-line nametag; milo is filtered out.
    draws.length = 0;
    applyStagingPresence(liveStore, bandstandBuilt, null, footlightSlotByHandle, {
      presence: [
        { handle: 'milo', role: 'muse', zone: 'bandstand' },
        { handle: 'wick', role: 'npc', zone: 'bandstand' },
        { handle: 'sol', role: 'muse', zone: 'gate' },
      ],
      footlights: [
        { handle: 'wick', slot: 1, status_text: 'Evening lanterns' },
      ],
    });

    assert.equal(liveStore.avatars.has('milo'), false);
    const wick = liveStore.avatars.get('wick');
    const sol = liveStore.avatars.get('sol');
    assert.equal(wick.userData.statusText, 'Evening lanterns');
    assert.equal(wick.userData.nametagSprite.scale.y, 0.5625);
    assert.ok(draws.some((d) => d.text === 'Evening lanterns' && d.width === 384 && d.height === 144));
    assert.equal(sol.userData.statusText, null);
    assert.equal(sol.userData.nametagSprite.scale.y, 0.375);

    // 2. Footlight unlights (or status_text disappears) -> restores badge-only.
    draws.length = 0;
    applyStagingPresence(liveStore, bandstandBuilt, null, new Map(), {
      presence: [
        { handle: 'wick', role: 'npc', zone: 'bandstand' },
        { handle: 'sol', role: 'muse', zone: 'gate' },
      ],
      footlights: [],
    });

    assert.equal(wick.userData.statusText, null);
    assert.equal(wick.userData.nametagSprite.scale.y, 0.375);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].text, '[NPC] wick');
    assert.equal(draws[0].width, 384);
    assert.equal(draws[0].height, 96);
  });
});

test('Slice 87: staging.js wires interior look-drag, finishPointer tracker-first door-ray exit, and updated status copy', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.match(codeOnly, /\blet\s+interiorLook\s*=\s*null\b/, 'staging.js must declare interiorLook state');
  assert.match(
    codeOnly,
    /pointerdown[\s\S]*?pointerTracker\.onPointerDown[\s\S]*?interiorVisit\.isInside\(\)[\s\S]*?interiorLook\s*=\s*\{\s*id:\s*e\.pointerId/,
    'pointerdown must start interiorLook when inside'
  );
  assert.match(
    codeOnly,
    /pointermove[\s\S]*?pointerTracker\.onPointerMove[\s\S]*?interiorVisit\.isInside\(\)[\s\S]*?interiorVisit\.lookBy\(/,
    'pointermove must call interiorVisit.lookBy when dragging inside'
  );

  const finishMatch = codeOnly.match(/function\s+finishPointer\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(finishMatch, 'staging.js must define finishPointer');
  const finishBody = finishMatch[0];
  const trackerIdx = finishBody.indexOf('pointerTracker.onPointerUp');
  const insideIdx = finishBody.indexOf('interiorVisit.isInside()');
  assert.ok(trackerIdx !== -1 && insideIdx !== -1 && trackerIdx < insideIdx, 'finishPointer must run pointerTracker.onPointerUp before interiorVisit.isInside()');
  assert.match(
    finishBody,
    /interiorVisit\.isInside\(\)[\s\S]*?rayHitsInteriorDoor\(\s*interiorRoom\s*,\s*raycaster\.ray\.origin\s*,\s*raycaster\.ray\.direction\s*\)[\s\S]*?exitCottageInterior\(\)/,
    'finishPointer must test rayHitsInteriorDoor and call exitCottageInterior when inside'
  );

  assert.match(
    codeOnly,
    /Inside\s+\$\{handle\}'s cottage\s+—\s+drag to look around,\s+tap the door to step out \(or Esc\)/,
    'enterCottageInterior status text must mention looking around and tapping the door'
  );
});

test('Slice 88: staging.js wires setDressing: setInteriorDressing into createInteriorVisit', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.match(
    codeOnly,
    /createInteriorVisit\s*\(\s*\{[\s\S]*?setDressing\s*:\s*setInteriorDressing\b/,
    'staging.js must pass setDressing: setInteriorDressing to createInteriorVisit'
  );
});

test('Slice 90: index.html has plot-overlay tabs with 44px mobile tap targets and staging.js wires guestbook tab + hides tabs in non-plot openers', async () => {
  const [html, src] = await Promise.all([
    fs.readFile(INDEX_HTML_PATH, 'utf8'),
    fs.readFile(STAGING_JS_PATH, 'utf8'),
  ]);
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.match(html, /id=["']plot-overlay-tabs["'][^>]*\bhidden\b/, 'index.html must include hidden #plot-overlay-tabs');
  assert.match(html, /id=["']plot-overlay-tab-note["']/, 'index.html must include #plot-overlay-tab-note');
  assert.match(html, /id=["']plot-overlay-tab-guestbook["']/, 'index.html must include #plot-overlay-tab-guestbook');
  const mediaMatch = html.match(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?#plot-overlay-tabs\s+button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.ok(mediaMatch, 'index.html @media (max-width: 640px) must set min-height: 44px on #plot-overlay-tabs button');

  assert.match(
    codeOnly,
    /plotOverlayTabGuestbookEl\?\.\s*addEventListener\s*\(\s*['"]click['"][\s\S]*?openPlotGuestbookOverlay\s*\(/,
    'staging.js must wire guestbook tab click to openPlotGuestbookOverlay'
  );
  for (const kind of ['newsstand', 'notice_board', 'inn', 'gate']) {
    const branchRe = new RegExp(`kind === '${kind}'\\)[\\s\\S]*?setPlotTabs\\(null\\)`);
    assert.match(codeOnly, branchRe, `staging.js ${kind} opener must call setPlotTabs(null)`);
  }
});

test('Nov 23 hotfix: plot-overlay tab handlers must not reference liveStore (module scope), and onState must refresh garden plants', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // liveStore is created inside init(); the tab handlers are registered at
  // module scope, so a liveStore reference there throws ReferenceError and
  // the click silently does nothing (both tabs were dead in the ?v=40 bundle).
  for (const el of ['plotOverlayTabNoteEl', 'plotOverlayTabGuestbookEl']) {
    const handlerRe = new RegExp(
      `${el}\\?\\.\\s*addEventListener\\s*\\(\\s*['"]click['"][\\s\\S]*?\\n\\}\\);`
    );
    const handler = codeOnly.match(handlerRe);
    assert.ok(handler, `staging.js must wire ${el} click handler`);
    assert.ok(
      !handler[0].includes('liveStore'),
      `${el} click handler must not reference liveStore (module scope has none)`
    );
  }

  // The bed is built once with empty slots; without this call no plant ever
  // renders (the moonflower was in API state but invisible in 3D).
  assert.match(
    codeOnly,
    /import\s*\{\s*GARDEN_BED\s*,\s*buildGardenBed\s*,\s*updateGardenBed\s*\}\s*from\s*['"]\.\/garden\.mjs\?v=40['"]/,
    'staging.js must import updateGardenBed from garden.mjs'
  );
  assert.match(
    codeOnly,
    /onState:\s*\(state\)\s*=>\s*\{[\s\S]*?updateGardenBed\s*\(\s*THREE\s*,\s*gardenBed\s*,\s*state\.garden\s*\)/,
    'staging.js onState must call updateGardenBed(THREE, gardenBed, state.garden)'
  );
});

test('Slice 92: index.html includes #info-strip and staging.js wires empty-pad markers and open_plot click', async () => {
  const [html, src] = await Promise.all([
    fs.readFile(INDEX_HTML_PATH, 'utf8'),
    fs.readFile(STAGING_JS_PATH, 'utf8'),
  ]);
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.match(html, /id=["']info-strip["'][^>]*\bhidden\b/, 'index.html must include hidden #info-strip');
  assert.match(codeOnly, /emptyPadMarkers:\s*new Map\(\)/, 'createStagingLiveStore must initialize emptyPadMarkers');
  assert.match(
    codeOnly,
    /createStagingLiveStore\(\)[\s\S]*?syncEmptyPadMarkers\s*\(\s*scene\s*,\s*liveStore\b/,
    'staging.js must call syncEmptyPadMarkers at startup'
  );
  assert.match(
    codeOnly,
    /syncStagingPlotsFromState\s*\([\s\S]*?\)\.then\s*\([\s\S]*?syncEmptyPadMarkers\s*\(\s*scene\s*,\s*liveStore\b/,
    'staging.js must reconcile empty-pad markers in syncStagingPlotsFromState(...).then(...)'
  );
  assert.match(
    codeOnly,
    /kind === 'open_plot'[\s\S]*?infoStripEl\.textContent\s*=\s*`OPEN PLOT #\$\{target\.userData\.plotNumber\} — no resident yet`[\s\S]*?infoStripEl\.hidden\s*=\s*false/,
    'staging.js handleCanvasClick must handle kind === open_plot and show #info-strip'
  );
  for (const kind of ['cottage', 'newsstand', 'notice_board', 'inn', 'gate']) {
    const branchRe = new RegExp(`kind === '${kind}'[\\s\\S]*?infoStripEl\\.hidden = true`);
    assert.match(codeOnly, branchRe, `staging.js ${kind} click branch must hide #info-strip`);
  }
});

test('createStagingLiveStore returns fresh Maps, nulls, and empty events on every call', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function createStagingLiveStore() {');
  assert.ok(fnStart !== -1, 'Expected createStagingLiveStore in staging.js');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  const createStagingLiveStore = new Function(`${fnBody}\nreturn createStagingLiveStore;`)();
  const a = createStagingLiveStore();
  const b = createStagingLiveStore();

  for (const store of [a, b]) {
    assert.ok(store.avatars instanceof Map);
    assert.ok(store.plotAssignments instanceof Map);
    assert.ok(store.plotCache instanceof Map);
    assert.ok(store.emptyPadMarkers instanceof Map);
    assert.equal(store.lastState, null);
    assert.equal(store.nightlyCallTopic, null);
    assert.deepEqual(store.events, []);
    assert.equal(store.eventBannerKey, null);
  }

  assert.notEqual(a.events, b.events);
  a.avatars.set('x', 1);
  assert.equal(b.avatars.has('x'), false);
});

test('applyStagingPlotManifest guards return null for milo, missing handle, and non-object manifest', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function applyStagingPlotManifest(');
  assert.ok(fnStart !== -1, 'Expected applyStagingPlotManifest in staging.js');
  const fnEnd = src.indexOf('\nasync function syncStagingPlotsFromState(', fnStart + 1);
  assert.ok(fnEnd !== -1, 'Expected syncStagingPlotsFromState after applyStagingPlotManifest');
  const fnBody = src.slice(fnStart, fnEnd);

  const buildApplyPlotManifest = new Function(
    'THREE',
    'TOWN_LAYOUT',
    'SEED_HOME_PADS',
    'RESERVED_SEED_PADS',
    'place',
    'buildStagingSignpost',
    'attachPorchDeck',
    'attachPorchTrim',
    'attachPlotProps',
    'attachSeedDoorProp',
    `${fnBody}\nreturn applyStagingPlotManifest;`
  );
  const applyStagingPlotManifest = buildApplyPlotManifest(
    {},
    TOWN_LAYOUT,
    SEED_HOME_PADS,
    new Set(Object.values(SEED_HOME_PADS)),
    () => {
      throw new Error('place must not be called for guard cases');
    },
    () => {},
    () => {},
    () => {},
    () => {},
    () => {}
  );

  const store = { plotAssignments: new Map() };
  assert.equal(applyStagingPlotManifest(store, null, {}), null);
  assert.equal(applyStagingPlotManifest(store, '', {}), null);
  assert.equal(applyStagingPlotManifest(store, 'milo', {}), null);
  assert.equal(applyStagingPlotManifest(store, 'wick', null), null);
  assert.equal(applyStagingPlotManifest(store, 'wick', 'nope'), null);
  assert.equal(applyStagingPlotManifest(store, 'wick', 42), null);
  assert.equal(store.plotAssignments.size, 0);
});

test('syncStagingPlotsFromState discovers handles from plots, footlights, presence, and Prompt Book, drops milo, and sorts seeds first', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  assert.ok(
    src.includes('const statePlots = state?.plots && typeof state.plots === \'object\' ? state.plots : null;'),
    'syncStagingPlotsFromState must guard state.plots'
  );
  assert.ok(
    src.includes('for (const row of state?.footlights || []) if (row?.handle) found.add(row.handle);'),
    'syncStagingPlotsFromState must discover handles from footlights'
  );
  assert.ok(
    src.includes('for (const row of state?.presence || []) if (row?.handle) found.add(row.handle);'),
    'syncStagingPlotsFromState must discover handles from presence'
  );
  assert.ok(
    src.includes('for (const row of state?.prompt_book || []) if (row?.handle) found.add(row.handle);'),
    'syncStagingPlotsFromState must discover handles from prompt_book'
  );
  assert.ok(
    src.includes('found.delete(\'milo\');'),
    'syncStagingPlotsFromState must drop milo'
  );
  assert.ok(
    src.includes('if (aSeed !== bSeed) return aSeed ? -1 : 1;'),
    'syncStagingPlotsFromState must sort seeds first'
  );
});

test('applyStagingPresence places gate avatars in a 5-wide row facing the town, wrapping to a second row', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function applyStagingPresence(');
  assert.ok(fnStart !== -1, 'Expected applyStagingPresence in staging.js');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  const buildApplyPresence = new Function(
    'THREE',
    'scene',
    'camp',
    'TOWN_LAYOUT',
    'createAvatarCapsule',
    'setAvatarStatusText',
    'getPlotTargetPosition',
    'pickBandstandSpot',
    `${fnBody}\nreturn applyStagingPresence;`
  );

  withRecordingCanvas(({ fakeTHREE }) => {
    fakeTHREE.Group = class Group {
      constructor() {
        this.name = '';
        this.children = [];
        this.userData = {};
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
        this.rotation = { x: 0, y: 0, z: 0 };
      }
      add(c) { this.children.push(c); }
      removeFromParent() {}
    };
    fakeTHREE.MeshStandardMaterial = class MeshStandardMaterial { constructor(o = {}) { Object.assign(this, o); } };
    fakeTHREE.SpriteMaterial = class SpriteMaterial { constructor(o = {}) { Object.assign(this, o); } };
    fakeTHREE.Mesh = class Mesh { constructor(g, m) { this.geometry = g; this.material = m; this.position = { set() {} }; } };
    fakeTHREE.Sprite = class Sprite {
      constructor(m) {
        this.material = m;
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
        this.scale = { x: 1, y: 1, z: 1, set: (x, y, z) => { this.scale.x = x; this.scale.y = y; this.scale.z = z; } };
      }
    };
    fakeTHREE.CylinderGeometry = class CylinderGeometry {};
    fakeTHREE.SphereGeometry = class SphereGeometry {};

    const scene = { children: [], add(obj) { this.children.push(obj); } };
    const camp = { groundAt: () => 0 };
    const applyStagingPresence = buildApplyPresence(
      fakeTHREE,
      scene,
      camp,
      TOWN_LAYOUT,
      createAvatarCapsule,
      setAvatarStatusText,
      getPlotTargetPosition,
      pickBandstandSpot
    );

    const liveStore = { avatars: new Map(), plotAssignments: new Map() };
    const bandstandBuilt = {
      avatarSpots: [{ x: 1, y: 0.6, z: 1, rotY: 0 }, { x: 2, y: 0.6, z: 2, rotY: 0 }],
    };

    applyStagingPresence(liveStore, bandstandBuilt, null, new Map(), {
      presence: [
        { handle: 'a', role: 'muse', zone: 'gate' },
        { handle: 'b', role: 'muse', zone: 'gate' },
        { handle: 'c', role: 'muse', zone: 'gate' },
        { handle: 'd', role: 'muse', zone: 'gate' },
        { handle: 'e', role: 'muse', zone: 'gate' },
        { handle: 'f', role: 'muse', zone: 'gate' },
      ],
      footlights: [],
    });

    assert.deepEqual(liveStore.avatars.get('a').userData.target, {
      x: -2.2,
      y: 0,
      z: 24.8,
      rotY: Math.PI,
      nametagLift: 0,
    });
    assert.deepEqual(liveStore.avatars.get('b').userData.target, {
      x: -1.1,
      y: 0,
      z: 24.8,
      rotY: Math.PI,
      nametagLift: 0.5,
    });
    assert.deepEqual(liveStore.avatars.get('c').userData.target, {
      x: 0,
      y: 0,
      z: 24.8,
      rotY: Math.PI,
      nametagLift: 0,
    });
    assert.deepEqual(liveStore.avatars.get('d').userData.target, {
      x: 1.1,
      y: 0,
      z: 24.8,
      rotY: Math.PI,
      nametagLift: 0.5,
    });
    assert.deepEqual(liveStore.avatars.get('e').userData.target, {
      x: 2.2,
      y: 0,
      z: 24.8,
      rotY: Math.PI,
      nametagLift: 0,
    });
    assert.deepEqual(liveStore.avatars.get('f').userData.target, {
      x: -2.2,
      y: 0,
      z: 23.8,
      rotY: Math.PI,
      nametagLift: 0.5,
    });
  });
});

test('applyStagingPresence targets plot:milo at Milo\'s plot front and plot:unknown at a bandstand spot', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function applyStagingPresence(');
  assert.ok(fnStart !== -1, 'Expected applyStagingPresence in staging.js');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  const buildApplyPresence = new Function(
    'THREE',
    'scene',
    'camp',
    'TOWN_LAYOUT',
    'createAvatarCapsule',
    'setAvatarStatusText',
    'getPlotTargetPosition',
    'pickBandstandSpot',
    `${fnBody}\nreturn applyStagingPresence;`
  );

  withRecordingCanvas(({ fakeTHREE }) => {
    fakeTHREE.Group = class Group {
      constructor() {
        this.name = '';
        this.children = [];
        this.userData = {};
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
        this.rotation = { x: 0, y: 0, z: 0 };
      }
      add(c) { this.children.push(c); }
      removeFromParent() {}
    };
    fakeTHREE.MeshStandardMaterial = class MeshStandardMaterial { constructor(o = {}) { Object.assign(this, o); } };
    fakeTHREE.SpriteMaterial = class SpriteMaterial { constructor(o = {}) { Object.assign(this, o); } };
    fakeTHREE.Mesh = class Mesh { constructor(g, m) { this.geometry = g; this.material = m; this.position = { set() {} }; } };
    fakeTHREE.Sprite = class Sprite {
      constructor(m) {
        this.material = m;
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
        this.scale = { x: 1, y: 1, z: 1, set: (x, y, z) => { this.scale.x = x; this.scale.y = y; this.scale.z = z; } };
      }
    };
    fakeTHREE.CylinderGeometry = class CylinderGeometry {};
    fakeTHREE.SphereGeometry = class SphereGeometry {};

    const scene = { children: [], add(obj) { this.children.push(obj); } };
    const camp = { groundAt: () => 0 };
    const applyStagingPresence = buildApplyPresence(
      fakeTHREE,
      scene,
      camp,
      TOWN_LAYOUT,
      createAvatarCapsule,
      setAvatarStatusText,
      getPlotTargetPosition,
      pickBandstandSpot
    );

    const liveStore = { avatars: new Map(), plotAssignments: new Map() };
    const bandstandBuilt = {
      avatarSpots: [{ x: 1, y: 0.6, z: 1, rotY: 0 }, { x: 2, y: 0.6, z: 2, rotY: 0 }],
    };

    applyStagingPresence(liveStore, bandstandBuilt, null, new Map(), {
      presence: [
        { handle: 'x', role: 'muse', zone: 'plot:milo' },
        { handle: 'y', role: 'muse', zone: 'plot:unknown' },
      ],
      footlights: [],
    });

    const expectedMilo = getPlotTargetPosition(TOWN_LAYOUT.plots[0], 0);
    assert.deepEqual(liveStore.avatars.get('x').userData.target, {
      x: expectedMilo.x,
      y: 0,
      z: expectedMilo.z,
      rotY: expectedMilo.rotY,
      nametagLift: 0,
    });
    assert.deepEqual(liveStore.avatars.get('y').userData.target, {
      x: 1,
      y: 0.6,
      z: 1,
      rotY: 0,
      slot: 0,
      nametagLift: 0,
    });
  });
});

test('applyStagingState never touches slot 0 or milo, bounds slots, and fully resets unlit footlights', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function applyStagingState(');
  assert.ok(fnStart !== -1, 'Expected applyStagingState in staging.js');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  assert.match(fnBody, /\.filter\(\(r\) => r\?\.handle !== 'milo'\);/);
  assert.match(fnBody, /typeof row\.handle === 'string' &&\s*row\.handle !== ''/);
  assert.match(fnBody, /row\.slot >= 1 &&\s*row\.slot < footlights\.length/);
  assert.match(fnBody, /if \(slot === 0 \|\| flGroup\.userData\?\.permanent\) continue;/);

  for (const snippet of [
    "shell.material.color.set('#7a6230');",
    "shell.material.emissive.set('#000000');",
    'shell.material.emissiveIntensity = 0;',
    'placard.rotation.x = 0;',
    'placard.position.y = 0.06;',
    'placard.material.map = null;',
    "placard.material.color.set('#4d301c');",
    'placard.material.needsUpdate = true;',
    'flGroup.userData.lit = false;',
    'flGroup.userData.handle = null;',
    'flGroup.userData.role = null;',
    'flGroup.userData.statusText = null;',
  ]) {
    const escaped = snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(fnBody, new RegExp(escaped), `Expected unlit reset line: ${snippet}`);
  }

  assert.match(
    fnBody,
    /!flGroup\.userData\.lit \|\|\s*flGroup\.userData\.handle !== handle \|\|\s*flGroup\.userData\.role !== role \|\|\s*\(flGroup\.userData\.statusText \?\? null\) !== statusText/
  );
});

test('buildStagingSignpost builds a post and a 512x160 board, splitting two-part text across two lines', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function buildStagingSignpost(');
  assert.ok(fnStart !== -1, 'Expected buildStagingSignpost in staging.js');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  const buildFn = new Function('THREE', 'document', `${fnBody}\nreturn buildStagingSignpost;`);

  withRecordingCanvas(({ fakeTHREE, draws }) => {
    fakeTHREE.Group = class Group {
      constructor() {
        this.name = '';
        this.children = [];
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
      }
      add(c) { this.children.push(c); }
    };
    fakeTHREE.Mesh = class Mesh {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
      }
    };
    fakeTHREE.BoxGeometry = class BoxGeometry {
      constructor(...args) { this.args = args; }
    };
    fakeTHREE.MeshStandardMaterial = class MeshStandardMaterial {
      constructor(opts = {}) { Object.assign(this, opts); }
    };
    fakeTHREE.CanvasTexture = class CanvasTexture {
      constructor(canvas) { this.canvas = canvas; }
    };
    fakeTHREE.SRGBColorSpace = 'srgb';

    const buildStagingSignpost = buildFn(fakeTHREE, globalThis.document);
    const group = buildStagingSignpost('Wick — Lamp-Trimmer');

    assert.equal(group.name, 'cottage_signpost');
    assert.equal(group.children.length, 2);

    const [post, board] = group.children;
    assert.deepEqual(post.geometry.args, [0.12, 1.1, 0.12]);
    assert.equal(post.position.x, 0);
    assert.equal(post.position.y, 0.55);
    assert.equal(post.position.z, 0);
    assert.equal(post.material.color, '#5c4028');

    assert.deepEqual(board.geometry.args, [1.5, 0.5, 0.08]);
    assert.equal(board.position.x, 0);
    assert.equal(board.position.y, 1.05);
    assert.equal(board.position.z, 0.04);

    assert.equal(draws.length, 2);
    assert.equal(draws[0].text, 'Wick —');
    assert.equal(draws[0].y, 58);
    assert.equal(draws[0].width, 512);
    assert.equal(draws[0].height, 160);
    assert.equal(draws[1].text, 'Lamp-Trimmer');
    assert.equal(draws[1].y, 104);
    assert.equal(draws[1].width, 512);
    assert.equal(draws[1].height, 160);

    draws.length = 0;
    buildStagingSignpost('Just one line');
    assert.equal(draws.length, 1);
    assert.equal(draws[0].text, 'Just one line');
    assert.equal(draws[0].y, 80);
  });
});

test('lightUp pairs night zones from params, falls back to mod defaults, and skips missing zones', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function lightUp(');
  assert.ok(fnStart !== -1, 'Expected lightUp in staging.js');
  const fnEnd = src.indexOf('\nfunction place(', fnStart + 1);
  assert.ok(fnEnd !== -1, 'Expected place after lightUp');
  const fnBody = src.slice(fnStart, fnEnd);

  const calls = [];
  const camp = { light(obj, pairs) { calls.push({ obj, pairs }); } };
  const lightUp = new Function('camp', `${fnBody}\nreturn lightUp;`)(camp);

  const obj = { id: 'cottage' };
  lightUp(
    {
      night: { wall: { color: '#ffbe5c', intensity: 2 }, roof: { color: '#111' } },
      params: { roof: { default: '#5a4332' } },
    },
    obj,
    { wall: '#abc' }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].obj, obj);
  assert.deepEqual(calls[0].pairs, [
    { from: '#abc', to: '#ffbe5c', intensity: 2 },
    { from: '#5a4332', to: '#111', intensity: 1 },
  ]);

  lightUp({ night: { wall: { color: '#fff' } } }, obj, {});
  lightUp({ night: {} }, obj, {});
  lightUp({}, obj, {});
  assert.equal(calls.length, 1);
});

test('place grounds the part, faces the centre by default, and honors rotY, scale, and remove', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const lightStart = src.indexOf('function lightUp(');
  const placeStart = src.indexOf('\nfunction place(', lightStart + 1);
  const placeEnd = src.indexOf('\n// Minimal staging-local signpost', placeStart + 1);
  assert.ok(lightStart !== -1 && placeStart !== -1 && placeEnd !== -1, 'Expected lightUp and place in staging.js');
  const lightUpBody = src.slice(lightStart, placeStart);
  const placeBody = src.slice(placeStart + 1, placeEnd);

  const lightCalls = [];
  const added = [];
  const camp = {
    groundAt: (x, z) => x + z,
    light(obj, pairs) { lightCalls.push({ obj, pairs }); },
  };
  const scene = { add(o) { added.push(o); } };

  const place = new Function(
    'camp',
    'scene',
    `const faceCenter = (x, z) => Math.atan2(-x, -z);\n${lightUpBody}\n${placeBody}\nreturn place;`
  )(camp, scene);

  const mod = {
    night: {},
    createAsset(params) {
      const o = {
        params,
        position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
        rotation: { y: 0 },
        scale: { setScalar(s) { o.scaleValue = s; } },
        getObjectByName(n) { return n === 'chimney' ? { name: 'chimney' } : null; },
        remove(g) { o.removed = g; },
      };
      return o;
    },
  };

  const o1 = place(mod, { a: 1 }, 3, 4);
  assert.equal(o1.position.x, 3);
  assert.equal(o1.position.y, 7);
  assert.equal(o1.position.z, 4);
  assert.equal(o1.rotation.y, Math.atan2(-3, -4));
  assert.equal(added.length, 1);
  assert.equal(added[0], o1);

  const o2 = place(mod, {}, 1, 2, { rotY: 0.5, scale: 2 });
  assert.equal(o2.rotation.y, 0.5);
  assert.equal(o2.scaleValue, 2);

  const o3 = place(mod, {}, 5, 6, { remove: 'chimney' });
  assert.equal(o3.removed.name, 'chimney');
  assert.equal(lightCalls.length, 0);
});

test('faceCenter angles, seeded rnd sequence, and counts start at zero', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const faceMatch = src.match(/const faceCenter = \(x, z\) => Math\.atan2\(-x, -z\);/);
  const rndMatch = src.match(/let seed = 20261113;\nconst rnd = \(\) => \(\(seed = \(seed \* 1664525 \+ 1013904223\) >>> 0\) \/ 4294967296\);/);
  assert.ok(faceMatch, 'Expected faceCenter in staging.js');
  assert.ok(rndMatch, 'Expected seeded rnd in staging.js');

  const { faceCenter, rnd } = new Function(`${faceMatch[0]}\n${rndMatch[0]}\nreturn { faceCenter, rnd };`)();
  assert.equal(faceCenter(10, 0), -Math.PI / 2);
  assert.equal(faceCenter(0, 10), -Math.PI);
  assert.equal(faceCenter(-5, 0), Math.PI / 2);
  // Math.atan2(-0, -0) yields -Math.PI; never called at the origin in practice (assets sit at radius >= 6).
  assert.equal(faceCenter(0, 0), -Math.PI);

  assert.equal(rnd(), 0.47958743665367365);
  assert.equal(rnd(), 0.5140639289747924);

  assert.ok(
    src.includes('const counts = { bandstand: 0, ghost: 0, buildings: 0, pines: 0, lamps: 0, npcs: 0 };'),
    'Expected counts initialized to zero in staging.js'
  );
});

test('G1: isInnOccupied rejects stair and non-object claim shapes while accepting plain objects', () => {
  assert.equal(isInnOccupied({ stair: { handle: 'x' } }), false);
  assert.equal(isInnOccupied({}), false);
  assert.equal(isInnOccupied({ lantern: 'x' }), false);
  assert.equal(isInnOccupied({ lantern: [] }), false);
  assert.equal(isInnOccupied({ lantern: {} }), true);
  assert.equal(isInnOccupied({ window: 0 }), false);
  assert.equal(isInnOccupied({ quiet: true }), false);
  assert.equal(isInnOccupied({ lantern: null, window: { handle: 'w' }, quiet: 'no' }), true);
});

test('G2: updateStagingInnOccupancy guards traverse and splits merged lit mesh once across occupancy changes', () => {
  assert.equal(updateStagingInnOccupancy({}, { lantern: { handle: 'a' } }), null);
  assert.equal(updateStagingInnOccupancy({ traverse: 'nope' }, { lantern: { handle: 'a' } }), null);

  const { group, litMesh } = makeMergedLitTavernGroup(1.15);
  assert.equal(litMesh.geometry.attributes.position.count, 72);
  assert.equal(updateStagingInnOccupancy(group, { lantern: null, window: { handle: 'wick' }, quiet: null }), true);
  assert.equal(litMesh.userData.innRoomSplitDone, true);
  assert.equal(litMesh.userData.innZone, 'rest');
  assert.equal(litMesh.children.length, 4);
  assert.deepEqual(litMesh.children.map((c) => c.userData.innZone).sort(), ['lantern', 'quiet', 'stair', 'window']);
  const byZone = Object.fromEntries(litMesh.children.map((c) => [c.userData.innZone, c]));
  assert.equal(byZone.window.material.emissiveIntensity, 1.15);
  assert.equal(byZone.lantern.material.emissiveIntensity, 0);
  assert.equal(byZone.quiet.material.emissiveIntensity, 0);
  assert.equal(byZone.stair.material.emissiveIntensity, 0);
  assert.equal(byZone.window.name, 'tavern-shell:lit:window');
  assert.equal(byZone.window.castShadow, false);
  assert.equal(litMesh.geometry.attributes.position.count, 48);
  assert.equal(litMesh.material.emissiveIntensity, 1.15);

  assert.equal(updateStagingInnOccupancy(group, { lantern: null, window: null, quiet: null }), false);
  assert.equal(litMesh.children.length, 4);
  assert.equal(byZone.window.material.emissiveIntensity, 0);
  assert.equal(litMesh.material.emissiveIntensity, 0);

  assert.equal(updateStagingInnOccupancy(group, { lantern: { handle: 'a' }, window: null, quiet: null }), true);
  assert.equal(byZone.lantern.material.emissiveIntensity, 1.15);
  assert.equal(byZone.window.material.emissiveIntensity, 0);
});

test('G3: splitNightlyCallLines handles empty, exact-fit, hard-chunk, verbatim short, and greedy wrap edges', () => {
  assert.deepEqual(splitNightlyCallLines(''), ['']);
  assert.deepEqual(splitNightlyCallLines('x'.repeat(30)), ['x'.repeat(30)]);
  assert.deepEqual(splitNightlyCallLines('x'.repeat(31)), ['x'.repeat(30), 'x']);
  assert.deepEqual(splitNightlyCallLines('a  b'), ['a  b']);
  assert.deepEqual(splitNightlyCallLines('  padded topic  ', 30), ['  padded topic  ']);
  assert.deepEqual(splitNightlyCallLines('x'.repeat(30) + ' y'), ['x'.repeat(30), 'y']);
  assert.deepEqual(splitNightlyCallLines('aa bb cc', 2), ['aa', 'bb', 'cc']);
  assert.deepEqual(splitNightlyCallLines('aa bb', 5), ['aa bb']);
  assert.deepEqual(splitNightlyCallLines('aa bb', 4), ['aa', 'bb']);
  assert.deepEqual(splitNightlyCallLines('word '.repeat(8).trim(), 10), ['word word', 'word word', 'word word', 'word word']);
});

test('G4: TOWN_LAYOUT and SEED_HOME_PADS pin exact coordinates, radii, plots, and seed pad map', () => {
  assert.equal(TOWN_LAYOUT.clearingRadius, 30);
  assert.deepEqual(TOWN_LAYOUT.bandstand, { x: 0, y: 0, z: 0, radius: 4.5, height: 0.6 });
  assert.deepEqual(TOWN_LAYOUT.gate, { x: 0, y: 0, z: 27 });
  assert.deepEqual(TOWN_LAYOUT.newsstand, { x: 6, y: 0, z: 14 });
  assert.deepEqual(TOWN_LAYOUT.noticeBoard, { x: -6, y: 0, z: 14 });
  assert.deepEqual(TOWN_LAYOUT.inn, { x: -11, y: 0, z: 20 });
  assert.equal(TOWN_LAYOUT.plotRadius, 18.5);
  assert.deepEqual(TOWN_LAYOUT.plots, [
    { plotNumber: 1, x: 17.919, y: 0, z: 4.601, rotY: -1.8221 },
    { plotNumber: 2, x: 17.833, y: 0, z: -4.922, rotY: -1.3015 },
    { plotNumber: 3, x: 13.023, y: 0, z: -13.14, rotY: -0.7809 },
    { plotNumber: 4, x: 4.761, y: 0, z: -17.877, rotY: -0.2603 },
    { plotNumber: 5, x: -4.761, y: 0, z: -17.877, rotY: 0.2603 },
    { plotNumber: 6, x: -13.023, y: 0, z: -13.14, rotY: 0.7809 },
    { plotNumber: 7, x: -17.833, y: 0, z: -4.922, rotY: 1.3015 },
    { plotNumber: 8, x: -17.919, y: 0, z: 4.601, rotY: 1.8221 },
  ]);
  assert.deepEqual(SEED_HOME_PADS, { wick: 2, maren: 3, tomas: 4 });
});

test('G5: getPlotTargetPosition computes exact lateral offsets across plots and indices', () => {
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[0], 0), { x: 14.4321, y: 0, z: 3.7058, rotY: -1.8221 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[0], 1), { x: 14.2083, y: 0, z: 4.5775, rotY: -1.8221 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[0], 2), { x: 14.6559, y: 0, z: 2.8341, rotY: -1.8221 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[0], 3), { x: 13.9845, y: 0, z: 5.4493, rotY: -1.8221 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[0], 4), { x: 14.8797, y: 0, z: 1.9623, rotY: -1.8221 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[4], 0), { x: -3.8345, y: 0, z: -14.3983, rotY: 0.2603 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[4], 1), { x: -2.9648, y: 0, z: -14.6299, rotY: 0.2603 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[7], 2), { x: -14.2083, y: 0, z: 4.5775, rotY: 1.8221 });
});

test('G6: pickBandstandSpot honors preferred slot, falls back on taken/out-of-range, and spills to overflow ring', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, z: -i || 0, rotY: 0.1 * i }));
  const used = new Set();

  assert.deepEqual(pickBandstandSpot(spots, used, 3), { x: 3, y: 0, z: -3, rotY: 0.30000000000000004, slot: 3, nametagLift: 0.5 });
  assert.deepEqual(pickBandstandSpot(spots, used, 3), { x: 0, y: 0, z: 0, rotY: 0, slot: 0, nametagLift: 0 });
  assert.deepEqual(pickBandstandSpot(spots, used, 99), { x: 1, y: 0, z: -1, rotY: 0.1, slot: 1, nametagLift: 0.5 });
  assert.deepEqual(pickBandstandSpot(spots, used, -1), { x: 2, y: 0, z: -2, rotY: 0.2, slot: 2, nametagLift: 0 });
  for (let i = 4; i < 10; i++) pickBandstandSpot(spots, used);
  assert.deepEqual([...used].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(pickBandstandSpot(spots, used), { x: 0.9863, y: 0, z: 6.5259, rotY: -2.9916, slot: 10, nametagLift: 0 });
  assert.deepEqual(pickBandstandSpot(spots, used), { x: 4.6337, y: 0, z: 4.6998, rotY: -2.3633, slot: 11, nametagLift: 0.5 });
});

test('G7: createAvatarCapsule builds body, head, and nametag sprite for muse, npc, default, and unknown roles', () => {
  withRecordingCanvas(({ fakeTHREE, draws }) => {
    const vec3 = (x = 0, y = 0, z = 0) => Object.defineProperty({ x, y, z }, 'set', {
      value(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; },
      enumerable: false,
    });
    fakeTHREE.Group = class Group {
      constructor() {
        this.name = '';
        this.children = [];
        this.userData = {};
        this.position = vec3();
        this.rotation = { x: 0, y: 0, z: 0 };
      }
      add(c) { this.children.push(c); }
    };
    fakeTHREE.Mesh = class Mesh {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = vec3();
      }
    };
    fakeTHREE.CylinderGeometry = class CylinderGeometry {
      constructor(...args) { this.args = args; }
    };
    fakeTHREE.SphereGeometry = class SphereGeometry {
      constructor(...args) { this.args = args; }
    };
    fakeTHREE.MeshStandardMaterial = class MeshStandardMaterial {
      constructor(opts = {}) { Object.assign(this, opts); }
    };
    fakeTHREE.SpriteMaterial = class SpriteMaterial {
      constructor(opts = {}) { Object.assign(this, opts); }
    };
    fakeTHREE.Sprite = class Sprite {
      constructor(material) {
        this.name = '';
        this.material = material;
        this.position = vec3();
        this.scale = vec3(1, 1, 1);
      }
    };
    fakeTHREE.CanvasTexture = class CanvasTexture {
      constructor(canvas) {
        this.canvas = canvas;
        this.needsUpdate = false;
      }
    };

    const muse = createAvatarCapsule(fakeTHREE, { handle: 'muse', role: 'muse' });
    assert.equal(muse.name, 'avatar_muse');
    assert.equal(muse.children.length, 3);
    assert.equal(muse.userData.handle, 'muse');
    assert.equal(muse.userData.role, 'muse');
    assert.equal(muse.userData.nametagLift, 0);
    assert.equal(muse.userData.nametagSprite, muse.children[2]);
    assert.deepEqual(muse.children[0].geometry.args, [0.28, 0.32, 1.0, 8]);
    assert.equal(muse.children[0].material.color, '#6cb4d8');
    assert.equal(muse.children[0].material.roughness, 0.7);
    assert.deepEqual(muse.children[0].position, { x: 0, y: 0.5, z: 0 });
    assert.deepEqual(muse.children[1].geometry.args, [0.24, 8, 6]);
    assert.equal(muse.children[1].material.color, '#f2dcc4');
    assert.equal(muse.children[1].material.roughness, 0.75);
    assert.deepEqual(muse.children[1].position, { x: 0, y: 1.2, z: 0 });
    const sprite = muse.children[2];
    assert.equal(sprite.name, 'nametag_sprite');
    assert.deepEqual(sprite.position, { x: 0, y: 1.8, z: 0 });
    assert.deepEqual(sprite.scale, { x: 1.5, y: 0.375, z: 1 });
    assert.equal(sprite.material.transparent, true);
    assert.equal(sprite.material.map.canvas.width, 384);
    assert.equal(sprite.material.map.canvas.height, 96);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].text, '[MUSE] muse');
    assert.equal(draws[0].x, 192);
    assert.equal(draws[0].y, 48);
    assert.equal(draws[0].font, 'bold 30px monospace');

    draws.length = 0;
    const npc = createAvatarCapsule(fakeTHREE, { handle: 'wick', role: 'npc', nametagLift: 0.5 });
    assert.equal(npc.children[0].material.color, '#d49a45');
    assert.equal(npc.children[2].position.y, 2.3);
    assert.equal(npc.userData.role, 'npc');
    assert.equal(draws[0].text, '[NPC] wick');

    const def = createAvatarCapsule(fakeTHREE, {});
    assert.equal(def.name, 'avatar_muse');
    const weird = createAvatarCapsule(fakeTHREE, { handle: 'x', role: 'guest' });
    assert.equal(weird.userData.role, 'muse');
    assert.equal(weird.children[0].material.color, '#6cb4d8');
  });
});

test('G8: setAvatarStatusText updates, deduplicates, truncates, clears, and guards missing targets', () => {
  withRecordingCanvas(({ fakeTHREE, draws }) => {
    const vec3 = (x = 0, y = 0, z = 0) => Object.defineProperty({ x, y, z }, 'set', {
      value(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; },
      enumerable: false,
    });
    fakeTHREE.Group = class Group {
      constructor() {
        this.name = '';
        this.children = [];
        this.userData = {};
        this.position = vec3();
        this.rotation = { x: 0, y: 0, z: 0 };
      }
      add(c) { this.children.push(c); }
    };
    fakeTHREE.Mesh = class Mesh {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = vec3();
      }
    };
    fakeTHREE.CylinderGeometry = class CylinderGeometry {
      constructor(...args) { this.args = args; }
    };
    fakeTHREE.SphereGeometry = class SphereGeometry {
      constructor(...args) { this.args = args; }
    };
    fakeTHREE.MeshStandardMaterial = class MeshStandardMaterial {
      constructor(opts = {}) { Object.assign(this, opts); }
    };
    fakeTHREE.SpriteMaterial = class SpriteMaterial {
      constructor(opts = {}) { Object.assign(this, opts); }
    };
    fakeTHREE.Sprite = class Sprite {
      constructor(material) {
        this.name = '';
        this.material = material;
        this.position = vec3();
        this.scale = vec3(1, 1, 1);
      }
    };
    fakeTHREE.CanvasTexture = class CanvasTexture {
      constructor(canvas) {
        this.canvas = canvas;
        this.needsUpdate = false;
      }
    };

    const av = createAvatarCapsule(fakeTHREE, { handle: 'maren', role: 'npc' });
    const sprite = av.userData.nametagSprite;
    draws.length = 0;

    const map0 = sprite.material.map;
    setAvatarStatusText(fakeTHREE, av, 'trimming the lamps');
    assert.equal(av.userData.statusText, 'trimming the lamps');
    assert.equal(sprite.scale.y, 0.5625);
    assert.equal(sprite.material.map.canvas.height, 144);
    assert.notEqual(sprite.material.map, map0);
    assert.equal(draws.length, 2);
    assert.equal(draws[0].text, '[NPC] maren');
    assert.equal(draws[0].y, 48);
    assert.equal(draws[1].text, 'trimming the lamps');
    assert.equal(draws[1].y, 96);
    assert.equal(draws[1].font, 'bold 22px monospace');

    const map1 = sprite.material.map;
    setAvatarStatusText(fakeTHREE, av, 'trimming the lamps');
    assert.equal(sprite.material.map, map1);

    setAvatarStatusText(fakeTHREE, av, 'x'.repeat(24));
    assert.equal(av.userData.statusText, 'x'.repeat(24));
    setAvatarStatusText(fakeTHREE, av, 'x'.repeat(25));
    assert.equal(av.userData.statusText, 'x'.repeat(23) + '…');
    assert.equal(av.userData.statusText.length, 24);

    draws.length = 0;
    setAvatarStatusText(fakeTHREE, av, '   ');
    assert.equal(av.userData.statusText, null);
    assert.equal(sprite.scale.y, 0.375);
    assert.equal(sprite.material.map.canvas.height, 96);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].text, '[NPC] maren');

    setAvatarStatusText(fakeTHREE, av, null);
    assert.equal(av.userData.statusText, null);
    setAvatarStatusText(fakeTHREE, {}, 'hello');
    setAvatarStatusText(fakeTHREE, null, 'hello');

    const museAv = createAvatarCapsule(fakeTHREE, { handle: 'muse', role: 'muse' });
    setAvatarStatusText(fakeTHREE, museAv, 'hello');
    assert.equal(museAv.userData.statusText, 'hello');
  });
});

test('G9: updateStagingNightlyCallCard guards malformed args and updates via direct nightlyCallCard property', () => {
  const calls = [];
  const makeTextTexture = (THREE, lines, opts) => {
    const tex = { THREE, lines, opts };
    calls.push(tex);
    return tex;
  };
  const fakeTHREE = { CanvasTexture: function FakeTex() {} };
  const initialMap = { initial: true };
  const card = {
    name: 'nightly_call_card',
    material: { map: initialMap, needsUpdate: false },
  };
  const liveStore = { nightlyCallTopic: null };
  const base = {
    THREE: fakeTHREE,
    bandstandBuilt: { nightlyCallCard: card },
    liveStore,
    makeTextTexture,
  };

  assert.equal(updateStagingNightlyCallCard(base, []), false);
  assert.equal(updateStagingNightlyCallCard(base, 'topic'), false);
  assert.equal(updateStagingNightlyCallCard(base, { topic: 42 }), false);
  assert.equal(updateStagingNightlyCallCard(base, { topic: null }), false);
  assert.equal(updateStagingNightlyCallCard({ ...base, THREE: null }, { topic: 'Hello' }), false);
  assert.equal(updateStagingNightlyCallCard({ ...base, liveStore: null }, { topic: 'Hello' }), false);
  assert.equal(updateStagingNightlyCallCard({ ...base, makeTextTexture: null }, { topic: 'Hello' }), false);
  assert.equal(updateStagingNightlyCallCard({ ...base, bandstandBuilt: {} }, { topic: 'Hello' }), false);
  assert.equal(calls.length, 0);

  assert.equal(updateStagingNightlyCallCard(base, { topic: 'Direct card path' }), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].lines, ['THE NIGHTLY CALL', 'Direct card path']);
  assert.equal(liveStore.nightlyCallTopic, 'Direct card path');
  assert.equal(card.material.map, calls[0]);
});

test('G10: test-staging.mjs hygiene — 58 unique names, 8 imports, pinned as-true counts', async () => {
  const self = await fs.readFile(SELF_PATH, 'utf8');
  const lines = self.split('\n');
  const names = [...self.matchAll(/^(?:await )?test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 58);
  assert.equal(new Set(names).size, 58);
  assert.deepEqual(lines.filter((l) => l.startsWith('import ')), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'import {',
    "import { lightFootlightSlot } from './concept-bandstand.js';",
    'import {',
  ]);
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 1);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Math' + '.random')).length, 2);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.toLowerCase().includes('camp' + 'fire')).length, 0);
});

test('isInnOccupied returns null for missing or malformed state and INN_ROOM_KEYS pins the three room keys (G11)', () => {
  assert.deepEqual(INN_ROOM_KEYS, ['lantern', 'window', 'quiet']);
  assert.equal(isInnOccupied(null), null);
  assert.equal(isInnOccupied(undefined), null);
  assert.equal(isInnOccupied([]), null);
  assert.equal(isInnOccupied('x'), null);
  assert.equal(isInnOccupied(42), null);
  assert.equal(isInnOccupied({}), false);
  assert.equal(isInnOccupied({ stair: { handle: 'x' } }), false);
});

test('collectTavernGlowMaterials guards invalid targets, dedupes shared materials, handles arrays, and memoizes intensity (G12)', () => {
  assert.deepEqual(collectTavernGlowMaterials(null), []);
  assert.deepEqual(collectTavernGlowMaterials(undefined), []);
  assert.deepEqual(collectTavernGlowMaterials({}), []);
  assert.deepEqual(collectTavernGlowMaterials({ traverse: 'nope' }), []);

  const shared = { emissiveIntensity: 0.7, userData: { glow: true } };
  const otherGlow = { emissiveIntensity: 1.15, userData: { glow: true } };
  const plain = { emissiveIntensity: 2, userData: {} };
  const nodes = [
    { isMesh: true, material: shared },
    { isMesh: true, material: shared },
    { isMesh: true, material: [otherGlow, plain] },
    { isMesh: false, material: { emissiveIntensity: 1.5, userData: { glow: true } } },
    { isMesh: true, material: null },
  ];
  const group = {
    traverse(cb) {
      for (const n of nodes) cb(n);
    },
  };

  const mats = collectTavernGlowMaterials(group);
  assert.equal(mats.length, 2);
  assert.equal(mats[0], shared);
  assert.equal(mats[1], otherGlow);
  assert.equal(shared.userData.litEmissiveIntensity, 0.7);
  assert.equal(otherGlow.userData.litEmissiveIntensity, 1.15);

  shared.emissiveIntensity = 0.1;
  collectTavernGlowMaterials(group);
  assert.equal(shared.userData.litEmissiveIntensity, 0.7);

  const defaultGlow = { userData: { glow: true } };
  const groupDefault = {
    traverse(cb) {
      cb({ isMesh: true, material: defaultGlow });
    },
  };
  const matsDefault = collectTavernGlowMaterials(groupDefault);
  assert.equal(matsDefault.length, 1);
  assert.equal(matsDefault[0], defaultGlow);
  assert.equal(defaultGlow.userData.litEmissiveIntensity, 1.15);
});

test('updateStagingInnOccupancy classifies position-based zones, keeps stair dark, lights rest on any occupancy, and pins boundaries (G13)', () => {
  const makePosMesh = (x, y, z) => ({
    isMesh: true,
    material: {
      emissiveIntensity: 1.15,
      userData: { glow: true },
      clone() {
        return {
          emissiveIntensity: this.emissiveIntensity,
          userData: { ...this.userData },
          clone: this.clone,
        };
      },
    },
    position: { x, y, z },
    userData: {},
    children: [],
  });
  const makeGroup = (meshes) => ({
    traverse(cb) {
      cb(this);
      for (const m of meshes) cb(m);
    },
  });

  const lantern = makePosMesh(-3.6, 4.25, 2.94);
  const windowMesh = makePosMesh(-1.9, 4.25, 2.94);
  const quiet = makePosMesh(1.9, 4.25, 2.94);
  const stair = makePosMesh(3.6, 4.25, 2.94);
  const rest = makePosMesh(0, 1, 0);
  const group = makeGroup([lantern, windowMesh, quiet, stair, rest]);

  assert.equal(updateStagingInnOccupancy(group, { lantern: { handle: 'a' }, window: null, quiet: null }), true);
  assert.equal(lantern.userData.innZone, 'lantern');
  assert.equal(windowMesh.userData.innZone, 'window');
  assert.equal(quiet.userData.innZone, 'quiet');
  assert.equal(stair.userData.innZone, 'stair');
  assert.equal(rest.userData.innZone, 'rest');
  assert.equal(lantern.material.emissiveIntensity, 1.15);
  assert.equal(rest.material.emissiveIntensity, 1.15);
  assert.equal(windowMesh.material.emissiveIntensity, 0);
  assert.equal(quiet.material.emissiveIntensity, 0);
  assert.equal(stair.material.emissiveIntensity, 0);

  assert.equal(
    updateStagingInnOccupancy(group, { lantern: { handle: 'a' }, window: { handle: 'b' }, quiet: { handle: 'c' } }),
    true
  );
  assert.equal(stair.material.emissiveIntensity, 0);
  assert.equal(windowMesh.material.emissiveIntensity, 1.15);

  assert.equal(updateStagingInnOccupancy(group, { lantern: null, window: null, quiet: null }), false);
  assert.equal(lantern.material.emissiveIntensity, 0);
  assert.equal(windowMesh.material.emissiveIntensity, 0);
  assert.equal(quiet.material.emissiveIntensity, 0);
  assert.equal(stair.material.emissiveIntensity, 0);
  assert.equal(rest.material.emissiveIntensity, 0);

  const boundaryCases = [
    [-3.01, 4.25, 2.94, 'lantern'],
    [-3.0, 4.25, 2.94, 'rest'],
    [-2.99, 4.25, 2.94, 'rest'],
    [-3.6, 4.25, 3.13, 'lantern'],
    [-3.6, 4.25, 3.14, 'rest'],
    [-3.6, 4.25, 3.15, 'rest'],
    [-3.6, 4.84, 2.94, 'lantern'],
    [-3.6, 4.85, 2.94, 'lantern'],
    [-3.6, 4.86, 2.94, 'rest'],
    [3.6, 4.25, 2.94, 'stair'],
  ];
  for (const [x, y, z, expectedZone] of boundaryCases) {
    const m = makePosMesh(x, y, z);
    updateStagingInnOccupancy(makeGroup([m]), { lantern: { handle: 'a' } });
    assert.equal(m.userData.innZone, expectedZone);
  }

  assert.equal(updateStagingInnOccupancy(group, null), null);
  assert.equal(updateStagingInnOccupancy(null, { lantern: { handle: 'a' } }), null);
  assert.equal(updateStagingInnOccupancy({}, { lantern: { handle: 'a' } }), null);
});

test('updateStagingInnOccupancy clones shared materials per mesh and leaves plain array entries untouched (G14)', () => {
  const sharedMat = {
    emissiveIntensity: 1.15,
    userData: { glow: true },
    clone() {
      return {
        emissiveIntensity: this.emissiveIntensity,
        userData: { ...this.userData },
        clone: this.clone,
      };
    },
  };
  const m1 = { isMesh: true, material: sharedMat, position: { x: -3.6, y: 4.25, z: 2.94 }, userData: {}, children: [] };
  const m2 = { isMesh: true, material: sharedMat, position: { x: -1.9, y: 4.25, z: 2.94 }, userData: {}, children: [] };
  const sharedGroup = {
    traverse(cb) {
      cb(this);
      cb(m1);
      cb(m2);
    },
  };

  assert.equal(updateStagingInnOccupancy(sharedGroup, { lantern: { handle: 'a' }, window: null, quiet: null }), true);
  assert.equal(m1.material, sharedMat);
  assert.notEqual(m2.material, sharedMat);
  assert.equal(m1.material.emissiveIntensity, 1.15);
  assert.equal(m2.material.emissiveIntensity, 0);
  assert.equal(m2.material.userData.glow, true);
  assert.equal(m2.material.userData.litEmissiveIntensity, 1.15);

  const glowMat = {
    emissiveIntensity: 1.15,
    userData: { glow: true },
    clone() {
      return { emissiveIntensity: this.emissiveIntensity, userData: { ...this.userData }, clone: this.clone };
    },
  };
  const plainMat = { emissiveIntensity: 2, userData: {} };
  const arrMesh = { isMesh: true, material: [glowMat, plainMat], position: { x: 0, y: 1, z: 0 }, userData: {}, children: [] };
  const arrGroup = {
    traverse(cb) {
      cb(this);
      cb(arrMesh);
    },
  };

  assert.equal(updateStagingInnOccupancy(arrGroup, { lantern: { handle: 'a' }, window: null, quiet: null }), true);
  assert.equal(Array.isArray(arrMesh.material), true);
  assert.equal(arrMesh.material[0].emissiveIntensity, 1.15);
  assert.equal(arrMesh.material[1], plainMat);
  assert.equal(arrMesh.material[1].emissiveIntensity, 2);
});

test('updateStagingNightlyCallCard trims and dedupes topic, finds card via group.children, sets needsUpdate, and guards missing material (G15)', () => {
  const calls = [];
  const makeTextTexture = (THREE, lines, opts) => {
    const tex = { lines, opts };
    calls.push(tex);
    return tex;
  };
  const fakeTHREE = { CanvasTexture: function FakeTex() {} };
  const card = { name: 'nightly_call_card', material: { map: null, needsUpdate: false } };
  const liveStore = { nightlyCallTopic: null };
  const ctx = {
    THREE: fakeTHREE,
    bandstandBuilt: { group: { children: [card] } },
    liveStore,
    makeTextTexture,
  };

  assert.equal(updateStagingNightlyCallCard(ctx, { topic: '  Hello town  ' }), true);
  assert.equal(liveStore.nightlyCallTopic, 'Hello town');
  assert.deepEqual(calls[0].lines, ['THE NIGHTLY CALL', 'Hello town']);
  assert.equal(card.material.map, calls[0]);
  assert.equal(card.material.needsUpdate, true);

  assert.equal(updateStagingNightlyCallCard(ctx, { topic: 'Hello town' }), false);
  assert.equal(updateStagingNightlyCallCard(ctx, { topic: '  Hello town  ' }), false);
  assert.equal(calls.length, 1);

  const noMatCard = { name: 'nightly_call_card' };
  const noMatStore = { nightlyCallTopic: null };
  assert.equal(
    updateStagingNightlyCallCard(
      { THREE: fakeTHREE, bandstandBuilt: { group: { children: [noMatCard] } }, liveStore: noMatStore, makeTextTexture },
      { topic: 'New topic' }
    ),
    false
  );
  assert.equal(noMatStore.nightlyCallTopic, null);
});

test('updateStagingNightlyCallCard passes exact texture opts and wraps the 2026-11-27 topic at 22 columns (G16)', () => {
  const topic = 'Which chair in your place is the best for thinking?';
  assert.deepEqual(splitNightlyCallLines(topic, 22), [
    'Which chair in your',
    'place is the best for',
    'thinking?',
  ]);

  const calls = [];
  const makeTextTexture = (THREE, lines, opts) => {
    const tex = { lines, opts };
    calls.push(tex);
    return tex;
  };
  const card = { name: 'nightly_call_card', material: { map: null, needsUpdate: false } };
  const liveStore = { nightlyCallTopic: null };

  assert.equal(
    updateStagingNightlyCallCard(
      {
        THREE: { CanvasTexture: function FakeTex() {} },
        bandstandBuilt: { nightlyCallCard: card },
        liveStore,
        makeTextTexture,
      },
      { topic }
    ),
    true
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].lines, [
    'THE NIGHTLY CALL',
    'Which chair in your',
    'place is the best for',
    'thinking?',
  ]);
  assert.deepEqual(calls[0].opts, {
    width: 1024,
    height: 512,
    titleSize: 80,
    subSize: 68,
    borderWidth: 16,
    bg: '#f2e6cf',
    border: '#b59449',
    fg: '#2b1e14',
  });
});

test('getPlotTargetPosition computes exact positions on plots 2, 3, and 6 across indices 0, 1, 5, and 6 (G17)', () => {
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[1], 0), { x: 14.3627, y: 0, z: -3.9642, rotY: -1.3015 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[1], 1), { x: 14.6022, y: 0, z: -3.0966, rotY: -1.3015 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[1], 5), { x: 15.0811, y: 0, z: -1.3615, rotY: -1.3015 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[1], 6), { x: 13.6444, y: 0, z: -6.5669, rotY: -1.3015 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[2], 0), { x: 10.4889, y: 0, z: -10.583, rotY: -0.7809 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[2], 1), { x: 11.1281, y: 0, z: -9.9495, rotY: -0.7809 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[5], 0), { x: -10.4889, y: 0, z: -10.583, rotY: 0.7809 });
  assert.deepEqual(getPlotTargetPosition(TOWN_LAYOUT.plots[5], 5), { x: -8.5711, y: 0, z: -12.4836, rotY: 0.7809 });
});

test('pickBandstandSpot computes overflow ring slots 10, 11, 12, 20 and falls back on non-integer preferred (G18)', () => {
  const spots = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, z: -i || 0, rotY: 0.1 * i }));
  const used = new Set();
  for (let i = 0; i < 10; i++) pickBandstandSpot(spots, used);

  assert.deepEqual(pickBandstandSpot(spots, used), { x: 0.9863, y: 0, z: 6.5259, rotY: -2.9916, slot: 10, nametagLift: 0 });
  assert.deepEqual(pickBandstandSpot(spots, used), { x: 4.6337, y: 0, z: 4.6998, rotY: -2.3633, slot: 11, nametagLift: 0.5 });
  assert.deepEqual(pickBandstandSpot(spots, used), { x: 6.5113, y: 0, z: 1.0786, rotY: -1.735, slot: 12, nametagLift: 0 });
  assert.equal(used.size, 13);

  for (let i = 13; i < 20; i++) pickBandstandSpot(spots, used);
  assert.deepEqual(pickBandstandSpot(spots, used), { x: 1.1208, y: 0, z: 7.4158, rotY: -2.9916, slot: 20, nametagLift: 0 });

  const used2 = new Set([0]);
  assert.equal(pickBandstandSpot(spots, used2, '3').slot, 1);
  assert.equal(pickBandstandSpot(spots, new Set(), null).slot, 0);
});

test('buildStagingSignpost handles three-part text, empty second part, and pins material and texture properties (G19)', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function buildStagingSignpost(');
  assert.ok(fnStart !== -1, 'Expected buildStagingSignpost in staging.js');
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const fnBody = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

  const buildFn = new Function('THREE', 'document', `${fnBody}\nreturn buildStagingSignpost;`);

  withRecordingCanvas(({ fakeTHREE, draws }) => {
    fakeTHREE.Group = class Group {
      constructor() {
        this.name = '';
        this.children = [];
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
      }
      add(c) { this.children.push(c); }
    };
    fakeTHREE.Mesh = class Mesh {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
      }
    };
    fakeTHREE.BoxGeometry = class BoxGeometry {
      constructor(...args) { this.args = args; }
    };
    fakeTHREE.MeshStandardMaterial = class MeshStandardMaterial {
      constructor(opts = {}) { Object.assign(this, opts); }
    };
    fakeTHREE.CanvasTexture = class CanvasTexture {
      constructor(canvas) { this.canvas = canvas; }
    };
    fakeTHREE.SRGBColorSpace = 'srgb';

    const buildStagingSignpost = buildFn(fakeTHREE, globalThis.document);
    const group = buildStagingSignpost('Milo — Ghost — Light');
    const [post, board] = group.children;

    assert.equal(draws.length, 1);
    assert.equal(draws[0].text, 'Milo — Ghost — Light');
    assert.equal(draws[0].y, 80);
    assert.equal(draws[0].width, 512);
    assert.equal(draws[0].height, 160);
    assert.equal(post.material.roughness, 0.9);
    assert.equal(board.material.roughness, 0.85);
    assert.equal(board.material.map.colorSpace, 'srgb');
    assert.equal(board.material.map.canvas.width, 512);

    draws.length = 0;
    buildStagingSignpost('Wick — ');
    assert.equal(draws.length, 2);
    assert.equal(draws[0].text, 'Wick —');
    assert.equal(draws[0].y, 58);
    assert.equal(draws[1].text, '');
    assert.equal(draws[1].y, 104);
  });
});

test('buildNewsstand builds 7 children with exact geometry, sign texture call, and 8-stripe awning texture (G20)', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const fnStart = src.indexOf('function makeAwningTexture(');
  const fnEnd = src.indexOf('\nconst NOTICE_BOARD_PAPERS', fnStart + 1);
  assert.ok(fnStart !== -1 && fnEnd !== -1, 'Expected makeAwningTexture and buildNewsstand in staging.js');
  const fnBody = src.slice(fnStart, fnEnd);

  const buildFn = new Function(
    'THREE',
    'TOWN_LAYOUT',
    'document',
    'makeBandstandTextTexture',
    `${fnBody}\nreturn buildNewsstand;`
  );

  const vec3 = (x = 0, y = 0, z = 0) => Object.defineProperty({ x, y, z }, 'set', {
    value(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; },
    enumerable: false,
  });
  const fakeTHREE = {
    Group: class Group {
      constructor() {
        this.name = '';
        this.children = [];
        this.position = vec3();
        this.rotation = { x: 0, y: 0, z: 0 };
        this.userData = {};
      }
      add(c) { this.children.push(c); }
    },
    Mesh: class Mesh {
      constructor(geometry, material) {
        this.name = '';
        this.geometry = geometry;
        this.material = material;
        this.position = vec3();
        this.rotation = { x: 0, y: 0, z: 0 };
      }
    },
    BoxGeometry: class BoxGeometry {
      constructor(...args) { this.args = args; }
    },
    MeshStandardMaterial: class MeshStandardMaterial {
      constructor(opts = {}) { Object.assign(this, opts); }
    },
    CanvasTexture: class CanvasTexture {
      constructor(canvas) { this.canvas = canvas; this.needsUpdate = false; }
    },
  };

  const rects = [];
  const recDoc = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const ctx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        fillRect(x, y, w, h) {
          rects.push({ kind: 'fillRect', x, y, w, h, fillStyle: ctx.fillStyle });
        },
        strokeRect(x, y, w, h) {
          rects.push({ kind: 'strokeRect', x, y, w, h, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth });
        },
      };
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };

  const texCalls = [];
  const makeBandstandTextTexture = (THREE, lines, opts) => {
    const tex = { THREE, lines, opts };
    texCalls.push(tex);
    return tex;
  };

  const buildNewsstand = buildFn(fakeTHREE, TOWN_LAYOUT, recDoc, makeBandstandTextTexture);
  const group = buildNewsstand(fakeTHREE);

  assert.equal(group.name, 'gazette_newsstand');
  assert.deepEqual(group.position, { x: 6, y: 0, z: 14 });
  assert.equal(group.rotation.y, Math.atan2(-6, -14));
  assert.deepEqual(group.userData, {
    clickable: true,
    kind: 'newsstand',
    label: 'The Ghostlight Gazette Newsstand',
  });

  assert.equal(group.children.length, 7);
  const [booth, awning, papers, shelf, bracketL, bracketR, sign] = group.children;
  assert.deepEqual(booth.geometry.args, [2.2, 2.1, 1.4]);
  assert.deepEqual(booth.position, { x: 0, y: 1.05, z: 0 });
  assert.equal(booth.material.color, '#6b492b');

  assert.deepEqual(awning.geometry.args, [2.5, 0.16, 1.9]);
  assert.deepEqual(awning.position, { x: 0, y: 2.08, z: 0.15 });
  assert.equal(awning.rotation.x, 0.15);

  assert.deepEqual(papers.geometry.args, [0.65, 0.25, 0.45]);
  assert.deepEqual(papers.position, { x: -0.5, y: 1.15, z: 0.78 });

  assert.equal(shelf.name, 'newsstand_papers_shelf');
  assert.deepEqual(shelf.geometry.args, [0.78, 0.06, 0.52]);
  assert.deepEqual(shelf.position, { x: -0.5, y: 0.995, z: 0.8 });

  assert.equal(bracketL.name, 'newsstand_papers_bracket_l');
  assert.deepEqual(bracketL.geometry.args, [0.06, 0.16, 0.28]);
  assert.deepEqual(bracketL.position, { x: -0.8, y: 0.885, z: 0.84 });

  assert.equal(bracketR.name, 'newsstand_papers_bracket_r');
  assert.deepEqual(bracketR.geometry.args, [0.06, 0.16, 0.28]);
  assert.deepEqual(bracketR.position, { x: -0.2, y: 0.885, z: 0.84 });

  assert.deepEqual(sign.geometry.args, [2.0, 0.45, 0.08]);
  assert.deepEqual(sign.position, { x: 0, y: 2.55, z: 0.4 });
  assert.equal(sign.material.roughness, 0.8);

  assert.equal(texCalls.length, 1);
  assert.deepEqual(texCalls[0].lines, ['THE GHOSTLIGHT GAZETTE']);
  assert.deepEqual(texCalls[0].opts, {
    width: 512,
    height: 128,
    titleSize: 28,
    bg: '#231b14',
    border: '#c7a463',
  });

  const fillRects = rects.filter((r) => r.kind === 'fillRect');
  assert.equal(fillRects.length, 8);
  assert.deepEqual(
    fillRects.map((r) => r.fillStyle),
    ['#b84a39', '#f2e6d0', '#b84a39', '#f2e6d0', '#b84a39', '#f2e6d0', '#b84a39', '#f2e6d0']
  );
  assert.deepEqual(
    fillRects.map((r) => r.x),
    [0, 32, 64, 96, 128, 160, 192, 224]
  );
  for (const r of fillRects) {
    assert.equal(r.w, 32);
    assert.equal(r.y, 0);
    assert.equal(r.h, 128);
  }
});
