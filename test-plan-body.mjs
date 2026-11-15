/**
 * Ghostlight Town — drift guard for PLAN.md §§1–8 body facts (Slice 126)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VALID_PROP_KINDS } from './town-api/plot-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = path.join(__dirname, 'PLAN.md');
const TEST_3D_PATH = path.join(__dirname, 'town-3d', 'test-3d.mjs');
const SERVER_PATH = path.join(__dirname, 'town-api', 'server.mjs');
const SCHEMA_PATH = path.join(__dirname, 'town-api', 'schema.sql');

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
