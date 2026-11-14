import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('staging.js uses relative vendored imports, no ../town-3d/ paths, no Math.random, and no API wiring', async () => {
  const src = await fs.readFile(STAGING_JS_PATH, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.match(codeOnly, /from\s+['"]\.\/concept-bandstand\.js['"]/, 'staging.js must import ./concept-bandstand.js');
  assert.match(codeOnly, /from\s+['"]\.\/concept-cottage\.js['"]/, 'staging.js must import ./concept-cottage.js');
  assert.match(codeOnly, /from\s+['"]\.\/concept-ghost\.js['"]/, 'staging.js must import ./concept-ghost.js');

  assert.ok(!/\.\.\/town-3d\//.test(codeOnly), 'staging.js must not import from ../town-3d/');
  assert.ok(!/\bMath\.random\b/.test(codeOnly), 'staging.js must not use Math.random');
  assert.ok(!/\bfetch\s*\(/.test(codeOnly), 'staging.js must remain look-only with no fetch() calls');
  assert.ok(!/\bTownLive\b/.test(codeOnly), 'staging.js must not reference TownLive');
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

test('index.html references staging.js?v=5 and contains no banned term', async () => {
  const [html, self] = await Promise.all([
    fs.readFile(INDEX_HTML_PATH, 'utf8'),
    fs.readFile(SELF_PATH, 'utf8'),
  ]);
  assert.match(html, /src=["']\.\/staging\.js\?v=5["']/, 'index.html must reference ./staging.js?v=5');
  assert.ok(!BANNED_TERM_RE.test(html), 'index.html must not contain the banned term');
  assert.ok(!BANNED_TERM_RE.test(self), 'test-staging.mjs must not contain the banned term');
});
