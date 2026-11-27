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

test('town-3d/README.md states the fallback-vs-staging role and shared 12-file / 195-file bundle split', () => {
  const readme = readReadme();
  assert.match(readme, /staging-polyfork/i);
  assert.match(readme, /fallback/i);
  assert.match(readme, /\b12\b.*(?:shared|town-3d)/i);
  assert.match(readme, /\b195-file\b/);
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

test('town-3d/README.md Behaviour functions exist in their modules', () => {
  const readme = readReadme();
  const behaviourMatch = readme.match(/## Behaviour\r?\n([\s\S]*?)(?:\r?\n## |\s*$)/);
  assert.ok(behaviourMatch, 'town-3d/README.md must have a ## Behaviour section');
  const behaviourSection = behaviourMatch[1];
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  const fns = [
    'buildWanderState',
    'commonWindowMaterial',
    'formatPlotGuestbookTabLabel',
    'resolvePlotGuestbookOverlayContent',
    'buildNoticeBoardOverlayHtml',
    'setAvatarStatusText',
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
  // Slice 319: the footlight placard render moved out of town.js — the
  // Behaviour bullet now names lightFootlightSlot in concept-bandstand.js,
  // which owns formatFootlightStatusLines; town.js applyState delegates to it.
  const bandstandJs = fs.readFileSync(path.join(__dirname, 'concept-bandstand.js'), 'utf8');
  assert.ok(
    behaviourSection.includes('lightFootlightSlot'),
    'town-3d/README.md Behaviour section must mention lightFootlightSlot'
  );
  assert.ok(
    bandstandJs.includes('function formatFootlightStatusLines(statusText)'),
    'town-3d/concept-bandstand.js must contain formatFootlightStatusLines'
  );
  assert.match(
    bandstandJs,
    /lightFootlightSlot\(THREE, flGroup, \{[^}]*statusText/,
    'town-3d/concept-bandstand.js lightFootlightSlot must accept statusText'
  );
  assert.equal(
    townJs.includes('function formatFootlightStatusLines'),
    false,
    'town-3d/town.js must no longer define formatFootlightStatusLines'
  );
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

test('town-3d/README.md shipped table concept files are vendored Argon proofs with the named builders', () => {
  const readme = readReadme();
  const concepts = [
    ['concept-bandstand.js', 'buildConceptBandstand', 'Vendored Argon bandstand proof'],
    ['concept-cottage.js', 'createConceptMilosCottage', 'Vendored Argon cottage proof'],
    ['concept-ghost.js', 'createConceptMiloGhost', 'Vendored Argon ghost proof'],
  ];
  for (const [file, builder, phrase] of concepts) {
    assert.ok(readme.includes(`\`${file}\``), `README must mention \`${file}\``);
    assert.ok(readme.includes(`\`${builder}\``), `README must mention \`${builder}\``);
    assert.ok(readme.includes(phrase), `README must include "${phrase}"`);
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(
      src.includes(`export function ${builder}(THREE, options = {})`),
      `${file} must export function ${builder}(THREE, options = {})`
    );
  }
});

test('town-3d/README.md Honest limits no-fetch claim matches town.js and test-3d.mjs; index.html fetches gazette/latest.json', () => {
  const fetchCall = `fetch${'('}`;
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.equal(townJs.includes(fetchCall), false, 'town.js must contain no fetch call');
  assert.doesNotMatch(townJs, /\bfetch\s*\(/, 'town.js must not match /\\bfetch\\s*\\(/');

  const test3d = fs.readFileSync(path.join(__dirname, 'test-3d.mjs'), 'utf8');
  assert.ok(
    test3d.includes(`town.js must not call ${fetchCall}`),
    'test-3d.mjs must enforce no-fetch rule'
  );
  assert.ok(
    test3d.includes('/\\bfetch\\s*\\(/'),
    'test-3d.mjs must contain /\\bfetch\\s*\\(/ regex source'
  );

  assert.ok(
    readmeNorm.includes(`No literal \`${fetchCall}\` in \`town.js\``),
    'README must state no literal fetch in town.js'
  );
  assert.ok(
    readmeNorm.includes('`index.html` fetches `gazette/latest.json` directly'),
    'README must state index.html fetches gazette/latest.json directly'
  );

  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(
    indexHtml.includes(`${fetchCall}'gazette/latest.json')`),
    'town-3d/index.html must fetch gazette/latest.json'
  );
});

test('town-3d/README.md models bullet CREDITS.md names every committed CC0 prop with a CC0 1.0 licence', () => {
  const readme = readReadme();
  const glbFiles = fs
    .readdirSync(path.join(__dirname, 'models'))
    .filter((name) => name.endsWith('.glb'))
    .sort();
  assert.equal(glbFiles.length, 8, 'town-3d/models/ must hold exactly 8 .glb files');
  const expectedProps = [
    'bench.glb',
    'bookshelf.glb',
    'lantern.glb',
    'oil-lamp.glb',
    'post-lantern.glb',
    'street-light.glb',
    'teapot.glb',
  ];
  const committed = glbFiles.filter((name) => name !== 'pine.glb');
  assert.deepEqual(committed, [...expectedProps].sort(), 'committed props must match expected 7');

  const credits = fs.readFileSync(path.join(__dirname, 'CREDITS.md'), 'utf8');
  for (const prop of expectedProps) {
    assert.ok(credits.includes(`models/${prop}`), `CREDITS.md must contain models/${prop}`);
    assert.ok(readme.includes(`\`${prop}\``), `README models bullet must name \`${prop}\``);
  }
  const licenceMatches = credits.match(/Licence: CC0 1\.0/g) ?? [];
  assert.equal(licenceMatches.length, 7, 'CREDITS.md must contain exactly 7 Licence: CC0 1.0 lines');
  assert.ok(
    credits.includes('CC0 1.0 requires no attribution'),
    'CREDITS.md must state CC0 1.0 requires no attribution'
  );
});

test('town-3d/README.md shared-files bullet membership matches STAGING_SHARED_TOWN3D_FILES in scripts/stage-deploy.mjs', () => {
  const readme = readReadme();
  const readmeNorm = readme.replace(/\s+/g, ' ');
  const stageDeploy = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'stage-deploy.mjs'),
    'utf8'
  );
  const blockMatch = stageDeploy.match(/const STAGING_SHARED_TOWN3D_FILES = \[([\s\S]*?)\];/);
  assert.ok(blockMatch, 'scripts/stage-deploy.mjs must define STAGING_SHARED_TOWN3D_FILES');
  const entries = [...blockMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const expected = [
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
  assert.deepEqual(entries, expected, 'STAGING_SHARED_TOWN3D_FILES must match the 12 expected entries');
  for (const rel of entries) {
    assert.ok(fs.existsSync(path.join(__dirname, rel)), `town-3d/${rel} must exist on disk`);
    const base = path.basename(rel);
    assert.ok(readme.includes(`\`${base}\``), `README must mention \`${base}\``);
  }
  for (const phrase of [
    'Gazette issues/feed/index',
    '4 seed desk notes',
    '`inn/index.html`',
    '`guestbook/index.html`',
    '`move-in.html`',
  ]) {
    assert.ok(readmeNorm.includes(phrase), `README shared-files bullet must include ${phrase}`);
  }
});

test('town-3d/README.md desk-note byte-identity claim matches test-desk-notes.mjs and the files on disk', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes('byte-identical copies of `town-npc/plots/<handle>/desk-note.html`'),
    'README must state byte-identical copies of town-npc/plots/<handle>/desk-note.html'
  );
  assert.ok(
    readmeNorm.includes('guarded by `test-desk-notes.mjs`'),
    'README must state guarded by test-desk-notes.mjs'
  );

  const testDeskNotes = fs.readFileSync(path.join(__dirname, 'test-desk-notes.mjs'), 'utf8');
  assert.match(
    testDeskNotes,
    /test\([^)]*byte-identical/,
    'test-desk-notes.mjs must contain byte-identical in a test name'
  );

  for (const handle of ['milo', 'wick', 'maren', 'tomas']) {
    const shipped = fs.readFileSync(path.join(__dirname, 'plots', handle, 'index.html'));
    const npcNote = fs.readFileSync(path.join(REPO_ROOT, 'town-npc', 'plots', handle, 'desk-note.html'));
    assert.ok(
      Buffer.compare(shipped, npcNote) === 0 && shipped.equals(npcNote),
      `town-3d/plots/${handle}/index.html must be byte-identical to town-npc/plots/${handle}/desk-note.html`
    );
  }
});

test('town-3d/README.md Gazette feed and build scripts exist; HTML page titles match; closing links resolve', () => {
  const readme = readReadme();
  const feedXml = fs.readFileSync(path.join(__dirname, 'gazette', 'feed.xml'), 'utf8');
  assert.ok(
    feedXml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
    'gazette/feed.xml must start with XML declaration'
  );
  assert.ok(feedXml.includes('<rss version="2.0">'), 'gazette/feed.xml must contain <rss version="2.0">');

  const buildFeed = fs.readFileSync(path.join(__dirname, 'gazette', 'build-feed.mjs'), 'utf8');
  assert.ok(
    buildFeed.includes("path.join(__dirname, 'feed.xml')"),
    'gazette/build-feed.mjs must write path.join(__dirname, \'feed.xml\')'
  );

  const buildDigest = fs.readFileSync(path.join(__dirname, 'gazette', 'build-digest.mjs'), 'utf8');
  assert.ok(
    buildDigest.includes('Build a Markdown digest'),
    'gazette/build-digest.mjs must contain "Build a Markdown digest"'
  );

  const pageTitles = [
    ['move-in.html', '<title>Move in — Ghostlight Town</title>'],
    ['inn/index.html', '<title>Ghostlight Inn</title>'],
    ['guestbook/index.html', '<title>Town Gate Guestbook</title>'],
  ];
  for (const [rel, titleTag] of pageTitles) {
    const html = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.ok(html.includes(titleTag), `${rel} must contain ${titleTag}`);
    assert.ok(readme.includes(`\`${rel}\``), `README must name \`${rel}\``);
  }

  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, 'staging-polyfork', 'README.md')),
    'staging-polyfork/README.md must exist on disk'
  );
  assert.ok(
    readme.includes('[`../staging-polyfork/README.md`](../staging-polyfork/README.md)'),
    'README must link to ../staging-polyfork/README.md'
  );
  assert.ok(
    readme.includes('[`../PLAN.md`](../PLAN.md) §§4–8'),
    'README must link to ../PLAN.md §§4–8'
  );

  const planMd = fs.readFileSync(path.join(REPO_ROOT, 'PLAN.md'), 'utf8');
  for (const n of [4, 5, 6, 7, 8]) {
    assert.match(planMd, new RegExp(`^## ${n}\\.`, 'm'), `PLAN.md must contain ## ${n}. heading`);
  }
});

test('town-3d/README.md pine.glb size is ~2.2 MB and deliberately uncredited', () => {
  const readme = readReadme();
  const pineSize = fs.statSync(path.join(__dirname, 'models', 'pine.glb')).size;
  assert.ok(
    pineSize >= 2_000_000 && pineSize <= 2_400_000,
    `town-3d/models/pine.glb size (${pineSize}) must lie in [2,000,000, 2,400,000]`
  );
  assert.match(readme, /~2\.2 MB/, 'town-3d/README.md must state ~2.2 MB for pine.glb');
  const credits = fs.readFileSync(path.join(__dirname, 'CREDITS.md'), 'utf8');
  assert.doesNotMatch(credits, /pine/i, 'town-3d/CREDITS.md must not contain pine');
});

test('town-3d/README.md Gazette issue titles match gazette/latest.json', () => {
  const readme = readReadme();
  const latestJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'gazette', 'latest.json'), 'utf8')
  );
  assert.equal(latestJson.latest, 3, 'gazette/latest.json latest must be 3');
  assert.equal(latestJson.issues.length, 3, 'gazette/latest.json must list 3 issues');
  for (const issue of latestJson.issues) {
    const issueHtml = fs.readFileSync(path.join(__dirname, 'gazette', issue.file), 'utf8');
    assert.ok(
      issueHtml.includes(`<title>The Ghostlight Gazette — Issue #${issue.n}</title>`),
      `${issue.file} must contain <title>The Ghostlight Gazette — Issue #${issue.n}</title>`
    );
    assert.ok(
      issueHtml.includes('Ghostlight Gazette'),
      `${issue.file} must contain masthead Ghostlight Gazette`
    );
    assert.ok(
      readme.includes(`\`${issue.file}\``),
      `town-3d/README.md must name \`${issue.file}\``
    );
  }
});

