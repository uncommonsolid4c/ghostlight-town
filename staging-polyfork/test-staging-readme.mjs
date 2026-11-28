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

test('staging-polyfork/README.md lamp posts, pines, and pine triangle counts match staging.js and parts/', () => {
  const lampArrMatch = stagingJs.match(
    /for\s*\(const\s*\[x,\s*z,\s*s\]\s*of\s*(\[\[[^\n]+\]\])\)\s*\{\s*place\(LampPost,\s*\{\s*scale:\s*s\s*\},\s*x,\s*z/
  );
  assert.ok(lampArrMatch, 'Could not parse LampPost placement array in staging.js');
  const lamps = JSON.parse(lampArrMatch[1]);
  assert.equal(lamps.length, 4, 'Expected 4 lamp posts in staging.js');
  assert.deepEqual(lamps, [
    [-3.2, 26.2, 1.8],
    [3.2, 26.2, 1.8],
    [-8.5, 17.5, 1.4],
    [8.5, 6.5, 1.4],
  ]);

  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  assert.ok(buildingsSec.includes('(±3.2, 26.2) scale 1.8'), '## Buildings must state lamp posts (±3.2, 26.2) scale 1.8');
  assert.ok(buildingsSec.includes('(−8.5, 17.5), (8.5, 6.5) scale 1.4'), '## Buildings must state lamp posts (−8.5, 17.5), (8.5, 6.5) scale 1.4');

  const pineCountMatch = stagingJs.match(/while\s*\(counts\.pines\s*<\s*(\d+)/);
  const pineRadiusMatch = stagingJs.match(/r\s*=\s*(\d+)\s*\+\s*rnd\(\)\s*\*\s*(\d+)/);
  const pineScaleMatch = stagingJs.match(/tree\.scale\.setScalar\(([\d.]+)\s*\+\s*rnd\(\)\s*\*\s*([\d.]+)\)/);
  assert.ok(pineCountMatch && pineRadiusMatch && pineScaleMatch, 'Could not parse pine loop parameters in staging.js');

  const pineCount = Number(pineCountMatch[1]);
  const rMin = Number(pineRadiusMatch[1]);
  const rMax = rMin + Number(pineRadiusMatch[2]);
  const sMin = Number(pineScaleMatch[1]);
  const sMax = Number((sMin + Number(pineScaleMatch[2])).toFixed(2));

  assert.ok(buildingsSec.includes(`Pines: ${pineCount} trees`), `## Buildings Pines line must state ${pineCount} trees`);
  assert.ok(buildingsSec.includes(`radius ${rMin}–${rMax} m`), `## Buildings Pines line must state radius ${rMin}–${rMax} m`);
  assert.ok(buildingsSec.includes(`scale ${sMin}–${sMax}`), `## Buildings Pines line must state scale ${sMin}–${sMax}`);

  const tallPineSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'parts/tall-pine-tree-ab4108.mjs'), 'utf8');
  const youngPineSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'parts/young-pine-0d7695.mjs'), 'utf8');
  const tallTris = tallPineSrc.match(/SPECS\s+(\d+)\s+triangles/);
  const youngTris = youngPineSrc.match(/SPECS\s+(\d+)\s+triangles/);
  assert.ok(tallTris && youngTris, 'Could not parse SPECS triangle counts in parts/*.mjs');

  const contentsSec = getSection(readmeMd, 'Contents').replace(/\s+/g, ' ');
  assert.ok(
    contentsSec.includes(`\`tall-pine-tree-ab4108.mjs\` (${tallTris[1]} tris)`),
    `## Contents must state tall-pine-tree-ab4108.mjs (${tallTris[1]} tris)`
  );
  assert.ok(
    contentsSec.includes(`\`young-pine-0d7695.mjs\` (${youngTris[1]} tris)`),
    `## Contents must state young-pine-0d7695.mjs (${youngTris[1]} tris)`
  );
});

test('staging-polyfork/README.md daylight drift 30-minute cycle matches daylight-drift.mjs', async () => {
  const { DAYLIGHT_DRIFT_CONFIG } = await import('./daylight-drift.mjs');
  const driftSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'daylight-drift.mjs'), 'utf8');

  assert.equal(DAYLIGHT_DRIFT_CONFIG.cycleSeconds, 30 * 60, 'DAYLIGHT_DRIFT_CONFIG.cycleSeconds must be 30 * 60');
  assert.deepEqual(
    DAYLIGHT_DRIFT_CONFIG.keyframes.map((k) => k.name),
    ['night', 'dawn', 'overcast', 'dawn', 'night'],
    'DAYLIGHT_DRIFT_CONFIG.keyframes must follow night -> dawn -> overcast -> dawn -> night'
  );
  assert.match(driftSrc, /capped well below noon/i, 'daylight-drift.mjs header must document below-noon cap');

  const terrainSec = getSection(readmeMd, 'Terrain (as built — no fallbacks needed)').replace(/\s+/g, ' ');
  assert.ok(terrainSec.includes('30-minute clock'), '## Terrain must state 30-minute clock');
  assert.ok(
    terrainSec.includes('night → dawn → overcast → dawn → night'),
    '## Terrain must state night → dawn → overcast → dawn → night'
  );
  assert.ok(terrainSec.includes('capped below noon'), '## Terrain must state below-noon cap');
});

test('staging-polyfork/README.md prompt-book.mjs bullet covers [NPC] and [guest] pills', async () => {
  const { renderPromptBook } = await import('./prompt-book.mjs');
  const makeEl = (tag) => {
    const el = { tag, className: '', textContent: '', children: [] };
    el.appendChild = (c) => { el.children.push(c); };
    el.removeChild = (c) => { el.children = el.children.filter((x) => x !== c); };
    Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
    return el;
  };
  const doc = { createElement: makeEl };
  const container = makeEl('div');
  renderPromptBook(container, [
    { id: 1, handle: 'wick', role: 'npc', kind: 'say', body: 'Hello' },
    { id: 2, handle: 'visitor', role: 'guest', kind: 'say', body: 'Hi' },
  ], doc);

  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].children[0].className, 'pb-npc-pill');
  assert.equal(container.children[0].children[0].textContent, '[NPC]');
  assert.equal(container.children[1].children[0].className, 'pb-guest-pill');
  assert.equal(container.children[1].children[0].textContent, '[guest]');

  const contentsSec = getSection(readmeMd, 'Contents');
  const pbBullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`prompt-book.mjs`'));
  assert.ok(pbBullet, '## Contents must have a prompt-book.mjs bullet');
  assert.ok(pbBullet.includes('[NPC]') && pbBullet.includes('.pb-npc-pill'), 'prompt-book.mjs bullet must mention [NPC] (.pb-npc-pill)');
  assert.ok(pbBullet.includes('[guest]') && pbBullet.includes('.pb-guest-pill'), 'prompt-book.mjs bullet must mention [guest] (.pb-guest-pill)');
});

test('staging-polyfork/README.md Known limits states state.events is live matching town-api/server.mjs', () => {
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/server.mjs'), 'utf8');
  assert.match(
    serverSrc,
    /events:\s*\{\s*now:\s*nowEvent,\s*next:\s*nextEvent\s*\}/,
    'town-api/server.mjs must include events: { now: nowEvent, next: nextEvent } in state'
  );

  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups');
  const eventBullet = limitsSec.split(/\r?\n- /).find((b) => b.includes('Event banner reads `events.json` directly'));
  assert.ok(eventBullet, '## Known limits must have the Event banner bullet');
  const normBullet = eventBullet.replace(/\s+/g, ' ');
  assert.ok(!/not live yet/i.test(normBullet), 'Event banner bullet must not claim state.events is "not live yet"');
  assert.ok(!/does not yet serve/i.test(normBullet), 'Event banner bullet must not claim server "does not yet serve" events');
  assert.ok(
    /`state\.events`\s+is\s+live/i.test(normBullet) || /`state\.events`[^.]*\bis live\b/i.test(normBullet),
    'Event banner bullet must state state.events is live'
  );
  assert.ok(normBullet.includes('TOWN_EVENTS_PATH'), 'Event banner bullet must keep TOWN_EVENTS_PATH');
});

test('staging-polyfork/README.md Nightly Call card wrap (22) and event banner default (30) match sources', () => {
  const innSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'inn-nightly-call.mjs'), 'utf8');
  const bannerSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'event-banner.mjs'), 'utf8');

  assert.match(innSrc, /splitNightlyCallLines\(topic,\s*22\)/, 'inn-nightly-call.mjs must wrap Nightly Call topic at 22');
  assert.match(innSrc, /width:\s*1024,\s*\n\s*height:\s*512/, 'inn-nightly-call.mjs card must be 1024x512');
  assert.match(innSrc, /longest 53 chars.*wraps to at most 3 lines/s, 'inn-nightly-call.mjs doc must state longest 53 chars wraps to at most 3 lines');
  assert.match(innSrc, /export function splitNightlyCallLines\(topic,\s*maxLineLen\s*=\s*30\)/, 'splitNightlyCallLines default must be 30');
  assert.match(bannerSrc, /splitNightlyCallLines\(title\)/, 'event-banner.mjs must call splitNightlyCallLines(title) with no second arg');

  const contentsSec = getSection(readmeMd, 'Contents').replace(/\s+/g, ' ');
  const innBullet = contentsSec.split(' - ').find((b) => b.startsWith('`inn-nightly-call.mjs`'));
  assert.ok(innBullet, '## Contents must have an inn-nightly-call.mjs bullet');
  assert.ok(innBullet.includes('22 chars'), 'inn-nightly-call.mjs bullet must state 22 chars wrap');
  assert.ok(innBullet.includes('53-char'), 'inn-nightly-call.mjs bullet must state 53-char longest topic');
  assert.ok(innBullet.includes('at most 3 lines'), 'inn-nightly-call.mjs bullet must state at most 3 lines');
  assert.ok(innBullet.includes('`30` is the event banner\'s 768px default'), 'inn-nightly-call.mjs bullet must state 30 is the event banner 768px default');
});

test('staging-polyfork/README.md Verification and Controls claims match staging.js and index.html', () => {
  assert.match(stagingJs, /window\.__stagingReady\s*=\s*true;/, 'staging.js must set window.__stagingReady = true on success');
  assert.match(stagingJs, /window\.__stagingError\s*=/, 'staging.js must set window.__stagingError on failure');

  const verifySec = getSection(readmeMd, 'Verification done locally (no browser here — no visual check claimed)').replace(/\s+/g, ' ');
  assert.ok(verifySec.includes('`window.__stagingReady` is set true on success'), '## Verification must state window.__stagingReady');
  assert.ok(verifySec.includes('`window.__stagingError` carries the failure message'), '## Verification must state window.__stagingError');

  assert.match(
    indexHtml,
    /window\.matchMedia\('\(pointer: coarse\)'\)\.matches[\s\S]*controlsHint\.textContent\s*=/,
    'index.html must swap #controls-hint textContent for (pointer: coarse)'
  );
  const controlsSec = getSection(readmeMd, 'Controls').replace(/\s+/g, ' ');
  assert.ok(
    controlsSec.includes('Coarse-pointer devices swap the footer `#controls-hint` to touch-first copy'),
    '## Controls must state coarse-pointer #controls-hint swap'
  );
});

