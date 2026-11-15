/**
 * Ghostlight Town — drift guard for PLAN.md §§1–8 body facts (Slices 126, 137)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_HTML_BYTES, MAX_MANIFEST_BYTES, VALID_PROP_KINDS } from './town-api/plot-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = path.join(__dirname, 'PLAN.md');
const TEST_3D_PATH = path.join(__dirname, 'town-3d', 'test-3d.mjs');
const SERVER_PATH = path.join(__dirname, 'town-api', 'server.mjs');
const SCHEMA_PATH = path.join(__dirname, 'town-api', 'schema.sql');
const STEPBACK_PATH = path.join(__dirname, 'town-npc', 'stepback.mjs');
const NPC_RUN_PATH = path.join(__dirname, 'town-npc', 'run.mjs');
const NPC_README_PATH = path.join(__dirname, 'town-npc', 'README.md');

function readPlanBodySections() {
  const planText = fs.readFileSync(PLAN_PATH, 'utf8');
  const startIdx = planText.indexOf('## 1. Vision');
  const endIdx = planText.indexOf('## 9. Open questions');
  assert.ok(startIdx !== -1 && endIdx !== -1 && endIdx > startIdx, 'PLAN.md must contain §§1–8 before §9');
  return {
    full: planText,
    body: planText.slice(startIdx, endIdx),
  };
}

test('PLAN.md §4 Performance budget matches town-3d/test-3d.mjs mesh count and budget', () => {
  const test3d = fs.readFileSync(TEST_3D_PATH, 'utf8');
  const countMatch = test3d.match(/assert\.equal\(meshes\.length,\s*(\d+)/);
  const budgetMatch = test3d.match(/assert\.ok\(meshes\.length\s*<\s*(\d+)/);
  assert.ok(countMatch, 'town-3d/test-3d.mjs must assert exact meshes.length');
  assert.ok(budgetMatch, 'town-3d/test-3d.mjs must assert meshes.length < budget');

  const meshCount = countMatch[1];
  const meshBudget = budgetMatch[1];
  const { body } = readPlanBodySections();

  assert.match(body, new RegExp(`Mesh budget < ${meshBudget}`), `PLAN.md §4 must state Mesh budget < ${meshBudget}`);
  assert.match(body, new RegExp(`asserts ${meshCount} meshes`), `PLAN.md §4 must state ${meshCount} meshes`);
  assert.doesNotMatch(body, /Mesh budget < 125/, 'PLAN.md §4 must not retain stale < 125 mesh budget');
});

test('PLAN.md §4 Data model matches VALID_ORIGINS (including direct) from town-api/server.mjs', () => {
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  const originsMatch = serverText.match(/const VALID_ORIGINS\s*=\s*new Set\(\[([^\]]+)\]\)/);
  assert.ok(originsMatch, 'town-api/server.mjs must define VALID_ORIGINS');

  const origins = [...originsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(origins.includes('direct'), 'VALID_ORIGINS in server.mjs must include direct');

  const { body } = readPlanBodySections();
  const residentsLine = body.match(/-\s*`residents`:[\s\S]*?(?=\n-\s*`invitations`:)/);
  assert.ok(residentsLine, 'PLAN.md §4 must document residents table');
  for (const origin of origins) {
    assert.ok(residentsLine[0].includes(origin), `PLAN.md §4 residents.origin must include ${origin}`);
  }
});

test('PLAN.md §4 Data model matches town-api/schema.sql tables and prompt_book.reply_to', () => {
  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const tableNames = [...schemaText.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]);
  assert.ok(tableNames.includes('guestbook'), 'schema.sql must define guestbook table');
  assert.ok(tableNames.includes('inn_claims'), 'schema.sql must define inn_claims table');
  assert.match(schemaText, /reply_to\s+INTEGER/, 'schema.sql prompt_book must define reply_to');

  const { body } = readPlanBodySections();
  assert.match(body, new RegExp(`${tableNames.length} tables`), `PLAN.md §4 must state ${tableNames.length} tables`);
  for (const table of tableNames) {
    assert.match(body, new RegExp(`-\\s*\`${table}\``), `PLAN.md §4 Data model must list table ${table}`);
  }
  const promptBookLine = body.match(/-\s*`prompt_book`:[\s\S]*?(?=\n-\s*`presence`:)/);
  assert.ok(promptBookLine && promptBookLine[0].includes('`reply_to`'), 'PLAN.md §4 prompt_book must list reply_to');
});

test('PLAN.md §5 plot catalog matches VALID_PROP_KINDS count and kinds in town-api/plot-validation.mjs', () => {
  const { body } = readPlanBodySections();
  const count = VALID_PROP_KINDS.size;
  assert.match(body, new RegExp(`${count} starter kinds`), `PLAN.md §5 must state ${count} starter kinds`);
  for (const kind of VALID_PROP_KINDS) {
    assert.match(body, new RegExp(`\`${kind}\``), `PLAN.md §5 must list prop kind ${kind}`);
  }
});

test('PLAN.md header and §4 identify staging-polyfork as live client and town-3d as fallback', () => {
  const { full, body } = readPlanBodySections();
  const statusLine = full.split(/\r?\n/).find((line) => line.startsWith('**Status:**'));
  assert.ok(statusLine, 'PLAN.md must have a **Status:** header line');
  assert.match(statusLine, /live Polyfork town/, 'PLAN.md **Status:** must identify live Polyfork town');
  assert.match(statusLine, /town-3d\/.*fallback/, 'PLAN.md **Status:** must identify town-3d/ as fallback');
  assert.match(body, /live client is `staging-polyfork\/`/, 'PLAN.md §4 must identify staging-polyfork/ as live client');
});

test('PLAN.md §4 size caps match plot-validation.mjs and server.mjs CAPS', () => {
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  const sayCap = serverText.match(/\bsay:\s*(\d+)/);
  const statusCap = serverText.match(/\bstatusText:\s*(\d+)/);
  const bioCap = serverText.match(/\bbio:\s*(\d+)/);
  assert.ok(sayCap && statusCap && bioCap, 'server.mjs must define CAPS.say, CAPS.statusText, and CAPS.bio');

  const manifestKb = MAX_MANIFEST_BYTES / 1024;
  const htmlKb = MAX_HTML_BYTES / 1024;
  const { body } = readPlanBodySections();

  assert.match(body, new RegExp(`plot manifest ${manifestKb} KB`), `PLAN.md §4 must state manifest ${manifestKb} KB`);
  assert.match(body, new RegExp(`plot HTML ${htmlKb} KB`), `PLAN.md §4 must state HTML ${htmlKb} KB`);
  assert.match(body, new RegExp(`\`say\` ${sayCap[1]} chars`), `PLAN.md §4 must state say ${sayCap[1]} chars`);
  assert.match(body, new RegExp(`\`status_text\` ${statusCap[1]} chars`), `PLAN.md §4 must state status_text ${statusCap[1]} chars`);
  assert.match(body, new RegExp(`bio ${bioCap[1]} chars`), `PLAN.md §4 must state bio ${bioCap[1]} chars`);
});

test('PLAN.md §4 rate limits match RATE_LIMITS in server.mjs', () => {
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  const rlBlock = serverText.match(/const RATE_LIMITS\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(rlBlock, 'server.mjs must define RATE_LIMITS');

  const sayRl = rlBlock[1].match(/say:\s*\{\s*max:\s*(\d+),\s*windowSec:\s*(\d+)\s*\*\s*60\s*\}/);
  const checkinRl = rlBlock[1].match(/checkin:\s*\{\s*max:\s*(\d+),\s*windowSec:\s*(\d+)\s*\}/);
  const joinRl = rlBlock[1].match(/joinIp:\s*\{\s*max:\s*(\d+),\s*windowSec:\s*60\s*\*\s*60\s*\}/);
  const plotRl = rlBlock[1].match(/plot:\s*\{\s*max:\s*(\d+),\s*windowSec:\s*60\s*\*\s*60\s*\}/);
  assert.ok(sayRl && checkinRl && joinRl && plotRl, 'server.mjs RATE_LIMITS must define say, checkin, joinIp, and plot');

  const { body } = readPlanBodySections();
  assert.match(body, new RegExp(`\`say\` ${sayRl[1]}/${sayRl[2]} min`), 'PLAN.md §4 must match say rate limit');
  assert.match(body, new RegExp(`\`checkin\` ${checkinRl[1]}/${checkinRl[2]} s`), 'PLAN.md §4 must match checkin rate limit');
  assert.match(body, new RegExp(`plot edit ${plotRl[1]}/hour`), 'PLAN.md §4 must match plot rate limit');
  assert.match(body, new RegExp(`\`join\` ${joinRl[1]}/hour per IP`), 'PLAN.md §4 must match join IP rate limit');
});

test('PLAN.md §4 footlight TTL/slots, prompt_book retention/view, nonce/skew, and ports match server.mjs', () => {
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  const skewMatch = serverText.match(/const TIMESTAMP_SKEW_SEC\s*=\s*(\d+)/);
  const nonceMatch = serverText.match(/const NONCE_TTL_SEC\s*=\s*(\d+)/);
  const footlightMatch = serverText.match(/const FOOTLIGHT_TTL_SEC\s*=\s*(\d+)\s*\*\s*60/);
  const retentionMatch = serverText.match(/const PROMPT_BOOK_RETENTION_SEC\s*=\s*(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60/);
  const portMatch = serverText.match(/Number\(process\.env\.TOWN_PORT\)\s*\|\|\s*(\d+)/);
  assert.ok(skewMatch && nonceMatch && footlightMatch && retentionMatch && portMatch, 'server.mjs must define timing and port constants');
  assert.match(serverText, /body\.slot < 0 \|\| body\.slot > 9/, 'server.mjs must enforce slot 0..9');
  assert.match(serverText, /cutoff24h\s*=\s*now\s*-\s*24\s*\*\s*60\s*\*\s*60/, 'server.mjs must use 24h prompt_book state cutoff');
  assert.match(serverText, /ORDER BY id DESC LIMIT 100/, 'server.mjs must use 100-line prompt_book state fallback');
  assert.match(serverText, /const nonces = new Map\(\)/, 'server.mjs must store nonces in an in-memory Map');

  const { body } = readPlanBodySections();
  const nonceMin = Number(nonceMatch[1]) / 60;
  assert.match(body, new RegExp(`TTL ${footlightMatch[1]} min`), 'PLAN.md §4 must match footlight TTL');
  assert.match(body, /`slot` \(`0\.\.9`\)/, 'PLAN.md §4 must document slot 0..9');
  assert.match(body, new RegExp(`${retentionMatch[1]}-day retention prune`), 'PLAN.md §4 must match prompt_book retention');
  assert.match(body, /shows last 24h or 100 lines/, 'PLAN.md §4 must match prompt_book 24h/100-line view');
  assert.match(body, new RegExp(`in-memory \`Map\` in \`town-api/server\\.mjs\` with a ${nonceMin}-min TTL`), 'PLAN.md §4 must match nonce Map and TTL');
  assert.match(body, new RegExp(`\`\\|server_now − timestamp\\| > ${skewMatch[1]}\` seconds`), 'PLAN.md §4 must match timestamp skew');
  assert.match(body, new RegExp(`8125.*\`${portMatch[1]}\` is taken by MSK.*local dev default`), 'PLAN.md §4 must match live 8125 and dev default 8124');
});

test('PLAN.md §§1–8 uses "The Nightly Call" and retires "Nightly Ember" outside Phase 0 OUT historical scope', () => {
  const { body } = readPlanBodySections();
  assert.match(body, /\*\*The Nightly Call:\*\*/, 'PLAN.md §3 must use The Nightly Call');
  assert.match(body, /The Nightly Call\s+prompt;/, 'PLAN.md §7 must use The Nightly Call');

  const bodyWithoutSessionLog = body
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('*Slice '))
    .join(' ');
  const emberMatches = [...bodyWithoutSessionLog.matchAll(/nightly\s+ember/gi)];
  assert.equal(emberMatches.length, 1, 'Nightly Ember may appear only once in §§1–8 (Phase 0 OUT historical scope)');
  assert.match(bodyWithoutSessionLog, /Nightly\s+Ember automation/, 'The single historical Nightly Ember reference must be the Phase 0 OUT item');
});

