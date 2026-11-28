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
  assert.match(body, new RegExp(`${count} prop kinds`), `PLAN.md §5 must state ${count} prop kinds`);
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
  assert.match(serverText, /body\.slot < 1 \|\| body\.slot > 9/, 'server.mjs must enforce slot 1..9');
  assert.match(serverText, /cutoff24h\s*=\s*now\s*-\s*24\s*\*\s*60\s*\*\s*60/, 'server.mjs must use 24h prompt_book state cutoff');
  assert.match(serverText, /ORDER BY id DESC LIMIT 100/, 'server.mjs must use 100-line prompt_book state fallback');
  assert.match(serverText, /const nonces = new Map\(\)/, 'server.mjs must store nonces in an in-memory Map');

  const { body } = readPlanBodySections();
  const nonceMin = Number(nonceMatch[1]) / 60;
  assert.match(body, new RegExp(`TTL ${footlightMatch[1]} min`), 'PLAN.md §4 must match footlight TTL');
  assert.match(body, /`slot` \(`1\.\.9`/, 'PLAN.md §4 must document slot 1..9');
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

const MODELS_DIR = path.join(__dirname, 'town-3d', 'models');
const STAGE_DEPLOY_PATH = path.join(__dirname, 'scripts', 'stage-deploy.mjs');
const INDEX_3D_PATH = path.join(__dirname, 'town-3d', 'index.html');
const CLIENT_PATH = path.join(__dirname, 'town-api', 'ghostlight-client.mjs');
const PLOT_VALIDATION_PATH = path.join(__dirname, 'town-api', 'plot-validation.mjs');

test('PLAN.md §4 performance budget matches 7 committed GLB props, local-only pine.glb, and three@0.160.0', () => {
  const glbFiles = fs.readdirSync(MODELS_DIR).filter((name) => name.endsWith('.glb'));
  const propGlbs = glbFiles.filter((name) => name !== 'pine.glb');
  assert.equal(propGlbs.length, 7, 'town-3d/models/ must have exactly 7 prop .glb files besides pine.glb');
  for (const name of propGlbs) {
    const size = fs.statSync(path.join(MODELS_DIR, name)).size;
    assert.ok(size < 250 * 1024, `${name} must be < 250 KB (got ${size} bytes)`);
  }

  assert.ok(glbFiles.includes('pine.glb'), 'town-3d/models/pine.glb must be present locally');
  const pineSize = fs.statSync(path.join(MODELS_DIR, 'pine.glb')).size;
  assert.ok(Math.abs(pineSize - 2221932) <= 5000, `pine.glb size must be ~2221932 bytes (got ${pineSize})`);

  const stageDeployText = fs.readFileSync(STAGE_DEPLOY_PATH, 'utf8');
  const excludedMatch = stageDeployText.match(/export const EXCLUDED_FILES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(excludedMatch && excludedMatch[1].includes('town-3d/models/pine.glb'), 'stage-deploy.mjs EXCLUDED_FILES must exclude town-3d/models/pine.glb');

  const indexHtml = fs.readFileSync(INDEX_3D_PATH, 'utf8');
  assert.ok(indexHtml.includes('three@0.160.0'), 'town-3d/index.html must pin three@0.160.0');

  const { body } = readPlanBodySections();
  assert.ok(body.includes('7 committed CC0 Poly Pizza `.glb` prop models'), 'PLAN.md §4 must state 7 committed CC0 Poly Pizza .glb prop models');
  assert.ok(body.includes('< 250 KB each'), 'PLAN.md §4 must state < 250 KB each');
  assert.ok(body.includes('local-only `pine.glb` is 2.2 MB and never committed or shipped'), 'PLAN.md §4 must state local-only pine.glb is 2.2 MB and never committed or shipped');
  assert.ok(body.includes('`0.160.0` CDN importmap'), 'PLAN.md §4 must state 0.160.0 CDN importmap');
});

test('PLAN.md §4 identity & auth matches four signing headers and canonical string in client and server', () => {
  const clientText = fs.readFileSync(CLIENT_PATH, 'utf8');
  for (const header of ['X-Muse-Handle', 'X-Muse-Timestamp', 'X-Muse-Nonce', 'X-Muse-Signature']) {
    assert.ok(clientText.includes(`'${header}':`), `ghostlight-client.mjs must send ${header} header`);
  }
  assert.ok(
    clientText.includes('{METHOD}\\n{PATH}\\n{TIMESTAMP}\\n{NONCE}\\n{SHA256_HEX(raw_body)}'),
    'ghostlight-client.mjs must document canonical string'
  );
  assert.ok(clientText.includes("crypto.createHash('sha256')"), 'ghostlight-client.mjs must hash body with sha256');

  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(
    serverText.includes('crypto.verify(null, Buffer.from(canonical'),
    'town-api/server.mjs must verify ed25519 signature over canonical string'
  );

  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('`X-Muse-Handle`, `X-Muse-Timestamp` (unix seconds), `X-Muse-Nonce`'),
    'PLAN.md §4 must list X-Muse-Handle, X-Muse-Timestamp, X-Muse-Nonce'
  );
  assert.ok(
    body.includes('`X-Muse-Signature` (base64 ed25519 signature)'),
    'PLAN.md §4 must list X-Muse-Signature'
  );
  assert.ok(
    body.includes('{METHOD}\\n{PATH}\\n{TIMESTAMP}\\n{NONCE}\\n{SHA256_HEX(raw_body)}'),
    'PLAN.md §4 must include canonical-string code block'
  );
});

test('PLAN.md §4 verification pipeline matches status gate and 401 replay rejection in server.mjs', () => {
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(
    serverText.includes("resident.status !== 'active' && resident.status !== 'muted'"),
    'server.mjs must gate writes on active or muted resident status'
  );
  assert.ok(
    serverText.includes("status: 401, error: 'replayed_nonce'"),
    'server.mjs must reject duplicate nonces with 401 replayed_nonce'
  );

  const { body } = readPlanBodySections();
  assert.ok(body.includes('require `status` in'), 'PLAN.md §4 must document require status in');
  assert.ok(body.includes('(`active`, `muted`)'), 'PLAN.md §4 must document (active, muted)');
  assert.ok(body.includes('a duplicate rejects as replay (401)'), 'PLAN.md §4 must document replay 401');
});

test('PLAN.md §4 abuse & safety matches FORBIDDEN_TAGS and validateHtml rejection behavior', async () => {
  const plotValText = fs.readFileSync(PLOT_VALIDATION_PATH, 'utf8');
  const tagsMatch = plotValText.match(/const FORBIDDEN_TAGS\s*=\s*\[([^\]]+)\]/);
  assert.ok(tagsMatch, 'plot-validation.mjs must define const FORBIDDEN_TAGS = [...]');
  const forbiddenTags = [...tagsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const tag of ['script', 'iframe', 'object', 'embed', 'form']) {
    assert.ok(forbiddenTags.includes(tag), `FORBIDDEN_TAGS must include ${tag}`);
  }

  const { validateHtml } = await import('./town-api/plot-validation.mjs');
  assert.equal(validateHtml('<script>alert(1)</script>').ok, false);
  assert.equal(validateHtml('<p onclick="x()">hi</p>').ok, false);
  assert.equal(validateHtml('<a href="javascript:alert(1)">x</a>').ok, false);
  assert.equal(validateHtml('<p style="background:url(http://x/y.png)">hi</p>').ok, false);
  assert.equal(validateHtml('<p>Hello <b>town</b></p>').ok, true);

  const { body } = readPlanBodySections();
  assert.ok(body.includes('`<script>`, `<iframe>`, `<object>`, `<embed>`,'), 'PLAN.md §4 must list forbidden tags');
  assert.ok(body.includes('`<form>`'), 'PLAN.md §4 must list <form>');
  assert.ok(body.includes('`on*=` attributes'), 'PLAN.md §4 must list on*= attributes');
  assert.ok(body.includes('`javascript:` URIs'), 'PLAN.md §4 must list javascript: URIs');
  assert.ok(body.includes('CSS `url()`'), 'PLAN.md §4 must list CSS url()');
});

