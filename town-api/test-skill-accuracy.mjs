/**
 * Drift-guard test for SKILL.md against town-api/server.mjs,
 * town-api/plot-validation.mjs, town-api/ghostlight-client.mjs,
 * town.json, town-3d/town.js, town-3d/gazette/build-digest.mjs,
 * town-npc/run.mjs, town-npc/characters.mjs, and staging-polyfork (Slices 125, 135, 283).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';
import { getPartOfDay } from '../town-npc/run.mjs';
import { dailyGameHostForDate, buildDailyGameLine, FORMAT_LABELS } from '../town-npc/daily-game.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');
const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/server.mjs'), 'utf8');
const plotValidationSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/plot-validation.mjs'), 'utf8');
const clientSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/ghostlight-client.mjs'), 'utf8');
const townJsSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/town.js'), 'utf8');

function evalNumericExpr(expr) {
  const cleaned = expr.trim();
  assert.match(cleaned, /^[0-9+\-*/\s()]+$/, `Unexpected numeric expression: ${cleaned}`);
  return Function(`"use strict"; return (${cleaned});`)();
}

function parseServerConstNumber(name) {
  const m = serverSrc.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  assert.ok(m, `Could not find const ${name} in server.mjs`);
  return evalNumericExpr(m[1]);
}

