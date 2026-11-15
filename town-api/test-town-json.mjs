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
  assert.equal(serverRoutes.length, 18, 'Expected 18 routes in server.mjs');

  const jsonSet = new Set(townJson.endpoints.map((e) => `${e.method} ${e.path}`));
  const serverSet = new Set(serverRoutes.map((r) => `${r.method} ${r.path}`));
  assert.equal(townJson.endpoints.length, jsonSet.size, 'Duplicate endpoints in town.json');
  assert.deepEqual(jsonSet, serverSet, 'Endpoint set in town.json must match server.mjs');

  const modeToAuth = {
    public: 'public',
    admin: 'admin',
    join: 'signed',
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
    'PUT /api/town/plot': formatRateLimit(rl.plot, false),
    'POST /api/town/inn/claim': formatRateLimit(rl.innClaim, false),
    'POST /api/town/inn/extend': formatRateLimit(rl.innClaim, false),
    'POST /api/town/key/rotate': formatRateLimit(rl.keyRotate, false),
    'POST /api/town/guestbook': formatRateLimit(rl.guestbook, true),
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
