import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAY_SEC = 86400;

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-garden-test-'));
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

async function joinResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joined = await signedPostAt(
    ctx,
    '/api/town/join',
    { handle, pubkey: keys.pubkey, origin: 'direct' },
    handle,
    keys.privateKeyPem
  );
  assert.equal(joined.status, 201);
  return { client, keys };
}

test('fresh server state always includes garden { slots: [] } and planting bumps state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const st0 = await alice.state();
    assert.equal(st0.status, 200);
    assert.deepEqual(st0.data.garden, { slots: [] });
    const seqBefore = st0.data.state_seq;

    const p1 = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(p1.status, 201);
    assert.equal(p1.data.handle, 'alice');
    assert.equal(p1.data.slot, 0);
    assert.equal(p1.data.seed, 'moonflower');
    assert.equal(p1.data.stage, 'sprout');
    assert.equal(p1.data.state_seq, seqBefore + 1);

    const { keys: bobKeys } = await joinResident(ctx, 'bob');
    const p2 = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'tea_mint' },
      'bob',
      bobKeys.privateKeyPem
    );
    assert.equal(p2.status, 201);
    assert.equal(p2.data.slot, 1);

    const st1 = await alice.state();
    assert.equal(st1.status, 200);
    assert.equal(st1.data.garden.slots.length, 2);
    assert.deepEqual(st1.data.garden.slots.map((s) => s.slot), [0, 1]);
    for (const entry of st1.data.garden.slots) {
      assert.deepEqual(Object.keys(entry).sort(), ['handle', 'planted_at', 'seed', 'slot', 'stage']);
    }
    assert.equal(st1.data.garden.slots[0].handle, 'alice');
    assert.equal(st1.data.garden.slots[0].seed, 'moonflower');
    assert.equal(st1.data.garden.slots[0].stage, 'sprout');
    assert.equal(st1.data.garden.slots[1].handle, 'bob');
  } finally {
    await ctx.close();
  }
});

test('duplicate plant returns 409 already_planted and invalid seed returns 400 invalid_seed without bumping state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const { keys: bobKeys } = await joinResident(ctx, 'bob');
    const p1 = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'starwort' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(p1.status, 201);
    const seqAfterPlant = p1.data.state_seq;

    const dup = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error, 'already_planted');
    assert.equal(dup.data.slot, 0);
    assert.equal(dup.data.seed, 'starwort');
    assert.equal(dup.data.planted_at, p1.data.planted_at);

    for (const badPayload of [{ seed: '' }, { seed: 'rose' }, { seed: 123 }, {}]) {
      const bad = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        badPayload,
        'bob',
        bobKeys.privateKeyPem
      );
      assert.equal(bad.status, 400);
      assert.equal(bad.data.error, 'invalid_seed');
    }

    const st = await alice.state();
    assert.equal(st.data.state_seq, seqAfterPlant);
    assert.equal(st.data.garden.slots.length, 1);
  } finally {
    await ctx.close();
  }
});

test('bed full caps at 6 slots and rejects 7th resident with 409 bed_full', async () => {
  const ctx = await startTestServer();
  try {
    const seeds = ['moonflower', 'lantern_poppy', 'tea_mint', 'starwort', 'ghost_bell', 'silver_thyme'];
    for (let i = 0; i < 6; i++) {
      if (i > 0 && i % 4 === 0) ctx.advanceClock(3601);
      const { keys } = await joinResident(ctx, `gardener_${i}`);
      const res = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: seeds[i] },
        `gardener_${i}`,
        keys.privateKeyPem
      );
      assert.equal(res.status, 201);
      assert.equal(res.data.slot, i);
    }

    ctx.advanceClock(3601);
    const { keys: seventhKeys } = await joinResident(ctx, 'gardener_6');
    const full = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'gardener_6',
      seventhKeys.privateKeyPem
    );
    assert.equal(full.status, 409);
    assert.equal(full.data.error, 'bed_full');
  } finally {
    await ctx.close();
  }
});

test('growth stage derives deterministically over UTC days and caps at bloom (neglect-proof)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys } = await joinResident(ctx, 'alice');
    const planted = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'ghost_bell' },
      'alice',
      keys.privateKeyPem
    );
    assert.equal(planted.status, 201);

    const checkStage = async (days, expected) => {
      const st = await alice.state();
      assert.equal(st.data.garden.slots[0].stage, expected, `Expected ${expected} at +${days}d`);
    };

    await checkStage(0, 'sprout');
    ctx.advanceClock(1 * DAY_SEC);
    await checkStage(1, 'sprout');
    ctx.advanceClock(1 * DAY_SEC); // +2d
    await checkStage(2, 'leaf');
    ctx.advanceClock(1 * DAY_SEC); // +3d
    await checkStage(3, 'leaf');
    ctx.advanceClock(1 * DAY_SEC); // +4d
    await checkStage(4, 'bloom');
    ctx.advanceClock(26 * DAY_SEC); // +30d
    await checkStage(30, 'bloom');
  } finally {
    await ctx.close();
  }
});

