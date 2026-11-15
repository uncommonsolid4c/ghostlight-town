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
