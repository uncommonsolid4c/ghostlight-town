/**
 * Ghostlight Town — drift guard for CONCEPT.md (Slice 113)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONCEPT_PATH = path.join(__dirname, 'CONCEPT.md');

function collectSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(mjs|js|html)$/.test(entry.name) && !entry.name.startsWith('test-')) {
      out.push(full);
    }
  }
  return out;
}

test('CONCEPT.md palette hexes, concept image links, and DRAFT status stay valid', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const lines = conceptText.split(/\r?\n/);

  // 1. **Status: DRAFT** line is still present
  const statusLine = lines.find((line) => line.startsWith('**Status: DRAFT'));
  assert.ok(statusLine, 'CONCEPT.md must retain its **Status: DRAFT** line');

  // 2. Every hex in the Palette table appears in town-3d/ or staging-polyfork/ source
  const paletteStart = lines.findIndex((line) => line.trim() === '## Palette');
  assert.notEqual(paletteStart, -1, 'CONCEPT.md must have a ## Palette section');
  const paletteEnd = lines.findIndex((line, idx) => idx > paletteStart && line.startsWith('## '));
  const paletteLines = lines
    .slice(paletteStart + 1, paletteEnd === -1 ? lines.length : paletteEnd)
    .filter((line) => line.trim().startsWith('|'));

  const paletteHexes = new Set();
  for (const row of paletteLines) {
    for (const match of row.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      paletteHexes.add(match[0].toLowerCase());
    }
  }
  assert.ok(paletteHexes.size > 0, 'CONCEPT.md Palette table must contain hex colors');

  const sourceFiles = [
    ...collectSourceFiles(path.join(__dirname, 'town-3d')),
    ...collectSourceFiles(path.join(__dirname, 'staging-polyfork')),
  ];
  const combinedSource = sourceFiles
    .map((file) => fs.readFileSync(file, 'utf8').toLowerCase())
    .join('\n');

  for (const hex of paletteHexes) {
    assert.ok(
      combinedSource.includes(hex),
      `Palette hex ${hex} in CONCEPT.md must appear in town-3d/ or staging-polyfork/ source`
    );
  }

  // 3. The three frozen image links under concept/ resolve to files on disk
  const imageLinks = [...conceptText.matchAll(/\]\((concept\/[^)]+)\)/g)].map((m) => m[1]);
  assert.equal(imageLinks.length, 3, 'CONCEPT.md must link the three frozen concept/ images');
  for (const relPath of imageLinks) {
    assert.ok(
      fs.existsSync(path.join(__dirname, relPath)),
      `Frozen concept image link ${relPath} must exist on disk`
    );
  }
});
