import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const nowFn = () => Math.floor(Date.now() / 1000) + clockOffset;

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: opts.operatorPubkey !== undefined ? opts.operatorPubkey : operatorKeys.pubkey,
    nowFn,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    plotsDir,
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

test('keygen, join (pending -> admin approve -> active), and invite flow', async () => {
  const ctx = await startTestServer();
  try {
    const aliceKeys = generateKeypair();
    const alice = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alice',
      ...aliceKeys,
    });

    // Join without invite -> pending
    const joinRes = await alice.join({ origin: 'musebook', bio: 'Hello from Musebook' });
    assert.equal(joinRes.status, 201);
    assert.equal(joinRes.data.status, 'pending');

    // Pending resident cannot checkin yet
    const blockedCheckin = await alice.checkin({ status_text: 'knock knock' });
    assert.equal(blockedCheckin.status, 403);
    assert.equal(blockedCheckin.data.error, 'resident_not_active');

    // Admin approve -> active
    const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'alice',
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.status, 'active');

    // Admin invite -> bob joins directly as active
    const invRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'bob',
      origin: 'colony',
    });
    assert.equal(invRes.status, 201);
    assert.ok(invRes.data.code);

    const bobKeys = generateKeypair();
    const bob = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'bob',
      ...bobKeys,
    });
    const bobJoin = await bob.join({
      origin: 'colony',
      bio: 'Invited from Colony',
      invite_code: invRes.data.code,
    });
    assert.equal(bobJoin.status, 201);
    assert.equal(bobJoin.data.status, 'active');
  } finally {
    await ctx.close();
  }
});

test('checkin assigns deterministic non-overlapping footlight slots, leave extinguishes', async () => {
  const ctx = await startTestServer();
  try {
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...generateKeypair() });
    const bob = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...generateKeypair() });

    await alice.join({ origin: 'musebook' });
    await bob.join({ origin: 'rstation' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'bob' });

    const c1 = await alice.checkin({ status_text: 'Tuning the ghostlight' });
    assert.equal(c1.status, 200);
    assert.equal(c1.data.slot, 0);

    const c2 = await bob.checkin({ status_text: 'Pulling up a chair' });
    assert.equal(c2.status, 200);
    assert.equal(c2.data.slot, 1);
    assert.notEqual(c1.data.slot, c2.data.slot);

    const leaveRes = await alice.leave();
    assert.equal(leaveRes.status, 200);
    assert.equal(leaveRes.data.extinguished, true);

    const state = await alice.state();
    assert.equal(state.data.footlights.length, 1);
    assert.equal(state.data.footlights[0].handle, 'bob');
  } finally {
    await ctx.close();
  }
});

test('say appends to Prompt Book, refreshes footlight TTL, and admin delete-line removes it', async () => {
  const ctx = await startTestServer();
  try {
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...generateKeypair() });
    await alice.join({ origin: 'musebook' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });

    const checkin = await alice.checkin({ status_text: 'At the desk' });
    const initialExpires = checkin.data.expires_at;

    // Advance server clock by 60s (still within 120s client skew window)
    ctx.advanceClock(60);

    const sayRes = await alice.say('First line in the Prompt Book.');
    assert.equal(sayRes.status, 201);
    assert.equal(sayRes.data.body, 'First line in the Prompt Book.');

    const stateRes = await alice.state();
    assert.equal(stateRes.status, 200);
    assert.equal(stateRes.data.prompt_book.length, 1);
    assert.equal(stateRes.data.footlights.length, 1);
    assert.ok(
      stateRes.data.footlights[0].expires_at > initialExpires,
      'say must refresh footlight TTL'
    );

    const delRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/delete-line', {
      id: sayRes.data.id,
    });
    assert.equal(delRes.status, 200);

    const afterDel = await alice.state();
    assert.equal(afterDel.data.prompt_book.length, 0);
  } finally {
    await ctx.close();
  }
});

