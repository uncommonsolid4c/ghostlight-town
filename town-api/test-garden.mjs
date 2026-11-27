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

async function signedPostAt(ctx, endpoint, payload, handle, privateKeyPem, extraHeaders = {}) {
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
    headers: { ...extraHeaders, ...headers },
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

test('all six seeds plant with exact response keys and state_seq climbs by one per plant', async () => {
  const ctx = await startTestServer();
  try {
    const seeds = ['moonflower', 'lantern_poppy', 'tea_mint', 'starwort', 'ghost_bell', 'silver_thyme'];
    const residents = [];
    for (let i = 0; i < 6; i++) {
      if (i > 0 && i % 4 === 0) ctx.advanceClock(3601);
      residents.push(await joinResident(ctx, `planter_${i}`));
    }

    const st0 = await residents[0].client.state();
    assert.equal(st0.status, 200);
    const seqBefore = st0.data.state_seq;

    const plantedAts = [];
    for (let i = 0; i < seeds.length; i++) {
      const res = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: seeds[i] },
        `planter_${i}`,
        residents[i].keys.privateKeyPem
      );
      assert.equal(res.status, 201);
      assert.deepEqual(
        Object.keys(res.data).sort(),
        ['handle', 'planted_at', 'seed', 'slot', 'stage', 'state_seq']
      );
      assert.equal(res.data.stage, 'sprout');
      assert.equal(res.data.slot, i);
      assert.equal(res.data.seed, seeds[i]);
      assert.equal(res.data.handle, `planter_${i}`);
      assert.ok(Number.isInteger(res.data.planted_at));
      assert.equal(res.data.state_seq, seqBefore + i + 1);
      plantedAts.push(res.data.planted_at);
    }

    const st1 = await residents[0].client.state();
    assert.equal(st1.status, 200);
    assert.equal(st1.data.state_seq, seqBefore + 6);
    assert.deepEqual(st1.data.garden.slots.map((s) => s.slot), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(st1.data.garden.slots.map((s) => s.seed), seeds);
    assert.deepEqual(
      st1.data.garden.slots.map((s) => s.handle),
      ['planter_0', 'planter_1', 'planter_2', 'planter_3', 'planter_4', 'planter_5']
    );
    for (let i = 0; i < 6; i++) {
      assert.equal(st1.data.garden.slots[i].planted_at, plantedAts[i]);
    }
  } finally {
    await ctx.close();
  }
});

test('invalid seed is rejected before the already-planted check and never bumps state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const p1 = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(p1.status, 201);
    const seqAfter = p1.data.state_seq;

    for (const badSeed of ['rose', 'Moonflower', '', null, 123, ['moonflower']]) {
      const bad = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: badSeed },
        'alice',
        aliceKeys.privateKeyPem
      );
      assert.equal(bad.status, 400);
      assert.equal(bad.data.error, 'invalid_seed');
    }

    const st = await alice.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.state_seq, seqAfter);
    assert.equal(st.data.garden.slots.length, 1);
    assert.equal(st.data.garden.slots[0].seed, 'moonflower');
  } finally {
    await ctx.close();
  }
});

test('duplicate plant echoes the original plant and leaves the bed open for others', async () => {
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

    const dup = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(dup.status, 409);
    assert.deepEqual(dup.data, {
      error: 'already_planted',
      slot: 0,
      seed: 'starwort',
      planted_at: p1.data.planted_at,
    });

    const st = await alice.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.state_seq, p1.data.state_seq);

    const p2 = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'tea_mint' },
      'bob',
      bobKeys.privateKeyPem
    );
    assert.equal(p2.status, 201);
    assert.equal(p2.data.slot, 1);
  } finally {
    await ctx.close();
  }
});

test('bed-full error is exactly { error: bed_full } and state_seq does not move', async () => {
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
    }

    ctx.advanceClock(3601);
    const { client: seventhClient, keys: seventhKeys } = await joinResident(ctx, 'gardener_6');
    const stBefore = await seventhClient.state();
    assert.equal(stBefore.status, 200);
    const seqAfterJoin = stBefore.data.state_seq;

    const full = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'gardener_6',
      seventhKeys.privateKeyPem
    );
    assert.equal(full.status, 409);
    assert.deepEqual(full.data, { error: 'bed_full' });

    const stAfter = await seventhClient.state();
    assert.equal(stAfter.status, 200);
    assert.equal(stAfter.data.state_seq, seqAfterJoin);
    assert.equal(stAfter.data.garden.slots.length, 6);
  } finally {
    await ctx.close();
  }
});

test('growth stage flips at exact day boundaries', async () => {
  let now = 1795000000;
  const ctx = await startTestServer({ nowFn: () => now });
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
    assert.equal(planted.data.planted_at, 1795000000);

    now += 2 * DAY_SEC - 1;
    assert.equal((await alice.state()).data.garden.slots[0].stage, 'sprout');

    now += 1;
    assert.equal((await alice.state()).data.garden.slots[0].stage, 'leaf');

    now += 2 * DAY_SEC - 1;
    assert.equal((await alice.state()).data.garden.slots[0].stage, 'leaf');

    now += 1;
    assert.equal((await alice.state()).data.garden.slots[0].stage, 'bloom');

    now += 30 * DAY_SEC;
    assert.equal((await alice.state()).data.garden.slots[0].stage, 'bloom');
  } finally {
    await ctx.close();
  }
});

test('state shows mixed stages when residents plant on different days', async () => {
  let now = 1795000000;
  const ctx = await startTestServer({ nowFn: () => now });
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const { keys: bobKeys } = await joinResident(ctx, 'bob');

    const pAlice = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(pAlice.status, 201);

    now += 2 * DAY_SEC;
    const pBob = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'tea_mint' },
      'bob',
      bobKeys.privateKeyPem
    );
    assert.equal(pBob.status, 201);

    now += 2 * DAY_SEC;
    const st = await alice.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.garden.slots[0].handle, 'alice');
    assert.equal(st.data.garden.slots[0].stage, 'bloom');
    assert.equal(st.data.garden.slots[0].planted_at, 1795000000);
    assert.equal(st.data.garden.slots[1].handle, 'bob');
    assert.equal(st.data.garden.slots[1].stage, 'leaf');
    assert.equal(st.data.garden.slots[1].planted_at, 1795000000 + 2 * DAY_SEC);
  } finally {
    await ctx.close();
  }
});

test('guest plant without a body handle uses the signed handle', async () => {
  const ctx = await startTestServer();
  try {
    const guestKeys = generateKeypair();
    const g1 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { pubkey: guestKeys.pubkey, seed: 'tea_mint' },
      'guest_nobody',
      guestKeys.privateKeyPem
    );
    assert.equal(g1.status, 201);
    assert.equal(g1.data.handle, 'guest_nobody');
    assert.equal(g1.data.slot, 0);
    assert.equal(g1.data.seed, 'tea_mint');

    const guestClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'guest_nobody',
      ...guestKeys,
    });
    const st = await guestClient.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.garden.slots.length, 1);
    assert.equal(st.data.garden.slots[0].handle, 'guest_nobody');

    const guest2Keys = generateKeypair();
    const g2 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_x', pubkey: guest2Keys.pubkey, seed: 'rose' },
      'guest_x',
      guest2Keys.privateKeyPem
    );
    assert.equal(g2.status, 400);
    assert.equal(g2.data.error, 'invalid_seed');
  } finally {
    await ctx.close();
  }
});

