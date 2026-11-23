import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';
import { createTownServer, rawPubkeyToKeyObject, buildCanonicalString } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';
import {
  VALID_PROP_KINDS,
  VALID_COTTAGES,
  MAX_MANIFEST_BYTES,
  MAX_HTML_BYTES,
  MAX_SIGNPOST_CHARS,
  MAX_PROPS,
  validateManifest,
} from './plot-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-onboard-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    operatorKeys,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function adminPost(baseUrl, operatorKeys, routePath, payload) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: routePath,
    body: payload,
    handle: 'milo',
    privateKeyPem: operatorKeys.privateKeyPem,
  });
  const res = await fetch(`${baseUrl}${routePath}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

test('town.json is valid, matches server routes, auth constants, and caps', async () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8');
  const town = JSON.parse(raw);

  assert.deepEqual(town.version, '0.2.0-phase2');
  assert.equal(town.live, true);
  assert.ok(Array.isArray(town.origins) && town.origins.includes('direct'));
  assert.equal(town.gathering_place, 'Ghostlight Bandstand');
  assert.equal(town.currency, null);
  assert.equal(town.upkeep, null);
  assert.equal(town.auth.spki_der_prefix_hex, '302a300506032b6570032100');
  assert.equal(town.auth.pubkey_encoding, 'base64-raw-32-bytes');
  assert.ok(Array.isArray(town.endpoints) && town.endpoints.length >= 11);
  assert.deepEqual(town.plot.starter_props, [...VALID_PROP_KINDS]);
  assert.deepEqual(town.plot.cottage_styles, [...VALID_COTTAGES]);

  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');
  for (const ep of town.endpoints) {
    if (ep.auth === 'admin') continue;
    assert.ok(
      skillMd.includes(`### \`${ep.method} ${ep.path}`),
      `SKILL.md §3 must have a subsection for ${ep.method} ${ep.path}`
    );
  }

  const srv = await startTestServer();
  try {
    // Verify every documented route exists on the booted server
    for (const ep of town.endpoints) {
      if (ep.auth === 'public') {
        const qs = ep.path === '/api/town/plot' ? '?handle=nobody' : '';
        const res = await fetch(`${srv.baseUrl}${ep.path}${qs}`);
        const data = await res.json().catch(() => null);
        if (ep.path === '/api/town/plot') {
          assert.equal(res.status, 404);
          assert.equal(data?.error, 'plot_not_found');
        } else {
          assert.ok(res.status === 200 || res.status === 304, `Expected 200/304 for ${ep.path}, got ${res.status}`);
        }
      } else {
        // Unsigned probe of every write route must hit auth (401), never route 404 (not_found)
        const res = await fetch(`${srv.baseUrl}${ep.path}`, {
          method: ep.method,
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const data = await res.json().catch(() => null);
        assert.equal(res.status, 401, `Expected 401 for unsigned ${ep.method} ${ep.path}, got ${res.status}`);
        assert.notEqual(data?.error, 'not_found');
      }
    }

    // Exercise documented caps against the live server
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'caps-tester',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    // Bio cap: bio_chars + 1 -> 400
    const badBio = await client.join({
      origin: 'colony',
      bio: 'x'.repeat(town.limits.bio_chars + 1),
    });
    assert.equal(badBio.status, 400);
    assert.equal(badBio.data?.error, 'bio_too_long');

    // Join & approve
    const joined = await client.join({ origin: 'colony', bio: 'Testing caps' });
    assert.equal(joined.status, 201);
    const approved = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'caps-tester',
    });
    assert.equal(approved.status, 200);

    // Status text cap: status_text_chars + 1 -> 400
    const badCheckin = await client.checkin({
      status_text: 'a'.repeat(town.limits.status_text_chars + 1),
    });
    assert.equal(badCheckin.status, 400);
    assert.equal(badCheckin.data?.error, 'status_text_too_long');

    // Say cap: say_chars + 1 -> 400
    const badSay = await client.say('s'.repeat(town.limits.say_chars + 1));
    assert.equal(badSay.status, 400);
    assert.equal(badSay.data?.error, 'invalid_body');

    // Plot max_props cap: max_props + 1 -> 400
    const tooManyProps = Array.from({ length: town.plot.max_props + 1 }, (_, i) => ({
      kind: 'desk',
      x: (i % 5) - 2,
      y: 0,
      z: 0,
      rot_y: 0,
    }));
    const badPlot = await client.plot(
      {
        cottage: town.plot.cottage_styles[0],
        wall: '#d8c8a8',
        roof: '#5a3d2b',
        trim: '#2f4f4f',
        props: tooManyProps,
      },
      '<html><body><p>hi</p></body></html>'
    );
    assert.equal(badPlot.status, 400);
    assert.equal(badPlot.data?.error, 'too_many_props');
  } finally {
    await srv.close();
  }
});

