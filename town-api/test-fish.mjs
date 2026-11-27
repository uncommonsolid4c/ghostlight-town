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

async function joinResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joined = await client.join({ origin: 'direct' });
  assert.equal(joined.status, 201);
  return { keys, client };
}

test('reel timing boundary: one second early fails, exactly at reel_at succeeds', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');
    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast.status, 201);
    assert.equal(cast.data.reel_at - cast.data.cast_at, 300);

    ctx.advanceClock(299);
    const early = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(early.status, 409);
    assert.equal(early.data.error, 'line_settling');
    assert.equal(early.data.reel_at, cast.data.reel_at);

    ctx.advanceClock(1);
    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel.status, 200);
    assert.ok(reel.data.caught_at >= cast.data.reel_at);
    assert.ok(reel.data.caught_at - cast.data.reel_at <= 10);
  } finally {
    await ctx.close();
  }
});

test('duplicate casts do not consume the resident rate limit', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');

    for (let i = 0; i < 10; i++) {
      const c = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
      assert.equal(c.status, 201, `Cast ${i + 1} should succeed`);

      const dup = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
      assert.equal(dup.status, 409);
      assert.equal(dup.data.error, 'already_cast');
      assert.equal(dup.data.cast_at, c.data.cast_at);
      assert.equal(dup.data.reel_at, c.data.reel_at);

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

test('resident fish rate limit resets after the hour window', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');

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
    assert.ok(
      eleventh.data.retry_after >= 490 && eleventh.data.retry_after <= 500,
      `Expected retry_after in [490, 500], got ${eleventh.data.retry_after}`
    );

    ctx.advanceClock(3600);
    const resetCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(resetCast.status, 201);
  } finally {
    await ctx.close();
  }
});

test('guest fish rate limit resets after the hour window', async () => {
  const ctx = await startTestServer();
  try {
    const guestKeys = generateKeypair();

    for (let i = 0; i < 2; i++) {
      const c = await signedPostAt(
        ctx,
        '/api/town/fish/guest/cast',
        { handle: 'visitor_1', pubkey: guestKeys.pubkey },
        'visitor_1',
        guestKeys.privateKeyPem
      );
      assert.equal(c.status, 201);
      ctx.advanceClock(300);
      const r = await signedPostAt(
        ctx,
        '/api/town/fish/guest/reel',
        { handle: 'visitor_1', pubkey: guestKeys.pubkey },
        'visitor_1',
        guestKeys.privateKeyPem
      );
      assert.equal(r.status, 200);
      ctx.advanceClock(10);
    }

    const third = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(third.status, 429);
    assert.equal(third.data.error, 'rate_limited');
    assert.ok(
      third.data.retry_after >= 2970 && third.data.retry_after <= 2980,
      `Expected retry_after in [2970, 2980], got ${third.data.retry_after}`
    );

    ctx.advanceClock(3600);
    const resetCast = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(resetCast.status, 201);
  } finally {
    await ctx.close();
  }
});

test('guest reel errors: no active cast 404, early reel 409, duplicate cast 409', async () => {
  const ctx = await startTestServer();
  try {
    const guestKeys = generateKeypair();

    const noCast = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(noCast.status, 404);
    assert.equal(noCast.data.error, 'no_active_cast');

    const c1 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(c1.status, 201);

    const dup = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error, 'already_cast');
    assert.equal(dup.data.cast_at, c1.data.cast_at);

    ctx.advanceClock(100);
    const early = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(early.status, 409);
    assert.equal(early.data.error, 'line_settling');

    ctx.advanceClock(200);
    const reel = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(reel.status, 200);
  } finally {
    await ctx.close();
  }
});

test('guest cast and reel reject invalid handles', async () => {
  const ctx = await startTestServer();
  try {
    const guestKeys = generateKeypair();

    for (const bad of ['BAD!', 'a', 'UPPER', 'has space']) {
      const badCast = await signedPostAt(
        ctx,
        '/api/town/fish/guest/cast',
        { handle: bad, pubkey: guestKeys.pubkey },
        bad,
        guestKeys.privateKeyPem
      );
      assert.equal(badCast.status, 400, `Cast for ${JSON.stringify(bad)} should be 400`);
      assert.equal(badCast.data.error, 'invalid_handle');

      const badReel = await signedPostAt(
        ctx,
        '/api/town/fish/guest/reel',
        { handle: bad, pubkey: guestKeys.pubkey },
        bad,
        guestKeys.privateKeyPem
      );
      assert.equal(badReel.status, 400, `Reel for ${JSON.stringify(bad)} should be 400`);
      assert.equal(badReel.data.error, 'invalid_handle');
    }

    const emptyCast = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: '', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(emptyCast.status, 400);
    assert.equal(emptyCast.data.error, 'invalid_handle');

    const mismatchCast = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_2', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(mismatchCast.status, 401);
    assert.equal(mismatchCast.data.error, 'handle_mismatch');
  } finally {
    await ctx.close();
  }
});