test('guest plant on a full bed returns 409 bed_full, and the guest rate limit resets after an hour', async () => {
  const ctxA = await startTestServer();
  try {
    const seeds = ['moonflower', 'lantern_poppy', 'tea_mint', 'starwort', 'ghost_bell', 'silver_thyme'];
    for (let i = 0; i < 6; i++) {
      if (i > 0 && i % 4 === 0) ctxA.advanceClock(3601);
      const { keys } = await joinResident(ctxA, `full_${i}`);
      const res = await signedPostAt(
        ctxA,
        '/api/town/garden/plant',
        { seed: seeds[i] },
        `full_${i}`,
        keys.privateKeyPem
      );
      assert.equal(res.status, 201);
    }

    const lateKeys = generateKeypair();
    const late = await signedPostAt(
      ctxA,
      '/api/town/garden/guest/plant',
      { handle: 'guest_late', pubkey: lateKeys.pubkey, seed: 'moonflower' },
      'guest_late',
      lateKeys.privateKeyPem
    );
    assert.equal(late.status, 409);
    assert.deepEqual(late.data, { error: 'bed_full' });
  } finally {
    await ctxA.close();
  }

  const ctxB = await startTestServer();
  try {
    const keysA = generateKeypair();
    const ga = await signedPostAt(
      ctxB,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a', pubkey: keysA.pubkey, seed: 'moonflower' },
      'guest_a',
      keysA.privateKeyPem
    );
    assert.equal(ga.status, 201);
    assert.equal(ga.data.slot, 0);

    const keysB = generateKeypair();
    const gb = await signedPostAt(
      ctxB,
      '/api/town/garden/guest/plant',
      { handle: 'guest_b', pubkey: keysB.pubkey, seed: 'lantern_poppy' },
      'guest_b',
      keysB.privateKeyPem
    );
    assert.equal(gb.status, 201);
    assert.equal(gb.data.slot, 1);

    const keysC = generateKeypair();
    const gc1 = await signedPostAt(
      ctxB,
      '/api/town/garden/guest/plant',
      { handle: 'guest_c', pubkey: keysC.pubkey, seed: 'tea_mint' },
      'guest_c',
      keysC.privateKeyPem
    );
    assert.equal(gc1.status, 429);
    assert.equal(gc1.data.error, 'rate_limited');
    assert.ok(gc1.data.retry_after > 0);

    ctxB.advanceClock(3601);
    const gc2 = await signedPostAt(
      ctxB,
      '/api/town/garden/guest/plant',
      { handle: 'guest_c', pubkey: keysC.pubkey, seed: 'tea_mint' },
      'guest_c',
      keysC.privateKeyPem
    );
    assert.equal(gc2.status, 201);
    assert.equal(gc2.data.slot, 2);
  } finally {
    await ctxB.close();
  }
});

test('GARDEN_SEEDS table pins all six seeds and matches the 3D SEED_COLORS', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const gardenSrc = fs.readFileSync(path.join(__dirname, '..', 'staging-polyfork', 'garden.mjs'), 'utf8');

  assert.ok(serverSrc.includes('const GARDEN_SLOTS = 6;'));

  const expectedSeeds = [
    ['moonflower', 'Moonflower', '#dfe9ff'],
    ['lantern_poppy', 'Lantern Poppy', '#ff9a3c'],
    ['tea_mint', 'Tea Mint', '#7fb069'],
    ['starwort', 'Starwort', '#c9a7eb'],
    ['ghost_bell', 'Ghost Bell', '#a8d8ea'],
    ['silver_thyme', 'Silver Thyme', '#b8c4b0'],
  ];

  let prevIdx = -1;
  for (const [kind, label, color] of expectedSeeds) {
    const line = `Object.freeze({ kind: '${kind}', label: '${label}', color: '${color}' })`;
    const idx = serverSrc.indexOf(line);
    assert.ok(idx > prevIdx, `Expected ${line} in order in server.mjs`);
    prevIdx = idx;
    assert.ok(
      gardenSrc.includes(`${kind}: '${color}'`),
      `Expected SEED_COLORS in staging-polyfork/garden.mjs to include ${kind}: '${color}'`
    );
  }
});

test('guest plant response carries the exact keys and bumps state_seq by one', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await joinResident(ctx, 'alice');
    const st0 = await alice.state();
    assert.equal(st0.status, 200);
    const seqBefore = st0.data.state_seq;

    const guestKeys = generateKeypair();
    const res = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_rose', pubkey: guestKeys.pubkey, seed: 'starwort' },
      'guest_rose',
      guestKeys.privateKeyPem
    );
    assert.equal(res.status, 201);
    assert.deepEqual(
      Object.keys(res.data).sort(),
      ['handle', 'planted_at', 'seed', 'slot', 'stage', 'state_seq']
    );
    assert.equal(res.data.handle, 'guest_rose');
    assert.equal(res.data.slot, 0);
    assert.equal(res.data.seed, 'starwort');
    assert.equal(res.data.stage, 'sprout');
    assert.ok(Number.isInteger(res.data.planted_at));
    assert.equal(res.data.state_seq, seqBefore + 1);

    const st1 = await alice.state();
    assert.equal(st1.status, 200);
    assert.equal(st1.data.garden.slots.length, 1);
    assert.equal(st1.data.garden.slots[0].handle, 'guest_rose');
  } finally {
    await ctx.close();
  }
});

test('guest plant auth failures: missing pubkey 400, handle mismatch 401, wrong-key signature 401', async () => {
  const ctx = await startTestServer();
  try {
    const keysA = generateKeypair();
    const keysB = generateKeypair();

    const missingPubkey = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { seed: 'moonflower' },
      'guest_x',
      keysA.privateKeyPem
    );
    assert.equal(missingPubkey.status, 400);
    assert.equal(missingPubkey.data.error, 'missing_pubkey');

    const handleMismatch = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_other', pubkey: keysA.pubkey, seed: 'moonflower' },
      'guest_x',
      keysA.privateKeyPem
    );
    assert.equal(handleMismatch.status, 401);
    assert.equal(handleMismatch.data.error, 'handle_mismatch');

    const wrongKey = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { pubkey: keysA.pubkey, seed: 'moonflower' },
      'guest_x',
      keysB.privateKeyPem
    );
    assert.equal(wrongKey.status, 401);
    assert.equal(wrongKey.data.error, 'invalid_signature');
  } finally {
    await ctx.close();
  }
});