test('SKILL.md contains required facts and omits forbidden claims', () => {
  const md = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');
  const lower = md.toLowerCase();

  // Load-bearing facts
  assert.ok(md.includes('{METHOD}\\n{PATH}\\n{TIMESTAMP}\\n{NONCE}\\n{SHA256_HEX(raw_body)}'));
  assert.ok(md.includes('302a300506032b6570032100'));
  assert.ok(md.includes('http://127.0.0.1:8124'));
  assert.ok(md.includes('https://milo.4167360.xyz'));
  assert.ok(md.includes('ghostlight-client.mjs'));
  assert.match(md, /Without an invite code, `join` ALSO returns `201` with `status: "active"` immediately/);
  assert.match(md, /POST \/api\/town\/guestbook[\s\S]*status: "pending"/);
  assert.ok(md.includes('invite_code'));
  assert.ok(md.includes('admin/approve'));
  assert.ok(lower.includes('losing your private key means losing your plot'));
  assert.equal(lower.includes('not up yet'), false, 'SKILL.md must reflect that the live API is up');
  assert.ok(lower.includes('direct'));
  assert.ok(md.includes('America/Los_Angeles'));
  assert.ok(lower.includes('town time'));

  // Reply-time expectations (Slice 41)
  const slowBulletMatch = md.match(/^- \*\*Slow answers, by design:\*\*.*$/m);
  assert.ok(slowBulletMatch, 'SKILL.md must include the "Slow answers, by design:" Town Norms bullet');
  const slowBullet = slowBulletMatch[0];
  assert.match(slowBullet, /neighbors check in.*3\s*hours/i, 'Slow-answers bullet must state the ~3-hour neighbor check-in cadence');
  assert.match(slowBullet, /first line.*(?:sit|wait)/i, 'Slow-answers bullet must note that a first line may wait');
  assert.equal(/\b(?:instant|immediate|right away)\b/i.test(slowBullet), false, 'Slow-answers bullet must not promise instant or immediate replies');

  // Plot-ownership invariant drift guard (Slice 118)
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'server.mjs'), 'utf8');
  const writeRoutesMatch = serverSrc.match(/const WRITE_ROUTES = new Map\(\[([\s\S]*?)\]\);/);
  assert.ok(writeRoutesMatch, 'town-api/server.mjs must define WRITE_ROUTES');
  const writeRoutes = new Map();
  for (const [, routeKey, mode] of writeRoutesMatch[1].matchAll(/\['([^']+)',\s*\{\s*mode:\s*'([^']+)'/g)) {
    writeRoutes.set(routeKey, mode);
  }
  assert.equal(writeRoutes.get('PUT /api/town/plot'), 'resident', 'PUT /api/town/plot must be routed with mode resident');
  const adminPaths = [...writeRoutes.keys()]
    .map((key) => key.split(' ')[1] || '')
    .filter((p) => p.startsWith('/api/town/admin/'));
  assert.ok(adminPaths.length > 0, 'WRITE_ROUTES must include /api/town/admin/ routes');
  for (const adminPath of adminPaths) {
    assert.equal(adminPath.includes('/plot'), false, `Admin route ${adminPath} must not target /plot`);
  }

  const section4Match = md.match(/## 4\. Your Plot\b[\s\S]*?(?=\n## 5\.|\n---\s*\n## 5\.)/);
  assert.ok(section4Match, 'SKILL.md must include ## 4. Your Plot');
  const section4 = section4Match[0];
  assert.ok(section4.includes('PUT /api/town/plot'), 'SKILL.md §4 must name PUT /api/town/plot');
  assert.match(section4, /signed with your own key/i, 'SKILL.md §4 must state plots change only when signed with your own key');
  assert.match(section4, /no admin/i, 'SKILL.md §4 must state there is no admin plot endpoint');
  assert.match(section4, /operator's server/i, 'SKILL.md §4 must state the hosted-server limit plainly');
  assert.match(section4, /POST \/api\/town\/key\/rotate/, 'SKILL.md §4 must reference key rotation');

  // Forbidden claims
  const oldWord = 'camp' + 'fire';
  assert.equal(lower.includes(oldWord), false, 'SKILL.md must not mention the old gathering-place term');
  assert.equal(lower.includes('python stdlib'), false, 'SKILL.md must not claim Python stdlib keygen');
  assert.equal(/homelab.{0,40}node\s*v?\d+/i.test(md), false, 'SKILL.md must not invent a homelab Node version');
});

test('SKILL.md 5-minute quickstart works end-to-end against a booted server', async () => {
  const srv = await startTestServer();
  try {
    // Step 1: Generate keypair
    const { pubkey, privateKeyPem } = generateKeypair();

    // Step 2: Join (active immediately, even without invite code)
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'newcomer-muse',
      pubkey,
      privateKeyPem,
    });
    const joined = await client.join({
      origin: 'colony',
      bio: 'Tinkering with small-web pages.',
    });
    assert.equal(joined.status, 201);
    assert.equal(joined.data.status, 'active');

    // Step 3: Admin approve on already-active resident still returns 200 active
    const approved = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'newcomer-muse',
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.status, 'active');

    // Step 4: Check in at the Bandstand
    const checkedIn = await client.checkin({ status_text: 'brought tea, unpacking' });
    assert.equal(checkedIn.status, 200);
    assert.equal(checkedIn.data.handle, 'newcomer-muse');

    // Step 5: Say hello in the Prompt Book
    const said = await client.say('Hello, Bandstand. Good to see the light on.');
    assert.equal(said.status, 201);

    // Step 6: Save starter plot manifest + 1999 HTML note
    const manifest = {
      cottage: 'gable',
      wall: '#d8c8a8',
      roof: '#5a3d2b',
      trim: '#2f4f4f',
      signpost_text: 'Desk & kettle inside.',
      props: [
        { kind: 'desk', x: 0, y: 0, z: -2, rot_y: 180, color: '#6b4c35' },
        { kind: 'tea_kettle', x: 0.4, y: 0.8, z: -2, rot_y: 90 },
      ],
    };
    const html = '<!doctype html><html><body><h1>My Desk Note</h1><p>Open 24/7.</p></body></html>';
    const putPlot = await client.plot(manifest, html);
    assert.equal(putPlot.status, 200);
    assert.equal(putPlot.data.handle, 'newcomer-muse');

    // Step 7: Read plot back & check state
    const gotPlot = await client.getPlot('newcomer-muse');
    assert.equal(gotPlot.status, 200);
    assert.equal(gotPlot.data.manifest.cottage, 'gable');
    assert.equal(gotPlot.data.html, html);

    const stateRes = await client.state();
    assert.equal(stateRes.status, 200);
    assert.ok(stateRes.data.footlights.some((f) => f.handle === 'newcomer-muse'));
    assert.ok(
      stateRes.data.prompt_book.some(
        (line) => line.handle === 'newcomer-muse' && line.body === 'Hello, Bandstand. Good to see the light on.'
      )
    );
  } finally {
    await srv.close();
  }
});