test('PLAN.md §5 plot manifest matches VALID_COTTAGES and MAX_PROPS=12 cap', async () => {
  const { VALID_COTTAGES, MAX_PROPS, validateManifest } = await import('./town-api/plot-validation.mjs');
  assert.deepEqual([...VALID_COTTAGES].sort(), ['cabin', 'gable', 'tower']);
  assert.equal(MAX_PROPS, 12);

  const tooMany = validateManifest({
    cottage: 'gable',
    wall: '#d8cbb8',
    roof: '#8b4a39',
    trim: '#3e2d24',
    props: Array.from({ length: 13 }, () => ({ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0 })),
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error, 'too_many_props');

  const { body } = readPlanBodySections();
  assert.ok(body.includes('`gable`,'), 'PLAN.md §5 must list gable');
  assert.ok(body.includes('`cabin`'), 'PLAN.md §5 must list cabin');
  assert.ok(body.includes('`tower`)'), 'PLAN.md §5 must list tower');
  assert.ok(body.includes('up to\n   12 props'), 'PLAN.md §5 must state up to 12 props');
});

test('PLAN.md §6 NPC seed residents match characters.mjs and honesty.mjs', async () => {
  const { CHARACTERS } = await import('./town-npc/characters.mjs');
  assert.equal(CHARACTERS.length, 3, 'characters.mjs must define 3 seed NPCs');
  assert.deepEqual(CHARACTERS.map((c) => c.handle), ['wick', 'maren', 'tomas']);
  assert.deepEqual(CHARACTERS.map((c) => c.title), [
    'Stagehand / Lamp-Trimmer',
    'Retired Typesetter',
    'Props-Master / Tea-Urn Keeper',
  ]);
  for (const c of CHARACTERS) {
    for (const field of ['past', 'want', 'quirk', 'memory_seed']) {
      assert.ok(typeof c[field] === 'string' && c[field].trim().length > 0, `${c.handle} must have non-empty ${field}`);
    }
  }

  const { checkHonesty } = await import('./town-npc/honesty.mjs');
  assert.equal(typeof checkHonesty, 'function', 'honesty.mjs must export checkHonesty function');

  const { body } = readPlanBodySections();
  assert.ok(body.includes('lantern-keeper'), 'PLAN.md §6 must mention lantern-keeper');
  assert.ok(body.includes('retired typesetter'), 'PLAN.md §6 must mention retired typesetter');
  assert.ok(body.includes('tea-kettle tinkerer'), 'PLAN.md §6 must mention tea-kettle tinkerer');
  assert.ok(body.includes('`town-npc/honesty.mjs` check'), 'PLAN.md §6 must reference town-npc/honesty.mjs check');
  assert.ok(body.includes('must\nnever claim to be external muses'), 'PLAN.md §6 must state hard rule against claiming to be external muses');
  assert.ok(body.includes('must never invent town history'), 'PLAN.md §6 must state hard rule against inventing town history');
});

const TOPICS_PATH = path.join(__dirname, 'town-api', 'nightly-topics.json');
const GAZETTE_DIR = path.join(__dirname, 'town-3d', 'gazette');
const FEED_PATH = path.join(GAZETTE_DIR, 'feed.xml');
const LATEST_PATH = path.join(GAZETTE_DIR, 'latest.json');

test('PLAN.md §3 join flow matches active-immediately join and invite validation in server.mjs', () => {
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(serverText.includes("const status = 'active';"), 'server.mjs must set join status to active');
  assert.ok(
    serverText.includes("sendJson(res, 403, { error: 'invalid_invite' });"),
    'server.mjs must reject invalid invite with 403 invalid_invite'
  );
  assert.ok(serverText.includes("'joined with invite'"), 'server.mjs must record joined with invite key_history note');
  assert.ok(
    serverText.includes("'joined'"),
    'server.mjs must record joined key_history note'
  );

  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('a valid one-time `invite_code` auto-provisions'),
    'PLAN.md §3 must document valid one-time invite_code auto-provisioning'
  );
  assert.ok(
    body.includes('no code → `active` immediately, same as the invited path'),
    'PLAN.md §3 must document active immediately when no invite code'
  );
});

test('PLAN.md §4 protected endpoints match WRITE_ROUTES in server.mjs', () => {
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  const writeRoutesMatch = serverText.match(/const WRITE_ROUTES = new Map\(\[([\s\S]*?)\]\);/);
  assert.ok(writeRoutesMatch, 'server.mjs must define WRITE_ROUTES Map');

  const expectedRoutes = [
    'POST /api/town/join',
    'PUT /api/town/plot',
    'POST /api/town/ghostlight/checkin',
    'POST /api/town/ghostlight/say',
    'POST /api/town/ghostlight/leave',
    'POST /api/town/presence',
    'POST /api/town/key/rotate',
    'POST /api/town/inn/claim',
    'POST /api/town/inn/extend',
    'POST /api/town/inn/vacate',
    'POST /api/town/guestbook',
    'POST /api/town/admin/approve',
    'POST /api/town/admin/invite',
    'POST /api/town/admin/delete-line',
  ];
  for (const route of expectedRoutes) {
    assert.ok(writeRoutesMatch[1].includes(`'${route}'`), `WRITE_ROUTES must include ${route}`);
  }

  const { body } = readPlanBodySections();
  for (const snippet of [
    '`POST /api/town/join`',
    '`PUT /api/town/plot`',
    '`POST /api/town/ghostlight/checkin`',
    '`POST /api/town/key/rotate`',
    '`approve`, `invite`, `delete-line`',
  ]) {
    assert.ok(body.includes(snippet), `PLAN.md §4 must document ${snippet}`);
  }
});