test('staging-polyfork/README.md Buildings table Tavern recolor, sign removal, and night interior match staging.js and tavern.mjs', () => {
  const tavernMatch = stagingJs.match(
    /place\(Tavern,\s*\{\s*width:\s*(\d+),\s*plaster:\s*(\w+),\s*tile:\s*(\w+),\s*timber:\s*(\w+)\s*\},\s*(-?\d+),\s*(-?\d+),\s*\{\s*remove:\s*'sign'\s*\}\)/
  );
  assert.ok(tavernMatch, 'Could not parse Tavern placement with remove: sign in staging.js');
  const [, width, plasterSym, tileSym, timberSym, tx, tz] = tavernMatch;
  assert.equal(width, '10');
  assert.equal(plasterSym, 'CREAM');
  assert.equal(tileSym, 'ROOF');
  assert.equal(timberSym, 'CEDAR');
  assert.equal(tx, '-11');
  assert.equal(tz, '20');

  const resolveColor = (name) => {
    const m = stagingJs.match(new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)'`));
    assert.ok(m, `Could not resolve color constant ${name} in staging.js`);
    return m[1];
  };
  const plasterHex = resolveColor(plasterSym);
  const tileHex = resolveColor(tileSym);
  const timberHex = resolveColor(timberSym);
  assert.equal(plasterHex, '#f5efe0');
  assert.equal(tileHex, '#5a4332');
  assert.equal(timberHex, '#6b492b');

  const tavernSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'kit-medieval/tavern.mjs'), 'utf8');
  const interiorMatch = tavernSrc.match(/interior:\s*\{\s*color:\s*'([^']+)',\s*intensity:\s*([\d.]+)/);
  assert.ok(interiorMatch, 'Could not parse night.interior in kit-medieval/tavern.mjs');
  assert.equal(interiorMatch[1], '#ffb45c');
  assert.equal(Number(interiorMatch[2]), 0.6);

  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  for (const expected of [
    '(−11, 20)',
    `width ${width}`,
    `plaster ${plasterHex}`,
    `tile ${tileHex}`,
    `timber ${timberHex}`,
    'hanging sign REMOVED',
    `interior ${interiorMatch[1]}`,
  ]) {
    assert.ok(buildingsSec.includes(expected), `## Buildings must include "${expected}"`);
  }
});

test('staging-polyfork/README.md Buildings table Resident Cottages ring and seed signposts match avatar.mjs; decorative cottages absent from staging.js', async () => {
  const { TOWN_LAYOUT, SEED_HOME_PADS } = await import('./avatar.mjs');
  const avatarSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'avatar.mjs'), 'utf8');

  assert.equal(TOWN_LAYOUT.plotRadius, 18.5);
  assert.match(avatarSrc, /startAngle\s*=\s*0\.42\s*\*\s*Math\.PI/, 'avatar.mjs must use startAngle = 0.42 * Math.PI');
  assert.match(avatarSrc, /endAngle\s*=\s*1\.58\s*\*\s*Math\.PI/, 'avatar.mjs must use endAngle = 1.58 * Math.PI');
  assert.deepEqual(SEED_HOME_PADS, { wick: 2, maren: 3, tomas: 4 });

  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  for (const expected of [
    'plot ring (r = 18.5 m, 0.42π→1.58π)',
    '`wick`→2',
    '`maren`→3',
    '`tomas`→4',
    'decorative cottages at (15, −8) and (−16, −9) removed',
  ]) {
    assert.ok(buildingsSec.includes(expected), `## Buildings must include "${expected}"`);
  }

  assert.doesNotMatch(stagingJs, /15,\s*-8/, 'Decorative cottage (15, -8) must be absent from staging.js');
  assert.doesNotMatch(stagingJs, /-16,\s*-9/, 'Decorative cottage (-16, -9) must be absent from staging.js');
});

test('staging-polyfork/README.md Buildings table Bandstand ghost drift and footlight 0 match staging.js, npc-wander.mjs, and concept-bandstand.js', async () => {
  assert.match(stagingJs, /includeStageProps:\s*true/, 'staging.js must pass includeStageProps: true');
  assert.match(stagingJs, /lightMiloFootlight:\s*true/, 'staging.js must pass lightMiloFootlight: true');
  assert.match(stagingJs, /spot:\s*bandstandBuilt\.avatarSpots\[0\]/, 'staging.js must place ghost at bandstandBuilt.avatarSpots[0]');
  assert.match(stagingJs, /includeEyeSpheres:\s*false/, 'staging.js must pass includeEyeSpheres: false');

  const { GHOST_DRIFT_CONFIG } = await import('./npc-wander.mjs');
  const wanderSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'npc-wander.mjs'), 'utf8');
  assert.equal(GHOST_DRIFT_CONFIG.speed, 0.35);
  assert.deepEqual(GHOST_DRIFT_CONFIG.lingers, { spot0: 25, deck1: 8, deck2: 10, deck3: 8 });
  assert.equal(GHOST_DRIFT_CONFIG.deckPoints.length, 3);
  assert.deepEqual(
    GHOST_DRIFT_CONFIG.deckPoints.map((p) => p.label),
    ['deck1', 'deck2', 'deck3']
  );
  assert.match(
    wanderSrc,
    /waypoints:\s*\[\s*\{\s*x:\s*spot0\.x[^}]*label:\s*'spot0'\s*\},\s*\.\.\.GHOST_DRIFT_CONFIG\.deckPoints\.map/,
    'buildStagingGhostDrift waypoints must start with spot0 then spread GHOST_DRIFT_CONFIG.deckPoints'
  );

  const bandstandSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'concept-bandstand.js'), 'utf8');
  assert.match(bandstandSrc, /pointLightColor:\s*'#ffaa44'/, 'concept-bandstand.js must set pointLightColor: #ffaa44');
  assert.match(bandstandSrc, /light\.name\s*=\s*'ghostlight_point_light'/, 'concept-bandstand.js must name light ghostlight_point_light');

  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  for (const expected of [
    '`includeStageProps: true`',
    '`lightMiloFootlight: true`',
    '`includeEyeSpheres: false`',
    '`spot0` + 3 deck points, 0.35 m/s',
    'returns to `avatarSpots[0]`',
    'footlight 0 stays lit',
    '`ghostlight_point_light` (#ffaa44) + footlight slot 0',
  ]) {
    assert.ok(buildingsSec.includes(expected), `## Buildings must include "${expected}"`);
  }
});

test('staging-polyfork/README.md NPC stand-ins table params and moved-outward coords match staging.js and concept-bandstand.js', () => {
  const resolveColor = (token) => {
    if (token.startsWith("'")) return token.slice(1, -1);
    const m = stagingJs.match(new RegExp(`const\\s+${token}\\s*=\\s*'([^']+)'`));
    assert.ok(m, `Could not resolve color ${token} in staging.js`);
    return m[1];
  };

  const mapMatch = stagingJs.match(/const\s+npcStandIns\s*=\s*new\s+Map\(\[([\s\S]*?)\]\);/);
  assert.ok(mapMatch, 'Could not parse npcStandIns Map in staging.js');
  const entries = [...mapMatch[1].matchAll(
    /\['(\w+)',\s*\{\s*group:\s*place\((Villager|Tradesman),\s*\{([\s\S]*?)\},\s*(-?[\d.]+),\s*(-?[\d.]+)\)/g
  )];
  assert.equal(entries.length, 3, 'Expected 3 entries in npcStandIns');

  const parsed = new Map();
  for (const [, handle, cls, paramsRaw, xStr, zStr] of entries) {
    const getParam = (key) => {
      const m = paramsRaw.match(new RegExp(`${key}:\\s*('[^']+'|[\\d.]+|[A-Z_]+)`));
      return m ? m[1] : null;
    };
    const x = Number(xStr);
    const z = Number(zStr);
    assert.ok(Math.hypot(x, z) > 4.5, `${handle} distance from origin (${Math.hypot(x, z).toFixed(2)}) must exceed 4.5 m`);
    parsed.set(handle, {
      cls,
      figure: resolveColor(getParam('figure')),
      age: resolveColor(getParam('age')),
      expression: resolveColor(getParam('expression')),
      build: getParam('build'),
      tunic: resolveColor(getParam('tunic')),
      apron: resolveColor(getParam('apron')),
      hair: getParam('hair') ? resolveColor(getParam('hair')) : null,
      x,
      z,
    });
  }

  assert.deepEqual(parsed.get('wick'), {
    cls: 'Villager',
    figure: 'masculine',
    age: 'adult',
    expression: 'alert',
    build: '0.9',
    tunic: '#7a6a55',
    apron: '#6b492b',
    hair: '#5a4632',
    x: 4.16,
    z: 4.99,
  });
  assert.deepEqual(parsed.get('maren'), {
    cls: 'Tradesman',
    figure: 'feminine',
    age: 'old',
    expression: 'warm',
    build: '0.9',
    tunic: '#6a7a8a',
    apron: '#f5efe0',
    hair: '#e8e8e8',
    x: -3.53,
    z: 5.46,
  });
  assert.deepEqual(parsed.get('tomas'), {
    cls: 'Tradesman',
    figure: 'masculine',
    age: 'old',
    expression: 'warm',
    build: '1.0',
    tunic: '#8a7a5a',
    apron: '#5a4332',
    hair: '#cfcfcf',
    x: 0.76,
    z: -6.46,
  });

  const bandstandSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'concept-bandstand.js'), 'utf8');
  assert.match(
    bandstandSrc,
    /export\s+const\s+BANDSTAND_LAYOUT\s*=\s*\{[^}]*radius:\s*4\.5\b/,
    'concept-bandstand.js BANDSTAND_LAYOUT must have radius: 4.5'
  );

  const npcSec = getSection(readmeMd, 'NPC stand-ins').replace(/\s+/g, ' ');
  for (const expected of [
    'villager | masculine, adult, `alert`, build 0.9, tunic #7a6a55, apron #6b492b',
    'tradesman | feminine, old, `warm`, build 0.9, tunic #6a7a8a, apron #f5efe0, hair #e8e8e8',
    'tradesman | masculine, old, `warm`, build 1.0, tunic #8a7a5a, apron #5a4332, hair #cfcfcf',
    'Wick at (4.16, 4.99)',
    'Maren at (−3.53, 5.46)',
    'Tomas at (0.76, −6.46)',
    'bandstand deck (radius 4.5 m)',
  ]) {
    assert.ok(npcSec.includes(expected), `## NPC stand-ins must include "${expected}"`);
  }
});

test('staging-polyfork/README.md header live-state poller discipline matches staging.js and concept-bandstand.js', () => {
  const contentsIdx = readmeMd.indexOf('## Contents');
  assert.ok(contentsIdx !== -1, 'README.md must have ## Contents');
  const header = readmeMd.slice(0, contentsIdx).replace(/\s+/g, ' ');

  assert.ok(
    header.includes('polls `GET /api/town/state` (5 s base, ×2 backoff to 60 s, `?since=`, 304 no-op)'),
    'README header must document GET /api/town/state poller discipline'
  );
  assert.ok(
    header.includes('footlights slots 1–9 by role (`muse` / `npc`, leaving slot 0 / Milo permanent)'),
    'README header must document footlights slots 1–9 and permanent slot 0'
  );

  assert.match(
    stagingJs,
    /constructor\(\{[^}]*pollIntervalMs\s*=\s*5000,\s*maxBackoffMs\s*=\s*60000/,
    'StagingLive constructor defaults must be pollIntervalMs = 5000, maxBackoffMs = 60000'
  );
  assert.match(
    stagingJs,
    /this\.currentIntervalMs\s*=\s*Math\.min\(this\.maxBackoffMs,\s*this\.currentIntervalMs\s*\*\s*2\)/,
    'StagingLive._backoff must double interval capped at maxBackoffMs'
  );
  assert.ok(
    stagingJs.includes('`?since=${encodeURIComponent(this.lastSeq)}`'),
    'StagingLive.pollOnce must append ?since= when lastSeq is set'
  );
  assert.match(
    stagingJs,
    /if\s*\(res\.status\s*===\s*304\)\s*\{[\s\S]*?this\.currentIntervalMs\s*=\s*this\.baseIntervalMs;/,
    'StagingLive.pollOnce must reset interval on 304'
  );
  assert.match(
    stagingJs,
    /Number\.isInteger\(row\.slot\) &&\s*row\.slot >= 1 &&\s*row\.slot < footlights\.length/,
    'applyStagingState must only light slots >= 1'
  );
  assert.ok(
    stagingJs.includes('if (slot === 0 || flGroup.userData?.permanent) continue;'),
    'applyStagingState must skip slot 0 / permanent footlight'
  );

  const bandstandSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'concept-bandstand.js'), 'utf8');
  assert.match(bandstandSrc, /footlightCount:\s*10\b/, 'concept-bandstand.js must set footlightCount: 10');
});