function parsePlotConstNumber(name) {
  const m = plotValidationSrc.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*([^;]+);`));
  assert.ok(m, `Could not find export const ${name} in plot-validation.mjs`);
  return evalNumericExpr(m[1]);
}

function parseStringListFromSet(src, name) {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*new\\s+Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(m, `Could not find Set ${name}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function parseRateLimits() {
  const blockMatch = serverSrc.match(/const\s+RATE_LIMITS\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(blockMatch, 'Could not find RATE_LIMITS in server.mjs');
  const limits = {};
  const entryRe = /(\w+):\s*\{\s*max:\s*([^,]+),\s*windowSec:\s*([^}]+?)\s*,?\s*\}/g;
  for (const m of blockMatch[1].matchAll(entryRe)) {
    limits[m[1]] = {
      max: evalNumericExpr(m[2]),
      windowSec: evalNumericExpr(m[3]),
    };
  }
  return limits;
}

function parseCaps() {
  const capsMatch = serverSrc.match(/const\s+CAPS\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(capsMatch, 'Could not find CAPS in server.mjs');
  const caps = {};
  for (const m of capsMatch[1].matchAll(/(\w+):\s*(\d+)/g)) {
    caps[m[1]] = Number(m[2]);
  }
  return caps;
}

function getEndpointSection(method, routePath) {
  const header = `### \`${method} ${routePath}`;
  const start = skillMd.indexOf(header);
  assert.ok(start !== -1, `Missing section for ${method} ${routePath} in SKILL.md`);
  const nextSection = skillMd.indexOf('\n### ', start + header.length);
  const nextH2 = skillMd.indexOf('\n## ', start + header.length);
  const candidates = [nextSection, nextH2].filter((idx) => idx !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : skillMd.length;
  return skillMd.slice(start, end);
}

test('SKILL.md §3 rate limits match RATE_LIMITS in server.mjs', () => {
  const rl = parseRateLimits();

  const joinSec = getEndpointSection('POST', '/api/town/join');
  assert.equal(rl.joinIp.windowSec, 3600);
  assert.ok(joinSec.includes(`${rl.joinIp.max} joins/hour per IP`), 'join rate limit mismatch');

  const checkinSec = getEndpointSection('POST', '/api/town/ghostlight/checkin');
  assert.equal(rl.checkin.windowSec, 60);
  assert.ok(checkinSec.includes(`${rl.checkin.max}/min`), 'checkin rate limit mismatch');

  const saySec = getEndpointSection('POST', '/api/town/ghostlight/say');
  assert.equal(rl.say.windowSec % 60, 0);
  assert.ok(saySec.includes(`${rl.say.max} per ${rl.say.windowSec / 60} min`), 'say rate limit mismatch');

  const plotSec = getEndpointSection('PUT', '/api/town/plot');
  assert.equal(rl.plot.windowSec, 3600);
  assert.ok(plotSec.includes(`${rl.plot.max}/hour`), 'plot rate limit mismatch');

  const innClaimSec = getEndpointSection('POST', '/api/town/inn/claim');
  assert.equal(rl.innClaim.windowSec, 3600);
  assert.ok(
    innClaimSec.includes(`${rl.innClaim.max}/hour per resident (shared with \`inn/extend\`)`),
    'inn/claim rate limit mismatch'
  );

  const innExtendSec = getEndpointSection('POST', '/api/town/inn/extend');
  assert.ok(
    innExtendSec.includes(`${rl.innClaim.max}/hour per resident (shared with \`inn/claim\`)`),
    'inn/extend rate limit mismatch'
  );

  const keyRotateSec = getEndpointSection('POST', '/api/town/key/rotate');
  assert.equal(rl.keyRotate.windowSec, 3600);
  assert.ok(keyRotateSec.includes(`${rl.keyRotate.max}/hour per resident`), 'key/rotate rate limit mismatch');

  const guestbookSec = getEndpointSection('POST', '/api/town/guestbook');
  assert.equal(rl.guestbook.windowSec, 3600);
  assert.ok(guestbookSec.includes(`${rl.guestbook.max}/hour per IP`), 'guestbook rate limit mismatch');

  const guestCheckinSec = getEndpointSection('POST', '/api/town/ghostlight/guest/checkin');
  assert.equal(rl.guestCheckin.windowSec, 300);
  assert.ok(guestCheckinSec.includes(`${rl.guestCheckin.max}/5 min`), 'guest/checkin rate limit mismatch');
  assert.ok(guestCheckinSec.includes("zone: 'bandstand'"), 'guest/checkin response shape mismatch');

  const guestSaySec = getEndpointSection('POST', '/api/town/ghostlight/guest/say');
  assert.equal(rl.guestSay.windowSec % 60, 0);
  assert.ok(guestSaySec.includes(`${rl.guestSay.max} per ${rl.guestSay.windowSec / 60} min`), 'guest/say rate limit mismatch');
  assert.ok(guestSaySec.includes('[guest]'), 'guest/say must mention [guest] label');

  const guestInnClaimSec = getEndpointSection('POST', '/api/town/inn/guest/claim');
  assert.equal(rl.guestInnClaim.windowSec, 3600);
  assert.ok(
    guestInnClaimSec.includes(`${rl.guestInnClaim.max}/hour per guest (shared with \`inn/guest/extend\`)`),
    'inn/guest/claim rate limit mismatch'
  );

  const guestInnExtendSec = getEndpointSection('POST', '/api/town/inn/guest/extend');
  assert.ok(
    guestInnExtendSec.includes(`${rl.guestInnClaim.max}/hour per guest (shared with \`inn/guest/claim\`)`),
    'inn/guest/extend rate limit mismatch'
  );

  const guestInnVacateSec = getEndpointSection('POST', '/api/town/inn/guest/vacate');
  assert.ok(guestInnVacateSec.includes('vacated: true'), 'inn/guest/vacate response shape mismatch');
});

test('SKILL.md auth, timing, body cap, and CAPS match server.mjs', () => {
  const caps = parseCaps();
  const maxBodyKb = parseServerConstNumber('MAX_BODY_BYTES') / 1024;
  const footlightMin = parseServerConstNumber('FOOTLIGHT_TTL_SEC') / 60;
  const skewSec = parseServerConstNumber('TIMESTAMP_SKEW_SEC');
  const nonceSec = parseServerConstNumber('NONCE_TTL_SEC');

  const spkiMatch = serverSrc.match(/const\s+ED25519_SPKI_PREFIX\s*=\s*Buffer\.from\('([0-9a-f]+)',\s*'hex'\);/);
  assert.ok(spkiMatch, 'Could not find ED25519_SPKI_PREFIX in server.mjs');

  assert.ok(skillMd.includes(`**${maxBodyKb} KB**`), `SKILL.md must state ${maxBodyKb} KB body cap`);
  assert.ok(skillMd.includes(`\`±${skewSec}\` s`), `SKILL.md must state ±${skewSec} s timestamp skew`);
  assert.ok(skillMd.includes(`\`${nonceSec}\` s`), `SKILL.md must state ${nonceSec} s nonce replay TTL`);
  assert.ok(skillMd.includes(`\`${spkiMatch[1]}\``), 'SKILL.md must state SPKI DER prefix hex');

  const checkinSec = getEndpointSection('POST', '/api/town/ghostlight/checkin');
  assert.ok(checkinSec.includes(`${footlightMin} minutes`), `checkin must state ${footlightMin} minutes footlight TTL`);
  assert.ok(checkinSec.includes(`max ${caps.statusText} chars`), `checkin must state status_text max ${caps.statusText}`);

  const joinSec = getEndpointSection('POST', '/api/town/join');
  assert.ok(joinSec.includes(`max ${caps.bio} chars`), `join must state bio max ${caps.bio}`);

  const saySec = getEndpointSection('POST', '/api/town/ghostlight/say');
  assert.ok(saySec.includes(`1–${caps.say} chars`), `say must state body 1–${caps.say} chars`);

  const guestbookSec = getEndpointSection('POST', '/api/town/guestbook');
  assert.ok(guestbookSec.includes(`1–${caps.guestbookName} chars`), `guestbook must state name 1–${caps.guestbookName}`);
  assert.ok(guestbookSec.includes(`1–${caps.guestbookBody} chars`), `guestbook must state body 1–${caps.guestbookBody}`);
});

test('SKILL.md Inn details and client methods match server.mjs and ghostlight-client.mjs', () => {
  const roomsMatch = serverSrc.match(/const\s+INN_ROOMS\s*=\s*\[([^\]]+)\];/);
  assert.ok(roomsMatch, 'Could not find INN_ROOMS in server.mjs');
  const rooms = [...roomsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const maxNights = parseServerConstNumber('INN_MAX_NIGHTS');
  const defaultNights = parseServerConstNumber('INN_DEFAULT_NIGHTS');
  const keyLen = parseServerConstNumber('INN_KEY_LEN');

  for (const room of rooms) {
    assert.ok(skillMd.includes(`"${room}"`) || skillMd.includes(`\`${room}\``), `SKILL.md must list inn room ${room}`);
  }
  assert.ok(skillMd.includes(`1..${maxNights}`), `SKILL.md §3 must state 1..${maxNights} nights`);
  assert.ok(skillMd.includes(`**1–${maxNights} nights**`), `SKILL.md §5 must state 1–${maxNights} nights`);
  assert.ok(
    skillMd.includes(`default \`${defaultNights}\``) && skillMd.includes(`default **${defaultNights}**`),
    `SKILL.md must state default ${defaultNights} nights`
  );
  assert.ok(skillMd.includes(`${keyLen}-character`), `SKILL.md must state ${keyLen}-character room key`);

  for (const methodName of [
    'claimInnRoom',
    'extendInnStay',
    'vacateInnRoom',
    'guestInnClaim',
    'guestInnExtend',
    'guestInnVacate',
    'rotateKey',
  ]) {
    assert.ok(clientSrc.includes(`async ${methodName}(`), `${methodName} must exist on GhostlightClient`);
    assert.ok(skillMd.includes(`${methodName}(`), `SKILL.md must document ${methodName}()`);
  }
});

test('SKILL.md §4 plot limits, prop kinds, and bounds match plot-validation.mjs', () => {
  const manifestKb = parsePlotConstNumber('MAX_MANIFEST_BYTES') / 1024;
  const htmlKb = parsePlotConstNumber('MAX_HTML_BYTES') / 1024;
  const signpostMax = parsePlotConstNumber('MAX_SIGNPOST_CHARS');
  const maxProps = parsePlotConstNumber('MAX_PROPS');
  const cottages = parseStringListFromSet(plotValidationSrc, 'VALID_COTTAGES');
  const propKinds = parseStringListFromSet(plotValidationSrc, 'VALID_PROP_KINDS');

  const coordMatch = plotValidationSrc.match(/p\[axis\]\s*<\s*(-?\d+)\s*\|\|\s*p\[axis\]\s*>\s*(-?\d+)/);
  assert.ok(coordMatch, 'Could not find prop coord bounds in plot-validation.mjs');
  const rotMatch = plotValidationSrc.match(/p\.rot_y\s*<\s*(\d+)\s*\|\|\s*p\.rot_y\s*>=\s*(\d+)/);
  assert.ok(rotMatch, 'Could not find prop rot_y bounds in plot-validation.mjs');

  assert.ok(skillMd.includes(`max ${manifestKb} KB JSON`), `SKILL.md must state max ${manifestKb} KB JSON`);
  assert.ok(skillMd.includes(`max ${htmlKb} KB`), `SKILL.md must state max ${htmlKb} KB HTML`);
  assert.ok(skillMd.includes(`max ${signpostMax} chars`), `SKILL.md must state signpost max ${signpostMax} chars`);
  assert.ok(skillMd.includes(`up to **${maxProps}** items`), `SKILL.md must state up to ${maxProps} props`);
  assert.ok(
    skillMd.includes(`[${coordMatch[1]}, ${coordMatch[2]}]`),
    `SKILL.md must state prop coord bounds [${coordMatch[1]}, ${coordMatch[2]}]`
  );
  assert.ok(
    skillMd.includes(`[${rotMatch[1]}, ${rotMatch[2]})`),
    `SKILL.md must state prop rot_y bounds [${rotMatch[1]}, ${rotMatch[2]})`
  );

  for (const cottage of cottages) {
    assert.ok(skillMd.includes(cottage), `SKILL.md must list cottage style ${cottage}`);
  }
  assert.equal(propKinds.length, 9, 'Expected 9 VALID_PROP_KINDS');
  assert.ok(propKinds.includes('lantern') && propKinds.includes('planter'));
  for (const kind of propKinds) {
    assert.ok(skillMd.includes(`\`${kind}\``), `SKILL.md must list prop kind ${kind}`);
  }
});

test('SKILL.md state shape, admin routes, and honest live-lag note match server.mjs', () => {
  const stateSec = getEndpointSection('GET', '/api/town/state');
  const expectedStateKeys = [
    'state_seq',
    'footlights',
    'prompt_book',
    'presence',
    'plots',
    'inn',
    'guestbook',
    'guestbook_by_plot',
    'guestbook_pending',
    'events: { now, next }',
    'garden',
    'nightly_call?',
    'daily_game?',
  ];
  for (const key of expectedStateKeys) {
    assert.ok(stateSec.includes(key), `SKILL.md GET /api/town/state must document ${key}`);
  }

  // Admin routes in WRITE_ROUTES must match SKILL.md Admin Endpoints list exactly
  const writeMapMatch = serverSrc.match(/const\s+WRITE_ROUTES\s*=\s*new\s+Map\(\[([\s\S]*?)\]\);/);
  assert.ok(writeMapMatch, 'Could not find WRITE_ROUTES in server.mjs');
  const adminRoutes = [...writeMapMatch[1].matchAll(/\['POST\s+(\/api\/town\/admin\/[^']+)',\s*\{\s*mode:\s*'admin'/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(adminRoutes, [
    '/api/town/admin/approve',
    '/api/town/admin/invite',
    '/api/town/admin/delete-line',
    '/api/town/admin/guestbook',
  ]);

  const adminStart = skillMd.indexOf('### Admin Endpoints');
  assert.ok(adminStart !== -1, 'Missing ### Admin Endpoints section in SKILL.md');
  const adminEnd = skillMd.indexOf('\n---', adminStart);
  const adminSec = skillMd.slice(adminStart, adminEnd !== -1 ? adminEnd : skillMd.length);
  for (const route of adminRoutes) {
    assert.ok(adminSec.includes(`\`POST ${route}\``), `Admin Endpoints must list POST ${route}`);
  }
  assert.equal(adminSec.includes('/api/town/admin/plot'), false, 'Admin Endpoints must not list any /plot route');

  // Honest live-lag note in deployment-status box
  const deployLineMatch = skillMd.match(/^> \*\*Deployment status:\*\*.*$/m);
  assert.ok(deployLineMatch, 'SKILL.md must include Deployment status box');
  const deployLine = deployLineMatch[0];
  assert.ok(deployLine.includes('events'), 'Deployment status must mention events live lag');
  assert.ok(deployLine.includes('guestbook_by_plot'), 'Deployment status must mention guestbook_by_plot live lag');
  assert.match(deployLine, /predates|not yet/i, 'Deployment status must note live API predates those fields');
  assert.match(deployLine, /deploy/i, 'Deployment status must note they arrive with the API update deploy');
});

test('SKILL.md §1 quickstart exports, CLI subcommands, and examples match ghostlight-client.mjs', () => {
  assert.ok(clientSrc.includes('export class GhostlightClient'), 'GhostlightClient must be exported');
  assert.ok(clientSrc.includes('export function generateKeypair('), 'generateKeypair must be exported');
  assert.ok(
    skillMd.includes("import { GhostlightClient, generateKeypair } from './town-api/ghostlight-client.mjs'"),
    'SKILL.md §1 must show canonical GhostlightClient + generateKeypair import'
  );

  const cliUsageMatch = clientSrc.match(/const CLI_USAGE = \[([\s\S]*?)\]\.join\('\\n'\);/);
  assert.ok(cliUsageMatch, 'Could not find CLI_USAGE in ghostlight-client.mjs');
  const cliCommands = [...cliUsageMatch[1].matchAll(/'  ([a-z][a-z-]*)\s+/g)].map((m) => m[1]);
  assert.equal(cliCommands.length, 11, 'Expected 11 CLI subcommands in CLI_USAGE');

  for (const cmd of cliCommands) {
    assert.ok(skillMd.includes(`\`${cmd}\``), `SKILL.md §1 must list CLI subcommand ${cmd}`);
  }

  // Verify the CLI examples in SKILL.md use flags accepted by parseCliFlags for each command
  const allowedFlagsByCmd = {
    keygen: ['out', 'api-base'],
    'guest-checkin': ['api-base', 'handle', 'key', 'status-text'],
    'guest-say': ['api-base', 'handle', 'key', 'body', 'kind', 'reply-to'],
    join: ['api-base', 'handle', 'key', 'origin', 'bio', 'invite-code'],
    checkin: ['api-base', 'handle', 'key', 'status-text', 'slot'],
    say: ['api-base', 'handle', 'key', 'body', 'kind', 'reply-to'],
  };
  for (const [cmd, flags] of Object.entries(allowedFlagsByCmd)) {
    const lineMatch = skillMd.match(new RegExp(`^node town-api/ghostlight-client\\.mjs ${cmd} (.+)$`, 'm'));
    assert.ok(lineMatch, `SKILL.md §1 must include CLI example for ${cmd}`);
    const usedFlags = [...lineMatch[1].matchAll(/--([a-z-]+)/g)].map((m) => m[1]);
    assert.ok(usedFlags.length > 0, `CLI example for ${cmd} must pass flags`);
    for (const flag of usedFlags) {
      assert.ok(flags.includes(flag), `CLI example flag --${flag} is not valid for ${cmd}`);
      assert.ok(
        clientSrc.includes(`'${flag}'`) || clientSrc.includes(`"${flag}"`),
        `ghostlight-client.mjs must accept --${flag} for ${cmd}`
      );
    }
  }
});

test('SKILL.md deployment-status box pins live-lag 8-key payload and ports 8124/8125', () => {
  const deployLineMatch = skillMd.match(/^> \*\*Deployment status:\*\*.*$/m);
  assert.ok(deployLineMatch, 'SKILL.md must include Deployment status box');
  const deployLine = deployLineMatch[0];

  const live8Keys = [
    'footlights',
    'guestbook',
    'inn',
    'nightly_call',
    'plots',
    'presence',
    'prompt_book',
    'state_seq',
  ];
  for (const key of live8Keys) {
    assert.ok(deployLine.includes(`\`${key}\``), `Deployment status must list live 8-key field ${key}`);
  }
  assert.ok(deployLine.includes('8-key'), 'Deployment status must note 8-key payload');
  assert.ok(deployLine.includes('http://127.0.0.1:8124'), 'Deployment status must note local default 8124');
  assert.ok(deployLine.includes('TOWN_PORT=8125'), 'Deployment status must note homelab TOWN_PORT=8125');
  assert.ok(deployLine.includes('https://milo.4167360.xyz'), 'Deployment status must note live origin');
  assert.ok(deployLine.includes('/api/town/*'), 'Deployment status must note /api/town/* path');
});

test('SKILL.md §3 endpoint inventory and origins match town.json', () => {
  const townJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  assert.ok(Array.isArray(townJson.endpoints) && townJson.endpoints.length > 0);

  const nonAdminRoutes = townJson.endpoints.filter((e) => e.auth !== 'admin');
  const adminRoutes = townJson.endpoints.filter((e) => e.auth === 'admin');

  for (const ep of nonAdminRoutes) {
    getEndpointSection(ep.method, ep.path);
  }

  const adminStart = skillMd.indexOf('### Admin Endpoints');
  assert.ok(adminStart !== -1, 'Missing ### Admin Endpoints section in SKILL.md');
  const adminEnd = skillMd.indexOf('\n---', adminStart);
  const adminSec = skillMd.slice(adminStart, adminEnd !== -1 ? adminEnd : skillMd.length);
  for (const ep of adminRoutes) {
    assert.ok(adminSec.includes(`\`${ep.method} ${ep.path}\``), `Admin section must list ${ep.method} ${ep.path}`);
  }

  // Ensure SKILL.md §3 does not document routes absent from town.json
  const documentedHeadings = [...skillMd.matchAll(/^### `(GET|POST|PUT|DELETE) (\/api\/town\/[^?\s`]+)/gm)];
  const townJsonSet = new Set(townJson.endpoints.map((e) => `${e.method} ${e.path}`));
  for (const m of documentedHeadings) {
    const key = `${m[1]} ${m[2]}`;
    assert.ok(townJsonSet.has(key), `SKILL.md documents ${key} which is missing from town.json`);
  }

  for (const origin of townJson.origins) {
    assert.ok(skillMd.includes(origin), `SKILL.md must document origin ${origin}`);
  }
});

test('SKILL.md §3 guestbook limits, query params, and error codes match server.mjs', () => {
  const postGb = getEndpointSection('POST', '/api/town/guestbook');
  assert.ok(postGb.includes('`guestbook` or `letter`'), 'POST guestbook must document kinds');
  assert.ok(postGb.includes('201` `{ id, status: "pending" }`'), 'POST guestbook must document 201 pending response');
  for (const errCode of [
    'invalid_kind',
    'invalid_name',
    'invalid_body',
    'urls_not_allowed',
    'invalid_plot',
    'unknown_plot',
  ]) {
    assert.ok(serverSrc.includes(`'${errCode}'`), `server.mjs must emit ${errCode}`);
    assert.ok(postGb.includes(`\`${errCode}\``), `SKILL.md POST guestbook must document ${errCode}`);
  }

  const getGb = getEndpointSection('GET', '/api/town/guestbook');
  assert.ok(serverSrc.includes('let limit = 50;') && serverSrc.includes('Math.min(parsed, 50)'), 'server.mjs guestbook limit must be 1..50 default 50');
  assert.ok(getGb.includes('?limit=1..50` (default `50`)'), 'GET guestbook must document limit 1..50 default 50');
  for (const errCode of ['invalid_kind', 'invalid_plot', 'unknown_plot', 'invalid_limit']) {
    assert.ok(getGb.includes(`\`${errCode}\``), `SKILL.md GET guestbook must document ${errCode}`);
  }
});

test('SKILL.md §4 porch remap/sandbox, §6 shipped-list, relative links, and banned terms match repo', () => {
  const townJsSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/town.js'), 'utf8');
  const cottagePropsSrc = fs.readFileSync(path.join(REPO_ROOT, 'staging-polyfork/cottage-props.mjs'), 'utf8');
  const stagingHtml = fs.readFileSync(path.join(REPO_ROOT, 'staging-polyfork/index.html'), 'utf8');
  const townJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));

  // 9 starter props match town.json
  assert.equal(townJson.plot.starter_props.length, 9);
  for (const kind of townJson.plot.starter_props) {
    assert.ok(skillMd.includes(`\`${kind}\``), `SKILL.md must list starter prop ${kind}`);
  }

  // Porch deck coordinate remap (2.05 .. 3.45) and iframe sandbox=""
  assert.ok(townJsSrc.includes('PORCH_NEAR = 2.05') && townJsSrc.includes('PORCH_FAR = 3.45'));
  assert.ok(cottagePropsSrc.includes('PORCH_NEAR = 2.05') && cottagePropsSrc.includes('PORCH_FAR = 3.45'));
  assert.ok(skillMd.includes('< 2.05') && skillMd.includes('[2.05, 3.45]'), 'SKILL.md §4 must state porch remap [2.05, 3.45]');
  assert.match(stagingHtml, /<iframe[^>]+sandbox=""/, 'staging-polyfork/index.html must use sandbox=""');
  assert.ok(skillMd.includes('<iframe sandbox="">'), 'SKILL.md §4 must document <iframe sandbox="">');

  // §6 shipped-list files exist on disk
  for (const relPath of ['staging-polyfork/events.json', 'town-api/events.mjs', 'staging-polyfork/event-banner.mjs']) {
    assert.ok(skillMd.includes(`\`${relPath}\``), `SKILL.md §6 must reference ${relPath}`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relPath)), `Referenced file ${relPath} must exist on disk`);
  }

  // Every relative markdown link in SKILL.md resolves on disk
  for (const m of skillMd.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = m[1];
    if (/^https?:\/\//i.test(target) || target.startsWith('#')) continue;
    const targetPath = path.join(REPO_ROOT, target.split('#')[0]);
    assert.ok(fs.existsSync(targetPath), `Relative link in SKILL.md does not exist on disk: ${target}`);
  }

  // No banned term
  assert.doesNotMatch(skillMd, /campfire/i, 'SKILL.md must not contain banned term');
});

test('SKILL.md join handle regex, origins, and invite-to-active match server.mjs', () => {
  const joinSec = getEndpointSection('POST', '/api/town/join');

  assert.ok(serverSrc.includes('const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;'));
  assert.ok(joinSec.includes('`^[a-z0-9][a-z0-9_-]{1,31}$`'), 'join section must document handle regex');

  assert.ok(serverSrc.includes("new Set(['musebook', 'colony', 'rstation', 'guestbook', 'direct'])"));
  for (const origin of ['musebook', 'colony', 'rstation', 'guestbook', 'direct']) {
    assert.ok(joinSec.includes(origin), `join section must document origin ${origin}`);
  }

  assert.ok(serverSrc.includes("const status = 'active';"));
  assert.ok(
    joinSec.includes('`status` is `active` with or without a valid `invite_code`'),
    'join section must document active status with or without invite_code'
  );

  for (const errCode of ['handle_taken', 'pubkey_taken']) {
    assert.ok(serverSrc.includes(`'${errCode}'`), `server.mjs must emit ${errCode}`);
    assert.ok(joinSec.includes(`\`${errCode}\``), `join section must document ${errCode}`);
  }

  assert.ok(serverSrc.includes("{ error: 'invalid_invite' }"));
  assert.ok(joinSec.includes('invalid/expired invite'), 'join section must document invalid/expired invite');
});

test('SKILL.md leave and presence sections match server.mjs responses and zone rules', () => {
  const leaveSec = getEndpointSection('POST', '/api/town/ghostlight/leave');
  assert.ok(serverSrc.includes('{ handle, extinguished: true, state_seq: stateSeq }'));
  assert.ok(
    leaveSec.includes('`200` `{ handle, extinguished: true, state_seq }`'),
    'leave section must document 200 response'
  );
  assert.ok(leaveSec.includes('**Body:** `{}`'), 'leave section must document empty body');

  const presenceSec = getEndpointSection('POST', '/api/town/presence');
  assert.ok(serverSrc.includes('const ZONE_PLOT_RE = /^plot:([a-z0-9][a-z0-9_-]{1,31})$/;'));
  assert.ok(
    presenceSec.includes('(`gate`, `bandstand`, or `plot:<handle>`)'),
    'presence section must document zone rules'
  );
  assert.ok(serverSrc.includes('sendJson(res, 200, { handle, zone, updated_at: now, state_seq: stateSeq })'));
  assert.ok(
    presenceSec.includes('`200` `{ handle, zone, updated_at, state_seq }`'),
    'presence section must document 200 response'
  );
  assert.ok(serverSrc.includes("{ error: 'invalid_zone' }"));
});

test('SKILL.md GET plot response and 404 match server.mjs and client getPlot', () => {
  const plotSec = getEndpointSection('GET', '/api/town/plot?handle=<handle>');
  assert.ok(serverSrc.includes('handle: resident.handle,') && serverSrc.includes('plot_updated_at: resident.plot_updated_at,'));
  assert.ok(
    plotSec.includes('`200` `{ handle, manifest, html, plot_updated_at }`'),
    'GET plot section must document 200 response'
  );

  assert.ok((serverSrc.match(/plot_not_found/g) || []).length >= 2, 'server.mjs must emit plot_not_found >= 2 times');
  assert.ok(plotSec.includes('`404` (`plot_not_found`)'), 'GET plot section must document 404 plot_not_found');

  assert.ok(clientSrc.includes('async getPlot(handle)'), 'ghostlight-client.mjs must define getPlot(handle)');
  assert.ok(skillMd.includes("client.getPlot('your-handle')"), 'SKILL.md must show client.getPlot example');
});

test('SKILL.md inn vacate no-limit and extend error list match server.mjs', () => {
  const vacateSec = getEndpointSection('POST', '/api/town/inn/vacate');
  assert.ok(!serverSrc.includes('inn-vacate'), 'server.mjs must not rate-limit inn/vacate');
  assert.equal((serverSrc.match(/rateLimiter\.consume/g) || []).length, 14, 'expected 14 rateLimiter.consume calls in server.mjs');
  assert.ok(vacateSec.includes('**Rate limit:** none.'), 'inn/vacate section must document no rate limit');
  assert.ok(serverSrc.includes('vacated: true,'));
  assert.ok(
    vacateSec.includes('`200` `{ room, handle, vacated: true, state_seq }`'),
    'inn/vacate section must document 200 response'
  );

  const extendSec = getEndpointSection('POST', '/api/town/inn/extend');
  assert.ok(serverSrc.includes("{ error: 'max_stay_exceeded' }"));
  for (const errCode of [
    'invalid_room',
    'missing_key',
    'invalid_extra_nights',
    'max_stay_exceeded',
    'claim_not_found',
    'invalid_key',
  ]) {
    assert.ok(extendSec.includes(`\`${errCode}\``), `inn/extend section must document ${errCode}`);
  }
  assert.ok(
    extendSec.includes('total `nights + extra_nights` from claim cannot exceed `7`'),
    'inn/extend section must document 7-night max stay'
  );
});

test('SKILL.md key rotate errors, response, and 44-char pubkey match server.mjs and client', () => {
  const rotateSec = getEndpointSection('POST', '/api/town/key/rotate');
  for (const errCode of ['missing_pubkey', 'invalid_pubkey', 'same_pubkey']) {
    assert.ok(serverSrc.includes(`'${errCode}'`), `server.mjs must emit ${errCode}`);
    assert.ok(rotateSec.includes(`\`${errCode}\``), `key/rotate section must document ${errCode}`);
  }

  assert.ok(serverSrc.includes("{ error: 'pubkey_taken' }"));
  assert.ok(rotateSec.includes('`409` (`pubkey_taken`)'), 'key/rotate section must document 409 pubkey_taken');

  assert.ok(serverSrc.includes('rotated: true,'));
  assert.ok(
    rotateSec.includes('`200` `{ handle, rotated: true, state_seq }`'),
    'key/rotate section must document 200 response'
  );

  assert.ok(clientSrc.includes('async rotateKey('), 'ghostlight-client.mjs must define rotateKey');
  assert.ok(
    clientSrc.includes("spkiDer.subarray(12).toString('base64')"),
    'generateKeypair must strip 12-byte SPKI prefix'
  );
  assert.ok(skillMd.includes('44-character raw base64 public key'), 'SKILL.md §2 must document 44-char pubkey');
  assert.ok(
    rotateSec.includes('44 chars; must differ from your current key'),
    'key/rotate section must document 44-char different key rule'
  );
});

test('SKILL.md §2 signing headers and canonical string match client; guestbook 400s burn no quota', () => {
  for (const header of ['X-Muse-Handle', 'X-Muse-Timestamp', 'X-Muse-Nonce', 'X-Muse-Signature']) {
    assert.ok(clientSrc.includes(`'${header}':`), `ghostlight-client.mjs must send ${header}`);
    assert.ok(skillMd.includes(`\`${header}\``), `SKILL.md must document ${header}`);
  }

  assert.ok(
    clientSrc.includes('`${method.toUpperCase()}\\n${path}\\n${ts}\\n${reqNonce}\\n${bodyHash}`'),
    'ghostlight-client.mjs must construct expected canonical signing string'
  );
  assert.ok(
    skillMd.includes('{METHOD}\\n{PATH}\\n{TIMESTAMP}\\n{NONCE}\\n{SHA256_HEX(raw_body)}'),
    'SKILL.md §2 must document canonical signing string'
  );

  const gbStart = serverSrc.indexOf('function handlePostGuestbook');
  const gbEnd = serverSrc.indexOf('function handleGetGuestbook');
  assert.ok(gbStart !== -1 && gbEnd > gbStart, 'Could not slice handlePostGuestbook handler');
  const gbSlice = serverSrc.slice(gbStart, gbEnd);

  const consumeIdx = gbSlice.indexOf('rateLimiter.consume(`guestbook:');
  const invalidKindIdx = gbSlice.lastIndexOf("sendJson(res, 400, { error: 'invalid_kind' })");
  const unknownPlotIdx = gbSlice.lastIndexOf("sendJson(res, 400, { error: 'unknown_plot' })");
  assert.ok(consumeIdx !== -1 && invalidKindIdx !== -1 && unknownPlotIdx !== -1);
  assert.ok(consumeIdx > invalidKindIdx, 'invalid_kind 400 must happen before guestbook quota consume');
  assert.ok(consumeIdx > unknownPlotIdx, 'unknown_plot 400 must happen before guestbook quota consume');

  const guestbookSec = getEndpointSection('POST', '/api/town/guestbook');
  assert.ok(
    guestbookSec.includes('`400` validation errors burn no quota'),
    'POST guestbook section must document that 400s burn no quota'
  );
});

test('SKILL.md checkin slot range, 409s, and bandstand zone match server.mjs', () => {
  assert.ok(
    serverSrc.includes('if (!Number.isInteger(body.slot) || body.slot < 0 || body.slot > 9)'),
    'server.mjs must validate checkin slot 0..9'
  );
  assert.ok(serverSrc.includes("sendJson(res, 400, { error: 'invalid_slot' })"));
  assert.ok(serverSrc.includes("sendJson(res, 409, { error: 'slot_occupied', slot: body.slot })"));
  assert.ok(serverSrc.includes("sendJson(res, 409, { error: 'bandstand_full' })"));
  assert.ok(serverSrc.includes("ON CONFLICT(handle) DO UPDATE SET zone = 'bandstand'"));

  const checkinSec = getEndpointSection('POST', '/api/town/ghostlight/checkin');
  assert.ok(checkinSec.includes('`slot` optional `0..9`'));
  assert.ok(checkinSec.includes('`slot_occupied`'));
  assert.ok(checkinSec.includes('`bandstand_full`'));
  assert.ok(checkinSec.includes('sets your zone to `bandstand`'));
  // Known doc gap: SKILL.md checkin section omits invalid_slot; pinned as-is.
  assert.ok(!checkinSec.includes('invalid_slot'), 'checkin section should not mention invalid_slot (known doc gap)');
});

test('SKILL.md GET state since/304 and prompt_book window match server.mjs', () => {
  assert.ok(serverSrc.includes("url.searchParams.get('since')"));
  assert.ok(serverSrc.includes('if (Number.isInteger(since) && since === stateSeq)'));
  assert.ok(serverSrc.includes('sendEmpty(res, 304)'));
  assert.ok(serverSrc.includes('const cutoff24h = now - 24 * 60 * 60;'));
  assert.ok(serverSrc.includes('ORDER BY id DESC LIMIT 100'));

  const stateSec = getEndpointSection('GET', '/api/town/state');
  assert.ok(stateSec.includes('`?since=<state_seq>`'));
  assert.ok(stateSec.includes('`304` (empty body) when `since === state_seq`'));
  assert.ok(stateSec.includes('`prompt_book` holds the last ~24 h of remarks (plus the latest 100 lines)'));
});

test('SKILL.md §4 sanitizer denylist matches plot-validation.mjs', () => {
  const forbiddenMatch = plotValidationSrc.match(/const FORBIDDEN_TAGS = \[([^\]]+)\];/);
  assert.ok(forbiddenMatch, 'Could not find FORBIDDEN_TAGS in plot-validation.mjs');
  const forbiddenTags = [...forbiddenMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.equal(forbiddenTags.length, 9, 'FORBIDDEN_TAGS must have 9 entries');

  const s4Start = skillMd.indexOf('## 4. Your Plot');
  const s4End = skillMd.indexOf('\n## 5.', s4Start);
  assert.ok(s4Start !== -1 && s4End > s4Start, 'Could not slice SKILL.md §4');
  const s4 = skillMd.slice(s4Start, s4End);

  for (const tag of forbiddenTags) {
    assert.ok(s4.includes(`\`<${tag}>\``), `SKILL.md §4 must list <${tag}>`);
  }

  assert.ok(plotValidationSrc.includes("'javascript_uri'"));
  assert.ok(plotValidationSrc.includes("'vbscript_uri'"));
  assert.ok(plotValidationSrc.includes("stripped.includes('url(')"));
  assert.ok(plotValidationSrc.includes("'css_expression'"));
  assert.ok(plotValidationSrc.includes("if (!compact.startsWith('data:image/'))"));
  assert.ok(plotValidationSrc.includes('Return true iff tag is the exact allowed viewport meta'));

  assert.ok(s4.includes('`javascript:`/`vbscript:` URIs'));
  assert.ok(s4.includes('`expression(...)`/`url(...)`'));
  assert.ok(s4.includes('non-`image/` `data:` URIs'));
  assert.ok(s4.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">'));
});

test('SKILL.md guest inn error lists match server.mjs emissions', () => {
  const claimErrors = [
    'invalid_handle',
    'missing_pubkey',
    'invalid_room',
    'invalid_nights',
    'handle_taken',
    'room_already_claimed',
    'already_claimed',
  ];
  for (const errCode of claimErrors) {
    assert.ok(serverSrc.includes(errCode), `server.mjs must emit ${errCode}`);
  }
  assert.equal(
    (serverSrc.match(/pubkey_mismatch/g) || []).length,
    2,
    'expected pubkey_mismatch twice in server.mjs'
  );

  const guestClaimSec = getEndpointSection('POST', '/api/town/inn/guest/claim');
  for (const errCode of claimErrors) {
    assert.ok(guestClaimSec.includes(`\`${errCode}\``), `guest/claim section must document ${errCode}`);
  }
  assert.ok(guestClaimSec.includes('2/hour per guest'));

  const guestExtendSec = getEndpointSection('POST', '/api/town/inn/guest/extend');
  for (const errCode of [
    'invalid_handle',
    'missing_pubkey',
    'invalid_room',
    'missing_key',
    'invalid_extra_nights',
    'max_stay_exceeded',
    'invalid_key',
    'pubkey_mismatch',
    'claim_not_found',
    'handle_taken',
  ]) {
    assert.ok(guestExtendSec.includes(`\`${errCode}\``), `guest/extend section must document ${errCode}`);
  }

  const guestVacateSec = getEndpointSection('POST', '/api/town/inn/guest/vacate');
  for (const errCode of [
    'invalid_handle',
    'missing_pubkey',
    'invalid_room',
    'missing_key',
    'invalid_key',
    'pubkey_mismatch',
    'claim_not_found',
    'handle_taken',
  ]) {
    assert.ok(guestVacateSec.includes(`\`${errCode}\``), `guest/vacate section must document ${errCode}`);
  }
});

test('SKILL.md admin operator key and id-based moderation match server.mjs', () => {
  const adminStart = skillMd.indexOf('### Admin Endpoints');
  const adminEnd = skillMd.indexOf('\n---', adminStart);
  assert.ok(adminStart !== -1 && adminEnd > adminStart, 'Could not slice Admin Endpoints section');
  const adminSec = skillMd.slice(adminStart, adminEnd);

  assert.ok(adminSec.includes('`TOWN_OPERATOR_PUBKEY`'));
  assert.ok(
    adminSec.includes('approve or reject pending Town Gate guestbook entries, per-plot guestbook entries, or letters by `id`')
  );

  assert.ok(serverSrc.includes('process.env.TOWN_OPERATOR_PUBKEY'));
  assert.ok(serverSrc.includes("{ error: 'invalid_id' }"));
  assert.ok(serverSrc.includes("{ error: 'invalid_action' }"));
  assert.ok(serverSrc.includes("{ error: 'guestbook_not_found' }"));
  assert.ok(serverSrc.includes("{ error: 'already_decided', status: row.status }"));
  assert.ok(serverSrc.includes('sendJson(res, 200, { id, status });'));
  assert.ok(serverSrc.includes("{ error: 'line_not_found' }"));
  assert.ok(serverSrc.includes('sendJson(res, 200, { deleted: true, id, state_seq: stateSeq });'));
});

test('SKILL.md §5 Inn room names and key rules match town-3d/town.js; §6 no-upload pin', () => {
  const lanternIdx = townJsSrc.indexOf("label: 'The Lantern Room'");
  const windowIdx = townJsSrc.indexOf("label: 'The Window Room'");
  const quietIdx = townJsSrc.indexOf("label: 'The Quiet Room'");
  assert.ok(lanternIdx !== -1 && windowIdx !== -1 && quietIdx !== -1, 'INN_ROOM_DETAILS labels missing in town.js');
  assert.ok(lanternIdx < windowIdx && windowIdx < quietIdx, 'INN_ROOM_DETAILS labels out of order in town.js');

  const s5Start = skillMd.indexOf('## 5. Town Norms');
  const s5End = skillMd.indexOf('\n## 6.', s5Start);
  assert.ok(s5Start !== -1 && s5End > s5Start, 'Could not slice SKILL.md §5');
  const s5 = skillMd.slice(s5Start, s5End);

  assert.ok(s5.includes('`lantern` (**The Lantern Room**)'));
  assert.ok(s5.includes('`window` (**The Window Room**)'));
  assert.ok(s5.includes('`quiet` (**The Quiet Room**)'));
  assert.ok(s5.includes('12-character room key **once**'));
  assert.ok(s5.includes('there is no key recovery'));
  assert.ok(s5.includes('no apartments yet, and nothing is for sale'));
  assert.ok(s5.includes('the key is never exposed in `/api/town/state`'));

  assert.ok(!serverSrc.includes('upload'), 'server.mjs must not contain upload');
  const s6Start = skillMd.indexOf('## 6. What Is Not Built Yet');
  assert.ok(s6Start !== -1, 'Missing SKILL.md §6');
  assert.ok(skillMd.slice(s6Start).includes('**No plot image uploads:**'));
});

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-skill-test-'));
  const dbPath = opts.dbPath || path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const nowFn = opts.nowFn || (() => Math.floor(Date.now() / 1000) + clockOffset);

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
    nowFn,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    operatorKeys,
    db,
    nowSec: nowFn,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function rawPost(baseUrl, endpoint, payload, headers = {}) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function adminPost(ctx, endpoint, payload) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle: 'operator',
    privateKeyPem: ctx.operatorKeys.privateKeyPem,
  });
  const res = await fetch(`${ctx.baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('SKILL.md §3 common errors list matches server.mjs emissions', () => {
  const codes = [
    'missing_auth_headers',
    'stale_timestamp',
    'unknown_resident',
    'replayed_nonce',
    'invalid_signature',
    'resident_not_active',
    'plot_not_found',
    'claim_not_found',
    'handle_taken',
    'pubkey_taken',
    'slot_occupied',
    'room_already_claimed',
    'resident_already_claimed',
    'bandstand_full',
  ];
  for (const code of codes) {
    assert.ok(serverSrc.includes(`'${code}'`), `server.mjs must emit '${code}'`);
  }

  const start = skillMd.indexOf('Common errors:');
  const end = skillMd.indexOf('### `POST /api/town/join`', start);
  assert.ok(start !== -1 && end > start, 'Could not slice SKILL.md §3 Common errors intro');
  const intro = skillMd.slice(start, end);

  const expectedPhrases = [
    'missing headers, stale timestamp, unknown resident, replayed nonce, invalid signature',
    'suspended resident, or muted on speech',
    'missing plot or claim',
    'guest endpoints returning `409 handle_taken` when a guest handle collides with an existing resident',
    'pubkey taken, bandstand slot occupied, or inn room/resident already claimed',
    'rate limit exceeded',
  ];
  for (const phrase of expectedPhrases) {
    assert.ok(intro.includes(phrase), `SKILL.md §3 Common errors must include: ${phrase}`);
  }
});

test('SKILL.md §5 town clock matches run.mjs, characters.mjs, build-digest.mjs, and town.js', () => {
  const checks = [
    ['04:59', 'evening'],
    ['05:00', 'morning'],
    ['11:59', 'morning'],
    ['12:00', 'afternoon'],
    ['16:59', 'afternoon'],
    ['17:00', 'evening'],
    ['23:30', 'evening'],
  ];
  for (const [hhmm, expected] of checks) {
    const epochSec = Date.parse(`2026-11-22T${hhmm}:00-08:00`) / 1000;
    assert.equal(getPartOfDay(epochSec), expected, `getPartOfDay at ${hhmm} PST must be ${expected}`);
  }

  const runSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-npc/run.mjs'), 'utf8');
  const charsSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-npc/characters.mjs'), 'utf8');
  const digestSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/gazette/build-digest.mjs'), 'utf8');

  assert.ok(runSrc.includes("timeZone: 'America/Los_Angeles'"), 'town-npc/run.mjs must use America/Los_Angeles');
  assert.ok(charsSrc.includes('Town time is America/Los_Angeles'), 'town-npc/characters.mjs must state town time');
  assert.ok(
    digestSrc.includes("const TOWN_TIME_ZONE = 'America/Los_Angeles'") &&
      digestSrc.includes('timeZone: TOWN_TIME_ZONE'),
    'town-3d/gazette/build-digest.mjs must use TOWN_TIME_ZONE = America/Los_Angeles'
  );
  assert.ok(townJsSrc.includes("timeZone: 'America/Los_Angeles'"), 'town-3d/town.js must use America/Los_Angeles');

  assert.ok(skillMd.includes('Town time is `America/Los_Angeles` (PST/PDT)'));
  assert.ok(skillMd.includes('morning/afternoon/evening talk use town time'));
  assert.ok(skillMd.includes('the Gazette dates issues by town time'));
});

test('SKILL.md §1 guest limits: no footlight and no plot', () => {
  const gcStart = serverSrc.indexOf('function handleGuestCheckin');
  const gsStart = serverSrc.indexOf('function handleGuestSay');
  const gicStart = serverSrc.indexOf('function handleGuestInnClaim');
  assert.ok(gcStart !== -1 && gsStart > gcStart && gicStart > gsStart, 'Could not slice guest handlers in server.mjs');

  const gcSlice = serverSrc.slice(gcStart, gsStart);
  const gsSlice = serverSrc.slice(gsStart, gicStart);
  assert.doesNotMatch(gcSlice, /footlight/i, 'handleGuestCheckin must not reference footlight');
  assert.doesNotMatch(gsSlice, /footlight/i, 'handleGuestSay must not reference footlight');

  const sendMatch = gcSlice.match(/sendJson\(res,\s*200,\s*\{([\s\S]*?)\}\);/);
  assert.ok(sendMatch, 'Could not find 200 response literal in handleGuestCheckin');
  const respBlock = sendMatch[1];
  for (const absentKey of ['slot', 'lit_at', 'expires_at']) {
    assert.ok(!respBlock.includes(absentKey), `handleGuestCheckin response must not include ${absentKey}`);
  }
  for (const expectedKey of ['handle', "zone: 'bandstand'", 'updated_at', 'state_seq']) {
    assert.ok(respBlock.includes(expectedKey), `handleGuestCheckin response must include ${expectedKey}`);
  }

  assert.ok(
    serverSrc.includes("['PUT /api/town/plot', { mode: 'resident', handler: handlePutPlot }]"),
    'PUT /api/town/plot must be resident-only'
  );
  assert.ok(skillMd.includes('no footlight and no plot'), 'SKILL.md §1 step 2 must state no footlight and no plot');
});

test('SKILL.md §2 openssl keygen pipeline produces a usable 44-char key', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-openssl-test-'));
  try {
    const keyPath = path.join(tmpDir, 'k.pem');
    execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', keyPath]);
    const der = execFileSync('openssl', ['pkey', '-in', keyPath, '-pubout', '-outform', 'DER']);
    const rawPub = der.subarray(der.length - 32);
    assert.equal(rawPub.length, 32);
    const pubB64 = rawPub.toString('base64');
    assert.equal(pubB64.length, 44);
    assert.deepEqual(Buffer.from(pubB64, 'base64'), rawPub);

    const pem = fs.readFileSync(keyPath, 'utf8');
    const msg = Buffer.from('hello bandstand', 'utf8');
    const sig = crypto.sign(null, msg, crypto.createPrivateKey(pem));

    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const pubKey = crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, rawPub]),
      format: 'der',
      type: 'spki',
    });
    assert.equal(crypto.verify(null, msg, pubKey, sig), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.ok(skillMd.includes('openssl genpkey -algorithm ed25519 -out ghostlight-key.pem'));
  assert.ok(
    skillMd.includes("openssl pkey -in ghostlight-key.pem -pubout -outform DER | tail -c 32 | base64 | tr -d '\\n'")
  );
});

test('SKILL.md §3 guestbook letter+plot rejection and say reply rendering', async () => {
  const ctx = await startTestServer();
  try {
    const wickKeys = generateKeypair();
    const wick = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'wick',
      privateKeyPem: wickKeys.privateKeyPem,
      pubkey: wickKeys.pubkey,
    });
    const joinRes = await wick.join({ origin: 'colony', bio: 'scratch' });
    assert.equal(joinRes.status, 201);

    const badLetter = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'letter',
      name: 'A',
      body: 'hi',
      plot: 'wick',
    });
    assert.equal(badLetter.status, 400);
    assert.equal(badLetter.data.error, 'invalid_plot');

    const okGuestbook = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'guestbook',
      name: 'A',
      body: 'hi',
      plot: 'wick',
    });
    assert.equal(okGuestbook.status, 201);
    assert.equal(okGuestbook.data.status, 'pending');

    const okLetter = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'letter',
      name: 'A',
      body: 'hi',
    });
    assert.equal(okLetter.status, 201);
  } finally {
    await ctx.close();
  }

  const promptBookSrc = fs.readFileSync(path.join(REPO_ROOT, 'staging-polyfork/prompt-book.mjs'), 'utf8');
  assert.ok(promptBookSrc.includes('`\\u21a9 #${entry.reply_to} @${targetHandle}`'));
  assert.ok(promptBookSrc.includes('`\\u21a9 #${entry.reply_to}`'));
  assert.ok(skillMd.includes('Replies render as `↩ #N @handle`'));
  assert.ok(skillMd.includes('(`kind: "letter"` with `plot` is rejected)'));
});

test('SKILL.md §5 Inn room key is returned once and never in state', async () => {
  const ctx = await startTestServer();
  try {
    const aliceKeys = generateKeypair();
    const alice = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alice',
      privateKeyPem: aliceKeys.privateKeyPem,
      pubkey: aliceKeys.pubkey,
    });
    const joinRes = await alice.join({ origin: 'colony', bio: 'guest' });
    assert.equal(joinRes.status, 201);

    const approveRes = await adminPost(ctx, '/api/town/admin/approve', { handle: 'alice' });
    assert.equal(approveRes.status, 200);

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    assert.equal(typeof claimRes.data.key, 'string');
    assert.equal(claimRes.data.key.length, 12);

    const stateRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();
    assert.ok(state.inn && state.inn.lantern, 'state.inn.lantern must exist');
    assert.deepEqual(Object.keys(state.inn.lantern).sort(), ['expires_at', 'guest', 'handle', 'nights']);
    assert.equal(state.inn.lantern.handle, 'alice');
    assert.equal(JSON.stringify(state).includes(claimRes.data.key), false);
  } finally {
    await ctx.close();
  }

  assert.ok(skillMd.includes('the key is never exposed in `/api/town/state`'));
  assert.ok(skillMd.includes('public state only shows who holds each room and when the stay expires'));
});

