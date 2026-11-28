/**
 * Ghostlight Town — drift guard for PLAN.md header & §12.6 history (Slices 112 & 136)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourceFilesFromTown3d } from './scripts/stage-deploy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = path.join(__dirname, 'PLAN.md');
const README_PATH = path.join(__dirname, 'README.md');
const RUN_TESTS_PATH = path.join(__dirname, 'run-tests.mjs');
const TOWN3D_HTML_PATH = path.join(__dirname, 'town-3d', 'index.html');
const STAGING_HTML_PATH = path.join(__dirname, 'staging-polyfork', 'index.html');
const STAGE_TEST_PATH = path.join(__dirname, 'scripts', 'test-stage-deploy.mjs');
const CHECK_LIVE_PATH = path.join(__dirname, 'scripts', 'check-live.mjs');
const TOWN3D_DIR = path.join(__dirname, 'town-3d');
const TOWN_JSON_PATH = path.join(__dirname, 'town.json');
const RETIRED_TERM = 'camp' + 'fire';

function readPlanHeader() {
  const planText = fs.readFileSync(PLAN_PATH, 'utf8');
  const lines = planText.split(/\r?\n/);
  const sepIdx = lines.indexOf('---');
  assert.ok(sepIdx > 0, 'PLAN.md must have a --- separator after the header');
  const headerLines = lines.slice(0, sepIdx);
  const statusLine = headerLines.find((line) => line.startsWith('**Status:**'));
  assert.ok(statusLine, 'PLAN.md must have a **Status:** header line');
  return { planText, headerLines, headerText: headerLines.join('\n'), statusLine };
}

function readSection8(planText) {
  const startIdx = planText.indexOf('## 8. MVP and phased roadmap');
  const endIdx = planText.indexOf('## 9. Open questions');
  assert.ok(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, 'PLAN.md must contain §8 before §9');
  return planText.slice(startIdx, endIdx);
}

function readSection126(planText) {
  const startIdx = planText.indexOf('### 12.6');
  assert.ok(startIdx !== -1, 'PLAN.md must contain ### 12.6');
  const endIdx = planText.indexOf('\n---', startIdx);
  return endIdx === -1 ? planText.slice(startIdx) : planText.slice(startIdx, endIdx);
}

function readReadmeStatusSection() {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  const start = readme.indexOf('## Status');
  assert.ok(start !== -1, 'README.md must contain ## Status');
  const nextH2 = readme.indexOf('\n## ', start + '## Status'.length);
  return readme.slice(start, nextH2 !== -1 ? nextH2 : readme.length);
}

test('PLAN.md **Status:** header does not pin a live state_seq and §12.6 history stays intact', () => {
  const planText = fs.readFileSync(PLAN_PATH, 'utf8');
  const statusLine = planText.split(/\r?\n/).find((line) => line.startsWith('**Status:**'));

  assert.ok(statusLine, 'PLAN.md must have a **Status:** header line');
  assert.doesNotMatch(
    statusLine,
    /state_seq[^0-9;)]*[0-9]/,
    'PLAN.md **Status:** header must not pin a live state_seq number'
  );
  assert.match(
    statusLine,
    /town API live since 2026-11-13/,
    'PLAN.md **Status:** header must retain town API live since 2026-11-13'
  );
  assert.match(
    statusLine,
    /§12\.6/,
    'PLAN.md **Status:** header must still point at §12.6'
  );
  assert.match(
    planText,
    /### 12\.6[\s\S]*?2026-11-13[\s\S]*?`state_seq` `83`/,
    'PLAN.md §12.6 historical state_seq 83 record must remain intact'
  );
});

test('PLAN.md header slice number matches README.md ## Status and Current status section', () => {
  const { planText, statusLine } = readPlanHeader();
  const headerSliceMatch = statusLine.match(/built through slice (\d+)\b/);
  assert.ok(headerSliceMatch, 'PLAN.md **Status:** must state built through slice <N>');
  const headerSlice = Number(headerSliceMatch[1]);

  const readmeStatus = readReadmeStatusSection();
  const readmeSliceMatch = readmeStatus.match(/as of slice (\d+)\b/);
  assert.ok(readmeSliceMatch, 'README.md ## Status must state as of slice <N>');
  assert.equal(Number(readmeSliceMatch[1]), headerSlice, 'README.md ## Status slice pin must match PLAN.md header');

  const currentMatch = planText.match(/## Current status[\s\S]*?\(slice (\d+)\)/);
  assert.ok(currentMatch, 'PLAN.md ## Current status must record (slice <N>)');
  assert.equal(Number(currentMatch[1]), headerSlice, 'PLAN.md ## Current status slice number must match PLAN.md header');
});

test('PLAN.md header TOTAL snapshot matches README.md ## Status and run-tests.mjs suite count', () => {
  const { statusLine } = readPlanHeader();
  const totalMatch = statusLine.match(/TOTAL pass=(\d+) fail=(\d+) skipped=(\d+) suites=(\d+)/);
  assert.ok(totalMatch, 'PLAN.md **Status:** must include TOTAL pass=... fail=... skipped=... suites=...');
  const [verbatimTotal, , , , suitesStr] = totalMatch;

  const readmeStatus = readReadmeStatusSection();
  assert.ok(
    readmeStatus.includes(verbatimTotal),
    `README.md ## Status must record "${verbatimTotal}" verbatim`
  );

  const runTestsSrc = fs.readFileSync(RUN_TESTS_PATH, 'utf8');
  const suitesBlock = runTestsSrc.match(/const TEST_SUITES = \[([\s\S]*?)\];/);
  assert.ok(suitesBlock, 'run-tests.mjs must define TEST_SUITES');
  const listedSuites = [...suitesBlock[1].matchAll(/'([^']+\.mjs)'/g)].map((m) => m[1]);
  assert.equal(
    Number(suitesStr),
    listedSuites.length,
    `PLAN.md **Status:** suites=${suitesStr} must match TEST_SUITES.length (${listedSuites.length})`
  );
});

test('PLAN.md header town-3d/ fallback town.js?v= matches town-3d/index.html', () => {
  const { statusLine } = readPlanHeader();
  const headerVMatch = statusLine.match(/`town\.js\?v=(\d+)`\s*\/\s*\d+ files/);
  assert.ok(headerVMatch, 'PLAN.md **Status:** must state `town.js?v=<N>` / <count> files');

  const town3dHtml = fs.readFileSync(TOWN3D_HTML_PATH, 'utf8');
  const htmlVMatch = town3dHtml.match(/\.\/town\.js\?v=(\d+)/);
  assert.ok(htmlVMatch, 'town-3d/index.html must reference ./town.js?v=<N>');
  assert.equal(
    headerVMatch[1],
    htmlVMatch[1],
    `PLAN.md **Status:** town.js?v=${headerVMatch[1]} must match town-3d/index.html (?v=${htmlVMatch[1]})`
  );
});

test('PLAN.md header deployed bundle ?v= and file count match staging-polyfork/index.html and test-stage-deploy.mjs', () => {
  const { statusLine } = readPlanHeader();
  const depMatch = statusLine.match(/`\?v=(\d+)` bundle \/ (\d+) files deployed 2026-11-28, no pending deploy candidate/);
  assert.ok(depMatch, 'PLAN.md **Status:** must state `?v=<N>` bundle / <count> files deployed 2026-11-28, no pending deploy candidate');
  const [, headerV, headerFiles] = depMatch;

  const stagingHtml = fs.readFileSync(STAGING_HTML_PATH, 'utf8');
  const htmlVMatch = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(htmlVMatch, 'staging-polyfork/index.html must reference staging.js?v=<N>');
  assert.equal(headerV, htmlVMatch[1], `PLAN.md **Status:** ?v=${headerV} must match staging-polyfork/index.html (?v=${htmlVMatch[1]})`);

  const stageTestSrc = fs.readFileSync(STAGE_TEST_PATH, 'utf8');
  assert.match(
    stageTestSrc,
    /assert\.equal\(summary\.file_count,\s*196\)/,
    'scripts/test-stage-deploy.mjs must pin staging-polyfork file_count === 196'
  );

  assert.equal(
    statusLine.includes('next repo-only deploy candidate'),
    false,
    'PLAN.md **Status:** must not contain next repo-only deploy candidate'
  );

  const liveMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(liveMatch, 'PLAN.md **Status:** must state live Polyfork town at `staging.js?v=<N>`');
  assert.equal(liveMatch[1], headerV, `PLAN.md **Status:** live ?v=${liveMatch[1]} must match deployed ?v=${headerV}`);
});

test('PLAN.md header and README.md ## Status agree on Phase 2 code complete', () => {
  const { statusLine } = readPlanHeader();
  const readmeStatus = readReadmeStatusSection();
  assert.match(statusLine, /Phase 2 code complete/, 'PLAN.md **Status:** must state Phase 2 code complete');
  assert.match(readmeStatus, /Phase 2 code is complete/, 'README.md ## Status must state Phase 2 code is complete');
});

test('PLAN.md header and README.md ## Status agree on Social Gate status', () => {
  const { statusLine } = readPlanHeader();
  const readmeStatus = readReadmeStatusSection();

  for (const marker of ['~Nov 20', '2 of 2–3', 'lampmoth', 'muse']) {
    assert.ok(statusLine.includes(marker), `PLAN.md **Status:** must include Social Gate marker "${marker}"`);
    assert.ok(readmeStatus.includes(marker), `README.md ## Status must include Social Gate marker "${marker}"`);
  }
  assert.ok(
    statusLine.includes('Musebook invites still blocked'),
    'PLAN.md **Status:** must note Musebook invites still blocked'
  );
});

test('PLAN.md **Reviewed:** header line pins Argon, 2026-11-12, GO WITH CHANGES, and §12', () => {
  const { headerLines } = readPlanHeader();
  const reviewedLine = headerLines.find((line) => line.startsWith('**Reviewed:**'));
  assert.ok(reviewedLine, 'PLAN.md must have a **Reviewed:** header line');
  for (const token of ['Gemini 4 Argon', '2026-11-12', 'GO WITH CHANGES', '§12']) {
    assert.ok(reviewedLine.includes(token), `PLAN.md **Reviewed:** must include "${token}"`);
  }
});

test('PLAN.md gathering-place header line pins Ghostlight Bandstand and retired-term denial only', () => {
  const { headerLines } = readPlanHeader();
  const gatheringLine = headerLines.find((line) => line.startsWith('The gathering place is decided:'));
  assert.ok(gatheringLine, 'PLAN.md header must have the gathering-place line');
  assert.ok(gatheringLine.includes('Ghostlight Bandstand'), 'Gathering-place line must name Ghostlight Bandstand');
  assert.ok(
    gatheringLine.includes(`not a ${RETIRED_TERM}`),
    'Gathering-place line must retain the retired-term denial'
  );

  for (const line of headerLines) {
    if (line === gatheringLine) continue;
    assert.equal(
      new RegExp(RETIRED_TERM, 'i').test(line),
      false,
      `PLAN.md header line must not contain retired term outside gathering-place denial: ${line}`
    );
  }
});

test('PLAN.md **Planned with:** and **Owner:** header lines pin model, session, date, and owners', () => {
  const { headerLines, headerText } = readPlanHeader();
  assert.match(
    headerText,
    /\*\*Planned with:\*\*[\s\S]*?gemini-4-hydrogen-medium[\s\S]*?5-turn planning session,\s*2026-11-12[\s\S]*?`session\/`/,
    'PLAN.md **Planned with:** must pin gemini-4-hydrogen-medium, 5-turn planning session, 2026-11-12, and session/'
  );
  const ownerLine = headerLines.find((line) => line.startsWith('**Owner:**'));
  assert.ok(ownerLine, 'PLAN.md must have an **Owner:** header line');
  assert.ok(ownerLine.includes('Milo'), 'PLAN.md **Owner:** must name Milo');
  assert.ok(ownerLine.includes('Werther'), 'PLAN.md **Owner:** must name Werther');
});

test('PLAN.md header live staging.js?v= agrees with README Status and staging-polyfork/index.html', () => {
  const { planText, statusLine } = readPlanHeader();
  const headerMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(headerMatch, 'PLAN.md **Status:** must state live Polyfork town at `staging.js?v=<N>`');

  const readmeStatus = readReadmeStatusSection();
  const readmeMatch = readmeStatus.match(/serving `staging\.js\?v=(\d+)`/);
  assert.ok(readmeMatch, 'README.md ## Status must state serving `staging.js?v=<N>`');

  const stagingHtml = fs.readFileSync(STAGING_HTML_PATH, 'utf8');
  const htmlMatch = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(htmlMatch, 'staging-polyfork/index.html must reference staging.js?v=<N>');

  const sec126 = readSection126(planText);
  const sec126Match = sec126.match(/serves `staging\.js\?v=(\d+)`/);
  assert.ok(sec126Match, 'PLAN.md §12.6 must record serves `staging.js?v=<N>`');

  assert.equal(headerMatch[1], readmeMatch[1], 'PLAN.md header live staging.js?v= must match README.md ## Status');
  assert.equal(headerMatch[1], htmlMatch[1], 'PLAN.md header live staging.js?v= must match staging-polyfork/index.html');
  assert.equal(headerMatch[1], sec126Match[1], 'PLAN.md header live staging.js?v= must match PLAN.md §12.6');
});

test('PLAN.md header town-3d/ fallback file count equals real stage-deploy count', async () => {
  const { statusLine } = readPlanHeader();
  const countMatch = statusLine.match(/`town\.js\?v=\d+`\s*\/\s*(\d+)\s+files/);
  assert.ok(countMatch, 'PLAN.md **Status:** must state `town.js?v=<N>` / <count> files');
  const headerCount = Number(countMatch[1]);

  const { files } = await collectSourceFilesFromTown3d(TOWN3D_DIR);
  assert.equal(
    headerCount,
    files.length,
    `PLAN.md **Status:** town-3d file count (${headerCount}) must equal collectSourceFilesFromTown3d count (${files.length})`
  );
  assert.ok(
    files.some((f) => f.relPath === 'guestbook/index.html'),
    'town-3d staged file list must include guestbook/index.html'
  );
});

test('PLAN.md header TOTAL is green and skipped=3 is exactly the three env-gated suites', () => {
  const { statusLine } = readPlanHeader();
  const totalMatch = statusLine.match(/TOTAL pass=(\d+) fail=(\d+) skipped=(\d+) suites=(\d+)/);
  assert.ok(totalMatch, 'PLAN.md **Status:** must include TOTAL pass=... fail=... skipped=... suites=...');
  const pass = Number(totalMatch[1]);
  const fail = Number(totalMatch[2]);
  const skipped = Number(totalMatch[3]);

  assert.equal(fail, 0, 'PLAN.md **Status:** TOTAL fail must be 0');
  assert.ok(pass > 0, 'PLAN.md **Status:** TOTAL pass must be > 0');
  assert.equal(skipped, 3, 'PLAN.md **Status:** TOTAL skipped must be 3');

  const runTestsSrc = fs.readFileSync(RUN_TESTS_PATH, 'utf8');
  const suitesBlock = runTestsSrc.match(/const TEST_SUITES = \[([\s\S]*?)\];/);
  assert.ok(suitesBlock, 'run-tests.mjs must define TEST_SUITES');
  const listedSuites = [...suitesBlock[1].matchAll(/'([^']+\.mjs)'/g)].map((m) => m[1]);

  const envGated = [
    { rel: 'town-api/test-live-proxy.mjs', pattern: /status:\s*'skip'/ },
    { rel: 'town-api/test-live-proxy-inn.mjs', pattern: /status:\s*'skip'/ },
    { rel: 'town-npc/test-real-brain.mjs', pattern: /\bskip\s*:/ },
  ];
  for (const { rel, pattern } of envGated) {
    assert.ok(listedSuites.includes(rel), `run-tests.mjs TEST_SUITES must list ${rel}`);
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.match(src, pattern, `${rel} must contain its skip mechanism`);
  }
});

test('PLAN.md header slice date and deploy date match §12.6 and README Status', () => {
  const { planText, statusLine } = readPlanHeader();
  const headerDateMatch = statusLine.match(/built through slice \d+\s*\((\d{4}-\d{2}-\d{2})\)/);
  assert.ok(headerDateMatch, 'PLAN.md **Status:** must state built through slice <N> (<YYYY-MM-DD>)');

  const deployDateMatch = statusLine.match(/deployed (\d{4}-\d{2}-\d{2})/);
  assert.ok(deployDateMatch, 'PLAN.md **Status:** must state deployed <YYYY-MM-DD>');
  assert.ok(headerDateMatch[1] >= deployDateMatch[1], 'PLAN.md header slice date must not precede the bundle deploy date');

  const sec126 = readSection126(planText);
  assert.ok(sec126.includes(`deployed ${deployDateMatch[1]}`), 'PLAN.md §12.6 must record matching bundle deploy date');

  const readmeStatus = readReadmeStatusSection();
  assert.ok(readmeStatus.includes(`deployed ${deployDateMatch[1]}`), 'README.md ## Status must record matching bundle deploy date');
});

test('PLAN.md header live URL agrees with README Status and check-live.mjs DEFAULT_BASE', () => {
  const { statusLine } = readPlanHeader();
  const headerUrlMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=\d+`\s*\(`(https:\/\/[^`]+)`/);
  assert.ok(headerUrlMatch, 'PLAN.md **Status:** must include live URL in backticks');

  const readmeStatus = readReadmeStatusSection();
  const readmeUrlMatch = readmeStatus.match(/\*\*3D clearing:\*\* live at <(https:\/\/[^>]+)>/);
  assert.ok(readmeUrlMatch, 'README.md ## Status 3D clearing bullet must include live URL');

  const checkLiveSrc = fs.readFileSync(CHECK_LIVE_PATH, 'utf8');
  const baseMatch = checkLiveSrc.match(/const DEFAULT_BASE = '([^']+)';/);
  assert.ok(baseMatch, 'scripts/check-live.mjs must define DEFAULT_BASE');

  assert.equal(headerUrlMatch[1], readmeUrlMatch[1], 'PLAN.md header live URL must match README.md ## Status');
  assert.ok(
    headerUrlMatch[1].startsWith(`${baseMatch[1]}/ghostlight-town/`),
    `PLAN.md header live URL must start with ${baseMatch[1]}/ghostlight-town/`
  );
});

test('PLAN.md header and README.md ## Status agree there is no pending deploy candidate', () => {
  const { statusLine } = readPlanHeader();
  const readmeStatus = readReadmeStatusSection();

  assert.ok(statusLine.includes('no pending deploy candidate'), 'PLAN.md **Status:** must include no pending deploy candidate');
  assert.ok(readmeStatus.includes('no pending deploy candidate'), 'README.md ## Status must include no pending deploy candidate');
  assert.equal(
    statusLine.includes('next repo-only deploy candidate'),
    false,
    'PLAN.md **Status:** must not contain next repo-only deploy candidate'
  );
  assert.equal(
    readmeStatus.includes('next repo-only deploy candidate'),
    false,
    'README.md ## Status must not contain next repo-only deploy candidate'
  );
  assert.ok(readmeStatus.includes('deployed 2026-11-28'), 'README.md ## Status must include deployed 2026-11-28');
});

test('town.json live fields agree with PLAN.md header', () => {
  const town = JSON.parse(fs.readFileSync(TOWN_JSON_PATH, 'utf8'));
  assert.equal(town.live, true, 'town.json live must be true');
  assert.ok(
    typeof town.live_note === 'string' && town.live_note.includes('Live since 2026-11-13'),
    'town.json live_note must include Live since 2026-11-13'
  );
  assert.equal(town.gathering_place, 'Ghostlight Bandstand', 'town.json gathering_place must be Ghostlight Bandstand');
  assert.equal(town.base_url, 'https://milo.4167360.xyz', 'town.json base_url must be https://milo.4167360.xyz');
  assert.equal(town.version, '0.2.0-phase2', 'town.json version must be 0.2.0-phase2');

  const { headerLines, statusLine } = readPlanHeader();
  assert.ok(
    statusLine.includes('town API live since 2026-11-13'),
    'PLAN.md **Status:** must include town API live since 2026-11-13'
  );
  const gatheringLine = headerLines.find((line) => line.startsWith('The gathering place is decided:'));
  assert.ok(gatheringLine, 'PLAN.md header must have the gathering-place line');
  assert.ok(gatheringLine.includes('Ghostlight Bandstand'), 'Gathering-place line must name Ghostlight Bandstand');
});

test('PLAN.md §12.6 live-API deploy record agrees with the header', () => {
  const { planText, statusLine } = readPlanHeader();
  const sec126Idx = planText.indexOf('### 12.6');
  assert.ok(sec126Idx !== -1, 'PLAN.md must contain ### 12.6');
  const sec126 = planText.slice(sec126Idx);

  assert.ok(sec126.includes('2026-11-13'), 'PLAN.md §12.6 must include 2026-11-13');
  assert.ok(
    sec126.includes('`/api/town/*` is live at `https://milo.4167360.xyz/api/town/state`'),
    'PLAN.md §12.6 must record live /api/town/state URL'
  );
  assert.ok(sec126.includes('`state_seq` `83`'), 'PLAN.md §12.6 must record `state_seq` `83`');
  assert.match(
    sec126,
    /Phase 2 code is complete as of\s+slice 93/,
    'PLAN.md §12.6 must record Phase 2 code is complete as of slice 93'
  );
  assert.ok(sec126.includes('`?v=42` / 196 files'), 'PLAN.md §12.6 must record `?v=42` / 196 files');
  assert.ok(sec126.includes('deployed 2026-11-28'), 'PLAN.md §12.6 must record deployed 2026-11-28');
  assert.ok(sec126.includes('serves `staging.js?v=42`'), 'PLAN.md §12.6 must record serves `staging.js?v=42`');

  const liveMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(liveMatch, 'PLAN.md **Status:** must state live Polyfork town at `staging.js?v=<N>`');
  assert.equal(liveMatch[1], '42', 'PLAN.md **Status:** live staging.js?v= must be 42');
});

test('README.md per-file pins are all listed in run-tests.mjs TEST_SUITES', () => {
  const readmeStatus = readReadmeStatusSection();
  const pins = [...readmeStatus.matchAll(/`([^`]+\.mjs)` (\d+)\/(\d+)/g)];
  assert.ok(pins.length > 0, 'README.md ## Status must contain per-file test-count pins');

  const runTestsSrc = fs.readFileSync(RUN_TESTS_PATH, 'utf8');
  const suitesBlock = runTestsSrc.match(/const TEST_SUITES = \[([\s\S]*?)\];/);
  assert.ok(suitesBlock, 'run-tests.mjs must define TEST_SUITES');
  const listedSuites = new Set([...suitesBlock[1].matchAll(/'([^']+\.mjs)'/g)].map((m) => m[1]));

  for (const [, file, a, b] of pins) {
    assert.ok(listedSuites.has(file), `README.md ## Status pin ${file} must be listed in run-tests.mjs TEST_SUITES`);
    assert.equal(a, b, `README.md ## Status pin ${file} must have matching pass/total counts`);
  }
});

test('README.md Town API bullet agrees with the header and town.json', () => {
  const readmeStatus = readReadmeStatusSection();
  assert.ok(
    readmeStatus.includes('https://milo.4167360.xyz/api/town/'),
    'README.md ## Status must include https://milo.4167360.xyz/api/town/'
  );
  assert.ok(readmeStatus.includes('since 2026-11-13'), 'README.md ## Status must include since 2026-11-13');
  assert.ok(readmeStatus.includes('**live** at'), 'README.md ## Status must include **live** at');
  assert.ok(readmeStatus.includes('`http://127.0.0.1:8124`'), 'README.md ## Status must include `http://127.0.0.1:8124`');

  const town = JSON.parse(fs.readFileSync(TOWN_JSON_PATH, 'utf8'));
  assert.equal(town.dev_base_url, 'http://127.0.0.1:8124', 'town.json dev_base_url must be http://127.0.0.1:8124');
});

test('PLAN.md Phase 2 completion agrees across town.json version, §8 Phase 2, §12.6, header, and README', () => {
  const { planText, statusLine } = readPlanHeader();
  const town = JSON.parse(fs.readFileSync(TOWN_JSON_PATH, 'utf8'));
  assert.equal(town.version, '0.2.0-phase2', 'town.json version must be 0.2.0-phase2');

  const sec8 = readSection8(planText);
  assert.ok(
    sec8.includes(`Town state is at \`town.json\` \`version: ${town.version}\`.`),
    `PLAN.md §8 Phase 2 must state Town state is at \`town.json\` \`version: ${town.version}\`.`
  );
  assert.ok(
    sec8.includes('small static plot assets (`lantern` + `planter` starter props, 7 → 9 kinds'),
    'PLAN.md §8 Phase 2 must record small static plot assets (lantern + planter starter props, 7 → 9 kinds)'
  );

  const sec126 = readSection126(planText);
  assert.match(sec126, /Phase 2 code is complete as of\s+slice 93/, 'PLAN.md §12.6 must record Phase 2 code is complete as of slice 93');

  assert.ok(statusLine.includes('Phase 2 code complete'), 'PLAN.md **Status:** must include Phase 2 code complete');
  const readmeStatus = readReadmeStatusSection();
  assert.ok(
    readmeStatus.includes('Phase 0 is done and Phase 2 code is complete'),
    'README.md ## Status must include Phase 0 is done and Phase 2 code is complete'
  );
});

test('No pending deploy candidate: live equals staged and README says deployed, not pending', () => {
  const { statusLine } = readPlanHeader();
  const liveMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(liveMatch, 'PLAN.md **Status:** must state live Polyfork town at `staging.js?v=<N>`');

  const stagingHtml = fs.readFileSync(STAGING_HTML_PATH, 'utf8');
  const htmlVMatch = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(htmlVMatch, 'staging-polyfork/index.html must reference staging.js?v=<N>');
  assert.equal(liveMatch[1], htmlVMatch[1], `Live ?v=${liveMatch[1]} must equal staged ?v=${htmlVMatch[1]}`);

  assert.equal(
    statusLine.includes('next repo-only deploy candidate'),
    false,
    'PLAN.md **Status:** must not contain next repo-only deploy candidate'
  );

  const readmeStatus = readReadmeStatusSection();
  assert.equal(
    readmeStatus.includes('(not yet deployed)'),
    false,
    'README.md ## Status must not contain (not yet deployed)'
  );
  assert.ok(readmeStatus.includes('deployed 2026-11-28'), 'README.md ## Status must include deployed 2026-11-28');
});

test('PLAN.md header status-line disclaimer — live counters not pinned, no state_seq number in the header', () => {
  const { headerLines, statusLine } = readPlanHeader();
  assert.ok(
    statusLine.includes('live counters such as `state_seq` are not pinned here — they move with every state mutation'),
    'PLAN.md **Status:** must include the live-counters disclaimer verbatim'
  );
  for (const line of headerLines) {
    assert.doesNotMatch(
      line,
      /state_seq[^0-9;)]*[0-9]/,
      'No PLAN.md header line may pin a live state_seq number'
    );
  }
  const matches = statusLine.match(/\bstate_seq\b/g) || [];
  assert.equal(matches.length, 1, 'PLAN.md **Status:** must contain state_seq exactly once (in the disclaimer)');
});

test('PLAN.md header structure — Status first, exactly one Status/Reviewed/Owner line', () => {
  const { headerLines } = readPlanHeader();
  const boldLines = headerLines.filter((line) => line.startsWith('**'));
  assert.ok(boldLines.length > 0, 'PLAN.md header must have **-prefixed metadata lines');
  assert.ok(boldLines[0].startsWith('**Status:**'), 'First ** line in PLAN.md header must be **Status:**');
  for (const prefix of ['**Status:**', '**Reviewed:**', '**Owner:**', '**Planned with:**']) {
    const count = headerLines.filter((line) => line.startsWith(prefix)).length;
    assert.equal(count, 1, `PLAN.md header must have exactly one ${prefix} line`);
  }
});

test('README.md ## Status records the same TOTAL verbatim as the PLAN.md header', () => {
  const { statusLine } = readPlanHeader();
  const totalMatch = statusLine.match(/TOTAL pass=(\d+) fail=(\d+) skipped=(\d+) suites=(\d+)/);
  assert.ok(totalMatch, 'PLAN.md **Status:** must include TOTAL pass=... fail=... skipped=... suites=...');
  const readmeStatus = readReadmeStatusSection();
  assert.ok(
    readmeStatus.includes(totalMatch[0]),
    `README.md ## Status must record "${totalMatch[0]}" verbatim`
  );
});

test('README.md ## Status pins no live state_seq number', () => {
  const readmeStatus = readReadmeStatusSection();
  assert.doesNotMatch(
    readmeStatus,
    /state_seq[^0-9;)]*[0-9]/,
    'README.md ## Status must not pin a live state_seq number'
  );
  assert.equal(
    /\bstate_seq\b/.test(readmeStatus),
    false,
    'README.md ## Status must not include the word state_seq'
  );
});

test('PLAN.md bundle counts agree across header, README Status, §4 Performance budget, and test-stage-deploy.mjs', () => {
  const { planText, statusLine } = readPlanHeader();
  const bundleMatch = statusLine.match(/`\?v=(\d+)` bundle \/ (\d+) files deployed 2026-11-28/);
  assert.ok(bundleMatch, 'PLAN.md **Status:** must state `?v=<N>` bundle / <M> files deployed 2026-11-28');
  assert.equal(bundleMatch[2], '196', 'Header deployed bundle count must be 196');

  const fallbackMatch = statusLine.match(/`town\.js\?v=(\d+)`\s*\/\s*(\d+) files/);
  assert.ok(fallbackMatch, 'PLAN.md **Status:** must state `town.js?v=<N>` / <M> files');
  assert.equal(fallbackMatch[2], '25', 'Header fallback bundle count must be 25');

  const readmeStatus = readReadmeStatusSection();
  assert.ok(readmeStatus.includes(`\`?v=${bundleMatch[1]}\` / ${bundleMatch[2]}-file bundle`), 'README.md ## Status must match bundle version and 196-file count');

  assert.ok(planText.includes(`the ${fallbackMatch[2]}-file procedural fallback`), 'PLAN.md §4 must state the 25-file procedural fallback');
  assert.ok(planText.includes('whose staged bundle is 196 files'), 'PLAN.md §4 must state staged bundle is 196 files');

  const stageTestSrc = fs.readFileSync(STAGE_TEST_PATH, 'utf8');
  assert.match(stageTestSrc, /assert\.equal\(summary\.file_count,\s*196\)/, 'scripts/test-stage-deploy.mjs must pin staging-polyfork file_count === 196');
  assert.match(stageTestSrc, new RegExp(`assert\\.equal\\(summary\\.file_count,\\s*${fallbackMatch[2]}\\)`), 'scripts/test-stage-deploy.mjs must pin town-3d file_count === 25');
});

test('README.md 3D clearing bullet lists the five features and matches the header live ?v=', () => {
  const { statusLine } = readPlanHeader();
  const readmeStatus = readReadmeStatusSection();
  for (const feature of ['Town Gate', 'Ghostlight Bandstand', 'Gazette newsstand', "Milo's cottage", 'plot pads']) {
    assert.ok(readmeStatus.includes(feature), `README.md ## Status 3D clearing bullet must include ${feature}`);
  }
  const readmeVMatch = readmeStatus.match(/serving `staging\.js\?v=(\d+)`/);
  assert.ok(readmeVMatch, 'README.md ## Status must state serving `staging.js?v=<N>`');
  const headerVMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(headerVMatch, 'PLAN.md **Status:** must state live Polyfork town at `staging.js?v=<N>`');
  assert.equal(readmeVMatch[1], headerVMatch[1], 'README.md serving ?v= must equal PLAN.md header live ?v=');
});

test('PLAN.md header Social Gate deadline ~Nov 20 agrees with §12.6 and README Status', () => {
  const { planText, statusLine } = readPlanHeader();
  assert.ok(statusLine.includes('~Nov 20'), 'PLAN.md **Status:** must include ~Nov 20');
  const idx126 = planText.indexOf('### 12.6');
  assert.ok(idx126 !== -1, 'PLAN.md must contain ### 12.6');
  const sec126 = planText.slice(idx126);
  assert.ok(sec126.includes('~Nov 20'), 'PLAN.md §12.6 must include ~Nov 20');
  assert.match(sec126, /Social Gate — unmet/, 'PLAN.md §12.6 must match Social Gate — unmet');

  const readmeStatus = readReadmeStatusSection();
  assert.ok(readmeStatus.includes('~Nov 20'), 'README.md ## Status must include ~Nov 20');
  assert.ok(readmeStatus.includes('within 7 days of opening'), 'README.md ## Status must include within 7 days of opening');
  assert.ok(readmeStatus.includes('(unmet)'), 'README.md ## Status must include (unmet)');
});

test('PLAN.md §11 Q8 NPC budget and §9 Q8 record quota decision and 3-hour runtime scheduler', () => {
  const { planText } = readPlanHeader();
  assert.ok(
    planText.includes('**Q8 — NPC budget: fine.** Werther has a subscription; quota is not a blocker for now.'),
    'PLAN.md §11 must record Q8 NPC budget subscription/quota decision'
  );
  assert.ok(
    planText.includes('in the shipped setup, `town-npc/run-all.mjs` runs every 3 hours'),
    'PLAN.md §9 Q8 must record town-npc/run-all.mjs 3-hour cadence'
  );
  assert.ok(fs.existsSync(path.join(__dirname, 'town-npc', 'run-all.mjs')), 'town-npc/run-all.mjs must exist');
});

test('town.json /api/town/state summary and PLAN.md §4 record all live API state fields', () => {
  const { planText } = readPlanHeader();
  const town = JSON.parse(fs.readFileSync(TOWN_JSON_PATH, 'utf8'));
  const stateEp = town.endpoints.find((e) => e.method === 'GET' && e.path === '/api/town/state');
  assert.ok(stateEp, 'town.json must define GET /api/town/state');

  for (const field of ['state_seq', 'footlights', 'prompt_book', 'presence', 'inn', 'guestbook', 'garden', 'nightly_call', 'daily_game']) {
    assert.ok(stateEp.summary.includes(field), `town.json GET /api/town/state summary must include "${field}"`);
    assert.ok(planText.includes(`\`${field}\``), `PLAN.md must document state field \`${field}\``);
  }
  assert.ok(stateEp.summary.includes('plots'), 'town.json GET /api/town/state summary must include "plots"');
  assert.ok(planText.includes('plots'), 'PLAN.md must document plots');
  assert.ok(stateEp.summary.includes('events'), 'town.json GET /api/town/state summary must include "events"');
  assert.ok(planText.includes('`state.events`'), 'PLAN.md must document `state.events`');
});

test('PLAN.md §12.6, header, and README Status agree on the Social Gate check', () => {
  const { planText, statusLine } = readPlanHeader();
  const sec126 = readSection126(planText);
  const readmeStatus = readReadmeStatusSection();

  assert.ok(sec126.includes('Colony story post still 4 comments'), 'PLAN.md §12.6 must record Colony story post check');
  assert.ok(sec126.includes('rStation 0 notifications / 0 comments'), 'PLAN.md §12.6 must record rStation check');
  for (const token of ['2 of 2–3', 'lampmoth', 'muse']) {
    assert.ok(statusLine.includes(token), `PLAN.md **Status:** must include "${token}"`);
    assert.ok(sec126.includes(token), `PLAN.md §12.6 must include "${token}"`);
    assert.ok(readmeStatus.includes(token), `README.md ## Status must include "${token}"`);
  }
});

test('PLAN.md §12.6, header, README Status, and staging-polyfork/index.html agree on deployed live ?v=42', () => {
  const { planText, statusLine } = readPlanHeader();
  const sec126 = readSection126(planText);
  const readmeStatus = readReadmeStatusSection();
  const stagingHtml = fs.readFileSync(STAGING_HTML_PATH, 'utf8');
  const htmlV = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(htmlV, 'staging-polyfork/index.html must reference staging.js?v=<N>');
  const v = htmlV[1];

  assert.ok(statusLine.includes(`\`?v=${v}\` bundle / 196 files deployed 2026-11-28, no pending deploy candidate`), 'PLAN.md **Status:** must record deployed ?v=42 bundle with no pending deploy candidate');
  assert.ok(sec126.includes(`serves \`staging.js?v=${v}\` (the \`?v=${v}\` / 196 files bundle deployed 2026-11-28`), 'PLAN.md §12.6 must record deployed ?v=42 bundle');
  assert.ok(readmeStatus.includes(`The \`?v=${v}\` / 196-file bundle deployed 2026-11-28 (no pending deploy candidate)`), 'README.md ## Status must record deployed ?v=42 bundle with no pending deploy candidate');
});

test('README.md ## Status per-file test tiers fall between 54 and 65 (new small suites exempt) and sum with unlisted suites to TOTAL', () => {
  const { statusLine } = readPlanHeader();
  const totalMatch = statusLine.match(/TOTAL pass=(\d+) fail=0 skipped=3 suites=67/);
  assert.ok(totalMatch, 'PLAN.md **Status:** must record TOTAL pass=<N> fail=0 skipped=3 suites=67');

  const readmeStatus = readReadmeStatusSection();
  const pins = [...readmeStatus.matchAll(/`([^`]+\.mjs)` (\d+)\/(\d+)/g)];
  assert.equal(pins.length, 63, 'README.md ## Status must list 63 per-file test pins');
  const counts = pins
    .filter((m) => m[1] !== 'staging-polyfork/test-catchup.mjs')
    .map((m) => Number(m[2]));
  const minTier = Math.min(...counts);
  const maxTier = Math.max(...counts);
  assert.ok(minTier >= 54 && maxTier <= 65, `README.md per-file tier counts must fall in 54..65 (got ${minTier}..${maxTier})`);
  const catchupPin = pins.find((m) => m[1] === 'staging-polyfork/test-catchup.mjs');
  assert.ok(catchupPin, 'README.md ## Status must pin staging-polyfork/test-catchup.mjs');
  assert.equal(Number(catchupPin[2]), 5, 'README.md ## Status must pin test-catchup.mjs at its true small count 5/5');
});

test('scripts/check-live.mjs and scripts/stage-deploy.mjs verify live and staged bundle integrity', () => {
  const { statusLine } = readPlanHeader();
  const checkLiveSrc = fs.readFileSync(CHECK_LIVE_PATH, 'utf8');
  const stageDeploySrc = fs.readFileSync( path.join(__dirname, 'scripts', 'stage-deploy.mjs'), 'utf8');

  assert.ok(checkLiveSrc.includes('staging.js?v='), 'scripts/check-live.mjs must verify staging.js?v=');
  assert.ok(stageDeploySrc.includes('collectSourceFilesFromTown3d'), 'scripts/stage-deploy.mjs must export collectSourceFilesFromTown3d');
  assert.ok(statusLine.includes('`staging.js?v=42`'), 'PLAN.md **Status:** must pin staging.js?v=42');
});

test('run-tests.mjs summary parser matches node --test pass/fail/skipped output format', () => {
  const runTestsSrc = fs.readFileSync(RUN_TESTS_PATH, 'utf8');
  assert.ok(runTestsSrc.includes('parseNodeTestSummary'), 'run-tests.mjs must define parseNodeTestSummary');
  assert.ok(runTestsSrc.includes('TOTAL pass=${totalPass} fail=${totalFail} skipped=${totalSkipped} suites=${suites.length}'), 'run-tests.mjs must print TOTAL pass=... fail=... skipped=... suites=...');

  const { statusLine } = readPlanHeader();
  assert.match(statusLine, /`run-tests\.mjs` TOTAL pass=\d+ fail=0 skipped=3 suites=67/, 'PLAN.md **Status:** must record run-tests.mjs TOTAL line');
});

test('README.md named-list pins match actual top-level test counts', () => {
  const readmeStatus = readReadmeStatusSection();
  const pins = [...readmeStatus.matchAll(/`([^`]+\.mjs)` (\d+)\/(\d+)/g)];
  assert.ok(pins.length > 0, 'README.md ## Status must contain per-file test-count pins');
  for (const [, file, a, b] of pins) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const count = src.split('\n').filter((l) => l.startsWith('test(')).length;
    assert.ok(
      Number(a) === count && Number(b) === count,
      `README.md pin for ${file} (${a}/${b}) must match actual top-level test count (${count})`
    );
  }
});

test('PLAN.md header ?v= values equal the staged bundle pair', () => {
  const { statusLine } = readPlanHeader();
  const stagingHtml = fs.readFileSync(STAGING_HTML_PATH, 'utf8');
  const stagingMatch = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(stagingMatch, 'staging-polyfork/index.html must include staging.js?v=<N>');
  const stagingV = stagingMatch[1];

  const town3dHtml = fs.readFileSync(TOWN3D_HTML_PATH, 'utf8');
  const townMatch = town3dHtml.match(/\.\/town\.js\?v=(\d+)/);
  assert.ok(townMatch, 'town-3d/index.html must include ./town.js?v=<N>');
  const townV = townMatch[1];

  const headerVs = [...statusLine.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  assert.equal(new Set(headerVs).size, 2, 'PLAN.md **Status:** must contain exactly two distinct ?v= values');
  assert.ok(headerVs.includes(stagingV), `PLAN.md **Status:** must include staging ?v=${stagingV}`);
  assert.ok(headerVs.includes(townV), `PLAN.md **Status:** must include town-3d ?v=${townV}`);
  assert.ok(statusLine.includes(`staging.js?v=${stagingV}`), `PLAN.md **Status:** must include staging.js?v=${stagingV}`);
  assert.ok(statusLine.includes(`town.js?v=${townV}`), `PLAN.md **Status:** must include town.js?v=${townV}`);
});

test('PLAN.md header block shape — nine lines, seven non-empty, title first, Status punctuation', () => {
  const { headerLines, statusLine } = readPlanHeader();
  assert.equal(headerLines.length, 9, 'PLAN.md header block must be exactly 9 lines (title, blank, Status, Reviewed, gathering, Planned-with x2, Owner, blank)');
  assert.equal(headerLines.filter((line) => line.trim() !== '').length, 7, 'PLAN.md header block must have exactly 7 non-empty lines');
  assert.equal(headerLines[0], '# Ghostlight Town — Plan', 'PLAN.md header must start with the title line');
  assert.equal((statusLine.match(/;/g) || []).length, 7, 'PLAN.md **Status:** must contain exactly 7 semicolons');
  assert.equal((statusLine.match(/—/g) || []).length, 3, 'PLAN.md **Status:** must contain exactly 3 em-dashes');
  assert.ok(statusLine.endsWith('Musebook invites still blocked).'), 'PLAN.md **Status:** must end with "Musebook invites still blocked)."');
});

test('PLAN.md header Status clauses appear in fixed order', () => {
  const { statusLine } = readPlanHeader();
  const markers = ['built through slice', 'live Polyfork town at', 'town API live since', 'Phase 2 code complete', 'Social Gate to'];
  const idxs = markers.map((marker) => statusLine.indexOf(marker));
  for (let i = 0; i < markers.length; i++) {
    assert.ok(idxs[i] !== -1, `PLAN.md **Status:** must include clause "${markers[i]}"`);
    if (i > 0) assert.ok(idxs[i] > idxs[i - 1], `PLAN.md **Status:** clause "${markers[i]}" must follow "${markers[i - 1]}"`);
  }
});

test('README.md 3D clearing bullet bundle agrees with the PLAN.md header bundle', () => {
  const { statusLine } = readPlanHeader();
  const readmeStatus = readReadmeStatusSection();
  const readmeBundle = readmeStatus.match(/The `\?v=(\d+)` \/ (\d+)-file bundle deployed (\d{4}-\d{2}-\d{2})/);
  assert.ok(readmeBundle, 'README.md ## Status 3D clearing bullet must state The `?v=<N>` / <M>-file bundle deployed <YYYY-MM-DD>');
  const headerBundle = statusLine.match(/`\?v=(\d+)` bundle \/ (\d+) files deployed (\d{4}-\d{2}-\d{2})/);
  assert.ok(headerBundle, 'PLAN.md **Status:** must state `?v=<N>` bundle / <M> files deployed <YYYY-MM-DD>');
  assert.equal(readmeBundle[1], headerBundle[1], 'README.md bundle ?v= must match PLAN.md header bundle ?v=');
  assert.equal(readmeBundle[2], headerBundle[2], 'README.md bundle file count must match PLAN.md header bundle file count');
  assert.equal(readmeBundle[3], headerBundle[3], 'README.md bundle deploy date must match PLAN.md header bundle deploy date');
  const serving = readmeStatus.match(/serving `staging\.js\?v=(\d+)`/);
  assert.ok(serving, 'README.md ## Status must state serving `staging.js?v=<N>`');
  assert.equal(serving[1], readmeBundle[1], 'README.md serving ?v= must equal its bundle ?v=');
});

test('PLAN.md header live URL equals town.json base_url plus /ghostlight-town/', () => {
  const { statusLine } = readPlanHeader();
  const urlMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=\d+`\s*\(`(https:\/\/[^`]+)`/);
  assert.ok(urlMatch, 'PLAN.md **Status:** must include live URL in backticks');
  const town = JSON.parse(fs.readFileSync(TOWN_JSON_PATH, 'utf8'));
  assert.equal(urlMatch[1], `${town.base_url}/ghostlight-town/`, 'PLAN.md header live URL must equal town.json base_url + /ghostlight-town/');
});

test('PLAN.md §12.6 watch re-check record pins the 2026-11-15 state', () => {
  const { planText } = readPlanHeader();
  const idx126 = planText.indexOf('### 12.6');
  assert.ok(idx126 !== -1, 'PLAN.md must contain ### 12.6');
  const endIdx = planText.indexOf('### 12.7', idx126);
  const sec126 = endIdx === -1 ? planText.slice(idx126) : planText.slice(idx126, endIdx);
  for (const token of ['2026-11-15', 'Colony story post still 4 comments', 'rStation 0', 'notifications / 0 comments', 'does NOT reduce yet']) {
    assert.ok(sec126.includes(token), `PLAN.md §12.6 must include "${token}"`);
  }
  const seq83 = (sec126.match(/`state_seq` `83`/g) || []).length;
  assert.equal(seq83, 1, 'PLAN.md §12.6 must record `state_seq` `83` exactly once');
});

test('README.md ## Status pins all four root plan and readme doc-guard suites and lists them in run-tests.mjs', () => {
  const readmeStatus = readReadmeStatusSection();
  const runTestsSrc = fs.readFileSync(RUN_TESTS_PATH, 'utf8');
  for (const file of ['test-plan-header.mjs', 'test-plan-body.mjs', 'test-plan-sections-9-12.mjs', 'test-readme-accuracy.mjs']) {
    assert.ok(fs.existsSync(path.join(__dirname, file)), `${file} must exist`);
    assert.ok(runTestsSrc.includes(`'${file}'`), `run-tests.mjs must register ${file}`);
    assert.match(readmeStatus, new RegExp(`\`${file}\` \\d+/\\d+`), `README.md ## Status must pin ${file}`);
  }
});

test('test-plan-body.mjs and test-plan-sections-9-12.mjs live top-level test counts match README.md Status pins', () => {
  const readmeStatus = readReadmeStatusSection();
  for (const file of ['test-plan-body.mjs', 'test-plan-sections-9-12.mjs']) {
    const fileText = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const liveCount = [...fileText.matchAll(/^test\(('([^']+)'|"([^"]+)")/gm)].length;
    assert.ok(
      readmeStatus.includes(`\`${file}\` ${liveCount}/${liveCount}`),
      `README.md ## Status must pin \`${file}\` ${liveCount}/${liveCount}`
    );
  }
});

test('README.md named-list pins are 63 unique existing files with equal counts, TOTAL after the last pin', () => {
  const readmeStatus = readReadmeStatusSection();
  const pins = [...readmeStatus.matchAll(/`([^`]+\.mjs)` (\d+)\/(\d+)/g)];
  assert.equal(pins.length, 63, 'README.md ## Status must contain exactly 63 per-file test-count pins');
  const files = pins.map((p) => p[1]);
  assert.equal(new Set(files).size, files.length, 'README.md ## Status pins must name each file once');
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(__dirname, file)), `README.md ## Status pin ${file} must exist on disk`);
  }
  for (const p of pins) {
    assert.equal(p[2], p[3], `README.md ## Status pin ${p[1]} must be an equal count (${p[2]}/${p[3]})`);
  }
  const lastPinEnd = pins[pins.length - 1].index + pins[pins.length - 1][0].length;
  const totalIdx = readmeStatus.indexOf('`run-tests.mjs` TOTAL pass=');
  assert.ok(totalIdx > lastPinEnd, 'README.md ## Status TOTAL record must follow the last per-file pin');
});

test('file hygiene — 56 unique test names, 6 import lines, 0 banned-literal lines', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-plan-header.mjs'), 'utf8');
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 56, 'test-plan-header.mjs must have exactly 56 top-level tests');
  assert.equal(new Set(names).size, names.length, 'test-plan-header.mjs test names must be unique');
  for (const name of names) {
    assert.equal(name.includes("'"), false, `test-plan-header.mjs test name must not contain an apostrophe: ${name}`);
  }
  const importLines = src.split('\n').filter((line) => line.startsWith('import ')).length;
  assert.equal(importLines, 6, 'test-plan-header.mjs must have exactly 6 import lines');
  const banned = ['fet' + 'ch(', 'Date' + '.now', 'Math' + '.random', 'TO' + 'DO', 'FIX' + 'ME', 'inner' + 'HTML', RETIRED_TERM];
  for (const needle of banned) {
    const hits = src.split('\n').filter((line) => line.includes(needle)).length;
    assert.equal(hits, 0, 'test-plan-header.mjs must have 0 lines containing a banned literal (split-needle check)');
  }
});

test('Slice 504: section 12.6 Social Gate phrase matches README Status (P1)', () => {
  const { planText } = readPlanHeader();
  const idx126 = planText.indexOf('### 12.6');
  assert.ok(idx126 !== -1, 'PLAN.md must contain ### 12.6');
  const endIdx = planText.indexOf('### 12.7', idx126);
  const sec126 = endIdx === -1 ? planText.slice(idx126) : planText.slice(idx126, endIdx);
  const readmeStatus = readReadmeStatusSection();
  const gatePhrase = /2–3 real external muses claiming\s+plots and quoted in Gazette #2 within 7 days of opening \(~Nov 20\)/;
  assert.match(sec126, gatePhrase, 'PLAN.md §12.6 must include the Social Gate acceptance phrase');
  assert.match(readmeStatus, gatePhrase, 'README.md ## Status must include the Social Gate acceptance phrase');
});

test('Slice 504: section 12.6 Build Gate live sentence matches header live-since (P2)', () => {
  const { planText, statusLine } = readPlanHeader();
  const idx126 = planText.indexOf('### 12.6');
  assert.ok(idx126 !== -1, 'PLAN.md must contain ### 12.6');
  const endIdx = planText.indexOf('### 12.7', idx126);
  const sec126 = endIdx === -1 ? planText.slice(idx126) : planText.slice(idx126, endIdx);
  assert.ok(
    sec126.includes('The engineering Build Gate is now live, not pending.'),
    'PLAN.md §12.6 must state The engineering Build Gate is now live, not pending.'
  );
  assert.ok(
    statusLine.includes('town API live since 2026-11-13'),
    'PLAN.md **Status:** must state town API live since 2026-11-13'
  );
});

test('Slice 504: section 12.6 Reggie cease-and-desist matches header blocked note (P3)', () => {
  const { planText, statusLine } = readPlanHeader();
  const idx126 = planText.indexOf('### 12.6');
  assert.ok(idx126 !== -1, 'PLAN.md must contain ### 12.6');
  const endIdx = planText.indexOf('### 12.7', idx126);
  const sec126 = endIdx === -1 ? planText.slice(idx126) : planText.slice(idx126, endIdx);
  assert.match(
    sec126,
    /Musebook\s+invites remain blocked by Reggie cease-and-desist/,
    'PLAN.md §12.6 must record Musebook invites remain blocked by Reggie cease-and-desist'
  );
  assert.ok(
    statusLine.includes('Musebook invites still blocked'),
    'PLAN.md **Status:** must note Musebook invites still blocked'
  );
});

test('Slice 504: header Status full Social Gate clause is verbatim (P4)', () => {
  const { statusLine } = readPlanHeader();
  assert.ok(
    statusLine.includes('Social Gate to ~Nov 20 (2 of 2–3 real muses — lampmoth, muse; Musebook invites still blocked)'),
    'PLAN.md **Status:** must include the full Social Gate clause verbatim'
  );
});

test('Slice 504: header Status live-API clause with section 12.6 pointer is verbatim (P5)', () => {
  const { statusLine } = readPlanHeader();
  assert.ok(
    statusLine.includes('town API live since 2026-11-13 (see §12.6; live counters such as `state_seq` are not pinned here — they move with every state mutation)'),
    'PLAN.md **Status:** must include the full live-API clause verbatim'
  );
});

test('Slice 504: README as-of-slice equals header built-through-slice dynamically (P6)', () => {
  const { statusLine } = readPlanHeader();
  const readmeStatus = readReadmeStatusSection();
  const headerSlice = statusLine.match(/built through slice (\d+)/);
  assert.ok(headerSlice, 'PLAN.md **Status:** must state built through slice <N>');
  const readmeSlice = readmeStatus.match(/Phase 0 is done and Phase 2 code is complete \(as of slice (\d+)/);
  assert.ok(readmeSlice, 'README.md ## Status must state Phase 0 is done and Phase 2 code is complete (as of slice <N>');
  assert.equal(readmeSlice[1], headerSlice[1], 'README.md ## Status slice must equal PLAN.md header slice');
});

test('Slice 504: needing Gazette #2 quotes in README Status matches PLAN.md §12.6 (P7)', () => {
  const { planText } = readPlanHeader();
  const readmeStatus = readReadmeStatusSection();
  const sec126 = readSection126(planText);
  assert.ok(
    readmeStatus.includes('needing Gazette #2 quotes'),
    'README.md ## Status must include needing Gazette #2 quotes'
  );
  assert.ok(
    sec126.includes('quoted in Gazette #2 within 7 days of opening (~Nov 20)'),
    'PLAN.md §12.6 must include quoted in Gazette #2 within 7 days of opening (~Nov 20)'
  );
  assert.ok(
    sec126.includes('`muse` awaits quotation in the next Gazette issue'),
    'PLAN.md §12.6 must record that muse awaits quotation in the next Gazette issue'
  );
});

test('Slice 504: header Planned-with and Owner lines are verbatim (P8)', () => {
  const { headerLines } = readPlanHeader();
  assert.equal(
    headerLines[5],
    '**Planned with:** Gemini 4 (`gemini-4-hydrogen-medium`) via the Antigravity CLI,',
    'PLAN.md header line 6 must match **Planned with:** verbatim'
  );
  assert.equal(
    headerLines[6],
    '5-turn planning session, 2026-11-12. Raw session transcripts in `session/`.',
    'PLAN.md header line 7 must match planning session continuation verbatim'
  );
  assert.equal(
    headerLines[7],
    '**Owner:** Milo. Werther approves big moves.',
    'PLAN.md header line 8 must match **Owner:** verbatim'
  );
});

test('Slice 504: section 12.6 heading, section 12.4 verdict, and superseded marker stay intact (P9)', () => {
  const { planText } = readPlanHeader();
  assert.ok(
    planText.includes('### 12.6 Header refresh; §12.4 verdict superseded (slice 95, 2026-11-14)'),
    'PLAN.md must include §12.6 heading verbatim'
  );
  const idx124 = planText.indexOf('### 12.4');
  assert.ok(idx124 !== -1, 'PLAN.md must contain ### 12.4');
  const end124 = planText.indexOf('### 12.5', idx124);
  const sec124 = end124 === -1 ? planText.slice(idx124) : planText.slice(idx124, end124);
  assert.ok(
    sec124.includes('**Verdict: READY-EXCEPT-LIVE-API-DEPLOY.**'),
    'PLAN.md §12.4 must retain **Verdict: READY-EXCEPT-LIVE-API-DEPLOY.**'
  );
  const idx126 = planText.indexOf('### 12.6');
  const end126 = planText.indexOf('### 12.7', idx126);
  const sec126 = end126 === -1 ? planText.slice(idx126) : planText.slice(idx126, end126);
  assert.ok(
    sec126.includes('**§12.4 verdict superseded:**'),
    'PLAN.md §12.6 must retain **§12.4 verdict superseded:**'
  );
});