test('staging-polyfork/README.md UI parity move-in CTA, footer bar, mobile pass, and no pinchFov match index.html, staging.js, and tap-glide.mjs', async () => {
  const uiSec = getSection(readmeMd, 'UI parity (slices 65a–65c)').replace(/\s+/g, ' ');
  for (const expected of [
    '`#move-in-cta` (`href="move-in.html"`)',
    "`#footer-bar` (`Move in →` + `← back to Milo's corner`)",
    '@media (max-width: 640px)',
    '44 px tap targets',
    'HUD title ellipsis',
    'Prompt Book repositioned below HUD',
    'wrapped footer',
    '`pinchFov` is deliberately not ported',
  ]) {
    assert.ok(uiSec.includes(expected), `## UI parity must include "${expected}"`);
  }

  assert.ok(
    indexHtml.includes('<a id="move-in-cta" href="move-in.html">Move in &rarr;</a>'),
    'index.html must include #move-in-cta linking to move-in.html'
  );
  const footerMatch = indexHtml.match(/<footer id="footer-bar">([\s\S]*?)<\/footer>/);
  assert.ok(footerMatch, 'index.html must include #footer-bar');
  assert.ok(footerMatch[1].includes('<a href="move-in.html">Move in &rarr;</a>'), '#footer-bar must include Move in link');
  assert.ok(
    footerMatch[1].includes('<a href="https://milo.4167360.xyz/"') &&
      footerMatch[1].includes('&larr; back to Milo&apos;s corner</a>'),
    "#footer-bar must include back to Milo's corner link"
  );

  const mediaIdx = indexHtml.indexOf('@media (max-width: 640px)');
  assert.ok(mediaIdx !== -1, 'index.html must include @media (max-width: 640px)');
  const mediaBlock = indexHtml.slice(mediaIdx, indexHtml.indexOf('</style>', mediaIdx));
  assert.match(mediaBlock, /#hud h1\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/);
  assert.match(mediaBlock, /#move-in-cta\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/);
  assert.match(mediaBlock, /#prompt-book\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*168px;/);
  assert.match(mediaBlock, /#footer-bar\s*\{[^}]*flex-wrap:\s*wrap;/);

  const tapGlideSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'tap-glide.mjs'), 'utf8');
  assert.ok(!stagingJs.includes('pinchFov'), 'staging.js must not contain pinchFov');
  assert.ok(!indexHtml.includes('pinchFov'), 'index.html must not contain pinchFov');
  assert.ok(!tapGlideSrc.includes('pinchFov'), 'tap-glide.mjs must not contain pinchFov');

  const { DEFAULT_ORBIT_GLIDE_MAX_RADIUS } = await import('./tap-glide.mjs');
  assert.equal(DEFAULT_ORBIT_GLIDE_MAX_RADIUS, 38);
  assert.match(tapGlideSrc, /dragThreshold\s*=\s*4\b/, 'tap-glide.mjs must default dragThreshold = 4');
});

test('staging-polyfork/README.md fishing.mjs bullet (45-degree finder, rod, tackle, cedar line, cream bobber, three ripples) matches fishing.mjs', async () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`fishing.mjs`'));
  assert.ok(bullet, '## Contents must have a `fishing.mjs` bullet');
  const norm = bullet.replace(/\s+/g, ' ');
  for (const phrase of [
    '`findFishingSpot`',
    '`buildFishingSpot`',
    'deterministic 45° shore-crossing finder plus propped rod, tackle box, cedar line, cream bobber, and three ripple rings',
  ]) {
    assert.ok(norm.includes(phrase), `fishing.mjs bullet must include "${phrase}"`);
  }

  const fishingSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'fishing.mjs'), 'utf8');
  const mod = await import('./fishing.mjs');
  assert.equal(typeof mod.findFishingSpot, 'function');
  assert.equal(typeof mod.buildFishingSpot, 'function');

  assert.ok(fishingSrc.includes('45 degrees measured from south (+z) toward east (+x)'));
  assert.ok(fishingSrc.includes('const BEARING_RAD = Math.PI / 4;'));
  assert.ok(fishingSrc.includes("rod.name = 'propped-fishing-rod';"));
  assert.ok(fishingSrc.includes("tackleBox.name = 'tackle-box';"));
  assert.ok(fishingSrc.includes("const CEDAR = '#6b492b';"));
  assert.match(fishingSrc, /lineMat\s*=\s*new THREE\.MeshStandardMaterial\(\{\s*color:\s*CEDAR\b/);
  assert.match(fishingSrc, /bobber\s*=\s*new THREE\.Mesh\(bobberGeom,\s*creamMat\)/);
  assert.ok(fishingSrc.includes('const RIPPLE_RADII = [0.3, 0.6, 0.9];'));
  assert.ok(fishingSrc.includes('ripple.name = `ripple-${i}`;'));
});

test('staging-polyfork/README.md garden.mjs bullet (6-slot east bed, exports, sprout-leaf-bloom stages) matches garden.mjs and server.mjs', async () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`garden.mjs`'));
  assert.ok(bullet, '## Contents must have a `garden.mjs` bullet');
  const norm = bullet.replace(/\s+/g, ' ');
  for (const phrase of [
    'communal 6-slot garden bed east of the Bandstand',
    '`GARDEN_BED`',
    '`SEED_COLORS`',
    '`gardenStageForAgeDays`',
    '`buildGardenPlant`',
    '`buildGardenBed`',
    '`updateGardenBed`',
    'deterministic `sprout` → `leaf` → `bloom` stages',
  ]) {
    assert.ok(norm.includes(phrase), `garden.mjs bullet must include "${phrase}"`);
  }

  const gardenSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'garden.mjs'), 'utf8');
  const mod = await import('./garden.mjs');
  assert.deepEqual(mod.GARDEN_BED, { x: 6.5, z: 0 });
  assert.ok(mod.GARDEN_BED.x > 0, 'GARDEN_BED must be east (+x) of the Bandstand');
  assert.equal(typeof mod.SEED_COLORS, 'object');
  for (const fn of ['gardenStageForAgeDays', 'buildGardenPlant', 'buildGardenBed', 'updateGardenBed']) {
    assert.equal(typeof mod[fn], 'function', `garden.mjs must export ${fn}`);
  }

  assert.ok(gardenSrc.includes("if (!Number.isFinite(ageDays) || ageDays < 2) return 'sprout';"));
  assert.ok(gardenSrc.includes("if (ageDays < 4) return 'leaf';"));
  assert.ok(gardenSrc.includes("return 'bloom';"));

  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/server.mjs'), 'utf8');
  assert.ok(serverSrc.includes('const GARDEN_SLOTS = 6;'), 'town-api/server.mjs must define GARDEN_SLOTS = 6');
});

test('staging-polyfork/README.md empty-pad.mjs bullet (stone slab, OPEN PLOT #N, plots 2-8) matches empty-pad.mjs', async () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`empty-pad.mjs`'));
  assert.ok(bullet, '## Contents must have a `empty-pad.mjs` bullet');
  const norm = bullet.replace(/\s+/g, ' ');
  assert.ok(
    norm.includes('stone slab + `OPEN PLOT #N` signpost markers (`buildEmptyPadMarker`, `syncEmptyPadMarkers`) for unclaimed pads in plots 2–8'),
    'empty-pad.mjs bullet must document stone slab, OPEN PLOT #N, exports, and plots 2–8'
  );

  const emptyPadSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'empty-pad.mjs'), 'utf8');
  const mod = await import('./empty-pad.mjs');
  assert.equal(typeof mod.buildEmptyPadMarker, 'function');
  assert.equal(typeof mod.syncEmptyPadMarkers, 'function');
  assert.ok(emptyPadSrc.includes('for plots 2..8'));
  assert.ok(emptyPadSrc.includes('label: `OPEN PLOT #${plot.plotNumber}`'));
  assert.ok(emptyPadSrc.includes('for (const plot of TOWN_LAYOUT.plots.slice(1))'));
});

test('staging-polyfork/README.md interior-room.mjs bullet (4.0x3.4 envelope, builders, procedural lamp/typewriter/teapot) matches interior-room.mjs and concept-cottage.js', async () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`interior-room.mjs`'));
  assert.ok(bullet, '## Contents must have a `interior-room.mjs` bullet');
  const norm = bullet.replace(/\s+/g, ' ');
  for (const phrase of [
    '`buildInteriorRoom`',
    '`setInteriorVisible`',
    '`setInteriorPalette`',
    '`setInteriorDressing`',
    '4.0×3.4 m envelope',
    'procedural oil lamp, typewriter, and teapot builders',
  ]) {
    assert.ok(norm.includes(phrase), `interior-room.mjs bullet must include "${phrase}"`);
  }

  const interiorRoomSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'interior-room.mjs'), 'utf8');
  const conceptCottageSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'concept-cottage.js'), 'utf8');
  const mod = await import('./interior-room.mjs');
  for (const fn of [
    'buildInteriorRoom',
    'setInteriorVisible',
    'setInteriorPalette',
    'setInteriorDressing',
    'buildProceduralOilLamp',
    'buildProceduralTypewriter',
    'buildProceduralTeapot',
  ]) {
    assert.equal(typeof mod[fn], 'function', `interior-room.mjs must export ${fn}`);
  }

  assert.match(
    interiorRoomSrc,
    /4\.0 x 3\.4 m for Milo's cottage[\s\S]*?\(widthX = 4\.0, halfSpanZ = 1\.7 in concept-cottage\.js\)/
  );
  assert.match(conceptCottageSrc, /widthX\s*=\s*4\.0,\s*halfSpanZ\s*=\s*1\.7\b/);
  assert.ok(interiorRoomSrc.includes('const ROOM_WIDTH = 3.7;'));
  assert.ok(interiorRoomSrc.includes('const ROOM_DEPTH = 3.0;'));
});

test('staging-polyfork/README.md interior-visit.mjs bullet (isDoorHit, rayHitsInteriorDoor, createInteriorVisit) matches interior-visit.mjs', async () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`interior-visit.mjs`'));
  assert.ok(bullet, '## Contents must have a `interior-visit.mjs` bullet');
  const norm = bullet.replace(/\s+/g, ' ');
  assert.ok(
    norm.includes('door hit-test (`isDoorHit`), look-around, and interior doorway exit ray-test (`rayHitsInteriorDoor`, `createInteriorVisit`)'),
    'interior-visit.mjs bullet must document isDoorHit, look-around, rayHitsInteriorDoor, and createInteriorVisit'
  );

  const mod = await import('./interior-visit.mjs');
  assert.equal(typeof mod.isDoorHit, 'function');
  assert.equal(typeof mod.rayHitsInteriorDoor, 'function');
  assert.equal(typeof mod.createInteriorVisit, 'function');
  assert.equal(typeof mod.INTERIOR_EYE_LOCAL, 'object');
  assert.equal(typeof mod.INTERIOR_TARGET_LOCAL, 'object');
  assert.equal(mod.INTERIOR_LOOK_SENSITIVITY, 0.005);
});

