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

test('CONCEPT.md Forms-section hexes appear in the source they claim to live on', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const lines = conceptText.split(/\r?\n/);
  const formsStart = lines.findIndex((line) => line.trim() === '## Forms');
  assert.notEqual(formsStart, -1, 'CONCEPT.md must have a ## Forms section');
  const formsEnd = lines.findIndex((line, idx) => idx > formsStart && line.startsWith('## '));
  const formsText = lines.slice(formsStart + 1, formsEnd === -1 ? lines.length : formsEnd).join('\n');

  const formsHexes = new Set([...formsText.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()));
  assert.ok(formsHexes.size > 0, 'CONCEPT.md ## Forms section must contain hex colors');

  const readLower = (relPath) => fs.readFileSync(path.join(__dirname, relPath), 'utf8').toLowerCase();
  const emptyPad = readLower('staging-polyfork/empty-pad.mjs');
  const cottageProps = readLower('staging-polyfork/cottage-props.mjs');
  const interiorRoom = readLower('staging-polyfork/interior-room.mjs');
  const eventBanner = readLower('staging-polyfork/event-banner.mjs');
  const stagingBandstand = readLower('staging-polyfork/concept-bandstand.js');
  const stagingJs = readLower('staging-polyfork/staging.js');
  const townJs = readLower('town-3d/town.js');

  const expectedLocations = {
    '#3b2b1d': [stagingBandstand, stagingJs, emptyPad, townJs],
    '#b59449': [stagingBandstand, eventBanner, townJs],
    '#f4ead5': [stagingBandstand, stagingJs, townJs],
    '#4d3522': [cottageProps, townJs],
    '#1f3f26': [cottageProps, townJs],
    '#9a7b3e': [interiorRoom, townJs],
    '#fff1c9': [interiorRoom, townJs],
    '#ffcf70': [interiorRoom, townJs],
    '#6b492b': [interiorRoom, stagingJs, townJs],
    '#2b2f33': [interiorRoom, townJs],
    '#d8d2c5': [interiorRoom, townJs],
    '#8f6b47': [interiorRoom, townJs],
    '#6e7278': [emptyPad, townJs],
    '#7d5a3c': [emptyPad, stagingJs, townJs],
    '#f5efe0': [stagingJs, townJs],
    '#5a4332': [stagingJs, townJs],
    '#8b6a4b': [stagingJs, townJs],
    '#2e2218': [stagingJs, townJs],
    '#f2e6cf': [eventBanner, stagingBandstand, townJs],
    '#2b1e14': [eventBanner, stagingBandstand, townJs],
  };

  for (const hex of formsHexes) {
    const targets = expectedLocations[hex];
    assert.ok(targets, `Forms hex ${hex} must have an explicit source mapping in test-concept.mjs`);
    for (const src of targets) {
      assert.ok(src.includes(hex), `Forms hex ${hex} must appear in its claimed source`);
    }
  }
});

test('CONCEPT.md ghost opacity 0.85, wisp <= 0.4, and gate-facing placement hold in both clients', () => {
  for (const dir of ['staging-polyfork', 'town-3d']) {
    const ghostJs = fs.readFileSync(path.join(__dirname, dir, 'concept-ghost.js'), 'utf8');
    assert.match(ghostJs, /opacity:\s*0\.85/, `${dir}/concept-ghost.js must set opacity: 0.85`);
    const wispMatch = ghostJs.match(/const wispHeight\s*=\s*([0-9.]+);/);
    assert.ok(wispMatch, `${dir}/concept-ghost.js must define wispHeight`);
    assert.ok(Number(wispMatch[1]) <= 0.4, `${dir}/concept-ghost.js wispHeight (${wispMatch[1]}) must be <= 0.4`);
    assert.match(
      ghostJs,
      /ghost\.rotation\.y\s*=\s*Math\.atan2\(x,\s*z\)/,
      `${dir}/concept-ghost.js must orient ghost toward gate via Math.atan2(x, z)`
    );
  }

  const stagingJs = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'staging.js'), 'utf8');
  const townJs = fs.readFileSync(path.join(__dirname, 'town-3d', 'town.js'), 'utf8');
  assert.match(stagingJs, /spot:\s*bandstandBuilt\.avatarSpots\[0\]/);
  assert.match(townJs, /const spot\s*=\s*bandstandBuilt\.avatarSpots\[0\]/);
});

test('staging-polyfork/ contains no GLTFLoader import', () => {
  const stagingFiles = collectSourceFiles(path.join(__dirname, 'staging-polyfork'));
  assert.ok(stagingFiles.length > 0, 'staging-polyfork/ must contain source files');
  for (const file of stagingFiles) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(
      /GLTFLoader/.test(content),
      false,
      `staging-polyfork/ must not import or reference GLTFLoader (found in ${path.relative(__dirname, file)})`
    );
  }
});

