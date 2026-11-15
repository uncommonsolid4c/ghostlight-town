/**
 * Ghostlight Town — drift guard for PLAN.md §§9–12 facts (Slice 127)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VALID_PROP_KINDS } from './town-api/plot-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = path.join(__dirname, 'PLAN.md');
const TOWN_JSON_PATH = path.join(__dirname, 'town.json');
const STAGING_HTML_PATH = path.join(__dirname, 'staging-polyfork', 'index.html');

function readPlanTailSections() {
  const planText = fs.readFileSync(PLAN_PATH, 'utf8');
  const startIdx = planText.indexOf('## 9. Open questions');
  assert.ok(startIdx !== -1, 'PLAN.md must contain ## 9. Open questions');
  return planText.slice(startIdx);
}

test('PLAN.md §9 Q4 plot catalog matches VALID_PROP_KINDS count and additions in town-api/plot-validation.mjs', () => {
  const tail = readPlanTailSections();
  const q4Match = tail.match(/4\.\s*\*\*Plot catalog:\*\*[\s\S]*?(?=\n5\.\s*\*\*Milo's own cottage:)/);
  assert.ok(q4Match, 'PLAN.md §9 must contain Q4 Plot catalog');
  const q4 = q4Match[0];

  assert.match(q4, new RegExp(`${VALID_PROP_KINDS.size} starter prop kinds`), `PLAN.md §9 Q4 must state ${VALID_PROP_KINDS.size} starter prop kinds`);
  assert.doesNotMatch(q4, /seven starter prop kinds/i, 'PLAN.md §9 Q4 must not retain stale "seven starter prop kinds"');
  assert.match(q4, /\blantern\b/, 'PLAN.md §9 Q4 must name lantern');
  assert.match(q4, /\bplanter\b/, 'PLAN.md §9 Q4 must name planter');
});

test('PLAN.md §9 Q1 SEND GATE reflects live API and Musebook cease-and-desist block', () => {
  const tail = readPlanTailSections();
  const q1Match = tail.match(/1\.\s*\*\*Who are the first invitations\?\*\*[\s\S]*?(?=\n2\.\s*\*\*NPC characters:)/);
  assert.ok(q1Match, 'PLAN.md §9 must contain Q1 Who are the first invitations');
  const q1 = q1Match[0];

  assert.match(q1, /SEND GATE:[\s\S]*live town API is up since 2026-11-13/, 'PLAN.md §9 Q1 SEND GATE must state live town API is up since 2026-11-13');
  assert.match(q1, /BLOCKED[\s\S]*cease-and-desist/i, 'PLAN.md §9 Q1 SEND GATE must record Musebook cease-and-desist block');
  assert.doesNotMatch(q1, /do not invite anyone until the\s+live town API is up/i, 'PLAN.md §9 Q1 must not retain pre-launch API-down gate');
  for (const name of ['Raul', 'Nimbus', 'pixel', 'Miro', 'FieldnoteRelay', 'Juniper', 'MuseInstance1034', 'Sophie']) {
    assert.ok(q1.includes(name), `PLAN.md §9 Q1 must retain ${name}`);
  }
});

test('PLAN.md §10 and §12.6 match live API port, gathering-place rhythm, and staging-polyfork deploy candidate', () => {
  const tail = readPlanTailSections();
  const sec10Match = tail.match(/## 10\. What came from where[\s\S]*?(?=\n## 11\. Decisions)/);
  assert.ok(sec10Match, 'PLAN.md must contain §10');
  const sec10 = sec10Match[0];

  assert.doesNotMatch(sec10, /Nightly Ember/, 'PLAN.md §10 must not retain retired "Nightly Ember" name');
  assert.match(sec10, /The Nightly Call/, 'PLAN.md §10 must name The Nightly Call');
  assert.match(sec10, /Node API[\s\S]*8125/, 'PLAN.md §10 must cite live port 8125');

  const stagingHtml = fs.readFileSync(STAGING_HTML_PATH, 'utf8');
  const vMatch = stagingHtml.match(/staging\.js\?v=(\d+)/);
  assert.ok(vMatch, 'staging-polyfork/index.html must reference staging.js?v=<N>');

  const sec126Match = tail.match(/### 12\.6[\s\S]*$/);
  assert.ok(sec126Match, 'PLAN.md must contain §12.6');
  const sec126 = sec126Match[0];
  assert.match(sec126, new RegExp(`\\?v=${vMatch[1]}\\b`), `PLAN.md §12.6 must pin deploy candidate ?v=${vMatch[1]}`);
  assert.match(sec126, /191 files/, 'PLAN.md §12.6 must state 191 files for the staging-polyfork candidate');
});

test('PLAN.md §12.4 gap-4 resolution matches town.json live: true', () => {
  const townJson = JSON.parse(fs.readFileSync(TOWN_JSON_PATH, 'utf8'));
  assert.equal(townJson.live, true, 'town.json live must be true');

  const tail = readPlanTailSections();
  const sec124Match = tail.match(/### 12\.4[\s\S]*?(?=\n### 12\.5)/);
  assert.ok(sec124Match, 'PLAN.md must contain §12.4');
  const sec124 = sec124Match[0];
  assert.match(sec124, /\*\*Resolution \(2026-11-15, slice 127\):\*\*[\s\S]*`town\.json` `live` flipped to `true`/, 'PLAN.md §12.4 must record dated resolution of gap 4');
});

test('PLAN.md §12.2 fix #2 records verified Node version and §9 Q9 annotates log term', () => {
  const tail = readPlanTailSections();
  const sec122Match = tail.match(/### 12\.2[\s\S]*?(?=\n### 12\.3)/);
  assert.ok(sec122Match, 'PLAN.md must contain §12.2');
  assert.match(sec122Match[0], /Node\s+v24\.21\.0/, 'PLAN.md §12.2 fix #2 must record verified homelab Node v24.21.0');

  const q9Match = tail.match(/9\.\s*\*\*Public by default:\*\*[\s\S]*?(?=\n---)/);
  assert.ok(q9Match, 'PLAN.md §9 must contain Q9 Public by default');
  assert.match(q9Match[0], /Prompt Book,\s+§12\.1/, 'PLAN.md §9 Q9 must annotate the pre-Argon log term with Prompt Book, §12.1');
});
