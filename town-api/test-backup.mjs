/**
 * Ghostlight Town — town-api SQLite backup CLI tests (Slice 25)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { SCHEMA_TABLES } from './backup.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_SCRIPT = path.join(__dirname, 'backup.mjs');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

async function runBackupCli(args, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BACKUP_SCRIPT, ...args], {
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

function seedDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schemaSql);

  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO residents (handle, pubkey, origin, status, role, bio, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('alice', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'musebook', 'active', 'muse', 'Test resident', now);

  db.prepare(
    `INSERT INTO prompt_book (handle, kind, body, created_at)
     VALUES (?, ?, ?, ?)`
  ).run('alice', 'say', 'Testing the Bandstand acoustics.', now);

  db.prepare(
    `INSERT INTO footlights (handle, status_text, lit_at, expires_at, slot)
     VALUES (?, ?, ?, ?, ?)`
  ).run('alice', 'rehearsing', now, now + 2700, 0);

  const counts = {};
  for (const table of SCHEMA_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
    counts[table] = Number(row.count);
  }
  db.close();
  return counts;
}

test('backup of a seeded db succeeds, outputs one JSON line, and matches all table counts', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    const expectedCounts = seedDatabase(dbPath);

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1, 'Expected exactly one JSON line on stdout');
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^town-\d{8}-\d{6}\.db$/);
    assert.deepEqual(payload.tables, expectedCounts);

    const backupPath = path.join(outDir, payload.backup);
    assert.ok(fs.existsSync(backupPath), 'Backup file must exist');

    const backupDb = new DatabaseSync(backupPath, { readOnly: true });
    try {
      for (const table of SCHEMA_TABLES) {
        const row = backupDb.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
        assert.equal(Number(row.count), expectedCounts[table], `Row count mismatch for ${table}`);
      }
    } finally {
      backupDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('two backups in the same second get distinct filenames and both are valid', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    const expectedCounts = seedDatabase(dbPath);

    // Align to the start of a UTC second so both invocations run in the same second.
    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 250) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - msIntoSecond + 15));
    }

    const res1 = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    const res2 = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);

    assert.equal(res1.code, 0, `First backup failed: ${res1.stderr}`);
    assert.equal(res2.code, 0, `Second backup failed: ${res2.stderr}`);

    const p1 = JSON.parse(res1.stdout.trim());
    const p2 = JSON.parse(res2.stdout.trim());

    assert.notEqual(p1.backup, p2.backup, 'Backups must have distinct filenames');
    assert.deepEqual(p1.tables, expectedCounts);
    assert.deepEqual(p2.tables, expectedCounts);

    for (const filename of [p1.backup, p2.backup]) {
      const fullPath = path.join(outDir, filename);
      assert.ok(fs.existsSync(fullPath), `${filename} must exist`);
      const db = new DatabaseSync(fullPath, { readOnly: true });
      try {
        for (const table of SCHEMA_TABLES) {
          const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
          assert.equal(Number(row.count), expectedCounts[table]);
        }
      } finally {
        db.close();
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('missing source db exits 1 with JSON error and does not create out-dir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const missingDb = path.join(tmpDir, 'does-not-exist.db');
    const outDir = path.join(tmpDir, 'never-created-backups');

    const res = await runBackupCli(['--db', missingDb, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1);
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.ok(errPayload.error);
    assert.equal(fs.existsSync(outDir), false, 'out-dir must not be created when source db is missing');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--help exits 0 and mentions --db and --out-dir', async () => {
  const res = await runBackupCli(['--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /--db/);
  assert.match(res.stdout, /--out-dir/);
});

test('out-dir is auto-created when nested path does not exist', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const nestedOutDir = path.join(tmpDir, 'nested', 'dir', 'backups');
    seedDatabase(dbPath);

    assert.equal(fs.existsSync(nestedOutDir), false);
    const res = await runBackupCli(['--db', dbPath, '--out-dir', nestedOutDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
    assert.equal(fs.existsSync(nestedOutDir), true);

    const payload = JSON.parse(res.stdout.trim());
    assert.ok(fs.existsSync(path.join(nestedOutDir, payload.backup)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('neither new file contains legacy gathering-place terminology', () => {
  const forbidden = ['camp', 'fire'].join('');
  for (const file of [BACKUP_SCRIPT, path.join(__dirname, 'test-backup.mjs')]) {
    const content = fs.readFileSync(file, 'utf8').toLowerCase();
    assert.equal(content.includes(forbidden), false, `${path.basename(file)} must not contain "${forbidden}"`);
  }
});
