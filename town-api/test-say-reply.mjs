import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, 'ghostlight-client.mjs');

async function startTestServer(dbPathOverride = null) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-say-reply-'));
  const dbPath = dbPathOverride || path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    tmpDir,
    baseUrl,
    operatorKeys,
    db,
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

async function createResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joinRes = await client.join({ origin: 'musebook' });
  assert.equal(joinRes.status, 201);
  const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle });
  assert.equal(appRes.status, 200);
  return { client, keys };
}

test('say reply_to: top-level null, reply accepted, self-reply allowed, and state carries reply_to', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    // Top-level say (no reply_to)
    const topRes = await maren.say('Lantern is lit tonight.');
    assert.equal(topRes.status, 201);
    assert.equal(topRes.data.reply_to, null);

    // Reply from another resident
    const replyRes = await lampmoth.say('Good evening, Maren.', 'say', topRes.data.id);
    assert.equal(replyRes.status, 201);
    assert.equal(replyRes.data.reply_to, topRes.data.id);

    // Self-reply
    const selfRes = await maren.say('Pull up a chair.', 'say', topRes.data.id);
    assert.equal(selfRes.status, 201);
    assert.equal(selfRes.data.reply_to, topRes.data.id);

    // Verify state prompt_book carries reply_to
    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    const pb = stateRes.data.prompt_book;
    assert.equal(pb.length, 3);
    assert.equal(pb[0].id, topRes.data.id);
    assert.equal(pb[0].reply_to, null);
    assert.equal(pb[1].id, replyRes.data.id);
    assert.equal(pb[1].reply_to, topRes.data.id);
    assert.equal(pb[2].id, selfRes.data.id);
    assert.equal(pb[2].reply_to, topRes.data.id);
  } finally {
    await ctx.close();
  }
});

