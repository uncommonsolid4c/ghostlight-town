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