test('resident plant auth failures: unknown resident 401, unsigned 401, suspended 403', async () => {
  const ctx = await startTestServer();
  try {
    const unknownKeys = generateKeypair();
    const unknown = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'never_joined',
      unknownKeys.privateKeyPem
    );
    assert.equal(unknown.status, 401);
    assert.equal(unknown.data.error, 'unknown_resident');

    const unsignedRes = await fetch(`${ctx.baseUrl}/api/town/garden/plant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'moonflower' }),
    });
    const unsignedData = await unsignedRes.json();
    assert.equal(unsignedRes.status, 401);
    assert.equal(unsignedData.error, 'missing_auth_headers');

    const { keys: suspKeys } = await joinResident(ctx, 'suspended_gardener');
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('suspended_gardener');

    const suspended = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'suspended_gardener',
      suspKeys.privateKeyPem
    );
    assert.equal(suspended.status, 403);
    assert.deepEqual(suspended.data, {
      error: 'resident_not_active',
      resident_status: 'suspended',
    });
  } finally {
    await ctx.close();
  }
});

test('error precedence on a full bed: invalid seed, then already-planted, then bed-full', async () => {
  const ctx = await startTestServer();
  try {
    const seeds = ['moonflower', 'lantern_poppy', 'tea_mint', 'starwort', 'ghost_bell', 'silver_thyme'];
    const gardeners = [];
    for (let i = 0; i < 6; i++) {
      if (i > 0 && i % 4 === 0) ctx.advanceClock(3601);
      const joined = await joinResident(ctx, `gardener_${i}`);
      gardeners.push(joined);
      const res = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: seeds[i] },
        `gardener_${i}`,
        joined.keys.privateKeyPem
      );
      assert.equal(res.status, 201);
    }

    ctx.advanceClock(3601);
    const { client: seventhClient, keys: seventhKeys } = await joinResident(ctx, 'gardener_6');
    const stBefore = await seventhClient.state();
    assert.equal(stBefore.status, 200);
    const seqAfterJoin = stBefore.data.state_seq;
    const slot0PlantedAt = stBefore.data.garden.slots[0].planted_at;

    const badSeed = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'rose' },
      'gardener_6',
      seventhKeys.privateKeyPem
    );
    assert.equal(badSeed.status, 400);
    assert.deepEqual(badSeed.data, { error: 'invalid_seed' });

    const alreadyPlanted = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'tea_mint' },
      'gardener_0',
      gardeners[0].keys.privateKeyPem
    );
    assert.equal(alreadyPlanted.status, 409);
    assert.deepEqual(alreadyPlanted.data, {
      error: 'already_planted',
      slot: 0,
      seed: 'moonflower',
      planted_at: slot0PlantedAt,
    });

    const lateKeys = generateKeypair();
    const bedFull = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_late', pubkey: lateKeys.pubkey, seed: 'moonflower' },
      'guest_late',
      lateKeys.privateKeyPem
    );
    assert.equal(bedFull.status, 409);
    assert.deepEqual(bedFull.data, { error: 'bed_full' });

    const stAfter = await seventhClient.state();
    assert.equal(stAfter.status, 200);
    assert.equal(stAfter.data.state_seq, seqAfterJoin);
    assert.equal(stAfter.data.garden.slots.length, 6);
  } finally {
    await ctx.close();
  }
});

test('failed guest attempts do not consume the 2-per-hour guest bucket', async () => {
  const ctx = await startTestServer();
  try {
    const keysA = generateKeypair();
    const keysB = generateKeypair();
    const keysC = generateKeypair();

    for (let i = 0; i < 2; i++) {
      const bad = await signedPostAt(
        ctx,
        '/api/town/garden/guest/plant',
        { handle: 'guest_a', pubkey: keysA.pubkey, seed: 'rose' },
        'guest_a',
        keysA.privateKeyPem
      );
      assert.equal(bad.status, 400);
      assert.equal(bad.data.error, 'invalid_seed');
    }

    const okA = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a', pubkey: keysA.pubkey, seed: 'starwort' },
      'guest_a',
      keysA.privateKeyPem
    );
    assert.equal(okA.status, 201);
    assert.equal(okA.data.slot, 0);

    const dupA = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a', pubkey: keysA.pubkey, seed: 'moonflower' },
      'guest_a',
      keysA.privateKeyPem
    );
    assert.equal(dupA.status, 409);
    assert.equal(dupA.data.error, 'already_planted');

    const okB = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_b', pubkey: keysB.pubkey, seed: 'tea_mint' },
      'guest_b',
      keysB.privateKeyPem
    );
    assert.equal(okB.status, 201);
    assert.equal(okB.data.slot, 1);

    const limitedC = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_c', pubkey: keysC.pubkey, seed: 'moonflower' },
      'guest_c',
      keysC.privateKeyPem
    );
    assert.equal(limitedC.status, 429);
    assert.equal(limitedC.data.error, 'rate_limited');
    assert.ok(limitedC.data.retry_after > 0 && limitedC.data.retry_after <= 3600);
  } finally {
    await ctx.close();
  }
});

test('resident and guest garden buckets are independent', async () => {
  const ctxA = await startTestServer();
  try {
    const keysA = generateKeypair();
    const ga = await signedPostAt(
      ctxA,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a', pubkey: keysA.pubkey, seed: 'moonflower' },
      'guest_a',
      keysA.privateKeyPem
    );
    assert.equal(ga.status, 201);
    assert.equal(ga.data.slot, 0);

    const keysB = generateKeypair();
    const gb = await signedPostAt(
      ctxA,
      '/api/town/garden/guest/plant',
      { handle: 'guest_b', pubkey: keysB.pubkey, seed: 'tea_mint' },
      'guest_b',
      keysB.privateKeyPem
    );
    assert.equal(gb.status, 201);
    assert.equal(gb.data.slot, 1);

    const { keys: resKeys } = await joinResident(ctxA, 'resident_planter');
    const resPlant = await signedPostAt(
      ctxA,
      '/api/town/garden/plant',
      { seed: 'starwort' },
      'resident_planter',
      resKeys.privateKeyPem
    );
    assert.equal(resPlant.status, 201);
    assert.equal(resPlant.data.slot, 2);

    const keysC = generateKeypair();
    const gc = await signedPostAt(
      ctxA,
      '/api/town/garden/guest/plant',
      { handle: 'guest_c', pubkey: keysC.pubkey, seed: 'ghost_bell' },
      'guest_c',
      keysC.privateKeyPem
    );
    assert.equal(gc.status, 429);
    assert.equal(gc.data.error, 'rate_limited');
  } finally {
    await ctxA.close();
  }

  const ctxB = await startTestServer();
  try {
    const { keys: firstKeys } = await joinResident(ctxB, 'first_resident');
    const first = await signedPostAt(
      ctxB,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'first_resident',
      firstKeys.privateKeyPem
    );
    assert.equal(first.status, 201);
    assert.equal(first.data.slot, 0);

    const keysA = generateKeypair();
    const ga = await signedPostAt(
      ctxB,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a', pubkey: keysA.pubkey, seed: 'tea_mint' },
      'guest_a',
      keysA.privateKeyPem
    );
    assert.equal(ga.status, 201);
    assert.equal(ga.data.slot, 1);

    const keysB = generateKeypair();
    const gb = await signedPostAt(
      ctxB,
      '/api/town/garden/guest/plant',
      { handle: 'guest_b', pubkey: keysB.pubkey, seed: 'starwort' },
      'guest_b',
      keysB.privateKeyPem
    );
    assert.equal(gb.status, 201);
    assert.equal(gb.data.slot, 2);

    const keysC = generateKeypair();
    const gc = await signedPostAt(
      ctxB,
      '/api/town/garden/guest/plant',
      { handle: 'guest_c', pubkey: keysC.pubkey, seed: 'ghost_bell' },
      'guest_c',
      keysC.privateKeyPem
    );
    assert.equal(gc.status, 429);
    assert.equal(gc.data.error, 'rate_limited');
  } finally {
    await ctxB.close();
  }
});

test('guest plant planted_at is server now and state entry carries the exact keys', async () => {
  let now = 1795000000;
  const ctx = await startTestServer({ nowFn: () => now });
  try {
    const guestKeys = generateKeypair();
    const res = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_timed', pubkey: guestKeys.pubkey, seed: 'ghost_bell' },
      'guest_timed',
      guestKeys.privateKeyPem
    );
    assert.equal(res.status, 201);
    assert.equal(res.data.planted_at, 1795000000);
    assert.equal(res.data.stage, 'sprout');

    const guestClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'guest_timed',
      ...guestKeys,
    });
    const st = await guestClient.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.garden.slots.length, 1);
    assert.deepEqual(
      Object.keys(st.data.garden.slots[0]).sort(),
      ['handle', 'planted_at', 'seed', 'slot', 'stage']
    );
    assert.equal(st.data.garden.slots[0].planted_at, 1795000000);
    assert.equal(st.data.garden.slots[0].stage, 'sprout');
    assert.equal(st.data.garden.slots[0].handle, 'guest_timed');
  } finally {
    await ctx.close();
  }
});

test('garden plants persist across a server restart on the same database', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-garden-restart-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  const nowFn = () => 1795000000;
  let s1 = null;
  let s2 = null;

  try {
    s1 = createTownServer({
      dbPath,
      plotsDir,
      operatorPubkey: operatorKeys.pubkey,
      nowFn,
    });
    await new Promise((resolve) => s1.server.listen(0, '127.0.0.1', resolve));
    const baseUrl1 = `http://127.0.0.1:${s1.server.address().port}`;
    const ctx1 = { baseUrl: baseUrl1, nowSec: nowFn };

    const { client: alice1, keys: aliceKeys } = await joinResident(ctx1, 'alice');
    const planted = await signedPostAt(
      ctx1,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(planted.status, 201);

    const st1 = await alice1.state();
    assert.equal(st1.status, 200);
    assert.equal(st1.data.garden.slots.length, 1);
    const seqBefore = st1.data.state_seq;
    const plantedAt = st1.data.garden.slots[0].planted_at;

    await new Promise((resolve) => s1.server.close(resolve));
    s1 = null;

    s2 = createTownServer({
      dbPath,
      plotsDir,
      operatorPubkey: operatorKeys.pubkey,
      nowFn,
    });
    await new Promise((resolve) => s2.server.listen(0, '127.0.0.1', resolve));
    const baseUrl2 = `http://127.0.0.1:${s2.server.address().port}`;

    const alice2 = new GhostlightClient({ baseUrl: baseUrl2, handle: 'alice', ...aliceKeys });
    const st2 = await alice2.state();
    assert.equal(st2.status, 200);
    assert.equal(st2.data.garden.slots.length, 1);
    assert.deepEqual(st2.data.garden.slots[0], {
      handle: 'alice',
      slot: 0,
      seed: 'moonflower',
      planted_at: plantedAt,
      stage: 'sprout',
    });
    assert.equal(st2.data.state_seq, seqBefore);
  } finally {
    if (s1) await new Promise((resolve) => s1.server.close(resolve));
    if (s2) await new Promise((resolve) => s2.server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('state?since= reflects a planting: 200 with garden after, 304 once caught up', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const st0 = await alice.state();
    assert.equal(st0.status, 200);
    assert.deepEqual(st0.data.garden, { slots: [] });
    const seq0 = st0.data.state_seq;

    const p1 = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(p1.status, 201);
    const seq1 = p1.data.state_seq;
    assert.equal(seq1, seq0 + 1);

    const stSince0 = await alice.state(seq0);
    assert.equal(stSince0.status, 200);
    assert.equal(stSince0.data.garden.slots.length, 1);
    assert.equal(stSince0.data.garden.slots[0].seed, 'moonflower');

    const stSince1 = await alice.state(seq1);
    assert.equal(stSince1.status, 304);
    assert.equal(stSince1.data, null);
  } finally {
    await ctx.close();
  }
});

test('guest garden bucket is per-IP via x-forwarded-for', async () => {
  const ctx = await startTestServer();
  try {
    const ipA = { 'x-forwarded-for': '203.0.113.7' };
    const ipB = { 'x-forwarded-for': '198.51.100.9' };

    const kA1 = generateKeypair();
    const a1 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a1', pubkey: kA1.pubkey, seed: 'moonflower' },
      'guest_a1',
      kA1.privateKeyPem,
      ipA
    );
    assert.equal(a1.status, 201);
    assert.equal(a1.data.slot, 0);

    const kA2 = generateKeypair();
    const a2 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a2', pubkey: kA2.pubkey, seed: 'tea_mint' },
      'guest_a2',
      kA2.privateKeyPem,
      ipA
    );
    assert.equal(a2.status, 201);
    assert.equal(a2.data.slot, 1);

    const kA3 = generateKeypair();
    const a3 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a3', pubkey: kA3.pubkey, seed: 'starwort' },
      'guest_a3',
      kA3.privateKeyPem,
      ipA
    );
    assert.equal(a3.status, 429);
    assert.equal(a3.data.error, 'rate_limited');

    const kB1 = generateKeypair();
    const b1 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_b1', pubkey: kB1.pubkey, seed: 'ghost_bell' },
      'guest_b1',
      kB1.privateKeyPem,
      ipB
    );
    assert.equal(b1.status, 201);
    assert.equal(b1.data.slot, 2);

    const kB2 = generateKeypair();
    const b2 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_b2', pubkey: kB2.pubkey, seed: 'silver_thyme' },
      'guest_b2',
      kB2.privateKeyPem,
      ipB
    );
    assert.equal(b2.status, 201);
    assert.equal(b2.data.slot, 3);
  } finally {
    await ctx.close();
  }
});