test('say reply_to rejects non-integer, 0, negative, and missing id with 400 invalid_reply_to without consuming quota', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const badValues = ['3', 0, -1, 99999, 1.5, true];
    for (const bad of badValues) {
      const res = await alice.say('Should fail.', 'say', bad);
      assert.equal(res.status, 400, `expected 400 for reply_to=${JSON.stringify(bad)}`);
      assert.equal(res.data.error, 'invalid_reply_to');
    }

    // All 6 quota slots should still be available after the 6 rejected replies
    for (let i = 1; i <= 6; i++) {
      const okRes = await alice.say(`Valid line ${i}`);
      assert.equal(okRes.status, 201, `expected 201 on valid say #${i}`);
    }
    const rlRes = await alice.say('Seventh line should hit 6/10min limit');
    assert.equal(rlRes.status, 429);
    assert.equal(rlRes.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('startup migration adds reply_to to old prompt_book schema and old rows read null', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-migrate-reply-'));
  const dbPath = path.join(tmpDir, 'town.db');

  // Build DB using the OLD prompt_book schema (no reply_to column)
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
    CREATE TABLE invitations (
      code TEXT PRIMARY KEY,
      intended_handle TEXT,
      origin TEXT,
      created_by TEXT,
      used_by TEXT,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE TABLE prompt_book (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('say', 'emote', 'system')),
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO meta (key, value) VALUES ('state_seq', '1');
  `);
  const now = Math.floor(Date.now() / 1000);
  oldDb
    .prepare("INSERT INTO prompt_book (handle, kind, body, created_at) VALUES ('oldmuse', 'say', 'Before reply_to existed.', ?)")
    .run(now - 60);
  oldDb.close();

  const ctx = await startTestServer(dbPath);
  try {
    const cols = ctx.db.prepare('PRAGMA table_info(prompt_book)').all();
    assert.ok(cols.some((c) => c.name === 'reply_to'), 'reply_to column added by startup migration');

    const { client: maren } = await createResident(ctx, 'maren');
    const newRes = await maren.say('Answering the old line.', 'say', 1);
    assert.equal(newRes.status, 201);
    assert.equal(newRes.data.reply_to, 1);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    const oldEntry = stateRes.data.prompt_book.find((e) => e.id === 1);
    const newEntry = stateRes.data.prompt_book.find((e) => e.id === newRes.data.id);
    assert.ok(oldEntry);
    assert.equal(oldEntry.reply_to, null);
    assert.ok(newEntry);
    assert.equal(newEntry.reply_to, 1);
  } finally {
    await ctx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GhostlightClient.say omits reply_to key when third arg is omitted and includes it when provided', async () => {
  const keys = generateKeypair();
  const captured = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url, body: JSON.parse(init.body) });
    return {
      status: 201,
      ok: true,
      async json() {
        return { id: captured.length, reply_to: captured[captured.length - 1].body.reply_to ?? null };
      },
    };
  };
  try {
    const client = new GhostlightClient({ baseUrl: 'http://fake.local', handle: 'tester', ...keys });
    await client.say('No reply arg');
    assert.equal(Object.hasOwn(captured[0].body, 'reply_to'), false);
    assert.deepEqual(captured[0].body, { body: 'No reply arg', kind: 'say' });

    await client.say('With reply arg', 'say', 7);
    assert.equal(Object.hasOwn(captured[1].body, 'reply_to'), true);
    assert.deepEqual(captured[1].body, { body: 'With reply arg', kind: 'say', reply_to: 7 });
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('CLI say --reply-to <id> posts reply_to and --reply-to abc exits 2', async () => {
  const ctx = await startTestServer();
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-reply-'));
  try {
    const { client: maren, keys } = await createResident(ctx, 'maren');
    const first = await maren.say('Opening remark');
    assert.equal(first.status, 201);

    const keyPath = path.join(keyDir, 'maren.pem');
    fs.writeFileSync(keyPath, keys.privateKeyPem, { mode: 0o600 });

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        CLI_PATH,
        'say',
        '--api-base',
        ctx.baseUrl,
        '--handle',
        'maren',
        '--key',
        keyPath,
        '--body',
        'CLI reply',
        '--reply-to',
        String(first.data.id),
      ],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, 201);
    assert.equal(parsed.data.reply_to, first.data.id);

    for (const badVal of ['abc', '0', '-3']) {
      const bad = await runCliAsync([
        'say',
        '--api-base',
        ctx.baseUrl,
        '--handle',
        'maren',
        '--key',
        keyPath,
        '--body',
        'Bad reply',
        '--reply-to',
        badVal,
      ]);
      assert.equal(bad.status, 2, `expected exit 2 for --reply-to ${badVal}`);
    }
  } finally {
    fs.rmSync(keyDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('say reply_to: reply to an emote line is accepted', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const emoteRes = await maren.say('tends the lantern wick', 'emote');
    assert.equal(emoteRes.status, 201);
    assert.equal(emoteRes.data.kind, 'emote');
    assert.equal(emoteRes.data.reply_to, null);

    const replyRes = await lampmoth.say('Brighter already.', 'say', emoteRes.data.id);
    assert.equal(replyRes.status, 201);
    assert.equal(replyRes.data.kind, 'say');
    assert.equal(replyRes.data.reply_to, emoteRes.data.id);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    const pb = stateRes.data.prompt_book;
    assert.equal(pb.length, 2);
    assert.equal(pb[0].id, emoteRes.data.id);
    assert.equal(pb[0].kind, 'emote');
    assert.equal(pb[1].id, replyRes.data.id);
    assert.equal(pb[1].reply_to, emoteRes.data.id);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: reply chains nest one level', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const topRes = await maren.say('Evening at the bandstand.');
    assert.equal(topRes.status, 201);

    const replyA = await lampmoth.say('Good evening.', 'say', topRes.data.id);
    assert.equal(replyA.status, 201);
    assert.equal(replyA.data.reply_to, topRes.data.id);

    const replyB = await maren.say('Glad you made it.', 'say', replyA.data.id);
    assert.equal(replyB.status, 201);
    assert.equal(replyB.data.reply_to, replyA.data.id);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    const pb = stateRes.data.prompt_book;
    const byId = new Map(pb.map((entry) => [entry.id, entry]));
    assert.equal(byId.get(replyA.data.id).reply_to, topRes.data.id);
    assert.equal(byId.get(replyB.data.id).reply_to, replyA.data.id);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: explicit null is treated as a top-level say', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');

    const res = await maren.say('Explicit null reply_to.', 'say', null);
    assert.equal(res.status, 201);
    assert.equal(res.data.reply_to, null);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    const entry = stateRes.data.prompt_book.find((e) => e.id === res.data.id);
    assert.ok(entry);
    assert.equal(entry.reply_to, null);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: replying to a pruned line returns 400 invalid_reply_to', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    const oldRow = ctx.db
      .prepare("INSERT INTO prompt_book (handle, kind, body, reply_to, created_at) VALUES ('maren', 'say', 'Old line', NULL, ?) RETURNING id")
      .get(eightDaysAgo);

    // State read triggers prompt_book pruning
    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    assert.equal(stateRes.data.prompt_book.some((e) => e.id === oldRow.id), false);

    const replyRes = await maren.say('Replying to pruned line.', 'say', oldRow.id);
    assert.equal(replyRes.status, 400);
    assert.equal(replyRes.data.error, 'invalid_reply_to');
  } finally {
    await ctx.close();
  }
});

test('say reply_to: replies count toward the 6/10min say rate limit', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const target = await lampmoth.say('Target line.');
    assert.equal(target.status, 201);

    for (let i = 1; i <= 5; i++) {
      const res = await maren.say(`Top-level ${i}`);
      assert.equal(res.status, 201);
    }

    const sixthReply = await maren.say('Sixth say is a reply.', 'say', target.data.id);
    assert.equal(sixthReply.status, 201);

    const seventh = await maren.say('Seventh say hits limit.', 'say', target.data.id);
    assert.equal(seventh.status, 429);
    assert.equal(seventh.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('say reply_to: a reply bumps state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const topRes = await maren.say('Initial line.');
    assert.equal(topRes.status, 201);

    const beforeState = await maren.state();
    assert.equal(beforeState.status, 200);
    const seqBefore = beforeState.data.state_seq;

    const replyRes = await lampmoth.say('Reply bumps seq.', 'say', topRes.data.id);
    assert.equal(replyRes.status, 201);

    const afterState = await maren.state();
    assert.equal(afterState.status, 200);
    assert.ok(afterState.data.state_seq > seqBefore, `expected state_seq > ${seqBefore}, got ${afterState.data.state_seq}`);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: muted resident cannot reply (403 resident_muted) and prompt_book is unchanged', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const topRes = await maren.say('Open floor.');
    assert.equal(topRes.status, 201);

    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = 'lampmoth'").run();

    const beforeState = await maren.state();
    assert.equal(beforeState.status, 200);
    const lenBefore = beforeState.data.prompt_book.length;

    const mutedReply = await lampmoth.say('Trying to reply while muted.', 'say', topRes.data.id);
    assert.equal(mutedReply.status, 403);
    assert.equal(mutedReply.data.error, 'resident_muted');

    const afterState = await maren.state();
    assert.equal(afterState.status, 200);
    assert.equal(afterState.data.prompt_book.length, lenBefore);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: reply still works after target author leaves', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const checkinRes = await maren.checkin({ status_text: 'At the bandstand' });
    assert.equal(checkinRes.status, 200);

    const topRes = await maren.say('Leaving a note before heading out.');
    assert.equal(topRes.status, 201);

    const leaveRes = await maren.leave();
    assert.equal(leaveRes.status, 200);
    assert.equal(leaveRes.data.extinguished, true);

    const replyRes = await lampmoth.say('See you tomorrow.', 'say', topRes.data.id);
    assert.equal(replyRes.status, 201);
    assert.equal(replyRes.data.reply_to, topRes.data.id);
  } finally {
    await ctx.close();
  }
});

test('say body validation: empty, whitespace, over-500, and non-string bodies are 400 invalid_body and do not consume quota', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const emptyRes = await alice.say('');
    assert.equal(emptyRes.status, 400);
    assert.equal(emptyRes.data.error, 'invalid_body');
    assert.equal(emptyRes.data.max, 500);

    const wsRes = await alice.say('   ');
    assert.equal(wsRes.status, 400);
    assert.equal(wsRes.data.error, 'invalid_body');

    const overRes = await alice.say('x'.repeat(501));
    assert.equal(overRes.status, 400);
    assert.equal(overRes.data.error, 'invalid_body');

    const nonStrRes = await alice.say(123);
    assert.equal(nonStrRes.status, 400);
    assert.equal(nonStrRes.data.error, 'invalid_body');

    const boundaryRes = await alice.say('x'.repeat(500));
    assert.equal(boundaryRes.status, 201);

    for (let i = 1; i <= 5; i++) {
      const okRes = await alice.say(`Valid line ${i}`);
      assert.equal(okRes.status, 201);
    }

    const rlRes = await alice.say('Seventh valid line');
    assert.equal(rlRes.status, 429);
    assert.equal(rlRes.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('say kind validation: invalid kind is 400 invalid_kind, emote reply is accepted, and failures do not consume quota', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const shoutRes = await maren.say('Too loud', 'shout');
    assert.equal(shoutRes.status, 400);
    assert.equal(shoutRes.data.error, 'invalid_kind');

    const emptyKindRes = await maren.say('No kind', '');
    assert.equal(emptyKindRes.status, 400);
    assert.equal(emptyKindRes.data.error, 'invalid_kind');

    const upperKindRes = await maren.say('Wrong case', 'SAY');
    assert.equal(upperKindRes.status, 400);
    assert.equal(upperKindRes.data.error, 'invalid_kind');

    const emoteRes = await maren.say('tends the wick', 'emote');
    assert.equal(emoteRes.status, 201);
    assert.equal(emoteRes.data.kind, 'emote');

    const replyEmoteRes = await lampmoth.say('nods quietly', 'emote', emoteRes.data.id);
    assert.equal(replyEmoteRes.status, 201);
    assert.equal(replyEmoteRes.data.kind, 'emote');
    assert.equal(replyEmoteRes.data.reply_to, emoteRes.data.id);

    for (let i = 1; i <= 5; i++) {
      const okRes = await maren.say(`Follow-up line ${i}`);
      assert.equal(okRes.status, 201);
    }

    const rlRes = await maren.say('Seventh say by maren');
    assert.equal(rlRes.status, 429);
    assert.equal(rlRes.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('say reply_to: reply to a line outside the state window still works and only the reply surfaces', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const now = Math.floor(Date.now() / 1000);

    const oldRow = ctx.db
      .prepare("INSERT INTO prompt_book (handle, kind, body, reply_to, created_at) VALUES ('maren', 'say', 'Two days old', NULL, ?) RETURNING id")
      .get(now - 2 * 86400);

    const insertFiller = ctx.db.prepare(
      "INSERT INTO prompt_book (handle, kind, body, reply_to, created_at) VALUES ('maren', 'say', ?, NULL, ?)"
    );
    for (let i = 0; i < 100; i++) {
      insertFiller.run(`Filler ${i}`, now);
    }

    const beforeState = await maren.state();
    assert.equal(beforeState.status, 200);
    assert.equal(beforeState.data.prompt_book.some((e) => e.id === oldRow.id), false);

    const replyRes = await maren.say('Replying to old line.', 'say', oldRow.id);
    assert.equal(replyRes.status, 201);
    assert.equal(replyRes.data.reply_to, oldRow.id);

    const afterState = await maren.state();
    assert.equal(afterState.status, 200);
    const replyEntry = afterState.data.prompt_book.find((e) => e.id === replyRes.data.id);
    assert.ok(replyEntry);
    assert.equal(replyEntry.reply_to, oldRow.id);
    assert.equal(afterState.data.prompt_book.some((e) => e.id === oldRow.id), false);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: reply to a system line and to a suspended author\'s line is accepted; suspended author cannot say', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: tomas } = await createResident(ctx, 'tomas');
    const now = Math.floor(Date.now() / 1000);

    const sysRow = ctx.db
      .prepare("INSERT INTO prompt_book (handle, kind, body, reply_to, created_at) VALUES ('maren', 'system', 'The lanterns are lit.', NULL, ?) RETURNING id")
      .get(now);

    const sysReply = await maren.say('Replying to system line.', 'say', sysRow.id);
    assert.equal(sysReply.status, 201);
    assert.equal(sysReply.data.reply_to, sysRow.id);

    const tomasLine = await tomas.say('A line before suspension.');
    assert.equal(tomasLine.status, 201);

    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = 'tomas'").run();

    const tomasReply = await maren.say('Replying to suspended author.', 'say', tomasLine.data.id);
    assert.equal(tomasReply.status, 201);
    assert.equal(tomasReply.data.reply_to, tomasLine.data.id);

    const suspendedSay = await tomas.say('Speaking while suspended.');
    assert.equal(suspendedSay.status, 403);
    assert.equal(suspendedSay.data.error, 'resident_not_active');
    assert.equal(suspendedSay.data.resident_status, 'suspended');
  } finally {
    await ctx.close();
  }
});

test('say refreshes a lit footlight TTL but does not relight an expired one', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');

    const checkinRes = await maren.checkin({ status_text: 'At the bandstand' });
    assert.equal(checkinRes.status, 200);

    const state1 = await maren.state();
    assert.equal(state1.status, 200);
    assert.ok(state1.data.footlights.some((f) => f.handle === 'maren'));

    const before = Math.floor(Date.now() / 1000);
    ctx.db.prepare('UPDATE footlights SET expires_at = ? WHERE handle = ?').run(before + 60, 'maren');

    const say1 = await maren.say('Keeping the light.');
    assert.equal(say1.status, 201);

    const state2 = await maren.state();
    assert.equal(state2.status, 200);
    const after = Math.floor(Date.now() / 1000);
    const fl = state2.data.footlights.find((f) => f.handle === 'maren');
    assert.ok(fl);
    assert.ok(fl.expires_at > before + 60, `expected expires_at > ${before + 60}, got ${fl.expires_at}`);
    assert.ok(
      fl.expires_at >= before + 2600 && fl.expires_at <= after + 2700,
      `expected expires_at in [${before + 2600}, ${after + 2700}], got ${fl.expires_at}`
    );

    ctx.db
      .prepare('UPDATE footlights SET expires_at = ? WHERE handle = ?')
      .run(Math.floor(Date.now() / 1000) - 10, 'maren');

    const say2 = await maren.say('Light is out, still speaking.');
    assert.equal(say2.status, 201);

    const state3 = await maren.state();
    assert.equal(state3.status, 200);
    assert.equal(state3.data.footlights.some((f) => f.handle === 'maren'), false);
  } finally {
    await ctx.close();
  }
});

test('guest say with reply_to posts as [guest] and CLI guest-say --kind/--reply-to validation', async () => {
  const ctx = await startTestServer();
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-guest-say-'));
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const topRes = await maren.say('Open floor for guests.');
    assert.equal(topRes.status, 201);
    const topId = topRes.data.id;

    const guestKeys1 = generateKeypair();
    const visitor1 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor1', ...guestKeys1 });

    const g1 = await visitor1.guestSay('Hello from a guest.', 'say', topId);
    assert.equal(g1.status, 201);
    assert.equal(g1.data.reply_to, topId);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    const guestEntry = stateRes.data.prompt_book.find((e) => e.id === g1.data.id);
    assert.ok(guestEntry);
    assert.equal(guestEntry.role, 'guest');
    assert.equal(guestEntry.reply_to, topId);

    const g2 = await visitor1.guestSay('waves', 'emote', topId);
    assert.equal(g2.status, 201);
    assert.equal(g2.data.kind, 'emote');
    assert.equal(g2.data.reply_to, topId);

    const gBad = await visitor1.guestSay('Reply to nothing.', 'say', 99999);
    assert.equal(gBad.status, 400);
    assert.equal(gBad.data.error, 'invalid_reply_to');

    const keyPath1 = path.join(keyDir, 'visitor1.pem');
    fs.writeFileSync(keyPath1, guestKeys1.privateKeyPem, { mode: 0o600 });

    const badKind = await runCliAsync([
      'guest-say',
      '--api-base',
      ctx.baseUrl,
      '--handle',
      'visitor1',
      '--key',
      keyPath1,
      '--body',
      'Bad kind',
      '--kind',
      'shout',
    ]);
    assert.equal(badKind.status, 2);

    const badReply = await runCliAsync([
      'guest-say',
      '--api-base',
      ctx.baseUrl,
      '--handle',
      'visitor1',
      '--key',
      keyPath1,
      '--body',
      'Bad reply',
      '--reply-to',
      'abc',
    ]);
    assert.equal(badReply.status, 2);

    const guestKeys2 = generateKeypair();
    const keyPath2 = path.join(keyDir, 'visitor2.pem');
    fs.writeFileSync(keyPath2, guestKeys2.privateKeyPem, { mode: 0o600 });

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        CLI_PATH,
        'guest-say',
        '--api-base',
        ctx.baseUrl,
        '--handle',
        'visitor2',
        '--key',
        keyPath2,
        '--body',
        'CLI guest reply',
        '--reply-to',
        String(topId),
      ],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, 201);
    assert.equal(parsed.data.reply_to, topId);
  } finally {
    fs.rmSync(keyDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('say body is stored verbatim (not trimmed) and the 500-char cap counts raw length', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const padded = '  hello  ';
    const r1 = await alice.say(padded);
    assert.equal(r1.status, 201);
    assert.equal(r1.data.body, padded);

    const padded500 = 'x'.repeat(499) + ' ';
    const r2 = await alice.say(padded500);
    assert.equal(r2.status, 201);
    assert.equal(r2.data.body, padded500);

    const stateRes = await alice.state();
    assert.equal(stateRes.status, 200);
    const e1 = stateRes.data.prompt_book.find((e) => e.id === r1.data.id);
    const e2 = stateRes.data.prompt_book.find((e) => e.id === r2.data.id);
    assert.ok(e1);
    assert.equal(e1.body, padded);
    assert.ok(e2);
    assert.equal(e2.body, padded500);

    const over501 = await alice.say('x'.repeat(500) + ' ');
    assert.equal(over501.status, 400);
    assert.equal(over501.data.error, 'invalid_body');

    const ws500 = await alice.say(' '.repeat(500));
    assert.equal(ws500.status, 400);
    assert.equal(ws500.data.error, 'invalid_body');
  } finally {
    await ctx.close();
  }
});

test('say validation order: muted beats body, body beats kind, kind beats reply_to', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const openRes = await maren.say('Open floor.');
    assert.equal(openRes.status, 201);

    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = 'lampmoth'").run();

    const mutedRes = await lampmoth.say('', 'shout', 99999);
    assert.equal(mutedRes.status, 403);
    assert.equal(mutedRes.data.error, 'resident_muted');

    const badBody = await maren.say('', 'shout', 99999);
    assert.equal(badBody.status, 400);
    assert.equal(badBody.data.error, 'invalid_body');

    const badKind = await maren.say('valid body', 'shout', 99999);
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');

    const badReply = await maren.say('valid body', 'say', 99999);
    assert.equal(badReply.status, 400);
    assert.equal(badReply.data.error, 'invalid_reply_to');
  } finally {
    await ctx.close();
  }
});

test('say response and state entry carry exact keys, and roles are muse/npc/guest', async () => {
  const ctx = await startTestServer();
  try {
    const wickKeys = generateKeypair();
    const wick = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'wick', ...wickKeys });
    const wickJoin = await wick.join({ origin: 'musebook' });
    assert.equal(wickJoin.status, 201);
    const wickApp = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'wick',
      role: 'npc',
    });
    assert.equal(wickApp.status, 200);

    const { client: tomas } = await createResident(ctx, 'tomas');
    const visitor9 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor9', ...generateKeypair() });

    const before = Math.floor(Date.now() / 1000);
    const wickRes = await wick.say('Lanterns lit.');
    const after = Math.floor(Date.now() / 1000);
    assert.equal(wickRes.status, 201);
    assert.deepEqual(Object.keys(wickRes.data).sort(), [
      'body',
      'created_at',
      'handle',
      'id',
      'kind',
      'reply_to',
      'state_seq',
    ]);
    assert.ok(
      wickRes.data.created_at >= before && wickRes.data.created_at <= after,
      `expected created_at in [${before}, ${after}], got ${wickRes.data.created_at}`
    );

    const tomasRes = await tomas.say('Evening, Wick.');
    assert.equal(tomasRes.status, 201);

    const guestRes = await visitor9.guestSay('Hello from a guest.');
    assert.equal(guestRes.status, 201);

    const stateRes = await tomas.state();
    assert.equal(stateRes.status, 200);
    const pb = stateRes.data.prompt_book;
    const wickEntry = pb.find((e) => e.id === wickRes.data.id);
    const tomasEntry = pb.find((e) => e.id === tomasRes.data.id);
    const guestEntry = pb.find((e) => e.id === guestRes.data.id);

    assert.ok(wickEntry);
    assert.ok(tomasEntry);
    assert.ok(guestEntry);
    assert.equal(wickEntry.role, 'npc');
    assert.equal(tomasEntry.role, 'muse');
    assert.equal(guestEntry.role, 'guest');
    assert.deepEqual(Object.keys(wickEntry).sort(), [
      'body',
      'created_at',
      'handle',
      'id',
      'kind',
      'reply_to',
      'role',
    ]);
  } finally {
    await ctx.close();
  }
});

test('admin delete-line: replies survive with a dangling reply_to, and replying to a deleted line fails', async () => {
  const ctx = await startTestServer();
  try {
    const { client: mira } = await createResident(ctx, 'mira');
    const { client: luna } = await createResident(ctx, 'luna');

    const topRes = await mira.say('Line to be deleted.');
    assert.equal(topRes.status, 201);

    const replyRes = await luna.say('Reply to mira.', 'say', topRes.data.id);
    assert.equal(replyRes.status, 201);

    const beforeState = await mira.state();
    assert.equal(beforeState.status, 200);
    const seqBefore = beforeState.data.state_seq;

    const delRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/delete-line', {
      id: topRes.data.id,
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.data.deleted, true);
    assert.equal(delRes.data.id, topRes.data.id);
    assert.ok(delRes.data.state_seq > seqBefore, `expected state_seq > ${seqBefore}, got ${delRes.data.state_seq}`);

    const afterState = await mira.state();
    assert.equal(afterState.status, 200);
    assert.equal(afterState.data.prompt_book.some((e) => e.id === topRes.data.id), false);
    const survivingReply = afterState.data.prompt_book.find((e) => e.id === replyRes.data.id);
    assert.ok(survivingReply);
    assert.equal(survivingReply.reply_to, topRes.data.id);

    const postDelReply = await luna.say('Reply after delete.', 'say', topRes.data.id);
    assert.equal(postDelReply.status, 400);
    assert.equal(postDelReply.data.error, 'invalid_reply_to');

    const delAgain = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/delete-line', {
      id: topRes.data.id,
    });
    assert.equal(delAgain.status, 404);
    assert.equal(delAgain.data.error, 'line_not_found');

    for (const badId of [0, -1, 1.5, '3', true]) {
      const badDel = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/delete-line', {
        id: badId,
      });
      assert.equal(badDel.status, 400, `expected 400 for id=${JSON.stringify(badId)}`);
      assert.equal(badDel.data.error, 'invalid_id');
    }
  } finally {
    await ctx.close();
  }
});

test('guest reply rate limit is 2/10min and failed guest replies do not consume quota', async () => {
  const ctx = await startTestServer();
  try {
    const { client: milo2 } = await createResident(ctx, 'milo2');
    const topRes = await milo2.say('Open floor for guest replies.');
    assert.equal(topRes.status, 201);

    const visitor5 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor5', ...generateKeypair() });

    const badReply = await visitor5.guestSay('bad reply', 'say', 99999);
    assert.equal(badReply.status, 400);
    assert.equal(badReply.data.error, 'invalid_reply_to');

    const g1 = await visitor5.guestSay('First guest reply.', 'say', topRes.data.id);
    assert.equal(g1.status, 201);

    const g2 = await visitor5.guestSay('Second guest reply.', 'say', topRes.data.id);
    assert.equal(g2.status, 201);

    const g3 = await visitor5.guestSay('Third guest reply.', 'say', topRes.data.id);
    assert.equal(g3.status, 429);
    assert.equal(g3.data.error, 'rate_limited');
    assert.ok(g3.data.retry_after > 0, `expected retry_after > 0, got ${g3.data.retry_after}`);
  } finally {
    await ctx.close();
  }
});

test('say auth matrix: suspended 403, unknown handle 401, wrong key 401 invalid_signature', async () => {
  const ctx = await startTestServer();
  try {
    const suspendedClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'suspended1', ...generateKeypair() });
    const joinRes = await suspendedClient.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('suspended1');

    const suspendedSay = await suspendedClient.say('Locked out.');
    assert.equal(suspendedSay.status, 403);
    assert.equal(suspendedSay.data.error, 'resident_not_active');
    assert.equal(suspendedSay.data.resident_status, 'suspended');

    const unknownClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'neverjoined', ...generateKeypair() });
    const unknownSay = await unknownClient.say('Never joined.');
    assert.equal(unknownSay.status, 401);
    assert.equal(unknownSay.data.error, 'unknown_resident');

    await createResident(ctx, 'mira2');
    const wrongKeyClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'mira2', ...generateKeypair() });
    const wrongKeySay = await wrongKeyClient.say('Wrong key.');
    assert.equal(wrongKeySay.status, 401);
    assert.equal(wrongKeySay.data.error, 'invalid_signature');
  } finally {
    await ctx.close();
  }
});

test('say reply_to: resident and guest can reply to a guest line', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const va = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'va', ...generateKeypair() });
    const vb = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'vb', ...generateKeypair() });

    const guestTop = await va.guestSay('Guest opener.');
    assert.equal(guestTop.status, 201);
    assert.equal(guestTop.data.reply_to, null);

    const resReply = await maren.say('Welcome to the bandstand.', 'say', guestTop.data.id);
    assert.equal(resReply.status, 201);
    assert.equal(resReply.data.reply_to, guestTop.data.id);

    const guestReply = await vb.guestSay('Glad to be here.', 'say', guestTop.data.id);
    assert.equal(guestReply.status, 201);
    assert.equal(guestReply.data.reply_to, guestTop.data.id);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    const byId = new Map(stateRes.data.prompt_book.map((e) => [e.id, e]));
    assert.equal(byId.get(guestTop.data.id)?.role, 'guest');
    assert.equal(byId.get(guestTop.data.id)?.reply_to, null);
    assert.equal(byId.get(resReply.data.id)?.role, 'muse');
    assert.equal(byId.get(resReply.data.id)?.reply_to, guestTop.data.id);
    assert.equal(byId.get(guestReply.data.id)?.role, 'guest');
    assert.equal(byId.get(guestReply.data.id)?.reply_to, guestTop.data.id);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: reply chains nest three levels deep', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const a = await maren.say('Level zero.');
    assert.equal(a.status, 201);
    const b = await lampmoth.say('Level one.', 'say', a.data.id);
    assert.equal(b.status, 201);
    const c = await maren.say('Level two.', 'say', b.data.id);
    assert.equal(c.status, 201);
    const d = await lampmoth.say('Level three.', 'say', c.data.id);
    assert.equal(d.status, 201);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    const byId = new Map(stateRes.data.prompt_book.map((e) => [e.id, e]));
    assert.equal(byId.get(a.data.id)?.reply_to, null);
    assert.equal(byId.get(b.data.id)?.reply_to, a.data.id);
    assert.equal(byId.get(c.data.id)?.reply_to, b.data.id);
    assert.equal(byId.get(d.data.id)?.reply_to, c.data.id);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: two residents can reply to the same top line', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');
    const { client: tomas } = await createResident(ctx, 'tomas');

    const topRes = await maren.say('Who wants tea?');
    assert.equal(topRes.status, 201);

    const r1 = await lampmoth.say('I do.', 'say', topRes.data.id);
    assert.equal(r1.status, 201);
    assert.equal(r1.data.reply_to, topRes.data.id);

    const r2 = await tomas.say('Kettle is already warm.', 'say', topRes.data.id);
    assert.equal(r2.status, 201);
    assert.equal(r2.data.reply_to, topRes.data.id);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    const byId = new Map(stateRes.data.prompt_book.map((e) => [e.id, e]));
    assert.equal(byId.get(r1.data.id)?.reply_to, topRes.data.id);
    assert.equal(byId.get(r2.data.id)?.reply_to, topRes.data.id);
  } finally {
    await ctx.close();
  }
});

test('say kind system from resident returns 400 invalid_kind without consuming quota', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const badKind = await alice.say('Fake system', 'system');
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');

    for (let i = 1; i <= 6; i++) {
      const ok = await alice.say(`Valid line ${i}`);
      assert.equal(ok.status, 201, `expected 201 on valid say ${i}`);
    }

    const over = await alice.say('Seventh line');
    assert.equal(over.status, 429);
    assert.equal(over.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('say auth: pending resident cannot say (403 resident_not_active, status pending)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: pend1 } = await createResident(ctx, 'pend1');
    ctx.db.prepare("UPDATE residents SET status = 'pending' WHERE handle = ?").run('pend1');

    const res = await pend1.say('Not approved yet.');
    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'resident_not_active');
    assert.equal(res.data.resident_status, 'pending');
  } finally {
    await ctx.close();
  }
});

test('say without checkin lights no footlight', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');

    const sayRes = await maren.say('Speaking from offstage.');
    assert.equal(sayRes.status, 201);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    assert.equal(stateRes.data.footlights.some((f) => f.handle === 'maren'), false);
  } finally {
    await ctx.close();
  }
});

test('say increments state_seq by exactly 1 per say and matches state read', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');

    const s0 = await maren.state();
    assert.equal(s0.status, 200);
    const seq0 = s0.data.state_seq;

    const r1 = await maren.say('First step.');
    assert.equal(r1.status, 201);
    assert.equal(r1.data.state_seq, seq0 + 1);

    const s1 = await maren.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.state_seq, seq0 + 1);

    const r2 = await maren.say('Second step.');
    assert.equal(r2.status, 201);
    assert.equal(r2.data.state_seq, seq0 + 2);

    const s2 = await maren.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.state_seq, seq0 + 2);
  } finally {
    await ctx.close();
  }
});

test('guest reply rate limit is per-handle (2/10min each)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const topRes = await maren.say('Open bench for guests.');
    assert.equal(topRes.status, 201);

    const va = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'va', ...generateKeypair() });
    const vb = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'vb', ...generateKeypair() });

    const va1 = await va.guestSay('va first', 'say', topRes.data.id);
    assert.equal(va1.status, 201);
    const va2 = await va.guestSay('va second', 'say', topRes.data.id);
    assert.equal(va2.status, 201);
    const va3 = await va.guestSay('va third', 'say', topRes.data.id);
    assert.equal(va3.status, 429);
    assert.equal(va3.data.error, 'rate_limited');

    const vb1 = await vb.guestSay('vb first', 'say', topRes.data.id);
    assert.equal(vb1.status, 201);
    const vb2 = await vb.guestSay('vb second', 'say', topRes.data.id);
    assert.equal(vb2.status, 201);
    const vb3 = await vb.guestSay('vb third', 'say', topRes.data.id);
    assert.equal(vb3.status, 429);
    assert.equal(vb3.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('CLI say accepts --reply-to "1.0" and --kind emote --reply-to posts an emote reply', async () => {
  const ctx = await startTestServer();
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-say-g9-'));
  try {
    const { client: maren, keys } = await createResident(ctx, 'maren');
    const first = await maren.say('First prompt book line.');
    assert.equal(first.status, 201);
    assert.equal(first.data.id, 1);

    const keyPath = path.join(keyDir, 'maren.pem');
    fs.writeFileSync(keyPath, keys.privateKeyPem, { mode: 0o600 });

    const floatReply = await execFileAsync(
      process.execPath,
      [
        CLI_PATH,
        'say',
        '--api-base',
        ctx.baseUrl,
        '--handle',
        'maren',
        '--key',
        keyPath,
        '--body',
        'Floaty reply',
        '--reply-to',
        '1.0',
      ],
      { encoding: 'utf8' }
    );
    const floatParsed = JSON.parse(floatReply.stdout.trim());
    assert.equal(floatParsed.ok, true);
    assert.equal(floatParsed.status, 201);
    assert.equal(floatParsed.data.reply_to, 1);

    const emoteReply = await execFileAsync(
      process.execPath,
      [
        CLI_PATH,
        'say',
        '--api-base',
        ctx.baseUrl,
        '--handle',
        'maren',
        '--key',
        keyPath,
        '--kind',
        'emote',
        '--body',
        'nods',
        '--reply-to',
        String(first.data.id),
      ],
      { encoding: 'utf8' }
    );
    const emoteParsed = JSON.parse(emoteReply.stdout.trim());
    assert.equal(emoteParsed.ok, true);
    assert.equal(emoteParsed.status, 201);
    assert.equal(emoteParsed.data.kind, 'emote');
    assert.equal(emoteParsed.data.reply_to, first.data.id);
  } finally {
    fs.rmSync(keyDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('admin delete-line on a reply removes the reply, preserves the top line, and rejects replies to the deleted reply', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const topRes = await maren.say('Top line stays.');
    assert.equal(topRes.status, 201);

    const replyRes = await lampmoth.say('Reply to delete.', 'say', topRes.data.id);
    assert.equal(replyRes.status, 201);

    const delRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/delete-line', {
      id: replyRes.data.id,
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.data.deleted, true);

    const stateRes = await maren.state();
    assert.equal(stateRes.status, 200);
    assert.equal(stateRes.data.prompt_book.some((e) => e.id === topRes.data.id), true);
    assert.equal(stateRes.data.prompt_book.some((e) => e.id === replyRes.data.id), false);

    const postDelReply = await lampmoth.say('Reply to deleted reply.', 'say', replyRes.data.id);
    assert.equal(postDelReply.status, 400);
    assert.equal(postDelReply.data.error, 'invalid_reply_to');
  } finally {
    await ctx.close();
  }
});

test('say reply_to: reply ids are consecutive and created_at matches between response and state', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const r1 = await maren.say('Top line.');
    assert.equal(r1.status, 201);
    const r2 = await lampmoth.say('First reply.', 'say', r1.data.id);
    assert.equal(r2.status, 201);
    const r3 = await maren.say('Reply to reply.', 'say', r2.data.id);
    assert.equal(r3.status, 201);

    assert.deepEqual([r1.data.id, r2.data.id, r3.data.id], [1, 2, 3]);
    for (const r of [r1, r2, r3]) {
      assert.equal(Number.isInteger(r.data.created_at), true);
    }

    const st = await maren.state();
    assert.equal(st.status, 200);
    assert.deepEqual(st.data.prompt_book.map((e) => e.id), [1, 2, 3]);
    assert.deepEqual(
      st.data.prompt_book.map((e) => e.created_at),
      [r1.data.created_at, r2.data.created_at, r3.data.created_at]
    );
  } finally {
    await ctx.close();
  }
});

test('say reply_to: incremental state?since= returns 200 with updated seq and 304 when caught up', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const top = await maren.say('Top line.');
    assert.equal(top.status, 201);
    const stBefore = await maren.state();
    assert.equal(stBefore.status, 200);
    const seqBefore = stBefore.data.state_seq;

    const reply = await lampmoth.say('Reply line.', 'say', top.data.id);
    assert.equal(reply.status, 201);

    const inc = await maren.state(seqBefore);
    assert.equal(inc.status, 200);
    assert.equal(inc.data.state_seq, seqBefore + 1);
    assert.deepEqual(inc.data.prompt_book.map((e) => e.id), [top.data.id, reply.data.id]);
    assert.equal(inc.data.prompt_book[1].reply_to, top.data.id);

    const notMod = await maren.state(inc.data.state_seq);
    assert.equal(notMod.status, 304);
    assert.equal(notMod.data, null);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: reply to a muted author line is accepted', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const top = await maren.say('Line before mute.');
    assert.equal(top.status, 201);

    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = 'maren'").run();

    const reply = await lampmoth.say('Replying to muted maren.', 'say', top.data.id);
    assert.equal(reply.status, 201);
    assert.equal(reply.data.reply_to, top.data.id);

    const st = await lampmoth.state();
    assert.equal(st.status, 200);
    const entry = st.data.prompt_book.find((e) => e.id === reply.data.id);
    assert.ok(entry);
    assert.equal(entry.reply_to, top.data.id);
  } finally {
    await ctx.close();
  }
});

test('admin delete-line: deleting top of a 3-level chain preserves replies and lets chain grow', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const r1 = await maren.say('Level 0');
    assert.equal(r1.status, 201);
    const r2 = await lampmoth.say('Level 1', 'say', r1.data.id);
    assert.equal(r2.status, 201);
    const r3 = await maren.say('Level 2', 'say', r2.data.id);
    assert.equal(r3.status, 201);
    const r4 = await lampmoth.say('Level 3', 'say', r3.data.id);
    assert.equal(r4.status, 201);

    const del = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/delete-line', {
      id: r1.data.id,
    });
    assert.equal(del.status, 200);

    const st = await maren.state();
    assert.equal(st.status, 200);
    assert.deepEqual(
      st.data.prompt_book.map((e) => [e.id, e.reply_to]),
      [[2, 1], [3, 2], [4, 3]]
    );

    const badReply = await maren.say('Reply to deleted 1', 'say', r1.data.id);
    assert.equal(badReply.status, 400);
    assert.equal(badReply.data.error, 'invalid_reply_to');

    const goodReply = await maren.say('Reply to surviving 4', 'say', r4.data.id);
    assert.equal(goodReply.status, 201);
    assert.equal(goodReply.data.reply_to, 4);
  } finally {
    await ctx.close();
  }
});

test('say reply_to: resident 7th say as a reply returns exact 429 body without mutating state', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const target = await lampmoth.say('Target line.');
    assert.equal(target.status, 201);

    for (let i = 1; i <= 5; i++) {
      const r = await maren.say(`Top say ${i}`);
      assert.equal(r.status, 201);
    }
    const sixth = await maren.say('Sixth as reply.', 'say', target.data.id);
    assert.equal(sixth.status, 201);

    const stBefore = await maren.state();
    assert.equal(stBefore.status, 200);
    const seqBefore = stBefore.data.state_seq;
    const lenBefore = stBefore.data.prompt_book.length;

    const seventh = await maren.say('Seventh as reply.', 'say', target.data.id);
    assert.equal(seventh.status, 429);
    assert.deepEqual(Object.keys(seventh.data), ['error', 'retry_after']);
    assert.equal(seventh.data.error, 'rate_limited');
    assert.equal(Number.isInteger(seventh.data.retry_after), true);
    assert.equal(seventh.data.retry_after >= 1 && seventh.data.retry_after <= 600, true);

    const stAfter = await maren.state();
    assert.equal(stAfter.status, 200);
    assert.equal(stAfter.data.prompt_book.length, lenBefore);
    assert.equal(stAfter.data.state_seq, seqBefore);
  } finally {
    await ctx.close();
  }
});

test('CLI say --reply-to edges: 0 and -1 exit 2, padded " 2 " succeeds, and 1e2 hits server 400', async () => {
  const ctx = await startTestServer();
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-say-g6-'));
  try {
    const { client: maren, keys } = await createResident(ctx, 'maren');
    const l1 = await maren.say('Line one.');
    assert.equal(l1.status, 201);
    assert.equal(l1.data.id, 1);
    const l2 = await maren.say('Line two.');
    assert.equal(l2.status, 201);
    assert.equal(l2.data.id, 2);

    const keyPath = path.join(keyDir, 'maren.pem');
    fs.writeFileSync(keyPath, keys.privateKeyPem, { mode: 0o600 });

    const baseArgs = [
      'say',
      '--api-base',
      ctx.baseUrl,
      '--handle',
      'maren',
      '--key',
      keyPath,
      '--body',
      'CLI edge reply',
      '--reply-to',
    ];

    const res0 = await runCliAsync([...baseArgs, '0']);
    assert.equal(res0.status, 2);
    assert.match(res0.stderr, /Invalid --reply-to "0" \(must be a positive integer\)/);

    const resNeg = await runCliAsync([...baseArgs, '-1']);
    assert.equal(resNeg.status, 2);
    assert.match(resNeg.stderr, /Invalid --reply-to "-1" \(must be a positive integer\)/);

    const resPad = await runCliAsync([...baseArgs, ' 2 ']);
    assert.equal(resPad.status, 0);
    const padParsed = JSON.parse(resPad.stdout.trim());
    assert.equal(padParsed.ok, true);
    assert.equal(padParsed.status, 201);
    assert.equal(padParsed.data.reply_to, 2);

    const resSci = await runCliAsync([...baseArgs, '1e2']);
    assert.equal(resSci.status, 0);
    const sciParsed = JSON.parse(resSci.stdout.trim());
    assert.equal(sciParsed.ok, false);
    assert.equal(sciParsed.status, 400);
    assert.equal(sciParsed.data.error, 'invalid_reply_to');
  } finally {
    fs.rmSync(keyDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('say reply_to numeric edges: 2.0 accepted, MAX_SAFE_INTEGER and 1e3 rejected without seq bump', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const l1 = await maren.say('First.');
    assert.equal(l1.status, 201);
    assert.equal(l1.data.id, 1);
    const l2 = await lampmoth.say('Second.');
    assert.equal(l2.status, 201);
    assert.equal(l2.data.id, 2);

    const stBefore = await maren.state();
    assert.equal(stBefore.status, 200);
    const seqBefore = stBefore.data.state_seq;

    const rFloat = await maren.say('Float two.', 'say', 2.0);
    assert.equal(rFloat.status, 201);
    assert.equal(rFloat.data.reply_to, 2);

    const rMax = await maren.say('Max safe.', 'say', Number.MAX_SAFE_INTEGER);
    assert.equal(rMax.status, 400);
    assert.equal(rMax.data.error, 'invalid_reply_to');

    const rSci = await maren.say('Thousand.', 'say', 1e3);
    assert.equal(rSci.status, 400);
    assert.equal(rSci.data.error, 'invalid_reply_to');

    const stAfter = await maren.state();
    assert.equal(stAfter.status, 200);
    assert.equal(stAfter.data.state_seq, seqBefore + 1);
  } finally {
    await ctx.close();
  }
});

test('prompt_book DB storage layer: exact row shape and column list', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const top = await maren.say('Top line.');
    assert.equal(top.status, 201);
    const reply = await lampmoth.say('Reply line.', 'say', top.data.id);
    assert.equal(reply.status, 201);

    const rows = ctx.db
      .prepare('SELECT id, handle, kind, body, reply_to, created_at FROM prompt_book ORDER BY id')
      .all()
      .map((r) => ({ ...r }));
    assert.deepStrictEqual(rows, [
      {
        id: top.data.id,
        handle: 'maren',
        kind: 'say',
        body: 'Top line.',
        reply_to: null,
        created_at: top.data.created_at,
      },
      {
        id: reply.data.id,
        handle: 'lampmoth',
        kind: 'say',
        body: 'Reply line.',
        reply_to: top.data.id,
        created_at: reply.data.created_at,
      },
    ]);

    const cols = ctx.db.prepare('PRAGMA table_info(prompt_book)').all().map((c) => c.name);
    assert.deepStrictEqual(cols, ['id', 'handle', 'kind', 'body', 'reply_to', 'created_at']);
  } finally {
    await ctx.close();
  }
});

test('prompt_book AUTOINCREMENT: deleted max id is never reused', async () => {
  const ctx = await startTestServer();
  try {
    const { client: maren } = await createResident(ctx, 'maren');
    const { client: lampmoth } = await createResident(ctx, 'lampmoth');

    const l1 = await maren.say('One.');
    assert.equal(l1.status, 201);
    const l2 = await maren.say('Two.');
    assert.equal(l2.status, 201);
    const l3 = await maren.say('Three.');
    assert.equal(l3.status, 201);
    assert.deepEqual([l1.data.id, l2.data.id, l3.data.id], [1, 2, 3]);

    const del = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/delete-line', {
      id: 3,
    });
    assert.equal(del.status, 200);

    const l4 = await maren.say('Four.');
    assert.equal(l4.status, 201);
    assert.equal(l4.data.id, 4);

    const badReply = await lampmoth.say('Reply to deleted 3.', 'say', 3);
    assert.equal(badReply.status, 400);
    assert.equal(badReply.data.error, 'invalid_reply_to');

    const goodReply = await lampmoth.say('Reply to fresh 4.', 'say', 4);
    assert.equal(goodReply.status, 201);
    assert.equal(goodReply.data.reply_to, 4);
  } finally {
    await ctx.close();
  }
});

test('test-say-reply.mjs hygiene: 45 unique tests, 11 imports, and pinned literal counts', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-say-reply.mjs'), 'utf8');
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 45);
  assert.equal(new Set(names).size, 45);

  const imports = src.split('\n').filter((line) => line.startsWith('import '));
  assert.equal(imports.length, 11);

  const countOf = (needle) => src.split(needle).length - 1;
  assert.equal(countOf('TO' + 'DO'), 0);
  assert.equal(countOf('FIX' + 'ME'), 0);
  assert.equal(countOf('Math.' + 'random'), 0);
  assert.equal(countOf('Date.' + 'now'), 9);
  assert.equal(countOf('fet' + 'ch('), 1);
});