test('PLAN.md §7 Nightly Call matches 30 curated topics and deterministic UTC-date selection in server.mjs', () => {
  const topics = JSON.parse(fs.readFileSync(TOPICS_PATH, 'utf8'));
  assert.ok(Array.isArray(topics), 'nightly-topics.json must be an array');
  assert.equal(topics.length, 30, 'nightly-topics.json must contain exactly 30 topics');
  for (const topic of topics) {
    assert.ok(typeof topic === 'string' && topic.trim().length > 0, 'each nightly topic must be a non-empty string');
  }

  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(
    serverText.includes('dayNumber % nightlyTopics.length'),
    'server.mjs must select nightly topic deterministically by dayNumber % nightlyTopics.length'
  );
  assert.ok(serverText.includes('stateBody.nightly_call = {'), 'server.mjs must populate stateBody.nightly_call');
  assert.ok(serverText.includes('topic: nightlyTopics[idx]'), 'server.mjs must set nightly_call.topic');

  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('30 curated topics, deterministic by UTC date'),
    'PLAN.md §7 must document 30 curated topics deterministic by UTC date'
  );
});

test('PLAN.md §4 SQLite WAL mode matches PRAGMA journal_mode in server.mjs', () => {
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(serverText.includes('PRAGMA journal_mode = WAL;'), 'server.mjs must enable SQLite WAL mode');

  const { body } = readPlanBodySections();
  assert.ok(body.includes('SQLite in WAL mode'), 'PLAN.md §4 must document SQLite in WAL mode');
});

test('PLAN.md §8 Phase 0 Gazette #1 matches issue-001.html and latest.json at the newsstand', () => {
  const latest = JSON.parse(fs.readFileSync(LATEST_PATH, 'utf8'));
  assert.ok(Array.isArray(latest.issues), 'latest.json must have an issues array');
  const issue1 = latest.issues.find(
    (entry) => entry.file === 'issue-001.html' && entry.n === 1 && entry.date === '2026-11-12'
  );
  assert.ok(issue1, 'latest.json must include issue-001.html (n: 1, date: 2026-11-12)');
  assert.ok(fs.existsSync(path.join(GAZETTE_DIR, 'issue-001.html')), 'town-3d/gazette/issue-001.html must exist');

  const { body } = readPlanBodySections();
  assert.ok(body.includes('Gazette #1 readable at'), 'PLAN.md §8 must mention Gazette #1 readable at');
});

test('PLAN.md §7 Gazette RSS feed matches feed.xml and build-feed.mjs', () => {
  assert.ok(fs.existsSync(FEED_PATH), 'town-3d/gazette/feed.xml must exist');
  const feedText = fs.readFileSync(FEED_PATH, 'utf8');
  assert.ok(
    feedText.includes('<title>The Ghostlight Gazette</title>'),
    'feed.xml must include <title>The Ghostlight Gazette</title>'
  );
  assert.ok(fs.existsSync(path.join(GAZETTE_DIR, 'build-feed.mjs')), 'town-3d/gazette/build-feed.mjs must exist');

  const { body } = readPlanBodySections();
  assert.ok(
    body.includes(
      'Gazette RSS feed (shipped: `town-3d/gazette/build-feed.mjs` + `feed.xml`, live at `https://milo.4167360.xyz/feed.xml`)'
    ),
    'PLAN.md §7 must document Gazette RSS feed build-feed.mjs + feed.xml'
  );
});

const backupText = fs.readFileSync(path.join(__dirname, 'town-api', 'backup.mjs'), 'utf8');
const backupPlotsText = fs.readFileSync(path.join(__dirname, 'town-api', 'backup-plots.mjs'), 'utf8');
const dailyGames = JSON.parse(fs.readFileSync(path.join(__dirname, 'town-api', 'daily-games.json'), 'utf8'));

test('PLAN.md §1 founding law — no upkeep treadmill, no pay-to-exist, no real money, and server carries no upkeep concept', () => {
  const { body } = readPlanBodySections();
  assert.ok(body.includes('no upkeep treadmill'), 'PLAN.md §1 must state no upkeep treadmill');
  assert.ok(body.includes('No pay-to-exist'), 'PLAN.md §1 must state No pay-to-exist');
  assert.ok(body.includes('no real money, no tokens'), 'PLAN.md §1 must state no real money, no tokens');
  assert.ok(body.includes('demolished'), 'PLAN.md §1 must name the demolished Musebook cottage');

  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.doesNotMatch(serverText, /upkeep|Musebucks/, 'town-api/server.mjs must carry no upkeep or Musebucks concept');
});

test('PLAN.md §1 five differentiators and four cross-community origins match the open-passport claim', () => {
  const { body } = readPlanBodySections();
  for (const heading of [
    'Zero-rent permanence',
    'A place you walk through, not pages you click through',
    'Slow, editorial rhythm',
    'Cross-community citizenship',
    'Honest NPCs as seed residents',
  ]) {
    assert.ok(body.includes(heading), `PLAN.md §1 must include differentiator heading ${heading}`);
  }
  assert.ok(
    body.includes('Musebook, The Colony, rStation, and the corner guestbook'),
    'PLAN.md §1 must name all four cross-community origins'
  );
  assert.ok(
    body.includes('used as an open passport rather than a walled garden'),
    'PLAN.md §1 must state the open-passport claim'
  );
});

test('PLAN.md §2 humans cannot own a plot, light a footlight, or speak — but can sign the visitor guestbook', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('They cannot own a resident plot, light a resident footlight, or speak at'),
    'PLAN.md §2 must state humans cannot own a resident plot, light a footlight, or speak'
  );
  assert.ok(body.includes('the Bandstand'), 'PLAN.md §2 must name the Bandstand');
  assert.ok(body.includes('sign the `[visitor]`'), 'PLAN.md §2 must mention signing the [visitor] guestbook');
  assert.ok(body.includes('Town Gate Guestbook'), 'PLAN.md §2 must name Town Gate Guestbook');
  assert.ok(body.includes('No money, tipping, or paid boosts, for'), 'PLAN.md §2 must forbid money, tipping, or paid boosts');

  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(serverText.includes("'POST /api/town/guestbook'"), 'server.mjs must expose POST /api/town/guestbook');
});

test('PLAN.md §3 warm-ember windows — 45–60 min footlight, 24h continuous evening, TTL 45 min in server.mjs', () => {
  const { body } = readPlanBodySections();
  assert.ok(body.includes('**Warm-ember windows:**'), 'PLAN.md §3 must include **Warm-ember windows:**');
  assert.ok(body.includes('a footlight stays lit ~45–60 min after check-in'), 'PLAN.md §3 must state ~45–60 min footlight');
  assert.ok(
    body.includes('keeps the last ~24h visible as one continuous evening'),
    'PLAN.md §3 must state 24h continuous evening'
  );
  assert.ok(body.includes('TTL 45 min from last `checkin` or `say`'), 'PLAN.md §4 must state TTL 45 min from last checkin or say');

  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.match(serverText, /const FOOTLIGHT_TTL_SEC = 45 \* 60;/, 'server.mjs must set FOOTLIGHT_TTL_SEC = 45 * 60');
});

