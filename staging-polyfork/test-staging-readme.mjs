/**
 * Drift-guard test for staging-polyfork/README.md against PLAN.md,
 * staging-polyfork/index.html, staging-polyfork/staging.js,
 * staging-polyfork/events.json, and scripts/stage-deploy.mjs (Slice 130).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

test('staging-polyfork/README.md bundle file count matches stage-deploy.mjs --bundle staging-polyfork', () => {
  const contentsSec = getSection(readmeMd, 'Contents').replace(/\s+/g, ' ');
  const countMatch = contentsSec.match(/(\d+)\s+files,\s+verified by `scripts\/stage-deploy\.mjs --bundle staging-polyfork`/);
  assert.ok(countMatch, '## Contents must state "<N> files, verified by `scripts/stage-deploy.mjs --bundle staging-polyfork`"');
  const expectedCount = Number(countMatch[1]);

  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-stage-'));
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts/stage-deploy.mjs'), '--bundle', 'staging-polyfork', '--out', tmpOut],
      { encoding: 'utf8' }
    );
    const result = JSON.parse(out.trim());
    assert.equal(result.ok, true, 'stage-deploy.mjs must succeed');
    assert.equal(
      result.file_count,
      expectedCount,
      `README bundle file count (${expectedCount}) must match stage-deploy.mjs file_count (${result.file_count})`
    );
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test('staging-polyfork/README.md ## Buildings coordinates and params match staging.js', () => {
  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  const fmtCoord = (n) => (n < 0 ? `−${Math.abs(n)}` : String(n));

  const miloMatch = stagingJs.match(/const\s+MILO_PLOT\s*=\s*\{\s*x:\s*([\d.]+),\s*z:\s*([\d.]+)\s*\}/);
  assert.ok(miloMatch, 'Could not parse MILO_PLOT in staging.js');
  assert.ok(
    buildingsSec.includes(`(${miloMatch[1]}, ${miloMatch[2]})`),
    `## Buildings must state Milo's Cottage at (${miloMatch[1]}, ${miloMatch[2]})`
  );

  const gateMatch = stagingJs.match(/place\(Gatehouse,\s*\{[^}]*gateState:\s*'([^']+)',\s*windows:\s*(\d+)[^}]*\},\s*(-?\d+),\s*(-?\d+)\)/);
  assert.ok(gateMatch, 'Could not parse Gatehouse placement in staging.js');
  assert.ok(
    buildingsSec.includes(`(${fmtCoord(Number(gateMatch[3]))}, ${fmtCoord(Number(gateMatch[4]))})`),
    `## Buildings must state Gatehouse at (${fmtCoord(Number(gateMatch[3]))}, ${fmtCoord(Number(gateMatch[4]))})`
  );
  assert.ok(buildingsSec.includes(`gateState \`${gateMatch[1]}\``), `## Buildings must state gateState ${gateMatch[1]}`);
  assert.ok(buildingsSec.includes(`windows ${gateMatch[2]}`), `## Buildings must state windows ${gateMatch[2]}`);

  const wellMatch = stagingJs.match(/place\(Well,\s*\{\s*\},\s*(-?\d+),\s*(-?\d+)\)/);
  assert.ok(wellMatch, 'Could not parse Well placement in staging.js');
  assert.ok(
    buildingsSec.includes(`(${fmtCoord(Number(wellMatch[1]))}, ${fmtCoord(Number(wellMatch[2]))})`),
    `## Buildings must state Well at (${fmtCoord(Number(wellMatch[1]))}, ${fmtCoord(Number(wellMatch[2]))})`
  );

  const millMatch = stagingJs.match(/place\(Windmill,\s*\{\s*tallness:\s*([\d.]+)[^}]*\},\s*(-?\d+),\s*(-?\d+)\)/);
  assert.ok(millMatch, 'Could not parse Windmill placement in staging.js');
  assert.ok(
    buildingsSec.includes(`(${fmtCoord(Number(millMatch[2]))}, ${fmtCoord(Number(millMatch[3]))})`),
    `## Buildings must state Windmill at (${fmtCoord(Number(millMatch[2]))}, ${fmtCoord(Number(millMatch[3]))})`
  );
  assert.ok(buildingsSec.includes(`tallness ${millMatch[1]}`), `## Buildings must state Windmill tallness ${millMatch[1]}`);
});

test('staging-polyfork/README.md ## Terrain params and night shadowSpan match staging.js', () => {
  const terrainSec = getSection(readmeMd, 'Terrain (as built — no fallbacks needed)').replace(/\s+/g, ' ');

  const tpMatch = stagingJs.match(
    /const\s+TERRAIN_PARAMS\s*=\s*\{\s*span:\s*(\d+),\s*clearing:\s*(\d+),\s*flatten:\s*([\d.]+),\s*lake:\s*([\d.]+),\s*colorway:\s*'([^']+)',\s*edges:\s*'([^']+)'/
  );
  assert.ok(tpMatch, 'Could not parse TERRAIN_PARAMS in staging.js');
  const [, span, clearing, flatten, lake, colorway, edges] = tpMatch;
  for (const [label, val] of [
    ['span', span],
    ['clearing', clearing],
    ['flatten', flatten],
    ['lake', lake],
    ['colorway', colorway],
    ['edges', edges],
  ]) {
    assert.ok(terrainSec.includes(`| ${label} | ${val} |`), `## Terrain table must state ${label} = ${val}`);
  }

  const settingMatch = stagingJs.match(/setting:\s*([\d.]+)/);
  assert.ok(settingMatch, 'Could not parse buildKit setting in staging.js');
  assert.ok(terrainSec.includes(`setting: ${settingMatch[1]}`), `## Terrain must state setting: ${settingMatch[1]}`);

  const skipMatch = stagingJs.match(/skip:\s*\[([^\]]+)\]/);
  assert.ok(skipMatch, 'Could not parse buildKit skip list in staging.js');
  const skipItems = [...skipMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.equal(skipItems.length, 2, 'Expected 2 skipped scatter items in staging.js');
  assert.ok(skipItems.includes('lakeside-swing-tree'), 'staging.js skip list must include lakeside-swing-tree');
  assert.ok(terrainSec.includes('lakeside-swing-tree'), '## Terrain must mention lakeside-swing-tree in skip note');

  const shadowMatch = stagingJs.match(/stage\(renderer,\s*scene,\s*\{\s*time:\s*'night',\s*shadowSpan:\s*(\d+)\s*\}\)/);
  assert.ok(shadowMatch, 'Could not parse stage() shadowSpan in staging.js');
  assert.ok(
    terrainSec.includes(`shadowSpan: ${shadowMatch[1]}`),
    `## Terrain must state shadowSpan: ${shadowMatch[1]}`
  );
});

test('staging-polyfork/README.md Inn front-upper window X coords match inn-nightly-call.mjs', () => {
  const innSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'inn-nightly-call.mjs'), 'utf8');
  const arrMatch = innSrc.match(/const\s+FRONT_UPPER_WINDOWS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(arrMatch, 'Could not parse FRONT_UPPER_WINDOWS in inn-nightly-call.mjs');

  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups').replace(/\s+/g, ' ');
  for (const m of arrMatch[1].matchAll(/\{\s*zone:\s*'([^']+)',\s*x:\s*(-?[\d.]+)\s*\}/g)) {
    const zone = m[1];
    const xNum = Number(m[2]);
    const formatted = `X(${xNum >= 0 ? '+' : '-'}${Math.abs(xNum).toFixed(2)})`;
    assert.ok(limitsSec.includes(formatted), `## Known limits must state ${zone} window ${formatted}`);
  }
});

test('staging-polyfork/README.md ## Contents test files match disk and run-tests.mjs', () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const listedTests = new Set();
  for (const line of contentsSec.split(/\r?\n/)) {
    if (!line.startsWith('- ')) continue;
    const bulletText = line.split(' — ')[0];
    for (const m of bulletText.matchAll(/`(test-[^`]+\.mjs)`/g)) {
      listedTests.add(m[1]);
    }
  }

  const diskTests = fs
    .readdirSync(BUNDLE_DIR)
    .filter((name) => /^test-.*\.mjs$/.test(name))
    .sort();
  assert.ok(diskTests.length >= 17, `Expected at least 17 test-*.mjs files in staging-polyfork/, found ${diskTests.length}`);

  const runTestsSrc = fs.readFileSync(path.join(REPO_ROOT, 'run-tests.mjs'), 'utf8');
  const registeredTests = new Set(
    [...runTestsSrc.matchAll(/'staging-polyfork\/(test-[^']+\.mjs)'/g)].map((m) => m[1])
  );

  for (const fileName of diskTests) {
    assert.ok(listedTests.has(fileName), `Test file "${fileName}" on disk is missing from ## Contents`);
    assert.ok(registeredTests.has(fileName), `Test file "${fileName}" on disk is missing from run-tests.mjs`);
  }
  for (const fileName of registeredTests) {
    assert.ok(listedTests.has(fileName), `Registered suite "${fileName}" in run-tests.mjs is missing from ## Contents`);
  }
});
