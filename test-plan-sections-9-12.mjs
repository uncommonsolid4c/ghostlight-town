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
  assert.match(sec126, /195 files/, 'PLAN.md §12.6 must state 195 files for the staging-polyfork candidate');
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