test('CONCEPT.md cottage windows span two floors, front and side, with widow walk in both clients', () => {
  for (const dir of ['staging-polyfork', 'town-3d']) {
    const cottageJs = fs.readFileSync(path.join(__dirname, dir, 'concept-cottage.js'), 'utf8');
    const windowsBlock = cottageJs.match(/const windows = \[([\s\S]*?)\];/);
    assert.ok(windowsBlock, `${dir}/concept-cottage.js must define windows array`);

    const entries = [...windowsBlock[1].matchAll(/\{\s*x:\s*[^,]+,\s*y:\s*([0-9.]+),[^}]*rotY:\s*([^,]+),/g)];
    assert.ok(entries.length >= 6, `${dir}/concept-cottage.js must have >= 6 windows`);

    const yValues = entries.map((m) => Number(m[1]));
    const hasGroundFloor = yValues.some((y) => y < 2.0);
    const hasUpperFloor = yValues.some((y) => y > 2.0);
    assert.ok(hasGroundFloor && hasUpperFloor, `${dir}/concept-cottage.js windows must span two floors`);

    const rotValues = entries.map((m) => m[2].trim());
    assert.ok(rotValues.includes('0'), `${dir}/concept-cottage.js must have front-facing windows (rotY: 0)`);
    assert.ok(
      rotValues.some((r) => r.includes('Math.PI / 2')),
      `${dir}/concept-cottage.js must have side-facing windows (rotY: ±Math.PI / 2)`
    );

    assert.match(cottageJs, /widow's walk/i, `${dir}/concept-cottage.js must include the widow's walk`);
  }
});

test('CONCEPT.md footlight placard colors and Inn mug-sign removal / fallback signpost match source', () => {
  for (const dir of ['staging-polyfork', 'town-3d']) {
    const bandstandJs = fs.readFileSync(path.join(__dirname, dir, 'concept-bandstand.js'), 'utf8');
    assert.match(bandstandJs, /placardBg:\s*['"]#3b2b1d['"]/i);
    assert.match(bandstandJs, /placardBorder:\s*['"]#b59449['"]/i);
    assert.match(bandstandJs, /placardFg:\s*['"]#f4ead5['"]/i);
  }

  const stagingJs = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'staging.js'), 'utf8');
  assert.match(
    stagingJs,
    /place\(Tavern,\s*\{[^}]*\},\s*-11,\s*20,\s*\{\s*remove:\s*['"]sign['"]\s*\}\)/,
    'staging.js must remove the Village Tavern hanging mug sign'
  );

  const townJs = fs.readFileSync(path.join(__dirname, 'town-3d', 'town.js'), 'utf8');
  assert.match(
    townJs,
    /buildSignpost\(THREE,\s*['"]GHOSTLIGHT INN['"],\s*['"]inn_signpost['"]\)/,
    'town-3d/town.js fallback must keep the GHOSTLIGHT INN signpost'
  );
});

function collectShippedJsMjs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('kit-') || entry.name === 'models') continue;
      collectShippedJsMjs(full, out);
    } else if (/\.(mjs|js)$/.test(entry.name) && !entry.name.startsWith('test-')) {
      out.push(full);
    }
  }
  return out;
}

function extractSection(conceptText, heading) {
  const lines = conceptText.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  assert.notEqual(start, -1, `CONCEPT.md must have a ${heading} section`);
  const end = lines.findIndex((line, idx) => idx > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? lines.length : end).join('\n');
}

test("CONCEPT.md Don'ts campfire exclusion is enforced in staging.js scatter pool", () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const dontsText = extractSection(conceptText, "## Don'ts");
  assert.ok(
    dontsText.includes('No campfire — retired with Musebook.'),
    "CONCEPT.md ## Don'ts must forbid campfire"
  );
  assert.ok(
    dontsText.includes('The ghostlight is the gathering light.'),
    "CONCEPT.md ## Don'ts must name the ghostlight as the gathering light"
  );

  const shippedFiles = [
    ...collectShippedJsMjs(path.join(__dirname, 'town-3d')),
    ...collectShippedJsMjs(path.join(__dirname, 'staging-polyfork')),
  ];
  const hits = [];
  for (const file of shippedFiles) {
    const rel = path.relative(__dirname, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (/campfire/i.test(lines[i])) {
        hits.push(`${rel}:${i + 1}`);
      }
    }
  }
  assert.equal(hits.length, 2, `Expected exactly 2 campfire hits in shipped sources, got ${hits.join(', ')}`);
  assert.ok(
    hits.every((h) => h.startsWith('staging-polyfork/staging.js:98')),
    `Both campfire hits must be in staging-polyfork/staging.js:98x, got ${hits.join(', ')}`
  );

  const stagingJs = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'staging.js'), 'utf8');
  assert.ok(stagingJs.includes("'stone-ring-campfire'"), 'staging.js must skip stone-ring-campfire');
  assert.ok(
    fs.existsSync(path.join(__dirname, 'staging-polyfork', 'kit-campground', 'stone-ring-campfire.mjs')),
    'vendored kit-campground/stone-ring-campfire.mjs must exist on disk'
  );
  assert.equal(
    /place\(StoneRingCampfire|createStoneRingCampfire|stone-ring-campfire-8a0c6f/.test(stagingJs),
    false,
    'staging.js must never place the vendored stone-ring-campfire module'
  );
});

test('CONCEPT.md Palette interior accents match NPC plot manifests', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const paletteText = extractSection(conceptText, '## Palette');
  assert.ok(paletteText.includes('wick brass `#c8922e` (trim)'));
  assert.ok(paletteText.includes('maren slate `#43505c` (roof)'));
  assert.ok(paletteText.includes('tomas terracotta `#b5633a` (roof)'));

  const readManifest = (handle) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, 'town-npc', 'plots', handle, 'manifest.json'), 'utf8'));

  assert.equal(readManifest('wick').trim, '#c8922e');
  assert.equal(readManifest('maren').roof, '#43505c');
  assert.equal(readManifest('tomas').roof, '#b5633a');
});

test('CONCEPT.md Plots stone pads and OPEN PLOT signpost match empty-pad.mjs', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const formsText = extractSection(conceptText, '## Forms');
  for (const token of ['`#6e7278`', '`OPEN PLOT #N`', '`#3b2b1d`', '`#7d5a3c`']) {
    assert.ok(formsText.includes(token), `CONCEPT.md ## Forms must contain ${token}`);
  }

  const emptyPad = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'empty-pad.mjs'), 'utf8');
  assert.ok(emptyPad.includes('label: `OPEN PLOT #${plot.plotNumber}`'));
  assert.ok(emptyPad.includes('signpostText: `OPEN PLOT #${plot.plotNumber}`'));
  assert.ok(emptyPad.includes("color: '#6e7278'"));
  assert.ok(emptyPad.includes("bg: '#3b2b1d'"));
  assert.ok(emptyPad.includes("border: '#7d5a3c'"));
});

test('CONCEPT.md starter porch and seed door-side props match builders', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const formsText = extractSection(conceptText, '## Forms');
  for (const token of [
    '`lantern`',
    '`planter`',
    '`#4d3522`',
    '`#1f3f26`',
    '`oil_lamp`',
    '`#9a7b3e`',
    '`#fff1c9`',
    '`#ffcf70`',
    '`typewriter`',
    '`#6b492b`',
    '`#2b2f33`',
    '`#d8d2c5`',
    '`teapot`',
    '`#8f6b47`',
  ]) {
    assert.ok(formsText.includes(token), `CONCEPT.md ## Forms must contain ${token}`);
  }

  const cottageProps = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'cottage-props.mjs'), 'utf8');
  assert.ok(cottageProps.includes("case 'lantern':"));
  assert.ok(cottageProps.includes("case 'planter':"));
  const planterStart = cottageProps.indexOf("case 'planter':");
  const planterEnd = cottageProps.indexOf('default:', planterStart);
  const planterBody = cottageProps.slice(planterStart, planterEnd);
  assert.ok(planterBody.includes("'#4d3522'"), 'planter builder must use #4d3522 soil');
  assert.ok(planterBody.includes("'#1f3f26'"), 'planter builder must use #1f3f26 foliage');

  const interiorRoom = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'interior-room.mjs'), 'utf8');
  const sliceBuilder = (name) => {
    const start = interiorRoom.indexOf(`export function ${name}(`);
    assert.notEqual(start, -1, `interior-room.mjs must export ${name}`);
    const next = interiorRoom.indexOf('\nexport function ', start + 1);
    return interiorRoom.slice(start, next === -1 ? interiorRoom.length : next);
  };

  const oilLampBody = sliceBuilder('buildProceduralOilLamp');
  for (const hex of ["'#9a7b3e'", "'#fff1c9'", "'#ffcf70'"]) {
    assert.ok(oilLampBody.includes(hex), `buildProceduralOilLamp must use ${hex}`);
  }

  const typewriterBody = sliceBuilder('buildProceduralTypewriter');
  for (const hex of ["'#6b492b'", "'#2b2f33'", "'#d8d2c5'"]) {
    assert.ok(typewriterBody.includes(hex), `buildProceduralTypewriter must use ${hex}`);
  }

  const teapotBody = sliceBuilder('buildProceduralTeapot');
  assert.ok(teapotBody.includes("'#8f6b47'"), "buildProceduralTeapot must use '#8f6b47'");
});

