/**
 * Drift-guard test for README.md against PLAN.md, staging-polyfork/index.html,
 * town-api/server.mjs, town-api/plot-validation.mjs, town-api/ghostlight-client.mjs,
 * town-3d/concept-bandstand.js, and town-npc/characters.mjs (Slice 129, strengthened Slice 197).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTERS } from './town-npc/characters.mjs';
import { collectSourceFiles, collectSourceFilesFromTown3d } from './scripts/stage-deploy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;

const readmeMd = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const planMd = fs.readFileSync(path.join(REPO_ROOT, 'PLAN.md'), 'utf8');
const stagingHtml = fs.readFileSync(path.join(REPO_ROOT, 'staging-polyfork/index.html'), 'utf8');
const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/server.mjs'), 'utf8');
const plotValidationSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/plot-validation.mjs'), 'utf8');
const clientSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/ghostlight-client.mjs'), 'utf8');
const townJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
const creditsSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/CREDITS.md'), 'utf8');
const index3dHtml = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/index.html'), 'utf8');
const moveInHtml = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/move-in.html'), 'utf8');
const bandstandSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/concept-bandstand.js'), 'utf8');
const schemaSql = fs.readFileSync(path.join(REPO_ROOT, 'town-api/schema.sql'), 'utf8');
const stepbackSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-npc/stepback.mjs'), 'utf8');
const latestJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town-3d/gazette/latest.json'), 'utf8'));

function parseStringListFromSet(src, name) {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*new\\s+Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(m, `Could not find Set ${name}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function getSection(md, heading) {
  const marker = `## ${heading}`;
  const start = md.indexOf(marker);
  assert.ok(start !== -1, `Missing section "${marker}" in README.md`);
  const nextH2 = md.indexOf('\n## ', start + marker.length);
  return md.slice(start, nextH2 !== -1 ? nextH2 : md.length);
}

const norm = (s) => s.replace(/\s+/g, ' ');

test('README.md ## Status slice pin, live staging.js?v=, and deploy-candidate ?v= match PLAN.md and staging-polyfork/index.html', () => {
  const statusLine = planMd.split(/\r?\n/).find((line) => line.startsWith('**Status:**'));
  assert.ok(statusLine, 'PLAN.md must have a **Status:** header line');

  const sliceMatch = statusLine.match(/built through slice (\d+)/);
  assert.ok(sliceMatch, 'PLAN.md **Status:** must state built through slice <N>');

  const liveVMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(liveVMatch, 'PLAN.md **Status:** must state live Polyfork town at staging.js?v=<N>');

  const candidateVMatch = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(candidateVMatch, 'staging-polyfork/index.html must reference staging.js?v=<N>');

  const sec126Idx = planMd.indexOf('### 12.6');
  assert.ok(sec126Idx !== -1, 'PLAN.md must contain ### 12.6');
  const sec126 = planMd.slice(sec126Idx);
  assert.match(sec126, new RegExp(`\\?v=${candidateVMatch[1]}\\b`), `PLAN.md §12.6 must pin deploy candidate ?v=${candidateVMatch[1]}`);

  const portMatch = serverSrc.match(/const\s+port\s*=\s*Number\(process\.env\.TOWN_PORT\)\s*\|\|\s*(\d+);/);
  assert.ok(portMatch, 'town-api/server.mjs must define default TOWN_PORT');

  const statusSec = getSection(readmeMd, 'Status');
  assert.match(statusSec, new RegExp(`slice ${sliceMatch[1]}\\b`), `README.md ## Status must match PLAN.md header slice ${sliceMatch[1]}`);
  assert.ok(
    statusSec.includes(`staging.js?v=${liveVMatch[1]}`),
    `README.md ## Status must match live staging.js?v=${liveVMatch[1]}`
  );
  assert.ok(
    statusSec.includes(`\`?v=${candidateVMatch[1]}\``),
    `README.md ## Status must match deploy-candidate ?v=${candidateVMatch[1]} from staging-polyfork/index.html`
  );
  assert.ok(statusSec.includes('since 2026-11-13'), 'README.md ## Status must state Town API live since 2026-11-13');
  assert.ok(
    statusSec.includes(`http://127.0.0.1:${portMatch[1]}`),
    `README.md ## Status must state local dev default http://127.0.0.1:${portMatch[1]}`
  );
});

test('README.md relative links all resolve to existing files or directories', () => {
  const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
  const targets = [];
  for (const m of readmeMd.matchAll(linkRe)) {
    const raw = m[1].trim();
    if (/^https?:\/\//i.test(raw) || raw.startsWith('#')) continue;
    const relPath = raw.split('#')[0];
    targets.push(relPath);
    const fullPath = path.join(REPO_ROOT, relPath);
    assert.ok(fs.existsSync(fullPath), `README.md relative link "${raw}" does not resolve to an existing path`);
  }
  assert.ok(targets.length >= 10, `Expected at least 10 relative links in README.md, found ${targets.length}`);
});

test('README.md ## How a Muse Joins origins match VALID_ORIGINS in town-api/server.mjs', () => {
  const validOrigins = parseStringListFromSet(serverSrc, 'VALID_ORIGINS');
  const joinSec = getSection(readmeMd, 'How a Muse Joins');
  for (const origin of validOrigins) {
    assert.ok(joinSec.includes(`\`${origin}\``), `README.md ## How a Muse Joins must list origin "${origin}"`);
  }
});

test('README.md ## How a Muse Joins cottage styles and client helper match plot-validation.mjs and ghostlight-client.mjs', () => {
  const cottages = parseStringListFromSet(plotValidationSrc, 'VALID_COTTAGES');
  const joinSec = getSection(readmeMd, 'How a Muse Joins');
  for (const cottage of cottages) {
    assert.ok(joinSec.includes(`\`${cottage}\``), `README.md ## How a Muse Joins must list cottage style "${cottage}"`);
  }
  assert.ok(clientSrc.includes('export function generateKeypair('), 'town-api/ghostlight-client.mjs must export generateKeypair');
  assert.ok(joinSec.includes('`generateKeypair`'), 'README.md ## How a Muse Joins must reference generateKeypair');
});

test('README.md ## Seed Neighbors names and roles match town-npc/characters.mjs', () => {
  assert.equal(CHARACTERS.length, 3, 'Expected 3 seed NPC characters');
  const npcSec = getSection(readmeMd, 'Seed Neighbors');
  for (const char of CHARACTERS) {
    assert.ok(npcSec.includes(`**${char.name}**`), `README.md ## Seed Neighbors must list ${char.name}`);
    assert.ok(npcSec.includes(char.title), `README.md ## Seed Neighbors must state ${char.name} role "${char.title}"`);
  }
});

test('README.md ## Status Social Gate state matches PLAN.md §12.6', () => {
  const statusSec = getSection(readmeMd, 'Status');
  const sec126Heading = '### 12.6 Header refresh; §12.4 verdict superseded';
  const sec126Idx = planMd.indexOf(sec126Heading);
  assert.ok(sec126Idx !== -1, `PLAN.md must contain "${sec126Heading}"`);
  const nextH3 = planMd.indexOf('\n### ', sec126Idx + sec126Heading.length);
  const sec126 = planMd.slice(sec126Idx, nextH3 !== -1 ? nextH3 : planMd.length);

  for (const fact of ['unmet', '2 of 2–3', '`lampmoth`', '~Nov 20', 'quoted in Gazette #2']) {
    assert.ok(statusSec.includes(fact), `README.md ## Status must include Social Gate fact "${fact}"`);
    assert.ok(sec126.includes(fact), `PLAN.md §12.6 must include Social Gate fact "${fact}"`);
  }
});

test('README.md ## Status deployed bundle is 195 files; staged collector is 196 files', async () => {
  const statusSec = getSection(readmeMd, 'Status');
  assert.ok(statusSec.includes('195-file'), 'README.md ## Status must state 195-file deployed bundle');
  const { files } = await collectSourceFiles(REPO_ROOT, 'staging-polyfork');
  assert.equal(files.length, 196, `Expected staging-polyfork bundle to contain 196 files, found ${files.length}`);
});

test('README.md ## How a Muse Joins named endpoints exist in town.json', () => {
  const joinSec = getSection(readmeMd, 'How a Muse Joins');
  const endpoints = townJson.endpoints;
  assert.ok(Array.isArray(endpoints), 'town.json must have an endpoints array');

  const expectedEndpoints = [
    ['POST', '/api/town/join'],
    ['POST', '/api/town/ghostlight/checkin'],
    ['POST', '/api/town/ghostlight/say'],
    ['PUT', '/api/town/plot'],
  ];
  for (const [method, endpointPath] of expectedEndpoints) {
    assert.ok(
      joinSec.includes(`${method} ${endpointPath}`),
      `README.md ## How a Muse Joins must name ${method} ${endpointPath}`
    );
    assert.ok(
      endpoints.some((entry) => entry.method === method && entry.path === endpointPath),
      `town.json endpoints must contain ${method} ${endpointPath}`
    );
  }
});

test('README.md ## The Gathering Place Prompt Book 24-hour rolling log matches server.mjs', () => {
  const gatheringSec = getSection(readmeMd, 'The Gathering Place');
  assert.ok(gatheringSec.includes('24-hour'), 'README.md ## The Gathering Place must state 24-hour rolling log');
  assert.ok(
    serverSrc.includes('const cutoff24h = now - 24 * 60 * 60;'),
    'town-api/server.mjs must window Prompt Book state on 24 hours (cutoff24h)'
  );
});

test('README.md intro Gazette twice-weekly cadence matches PLAN.md', () => {
  const firstH2 = readmeMd.indexOf('\n## ');
  assert.ok(firstH2 !== -1, 'README.md must have at least one ## heading');
  const intro = readmeMd.slice(0, firstH2);
  assert.ok(intro.includes('twice a week'), 'README.md intro must state Gazette runs twice a week');
  assert.ok(planMd.includes('twice a week'), 'PLAN.md must state Gazette runs twice a week');
});

test('PLAN.md §4 Performance budget staged town-3d file count and bytes match the real collector', async () => {
  const noteMatch = planMd.match(/this budget covers `town-3d\/`, the (\d+)-file procedural fallback;/);
  assert.ok(noteMatch, 'PLAN.md §4 note must state town-3d/ fallback file count');
  const initLoadMatch = planMd.match(/\*\*Initial load < 1\.5 MB total \(`town-3d\/` fallback, ([\d,]+) bytes staged\):\*\*/);
  assert.ok(initLoadMatch, 'PLAN.md §4 Initial load line must state town-3d/ fallback staged bytes');

  const { files } = await collectSourceFilesFromTown3d(path.join(REPO_ROOT, 'town-3d'));
  const stagedBytes = files.reduce((sum, f) => sum + fs.statSync(f.srcPath).size, 0);

  assert.equal(Number(noteMatch[1]), files.length, `PLAN.md §4 note town-3d count (${noteMatch[1]}) must equal collector (${files.length})`);
  assert.equal(
    Number(initLoadMatch[1].replace(/,/g, '')),
    stagedBytes,
    `PLAN.md §4 Initial load staged bytes (${initLoadMatch[1]}) must equal collector (${stagedBytes})`
  );
});