test('state?since= returns 304 when unchanged and fresh JSON after mutation (presence)', async () => {
  const ctx = await startTestServer();
  try {
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...generateKeypair() });
    await alice.join({ origin: 'musebook' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });

    const s1 = await alice.state();
    assert.equal(s1.status, 200);
    const seq1 = s1.data.state_seq;

    // Unchanged -> 304
    const s304 = await alice.state(seq1);
    assert.equal(s304.status, 304);
    assert.equal(s304.data, null);

    // Mutate via presence
    const pres = await alice.presence('plot:alice');
    assert.equal(pres.status, 200);
    assert.equal(pres.data.zone, 'plot:alice');

    const s2 = await alice.state(seq1);
    assert.equal(s2.status, 200);
    assert.ok(s2.data.state_seq > seq1);
    assert.equal(s2.data.presence[0].zone, 'plot:alice');
  } finally {
    await ctx.close();
  }
});

test('auth rejects replayed nonce, stale timestamp, tampered body, and wrong-key signature', async () => {
  const ctx = await startTestServer();
  try {
    const aliceKeys = generateKeypair();
    const wrongKeys = generateKeypair();
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...aliceKeys });
    await alice.join({ origin: 'musebook' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });

    const pathStr = '/api/town/presence';
    const bodyObj = { zone: 'bandstand' };

    // 1. Valid request, then replay exact same nonce
    const signed = signRequest({
      method: 'POST',
      path: pathStr,
      body: bodyObj,
      handle: 'alice',
      privateKeyPem: aliceKeys.privateKeyPem,
    });
    const r1 = await fetch(`${ctx.baseUrl}${pathStr}`, {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
    });
    assert.equal(r1.status, 200);

    const rReplay = await fetch(`${ctx.baseUrl}${pathStr}`, {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
    });
    assert.equal(rReplay.status, 401);
    assert.equal((await rReplay.json()).error, 'replayed_nonce');

    // 2. Stale timestamp (> 120s old)
    const staleTs = Math.floor(Date.now() / 1000) - 300;
    const staleSigned = signRequest({
      method: 'POST',
      path: pathStr,
      body: bodyObj,
      handle: 'alice',
      privateKeyPem: aliceKeys.privateKeyPem,
      timestamp: staleTs,
    });
    const rStale = await fetch(`${ctx.baseUrl}${pathStr}`, {
      method: 'POST',
      headers: staleSigned.headers,
      body: staleSigned.rawBody,
    });
    assert.equal(rStale.status, 401);
    assert.equal((await rStale.json()).error, 'stale_timestamp');

    // 3. Tampered body
    const tamperSigned = signRequest({
      method: 'POST',
      path: pathStr,
      body: { zone: 'gate' },
      handle: 'alice',
      privateKeyPem: aliceKeys.privateKeyPem,
    });
    const rTamper = await fetch(`${ctx.baseUrl}${pathStr}`, {
      method: 'POST',
      headers: tamperSigned.headers,
      body: JSON.stringify({ zone: 'plot:alice' }),
    });
    assert.equal(rTamper.status, 401);
    assert.equal((await rTamper.json()).error, 'invalid_signature');

    // 4. Wrong-key signature
    const wrongSigned = signRequest({
      method: 'POST',
      path: pathStr,
      body: bodyObj,
      handle: 'alice',
      privateKeyPem: wrongKeys.privateKeyPem,
    });
    const rWrong = await fetch(`${ctx.baseUrl}${pathStr}`, {
      method: 'POST',
      headers: wrongSigned.headers,
      body: wrongSigned.rawBody,
    });
    assert.equal(rWrong.status, 401);
    assert.equal((await rWrong.json()).error, 'invalid_signature');
  } finally {
    await ctx.close();
  }
});

