/**
 * Drift-guard test for staging-polyfork/README.md against PLAN.md,
 * staging-polyfork/index.html, staging-polyfork/staging.js,
 * staging-polyfork/events.json, and scripts/stage-deploy.mjs (Slice 130).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '..');

const readmeMd = fs.readFileSync(path.join(BUNDLE_DIR, 'README.md'), 'utf8');
const planMd = fs.readFileSync(path.join(REPO_ROOT, 'PLAN.md'), 'utf8');
const indexHtml = fs.readFileSync(path.join(BUNDLE_DIR, 'index.html'), 'utf8');
const stagingJs = fs.readFileSync(path.join(BUNDLE_DIR, 'staging.js'), 'utf8');
const eventsJson = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, 'events.json'), 'utf8'));
const stageDeploySrc = fs.readFileSync(path.join(REPO_ROOT, 'scripts/stage-deploy.mjs'), 'utf8');

function getSection(md, heading) {
  const marker = `## ${heading}`;
  const start = md.indexOf(marker);
  assert.ok(start !== -1, `Missing section "${marker}" in staging-polyfork/README.md`);
  const nextH2 = md.indexOf('\n## ', start + marker.length);
  return md.slice(start, nextH2 !== -1 ? nextH2 : md.length);
}

test('staging-polyfork/README.md live staging.js?v= and deploy-candidate ?v= pins match PLAN.md and index.html', () => {
  const statusLine = planMd.split(/\r?\n/).find((line) => line.startsWith('**Status:**'));
  assert.ok(statusLine, 'PLAN.md must have a **Status:** header line');

  const liveVMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(liveVMatch, 'PLAN.md **Status:** must state live Polyfork town at staging.js?v=<N>');

  const candidateVMatch = indexHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(candidateVMatch, 'staging-polyfork/index.html must reference staging.js?v=<N>');

  const sec126Idx = planMd.indexOf('### 12.6');
  assert.ok(sec126Idx !== -1, 'PLAN.md must contain ### 12.6');
  const sec126 = planMd.slice(sec126Idx);
  assert.match(sec126, new RegExp(`\\?v=${candidateVMatch[1]}\\b`), `PLAN.md §12.6 must pin deploy candidate ?v=${candidateVMatch[1]}`);

  assert.ok(
    readmeMd.includes(`staging.js?v=${liveVMatch[1]}`),
    `staging-polyfork/README.md must state live staging.js?v=${liveVMatch[1]}`
  );
  assert.ok(
    readmeMd.includes(`\`?v=${candidateVMatch[1]}\``),
    `staging-polyfork/README.md must state deploy-candidate ?v=${candidateVMatch[1]} from index.html`
  );
});

test('staging-polyfork/README.md ## Contents lists existing files and covers all top-level bundle files', () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const listedEntries = [];
  for (const line of contentsSec.split(/\r?\n/)) {
    if (!line.startsWith('- ')) continue;
    const bulletText = line.split(' — ')[0];
    for (const m of bulletText.matchAll(/`([^`]+)`/g)) {
      listedEntries.push(m[1]);
    }
  }
  assert.ok(listedEntries.length >= 20, `Expected at least 20 entries in ## Contents, found ${listedEntries.length}`);

  for (const entry of listedEntries) {
    const fullPath = path.join(BUNDLE_DIR, entry);
    assert.ok(fs.existsSync(fullPath), `## Contents entry "${entry}" does not exist in staging-polyfork/`);
  }

  const listedSet = new Set(listedEntries);
  const topLevelFiles = fs
    .readdirSync(BUNDLE_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.(mjs|js|html|json)$/.test(d.name))
    .map((d) => d.name);

  for (const fileName of topLevelFiles) {
    assert.ok(
      listedSet.has(fileName),
      `Top-level file "${fileName}" in staging-polyfork/ is missing from ## Contents`
    );
  }
});

test('staging-polyfork/README.md events.json summary matches staging-polyfork/events.json', () => {
  assert.ok(Array.isArray(eventsJson.events) && eventsJson.events.length === 1, 'Expected 1 event in events.json');
  const ev = eventsJson.events[0];
  const contentsSec = getSection(readmeMd, 'Contents').replace(/\s+/g, ' ');
  assert.ok(contentsSec.includes(ev.title), `## Contents must include event title "${ev.title}"`);
  assert.ok(contentsSec.includes(`host \`${ev.host_handle}\``), `## Contents must include host "${ev.host_handle}"`);
  assert.ok(contentsSec.includes(ev.start_at), `## Contents must include start_at "${ev.start_at}"`);
  assert.ok(contentsSec.includes(`${ev.duration_min} min`), `## Contents must include duration "${ev.duration_min} min"`);
  assert.ok(contentsSec.includes(`\`${ev.location}\``), `## Contents must include location "${ev.location}"`);
});

test('staging-polyfork/README.md Inn position/width and NPC stand-in coordinates match staging.js', () => {
  const tavernMatch = stagingJs.match(/place\(Tavern,\s*\{\s*width:\s*(\d+)[^}]*\},\s*(-?\d+),\s*(-?\d+)/);
  assert.ok(tavernMatch, 'Could not parse Tavern placement in staging.js');
  const [, tavernWidth, tavernX, tavernZ] = tavernMatch;
  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  const fmtCoord = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));
  assert.ok(
    buildingsSec.includes(`(${fmtCoord(Number(tavernX))}, ${fmtCoord(Number(tavernZ))})`),
    `## Buildings must state Inn position (${fmtCoord(Number(tavernX))}, ${fmtCoord(Number(tavernZ))})`
  );
  assert.ok(
    buildingsSec.includes(`width ${tavernWidth}`),
    `## Buildings must state Inn width ${tavernWidth}`
  );

  const npcSec = getSection(readmeMd, 'NPC stand-ins').replace(/\s+/g, ' ');
  for (const [name, handle] of [['Wick', 'wick'], ['Maren', 'maren'], ['Tomas', 'tomas']]) {
    const npcRe = new RegExp(`\\['${handle}',[\\s\\S]*?home:\\s*\\{\\s*x:\\s*(-?\\d+\\.\\d+),\\s*z:\\s*(-?\\d+\\.\\d+)\\s*\\}`);
    const m = stagingJs.match(npcRe);
    assert.ok(m, `Could not parse ${handle} home coordinates in staging.js`);
    const xStr = Number(m[1]) < 0 ? `−${m[1].slice(1)}` : m[1];
    const zStr = Number(m[2]) < 0 ? `−${m[2].slice(1)}` : m[2];
    assert.ok(
      npcSec.includes(`${name} at (${xStr}, ${zStr})`),
      `## NPC stand-ins must state ${name} at (${xStr}, ${zStr})`
    );
  }
});

test('staging-polyfork/README.md move-in.html claim matches scripts/stage-deploy.mjs', () => {
  const sharedMatch = stageDeploySrc.match(/const\s+STAGING_SHARED_TOWN3D_FILES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(sharedMatch, 'Could not find STAGING_SHARED_TOWN3D_FILES in scripts/stage-deploy.mjs');
  const sharedFiles = [...sharedMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(sharedFiles.includes('move-in.html'), 'STAGING_SHARED_TOWN3D_FILES must include move-in.html');
  assert.ok(!fs.existsSync(path.join(BUNDLE_DIR, 'move-in.html')), 'staging-polyfork/move-in.html should not exist directly in bundle');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'town-3d/move-in.html')), 'town-3d/move-in.html must exist');

  const uiSec = getSection(readmeMd, 'UI parity (slices 65a–65c)');
  assert.ok(uiSec.includes('town-3d/move-in.html'), '## UI parity must state move-in.html lives in town-3d/move-in.html');
  assert.ok(uiSec.includes('STAGING_SHARED_TOWN3D_FILES'), '## UI parity must cite STAGING_SHARED_TOWN3D_FILES');
  assert.ok(uiSec.includes('scripts/stage-deploy.mjs'), '## UI parity must cite scripts/stage-deploy.mjs');
});