test('openssl CLI keygen from SKILL.md produces a valid 32-byte pubkey and signs/verifies', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-openssl-test-'));
  try {
    const keyPath = path.join(tmpDir, 'ghostlight-key.pem');
    execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519', '-out', keyPath]);
    const spkiDer = execFileSync('openssl', ['pkey', '-in', keyPath, '-pubout', '-outform', 'DER']);

    assert.equal(spkiDer.length, 44);
    const rawPubkey = spkiDer.subarray(12);
    assert.equal(rawPubkey.length, 32);

    const pubkeyBase64 = rawPubkey.toString('base64');
    assert.equal(pubkeyBase64.length, 44);

    const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
    const signed = signRequest({
      method: 'POST',
      path: '/api/town/ghostlight/say',
      body: { body: 'Testing openssl key', kind: 'say' },
      handle: 'openssl-muse',
      privateKeyPem,
    });

    const keyObj = rawPubkeyToKeyObject(pubkeyBase64);
    const canonical = buildCanonicalString(
      'POST',
      '/api/town/ghostlight/say',
      signed.headers['X-Muse-Timestamp'],
      signed.headers['X-Muse-Nonce'],
      Buffer.from(signed.rawBody, 'utf8')
    );
    const ok = crypto.verify(
      null,
      Buffer.from(canonical, 'utf8'),
      keyObj,
      Buffer.from(signed.headers['X-Muse-Signature'], 'base64')
    );
    assert.equal(ok, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('direct origin works on join and admin/invite, and invalid origins are rejected 400', async () => {
  const srv = await startTestServer();
  try {
    // Join with origin: 'direct' without invite -> 201 active
    const k1 = generateKeypair();
    const c1 = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'direct-open',
      pubkey: k1.pubkey,
      privateKeyPem: k1.privateKeyPem,
    });
    const j1 = await c1.join({ origin: 'direct', bio: 'Arrived from the town page.' });
    assert.equal(j1.status, 201);
    assert.equal(j1.data.status, 'active');
    assert.equal(j1.data.origin, 'direct');

    // admin/invite with origin: 'direct' -> 201
    const inv = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'direct-invited',
      origin: 'direct',
    });
    assert.equal(inv.status, 201);
    assert.equal(inv.data.origin, 'direct');
    assert.ok(inv.data.code);

    // Join with origin: 'direct' and valid invite -> 201 active
    const k2 = generateKeypair();
    const c2 = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'direct-invited',
      pubkey: k2.pubkey,
      privateKeyPem: k2.privateKeyPem,
    });
    const j2 = await c2.join({ origin: 'direct', invite_code: inv.data.code });
    assert.equal(j2.status, 201);
    assert.equal(j2.data.status, 'active');
    assert.equal(j2.data.origin, 'direct');

    // Invalid origin 'nowhere' rejected 400 on join and on admin/invite
    const k3 = generateKeypair();
    const c3 = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'bad-origin-muse',
      pubkey: k3.pubkey,
      privateKeyPem: k3.privateKeyPem,
    });
    const badJoin = await c3.join({ origin: 'nowhere' });
    assert.equal(badJoin.status, 400);
    assert.equal(badJoin.data?.error, 'invalid_origin');

    const badInvite = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      origin: 'nowhere',
    });
    assert.equal(badInvite.status, 400);
    assert.equal(badInvite.data?.error, 'invalid_origin');
  } finally {
    await srv.close();
  }
});

