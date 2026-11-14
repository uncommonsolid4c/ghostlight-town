/**
 * Slice 54: Town Gate Guestbook + Letters to the Editor API tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair } from './ghostlight-client.mjs';

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-guestbook-test-'));
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

async function rawPost(baseUrl, endpoint, payload, headers = {}) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('sign validation rejects bad kind, empty/oversized name or body, and URLs', async () => {
  const ctx = await startTestServer();
  try {
    const badKind = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'note',
      name: 'Alice',
      body: 'Hello!',
    });
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');

    const emptyName = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'guestbook',
      name: '   ',
      body: 'Hello!',
    });
    assert.equal(emptyName.status, 400);
    assert.equal(emptyName.data.error, 'invalid_name');

    const longName = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'guestbook',
      name: 'a'.repeat(41),
      body: 'Hello!',
    });
    assert.equal(longName.status, 400);
    assert.equal(longName.data.error, 'invalid_name');

    const emptyBody = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'letter',
      name: 'Alice',
      body: '   ',
    });
    assert.equal(emptyBody.status, 400);
    assert.equal(emptyBody.data.error, 'invalid_body');

    const longBody = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'letter',
      name: 'Alice',
      body: 'b'.repeat(501),
    });
    assert.equal(longBody.status, 400);
    assert.equal(longBody.data.error, 'invalid_body');

    const httpUrl = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'guestbook',
      name: 'Alice',
      body: 'Visit http://example.com today',
    });
    assert.equal(httpUrl.status, 400);
    assert.equal(httpUrl.data.error, 'urls_not_allowed');

    const httpsUrl = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'letter',
      name: 'Alice',
      body: 'Check HTTPS://EXAMPLE.COM/foo',
    });
    assert.equal(httpsUrl.status, 400);
    assert.equal(httpsUrl.data.error, 'urls_not_allowed');
  } finally {
    await ctx.close();
  }
});

test('unsigned sign is pending and invisible until approved; reject stays hidden; state_seq bumps only on approve', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const s0 = await visitor.state();
    assert.equal(s0.status, 200);
    assert.deepEqual(s0.data.guestbook, { signed: 0, letters: 0 });
    const seq0 = s0.data.state_seq;

    // Unsigned POST with zero x-muse-* / x-ghostlight-* headers
    const signRes = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'guestbook',
      name: '  Wandering Human  ',
      body: '  Lovely lanterns by the gate. <3  ',
    });
    assert.equal(signRes.status, 201);
    assert.equal(signRes.data.status, 'pending');
    assert.ok(Number.isInteger(signRes.data.id) && signRes.data.id > 0);

    // Pending entry is invisible in GET and state, and state_seq did not bump
    const g0 = await visitor.getGuestbook();
    assert.equal(g0.status, 200);
    assert.deepEqual(g0.data.entries, []);

    const s1 = await visitor.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.state_seq, seq0);
    assert.deepEqual(s1.data.guestbook, { signed: 0, letters: 0 });

    // Submit a letter that will be rejected
    const letterRes = await visitor.signGuestbook('letter', 'Grumpy Reader', 'Too much fog.');
    assert.equal(letterRes.status, 201);
    assert.equal(letterRes.data.status, 'pending');

    // Reject the letter -> 200, invisible, no state_seq bump
    const rejRes = await admin.moderateGuestbook(letterRes.data.id, 'reject');
    assert.equal(rejRes.status, 200);
    assert.deepEqual(rejRes.data, { id: letterRes.data.id, status: 'rejected' });

    const s2 = await visitor.state();
    assert.equal(s2.data.state_seq, seq0);
    assert.deepEqual(s2.data.guestbook, { signed: 0, letters: 0 });

    const g1 = await visitor.getGuestbook();
    assert.deepEqual(g1.data.entries, []);

    // Approve the guestbook entry -> 200, visible in GET, counted in state, state_seq bumps
    const appRes = await admin.moderateGuestbook(signRes.data.id, 'approve');
    assert.equal(appRes.status, 200);
    assert.deepEqual(appRes.data, { id: signRes.data.id, status: 'approved' });

    const s3 = await visitor.state();
    assert.ok(s3.data.state_seq > seq0, 'approve must bump state_seq');
    assert.deepEqual(s3.data.guestbook, { signed: 1, letters: 0 });

    const g2 = await visitor.getGuestbook();
    assert.equal(g2.status, 200);
    assert.equal(g2.data.entries.length, 1);
    assert.equal(g2.data.entries[0].id, signRes.data.id);
    assert.equal(g2.data.entries[0].kind, 'guestbook');
    assert.equal(g2.data.entries[0].name, 'Wandering Human');
    assert.equal(g2.data.entries[0].body, 'Lovely lanterns by the gate. <3');
    assert.ok(Number.isInteger(g2.data.entries[0].created_at));
  } finally {
    await ctx.close();
  }
});

test('moderation errors: 409 already_decided, 404 unknown id, 400 bad action', async () => {
  const ctx = await startTestServer();
  try {
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });

    const signRes = await visitor.signGuestbook('letter', 'Mina', 'More tea at the Bandstand!');
    assert.equal(signRes.status, 201);
    const id = signRes.data.id;

    const badAction = await admin.moderateGuestbook(id, 'archive');
    assert.equal(badAction.status, 400);
    assert.equal(badAction.data.error, 'invalid_action');

    const unknown = await admin.moderateGuestbook(99999, 'approve');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.data.error, 'guestbook_not_found');

    const firstApprove = await admin.moderateGuestbook(id, 'approve');
    assert.equal(firstApprove.status, 200);

    const reApprove = await admin.moderateGuestbook(id, 'approve');
    assert.equal(reApprove.status, 409);
    assert.equal(reApprove.data.error, 'already_decided');

    const reReject = await admin.moderateGuestbook(id, 'reject');
    assert.equal(reReject.status, 409);
    assert.equal(reReject.data.error, 'already_decided');
  } finally {
    await ctx.close();
  }
});

test('kind filter separates guestbook and letter entries and rejects invalid kind', async () => {
  const ctx = await startTestServer();
  try {
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });

    const gb = await visitor.signGuestbook('guestbook', 'Guest 1', 'Hello gate!');
    const lt = await visitor.signGuestbook('letter', 'Reader 1', 'Dear editor...');
    assert.equal(gb.status, 201);
    assert.equal(lt.status, 201);

    await admin.moderateGuestbook(gb.data.id, 'approve');
    await admin.moderateGuestbook(lt.data.id, 'approve');

    const s = await visitor.state();
    assert.deepEqual(s.data.guestbook, { signed: 1, letters: 1 });

    const onlyGb = await visitor.getGuestbook('guestbook');
    assert.equal(onlyGb.status, 200);
    assert.equal(onlyGb.data.entries.length, 1);
    assert.equal(onlyGb.data.entries[0].kind, 'guestbook');

    const onlyLt = await visitor.getGuestbook('letter');
    assert.equal(onlyLt.status, 200);
    assert.equal(onlyLt.data.entries.length, 1);
    assert.equal(onlyLt.data.entries[0].kind, 'letter');

    const both = await visitor.getGuestbook();
    assert.equal(both.status, 200);
    assert.equal(both.data.entries.length, 2);

    const badKind = await visitor.getGuestbook('bogus');
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');
  } finally {
    await ctx.close();
  }
});

test('rate limit enforces 3 signs per hour per IP and resets after 1 hour', async () => {
  const ctx = await startTestServer();
  try {
    for (let i = 1; i <= 3; i++) {
      const r = await rawPost(
        ctx.baseUrl,
        '/api/town/guestbook',
        { kind: 'guestbook', name: `Guest ${i}`, body: `Line ${i}` },
        { 'X-Forwarded-For': '203.0.113.10' }
      );
      assert.equal(r.status, 201, `sign #${i} should succeed`);
    }

    const r4 = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Guest 4', body: 'Line 4' },
      { 'X-Forwarded-For': '203.0.113.10' }
    );
    assert.equal(r4.status, 429);
    assert.equal(r4.data.error, 'rate_limited');
    assert.ok(Number.isInteger(r4.data.retry_after) && r4.data.retry_after > 0);

    // Different IP is unaffected
    const otherIp = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'letter', name: 'Other', body: 'From another IP' },
      { 'X-Forwarded-For': '203.0.113.11' }
    );
    assert.equal(otherIp.status, 201);

    // Advance clock past 1 hour -> original IP can sign again
    ctx.advanceClock(3601);
    const r5 = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Guest 5', body: 'Line 5' },
      { 'X-Forwarded-For': '203.0.113.10' }
    );
    assert.equal(r5.status, 201);
  } finally {
    await ctx.close();
  }
});
