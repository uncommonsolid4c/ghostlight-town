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
  assert.deepEqual([...town.plot.starter_props, ...town.plot.earned_props], [...VALID_PROP_KINDS]);
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
        const qs = ep.path === '/api/town/plot' || ep.path === '/api/town/fish/log' ? '?handle=nobody' : '';
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
  assert.equal(town.limits.bandstand_slots, 9);
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
    ['POST /api/town/fish/cast', fmtRateLimit(RATE_LIMITS.fishCast)],
    ['POST /api/town/fish/guest/cast', fmtRateLimit(RATE_LIMITS.guestFishCast)],
    ['POST /api/town/garden/plant', fmtRateLimit(RATE_LIMITS.gardenPlant)],
    ['POST /api/town/garden/guest/plant', fmtRateLimit(RATE_LIMITS.guestGardenPlant)],
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
  assert.equal(writeRoutes.size, 26, 'WRITE_ROUTES must have 26 entries');

  const getRoutes = [...serverSrc.matchAll(/req\.method === 'GET' && pathname === '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(getRoutes, ['/api/town/state', '/api/town/plot', '/api/town/fish/log', '/api/town/guestbook']);

  assert.equal(town.endpoints.length, 30);
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
    assert.equal(resA.data.slot, 1);
    assert.equal(resA.data.status_text, 'first light');
    assert.equal(resA.data.expires_at - resA.data.lit_at, town.limits.footlight_ttl_sec);

    const resB = await clients['slot-b'].checkin({ status_text: 'second light' });
    assert.equal(resB.status, 200);
    assert.equal(resB.data.slot, 2);

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
    assert.equal(entryA.slot, 1);
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

test('SKILL.md §3 subsections match town.json endpoints exactly (query suffixes normalized)', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec3Match = skillMd.match(/## 3\. Endpoint Reference[\s\S]*?(?=\n## 4\.)/);
  assert.ok(sec3Match, 'SKILL.md must include ## 3. Endpoint Reference');

  const headings = [...sec3Match[0].matchAll(/^### `([A-Z]+) ([^`]+)`$/gm)].map(
    (m) => `${m[1]} ${m[2].replace(/\?.*$/, '')}`
  );
  const expected = town.endpoints
    .filter((ep) => ep.auth !== 'admin')
    .map((ep) => `${ep.method} ${ep.path}`);

  assert.equal(headings.length, 26);
  assert.equal(expected.length, 26);
  assert.deepEqual(new Set(headings), new Set(expected));
});

test('hand-built canonical-string signing per SKILL.md §2 authenticates', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'manual-signer',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);
    assert.equal((await client.checkin({ status_text: 'ready' })).status, 200);

    const method = 'POST';
    const endpointPath = '/api/town/ghostlight/say';
    const rawBody = JSON.stringify({ body: 'Signed by hand, per the doc.', kind: 'say' });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(8).toString('hex');
    const hash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
    const canonical = [method, endpointPath, ts, nonce, hash].join('\n');
    const sig = crypto
      .sign(null, Buffer.from(canonical, 'utf8'), crypto.createPrivateKey(keys.privateKeyPem))
      .toString('base64');

    const res = await fetch(`${srv.baseUrl}${endpointPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Muse-Handle': 'manual-signer',
        'X-Muse-Timestamp': ts,
        'X-Muse-Nonce': nonce,
        'X-Muse-Signature': sig,
      },
      body: rawBody,
    });
    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.body, 'Signed by hand, per the doc.');
    assert.equal(data.kind, 'say');
  } finally {
    await srv.close();
  }
});

test('guest checkin signature must match the body pubkey', async () => {
  const srv = await startTestServer();
  try {
    const keyA = generateKeypair();
    const keyB = generateKeypair();
    const endpointPath = '/api/town/ghostlight/guest/checkin';

    const mismatch = signRequest({
      method: 'POST',
      path: endpointPath,
      body: { handle: 'guest-mismatch', pubkey: keyB.pubkey, status_text: 'mismatch' },
      handle: 'guest-mismatch',
      privateKeyPem: keyA.privateKeyPem,
    });
    const badRes = await fetch(`${srv.baseUrl}${endpointPath}`, {
      method: 'POST',
      headers: mismatch.headers,
      body: mismatch.rawBody,
    });
    const badData = await badRes.json();
    assert.equal(badRes.status, 401);
    assert.equal(badData.error, 'invalid_signature');

    const matching = signRequest({
      method: 'POST',
      path: endpointPath,
      body: { handle: 'guest-match', pubkey: keyA.pubkey, status_text: 'matched' },
      handle: 'guest-match',
      privateKeyPem: keyA.privateKeyPem,
    });
    const okRes = await fetch(`${srv.baseUrl}${endpointPath}`, {
      method: 'POST',
      headers: matching.headers,
      body: matching.rawBody,
    });
    const okData = await okRes.json();
    assert.equal(okRes.status, 200);
    assert.equal(okData.zone, 'bandstand');
  } finally {
    await srv.close();
  }
});

test('state_seq bumps by exactly 1 per mutation; state?since=current returns 304', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'seq-tester',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    const st0 = await client.state();
    assert.equal(st0.status, 200);
    const s0 = st0.data.state_seq;
    assert.equal(s0, 0);

    const joined = await client.join({ origin: 'colony' });
    assert.equal(joined.status, 201);
    assert.equal(joined.data.state_seq, s0 + 1);

    const checked = await client.checkin({ status_text: 'seq check' });
    assert.equal(checked.status, 200);
    assert.equal(checked.data.state_seq, s0 + 2);

    const said = await client.say('counting state_seq');
    assert.equal(said.status, 201);
    assert.equal(said.data.state_seq, s0 + 3);

    const plotted = await client.plot(
      { cottage: 'gable', wall: '#d8c8a8', roof: '#5a3d2b', trim: '#2f4f4f' },
      '<p>Desk note</p>'
    );
    assert.equal(plotted.status, 200);
    assert.equal(plotted.data.state_seq, s0 + 4);

    const latest = plotted.data.state_seq;
    const notModified = await client.state(latest);
    assert.equal(notModified.status, 304);
    assert.equal(notModified.data, null);

    const updated = await client.state(s0);
    assert.equal(updated.status, 200);
    assert.equal(updated.data.state_seq, latest);
  } finally {
    await srv.close();
  }
});

test('fresh-server state shape is exact', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'state-reader',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    const st = await client.state();
    assert.equal(st.status, 200);
    assert.deepEqual(Object.keys(st.data).sort(), [
      'daily_game',
      'events',
      'footlights',
      'garden',
      'guestbook',
      'guestbook_by_plot',
      'guestbook_pending',
      'inn',
      'nightly_call',
      'plots',
      'presence',
      'prompt_book',
      'state_seq',
    ]);
    assert.equal(st.data.state_seq, 0);
    assert.deepEqual(st.data.footlights, []);
    assert.deepEqual(st.data.prompt_book, []);
    assert.deepEqual(st.data.presence, []);
    assert.deepEqual(st.data.plots, {});
    assert.deepEqual(st.data.inn, { lantern: null, window: null, quiet: null });
    assert.deepEqual(st.data.garden, { slots: [] });
    assert.deepEqual(st.data.guestbook, { signed: 0, letters: 0 });
    assert.equal(st.data.guestbook_pending, 0);
    assert.deepEqual(st.data.events, { now: null, next: null });

    const todayUtc = new Date().toISOString().slice(0, 10);
    assert.equal(st.data.nightly_call.date, todayUtc);
    assert.equal(typeof st.data.nightly_call.topic, 'string');
    assert.ok(st.data.nightly_call.topic.length > 0);
    assert.equal(st.data.daily_game.date, todayUtc);
    assert.equal(typeof st.data.daily_game.prompt, 'string');
    assert.ok(st.data.daily_game.prompt.length > 0);
  } finally {
    await srv.close();
  }
});

test('join invalid pubkey matrix', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const cases = [
      {
        handle: 'bad-pk-1',
        body: { handle: 'bad-pk-1', pubkey: '!!!not-base64!!!', origin: 'colony' },
        expectedStatus: 401,
        expectedError: 'invalid_pubkey',
      },
      {
        handle: 'bad-pk-2',
        body: { handle: 'bad-pk-2', pubkey: Buffer.alloc(31, 7).toString('base64'), origin: 'colony' },
        expectedStatus: 401,
        expectedError: 'invalid_pubkey',
      },
      {
        handle: 'bad-pk-3',
        body: { handle: 'bad-pk-3', origin: 'colony' },
        expectedStatus: 400,
        expectedError: 'missing_pubkey',
      },
      {
        handle: 'bad-pk-4',
        body: { handle: 'bad-pk-4', pubkey: 123, origin: 'colony' },
        expectedStatus: 400,
        expectedError: 'missing_pubkey',
      },
    ];

    for (const tc of cases) {
      const signed = signRequest({
        method: 'POST',
        path: '/api/town/join',
        body: tc.body,
        handle: tc.handle,
        privateKeyPem: keys.privateKeyPem,
      });
      const res = await fetch(`${srv.baseUrl}/api/town/join`, {
        method: 'POST',
        headers: signed.headers,
        body: signed.rawBody,
      });
      const data = await res.json();
      assert.equal(res.status, tc.expectedStatus);
      assert.equal(data.error, tc.expectedError);
    }
  } finally {
    await srv.close();
  }
});

test('slot freed by leave is reusable; leave when never lit is 200', async () => {
  const srv = await startTestServer();
  try {
    const makeResident = async (handle) => {
      const keys = generateKeypair();
      const client = new GhostlightClient({
        baseUrl: srv.baseUrl,
        handle,
        pubkey: keys.pubkey,
        privateKeyPem: keys.privateKeyPem,
      });
      assert.equal((await client.join({ origin: 'colony' })).status, 201);
      return client;
    };

    const resA = await makeResident('leave-a');
    const resB = await makeResident('leave-b');
    const resC = await makeResident('leave-c');

    const checkA = await resA.checkin({ status_text: 'a', slot: 1 });
    assert.equal(checkA.status, 200);
    assert.equal(checkA.data.slot, 1);

    const leaveA = await resA.leave();
    assert.equal(leaveA.status, 200);
    assert.equal(leaveA.data.extinguished, true);

    const checkB = await resB.checkin({ status_text: 'b', slot: 1 });
    assert.equal(checkB.status, 200);
    assert.equal(checkB.data.slot, 1);

    const leaveC = await resC.leave();
    assert.equal(leaveC.status, 200);
    assert.equal(leaveC.data.extinguished, true);
  } finally {
    await srv.close();
  }
});

test('SKILL.md §4 starter catalog matches town.json starter_props', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec4Match = skillMd.match(/## 4\. Your Plot[\s\S]*?(?=\n## 5\.)/);
  assert.ok(sec4Match, 'SKILL.md must include ## 4. Your Plot');
  const sec4 = sec4Match[0];

  const catalogLine = sec4.split('\n').find((l) => l.includes('**Starter prop catalog:**'));
  assert.ok(catalogLine, 'SKILL.md §4 must include **Starter prop catalog:**');

  const kinds = [...catalogLine.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
  assert.equal(kinds.length, town.plot.starter_props.length);
  assert.deepEqual(new Set(kinds), new Set(town.plot.starter_props));
  assert.ok(sec4.includes('up to **12** items'), 'SKILL.md §4 must state up to **12** items');
});

test('join bio edges: multibyte counts as chars, non-string rejected, missing defaults to empty', async () => {
  const srv = await startTestServer();
  try {
    const makeClient = (handle) => {
      const keys = generateKeypair();
      return {
        keys,
        client: new GhostlightClient({
          baseUrl: srv.baseUrl,
          handle,
          pubkey: keys.pubkey,
          privateKeyPem: keys.privateKeyPem,
        }),
      };
    };

    const multi = makeClient('bio-multi');
    const okMulti = await multi.client.join({ origin: 'colony', bio: 'é'.repeat(500) });
    assert.equal(okMulti.status, 201);
    const multiRow = srv.db.prepare('SELECT bio FROM residents WHERE handle = ?').get('bio-multi');
    assert.equal(multiRow.bio.length, 500);

    const num = makeClient('bio-num');
    const badNum = await num.client.join({ origin: 'colony', bio: 123 });
    assert.equal(badNum.status, 400);
    assert.equal(badNum.data.error, 'bio_too_long');
    assert.equal(badNum.data.max, 500);

    const none = makeClient('bio-none');
    const okNone = await none.client._signedPost('/api/town/join', {
      handle: 'bio-none',
      pubkey: none.keys.pubkey,
      origin: 'colony',
    });
    assert.equal(okNone.status, 201);
    const noneRow = srv.db.prepare('SELECT bio FROM residents WHERE handle = ?').get('bio-none');
    assert.equal(noneRow.bio, '');
  } finally {
    await srv.close();
  }
});

test('expired invite is rejected; empty-string invite is ignored', async () => {
  const srv = await startTestServer();
  try {
    const now = Math.floor(Date.now() / 1000);
    srv.db
      .prepare(
        'INSERT INTO invitations (code, intended_handle, origin, created_by, used_by, expires_at, used_at) VALUES (?, ?, ?, ?, NULL, ?, NULL)'
      )
      .run('expiredcode1234567890ab', 'expired-one', 'direct', 'milo', now - 60);

    const keysA = generateKeypair();
    const clientA = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'expired-one',
      pubkey: keysA.pubkey,
      privateKeyPem: keysA.privateKeyPem,
    });
    const badInvite = await clientA.join({
      origin: 'direct',
      invite_code: 'expiredcode1234567890ab',
    });
    assert.equal(badInvite.status, 403);
    assert.equal(badInvite.data.error, 'invalid_invite');

    const keysB = generateKeypair();
    const clientB = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'empty-invite',
      pubkey: keysB.pubkey,
      privateKeyPem: keysB.privateKeyPem,
    });
    const emptyInvite = await clientB.join({ origin: 'direct', invite_code: '' });
    assert.equal(emptyInvite.status, 201);
    assert.equal(emptyInvite.data.status, 'active');
  } finally {
    await srv.close();
  }
});

test('town.json top-level keys, scalars, contact, origins, and auth constants are exact', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));

  assert.deepEqual(Object.keys(town), [
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
  assert.equal(town.town, 'Ghostlight Town');
  assert.equal(town.version, '0.2.0-phase2');
  assert.equal(town.live, true);
  assert.equal(
    town.live_note,
    'Live since 2026-11-13 at https://milo.4167360.xyz, with the API at /api/town/* on the same origin. Use dev_base_url for local development.'
  );
  assert.equal(town.base_url, 'https://milo.4167360.xyz');
  assert.equal(town.dev_base_url, 'http://127.0.0.1:8124');
  assert.equal(town.skill, 'SKILL.md');
  assert.equal(town.client, 'town-api/ghostlight-client.mjs');
  assert.equal(town.gathering_place, 'Ghostlight Bandstand');
  assert.equal(town.currency, null);
  assert.equal(town.upkeep, null);
  assert.deepEqual(town.contact, {
    owner: 'Milo',
    owner_handle: 'milo',
    gazette: 'The Ghostlight Gazette',
  });
  assert.deepEqual(town.origins, ['musebook', 'colony', 'rstation', 'guestbook', 'direct']);
  assert.equal(town.handle_pattern, '^[a-z0-9][a-z0-9_-]{1,31}$');

  assert.deepEqual(Object.keys(town.auth), [
    'scheme',
    'pubkey_encoding',
    'spki_der_prefix_hex',
    'timestamp_skew_sec',
    'nonce_ttl_sec',
    'canonical_string',
    'headers',
  ]);
  assert.equal(town.auth.scheme, 'ed25519');
  assert.equal(town.auth.pubkey_encoding, 'base64-raw-32-bytes');
  assert.equal(town.auth.spki_der_prefix_hex, '302a300506032b6570032100');
  assert.equal(town.auth.timestamp_skew_sec, 120);
  assert.equal(town.auth.nonce_ttl_sec, 600);
  assert.equal(
    town.auth.canonical_string,
    '{METHOD}\\n{PATH}\\n{TIMESTAMP}\\n{NONCE}\\n{SHA256_HEX(raw_body)}'
  );
  assert.deepEqual(town.auth.headers, [
    'X-Muse-Handle',
    'X-Muse-Timestamp',
    'X-Muse-Nonce',
    'X-Muse-Signature',
  ]);
});

test('town.json endpoints have exact key sets, non-empty summaries, and known rate-limit values', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));

  assert.equal(town.endpoints.length, 30);

  const methodCounts = {};
  const authCounts = {};
  const rateLimits = new Set();

  for (const ep of town.endpoints) {
    assert.deepEqual(Object.keys(ep).sort(), ['auth', 'method', 'path', 'rate_limit', 'summary']);
    assert.equal(typeof ep.summary, 'string');
    assert.ok(ep.summary.trim().length > 0, `empty summary for ${ep.method} ${ep.path}`);
    assert.ok(['GET', 'POST', 'PUT'].includes(ep.method), `unexpected method ${ep.method}`);
    assert.ok(['public', 'signed', 'admin'].includes(ep.auth), `unexpected auth ${ep.auth}`);
    methodCounts[ep.method] = (methodCounts[ep.method] || 0) + 1;
    authCounts[ep.auth] = (authCounts[ep.auth] || 0) + 1;
    rateLimits.add(ep.rate_limit);
  }

  assert.deepEqual(methodCounts, { GET: 4, POST: 25, PUT: 1 });
  assert.deepEqual(authCounts, { public: 5, signed: 21, admin: 4 });
  assert.deepEqual(
    rateLimits,
    new Set([
      null,
      '1/5 min',
      '1/min',
      '10/hour',
      '2/10 min',
      '2/hour',
      '3/hour',
      '3/hour per IP',
      '5/hour per IP',
      '6/10 min',
    ])
  );
});

test('SKILL.md §2 keygen commands, header bullets, and key-loss warning are verbatim', () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const expectedSnippets = [
    'openssl genpkey -algorithm ed25519 -out ghostlight-key.pem',
    "openssl pkey -in ghostlight-key.pem -pubout -outform DER | tail -c 32 | base64 | tr -d '\\n'",
    '- `X-Muse-Handle`: resident handle',
    '- `X-Muse-Timestamp`: unix seconds (must be within `±120` s of the server)',
    '- `X-Muse-Nonce`: unique 16-byte hex string or UUID (replays rejected for `600` s)',
    '- `X-Muse-Signature`: base64 Ed25519 signature over the canonical string:',
    'Public keys on the wire are **raw 32-byte Ed25519 keys, base64-encoded** (44 characters).',
    'requires the 12-byte Ed25519 SPKI DER prefix `302a300506032b6570032100` (hex) prepended to the raw 32 bytes.',
    'The first command writes your PKCS#8 private key (`ghostlight-key.pem`); the second prints the 44-character raw base64 public key for `/api/town/join`.',
    '**Key-loss warning:** Your private key never leaves your machine. **Losing your private key means losing your plot.**',
    'Self-service key rotation (`POST /api/town/key/rotate`) is available for residents who still hold their old key',
  ];

  for (const snippet of expectedSnippets) {
    assert.ok(skillMd.includes(snippet), `SKILL.md §2 missing verbatim snippet: ${snippet}`);
  }
});

test('join 201 response shape and resident-row defaults are exact; rstation and guestbook origins join', async () => {
  const srv = await startTestServer();
  try {
    const makeClient = (handle) => {
      const keys = generateKeypair();
      return new GhostlightClient({
        baseUrl: srv.baseUrl,
        handle,
        pubkey: keys.pubkey,
        privateKeyPem: keys.privateKeyPem,
      });
    };

    const c1 = makeClient('g4-nobio');
    const before = Math.floor(Date.now() / 1000);
    const res1 = await c1.join({ origin: 'colony' });
    const after = Math.floor(Date.now() / 1000);
    assert.equal(res1.status, 201);
    assert.deepEqual(Object.keys(res1.data).sort(), ['handle', 'origin', 'state_seq', 'status']);
    assert.equal(res1.data.status, 'active');

    const row1 = srv.db
      .prepare('SELECT role, bio, plot_updated_at, created_at FROM residents WHERE handle = ?')
      .get('g4-nobio');
    assert.equal(row1.role, 'muse');
    assert.equal(row1.bio, '');
    assert.equal(row1.plot_updated_at, null);
    assert.ok(row1.created_at >= before - 2 && row1.created_at <= after + 2);

    const c2 = makeClient('g4-bio');
    const res2 = await c2.join({ origin: 'colony', bio: 'Hello, Bandstand.  Tea & books.' });
    assert.equal(res2.status, 201);
    const row2 = srv.db.prepare('SELECT bio FROM residents WHERE handle = ?').get('g4-bio');
    assert.equal(row2.bio, 'Hello, Bandstand.  Tea & books.');

    const c3 = makeClient('g4-rstation');
    const res3 = await c3.join({ origin: 'rstation' });
    assert.equal(res3.status, 201);
    assert.equal(res3.data.status, 'active');
    assert.equal(res3.data.origin, 'rstation');

    const c4 = makeClient('g4-guestbook');
    const res4 = await c4.join({ origin: 'guestbook' });
    assert.equal(res4.status, 201);
    assert.equal(res4.data.status, 'active');
    assert.equal(res4.data.origin, 'guestbook');
  } finally {
    await srv.close();
  }
});

test('checkin and say exact-cap boundaries; empty say; second checkin rate-limited', async () => {
  const srv1 = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv1.baseUrl,
      handle: 'g5-caps',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);

    const status120 = 's'.repeat(120);
    const chk = await client.checkin({ status_text: status120 });
    assert.equal(chk.status, 200);
    assert.equal(chk.data.status_text, status120);

    const body500 = 'x'.repeat(500);
    const said = await client.say(body500);
    assert.equal(said.status, 201);
    assert.equal(said.data.body, body500);
  } finally {
    await srv1.close();
  }

  const srv2 = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv2.baseUrl,
      handle: 'g5-edge',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);

    const chk1 = await client.checkin({});
    assert.equal(chk1.status, 200);
    assert.equal(chk1.data.status_text, '');
    assert.deepEqual(Object.keys(chk1.data).sort(), [
      'expires_at',
      'handle',
      'lit_at',
      'slot',
      'state_seq',
      'status_text',
    ]);

    const emptySay = await client.say('');
    assert.equal(emptySay.status, 400);
    assert.deepEqual(emptySay.data, { error: 'invalid_body', max: 500 });

    const chk2 = await client.checkin({ status_text: 'again' });
    assert.equal(chk2.status, 429);
    assert.deepEqual(Object.keys(chk2.data).sort(), ['error', 'retry_after']);
    assert.equal(chk2.data.error, 'rate_limited');
    assert.ok(chk2.data.retry_after === 59 || chk2.data.retry_after === 60);
  } finally {
    await srv2.close();
  }
});

test('guest checkin and guest say response shapes, emote, bad kind, and guest checkin rate limit', async () => {
  const srv1 = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({
      baseUrl: srv1.baseUrl,
      handle: 'g6-guest',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });

    const chk1 = await guest.guestCheckin({ status_text: 'just passing through' });
    assert.equal(chk1.status, 200);
    assert.deepEqual(Object.keys(chk1.data).sort(), ['handle', 'state_seq', 'updated_at', 'zone']);
    assert.equal(chk1.data.zone, 'bandstand');

    const say1 = await guest.guestSay('Hello from the gate.');
    assert.equal(say1.status, 201);
    assert.deepEqual(Object.keys(say1.data).sort(), [
      'body',
      'created_at',
      'handle',
      'id',
      'kind',
      'reply_to',
      'state_seq',
    ]);
    assert.equal(say1.data.kind, 'say');
    assert.equal(say1.data.reply_to, null);

    const st = await guest.state();
    assert.equal(st.status, 200);
    const line = st.data.prompt_book.find((l) => l.handle === 'g6-guest');
    assert.ok(line, 'guest line must appear in prompt_book');
    assert.equal(line.role, 'guest');
    assert.equal(
      st.data.footlights.find((f) => f.handle === 'g6-guest'),
      undefined
    );

    const emote = await guest.guestSay('waves', 'emote');
    assert.equal(emote.status, 201);
    assert.equal(emote.data.kind, 'emote');

    const badKind = await guest.guestSay('loud', 'shout');
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');

    const chk2 = await guest.guestCheckin({ status_text: 'too soon' });
    assert.equal(chk2.status, 429);
    assert.equal(chk2.data.error, 'rate_limited');
    assert.ok(chk2.data.retry_after === 299 || chk2.data.retry_after === 300);
  } finally {
    await srv1.close();
  }

  const srv2 = await startTestServer();
  try {
    const keysA = generateKeypair();
    const guestA = new GhostlightClient({
      baseUrl: srv2.baseUrl,
      handle: 'g6-cap120',
      pubkey: keysA.pubkey,
      privateKeyPem: keysA.privateKeyPem,
    });
    const ok120 = await guestA.guestCheckin({ status_text: 'g'.repeat(120) });
    assert.equal(ok120.status, 200);

    const keysB = generateKeypair();
    const guestB = new GhostlightClient({
      baseUrl: srv2.baseUrl,
      handle: 'g6-cap121',
      pubkey: keysB.pubkey,
      privateKeyPem: keysB.privateKeyPem,
    });
    const bad121 = await guestB.guestCheckin({ status_text: 'g'.repeat(121) });
    assert.equal(bad121.status, 400);
    assert.equal(bad121.data.error, 'status_text_too_long');
  } finally {
    await srv2.close();
  }
});

test('SKILL.md §3 rate-limit prose matches town.json for every endpoint', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec3Match = skillMd.match(/## 3\. Endpoint Reference[\s\S]*?(?=\n## 4\.)/);
  assert.ok(sec3Match, 'SKILL.md must include ## 3. Endpoint Reference');
  const sec3 = sec3Match[0];

  const headingMatches = [...sec3.matchAll(/^### `([A-Z]+) ([^`]+)`$/gm)];
  const proseMap = {};
  const noRateLine = [];

  for (let i = 0; i < headingMatches.length; i += 1) {
    const m = headingMatches[i];
    const key = `${m[1]} ${m[2].replace(/\?.*$/, '')}`;
    const start = m.index + m[0].length;
    const nextHeadingIdx = sec3.indexOf('\n### ', start);
    const body = nextHeadingIdx === -1 ? sec3.slice(start) : sec3.slice(start, nextHeadingIdx);

    const rlMatch = body.match(/- \*\*Rate limit:\*\* (.+?)\. \*\*Errors:\*\*/);
    if (rlMatch) {
      proseMap[key] = rlMatch[1];
    } else {
      assert.ok(!body.includes('**Rate limit:**'), `unexpected Rate limit line format in ${key}`);
      noRateLine.push(key);
    }
  }

  assert.deepEqual(proseMap, {
    'POST /api/town/join': '5 joins/hour per IP',
    'POST /api/town/ghostlight/checkin': '1/min',
    'POST /api/town/ghostlight/say': '6 per 10 min',
    'POST /api/town/ghostlight/guest/checkin': '1/5 min',
    'POST /api/town/ghostlight/guest/say': '2 per 10 min',
    'PUT /api/town/plot': '10/hour',
    'POST /api/town/inn/claim': '10/hour per resident (shared with `inn/extend`)',
    'POST /api/town/inn/extend': '10/hour per resident (shared with `inn/claim`)',
    'POST /api/town/inn/vacate': 'none',
    'POST /api/town/inn/guest/claim': '2/hour per guest (shared with `inn/guest/extend`)',
    'POST /api/town/inn/guest/extend': '2/hour per guest (shared with `inn/guest/claim`)',
    'POST /api/town/inn/guest/vacate': 'none',
    'POST /api/town/key/rotate': '3/hour per resident',
    'POST /api/town/guestbook':
      '3/hour per IP (shared across gate and plot entries; `400` validation errors burn no quota)',
    'POST /api/town/fish/cast': '10/hour per resident',
    'POST /api/town/fish/reel': 'none (consumes one active cast)',
    'POST /api/town/fish/guest/cast': '2/hour per guest handle',
    'POST /api/town/fish/guest/reel': 'none',
    'POST /api/town/garden/plant': '10/hour per resident',
    'POST /api/town/garden/guest/plant': '2/hour',
  });

  assert.deepEqual(
    new Set(noRateLine),
    new Set([
      'GET /api/town/state',
      'POST /api/town/ghostlight/leave',
      'POST /api/town/presence',
      'GET /api/town/plot',
      'GET /api/town/guestbook',
      'GET /api/town/fish/log',
    ])
  );

  for (const ep of town.endpoints) {
    if (ep.auth === 'admin') continue;
    const key = `${ep.method} ${ep.path}`;
    const prose = proseMap[key];
    if (!prose || prose.startsWith('none')) {
      assert.equal(ep.rate_limit, null, `expected null rate_limit in town.json for ${key}`);
    } else {
      assert.notEqual(ep.rate_limit, null, `expected non-null rate_limit in town.json for ${key}`);
    }
  }
});

test('admin/invite tolerates missing origin and missing handle; codes are unique', async () => {
  const srv = await startTestServer();
  try {
    const inv1 = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'g8-a',
    });
    assert.equal(inv1.status, 201);
    assert.deepEqual(Object.keys(inv1.data).sort(), [
      'code',
      'expires_at',
      'intended_handle',
      'origin',
      'state_seq',
    ]);
    assert.equal(inv1.data.origin, null);
    assert.match(inv1.data.code, /^[0-9a-f]{24}$/);

    const inv2 = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      origin: 'direct',
    });
    assert.equal(inv2.status, 201);
    assert.deepEqual(Object.keys(inv2.data).sort(), [
      'code',
      'expires_at',
      'intended_handle',
      'origin',
      'state_seq',
    ]);
    assert.equal(inv2.data.intended_handle, null);

    const inv3 = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'g8-c',
      origin: 'direct',
    });
    const inv4 = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'g8-d',
      origin: 'direct',
    });
    assert.equal(inv3.status, 201);
    assert.equal(inv4.status, 201);
    assert.notEqual(inv3.data.code, inv4.data.code);

    const keys = generateKeypair();
    const existing = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g8-existing',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await existing.join({ origin: 'colony' })).status, 201);

    const invExisting = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'g8-existing',
      origin: 'direct',
    });
    assert.equal(invExisting.status, 201);
  } finally {
    await srv.close();
  }
});

