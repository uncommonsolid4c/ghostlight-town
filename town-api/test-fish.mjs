import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CATCH_KINDS = new Set([
  'old_boot',
  'tin_kettle',
  'rusty_spoon',
  'soggy_glove',
  'tangled_string',
  'poem_in_a_bottle',
  'silver_minnow',
  'glass_float',
]);

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-fish-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const nowFn = opts.nowFn || (() => Math.floor(Date.now() / 1000) + clockOffset);

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
    advanceClock(sec) {
      clockOffset += sec;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function signedPostAt(ctx, endpoint, payload, handle, privateKeyPem) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle,
    privateKeyPem,
    timestamp: ctx.nowSec(),
  });
  const res = await fetch(`${ctx.baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function adminPost(ctx, endpoint, payload) {
  return signedPostAt(ctx, endpoint, payload, 'milo-op', ctx.operatorKeys.privateKeyPem);
}

test('resident cast, duplicate cast 409, settle 409, reel 200, and second reel 404', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keys });
    const joined = await client.join({ origin: 'direct' });
    assert.equal(joined.status, 201);

    const cast1 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast1.status, 201);
    assert.equal(cast1.data.handle, 'alice');
    assert.equal(cast1.data.reel_at - cast1.data.cast_at, 300);

    // Second cast while active -> 409 already_cast
    const cast2 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast2.status, 409);
    assert.equal(cast2.data.error, 'already_cast');
    assert.equal(cast2.data.cast_at, cast1.data.cast_at);
    assert.equal(cast2.data.reel_at, cast1.data.reel_at);

    // Reel before settle -> 409 line_settling
    ctx.advanceClock(100);
    const earlyReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(earlyReel.status, 409);
    assert.equal(earlyReel.data.error, 'line_settling');
    assert.equal(earlyReel.data.reel_at, cast1.data.reel_at);

    // Advance past reel_at -> 200 catch
    ctx.advanceClock(200);
    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel.status, 200);
    assert.equal(reel.data.handle, 'alice');
    assert.ok(CATCH_KINDS.has(reel.data.catch.kind), `Unexpected kind: ${reel.data.catch.kind}`);
    assert.equal(typeof reel.data.catch.label, 'string');
    assert.ok(reel.data.catch.label.length > 0);
    assert.equal(typeof reel.data.catch.flavor, 'string');
    assert.ok(reel.data.catch.flavor.length > 0);
    assert.equal(typeof reel.data.caught_at, 'number');

    // Cast row is gone -> second reel returns 404
    const secondReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(secondReel.status, 404);
    assert.equal(secondReel.data.error, 'no_active_cast');
  } finally {
    await ctx.close();
  }
});

test('reel with no active cast returns 404 no_active_cast', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keys });
    await client.join({ origin: 'direct' });

    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel.status, 404);
    assert.equal(reel.data.error, 'no_active_cast');
  } finally {
    await ctx.close();
  }
});

test('fish log returns catches latest-first, caps at 50, handles empty and invalid handles', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keys });
    await client.join({ origin: 'direct' });

    // Missing/bad handle -> 400 invalid_handle
    const missingRes = await fetch(`${ctx.baseUrl}/api/town/fish/log`);
    assert.equal(missingRes.status, 400);
    assert.equal((await missingRes.json()).error, 'invalid_handle');

    const badRes = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=BAD!`);
    assert.equal(badRes.status, 400);
    assert.equal((await badRes.json()).error, 'invalid_handle');

    // Fresh handle -> empty list, not 404
    const emptyLog = await client.fishLog('fresh_muse');
    assert.equal(emptyLog.status, 200);
    assert.deepEqual(emptyLog.data, { handle: 'fresh_muse', catches: [], count: 0 });

    // Cast and reel twice so we verify latest-first ordering
    await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    ctx.advanceClock(300);
    const firstCatch = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);

    ctx.advanceClock(10);
    await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    ctx.advanceClock(300);
    const secondCatch = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);

    const logRes = await client.fishLog('alice');
    assert.equal(logRes.status, 200);
    assert.equal(logRes.data.count, 2);
    assert.equal(logRes.data.catches[0].caught_at, secondCatch.data.caught_at);
    assert.equal(logRes.data.catches[0].kind, secondCatch.data.catch.kind);
    assert.equal(logRes.data.catches[1].caught_at, firstCatch.data.caught_at);

    // Seed 55 catches directly in the db for cap_tester and assert log caps at 50
    const stmt = ctx.db.prepare(
      'INSERT INTO fish_catches (handle, kind, label, flavor, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (let i = 1; i <= 55; i++) {
      stmt.run('cap_tester', 'old_boot', `Catch ${i}`, 'Flavor', 1000 + i);
    }
    const capped = await client.fishLog('cap_tester');
    assert.equal(capped.status, 200);
    assert.equal(capped.data.count, 50);
    assert.equal(capped.data.catches.length, 50);
    assert.equal(capped.data.catches[0].label, 'Catch 55');
    assert.equal(capped.data.catches[49].label, 'Catch 6');
  } finally {
    await ctx.close();
  }
});