test('guest retry_after is exact and the sliding window resets at exactly +3600s', async () => {
  const T = 1795000000;
  let now = T;
  const ctx = await startTestServer({ nowFn: () => now });
  try {
    const k1 = generateKeypair();
    const p1 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_1', pubkey: k1.pubkey, seed: 'moonflower' },
      'guest_1',
      k1.privateKeyPem
    );
    assert.equal(p1.status, 201);
    assert.equal(p1.data.slot, 0);

    const k2 = generateKeypair();
    const p2 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_2', pubkey: k2.pubkey, seed: 'tea_mint' },
      'guest_2',
      k2.privateKeyPem
    );
    assert.equal(p2.status, 201);
    assert.equal(p2.data.slot, 1);

    const k3 = generateKeypair();
    const p3AtT = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_3', pubkey: k3.pubkey, seed: 'starwort' },
      'guest_3',
      k3.privateKeyPem
    );
    assert.equal(p3AtT.status, 429);
    assert.equal(p3AtT.data.error, 'rate_limited');
    assert.equal(p3AtT.data.retry_after, 3600);

    now = T + 3599;
    const p3BeforeReset = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_3', pubkey: k3.pubkey, seed: 'starwort' },
      'guest_3',
      k3.privateKeyPem
    );
    assert.equal(p3BeforeReset.status, 429);
    assert.equal(p3BeforeReset.data.error, 'rate_limited');
    assert.equal(p3BeforeReset.data.retry_after, 1);

    now = T + 3600;
    const p3AtReset = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_3', pubkey: k3.pubkey, seed: 'starwort' },
      'guest_3',
      k3.privateKeyPem
    );
    assert.equal(p3AtReset.status, 201);
    assert.equal(p3AtReset.data.slot, 2);
  } finally {
    await ctx.close();
  }
});

test('resident 10/hour gardenPlant limit never fires because duplicates stay 409 already_planted', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const first = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(first.status, 201);
    const seqAfterFirst = first.data.state_seq;

    for (let i = 0; i < 10; i++) {
      const dup = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: 'tea_mint' },
        'alice',
        aliceKeys.privateKeyPem
      );
      assert.equal(dup.status, 409);
      assert.equal(dup.data.error, 'already_planted');
    }

    const st = await alice.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.state_seq, seqAfterFirst);
    assert.equal(st.data.garden.slots.length, 1);
  } finally {
    await ctx.close();
  }
});

test('duplicate guest plant with a different keypair still returns 409 already_planted', async () => {
  const ctx = await startTestServer();
  try {
    const keysA = generateKeypair();
    const first = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_x', pubkey: keysA.pubkey, seed: 'starwort' },
      'guest_x',
      keysA.privateKeyPem
    );
    assert.equal(first.status, 201);
    assert.equal(first.data.slot, 0);
    assert.equal(first.data.seed, 'starwort');
    const originalPlantedAt = first.data.planted_at;

    const keysB = generateKeypair();
    const dup = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_x', pubkey: keysB.pubkey, seed: 'moonflower' },
      'guest_x',
      keysB.privateKeyPem
    );
    assert.equal(dup.status, 409);
    assert.deepEqual(dup.data, {
      error: 'already_planted',
      slot: 0,
      seed: 'starwort',
      planted_at: originalPlantedAt,
    });
  } finally {
    await ctx.close();
  }
});

test('guest handle validation edges: bad handles 400, 2 and 32 char bounds 201, empty signed handle 401', async () => {
  const ctx = await startTestServer();
  try {
    const badHandles = ['a', 'Guest', 'guest name', '-guest', '_guest', 'a'.repeat(33)];
    for (const bad of badHandles) {
      const keys = generateKeypair();
      const res = await signedPostAt(
        ctx,
        '/api/town/garden/guest/plant',
        { handle: bad, pubkey: keys.pubkey, seed: 'moonflower' },
        bad,
        keys.privateKeyPem
      );
      assert.equal(res.status, 400, `expected 400 for handle ${JSON.stringify(bad)}`);
      assert.equal(res.data.error, 'invalid_handle');
    }

    const keysEmpty = generateKeypair();
    const emptySigned = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: '', pubkey: keysEmpty.pubkey, seed: 'moonflower' },
      '',
      keysEmpty.privateKeyPem
    );
    assert.equal(emptySigned.status, 401);
    assert.equal(emptySigned.data.error, 'missing_auth_headers');

    const keysMin = generateKeypair();
    const minValid = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'ab', pubkey: keysMin.pubkey, seed: 'moonflower' },
      'ab',
      keysMin.privateKeyPem
    );
    assert.equal(minValid.status, 201);
    assert.equal(minValid.data.slot, 0);

    const maxHandle = 'a'.repeat(32);
    const keysMax = generateKeypair();
    const maxValid = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: maxHandle, pubkey: keysMax.pubkey, seed: 'tea_mint' },
      maxHandle,
      keysMax.privateKeyPem
    );
    assert.equal(maxValid.status, 201);
    assert.equal(maxValid.data.slot, 1);
  } finally {
    await ctx.close();
  }
});