test('CONCEPT.md Notice Board and Event Banner color wiring matches source', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const formsText = extractSection(conceptText, '## Forms');
  for (const hex of [
    '#6b492b',
    '#3b2b1d',
    '#7d5a3c',
    '#f5efe0',
    '#8b6a4b',
    '#2e2218',
    '#f2e6cf',
    '#b59449',
    '#2b1e14',
  ]) {
    assert.ok(formsText.includes(hex), `CONCEPT.md ## Forms must contain ${hex}`);
  }

  const stagingJs = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'staging.js'), 'utf8');
  const nbStart = stagingJs.indexOf('function buildNoticeBoard(THREE)');
  assert.notEqual(nbStart, -1, 'staging.js must define buildNoticeBoard');
  const afterNb = stagingJs.slice(nbStart + 'function buildNoticeBoard(THREE)'.length);
  const nextTopLevel = afterNb.search(/\n(?:function |const )/);
  const nbBody = nextTopLevel === -1 ? afterNb : afterNb.slice(0, nextTopLevel);
  for (const hex of ["'#6b492b'", "'#3b2b1d'", "'#7d5a3c'", "'#f5efe0'", "'#8b6a4b'", "'#2e2218'"]) {
    assert.ok(nbBody.includes(hex), `buildNoticeBoard must contain ${hex}`);
  }

  const eventBanner = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'event-banner.mjs'), 'utf8');
  assert.ok(eventBanner.includes("bg: '#f2e6cf'"));
  assert.ok(eventBanner.includes("border: '#b59449'"));
  assert.ok(eventBanner.includes("fg: '#2b1e14'"));
});

test('CONCEPT.md Mood, Rule, roof-brown OPEN, and 90-hex scoped recount hold', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const moodText = extractSection(conceptText, '## Mood');
  assert.match(moodText, /Quiet, small, hand-built/);
  assert.match(moodText, /1999 web page you can\s+walk around in/);
  assert.match(moodText, /burns in an empty house by design/);

  const ruleText = extractSection(conceptText, '## The rule');
  assert.match(ruleText, /No new color, form, or material enters the town without a line here\s+first/);
  assert.match(ruleText, /contractor defaults are not decisions/);

  const paletteText = extractSection(conceptText, '## Palette');
  assert.match(paletteText, /OPEN: contractor default, repaint undecided/);

  const dontsText = extractSection(conceptText, "## Don'ts");
  assert.match(dontsText, /90 such hexes ship as of this slice/);

  const shippedFiles = [
    ...collectShippedJsMjs(path.join(__dirname, 'town-3d')),
    ...collectShippedJsMjs(path.join(__dirname, 'staging-polyfork')),
  ];
  const shippedHexes = new Set();
  for (const file of shippedFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
      shippedHexes.add(match[0].toLowerCase());
    }
  }

  const formsText = extractSection(conceptText, '## Forms');
  const sheetHexes = new Set();
  for (const match of `${paletteText}\n${formsText}`.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    sheetHexes.add(match[0].toLowerCase());
  }

  const unlistedHexes = [...shippedHexes].filter((h) => !sheetHexes.has(h));
  assert.equal(shippedHexes.size, 124, `Expected 124 shipped hexes, got ${shippedHexes.size}`);
  assert.equal(sheetHexes.size, 26, `Expected 26 in-sheet hexes, got ${sheetHexes.size}`);
  assert.equal(unlistedHexes.length, 98, `Expected 98 unlisted hexes, got ${unlistedHexes.length}`);
});

test('CONCEPT.md Palette ice-blue, warm-window, and paper-stack rows map to the source they claim', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('Ice blue | `#a8d8ea`'));
  assert.ok(conceptText.includes('Warm window | `#ffbe5c`'));
  assert.ok(conceptText.includes('paper stack `#ebe4d1`'));

  for (const dir of ['staging-polyfork', 'town-3d']) {
    const ghostJs = fs.readFileSync(path.join(__dirname, dir, 'concept-ghost.js'), 'utf8');
    assert.ok(ghostJs.includes("iceBlue: '#a8d8ea'"), `${dir}/concept-ghost.js must include iceBlue: '#a8d8ea'`);

    const cottageJs = fs.readFileSync(path.join(__dirname, dir, 'concept-cottage.js'), 'utf8');
    assert.ok(cottageJs.includes("iceBlue: '#a8d8ea'"), `${dir}/concept-cottage.js must include iceBlue: '#a8d8ea'`);
    assert.ok(cottageJs.includes("warmWindow: '#ffbe5c'"), `${dir}/concept-cottage.js must include warmWindow: '#ffbe5c'`);
  }

  for (const relPath of ['town-3d/town.js', 'staging-polyfork/staging.js']) {
    const src = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
    assert.ok(src.includes("'#ebe4d1'"), `${relPath} must include '#ebe4d1'`);
  }
});

test('CONCEPT.md ghost face-decal details hold in both clients', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('big starry eyes'));
  assert.ok(conceptText.includes('small smile'));
  assert.ok(conceptText.includes('pink cheeks'));

  for (const dir of ['staging-polyfork', 'town-3d']) {
    const ghostJs = fs.readFileSync(path.join(__dirname, dir, 'concept-ghost.js'), 'utf8');
    assert.ok(ghostJs.includes('ghost_face_decal'), `${dir}/concept-ghost.js must include ghost_face_decal`);
    assert.ok(ghostJs.includes("cheekPink: '#ff9ebb'"), `${dir}/concept-ghost.js must include cheekPink: '#ff9ebb'`);
    assert.match(ghostJs, /starry sparkle/i);
    assert.match(ghostJs, /small cute upturned smile|small smile/i);
  }
});

test('CONCEPT.md Bandstand ghostlight bulb and ten footlights hold in both clients', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.match(conceptText, /ghostlight bulb burning\s*\n?\s*24\/7/);
  assert.ok(conceptText.includes('Ten footlights around the bandstand rim'));

  for (const dir of ['staging-polyfork', 'town-3d']) {
    const bandstandJs = fs.readFileSync(path.join(__dirname, dir, 'concept-bandstand.js'), 'utf8');
    assert.match(bandstandJs, /footlightCount:\s*10/);
    assert.ok(bandstandJs.includes('ghostlight_bulb'), `${dir}/concept-bandstand.js must include ghostlight_bulb`);
    assert.match(bandstandJs, /bulbY:\s*3\.55/);
    assert.ok(bandstandJs.includes("bulbColor: '#ffca66'"), `${dir}/concept-bandstand.js must include bulbColor: '#ffca66'`);
    assert.ok(bandstandJs.includes("bulbEmissive: '#ffaa33'"), `${dir}/concept-bandstand.js must include bulbEmissive: '#ffaa33'`);
  }
});

test('CONCEPT.md Ghostlight Inn Tavern palette wiring matches staging.js', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('cream `#f5efe0` plaster'));
  assert.ok(conceptText.includes('roof brown `#5a4332` tile'));
  assert.match(conceptText, /cedar\s+`#6b492b` timber/);

  const stagingJs = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'staging.js'), 'utf8');
  assert.match(stagingJs, /const CREAM = '#f5efe0'/);
  assert.match(stagingJs, /const ROOF = '#5a4332'/);
  assert.match(stagingJs, /const CEDAR = '#6b492b'/);
  assert.match(
    stagingJs,
    /place\(Tavern,\s*\{[^}]*width:\s*10,\s*plaster:\s*CREAM,\s*tile:\s*ROOF,\s*timber:\s*CEDAR[^}]*\},\s*-11,\s*20/
  );
});