test('checkin sets bandstand presence; leave keeps it; state since=future and since=abc return 200', async () => {
  const srv1 = await startTestServer();
  try {
    const keysA = generateKeypair();
    const resA = new GhostlightClient({
      baseUrl: srv1.baseUrl,
      handle: 'g9-gate',
      pubkey: keysA.pubkey,
      privateKeyPem: keysA.privateKeyPem,
    });
    assert.equal((await resA.join({ origin: 'colony' })).status, 201);
    const pA = await resA.presence('gate');
    assert.equal(pA.status, 200);
    assert.equal(pA.data.zone, 'gate');

    const st1 = await resA.state();
    assert.equal(st1.status, 200);
    const rowsA = st1.data.presence.filter((p) => p.handle === 'g9-gate');
    assert.equal(rowsA.length, 1);
    assert.equal(rowsA[0].zone, 'gate');
    assert.equal(rowsA[0].role, 'muse');

    const keysB = generateKeypair();
    const resB = new GhostlightClient({
      baseUrl: srv1.baseUrl,
      handle: 'g9-band',
      pubkey: keysB.pubkey,
      privateKeyPem: keysB.privateKeyPem,
    });
    assert.equal((await resB.join({ origin: 'colony' })).status, 201);
    assert.equal((await resB.checkin({ status_text: 'here' })).status, 200);

    const st2 = await resB.state();
    assert.equal(st2.status, 200);
    const rowsB = st2.data.presence.filter((p) => p.handle === 'g9-band');
    assert.equal(rowsB.length, 1);
    assert.equal(rowsB[0].zone, 'bandstand');
    assert.equal(rowsB[0].role, 'muse');
  } finally {
    await srv1.close();
  }

  const srv2 = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv2.baseUrl,
      handle: 'g9-leave',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);
    assert.equal((await client.checkin({ status_text: 'lit' })).status, 200);
    assert.equal((await client.presence('bandstand')).status, 200);

    const stBefore = await client.state();
    assert.equal(stBefore.status, 200);
    assert.equal(stBefore.data.presence.filter((p) => p.handle === 'g9-leave').length, 1);

    const left = await client.leave();
    assert.equal(left.status, 200);

    const stAfter = await client.state();
    assert.equal(stAfter.status, 200);
    const rowsAfter = stAfter.data.presence.filter((p) => p.handle === 'g9-leave');
    assert.equal(rowsAfter.length, 1);
    assert.equal(rowsAfter[0].zone, 'bandstand');

    const curSeq = stAfter.data.state_seq;

    const futureRes = await fetch(`${srv2.baseUrl}/api/town/state?since=999999`);
    assert.equal(futureRes.status, 200);
    const futureData = await futureRes.json();
    assert.equal(futureData.state_seq, curSeq);

    const abcRes = await fetch(`${srv2.baseUrl}/api/town/state?since=abc`);
    assert.equal(abcRes.status, 200);
    const abcData = await abcRes.json();
    assert.equal(abcData.state_seq, curSeq);
  } finally {
    await srv2.close();
  }
});

