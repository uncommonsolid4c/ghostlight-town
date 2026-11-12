import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;

  const { server, db } = createTownServer({
    dbPath,
    operatorPubkey: opts.operatorPubkey !== undefined ? opts.operatorPubkey : operatorKeys.pubkey,
    nowFn: () => Math.floor(Date.now() / 1000) + clockOffset,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    operatorKeys,
    db,
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