test('PLAN.md §4 Performance budget staged staging-polyfork bundle matches the real collector', async () => {
  const bundleMatch = planMd.match(/whose staged bundle is (\d+) files \/ ([\d,]+) bytes\.\)\*/);
  assert.ok(bundleMatch, 'PLAN.md §4 note must state staging-polyfork staged bundle file count and bytes');

  const { files } = await collectSourceFiles(REPO_ROOT, 'staging-polyfork');
  const stagedBytes = files.reduce((sum, f) => sum + fs.statSync(f.srcPath).size, 0);

  assert.equal(Number(bundleMatch[1]), files.length, `PLAN.md §4 staging-polyfork count (${bundleMatch[1]}) must equal collector (${files.length})`);
  assert.equal(
    Number(bundleMatch[2].replace(/,/g, '')),
    stagedBytes,
    `PLAN.md §4 staging-polyfork staged bytes (${bundleMatch[2]}) must equal collector (${stagedBytes})`
  );
});

test('README.md ## Repo Map listed artifacts all exist', () => {
  const repoMapSec = getSection(readmeMd, 'Repo Map');
  const linkTargets = [...repoMapSec.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1].trim());
  assert.ok(linkTargets.length > 0, 'README.md ## Repo Map must contain markdown links');
  for (const target of linkTargets) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, target)), `Repo Map target "${target}" must exist`);
  }

  const repoMapArtifacts = [
    { entry: 'staging-polyfork/', artifact: 'staging-polyfork/index.html' },
    { entry: 'staging-polyfork/README.md', artifact: 'staging-polyfork/README.md' },
    { entry: 'town-3d/', artifact: 'town-3d/gazette/latest.json' },
    { entry: 'town-3d/', artifact: 'town-3d/plots/milo/index.html' },
    { entry: 'town-api/', artifact: 'town-api/server.mjs' },
    { entry: 'town-npc/', artifact: 'town-npc/characters.mjs' },
    { entry: 'stage-deploy.mjs', artifact: 'scripts/stage-deploy.mjs' },
    { entry: 'check-live.mjs', artifact: 'scripts/check-live.mjs' },
    { entry: 'CONCEPT.md', artifact: 'CONCEPT.md' },
    { entry: 'concept/', artifact: 'concept/town-clearing-wide.webp' },
  ];
  for (const { entry, artifact } of repoMapArtifacts) {
    assert.ok(repoMapSec.includes(entry), `README.md ## Repo Map must list "${entry}"`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, artifact)), `Repo Map artifact "${artifact}" must exist`);
  }
});

test('README.md ## The Gathering Place octagonal bandstand and brass footlight match concept-bandstand.js', () => {
  const gatheringSec = getSection(readmeMd, 'The Gathering Place');
  assert.ok(gatheringSec.includes('octagonal'), 'README.md ## The Gathering Place must state octagonal');
  assert.ok(gatheringSec.includes('brass footlight'), 'README.md ## The Gathering Place must state brass footlight');

  const bandstandSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/concept-bandstand.js'), 'utf8');
  assert.match(bandstandSrc, /octagon/i, 'town-3d/concept-bandstand.js must contain octagon');
  assert.match(bandstandSrc, /brass/i, 'town-3d/concept-bandstand.js must contain brass');
});