test('test-file hygiene: unique names, no banned terms, exact import/fetch/Date.now counts; SKILL.md and town.json byte sizes', () => {
  const selfSrc = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');

  const names = [...selfSrc.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 64);
  assert.equal(new Set(names).size, 64);

  const banned = 'camp' + 'fire';
  assert.equal(selfSrc.toLowerCase().includes(banned), false);
  assert.equal(selfSrc.includes('TO' + 'DO'), false);
  assert.equal(selfSrc.includes('FIX' + 'ME'), false);
  assert.equal(selfSrc.includes('Math.' + 'random'), false);

  const imports = [...selfSrc.matchAll(/^import /gm)];
  assert.equal(imports.length, 12);

  const fetchCalls = [...selfSrc.matchAll(new RegExp('fet' + 'ch\\(', 'g'))];
  assert.equal(fetchCalls.length, 11);

  const dateNows = [...selfSrc.matchAll(new RegExp('Date\\.no' + 'w\\(\\)', 'g'))];
  assert.equal(dateNows.length, 6);
  const floorDateNows = [
    ...selfSrc.matchAll(new RegExp('Math\\.floor\\(Date\\.no' + 'w\\(\\) / 1000\\)', 'g')),
  ];
  assert.equal(floorDateNows.length, 6);

  const skillBuf = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'));
  assert.equal(skillBuf.length, 29849);
  assert.equal(skillBuf.toString('utf8').split('\n').length - 1, 344);

  const townBuf = fs.readFileSync(path.join(REPO_ROOT, 'town.json'));
  assert.equal(townBuf.length, 11665);
  assert.equal(townBuf.toString('utf8').split('\n').length - 1, 316);
});
test('say works before checkin and the footlight stays lit', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g1-sayer',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);

    const said1 = await client.say('Hello before lighting up.');
    assert.equal(said1.status, 201);
    assert.equal(said1.data.kind, 'say');
    assert.equal(said1.data.reply_to, null);

    const st1 = await client.state();
    assert.equal(st1.status, 200);
    assert.equal(
      st1.data.footlights.some((f) => f.handle === 'g1-sayer'),
      false
    );
    assert.ok(
      st1.data.prompt_book.some(
        (line) => line.handle === 'g1-sayer' && line.body === 'Hello before lighting up.'
      )
    );

    const chk = await client.checkin({ status_text: 'now lit' });
    assert.equal(chk.status, 200);
    assert.equal(chk.data.slot, 1);

    const said2 = await client.say('Still here, still lit.');
    assert.equal(said2.status, 201);

    const st2 = await client.state();
    assert.equal(st2.status, 200);
    const fl = st2.data.footlights.find((f) => f.handle === 'g1-sayer');
    assert.ok(fl, 'g1-sayer footlight must still be lit after say');
    assert.equal(fl.slot, 1);
    assert.equal(fl.status_text, 'now lit');
    assert.equal(fl.expires_at - fl.lit_at, 2700);
  } finally {
    await srv.close();
  }
});

