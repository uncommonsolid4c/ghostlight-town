#!/usr/bin/env node
/**
 * Tests for scripts/check-live.mjs (Slice 34, Slice 100)
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

async function createFixtureTree(repoRoot) {
  const town3dDir = path.join(repoRoot, 'town-3d');
  await fs.mkdir(path.join(town3dDir, 'models'), { recursive: true });
  await fs.mkdir(path.join(town3dDir, 'gazette'), { recursive: true });
  await fs.mkdir(path.join(town3dDir, 'inn'), { recursive: true });
  await fs.mkdir(path.join(town3dDir, 'guestbook'), { recursive: true });
  await fs.mkdir(path.join(town3dDir, 'plots', 'milo'), { recursive: true });

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
    await fs.writeFile(path.join(town3dDir, relPath), content);
  }
  // Local-only excluded / dev-only files — should not be requested from live server.
  await fs.writeFile(
    path.join(town3dDir, 'models/pine.glb'),
    Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]),
  );
  await fs.writeFile(path.join(town3dDir, 'test-dev.mjs'), '// dev-only test script\n');

  return files;
}

async function createStagingFixtureTree(repoRoot) {
  const stagingDir = path.join(repoRoot, 'staging-polyfork');
  const town3dDir = path.join(repoRoot, 'town-3d');
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.mkdir(path.join(town3dDir, 'gazette'), { recursive: true });
  await fs.mkdir(path.join(town3dDir, 'inn'), { recursive: true });
  await fs.mkdir(path.join(town3dDir, 'guestbook'), { recursive: true });
  for (const resident of ['milo', 'wick', 'maren', 'tomas']) {
    await fs.mkdir(path.join(town3dDir, 'plots', resident), { recursive: true });
  }

  const stagingFiles = {
    'index.html': '<!doctype html><script type="module" src="./staging.js?v=38"></script>\n',
    'staging.js': [
      "import { buildConceptBandstand } from './concept-bandstand.js?v=37';",
      'function applyStagingState(liveStore) {}',
      'const liveStore = {};',
    ].join('\n') + '\n',
    'concept-bandstand.js': 'export function buildConceptBandstand() {}\n',
  };

  const sharedTown3dFiles = {
    'gazette/feed.xml': '<rss version="2.0"></rss>\n',
    'gazette/issue-001.html': '<h1>Ghostlight Gazette #1</h1>\n',
    'gazette/issue-002.html': '<h1>Ghostlight Gazette #2</h1>\n',
    'gazette/issue-003.html': '<h1>Ghostlight Gazette #3</h1>\n',
    'gazette/latest.json': JSON.stringify({
      latest: 3,
      issues: [{ n: 2, file: 'issue-002.html', date: '2026-11-14', headline: 'Issue 2' }],
    }),
    'plots/milo/index.html': '<p>Milo desk note</p>\n',
    'plots/wick/index.html': '<p>Wick desk note</p>\n',
    'plots/maren/index.html': '<p>Maren desk note</p>\n',
    'plots/tomas/index.html': '<p>Tomas desk note</p>\n',
    'inn/index.html': '<!doctype html><h1>Ghostlight Inn</h1>\n',
    'guestbook/index.html': '<!doctype html><h1>Town Gate Guestbook</h1>\n',
    'move-in.html': '<!doctype html><h1>Move in</h1>\n',
  };

  for (const [relPath, content] of Object.entries(stagingFiles)) {
    await fs.writeFile(path.join(stagingDir, relPath), content);
  }
  for (const [relPath, content] of Object.entries(sharedTown3dFiles)) {
    await fs.writeFile(path.join(town3dDir, relPath), content);
  }
  // Local-only excluded files in staging-polyfork/ — should not be requested from live server.
  await fs.writeFile(path.join(stagingDir, 'test-staging.mjs'), '// dev-only staging test\n');
  await fs.writeFile(path.join(stagingDir, 'README.md'), '# Staging README\n');

  return { ...stagingFiles, ...sharedTown3dFiles };
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

async function startFixtureServer(servedFiles, { apiStatus = 200, apiClose = false, fileStatus = {} } = {}) {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
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
      if (Object.prototype.hasOwnProperty.call(fileStatus, relPath)) {
        res.writeHead(fileStatus[relPath]);
        res.end(servedFiles[relPath] ?? '');
        return;
      }
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
    getRequestCount: () => requestCount,
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

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const summary = JSON.parse(lines[0]);
    assert.equal(summary.status, 'ok');
    assert.equal(summary.bundle, 'town-3d');
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

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    assert.equal(summary.bundle, 'town-3d');
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

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
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

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
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

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
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

    const resDefault = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(resDefault.status, 0, `Expected exit 0, got ${resDefault.status}`);
    const summaryDefault = JSON.parse(resDefault.stdout.trim());
    assert.equal(summaryDefault.status, 'ok');
    assert.equal(summaryDefault.api, 'not-live');

    const resRequired = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir, '--require-api']);
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

test('drift guard: town-3d expected files match stage-deploy MANIFEST.json on real tree', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-drift-'));
  try {
    const stageRes = await runScript(STAGE_SCRIPT, ['--bundle', 'town-3d', '--out', tmpDir, '--root', REPO_ROOT]);
    assert.equal(stageRes.status, 0, `stage-deploy failed: ${stageRes.stderr}`);

    const manifestRaw = await fs.readFile(path.join(tmpDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    const stagedFiles = manifest.files.map((f) => f.path).sort();

    const expectedFiles = (await getExpectedFiles(REPO_ROOT, 'town-3d')).sort();

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

test('staging-polyfork default bundle happy path excludes test-*.mjs/README.md and reports staging_js_v', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-staging-ok-'));
  let server;
  try {
    const expectedFiles = await createStagingFixtureTree(tmpDir);
    const beforeHashes = await hashTree(tmpDir);
    server = await startFixtureServer(expectedFiles, { apiStatus: 200 });

    const res = await runCheck(['--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'ok');
    assert.equal(summary.bundle, 'staging-polyfork');
    assert.equal(summary.base, server.baseUrl);
    assert.equal(summary.staging_js_v, 38);
    assert.equal(summary.town_js_v, undefined);
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

test('staging.js?v= disagreement between repo and live fails with staging_js_v', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-staging-v-'));
  let server;
  try {
    const served = await createStagingFixtureTree(tmpDir);
    served['index.html'] = '<!doctype html><script type="module" src="./staging.js?v=23"></script>\n';
    server = await startFixtureServer(served);

    const res = await runCheck(['--bundle', 'staging-polyfork', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    assert.equal(summary.bundle, 'staging-polyfork');
    assert.equal(summary.staging_js_v, 38);
    const vFail = summary.failures.find((f) => f.file === 'index.html' && f.problem === 'staging_js_v');
    assert.ok(vFail, `Expected staging_js_v failure, got: ${JSON.stringify(summary.failures)}`);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('staging.js missing marker fails and names the absent marker', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-staging-marker-'));
  let server;
  try {
    const served = await createStagingFixtureTree(tmpDir);
    served['staging.js'] = [
      "import { buildConceptBandstand } from './concept-bandstand.js?v=37';",
      'const liveStore = {};',
    ].join('\n');
    server = await startFixtureServer(served);

    const res = await runCheck(['--bundle', 'staging-polyfork', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    const markerFail = summary.failures.find((f) => f.file === 'staging.js' && f.problem === 'markers');
    assert.ok(markerFail, `Expected markers failure, got: ${JSON.stringify(summary.failures)}`);
    assert.match(markerFail.detail, /applyStagingState/);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('unknown --bundle prints JSON error on stderr, exits 1, and makes no network calls', async () => {
  let server;
  try {
    server = await startFixtureServer({});
    const res = await runCheck(['--bundle', 'bogus-bundle', '--base', server.baseUrl, '--root', REPO_ROOT]);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, '');
    const errObj = JSON.parse(res.stderr.trim());
    assert.equal(typeof errObj.error, 'string');
    assert.match(errObj.error, /Unknown bundle/);
    assert.equal(server.getRequestCount(), 0);
  } finally {
    if (server) await server.close();
  }
});

test('drift guard: staging-polyfork expected files match stage-deploy MANIFEST.json on real tree', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-drift-staging-'));
  try {
    const stageRes = await runScript(STAGE_SCRIPT, ['--bundle', 'staging-polyfork', '--out', tmpDir, '--root', REPO_ROOT]);
    assert.equal(stageRes.status, 0, `stage-deploy failed: ${stageRes.stderr}`);

    const manifestRaw = await fs.readFile(path.join(tmpDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8');
    const manifest = JSON.parse(manifestRaw);
    const stagedFiles = manifest.files.map((f) => f.path).sort();

    const expectedFiles = (await getExpectedFiles(REPO_ROOT, 'staging-polyfork')).sort();

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

test('--api-base is honored (separate API host)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-apibase-'));
  let base404Server;
  let base200Server;
  let api200Server;
  let api404Server;
  try {
    const served = await createFixtureTree(tmpDir);
    base404Server = await startFixtureServer(served, { apiStatus: 404 });
    base200Server = await startFixtureServer(served, { apiStatus: 200 });
    api200Server = await startFixtureServer({}, { apiStatus: 200 });
    api404Server = await startFixtureServer({}, { apiStatus: 404 });

    // (a) base API 404, --api-base returns 200 -> live
    const resA = await runCheck([
      '--bundle', 'town-3d',
      '--base', base404Server.baseUrl,
      '--api-base', api200Server.baseUrl,
      '--root', tmpDir,
    ]);
    assert.equal(resA.status, 0, `Expected exit 0, got ${resA.status}: ${resA.stderr}`);
    const summaryA = JSON.parse(resA.stdout.trim());
    assert.equal(summaryA.status, 'ok');
    assert.equal(summaryA.api, 'live');

    // (b) base API 404, --api-base returns 404 -> not-live
    const resB = await runCheck([
      '--bundle', 'town-3d',
      '--base', base404Server.baseUrl,
      '--api-base', api404Server.baseUrl,
      '--root', tmpDir,
    ]);
    assert.equal(resB.status, 0, `Expected exit 0, got ${resB.status}: ${resB.stderr}`);
    const summaryB = JSON.parse(resB.stdout.trim());
    assert.equal(summaryB.api, 'not-live');

    // (c) base API 200, --api-base returns 404 -> --api-base wins -> not-live
    const resC = await runCheck([
      '--bundle', 'town-3d',
      '--base', base200Server.baseUrl,
      '--api-base', api404Server.baseUrl,
      '--root', tmpDir,
    ]);
    assert.equal(resC.status, 0, `Expected exit 0, got ${resC.status}: ${resC.stderr}`);
    const summaryC = JSON.parse(resC.stdout.trim());
    assert.equal(summaryC.api, 'not-live');
  } finally {
    if (base404Server) await base404Server.close();
    if (base200Server) await base200Server.close();
    if (api200Server) await api200Server.close();
    if (api404Server) await api404Server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('gazette/latest.json that cannot resolve an issue fails with mismatch', async () => {
  const cases = [
    { name: 'invalid JSON', content: '{not json', detailRe: /invalid JSON/ },
    { name: 'empty issues', content: '{"latest":1,"issues":[]}', detailRe: /missing issue-\*\.html filename/ },
    {
      name: 'non-issue filename',
      content: '{"latest":1,"issues":[{"n":1,"file":"notes.txt"}]}',
      detailRe: /missing issue-\*\.html filename/,
    },
    { name: 'missing issues key', content: '{"latest":1}', detailRe: /missing issue-\*\.html filename/ },
  ];

  for (const c of cases) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-latest-bad-'));
    let server;
    try {
      const served = await createFixtureTree(tmpDir);
      served['gazette/latest.json'] = c.content;
      server = await startFixtureServer(served);

      const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
      assert.equal(res.status, 1, `${c.name}: expected exit 1, got ${res.status}`);
      const summary = JSON.parse(res.stdout.trim());
      assert.equal(summary.status, 'fail', c.name);
      const fail = summary.failures.find(
        (f) => f.file === 'gazette/latest.json' && f.problem === 'mismatch',
      );
      assert.ok(fail, `${c.name}: expected mismatch failure, got ${JSON.stringify(summary.failures)}`);
      assert.match(fail.detail, c.detailRe, c.name);
    } finally {
      if (server) await server.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
});

test('latest pointing at an absent issue number falls back to issues[0]', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-latest-fallback-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    served['gazette/latest.json'] = JSON.stringify({
      latest: 9,
      issues: [{ n: 1, file: 'issue-001.html' }],
    });
    server = await startFixtureServer(served);

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'ok');
    assert.deepEqual(summary.failures, []);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('latest.json pointing at an issue not in expected files is fetched live', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-latest-extra-'));
  let serverMissing;
  let serverPresent;
  try {
    const served = await createFixtureTree(tmpDir);
    const expectedCount = Object.keys(served).length;
    served['gazette/latest.json'] = JSON.stringify({
      latest: 4,
      issues: [{ n: 4, file: 'issue-004.html', date: '2026-11-21', headline: 'Issue 4' }],
    });

    // (a) gazette/issue-004.html missing on server (404)
    serverMissing = await startFixtureServer(served);
    const resMissing = await runCheck(['--bundle', 'town-3d', '--base', serverMissing.baseUrl, '--root', tmpDir]);
    assert.equal(resMissing.status, 1, `Expected exit 1, got ${resMissing.status}`);
    const summaryMissing = JSON.parse(resMissing.stdout.trim());
    assert.equal(summaryMissing.status, 'fail');
    assert.equal(summaryMissing.checked, expectedCount);
    const missFail = summaryMissing.failures.find(
      (f) => f.file === 'gazette/issue-004.html' && f.problem === 'missing',
    );
    assert.ok(missFail, `Expected missing failure, got ${JSON.stringify(summaryMissing.failures)}`);

    // (b) gazette/issue-004.html served with 200
    served['gazette/issue-004.html'] = '<h1>Ghostlight Gazette #4</h1>\n';
    serverPresent = await startFixtureServer(served);
    const resPresent = await runCheck(['--bundle', 'town-3d', '--base', serverPresent.baseUrl, '--root', tmpDir]);
    assert.equal(resPresent.status, 0, `Expected exit 0, got ${resPresent.status}: ${resPresent.stderr}`);
    const summaryPresent = JSON.parse(resPresent.stdout.trim());
    assert.equal(summaryPresent.status, 'ok');
    assert.deepEqual(summaryPresent.failures, []);
  } finally {
    if (serverMissing) await serverMissing.close();
    if (serverPresent) await serverPresent.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('non-200 non-404 file status fails with bad-status', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-500-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startFixtureServer(served, { fileStatus: { 'CREDITS.md': 500 } });

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1, `Expected exit 1, got ${res.status}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    const badFail = summary.failures.find(
      (f) => f.file === 'CREDITS.md' && f.problem === 'bad-status',
    );
    assert.ok(badFail, `Expected bad-status failure, got ${JSON.stringify(summary.failures)}`);
    assert.equal(badFail.detail, 'HTTP 500');
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('argument errors print JSON on stderr, exit 1, and unknown arg makes no network calls', async () => {
  let server;
  try {
    server = await startFixtureServer({});

    // (a) --bogus x
    const resBogus = await runCheck([
      '--bundle', 'town-3d',
      '--base', server.baseUrl,
      '--root', REPO_ROOT,
      '--bogus', 'x',
    ]);
    assert.equal(resBogus.status, 1);
    assert.equal(resBogus.stdout, '');
    const errBogus = JSON.parse(resBogus.stderr.trim());
    assert.equal(typeof errBogus.error, 'string');
    assert.match(errBogus.error, /Unknown argument: --bogus/);
    assert.equal(server.getRequestCount(), 0);

    // (b) --base with no following value
    const resBase = await runCheck(['--base', '--root', '/tmp']);
    assert.equal(resBase.status, 1);
    assert.equal(resBase.stdout, '');
    const errBase = JSON.parse(resBase.stderr.trim());
    assert.equal(typeof errBase.error, 'string');
    assert.match(errBase.error, /--base requires a URL argument/);

    // (c) --api-base with no following value
    const resApiBase = await runCheck(['--api-base']);
    assert.equal(resApiBase.status, 1);
    assert.equal(resApiBase.stdout, '');
    const errApiBase = JSON.parse(resApiBase.stderr.trim());
    assert.equal(typeof errApiBase.error, 'string');
    assert.match(errApiBase.error, /--api-base requires a URL argument/);
  } finally {
    if (server) await server.close();
  }
});

test('trailing-slash --base and --api-base are normalized', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-slash-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startFixtureServer(served, { apiStatus: 200 });

    const trailingBase = `${server.baseUrl}/`;
    const res = await runCheck([
      '--bundle', 'town-3d',
      '--base', trailingBase,
      '--api-base', trailingBase,
      '--root', tmpDir,
    ]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    assert.equal(res.stderr, '');
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'ok');
    assert.equal(summary.base, server.baseUrl);
    assert.equal(summary.api, 'live');
    assert.equal(summary.checked, 10);
    assert.equal(summary.ok, 10);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('API socket destroyed reports not-live and exits 0 by default, or exits 1 with --require-api', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-apiclose-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startFixtureServer(served, { apiClose: true });

    const resDefault = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(resDefault.status, 0, `Expected exit 0, got ${resDefault.status}: ${resDefault.stderr}`);
    const summaryDefault = JSON.parse(resDefault.stdout.trim());
    assert.equal(summaryDefault.status, 'ok');
    assert.equal(summaryDefault.api, 'not-live');

    const resRequired = await runCheck([
      '--bundle', 'town-3d',
      '--base', server.baseUrl,
      '--root', tmpDir,
      '--require-api',
    ]);
    assert.equal(resRequired.status, 1, `Expected exit 1, got ${resRequired.status}`);
    const summaryRequired = JSON.parse(resRequired.stdout.trim());
    assert.equal(summaryRequired.status, 'fail');
    assert.equal(summaryRequired.api, 'not-live');
    const apiFail = summaryRequired.failures.find(
      (f) => f.file === '/api/town/state' && f.problem === 'bad-status',
    );
    assert.ok(apiFail, `Expected /api/town/state bad-status failure, got: ${JSON.stringify(summaryRequired.failures)}`);
    assert.equal(typeof apiFail.detail, 'string');
    assert.ok(apiFail.detail.length > 0, 'Expected non-empty detail on API socket failure');
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--root pointing at a file prints JSON error on stderr and exits 1', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-rootfile-'));
  try {
    const filePath = path.join(tmpDir, `not-a-dir-${Date.now()}.txt`);
    await fs.writeFile(filePath, 'not a directory\n');

    const res = await runCheck(['--root', filePath]);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, '');
    const errObj = JSON.parse(res.stderr.trim());
    assert.equal(typeof errObj.error, 'string');
    assert.match(errObj.error, /not a directory/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('live index.html with no ?v= fails with town_js_v', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-nov-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    served['index.html'] = '<!doctype html><script type="module">import "./town.js";</script>\n';
    server = await startFixtureServer(served);

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1, `Expected exit 1, got ${res.status}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    assert.equal(summary.town_js_v, 13);
    const vFail = summary.failures.find((f) => f.file === 'index.html' && f.problem === 'town_js_v');
    assert.ok(vFail, `Expected town_js_v failure, got: ${JSON.stringify(summary.failures)}`);
    assert.equal(vFail.detail, 'repo_v=13 vs live_v=null');
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('short .glb under 4 bytes fails with mismatch', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-shortglb-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    served['models/bench.glb'] = Buffer.from([0x67, 0x6c]);
    server = await startFixtureServer(served);

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1, `Expected exit 1, got ${res.status}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    const glbFail = summary.failures.find((f) => f.file === 'models/bench.glb' && f.problem === 'mismatch');
    assert.ok(glbFail, `Expected glb mismatch failure, got: ${JSON.stringify(summary.failures)}`);
    assert.match(glbFail.detail, /expected glTF magic/);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('multiple simultaneous failures accumulate with exact ok count', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-multi-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    served['index.html'] = '<!doctype html><script type="module">import "./town.js?v=12";</script>\n';
    served['models/bench.glb'] = Buffer.from('NOT_A_GLTF_FILE');
    delete served['plots/milo/index.html'];
    server = await startFixtureServer(served);

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1, `Expected exit 1, got ${res.status}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'fail');
    assert.equal(summary.checked, 10);
    assert.equal(summary.ok, 7);
    assert.equal(summary.failures.length, 3);
    const pairs = summary.failures.map((f) => `${f.file}:${f.problem}`).sort();
    assert.deepEqual(pairs, [
      'index.html:town_js_v',
      'models/bench.glb:mismatch',
      'plots/milo/index.html:missing',
    ]);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

async function startPathRecordingFixtureServer(servedFiles, { apiStatus = 200 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    requests.push(urlPath);
    if (urlPath === '/api/town/state') {
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
    getRequests: () => requests.slice(),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startFileCloseFixtureServer(servedFiles, closeRelPath) {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/api/town/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const prefix = '/ghostlight-town/';
    if (urlPath.startsWith(prefix)) {
      const relPath = urlPath.slice(prefix.length);
      if (relPath === closeRelPath) {
        req.socket.destroy();
        return;
      }
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

test('getExpectedFiles exported contract validates bundles and excludes dev-only files', async () => {
  await assert.rejects(() => getExpectedFiles(REPO_ROOT, 'bogus'), /Unknown bundle: bogus/);

  const town3d = await getExpectedFiles(REPO_ROOT, 'town-3d');
  assert.ok(town3d.includes('index.html'));
  assert.ok(town3d.includes('town.js'));
  assert.ok(!town3d.includes('models/pine.glb'));
  assert.ok(town3d.every((p) => !p.startsWith('test-')));

  const staging = await getExpectedFiles(REPO_ROOT, 'staging-polyfork');
  assert.ok(staging.includes('staging.js'));
  assert.ok(staging.includes('gazette/latest.json'));
  assert.ok(!staging.includes('test-staging.mjs'));
  assert.ok(!staging.includes('README.md'));
});

test('missing-value errors for --bundle and --root print JSON error on stderr and exit 1', async () => {
  const cases = [
    { args: ['--bundle'], expectedError: '--bundle requires a bundle name argument' },
    { args: ['--root'], expectedError: '--root requires a directory argument' },
    { args: ['--bundle', '--root', '/tmp'], expectedError: '--bundle requires a bundle name argument' },
  ];

  for (const { args, expectedError } of cases) {
    const res = await runCheck(args);
    assert.equal(res.status, 1, `Expected exit 1 for ${args.join(' ')}, got ${res.status}`);
    assert.equal(res.stdout, '');
    const errObj = JSON.parse(res.stderr.trim());
    assert.equal(errObj.error, expectedError);
  }
});

test('duplicate --base flag uses last value', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-dupbase-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startFixtureServer(served);

    const res = await runCheck([
      '--bundle', 'town-3d',
      '--base', 'http://127.0.0.1:1',
      '--base', server.baseUrl,
      '--root', tmpDir,
    ]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'ok');
    assert.equal(summary.base, server.baseUrl);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('version-mismatch mirrors: repo without ?v= and live with non-numeric ?v=', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-vmirror-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    const repoIndexPath = path.join(tmpDir, 'town-3d', 'index.html');
    await fs.writeFile(repoIndexPath, '<!doctype html><script type="module">import "./town.js";</script>\n');
    server = await startFixtureServer(served);

    const resRepoNull = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(resRepoNull.status, 1, `Expected exit 1, got ${resRepoNull.status}`);
    const summaryRepoNull = JSON.parse(resRepoNull.stdout.trim());
    assert.equal(summaryRepoNull.town_js_v, null);
    const failRepoNull = summaryRepoNull.failures.find(
      (f) => f.file === 'index.html' && f.problem === 'town_js_v',
    );
    assert.ok(failRepoNull, `Expected town_js_v failure, got: ${JSON.stringify(summaryRepoNull.failures)}`);
    assert.equal(failRepoNull.detail, 'repo_v=null vs live_v=13');

    await fs.writeFile(repoIndexPath, '<!doctype html><script type="module">import "./town.js?v=13";</script>\n');
    served['index.html'] = '<!doctype html><script type="module">import "./town.js?v=abc";</script>\n';

    const resLiveNonNum = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(resLiveNonNum.status, 1, `Expected exit 1, got ${resLiveNonNum.status}`);
    const summaryLiveNonNum = JSON.parse(resLiveNonNum.stdout.trim());
    assert.equal(summaryLiveNonNum.town_js_v, 13);
    const failLiveNonNum = summaryLiveNonNum.failures.find(
      (f) => f.file === 'index.html' && f.problem === 'town_js_v',
    );
    assert.ok(failLiveNonNum, `Expected town_js_v failure, got: ${JSON.stringify(summaryLiveNonNum.failures)}`);
    assert.equal(failLiveNonNum.detail, 'repo_v=13 vs live_v=null');
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('summary exact key sets for both town-3d and staging-polyfork bundles', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-keys-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startFixtureServer(served);

    const resTown3d = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(resTown3d.status, 0, `Expected exit 0, got ${resTown3d.status}: ${resTown3d.stderr}`);
    const summaryTown3d = JSON.parse(resTown3d.stdout.trim());
    assert.deepEqual(Object.keys(summaryTown3d).sort(), [
      'api',
      'base',
      'bundle',
      'checked',
      'failures',
      'ok',
      'status',
      'town_js_v',
    ]);

    const resStaging = await runCheck([
      '--bundle', 'staging-polyfork',
      '--base', 'http://127.0.0.1:1',
      '--root', REPO_ROOT,
    ]);
    assert.equal(resStaging.status, 1, `Expected exit 1, got ${resStaging.status}`);
    const summaryStaging = JSON.parse(resStaging.stdout.trim());
    assert.deepEqual(Object.keys(summaryStaging).sort(), [
      'api',
      'base',
      'bundle',
      'checked',
      'failures',
      'ok',
      'staging_js_v',
      'status',
    ]);
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('town-3d all-ok run makes exact request count and never requests excluded files', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-reqcount-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startPathRecordingFixtureServer(served);

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const requests = server.getRequests();
    assert.equal(requests.length, 11);
    assert.equal(requests.filter((p) => p === '/api/town/state').length, 1);
    assert.ok(requests.every((p) => !p.includes('pine.glb') && !p.includes('test-dev.mjs')));
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('API returning 500 reports not-live and exits 0 by default, or exits 1 with --require-api', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-api500-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startFixtureServer(served, { apiStatus: 500 });

    const resDefault = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(resDefault.status, 0, `Expected exit 0, got ${resDefault.status}: ${resDefault.stderr}`);
    const summaryDefault = JSON.parse(resDefault.stdout.trim());
    assert.equal(summaryDefault.status, 'ok');
    assert.equal(summaryDefault.api, 'not-live');
    assert.equal(summaryDefault.ok, summaryDefault.checked);

    const resRequired = await runCheck([
      '--bundle', 'town-3d',
      '--base', server.baseUrl,
      '--root', tmpDir,
      '--require-api',
    ]);
    assert.equal(resRequired.status, 1, `Expected exit 1, got ${resRequired.status}`);
    const summaryRequired = JSON.parse(resRequired.stdout.trim());
    const apiFail = summaryRequired.failures.find(
      (f) => f.file === '/api/town/state' && f.problem === 'bad-status',
    );
    assert.ok(apiFail, `Expected /api/town/state bad-status failure, got: ${JSON.stringify(summaryRequired.failures)}`);
    assert.equal(apiFail.detail, 'HTTP 500');
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('extra-issue fetch returning 500 fails with bad-status HTTP 500', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-issue500-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    served['gazette/latest.json'] = JSON.stringify({
      latest: 4,
      issues: [{ n: 4, file: 'issue-004.html', date: '2026-11-24', headline: 'Issue 4' }],
    });
    server = await startFixtureServer(served, { fileStatus: { 'gazette/issue-004.html': 500 } });

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1, `Expected exit 1, got ${res.status}`);
    const summary = JSON.parse(res.stdout.trim());
    const issueFail = summary.failures.find(
      (f) => f.file === 'gazette/issue-004.html' && f.problem === 'bad-status',
    );
    assert.ok(issueFail, `Expected gazette/issue-004.html bad-status failure, got: ${JSON.stringify(summary.failures)}`);
    assert.equal(issueFail.detail, 'HTTP 500');
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('file fetch with destroyed socket fails with bad-status and decrements ok count', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-fileclose-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startFileCloseFixtureServer(served, 'models/bench.glb');

    const res = await runCheck(['--bundle', 'town-3d', '--base', server.baseUrl, '--root', tmpDir]);
    assert.equal(res.status, 1, `Expected exit 1, got ${res.status}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.ok, 9);
    const fileFail = summary.failures.find(
      (f) => f.file === 'models/bench.glb' && f.problem === 'bad-status',
    );
    assert.ok(fileFail, `Expected models/bench.glb bad-status failure, got: ${JSON.stringify(summary.failures)}`);
    assert.equal(typeof fileFail.detail, 'string');
    assert.ok(fileFail.detail.length > 0, 'Expected non-empty detail on file socket failure');
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('multiple trailing slashes are normalized on --base and --api-base', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-live-slashes-'));
  let server;
  try {
    const served = await createFixtureTree(tmpDir);
    server = await startFixtureServer(served);

    const res = await runCheck([
      '--bundle', 'town-3d',
      '--base', `${server.baseUrl}///`,
      '--api-base', `${server.baseUrl}///`,
      '--root', tmpDir,
    ]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.status, 'ok');
    assert.equal(summary.base, server.baseUrl);
    assert.equal(summary.api, 'live');
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