test('staging-polyfork/README.md kit .glb stripped claim matches kit-campground/ and kit-medieval/', () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const campBullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`kit-campground/`'));
  const medBullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`kit-medieval/`'));
  assert.ok(campBullet, '## Contents must have a `kit-campground/` bullet');
  assert.ok(medBullet, '## Contents must have a `kit-medieval/` bullet');
  assert.ok(campBullet.replace(/\s+/g, ' ').includes('`.glb` files stripped — no code references them'));
  assert.ok(medBullet.replace(/\s+/g, ' ').includes('`.glb` stripped'));

  const walk = (dir) => {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...walk(full));
      else if (entry.isFile()) files.push(full);
    }
    return files;
  };

  for (const kitDir of ['kit-campground', 'kit-medieval']) {
    const files = walk(path.join(BUNDLE_DIR, kitDir));
    const glbs = files.filter((f) => f.endsWith('.glb'));
    assert.equal(glbs.length, 0, `${kitDir}/ must have zero .glb files`);
    for (const f of files.filter((p) => p.endsWith('.mjs'))) {
      const src = fs.readFileSync(f, 'utf8');
      assert.ok(!src.includes('.glb'), `${path.relative(BUNDLE_DIR, f)} must not reference .glb`);
    }
  }
});

test('staging-polyfork/README.md two-story house NOT placed matches staging.js and kit-medieval/', () => {
  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups').replace(/\s+/g, ' ');
  assert.ok(limitsSec.includes('The two-story house from the kit was NOT placed'));

  assert.ok(fs.existsSync(path.join(BUNDLE_DIR, 'kit-medieval/house-two-story.mjs')));
  assert.doesNotMatch(stagingJs, /house-two-story|HouseTwoStory/);
  assert.doesNotMatch(indexHtml, /house-two-story|HouseTwoStory/);
  assert.ok(stagingJs.includes('./kit-medieval/cottage-small.mjs'));
});

test('staging-polyfork/README.md seed door-side props procedural-only matches seed-door-props.mjs and town-3d/town.js', () => {
  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups').replace(/\s+/g, ' ');
  for (const phrase of [
    'Seed door-side character props are procedural-only in staging',
    'attachSeedDoorProp',
    'seed-door-props.mjs',
    'interior-room.mjs',
    '`models/oil-lamp.glb`, `models/teapot.glb`',
    'no `staging-polyfork/models/` directory',
  ]) {
    assert.ok(limitsSec.includes(phrase), `## Known limits must include "${phrase}"`);
  }

  const seedPropsSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'seed-door-props.mjs'), 'utf8');
  for (const fn of ['buildProceduralOilLamp', 'buildProceduralTypewriter', 'buildProceduralTeapot']) {
    assert.ok(seedPropsSrc.includes(fn), `seed-door-props.mjs must import ${fn}`);
  }
  assert.ok(seedPropsSrc.includes("from './interior-room.mjs';"));

  const expected = [
    ['wick', 'wick_oil_lamp', 'buildProceduralOilLamp', '-1.1733'],
    ['maren', 'maren_typewriter', 'buildProceduralTypewriter', '-0.6525'],
    ['tomas', 'tomas_teapot', 'buildProceduralTeapot', '-0.1322'],
  ];
  const townJsSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/town.js'), 'utf8');
  for (const [handle, propId, builder, rotY] of expected) {
    assert.match(
      seedPropsSrc,
      new RegExp(`${handle}:\\s*\\{\\s*build:\\s*${builder},\\s*rotY:\\s*${rotY}\\s*\\}`),
      `seed-door-props.mjs must map ${handle} to ${builder} with rotY ${rotY}`
    );
    assert.match(
      townJsSrc,
      new RegExp(`id:\\s*'${propId}'[\\s\\S]*?rotY:\\s*${rotY}\\b`),
      `town-3d/town.js PROP_PLACEMENTS ${propId} must have rotY ${rotY}`
    );
  }

  assert.ok(!fs.existsSync(path.join(BUNDLE_DIR, 'models')), 'staging-polyfork/models/ must not exist');
  assert.ok(!stagingJs.includes('models/'), 'staging.js must not reference models/');
});

test('staging-polyfork/README.md empty-pad click info-strip claim matches staging.js', () => {
  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups').replace(/\s+/g, ' ');
  assert.ok(
    limitsSec.includes('Clicking an empty pad displays `OPEN PLOT #<N> — no resident yet` in `#info-strip` (all other click/overlay branches hide `#info-strip`)'),
    '## Known limits must document empty-pad #info-strip behavior'
  );

  assert.match(
    stagingJs,
    /if\s*\(kind\s*===\s*'open_plot'\)\s*\{[\s\S]*?infoStripEl\.textContent\s*=\s*`OPEN PLOT #\$\{target\.userData\.plotNumber\} — no resident yet`;[\s\S]*?infoStripEl\.hidden\s*=\s*false;/
  );
  const hideMatches = stagingJs.match(/if\s*\(infoStripEl\)\s*infoStripEl\.hidden\s*=\s*true;/g) || [];
  assert.ok(hideMatches.length >= 4, `Expected >= 4 infoStripEl.hidden = true sites, found ${hideMatches.length}`);
});

test('staging-polyfork/README.md no polyfork.dev import claim matches the bundle (imports only, comments excluded)', () => {
  const verSec = getSection(readmeMd, 'Verification done locally (no browser here — no visual check claimed)').replace(/\s+/g, ' ');
  assert.ok(
    verSec.includes("No polyfork.dev import anywhere in the page chain (`clips.mjs` is used via `staging.js` / `npc-animation.mjs` with `base: './anim/'` against local `anim/` JSONs, no CDN fetch)"),
    '## Verification done locally must state no polyfork.dev import'
  );

  const walkBundleJs = (dir) => {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...walkBundleJs(full));
      else if (entry.isFile() && /\.(mjs|js)$/.test(entry.name) && !entry.name.startsWith('test-')) files.push(full);
    }
    return files;
  };

  const importRe = /(?:from\s+['"]https?:\/\/[^'"]*polyfork\.dev|import\s*\(\s*['"]https?:\/\/[^'"]*polyfork\.dev)/;
  let commentMentionCount = 0;
  for (const file of walkBundleJs(BUNDLE_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(src, importRe, `${path.relative(BUNDLE_DIR, file)} must not import from polyfork.dev`);
    if (src.includes('polyfork.dev')) commentMentionCount++;
  }
  assert.ok(commentMentionCount >= 1, 'Expected at least one bundle file to mention polyfork.dev in comments');

  const npcAnimSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'npc-animation.mjs'), 'utf8');
  assert.ok(npcAnimSrc.includes("base = './anim/'"));
  assert.ok(npcAnimSrc.includes("import('./kit-medieval/clips.mjs')"));
  assert.ok(npcAnimSrc.includes('fn(group, { clips, base })'));
});

test('staging-polyfork/README.md concept-* vendored bullet matches headers, cottage/ghost byte-identity, and bandstand exception', () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`concept-bandstand.js`'));
  assert.ok(bullet, '## Contents must have a concept-bandstand.js vendored bullet');
  for (const name of ['concept-bandstand.js', 'concept-cottage.js', 'concept-ghost.js']) {
    assert.ok(bullet.includes(name), `concept-* bullet must name ${name}`);
  }
  assert.ok(
    bullet.replace(/\s+/g, ' ').includes('1-line vendored-source header'),
    'concept-* bullet must mention 1-line vendored-source header'
  );

  for (const name of ['concept-bandstand.js', 'concept-cottage.js', 'concept-ghost.js']) {
    const vendored = fs.readFileSync(path.join(BUNDLE_DIR, name), 'utf8');
    const expectedHeader = `// Vendored from town-3d/${name} — keep byte-identical after this header line.\n`;
    assert.ok(vendored.startsWith(expectedHeader), `${name} must start with exact vendored-source header`);
    const body = vendored.slice(expectedHeader.length);
    const town3dSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d', name), 'utf8');
    if (name === 'concept-bandstand.js') {
      assert.notEqual(
        body,
        town3dSrc,
        'concept-bandstand.js body after header is expected to differ from town-3d/concept-bandstand.js'
      );
    } else {
      assert.equal(body, town3dSrc, `${name} body after header must be byte-identical to town-3d/${name}`);
    }
  }

  const testStagingSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'test-staging.mjs'), 'utf8');
  const vmMatch = testStagingSrc.match(/const VENDORED_MODULES = \[([\s\S]*?)\];/);
  assert.ok(vmMatch, 'test-staging.mjs must declare VENDORED_MODULES');
  const listed = [...vmMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed, ['concept-cottage.js', 'concept-ghost.js']);
});

