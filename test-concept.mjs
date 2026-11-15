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

function collectGlbFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectGlbFiles(full, out);
    } else if (entry.name.toLowerCase().endsWith('.glb')) {
      out.push(full);
    }
  }
  return out;
}

test('CONCEPT.md records bandstand_aframe deviation resolved and keeps cottage deviation', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const stagingBandstand = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'concept-bandstand.js'),
    'utf8'
  );
  const fallbackBandstand = fs.readFileSync(
    path.join(__dirname, 'town-3d', 'concept-bandstand.js'),
    'utf8'
  );

  assert.match(stagingBandstand, /aframeMesh\.name\s*=\s*['"]bandstand_aframe['"]/);
  assert.match(fallbackBandstand, /aframeMesh\.name\s*=\s*['"]bandstand_aframe['"]/);

  assert.equal(
    /roof frame the build doesn't have/i.test(conceptText),
    false,
    'CONCEPT.md must no longer claim the build lacks a bandstand roof frame'
  );
  assert.match(conceptText, /Resolved\s+\d{4}-\d{2}-\d{2}:.*`bandstand_aframe`/s);
  assert.match(conceptText, /stone and timber,\s+not\s+ice-blue and cream/i);
});

test('CONCEPT.md Inn, Notice Board, and Event Banner coords match staging source', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const stagingJs = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'staging.js'), 'utf8');
  const townJs = fs.readFileSync(path.join(__dirname, 'town-3d', 'town.js'), 'utf8');
  const stagingBandstand = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'concept-bandstand.js'),
    'utf8'
  );

  // Ghostlight Inn: width 10 at (-11, 20), lamp post at (-8.5, 17.5)
  const innMatch = stagingJs.match(/place\(Tavern,\s*\{[^}]*width:\s*(\d+)[^}]*\},\s*(-?\d+),\s*(-?\d+)/);
  assert.ok(innMatch, 'staging.js must place Tavern with width and coords');
  assert.equal(innMatch[1], '10');
  assert.equal(`${innMatch[2]}, ${innMatch[3]}`, '-11, 20');
  assert.match(stagingJs, /\[-8\.5,\s*17\.5,\s*1\.4\]/);
  assert.ok(conceptText.includes('`width: 10`'), 'CONCEPT.md must state Inn width: 10');
  assert.ok(conceptText.includes('`(-11, 20)`'), 'CONCEPT.md must state Inn coords (-11, 20)');
  assert.ok(conceptText.includes('`(-8.5, 17.5)`'), 'CONCEPT.md must state Inn lamp post (-8.5, 17.5)');

  // Town Notice Board: (-6, 14) and 3 papers
  const nbMatch = townJs.match(/noticeBoard:\s*\{\s*x:\s*(-?\d+),\s*y:\s*-?\d+,\s*z:\s*(-?\d+),?\s*\}/);
  assert.ok(nbMatch, 'town.js TOWN_LAYOUT.noticeBoard must define x and z');
  assert.equal(`${nbMatch[1]}, ${nbMatch[2]}`, '-6, 14');
  const paperMatches = [...stagingJs.matchAll(/notice_board_paper_/g)];
  assert.equal(paperMatches.length, 3, 'staging.js must define 3 notice board papers');
  assert.ok(conceptText.includes('`(-6, 14)`'), 'CONCEPT.md must state Notice Board coords (-6, 14)');
  assert.match(conceptText, /three cream `#f5efe0` notice papers/);

  // Bandstand Event Banner: (0, 3.92, 0.40)
  const bannerMatch = stagingBandstand.match(/eventBanner\.position\.set\(\s*([^)]+)\s*\)/);
  assert.ok(bannerMatch, 'concept-bandstand.js must set eventBanner.position');
  assert.equal(bannerMatch[1].replace(/\s+/g, ' '), '0, 3.92, 0.40');
  assert.ok(conceptText.includes('`(0, 3.92, 0.40)`'), 'CONCEPT.md must state Event Banner coords (0, 3.92, 0.40)');
});

test('CONCEPT.md Props .glb counts match town-3d/models/ and staging-polyfork/', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const fallbackGlbs = fs
    .readdirSync(path.join(__dirname, 'town-3d', 'models'))
    .filter((f) => f.endsWith('.glb') && f !== 'pine.glb');
  assert.equal(fallbackGlbs.length, 7, 'town-3d/models/ must have 7 shipped prop .glb files (excluding local pine.glb)');
  assert.match(conceptText, /7 Poly Pizza CC0 `\.glb` models/);

  const stagingGlbs = collectGlbFiles(path.join(__dirname, 'staging-polyfork'));
  assert.equal(stagingGlbs.length, 0, 'staging-polyfork/ must contain zero .glb files');
  assert.match(conceptText, /no `\.glb` loader/);
});

test('CONCEPT.md cottage window count/emissive and ghost opacity/wisp match source', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  for (const dir of ['staging-polyfork', 'town-3d']) {
    const cottageJs = fs.readFileSync(path.join(__dirname, dir, 'concept-cottage.js'), 'utf8');
    const windowsBlock = cottageJs.match(/const windows = \[([\s\S]*?)\];/);
    assert.ok(windowsBlock, `${dir}/concept-cottage.js must define windows array`);
    const windowCount = [...windowsBlock[1].matchAll(/\{\s*x:/g)].length;
    assert.ok(windowCount >= 6, `${dir}/concept-cottage.js must have >= 6 windows (found ${windowCount})`);
    assert.match(cottageJs, /emissiveIntensity:\s*1\.4/);
  }
  assert.match(conceptText, /Milo's cottage ≥ 6 windows, all emissive/);
  assert.match(conceptText, /emissive, intensity 1\.4/);

  const ghostJs = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'concept-ghost.js'), 'utf8');
  assert.match(ghostJs, /opacity:\s*0\.85/);
  const wispMatch = ghostJs.match(/const wispHeight\s*=\s*([0-9.]+);/);
  assert.ok(wispMatch, 'concept-ghost.js must define wispHeight');
  assert.ok(Number(wispMatch[1]) <= 0.4, `wispHeight (${wispMatch[1]}) must be <= 0.4`);
  assert.match(conceptText, /opacity 0\.85/);
  assert.match(conceptText, /wisp height ≤ 0\.4/);
});