test('CONCEPT.md newsstand cedar booth and paper stack match both clients', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('newsstand booth `#6b492b`'));

  for (const relPath of ['staging-polyfork/staging.js', 'town-3d/town.js']) {
    const src = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
    const idx = src.indexOf('function buildNewsstand(THREE)');
    assert.notEqual(idx, -1, `${relPath} must define buildNewsstand(THREE)`);
    const body = src.slice(idx, idx + 6000);
    assert.ok(
      body.includes("'#6b492b'") || body.includes('CEDAR'),
      `${relPath} buildNewsstand must use '#6b492b' or CEDAR`
    );
  }
});

test("CONCEPT.md Don'ts no-money rule holds in shipped sources", () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const dontsText = extractSection(conceptText, "## Don'ts");
  assert.ok(dontsText.includes('there is no money here, and nothing should look for sale.'));
  assert.ok(dontsText.includes('No photoreal, no neon'));

  const shippedFiles = [
    ...collectShippedJsMjs(path.join(__dirname, 'town-3d')),
    ...collectShippedJsMjs(path.join(__dirname, 'staging-polyfork')),
  ];

  const bannedHits = [];
  const allowlistHits = [];
  for (const file of shippedFiles) {
    const rel = path.relative(__dirname, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (/\b(neon|price|checkout)\b/i.test(lines[i])) {
        bannedHits.push(`${rel}:${i + 1}`);
      }
      if (/currency|for sale|shop visual/i.test(lines[i])) {
        allowlistHits.push(`${rel}:${i + 1}`);
      }
    }
  }

  assert.deepEqual(bannedHits, [], `Expected zero neon/price/checkout hits, got ${bannedHits.join(', ')}`);
  allowlistHits.sort();
  assert.deepEqual(allowlistHits, [
    'staging-polyfork/inn-guestbook-overlay.mjs:92',
    'staging-polyfork/staging.js:1037',
    'town-3d/town.js:2042',
    'town-3d/town.js:941',
  ]);
});

const creditsText = fs.readFileSync(path.join(__dirname, 'town-3d', 'CREDITS.md'), 'utf8');
const stagingJs = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'staging.js'), 'utf8');
const townJs = fs.readFileSync(path.join(__dirname, 'town-3d', 'town.js'), 'utf8');
const eventBannerText = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'event-banner.mjs'), 'utf8');
const tavernText = fs.readFileSync(path.join(__dirname, 'staging-polyfork', 'kit-medieval', 'tavern.mjs'), 'utf8');

test('CONCEPT.md Palette table — 9 rows, every row named, warm-windows sentence, hex-less rows named', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const lines = conceptText.split(/\r?\n/);
  const paletteStart = lines.findIndex((line) => line.trim() === '## Palette');
  assert.notEqual(paletteStart, -1, 'CONCEPT.md must have a ## Palette section');
  const paletteEnd = lines.findIndex((line, idx) => idx > paletteStart && line.startsWith('## '));
  const paletteLines = lines
    .slice(paletteStart + 1, paletteEnd === -1 ? lines.length : paletteEnd)
    .filter((line) => line.trim().startsWith('|'));
  const dataRows = paletteLines.filter(
    (line) => !line.startsWith('| Color |') && !line.startsWith('| --- |')
  );
  assert.equal(dataRows.length, 9, 'CONCEPT.md Palette table must have exactly 9 data rows');

  const rowNames = [
    'Ice blue',
    'Cream',
    'Roof brown',
    'Cedar',
    'Warm window',
    'Amber lantern',
    'Brass',
    'Night',
    'Interior accents',
  ];
  for (const name of rowNames) {
    assert.ok(
      dataRows.some((row) => row.includes(`| ${name} |`)),
      `Palette table must include row | ${name} |`
    );
  }

  assert.ok(conceptText.includes('The town is warm windows in a dark clearing.'));
  const rowFor = (name) => dataRows.find((row) => row.includes(`| ${name} |`));
  assert.ok(rowFor('Cedar').includes('Octagonal bandstand, gate, newsstand booth `#6b492b`'));
  assert.ok(rowFor('Amber lantern').includes('amber glass'));
  assert.ok(rowFor('Brass').includes('footlight shells'));
  assert.ok(rowFor('Night').includes('dark clearing'));
});

test('CONCEPT.md Bandstand octagonal deck — 8-sided bandstand_base in both clients', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('octagonal cedar bandstand'));

  for (const dir of ['staging-polyfork', 'town-3d']) {
    const bandstandJs = fs.readFileSync(path.join(__dirname, dir, 'concept-bandstand.js'), 'utf8');
    assert.ok(bandstandJs.includes('bandstand_base'), `${dir}/concept-bandstand.js must include bandstand_base`);
    assert.ok(
      bandstandJs.includes('8-sided CylinderGeometry'),
      `${dir}/concept-bandstand.js must document 8-sided CylinderGeometry`
    );
    assert.ok(
      bandstandJs.includes('CylinderGeometry(4.5, 4.5, 0.6, 8)'),
      `${dir}/concept-bandstand.js must use CylinderGeometry(4.5, 4.5, 0.6, 8)`
    );
  }
});

test('CONCEPT.md footlight placard shows the handle and optional status_text in both clients', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('showing the handle'));
  assert.ok(conceptText.includes('optional `status_text`'));

  const stagingBandstand = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'concept-bandstand.js'),
    'utf8'
  );
  assert.ok(stagingBandstand.includes('function formatFootlightStatusLines(statusText)'));
  assert.match(stagingBandstand, /lightFootlightSlot\(THREE, flGroup, \{[^}]*statusText/);
  assert.ok(stagingBandstand.includes('flGroup.userData.statusText'));

  const fallbackBandstand = fs.readFileSync(
    path.join(__dirname, 'town-3d', 'concept-bandstand.js'),
    'utf8'
  );
  assert.ok(fallbackBandstand.includes('function formatFootlightStatusLines(statusText)'));
  assert.match(fallbackBandstand, /lightFootlightSlot\(THREE, flGroup, \{[^}]*statusText/);
  assert.ok(fallbackBandstand.includes('flGroup.userData.statusText'));
  assert.match(
    fallbackBandstand,
    /lightFootlightSlot\(THREE, footlights\[0\], \{ handle: 'milo', role: 'muse', permanent: true \}\)/
  );

  const townJs = fs.readFileSync(path.join(__dirname, 'town-3d', 'town.js'), 'utf8');
  assert.match(townJs, /lightFootlightSlot\(THREE, flGroup, \{[^}]*statusText/);
  assert.equal(townJs.includes('function formatFootlightStatusLines'), false);
  assert.match(townJs, /makeTextTexture\(THREE, \['milo'\]/);
});

test('CONCEPT.md ghost dome + 6-fold pleated sheet, no legs, just the wisp, in both clients', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('dome + flared pleated sheet'));
  assert.ok(conceptText.includes('No legs, just the wisp.'));

  for (const dir of ['staging-polyfork', 'town-3d']) {
    const ghostJs = fs.readFileSync(path.join(__dirname, dir, 'concept-ghost.js'), 'utf8');
    assert.ok(ghostJs.includes('ghost_dome'), `${dir}/concept-ghost.js must include ghost_dome`);
    assert.ok(ghostJs.includes('Math.cos(6 * theta)'), `${dir}/concept-ghost.js must use Math.cos(6 * theta)`);
    assert.equal(ghostJs.match(/leg/gi), null, `${dir}/concept-ghost.js must have zero /leg/gi matches`);
    assert.ok(ghostJs.includes('wisp'), `${dir}/concept-ghost.js must include wisp`);
  }
});

