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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const STAGING_JS_PATH = path.join(__dirname, 'staging.js');
const INDEX_HTML_PATH = path.join(__dirname, 'index.html');
const SELF_PATH = fileURLToPath(import.meta.url);

const VENDORED_MODULES = [
  'concept-bandstand.js',
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

  assert.match(codeOnly, /from\s+['"]\.\/concept-bandstand\.js['"]/, 'staging.js must import ./concept-bandstand.js');
  assert.match(codeOnly, /from\s+['"]\.\/concept-cottage\.js['"]/, 'staging.js must import ./concept-cottage.js');
  assert.match(codeOnly, /from\s+['"]\.\/concept-ghost\.js['"]/, 'staging.js must import ./concept-ghost.js');
  assert.match(codeOnly, /from\s+['"]\.\/prompt-book\.mjs['"]/, 'staging.js must import ./prompt-book.mjs');
  assert.match(codeOnly, /from\s+['"]\.\/avatar\.mjs['"]/, 'staging.js must import ./avatar.mjs');
  assert.match(codeOnly, /from\s+['"]\.\/inn-nightly-call\.mjs['"]/, 'staging.js must import ./inn-nightly-call.mjs');
  assert.match(codeOnly, /from\s+['"]\.\/plot-overlay\.mjs['"]/, 'staging.js must import ./plot-overlay.mjs');

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

test('staging.html references staging.js?v=10, includes Prompt Book and plot-overlay UI, updates HUD copy, and contains no banned term', async () => {
  const [html, self] = await Promise.all([
    fs.readFile(INDEX_HTML_PATH, 'utf8'),
    fs.readFile(SELF_PATH, 'utf8'),
  ]);
  assert.match(html, /src=["']\.\/staging\.js\?v=10["']/, 'index.html must reference ./staging.js?v=10');
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

  assert.match(codeOnly, /\bnpcStandIns\b/, 'staging.js must keep named references to NPC stand-ins for the yield rule');
  assert.match(codeOnly, /standIn\.group\.visible\s*=\s*false/, 'NPC stand-ins must hide when live presence avatar exists');
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

test('splitNightlyCallLines wraps >60-char topics near the middle on a space', () => {
  const shortTopic = 'What is keeping you awake tonight?';
  assert.deepEqual(splitNightlyCallLines(shortTopic), [shortTopic]);

  const longTopic = 'If you could leave one anonymous lantern lit for a stranger tonight, where would you hang it?';
  assert.ok(longTopic.length > 60);
  const lines = splitNightlyCallLines(longTopic);
  assert.equal(lines.length, 2);
  assert.equal(lines.join(' '), longTopic);
  assert.ok(Math.abs(lines[0].length - lines[1].length) < 16);

  const unbroken = 'a'.repeat(65);
  const hardSplit = splitNightlyCallLines(unbroken);
  assert.equal(hardSplit.length, 2);
  assert.equal(hardSplit[0].length + hardSplit[1].length, 65);
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
    width: 512,
    height: 256,
    titleSize: 30,
    subSize: 20,
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

  // New >60-char topic -> redraws with 2 wrapped lines
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
  assert.equal(calls[1].lines.length, 3);
  assert.equal(calls[1].lines.slice(1).join(' '), longTopic);
});
