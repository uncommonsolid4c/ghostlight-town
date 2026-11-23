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

function formatUtcTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

test('unknown argument exits 1 with JSON error and empty stdout', async () => {
  const res = await runBackupCli(['--bogus']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout.trim(), '');

  const errLines = res.stderr.trim().split('\n');
  assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
  const errPayload = JSON.parse(errLines[0]);
  assert.equal(errPayload.status, 'error');
  assert.equal(errPayload.error, 'Unknown argument: --bogus');
});

test('missing value for --db exits 1 with JSON error and empty stdout', async () => {
  const res = await runBackupCli(['--db']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout.trim(), '');

  const errLines = res.stderr.trim().split('\n');
  assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
  const errPayload = JSON.parse(errLines[0]);
  assert.equal(errPayload.status, 'error');
  assert.equal(errPayload.error, 'Missing value for --db');
});

test('--db pointing at a directory exits 1 with JSON error and does not create out-dir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dirAsDb = path.join(tmpDir, 'dir-as-db');
    fs.mkdirSync(dirAsDb);
    const outDir = path.join(tmpDir, 'nested', 'never-created');

    const res = await runBackupCli(['--db', dirAsDb, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, 'Source database path is not a file');
    assert.equal(fs.existsSync(outDir), false, 'out-dir must not be created when --db is a directory');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--db pointing at a non-database file exits 1 with JSON error and leaves no backup file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const textFile = path.join(tmpDir, 'not-a-db.txt');
    fs.writeFileSync(textFile, 'plain text, not sqlite\n', 'utf8');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(outDir);

    const res = await runBackupCli(['--db', textFile, '--out-dir', outDir]);
    assert.equal(res.code, 1);

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.ok(
      errPayload.error.startsWith('Failed to read source database: '),
      `Unexpected error message: ${errPayload.error}`
    );
    assert.deepEqual(fs.readdirSync(outDir), [], 'out-dir must contain no backup file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('collision suffix advances to -3 when base and -2 already exist', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(outDir);
    const expectedCounts = seedDatabase(dbPath);

    const baseMs = Date.now();
    for (let offset = 0; offset <= 5; offset++) {
      const ts = formatUtcTimestamp(new Date(baseMs + offset * 1000));
      fs.writeFileSync(path.join(outDir, `town-${ts}.db`), '');
      fs.writeFileSync(path.join(outDir, `town-${ts}-2.db`), '');
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^town-\d{8}-\d{6}-3\.db$/);

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
test('backup preserves exact row content across seeded tables', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const backupDb = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const resident = backupDb
        .prepare('SELECT handle, pubkey, origin, role, bio FROM residents WHERE handle = ?')
        .get('alice');
      assert.deepEqual({ ...resident }, {
        handle: 'alice',
        pubkey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        origin: 'musebook',
        role: 'muse',
        bio: 'Test resident',
      });

      const promptRow = backupDb
        .prepare('SELECT handle, kind, body FROM prompt_book WHERE handle = ?')
        .get('alice');
      assert.deepEqual({ ...promptRow }, {
        handle: 'alice',
        kind: 'say',
        body: 'Testing the Bandstand acoustics.',
      });

      const footlight = backupDb
        .prepare('SELECT handle, status_text, slot FROM footlights WHERE handle = ?')
        .get('alice');
      assert.deepEqual({ ...footlight }, {
        handle: 'alice',
        status_text: 'rehearsing',
        slot: 0,
      });
    } finally {
      backupDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function seedEmptySchema(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schemaSql);

  const counts = {};
  for (const table of SCHEMA_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
    counts[table] = Number(row.count);
  }
  db.close();
  return counts;
}

test('missing value for --out-dir exits 1 with JSON error and empty stdout', async () => {
  const res = await runBackupCli(['--out-dir']);
  assert.equal(res.code, 1);
  assert.equal(res.stdout.trim(), '');

  const errLines = res.stderr.trim().split('\n');
  assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
  const errPayload = JSON.parse(errLines[0]);
  assert.equal(errPayload.status, 'error');
  assert.equal(errPayload.error, 'Missing value for --out-dir');
});

test('-h exits 0 and prints usage; --db ... --help exits 0 and creates nothing', async () => {
  const res1 = await runBackupCli(['-h']);
  assert.equal(res1.code, 0);
  const firstLine = res1.stdout.split('\n')[0];
  assert.equal(firstLine, 'Usage: node town-api/backup.mjs [--db <path>] [--out-dir <dir>] [--help]');
  assert.match(res1.stdout, /--db/);
  assert.match(res1.stdout, /--out-dir/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const neverDir = path.join(tmpDir, 'never-created-by-help');
    seedDatabase(dbPath);

    const res2 = await runBackupCli(['--db', dbPath, '--out-dir', neverDir, '--help']);
    assert.equal(res2.code, 0);
    assert.equal(fs.existsSync(neverDir), false, 'out-dir must not be created when --help is passed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TOWN_DB_PATH env is the default db; --db overrides it', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups-env');
    const outDir2 = path.join(tmpDir, 'backups-flag');
    const missingDbPath = path.join(tmpDir, 'missing-env.db');
    const expectedCounts = seedDatabase(dbPath);

    const res1 = await runBackupCli(['--out-dir', outDir], { TOWN_DB_PATH: dbPath });
    assert.equal(res1.code, 0, `Expected exit 0, got ${res1.code}: ${res1.stderr}`);
    const payload1 = JSON.parse(res1.stdout.trim());
    assert.deepEqual(payload1.tables, expectedCounts);

    const res2 = await runBackupCli(['--db', dbPath, '--out-dir', outDir2], {
      TOWN_DB_PATH: missingDbPath,
    });
    assert.equal(res2.code, 0, `Expected exit 0, got ${res2.code}: ${res2.stderr}`);
    const payload2 = JSON.parse(res2.stdout.trim());
    assert.deepEqual(payload2.tables, expectedCounts);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('success output shape: empty stderr, exact payload keys, current UTC timestamp', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const before = Date.now();
    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    const after = Date.now();

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
    assert.equal(res.stderr, '');

    const payload = JSON.parse(res.stdout.trim());
    assert.deepEqual(Object.keys(payload).sort(), ['backup', 'status', 'tables']);

    const match = payload.backup.match(/^town-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/);
    assert.ok(match, `Unexpected backup filename: ${payload.backup}`);
    const [, year, month, day, hour, minute, second] = match;
    const ts = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    assert.ok(
      ts >= before - 10000 && ts <= after + 10000,
      `Timestamp ${ts} not within 10s of [${before}, ${after}]`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--out-dir pointing at an existing file exits 1 with JSON error and leaves the file untouched', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    seedDatabase(dbPath);

    const fileAsOutDir = path.join(tmpDir, 'existing-file.txt');
    const knownContent = 'i am a file\n';
    fs.writeFileSync(fileAsOutDir, knownContent, 'utf8');

    const res = await runBackupCli(['--db', dbPath, '--out-dir', fileAsOutDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.ok(
      errPayload.error.startsWith('Backup failed during VACUUM INTO: '),
      `Unexpected error message: ${errPayload.error}`
    );

    assert.equal(fs.readFileSync(fileAsOutDir, 'utf8'), knownContent);
    const townFiles = fs.readdirSync(tmpDir).filter((name) => name.startsWith('town-'));
    assert.deepEqual(townFiles, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('empty-schema db backs up with true counts; 0-byte file fails cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'empty-schema.db');
    const outDir = path.join(tmpDir, 'backups-empty');
    const expectedCounts = seedEmptySchema(dbPath);

    const res1 = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res1.code, 0, `Expected exit 0, got ${res1.code}: ${res1.stderr}`);
    const payload = JSON.parse(res1.stdout.trim());
    assert.deepEqual(payload.tables, expectedCounts);

    const files1 = fs.readdirSync(outDir);
    assert.equal(files1.length, 1);
    assert.match(files1[0], /^town-\d{8}-\d{6}\.db$/);

    const zeroFile = path.join(tmpDir, 'zero.db');
    fs.writeFileSync(zeroFile, '');
    const freshOutDir = path.join(tmpDir, 'fresh-never-created');

    const res2 = await runBackupCli(['--db', zeroFile, '--out-dir', freshOutDir]);
    assert.equal(res2.code, 1);
    assert.equal(res2.stdout.trim(), '');

    const errLines = res2.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.ok(
      errPayload.error.startsWith('Failed to read source database: '),
      `Unexpected error message: ${errPayload.error}`
    );
    assert.equal(fs.existsSync(freshOutDir), false, 'fresh out-dir must not be created');
    assert.equal(fs.readdirSync(outDir).length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('--help wins over a later unknown argument, but an earlier unknown argument wins; --db consumes --help as its value', async () => {
  const resHelpFirst = await runBackupCli(['--help', '--bogus']);
  assert.equal(resHelpFirst.code, 0);
  assert.ok(
    resHelpFirst.stdout.startsWith('Usage: node town-api/backup.mjs'),
    `Unexpected stdout: ${resHelpFirst.stdout}`
  );

  const resUnknownFirst = await runBackupCli(['--bogus', '--help']);
  assert.equal(resUnknownFirst.code, 1);
  assert.equal(resUnknownFirst.stdout.trim(), '');
  const errLines1 = resUnknownFirst.stderr.trim().split('\n');
  assert.equal(errLines1.length, 1);
  const errPayload1 = JSON.parse(errLines1[0]);
  assert.equal(errPayload1.error, 'Unknown argument: --bogus');

  const resDbConsumesHelp = await runBackupCli(['--db', '--help']);
  assert.equal(resDbConsumesHelp.code, 1);
  assert.equal(resDbConsumesHelp.stdout.trim(), '');
  const errLines2 = resDbConsumesHelp.stderr.trim().split('\n');
  assert.equal(errLines2.length, 1);
  const errPayload2 = JSON.parse(errLines2[0]);
  assert.equal(errPayload2.error, 'Source database not found');
  assert.ok(
    errPayload2.db.endsWith('/--help'),
    `Expected db to end with /--help, got: ${errPayload2.db}`
  );
});

test('repeated --db and --out-dir flags: last wins', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbA = path.join(tmpDir, 'a.db');
    const dbB = path.join(tmpDir, 'b.db');
    const outX = path.join(tmpDir, 'out-x');
    const outY = path.join(tmpDir, 'out-y');

    seedDatabase(dbA);
    const expectedB = seedEmptySchema(dbB);

    const res = await runBackupCli(['--db', dbA, '--db', dbB, '--out-dir', outX, '--out-dir', outY]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]);
    assert.deepEqual(payload.tables, expectedB);
    assert.ok(fs.existsSync(path.join(outY, payload.backup)), 'Backup file must exist in outY');
    assert.equal(fs.existsSync(outX), false, 'outX must not be created');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('bare positional argument and --db= form are rejected as unknown arguments', async () => {
  const resPositional = await runBackupCli(['town.db']);
  assert.equal(resPositional.code, 1);
  assert.equal(resPositional.stdout.trim(), '');
  const errLines1 = resPositional.stderr.trim().split('\n');
  assert.equal(errLines1.length, 1);
  assert.equal(JSON.parse(errLines1[0]).error, 'Unknown argument: town.db');

  const resEquals = await runBackupCli(['--db=/tmp/x.db']);
  assert.equal(resEquals.code, 1);
  assert.equal(resEquals.stdout.trim(), '');
  const errLines2 = resEquals.stderr.trim().split('\n');
  assert.equal(errLines2.length, 1);
  assert.equal(JSON.parse(errLines2[0]).error, 'Unknown argument: --db=/tmp/x.db');
});

test('backup of a WAL-mode db with an open writer includes uncheckpointed rows and leaves the source bytes unchanged', async () => {
  const { createHash } = await import('node:crypto');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  let writer = null;
  try {
    const dbPath = path.join(tmpDir, 'wal-live.db');
    const outDir = path.join(tmpDir, 'backups');

    writer = new DatabaseSync(dbPath);
    writer.exec('PRAGMA journal_mode = WAL;');
    writer.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

    const now = Math.floor(Date.now() / 1000);
    writer
      .prepare(
        `INSERT INTO residents (handle, pubkey, origin, status, role, bio, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('alice', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'musebook', 'active', 'muse', 'Test resident', now);

    writer
      .prepare(
        `INSERT INTO prompt_book (handle, kind, body, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run('alice', 'say', 'Uncheckpointed WAL line.', now);

    const hashBefore = createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.tables.residents, 1);
    assert.equal(payload.tables.prompt_book, 1);
    assert.equal(payload.tables.meta, 1);

    const hashAfter = createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
    assert.equal(hashAfter, hashBefore, 'Source db file bytes must remain unchanged');

    const writerResidentCount = Number(writer.prepare('SELECT COUNT(*) AS count FROM residents').get().count);
    assert.equal(writerResidentCount, 1);

    const backupDb = new DatabaseSync(path.join(outDir, payload.backup), { readOnly: true });
    try {
      const backupPromptCount = Number(backupDb.prepare('SELECT COUNT(*) AS count FROM prompt_book').get().count);
      assert.equal(backupPromptCount, 1);
    } finally {
      backupDb.close();
    }
  } finally {
    if (writer) {
      writer.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SCHEMA_TABLES covers every table in schema.sql; backup verifies inn_claims and guestbook counts', async () => {
  const expectedNames = [
    'residents',
    'invitations',
    'prompt_book',
    'footlights',
    'presence',
    'key_history',
    'meta',
    'inn_claims',
    'guestbook',
    'fish_casts',
    'fish_catches',
  ];

  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const parsedTables = [...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(parsedTables, expectedNames);
  assert.deepEqual(SCHEMA_TABLES, expectedNames);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town-9.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const now = Math.floor(Date.now() / 1000);
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(
        `INSERT INTO inn_claims (room, handle, claimed_at, nights, expires_at, key_code, pubkey)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('lantern', 'alice', now, 2, now + 2 * 86400, 'abcdefghijkl', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');

      const insertGuestbook = db.prepare(
        `INSERT INTO guestbook (kind, name, body, plot, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      insertGuestbook.run('guestbook', 'Visitor One', 'Lovely town.', null, 'approved', now);
      insertGuestbook.run('letter', 'Visitor Two', 'Dear Milo, thanks.', 'wick', 'approved', now);
    } finally {
      db.close();
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const payload = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(payload.tables), expectedNames);
    assert.equal(payload.tables.inn_claims, 1);
    assert.equal(payload.tables.guestbook, 2);
    assert.equal(payload.tables.residents, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('TOWN_DB_PATH pointing at a missing file fails with the db path; empty TOWN_DB_PATH falls back to the default', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const missingPath = path.join(tmpDir, 'does-not-exist.db');
    const outDir = path.join(tmpDir, 'out-missing');
    const res1 = await runBackupCli(['--out-dir', outDir], { TOWN_DB_PATH: missingPath });
    assert.equal(res1.code, 1);
    assert.equal(res1.stdout.trim(), '');
    const errLines1 = res1.stderr.trim().split('\n');
    assert.equal(errLines1.length, 1);
    const errPayload1 = JSON.parse(errLines1[0]);
    assert.equal(errPayload1.error, 'Source database not found');
    assert.equal(errPayload1.db, missingPath);
    assert.equal(fs.existsSync(outDir), false);

    const outDir2 = path.join(tmpDir, 'out-empty-env');
    const res2 = await runBackupCli(['--out-dir', outDir2], { TOWN_DB_PATH: '' });
    assert.equal(res2.code, 1);
    assert.equal(res2.stdout.trim(), '');
    const errLines2 = res2.stderr.trim().split('\n');
    assert.equal(errLines2.length, 1);
    const errPayload2 = JSON.parse(errLines2[0]);
    assert.equal(errPayload2.error, 'Source database not found');
    assert.ok(
      errPayload2.db.endsWith('town-api/town.db'),
      `Expected db to end with town-api/town.db, got: ${errPayload2.db}`
    );
    assert.equal(fs.existsSync(outDir2), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