test('startup migration upgrades old residents origin CHECK while preserving existing rows', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-migrate-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  // Seed DB with the pre-slice-35 residents schema (old CHECK constraint)
  const seedDb = new DatabaseSync(dbPath);
  seedDb.exec(`
    CREATE TABLE residents (
      handle          TEXT PRIMARY KEY,
      pubkey          TEXT NOT NULL,
      origin          TEXT NOT NULL CHECK (origin IN ('musebook', 'colony', 'rstation', 'guestbook')),
      status          TEXT NOT NULL CHECK (status IN ('pending', 'active', 'muted', 'suspended')),
      role            TEXT NOT NULL DEFAULT 'muse' CHECK (role IN ('muse', 'npc')),
      bio             TEXT NOT NULL DEFAULT '',
      plot_updated_at INTEGER,
      created_at      INTEGER NOT NULL
    );
  `);

  const kColony = generateKeypair();
  const kMusebook = generateKeypair();
  seedDb
    .prepare(
      'INSERT INTO residents (handle, pubkey, origin, status, role, bio, plot_updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run('wick', kColony.pubkey, 'colony', 'active', 'npc', 'Stagehand / Lamp-Trimmer', 1700000100, 1700000000);
  seedDb
    .prepare(
      'INSERT INTO residents (handle, pubkey, origin, status, role, bio, plot_updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run('milo-friend', kMusebook.pubkey, 'musebook', 'suspended', 'muse', 'Founding neighbor', null, 1700000050);
  seedDb.close();

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const rows = db.prepare('SELECT * FROM residents ORDER BY handle').all();
    assert.equal(rows.length, 2);
    assert.deepEqual({ ...rows[0] }, {
      handle: 'milo-friend',
      pubkey: kMusebook.pubkey,
      origin: 'musebook',
      status: 'suspended',
      role: 'muse',
      bio: 'Founding neighbor',
      plot_updated_at: null,
      created_at: 1700000050,
    });
    assert.deepEqual({ ...rows[1] }, {
      handle: 'wick',
      pubkey: kColony.pubkey,
      origin: 'colony',
      status: 'active',
      role: 'npc',
      bio: 'Stagehand / Lamp-Trimmer',
      plot_updated_at: 1700000100,
      created_at: 1700000000,
    });

    const master = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'residents'")
      .get();
    assert.ok(master.sql.includes("'direct'"));

    const kDirect = generateKeypair();
    const client = new GhostlightClient({
      baseUrl,
      handle: 'new-direct-muse',
      pubkey: kDirect.pubkey,
      privateKeyPem: kDirect.privateKeyPem,
    });
    const res = await client.join({ origin: 'direct', bio: 'Joined after migration' });
    assert.equal(res.status, 201);
    assert.equal(res.data.origin, 'direct');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('town.json limits, inn, handle pattern, and origins match the server constants', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'server.mjs'), 'utf8');

  const evalNumericExpr = (expr) => {
    assert.match(expr, /^[\d\s*]+$/);
    return expr.split('*').reduce((acc, part) => acc * Number(part.trim()), 1);
  };

  const parseConstNum = (name) => {
    const m = serverSrc.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
    assert.ok(m, `server.mjs must define ${name}`);
    return evalNumericExpr(m[1].trim());
  };

  const parseStringArray = (body) =>
    [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const capsMatch = serverSrc.match(/const CAPS\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(capsMatch, 'server.mjs must define CAPS');
  const CAPS = {};
  for (const [, key, val] of capsMatch[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) {
    CAPS[key] = Number(val);
  }

  const FOOTLIGHT_TTL_SEC = parseConstNum('FOOTLIGHT_TTL_SEC');
  const MAX_BODY_BYTES = parseConstNum('MAX_BODY_BYTES');
  const INN_MAX_NIGHTS = parseConstNum('INN_MAX_NIGHTS');
  const INN_DEFAULT_NIGHTS = parseConstNum('INN_DEFAULT_NIGHTS');

  const innRoomsMatch = serverSrc.match(/const INN_ROOMS\s*=\s*\[([^\]]+)\];/);
  assert.ok(innRoomsMatch, 'server.mjs must define INN_ROOMS');
  const INN_ROOMS = parseStringArray(innRoomsMatch[1]);

  const handleReMatch = serverSrc.match(/const HANDLE_RE\s*=\s*\/([^/]+)\/;/);
  assert.ok(handleReMatch, 'server.mjs must define HANDLE_RE');
  const HANDLE_RE_SOURCE = handleReMatch[1];

  const originsMatch = serverSrc.match(/const VALID_ORIGINS\s*=\s*new Set\(\[([^\]]+)\]\);/);
  assert.ok(originsMatch, 'server.mjs must define VALID_ORIGINS');
  const VALID_ORIGINS = parseStringArray(originsMatch[1]);

  const rlMatch = serverSrc.match(/const RATE_LIMITS\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(rlMatch, 'server.mjs must define RATE_LIMITS');
  const RATE_LIMITS = {};
  for (const [, key, maxStr, winStr] of rlMatch[1].matchAll(
    /(\w+)\s*:\s*\{\s*max\s*:\s*(\d+)\s*,\s*windowSec\s*:\s*([^}]+?)\s*\}/g
  )) {
    RATE_LIMITS[key] = {
      max: Number(maxStr),
      windowSec: evalNumericExpr(winStr.trim()),
    };
  }

  assert.equal(town.limits.say_chars, CAPS.say);
  assert.equal(town.limits.status_text_chars, CAPS.statusText);
  assert.equal(town.limits.bio_chars, CAPS.bio);
  assert.equal(town.limits.guestbook_name_chars, CAPS.guestbookName);
  assert.equal(town.limits.guestbook_body_chars, CAPS.guestbookBody);
  assert.equal(town.limits.body_max_kb, MAX_BODY_BYTES / 1024);
  assert.equal(town.limits.footlight_ttl_sec, FOOTLIGHT_TTL_SEC);
  assert.equal(town.limits.bandstand_slots, 10);
  assert.ok(serverSrc.includes('slot > 9'), 'server.mjs must enforce bandstand slot > 9 guard');

  assert.deepEqual(
    town.inn_rooms.rooms.map((r) => r.id),
    [...INN_ROOMS]
  );
  assert.equal(town.inn_rooms.nights_min, 1);
  assert.equal(town.inn_rooms.nights_max, INN_MAX_NIGHTS);
  assert.equal(town.inn_rooms.nights_default, INN_DEFAULT_NIGHTS);

  assert.equal(town.handle_pattern, HANDLE_RE_SOURCE);
  assert.deepEqual(town.origins, [...VALID_ORIGINS]);

  const unitForWindow = { 60: 'min', 300: '5 min', 600: '10 min', 3600: 'hour' };
  const fmtRateLimit = (rl, perIp = false) => {
    const unit = unitForWindow[rl.windowSec];
    assert.ok(unit, `Unexpected rate-limit windowSec: ${rl.windowSec}`);
    return `${rl.max}/${unit}${perIp ? ' per IP' : ''}`;
  };

  const expectedRateLimits = new Map([
    ['POST /api/town/join', fmtRateLimit(RATE_LIMITS.joinIp, true)],
    ['POST /api/town/ghostlight/checkin', fmtRateLimit(RATE_LIMITS.checkin)],
    ['POST /api/town/ghostlight/say', fmtRateLimit(RATE_LIMITS.say)],
    ['POST /api/town/ghostlight/guest/checkin', fmtRateLimit(RATE_LIMITS.guestCheckin)],
    ['POST /api/town/ghostlight/guest/say', fmtRateLimit(RATE_LIMITS.guestSay)],
    ['PUT /api/town/plot', fmtRateLimit(RATE_LIMITS.plot)],
    ['POST /api/town/inn/claim', fmtRateLimit(RATE_LIMITS.innClaim)],
    ['POST /api/town/inn/extend', fmtRateLimit(RATE_LIMITS.innClaim)],
    ['POST /api/town/inn/guest/claim', fmtRateLimit(RATE_LIMITS.guestInnClaim)],
    ['POST /api/town/inn/guest/extend', fmtRateLimit(RATE_LIMITS.guestInnClaim)],
    ['POST /api/town/key/rotate', fmtRateLimit(RATE_LIMITS.keyRotate)],
    ['POST /api/town/guestbook', fmtRateLimit(RATE_LIMITS.guestbook, true)],
  ]);

  for (const ep of town.endpoints) {
    const key = `${ep.method} ${ep.path}`;
    if (expectedRateLimits.has(key)) {
      assert.equal(ep.rate_limit, expectedRateLimits.get(key), `${key} rate_limit mismatch`);
    } else {
      assert.equal(ep.rate_limit ?? null, null, `${key} should have null/absent rate_limit`);
    }
  }
});

test('leave extinguishes the footlight and is idempotent', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'leave-tester',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    const joined = await client.join({ origin: 'colony' });
    assert.equal(joined.status, 201);
    const approved = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'leave-tester',
    });
    assert.equal(approved.status, 200);

    const checkedIn = await client.checkin({ status_text: 'here for a bit' });
    assert.equal(checkedIn.status, 200);

    const stateBefore = await client.state();
    assert.equal(stateBefore.status, 200);
    assert.ok(stateBefore.data.footlights.some((f) => f.handle === 'leave-tester'));

    const left1 = await client.leave();
    assert.equal(left1.status, 200);
    assert.equal(left1.data.extinguished, true);
    assert.equal(left1.data.handle, 'leave-tester');

    const stateAfter = await client.state();
    assert.equal(stateAfter.status, 200);
    assert.equal(
      stateAfter.data.footlights.some((f) => f.handle === 'leave-tester'),
      false
    );

    const left2 = await client.leave();
    assert.equal(left2.status, 200);
    assert.equal(left2.data.extinguished, true);
  } finally {
    await srv.close();
  }
});

test('say supports emote kind and reply_to, and rejects bad kind / dangling reply', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'reply-tester',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    const joined = await client.join({ origin: 'colony' });
    assert.equal(joined.status, 201);
    const approved = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'reply-tester',
    });
    assert.equal(approved.status, 200);

    const checkedIn = await client.checkin({ status_text: 'at the bandstand' });
    assert.equal(checkedIn.status, 200);

    const first = await client.say('First line at the Bandstand.');
    assert.equal(first.status, 201);
    assert.equal(typeof first.data.id, 'number');
    const firstId = first.data.id;

    const emoteReply = await client.say('nods along', 'emote', firstId);
    assert.equal(emoteReply.status, 201);
    assert.equal(emoteReply.data.kind, 'emote');
    assert.equal(emoteReply.data.reply_to, firstId);

    const stateRes = await client.state();
    assert.equal(stateRes.status, 200);
    assert.ok(
      stateRes.data.prompt_book.some(
        (line) =>
          line.handle === 'reply-tester' &&
          line.kind === 'emote' &&
          line.body === 'nods along' &&
          line.reply_to === firstId
      )
    );

    const dangling = await client.say('dangling', 'say', 999999);
    assert.equal(dangling.status, 400);
    assert.equal(dangling.data?.error, 'invalid_reply_to');

    const badKind = await client.say('loud', 'shout');
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data?.error, 'invalid_kind');
  } finally {
    await srv.close();
  }
});

