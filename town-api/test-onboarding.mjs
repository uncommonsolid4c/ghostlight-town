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

  assert.equal(town.live, true);
  assert.ok(Array.isArray(town.origins) && town.origins.includes('direct'));
  assert.equal(town.gathering_place, 'Ghostlight Bandstand');
  assert.equal(town.currency, null);
  assert.equal(town.upkeep, null);
  assert.equal(town.auth.spki_der_prefix_hex, '302a300506032b6570032100');
  assert.equal(town.auth.pubkey_encoding, 'base64-raw-32-bytes');
  assert.ok(Array.isArray(town.endpoints) && town.endpoints.length >= 11);

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
  assert.ok(md.includes('pending'));
  assert.ok(md.includes('invite_code'));
  assert.ok(md.includes('admin/approve'));
  assert.ok(lower.includes('losing your private key means losing your plot'));
  assert.equal(lower.includes('not up yet'), false, 'SKILL.md must reflect that the live API is up');
  assert.ok(lower.includes('direct'));
  assert.ok(md.includes('America/Los_Angeles'));
  assert.ok(lower.includes('town time'));

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

    // Step 2: Join (pending without invite code)
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
    assert.equal(joined.data.status, 'pending');

    // Step 3: Admin approves
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
    // Join with origin: 'direct' without invite -> 201 pending
    const k1 = generateKeypair();
    const c1 = new GhostlightClient({
      baseUrl: srv.baseUrl,
      handle: 'direct-pending',
      pubkey: k1.pubkey,
      privateKeyPem: k1.privateKeyPem,
    });
    const j1 = await c1.join({ origin: 'direct', bio: 'Arrived from the town page.' });
    assert.equal(j1.status, 201);
    assert.equal(j1.data.status, 'pending');
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
    .run('milo-friend', kMusebook.pubkey, 'musebook', 'pending', 'muse', 'Founding neighbor', null, 1700000050);
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
      status: 'pending',
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