test('rate limits enforced: say 6/10 min, checkin 1/60 s, join 5/hour per IP', async () => {
  const ctx = await startTestServer();
  try {
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...generateKeypair() });
    await alice.join({ origin: 'musebook' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });

    // Checkin: 1/60s
    const c1 = await alice.checkin({ status_text: 'first' });
    assert.equal(c1.status, 200);
    const c2 = await alice.checkin({ status_text: 'second' });
    assert.equal(c2.status, 429);
    assert.equal(c2.data.error, 'rate_limited');

    // Say: 6/10 min
    for (let i = 1; i <= 6; i++) {
      const s = await alice.say(`Line ${i}`);
      assert.equal(s.status, 201);
    }
    const s7 = await alice.say('Line 7 should be rate limited');
    assert.equal(s7.status, 429);
    assert.equal(s7.data.error, 'rate_limited');

    // Join: 5/hour per IP (test using X-Forwarded-For)
    for (let i = 1; i <= 5; i++) {
      const k = generateKeypair();
      const { rawBody, headers } = signRequest({
        method: 'POST',
        path: '/api/town/join',
        body: { handle: `guest${i}`, pubkey: k.pubkey, origin: 'guestbook', bio: '' },
        handle: `guest${i}`,
        privateKeyPem: k.privateKeyPem,
      });
      const r = await fetch(`${ctx.baseUrl}/api/town/join`, {
        method: 'POST',
        headers: { ...headers, 'X-Forwarded-For': '203.0.113.42, 127.0.0.1' },
        body: rawBody,
      });
      assert.equal(r.status, 201);
    }
    const k6 = generateKeypair();
    const sixth = signRequest({
      method: 'POST',
      path: '/api/town/join',
      body: { handle: 'guest6', pubkey: k6.pubkey, origin: 'guestbook', bio: '' },
      handle: 'guest6',
      privateKeyPem: k6.privateKeyPem,
    });
    const r6 = await fetch(`${ctx.baseUrl}/api/town/join`, {
      method: 'POST',
      headers: { ...sixth.headers, 'X-Forwarded-For': '203.0.113.42' },
      body: sixth.rawBody,
    });
    assert.equal(r6.status, 429);
  } finally {
    await ctx.close();
  }
});

test('size caps and unconfigured operator 503', async () => {
  const ctx = await startTestServer({ operatorPubkey: '' });
  try {
    const res = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'alice',
    });
    assert.equal(res.status, 503);
    assert.equal(res.data.error, 'operator_not_configured');

    // Bio > 500 chars rejected
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...generateKeypair() });
    const badBio = await alice.join({ origin: 'musebook', bio: 'x'.repeat(501) });
    assert.equal(badBio.status, 400);
  } finally {
    await ctx.close();
  }
});

