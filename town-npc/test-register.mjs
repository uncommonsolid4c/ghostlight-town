/**
 * Ghostlight Town — Seed NPC Registration Tests (Slice 18)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { createTownServer } from '../town-api/server.mjs';
import { generateKeypair, GhostlightClient } from '../town-api/ghostlight-client.mjs';
import { ensureKeypair } from './keygen.mjs';
import { getCharacter } from './characters.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REGISTER_SCRIPT = path.join(THIS_DIR, 'register.mjs');
const REPO_PLOTS_DIR = path.join(THIS_DIR, 'plots');

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-api-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  const operatorKeyPath = path.join(tmpDir, 'operator.pem');
  fs.writeFileSync(operatorKeyPath, operatorKeys.privateKeyPem, { encoding: 'utf8', mode: 0o600 });

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
    dbPath,
    plotsDir,
    baseUrl,
    operatorKeyPath,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function runRegisterCli(args, cwd = os.tmpdir(), env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [REGISTER_SCRIPT, ...args],
      { cwd, env: { ...process.env, TOWN_API_BASE: '', TOWN_OPERATOR_KEY: '', ...env } },
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

function readResidents(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT handle, pubkey, origin, status, role, bio, plot_updated_at FROM residents ORDER BY handle').all();
  } finally {
    db.close();
  }
}

test('registers all three seed NPCs, approves as npc, and PUTs plots', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
    ]);
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);

    const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.deepEqual(
      lines.map((l) => l.handle),
      ['wick', 'maren', 'tomas']
    );
    for (const row of lines) {
      assert.equal(row.joined, 'created');
      assert.equal(row.approved, 'created');
      assert.equal(row.plot, 'ok');
      assert.equal(row.pubkey.length, 44);
    }

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 3);
    for (const r of residents) {
      assert.equal(r.role, 'npc');
      assert.equal(r.status, 'active');
      assert.ok(r.plot_updated_at !== null);
    }

    for (const handle of ['wick', 'maren', 'tomas']) {
      const serverManifestPath = path.join(ctx.plotsDir, handle, 'manifest.json');
      const serverHtmlPath = path.join(ctx.plotsDir, handle, 'index.html');
      assert.ok(fs.existsSync(serverManifestPath), `missing ${handle}/manifest.json on disk`);
      assert.ok(fs.existsSync(serverHtmlPath), `missing ${handle}/index.html on disk`);

      const repoManifest = JSON.parse(fs.readFileSync(path.join(REPO_PLOTS_DIR, handle, 'manifest.json'), 'utf8'));
      const serverManifest = JSON.parse(fs.readFileSync(serverManifestPath, 'utf8'));
      assert.deepEqual(serverManifest, repoManifest);

      const repoHtml = fs.readFileSync(path.join(REPO_PLOTS_DIR, handle, 'desk-note.html'), 'utf8');
      const serverHtml = fs.readFileSync(serverHtmlPath, 'utf8');
      assert.equal(serverHtml, repoHtml);
    }

    const plotRes = await fetch(`${ctx.baseUrl}/api/town/plot?handle=wick`);
    assert.equal(plotRes.status, 200);
    const plotData = await plotRes.json();
    const expectedWickManifest = JSON.parse(fs.readFileSync(path.join(REPO_PLOTS_DIR, 'wick', 'manifest.json'), 'utf8'));
    assert.deepEqual(plotData.manifest, expectedWickManifest);
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('idempotent re-run succeeds with 3 npc residents and no duplicates', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const cliArgs = [
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
    ];
    const first = await runRegisterCli(cliArgs);
    assert.equal(first.code, 0, first.stderr);

    const second = await runRegisterCli(cliArgs);
    assert.equal(second.code, 0, `second run failed: ${second.stderr}`);

    const lines = second.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    for (const row of lines) {
      assert.equal(row.joined, 'existing');
      assert.equal(row.approved, 'existing');
      assert.equal(row.plot, 'ok');
    }

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 3);
    for (const r of residents) {
      assert.equal(r.role, 'npc');
      assert.equal(r.status, 'active');
    }
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('--npc maren registers only maren', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
      '--npc',
      'maren',
    ]);
    assert.equal(res.code, 0, res.stderr);

    const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].handle, 'maren');
    assert.equal(lines[0].plot, 'ok');

    const residents = readResidents(ctx.dbPath);
    assert.deepEqual(
      residents.map((r) => r.handle),
      ['maren']
    );
    assert.equal(residents[0].role, 'npc');
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('reuses pre-existing keypair without modifying key.pem', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const existing = ensureKeypair({ handle: 'wick', stateDir, allowExisting: true });
    const statBefore = fs.statSync(existing.keyPath);
    const contentBefore = fs.readFileSync(existing.keyPath, 'utf8');

    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
      '--npc',
      'wick',
    ]);
    assert.equal(res.code, 0, res.stderr);

    const row = JSON.parse(res.stdout.trim());
    assert.equal(row.pubkey, existing.pubkey);

    const statAfter = fs.statSync(existing.keyPath);
    const contentAfter = fs.readFileSync(existing.keyPath, 'utf8');
    assert.equal(statAfter.mtimeMs, statBefore.mtimeMs);
    assert.equal(contentAfter, contentBefore);
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('dead API fails cleanly with JSON error and creates no state files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-dead-'));
  const operatorKeys = generateKeypair();
  const operatorKeyPath = path.join(tmpDir, 'operator.pem');
  fs.writeFileSync(operatorKeyPath, operatorKeys.privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  const stateDir = path.join(tmpDir, 'npc_state');

  try {
    const res = await runRegisterCli([
      '--api-base',
      'http://127.0.0.1:1',
      '--state-dir',
      stateDir,
      '--operator-key',
      operatorKeyPath,
    ]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errObj = JSON.parse(res.stderr.trim());
    assert.equal(errObj.ok, false);
    assert.ok(typeof errObj.error === 'string' && errObj.error.length > 0);
    assert.equal(fs.existsSync(stateDir), false, 'stateDir must not be created when API is dead');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('missing operator key file fails cleanly with usage error', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-nokey-'));
  const stateDir = path.join(tmpDir, 'npc_state');
  const missingKeyPath = path.join(tmpDir, 'does-not-exist.pem');

  try {
    const res = await runRegisterCli([
      '--api-base',
      'http://127.0.0.1:1',
      '--state-dir',
      stateDir,
      '--operator-key',
      missingKeyPath,
    ]);
    assert.equal(res.code, 1);
    assert.ok(res.stderr.includes('Usage:') || res.stderr.includes('not found'));
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('invalid --npc value fails cleanly without creating state dir', async () => {
  const ctx = await startTestServer();
  const stateDir = path.join(ctx.tmpDir, 'npc_state');
  try {
    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
      '--npc',
      'bogus',
    ]);
    assert.equal(res.code, 1);
    assert.ok(res.stderr.includes('Invalid --npc "bogus"'), `unexpected stderr: ${res.stderr}`);
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    await ctx.close();
  }
});

test('usage errors for --help, -h, and unknown argument', async () => {
  const helpRes = await runRegisterCli(['--help']);
  assert.equal(helpRes.code, 1);
  assert.ok(helpRes.stderr.includes('Usage:'), `unexpected stderr: ${helpRes.stderr}`);

  const shortRes = await runRegisterCli(['-h']);
  assert.equal(shortRes.code, 1);
  assert.ok(shortRes.stderr.includes('Usage:'), `unexpected stderr: ${shortRes.stderr}`);

  const bogusRes = await runRegisterCli(['--bogus']);
  assert.equal(bogusRes.code, 1);
  assert.ok(
    bogusRes.stderr.includes('Unknown or incomplete argument: --bogus'),
    `unexpected stderr: ${bogusRes.stderr}`
  );
});

test('missing required arguments fail cleanly without creating state dir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-missing-'));
  const operatorKeys = generateKeypair();
  const operatorKeyPath = path.join(tmpDir, 'operator.pem');
  fs.writeFileSync(operatorKeyPath, operatorKeys.privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  const stateDir = path.join(tmpDir, 'npc_state');

  try {
    const noBase = await runRegisterCli([
      '--state-dir',
      stateDir,
      '--operator-key',
      operatorKeyPath,
    ]);
    assert.equal(noBase.code, 1);
    assert.ok(noBase.stderr.includes('Missing --api-base'), `unexpected stderr: ${noBase.stderr}`);
    assert.equal(fs.existsSync(stateDir), false);

    const noKey = await runRegisterCli([
      '--api-base',
      'http://127.0.0.1:1',
      '--state-dir',
      stateDir,
    ]);
    assert.equal(noKey.code, 1);
    assert.ok(noKey.stderr.includes('Missing --operator-key'), `unexpected stderr: ${noKey.stderr}`);
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('operator key value validation rejects raw PEM and empty file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-keyval-'));
  const emptyKeyPath = path.join(tmpDir, 'empty.pem');
  fs.writeFileSync(emptyKeyPath, '', { encoding: 'utf8', mode: 0o600 });
  const stateDir = path.join(tmpDir, 'npc_state');

  try {
    const rawPemRes = await runRegisterCli([
      '--api-base',
      'http://127.0.0.1:1',
      '--state-dir',
      stateDir,
      '--operator-key',
      '-----BEGIN PRIVATE KEY-----\nfake',
    ]);
    assert.equal(rawPemRes.code, 1);
    assert.ok(
      rawPemRes.stderr.includes('must be a filesystem path, not a raw key value'),
      `unexpected stderr: ${rawPemRes.stderr}`
    );
    assert.equal(fs.existsSync(stateDir), false);

    const emptyRes = await runRegisterCli([
      '--api-base',
      'http://127.0.0.1:1',
      '--state-dir',
      stateDir,
      '--operator-key',
      emptyKeyPath,
    ]);
    assert.equal(emptyRes.code, 1);
    assert.ok(emptyRes.stderr.includes('is empty'), `unexpected stderr: ${emptyRes.stderr}`);
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('wrong operator key fails cleanly with JSON error and no residents', async () => {
  const ctx = await startTestServer();
  const wrongKeys = generateKeypair();
  const wrongKeyPath = path.join(ctx.tmpDir, 'wrong-operator.pem');
  fs.writeFileSync(wrongKeyPath, wrongKeys.privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  const stateDir = path.join(ctx.tmpDir, 'npc_state');

  try {
    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      wrongKeyPath,
    ]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errObj = JSON.parse(res.stderr.trim());
    assert.equal(errObj.ok, false);
    assert.ok(typeof errObj.error === 'string' && errObj.error.length > 0);
    assert.deepEqual(readResidents(ctx.dbPath), []);
  } finally {
    await ctx.close();
  }
});

test('already-joined-but-unapproved resident registers as existing and strips trailing slash', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const keys = ensureKeypair({ handle: 'wick', stateDir, allowExisting: true });
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'wick',
      privateKeyPem: keys.privateKeyPem,
      pubkey: keys.pubkey,
    });
    await client.join({ origin: 'colony', bio: getCharacter('wick').title });

    const res = await runRegisterCli([
      '--api-base',
      `${ctx.baseUrl}/`,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
      '--npc',
      'wick',
    ]);
    assert.equal(res.code, 0, `expected exit 0, got ${res.code}, stderr: ${res.stderr}`);
    assert.equal(res.stdout.includes('BEGIN'), false);
    assert.equal(res.stdout.includes('PRIVATE'), false);

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const row = JSON.parse(lines[0]);
    assert.equal(row.joined, 'existing');
    assert.equal(row.approved, 'existing');
    assert.equal(row.plot, 'ok');

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 1);
    assert.equal(residents[0].handle, 'wick');
    assert.equal(residents[0].origin, 'colony');
    assert.equal(residents[0].bio, 'Stagehand / Lamp-Trimmer');
    assert.equal(residents[0].role, 'npc');
    assert.equal(residents[0].status, 'active');

    assert.ok(fs.existsSync(path.join(ctx.plotsDir, 'wick', 'manifest.json')));
    assert.ok(fs.existsSync(path.join(ctx.plotsDir, 'wick', 'index.html')));
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('env fallbacks work, and flags override env', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const env = {
      TOWN_API_BASE: ctx.baseUrl,
      TOWN_OPERATOR_KEY: ctx.operatorKeyPath,
    };
    const res = await runRegisterCli(['--state-dir', stateDir, '--npc', 'wick'], os.tmpdir(), env);
    assert.equal(res.code, 0, res.stderr);

    const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].handle, 'wick');
    assert.equal(lines[0].joined, 'created');
    assert.equal(lines[0].approved, 'created');
    assert.equal(lines[0].plot, 'ok');

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 1);
    assert.equal(residents[0].role, 'npc');
    assert.equal(residents[0].status, 'active');

    const overrideRes = await runRegisterCli(
      [
        '--api-base',
        'http://127.0.0.1:1',
        '--state-dir',
        stateDir,
        '--operator-key',
        ctx.operatorKeyPath,
        '--npc',
        'maren',
      ],
      os.tmpdir(),
      env
    );
    assert.equal(overrideRes.code, 1);
    const errObj = JSON.parse(overrideRes.stderr.trim());
    assert.equal(errObj.ok, false);
    assert.equal(errObj.error, 'API unreachable: fetch failed');
    assert.equal(errObj.api_base, 'http://127.0.0.1:1');
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('probe HTTP failure fails cleanly with JSON error and creates no state dir', async () => {
  const ctx = await startTestServer();
  const stateDir = path.join(ctx.tmpDir, 'npc_state');
  try {
    const res = await runRegisterCli([
      '--api-base',
      `${ctx.baseUrl}/wrong`,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
    ]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');
    const errObj = JSON.parse(res.stderr.trim());
    assert.equal(errObj.ok, false);
    assert.equal(errObj.error, 'API probe failed with HTTP 404');
    assert.equal(errObj.status, 404);
    assert.equal(errObj.api_base, `${ctx.baseUrl}/wrong`);
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    await ctx.close();
  }
});

test('default --state-dir is ./npc_state under cwd', async () => {
  const ctx = await startTestServer();
  const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-cwd-'));
  try {
    const res = await runRegisterCli(
      ['--api-base', ctx.baseUrl, '--operator-key', ctx.operatorKeyPath, '--npc', 'maren'],
      cwdDir
    );
    assert.equal(res.code, 0, res.stderr);

    const keyPath = path.join(cwdDir, 'npc_state', 'maren', 'key.pem');
    const pubkeyPath = path.join(cwdDir, 'npc_state', 'maren', 'pubkey.txt');
    assert.ok(fs.existsSync(keyPath));
    assert.ok(fs.existsSync(pubkeyPath));
    assert.equal(fs.readFileSync(pubkeyPath, 'utf8').trim().length, 44);
    assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600);
  } finally {
    await ctx.close();
    fs.rmSync(cwdDir, { recursive: true, force: true });
  }
});

test('partial idempotency: wick first, then all three; output shape pinned', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const first = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
      '--npc',
      'wick',
    ]);
    assert.equal(first.code, 0, first.stderr);

    const second = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
    ]);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.stdout.includes('BEGIN'), false);
    assert.equal(second.stdout.includes('PRIVATE'), false);

    const lines = second.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.deepEqual(
      lines.map((l) => l.handle),
      ['wick', 'maren', 'tomas']
    );
    assert.equal(lines[0].joined, 'existing');
    assert.equal(lines[0].approved, 'existing');
    assert.equal(lines[1].joined, 'created');
    assert.equal(lines[1].approved, 'created');
    assert.equal(lines[2].joined, 'created');
    assert.equal(lines[2].approved, 'created');

    const expectedKeys = ['handle', 'joined', 'approved', 'plot', 'pubkey'].sort();
    for (const row of lines) {
      assert.equal(row.plot, 'ok');
      assert.deepEqual(Object.keys(row).sort(), expectedKeys);
    }

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 3);
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('flag with no value is a usage error', async () => {
  for (const flag of ['--npc', '--api-base', '--operator-key']) {
    const res = await runRegisterCli([flag]);
    assert.equal(res.code, 1);
    assert.ok(
      res.stderr.includes(`Unknown or incomplete argument: ${flag}`),
      `unexpected stderr for ${flag}: ${res.stderr}`
    );
  }
});

test('RSA operator key fails at approve: 401 invalid_signature, no residents', async () => {
  const ctx = await startTestServer();
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const rsaKeyPath = path.join(ctx.tmpDir, 'rsa-operator.pem');
  fs.writeFileSync(rsaKeyPath, rsaKeyPem, { encoding: 'utf8', mode: 0o600 });
  const stateDir = path.join(ctx.tmpDir, 'npc_state');

  try {
    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      rsaKeyPath,
      '--npc',
      'wick',
    ]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');
    const errObj = JSON.parse(res.stderr.trim());
    assert.deepEqual(errObj, { ok: false, error: 'invalid_signature', status: 401, handle: 'wick' });
    assert.deepEqual(readResidents(ctx.dbPath), []);
    assert.ok(fs.existsSync(path.join(stateDir, 'wick', 'key.pem')));
  } finally {
    await ctx.close();
  }
});

async function adminApprove(baseUrl, operatorKeyPem, handle, role) {
  const { signRequest } = await import('../town-api/ghostlight-client.mjs');
  const http = await import('node:http');
  const payload = role === undefined ? { handle } : { handle, role };
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: '/api/town/admin/approve',
    body: payload,
    handle: 'milo-op',
    privateKeyPem: operatorKeyPem,
  });
  const url = new URL('/api/town/admin/approve', baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(rawBody, 'utf8'),
        },
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          chunks += chunk;
        });
        res.on('end', () => {
          let data = null;
          try {
            data = JSON.parse(chunks);
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

test('mismatched local keypair fails at plot PUT with 401 invalid_signature and keeps the registered key', async () => {
  const ctx = await startTestServer();
  const stateDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-a-'));
  const stateDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-b-'));
  try {
    const keysA = ensureKeypair({ handle: 'wick', stateDir: stateDirA, allowExisting: true });
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'wick',
      privateKeyPem: keysA.privateKeyPem,
      pubkey: keysA.pubkey,
    });
    const joinRes = await client.join({ origin: 'colony', bio: getCharacter('wick').title });
    assert.equal(joinRes.status, 201);

    const operatorKeyPem = fs.readFileSync(ctx.operatorKeyPath, 'utf8');
    const approveRes = await adminApprove(ctx.baseUrl, operatorKeyPem, 'wick', 'npc');
    assert.equal(approveRes.status, 200);

    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDirB,
      '--operator-key',
      ctx.operatorKeyPath,
      '--npc',
      'wick',
    ]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');
    const errObj = JSON.parse(res.stderr.trim());
    assert.deepEqual(errObj, { ok: false, error: 'invalid_signature', status: 401, handle: 'wick' });

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 1);
    assert.equal(residents[0].handle, 'wick');
    assert.equal(residents[0].pubkey, keysA.pubkey);
    assert.equal(residents[0].role, 'npc');
    assert.equal(fs.existsSync(path.join(ctx.plotsDir, 'wick', 'manifest.json')), false);

    const pubkeyB = fs.readFileSync(path.join(stateDirB, 'wick', 'pubkey.txt'), 'utf8').trim();
    assert.notEqual(pubkeyB, keysA.pubkey);
  } finally {
    await ctx.close();
    fs.rmSync(stateDirA, { recursive: true, force: true });
    fs.rmSync(stateDirB, { recursive: true, force: true });
  }
});

test('full run pins origin colony and character-title bios for all three NPCs', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
    ]);
    assert.equal(res.code, 0, res.stderr);

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 3);
    for (const r of residents) {
      assert.equal(r.origin, 'colony');
      assert.equal(r.bio, getCharacter(r.handle).title);
    }
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('register upgrades a pre-approved muse-role resident to npc', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const keys = ensureKeypair({ handle: 'wick', stateDir, allowExisting: true });
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'wick',
      privateKeyPem: keys.privateKeyPem,
      pubkey: keys.pubkey,
    });
    const joinRes = await client.join({ origin: 'colony', bio: getCharacter('wick').title });
    assert.equal(joinRes.status, 201);

    const operatorKeyPem = fs.readFileSync(ctx.operatorKeyPath, 'utf8');
    const approveRes = await adminApprove(ctx.baseUrl, operatorKeyPem, 'wick', 'muse');
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.role, 'muse');

    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
      '--npc',
      'wick',
    ]);
    assert.equal(res.code, 0, res.stderr);

    const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].handle, 'wick');
    assert.equal(lines[0].joined, 'existing');
    assert.equal(lines[0].approved, 'existing');
    assert.equal(lines[0].plot, 'ok');

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 1);
    assert.equal(residents[0].role, 'npc');
    assert.equal(residents[0].status, 'active');
    assert.ok(fs.existsSync(path.join(ctx.plotsDir, 'wick', 'manifest.json')));
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('duplicate --npc flag: last one wins', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
      '--npc',
      'wick',
      '--npc',
      'maren',
    ]);
    assert.equal(res.code, 0, res.stderr);

    const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].handle, 'maren');
    assert.equal(lines[0].joined, 'created');

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 1);
    assert.equal(residents[0].handle, 'maren');
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('full run with trailing-slash --api-base registers all three', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const res = await runRegisterCli([
      '--api-base',
      `${ctx.baseUrl}/`,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
    ]);
    assert.equal(res.code, 0, res.stderr);

    const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.deepEqual(
      lines.map((l) => l.handle),
      ['wick', 'maren', 'tomas']
    );
    for (const row of lines) {
      assert.equal(row.joined, 'created');
      assert.equal(row.approved, 'created');
      assert.equal(row.plot, 'ok');
    }

    const residents = readResidents(ctx.dbPath);
    assert.equal(residents.length, 3);
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('state after full run carries the plots map and plot GETs match the repo for maren and tomas', async () => {
  const ctx = await startTestServer();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-register-state-'));
  try {
    const res = await runRegisterCli([
      '--api-base',
      ctx.baseUrl,
      '--state-dir',
      stateDir,
      '--operator-key',
      ctx.operatorKeyPath,
    ]);
    assert.equal(res.code, 0, res.stderr);

    const stateRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();
    assert.deepEqual(Object.keys(state.plots).sort(), ['maren', 'tomas', 'wick']);

    const residents = readResidents(ctx.dbPath);
    for (const r of residents) {
      assert.equal(state.plots[r.handle], r.plot_updated_at);
    }
    assert.equal(typeof state.state_seq, 'number');
    assert.ok(state.state_seq > 0);
    assert.deepEqual(state.footlights, []);
    assert.deepEqual(state.presence, []);

    for (const handle of ['maren', 'tomas']) {
      const plotRes = await fetch(`${ctx.baseUrl}/api/town/plot?handle=${handle}`);
      assert.equal(plotRes.status, 200);
      const plotData = await plotRes.json();
      const expectedManifest = JSON.parse(
        fs.readFileSync(path.join(REPO_PLOTS_DIR, handle, 'manifest.json'), 'utf8')
      );
      assert.deepEqual(plotData.manifest, expectedManifest);
    }
  } finally {
    await ctx.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
