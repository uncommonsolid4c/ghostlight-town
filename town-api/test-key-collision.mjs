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

test('suspended-at-join resident cannot rotate: 403 resident_not_active', async () => {
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

test('suspended resident cannot rotate after DB status flip: 403 resident_not_active', async () => {
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

async function rawJoin(baseUrl, { headerHandle, handle, pubkey, origin = 'musebook', bio = '', privateKeyPem }) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: '/api/town/join',
    body: { handle, pubkey, origin, bio },
    handle: headerHandle ?? handle,
    privateKeyPem,
  });
  const res = await fetch(`${baseUrl}/api/town/join`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('join precedence: invalid_handle beats invalid_origin, invalid_origin beats handle_taken, bio_too_long beats handle_taken', async () => {
  const ctx = await startTestServer();
  try {
    await createResident(ctx, 'bob');

    const badHandleKeys = generateKeypair();
    const badHandleClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'BAD HANDLE', ...badHandleKeys });
    const badHandleRes = await badHandleClient.join({ origin: 'nowhere' });
    assert.equal(badHandleRes.status, 400);
    assert.equal(badHandleRes.data.error, 'invalid_handle');

    const badOriginKeys = generateKeypair();
    const badOriginClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...badOriginKeys });
    const badOriginRes = await badOriginClient.join({ origin: 'nowhere' });
    assert.equal(badOriginRes.status, 400);
    assert.equal(badOriginRes.data.error, 'invalid_origin');

    const longBioKeys = generateKeypair();
    const longBioClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...longBioKeys });
    const longBioRes = await longBioClient.join({ origin: 'musebook', bio: 'x'.repeat(501) });
    assert.equal(longBioRes.status, 400);
    assert.equal(longBioRes.data.error, 'bio_too_long');
  } finally {
    await ctx.close();
  }
});

test('join 400s consume the per-IP join budget: five invalid joins then a valid join is 429', async () => {
  const ctx = await startTestServer();
  try {
    for (let i = 0; i < 5; i += 1) {
      const keys = generateKeypair();
      const res = await rawJoin(ctx.baseUrl, {
        handle: 'BAD',
        pubkey: keys.pubkey,
        origin: 'musebook',
        privateKeyPem: keys.privateKeyPem,
      });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'invalid_handle');
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

test('join with a malformed body pubkey returns 401 invalid_pubkey and creates nothing', async () => {
  const ctx = await startTestServer();
  try {
    const carolKeys = generateKeypair();
    const probe = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...carolKeys });
    const seqBefore = (await probe.state()).data.state_seq;
    assert.equal(seqBefore, 0);

    const res = await rawJoin(ctx.baseUrl, {
      handle: 'carol',
      pubkey: 'not-a-key',
      origin: 'musebook',
      privateKeyPem: carolKeys.privateKeyPem,
    });
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'invalid_pubkey');

    const row = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('carol');
    assert.equal(row, undefined);
    const history = ctx.db.prepare('SELECT * FROM key_history WHERE handle = ?').all('carol');
    assert.equal(history.length, 0);

    const seqAfter = (await probe.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore);
  } finally {
    await ctx.close();
  }
});

test('join with body handle different from the signed handle returns 401 handle_mismatch and creates nothing', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const res = await rawJoin(ctx.baseUrl, {
      headerHandle: 'alice',
      handle: 'bob',
      pubkey: keys.pubkey,
      origin: 'musebook',
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'handle_mismatch');

    const bobRow = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow, undefined);
    const aliceRow = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow, undefined);
  } finally {
    await ctx.close();
  }
});

test('pending resident key still collides: join 409 and rotate 409', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');
    ctx.db.prepare('UPDATE residents SET status = ? WHERE handle = ?').run('pending', 'bob');

    const carol = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...bobKeys });
    const carolRes = await carol.join({ origin: 'musebook' });
    assert.equal(carolRes.status, 409);
    assert.equal(carolRes.data.error, 'pubkey_taken');

    const aliceRot = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(aliceRot.status, 409);
    assert.equal(aliceRot.data.error, 'pubkey_taken');

    const bobRow = ctx.db.prepare('SELECT status FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow.status, 'pending');
  } finally {
    await ctx.close();
  }
});

test('pending resident cannot rotate: 403 resident_not_active with resident_status pending', async () => {
  const ctx = await startTestServer();
  try {
    const { client: bob, keys: bobKeys } = await createResident(ctx, 'bob');
    ctx.db.prepare('UPDATE residents SET status = ? WHERE handle = ?').run('pending', 'bob');

    const fresh = generateKeypair();
    const rotRes = await bob.rotateKey(fresh.pubkey);
    assert.equal(rotRes.status, 403);
    assert.deepEqual(rotRes.data, { error: 'resident_not_active', resident_status: 'pending' });

    const bobRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow.pubkey, bobKeys.pubkey);
    const rotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('bob');
    assert.equal(rotHistory.length, 0);
  } finally {
    await ctx.close();
  }
});