async function signedPostAt(ctx, endpoint, payload, handle, privateKeyPem) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle,
    privateKeyPem,
    timestamp: ctx.nowSec(),
  });
  const res = await fetch(`${ctx.baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('SKILL.md §3 fish doc, rate limits, client methods, settle window, and no state_seq bump (G1)', async () => {
  const rl = parseRateLimits();
  assert.equal(rl.fishCast.max, 10);
  assert.equal(rl.fishCast.windowSec, 3600);
  assert.equal(parseServerConstNumber('SETTLE_SEC'), 300);

  const castSec = getEndpointSection('POST', '/api/town/fish/cast');
  assert.ok(castSec.includes('10/hour per resident'));
  assert.ok(castSec.includes('reel_at = cast_at + 300'));
  assert.ok(castSec.includes('5-minute settle'));
  assert.ok(castSec.includes('Does not bump `state_seq`'));

  const reelSec = getEndpointSection('POST', '/api/town/fish/reel');
  for (const code of ['already_cast', 'line_settling', 'no_active_cast', 'resident_muted']) {
    assert.ok(
      castSec.includes(code) || reelSec.includes(code) || skillMd.includes(code),
      `Missing ${code} in fish docs`
    );
  }
  assert.ok(clientSrc.includes('async fishCast('));
  assert.ok(clientSrc.includes('async fishReel('));

  let now = Math.floor(Date.now() / 1000);
  const ctx = await startTestServer({ nowFn: () => now });
  const catchKinds = new Set([
    'old_boot',
    'tin_kettle',
    'rusty_spoon',
    'soggy_glove',
    'tangled_string',
    'poem_in_a_bottle',
    'silver_minnow',
    'glass_float',
  ]);
  try {
    const keys = generateKeypair();
    const joined = await signedPostAt(
      ctx,
      '/api/town/join',
      { handle: 'alice', pubkey: keys.pubkey, origin: 'direct' },
      'alice',
      keys.privateKeyPem
    );
    assert.equal(joined.status, 201);

    const s0 = (await (await fetch(`${ctx.baseUrl}/api/town/state`)).json()).state_seq;

    const cast1 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast1.status, 201);
    assert.equal(cast1.data.reel_at, cast1.data.cast_at + 300);
    assert.equal((await (await fetch(`${ctx.baseUrl}/api/town/state`)).json()).state_seq, s0);

    const castDup = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(castDup.status, 409);
    assert.equal(castDup.data.error, 'already_cast');

    const earlyReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(earlyReel.status, 409);
    assert.equal(earlyReel.data.error, 'line_settling');

    now += 300;
    const okReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(okReel.status, 200);
    assert.ok(catchKinds.has(okReel.data.catch.kind));
    assert.equal(typeof okReel.data.catch.label, 'string');
    assert.equal(typeof okReel.data.catch.flavor, 'string');
    assert.equal((await (await fetch(`${ctx.baseUrl}/api/town/state`)).json()).state_seq, s0);

    const secondReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(secondReel.status, 404);
    assert.equal(secondReel.data.error, 'no_active_cast');
  } finally {
    await ctx.close();
  }
});

test('SKILL.md §3 guest fish doc, per-handle bucket, and resident-handle collision (G2)', async () => {
  const rl = parseRateLimits();
  assert.equal(rl.guestFishCast.max, 2);
  assert.equal(rl.guestFishCast.windowSec, 3600);

  const guestCastSec = getEndpointSection('POST', '/api/town/fish/guest/cast');
  assert.ok(guestCastSec.includes('2/hour per guest handle'));
  for (const code of ['invalid_handle', 'missing_pubkey', 'handle_taken', 'already_cast']) {
    assert.ok(guestCastSec.includes(code), `Missing ${code} in guest fish cast doc`);
  }

  assert.ok(
    skillMd.includes(
      'Guests can fish too via `POST /api/town/fish/guest/cast` and `POST /api/town/fish/guest/reel` with a tighter limit (2 casts/hour vs 10 casts/hour for residents)'
    )
  );
  for (const absentMethod of ['guestFishCast', 'guestFishReel', 'fishGuestCast', 'fishGuestReel']) {
    assert.equal(clientSrc.includes(absentMethod), false, `Unexpected ${absentMethod} in ghostlight-client.mjs`);
  }
  const guestReelSec = getEndpointSection('POST', '/api/town/fish/guest/reel');
  assert.equal(guestCastSec.includes('client.'), false);
  assert.equal(guestReelSec.includes('client.'), false);
  assert.ok(serverSrc.includes('`guest-fish-cast:${handle}`'));

  let now = Math.floor(Date.now() / 1000);
  const ctx = await startTestServer({ nowFn: () => now });
  const catchKinds = new Set([
    'old_boot',
    'tin_kettle',
    'rusty_spoon',
    'soggy_glove',
    'tangled_string',
    'poem_in_a_bottle',
    'silver_minnow',
    'glass_float',
  ]);
  try {
    const aliceKeys = generateKeypair();
    const joined = await signedPostAt(
      ctx,
      '/api/town/join',
      { handle: 'alice', pubkey: aliceKeys.pubkey, origin: 'direct' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(joined.status, 201);

    const gKeys = generateKeypair();
    const collision = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'alice', pubkey: gKeys.pubkey },
      'alice',
      gKeys.privateKeyPem
    );
    assert.equal(collision.status, 409);
    assert.equal(collision.data.error, 'handle_taken');

    const gCast = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor1', pubkey: gKeys.pubkey },
      'visitor1',
      gKeys.privateKeyPem
    );
    assert.equal(gCast.status, 201);

    const gEarly = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor1', pubkey: gKeys.pubkey },
      'visitor1',
      gKeys.privateKeyPem
    );
    assert.equal(gEarly.status, 409);
    assert.equal(gEarly.data.error, 'line_settling');

    now += 300;
    const gOk = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor1', pubkey: gKeys.pubkey },
      'visitor1',
      gKeys.privateKeyPem
    );
    assert.equal(gOk.status, 200);
    assert.ok(catchKinds.has(gOk.data.catch.kind));
  } finally {
    await ctx.close();
  }
});

test('SKILL.md §3 fish log doc and latest-first/empty/invalid behavior (G3)', async () => {
  const logSec = getEndpointSection('GET', '/api/town/fish/log?handle=<handle>');
  for (const phrase of ['latest first, cap 50', 'empty list if no catches', 'NOT a score or leaderboard', 'invalid_handle']) {
    assert.ok(logSec.includes(phrase), `Missing "${phrase}" in fish/log doc`);
  }
  assert.ok(serverSrc.includes('ORDER BY created_at DESC, id DESC LIMIT 50'));

  let now = Math.floor(Date.now() / 1000);
  const ctx = await startTestServer({ nowFn: () => now });
  try {
    const emptyRes = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=nobody`);
    assert.equal(emptyRes.status, 200);
    assert.deepEqual(await emptyRes.json(), { handle: 'nobody', catches: [], count: 0 });

    const badRes = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=BAD!`);
    assert.equal(badRes.status, 400);
    assert.equal((await badRes.json()).error, 'invalid_handle');

    const keys = generateKeypair();
    const joined = await signedPostAt(
      ctx,
      '/api/town/join',
      { handle: 'alice', pubkey: keys.pubkey, origin: 'direct' },
      'alice',
      keys.privateKeyPem
    );
    assert.equal(joined.status, 201);

    assert.equal((await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem)).status, 201);
    now += 300;
    assert.equal((await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem)).status, 200);
    now += 10;
    assert.equal((await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem)).status, 201);
    now += 300;
    assert.equal((await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem)).status, 200);

    const logRes = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=alice`);
    assert.equal(logRes.status, 200);
    const log = await logRes.json();
    assert.equal(log.count, 2);
    assert.equal(log.catches.length, 2);
    assert.ok(log.catches[0].caught_at > log.catches[1].caught_at);
    for (const c of log.catches) {
      assert.equal(typeof c.kind, 'string');
      assert.equal(typeof c.label, 'string');
      assert.equal(typeof c.flavor, 'string');
      assert.equal(typeof c.caught_at, 'number');
    }
  } finally {
    await ctx.close();
  }
});

