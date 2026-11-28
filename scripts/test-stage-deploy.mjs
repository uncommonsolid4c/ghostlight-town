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
  await fs.mkdir(path.join(town3d, 'guestbook'), { recursive: true });
  await fs.mkdir(path.join(town3d, 'inn'), { recursive: true });
  await fs.mkdir(path.join(town3d, 'plots', 'milo'), { recursive: true });

  const files = {
    'index.html': '<!doctype html><script type="module">import "./town.js?v=99";</script>\n',
    'move-in.html': '<!doctype html><h1>Move in</h1>\n',
    'guestbook/index.html': '<!doctype html><h1>Town Gate Guestbook</h1>\n',
    'inn/index.html': '<!doctype html><h1>Ghostlight Inn</h1>\n',
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
  // Build tools directly under gazette/ must be excluded from staging.
  await fs.writeFile(path.join(town3d, 'gazette/build-feed.mjs'), '// build tool\n');

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

    assert.ok(
      manifest.excluded.some(
        (e) => e.path === 'gazette/build-feed.mjs' && e.reason === 'build tool, not served content'
      ),
      'gazette/build-feed.mjs must be recorded in manifest.excluded'
    );
    assert.equal(
      manifest.files.some((f) => f.path === 'gazette/build-feed.mjs'),
      false,
      'gazette/build-feed.mjs must not be in manifest.files'
    );
    assert.equal(
      await pathExists(path.join(outDir, 'ghostlight-town', 'gazette/build-feed.mjs')),
      false,
      'gazette/build-feed.mjs must not be copied to staged dir'
    );

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
        path: 'gazette/build-feed.mjs',
        reason: 'build tool, not served content',
      },
      {
        path: 'models/pine.glb',
        reason: 'deliberately uncommitted, 2.2 MB — procedural trees stay',
      },
    ]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

async function snapshotTree(dirPath, prefix = '', out = {}) {
  const entries = await fs.readdir(dirPath);
  entries.sort();
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    const relPath = prefix ? `${prefix}/${entry}` : entry;
    const stat = await fs.lstat(fullPath);
    if (stat.isDirectory()) {
      await snapshotTree(fullPath, relPath, out);
    } else if (stat.isFile()) {
      const buf = await fs.readFile(fullPath);
      out[relPath] = {
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        mtimeMs: stat.mtimeMs,
      };
    }
  }
  return out;
}