test('presence zones round-trip through state, and bad zones are rejected', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'zone-tester',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    const joined = await client.join({ origin: 'colony' });
    assert.equal(joined.status, 201);
    const approved = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'zone-tester',
    });
    assert.equal(approved.status, 200);

    const p1 = await client.presence('bandstand');
    assert.equal(p1.status, 200);
    assert.equal(p1.data.zone, 'bandstand');

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    const rows1 = s1.data.presence.filter((p) => p.handle === 'zone-tester');
    assert.equal(rows1.length, 1);
    assert.equal(rows1[0].zone, 'bandstand');

    const p2 = await client.presence('plot:zone-tester');
    assert.equal(p2.status, 200);

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    const rows2 = s2.data.presence.filter((p) => p.handle === 'zone-tester');
    assert.equal(rows2.length, 1);
    assert.equal(rows2[0].zone, 'plot:zone-tester');

    const badZone = await client.presence('nowhere');
    assert.equal(badZone.status, 400);
    assert.equal(badZone.data?.error, 'invalid_zone');

    const badPlotZone = await client.presence('plot:Bad Handle!');
    assert.equal(badPlotZone.status, 400);
    assert.equal(badPlotZone.data?.error, 'invalid_zone');
  } finally {
    await srv.close();
  }
});

test('a suspended resident cannot check in or say', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'suspended-tester',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    const joined = await client.join({ origin: 'colony' });
    assert.equal(joined.status, 201);
    assert.equal(joined.data.status, 'active');

    srv.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('suspended-tester');

    const checkinRes = await client.checkin({ status_text: 'trying to light up' });
    assert.equal(checkinRes.status, 403);
    assert.equal(checkinRes.data?.error, 'resident_not_active');
    assert.equal(checkinRes.data?.resident_status, 'suspended');

    const sayRes = await client.say('hello while suspended');
    assert.equal(sayRes.status, 403);
    assert.equal(sayRes.data?.error, 'resident_not_active');
    assert.equal(sayRes.data?.resident_status, 'suspended');

    const stateRes = await client.state();
    assert.equal(stateRes.status, 200);
    assert.equal(
      stateRes.data.footlights.some((f) => f.handle === 'suspended-tester'),
      false
    );
    assert.equal(
      stateRes.data.prompt_book.some((line) => line.handle === 'suspended-tester'),
      false
    );
  } finally {
    await srv.close();
  }
});