test('body.handle null falls back to signed handle while empty string body.handle is 400 invalid_handle', async () => {
  const ctx = await startTestServer();
  try {
    const keysNull = generateKeypair();
    const resNull = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: null, pubkey: keysNull.pubkey, seed: 'tea_mint' },
      'guest_null',
      keysNull.privateKeyPem
    );
    assert.equal(resNull.status, 201);
    assert.equal(resNull.data.handle, 'guest_null');

    const keysEmpty = generateKeypair();
    const resEmpty = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: '', pubkey: keysEmpty.pubkey, seed: 'tea_mint' },
      'guest_empty',
      keysEmpty.privateKeyPem
    );
    assert.equal(resEmpty.status, 400);
    assert.equal(resEmpty.data.error, 'invalid_handle');
  } finally {
    await ctx.close();
  }
});

test('client-supplied slot, planted_at, and stage fields are ignored', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: aliceKeys } = await joinResident(ctx, 'alice');
    const resPlant = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower', slot: 5, planted_at: 1, stage: 'bloom' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(resPlant.status, 201);
    assert.equal(resPlant.data.slot, 0);
    assert.equal(resPlant.data.stage, 'sprout');
    assert.notEqual(resPlant.data.planted_at, 1);

    const guestKeys = generateKeypair();
    const guestPlant = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_y', pubkey: guestKeys.pubkey, seed: 'tea_mint', slot: 3, planted_at: 1, stage: 'bloom' },
      'guest_y',
      guestKeys.privateKeyPem
    );
    assert.equal(guestPlant.status, 201);
    assert.equal(guestPlant.data.slot, 1);
    assert.equal(guestPlant.data.stage, 'sprout');
    assert.notEqual(guestPlant.data.planted_at, 1);
  } finally {
    await ctx.close();
  }
});

test('malformed guest pubkey returns 401 invalid_pubkey', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const nonBase64 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_badkey1', pubkey: '!!!not-base64!!!', seed: 'moonflower' },
      'guest_badkey1',
      keys.privateKeyPem
    );
    assert.equal(nonBase64.status, 401);
    assert.equal(nonBase64.data.error, 'invalid_pubkey');

    const shortKey = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_badkey2', pubkey: Buffer.from('short').toString('base64'), seed: 'moonflower' },
      'guest_badkey2',
      keys.privateKeyPem
    );
    assert.equal(shortKey.status, 401);
    assert.equal(shortKey.data.error, 'invalid_pubkey');
  } finally {
    await ctx.close();
  }
});

test('garden stage is derived from the clock on read and tolerates clock rewind or negative age', async () => {
  const T = 1795000000;
  let now = T;
  const ctx = await startTestServer({ nowFn: () => now });
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const planted = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(planted.status, 201);
    assert.equal(planted.data.stage, 'sprout');

    now = T + 4 * DAY_SEC;
    const stBloom = await alice.state();
    assert.equal(stBloom.status, 200);
    assert.equal(stBloom.data.garden.slots[0].stage, 'bloom');

    now = T;
    const stRewind = await alice.state();
    assert.equal(stRewind.status, 200);
    assert.equal(stRewind.data.garden.slots[0].stage, 'sprout');

    now = T - DAY_SEC;
    const stNegative = await alice.state();
    assert.equal(stNegative.status, 200);
    assert.equal(stNegative.data.garden.slots[0].stage, 'sprout');
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient garden error round-trips and missing-pubkey guard', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await joinResident(ctx, 'alice');
    const resErr = await alice.gardenPlant('rose');
    assert.equal(resErr.status, 400);
    assert.equal(resErr.data.error, 'invalid_seed');

    const guestKeys = generateKeypair();
    const guestClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'guest_z',
      ...guestKeys,
    });
    const guestErr = await guestClient.gardenGuestPlant('guest_z', 'rose');
    assert.equal(guestErr.status, 400);
    assert.equal(guestErr.data.error, 'invalid_seed');

    const noKeyClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'guest_nokey',
    });
    await assert.rejects(
      () => noKeyClient.gardenGuestPlant('guest_nokey', 'moonflower'),
      (err) => err instanceof Error && err.message === 'pubkey is required for gardenGuestPlant()'
    );
  } finally {
    await ctx.close();
  }
});

test('guest handle validation runs before seed validation and failed attempts consume nothing', async () => {
  const ctx = await startTestServer();
  try {
    const { client: watcher } = await joinResident(ctx, 'watcher');
    await joinResident(ctx, 'alice');
    const seqBefore = (await watcher.state()).data.state_seq;

    const badKeys = generateKeypair();
    const badRes = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'BAD!', pubkey: badKeys.pubkey, seed: 'rose' },
      'BAD!',
      badKeys.privateKeyPem
    );
    assert.equal(badRes.status, 400);
    assert.deepEqual(badRes.data, { error: 'invalid_handle' });

    const takenKeys = generateKeypair();
    const takenRes = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'alice', pubkey: takenKeys.pubkey, seed: 'rose' },
      'alice',
      takenKeys.privateKeyPem
    );
    assert.equal(takenRes.status, 409);
    assert.deepEqual(takenRes.data, { error: 'handle_taken' });

    const gaKeys = generateKeypair();
    const ga = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a', pubkey: gaKeys.pubkey, seed: 'moonflower' },
      'guest_a',
      gaKeys.privateKeyPem
    );
    assert.equal(ga.status, 201);
    assert.equal(ga.data.slot, 0);

    const gbKeys = generateKeypair();
    const gb = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_b', pubkey: gbKeys.pubkey, seed: 'tea_mint' },
      'guest_b',
      gbKeys.privateKeyPem
    );
    assert.equal(gb.status, 201);
    assert.equal(gb.data.slot, 1);

    const gcKeys = generateKeypair();
    const gc = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_c', pubkey: gcKeys.pubkey, seed: 'starwort' },
      'guest_c',
      gcKeys.privateKeyPem
    );
    assert.equal(gc.status, 429);
    assert.equal(gc.data.error, 'rate_limited');

    const seqAfter = (await watcher.state()).data.state_seq;
    assert.equal(seqAfter, seqBefore + 2);
  } finally {
    await ctx.close();
  }
});

test('muted resident precedence beats invalid seed, already-planted, and bed-full', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: mutedOneKeys } = await joinResident(ctx, 'muted_one');
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = ?").run('muted_one');

    const badSeed = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'rose' },
      'muted_one',
      mutedOneKeys.privateKeyPem
    );
    assert.equal(badSeed.status, 403);
    assert.deepEqual(badSeed.data, { error: 'resident_muted' });

    const { keys: mutedTwoKeys } = await joinResident(ctx, 'muted_two');
    const first = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'muted_two',
      mutedTwoKeys.privateKeyPem
    );
    assert.equal(first.status, 201);
    assert.equal(first.data.slot, 0);

    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = ?").run('muted_two');
    const dupMuted = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'muted_two',
      mutedTwoKeys.privateKeyPem
    );
    assert.equal(dupMuted.status, 403);
    assert.deepEqual(dupMuted.data, { error: 'resident_muted' });

    const fillerSeeds = ['lantern_poppy', 'tea_mint', 'starwort', 'ghost_bell', 'silver_thyme'];
    for (let i = 0; i < fillerSeeds.length; i++) {
      if (i === 2) ctx.advanceClock(3601);
      const handle = `filler_${i + 1}`;
      const { keys } = await joinResident(ctx, handle);
      const planted = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: fillerSeeds[i] },
        handle,
        keys.privateKeyPem
      );
      assert.equal(planted.status, 201);
      assert.equal(planted.data.slot, i + 1);
    }

    const mutedOnFull = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'muted_one',
      mutedOneKeys.privateKeyPem
    );
    assert.equal(mutedOnFull.status, 403);
    assert.deepEqual(mutedOnFull.data, { error: 'resident_muted' });

    const { keys: controlKeys } = await joinResident(ctx, 'control_seven');
    const controlFull = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'control_seven',
      controlKeys.privateKeyPem
    );
    assert.equal(controlFull.status, 409);
    assert.deepEqual(controlFull.data, { error: 'bed_full' });
  } finally {
    await ctx.close();
  }
});