test('guest cast without a body handle uses the signed handle', async () => {
  const ctx = await startTestServer();
  try {
    const guestKeys = generateKeypair();

    const noPubkey = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      {},
      'visitor_9',
      guestKeys.privateKeyPem
    );
    assert.equal(noPubkey.status, 400);
    assert.equal(noPubkey.data.error, 'missing_pubkey');

    const cast = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: guestKeys.pubkey },
      'visitor_9',
      guestKeys.privateKeyPem
    );
    assert.equal(cast.status, 201);
    assert.equal(cast.data.handle, 'visitor_9');

    ctx.advanceClock(300);
    const reel = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { pubkey: guestKeys.pubkey },
      'visitor_9',
      guestKeys.privateKeyPem
    );
    assert.equal(reel.status, 200);
    assert.equal(reel.data.handle, 'visitor_9');

    const logRes = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=visitor_9`);
    assert.equal(logRes.status, 200);
    const logData = await logRes.json();
    assert.equal(logData.count, 1);
  } finally {
    await ctx.close();
  }
});

test('every catch label and flavor matches the catch table', async () => {
  const TABLE = {
    old_boot: {
      label: 'An old boot.',
      flavor: 'It has seen things. It has been places. It is, technically, a catch.',
    },
    tin_kettle: {
      label: 'A tin kettle.',
      flavor: 'Dented, but the spout still whistles in a stiff breeze. Tomas would approve.',
    },
    rusty_spoon: {
      label: 'A rusty spoon.',
      flavor: "Somebody's soup, a long time ago.",
    },
    soggy_glove: {
      label: 'A soggy glove.',
      flavor: 'One glove. The other one is still out there, living its best life.',
    },
    tangled_string: {
      label: 'A tangle of string.',
      flavor: 'It was a fishing line once. It has come home.',
    },
    poem_in_a_bottle: {
      label: 'A poem in a bottle.',
      flavor: null,
    },
    silver_minnow: {
      label: 'A silver minnow.',
      flavor: 'It flashes once in your palm and slips back into the lake. You were faster this time.',
    },
    glass_float: {
      label: 'A glass float.',
      flavor: 'Sea-green, perfect, older than the town. The lake gives up its treasures rarely.',
    },
  };
  const POEMS = new Set([
    'The lake keeps what the town forgets, and returns it damp.',
    'If you are reading this, the water was kinder than the road.',
    'Someone loved this shore enough to write it down.',
    'The minnows know the way home. Ask them nicely.',
  ]);

  const ctx = await startTestServer();
  try {
    const anglers = [];
    for (let i = 0; i < 5; i++) {
      const handle = `angler_${i}`;
      const { keys } = await joinResident(ctx, handle);
      anglers.push({ handle, keys });
    }

    let total = 0;
    for (const { handle, keys } of anglers) {
      for (let i = 0; i < 10; i++) {
        const c = await signedPostAt(ctx, '/api/town/fish/cast', {}, handle, keys.privateKeyPem);
        assert.equal(c.status, 201);
        ctx.advanceClock(300);
        const r = await signedPostAt(ctx, '/api/town/fish/reel', {}, handle, keys.privateKeyPem);
        assert.equal(r.status, 200);
        ctx.advanceClock(10);

        const entry = TABLE[r.data.catch.kind];
        assert.ok(entry, `Unknown catch kind: ${r.data.catch.kind}`);
        assert.equal(r.data.catch.label, entry.label);
        if (entry.flavor === null) {
          assert.ok(POEMS.has(r.data.catch.flavor), `Unexpected poem flavor: ${r.data.catch.flavor}`);
        } else {
          assert.equal(r.data.catch.flavor, entry.flavor);
        }
        total += 1;
      }
    }

    assert.equal(total, 50);
  } finally {
    await ctx.close();
  }
});

test('two residents and a guest fish independently; logs are per-handle', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await joinResident(ctx, 'alice');
    const bob = await joinResident(ctx, 'bob');
    const guestKeys = generateKeypair();

    const aliceCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(aliceCast.status, 201);
    const bobCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'bob', bob.keys.privateKeyPem);
    assert.equal(bobCast.status, 201);

    const aliceDup = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(aliceDup.status, 409);

    ctx.advanceClock(100);
    const aliceEarly = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(aliceEarly.status, 409);

    ctx.advanceClock(200);
    const aliceReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(aliceReel.status, 200);
    const bobReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'bob', bob.keys.privateKeyPem);
    assert.equal(bobReel.status, 200);

    const guestCast = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(guestCast.status, 201);
    ctx.advanceClock(300);
    const guestReel = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(guestReel.status, 200);

    const aliceLog = await alice.client.fishLog('alice');
    assert.equal(aliceLog.status, 200);
    assert.equal(aliceLog.data.count, 1);
    assert.equal(aliceLog.data.catches[0].kind, aliceReel.data.catch.kind);

    const bobLog = await alice.client.fishLog('bob');
    assert.equal(bobLog.status, 200);
    assert.equal(bobLog.data.count, 1);
    assert.equal(bobLog.data.catches[0].kind, bobReel.data.catch.kind);

    const guestLog = await alice.client.fishLog('visitor_1');
    assert.equal(guestLog.status, 200);
    assert.equal(guestLog.data.count, 1);
    assert.equal(guestLog.data.catches[0].kind, guestReel.data.catch.kind);
  } finally {
    await ctx.close();
  }
});

test('cast, reel, and log responses carry exactly the documented keys', async () => {
  const ctx = await startTestServer();
  try {
    const { keys, client } = await joinResident(ctx, 'alice');

    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast.status, 201);
    assert.deepEqual(Object.keys(cast.data).sort(), ['cast_at', 'handle', 'reel_at']);

    ctx.advanceClock(300);
    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel.status, 200);
    assert.deepEqual(Object.keys(reel.data).sort(), ['catch', 'caught_at', 'handle']);
    assert.deepEqual(Object.keys(reel.data.catch).sort(), ['flavor', 'kind', 'label']);

    const log = await client.fishLog('alice');
    assert.equal(log.status, 200);
    assert.deepEqual(Object.keys(log.data).sort(), ['catches', 'count', 'handle']);
    assert.deepEqual(Object.keys(log.data.catches[0]).sort(), ['caught_at', 'flavor', 'kind', 'label']);
  } finally {
    await ctx.close();
  }
});

test('caught_at equals server now exactly, including a late reel', async () => {
  const origDateNow = Date.now;
  let fakeNowMs = origDateNow();
  Date.now = () => fakeNowMs;

  const ctx = await startTestServer({ nowFn: () => Math.floor(Date.now() / 1000) });
  try {
    const { keys, client } = await joinResident(ctx, 'alice');

    const cast1 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast1.status, 201);

    fakeNowMs += 300_000;
    const reel1 = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel1.status, 200);
    assert.equal(reel1.data.caught_at, cast1.data.cast_at + 300);
    assert.equal(reel1.data.caught_at, cast1.data.reel_at);

    const log = await client.fishLog('alice');
    assert.equal(log.status, 200);
    assert.equal(log.data.catches[0].caught_at, reel1.data.caught_at);

    fakeNowMs += 10_000;
    const cast2 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast2.status, 201);

    fakeNowMs += 310_000;
    const reel2 = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel2.status, 200);
    assert.equal(reel2.data.caught_at, cast2.data.reel_at + 10);
  } finally {
    Date.now = origDateNow;
    await ctx.close();
  }
});

test('frozen catch table weights and poem lines match the server source', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const weights = [...serverSrc.matchAll(/kind: '([a-z_]+)',\s*\n\s*weight: (\d+),/g)].map((m) => [
    m[1],
    Number(m[2]),
  ]);
  assert.deepEqual(weights, [
    ['old_boot', 22],
    ['tin_kettle', 18],
    ['rusty_spoon', 16],
    ['soggy_glove', 14],
    ['tangled_string', 12],
    ['poem_in_a_bottle', 10],
    ['silver_minnow', 5],
    ['glass_float', 3],
  ]);
  assert.equal(
    weights.reduce((sum, [, w]) => sum + w, 0),
    100
  );

  const expectedPoems = [
    'The lake keeps what the town forgets, and returns it damp.',
    'If you are reading this, the water was kinder than the road.',
    'Someone loved this shore enough to write it down.',
    'The minnows know the way home. Ask them nicely.',
  ];
  for (const line of expectedPoems) {
    assert.ok(serverSrc.includes(`'${line}'`), `Missing poem line: ${line}`);
  }

  const blockMatch = serverSrc.match(/const POEM_BOTTLE_LINES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(blockMatch, 'POEM_BOTTLE_LINES block not found');
  const quoteCount = (blockMatch[1].match(/'/g) || []).length;
  assert.equal(quoteCount, 8);
});

test('guest reel with a different keypair succeeds; second guest cast hits already_cast', async () => {
  const ctx = await startTestServer();
  try {
    const keysA = generateKeypair();
    const keysB = generateKeypair();

    const c1 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: keysA.pubkey },
      'visitor_1',
      keysA.privateKeyPem
    );
    assert.equal(c1.status, 201);

    const c2 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: keysB.pubkey },
      'visitor_1',
      keysB.privateKeyPem
    );
    assert.equal(c2.status, 409);
    assert.equal(c2.data.error, 'already_cast');
    assert.equal(c2.data.cast_at, c1.data.cast_at);

    ctx.advanceClock(300);
    const reel = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor_1', pubkey: keysB.pubkey },
      'visitor_1',
      keysB.privateKeyPem
    );
    assert.equal(reel.status, 200);
    assert.equal(reel.data.handle, 'visitor_1');
  } finally {
    await ctx.close();
  }
});

test('fish auth matrix: suspended reel, unknown reel, wrong key, missing headers', async () => {
  const ctx = await startTestServer();
  try {
    await joinResident(ctx, 'alice');
    const bob = await joinResident(ctx, 'bob');

    const wrongKey = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', bob.keys.privateKeyPem);
    assert.equal(wrongKey.status, 401);
    assert.equal(wrongKey.data.error, 'invalid_signature');

    const bareRes = await fetch(`${ctx.baseUrl}/api/town/fish/cast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(bareRes.status, 401);
    assert.equal((await bareRes.json()).error, 'missing_auth_headers');

    const ghostKeys = generateKeypair();
    const unknownReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'nobody', ghostKeys.privateKeyPem);
    assert.equal(unknownReel.status, 401);
    assert.equal(unknownReel.data.error, 'unknown_resident');

    const suspKeys = generateKeypair();
    ctx.db
      .prepare(
        `INSERT INTO residents (handle, pubkey, origin, status, role, bio, created_at)
         VALUES (?, ?, 'direct', 'suspended', 'muse', '', ?)`
      )
      .run('susp_one', suspKeys.pubkey, ctx.nowSec());

    const suspReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'susp_one', suspKeys.privateKeyPem);
    assert.equal(suspReel.status, 403);
    assert.equal(suspReel.data.error, 'resident_not_active');
    assert.equal(suspReel.data.resident_status, 'suspended');
  } finally {
    await ctx.close();
  }
});

