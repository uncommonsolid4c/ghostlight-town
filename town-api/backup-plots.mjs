#!/usr/bin/env node
/**
 * Ghostlight Town — town-api plots backup CLI (Slice 26)
 *
 * Safely snapshots the TOWN_PLOTS_DIR directory tree into a timestamped
 * directory under --out-dir and verifies every file's path and sha256 digest.
 *
 * Scope note: This backs up plots ONLY — the SQLite db is `backup.mjs`'s job;
 * run both before any rsync.
 * Restore: copy the snapshot dir back over `TOWN_PLOTS_DIR`.
 *
 * Usage:
 *   node town-api/backup-plots.mjs [--plots-dir <path>] [--out-dir <dir>] [--help]
 *
 * Defaults:
 *   --plots-dir  $TOWN_PLOTS_DIR, else <town-api>/plots
 *   --out-dir    <town-api>/backups
 *
 * Zero external dependencies (Node built-ins only).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printUsage() {
  console.log(
    [
      'Usage: node town-api/backup-plots.mjs [--plots-dir <path>] [--out-dir <dir>] [--help]',
      '',
      'Options:',
      '  --plots-dir <path>  Source plots directory (default: $TOWN_PLOTS_DIR or <town-api>/plots)',
      '  --out-dir <dir>     Output directory for backups (default: <town-api>/backups)',
      '  --help, -h          Show this help message and exit 0',
    ].join('\n')
  );
}

function errorExit(message, extra = {}) {
  console.error(JSON.stringify({ status: 'error', error: message, ...extra }));
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    plotsDir: process.env.TOWN_PLOTS_DIR || path.join(__dirname, 'plots'),
    outDir: path.join(__dirname, 'backups'),
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      return opts;
    } else if (arg === '--plots-dir') {
      if (i + 1 >= argv.length || !argv[i + 1]) {
        errorExit('Missing value for --plots-dir');
      }
      opts.plotsDir = argv[++i];
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

function pickTargetDir(outDir, timestamp) {
  const base = `plots-${timestamp}`;
  let candidate = base;
  let fullPath = path.join(outDir, candidate);
  let suffix = 2;
  while (fs.existsSync(fullPath)) {
    candidate = `${base}-${suffix}`;
    fullPath = path.join(outDir, candidate);
    suffix++;
  }
  return { dirname: candidate, fullPath };
}

function isSameOrInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function removeQuietly(dirPath) {
  if (!dirPath) return;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function copyTreeNoSymlinks(srcDir, dstDir) {
  const entries = fs.readdirSync(srcDir).sort();
  for (const name of entries) {
    const srcPath = path.join(srcDir, name);
    const dstPath = path.join(dstDir, name);
    const lstat = fs.lstatSync(srcPath);

    if (lstat.isSymbolicLink()) {
      throw new Error(`Symlink found in plots tree: ${srcPath}`);
    }
    if (lstat.isDirectory()) {
      fs.mkdirSync(dstPath);
      copyTreeNoSymlinks(srcPath, dstPath);
    } else if (lstat.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    } else {
      throw new Error(`Unsupported file type in plots tree: ${srcPath}`);
    }
  }
}

function collectTreeFiles(rootDir) {
  const files = [];
  const hashes = new Map();

  function walk(currentDir, relPrefix) {
    const entries = fs.readdirSync(currentDir).sort();
    for (const name of entries) {
      const fullPath = path.join(currentDir, name);
      const relPath = relPrefix ? `${relPrefix}/${name}` : name;
      const lstat = fs.lstatSync(fullPath);

      if (lstat.isSymbolicLink()) {
        throw new Error(`Symlink found during verification: ${fullPath}`);
      }
      if (lstat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (lstat.isFile()) {
        files.push(relPath);
        hashes.set(relPath, sha256File(fullPath));
      } else {
        throw new Error(`Unsupported file type during verification: ${fullPath}`);
      }
    }
  }

  walk(rootDir, '');
  files.sort();
  return { files, hashes };
}

function listTopLevelHandles(plotsDir) {
  const handles = [];
  for (const name of fs.readdirSync(plotsDir)) {
    const fullPath = path.join(plotsDir, name);
    if (fs.lstatSync(fullPath).isDirectory()) {
      handles.push(name);
    }
  }
  handles.sort();
  return handles;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  const plotsDir = path.resolve(opts.plotsDir);
  const outDir = path.resolve(opts.outDir);

  let lstat;
  try {
    lstat = fs.lstatSync(plotsDir);
  } catch {
    errorExit('Source plots directory not found', { plotsDir });
  }
  if (lstat.isSymbolicLink()) {
    errorExit('Source plots directory must not be a symlink', { plotsDir });
  }
  if (!lstat.isDirectory()) {
    errorExit('Source plots path is not a directory', { plotsDir });
  }

  if (isSameOrInside(plotsDir, outDir) || isSameOrInside(outDir, plotsDir)) {
    errorExit('Output directory and plots directory must not contain each other', {
      plotsDir,
      outDir,
    });
  }

  let target = null;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    target = pickTargetDir(outDir, formatUtcTimestamp());
    fs.mkdirSync(target.fullPath);
    copyTreeNoSymlinks(plotsDir, target.fullPath);
  } catch (err) {
    if (target) removeQuietly(target.fullPath);
    errorExit(`Backup failed during copy: ${err.message}`);
  }

  let srcTree;
  let dstTree;
  let handles;
  try {
    srcTree = collectTreeFiles(plotsDir);
    dstTree = collectTreeFiles(target.fullPath);
    handles = listTopLevelHandles(plotsDir);
  } catch (err) {
    removeQuietly(target.fullPath);
    errorExit(`Failed to verify plots backup: ${err.message}`);
  }

  if (srcTree.files.length !== dstTree.files.length) {
    removeQuietly(target.fullPath);
    errorExit('Backup file count mismatch', {
      expected: srcTree.files.length,
      actual: dstTree.files.length,
    });
  }

  for (let i = 0; i < srcTree.files.length; i++) {
    const rel = srcTree.files[i];
    if (rel !== dstTree.files[i]) {
      removeQuietly(target.fullPath);
      errorExit('Backup file list mismatch', {
        expected: rel,
        actual: dstTree.files[i],
      });
    }
    const srcHash = srcTree.hashes.get(rel);
    const dstHash = dstTree.hashes.get(rel);
    if (srcHash !== dstHash) {
      removeQuietly(target.fullPath);
      errorExit('Backup sha256 mismatch', {
        file: rel,
        expected: srcHash,
        actual: dstHash,
      });
    }
  }

  console.log(
    JSON.stringify({
      status: 'ok',
      backup: target.dirname,
      files: dstTree.files.length,
      handles,
    })
  );
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
