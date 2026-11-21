/**
 * Ghostlight Town — drift guard for town-3d/README.md (Slice 123)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourceFilesFromTown3d, collectSourceFiles } from '../scripts/stage-deploy.mjs';

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

test('town-3d/README.md states the fallback-vs-staging role and shared 12-file / 193-file bundle split', () => {
  const readme = readReadme();
  assert.match(readme, /staging-polyfork/i);
  assert.match(readme, /fallback/i);
  assert.match(readme, /\b12\b.*(?:shared|town-3d)/i);
  assert.match(readme, /\b193-file\b/);
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

test('town-3d/README.md fallback bundle count matches collectSourceFilesFromTown3d', async () => {
  const readme = readReadme();
  const { files, excluded } = await collectSourceFilesFromTown3d(__dirname);
  assert.ok(
    readme.includes(`${files.length}-file fallback bundle`),
    `town-3d/README.md must state ${files.length}-file fallback bundle`
  );
  for (const file of files) {
    const base = path.basename(file.relPath);
    assert.ok(
      readme.includes(`\`${base}\``),
      `town-3d/README.md must mention collected file basename \`${base}\``
    );
  }
  assert.ok(
    !files.some((f) => f.relPath === 'models/pine.glb'),
    'models/pine.glb must not be in collected files'
  );
  const pineExcluded = excluded.find((e) => e.path === 'models/pine.glb');
  assert.ok(pineExcluded, 'models/pine.glb must be in excluded array');
  assert.match(pineExcluded.reason, /uncommitted/i);
});

test('town-3d/README.md staging bundle count matches collectSourceFiles', async () => {
  const readme = readReadme();
  const { files } = await collectSourceFiles(REPO_ROOT, 'staging-polyfork');
  assert.ok(
    readme.includes(`${files.length}-file \`staging-polyfork\``),
    `town-3d/README.md must state ${files.length}-file \`staging-polyfork\``
  );
});

test('town-3d/README.md models section names every committed CC0 prop', async () => {
  const readme = readReadme();
  const modelsDir = path.join(__dirname, 'models');
  const glbFiles = fs
    .readdirSync(modelsDir)
    .filter((name) => name.endsWith('.glb'))
    .sort();
  assert.equal(glbFiles.length, 8, 'town-3d/models/ must have 8 .glb files locally');
  assert.ok(
    readme.includes(`${glbFiles.length} \`.glb\` files locally`),
    `town-3d/README.md must state ${glbFiles.length} \`.glb\` files locally`
  );
  const committed = glbFiles.filter((name) => name !== 'pine.glb');
  assert.equal(committed.length, 7, 'committed CC0 props must be 7');
  for (const prop of committed) {
    assert.ok(
      readme.includes(`\`${prop}\``),
      `town-3d/README.md must name committed CC0 prop \`${prop}\``
    );
  }
  const { excluded } = await collectSourceFilesFromTown3d(__dirname);
  assert.ok(
    excluded.some((e) => e.path === 'models/pine.glb'),
    'models/pine.glb must appear in excluded array'
  );
});

test('town-3d/README.md Behaviour functions exist in town.js', () => {
  const readme = readReadme();
  const behaviourMatch = readme.match(/## Behaviour\r?\n([\s\S]*?)(?:\r?\n## |\s*$)/);
  assert.ok(behaviourMatch, 'town-3d/README.md must have a ## Behaviour section');
  const behaviourSection = behaviourMatch[1];
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  const fns = [
    'buildWanderState',
    'formatFootlightStatusLines',
    'commonWindowMaterial',
    'formatPlotGuestbookTabLabel',
    'resolvePlotGuestbookOverlayContent',
    'buildNoticeBoardOverlayHtml',
  ];
  for (const fn of fns) {
    assert.ok(
      behaviourSection.includes(fn),
      `town-3d/README.md Behaviour section must mention ${fn}`
    );
    assert.ok(
      townJs.includes(fn),
      `town-3d/town.js must contain ${fn}`
    );
  }
});

test('town-3d/README.md shipped-table files exist on disk', () => {
  const expectedFiles = [
    'town.js',
    'concept-bandstand.js',
    'concept-cottage.js',
    'concept-ghost.js',
    'index.html',
    'move-in.html',
    'inn/index.html',
    'guestbook/index.html',
    'plots/milo/index.html',
    'plots/wick/index.html',
    'plots/maren/index.html',
    'plots/tomas/index.html',
    'gazette/issue-001.html',
    'gazette/issue-002.html',
    'gazette/issue-003.html',
    'gazette/latest.json',
    'gazette/feed.xml',
    'gazette/build-digest.mjs',
    'gazette/build-feed.mjs',
    'CREDITS.md',
  ];
  for (const relPath of expectedFiles) {
    assert.ok(
      fs.existsSync(path.join(__dirname, relPath)),
      `town-3d/${relPath} must exist on disk`
    );
  }
});

test('town-3d/README.md town.js line count is within 100 of actual', () => {
  const readme = readReadme();
  const match = readme.match(/`town\.js`[^|\n]*\|[^|\n]*~([\d,]+)\s+lines/);
  assert.ok(match, 'town-3d/README.md shipped table must state ~<n> lines for town.js');
  const stated = Number(match[1].replaceAll(',', ''));
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  const actual = townJs.split('\n').length - 1;
  assert.ok(
    Math.abs(actual - stated) <= 100,
    `town-3d/README.md town.js line count (${stated}) must be within 100 of actual (${actual})`
  );
});
