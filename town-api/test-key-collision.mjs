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
  } else {
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run(handle);
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
            "INSERT INTO residents (handle, pubkey, origin, status, bio, plot_updated_at, created_at) VALUES (?, ?, 'musebook', 'suspended', '', NULL, ?)"
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
            "INSERT INTO residents (handle, pubkey, origin, status, bio, plot_updated_at, created_at) VALUES (?, ?, 'musebook', 'suspended', '', NULL, ?)"
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

test('rotate to own current pubkey returns 400 same_pubkey and changes nothing', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    const rotRes = await alice.rotateKey(aliceKeys.pubkey);
    assert.equal(rotRes.status, 400);
    assert.equal(rotRes.data.error, 'same_pubkey');

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, aliceKeys.pubkey);

    const rotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotHistory.length, 0);

    const seqAfter = (await alice.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore);
  } finally {
    await ctx.close();
  }
});

test('rotate with malformed or missing pubkey returns 400 and changes nothing', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    const badRes = await alice.rotateKey('not-a-key');
    assert.equal(badRes.status, 400);
    assert.equal(badRes.data.error, 'invalid_pubkey');

    const missingRes = await alice.rotateKey('');
    assert.equal(missingRes.status, 400);
    assert.equal(missingRes.data.error, 'missing_pubkey');

    const rotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotHistory.length, 0);

    const seqAfter = (await alice.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore);
  } finally {
    await ctx.close();
  }
});

test('successful rotate retires old key and records exactly one rotate row', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: oldKeys } = await createResident(ctx, 'alice');
    const newKeys = generateKeypair();
    const seqBefore = (await alice.state()).data.state_seq;

    const rotRes = await alice.rotateKey(newKeys.pubkey);
    assert.equal(rotRes.status, 200);
    assert.equal(rotRes.data.rotated, true);

    const seqAfter = (await alice.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore + 1);

    const oldCheckin = await alice.checkin('with old key');
    assert.equal(oldCheckin.status, 401);

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const newCheckin = await newClient.checkin('with new key');
    assert.equal(newCheckin.status, 200);

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, newKeys.pubkey);

    const history = ctx.db
      .prepare('SELECT action, pubkey, note FROM key_history WHERE handle = ? ORDER BY id ASC')
      .all('alice');
    assert.equal(history.length, 2);
    assert.equal(history[0].action, 'register');
    assert.equal(history[0].pubkey, oldKeys.pubkey);
    assert.equal(history[0].note, 'joined');
    assert.equal(history[1].action, 'rotate');
    assert.equal(history[1].pubkey, newKeys.pubkey);
    assert.equal(history[1].note, 'self-service rotation');
  } finally {
    await ctx.close();
  }
});

test('join 409s consume the per-IP join budget (unlike rotate 409s)', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: bobKeys } = await createResident(ctx, 'bob', { approved: false });

    const carol = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...bobKeys });
    const carolRes = await carol.join({ origin: 'musebook' });
    assert.equal(carolRes.status, 409);
    assert.equal(carolRes.data.error, 'pubkey_taken');

    for (const handle of ['dave', 'erin', 'frank']) {
      await createResident(ctx, handle, { approved: false });
    }

    const graceKeys = generateKeypair();
    const grace = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'grace', ...graceKeys });
    const graceRes = await grace.join({ origin: 'musebook' });
    assert.equal(graceRes.status, 429);
    assert.equal(graceRes.data.error, 'rate_limited');
    assert.equal(typeof graceRes.data.retry_after, 'number');
  } finally {
    await ctx.close();
  }
});

test('suspended resident cannot rotate: 403 resident_not_active', async () => {
  const ctx = await startTestServer();
  try {
    const { client: susp, keys: suspKeys } = await createResident(ctx, 'susp', { approved: false });
    const freshKeys = generateKeypair();

    const rotRes = await susp.rotateKey(freshKeys.pubkey);
    assert.equal(rotRes.status, 403);
    assert.equal(rotRes.data.error, 'resident_not_active');
    assert.equal(rotRes.data.resident_status, 'suspended');

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('susp');
    assert.equal(row.pubkey, suspKeys.pubkey);

    const rotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('susp');
    assert.equal(rotHistory.length, 0);
  } finally {
    await ctx.close();
  }
});