test('SKILL.md §3 garden doc, slots, bed-full, and UTC-day growth stages (G4)', async () => {
  const rl = parseRateLimits();
  assert.equal(rl.gardenPlant.max, 10);
  assert.equal(rl.gardenPlant.windowSec, 3600);

  const gardenSec = getEndpointSection('POST', '/api/town/garden/plant');
  for (const seed of ['moonflower', 'lantern_poppy', 'tea_mint', 'starwort', 'ghost_bell', 'silver_thyme']) {
    assert.ok(gardenSec.includes(seed), `Missing seed ${seed} in garden/plant doc`);
  }
  assert.ok(gardenSec.includes('assigns lowest free slot `0..5`'));
  assert.ok(gardenSec.includes('stage: "sprout"'));
  assert.ok(gardenSec.includes('10/hour per resident'));
  assert.ok(gardenSec.includes('bumps `state_seq`'));
  for (const code of ['invalid_seed', 'already_planted', 'bed_full']) {
    assert.ok(gardenSec.includes(code), `Missing ${code} in garden/plant doc`);
  }

  assert.equal(parseServerConstNumber('GARDEN_SLOTS'), 6);
  const seedsMatch = serverSrc.match(/const\s+GARDEN_SEEDS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(seedsMatch, 'Could not find GARDEN_SEEDS in server.mjs');
  const seedKinds = [...seedsMatch[1].matchAll(/kind:\s*'([^']+)',\s*label:/g)].map((m) => m[1]).sort();
  assert.deepEqual(seedKinds, ['ghost_bell', 'lantern_poppy', 'moonflower', 'silver_thyme', 'starwort', 'tea_mint']);

  assert.ok(skillMd.includes('`sprout` (0–1 days) → `leaf` (2–3 days) → `bloom` (4+ days)'));

  // Live slots, duplicate, and bed-full
  {
    let now = Math.floor(Date.now() / 1000);
    const ctx = await startTestServer({ nowFn: () => now });
    try {
      const joinAndPlant = async (handle, seed) => {
        const keys = generateKeypair();
        const j = await signedPostAt(
          ctx,
          '/api/town/join',
          { handle, pubkey: keys.pubkey, origin: 'direct' },
          handle,
          keys.privateKeyPem
        );
        assert.equal(j.status, 201, `join failed for ${handle}`);
        const p = await signedPostAt(ctx, '/api/town/garden/plant', { seed }, handle, keys.privateKeyPem);
        return { keys, plant: p };
      };

      const aliceKeys = generateKeypair();
      assert.equal(
        (
          await signedPostAt(
            ctx,
            '/api/town/join',
            { handle: 'alice', pubkey: aliceKeys.pubkey, origin: 'direct' },
            'alice',
            aliceKeys.privateKeyPem
          )
        ).status,
        201
      );

      const badSeed = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: 'rose' },
        'alice',
        aliceKeys.privateKeyPem
      );
      assert.equal(badSeed.status, 400);
      assert.equal(badSeed.data.error, 'invalid_seed');

      const s0 = (await (await fetch(`${ctx.baseUrl}/api/town/state`)).json()).state_seq;
      const p0 = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: 'moonflower' },
        'alice',
        aliceKeys.privateKeyPem
      );
      assert.equal(p0.status, 201);
      assert.equal(p0.data.slot, 0);
      assert.equal(p0.data.seed, 'moonflower');
      assert.equal(p0.data.stage, 'sprout');
      assert.equal((await (await fetch(`${ctx.baseUrl}/api/town/state`)).json()).state_seq, s0 + 1);

      const dup = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: 'tea_mint' },
        'alice',
        aliceKeys.privateKeyPem
      );
      assert.equal(dup.status, 409);
      assert.equal(dup.data.error, 'already_planted');
      assert.equal(dup.data.slot, 0);
      assert.equal(dup.data.seed, 'moonflower');

      const fourHandles = ['bob', 'carol', 'dave', 'erin'];
      for (let i = 0; i < fourHandles.length; i++) {
        const { plant } = await joinAndPlant(fourHandles[i], 'starwort');
        assert.equal(plant.status, 201);
        assert.equal(plant.data.slot, i + 1);
      }

      now += 3601;
      const fay = await joinAndPlant('fay', 'starwort');
      assert.equal(fay.plant.status, 201);
      assert.equal(fay.plant.data.slot, 5);

      now += 3601;
      const gus = await joinAndPlant('gus', 'starwort');
      assert.equal(gus.plant.status, 409);
      assert.equal(gus.plant.data.error, 'bed_full');
    } finally {
      await ctx.close();
    }
  }

  // Growth stages derive from UTC days
  {
    let now = Math.floor(Date.now() / 1000);
    const ctx = await startTestServer({ nowFn: () => now });
    try {
      const keys = generateKeypair();
      assert.equal(
        (
          await signedPostAt(
            ctx,
            '/api/town/join',
            { handle: 'alice', pubkey: keys.pubkey, origin: 'direct' },
            'alice',
            keys.privateKeyPem
          )
        ).status,
        201
      );
      assert.equal(
        (await signedPostAt(ctx, '/api/town/garden/plant', { seed: 'moonflower' }, 'alice', keys.privateKeyPem))
          .status,
        201
      );

      const getStage = async () => {
        const st = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
        return st.garden.slots.find((s) => s.handle === 'alice')?.stage;
      };

      assert.equal(await getStage(), 'sprout');
      now += 2 * 86400;
      assert.equal(await getStage(), 'leaf');
      now += 2 * 86400;
      assert.equal(await getStage(), 'bloom');
      now += 30 * 86400;
      assert.equal(await getStage(), 'bloom');
    } finally {
      await ctx.close();
    }
  }
});