test("CONCEPT.md cottage ridge runs straight with the widow's walk on the ridge in both clients", () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.match(conceptText, /Gable roofs\s+with the ridge running straight/);
  assert.ok(conceptText.includes("rooftop terrace as a widow's walk on the ridge"));

  for (const dir of ['staging-polyfork', 'town-3d']) {
    const cottageJs = fs.readFileSync(path.join(__dirname, dir, 'concept-cottage.js'), 'utf8');
    assert.ok(cottageJs.includes('ridge along X'), `${dir}/concept-cottage.js must include ridge along X`);
    assert.ok(
      cottageJs.includes('ridge at (y = 5.62, z = 0)'),
      `${dir}/concept-cottage.js must include ridge at (y = 5.62, z = 0)`
    );
    assert.ok(cottageJs.includes('straddling the ridge'), `${dir}/concept-cottage.js must include straddling the ridge`);
    assert.ok(cottageJs.includes('ridge beam caps'), `${dir}/concept-cottage.js must include ridge beam caps`);
  }
});

test('CONCEPT.md Props seven CC0 models match CREDITS.md names and Poly Pizza IDs', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('7 Poly Pizza CC0 `.glb` models'));

  const formsText = extractSection(conceptText, '## Forms');
  for (const kind of ['lanterns', 'bench', 'street light', 'bookshelf', 'oil lamp', 'teapot']) {
    assert.ok(formsText.includes(kind), `CONCEPT.md ## Forms must mention ${kind}`);
  }

  for (const modelPath of [
    'models/post-lantern.glb',
    'models/lantern.glb',
    'models/bench.glb',
    'models/street-light.glb',
    'models/bookshelf.glb',
    'models/oil-lamp.glb',
    'models/teapot.glb',
  ]) {
    assert.ok(creditsText.includes(modelPath), `CREDITS.md must include ${modelPath}`);
  }

  for (const polyId of [
    'ZSQ65S4lEu',
    'CtHBJ1ufeW',
    '6d92UYCIC1',
    'nFwrlcLvM5',
    '30Iealxb0p',
    'RsWYHKkDhD',
    'XggUrd5f03',
  ]) {
    assert.ok(creditsText.includes(polyId), `CREDITS.md must include Poly Pizza ID ${polyId}`);
  }

  const propModels = fs
    .readdirSync(path.join(__dirname, 'town-3d', 'models'))
    .filter((name) => name.toLowerCase().endsWith('.glb') && name !== 'pine.glb')
    .sort();
  assert.deepEqual(propModels, [
    'bench.glb',
    'bookshelf.glb',
    'lantern.glb',
    'oil-lamp.glb',
    'post-lantern.glb',
    'street-light.glb',
    'teapot.glb',
  ]);
});

test('CONCEPT.md Inn fallback keeps the door lantern and warm windows on both floors', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('hanging door lantern'));

  assert.ok(townJs.includes("doorLantern.name = 'inn_door_lantern'"));
  assert.ok(townJs.includes("ground.name = 'inn_ground_floor'"));
  assert.ok(townJs.includes("upper.name = 'inn_upper_floor'"));
  assert.ok(townJs.includes('lantern: 4'));
  assert.ok(townJs.includes('window: 5'));
  assert.ok(townJs.includes('quiet: 6'));
  assert.ok(townJs.includes("claimed: { color: '#ffbe5c', emissive: '#ffbe5c', emissiveIntensity: 1.4 }"));

  assert.ok(tavernText.includes('function windowUnit('));
  const windowUnitCalls = tavernText.match(/windowUnit\(/g) || [];
  assert.ok(windowUnitCalls.length >= 6, `Expected >= 6 windowUnit( calls in tavern.mjs, got ${windowUnitCalls.length}`);
  assert.ok(tavernText.includes('night.interior') || tavernText.includes('night'));
});

test('CONCEPT.md Notice Board faces the gate path and Event Banner hides with no event', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('facing the gate path'));
  assert.ok(conceptText.includes('hidden when no event is scheduled'));

  assert.ok(stagingJs.includes('group.rotation.y = Math.atan2(-x, -z);'));
  assert.ok(townJs.includes('group.rotation.y = Math.atan2(-x, -z);'));

  assert.ok(eventBannerText.includes('export function updateEventBanner('));
  assert.ok(eventBannerText.includes("if (!event || (status !== 'now' && status !== 'next')) {"));
  assert.ok(eventBannerText.includes('card.visible = false;'));
  assert.ok(eventBannerText.includes('card.visible = true;'));
});

test('CONCEPT.md Visual reference captions and starfield mood match the sheet and staging', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('[The clearing at night, from the town gate](concept/town-clearing-wide.webp)'));
  assert.ok(conceptText.includes("[Milo's cottage](concept/milos-cottage.webp)"));
  assert.ok(conceptText.includes("[Milo's ghost on the bandstand](concept/milos-ghost-bandstand.webp)"));
  assert.ok(conceptText.includes('starfield dark'));

  assert.ok(stagingJs.includes("scene.getObjectByName('sky')?.getObjectByName('stars')"));
  assert.ok(stagingJs.includes('stars.visible = true;'));
  assert.equal(townJs.includes("getObjectByName('stars')"), false);
});

test('CONCEPT.md Palette table has exactly 9 data rows and 3 hex-less rows', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const paletteText = extractSection(conceptText, '## Palette');
  const tableRows = paletteText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  const dataRows = tableRows.filter(
    (row) => !row.startsWith('| Color |') && !/^\|\s*---/.test(row)
  );
  assert.equal(dataRows.length, 9);
  const hexLessNames = dataRows
    .filter((row) => !/#[0-9a-fA-F]{6}/.test(row))
    .map((row) => row.split('|')[1].trim());
  assert.deepEqual(hexLessNames, ['Amber lantern', 'Brass', 'Night']);
});

test("CONCEPT.md section heading order and The rule's first sentences match", () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const headings = conceptText
    .split(/\r?\n/)
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim());
  assert.deepEqual(headings, ['The rule', 'Palette', 'Forms', 'Mood', "Don'ts", 'Visual reference']);

  const ruleNorm = extractSection(conceptText, '## The rule').replace(/\s+/g, ' ').trim();
  assert.ok(
    ruleNorm.includes('Every visual slice ends with a comparison: open the live page, look at the render next to this sheet.')
  );
  assert.ok(
    ruleNorm.includes('A mismatch gets fixed in the same slice, not logged as a nit for later.')
  );
});

