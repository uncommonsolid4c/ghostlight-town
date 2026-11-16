import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

async function startTestServer({ dbPath: existingDbPath, tmpDir: existingTmpDir } = {}) {
  const tmpDir = existingTmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-key-collision-test-'));
  const dbPath = existingDbPath || path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const nowFn = () => Math.floor(Date.now() / 1000) + clockOffset;

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

async function adminPost(baseUrl, operatorKeys, endpoint, payload) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle: 'milo-op',
    privateKeyPem: operatorKeys.privateKeyPem,
  });
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function createResident(ctx, handle, { approved = true } = {}) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joinRes = await client.join({ origin: 'musebook' });
  assert.equal(joinRes.status, 201);
  if (approved) {
    const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle });
    assert.equal(appRes.status, 200);
  }
  return { client, keys };
}

function createOldSchemaDb(dbPath, rows) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE residents (
      handle          TEXT PRIMARY KEY,
      pubkey          TEXT NOT NULL,
      origin          TEXT NOT NULL CHECK (origin IN ('musebook', 'colony', 'rstation', 'guestbook', 'direct')),
      status          TEXT NOT NULL CHECK (status IN ('pending', 'active', 'muted', 'suspended')),
      role            TEXT NOT NULL DEFAULT 'muse' CHECK (role IN ('muse', 'npc')),
      bio             TEXT NOT NULL DEFAULT '',
      plot_updated_at INTEGER,
      created_at      INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(
    "INSERT INTO residents (handle, pubkey, origin, status, role, bio, plot_updated_at, created_at) VALUES (?, ?, 'musebook', 'active', 'muse', '', NULL, ?)"
  );
  const now = Math.floor(Date.now() / 1000);
  for (const row of rows) {
    insert.run(row.handle, row.pubkey, now);
  }
  db.close();
}

test('join collision returns 409 pubkey_taken without creating resident or bumping state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: bobKeys } = await createResident(ctx, 'bob');
    const seqBefore = (await new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...bobKeys }).state()).data.state_seq;

    const carolClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...bobKeys });
    const joinRes = await carolClient.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 409);
    assert.equal(joinRes.data.error, 'pubkey_taken');

    const carolRow = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('carol');
    assert.equal(carolRow, undefined, 'carol must not be inserted into residents');

    const seqAfter = (await carolClient.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore, 'failed join collision must not bump state_seq');
  } finally {
    await ctx.close();
  }
});

test('rotate collision returns 409 pubkey_taken and leaves both keys, key_history, and state_seq untouched', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    const { client: bob, keys: bobKeys } = await createResident(ctx, 'bob');

    const seqBefore = (await alice.state()).data.state_seq;
    const rotRes = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(rotRes.status, 409);
    assert.equal(rotRes.data.error, 'pubkey_taken');

    // Victim's key still authenticates only as victim (not as attacker)
    const bobCheckin = await bob.checkin('still bob');
    assert.equal(bobCheckin.status, 200);
    assert.equal(bobCheckin.data.handle, 'bob');

    const impersonateAlice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...bobKeys });
    const impCheckin = await impersonateAlice.checkin('impersonating alice');
    assert.equal(impCheckin.status, 401);

    // Attacker's old key still works
    const aliceCheckin = await alice.checkin('still alice');
    assert.equal(aliceCheckin.status, 200);
    assert.equal(aliceCheckin.data.handle, 'alice');

    // No key_history rotate row for alice
    const rotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotHistory.length, 0);

    // Checkin bumped state_seq, so verify directly against before-rotate seq? No: check before checkin!
    // Re-verify with a fresh collision that state_seq does not bump on the 409 itself.
    const seqBeforeSecond = (await alice.state()).data.state_seq;
    const secondRot = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(secondRot.status, 409);
    const seqAfterSecond = (await alice.state()).data.state_seq;
    assert.equal(seqAfterSecond, seqBeforeSecond, 'failed rotate collision must not bump state_seq');
    assert.ok(seqBeforeSecond >= seqBefore);
  } finally {
    await ctx.close();
  }
});

