/**
 * Ghostlight Town — drift guard for town-npc/README.md (Slice 121)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const README_PATH = path.join(__dirname, 'README.md');

function readReadme() {
  return fs.readFileSync(README_PATH, 'utf8');
}

test('town-npc/README.md names every shipped .mjs file in town-npc/', () => {
  const readme = readReadme();
  const shippedFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.startsWith('test-'))
    .map((entry) => entry.name)
    .sort();

  assert.ok(shippedFiles.length > 0, 'town-npc/ must contain shipped .mjs files');
  for (const file of shippedFiles) {
    assert.ok(
      readme.includes(`\`${file}\``),
      `town-npc/README.md must document shipped file ${file}`
    );
  }
});

test('town-npc/README.md states the 3-hourly run-all schedule, PATH note, 2 KB memory cap, and 500-char honesty cap', () => {
  const readme = readReadme();
  assert.match(readme, /ghostlight-npc-run-all/);
  assert.match(readme, /every 3 hours/i);
  assert.match(readme, /\/home\/hatch\/\.local\/bin/);
  assert.match(readme, /2 KB/);
  assert.match(readme, /500-char|MAX_SAY_LEN = 500/);
});

test('town-npc/README.md states the header crontab examples are not installed and only run-all is live', () => {
  const readme = readReadme();
  assert.match(readme, /not installed/i);
  assert.match(readme, /only live schedule is the 3-hourly `ghostlight-npc-run-all` \(`run-all\.mjs`\)/);
});

test('town-npc/README.md states keys are mode 0600 and never committed or printed', () => {
  const readme = readReadme();
  assert.match(readme, /mode `0600`/);
  assert.match(readme, /never committed or printed/i);
});
