/**
 * Drift-guard test for README.md against PLAN.md, staging-polyfork/index.html,
 * town-api/server.mjs, town-api/plot-validation.mjs, town-api/ghostlight-client.mjs,
 * and town-npc/characters.mjs (Slice 129).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTERS } from './town-npc/characters.mjs';
import { collectSourceFiles } from './scripts/stage-deploy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;

const readmeMd = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const planMd = fs.readFileSync(path.join(REPO_ROOT, 'PLAN.md'), 'utf8');
const stagingHtml = fs.readFileSync(path.join(REPO_ROOT, 'staging-polyfork/index.html'), 'utf8');
const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/server.mjs'), 'utf8');
const plotValidationSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/plot-validation.mjs'), 'utf8');
const clientSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/ghostlight-client.mjs'), 'utf8');
const townJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));

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

test('README.md ## Status deploy-candidate bundle is 191 files', async () => {
  const statusSec = getSection(readmeMd, 'Status');
  assert.ok(statusSec.includes('191-file'), 'README.md ## Status must state 191-file deploy-candidate bundle');
  const { files } = await collectSourceFiles(REPO_ROOT, 'staging-polyfork');
  assert.equal(files.length, 191, `Expected staging-polyfork bundle to contain 191 files, found ${files.length}`);
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
