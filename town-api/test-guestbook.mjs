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