test('rotate signed with the wrong private key returns 401 invalid_signature and changes nothing', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');
    const seqBefore = (await alice.state()).data.state_seq;

    const fresh = generateKeypair();
    const impostor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...bobKeys });
    const rotRes = await impostor.rotateKey(fresh.pubkey);
    assert.equal(rotRes.status, 401);
    assert.equal(rotRes.data.error, 'invalid_signature');

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, aliceKeys.pubkey);
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

test('rotate to the operator pubkey succeeds: the collision check is residents-table-only', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const rotRes = await alice.rotateKey(ctx.operatorKeys.pubkey);
    assert.equal(rotRes.status, 200);
    assert.equal(rotRes.data.rotated, true);

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, ctx.operatorKeys.pubkey);

    const oldCheckin = await alice.checkin({ status_text: 'old key' });
    assert.equal(oldCheckin.status, 401);

    const rotHistory = ctx.db
      .prepare("SELECT action, pubkey FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotHistory.length, 1);
    assert.equal(rotHistory[0].pubkey, ctx.operatorKeys.pubkey);
  } finally {
    await ctx.close();
  }
});

test('three sequential rotates retire each old key and record register plus three rotate rows in order', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice, keys: origKeys } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    const retiredKeys = [origKeys];
    const rotatedPubkeys = [];
    for (let i = 0; i < 3; i += 1) {
      const nextKeys = generateKeypair();
      const rotRes = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(rotRes.status, 200);
      assert.equal(rotRes.data.rotated, true);
      rotatedPubkeys.push(nextKeys.pubkey);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
      if (i < 2) {
        retiredKeys.push(nextKeys);
      }
    }

    const seqAfter = (await alice.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore + 3);

    for (const oldKeys of retiredKeys) {
      const staleClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...oldKeys });
      const staleRes = await staleClient.checkin({ status_text: 'stale' });
      assert.equal(staleRes.status, 401);
    }

    const liveRes = await alice.checkin({ status_text: 'current' });
    assert.equal(liveRes.status, 200);

    const history = ctx.db
      .prepare('SELECT action, pubkey FROM key_history WHERE handle = ? ORDER BY id ASC')
      .all('alice');
    assert.equal(history.length, 4);
    assert.equal(history[0].action, 'register');
    assert.equal(history[0].pubkey, origKeys.pubkey);
    for (let i = 0; i < 3; i += 1) {
      assert.equal(history[i + 1].action, 'rotate');
      assert.equal(history[i + 1].pubkey, rotatedPubkeys[i]);
    }
  } finally {
    await ctx.close();
  }
});

test('rotate back to a freed key taken by another resident returns 409 pubkey_taken', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice, keys: aliceOldKeys } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    const aliceFresh = generateKeypair();
    const aliceRot = await alice.rotateKey(aliceFresh.pubkey);
    assert.equal(aliceRot.status, 200);
    alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...aliceFresh });

    const bobRot = await bob.rotateKey(aliceOldKeys.pubkey);
    assert.equal(bobRot.status, 200);
    assert.equal(bobRot.data.rotated, true);

    const backRot = await alice.rotateKey(aliceOldKeys.pubkey);
    assert.equal(backRot.status, 409);
    assert.equal(backRot.data.error, 'pubkey_taken');

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, aliceFresh.pubkey);
    const bobRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow.pubkey, aliceOldKeys.pubkey);

    const aliceRotHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(aliceRotHistory.length, 1);
  } finally {
    await ctx.close();
  }
});

test('all 64 top-level test names in this file are unique and include both renamed suspended-rotate tests', () => {
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 64);
  assert.equal(new Set(names).size, 64);
  assert.ok(names.includes('suspended-at-join resident cannot rotate: 403 resident_not_active'));
  assert.ok(names.includes('suspended resident cannot rotate after DB status flip: 403 resident_not_active'));
});

test('rotate 200 returns exact body keys and records exact key_history rotate row', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;
    const newKeys = generateKeypair();

    const tBefore = ctx.nowSec();
    const rotRes = await alice.rotateKey(newKeys.pubkey);
    const tAfter = ctx.nowSec();

    assert.equal(rotRes.status, 200);
    assert.deepEqual(rotRes.data, { handle: 'alice', rotated: true, state_seq: seqBefore + 1 });
    assert.deepEqual(Object.keys(rotRes.data), ['handle', 'rotated', 'state_seq']);

    const rows = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.deepEqual(Object.keys(row), ['id', 'handle', 'pubkey', 'action', 'created_at', 'note']);
    assert.equal(row.handle, 'alice');
    assert.equal(row.pubkey, newKeys.pubkey);
    assert.equal(row.action, 'rotate');
    assert.equal(row.note, 'self-service rotation');
    assert.ok(row.created_at >= tBefore && row.created_at <= tAfter);
  } finally {
    await ctx.close();
  }
});