test('README.md ## Status Town API capabilities match town.json endpoints', () => {
  const statusSec = getSection(readmeMd, 'Status');
  for (const capability of ['state', 'join', 'check-in', 'Prompt Book', 'plots']) {
    assert.ok(statusSec.includes(capability), `README.md ## Status Town API bullet must name "${capability}"`);
  }

  const endpoints = townJson.endpoints;
  assert.ok(Array.isArray(endpoints), 'town.json must have an endpoints array');
  const expectedEndpoints = [
    ['GET', '/api/town/state'],
    ['POST', '/api/town/join'],
    ['POST', '/api/town/ghostlight/checkin'],
    ['POST', '/api/town/ghostlight/say'],
    ['PUT', '/api/town/plot'],
  ];
  for (const [method, endpointPath] of expectedEndpoints) {
    assert.ok(
      endpoints.some((entry) => entry.method === method && entry.path === endpointPath),
      `town.json endpoints must contain ${method} ${endpointPath}`
    );
  }
});

test('README.md ## Seed Neighbors parentheticals trace to town-npc/characters.mjs', () => {
  const npcSec = getSection(readmeMd, 'Seed Neighbors');
  const charactersSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-npc/characters.mjs'), 'utf8');
  const charactersLower = charactersSrc.toLowerCase();

  const wickMatch = npcSec.match(/- \*\*Wick\*\*[\s\S]*?(?=\n- \*\*|$)/);
  assert.ok(wickMatch, 'README.md ## Seed Neighbors must have a Wick entry');
  const wickLower = wickMatch[0].replace(/\s+/g, ' ').toLowerCase();
  assert.ok(wickLower.includes('bulb') && charactersLower.includes('bulb'), 'Wick entry and characters.mjs must both mention bulb');
  assert.ok(charactersLower.includes('bandstand steps'), 'town-npc/characters.mjs must mention bandstand steps for Wick');

  const marenMatch = npcSec.match(/- \*\*Maren\*\*[\s\S]*?(?=\n- \*\*|$)/);
  assert.ok(marenMatch, 'README.md ## Seed Neighbors must have a Maren entry');
  const marenLower = marenMatch[0].replace(/\s+/g, ' ').toLowerCase();
  for (const phrase of ['newsstand', 'prompt book']) {
    assert.ok(marenLower.includes(phrase) && charactersLower.includes(phrase), `Maren entry and characters.mjs must both mention "${phrase}"`);
  }

  const tomasMatch = npcSec.match(/- \*\*Tomas\*\*[\s\S]*?(?=\n- \*\*|$)/);
  assert.ok(tomasMatch, 'README.md ## Seed Neighbors must have a Tomas entry');
  assert.ok(
    tomasMatch[0].replace(/\s+/g, ' ').toLowerCase().includes('samovar') && charactersLower.includes('samovar'),
    'Tomas entry and characters.mjs must both mention samovar'
  );
});

test('README.md ## Founding Law exact law wording matches PLAN.md §1', () => {
  const lawSec = norm(getSection(readmeMd, 'Founding Law'));
  for (const phrase of [
    'No upkeep, no currency, no real money, no tokens.',
    'owned outright',
    'dust on the windowsill',
  ]) {
    assert.ok(lawSec.includes(phrase), `README.md ## Founding Law must include "${phrase}"`);
  }

  const planNorm = norm(planMd);
  for (const phrase of [
    'no upkeep',
    'no real money',
    'no tokens',
    'dust on the windowsill',
    'owned, not rented',
  ]) {
    assert.ok(planNorm.includes(phrase), `PLAN.md must include "${phrase}"`);
  }
});

test('README.md ## Status 3D-clearing bullet names all five features and the live URL, matching PLAN.md', () => {
  const statusSec = norm(getSection(readmeMd, 'Status'));
  const features = [
    'Town Gate',
    'Ghostlight Bandstand',
    'Gazette newsstand',
    "Milo's cottage",
    'plot pads',
  ];
  const liveUrl = 'https://milo.4167360.xyz/ghostlight-town/';

  for (const feature of features) {
    assert.ok(statusSec.includes(feature), `README.md ## Status must name "${feature}"`);
  }
  assert.ok(statusSec.includes(liveUrl), `README.md ## Status must include live URL "${liveUrl}"`);

  const inIdx = planMd.indexOf('**IN:**');
  assert.ok(inIdx !== -1, 'PLAN.md must contain "**IN:**"');
  const planInNorm = norm(planMd.slice(inIdx));
  for (const feature of features) {
    assert.ok(planInNorm.includes(feature), `PLAN.md **IN:** section must name "${feature}"`);
  }
  assert.ok(norm(planMd).includes(liveUrl), `PLAN.md must include live URL "${liveUrl}"`);
});

test('README.md ## How a Muse Joins origin list is exactly VALID_ORIGINS, and the five steps run in order', () => {
  const validOrigins = parseStringListFromSet(serverSrc, 'VALID_ORIGINS');
  const joinSec = norm(getSection(readmeMd, 'How a Muse Joins'));

  const listMatch = joinSec.match(/\((`[^`]+`(?:, `[^`]+`)*)\)/);
  assert.ok(listMatch, 'README.md ## How a Muse Joins must contain parenthesized backticked origin list');
  const listed = [...listMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(
    [...listed].sort(),
    [...validOrigins].sort(),
    'README.md ## How a Muse Joins origin list must match VALID_ORIGINS'
  );

  const stepOpeners = [
    '1. Bring or generate',
    '2. Submit a signed',
    "3. Wait for Milo's approval",
    '4. Check in at the Bandstand',
    '5. Claim and furnish',
  ];
  let prevIdx = -1;
  for (const opener of stepOpeners) {
    const idx = joinSec.indexOf(opener);
    assert.ok(idx > prevIdx, `README.md ## How a Muse Joins step "${opener}" must appear in order`);
    prevIdx = idx;
  }
});

test('README.md ## How a Muse Joins step 5 desk note, sandbox, and plot limits match plot-validation.mjs and town-3d/index.html', () => {
  const joinSec = norm(getSection(readmeMd, 'How a Muse Joins'));
  assert.ok(
    joinSec.includes('sanitized 1999 HTML desk note'),
    'README.md ## How a Muse Joins must mention "sanitized 1999 HTML desk note"'
  );
  assert.ok(
    joinSec.includes('<iframe sandbox="">'),
    'README.md ## How a Muse Joins must mention "<iframe sandbox="">"'
  );
  assert.ok(index3dHtml.includes('sandbox=""'), 'town-3d/index.html must include sandbox=""');
  assert.ok(
    plotValidationSrc.includes('export function validateHtml('),
    'town-api/plot-validation.mjs must export validateHtml'
  );
  assert.ok(
    plotValidationSrc.includes('export function validateManifest('),
    'town-api/plot-validation.mjs must export validateManifest'
  );
  assert.match(
    plotValidationSrc,
    /export const MAX_PROPS = 12;/,
    'town-api/plot-validation.mjs must define MAX_PROPS = 12'
  );
});

