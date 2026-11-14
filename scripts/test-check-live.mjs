#!/usr/bin/env node
/**
 * Tests for scripts/check-live.mjs (Slice 34)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getExpectedFiles } from './check-live.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECK_SCRIPT = path.join(__dirname, 'check-live.mjs');
const STAGE_SCRIPT = path.join(__dirname, 'stage-deploy.mjs');
const REPO_ROOT = path.resolve(__dirname, '..');

function runScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function runCheck(args) {
  return runScript(CHECK_SCRIPT, args);
}

async function createFixtureTree(rootDir) {
  await fs.mkdir(path.join(rootDir, 'models'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'gazette'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'inn'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'guestbook'), { recursive: true });
  await fs.mkdir(path.join(rootDir, 'plots', 'milo'), { recursive: true });

  const files = {
    'index.html': '<!doctype html><script type="module">import "./town.js?v=13";</script>\n',
    'move-in.html': '<!doctype html><h1>Move in</h1>\n',
    'inn/index.html': '<!doctype html><h1>Ghostlight Inn</h1>\n',
    'guestbook/index.html': '<!doctype html><h1>Town Gate Guestbook</h1>\n',
    'town.js': [
      'export const PROP_PLACEMENTS = [];',
      'export function buildConceptBandstand() {}',
      'export const SEED_WANDER_CONFIG = {};',
      '// newsstand_papers_shelf',
    ].join('\n') + '\n',
    'CREDITS.md': '# Credits\nBandstand lantern assets.\n',
    'models/bench.glb': Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]),
    'gazette/latest.json': JSON.stringify({
      latest: 1,
      issues: [{ n: 1, file: 'issue-001.html', date: '2026-11-12', headline: 'Issue 1' }],
    }),
    'gazette/issue-001.html': '<h1>Ghostlight Gazette</h1>\n',
    'plots/milo/index.html': '<p>Milo desk note</p>\n',
  };

  for (const [relPath, content] of Object.entries(files)) {
    await fs.writeFile(path.join(rootDir, relPath), content);
  }
  // Local-only excluded / dev-only files — should not be requested from live server.
  await fs.writeFile(
    path.join(rootDir, 'models/pine.glb'),
    Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]),
  );
  await fs.writeFile(path.join(rootDir, 'test-dev.mjs'), '// dev-only test script\n');

  return files;
}

async function hashTree(dir, prefix = '', out = {}) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await hashTree(fullPath, relPath, out);
    } else if (entry.isFile()) {
      const data = await fs.readFile(fullPath);
      out[relPath] = crypto.createHash('sha256').update(data).digest('hex');
    }
  }
  return out;
}

async function startFixtureServer(servedFiles, { apiStatus = 200, apiClose = false } = {}) {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/api/town/state') {
      if (apiClose) {
        req.socket.destroy();
        return;
      }
      res.writeHead(apiStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: apiStatus === 200 }));
      return;
    }

    const prefix = '/ghostlight-town/';
    if (urlPath.startsWith(prefix)) {
      const relPath = urlPath.slice(prefix.length);
      if (Object.prototype.hasOwnProperty.call(servedFiles, relPath)) {
        res.writeHead(200);
        res.end(servedFiles[relPath]);
        return;
      }
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('all-ok fixture passes, excludes pine.glb, reports checked count and live api, and does not modify root', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-ok-'));
  let server;
  try {
    const expectedFiles = await createFixtureTree(tmpDir);
    const beforeHashes = await hashTree(tmpDir);
    server = await startFixtureServer(expectedFiles, { apiStatus: 200 });

    const res = await runCheck(['--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const summary = JSON.parse(lines[0]);
    assert.equal(summary.status, 'ok');
    assert.equal(summary.base, server.baseUrl);
    assert.equal(summary.town_js_v, 13);
    assert.equal(summary.checked, Object.keys(expectedFiles).length);
    assert.equal(summary.ok, Object.keys(expectedFiles).length);
    assert.deepEqual(summary.failures, []);
    assert.equal(summary.api, 'live');

    const afterHashes = await hashTree(tmpDir);
    assert.deepEqual(afterHashes, beforeHashes);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('town.js?v= disagreement between repo and live fails with town_js_v', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-v-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    served['index.html'] = '<!doctype html><script type="module">import "./town.js?v=12";</script>\n';
    server = await startFixtureServer(served);

    const res = await runCheck(['--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    assert.equal(summary.town_js_v, 13);
    const vFail = summary.failures.find((f) => f.file === 'index.html' && f.problem === 'town_js_v');
    assert.ok(vFail, `Expected town_js_v failure, got: ${JSON.stringify(summary.failures)}`);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('corrupt served .glb fails with mismatch', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-glb-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    served['models/bench.glb'] = Buffer.from('NOT_A_GLTF_FILE');
    server = await startFixtureServer(served);

    const res = await runCheck(['--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    const glbFail = summary.failures.find((f) => f.file === 'models/bench.glb' && f.problem === 'mismatch');
    assert.ok(glbFail, `Expected glb mismatch failure, got: ${JSON.stringify(summary.failures)}`);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('missing served file (404) fails with missing', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-404-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    delete served['plots/milo/index.html'];
    server = await startFixtureServer(served);

    const res = await runCheck(['--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    const missFail = summary.failures.find((f) => f.file === 'plots/milo/index.html' && f.problem === 'missing');
    assert.ok(missFail, `Expected missing failure, got: ${JSON.stringify(summary.failures)}`);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('town.js missing marker fails and names the absent marker', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-marker-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    served['town.js'] = [
      'export const PROP_PLACEMENTS = [];',
      'export function buildConceptBandstand() {}',
      'export const SEED_WANDER_CONFIG = {};',
    ].join('\n');
    server = await startFixtureServer(served);

    const res = await runCheck(['--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    const markerFail = summary.failures.find((f) => f.file === 'town.js' && f.problem === 'markers');
    assert.ok(markerFail, `Expected markers failure, got: ${JSON.stringify(summary.failures)}`);
    assert.match(markerFail.detail, /newsstand_papers_shelf/);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('API down reports not-live and exits 0 by default, or exits 1 with --require-api', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-api-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startFixtureServer(served, { apiStatus: 404 });

    const resDefault = await runCheck(['--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(resDefault.status, 0, `Expected exit 0, got ${resDefault.status}`);
    const summaryDefault = JSON.parse(resDefault.stdout.trim());
    assert.equal(summaryDefault.status, 'ok');
    assert.equal(summaryDefault.api, 'not-live');

    const resRequired = await runCheck(['--base', server.baseUrl, '--root', tmpDir, '--require-api']);
    assert.equal(resRequired.status, 1);
    const summaryRequired = JSON.parse(resRequired.stdout.trim());
    assert.equal(summaryRequired.status, 'fail');
    assert.equal(summaryRequired.api, 'not-live');
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('missing --root directory prints JSON error on stderr and exits 1', async () => {
  const missingDir = path.join(os.tmpdir(), `check-live-missing-${Date.now()}-${Math.random()}`);
  const res = await runCheck(['--root', missingDir]);
  assert.equal(res.status, 1);
  assert.equal(res.stdout, '');
  const errObj = JSON.parse(res.stderr.trim());
  assert.equal(typeof errObj.error, 'string');
});

test('drift guard: check-live expected files match stage-deploy MANIFEST.json on real tree', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-drift-'));
  try {
    const stageRes = await runScript(STAGE_SCRIPT, ['--out', tmpDir, '--root', REPO_ROOT]);
    assert.equal(stageRes.status, 0, `stage-deploy failed: ${stageRes.stderr}`);

    const manifestRaw = await fs.readFile(path.join(tmpDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    const stagedFiles = manifest.files.map((f) => f.path).sort();

    const expectedFiles = (await getExpectedFiles(path.join(REPO_ROOT, 'town-3d'))).sort();

    const stagedSet = new Set(stagedFiles);
    const expectedSet = new Set(expectedFiles);
    const missing = stagedFiles.filter((f) => !expectedSet.has(f));
    const extra = expectedFiles.filter((f) => !stagedSet.has(f));

    assert.deepEqual(missing, [], `check-live missing staged files: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `check-live has extra non-staged files: ${extra.join(', ')}`);
    assert.deepEqual(expectedFiles, stagedFiles);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
