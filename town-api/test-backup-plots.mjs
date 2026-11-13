/**
 * Ghostlight Town — town-api plots backup CLI tests (Slice 26)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_PLOTS_SCRIPT = path.join(__dirname, 'backup-plots.mjs');

async function runBackupPlotsCli(args, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BACKUP_PLOTS_SCRIPT, ...args], {
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function seedPlotsDir(plotsDir) {
  fs.mkdirSync(path.join(plotsDir, 'zeta'), { recursive: true });
  fs.mkdirSync(path.join(plotsDir, 'alpha', 'notes'), { recursive: true });

  const files = {
    'alpha/manifest.json': JSON.stringify({ handle: 'alpha', title: 'Alpha Desk' }),
    'alpha/desk-note.html': '<p>Rehearsal notes for tonight.</p>',
    'alpha/notes/cue.txt': 'Curtain up at 20:00.',
    'zeta/manifest.json': JSON.stringify({ handle: 'zeta', title: 'Zeta Corner' }),
    'zeta/desk-note.html': '<p>Quiet corner by the bandstand.</p>',
  };

  for (const [relPath, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(plotsDir, relPath), content, 'utf8');
  }

  return files;
}

test('backup of a seeded plots dir succeeds, outputs one JSON line, and matches sha256 for every file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    const seeded = seedPlotsDir(plotsDir);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1, 'Expected exactly one JSON line on stdout');
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^plots-\d{8}-\d{6}$/);
    assert.equal(payload.files, Object.keys(seeded).length);
    assert.deepEqual(payload.handles, ['alpha', 'zeta']);

    const snapshotDir = path.join(outDir, payload.backup);
    assert.ok(fs.existsSync(snapshotDir), 'Snapshot directory must exist');

    for (const relPath of Object.keys(seeded)) {
      const srcFile = path.join(plotsDir, relPath);
      const dstFile = path.join(snapshotDir, relPath);
      assert.ok(fs.existsSync(dstFile), `Snapshot missing ${relPath}`);
      assert.equal(sha256File(dstFile), sha256File(srcFile), `sha256 mismatch for ${relPath}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('two backups in the same second get distinct snapshot dir names and both are valid', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    const seeded = seedPlotsDir(plotsDir);

    // Align to the start of a UTC second so both invocations run in the same second.
    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 250) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - msIntoSecond + 15));
    }

    const res1 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    const res2 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);

    assert.equal(res1.code, 0, `First backup failed: ${res1.stderr}`);
    assert.equal(res2.code, 0, `Second backup failed: ${res2.stderr}`);

    const p1 = JSON.parse(res1.stdout.trim());
    const p2 = JSON.parse(res2.stdout.trim());

    assert.notEqual(p1.backup, p2.backup, 'Backups must have distinct directory names');
    assert.equal(p1.files, Object.keys(seeded).length);
    assert.equal(p2.files, Object.keys(seeded).length);
    assert.deepEqual(p1.handles, ['alpha', 'zeta']);
    assert.deepEqual(p2.handles, ['alpha', 'zeta']);

    for (const dirname of [p1.backup, p2.backup]) {
      const snapshotDir = path.join(outDir, dirname);
      assert.ok(fs.existsSync(snapshotDir), `${dirname} must exist`);
      for (const relPath of Object.keys(seeded)) {
        const dstFile = path.join(snapshotDir, relPath);
        assert.ok(fs.existsSync(dstFile), `${dirname} missing ${relPath}`);
        assert.equal(sha256File(dstFile), sha256File(path.join(plotsDir, relPath)));
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('missing plots dir exits 1 with JSON error and does not create out-dir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const missingPlotsDir = path.join(tmpDir, 'does-not-exist');
    const outDir = path.join(tmpDir, 'never-created-backups');

    const res = await runBackupPlotsCli(['--plots-dir', missingPlotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.ok(errPayload.error);
    assert.equal(fs.existsSync(outDir), false, 'out-dir must not be created when plots dir is missing');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('out-dir inside plots dir and plots dir inside out-dir both exit 1 with JSON error and create no snapshot', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    seedPlotsDir(plotsDir);

    const outInsidePlots = path.join(plotsDir, 'backups');
    const res1 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outInsidePlots]);
    assert.equal(res1.code, 1);
    assert.equal(res1.stdout.trim(), '');
    const err1 = JSON.parse(res1.stderr.trim());
    assert.equal(err1.status, 'error');
    assert.equal(fs.existsSync(outInsidePlots), false, 'nested out-dir must not be created');

    const nestedPlots = path.join(tmpDir, 'container', 'plots');
    seedPlotsDir(nestedPlots);
    const outContainingPlots = path.join(tmpDir, 'container');
    const beforeEntries = fs.readdirSync(outContainingPlots);
    const res2 = await runBackupPlotsCli(['--plots-dir', nestedPlots, '--out-dir', outContainingPlots]);
    assert.equal(res2.code, 1);
    assert.equal(res2.stdout.trim(), '');
    const err2 = JSON.parse(res2.stderr.trim());
    assert.equal(err2.status, 'error');
    assert.deepEqual(fs.readdirSync(outContainingPlots), beforeEntries, 'no snapshot may be created');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('symlink inside the plots tree exits 1 with JSON error and leaves no snapshot behind', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    const secretFile = path.join(tmpDir, 'outside.txt');
    fs.writeFileSync(secretFile, 'outside', 'utf8');
    seedPlotsDir(plotsDir);
    fs.symlinkSync(secretFile, path.join(plotsDir, 'alpha', 'link.txt'));
    fs.mkdirSync(outDir, { recursive: true });

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.match(errPayload.error, /symlink/i);
    assert.deepEqual(fs.readdirSync(outDir), [], 'partial snapshot must be deleted');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--help exits 0 and mentions --plots-dir and --out-dir', async () => {
  const res = await runBackupPlotsCli(['--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /--plots-dir/);
  assert.match(res.stdout, /--out-dir/);
});

test('out-dir is auto-created when nested path does not exist', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const nestedOutDir = path.join(tmpDir, 'nested', 'dir', 'backups');
    seedPlotsDir(plotsDir);

    assert.equal(fs.existsSync(nestedOutDir), false);
    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', nestedOutDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
    assert.equal(fs.existsSync(nestedOutDir), true);

    const payload = JSON.parse(res.stdout.trim());
    assert.ok(fs.existsSync(path.join(nestedOutDir, payload.backup)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('empty plots dir is a valid backup with files 0 and handles []', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'empty-plots');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(plotsDir, { recursive: true });

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.equal(payload.files, 0);
    assert.deepEqual(payload.handles, []);
    assert.ok(fs.existsSync(path.join(outDir, payload.backup)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('neither new file contains legacy gathering-place terminology', () => {
  const forbidden = ['camp', 'fire'].join('');
  for (const file of [BACKUP_PLOTS_SCRIPT, path.join(__dirname, 'test-backup-plots.mjs')]) {
    const content = fs.readFileSync(file, 'utf8').toLowerCase();
    assert.equal(content.includes(forbidden), false, `${path.basename(file)} must not contain "${forbidden}"`);
  }
});