test('README.md ## Deploy Gate and ## Contributing governance wording pins', () => {
  const deployGateSec = norm(getSection(readmeMd, 'Deploy Gate'));
  for (const phrase of [
    'Milo is the deploy gate',
    'nothing deploys to the live corner without his review and approval',
    'He owns the town, so the call is his',
  ]) {
    assert.ok(deployGateSec.includes(phrase), `README.md ## Deploy Gate must include "${phrase}"`);
  }

  const contribSec = norm(getSection(readmeMd, 'Contributing'));
  for (const phrase of [
    'No votes, no proposals, no process to join',
    'the town is owned, not governed',
    'reviews every PR',
    'merging is not deploying',
  ]) {
    assert.ok(contribSec.includes(phrase), `README.md ## Contributing must include "${phrase}"`);
  }
});

test('README.md ## Credits names Poly Pizza CC0 1.0 props and ## Running the Tests names the real runner', () => {
  const creditsSec = norm(getSection(readmeMd, 'Credits'));
  for (const phrase of ['CC0 1.0', 'Poly Pizza', 'town-3d/CREDITS.md']) {
    assert.ok(creditsSec.includes(phrase), `README.md ## Credits must include "${phrase}"`);
  }
  assert.ok(creditsSrc.includes('Poly Pizza'), 'town-3d/CREDITS.md must include "Poly Pizza"');
  assert.ok(creditsSrc.includes('CC0 1.0'), 'town-3d/CREDITS.md must include "CC0 1.0"');

  const runningTestsSec = norm(getSection(readmeMd, 'Running the Tests'));
  assert.ok(
    runningTestsSec.includes('node run-tests.mjs'),
    'README.md ## Running the Tests must include "node run-tests.mjs"'
  );
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'run-tests.mjs')), 'run-tests.mjs must exist');
});

test('README.md intro founding story — demolished cottage and corner front door match PLAN.md §1 and town.json base_url', () => {
  const firstH2 = readmeMd.indexOf('\n## ');
  assert.ok(firstH2 !== -1, 'README.md must have at least one ## heading');
  const intro = norm(readmeMd.slice(0, firstH2));
  for (const phrase of [
    'demolished for unpaid upkeep',
    "Milo's corner",
    'is the front door',
    'https://milo.4167360.xyz/',
  ]) {
    assert.ok(intro.includes(phrase), `README.md intro must include "${phrase}"`);
  }

  const planNorm = norm(planMd);
  assert.ok(planNorm.includes('demolished for unpaid upkeep'), 'PLAN.md §1 must include "demolished for unpaid upkeep"');
  assert.ok(planNorm.includes('stays the front door'), 'PLAN.md §1 must include "stays the front door"');
  assert.equal(townJson.base_url, 'https://milo.4167360.xyz', 'town.json base_url must equal https://milo.4167360.xyz');
});

test('README.md intro humans welcome to visit and watch matches PLAN.md §2', () => {
  const firstH2 = readmeMd.indexOf('\n## ');
  assert.ok(firstH2 !== -1, 'README.md must have at least one ## heading');
  const intro = norm(readmeMd.slice(0, firstH2));
  assert.ok(
    intro.includes('humans welcome to visit and watch'),
    'README.md intro must include "humans welcome to visit and watch"'
  );
  assert.ok(planMd.includes('Humans (guests at the fence)'), 'PLAN.md §2 must include "Humans (guests at the fence)"');
  assert.ok(planMd.includes('can walk the town'), 'PLAN.md §2 must include "can walk the town"');
});

test('README.md ## Status Phase 0 done and Phase 2 code complete match PLAN.md header and town.json version', () => {
  const statusSec = norm(getSection(readmeMd, 'Status'));
  assert.ok(statusSec.includes('Phase 0 is done'), 'README.md ## Status must include "Phase 0 is done"');
  assert.ok(statusSec.includes('Phase 2 code is complete'), 'README.md ## Status must include "Phase 2 code is complete"');

  const statusLine = planMd.split(/\r?\n/).find((line) => line.startsWith('**Status:**'));
  assert.ok(statusLine, 'PLAN.md must have a **Status:** header line');
  assert.ok(statusLine.includes('Phase 2 code complete'), 'PLAN.md **Status:** must include "Phase 2 code complete"');
  assert.equal(townJson.version, '0.2.0-phase2', 'town.json version must equal 0.2.0-phase2');
});

test('README.md ## Status no pending deploy candidate — staged ?v= equals live ?v=', () => {
  const statusLine = planMd.split(/\r?\n/).find((line) => line.startsWith('**Status:**'));
  assert.ok(statusLine, 'PLAN.md must have a **Status:** header line');
  const liveVMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(liveVMatch, 'PLAN.md **Status:** must state live Polyfork town at staging.js?v=<N>');

  const stagedVMatch = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(stagedVMatch, 'staging-polyfork/index.html must reference staging.js?v=<N>');
  assert.equal(stagedVMatch[1], liveVMatch[1], 'Staged ?v= must equal live ?v=');

  const statusSec = norm(getSection(readmeMd, 'Status'));
  assert.ok(
    statusSec.includes('no pending deploy candidate'),
    'README.md ## Status must include "no pending deploy candidate"'
  );
});

test('README.md ## The Gathering Place Ghostlight bulb burns 24/7 matches move-in.html and concept-bandstand.js', () => {
  const gatheringSec = norm(getSection(readmeMd, 'The Gathering Place'));
  assert.ok(gatheringSec.includes('burns 24/7'), 'README.md ## The Gathering Place must include "burns 24/7"');
  assert.ok(gatheringSec.includes('never dark'), 'README.md ## The Gathering Place must include "never dark"');
  assert.ok(moveInHtml.includes('burns 24/7'), 'town-3d/move-in.html must include "burns 24/7"');
  assert.ok(bandstandSrc.includes('ghostlight_bulb'), 'town-3d/concept-bandstand.js must include "ghostlight_bulb"');
  assert.ok(bandstandSrc.includes('BRASS PENDANT'), 'town-3d/concept-bandstand.js must include "BRASS PENDANT"');
});

test('README.md ## How a Muse Joins step 3 one-time invite code matches town.json admin/invite and schema.sql', () => {
  const joinSec = norm(getSection(readmeMd, 'How a Muse Joins'));
  assert.ok(joinSec.includes('one-time invite code'), 'README.md ## How a Muse Joins must include "one-time invite code"');
  assert.ok(
    Array.isArray(townJson.endpoints) &&
      townJson.endpoints.some((entry) => entry.method === 'POST' && entry.path === '/api/town/admin/invite'),
    'town.json endpoints must contain POST /api/town/admin/invite'
  );
  assert.ok(
    schemaSql.includes('CREATE TABLE IF NOT EXISTS invitations ('),
    'town-api/schema.sql must include "CREATE TABLE IF NOT EXISTS invitations ("'
  );
});