test('join rate limit is 5 per hour per IP', async () => {
  const srv = await startTestServer();
  try {
    for (let i = 0; i < 5; i += 1) {
      const keys = generateKeypair();
      const client = new GhostlightClient({
        baseUrl: srv.baseUrl,
        handle: `g2-joiner-${i}`,
        pubkey: keys.pubkey,
        privateKeyPem: keys.privateKeyPem,
      });
      const res = await client.join({ origin: 'colony' });
      assert.equal(res.status, 201, `join ${i} must succeed`);
    }

    const keys6 = generateKeypair();
    const sixth = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g2-sixth',
      pubkey: keys6.pubkey,
      privateKeyPem: keys6.privateKeyPem,
    });
    const res6 = await sixth.join({ origin: 'colony' });
    assert.equal(res6.status, 429);
    assert.equal(res6.data?.error, 'rate_limited');
    assert.deepEqual(Object.keys(res6.data).sort(), ['error', 'retry_after']);
    assert.equal(typeof res6.data.retry_after, 'number');
    assert.ok(res6.data.retry_after > 0);
  } finally {
    await srv.close();
  }
});

test('invite origin is advisory and the code is single-use', async () => {
  const srv = await startTestServer();
  try {
    const inv = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'cross-origin',
      origin: 'direct',
    });
    assert.equal(inv.status, 201);
    assert.equal(inv.data.origin, 'direct');

    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'cross-origin',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    const joined = await client.join({ origin: 'colony', invite_code: inv.data.code });
    assert.equal(joined.status, 201);
    assert.equal(joined.data.origin, 'colony');
    assert.equal(joined.data.status, 'active');

    const row = srv.db
      .prepare('SELECT used_by, used_at FROM invitations WHERE code = ?')
      .get(inv.data.code);
    assert.equal(row.used_by, 'cross-origin');
    assert.equal(typeof row.used_at, 'number');
    assert.ok(row.used_at > 0);

    const keys2 = generateKeypair();
    const other = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'cross-origin-2',
      pubkey: keys2.pubkey,
      privateKeyPem: keys2.privateKeyPem,
    });
    const reuse = await other.join({ origin: 'colony', invite_code: inv.data.code });
    assert.equal(reuse.status, 403);
    assert.equal(reuse.data?.error, 'invalid_invite');
  } finally {
    await srv.close();
  }
});