test('--verify on real staged tree succeeds, matches manifest count, and does not modify staged dir', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-real-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    const stageRes = runStage(['--out', outDir]);
    assert.equal(stageRes.status, 0, `Stage failed: ${stageRes.stderr}`);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifest = JSON.parse(await fs.readFile(path.join(stagedDir, 'MANIFEST.json'), 'utf8'));
    const beforeSnapshot = await snapshotTree(stagedDir);

    const verifyRes = runStage(['--verify', stagedDir]);
    assert.equal(verifyRes.status, 0, `Verify failed: ${verifyRes.stdout} ${verifyRes.stderr}`);
    assert.equal(verifyRes.stderr, '');

    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'ok');
    assert.equal(report.checked, manifest.file_count);
    assert.equal(report.ok, manifest.file_count);
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
    assert.equal(report.town_js_v, manifest.town_js_v);

    const afterSnapshot = await snapshotTree(stagedDir);
    assert.deepEqual(afterSnapshot, beforeSnapshot, '--verify must not modify the staged dir');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify reports mismatch when one staged file is corrupted by one byte', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-mismatch-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const targetFile = path.join(stagedDir, 'town.js');
    const buf = await fs.readFile(targetFile);
    buf[0] = buf[0] ^ 0xff;
    await fs.writeFile(targetFile, buf);

    const verifyRes = runStage(['--root', fixtureRoot, '--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.deepEqual(report.mismatch, ['town.js']);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify reports missing when one staged file is deleted', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-missing-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    await fs.rm(path.join(stagedDir, 'CREDITS.md'));

    const verifyRes = runStage(['--root', fixtureRoot, '--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.deepEqual(report.missing, ['CREDITS.md']);
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.extra, []);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify reports extra when an unlisted file is present in staged dir', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-extra-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    await fs.writeFile(path.join(stagedDir, 'gazette', 'stray.html'), '<p>stray</p>\n');

    const verifyRes = runStage(['--root', fixtureRoot, '--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.deepEqual(report.extra, ['gazette/stray.html']);
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.missing, []);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify fails when town.js?v= in staged index.html disagrees with manifest town_js_v', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-version-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const indexPath = path.join(stagedDir, 'index.html');
    const updatedHtml = (await fs.readFile(indexPath, 'utf8')).replace('town.js?v=99', 'town.js?v=999');
    await fs.writeFile(indexPath, updatedHtml, 'utf8');

    // Also test pure town_js_v disagreement even if index.html hash in manifest were updated.
    const manifestPath = path.join(stagedDir, 'MANIFEST.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const indexEntry = manifest.files.find((f) => f.path === 'index.html');
    indexEntry.sha256 = crypto.createHash('sha256').update(updatedHtml, 'utf8').digest('hex');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const verifyRes = runStage(['--root', fixtureRoot, '--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.equal(report.town_js_v, '99');
    assert.equal(report.staged_town_js_v, '999');
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify fails closed with JSON error on stderr when MANIFEST.json is missing', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-no-manifest-'));
  try {
    const stagedDir = path.join(tmpDir, 'ghostlight-town');
    await fs.mkdir(stagedDir, { recursive: true });

    const verifyRes = runStage(['--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    assert.equal(verifyRes.stdout, '');
    const errJson = JSON.parse(verifyRes.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.match(errJson.error, /MANIFEST\.json/i);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify rejects symlink inside staged dir without following it', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-symlink-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const outsideFile = path.join(tmpDir, 'outside.txt');
    await fs.writeFile(outsideFile, 'secret\n');
    await fs.symlink(outsideFile, path.join(stagedDir, 'gazette', 'link.html'));

    const verifyRes = runStage(['--root', fixtureRoot, '--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    assert.equal(verifyRes.stdout, '');
    const errJson = JSON.parse(verifyRes.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.match(errJson.error, /symlink/i);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify refuses repo root and town-3d/', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-refuse-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    await createFixtureTree(fixtureRoot);

    const res1 = runStage(['--root', fixtureRoot, '--verify', fixtureRoot]);
    assert.equal(res1.status, 1);
    const err1 = JSON.parse(res1.stderr.trim());
    assert.equal(err1.ok, false);
    assert.match(err1.error, /Refusing/i);

    const res2 = runStage(['--root', fixtureRoot, '--verify', path.join(fixtureRoot, 'town-3d')]);
    assert.equal(res2.status, 1);
    const err2 = JSON.parse(res2.stderr.trim());
    assert.equal(err2.ok, false);
    assert.match(err2.error, /Refusing/i);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('real tree stages move-in.html in MANIFEST.json', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-move-in-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    const res = runStage(['--out', outDir]);
    assert.equal(res.status, 0, `Stage failed: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifest = JSON.parse(await fs.readFile(path.join(stagedDir, 'MANIFEST.json'), 'utf8'));
    assert.ok(
      manifest.files.some((f) => f.path === 'move-in.html'),
      'MANIFEST.json must include move-in.html'
    );
    assert.equal(
      await pathExists(path.join(stagedDir, 'move-in.html')),
      true,
      'move-in.html must be copied into staged dir'
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('real tree stages inn/index.html in MANIFEST.json', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-inn-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    const res = runStage(['--out', outDir]);
    assert.equal(res.status, 0, `Stage failed: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifest = JSON.parse(await fs.readFile(path.join(stagedDir, 'MANIFEST.json'), 'utf8'));
    assert.ok(
      manifest.files.some((f) => f.path === 'inn/index.html'),
      'MANIFEST.json must include inn/index.html'
    );
    assert.equal(
      await pathExists(path.join(stagedDir, 'inn', 'index.html')),
      true,
      'inn/index.html must be copied into staged dir'
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('real tree stages guestbook/index.html in MANIFEST.json', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-guestbook-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    const res = runStage(['--out', outDir]);
    assert.equal(res.status, 0, `Stage failed: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifest = JSON.parse(await fs.readFile(path.join(stagedDir, 'MANIFEST.json'), 'utf8'));
    assert.ok(
      manifest.files.some((f) => f.path === 'guestbook/index.html'),
      'MANIFEST.json must include guestbook/index.html'
    );
    assert.equal(
      await pathExists(path.join(stagedDir, 'guestbook', 'index.html')),
      true,
      'guestbook/index.html must be copied into staged dir'
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('default staging (no --bundle) sets bundle: "town-3d" and staging_js_v: null', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-default-bundle-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.bundle, 'town-3d');
    assert.equal(summary.town_js_v, '99');
    assert.equal(summary.staging_js_v, null);

    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.equal(manifest.bundle, 'town-3d');
    assert.equal(manifest.town_js_v, '99');
    assert.equal(manifest.staging_js_v, null);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('real tree --bundle staging-polyfork stages 196 files with expected manifest and exclusions', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-polyfork-real-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    const res = runStage(['--bundle', 'staging-polyfork', '--out', outDir]);
    assert.equal(res.status, 0, `Stage failed: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.bundle, 'staging-polyfork');
    assert.equal(summary.staging_js_v, '41');
    assert.equal(summary.town_js_v, null);
    assert.equal(summary.file_count, 196);
    assert.ok(summary.total_bytes > 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifest = JSON.parse(await fs.readFile(path.join(stagedDir, 'MANIFEST.json'), 'utf8'));
    assert.equal(manifest.bundle, 'staging-polyfork');
    assert.equal(manifest.staging_js_v, '41');
    assert.equal(manifest.town_js_v, null);
    assert.equal(manifest.file_count, 196);
    assert.ok(manifest.total_bytes > 0);

    const pathSet = new Set(manifest.files.map((f) => f.path));
    assert.equal(pathSet.size, 196);

    const requiredPaths = [
      'index.html',
      'staging.js',
      'daylight-drift.mjs',
      'empty-pad.mjs',
      'notice-board-overlay.mjs',
      'concept-bandstand.js',
      'concept-cottage.js',
      'concept-ghost.js',
      'kit-campground/kit.mjs',
      'kit-medieval/tavern.mjs',
      'gazette/feed.xml',
      'gazette/issue-001.html',
      'gazette/issue-002.html',
      'gazette/issue-003.html',
      'gazette/latest.json',
      'plots/milo/index.html',
      'plots/wick/index.html',
      'plots/maren/index.html',
      'plots/tomas/index.html',
      'inn/index.html',
      'guestbook/index.html',
      'move-in.html',
    ];
    for (const reqPath of requiredPaths) {
      assert.ok(pathSet.has(reqPath), `Expected staged manifest to include ${reqPath}`);
    }

    for (const p of pathSet) {
      assert.ok(!/(?:^|\/)test-[^/]*\.mjs$/.test(p), `Must not stage test file: ${p}`);
      assert.notEqual(p, 'README.md', 'Must not stage README.md');
      assert.notEqual(p, 'town.js', 'Must not stage town.js');
      assert.ok(!p.startsWith('town-3d/'), `Must not stage under town-3d/ prefix: ${p}`);
      assert.ok(!/^models\/.*\.glb$/.test(p), `Must not stage models/*.glb: ${p}`);
      assert.ok(!/^gazette\/[^/]+\.mjs$/.test(p), `Must not stage gazette/*.mjs: ${p}`);
      assert.notEqual(p, 'CREDITS.md', 'Must not stage town-3d/CREDITS.md');
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify on real staged staging-polyfork bundle succeeds with checked 196', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-polyfork-real-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    const stageRes = runStage(['--bundle', 'staging-polyfork', '--out', outDir]);
    assert.equal(stageRes.status, 0, `Stage failed: ${stageRes.stderr}`);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const verifyRes = runStage(['--verify', stagedDir]);
    assert.equal(verifyRes.status, 0, `Verify failed: ${verifyRes.stdout} ${verifyRes.stderr}`);
    assert.equal(verifyRes.stderr, '');

    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'ok');
    assert.equal(report.bundle, 'staging-polyfork');
    assert.equal(report.checked, 196);
    assert.equal(report.ok, 196);
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
    assert.equal(report.staging_js_v, '41');
    assert.equal(report.town_js_v, null);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify reports mismatch when one staged staging-polyfork file is corrupted by one byte', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-polyfork-tamper-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    assert.equal(runStage(['--bundle', 'staging-polyfork', '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const targetFile = path.join(stagedDir, 'staging.js');
    const buf = await fs.readFile(targetFile);
    buf[0] = buf[0] ^ 0xff;
    await fs.writeFile(targetFile, buf);

    const verifyRes = runStage(['--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.deepEqual(report.mismatch, ['staging.js']);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify fails when staging.js?v= in staged index.html disagrees with manifest staging_js_v', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-polyfork-version-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    assert.equal(runStage(['--bundle', 'staging-polyfork', '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const indexPath = path.join(stagedDir, 'index.html');
    const updatedHtml = (await fs.readFile(indexPath, 'utf8')).replace('staging.js?v=41', 'staging.js?v=999');
    await fs.writeFile(indexPath, updatedHtml, 'utf8');

    const manifestPath = path.join(stagedDir, 'MANIFEST.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const indexEntry = manifest.files.find((f) => f.path === 'index.html');
    indexEntry.sha256 = crypto.createHash('sha256').update(updatedHtml, 'utf8').digest('hex');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const verifyRes = runStage(['--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.equal(report.bundle, 'staging-polyfork');
    assert.equal(report.staging_js_v, '41');
    assert.equal(report.staged_staging_js_v, '999');
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--bundle bogus fails closed with JSON error on stderr and leaves no staging dir', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-bogus-bundle-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    const res = runStage(['--bundle', 'bogus', '--out', outDir]);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, '');
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.match(errJson.error, /Unknown bundle/i);
    assert.equal(await pathExists(outDir), false, 'No staging dir should be left behind');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--out inside staging-polyfork/ is refused', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-polyfork-refusal-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    await createFixtureTree(fixtureRoot);
    await fs.mkdir(path.join(fixtureRoot, 'staging-polyfork'), { recursive: true });

    const badOut = path.join(fixtureRoot, 'staging-polyfork', 'nested-out');
    const res = runStage(['--root', fixtureRoot, '--out', badOut]);
    assert.equal(res.status, 1);
    const err = JSON.parse(res.stderr.trim());
    assert.equal(err.ok, false);
    assert.match(err.error, /Refusing/i);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('--verify remains backwards-compatible with pre-slice-67 manifests lacking bundle field', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-verify-legacy-manifest-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifestPath = path.join(stagedDir, 'MANIFEST.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    delete manifest.bundle;
    delete manifest.staging_js_v;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const verifyRes = runStage(['--root', fixtureRoot, '--verify', stagedDir]);
    assert.equal(verifyRes.status, 0, `Verify failed: ${verifyRes.stdout} ${verifyRes.stderr}`);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'ok');
    assert.equal(report.bundle, 'town-3d');
    assert.equal(report.town_js_v, '99');
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

test('G1: arg-parse errors fail closed with stderr JSON', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-argparse-'));
  try {
    const cases = [
      { args: ['--bundle'], re: /--bundle requires a bundle name argument/ },
      { args: ['--out'], re: /--out requires a directory argument/ },
      { args: ['--root'], re: /--root requires a directory argument/ },
      { args: ['--verify'], re: /--verify requires a directory argument/ },
      { args: ['--frobnicate'], re: /Unknown argument: --frobnicate/ },
      { args: ['--bundle', '--out', 'x'], re: /--bundle requires a bundle name argument/ },
      {
        args: ['--verify', path.join(tmpDir, 'v'), '--out', path.join(tmpDir, 'o')],
        re: /--verify cannot be combined with --out/,
      },
    ];
    for (const c of cases) {
      const res = runStage(c.args);
      assert.equal(res.status, 1, `Expected exit 1 for ${c.args.join(' ')}`);
      assert.equal(res.stdout, '', `Expected empty stdout for ${c.args.join(' ')}`);
      const errJson = JSON.parse(res.stderr.trim());
      assert.equal(errJson.ok, false);
      assert.match(errJson.error, c.re);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G2: secret guard blocks .pem, .key, secret, credential, and uppercase token filenames', async () => {
  const filenames = ['x.pem', 'x.key', 'my-secret-notes.txt', 'credential-backup.txt', 'X-TOKEN.TXT'];
  for (const name of filenames) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-secname-'));
    try {
      const fixtureRoot = path.join(tmpDir, 'repo');
      const outDir = path.join(tmpDir, 'out');
      await createFixtureTree(fixtureRoot);
      await fs.writeFile(path.join(fixtureRoot, 'town-3d', 'gazette', name), 'harmless\n');

      const res = runStage(['--root', fixtureRoot, '--out', outDir]);
      assert.equal(res.status, 1, `Expected exit 1 for ${name}`);
      const errJson = JSON.parse(res.stderr.trim());
      assert.equal(errJson.ok, false);
      assert.match(errJson.error, /Secret guard/i);
      assert.equal(await pathExists(outDir), false, `No staging dir should be left for ${name}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
});

test('G3: secret guard blocks content patterns and allows bare key negative control', async () => {
  const blocked = [
    { rel: 'gazette/notes.txt', content: 'api_key = "abc123"\n' },
    { rel: 'gazette/page.html', content: '<p>api-key</p>\n' },
    { rel: 'concept-leak2.js', content: '// -----BEGIN RSA PRIVATE KEY-----\n' },
    { rel: 'concept-leak3.js', content: '// -----BEGIN OPENSSH PRIVATE KEY-----\n' },
    { rel: 'gazette/auth-note.txt', content: 'x-auth-token: abc\n' },
  ];
  for (const c of blocked) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-seccontent-'));
    try {
      const fixtureRoot = path.join(tmpDir, 'repo');
      const outDir = path.join(tmpDir, 'out');
      await createFixtureTree(fixtureRoot);
      await fs.writeFile(path.join(fixtureRoot, 'town-3d', c.rel), c.content);

      const res = runStage(['--root', fixtureRoot, '--out', outDir]);
      assert.equal(res.status, 1, `Expected exit 1 for ${c.rel}`);
      const errJson = JSON.parse(res.stderr.trim());
      assert.equal(errJson.ok, false);
      assert.match(errJson.error, /Secret guard blocked content/);
      assert.equal(await pathExists(outDir), false, `No staging dir should be left for ${c.rel}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-seccontent-ok-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.writeFile(path.join(fixtureRoot, 'town-3d', 'gazette/monkey.txt'), 'the word key is harmless\n');

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0 for negative control: ${res.stderr}`);
    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.ok(manifest.files.some((f) => f.path === 'gazette/monkey.txt'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G4: --out and --verify refuse town-api/, town-npc/, and staging-polyfork/', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-refusals-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    await createFixtureTree(fixtureRoot);
    for (const dir of ['town-api', 'town-npc', 'staging-polyfork']) {
      await fs.mkdir(path.join(fixtureRoot, dir), { recursive: true });
    }

    const cases = [
      ['--root', fixtureRoot, '--out', path.join(fixtureRoot, 'town-api', 'out')],
      ['--root', fixtureRoot, '--out', path.join(fixtureRoot, 'town-npc', 'out')],
      ['--root', fixtureRoot, '--out', path.join(fixtureRoot, 'town-api')],
      ['--root', fixtureRoot, '--verify', path.join(fixtureRoot, 'town-api', 'staged')],
      ['--root', fixtureRoot, '--verify', path.join(fixtureRoot, 'staging-polyfork', 'staged')],
    ];
    for (const args of cases) {
      const res = runStage(args);
      assert.equal(res.status, 1, `Expected exit 1 for ${args.join(' ')}`);
      const errJson = JSON.parse(res.stderr.trim());
      assert.equal(errJson.ok, false);
      assert.match(errJson.error, /Refusing/i);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G5: missing required source files fail closed and leave no staging dir', async () => {
  const required = ['index.html', 'town.js', 'move-in.html', 'guestbook/index.html', 'inn/index.html'];
  for (const rel of required) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-missing-req-'));
    try {
      const fixtureRoot = path.join(tmpDir, 'repo');
      const outDir = path.join(tmpDir, 'out');
      await createFixtureTree(fixtureRoot);
      await fs.rm(path.join(fixtureRoot, 'town-3d', rel));

      const res = runStage(['--root', fixtureRoot, '--out', outDir]);
      assert.equal(res.status, 1, `Expected exit 1 when missing ${rel}`);
      const errJson = JSON.parse(res.stderr.trim());
      assert.equal(errJson.ok, false);
      assert.match(errJson.error, /Missing required source file/i);
      assert.equal(await pathExists(outDir), false, `No staging dir should be left when missing ${rel}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
});

test('G6: empty-tree guards fail closed for models, gazette, and plots', async () => {
  const cases = [
    {
      name: 'zero glb',
      mutate: async (t) => fs.rm(path.join(t, 'models', 'bench.glb')),
      re: /Missing required source files: town-3d\/models\/\*\.glb/,
    },
    {
      name: 'missing models dir',
      mutate: async (t) => fs.rm(path.join(t, 'models'), { recursive: true }),
      re: /Missing required source directory: town-3d\/models/,
    },
    {
      name: 'empty gazette',
      mutate: async (t) => {
        await fs.rm(path.join(t, 'gazette', 'issue-001.html'));
        await fs.rm(path.join(t, 'gazette', 'build-feed.mjs'));
      },
      re: /Missing required source files: town-3d\/gazette\/\*\*/,
    },
    {
      name: 'empty plots',
      mutate: async (t) => fs.rm(path.join(t, 'plots', 'milo', 'index.html')),
      re: /Missing required source files: town-3d\/plots\/\*\*/,
    },
  ];
  for (const c of cases) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-emptytree-'));
    try {
      const fixtureRoot = path.join(tmpDir, 'repo');
      const outDir = path.join(tmpDir, 'out');
      await createFixtureTree(fixtureRoot);
      await c.mutate(path.join(fixtureRoot, 'town-3d'));

      const res = runStage(['--root', fixtureRoot, '--out', outDir]);
      assert.equal(res.status, 1, `Expected exit 1 for ${c.name}`);
      const errJson = JSON.parse(res.stderr.trim());
      assert.equal(errJson.ok, false);
      assert.match(errJson.error, c.re);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
});

test('G7: top-level file selection skips non-concept and .txt files and refuses concept symlinks', async () => {
  const tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-select-a-'));
  try {
    const fixtureRoot = path.join(tmpDirA, 'repo');
    const outDir = path.join(tmpDirA, 'out');
    await createFixtureTree(fixtureRoot);
    const town3d = path.join(fixtureRoot, 'town-3d');
    await fs.writeFile(path.join(town3d, 'extra.js'), 'export const EXTRA = 1;\n');
    await fs.writeFile(path.join(town3d, 'concept-ghost.js'), 'export const GHOST = 1;\n');
    await fs.writeFile(path.join(town3d, 'concept-notes.txt'), 'notes\n');

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0: ${res.stderr}`);
    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.ok(manifest.files.some((f) => f.path === 'concept-ghost.js'));
    assert.equal(manifest.files.some((f) => f.path === 'extra.js'), false);
    assert.equal(manifest.files.some((f) => f.path === 'concept-notes.txt'), false);
    assert.equal(manifest.excluded.some((e) => e.path === 'extra.js'), false);
    assert.equal(manifest.excluded.some((e) => e.path === 'concept-notes.txt'), false);
  } finally {
    await fs.rm(tmpDirA, { recursive: true, force: true });
  }

  const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-select-b-'));
  try {
    const fixtureRoot = path.join(tmpDirB, 'repo');
    const outDir = path.join(tmpDirB, 'out');
    await createFixtureTree(fixtureRoot);
    const outsideFile = path.join(tmpDirB, 'outside.js');
    await fs.writeFile(outsideFile, 'export const OUTSIDE = 1;\n');
    await fs.symlink(outsideFile, path.join(fixtureRoot, 'town-3d', 'concept-link.js'));

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.match(errJson.error, /symlink/i);
  } finally {
    await fs.rm(tmpDirB, { recursive: true, force: true });
  }
});

test('G8: version extraction returns null when ?v= is absent or references staging.js', async () => {
  const htmlCases = [
    '<!doctype html><script type="module">import "./town.js";</script>\n',
    '<!doctype html><script type="module">import "./staging.js?v=7";</script>\n',
  ];
  for (const html of htmlCases) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-version-'));
    try {
      const fixtureRoot = path.join(tmpDir, 'repo');
      const outDir = path.join(tmpDir, 'out');
      await createFixtureTree(fixtureRoot);
      await fs.writeFile(path.join(fixtureRoot, 'town-3d', 'index.html'), html);

      const res = runStage(['--root', fixtureRoot, '--out', outDir]);
      assert.equal(res.status, 0, `Expected exit 0: ${res.stderr}`);
      const summary = JSON.parse(res.stdout.trim());
      assert.equal(summary.town_js_v, null);
      assert.equal(summary.staging_js_v, null);
      const manifest = JSON.parse(
        await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
      );
      assert.equal(manifest.town_js_v, null);
      assert.equal(manifest.staging_js_v, null);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
});

test('G9: --verify rejects malformed MANIFEST.json variants and symlink MANIFEST.json', async () => {
  const cases = [
    {
      name: 'unparseable',
      mutate: async (manifestPath) => fs.writeFile(manifestPath, 'not json', 'utf8'),
      re: /Unparseable MANIFEST\.json/,
    },
    {
      name: 'empty object',
      mutate: async (manifestPath) => fs.writeFile(manifestPath, '{}', 'utf8'),
      re: /Malformed MANIFEST\.json: expected object with files array/,
    },
    {
      name: 'missing sha256',
      mutate: async (manifestPath) =>
        fs.writeFile(manifestPath, JSON.stringify({ files: [{ path: 'town.js' }] }), 'utf8'),
      re: /Malformed MANIFEST\.json: invalid file entry/,
    },
    {
      name: 'parent traversal path',
      mutate: async (manifestPath) =>
        fs.writeFile(
          manifestPath,
          JSON.stringify({ files: [{ path: '../escape.html', sha256: 'x' }] }),
          'utf8'
        ),
      re: /Malformed MANIFEST\.json: unsafe path/,
    },
    {
      name: 'absolute path',
      mutate: async (manifestPath) =>
        fs.writeFile(
          manifestPath,
          JSON.stringify({ files: [{ path: '/etc/passwd', sha256: 'x' }] }),
          'utf8'
        ),
      re: /Malformed MANIFEST\.json: unsafe path/,
    },
    {
      name: 'manifest self path',
      mutate: async (manifestPath) =>
        fs.writeFile(
          manifestPath,
          JSON.stringify({ files: [{ path: 'MANIFEST.json', sha256: 'x' }] }),
          'utf8'
        ),
      re: /Malformed MANIFEST\.json: unsafe path/,
    },
    {
      name: 'unknown bundle',
      mutate: async (manifestPath) => {
        const m = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        m.bundle = 'bogus';
        await fs.writeFile(manifestPath, JSON.stringify(m), 'utf8');
      },
      re: /Malformed MANIFEST\.json: unknown bundle bogus/,
    },
    {
      name: 'symlink manifest',
      mutate: async (manifestPath, tmpDir) => {
        const target = path.join(tmpDir, 'outside-manifest.json');
        await fs.writeFile(target, '{}', 'utf8');
        await fs.rm(manifestPath);
        await fs.symlink(target, manifestPath);
      },
      re: /Refusing symlink MANIFEST\.json/,
    },
  ];

  for (const c of cases) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-malformed-'));
    try {
      const fixtureRoot = path.join(tmpDir, 'repo');
      const outDir = path.join(tmpDir, 'out');
      await createFixtureTree(fixtureRoot);
      assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

      const stagedDir = path.join(outDir, 'ghostlight-town');
      const manifestPath = path.join(stagedDir, 'MANIFEST.json');
      await c.mutate(manifestPath, tmpDir);

      const verifyRes = runStage(['--root', fixtureRoot, '--verify', stagedDir]);
      assert.equal(verifyRes.status, 1, `Expected exit 1 for ${c.name}`);
      assert.equal(verifyRes.stdout, '', `Expected empty stdout for ${c.name}`);
      const errJson = JSON.parse(verifyRes.stderr.trim());
      assert.equal(errJson.ok, false);
      assert.match(errJson.error, c.re);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
});

test('G10: staging-polyfork exclusions and shared town-3d fallback', async () => {
  async function setupPolyforkFixture(fixtureRoot, includePolyforkFeed) {
    await createFixtureTree(fixtureRoot);
    const town3d = path.join(fixtureRoot, 'town-3d');
    for (const rel of [
      'gazette/issue-002.html',
      'gazette/issue-003.html',
      'gazette/latest.json',
      'plots/wick/index.html',
      'plots/maren/index.html',
      'plots/tomas/index.html',
    ]) {
      const dest = path.join(town3d, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, `shared:${rel}\n`);
    }
    await fs.writeFile(path.join(town3d, 'gazette/feed.xml'), '<feed>town3d</feed>\n');

    const polyfork = path.join(fixtureRoot, 'staging-polyfork');
    await fs.mkdir(path.join(polyfork, 'gazette'), { recursive: true });
    await fs.writeFile(
      path.join(polyfork, 'index.html'),
      '<!doctype html><script type="module">import "./staging.js?v=41";</script>\n'
    );
    await fs.writeFile(path.join(polyfork, 'staging.js'), 'export const STAGING = 41;\n');
    await fs.writeFile(path.join(polyfork, 'kit.mjs'), 'export const KIT = 1;\n');
    await fs.writeFile(path.join(polyfork, 'test-foo.mjs'), '// test\n');
    await fs.writeFile(path.join(polyfork, 'README.md'), '# Polyfork\n');
    if (includePolyforkFeed) {
      await fs.writeFile(path.join(polyfork, 'gazette/feed.xml'), '<feed>polyfork</feed>\n');
    }
  }

  const tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-polyfork-a-'));
  try {
    const fixtureRoot = path.join(tmpDirA, 'repo');
    const outDir = path.join(tmpDirA, 'out');
    await setupPolyforkFixture(fixtureRoot, true);

    const res = runStage(['--root', fixtureRoot, '--bundle', 'staging-polyfork', '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0 for Run A: ${res.stderr}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.bundle, 'staging-polyfork');
    assert.equal(summary.staging_js_v, '41');
    assert.equal(summary.town_js_v, null);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifest = JSON.parse(await fs.readFile(path.join(stagedDir, 'MANIFEST.json'), 'utf8'));
    assert.equal(manifest.files.some((f) => f.path === 'test-foo.mjs'), false);
    assert.equal(manifest.files.some((f) => f.path === 'README.md'), false);
    assert.equal(await pathExists(path.join(stagedDir, 'test-foo.mjs')), false);
    assert.equal(await pathExists(path.join(stagedDir, 'README.md')), false);
    assert.ok(
      manifest.excluded.some(
        (e) => e.path === 'test-foo.mjs' && e.reason === 'test suite, not served content'
      )
    );
    assert.ok(
      manifest.excluded.some(
        (e) => e.path === 'README.md' && e.reason === 'documentation, not served content'
      )
    );
    const feedEntries = manifest.files.filter((f) => f.path === 'gazette/feed.xml');
    assert.equal(feedEntries.length, 1);
    assert.equal(
      await fs.readFile(path.join(stagedDir, 'gazette/feed.xml'), 'utf8'),
      '<feed>polyfork</feed>\n'
    );
  } finally {
    await fs.rm(tmpDirA, { recursive: true, force: true });
  }

  const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-polyfork-b-'));
  try {
    const fixtureRoot = path.join(tmpDirB, 'repo');
    const outDir = path.join(tmpDirB, 'out');
    await setupPolyforkFixture(fixtureRoot, false);

    const res = runStage(['--root', fixtureRoot, '--bundle', 'staging-polyfork', '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0 for Run B: ${res.stderr}`);
    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifest = JSON.parse(await fs.readFile(path.join(stagedDir, 'MANIFEST.json'), 'utf8'));
    const expectedTown3dFeed = '<feed>town3d</feed>\n';
    const expectedSha = crypto.createHash('sha256').update(expectedTown3dFeed, 'utf8').digest('hex');
    const feedEntry = manifest.files.find((f) => f.path === 'gazette/feed.xml');
    assert.ok(feedEntry, 'gazette/feed.xml should be pulled from town-3d');
    assert.equal(feedEntry.sha256, expectedSha);
    assert.equal(
      await fs.readFile(path.join(stagedDir, 'gazette/feed.xml'), 'utf8'),
      expectedTown3dFeed
    );
  } finally {
    await fs.rm(tmpDirB, { recursive: true, force: true });
  }
});

test('G11: default --out stages under <root>/staging', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g11-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    await createFixtureTree(fixtureRoot);

    const res = runStage(['--root', fixtureRoot]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const summary = JSON.parse(res.stdout.trim());
    assert.deepEqual(summary.out, path.join(fixtureRoot, 'staging'));
    assert.equal(
      await pathExists(path.join(fixtureRoot, 'staging', 'ghostlight-town', 'MANIFEST.json')),
      true
    );
    assert.equal(summary.town_js_v, '99');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G12: secret guard filename edges: uppercase PEM, credential, token substring, key negative control', async () => {
  for (const badName of ['MY.PEM', 'a.credential.json', 'tokenizer.js']) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g12-bad-'));
    try {
      const fixtureRoot = path.join(tmpDir, 'repo');
      const outDir = path.join(tmpDir, 'out');
      await createFixtureTree(fixtureRoot);
      await fs.writeFile(path.join(fixtureRoot, 'town-3d', 'gazette', badName), 'harmless\n');

      const res = runStage(['--root', fixtureRoot, '--out', outDir]);
      assert.equal(res.status, 1, `Expected exit 1 for ${badName}`);
      const errJson = JSON.parse(res.stderr.trim());
      assert.equal(errJson.ok, false);
      assert.match(errJson.error, /Secret guard/i);
      assert.equal(await pathExists(outDir), false, `Expected no staging dir for ${badName}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  const tmpDirOk = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g12-ok-'));
  try {
    const fixtureRoot = path.join(tmpDirOk, 'repo');
    const outDir = path.join(tmpDirOk, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.writeFile(
      path.join(fixtureRoot, 'town-3d', 'gazette', 'mykey.txt'),
      'the word key is harmless\n'
    );

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0 for mykey.txt, got ${res.status}: ${res.stderr}`);
    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.equal(
      manifest.files.some((f) => f.path === 'gazette/mykey.txt'),
      true
    );
  } finally {
    await fs.rm(tmpDirOk, { recursive: true, force: true });
  }
});

test('G13: manifest exact key order, not_staged, staged_at ISO, files sorted', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g13-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);

    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.deepEqual(Object.keys(manifest), [
      'staged_at',
      'source',
      'bundle',
      'town_js_v',
      'staging_js_v',
      'files',
      'total_bytes',
      'file_count',
      'not_staged',
      'excluded',
    ]);
    assert.equal(manifest.source, 'ghostlight-town repo tree');
    assert.deepEqual(manifest.not_staged, [
      'town-api/ (server-side, separate deploy)',
      'town-npc/ (server-side, separate deploy)',
    ]);
    assert.match(manifest.staged_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(
      manifest.files.map((f) => f.path),
      [
        'CREDITS.md',
        'concept-bandstand.js',
        'gazette/issue-001.html',
        'guestbook/index.html',
        'index.html',
        'inn/index.html',
        'models/bench.glb',
        'move-in.html',
        'plots/milo/index.html',
        'town.js',
      ]
    );
    assert.equal(manifest.file_count, 10);
    assert.deepEqual(manifest.excluded, [
      { path: 'gazette/build-feed.mjs', reason: 'build tool, not served content' },
    ]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G14: --verify target errors: symlink dir, missing dir, file as dir', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g14-'));
  try {
    const realDir = path.join(tmpDir, 'real-dir');
    const linkDir = path.join(tmpDir, 'link-dir');
    const missingDir = path.join(tmpDir, 'missing-dir');
    const fileTarget = path.join(tmpDir, 'regular-file.txt');

    await fs.mkdir(realDir);
    await fs.symlink(realDir, linkDir);
    await fs.writeFile(fileTarget, 'not a dir\n');

    const cases = [
      { name: 'symlink dir', target: linkDir, re: /Refusing symlink verify directory/ },
      { name: 'missing dir', target: missingDir, re: /Missing verify directory/ },
      { name: 'file as dir', target: fileTarget, re: /Expected directory for --verify/ },
    ];

    for (const c of cases) {
      const res = runStage(['--verify', c.target]);
      assert.equal(res.status, 1, `Expected exit 1 for ${c.name}`);
      assert.equal(res.stdout, '', `Expected empty stdout for ${c.name}`);
      const errJson = JSON.parse(res.stderr.trim());
      assert.equal(errJson.ok, false);
      assert.match(errJson.error, c.re);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G15: pre-existing out dir: stale prefix replaced on success, untouched on pre-write failure', async () => {
  const tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g15-a-'));
  try {
    const fixtureRoot = path.join(tmpDirA, 'repo');
    const outDir = path.join(tmpDirA, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.mkdir(path.join(outDir, 'ghostlight-town'), { recursive: true });
    await fs.writeFile(path.join(outDir, 'ghostlight-town', 'stale.html'), 'stale\n');
    await fs.writeFile(path.join(outDir, 'keep.txt'), 'keep\n');

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0 for Run A, got ${res.status}: ${res.stderr}`);
    assert.equal(await pathExists(path.join(outDir, 'ghostlight-town', 'stale.html')), false);
    assert.equal(await pathExists(path.join(outDir, 'keep.txt')), true);
    assert.equal(await pathExists(path.join(outDir, 'ghostlight-town', 'MANIFEST.json')), true);
  } finally {
    await fs.rm(tmpDirA, { recursive: true, force: true });
  }

  const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g15-b-'));
  try {
    const fixtureRoot = path.join(tmpDirB, 'repo');
    const outDir = path.join(tmpDirB, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.mkdir(path.join(outDir, 'ghostlight-town'), { recursive: true });
    await fs.writeFile(path.join(outDir, 'ghostlight-town', 'stale.html'), 'stale\n');
    await fs.writeFile(path.join(outDir, 'keep.txt'), 'keep\n');
    await fs.writeFile(path.join(fixtureRoot, 'town-3d', 'gazette', 'x-token.txt'), 'harmless\n');

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1, 'Expected exit 1 for Run B');
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.match(errJson.error, /Secret guard/i);
    assert.equal(await pathExists(outDir), true);
    assert.equal(await pathExists(path.join(outDir, 'ghostlight-town', 'stale.html')), true);
    assert.equal(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'stale.html'), 'utf8'),
      'stale\n'
    );
  } finally {
    await fs.rm(tmpDirB, { recursive: true, force: true });
  }
});

test('G16: --verify fails when manifest town_js_v is deleted but staged index still has ?v=99', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g16-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);

    const stageRes = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(stageRes.status, 0, `Expected exit 0, got ${stageRes.status}: ${stageRes.stderr}`);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifestPath = path.join(stagedDir, 'MANIFEST.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    delete manifest.town_js_v;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const verifyRes = runStage(['--root', fixtureRoot, '--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.equal(report.bundle, 'town-3d');
    assert.equal(report.checked, 10);
    assert.equal(report.ok, 10);
    assert.equal(report.town_js_v, null);
    assert.equal(report.staged_town_js_v, '99');
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

async function setupPolyforkFixture(fixtureRoot, includePolyforkFeed) {
  await createFixtureTree(fixtureRoot);
  const town3d = path.join(fixtureRoot, 'town-3d');
  for (const rel of [
    'gazette/issue-002.html',
    'gazette/issue-003.html',
    'gazette/latest.json',
    'plots/wick/index.html',
    'plots/maren/index.html',
    'plots/tomas/index.html',
  ]) {
    const dest = path.join(town3d, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, `shared:${rel}\n`);
  }
  await fs.writeFile(path.join(town3d, 'gazette/feed.xml'), '<feed>town3d</feed>\n');

  const polyfork = path.join(fixtureRoot, 'staging-polyfork');
  await fs.mkdir(path.join(polyfork, 'gazette'), { recursive: true });
  await fs.writeFile(
    path.join(polyfork, 'index.html'),
    '<!doctype html><script type="module">import "./staging.js?v=41";</script>\n'
  );
  await fs.writeFile(path.join(polyfork, 'staging.js'), 'export const STAGING = 41;\n');
  await fs.writeFile(path.join(polyfork, 'kit.mjs'), 'export const KIT = 1;\n');
  await fs.writeFile(path.join(polyfork, 'test-foo.mjs'), '// test\n');
  await fs.writeFile(path.join(polyfork, 'README.md'), '# Polyfork\n');
  if (includePolyforkFeed) {
    await fs.writeFile(path.join(polyfork, 'gazette/feed.xml'), '<feed>polyfork</feed>\n');
  }
}

test('G17: polyfork bundle fails closed when a shared town-3d file is missing', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g17-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await setupPolyforkFixture(fixtureRoot, true);
    await fs.rm(path.join(fixtureRoot, 'town-3d', 'plots', 'tomas', 'index.html'));

    const res = runStage(['--root', fixtureRoot, '--bundle', 'staging-polyfork', '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.equal(errJson.error, 'Missing required source file: town-3d/plots/tomas/index.html');
    assert.equal(await pathExists(outDir), false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G18: EXCLUDED_FILES export and real-tree town-3d stage exact numbers', async () => {
  const mod = await import(STAGE_SCRIPT);
  assert.deepEqual(mod.EXCLUDED_FILES, [
    {
      repoPath: 'town-3d/models/pine.glb',
      relPath: 'models/pine.glb',
      reason: 'deliberately uncommitted, 2.2 MB — procedural trees stay',
    },
  ]);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g18-'));
  try {
    const outDir = path.join(tmpDir, 'out');
    const res = runStage(['--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.bundle, 'town-3d');
    assert.equal(summary.town_js_v, '16');
    assert.equal(summary.staging_js_v, null);
    assert.equal(summary.file_count, 25);
    assert.equal(summary.total_bytes, 436477);

    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.deepEqual(
      manifest.files.map((f) => f.path),
      [
        'CREDITS.md',
        'concept-bandstand.js',
        'concept-cottage.js',
        'concept-ghost.js',
        'gazette/feed.xml',
        'gazette/issue-001.html',
        'gazette/issue-002.html',
        'gazette/issue-003.html',
        'gazette/latest.json',
        'guestbook/index.html',
        'index.html',
        'inn/index.html',
        'models/bench.glb',
        'models/bookshelf.glb',
        'models/lantern.glb',
        'models/oil-lamp.glb',
        'models/post-lantern.glb',
        'models/street-light.glb',
        'models/teapot.glb',
        'move-in.html',
        'plots/maren/index.html',
        'plots/milo/index.html',
        'plots/tomas/index.html',
        'plots/wick/index.html',
        'town.js',
      ]
    );
    assert.deepEqual(manifest.excluded, [
      { path: 'gazette/build-digest.mjs', reason: 'build tool, not served content' },
      { path: 'gazette/build-feed.mjs', reason: 'build tool, not served content' },
      {
        path: 'models/pine.glb',
        reason: 'deliberately uncommitted, 2.2 MB — procedural trees stay',
      },
    ]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G19: polyfork collector stages kit .glb and excludes subdir test suites', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g19-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await setupPolyforkFixture(fixtureRoot, true);

    const kitDir = path.join(fixtureRoot, 'staging-polyfork', 'kit-medieval');
    await fs.mkdir(kitDir, { recursive: true });
    await fs.writeFile(
      path.join(kitDir, 'tavern.glb'),
      Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00])
    );
    await fs.writeFile(path.join(kitDir, 'test-tavern.mjs'), '// test\n');

    const res = runStage(['--root', fixtureRoot, '--bundle', 'staging-polyfork', '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);

    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.equal(
      manifest.files.some((f) => f.path === 'kit-medieval/tavern.glb'),
      true
    );
    assert.equal(
      manifest.files.some((f) => f.path === 'kit-medieval/test-tavern.mjs'),
      false
    );
    assert.ok(
      manifest.excluded.some(
        (e) =>
          e.path === 'kit-medieval/test-tavern.mjs' && e.reason === 'test suite, not served content'
      )
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G20: file hygiene: 47 unique names, 8 imports, zero banned terms, pinned as-true counts', async () => {
  const src = await fs.readFile(path.join(__dirname, 'test-stage-deploy.mjs'), 'utf8');
  const lines = src.split('\n');

  const names = [];
  for (const line of lines) {
    const m = line.match(/^test\('([^']+)'/);
    if (m) names.push(m[1]);
  }
  assert.equal(names.length, 57);
  assert.equal(new Set(names).size, 57);
  assert.equal(lines.filter((l) => l.startsWith('import ')).length, 8);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 0);
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 2);

  const mathRandomRe = new RegExp('Math' + '.random');
  assert.equal(lines.filter((l) => mathRandomRe.test(l)).length, 0);

  assert.equal(BANNED_TERM_RE.test(src), false);

  const stageSrc = await fs.readFile(STAGE_SCRIPT, 'utf8');
  assert.equal(BANNED_TERM_RE.test(stageSrc), false);
  assert.equal(new RegExp('\\bfet' + 'ch\\s*\\(').test(stageSrc), false);
});

test('G21: summary and manifest JSON shape exactness', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g21-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.deepEqual(Object.keys(summary), [
      'ok',
      'out',
      'bundle',
      'town_js_v',
      'staging_js_v',
      'file_count',
      'total_bytes',
    ]);

    const raw = await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8');
    assert.equal(raw.endsWith('\n'), true, 'MANIFEST.json must end with a newline');
    const manifest = JSON.parse(raw);
    assert.deepEqual(Object.keys(manifest.files[0]), ['path', 'bytes', 'sha256']);
    assert.equal(
      manifest.files.some((f) => f.path === 'MANIFEST.json'),
      false,
      'MANIFEST.json must not list itself in manifest.files'
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G22: duplicate flags last-wins, --verify ignores --bundle', async () => {
  const tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g22-a-'));
  try {
    const fixtureRoot = path.join(tmpDirA, 'repo');
    await setupPolyforkFixture(fixtureRoot, true);
    const outA = path.join(tmpDirA, 'outA');
    const outB = path.join(tmpDirA, 'outB');

    const res = runStage([
      '--root', fixtureRoot,
      '--bundle', 'town-3d',
      '--bundle', 'staging-polyfork',
      '--out', outA,
      '--out', outB,
    ]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.bundle, 'staging-polyfork', 'Later --bundle wins');
    assert.equal(summary.out, outB, 'Later --out wins');
    assert.equal(await pathExists(outA), false, 'First --out must never be created');
    assert.equal(
      await pathExists(path.join(outB, 'ghostlight-town', 'MANIFEST.json')),
      true
    );
  } finally {
    await fs.rm(tmpDirA, { recursive: true, force: true });
  }

  const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g22-b-'));
  try {
    const fixtureRoot = path.join(tmpDirB, 'repo');
    const outDir = path.join(tmpDirB, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const okVerify = runStage(['--verify', stagedDir, '--bundle', 'town-3d']);
    assert.equal(okVerify.status, 0, `Verify must ignore --bundle: ${okVerify.stderr}`);
    const report = JSON.parse(okVerify.stdout.trim());
    assert.equal(report.status, 'ok');

    const badVerify = runStage(['--verify', stagedDir, '--bundle', 'bogus']);
    assert.equal(badVerify.status, 1);
    assert.equal(badVerify.stdout, '');
    const errJson = JSON.parse(badVerify.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.equal(
      errJson.error,
      'Unknown bundle: bogus (expected one of: town-3d, staging-polyfork)'
    );
  } finally {
    await fs.rm(tmpDirB, { recursive: true, force: true });
  }
});

test('G23: version extraction edges, naive substring match', async () => {
  const htmlCases = [
    { html: '<script>import "./town.js?v=16&x=1";</script>\n', want: '16', name: 'ampersand' },
    { html: '<script>import "./town.js?v=16#frag";</script>\n', want: '16', name: 'hash' },
    { html: "<script src='town.js?v=16'></script>\n", want: '16', name: 'single-quote' },
    { html: '<script>import "./town.js?v=";</script>\n', want: null, name: 'empty' },
    { html: '<!-- town.js?v=77 -->\n', want: '77', name: 'comment' },
  ];
  for (const c of htmlCases) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g23-'));
    try {
      const fixtureRoot = path.join(tmpDir, 'repo');
      const outDir = path.join(tmpDir, 'out');
      await createFixtureTree(fixtureRoot);
      await fs.writeFile(path.join(fixtureRoot, 'town-3d', 'index.html'), c.html);

      const res = runStage(['--root', fixtureRoot, '--out', outDir]);
      assert.equal(res.status, 0, `Expected exit 0 for ${c.name}: ${res.stderr}`);
      const summary = JSON.parse(res.stdout.trim());
      assert.equal(summary.town_js_v, c.want, `Expected town_js_v ${c.want} for ${c.name}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  // ?v= in move-in.html only is ignored: only index.html is read for the version.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g23-movein-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.writeFile(
      path.join(fixtureRoot, 'town-3d', 'index.html'),
      '<script>import "./town.js";</script>\n'
    );
    await fs.writeFile(
      path.join(fixtureRoot, 'town-3d', 'move-in.html'),
      '<!-- town.js?v=77 -->\n'
    );

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0: ${res.stderr}`);
    const summary = JSON.parse(res.stdout.trim());
    assert.equal(summary.town_js_v, null);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G24: missing, symlinked, and wrong-type source errors', async () => {
  const tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g24-a-'));
  try {
    const fixtureRoot = path.join(tmpDirA, 'repo');
    const outDir = path.join(tmpDirA, 'out');
    await fs.mkdir(fixtureRoot, { recursive: true });

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.equal(errJson.error, 'Missing required source directory: town-3d');
    assert.equal(await pathExists(outDir), false);
  } finally {
    await fs.rm(tmpDirA, { recursive: true, force: true });
  }

  const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g24-b-'));
  try {
    const fixtureRoot = path.join(tmpDirB, 'repo');
    const outDir = path.join(tmpDirB, 'out');
    const realTree = path.join(tmpDirB, 'real');
    await createFixtureTree(realTree);
    await fs.mkdir(fixtureRoot, { recursive: true });
    await fs.symlink(path.join(realTree, 'town-3d'), path.join(fixtureRoot, 'town-3d'));

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.equal(errJson.error, 'Refusing symlink directory: town-3d');
    assert.equal(await pathExists(outDir), false);
  } finally {
    await fs.rm(tmpDirB, { recursive: true, force: true });
  }

  const tmpDirC = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g24-c-'));
  try {
    const fixtureRoot = path.join(tmpDirC, 'repo');
    const outDir = path.join(tmpDirC, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.rm(path.join(fixtureRoot, 'town-3d', 'models', 'bench.glb'));
    await fs.mkdir(path.join(fixtureRoot, 'town-3d', 'models', 'bench.glb'));

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.equal(errJson.error, 'Expected regular file: town-3d/models/bench.glb');
    assert.equal(await pathExists(outDir), false);
  } finally {
    await fs.rm(tmpDirC, { recursive: true, force: true });
  }

  const tmpDirD = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g24-d-'));
  try {
    const fixtureRoot = path.join(tmpDirD, 'repo');
    const outDir = path.join(tmpDirD, 'out');
    await createFixtureTree(fixtureRoot);
    await fs.rm(path.join(fixtureRoot, 'town-3d', 'models'), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, 'town-3d', 'models'), 'not a dir\n');

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.equal(errJson.error, 'Expected directory: town-3d/models');
    assert.equal(await pathExists(outDir), false);
  } finally {
    await fs.rm(tmpDirD, { recursive: true, force: true });
  }
});

test('G25: secret guard scope edges, basename-only and collection-only', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g25-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    // The filename guard tests the basename only: a suspect directory name is fine.
    await fs.mkdir(path.join(fixtureRoot, 'town-3d', 'gazette', 'token-vault'), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, 'town-3d', 'gazette', 'token-vault', 'note.txt'),
      'harmless\n'
    );
    // models/ only collects *.glb, so x.pem is never collected and never guarded:
    // skipped silently, not blocked and not listed as excluded.
    await fs.writeFile(path.join(fixtureRoot, 'town-3d', 'models', 'x.pem'), 'harmless\n');

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.equal(
      manifest.files.some((f) => f.path === 'gazette/token-vault/note.txt'),
      true
    );
    assert.equal(manifest.files.some((f) => f.path === 'models/x.pem'), false);
    assert.equal(manifest.excluded.some((e) => e.path === 'models/x.pem'), false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G26: collector selection edges', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g26-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    const town3d = path.join(fixtureRoot, 'town-3d');
    await fs.writeFile(path.join(town3d, 'models', 'readme.txt'), 'models readme\n');
    await fs.mkdir(path.join(town3d, 'gazette', 'sub'), { recursive: true });
    await fs.writeFile(path.join(town3d, 'gazette', 'sub', 'tool.mjs'), '// sub tool\n');
    await fs.writeFile(path.join(town3d, 'plots', 'milo', 'tool.mjs'), '// plot tool\n');
    await fs.writeFile(path.join(town3d, 'Concept-bandstand.js'), 'export const C = 1;\n');
    await fs.writeFile(path.join(town3d, 'concept-.js'), 'export const EMPTY = 1;\n');

    const res = runStage(['--root', fixtureRoot, '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    // Non-.glb files under models/ are skipped silently: not staged, not excluded.
    assert.equal(manifest.files.some((f) => f.path === 'models/readme.txt'), false);
    assert.equal(manifest.excluded.some((e) => e.path === 'models/readme.txt'), false);
    // The gazette .mjs exclusion is top-level only: a .mjs in a subdir stages.
    assert.equal(manifest.files.some((f) => f.path === 'gazette/sub/tool.mjs'), true);
    // plots/ has no .mjs exclusion at all.
    assert.equal(manifest.files.some((f) => f.path === 'plots/milo/tool.mjs'), true);
    // The concept-*.js match is case-sensitive.
    assert.equal(manifest.files.some((f) => f.path === 'Concept-bandstand.js'), false);
    assert.equal(manifest.excluded.some((e) => e.path === 'Concept-bandstand.js'), false);
    // concept-.js matches: .* may be empty.
    assert.equal(manifest.files.some((f) => f.path === 'concept-.js'), true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('G27: polyfork shared-fallback precedence, subdir README, polyfork symlink', async () => {
  const tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g27-a-'));
  try {
    const fixtureRoot = path.join(tmpDirA, 'repo');
    const outDir = path.join(tmpDirA, 'out');
    await setupPolyforkFixture(fixtureRoot, true);
    await fs.mkdir(path.join(fixtureRoot, 'staging-polyfork', 'plots', 'milo'), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, 'staging-polyfork', 'plots', 'milo', 'index.html'),
      '<p>polyfork milo</p>\n'
    );
    await fs.mkdir(path.join(fixtureRoot, 'staging-polyfork', 'kit'), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, 'staging-polyfork', 'kit', 'README.md'),
      '# kit docs\n'
    );

    const res = runStage(['--root', fixtureRoot, '--bundle', 'staging-polyfork', '--out', outDir]);
    assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    // A shared file present in staging-polyfork wins over the town-3d fallback.
    assert.equal(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'plots', 'milo', 'index.html'), 'utf8'),
      '<p>polyfork milo</p>\n'
    );
    // The README.md exclusion is the exact top-level path only: a kit README stages.
    assert.equal(manifest.files.some((f) => f.path === 'kit/README.md'), true);
  } finally {
    await fs.rm(tmpDirA, { recursive: true, force: true });
  }

  const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g27-b-'));
  try {
    const fixtureRoot = path.join(tmpDirB, 'repo');
    const outDir = path.join(tmpDirB, 'out');
    await setupPolyforkFixture(fixtureRoot, true);
    const realPoly = path.join(tmpDirB, 'real-poly');
    await fs.mkdir(realPoly, { recursive: true });
    await fs.rm(path.join(fixtureRoot, 'staging-polyfork'), { recursive: true });
    await fs.symlink(realPoly, path.join(fixtureRoot, 'staging-polyfork'));

    const res = runStage(['--root', fixtureRoot, '--bundle', 'staging-polyfork', '--out', outDir]);
    assert.equal(res.status, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.equal(errJson.error, 'Refusing symlink directory: staging-polyfork');
    assert.equal(await pathExists(outDir), false);
  } finally {
    await fs.rm(tmpDirB, { recursive: true, force: true });
  }
});

test('G28: --verify combined report and degenerate manifests', async () => {
  const tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g28-a-'));
  try {
    const fixtureRoot = path.join(tmpDirA, 'repo');
    const outDir = path.join(tmpDirA, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const townJs = path.join(stagedDir, 'town.js');
    const buf = await fs.readFile(townJs);
    buf[0] = buf[0] ^ 0xff;
    await fs.writeFile(townJs, buf);
    await fs.rm(path.join(stagedDir, 'CREDITS.md'));
    await fs.writeFile(path.join(stagedDir, 'gazette', 'stray.html'), '<p>stray</p>\n');

    const verifyRes = runStage(['--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.equal(report.checked, 10);
    assert.equal(report.ok, 8);
    assert.deepEqual(report.mismatch, ['town.js']);
    assert.deepEqual(report.missing, ['CREDITS.md']);
    assert.deepEqual(report.extra, ['gazette/stray.html']);
    assert.equal(report.town_js_v, '99');
  } finally {
    await fs.rm(tmpDirA, { recursive: true, force: true });
  }

  const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g28-b-'));
  try {
    const stagedDir = path.join(tmpDirB, 'empty-staged');
    await fs.mkdir(stagedDir, { recursive: true });
    await fs.writeFile(
      path.join(stagedDir, 'MANIFEST.json'),
      JSON.stringify({ files: [] }),
      'utf8'
    );

    const verifyRes = runStage(['--verify', stagedDir]);
    assert.equal(verifyRes.status, 0, `Expected exit 0: ${verifyRes.stderr}`);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'ok');
    assert.equal(report.checked, 0);
    assert.equal(report.ok, 0);
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
  } finally {
    await fs.rm(tmpDirB, { recursive: true, force: true });
  }

  const tmpDirC = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g28-c-'));
  try {
    const fixtureRoot = path.join(tmpDirC, 'repo');
    const outDir = path.join(tmpDirC, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifestPath = path.join(stagedDir, 'MANIFEST.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const townEntry = manifest.files.find((f) => f.path === 'town.js');
    // Keep only town.js on disk, so the single-entry manifest has no extras.
    for (const f of manifest.files) {
      if (f.path !== 'town.js') await fs.rm(path.join(stagedDir, f.path));
    }
    // readManifest requires path + sha256 only: a missing bytes field still verifies.
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ files: [{ path: 'town.js', sha256: townEntry.sha256 }] }),
      'utf8'
    );

    const verifyRes = runStage(['--verify', stagedDir]);
    assert.equal(verifyRes.status, 0, `Expected exit 0: ${verifyRes.stderr}`);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'ok');
    assert.equal(report.checked, 1);
    assert.equal(report.ok, 1);
  } finally {
    await fs.rm(tmpDirC, { recursive: true, force: true });
  }
});

test('G29: --verify version mirrors, polyfork and staged-index removal', async () => {
  const tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g29-a-'));
  try {
    const fixtureRoot = path.join(tmpDirA, 'repo');
    const outDir = path.join(tmpDirA, 'out');
    await setupPolyforkFixture(fixtureRoot, true);
    const stageRes = runStage(['--root', fixtureRoot, '--bundle', 'staging-polyfork', '--out', outDir]);
    assert.equal(stageRes.status, 0, `Expected exit 0, got ${stageRes.status}: ${stageRes.stderr}`);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const manifestPath = path.join(stagedDir, 'MANIFEST.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    delete manifest.staging_js_v;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const verifyRes = runStage(['--root', fixtureRoot, '--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.equal(report.bundle, 'staging-polyfork');
    assert.equal(report.checked, manifest.file_count);
    assert.equal(report.ok, manifest.file_count);
    assert.equal(report.staging_js_v, null);
    assert.equal(report.staged_staging_js_v, '41');
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
  } finally {
    await fs.rm(tmpDirA, { recursive: true, force: true });
  }

  const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g29-b-'));
  try {
    const fixtureRoot = path.join(tmpDirB, 'repo');
    const outDir = path.join(tmpDirB, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const stagedDir = path.join(outDir, 'ghostlight-town');
    const indexPath = path.join(stagedDir, 'index.html');
    const updatedHtml = (await fs.readFile(indexPath, 'utf8')).replace('town.js?v=99', 'town.js');
    await fs.writeFile(indexPath, updatedHtml, 'utf8');
    const manifestPath = path.join(stagedDir, 'MANIFEST.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const indexEntry = manifest.files.find((f) => f.path === 'index.html');
    indexEntry.sha256 = crypto.createHash('sha256').update(updatedHtml, 'utf8').digest('hex');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const verifyRes = runStage(['--verify', stagedDir]);
    assert.equal(verifyRes.status, 1);
    const report = JSON.parse(verifyRes.stdout.trim());
    assert.equal(report.status, 'fail');
    assert.equal(report.town_js_v, '99');
    assert.equal(report.staged_town_js_v, null);
    assert.deepEqual(report.mismatch, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.extra, []);
  } finally {
    await fs.rm(tmpDirB, { recursive: true, force: true });
  }
});

test('G30: re-stage drops removed files, exported collector API', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-deploy-g30-'));
  try {
    const fixtureRoot = path.join(tmpDir, 'repo');
    const outDir = path.join(tmpDir, 'out');
    await createFixtureTree(fixtureRoot);
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    await fs.rm(path.join(fixtureRoot, 'town-3d', 'concept-bandstand.js'));
    assert.equal(runStage(['--root', fixtureRoot, '--out', outDir]).status, 0);

    const manifest = JSON.parse(
      await fs.readFile(path.join(outDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.equal(manifest.files.some((f) => f.path === 'concept-bandstand.js'), false);
    assert.equal(
      await pathExists(path.join(outDir, 'ghostlight-town', 'concept-bandstand.js')),
      false
    );
    assert.equal(manifest.file_count, 9);

    const mod = await import(STAGE_SCRIPT);
    const listed = await mod.listStagedFiles(path.join(fixtureRoot, 'town-3d'));
    assert.deepEqual(listed, [
      'CREDITS.md',
      'gazette/issue-001.html',
      'guestbook/index.html',
      'index.html',
      'inn/index.html',
      'models/bench.glb',
      'move-in.html',
      'plots/milo/index.html',
      'town.js',
    ]);
    const collected = await mod.collectSourceFiles(fixtureRoot);
    assert.equal(collected.files.length, 9);
    assert.deepEqual(collected.excluded, [
      { path: 'gazette/build-feed.mjs', reason: 'build tool, not served content' },
    ]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