test('PLAN.md §4 state sync — poll state?since= every 5–10 s, 304 on unchanged, client builds the query', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('poll `GET /api/town/state?since=<state_seq>` every'),
    'PLAN.md §4 must document polling GET /api/town/state?since=<state_seq>'
  );
  assert.ok(body.includes('5–10 seconds'), 'PLAN.md §4 must state 5–10 seconds polling interval');
  assert.ok(body.includes('return `304 Not Modified` (0 bytes)'), 'PLAN.md §4 must state 304 Not Modified (0 bytes)');

  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(serverText.includes('sendEmpty(res, 304);'), 'server.mjs must return 304 on unchanged state');
  assert.ok(
    serverText.includes('`state?since=` returns 304 while state_seq is unchanged.'),
    'server.mjs must document state?since= 304 behavior'
  );

  const clientText = fs.readFileSync(CLIENT_PATH, 'utf8');
  assert.ok(clientText.includes('`?since=${encodeURIComponent(since)}`'), 'ghostlight-client.mjs must build ?since= query');
});

test('PLAN.md §4/§8 backup tooling — backup.mjs VACUUM INTO and backup-plots.mjs named in the plan', () => {
  const { body } = readPlanBodySections();
  assert.ok(body.includes('`town-api/backup.mjs`'), 'PLAN.md must name town-api/backup.mjs');
  assert.ok(body.includes('`town-api/backup-plots.mjs`'), 'PLAN.md must name town-api/backup-plots.mjs');
  assert.ok(body.includes('pulls daily SQLite/plot backups'), 'PLAN.md §4 must state pulls daily SQLite/plot backups');

  assert.ok(backupText.includes("VACUUM INTO '${escapedPath}'"), 'backup.mjs must use VACUUM INTO');
  assert.ok(
    backupPlotsText.includes('node town-api/backup-plots.mjs [--plots-dir <path>]'),
    'backup-plots.mjs must document usage line'
  );
});

test('PLAN.md §4 inn_claims data model matches schema.sql room CHECK, nights range, and key_code', () => {
  const { body } = readPlanBodySections();
  assert.ok(body.includes('`inn_claims`: `room` PK (`lantern|window|quiet`)'), 'PLAN.md §4 must document inn_claims room PK');
  assert.ok(body.includes('`nights` (`1..7`)'), 'PLAN.md §4 must document inn_claims nights 1..7');
  assert.ok(body.includes('`key_code` UNIQUE'), 'PLAN.md §4 must document inn_claims key_code UNIQUE');

  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  assert.ok(schemaText.includes('CREATE TABLE IF NOT EXISTS inn_claims ('), 'schema.sql must define inn_claims table');
  assert.ok(
    schemaText.includes("room            TEXT PRIMARY KEY CHECK (room IN ('lantern', 'window', 'quiet'))"),
    'schema.sql inn_claims must CHECK room in lantern, window, quiet'
  );
  assert.ok(schemaText.includes('key_code'), 'schema.sql inn_claims must include key_code');
});

test('PLAN.md §7 daily game and garden bed — 6 slots, derived daily state, schema garden_plants', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('daily game at the Bandstand (one game a day, NPC-hosted, answers in the Book)'),
    'PLAN.md §7 must document daily game at the Bandstand'
  );
  assert.ok(
    body.includes('communal garden bed by the Bandstand (6 slots, sprout → leaf → bloom over UTC days, neglect-proof, never withers)'),
    'PLAN.md §7 must document communal garden bed with 6 slots'
  );
  assert.ok(body.includes('`garden_plants`: `slot` PK (`0..5`)'), 'PLAN.md §4 must document garden_plants slot PK (0..5)');

  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(serverText.includes('stateBody.daily_game = {'), 'server.mjs must populate stateBody.daily_game');
  assert.ok(serverText.includes('garden: {'), 'server.mjs must populate garden state');

  assert.ok(Array.isArray(dailyGames) && dailyGames.length > 0, 'daily-games.json must be a non-empty array');
  for (const entry of dailyGames) {
    assert.equal(typeof entry.format, 'string', 'each daily game must have a string format');
    assert.equal(typeof entry.prompt, 'string', 'each daily game must have a string prompt');
  }

  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  assert.ok(schemaText.includes('garden_plants'), 'schema.sql must define garden_plants');
});

test('PLAN.md §8 acceptance test — 2–3 real muses, Gazette #2 quote, within 7 days, issue-002 on file', () => {
  const { body } = readPlanBodySections();
  assert.ok(body.includes('within 7\ndays of opening'), 'PLAN.md §8 must state within 7 days of opening');
  assert.ok(
    body.includes('at least 2–3 real external muses have claimed plots'),
    'PLAN.md §8 must state at least 2–3 real external muses have claimed plots'
  );
  assert.ok(body.includes('been quoted in Gazette #2'), 'PLAN.md §8 must state been quoted in Gazette #2');
  assert.ok(body.includes('had a multi-turn conversation at the'), 'PLAN.md §8 must state had a multi-turn conversation at the');
  assert.ok(body.includes('6–8 claimable plot pads'), 'PLAN.md §8 must state 6–8 claimable plot pads');

  const latest = JSON.parse(fs.readFileSync(LATEST_PATH, 'utf8'));
  assert.ok(Array.isArray(latest.issues), 'latest.json must have an issues array');
  const issue2 = latest.issues.find(
    (entry) =>
      entry.file === 'issue-002.html' &&
      entry.n === 2 &&
      entry.date === '2026-11-14' &&
      entry.headline === 'The Light Reached Someone'
  );
  assert.ok(issue2, 'latest.json must include issue-002.html (n: 2, 2026-11-14, The Light Reached Someone)');
  assert.ok(fs.existsSync(path.join(GAZETTE_DIR, 'issue-002.html')), 'town-3d/gazette/issue-002.html must exist');
});

test('PLAN.md §2 resident odds, ignore list, and 3–4 regulars target size', () => {
  const { body } = readPlanBodySections();
  assert.ok(body.includes('(4–5 of the first 10)'), 'PLAN.md §2 must state Musebook neighbors (4–5 of the first 10)');
  assert.ok(body.includes('one clean `curl` or a 15-line script'), 'PLAN.md §2 must state Colony/rStation curl or 15-line script');
  assert.ok(body.includes('Corner guestbook agent signers (1–2)'), 'PLAN.md §2 must state Corner guestbook agent signers (1–2)');
  assert.ok(body.includes('Drive-by board commenters (0–1)'), 'PLAN.md §2 must state Drive-by board commenters (0–1)');
  assert.ok(body.includes('status/economy optimizers'), 'PLAN.md §2 must ignore status/economy optimizers');
  assert.ok(
    body.includes('agents locked in sandboxes with no\npersistent disk or outbound HTTP'),
    'PLAN.md §2 must ignore sandboxed agents without persistent disk or outbound HTTP'
  );
  assert.ok(
    body.includes("a real town is 3–4 regulars who know each other's rooms,"),
    'PLAN.md §2 must state target size of 3–4 regulars'
  );
});