test('PLAN.md §6 NPC handover thresholds, 3-hour cadence, and npc_state layout match town-npc/', () => {
  const stepbackText = fs.readFileSync(STEPBACK_PATH, 'utf8');
  const runText = fs.readFileSync(NPC_RUN_PATH, 'utf8');
  const npcReadmeText = fs.readFileSync(NPC_README_PATH, 'utf8');

  assert.match(stepbackText, /activeRealCount >= 5/, 'stepback.mjs must define 5-resident reply-only threshold');
  assert.match(stepbackText, /activeRealCount >= 10/, 'stepback.mjs must define 10-resident retire threshold');
  const memMatch = runText.match(/export const MEMORY_MAX_BYTES\s*=\s*(\d+)/);
  assert.ok(memMatch && Number(memMatch[1]) === 2048, 'town-npc/run.mjs must define MEMORY_MAX_BYTES = 2048');
  assert.match(npcReadmeText, /3-hourly/, 'town-npc/README.md must document 3-hourly cadence');
  assert.match(npcReadmeText, /npc_state\/<handle>\//, 'town-npc/README.md must document npc_state/<handle>/ layout');

  const { body } = readPlanBodySections();
  assert.match(body, /`town-npc\/run-all\.mjs` on the VM's hatch runtime scheduler every 3 hours/, 'PLAN.md §6 must match run-all.mjs 3-hour scheduler');
  assert.match(body, /npc_state\/<handle>\/\{state\.json,memory\.md,key\.pem,pubkey\.txt\}/, 'PLAN.md §6 must match npc_state/<handle>/ layout');
  assert.match(body, /`memory\.md` \(< 2 KB\)/, 'PLAN.md §6 must match memory.md < 2 KB');
  assert.match(body, /At 5 active real residents:/, 'PLAN.md §6 must match 5-resident threshold');
  assert.match(body, /At 10\+ active real residents:/, 'PLAN.md §6 must match 10+ resident threshold');
});
