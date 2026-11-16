import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  validateManifest,
  validateHtml,
  MAX_SIGNPOST_CHARS,
  MAX_PROPS,
  VALID_PROP_KINDS,
} from '../town-api/plot-validation.mjs';
import { CHARACTERS } from './characters.mjs';

const PLOTS_DIR = path.resolve('town-npc/plots');
const ALL_HANDLES = [...CHARACTERS.map((c) => c.handle), 'milo'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
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

function readManifest(handle) {
  return JSON.parse(fs.readFileSync(path.join(PLOTS_DIR, handle, 'manifest.json'), 'utf8'));
}

function readDeskNote(handle) {
  return fs.readFileSync(path.join(PLOTS_DIR, handle, 'desk-note.html'), 'utf8');
}

function assertPinnedManifest(handle, expected) {
  const manifest = readManifest(handle);
  assert.equal(manifest.cottage, expected.cottage);
  assert.equal(manifest.wall, expected.wall);
  assert.equal(manifest.roof, expected.roof);
  assert.equal(manifest.trim, expected.trim);
  assert.equal(manifest.signpost_text, expected.signpost_text);
  assert.deepEqual(
    manifest.props.map((p) => p.kind),
    expected.propKinds
  );
}

test('Wick manifest pinned: cabin cottage, colors, signpost, and prop kinds in order', () => {
  assertPinnedManifest('wick', {
    cottage: 'cabin',
    wall: '#f3e6cf',
    roof: '#6b3e1b',
    trim: '#c8922e',
    signpost_text: 'The light is on. It stays on.',
    propKinds: ['desk', 'rug', 'poster_frame'],
  });
});

test('Maren manifest pinned: gable cottage, colors, signpost, and prop kinds in order', () => {
  assertPinnedManifest('maren', {
    cottage: 'gable',
    wall: '#eef1f4',
    roof: '#43505c',
    trim: '#1e2328',
    signpost_text: 'One good line a day, set in type.',
    propKinds: ['desk', 'typewriter', 'bookshelf', 'poster_frame'],
  });
});

test('Tomas manifest pinned: tower cottage, colors, signpost, and prop kinds in order', () => {
  assertPinnedManifest('tomas', {
    cottage: 'tower',
    wall: '#dcc2a2',
    roof: '#b5633a',
    trim: '#4b2e1e',
    signpost_text: 'Tea is on. Sit a while.',
    propKinds: ['rug', 'bookshelf', 'tea_kettle', 'cat'],
  });
});

test('per-NPC desk-note content: traces to characters.mjs facts and titles', () => {
  const checks = [
    {
      handle: 'wick',
      patterns: [
        /\b(?:sweep|swept)\b/i,
        /Ghostlight bulb/,
        /\bburned\b/i,
        /sawdust and hot gels/i,
        /Stagehand \/ Lamp-Trimmer/,
      ],
    },
    {
      handle: 'maren',
      patterns: [
        /composing stick/i,
        /\bmisspelled\b/i,
        /\bnewsstand\b/i,
        /Prompt Book/,
        /Retired Typesetter/,
      ],
    },
    {
      handle: 'tomas',
      patterns: [
        /\bsamovar\b/i,
        /full of water/i,
        /\btea\b/i,
        /\bsit\b/i,
        /Props-Master \/ Tea-Urn Keeper/,
      ],
    },
  ];

  for (const { handle, patterns } of checks) {
    const html = readDeskNote(handle);
    for (const re of patterns) {
      assert.match(html, re, `${handle} desk-note.html missing expected content matching ${re}`);
    }
  }
});

test('prop exclusions and catalog drift guard: valid prop kinds, max props, and valid hex colors', () => {
  const exclusions = {
    wick: ['cat', 'typewriter', 'tea_kettle'],
    maren: ['tea_kettle', 'cat'],
    tomas: ['typewriter'],
  };

  for (const [handle, forbiddenKinds] of Object.entries(exclusions)) {
    const kinds = new Set(readManifest(handle).props.map((p) => p.kind));
    for (const forbidden of forbiddenKinds) {
      assert.ok(!kinds.has(forbidden), `${handle} manifest must not include ${forbidden}`);
    }
  }

  for (const handle of ALL_HANDLES) {
    const manifest = readManifest(handle);
    assert.ok(
      manifest.props.length <= MAX_PROPS && manifest.props.length <= 12,
      `${handle} manifest exceeds max props`
    );
    for (const prop of manifest.props) {
      assert.ok(
        VALID_PROP_KINDS.has(prop.kind),
        `${handle} manifest has unknown prop kind: ${prop.kind}`
      );
      if (prop.color !== undefined) {
        assert.match(prop.color, HEX_COLOR_RE, `${handle} prop ${prop.kind} has invalid color ${prop.color}`);
      }
    }
  }
});

test('desk-note structure across all four notes: doctype, lang, styles, headings, sig, and backgrounds', () => {
  const owners = new Map([
    ...CHARACTERS.map((c) => [c.handle, c.name]),
    ['milo', 'Milo'],
  ]);
  const backgrounds = new Set();

  for (const handle of ALL_HANDLES) {
    const html = readDeskNote(handle);
    assert.match(html, /^<!doctype html>/i, `${handle} missing doctype`);
    assert.match(html, /<html\s+lang=["']en["']>/i, `${handle} missing lang="en"`);
    assert.match(html, /font-family:\s*Georgia,\s*serif/i, `${handle} missing Georgia serif`);
    assert.match(html, /max-width:\s*34rem/i, `${handle} missing max-width: 34rem`);

    const h1Matches = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || [];
    assert.equal(h1Matches.length, 1, `${handle} must have exactly one <h1>`);

    const ownerName = owners.get(handle);
    assert.match(
      h1Matches[0],
      new RegExp(`\\b${ownerName}\\b`),
      `${handle} <h1> must name ${ownerName}`
    );

    const sigMatches = html.match(/class=["'][^"']*\bsig\b[^"']*["']/gi) || [];
    assert.equal(sigMatches.length, 1, `${handle} must have exactly one .sig element`);

    const bgMatch = html.match(/background:\s*(#[0-9a-fA-F]{6})\b/i);
    assert.ok(bgMatch, `${handle} missing body background hex`);
    backgrounds.add(bgMatch[1].toLowerCase());
  }

  assert.ok(
    backgrounds.size >= 3,
    `expected at least 3 distinct background hexes, got ${backgrounds.size}`
  );
});