test('join precedence: handle_taken beats pubkey_taken and invalid_origin beats pubkey_taken', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const sameHandleClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...bobKeys });
    const handleRes = await sameHandleClient.join({ origin: 'musebook' });
    assert.equal(handleRes.status, 409);
    assert.equal(handleRes.data.error, 'handle_taken');

    const badOriginClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...bobKeys });
    const originRes = await badOriginClient.join({ origin: 'nowhere' });
    assert.equal(originRes.status, 400);
    assert.equal(originRes.data.error, 'invalid_origin');

    const daveClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'dave', ...bobKeys });
    const joinRes = await daveClient.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 409);
    assert.deepEqual(joinRes.data, { error: 'pubkey_taken' });
  } finally {
    await ctx.close();
  }
});

test('join 409 writes no key_history row for the rejected handle', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const carolClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...bobKeys });
    const joinRes = await carolClient.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 409);
    assert.equal(joinRes.data.error, 'pubkey_taken');

    const carolCount = ctx.db.prepare('SELECT COUNT(*) AS c FROM key_history WHERE handle = ?').get('carol').c;
    assert.equal(carolCount, 0);

    const bobCount = ctx.db.prepare('SELECT COUNT(*) AS c FROM key_history WHERE handle = ?').get('bob').c;
    assert.equal(bobCount, 1);
  } finally {
    await ctx.close();
  }
});

test('rotate to a suspended resident key returns 409 and suspended owner keeps the key', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    const { client: bob, keys: bobKeys } = await createResident(ctx, 'bob', { approved: false });

    const rotRes = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(rotRes.status, 409);
    assert.deepEqual(rotRes.data, { error: 'pubkey_taken' });

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, aliceKeys.pubkey);

    const rotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotHistory.length, 0);

    const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'bob' });
    assert.equal(appRes.status, 200);

    const bobCheckin = await bob.checkin('still bob');
    assert.equal(bobCheckin.status, 200);
  } finally {
    await ctx.close();
  }
});

test('suspended resident cannot rotate: 403 resident_not_active', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    ctx.db.prepare('UPDATE residents SET status = ? WHERE handle = ?').run('suspended', 'alice');
    const fresh = generateKeypair();

    const rotRes = await alice.rotateKey(fresh.pubkey);
    assert.equal(rotRes.status, 403);
    assert.deepEqual(rotRes.data, { error: 'resident_not_active', resident_status: 'suspended' });

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, aliceKeys.pubkey);

    const rotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotHistory.length, 0);
  } finally {
    await ctx.close();
  }
});

test('muted resident can rotate: 200', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    ctx.db.prepare('UPDATE residents SET status = ? WHERE handle = ?').run('muted', 'alice');
    const fresh = generateKeypair();

    const rotRes = await alice.rotateKey(fresh.pubkey);
    assert.equal(rotRes.status, 200);
    assert.equal(rotRes.data.rotated, true);

    const oldCheckin = await alice.checkin('old key');
    assert.equal(oldCheckin.status, 401);

    const freshClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...fresh });
    const newCheckin = await freshClient.checkin('new key');
    assert.equal(newCheckin.status, 200);

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, fresh.pubkey);
  } finally {
    await ctx.close();
  }
});

test('join with a freed key succeeds after the owner rotates away', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: oldKeys } = await createResident(ctx, 'alice');
    const fresh = generateKeypair();

    const rotRes = await alice.rotateKey(fresh.pubkey);
    assert.equal(rotRes.status, 200);

    const carolClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...oldKeys });
    const joinRes = await carolClient.join({ origin: 'colony' });
    assert.equal(joinRes.status, 201);
    assert.equal(joinRes.data.handle, 'carol');

    const carolRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('carol');
    assert.equal(carolRow.pubkey, oldKeys.pubkey);

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, fresh.pubkey);
  } finally {
    await ctx.close();
  }
});

test('rotate rate limit: 3 successful rotates per hour, 4th returns 429 rate_limited with retry_after and key unchanged', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    let lastKeys;
    for (let i = 0; i < 3; i += 1) {
      const nextKeys = generateKeypair();
      const rotRes = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(rotRes.status, 200);
      assert.equal(rotRes.data.rotated, true);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
      lastKeys = nextKeys;
    }

    assert.equal((await alice.state()).data.state_seq, seqBefore + 3);

    const fourthKeys = generateKeypair();
    const fourthRes = await alice.rotateKey(fourthKeys.pubkey);
    assert.equal(fourthRes.status, 429);
    assert.equal(fourthRes.data.error, 'rate_limited');
    assert.equal(typeof fourthRes.data.retry_after, 'number');
    assert.ok(fourthRes.data.retry_after > 0);

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, lastKeys.pubkey);
    assert.equal((await alice.state()).data.state_seq, seqBefore + 3);

    const rotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotHistory.length, 3);
  } finally {
    await ctx.close();
  }
});

