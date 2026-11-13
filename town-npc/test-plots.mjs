import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { validateManifest, validateHtml, MAX_SIGNPOST_CHARS } from '../town-api/plot-validation.mjs';
import { CHARACTERS } from './characters.mjs';

const PLOTS_DIR = path.resolve('town-npc/plots');
const BANNED_TERM_RE = new RegExp(['camp', 'fire'].join(''), 'i');
const EXTERNAL_URL_RE = /https?:\/\/|(?<![a-z0-9:])\/\//i;
const FORBIDDEN_HOST_PORT = [
  ['100', '105'].join('.'),
  ['81', '23'].join(''),
  ['81', '24'].join(''),
  ['81', '25'].join(''),
];

test('NPC plot manifests: valid, distinct cottage types and wall colors, non-empty signposts', () => {
  const cottageTypes = new Set();
  const wallColors = new Set();

  for (const npc of CHARACTERS) {
    const manifestPath = path.join(PLOTS_DIR, npc.handle, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), `missing manifest for ${npc.handle}`);

    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const result = validateManifest(parsed);
    assert.equal(result.ok, true, `${npc.handle} manifest invalid: ${JSON.stringify(result)}`);

    assert.equal(typeof parsed.signpost_text, 'string');
    assert.ok(parsed.signpost_text.trim().length > 0, `${npc.handle} signpost_text is empty`);
    assert.ok(
      parsed.signpost_text.length <= MAX_SIGNPOST_CHARS,
      `${npc.handle} signpost_text exceeds ${MAX_SIGNPOST_CHARS} chars`
    );

    cottageTypes.add(parsed.cottage);
    wallColors.add(parsed.wall.toLowerCase());
  }

  assert.ok(cottageTypes.size > 1, 'all three cottages must not be the same type');
  assert.equal(wallColors.size, CHARACTERS.length, 'all three wall colors must be different');
});

test('NPC desk notes: pass HTML sanitizer, in-character, no cross-voice bleed', () => {
  for (const npc of CHARACTERS) {
    const notePath = path.join(PLOTS_DIR, npc.handle, 'desk-note.html');
    assert.ok(fs.existsSync(notePath), `missing desk-note.html for ${npc.handle}`);

    const html = fs.readFileSync(notePath, 'utf8');
    assert.equal(typeof html, 'string');
    assert.ok(html.trim().length > 0, `${npc.handle} desk-note.html is empty`);

    const result = validateHtml(html);
    assert.equal(result.ok, true, `${npc.handle} desk-note.html failed validateHtml: ${JSON.stringify(result)}`);

    const ownNameRe = new RegExp(`\\b${npc.name}\\b`);
    assert.ok(ownNameRe.test(html), `${npc.handle} desk-note.html must mention ${npc.name}`);

    for (const other of CHARACTERS) {
      if (other.handle === npc.handle) continue;
      const otherNameRe = new RegExp(`\\b${other.name}\\b`, 'i');
      assert.ok(!otherNameRe.test(html), `${npc.handle} desk-note.html must not mention ${other.name}`);
    }
  }
});

test('Milo plot manifest: matches shipped MILO_REBUILD_MANIFEST field-for-field and validates', () => {
  // Expected values copied from MILO_REBUILD_MANIFEST in town-3d/town.js.
  // Drift check: if the shipped 3D render changes, this test must fail until
  // town-npc/plots/milo/manifest.json is updated to match.
  const expectedMiloManifest = {
    cottage: 'gable',
    wall: '#a8d8ea',
    roof: '#5a4332',
    trim: '#f5efe0',
    signpost_text: 'Milo — Ghostlight Cottage (rebuilt)',
    props: [
      { kind: 'desk', x: -1.2, y: 0, z: 2.2, rot_y: 180, color: '#7a5230' },
      { kind: 'tea_kettle', x: -1.0, y: 0.78, z: 2.2, rot_y: 45, color: '#b87333' },
      { kind: 'cat', x: 1.3, y: 0, z: 2.1, rot_y: 210, color: '#2b2b2b' },
    ],
  };

  const manifestPath = path.join(PLOTS_DIR, 'milo', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'missing manifest for milo');

  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  const result = validateManifest(parsed);
  assert.equal(result.ok, true, `milo manifest invalid: ${JSON.stringify(result)}`);

  assert.deepEqual(parsed, expectedMiloManifest);
});

test('Milo desk note: passes HTML sanitizer and mentions Milo', () => {
  const notePath = path.join(PLOTS_DIR, 'milo', 'desk-note.html');
  assert.ok(fs.existsSync(notePath), 'missing desk-note.html for milo');

  const html = fs.readFileSync(notePath, 'utf8');
  assert.equal(typeof html, 'string');
  assert.ok(html.trim().length > 0, 'milo desk-note.html is empty');

  const result = validateHtml(html);
  assert.equal(result.ok, true, `milo desk-note.html failed validateHtml: ${JSON.stringify(result)}`);
  assert.ok(/\bMilo\b/.test(html), 'milo desk-note.html must mention Milo');
});

test('static checks: no banned term, no external URLs, no hardcoded host/port in NPC and Milo plot files', () => {
  const filesToCheck = [];
  for (const npc of CHARACTERS) {
    filesToCheck.push(path.join(PLOTS_DIR, npc.handle, 'manifest.json'));
    filesToCheck.push(path.join(PLOTS_DIR, npc.handle, 'desk-note.html'));
  }
  filesToCheck.push(path.join(PLOTS_DIR, 'milo', 'manifest.json'));
  filesToCheck.push(path.join(PLOTS_DIR, 'milo', 'desk-note.html'));
  filesToCheck.push(path.resolve('town-npc/test-plots.mjs'));

  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf8');
    const rel = path.relative(process.cwd(), filePath);

    assert.ok(!BANNED_TERM_RE.test(content), `banned term found in ${rel}`);
    for (const bad of FORBIDDEN_HOST_PORT) {
      assert.ok(!content.includes(bad), `hardcoded host/port "${bad}" found in ${rel}`);
    }

    if (!filePath.endsWith('test-plots.mjs')) {
      assert.ok(!EXTERNAL_URL_RE.test(content), `external URL found in ${rel}`);
    }
  }
});