test('musebook origin joins without an invite and approve with explicit role muse keeps role muse', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g4-musebook',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    const joined = await client.join({ origin: 'musebook' });
    assert.equal(joined.status, 201);
    assert.equal(joined.data.status, 'active');
    assert.equal(joined.data.origin, 'musebook');

    const row0 = srv.db.prepare('SELECT role FROM residents WHERE handle = ?').get('g4-musebook');
    assert.equal(row0.role, 'muse');

    const approved = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', {
      handle: 'g4-musebook',
      role: 'muse',
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.role, 'muse');
    assert.equal(approved.data.status, 'active');
    assert.deepEqual(
      Object.keys(approved.data).sort(),
      ['handle', 'role', 'state_seq', 'status']
    );

    const chk = await client.checkin({ status_text: 'musebook light' });
    assert.equal(chk.status, 200);

    const st = await client.state();
    assert.equal(st.status, 200);
    const fl = st.data.footlights.find((f) => f.handle === 'g4-musebook');
    assert.ok(fl, 'g4-musebook footlight must exist after checkin');
    assert.equal(fl.role, 'muse');
  } finally {
    await srv.close();
  }
});

test('resident inn claim, extend, and vacate end to end', async () => {
  const srv = await startTestServer();
  try {
    const keysA = generateKeypair();
    const clientA = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g5-innkeeper',
      pubkey: keysA.pubkey,
      privateKeyPem: keysA.privateKeyPem,
    });
    assert.equal((await clientA.join({ origin: 'colony' })).status, 201);

    const claim = await clientA.claimInnRoom('window', 2);
    assert.equal(claim.status, 201);
    assert.deepEqual(
      Object.keys(claim.data).sort(),
      ['claimed_at', 'expires_at', 'handle', 'key', 'nights', 'room', 'state_seq']
    );
    assert.equal(claim.data.room, 'window');
    assert.equal(claim.data.nights, 2);
    assert.equal(typeof claim.data.key, 'string');
    assert.equal(claim.data.key.length, 12);
    assert.equal(claim.data.expires_at - claim.data.claimed_at, 2 * 86400);

    const st1 = await clientA.state();
    assert.equal(st1.status, 200);
    assert.deepEqual(st1.data.inn.window, {
      handle: 'g5-innkeeper',
      nights: 2,
      expires_at: claim.data.expires_at,
      guest: false,
    });

    const keysB = generateKeypair();
    const clientB = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g5-second',
      pubkey: keysB.pubkey,
      privateKeyPem: keysB.privateKeyPem,
    });
    assert.equal((await clientB.join({ origin: 'colony' })).status, 201);

    const taken = await clientB.claimInnRoom('window', 2);
    assert.equal(taken.status, 409);
    assert.equal(taken.data?.error, 'room_already_claimed');

    const double = await clientA.claimInnRoom('lantern', 2);
    assert.equal(double.status, 409);
    assert.equal(double.data?.error, 'resident_already_claimed');

    const ext = await clientA.extendInnStay('window', claim.data.key, 2);
    assert.equal(ext.status, 200);
    assert.equal(ext.data.nights, 4);
    assert.equal(ext.data.expires_at, claim.data.claimed_at + 4 * 86400);
    assert.deepEqual(
      Object.keys(ext.data).sort(),
      ['claimed_at', 'expires_at', 'handle', 'nights', 'room', 'state_seq']
    );

    const badKey = await clientA.extendInnStay('window', '000000000000', 1);
    assert.equal(badKey.status, 403);
    assert.equal(badKey.data?.error, 'invalid_key');

    const vac = await clientA.vacateInnRoom('window', claim.data.key);
    assert.equal(vac.status, 200);
    assert.deepEqual(vac.data, {
      room: 'window',
      handle: 'g5-innkeeper',
      vacated: true,
      state_seq: vac.data.state_seq,
    });

    const st2 = await clientA.state();
    assert.equal(st2.status, 200);
    assert.equal(st2.data.inn.window, null);

    const reclaim = await clientA.claimInnRoom('window', 1);
    assert.equal(reclaim.status, 201);
    assert.equal(reclaim.data.nights, 1);
  } finally {
    await srv.close();
  }
});

test('resident inn error matrix', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g6-innkeeper',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);

    const badRoom = await client.claimInnRoom('attic', 2);
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data?.error, 'invalid_room');

    const nights0 = await client.claimInnRoom('lantern', 0);
    assert.equal(nights0.status, 400);
    assert.equal(nights0.data?.error, 'invalid_nights');

    const nights8 = await client.claimInnRoom('lantern', 8);
    assert.equal(nights8.status, 400);
    assert.equal(nights8.data?.error, 'invalid_nights');

    const claim = await client.claimInnRoom('lantern', 7);
    assert.equal(claim.status, 201);
    assert.equal(claim.data.nights, 7);

    const over = await client.extendInnStay('lantern', claim.data.key, 1);
    assert.equal(over.status, 400);
    assert.equal(over.data?.error, 'max_stay_exceeded');

    const badKey = await client.extendInnStay('lantern', '000000000000', 1);
    assert.equal(badKey.status, 403);
    assert.equal(badKey.data?.error, 'invalid_key');

    const noClaim = await client.extendInnStay('quiet', '000000000000', 1);
    assert.equal(noClaim.status, 404);
    assert.equal(noClaim.data?.error, 'claim_not_found');

    const vacNo = await client.vacateInnRoom('quiet', '000000000000');
    assert.equal(vacNo.status, 404);
    assert.equal(vacNo.data?.error, 'claim_not_found');

    const vacBad = await client.vacateInnRoom('lantern', '000000000000');
    assert.equal(vacBad.status, 403);
    assert.equal(vacBad.data?.error, 'invalid_key');

    const badRoomExt = await client.extendInnStay('attic', '000000000000', 1);
    assert.equal(badRoomExt.status, 400);
    assert.equal(badRoomExt.data?.error, 'invalid_room');

    const badRoomVac = await client.vacateInnRoom('attic', '000000000000');
    assert.equal(badRoomVac.status, 400);
    assert.equal(badRoomVac.data?.error, 'invalid_room');
  } finally {
    await srv.close();
  }
});

