/**
 * Ghostlight Town — drift guard for town-api/README.md (Slice 122)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const README_PATH = path.join(__dirname, 'README.md');
const SHIPPED_EXTS = new Set(['.mjs', '.json', '.sql']);

function readReadme() {
  return fs.readFileSync(README_PATH, 'utf8');
}

function isTestFile(name) {
  return name === 'test.mjs' || (name.startsWith('test-') && name.endsWith('.mjs'));
}

test('town-api/README.md names every shipped .mjs/.json/.sql file in town-api/', () => {
  const readme = readReadme();
  const shippedFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        SHIPPED_EXTS.has(path.extname(entry.name)) &&
        !isTestFile(entry.name)
    )
    .map((entry) => entry.name)
    .sort();

  assert.ok(shippedFiles.length > 0, 'town-api/ must contain shipped files');
  for (const file of shippedFiles) {
    assert.ok(
      readme.includes(`\`${file}\``),
      `town-api/README.md must document shipped file ${file}`
    );
  }
});

test('town-api/README.md names every test file in town-api/', () => {
  const readme = readReadme();
  const testFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isTestFile(entry.name))
    .map((entry) => entry.name)
    .sort();

  assert.ok(testFiles.length > 0, 'town-api/ must contain test files');
  for (const file of testFiles) {
    assert.ok(
      readme.includes(`\`${file}\``),
      `town-api/README.md must document test file ${file}`
    );
  }
});

test('town-api/README.md documents all env vars and ports 8124 / 8125', () => {
  const readme = readReadme();
  for (const envVar of [
    'TOWN_PORT',
    'TOWN_DB_PATH',
    'TOWN_PLOTS_DIR',
    'TOWN_OPERATOR_PUBKEY',
    'TOWN_EVENTS_PATH',
    'TOWN_API_BASE',
  ]) {
    assert.ok(
      readme.includes(`\`${envVar}\``),
      `town-api/README.md must document env var ${envVar}`
    );
  }
  assert.match(readme, /\b8124\b/);
  assert.match(readme, /\b8125\b/);
});

test('town-api/README.md states honest limits (live drift, no pinned counters) and key-path rail', () => {
  const readme = readReadme();
  assert.match(readme, /predates.*`events`.*`guestbook_by_plot`/i);
  assert.match(readme, /foreground turn/i);
  assert.match(readme, /never pinned|not pinned/i);
  assert.match(readme, /filesystem paths only|file path only/i);
  assert.doesNotMatch(readme, /campfire/i);
});