test('rotate collision 409 does not consume the 3/hour rate-limit budget', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const collisionRes = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(collisionRes.status, 409);
    assert.equal(collisionRes.data.error, 'pubkey_taken');

    for (let i = 0; i < 3; i++) {
      const nextKeys = generateKeypair();
      const res = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(res.status, 200, `valid rotate #${i + 1} after 409 collision must succeed`);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }
  } finally {
    await ctx.close();
  }
});

test('join with a fresh key succeeds immediately after a pubkey_taken collision', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const badCarol = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...bobKeys });
    const badRes = await badCarol.join({ origin: 'musebook' });
    assert.equal(badRes.status, 409);
    assert.equal(badRes.data.error, 'pubkey_taken');

    const freshKeys = generateKeypair();
    const goodCarol = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...freshKeys });
    const goodRes = await goodCarol.join({ origin: 'musebook' });
    assert.equal(goodRes.status, 201);
    assert.equal(goodRes.data.handle, 'carol');
  } finally {
    await ctx.close();
  }
});

test('schema enforces UNIQUE(pubkey) at the SQLite level on a fresh DB', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: bobKeys } = await createResident(ctx, 'bob');
    const now = Math.floor(Date.now() / 1000);
    assert.throws(
      () => {
        ctx.db
          .prepare(
            "INSERT INTO residents (handle, pubkey, origin, status, bio, plot_updated_at, created_at) VALUES (?, ?, 'musebook', 'pending', '', NULL, ?)"
          )
          .run('carol', bobKeys.pubkey, now);
      },
      /UNIQUE constraint failed/i
    );
  } finally {
    await ctx.close();
  }
});

test('startup migration applies UNIQUE(pubkey) to a pre-seeded old-schema DB with distinct keys', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-key-mig-clean-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const aliceKeys = generateKeypair();
  const bobKeys = generateKeypair();
  createOldSchemaDb(dbPath, [
    { handle: 'alice', pubkey: aliceKeys.pubkey },
    { handle: 'bob', pubkey: bobKeys.pubkey },
  ]);

  const ctx = await startTestServer({ dbPath, tmpDir });
  try {
    const now = Math.floor(Date.now() / 1000);
    assert.throws(
      () => {
        ctx.db
          .prepare(
            "INSERT INTO residents (handle, pubkey, origin, status, bio, plot_updated_at, created_at) VALUES (?, ?, 'musebook', 'pending', '', NULL, ?)"
          )
          .run('carol', bobKeys.pubkey, now);
      },
      /UNIQUE constraint failed/i
    );
  } finally {
    await ctx.close();
  }
});

test('startup migration dupe-guard boots on existing duplicate pubkeys, preserves them, and rejects new 409 collisions', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-key-mig-dupe-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const sharedKeys = generateKeypair();
  const carolKeys = generateKeypair();
  createOldSchemaDb(dbPath, [
    { handle: 'alice', pubkey: sharedKeys.pubkey },
    { handle: 'bob', pubkey: sharedKeys.pubkey },
    { handle: 'carol', pubkey: carolKeys.pubkey },
  ]);

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let ctx;
  try {
    ctx = await startTestServer({ dbPath, tmpDir });
  } finally {
    console.warn = origWarn;
  }

  try {
    assert.ok(
      warnings.some((w) => w.includes('Duplicate pubkey')),
      'expected startup console warning when duplicate pubkeys exist'
    );

    // Existing duplicate pair is left intact
    const dupRows = ctx.db
      .prepare('SELECT handle FROM residents WHERE pubkey = ? ORDER BY handle')
      .all(sharedKeys.pubkey);
    assert.deepEqual(
      dupRows.map((r) => r.handle),
      ['alice', 'bob']
    );

    // Handler-level checks still reject new collisions with 409 pubkey_taken
    const daveClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'dave', ...sharedKeys });
    const joinRes = await daveClient.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 409);
    assert.equal(joinRes.data.error, 'pubkey_taken');

    const carolClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...carolKeys });
    const rotRes = await carolClient.rotateKey(sharedKeys.pubkey);
    assert.equal(rotRes.status, 409);
    assert.equal(rotRes.data.error, 'pubkey_taken');
  } finally {
    await ctx.close();
  }
});