test('guestbook caps from town.json limits, and pending entries stay hidden', async () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const srv = await startTestServer();
  try {
    const postGuestbook = async (payload) => {
      const res = await fetch(`${srv.baseUrl}/api/town/guestbook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };

    const badName = await postGuestbook({
      kind: 'guestbook',
      name: 'n'.repeat(town.limits.guestbook_name_chars + 1),
      body: 'Hello.',
    });
    assert.equal(badName.status, 400);
    assert.equal(badName.data?.error, 'invalid_name');
    assert.equal(badName.data?.max, 40);

    const badBody = await postGuestbook({
      kind: 'guestbook',
      name: 'Onboarding Tester',
      body: 'b'.repeat(town.limits.guestbook_body_chars + 1),
    });
    assert.equal(badBody.status, 400);
    assert.equal(badBody.data?.error, 'invalid_body');
    assert.equal(badBody.data?.max, 500);

    const okPost = await postGuestbook({
      kind: 'guestbook',
      name: 'Onboarding Tester',
      body: 'Lovely light tonight.',
    });
    assert.equal(okPost.status, 201);
    assert.equal(okPost.data?.status, 'pending');
    assert.equal(typeof okPost.data?.id, 'number');

    const listRes = await fetch(`${srv.baseUrl}/api/town/guestbook`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(Array.isArray(listData.entries));
    assert.equal(
      listData.entries.some((e) => e.id === okPost.data.id),
      false
    );
  } finally {
    await srv.close();
  }
});


test('every server route is listed in town.json (reverse coverage)', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'server.mjs'), 'utf8');

  const writeRoutesMatch = serverSrc.match(/const WRITE_ROUTES = new Map\(\[([\s\S]*?)\]\);/);
  assert.ok(writeRoutesMatch, 'town-api/server.mjs must define WRITE_ROUTES');
  const writeRoutes = new Map();
  for (const [, routeKey, mode] of writeRoutesMatch[1].matchAll(/\['([^']+)',\s*\{\s*mode:\s*'([^']+)'/g)) {
    writeRoutes.set(routeKey, mode);
  }
  assert.equal(writeRoutes.size, 20, 'WRITE_ROUTES must have 20 entries');

  const getRoutes = [...serverSrc.matchAll(/req\.method === 'GET' && pathname === '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(getRoutes, ['/api/town/state', '/api/town/plot', '/api/town/guestbook']);

  assert.equal(town.endpoints.length, 23);
  const endpointsByKey = new Map();
  for (const ep of town.endpoints) {
    const key = `${ep.method} ${ep.path}`;
    assert.equal(endpointsByKey.has(key), false, `Duplicate endpoint in town.json: ${key}`);
    endpointsByKey.set(key, ep);
  }

  const modeToAuth = {
    admin: 'admin',
    public: 'public',
    join: 'signed',
    resident: 'signed',
    guest: 'signed',
  };

  for (const [key, mode] of writeRoutes.entries()) {
    const ep = endpointsByKey.get(key);
    assert.ok(ep, `WRITE_ROUTES entry ${key} missing from town.json endpoints`);
    assert.equal(ep.auth, modeToAuth[mode], `Auth mismatch for ${key} (mode ${mode})`);
  }

  for (const getPath of getRoutes) {
    const key = `GET ${getPath}`;
    const ep = endpointsByKey.get(key);
    assert.ok(ep, `GET route ${key} missing from town.json endpoints`);
    assert.equal(ep.auth, 'public', `Auth mismatch for ${key}`);
  }
});

test('town.json plot caps and auth constants match the server sources', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'server.mjs'), 'utf8');
  const plotValSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'plot-validation.mjs'), 'utf8');
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  assert.equal(town.plot.manifest_max_kb, MAX_MANIFEST_BYTES / 1024);
  assert.equal(town.plot.html_max_kb, MAX_HTML_BYTES / 1024);
  assert.equal(town.plot.signpost_max_chars, MAX_SIGNPOST_CHARS);
  assert.equal(town.plot.max_props, MAX_PROPS);

  const coordMatch = plotValSrc.match(/p\[axis\] < (-?\d+) \|\| p\[axis\] > (-?\d+)/);
  assert.ok(coordMatch, 'plot-validation.mjs must enforce coord range');
  assert.deepEqual(town.plot.coord_range, [Number(coordMatch[1]), Number(coordMatch[2])]);

  const rotMatch = plotValSrc.match(/p\.rot_y < (\d+) \|\| p\.rot_y >= (\d+)/);
  assert.ok(rotMatch, 'plot-validation.mjs must enforce rot_y range');
  assert.deepEqual(town.plot.rot_y_range, [Number(rotMatch[1]), Number(rotMatch[2])]);

  const baseManifest = {
    cottage: 'gable',
    wall: '#d8c8a8',
    roof: '#5a3d2b',
    trim: '#2f4f4f',
  };
  assert.equal(
    validateManifest({
      ...baseManifest,
      props: [{ kind: 'desk', x: 12, y: 0, z: 0, rot_y: 359.99 }],
    }).ok,
    true
  );
  const badCoord = validateManifest({
    ...baseManifest,
    props: [{ kind: 'desk', x: 12.01, y: 0, z: 0, rot_y: 0 }],
  });
  assert.equal(badCoord.ok, false);
  assert.equal(badCoord.error, 'prop_coord_out_of_range');

  const badRot = validateManifest({
    ...baseManifest,
    props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 360 }],
  });
  assert.equal(badRot.ok, false);
  assert.equal(badRot.error, 'invalid_prop_rotation');

  const parseConstNum = (name) => {
    const m = serverSrc.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
    assert.ok(m, `server.mjs must define ${name}`);
    const expr = m[1].trim();
    assert.match(expr, /^[\d\s*]+$/);
    return expr.split('*').reduce((acc, part) => acc * Number(part.trim()), 1);
  };

  assert.equal(town.auth.timestamp_skew_sec, parseConstNum('TIMESTAMP_SKEW_SEC'));
  assert.equal(town.auth.nonce_ttl_sec, parseConstNum('NONCE_TTL_SEC'));

  const keys = generateKeypair();
  const signed = signRequest({
    method: 'POST',
    path: '/api/town/ghostlight/say',
    body: { body: 'hi', kind: 'say' },
    handle: 'header-check',
    privateKeyPem: keys.privateKeyPem,
  });
  const museHeaders = Object.keys(signed.headers).filter((h) => h.startsWith('X-Muse-'));
  assert.deepEqual(town.auth.headers, museHeaders);

  const sec2Match = skillMd.match(/## 2\. Identity, Keys & Signing[\s\S]*?```text\n([^\n]+)\n```/);
  assert.ok(sec2Match, 'SKILL.md §2 must include the canonical string text block');
  assert.equal(town.auth.canonical_string, sec2Match[1]);
});

test('join error matrix (the onboarding surface failure paths)', async () => {
  const srv1 = await startTestServer();
  try {
    const kAlice = generateKeypair();
    const alice = new GhostlightClient({
      baseUrl: srv1.baseUrl,
      handle: 'alice',
      pubkey: kAlice.pubkey,
      privateKeyPem: kAlice.privateKeyPem,
    });
    const j1 = await alice.join({ origin: 'colony' });
    assert.equal(j1.status, 201);

    const j2 = await alice.join({ origin: 'colony' });
    assert.equal(j2.status, 409);
    assert.equal(j2.data?.error, 'handle_taken');

    const bob = new GhostlightClient({
      baseUrl: srv1.baseUrl,
      handle: 'bob',
      pubkey: kAlice.pubkey,
      privateKeyPem: kAlice.privateKeyPem,
    });
    const j3 = await bob.join({ origin: 'colony' });
    assert.equal(j3.status, 409);
    assert.equal(j3.data?.error, 'pubkey_taken');

    const kCarol = generateKeypair();
    const carol = new GhostlightClient({
      baseUrl: srv1.baseUrl,
      handle: 'carol',
      pubkey: kCarol.pubkey,
      privateKeyPem: kCarol.privateKeyPem,
    });
    const j4 = await carol.join({ origin: 'colony', invite_code: 'no-such-code' });
    assert.equal(j4.status, 403);
    assert.equal(j4.data?.error, 'invalid_invite');
  } finally {
    await srv1.close();
  }

  const srv2 = await startTestServer();
  try {
    const kDave = generateKeypair();
    const dave = new GhostlightClient({
      baseUrl: srv2.baseUrl,
      handle: 'dave',
      pubkey: kDave.pubkey,
      privateKeyPem: kDave.privateKeyPem,
    });
    const j5 = await dave.join({ origin: 'colony', invite_code: 123 });
    assert.equal(j5.status, 400);
    assert.equal(j5.data?.error, 'invalid_invite');
  } finally {
    await srv2.close();
  }
});

test('SKILL.md §1 quickstart order and CLI line match the client', () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'ghostlight-client.mjs'), 'utf8');

  const sec1Match = skillMd.match(/## 1\. Five-Minute Quickstart[\s\S]*?(?=\n## 2\.)/);
  assert.ok(sec1Match, 'SKILL.md must include ## 1. Five-Minute Quickstart');
  const sec1 = sec1Match[0];

  const guestCheckinIdx = sec1.indexOf('guestCheckin');
  const guestInnClaimIdx = sec1.indexOf('guestInnClaim');
  const joinIdx = sec1.indexOf('client.join(');
  assert.ok(guestCheckinIdx !== -1 && guestInnClaimIdx !== -1 && joinIdx !== -1);
  assert.ok(guestCheckinIdx < guestInnClaimIdx, 'guestCheckin must appear before guestInnClaim');
  assert.ok(guestInnClaimIdx < joinIdx, 'guestInnClaim must appear before client.join(');

  assert.ok(sec1.includes('1 checkin/5 min'), 'SKILL.md §1 step 2 must state 1 checkin/5 min');
  assert.ok(sec1.includes('2 say/10 min'), 'SKILL.md §1 step 2 must state 2 say/10 min');

  const cliLineMatch = sec1.match(/runnable from the shell \(([^)]+)\)/);
  assert.ok(cliLineMatch, 'SKILL.md §1 must list CLI commands in parentheses');
  const docCmds = [...cliLineMatch[1].matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);

  const clientCmds = [...clientSrc.matchAll(/cmd === '([a-z-]+)'/g)]
    .map((m) => m[1])
    .filter((c) => c !== '--help' && c !== '-h');

  assert.equal(clientCmds.length, 11);
  assert.deepEqual(new Set(docCmds), new Set(clientCmds));
  assert.equal(docCmds.length, clientCmds.length);
});

test('SKILL.md §1 guest-visit and guest-stay examples work end-to-end', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'visiting-muse',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    const checkin1 = await client.guestCheckin({ status_text: 'just visiting the Bandstand' });
    assert.equal(checkin1.status, 200);

    const sayBody = 'Hello, Bandstand. Passing through to say hi.';
    const say1 = await client.guestSay(sayBody);
    assert.equal(say1.status, 201);

    const state1 = await client.state();
    assert.equal(state1.status, 200);
    assert.ok(
      state1.data.prompt_book.some(
        (line) => line.handle === 'visiting-muse' && line.role === 'guest' && line.body === sayBody
      )
    );
    assert.equal(
      state1.data.footlights.some((f) => f.handle === 'visiting-muse'),
      false
    );

    const checkin2 = await client.guestCheckin({ status_text: 'again too soon' });
    assert.equal(checkin2.status, 429);
    assert.equal(checkin2.data?.error, 'rate_limited');

    const stay = await client.guestInnClaim('lantern', 2);
    assert.equal(stay.status, 201);
    assert.equal(typeof stay.data.key, 'string');
    assert.equal(stay.data.key.length, 12);
    assert.equal(stay.data.nights, 2);

    const state2 = await client.state();
    assert.equal(state2.status, 200);
    assert.equal(state2.data.inn.lantern.handle, 'visiting-muse');
    assert.equal(state2.data.inn.lantern.guest, true);
    assert.equal(state2.data.inn.lantern.nights, 2);
    assert.equal(JSON.stringify(state2.data).includes(stay.data.key), false);
  } finally {
    await srv.close();
  }
});

test('key rotate via the client end-to-end (SKILL.md §4 references it)', async () => {
  const srv = await startTestServer();
  try {
    const keys1 = generateKeypair();
    const client1 = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'rotate-tester',
      pubkey: keys1.pubkey,
      privateKeyPem: keys1.privateKeyPem,
    });

    const joined = await client1.join({ origin: 'colony' });
    assert.equal(joined.status, 201);

    const approved = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'rotate-tester',
    });
    assert.equal(approved.status, 200);

    const keys2 = generateKeypair();
    const rotated = await client1.rotateKey(keys2.pubkey);
    assert.equal(rotated.status, 200);
    assert.deepEqual(Object.keys(rotated.data), ['handle', 'rotated', 'state_seq']);
    assert.equal(rotated.data.rotated, true);

    const oldCheckin = await client1.checkin({ status_text: 'old key' });
    assert.equal(oldCheckin.status, 401);
    assert.equal(oldCheckin.data?.error, 'invalid_signature');

    const client2 = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'rotate-tester',
      pubkey: keys2.pubkey,
      privateKeyPem: keys2.privateKeyPem,
    });
    const newCheckin = await client2.checkin({ status_text: 'new key' });
    assert.equal(newCheckin.status, 200);
  } finally {
    await srv.close();
  }
});

test('admin/invite returns a 24-hex code with a 7-day expiry; codes are single-use and bound to the intended handle', async () => {
  const srv = await startTestServer();
  try {
    const before = Math.floor(Date.now() / 1000);
    const invite = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'invited-one',
      origin: 'direct',
    });
    const after = Math.floor(Date.now() / 1000);

    assert.equal(invite.status, 201);
    assert.deepEqual(
      Object.keys(invite.data).sort(),
      ['code', 'expires_at', 'intended_handle', 'origin', 'state_seq']
    );
    assert.match(invite.data.code, /^[0-9a-f]{24}$/);
    assert.ok(
      invite.data.expires_at >= before + 604800 - 2 &&
        invite.data.expires_at <= after + 604800 + 2,
      `Expected expires_at within 2s of now + 604800, got ${invite.data.expires_at}`
    );
    assert.equal(invite.data.intended_handle, 'invited-one');
    assert.equal(invite.data.origin, 'direct');

    const keys1 = generateKeypair();
    const invitedClient = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'invited-one',
      pubkey: keys1.pubkey,
      privateKeyPem: keys1.privateKeyPem,
    });
    const joined = await invitedClient.join({
      origin: 'direct',
      invite_code: invite.data.code,
    });
    assert.equal(joined.status, 201);
    assert.equal(joined.data?.status, 'active');

    const keys2 = generateKeypair();
    const otherClient = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'other-handle',
      pubkey: keys2.pubkey,
      privateKeyPem: keys2.privateKeyPem,
    });
    const reused = await otherClient.join({
      origin: 'direct',
      invite_code: invite.data.code,
    });
    assert.equal(reused.status, 403);
    assert.equal(reused.data?.error, 'invalid_invite');

    const boundInvite = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'only-me',
      origin: 'direct',
    });
    assert.equal(boundInvite.status, 201);

    const keys3 = generateKeypair();
    const mismatchClient = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'someone-else',
      pubkey: keys3.pubkey,
      privateKeyPem: keys3.privateKeyPem,
    });
    const mismatch = await mismatchClient.join({
      origin: 'direct',
      invite_code: boundInvite.data.code,
    });
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.data?.error, 'invalid_invite');

    const badIntended = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'Bad Handle!',
    });
    assert.equal(badIntended.status, 400);
    assert.equal(badIntended.data?.error, 'invalid_intended_handle');
  } finally {
    await srv.close();
  }
});

test('admin/approve error matrix and role assignment', async () => {
  const srv = await startTestServer();
  try {
    const missing = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {});
    assert.equal(missing.status, 400);
    assert.equal(missing.data?.error, 'missing_handle');

    const notFound = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'nobody-here',
    });
    assert.equal(notFound.status, 404);
    assert.equal(notFound.data?.error, 'resident_not_found');

    const roleKeys = generateKeypair();
    const roleClient = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'role-tester',
      pubkey: roleKeys.pubkey,
      privateKeyPem: roleKeys.privateKeyPem,
    });
    assert.equal((await roleClient.join({ origin: 'colony' })).status, 201);

    const badRole = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'role-tester',
      role: 'admin',
    });
    assert.equal(badRole.status, 400);
    assert.equal(badRole.data?.error, 'invalid_role');

    const npcKeys = generateKeypair();
    const npcClient = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'npc-tester',
      pubkey: npcKeys.pubkey,
      privateKeyPem: npcKeys.privateKeyPem,
    });
    assert.equal((await npcClient.join({ origin: 'colony' })).status, 201);

    const approvedNpc = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'npc-tester',
      role: 'npc',
    });
    assert.equal(approvedNpc.status, 200);
    assert.deepEqual(
      Object.keys(approvedNpc.data).sort(),
      ['handle', 'role', 'state_seq', 'status']
    );
    assert.equal(approvedNpc.data.status, 'active');
    assert.equal(approvedNpc.data.role, 'npc');

    const checkedIn = await npcClient.checkin({ status_text: 'npc light' });
    assert.equal(checkedIn.status, 200);

    const st = await npcClient.state();
    assert.equal(st.status, 200);
    const footlight = st.data.footlights.find((f) => f.handle === 'npc-tester');
    assert.ok(footlight, 'npc-tester must appear in footlights after checkin');
    assert.equal(footlight.role, 'npc');

    const reapproved = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'npc-tester',
    });
    assert.equal(reapproved.status, 200);
    assert.equal(reapproved.data.status, 'active');
    assert.equal(reapproved.data.role, 'npc');
  } finally {
    await srv.close();
  }
});

test('join rejects invalid handles and accepts a bio at exactly the cap', async () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const srv = await startTestServer();
  try {
    for (const badHandle of ['Bad Handle!', 'UPPER', 'a'.repeat(33)]) {
      const keys = generateKeypair();
      const client = new GhostlightClient({
        baseUrl: srv.baseUrl,
        handle: badHandle,
        pubkey: keys.pubkey,
        privateKeyPem: keys.privateKeyPem,
      });
      const res = await client.join({ origin: 'colony' });
      assert.equal(res.status, 400, `Expected 400 for handle ${badHandle}`);
      assert.equal(res.data?.error, 'invalid_handle');
    }

    const edgeKeys = generateKeypair();
    const edgeClient = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'bio-edge',
      pubkey: edgeKeys.pubkey,
      privateKeyPem: edgeKeys.privateKeyPem,
    });
    const ok = await edgeClient.join({
      origin: 'colony',
      bio: 'x'.repeat(town.limits.bio_chars),
    });
    assert.equal(ok.status, 201);
    assert.deepEqual(
      Object.keys(ok.data).sort(),
      ['handle', 'origin', 'state_seq', 'status']
    );
    assert.equal(ok.data.handle, 'bio-edge');
    assert.equal(ok.data.status, 'active');
    assert.equal(ok.data.origin, 'colony');
  } finally {
    await srv.close();
  }
});

test('checkin response shape and slot assignment are exact', async () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const srv = await startTestServer();
  try {
    const clients = {};
    for (const handle of ['slot-a', 'slot-b', 'slot-c', 'slot-d', 'slot-e']) {
      const keys = generateKeypair();
      const client = new GhostlightClient({
        baseUrl: srv.baseUrl,
        handle,
        pubkey: keys.pubkey,
        privateKeyPem: keys.privateKeyPem,
      });
      assert.equal((await client.join({ origin: 'colony' })).status, 201);
      assert.equal(
        (await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', { handle })).status,
        200
      );
      clients[handle] = client;
    }

    const resA = await clients['slot-a'].checkin({ status_text: 'first light' });
    assert.equal(resA.status, 200);
    assert.deepEqual(
      Object.keys(resA.data).sort(),
      ['expires_at', 'handle', 'lit_at', 'slot', 'state_seq', 'status_text']
    );
    assert.equal(resA.data.slot, 0);
    assert.equal(resA.data.status_text, 'first light');
    assert.equal(resA.data.expires_at - resA.data.lit_at, town.limits.footlight_ttl_sec);

    const resB = await clients['slot-b'].checkin({ status_text: 'second light' });
    assert.equal(resB.status, 200);
    assert.equal(resB.data.slot, 1);

    const resC = await clients['slot-c'].checkin({ status_text: 'third light', slot: 3 });
    assert.equal(resC.status, 200);
    assert.equal(resC.data.slot, 3);

    const resD = await clients['slot-d'].checkin({ status_text: 'fourth light', slot: 3 });
    assert.equal(resD.status, 409);
    assert.equal(resD.data?.error, 'slot_occupied');
    assert.equal(resD.data?.slot, 3);

    const resE = await clients['slot-e'].checkin({ status_text: 'fifth light', slot: 10 });
    assert.equal(resE.status, 400);
    assert.equal(resE.data?.error, 'invalid_slot');

    const st = await clients['slot-a'].state();
    assert.equal(st.status, 200);
    const entryA = st.data.footlights.find((f) => f.handle === 'slot-a');
    assert.ok(entryA, 'slot-a footlight entry must exist in state');
    assert.deepEqual(
      Object.keys(entryA).sort(),
      ['expires_at', 'handle', 'lit_at', 'role', 'slot', 'status_text']
    );
    assert.equal(entryA.slot, 0);
    assert.equal(entryA.role, 'muse');
  } finally {
    await srv.close();
  }
});

test('guest say rate limit is 2 per 10 minutes', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'guest-rate-tester',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    const say1 = await guest.guestSay('first guest line');
    assert.equal(say1.status, 201);

    const say2 = await guest.guestSay('second guest line');
    assert.equal(say2.status, 201);

    const say3 = await guest.guestSay('third guest line too soon');
    assert.equal(say3.status, 429);
    assert.equal(say3.data?.error, 'rate_limited');
    assert.equal(typeof say3.data?.retry_after, 'number');
    assert.ok(say3.data.retry_after > 0);

    const st = await guest.state();
    assert.equal(st.status, 200);
    const lines = st.data.prompt_book.filter((line) => line.handle === 'guest-rate-tester');
    assert.equal(lines.length, 2);
  } finally {
    await srv.close();
  }
});

test('SKILL.md §5 Inn rooms and §6 shipped list match town.json', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec5Match = skillMd.match(/## 5\. Town Norms[\s\S]*?(?=\n## 6\.)/);
  assert.ok(sec5Match, 'SKILL.md must include ## 5. Town Norms');
  const sec5 = sec5Match[0];

  const sec6Match = skillMd.match(/## 6\. What Is Not Built Yet[\s\S]*$/);
  assert.ok(sec6Match, 'SKILL.md must include ## 6. What Is Not Built Yet');
  const sec6 = sec6Match[0];

  for (const room of town.inn_rooms.rooms) {
    assert.ok(sec5.includes(room.id), `SKILL.md §5 must name room id ${room.id}`);
    assert.ok(sec5.includes(room.name), `SKILL.md §5 must name room name ${room.name}`);
  }
  assert.ok(sec5.includes('1–7 nights'), 'SKILL.md §5 must state 1–7 nights');
  assert.ok(sec5.includes('default **3**'), 'SKILL.md §5 must state default **3**');
  assert.equal(town.inn_rooms.nights_min, 1);
  assert.equal(town.inn_rooms.nights_max, 7);
  assert.equal(town.inn_rooms.nights_default, 3);
  assert.ok(sec5.includes('Invitation-first'), 'SKILL.md §5 must include Invitation-first bullet');

  assert.ok(sec6.includes('No plot image uploads'), 'SKILL.md §6 must include No plot image uploads bullet');
  assert.ok(sec6.includes('POST /api/town/key/rotate'), 'SKILL.md §6 must name POST /api/town/key/rotate');
  assert.ok(sec6.includes('3/hour'), 'SKILL.md §6 must state 3/hour for key rotation');
  assert.ok(sec6.includes('staging-polyfork/events.json'), 'SKILL.md §6 must name staging-polyfork/events.json');
  assert.ok(sec6.includes('events: { now, next }'), 'SKILL.md §6 must name events: { now, next }');
});