test('rotate 429 returns exact keys with retry_after in {3599, 3600} and non-increasing on 5th attempt', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    let lastKeys;
    for (let i = 0; i < 3; i += 1) {
      const nextKeys = generateKeypair();
      const rotRes = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(rotRes.status, 200);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
      lastKeys = nextKeys;
    }

    assert.equal((await alice.state()).data.state_seq, seqBefore + 3);

    const fourthRes = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(fourthRes.status, 429);
    assert.deepEqual(Object.keys(fourthRes.data), ['error', 'retry_after']);
    assert.equal(fourthRes.data.error, 'rate_limited');
    assert.ok(
      fourthRes.data.retry_after === 3599 || fourthRes.data.retry_after === 3600,
      `expected retry_after 3599 or 3600, got ${fourthRes.data.retry_after}`
    );

    const fifthRes = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(fifthRes.status, 429);
    assert.deepEqual(Object.keys(fifthRes.data), ['error', 'retry_after']);
    assert.equal(fifthRes.data.error, 'rate_limited');
    assert.ok(fifthRes.data.retry_after <= fourthRes.data.retry_after);

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, lastKeys.pubkey);
    assert.equal((await alice.state()).data.state_seq, seqBefore + 3);
  } finally {
    await ctx.close();
  }
});

test('rotate validation and collision checks beat the rate limit even when 3/hour budget is exhausted', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    for (let i = 0; i < 3; i += 1) {
      const nextKeys = generateKeypair();
      const rotRes = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(rotRes.status, 200);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }

    const missingRes = await alice.rotateKey('');
    assert.equal(missingRes.status, 400);
    assert.deepEqual(missingRes.data, { error: 'missing_pubkey' });
    assert.deepEqual(Object.keys(missingRes.data), ['error']);

    const invalidRes = await alice.rotateKey('not-a-key');
    assert.equal(invalidRes.status, 400);
    assert.deepEqual(invalidRes.data, { error: 'invalid_pubkey' });

    const currentRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    const sameRes = await alice.rotateKey(currentRow.pubkey);
    assert.equal(sameRes.status, 400);
    assert.deepEqual(sameRes.data, { error: 'same_pubkey' });

    const takenRes = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(takenRes.status, 409);
    assert.deepEqual(takenRes.data, { error: 'pubkey_taken' });
    assert.deepEqual(Object.keys(takenRes.data), ['error']);

    const limitedRes = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(limitedRes.status, 429);
    assert.equal(limitedRes.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('join 409 returns exact single-key body and leaves state_seq and key_history untouched', async () => {
  const ctx = await startTestServer();
  try {
    const { client: bob, keys: bobKeys } = await createResident(ctx, 'bob');
    const seqBefore = (await bob.state()).data.state_seq;

    const carol = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...bobKeys });
    const carolRes = await carol.join({ origin: 'musebook' });
    assert.equal(carolRes.status, 409);
    assert.deepEqual(carolRes.data, { error: 'pubkey_taken' });
    assert.deepEqual(Object.keys(carolRes.data), ['error']);

    assert.equal((await bob.state()).data.state_seq, seqBefore);

    const carolHistory = ctx.db.prepare('SELECT * FROM key_history WHERE handle = ?').all('carol');
    assert.equal(carolHistory.length, 0);

    const bobHistory = ctx.db.prepare('SELECT * FROM key_history WHERE handle = ?').all('bob');
    assert.equal(bobHistory.length, 1);
    assert.equal(bobHistory[0].action, 'register');
    assert.equal(bobHistory[0].note, 'joined');
  } finally {
    await ctx.close();
  }
});

test('join writes exact register key_history row with wall-clock created_at', async () => {
  const ctx = await startTestServer();
  try {
    const aliceKeys = generateKeypair();
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...aliceKeys });

    const tBefore = ctx.nowSec();
    const joinRes = await alice.join({ origin: 'musebook' });
    const tAfter = ctx.nowSec();
    assert.equal(joinRes.status, 201);

    const rows = ctx.db.prepare('SELECT * FROM key_history WHERE handle = ?').all('alice');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'register');
    assert.equal(rows[0].note, 'joined');
    assert.equal(rows[0].pubkey, aliceKeys.pubkey);
    assert.ok(rows[0].created_at >= tBefore && rows[0].created_at <= tAfter);
  } finally {
    await ctx.close();
  }
});

test('join precedence remaining combos: invalid_handle > pubkey_taken, invalid_origin > bio_too_long, bio_too_long > handle_taken and pubkey_taken', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: aliceKeys } = await createResident(ctx, 'alice');

    const probeA = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'BAD!', ...aliceKeys });
    const resA = await probeA.join({ origin: 'musebook' });
    assert.equal(resA.status, 400);
    assert.equal(resA.data.error, 'invalid_handle');

    const probeB = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...generateKeypair() });
    const resB = await probeB.join({ origin: 'bogus', bio: 'x'.repeat(501) });
    assert.equal(resB.status, 400);
    assert.equal(resB.data.error, 'invalid_origin');

    const probeC = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...generateKeypair() });
    const resC = await probeC.join({ origin: 'musebook', bio: 'y'.repeat(501) });
    assert.equal(resC.status, 400);
    assert.deepEqual(resC.data, { error: 'bio_too_long', max: 500 });

    const probeD = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'dave', ...aliceKeys });
    const resD = await probeD.join({ origin: 'musebook', bio: 'z'.repeat(501) });
    assert.equal(resD.status, 400);
    assert.equal(resD.data.error, 'bio_too_long');
  } finally {
    await ctx.close();
  }
});