test('CONCEPT.md cottage windowless-miss sentence and 8 emissive windows match both clients', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const formsNorm = extractSection(conceptText, '## Forms').replace(/\s+/g, ' ').trim();
  assert.ok(
    formsNorm.includes(
      "No cottage ships windowless — that was a real miss, caught by Werther's eye, and it stays a test assertion (Milo's cottage ≥ 6 windows, all emissive)."
    )
  );

  for (const dir of ['staging-polyfork', 'town-3d']) {
    const cottageJs = fs.readFileSync(path.join(__dirname, dir, 'concept-cottage.js'), 'utf8');
    const match = cottageJs.match(/const windows = \[([\s\S]*?)\];/);
    assert.ok(match, `${dir}/concept-cottage.js must define const windows = [...]`);
    const entries = match[1].match(/\{\s*x:/g) || [];
    assert.equal(entries.length, 8, `${dir}/concept-cottage.js must have exactly 8 window entries`);
    assert.ok(cottageJs.includes("warmWindow: '#ffbe5c'"));
    assert.ok(cottageJs.includes('emissive: CONCEPT_PALETTE.warmWindow'));
    assert.ok(cottageJs.includes('emissiveIntensity: 1.4'));
  }
});

test('CONCEPT.md bandstand ghostlight and footlight placard sentences match', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const formsNorm = extractSection(conceptText, '## Forms').replace(/\s+/g, ' ').trim();
  assert.ok(formsNorm.includes('The light no landlord can turn off.'));
  assert.ok(
    formsNorm.includes(
      'Presence is a brass footlight switching on, not an avatar teleporting in; lit footlights flip up a dark `#3b2b1d` placard (`#b59449` border, `#f4ead5` ink) showing the handle and optional `status_text`.'
    )
  );
});

test("CONCEPT.md Don'ts scoped note (slice 139) matches", () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const dontsNorm = extractSection(conceptText, "## Don'ts").replace(/\s+/g, ' ').trim();
  assert.ok(dontsNorm.includes('Scoped 2026-11-15, slice 139: the rule governs the visible material palette.'));
  assert.ok(
    dontsNorm.includes(
      'Functional accents — footlight glow states, ghost cheek/blush tints, unlit-state darks, emissive variants — live in code, not the table: 90 such hexes ship as of this slice'
    )
  );
  assert.ok(dontsNorm.includes("If a hex has no line in the palette table, it doesn't ship."));
});

test('CONCEPT.md Visual reference caption descriptions match verbatim', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const refNorm = extractSection(conceptText, '## Visual reference').replace(/\s+/g, ' ').trim();
  assert.ok(refNorm.includes('— bandstand, ghostlight, ghost, cottage, newsstand, fence, pines.'));
  assert.ok(refNorm.includes('— ice-blue ground floor, cream upper, brown gable roof, rooftop terrace, warm windows.'));
  assert.ok(refNorm.includes('— the cute version: big eyes, small smile, pink cheeks, matching the avatar.'));
});

test('CONCEPT.md Visual reference deviations closing sentences match', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const refNorm = extractSection(conceptText, '## Visual reference').replace(/\s+/g, ' ').trim();
  assert.ok(refNorm.includes('the images are the mood reference, not a literal render'));
  assert.ok(
    refNorm.includes(
      'Later slices compare against these images for mood and palette, and against the live town for exact geometry.'
    )
  );
});

test('CONCEPT.md Resolved A-frame line and A-frame wording match in both bandstand files', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const refNorm = extractSection(conceptText, '## Visual reference').replace(/\s+/g, ' ').trim();
  assert.ok(
    refNorm.includes(
      '(Resolved 2026-11-15: the bandstand timber A-frame roof structure `bandstand_aframe` is now built in both `staging-polyfork/` and `town-3d/`.)'
    )
  );

  for (const dir of ['staging-polyfork', 'town-3d']) {
    const bandstandJs = fs.readFileSync(path.join(__dirname, dir, 'concept-bandstand.js'), 'utf8');
    assert.ok(bandstandJs.includes('A-frame'), `${dir}/concept-bandstand.js must contain A-frame`);
  }
});

test('CONCEPT.md props fallback sentences and fallback builders in town.js match', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const formsNorm = extractSection(conceptText, '## Forms').replace(/\s+/g, ' ').trim();
  assert.ok(formsNorm.includes('with procedural fallbacks so a failed load never leaves a hole.'));
  assert.ok(formsNorm.includes('In `staging-polyfork/` (live), all props are procedural (no `.glb` loader)'));
  assert.ok(townJs.includes('loadTownProps'));
  assert.ok(townJs.includes('buildProceduralLantern'));
});

test('CONCEPT.md status block authorship and draft baseline match', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(
    conceptNorm.includes("Written by Milo (owner), 2026-11-12, from Werther's takeaway on the Little Prince tutorial")
  );
  assert.ok(
    conceptNorm.includes(
      "It becomes law only after Werther has looked at it — until then it's a draft, and the live town as it stands is the visual baseline."
    )
  );
});

test('CONCEPT.md palette closing sentences and warm-window hex match both clients', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(conceptNorm.includes('The town is warm windows in a dark clearing.'));
  assert.ok(
    conceptNorm.includes(
      'If a render ever reads flat or cold, the windows and lanterns are the first thing to check, not the last.'
    )
  );

  const townJs = fs.readFileSync(path.join(__dirname, 'town-3d', 'town.js'), 'utf8');
  assert.equal((townJs.match(/#ffbe5c/gi) || []).length, 7, 'town-3d/town.js must carry 7 #ffbe5c hits');
  const stagingCottage = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'concept-cottage.js'),
    'utf8'
  );
  assert.ok(stagingCottage.includes("warmWindow: '#ffbe5c'"));
  const cottageProps = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'cottage-props.mjs'),
    'utf8'
  );
  assert.ok(cottageProps.includes("emissive: '#ffbe5c'"));
});

test('CONCEPT.md ghost 0.7 history, shell-free line, and ice-cream-cone wisp match both clients', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(
    conceptNorm.includes(
      '0.7 read too washed-out against the night scene and the bulb (Werther, live render, 2026-11-12)'
    )
  );
  assert.ok(
    conceptNorm.includes('The shell-free ghost from the guestbook desk, not a capsule person.')
  );
  assert.ok(conceptNorm.includes('Never a long taper (that reads as an ice cream cone'));

  for (const dir of ['town-3d', 'staging-polyfork']) {
    const ghost = fs.readFileSync(path.join(__dirname, dir, 'concept-ghost.js'), 'utf8');
    assert.ok(ghost.includes('opacity: 0.85'), `${dir}/concept-ghost.js must keep opacity 0.85`);
    assert.ok(
      ghost.includes('height = 0.35 m (<= 0.4 m)'),
      `${dir}/concept-ghost.js must keep the wisp at 0.35 m`
    );
  }
});

test('CONCEPT.md empty plots read as waiting and OPEN PLOT signpost matches empty-pad.mjs', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(conceptNorm.includes('Empty plots read as *waiting*, not abandoned.'));

  const emptyPad = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'empty-pad.mjs'),
    'utf8'
  );
  assert.ok(emptyPad.includes('label: `OPEN PLOT #${plot.plotNumber}`'));
  assert.ok(emptyPad.includes('signpostText: `OPEN PLOT #${plot.plotNumber}`'));
});

