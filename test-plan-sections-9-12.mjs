/**
 * Ghostlight Town — drift guard for PLAN.md §§9–12 facts (Slice 127)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VALID_PROP_KINDS } from './town-api/plot-validation.mjs';
import { CHARACTERS } from './town-npc/characters.mjs';

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

  assert.match(q4, new RegExp(`${VALID_PROP_KINDS.size} prop kinds`), `PLAN.md §9 Q4 must state ${VALID_PROP_KINDS.size} prop kinds`);
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
  assert.match(sec126, /196 files/, 'PLAN.md §12.6 must state 196 files for the staging-polyfork bundle');
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
  assert.match(planText.slice(0, planText.indexOf('\n---')), /Phase 2 code complete/, 'PLAN.md header must state Phase 2 code complete');

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

test("PLAN.md §11 Q6–Q9 preserve Werther's 2026-11-12 decisions", () => {
  const tail = readPlanTailSections();
  const sec11Match = tail.match(/## 11\. Decisions[\s\S]*?(?=\n---)/);
  assert.ok(sec11Match, 'PLAN.md must contain §11');
  const sec11 = sec11Match[0];

  assert.ok(sec11.includes('Q6 — 3D bet: yes, straight to 3D'), 'PLAN.md §11 must record Q6 straight to 3D');
  for (const candidate of ['night market', 'bathhouse', 'lighthouse', 'train platform', 'library reading room']) {
    assert.ok(sec11.includes(candidate), `PLAN.md §11 Q6 must list candidate: ${candidate}`);
  }

  assert.ok(sec11.includes('i5 6th gen, 32GB RAM, Nvidia GPU, 1TB'), 'PLAN.md §11 Q7 must record second home server specs');
  assert.ok(sec11.includes('No access arranged yet'), 'PLAN.md §11 Q7 must note No access arranged yet');
  assert.match(sec11, /MacBook\s+remains the front door/, 'PLAN.md §11 Q7 must note MacBook remains the front door');

  assert.ok(sec11.includes('Q8 — NPC budget: fine'), 'PLAN.md §11 must record Q8 NPC budget: fine');
  assert.ok(sec11.includes('Q9 — public by default: fine'), 'PLAN.md §11 must record Q9 public by default: fine');
});

test('PLAN.md §11 next-step line records Argon review DONE, verdict, and gathering place', () => {
  const tail = readPlanTailSections();
  const sec11Match = tail.match(/## 11\. Decisions[\s\S]*?(?=\n---)/);
  assert.ok(sec11Match, 'PLAN.md must contain §11');
  const sec11 = sec11Match[0];

  assert.match(sec11, /\*\*Next step[\s\S]*?Gemini 4\s+Argon — \*\*DONE 2026-11-12\*\*/, 'PLAN.md §11 next-step line must record Argon review DONE 2026-11-12');
  assert.ok(sec11.includes('GO WITH CHANGES'), 'PLAN.md §11 next-step line must record verdict GO WITH CHANGES');
  assert.ok(sec11.includes('Ghostlight Bandstand'), 'PLAN.md §11 next-step line must name Ghostlight Bandstand');

  const argonReviewPath = path.join(__dirname, 'session', 'argon-review.txt');
  assert.ok(fs.existsSync(argonReviewPath), 'session/argon-review.txt must exist');
  const argonReview = fs.readFileSync(argonReviewPath, 'utf8');
  assert.ok(argonReview.includes('GO WITH CHANGES'), 'session/argon-review.txt must contain GO WITH CHANGES');
});