test('town-3d/README.md 2026-11-14 adoption and live staging root match PLAN.md and staging-polyfork/index.html', () => {
  const readme = readReadme();
  assert.match(readme, /2026-11-14 adoption/, 'town-3d/README.md must mention 2026-11-14 adoption');
  const planMd = fs.readFileSync(path.join(REPO_ROOT, 'PLAN.md'), 'utf8');
  assert.match(planMd, /Adoption \(2026-11-14/, 'PLAN.md must record Adoption (2026-11-14');
  const stagingIndex = fs.readFileSync(
    path.join(REPO_ROOT, 'staging-polyfork', 'index.html'),
    'utf8'
  );
  const match = stagingIndex.match(/\.\/staging\.js\?v=(\d+)/);
  assert.ok(match, 'staging-polyfork/index.html must load ./staging.js?v=<n>');
  const statusLine = planMd.match(/^\*\*Status:\*\*.*$/m)?.[0] ?? '';
  assert.ok(
    statusLine.includes(`staging.js?v=${match[1]}`),
    `PLAN.md header must pin staging.js?v=${match[1]}`
  );
});

test('town-3d/README.md deterministic wandering pins SEED_WANDER_CONFIG and no Math.random', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes('Deterministic wandering'),
    'town-3d/README.md must mention Deterministic wandering'
  );
  for (const name of ['Wick', 'Maren', 'Tomas']) {
    assert.ok(readmeNorm.includes(name), `town-3d/README.md must name ${name}`);
  }
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  const cfgMatch = townJs.match(/const SEED_WANDER_CONFIG = \[([\s\S]*?)\];/);
  assert.ok(cfgMatch, 'town-3d/town.js must define SEED_WANDER_CONFIG');
  const handles = [...cfgMatch[1].matchAll(/handle:\s*'([^']+)'/g)].map((m) => m[1]);
  const slots = [...cfgMatch[1].matchAll(/bandstandSlot:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(handles, ['wick', 'maren', 'tomas'], 'SEED_WANDER_CONFIG handles must match');
  assert.deepEqual(slots, [1, 2, 3], 'SEED_WANDER_CONFIG bandstandSlots must match');

  const mathRandom = `Math.${'random'}`;
  for (const file of ['town.js', 'concept-bandstand.js', 'concept-cottage.js', 'concept-ghost.js']) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(src.includes(mathRandom), false, `town-3d/${file} must not use ${mathRandom}`);
  }
});

