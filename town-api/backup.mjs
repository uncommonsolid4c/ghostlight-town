#!/usr/bin/env node
/**
 * Ghostlight Town — town-api SQLite backup CLI (Slice 25)
 *
 * Safely snapshots the SQLite database using `VACUUM INTO` (safe for live
 * WAL-mode databases) and verifies row counts across all schema tables.
 *
 * Scope note: This backs up the SQLite db ONLY. Plot manifests and desk notes
 * live as flat files under `TOWN_PLOTS_DIR` and are backed up separately by
 * `town-api/backup-plots.mjs` — they are not in the db and this script does
 * not touch them.
 *
 * Usage:
 *   node town-api/backup.mjs [--db <path>] [--out-dir <dir>] [--help]
 *
 * Defaults:
 *   --db       $TOWN_DB_PATH, else <town-api>/town.db
 *   --out-dir  <town-api>/backups
 *
 * Zero external dependencies (Node built-ins + node:sqlite only).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA_TABLES = [
  'residents',
  'invitations',
  'prompt_book',
  'footlights',
  'presence',
  'key_history',
  'meta',
];

function printUsage() {
  console.log(
    [
      'Usage: node town-api/backup.mjs [--db <path>] [--out-dir <dir>] [--help]',
      '',
      'Options:',
      '  --db <path>      Source SQLite database path (default: $TOWN_DB_PATH or <town-api>/town.db)',
      '  --out-dir <dir>  Output directory for backups (default: <town-api>/backups)',
      '  --help, -h       Show this help message and exit 0',
    ].join('\n')
  );
}

function errorExit(message, extra = {}) {
  console.error(JSON.stringify({ status: 'error', error: message, ...extra }));
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    dbPath: process.env.TOWN_DB_PATH || path.join(__dirname, 'town.db'),
    outDir: path.join(__dirname, 'backups'),
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      return opts;
    } else if (arg === '--db') {
      if (i + 1 >= argv.length || !argv[i + 1]) {
        errorExit('Missing value for --db');
      }
      opts.dbPath = argv[++i];
    } else if (arg === '--out-dir') {
      if (i + 1 >= argv.length || !argv[i + 1]) {
        errorExit('Missing value for --out-dir');
      }
      opts.outDir = argv[++i];
    } else {
      errorExit(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function formatUtcTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const m = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mm = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function pickTargetPath(outDir, timestamp) {
  const base = `town-${timestamp}`;
  let candidate = `${base}.db`;
  let fullPath = path.join(outDir, candidate);
  let suffix = 2;
  while (fs.existsSync(fullPath)) {
    candidate = `${base}-${suffix}.db`;
    fullPath = path.join(outDir, candidate);
    suffix++;
  }
  return { filename: candidate, fullPath };
}

function countTables(db) {
  const counts = {};
  for (const table of SCHEMA_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
    counts[table] = Number(row.count);
  }
  return counts;
}

function removeQuietly(filePath) {
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore cleanup error
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  const dbPath = path.resolve(opts.dbPath);
  const outDir = path.resolve(opts.outDir);

  let stat;
  try {
    stat = fs.statSync(dbPath);
  } catch {
    errorExit('Source database not found', { db: dbPath });
  }
  if (!stat.isFile()) {
    errorExit('Source database path is not a file', { db: dbPath });
  }

  let srcDb;
  let srcCounts;
  try {
    srcDb = new DatabaseSync(dbPath, { readOnly: true });
    srcCounts = countTables(srcDb);
  } catch (err) {
    if (srcDb) {
      try {
        srcDb.close();
      } catch {
        // ignore
      }
    }
    errorExit(`Failed to read source database: ${err.message}`, { db: dbPath });
  }

  let target = null;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    target = pickTargetPath(outDir, formatUtcTimestamp());
    const escapedPath = target.fullPath.replace(/'/g, "''");
    srcDb.exec(`VACUUM INTO '${escapedPath}'`);
  } catch (err) {
    if (target) removeQuietly(target.fullPath);
    errorExit(`Backup failed during VACUUM INTO: ${err.message}`);
  } finally {
    try {
      srcDb.close();
    } catch {
      // ignore
    }
  }

  let dstDb;
  let dstCounts;
  try {
    dstDb = new DatabaseSync(target.fullPath, { readOnly: true });
    dstCounts = countTables(dstDb);
  } catch (err) {
    if (dstDb) {
      try {
        dstDb.close();
      } catch {
        // ignore
      }
    }
    removeQuietly(target.fullPath);
    errorExit(`Failed to verify backup database: ${err.message}`);
  }

  try {
    dstDb.close();
  } catch {
    // ignore
  }

  for (const table of SCHEMA_TABLES) {
    if (srcCounts[table] !== dstCounts[table]) {
      removeQuietly(target.fullPath);
      errorExit('Backup row count mismatch', {
        table,
        expected: srcCounts[table],
        actual: dstCounts[table],
      });
    }
  }

  console.log(
    JSON.stringify({
      status: 'ok',
      backup: target.filename,
      tables: dstCounts,
    })
  );
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
