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
import { dailyGameHostForDate } from './daily-game.mjs';
import { CHARACTERS } from './characters.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUN_ALL_SCRIPT = path.join(THIS_DIR, 'run-all.mjs');

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-api-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
    gamesPath: opts.gamesPath,
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

test('runAll per-line selectivity: one unaddressed muse line -> exactly one NPC posts', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-select-'));
  try {
    const now = Math.floor(Date.now() / 1000);
    const fakeState = {
      footlights: [],
      prompt_book: [
        {
          id: 4,
          handle: 'lampmoth',
          role: 'muse',
          kind: 'say',
          body: 'Evening, Bandstand...',
          created_at: now - 60,
        },
      ],
      presence: [],
    };
    const postedUrls = [];
    const fakeFetch = async (url, init) => {
      if (init && init.method === 'POST') {
        postedUrls.push(String(url));
        const body = { ok: true };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(body),
          json: async () => body,
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(fakeState),
        json: async () => fakeState,
      };
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    const brainCalls = [];
    let res;
    try {
      res = await runAll({
        apiBase: 'http://fake.local',
        stateDir,
        staggerMs: 0,
        fetchImpl: fakeFetch,
        brainImpl: async (prompt) => {
          brainCalls.push(prompt);
          return 'Quiet night by the steps; the kettle is warm.';
        },
        logger: () => {},
        sleepImpl: async () => {},
      });
    } finally {
      globalThis.fetch = origFetch;
    }

    assert.equal(res.ok, true);
    assert.equal(res.results.length, 3);
    const posted = res.results.filter((r) => r.posted);
    const silent = res.results.filter((r) => r.action === 'silent');
    assert.equal(posted.length, 1, 'exactly one NPC posts');
    assert.equal(posted[0].npc, 'maren', 'id=4 % 3 === 1 designates maren');
    assert.equal(posted[0].action, 'reply');
    assert.equal(silent.length, 2, 'other two NPCs stay silent');
    assert.equal(brainCalls.length, 1);
    assert.ok(brainCalls[0].includes("lampmoth's line #4"));
    assert.equal(postedUrls.filter((u) => u.endsWith('/api/town/ghostlight/say')).length, 1);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('runAll function-level guards: missing apiBase, unknown npc, probe throw, probe 500', async (t) => {
  const sleepImpl = async () => {};

  await t.test('A. missing apiBase logs error and never calls fetch', async () => {
    const logs = [];
    let fetchCalled = false;
    const res = await runAll({
      apiBase: '',
      stateDir: '/tmp/nope',
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('should not be called');
      },
      logger: (obj) => logs.push(obj),
      sleepImpl,
    });
    assert.deepEqual(res, { ok: false, results: [] });
    assert.equal(fetchCalled, false);
    assert.deepEqual(logs, [{ action: 'error', ok: false, error: 'Missing apiBase' }]);
  });

  await t.test('B. unknown npc logs error and never calls fetch', async () => {
    const logs = [];
    let fetchCalled = false;
    const res = await runAll({
      apiBase: 'http://fake.local',
      npc: 'nobody',
      stateDir: '/tmp/nope',
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('should not be called');
      },
      logger: (obj) => logs.push(obj),
      sleepImpl,
    });
    assert.deepEqual(res, { ok: false, results: [] });
    assert.equal(fetchCalled, false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].error, 'Unknown seed NPC: nobody');
  });

  await t.test('C. probe fetch throwing logs error without status key', async () => {
    const logs = [];
    const res = await runAll({
      apiBase: 'http://fake.local',
      stateDir: '/tmp/nope',
      fetchImpl: async () => {
        throw new Error('boom');
      },
      logger: (obj) => logs.push(obj),
      sleepImpl,
    });
    assert.deepEqual(res, { ok: false, results: [] });
    assert.deepEqual(logs, [
      { action: 'error', ok: false, error: 'API unreachable: boom', api_base: 'http://fake.local' },
    ]);
    assert.equal('status' in logs[0], false);
  });

  await t.test('D. probe HTTP 500 logs error with status 500', async () => {
    const logs = [];
    const res = await runAll({
      apiBase: 'http://fake.local',
      stateDir: '/tmp/nope',
      fetchImpl: async () => ({ ok: false, status: 500 }),
      logger: (obj) => logs.push(obj),
      sleepImpl,
    });
    assert.deepEqual(res, { ok: false, results: [] });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 500);
    assert.match(logs[0].error, /HTTP 500/);
  });
});