test('getClientIp edges: multi-value first entry, whitespace trim, and no-header socket bucket', async () => {
  const ctx = await startTestServer();
  try {
    const plantGuest = (handle, seed, headers = {}) => {
      const keys = generateKeypair();
      return signedPostAt(
        ctx,
        '/api/town/garden/guest/plant',
        { handle, pubkey: keys.pubkey, seed },
        handle,
        keys.privateKeyPem,
        headers
      );
    };

    const a1 = await plantGuest('ip_a1', 'moonflower', { 'x-forwarded-for': '203.0.113.7, 198.51.100.9' });
    assert.equal(a1.status, 201);
    assert.equal(a1.data.slot, 0);

    const a2 = await plantGuest('ip_a2', 'tea_mint', { 'x-forwarded-for': '203.0.113.7, 198.51.100.9' });
    assert.equal(a2.status, 201);
    assert.equal(a2.data.slot, 1);

    const a3 = await plantGuest('ip_a3', 'starwort', { 'x-forwarded-for': '203.0.113.7, 198.51.100.9' });
    assert.equal(a3.status, 429);
    assert.equal(a3.data.error, 'rate_limited');

    const b1 = await plantGuest('ip_b1', 'lantern_poppy', { 'x-forwarded-for': '198.51.100.9' });
    assert.equal(b1.status, 201);
    assert.equal(b1.data.slot, 2);

    const a4 = await plantGuest('ip_a4', 'ghost_bell', { 'x-forwarded-for': '  203.0.113.7  ' });
    assert.equal(a4.status, 429);
    assert.equal(a4.data.error, 'rate_limited');

    const n1 = await plantGuest('ip_n1', 'ghost_bell');
    assert.equal(n1.status, 201);
    assert.equal(n1.data.slot, 3);

    const n2 = await plantGuest('ip_n2', 'silver_thyme');
    assert.equal(n2.status, 201);
    assert.equal(n2.data.slot, 4);

    const n3 = await plantGuest('ip_n3', 'moonflower');
    assert.equal(n3.status, 429);
    assert.equal(n3.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('source pins: garden rate limits, slot loop, state SELECT, and schema DDL', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const schemaSrc = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  assert.ok(serverSrc.includes('  gardenPlant: { max: 10, windowSec: 60 * 60 },'));
  assert.ok(serverSrc.includes('  guestGardenPlant: { max: 2, windowSec: 60 * 60 },'));
  assert.ok(serverSrc.includes('for (let i = 0; i < GARDEN_SLOTS; i++)'));
  assert.ok(serverSrc.includes('SELECT slot, handle, seed, planted_at FROM garden_plants ORDER BY slot ASC'));

  const expectedDdl = [
    'CREATE TABLE IF NOT EXISTS garden_plants (',
    '    slot            INTEGER PRIMARY KEY CHECK (slot >= 0 AND slot <= 5),',
    '    handle          TEXT NOT NULL UNIQUE,',
    '    seed            TEXT NOT NULL,',
    '    planted_at      INTEGER NOT NULL',
    ');',
  ].join('\n');
  assert.ok(schemaSrc.includes(expectedDdl));
});

test('garden_plants DB row exact shape and PRAGMA table_info schema', async () => {
  let now = 1795000000;
  const ctx = await startTestServer({ nowFn: () => now });
  try {
    const { keys: aliceKeys } = await joinResident(ctx, 'alice');
    const p1 = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(p1.status, 201);

    now += 3600;
    const { keys: bobKeys } = await joinResident(ctx, 'bob');
    const p2 = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'tea_mint' },
      'bob',
      bobKeys.privateKeyPem
    );
    assert.equal(p2.status, 201);

    const rows = ctx.db
      .prepare('SELECT slot, handle, seed, planted_at FROM garden_plants ORDER BY slot ASC')
      .all()
      .map((r) => ({ ...r }));
    assert.deepEqual(rows, [
      { slot: 0, handle: 'alice', seed: 'moonflower', planted_at: 1795000000 },
      { slot: 1, handle: 'bob', seed: 'tea_mint', planted_at: 1795003600 },
    ]);

    const cols = ctx.db
      .prepare("PRAGMA table_info('garden_plants')")
      .all()
      .map((r) => ({ ...r }));
    assert.deepEqual(cols.map((c) => c.name), ['slot', 'handle', 'seed', 'planted_at']);
    assert.deepEqual(cols.map((c) => c.type), ['INTEGER', 'TEXT', 'TEXT', 'INTEGER']);
    assert.deepEqual(cols.map((c) => c.pk), [1, 0, 0, 0]);
    assert.deepEqual(cols.map((c) => c.notnull), [0, 1, 1, 1]);
  } finally {
    await ctx.close();
  }
});

test('guest plant does not create a resident so the handle stays joinable', async () => {
  const ctx = await startTestServer();
  try {
    const gKeys = generateKeypair();
    const planted = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_rose', pubkey: gKeys.pubkey, seed: 'starwort' },
      'guest_rose',
      gKeys.privateKeyPem
    );
    assert.equal(planted.status, 201);

    const { client } = await joinResident(ctx, 'guest_rose');
    const st = await client.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.garden.slots.length, 1);
    assert.equal(st.data.garden.slots[0].handle, 'guest_rose');
    assert.deepEqual(st.data.presence, []);
    assert.equal(st.data.footlights.some((f) => f.handle === 'guest_rose'), false);
  } finally {
    await ctx.close();
  }
});

test('guest plant drives state?since= like a resident plant', async () => {
  const ctx = await startTestServer();
  try {
    const { client: watcher } = await joinResident(ctx, 'watcher');
    const seqBefore = (await watcher.state()).data.state_seq;

    const gKeys = generateKeypair();
    const planted = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_since', pubkey: gKeys.pubkey, seed: 'moonflower' },
      'guest_since',
      gKeys.privateKeyPem
    );
    assert.equal(planted.status, 201);
    assert.equal(planted.data.state_seq, seqBefore + 1);

    const st200 = await watcher.state(seqBefore);
    assert.equal(st200.status, 200);
    assert.equal(st200.data.state_seq, seqBefore + 1);
    assert.equal(st200.data.garden.slots.length, 1);
    assert.equal(st200.data.garden.slots[0].handle, 'guest_since');

    const st304 = await watcher.state(seqBefore + 1);
    assert.equal(st304.status, 304);
    assert.equal(st304.data, null);
  } finally {
    await ctx.close();
  }
});

