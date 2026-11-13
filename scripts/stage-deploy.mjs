#!/usr/bin/env node
/**
 * Ghostlight Town — static deploy staging script (Slice 28)
 *
 * Stages the static 3D site files from town-3d/ into a local staging directory
 * under a `ghostlight-town/` prefix and writes MANIFEST.json for review before
 * any live deploy. Performs local file operations only; never touches the
 * homelab, never bumps ?v= in index.html, and never stages town-api/ or
 * town-npc/.
 *
 * Usage:
 *   node scripts/stage-deploy.mjs [--out <dir>] [--root <dir>]
 *
 * Options:
 *   --out <dir>   Target staging directory (default: <root>/staging).
 *                 Refuses to stage into <root> itself or into town-3d/,
 *                 town-api/, or town-npc/.
 *   --root <dir>  Repository root containing town-3d/ (default: repo root
 *                 derived from import.meta.url, one level above scripts/).
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SECRET_FILENAME_RES = [
  /\.pem$/i,
  /\.key$/i,
  /token/i,
  /secret/i,
  /credential/i,
];

const SECRET_CONTENT_RES = [
  /api[_-]?key/i,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
  /x-auth-token/i,
];

const NOT_STAGED = [
  'town-api/ (server-side, separate deploy)',
  'town-npc/ (server-side, separate deploy)',
];

function parseArgs(argv) {
  let outArg = null;
  let rootArg = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('--out requires a directory argument');
      }
      outArg = argv[++i];
    } else if (arg === '--root') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('--root requires a directory argument');
      }
      rootArg = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const rootDir = path.resolve(rootArg ?? DEFAULT_ROOT);
  const outDir = path.resolve(outArg ?? path.join(rootDir, 'staging'));
  return { rootDir, outDir };
}

function isSameOrInside(candidate, base) {
  const rel = path.relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function validateOutDir(outDir, rootDir) {
  if (outDir === rootDir) {
    throw new Error(`Refusing to stage into repo root: ${outDir}`);
  }
  for (const forbidden of ['town-3d', 'town-api', 'town-npc']) {
    const forbiddenDir = path.join(rootDir, forbidden);
    if (isSameOrInside(outDir, forbiddenDir)) {
      throw new Error(`Refusing to stage inside ${forbidden}/: ${outDir}`);
    }
  }
}

async function assertNotSymlinkFile(filePath, label) {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(`Missing required source file: ${label}`);
    }
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlink source: ${label}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Expected regular file: ${label}`);
  }
}

async function assertNotSymlinkDir(dirPath, label) {
  let stat;
  try {
    stat = await fs.lstat(dirPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(`Missing required source directory: ${label}`);
    }
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlink directory: ${label}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Expected directory: ${label}`);
  }
}

async function collectDirRecursive(dirPath, relPrefix, results) {
  await assertNotSymlinkDir(dirPath, `town-3d/${relPrefix}`);
  const entries = await fs.readdir(dirPath);
  entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    const relPath = `${relPrefix}/${entry}`;
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlink source: town-3d/${relPath}`);
    }
    if (stat.isDirectory()) {
      await collectDirRecursive(fullPath, relPath, results);
    } else if (stat.isFile()) {
      results.push({ srcPath: fullPath, relPath });
    } else {
      throw new Error(`Unsupported file type: town-3d/${relPath}`);
    }
  }
}

async function collectSourceFiles(rootDir) {
  const town3dDir = path.join(rootDir, 'town-3d');
  await assertNotSymlinkDir(town3dDir, 'town-3d');

  const files = [];

  for (const reqFile of ['index.html', 'town.js', 'CREDITS.md']) {
    const srcPath = path.join(town3dDir, reqFile);
    await assertNotSymlinkFile(srcPath, `town-3d/${reqFile}`);
    files.push({ srcPath, relPath: reqFile });
  }

  const topEntries = await fs.readdir(town3dDir);
  topEntries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const entry of topEntries) {
    if (/^concept-.*\.js$/.test(entry)) {
      const srcPath = path.join(town3dDir, entry);
      await assertNotSymlinkFile(srcPath, `town-3d/${entry}`);
      files.push({ srcPath, relPath: entry });
    }
  }

  const modelsDir = path.join(town3dDir, 'models');
  await assertNotSymlinkDir(modelsDir, 'town-3d/models');
  const modelEntries = await fs.readdir(modelsDir);
  modelEntries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let glbCount = 0;
  for (const entry of modelEntries) {
    if (entry.endsWith('.glb')) {
      const srcPath = path.join(modelsDir, entry);
      await assertNotSymlinkFile(srcPath, `town-3d/models/${entry}`);
      files.push({ srcPath, relPath: `models/${entry}` });
      glbCount += 1;
    }
  }
  if (glbCount === 0) {
    throw new Error('Missing required source files: town-3d/models/*.glb');
  }

  const gazetteFiles = [];
  await collectDirRecursive(path.join(town3dDir, 'gazette'), 'gazette', gazetteFiles);
  if (gazetteFiles.length === 0) {
    throw new Error('Missing required source files: town-3d/gazette/**');
  }
  files.push(...gazetteFiles);

  const plotsFiles = [];
  await collectDirRecursive(path.join(town3dDir, 'plots'), 'plots', plotsFiles);
  if (plotsFiles.length === 0) {
    throw new Error('Missing required source files: town-3d/plots/**');
  }
  files.push(...plotsFiles);

  files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return files;
}

function checkSecretGuard(relPath, contentBuf) {
  const baseName = path.basename(relPath);
  for (const re of SECRET_FILENAME_RES) {
    if (re.test(baseName)) {
      throw new Error(`Secret guard blocked filename: ${relPath}`);
    }
  }
  const text = contentBuf.toString('utf8');
  for (const re of SECRET_CONTENT_RES) {
    if (re.test(text)) {
      throw new Error(`Secret guard blocked content in: ${relPath}`);
    }
  }
}

function extractTownJsVersion(indexHtmlText) {
  const match = indexHtmlText.match(/town\.js\?v=([^"'\s&#>]+)/);
  return match ? match[1] : null;
}

async function pathExists(targetPath) {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function stageDeploy(argv) {
  const { rootDir, outDir } = parseArgs(argv);
  validateOutDir(outDir, rootDir);

  const sourceFiles = await collectSourceFiles(rootDir);

  // Read and validate all files (including secret guard) before touching outDir.
  const prepared = [];
  let townJsV = null;

  for (const { srcPath, relPath } of sourceFiles) {
    const buf = await fs.readFile(srcPath);
    checkSecretGuard(relPath, buf);
    if (relPath === 'index.html') {
      townJsV = extractTownJsVersion(buf.toString('utf8'));
    }
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    prepared.push({
      relPath,
      buf,
      bytes: buf.length,
      sha256,
    });
  }

  const outExistedBefore = await pathExists(outDir);
  const stagePrefixDir = path.join(outDir, 'ghostlight-town');

  try {
    await fs.rm(stagePrefixDir, { recursive: true, force: true });
    await fs.mkdir(stagePrefixDir, { recursive: true });

    for (const item of prepared) {
      const destPath = path.join(stagePrefixDir, item.relPath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, item.buf);
    }

    const manifestFiles = prepared.map((item) => ({
      path: item.relPath,
      bytes: item.bytes,
      sha256: item.sha256,
    }));
    const totalBytes = manifestFiles.reduce((sum, f) => sum + f.bytes, 0);

    const manifest = {
      staged_at: new Date().toISOString(),
      source: 'ghostlight-town repo tree',
      town_js_v: townJsV,
      files: manifestFiles,
      total_bytes: totalBytes,
      file_count: manifestFiles.length,
      not_staged: NOT_STAGED,
    };

    const manifestPath = path.join(stagePrefixDir, 'MANIFEST.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const summary = {
      ok: true,
      out: outDir,
      town_js_v: townJsV,
      file_count: manifestFiles.length,
      total_bytes: totalBytes,
    };
    process.stdout.write(JSON.stringify(summary) + '\n');
  } catch (err) {
    if (!outExistedBefore) {
      await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    } else {
      await fs.rm(stagePrefixDir, { recursive: true, force: true }).catch(() => {});
    }
    throw err;
  }
}

stageDeploy(process.argv.slice(2)).catch((err) => {
  process.stderr.write(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) + '\n'
  );
  process.exit(1);
});
