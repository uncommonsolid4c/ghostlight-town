#!/usr/bin/env node
/**
 * Ghostlight Town — live-site health check script (Slice 34)
 *
 * Read-only check that verifies the deployed static site at
 * `<base>/ghostlight-town/` matches the local `town-3d/` tree (file 200s,
 * GLB magic, `town.js?v=N` parity, required `town.js` markers, and
 * `gazette/latest.json` -> `issue-*.html` 200), plus an informational check
 * of `<api-base>/api/town/state`.
 *
 * Usage:
 *   node scripts/check-live.mjs [--base <url>] [--root <dir>] [--api-base <url>] [--require-api]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStagedFiles } from './stage-deploy.mjs';

const DEFAULT_BASE = 'https://milo.4167360.xyz';
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'town-3d');
const REQUEST_TIMEOUT_MS = 5000;

const TOWN_JS_MARKERS = [
  'PROP_PLACEMENTS',
  'buildConceptBandstand',
  'SEED_WANDER_CONFIG',
  'newsstand_papers_shelf',
];

function parseArgs(argv) {
  let base = DEFAULT_BASE;
  let root = DEFAULT_ROOT;
  let apiBase = null;
  let requireApi = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('--base requires a URL argument');
      }
      base = argv[++i];
    } else if (arg === '--root') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('--root requires a directory argument');
      }
      root = argv[++i];
    } else if (arg === '--api-base') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        throw new Error('--api-base requires a URL argument');
      }
      apiBase = argv[++i];
    } else if (arg === '--require-api') {
      requireApi = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedApiBase = (apiBase ?? normalizedBase).replace(/\/+$/, '');
  return {
    base: normalizedBase,
    root: path.resolve(root),
    apiBase: normalizedApiBase,
    requireApi,
  };
}

export async function getExpectedFiles(town3dDir) {
  return listStagedFiles(town3dDir);
}

function extractTownJsVersion(html) {
  const match = html.match(/town\.js\?v=(\d+)/);
  return match ? Number(match[1]) : null;
}

async function fetchWithTimeout(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf };
}

function resolveLatestIssueFile(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed.issues)) {
    const byLatest = parsed.issues.find((item) => item && item.n === parsed.latest);
    const candidate = byLatest ?? parsed.issues[0];
    if (candidate && typeof candidate.file === 'string' && /^issue-.*\.html$/.test(candidate.file)) {
      return candidate.file;
    }
  }
  return null;
}

async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }

  let rootStat;
  try {
    rootStat = await fs.stat(opts.root);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: `Invalid --root directory: ${opts.root} (${err.message})` })}\n`);
    process.exit(1);
  }
  if (!rootStat.isDirectory()) {
    process.stderr.write(`${JSON.stringify({ error: `--root is not a directory: ${opts.root}` })}\n`);
    process.exit(1);
  }

  const expectedFiles = await getExpectedFiles(opts.root);

  let repoTownJsV = null;
  if (expectedFiles.includes('index.html')) {
    const repoIndexHtml = await fs.readFile(path.join(opts.root, 'index.html'), 'utf8');
    repoTownJsV = extractTownJsVersion(repoIndexHtml);
  }

  const failures = [];
  const failedFiles = new Set();
  const recordFailure = (file, problem, detail) => {
    failures.push({ file, problem, detail });
    failedFiles.add(file);
  };

  for (const relPath of expectedFiles) {
    const url = `${opts.base}/ghostlight-town/${relPath}`;
    let fetched;
    try {
      fetched = await fetchWithTimeout(url);
    } catch (err) {
      recordFailure(relPath, 'bad-status', err.message);
      continue;
    }

    if (fetched.status !== 200) {
      recordFailure(
        relPath,
        fetched.status === 404 ? 'missing' : 'bad-status',
        `HTTP ${fetched.status}`,
      );
      continue;
    }

    if (relPath.endsWith('.glb')) {
      const magic = fetched.buf.subarray(0, 4).toString('ascii');
      if (fetched.buf.length < 4 || magic !== 'glTF') {
        recordFailure(relPath, 'mismatch', `expected glTF magic, got ${JSON.stringify(magic)}`);
      }
      continue;
    }

    const text = fetched.buf.toString('utf8');

    if (relPath === 'index.html') {
      const liveV = extractTownJsVersion(text);
      if (liveV !== repoTownJsV) {
        recordFailure('index.html', 'town_js_v', `repo_v=${repoTownJsV} vs live_v=${liveV}`);
      }
    } else if (relPath === 'town.js') {
      const missingMarkers = TOWN_JS_MARKERS.filter((marker) => !text.includes(marker));
      if (missingMarkers.length > 0) {
        recordFailure('town.js', 'markers', `missing markers: ${missingMarkers.join(', ')}`);
      }
    } else if (relPath === 'gazette/latest.json') {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        recordFailure('gazette/latest.json', 'mismatch', `invalid JSON: ${err.message}`);
        continue;
      }
      const issueFile = resolveLatestIssueFile(parsed);
      if (!issueFile) {
        recordFailure('gazette/latest.json', 'mismatch', 'missing issue-*.html filename in latest.json');
        continue;
      }
      const issueRelPath = `gazette/${issueFile}`;
      if (!expectedFiles.includes(issueRelPath)) {
        try {
          const issueRes = await fetchWithTimeout(`${opts.base}/ghostlight-town/${issueRelPath}`);
          if (issueRes.status !== 200) {
            recordFailure(
              issueRelPath,
              issueRes.status === 404 ? 'missing' : 'bad-status',
              `HTTP ${issueRes.status}`,
            );
          }
        } catch (err) {
          recordFailure(issueRelPath, 'bad-status', err.message);
        }
      }
    }
  }

  let apiStatus = 'not-live';
  let apiDetail = 'unknown';
  try {
    const apiRes = await fetchWithTimeout(`${opts.apiBase}/api/town/state`);
    if (apiRes.status === 200) {
      apiStatus = 'live';
    } else {
      apiDetail = `HTTP ${apiRes.status}`;
    }
  } catch (err) {
    apiDetail = err.message;
  }

  if (opts.requireApi && apiStatus !== 'live') {
    failures.push({ file: '/api/town/state', problem: 'bad-status', detail: apiDetail });
  }

  const okCount = expectedFiles.filter((file) => !failedFiles.has(file)).length;
  const status = failures.length === 0 ? 'ok' : 'fail';

  const summary = {
    status,
    base: opts.base,
    town_js_v: repoTownJsV,
    checked: expectedFiles.length,
    ok: okCount,
    failures,
    api: apiStatus,
  };

  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exit(status === 'ok' ? 0 : 1);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  });
}
