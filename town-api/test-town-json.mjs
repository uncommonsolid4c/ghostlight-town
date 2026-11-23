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
  assert.equal(serverRoutes.length, 28, 'Expected 28 routes in server.mjs');

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

  // Bandstand slots 0..9 in server.mjs:680,695
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
  assert.deepEqual(townJson.plot.starter_props, parseStringListFromSet(plotValidationSrc, 'VALID_PROP_KINDS'));

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
  assert.deepEqual(counts, { GET: 4, POST: 23, PUT: 1 });
  assert.equal(townJson.endpoints.length, 28);

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