test('runTurn throwing is caught per NPC when stateDir is a regular file', async () => {
  const ctx = await startTestServer();
  const keysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  const fileStateDir = path.join(os.tmpdir(), `ghostlight-runall-file-${process.pid}-${Date.now()}`);
  fs.writeFileSync(fileStateDir, 'not a dir', 'utf8');
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, keysDir);
    const logs = [];
    const res = await runAll({
      apiBase: ctx.baseUrl,
      stateDir: fileStateDir,
      staggerMs: 0,
      brainImpl: async () => 'x',
      logger: (obj) => logs.push(obj),
      sleepImpl: async () => {},
    });

    assert.equal(res.ok, false);
    assert.equal(res.results.length, 3);
    for (const r of res.results) {
      assert.equal(r.action, 'error');
      assert.equal(r.ok, false);
      assert.equal(r.posted, false);
    }

    assert.equal(logs.length, 4);
    assert.deepEqual(
      logs.slice(0, 3).map((l) => l.npc),
      ['wick', 'maren', 'tomas']
    );
    for (const entry of logs.slice(0, 3)) {
      assert.equal(entry.action, 'error');
      assert.equal(typeof entry.reason, 'string');
      assert.ok(entry.reason.length > 0);
    }
    assert.equal(logs[3].action, 'run_all');
    assert.equal(logs[3].ok, false);
  } finally {
    fs.rmSync(fileStateDir, { force: true });
    fs.rmSync(keysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('CLI --help and invalid --stagger-ms exit 1 with usage on stderr', async () => {
  const helpRes = await runAllCli(['--help']);
  assert.equal(helpRes.code, 1);
  assert.match(helpRes.stderr, /Usage:/);
  assert.equal(helpRes.stdout, '');

  const staggerRes = await runAllCli(['--api-base', 'http://127.0.0.1:9999', '--stagger-ms', 'abc']);
  assert.equal(staggerRes.code, 1);
  assert.match(staggerRes.stderr, /Usage:/);
  assert.match(staggerRes.stderr, /Invalid --stagger-ms/);
});

test('CLI TOWN_API_BASE env fallback runs dry-run and exits 0', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-env-'));
  try {
    const res = await runAllCli(
      ['--state-dir', stateDir, '--stagger-ms', '0', '--dry-run'],
      { TOWN_API_BASE: ctx.baseUrl }
    );
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    assert.equal(summary.npcs.length, 3);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('CLI partial failure exits 1 with ok: false summary', async () => {
  const ctx = await startTestServer({ gamesPath: '' });
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
    const res = await runAllCli(
      ['--api-base', ctx.baseUrl, '--state-dir', stateDir, '--stagger-ms', '0'],
      { NPC_BRAIN_CMD: 'false' }
    );
    assert.equal(res.code, 1, `expected exit 1, got ${res.code}, stderr: ${res.stderr}`);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, false);
    assert.equal(summary.npcs.length, 3);
    for (const entry of summary.npcs) {
      assert.equal(entry.ok, false);
    }
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('function-level dry-run runs all 3 NPCs, posts nothing, writes nothing, never consults the brain', async () => {
  const ctx = await startTestServer();
  const keysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-dry-'));
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, keysDir);
    const logs = [];
    const res = await runAll({
      apiBase: ctx.baseUrl,
      stateDir,
      staggerMs: 0,
      dryRun: true,
      brainImpl: async () => {
        throw new Error('brain must not be called in dry-run');
      },
      logger: (obj) => logs.push(obj),
      sleepImpl: async () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.results.length, 3);
    for (const r of res.results) {
      assert.equal(r.action, 'dry_run');
      assert.equal(r.posted, false);
      assert.equal(r.ok, true);
    }
    assert.deepEqual(fs.readdirSync(stateDir), []);
    const summary = logs[logs.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    assert.equal(logs.filter((l) => l.action === 'dry_run').length, 3);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(keysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('single-NPC run never calls sleep, even with a large stagger', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    // Pick a non-host NPC dynamically: on the UTC date when an NPC is the
    // daily-game host, its turn posts the game via the game bypass without
    // calling the brain, so brainCalls would be 0.
    const state = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(state.daily_game.date);
    const npc = CHARACTERS.find((c) => c.handle !== host).handle;

    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir, [npc]);
    stateDir = makeStateDirFromKeys(sharedKeysDir, [npc]);
    let brainCalls = 0;
    const sleepCalls = [];
    const res = await runAll({
      apiBase: ctx.baseUrl,
      stateDir,
      npc,
      staggerMs: 9999,
      brainImpl: async () => {
        brainCalls++;
        return 'A quiet evening by the steps.';
      },
      logger: () => {},
      sleepImpl: async (ms) => sleepCalls.push(ms),
    });

    assert.equal(res.ok, true);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].npc, npc);
    assert.equal(res.results[0].posted, true);
    assert.deepEqual(sleepCalls, []);
    assert.equal(brainCalls, 1);
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('probe HTTP 404 and 403 log the status and run no turns', async () => {
  for (const status of [404, 403]) {
    const logs = [];
    let fetchCalls = 0;
    const res = await runAll({
      apiBase: 'http://fake.local',
      stateDir: '/tmp/nope',
      fetchImpl: async () => {
        fetchCalls++;
        return { ok: false, status };
      },
      logger: (obj) => logs.push(obj),
      sleepImpl: async () => {},
    });

    assert.deepEqual(res, { ok: false, results: [] });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, status);
    assert.match(logs[0].error, new RegExp(`HTTP ${status}`));
    assert.equal(logs[0].api_base, 'http://fake.local');
    assert.equal(fetchCalls, 1);
  }
});

test('CLI rejects empty --stagger-ms with usage on stderr', async () => {
  const ctx = await startTestServer();
  try {
    const res = await runAllCli(['--api-base', ctx.baseUrl, '--stagger-ms', '']);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Usage:/);
    assert.match(res.stderr, /Invalid --stagger-ms/);
  } finally {
    await ctx.close();
  }
});

test('whitespace-only apiBase fails at the probe, not as missing', async () => {
  const logs = [];
  const urls = [];
  const res = await runAll({
    apiBase: '   ',
    stateDir: '/tmp/nope',
    fetchImpl: async (url) => {
      urls.push(String(url));
      throw new Error('boom');
    },
    logger: (obj) => logs.push(obj),
    sleepImpl: async () => {},
  });

  assert.deepEqual(res, { ok: false, results: [] });
  assert.equal(logs.length, 1);
  assert.match(logs[0].error, /API unreachable: boom/);
  assert.notEqual(logs[0].error, 'Missing apiBase');
  assert.deepEqual(urls, ['   /api/town/state']);
});

test('CLI --npc wick --dry-run runs only Wick, exits 0, writes nothing', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-wick-dry-'));
  try {
    const res = await runAllCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--npc',
      'wick',
      '--stagger-ms',
      '0',
      '--dry-run',
    ]);
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    assert.deepEqual(fs.readdirSync(stateDir), []);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    assert.equal(summary.npcs.length, 1);
    assert.equal(summary.npcs[0].npc, 'wick');
    assert.equal(summary.npcs[0].action, 'dry_run');
    assert.equal(summary.npcs[0].posted, false);
    assert.equal(summary.npcs[0].ok, true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('zero stagger never sleeps across all three NPCs', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
    const sleepCalls = [];
    const res = await runAll({
      apiBase: ctx.baseUrl,
      stateDir,
      staggerMs: 0,
      brainImpl: async (prompt) => {
        if (prompt.includes('You are Wick')) return 'The bulb is steady on the steps tonight.';
        if (prompt.includes('You are Maren')) return 'A clean line is worth keeping in the pocket.';
        return 'The copper kettle is warm if anyone stops by.';
      },
      logger: () => {},
      sleepImpl: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(res.ok, true);
    assert.deepEqual(sleepCalls, []);
    assert.deepEqual(
      res.results.map((r) => r.posted),
      [true, true, true]
    );
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('default stagger is 60 seconds between turns', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
    const sleepCalls = [];
    const res = await runAll({
      apiBase: ctx.baseUrl,
      stateDir,
      brainImpl: async (prompt) => {
        if (prompt.includes('You are Wick')) return 'The bulb is steady on the steps tonight.';
        if (prompt.includes('You are Maren')) return 'A clean line is worth keeping in the pocket.';
        return 'The copper kettle is warm if anyone stops by.';
      },
      logger: () => {},
      sleepImpl: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(res.ok, true);
    assert.deepEqual(sleepCalls, [60000, 60000]);
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('CLI full happy path runs all three NPCs and exits 0', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
    const res = await runAllCli(
      ['--api-base', ctx.baseUrl, '--state-dir', stateDir, '--stagger-ms', '0'],
      { NPC_BRAIN_CMD: 'printf "The kettle is warm by the steps tonight.\\n"' }
    );
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    assert.deepEqual(
      summary.npcs.map((n) => n.npc),
      ['wick', 'maren', 'tomas']
    );
    assert.deepEqual(
      summary.npcs.map((n) => n.posted),
      [true, true, true]
    );
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('uppercase --npc is rejected by CLI and by runAll', async () => {
  const cliRes = await runAllCli([
    '--api-base',
    'http://127.0.0.1:9999',
    '--state-dir',
    '/tmp/nope',
    '--npc',
    'WICK',
    '--stagger-ms',
    '0',
  ]);
  assert.equal(cliRes.code, 1);
  assert.match(cliRes.stderr, /Usage:/);
  assert.match(cliRes.stderr, /Invalid --npc "WICK"/);

  const logs = [];
  let fetchCalled = false;
  const res = await runAll({
    apiBase: 'http://fake.local',
    npc: 'WICK',
    stateDir: '/tmp/nope',
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('should not be called');
    },
    logger: (obj) => logs.push(obj),
    sleepImpl: async () => {},
  });
  assert.deepEqual(res, { ok: false, results: [] });
  assert.equal(fetchCalled, false);
  assert.deepEqual(logs, [{ action: 'error', ok: false, error: 'Unknown seed NPC: WICK' }]);
});

test('CLI --npc twice runs only the last one', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-npc-twice-'));
  try {
    const res = await runAllCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--npc',
      'wick',
      '--npc',
      'maren',
      '--stagger-ms',
      '0',
      '--dry-run',
    ]);
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    assert.deepEqual(fs.readdirSync(stateDir), []);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    assert.equal(summary.npcs.length, 1);
    assert.equal(summary.npcs[0].npc, 'maren');
    assert.equal(summary.npcs[0].action, 'dry_run');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('CLI --npc with no value exits 1 with usage', async () => {
  const res = await runAllCli(['--api-base', 'http://127.0.0.1:9999', '--npc']);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /Usage:/);
  assert.match(res.stderr, /Unknown or incomplete argument: --npc/);
});

test('CLI --stagger-ms 1.5 is accepted', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-stagger-frac-'));
  try {
    const res = await runAllCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--stagger-ms',
      '1.5',
      '--dry-run',
    ]);
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('run_all summary npcs mirrors results on partial failure', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    // Pick a non-host victim dynamically: on the UTC date when an NPC is the
    // daily-game host, its turn posts the game via the game bypass without
    // calling the brain, so throwing in brainImpl would never trigger.
    const state = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(state.daily_game.date);
    const victim = CHARACTERS.find((c) => c.handle !== host);

    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
    const logs = [];
    const res = await runAll({
      apiBase: ctx.baseUrl,
      stateDir,
      staggerMs: 0,
      brainImpl: async (prompt) => {
        if (prompt.includes(`You are ${victim.name}`)) {
          throw new Error('simulated brain failure');
        }
        return 'Quiet evening by the steps.';
      },
      logger: (obj) => logs.push(obj),
      sleepImpl: async () => {},
    });

    assert.equal(res.ok, false);
    const summary = logs[logs.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, false);
    assert.deepEqual(summary.npcs, res.results);
    assert.deepEqual(
      summary.npcs.find((r) => r.npc === victim.handle),
      {
        npc: victim.handle,
        action: 'error',
        posted: false,
        ok: false,
      }
    );
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('happy-path log sequence: three turn logs in order, then the run_all summary', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
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
    assert.equal(logs.length, 4);
    assert.deepEqual(
      logs.slice(0, 3).map((l) => l.npc),
      ['wick', 'maren', 'tomas']
    );
    for (const entry of logs.slice(0, 3)) {
      assert.equal(entry.posted, true);
    }
    assert.equal(logs[3].action, 'run_all');
    assert.equal(logs[3].ok, true);

    const stateRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();
    const host = dailyGameHostForDate(state.daily_game.date);
    const hostIndex = ['wick', 'maren', 'tomas'].indexOf(host);
    assert.notEqual(hostIndex, -1);
    assert.equal(logs[hostIndex].postedGame, true);
    assert.equal(logs[hostIndex].reason, 'daily game');
    for (let i = 0; i < 3; i++) {
      if (i !== hostIndex) {
        assert.equal('postedGame' in logs[i], false);
      }
    }
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('CLI duplicate --api-base: last one wins', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
    const res = await runAllCli(
      [
        '--api-base',
        'http://127.0.0.1:1',
        '--api-base',
        ctx.baseUrl,
        '--state-dir',
        stateDir,
        '--npc',
        'wick',
        '--stagger-ms',
        '0',
      ],
      { NPC_BRAIN_CMD: 'printf "The bulb is steady.\\n"' }
    );
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    assert.equal(summary.npcs.length, 1);
    assert.equal(summary.npcs[0].npc, 'wick');
    assert.equal(summary.npcs[0].posted, true);
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('CLI --state-dir with no value exits 1 with usage', async () => {
  const ctx = await startTestServer();
  try {
    const res = await runAllCli(['--api-base', ctx.baseUrl, '--state-dir']);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Unknown or incomplete argument: --state-dir/);
  } finally {
    await ctx.close();
  }
});

test('CLI --help prints exact full usage text', async () => {
  const res = await runAllCli(['--help']);
  assert.equal(res.code, 1);
  assert.equal(
    res.stderr,
    'Usage: node town-npc/run-all.mjs --api-base <url> [--state-dir ./npc_state] [--npc wick|maren|tomas] [--stagger-ms N] [--dry-run]\n'
  );
  assert.equal(res.stdout, '');
});

test('CLI -h prints exact full usage text', async () => {
  const res = await runAllCli(['-h']);
  assert.equal(res.code, 1);
  assert.equal(
    res.stderr,
    'Usage: node town-npc/run-all.mjs --api-base <url> [--state-dir ./npc_state] [--npc wick|maren|tomas] [--stagger-ms N] [--dry-run]\n'
  );
  assert.equal(res.stdout, '');
});

test('CLI missing --api-base (no-arg and empty-string) prints exact error and usage', async () => {
  const expectedStderr =
    'Error: Missing --api-base (or TOWN_API_BASE)\n' +
    'Usage: node town-npc/run-all.mjs --api-base <url> [--state-dir ./npc_state] [--npc wick|maren|tomas] [--stagger-ms N] [--dry-run]\n';

  const noArgRes = await runAllCli([]);
  assert.equal(noArgRes.code, 1);
  assert.equal(noArgRes.stderr, expectedStderr);

  const emptyArgRes = await runAllCli(['--api-base', '', '--state-dir', '/tmp/nope', '--dry-run']);
  assert.equal(emptyArgRes.code, 1);
  assert.equal(emptyArgRes.stderr, expectedStderr);
});

test('CLI --npc empty string runs all three NPCs in dry-run', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-empty-npc-'));
  try {
    const res = await runAllCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--npc',
      '',
      '--stagger-ms',
      '0',
      '--dry-run',
    ]);
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    assert.deepEqual(fs.readdirSync(stateDir), []);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    assert.equal(summary.npcs.length, 3);
    assert.deepEqual(
      summary.npcs.map((n) => n.npc),
      ['wick', 'maren', 'tomas']
    );
    for (const entry of summary.npcs) {
      assert.equal(entry.action, 'dry_run');
    }
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('CLI probe-500 error JSON carries full payload including api_base and error', async () => {
  const errServer = http.createServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  });
  await new Promise((resolve) => errServer.listen(0, '127.0.0.1', resolve));
  const { port } = errServer.address();
  const base = `http://127.0.0.1:${port}`;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-500-full-'));
  try {
    const res = await runAllCli(['--api-base', base, '--state-dir', stateDir]);
    assert.equal(res.code, 1);
    const lines = res.stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const errObj = JSON.parse(lines[0]);
    assert.deepEqual(errObj, {
      action: 'error',
      ok: false,
      error: 'API probe failed with HTTP 500',
      api_base: base,
      status: 500,
    });
    assert.deepEqual(fs.readdirSync(stateDir), []);
  } finally {
    await new Promise((resolve) => errServer.close(resolve));
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('negative stagger never sleeps', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
    const sleepCalls = [];
    const res = await runAll({
      apiBase: ctx.baseUrl,
      stateDir,
      staggerMs: -5,
      brainImpl: async (prompt) => {
        if (prompt.includes('You are Wick')) return 'The bulb is steady on the steps tonight.';
        if (prompt.includes('You are Maren')) return 'A clean line is worth keeping in the pocket.';
        return 'The copper kettle is warm if anyone stops by.';
      },
      logger: () => {},
      sleepImpl: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(res.ok, true);
    assert.deepEqual(sleepCalls, []);
    assert.deepEqual(
      res.results.map((r) => r.posted),
      [true, true, true]
    );
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('function-level dry-run still staggers between turns', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
    const sleepCalls = [];
    let brainCalls = 0;
    const res = await runAll({
      apiBase: ctx.baseUrl,
      stateDir,
      staggerMs: 1234,
      dryRun: true,
      brainImpl: async () => {
        brainCalls++;
        throw new Error('brain must not be called in dry-run');
      },
      logger: () => {},
      sleepImpl: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(res.ok, true);
    assert.deepEqual(sleepCalls, [1234, 1234]);
    assert.equal(brainCalls, 0);
    assert.deepEqual(
      res.results.map((r) => ({ action: r.action, posted: r.posted })),
      [
        { action: 'dry_run', posted: false },
        { action: 'dry_run', posted: false },
        { action: 'dry_run', posted: false },
      ]
    );
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('10-muse retirement: all three retire, run stays ok, brain never called', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-retire-'));
  try {
    const now = Math.floor(Date.now() / 1000);
    const fakeState = {
      footlights: [],
      prompt_book: Array.from({ length: 10 }, (_, idx) => ({
        id: idx + 1,
        handle: `muse${idx + 1}`,
        role: 'muse',
        kind: 'say',
        body: `Hello from muse ${idx + 1}.`,
        created_at: now - 60,
      })),
      presence: [],
    };
    const postedUrls = [];
    const fakeFetch = async (url, init) => {
      if (init && init.method === 'POST') {
        postedUrls.push(String(url));
        const body = { ok: true };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(body),
          json: async () => body,
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(fakeState),
        json: async () => fakeState,
      };
    };

    let brainCalls = 0;
    const logs = [];
    const res = await runAll({
      apiBase: 'http://fake.local',
      stateDir,
      staggerMs: 0,
      fetchImpl: fakeFetch,
      brainImpl: async () => {
        brainCalls++;
        return 'Should not be called.';
      },
      logger: (obj) => logs.push(obj),
      sleepImpl: async () => {},
    });

    assert.equal(res.ok, true);
    assert.deepEqual(
      res.results.map((r) => ({ action: r.action, posted: r.posted })),
      [
        { action: 'retired', posted: false },
        { action: 'retired', posted: false },
        { action: 'retired', posted: false },
      ]
    );
    assert.equal(brainCalls, 0);
    assert.deepEqual(postedUrls, []);
    const summary = logs[logs.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    const retiredLogs = logs.filter((l) => l.action === 'retired');
    assert.equal(retiredLogs.length, 3);
    assert.deepEqual(
      retiredLogs.map((l) => l.npc),
      ['wick', 'maren', 'tomas']
    );
    for (const entry of retiredLogs) {
      assert.match(entry.reason, /10 real muses active in 24h/);
    }
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('CLI duplicate --state-dir: last one wins', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-statedir-'));
  const deadDir = path.join(tmpBase, 'dead-dir');
  let realDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    realDir = makeStateDirFromKeys(sharedKeysDir, ['wick']);
    const res = await runAllCli(
      [
        '--api-base',
        ctx.baseUrl,
        '--state-dir',
        deadDir,
        '--state-dir',
        realDir,
        '--npc',
        'wick',
        '--stagger-ms',
        '0',
      ],
      { NPC_BRAIN_CMD: 'printf "The bulb is steady.\\n"' }
    );
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    assert.equal(summary.npcs[0].posted, true);
    assert.equal(fs.existsSync(deadDir), false);
    assert.equal(fs.existsSync(path.join(realDir, 'wick', 'memory.md')), true);
  } finally {
    if (realDir) fs.rmSync(realDir, { recursive: true, force: true });
    fs.rmSync(tmpBase, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('CLI duplicate --stagger-ms: last one wins', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-stagger-'));
  try {
    const t0 = Date.now();
    const res = await runAllCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--stagger-ms',
      '5000',
      '--stagger-ms',
      '0',
      '--dry-run',
    ]);
    const elapsed = Date.now() - t0;
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    assert.ok(elapsed < 8000, `expected elapsed < 8000ms, got ${elapsed}ms`);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.ok, true);
    assert.equal(summary.npcs.length, 3);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('CLI --api-base of only slashes fails as missing apiBase', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-slashes-'));
  try {
    const res = await runAllCli(['--api-base', '///', '--state-dir', stateDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stderr, '');
    const lines = res.stdout.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      action: 'error',
      ok: false,
      error: 'Missing apiBase',
    });
    assert.deepEqual(fs.readdirSync(stateDir), []);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('CLI invalid --stagger-ms values are rejected with exact text', async () => {
  for (const v of ['NaN', 'Infinity', '-1', '1e']) {
    const res = await runAllCli(['--api-base', 'http://127.0.0.1:9', '--stagger-ms', v]);
    assert.equal(res.code, 1, `expected exit 1 for --stagger-ms ${v}`);
    assert.equal(res.stdout, '', `expected empty stdout for --stagger-ms ${v}`);
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      res.stderr,
      new RegExp(`Invalid --stagger-ms "${escaped}" \\(expected non-negative number\\)`)
    );
    assert.match(res.stderr, /Usage:/);
  }
});

test('CLI unknown flag and bare -- are rejected with exact message', async () => {
  for (const flag of ['--bogus', '--']) {
    const res = await runAllCli([
      '--api-base',
      'http://127.0.0.1:9',
      '--state-dir',
      '/tmp/nope',
      flag,
    ]);
    assert.equal(res.code, 1, `expected exit 1 for ${flag}`);
    assert.equal(res.stdout, '', `expected empty stdout for ${flag}`);
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(res.stderr, new RegExp(`Unknown or incomplete argument: ${escaped}`));
    assert.match(res.stderr, /Usage:/);
  }
});

test('multi-slash apiBase probes the stripped URL', async () => {
  const urls = [];
  const statePayload = {
    state_seq: 0,
    footlights: [],
    prompt_book: [],
    presence: [],
    daily_game: null,
    nightly_call: null,
    garden: [],
    plots: {},
    events: { now: null, next: null },
  };
  const recServer = http.createServer((req, res) => {
    urls.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statePayload));
  });
  await new Promise((resolve) => recServer.listen(0, '127.0.0.1', resolve));
  const { port } = recServer.address();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-multislash-'));
  try {
    const logs = [];
    const res = await runAll({
      apiBase: `http://127.0.0.1:${port}///`,
      stateDir,
      staggerMs: 0,
      dryRun: true,
      logger: (obj) => logs.push(obj),
      sleepImpl: async () => {},
    });
    assert.equal(res.ok, true);
    assert.deepEqual(
      res.results.map((r) => r.action),
      ['dry_run', 'dry_run', 'dry_run']
    );
    assert.ok(urls.length >= 4, `expected >= 4 recorded urls, got ${urls.length}`);
    for (const u of urls) {
      assert.equal(u, '/api/town/state');
    }
    assert.deepEqual(fs.readdirSync(stateDir), []);
  } finally {
    await new Promise((resolve) => recServer.close(resolve));
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('runAll return, result rows, and run_all summary have exact key sets', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
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
    assert.deepEqual(Object.keys(res).sort(), ['ok', 'results']);
    for (const row of res.results) {
      assert.deepEqual(Object.keys(row).sort(), ['action', 'npc', 'ok', 'posted']);
    }
    const summary = logs[logs.length - 1];
    assert.deepEqual(Object.keys(summary).sort(), ['action', 'npcs', 'ok']);
    for (const row of summary.npcs) {
      assert.deepEqual(Object.keys(row).sort(), ['action', 'npc', 'ok', 'posted']);
    }
    assert.deepEqual(res.results, summary.npcs);
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('runAll with no options uses defaults and logs Missing apiBase', async () => {
  const resDefault = await runAll();
  assert.deepEqual(resDefault, { ok: false, results: [] });

  let fetchCalled = false;
  const logs = [];
  const resInjected = await runAll({
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('no');
    },
    logger: (obj) => logs.push(obj),
    sleepImpl: async () => {},
  });
  assert.deepEqual(resInjected, { ok: false, results: [] });
  assert.equal(fetchCalled, false);
  assert.deepEqual(logs, [{ action: 'error', ok: false, error: 'Missing apiBase' }]);
});

test('CLI --dry-run twice is accepted', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-dryrun2-'));
  try {
    const res = await runAllCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--stagger-ms',
      '0',
      '--dry-run',
      '--dry-run',
    ]);
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    const lines = res.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines[lines.length - 1];
    assert.equal(summary.action, 'run_all');
    assert.equal(summary.ok, true);
    assert.deepEqual(
      summary.npcs.map((n) => n.action),
      ['dry_run', 'dry_run', 'dry_run']
    );
    assert.deepEqual(fs.readdirSync(stateDir), []);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    await ctx.close();
  }
});

test('happy path writes per-NPC state files for all three NPCs', async () => {
  const ctx = await startTestServer();
  const sharedKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runall-keys-'));
  let stateDir = null;
  try {
    await preRegisterNpcs(ctx.baseUrl, ctx.operatorKeys, sharedKeysDir);
    stateDir = makeStateDirFromKeys(sharedKeysDir);
    const res = await runAll({
      apiBase: ctx.baseUrl,
      stateDir,
      staggerMs: 0,
      brainImpl: async (prompt) => {
        if (prompt.includes('You are Wick')) return 'The bulb is steady on the steps tonight.';
        if (prompt.includes('You are Maren')) return 'A clean line is worth keeping in the pocket.';
        return 'The copper kettle is warm if anyone stops by.';
      },
      logger: () => {},
      sleepImpl: async () => {},
    });
    assert.equal(res.ok, true);
    assert.deepEqual(fs.readdirSync(stateDir).sort(), ['maren', 'tomas', 'wick']);
    for (const handle of ['wick', 'maren', 'tomas']) {
      for (const fname of ['key.pem', 'pubkey.txt', 'memory.md', 'state.json']) {
        assert.equal(
          fs.existsSync(path.join(stateDir, handle, fname)),
          true,
          `expected ${handle}/${fname} to exist`
        );
      }
      const memLen = fs.readFileSync(path.join(stateDir, handle, 'memory.md'), 'utf8').length;
      assert.ok(memLen > 0 && memLen < 2048, `expected 0 < memory.md length < 2048 for ${handle}, got ${memLen}`);
    }
  } finally {
    if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    fs.rmSync(sharedKeysDir, { recursive: true, force: true });
    await ctx.close();
  }
});