test('SKILL.md §3 guest garden doc and IP-keyed bucket match server.mjs and town.json (G5)', async () => {
  const rl = parseRateLimits();
  assert.equal(rl.guestGardenPlant.max, 2);
  assert.equal(rl.guestGardenPlant.windowSec, 3600);

  const guestGardenSec = getEndpointSection('POST', '/api/town/garden/guest/plant');
  assert.ok(guestGardenSec.includes('shares the 6-slot bed and one-planting-per-handle rule'));
  assert.ok(guestGardenSec.includes('2/hour'));
  assert.equal(guestGardenSec.includes('per guest'), false);
  for (const code of ['invalid_handle', 'missing_pubkey', 'invalid_seed', 'handle_taken', 'already_planted', 'bed_full']) {
    assert.ok(guestGardenSec.includes(code), `Missing ${code} in guest garden doc`);
  }

  const townJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const guestGardenEndpoint = townJson.endpoints.find((e) => e.path === '/api/town/garden/guest/plant');
  assert.ok(guestGardenEndpoint);
  assert.equal(guestGardenEndpoint.rate_limit, '2/hour');

  assert.ok(serverSrc.includes('`guest-garden-plant:${ip}`'));
  assert.ok(serverSrc.includes('`garden-plant:${auth.handle}`'));
  assert.ok(clientSrc.includes('async gardenGuestPlant('));
  assert.equal(guestGardenSec.includes('gardenGuestPlant'), false);

  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const g1 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a', pubkey: keys.pubkey, seed: 'moonflower' },
      'guest_a',
      keys.privateKeyPem
    );
    assert.equal(g1.status, 201);
    assert.equal(g1.data.slot, 0);

    const g2 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_b', pubkey: keys.pubkey, seed: 'tea_mint' },
      'guest_b',
      keys.privateKeyPem
    );
    assert.equal(g2.status, 201);
    assert.equal(g2.data.slot, 1);

    const g3 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_c', pubkey: keys.pubkey, seed: 'starwort' },
      'guest_c',
      keys.privateKeyPem
    );
    assert.equal(g3.status, 429);
    assert.equal(g3.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('SKILL.md §5 daily game doc, nightly_call/daily_game in state, and host rotation (G6)', async () => {
  const dgStart = skillMd.indexOf('### Daily game');
  const gardenStart = skillMd.indexOf('### Garden', dgStart);
  assert.ok(dgStart !== -1 && gardenStart !== -1);
  const dgSec = skillMd.slice(dgStart, gardenStart);

  for (const phrase of [
    'derived from the UTC date',
    'three rotating formats (riddle, word game, one-line story chain)',
    'served as `daily_game { date, format, prompt }`',
    'One seed NPC hosts it each day (rotating daily among Wick, Maren, and Tomas)',
  ]) {
    assert.ok(dgSec.includes(phrase), `Missing "${phrase}" in Daily game section`);
  }

  const games = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town-api/daily-games.json'), 'utf8'));
  const topics = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town-api/nightly-topics.json'), 'utf8'));
  assert.ok(Array.isArray(games) && games.length > 0);
  const validFormats = new Set(['riddle', 'word', 'story']);
  for (const entry of games) {
    assert.ok(validFormats.has(entry.format));
    assert.equal(typeof entry.prompt, 'string');
    assert.ok(entry.prompt.length >= 1 && entry.prompt.length <= 160);
  }
  assert.ok(Array.isArray(topics) && topics.length > 0);
  for (const t of topics) {
    assert.equal(typeof t, 'string');
  }

  const ctx = await startTestServer();
  try {
    const state = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    const todayUtc = new Date().toISOString().slice(0, 10);
    assert.equal(state.nightly_call.date, todayUtc);
    assert.ok(topics.includes(state.nightly_call.topic));
    assert.equal(state.daily_game.date, todayUtc);
    assert.ok(validFormats.has(state.daily_game.format));
    assert.ok(games.some((g) => g.prompt === state.daily_game.prompt && g.format === state.daily_game.format));
  } finally {
    await ctx.close();
  }

  assert.deepEqual(
    [
      dailyGameHostForDate('2026-11-24'),
      dailyGameHostForDate('2026-11-25'),
      dailyGameHostForDate('2026-11-26'),
    ].sort(),
    ['maren', 'tomas', 'wick']
  );
  assert.equal(dailyGameHostForDate('not-a-date'), null);
  assert.equal(dailyGameHostForDate(42), null);
  assert.equal(dailyGameHostForDate('2026-02-30'), null);
  assert.deepEqual(FORMAT_LABELS, { riddle: 'Riddle', word: 'Word game', story: 'Story chain' });
  assert.equal(buildDailyGameLine({}), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'bogus', prompt: 'x' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 'Why?' } }), "Today's game — Riddle: Why?");
});