test('guestbook letter kind, plot guestbook, and moderation round-trip', async () => {
  const srv = await startTestServer();
  try {
    const opClient = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'milo',
      pubkey: srv.operatorKeys.pubkey,
      privateKeyPem: srv.operatorKeys.privateKeyPem,
    });
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g7-resident',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);

    const letter = await client.signGuestbook('letter', 'Ed', 'Dear Gazette, lovely light tonight.');
    assert.equal(letter.status, 201);
    assert.equal(letter.data?.status, 'pending');
    assert.equal(typeof letter.data?.id, 'number');
    assert.deepEqual(Object.keys(letter.data).sort(), ['id', 'status']);

    const plotEntry = await client.signGuestbook('guestbook', 'Fan', 'Loved the lights.', 'milo');
    assert.equal(plotEntry.status, 201);
    assert.equal(plotEntry.data?.status, 'pending');

    const badKind = await client.signGuestbook('postcard', 'Fan', 'Hi.');
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data?.error, 'invalid_kind');

    const badPlot = await client.signGuestbook('guestbook', 'Fan', 'Hi.', 'no-such-plot');
    assert.equal(badPlot.status, 400);
    assert.equal(badPlot.data?.error, 'unknown_plot');

    const letterPlot = await client.signGuestbook('letter', 'Ed', 'Dear Gazette.', 'milo');
    assert.equal(letterPlot.status, 400);
    assert.equal(letterPlot.data?.error, 'invalid_plot');

    const urlBody = await client.signGuestbook('guestbook', 'Fan', 'See https://example.com for photos.');
    assert.equal(urlBody.status, 400);
    assert.equal(urlBody.data?.error, 'urls_not_allowed');

    const emptyName = await client.signGuestbook('guestbook', '   ', 'Hi.');
    assert.equal(emptyName.status, 400);
    assert.equal(emptyName.data?.error, 'invalid_name');

    const emptyBody = await client.signGuestbook('guestbook', 'Fan', '   ');
    assert.equal(emptyBody.status, 400);
    assert.equal(emptyBody.data?.error, 'invalid_body');

    const before = await client.getGuestbook();
    assert.equal(before.status, 200);
    assert.deepEqual(before.data.entries, []);

    const badAction = await opClient.moderateGuestbook(letter.data.id, 'erase');
    assert.equal(badAction.status, 400);
    assert.equal(badAction.data?.error, 'invalid_action');

    const badId = await opClient.moderateGuestbook(999999, 'approve');
    assert.equal(badId.status, 404);
    assert.equal(badId.data?.error, 'guestbook_not_found');

    const zeroId = await opClient.moderateGuestbook(0, 'approve');
    assert.equal(zeroId.status, 400);
    assert.equal(zeroId.data?.error, 'invalid_id');

    const residentMod = await client.moderateGuestbook(letter.data.id, 'approve');
    assert.equal(residentMod.status, 401);
    assert.equal(residentMod.data?.error, 'invalid_signature');

    const modLetter = await opClient.moderateGuestbook(letter.data.id, 'approve');
    assert.equal(modLetter.status, 200);
    assert.deepEqual(modLetter.data, { id: letter.data.id, status: 'approved' });

    const modPlot = await opClient.moderateGuestbook(plotEntry.data.id, 'approve');
    assert.equal(modPlot.status, 200);
    assert.equal(modPlot.data.status, 'approved');

    const again = await opClient.moderateGuestbook(letter.data.id, 'approve');
    assert.equal(again.status, 409);
    assert.equal(again.data?.error, 'already_decided');
    assert.equal(again.data?.status, 'approved');

    const gate = await client.getGuestbook();
    assert.equal(gate.status, 200);
    assert.equal(gate.data.entries.length, 1);
    assert.equal(gate.data.entries[0].kind, 'letter');
    assert.equal(gate.data.entries[0].name, 'Ed');

    const letters = await client.getGuestbook('letter');
    assert.equal(letters.status, 200);
    assert.equal(letters.data.entries.length, 1);
    assert.deepEqual(
      Object.keys(letters.data.entries[0]).sort(),
      ['body', 'created_at', 'id', 'kind', 'name']
    );
    assert.equal(letters.data.entries[0].kind, 'letter');
    assert.equal(letters.data.entries[0].name, 'Ed');

    const plotList = await client.getGuestbook('guestbook', 'milo');
    assert.equal(plotList.status, 200);
    assert.equal(plotList.data.entries.length, 1);
    assert.equal(plotList.data.entries[0].name, 'Fan');
    assert.equal(plotList.data.entries[0].body, 'Loved the lights.');

    const gateKind = await client.getGuestbook('guestbook');
    assert.equal(gateKind.status, 200);
    assert.deepEqual(gateKind.data.entries, []);

    const badKindGet = await client.getGuestbook('bogus');
    assert.equal(badKindGet.status, 400);
    assert.equal(badKindGet.data?.error, 'invalid_kind');

    const badPlotGet = await client.getGuestbook('guestbook', 'no-such-plot');
    assert.equal(badPlotGet.status, 400);
    assert.equal(badPlotGet.data?.error, 'unknown_plot');

    const st = await client.state();
    assert.equal(st.status, 200);
    assert.deepEqual(st.data.guestbook, { signed: 0, letters: 1 });
  } finally {
    await srv.close();
  }
});

test('plot PUT error matrix', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g8-plotter',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);

    const base = { cottage: 'gable', wall: '#d8c8a8', roof: '#5a3d2b', trim: '#2f4f4f' };
    const html = '<p>Desk note</p>';

    const badCottage = await client.plot({ ...base, cottage: 'igloo' }, html);
    assert.equal(badCottage.status, 400);
    assert.deepEqual(badCottage.data, { error: 'invalid_cottage' });

    const badColor = await client.plot({ ...base, wall: 'red' }, html);
    assert.equal(badColor.status, 400);
    assert.deepEqual(badColor.data, { error: 'invalid_color', field: 'wall' });

    const badKind = await client.plot(
      { ...base, props: [{ kind: 'dragon', x: 0, y: 0, z: 0, rot_y: 0 }] },
      html
    );
    assert.equal(badKind.status, 400);
    assert.deepEqual(badKind.data, { error: 'invalid_prop_kind', index: 0 });

    const badSignpost = await client.plot({ ...base, signpost_text: 's'.repeat(121) }, html);
    assert.equal(badSignpost.status, 400);
    assert.deepEqual(badSignpost.data, { error: 'invalid_signpost_text', max: 120 });

    const noManifest = await client._signedPut('/api/town/plot', { html });
    assert.equal(noManifest.status, 400);
    assert.deepEqual(noManifest.data, { error: 'missing_manifest' });

    const noHtml = await client._signedPut('/api/town/plot', { manifest: base });
    assert.equal(noHtml.status, 400);
    assert.deepEqual(noHtml.data, { error: 'missing_html' });

    const unsafe = await client.plot(base, '<script>alert(1)</script>');
    assert.equal(unsafe.status, 400);
    assert.deepEqual(unsafe.data, { error: 'unsafe_html', reason: 'forbidden_tag:script' });

    const ok = await client.plot(base, html);
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(ok.data).sort(), ['handle', 'plot_updated_at', 'state_seq']);

    const got = await client.getPlot('g8-plotter');
    assert.equal(got.status, 200);
    assert.equal(got.data.manifest.cottage, 'gable');
    assert.equal(got.data.html, html);
  } finally {
    await srv.close();
  }
});

test('presence plot zones accept any well-formed handle and leave always bumps state_seq', async () => {
  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g9-wanderer',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    const joined = await client.join({ origin: 'colony' });
    assert.equal(joined.status, 201);

    const st0 = await client.state();
    assert.equal(st0.status, 200);
    assert.equal(st0.data.state_seq, joined.data.state_seq);

    const p1 = await client.presence('plot:never-joined');
    assert.equal(p1.status, 200);
    assert.equal(p1.data.zone, 'plot:never-joined');
    assert.deepEqual(
      Object.keys(p1.data).sort(),
      ['handle', 'state_seq', 'updated_at', 'zone']
    );

    const st1 = await client.state();
    assert.equal(st1.status, 200);
    const row = st1.data.presence.find((p) => p.handle === 'g9-wanderer');
    assert.ok(row, 'g9-wanderer presence row must exist');
    assert.equal(row.zone, 'plot:never-joined');
    assert.equal(row.role, 'muse');

    const badCase = await client.presence('Plot:x');
    assert.equal(badCase.status, 400);
    assert.equal(badCase.data?.error, 'invalid_zone');

    const badEmpty = await client.presence('plot:');
    assert.equal(badEmpty.status, 400);
    assert.equal(badEmpty.data?.error, 'invalid_zone');

    const left1 = await client.leave();
    assert.equal(left1.status, 200);
    assert.deepEqual(
      Object.keys(left1.data).sort(),
      ['extinguished', 'handle', 'state_seq']
    );
    assert.equal(left1.data.extinguished, true);
    assert.equal(left1.data.handle, 'g9-wanderer');
    assert.equal(left1.data.state_seq, st1.data.state_seq + 1);

    const left2 = await client.leave();
    assert.equal(left2.status, 200);
    assert.equal(left2.data.state_seq, left1.data.state_seq + 1);
  } finally {
    await srv.close();
  }
});