test('CONCEPT.md Mood sentences match and starfield lives in staging.js only', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(conceptNorm.includes('Quiet, small, hand-built.'));
  assert.ok(
    conceptNorm.includes(
      'A 1999 web page you can walk around in — starfield dark, Verdana earnest, nothing slick.'
    )
  );
  assert.ok(conceptNorm.includes("keeps the light on, even at 4am when nobody's around."));

  const stagingJs = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'staging.js'),
    'utf8'
  );
  assert.ok(stagingJs.includes("getObjectByName('stars')"));
  // Verdana is prose-only: the mood sentence names the font, neither client sets it.
  const townJs = fs.readFileSync(path.join(__dirname, 'town-3d', 'town.js'), 'utf8');
  assert.equal(townJs.toLowerCase().includes('verdana'), false);
  assert.equal(stagingJs.toLowerCase().includes('verdana'), false);
});

test('CONCEPT.md chunky forms and windows on both floors front and side match both clients', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(conceptNorm.includes('low-poly, chunky, flat colors.'));
  assert.ok(
    conceptNorm.includes('Every cottage has warm lit windows on both floors, front and side.')
  );

  for (const dir of ['town-3d', 'staging-polyfork']) {
    const cottage = fs.readFileSync(path.join(__dirname, dir, 'concept-cottage.js'), 'utf8');
    assert.ok(cottage.includes('Eight 4-pane casement windows'));
    assert.ok(cottage.includes("warmWindow: '#ffbe5c'"));
    assert.ok(cottage.includes('y=[0.61..1.49]'), `${dir} cottage must have lower windows at y 0.61..1.49`);
    assert.ok(cottage.includes('y=2.52..3.40'), `${dir} cottage must have upper windows at y 2.52..3.40`);
    assert.ok(cottage.includes('side window z=[-0.38,0.38]'), `${dir} cottage must have a side lower window`);
    assert.ok(
      cottage.includes('side upper window z=[-0.38..0.38]'),
      `${dir} cottage must have a side upper window`
    );
  }
});

test('CONCEPT.md Notice Board twin-post sentence matches staging.js builder', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(conceptNorm.includes('cedar `#6b492b` twin-post board at `(-6, 14)`'));

  const stagingJs = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'staging.js'),
    'utf8'
  );
  assert.ok(stagingJs.includes('for (const postX of [-0.95, 0.95])'));
  assert.ok(stagingJs.includes('new THREE.BoxGeometry(0.12, 2.2, 0.12)'));
  assert.ok(stagingJs.includes("post.name = 'notice_board_post'"));
});

test('CONCEPT.md Event Banner crossbeam sentence matches concept-bandstand.js', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(
    conceptNorm.includes('hanging `event_banner` card under the Bandstand crossbeam (`(0, 3.92, 0.40)`)')
  );

  const bandstand = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'concept-bandstand.js'),
    'utf8'
  );
  assert.ok(bandstand.includes('crossbeamY: 4.30'));
  assert.ok(bandstand.includes('eventBanner.position.set(0, 3.92, 0.40)'));
  assert.ok(3.92 < 4.3, 'the banner must hang below the crossbeam');
});

test('CONCEPT.md frozen reference images sentence and three linked webps match disk', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const conceptNorm = conceptText.replace(/\s+/g, ' ').trim();
  assert.ok(conceptNorm.includes('Frozen reference images, approved by Werther 2026-11-12:'));

  const links = [...conceptText.matchAll(/\]\((concept\/[^)]+)\)/g)].map((m) => m[1]);
  assert.equal(links.length, 3, 'CONCEPT.md must link exactly the three frozen concept/ images');
  for (const relPath of links) {
    const stat = fs.statSync(path.join(__dirname, relPath));
    assert.ok(stat.isFile() && stat.size > 0, `${relPath} must exist and be non-empty`);
  }
  // The original non-cute ghost variant stays local-only: on disk, never linked.
  assert.equal(
    links.some((link) => link.includes('media-generation-')),
    false
  );
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        'concept',
        'media-generation-milos-ghost-bandstand-0-af17c55c-8a51-4a6f-b6e1-c49db6fca8cc.webp'
      )
    )
  );
});

test('CONCEPT.md kit set dressing sentence matches staging.js kit imports', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(conceptNorm.includes('kit set dressing'));

  const stagingJs = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'staging.js'),
    'utf8'
  );
  const kitImports = [...stagingJs.matchAll(/^import .* from '\.\/kit-[^']+';$/gm)].map((m) => m[0]);
  assert.equal(kitImports.length, 13, `staging.js must have 13 kit import lines, got ${kitImports.length}`);
  const expectedKitFiles = [
    'kit-campground/kit.mjs',
    'kit-campground/stage.mjs',
    'kit-medieval/cottage-small.mjs',
    'kit-medieval/tavern.mjs',
    'kit-medieval/gatehouse.mjs',
    'kit-medieval/well.mjs',
    'kit-medieval/lamp-post.mjs',
    'kit-medieval/windmill.mjs',
    'kit-medieval/villager.mjs',
    'kit-medieval/tradesman.mjs',
    'kit-campground/propped-fishing-rod.mjs',
    'kit-campground/tackle-box.mjs',
    'kit-medieval/clips.mjs',
  ];
  for (const kitFile of expectedKitFiles) {
    assert.ok(
      kitImports.some((line) => line.includes(kitFile)),
      `staging.js must import ${kitFile}`
    );
    assert.ok(
      fs.existsSync(path.join(__dirname, 'staging-polyfork', kitFile)),
      `staging-polyfork/${kitFile} must exist`
    );
  }
});