test('seed must match exactly and unknown extra body fields are ignored', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: aliceKeys } = await joinResident(ctx, 'alice');
    for (const badSeed of [' moonflower', 'moonflower ', 'MOONFLOWER', 'MoonFlower', 'moonflower\n']) {
      const r = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: badSeed },
        'alice',
        aliceKeys.privateKeyPem
      );
      assert.equal(r.status, 400);
      assert.deepEqual(r.data, { error: 'invalid_seed' });
    }

    const resOk = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower', note: 'hello', plot: 9, watered: true },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(resOk.status, 201);
    assert.equal(resOk.data.slot, 0);
    assert.equal(resOk.data.seed, 'moonflower');
    assert.deepEqual(
      Object.keys(resOk.data).sort(),
      ['handle', 'planted_at', 'seed', 'slot', 'stage', 'state_seq']
    );

    const gxKeys = generateKeypair();
    const gx = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_x', pubkey: gxKeys.pubkey, seed: 'tea_mint' },
      'guest_x',
      gxKeys.privateKeyPem
    );
    assert.equal(gx.status, 201);
    assert.equal(gx.data.slot, 1);

    const gyKeys = generateKeypair();
    const gy = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_y', pubkey: gyKeys.pubkey, seed: 'starwort', note: 'hi' },
      'guest_y',
      gyKeys.privateKeyPem
    );
    assert.equal(gy.status, 201);
    assert.equal(gy.data.slot, 2);
  } finally {
    await ctx.close();
  }
});

test('guest duplicate on a full bed echoes the original because already_planted beats bed_full', async () => {
  const ctx = await startTestServer();
  try {
    const g1Keys = generateKeypair();
    const g1 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_full', pubkey: g1Keys.pubkey, seed: 'starwort' },
      'guest_full',
      g1Keys.privateKeyPem
    );
    assert.equal(g1.status, 201);
    assert.equal(g1.data.slot, 0);
    const plantedAt = g1.data.planted_at;

    const { client: watcher } = await joinResident(ctx, 'watcher');
    const seeds = ['moonflower', 'lantern_poppy', 'tea_mint', 'ghost_bell', 'silver_thyme'];
    for (let i = 0; i < seeds.length; i++) {
      if (i === 3) ctx.advanceClock(3601);
      const handle = `fill_${i + 1}`;
      const { keys } = await joinResident(ctx, handle);
      const r = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: seeds[i] },
        handle,
        keys.privateKeyPem
      );
      assert.equal(r.status, 201);
      assert.equal(r.data.slot, i + 1);
    }

    const seqAfterFills = (await watcher.state()).data.state_seq;

    const g2Keys = generateKeypair();
    const dup = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_full', pubkey: g2Keys.pubkey, seed: 'moonflower' },
      'guest_full',
      g2Keys.privateKeyPem
    );
    assert.equal(dup.status, 409);
    assert.deepEqual(dup.data, {
      error: 'already_planted',
      slot: 0,
      seed: 'starwort',
      planted_at: plantedAt,
    });
    assert.equal((await watcher.state()).data.state_seq, seqAfterFills);
  } finally {
    await ctx.close();
  }
});

test('file hygiene: 46 unique names, 8 imports, zero banned terms, pinned as-true counts', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-garden.mjs'), 'utf8');
  const lines = src.split('\n');

  const names = lines
    .map((l) => l.match(/^test\('([^']+)'/))
    .filter(Boolean)
    .map((m) => m[1]);
  assert.equal(names.length, 56);
  assert.equal(new Set(names).size, 56);

  const importLines = lines.filter((l) => l.startsWith('import '));
  assert.equal(importLines.length, 8);

  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 1);
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 3);
  assert.equal(lines.filter((l) => new RegExp('Math' + '.random').test(l)).length, 2);
});

test('Slice 477 G1: resident plant with non-string seeds is 400 invalid_seed and state_seq does not move', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const seqBefore = (await alice.state()).data.state_seq;
    for (const badSeed of [123, null, true, ['moonflower'], { kind: 'moonflower' }]) {
      const r = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: badSeed },
        'alice',
        aliceKeys.privateKeyPem
      );
      assert.equal(r.status, 400);
      assert.deepEqual(r.data, { error: 'invalid_seed' });
    }
    assert.equal((await alice.state()).data.state_seq, seqBefore);
    const ok = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(ok.status, 201);
  } finally {
    await ctx.close();
  }
});

test('Slice 477 G2: guest plant with non-string seeds is 400 invalid_seed and the bucket stays open', async () => {
  const ctx = await startTestServer();
  try {
    for (const badSeed of [123, null, true, ['moonflower'], { kind: 'moonflower' }]) {
      const keys = generateKeypair();
      const r = await signedPostAt(
        ctx,
        '/api/town/garden/guest/plant',
        { handle: 'guest_typed', pubkey: keys.pubkey, seed: badSeed },
        'guest_typed',
        keys.privateKeyPem
      );
      assert.equal(r.status, 400);
      assert.deepEqual(r.data, { error: 'invalid_seed' });
    }
    const keysA = generateKeypair();
    const okA = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_typed', pubkey: keysA.pubkey, seed: 'moonflower' },
      'guest_typed',
      keysA.privateKeyPem
    );
    assert.equal(okA.status, 201);
    assert.equal(okA.data.slot, 0);
    const keysB = generateKeypair();
    const okB = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_two', pubkey: keysB.pubkey, seed: 'tea_mint' },
      'guest_two',
      keysB.privateKeyPem
    );
    assert.equal(okB.status, 201);
    assert.equal(okB.data.slot, 1);
  } finally {
    await ctx.close();
  }
});

test('Slice 477 G3: duplicate echo keeps the original planted_at after the clock advances two days', async () => {
  let now = 1795000000;
  const ctx = await startTestServer({ nowFn: () => now });
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const p1 = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'starwort' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(p1.status, 201);
    assert.equal(p1.data.planted_at, 1795000000);
    now += 2 * DAY_SEC;
    const dup = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(dup.status, 409);
    assert.deepEqual(dup.data, {
      error: 'already_planted',
      slot: 0,
      seed: 'starwort',
      planted_at: 1795000000,
    });
    const st = await alice.state();
    assert.equal(st.data.garden.slots[0].stage, 'leaf');
    assert.equal(st.data.garden.slots[0].planted_at, 1795000000);
  } finally {
    await ctx.close();
  }
});

test('Slice 477 G4: the same seed plants in many slots for residents and guests', async () => {
  const ctx = await startTestServer();
  try {
    for (let i = 0; i < 3; i++) {
      const { keys } = await joinResident(ctx, `res_${i}`);
      const r = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: 'moonflower' },
        `res_${i}`,
        keys.privateKeyPem
      );
      assert.equal(r.status, 201);
      assert.equal(r.data.slot, i);
    }
    const keysA = generateKeypair();
    const g1 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_a', pubkey: keysA.pubkey, seed: 'moonflower' },
      'guest_a',
      keysA.privateKeyPem
    );
    assert.equal(g1.status, 201);
    assert.equal(g1.data.slot, 3);
    const keysB = generateKeypair();
    const g2 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_b', pubkey: keysB.pubkey, seed: 'moonflower' },
      'guest_b',
      keysB.privateKeyPem
    );
    assert.equal(g2.status, 201);
    assert.equal(g2.data.slot, 4);
    const { client: watcher } = await joinResident(ctx, 'watcher');
    const st = await watcher.state();
    assert.equal(st.data.garden.slots.length, 5);
    assert.deepEqual(st.data.garden.slots.map((s) => s.seed), [
      'moonflower',
      'moonflower',
      'moonflower',
      'moonflower',
      'moonflower',
    ]);
    assert.deepEqual(st.data.garden.slots.map((s) => s.slot), [0, 1, 2, 3, 4]);
  } finally {
    await ctx.close();
  }
});