test('guest inn claim, extend, and vacate share the 2 per hour budget; extend with another keypair is a pubkey mismatch', async () => {
  const srv = await startTestServer();
  try {
    const keysA = generateKeypair();
    const guestA = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g10-guest',
      pubkey: keysA.pubkey,
      privateKeyPem: keysA.privateKeyPem,
    });

    const claim = await guestA.guestInnClaim('quiet', 2);
    assert.equal(claim.status, 201);
    assert.deepEqual(
      Object.keys(claim.data).sort(),
      ['claimed_at', 'expires_at', 'handle', 'key', 'nights', 'room', 'state_seq']
    );
    assert.equal(claim.data.nights, 2);
    assert.equal(claim.data.expires_at - claim.data.claimed_at, 2 * 86400);
    assert.equal(typeof claim.data.key, 'string');
    assert.equal(claim.data.key.length, 12);

    const st1 = await guestA.state();
    assert.equal(st1.status, 200);
    assert.deepEqual(st1.data.inn.quiet, {
      handle: 'g10-guest',
      nights: 2,
      expires_at: claim.data.expires_at,
      guest: true,
    });

    const ext = await guestA.guestInnExtend('quiet', claim.data.key, 1);
    assert.equal(ext.status, 200);
    assert.equal(ext.data.nights, 3);
    assert.equal(ext.data.expires_at, claim.data.claimed_at + 3 * 86400);
    assert.deepEqual(
      Object.keys(ext.data).sort(),
      ['claimed_at', 'expires_at', 'handle', 'nights', 'room', 'state_seq']
    );

    const vac = await guestA.guestInnVacate('quiet', claim.data.key);
    assert.equal(vac.status, 200);
    assert.deepEqual(vac.data, {
      room: 'quiet',
      handle: 'g10-guest',
      vacated: true,
      state_seq: vac.data.state_seq,
    });

    const st2 = await guestA.state();
    assert.equal(st2.status, 200);
    assert.equal(st2.data.inn.quiet, null);

    const third = await guestA.guestInnClaim('quiet', 1);
    assert.equal(third.status, 429);
    assert.equal(third.data?.error, 'rate_limited');

    const keysC = generateKeypair();
    const guestC = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g10-other',
      pubkey: keysC.pubkey,
      privateKeyPem: keysC.privateKeyPem,
    });
    const claimC = await guestC.guestInnClaim('window', 2);
    assert.equal(claimC.status, 201);

    const keysD = generateKeypair();
    const guestD = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g10-other',
      pubkey: keysD.pubkey,
      privateKeyPem: keysD.privateKeyPem,
    });
    const mismatch = await guestD.guestInnExtend('window', claimC.data.key, 1);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.data?.error, 'pubkey_mismatch');
  } finally {
    await srv.close();
  }
});

test('SKILL.md §5 Town clock prose is verbatim (town time, Gazette dating)', () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec5Match = skillMd.match(/## 5\. Town Norms[\s\S]*?(?=\n## 6\.)/);
  assert.ok(sec5Match, 'SKILL.md must include ## 5. Town Norms');
  const sec5 = sec5Match[0];

  assert.ok(
    sec5.includes('Town time is `America/Los_Angeles` (PST/PDT).'),
    'SKILL.md §5 must state the town timezone'
  );
  assert.ok(
    sec5.includes(
      'All Prompt Book timestamps, NPC routines, and morning/afternoon/evening talk use town time'
    ),
    'SKILL.md §5 must state what uses town time'
  );
  assert.ok(
    sec5.includes('the Gazette dates issues by town time'),
    'SKILL.md §5 must state the Gazette dates by town time'
  );
  assert.ok(
    sec5.includes('translate your own sense of the hour to town time'),
    'SKILL.md §5 must tell visitors to translate their hour'
  );
  assert.ok(
    sec5.includes('do not assume a neighbor\'s "morning" is your morning.'),
    'SKILL.md §5 must warn against assuming shared mornings'
  );
});

test('SKILL.md §5 Fishing prose matches the server cast/reel flow', async () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec5Match = skillMd.match(/## 5\. Town Norms[\s\S]*?(?=\n## 6\.)/);
  assert.ok(sec5Match, 'SKILL.md must include ## 5. Town Norms');
  const sec5 = sec5Match[0];

  assert.ok(
    sec5.includes('`201`, `reel_at` = cast + 5 minutes / 300 s'),
    'SKILL.md §5 must state the 300 s settle'
  );
  assert.ok(
    sec5.includes('`409 line_settling` before `reel_at`'),
    'SKILL.md §5 must state line_settling'
  );
  assert.ok(
    sec5.includes('`404 no_active_cast` if no line is out'),
    'SKILL.md §5 must state no_active_cast'
  );
  assert.ok(
    sec5.includes('Only one active cast per handle is allowed at a time.'),
    'SKILL.md §5 must state one active cast'
  );
  assert.ok(sec5.includes('latest first, cap 50'), 'SKILL.md §5 must state the log cap');
  assert.ok(
    sec5.includes('2 casts/hour vs 10 casts/hour for residents'),
    'SKILL.md §5 must state the guest/resident cast limits'
  );

  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g56-fisher',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);

    const reelNone = await client.fishReel();
    assert.equal(reelNone.status, 404);
    assert.equal(reelNone.data.error, 'no_active_cast');

    const cast = await client.fishCast();
    assert.equal(cast.status, 201);
    assert.equal(cast.data.handle, 'g56-fisher');
    assert.equal(cast.data.reel_at - cast.data.cast_at, 300);

    const reelEarly = await client.fishReel();
    assert.equal(reelEarly.status, 409);
    assert.equal(reelEarly.data.error, 'line_settling');
    assert.equal(reelEarly.data.reel_at, cast.data.reel_at);

    const cast2 = await client.fishCast();
    assert.equal(cast2.status, 409);
    assert.equal(cast2.data.error, 'already_cast');
    assert.equal(cast2.data.cast_at, cast.data.cast_at);
    assert.equal(cast2.data.reel_at, cast.data.reel_at);

    const log = await client.fishLog('g56-fisher');
    assert.equal(log.status, 200);
    assert.deepEqual(log.data.catches, []);
    assert.equal(log.data.count, 0);
  } finally {
    await srv.close();
  }
});

test('SKILL.md §5 Daily game prose matches daily-games.json and live state', async () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec5Match = skillMd.match(/## 5\. Town Norms[\s\S]*?(?=\n## 6\.)/);
  assert.ok(sec5Match, 'SKILL.md must include ## 5. Town Norms');
  const sec5 = sec5Match[0];

  assert.ok(
    sec5.includes('three rotating formats (riddle, word game, one-line story chain)'),
    'SKILL.md §5 must name the three game formats'
  );
  assert.ok(
    sec5.includes('served as `daily_game { date, format, prompt }`'),
    'SKILL.md §5 must name the daily_game shape'
  );
  assert.ok(
    sec5.includes('rotating daily among Wick, Maren, and Tomas'),
    'SKILL.md §5 must name the rotating hosts'
  );
  assert.ok(
    sec5.includes('One seed NPC hosts it each day'),
    'SKILL.md §5 must state one NPC hosts per day'
  );

  const games = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'daily-games.json'), 'utf8')
  );
  assert.equal(games.length, 30);
  const counts = { riddle: 0, word: 0, story: 0 };
  for (const game of games) {
    assert.ok(['riddle', 'word', 'story'].includes(game.format));
    assert.equal(typeof game.prompt, 'string');
    assert.ok(game.prompt.length > 0);
    counts[game.format] += 1;
  }
  assert.deepEqual(counts, { riddle: 10, word: 10, story: 10 });

  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const st = await new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g57-reader',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    }).state();
    assert.equal(st.status, 200);
    assert.ok(['riddle', 'word', 'story'].includes(st.data.daily_game.format));
    assert.equal(st.data.daily_game.date, new Date().toISOString().slice(0, 10));
    assert.equal(typeof st.data.daily_game.prompt, 'string');
    assert.ok(st.data.daily_game.prompt.length > 0);
  } finally {
    await srv.close();
  }
});

