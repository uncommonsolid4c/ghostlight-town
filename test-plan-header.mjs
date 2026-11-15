/**
 * Ghostlight Town — drift guard for PLAN.md header & §12.6 history (Slices 112 & 136)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = path.join(__dirname, 'PLAN.md');
const README_PATH = path.join(__dirname, 'README.md');
const RUN_TESTS_PATH = path.join(__dirname, 'run-tests.mjs');
const TOWN3D_HTML_PATH = path.join(__dirname, 'town-3d', 'index.html');
const STAGING_HTML_PATH = path.join(__dirname, 'staging-polyfork', 'index.html');
const STAGE_TEST_PATH = path.join(__dirname, 'scripts', 'test-stage-deploy.mjs');
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
  const headerVMatch = statusLine.match(/`town\.js\?v=(\d+)`\s*\/\s*24 files/);
  assert.ok(headerVMatch, 'PLAN.md **Status:** must state `town.js?v=<N>` / 24 files');

  const town3dHtml = fs.readFileSync(TOWN3D_HTML_PATH, 'utf8');
  const htmlVMatch = town3dHtml.match(/\.\/town\.js\?v=(\d+)/);
  assert.ok(htmlVMatch, 'town-3d/index.html must reference ./town.js?v=<N>');
  assert.equal(
    headerVMatch[1],
    htmlVMatch[1],
    `PLAN.md **Status:** town.js?v=${headerVMatch[1]} must match town-3d/index.html (?v=${htmlVMatch[1]})`
  );
});

test('PLAN.md header staging-polyfork deploy candidate ?v= and file count match index.html and test-stage-deploy.mjs', () => {
  const { statusLine } = readPlanHeader();
  const candMatch = statusLine.match(/`\?v=(\d+)`\s+bundle\s*\/\s*(\d+)\s+files is the next repo-only deploy candidate/);
  assert.ok(candMatch, 'PLAN.md **Status:** must state `?v=<N>` bundle / <count> files deploy candidate');
  const [, headerV, headerFiles] = candMatch;

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

  for (const marker of ['~Nov 20', '1 of 2–3', 'lampmoth']) {
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