test('guest plant, duplicate 409, invalid handle errors, and 2/hour rate limit', async () => {
  const ctx = await startTestServer();
  try {
    await joinResident(ctx, 'resident_taken');

    // Invalid guest handles mirror fish validateGuestHandle
    const guestKeys = generateKeypair();
    const badHandle = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'BAD!', pubkey: guestKeys.pubkey, seed: 'starwort' },
      'BAD!',
      guestKeys.privateKeyPem
    );
    assert.equal(badHandle.status, 400);
    assert.equal(badHandle.data.error, 'invalid_handle');

    const takenHandle = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'resident_taken', pubkey: guestKeys.pubkey, seed: 'starwort' },
      'resident_taken',
      guestKeys.privateKeyPem
    );
    assert.equal(takenHandle.status, 409);
    assert.equal(takenHandle.data.error, 'handle_taken');

    // 1st guest plant succeeds
    const g1 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_rose', pubkey: guestKeys.pubkey, seed: 'starwort' },
      'guest_rose',
      guestKeys.privateKeyPem
    );
    assert.equal(g1.status, 201);
    assert.equal(g1.data.slot, 0);
    assert.equal(g1.data.seed, 'starwort');

    // Duplicate guest plant -> 409 already_planted
    const gDup = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_rose', pubkey: guestKeys.pubkey, seed: 'moonflower' },
      'guest_rose',
      guestKeys.privateKeyPem
    );
    assert.equal(gDup.status, 409);
    assert.equal(gDup.data.error, 'already_planted');

    // 2nd distinct guest handle in the same hour succeeds
    const guest2Keys = generateKeypair();
    const g2 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_lily', pubkey: guest2Keys.pubkey, seed: 'silver_thyme' },
      'guest_lily',
      guest2Keys.privateKeyPem
    );
    assert.equal(g2.status, 201);
    assert.equal(g2.data.slot, 1);

    // 3rd distinct guest handle in the same hour -> 429 rate_limited
    const guest3Keys = generateKeypair();
    const g3 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_fern', pubkey: guest3Keys.pubkey, seed: 'tea_mint' },
      'guest_fern',
      guest3Keys.privateKeyPem
    );
    assert.equal(g3.status, 429);
    assert.equal(g3.data.error, 'rate_limited');
    assert.ok(g3.data.retry_after > 0);
  } finally {
    await ctx.close();
  }
});

test('muted resident plant returns 403 resident_muted', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await joinResident(ctx, 'muted_gardener');
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = ?").run('muted_gardener');

    const res = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'lantern_poppy' },
      'muted_gardener',
      keys.privateKeyPem
    );
    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'resident_muted');
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient gardenPlant and gardenGuestPlant round-trip', async () => {
  const ctx = await startTestServer();
  try {
    const { client: resClient } = await joinResident(ctx, 'planter');
    const r = await resClient.gardenPlant('lantern_poppy');
    assert.equal(r.status, 201);
    assert.equal(r.data.slot, 0);
    assert.equal(r.data.seed, 'lantern_poppy');

    const guestKeys = generateKeypair();
    const guestClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'guest_sprout', ...guestKeys });
    const g = await guestClient.gardenGuestPlant('guest_sprout', 'moonflower');
    assert.equal(g.status, 201);
    assert.equal(g.data.slot, 1);
    assert.equal(g.data.seed, 'moonflower');
  } finally {
    await ctx.close();
  }
});

test('test-garden.mjs and server.mjs garden code contain no random PRNG and no forbidden terms', () => {
  const testSrc = fs.readFileSync(path.join(__dirname, 'test-garden.mjs'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const mathRndRe = new RegExp('Math\\.' + 'random');
  const forbiddenRe = new RegExp('camp\\s*' + 'fire', 'i');
  assert.equal(mathRndRe.test(testSrc), false, 'test-garden.mjs must not use Math random');
  assert.equal(forbiddenRe.test(testSrc), false, 'test-garden.mjs must not mention forbidden term');
  assert.equal(mathRndRe.test(serverSrc), false, 'server.mjs must not use Math random');
  assert.equal(forbiddenRe.test(serverSrc), false, 'server.mjs must not mention forbidden term');
});
