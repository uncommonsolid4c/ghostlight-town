/**
 * Ghostlight Town — drift guard for scripts/README.md (Slice 124, extended Slice 134)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(__dirname);
const README_PATH = path.join(__dirname, 'README.md');
const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');

function readReadme() {
  return fs.readFileSync(README_PATH, 'utf8');
}

function listFiles(predicate) {
  return fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => entry.name)
    .sort();
}

test('scripts/README.md names every shipped .mjs file in scripts/', () => {
  const readme = readReadme();
  const shippedFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.startsWith('test-'))
    .map((entry) => entry.name)
    .sort();

  assert.ok(shippedFiles.length > 0, 'scripts/ must contain shipped .mjs files');
  for (const file of shippedFiles) {
    assert.ok(
      readme.includes(`\`${file}\``),
      `scripts/README.md must document shipped file ${file}`
    );
  }
});

test('scripts/README.md states the staging-vs-deploy distinction and pine.glb exclusion', () => {
  const readme = readReadme();
  assert.match(readme, /staging is not deploying/i);
  assert.match(readme, /never touches the homelab/i);
  assert.match(readme, /`(?:models\/)?pine\.glb`/);
  assert.match(readme, /EXCLUDED_FILES/);
  assert.match(readme, /never committed or shipped/i);
});

test('scripts/README.md states the check-live default base/bundle and read-only behaviour', () => {
  const readme = readReadme();
  assert.match(readme, /https:\/\/milo\.4167360\.xyz/);
  assert.match(readme, /staging-polyfork/);
  assert.match(readme, /read-only/i);
  assert.match(readme, /--require-api/);
});

test('scripts/README.md omits banned terms', () => {
  const readme = readReadme();
  assert.doesNotMatch(readme, BANNED_TERM_RE);
});

test('scripts/README.md Shipped files table matches exact shipped .mjs files in scripts/', () => {
  const readme = readReadme();
  const sectionMatch = readme.match(/## Shipped files\s+([\s\S]*?)\n## /);
  assert.ok(sectionMatch, 'Shipped files section must exist');
  const tableFiles = [...sectionMatch[1].matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
    .map((m) => m[1])
    .sort();

  const shippedFiles = listFiles((name) => name.endsWith('.mjs') && !name.startsWith('test-'));
  assert.equal(
    tableFiles.some((name) => name.startsWith('test-')),
    false,
    'Shipped files table must not list test files'
  );
  assert.deepEqual(tableFiles, shippedFiles);
});

test('scripts/README.md test-suite count and list match run-tests.mjs and scripts/', () => {
  const readme = readReadme();
  const blockMatch = readme.match(/Test suites \((\d+), all registered in \[`[^`]+`\]\([^)]+\)\):\s*([^\n]+)\./);
  assert.ok(blockMatch, 'README must document "Test suites (<N>, all registered in ...): ..."');
  const readmeCount = Number(blockMatch[1]);
  const readmeSuites = [...blockMatch[2].matchAll(/`([^`]+\.mjs)`/g)]
    .map((m) => m[1])
    .sort();

  const diskSuites = listFiles((name) => name.startsWith('test-') && name.endsWith('.mjs'));
  const runTestsSrc = fs.readFileSync(path.join(ROOT_DIR, 'run-tests.mjs'), 'utf8');
  const registered = [...runTestsSrc.matchAll(/'scripts\/([^']+)'/g)]
    .map((m) => m[1])
    .sort();

  assert.equal(readmeCount, diskSuites.length, 'README suite count must match scripts/ test files');
  assert.deepEqual(readmeSuites, diskSuites, 'README suite list must match scripts/ test files');
  assert.deepEqual(registered, diskSuites, 'run-tests.mjs scripts/ suites must match scripts/ test files');
});

test('scripts/README.md staging facts (file count and staging_js_v) match a real stage-deploy dry run', () => {
  const readme = readReadme();
  const factsMatch = readme.match(
    /staging bundle `staging-polyfork` stages \*\*(\d+)\s+files\*\* with `staging_js_v` \*\*(\d+)\*\*/
  );
  assert.ok(factsMatch, 'README must document staging-polyfork file count and staging_js_v');
  const readmeCount = Number(factsMatch[1]);
  const readmeVersion = factsMatch[2];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-stage-'));
  try {
    const stageOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'staging-polyfork', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const stageSummary = JSON.parse(stageOut.trim());
    assert.equal(stageSummary.ok, true);
    assert.equal(readmeCount, stageSummary.file_count, 'README file_count must match stage-deploy');
    assert.equal(readmeVersion, String(stageSummary.staging_js_v), 'README staging_js_v must match stage-deploy');

    const verifyOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--verify', path.join(tmpDir, 'ghostlight-town')],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const verifySummary = JSON.parse(verifyOut.trim());
    assert.equal(verifySummary.status, 'ok');
    assert.equal(verifySummary.checked, stageSummary.file_count);
    assert.equal(verifySummary.ok, stageSummary.file_count);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md check-live slice numbers, defaults, and bundle markers match source', () => {
  const readme = readReadme();
  const checkLiveSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');

  assert.match(checkLiveSrc, /Slice 34, Slice 100/);
  assert.match(readme, /Slices 34 & 100/);
  assert.match(readme, /`check-live\.mjs` \(Slices 34, 100\)/);

  const defaultBase = checkLiveSrc.match(/const DEFAULT_BASE = '([^']+)';/)?.[1];
  const defaultBundle = checkLiveSrc.match(/const DEFAULT_BUNDLE = '([^']+)';/)?.[1];
  assert.ok(defaultBase && defaultBundle, 'check-live.mjs must define DEFAULT_BASE and DEFAULT_BUNDLE');
  assert.ok(readme.includes(defaultBase), `README must document DEFAULT_BASE ${defaultBase}`);
  assert.ok(readme.includes(defaultBundle), `README must document DEFAULT_BUNDLE ${defaultBundle}`);

  const parseMarkers = (bundleName) => {
    const m = checkLiveSrc.match(
      new RegExp(`'${bundleName}':[\\s\\S]*?markers:\\s*\\[([\\s\\S]*?)\\]`)
    );
    assert.ok(m, `Missing BUNDLE_CONFIG[${bundleName}].markers in check-live.mjs`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  const town3dMarkers = parseMarkers('town-3d');
  const stagingMarkers = parseMarkers('staging-polyfork');
  const townJs = fs.readFileSync(path.join(ROOT_DIR, 'town-3d', 'town.js'), 'utf8');
  const stagingJs = fs.readFileSync(path.join(ROOT_DIR, 'staging-polyfork', 'staging.js'), 'utf8');

  for (const marker of town3dMarkers) {
    assert.ok(readme.includes(`\`${marker}\``), `README must document town-3d marker ${marker}`);
    assert.ok(townJs.includes(marker), `town-3d/town.js must contain marker ${marker}`);
  }
  for (const marker of stagingMarkers) {
    assert.ok(readme.includes(`\`${marker}\``), `README must document staging-polyfork marker ${marker}`);
    assert.ok(stagingJs.includes(marker), `staging-polyfork/staging.js must contain marker ${marker}`);
  }
});