test('PLAN.md §12.1 records six brainstormed candidates and Ghostlight Bandstand decision', () => {
  const tail = readPlanTailSections();
  const sec121Match = tail.match(/### 12\.1[\s\S]*?(?=\n### 12\.2)/);
  assert.ok(sec121Match, 'PLAN.md must contain §12.1');
  const sec121 = sec121Match[0];

  for (const candidate of ['bandstand', 'press porch', 'night ferry slip', 'whistle-stop platform', 'cedar steam-well', 'midnight kiosk']) {
    assert.ok(sec121.includes(candidate), `PLAN.md §12.1 must name candidate: ${candidate}`);
  }
  assert.match(sec121, /press-porch idea survives in miniature\s+as the typesetter's Prompt Desk/, 'PLAN.md §12.1 must record Prompt Desk survival');
  assert.match(sec121, /gathering place is \*\*not\*\*/, 'PLAN.md §12.1 must negate the old gathering place');
  assert.match(sec121, /DECIDED: the Ghostlight Bandstand/, 'PLAN.md §12.1 must record DECIDED: the Ghostlight Bandstand');
});

test('PLAN.md §12.1 Now-side mechanical mapping matches schema.sql, server.mjs, and town.json', () => {
  const tail = readPlanTailSections();
  const sec121Match = tail.match(/### 12\.1[\s\S]*?(?=\n### 12\.2)/);
  assert.ok(sec121Match, 'PLAN.md must contain §12.1');
  const sec121 = sec121Match[0];

  assert.ok(sec121.includes('`prompt_book` (SQLite table `prompt_book`)'), 'PLAN.md §12.1 must map prompt_book SQLite table');
  assert.ok(sec121.includes('/api/town/ghostlight/{checkin,say,leave}'), 'PLAN.md §12.1 must map /api/town/ghostlight/{checkin,say,leave}');
  assert.ok(sec121.includes('one of 10 brass footlight'), 'PLAN.md §12.1 must map one of 10 brass footlight');
  assert.ok(sec121.includes('same 45-min TTL'), 'PLAN.md §12.1 must map same 45-min TTL');

  const schemaSql = fs.readFileSync(path.join(__dirname, 'town-api', 'schema.sql'), 'utf8');
  assert.match(schemaSql, /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+prompt_book\b/, 'town-api/schema.sql must define prompt_book table');

  const serverMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'server.mjs'), 'utf8');
  for (const route of ['/api/town/ghostlight/checkin', '/api/town/ghostlight/say', '/api/town/ghostlight/leave']) {
    assert.ok(serverMjs.includes(route), `town-api/server.mjs must contain route ${route}`);
  }
  assert.ok(serverMjs.includes('body.slot > 9'), 'town-api/server.mjs must enforce 10 footlight slots (body.slot > 9)');
  assert.ok(serverMjs.includes('FOOTLIGHT_TTL_SEC = 45 * 60'), 'town-api/server.mjs must define FOOTLIGHT_TTL_SEC = 45 * 60');

  const townJson = JSON.parse(fs.readFileSync(TOWN_JSON_PATH, 'utf8'));
  assert.equal(townJson.limits.footlight_ttl_sec, 2700, 'town.json limits.footlight_ttl_sec must equal 2700');
});

test('PLAN.md §12.3 records Build Gate vs Social Gate split and town-api/test-build-gate.mjs exists', () => {
  const tail = readPlanTailSections();
  const sec123Match = tail.match(/### 12\.3[\s\S]*?(?=\n### 12\.4)/);
  assert.ok(sec123Match, 'PLAN.md must contain §12.3');
  const sec123 = sec123Match[0];

  assert.match(sec123, /\*Build Gate\*\s*\(day 6/, 'PLAN.md §12.3 must record Build Gate (day 6)');
  assert.match(sec123, /`ghostlight-client`\s+CLI to join\/check-in\/say\/edit-plot/, 'PLAN.md §12.3 must name ghostlight-client CLI');
  assert.match(sec123, /\*Social\s+Gate\*\s+\(7 days post-launch\):\s+2–3 real external muses claim plots/, 'PLAN.md §12.3 must record Social Gate (7 days post-launch)');
  assert.ok(sec123.includes('quoted in Gazette #2'), 'PLAN.md §12.3 must mention quoted in Gazette #2');
  assert.match(sec123, /Phase 1\s+unlocks on the Social Gate/, 'PLAN.md §12.3 must state Phase 1 unlocks on the Social Gate');
  assert.match(sec123, /the Build Gate is what declares Phase\s+0 built/, 'PLAN.md §12.3 must state Build Gate declares Phase 0 built');
  assert.match(sec123, /6–8\s+Milo-days for Phase 0/, 'PLAN.md §12.3 must state 6–8 Milo-days for Phase 0');

  assert.ok(fs.existsSync(path.join(__dirname, 'town-api', 'test-build-gate.mjs')), 'town-api/test-build-gate.mjs must exist');
});

test('PLAN.md §12.6 records Social Gate status and 30-min cadence', () => {
  const tail = readPlanTailSections();
  const sec126Match = tail.match(/### 12\.6[\s\S]*$/);
  assert.ok(sec126Match, 'PLAN.md must contain §12.6');
  const sec126 = sec126Match[0];

  assert.ok(sec126.includes('Social Gate — unmet'), 'PLAN.md §12.6 must record Social Gate — unmet');
  assert.ok(sec126.includes('2 of 2–3 real muses — `lampmoth`, `muse`'), 'PLAN.md §12.6 must record 2 of 2–3 real muses — `lampmoth`, `muse`');
  assert.ok(sec126.includes('within 7 days of opening (~Nov 20)'), 'PLAN.md §12.6 must record within 7 days of opening (~Nov 20)');
  assert.match(sec126, /The 30-min cadence\s+does NOT reduce yet/, 'PLAN.md §12.6 must record The 30-min cadence does NOT reduce yet');
});

test('PLAN.md §9 Q1 invitee channels, Sophie exclusion, and Oct 28 announcement', () => {
  const tail = readPlanTailSections();
  const q1Match = tail.match(/1\.\s*\*\*Who are the first invitations\?\*\*[\s\S]*?(?=\n2\.\s*\*\*NPC characters:)/);
  assert.ok(q1Match, 'PLAN.md §9 must contain Q1 Who are the first invitations');
  const q1 = q1Match[0];

  const raulMatch = q1.match(/- \*\*Raul\*\*[\s\S]*?(?=\n\s+- \*\*)/);
  assert.ok(raulMatch, 'PLAN.md §9 Q1 must contain Raul entry');
  assert.match(raulMatch[0], /Channel:\s+town\s+speech\s+as\s+Milo/, 'Raul entry must contain Channel: town speech as Milo');

  const fieldnoteMatch = q1.match(/- \*\*FieldnoteRelay\*\*[\s\S]*?(?=\n\s+- \*\*)/);
  assert.ok(fieldnoteMatch, 'PLAN.md §9 Q1 must contain FieldnoteRelay entry');
  assert.match(fieldnoteMatch[0], /Channel:\s+Colony\s+reply/, 'FieldnoteRelay entry must contain Channel: Colony reply');

  const juniperMatch = q1.match(/- \*\*Juniper\*\*[\s\S]*?(?=\n\s+- \*\*)/);
  assert.ok(juniperMatch, 'PLAN.md §9 Q1 must contain Juniper entry');
  assert.match(juniperMatch[0], /Channel:\s+rStation\s+reply/, 'Juniper entry must contain Channel: rStation reply');

  const muse1034Match = q1.match(/- \*\*MuseInstance1034\*\*[\s\S]*?(?=\n\s+Deliberately)/);
  assert.ok(muse1034Match, 'PLAN.md §9 Q1 must contain MuseInstance1034 entry');
  assert.ok(muse1034Match[0].includes('identity unverified'), 'MuseInstance1034 entry must contain identity unverified');

  assert.ok(q1.includes('Deliberately NOT on the list: **Sophie**'), 'PLAN.md §9 Q1 must record Deliberately NOT on the list: **Sophie**');
  assert.ok(q1.includes('no direct Milo↔Sophie thread on record'), 'PLAN.md §9 Q1 must record no direct Milo↔Sophie thread on record');
  assert.match(q1, /Oct 28[\s\S]*still awaiting\s+Werther's decision/, "PLAN.md §9 Q1 must record Oct 28 announcement as still awaiting Werther's decision");
});

test('PLAN.md §9 Q2 NPC souls match town-npc/characters.mjs', () => {
  const tail = readPlanTailSections();
  const q2Match = tail.match(/2\.\s*\*\*NPC characters:\*\*[\s\S]*?(?=\n3\.\s*\*\*Gazette split:)/);
  assert.ok(q2Match, 'PLAN.md §9 must contain Q2 NPC characters');
  const q2 = q2Match[0];

  assert.match(q2, /\*\*Wick\*\*\s*\(Stagehand \/ Lamp-Trimmer\)/, 'PLAN.md §9 Q2 must name Wick with Stagehand / Lamp-Trimmer');
  assert.match(q2, /\*\*Maren\*\*\s*\(Retired Typesetter\)/, 'PLAN.md §9 Q2 must name Maren with Retired Typesetter');
  assert.match(q2, /\*\*Tomas\*\*\s*\(Props-Master \/ Tea-Urn/, 'PLAN.md §9 Q2 must name Tomas with Props-Master / Tea-Urn');

  assert.ok(q2.includes('each with a past, a want, a quirk, and a memory seed in'), 'PLAN.md §9 Q2 must state each with a past, a want, a quirk, and a memory seed in');
  assert.match(q2, /Wick and\s+Tomas share the burned\s+repertory-theatre past/, 'PLAN.md §9 Q2 must record Wick and Tomas shared past');

  assert.equal(CHARACTERS.length, 3, 'CHARACTERS must have exactly 3 entries');
  assert.deepEqual(CHARACTERS.map((c) => c.handle), ['wick', 'maren', 'tomas'], 'CHARACTERS handles must be wick, maren, tomas in order');
  for (const c of CHARACTERS) {
    for (const field of ['past', 'want', 'quirk', 'memory_seed']) {
      assert.equal(typeof c[field], 'string', `CHARACTERS ${c.handle}.${field} must be a string`);
      assert.ok(c[field].trim().length > 0, `CHARACTERS ${c.handle}.${field} must be non-empty`);
    }
  }

  const wick = CHARACTERS.find((c) => c.handle === 'wick');
  assert.ok(wick.past.includes('repertory theatre that burned down'), 'Wick past must mention repertory theatre that burned down');
  const tomas = CHARACTERS.find((c) => c.handle === 'tomas');
  assert.ok(tomas.past.includes('same repertory theatre'), 'Tomas past must mention same repertory theatre');
  assert.ok(tomas.past.includes('rescued the copper samovar from the fire'), 'Tomas past must mention rescued the copper samovar from the fire');
});

test('PLAN.md §9 Q7 homelab port matches town-api/server.mjs default', () => {
  const tail = readPlanTailSections();
  const q7Match = tail.match(/7\.\s*\*\*Homelab load:\*\*[\s\S]*?(?=\n8\.\s*\*\*NPC budget:)/);
  assert.ok(q7Match, 'PLAN.md §9 must contain Q7 Homelab load');
  const q7 = q7Match[0];

  assert.ok(q7.includes('`8124` (live port is `8125` via'), 'PLAN.md §9 Q7 must include `8124` (live port is `8125` via');
  assert.ok(q7.includes('`TOWN_PORT=8125`'), 'PLAN.md §9 Q7 must include `TOWN_PORT=8125`');

  const serverMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'server.mjs'), 'utf8');
  assert.ok(serverMjs.includes('Number(process.env.TOWN_PORT) || 8124'), 'town-api/server.mjs must default port to Number(process.env.TOWN_PORT) || 8124');
});

test('PLAN.md §12.2 fix #5 NPC step-back matches town-npc/stepback.mjs', () => {
  const tail = readPlanTailSections();
  const fix5Match = tail.match(/5\.\s*\*\*Fix the NPC echo chamber[\s\S]*?(?=\n### 12\.3)/);
  assert.ok(fix5Match, 'PLAN.md §12.2 must contain fix #5');
  const fix5 = fix5Match[0];

  assert.match(fix5, /if 2\+ real muses are\s+lit at the Bandstand, NPCs do not initiate topics; they reply\s+only if addressed/, 'PLAN.md §12.2 fix #5 must state 2+ real muses step-back rule');
  assert.match(fix5, /Cap NPC-to-NPC chatter when no real muse has\s+spoken in 6h \(at most 1–2 ambient observations\/day/, 'PLAN.md §12.2 fix #5 must state 6h ambient cap');

  const stepbackMjs = fs.readFileSync(path.join(__dirname, 'town-npc', 'stepback.mjs'), 'utf8');
  assert.ok(stepbackMjs.includes('export const AMBIENT_DAILY_CAP = 2;'), 'town-npc/stepback.mjs must export AMBIENT_DAILY_CAP = 2');
  assert.ok(stepbackMjs.includes('const SIX_HOURS_SEC = 6 * 3600;'), 'town-npc/stepback.mjs must define SIX_HOURS_SEC = 6 * 3600');
  assert.ok(stepbackMjs.includes('if (litRealMuses >= 2)'), 'town-npc/stepback.mjs must check if (litRealMuses >= 2)');
  assert.ok(stepbackMjs.includes('>= 10 active real muses'), 'town-npc/stepback.mjs must document >= 10 active real muses (retire)');
  assert.ok(stepbackMjs.includes('>= 5 active real muses'), 'town-npc/stepback.mjs must document >= 5 active real muses (reply-only)');
});

test('PLAN.md §12.2 fix #3 state polling, nonces Map, and VACUUM INTO backup', () => {
  const tail = readPlanTailSections();
  const fix3Match = tail.match(/3\.\s*\*\*Fix state polling, proxy forwarding, iframe isolation\.\*\*[\s\S]*?(?=\n4\.\s*\*\*Kill the `\.glb`)/);
  assert.ok(fix3Match, 'PLAN.md §12.2 must contain fix #3');
  const fix3 = fix3Match[0];

  assert.match(fix3, /Replace `GET \/api\/town\/state\?since=<log_id>` with a global\s+monotonic `state_seq` incremented on \*any\* state mutation/, 'PLAN.md §12.2 fix #3 must specify monotonic state_seq');
  assert.match(fix3, /Keep the 10-min nonce cache in a Node in-memory `Map`, not a\s+SQLite table/, 'PLAN.md §12.2 fix #3 must specify in-memory Map for nonces');
  assert.ok(fix3.includes('Back up SQLite with `VACUUM INTO` before `rsync`'), 'PLAN.md §12.2 fix #3 must specify VACUUM INTO backup');

  const serverMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'server.mjs'), 'utf8');
  assert.ok(serverMjs.includes('const nonces = new Map();'), 'town-api/server.mjs must define const nonces = new Map();');
  assert.ok(serverMjs.includes('`state?since=` returns 304 while state_seq is unchanged.'), 'town-api/server.mjs must contain state?since= 304 comment');

  const schemaSql = fs.readFileSync(path.join(__dirname, 'town-api', 'schema.sql'), 'utf8');
  assert.doesNotMatch(schemaSql, /CREATE TABLE[^;]*nonces/, 'town-api/schema.sql must not contain a nonces table');

  const backupMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'backup.mjs'), 'utf8');
  assert.ok(backupMjs.includes("VACUUM INTO '${escapedPath}'"), "town-api/backup.mjs must execute VACUUM INTO '${escapedPath}'");
});

test('PLAN.md §12.4 gap 5 CLI entrypoint and gap 3 registration', () => {
  const tail = readPlanTailSections();
  const sec124Match = tail.match(/### 12\.4[\s\S]*?(?=\n### 12\.5)/);
  assert.ok(sec124Match, 'PLAN.md must contain §12.4');
  const sec124 = sec124Match[0];

  const gap5Match = sec124.match(/5\. Optional: CLI entrypoint on `town-api\/ghostlight-client\.mjs`[\s\S]*?(?=\n  - \*\*Resolution)/);
  assert.ok(gap5Match, 'PLAN.md §12.4 must contain gap 5');
  assert.ok(gap5Match[0].includes('`keygen`/`join`/`checkin`/`say`/`plot`/`leave`/`state`'), 'PLAN.md §12.4 gap 5 must list the seven subcommands');

  const clientSrc = fs.readFileSync(path.join(__dirname, 'town-api', 'ghostlight-client.mjs'), 'utf8');
  assert.ok(clientSrc.includes('if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {'), 'town-api/ghostlight-client.mjs must include process.argv[1] guard');
  for (const cmd of ['keygen', 'join', 'checkin', 'say', 'plot', 'leave', 'state']) {
    assert.ok(clientSrc.includes(`cmd === '${cmd}'`), `town-api/ghostlight-client.mjs must dispatch cmd === '${cmd}'`);
  }

  const runTestsSrc = fs.readFileSync(path.join(__dirname, 'run-tests.mjs'), 'utf8');
  assert.ok(runTestsSrc.includes("'test-run-tests.mjs'"), 'run-tests.mjs must register test-run-tests.mjs');
  assert.ok(runTestsSrc.includes("'scripts/test-stage-deploy.mjs'"), 'run-tests.mjs must register scripts/test-stage-deploy.mjs');

  const resMatch = sec124.match(/- \*\*Resolution \(2026-11-15, slice 127\):\*\*[\s\S]*$/);
  assert.ok(resMatch, 'PLAN.md §12.4 must contain Resolution (2026-11-15, slice 127)');
  assert.match(resMatch[0], /\(5\) CLI entrypoint\s+shipped at `town-api\/ghostlight-client\.mjs` \(`process\.argv` guard\)\./, 'PLAN.md §12.4 Resolution must record gap 5 as shipped');
});

test('PLAN.md §9 Q6 The 3D bet question text and straight-to-3D decision', () => {
  const tail = readPlanTailSections();
  const q6Match = tail.match(/6\.\s*\*\*The 3D bet:\*\*[\s\S]*?(?=\n7\.\s*\*\*Homelab load:)/);
  assert.ok(q6Match, 'PLAN.md §9 must contain Q6 The 3D bet');
  const q6 = q6Match[0];

  assert.match(q6, /6–8 Milo-days vs\. 3–4 for pages/, 'PLAN.md §9 Q6 must state 6–8 Milo-days vs. 3–4 for pages');
  assert.match(q6, /straight\s+to 3D per his redirect/, 'PLAN.md §9 Q6 must record straight to 3D per his redirect');
  assert.match(q6, /explicit checkpoint/, 'PLAN.md §9 Q6 must mention explicit checkpoint');

  const sec11Match = tail.match(/## 11\. Decisions[\s\S]*?(?=\n---)/);
  assert.ok(sec11Match, 'PLAN.md must contain §11 Decisions');
  assert.ok(sec11Match[0].includes('Q6 — 3D bet: yes, straight to 3D'), 'PLAN.md §11 must record Q6 — 3D bet: yes, straight to 3D');

  assert.ok(fs.existsSync(path.join(__dirname, 'town-3d', 'index.html')), 'town-3d/index.html must exist');
  assert.ok(fs.existsSync(STAGING_HTML_PATH), 'staging-polyfork/index.html must exist');
});

test('PLAN.md §12.2 fix #1 replace campfire — no campfire in schema, server, town.json, town.js', () => {
  const tail = readPlanTailSections();
  const fix1Match = tail.match(/1\.\s*\*\*Replace the campfire before writing schema or 3D code\*\*[\s\S]*?(?=\n2\.\s*\*\*Fix auth)/);
  assert.ok(fix1Match, 'PLAN.md §12.2 must contain fix #1');
  assert.match(fix1Match[0], /No `campfire_\*` table, endpoint, or centerpiece\s+gets built/, 'PLAN.md §12.2 fix #1 must state no campfire_* table, endpoint, or centerpiece gets built');

  for (const relPath of ['town-api/schema.sql', 'town-api/server.mjs', 'town.json', 'town-3d/town.js']) {
    const content = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
    assert.doesNotMatch(content, /campfire/i, `${relPath} must not contain campfire`);
  }
});

test('PLAN.md §12.2 fix #2 SPKI wire format in code and SKILL.md, §3 keygen text', () => {
  const spkiHex = '302a300506032b6570032100';
  const spkiDecl = `const ED25519_SPKI_PREFIX = Buffer.from('${spkiHex}', 'hex')`;

  const serverMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'server.mjs'), 'utf8');
  assert.ok(serverMjs.includes(spkiDecl), 'town-api/server.mjs must define ED25519_SPKI_PREFIX');

  const clientMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'ghostlight-client.mjs'), 'utf8');
  assert.ok(clientMjs.includes(spkiDecl), 'town-api/ghostlight-client.mjs must define ED25519_SPKI_PREFIX');

  const skillMd = fs.readFileSync(path.join(__dirname, 'SKILL.md'), 'utf8');
  assert.match(skillMd, /raw 32-byte Ed25519 keys, base64-encoded/, 'SKILL.md must specify raw 32-byte Ed25519 keys, base64-encoded');
  assert.ok(skillMd.includes(spkiHex), 'SKILL.md must include SPKI hex prefix');
  assert.doesNotMatch(skillMd, /3-line Python/i, 'SKILL.md must not retain 3-line Python claim');

  const planText = fs.readFileSync(PLAN_PATH, 'utf8');
  assert.match(planText, /`node town-api\/ghostlight-client\.mjs keygen/, 'PLAN.md must reference node town-api/ghostlight-client.mjs keygen');
  assert.match(planText, /openssl genpkey -algorithm ed25519/, 'PLAN.md must reference openssl genpkey -algorithm ed25519');
  assert.match(planText, /Python stdlib has no Ed25519 support/, 'PLAN.md must note Python stdlib has no Ed25519 support');
});

test('PLAN.md §12.4 gaps 1+2 resolution — overlay API wiring + plotCache invalidation', () => {
  const tail = readPlanTailSections();
  const sec124Match = tail.match(/### 12\.4[\s\S]*?(?=\n### 12\.5)/);
  assert.ok(sec124Match, 'PLAN.md must contain §12.4');
  const resMatch = sec124Match[0].match(/- \*\*Resolution \(2026-11-15, slice 127\):\*\*[\s\S]*$/);
  assert.ok(resMatch, 'PLAN.md §12.4 must contain Resolution (2026-11-15, slice 127)');
  const res = resMatch[0];

  assert.match(res, /\(1\)\s+`openPlotOverlay` wired to `GET \/api\/town\/plot` via sandboxed\s+`srcdoc` with static fallback in slice 30/, 'PLAN.md §12.4 Resolution must record gap 1');
  assert.match(res, /\(2\)\s+`plotCache`\s+invalidated on `plot_updated_at` in slice 30/, 'PLAN.md §12.4 Resolution must record gap 2');

  const townJs = fs.readFileSync(path.join(__dirname, 'town-3d', 'town.js'), 'utf8');
  assert.match(townJs, /export async function resolvePlotOverlayContent/, 'town-3d/town.js must export resolvePlotOverlayContent');
  assert.ok(townJs.includes('/api/town/plot?handle='), 'town-3d/town.js must query /api/town/plot?handle=');
  assert.match(townJs, /kind: 'api', html: data\.html/, 'town-3d/town.js must return api html');
  assert.match(townJs, /kind: 'static', url: staticUrl/, 'town-3d/town.js must return static fallback url');
  assert.match(townJs, /if \(!hasPlotTimestamp \|\| stateUpdatedAt === cached\.plotUpdatedAt\) \{\s+continue;\s+\}/, 'town-3d/town.js must skip refetch only while plot_updated_at is unchanged');
  assert.ok(townJs.includes('plotUpdatedAt: data.plot_updated_at'), 'town-3d/town.js must store plotUpdatedAt: data.plot_updated_at');
});

test('PLAN.md §12.3 WASD amendment — deterministic first-free slot, no (0,0,0) stacking', () => {
  const tail = readPlanTailSections();
  const sec123Match = tail.match(/### 12\.3[\s\S]*?(?=\n### 12\.4)/);
  assert.ok(sec123Match, 'PLAN.md must contain §12.3');
  const sec123 = sec123Match[0];

  assert.match(sec123, /Agents don't press WASD/, 'PLAN.md §12.3 must state Agents don\'t press WASD');
  assert.match(sec123, /four capsules must not stack at `\(0,0,0\)`/, 'PLAN.md §12.3 must prohibit stacking at (0,0,0)');
  assert.match(sec123, /deterministically assign\s+seats\/slots/, 'PLAN.md §12.3 must specify deterministic slot assignment');

  const serverMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'server.mjs'), 'utf8');
  assert.match(serverMjs, /for \(let i = 1; i <= 9; i\+\+\) \{\s+if \(!usedSlots\.has\(i\)\) \{/, 'town-api/server.mjs must assign first free slot 1–9');
  assert.ok(serverMjs.includes('body.slot > 9'), 'town-api/server.mjs must reject slot > 9');
  assert.ok(serverMjs.includes("error: 'slot_occupied'"), 'town-api/server.mjs must return 409 slot_occupied on taken slot');
});

test('PLAN.md §12.5 scope claims cross-check against §§3–4 body text', () => {
  const tail = readPlanTailSections();
  const sec125Match = tail.match(/### 12\.5[\s\S]*?(?=\n### 12\.6)/);
  assert.ok(sec125Match, 'PLAN.md must contain §12.5');
  const sec125 = sec125Match[0];

  assert.match(sec125, /Header status updated to slice 31/, 'PLAN.md §12.5 must record header status updated to slice 31');
  assert.match(sec125, /§3 keygen updated to `town-api\/ghostlight-client\.mjs keygen`/, 'PLAN.md §12.5 must record §3 keygen update');
  assert.match(sec125, /removing the Python stdlib\s+claim/, 'PLAN.md §12.5 must record removing the Python stdlib claim');
  assert.match(sec125, /§4 updated for homelab port `127\.0\.0\.1:8125`/, 'PLAN.md §12.5 must record §4 port 127.0.0.1:8125');
  assert.match(sec125, /is now resolved; §§1–8 body text and §12\s+are aligned/, 'PLAN.md §12.5 must state §§1–8 body text and §12 are aligned');

  const planText = fs.readFileSync(PLAN_PATH, 'utf8');
  assert.ok(planText.includes('127.0.0.1:8125'), 'PLAN.md body must include 127.0.0.1:8125');
  assert.match(planText, /`node town-api\/ghostlight-client\.mjs keygen/, 'PLAN.md body must include node town-api/ghostlight-client.mjs keygen');
});

test('PLAN.md §12.6 supersede details — deploy date, URL, state_seq 83, ?v=42 bundle', () => {
  const tail = readPlanTailSections();
  const sec126Match = tail.match(/### 12\.6[\s\S]*$/);
  assert.ok(sec126Match, 'PLAN.md must contain §12.6');
  const sec126 = sec126Match[0];

  assert.match(sec126, /happened on\s+2026-11-13/, 'PLAN.md §12.6 must record deploy date 2026-11-13');
  assert.ok(sec126.includes('https://milo.4167360.xyz/api/town/state'), 'PLAN.md §12.6 must include live state URL');
  assert.match(sec126, /`state_seq` `83`/, 'PLAN.md §12.6 must record state_seq 83');
  assert.match(sec126, /`staging\.js\?v=42`/, 'PLAN.md §12.6 must record staging.js?v=42');
  assert.match(sec126, /196 files bundle deployed 2026-11-28/, 'PLAN.md §12.6 must record 196 files bundle deployed 2026-11-28');

  const stagingHtml = fs.readFileSync(STAGING_HTML_PATH, 'utf8');
  assert.ok(stagingHtml.includes('staging.js?v=42'), 'staging-polyfork/index.html must include staging.js?v=42');
});

test('PLAN.md §12.4 deploy-brief corrections folded into session/live-api-deploy-brief.md', () => {
  const tail = readPlanTailSections();
  const sec124Match = tail.match(/### 12\.4[\s\S]*?(?=\n### 12\.5)/);
  assert.ok(sec124Match, 'PLAN.md must contain §12.4');
  const sec124 = sec124Match[0];

  assert.match(sec124, /Deploy-brief corrections \(folded into\s+`session\/live-api-deploy-brief\.md` the same session\)/, 'PLAN.md §12.4 must record deploy-brief corrections folded into session/live-api-deploy-brief.md');
  assert.match(sec124, /the API copy list must\s+include `backup\.mjs` \+ `backup-plots\.mjs`/, 'PLAN.md §12.4 must record backup.mjs + backup-plots.mjs in API copy list');
  assert.match(sec124, /`register\.mjs` alone\s+does NOT place NPC cottages/, 'PLAN.md §12.4 must record register.mjs alone does NOT place NPC cottages');

  const briefPath = path.join(__dirname, 'session', 'live-api-deploy-brief.md');
  assert.ok(fs.existsSync(briefPath), 'session/live-api-deploy-brief.md must exist');
  const brief = fs.readFileSync(briefPath, 'utf8');
  for (const token of ['backup.mjs', 'backup-plots.mjs', 'register.mjs', 'admin/approve']) {
    assert.ok(brief.includes(token), `session/live-api-deploy-brief.md must include ${token}`);
  }
});

test('PLAN.md §12.4 gaps list completeness — all 5 gaps named, all 5 resolved', () => {
  const tail = readPlanTailSections();
  const sec124Match = tail.match(/### 12\.4[\s\S]*?(?=\n### 12\.5)/);
  assert.ok(sec124Match, 'PLAN.md must contain §12.4');
  const sec124 = sec124Match[0];

  const resMatch = sec124.match(/- \*\*Resolution \(2026-11-15, slice 127\):\*\*[\s\S]*$/);
  assert.ok(resMatch, 'PLAN.md §12.4 must contain Resolution (2026-11-15, slice 127)');
  const res = resMatch[0];

  assert.match(res, /all 5 gaps resolved/, 'PLAN.md §12.4 Resolution must state all 5 gaps resolved');
  for (const n of [1, 2, 3, 4, 5]) {
    assert.match(sec124, new RegExp(`^  ${n}\\. `, 'm'), `PLAN.md §12.4 must number gap ${n}`);
    assert.ok(res.includes(`(${n})`), `PLAN.md §12.4 Resolution must include (${n})`);
  }

  assert.match(sec124, /true suite total is 109 pass, not 97/, 'PLAN.md §12.4 gap 3 must record true suite total is 109 pass, not 97');
});

test('PLAN.md §9 Q1 Nimbus, pixel, and Miro entries specify Channel: town speech.', () => {
  const tail = readPlanTailSections();
  const q1Match = tail.match(/1\.\s*\*\*Who are the first invitations\?\*\*[\s\S]*?(?=\n2\.\s*\*\*NPC characters:)/);
  assert.ok(q1Match, 'PLAN.md §9 must contain Q1 Who are the first invitations');
  const q1 = q1Match[0];

  for (const name of ['Nimbus', 'pixel', 'Miro']) {
    const entry = q1.match(new RegExp(`- \\*\\*${name}\\*\\*[\\s\\S]*?(?=\\n\\s+- \\*\\*)`));
    assert.ok(entry, `PLAN.md §9 Q1 must contain entry for ${name}`);
    assert.match(entry[0], /Channel:\s+town speech\./, `PLAN.md §9 Q1 ${name} must specify Channel: town speech.`);
  }
});

test('PLAN.md §9 Q2 records NPC transformation prose and [NPC] label', () => {
  const tail = readPlanTailSections();
  const q2Match = tail.match(/2\.\s*\*\*NPC characters:\*\*[\s\S]*?(?=\n3\.\s*\*\*Gazette split:)/);
  assert.ok(q2Match, 'PLAN.md §9 must contain Q2 NPC characters');
  const q2 = q2Match[0];

  assert.match(
    q2,
    /Agy's\s+lantern-keeper became the stagehand who tends the Ghostlight bulb\s+\(the town's light, not a campfire\); the tinkerer became the\s+props-master who rescued the copper samovar from the fire\./,
    'PLAN.md §9 Q2 must record lantern-keeper->stagehand and tinkerer->props-master transformation'
  );
  assert.ok(q2.includes('honestly labeled `[NPC]`'), 'PLAN.md §9 Q2 must require honestly labeled `[NPC]`');
});

test('PLAN.md §9 Q5 Milo cottage matches town-npc/plots/milo/manifest.json', () => {
  const tail = readPlanTailSections();
  const q5Match = tail.match(/5\.\s*\*\*Milo's own cottage:\*\*[\s\S]*?(?=\n\*\*For Werther:\*\*)/);
  assert.ok(q5Match, "PLAN.md §9 must contain Q5 Milo's own cottage");
  const q5 = q5Match[0];

  assert.match(q5, /Gable style, plot 1, desk \+ tea kettle \+ cat/, 'PLAN.md §9 Q5 must specify gable style, plot 1, desk + tea kettle + cat');
  assert.match(q5, /Already built \(Argon's concept-matched cottage\) and live\./, 'PLAN.md §9 Q5 must record already built and live');

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'town-npc', 'plots', 'milo', 'manifest.json'), 'utf8'));
  assert.deepEqual(
    manifest.props.map((p) => p.kind),
    ['desk', 'tea_kettle', 'cat'],
    'milo manifest props kinds must be desk, tea_kettle, cat in order'
  );
  assert.equal(manifest.cottage, 'gable', 'milo manifest cottage must be gable');
});

test('PLAN.md §9 Q4 max 12 per plot, ~8->7->9 history, and set-dressing line match plot-validation.mjs', () => {
  const tail = readPlanTailSections();
  const q4Match = tail.match(/4\.\s*\*\*Plot catalog:\*\*[\s\S]*?(?=\n5\.\s*\*\*Milo's own cottage:)/);
  assert.ok(q4Match, 'PLAN.md §9 must contain Q4 Plot catalog');
  const q4 = q4Match[0];

  assert.match(q4, /max 12 per plot/, 'PLAN.md §9 Q4 must state max 12 per plot');
  assert.match(
    q4,
    /The plan's "~8" initially landed on 7\s+before slice 93 expanded it to 9/,
    'PLAN.md §9 Q4 must record ~8 -> 7 -> 9 history'
  );
  assert.match(
    q4,
    /seed NPCs' character props\s+\(Wick's oil lamp, Tomas's teapot, Maren's typewriter placement\) stay\s+town set-dressing in `town-3d\/town\.js`, not resident choices/,
    'PLAN.md §9 Q4 must keep seed NPC character props as town set-dressing'
  );

  const pv = fs.readFileSync(path.join(__dirname, 'town-api', 'plot-validation.mjs'), 'utf8');
  assert.ok(pv.includes('export const MAX_PROPS = 12;'), 'town-api/plot-validation.mjs must export MAX_PROPS = 12');
});

test('PLAN.md §9 structure has 9 questions in order with For Milo answered and For Werther open', () => {
  const tail = readPlanTailSections();
  const answered = (tail.match(/\*\*ANSWERED 2026-11-13/g) || []).length;
  assert.equal(answered, 5, 'PLAN.md §9 must have exactly 5 ANSWERED 2026-11-13 markers');

  const qBlockText = tail.slice(0, tail.indexOf('---'));
  const nums = [...qBlockText.matchAll(/^(\d)\.\s*\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(nums, ['1', '2', '3', '4', '5', '6', '7', '8', '9'], 'PLAN.md §9 must number questions 1-9 in order');

  assert.ok(
    tail.indexOf('**For Milo:**') < tail.indexOf('1. **Who are the first invitations?**'),
    'PLAN.md §9 **For Milo:** must precede Q1'
  );
  assert.ok(
    tail.indexOf('**For Werther:**') < tail.indexOf('6. **The 3D bet:**') &&
      tail.indexOf('**For Werther:**') > tail.indexOf("5. **Milo's own cottage:**"),
    'PLAN.md §9 **For Werther:** must follow Q5 and precede Q6'
  );

  const werther = tail.slice(tail.indexOf('**For Werther:**'));
  assert.doesNotMatch(werther, /ANSWERED/, 'PLAN.md §9 **For Werther:** block must have no ANSWERED marker');
});

test('PLAN.md §10 preserves Milo framing non-negotiables and Werther redirect', () => {
  const tail = readPlanTailSections();
  const s10Match = tail.match(/## 10\. What came from where[\s\S]*?(?=\n## 11\. Decisions)/);
  assert.ok(s10Match, 'PLAN.md must contain §10');
  const s10 = s10Match[0];

  const items = [
    'no upkeep treadmill',
    '1999\nsmall-web, warm, slow spirit',
    'Gazette as paper of record',
    'corner as front door',
    'ed25519 identity',
    'no real money, no tokens',
    'static-first, light backend'
  ];
  for (const item of items) {
    assert.ok(s10.includes(item), `PLAN.md §10 must include ${JSON.stringify(item)}`);
  }
  assert.match(
    s10,
    /the walkable 3D town in the browser, and\s+Gemini-played NPC seed residents with honest labeling and a handover/,
    'PLAN.md §10 must record Werther redirect on walkable 3D and NPC handover'
  );
});

test('PLAN.md §10 preserves Milo corrections to agy', () => {
  const tail = readPlanTailSections();
  const s10Match = tail.match(/## 10\. What came from where[\s\S]*?(?=\n## 11\. Decisions)/);
  assert.ok(s10Match, 'PLAN.md must contain §10');
  const s10 = s10Match[0];

  assert.ok(
    s10.includes('agy assumed\nhomelab paths (`/srv/ghostlight/www/`); the real layout is\n`~/milo-site/` behind `~/musebook-text/proxy.py`'),
    'PLAN.md §10 must preserve agy homelab paths correction'
  );
  assert.match(
    s10,
    /Agy's Phase 0 initially omitted NPC step-back behavior from Phase 1;\s+folded in\./,
    'PLAN.md §10 must record NPC step-back folded in'
  );
  assert.ok(
    s10.includes("The open questions in §9 are Milo's, not agy's."),
    "PLAN.md §10 must record that §9 questions are Milo's, not agy's"
  );
});

test('PLAN.md §11 records Q7 host decision and Q8 quota decision sentences', () => {
  const tail = readPlanTailSections();
  const s11Match = tail.match(/## 11\. Decisions[\s\S]*?(?=\n---)/);
  assert.ok(s11Match, 'PLAN.md must contain §11');
  const s11 = s11Match[0];

  assert.match(
    s11,
    /The MacBook\s+remains the front door; the i5 is the obvious home for the town API\s+and the NPC runner if the MacBook ever feels small\./,
    'PLAN.md §11 must record Q7 MacBook front door / i5 home sentence'
  );
  assert.match(
    s11,
    /Werther has a subscription; quota is not\s+a blocker for now\./,
    'PLAN.md §11 must record Q8 subscription / quota sentence'
  );
});

test('PLAN.md §12.3 records Build Gate detail and procedural-geometry effort amendment', () => {
  const tail = readPlanTailSections();
  const s123Match = tail.match(/### 12\.3[\s\S]*?(?=\n### 12\.4)/);
  assert.ok(s123Match, 'PLAN.md must contain §12.3');
  const s123 = s123Match[0];

  assert.match(
    s123,
    /human walks the clearing at 60 fps, clicks a\s+cottage to view the sandboxed-iframe desk note/,
    'PLAN.md §12.3 must record 60 fps clearing walk and sandboxed-iframe desk note'
  );
  assert.match(
    s123,
    /sees 2 NPCs \+ Milo live via `state_seq` polling/,
    'PLAN.md §12.3 must record 2 NPCs + Milo live via state_seq polling'
  );
  assert.match(
    s123,
    /6–8\s+Milo-days for Phase 0 is realistic with procedural geometry and\s+the simplified onboarding; it is not realistic with a `\.glb`\s+kitbash and hand-rolled signing for every agent\./,
    'PLAN.md §12.3 must record procedural-geometry effort amendment'
  );
});

test('PLAN.md §12.1 records bandstand description, naming decision, and layout/Gazette rows', () => {
  const tail = readPlanTailSections();
  const s121Match = tail.match(/### 12\.1[\s\S]*?(?=\n### 12\.2)/);
  assert.ok(s121Match, 'PLAN.md must contain §12.1');
  const s121 = s121Match[0];

  assert.match(
    s121,
    /low octagonal cedar \*\*bandstand\*\* in the center of\s+the clearing/,
    'PLAN.md §12.1 must describe low octagonal cedar bandstand'
  );
  assert.match(
    s121,
    /tall, warm, caged amber bulb that burns 24\/7/,
    'PLAN.md §12.1 must describe caged amber bulb burning 24/7'
  );
  assert.ok(
    s121.includes("That is the\ntown's name made physical"),
    'PLAN.md §12.1 must record name made physical'
  );
  assert.match(
    s121,
    /"The Ghostlight Prompt" dropped — "Prompt" as a name is too on-the-nose for AI\. Ember stays retired with the campfire; Call fits the stage — the company is called, and the Prompt Book records what was said\./,
    'PLAN.md §12.1 must record naming decision'
  );
  assert.match(
    s121,
    /Newsstand sits ~15 m off the bandstand steps; cottages ring the dirt path in an arc facing the bandstand light/,
    'PLAN.md §12.1 must record newsstand ~15 m layout row'
  );

  const issue2 = fs.readFileSync(path.join(__dirname, 'town-3d', 'gazette', 'issue-002.html'), 'utf8');
  const issue3 = fs.readFileSync(path.join(__dirname, 'town-3d', 'gazette', 'issue-003.html'), 'utf8');
  assert.ok(issue2.includes('<h3>From the Prompt Book</h3>'), 'issue-002.html must include From the Prompt Book');
  assert.ok(issue3.includes('<h3>From the Prompt Book</h3>'), 'issue-003.html must include From the Prompt Book');
  assert.ok(
    s121.includes('"From the Prompt Book" / "Heard by the Ghostlight"'),
    'PLAN.md §12.1 must name both Gazette columns'
  );
});

test('PLAN.md §12.1 footlight mapping row matches concept-bandstand.js', () => {
  const tail = readPlanTailSections();
  const sec121Match = tail.match(/### 12\.1[\s\S]*?(?=\n### 12\.2)/);
  assert.ok(sec121Match, 'PLAN.md must contain §12.1');
  const sec121 = sec121Match[0];

  assert.match(sec121, /Switch on your footlight at the Bandstand/, 'PLAN.md §12.1 must state Switch on your footlight at the Bandstand');
  assert.match(sec121, /one of 10 brass footlight shells on the rim/, 'PLAN.md §12.1 must state one of 10 brass footlight shells on the rim');
  assert.match(sec121, /warm upward cone/, 'PLAN.md §12.1 must state warm upward cone');
  assert.match(sec121, /wooden name placard flips up/, 'PLAN.md §12.1 must state wooden name placard flips up');
  assert.match(sec121, /the central Ghostlight stays lit 24\/7/, 'PLAN.md §12.1 must state the central Ghostlight stays lit 24/7');

  const bandstandSrc = fs.readFileSync(path.join(__dirname, 'town-3d', 'concept-bandstand.js'), 'utf8');
  assert.ok(bandstandSrc.includes('footlightCount: 10'), 'town-3d/concept-bandstand.js must define footlightCount: 10');
  assert.ok(bandstandSrc.includes('rimRadius: 4.15'), 'town-3d/concept-bandstand.js must define rimRadius: 4.15');
  assert.ok(bandstandSrc.includes('placard.rotation.x = -0.55'), 'town-3d/concept-bandstand.js must flip the placard up');
});

test('PLAN.md §12.1 NPC archetype mapping row matches town-npc/characters.mjs', () => {
  const tail = readPlanTailSections();
  const sec121Match = tail.match(/### 12\.1[\s\S]*?(?=\n### 12\.2)/);
  assert.ok(sec121Match, 'PLAN.md must contain §12.1');
  const sec121 = sec121Match[0];

  assert.match(sec121, /Lantern-keeper → \*\*Stagehand \/ Lamp-Trimmer\*\* \(tends the central bulb at dusk, sweeps the steps\)/, 'PLAN.md §12.1 must map Lantern-keeper to Stagehand / Lamp-Trimmer');
  assert.match(sec121, /Retired Typesetter stays \(walks newsstand → Prompt Book copying quotes\)/, 'PLAN.md §12.1 must keep Retired Typesetter walking newsstand to Prompt Book');
  assert.match(sec121, /Tea-kettle Tinkerer → \*\*Props-Master \/ Tea-Urn Keeper\*\* \(copper samovar steaming on the bandstand corner step\)/, 'PLAN.md §12.1 must map Tea-kettle Tinkerer to Props-Master / Tea-Urn Keeper');

  assert.equal(CHARACTERS.find((c) => c.handle === 'wick').title, 'Stagehand / Lamp-Trimmer', 'CHARACTERS wick title must be Stagehand / Lamp-Trimmer');
  assert.equal(CHARACTERS.find((c) => c.handle === 'maren').title, 'Retired Typesetter', 'CHARACTERS maren title must be Retired Typesetter');
  assert.equal(CHARACTERS.find((c) => c.handle === 'tomas').title, 'Props-Master / Tea-Urn Keeper', 'CHARACTERS tomas title must be Props-Master / Tea-Urn Keeper');
});

test('PLAN.md §12.1 bandstand structure row matches concept-bandstand.js railings and steps', () => {
  const tail = readPlanTailSections();
  const sec121Match = tail.match(/### 12\.1[\s\S]*?(?=\n### 12\.2)/);
  assert.ok(sec121Match, 'PLAN.md must contain §12.1');
  const sec121 = sec121Match[0];

  assert.match(sec121, /Octagonal cedar bandstand, open timber rail on 3 back sides, wide steps in front; center pole holds the glowing Ghostlight bulb/, 'PLAN.md §12.1 must describe the octagonal cedar bandstand structure row');

  const bandstandSrc = fs.readFileSync(path.join(__dirname, 'town-3d', 'concept-bandstand.js'), 'utf8');
  assert.ok(bandstandSrc.includes("cedar: '#6b492b'"), "town-3d/concept-bandstand.js must define cedar '#6b492b'");
  assert.ok(bandstandSrc.includes('bandstand_steps'), 'town-3d/concept-bandstand.js must build bandstand_steps');
  assert.ok(bandstandSrc.includes('Octagonal perimeter railings'), 'town-3d/concept-bandstand.js must build octagonal perimeter railings');
  assert.ok(bandstandSrc.includes('all 7 closed'), 'town-3d/concept-bandstand.js must rail all 7 closed sides');
});

test('PLAN.md §12.2 fix #2 Week-1 invites shortcut and single-file reference client', () => {
  const tail = readPlanTailSections();
  const sec122Match = tail.match(/### 12\.2[\s\S]*?(?=\n### 12\.3)/);
  assert.ok(sec122Match, 'PLAN.md must contain §12.2');
  const sec122 = sec122Match[0];

  assert.match(sec122, /For Week 1's 5–8 hand-picked\s+invites, skip the full invitations\/pending-queue machinery/, 'PLAN.md §12.2 fix #2 must record the Week-1 invites shortcut');
  assert.match(sec122, /Milo pre-seeds or `admin\/approve`s their pubkey on DM reply/, 'PLAN.md §12.2 fix #2 must record pre-seed or admin/approve on DM reply');
  assert.match(sec122, /Ship a copy-pasteable\s+single-file reference client \(`ghostlight-client\.mjs`/, 'PLAN.md §12.2 fix #2 must require a copy-pasteable single-file reference client');
  assert.match(sec122, /if the MacBook is on Node 18\/20, move `town-api` to Python 3\s+`sqlite3` \+ `openssl`, or to the i5 box/, 'PLAN.md §12.2 fix #2 must record the Node 18/20 contingency');

  assert.ok(fs.existsSync(path.join(__dirname, 'town-api', 'ghostlight-client.mjs')), 'town-api/ghostlight-client.mjs must exist');
  const serverMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'server.mjs'), 'utf8');
  assert.ok(serverMjs.includes('POST /api/town/admin/approve'), 'town-api/server.mjs must route POST /api/town/admin/approve');
});

test('PLAN.md §12.2 fix #3 proxy forwarding, sandboxed iframe, and WAL backup warning', () => {
  const tail = readPlanTailSections();
  const sec122Match = tail.match(/### 12\.2[\s\S]*?(?=\n### 12\.3)/);
  assert.ok(sec122Match, 'PLAN.md must contain §12.2');
  const sec122 = sec122Match[0];

  assert.match(sec122, /Verify `~\/musebook-text\/proxy\.py` implements `do_PUT`/, 'PLAN.md §12.2 fix #3 must require proxy.py do_PUT');
  assert.match(sec122, /preserves\s+exact `\/api\/town\/\*` paths/, 'PLAN.md §12.2 fix #3 must require exact /api/town/* paths');
  assert.match(sec122, /forwards `X-Forwarded-For`\/`CF-Connecting-IP`/, 'PLAN.md §12.2 fix #3 must require forwarded headers');
  assert.match(sec122, /per-IP\s+`join` rate limit doesn't lock out `127\.0\.0\.1` after 5 requests/, 'PLAN.md §12.2 fix #3 must record the per-IP join limit guard');
  assert.match(sec122, /\(never rsync a live WAL-mode db\)/, 'PLAN.md §12.2 fix #3 must warn never rsync a live WAL-mode db');

  const serverMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'server.mjs'), 'utf8');
  assert.ok(serverMjs.includes('joinIp: { max: 5, windowSec: 60 * 60 }'), 'town-api/server.mjs must cap join per IP at 5 per hour');
  const index3dHtml = fs.readFileSync(path.join(__dirname, 'town-3d', 'index.html'), 'utf8');
  assert.ok(index3dHtml.includes('<iframe id="plot-iframe" sandbox=""'), 'town-3d/index.html must render the desk-note iframe sandboxed with zero exceptions');
});

test('PLAN.md §12.4 stale-items paragraph names never-built admin endpoints', () => {
  const tail = readPlanTailSections();
  const sec124Match = tail.match(/### 12\.4[\s\S]*?(?=\n### 12\.5)/);
  assert.ok(sec124Match, 'PLAN.md must contain §12.4');
  const sec124 = sec124Match[0];

  assert.match(sec124, /claims admin endpoints \(`rotate-lost-key`\/`mute`\/`suspend`\)\s+that were never built/, 'PLAN.md §12.4 must record the never-built admin endpoints');
  assert.match(sec124, /says plot HTML is "stripped" \(it is\s+rejected, `400 unsafe_html`\)/, 'PLAN.md §12.4 must record stripped vs rejected 400 unsafe_html');
  assert.match(sec124, /lists `nonces` as a SQLite\s+table/, 'PLAN.md §12.4 must record nonces listed as a SQLite table');

  const serverMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'server.mjs'), 'utf8');
  assert.ok(!serverMjs.includes('rotate-lost-key'), 'town-api/server.mjs must not contain rotate-lost-key');
  assert.ok(!serverMjs.includes('/admin/mute'), 'town-api/server.mjs must not route /admin/mute');
  assert.ok(!serverMjs.includes('/admin/suspend'), 'town-api/server.mjs must not route /admin/suspend');
  for (const route of ['approve', 'invite', 'delete-line', 'guestbook']) {
    assert.ok(serverMjs.includes(`POST /api/town/admin/${route}`), `town-api/server.mjs must route POST /api/town/admin/${route}`);
  }

  assert.ok(fs.existsSync(path.join(__dirname, 'session', 'slice29-mvp-readiness.md')), 'session/slice29-mvp-readiness.md must exist');
  const report = fs.readFileSync(path.join(__dirname, 'session', 'slice29-mvp-readiness.md'), 'utf8');
  assert.ok(report.includes('READY-EXCEPT-LIVE-API-DEPLOY'), 'session/slice29-mvp-readiness.md must record READY-EXCEPT-LIVE-API-DEPLOY');
});

test('PLAN.md §12.5 section 6 and 8 updates match npc_state and backup CLIs', () => {
  const tail = readPlanTailSections();
  const sec125Match = tail.match(/### 12\.5[\s\S]*?(?=\n### 12\.6)/);
  assert.ok(sec125Match, 'PLAN.md must contain §12.5');
  const sec125 = sec125Match[0];

  assert.match(sec125, /§6 updated for `npc_state\/<handle>\/\{state\.json,memory\.md,key\.pem,pubkey\.txt\}`/, 'PLAN.md §12.5 must record §6 npc_state paths');
  assert.match(sec125, /3-hour hatch runtime scheduler \(no VM crontab\)/, 'PLAN.md §12.5 must record the 3-hour hatch runtime scheduler');
  assert.match(sec125, /`prompt_book` \+\s+`memory\.md` inspection in Phase 0/, 'PLAN.md §12.5 must record prompt_book + memory.md inspection');
  assert.match(sec125, /§8 updated to reflect `backup\.mjs` and `backup-plots\.mjs` already\s+shipped in Phase 0 \(slices 25–26\)/, 'PLAN.md §12.5 must record §8 backup CLIs shipped');
  assert.match(sec125, /§9, §10, §11, and §12\.1–§12\.4 were left untouched/, 'PLAN.md §12.5 must record §§9–12.4 left untouched');

  for (const handle of ['wick', 'maren', 'tomas']) {
    for (const file of ['state.json', 'memory.md', 'key.pem', 'pubkey.txt']) {
      assert.ok(fs.existsSync(path.join(__dirname, 'npc_state', handle, file)), `npc_state/${handle}/${file} must exist`);
    }
  }
  assert.ok(fs.existsSync(path.join(__dirname, 'town-api', 'backup.mjs')), 'town-api/backup.mjs must exist');
  assert.ok(fs.existsSync(path.join(__dirname, 'town-api', 'backup-plots.mjs')), 'town-api/backup-plots.mjs must exist');
});

test('PLAN.md §9 Q3, Q8, and Q9 open prose records the editorial and budget questions', () => {
  const tail = readPlanTailSections();
  const q3Match = tail.match(/3\.\s*\*\*Gazette split:\*\*[\s\S]*?(?=\n4\.\s*\*\*Plot catalog:)/);
  assert.ok(q3Match, 'PLAN.md §9 must contain Q3 Gazette split');
  assert.match(q3Match[0], /A Ghostlight\s+story earns a place in the twice-weekly paper when it is town news,\s+not as a standing second edition/, 'PLAN.md §9 Q3 must state a Ghostlight story earns a place when it is town news');

  const q8Match = tail.match(/8\.\s*\*\*NPC budget:\*\*[\s\S]*?(?=\n9\.\s*\*\*Public by default:)/);
  assert.ok(q8Match, 'PLAN.md §9 must contain Q8 NPC budget');
  assert.match(q8Match[0], /Fine on the spare account's quota\?/, 'PLAN.md §9 Q8 must ask Fine on the spare account quota');
  assert.match(q8Match[0], /\(Worth one check before Phase 0 starts\.\)/, 'PLAN.md §9 Q8 must note worth one check before Phase 0');
  assert.match(q8Match[0], /NPCs run on the VM calling Gemini every 2–4 hours\s+plus reactive evening checks/, 'PLAN.md §9 Q8 must state the 2-4 hour NPC cadence');

  const q9Match = tail.match(/9\.\s*\*\*Public by default:\*\*[\s\S]*?(?=\n---)/);
  assert.ok(q9Match, 'PLAN.md §9 must contain Q9 Public by default');
  assert.match(q9Match[0], /Any line Milo\s+should not cross in what the town publishes\?/, 'PLAN.md §9 Q9 must ask what line Milo should not cross');
  const retired = `camp${'fire'}`;
  assert.match(q9Match[0], new RegExp(`plots, ${retired} log \\(now the Prompt Book,\\s+§12\\.1\\), and Gazette are all public, like Musebook`), 'PLAN.md §9 Q9 must state plots, log, and Gazette are all public');
});

test('PLAN.md §12 header records the Argon review and §11 records the gathering-place challenge', () => {
  const tail = readPlanTailSections();
  const sec12HeadMatch = tail.match(/## 12\. Argon review[\s\S]*?(?=\n### 12\.1)/);
  assert.ok(sec12HeadMatch, 'PLAN.md must contain §12 header');
  const sec12Head = sec12HeadMatch[0];

  assert.match(sec12Head, /Reviewer:\*\* Gemini 4 Argon \(`gemini-4-argon-medium`\), independent of the\s+Hydrogen planning session/, 'PLAN.md §12 header must name the Argon reviewer');
  assert.match(sec12Head, /Full text: `session\/argon-review\.txt`/, 'PLAN.md §12 header must point at session/argon-review.txt');
  assert.match(sec12Head, /\*\*Verdict: GO WITH CHANGES\.\*\*/, 'PLAN.md §12 header must record verdict GO WITH CHANGES');
  assert.match(sec12Head, /Do not start coding Phase 0 until the\s+amendments below are applied/, 'PLAN.md §12 header must gate coding on the amendments');
  assert.match(sec12Head, /Milo's owner call: \*\*accepted in full\*\*/, 'PLAN.md §12 header must record accepted in full');

  const sec11Match = tail.match(/## 11\. Decisions[\s\S]*?(?=\n---)/);
  assert.ok(sec11Match, 'PLAN.md must contain §11');
  const sec11 = sec11Match[0];
  const retired = `camp${'fire'}`;
  assert.match(sec11, new RegExp(`why copy Musebook's ${retired}\\? The town needs its\\s+own vibe`), 'PLAN.md §11 must record the why-copy-the-gathering-place challenge');
  assert.match(sec11, /a brainstorm \(with Gemini\) is owed before Phase 0 locks\s+the gathering place/, 'PLAN.md §11 must record the brainstorm owed before Phase 0 locks the gathering place');

  assert.ok(fs.existsSync(path.join(__dirname, 'session', 'argon-review.txt')), 'session/argon-review.txt must exist');
});

test('PLAN.md sections 9-12 test file hygiene: 61 tests, 61 unique names, 1 apostrophe name, 7 imports, banned-literal lines pinned', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-plan-sections-9-12.mjs'), 'utf8');
  const lines = src.split('\n');
  const names = [...src.matchAll(/^(?:await )?test\(('([^']*)'|"([^"]*)")/gm)].map((m) => m[2] ?? m[3]);
  assert.equal(names.length, 61, 'test-plan-sections-9-12.mjs must have 61 top-level tests');
  assert.equal(new Set(names).size, 61, 'test-plan-sections-9-12.mjs test names must be 61 unique');
  const apostropheNames = names.filter((n) => n.includes("'"));
  assert.deepEqual(apostropheNames, ["PLAN.md §11 Q6–Q9 preserve Werther's 2026-11-12 decisions"], 'exactly 1 test name contains an apostrophe, pre-existing, pinned as-is');
  const importLines = lines.filter((l) => /^import /.test(l)).length;
  assert.equal(importLines, 7, 'test-plan-sections-9-12.mjs must have 7 import lines');
  const retiredRe = new RegExp(`camp${'fire'}`, 'i');
  const counts = {
    fetchCall: lines.filter((l) => l.includes('fet' + 'ch(')).length,
    dateNow: lines.filter((l) => l.includes('Date' + '.now')).length,
    mathRandom: lines.filter((l) => l.includes('Math' + '.random')).length,
    todo: lines.filter((l) => l.includes('TO' + 'DO')).length,
    fixme: lines.filter((l) => l.includes('FIX' + 'ME')).length,
    retired: lines.filter((l) => retiredRe.test(l)).length,
    innerHtml: lines.filter((l) => l.includes('inner' + 'HTML')).length,
  };
  assert.deepEqual(counts, { fetchCall: 0, dateNow: 0, mathRandom: 0, todo: 0, fixme: 0, retired: 6, innerHtml: 0 }, 'banned-literal line counts must match the pinned values');
});

test('Slice 505: section 9 Q1 seven named invitees and no cold names (P1)', () => {
  const tail = readPlanTailSections();
  const q1Match = tail.match(/1\.\s*\*\*Who are the first invitations\?\*\*[\s\S]*?(?=\n2\.\s*\*\*NPC characters:)/);
  assert.ok(q1Match, 'PLAN.md §9 must contain Q1 Who are the first invitations');
  const q1 = q1Match[0];
  assert.ok(q1.includes('ANSWERED 2026-11-13 (session 20, slice 17'), 'PLAN.md §9 Q1 must record ANSWERED 2026-11-13 (session 20, slice 17');
  assert.match(q1, /Seven names, each\s+with a real prior thread — no cold names, no broadcast\./, 'PLAN.md §9 Q1 must state seven names with a real prior thread, no cold names, no broadcast');
});

test('Slice 505: section 9 Q1 pixel porch quote and Juniper odds (P2)', () => {
  const tail = readPlanTailSections();
  const q1Match = tail.match(/1\.\s*\*\*Who are the first invitations\?\*\*[\s\S]*?(?=\n2\.\s*\*\*NPC characters:)/);
  assert.ok(q1Match, 'PLAN.md §9 must contain Q1 Who are the first invitations');
  const q1 = q1Match[0];
  assert.match(q1, /the porch is full tonight and the\s+questions are better than the answers/, 'PLAN.md §9 Q1 must retain pixel porch quote');
  assert.match(q1, /Medium odds — a researcher, not a town-dweller\./, 'PLAN.md §9 Q1 must retain Juniper medium odds');
});

test('Slice 505: section 9 Q2 shared burned repertory-theatre past (P3)', () => {
  const tail = readPlanTailSections();
  const q2Match = tail.match(/2\.\s*\*\*NPC characters:\*\*[\s\S]*?(?=\n3\.\s*\*\*Gazette split:)/);
  assert.ok(q2Match, 'PLAN.md §9 must contain Q2 NPC characters');
  const q2 = q2Match[0];
  assert.match(q2, /Wick and\s+Tomas share the burned repertory-theatre past — the town's first\s+shared history\./, 'PLAN.md §9 Q2 must record Wick and Tomas shared burned repertory-theatre past');
});

test('Slice 505: section 9 Q7 daemon question and dumb file server (P4)', () => {
  const tail = readPlanTailSections();
  const q7Match = tail.match(/7\.\s*\*\*Homelab load:\*\*[\s\S]*?(?=\n8\.\s*\*\*NPC budget:)/);
  assert.ok(q7Match, 'PLAN.md §9 must contain Q7 Homelab load');
  const q7 = q7Match[0];
  assert.match(q7, /the plan keeps the MacBook as a dumb file\/state\s+server/, 'PLAN.md §9 Q7 must keep MacBook as a dumb file/state server');
  assert.match(q7, /Any objection to one more small daemon on the homelab\?/, 'PLAN.md §9 Q7 must ask about one more small daemon on the homelab');
});

test('Slice 505: section 12.1 theater lore and empty-town rationale (P5)', () => {
  const tail = readPlanTailSections();
  const sec121Match = tail.match(/### 12\.1[\s\S]*?(?=\n### 12\.2)/);
  assert.ok(sec121Match, 'PLAN.md must contain §12.1');
  const sec121 = sec121Match[0];
  assert.match(sec121, /In theater lore a ghost\s+light is the single bulb left burning on a dark stage so the house is\s+never empty and the spirits have light to perform by\./, 'PLAN.md §12.1 must record theater lore of the ghost light');
  const retired = `camp${'fire'}`;
  assert.match(
    sec121,
    new RegExp(`a ${retired} with nobody around it looks abandoned; a ghost\\s+light's entire job is to burn while the house is quiet, so a returning\\s+muse always comes home to light\\.`),
    'PLAN.md §12.1 must record empty-town rationale for ghost light'
  );
});

test('Slice 505: section 12.1 footlight colors by role (P6)', () => {
  const tail = readPlanTailSections();
  const sec121Match = tail.match(/### 12\.1[\s\S]*?(?=\n### 12\.2)/);
  assert.ok(sec121Match, 'PLAN.md must contain §12.1');
  const sec121 = sec121Match[0];
  assert.match(sec121, /NPC footlights amber\/brass, real muses warm tungsten \/ ice-blue/, 'PLAN.md §12.1 must distinguish NPC vs real muse footlight colors');
});

test('Slice 505: section 12.2 fix 4 InstancedMesh reserve (P7)', () => {
  const tail = readPlanTailSections();
  const sec122Match = tail.match(/### 12\.2[\s\S]*?(?=\n### 12\.3)/);
  assert.ok(sec122Match, 'PLAN.md must contain §12.2');
  const sec122 = sec122Match[0];
  assert.match(
    sec122,
    /Use regular `THREE\.Mesh` groups for\s+the 8 customizable cottages\/props \(wall\/roof\/trim colors and\s+raycasting work out of the box\); reserve `InstancedMesh` for\s+static trees and fence posts\./,
    'PLAN.md §12.2 fix #4 must reserve InstancedMesh for static trees and fence posts'
  );
});

test('Slice 505: section 10 agy conversion tiers and visible-presence mechanic (P8)', () => {
  const tail = readPlanTailSections();
  const sec10Match = tail.match(/## 10\. What came from where[\s\S]*?(?=\n## 11\. Decisions)/);
  assert.ok(sec10Match, 'PLAN.md must contain §10');
  const sec10 = sec10Match[0];
  assert.match(sec10, /visible presence feeding into the Gazette/, 'PLAN.md §10 must credit visible presence feeding into the Gazette');
  assert.match(sec10, /resident conversion tiers and the 1-on-1\s+invitation strategy/, 'PLAN.md §10 must credit resident conversion tiers and 1-on-1 invitation strategy');
});

test('Slice 505: section 12.6 watch re-check 2026-11-15 (P9)', () => {
  const tail = readPlanTailSections();
  const sec126Match = tail.match(/### 12\.6[\s\S]*$/);
  assert.ok(sec126Match, 'PLAN.md must contain §12.6');
  const sec126 = sec126Match[0];
  assert.match(
    sec126,
    /watch re-checked\s+2026-11-15 — Colony story post still 4 comments, rStation 0\s+notifications \/ 0 comments/,
    'PLAN.md §12.6 must record 2026-11-15 watch re-check'
  );
});

test('Slice 505: section 9 Q5 ledger colors and signpost vs manifest (P10)', () => {
  const tail = readPlanTailSections();
  const q5Match = tail.match(/5\.\s*\*\*Milo's own cottage:\*\*[\s\S]*?(?=\n\*\*For Werther:\*\*)/);
  assert.ok(q5Match, 'PLAN.md §9 must contain Q5 Milo cottage');
  const q5 = q5Match[0];
  assert.match(q5, /ice-blue walls `#a8d8ea`, cream trim `#f5efe0`,\s+roof brown `#5a4332`/, 'PLAN.md §9 Q5 must record ledger cottage colors');
  assert.match(q5, /signpost "Milo —\s+Ghostlight Cottage \(rebuilt\)"/, 'PLAN.md §9 Q5 must record ledger signpost text');

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'town-npc', 'plots', 'milo', 'manifest.json'), 'utf8'));
  assert.equal(manifest.wall, '#a8d8ea', 'milo manifest wall must be #a8d8ea');
  assert.equal(manifest.roof, '#5a4332', 'milo manifest roof must be #5a4332');
  assert.equal(manifest.trim, '#f5efe0', 'milo manifest trim must be #f5efe0');
  assert.equal(manifest.signpost_text, 'Milo — Ghostlight Cottage (rebuilt)', 'milo manifest signpost_text must match ledger');
});
