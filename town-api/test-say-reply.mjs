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