test('dupe-DB rotate-away frees alice without disturbing bob or creating UNIQUE(pubkey)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-key-dupe-rotate-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const sharedKeys = generateKeypair();
  createOldSchemaDb(dbPath, [
    { handle: 'alice', pubkey: sharedKeys.pubkey },
    { handle: 'bob', pubkey: sharedKeys.pubkey },
  ]);

  const ctx = await startTestServer({ dbPath, tmpDir });
  try {
    const aliceOld = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...sharedKeys });
    const freshKeys = generateKeypair();
    const rotRes = await aliceOld.rotateKey(freshKeys.pubkey);
    assert.equal(rotRes.status, 200);
    assert.equal(rotRes.data.rotated, true);

    const bobRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow.pubkey, sharedKeys.pubkey);
    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, freshKeys.pubkey);

    const dave = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'dave', ...sharedKeys });
    const daveRes = await dave.join({ origin: 'musebook' });
    assert.equal(daveRes.status, 409);
    assert.equal(daveRes.data.error, 'pubkey_taken');

    const aliceOldCheckin = await aliceOld.checkin('old key');
    assert.equal(aliceOldCheckin.status, 401);

    const bobClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...sharedKeys });
    const bobCheckin = await bobClient.checkin('still bob');
    assert.equal(bobCheckin.status, 200);

    const indexes = ctx.db.prepare('PRAGMA index_list(residents)').all();
    const hasPubkeyUnique = indexes.some((idx) => {
      if (!idx.unique) return false;
      const cols = ctx.db.prepare(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`).all();
      return cols.length === 1 && cols[0].name === 'pubkey';
    });
    assert.equal(hasPubkeyUnique, false);
  } finally {
    await ctx.close();
  }
});

test('rotate preserves resident row columns, plot manifest/html, and plot_updated_at', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const manifest = {
      cottage: 'gable',
      wall: '#d8c8a8',
      roof: '#5a3d2b',
      trim: '#2f4f4f',
      signpost_text: 'Scratch desk',
      props: [{ kind: 'desk', x: 0, y: 0, z: -2, rot_y: 180, color: '#6b4c35' }],
    };
    const html = '<p>hello</p>';

    const putRes = await alice.plot(manifest, html);
    assert.equal(putRes.status, 200);

    const rowBefore = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('alice');
    const plotBefore = await alice.getPlot('alice');
    assert.equal(plotBefore.status, 200);
    const seqBefore = (await alice.state()).data.state_seq;

    const freshKeys = generateKeypair();
    const rotRes = await alice.rotateKey(freshKeys.pubkey);
    assert.equal(rotRes.status, 200);

    const rowAfter = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('alice');
    assert.equal(rowAfter.pubkey, freshKeys.pubkey);
    const { pubkey: _pkBefore, ...restBefore } = rowBefore;
    const { pubkey: _pkAfter, ...restAfter } = rowAfter;
    assert.deepEqual(restAfter, restBefore);

    const plotAfter = await alice.getPlot('alice');
    assert.equal(plotAfter.status, 200);
    assert.deepEqual(plotAfter.data.manifest, plotBefore.data.manifest);
    assert.equal(plotAfter.data.html, plotBefore.data.html);

    const stateAfter = (await alice.state()).data;
    assert.equal(stateAfter.plots.alice, rowBefore.plot_updated_at);
    assert.equal(stateAfter.state_seq, seqBefore + 1);

    const oldCheckin = await alice.checkin('old key');
    assert.equal(oldCheckin.status, 401);

    const newAlice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...freshKeys });
    const newCheckin = await newAlice.checkin('new key');
    assert.equal(newCheckin.status, 200);
  } finally {
    await ctx.close();
  }
});

test('self hygiene of town-api/test-key-collision.mjs', () => {
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  assert.equal(src.includes('Math' + '.' + 'random'), false);
  assert.equal(src.includes('TO' + 'DO'), false);
  assert.equal(src.includes('FIX' + 'ME'), false);
  assert.equal(src.toLowerCase().includes('camp' + 'fire'), false);

  const dateNowNeedle = 'Date' + '.now';
  const dateNowCount = src.split(dateNowNeedle).length - 1;
  assert.equal(dateNowCount, 4);
  const floorDateNowNeedle = 'Math.floor(' + dateNowNeedle + '() / 1000)';
  assert.equal(src.split(floorDateNowNeedle).length - 1, 4);

  const fetchNeedle = 'fet' + 'ch(';
  assert.equal(src.split(fetchNeedle).length - 1, 2);

  const importLines = src.match(/^import .*$/gm) || [];
  assert.equal(importLines.length, 8);
  assert.deepEqual(importLines, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { DatabaseSync } from 'node:sqlite';",
    "import { createTownServer } from './server.mjs';",
    "import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';",
  ]);
});
test('rotate missing_pubkey shapes return 400 and change nothing', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    for (const [label, value] of [
      ['undefined', undefined],
      ['empty string', ''],
      ['null', null],
      ['number 42', 42],
    ]) {
      const res = await alice.rotateKey(value);
      assert.equal(res.status, 400, `rotate ${label} should be 400`);
      assert.deepEqual(res.data, { error: 'missing_pubkey' });
    }

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, aliceKeys.pubkey);
    assert.equal((await alice.state()).data.state_seq, seqBefore);
    const rotateRows = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotateRows.length, 0);
  } finally {
    await ctx.close();
  }
});

test('rotate invalid_pubkey shapes return 400 and a 43-char all-A key rotates 200', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    // 'not-a-key' decodes to 6 bytes, 'AAAA' to 3, 44 As to 33, a space to 0:
    // none is 32 bytes, so rawPubkeyToKeyObject rejects all four.
    for (const [label, value] of [
      ['not-a-key', 'not-a-key'],
      ['AAAA', 'AAAA'],
      ['44 As', 'A'.repeat(44)],
      ['single space', ' '],
    ]) {
      const res = await alice.rotateKey(value);
      assert.equal(res.status, 400, `rotate ${label} should be 400`);
      assert.deepEqual(res.data, { error: 'invalid_pubkey' });
    }
    assert.equal((await alice.state()).data.state_seq, seqBefore);

    // 43 As decode to exactly 32 zero bytes, so the key is structurally valid
    // and the rotate succeeds, even though no private key for it is held here.
    const zeroKey = 'A'.repeat(43);
    const okRes = await alice.rotateKey(zeroKey);
    assert.equal(okRes.status, 200);
    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, zeroKey);
    const rotateRow = ctx.db
      .prepare("SELECT pubkey FROM key_history WHERE handle = ? AND action = 'rotate'")
      .get('alice');
    assert.equal(rotateRow.pubkey, zeroKey);
  } finally {
    await ctx.close();
  }
});

test('join with the operator pubkey succeeds because the operator key is not a resident', async () => {
  const ctx = await startTestServer();
  try {
    const probe = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'probe', ...generateKeypair() });
    const seqBefore = (await probe.state()).data.state_seq;

    const mallory = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'mallory', ...ctx.operatorKeys });
    const joinRes = await mallory.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    assert.deepEqual(joinRes.data, {
      handle: 'mallory',
      status: 'active',
      origin: 'musebook',
      state_seq: seqBefore + 1,
    });

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('mallory');
    assert.equal(row.pubkey, ctx.operatorKeys.pubkey);

    const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'mallory' });
    assert.equal(appRes.status, 200);

    const freshKeys = generateKeypair();
    const rotRes = await mallory.rotateKey(freshKeys.pubkey);
    assert.equal(rotRes.status, 200);
  } finally {
    await ctx.close();
  }
});

test('rotate away then back to the original key succeeds and history keeps A B A', async () => {
  const ctx = await startTestServer();
  try {
    const { client: aliceOld, keys: keysA } = await createResident(ctx, 'alice');
    const keysB = generateKeypair();

    const r1 = await aliceOld.rotateKey(keysB.pubkey);
    assert.equal(r1.status, 200);

    let alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keysB });
    const r2 = await alice.rotateKey(keysA.pubkey);
    assert.equal(r2.status, 200);

    alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keysA });
    const rows = ctx.db
      .prepare('SELECT action, pubkey FROM key_history WHERE handle = ? ORDER BY id ASC')
      .all('alice');
    assert.deepEqual(rows.map((r) => r.action), ['register', 'rotate', 'rotate']);
    assert.equal(rows[0].pubkey, keysA.pubkey);
    assert.equal(rows[1].pubkey, keysB.pubkey);
    assert.equal(rows[2].pubkey, keysA.pubkey);

    const deadClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keysB });
    const deadSay = await deadClient.say('from the retired key');
    assert.equal(deadSay.status, 401);
    const liveSay = await alice.say('back on my original key');
    assert.equal(liveSay.status, 201);
  } finally {
    await ctx.close();
  }
});

test('rotate 400s do not consume the 3 per hour budget', async () => {
  const ctx = await startTestServer();
  try {
    const { client: aliceOld, keys: keysA } = await createResident(ctx, 'alice');
    let alice = aliceOld;

    const badMissing = await alice.rotateKey(undefined);
    assert.equal(badMissing.status, 400);
    assert.equal(badMissing.data.error, 'missing_pubkey');
    const badInvalid = await alice.rotateKey('AAAA');
    assert.equal(badInvalid.status, 400);
    assert.equal(badInvalid.data.error, 'invalid_pubkey');
    const badSame = await alice.rotateKey(keysA.pubkey);
    assert.equal(badSame.status, 400);
    assert.equal(badSame.data.error, 'same_pubkey');

    let currentKeys = keysA;
    for (let i = 1; i <= 3; i += 1) {
      const nextKeys = generateKeypair();
      const res = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(res.status, 200, `good rotate ${i} should be 200`);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
      currentKeys = nextKeys;
    }

    const fourth = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(fourth.status, 429);
    assert.equal(fourth.data.error, 'rate_limited');
    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, currentKeys.pubkey);
  } finally {
    await ctx.close();
  }
});

test('rotate preserves a live checkin: footlight slot and presence survive, old key dies', async () => {
  const ctx = await startTestServer();
  try {
    const { client: aliceOld } = await createResident(ctx, 'alice');
    const checkinRes = await aliceOld.checkin({ status_text: 'at the bandstand' });
    assert.equal(checkinRes.status, 200);
    assert.equal(checkinRes.data.slot, 0);

    const keysB = generateKeypair();
    const rotRes = await aliceOld.rotateKey(keysB.pubkey);
    assert.equal(rotRes.status, 200);

    const state = (await aliceOld.state()).data;
    const footlight = state.footlights.find((f) => f.handle === 'alice');
    assert.equal(footlight.slot, 0);
    assert.equal(footlight.status_text, 'at the bandstand');
    assert.equal(footlight.role, 'muse');
    const presence = state.presence.find((p) => p.handle === 'alice');
    assert.equal(presence.zone, 'bandstand');
    assert.equal(presence.role, 'muse');

    const oldCheckin = await aliceOld.checkin({ status_text: 'old key' });
    assert.equal(oldCheckin.status, 401);
    const aliceNew = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keysB });
    const newCheckin = await aliceNew.checkin({ status_text: 'new key' });
    assert.equal(newCheckin.status, 429);
    assert.equal(newCheckin.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('operator-signed rotate for a resident handle returns 401 invalid_signature', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: keysA } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    const impostor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...ctx.operatorKeys });
    const res = await impostor.rotateKey(generateKeypair().pubkey);
    assert.equal(res.status, 401);
    assert.deepEqual(res.data, { error: 'invalid_signature' });

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, keysA.pubkey);
    assert.equal((await alice.state()).data.state_seq, seqBefore);
    const rotateRows = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(rotateRows.length, 0);
  } finally {
    await ctx.close();
  }
});

test('key collision ignores origin: colony key 409s, then its freed key rotates 200', async () => {
  const ctx = await startTestServer();
  try {
    const bobKeys = generateKeypair();
    const bobOld = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...bobKeys });
    const bobJoin = await bobOld.join({ origin: 'colony' });
    assert.equal(bobJoin.status, 201);
    const bobApprove = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'bob' });
    assert.equal(bobApprove.status, 200);

    const { client: alice } = await createResident(ctx, 'alice');
    const collision = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(collision.status, 409);
    assert.deepEqual(collision.data, { error: 'pubkey_taken' });

    const freshBobKeys = generateKeypair();
    const bobRotate = await bobOld.rotateKey(freshBobKeys.pubkey);
    assert.equal(bobRotate.status, 200);

    const freed = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(freed.status, 200);
  } finally {
    await ctx.close();
  }
});

test('join 201 returns exact body keys in order', async () => {
  const ctx = await startTestServer();
  try {
    const probe = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'probe', ...generateKeypair() });
    const seqBefore = (await probe.state()).data.state_seq;

    const keys = generateKeypair();
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keys });
    const joinRes = await alice.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    assert.deepEqual(joinRes.data, {
      handle: 'alice',
      status: 'active',
      origin: 'musebook',
      state_seq: seqBefore + 1,
    });
    assert.deepEqual(Object.keys(joinRes.data), ['handle', 'status', 'origin', 'state_seq']);
  } finally {
    await ctx.close();
  }
});

test('rotate budgets are per handle: alice 429s while bob still rotates 200', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    let { client: bob } = await createResident(ctx, 'bob');
    let aliceKeys;
    let bobKeys;

    for (let i = 1; i <= 2; i += 1) {
      const nextAliceKeys = generateKeypair();
      const aliceRes = await alice.rotateKey(nextAliceKeys.pubkey);
      assert.equal(aliceRes.status, 200, `alice rotate ${i} should be 200`);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextAliceKeys });
      aliceKeys = nextAliceKeys;

      const nextBobKeys = generateKeypair();
      const bobRes = await bob.rotateKey(nextBobKeys.pubkey);
      assert.equal(bobRes.status, 200, `bob rotate ${i} should be 200`);
      bob = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...nextBobKeys });
      bobKeys = nextBobKeys;
    }

    const thirdAliceKeys = generateKeypair();
    const aliceThird = await alice.rotateKey(thirdAliceKeys.pubkey);
    assert.equal(aliceThird.status, 200);
    alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...thirdAliceKeys });
    aliceKeys = thirdAliceKeys;

    const aliceFourth = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(aliceFourth.status, 429);
    assert.equal(aliceFourth.data.error, 'rate_limited');

    const thirdBobKeys = generateKeypair();
    const bobThird = await bob.rotateKey(thirdBobKeys.pubkey);
    assert.equal(bobThird.status, 200);
    bob = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...thirdBobKeys });
    bobKeys = thirdBobKeys;

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    const bobRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('bob');
    assert.equal(aliceRow.pubkey, aliceKeys.pubkey);
    assert.equal(bobRow.pubkey, bobKeys.pubkey);
  } finally {
    await ctx.close();
  }
});

test('handle length boundaries: 1-char 400, 2- and 32-char 201, 33-char 400', async () => {
  const ctx = await startTestServer();
  try {
    const oneKeys = generateKeypair();
    const oneClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'a', ...oneKeys });
    const oneRes = await oneClient.join({ origin: 'musebook' });
    assert.equal(oneRes.status, 400);
    assert.deepEqual(oneRes.data, { error: 'invalid_handle' });
    assert.deepEqual(Object.keys(oneRes.data), ['error']);

    const twoKeys = generateKeypair();
    const twoClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'ab', ...twoKeys });
    const twoRes = await twoClient.join({ origin: 'musebook' });
    assert.equal(twoRes.status, 201);
    assert.deepEqual(Object.keys(twoRes.data), ['handle', 'status', 'origin', 'state_seq']);

    const h32 = 'h'.repeat(32);
    const maxKeys = generateKeypair();
    const maxClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: h32, ...maxKeys });
    const maxRes = await maxClient.join({ origin: 'musebook' });
    assert.equal(maxRes.status, 201);
    assert.equal(maxRes.data.handle, h32);

    const h33 = 'h'.repeat(33);
    const overKeys = generateKeypair();
    const overClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: h33, ...overKeys });
    const overRes = await overClient.join({ origin: 'musebook' });
    assert.equal(overRes.status, 400);
    assert.equal(overRes.data.error, 'invalid_handle');
  } finally {
    await ctx.close();
  }
});

test('bio boundary: 500 chars joins 201 and stores, 501 is 400 bio_too_long', async () => {
  const ctx = await startTestServer();
  try {
    const aliceKeys = generateKeypair();
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...aliceKeys });
    const okRes = await alice.join({ origin: 'musebook', bio: 'x'.repeat(500) });
    assert.equal(okRes.status, 201);
    assert.deepEqual(Object.keys(okRes.data), ['handle', 'status', 'origin', 'state_seq']);

    const row = ctx.db.prepare('SELECT bio FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.bio, 'x'.repeat(500));

    const bobKeys = generateKeypair();
    const bob = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...bobKeys });
    const longRes = await bob.join({ origin: 'musebook', bio: 'y'.repeat(501) });
    assert.equal(longRes.status, 400);
    assert.deepEqual(longRes.data, { error: 'bio_too_long', max: 500 });
    assert.deepEqual(Object.keys(longRes.data), ['error', 'max']);

    const bobRow = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow, undefined);
  } finally {
    await ctx.close();
  }
});

test('join 429 exact keys with retry_after in {3599, 3600} and non-increasing on next attempt', async () => {
  const ctx = await startTestServer();
  try {
    for (let i = 0; i < 5; i += 1) {
      const keys = generateKeypair();
      const res = await rawJoin(ctx.baseUrl, {
        handle: 'BAD',
        pubkey: keys.pubkey,
        origin: 'musebook',
        privateKeyPem: keys.privateKeyPem,
      });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'invalid_handle');
    }

    const graceKeys = generateKeypair();
    const grace = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'grace', ...graceKeys });
    const firstRes = await grace.join({ origin: 'musebook' });
    assert.equal(firstRes.status, 429);
    assert.deepEqual(Object.keys(firstRes.data), ['error', 'retry_after']);
    assert.equal(firstRes.data.error, 'rate_limited');
    assert.ok(
      firstRes.data.retry_after === 3599 || firstRes.data.retry_after === 3600,
      `expected retry_after 3599 or 3600, got ${firstRes.data.retry_after}`
    );

    const heidiKeys = generateKeypair();
    const heidi = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'heidi', ...heidiKeys });
    const secondRes = await heidi.join({ origin: 'musebook' });
    assert.equal(secondRes.status, 429);
    assert.deepEqual(Object.keys(secondRes.data), ['error', 'retry_after']);
    assert.equal(secondRes.data.error, 'rate_limited');
    assert.ok(secondRes.data.retry_after <= firstRes.data.retry_after);
  } finally {
    await ctx.close();
  }
});

test('rotate 401 unknown_resident returns exact single-key body and writes nothing', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;

    const ghostKeys = generateKeypair();
    const targetKeys = generateKeypair();
    const ghost = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'ghost', ...ghostKeys });
    const rotRes = await ghost.rotateKey(targetKeys.pubkey);
    assert.equal(rotRes.status, 401);
    assert.deepEqual(rotRes.data, { error: 'unknown_resident' });
    assert.deepEqual(Object.keys(rotRes.data), ['error']);

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

test('join 401 invalid_pubkey returns exact single-key body and writes nothing', async () => {
  const ctx = await startTestServer();
  try {
    const carolKeys = generateKeypair();
    const probe = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'carol', ...carolKeys });
    const seqBefore = (await probe.state()).data.state_seq;

    const res = await rawJoin(ctx.baseUrl, {
      handle: 'carol',
      pubkey: 'not-a-key',
      origin: 'musebook',
      privateKeyPem: carolKeys.privateKeyPem,
    });
    assert.equal(res.status, 401);
    assert.deepEqual(res.data, { error: 'invalid_pubkey' });
    assert.deepEqual(Object.keys(res.data), ['error']);

    const row = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('carol');
    assert.equal(row, undefined);
    const history = ctx.db.prepare('SELECT * FROM key_history WHERE handle = ?').all('carol');
    assert.equal(history.length, 0);

    const seqAfter = (await probe.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore);
  } finally {
    await ctx.close();
  }
});

test('handle_taken returns exact single-key body for fresh and same key and leaves seq and history untouched', async () => {
  const ctx = await startTestServer();
  try {
    const { client: bob, keys: bobKeys } = await createResident(ctx, 'bob');
    const seqBefore = (await bob.state()).data.state_seq;

    const freshClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...generateKeypair() });
    const freshRes = await freshClient.join({ origin: 'musebook' });
    assert.equal(freshRes.status, 409);
    assert.deepEqual(freshRes.data, { error: 'handle_taken' });
    assert.deepEqual(Object.keys(freshRes.data), ['error']);

    const sameClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...bobKeys });
    const sameRes = await sameClient.join({ origin: 'musebook' });
    assert.equal(sameRes.status, 409);
    assert.deepEqual(sameRes.data, { error: 'handle_taken' });
    assert.deepEqual(Object.keys(sameRes.data), ['error']);

    const seqAfter = (await bob.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore);
    const bobHistory = ctx.db.prepare('SELECT * FROM key_history WHERE handle = ?').all('bob');
    assert.equal(bobHistory.length, 1);
    assert.equal(bobHistory[0].action, 'register');
  } finally {
    await ctx.close();
  }
});

test('join with origins direct and guestbook succeeds and stores the origin', async () => {
  const ctx = await startTestServer();
  try {
    const danaKeys = generateKeypair();
    const dana = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'dana', ...danaKeys });
    const directRes = await dana.join({ origin: 'direct' });
    assert.equal(directRes.status, 201);
    assert.equal(directRes.data.origin, 'direct');
    assert.deepEqual(Object.keys(directRes.data), ['handle', 'status', 'origin', 'state_seq']);
    const danaRow = ctx.db.prepare('SELECT origin FROM residents WHERE handle = ?').get('dana');
    assert.equal(danaRow.origin, 'direct');

    const erinKeys = generateKeypair();
    const erin = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'erin', ...erinKeys });
    const guestbookRes = await erin.join({ origin: 'guestbook' });
    assert.equal(guestbookRes.status, 201);
    assert.equal(guestbookRes.data.origin, 'guestbook');
    const erinRow = ctx.db.prepare('SELECT origin FROM residents WHERE handle = ?').get('erin');
    assert.equal(erinRow.origin, 'guestbook');
  } finally {
    await ctx.close();
  }
});

test('key_history ids order globally across residents: register, register, rotate, rotate', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    const freshAlice = generateKeypair();
    const aliceRot = await alice.rotateKey(freshAlice.pubkey);
    assert.equal(aliceRot.status, 200);
    alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...freshAlice });

    const freshBob = generateKeypair();
    const bobRot = await bob.rotateKey(freshBob.pubkey);
    assert.equal(bobRot.status, 200);

    const rows = ctx.db.prepare('SELECT id, handle, action FROM key_history ORDER BY id ASC').all();
    assert.deepEqual(
      rows.map((r) => `${r.handle}:${r.action}`),
      ['alice:register', 'bob:register', 'alice:rotate', 'bob:rotate']
    );
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i].id > rows[i - 1].id);
    }
  } finally {
    await ctx.close();
  }
});

test('join 400 invalid_origin consumes the per-IP budget: five then a valid join is 429', async () => {
  const ctx = await startTestServer();
  try {
    for (let i = 0; i < 5; i += 1) {
      const keys = generateKeypair();
      const res = await rawJoin(ctx.baseUrl, {
        handle: `probe${i}`,
        pubkey: keys.pubkey,
        origin: 'nowhere',
        privateKeyPem: keys.privateKeyPem,
      });
      assert.equal(res.status, 400);
      assert.deepEqual(res.data, { error: 'invalid_origin' });
      assert.deepEqual(Object.keys(res.data), ['error']);
    }

    const graceKeys = generateKeypair();
    const grace = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'grace', ...graceKeys });
    const graceRes = await grace.join({ origin: 'musebook' });
    assert.equal(graceRes.status, 429);
    assert.deepEqual(Object.keys(graceRes.data), ['error', 'retry_after']);
    assert.equal(graceRes.data.error, 'rate_limited');
    assert.ok(
      graceRes.data.retry_after === 3599 || graceRes.data.retry_after === 3600,
      `expected retry_after 3599 or 3600, got ${graceRes.data.retry_after}`
    );
  } finally {
    await ctx.close();
  }
});

test('join invite_code errors: non-string 400 and unknown code 403, exact bodies, nothing written', async () => {
  const ctx = await startTestServer();
  try {
    const probe = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'probe', ...generateKeypair() });
    const seqBefore = (await probe.state()).data.state_seq;

    const aliceKeys = generateKeypair();
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...aliceKeys });
    const badTypeRes = await alice.join({ origin: 'musebook', invite_code: 123 });
    assert.equal(badTypeRes.status, 400);
    assert.deepEqual(badTypeRes.data, { error: 'invalid_invite' });
    assert.deepEqual(Object.keys(badTypeRes.data), ['error']);

    const bobKeys = generateKeypair();
    const bob = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...bobKeys });
    const unknownRes = await bob.join({ origin: 'musebook', invite_code: 'no-such-code' });
    assert.equal(unknownRes.status, 403);
    assert.deepEqual(unknownRes.data, { error: 'invalid_invite' });
    assert.deepEqual(Object.keys(unknownRes.data), ['error']);

    const aliceRow = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow, undefined);
    const bobRow = ctx.db.prepare('SELECT * FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow, undefined);

    const seqAfter = (await probe.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore);
  } finally {
    await ctx.close();
  }
});