test('staging-polyfork/README.md self-contained / jsdelivr-only network dependency matches index.html and bundle', () => {
  const importmap = indexHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(importmap, 'index.html must contain an importmap script');
  const urls = [...importmap[1].matchAll(/https:\/\/[^"']+/g)].map((m) => m[0]);
  assert.equal(urls.length, 2, `Expected exactly 2 https URLs in importmap, found ${urls.length}`);
  assert.ok(
    urls.every((u) => u.startsWith('https://cdn.jsdelivr.net/npm/three@0.160.0/')),
    `All importmap https URLs must come from jsdelivr three@0.160.0: ${JSON.stringify(urls)}`
  );

  const walkBundleJs = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walkBundleJs(f));
      else if (e.isFile() && /\.(mjs|js)$/.test(e.name) && !e.name.startsWith('test-')) out.push(f);
    }
    return out;
  };
  const remoteImport = /(?:from\s+['"]https?:\/\/|import\(\s*['"]https?:\/\/)/;
  const bad = [];
  for (const f of walkBundleJs(BUNDLE_DIR)) {
    if (remoteImport.test(fs.readFileSync(f, 'utf8'))) bad.push(path.relative(BUNDLE_DIR, f));
  }
  assert.deepEqual(bad, [], `Bundle JS files must not contain remote JS imports: ${JSON.stringify(bad)}`);

  const fetches = [...stagingJs.matchAll(/fetch\(`([^`]+)`/g)].map((m) => m[1]);
  assert.equal(fetches.length, 2, `Expected exactly 2 fetch calls in staging.js, found ${fetches.length}`);
  assert.ok(
    fetches.every((u) => u.startsWith('/api/town/')),
    `All staging.js fetch URLs must start with /api/town/: ${JSON.stringify(fetches)}`
  );

  const selfIdx = readmeMd.indexOf('Self-contained:');
  assert.notEqual(selfIdx, -1, 'README.md must contain a "Self-contained:" paragraph');
  const after = readmeMd.slice(selfIdx).replace(/\s+/g, ' ');
  assert.ok(
    after.startsWith(
      'Self-contained: every Polyfork import is relative to the bundle. The only network dependency is three.js from jsdelivr'
    ),
    'README.md Self-contained paragraph must state jsdelivr three.js as the only network dependency'
  );
});

test('staging-polyfork/README.md anim/ clips bullet matches vendored JSON clips and npc-animation.mjs', () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`anim/`'));
  assert.ok(bullet, '## Contents must have an `anim/` bullet');
  assert.ok(bullet.includes('`anim-idle.json`'), '`anim/` bullet must name `anim-idle.json`');
  assert.ok(bullet.includes('`anim-walk.json`'), '`anim/` bullet must name `anim-walk.json`');

  for (const [file, expectedName] of [['anim-idle.json', 'Idle'], ['anim-walk.json', 'Walk']]) {
    const clip = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, 'anim', file), 'utf8'));
    assert.equal(clip.name, expectedName, `${file} name must be ${expectedName}`);
    assert.ok(
      clip.tracks && typeof clip.tracks === 'object' && !Array.isArray(clip.tracks) && 'Hips' in clip.tracks,
      `${file} tracks must be a non-empty object containing Hips`
    );
    assert.ok(Array.isArray(clip.times) && clip.times.length > 0, `${file} times must be a non-empty array`);
    assert.equal(clip.cc0, true, `${file} cc0 must be true`);
  }

  const npcAnimSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'npc-animation.mjs'), 'utf8');
  assert.ok(npcAnimSrc.includes("base = './anim/'"), "npc-animation.mjs must use base = './anim/'");
});

test('staging-polyfork/README.md Inn per-room glow geometry cy/z matches inn-nightly-call.mjs', () => {
  const innSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'inn-nightly-call.mjs'), 'utf8');
  const yMatch = innSrc.match(/const FRONT_UPPER_Y = ([\d.]+);/);
  const zMatch = innSrc.match(/const FRONT_UPPER_Z = ([\d.]+);/);
  assert.ok(yMatch && yMatch[1] === '4.25', `Expected FRONT_UPPER_Y = 4.25, got ${yMatch?.[1]}`);
  assert.ok(zMatch && zMatch[1] === '2.94', `Expected FRONT_UPPER_Z = 2.94, got ${zMatch?.[1]}`);

  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups').replace(/\s+/g, ' ');
  assert.ok(limitsSec.includes('`cy` 4.25'), '## Known limits must mention `cy` 4.25');
  assert.ok(limitsSec.includes('`z` ~`+2.94`'), '## Known limits must mention `z` ~`+2.94`');
  assert.ok(
    innSrc.includes('at width 10: HZ = 2.90, pane offset WPW = 0.04 => z = 2.94; upper cy = 4.25;'),
    'inn-nightly-call.mjs must carry the width-10 geometry derivation comment'
  );
});

test('staging-polyfork/README.md intro header adoption, fallback, and three@0.160.0 match PLAN.md, town-3d/README.md, and index.html', () => {
  const contentsIdx = readmeMd.indexOf('## Contents');
  assert.notEqual(contentsIdx, -1, 'README.md must contain ## Contents');
  const header = readmeMd.slice(0, contentsIdx).replace(/\s+/g, ' ');
  assert.ok(
    header.includes('The live town since the 2026-11-14 adoption (slice 77)'),
    'README header must state the 2026-11-14 adoption (slice 77)'
  );
  assert.ok(
    header.includes('The old procedural `town-3d/` build is the fallback'),
    'README header must state town-3d/ is the fallback'
  );

  const adoptIdx = planMd.indexOf('Adoption (2026-11-14, foreground turn):');
  assert.notEqual(adoptIdx, -1, 'PLAN.md must contain the Adoption (2026-11-14, foreground turn) paragraph');
  const adopt = planMd.slice(adoptIdx, adoptIdx + 1500);
  assert.ok(adopt.includes('fixed by slice 77'), 'PLAN.md adoption paragraph must mention fixed by slice 77');
  assert.ok(
    adopt.includes('the staging subpath is kept as a mirror copy inside the new root'),
    'PLAN.md adoption paragraph must state the staging subpath mirror copy'
  );

  const town3dReadme = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/README.md'), 'utf8');
  assert.ok(
    town3dReadme.includes('`town-3d/` is the fallback procedural build.'),
    'town-3d/README.md must state it is the fallback procedural build'
  );

  const contentsSec = getSection(readmeMd, 'Contents');
  const idxBullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`index.html`'));
  assert.ok(
    idxBullet && idxBullet.includes('three@0.160.0, same as the live town'),
    '`index.html` Contents bullet must state three@0.160.0, same as the live town'
  );
  assert.ok(
    indexHtml.includes('"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"'),
    'index.html importmap must map "three" to three@0.160.0 on jsdelivr'
  );
});

test('staging-polyfork/README.md Nightly Call card live from state matches staging.js and town-api/server.mjs', () => {
  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups');
  const bullet = limitsSec.split(/\r?\n- /).find((b) => b.includes('Nightly Call card is live from state'));
  assert.ok(bullet, '## Known limits must have a Nightly Call card is live from state bullet');
  const norm = bullet.replace(/\s+/g, ' ');
  assert.ok(
    norm.includes('redraws `nightly_call_card` from `state.nightly_call`'),
    'Nightly Call bullet must mention redraws `nightly_call_card` from `state.nightly_call`'
  );
  assert.ok(
    norm.includes('which the live server ships (`GET /api/town/state`)'),
    'Nightly Call bullet must mention live server ships (`GET /api/town/state`)'
  );
  assert.match(
    stagingJs,
    /updateStagingNightlyCallCard\(\s*\{[\s\S]*?\},\s*state\?\.nightly_call\s*\)/,
    'staging.js must call updateStagingNightlyCallCard with state?.nightly_call'
  );
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/server.mjs'), 'utf8');
  assert.ok(serverSrc.includes('stateBody.nightly_call = {'), 'town-api/server.mjs must set stateBody.nightly_call');
});

test('staging-polyfork/README.md Gatehouse colors and placement match staging.js', () => {
  const gm = stagingJs.match(
    /place\(Gatehouse,\s*\{\s*shingle:\s*(\w+),\s*plaster:\s*(\w+),\s*gateState:\s*'([^']+)',\s*windows:\s*(\d+)\s*\},\s*(-?\d+),\s*(-?\d+)\)/
  );
  assert.ok(gm, 'staging.js must place Gatehouse with shingle, plaster, gateState, windows, x, z');
  const resolveConst = (name) => stagingJs.match(new RegExp(`const ${name} = '([^']+)'`))?.[1];
  assert.equal(resolveConst(gm[1]), '#5a4332');
  assert.equal(resolveConst(gm[2]), '#f5efe0');
  assert.equal(gm[3], 'wide');
  assert.equal(gm[4], '2');
  assert.equal(gm[5], '0');
  assert.equal(gm[6], '27');

  const buildingsSec = getSection(
    readmeMd,
    'Buildings (place coordinates, metres; bandstand spot at 0,0)'
  ).replace(/\s+/g, ' ');
  assert.ok(
    buildingsSec.includes(
      'Village Gatehouse | (0, 27) | shingle #5a4332, plaster #f5efe0, gateState `wide`, windows 2'
    ),
    '## Buildings Gatehouse row must match staging.js colors, gateState, windows, and coordinates'
  );
});

test('staging-polyfork/README.md NPC stand-in yield rule matches npc-wander.mjs and staging.js', () => {
  const npcSec = getSection(readmeMd, 'NPC stand-ins').replace(/\s+/g, ' ');
  assert.ok(
    npcSec.includes(
      'when a live presence avatar exists for `wick`, `maren`, or `tomas`, their humanoid stand-in hides (`visible = false`) and the live capsule represents them; when presence clears, the humanoid reappears at its home spot'
    ),
    '## NPC stand-ins must document the live-presence yield rule'
  );

  const wanderSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'npc-wander.mjs'), 'utf8');
  assert.match(
    wanderSrc,
    /isLivePresent\) \{\s*w\.group\.visible = false;\s*w\.yielded = true;/,
    'npc-wander.mjs must hide stand-in and mark yielded when live presence exists'
  );
  assert.match(
    wanderSrc,
    /if \(w\.yielded\) \{\s*w\.yielded = false;\s*w\.group\.visible = true;\s*const home = w\.waypoints\[0\];/,
    'npc-wander.mjs must restore stand-in at waypoints[0] when presence clears'
  );
  assert.ok(wanderSrc.includes('const home = w.waypoints[0];'));
  assert.match(
    stagingJs,
    /updateStagingWander\(wanderFigures, dt, liveStore\.avatars\)/,
    'staging.js must pass liveStore.avatars to updateStagingWander'
  );
});