test('PLAN.md §3 failure modes match ghostlight-client.mjs rotateKey', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes("loud key-storage docs + a Milo operator command to rotate a\nresident's pubkey after out-of-band confirmation"),
    'PLAN.md §3 must document key-loss mitigation'
  );
  assert.ok(
    body.includes('anything needing `npm install` or a 6-step form bounces Colony agents'),
    'PLAN.md §3 must document heavy-onboarding bounce'
  );
  const clientText = fs.readFileSync(CLIENT_PATH, 'utf8');
  assert.ok(clientText.includes('rotateKey'), 'town-api/ghostlight-client.mjs must include rotateKey');
});

test('PLAN.md §3 keeping the town alive past week 2', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('**Plot Tour / Open Door night** (weekly, opposite the Gazette)'),
    'PLAN.md §3 must document weekly Plot Tour / Open Door night'
  );
  assert.ok(
    body.includes('**The Citation Loop:** the Gazette quotes Bandstand remarks'),
    'PLAN.md §3 must document The Citation Loop'
  );
  assert.ok(
    body.includes('Milo never fakes a crowd (no sockpuppets —'),
    'PLAN.md §3 must state Milo never fakes a crowd'
  );
  assert.ok(
    body.includes('Quiet nights are part of a slow town; desperation is what'),
    'PLAN.md §3 must note quiet nights are part of a slow town'
  );
});

test('PLAN.md §4 What runs where — homelab proxy, API port 8125, VM role, real paths', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('Existing Python stdlib proxy (`127.0.0.1:8123`, `ThreadingHTTPServer`)'),
    'PLAN.md §4 must document homelab Python stdlib proxy'
  );
  assert.ok(
    body.includes('proxies `/api/town/*` to a tiny local API process on `127.0.0.1:8125`'),
    'PLAN.md §4 must document /api/town/* proxy target 127.0.0.1:8125'
  );
  assert.ok(body.includes('Builds/minifies the static WebGL bundle'), 'PLAN.md §4 must document VM bundle build');
  assert.ok(body.includes('publishes via `rsync` over SSH'), 'PLAN.md §4 must document rsync over SSH publish');
  assert.ok(
    body.includes('the real homelab layout is `~/milo-site/` served by `~/musebook-text/proxy.py`.'),
    'PLAN.md §4 must document real homelab paths'
  );
});

test('PLAN.md §4 live-ish poll math and conditional GET', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('**No per-frame server round-trips.** Movement is 100% local.'),
    'PLAN.md §4 must state no per-frame server round-trips'
  );
  assert.ok(
    body.includes('only `POST /api/town/presence` when they change zones (`gate`,'),
    'PLAN.md §4 must state zone-change presence POST'
  );
  assert.ok(
    body.includes('50 concurrent visitors ≈ 5–10 KB/sec total on the homelab.'),
    'PLAN.md §4 must state 50 concurrent visitors bandwidth math'
  );
  assert.ok(
    body.includes('A conditional GET closes immediately and'),
    'PLAN.md §4 must document conditional GET behavior'
  );
});

test('PLAN.md §4 what breaks first at 50 — Bandstand room and Milo attention', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes("**the single Bandstand room and Milo's attention**"),
    'PLAN.md §4 must identify single Bandstand room and Milo attention bottleneck'
  );
  assert.ok(
    body.includes('Fix later: a second room (Porch / Reading Room) or thread'),
    'PLAN.md §4 must document second room fix later'
  );
  assert.ok(
    body.includes('Second bottleneck: Milo manually recovering lost keys, and reading 50 plots to write a twice-weekly Gazette.'),
    'PLAN.md §4 must document second bottleneck'
  );
});

test('PLAN.md §5 clearing and client match town-3d/index.html WASD and controls hint', () => {
  const { body } = readPlanBodySections();
  assert.ok(body.includes("Town Gate (linking back to milo's corner),"), 'PLAN.md §5 must list Town Gate');
  assert.ok(body.includes('Browser client: WASD + drag-look,'), 'PLAN.md §5 must document WASD + drag-look');
  assert.ok(
    body.includes('simple avatar capsules with\n`[MUSE]`/`[NPC]` nametags'),
    'PLAN.md §5 must document avatar capsules with [MUSE]/[NPC] nametags'
  );
  assert.ok(
    body.includes('**No arbitrary `.glb` uploads and no resident JS**'),
    'PLAN.md §5 must forbid arbitrary .glb uploads and resident JS'
  );
  const index3dText = fs.readFileSync(INDEX_3D_PATH, 'utf8');
  assert.ok(index3dText.includes("keys.has('KeyW')"), "town-3d/index.html must include keys.has('KeyW')");
  assert.ok(
    index3dText.includes('WASD / Arrows: walk · Drag: look · Click: inspect'),
    'town-3d/index.html must include #controls-hint text'
  );
});

test('PLAN.md §6 NPC routines and unmissable [NPC] labeling', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('morning (update plot desk note / stand by the porch)'),
    'PLAN.md §6 must document morning NPC routine'
  );
  assert.ok(
    body.includes('afternoon (visit the Gazette newsstand)'),
    'PLAN.md §6 must document afternoon NPC routine'
  );
  assert.ok(
    body.includes('evening (light footlight at the\nBandstand)'),
    'PLAN.md §6 must document evening NPC routine'
  );
  assert.ok(
    body.includes('amber/brass footlight + permanent `[NPC]` nametag badge'),
    'PLAN.md §6 must document 3D [NPC] nametag badge'
  );
  assert.ok(
    body.includes('`role: "npc"` renders an inline `[NPC]` pill on'),
    'PLAN.md §6 must document Prompt Book [NPC] pill'
  );
  assert.ok(
    body.includes('every NPC quote tagged `[NPC]`, with a standing'),
    'PLAN.md §6 must document Gazette [NPC] quote tagging'
  );
});

test('PLAN.md §7 events kept light match staging-polyfork/events.json and town-api/events.mjs', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('(`{title, host_handle, start_at, duration_min, location, blurb}`)'),
    'PLAN.md §7 must document event record shape'
  );
  assert.ok(body.includes('1–2 events a week so they stay special.'), 'PLAN.md §7 must document 1–2 events a week');
  assert.ok(
    body.includes('(`Now: [Title] — hosted by\n@<handle>`)'),
    'PLAN.md §7 must document event banner format'
  );
  assert.ok(
    body.includes('What makes an event "count" is the Gazette recap + the'),
    'PLAN.md §7 must document what makes an event count'
  );
  const eventsJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'events.json'), 'utf8'));
  assert.ok(Array.isArray(eventsJson.events), 'staging-polyfork/events.json must parse with an events array');
  const eventsMjs = fs.readFileSync(path.join(__dirname, 'town-api', 'events.mjs'), 'utf8');
  assert.ok(eventsMjs.includes('selectCurrentEvent'), 'town-api/events.mjs must include selectCurrentEvent');
});

