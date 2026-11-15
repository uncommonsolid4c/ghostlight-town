/**
 * Ghostlight Town — drift guard for scripts/README.md (Slice 124)
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