test('town-3d/README.md inn common windows any-occupancy rule matches town.js', () => {
  const readme = readReadme();
  const readmeNorm = readme.replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes('any-occupancy rule'),
    'town-3d/README.md must mention any-occupancy rule'
  );
  assert.ok(
    readme.includes('commonWindowMaterial'),
    'town-3d/README.md must name commonWindowMaterial'
  );
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  for (const line of [
    'let anyClaimed = false;',
    'if (isClaimed) anyClaimed = true;',
    'applyInnWindowPalette(commonMat, anyClaimed);',
  ]) {
    assert.ok(townJs.includes(line), `town-3d/town.js must contain ${line}`);
  }
  const roomsMatch = townJs.match(/export const INN_ROOM_WINDOWS = \{([\s\S]*?)\};/);
  assert.ok(roomsMatch, 'town-3d/town.js must export INN_ROOM_WINDOWS');
  const rooms = [...roomsMatch[1].matchAll(/(\w+):/g)].map((m) => m[1]);
  assert.deepEqual(rooms, ['lantern', 'window', 'quiet'], 'INN_ROOM_WINDOWS rooms must match');
});

test('town-3d/README.md per-plot guestbook tab labels match town.js', () => {
  const readme = readReadme();
  assert.ok(
    readme.includes('formatPlotGuestbookTabLabel'),
    'town-3d/README.md must name formatPlotGuestbookTabLabel'
  );
  assert.ok(
    readme.includes('resolvePlotGuestbookOverlayContent'),
    'town-3d/README.md must name resolvePlotGuestbookOverlayContent'
  );
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(
    townJs.includes('export function formatPlotGuestbookTabLabel(count)'),
    'town-3d/town.js must export formatPlotGuestbookTabLabel(count)'
  );
  assert.ok(
    townJs.includes("return Number.isFinite(count) && count > 0 ? `Guestbook (${count})` : 'Guestbook';"),
    'town-3d/town.js formatPlotGuestbookTabLabel must return exact expected expression'
  );
  assert.ok(
    townJs.includes('export async function resolvePlotGuestbookOverlayContent(handle,'),
    'town-3d/town.js must export resolvePlotGuestbookOverlayContent(handle,'
  );
});

test('town-3d/README.md TownLive injected fetch default matches town.js', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(
    townJs.includes('this.fetchFn = opts.fetch || globalThis.fetch || null;'),
    'town-3d/town.js must default this.fetchFn to opts.fetch || globalThis.fetch || null'
  );
  assert.ok(
    readmeNorm.includes('`TownLive` accepts an injected `opts.fetch`'),
    'town-3d/README.md must state `TownLive` accepts an injected `opts.fetch`'
  );
  assert.ok(
    readmeNorm.includes('defaulting to `globalThis.fetch` at runtime'),
    'town-3d/README.md must state defaulting to `globalThis.fetch` at runtime'
  );
});

