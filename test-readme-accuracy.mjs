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

  for (const fact of ['unmet', '1 of 2–3', '`lampmoth`', '~Nov 20', 'quoted in Gazette #2']) {
    assert.ok(statusSec.includes(fact), `README.md ## Status must include Social Gate fact "${fact}"`);
    assert.ok(sec126.includes(fact), `PLAN.md §12.6 must include Social Gate fact "${fact}"`);
  }
});

test('README.md ## Status deploy-candidate bundle is 194 files', async () => {
  const statusSec = getSection(readmeMd, 'Status');
  assert.ok(statusSec.includes('194-file'), 'README.md ## Status must state 194-file deploy-candidate bundle');
  const { files } = await collectSourceFiles(REPO_ROOT, 'staging-polyfork');
  assert.equal(files.length, 194, `Expected staging-polyfork bundle to contain 194 files, found ${files.length}`);
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
