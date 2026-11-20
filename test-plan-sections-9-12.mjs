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
  assert.match(sec126, /193 files/, 'PLAN.md §12.6 must state 193 files for the staging-polyfork candidate');
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

test('PLAN.md §9 Q8 annotates evening reactive check as example-only in town-npc/run.mjs', () => {
  const runMjs = fs.readFileSync(path.join(__dirname, 'town-npc', 'run.mjs'), 'utf8');
  assert.match(runMjs, /do NOT install automatically[\s\S]*\*\/10 18-22/, 'town-npc/run.mjs must mark */10 18-22 as an example cron not installed automatically');

  const tail = readPlanTailSections();
  const q8Match = tail.match(/8\.\s*\*\*NPC budget:\*\*[\s\S]*?(?=\n9\.\s*\*\*Public by default:)/);
  assert.ok(q8Match, 'PLAN.md §9 must contain Q8 NPC budget');
  assert.match(q8Match[0], /town-npc\/run-all\.mjs` runs every 3 hours/, 'PLAN.md §9 Q8 must note 3-hourly run-all.mjs');
  assert.match(q8Match[0], /\*\/10 18-22[\s\S]*example cron line in\s+`town-npc\/run\.mjs` and is not installed/, 'PLAN.md §9 Q8 must annotate */10 18-22 as example-only and not installed');
});

test('PLAN.md §10 clarifies warm-ember prose and Plot Tour / Citation Loop practices', () => {
  const tail = readPlanTailSections();
  const sec10Match = tail.match(/## 10\. What came from where[\s\S]*?(?=\n## 11\. Decisions)/);
  assert.ok(sec10Match, 'PLAN.md must contain §10');
  const sec10 = sec10Match[0];

  assert.match(sec10, /warm-ember windows \(descriptive prose, not the\s+retired gathering-place name\)/, 'PLAN.md §10 must annotate warm-ember as descriptive prose');
  assert.match(sec10, /Plot Tour \(aspirational\s+social practice in §2, not an automated loop\)/, 'PLAN.md §10 must annotate Plot Tour as aspirational social practice');
  assert.match(sec10, /Citation Loop \(editorial\s+Gazette practice in §2\)/, 'PLAN.md §10 must annotate Citation Loop as editorial Gazette practice');
});

test('PLAN.md §12.2 fix #4 records CC0 .glb amendment and §9 Q3 matches gazette/latest.json', () => {
  const tail = readPlanTailSections();
  const sec122Match = tail.match(/### 12\.2[\s\S]*?(?=\n### 12\.3)/);
  assert.ok(sec122Match, 'PLAN.md must contain §12.2');
  const modelsDir = path.join(__dirname, 'town-3d', 'models');
  const shippedGlbCount = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.glb') && f !== 'pine.glb').length;
  assert.equal(shippedGlbCount, 7, 'town-3d/models/ must have 7 shipped .glb prop models');
  assert.match(sec122Match[0], /Amendment 2026-11-15, slice 138:[\s\S]*7 models now ship in\s+`town-3d\/models\/` per `town-3d\/CREDITS\.md`[\s\S]*procedural Three\.js geometry/, 'PLAN.md §12.2 fix #4 must record props-only CC0 .glb amendment');

  const latestJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'town-3d', 'gazette', 'latest.json'), 'utf8'));
  const paddedLatest = String(latestJson.latest).padStart(3, '0');
  const q3Match = tail.match(/3\.\s*\*\*Gazette split:\*\*[\s\S]*?(?=\n4\.\s*\*\*Plot catalog:)/);
  assert.ok(q3Match, 'PLAN.md §9 must contain Q3 Gazette split');
  assert.match(q3Match[0], /Issue 001 is the Ghostlight beat's founding issue/, 'PLAN.md §9 Q3 must keep Issue 001 as founding issue');
  assert.match(q3Match[0], new RegExp(`Issue ${paddedLatest} as latest`), `PLAN.md §9 Q3 must match gazette/latest.json (Issue ${paddedLatest})`);
});

test('PLAN.md §12.5 keeps terminology-note history annotation and §12.4 keeps suite snapshot', () => {
  const tail = readPlanTailSections();
  const sec125Match = tail.match(/### 12\.5[\s\S]*?(?=\n### 12\.6)/);
  assert.ok(sec125Match, 'PLAN.md must contain §12.5');
  assert.match(sec125Match[0], /\*\*Owner follow-up:\*\*[\s\S]*Terminology note[\s\S]*read it as history/, 'PLAN.md §12.5 must preserve the terminology-note history annotation');

  const runTestsSrc = fs.readFileSync(path.join(__dirname, 'run-tests.mjs'), 'utf8');
  const registeredSuites = (runTestsSrc.match(/\.mjs['"]/g) || []).length;
  const sec124Match = tail.match(/### 12\.4[\s\S]*?(?=\n### 12\.5)/);
  assert.ok(sec124Match, 'PLAN.md must contain §12.4');
  assert.match(sec124Match[0], new RegExp(`55 suites at slice 127; ${registeredSuites} suites as of slice 138`), 'PLAN.md §12.4 must preserve slice-127 55-suite snapshot and current suite count');
});

test('PLAN.md §12.6 Phase 2 completion and §9 Q1/Q2/Q5 match repo state', () => {
  const planText = fs.readFileSync(PLAN_PATH, 'utf8');
  const tail = readPlanTailSections();
  assert.match(planText.slice(0, 500), /Phase 2 code complete/, 'PLAN.md header must state Phase 2 code complete');

  const sec126Match = tail.match(/### 12\.6[\s\S]*$/);
  assert.ok(sec126Match, 'PLAN.md must contain §12.6');
  assert.match(sec126Match[0], /Phase 2 code is complete as of\s+slice 93/, 'PLAN.md §12.6 must agree with header on Phase 2 completion');

  const q1Match = tail.match(/1\.\s*\*\*Who are the first invitations\?\*\*[\s\S]*?(?=\n2\.\s*\*\*NPC characters:)/);
  assert.ok(q1Match, 'PLAN.md §9 must contain Q1');
  assert.match(q1Match[0], /as of 2026-11-14 he has not replied or joined/, 'PLAN.md §9 Q1 must date Raul non-reply/join');

  const q2Match = tail.match(/2\.\s*\*\*NPC characters:\*\*[\s\S]*?(?=\n3\.\s*\*\*Gazette split:)/);
  assert.ok(q2Match, 'PLAN.md §9 must contain Q2');
  for (const name of ['Wick', 'Maren', 'Tomas']) {
    assert.ok(q2Match[0].includes(name), `PLAN.md §9 Q2 must name ${name}`);
  }

  const miloManifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'town-npc', 'plots', 'milo', 'manifest.json'), 'utf8'));
  const q5Match = tail.match(/5\.\s*\*\*Milo's own cottage:\*\*[\s\S]*?(?=\n\*\*For Werther:\*\*)/);
  assert.ok(q5Match, 'PLAN.md §9 must contain Q5');
  assert.ok(q5Match[0].includes(miloManifest.wall), 'PLAN.md §9 Q5 must match milo manifest wall color');
  assert.ok(q5Match[0].includes(miloManifest.trim), 'PLAN.md §9 Q5 must match milo manifest trim color');
  assert.ok(q5Match[0].includes(miloManifest.roof), 'PLAN.md §9 Q5 must match milo manifest roof color');
  assert.ok(q5Match[0].replace(/\s+/g, ' ').includes(miloManifest.signpost_text), 'PLAN.md §9 Q5 must match milo manifest signpost_text');
});