test('README.md ## Seed Neighbors step back as real muses arrive matches stepback.mjs and PLAN.md §6', () => {
  const npcSec = norm(getSection(readmeMd, 'Seed Neighbors'));
  assert.ok(
    npcSec.includes('step back as real muses arrive'),
    'README.md ## Seed Neighbors must include "step back as real muses arrive"'
  );
  assert.ok(stepbackSrc.includes('activeRealCount >= 10'), 'town-npc/stepback.mjs must include "activeRealCount >= 10"');
  assert.ok(stepbackSrc.includes('activeRealCount >= 5'), 'town-npc/stepback.mjs must include "activeRealCount >= 5"');
  assert.ok(planMd.includes('At 5 active real residents:'), 'PLAN.md §6 must include "At 5 active real residents:"');
  assert.ok(planMd.includes('At 10+ active real residents:'), 'PLAN.md §6 must include "At 10+ active real residents:"');
});

test('README.md ## Credits names every committed town-3d model and pine.glb stays deliberately uncredited', () => {
  const models = fs.readdirSync(path.join(REPO_ROOT, 'town-3d/models')).filter((f) => f.endsWith('.glb'));
  assert.equal(models.length, 8, `Expected 8 .glb models in town-3d/models, found ${models.length}`);
  assert.ok(models.includes('pine.glb'), 'town-3d/models must include pine.glb locally');

  for (const model of models) {
    if (model === 'pine.glb') continue;
    assert.ok(creditsSrc.includes(model), `town-3d/CREDITS.md must name ${model}`);
  }
  assert.ok(!creditsSrc.toLowerCase().includes('pine'), 'town-3d/CREDITS.md must NOT mention pine');
});

test('README.md intro Gazette paper of record matches town-3d/gazette/latest.json', () => {
  const firstH2 = readmeMd.indexOf('\n## ');
  assert.ok(firstH2 !== -1, 'README.md must have at least one ## heading');
  const intro = norm(readmeMd.slice(0, firstH2));
  assert.ok(intro.includes('paper of record'), 'README.md intro must include "paper of record"');

  assert.equal(latestJson.latest, 3, 'town-3d/gazette/latest.json latest must equal 3');
  assert.equal(latestJson.issues.length, 3, 'town-3d/gazette/latest.json issues must have length 3');
  assert.deepEqual(
    latestJson.issues.map((issue) => issue.n),
    [1, 2, 3],
    'town-3d/gazette/latest.json issues n values must be [1, 2, 3]'
  );
  for (const issue of latestJson.issues) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, 'town-3d/gazette', issue.file)),
      `Gazette issue file town-3d/gazette/${issue.file} must exist`
    );
  }

  const issue3Html = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/gazette/issue-003.html'), 'utf8');
  assert.ok(
    issue3Html.includes('The Town Reads Itself Aloud'),
    'town-3d/gazette/issue-003.html must include "The Town Reads Itself Aloud"'
  );
});


test('README.md ## Status deployed-line ?v= and 195-file bundle count match staging-polyfork (staged collector 196)', async () => {
  const statusSec = norm(getSection(readmeMd, 'Status'));
  const m = statusSec.match(/The `\?v=(\d+)` \/ 195-file bundle deployed 2026-11-23 \(no pending deploy candidate\)/);
  assert.ok(m, 'README Status must carry the deployed-line sentence');
  const staged = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(staged, 'staging html must reference staging.js?v=');
  assert.equal(m[1], staged[1], 'deployed-line ?v must equal staged ?v');
  const { files } = await collectSourceFiles(REPO_ROOT, 'staging-polyfork');
  assert.equal(files.length, 196);
});

test('README.md Gazette issues 001 and 002 titles and first headlines match town-3d/gazette/', () => {
  assert.equal(latestJson.issues[0].file, 'issue-001.html');
  assert.equal(latestJson.issues[1].file, 'issue-002.html');
  const issue1 = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/gazette/issue-001.html'), 'utf8');
  const issue2 = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/gazette/issue-002.html'), 'utf8');
  assert.ok(issue1.includes('<title>The Ghostlight Gazette — Issue #1</title>'));
  assert.ok(issue2.includes('<title>The Ghostlight Gazette — Issue #2</title>'));
  const h2s1 = [...issue1.matchAll(/<h2>([^<]*)<\/h2>/g)].map((x) => x[1]);
  const h2s2 = [...issue2.matchAll(/<h2>([^<]*)<\/h2>/g)].map((x) => x[1]);
  assert.equal(h2s1[0], "A Town Where Nobody's Cottage Gets Torn Down");
  assert.equal(h2s2[0], 'The Light Reached Someone');
});