test('guest duplicate casts do not consume the guest rate limit', async () => {
  const ctx = await startTestServer();
  try {
    const guestKeys = generateKeypair();

    const c1 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(c1.status, 201);

    for (let i = 0; i < 2; i++) {
      const dup = await signedPostAt(
        ctx,
        '/api/town/fish/guest/cast',
        { handle: 'visitor_1', pubkey: guestKeys.pubkey },
        'visitor_1',
        guestKeys.privateKeyPem
      );
      assert.equal(dup.status, 409);
      assert.equal(dup.data.error, 'already_cast');
    }

    ctx.advanceClock(300);
    const r1 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(r1.status, 200);

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
  } finally {
    await ctx.close();
  }
});

test('an NPC resident can fish', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'wick', ...keys });
    const joined = await client.join({ origin: 'colony' });
    assert.equal(joined.status, 201);

    const approved = await adminPost(ctx, '/api/town/admin/approve', { handle: 'wick', role: 'npc' });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.role, 'npc');
    assert.equal(approved.data.status, 'active');

    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'wick', keys.privateKeyPem);
    assert.equal(cast.status, 201);

    ctx.advanceClock(300);
    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'wick', keys.privateKeyPem);
    assert.equal(reel.status, 200);

    const log = await client.fishLog('wick');
    assert.equal(log.status, 200);
    assert.equal(log.data.count, 1);
    assert.equal(log.data.catches[0].kind, reel.data.catch.kind);
  } finally {
    await ctx.close();
  }
});

test('re-cast after reel gets fresh timestamps; db rows track the lifecycle', async () => {
  const origDateNow = Date.now;
  let fakeNowMs = origDateNow();
  Date.now = () => fakeNowMs;

  const ctx = await startTestServer({ nowFn: () => Math.floor(Date.now() / 1000) });
  try {
    const { keys } = await joinResident(ctx, 'alice');

    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast.status, 201);

    const castRow = ctx.db.prepare('SELECT cast_at, reel_at FROM fish_casts WHERE handle = ?').get('alice');
    assert.ok(castRow);
    assert.equal(castRow.cast_at, cast.data.cast_at);
    assert.equal(castRow.reel_at, cast.data.reel_at);

    fakeNowMs += 300_000;
    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel.status, 200);

    const remainingCasts = ctx.db.prepare('SELECT cast_at, reel_at FROM fish_casts WHERE handle = ?').all('alice');
    assert.equal(remainingCasts.length, 0);

    const catchRows = ctx.db.prepare('SELECT kind, created_at FROM fish_catches WHERE handle = ?').all('alice');
    assert.equal(catchRows.length, 1);
    assert.equal(catchRows[0].kind, reel.data.catch.kind);
    assert.equal(catchRows[0].created_at, reel.data.caught_at);

    fakeNowMs += 10_000;
    const recast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(recast.status, 201);
    assert.equal(recast.data.cast_at, reel.data.caught_at + 10);
    assert.equal(recast.data.reel_at, recast.data.cast_at + 300);
  } finally {
    Date.now = origDateNow;
    await ctx.close();
  }
});

test('guest cast collides with muted and suspended resident handles; fishing leaves no trace in state', async () => {
  const ctx = await startTestServer();
  try {
    await joinResident(ctx, 'muted_one');
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = 'muted_one'").run();

    const suspKeys = generateKeypair();
    ctx.db
      .prepare(
        `INSERT INTO residents (handle, pubkey, origin, status, role, bio, created_at)
         VALUES (?, ?, 'direct', 'suspended', 'muse', '', ?)`
      )
      .run('susp_one', suspKeys.pubkey, ctx.nowSec());

    const guestKeys = generateKeypair();
    for (const handle of ['muted_one', 'susp_one']) {
      const collision = await signedPostAt(
        ctx,
        '/api/town/fish/guest/cast',
        { handle, pubkey: guestKeys.pubkey },
        handle,
        guestKeys.privateKeyPem
      );
      assert.equal(collision.status, 409);
      assert.equal(collision.data.error, 'handle_taken');
    }

    const alice = await joinResident(ctx, 'alice');
    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(cast.status, 201);
    ctx.advanceClock(300);
    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(reel.status, 200);

    const stateRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();
    assert.equal('fish' in state, false);
    assert.equal('fish_casts' in state, false);
    assert.equal('fish_catches' in state, false);
  } finally {
    await ctx.close();
  }
});

test('fish log HANDLE_RE length and shape edges', async () => {
  const ctx = await startTestServer();
  try {
    const validHandles = ['ab', 'a' + 'b'.repeat(31), 'a-b', 'a_b'];
    for (const h of validHandles) {
      const res = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=${encodeURIComponent(h)}`);
      assert.equal(res.status, 200, `expected 200 for ${h}`);
      const data = await res.json();
      assert.deepEqual(data, { handle: h, catches: [], count: 0 });
    }

    const invalidHandles = ['a' + 'b'.repeat(32), '-ab', '_ab', '', 'Ab'];
    for (const h of invalidHandles) {
      const res = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=${encodeURIComponent(h)}`);
      assert.equal(res.status, 400, `expected 400 for ${h}`);
      const data = await res.json();
      assert.deepEqual(data, { error: 'invalid_handle' });
    }
  } finally {
    await ctx.close();
  }
});

