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

function readLatestSliceEntry(planText) {
  const sec8 = readSection8(planText);
  const entries = [...sec8.matchAll(/^\*Slice (\d+)([a-z]?)\b[^\n]*/gm)];
  assert.ok(entries.length > 0, 'PLAN.md §8 must contain at least one *Slice N* entry');
  const latest = entries[entries.length - 1];
  const maxNum = Math.max(...entries.map((m) => Number(m[1])));
  return {
    latestNum: Number(latest[1]),
    latestSuffix: latest[2] || '',
    latestLine: latest[0],
    maxNum,
  };
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

test('PLAN.md header slice number matches README.md ## Status, latest §8 entry, and max §8 slice', () => {
  const { planText, statusLine } = readPlanHeader();
  const headerSliceMatch = statusLine.match(/built through slice (\d+)\b/);
  assert.ok(headerSliceMatch, 'PLAN.md **Status:** must state built through slice <N>');
  const headerSlice = Number(headerSliceMatch[1]);

  const readmeStatus = readReadmeStatusSection();
  const readmeSliceMatch = readmeStatus.match(/as of slice (\d+)\b/);
  assert.ok(readmeSliceMatch, 'README.md ## Status must state as of slice <N>');
  assert.equal(Number(readmeSliceMatch[1]), headerSlice, 'README.md ## Status slice pin must match PLAN.md header');

  const { latestNum, latestSuffix, maxNum } = readLatestSliceEntry(planText);
  assert.equal(latestSuffix, '', 'Latest §8 entry should be a numeric slice');
  assert.equal(latestNum, headerSlice, 'Latest §8 entry slice number must match PLAN.md header');
  assert.equal(maxNum, headerSlice, 'Maximum §8 slice number must match PLAN.md header');
});

test('PLAN.md header TOTAL snapshot matches latest §8 entry and run-tests.mjs suite count', () => {
  const { planText, statusLine } = readPlanHeader();
  const totalMatch = statusLine.match(/TOTAL pass=(\d+) fail=(\d+) skipped=(\d+) suites=(\d+)/);
  assert.ok(totalMatch, 'PLAN.md **Status:** must include TOTAL pass=... fail=... skipped=... suites=...');
  const [verbatimTotal, , , , suitesStr] = totalMatch;

  const { latestLine } = readLatestSliceEntry(planText);
  assert.ok(
    latestLine.includes(verbatimTotal),
    `Latest §8 entry must record "${verbatimTotal}" verbatim`
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
  const depMatch = statusLine.match(/`\?v=(\d+)` bundle \/ (\d+) files deployed 2026-11-23, no pending deploy candidate/);
  assert.ok(depMatch, 'PLAN.md **Status:** must state `?v=<N>` bundle / <count> files deployed 2026-11-23, no pending deploy candidate');
  const [, headerV, headerFiles] = depMatch;

  const stagingHtml = fs.readFileSync(STAGING_HTML_PATH, 'utf8');
  const htmlVMatch = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(htmlVMatch, 'staging-polyfork/index.html must reference staging.js?v=<N>');
  assert.equal(headerV, htmlVMatch[1], `PLAN.md **Status:** ?v=${headerV} must match staging-polyfork/index.html (?v=${htmlVMatch[1]})`);

  const stageTestSrc = fs.readFileSync(STAGE_TEST_PATH, 'utf8');
  assert.match(
    stageTestSrc,
    new RegExp(`assert\\.equal\\(summary\\.file_count,\\s*${headerFiles}\\)`),
    `scripts/test-stage-deploy.mjs must pin staging-polyfork file_count === ${headerFiles}`
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

test('PLAN.md header live staging.js?v= agrees with README Status and latest §8 live-check record', () => {
  const { planText, statusLine } = readPlanHeader();
  const headerMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(headerMatch, 'PLAN.md **Status:** must state live Polyfork town at `staging.js?v=<N>`');

  const readmeStatus = readReadmeStatusSection();
  const readmeMatch = readmeStatus.match(/serving `staging\.js\?v=(\d+)`/);
  assert.ok(readmeMatch, 'README.md ## Status must state serving `staging.js?v=<N>`');

  const sec8 = readSection8(planText);
  const sec8Matches = [...sec8.matchAll(/live\s+`?\?v=(\d+)/g)];
  assert.ok(sec8Matches.length > 0, 'PLAN.md §8 must contain at least one live `?v=<N>` record');
  const latestSec8V = sec8Matches[sec8Matches.length - 1][1];

  assert.equal(headerMatch[1], readmeMatch[1], 'PLAN.md header live staging.js?v= must match README.md ## Status');
  assert.equal(headerMatch[1], latestSec8V, 'PLAN.md header live staging.js?v= must match latest §8 live-check record');
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

test('PLAN.md header slice date matches the latest §8 entry date', () => {
  const { planText, statusLine } = readPlanHeader();
  const headerDateMatch = statusLine.match(/built through slice \d+\s*\((\d{4}-\d{2}-\d{2})\)/);
  assert.ok(headerDateMatch, 'PLAN.md **Status:** must state built through slice <N> (<YYYY-MM-DD>)');

  const { latestLine } = readLatestSliceEntry(planText);
  const sec8DateMatch = latestLine.match(/(\d{4}-\d{2}-\d{2})/);
  assert.ok(sec8DateMatch, 'Latest §8 entry must include a YYYY-MM-DD date');
  assert.equal(headerDateMatch[1], sec8DateMatch[1], 'PLAN.md header slice date must match latest §8 entry date');
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
  assert.ok(readmeStatus.includes('deployed 2026-11-23'), 'README.md ## Status must include deployed 2026-11-23');
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
  assert.ok(sec126.includes('`?v=41` / 195 files'), 'PLAN.md §12.6 must record `?v=41` / 195 files');
  assert.ok(sec126.includes('deployed 2026-11-23'), 'PLAN.md §12.6 must record deployed 2026-11-23');
  assert.ok(sec126.includes('serves `staging.js?v=41`'), 'PLAN.md §12.6 must record serves `staging.js?v=41`');

  const liveMatch = statusLine.match(/live Polyfork town at `staging\.js\?v=(\d+)`/);
  assert.ok(liveMatch, 'PLAN.md **Status:** must state live Polyfork town at `staging.js?v=<N>`');
  assert.equal(liveMatch[1], '41', 'PLAN.md **Status:** live staging.js?v= must be 41');
});

test('README.md per-file pin agrees with the latest §8 entry', () => {
  const { planText } = readPlanHeader();
  const { latestLine } = readLatestSliceEntry(planText);
  const sliceMatch = latestLine.match(/`([a-z0-9\-/]+\.mjs)` (\d+) → (\d+) top-level tests/);
  assert.ok(sliceMatch, 'Latest §8 entry must record `<file>.mjs <old> → <new> top-level tests`');
  const [, file, , newCount] = sliceMatch;

  const readmeStatus = readReadmeStatusSection();
  assert.ok(
    readmeStatus.includes(`\`${file}\` ${newCount}/${newCount}`),
    `README.md ## Status must pin \`${file}\` ${newCount}/${newCount}`
  );
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

test('PLAN.md §8 slice-93 entry closes the last Phase 2 line', () => {
  const { planText, statusLine } = readPlanHeader();
  const sec8 = readSection8(planText);
  const entries = [...sec8.matchAll(/^\*Slice (\d+)([a-z]?)\b[^\n]*/gm)];
  const slice93 = entries.find((m) => m[1] === '93');
  assert.ok(slice93, 'PLAN.md §8 must contain a *Slice 93 entry');
  assert.ok(
    slice93[0].includes('last unshipped Phase 2 line'),
    'PLAN.md §8 Slice 93 entry must include last unshipped Phase 2 line'
  );

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
  assert.ok(readmeStatus.includes('deployed 2026-11-23'), 'README.md ## Status must include deployed 2026-11-23');
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

test('PLAN.md §8 slice entries are strictly increasing with no duplicates', () => {
  const { planText } = readPlanHeader();
  const sec8 = readSection8(planText);
  const entries = [...sec8.matchAll(/^\*Slice (\d+)([a-z]?)\b[^\n]*/gm)];
  assert.ok(entries.length > 0, 'PLAN.md §8 must contain *Slice N* entries');
  let prev = -Infinity;
  for (const m of entries) {
    const num = Number(m[1]);
    assert.ok(num > prev, `PLAN.md §8 slice numbers must be strictly increasing (${num} after ${prev})`);
    prev = num;
  }
});

test('PLAN.md §8 every slice entry from slice 180 carries a YYYY-MM-DD date', () => {
  const { planText } = readPlanHeader();
  const sec8 = readSection8(planText);
  const entries = [...sec8.matchAll(/^\*Slice (\d+)([a-z]?)\b[^\n]*/gm)];
  const datedEntries = entries.filter((m) => Number(m[1]) >= 180);
  assert.ok(datedEntries.length > 0, 'PLAN.md §8 must have slice entries >= 180');
  for (const m of datedEntries) {
    assert.match(m[0], /\d{4}-\d{2}-\d{2}/, `Slice ${m[1]} entry must carry a YYYY-MM-DD date`);
  }
});

test('PLAN.md latest §8 entry live-check record agrees with the header bundle counts', () => {
  const { planText, statusLine } = readPlanHeader();
  const { latestLine } = readLatestSliceEntry(planText);
  assert.match(latestLine, /`check-live` 195\/195 ok, zero gaps/, 'Latest §8 entry must record `check-live` 195/195 ok, zero gaps');
  assert.match(latestLine, /`staging-polyfork` 195\/195/, 'Latest §8 entry must record `staging-polyfork` 195/195');
  assert.match(latestLine, /`town-3d` 25\/25/, 'Latest §8 entry must record `town-3d` 25/25');

  const bundleMatch = statusLine.match(/`\?v=(\d+)` bundle \/ (\d+) files deployed 2026-11-23/);
  assert.ok(bundleMatch, 'PLAN.md **Status:** must state `?v=<N>` bundle / <M> files deployed 2026-11-23');
  assert.equal(bundleMatch[2], '195', 'Header deployed bundle count must be 195');

  const fallbackMatch = statusLine.match(/`town\.js\?v=(\d+)`\s*\/\s*(\d+) files/);
  assert.ok(fallbackMatch, 'PLAN.md **Status:** must state `town.js?v=<N>` / <M> files');
  assert.equal(fallbackMatch[2], '25', 'Header fallback bundle count must be 25');
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

test('PLAN.md latest §8 entry records the quota line', () => {
  const { planText } = readPlanHeader();
  const { latestLine } = readLatestSliceEntry(planText);
  assert.match(latestLine, /Quota at session start: Gemini weekly \d+%/, 'Latest §8 entry must record "Quota at session start: Gemini weekly <N>%"');
  assert.match(latestLine, /five-hour \d+% \(resets [^)]+\)/, 'Latest §8 entry must record "five-hour <N>% (resets ...)"');
});

test('PLAN.md latest §8 entry records the full live API state', () => {
  const { planText } = readPlanHeader();
  const { latestLine } = readLatestSliceEntry(planText);
  for (const field of ['state_seq', 'Prompt Book', 'nightly_call', 'daily_game', 'garden', 'plots', 'inn', 'guestbook', 'events', 'index 200']) {
    assert.ok(latestLine.includes(field), `Latest §8 entry must record the live API field "${field}"`);
  }
});

test('PLAN.md latest §8 entry records the Social Gate check', () => {
  const { planText } = readPlanHeader();
  const { latestLine } = readLatestSliceEntry(planText);
  assert.ok(latestLine.includes('Colony story post'), 'Latest §8 entry must record Colony story post');
  assert.ok(latestLine.includes('421526bb'), 'Latest §8 entry must record Colony story post id 421526bb');
  assert.ok(latestLine.includes('rStation'), 'Latest §8 entry must record rStation');
  assert.match(latestLine, /(posts\/122|post\/122)/, 'Latest §8 entry must record rStation story post 122');
  assert.ok(latestLine.includes('2 of 2–3'), 'Latest §8 entry must record "2 of 2–3"');
});

test('PLAN.md latest §8 entry records NOT deployed and the live ?v=', () => {
  const { planText } = readPlanHeader();
  const { latestLine } = readLatestSliceEntry(planText);
  assert.match(latestLine, /NOT deployed/, 'Latest §8 entry must record NOT deployed');
  assert.match(latestLine, /`\?v=\d+` live/, 'Latest §8 entry must record `?v=<N>` live');
});

test('PLAN.md latest §8 entry records the tier status', () => {
  const { planText } = readPlanHeader();
  const { latestLine } = readLatestSliceEntry(planText);
  assert.match(latestLine, /\d+-test tier/, 'Latest §8 entry must record "<N>-test tier"');
  assert.match(latestLine, /next thinnest is the \d+-test tier/, 'Latest §8 entry must record "next thinnest is the <N>-test tier"');
});

test('PLAN.md latest §8 entry records the scratch verification', () => {
  const { planText } = readPlanHeader();
  const { latestLine } = readLatestSliceEntry(planText);
  assert.match(latestLine, /Scratch verification: \d+\/\d+ checks passed/, 'Latest §8 entry must record "Scratch verification: <N>/<M> checks passed"');
});

test('PLAN.md latest §8 entry records the per-file test result', () => {
  const { planText } = readPlanHeader();
  const { latestLine } = readLatestSliceEntry(planText);
  assert.match(latestLine, /node --test [^`]+` reports `\d+\/\d+` pass/, 'Latest §8 entry must record "`node --test <file>` reports `<N>/<M>` pass"');
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

test('PLAN.md §8 last 30 entries each carry the core record fields', () => {
  const { planText } = readPlanHeader();
  const sec8 = readSection8(planText);
  const entries = [...sec8.matchAll(/^\*Slice (\d+)([a-z]?)\b[^\n]*/gm)];
  const recent = entries.slice(-30);
  assert.equal(recent.length, 30, 'PLAN.md §8 must have at least 30 slice entries');
  for (const m of recent) {
    const line = m[0];
    const num = m[1];
    for (const field of ['Quota at session start', 'NOT deployed', 'check-live', 'staging rehearsal', '-test tier']) {
      assert.ok(line.includes(field), `PLAN.md §8 Slice ${num} must record "${field}"`);
    }
  }
});