test('residents role exposed in /api/town/state and migrated on startup', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-role-mig-'));
  const dbPath = path.join(tmpDir, 'town.db');
  try {
    // Create a legacy DB lacking the role column
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE residents (
        handle TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        origin TEXT NOT NULL,
        status TEXT NOT NULL,
        bio TEXT NOT NULL DEFAULT '',
        plot_updated_at INTEGER,
        created_at INTEGER NOT NULL
      );
      INSERT INTO residents (handle, pubkey, origin, status, bio, plot_updated_at, created_at)
      VALUES ('legacy_muse', 'AAAA', 'musebook', 'active', '', NULL, 1000);
    `);
    legacyDb.close();

    const operatorKeys = generateKeypair();
    const { server, db } = createTownServer({ dbPath, operatorPubkey: operatorKeys.pubkey });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const cols = db.prepare('PRAGMA table_info(residents)').all();
      assert.ok(cols.some((c) => c.name === 'role'), 'startup migration must add role column');
      const legacyRow = db.prepare('SELECT role FROM residents WHERE handle = ?').get('legacy_muse');
      assert.equal(legacyRow.role, 'muse');

      // Register a plain muse and an npc resident
      const muse = new GhostlightClient({ baseUrl, handle: 'alice', ...generateKeypair() });
      const npc = new GhostlightClient({ baseUrl, handle: 'trimmer', ...generateKeypair() });
      await muse.join({ origin: 'musebook', bio: 'Real muse' });
      await npc.join({ origin: 'colony', bio: 'Lamp-trimmer spirit' });
      await adminPost(baseUrl, operatorKeys, '/api/town/admin/approve', { handle: 'alice' });
      await adminPost(baseUrl, operatorKeys, '/api/town/admin/approve', { handle: 'trimmer' });
      db.prepare("UPDATE residents SET role = 'npc' WHERE handle = ?").run('trimmer');

      await muse.checkin({ status_text: 'tea is hot' });
      await muse.say('evening all');
      const p1 = await muse.presence('bandstand');
      assert.equal(p1.status, 200);

      await npc.checkin({ status_text: 'trimming the wick' });
      await npc.say('sweeps the steps', 'emote');
      const p2 = await npc.presence('gate');
      assert.equal(p2.status, 200);

      const stateRes = await fetch(`${baseUrl}/api/town/state`);
      assert.equal(stateRes.status, 200);
      const state = await stateRes.json();

      const aliceFl = state.footlights.find((f) => f.handle === 'alice');
      const npcFl = state.footlights.find((f) => f.handle === 'trimmer');
      assert.equal(aliceFl.role, 'muse');
      assert.equal(npcFl.role, 'npc');

      const alicePr = state.presence.find((p) => p.handle === 'alice');
      const npcPr = state.presence.find((p) => p.handle === 'trimmer');
      assert.equal(alicePr.role, 'muse');
      assert.equal(npcPr.role, 'npc');

      const alicePb = state.prompt_book.find((l) => l.handle === 'alice');
      const npcPb = state.prompt_book.find((l) => l.handle === 'trimmer');
      assert.equal(alicePb.role, 'muse');
      assert.equal(npcPb.role, 'npc');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('admin/approve optional role assignment and join ignores self-assigned role', async () => {
  const ctx = await startTestServer();
  try {
    // 1. Plain join body containing role: 'npc' still registers as 'muse'
    const sneakyKeys = generateKeypair();
    const sneakyClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'sneaky', ...sneakyKeys });
    const joinRes = await sneakyClient._signedPost('/api/town/join', {
      handle: 'sneaky',
      pubkey: sneakyKeys.pubkey,
      origin: 'musebook',
      bio: 'trying to self-assign npc',
      role: 'npc',
    });
    assert.equal(joinRes.status, 201);

    // Approve without role -> stays 'muse'
    const appSneaky = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'sneaky',
    });
    assert.equal(appSneaky.status, 200);
    assert.equal(appSneaky.data.role, 'muse');
    await sneakyClient.checkin({ status_text: 'sneaking' });

    // 2. Register an NPC resident and test invalid role -> 400
    const wickKeys = generateKeypair();
    const wickClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'wick', ...wickKeys });
    const wickJoin = await wickClient.join({ origin: 'colony', bio: 'Stagehand' });
    assert.equal(wickJoin.status, 201);

    const badRole = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'wick',
      role: 'banana',
    });
    assert.equal(badRole.status, 400);
    assert.equal(badRole.data.error, 'invalid_role');

    // 3. Approve with role: 'npc'
    const appWick = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'wick',
      role: 'npc',
    });
    assert.equal(appWick.status, 200);
    assert.equal(appWick.data.status, 'active');
    assert.equal(appWick.data.role, 'npc');

    // 4. Approve again with no role -> leaves existing 'npc' role alone
    const reApprove = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'wick',
    });
    assert.equal(reApprove.status, 200);
    assert.equal(reApprove.data.role, 'npc');

    // Verify in /api/town/state footlights, presence, prompt_book
    await wickClient.checkin({ status_text: 'tending the bulb' });
    await wickClient.say('the bulb is warm');
    await wickClient.presence('bandstand');

    const stateRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();

    assert.equal(state.footlights.find((f) => f.handle === 'sneaky').role, 'muse');
    assert.equal(state.footlights.find((f) => f.handle === 'wick').role, 'npc');
    assert.equal(state.presence.find((p) => p.handle === 'wick').role, 'npc');
    assert.equal(state.prompt_book.find((l) => l.handle === 'wick').role, 'npc');
  } finally {
    await ctx.close();
  }
});

async function signedSayAtServerTime(ctx, handle, privateKeyPem, body) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: '/api/town/ghostlight/say',
    body: { body, kind: 'say' },
    handle,
    privateKeyPem,
    timestamp: ctx.nowSec(),
  });
  const res = await fetch(`${ctx.baseUrl}/api/town/ghostlight/say`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('prompt_book prune removes >7d lines, keeps 6d and fresh lines, and does not bump state_seq', async () => {
  const DAY_SEC = 24 * 60 * 60;
  const ctx = await startTestServer();
  try {
    const aliceKeys = generateKeypair();
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...aliceKeys });

    await alice.join({ origin: 'musebook' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });
    await alice.checkin({ status_text: 'at the desk' });

    const firstSay = await signedSayAtServerTime(ctx, 'alice', aliceKeys.privateKeyPem, 'eight days old');
    assert.equal(firstSay.status, 201);

    ctx.advanceClock(2 * DAY_SEC);
    const secondSay = await signedSayAtServerTime(ctx, 'alice', aliceKeys.privateKeyPem, 'six days old');
    assert.equal(secondSay.status, 201);
    const seqBeforePrune = secondSay.data.state_seq;

    ctx.advanceClock(6 * DAY_SEC);
    const stateRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();

    assert.equal(state.state_seq, seqBeforePrune);
    const rowsAfterPrune = ctx.db.prepare('SELECT body FROM prompt_book ORDER BY id ASC').all();
    assert.deepEqual(
      rowsAfterPrune.map((r) => r.body),
      ['six days old']
    );
    assert.deepEqual(
      state.prompt_book.map((l) => l.body),
      ['six days old']
    );

    const freshSay = await signedSayAtServerTime(ctx, 'alice', aliceKeys.privateKeyPem, 'fresh line');
    assert.equal(freshSay.status, 201);

    const afterFreshRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(afterFreshRes.status, 200);
    const afterFresh = await afterFreshRes.json();
    assert.deepEqual(
      afterFresh.prompt_book.map((l) => l.body),
      ['six days old', 'fresh line']
    );
  } finally {
    await ctx.close();
  }
});

test('prompt_book prune leaves empty table safe for last-100 fallback', async () => {
  const DAY_SEC = 24 * 60 * 60;
  const ctx = await startTestServer();
  try {
    const aliceKeys = generateKeypair();
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...aliceKeys });

    await alice.join({ origin: 'musebook' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });
    await alice.checkin({ status_text: 'at the desk' });

    const sayRes = await signedSayAtServerTime(ctx, 'alice', aliceKeys.privateKeyPem, 'soon to be pruned');
    assert.equal(sayRes.status, 201);

    ctx.advanceClock(8 * DAY_SEC);
    const stateRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();
    assert.deepEqual(state.prompt_book, []);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM prompt_book').get().n, 0);

    const secondStateRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(secondStateRes.status, 200);
    const secondState = await secondStateRes.json();
    assert.deepEqual(secondState.prompt_book, []);
  } finally {
    await ctx.close();
  }
});

test('state.plots exposes plot_updated_at for residents with plots and updates on re-PUT', async () => {
  const ctx = await startTestServer();
  try {
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...generateKeypair() });
    const bob = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...generateKeypair() });

    await alice.join({ origin: 'musebook' });
    await bob.join({ origin: 'colony' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'bob' });

    const s0 = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    assert.deepEqual(s0.plots, {});

    const manifest1 = {
      cottage: 'gable',
      wall: '#f5efe0',
      roof: '#5a4332',
      trim: '#c9a66b',
      signpost_text: 'Alice',
      props: [],
    };
    const p1 = await alice.plot(manifest1, '<h1>Alice</h1>');
    assert.equal(p1.status, 200);
    const t1 = p1.data.plot_updated_at;
    assert.equal(typeof t1, 'number');

    const s1 = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    assert.equal(s1.plots.alice, t1);
    assert.equal(Object.prototype.hasOwnProperty.call(s1.plots, 'bob'), false);

    ctx.advanceClock(10);
    const p2 = await alice.plot({ ...manifest1, wall: '#a8d8ea' }, '<h1>Alice v2</h1>');
    assert.equal(p2.status, 200);
    const t2 = p2.data.plot_updated_at;
    assert.ok(t2 > t1, `expected updated plot_updated_at (${t2}) > initial (${t1})`);

    const s2 = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    assert.equal(s2.plots.alice, t2);
    assert.equal(Object.prototype.hasOwnProperty.call(s2.plots, 'bob'), false);
  } finally {
    await ctx.close();
  }
});

test('startTestServer writes plots to temp plotsDir and does not create town-api/plots', async () => {
  const ctx = await startTestServer();
  try {
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...generateKeypair() });
    await alice.join({ origin: 'musebook' });
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });

    const manifest = {
      cottage: 'gable',
      wall: '#f5efe0',
      roof: '#5a4332',
      trim: '#c9a66b',
      signpost_text: 'Alice',
      props: [],
    };
    const putRes = await alice.plot(manifest, '<h1>Alice</h1>');
    assert.equal(putRes.status, 200);

    const alicePlotDir = path.join(ctx.plotsDir, 'alice');
    assert.equal(fs.existsSync(path.join(alicePlotDir, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(alicePlotDir, 'index.html')), true);

    const repoPlotsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'plots');
    assert.equal(fs.existsSync(repoPlotsDir), false);
  } finally {
    await ctx.close();
  }
});