test('fish log cap boundary at 50 vs 51 and created_at tie-break order', async () => {
  const ctx = await startTestServer();
  try {
    const insert = ctx.db.prepare(
      'INSERT INTO fish_catches (handle, kind, label, flavor, created_at) VALUES (?, ?, ?, ?, ?)'
    );

    for (let i = 1; i <= 50; i += 1) {
      insert.run('cap50', 'old_boot', `Catch ${i}`, 'flavor', 1000 + i);
    }
    const res50 = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=cap50`);
    assert.equal(res50.status, 200);
    const data50 = await res50.json();
    assert.equal(data50.count, 50);
    assert.equal(data50.catches[0].label, 'Catch 50');
    assert.equal(data50.catches[49].label, 'Catch 1');

    for (let i = 1; i <= 51; i += 1) {
      insert.run('cap51', 'old_boot', `Catch ${i}`, 'flavor', 1000 + i);
    }
    const res51 = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=cap51`);
    assert.equal(res51.status, 200);
    const data51 = await res51.json();
    assert.equal(data51.count, 50);
    assert.equal(data51.catches[0].label, 'Catch 51');
    assert.equal(data51.catches[49].label, 'Catch 2');

    for (const label of ['Tie 1', 'Tie 2', 'Tie 3']) {
      insert.run('tie_breaker', 'old_boot', label, 'flavor', 2000);
    }
    const resTie = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=tie_breaker`);
    assert.equal(resTie.status, 200);
    const dataTie = await resTie.json();
    assert.deepEqual(
      dataTie.catches.map((c) => c.label),
      ['Tie 3', 'Tie 2', 'Tie 1']
    );
  } finally {
    await ctx.close();
  }
});

test('fish error responses return exact sorted key sets', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await joinResident(ctx, 'alice');
    const muted = await joinResident(ctx, 'muted_res');
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = 'muted_res'").run();

    const suspKeys = generateKeypair();
    ctx.db
      .prepare(
        `INSERT INTO residents (handle, pubkey, origin, status, role, bio, created_at)
         VALUES (?, ?, 'direct', 'suspended', 'muse', '', ?)`
      )
      .run('susp_res', suspKeys.pubkey, ctx.nowSec());

    const noCast = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(noCast.status, 404);
    assert.equal(noCast.data.error, 'no_active_cast');
    assert.deepEqual(Object.keys(noCast.data).sort(), ['error']);

    const cast1 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(cast1.status, 201);

    const dupCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(dupCast.status, 409);
    assert.equal(dupCast.data.error, 'already_cast');
    assert.deepEqual(Object.keys(dupCast.data).sort(), ['cast_at', 'error', 'reel_at']);

    ctx.advanceClock(100);
    const settling = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(settling.status, 409);
    assert.equal(settling.data.error, 'line_settling');
    assert.deepEqual(Object.keys(settling.data).sort(), ['error', 'reel_at']);

    const guestKeys = generateKeypair();
    for (let i = 0; i < 2; i += 1) {
      const gc = await signedPostAt(
        ctx,
        '/api/town/fish/guest/cast',
        { pubkey: guestKeys.pubkey },
        'g_rl',
        guestKeys.privateKeyPem
      );
      assert.equal(gc.status, 201);
      ctx.advanceClock(300);
      const gr = await signedPostAt(
        ctx,
        '/api/town/fish/guest/reel',
        { pubkey: guestKeys.pubkey },
        'g_rl',
        guestKeys.privateKeyPem
      );
      assert.equal(gr.status, 200);
    }
    const rl = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: guestKeys.pubkey },
      'g_rl',
      guestKeys.privateKeyPem
    );
    assert.equal(rl.status, 429);
    assert.equal(rl.data.error, 'rate_limited');
    assert.deepEqual(Object.keys(rl.data).sort(), ['error', 'retry_after']);

    const inv = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: guestKeys.pubkey },
      'BAD!',
      guestKeys.privateKeyPem
    );
    assert.equal(inv.status, 400);
    assert.equal(inv.data.error, 'invalid_handle');
    assert.deepEqual(Object.keys(inv.data).sort(), ['error']);

    const taken = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: guestKeys.pubkey },
      'alice',
      guestKeys.privateKeyPem
    );
    assert.equal(taken.status, 409);
    assert.equal(taken.data.error, 'handle_taken');
    assert.deepEqual(Object.keys(taken.data).sort(), ['error']);

    const mutedRes = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'muted_res', muted.keys.privateKeyPem);
    assert.equal(mutedRes.status, 403);
    assert.equal(mutedRes.data.error, 'resident_muted');
    assert.deepEqual(Object.keys(mutedRes.data).sort(), ['error']);

    const suspRes = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'susp_res', suspKeys.privateKeyPem);
    assert.equal(suspRes.status, 403);
    assert.equal(suspRes.data.error, 'resident_not_active');
    assert.equal(suspRes.data.resident_status, 'suspended');
    assert.deepEqual(Object.keys(suspRes.data).sort(), ['error', 'resident_status']);
  } finally {
    await ctx.close();
  }
});

test('guest reel auth edges: missing pubkey, handle mismatch, and null body.handle fallback', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();

    const noPubkey = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      {},
      'visitor_1',
      keys.privateKeyPem
    );
    assert.equal(noPubkey.status, 400);
    assert.equal(noPubkey.data.error, 'missing_pubkey');

    const mismatch = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: 'visitor_2', pubkey: keys.pubkey },
      'visitor_1',
      keys.privateKeyPem
    );
    assert.equal(mismatch.status, 401);
    assert.equal(mismatch.data.error, 'handle_mismatch');

    const cast = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: keys.pubkey },
      'visitor_1',
      keys.privateKeyPem
    );
    assert.equal(cast.status, 201);

    ctx.advanceClock(300);
    const reelNullHandle = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { handle: null, pubkey: keys.pubkey },
      'visitor_1',
      keys.privateKeyPem
    );
    assert.equal(reelNullHandle.status, 200);
    assert.equal(reelNullHandle.data.handle, 'visitor_1');
  } finally {
    await ctx.close();
  }
});

test('guest cast pubkey and body.handle shape edges', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const otherKeys = generateKeypair();

    const numPubkey = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: 123 },
      'v_num',
      keys.privateKeyPem
    );
    assert.equal(numPubkey.status, 400);
    assert.equal(numPubkey.data.error, 'missing_pubkey');

    const emptyPubkey = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: '' },
      'v_empty',
      keys.privateKeyPem
    );
    assert.equal(emptyPubkey.status, 400);
    assert.equal(emptyPubkey.data.error, 'missing_pubkey');

    const nullHandle = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: null, pubkey: keys.pubkey },
      'visitor_1',
      keys.privateKeyPem
    );
    assert.equal(nullHandle.status, 201);
    assert.equal(nullHandle.data.handle, 'visitor_1');

    const numHandle = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 123, pubkey: keys.pubkey },
      'visitor_1b',
      keys.privateKeyPem
    );
    assert.equal(numHandle.status, 401);
    assert.equal(numHandle.data.error, 'handle_mismatch');

    const shortPubkey = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: 'AAAA' },
      'visitor_2',
      keys.privateKeyPem
    );
    assert.equal(shortPubkey.status, 401);
    assert.equal(shortPubkey.data.error, 'invalid_pubkey');

    const wrongPubkey = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: otherKeys.pubkey },
      'visitor_3',
      keys.privateKeyPem
    );
    assert.equal(wrongPubkey.status, 401);
    assert.equal(wrongPubkey.data.error, 'invalid_signature');
  } finally {
    await ctx.close();
  }
});

test('resident fish cast rejects replayed nonce and stale timestamps', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');

    const signed = signRequest({
      method: 'POST',
      path: '/api/town/fish/cast',
      body: {},
      handle: 'alice',
      privateKeyPem: keys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const first = await fetch(`${ctx.baseUrl}/api/town/fish/cast`, {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
    });
    assert.equal(first.status, 201);

    const replay = await fetch(`${ctx.baseUrl}/api/town/fish/cast`, {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
    });
    assert.equal(replay.status, 401);
    const replayData = await replay.json();
    assert.equal(replayData.error, 'replayed_nonce');

    for (const delta of [-121, 121]) {
      const stale = signRequest({
        method: 'POST',
        path: '/api/town/fish/cast',
        body: {},
        handle: 'alice',
        privateKeyPem: keys.privateKeyPem,
        timestamp: ctx.nowSec() + delta,
      });
      const res = await fetch(`${ctx.baseUrl}/api/town/fish/cast`, {
        method: 'POST',
        headers: stale.headers,
        body: stale.rawBody,
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'stale_timestamp');
    }
  } finally {
    await ctx.close();
  }
});

test('guest rate-limit bucket is per-handle across keypairs', async () => {
  const ctx = await startTestServer();
  try {
    const keysA = generateKeypair();
    const keysB = generateKeypair();

    const c1 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: keysA.pubkey },
      'visitor_1',
      keysA.privateKeyPem
    );
    assert.equal(c1.status, 201);
    ctx.advanceClock(310);
    const r1 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { pubkey: keysA.pubkey },
      'visitor_1',
      keysA.privateKeyPem
    );
    assert.equal(r1.status, 200);

    const c2 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: keysB.pubkey },
      'visitor_1',
      keysB.privateKeyPem
    );
    assert.equal(c2.status, 201);
    ctx.advanceClock(310);
    const r2 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/reel',
      { pubkey: keysB.pubkey },
      'visitor_1',
      keysB.privateKeyPem
    );
    assert.equal(r2.status, 200);

    const c3 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: keysA.pubkey },
      'visitor_1',
      keysA.privateKeyPem
    );
    assert.equal(c3.status, 429);
    assert.equal(c3.data.error, 'rate_limited');

    const otherHandle = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { pubkey: keysA.pubkey },
      'visitor_2',
      keysA.privateKeyPem
    );
    assert.equal(otherHandle.status, 201);
  } finally {
    await ctx.close();
  }
});

test('resident cast and reel ignore body.handle; guest explicit match succeeds', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');

    const cast = await signedPostAt(
      ctx,
      '/api/town/fish/cast',
      { handle: 'bob' },
      'alice',
      keys.privateKeyPem
    );
    assert.equal(cast.status, 201);
    assert.equal(cast.data.handle, 'alice');

    ctx.advanceClock(300);
    const reel = await signedPostAt(
      ctx,
      '/api/town/fish/reel',
      { handle: 'bob' },
      'alice',
      keys.privateKeyPem
    );
    assert.equal(reel.status, 200);
    assert.equal(reel.data.handle, 'alice');

    const guestKeys = generateKeypair();
    const guestCast = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(guestCast.status, 201);
    assert.equal(guestCast.data.handle, 'visitor_1');
  } finally {
    await ctx.close();
  }
});

test('wrong-method and unknown fish routes return 404; log ignores extra query params', async () => {
  const ctx = await startTestServer();
  try {
    const postLog = await fetch(`${ctx.baseUrl}/api/town/fish/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(postLog.status, 404);
    assert.deepEqual(await postLog.json(), { error: 'not_found' });

    const getCast = await fetch(`${ctx.baseUrl}/api/town/fish/cast`);
    assert.equal(getCast.status, 404);
    assert.deepEqual(await getCast.json(), { error: 'not_found' });

    const postTypo = await fetch(`${ctx.baseUrl}/api/town/fish/castt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(postTypo.status, 404);
    assert.deepEqual(await postTypo.json(), { error: 'not_found' });

    const putCast = await fetch(`${ctx.baseUrl}/api/town/fish/cast`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(putCast.status, 404);
    assert.deepEqual(await putCast.json(), { error: 'not_found' });

    const extraParams = await fetch(`${ctx.baseUrl}/api/town/fish/log?handle=alice&foo=bar&handle2=x`);
    assert.equal(extraParams.status, 200);
    assert.deepEqual(await extraParams.json(), { handle: 'alice', catches: [], count: 0 });
  } finally {
    await ctx.close();
  }
});

test('source freeze for settle and fish rate limits; casts never expire', async () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  assert.ok(serverSrc.includes('const SETTLE_SEC = 300;'));
  assert.ok(serverSrc.includes('fishCast: { max: 10, windowSec: 60 * 60 }'));
  assert.ok(serverSrc.includes('guestFishCast: { max: 2, windowSec: 60 * 60 }'));

  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');
    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast.status, 201);

    ctx.advanceClock(10000);
    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel.status, 200);
    assert.equal(reel.data.caught_at, cast.data.cast_at + 10000);
  } finally {
    await ctx.close();
  }
});

test('resident fish 429 exact retry_after 500 and no consume on repeat', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');

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
    assert.deepEqual(Object.keys(eleventh.data).sort(), ['error', 'retry_after']);
    assert.equal(eleventh.data.error, 'rate_limited');
    assert.equal(eleventh.data.retry_after, 500);

    const twelfth = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(twelfth.status, 429);
    assert.equal(twelfth.data.error, 'rate_limited');
    assert.equal(twelfth.data.retry_after, 500);
  } finally {
    await ctx.close();
  }
});

test('guest fish 429 exact retry_after 2980 and no consume on repeat', async () => {
  const ctx = await startTestServer();
  try {
    const guestKeys = generateKeypair();

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
    ctx.advanceClock(10);

    const c3 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(c3.status, 429);
    assert.deepEqual(Object.keys(c3.data).sort(), ['error', 'retry_after']);
    assert.equal(c3.data.error, 'rate_limited');
    assert.equal(c3.data.retry_after, 2980);

    const c4 = await signedPostAt(
      ctx,
      '/api/town/fish/guest/cast',
      { handle: 'visitor_1', pubkey: guestKeys.pubkey },
      'visitor_1',
      guestKeys.privateKeyPem
    );
    assert.equal(c4.status, 429);
    assert.equal(c4.data.error, 'rate_limited');
    assert.equal(c4.data.retry_after, 2980);
  } finally {
    await ctx.close();
  }
});

test('fish_casts and fish_catches PRAGMA table_info exact shapes plus the handle index', async () => {
  const ctx = await startTestServer();
  try {
    const castsInfo = ctx.db.prepare('PRAGMA table_info(fish_casts)').all().map((r) => ({ ...r }));
    assert.deepEqual(castsInfo, [
      { cid: 0, name: 'handle', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
      { cid: 1, name: 'cast_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 2, name: 'reel_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
    ]);

    const catchesInfo = ctx.db.prepare('PRAGMA table_info(fish_catches)').all().map((r) => ({ ...r }));
    assert.deepEqual(catchesInfo, [
      { cid: 0, name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
      { cid: 1, name: 'handle', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 2, name: 'kind', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 3, name: 'label', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 4, name: 'flavor', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 5, name: 'created_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
    ]);

    const indexMaster = ctx.db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'fish_catches'")
      .all()
      .map((r) => ({ ...r }));
    assert.deepEqual(indexMaster, [
      {
        name: 'idx_fish_catches_handle',
        sql: 'CREATE INDEX idx_fish_catches_handle ON fish_catches (handle, created_at DESC)',
      },
    ]);

    const indexList = ctx.db.prepare('PRAGMA index_list(fish_catches)').all().map((r) => ({ ...r }));
    assert.deepEqual(indexList, [
      { seq: 0, name: 'idx_fish_catches_handle', unique: 0, origin: 'c', partial: 0 },
    ]);
  } finally {
    await ctx.close();
  }
});

test('town.json fish entries exact: 5 endpoints, verbatim summaries', () => {
  const townJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'town.json'), 'utf8'));
  const fishEndpoints = townJson.endpoints.filter((e) => e.path.startsWith('/api/town/fish'));
  assert.equal(fishEndpoints.length, 5);
  assert.deepEqual(fishEndpoints, [
    {
      method: 'POST',
      path: '/api/town/fish/cast',
      auth: 'signed',
      rate_limit: '10/hour',
      summary: 'Cast a fishing line at the lake (active resident, muted -> 403 resident_muted; one active cast per handle -> 409 already_cast; 300s settle window; returns 201 { handle, cast_at, reel_at }; does not bump state_seq).',
    },
    {
      method: 'POST',
      path: '/api/town/fish/reel',
      auth: 'signed',
      rate_limit: null,
      summary: 'Reel in an active fishing line after the 300s settle window (active resident, muted -> 403 resident_muted; 404 no_active_cast if none, 409 line_settling before reel_at; returns 200 { handle, catch, caught_at }; does not bump state_seq).',
    },
    {
      method: 'POST',
      path: '/api/town/fish/guest/cast',
      auth: 'signed',
      rate_limit: '2/hour',
      summary: 'Guest-mode cast at the lake with body pubkey (409 handle_taken if handle belongs to a resident; one active cast per handle -> 409 already_cast; 300s settle window; returns 201 { handle, cast_at, reel_at }).',
    },
    {
      method: 'POST',
      path: '/api/town/fish/guest/reel',
      auth: 'signed',
      rate_limit: null,
      summary: 'Guest-mode reel with body pubkey after the 300s settle window (409 handle_taken on resident handle, 404 no_active_cast if none, 409 line_settling before reel_at; returns 200 { handle, catch, caught_at }).',
    },
    {
      method: 'GET',
      path: '/api/town/fish/log',
      auth: 'public',
      rate_limit: null,
      summary: 'Fetch a resident\'s or guest\'s personal catch log (?handle= required, 400 invalid_handle if missing/bad; latest first, cap 50; empty list for no catches — a personal collection to show, NOT a score or leaderboard).',
    },
  ]);
});

test('SKILL.md fish sections verbatim', () => {
  const skillMd = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  const expected = [
    '### `POST /api/town/fish/cast`',
    '- **Auth:** signed, `active` residents (`client.fishCast()`; muted residents receive `403 resident_muted`).',
    '- **Response:** `201` `{ handle, cast_at, reel_at }` (`reel_at = cast_at + 300`, 5-minute settle). Does not bump `state_seq`.',
    '- **Rate limit:** 10/hour per resident. **Errors:** `401`, `403` (`resident_not_active`, `resident_muted`), `409` (`already_cast`), `429`.',
    '### `POST /api/town/fish/reel`',
    '- **Auth:** signed, `active` residents (`client.fishReel()`; muted residents receive `403 resident_muted`).',
    '- **Response:** `200` `{ handle, catch: { kind, label, flavor }, caught_at }`. Does not bump `state_seq`.',
    '- **Rate limit:** none (consumes one active cast). **Errors:** `401`, `403` (`resident_not_active`, `resident_muted`), `404` (`no_active_cast`), `409` (`line_settling`).',
    '### `POST /api/town/fish/guest/cast`',
    '- **Auth:** guest-mode signed with body `pubkey` (`409 handle_taken` if handle belongs to a resident).',
    '- **Rate limit:** 2/hour per guest handle. **Errors:** `400` (`invalid_handle`, `missing_pubkey`), `401`, `409` (`handle_taken`, `already_cast`), `429`.',
    '### `POST /api/town/fish/guest/reel`',
    '- **Response:** `200` `{ handle, catch: { kind, label, flavor }, caught_at }`.',
    '### `GET /api/town/fish/log?handle=<handle>`',
    '- **Auth:** public (`client.fishLog(handle)`). Query `?handle=<handle>` is required.',
    '- **Response:** `200` `{ handle, catches: [{ kind, label, flavor, caught_at }], count }` (latest first, cap 50; empty list if no catches). Personal collection only — NOT a score or leaderboard.',
    'Cast a line at the lake with `POST /api/town/fish/cast` (`201`, `reel_at` = cast + 5 minutes / 300 s), wait for the line to settle, and reel in with `POST /api/town/fish/reel` (`409 line_settling` before `reel_at`, `404 no_active_cast` if no line is out, `200` with a silly catch). Only one active cast per handle is allowed at a time. Catches land in your personal catch log (`GET /api/town/fish/log?handle=<handle>`, latest first, cap 50) — a personal collection to show, **NOT** a score or leaderboard (no grind, per Founding Law). Guests can fish too via `POST /api/town/fish/guest/cast` and `POST /api/town/fish/guest/reel` with a tighter limit (2 casts/hour vs 10 casts/hour for residents).',
  ];
  for (const snippet of expected) {
    assert.ok(skillMd.includes(snippet), `SKILL.md missing: ${snippet}`);
  }
});

test('mute and suspend beat an active cast; the cast survives; restore reels', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await joinResident(ctx, 'alice');
    const bob = await joinResident(ctx, 'bob');

    const aliceCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(aliceCast.status, 201);
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = 'alice'").run();

    const mutedCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(mutedCast.status, 403);
    assert.equal(mutedCast.data.error, 'resident_muted');

    const mutedReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(mutedReel.status, 403);
    assert.equal(mutedReel.data.error, 'resident_muted');

    const aliceRow = { ...ctx.db.prepare("SELECT cast_at, reel_at FROM fish_casts WHERE handle = 'alice'").get() };
    assert.deepEqual(aliceRow, { cast_at: aliceCast.data.cast_at, reel_at: aliceCast.data.reel_at });

    ctx.db.prepare("UPDATE residents SET status = 'active' WHERE handle = 'alice'").run();
    ctx.advanceClock(300);
    const aliceReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', alice.keys.privateKeyPem);
    assert.equal(aliceReel.status, 200);

    const bobCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'bob', bob.keys.privateKeyPem);
    assert.equal(bobCast.status, 201);
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = 'bob'").run();

    const suspCast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'bob', bob.keys.privateKeyPem);
    assert.equal(suspCast.status, 403);
    assert.equal(suspCast.data.error, 'resident_not_active');

    const suspReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'bob', bob.keys.privateKeyPem);
    assert.equal(suspReel.status, 403);
    assert.equal(suspReel.data.error, 'resident_not_active');

    const bobRow = { ...ctx.db.prepare("SELECT cast_at, reel_at FROM fish_casts WHERE handle = 'bob'").get() };
    assert.deepEqual(bobRow, { cast_at: bobCast.data.cast_at, reel_at: bobCast.data.reel_at });

    ctx.db.prepare("UPDATE residents SET status = 'active' WHERE handle = 'bob'").run();
    ctx.advanceClock(300);
    const bobReel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'bob', bob.keys.privateKeyPem);
    assert.equal(bobReel.status, 200);
  } finally {
    await ctx.close();
  }
});

async function signedPostWithTimestamp(ctx, endpoint, payload, handle, privateKeyPem, timestamp) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle,
    privateKeyPem,
    timestamp,
  });
  const res = await fetch(`${ctx.baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

test('cast_at uses server now, not the signed timestamp', async () => {
  const origDateNow = Date.now;
  let fakeNowMs = origDateNow();
  Date.now = () => fakeNowMs;
  const ctx = await startTestServer({ nowFn: () => Math.floor(Date.now() / 1000) });
  try {
    const now = Math.floor(fakeNowMs / 1000);
    const alice = await joinResident(ctx, 'alice');
    const bob = await joinResident(ctx, 'bob');

    const aliceCast = await signedPostWithTimestamp(
      ctx,
      '/api/town/fish/cast',
      {},
      'alice',
      alice.keys.privateKeyPem,
      now + 60
    );
    assert.equal(aliceCast.status, 201);
    assert.equal(aliceCast.data.cast_at, now);
    assert.equal(aliceCast.data.reel_at, now + 300);

    const bobCast = await signedPostWithTimestamp(
      ctx,
      '/api/town/fish/cast',
      {},
      'bob',
      bob.keys.privateKeyPem,
      now - 60
    );
    assert.equal(bobCast.status, 201);
    assert.equal(bobCast.data.cast_at, now);
    assert.equal(bobCast.data.reel_at, now + 300);
  } finally {
    Date.now = origDateNow;
    await ctx.close();
  }
});

test('drawFishCatch source freeze: roll, poem fallback, last-entry fallback, one call site', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  assert.ok(src.includes('function drawFishCatch() {'));
  assert.ok(src.includes('  const roll = crypto.randomInt(0, 100);'));
  assert.ok(src.includes('    if (roll < acc) {'));
  assert.ok(src.includes('      const flavor = entry.flavor ?? POEM_BOTTLE_LINES[crypto.randomInt(0, POEM_BOTTLE_LINES.length)];'));
  assert.ok(src.includes('  const last = FISH_CATCH_TABLE[FISH_CATCH_TABLE.length - 1];'));
  assert.ok(src.includes('  return { kind: last.kind, label: last.label, flavor: last.flavor };'));
  assert.ok(src.includes('const FISH_CATCH_TABLE = Object.freeze(['));
  assert.ok(src.includes('    const caught = drawFishCatch();'));

  assert.equal(src.split('drawFishCatch()').length - 1, 2);
  assert.equal(src.split('crypto.randomInt(0, 100)').length - 1, 1);
  assert.equal(src.split('POEM_BOTTLE_LINES[crypto.randomInt').length - 1, 1);
});

test('GhostlightClient fish methods source freeze', () => {
  const client = fs.readFileSync(path.join(__dirname, 'ghostlight-client.mjs'), 'utf8');
  assert.ok(client.includes('/** Cast a fishing line at the lake (5-minute settle before reeling). */'));
  assert.ok(client.includes('  async fishCast() {'));
  assert.ok(client.includes("    return this._signedPost('/api/town/fish/cast', {});"));
  assert.ok(client.includes('/** Reel in an active fishing line after the settle window. */'));
  assert.ok(client.includes('  async fishReel() {'));
  assert.ok(client.includes("    return this._signedPost('/api/town/fish/reel', {});"));
  assert.ok(client.includes("/** Fetch a resident's or guest's personal catch log (public). */"));
  assert.ok(client.includes('  async fishLog(handle) {'));
  assert.ok(client.includes('/api/town/fish/log${qs}'));

  assert.deepEqual(client.match(/async fish\w+\(/g), [
    'async fishCast(',
    'async fishReel(',
    'async fishLog(',
  ]);
});

test('file hygiene: 47 unique names, 8 imports, zero banned terms, pinned as-true counts', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-fish.mjs'), 'utf8');
  const lines = src.split('\n');

  const names = [];
  for (const line of lines) {
    const m = line.match(/^test\('([^']+)'/);
    if (m) names.push(m[1]);
  }
  assert.equal(names.length, 57);
  assert.equal(new Set(names).size, 57);

  assert.equal(lines.filter((l) => l.startsWith('import ')).length, 8);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 17);
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 23);
  assert.equal(lines.filter((l) => new RegExp('Math' + '.random').test(l)).length, 0);
});

test('fish error bodies carry exact key sets: already_cast, line_settling, no_active_cast', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');
    const cast1 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast1.status, 201);
    const dup = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(dup.status, 409);
    assert.deepEqual(Object.keys(dup.data).sort(), ['cast_at', 'error', 'reel_at']);
    const early = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(early.status, 409);
    assert.deepEqual(Object.keys(early.data).sort(), ['error', 'reel_at']);
    const { keys: bk } = await joinResident(ctx, 'bob');
    const noCast = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'bob', bk.privateKeyPem);
    assert.equal(noCast.status, 404);
    assert.deepEqual(Object.keys(noCast.data).sort(), ['error']);
    const gk = generateKeypair();
    const gcast = await signedPostAt(ctx, '/api/town/fish/guest/cast', { handle: 'gwen', pubkey: gk.pubkey }, 'gwen', gk.privateKeyPem);
    assert.equal(gcast.status, 201);
    const gdup = await signedPostAt(ctx, '/api/town/fish/guest/cast', { handle: 'gwen', pubkey: gk.pubkey }, 'gwen', gk.privateKeyPem);
    assert.equal(gdup.status, 409);
    assert.deepEqual(Object.keys(gdup.data).sort(), ['cast_at', 'error', 'reel_at']);
  } finally {
    await ctx.close();
  }
});