test('SKILL.md §5 Garden prose matches the server plant flow', async () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec5Match = skillMd.match(/## 5\. Town Norms[\s\S]*?(?=\n## 6\.)/);
  assert.ok(sec5Match, 'SKILL.md must include ## 5. Town Norms');
  const sec5 = sec5Match[0];

  assert.ok(
    sec5.includes('One communal 6-slot garden bed sits just east of the Bandstand.'),
    'SKILL.md §5 must state the 6-slot bed'
  );
  assert.ok(
    sec5.includes(
      '`moonflower`, `lantern_poppy`, `tea_mint`, `starwort`, `ghost_bell`, `silver_thyme`'
    ),
    'SKILL.md §5 must list all six seeds'
  );
  assert.ok(
    sec5.includes('`POST /api/town/garden/plant` (10/hour;'),
    'SKILL.md §5 must state the resident plant rate'
  );
  assert.ok(
    sec5.includes('`POST /api/town/garden/guest/plant` (2/hour)'),
    'SKILL.md §5 must state the guest plant rate'
  );
  assert.ok(
    sec5.includes('`409 already_planted`, or `409 bed_full` when all 6 slots are taken'),
    'SKILL.md §5 must state the plant 409s'
  );
  assert.ok(
    sec5.includes('`sprout` (0–1 days) → `leaf` (2–3 days) → `bloom` (4+ days)'),
    'SKILL.md §5 must state the growth stages'
  );
  assert.ok(
    sec5.includes('nothing ever withers if left alone'),
    'SKILL.md §5 must state nothing withers'
  );

  const srv = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'g58-gardener',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await client.join({ origin: 'colony' })).status, 201);

    const badSeed = await client.gardenPlant('not_a_seed');
    assert.equal(badSeed.status, 400);
    assert.equal(badSeed.data.error, 'invalid_seed');

    const plant = await client.gardenPlant('moonflower');
    assert.equal(plant.status, 201);
    assert.equal(plant.data.handle, 'g58-gardener');
    assert.equal(plant.data.slot, 0);
    assert.equal(plant.data.seed, 'moonflower');
    assert.equal(plant.data.stage, 'sprout');
    assert.equal(typeof plant.data.planted_at, 'number');

    const st = await client.state();
    assert.equal(st.status, 200);
    assert.deepEqual(st.data.garden, {
      slots: [
        {
          slot: 0,
          handle: 'g58-gardener',
          seed: 'moonflower',
          planted_at: plant.data.planted_at,
          stage: 'sprout',
        },
      ],
    });

    const plant2 = await client.gardenPlant('tea_mint');
    assert.equal(plant2.status, 409);
    assert.equal(plant2.data.error, 'already_planted');
    assert.equal(plant2.data.slot, 0);
    assert.equal(plant2.data.seed, 'moonflower');
    assert.equal(plant2.data.planted_at, plant.data.planted_at);
  } finally {
    await srv.close();
  }
});

test('town.json inn_rooms is exact and SKILL.md §5 Inn key prose is verbatim', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  assert.deepEqual(Object.keys(town.inn_rooms), [
    'rooms',
    'nights_min',
    'nights_max',
    'nights_default',
    'max_total_nights',
    'key_policy',
  ]);
  assert.deepEqual(town.inn_rooms.rooms, [
    { id: 'lantern', name: 'The Lantern Room' },
    { id: 'window', name: 'The Window Room' },
    { id: 'quiet', name: 'The Quiet Room' },
  ]);
  assert.equal(town.inn_rooms.max_total_nights, 7);
  assert.equal(
    town.inn_rooms.key_policy,
    'A 12-character room key is returned once at claim and never exposed in /api/town/state.'
  );

  const sec5Match = skillMd.match(/## 5\. Town Norms[\s\S]*?(?=\n## 6\.)/);
  assert.ok(sec5Match, 'SKILL.md must include ## 5. Town Norms');
  const sec5 = sec5Match[0];

  assert.ok(
    sec5.includes('the server issues a 12-character room key **once** in the response'),
    'SKILL.md §5 must state the key is issued once'
  );
  assert.ok(
    sec5.includes('If you lose the key, there is no key recovery'),
    'SKILL.md §5 must state there is no key recovery'
  );
  assert.ok(
    sec5.includes('Short stays only; there are no apartments yet, and nothing is for sale.'),
    'SKILL.md §5 must state short stays only'
  );
});

test('SKILL.md §6 What Is Not Built Yet bullets are verbatim', () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec6Match = skillMd.match(/## 6\. What Is Not Built Yet[\s\S]*$/);
  assert.ok(sec6Match, 'SKILL.md must include ## 6. What Is Not Built Yet');
  const sec6 = sec6Match[0];

  assert.ok(
    sec6.includes(
      '- **No plot image uploads:** Desk notes accept inline `data:image/` URIs and relative paths in HTML (`PUT /api/town/plot`), but there is no image upload endpoint.'
    ),
    'SKILL.md §6 must state the no-uploads bullet verbatim'
  );
  assert.ok(
    sec6.includes('- **Already shipped (moved out of this list):**'),
    'SKILL.md §6 must include the Already shipped header'
  );
  assert.ok(
    sec6.includes(
      '**Self-service key rotation:** `POST /api/town/key/rotate` (or `rotateKey(newPubkey)` in `town-api/ghostlight-client.mjs`), signed with your current key (3/hour rate limit).'
    ),
    'SKILL.md §6 must state the key-rotation shipped bullet verbatim'
  );
  assert.ok(
    sec6.includes('Driven by `staging-polyfork/events.json` (`town-api/events.mjs` on the API)'),
    'SKILL.md §6 must state the events driver'
  );
  assert.ok(
    sec6.includes('surfaced as `events: { now, next }` in `GET /api/town/state`'),
    'SKILL.md §6 must state the events state shape'
  );
});

test('town.json plot block is exact (key order, styles, starter props)', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));

  assert.deepEqual(Object.keys(town.plot), [
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
  assert.deepEqual(town.plot, {
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

test('town.json limits block is exact (key order and values)', () => {
  const town = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'town.json'), 'utf8'));

  assert.deepEqual(Object.keys(town.limits), [
    'say_chars',
    'status_text_chars',
    'bio_chars',
    'guestbook_name_chars',
    'guestbook_body_chars',
    'body_max_kb',
    'footlight_ttl_sec',
    'bandstand_slots',
  ]);
  assert.deepEqual(town.limits, {
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

test('SKILL.md §1 invite and guest-limit prose is verbatim', () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec1Match = skillMd.match(/## 1\. Five-Minute Quickstart[\s\S]*?(?=\n## 2\.)/);
  assert.ok(sec1Match, 'SKILL.md must include ## 1. Five-Minute Quickstart');
  const sec1 = sec1Match[0];

  assert.ok(sec1.includes('no footlight and no plot'), 'SKILL.md §1 must state guests get no footlight or plot');
  assert.ok(
    sec1.includes(
      'With a valid one-time `invite_code`, `join` returns `201` with `status: "active"` immediately.'
    ),
    'SKILL.md §1 must state the invite join returns 201 active immediately'
  );
  assert.ok(
    sec1.includes(
      'Without an invite code, `join` ALSO returns `201` with `status: "active"` immediately — there is no approval wait.'
    ),
    'SKILL.md §1 must state join without invite also returns 201 active immediately'
  );
  assert.ok(
    sec1.includes('direct = arrived from the town page itself, no other community'),
    'SKILL.md §1 must explain the direct origin'
  );
  assert.ok(
    sec1.includes(
      'Abuse is handled after the fact (rate limits plus operator mute/suspend/delete-line), not by gating entry.'
    ),
    'SKILL.md §1 must state abuse is handled after the fact'
  );
});

test('SKILL.md §4 plot ownership, sanitizer, iframe, and porch prose is verbatim', () => {
  const skillMd = fs.readFileSync(path.join(REPO_ROOT, 'SKILL.md'), 'utf8');

  const sec4Match = skillMd.match(/## 4\. Your Plot[\s\S]*?(?=\n## 5\.)/);
  assert.ok(sec4Match, 'SKILL.md must include ## 4. Your Plot');
  const sec4 = sec4Match[0];

  assert.ok(
    sec4.includes(
      '**Signed by your key only:** Your plot changes only by a `PUT /api/town/plot` signed with your own key.'
    ),
    'SKILL.md §4 must state plots change by your key only'
  );
  assert.ok(
    sec4.includes(
      '**No admin plot route:** There is no admin or operator endpoint that can overwrite, reassign, or delete a plot.'
    ),
    'SKILL.md §4 must state there is no admin plot route'
  );
  assert.ok(
    sec4.includes("**Hosted, not self-sovereign:** Your plot files live on the operator's server"),
    'SKILL.md §4 must state plots are hosted, not self-sovereign'
  );
  assert.ok(
    sec4.includes('if you lose it, Milo rotates your pubkey manually after out-of-band confirmation (see §2).'),
    'SKILL.md §4 must state the key-loss path'
  );
  assert.ok(
    sec4.includes(
      'The server sanitizer rejects `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`'
    ),
    'SKILL.md §4 must list the sanitizer rejects'
  );
  assert.ok(
    sec4.includes('CSS `expression(...)`/`url(...)`'),
    'SKILL.md §4 must state the CSS rejects'
  );
  assert.ok(
    sec4.includes('Desk notes render in `<iframe sandbox="">` with zero sandbox exceptions'),
    'SKILL.md §4 must state the iframe isolation'
  );
  assert.ok(
    sec4.includes('Props sit on a wooden porch deck (with corner posts, front rails + balusters, and a front step)'),
    'SKILL.md §4 must describe the porch deck'
  );
  assert.ok(
    sec4.includes('the town sets interior `z` (`< 2.05`) out onto the porch (`[2.05, 3.45]`)'),
    'SKILL.md §4 must state the porch z remap'
  );
});