test('join with a suspended resident key returns 409 pubkey_taken', async () => {
  const ctx = await startTestServer();
  try {
    const { client: bob, keys: bobKeys } = await createResident(ctx, 'bob', { approved: false });

    const carol = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...bobKeys });
    const joinRes = await carol.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 409);
    assert.deepEqual(joinRes.data, { error: 'pubkey_taken' });

    const carolRow = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('carol');
    assert.equal(carolRow, undefined);

    const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'bob' });
    assert.equal(appRes.status, 200);

    const bobCheckin = await bob.checkin('still bob');
    assert.equal(bobCheckin.status, 200);
  } finally {
    await ctx.close();
  }
});

test('join with a muted or suspended resident key returns 409 pubkey_taken', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    ctx.db.prepare('UPDATE residents SET status = ? WHERE handle = ?').run('muted', 'bob');
    const carol = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...bobKeys });
    const carolRes = await carol.join({ origin: 'musebook' });
    assert.equal(carolRes.status, 409);
    assert.equal(carolRes.data.error, 'pubkey_taken');

    ctx.db.prepare('UPDATE residents SET status = ? WHERE handle = ?').run('suspended', 'bob');
    const dave = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'dave', ...bobKeys });
    const daveRes = await dave.join({ origin: 'musebook' });
    assert.equal(daveRes.status, 409);
    assert.equal(daveRes.data.error, 'pubkey_taken');

    const bobRow = ctx.db.prepare('SELECT pubkey, status FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow.pubkey, bobKeys.pubkey);
    assert.equal(bobRow.status, 'suspended');
  } finally {
    await ctx.close();
  }
});

test('rotate to a freed key succeeds after the previous owner rotated away', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceOldKeys } = await createResident(ctx, 'alice');
    const { client: bob, keys: bobOldKeys } = await createResident(ctx, 'bob');

    const aliceFresh = generateKeypair();
    const aliceRot = await alice.rotateKey(aliceFresh.pubkey);
    assert.equal(aliceRot.status, 200);

    const bobRot = await bob.rotateKey(aliceOldKeys.pubkey);
    assert.equal(bobRot.status, 200);
    assert.equal(bobRot.data.rotated, true);

    const oldBobCheckin = await bob.checkin('old bob key');
    assert.equal(oldBobCheckin.status, 401);

    const bobNewClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...aliceOldKeys });
    const newBobCheckin = await bobNewClient.checkin('freed key');
    assert.equal(newBobCheckin.status, 200);
    assert.equal(newBobCheckin.data.handle, 'bob');

    const bobRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow.pubkey, aliceOldKeys.pubkey);
    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, aliceFresh.pubkey);

    const bobHistory = ctx.db
      .prepare('SELECT action, pubkey FROM key_history WHERE handle = ? ORDER BY id ASC')
      .all('bob');
    assert.equal(bobHistory.length, 2);
    assert.equal(bobHistory[0].action, 'register');
    assert.equal(bobHistory[0].pubkey, bobOldKeys.pubkey);
    assert.equal(bobHistory[1].action, 'rotate');
    assert.equal(bobHistory[1].pubkey, aliceOldKeys.pubkey);
  } finally {
    await ctx.close();
  }
});

test('rotate for an unknown handle returns 401 unknown_resident and writes nothing', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    const ghostKeys = generateKeypair();
    const targetKeys = generateKeypair();
    const ghost = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'ghost', ...ghostKeys });
    const rotRes = await ghost.rotateKey(targetKeys.pubkey);
    assert.equal(rotRes.status, 401);
    assert.equal(rotRes.data.error, 'unknown_resident');

    const ghostRow = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('ghost');
    assert.equal(ghostRow, undefined);
    const ghostHistory = ctx.db.prepare('SELECT * FROM key_history WHERE handle = ?').all('ghost');
    assert.equal(ghostHistory.length, 0);

    const seqAfter = (await alice.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore);
  } finally {
    await ctx.close();
  }
});

test('400 rotate errors do not consume the 3/hour budget', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');

    const sameRes = await alice.rotateKey(aliceKeys.pubkey);
    assert.equal(sameRes.status, 400);
    assert.equal(sameRes.data.error, 'same_pubkey');

    const badRes = await alice.rotateKey('not-a-key');
    assert.equal(badRes.status, 400);
    assert.equal(badRes.data.error, 'invalid_pubkey');

    const emptyRes = await alice.rotateKey('');
    assert.equal(emptyRes.status, 400);
    assert.equal(emptyRes.data.error, 'missing_pubkey');

    for (let i = 0; i < 3; i += 1) {
      const nextKeys = generateKeypair();
      const rotRes = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(rotRes.status, 200);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }

    const rotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotHistory.length, 3);
  } finally {
    await ctx.close();
  }
});