test('reeling does not refund the cast budget: resident 10 plus guest 2', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');
    for (let i = 0; i < 10; i++) {
      const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
      assert.equal(cast.status, 201);
      ctx.advanceClock(300);
      const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
      assert.equal(reel.status, 200);
    }
    const over = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(over.status, 429);
    assert.deepEqual(Object.keys(over.data).sort(), ['error', 'retry_after']);
    assert.ok(over.data.retry_after === 600 || over.data.retry_after === 599);
    const gk = generateKeypair();
    const gcast = () => signedPostAt(ctx, '/api/town/fish/guest/cast', { handle: 'gwen', pubkey: gk.pubkey }, 'gwen', gk.privateKeyPem);
    const greel = () => signedPostAt(ctx, '/api/town/fish/guest/reel', { handle: 'gwen', pubkey: gk.pubkey }, 'gwen', gk.privateKeyPem);
    for (let i = 0; i < 2; i++) {
      assert.equal((await gcast()).status, 201);
      ctx.advanceClock(300);
      assert.equal((await greel()).status, 200);
    }
    const gover = await gcast();
    assert.equal(gover.status, 429);
    assert.ok(gover.data.retry_after === 3000 || gover.data.retry_after === 2999);
  } finally {
    await ctx.close();
  }
});

test('muted cast consumes no quota and state_seq stays put', async () => {
  const ctx = await startTestServer();
  try {
    const { keys, client } = await joinResident(ctx, 'alice');
    const before = await client.state();
    const seq0 = before.data.state_seq;
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = 'alice'").run();
    const m1 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(m1.status, 403);
    assert.equal(m1.data.error, 'resident_muted');
    const m2 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(m2.status, 403);
    ctx.db.prepare("UPDATE residents SET status = 'active' WHERE handle = 'alice'").run();
    for (let i = 0; i < 10; i++) {
      const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
      assert.equal(cast.status, 201);
      ctx.advanceClock(300);
      const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
      assert.equal(reel.status, 200);
    }
    const over = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(over.status, 429);
    const after = await client.state();
    assert.equal(after.data.state_seq, seq0);
  } finally {
    await ctx.close();
  }
});