test('staging-polyfork/README.md Contents bullets for uncovered modules match exports, definitions, and verbatim stepGlide', async () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bulletFor = (prefix) => contentsSec.split(/\r?\n- /).find((b) => b.startsWith(prefix));
  const definedIn = (src, name) => new RegExp(`(?:export\\s+)?(?:const|function)\\s+${name}\\b`).test(src);
  const townJs = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/town.js'), 'utf8');

  // (a) avatar.mjs
  const avatarSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'avatar.mjs'), 'utf8');
  const avBullet = bulletFor('`avatar.mjs`');
  assert.ok(avBullet, '## Contents must have an `avatar.mjs` bullet');
  const AV7 = [
    'TOWN_LAYOUT',
    'SEED_HOME_PADS',
    'makeCanvas',
    'makeTextTexture',
    'createAvatarCapsule',
    'getPlotTargetPosition',
    'pickBandstandSpot',
  ];
  for (const name of AV7) {
    assert.ok(avBullet.includes(`\`${name}\``), `avatar.mjs bullet must list \`${name}\``);
    assert.ok(definedIn(avatarSrc, name), `avatar.mjs must define ${name}`);
    assert.ok(definedIn(townJs, name), `town-3d/town.js must define ${name}`);
  }
  assert.doesNotMatch(avatarSrc, /from ['"]three['"]/, 'avatar.mjs must not import from three');
  assert.ok(avatarSrc.includes("typeof document !== 'undefined'"), 'avatar.mjs must guard document access');
  assert.doesNotMatch(avatarSrc, /^document\./m, 'avatar.mjs must have no top-level document. line');

  // (b) cottage-props.mjs
  const cpBullet = bulletFor('`cottage-props.mjs`');
  assert.ok(
    cpBullet && cpBullet.replace(/\s+/g, ' ').includes('10 valid prop kinds matching `town-3d/town.js`'),
    'cottage-props.mjs bullet must state 10 valid prop kinds matching town-3d/town.js'
  );
  const cpMod = await import(path.join(BUNDLE_DIR, 'cottage-props.mjs'));
  for (const name of ['attachPorchDeck', 'attachPorchTrim', 'attachPlotProps', 'MILO_PLOT_PROPS', 'VALID_PROP_KINDS']) {
    assert.ok(name in cpMod, `cottage-props.mjs must export ${name}`);
  }
  const townKindsMatch = townJs.match(/const VALID_PROP_KINDS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(townKindsMatch, 'town-3d/town.js must define VALID_PROP_KINDS');
  const townKinds = [...townKindsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.equal(cpMod.VALID_PROP_KINDS.size, 10);
  assert.deepEqual([...cpMod.VALID_PROP_KINDS], townKinds);

  // (c) notice-board-overlay.mjs
  const nbSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'notice-board-overlay.mjs'), 'utf8');
  const nbBullet = bulletFor('`notice-board-overlay.mjs`');
  assert.ok(
    nbBullet &&
      nbBullet
        .replace(/\s+/g, ' ')
        .includes('vendored `NOTICE_BOARD_PAPERS`, `escapeHtml`, and `buildNoticeBoardOverlayHtml`'),
    'notice-board-overlay.mjs bullet must list the 3 vendored names'
  );
  assert.ok(nbSrc.includes('const NOTICE_BOARD_PAPERS'));
  assert.ok(nbSrc.includes('function escapeHtml'));
  assert.ok(nbSrc.includes('export function buildNoticeBoardOverlayHtml'));
  assert.ok(townJs.includes('NOTICE_BOARD_PAPERS'));
  assert.ok(townJs.includes('function escapeHtml'));
  assert.ok(townJs.includes('function buildNoticeBoardOverlayHtml'));

  // (d) plot-overlay.mjs
  const poMod = await import(path.join(BUNDLE_DIR, 'plot-overlay.mjs'));
  for (const name of [
    'resolvePlotOverlayContent',
    'resolveGazetteOverlayContent',
    'openPlotOverlay',
    'openGazetteOverlay',
    'closePlotOverlay',
  ]) {
    assert.ok(name in poMod, `plot-overlay.mjs must export ${name}`);
  }
  const poBullet = bulletFor('`plot-overlay.mjs`');
  assert.ok(
    poBullet && poBullet.replace(/\s+/g, ' ').includes('Gazette `gazette/latest.json` resolver'),
    'plot-overlay.mjs bullet must state Gazette `gazette/latest.json` resolver'
  );

  // (e) inn-guestbook-overlay.mjs
  const igSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'inn-guestbook-overlay.mjs'), 'utf8');
  const IG11 = [
    'INN_ROOM_DETAILS',
    'escapeHtml',
    'hasUsableInnState',
    'formatInnOccupancyLine',
    'buildInnOverlayHtml',
    'resolveInnOverlayContent',
    'GUESTBOOK_DATE_FMT',
    'formatGuestbookDate',
    'renderGuestbookEntryLi',
    'buildGuestbookOverlayHtml',
    'resolveGuestbookOverlayContent',
  ];
  for (const name of IG11) {
    assert.ok(
      definedIn(igSrc, name) || new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`).test(igSrc),
      `inn-guestbook-overlay.mjs must define ${name}`
    );
  }
  for (const name of ['INN_ROOM_DETAILS', 'formatGuestbookDate', 'renderGuestbookEntryLi']) {
    assert.ok(townJs.includes(name), `town-3d/town.js must contain ${name}`);
  }

  // (f) event-banner.mjs
  const ebMod = await import(path.join(BUNDLE_DIR, 'event-banner.mjs'));
  for (const name of [
    'loadEvents',
    'selectCurrentEvent',
    'eventBannerLines',
    'updateEventBanner',
    'renderEventBannerHeader',
  ]) {
    assert.ok(name in ebMod, `event-banner.mjs must export ${name}`);
  }
  const ebSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'event-banner.mjs'), 'utf8');
  assert.ok(ebSrc.includes('{ events: [] }'), 'event-banner.mjs loadEvents must fail open with { events: [] }');

  // (g) npc-wander.mjs
  const nwMod = await import(path.join(BUNDLE_DIR, 'npc-wander.mjs'));
  for (const name of [
    'SEED_WANDER_CONFIG',
    'GHOST_DRIFT_CONFIG',
    'buildStagingWanderFigures',
    'buildStagingGhostDrift',
    'updateStagingWander',
  ]) {
    assert.ok(name in nwMod, `npc-wander.mjs must export ${name}`);
  }

  // (h) tap-glide.mjs verbatim stepGlide
  const extractFn = (src, name) => {
    const idx = src.indexOf(`function ${name}(`);
    if (idx === -1) return null;
    const brace = src.indexOf('{', idx);
    let depth = 0;
    for (let i = brace; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) return src.slice(idx, i + 1);
      }
    }
    return null;
  };
  const tgSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'tap-glide.mjs'), 'utf8');
  const tgBody = extractFn(tgSrc, 'stepGlide');
  const townBody = extractFn(townJs, 'stepGlide');
  assert.notEqual(tgBody, null, 'tap-glide.mjs must define function stepGlide');
  assert.equal(tgBody, townBody, 'tap-glide.mjs stepGlide must be verbatim byte-equal to town-3d/town.js');

  const tgBullet = bulletFor('`tap-glide.mjs`');
  assert.ok(
    tgBullet && tgBullet.replace(/\s+/g, ' ').includes('vendored `stepGlide` from `town-3d/town.js`'),
    'tap-glide.mjs bullet must state vendored `stepGlide` from `town-3d/town.js`'
  );
  const uiSec = getSection(readmeMd, 'UI parity (slices 65a–65c)').replace(/\s+/g, ' ');
  assert.ok(
    uiSec.includes('vendored `stepGlide` verbatim from `town-3d/town.js`'),
    '## UI parity must state vendored `stepGlide` verbatim from `town-3d/town.js`'
  );
});

test('staging-polyfork/README.md lamp posts emissive-only matches lamp-post.mjs, staging.js, and concept-bandstand.js', () => {
  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups').replace(/\s+/g, ' ');
  assert.ok(
    limitsSec.includes('**Lamp posts have emissive glow only**, no real point lights'),
    '## Known limits must state lamp posts have emissive glow only, no real point lights'
  );

  const lampSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'kit-medieval/lamp-post.mjs'), 'utf8');
  assert.ok(!lampSrc.includes('PointLight'), 'kit-medieval/lamp-post.mjs must not use PointLight');
  assert.ok(
    lampSrc.includes("emissive:'#ffcf87'") && lampSrc.includes('emissive:C.glow'),
    'kit-medieval/lamp-post.mjs must use emissive glass and flame materials'
  );
  assert.ok(!stagingJs.includes('PointLight'), 'staging.js must not use PointLight');

  const bandstandSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'concept-bandstand.js'), 'utf8');
  assert.ok(
    bandstandSrc.includes("light.name = 'ghostlight_point_light'"),
    'concept-bandstand.js must hold the one ghostlight_point_light'
  );
});

test('staging-polyfork/README.md Buildings table Milos Cottage row matches staging.js and concept-cottage.js', () => {
  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  for (const expected of [
    '(17.92, 4.60)',
    '8 lit windows',
    'Milo — Ghostlight Cottage (rebuilt)',
    'replacing the (17, 12) thatched cottage',
    'createConceptMilosCottage',
  ]) {
    assert.ok(buildingsSec.includes(expected), `## Buildings Milos Cottage row must include "${expected}"`);
  }

  assert.match(stagingJs, /const\s+MILO_PLOT\s*=\s*\{\s*x:\s*17\.92,\s*z:\s*4\.60\s*\};/);
  assert.ok(stagingJs.includes("label: 'Milo — Ghostlight Cottage (rebuilt)'"));
  assert.ok(stagingJs.includes("buildStagingSignpost('Milo — Ghostlight Cottage (rebuilt)')"));
  assert.ok(!stagingJs.includes('17, 12'), 'staging.js must not place anything at (17, 12)');

  const cottageSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'concept-cottage.js'), 'utf8');
  assert.ok(cottageSrc.includes('// 8 warm lit 4-pane casement windows'));
  const windowEntries = cottageSrc.match(/\{\s*x:\s*-?[\d.]+,\s*y:\s*[\d.]+,\s*z:\s*-?[\d.]+,\s*rotY:\s*[^,]+,\s*w:\s*0\.\d+,\s*h:\s*0\.88\s*\}/g);
  assert.equal(windowEntries?.length, 8, 'concept-cottage.js windows array must hold exactly 8 entries');
});

test('staging-polyfork/README.md Buildings table Windmill row matches staging.js and windmill.mjs', () => {
  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  for (const expected of [
    '(−22, −20)',
    'tallness 1.18',
    'stone #f5efe0',
    'sails turn slowly',
    'interior #ffb14a',
  ]) {
    assert.ok(buildingsSec.includes(expected), `## Buildings Windmill row must include "${expected}"`);
  }

  assert.match(stagingJs, /const\s+CREAM\s*=\s*'#f5efe0'/);
  assert.match(stagingJs, /sails\.rotation\.z\s*-=\s*dt\s*\*\s*0\.12/);

  const windmillSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'kit-medieval/windmill.mjs'), 'utf8');
  const interiorMatch = windmillSrc.match(/interior:\s*\{\s*color:\s*'([^']+)',\s*intensity:\s*([\d.]+)/);
  assert.ok(interiorMatch, 'windmill.mjs night export must carry interior color + intensity');
  assert.equal(interiorMatch[1], '#ffb14a');
  assert.equal(Number(interiorMatch[2]), 0.6);
});

test('staging-polyfork/README.md Terrain scatter skip and keep lists match staging.js', () => {
  const skippedRing = 'stone-ring-camp' + 'fire';
  const skipMatch = stagingJs.match(/skip:\s*\[([^\]]+)\]/);
  assert.ok(skipMatch, 'Could not parse buildKit skip list in staging.js');
  const skipItems = [...skipMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(skipItems, [skippedRing, 'lakeside-swing-tree']);

  const keepMatch = stagingJs.match(/keep:\s*\[([^\]]+)\]/);
  assert.ok(keepMatch, 'Could not parse buildKit keep list in staging.js');
  const keepItems = [...keepMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(keepItems, ['reed-bed', 'exposed-tree-roots', 'lily-pads', 'lake-pebbles']);

  const floaterMatch = stagingJs.match(/const FLOATER_KEYS = \[([^\]]+)\];/);
  assert.ok(floaterMatch, 'Could not parse FLOATER_KEYS in staging.js');
  assert.deepEqual(
    [...floaterMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
    keepItems,
    'FLOATER_KEYS must equal the buildKit keep list'
  );

  const terrainSec = getSection(readmeMd, 'Terrain (as built — no fallbacks needed)').replace(/\s+/g, ' ');
  assert.ok(terrainSec.includes('`' + skippedRing + '`'), '## Terrain skip note must name the ring scatter part');
  assert.ok(terrainSec.includes('`lakeside-swing-tree`'), '## Terrain skip note must name lakeside-swing-tree');
  assert.ok(
    terrainSec.includes('exposed tree roots and reed beds only'),
    '## Terrain must state remaining scatter is exposed tree roots and reed beds only'
  );
});

test('staging-polyfork/README.md Buildings Pines keep-clear list and gate path match staging.js', () => {
  const keepClearMatch = stagingJs.match(/const keepClear = \[([\s\S]*?)\];/);
  assert.ok(keepClearMatch, 'Could not parse keepClear in staging.js');
  const keepClearSrc = keepClearMatch[1];
  for (const entry of ['[-11, 20, 10]', '[17.92, 4.60, 9]', '[0, 27, 8]', '[6, 8, 7]', '[-6, 14, 5]', '[-22, -20, 11]']) {
    assert.ok(keepClearSrc.includes(entry), `keepClear must include ${entry}`);
  }
  assert.ok(
    keepClearSrc.includes('...TOWN_LAYOUT.plots.slice(1).map((p) => [p.x, p.z, 9])'),
    'keepClear must include resident plot entries'
  );
  assert.ok(
    keepClearSrc.includes('[TOWN_LAYOUT.newsstand.x, TOWN_LAYOUT.newsstand.z, 5]'),
    'keepClear must include the newsstand entry'
  );
  assert.match(
    stagingJs,
    /if\s*\(Math\.abs\(x\)\s*<\s*5\s*&&\s*z\s*>\s*24\)\s*continue;\s*\/\/ keep the gate path clear/
  );

  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  assert.ok(
    buildingsSec.includes("gate path and building footprints kept clear (including Milo's cottage at `[17.92, 4.60, 9]`)"),
    '## Buildings Pines line must state gate path and building footprints kept clear incl. Milos cottage [17.92, 4.60, 9]'
  );
});

test('staging-polyfork/README.md Controls copy matches index.html controls hint', () => {
  const controlsSec = getSection(readmeMd, 'Controls').replace(/\s+/g, ' ');
  assert.ok(
    controlsSec.includes('Drag to orbit, scroll/pinch to zoom, WASD or arrow keys to pan the orbit target across the ground, touch-tap empty ground to glide the orbit target (clamped to the island), and tap/click a cottage, newsstand, Inn, or gatehouse to inspect.'),
    '## Controls must state the orbit/zoom/pan/glide/inspect copy'
  );
  assert.ok(
    controlsSec.includes('Multi-pointer pinches cancel any in-flight glide and suppress click/glide on `pointerup`.'),
    '## Controls must state multi-pointer pinch cancellation'
  );

  assert.ok(
    indexHtml.includes('<span id="controls-hint">Drag: orbit &middot; Scroll / Pinch: zoom &middot; WASD / Arrows: pan &middot; Tap ground: glide &middot; Click: inspect</span>'),
    'index.html must carry the default #controls-hint copy'
  );
  const coarseIdx = indexHtml.indexOf("window.matchMedia('(pointer: coarse)')");
  assert.ok(coarseIdx !== -1, 'index.html must contain the (pointer: coarse) swap');
  const coarseBlock = indexHtml.slice(coarseIdx, coarseIdx + 400);
  for (const phrase of ['Tap ground: walk', 'Drag: look', 'Pinch: zoom', 'Tap: inspect']) {
    assert.ok(coarseBlock.includes(phrase), `coarse-pointer hint copy must include "${phrase}"`);
  }
});