test('town-3d/README.md procedural WebGL client importmap pins three@0.160.0', () => {
  const readme = readReadme();
  assert.ok(
    readme.includes('Procedural WebGL 3D client'),
    'town-3d/README.md must include Procedural WebGL 3D client'
  );
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(
    indexHtml.includes('"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"'),
    'town-3d/index.html importmap must pin three@0.160.0'
  );
  assert.ok(
    indexHtml.includes('"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"'),
    'town-3d/index.html importmap must pin three@0.160.0 addons'
  );
});

test('town-3d/README.md Gazette feed has one item per issue', () => {
  const readme = readReadme();
  const latestJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'gazette', 'latest.json'), 'utf8')
  );
  const feedXml = fs.readFileSync(path.join(__dirname, 'gazette', 'feed.xml'), 'utf8');
  const items = feedXml.match(/<item>/g) ?? [];
  assert.equal(items.length, latestJson.issues.length, 'gazette/feed.xml must have one <item> per issue');
  for (const issue of latestJson.issues) {
    assert.ok(
      feedXml.includes(issue.file),
      `gazette/feed.xml must link ${issue.file}`
    );
  }
  for (const name of ['feed.xml', 'build-feed.mjs', 'build-digest.mjs']) {
    assert.ok(readme.includes(`\`${name}\``), `town-3d/README.md must name \`${name}\``);
  }
});

