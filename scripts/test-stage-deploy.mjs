#!/usr/bin/env node
/**
 * Tests for scripts/stage-deploy.mjs (Slice 28)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGE_SCRIPT = path.join(__dirname, 'stage-deploy.mjs');
const SELF_PATH = fileURLToPath(import.meta.url);
const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');

function runStage(args) {
  return spawnSync(process.execPath, [STAGE_SCRIPT, ...args], {
    encoding: 'utf8',
  });
}

async function createFixtureTree(rootDir) {
  const town3d = path.join(rootDir, 'town-3d');
  await fs.mkdir(path.join(town3d, 'models'), { recursive: true });
  await fs.mkdir(path.join(town3d, 'gazette'), { recursive: true });
  await fs.mkdir(path.join(town3d, 'plots', 'milo'), { recursive: true });

  const files = {
    'index.html': '<!doctype html><script type="module">import "./town.js?v=99";</script>\n',
    'town.js': 'export const TOWN_VERSION = 99;\n',
    'concept-bandstand.js': 'export const BANDSTAND = true;\n',
    'CREDITS.md': '# Credits\nBandstand lantern assets.\n',
    'models/bench.glb': Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]),
    'gazette/issue-001.html': '<h1>Ghostlight Gazette</h1>\n',
    'plots/milo/index.html': '<p>Milo desk note</p>\n',
  };

  for (const [relPath, content] of Object.entries(files)) {
    const dest = path.join(town3d, relPath);
    await fs.writeFile(dest, content);
  }

  return files;
}

async function pathExists(p) {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

test('happy path stages fixture tree, writes deterministic MANIFEST.json, and prints stdout JSON', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-happy-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    const expectedFiles = await createFixtureTree(fixtureRoot);

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const stdoutLines = res.stdout.trim().split('\n');
    assert.equal(stdoutLines.length, 1, 'Expected exactly one JSON line on stdout');
    const summary = JSON.parse(stdoutLines[0]);
    assert.equal(summary.ok, true);
    assert.equal(summary.out, outDir);
    assert.equal(summary.town_js_v, '99');
    assert.equal(summary.file_count, Object.keys(expectedFiles).length);

    const manifestPath = path.join(outDir, 'ghostlight-town', 'MANIFEST.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

    assert.match(manifest.staged_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(manifest.source, 'ghostlight-town repo tree');
    assert.equal(manifest.town_js_v, '99');
    assert.equal(manifest.file_count, Object.keys(expectedFiles).length);
    assert.deepEqual(manifest.not_staged, [
      'town-api/ (server-side, separate deploy)',
      'town-npc/ (server-side, separate deploy)',
    ]);

    const paths = manifest.files.map((f) => f.path);
    const sortedPaths = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(paths, sortedPaths, 'manifest.files must be sorted by path');

    let computedTotal = 0;
    for (const entry of manifest.files) {
      const expectedRaw = expectedFiles[entry.path];
      assert.ok(expectedRaw !== undefined, `Unexpected staged file: ${entry.path}`);
      const expectedBuf = Buffer.isBuffer(expectedRaw) ? expectedRaw : Buffer.from(expectedRaw, 'utf8');
      const expectedSha = crypto.createHash('sha256').update(expectedBuf).digest('hex');

      assert.equal(entry.bytes, expectedBuf.length);
      assert.equal(entry.sha256, expectedSha);
      computedTotal += entry.bytes;

      const stagedBuf = await fs.readFile(path.join(outDir, 'ghostlight-town', entry.path));
      assert.ok(stagedBuf.equals(expectedBuf), `Staged bytes differ for ${entry.path}`);
    }
    assert.equal(manifest.total_bytes, computedTotal);
    assert.equal(summary.total_bytes, computedTotal);

    // Determinism check: second run produces identical manifest except staged_at.
    const res2 = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res2.status, 0);
    const manifest2 = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.deepEqual(
      { ...manifest2, staged_at: 'fixed' },
      { ...manifest, staged_at: 'fixed' }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('secret guard blocks x-token.txt filename and leaves no staging dir', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-token-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.writeFile(path.join(fixtureRoot, 'town-3d', 'gazette', 'x-token.txt'), 'harmless\n');

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.match(errJson.error, /Secret guard/i);
    assert.equal(await pathExists(outDir), false, 'No staging dir should be left behind');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('secret guard blocks private key content in .js and leaves no staging dir', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-key-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.writeFile(
      path.join(fixtureRoot, 'town-3d', 'concept-leak.js'),
      'const k = "-----BEGIN EC PRIVATE KEY-----";\n'
    );

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.match(errJson.error, /Secret guard/i);
    assert.equal(await pathExists(outDir), false, 'No staging dir should be left behind');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('missing source file fails closed with JSON error and leaves no staging dir', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-missing-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.rm(path.join(fixtureRoot, 'town-3d', 'CREDITS.md'));

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.match(errJson.error, /Missing required source file/i);
    assert.equal(await pathExists(outDir), false, 'No staging dir should be left behind');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('symlink source fails closed with JSON error', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-symlink-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);

    const outsideFile = path.join(tmpDir, 'outside.html');
    await fs.writeFile(outsideFile, '<p>outside</p>\n');
    await fs.symlink(outsideFile, path.join(fixtureRoot, 'town-3d', 'gazette', 'link.html'));

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.match(errJson.error, /symlink/i);
    assert.equal(await pathExists(outDir), false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--out inside town-3d/ or at repo root is refused', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-out-refusal-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    await createFixtureTree(fixtureRoot);

    const badOut = path.join(fixtureRoot, 'town-3d', 'nested-out');
    const res1 = runStage(['--root', fixtureRoot, '--out', badOut]);
    assert.equal(res1.status, 1);
    const err1 = JSON.parse(res1.stderr.trim());
    assert.equal(err1.ok, false);
    assert.match(err1.error, /Refusing/i);

    const res2 = runStage(['--root', fixtureRoot, '--out', fixtureRoot]);
    assert.equal(res2.status, 1);
    const err2 = JSON.parse(res2.stderr.trim());
    assert.equal(err2.ok, false);
    assert.match(err2.error, /Refusing/i);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('excludes models/pine.glb from staging and records it in manifest.excluded', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-exclude-pine-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    const expectedFiles = await createFixtureTree(fixtureRoot);
    await fs.writeFile(
      path.join(fixtureRoot, 'town-3d', 'models', 'pine.glb'),
      Buffer.from('fake-pine-glb')
    );

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.file_count, Object.keys(expectedFiles).length);

    const stagedPine = path.join(outDir, 'ghostlight-town', 'models', 'pine.glb');
    assert.equal(await pathExists(stagedPine), false, 'models/pine.glb must not be staged');

    const manifestPath = path.join(outDir, 'ghostlight-town', 'MANIFEST.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(manifest.file_count, Object.keys(expectedFiles).length);
    assert.ok(
      manifest.files.every((f) => f.path !== 'models/pine.glb'),
      'models/pine.glb must not appear in manifest.files'
    );
    assert.deepEqual(manifest.excluded, [
      {
        path: 'models/pine.glb',
        reason: 'deliberately uncommitted, 2.2 MB — procedural trees stay',
      },
    ]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('no banned term in either file and no fetch( in stage-deploy.mjs', async () => {
  const [stageSrc, testSrc] = await Promise.all([
    fs.readFile(STAGE_SCRIPT, 'utf8'),
    fs.readFile(SELF_PATH, 'utf8'),
  ]);

  assert.ok(!BANNED_TERM_RE.test(stageSrc), 'stage-deploy.mjs must not contain banned term');
  assert.ok(!BANNED_TERM_RE.test(testSrc), 'test-stage-deploy.mjs must not contain banned term');
  assert.ok(!/\bfetch\s*\(/.test(stageSrc), 'stage-deploy.mjs must not contain fetch(');
});
