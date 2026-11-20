import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isInnOccupied,
  updateStagingInnOccupancy,
  splitNightlyCallLines,
  updateStagingNightlyCallCard,
} from './inn-nightly-call.mjs';
import { lightFootlightSlot } from './concept-bandstand.js';
import {
  TOWN_LAYOUT,
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

test('staging.html references staging.js?v=40, uses live title/HUD copy, includes Prompt Book and plot-overlay UI, updates HUD copy, collapsible HUD, and contains no banned term', async () => {
  const [html, self] = await Promise.all([
    fs.readFile(INDEX_HTML_PATH, 'utf8'),
    fs.readFile(SELF_PATH, 'utf8'),
  ]);
  assert.match(html, /src=["']\.\/staging\.js\?v=40["']/, 'index.html must reference ./staging.js?v=40');
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