test('cast and catch survive server restart; rate buckets do not', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-fish-restart-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clock = Math.floor(new Date().getTime() / 1000);
  const nowFn = () => clock;
  let current = null;
  async function boot() {
    const { server, db } = createTownServer({ dbPath, plotsDir, operatorPubkey: operatorKeys.pubkey, nowFn });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    current = server;
    return { baseUrl: `http://127.0.0.1:${port}`, db };
  }
  async function closeServer() {
    if (!current) return;
    const s = current;
    current = null;
    await new Promise((resolve) => s.close(resolve));
  }
  let srv = await boot();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({ baseUrl: srv.baseUrl, handle: 'alice', ...keys });
    assert.equal((await client.join({ origin: 'direct' })).status, 201);
    const castAt = clock;
    const cast = await signedPostAt({ baseUrl: srv.baseUrl, nowSec: () => clock }, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast.status, 201);
    assert.equal(cast.data.cast_at, castAt);
    await closeServer();
    srv = await boot();
    clock += 300;
    const reel = await signedPostAt({ baseUrl: srv.baseUrl, nowSec: () => clock }, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel.status, 200);
    assert.equal(reel.data.caught_at, clock);
    const client2 = new GhostlightClient({ baseUrl: srv.baseUrl, handle: 'alice', ...keys });
    const log = await client2.fishLog('alice');
    assert.equal(log.status, 200);
    assert.equal(log.data.count, 1);
    for (let i = 0; i < 10; i++) {
      const c = await signedPostAt({ baseUrl: srv.baseUrl, nowSec: () => clock }, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
      assert.equal(c.status, 201, `post-restart cast ${i}`);
      clock += 300;
      const r = await signedPostAt({ baseUrl: srv.baseUrl, nowSec: () => clock }, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
      assert.equal(r.status, 200, `post-restart reel ${i}`);
      clock -= 300;
    }
    const over = await signedPostAt({ baseUrl: srv.baseUrl, nowSec: () => clock }, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(over.status, 429);
    assert.ok(over.data.retry_after === 3600 || over.data.retry_after === 3599);
  } finally {
    await closeServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('guest line is shared by handle: resident reels it, guest endpoints then refuse', async () => {
  const ctx = await startTestServer();
  try {
    const gk = generateKeypair();
    const gcast = await signedPostAt(ctx, '/api/town/fish/guest/cast', { handle: 'bob', pubkey: gk.pubkey }, 'bob', gk.privateKeyPem);
    assert.equal(gcast.status, 201);
    const rk = generateKeypair();
    const rclient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...rk });
    assert.equal((await rclient.join({ origin: 'direct' })).status, 201);
    const rcast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'bob', rk.privateKeyPem);
    assert.equal(rcast.status, 409);
    assert.equal(rcast.data.error, 'already_cast');
    assert.equal(rcast.data.cast_at, gcast.data.cast_at);
    assert.equal(rcast.data.reel_at, gcast.data.reel_at);
    ctx.advanceClock(300);
    const rreel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'bob', rk.privateKeyPem);
    assert.equal(rreel.status, 200);
    const log = await rclient.fishLog('bob');
    assert.equal(log.status, 200);
    assert.equal(log.data.count, 1);
    const greel = await signedPostAt(ctx, '/api/town/fish/guest/reel', { handle: 'bob', pubkey: gk.pubkey }, 'bob', gk.privateKeyPem);
    assert.equal(greel.status, 409);
    assert.equal(greel.data.error, 'handle_taken');
    const gcast2 = await signedPostAt(ctx, '/api/town/fish/guest/cast', { handle: 'bob', pubkey: gk.pubkey }, 'bob', gk.privateKeyPem);
    assert.equal(gcast2.status, 409);
    assert.equal(gcast2.data.error, 'handle_taken');
  } finally {
    await ctx.close();
  }
});