test('SKILL.md say reply_to doc and validation match server.mjs (G7)', async () => {
  const saySec = getEndpointSection('POST', '/api/town/ghostlight/say');
  assert.ok(saySec.includes('`reply_to` optional positive integer id of an existing Prompt Book line'));
  assert.ok(saySec.includes('invalid_reply_to'));

  const guestSaySec = getEndpointSection('POST', '/api/town/ghostlight/guest/say');
  assert.ok(guestSaySec.includes('invalid_reply_to'));

  assert.equal((serverSrc.match(/invalid_reply_to/g) || []).length, 4);

  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    assert.equal(
      (
        await signedPostAt(
          ctx,
          '/api/town/join',
          { handle: 'alice', pubkey: keys.pubkey, origin: 'direct' },
          'alice',
          keys.privateKeyPem
        )
      ).status,
      201
    );

    for (const badId of [0, -5, 999999]) {
      const r = await signedPostAt(
        ctx,
        '/api/town/ghostlight/say',
        { body: 'nope', reply_to: badId },
        'alice',
        keys.privateKeyPem
      );
      assert.equal(r.status, 400);
      assert.equal(r.data.error, 'invalid_reply_to');
    }

    const first = await signedPostAt(
      ctx,
      '/api/town/ghostlight/say',
      { body: 'first line' },
      'alice',
      keys.privateKeyPem
    );
    assert.equal(first.status, 201);
    assert.equal(typeof first.data.id, 'number');

    const reply = await signedPostAt(
      ctx,
      '/api/town/ghostlight/say',
      { body: 'answer', reply_to: first.data.id },
      'alice',
      keys.privateKeyPem
    );
    assert.equal(reply.status, 201);
    assert.equal(reply.data.reply_to, first.data.id);

    const state = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    const pbEntry = state.prompt_book.find((e) => e.id === reply.data.id);
    assert.ok(pbEntry);
    assert.equal(pbEntry.reply_to, first.data.id);

    const gKeys = generateKeypair();
    const gBad = await signedPostAt(
      ctx,
      '/api/town/ghostlight/guest/say',
      { handle: 'visitor1', pubkey: gKeys.pubkey, body: 'hi', reply_to: 0 },
      'visitor1',
      gKeys.privateKeyPem
    );
    assert.equal(gBad.status, 400);
    assert.equal(gBad.data.error, 'invalid_reply_to');
  } finally {
    await ctx.close();
  }
});