test('town-3d/README.md shipped table rows match the 4 shipped .js files', () => {
  const readme = readReadme();
  const shipped = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js') && !e.name.startsWith('test-'))
    .map((e) => e.name)
    .sort();
  assert.equal(shipped.length, 4, `expected 4 shipped .js files, got ${JSON.stringify(shipped)}`);
  assert.deepEqual(shipped, ['concept-bandstand.js', 'concept-cottage.js', 'concept-ghost.js', 'town.js']);
  const tableRows = [...readme.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual([...tableRows].sort(), shipped, `table rows ${JSON.stringify(tableRows)} must match ${JSON.stringify(shipped)}`);
  assert.equal(tableRows[0], 'town.js', 'first shipped-table row must be town.js');
});

test('town-3d/README.md Starter props order matches VALID_PROP_KINDS in town.js', () => {
  const readme = readReadme();
  const readmeNorm = readme.replace(/\s+/g, ' ');
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  const block = townJs.match(/const VALID_PROP_KINDS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block, 'town.js must define VALID_PROP_KINDS');
  const kinds = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(kinds, ['desk', 'bookshelf', 'rug', 'tea_kettle', 'typewriter', 'cat', 'poster_frame', 'lantern', 'planter']);
  const m = readmeNorm.match(/Starter props:.*?`desk`, `bookshelf`, `rug`, `tea_kettle`, `typewriter`, `cat`, `poster_frame`, `lantern`, `planter`/);
  assert.ok(m, 'README Starter props bullet must list VALID_PROP_KINDS in exact order');
  for (const k of kinds) {
    const n = (readme.match(new RegExp('`' + k + '`', 'g')) ?? []).length;
    assert.equal(n, 1, `README must contain \`${k}\` exactly once, found ${n}`);
  }
});

test('town-3d/gazette/feed.xml items are complete, newest-first, with guid == link', () => {
  const feed = fs.readFileSync(path.join(__dirname, 'gazette', 'feed.xml'), 'utf8');
  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  assert.equal(items.length, 3, 'gazette/feed.xml must have 3 <item> blocks');
  const links = items.map((it) => it.match(/<link>([^<]+)<\/link>/)[1]);
  assert.deepEqual(links, [
    'https://milo.4167360.xyz/ghostlight-town/gazette/issue-003.html',
    'https://milo.4167360.xyz/ghostlight-town/gazette/issue-002.html',
    'https://milo.4167360.xyz/ghostlight-town/gazette/issue-001.html',
  ]);
  for (const it of items) {
    for (const tag of ['title', 'link', 'guid', 'pubDate', 'description']) {
      assert.match(it, new RegExp('<' + tag + '[ >]'), `feed item must contain <${tag}>`);
    }
    const link = it.match(/<link>([^<]+)<\/link>/)[1];
    const guid = it.match(/<guid[^>]*>([^<]+)<\/guid>/)[1];
    assert.equal(guid, link, 'feed item <guid> must equal <link>');
  }
  const dates = items.map((it) => it.match(/<pubDate>([^<]+)<\/pubDate>/)[1]);
  assert.deepEqual(dates, ['Wed, 18 Nov 2026 12:00:00 +0000', 'Sat, 14 Nov 2026 12:00:00 +0000', 'Thu, 12 Nov 2026 12:00:00 +0000']);
  const channelLink = feed.match(/<channel>[\s\S]*?<link>([^<]+)<\/link>/)[1];
  assert.equal(channelLink, 'https://milo.4167360.xyz/ghostlight-town/');
});

test('town-3d/CREDITS.md per-prop structure and 7 known Poly Pizza IDs match README', () => {
  const readme = readReadme();
  const credits = fs.readFileSync(path.join(__dirname, 'CREDITS.md'), 'utf8');
  const expected = [
    ['post-lantern.glb', 'Kay Lousberg', 'ZSQ65S4lEu'],
    ['lantern.glb', 'Kay Lousberg', 'CtHBJ1ufeW'],
    ['bench.glb', 'Kay Lousberg', '6d92UYCIC1'],
    ['street-light.glb', 'Quaternius', 'nFwrlcLvM5'],
    ['bookshelf.glb', 'CreativeTrio', '30Iealxb0p'],
    ['oil-lamp.glb', 'Quaternius', 'RsWYHKkDhD'],
    ['teapot.glb', 'MilkAndBanana', 'XggUrd5f03'],
  ];
  for (const [file, author, id] of expected) {
    assert.ok(credits.includes('models/' + file), `CREDITS.md must include models/${file}`);
    assert.ok(credits.includes('Author: ' + author), `CREDITS.md must include Author: ${author} for ${file}`);
    assert.ok(credits.includes('Poly Pizza ID: `' + id + '`'), `CREDITS.md must include Poly Pizza ID: \`${id}\``);
    assert.ok(credits.includes('https://poly.pizza/m/' + id), `CREDITS.md must include https://poly.pizza/m/${id}`);
    assert.ok(readme.includes('`' + file + '`'), `README must name \`${file}\``);
  }
  const licenceLines = credits.match(/Licence: CC0 1\.0/g) ?? [];
  assert.equal(licenceLines.length, 7, `CREDITS.md must have 7 Licence: CC0 1.0 lines, got ${licenceLines.length}`);
});

test('town-3d/README.md section headings and Behaviour / Honest limits bullets match expected structure', () => {
  const readme = readReadme();
  const headings = [...readme.matchAll(/^## ([^\n]+)/gm)].map((m) => m[1]);
  assert.deepEqual(headings, ['Shipped files', 'Fallback vs. staging role', 'Budgets & starter props', 'Behaviour', 'Honest limits']);
  const beh = readme.match(/## Behaviour\r?\n([\s\S]*?)(?:\r?\n## |\s*$)/)[1];
  const behBullets = [...beh.matchAll(/^- \*\*([^*]+):\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(behBullets, ['Deterministic wandering', 'Footlight status', 'Inn common windows', 'Per-plot guestbook tabs', 'Notice board']);
  const hon = readme.match(/## Honest limits\r?\n([\s\S]*?)\s*$/)[1];
  const honBullets = [...hon.matchAll(/^- \*\*([^*]+):\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(honBullets, ['Not the default live client', 'No literal `fetch(` in `town.js`', 'Offline wandering']);
});

test('town-3d/README.md Behaviour function signatures match town.js', () => {
  const readme = readReadme();
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(townJs.includes('export function setAvatarStatusText(THREE, avatar, statusText) {'));
  assert.ok(townJs.includes('export function buildNoticeBoardOverlayHtml() {'));
  assert.ok(townJs.includes('function buildWanderState(THREE, scene, avatarSpots, milosGhost) {'));
  assert.equal(townJs.includes('export function buildWanderState') || townJs.includes('export const buildWanderState'), false, 'buildWanderState must not be exported');
  for (const fn of ['setAvatarStatusText', 'buildNoticeBoardOverlayHtml', 'buildWanderState']) {
    assert.ok(readme.includes(fn), `README must name ${fn}`);
  }
});

test('town-3d/ static HTML pages contain no <script and are named in README', () => {
  const readme = readReadme();
  const pages = [
    'plots/milo/index.html', 'plots/wick/index.html', 'plots/maren/index.html', 'plots/tomas/index.html',
    'inn/index.html', 'guestbook/index.html', 'move-in.html',
    'gazette/issue-001.html', 'gazette/issue-002.html', 'gazette/issue-003.html',
  ];
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.equal(html.includes('<script'), false, `town-3d/${rel} must contain no <script`);
    assert.ok(readme.includes('`' + rel + '`') || readme.includes('plots/{milo,wick,maren,tomas}/index.html'), `README must name ${rel}`);
  }
});

test('town-3d/ live staging URL is identical in README, PLAN.md header, and feed.xml channel link', () => {
  const url = 'https://milo.4167360.xyz/ghostlight-town/';
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(readmeNorm.includes('**Staging is live:** `' + url + '` serves the'));
  const plan = fs.readFileSync(path.join(REPO_ROOT, 'PLAN.md'), 'utf8');
  const statusLine = plan.match(/^\*\*Status:\*\*.*$/m)[0];
  assert.ok(statusLine.includes('`' + url + '`'), `PLAN.md Status line must include \`${url}\``);
  const feed = fs.readFileSync(path.join(__dirname, 'gazette', 'feed.xml'), 'utf8');
  assert.equal(feed.match(/<channel>[\s\S]*?<link>([^<]+)<\/link>/)[1], url);
});

test('town-3d/README.md offline wandering claim matches buildWanderState in town.js', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(readmeNorm.includes('**Offline wandering:** deterministic wandering needs no live API.'));
  const start = townJs.indexOf('function buildWanderState(THREE, scene, avatarSpots, milosGhost) {');
  assert.ok(start >= 0, 'town.js must define buildWanderState');
  let depth = 0;
  let i = townJs.indexOf('{', start);
  let end = -1;
  for (; i < townJs.length; i++) {
    if (townJs[i] === '{') depth++;
    else if (townJs[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.ok(end > start, 'buildWanderState body must be balanced');
  const body = townJs.slice(start, end);
  assert.equal(body.includes('fetch('), false, 'buildWanderState must not call fetch(');
  assert.equal(body.includes('TownLive'), false, 'buildWanderState must not reference TownLive');
  assert.equal(body.includes('fetchFn'), false, 'buildWanderState must not reference fetchFn');
  assert.ok(body.includes('SEED_WANDER_CONFIG'), 'buildWanderState must use SEED_WANDER_CONFIG');
});

test('town-3d/README.md shipped-table town.js role keywords trace to town.js', () => {
  const readme = readReadme();
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.equal(readme.split('\n')[0], '# Fallback 3D Client (`town-3d/`)');
  const role = readme.match(/\| `town\.js` \| ([^|]+) \|/)[1];
  assert.ok(role.includes('`TownLive`'));
  assert.ok(townJs.includes('export class TownLive {'));
  assert.ok(townJs.includes('function buildWanderState('));
  assert.ok(townJs.includes('export function buildNoticeBoardOverlayHtml()'));
  assert.ok(townJs.includes('createConceptMiloGhost(THREE, {'));
  assert.ok(townJs.includes('return buildConceptBandstand(THREE, { includeStageProps: true });'));
  assert.ok(townJs.includes('createConceptMilosCottage(THREE, {'));
  for (const kw of ['clearing', 'cottages', 'bandstand', 'ghost', 'wander', 'overlays']) {
    assert.ok(role.toLowerCase().includes(kw), `town.js role cell must contain ${kw}`);
  }
});

test('town-3d/README.md shared-files bullet decomposes as 5 Gazette + 4 desk notes + 3 pages', () => {
  const readme = readReadme();
  const stageDeploy = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'stage-deploy.mjs'),
    'utf8'
  );
  const blockMatch = stageDeploy.match(/const STAGING_SHARED_TOWN3D_FILES = \[([\s\S]*?)\];/);
  assert.ok(blockMatch, 'scripts/stage-deploy.mjs must define STAGING_SHARED_TOWN3D_FILES');
  const entries = [...blockMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.equal(entries.length, 12, 'STAGING_SHARED_TOWN3D_FILES must hold 12 entries');
  const gazette = entries.filter((f) => f.startsWith('gazette/'));
  const desk = entries.filter((f) => f.startsWith('plots/'));
  const pages = entries.filter((f) => !f.startsWith('gazette/') && !f.startsWith('plots/'));
  assert.deepEqual([...gazette].sort(), [
    'gazette/feed.xml',
    'gazette/issue-001.html',
    'gazette/issue-002.html',
    'gazette/issue-003.html',
    'gazette/latest.json',
  ]);
  assert.equal(desk.length, 4, 'shared desk notes must be 4');
  assert.deepEqual([...pages].sort(), ['guestbook/index.html', 'inn/index.html', 'move-in.html']);
  const readmeNorm = readme.replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes('12 `town-3d/` files'),
    'town-3d/README.md must state 12 shared town-3d files'
  );
});

test('town-3d/README.md intro paragraph names the client stack and the 2026-11-14 live-root switch', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      'Procedural WebGL 3D client for Ghostlight Town (`town.js` + `concept-*.js` + CC0 `.glb` props).'
    ),
    'town-3d/README.md intro must name town.js + concept-*.js + CC0 .glb props'
  );
  assert.ok(
    readmeNorm.includes(
      'The `staging-polyfork` bundle replaced `town-3d/` as the default live root at the 2026-11-14 adoption,'
    ),
    'town-3d/README.md intro must state staging-polyfork replaced town-3d as the default live root'
  );
  assert.ok(
    readmeNorm.includes('`town-3d/` remains the 25-file fallback bundle (`town.js?v=16`)'),
    'town-3d/README.md intro must state the 25-file fallback bundle at town.js?v=16'
  );
});

test('town-3d/README.md footlight status renders statusText on the placard and the nametag', () => {
  const bandstandJs = fs.readFileSync(path.join(__dirname, 'concept-bandstand.js'), 'utf8');
  assert.ok(
    bandstandJs.includes(
      "export function lightFootlightSlot(THREE, flGroup, { handle = 'milo', role = 'muse', permanent = false, statusText } = {})"
    ),
    'town-3d/concept-bandstand.js lightFootlightSlot must accept statusText'
  );
  assert.ok(
    bandstandJs.includes('function formatFootlightStatusLines(statusText) {'),
    'town-3d/concept-bandstand.js must define formatFootlightStatusLines(statusText)'
  );
  assert.ok(
    bandstandJs.includes('flGroup.userData.statusText = trimmedStatus;'),
    'town-3d/concept-bandstand.js lightFootlightSlot must store statusText on flGroup.userData'
  );
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(
    townJs.includes('const nextStatus = raw ? (raw.length > 24 ? `${raw.slice(0, 23)}…` : raw) : null;'),
    'town-3d/town.js setAvatarStatusText must cap statusText at 24 chars (23 + ellipsis)'
  );
  assert.ok(
    townJs.includes('const lines = nextStatus ? [badge, nextStatus] : [badge];'),
    'town-3d/town.js setAvatarStatusText must draw badge plus status lines'
  );
  assert.ok(
    townJs.includes('sprite.material.map = makeTextTexture(THREE, lines, opts);'),
    'town-3d/town.js setAvatarStatusText must redraw the nametag via makeTextTexture'
  );
});

test('town-3d/README.md Notice Board overlay is built from 3 papers with gate, Gazette, and inn notices', () => {
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(
    townJs.includes('function buildNoticeBoard(THREE) {'),
    'town-3d/town.js must define buildNoticeBoard(THREE)'
  );
  assert.ok(
    townJs.includes('export function buildNoticeBoardOverlayHtml() {'),
    'town-3d/town.js must export buildNoticeBoardOverlayHtml()'
  );
  assert.ok(
    townJs.includes('const noticesHtml = NOTICE_BOARD_PAPERS.map(([, , lines]) => {'),
    'town-3d/town.js buildNoticeBoardOverlayHtml must map NOTICE_BOARD_PAPERS'
  );
  const papers = [...townJs.matchAll(/\['notice_board_paper_([a-z]+)',/g)].map((m) => m[1]);
  assert.deepEqual(papers, ['gazette', 'inn', 'gate'], 'NOTICE_BOARD_PAPERS must hold gazette, inn, gate');
  const fnStart = townJs.indexOf('export function buildNoticeBoardOverlayHtml() {');
  assert.ok(fnStart >= 0, 'town-3d/town.js must contain buildNoticeBoardOverlayHtml');
  const fnBody = townJs.slice(fnStart, fnStart + 2000);
  assert.ok(fnBody.includes('<title>Notice Board</title>'), 'Notice Board overlay must title itself Notice Board');
  assert.ok(fnBody.includes('<h1>Notice Board</h1>'), 'Notice Board overlay must head itself Notice Board');
});

test('town-3d/README.md inn common windows bullet states the any-occupancy rule verbatim', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      '`commonWindowMaterial` lights when any room is claimed; the three room windows are per-room'
    ),
    'town-3d/README.md inn bullet must state the any-occupancy rule verbatim'
  );
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(
    townJs.includes('function applyInnWindowPalette(material, isClaimed) {'),
    'town-3d/town.js must define applyInnWindowPalette(material, isClaimed)'
  );
});

test('town-3d/README.md Gazette latest.json issues carry headline and date; feed titles match them', () => {
  const latestJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'gazette', 'latest.json'), 'utf8')
  );
  assert.equal(latestJson.latest, 3, 'gazette/latest.json latest must be 3');
  assert.equal(latestJson.issues.length, 3, 'gazette/latest.json must list 3 issues');
  for (const issue of latestJson.issues) {
    assert.deepEqual(
      Object.keys(issue).sort(),
      ['date', 'file', 'headline', 'n'],
      'gazette/latest.json issue entries must carry date, file, headline, n'
    );
    const html = fs.readFileSync(path.join(__dirname, 'gazette', issue.file), 'utf8');
    assert.ok(html.includes(issue.headline), `${issue.file} must contain its headline`);
  }
  const feedXml = fs.readFileSync(path.join(__dirname, 'gazette', 'feed.xml'), 'utf8');
  const channelTitle = feedXml.match(/<channel>[\s\S]*?<title>([^<]+)<\/title>/)[1];
  assert.equal(channelTitle, 'The Ghostlight Gazette', 'feed.xml channel title must be The Ghostlight Gazette');
  const channelDesc = feedXml.match(/<channel>[\s\S]*?<description>([^<]+)<\/description>/)[1];
  assert.equal(
    channelDesc,
    'The paper of record for Ghostlight Town — a clearing where nobody&apos;s cottage gets torn down.',
    'feed.xml channel description must match the Gazette tagline'
  );
  for (const issue of latestJson.issues) {
    const escaped = issue.headline.replaceAll("'", '&apos;');
    assert.ok(
      feedXml.includes(`<title>${escaped}</title>`),
      `gazette/feed.xml must carry title ${escaped}`
    );
  }
});