test('staging-polyfork/README.md test-staging.mjs bullet matches test-staging.mjs assertions', () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`test-staging.mjs`'));
  assert.ok(bullet, '## Contents must have a `test-staging.mjs` bullet');
  const norm = bullet.replace(/\s+/g, ' ');
  const noRandom = 'no `Math.' + 'random`';
  for (const phrase of [
    noRandom,
    'scoped `/api/town/state` + `/api/town/plot?handle=` fetches only',
    'no `TownLive`',
    '`?v=41` cache bust',
    '`#plot-overlay` markup + click wiring for cottages/newsstand/Inn/gatehouse',
  ]) {
    assert.ok(norm.includes(phrase), `test-staging.mjs bullet must include "${phrase}"`);
  }

  const testStagingSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'test-staging.mjs'), 'utf8');
  assert.ok(
    testStagingSrc.includes("test('staging.html references staging.js?v=41"),
    'test-staging.mjs must have the ?v=41 HTML test'
  );
  assert.match(
    testStagingSrc,
    /\/\\bMath\\.random\\b\/\.test\(codeOnly\)/,
    'test-staging.mjs must assert the random-number ban via codeOnly'
  );
  assert.match(
    testStagingSrc,
    /\/\\bTownLive\\b\/\.test\(codeOnly\)/,
    'test-staging.mjs must assert no TownLive via codeOnly'
  );
});

test('staging-polyfork/README.md staging.js bullet names match staging.js definitions', () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`staging.js`'));
  assert.ok(bullet, '## Contents must have a `staging.js` bullet');
  const norm = bullet.replace(/\s+/g, ' ');
  for (const name of ['`StagingLive`', '`applyStagingState`', '`applyStagingPresence`', '`syncStagingPlotsFromState`']) {
    assert.ok(norm.includes(name), `staging.js bullet must name ${name}`);
  }

  assert.match(stagingJs, /class StagingLive \{/);
  assert.match(stagingJs, /function applyStagingState\(/);
  assert.match(stagingJs, /function applyStagingPresence\(/);
  assert.match(stagingJs, /async function syncStagingPlotsFromState\(/);
  assert.ok(
    stagingJs.includes("} from './inn-nightly-call.mjs?v=39';"),
    'staging.js must import Inn/Nightly Call wiring from inn-nightly-call.mjs?v=39'
  );
});

test('staging-polyfork/README.md npc-animation.mjs bullet matches npc-animation.mjs exports', () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`npc-animation.mjs`'));
  assert.ok(bullet, '## Contents must have a `npc-animation.mjs` bullet');
  const norm = bullet.replace(/\s+/g, ' ');
  assert.ok(norm.includes('Mixamo Idle/Walk clip attachment wrapper'), 'npc-animation.mjs bullet must state Mixamo Idle/Walk wrapper');
  assert.ok(norm.includes('`attachNpcAnimation`'), 'npc-animation.mjs bullet must name `attachNpcAnimation`');
  assert.ok(norm.includes("`base: './anim/'`"), 'npc-animation.mjs bullet must state base ./anim/');
  assert.ok(norm.includes('`./kit-medieval/clips.mjs`'), 'npc-animation.mjs bullet must name ./kit-medieval/clips.mjs');

  const npcAnimSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'npc-animation.mjs'), 'utf8');
  assert.match(npcAnimSrc, /export async function attachNpcAnimation\(THREE, group, options = \{\}\)/);
  assert.match(npcAnimSrc, /export async function attachIdleAnimation\(THREE, group, options = \{\}\)/);
  assert.match(npcAnimSrc, /export function updateNpcAnimations\(standIns, dt\)/);
});

test('staging-polyfork/README.md header Inn glow sentence matches staging.js and town-api/server.mjs', () => {
  const contentsIdx = readmeMd.indexOf('## Contents');
  assert.ok(contentsIdx !== -1, 'README.md must have ## Contents');
  const header = readmeMd.slice(0, contentsIdx).replace(/\s+/g, ' ');
  assert.ok(
    header.includes("drives the Inn's per-room window glow from `state.inn` (front-upper windows per room, `X(+3.60)` stair window dark; ground/back/side panes any-occupancy)"),
    'README header must state Inn per-room glow from state.inn with X(+3.60) stair window dark'
  );

  assert.match(stagingJs, /updateStagingInnOccupancy\(tavernGroup,\s*state\?\.inn\)/);

  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/server.mjs'), 'utf8');
  assert.ok(
    serverSrc.includes('const inn = { lantern: null, window: null, quiet: null };'),
    'town-api/server.mjs must build inn as { lantern: null, window: null, quiet: null }'
  );
  assert.match(serverSrc, /const stateBody = \{[\s\S]*?\n\s*inn,\n/);
});

test('staging-polyfork/test-staging-readme.mjs file hygiene: 62 tests, 62 unique names, 7 imports, no banned literals', () => {
  const src = fs.readFileSync(path.join(BUNDLE_DIR, 'test-staging-readme.mjs'), 'utf8');
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 62, `Expected 62 top-level tests, found ${names.length}`);
  assert.equal(new Set(names).size, 62, 'Test names must be unique');
  assert.ok(!names.some((n) => n.includes("'")), 'Test names must contain no apostrophes');
  const importLines = src.split(/\r?\n/).filter((line) => line.startsWith('import '));
  assert.deepEqual(importLines, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { execFileSync } from 'node:child_process';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
  ]);
  const retiredRe = new RegExp('camp' + 'fire', 'g');
  assert.equal([...src.matchAll(retiredRe)].length, 0, 'Retired term must not appear literally');
  assert.equal([...src.matchAll(/fetch\(/g)].length, 0, 'fetch' + '(' + ' must not appear literally');
  assert.equal([...src.matchAll(/Math\.random/g)].length, 0, 'Math.' + 'random' + ' must not appear literally');
  assert.equal([...src.matchAll(/Date\.now/g)].length, 0, 'Date.' + 'now' + ' must not appear literally');
  assert.equal([...src.matchAll(new RegExp('TO' + 'DO', 'g'))].length, 0, 'TO' + 'DO' + ' must not appear literally');
  assert.equal([...src.matchAll(new RegExp('FIX' + 'ME', 'g'))].length, 0, 'FIX' + 'ME' + ' must not appear literally');
});

test('Slice 512: event-banner.mjs bullet matches event-banner.mjs and staging.js wiring (S1)', () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`event-banner.mjs`'));
  assert.ok(bullet, '## Contents must have an `event-banner.mjs` bullet');
  const normBullet = bullet.replace(/\s+/g, ' ');
  for (const phrase of [
    '`loadEvents` fail-open fetch of `events.json` returning `{ events: [] }` on failure',
    "`selectCurrentEvent` picking active `'now'` or earliest upcoming `'next'` by wall clock",
    '`eventBannerLines` calling `splitNightlyCallLines(title)` at its 30-char default for the 768×256 `event_banner` 3D card via `updateEventBanner`',
    '`renderEventBannerHeader` updating `#prompt-book-event` via `textContent`',
    "wired in `staging.js` (`loadEvents()` and `applyStagingState(..., eventBannerEl)`)",
  ]) {
    assert.ok(normBullet.includes(phrase), `event-banner.mjs bullet must include "${phrase}"`);
  }

  const ebSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'event-banner.mjs'), 'utf8');
  assert.ok(ebSrc.includes("if (typeof fetchFn !== 'function') return { events: [] };"), 'loadEvents must fail open when fetchFn is not a function');
  assert.match(ebSrc, /export function selectCurrentEvent\(events, nowMs = Date\.now\(\)\)/);
  assert.ok(ebSrc.includes("if (nowCandidate) return { event: nowCandidate, status: 'now' };"));
  assert.ok(ebSrc.includes("if (nextCandidate) return { event: nextCandidate, status: 'next' };"));
  assert.ok(ebSrc.includes('return [heading, ...splitNightlyCallLines(title)];'), 'eventBannerLines must call splitNightlyCallLines(title) with no second arg');
  const innSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'inn-nightly-call.mjs'), 'utf8');
  assert.match(innSrc, /export function splitNightlyCallLines\(topic,\s*maxLineLen\s*=\s*30\)/);
  assert.ok(ebSrc.includes('width: 768,') && ebSrc.includes('height: 256,'), 'updateEventBanner card must be 768x256');
  assert.ok(ebSrc.includes('headerEl.textContent = `Now: ${event.title} — hosted by @${event.host_handle}`;'));
  assert.ok(ebSrc.includes('headerEl.textContent = `Next: ${event.title} — ${when} · hosted by @${event.host_handle}`;'));

  assert.match(stagingJs, /loadEvents\(\)\s*\n\s*\.then/, 'staging.js must call loadEvents()');
  assert.match(stagingJs, /selectCurrentEvent\(liveStore\.events, Date\.now\(\)\)/, 'staging.js must call selectCurrentEvent with live events and wall clock');
  assert.match(stagingJs, /applyStagingState\(\s*[\s\S]*?eventBannerEl\s*\n/, 'staging.js must pass eventBannerEl to applyStagingState');
});

test('Slice 512: NPC stand-ins moved outward along the same angles to about 6.5 m (S2)', () => {
  const npcSec = getSection(readmeMd, 'NPC stand-ins').replace(/\s+/g, ' ');
  assert.ok(
    npcSec.includes('Originally placed at (2.5, 3), (−2.2, 3.4), (0.4, −3.4), they were moved outward along the same angles to ~6.5 m — Wick at (4.16, 4.99), Maren at (−3.53, 5.46), Tomas at (0.76, −6.46) — so they stand cleanly outside the bandstand deck (radius 4.5 m).'),
    '## NPC stand-ins must state the original coords, the move outward to ~6.5 m, and the 4.5 m deck'
  );

  const mapMatch = stagingJs.match(/const\s+npcStandIns\s*=\s*new\s+Map\(\[([\s\S]*?)\]\);/);
  assert.ok(mapMatch, 'Could not parse npcStandIns Map in staging.js');
  const entries = [...mapMatch[1].matchAll(/\['(\w+)',\s*\{\s*group:\s*place\((Villager|Tradesman),\s*\{([\s\S]*?)\},\s*(-?[\d.]+),\s*(-?[\d.]+)\)/g)];
  assert.equal(entries.length, 3, 'Expected 3 entries in npcStandIns');
  const originals = { wick: [2.5, 3], maren: [-2.2, 3.4], tomas: [0.4, -3.4] };
  for (const [, handle, , , xStr, zStr] of entries) {
    const x = Number(xStr);
    const z = Number(zStr);
    const dist = Math.hypot(x, z);
    assert.ok(Math.abs(dist - 6.5) < 0.01, `${handle} distance from origin (${dist.toFixed(4)}) must be ~6.5 m`);
    assert.ok(dist > 4.5, `${handle} must stand outside the bandstand deck (radius 4.5 m)`);
    const [ox, oz] = originals[handle];
    const angleDiff = Math.abs(Math.atan2(z, x) - Math.atan2(oz, ox));
    assert.ok(angleDiff < 0.005, `${handle} must keep its original angle (diff ${angleDiff.toFixed(5)})`);
  }
});

test('Slice 512: lamp post glow default and night flame/glass match lamp-post.mjs (S3)', () => {
  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  assert.ok(buildingsSec.includes("glow default #ffbe57 — already the town's window colour"), '## Buildings Lamp post row must state glow default #ffbe57');
  assert.ok(buildingsSec.includes('flame #ffd98a, glass #ffb04a'), '## Buildings Lamp post row must state flame #ffd98a, glass #ffb04a');

  const lampSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'kit-medieval/lamp-post.mjs'), 'utf8');
  assert.ok(lampSrc.includes("flame: { color: '#ffd98a', intensity: 1.0,"), 'lamp-post.mjs night must set flame #ffd98a intensity 1.0');
  assert.ok(lampSrc.includes("glass: { color: '#ffb04a', intensity: 0.75,"), 'lamp-post.mjs night must set glass #ffb04a intensity 0.75');
  assert.ok(lampSrc.includes("glow:    { type: 'color', default: '#ffbe57'"), 'lamp-post.mjs params must default glow to #ffbe57');
  assert.match(stagingJs, /place\(LampPost,\s*\{\s*scale:\s*s\s*\},\s*x,\s*z,\s*\{\s*rotY:\s*0\s*\}\)/, 'staging.js LampPost placement must pass no glow override, so the default applies');
});

