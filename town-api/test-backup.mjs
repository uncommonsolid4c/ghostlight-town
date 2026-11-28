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

async function runBackupCli(args, env = {}, cwd = undefined) {
  try {
    const options = {
      env: { ...process.env, ...env },
    };
    if (cwd !== undefined) {
      options.cwd = cwd;
    }
    const { stdout, stderr } = await execFileAsync(process.execPath, [BACKUP_SCRIPT, ...args], options);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

function seedDatabase(dbPath, extra) {
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

  if (extra) extra(db, now);

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
    'garden_plants',
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


test('backup counts cover the six never-seeded tables (invitations, presence, key_history, fish_casts, fish_catches, garden_plants)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const now = Math.floor(Date.now() / 1000);
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(
        `INSERT INTO invitations (code, intended_handle, origin, created_by, used_by, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('INV-1', 'bob', 'musebook', 'alice', null, now + 3600, null);

      db.prepare(
        `INSERT INTO presence (handle, zone, updated_at)
         VALUES (?, ?, ?)`
      ).run('alice', 'bandstand', now);

      db.prepare(
        `INSERT INTO key_history (handle, pubkey, action, created_at, note)
         VALUES (?, ?, ?, ?, ?)`
      ).run('alice', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'register', now, 'initial key');

      db.prepare(
        `INSERT INTO fish_casts (handle, cast_at, reel_at)
         VALUES (?, ?, ?)`
      ).run('alice', now, now + 300);

      db.prepare(
        `INSERT INTO fish_catches (handle, kind, label, flavor, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('alice', 'boot', 'Old Boot', 'Waterlogged but dignified.', now);

      db.prepare(
        `INSERT INTO garden_plants (slot, handle, seed, planted_at)
         VALUES (?, ?, ?, ?)`
      ).run(2, 'alice', 'moonflower', now);
    } finally {
      db.close();
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.equal(payload.tables.invitations, 1);
    assert.equal(payload.tables.presence, 1);
    assert.equal(payload.tables.key_history, 1);
    assert.equal(payload.tables.fish_casts, 1);
    assert.equal(payload.tables.fish_catches, 1);
    assert.equal(payload.tables.garden_plants, 1);
    assert.equal(payload.tables.meta, 1);
    assert.equal(payload.tables.residents, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup preserves the exact schema (sqlite_master identical)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const srcDb = new DatabaseSync(dbPath, { readOnly: true });
    const dstDb = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const query = 'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name';
      const srcSchema = srcDb.prepare(query).all();
      const dstSchema = dstDb.prepare(query).all();
      assert.ok(srcSchema.length > 0);
      assert.deepEqual(dstSchema, srcSchema);
    } finally {
      srcDb.close();
      dstDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('out-dir name containing a single quote backs up successfully', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, "o'brien-backups");
    seedDatabase(dbPath);

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const files = fs.readdirSync(outDir);
    assert.equal(files.length, 1);
    assert.equal(files[0], payload.backup);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('collision suffix advances to -4 when base, -2 and -3 already exist', async () => {
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
      fs.writeFileSync(path.join(outDir, `town-${ts}-3.db`), '');
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^town-\d{8}-\d{6}-4\.db$/);

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

test('error payloads carry the resolved absolute db path', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const outDir = path.join(tmpDir, 'backups');

    const missingDb = path.join(tmpDir, 'missing.db');
    const resMissing = await runBackupCli(['--db', missingDb, '--out-dir', outDir]);
    assert.equal(resMissing.code, 1);
    const errMissing = JSON.parse(resMissing.stderr.trim());
    assert.equal(errMissing.db, missingDb);

    const dirDb = path.join(tmpDir, 'a-dir');
    fs.mkdirSync(dirDb);
    const resDir = await runBackupCli(['--db', dirDb, '--out-dir', outDir]);
    assert.equal(resDir.code, 1);
    const errDir = JSON.parse(resDir.stderr.trim());
    assert.equal(errDir.db, dirDb);

    const textFile = path.join(tmpDir, 'not-a-db.txt');
    fs.writeFileSync(textFile, 'not sqlite');
    const resBad = await runBackupCli(['--db', textFile, '--out-dir', outDir]);
    assert.equal(resBad.code, 1);
    const errBad = JSON.parse(resBad.stderr.trim());
    assert.equal(errBad.db, textFile);
    assert.ok(errBad.error.startsWith('Failed to read source database: '));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('error payload key sets are exactly {status, error} — plus db only for db errors', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const resUnknown = await runBackupCli(['--bogus']);
    assert.equal(resUnknown.code, 1);
    assert.deepEqual(Object.keys(JSON.parse(resUnknown.stderr.trim())).sort(), ['error', 'status']);

    const resMissingVal = await runBackupCli(['--db']);
    assert.equal(resMissingVal.code, 1);
    assert.deepEqual(Object.keys(JSON.parse(resMissingVal.stderr.trim())).sort(), ['error', 'status']);

    const missingDb = path.join(tmpDir, 'missing.db');
    const resMissingDb = await runBackupCli(['--db', missingDb, '--out-dir', path.join(tmpDir, 'backups')]);
    assert.equal(resMissingDb.code, 1);
    assert.deepEqual(Object.keys(JSON.parse(resMissingDb.stderr.trim())).sort(), ['db', 'error', 'status']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--help prints the exact full usage text', async () => {
  const expectedHelp =
    [
      'Usage: node town-api/backup.mjs [--db <path>] [--out-dir <dir>] [--help]',
      '',
      'Options:',
      '  --db <path>      Source SQLite database path (default: $TOWN_DB_PATH or <town-api>/town.db)',
      '  --out-dir <dir>  Output directory for backups (default: <town-api>/backups)',
      '  --help, -h       Show this help message and exit 0',
    ].join('\n') + '\n';

  const res = await runBackupCli(['--help']);
  assert.equal(res.code, 0);
  assert.equal(res.stdout, expectedHelp);
  assert.equal(res.stderr, '');
});

test('empty-string values for --db and --out-dir are missing values', async () => {
  const resDb = await runBackupCli(['--db', '']);
  assert.equal(resDb.code, 1);
  assert.equal(resDb.stdout.trim(), '');
  assert.equal(JSON.parse(resDb.stderr.trim()).error, 'Missing value for --db');

  const resOutDir = await runBackupCli(['--out-dir', '']);
  assert.equal(resOutDir.code, 1);
  assert.equal(resOutDir.stdout.trim(), '');
  assert.equal(JSON.parse(resOutDir.stderr.trim()).error, 'Missing value for --out-dir');
});

test('relative --db and --out-dir resolve against the process cwd', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const expectedCounts = seedDatabase(dbPath);

    const res = await runBackupCli(['--db', 'town.db', '--out-dir', 'backups'], {}, tmpDir);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.deepEqual(payload.tables, expectedCounts);
    assert.ok(fs.existsSync(path.join(tmpDir, 'backups', payload.backup)), 'Backup file must exist under <cwd>/backups');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a table outside SCHEMA_TABLES is not listed in payload.tables but its rows are still copied', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      db.exec('CREATE TABLE extra_notes (id INTEGER PRIMARY KEY, note TEXT);');
      db.prepare('INSERT INTO extra_notes (note) VALUES (?)').run('hello');
    } finally {
      db.close();
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal('extra_notes' in payload.tables, false);

    const backupDb = new DatabaseSync(path.join(outDir, payload.backup), { readOnly: true });
    try {
      const row = backupDb.prepare('SELECT COUNT(*) AS count FROM extra_notes').get();
      assert.equal(Number(row.count), 1);
    } finally {
      backupDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('collision suffix advances to -5 when base, -2, -3 and -4 already exist', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(outDir);
    const expectedCounts = seedDatabase(dbPath);

    const baseMs = Date.now();
    for (let offset = 0; offset <= 5; offset++) {
      const ts = formatUtcTimestamp(new Date(baseMs + offset * 1000));
      for (const s of ['', '-2', '-3', '-4']) {
        fs.writeFileSync(path.join(outDir, `town-${ts}${s}.db`), '');
      }
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^town-\d{8}-\d{6}-5\.db$/);

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

test('only the base name exists, so the collision suffix is exactly -2', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(outDir);
    seedDatabase(dbPath);

    const baseMs = Date.now();
    for (let offset = 0; offset <= 5; offset++) {
      const ts = formatUtcTimestamp(new Date(baseMs + offset * 1000));
      fs.writeFileSync(path.join(outDir, `town-${ts}.db`), '');
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^town-\d{8}-\d{6}-2\.db$/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('db missing the meta table fails cleanly with no out-dir created', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'never-created-backups');
    seedDatabase(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      db.exec('DROP TABLE meta;');
    } finally {
      db.close();
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.ok(
      errPayload.error.startsWith('Failed to read source database: '),
      `Unexpected error message: ${errPayload.error}`
    );
    assert.ok(
      errPayload.error.includes('no such table: meta'),
      `Expected missing meta table detail, got: ${errPayload.error}`
    );
    assert.equal(errPayload.db, dbPath);
    assert.equal(fs.existsSync(outDir), false, 'out-dir must not be created when source db is missing meta');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup db journal_mode is delete while the source is wal, with no sidecar files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const src = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.equal(src.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    } finally {
      src.close();
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const dst = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(dst.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    } finally {
      dst.close();
    }

    const sidecars = fs.readdirSync(outDir).filter((n) => n.endsWith('-wal') || n.endsWith('-shm'));
    assert.deepEqual(sidecars, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup preserves the meta row content exactly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const dst = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const rows = dst
        .prepare('SELECT key, value FROM meta ORDER BY key')
        .all()
        .map((r) => ({ ...r }));
      assert.deepEqual(rows, [{ key: 'state_seq', value: '0' }]);
    } finally {
      dst.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup preserves unicode, emoji, and quote characters byte-exact', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    const fancyBody = 'Lamplight ✨ — “quoted” & \'single\' <tag> & emoji 🏮\nsecond line';
    const fancyBio = 'Keeper of the 🏮 lanterns — naïve café ☕';

    seedDatabase(dbPath, (db, now) => {
      db.prepare("UPDATE residents SET bio = ? WHERE handle = 'alice'").run(fancyBio);
      db.prepare("UPDATE prompt_book SET body = ? WHERE handle = 'alice'").run(fancyBody);
    });

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const dst = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const resident = dst.prepare("SELECT bio FROM residents WHERE handle = 'alice'").get();
      const promptRow = dst.prepare("SELECT body FROM prompt_book WHERE handle = 'alice'").get();
      assert.equal(resident.bio, fancyBio);
      assert.equal(promptRow.body, fancyBody);
    } finally {
      dst.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('out-dir nested under an existing file fails during VACUUM INTO and leaves the file untouched', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    seedDatabase(dbPath);

    const blocker = path.join(tmpDir, 'blocker.txt');
    fs.writeFileSync(blocker, 'i am a file\n');
    const outDir = path.join(blocker, 'backups');

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
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

    assert.equal(fs.readFileSync(blocker, 'utf8'), 'i am a file\n');
    assert.deepEqual(
      fs.readdirSync(tmpDir).filter((name) => name.startsWith('town-')),
      []
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('-h prints the exact full usage text', async () => {
  const expectedHelp =
    [
      'Usage: node town-api/backup.mjs [--db <path>] [--out-dir <dir>] [--help]',
      '',
      'Options:',
      '  --db <path>      Source SQLite database path (default: $TOWN_DB_PATH or <town-api>/town.db)',
      '  --out-dir <dir>  Output directory for backups (default: <town-api>/backups)',
      '  --help, -h       Show this help message and exit 0',
    ].join('\n') + '\n';

  const res = await runBackupCli(['-h']);
  assert.equal(res.code, 0);
  assert.equal(res.stdout, expectedHelp);
  assert.equal(res.stderr, '');
});

test('spaces in db and out-dir paths, and a trailing slash on out-dir', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight backup-'));
  try {
    const dbPath = path.join(tmpDir, 'my town.db');
    const outDir = path.join(tmpDir, 'my backups') + path.sep;
    seedDatabase(dbPath);

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(fs.existsSync(path.join(tmpDir, 'my backups', payload.backup)), true);
    assert.deepEqual(fs.readdirSync(path.join(tmpDir, 'my backups')), [payload.backup]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('unrelated file already in out-dir survives the backup untouched', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(outDir);
    seedDatabase(dbPath);

    const keeper = path.join(outDir, 'keep-me.txt');
    fs.writeFileSync(keeper, 'do not touch\n');

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(fs.readFileSync(keeper, 'utf8'), 'do not touch\n');
    assert.deepEqual(fs.readdirSync(outDir).sort(), ['keep-me.txt', payload.backup].sort());
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('collision suffix fills the -2 gap when base and -3 already exist', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(outDir);
    const expectedCounts = seedDatabase(dbPath);

    // Align to the start of a UTC second so the backup lands in the window.
    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 250) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - msIntoSecond + 15));
    }

    const baseMs = Date.now();
    for (let offset = 0; offset <= 5; offset++) {
      const ts = formatUtcTimestamp(new Date(baseMs + offset * 1000));
      fs.writeFileSync(path.join(outDir, `town-${ts}.db`), '');
      fs.writeFileSync(path.join(outDir, `town-${ts}-3.db`), '');
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^town-\d{8}-\d{6}-2\.db$/);
    assert.deepEqual(payload.tables, expectedCounts);

    const backupPath = path.join(outDir, payload.backup);
    assert.ok(fs.existsSync(backupPath), 'Backup file must exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('only the -2 file exists, so the collision suffix is skipped and the base name is used', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(outDir);
    seedDatabase(dbPath);

    const msIntoSecond = Date.now() % 1000;
    if (msIntoSecond > 250) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - msIntoSecond + 15));
    }

    const baseMs = Date.now();
    for (let offset = 0; offset <= 5; offset++) {
      const ts = formatUtcTimestamp(new Date(baseMs + offset * 1000));
      fs.writeFileSync(path.join(outDir, `town-${ts}-2.db`), '');
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^town-\d{8}-\d{6}\.db$/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('multi-row backup reports exact counts for every seeded table', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    const expectedCounts = seedDatabase(dbPath, (db, now) => {
      const insertResident = db.prepare(
        `INSERT INTO residents (handle, pubkey, origin, status, role, bio, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      insertResident.run('bob', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=', 'colony', 'active', 'muse', 'Bob', now);
      insertResident.run('carol', 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=', 'rstation', 'active', 'muse', 'Carol', now);

      const insertSay = db.prepare(
        `INSERT INTO prompt_book (handle, kind, body, created_at) VALUES (?, ?, ?, ?)`
      );
      insertSay.run('bob', 'say', 'Bob line one.', now);
      insertSay.run('bob', 'emote', 'waves.', now);
      insertSay.run('carol', 'say', 'Carol line one.', now);
      insertSay.run('carol', 'say', 'Carol line two.', now);

      db.prepare(
        `INSERT INTO footlights (handle, status_text, lit_at, expires_at, slot)
         VALUES (?, ?, ?, ?, ?)`
      ).run('bob', 'tending lamps', now, now + 2700, 1);

      const insertInvite = db.prepare(
        `INSERT INTO invitations (code, intended_handle, origin, created_by, used_by, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      insertInvite.run('INV-A', 'dave', 'musebook', 'alice', null, now + 3600, null);
      insertInvite.run('INV-B', 'erin', 'colony', 'alice', null, now + 3600, null);
    });

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.deepEqual(payload.tables, expectedCounts);
    assert.equal(payload.tables.residents, 3);
    assert.equal(payload.tables.prompt_book, 5);
    assert.equal(payload.tables.footlights, 2);
    assert.equal(payload.tables.invitations, 2);
    assert.equal(payload.tables.meta, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup preserves a 100,000-character prompt book body byte-exact', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    const bigBody = 'x'.repeat(100000);
    seedDatabase(dbPath, (db) => {
      db.prepare("UPDATE prompt_book SET body = ? WHERE handle = 'alice'").run(bigBody);
    });

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const backupDb = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const row = backupDb.prepare("SELECT body FROM prompt_book WHERE handle = 'alice'").get();
      assert.equal(row.body, bigBody);
      assert.equal(row.body.length, 100000);
    } finally {
      backupDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup preserves NULL invitation columns (used_by, used_at)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath, (db, now) => {
      db.prepare(
        `INSERT INTO invitations (code, intended_handle, origin, created_by, used_by, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('INV-NULL', 'fran', 'guestbook', 'alice', null, now + 3600, null);
    });

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.tables.invitations, 1);

    const backupDb = new DatabaseSync(path.join(outDir, payload.backup), { readOnly: true });
    try {
      const row = backupDb
        .prepare('SELECT used_by, used_at FROM invitations WHERE code = ?')
        .get('INV-NULL');
      assert.equal(row.used_by, null);
      assert.equal(row.used_at, null);
    } finally {
      backupDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup preserves an extra meta key alongside state_seq', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath, (db) => {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('backup_probe', 'yes');
    });

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const backupDb = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const rows = backupDb
        .prepare('SELECT key, value FROM meta ORDER BY key')
        .all()
        .map((r) => ({ ...r }));
      assert.deepEqual(rows, [
        { key: 'backup_probe', value: 'yes' },
        { key: 'state_seq', value: '0' },
      ]);
    } finally {
      backupDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup preserves a custom index in sqlite_master', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath, (db) => {
      db.exec('CREATE INDEX idx_backup_probe_handle ON residents(handle);');
    });

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const backupDb = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const row = backupDb
        .prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('idx_backup_probe_handle');
      assert.ok(row, 'Custom index must survive in the backup');
      assert.equal(row.type, 'index');
      assert.equal(row.tbl_name, 'residents');
    } finally {
      backupDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--db pointing at a dangling symlink fails as not found with the symlink path', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const missingTarget = path.join(tmpDir, 'never-there.db');
    const linkPath = path.join(tmpDir, 'link.db');
    fs.symlinkSync(missingTarget, linkPath);
    const outDir = path.join(tmpDir, 'never-created-backups');

    const res = await runBackupCli(['--db', linkPath, '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, 'Source database not found');
    assert.equal(errPayload.db, linkPath);
    assert.equal(fs.existsSync(outDir), false, 'out-dir must not be created when --db is a dangling symlink');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup file starts with the SQLite format 3 header', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const header = fs.readFileSync(path.join(outDir, payload.backup)).subarray(0, 16);
    assert.equal(header.toString('latin1'), 'SQLite format 3\0');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('VACUUM INTO failure error payload keys are exactly {status, error}', async () => {
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
    assert.deepEqual(Object.keys(errPayload).sort(), ['error', 'status']);
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

test('collision suffix advances to -6 when base, -2, -3, -4 and -5 already exist', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(outDir);
    const expectedCounts = seedDatabase(dbPath);

    const baseMs = Date.now();
    for (let offset = 0; offset <= 5; offset++) {
      const ts = formatUtcTimestamp(new Date(baseMs + offset * 1000));
      for (const s of ['', '-2', '-3', '-4', '-5']) {
        fs.writeFileSync(path.join(outDir, `town-${ts}${s}.db`), '');
      }
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^town-\d{8}-\d{6}-6\.db$/);

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

test('pre-existing files for other timestamps do not affect naming', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    fs.mkdirSync(outDir);
    seedDatabase(dbPath);

    const nowMs = Date.now();
    for (const offset of [-30, -20, -10, 10, 20, 30]) {
      const ts = formatUtcTimestamp(new Date(nowMs + offset * 1000));
      fs.writeFileSync(path.join(outDir, `town-${ts}.db`), '');
      fs.writeFileSync(path.join(outDir, `town-${ts}-2.db`), '');
    }
    fs.writeFileSync(path.join(outDir, 'town-other.db'), '');
    fs.writeFileSync(path.join(outDir, 'keep.txt'), 'do not touch\n');

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.match(payload.backup, /^town-\d{8}-\d{6}\.db$/);
    assert.ok(fs.existsSync(path.join(outDir, payload.backup)), 'Backup file must exist');
    assert.equal(fs.readFileSync(path.join(outDir, 'keep.txt'), 'utf8'), 'do not touch\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--db with --help and --out-dir with --help print usage and create nothing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const neverDir = path.join(tmpDir, 'never-created-by-help');
    const neverDir2 = path.join(tmpDir, 'never-created-by-help-2');
    seedDatabase(dbPath);

    const res1 = await runBackupCli(['--db', dbPath, '--help']);
    assert.equal(res1.code, 0);
    assert.ok(
      res1.stdout.startsWith('Usage: node town-api/backup.mjs'),
      `Unexpected stdout: ${res1.stdout}`
    );
    assert.equal(res1.stderr, '');

    const res2 = await runBackupCli(['--db', dbPath, '--out-dir', neverDir, '--help']);
    assert.equal(res2.code, 0);
    assert.equal(fs.existsSync(neverDir), false, 'out-dir must not be created when --help is passed');

    const res3 = await runBackupCli(['--out-dir', neverDir2, '--help']);
    assert.equal(res3.code, 0);
    assert.ok(
      res3.stdout.startsWith('Usage: node town-api/backup.mjs'),
      `Unexpected stdout: ${res3.stdout}`
    );
    assert.equal(fs.existsSync(neverDir2), false, 'out-dir must not be created when --help is passed');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('unknown argument after a valid --db errors and creates nothing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const neverDir = path.join(tmpDir, 'never-created');
    seedDatabase(dbPath);

    const res = await runBackupCli(['--db', dbPath, '--bogus', '--out-dir', neverDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, 'Unknown argument: --bogus');
    assert.equal(fs.existsSync(neverDir), false, 'out-dir must not be created on an unknown-argument error');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--db consumes the next flag as its value, so the out-dir path is the unknown argument', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const outDir = path.join(tmpDir, 'backups');

    const res = await runBackupCli(['--db', '--out-dir', outDir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout.trim(), '');

    const errLines = res.stderr.trim().split('\n');
    assert.equal(errLines.length, 1, 'Expected exactly one JSON line on stderr');
    const errPayload = JSON.parse(errLines[0]);
    assert.equal(errPayload.status, 'error');
    assert.equal(errPayload.error, `Unknown argument: ${path.resolve(outDir)}`);
    assert.equal(fs.existsSync(outDir), false, 'out-dir must not be created when --db consumes --out-dir');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('success payload tables keys are exactly SCHEMA_TABLES in order', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    const expectedCounts = seedDatabase(dbPath);

    assert.equal(SCHEMA_TABLES.length, 12);

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.deepEqual(Object.keys(payload.tables), SCHEMA_TABLES);
    assert.deepEqual(payload.tables, expectedCounts);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup preserves PRAGMA user_version and application_id', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath, (db) => {
      db.exec('PRAGMA user_version = 7;');
      db.exec('PRAGMA application_id = 12345;');
    });

    const src = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.equal(src.prepare('PRAGMA user_version').get().user_version, 7);
      assert.equal(src.prepare('PRAGMA application_id').get().application_id, 12345);
    } finally {
      src.close();
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const dst = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(dst.prepare('PRAGMA user_version').get().user_version, 7);
      assert.equal(dst.prepare('PRAGMA application_id').get().application_id, 12345);
    } finally {
      dst.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup preserves a view and a trigger in sqlite_master', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath, (db) => {
      db.exec('CREATE VIEW v_resident_says AS SELECT handle, body FROM prompt_book;');
      db.exec('CREATE TRIGGER trg_pb_after_insert AFTER INSERT ON prompt_book BEGIN SELECT 1; END;');
    });

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const backupDb = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const view = backupDb
        .prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE type = 'view' AND name = ?")
        .get('v_resident_says');
      assert.ok(view, 'View must survive in the backup');
      assert.equal(view.type, 'view');
      assert.equal(view.tbl_name, 'v_resident_says');

      const trigger = backupDb
        .prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .get('trg_pb_after_insert');
      assert.ok(trigger, 'Trigger must survive in the backup');
      assert.equal(trigger.type, 'trigger');
      assert.equal(trigger.tbl_name, 'prompt_book');

      const viewRow = backupDb
        .prepare("SELECT body FROM v_resident_says WHERE handle = 'alice'")
        .get();
      assert.equal(viewRow.body, 'Testing the Bandstand acoustics.');
    } finally {
      backupDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup passes integrity_check and keeps the source page_size', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath);

    const src = new DatabaseSync(dbPath, { readOnly: true });
    let srcPageSize;
    try {
      srcPageSize = src.prepare('PRAGMA page_size').get().page_size;
    } finally {
      src.close();
    }

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    const backupPath = path.join(outDir, payload.backup);

    const dst = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(dst.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(dst.prepare('PRAGMA page_size').get().page_size, srcPageSize);
    } finally {
      dst.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup of 1000 prompt_book rows reports exact counts and keeps first/last bodies', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-backup-'));
  try {
    const dbPath = path.join(tmpDir, 'town.db');
    const outDir = path.join(tmpDir, 'backups');
    seedDatabase(dbPath, (db, now) => {
      const insertSay = db.prepare(
        'INSERT INTO prompt_book (handle, kind, body, created_at) VALUES (?, ?, ?, ?)'
      );
      for (let i = 0; i < 999; i++) {
        insertSay.run('alice', 'say', `Line ${i}.`, now);
      }
    });

    const res = await runBackupCli(['--db', dbPath, '--out-dir', outDir]);
    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);

    const payload = JSON.parse(res.stdout.trim());
    assert.equal(payload.status, 'ok');
    assert.equal(payload.tables.prompt_book, 1000);

    const backupDb = new DatabaseSync(path.join(outDir, payload.backup), { readOnly: true });
    try {
      const first = backupDb
        .prepare('SELECT body FROM prompt_book ORDER BY rowid ASC LIMIT 1')
        .get();
      assert.equal(first.body, 'Testing the Bandstand acoustics.');
      const last = backupDb
        .prepare('SELECT body FROM prompt_book ORDER BY rowid DESC LIMIT 1')
        .get();
      assert.equal(last.body, 'Line 998.');
    } finally {
      backupDb.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