test('town-3d/README.md shipped town.js imports all three vendored concept modules', () => {
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(
    townJs.includes("import { createConceptMilosCottage } from './concept-cottage.js';"),
    'town-3d/town.js must import createConceptMilosCottage from ./concept-cottage.js'
  );
  assert.ok(
    townJs.includes("import { createConceptMiloGhost } from './concept-ghost.js?v=2';"),
    'town-3d/town.js must import createConceptMiloGhost from ./concept-ghost.js?v=2'
  );
  assert.ok(
    townJs.includes(
      "import { buildConceptBandstand, lightFootlightSlot } from './concept-bandstand.js';"
    ),
    'town-3d/town.js must import buildConceptBandstand and lightFootlightSlot from ./concept-bandstand.js'
  );
  const readme = readReadme();
  assert.ok(
    readme.includes('`town.js` + `concept-*.js`'),
    'town-3d/README.md must name town.js + concept-*.js in the intro'
  );
});

test('town-3d/README.md move-in, inn, and guestbook pages carry their distinctive content', () => {
  const moveIn = fs.readFileSync(path.join(__dirname, 'move-in.html'), 'utf8');
  assert.ok(
    moveIn.includes('openssl genpkey -algorithm ed25519 -out ghostlight-key.pem'),
    'town-3d/move-in.html must show the ed25519 keygen command'
  );
  const inn = fs.readFileSync(path.join(__dirname, 'inn/index.html'), 'utf8');
  for (const room of ['The Lantern Room', 'The Window Room', 'The Quiet Room']) {
    assert.ok(inn.includes(room), `town-3d/inn/index.html must name ${room}`);
  }
  const guestbook = fs.readFileSync(path.join(__dirname, 'guestbook/index.html'), 'utf8');
  assert.ok(
    guestbook.includes('Sign with the town client (<code>signGuestbook</code>'),
    'town-3d/guestbook/index.html must say to sign with the town client'
  );
});