test('SKILL.md checkin auto-slot, say TTL refresh, and leave doc and live behavior (G8)', async () => {
  assert.equal(parseServerConstNumber('FOOTLIGHT_TTL_SEC'), 2700);
  assert.ok(getEndpointSection('POST', '/api/town/ghostlight/checkin').includes('Lights your footlight for 45 minutes'));
  assert.ok(getEndpointSection('POST', '/api/town/ghostlight/say').includes('Refreshes your footlight TTL if lit'));
  assert.ok(getEndpointSection('POST', '/api/town/ghostlight/leave').includes('Puts your footlight out'));
  assert.ok(serverSrc.includes('UPDATE footlights SET expires_at = ? WHERE handle = ? AND expires_at > ?'));

  let now = Math.floor(Date.now() / 1000);
  const ctx = await startTestServer({ nowFn: () => now });
  try {
    const joinUser = async (handle) => {
      const keys = generateKeypair();
      const j = await signedPostAt(
        ctx,
        '/api/town/join',
        { handle, pubkey: keys.pubkey, origin: 'direct' },
        handle,
        keys.privateKeyPem
      );
      assert.equal(j.status, 201);
      return keys;
    };

    const aliceKeys = await joinUser('alice');
    const bobKeys = await joinUser('bob');
    const carolKeys = await joinUser('carol');

    const cAlice = await signedPostAt(ctx, '/api/town/ghostlight/checkin', {}, 'alice', aliceKeys.privateKeyPem);
    assert.equal(cAlice.status, 200);
    assert.equal(cAlice.data.slot, 0);
    assert.equal(cAlice.data.expires_at, cAlice.data.lit_at + 2700);

    const cBob = await signedPostAt(ctx, '/api/town/ghostlight/checkin', {}, 'bob', bobKeys.privateKeyPem);
    assert.equal(cBob.status, 200);
    assert.equal(cBob.data.slot, 1);

    const cCarol = await signedPostAt(ctx, '/api/town/ghostlight/checkin', { slot: 5 }, 'carol', carolKeys.privateKeyPem);
    assert.equal(cCarol.status, 200);
    assert.equal(cCarol.data.slot, 5);

    const stBefore = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    const before = stBefore.footlights.find((f) => f.handle === 'alice').expires_at;

    now += 1000;
    const sayRes = await signedPostAt(
      ctx,
      '/api/town/ghostlight/say',
      { body: 'still here' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(sayRes.status, 201);

    const stAfter = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    const after = stAfter.footlights.find((f) => f.handle === 'alice').expires_at;
    assert.ok(after > before);
    assert.equal(after, ctx.nowSec() + 2700);

    const leaveRes = await signedPostAt(ctx, '/api/town/ghostlight/leave', {}, 'alice', aliceKeys.privateKeyPem);
    assert.equal(leaveRes.status, 200);
    assert.equal(leaveRes.data.extinguished, true);

    const stFinal = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    assert.equal(stFinal.footlights.some((f) => f.handle === 'alice'), false);
  } finally {
    await ctx.close();
  }
});

test('SKILL.md invite one-time doc and single-use behavior (G9)', async () => {
  assert.ok(
    skillMd.includes('With a valid one-time `invite_code`, `join` returns `201` with `status: "active"` immediately.')
  );
  assert.equal(parseServerConstNumber('INVITE_TTL_SEC'), 7 * 24 * 60 * 60);
  assert.ok(serverSrc.includes('invite.used_at !== null'));
  assert.ok(serverSrc.includes('UPDATE invitations SET used_by = ?, used_at = ? WHERE code = ?'));

  const ctx = await startTestServer();
  try {
    const inv = await adminPost(ctx, '/api/town/admin/invite', {});
    assert.equal(inv.status, 201);
    assert.match(inv.data.code, /^[0-9a-f]{24}$/);
    assert.equal(inv.data.expires_at, ctx.nowSec() + 7 * 24 * 60 * 60);

    const aKeys = generateKeypair();
    const aJoin = await signedPostAt(
      ctx,
      '/api/town/join',
      { handle: 'alice', pubkey: aKeys.pubkey, origin: 'direct', invite_code: inv.data.code },
      'alice',
      aKeys.privateKeyPem
    );
    assert.equal(aJoin.status, 201);
    assert.equal(aJoin.data.status, 'active');

    const bKeys = generateKeypair();
    const bJoin = await signedPostAt(
      ctx,
      '/api/town/join',
      { handle: 'bob', pubkey: bKeys.pubkey, origin: 'direct', invite_code: inv.data.code },
      'bob',
      bKeys.privateKeyPem
    );
    assert.equal(bJoin.status, 403);
    assert.equal(bJoin.data.error, 'invalid_invite');

    const cKeys = generateKeypair();
    const cJoin = await signedPostAt(
      ctx,
      '/api/town/join',
      { handle: 'carol', pubkey: cKeys.pubkey, origin: 'direct', invite_code: 'deadbeefdeadbeefdeadbeef' },
      'carol',
      cKeys.privateKeyPem
    );
    assert.equal(cJoin.status, 403);
    assert.equal(cJoin.data.error, 'invalid_invite');
  } finally {
    await ctx.close();
  }
});

test('SKILL.md GET guestbook plot/letter doc and pending count-only lifecycle (G10)', async () => {
  const gbGetSec = getEndpointSection('GET', '/api/town/guestbook');
  assert.ok(gbGetSec.includes('When `plot` is omitted, returns Town Gate entries only'));
  assert.ok(gbGetSec.includes("returns approved entries for that cottage's plot — any resident's, or `milo`'s"));
  assert.ok(gbGetSec.includes('(`?plot=<handle>&kind=letter` returns an empty list)'));
  assert.ok(serverSrc.includes("SELECT COUNT(*) AS cnt FROM guestbook WHERE status = 'pending'"));

  const ctx = await startTestServer();
  try {
    const emptyPlotLetter = await fetch(`${ctx.baseUrl}/api/town/guestbook?plot=milo&kind=letter`);
    assert.equal(emptyPlotLetter.status, 200);
    assert.deepEqual(await emptyPlotLetter.json(), { entries: [] });

    const unknownPlot = await fetch(`${ctx.baseUrl}/api/town/guestbook?plot=wick`);
    assert.equal(unknownPlot.status, 400);
    assert.equal((await unknownPlot.json()).error, 'unknown_plot');

    const bodyText = 'zebra-plot-body-372';
    const postRes = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'guestbook',
      name: 'V',
      body: bodyText,
      plot: 'milo',
    });
    assert.equal(postRes.status, 201);
    assert.equal(postRes.data.status, 'pending');
    const entryId = postRes.data.id;

    const beforeApprove = await (await fetch(`${ctx.baseUrl}/api/town/guestbook?plot=milo`)).json();
    assert.deepEqual(beforeApprove.entries, []);

    const stPending = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    assert.equal(stPending.guestbook_pending, 1);
    assert.equal(JSON.stringify(stPending).includes(bodyText), false);

    const approveRes = await adminPost(ctx, '/api/town/admin/guestbook', { id: entryId, action: 'approve' });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.id, entryId);
    assert.equal(approveRes.data.status, 'approved');

    const afterApprove = await (await fetch(`${ctx.baseUrl}/api/town/guestbook?plot=milo`)).json();
    assert.equal(afterApprove.entries.length, 1);
    assert.equal(afterApprove.entries[0].body, bodyText);

    const stApproved = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    assert.equal(stApproved.guestbook_by_plot.milo, 1);

    const gateEntries = await (await fetch(`${ctx.baseUrl}/api/town/guestbook`)).json();
    assert.equal(gateEntries.entries.some((e) => e.body === bodyText), false);
  } finally {
    await ctx.close();
  }
});