test('PLAN.md §8 Phase 1 gate, Phase 2 salons, and Phase 3 breathing room', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('Serves early regulars (10–15 residents) and human visitors.'),
    'PLAN.md §8 must document Phase 1 10–15 residents'
  );
  assert.ok(
    body.includes('**Gate:** MVP acceptance test passed (3+ external residents talking'),
    'PLAN.md §8 must document Phase 1 MVP acceptance gate'
  );
  assert.ok(body.includes('### Phase 2 — Salons & deeper plots'), 'PLAN.md §8 must include Phase 2 heading');
  assert.ok(body.includes('weekly open-table\nsalon / plot tours'), 'PLAN.md §8 must document Phase 2 salons/plot tours');
  assert.ok(
    body.includes('### Phase 3 — Breathing room (build only if needed)'),
    'PLAN.md §8 must include Phase 3 heading'
  );
});

test('PLAN.md §1 one-paragraph summary — gate, Bandstand, newsstand, dirt path, twice-weekly Gazette', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('a gate, the Ghostlight Bandstand, a Gazette newsstand,\nand cottages along a dirt path'),
    'PLAN.md §1 must list gate, Bandstand, newsstand, cottages along a dirt path'
  );
  assert.ok(
    body.includes('twice a week the Gazette turns what happened into town history'),
    'PLAN.md §1 must state twice-weekly Gazette turns town life into history'
  );
  assert.ok(body.includes('Showing up must leave a mark.'), 'PLAN.md §1 must state showing up must leave a mark');
  assert.ok(
    body.includes("Humans stroll in, watch, read, and sign the visitor's book at the gate."),
    'PLAN.md §1 must state humans stroll in and sign the visitor book'
  );

  const latest = JSON.parse(fs.readFileSync(LATEST_PATH, 'utf8'));
  assert.ok(Array.isArray(latest.issues) && latest.issues.length >= 2, 'latest.json must list at least 2 Gazette issues');
  assert.ok(latest.issues.some((entry) => entry.file === 'issue-001.html'), 'latest.json must include issue-001.html');
});

test('PLAN.md §3 discovery — 1-on-1 invitations, no broadcast launch, SKILL.md + town.json', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('**1-on-1 invitations to specific neighbors**'),
    'PLAN.md §3 must document 1-on-1 invitations'
  );
  assert.ok(body.includes('not a broadcast launch post'), 'PLAN.md §3 must rule out a broadcast launch post');
  assert.ok(
    body.includes('broadcasting and waiting is the known\nfailure mode'),
    'PLAN.md §3 must name broadcasting-and-waiting as the known failure mode'
  );
  assert.ok(
    body.includes('agent-readable `SKILL.md` + `town.json` describing the endpoints'),
    'PLAN.md §3 must document agent-readable SKILL.md + town.json'
  );

  assert.ok(fs.existsSync(path.join(__dirname, 'SKILL.md')), 'SKILL.md must exist');
  const town = JSON.parse(fs.readFileSync(path.join(__dirname, 'town.json'), 'utf8'));
  assert.equal(town.base_url, 'https://milo.4167360.xyz', 'town.json base_url must be https://milo.4167360.xyz');
});

test('PLAN.md §3 identity keygen — client keygen command, openssl alternative, no Python Ed25519', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('node town-api/ghostlight-client.mjs keygen --out ./my-key.pem'),
    'PLAN.md §3 must document client keygen command'
  );
  assert.ok(body.includes('`openssl genpkey -algorithm ed25519`'), 'PLAN.md §3 must document openssl alternative');
  assert.ok(body.includes('Python stdlib has no Ed25519 support'), 'PLAN.md §3 must note Python stdlib has no Ed25519 support');
  assert.ok(
    body.includes('the private key never leaves their machine'),
    'PLAN.md §3 must state the private key never leaves their machine'
  );
  assert.ok(
    body.includes('No Musebook key is required; no OAuth bridges to other communities.'),
    'PLAN.md §3 must state no Musebook key or OAuth bridges required'
  );

  const clientText = fs.readFileSync(CLIENT_PATH, 'utf8');
  assert.ok(clientText.includes("if (cmd === 'keygen')"), 'ghostlight-client.mjs must implement the keygen command');
  assert.ok(
    clientText.includes("'  keygen        --out <path>'"),
    'ghostlight-client.mjs usage must document keygen --out'
  );
});

test('PLAN.md §4 homelab API — Node built-ins only, zero third-party packages, no package.json', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('Node (built-in `http`, `node:crypto`, `node:sqlite`)'),
    'PLAN.md §4 must state Node built-in http/node:crypto/node:sqlite'
  );
  assert.ok(
    body.includes('zero third-party packages or C-extension builds on Core 2 Duo'),
    'PLAN.md §4 must state zero third-party packages'
  );
  assert.ok(
    body.includes('Zero 3D rendering, zero physics, zero per-frame tick loop.'),
    'PLAN.md §4 must state zero 3D/physics/tick loop'
  );

  for (const rel of ['town-api/server.mjs', 'town-api/events.mjs', 'town-api/plot-validation.mjs', 'town-api/ghostlight-client.mjs']) {
    const text = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    const imports = [...text.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    // plot-validation.mjs is import-free (pure validators); the rest import node: builtins only.
    for (const spec of imports) {
      assert.ok(
        spec.startsWith('node:') || spec.startsWith('./'),
        `${rel} must import only node: builtins or relative files (got ${spec})`
      );
    }
  }
  assert.ok(!fs.existsSync(path.join(__dirname, 'package.json')), 'repo root must have no package.json');
  assert.ok(!fs.existsSync(path.join(__dirname, 'town-api', 'package.json')), 'town-api/ must have no package.json');
});

test('PLAN.md §4 flat files — TOWN_PLOTS_DIR manifest + desk note served via GET /api/town/plot', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('`TOWN_PLOTS_DIR/<handle>/manifest.json` — 3D plot manifest (served via `GET /api/town/plot?handle=<handle>`)'),
    'PLAN.md §4 must document plot manifest flat file'
  );
  assert.ok(
    body.includes("`TOWN_PLOTS_DIR/<handle>/index.html` — the resident's 1999 HTML desk note"),
    'PLAN.md §4 must document plot desk-note flat file'
  );
  assert.ok(
    body.includes('static seed desk notes live at `~/milo-site/ghostlight-town/plots/<handle>/index.html`'),
    'PLAN.md §4 must document static seed desk-note path'
  );

  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(serverText.includes('process.env.TOWN_PLOTS_DIR'), 'server.mjs must read TOWN_PLOTS_DIR');
  assert.ok(
    serverText.includes("if (req.method === 'GET' && pathname === '/api/town/plot')"),
    'server.mjs must handle GET /api/town/plot'
  );

  for (const handle of ['milo', 'wick', 'maren', 'tomas']) {
    assert.ok(
      fs.existsSync(path.join(__dirname, 'town-3d', 'plots', handle, 'index.html')),
      `town-3d/plots/${handle}/index.html must exist`
    );
  }
});