test('Slice 502: CONCEPT.md no-modern-minimal Donts line, Night row, and file hygiene hold (61 unique tests)', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ').trim();
  assert.ok(conceptNorm.includes('No photoreal, no neon, no modern-minimal.'));
  assert.ok(conceptNorm.includes('Ground, sky, the dark the warm windows sit in'));

  const shipped = [
    ...collectSourceFiles(path.join(__dirname, 'town-3d')),
    ...collectSourceFiles(path.join(__dirname, 'staging-polyfork')),
  ]
    .map((file) => fs.readFileSync(file, 'utf8').toLowerCase())
    .join('\n');
  assert.equal(/\bneon\b/.test(shipped), false, 'no shipped town-3d/staging-polyfork source may say neon');

  const testConcept = fs.readFileSync(path.join(__dirname, 'test-concept.mjs'), 'utf8');
  assert.equal((testConcept.match(/^import /gm) || []).length, 5, 'test-concept.mjs must have 5 import lines');
  assert.equal(
    (testConcept.match(/campfire/gi) || []).length,
    16,
    'campfire appears 16x, all inside the Donts guard test and this hygiene test itself'
  );
  // Each banned literal appears exactly once: this hygiene list naming it.
  // Zero anywhere else in the file.
  for (const banned of ['TODO', 'FIXME', 'fetch(', 'innerHTML', 'Math.random', 'Date.now']) {
    const escaped = banned.replace(/[()]/g, '\\$&');
    assert.equal(
      (testConcept.match(new RegExp(escaped, 'g')) || []).length,
      1,
      `test-concept.mjs must mention ${banned} once, in this hygiene list only`
    );
  }
  const names = [...testConcept.matchAll(/^test\((['"])(.*?)\1,/gm)].map((m) => m[2]);
  assert.equal(names.length, 61, `test-concept.mjs must hold 61 tests, got ${names.length}`);
  assert.equal(new Set(names).size, 61, 'all 61 test names must be unique');
});

test('Slice 502: Palette Hex column values in order (P1)', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const lines = conceptText.split(/\r?\n/);
  const paletteStart = lines.findIndex((line) => line.trim() === '## Palette');
  assert.notEqual(paletteStart, -1);
  const paletteEnd = lines.findIndex((line, idx) => idx > paletteStart && line.startsWith('## '));
  const dataRows = lines
    .slice(paletteStart + 1, paletteEnd === -1 ? lines.length : paletteEnd)
    .filter((line) => line.trim().startsWith('|'))
    .slice(2);
  const hexes = dataRows.map((row) => row.split('|')[2].trim());
  assert.deepEqual(hexes, [
    '`#a8d8ea`',
    '`#f5efe0`',
    '`#5a4332`',
    'bandstand wood',
    '`#ffbe5c`',
    'amber glass',
    'footlight shells',
    'dark clearing',
    '`#c8922e`, `#43505c`, `#b5633a`',
  ]);
});

test('Slice 502: Palette Lives-on column values in order (P2)', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  const lines = conceptText.split(/\r?\n/);
  const paletteStart = lines.findIndex((line) => line.trim() === '## Palette');
  assert.notEqual(paletteStart, -1);
  const paletteEnd = lines.findIndex((line, idx) => idx > paletteStart && line.startsWith('## '));
  const dataRows = lines
    .slice(paletteStart + 1, paletteEnd === -1 ? lines.length : paletteEnd)
    .filter((line) => line.trim().startsWith('|'))
    .slice(2);
  const livesOn = dataRows.map((row) => row.split('|')[3].trim());
  assert.deepEqual(livesOn, [
    "Milo's ghost (translucent, opacity 0.85); cottage ground floor",
    'Cottage upper floor; paper stack `#ebe4d1`',
    'Cottage roofs — **OPEN: contractor default, repaint undecided**',
    'Octagonal bandstand, gate, newsstand booth `#6b492b`',
    'Lit cottage windows (emissive, intensity 1.4)',
    'Gate lanterns, newsstand lantern, footlight glow',
    'Ten footlights around the bandstand rim',
    'Ground, sky, the dark the warm windows sit in',
    'Per-resident cottage back wall from `town-npc/plots/<handle>/manifest.json`: wick brass `#c8922e` (trim), maren slate `#43505c` (roof), tomas terracotta `#b5633a` (roof)',
  ]);
});

test('Slice 502: Ghost face decal, not bead eyes, facing the gate, in both clients (P3)', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('Face decal, not bead eyes'));
  assert.ok(conceptText.includes('facing the gate'));
  for (const dir of ['staging-polyfork', 'town-3d']) {
    const ghostJs = fs.readFileSync(path.join(__dirname, dir, 'concept-ghost.js'), 'utf8');
    assert.equal(/bead/i.test(ghostJs), false, `${dir}/concept-ghost.js must not mention bead`);
    assert.match(ghostJs, /ghost\.rotation\.y\s*=\s*Math\.atan2\(x,\s*z\)/);
  }
});

test('Slice 502: Notice Board header panel sentence and no-new-color counts (P4)', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('dark `#3b2b1d` header panel (`#7d5a3c` border)'));
  assert.ok(conceptText.includes('three cream `#f5efe0` notice papers (`#8b6a4b` border, `#2e2218` ink)'));
  assert.equal((conceptText.match(/same palette, no new color/g) || []).length, 1);
  assert.equal((conceptText.match(/\(no new color\)/g) || []).length, 1);
});

test('Slice 502: Event Banner uses the Nightly Call card palette, card exists in both clients (P5)', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ');
  assert.ok(
    conceptNorm.includes("using the Nightly Call card's cream `#f2e6cf` / brass `#b59449` / `#2b1e14` palette (no new color)")
  );
  for (const dir of ['staging-polyfork', 'town-3d']) {
    const bandstandJs = fs.readFileSync(path.join(__dirname, dir, 'concept-bandstand.js'), 'utf8');
    assert.ok(bandstandJs.includes("callBoard.name = 'nightly_call_card'"));
  }
});

test('Slice 502: Ghost wisp tip sentence and exact 0.35 wisp in both clients (P6)', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ');
  assert.ok(conceptNorm.includes('only a short wisp tip at the bottom'));
  for (const dir of ['staging-polyfork', 'town-3d']) {
    const ghostJs = fs.readFileSync(path.join(__dirname, dir, 'concept-ghost.js'), 'utf8');
    const match = ghostJs.match(/const wispHeight\s*=\s*([0-9.]+);/);
    assert.ok(match, `${dir}/concept-ghost.js must define const wispHeight`);
    assert.equal(Number(match[1]), 0.35);
  }
});

test('Slice 502: Inn is the two-story Polyfork Village Tavern with 9 window units (P7)', () => {
  const conceptText = fs.readFileSync(CONCEPT_PATH, 'utf8');
  assert.ok(conceptText.includes('live town uses the two-story Polyfork Village Tavern'));
  assert.equal((tavernText.match(/windowUnit\(/g) || []).length, 9);
});

test('Slice 502: Palette header and separator rows are exact (P8)', () => {
  const trimmedLines = fs
    .readFileSync(CONCEPT_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim());
  assert.ok(trimmedLines.includes('| Color | Hex | Lives on |'));
  assert.ok(trimmedLines.includes('| --- | --- | --- |'));
});

test('Slice 502: Status intro sentences match (P9)', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ');
  assert.ok(
    conceptNorm.includes(
      'make the art concept first, build the 3D against it, and always compare the end result to the initial concept.'
    )
  );
  assert.ok(conceptNorm.includes('This sheet is that reference.'));
});

test('Slice 502: Starter porch and seed door-side props match the builders (P10)', () => {
  const conceptNorm = fs.readFileSync(CONCEPT_PATH, 'utf8').replace(/\s+/g, ' ');
  assert.ok(conceptNorm.includes('starter porch props'));
  assert.ok(conceptNorm.includes('seed door-side character props'));
  const seedProps = fs.readFileSync(
    path.join(__dirname, 'staging-polyfork', 'seed-door-props.mjs'),
    'utf8'
  );
  assert.ok(seedProps.includes('wick: { build: buildProceduralOilLamp, rotY: -1.1733 }'));
  assert.ok(seedProps.includes('maren: { build: buildProceduralTypewriter, rotY: -0.6525 }'));
  assert.ok(seedProps.includes('tomas: { build: buildProceduralTeapot, rotY: -0.1322 }'));
  assert.ok(seedProps.includes('group.name = `seed_door_prop_${handle}`'));
  assert.ok(seedProps.includes('SEED_DOOR_PROP_POS = [-2.9, 0, 2.9]'));
  assert.match(
    seedProps,
    /import\s*\{[^}]*buildProceduralOilLamp[^}]*buildProceduralTypewriter[^}]*buildProceduralTeapot[^}]*\}\s*from\s*'\.\/interior-room\.mjs';/s
  );
});