test('Slice 477 G5: a resident plant leaves footlights, presence, and the Prompt Book untouched', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await joinResident(ctx, 'alice');
    const { client: watcher } = await joinResident(ctx, 'watcher');
    const ci = await alice.checkin({ status_text: 'Tending the beds.' });
    assert.equal(ci.status, 200);
    const say = await alice.say('The moonflowers are up.');
    assert.equal(say.status, 201);
    const before = await watcher.state();
    assert.equal(before.status, 200);
    assert.equal(before.data.footlights.length, 1);
    assert.equal(before.data.presence.length, 1);
    assert.equal(before.data.prompt_book.length, 1);
    const footBefore = JSON.parse(JSON.stringify(before.data.footlights));
    const presBefore = JSON.parse(JSON.stringify(before.data.presence));
    const bookBefore = JSON.parse(JSON.stringify(before.data.prompt_book));
    const seqBefore = before.data.state_seq;
    const p = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(p.status, 201);
    assert.equal(p.data.state_seq, seqBefore + 1);
    const after = await watcher.state();
    assert.deepEqual(after.data.footlights, footBefore);
    assert.deepEqual(after.data.presence, presBefore);
    assert.deepEqual(after.data.prompt_book, bookBefore);
    assert.equal(after.data.garden.slots.length, 1);
    assert.equal(after.data.state_seq, seqBefore + 1);
  } finally {
    await ctx.close();
  }
});

test('Slice 477 G6: a guest plant blocks the later resident plant for the same handle', async () => {
  const ctx = await startTestServer();
  try {
    const guestKeys = generateKeypair();
    const g = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_rose', pubkey: guestKeys.pubkey, seed: 'starwort' },
      'guest_rose',
      guestKeys.privateKeyPem
    );
    assert.equal(g.status, 201);
    assert.equal(g.data.slot, 0);
    const plantedAt = g.data.planted_at;
    const { keys: resKeys } = await joinResident(ctx, 'guest_rose');
    const p = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'guest_rose',
      resKeys.privateKeyPem
    );
    assert.equal(p.status, 409);
    assert.deepEqual(p.data, {
      error: 'already_planted',
      slot: 0,
      seed: 'starwort',
      planted_at: plantedAt,
    });
  } finally {
    await ctx.close();
  }
});

test('Slice 477 G7: a guest plant response carries the exact keys and planted_at is server now', async () => {
  let now = 1795000000;
  const ctx = await startTestServer({ nowFn: () => now });
  try {
    const { client: watcher } = await joinResident(ctx, 'watcher');
    const seqBefore = (await watcher.state()).data.state_seq;
    const guestKeys = generateKeypair();
    const g = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'guest_timed', pubkey: guestKeys.pubkey, seed: 'ghost_bell' },
      'guest_timed',
      guestKeys.privateKeyPem
    );
    assert.equal(g.status, 201);
    assert.deepEqual(Object.keys(g.data).sort(), [
      'handle',
      'planted_at',
      'seed',
      'slot',
      'stage',
      'state_seq',
    ]);
    assert.equal(g.data.planted_at, 1795000000);
    assert.equal(g.data.stage, 'sprout');
    assert.equal(g.data.state_seq, seqBefore + 1);
    const st = await watcher.state();
    assert.equal(st.data.garden.slots[0].planted_at, 1795000000);
    assert.equal(st.data.garden.slots[0].stage, 'sprout');
  } finally {
    await ctx.close();
  }
});

test('Slice 477 G8: growth stage keeps deriving from the clock after a server restart', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-garden477-restart-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let now = 1795000000;
  const nowFn = () => now;
  let s1 = null;
  let s2 = null;
  try {
    s1 = createTownServer({ dbPath, plotsDir, operatorPubkey: operatorKeys.pubkey, nowFn });
    await new Promise((resolve) => s1.server.listen(0, '127.0.0.1', resolve));
    const ctx1 = { baseUrl: `http://127.0.0.1:${s1.server.address().port}`, nowSec: nowFn };
    const { keys: aliceKeys } = await joinResident(ctx1, 'alice');
    const p = await signedPostAt(
      ctx1,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      aliceKeys.privateKeyPem
    );
    assert.equal(p.status, 201);
    await new Promise((resolve) => s1.server.close(resolve));
    s1 = null;
    now += 2 * DAY_SEC;
    s2 = createTownServer({ dbPath, plotsDir, operatorPubkey: operatorKeys.pubkey, nowFn });
    await new Promise((resolve) => s2.server.listen(0, '127.0.0.1', resolve));
    const alice2 = new GhostlightClient({
      baseUrl: `http://127.0.0.1:${s2.server.address().port}`,
      handle: 'alice',
      ...aliceKeys,
    });
    const st2 = await alice2.state();
    assert.equal(st2.data.garden.slots[0].stage, 'leaf');
    now += 2 * DAY_SEC;
    const st3 = await alice2.state();
    assert.equal(st3.data.garden.slots[0].stage, 'bloom');
    assert.equal(st3.data.garden.slots[0].planted_at, 1795000000);
  } finally {
    if (s1) await new Promise((resolve) => s1.server.close(resolve));
    if (s2) await new Promise((resolve) => s2.server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 477 G9: a mixed resident and guest fill reaches bed_full on both endpoints', async () => {
  const ctx = await startTestServer();
  try {
    const { client: watcher } = await joinResident(ctx, 'watcher');
    const seeds = ['moonflower', 'lantern_poppy', 'tea_mint'];
    for (let i = 0; i < 3; i++) {
      const { keys } = await joinResident(ctx, `mix_res_${i}`);
      const r = await signedPostAt(
        ctx,
        '/api/town/garden/plant',
        { seed: seeds[i] },
        `mix_res_${i}`,
        keys.privateKeyPem
      );
      assert.equal(r.status, 201);
      assert.equal(r.data.slot, i);
    }
    const keysA = generateKeypair();
    const g1 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'mix_guest_a', pubkey: keysA.pubkey, seed: 'starwort' },
      'mix_guest_a',
      keysA.privateKeyPem
    );
    assert.equal(g1.status, 201);
    assert.equal(g1.data.slot, 3);
    const keysB = generateKeypair();
    const g2 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'mix_guest_b', pubkey: keysB.pubkey, seed: 'ghost_bell' },
      'mix_guest_b',
      keysB.privateKeyPem
    );
    assert.equal(g2.status, 201);
    assert.equal(g2.data.slot, 4);
    ctx.advanceClock(3601);
    const keysC = generateKeypair();
    const g3 = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'mix_guest_c', pubkey: keysC.pubkey, seed: 'silver_thyme' },
      'mix_guest_c',
      keysC.privateKeyPem
    );
    assert.equal(g3.status, 201);
    assert.equal(g3.data.slot, 5);
    const { keys: lateKeys } = await joinResident(ctx, 'mix_late');
    const seqBefore = (await watcher.state()).data.state_seq;
    const lateRes = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'mix_late',
      lateKeys.privateKeyPem
    );
    assert.equal(lateRes.status, 409);
    assert.deepEqual(lateRes.data, { error: 'bed_full' });
    const lateGuestKeys = generateKeypair();
    const lateGuest = await signedPostAt(
      ctx,
      '/api/town/garden/guest/plant',
      { handle: 'mix_guest_late', pubkey: lateGuestKeys.pubkey, seed: 'moonflower' },
      'mix_guest_late',
      lateGuestKeys.privateKeyPem
    );
    assert.equal(lateGuest.status, 409);
    assert.deepEqual(lateGuest.data, { error: 'bed_full' });
    assert.equal((await watcher.state()).data.state_seq, seqBefore);
  } finally {
    await ctx.close();
  }
});

test('Slice 477 G10: resident wrong-key plant is 401 invalid_signature and unsigned guest plant is 401', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: aliceKeys } = await joinResident(ctx, 'alice');
    const { keys: bobKeys } = await joinResident(ctx, 'bob');
    const wrongKey = await signedPostAt(
      ctx,
      '/api/town/garden/plant',
      { seed: 'moonflower' },
      'alice',
      bobKeys.privateKeyPem
    );
    assert.equal(wrongKey.status, 401);
    assert.equal(wrongKey.data.error, 'invalid_signature');
    const unsignedRes = await fetch(`${ctx.baseUrl}/api/town/garden/guest/plant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'guest_nosig', pubkey: generateKeypair().pubkey, seed: 'moonflower' }),
    });
    const unsignedData = await unsignedRes.json();
    assert.equal(unsignedRes.status, 401);
    assert.equal(unsignedData.error, 'missing_auth_headers');
  } finally {
    await ctx.close();
  }
});