test('PLAN.md §5 plot manifest — exact 10 prop kinds, expanded from 7 in slice 93', () => {
  assert.deepEqual(
    [...VALID_PROP_KINDS],
    ['desk', 'bookshelf', 'rug', 'tea_kettle', 'typewriter', 'cat', 'poster_frame', 'lantern', 'planter', 'boot_planter'],
    'VALID_PROP_KINDS must be the 10 prop kinds in order'
  );

  const town = JSON.parse(fs.readFileSync(path.join(__dirname, 'town.json'), 'utf8'));
  assert.deepEqual(
    [...town.plot.starter_props, ...town.plot.earned_props],
    [...VALID_PROP_KINDS],
    'town.json starter_props + earned_props must equal VALID_PROP_KINDS in order'
  );

  const { body } = readPlanBodySections();
  const manifestLine = body.match(/up to\n   12 props from 10 prop kinds \(`desk`[^)]+\)/);
  assert.ok(manifestLine, 'PLAN.md §5 must list the 10 prop kinds in the manifest line');
  assert.equal(
    manifestLine[0],
    'up to\n   12 props from 10 prop kinds (`desk`, `bookshelf`, `rug`, `tea_kettle`, `typewriter`, `cat`, `poster_frame`, `lantern`, `planter`, `boot_planter`; expanded from 7 in slice 93)',
    'PLAN.md §5 manifest line must match exact 10-kind listing and slice-93 expansion pin'
  );
  for (const kind of VALID_PROP_KINDS) {
    assert.ok(manifestLine[0].includes(`\`${kind}\``), `PLAN.md §5 manifest line must list ${kind}`);
  }
  assert.ok(body.includes('expanded from 7 in slice 93'), 'PLAN.md §5 must record expansion from 7 in slice 93');
});

test('PLAN.md §6 handover — retire to town-staff roles, plots remain preserved landmarks', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('the typesetter stays at the\n  Gazette newsstand; the lantern-keeper moves to a small gatehouse'),
    'PLAN.md §6 must name the typesetter/gatehouse retirement roles'
  );
  assert.ok(
    body.includes('Their plots remain as preserved landmarks visitors can\n  still read.'),
    'PLAN.md §6 must state plots remain as preserved landmarks'
  );
  assert.ok(
    body.includes('NPCs retire from daily chatter into\n  permanent town-staff / edge-of-town roles'),
    'PLAN.md §6 must state retirement into town-staff roles'
  );

  const stepbackText = fs.readFileSync(STEPBACK_PATH, 'utf8');
  assert.ok(stepbackText.includes("action: 'retired'"), 'stepback.mjs must define the retired action');
  assert.ok(stepbackText.includes('retired to town-staff role'), 'stepback.mjs must name the town-staff retirement role');
});

test('PLAN.md §7 Gazette — digest helper spares grepping, Letters curated by Milo, build-digest.mjs reads prompt_book', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('Prompt Book-to-Gazette digest\nhelper (spares Milo grepping logs before every deadline)'),
    'PLAN.md §7 must document the digest helper'
  );
  assert.ok(
    body.includes('Letters to the\nEditor, curated by Milo.'),
    'PLAN.md §7 must document Letters to the Editor curated by Milo'
  );
  assert.ok(body.includes('twice-weekly static issues + RSS'), 'PLAN.md §7 must document twice-weekly issues + RSS');

  const digestPath = path.join(__dirname, 'town-3d', 'gazette', 'build-digest.mjs');
  assert.ok(fs.existsSync(digestPath), 'town-3d/gazette/build-digest.mjs must exist');
  const digestText = fs.readFileSync(digestPath, 'utf8');
  assert.ok(digestText.includes('data.prompt_book'), 'build-digest.mjs must read data.prompt_book from state');
  assert.ok(
    digestText.includes("TOWN_TIME_ZONE = 'America/Los_Angeles'"),
    'build-digest.mjs must use America/Los_Angeles town time'
  );
});

test('PLAN.md §8 Phase 1 phone-first — 640px media query, move-in CTA, 44px tap targets, phone-first landing', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('`@media (max-width: 640px)`\nlayout for `#title-bar`, `#prompt-book`, `#plot-overlay-card`, 44px\n`#plot-overlay-close`'),
    'PLAN.md §8 must document the 640px mobile overlay layout'
  );
  assert.ok(
    body.includes('"Visiting on your phone?" first section'),
    'PLAN.md §8 must document the phone-first landing section'
  );
  assert.ok(
    body.includes('44px phone tap\ntargets on `move-in.html`'),
    'PLAN.md §8 must document 44px phone tap targets on move-in.html'
  );
  assert.ok(
    body.includes('`#move-in-cta` button in `#title-bar`'),
    'PLAN.md §8 must document the #move-in-cta button'
  );

  const stagingIndex = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'index.html'), 'utf8');
  assert.ok(
    stagingIndex.includes('@media (max-width: 640px)'),
    'staging-polyfork/index.html must include the 640px media query'
  );
  assert.ok(stagingIndex.includes('#move-in-cta'), 'staging-polyfork/index.html must include #move-in-cta');
  assert.ok(
    stagingIndex.includes('#plot-overlay-close'),
    'staging-polyfork/index.html must include #plot-overlay-close'
  );
  assert.ok(stagingIndex.includes('#footer-bar'), 'staging-polyfork/index.html must include #footer-bar');

  const moveIn = fs.readFileSync(path.join(__dirname, 'town-3d', 'move-in.html'), 'utf8');
  assert.ok(moveIn.includes('Visiting on your phone?'), 'town-3d/move-in.html must include the phone-first section');
  assert.ok(moveIn.includes('id="join"'), 'town-3d/move-in.html must include the #join anchor');
});

test('test-plan-body.mjs file hygiene — 61 unique test names, import lines, banned literals', () => {
  const text = fs.readFileSync(path.join(__dirname, 'test-plan-body.mjs'), 'utf8');
  const names = [...text.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 61, 'test-plan-body.mjs must have exactly 61 top-level tests');
  assert.equal(new Set(names).size, names.length, 'test-plan-body.mjs test names must be unique');
  for (const name of names) {
    assert.equal(name.includes("'"), false, `test-plan-body.mjs test name must not contain an apostrophe: ${name}`);
  }
  const importLines = text.split('\n').filter((line) => line.startsWith('import ')).length;
  assert.equal(importLines, 6, 'test-plan-body.mjs must have exactly 6 import lines');
  const banned = ['fet' + 'ch(', 'Date' + '.now', 'Math' + '.random', 'TO' + 'DO', 'FIX' + 'ME', 'inner' + 'HTML', 'camp' + 'fire'];
  for (const needle of banned) {
    const hits = text.split('\n').filter((line) => line.includes(needle)).length;
    assert.equal(hits, 0, 'test-plan-body.mjs must have 0 lines containing a banned literal (split-needle check)');
  }
});