test('scripts/README.md shared-helper exports and imports match stage-deploy.mjs and check-live.mjs', () => {
  const readme = readReadme();
  const sectionMatch = readme.match(/## Shared helpers\s+([\s\S]*?)\n## /);
  assert.ok(sectionMatch, 'Shared helpers section must exist');
  const section = sectionMatch[1];

  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');
  const checkSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');

  const stageExports = [...stageSrc.matchAll(/^export\s+(?:const|async\s+function|function)\s+(\w+)/gm)]
    .map((m) => m[1]);
  const checkExports = [...checkSrc.matchAll(/^export\s+(?:const|async\s+function|function)\s+(\w+)/gm)]
    .map((m) => m[1]);
  const checkImports = checkSrc
    .match(/import\s*\{([^}]+)\}\s*from\s*'\.\/stage-deploy\.mjs';/)?.[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  assert.ok(stageExports.length > 0 && checkExports.length > 0 && checkImports?.length > 0);
  for (const sym of [...stageExports, ...checkExports, ...checkImports]) {
    assert.ok(section.includes(`\`${sym}\``), `Shared helpers section must document ${sym}`);
  }
});

test('scripts/README.md cross-links resolve to existing files in the repo', () => {
  const readme = readReadme();
  const links = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((href) => !/^https?:\/\//.test(href));

  assert.ok(links.length > 0, 'README must contain relative cross-links');
  for (const href of links) {
    const relPath = href.split('#')[0];
    const resolved = path.resolve(__dirname, relPath);
    assert.ok(fs.existsSync(resolved), `Cross-link target must exist: ${href}`);
  }
});

test('scripts/README.md target safety: default bundle/out and refusal set match stage-deploy.mjs', () => {
  const readme = readReadme();
  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');

  assert.ok(stageSrc.includes("const bundle = bundleArg ?? 'town-3d';"));
  assert.ok(stageSrc.includes("path.join(rootDir, 'staging')"));
  assert.ok(stageSrc.includes("for (const forbidden of ['town-3d', 'town-api', 'town-npc', 'staging-polyfork'])"));
  assert.ok(stageSrc.includes('if (targetDir === rootDir)'));

  assert.ok(readme.includes('defaults `--out` to `<root>/staging`'));
  assert.ok(readme.includes('refuses to stage\n  into or verify `<root>` itself or inside `town-3d/`'));

  assert.throws(
    () => {
      execFileSync(
        process.execPath,
        [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', path.join(ROOT_DIR, 'town-3d')],
        { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    },
    (err) => {
      assert.match(err.stderr, /Refusing to stage into inside town-3d\//);
      return true;
    }
  );

  assert.throws(
    () => {
      execFileSync(
        process.execPath,
        [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', ROOT_DIR],
        { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    },
    (err) => {
      assert.match(err.stderr, /Refusing to stage into repo root:/);
      return true;
    }
  );
});

test('scripts/README.md town-3d exclusions: gazette build tools and pine.glb stay out of staging', () => {
  const readme = readReadme();
  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');

  assert.ok(stageSrc.includes('/^gazette\\/[^/]+\\.mjs$/'));
  assert.ok(stageSrc.includes('SECRET_FILENAME_RES'));
  assert.ok(stageSrc.includes('SECRET_CONTENT_RES'));
  assert.ok(readme.includes('blocks secret-like filenames or'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-town3d-'));
  try {
    const stageOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const summary = JSON.parse(stageOut.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.bundle, 'town-3d');

    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    const byPath = new Map(manifest.excluded.map((entry) => [entry.path, entry.reason]));

    assert.equal(byPath.get('gazette/build-digest.mjs'), 'build tool, not served content');
    assert.equal(byPath.get('gazette/build-feed.mjs'), 'build tool, not served content');
    assert.ok(byPath.has('models/pine.glb'), 'models/pine.glb must be in MANIFEST.json excluded');
    assert.equal(
      manifest.files.some((item) => item.path.startsWith('gazette/') && item.path.endsWith('.mjs')),
      false,
      'gazette/*.mjs must not be staged in files'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md staging-polyfork exclusions: test suites and README.md stay out of staging', () => {
  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');

  assert.ok(stageSrc.includes('/^test-.*\\.mjs$/'));
  assert.ok(stageSrc.includes("item.relPath === 'README.md'"));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-polyfork-'));
  try {
    const stageOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'staging-polyfork', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const summary = JSON.parse(stageOut.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.file_count, 195);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    const excludedTests = manifest.excluded.filter(
      (entry) => /^test-.*\.mjs$/.test(entry.path) && entry.reason === 'test suite, not served content'
    );
    assert.ok(excludedTests.length >= 10, `expected >= 10 excluded test suites, got ${excludedTests.length}`);

    const readmeExcluded = manifest.excluded.find((entry) => entry.path === 'README.md');
    assert.ok(readmeExcluded, 'README.md must be in MANIFEST.json excluded');
    assert.equal(readmeExcluded.reason, 'documentation, not served content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md check-live ?v parity matches check-live.mjs', () => {
  const readme = readReadme();
  const checkLiveSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');

  assert.ok(checkLiveSrc.includes('versionRe: /town\\.js\\?v=(\\d+)/'));
  assert.ok(checkLiveSrc.includes('versionRe: /staging\\.js\\?v=(\\d+)/'));
  assert.ok(checkLiveSrc.includes('`repo_v=${repoVersion} vs live_v=${liveV}`'));
  assert.ok(readme.includes('`staging.js?v=N` / `town.js?v=N` parity'));
});

test('scripts/README.md check-live defaults: root and api-base match check-live.mjs', () => {
  const readme = readReadme();
  const checkLiveSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');

  assert.ok(
    checkLiveSrc.includes("const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');")
  );
  assert.ok(checkLiveSrc.includes('const normalizedApiBase = (apiBase ?? normalizedBase)'));

  assert.ok(readme.includes('`--api-base` defaults to `--base`'));
  assert.ok(readme.includes('`--root` defaults to repo root'));
});

test('scripts/README.md check-live checks: glTF magic, latest.json, and informational API match source', () => {
  const readme = readReadme();
  const checkLiveSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');

  assert.ok(checkLiveSrc.includes("magic !== 'glTF'"));
  assert.ok(checkLiveSrc.includes("recordFailure('gazette/latest.json', 'mismatch', `invalid JSON: "));
  assert.ok(
    checkLiveSrc.includes("recordFailure('gazette/latest.json', 'mismatch', 'missing issue-*.html filename in latest.json');")
  );
  assert.ok(checkLiveSrc.includes("if (apiRes.status === 200) {\n      apiStatus = 'live';"));
  assert.ok(checkLiveSrc.includes("if (opts.requireApi && apiStatus !== 'live')"));

  assert.ok(readme.includes('`glTF` 4-byte magic header on `.glb` models.'));
  assert.ok(readme.includes('`gazette/latest.json` parses cleanly'));
  assert.ok(readme.includes('Informational check of `<api-base>/api/town/state`; pass `--require-api` to'));
});

test('scripts/README.md stage-deploy usage lines and default bundle match source and a real dry run', () => {
  const readme = readReadme();
  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');
  const townIndexHtml = fs.readFileSync(path.join(ROOT_DIR, 'town-3d', 'index.html'), 'utf8');

  const usageStage = 'node scripts/stage-deploy.mjs [--bundle <name>] [--out <dir>] [--root <dir>]';
  const usageVerify = 'node scripts/stage-deploy.mjs --verify <dir> [--root <dir>]';

  assert.ok(readme.includes(usageStage), 'README must contain stage usage line');
  assert.ok(readme.includes(usageVerify), 'README must contain verify usage line');

  const headerComment = stageSrc.slice(0, stageSrc.indexOf('import '));
  assert.ok(headerComment.includes(usageStage), 'stage-deploy.mjs header must contain stage usage line');
  assert.ok(headerComment.includes(usageVerify), 'stage-deploy.mjs header must contain verify usage line');

  const parseArgsMatch = stageSrc.match(/function parseArgs\([\s\S]*?\n\}/);
  assert.ok(parseArgsMatch, 'parseArgs must exist in stage-deploy.mjs');
  for (const flag of ['--bundle', '--out', '--root', '--verify']) {
    assert.ok(
      parseArgsMatch[0].includes(`arg === '${flag}'`),
      `parseArgs must handle ${flag}`
    );
  }
  assert.ok(stageSrc.includes("const bundle = bundleArg ?? 'town-3d';"));
  assert.ok(townIndexHtml.includes('town.js?v=16'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-default-'));
  try {
    const stageOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const summary = JSON.parse(stageOut.trim());
    assert.equal(summary.bundle, 'town-3d');
    assert.equal(String(summary.town_js_v), '16');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md MANIFEST.json shape matches a real staging-polyfork dry run', () => {
  const readme = readReadme();
  assert.ok(readme.includes('with a sha256 `MANIFEST.json`'));
  assert.ok(readme.includes('with per-file `sha256` hashes and byte counts'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-manifest-'));
  try {
    const stageOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'staging-polyfork', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const summary = JSON.parse(stageOut.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.file_count, 195);
    assert.equal(String(summary.staging_js_v), '41');
    assert.equal(summary.town_js_v, null);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    assert.equal(manifest.file_count, 195);
    assert.equal(String(manifest.staging_js_v), '41');
    assert.equal(manifest.files.length, 195);

    let sumBytes = 0;
    for (const entry of manifest.files) {
      assert.equal(typeof entry.path, 'string');
      assert.ok(entry.path.length > 0);
      assert.equal(typeof entry.bytes, 'number');
      assert.ok(entry.bytes > 0);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      sumBytes += entry.bytes;
    }
    assert.equal(manifest.total_bytes, sumBytes);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md --verify rejection claims hold against a real tampered staging', () => {
  const readme = readReadme();
  assert.ok(readme.includes('rejects missing, mismatched, or extra files, symlinks, and `town_js_v` /'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-verify-'));
  const stagedDir = path.join(tmpDir, 'ghostlight-town');
  const runVerify = () => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [path.join(__dirname, 'stage-deploy.mjs'), '--verify', stagedDir],
        { cwd: ROOT_DIR, encoding: 'utf8' }
      );
      return { exitCode: 0, json: JSON.parse(stdout.trim()) };
    } catch (err) {
      return { exitCode: err.status, json: JSON.parse(String(err.stdout || '').trim()) };
    }
  };

  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'staging-polyfork', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );

    const manifestPath = path.join(stagedDir, 'MANIFEST.json');
    const origManifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(origManifestRaw);
    const firstRel = manifest.files[0].path;
    const secondRel = manifest.files[1].path;
    const firstPath = path.join(stagedDir, firstRel);
    const secondPath = path.join(stagedDir, secondRel);
    const firstOrigBytes = fs.readFileSync(firstPath);
    const secondOrigBytes = fs.readFileSync(secondPath);

    // 1. Clean staging
    const cleanRes = runVerify();
    assert.equal(cleanRes.exitCode, 0);
    assert.equal(cleanRes.json.status, 'ok');
    assert.deepEqual(cleanRes.json.mismatch, []);
    assert.deepEqual(cleanRes.json.missing, []);
    assert.deepEqual(cleanRes.json.extra, []);

    // 2. Append one byte to the first staged file
    fs.writeFileSync(firstPath, Buffer.concat([firstOrigBytes, Buffer.from([0x20])]));
    const mismatchRes = runVerify();
    assert.equal(mismatchRes.exitCode, 1);
    assert.equal(mismatchRes.json.status, 'fail');
    assert.ok(mismatchRes.json.mismatch.includes(firstRel));
    fs.writeFileSync(firstPath, firstOrigBytes);

    // 3. Tamper staging_js_v to '39' in MANIFEST.json
    const tamperedManifest = { ...manifest, staging_js_v: '39' };
    fs.writeFileSync(manifestPath, JSON.stringify(tamperedManifest, null, 2));
    const driftRes = runVerify();
    assert.equal(driftRes.exitCode, 1);
    assert.equal(driftRes.json.status, 'fail');
    assert.equal(driftRes.json.staged_staging_js_v, '41');
    assert.equal(driftRes.json.staging_js_v, '39');
    fs.writeFileSync(manifestPath, origManifestRaw);

    // 4. Delete the second staged file
    fs.unlinkSync(secondPath);
    const missingRes = runVerify();
    assert.equal(missingRes.exitCode, 1);
    assert.equal(missingRes.json.status, 'fail');
    assert.ok(missingRes.json.missing.includes(secondRel));
    fs.writeFileSync(secondPath, secondOrigBytes);

    // 5. Add extra-file.txt
    const extraPath = path.join(stagedDir, 'extra-file.txt');
    fs.writeFileSync(extraPath, 'extra\n');
    const extraRes = runVerify();
    assert.equal(extraRes.exitCode, 1);
    assert.equal(extraRes.json.status, 'fail');
    assert.ok(extraRes.json.extra.includes('extra-file.txt'));
    fs.unlinkSync(extraPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md Honest limits: neither script can deploy or mutate', () => {
  const readme = readReadme();
  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');
  const checkLiveSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');

  for (const forbidden of ['rsync', 'ssh', 'scp', '4167360.xyz']) {
    assert.equal(stageSrc.includes(forbidden), false, `stage-deploy.mjs must not contain ${forbidden}`);
  }

  const fetchCallRe = new RegExp(`\\b${'fetch'}\\(`, 'g');
  const fetchMatches = checkLiveSrc.match(fetchCallRe) || [];
  assert.equal(fetchMatches.length, 1, 'check-live.mjs must contain exactly one fetch call');
  const expectedCall = `await ${'fetch'}(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })`;
  assert.ok(checkLiveSrc.includes(expectedCall), 'check-live.mjs fetch call must be GET-only with timeout');

  for (const mutator of ["'POST'", "'PUT'", "'DELETE'", 'method:']) {
    assert.equal(checkLiveSrc.includes(mutator), false, `check-live.mjs must not contain ${mutator}`);
  }

  assert.ok(readme.includes('never touches the homelab'));
  assert.ok(readme.includes("deploying to the homelab is Milo's call"));
  assert.ok(readme.includes('**`check-live.mjs` is read-only:**'));
  assert.ok(readme.includes('cannot fix or mutate it'));
});

test('scripts/README.md Slice 28 staging script never stages town-api/ or town-npc/', () => {
  const readme = readReadme();
  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');
  const headerComment = stageSrc.slice(0, stageSrc.indexOf('import '));

  assert.ok(headerComment.includes('static deploy staging script (Slice 28)'));
  assert.ok(readme.includes('Slice 28 static deploy staging script'));
  assert.ok(headerComment.includes('never stages town-api/ or'));
  assert.ok(readme.includes('never stages `town-api/` or `town-npc/`'));
  assert.ok(stageSrc.includes("'town-api/ (server-side, separate deploy)'"));
  assert.ok(stageSrc.includes("'town-npc/ (server-side, separate deploy)'"));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-notstaged-'));
  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'staging-polyfork', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
    );
    const notStagedJoined = manifest.not_staged.join('\n');
    assert.ok(notStagedJoined.includes('town-api/'));
    assert.ok(notStagedJoined.includes('town-npc/'));
    assert.equal(
      manifest.files.some((item) => item.path.startsWith('town-api/') || item.path.startsWith('town-npc/')),
      false,
      'town-api/ and town-npc/ must never appear in manifest.files'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md check-live usage line and flag defaults match source', () => {
  const readme = readReadme();
  const checkLiveSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');
  const headerComment = checkLiveSrc.slice(0, checkLiveSrc.indexOf('import '));

  const usageLine = 'node scripts/check-live.mjs [--bundle <name>] [--base <url>] [--root <dir>] [--api-base <url>] [--require-api]';
  assert.ok(readme.includes(usageLine), 'README must contain check-live usage line');
  assert.ok(headerComment.includes(usageLine), 'check-live.mjs header must contain usage line');

  const parseArgsMatch = checkLiveSrc.match(/function parseArgs\([\s\S]*?\n\}/);
  assert.ok(parseArgsMatch, 'parseArgs must exist in check-live.mjs');
  for (const flag of ['--base', '--root', '--bundle', '--api-base', '--require-api']) {
    assert.ok(
      parseArgsMatch[0].includes(`arg === '${flag}'`),
      `check-live parseArgs must handle ${flag}`
    );
  }

  assert.ok(checkLiveSrc.includes("const DEFAULT_BASE = 'https://milo.4167360.xyz';"));
  assert.ok(checkLiveSrc.includes("const DEFAULT_BUNDLE = 'staging-polyfork';"));
  assert.ok(readme.includes('`--base https://milo.4167360.xyz`'));
  assert.ok(readme.includes('`--bundle staging-polyfork`'));
});

test('scripts/README.md --verify rejects a symlinked staged file', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes('rejects missing, mismatched, or extra files, symlinks, and `town_js_v` / `staging_js_v` drift')
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-symlink-'));
  const stagedDir = path.join(tmpDir, 'ghostlight-town');
  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(stagedDir, 'MANIFEST.json'), 'utf8'));
    const firstRel = manifest.files[0].path;
    const secondRel = manifest.files[1].path;
    const firstPath = path.join(stagedDir, firstRel);
    const secondPath = path.join(stagedDir, secondRel);
    fs.unlinkSync(firstPath);
    fs.symlinkSync(secondPath, firstPath);

    assert.throws(
      () => {
        execFileSync(
          process.execPath,
          [path.join(__dirname, 'stage-deploy.mjs'), '--verify', stagedDir],
          { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
      },
      (err) => {
        assert.equal(err.status, 1);
        const parsed = JSON.parse(String(err.stderr || '').trim());
        assert.deepEqual(parsed, {
          ok: false,
          error: `Refusing symlink in staged dir: ${firstRel}`,
        });
        return true;
      }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md --verify refuses forbidden dirs and the repo root', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      'refuses to stage into or verify `<root>` itself or inside `town-3d/`, `town-api/`, `town-npc/`, or `staging-polyfork/`'
    )
  );

  for (const forbidden of ['town-3d', 'town-api', 'town-npc', 'staging-polyfork']) {
    assert.throws(
      () => {
        execFileSync(
          process.execPath,
          [path.join(__dirname, 'stage-deploy.mjs'), '--verify', path.join(ROOT_DIR, forbidden)],
          { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
      },
      (err) => {
        assert.equal(err.status, 1);
        assert.ok(
          String(err.stderr || '').includes(`Refusing to verify inside ${forbidden}/:`),
          `expected Refusing to verify inside ${forbidden}/: in stderr`
        );
        return true;
      }
    );
  }

  assert.throws(
    () => {
      execFileSync(
        process.execPath,
        [path.join(__dirname, 'stage-deploy.mjs'), '--verify', ROOT_DIR],
        { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    },
    (err) => {
      assert.equal(err.status, 1);
      assert.ok(String(err.stderr || '').includes('Refusing to verify repo root:'));
      return true;
    }
  );
});

test('scripts/README.md check-live getExpectedFiles matches stage-deploy collectors', async () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      'imports `collectSourceFiles` and `listStagedFiles` from `stage-deploy.mjs` so both scripts resolve the exact same file list for each bundle'
    )
  );

  const { getExpectedFiles } = await import('./check-live.mjs');
  const { collectSourceFiles, listStagedFiles } = await import('./stage-deploy.mjs');

  const stagingExpected = await getExpectedFiles(ROOT_DIR, 'staging-polyfork');
  const { files: stagingCollected } = await collectSourceFiles(ROOT_DIR, 'staging-polyfork');
  assert.deepEqual(
    stagingExpected,
    stagingCollected.map((entry) => entry.relPath)
  );
  assert.equal(stagingExpected.length, 195);

  const town3dExpected = await getExpectedFiles(ROOT_DIR, 'town-3d');
  const town3dListed = await listStagedFiles(path.join(ROOT_DIR, 'town-3d'));
  assert.deepEqual(town3dExpected, town3dListed);
  assert.equal(town3dExpected.length, 25);
});

test('scripts/README.md town-3d staging facts match a real dry run and staged files are byte-identical', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(readmeNorm.includes('never bumps `?v=` in `index.html`'));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-town3d-facts-'));
  try {
    const stageOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const summary = JSON.parse(stageOut.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.bundle, 'town-3d');
    assert.equal(summary.file_count, 25);
    assert.equal(String(summary.town_js_v), '16');

    const stagedDir = path.join(tmpDir, 'ghostlight-town');
    const stagedIndex = fs.readFileSync(path.join(stagedDir, 'index.html'));
    const repoIndex = fs.readFileSync(path.join(ROOT_DIR, 'town-3d', 'index.html'));
    assert.equal(Buffer.compare(stagedIndex, repoIndex), 0);

    const manifest = JSON.parse(fs.readFileSync(path.join(stagedDir, 'MANIFEST.json'), 'utf8'));
    assert.equal(manifest.file_count, 25);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md secret-guard filename/content patterns match samples', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(readmeNorm.includes('blocks secret-like filenames or contents'));

  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');
  const filenameLiterals = ['/\\.pem$/i', '/\\.key$/i', '/token/i', '/secret/i', '/credential/i'];
  const contentLiterals = [
    '/api[_-]?key/i',
    '/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/',
    '/x-auth-token/i',
  ];

  const toRegExp = (literal) => {
    const lastSlash = literal.lastIndexOf('/');
    return new RegExp(literal.slice(1, lastSlash), literal.slice(lastSlash + 1));
  };

  for (const lit of [...filenameLiterals, ...contentLiterals]) {
    assert.ok(stageSrc.includes(lit), `stage-deploy.mjs must contain ${lit}`);
  }

  const filenameRes = filenameLiterals.map(toRegExp);
  const contentRes = contentLiterals.map(toRegExp);

  for (const badName of ['server.pem', 'id_rsa.key', 'api-token.txt', 'my-secret.yaml', 'credentials.json']) {
    assert.ok(
      filenameRes.some((re) => re.test(badName)),
      `expected ${badName} to match a secret filename regex`
    );
  }
  assert.equal(
    filenameRes.some((re) => re.test('town.js')),
    false,
    'town.js must not match any secret filename regex'
  );

  for (const badContent of [
    'api_key=abc',
    'api-key: xyz',
    '-----BEGIN RSA PRIVATE KEY-----',
    'x-auth-token: abc123',
  ]) {
    assert.ok(
      contentRes.some((re) => re.test(badContent)),
      `expected ${badContent} to match a secret content regex`
    );
  }
  assert.equal(
    contentRes.some((re) => re.test('hello world')),
    false,
    'hello world must not match any secret content regex'
  );
});

test('scripts/README.md unknown bundle and unknown argument rejected by both CLIs', () => {
  const readme = readReadme();
  assert.ok(readme.includes('**Bundles:** `town-3d` (default) or `staging-polyfork`'));

  const expectedUnknownBundle = 'Unknown bundle: bogus (expected one of: town-3d, staging-polyfork)';

  assert.throws(
    () => {
      execFileSync(
        process.execPath,
        [path.join(__dirname, 'check-live.mjs'), '--bundle', 'bogus'],
        { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    },
    (err) => {
      assert.equal(err.status, 1);
      const parsed = JSON.parse(String(err.stderr || '').trim());
      assert.equal(parsed.error, expectedUnknownBundle);
      return true;
    }
  );

  assert.throws(
    () => {
      execFileSync(
        process.execPath,
        [path.join(__dirname, 'check-live.mjs'), '--bogus'],
        { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    },
    (err) => {
      assert.equal(err.status, 1);
      assert.ok(String(err.stderr || '').includes('Unknown argument: --bogus'));
      return true;
    }
  );

  assert.throws(
    () => {
      execFileSync(
        process.execPath,
        [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'bogus'],
        { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    },
    (err) => {
      assert.equal(err.status, 1);
      assert.ok(String(err.stderr || '').includes(expectedUnknownBundle));
      return true;
    }
  );
});

test('scripts/README.md check-live fetch timeout is 5 seconds', () => {
  const checkLiveSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');
  assert.ok(checkLiveSrc.includes('const REQUEST_TIMEOUT_MS = 5000;'));
  assert.ok(checkLiveSrc.includes('AbortSignal.timeout(REQUEST_TIMEOUT_MS)'));
});

test('scripts/README.md PLAN.md section 8 reference resolves', () => {
  const plan = fs.readFileSync(path.join(ROOT_DIR, 'PLAN.md'), 'utf8');
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(plan.includes('## 8. MVP and phased roadmap'));
  assert.ok(readmeNorm.includes('and [`../PLAN.md`](../PLAN.md) §8 for bundle details and history.'));
});

test('scripts/README.md stage-deploy has no network access', () => {
  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');
  const fetchWord = `${'fe'}tch(`;
  assert.equal(stageSrc.includes(fetchWord), false, 'stage-deploy.mjs must not call fetch');
  assert.equal(stageSrc.includes('http://'), false, 'stage-deploy.mjs must not contain http://');
  assert.equal(stageSrc.includes('https://'), false, 'stage-deploy.mjs must not contain https://');

  const imports = [...stageSrc.matchAll(/^import .+ from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['node:crypto', 'node:fs/promises', 'node:path', 'node:url']);
});

test('scripts/README.md --verify is read-only', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(readmeNorm.includes('read-only check against `<dir>/MANIFEST.json`'));

  const snapshotDir = (dir, prefix = '', out = new Map()) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        snapshotDir(full, rel, out);
      } else {
        out.set(rel, fs.readFileSync(full));
      }
    }
    return out;
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-readonly-'));
  const stagedDir = path.join(tmpDir, 'ghostlight-town');
  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );

    const before = snapshotDir(stagedDir);
    execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--verify', stagedDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const after = snapshotDir(stagedDir);

    assert.deepEqual([...after.keys()], [...before.keys()]);
    for (const [rel, bufBefore] of before.entries()) {
      assert.equal(Buffer.compare(bufBefore, after.get(rel)), 0, `${rel} must be unchanged by --verify`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md title, heading order, and intro stay pinned', () => {
  const readme = readReadme();
  const norm = (s) => s.replace(/\s+/g, ' ');

  assert.equal(readme.split('\n')[0], '# Deploy Staging & Live Health Scripts (`scripts/`)');

  const heads = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, [
    'Shipped files',
    '`stage-deploy.mjs` (Slice 28)',
    '`check-live.mjs` (Slices 34, 100)',
    'Shared helpers',
    'Honest limits',
  ]);

  const n = norm(readme);
  assert.ok(
    n.includes('Local static-bundle staging and read-only live-site verification scripts for Ghostlight Town.')
  );
  assert.ok(n.includes('Neither script deploys to the homelab or mutates live state.'));
});

test('scripts/README.md Shipped files table role cells match verbatim', () => {
  const n = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    n.includes(
      'Slice 28 static deploy staging script: stages `town-3d/` (default bundle) or `staging-polyfork` under `<out>/ghostlight-town/` with a sha256 `MANIFEST.json`; `--verify <dir>` re-checks a staged directory (read-only).'
    )
  );
  assert.ok(
    n.includes(
      'Slices 34 & 100 read-only live-site health check: verifies `<base>/ghostlight-town/` against the selected local bundle (`staging-polyfork` by default, or `town-3d` as fallback).'
    )
  );
});

test('scripts/README.md stage-deploy section bullet lead-ins and opening paragraph stay pinned', () => {
  const readme = readReadme();
  const m = readme.match(/## `stage-deploy\.mjs` \(Slice 28\)\s+([\s\S]*?)(?:\n## |\n$)/);
  assert.ok(m, 'section `stage-deploy.mjs` (Slice 28) must exist');

  const leads = [...m[1].matchAll(/^- \*\*([^*]+)\*\*/gm)].map((x) => x[1]);
  assert.deepEqual(leads, [
    'Bundles:',
    'Target safety:',
    '`--verify <dir>`:',
    '`EXCLUDED_FILES` rule:',
    'Current staging facts:',
  ]);

  const n = readme.replace(/\s+/g, ' ');
  assert.ok(
    n.includes(
      'Stages the static 3D tree into `<out>/ghostlight-town/` and writes `MANIFEST.json` with per-file `sha256` hashes and byte counts. Local file operations only — never touches the homelab, never bumps `?v=` in `index.html`, and never stages `town-api/` or `town-npc/`.'
    )
  );
});

test('scripts/README.md check-live defaults bullet and Checks performed list stay pinned', () => {
  const readme = readReadme();
  const norm = (s) => s.replace(/\s+/g, ' ');
  const n = norm(readme);

  assert.ok(
    n.includes(
      '`--base https://milo.4167360.xyz`, `--bundle staging-polyfork`, `--api-base` defaults to `--base`, `--root` defaults to repo root.'
    )
  );

  const m = readme.match(/## `check-live\.mjs` \(Slices 34, 100\)\s+([\s\S]*?)(?:\n## |\n$)/);
  assert.ok(m, 'section `check-live.mjs` (Slices 34, 100) must exist');

  const lines = m[1].split('\n');
  const bullets = [];
  for (const line of lines) {
    if (line.startsWith('  - ')) bullets.push(line.slice(4));
    else if (line.startsWith('    ') && bullets.length) bullets[bullets.length - 1] += ' ' + line.trim();
  }
  const sub = bullets.map((b) => norm(b));
  assert.deepEqual(sub, [
    'HTTP 200 for every expected file in the selected bundle.',
    '`glTF` 4-byte magic header on `.glb` models.',
    '`staging.js?v=N` / `town.js?v=N` parity between repo `index.html` and live `index.html`.',
    'Required bundle JS markers (`PROP_PLACEMENTS`, `buildConceptBandstand`, `SEED_WANDER_CONFIG`, `newsstand_papers_shelf` for `town-3d`; `applyStagingState`, `liveStore`, `buildConceptBandstand`, `concept-bandstand.js` for `staging-polyfork`).',
    '`gazette/latest.json` parses cleanly and its `issue-*.html` target returns HTTP 200.',
    'Informational check of `<api-base>/api/town/state`; pass `--require-api` to make a non-200 API response fail the run.',
  ]);
});

test('scripts/README.md Shared helpers parenthetical matches stage-deploy and check-live exports and imports', () => {
  const n = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    n.includes(
      '(`stage-deploy.mjs` also exports `EXCLUDED_FILES`, `collectSourceFilesFromTown3d`, and `collectSourceFilesFromStagingPolyfork`; `check-live.mjs` exports `getExpectedFiles`)'
    )
  );

  const checkSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');
  assert.ok(checkSrc.includes("import { collectSourceFiles, listStagedFiles } from './stage-deploy.mjs';"));

  const stageSrc = fs.readFileSync(path.join(__dirname, 'stage-deploy.mjs'), 'utf8');
  for (const sym of [
    'EXCLUDED_FILES',
    'collectSourceFilesFromTown3d',
    'collectSourceFilesFromStagingPolyfork',
    'collectSourceFiles',
    'listStagedFiles',
  ]) {
    assert.ok(
      stageSrc.includes('export ') && new RegExp(`export (?:const|async function|function) ${sym}\\b`).test(stageSrc),
      `stage-deploy.mjs must export ${sym}`
    );
  }
  assert.ok(/export async function getExpectedFiles/.test(checkSrc));
});

test('scripts/README.md Honest limits bullets and closing cross-links stay pinned', () => {
  const readme = readReadme();
  const norm = (s) => s.replace(/\s+/g, ' ');

  const m = readme.match(/## Honest limits\s+([\s\S]*?)(?:\n## |\n$)/);
  assert.ok(m, 'section Honest limits must exist');

  const leads = [...m[1].matchAll(/^- \*\*([^*]+)\*\*/gm)].map((x) => x[1]);
  assert.deepEqual(leads, ['Staging is not deploying:', '`check-live.mjs` is read-only:']);

  const secNorm = norm(m[1]);
  assert.ok(secNorm.includes('prepares and verifies a local staging directory only'));
  assert.ok(secNorm.includes("deploying to the homelab is Milo's call in a foreground turn."));
  assert.ok(secNorm.includes('it reads and reports on the live site and cannot fix or mutate it.'));

  const n = norm(readme);
  assert.ok(
    n.includes(
      'See [`../town-3d/README.md`](../town-3d/README.md), [`../staging-polyfork/README.md`](../staging-polyfork/README.md), and [`../PLAN.md`](../PLAN.md) §8 for bundle details and history.'
    )
  );
  const hrefs = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((x) => x[1])
    .filter((h) => !h.startsWith('http'));
  assert.deepEqual(hrefs.slice(-3), ['../town-3d/README.md', '../staging-polyfork/README.md', '../PLAN.md']);
});

test('scripts/README.md stage-deploy summary and MANIFEST exact key sets match both bundles', () => {
  const dryRun = (bundle) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-keys-'));
    try {
      const out = execFileSync(
        process.execPath,
        [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', bundle, '--out', tmp],
        { cwd: ROOT_DIR, encoding: 'utf8' }
      );
      const summary = JSON.parse(out.trim());
      const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'ghostlight-town', 'MANIFEST.json'), 'utf8'));
      return { summary, manifest };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  const town3d = dryRun('town-3d');
  assert.deepEqual(Object.keys(town3d.summary), [
    'ok',
    'out',
    'bundle',
    'town_js_v',
    'staging_js_v',
    'file_count',
    'total_bytes',
  ]);
  assert.equal(town3d.summary.ok, true);
  assert.equal(town3d.summary.bundle, 'town-3d');
  assert.equal(town3d.summary.town_js_v, '16');
  assert.equal(town3d.summary.staging_js_v, null);
  assert.equal(town3d.summary.file_count, 25);

  const staging = dryRun('staging-polyfork');
  assert.deepEqual(Object.keys(staging.summary), [
    'ok',
    'out',
    'bundle',
    'town_js_v',
    'staging_js_v',
    'file_count',
    'total_bytes',
  ]);
  assert.equal(staging.summary.ok, true);
  assert.equal(staging.summary.bundle, 'staging-polyfork');
  assert.equal(staging.summary.town_js_v, null);
  assert.equal(staging.summary.staging_js_v, '41');
  assert.equal(staging.summary.file_count, 195);

  assert.deepEqual(Object.keys(staging.manifest), [
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
  assert.equal(staging.manifest.source, 'ghostlight-town repo tree');
  assert.deepEqual(staging.manifest.not_staged, [
    'town-api/ (server-side, separate deploy)',
    'town-npc/ (server-side, separate deploy)',
  ]);
  assert.equal(
    staging.manifest.total_bytes,
    staging.manifest.files.reduce((s, f) => s + f.bytes, 0)
  );
});

test('scripts/README.md check-live BUNDLE_CONFIG and apiStatus strings stay pinned', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');
  const cfg = (name) => {
    const m = src.match(
      new RegExp(`'${name}': \\{[\\s\\S]*?entryJs: '([^']+)',[\\s\\S]*?versionKey: '([^']+)',[\\s\\S]*?versionRe: (\\/[^/]+\\/)[,\\n]`)
    );
    assert.ok(m, `BUNDLE_CONFIG[${name}] must parse`);
    return { entryJs: m[1], versionKey: m[2], versionRe: m[3] };
  };
  assert.deepEqual(cfg('town-3d'), {
    entryJs: 'town.js',
    versionKey: 'town_js_v',
    versionRe: '/town\\.js\\?v=(\\d+)/',
  });
  assert.deepEqual(cfg('staging-polyfork'), {
    entryJs: 'staging.js',
    versionKey: 'staging_js_v',
    versionRe: '/staging\\.js\\?v=(\\d+)/',
  });
  assert.ok(src.includes("let apiStatus = 'not-live';"));
  assert.ok(src.includes("apiStatus = 'live';"));
});

test('scripts/README.md EXCLUDED_FILES export, README bullet, and real town-3d manifest excluded match', async () => {
  const { EXCLUDED_FILES } = await import('./stage-deploy.mjs');
  assert.deepEqual(EXCLUDED_FILES, [
    {
      repoPath: 'town-3d/models/pine.glb',
      relPath: 'models/pine.glb',
      reason: 'deliberately uncommitted, 2.2 MB — procedural trees stay',
    },
  ]);

  const n = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    n.includes(
      'excludes `town-3d/models/pine.glb` (`models/pine.glb`, 2.2 MB, local-only, deliberately never committed or shipped; procedural trees stay). Also excludes `gazette/*.mjs` build tools in `town-3d/`, `test-*.mjs` and `README.md` in `staging-polyfork/`, and blocks secret-like filenames or contents.'
    )
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-excl-'));
  try {
    execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', tmp],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'ghostlight-town', 'MANIFEST.json'), 'utf8'));
    const byPath = new Map(manifest.excluded.map((e) => [e.path, e.reason]));
    assert.equal(byPath.get('models/pine.glb'), 'deliberately uncommitted, 2.2 MB — procedural trees stay');
    assert.equal(byPath.get('gazette/build-digest.mjs'), 'build tool, not served content');
    assert.equal(byPath.get('gazette/build-feed.mjs'), 'build tool, not served content');
    const paths = manifest.excluded.map((e) => e.path);
    assert.deepEqual(paths, [...paths].sort());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scripts/README.md and test-readme.mjs hygiene guards hold', () => {
  const testSrc = fs.readFileSync(path.join(__dirname, 'test-readme.mjs'), 'utf8');
  const readme = readReadme();

  assert.equal(testSrc.includes(`${'fe'}tch(`), false, 'test file must not contain a literal fetch call');
  assert.equal(testSrc.includes(`Math.${'random'}`), false, 'test file must not contain Math random');
  assert.doesNotMatch(testSrc, BANNED_TERM_RE);

  assert.equal(readme.includes('http://'), false, 'README must not contain http://');
  for (const w of ['rsync', 'ssh ', 'scp ']) {
    assert.equal(readme.includes(w), false, `README must not contain ${w}`);
  }
  assert.doesNotMatch(readme, BANNED_TERM_RE);
});

test('scripts/README.md --verify success JSON exact keys and values for town-3d', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-verify-ok-'));
  const stagedDir = path.join(tmpDir, 'ghostlight-town');
  try {
    const stageOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const summary = JSON.parse(stageOut.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.file_count, 25);

    const verifyOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--verify', stagedDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const result = JSON.parse(verifyOut.trim());
    assert.deepEqual(Object.keys(result), [
      'status',
      'bundle',
      'checked',
      'ok',
      'mismatch',
      'missing',
      'extra',
      'town_js_v',
      'staging_js_v',
    ]);
    assert.equal(result.status, 'ok');
    assert.equal(result.bundle, 'town-3d');
    assert.equal(result.checked, 25);
    assert.equal(result.ok, 25);
    assert.deepEqual(result.mismatch, []);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.extra, []);
    assert.equal(result.town_js_v, '16');
    assert.equal(result.staging_js_v, null);
    assert.equal('staged_town_js_v' in result, false, 'clean verify must not carry staged_town_js_v');
    assert.equal('staged_staging_js_v' in result, false, 'clean verify must not carry staged_staging_js_v');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md town-3d MANIFEST.json exact keys, source, and totals match a real dry run', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-readme-town3d-manifest-'));
  try {
    const stageOut = execFileSync(
      process.execPath,
      [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', tmpDir],
      { cwd: ROOT_DIR, encoding: 'utf8' }
    );
    const summary = JSON.parse(stageOut.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.bundle, 'town-3d');

    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'ghostlight-town', 'MANIFEST.json'), 'utf8')
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
    assert.equal(manifest.bundle, 'town-3d');
    assert.equal(manifest.town_js_v, '16');
    assert.equal(manifest.staging_js_v, null);
    assert.equal(manifest.file_count, 25);
    assert.equal(manifest.files.length, 25);
    assert.deepEqual(manifest.not_staged, [
      'town-api/ (server-side, separate deploy)',
      'town-npc/ (server-side, separate deploy)',
    ]);
    assert.match(manifest.staged_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(Number.isNaN(Date.parse(manifest.staged_at)), false, 'staged_at must parse as a date');
    assert.equal(
      manifest.total_bytes,
      manifest.files.reduce((sum, entry) => sum + entry.bytes, 0),
      'manifest total_bytes must equal the sum of file bytes'
    );
    assert.equal(manifest.total_bytes, summary.total_bytes);
    const paths = manifest.files.map((entry) => entry.path);
    assert.deepEqual(paths, [...paths].sort(), 'manifest files must be sorted by path');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scripts/README.md stage-deploy refuses to stage into town-api/ and staging-polyfork/', () => {
  const readme = readReadme();
  assert.ok(readme.includes('refuses to stage\n  into or verify `<root>` itself or inside `town-3d/`'));

  for (const forbidden of ['town-api', 'staging-polyfork']) {
    assert.throws(
      () => {
        execFileSync(
          process.execPath,
          [path.join(__dirname, 'stage-deploy.mjs'), '--bundle', 'town-3d', '--out', path.join(ROOT_DIR, forbidden)],
          { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
      },
      (err) => {
        assert.equal(err.status, 1);
        const parsed = JSON.parse(String(err.stderr || '').trim());
        assert.equal(parsed.ok, false);
        assert.equal(
          parsed.error,
          `Refusing to stage into inside ${forbidden}/: ${path.join(ROOT_DIR, forbidden)}`
        );
        return true;
      }
    );
  }
});

test('scripts/README.md stage-deploy parseArgs edge errors match source', () => {
  const runExpectFail = (args) => {
    try {
      execFileSync(
        process.execPath,
        [path.join(__dirname, 'stage-deploy.mjs'), ...args],
        { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      assert.fail(`expected stage-deploy.mjs ${args.join(' ')} to fail`);
    } catch (err) {
      assert.equal(err.status, 1);
      return JSON.parse(String(err.stderr || '').trim());
    }
    return null;
  };

  const noBundle = runExpectFail(['--bundle']);
  assert.equal(noBundle.ok, false);
  assert.equal(noBundle.error, '--bundle requires a bundle name argument');

  const conflict = runExpectFail(['--verify', '/tmp/ghostlight-448-x', '--out', '/tmp/ghostlight-448-y']);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, '--verify cannot be combined with --out');

  const bogus = runExpectFail(['--bogus']);
  assert.equal(bogus.ok, false);
  assert.equal(bogus.error, 'Unknown argument: --bogus');
});

test('scripts/README.md check-live BUNDLE_CONFIG marker arrays stay pinned exactly', () => {
  const checkLiveSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');
  const parseMarkers = (bundleName) => {
    const m = checkLiveSrc.match(
      new RegExp(`'${bundleName}':[\\s\\S]*?markers:\\s*\\[([\\s\\S]*?)\\]`)
    );
    assert.ok(m, `Missing BUNDLE_CONFIG[${bundleName}].markers in check-live.mjs`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  assert.deepEqual(parseMarkers('town-3d'), [
    'PROP_PLACEMENTS',
    'buildConceptBandstand',
    'SEED_WANDER_CONFIG',
    'newsstand_papers_shelf',
  ]);
  assert.deepEqual(parseMarkers('staging-polyfork'), [
    'applyStagingState',
    'liveStore',
    'buildConceptBandstand',
    'concept-bandstand.js',
  ]);
});

test('scripts/README.md staging-polyfork expected files carry all 12 shared town-3d files', async () => {
  const { getExpectedFiles } = await import('./check-live.mjs');

  const sharedTown3dFiles = [
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

  const stagingExpected = await getExpectedFiles(ROOT_DIR, 'staging-polyfork');
  assert.equal(stagingExpected.length, 195);
  for (const shared of sharedTown3dFiles) {
    assert.ok(stagingExpected.includes(shared), `staging-polyfork expected files must include shared ${shared}`);
  }
  assert.equal(stagingExpected[0], 'anim/anim-idle.json');
  assert.equal(stagingExpected[stagingExpected.length - 1], 'tap-glide.mjs');
  assert.deepEqual(stagingExpected, [...stagingExpected].sort(), 'staging-polyfork expected files must be sorted');

  const town3dExpected = await getExpectedFiles(ROOT_DIR, 'town-3d');
  assert.equal(town3dExpected.length, 25);
  assert.equal(town3dExpected[0], 'CREDITS.md');
  assert.equal(town3dExpected[town3dExpected.length - 1], 'town.js');
  assert.deepEqual(town3dExpected, [...town3dExpected].sort(), 'town-3d expected files must be sorted');
});

test('scripts/README.md staging facts sentence and test-suites line stay verbatim', () => {
  const readme = readReadme();
  const norm = readme.replace(/\s+/g, ' ');
  assert.ok(
    norm.includes(
      'staging bundle `staging-polyfork` stages **195 files** with `staging_js_v` **41** (verified with `--bundle staging-polyfork` and `--verify`).'
    )
  );
  assert.ok(
    readme.includes(
      'Test suites (3, all registered in [`../run-tests.mjs`](../run-tests.mjs)):\n`test-check-live.mjs`, `test-stage-deploy.mjs`, `test-readme.mjs`.'
    )
  );
});

test('scripts/README.md relative cross-links exact ordered set', () => {
  const readme = readReadme();
  const hrefs = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((m) => m[1])
    .filter((href) => !/^https?:\/\//.test(href));
  assert.deepEqual(hrefs, [
    '../run-tests.mjs',
    '../town-3d/README.md',
    '../staging-polyfork/README.md',
    '../PLAN.md',
  ]);
});

test('scripts/README.md check-live imports and getExpectedFiles unknown-bundle rejection', async () => {
  const checkLiveSrc = fs.readFileSync(path.join(__dirname, 'check-live.mjs'), 'utf8');
  const imports = [...checkLiveSrc.matchAll(/^import .+ from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['node:fs/promises', 'node:path', 'node:url', './stage-deploy.mjs']);

  const { getExpectedFiles } = await import('./check-live.mjs');
  await assert.rejects(
    () => getExpectedFiles(ROOT_DIR, 'bogus'),
    (err) => {
      assert.equal(err.message, 'Unknown bundle: bogus (expected one of: town-3d, staging-polyfork)');
      return true;
    }
  );
});

test('scripts/README.md and test-readme.mjs hygiene counts hold at 52 tests', () => {
  const testSrc = fs.readFileSync(path.join(__dirname, 'test-readme.mjs'), 'utf8');
  const readme = readReadme();

  const testNames = [...testSrc.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(testNames.length, 52, 'test file must hold 52 top-level tests');
  assert.equal(new Set(testNames).size, 52, 'test names must be unique');

  const importLines = [...testSrc.matchAll(/^import .+$/gm)].map((m) => m[0]);
  assert.deepEqual(importLines, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { execFileSync } from 'node:child_process';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
  ]);

  const retiredCount = (testSrc.match(new RegExp(BANNED_TERM_RE.source, 'gi')) || []).length;
  assert.equal(retiredCount, 0, 'retired term must not appear in the test file');
  assert.doesNotMatch(readme, BANNED_TERM_RE);

  const fetchCallCount = (testSrc.match(/fetch\(/g) || []).length;
  assert.equal(fetchCallCount, 0, 'test file must not contain the literal ' + 'fetch' + '(' + ' call');
  const randomCount = (testSrc.match(/Math\.random/g) || []).length;
  assert.equal(randomCount, 0, 'test file must not contain ' + 'Math.' + 'random');
  const dateNowCount = (testSrc.match(/Date\.now/g) || []).length;
  assert.equal(dateNowCount, 0, 'test file must not contain ' + 'Date.' + 'now');
  const todoCount = (testSrc.match(new RegExp('TO' + 'DO', 'g')) || []).length;
  assert.equal(todoCount, 0, 'test file must not contain ' + 'TO' + 'DO');
  const fixmeCount = (testSrc.match(new RegExp('FIX' + 'ME', 'g')) || []).length;
  assert.equal(fixmeCount, 0, 'test file must not contain ' + 'FIX' + 'ME');
});