test('guest cast/reel, 2/hour rate limit, and resident handle collision 409', async () => {
  const ctx = await startTestServer();
  try {
    const resKeys = generateKeypair();
    const resClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...resKeys });
    await resClient.join({ origin: 'direct' });

    const guestKeys = generateKeypair();

    // Guest using resident handle -> 409 handle_taken
    const collision = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'alice', pubkey: guestKeys.pubkey },
      'alice',
      guestKeys.privateKeyPem
    );
    assert.equal(collision.status, 409);
    assert.equal(collision.data.error, 'handle_taken');

    // 1st guest cast + reel
    const c1 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(c1.status, 201);
    ctx.advanceClock(300);
    const r1 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(r1.status, 200);
    assert.ok(CATCH_KINDS.has(r1.data.catch.kind));

    // 2nd guest cast + reel
    ctx.advanceClock(10);
    const c2 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(c2.status, 201);
    ctx.advanceClock(300);
    const r2 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(r2.status, 200);

    // 3rd guest cast in the hour -> 429 rate_limited
    ctx.advanceClock(10);
    const c3 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(c3.status, 429);
    assert.equal(c3.data.error, 'rate_limited');
    assert.ok(c3.data.retry_after > 0);
  } finally {
    await ctx.close();
  }
});

test('resident cast rate limit (10/hour) returns 429 on 11th cast', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keys });
    await client.join({ origin: 'direct' });

    for (let i = 0; i < 10; i++) {
      const c = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
      assert.equal(c.status, 201, `Cast ${i + 1} should succeed`);
      ctx.advanceClock(300);
      const r = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
      assert.equal(r.status, 200, `Reel ${i + 1} should succeed`);
      ctx.advanceClock(10);
    }

    const eleventh = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.data.error, 'rate_limited');
    assert.ok(eleventh.data.retry_after > 0);
  } finally {
    await ctx.close();
  }
});

test('muted, suspended, and unknown residents are rejected on cast/reel', async () => {
  const ctx = await startTestServer();
  try {
    const mutedKeys = generateKeypair();
    await new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'muted_one', ...mutedKeys }).join({ origin: 'direct' });
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = 'muted_one'").run();

    const mutedCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'muted_one', mutedKeys.privateKeyPem);
    assert.equal(mutedCast.status, 403);
    assert.equal(mutedCast.data.error, 'resident_muted');

    const mutedReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'muted_one', mutedKeys.privateKeyPem);
    assert.equal(mutedReel.status, 403);
    assert.equal(mutedReel.data.error, 'resident_muted');

    // Suspended resident (seeded directly in the db)
    const suspKeys = generateKeypair();
    ctx.db.prepare(
      `INSERT INTO residents (handle, pubkey, origin, status, role, bio, created_at)
       VALUES (?, ?, 'direct', 'suspended', 'muse', '', ?)`
    ).run('susp_one', suspKeys.pubkey, ctx.nowSec());

    const suspCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'susp_one', suspKeys.privateKeyPem);
    assert.equal(suspCast.status, 403);
    assert.equal(suspCast.data.error, 'resident_not_active');

    // Unknown resident
    const ghostKeys = generateKeypair();
    const unknownCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'nobody', ghostKeys.privateKeyPem);
    assert.equal(unknownCast.status, 401);
    assert.equal(unknownCast.data.error, 'unknown_resident');
  } finally {
    await ctx.close();
  }
});

test('cast and reel leave state_seq unchanged', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keys });
    await client.join({ origin: 'direct' });

    const beforeRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    const beforeState = await beforeRes.json();

    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast.status, 201);

    const midRes = await fetch(`${ctx.baseUrl}/api/town/state?since=${beforeState.state_seq}`);
    assert.equal(midRes.status, 304);

    ctx.advanceClock(300);
    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel.status, 200);

    const afterRes = await fetch(`${ctx.baseUrl}/api/town/state?since=${beforeState.state_seq}`);
    assert.equal(afterRes.status, 304);
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient fishCast, fishReel, and fishLog round-trip', async () => {
  const origDateNow = Date.now;
  let fakeNowMs = origDateNow();
  Date.now = () => fakeNowMs;

  const ctx = await startTestServer({ nowFn: () => Math.floor(Date.now() / 1000) });
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'angler', ...keys });
    await client.join({ origin: 'direct' });

    const cast = await client.fishCast();
    assert.equal(cast.status, 201);
    assert.equal(cast.data.reel_at - cast.data.cast_at, 300);

    fakeNowMs += 301_000;
    const reel = await client.fishReel();
    assert.equal(reel.status, 200);
    assert.ok(CATCH_KINDS.has(reel.data.catch.kind));

    const log = await client.fishLog('angler');
    assert.equal(log.status, 200);
    assert.equal(log.data.count, 1);
    assert.equal(log.data.catches[0].kind, reel.data.catch.kind);
    assert.equal(log.data.catches[0].label, reel.data.catch.label);
    assert.equal(log.data.catches[0].flavor, reel.data.catch.flavor);
  } finally {
    Date.now = origDateNow;
    await ctx.close();
  }
});

test('test-fish.mjs and server.mjs fishing code contain no random PRNG and no forbidden terms', () => {
  const testSrc = fs.readFileSync(path.join(__dirname, 'test-fish.mjs'), 'utf8');
  const mathRndRe = new RegExp('Math\\.' + 'random');
  const forbiddenRe = new RegExp('camp\\s*' + 'fire', 'i');
  assert.equal(mathRndRe.test(testSrc), false);
  assert.equal(forbiddenRe.test(testSrc), false);
});