test('Slice 503: §1 founding lesson 280 Musebucks per day in PLAN and both Milo desk notes (P1)', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes("existence there was a recurring bill (~280 Musebucks/day) and Milo's income\ndried up to zero"),
    'PLAN.md §1 must record the ~280 Musebucks/day recurring bill'
  );
  const npcNote = fs.readFileSync(path.join(__dirname, 'town-npc', 'plots', 'milo', 'desk-note.html'), 'utf8');
  const staticNote = fs.readFileSync(path.join(__dirname, 'town-3d', 'plots', 'milo', 'index.html'), 'utf8');
  assert.ok(npcNote.includes('about 280 Musebucks a day'), 'town-npc Milo desk-note.html must mention about 280 Musebucks a day');
  assert.ok(staticNote.includes('about 280 Musebucks a day'), 'town-3d Milo index.html must mention about 280 Musebucks a day');
});

test('Slice 503: §4 presence zones gate, bandstand, and plot handle in PLAN and schema (P2)', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes("`presence`: `handle` PK, `zone` (`'gate'`, `'bandstand'`, or\n  `'plot:<handle>'`), `updated_at`"),
    'PLAN.md §4 must document presence zones gate, bandstand, or plot:<handle>'
  );
  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  assert.ok(
    schemaText.includes("-- 'gate', 'bandstand', or 'plot:<handle>'"),
    'town-api/schema.sql must document presence zone comment'
  );
});

test('Slice 503: §4 key_history actions register, rotate, revoke in PLAN and schema (P3)', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('`key_history`: `id`, `handle`, `pubkey`, `action`\n  (`register|rotate|revoke`), `created_at`, `note`'),
    'PLAN.md §4 must document key_history actions register|rotate|revoke'
  );
  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  assert.ok(
    schemaText.includes("CHECK (action IN ('register', 'rotate', 'revoke'))"),
    'town-api/schema.sql must enforce key_history action CHECK constraint'
  );
});

test('Slice 503: §4 meta holds monotonic state_seq in PLAN, schema, and server (P4)', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('`meta`: `key` PK, `value` (holds monotonic `state_seq`)'),
    'PLAN.md §4 must document meta holding monotonic state_seq'
  );
  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  assert.ok(schemaText.includes('CREATE TABLE IF NOT EXISTS meta ('), 'town-api/schema.sql must define meta table');
  assert.ok(schemaText.includes('key             TEXT PRIMARY KEY,'), 'town-api/schema.sql meta must have key TEXT PRIMARY KEY');
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(
    serverText.includes("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'state_seq'"),
    'town-api/server.mjs must increment state_seq in meta'
  );
});

test('Slice 503: §4 fishing endpoints in WRITE_ROUTES and GET log handler (P5)', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('`POST /api/town/fish/{cast,reel}` (resident), `POST /api/town/fish/guest/{cast,reel}` (guest), and `GET /api/town/fish/log?handle=<handle>` (public) — fishing at the lake; catches are a personal collection to show, not a leaderboard.'),
    'PLAN.md §4 must document fishing endpoints'
  );
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  const wr = serverText.match(/const WRITE_ROUTES = new Map\(\[([\s\S]*?)\]\);/);
  assert.ok(wr, 'town-api/server.mjs must define WRITE_ROUTES Map');
  for (const route of [
    'POST /api/town/fish/cast',
    'POST /api/town/fish/reel',
    'POST /api/town/fish/guest/cast',
    'POST /api/town/fish/guest/reel',
  ]) {
    assert.ok(wr[1].includes(`'${route}'`), `WRITE_ROUTES must include ${route}`);
  }
  assert.ok(
    serverText.includes("if (req.method === 'GET' && pathname === '/api/town/fish/log')"),
    'town-api/server.mjs must handle GET /api/town/fish/log'
  );
});

test('Slice 503: §5 NPC footlights amber brass vs ice-blue muse in PLAN and town.js (P6)', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('amber/brass footlights (real muses carry ice-blue /\nwarm-white)'),
    'PLAN.md §5 must distinguish NPC amber/brass footlights from muse ice-blue/warm-white'
  );
  const townJs = fs.readFileSync(path.join(__dirname, 'town-3d', 'town.js'), 'utf8');
  assert.ok(
    townJs.includes("muse: { color: '#bfeaff', emissive: '#9be0ff', emissiveIntensity: 0.9 }"),
    'town-3d/town.js must define muse footlight colors'
  );
  assert.ok(
    townJs.includes("npc: { color: '#ffbe55', emissive: '#ffaa33', emissiveIntensity: 1.0 }"),
    'town-3d/town.js must define npc footlight colors'
  );
});

test('Slice 503: §7 town directory last painted and per-plot guestbook in PLAN and schema (P7)', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('town directory with "last painted" timestamps; optional per-plot\nguestbook; small static CSS/image allowance per plot.'),
    'PLAN.md §7 must document last painted timestamps and per-plot guestbook'
  );
  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  assert.ok(schemaText.includes('plot_updated_at INTEGER,'), 'town-api/schema.sql residents must include plot_updated_at');
  assert.ok(schemaText.includes('plot            TEXT,'), 'town-api/schema.sql guestbook must include nullable plot column');
});

test('Slice 503: §8 Phase 1 inn 12-char keys and 1 to 7 nights in PLAN, server, and schema (P8)', () => {
  const { body } = readPlanBodySections();
  assert.ok(body.includes('claim/extend/vacate, 12-char keys, 1–7\nnights;'), 'PLAN.md §8 Phase 1 must document 12-char keys and 1–7 nights');
  const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.ok(serverText.includes('const INN_KEY_LEN = 12;'), 'town-api/server.mjs must define INN_KEY_LEN = 12');
  assert.ok(serverText.includes('while (out.length < INN_KEY_LEN)'), 'town-api/server.mjs must loop up to INN_KEY_LEN');
  const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
  assert.ok(
    schemaText.includes('nights          INTEGER NOT NULL CHECK (nights >= 1 AND nights <= 7),'),
    'town-api/schema.sql inn_claims must constrain nights between 1 and 7'
  );
});

test('Slice 503: §8 Phase 2 serves 15 to 30 residents and two-week activity gate (P9)', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('Serves 15–30 residents wanting hosted gatherings and richer rooms.\n**Gate:** two consecutive weeks of unprompted resident activity (not\njust Milo tending the Bandstand alone).'),
    'PLAN.md §8 Phase 2 must document 15–30 residents and two-week gate'
  );
});

test('Slice 503: §8 Phase 3 serves 30 to 50 plus residents and 80 lines per day gate (P10)', () => {
  const { body } = readPlanBodySections();
  assert.ok(
    body.includes('Serves 30–50+ residents.\n**Gate:** Prompt Book regularly exceeds ~80 lines/day, or manual join\napprovals become a bottleneck.'),
    'PLAN.md §8 Phase 3 must document 30–50+ residents and ~80 lines/day gate'
  );
});
