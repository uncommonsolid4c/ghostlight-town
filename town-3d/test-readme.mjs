/**
 * Ghostlight Town — drift guard for town-3d/README.md (Slice 123)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const README_PATH = path.join(__dirname, 'README.md');
const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');

function readReadme() {
  return fs.readFileSync(README_PATH, 'utf8');
}

test('town-3d/README.md names every shipped .js file in town-3d/', () => {
  const readme = readReadme();
  const shippedFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js') && !entry.name.startsWith('test-'))
    .map((entry) => entry.name)
    .sort();

  assert.ok(shippedFiles.length > 0, 'town-3d/ must contain shipped .js files');
  for (const file of shippedFiles) {
    assert.ok(
      readme.includes(`\`${file}\``),
      `town-3d/README.md must document shipped file ${file}`
    );
  }
});

test('town-3d/README.md states the fallback-vs-staging role and shared 11-file / 191-file bundle split', () => {
  const readme = readReadme();
  assert.match(readme, /staging-polyfork/i);
  assert.match(readme, /fallback/i);
  assert.match(readme, /\b11\b.*(?:shared|town-3d)/i);
  assert.match(readme, /\b191-file\b/);
  assert.match(readme, /town\.js\?v=16/);
});

test('town-3d/README.md states pine.glb is local-only and never committed or shipped', () => {
  const readme = readReadme();
  assert.match(readme, /`pine\.glb`/);
  assert.match(readme, /local-only/i);
  assert.match(readme, /never committed or\s+shipped/i);
  assert.match(readme, /procedural trees stay/i);
});

test('town-3d/README.md states the 152 (< 155) mesh budget, 9 VALID_PROP_KINDS, and omits banned terms', () => {
  const readme = readReadme();
  assert.match(readme, /\b152\b/);
  assert.match(readme, /<\s*155\b/);
  assert.match(readme, /VALID_PROP_KINDS/);
  assert.match(readme, /\b9\b/);
  assert.doesNotMatch(readme, BANNED_TERM_RE);
});

const REPO_ROOT = path.resolve(__dirname, '..');

test('town-3d/README.md ?v= pin matches town-3d/index.html', () => {
  const readme = readReadme();
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const match = indexHtml.match(/\.\/town\.js\?v=(\d+)/);
  assert.ok(match, 'town-3d/index.html must reference ./town.js?v=<n>');
  const version = match[1];
  const readmeMatches = [...readme.matchAll(/town\.js\?v=(\d+)/g)];
  assert.ok(readmeMatches.length > 0, 'town-3d/README.md must mention town.js?v=<n>');
  for (const m of readmeMatches) {
    assert.equal(
      m[1],
      version,
      `town-3d/README.md ?v=${m[1]} drifted from town-3d/index.html ?v=${version}`
    );
  }
});

test('town-3d/README.md mesh count and budget match town-3d/test-3d.mjs', () => {
  const readme = readReadme();
  const test3d = fs.readFileSync(path.join(__dirname, 'test-3d.mjs'), 'utf8');
  const match = test3d.match(
    /test\('Draw-call budget: total mesh count in built town is (\d+) \(< (\d+)\)'/
  );
  assert.ok(match, 'town-3d/test-3d.mjs must contain Draw-call budget test');
  const [, meshCount, meshBudget] = match;
  assert.match(
    readme,
    new RegExp(`\\b${meshCount}\\s+meshes,\\s*budget\\s*\`<\\s*${meshBudget}\``),
    `town-3d/README.md mesh budget must match test-3d.mjs (${meshCount} meshes, < ${meshBudget})`
  );
});

test('town-3d/README.md Gazette latest number and issues match town-3d/gazette/latest.json', () => {
  const readme = readReadme();
  const latestJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'gazette', 'latest.json'), 'utf8')
  );
  assert.equal(typeof latestJson.latest, 'number', 'latest.json must have numeric latest');
  assert.ok(
    readme.includes(`"latest": ${latestJson.latest}`),
    `town-3d/README.md must state "latest": ${latestJson.latest}`
  );
  for (const issue of latestJson.issues) {
    assert.ok(
      readme.includes(`\`${issue.file}\``),
      `town-3d/README.md must list Gazette issue ${issue.file}`
    );
  }
});

test('town-3d/README.md shared-file count matches STAGING_SHARED_TOWN3D_FILES in scripts/stage-deploy.mjs', () => {
  const readme = readReadme();
  const stageDeploy = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'stage-deploy.mjs'),
    'utf8'
  );
  const blockMatch = stageDeploy.match(
    /const STAGING_SHARED_TOWN3D_FILES = \[([\s\S]*?)\];/
  );
  assert.ok(blockMatch, 'scripts/stage-deploy.mjs must define STAGING_SHARED_TOWN3D_FILES');
  const entries = [...blockMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(entries.length > 0, 'STAGING_SHARED_TOWN3D_FILES must be non-empty');
  assert.match(
    readme,
    new RegExp(`\\b${entries.length}\\s+shared files\\b`),
    `town-3d/README.md must state ${entries.length} shared files`
  );
  assert.match(
    readme,
    new RegExp(`\\b${entries.length}\\s+\`town-3d/\`\\s+files\\b`),
    `town-3d/README.md must state ${entries.length} \`town-3d/\` files`
  );
});

test('town-3d/README.md test-suite count and list match run-tests.mjs', () => {
  const readme = readReadme();
  const runTests = fs.readFileSync(path.join(REPO_ROOT, 'run-tests.mjs'), 'utf8');
  const registered = [...runTests.matchAll(/'town-3d\/(test-[^']+\.mjs)'/g)]
    .map((m) => m[1])
    .sort();
  assert.ok(registered.length > 0, 'run-tests.mjs must register town-3d test suites');
  assert.match(
    readme,
    new RegExp(`Test suites \\(${registered.length},`),
    `town-3d/README.md must state Test suites (${registered.length}, ...)`
  );
  for (const suite of registered) {
    assert.ok(
      readme.includes(`\`${suite}\``),
      `town-3d/README.md must list registered test suite ${suite}`
    );
  }
});

test('town-3d/README.md VALID_PROP_KINDS count and names match town-3d/town.js', () => {
  const readme = readReadme();
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  const blockMatch = townJs.match(/const VALID_PROP_KINDS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(blockMatch, 'town-3d/town.js must define VALID_PROP_KINDS');
  const kinds = [...blockMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(kinds.length > 0, 'VALID_PROP_KINDS must be non-empty');
  assert.match(
    readme,
    new RegExp(`\\b${kinds.length}\\s+kinds in \`VALID_PROP_KINDS\``),
    `town-3d/README.md must state ${kinds.length} kinds in VALID_PROP_KINDS`
  );
  for (const kind of kinds) {
    assert.ok(
      readme.includes(`\`${kind}\``),
      `town-3d/README.md must list starter prop kind ${kind}`
    );
  }
});
