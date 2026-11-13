/**
 * Ghostlight Town — Seed NPC Run-All Wrapper Tests (Slice 21)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createTownServer } from '../town-api/server.mjs';
import { generateKeypair, GhostlightClient, signRequest } from '../town-api/ghostlight-client.mjs';
import { ensureKeypair } from './keygen.mjs';
import { runAll } from './run-all.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_ALL_SCRIPT = path.join(THIS_DIR, 'run-all.mjs');

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-api-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server } = createTownServer({
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
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function preRegisterNpcs(baseUrl, operatorKeys, stateDir, handles = ['wick', 'maren', 'tomas']) {
  for (const handle of handles) {
    const keys = ensureKeypair({ handle, stateDir, allowExisting: true });
    const client = new GhostlightClient({
      baseUrl,
      handle,
      privateKeyPem: keys.privateKeyPem,
      pubkey: keys.pubkey,
    });
    const joinRes = await client.join({ origin: 'colony', bio: `Seed NPC ${handle}` });
    assert.ok(joinRes.ok || joinRes.status === 409, `join failed for ${handle}: ${joinRes.status}`);

    const endpoint = '/api/town/admin/approve';
    const { rawBody, headers } = signRequest({
      method: 'POST',
      path: endpoint,
      body: { handle, role: 'npc' },
      handle: 'milo-op',
      privateKeyPem: operatorKeys.privateKeyPem,
    });
    const appRes = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
    assert.equal(appRes.status, 200, `approve failed for ${handle}: ${appRes.status}`);
  }
}

function runAllCli(args, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [RUN_ALL_SCRIPT, ...args],
      {
        cwd: os.tmpdir(),
        env: { ...process.env, TOWN_API_BASE: '', ...extraEnv },
      },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      }
    );
  });
}

function makeStateDirFromKeys(sharedKeysDir, handles = ['wick', 'maren', 'tomas']) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-state-'));
  for (const handle of handles) {
    const srcDir = path.join(sharedKeysDir, handle);
    const dstDir = path.join(stateDir, handle);
    fs.mkdirSync(dstDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, 'key.pem'), path.join(dstDir, 'key.pem'));
    fs.copyFileSync(path.join(srcDir, 'pubkey.txt'), path.join(dstDir, 'pubkey.txt'));
  }
  return stateDir;
}

test('runAll: happy path, single-npc, dry-run, stagger, trailing slash, and partial failure', async (t) => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
  t.after(async () => {
    await ctx.close();
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
  });

  await t.test('1. happy path runs all 3 NPCs in CHARACTERS order and prints summary', async () => {
    const stateDir = makeStateDirFromKeys(sharedKeysDir);
    try {
      const logs = [];
      const res = await runAll({
        apiBase: ctx.baseUrl,
        stateDir,
        staggerMs: 0,
        brainImpl: async (prompt) => {
          if (prompt.includes('You are Wick')) return 'The bulb is steady on the steps tonight.';
          if (prompt.includes('You are Maren')) return 'A clean line is worth keeping in the pocket.';
          return 'The copper kettle is warm if anyone stops by.';
        },
        logger: (obj) => logs.push(obj),
        sleepImpl: async () => {},
      });

      assert.equal(res.ok, true);
      assert.equal(res.results.length, 3);
      assert.deepEqual(
        res.results.map((r) => r.npc),
        ['wick', 'maren', 'tomas']
      );
      for (const r of res.results) {
        assert.equal(r.ok, true);
        assert.equal(r.posted, true);
      }

      const summary = logs[logs.length - 1];
      assert.equal(summary.action, 'run_all');
      assert.equal(summary.ok, true);
      assert.equal(summary.npcs.length, 3);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  await t.test('2. --npc maren via CLI runs only Maren with fake NPC_BRAIN_CMD', async () => {
    const stateDir = makeStateDirFromKeys(sharedKeysDir, ['maren']);
    try {
      const res = await runAllCli(
        ['--api-base', ctx.baseUrl, '--state-dir', stateDir, '--npc', 'maren', '--stagger-ms', '0'],
        { NPC_BRAIN_CMD: 'printf "Lead sorts clink softly in the tray.\\n"' }
      );
      assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);

      const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
      const summary = lines[lines.length - 1];
      assert.equal(summary.action, 'run_all');
      assert.equal(summary.ok, true);
      assert.equal(summary.npcs.length, 1);
      assert.equal(summary.npcs[0].npc, 'maren');
      assert.equal(summary.npcs[0].posted, true);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  await t.test('3. --dry-run via CLI writes nothing (no key.pem, state.json, or memory.md)', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-s3-'));
    try {
      const res = await runAllCli([
        '--api-base',
        ctx.baseUrl,
        '--state-dir',
        stateDir,
        '--stagger-ms',
        '0',
        '--dry-run',
      ]);
      assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
      assert.deepEqual(fs.readdirSync(stateDir), []);

      const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
      const summary = lines[lines.length - 1];
      assert.equal(summary.action, 'run_all');
      assert.equal(summary.ok, true);
      assert.equal(summary.npcs.length, 3);
      for (const entry of summary.npcs) {
        assert.equal(entry.action, 'dry_run');
        assert.equal(entry.posted, false);
        assert.equal(entry.ok, true);
      }
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  await t.test('5. one NPC failing does not block the others', async () => {
    const stateDir = makeStateDirFromKeys(sharedKeysDir);
    try {
      const logs = [];
      const res = await runAll({
        apiBase: ctx.baseUrl,
        stateDir,
        staggerMs: 0,
        brainImpl: async (prompt) => {
          if (prompt.includes('You are Maren')) {
            throw new Error('simulated brain failure');
          }
          return 'Quiet evening by the steps.';
        },
        logger: (obj) => logs.push(obj),
        sleepImpl: async () => {},
      });

      assert.equal(res.ok, false);
      assert.equal(res.results.length, 3);
      assert.deepEqual(
        res.results.map((r) => ({ npc: r.npc, ok: r.ok, posted: r.posted })),
        [
          { npc: 'wick', ok: true, posted: true },
          { npc: 'maren', ok: false, posted: false },
          { npc: 'tomas', ok: true, posted: true },
        ]
      );

      const summary = logs[logs.length - 1];
      assert.equal(summary.action, 'run_all');
      assert.equal(summary.ok, false);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  await t.test('6. stagger is honored between turns and never after the last', async () => {
    const stateDir = makeStateDirFromKeys(sharedKeysDir);
    try {
      const events = [];
      const sleepCalls = [];

      const res = await runAll({
        apiBase: ctx.baseUrl,
        stateDir,
        staggerMs: 1234,
        brainImpl: async (prompt) => {
          if (prompt.includes('You are Wick')) events.push('brain:wick');
          else if (prompt.includes('You are Maren')) events.push('brain:maren');
          else events.push('brain:tomas');
          return 'Evening is calm around the bandstand.';
        },
        logger: () => {},
        sleepImpl: async (ms) => {
          sleepCalls.push(ms);
          events.push(`sleep:${ms}`);
        },
      });

      assert.equal(res.ok, true);
      assert.deepEqual(sleepCalls, [1234, 1234]);
      assert.deepEqual(events, [
        'brain:wick',
        'sleep:1234',
        'brain:maren',
        'sleep:1234',
        'brain:tomas',
      ]);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  await t.test('7. --api-base with trailing slash works', async () => {
    const stateDir = makeStateDirFromKeys(sharedKeysDir, ['wick']);
    try {
      const logs = [];
      const res = await runAll({
        apiBase: `${ctx.baseUrl}///`,
        stateDir,
        npc: 'wick',
        staggerMs: 0,
        brainImpl: async () => 'Checked the brass cage on the bulb.',
        logger: (obj) => logs.push(obj),
        sleepImpl: async () => {},
      });

      assert.equal(res.ok, true);
      assert.equal(res.results[0].posted, true);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

test('4. dead API (unreachable and HTTP 500) exits 1 with one JSON error line and leaves state dir untouched', async () => {
  // 4a. Unreachable port
  const deadStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-dead-'));
  try {
    const res = await runAllCli([
      '--api-base',
      'http://127.0.0.1:1',
      '--state-dir',
      deadStateDir,
    ]);
    assert.equal(res.code, 1);
    const lines = res.stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const errObj = JSON.parse(lines[0]);
    assert.equal(errObj.ok, false);
    assert.equal(errObj.action, 'error');
    assert.deepEqual(fs.readdirSync(deadStateDir), []);
  } finally {
    fs.rmSync(deadStateDir, { recursive: true, force: true });
  }

  // 4b. Server returning 500 on probe
  const errServer = http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  });
  await new Promise((resolve) => errServer.listen(0, '127.0.0.1', resolve));
  const { port } = errServer.address();
  const stateDir500 = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-500-'));

  try {
    const res = await runAllCli([
      '--api-base',
      `http://127.0.0.1:${port}`,
      '--state-dir',
      stateDir500,
    ]);
    assert.equal(res.code, 1);
    const lines = res.stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const errObj = JSON.parse(lines[0]);
    assert.equal(errObj.ok, false);
    assert.equal(errObj.action, 'error');
    assert.equal(errObj.status, 500);
    assert.deepEqual(fs.readdirSync(stateDir500), []);
  } finally {
    await new Promise((resolve) => errServer.close(resolve));
    fs.rmSync(stateDir500, { recursive: true, force: true });
  }
});

test('CLI rejects invalid or missing arguments with usage on stderr and exit 1', async () => {
  const cases = [
    [],
    ['--api-base', 'http://127.0.0.1:9999', '--unknown-flag'],
    ['--api-base', 'http://127.0.0.1:9999', '--npc', 'nobody'],
    ['--api-base', 'http://127.0.0.1:9999', '--stagger-ms', '-5'],
    ['--api-base'],
  ];

  for (const argv of cases) {
    const res = await runAllCli(argv);
    assert.equal(res.code, 1, `expected exit 1 for args: ${JSON.stringify(argv)}`);
    assert.match(res.stderr, /Usage:/);
  }
});
