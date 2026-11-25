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

test('unknown argument exits 1 with JSON error and creates no out-dir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'never-created-backups');
    seedPlotsDir(plotsDir);

    const res = await runBackupPlotsCli(['--bogus', '--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, 'Unknown argument: --bogus');
    assert.equal(fs.existsSync(outDir), false, 'out-dir must not be created on unknown argument');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('missing flag value exits 1 with JSON error', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    seedPlotsDir(plotsDir);

    const res1 = await runBackupPlotsCli(['--plots-dir']);
    assert.equal(res1.code, 1);
    assert.equal(res1.stdout.trim(), '');
    const errLines1 = res1.stderr.trim().split('\n');
    assert.equal(errLines1.length, 1);
    const err1 = JSON.parse(errLines1[0]);
    assert.equal(err1.status, 'error');
    assert.equal(err1.error, 'Missing value for --plots-dir');

    const res2 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir']);
    assert.equal(res2.code, 1);
    assert.equal(res2.stdout.trim(), '');
    const errLines2 = res2.stderr.trim().split('\n');
    assert.equal(errLines2.length, 1);
    const err2 = JSON.parse(errLines2[0]);
    assert.equal(err2.status, 'error');
    assert.equal(err2.error, 'Missing value for --out-dir');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('source path that is a file, or a symlink to a dir, exits 1 with JSON error and creates no snapshot', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const regularFile = path.join(tmpDir, 'not-a-dir.txt');
    fs.writeFileSync(regularFile, 'hello', 'utf8');
    const outDirFile = path.join(tmpDir, 'backups-file');

    const resFile = await runBackupPlotsCli(['--plots-dir', regularFile, '--out-dir', outDirFile]);
    assert.equal(resFile.code, 1);
    assert.equal(resFile.stdout.trim(), '');
    const errLinesFile = resFile.stderr.trim().split('\n');
    assert.equal(errLinesFile.length, 1);
    const errFile = JSON.parse(errLinesFile[0]);
    assert.equal(errFile.status, 'error');
    assert.equal(errFile.error, 'Source plots path is not a directory');
    assert.equal(fs.existsSync(outDirFile), false, 'out-dir must not be created when plots path is a file');

    const realPlots = path.join(tmpDir, 'real-plots');
    seedPlotsDir(realPlots);
    const symlinkPlots = path.join(tmpDir, 'symlink-plots');
    fs.symlinkSync(realPlots, symlinkPlots);
    const outDirSymlink = path.join(tmpDir, 'backups-symlink');
    fs.mkdirSync(outDirSymlink, { recursive: true });

    const resSymlink = await runBackupPlotsCli(['--plots-dir', symlinkPlots, '--out-dir', outDirSymlink]);
    assert.equal(resSymlink.code, 1);
    assert.equal(resSymlink.stdout.trim(), '');
    const errLinesSymlink = resSymlink.stderr.trim().split('\n');
    assert.equal(errLinesSymlink.length, 1);
    const errSymlink = JSON.parse(errLinesSymlink[0]);
    assert.equal(errSymlink.status, 'error');
    assert.equal(errSymlink.error, 'Source plots directory must not be a symlink');
    assert.deepEqual(fs.readdirSync(outDirSymlink), [], 'no snapshot may be created for symlinked plots dir');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('top-level file in the plots dir is backed up but is not listed as a handle', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    const seeded = seedPlotsDir(plotsDir);
    const topFile = path.join(plotsDir, 'README.txt');
    fs.writeFileSync(topFile, 'top-level note\n', 'utf8');

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.files, Object.keys(seeded).length + 1);
    assert.deepEqual(payload.handles, ['alpha', 'zeta']);

    const backedUpTopFile = path.join(outDir, payload.backup, 'README.txt');
    assert.ok(fs.existsSync(backedUpTopFile), 'top-level file must exist in snapshot');
    assert.equal(sha256File(backedUpTopFile), sha256File(topFile));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('symlinked directory inside the plots tree exits 1 with JSON error and leaves no snapshot behind', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    const outsideDir = path.join(tmpDir, 'outside-dir');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'outside', 'utf8');
    seedPlotsDir(plotsDir);
    fs.symlinkSync(outsideDir, path.join(plotsDir, 'alpha', 'linkdir'));
    fs.mkdirSync(outDir, { recursive: true });
    const beforeEntries = fs.readdirSync(outDir);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.match(errPayload.error, /Symlink found in plots tree/);
    assert.deepEqual(fs.readdirSync(outDir), beforeEntries, 'no snapshot may be left behind');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('three backups in the same second get distinct -2 and -3 suffixes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);

    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 250) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - msIntoSecond + 15));
    }

    const res1 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    const res2 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    const res3 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);

    assert.equal(res1.code, 0, `First backup failed: ${res1.stderr}`);
    assert.equal(res2.code, 0, `Second backup failed: ${res2.stderr}`);
    assert.equal(res3.code, 0, `Third backup failed: ${res3.stderr}`);

    const p1 = JSON.parse(res1.stdout.trim());
    const p2 = JSON.parse(res2.stdout.trim());
    const p3 = JSON.parse(res3.stdout.trim());

    for (const p of [p1, p2, p3]) {
      assert.match(p.backup, /^plots-\d{8}-\d{6}(-\d+)?$/);
    }
    assert.ok(p2.backup.endsWith('-2'), `Expected second backup to end with -2, got ${p2.backup}`);
    assert.ok(p3.backup.endsWith('-3'), `Expected third backup to end with -3, got ${p3.backup}`);
    assert.equal(new Set([p1.backup, p2.backup, p3.backup]).size, 3);

    const srcManifest = path.join(plotsDir, 'alpha', 'manifest.json');
    for (const p of [p1, p2, p3]) {
      const snapshotDir = path.join(outDir, p.backup);
      assert.ok(fs.existsSync(snapshotDir), `${p.backup} must exist`);
      const dstManifest = path.join(snapshotDir, 'alpha', 'manifest.json');
      assert.ok(fs.existsSync(dstManifest), `${p.backup} missing alpha/manifest.json`);
      assert.equal(sha256File(dstManifest), sha256File(srcManifest));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function formatUtcTimestampLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

test('-h is identical to --help, and --help short-circuits by argument order', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const resHelp = await runBackupPlotsCli(['--help']);
    assert.equal(resHelp.code, 0);
    const resShort = await runBackupPlotsCli(['-h']);
    assert.equal(resShort.code, 0);
    assert.equal(resShort.stdout, resHelp.stdout);
    assert.match(resHelp.stdout, /--plots-dir/);
    assert.match(resHelp.stdout, /--out-dir/);
    assert.match(resShort.stdout, /--plots-dir/);
    assert.match(resShort.stdout, /--out-dir/);

    const plotsDir = path.join(tmpDir, 'plots');
    seedPlotsDir(plotsDir);
    const resFlagBeforeHelp = await runBackupPlotsCli(['--plots-dir', plotsDir, '--help']);
    assert.equal(resFlagBeforeHelp.code, 0);
    assert.match(resFlagBeforeHelp.stdout, /--plots-dir/);

    const resBogusBeforeHelp = await runBackupPlotsCli(['--bogus', '--help']);
    assert.equal(resBogusBeforeHelp.code, 1);
    assert.equal(resBogusBeforeHelp.stdout.trim(), '');
    const errLines = resBogusBeforeHelp.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, 'Unknown argument: --bogus');

    const resHelpBeforeBogus = await runBackupPlotsCli(['--help', '--bogus']);
    assert.equal(resHelpBeforeBogus.code, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TOWN_PLOTS_DIR env default is used, and an explicit --plots-dir flag overrides it', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const envDir = path.join(tmpDir, 'env-plots');
    const flagDir = path.join(tmpDir, 'flag-plots');
    const outDir1 = path.join(tmpDir, 'out-env');
    const outDir2 = path.join(tmpDir, 'out-flag');

    seedPlotsDir(envDir);
    fs.mkdirSync(path.join(envDir, 'envonly'), { recursive: true });
    fs.writeFileSync(path.join(envDir, 'envonly', 'x.txt'), 'env', 'utf8');
    seedPlotsDir(flagDir);

    const resEnv = await runBackupPlotsCli(['--out-dir', outDir1], { TOWN_PLOTS_DIR: envDir });
    assert.equal(resEnv.code, 0, `Expected exit 0, got ${resEnv.code}: ${resEnv.stderr}`);
    const payloadEnv = JSON.parse(resEnv.stdout.trim());
    assert.deepEqual(payloadEnv.handles, ['alpha', 'envonly', 'zeta']);
    assert.equal(payloadEnv.files, 6);

    const resFlag = await runBackupPlotsCli(['--plots-dir', flagDir, '--out-dir', outDir2], {
      TOWN_PLOTS_DIR: envDir,
    });
    assert.equal(resFlag.code, 0, `Expected exit 0, got ${resFlag.code}: ${resFlag.stderr}`);
    const payloadFlag = JSON.parse(resFlag.stdout.trim());
    assert.deepEqual(payloadFlag.handles, ['alpha', 'zeta']);
    assert.equal(payloadFlag.files, 5);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('the snapshot timestamp is the current UTC second', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);

    const before = Date.now();
    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    const after = Date.now();
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const match = payload.backup.match(/^plots-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    assert.ok(match, `Unexpected backup name: ${payload.backup}`);
    const [, y, m, d, hh, mm, ss] = match;
    const tsMs = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
    assert.ok(tsMs >= before - 1000 && tsMs <= after + 1000, `tsMs ${tsMs} outside [${before - 1000}, ${after + 1000}]`);
    assert.ok(Math.abs(tsMs - Date.now()) <= 2000, `tsMs ${tsMs} too far from now`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--plots-dir and --out-dir being the same path exits 1 with a JSON error and creates no snapshot', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    seedPlotsDir(plotsDir);
    const beforeEntries = fs.readdirSync(plotsDir);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', plotsDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, 'Output directory and plots directory must not contain each other');
    assert.equal(errPayload.plotsDir, plotsDir);
    assert.equal(errPayload.outDir, plotsDir);
    assert.deepEqual(fs.readdirSync(plotsDir), beforeEntries);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup fidelity: a binary file, a 3-level nested file, and an empty handle dir all survive exactly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    const seeded = seedPlotsDir(plotsDir);

    fs.writeFileSync(path.join(plotsDir, 'alpha', 'blob.bin'), crypto.randomBytes(1024));
    fs.mkdirSync(path.join(plotsDir, 'gamma', 'deep', 'deeper'), { recursive: true });
    fs.writeFileSync(path.join(plotsDir, 'gamma', 'deep', 'deeper', 'note.txt'), 'nested note', 'utf8');
    fs.mkdirSync(path.join(plotsDir, 'delta'), { recursive: true });

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.files, 7);
    assert.deepEqual(payload.handles, ['alpha', 'delta', 'gamma', 'zeta']);

    const snapshotDir = path.join(outDir, payload.backup);
    assert.equal(
      sha256File(path.join(snapshotDir, 'alpha', 'blob.bin')),
      sha256File(path.join(plotsDir, 'alpha', 'blob.bin'))
    );
    assert.equal(
      sha256File(path.join(snapshotDir, 'gamma', 'deep', 'deeper', 'note.txt')),
      sha256File(path.join(plotsDir, 'gamma', 'deep', 'deeper', 'note.txt'))
    );
    const deltaSnap = path.join(snapshotDir, 'delta');
    assert.ok(fs.existsSync(deltaSnap));
    assert.ok(fs.statSync(deltaSnap).isDirectory());
    assert.deepEqual(fs.readdirSync(deltaSnap), []);

    for (const relPath of Object.keys(seeded)) {
      assert.equal(
        sha256File(path.join(snapshotDir, relPath)),
        sha256File(path.join(plotsDir, relPath)),
        `sha256 mismatch for ${relPath}`
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pre-created snapshot dirs with the current timestamp force the -2 suffix', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);
    fs.mkdirSync(outDir, { recursive: true });

    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 250) {
      await new Promise((r) => setTimeout(r, 1000 - msIntoSecond + 15));
    }

    const now = new Date();
    const ts0 = formatUtcTimestampLocal(now);
    const ts1 = formatUtcTimestampLocal(new Date(now.getTime() + 1000));
    const pre0 = path.join(outDir, `plots-${ts0}`);
    const pre1 = path.join(outDir, `plots-${ts1}`);
    fs.mkdirSync(pre0);
    fs.mkdirSync(pre1);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.ok(payload.backup.endsWith('-2'), `Expected -2 suffix, got ${payload.backup}`);
    assert.equal(payload.files, 5);
    assert.ok(fs.existsSync(path.join(outDir, payload.backup, 'alpha', 'manifest.json')));
    assert.equal(fs.readdirSync(pre0).length, 0);
    assert.equal(fs.readdirSync(pre1).length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

async function runBackupPlotsCliInCwd(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BACKUP_PLOTS_SCRIPT, ...args], {
      env: { ...process.env },
      cwd,
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

test('relative --plots-dir and --out-dir resolve against the working directory', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    seedPlotsDir(path.join(tmpDir, 'plots'));

    const res = await runBackupPlotsCliInCwd(['--plots-dir', 'plots', '--out-dir', 'backups'], tmpDir);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.files, 5);
    assert.deepEqual(payload.handles, ['alpha', 'zeta']);
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'backups', payload.backup, 'alpha', 'manifest.json')),
      'Snapshot should exist under <tmp>/backups/<backup>/alpha/manifest.json'
    );
    assert.equal(
      fs.existsSync(path.join(tmpDir, payload.backup)),
      false,
      'No snapshot dir should exist directly under tmpDir'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('success payload has exactly the documented keys and stderr is empty', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1, 'Expected exactly one JSON line on stdout');
    const payload = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(payload), ['status', 'backup', 'files', 'handles']);
    assert.match(payload.backup, /^plots-\d{8}-\d{6}(-\d+)?$/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('missing plots dir error carries the resolved absolute plotsDir and exact keys', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const missingPlotsDir = path.join(tmpDir, 'does-not-exist');
    const outDir = path.join(tmpDir, 'never-created-backups');

    const res = await runBackupPlotsCli(['--plots-dir', missingPlotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.error, 'Source plots directory not found');
    assert.deepEqual(errPayload.plotsDir, missingPlotsDir);
    assert.deepEqual(Object.keys(errPayload), ['status', 'error', 'plotsDir']);
    assert.equal(fs.existsSync(outDir), false, 'out-dir must not be created');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--out-dir pointing at an existing regular file exits 1 with JSON error and leaves the file untouched', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    seedPlotsDir(plotsDir);
    const notADir = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(notADir, 'i am a file', 'utf8');

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', notADir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.match(errPayload.error, /Backup failed during copy/);
    assert.equal(fs.statSync(notADir).isFile(), true);
    assert.equal(fs.readFileSync(notADir, 'utf8'), 'i am a file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('duplicate --plots-dir flags: the last one wins', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsA = path.join(tmpDir, 'plots-a');
    const plotsB = path.join(tmpDir, 'plots-b');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsA);
    fs.mkdirSync(path.join(plotsB, 'onlybee'), { recursive: true });
    fs.writeFileSync(
      path.join(plotsB, 'onlybee', 'manifest.json'),
      JSON.stringify({ handle: 'onlybee' }),
      'utf8'
    );

    const res = await runBackupPlotsCli(['--plots-dir', plotsA, '--plots-dir', plotsB, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.deepEqual(payload.handles, ['onlybee']);
    assert.equal(payload.files, 1);
    const snapshotDir = path.join(outDir, payload.backup);
    assert.ok(fs.existsSync(path.join(snapshotDir, 'onlybee', 'manifest.json')));
    assert.equal(fs.existsSync(path.join(snapshotDir, 'alpha')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a pre-created regular file with the current timestamp name forces the -2 suffix and stays untouched', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);
    fs.mkdirSync(outDir, { recursive: true });

    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 250) {
      await new Promise((r) => setTimeout(r, 1000 - msIntoSecond + 15));
    }

    const ts = formatUtcTimestampLocal(new Date());
    const blockerFile = path.join(outDir, `plots-${ts}`);
    fs.writeFileSync(blockerFile, 'do not touch', 'utf8');

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.ok(payload.backup.endsWith('-2'), `Expected -2 suffix, got ${payload.backup}`);
    assert.equal(fs.statSync(blockerFile).isFile(), true);
    assert.equal(fs.readFileSync(blockerFile, 'utf8'), 'do not touch');

    const snapshotDir = path.join(outDir, payload.backup);
    assert.ok(fs.existsSync(path.join(snapshotDir, 'zeta', 'manifest.json')));
    assert.equal(
      sha256File(path.join(snapshotDir, 'alpha', 'manifest.json')),
      sha256File(path.join(plotsDir, 'alpha', 'manifest.json'))
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('four backups in the same second get distinct base, -2, -3, -4 suffixes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);

    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 250) {
      await new Promise((r) => setTimeout(r, 1000 - msIntoSecond + 15));
    }

    const res1 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    const res2 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    const res3 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    const res4 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);

    for (const [idx, res] of [res1, res2, res3, res4].entries()) {
      assert.equal(res.code, 0, `Backup ${idx + 1} failed: ${res.stderr}`);
    }

    const names = [res1, res2, res3, res4].map((r) => JSON.parse(r.stdout.trim()).backup);
    assert.equal(new Set(names).size, 4, `Expected 4 distinct names, got ${names.join(', ')}`);
    assert.match(names[0], /^plots-\d{8}-\d{6}$/);
    assert.equal(names[1], `${names[0]}-2`);
    assert.equal(names[2], `${names[0]}-3`);
    assert.equal(names[3], `${names[0]}-4`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pre-created <ts> and <ts>-2 snapshot dirs force the -3 suffix', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);
    fs.mkdirSync(outDir, { recursive: true });

    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 250) {
      await new Promise((r) => setTimeout(r, 1000 - msIntoSecond + 15));
    }

    const nowMs = Date.now();
    const ts0 = formatUtcTimestampLocal(new Date(nowMs));
    const ts1 = formatUtcTimestampLocal(new Date(nowMs + 1000));
    const preCreated = [
      path.join(outDir, `plots-${ts0}`),
      path.join(outDir, `plots-${ts0}-2`),
      path.join(outDir, `plots-${ts1}`),
      path.join(outDir, `plots-${ts1}-2`),
    ];
    for (const dir of preCreated) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.ok(payload.backup.endsWith('-3'), `Expected -3 suffix, got ${payload.backup}`);
    assert.ok(fs.existsSync(path.join(outDir, payload.backup, 'alpha', 'manifest.json')));
    for (const dir of preCreated) {
      assert.deepEqual(fs.readdirSync(dir), [], `Pre-created dir must stay empty: ${dir}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('empty-string flag values are treated as missing values', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    seedPlotsDir(plotsDir);

    const resPlots = await runBackupPlotsCli(['--plots-dir', '']);
    assert.equal(resPlots.code, 1);
    assert.equal(resPlots.stdout.trim(), '');
    const errPlotsLines = resPlots.stderr.trim().split('\n');
    assert.equal(errPlotsLines.length, 1);
    const errPlots = JSON.parse(errPlotsLines[0]);
    assert.equal(errPlots.status, 'error');
    assert.equal(errPlots.error, 'Missing value for --plots-dir');

    const resOut = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', '']);
    assert.equal(resOut.code, 1);
    assert.equal(resOut.stdout.trim(), '');
    const errOutLines = resOut.stderr.trim().split('\n');
    assert.equal(errOutLines.length, 1);
    const errOut = JSON.parse(errOutLines[0]);
    assert.equal(errOut.status, 'error');
    assert.equal(errOut.error, 'Missing value for --out-dir');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exact --help text matches the documented 6-line usage output', async () => {
  const res = await runBackupPlotsCli(['--help']);
  assert.equal(res.code, 0);
  assert.equal(res.stderr, '');
  const expected = [
    'Usage: node town-api/backup-plots.mjs [--plots-dir <path>] [--out-dir <dir>] [--help]',
    '',
    'Options:',
    '  --plots-dir <path>  Source plots directory (default: $TOWN_PLOTS_DIR or <town-api>/plots)',
    '  --out-dir <dir>     Output directory for backups (default: <town-api>/backups)',
    '  --help, -h          Show this help message and exit 0',
    '',
  ].join('\n');
  assert.equal(res.stdout, expected);
});

test('duplicate --out-dir flags: the last one wins', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const out1 = path.join(tmpDir, 'out-1');
    const out2 = path.join(tmpDir, 'out-2');
    seedPlotsDir(plotsDir);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', out1, '--out-dir', out2]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.ok(fs.existsSync(path.join(out2, payload.backup, 'alpha', 'manifest.json')));
    assert.equal(fs.existsSync(out1), false, 'First --out-dir must not be created');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('source-is-file and source-is-symlink errors carry resolved plotsDir and exact keys', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const regularFile = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(regularFile, 'plain file', 'utf8');
    const outMissing = path.join(tmpDir, 'out-missing');

    const resFile = await runBackupPlotsCli(['--plots-dir', regularFile, '--out-dir', outMissing]);
    assert.equal(resFile.code, 1);
    assert.equal(resFile.stdout.trim(), '');
    const errFileLines = resFile.stderr.trim().split('\n');
    assert.equal(errFileLines.length, 1);
    const errFile = JSON.parse(errFileLines[0]);
    assert.equal(errFile.error, 'Source plots path is not a directory');
    assert.deepEqual(Object.keys(errFile), ['status', 'error', 'plotsDir']);
    assert.equal(errFile.plotsDir, path.resolve(regularFile));
    assert.equal(fs.existsSync(outMissing), false);

    const realPlots = path.join(tmpDir, 'real-plots');
    seedPlotsDir(realPlots);
    const symlinkPlots = path.join(tmpDir, 'symlink-plots');
    fs.symlinkSync(realPlots, symlinkPlots, 'dir');
    const outEmpty = path.join(tmpDir, 'out-empty');
    fs.mkdirSync(outEmpty, { recursive: true });

    const resLink = await runBackupPlotsCli(['--plots-dir', symlinkPlots, '--out-dir', outEmpty]);
    assert.equal(resLink.code, 1);
    assert.equal(resLink.stdout.trim(), '');
    const errLinkLines = resLink.stderr.trim().split('\n');
    assert.equal(errLinkLines.length, 1);
    const errLink = JSON.parse(errLinkLines[0]);
    assert.equal(errLink.error, 'Source plots directory must not be a symlink');
    assert.deepEqual(Object.keys(errLink), ['status', 'error', 'plotsDir']);
    assert.equal(errLink.plotsDir, path.resolve(symlinkPlots));
    assert.deepEqual(fs.readdirSync(outEmpty), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Unix socket file in the plots tree fails with unsupported file type and leaves no snapshot', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  const plotsDir = path.join(tmpDir, 'plots');
  const outDir = path.join(tmpDir, 'backups');
  seedPlotsDir(plotsDir);

  const net = await import('node:net');
  const sockPath = path.join(plotsDir, 'alpha', 'sock');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sockPath, resolve);
  });

  try {
    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, `Backup failed during copy: Unsupported file type in plots tree: ${sockPath}`);
    assert.deepEqual(Object.keys(errPayload), ['status', 'error']);
    assert.equal(fs.existsSync(outDir), true);
    assert.deepEqual(fs.readdirSync(outDir), []);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('sibling out-dir sharing a name prefix is allowed', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'plots-backups');
    seedPlotsDir(plotsDir);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.files, 5);
    assert.deepEqual(payload.handles, ['alpha', 'zeta']);
    assert.ok(fs.existsSync(path.join(outDir, payload.backup, 'zeta', 'manifest.json')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exact symlink-in-tree copy error message and no snapshot left behind', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);
    fs.mkdirSync(outDir, { recursive: true });

    const outsideFile = path.join(tmpDir, 'outside.txt');
    fs.writeFileSync(outsideFile, 'outside', 'utf8');
    const linkPath = path.join(plotsDir, 'alpha', 'link.txt');
    fs.symlinkSync(outsideFile, linkPath);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, `Backup failed during copy: Symlink found in plots tree: ${linkPath}`);
    assert.deepEqual(Object.keys(errPayload), ['status', 'error']);
    assert.deepEqual(fs.readdirSync(outDir), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('empty TOWN_PLOTS_DIR falls back to the <town-api>/plots default', async () => {
  assert.equal(fs.existsSync(path.join(__dirname, 'plots')), false, 'Precondition: <town-api>/plots must not exist');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const outDir = path.join(tmpDir, 'backups');
    const res = await runBackupPlotsCli(['--out-dir', outDir], { TOWN_PLOTS_DIR: '' });
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.error, 'Source plots directory not found');
    assert.deepEqual(Object.keys(errPayload), ['status', 'error', 'plotsDir']);
    assert.equal(errPayload.plotsDir, path.join(__dirname, 'plots'));
    assert.equal(fs.existsSync(outDir), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('five backups in the same second get distinct base, -2, -3, -4, -5 suffixes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);

    const msIntoSecond = new Date().getMilliseconds();
    if (msIntoSecond > 150) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - msIntoSecond + 15));
    }

    const names = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
      assert.equal(res.code, 0, `Backup ${i + 1} failed: ${res.stderr}`);
      names.push(JSON.parse(res.stdout.trim()).backup);
    }

    assert.match(names[0], /^plots-\d{8}-\d{6}$/);
    assert.equal(names[1], `${names[0]}-2`);
    assert.equal(names[2], `${names[0]}-3`);
    assert.equal(names[3], `${names[0]}-4`);
    assert.equal(names[4], `${names[0]}-5`);
    assert.equal(new Set(names).size, 5);

    const srcHash = sha256File(path.join(plotsDir, 'alpha', 'manifest.json'));
    for (const name of names) {
      const snapshotDir = path.join(outDir, name);
      assert.ok(fs.existsSync(snapshotDir), `${name} must exist`);
      assert.equal(sha256File(path.join(snapshotDir, 'alpha', 'manifest.json')), srcHash);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pre-created <ts>, <ts>-2, and <ts>-3 snapshot dirs force the -4 suffix', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);
    fs.mkdirSync(outDir, { recursive: true });

    const msIntoSecond = new Date().getMilliseconds();
    if (msIntoSecond > 150) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - msIntoSecond + 15));
    }

    const now = new Date();
    const ts0 = formatUtcTimestampLocal(now);
    const ts1 = formatUtcTimestampLocal(new Date(now.getTime() + 1000));
    const preCreated = [
      path.join(outDir, `plots-${ts0}`),
      path.join(outDir, `plots-${ts0}-2`),
      path.join(outDir, `plots-${ts0}-3`),
      path.join(outDir, `plots-${ts1}`),
      path.join(outDir, `plots-${ts1}-2`),
      path.join(outDir, `plots-${ts1}-3`),
    ];
    for (const dir of preCreated) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
    const payload = JSON.parse(res.stdout.trim());
    assert.ok(payload.backup.endsWith('-4'), `Expected -4 suffix, got ${payload.backup}`);

    const snapshotDir = path.join(outDir, payload.backup);
    assert.ok(fs.existsSync(snapshotDir));
    assert.equal(
      sha256File(path.join(snapshotDir, 'alpha', 'manifest.json')),
      sha256File(path.join(plotsDir, 'alpha', 'manifest.json')),
    );
    for (const dir of preCreated) {
      assert.equal(fs.readdirSync(dir).length, 0);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pre-created <ts>-2 alone does not force a suffix: the base name is used', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);
    fs.mkdirSync(outDir, { recursive: true });

    const msIntoSecond = new Date().getMilliseconds();
    if (msIntoSecond > 150) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - msIntoSecond + 15));
    }

    const now = new Date();
    const ts0 = formatUtcTimestampLocal(now);
    const ts1 = formatUtcTimestampLocal(new Date(now.getTime() + 1000));
    const preCreated = [
      path.join(outDir, `plots-${ts0}-2`),
      path.join(outDir, `plots-${ts1}-2`),
    ];
    for (const dir of preCreated) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
    const payload = JSON.parse(res.stdout.trim());
    assert.match(payload.backup, /^plots-\d{8}-\d{6}$/);

    const snapshotDir = path.join(outDir, payload.backup);
    assert.ok(fs.existsSync(snapshotDir));
    assert.equal(
      sha256File(path.join(snapshotDir, 'alpha', 'manifest.json')),
      sha256File(path.join(plotsDir, 'alpha', 'manifest.json')),
    );
    for (const dir of preCreated) {
      assert.equal(fs.readdirSync(dir).length, 0);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('dangling symlink inside the plots tree fails with the exact copy error and leaves no snapshot', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);
    fs.mkdirSync(outDir, { recursive: true });

    const linkPath = path.join(plotsDir, 'alpha', 'link.txt');
    fs.symlinkSync(path.join(tmpDir, 'no-such-target.txt'), linkPath);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, `Backup failed during copy: Symlink found in plots tree: ${linkPath}`);
    assert.deepEqual(Object.keys(errPayload), ['status', 'error']);
    assert.deepEqual(fs.readdirSync(outDir), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('FIFO file in the plots tree fails with unsupported file type and leaves no snapshot', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);

    const fifoPath = path.join(plotsDir, 'alpha', 'pipe');
    await execFileAsync('mkfifo', [fifoPath]);

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, `Backup failed during copy: Unsupported file type in plots tree: ${fifoPath}`);
    assert.deepEqual(Object.keys(errPayload), ['status', 'error']);
    assert.equal(fs.existsSync(outDir), true);
    assert.deepEqual(fs.readdirSync(outDir), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('out-dir nested under an existing regular file fails during copy and leaves the file untouched', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    seedPlotsDir(plotsDir);

    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, 'do not move', 'utf8');
    const outDir = path.join(blocker, 'backups');

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.match(errPayload.error, /^Backup failed during copy: /);
    assert.deepEqual(Object.keys(errPayload), ['status', 'error']);
    assert.equal(fs.statSync(blocker).isFile(), true);
    assert.equal(fs.readFileSync(blocker, 'utf8'), 'do not move');
    assert.equal(fs.existsSync(outDir), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('containment errors carry exact keys and resolved absolute paths in both directions', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    seedPlotsDir(plotsDir);
    const outInside = path.join(plotsDir, 'backups');

    const res1 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outInside]);
    assert.equal(res1.code, 1);
    assert.equal(res1.stdout.trim(), '');
    const err1 = JSON.parse(res1.stderr.trim());
    assert.equal(err1.status, 'error');
    assert.equal(err1.error, 'Output directory and plots directory must not contain each other');
    assert.deepEqual(Object.keys(err1), ['status', 'error', 'plotsDir', 'outDir']);
    assert.equal(err1.plotsDir, path.resolve(plotsDir));
    assert.equal(err1.outDir, path.resolve(outInside));
    assert.equal(fs.existsSync(outInside), false);

    const container = path.join(tmpDir, 'container');
    const nestedPlots = path.join(container, 'plots');
    seedPlotsDir(nestedPlots);
    const beforeEntries = fs.readdirSync(container);

    const res2 = await runBackupPlotsCli(['--plots-dir', nestedPlots, '--out-dir', container]);
    assert.equal(res2.code, 1);
    assert.equal(res2.stdout.trim(), '');
    const err2 = JSON.parse(res2.stderr.trim());
    assert.equal(err2.status, 'error');
    assert.equal(err2.error, 'Output directory and plots directory must not contain each other');
    assert.deepEqual(Object.keys(err2), ['status', 'error', 'plotsDir', 'outDir']);
    assert.equal(err2.plotsDir, path.resolve(nestedPlots));
    assert.equal(err2.outDir, path.resolve(container));
    assert.deepEqual(fs.readdirSync(container), beforeEntries);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('unknown argument after valid flags and single-dash unknown both exit 1 with exact messages', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    seedPlotsDir(plotsDir);

    const res1 = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir, '--bogus']);
    assert.equal(res1.code, 1);
    assert.equal(res1.stdout.trim(), '');
    assert.equal(JSON.parse(res1.stderr.trim()).error, 'Unknown argument: --bogus');
    assert.equal(fs.existsSync(outDir), false);

    const res2 = await runBackupPlotsCli(['-x']);
    assert.equal(res2.code, 1);
    assert.equal(JSON.parse(res2.stderr.trim()).error, 'Unknown argument: -x');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('plots dir with only top-level files backs up the files and reports handles []', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plots-backup-'));
  try {
    const plotsDir = path.join(tmpDir, 'plots');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(plotsDir, { recursive: true });
    fs.writeFileSync(path.join(plotsDir, 'README.txt'), 'top-level note\n', 'utf8');
    fs.writeFileSync(path.join(plotsDir, 'notes.md'), '# notes\n', 'utf8');

    const res = await runBackupPlotsCli(['--plots-dir', plotsDir, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.files, 2);
    assert.deepEqual(payload.handles, []);

    const snapshotDir = path.join(outDir, payload.backup);
    for (const relPath of ['README.txt', 'notes.md']) {
      const dst = path.join(snapshotDir, relPath);
      assert.ok(fs.existsSync(dst), `Missing ${relPath}`);
      assert.equal(sha256File(dst), sha256File(path.join(plotsDir, relPath)));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('file hygiene: 47 unique names, 9 imports, zero banned terms, pinned as-true counts', () => {
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const lines = src.split('\n');

  const names = [];
  for (const line of lines) {
    const m = line.match(/^test\('([^']+)'/);
    if (m) names.push(m[1]);
  }
  assert.equal(names.length, 47);
  assert.equal(new Set(names).size, 47);

  const importLines = lines.filter((l) => l.startsWith('import '));
  assert.equal(importLines.length, 9);
  assert.deepEqual(importLines, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import crypto from 'node:crypto';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { execFile } from 'node:child_process';",
    "import { promisify } from 'node:util';",
    "import { fileURLToPath } from 'node:url';",
  ]);

  assert.equal(lines.filter((l) => l.includes('camp' + 'fire')).length, 0);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 10);
  assert.equal(lines.filter((l) => new RegExp('Math' + '.random').test(l)).length, 0);
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 0);
});