test('fish_casts and fish_catches rows carry exact shapes and consecutive ids', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'alice');
    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast.status, 201);
    const castRow = { ...ctx.db.prepare('SELECT * FROM fish_casts WHERE handle = ?').get('alice') };
    assert.deepEqual(Object.keys(castRow).sort(), ['cast_at', 'handle', 'reel_at']);
    assert.equal(castRow.cast_at, cast.data.cast_at);
    assert.equal(castRow.reel_at, cast.data.reel_at);
    assert.equal(castRow.handle, 'alice');
    ctx.advanceClock(300);
    const reel1 = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel1.status, 200);
    ctx.advanceClock(600);
    const cast2 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast2.status, 201);
    ctx.advanceClock(300);
    const reel2 = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel2.status, 200);
    const rows = ctx.db.prepare('SELECT * FROM fish_catches WHERE handle = ? ORDER BY id ASC').all('alice').map((r) => ({ ...r }));
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['created_at', 'flavor', 'handle', 'id', 'kind', 'label']);
      assert.equal(typeof row.flavor, 'string');
      assert.ok(row.flavor.length > 0);
    }
    assert.equal(rows[1].id, rows[0].id + 1);
    assert.equal(rows[0].created_at, reel1.data.caught_at);
    assert.equal(rows[1].created_at, reel2.data.caught_at);
  } finally {
    await ctx.close();
  }
});

