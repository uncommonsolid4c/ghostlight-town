/**
 * Drift-guard test for SKILL.md against town-api/server.mjs,
 * town-api/plot-validation.mjs, town-api/ghostlight-client.mjs,
 * town.json, town-3d/town.js, and staging-polyfork (Slices 125, 135).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');
const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/server.mjs'), 'utf8');
const plotValidationSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/plot-validation.mjs'), 'utf8');
const clientSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/ghostlight-client.mjs'), 'utf8');

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

  for (const methodName of ['claimInnRoom', 'extendInnStay', 'vacateInnRoom', 'rotateKey']) {
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
    'events: { now, next }',
    'nightly_call?',
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
  const cliCommands = [...cliUsageMatch[1].matchAll(/'  (\w+)\s+/g)].map((m) => m[1]);
  assert.equal(cliCommands.length, 9, 'Expected 9 CLI subcommands in CLI_USAGE');

  for (const cmd of cliCommands) {
    assert.ok(skillMd.includes(`\`${cmd}\``), `SKILL.md §1 must list CLI subcommand ${cmd}`);
  }

  // Verify the 4 CLI examples in SKILL.md use flags accepted by parseCliFlags for each command
  const allowedFlagsByCmd = {
    keygen: ['out', 'api-base'],
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