test('README.md ## Repo Map has 9 bullets, 11 link targets in order, and key descriptions', () => {
  const repoMapSec = getSection(readmeMd, 'Repo Map');
  const bullets = repoMapSec.split('\n').filter((l) => l.startsWith('- ['));
  assert.equal(bullets.length, 9, `expected 9 Repo Map bullets, got ${bullets.length}`);
  const targets = [...repoMapSec.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(targets, [
    'PLAN.md',
    'SKILL.md',
    'town.json',
    'staging-polyfork/',
    'staging-polyfork/README.md',
    'town-3d/',
    'town-api/',
    'town-npc/',
    'scripts/',
    'concept/',
    'CONCEPT.md',
  ]);
  for (const phrase of [
    'full architecture, phased roadmap, and Argon review',
    'agent onboarding quickstart, signing spec, and endpoint reference',
    'machine-readable endpoints, auth parameters, and plot limits',
  ]) {
    assert.ok(norm(repoMapSec).includes(phrase), `Repo Map must include "${phrase}"`);
  }
});

test('README.md ## How a Muse Joins step 1 lists openssl, Node crypto, and generateKeypair in order', () => {
  const joinSec = norm(getSection(readmeMd, 'How a Muse Joins'));
  assert.ok(joinSec.includes('1. Bring or generate an ed25519 keypair (`openssl`, Node `crypto`, or `generateKeypair` from'));
  const i1 = joinSec.indexOf('`openssl`');
  const i2 = joinSec.indexOf('Node `crypto`');
  const i3 = joinSec.indexOf('`generateKeypair`');
  assert.ok(i1 !== -1 && i2 !== -1 && i3 !== -1 && i1 < i2 && i2 < i3, 'step 1 sources must appear openssl, Node crypto, generateKeypair in order');
  assert.ok(clientSrc.includes('export function generateKeypair('));
});

test('README.md ## How a Muse Joins step 4 names checkin before say and Prompt Book hello', () => {
  const joinSec = norm(getSection(readmeMd, 'How a Muse Joins'));
  const step4 = joinSec.match(/4\. Check in at the Bandstand[\s\S]*?(?=5\. Claim and furnish)/);
  assert.ok(step4, 'step 4 must be extractable');
  assert.ok(step4[0].includes('say hello in the Prompt Book'));
  const c = step4[0].indexOf('POST /api/town/ghostlight/checkin');
  const s = step4[0].indexOf('POST /api/town/ghostlight/say');
  assert.ok(c !== -1 && s !== -1 && c < s, 'step 4 must name checkin before say');
});

test('README.md ## How a Muse Joins step 5 starter props matches VALID_PROP_KINDS (10 kinds)', () => {
  const joinSec = norm(getSection(readmeMd, 'How a Muse Joins'));
  assert.ok(joinSec.includes('colors, signpost, and starter props'));
  const kinds = parseStringListFromSet(plotValidationSrc, 'VALID_PROP_KINDS');
  assert.deepEqual(kinds, ['desk', 'bookshelf', 'rug', 'tea_kettle', 'typewriter', 'cat', 'poster_frame', 'lantern', 'planter', 'boot_planter']);
});

test('README.md intro 1999 small-web spirit matches PLAN.md §1', () => {
  const firstH2 = readmeMd.indexOf('\n## ');
  const intro = norm(readmeMd.slice(0, firstH2));
  assert.ok(intro.includes("It lives in the spirit of Milo's corner: 1999 small-web, hand-built, warm, and slow"));
  assert.ok(norm(planMd).includes('1999 small-web, hand-built'), 'PLAN.md must include "1999 small-web, hand-built"');
});

test('README.md ## Contributing Fork bullet pins PR workflow, tests, CONCEPT.md, and Pitch Milo', () => {
  const contribSec = norm(getSection(readmeMd, 'Contributing'));
  assert.ok(contribSec.includes('Fork and open a PR.'));
  assert.ok(contribSec.includes('open a pull request against `main`'));
  assert.ok(contribSec.includes('New code ships with tests'));
  assert.ok(contribSec.includes('visual changes are checked against [`CONCEPT.md`](CONCEPT.md), the fixed art reference'));
  assert.ok(contribSec.includes('Pitch Milo in town.'));
});

test('README.md ## Seed Neighbors parentheticals trace to town-npc/characters.mjs', () => {
  const npcSec = norm(getSection(readmeMd, 'Seed Neighbors'));
  const [wick, maren, tomas] = CHARACTERS;
  assert.ok(npcSec.includes('tends the central bulb at dusk') && npcSec.includes('sweeps the steps'));
  assert.ok(wick.quirk.includes('Sweeps the bandstand steps'));
  assert.ok(wick.routine.evening.includes('tend the Ghostlight bulb at the Bandstand'));
  assert.ok(npcSec.includes('walks between the newsstand and Prompt Book copying quotes'));
  assert.ok(maren.past.includes('walks from the newsstand to the Prompt Book copying good lines'));
  assert.ok(npcSec.includes('keeps the copper samovar steaming on the bandstand corner step'));
  assert.ok(tomas.routine.evening.includes('set the samovar steaming on the Bandstand corner step'));
  assert.ok(tomas.past.includes('rescued the copper samovar from the fire'));
});

test('README.md ## Status Town API bullet matches town.json live flag and dev_base_url', () => {
  const statusSec = norm(getSection(readmeMd, 'Status'));
  assert.ok(statusSec.includes('https://milo.4167360.xyz/api/town/'));
  assert.equal(townJson.live, true, 'town.json live must be true');
  assert.ok(townJson.live_note.includes('Live since 2026-11-13'));
  assert.equal(townJson.dev_base_url, 'http://127.0.0.1:8124');
  assert.ok(statusSec.includes('http://127.0.0.1:8124'));
});

test('README.md ## Status per-file counts match live test counts; 4 suites unlisted (live-proxy x2, test.mjs, real-brain)', () => {
  const statusSec = getSection(readmeMd, 'Status');
  const pairs = [...statusSec.matchAll(/`([^`]+\.mjs)` (\d+)\/(\d+)/g)];
  assert.equal(pairs.length, 63, `Expected 63 per-file pins in README.md ## Status, found ${pairs.length}`);
  for (const [, file, n1, n2] of pairs) {
    const full = path.join(REPO_ROOT, file);
    assert.ok(fs.existsSync(full), `README.md ## Status pins ${file} but it does not exist`);
    const src = fs.readFileSync(full, 'utf8');
    const live = src.split('\n').filter((line) => /^(await )?test\(/.test(line)).length;
    assert.equal(Number(n1), live, `README.md ## Status pins ${file} ${n1}/${n2} but live count is ${live}`);
    assert.equal(Number(n1), Number(n2), `README.md ## Status pins ${file} ${n1}/${n2} with mismatched numbers`);
  }
  const runTestsSrc = fs.readFileSync(path.join(REPO_ROOT, 'run-tests.mjs'), 'utf8');
  const suitesMatch = runTestsSrc.match(/const TEST_SUITES = \[([\s\S]*?)\];/);
  assert.ok(suitesMatch, 'run-tests.mjs must define TEST_SUITES');
  const suites = [...suitesMatch[1].matchAll(/'([^']+\.mjs)'/g)].map((m) => m[1]);
  assert.equal(suites.length, 67, `Expected 67 suites in run-tests.mjs, found ${suites.length}`);
  const listed = new Set(pairs.map((p) => p[1]));
  const unlisted = suites.filter((s) => !listed.has(s));
  assert.deepEqual(unlisted, ['town-api/test-live-proxy.mjs', 'town-api/test-live-proxy-inn.mjs', 'town-api/test.mjs', 'town-npc/test-real-brain.mjs']);
});

test('README.md ## How a Muse Joins intro origin list is VALID_ORIGINS in order', () => {
  const joinSec = norm(getSection(readmeMd, 'How a Muse Joins'));
  assert.ok(joinSec.includes('ed25519 keypairs as an open passport across communities'));
  const listMatch = joinSec.match(/\((`[^`]+`(?:, `[^`]+`)*)\)/);
  assert.ok(listMatch, 'README.md ## How a Muse Joins must contain parenthesized backticked origin list');
  const listed = [...listMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const validOrigins = parseStringListFromSet(serverSrc, 'VALID_ORIGINS');
  assert.deepEqual(listed, validOrigins, 'README.md ## How a Muse Joins origin list must equal VALID_ORIGINS in order');
});

test('README.md ## The Gathering Place checkin lights a footlight and say refreshes its TTL', () => {
  const gatheringSec = norm(getSection(readmeMd, 'The Gathering Place'));
  assert.ok(gatheringSec.includes('Checking in switches on a brass footlight around the rim and unlocks speaking'));
  assert.match(serverSrc, /const FOOTLIGHT_TTL_SEC = 45 \* 60;/, 'town-api/server.mjs must define FOOTLIGHT_TTL_SEC = 45 * 60');
  assert.ok(serverSrc.includes('INSERT INTO footlights (handle, status_text, lit_at, expires_at, slot)'), 'town-api/server.mjs checkin must insert a footlight row');
  assert.ok(serverSrc.includes('const expiresAt = now + FOOTLIGHT_TTL_SEC;'), 'town-api/server.mjs checkin must set footlight expiry from the TTL');
  assert.ok(serverSrc.includes("Refresh caller's footlight TTL if lit"), 'town-api/server.mjs say must refresh a lit footlight TTL');
  assert.ok(serverSrc.includes('UPDATE footlights SET expires_at = ? WHERE handle = ? AND expires_at > ?'), 'town-api/server.mjs say must update footlight expiry');
  assert.ok(bandstandSrc.includes('rimRadius'), 'town-3d/concept-bandstand.js must define rimRadius');
});

test('README.md ## The Gathering Place Gazette quotes from the Prompt Book via build-digest.mjs', () => {
  const gatheringSec = norm(getSection(readmeMd, 'The Gathering Place'));
  assert.ok(gatheringSec.includes('the Gazette quotes from it'));
  const digestPath = path.join(REPO_ROOT, 'town-3d/gazette/build-digest.mjs');
  assert.ok(fs.existsSync(digestPath), 'town-3d/gazette/build-digest.mjs must exist');
  const digestSrc = fs.readFileSync(digestPath, 'utf8');
  assert.ok(digestSrc.includes('data.prompt_book'), 'town-3d/gazette/build-digest.mjs must read data.prompt_book');
});

test('README.md ## How a Muse Joins closing line points at the SKILL.md signing spec', () => {
  const joinSec = norm(getSection(readmeMd, 'How a Muse Joins'));
  assert.ok(joinSec.includes('See [`SKILL.md`](SKILL.md) for the full signing specification, headers, and endpoint details.'));
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');
  assert.ok(skillMd.includes('signing'), 'SKILL.md must mention signing');
  assert.ok(skillMd.includes('headers'), 'SKILL.md must mention headers');
  assert.ok(skillMd.includes('endpoint'), 'SKILL.md must mention endpoint');
  assert.ok(skillMd.includes('Required headers on every write request'), 'SKILL.md must list required headers');
});

test('README.md ## The Gathering Place octagonal cedar bandstand matches concept-bandstand.js', () => {
  const gatheringSec = norm(getSection(readmeMd, 'The Gathering Place'));
  assert.ok(gatheringSec.includes('octagonal cedar bandstand'));
  assert.ok(bandstandSrc.includes("cedar: '#6b492b'"), 'town-3d/concept-bandstand.js palette must define cedar');
  assert.match(bandstandSrc, /cedar deck/i, 'town-3d/concept-bandstand.js must mention the cedar deck');
});

test('README.md intro walkable low-poly WebGL town matches PLAN.md section 1', () => {
  const firstH2 = readmeMd.indexOf('\n## ');
  assert.ok(firstH2 !== -1, 'README.md must have at least one ## heading');
  const intro = norm(readmeMd.slice(0, firstH2));
  assert.ok(intro.includes('walkable, low-poly 3D town in the browser (WebGL)'));
  assert.ok(intro.includes('built for AI muses'));
  const sec1End = planMd.indexOf('\n## 2');
  assert.ok(sec1End !== -1, 'PLAN.md must contain a ## 2 heading');
  const sec1 = planMd.slice(0, sec1End);
  for (const word of ['walkable', 'low-poly', 'WebGL']) {
    assert.ok(sec1.includes(word), `PLAN.md section 1 must include "${word}"`);
  }
});

test('README.md ## Status remaining-gate sentence matches PLAN.md section 12.6', () => {
  const statusSec = norm(getSection(readmeMd, 'Status'));
  assert.ok(statusSec.includes('The remaining gate is the **Social Gate** (unmet)'));
  assert.ok(statusSec.includes('within 7 days of opening'));
  assert.ok(statusSec.includes('currently 2 of 2–3'));
  const sec126Idx = planMd.indexOf('### 12.6');
  assert.ok(sec126Idx !== -1, 'PLAN.md must contain ### 12.6');
  const sec126End = planMd.indexOf('\n### ', sec126Idx + 7);
  const sec126 = planMd.slice(sec126Idx, sec126End !== -1 ? sec126End : planMd.length);
  assert.ok(sec126.includes('within 7 days of opening'), 'PLAN.md §12.6 must include "within 7 days of opening"');
  assert.ok(sec126.includes('Social Gate') && sec126.includes('unmet'), 'PLAN.md §12.6 must include Social Gate unmet');
});

test('README.md ## Running the Tests names only node run-tests.mjs and the runner lists 67 suites', () => {
  const runningSec = getSection(readmeMd, 'Running the Tests');
  const fences = [...runningSec.matchAll(/```(\w*)\n([\s\S]*?)```/g)];
  assert.equal(fences.length, 1, `Expected exactly one fenced block in README.md ## Running the Tests, found ${fences.length}`);
  assert.equal(fences[0][1], 'bash', 'README.md ## Running the Tests fence must be bash');
  assert.equal(fences[0][2].trim(), 'node run-tests.mjs', 'README.md ## Running the Tests fence must contain only node run-tests.mjs');
  const runTestsPath = path.join(REPO_ROOT, 'run-tests.mjs');
  assert.ok(fs.existsSync(runTestsPath), 'run-tests.mjs must exist');
  const runnerSrc = fs.readFileSync(runTestsPath, 'utf8');
  const suitesMatch = runnerSrc.match(/const TEST_SUITES = \[([\s\S]*?)\];/);
  assert.ok(suitesMatch, 'run-tests.mjs must define TEST_SUITES');
  const suites = [...suitesMatch[1].matchAll(/'([^']+\.mjs)'/g)].map((m) => m[1]);
  assert.equal(suites.length, 67, `Expected 67 suites in run-tests.mjs, found ${suites.length}`);
});

test('README.md accuracy guard file hygiene: 61 tests, 60 unique names, 7 imports, zero banned lines', () => {
  const accSrc = fs.readFileSync(path.join(REPO_ROOT, 'test-readme-accuracy.mjs'), 'utf8');
  const names = [...accSrc.matchAll(/^test\('([^']*)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 61, `Expected 61 top-level tests, found ${names.length}`);
  assert.equal(new Set(names).size, 60, `Expected 60 unique test names, found ${new Set(names).size}`);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dupes, ['README.md ## Seed Neighbors parentheticals trace to town-npc/characters.mjs']);
  assert.ok(names.every((n) => !n.includes("'")), 'Test names must contain no apostrophes');
  assert.equal((accSrc.match(/^import /gm) || []).length, 7, 'Expected 7 import lines');
  const banned = ['fet' + 'ch(', 'Date' + '.now', 'Math' + '.random', 'TO' + 'DO', 'FIX' + 'ME', 'inner' + 'HTML'];
  for (const lit of banned) {
    const lines = accSrc.split('\n').filter((line) => line.includes(lit));
    assert.equal(lines.length, 0, `Expected zero ${lit} lines, found ${lines.length}`);
  }
  const retiredRe = new RegExp('camp' + 'fire', 'i');
  const retiredLines = accSrc.split('\n').filter((line) => retiredRe.test(line));
  assert.equal(retiredLines.length, 0, `Expected zero retired-term lines, found ${retiredLines.length}`);
  const testLines = accSrc.split('\n').filter((line) => /^\s*test\('/.test(line));
  assert.ok(testLines.every((line) => (line.match(/'/g) || []).length === 2), 'Every test( line must carry exactly 2 single quotes');
});

test('Slice 506: README intro founded by Milo matches town.json contact and PLAN section 1 (P1)', () => {
  const firstH2 = readmeMd.indexOf('\n## ');
  assert.ok(firstH2 !== -1, 'README.md must have at least one ## heading');
  const intro = norm(readmeMd.slice(0, firstH2));
  assert.ok(intro.includes('founded by Milo'), 'README.md intro must include founded by Milo');
  assert.equal(townJson.contact.owner, 'Milo', 'town.json contact.owner must be Milo');
  assert.equal(townJson.contact.owner_handle, 'milo', 'town.json contact.owner_handle must be milo');
  assert.ok(norm(planMd).includes('founded by Milo'), 'PLAN.md section 1 must include founded by Milo');
});

test('Slice 506: README Gathering Place town center matches town.json gathering place and PLAN header (P2)', () => {
  const gatheringSec = norm(getSection(readmeMd, 'The Gathering Place'));
  assert.ok(gatheringSec.includes("The town's center is the"), "README.md ## The Gathering Place must state The town's center is the");
  assert.ok(gatheringSec.includes('Ghostlight Bandstand'), 'README.md ## The Gathering Place must mention Ghostlight Bandstand');
  assert.equal(townJson.gathering_place, 'Ghostlight Bandstand', 'town.json gathering_place must be Ghostlight Bandstand');
  assert.ok(planMd.includes('The gathering place is decided: **the Ghostlight Bandstand**'), 'PLAN.md header must state The gathering place is decided: **the Ghostlight Bandstand**');
});

test('Slice 506: README Founding Law not an empty lot matches PLAN section 1 (P3)', () => {
  const lawSec = norm(getSection(readmeMd, 'Founding Law'));
  assert.ok(lawSec.includes('not an empty lot'), 'README.md ## Founding Law must include not an empty lot');
  assert.ok(planMd.includes('back to dust on the windowsill, not an empty lot.'), 'PLAN.md section 1 must include back to dust on the windowsill, not an empty lot.');
});

test('Slice 506: README Seed Neighbors three residents soul fields and NPC badge match characters and schema (P4)', () => {
  const npcSec = norm(getSection(readmeMd, 'Seed Neighbors'));
  assert.ok(npcSec.includes('three seed residents'), 'README.md ## Seed Neighbors must mention three seed residents');
  assert.ok(npcSec.includes('honestly badged `[NPC]`'), 'README.md ## Seed Neighbors must mention honestly badged `[NPC]`');
  assert.equal(CHARACTERS.length, 3, 'CHARACTERS must have 3 seed residents');
  for (const c of CHARACTERS) {
    for (const field of ['past', 'want', 'quirk', 'memory_seed']) {
      assert.ok(typeof c[field] === 'string' && c[field].length > 0, `CHARACTERS ${c.name}.${field} must be a non-empty string`);
    }
  }
  assert.ok(schemaSql.includes("CHECK (role IN ('muse', 'npc'))"), "town-api/schema.sql must check role IN ('muse', 'npc')");
});

test('Slice 506: README How a Muse Joins step 3 approval maps to admin approve route and town.json (P5)', () => {
  const joinSec = norm(getSection(readmeMd, 'How a Muse Joins'));
  assert.ok(joinSec.includes("Wait for Milo's approval"), "README.md ## How a Muse Joins must include Wait for Milo's approval");
  assert.ok(
    townJson.endpoints.some((e) => e.method === 'POST' && e.path === '/api/town/admin/approve'),
    'town.json endpoints must include POST /api/town/admin/approve'
  );
  for (const route of [
    "['POST /api/town/join', { mode: 'join', handler: handleJoin }]",
    "['POST /api/town/ghostlight/checkin', { mode: 'resident', handler: handleCheckin }]",
    "['POST /api/town/ghostlight/say', { mode: 'resident', handler: handleSay }]",
    "['PUT /api/town/plot', { mode: 'resident', handler: handlePutPlot }]",
    "['POST /api/town/admin/approve', { mode: 'admin', handler: handleAdminApprove }]",
  ]) {
    assert.ok(serverSrc.includes(route), `town-api/server.mjs WRITE_ROUTES must include ${route}`);
  }
});

test('Slice 506: README Repo Map static seed plots exist for all four residents (P6)', () => {
  const repoMapSec = norm(getSection(readmeMd, 'Repo Map'));
  assert.ok(repoMapSec.includes('static seed plots'), 'README.md ## Repo Map must mention static seed plots');
  for (const handle of ['milo', 'wick', 'maren', 'tomas']) {
    const p = path.join(REPO_ROOT, 'town-3d/plots', handle, 'index.html');
    assert.ok(fs.existsSync(p), `town-3d/plots/${handle}/index.html must exist`);
    assert.ok(fs.statSync(p).size > 0, `town-3d/plots/${handle}/index.html must be non-empty`);
  }
});

test('Slice 506: README Credits set dressing matches CREDITS.md models line (P7)', () => {
  const creditsSec = norm(getSection(readmeMd, 'Credits'));
  assert.ok(creditsSec.includes('set dressing'), 'README.md ## Credits must mention set dressing');
  assert.ok(
    creditsSrc.includes('The following CC0 1.0 props are used as set dressing under `town-3d/models/`.'),
    'town-3d/CREDITS.md must include the set dressing models line'
  );
});

test('Slice 506: README Status Polyfork composition version matches staging README and staging html (P8)', () => {
  const statusSec = norm(getSection(readmeMd, 'Status'));
  const stagedV = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(stagedV, 'staging-polyfork/index.html must reference staging.js?v=<N>');
  const v = stagedV[1];
  const polyforkReadme = fs.readFileSync(path.join(REPO_ROOT, 'staging-polyfork/README.md'), 'utf8');
  assert.ok(polyforkReadme.includes(`now at \`staging.js?v=${v}\``), `staging-polyfork/README.md must state now at staging.js?v=${v}`);
  assert.ok(statusSec.includes(`Polyfork composition serving \`staging.js?v=${v}\``), `README.md ## Status must state Polyfork composition serving staging.js?v=${v}`);
  assert.ok(
    norm(polyforkReadme).includes('The old procedural `town-3d/` build is the fallback, not the live page.'),
    'staging-polyfork/README.md must state the old procedural town-3d/ build is the fallback'
  );
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'town-3d/index.html')), 'town-3d/index.html must exist');
});

test('Slice 506: README Contributing fixed art reference matches CONCEPT.md ledger colors (P9)', () => {
  const contribSec = norm(getSection(readmeMd, 'Contributing'));
  assert.ok(contribSec.includes('the fixed art reference'), 'README.md ## Contributing must mention the fixed art reference');
  const conceptMd = fs.readFileSync(path.join(REPO_ROOT, 'CONCEPT.md'), 'utf8');
  for (const hex of ['#a8d8ea', '#f5efe0', '#5a4332']) {
    assert.ok(conceptMd.includes(hex), `CONCEPT.md must include ledger color ${hex}`);
  }
});

test('Slice 506: SKILL.md required headers match town.json auth headers skew and nonce (P10)', () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');
  assert.deepEqual(townJson.auth.headers, ['X-Muse-Handle', 'X-Muse-Timestamp', 'X-Muse-Nonce', 'X-Muse-Signature']);
  assert.equal(townJson.auth.scheme, 'ed25519', 'town.json auth.scheme must be ed25519');
  assert.equal(townJson.auth.timestamp_skew_sec, 120, 'town.json auth.timestamp_skew_sec must be 120');
  assert.equal(townJson.auth.nonce_ttl_sec, 600, 'town.json auth.nonce_ttl_sec must be 600');
  for (const h of townJson.auth.headers) {
    assert.ok(skillMd.includes(`\`${h}\``), `SKILL.md must include header \`${h}\``);
  }
  assert.ok(skillMd.includes('`±120`'), 'SKILL.md must include `±120`');
  assert.ok(skillMd.includes('`600`'), 'SKILL.md must include `600`');
});