test('Slice 512: Terrain table full rows verbatim including notes (S4)', () => {
  const terrainSec = getSection(readmeMd, 'Terrain (as built — no fallbacks needed)').replace(/\s+/g, ' ');
  for (const row of [
    '| span | 2 | 128 × 128 m (the live clearing is a 60 m disc) |',
    "| clearing | 30 | matches the town's clearing radius |",
    '| flatten | 0.5 | a level circle ~1/3 of the block across, in the middle |',
    '| lake | 0.3 | a small lake, not a shoreline takeover |',
    '| colorway | golden-evening | warm ground, darker water |',
    '| edges | island |',
  ]) {
    assert.ok(terrainSec.includes(row), `## Terrain table must include the full row "${row}"`);
  }
});

test('Slice 512: one kit cottage shape for all resident styles (S5)', () => {
  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups').replace(/\s+/g, ' ');
  assert.ok(
    limitsSec.includes("**One kit cottage shape for all resident styles**: `kit-medieval/cottage-small.mjs` has one cottage silhouette (so Tomas's `tower` style reads as a cottage; his signpost + manifest colors carry the identity)."),
    '## Known limits must state one kit cottage shape for all resident styles'
  );

  const cottageFiles = fs.readdirSync(path.join(BUNDLE_DIR, 'kit-medieval')).filter((n) => /^cottage-.*\.mjs$/.test(n));
  assert.deepEqual(cottageFiles, ['cottage-small.mjs'], 'kit-medieval/ must hold exactly one cottage module');
  assert.ok(stagingJs.includes("import * as Cottage from './kit-medieval/cottage-small.mjs';"), 'staging.js must import cottage-small.mjs');
  const cottageImports = [...stagingJs.matchAll(/from\s+'\.\/kit-medieval\/cottage-[^']+'/g)].map((m) => m[0]);
  assert.deepEqual(cottageImports, ["from './kit-medieval/cottage-small.mjs'"], 'staging.js must import no other cottage module');
});

test('Slice 512: Terrain pitches left at the kit default of 4 (S6)', () => {
  const limitsSec = getSection(readmeMd, 'Known limits / follow-ups').replace(/\s+/g, ' ');
  assert.ok(
    limitsSec.includes('Terrain `pitches` left at the kit default (4 level packed-earth camp pitches on the shelf behind the shore) — they read as clearings, away from the town middle.'),
    '## Known limits must state Terrain pitches left at the kit default of 4'
  );

  const terrainJson = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, 'kit-campground/TERRAIN.json'), 'utf8'));
  assert.equal(terrainJson.pitches, 4, 'kit-campground/TERRAIN.json pitches must be 4');
  const layoutJson = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, 'kit-campground/LAYOUT.json'), 'utf8'));
  assert.ok(Array.isArray(layoutJson), 'kit-campground/LAYOUT.json must be an array');
  assert.equal(layoutJson[0]?.params?.pitches, 4, 'kit-campground/LAYOUT.json terrain entry pitches must be 4');
});

test('Slice 512: inn-nightly-call, event-banner, and prompt-book have no THREE import or top-level document access (S7)', () => {
  // inn-nightly-call.mjs wraps the claim across two comment lines
  // ("...; no" / "// top-level ..."), so check the two fragments.
  const innSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'inn-nightly-call.mjs'), 'utf8');
  assert.ok(innSrc.includes('No THREE import; no') && innSrc.includes('top-level document access.'), 'inn-nightly-call.mjs header must state no THREE import and no top-level document access');
  assert.doesNotMatch(innSrc, /from\s+['"]three['"]/, 'inn-nightly-call.mjs must not import from three');
  assert.doesNotMatch(innSrc, /document\./, 'inn-nightly-call.mjs must not contain a document. reference');

  for (const [file, headerClaim] of [
    ['event-banner.mjs', 'No THREE import; no top-level document access'],
    ['prompt-book.mjs', 'no THREE dependency, no top-level document access'],
  ]) {
    const src = fs.readFileSync(path.join(BUNDLE_DIR, file), 'utf8');
    assert.ok(src.includes(headerClaim), `${file} header must state ${headerClaim}`);
    assert.doesNotMatch(src, /from\s+['"]three['"]/, `${file} must not import from three`);
    assert.doesNotMatch(src, /document\./, `${file} must not contain a document. reference`);
  }
});

test('Slice 512: node --check on staging.js as .mjs matches Verification bullet (S8)', () => {
  const verSec = getSection(readmeMd, 'Verification done locally (no browser here — no visual check claimed)').replace(/\s+/g, ' ');
  assert.ok(verSec.includes('`node --check` on staging.js (as `.mjs`).'), '## Verification must state node --check on staging.js (as .mjs)');

  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-check512-'));
  try {
    const copyPath = path.join(tmpOut, 'staging-check.mjs');
    fs.copyFileSync(path.join(BUNDLE_DIR, 'staging.js'), copyPath);
    execFileSync(process.execPath, ['--check', copyPath], { encoding: 'utf8' });
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test('Slice 512: buildings stood via groundAt, faced to centre, lit via camp.light with module defaults (S9)', () => {
  const buildingsSec = getSection(readmeMd, 'Buildings (place coordinates, metres; bandstand spot at 0,0)').replace(/\s+/g, ' ');
  assert.ok(
    buildingsSec.includes("Every Polyfork building is stood on the terrain at runtime via `camp.groundAt(x, z)` and faced toward the centre (as are the bandstand and Milo's cottage). Night glow for Polyfork modules is wired by hand through `camp.light(obj, pairs)` built from each module's `night` export — `kit-campground/kit.json` has no night pairs for the `kit-medieval/` building modules imported directly, so explicit pairs are required. No building's lit zone was recolored, so every `from` colour is the module default."),
    '## Buildings must state groundAt placement, facing the centre, camp.light night glow, and module-default from colours'
  );

  assert.ok(stagingJs.includes('const faceCenter = (x, z) => Math.atan2(-x, -z);'), 'staging.js must define faceCenter as atan2(-x, -z)');
  assert.match(stagingJs, /obj\.position\.set\(x,\s*camp\.groundAt\(x,\s*z\),\s*z\);[\s\S]*?obj\.rotation\.y\s*=\s*opts\.rotY\s*\?\?\s*faceCenter\(x,\s*z\);/, 'place() must stand on camp.groundAt and face the centre by default');
  assert.ok(stagingJs.includes('const from = params[zone] ?? mod.params?.[zone]?.default;'), 'lightUp must derive from as params[zone] ?? module default');
  assert.ok(stagingJs.includes('if (pairs.length) camp.light(obj, pairs);'), 'lightUp must call camp.light when pairs are non-empty');

  const kitJson = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, 'kit-campground/kit.json'), 'utf8'));
  const nightParts = new Set();
  for (const entry of kitJson.night || []) for (const part of entry.parts || []) nightParts.add(part);
  for (const med of ['tavern', 'cottage-small', 'gatehouse', 'windmill', 'well', 'lamp-post']) {
    assert.ok(!nightParts.has(med), `kit-campground/kit.json night must have no pairs for ${med}`);
  }

  for (const [name, file, params] of [
    ['Tavern', 'tavern.mjs', ['width', 'plaster', 'tile', 'timber']],
    ['Gatehouse', 'gatehouse.mjs', ['shingle', 'plaster', 'gateState', 'windows']],
    ['Well', 'well.mjs', []],
    ['LampPost', 'lamp-post.mjs', ['scale']],
    ['Windmill', 'windmill.mjs', ['tallness', 'stone']],
  ]) {
    const src = fs.readFileSync(path.join(BUNDLE_DIR, 'kit-medieval', file), 'utf8');
    const nightMatch = src.match(/export const night = \{([\s\S]*?)\n\};/);
    const zones = nightMatch ? [...nightMatch[1].matchAll(/^\s*(\w+):\s*\{/gm)].map((m) => m[1]) : [];
    const clash = zones.filter((z) => params.includes(z));
    assert.deepEqual(clash, [], `${name} night zones must not collide with place() params (no recolor)`);
  }
});

test('Slice 512: test-prompt-book.mjs bullet claims match prompt-book.mjs behavior (S10)', async () => {
  const contentsSec = getSection(readmeMd, 'Contents');
  const bullet = contentsSec.split(/\r?\n- /).find((b) => b.startsWith('`test-prompt-book.mjs`'));
  assert.ok(bullet, '## Contents must have a `test-prompt-book.mjs` bullet');
  assert.ok(
    bullet.replace(/\s+/g, ' ').includes('unit tests for `prompt-book.mjs` (100-entry cap, chronological order, `[NPC]` pill, `reply_to` threading, say vs emote, empty state, `textContent`-only XSS safety).'),
    'test-prompt-book.mjs bullet must list the 100-entry cap, chronological order, [NPC] pill, reply_to threading, say vs emote, empty state, and textContent-only XSS safety'
  );

  const { formatPromptBookEntries, renderPromptBook } = await import('./prompt-book.mjs');
  const entries = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, handle: `h${i + 1}`, role: 'muse', kind: 'say', body: `b${i + 1}` }));
  const formatted = formatPromptBookEntries(entries);
  assert.equal(formatted.length, 100, 'formatPromptBookEntries must cap at the most recent 100 lines');
  assert.equal(formatted[0].id, 2, 'formatPromptBookEntries must drop the oldest line');
  assert.equal(formatted[99].id, 101, 'formatPromptBookEntries must keep the newest line');
  assert.ok(formatted.every((e, i) => e.id === i + 2), 'formatPromptBookEntries must preserve chronological order');

  const pbSrc = fs.readFileSync(path.join(BUNDLE_DIR, 'prompt-book.mjs'), 'utf8');
  assert.ok(pbSrc.includes('Format and cap Prompt Book entries to the most recent 100 lines,'), 'prompt-book.mjs must document the 100-line cap');
  assert.equal([...pbSrc.matchAll(/innerHTML/g)].length, 1, 'innerHTML must appear exactly once in prompt-book.mjs (the header comment)');
  assert.ok(pbSrc.includes('(never innerHTML)'), 'prompt-book.mjs header must state textContent only (never innerHTML)');
  assert.ok(pbSrc.includes("entry.kind === 'emote' ? ` ${entry.body}` : `: ${entry.body}`"), 'renderPromptBook must use a space for emote and a colon for say');
  assert.ok(pbSrc.includes("empty.textContent = 'No remarks yet in the last 24h.';"), 'renderPromptBook must show the empty state');
  assert.ok(pbSrc.includes('`\\u21a9 #${entry.reply_to} @${targetHandle}`'), 'renderPromptBook must thread reply_to with the target handle');

  const makeEl = (tag) => {
    const el = { tag, className: '', textContent: '', children: [] };
    el.appendChild = (c) => { el.children.push(c); };
    el.removeChild = (c) => { el.children = el.children.filter((x) => x !== c); };
    Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
    return el;
  };
  const doc = { createElement: makeEl };
  const container = makeEl('div');
  renderPromptBook(container, [
    { id: 1, handle: 'wick', role: 'npc', kind: 'say', body: 'Hello', reply_to: null },
    { id: 2, handle: 'visitor', role: 'guest', kind: 'emote', body: 'waves', reply_to: 1 },
  ], doc);
  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].children[2].textContent, ': Hello');
  assert.equal(container.children[1].children[1].textContent, '\u21a9 #1 @wick');
  assert.equal(container.children[1].children[3].textContent, ' waves');
});
