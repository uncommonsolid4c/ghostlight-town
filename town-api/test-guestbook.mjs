/**
 * Slice 54: Town Gate Guestbook + Letters to the Editor API tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair } from './ghostlight-client.mjs';

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-guestbook-test-'));
  const dbPath = opts.dbPath || path.join(tmpDir, 'town.db');
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

async function registerResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({
    baseUrl: ctx.baseUrl,
    handle,
    pubkey: keys.pubkey,
    privateKeyPem: keys.privateKeyPem,
  });
  const joinRes = await client.join({ origin: 'colony', bio: '' });
  assert.equal(joinRes.status, 201);
  const admin = new GhostlightClient({
    baseUrl: ctx.baseUrl,
    handle: 'milo-op',
    privateKeyPem: ctx.operatorKeys.privateKeyPem,
  });
  const appRes = await admin._signedPost('/api/town/admin/approve', { handle });
  assert.equal(appRes.status, 200);
  return client;
}

test('per-plot guestbook lifecycle: pending hidden, approve surfaces in ?plot= and guestbook_by_plot without inflating gate counts', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const s0 = await visitor.state();
    assert.equal(s0.status, 200);
    assert.deepEqual(s0.data.guestbook, { signed: 0, letters: 0 });
    assert.deepEqual(s0.data.guestbook_by_plot, {});
    const seq0 = s0.data.state_seq;

    const signRes = await visitor.signGuestbook('guestbook', 'Passing Muse', 'Love the brass lamp on your porch.', 'wick');
    assert.equal(signRes.status, 201);
    assert.equal(signRes.data.status, 'pending');
    assert.ok(Number.isInteger(signRes.data.id) && signRes.data.id > 0);

    // Before approve: invisible in gate GET, plot GET, gate state counts, and guestbook_by_plot
    const gate0 = await visitor.getGuestbook();
    assert.equal(gate0.status, 200);
    assert.deepEqual(gate0.data.entries, []);

    const plot0 = await visitor.getGuestbook(undefined, 'wick');
    assert.equal(plot0.status, 200);
    assert.deepEqual(plot0.data.entries, []);

    const s1 = await visitor.state();
    assert.equal(s1.data.state_seq, seq0);
    assert.deepEqual(s1.data.guestbook, { signed: 0, letters: 0 });
    assert.deepEqual(s1.data.guestbook_by_plot, {});

    // Approve -> visible in ?plot=wick GET, counted in guestbook_by_plot, state_seq bumped, gate still 0
    const appRes = await admin.moderateGuestbook(signRes.data.id, 'approve');
    assert.equal(appRes.status, 200);
    assert.deepEqual(appRes.data, { id: signRes.data.id, status: 'approved' });

    const s2 = await visitor.state();
    assert.ok(s2.data.state_seq > seq0, 'approve must bump state_seq');
    assert.deepEqual(s2.data.guestbook, { signed: 0, letters: 0 });
    assert.deepEqual(s2.data.guestbook_by_plot, { wick: 1 });

    const gate1 = await visitor.getGuestbook();
    assert.equal(gate1.status, 200);
    assert.deepEqual(gate1.data.entries, []);

    const plot1 = await visitor.getGuestbook(undefined, 'wick');
    assert.equal(plot1.status, 200);
    assert.equal(plot1.data.entries.length, 1);
    assert.deepEqual(Object.keys(plot1.data.entries[0]).sort(), ['body', 'created_at', 'id', 'kind', 'name']);
    assert.equal(plot1.data.entries[0].id, signRes.data.id);
    assert.equal(plot1.data.entries[0].kind, 'guestbook');
    assert.equal(plot1.data.entries[0].name, 'Passing Muse');
    assert.equal(plot1.data.entries[0].body, 'Love the brass lamp on your porch.');
  } finally {
    await ctx.close();
  }
});

test('per-plot validation rejects unknown_plot, letter+plot, empty/non-string plot without burning quota; GET rejects bad plot', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const ipHeader = { 'X-Forwarded-For': '203.0.113.55' };

    // Four rejected posts in a row from the same IP must all return 400, never 429
    const unknownPost = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'Hello?', plot: 'nobody' },
      ipHeader
    );
    assert.equal(unknownPost.status, 400);
    assert.equal(unknownPost.data.error, 'unknown_plot');

    const letterUnknownPlot = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'letter', name: 'Alice', body: 'Hello?', plot: 'nobody' },
      ipHeader
    );
    assert.equal(letterUnknownPlot.status, 400);
    assert.equal(letterUnknownPlot.data.error, 'unknown_plot');

    const letterValidPlot = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'letter', name: 'Alice', body: 'To the editor', plot: 'wick' },
      ipHeader
    );
    assert.equal(letterValidPlot.status, 400);
    assert.equal(letterValidPlot.data.error, 'invalid_plot');

    const emptyPlot = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'Hello?', plot: '   ' },
      ipHeader
    );
    assert.equal(emptyPlot.status, 400);
    assert.equal(emptyPlot.data.error, 'invalid_plot');

    const nonStringPlot = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'Hello?', plot: 42 },
      ipHeader
    );
    assert.equal(nonStringPlot.status, 400);
    assert.equal(nonStringPlot.data.error, 'invalid_plot');

    // Quota is still untouched -> valid post succeeds 201
    const okPost = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'Nice porch!', plot: ' wick ' },
      ipHeader
    );
    assert.equal(okPost.status, 201);

    // GET validation
    const getUnknown = await visitor.getGuestbook(undefined, 'nobody');
    assert.equal(getUnknown.status, 400);
    assert.equal(getUnknown.data.error, 'unknown_plot');

    const getEmptyRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?plot=`);
    assert.equal(getEmptyRes.status, 400);
    assert.equal((await getEmptyRes.json()).error, 'invalid_plot');

    const getSpaceRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?plot=%20%20`);
    assert.equal(getSpaceRes.status, 400);
    assert.equal((await getSpaceRes.json()).error, 'invalid_plot');
  } finally {
    await ctx.close();
  }
});

test('owner cottage plot=milo is a valid guestbook plot without a resident row (slice 327)', async () => {
  const ctx = await startTestServer();
  try {
    // No resident is registered at all — 'milo' must still work, because the
    // owner's cottage (pad 1) has a guestbook but holds no resident row by
    // design. Before the fix, GET ?plot=milo 400'd unknown_plot and the
    // cottage overlay showed the "couldn't be reached" fallback.
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const ipHeader = { 'X-Forwarded-For': '203.0.113.99' };

    const getRes = await visitor.getGuestbook(undefined, 'milo');
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.data, { entries: [] });

    const postRes = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'Lovely cottage!', plot: 'milo' },
      ipHeader
    );
    assert.equal(postRes.status, 201);
    assert.equal(postRes.data.status, 'pending');

    // A genuinely unknown handle still 400s.
    const getUnknown = await visitor.getGuestbook(undefined, 'nobody');
    assert.equal(getUnknown.status, 400);
    assert.equal(getUnknown.data.error, 'unknown_plot');
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/guestbook composes ?kind= and ?plot= filters', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const p1 = await visitor.signGuestbook('guestbook', 'Guest', 'Nice cottage', 'wick');
    const g1 = await visitor.signGuestbook('guestbook', 'Gate Guest', 'Nice gate');
    const l1 = await visitor.signGuestbook('letter', 'Reader', 'Nice paper');
    assert.equal(p1.status, 201);
    assert.equal(g1.status, 201);
    assert.equal(l1.status, 201);

    await admin.moderateGuestbook(p1.data.id, 'approve');
    await admin.moderateGuestbook(g1.data.id, 'approve');
    await admin.moderateGuestbook(l1.data.id, 'approve');

    const wickLetters = await visitor.getGuestbook('letter', 'wick');
    assert.equal(wickLetters.status, 200);
    assert.deepEqual(wickLetters.data.entries, []);

    const wickGuestbook = await visitor.getGuestbook('guestbook', 'wick');
    assert.equal(wickGuestbook.status, 200);
    assert.equal(wickGuestbook.data.entries.length, 1);
    assert.equal(wickGuestbook.data.entries[0].id, p1.data.id);

    const gateAll = await visitor.getGuestbook();
    assert.equal(gateAll.status, 200);
    assert.equal(gateAll.data.entries.length, 2);

    const s = await visitor.state();
    assert.deepEqual(s.data.guestbook, { signed: 1, letters: 1 });
    assert.deepEqual(s.data.guestbook_by_plot, { wick: 1 });
  } finally {
    await ctx.close();
  }
});

test('startup migration adds plot column to old guestbook schema and keeps existing rows gate-only', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-migrate-guestbook-'));
  const dbPath = path.join(tmpDir, 'town.db');

  const oldDb = new DatabaseSync(dbPath);
  oldDb.exec(`
    CREATE TABLE residents (
      handle TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('musebook', 'colony', 'rstation', 'guestbook', 'direct')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'muted', 'suspended')),
      role TEXT NOT NULL DEFAULT 'muse' CHECK (role IN ('muse', 'npc')),
      bio TEXT NOT NULL DEFAULT '',
      plot_updated_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE guestbook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('guestbook', 'letter')),
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO meta (key, value) VALUES ('state_seq', '1');
  `);
  const now = Math.floor(Date.now() / 1000);
  oldDb
    .prepare("INSERT INTO guestbook (kind, name, body, status, created_at) VALUES ('guestbook', 'Old Visitor', 'Before plots existed.', 'approved', ?)")
    .run(now - 60);
  oldDb.close();

  const ctx = await startTestServer({ dbPath });
  try {
    const cols = ctx.db.prepare('PRAGMA table_info(guestbook)').all();
    assert.ok(cols.some((c) => c.name === 'plot'), 'plot column added by startup migration');

    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const postPlot = await visitor.signGuestbook('guestbook', 'New Visitor', 'Hello Wick!', 'wick');
    assert.equal(postPlot.status, 201);
    await admin.moderateGuestbook(postPlot.data.id, 'approve');

    const gate = await visitor.getGuestbook();
    assert.equal(gate.status, 200);
    assert.equal(gate.data.entries.length, 1);
    assert.equal(gate.data.entries[0].name, 'Old Visitor');

    const wickGb = await visitor.getGuestbook(undefined, 'wick');
    assert.equal(wickGb.status, 200);
    assert.equal(wickGb.data.entries.length, 1);
    assert.equal(wickGb.data.entries[0].name, 'New Visitor');

    const s = await visitor.state();
    assert.deepEqual(s.data.guestbook, { signed: 1, letters: 0 });
    assert.deepEqual(s.data.guestbook_by_plot, { wick: 1 });
  } finally {
    await ctx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GET ordering newest-first returns strictly descending ids', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const ids = [];
    for (let i = 1; i <= 3; i++) {
      const res = await visitor.signGuestbook('guestbook', `Guest ${i}`, `Entry ${i}`);
      assert.equal(res.status, 201);
      const app = await admin.moderateGuestbook(res.data.id, 'approve');
      assert.equal(app.status, 200);
      ids.push(res.data.id);
      ctx.advanceClock(1);
    }

    const getRes = await visitor.getGuestbook();
    assert.equal(getRes.status, 200);
    const gotIds = getRes.data.entries.map((e) => e.id);
    assert.deepEqual(gotIds, [ids[2], ids[1], ids[0]]);
    assert.ok(gotIds[0] > gotIds[1] && gotIds[1] > gotIds[2]);
  } finally {
    await ctx.close();
  }
});

test('GET limit param validates bad values, treats empty as default, and clamps 100 to 50', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const ids = [];
    for (let i = 1; i <= 3; i++) {
      const res = await visitor.signGuestbook('guestbook', `Visitor ${i}`, `Line ${i}`);
      assert.equal(res.status, 201);
      const app = await admin.moderateGuestbook(res.data.id, 'approve');
      assert.equal(app.status, 200);
      ids.push(res.data.id);
      ctx.advanceClock(1);
    }

    for (const bad of ['0', '-1', 'abc', '1.5']) {
      const res = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=${bad}`);
      assert.equal(res.status, 400, `limit=${bad} should return 400`);
      const data = await res.json();
      assert.equal(data.error, 'invalid_limit');
    }

    const emptyRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=`);
    assert.equal(emptyRes.status, 200);
    const emptyData = await emptyRes.json();
    assert.equal(emptyData.entries.length, 3);

    const twoRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=2`);
    assert.equal(twoRes.status, 200);
    const twoData = await twoRes.json();
    assert.deepEqual(twoData.entries.map((e) => e.id), [ids[2], ids[1]]);

    const hundredRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=100`);
    assert.equal(hundredRes.status, 200);
    const hundredData = await hundredRes.json();
    assert.equal(hundredData.entries.length, 3);
  } finally {
    await ctx.close();
  }
});

test('GET 50-entry cap returns newest 50 of 55 seeded rows', async () => {
  const ctx = await startTestServer();
  try {
    const baseTime = ctx.nowSec() - 100;
    const stmt = ctx.db.prepare(
      "INSERT INTO guestbook (kind, name, body, status, plot, created_at) VALUES ('guestbook', ?, ?, 'approved', NULL, ?)"
    );
    for (let i = 1; i <= 55; i++) {
      stmt.run(`Guest ${i}`, `Message ${i}`, baseTime + i);
    }

    const res = await fetch(`${ctx.baseUrl}/api/town/guestbook`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.entries.length, 50);
    assert.equal(data.entries[0].id, 55);
    assert.equal(data.entries[49].id, 6);
  } finally {
    await ctx.close();
  }
});

test('moderation auth rejects missing headers and non-operator signatures while keeping pending entry approvable', async () => {
  const ctx = await startTestServer();
  try {
    const resident = await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const signRes = await visitor.signGuestbook('guestbook', 'Guest', 'Waiting for approval.');
    assert.equal(signRes.status, 201);
    const id = signRes.data.id;

    const noAuth = await rawPost(ctx.baseUrl, '/api/town/admin/guestbook', { id, action: 'approve' });
    assert.equal(noAuth.status, 401);
    assert.equal(noAuth.data.error, 'missing_auth_headers');

    const nonOp = await resident.moderateGuestbook(id, 'approve');
    assert.equal(nonOp.status, 401);
    assert.equal(nonOp.data.error, 'invalid_signature');

    const opApprove = await admin.moderateGuestbook(id, 'approve');
    assert.equal(opApprove.status, 200);
    assert.deepEqual(opApprove.data, { id, status: 'approved' });
  } finally {
    await ctx.close();
  }
});

test('boundary sizes and types accept exact limits after trimming and reject numeric inputs without burning quota', async () => {
  const ctx = await startTestServer();
  try {
    const ipHeader = { 'X-Forwarded-For': '203.0.113.77' };

    const numName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 12345, body: 'Hello!' },
      ipHeader
    );
    assert.equal(numName.status, 400);
    assert.equal(numName.data.error, 'invalid_name');

    const numBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 67890 },
      ipHeader
    );
    assert.equal(numBody.status, 400);
    assert.equal(numBody.data.error, 'invalid_body');

    const exactName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'a'.repeat(40), body: 'Valid body' },
      ipHeader
    );
    assert.equal(exactName.status, 201);

    const exactBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'b'.repeat(500) },
      ipHeader
    );
    assert.equal(exactBody.status, 201);

    const paddedName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: `  ${'c'.repeat(40)}  `, body: 'Trimmed name' },
      ipHeader
    );
    assert.equal(paddedName.status, 201);
  } finally {
    await ctx.close();
  }
});

test('filter composition combines kind, plot, and limit and keeps letters gate-only', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const p1 = await visitor.signGuestbook('guestbook', 'Guest 1', 'First porch note', 'wick');
    assert.equal(p1.status, 201);
    ctx.advanceClock(1);
    const p2 = await visitor.signGuestbook('guestbook', 'Guest 2', 'Second porch note', 'wick');
    assert.equal(p2.status, 201);
    ctx.advanceClock(1);
    const g1 = await visitor.signGuestbook('guestbook', 'Gate Guest', 'Gate note');
    assert.equal(g1.status, 201);

    await admin.moderateGuestbook(p1.data.id, 'approve');
    await admin.moderateGuestbook(p2.data.id, 'approve');
    await admin.moderateGuestbook(g1.data.id, 'approve');

    const res = await fetch(`${ctx.baseUrl}/api/town/guestbook?kind=guestbook&plot=wick&limit=1`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].id, p2.data.id);

    const lettersRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?kind=letter&plot=wick`);
    assert.equal(lettersRes.status, 200);
    const lettersData = await lettersRes.json();
    assert.deepEqual(lettersData.entries, []);
  } finally {
    await ctx.close();
  }
});

test('invalid posts do not burn the 3-per-hour quota; X-Forwarded-For bucket is keyed on the first IP', async () => {
  const ctx = await startTestServer();
  try {
    const ipHeader = { 'X-Forwarded-For': '203.0.113.90' };

    const emptyName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: '   ', body: 'Hello!' },
      ipHeader
    );
    assert.equal(emptyName.status, 400);
    assert.equal(emptyName.data.error, 'invalid_name');

    const emptyBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: '   ' },
      ipHeader
    );
    assert.equal(emptyBody.status, 400);
    assert.equal(emptyBody.data.error, 'invalid_body');

    const urlBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'see http://x.co' },
      ipHeader
    );
    assert.equal(urlBody.status, 400);
    assert.equal(urlBody.data.error, 'urls_not_allowed');

    for (let i = 1; i <= 3; i++) {
      const ok = await rawPost(
        ctx.baseUrl,
        '/api/town/guestbook',
        { kind: 'guestbook', name: `G${i}`, body: `Line ${i}` },
        ipHeader
      );
      assert.equal(ok.status, 201, `valid sign #${i} should succeed`);
    }

    const r4 = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'G4', body: 'Line 4' },
      ipHeader
    );
    assert.equal(r4.status, 429);
    assert.equal(r4.data.error, 'rate_limited');
    assert.ok(Number.isInteger(r4.data.retry_after) && r4.data.retry_after > 0);

    const sameFirstIp = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'G5', body: 'Line 5' },
      { 'X-Forwarded-For': '203.0.113.90, 198.51.100.2' }
    );
    assert.equal(sameFirstIp.status, 429);
    assert.equal(sameFirstIp.data.error, 'rate_limited');

    const otherFirstIp = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'G6', body: 'Line 6' },
      { 'X-Forwarded-For': '198.51.100.2' }
    );
    assert.equal(otherFirstIp.status, 201);
  } finally {
    await ctx.close();
  }
});

test('URL check is body-only and scheme-specific', async () => {
  const ctx = await startTestServer();
  try {
    const urlName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'http://evil', body: 'Hello!' },
      { 'X-Forwarded-For': '203.0.113.101' }
    );
    assert.equal(urlName.status, 201);

    const bareWww = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'visit www.example.com today' },
      { 'X-Forwarded-For': '203.0.113.102' }
    );
    assert.equal(bareWww.status, 201);

    const ftpUrl = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'grab ftp://files.example.com/x' },
      { 'X-Forwarded-For': '203.0.113.103' }
    );
    assert.equal(ftpUrl.status, 201);

    const upperHttp = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Alice', body: 'see HTTP://EXAMPLE.COM' },
      { 'X-Forwarded-For': '203.0.113.104' }
    );
    assert.equal(upperHttp.status, 400);
    assert.equal(upperHttp.data.error, 'urls_not_allowed');

    const letterHttps = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'letter', name: 'Alice', body: 'link https://x.co/page here' },
      { 'X-Forwarded-For': '203.0.113.104' }
    );
    assert.equal(letterHttps.status, 400);
    assert.equal(letterHttps.data.error, 'urls_not_allowed');
  } finally {
    await ctx.close();
  }
});

test('moderation invalid_id edges: 0, -1, 1.5, string, missing; id checked before action', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const signRes = await visitor.signGuestbook('guestbook', 'Alice', 'Pending note.');
    assert.equal(signRes.status, 201);
    const id = signRes.data.id;

    for (const badId of [0, -1, 1.5, '3', null]) {
      const res = await admin.moderateGuestbook(badId, 'approve');
      assert.equal(res.status, 400, `id=${JSON.stringify(badId)} should return 400`);
      assert.equal(res.data.error, 'invalid_id');
    }

    const missingId = await admin._signedPost('/api/town/admin/guestbook', { action: 'approve' });
    assert.equal(missingId.status, 400);
    assert.equal(missingId.data.error, 'invalid_id');

    const idBeforeAction = await admin.moderateGuestbook(0, 'archive');
    assert.equal(idBeforeAction.status, 400);
    assert.equal(idBeforeAction.data.error, 'invalid_id');

    const approved = await admin.moderateGuestbook(id, 'approve');
    assert.equal(approved.status, 200);
    assert.deepEqual(approved.data, { id, status: 'approved' });
  } finally {
    await ctx.close();
  }
});

test('per-plot reject stays hidden, bumps nothing, and 409 carries the rejected status', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const s0 = await visitor.state();
    assert.equal(s0.status, 200);
    const seq0 = s0.data.state_seq;

    const signRes = await visitor.signGuestbook('guestbook', 'Guest', 'Porch note.', 'wick');
    assert.equal(signRes.status, 201);
    const id = signRes.data.id;

    const rejRes = await admin.moderateGuestbook(id, 'reject');
    assert.equal(rejRes.status, 200);
    assert.deepEqual(rejRes.data, { id, status: 'rejected' });

    const s1 = await visitor.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.state_seq, seq0);
    assert.deepEqual(s1.data.guestbook, { signed: 0, letters: 0 });
    assert.deepEqual(s1.data.guestbook_by_plot, {});

    const plotGet = await visitor.getGuestbook(undefined, 'wick');
    assert.equal(plotGet.status, 200);
    assert.deepEqual(plotGet.data.entries, []);

    const reReject = await admin.moderateGuestbook(id, 'reject');
    assert.equal(reReject.status, 409);
    assert.equal(reReject.data.error, 'already_decided');
    assert.equal(reReject.data.status, 'rejected');

    const approveAfterReject = await admin.moderateGuestbook(id, 'approve');
    assert.equal(approveAfterReject.status, 409);
    assert.equal(approveAfterReject.data.error, 'already_decided');
    assert.equal(approveAfterReject.data.status, 'rejected');
  } finally {
    await ctx.close();
  }
});

test('same-created_at tie-break orders by id DESC', async () => {
  const ctx = await startTestServer();
  try {
    const baseTime = ctx.nowSec() - 100;
    const stmt = ctx.db.prepare(
      "INSERT INTO guestbook (kind, name, body, status, plot, created_at) VALUES ('guestbook', ?, ?, 'approved', NULL, ?)"
    );
    for (let i = 1; i <= 3; i++) {
      stmt.run(`Guest ${i}`, `Message ${i}`, baseTime);
    }

    const res = await fetch(`${ctx.baseUrl}/api/town/guestbook`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.entries.map((e) => e.id), [3, 2, 1]);
    assert.equal(data.entries[0].name, 'Guest 3');
  } finally {
    await ctx.close();
  }
});

test('explicit plot:null signs at the gate; empty ?kind= means no filter; whitespace ?kind= is invalid', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const gateNull = await rawPost(ctx.baseUrl, '/api/town/guestbook', {
      kind: 'guestbook',
      name: 'Gate Fan',
      body: 'Lovely gate!',
      plot: null,
    });
    assert.equal(gateNull.status, 201);

    const letterRes = await visitor.signGuestbook('letter', 'Reader', 'To the editor.');
    assert.equal(letterRes.status, 201);

    const app1 = await admin.moderateGuestbook(gateNull.data.id, 'approve');
    assert.equal(app1.status, 200);
    const app2 = await admin.moderateGuestbook(letterRes.data.id, 'approve');
    assert.equal(app2.status, 200);

    const s = await visitor.state();
    assert.equal(s.status, 200);
    assert.deepEqual(s.data.guestbook, { signed: 1, letters: 1 });
    assert.deepEqual(s.data.guestbook_by_plot, {});

    const gateAll = await visitor.getGuestbook();
    assert.equal(gateAll.status, 200);
    assert.equal(gateAll.data.entries.length, 2);
    const gbEntry = gateAll.data.entries.find((e) => e.kind === 'guestbook');
    assert.ok(gbEntry);
    assert.equal(gbEntry.name, 'Gate Fan');

    const wickGet = await visitor.getGuestbook(undefined, 'wick');
    assert.equal(wickGet.status, 200);
    assert.deepEqual(wickGet.data.entries, []);

    const emptyKindRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?kind=`);
    assert.equal(emptyKindRes.status, 200);
    const emptyKindData = await emptyKindRes.json();
    assert.equal(emptyKindData.entries.length, 2);

    const wsKindRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?kind=%20%20`);
    assert.equal(wsKindRes.status, 400);
    const wsKindData = await wsKindRes.json();
    assert.equal(wsKindData.error, 'invalid_kind');
  } finally {
    await ctx.close();
  }
});

test('GET ?plot= trims surrounding whitespace around a valid plot', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const signRes = await visitor.signGuestbook('guestbook', 'Porch Fan', 'Lovely porch.', 'wick');
    assert.equal(signRes.status, 201);

    const appRes = await admin.moderateGuestbook(signRes.data.id, 'approve');
    assert.equal(appRes.status, 200);

    const res = await fetch(`${ctx.baseUrl}/api/town/guestbook?plot=%20wick%20`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.entries.length, 1);
    assert.equal(data.entries[0].id, signRes.data.id);
  } finally {
    await ctx.close();
  }
});

test('plot handles are case-sensitive on POST and GET', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');

    const postRes = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A', body: 'hi', plot: 'WICK' },
      { 'X-Forwarded-For': '203.0.113.111' }
    );
    assert.equal(postRes.status, 400);
    assert.equal(postRes.data.error, 'unknown_plot');

    const getRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?plot=WICK`);
    assert.equal(getRes.status, 400);
    const getData = await getRes.json();
    assert.equal(getData.error, 'unknown_plot');
  } finally {
    await ctx.close();
  }
});

test('re-approve 409 carries the approved status', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const signRes = await visitor.signGuestbook('guestbook', 'Gate Fan', 'Gate note.');
    assert.equal(signRes.status, 201);

    const appRes = await admin.moderateGuestbook(signRes.data.id, 'approve');
    assert.equal(appRes.status, 200);

    const reAppRes = await admin.moderateGuestbook(signRes.data.id, 'approve');
    assert.equal(reAppRes.status, 409);
    assert.equal(reAppRes.data.error, 'already_decided');
    assert.equal(reAppRes.data.status, 'approved');
  } finally {
    await ctx.close();
  }
});

test('rate-limit bucket is per-IP, not per-kind', async () => {
  const ctx = await startTestServer();
  try {
    const ipHeader = { 'X-Forwarded-For': '203.0.113.77' };
    for (let i = 0; i < 3; i++) {
      const res = await rawPost(
        ctx.baseUrl,
        '/api/town/guestbook',
        { kind: 'guestbook', name: `Guest ${i}`, body: `note ${i}` },
        ipHeader
      );
      assert.equal(res.status, 201);
    }

    const fourth = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'letter', name: 'Guest 3', body: 'letter 3' },
      ipHeader
    );
    assert.equal(fourth.status, 429);
    assert.equal(fourth.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('signing at a joined-but-unapproved resident plot succeeds (existence-only check)', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const newbie = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'newbie',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    const joinRes = await newbie.join({ origin: 'colony', bio: '' });
    assert.equal(joinRes.status, 201);

    const row = ctx.db.prepare('SELECT status FROM residents WHERE handle = ?').get('newbie');
    assert.ok(row);
    assert.notEqual(row.status, 'approved');

    const signRes = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Early', body: 'Welcome!', plot: 'newbie' },
      { 'X-Forwarded-For': '203.0.113.78' }
    );
    assert.equal(signRes.status, 201);
  } finally {
    await ctx.close();
  }
});

test('GET entries expose exactly id/kind/name/body/created_at, no status or plot leak', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const gateSign = await visitor.signGuestbook('guestbook', 'Gate Visitor', 'Hello gate.');
    assert.equal(gateSign.status, 201);
    assert.equal((await admin.moderateGuestbook(gateSign.data.id, 'approve')).status, 200);

    const plotSign = await visitor.signGuestbook('guestbook', 'Plot Visitor', 'Hello wick.', 'wick');
    assert.equal(plotSign.status, 201);
    assert.equal((await admin.moderateGuestbook(plotSign.data.id, 'approve')).status, 200);

    const gateGet = await visitor.getGuestbook();
    assert.equal(gateGet.status, 200);
    assert.equal(gateGet.data.entries.length, 1);
    assert.deepEqual(Object.keys(gateGet.data.entries[0]).sort(), ['body', 'created_at', 'id', 'kind', 'name']);

    const plotGet = await visitor.getGuestbook(undefined, 'wick');
    assert.equal(plotGet.status, 200);
    assert.equal(plotGet.data.entries.length, 1);
    assert.deepEqual(Object.keys(plotGet.data.entries[0]).sort(), ['body', 'created_at', 'id', 'kind', 'name']);
  } finally {
    await ctx.close();
  }
});

test('validation precedence and error max fields (G1)', async () => {
  const ctx = await startTestServer();
  try {
    const ip = { 'X-Forwarded-For': '203.0.113.101' };

    const badKind = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'note', name: '   ', body: '   ' },
      ip
    );
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');

    const badName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: '   ', body: '   ' },
      ip
    );
    assert.equal(badName.status, 400);
    assert.equal(badName.data.error, 'invalid_name');

    const longBeforeUrl = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A', body: 'b'.repeat(501) + ' http://x.co' },
      ip
    );
    assert.equal(longBeforeUrl.status, 400);
    assert.equal(longBeforeUrl.data.error, 'invalid_body');

    const maxName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'a'.repeat(41), body: 'x' },
      ip
    );
    assert.equal(maxName.status, 400);
    assert.deepEqual(maxName.data, { error: 'invalid_name', max: 40 });

    const maxBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A', body: 'b'.repeat(501) },
      ip
    );
    assert.equal(maxBody.status, 400);
    assert.deepEqual(maxBody.data, { error: 'invalid_body', max: 500 });

    const missingKind = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { name: 'A', body: 'x' },
      ip
    );
    assert.equal(missingKind.status, 400);
    assert.equal(missingKind.data.error, 'invalid_kind');

    const missingName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', body: 'x' },
      ip
    );
    assert.equal(missingName.status, 400);
    assert.equal(missingName.data.error, 'invalid_name');

    const missingBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A' },
      ip
    );
    assert.equal(missingBody.status, 400);
    assert.equal(missingBody.data.error, 'invalid_body');
  } finally {
    await ctx.close();
  }
});

test('kind is case-sensitive on POST and GET (G2)', async () => {
  const ctx = await startTestServer();
  try {
    const ip = { 'X-Forwarded-For': '203.0.113.102' };

    const postTitle = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'Guestbook', name: 'A', body: 'x' },
      ip
    );
    assert.equal(postTitle.status, 400);
    assert.equal(postTitle.data.error, 'invalid_kind');

    const postUpper = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'GUESTBOOK', name: 'A', body: 'x' },
      ip
    );
    assert.equal(postUpper.status, 400);
    assert.equal(postUpper.data.error, 'invalid_kind');

    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });

    const getTitle = await visitor.getGuestbook('Guestbook');
    assert.equal(getTitle.status, 400);
    assert.equal(getTitle.data.error, 'invalid_kind');

    const getUpper = await visitor.getGuestbook('LETTER');
    assert.equal(getUpper.status, 400);
    assert.equal(getUpper.data.error, 'invalid_kind');
  } finally {
    await ctx.close();
  }
});

test('URL regex edges: single slash, spaced scheme, bare scheme, embedded scheme (G3)', async () => {
  const ctx = await startTestServer();
  try {
    const r1 = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A', body: 'http:/single-slash' },
      { 'X-Forwarded-For': '203.0.113.103' }
    );
    assert.equal(r1.status, 201);

    const r2 = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A', body: 'see http ://x' },
      { 'X-Forwarded-For': '203.0.113.104' }
    );
    assert.equal(r2.status, 201);

    const r3 = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A', body: 'https://' },
      { 'X-Forwarded-For': '203.0.113.105' }
    );
    assert.equal(r3.status, 400);
    assert.equal(r3.data.error, 'urls_not_allowed');

    const r4 = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A', body: 'visit www.http://x.co' },
      { 'X-Forwarded-For': '203.0.113.106' }
    );
    assert.equal(r4.status, 400);
    assert.equal(r4.data.error, 'urls_not_allowed');
  } finally {
    await ctx.close();
  }
});

test('retry_after is exactly 3600 on fixed clock and window boundary evicts at +3600 (G4)', async () => {
  const ctxA = await startTestServer({ nowFn: () => 1700000000 });
  try {
    const ip = { 'X-Forwarded-For': '203.0.113.107' };
    for (let i = 0; i < 3; i++) {
      const res = await rawPost(
        ctxA.baseUrl,
        '/api/town/guestbook',
        { kind: 'guestbook', name: `Guest ${i}`, body: `hi ${i}` },
        ip
      );
      assert.equal(res.status, 201);
    }
    const fourth = await rawPost(
      ctxA.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Guest 3', body: 'hi 3' },
      ip
    );
    assert.equal(fourth.status, 429);
    assert.equal(fourth.data.error, 'rate_limited');
    assert.equal(fourth.data.retry_after, 3600);
  } finally {
    await ctxA.close();
  }

  const ctxB = await startTestServer();
  try {
    const ip = { 'X-Forwarded-For': '203.0.113.108' };
    for (let i = 0; i < 3; i++) {
      const res = await rawPost(
        ctxB.baseUrl,
        '/api/town/guestbook',
        { kind: 'guestbook', name: `Guest ${i}`, body: `hi ${i}` },
        ip
      );
      assert.equal(res.status, 201);
    }
    ctxB.advanceClock(3600);
    const afterBoundary = await rawPost(
      ctxB.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Guest 3', body: 'hi 3' },
      ip
    );
    assert.equal(afterBoundary.status, 201);
  } finally {
    await ctxB.close();
  }
});

test('guestbook_pending counts gate + plot + letter pendings and drains on decide (G5)', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const gateRes = await visitor.signGuestbook('guestbook', 'Gate Fan', 'Nice gate.');
    assert.equal(gateRes.status, 201);
    const plotRes = await visitor.signGuestbook('guestbook', 'Plot Fan', 'Nice lamp.', 'wick');
    assert.equal(plotRes.status, 201);
    const letterRes = await visitor.signGuestbook('letter', 'Reader', 'Nice gazette.');
    assert.equal(letterRes.status, 201);

    const s0 = await visitor.state();
    assert.equal(s0.status, 200);
    assert.equal(s0.data.guestbook_pending, 3);
    assert.deepEqual(s0.data.guestbook, { signed: 0, letters: 0 });

    assert.equal((await admin.moderateGuestbook(gateRes.data.id, 'approve')).status, 200);
    const s1 = await visitor.state();
    assert.equal(s1.data.guestbook_pending, 2);

    assert.equal((await admin.moderateGuestbook(letterRes.data.id, 'reject')).status, 200);
    const s2 = await visitor.state();
    assert.equal(s2.data.guestbook_pending, 1);

    assert.equal((await admin.moderateGuestbook(plotRes.data.id, 'approve')).status, 200);
    const s3 = await visitor.state();
    assert.equal(s3.data.guestbook_pending, 0);
    assert.deepEqual(s3.data.guestbook, { signed: 1, letters: 0 });
    assert.deepEqual(s3.data.guestbook_by_plot, { wick: 1 });
  } finally {
    await ctx.close();
  }
});

test('two approves bump state_seq by +2 and a reject bumps 0 (G6)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const seq0 = (await visitor.state()).data.state_seq;

    const g1 = await visitor.signGuestbook('guestbook', 'One', 'First note.');
    const g2 = await visitor.signGuestbook('guestbook', 'Two', 'Second note.');
    const g3 = await visitor.signGuestbook('guestbook', 'Three', 'Third note.');
    assert.equal(g1.status, 201);
    assert.equal(g2.status, 201);
    assert.equal(g3.status, 201);

    assert.equal((await admin.moderateGuestbook(g1.data.id, 'approve')).status, 200);
    assert.equal((await visitor.state()).data.state_seq, seq0 + 1);

    assert.equal((await admin.moderateGuestbook(g2.data.id, 'approve')).status, 200);
    assert.equal((await visitor.state()).data.state_seq, seq0 + 2);

    assert.equal((await admin.moderateGuestbook(g3.data.id, 'reject')).status, 200);
    assert.equal((await visitor.state()).data.state_seq, seq0 + 2);
  } finally {
    await ctx.close();
  }
});

test('milo plot approve lifecycle surfaces entry and counts it by plot (G7)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const signRes = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Milo Fan', body: 'Lovely cottage!', plot: 'milo' },
      { 'X-Forwarded-For': '203.0.113.109' }
    );
    assert.equal(signRes.status, 201);
    assert.equal(signRes.data.status, 'pending');

    const beforeGet = await visitor.getGuestbook(undefined, 'milo');
    assert.equal(beforeGet.status, 200);
    assert.deepEqual(beforeGet.data.entries, []);

    const appRes = await admin.moderateGuestbook(signRes.data.id, 'approve');
    assert.equal(appRes.status, 200);

    const afterGet = await visitor.getGuestbook(undefined, 'milo');
    assert.equal(afterGet.status, 200);
    assert.equal(afterGet.data.entries.length, 1);
    assert.equal(afterGet.data.entries[0].id, signRes.data.id);

    const s = await visitor.state();
    assert.deepEqual(s.data.guestbook_by_plot, { milo: 1 });
    assert.deepEqual(s.data.guestbook, { signed: 0, letters: 0 });
  } finally {
    await ctx.close();
  }
});

test('guestbook_by_plot counts two plots independently alongside the gate (G8)', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    await registerResident(ctx, 'maren');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const wickSign = await visitor.signGuestbook('guestbook', 'A', 'For wick', 'wick');
    const marenSign = await visitor.signGuestbook('guestbook', 'B', 'For maren', 'maren');
    const gateSign = await visitor.signGuestbook('guestbook', 'C', 'For gate');
    assert.equal(wickSign.status, 201);
    assert.equal(marenSign.status, 201);
    assert.equal(gateSign.status, 201);

    assert.equal((await admin.moderateGuestbook(wickSign.data.id, 'approve')).status, 200);
    assert.equal((await admin.moderateGuestbook(marenSign.data.id, 'approve')).status, 200);
    assert.equal((await admin.moderateGuestbook(gateSign.data.id, 'approve')).status, 200);

    const s = await visitor.state();
    assert.equal(s.data.guestbook_by_plot.wick, 1);
    assert.equal(s.data.guestbook_by_plot.maren, 1);
    assert.equal(Object.keys(s.data.guestbook_by_plot).length, 2);
    assert.deepEqual(s.data.guestbook, { signed: 1, letters: 0 });
  } finally {
    await ctx.close();
  }
});

test('POST response has exact keys id/status and ignores client-supplied status/id/created_at (G9)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const res = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Sneaky', body: 'hi', status: 'approved', id: 999, created_at: 1 },
      { 'X-Forwarded-For': '203.0.113.110' }
    );
    assert.equal(res.status, 201);
    assert.equal(res.data.status, 'pending');
    assert.deepEqual(Object.keys(res.data).sort(), ['id', 'status']);

    const row = ctx.db.prepare('SELECT status, id FROM guestbook WHERE id = ?').get(res.data.id);
    assert.ok(row);
    assert.equal(row.status, 'pending');
    assert.equal(row.id, res.data.id);

    const gateGet = await visitor.getGuestbook();
    assert.equal(gateGet.status, 200);
    assert.deepEqual(gateGet.data.entries, []);
  } finally {
    await ctx.close();
  }
});

test('GET limit edges with 55 seeded rows: 51 clamps, 1 newest, 2.0 accepted, 50 exact (G10)', async () => {
  const ctx = await startTestServer();
  try {
    const baseTime = ctx.nowSec() - 100;
    const stmt = ctx.db.prepare(
      "INSERT INTO guestbook (kind, name, body, status, plot, created_at) VALUES ('guestbook', ?, ?, 'approved', NULL, ?)"
    );
    for (let i = 1; i <= 55; i++) {
      stmt.run(`Guest ${i}`, `Message ${i}`, baseTime + i);
    }

    const r51 = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=51`);
    assert.equal(r51.status, 200);
    const d51 = await r51.json();
    assert.equal(d51.entries.length, 50);
    assert.equal(d51.entries[0].id, 55);
    assert.equal(d51.entries[49].id, 6);

    const r1 = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=1`);
    assert.equal(r1.status, 200);
    const d1 = await r1.json();
    assert.equal(d1.entries.length, 1);
    assert.equal(d1.entries[0].id, 55);

    const r20 = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=2.0`);
    assert.equal(r20.status, 200);
    const d20 = await r20.json();
    assert.equal(d20.entries.length, 2);
    assert.equal(d20.entries[0].id, 55);
    assert.equal(d20.entries[1].id, 54);

    const r50 = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=50`);
    assert.equal(r50.status, 200);
    const d50 = await r50.json();
    assert.equal(d50.entries.length, 50);
    assert.equal(d50.entries[0].id, 55);
  } finally {
    await ctx.close();
  }
});

test('POST plot validation runs after kind, name, body, and URL checks (G11)', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');

    const badName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: '   ', body: 'hi', plot: 'nobody' },
      { 'X-Forwarded-For': '203.0.113.111' }
    );
    assert.equal(badName.status, 400);
    assert.equal(badName.data.error, 'invalid_name');

    const urlBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Ada', body: 'see http://x.co', plot: 'nobody' },
      { 'X-Forwarded-For': '203.0.113.112' }
    );
    assert.equal(urlBody.status, 400);
    assert.equal(urlBody.data.error, 'urls_not_allowed');

    const letterUnknown = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'letter', name: 'Ada', body: 'hi', plot: 'nobody' },
      { 'X-Forwarded-For': '203.0.113.113' }
    );
    assert.equal(letterUnknown.status, 400);
    assert.equal(letterUnknown.data.error, 'unknown_plot');

    const letterKnown = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'letter', name: 'Ada', body: 'hi', plot: 'wick' },
      { 'X-Forwarded-For': '203.0.113.114' }
    );
    assert.equal(letterKnown.status, 400);
    assert.equal(letterKnown.data.error, 'invalid_plot');

    const numPlot = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Ada', body: 'hi', plot: 42 },
      { 'X-Forwarded-For': '203.0.113.115' }
    );
    assert.equal(numPlot.status, 400);
    assert.equal(numPlot.data.error, 'invalid_plot');

    const boolPlot = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Ada', body: 'hi', plot: true },
      { 'X-Forwarded-For': '203.0.113.116' }
    );
    assert.equal(boolPlot.status, 400);
    assert.equal(boolPlot.data.error, 'invalid_plot');

    const blankPlot = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Ada', body: 'hi', plot: '   ' },
      { 'X-Forwarded-For': '203.0.113.117' }
    );
    assert.equal(blankPlot.status, 400);
    assert.equal(blankPlot.data.error, 'invalid_plot');

    const paddedPlot = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Ada', body: 'hi', plot: '  wick  ' },
      { 'X-Forwarded-For': '203.0.113.118' }
    );
    assert.equal(paddedPlot.status, 201);
    assert.equal(paddedPlot.data.status, 'pending');
    const row = ctx.db.prepare('SELECT plot FROM guestbook WHERE id = ?').get(paddedPlot.data.id);
    assert.equal(row.plot, 'wick');
  } finally {
    await ctx.close();
  }
});

test('GET kind letter with plot returns empty and plot param edges (G12)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const unknownWick = await visitor.getGuestbook(undefined, 'wick');
    assert.equal(unknownWick.status, 400);
    assert.equal(unknownWick.data.error, 'unknown_plot');

    const miloPlot = await visitor.getGuestbook(undefined, 'milo');
    assert.equal(miloPlot.status, 200);
    assert.deepEqual(miloPlot.data.entries, []);

    await registerResident(ctx, 'wick');
    const sign = await visitor.signGuestbook('guestbook', 'Ada', 'Hi Wick', 'wick');
    assert.equal(sign.status, 201);
    assert.equal((await admin.moderateGuestbook(sign.data.id, 'approve')).status, 200);

    const letterWithPlot = await visitor.getGuestbook('letter', 'wick');
    assert.equal(letterWithPlot.status, 200);
    assert.deepEqual(letterWithPlot.data.entries, []);

    const emptyPlotRes = await fetch(`${ctx.baseUrl}/api/town/guestbook?plot=`);
    assert.equal(emptyPlotRes.status, 400);
    assert.equal((await emptyPlotRes.json()).error, 'invalid_plot');

    const paddedWick = await visitor.getGuestbook(undefined, '  wick  ');
    assert.equal(paddedWick.status, 200);
    assert.equal(paddedWick.data.entries.length, 1);
    assert.equal(paddedWick.data.entries[0].id, sign.data.id);

    const lettersOnly = await visitor.getGuestbook('letter');
    assert.equal(lettersOnly.status, 200);
    assert.deepEqual(lettersOnly.data.entries, []);
  } finally {
    await ctx.close();
  }
});

test('GET limit rejects 0, negative, non-integer, and non-numeric values (G13)', async () => {
  const ctx = await startTestServer();
  try {
    const baseTime = ctx.nowSec() - 100;
    const stmt = ctx.db.prepare(
      "INSERT INTO guestbook (kind, name, body, status, plot, created_at) VALUES ('guestbook', ?, ?, 'approved', NULL, ?)"
    );
    for (let i = 1; i <= 12; i++) {
      stmt.run(`Guest ${i}`, `Message ${i}`, baseTime + i);
    }

    for (const bad of ['0', '-1', 'abc', '1.5']) {
      const res = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=${bad}`);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'invalid_limit');
    }

    const r10 = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=%2010%20`);
    assert.equal(r10.status, 200);
    const d10 = await r10.json();
    assert.equal(d10.entries.length, 10);
    assert.equal(d10.entries[0].id, 12);
    assert.equal(d10.entries[9].id, 3);

    const r50 = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=50.0`);
    assert.equal(r50.status, 200);
    const d50 = await r50.json();
    assert.equal(d50.entries.length, 12);
    assert.equal(d50.entries[0].id, 12);
  } finally {
    await ctx.close();
  }
});

test('moderation validates id before action and returns exact decision bodies (G14)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const seq0 = (await visitor.state()).data.state_seq;
    const letter = await visitor.signGuestbook('letter', 'Reader', 'Dear Gazette, lovely.');
    assert.equal(letter.status, 201);
    const letterId = letter.data.id;

    const zeroBadAction = await admin.moderateGuestbook(0, 'delete');
    assert.equal(zeroBadAction.status, 400);
    assert.equal(zeroBadAction.data.error, 'invalid_id');

    const strId = await admin.moderateGuestbook('1', 'approve');
    assert.equal(strId.status, 400);
    assert.equal(strId.data.error, 'invalid_id');

    const floatId = await admin.moderateGuestbook(1.5, 'approve');
    assert.equal(floatId.status, 400);
    assert.equal(floatId.data.error, 'invalid_id');

    const missingId = await admin._signedPost('/api/town/admin/guestbook', { action: 'approve' });
    assert.equal(missingId.status, 400);
    assert.equal(missingId.data.error, 'invalid_id');

    const badAction = await admin.moderateGuestbook(letterId, 'delete');
    assert.equal(badAction.status, 400);
    assert.equal(badAction.data.error, 'invalid_action');

    const emptyAction = await admin.moderateGuestbook(letterId, '');
    assert.equal(emptyAction.status, 400);
    assert.equal(emptyAction.data.error, 'invalid_action');

    const missingAction = await admin._signedPost('/api/town/admin/guestbook', { id: letterId });
    assert.equal(missingAction.status, 400);
    assert.equal(missingAction.data.error, 'invalid_action');

    const notFound = await admin.moderateGuestbook(9999, 'approve');
    assert.equal(notFound.status, 404);
    assert.deepEqual(notFound.data, { error: 'guestbook_not_found' });

    const approved = await admin.moderateGuestbook(letterId, 'approve');
    assert.equal(approved.status, 200);
    assert.deepEqual(approved.data, { id: letterId, status: 'approved' });

    const s1 = await visitor.state();
    assert.equal(s1.data.state_seq, seq0 + 1);
    assert.equal(s1.data.guestbook.letters, 1);

    const gate = await visitor.signGuestbook('guestbook', 'Fan', 'Nice gate.');
    assert.equal(gate.status, 201);
    const gateId = gate.data.id;

    const rejected = await admin.moderateGuestbook(gateId, 'reject');
    assert.equal(rejected.status, 200);
    assert.deepEqual(rejected.data, { id: gateId, status: 'rejected' });
  } finally {
    await ctx.close();
  }
});

test('guestbook DB row exact shape and table info (G15)', async () => {
  const ctx = await startTestServer({ nowFn: () => 1700000000 });
  try {
    const cols = ctx.db.prepare('PRAGMA table_info(guestbook)').all().map((r) => ({ ...r }));
    assert.deepEqual(
      cols.map((c) => c.name),
      ['id', 'kind', 'name', 'body', 'plot', 'status', 'created_at']
    );
    assert.deepEqual(
      cols.map((c) => c.type),
      ['INTEGER', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT', 'INTEGER']
    );
    assert.deepEqual(
      cols.map((c) => c.pk),
      [1, 0, 0, 0, 0, 0, 0]
    );
    assert.deepEqual(
      cols.map((c) => c.notnull),
      [0, 1, 1, 1, 0, 1, 1]
    );
    assert.deepEqual(
      cols.map((c) => c.dflt_value),
      [null, null, null, null, null, "'pending'", null]
    );

    const idx = ctx.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_guestbook_created_at'")
      .get();
    assert.equal(idx.sql, 'CREATE INDEX idx_guestbook_created_at ON guestbook (created_at)');

    const res = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: '  Ada  ', body: '  Hello town!  ' },
      { 'X-Forwarded-For': '203.0.113.119' }
    );
    assert.equal(res.status, 201);

    const row = { ...ctx.db.prepare('SELECT * FROM guestbook WHERE id = ?').get(res.data.id) };
    assert.deepEqual(row, {
      id: res.data.id,
      kind: 'guestbook',
      name: 'Ada',
      body: 'Hello town!',
      plot: null,
      status: 'pending',
      created_at: 1700000000,
    });
  } finally {
    await ctx.close();
  }
});

test('signing never bumps state_seq and approve drives state since (G16)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const seq0 = (await visitor.state()).data.state_seq;
    const g1 = await visitor.signGuestbook('guestbook', 'One', 'First entry');
    const g2 = await visitor.signGuestbook('guestbook', 'Two', 'Second entry');
    assert.equal(g1.status, 201);
    assert.equal(g2.status, 201);

    assert.equal((await visitor.state()).data.state_seq, seq0);
    const unchanged0 = await visitor.state(seq0);
    assert.equal(unchanged0.status, 304);
    assert.equal(unchanged0.data, null);

    assert.equal((await admin.moderateGuestbook(g1.data.id, 'approve')).status, 200);
    assert.equal((await visitor.state()).data.state_seq, seq0 + 1);

    const changed = await visitor.state(seq0);
    assert.equal(changed.status, 200);
    assert.equal(changed.data.guestbook.signed, 1);
    assert.equal(changed.data.guestbook_pending, 1);

    assert.equal((await admin.moderateGuestbook(g2.data.id, 'reject')).status, 200);
    assert.equal((await visitor.state()).data.state_seq, seq0 + 1);

    const unchanged1 = await visitor.state(seq0 + 1);
    assert.equal(unchanged1.status, 304);
    assert.equal(unchanged1.data, null);
  } finally {
    await ctx.close();
  }
});

test('state counts combine gate, letter, and plot approvals (G17)', async () => {
  const ctx = await startTestServer();
  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const gate = await visitor.signGuestbook('guestbook', 'A', 'Gate hello');
    const letter = await visitor.signGuestbook('letter', 'B', 'Gazette hello');
    const plot = await visitor.signGuestbook('guestbook', 'C', 'Wick hello', 'wick');
    assert.equal(gate.status, 201);
    assert.equal(letter.status, 201);
    assert.equal(plot.status, 201);

    assert.equal((await admin.moderateGuestbook(gate.data.id, 'approve')).status, 200);
    assert.equal((await admin.moderateGuestbook(letter.data.id, 'approve')).status, 200);
    assert.equal((await admin.moderateGuestbook(plot.data.id, 'approve')).status, 200);

    const s = await visitor.state();
    assert.deepEqual(s.data.guestbook, { signed: 1, letters: 1 });
    assert.deepEqual(s.data.guestbook_by_plot, { wick: 1 });
    assert.equal(s.data.guestbook_pending, 0);
  } finally {
    await ctx.close();
  }
});

test('guestbook source pins: CAPS, rate limit, schema, town.json, SKILL.md (G18)', () => {
  const apiDir = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.resolve(apiDir, '..');

  const serverSrc = fs.readFileSync(path.join(apiDir, 'server.mjs'), 'utf8');
  assert.ok(serverSrc.includes('  guestbookName: 40,\n'));
  assert.ok(serverSrc.includes('  guestbookBody: 500,\n'));
  assert.ok(serverSrc.includes('  guestbook: { max: 3, windowSec: 60 * 60 },\n'));

  const schemaSrc = fs.readFileSync(path.join(apiDir, 'schema.sql'), 'utf8');
  assert.ok(
    schemaSrc.includes(
      [
        'CREATE TABLE IF NOT EXISTS guestbook (',
        "    id              INTEGER PRIMARY KEY AUTOINCREMENT,",
        "    kind            TEXT NOT NULL CHECK (kind IN ('guestbook', 'letter')),",
        '    name            TEXT NOT NULL,',
        '    body            TEXT NOT NULL,',
        '    plot            TEXT,',
        "    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),",
        '    created_at      INTEGER NOT NULL',
        ');',
      ].join('\n')
    )
  );

  const townJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'town.json'), 'utf8'));
  const postEp = townJson.endpoints.find((e) => e.method === 'POST' && e.path === '/api/town/guestbook');
  assert.ok(postEp);
  assert.equal(postEp.auth, 'public');
  assert.equal(postEp.rate_limit, '3/hour per IP');
  assert.equal(
    postEp.summary,
    'Submit an unsigned Town Gate Guestbook entry (kind=guestbook), per-plot guestbook entry (kind=guestbook with optional plot=<handle>), or Letter to the Editor (kind=letter, no plot); stays pending until approved (400 invalid_plot / unknown_plot on bad plot).'
  );

  const getEp = townJson.endpoints.find((e) => e.method === 'GET' && e.path === '/api/town/guestbook');
  assert.ok(getEp);
  assert.equal(getEp.auth, 'public');
  assert.equal(getEp.rate_limit, null);
  assert.equal(
    getEp.summary,
    'List approved Town Gate Guestbook entries, per-plot guestbook entries (optional ?plot=<handle>, else gate-only; 400 invalid_plot / unknown_plot on bad plot), or Letters to the Editor (optional ?kind=guestbook|letter and ?limit=1..50, default 50).'
  );

  const adminEp = townJson.endpoints.find((e) => e.method === 'POST' && e.path === '/api/town/admin/guestbook');
  assert.ok(adminEp);
  assert.equal(adminEp.auth, 'admin');
  assert.equal(adminEp.rate_limit, null);
  assert.equal(
    adminEp.summary,
    'Milo-only operator endpoint: approve or reject a pending Town Gate guestbook entry, per-plot guestbook entry, or letter by id (approve bumps state_seq).'
  );

  assert.equal(townJson.limits.guestbook_name_chars, 40);
  assert.equal(townJson.limits.guestbook_body_chars, 500);

  const skillSrc = fs.readFileSync(path.join(repoRoot, 'SKILL.md'), 'utf8');
  assert.ok(skillSrc.includes('`?plot=<handle>&kind=letter` returns an empty list'));
});

test('trimming, exact limits, and unicode name handling (G19)', async () => {
  const ctx = await startTestServer();
  try {
    const exactName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'a'.repeat(40), body: 'ok' },
      { 'X-Forwarded-For': '203.0.113.121' }
    );
    assert.equal(exactName.status, 201);

    const exactBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Ada', body: 'b'.repeat(500) },
      { 'X-Forwarded-For': '203.0.113.122' }
    );
    assert.equal(exactBody.status, 201);

    const paddedName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: '  ' + 'a'.repeat(40) + '  ', body: 'ok' },
      { 'X-Forwarded-For': '203.0.113.123' }
    );
    assert.equal(paddedName.status, 201);
    const paddedNameRow = ctx.db.prepare('SELECT name FROM guestbook WHERE id = ?').get(paddedName.data.id);
    assert.equal(paddedNameRow.name, 'a'.repeat(40));

    const paddedBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Ada', body: '  ' + 'b'.repeat(500) + '  ' },
      { 'X-Forwarded-For': '203.0.113.124' }
    );
    assert.equal(paddedBody.status, 201);
    const paddedBodyRow = ctx.db.prepare('SELECT body FROM guestbook WHERE id = ?').get(paddedBody.data.id);
    assert.equal(paddedBodyRow.body, 'b'.repeat(500));

    const emojiName = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Milo 👻', body: 'ok' },
      { 'X-Forwarded-For': '203.0.113.125' }
    );
    assert.equal(emojiName.status, 201);
    const emojiRow = ctx.db.prepare('SELECT name FROM guestbook WHERE id = ?').get(emojiName.data.id);
    assert.equal(emojiRow.name, 'Milo 👻');

    const overflowEmoji = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'a'.repeat(39) + '👻', body: 'ok' },
      { 'X-Forwarded-For': '203.0.113.126' }
    );
    assert.equal(overflowEmoji.status, 400);
    assert.equal(overflowEmoji.data.error, 'invalid_name');

    const multilineBody = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'Ada', body: 'line1\nline2' },
      { 'X-Forwarded-For': '203.0.113.127' }
    );
    assert.equal(multilineBody.status, 201);
    const multilineRow = ctx.db.prepare('SELECT body FROM guestbook WHERE id = ?').get(multilineBody.data.id);
    assert.equal(multilineRow.body, 'line1\nline2');
  } finally {
    await ctx.close();
  }
});

test('file hygiene: 58 unique names, 8 imports, pinned as-true counts (G20)', () => {
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const lines = src.split('\n');

  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 58);
  assert.equal(new Set(names).size, 58);

  const imports = lines.filter((l) => l.startsWith('import '));
  assert.deepEqual(imports, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { DatabaseSync } from 'node:sqlite';",
    "import { createTownServer } from './server.mjs';",
    "import { GhostlightClient, generateKeypair } from './ghostlight-client.mjs';",
  ]);

  const fetchNeedle = 'fet' + 'ch(';
  assert.equal(lines.filter((l) => l.includes(fetchNeedle)).length, 27);

  const dateNowRe = new RegExp('Date' + '.now');
  assert.equal(lines.filter((l) => dateNowRe.test(l)).length, 3);

  const randNeedle = 'Math' + '.random';
  assert.equal(lines.filter((l) => l.includes(randNeedle)).length, 0);

  const todoNeedle = 'TO' + 'DO';
  assert.equal(lines.filter((l) => l.includes(todoNeedle)).length, 0);

  const fixmeNeedle = 'FIX' + 'ME';
  assert.equal(lines.filter((l) => l.includes(fixmeNeedle)).length, 0);

  const bannedNeedle = 'camp' + 'fire';
  assert.equal(src.toLowerCase().split(bannedNeedle).length - 1, 0);
});

test('non-string field types are rejected with matching error (G21)', async () => {
  const ctx = await startTestServer();
  try {
    const cases = [
      [{ kind: 123, name: 'Ada', body: 'Hello' }, '203.0.113.201', 'invalid_kind'],
      [{ kind: 'guestbook', name: 123, body: 'Hello' }, '203.0.113.202', 'invalid_name'],
      [{ kind: 'guestbook', name: 'Ada', body: 123 }, '203.0.113.203', 'invalid_body'],
      [{ kind: true, name: 'Ada', body: 'Hello' }, '203.0.113.204', 'invalid_kind'],
      [{ kind: 'guestbook', name: ['Ada'], body: 'Hello' }, '203.0.113.205', 'invalid_name'],
      [{ kind: 'guestbook', name: 'Ada', body: { x: 1 } }, '203.0.113.206', 'invalid_body'],
    ];
    for (const [payload, ip, expectedError] of cases) {
      const res = await rawPost(ctx.baseUrl, '/api/town/guestbook', payload, { 'X-Forwarded-For': ip });
      assert.equal(res.status, 400);
      if (expectedError === 'invalid_kind') {
        assert.deepEqual(res.data, { error: 'invalid_kind' });
      } else {
        assert.equal(res.data.error, expectedError);
      }
    }
  } finally {
    await ctx.close();
  }
});

test('fresh-DB exact shapes for guestbook and state (G22)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });

    const gb = await visitor.getGuestbook();
    assert.equal(gb.status, 200);
    assert.deepEqual(gb.data, { entries: [] });

    const letters = await visitor.getGuestbook('letter');
    assert.equal(letters.status, 200);
    assert.deepEqual(letters.data, { entries: [] });

    const st = await visitor.state();
    assert.equal(st.status, 200);
    assert.deepEqual(st.data.guestbook, { signed: 0, letters: 0 });
    assert.deepEqual(st.data.guestbook_by_plot, {});
    assert.equal(st.data.guestbook_pending, 0);
  } finally {
    await ctx.close();
  }
});

test('created_at drives GET order with DB-seeded entries (G23)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const stmt = ctx.db.prepare(
      "INSERT INTO guestbook (kind, name, body, status, plot, created_at) VALUES ('guestbook', ?, ?, 'approved', NULL, ?)"
    );
    stmt.run('Guest A', 'Message A', 1700000000);
    stmt.run('Guest B', 'Message B', 1700000010);

    const gb = await visitor.getGuestbook();
    assert.equal(gb.status, 200);
    assert.equal(gb.data.entries.length, 2);
    assert.equal(gb.data.entries[0].id, 2);
    assert.equal(gb.data.entries[0].name, 'Guest B');
    assert.equal(gb.data.entries[0].body, 'Message B');
    assert.equal(gb.data.entries[0].created_at, 1700000010);
    assert.equal(gb.data.entries[1].id, 1);
    assert.equal(gb.data.entries[1].name, 'Guest A');
    assert.equal(gb.data.entries[1].created_at, 1700000000);
  } finally {
    await ctx.close();
  }
});

test('scheme-less text is allowed by URL filter (G24)', async () => {
  const ctx = await startTestServer();
  try {
    const bodies = [
      ['visit www.example.com', '203.0.113.211'],
      ['mail ada@example.com', '203.0.113.212'],
      ['try ftp://files', '203.0.113.213'],
      ['say http loudly', '203.0.113.214'],
    ];
    for (const [body, ip] of bodies) {
      const res = await rawPost(
        ctx.baseUrl,
        '/api/town/guestbook',
        { kind: 'guestbook', name: 'Ada', body },
        { 'X-Forwarded-For': ip }
      );
      assert.equal(res.status, 201);
    }
  } finally {
    await ctx.close();
  }
});

test('plot signs share gate rate-limit bucket with retry_after 3600 (G25)', async () => {
  const base = Math.floor(Date.now() / 1000);
  const ctx = await startTestServer({ nowFn: () => base });
  try {
    await registerResident(ctx, 'wick');
    const ip = { 'X-Forwarded-For': '203.0.113.215' };

    const g0 = await rawPost(ctx.baseUrl, '/api/town/guestbook', { kind: 'guestbook', name: 'G0', body: 'gate 0' }, ip);
    assert.equal(g0.status, 201);
    const g1 = await rawPost(ctx.baseUrl, '/api/town/guestbook', { kind: 'guestbook', name: 'G1', body: 'gate 1' }, ip);
    assert.equal(g1.status, 201);
    const p1 = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'P', body: 'porch', plot: 'wick' },
      ip
    );
    assert.equal(p1.status, 201);

    const g2 = await rawPost(ctx.baseUrl, '/api/town/guestbook', { kind: 'guestbook', name: 'G2', body: 'gate 2' }, ip);
    assert.equal(g2.status, 429);
    assert.equal(g2.data.error, 'rate_limited');
    assert.equal(g2.data.retry_after, 3600);

    const p2 = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'P2', body: 'porch 2', plot: 'wick' },
      ip
    );
    assert.equal(p2.status, 429);
    assert.equal(p2.data.error, 'rate_limited');
    assert.equal(p2.data.retry_after, 3600);
  } finally {
    await ctx.close();
  }
});

test('rate-limit bucket is per-IP (G26)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const ipA = { 'X-Forwarded-For': '203.0.113.231' };
    const ipB = { 'X-Forwarded-For': '203.0.113.232' };

    for (let i = 0; i < 3; i++) {
      const r = await rawPost(ctx.baseUrl, '/api/town/guestbook', { kind: 'guestbook', name: `A${i}`, body: `msg ${i}` }, ipA);
      assert.equal(r.status, 201);
    }
    const blocked = await rawPost(ctx.baseUrl, '/api/town/guestbook', { kind: 'guestbook', name: 'A3', body: 'msg 3' }, ipA);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.error, 'rate_limited');

    const okB = await rawPost(ctx.baseUrl, '/api/town/guestbook', { kind: 'guestbook', name: 'B0', body: 'msg B' }, ipB);
    assert.equal(okB.status, 201);
    assert.equal(okB.data.status, 'pending');

    const st = await visitor.state();
    assert.equal(st.data.guestbook_pending, 4);
  } finally {
    await ctx.close();
  }
});

test('exact 400 error bodies across guestbook endpoints (G27)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const badKind = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'note', name: 'A', body: 'x' },
      { 'X-Forwarded-For': '203.0.113.221' }
    );
    assert.equal(badKind.status, 400);
    assert.deepEqual(badKind.data, { error: 'invalid_kind' });

    const badUrl = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A', body: 'see http://x.co' },
      { 'X-Forwarded-For': '203.0.113.222' }
    );
    assert.equal(badUrl.status, 400);
    assert.deepEqual(badUrl.data, { error: 'urls_not_allowed' });

    const badPlot = await rawPost(
      ctx.baseUrl,
      '/api/town/guestbook',
      { kind: 'guestbook', name: 'A', body: 'x', plot: 'nobody' },
      { 'X-Forwarded-For': '203.0.113.223' }
    );
    assert.equal(badPlot.status, 400);
    assert.deepEqual(badPlot.data, { error: 'unknown_plot' });

    const badLim = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=0`);
    assert.equal(badLim.status, 400);
    assert.deepEqual(await badLim.json(), { error: 'invalid_limit' });

    const letter = await visitor.signGuestbook('letter', 'Reader', 'Hello');
    assert.equal(letter.status, 201);
    const badAction = await admin.moderateGuestbook(letter.data.id, 'delete');
    assert.equal(badAction.status, 400);
    assert.deepEqual(badAction.data, { error: 'invalid_action' });
  } finally {
    await ctx.close();
  }
});

test('letter-only state counts and approved-letter list (G28)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const l1 = await visitor.signGuestbook('letter', 'Reader One', 'First letter.');
    assert.equal(l1.status, 201);
    const l2 = await visitor.signGuestbook('letter', 'Reader Two', 'Second letter.');
    assert.equal(l2.status, 201);

    const app = await admin.moderateGuestbook(l1.data.id, 'approve');
    assert.equal(app.status, 200);
    const rej = await admin.moderateGuestbook(l2.data.id, 'reject');
    assert.equal(rej.status, 200);

    const st = await visitor.state();
    assert.deepEqual(st.data.guestbook, { signed: 0, letters: 1 });
    assert.equal(st.data.guestbook_pending, 0);

    const onlyLetters = await visitor.getGuestbook('letter');
    assert.equal(onlyLetters.status, 200);
    assert.equal(onlyLetters.data.entries.length, 1);
    assert.equal(onlyLetters.data.entries[0].id, l1.data.id);
    assert.equal(onlyLetters.data.entries[0].name, 'Reader One');
    assert.equal(onlyLetters.data.entries[0].body, 'First letter.');

    const allGb = await visitor.getGuestbook();
    assert.equal(allGb.status, 200);
    assert.equal(allGb.data.entries.length, 1);
  } finally {
    await ctx.close();
  }
});

test('gate re-reject 409 carries rejected status (G29)', async () => {
  const ctx = await startTestServer();
  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor', privateKeyPem: '' });
    const admin = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'milo-op',
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });

    const seq0 = (await visitor.state()).data.state_seq;
    const signed = await visitor.signGuestbook('guestbook', 'Guest', 'Gate note.');
    assert.equal(signed.status, 201);
    const id = signed.data.id;

    const rej = await admin.moderateGuestbook(id, 'reject');
    assert.equal(rej.status, 200);
    assert.deepEqual(rej.data, { id, status: 'rejected' });

    const reRej = await admin.moderateGuestbook(id, 'reject');
    assert.equal(reRej.status, 409);
    assert.deepEqual(reRej.data, { error: 'already_decided', status: 'rejected' });

    const appAfterRej = await admin.moderateGuestbook(id, 'approve');
    assert.equal(appAfterRej.status, 409);
    assert.deepEqual(appAfterRej.data, { error: 'already_decided', status: 'rejected' });

    const st = await visitor.state();
    assert.equal(st.data.state_seq, seq0);
    assert.deepEqual(st.data.guestbook, { signed: 0, letters: 0 });
    assert.equal(st.data.guestbook_pending, 0);

    const gb = await visitor.getGuestbook();
    assert.equal(gb.status, 200);
    assert.deepEqual(gb.data, { entries: [] });
  } finally {
    await ctx.close();
  }
});

test('GET limit Number quirks with 12 seeded rows (G30)', async () => {
  const ctx = await startTestServer();
  try {
    const baseTime = ctx.nowSec() - 100;
    const stmt = ctx.db.prepare(
      "INSERT INTO guestbook (kind, name, body, status, plot, created_at) VALUES ('guestbook', ?, ?, 'approved', NULL, ?)"
    );
    for (let i = 1; i <= 12; i++) {
      stmt.run(`Guest ${i}`, `Message ${i}`, baseTime + i);
    }

    const r007 = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=007`);
    assert.equal(r007.status, 200);
    const d007 = await r007.json();
    assert.equal(d007.entries.length, 7);
    assert.deepEqual(d007.entries.map((e) => e.id), [12, 11, 10, 9, 8, 7, 6]);

    const rPlus5 = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=+5`);
    assert.equal(rPlus5.status, 200);
    const dPlus5 = await rPlus5.json();
    assert.equal(dPlus5.entries.length, 5);
    assert.deepEqual(dPlus5.entries.map((e) => e.id), [12, 11, 10, 9, 8]);

    const r12 = await fetch(`${ctx.baseUrl}/api/town/guestbook?limit=12`);
    assert.equal(r12.status, 200);
    const d12 = await r12.json();
    assert.equal(d12.entries.length, 12);
    assert.equal(d12.entries[11].id, 1);
  } finally {
    await ctx.close();
  }
});
