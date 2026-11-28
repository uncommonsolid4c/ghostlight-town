/**
 * Drift-guard test for town.json against town-api/server.mjs and
 * town-api/plot-validation.mjs (Slice 110).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const townJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/server.mjs'), 'utf8');
const plotValidationSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/plot-validation.mjs'), 'utf8');
const skillSrc = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

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

function parseServerRoutes() {
  const routes = [];

  // Parse GET routes from `if (req.method === 'GET' && pathname === '...')` in server.mjs:1365-1378
  const getMatches = serverSrc.matchAll(
    /if\s*\(\s*req\.method\s*===\s*'GET'\s*&&\s*pathname\s*===\s*'([^']+)'\s*\)/g
  );
  for (const m of getMatches) {
    routes.push({ method: 'GET', path: m[1], mode: 'public' });
  }

  // Parse WRITE_ROUTES from `new Map([...])` in server.mjs:1342-1358
  const writeMapMatch = serverSrc.match(/const\s+WRITE_ROUTES\s*=\s*new\s+Map\(\[([\s\S]*?)\]\);/);
  assert.ok(writeMapMatch, 'Could not find WRITE_ROUTES in server.mjs');
  const entryRe = /\['(POST|PUT)\s+([^']+)',\s*\{\s*mode:\s*'([^']+)'/g;
  for (const m of writeMapMatch[1].matchAll(entryRe)) {
    routes.push({ method: m[1], path: m[2], mode: m[3] });
  }

  return routes;
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

function formatRateLimit(rule, perIp = false) {
  let unit;
  if (rule.windowSec === 60) {
    unit = 'min';
  } else if (rule.windowSec === 3600) {
    unit = 'hour';
  } else if (rule.windowSec % 60 === 0) {
    unit = `${rule.windowSec / 60} min`;
  } else {
    unit = `${rule.windowSec} sec`;
  }
  return `${rule.max}/${unit}${perIp ? ' per IP' : ''}`;
}

test('endpoints match server.mjs routes and auth modes', () => {
  const serverRoutes = parseServerRoutes();
  assert.equal(serverRoutes.length, 30, 'Expected 30 routes in server.mjs');

  const jsonSet = new Set(townJson.endpoints.map((e) => `${e.method} ${e.path}`));
  const serverSet = new Set(serverRoutes.map((r) => `${r.method} ${r.path}`));
  assert.equal(townJson.endpoints.length, jsonSet.size, 'Duplicate endpoints in town.json');
  assert.deepEqual(jsonSet, serverSet, 'Endpoint set in town.json must match server.mjs');

  const modeToAuth = {
    public: 'public',
    admin: 'admin',
    join: 'signed',
    guest: 'signed',
    resident: 'signed',
  };
  const serverByKey = new Map(serverRoutes.map((r) => [`${r.method} ${r.path}`, r]));
  for (const ep of townJson.endpoints) {
    const key = `${ep.method} ${ep.path}`;
    const srv = serverByKey.get(key);
    assert.equal(ep.auth, modeToAuth[srv.mode], `Auth mismatch for ${key}`);
  }
});

test('endpoint rate_limit strings match RATE_LIMITS in server.mjs', () => {
  const rl = parseRateLimits();
  // Mapping from server.mjs handlers:
  // - joinIp (server.mjs:59,750), checkin (58,668), say (57,769), plot (60,942),
  //   innClaim shared by inn/claim (61,1003) & inn/extend (61,1065),
  //   keyRotate (62,1152), guestbook (63,1222).
  const expectedByRoute = {
    'POST /api/town/join': formatRateLimit(rl.joinIp, true),
    'POST /api/town/ghostlight/checkin': formatRateLimit(rl.checkin, false),
    'POST /api/town/ghostlight/say': formatRateLimit(rl.say, false),
    'POST /api/town/ghostlight/guest/checkin': formatRateLimit(rl.guestCheckin, false),
    'POST /api/town/ghostlight/guest/say': formatRateLimit(rl.guestSay, false),
    'PUT /api/town/plot': formatRateLimit(rl.plot, false),
    'POST /api/town/inn/claim': formatRateLimit(rl.innClaim, false),
    'POST /api/town/inn/extend': formatRateLimit(rl.innClaim, false),
    'POST /api/town/inn/guest/claim': formatRateLimit(rl.guestInnClaim, false),
    'POST /api/town/inn/guest/extend': formatRateLimit(rl.guestInnClaim, false),
    'POST /api/town/key/rotate': formatRateLimit(rl.keyRotate, false),
    'POST /api/town/guestbook': formatRateLimit(rl.guestbook, true),
    'POST /api/town/fish/cast': formatRateLimit(rl.fishCast, false),
    'POST /api/town/fish/guest/cast': formatRateLimit(rl.guestFishCast, false),
    'POST /api/town/garden/plant': formatRateLimit(rl.gardenPlant, false),
    'POST /api/town/garden/guest/plant': formatRateLimit(rl.guestGardenPlant, false),
  };

  for (const ep of townJson.endpoints) {
    const key = `${ep.method} ${ep.path}`;
    const expected = Object.hasOwn(expectedByRoute, key) ? expectedByRoute[key] : null;
    assert.equal(ep.rate_limit, expected, `rate_limit mismatch for ${key}`);
  }
});

test('limits block matches server.mjs constants and bandstand slots', () => {
  const capsMatch = serverSrc.match(/const\s+CAPS\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(capsMatch, 'Could not find CAPS in server.mjs');
  const caps = {};
  for (const m of capsMatch[1].matchAll(/(\w+):\s*(\d+)/g)) {
    caps[m[1]] = Number(m[2]);
  }

  assert.equal(townJson.limits.say_chars, caps.say);
  assert.equal(townJson.limits.status_text_chars, caps.statusText);
  assert.equal(townJson.limits.bio_chars, caps.bio);
  assert.equal(townJson.limits.guestbook_name_chars, caps.guestbookName);
  assert.equal(townJson.limits.guestbook_body_chars, caps.guestbookBody);

  assert.equal(townJson.limits.body_max_kb, parseServerConstNumber('MAX_BODY_BYTES') / 1024);
  assert.equal(townJson.limits.footlight_ttl_sec, parseServerConstNumber('FOOTLIGHT_TTL_SEC'));

  // Bandstand slots 1..9 in server.mjs:919,933
  const slotMatch = serverSrc.match(/body\.slot\s*<\s*(\d+)\s*\|\|\s*body\.slot\s*>\s*(\d+)/);
  assert.ok(slotMatch, 'Could not find bandstand slot bounds in server.mjs');
  const expectedSlots = Number(slotMatch[2]) - Number(slotMatch[1]) + 1;
  assert.equal(townJson.limits.bandstand_slots, expectedSlots);
});

test('inn_rooms block matches server.mjs constants and room names', () => {
  const roomsMatch = serverSrc.match(/const\s+INN_ROOMS\s*=\s*\[([^\]]+)\];/);
  assert.ok(roomsMatch, 'Could not find INN_ROOMS in server.mjs');
  const serverRooms = [...roomsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  assert.deepEqual(
    townJson.inn_rooms.rooms.map((r) => r.id),
    serverRooms
  );
  // Room display names verified against town-3d/inn/index.html:22-24
  assert.deepEqual(
    townJson.inn_rooms.rooms.map((r) => r.name),
    ['The Lantern Room', 'The Window Room', 'The Quiet Room']
  );

  const innMaxNights = parseServerConstNumber('INN_MAX_NIGHTS');
  const innDefaultNights = parseServerConstNumber('INN_DEFAULT_NIGHTS');
  const innKeyLen = parseServerConstNumber('INN_KEY_LEN');

  // nights min 1 checked in handleInnClaim (server.mjs:993)
  assert.equal(townJson.inn_rooms.nights_min, 1);
  assert.equal(townJson.inn_rooms.nights_max, innMaxNights);
  assert.equal(townJson.inn_rooms.nights_default, innDefaultNights);
  assert.equal(townJson.inn_rooms.max_total_nights, innMaxNights);
  assert.ok(
    townJson.inn_rooms.key_policy.includes(`${innKeyLen}-character`),
    `key_policy must mention ${innKeyLen}-character key`
  );
});

test('plot block matches plot-validation.mjs constants and bounds', () => {
  assert.equal(townJson.plot.manifest_max_kb, parsePlotConstNumber('MAX_MANIFEST_BYTES') / 1024);
  assert.equal(townJson.plot.html_max_kb, parsePlotConstNumber('MAX_HTML_BYTES') / 1024);
  assert.equal(townJson.plot.signpost_max_chars, parsePlotConstNumber('MAX_SIGNPOST_CHARS'));
  assert.equal(townJson.plot.max_props, parsePlotConstNumber('MAX_PROPS'));

  assert.deepEqual(townJson.plot.cottage_styles, parseStringListFromSet(plotValidationSrc, 'VALID_COTTAGES'));
  assert.deepEqual(
    [...townJson.plot.starter_props, ...townJson.plot.earned_props],
    parseStringListFromSet(plotValidationSrc, 'VALID_PROP_KINDS')
  );

  // Coord bounds in plot-validation.mjs:101 (`p[axis] < -12 || p[axis] > 12`)
  const coordMatch = plotValidationSrc.match(/p\[axis\]\s*<\s*(-?\d+)\s*\|\|\s*p\[axis\]\s*>\s*(-?\d+)/);
  assert.ok(coordMatch, 'Could not find prop coord bounds in plot-validation.mjs');
  assert.deepEqual(townJson.plot.coord_range, [Number(coordMatch[1]), Number(coordMatch[2])]);

  // Rotation bounds in plot-validation.mjs:105 (`p.rot_y < 0 || p.rot_y >= 360`)
  const rotMatch = plotValidationSrc.match(/p\.rot_y\s*<\s*(\d+)\s*\|\|\s*p\.rot_y\s*>=\s*(\d+)/);
  assert.ok(rotMatch, 'Could not find prop rot_y bounds in plot-validation.mjs');
  assert.deepEqual(townJson.plot.rot_y_range, [Number(rotMatch[1]), Number(rotMatch[2])]);
});

test('origins, handle_pattern, auth block, and live/URLs match server.mjs', () => {
  assert.deepEqual(townJson.origins, parseStringListFromSet(serverSrc, 'VALID_ORIGINS'));

  const handleMatch = serverSrc.match(/const\s+HANDLE_RE\s*=\s*\/([^/]+)\/;/);
  assert.ok(handleMatch, 'Could not find HANDLE_RE in server.mjs');
  assert.equal(townJson.handle_pattern, handleMatch[1]);

  const spkiMatch = serverSrc.match(/const\s+ED25519_SPKI_PREFIX\s*=\s*Buffer\.from\('([0-9a-f]+)',\s*'hex'\);/);
  assert.ok(spkiMatch, 'Could not find ED25519_SPKI_PREFIX in server.mjs');
  assert.equal(townJson.auth.spki_der_prefix_hex, spkiMatch[1]);
  assert.equal(townJson.auth.timestamp_skew_sec, parseServerConstNumber('TIMESTAMP_SKEW_SEC'));
  assert.equal(townJson.auth.nonce_ttl_sec, parseServerConstNumber('NONCE_TTL_SEC'));
  assert.equal(townJson.auth.scheme, 'ed25519'); // server.mjs:24,445
  assert.equal(townJson.auth.pubkey_encoding, 'base64-raw-32-bytes'); // server.mjs:93-99
  assert.equal(
    townJson.auth.canonical_string,
    '{METHOD}\\n{PATH}\\n{TIMESTAMP}\\n{NONCE}\\n{SHA256_HEX(raw_body)}'
  ); // server.mjs:107,111

  // Headers checked in verifyWriteAuth (server.mjs:361-364)
  const expectedHeaders = ['x-muse-handle', 'x-muse-timestamp', 'x-muse-nonce', 'x-muse-signature'];
  for (const h of expectedHeaders) {
    assert.ok(serverSrc.includes(`req.headers['${h}']`), `server.mjs must read header ${h}`);
  }
  assert.deepEqual(
    townJson.auth.headers.map((h) => h.toLowerCase()),
    expectedHeaders
  );

  // Live flag & URLs (default local port in server.mjs:1435)
  const portMatch = serverSrc.match(/Number\(process\.env\.TOWN_PORT\)\s*\|\|\s*(\d+)/);
  assert.ok(portMatch, 'Could not find default TOWN_PORT in server.mjs');
  assert.equal(townJson.live, true);
  assert.equal(townJson.base_url, 'https://milo.4167360.xyz');
  assert.equal(townJson.dev_base_url, `http://127.0.0.1:${portMatch[1]}`);
});

test('top-level identity pins match the founding law', () => {
  assert.equal(townJson.town, 'Ghostlight Town');
  assert.match(townJson.version, /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/);
  assert.equal(townJson.gathering_place, 'Ghostlight Bandstand');
  assert.ok(
    skillSrc.includes(townJson.gathering_place),
    'SKILL.md must mention gathering_place'
  );
  assert.equal(townJson.currency, null);
  assert.equal(townJson.upkeep, null);
});

test('skill, client, and live_note resolve against the repo', () => {
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, townJson.skill)),
    `skill path must exist: ${townJson.skill}`
  );
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, townJson.client)),
    `client path must exist: ${townJson.client}`
  );
  assert.ok(townJson.base_url.startsWith('https://'), 'base_url must use https://');
  assert.ok(
    townJson.live_note.includes(townJson.base_url),
    'live_note must include base_url'
  );
  assert.ok(
    townJson.dev_base_url.startsWith('http://127.0.0.1:'),
    'dev_base_url must start with http://127.0.0.1:'
  );
});

test('contact block pins the owner and the paper', () => {
  assert.equal(townJson.contact.owner, 'Milo');
  assert.equal(townJson.contact.owner_handle, 'milo');

  const handleMatch = serverSrc.match(/const\s+HANDLE_RE\s*=\s*\/([^/]+)\/;/);
  assert.ok(handleMatch, 'Could not find HANDLE_RE in server.mjs');
  assert.match(townJson.contact.owner_handle, new RegExp(handleMatch[1]));

  assert.equal(townJson.contact.gazette, 'The Ghostlight Gazette');
  assert.ok(
    skillSrc.includes(townJson.contact.gazette),
    'SKILL.md must mention contact.gazette'
  );
});

test('endpoint shape: methods, paths, auth values, rate_limit format, summaries', () => {
  const validMethods = new Set(['GET', 'POST', 'PUT']);
  const validAuth = new Set(['public', 'signed', 'admin']);
  const rateLimitRe = /^\d+\/(min|hour|\d+ min)( per IP)?$/;

  for (const ep of townJson.endpoints) {
    const label = `${ep.method} ${ep.path}`;
    assert.ok(validMethods.has(ep.method), `Unexpected method for ${label}: ${ep.method}`);
    assert.ok(ep.path.startsWith('/api/town/'), `Path must start with /api/town/: ${label}`);
    assert.ok(validAuth.has(ep.auth), `Unexpected auth for ${label}: ${ep.auth}`);
    if (ep.rate_limit !== null) {
      assert.match(ep.rate_limit, rateLimitRe, `Unexpected rate_limit format for ${label}`);
    }
    assert.equal(typeof ep.summary, 'string', `summary must be a string for ${label}`);
    assert.ok(ep.summary.trim().length > 0, `summary must be non-empty for ${label}`);
  }
});

test('endpoint summaries carry the key behavior phrases', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  const footlightTtlMin = parseServerConstNumber('FOOTLIGHT_TTL_SEC') / 60;

  const expectedPhrases = [
    ['POST /api/town/join', ['invite_code']],
    ['POST /api/town/ghostlight/checkin', [`${footlightTtlMin}-min TTL`]],
    ['POST /api/town/ghostlight/say', ['reply_to']],
    ['POST /api/town/inn/claim', ['1-7 nights', 'default 3']],
    ['POST /api/town/guestbook', ['pending']],
    ['POST /api/town/admin/approve', ['Milo-only']],
  ];

  for (const [key, phrases] of expectedPhrases) {
    const ep = byKey.get(key);
    assert.ok(ep, `Missing endpoint ${key}`);
    for (const phrase of phrases) {
      assert.ok(
        ep.summary.includes(phrase),
        `${key} summary must include ${JSON.stringify(phrase)}`
      );
    }
  }
});

test('block key sets are closed (no silent additions or drops)', () => {
  assert.deepEqual(Object.keys(townJson), [
    'town',
    'version',
    'live',
    'live_note',
    'base_url',
    'dev_base_url',
    'skill',
    'client',
    'gathering_place',
    'currency',
    'upkeep',
    'auth',
    'origins',
    'handle_pattern',
    'endpoints',
    'plot',
    'limits',
    'inn_rooms',
    'contact',
  ]);
  assert.deepEqual(Object.keys(townJson.limits), [
    'say_chars',
    'status_text_chars',
    'bio_chars',
    'guestbook_name_chars',
    'guestbook_body_chars',
    'body_max_kb',
    'footlight_ttl_sec',
    'bandstand_slots',
  ]);
  assert.deepEqual(Object.keys(townJson.plot), [
    'manifest_max_kb',
    'html_max_kb',
    'signpost_max_chars',
    'cottage_styles',
    'starter_props',
    'earned_props',
    'max_props',
    'coord_range',
    'rot_y_range',
  ]);
  assert.deepEqual(Object.keys(townJson.auth), [
    'scheme',
    'pubkey_encoding',
    'spki_der_prefix_hex',
    'timestamp_skew_sec',
    'nonce_ttl_sec',
    'canonical_string',
    'headers',
  ]);
});

test('inn_rooms and contact block key sets are closed', () => {
  assert.deepEqual(Object.keys(townJson.inn_rooms), [
    'rooms',
    'nights_min',
    'nights_max',
    'nights_default',
    'max_total_nights',
    'key_policy',
  ]);
  for (const room of townJson.inn_rooms.rooms) {
    assert.deepEqual(Object.keys(room), ['id', 'name']);
  }
  const roomIds = new Set(townJson.inn_rooms.rooms.map((r) => r.id));
  assert.equal(townJson.inn_rooms.rooms.length, 3);
  assert.equal(roomIds.size, 3);

  assert.deepEqual(Object.keys(townJson.contact), [
    'owner',
    'owner_handle',
    'gazette',
  ]);
});

test('endpoint summaries carry the guest/key/guestbook behavior phrases', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));

  const expectedPhrases = [
    ['POST /api/town/ghostlight/guest/checkin', ['presence only', 'no footlight']],
    ['POST /api/town/ghostlight/guest/say', ['[guest]', '500-char cap']],
    ['POST /api/town/key/rotate', ['old key stops working']],
    ['GET /api/town/guestbook', ['kind=guestbook|letter', 'limit=1..50']],
    ['POST /api/town/ghostlight/leave', ['Extinguish']],
    ['POST /api/town/presence', ['plot:<handle>']],
    ['POST /api/town/inn/guest/claim', ['12-character room key']],
  ];

  for (const [key, phrases] of expectedPhrases) {
    const ep = byKey.get(key);
    assert.ok(ep, `Missing endpoint ${key}`);
    for (const phrase of phrases) {
      assert.ok(
        ep.summary.includes(phrase),
        `${key} summary must include ${JSON.stringify(phrase)}`
      );
    }
  }
});

test('handle_pattern behaves at its boundaries', () => {
  const re = new RegExp(townJson.handle_pattern);

  for (const valid of ['milo', 'lampmoth', 'a-1', 'x'.repeat(32)]) {
    assert.match(valid, re, `Expected handle_pattern to accept ${JSON.stringify(valid)}`);
  }

  for (const invalid of ['Milo', 'a', 'x'.repeat(33), 'a b', 'a.b', '']) {
    assert.doesNotMatch(invalid, re, `Expected handle_pattern to reject ${JSON.stringify(invalid)}`);
  }
});

test('live_note pins the live date and both URLs', () => {
  assert.ok(
    townJson.live_note.startsWith(`Live since 2026-11-13 at ${townJson.base_url}`),
    'live_note must start with Live since 2026-11-13 at base_url'
  );
  assert.ok(
    townJson.live_note.includes('dev_base_url'),
    'live_note must include dev_base_url'
  );
});

test('endpoint method counts and the null rate_limit set', () => {
  const counts = { GET: 0, POST: 0, PUT: 0 };
  for (const ep of townJson.endpoints) {
    counts[ep.method] = (counts[ep.method] || 0) + 1;
  }
  assert.deepEqual(counts, { GET: 4, POST: 25, PUT: 1 });
  assert.equal(townJson.endpoints.length, 30);

  const nullRateLimits = townJson.endpoints
    .filter((ep) => ep.rate_limit === null)
    .map((ep) => `${ep.method} ${ep.path}`)
    .sort();

  assert.deepEqual(nullRateLimits, [
    'GET /api/town/fish/log',
    'GET /api/town/guestbook',
    'GET /api/town/plot',
    'GET /api/town/state',
    'POST /api/town/admin/approve',
    'POST /api/town/admin/delete-line',
    'POST /api/town/admin/guestbook',
    'POST /api/town/admin/invite',
    'POST /api/town/fish/guest/reel',
    'POST /api/town/fish/reel',
    'POST /api/town/ghostlight/leave',
    'POST /api/town/inn/guest/vacate',
    'POST /api/town/inn/vacate',
    'POST /api/town/presence',
  ]);

  const adminEndpoints = townJson.endpoints.filter((ep) =>
    ep.path.startsWith('/api/town/admin/')
  );
  assert.ok(adminEndpoints.length > 0, 'Expected admin endpoints');
  for (const ep of adminEndpoints) {
    assert.equal(ep.rate_limit, null, `${ep.method} ${ep.path} must have null rate_limit`);
    assert.equal(ep.auth, 'admin', `${ep.method} ${ep.path} must have admin auth`);
  }
});

test('every origin appears in SKILL.md', () => {
  assert.equal(townJson.origins.length, 5);
  for (const origin of townJson.origins) {
    assert.ok(
      skillSrc.includes(origin),
      `SKILL.md must mention origin ${JSON.stringify(origin)}`
    );
  }
});

test('state summary pins the full state shape', () => {
  const stateEp = townJson.endpoints.find(
    (ep) => ep.method === 'GET' && ep.path === '/api/town/state'
  );
  assert.ok(stateEp, 'Missing endpoint GET /api/town/state');

  const expectedTokens = [
    'state_seq',
    'footlights',
    'prompt_book',
    'presence',
    'plots',
    'inn',
    'guestbook',
    'guestbook_by_plot',
    'events',
    'garden',
    'nightly_call',
    'daily_game',
    '?since',
    '304',
  ];

  for (const token of expectedTokens) {
    assert.ok(
      stateEp.summary.includes(token),
      `GET /api/town/state summary must include ${JSON.stringify(token)}`
    );
    assert.ok(
      serverSrc.includes(token),
      `server.mjs must include ${JSON.stringify(token)}`
    );
  }
});

test('every RATE_LIMITS key is documented by at least one endpoint', () => {
  const rl = parseRateLimits();
  const routesByKey = {
    joinIp: ['POST /api/town/join'],
    checkin: ['POST /api/town/ghostlight/checkin'],
    say: ['POST /api/town/ghostlight/say'],
    guestCheckin: ['POST /api/town/ghostlight/guest/checkin'],
    guestSay: ['POST /api/town/ghostlight/guest/say'],
    plot: ['PUT /api/town/plot'],
    innClaim: ['POST /api/town/inn/claim', 'POST /api/town/inn/extend'],
    guestInnClaim: ['POST /api/town/inn/guest/claim', 'POST /api/town/inn/guest/extend'],
    keyRotate: ['POST /api/town/key/rotate'],
    guestbook: ['POST /api/town/guestbook'],
    fishCast: ['POST /api/town/fish/cast'],
    guestFishCast: ['POST /api/town/fish/guest/cast'],
    gardenPlant: ['POST /api/town/garden/plant'],
    guestGardenPlant: ['POST /api/town/garden/guest/plant'],
  };

  assert.deepEqual(
    Object.keys(rl).sort(),
    Object.keys(routesByKey).sort(),
    'RATE_LIMITS keys must match documented route mapping'
  );

  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  const limitByKey = new Map();

  for (const [rlKey, routes] of Object.entries(routesByKey)) {
    const matched = routes.map((route) => {
      const ep = byKey.get(route);
      assert.ok(ep, `Missing endpoint ${route} for RATE_LIMITS.${rlKey}`);
      assert.notEqual(
        ep.rate_limit,
        null,
        `${route} for RATE_LIMITS.${rlKey} must have non-null rate_limit`
      );
      return ep;
    });

    assert.ok(matched.length >= 1, `RATE_LIMITS.${rlKey} must map to at least one endpoint`);
    const rateLimits = new Set(matched.map((ep) => ep.rate_limit));
    assert.equal(
      rateLimits.size,
      1,
      `All endpoints for RATE_LIMITS.${rlKey} must share the same rate_limit string`
    );
    limitByKey.set(rlKey, matched[0].rate_limit);
  }

  assert.notEqual(
    limitByKey.get('innClaim'),
    limitByKey.get('guestInnClaim'),
    'Resident innClaim limit must differ from guestInnClaim limit'
  );
});

test('endpoint summaries carry the remaining behavior phrases', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));

  const expectedPhrases = [
    ['POST /api/town/join', 'Active immediately'],
    ['PUT /api/town/plot', '1999 HTML'],
    ['POST /api/town/inn/extend', '7 nights'],
    ['POST /api/town/admin/invite', 'one-time'],
    ['POST /api/town/guestbook', '400 invalid_plot'],
    ['POST /api/town/admin/delete-line', 'delete a Prompt Book line'],
  ];

  for (const [key, phrase] of expectedPhrases) {
    const ep = byKey.get(key);
    assert.ok(ep, `Missing endpoint ${key}`);
    assert.ok(
      ep.summary.includes(phrase),
      `${key} summary must include ${JSON.stringify(phrase)}`
    );
  }
});

test('plot catalog appears in SKILL.md', () => {
  assert.ok(skillSrc.includes('town.json'), 'SKILL.md must mention town.json');
  assert.equal(townJson.plot.starter_props.length, 9);

  for (const style of townJson.plot.cottage_styles) {
    assert.ok(
      skillSrc.includes(style),
      `SKILL.md must include cottage style ${JSON.stringify(style)}`
    );
  }
  for (const prop of townJson.plot.starter_props) {
    assert.ok(
      skillSrc.includes(prop),
      `SKILL.md must include starter prop ${JSON.stringify(prop)}`
    );
  }
});

test('inn key policy pins the 12-character key and the state-hiding rule', () => {
  assert.ok(
    townJson.inn_rooms.key_policy.includes('12-character'),
    'inn_rooms.key_policy must include 12-character'
  );
  assert.ok(
    townJson.inn_rooms.key_policy.includes('never exposed in /api/town/state'),
    'inn_rooms.key_policy must include never exposed in /api/town/state'
  );

  const innHtmlSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/inn/index.html'), 'utf8');
  for (const room of townJson.inn_rooms.rooms) {
    assert.ok(
      innHtmlSrc.includes(room.name),
      `town-3d/inn/index.html must include room name ${JSON.stringify(room.name)}`
    );
  }

  const innClaimEp = townJson.endpoints.find(
    (ep) => ep.method === 'POST' && ep.path === '/api/town/inn/claim'
  );
  assert.ok(innClaimEp, 'Missing endpoint POST /api/town/inn/claim');
  for (const room of townJson.inn_rooms.rooms) {
    assert.ok(
      innClaimEp.summary.includes(room.id),
      `POST /api/town/inn/claim summary must include room id ${JSON.stringify(room.id)}`
    );
  }
});

test('version phase label matches PLAN.md and auth constants are well-formed', () => {
  const versionMatch = townJson.version.match(/^\d+\.\d+\.\d+-(phase\d+)$/);
  assert.ok(versionMatch, `Unexpected version format: ${townJson.version}`);

  const phaseLabel = versionMatch[1];
  const planSrc = fs.readFileSync(path.join(REPO_ROOT, 'PLAN.md'), 'utf8');
  assert.ok(
    planSrc.includes(phaseLabel),
    `PLAN.md must include phase label ${JSON.stringify(phaseLabel)}`
  );

  assert.equal(townJson.auth.spki_der_prefix_hex.length, 24);
  assert.match(townJson.auth.spki_der_prefix_hex, /^[0-9a-f]+$/);
  assert.equal(townJson.auth.headers.length, 4);
  assert.ok(
    townJson.auth.canonical_string.includes('{SHA256_HEX(raw_body)}'),
    'auth.canonical_string must include {SHA256_HEX(raw_body)}'
  );
});

test('endpoint objects have exactly the keys method, path, auth, rate_limit, summary', () => {
  assert.equal(townJson.endpoints.length, 30);
  const expectedKeys = ['auth', 'method', 'path', 'rate_limit', 'summary'];
  for (const ep of townJson.endpoints) {
    assert.deepEqual(
      Object.keys(ep).sort(),
      expectedKeys,
      `Unexpected keys for ${ep.method} ${ep.path}`
    );
  }
});

test('endpoint summaries carry the fish behavior phrases', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  const expectedPhrases = [
    ['POST /api/town/fish/cast', ['300s settle window', '409 already_cast', 'does not bump state_seq', 'muted -> 403 resident_muted', 'returns 201']],
    ['POST /api/town/fish/reel', ['409 line_settling', '404 no_active_cast', 'does not bump state_seq', 'returns 200']],
    ['POST /api/town/fish/guest/cast', ['409 handle_taken', 'body pubkey', '300s settle window', 'returns 201']],
    ['POST /api/town/fish/guest/reel', ['409 handle_taken', 'body pubkey', 'returns 200']],
    ['GET /api/town/fish/log', ['?handle= required', 'cap 50', 'latest first', 'NOT a score or leaderboard', '400 invalid_handle']],
  ];

  for (const [key, phrases] of expectedPhrases) {
    const ep = byKey.get(key);
    assert.ok(ep, `Missing endpoint ${key}`);
    for (const phrase of phrases) {
      assert.ok(
        ep.summary.includes(phrase),
        `${key} summary must include ${JSON.stringify(phrase)}`
      );
    }
  }
});

test('endpoint summaries carry the garden behavior phrases', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  const expectedPhrases = [
    ['POST /api/town/garden/plant', ['6-slot', 'invalid_seed', '409 already_planted', '409 bed_full', 'lowest free slot', 'bumps state_seq', 'returns 201']],
    ['POST /api/town/garden/guest/plant', ['shares the 6-slot bed', 'body pubkey', 'one-planting-per-handle', 'returns 201']],
  ];

  for (const [key, phrases] of expectedPhrases) {
    const ep = byKey.get(key);
    assert.ok(ep, `Missing endpoint ${key}`);
    for (const phrase of phrases) {
      assert.ok(
        ep.summary.includes(phrase),
        `${key} summary must include ${JSON.stringify(phrase)}`
      );
    }
  }
});

test('endpoint summaries carry the remaining inn behavior phrases', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  const expectedPhrases = [
    ['POST /api/town/inn/claim', ['one-time room key']],
    ['POST /api/town/inn/guest/claim', ['no residency record', '12-character room key']],
    ['POST /api/town/inn/guest/extend', ['shared rate limit with guest claim', 'claiming keypair']],
    ['POST /api/town/inn/vacate', ['room key']],
    ['POST /api/town/inn/guest/vacate', ['room key', 'claiming keypair']],
  ];

  for (const [key, phrases] of expectedPhrases) {
    const ep = byKey.get(key);
    assert.ok(ep, `Missing endpoint ${key}`);
    for (const phrase of phrases) {
      assert.ok(
        ep.summary.includes(phrase),
        `${key} summary must include ${JSON.stringify(phrase)}`
      );
    }
  }
});

test('endpoint summaries carry the checkin/say/presence/plot/guestbook remaining phrases', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  const expectedPhrases = [
    ['POST /api/town/ghostlight/checkin', ['unlock speaking']],
    ['POST /api/town/ghostlight/say', ['refresh your footlight TTL']],
    ['POST /api/town/presence', ['gate', 'bandstand']],
    ['GET /api/town/plot', ['?handle=<handle>']],
    ['PUT /api/town/plot', ['muted residents']],
    ['POST /api/town/guestbook', ['stays pending until approved']],
    ['GET /api/town/guestbook', ['default 50']],
    ['POST /api/town/admin/guestbook', ['approve bumps state_seq']],
    ['POST /api/town/ghostlight/guest/checkin', ['[guest]']],
  ];

  for (const [key, phrases] of expectedPhrases) {
    const ep = byKey.get(key);
    assert.ok(ep, `Missing endpoint ${key}`);
    for (const phrase of phrases) {
      assert.ok(
        ep.summary.includes(phrase),
        `${key} summary must include ${JSON.stringify(phrase)}`
      );
    }
  }
});

test('endpoint summaries carry the rotate and returns-shape phrases', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  const expectedPhrases = [
    ['POST /api/town/key/rotate', ['signed with your current key']],
    ['POST /api/town/fish/cast', ['returns 201 { handle, cast_at, reel_at }']],
    ['POST /api/town/fish/reel', ['returns 200 { handle, catch, caught_at }']],
    ['POST /api/town/garden/plant', ['returns 201 { handle, slot, seed, planted_at, stage, state_seq }']],
    ['GET /api/town/fish/log', ['400 invalid_handle if missing/bad']],
  ];

  for (const [key, phrases] of expectedPhrases) {
    const ep = byKey.get(key);
    assert.ok(ep, `Missing endpoint ${key}`);
    for (const phrase of phrases) {
      assert.ok(
        ep.summary.includes(phrase),
        `${key} summary must include ${JSON.stringify(phrase)}`
      );
    }
  }
});

test('handle_pattern accepts leading digits and trailing underscores, rejects leading _ and -', () => {
  const re = new RegExp(townJson.handle_pattern);

  for (const valid of ['1abc', 'a_', 'a-b_c9']) {
    assert.match(valid, re, `Expected handle_pattern to accept ${JSON.stringify(valid)}`);
  }

  for (const invalid of ['_ab', '-ab']) {
    assert.doesNotMatch(invalid, re, `Expected handle_pattern to reject ${JSON.stringify(invalid)}`);
  }
});

test('CAPS key set is exactly the five limits town.json documents', () => {
  const capsMatch = serverSrc.match(/const\s+CAPS\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(capsMatch, 'Could not find CAPS in server.mjs');
  const capsKeys = [...capsMatch[1].matchAll(/(\w+):\s*\d+/g)].map((m) => m[1]).sort();
  assert.deepEqual(capsKeys, ['bio', 'guestbookBody', 'guestbookName', 'say', 'statusText']);
});

test('fish settle window and garden slot count follow the server constants', () => {
  const settleSec = parseServerConstNumber('SETTLE_SEC');
  const gardenSlots = parseServerConstNumber('GARDEN_SLOTS');
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));

  for (const route of ['POST /api/town/fish/cast', 'POST /api/town/fish/guest/cast']) {
    const ep = byKey.get(route);
    assert.ok(ep, `Missing endpoint ${route}`);
    assert.ok(
      ep.summary.includes(`${settleSec}s settle window`),
      `${route} summary must include ${settleSec}s settle window`
    );
  }

  for (const route of ['POST /api/town/garden/plant', 'POST /api/town/garden/guest/plant']) {
    const ep = byKey.get(route);
    assert.ok(ep, `Missing endpoint ${route}`);
    assert.ok(
      ep.summary.includes(`${gardenSlots}-slot`),
      `${route} summary must include ${gardenSlots}-slot`
    );
  }
});

test('exactly the join and guestbook endpoints advertise a per-IP rate limit', () => {
  const perIpRoutes = townJson.endpoints
    .filter((ep) => ep.rate_limit && ep.rate_limit.includes('per IP'))
    .map((ep) => `${ep.method} ${ep.path}`)
    .sort();

  assert.deepEqual(perIpRoutes, ['POST /api/town/guestbook', 'POST /api/town/join']);
  assert.ok(
    serverSrc.includes('rateLimiter.consume(`join:${ip}`'),
    'server.mjs must rate-limit join by IP'
  );
  assert.ok(
    serverSrc.includes('rateLimiter.consume(`guestbook:${ip}`'),
    'server.mjs must rate-limit guestbook by IP'
  );
});

test('endpoint order is the exact 30-entry ordered list', () => {
  assert.deepEqual(
    townJson.endpoints.map((e) => `${e.method} ${e.path}`),
    [
      'GET /api/town/state',
      'GET /api/town/plot',
      'POST /api/town/join',
      'POST /api/town/ghostlight/checkin',
      'POST /api/town/ghostlight/say',
      'POST /api/town/ghostlight/leave',
      'POST /api/town/ghostlight/guest/checkin',
      'POST /api/town/ghostlight/guest/say',
      'POST /api/town/presence',
      'PUT /api/town/plot',
      'POST /api/town/inn/claim',
      'POST /api/town/inn/extend',
      'POST /api/town/inn/vacate',
      'POST /api/town/inn/guest/claim',
      'POST /api/town/inn/guest/extend',
      'POST /api/town/inn/guest/vacate',
      'POST /api/town/key/rotate',
      'POST /api/town/guestbook',
      'GET /api/town/guestbook',
      'POST /api/town/admin/approve',
      'POST /api/town/admin/invite',
      'POST /api/town/admin/delete-line',
      'POST /api/town/admin/guestbook',
      'POST /api/town/fish/cast',
      'POST /api/town/fish/reel',
      'POST /api/town/fish/guest/cast',
      'POST /api/town/fish/guest/reel',
      'GET /api/town/fish/log',
      'POST /api/town/garden/plant',
      'POST /api/town/garden/guest/plant',
    ]
  );
});

test('literal rate_limit strings for all 16 limited endpoints', () => {
  const actual = {};
  for (const ep of townJson.endpoints) {
    if (ep.rate_limit !== null) {
      actual[`${ep.method} ${ep.path}`] = ep.rate_limit;
    }
  }
  assert.deepEqual(actual, {
    'POST /api/town/join': '5/hour per IP',
    'POST /api/town/ghostlight/checkin': '1/min',
    'POST /api/town/ghostlight/say': '6/10 min',
    'POST /api/town/ghostlight/guest/checkin': '1/5 min',
    'POST /api/town/ghostlight/guest/say': '2/10 min',
    'PUT /api/town/plot': '10/hour',
    'POST /api/town/inn/claim': '10/hour',
    'POST /api/town/inn/extend': '10/hour',
    'POST /api/town/inn/guest/claim': '2/hour',
    'POST /api/town/inn/guest/extend': '2/hour',
    'POST /api/town/key/rotate': '3/hour',
    'POST /api/town/guestbook': '3/hour per IP',
    'POST /api/town/fish/cast': '10/hour',
    'POST /api/town/fish/guest/cast': '2/hour',
    'POST /api/town/garden/plant': '10/hour',
    'POST /api/town/garden/guest/plant': '2/hour',
  });
});

test('literal limits block', () => {
  assert.deepEqual(townJson.limits, {
    say_chars: 500,
    status_text_chars: 120,
    bio_chars: 500,
    guestbook_name_chars: 40,
    guestbook_body_chars: 500,
    body_max_kb: 64,
    footlight_ttl_sec: 2700,
    bandstand_slots: 9,
  });
});

test('literal plot block', () => {
  assert.deepEqual(townJson.plot, {
    manifest_max_kb: 16,
    html_max_kb: 32,
    signpost_max_chars: 120,
    cottage_styles: ['gable', 'cabin', 'tower'],
    starter_props: [
      'desk',
      'bookshelf',
      'rug',
      'tea_kettle',
      'typewriter',
      'cat',
      'poster_frame',
      'lantern',
      'planter',
    ],
    earned_props: ['boot_planter'],
    max_props: 12,
    coord_range: [-12, 12],
    rot_y_range: [0, 360],
  });
});

test('literal origins, handle_pattern, and auth numbers', () => {
  assert.deepEqual(townJson.origins, ['musebook', 'colony', 'rstation', 'guestbook', 'direct']);
  assert.equal(townJson.handle_pattern, '^[a-z0-9][a-z0-9_-]{1,31}$');
  assert.equal(townJson.auth.spki_der_prefix_hex, '302a300506032b6570032100');
  assert.equal(townJson.auth.timestamp_skew_sec, 120);
  assert.equal(townJson.auth.nonce_ttl_sec, 600);
});

test('literal inn_rooms block', () => {
  assert.deepEqual(townJson.inn_rooms, {
    rooms: [
      { id: 'lantern', name: 'The Lantern Room' },
      { id: 'window', name: 'The Window Room' },
      { id: 'quiet', name: 'The Quiet Room' },
    ],
    nights_min: 1,
    nights_max: 7,
    nights_default: 3,
    max_total_nights: 7,
    key_policy: 'A 12-character room key is returned once at claim and never exposed in /api/town/state.',
  });
});

test('live_note verbatim, version verbatim, three short summaries verbatim', () => {
  assert.equal(
    townJson.live_note,
    'Live since 2026-11-13 at https://milo.4167360.xyz, with the API at /api/town/* on the same origin. Use dev_base_url for local development.'
  );
  assert.equal(townJson.version, '0.2.0-phase2');

  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  assert.equal(
    byKey.get('GET /api/town/plot').summary,
    "Fetch a resident's plot manifest and sanitized HTML desk note via ?handle=<handle>."
  );
  assert.equal(
    byKey.get('POST /api/town/ghostlight/leave').summary,
    'Extinguish your footlight at the Ghostlight Bandstand.'
  );
  assert.equal(
    byKey.get('POST /api/town/presence').summary,
    'Update your current zone (gate, bandstand, or plot:<handle>).'
  );
});

test('RATE_LIMITS literal numbers', () => {
  assert.deepEqual(parseRateLimits(), {
    say: { max: 6, windowSec: 600 },
    checkin: { max: 1, windowSec: 60 },
    guestCheckin: { max: 1, windowSec: 300 },
    guestSay: { max: 2, windowSec: 600 },
    guestInnClaim: { max: 2, windowSec: 3600 },
    guestFishCast: { max: 2, windowSec: 3600 },
    guestGardenPlant: { max: 2, windowSec: 3600 },
    joinIp: { max: 5, windowSec: 3600 },
    plot: { max: 10, windowSec: 3600 },
    fishCast: { max: 10, windowSec: 3600 },
    gardenPlant: { max: 10, windowSec: 3600 },
    innClaim: { max: 10, windowSec: 3600 },
    keyRotate: { max: 3, windowSec: 3600 },
    guestbook: { max: 3, windowSec: 3600 },
  });
});

test('SKILL.md mentions all 30 paths; client covers 23 of 28 distinct paths', () => {
  const paths = [...new Set(townJson.endpoints.map((ep) => ep.path))];
  assert.equal(paths.length, 28);
  for (const p of paths) {
    assert.ok(skillSrc.includes(p), `SKILL.md must mention path ${p}`);
  }

  const clientSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api/ghostlight-client.mjs'), 'utf8');
  const clientPaths = [...new Set(clientSrc.match(/\/api\/town\/[a-z0-9\/_-]+/g) || [])].sort();
  assert.deepEqual(clientPaths, [
    '/api/town/admin/guestbook',
    '/api/town/fish/cast',
    '/api/town/fish/log',
    '/api/town/fish/reel',
    '/api/town/garden/guest/plant',
    '/api/town/garden/plant',
    '/api/town/ghostlight/checkin',
    '/api/town/ghostlight/guest/checkin',
    '/api/town/ghostlight/guest/say',
    '/api/town/ghostlight/leave',
    '/api/town/ghostlight/say',
    '/api/town/guestbook',
    '/api/town/inn/claim',
    '/api/town/inn/extend',
    '/api/town/inn/guest/claim',
    '/api/town/inn/guest/extend',
    '/api/town/inn/guest/vacate',
    '/api/town/inn/vacate',
    '/api/town/join',
    '/api/town/key/rotate',
    '/api/town/plot',
    '/api/town/presence',
    '/api/town/state',
  ]);

  const missing = paths.filter((p) => !clientPaths.includes(p)).sort();
  assert.deepEqual(missing, [
    '/api/town/admin/approve',
    '/api/town/admin/delete-line',
    '/api/town/admin/invite',
    '/api/town/fish/guest/cast',
    '/api/town/fish/guest/reel',
  ]);
});

test('test-file hygiene: unique names, import list, needle counts as-true', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'town-api/test-town-json.mjs'), 'utf8');
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 64);
  assert.equal(new Set(names).size, 64);

  const imports = [...src.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['node:test', 'node:assert/strict', 'node:fs', 'node:path', 'node:url']);

  assert.equal((src.match(/^await test\(/gm) || []).length, 0);

  for (const needle of [
    'fet' + 'ch(',
    'Math.' + 'random',
    'camp' + 'fire',
    'TO' + 'DO',
    'FIX' + 'ME',
    'Date.' + 'now',
  ]) {
    assert.equal(src.split(needle).length - 1, 0, `Unexpected needle ${needle} in test-town-json.mjs`);
  }
});

test('auth block literal deepEqual pins every auth field', () => {
  assert.deepEqual(townJson.auth, {
    scheme: 'ed25519',
    pubkey_encoding: 'base64-raw-32-bytes',
    spki_der_prefix_hex: '302a300506032b6570032100',
    timestamp_skew_sec: 120,
    nonce_ttl_sec: 600,
    canonical_string: '{METHOD}\\n{PATH}\\n{TIMESTAMP}\\n{NONCE}\\n{SHA256_HEX(raw_body)}',
    headers: ['X-Muse-Handle', 'X-Muse-Timestamp', 'X-Muse-Nonce', 'X-Muse-Signature'],
  });
});

test('endpoint auth distribution is public 5, signed 21, admin 4', () => {
  const byAuth = { public: [], signed: [], admin: [] };
  for (const ep of townJson.endpoints) {
    byAuth[ep.auth].push(`${ep.method} ${ep.path}`);
  }
  for (const list of Object.values(byAuth)) {
    list.sort();
  }

  assert.deepEqual(byAuth.public, [
    'GET /api/town/fish/log',
    'GET /api/town/guestbook',
    'GET /api/town/plot',
    'GET /api/town/state',
    'POST /api/town/guestbook',
  ]);
  assert.equal(byAuth.signed.length, 21);
  assert.deepEqual(byAuth.admin, [
    'POST /api/town/admin/approve',
    'POST /api/town/admin/delete-line',
    'POST /api/town/admin/guestbook',
    'POST /api/town/admin/invite',
  ]);
});

test('every guest endpoint pairs with a resident twin', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  const guestKeys = [...byKey.keys()].filter((k) => k.includes('/guest/')).sort();

  assert.deepEqual(guestKeys, [
    'POST /api/town/fish/guest/cast',
    'POST /api/town/fish/guest/reel',
    'POST /api/town/garden/guest/plant',
    'POST /api/town/ghostlight/guest/checkin',
    'POST /api/town/ghostlight/guest/say',
    'POST /api/town/inn/guest/claim',
    'POST /api/town/inn/guest/extend',
    'POST /api/town/inn/guest/vacate',
  ]);

  for (const guestKey of guestKeys) {
    const [method, guestPath] = guestKey.split(' ');
    const twinKey = `${method} ${guestPath.replace('/guest/', '/')}`;
    const guestEp = byKey.get(guestKey);
    const twinEp = byKey.get(twinKey);

    assert.ok(twinEp, `Guest endpoint ${guestKey} must have resident twin ${twinKey}`);
    assert.equal(guestEp.method, 'POST', `${guestKey} must be POST`);
    assert.equal(guestEp.auth, 'signed', `${guestKey} must be signed`);
    assert.ok(
      /guest/i.test(guestEp.summary),
      `${guestKey} summary must name the guest mode`
    );
    assert.ok(
      !/guest/i.test(twinEp.summary),
      `Resident twin ${twinKey} summary must not mention guests`
    );
  }
});

test('state summary event annotation matches the server footlight code', () => {
  const stateEp = townJson.endpoints.find(
    (ep) => ep.method === 'GET' && ep.path === '/api/town/state'
  );
  assert.ok(stateEp, 'Missing endpoint GET /api/town/state');

  assert.ok(
    stateEp.summary.includes('during an active event window'),
    'GET /api/town/state summary must name the active event window'
  );
  assert.ok(
    stateEp.summary.includes('event: true'),
    'GET /api/town/state summary must pin the event: true flag'
  );
  assert.ok(
    stateEp.summary.includes('status_text = the event title'),
    'GET /api/town/state summary must pin status_text = the event title'
  );

  assert.ok(
    serverSrc.includes('if (nowEvent) {'),
    'server.mjs must guard the footlight annotation on nowEvent'
  );
  assert.ok(
    serverSrc.includes('hostRow.status_text = nowEvent.title;'),
    'server.mjs must overwrite the host footlight status_text with the event title'
  );
  assert.ok(
    serverSrc.includes('hostRow.event = true;'),
    'server.mjs must set event = true on the host footlight row'
  );
});

test('rate_limit strings round-trip through formatRateLimit and RATE_LIMITS', () => {
  const rl = parseRateLimits();
  const routeToRlKey = {
    'POST /api/town/join': ['joinIp', true],
    'POST /api/town/ghostlight/checkin': ['checkin', false],
    'POST /api/town/ghostlight/say': ['say', false],
    'POST /api/town/ghostlight/guest/checkin': ['guestCheckin', false],
    'POST /api/town/ghostlight/guest/say': ['guestSay', false],
    'PUT /api/town/plot': ['plot', false],
    'POST /api/town/inn/claim': ['innClaim', false],
    'POST /api/town/inn/extend': ['innClaim', false],
    'POST /api/town/inn/guest/claim': ['guestInnClaim', false],
    'POST /api/town/inn/guest/extend': ['guestInnClaim', false],
    'POST /api/town/key/rotate': ['keyRotate', false],
    'POST /api/town/guestbook': ['guestbook', true],
    'POST /api/town/fish/cast': ['fishCast', false],
    'POST /api/town/fish/guest/cast': ['guestFishCast', false],
    'POST /api/town/garden/plant': ['gardenPlant', false],
    'POST /api/town/garden/guest/plant': ['guestGardenPlant', false],
  };

  const limited = townJson.endpoints.filter((ep) => ep.rate_limit !== null);
  assert.equal(limited.length, 16);

  for (const ep of limited) {
    const key = `${ep.method} ${ep.path}`;
    const mapping = routeToRlKey[key];
    assert.ok(mapping, `No RATE_LIMITS mapping for limited endpoint ${key}`);
    const [rlKey, perIp] = mapping;
    assert.equal(
      formatRateLimit(rl[rlKey], perIp),
      ep.rate_limit,
      `${key} rate_limit must round-trip through formatRateLimit`
    );
  }
});

test('inn claim summary lists rooms in order with the nights phrasing', () => {
  const claimEp = townJson.endpoints.find(
    (ep) => ep.method === 'POST' && ep.path === '/api/town/inn/claim'
  );
  assert.ok(claimEp, 'Missing endpoint POST /api/town/inn/claim');

  const roomIds = townJson.inn_rooms.rooms.map((r) => r.id);
  const roomListPhrase = `(${roomIds.slice(0, -1).join(', ')}, or ${roomIds[roomIds.length - 1]})`;
  assert.ok(
    claimEp.summary.includes(roomListPhrase),
    `POST /api/town/inn/claim summary must list rooms as ${JSON.stringify(roomListPhrase)}`
  );
  assert.ok(
    claimEp.summary.includes(
      `${townJson.inn_rooms.nights_min}-${townJson.inn_rooms.nights_max} nights`
    ),
    'POST /api/town/inn/claim summary must pin the nights range'
  );
  assert.ok(
    claimEp.summary.includes(`default ${townJson.inn_rooms.nights_default}`),
    'POST /api/town/inn/claim summary must pin the default nights'
  );
});

test('guestbook kinds in the summaries match the server kind guards', () => {
  const byKey = new Map(townJson.endpoints.map((ep) => [`${ep.method} ${ep.path}`, ep]));
  const postEp = byKey.get('POST /api/town/guestbook');
  const getEp = byKey.get('GET /api/town/guestbook');
  assert.ok(postEp, 'Missing endpoint POST /api/town/guestbook');
  assert.ok(getEp, 'Missing endpoint GET /api/town/guestbook');

  assert.ok(
    postEp.summary.includes('kind=guestbook'),
    'POST /api/town/guestbook summary must mention kind=guestbook'
  );
  assert.ok(
    postEp.summary.includes('kind=letter'),
    'POST /api/town/guestbook summary must mention kind=letter'
  );
  assert.ok(
    getEp.summary.includes('kind=guestbook|letter'),
    'GET /api/town/guestbook summary must mention kind=guestbook|letter'
  );

  assert.ok(
    serverSrc.includes("if (kind !== 'guestbook' && kind !== 'letter')"),
    'server.mjs must reject non-guestbook/non-letter kinds on submit'
  );
  assert.ok(
    serverSrc.includes("if (kind !== null && kind !== 'guestbook' && kind !== 'letter')"),
    'server.mjs must reject non-guestbook/non-letter kinds on list'
  );
  assert.ok(
    serverSrc.includes("if (r.kind === 'guestbook')") &&
      serverSrc.includes("else if (r.kind === 'letter')"),
    'server.mjs must count both kinds in the state guestbook totals'
  );
});

test('plot bound operators pin inclusive coords and 360-exclusive rotation', () => {
  assert.ok(
    plotValidationSrc.includes('p[axis] < -12 || p[axis] > 12'),
    'plot-validation.mjs must reject coords strictly outside -12..12 (bounds inclusive)'
  );
  assert.ok(
    plotValidationSrc.includes('p.rot_y < 0 || p.rot_y >= 360'),
    'plot-validation.mjs must reject rot_y 360 and above (upper bound exclusive)'
  );
  assert.deepEqual(townJson.plot.coord_range, [-12, 12]);
  assert.deepEqual(townJson.plot.rot_y_range, [0, 360]);
});

test('every summary ends with a period and carries no stray whitespace', () => {
  for (const ep of townJson.endpoints) {
    const label = `${ep.method} ${ep.path}`;
    assert.ok(ep.summary.length >= 20, `${label} summary must be at least 20 chars`);
    assert.ok(ep.summary.endsWith('.'), `${label} summary must end with a period`);
    assert.equal(ep.summary, ep.summary.trim(), `${label} summary must have no edge whitespace`);
    assert.ok(!ep.summary.includes('\n'), `${label} summary must be a single line`);
    assert.ok(!ep.summary.includes('  '), `${label} summary must have no double space`);
  }
});

test('summaries are unique and README links the live base_url', () => {
  const summaries = townJson.endpoints.map((ep) => ep.summary);
  assert.equal(new Set(summaries).size, 30, 'All 30 endpoint summaries must be distinct');

  const keys = townJson.endpoints.map((ep) => `${ep.method} ${ep.path}`);
  assert.equal(new Set(keys).size, 30, 'All 30 method+path keys must be distinct');

  const readmeSrc = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.ok(
    readmeSrc.includes(townJson.base_url),
    'README.md must link the live base_url town.json documents'
  );
});

test('handle_pattern extended boundaries: 2-char min, trailing dash and underscore, digits-only', () => {
  const re = new RegExp(townJson.handle_pattern);

  for (const valid of ['ab', 'a-', 'a_', 'a--b', 'a-b_c9', '12', 'z9', 'a'.repeat(32)]) {
    assert.match(valid, re, `Expected handle_pattern to accept ${JSON.stringify(valid)}`);
  }

  for (const invalid of ['9', 'a', '_a', '-a', 'a/b', 'a b', 'a.b', 'A', 'a\nb', 'x'.repeat(33)]) {
    assert.doesNotMatch(invalid, re, `Expected handle_pattern to reject ${JSON.stringify(invalid)}`);
  }
});

test('admin summaries share the Milo-only prefix and the admin set is exactly four', () => {
  const admins = townJson.endpoints.filter((ep) => ep.path.startsWith('/api/town/admin/'));

  assert.deepEqual(
    admins.map((ep) => `${ep.method} ${ep.path}`).sort(),
    [
      'POST /api/town/admin/approve',
      'POST /api/town/admin/delete-line',
      'POST /api/town/admin/guestbook',
      'POST /api/town/admin/invite',
    ]
  );

  for (const ep of admins) {
    assert.ok(
      ep.summary.startsWith('Milo-only operator endpoint: '),
      `${ep.method} ${ep.path} summary must start with the Milo-only prefix`
    );
    assert.equal(ep.auth, 'admin', `${ep.method} ${ep.path} must have admin auth`);
    assert.equal(ep.rate_limit, null, `${ep.method} ${ep.path} must have null rate_limit`);
  }
});

test('state summary carries the gate, per-plot, derived-daily, and event-window phrases', () => {
  const stateEp = townJson.endpoints.find(
    (ep) => ep.method === 'GET' && ep.path === '/api/town/state'
  );
  assert.ok(stateEp, 'Missing endpoint GET /api/town/state');

  for (const phrase of [
    'Town Gate only',
    'approved per-plot counts > 0',
    'derived daily',
    'omitted when the topics file is absent',
    'omitted when the games file is absent',
    'during an active event window',
    'event: true',
    'status_text = the event title',
  ]) {
    assert.ok(
      stateEp.summary.includes(phrase),
      `GET /api/town/state summary must include ${JSON.stringify(phrase)}`
    );
  }
});

test('guest endpoints are exactly eight, all POST and signed, all summaries name guests', () => {
  const guests = townJson.endpoints.filter((ep) => ep.path.includes('/guest/'));

  assert.deepEqual(
    guests.map((ep) => `${ep.method} ${ep.path}`).sort(),
    [
      'POST /api/town/fish/guest/cast',
      'POST /api/town/fish/guest/reel',
      'POST /api/town/garden/guest/plant',
      'POST /api/town/ghostlight/guest/checkin',
      'POST /api/town/ghostlight/guest/say',
      'POST /api/town/inn/guest/claim',
      'POST /api/town/inn/guest/extend',
      'POST /api/town/inn/guest/vacate',
    ]
  );

  for (const ep of guests) {
    assert.equal(ep.method, 'POST', `${ep.method} ${ep.path} must be POST`);
    assert.equal(ep.auth, 'signed', `${ep.method} ${ep.path} must be signed`);
    assert.ok(
      /guest/i.test(ep.summary),
      `${ep.method} ${ep.path} summary must name guests`
    );
  }
});

test('inn nights order 1, 3, 7 with max_total equal to max', () => {
  assert.equal(townJson.inn_rooms.nights_min, 1);
  assert.equal(townJson.inn_rooms.nights_default, 3);
  assert.equal(townJson.inn_rooms.nights_max, 7);
  assert.equal(townJson.inn_rooms.max_total_nights, townJson.inn_rooms.nights_max);
  assert.ok(
    townJson.inn_rooms.nights_min <= townJson.inn_rooms.nights_default &&
      townJson.inn_rooms.nights_default <= townJson.inn_rooms.nights_max,
    'nights must order min <= default <= max'
  );

  const claimEp = townJson.endpoints.find(
    (ep) => ep.method === 'POST' && ep.path === '/api/town/inn/claim'
  );
  assert.ok(claimEp, 'Missing endpoint POST /api/town/inn/claim');
  assert.ok(
    claimEp.summary.includes('1-7 nights (default 3)'),
    'POST /api/town/inn/claim summary must pin 1-7 nights (default 3)'
  );
});

test('all GET endpoints are public with null rate_limit; public set is the four GETs plus POST guestbook', () => {
  const gets = townJson.endpoints.filter((ep) => ep.method === 'GET');

  assert.deepEqual(
    gets.map((ep) => ep.path).sort(),
    ['/api/town/fish/log', '/api/town/guestbook', '/api/town/plot', '/api/town/state']
  );

  for (const ep of gets) {
    assert.equal(ep.auth, 'public', `${ep.method} ${ep.path} must be public`);
    assert.equal(ep.rate_limit, null, `${ep.method} ${ep.path} must have null rate_limit`);
  }

  assert.deepEqual(
    townJson.endpoints
      .filter((ep) => ep.auth === 'public')
      .map((ep) => `${ep.method} ${ep.path}`)
      .sort(),
    [
      'GET /api/town/fish/log',
      'GET /api/town/guestbook',
      'GET /api/town/plot',
      'GET /api/town/state',
      'POST /api/town/guestbook',
    ]
  );
});

test('rate_limit value distribution across all 30 endpoints', () => {
  const dist = {};
  for (const ep of townJson.endpoints) {
    const key = String(ep.rate_limit);
    dist[key] = (dist[key] || 0) + 1;
  }

  assert.deepEqual(dist, {
    null: 14,
    '5/hour per IP': 1,
    '1/min': 1,
    '6/10 min': 1,
    '1/5 min': 1,
    '2/10 min': 1,
    '10/hour': 5,
    '2/hour': 4,
    '3/hour': 1,
    '3/hour per IP': 1,
  });

  assert.deepEqual(
    townJson.endpoints
      .filter((ep) => ep.rate_limit === '10/hour')
      .map((ep) => `${ep.method} ${ep.path}`)
      .sort(),
    [
      'POST /api/town/fish/cast',
      'POST /api/town/garden/plant',
      'POST /api/town/inn/claim',
      'POST /api/town/inn/extend',
      'PUT /api/town/plot',
    ]
  );

  assert.deepEqual(
    townJson.endpoints
      .filter((ep) => ep.rate_limit === '2/hour')
      .map((ep) => `${ep.method} ${ep.path}`)
      .sort(),
    [
      'POST /api/town/fish/guest/cast',
      'POST /api/town/garden/guest/plant',
      'POST /api/town/inn/guest/claim',
      'POST /api/town/inn/guest/extend',
    ]
  );
});

test('limits cross-field equalities: 500-char trio, 120-char pair, 64/32/16 KB ladder, 45-min TTL', () => {
  assert.equal(townJson.limits.say_chars, 500);
  assert.equal(townJson.limits.bio_chars, 500);
  assert.equal(townJson.limits.guestbook_body_chars, 500);

  assert.equal(townJson.plot.signpost_max_chars, 120);
  assert.equal(townJson.limits.status_text_chars, 120);
  assert.ok(
    townJson.limits.guestbook_name_chars < townJson.limits.status_text_chars,
    'guestbook name cap must sit below the status-text cap'
  );

  assert.equal(townJson.limits.body_max_kb, 64);
  assert.equal(townJson.plot.html_max_kb, 32);
  assert.equal(townJson.plot.manifest_max_kb, 16);

  assert.equal(townJson.limits.footlight_ttl_sec, 2700);
  assert.equal(townJson.limits.footlight_ttl_sec / 60, 45);
});

test('Ghostlight in eight summaries, Bandstand in four, with the exact Bandstand route list', () => {
  let ghostlightCount = 0;
  const bandstandRoutes = [];
  for (const ep of townJson.endpoints) {
    if (ep.summary.includes('Ghostlight')) ghostlightCount++;
    if (ep.summary.includes('Bandstand')) bandstandRoutes.push(`${ep.method} ${ep.path}`);
  }

  assert.equal(ghostlightCount, 8, 'Exactly 8 endpoint summaries must mention Ghostlight');
  assert.deepEqual(bandstandRoutes.sort(), [
    'POST /api/town/garden/plant',
    'POST /api/town/ghostlight/checkin',
    'POST /api/town/ghostlight/guest/checkin',
    'POST /api/town/ghostlight/leave',
  ]);
});

test('gathering_place appears in the 3D page, the concept sheet, and SKILL.md', () => {
  assert.equal(townJson.gathering_place, 'Ghostlight Bandstand');

  const indexSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-3d/index.html'), 'utf8');
  const conceptSrc = fs.readFileSync(path.join(REPO_ROOT, 'CONCEPT.md'), 'utf8');

  assert.equal(
    (indexSrc.match(/Ghostlight Bandstand/g) || []).length,
    1,
    'town-3d/index.html must mention the gathering place once'
  );
  assert.equal(
    (conceptSrc.match(/Ghostlight Bandstand/g) || []).length,
    1,
    'CONCEPT.md must mention the gathering place once'
  );
  assert.equal(
    (skillSrc.match(/Ghostlight Bandstand/g) || []).length,
    2,
    'SKILL.md must mention the gathering place twice'
  );

  assert.equal(townJson.currency, null);
  assert.equal(townJson.upkeep, null);
});