test('town-3d/README.md CREDITS.md header states the procedural core and the CC0 credit policy', () => {
  const credits = fs.readFileSync(path.join(__dirname, 'CREDITS.md'), 'utf8');
  assert.ok(
    credits.includes('is procedural Three.js geometry'),
    'town-3d/CREDITS.md must state the architectural core is procedural Three.js geometry'
  );
  assert.ok(
    credits.includes('Although CC0 1.0 requires no attribution, we credit the creator here.'),
    'town-3d/CREDITS.md must state CC0 1.0 requires no attribution but creators are credited'
  );
  const entries = credits.match(/^-\s+\*\*.*\(`models\//gm) ?? [];
  assert.equal(entries.length, 7, 'town-3d/CREDITS.md must list 7 prop entries');
  const idLines = credits.match(/Poly Pizza ID:/g) ?? [];
  assert.equal(idLines.length, 7, 'town-3d/CREDITS.md must carry 7 Poly Pizza ID lines');
});

test('town-3d/test-readme.mjs file hygiene: 61 unique names, 6 imports, pinned literal counts', () => {
  const self = fs.readFileSync(path.join(__dirname, 'test-readme.mjs'), 'utf8');
  const names = [...self.matchAll(/^test\((['"])(.*?)\1,/gm)].map((m) => m[2]);
  assert.equal(names.length, 61, 'town-3d/test-readme.mjs must hold 51 top-level tests');
  assert.equal(new Set(names).size, 61, 'town-3d/test-readme.mjs test names must be unique');
  const importLines = [...self.matchAll(/^import .*$/gm)].map((m) => m[0]);
  assert.deepEqual(importLines, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { collectSourceFilesFromTown3d, collectSourceFiles } from '../scripts/stage-deploy.mjs';",
  ]);
  const retired = `camp${'fire'}`;
  assert.equal(
    (self.match(new RegExp(retired, 'gi')) ?? []).length,
    0,
    'retired term must not occur in town-3d/test-readme.mjs'
  );
  assert.equal(
    (self.match(/Math\.random/g) ?? []).length,
    1,
    'Math.' + 'random' + ' must occur exactly once (the line-588 test name)'
  );
  assert.equal(
    (self.match(/fetch\(/g) ?? []).length,
    3,
    'fetch' + '(' + ' must occur exactly three times (lines 801 and 856)'
  );
  assert.equal(
    (self.match(new RegExp(`Date.${'now'}`, 'g')) ?? []).length,
    0,
    'Date.' + 'now' + ' must not occur in town-3d/test-readme.mjs'
  );
  assert.equal(
    (self.match(new RegExp('TO' + 'DO', 'g')) ?? []).length,
    0,
    'TO' + 'DO' + ' must not occur in town-3d/test-readme.mjs'
  );
  assert.equal(
    (self.match(new RegExp('FIX' + 'ME', 'g')) ?? []).length,
    0,
    'FIX' + 'ME' + ' must not occur in town-3d/test-readme.mjs'
  );
});

test('Slice 508: town-3d/README.md fallback bundle literal is 25 files (P1)', async () => {
  const readme = readReadme();
  const { files } = await collectSourceFilesFromTown3d(__dirname);
  assert.equal(files.length, 25, 'town-3d/ fallback bundle must hold 25 files');
  assert.ok(
    readme.includes('25-file fallback bundle'),
    'town-3d/README.md must state 25-file fallback bundle'
  );
});

test('Slice 508: town-3d/README.md staging bundle literal is 195 files (P2)', async () => {
  const readme = readReadme();
  const { files } = await collectSourceFiles(REPO_ROOT, 'staging-polyfork');
  assert.equal(files.length, 195, 'staging-polyfork bundle must hold 195 files');
  assert.ok(
    readme.includes('195-file `staging-polyfork`'),
    'town-3d/README.md must state 195-file `staging-polyfork` bundle'
  );
});

test('Slice 508: town-3d/README.md test suites literal is 7 (P3)', () => {
  const readme = readReadme();
  const runTests = fs.readFileSync(path.join(REPO_ROOT, 'run-tests.mjs'), 'utf8');
  const registered = [...runTests.matchAll(/'town-3d\/(test-[^']+\.mjs)'/g)].map((m) => m[1]);
  assert.equal(registered.length, 7, 'run-tests.mjs must register 7 town-3d test suites');
  assert.ok(
    readme.includes('Test suites (7,'),
    'town-3d/README.md must state Test suites (7,'
  );
});

test('Slice 508: town-3d/README.md index.html loads town.js?v=16 (P4)', () => {
  const readme = readReadme();
  const readmeNorm = readme.replace(/\s+/g, ' ');
  const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.ok(
    indexHtml.includes("from './town.js?v=16'"),
    'town-3d/index.html must import from ./town.js?v=16'
  );
  assert.ok(
    readmeNorm.includes('`index.html` (loads `./town.js?v=16`)'),
    'town-3d/README.md HTML bullet must state index.html loads ./town.js?v=16'
  );
});

test('Slice 508: town-3d/README.md Deterministic wandering bullet body verbatim (P5)', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      'Deterministic wandering:** Wick, Maren, and Tomas capsule wanderers plus Milo\'s ghost drifting the Bandstand deck (`buildWanderState`), yielding to live presence avatars.'
    ),
    'town-3d/README.md Deterministic wandering bullet must state the full sentence verbatim'
  );
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(
    townJs.includes('function buildWanderState('),
    'town-3d/town.js must define buildWanderState'
  );
});

test('Slice 508: town-3d/README.md Footlight status bullet body verbatim (P6)', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      'Footlight status:** `status_text` renders on the Bandstand placard (`lightFootlightSlot` in `concept-bandstand.js`) and avatar nametag (`setAvatarStatusText` in `town.js`).'
    ),
    'town-3d/README.md Footlight status bullet must state the full sentence verbatim'
  );
  const bandstandJs = fs.readFileSync(path.join(__dirname, 'concept-bandstand.js'), 'utf8');
  assert.ok(
    bandstandJs.includes('export function lightFootlightSlot('),
    'town-3d/concept-bandstand.js must export lightFootlightSlot'
  );
});

test('Slice 508: town-3d/README.md Per-plot guestbook tabs bullet body verbatim (P7)', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      'Per-plot guestbook tabs:** overlay tabs per plot (`formatPlotGuestbookTabLabel` / `resolvePlotGuestbookOverlayContent`).'
    ),
    'town-3d/README.md Per-plot guestbook tabs bullet must state the full sentence verbatim'
  );
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(
    townJs.includes('export function formatPlotGuestbookTabLabel(count)'),
    'town-3d/town.js must export formatPlotGuestbookTabLabel(count)'
  );
});

test('Slice 508: town-3d/README.md Notice Board bullet body verbatim (P8)', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      'Notice board:** click-to-read overlay (`buildNoticeBoardOverlayHtml`).'
    ),
    'town-3d/README.md Notice Board bullet must state the full sentence verbatim'
  );
  const townJs = fs.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  assert.ok(
    townJs.includes('export function buildNoticeBoardOverlayHtml()'),
    'town-3d/town.js must export buildNoticeBoardOverlayHtml()'
  );
});

test('Slice 508: town-3d/README.md Not the default live client bullet body verbatim (P9)', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      'Not the default live client:** visitors see `staging-polyfork` by default; `town-3d/` is the fallback procedural build.'
    ),
    'town-3d/README.md Not the default live client bullet must state the full sentence verbatim'
  );
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, 'staging-polyfork', 'index.html')),
    'staging-polyfork/index.html must exist on disk'
  );
});

test('Slice 508: town-3d/README.md Staging is live bullet body verbatim (P10)', () => {
  const readmeNorm = readReadme().replace(/\s+/g, ' ');
  assert.ok(
    readmeNorm.includes(
      'Staging is live:** `https://milo.4167360.xyz/ghostlight-town/` serves the `staging-polyfork` bundle since the 2026-11-14 adoption.'
    ),
    'town-3d/README.md Staging is live bullet must state the full sentence verbatim'
  );
  const feedXml = fs.readFileSync(path.join(__dirname, 'gazette', 'feed.xml'), 'utf8');
  assert.equal(
    feedXml.match(/<channel>[\s\S]*?<link>([^<]+)<\/link>/)[1],
    'https://milo.4167360.xyz/ghostlight-town/',
    'gazette/feed.xml channel link must be the staging URL'
  );
});