test('guest body.handle mismatch matrix: empty, other, boolean, array, object, zero', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const call = (handleVal, endpoint = '/api/town/fish/guest/cast') =>
      signedPostAt(ctx, endpoint, { handle: handleVal, pubkey: keys.pubkey }, 'visitor_1', keys.privateKeyPem);
    const empty = await call('');
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, 'invalid_handle');
    const upper = await call('OTHER');
    assert.equal(upper.status, 401);
    assert.equal(upper.data.error, 'handle_mismatch');
    const boolH = await call(true);
    assert.equal(boolH.status, 401);
    assert.equal(boolH.data.error, 'handle_mismatch');
    const arrH = await call([]);
    assert.equal(arrH.status, 401);
    assert.equal(arrH.data.error, 'handle_mismatch');
    const objH = await call({});
    assert.equal(objH.status, 401);
    assert.equal(objH.data.error, 'handle_mismatch');
    const zeroH = await call(0);
    assert.equal(zeroH.status, 400);
    assert.equal(zeroH.data.error, 'invalid_handle');
    const reelMis = await call('other', '/api/town/fish/guest/reel');
    assert.equal(reelMis.status, 401);
    assert.equal(reelMis.data.error, 'handle_mismatch');
    const ok = await signedPostAt(ctx, '/api/town/fish/guest/cast', { pubkey: keys.pubkey }, 'visitor_1', keys.privateKeyPem);
    assert.equal(ok.status, 201);
  } finally {
    await ctx.close();
  }
});

test('pending resident cannot fish; guest cast collides with a pending handle', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    ctx.db.prepare(
      `INSERT INTO residents (handle, pubkey, origin, status, role, bio, created_at)
       VALUES (?, ?, 'direct', 'pending', 'muse', '', ?)`
    ).run('pend_one', keys.pubkey, ctx.nowSec());
    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'pend_one', keys.privateKeyPem);
    assert.equal(cast.status, 403);
    assert.equal(cast.data.error, 'resident_not_active');
    assert.equal(cast.data.resident_status, 'pending');
    const reel = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'pend_one', keys.privateKeyPem);
    assert.equal(reel.status, 403);
    assert.equal(reel.data.error, 'resident_not_active');
    const gk = generateKeypair();
    const gcast = await signedPostAt(ctx, '/api/town/fish/guest/cast', { handle: 'pend_one', pubkey: gk.pubkey }, 'pend_one', gk.privateKeyPem);
    assert.equal(gcast.status, 409);
    assert.equal(gcast.data.error, 'handle_taken');
  } finally {
    await ctx.close();
  }
});

test('two catches log newest-first with exact caught_at values', async () => {
  const ctx = await startTestServer();
  try {
    const { keys, client } = await joinResident(ctx, 'alice');
    const cast1 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast1.status, 201);
    ctx.advanceClock(300);
    const reel1 = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel1.status, 200);
    ctx.advanceClock(600);
    const cast2 = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast2.status, 201);
    ctx.advanceClock(300);
    const reel2 = await signedPostAt(ctx, '/api/town/fish/reel', {}, 'alice', keys.privateKeyPem);
    assert.equal(reel2.status, 200);
    const log = await client.fishLog('alice');
    assert.equal(log.status, 200);
    assert.equal(log.data.count, 2);
    assert.equal(log.data.catches[0].caught_at, reel2.data.caught_at);
    assert.equal(log.data.catches[1].caught_at, reel1.data.caught_at);
    assert.equal(log.data.catches[0].caught_at - log.data.catches[1].caught_at, 900);
  } finally {
    await ctx.close();
  }
});

test('log stays empty while the line is out; guest buckets are per-handle', async () => {
  const ctx = await startTestServer();
  try {
    const { keys, client } = await joinResident(ctx, 'alice');
    const cast = await signedPostAt(ctx, '/api/town/fish/cast', {}, 'alice', keys.privateKeyPem);
    assert.equal(cast.status, 201);
    const log = await client.fishLog('alice');
    assert.equal(log.status, 200);
    assert.equal(log.data.count, 0);
    assert.deepEqual(log.data.catches, []);
    const g1 = generateKeypair();
    const g2 = generateKeypair();
    const gcast = (k, h) => signedPostAt(ctx, '/api/town/fish/guest/cast', { handle: h, pubkey: k.pubkey }, h, k.privateKeyPem);
    const greel = (k, h) => signedPostAt(ctx, '/api/town/fish/guest/reel', { handle: h, pubkey: k.pubkey }, h, k.privateKeyPem);
    for (let i = 0; i < 2; i++) {
      assert.equal((await gcast(g1, 'g_one')).status, 201);
      ctx.advanceClock(300);
      assert.equal((await greel(g1, 'g_one')).status, 200);
    }
    const over = await gcast(g1, 'g_one');
    assert.equal(over.status, 429);
    const other = await gcast(g2, 'g_two');
    assert.equal(other.status, 201);
  } finally {
    await ctx.close();
  }
});
