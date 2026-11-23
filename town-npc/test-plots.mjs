import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  validateManifest,
  validateHtml,
  decodeHtmlEntities,
  MAX_MANIFEST_BYTES,
  MAX_HTML_BYTES,
  MAX_SIGNPOST_CHARS,
  MAX_PROPS,
  VALID_COTTAGES,
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

const PROP = { kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0 };
const BASE = {
  cottage: 'gable',
  wall: '#a8d8ea',
  roof: '#5a4332',
  trim: '#f5efe0',
  signpost_text: 'Hi',
  props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0 }],
};

test('validateManifest rejects malformed manifests with named errors', () => {
  assert.deepEqual(validateManifest(null), { ok: false, error: 'invalid_manifest' });
  assert.deepEqual(validateManifest([]), { ok: false, error: 'invalid_manifest' });
  assert.deepEqual(validateManifest('x'), { ok: false, error: 'invalid_manifest' });

  assert.deepEqual(validateManifest({ ...BASE, bogus: 1 }), {
    ok: false,
    error: 'unknown_manifest_key',
    key: 'bogus',
  });
  assert.deepEqual(validateManifest({ ...BASE, cottage: 'hut' }), {
    ok: false,
    error: 'invalid_cottage',
  });

  assert.deepEqual(validateManifest({ ...BASE, wall: '#fff' }), {
    ok: false,
    error: 'invalid_color',
    field: 'wall',
  });
  assert.deepEqual(validateManifest({ ...BASE, roof: 42 }), {
    ok: false,
    error: 'invalid_color',
    field: 'roof',
  });
  const noTrim = { ...BASE };
  delete noTrim.trim;
  assert.deepEqual(validateManifest(noTrim), {
    ok: false,
    error: 'invalid_color',
    field: 'trim',
  });
  assert.equal(validateManifest({ ...BASE, wall: '#A8D8EA' }).ok, true);

  assert.deepEqual(validateManifest({ ...BASE, signpost_text: 'a'.repeat(121) }), {
    ok: false,
    error: 'invalid_signpost_text',
    max: MAX_SIGNPOST_CHARS,
  });
  assert.equal(validateManifest({ ...BASE, signpost_text: 'a'.repeat(120) }).ok, true);
  assert.deepEqual(validateManifest({ ...BASE, signpost_text: 42 }), {
    ok: false,
    error: 'invalid_signpost_text',
    max: MAX_SIGNPOST_CHARS,
  });

  assert.deepEqual(validateManifest({ ...BASE, props: 'desk' }), {
    ok: false,
    error: 'invalid_props',
  });

  const oversize = {
    ...BASE,
    props: Array.from({ length: 12 }, () => ({ ...PROP, junk: 'x'.repeat(2000) })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(oversize), 'utf8') > MAX_MANIFEST_BYTES);
  assert.deepEqual(validateManifest(oversize), {
    ok: false,
    error: 'manifest_too_large',
    max: MAX_MANIFEST_BYTES,
  });
});

test('validateManifest rejects bad props with named errors and honors boundaries', () => {
  assert.deepEqual(validateManifest({ ...BASE, props: [null] }), {
    ok: false,
    error: 'invalid_prop',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: [[]] }), {
    ok: false,
    error: 'invalid_prop',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, junk: 1 }] }), {
    ok: false,
    error: 'unknown_prop_key',
    key: 'junk',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, kind: 'sofa' }] }), {
    ok: false,
    error: 'invalid_prop_kind',
    index: 0,
  });

  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, x: 12.01 }] }), {
    ok: false,
    error: 'prop_coord_out_of_range',
    axis: 'x',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, y: -12.01 }] }), {
    ok: false,
    error: 'prop_coord_out_of_range',
    axis: 'y',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, z: Number.NaN }] }), {
    ok: false,
    error: 'prop_coord_out_of_range',
    axis: 'z',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, x: '0' }] }), {
    ok: false,
    error: 'prop_coord_out_of_range',
    axis: 'x',
    index: 0,
  });
  assert.equal(
    validateManifest({ ...BASE, props: [{ ...PROP, x: 12, y: -12, z: 12 }] }).ok,
    true
  );

  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, rot_y: 360 }] }), {
    ok: false,
    error: 'invalid_prop_rotation',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, rot_y: -0.5 }] }), {
    ok: false,
    error: 'invalid_prop_rotation',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, rot_y: Number.NaN }] }), {
    ok: false,
    error: 'invalid_prop_rotation',
    index: 0,
  });
  assert.equal(validateManifest({ ...BASE, props: [{ ...PROP, rot_y: 0 }] }).ok, true);
  assert.equal(validateManifest({ ...BASE, props: [{ ...PROP, rot_y: 359.99 }] }).ok, true);

  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, color: '#zzzzzz' }] }), {
    ok: false,
    error: 'invalid_prop_color',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: [{ ...PROP, color: 42 }] }), {
    ok: false,
    error: 'invalid_prop_color',
    index: 0,
  });
  assert.equal(validateManifest({ ...BASE, props: [{ ...PROP, color: '#123ABC' }] }).ok, true);

  assert.equal(
    validateManifest({ ...BASE, props: Array.from({ length: 12 }, () => ({ ...PROP })) }).ok,
    true
  );
  assert.deepEqual(
    validateManifest({ ...BASE, props: Array.from({ length: 13 }, () => ({ ...PROP })) }),
    { ok: false, error: 'too_many_props', max: MAX_PROPS }
  );
});

test('validateManifest normalizes defaults and passes prop colors through', () => {
  assert.deepEqual(
    validateManifest({
      cottage: 'gable',
      wall: '#ffffff',
      roof: '#000000',
      trim: '#111111',
    }),
    {
      ok: true,
      manifest: {
        cottage: 'gable',
        wall: '#ffffff',
        roof: '#000000',
        trim: '#111111',
        signpost_text: '',
        props: [],
      },
    }
  );

  const colored = validateManifest({ ...BASE, props: [{ ...PROP, color: '#123ABC' }] });
  assert.equal(colored.ok, true);
  assert.deepEqual(colored.manifest.props, [
    { kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0, color: '#123ABC' },
  ]);

  const wick = readManifest('wick');
  const wickResult = validateManifest(wick);
  assert.equal(wickResult.ok, true);
  assert.deepEqual(wickResult.manifest, {
    cottage: wick.cottage,
    wall: wick.wall,
    roof: wick.roof,
    trim: wick.trim,
    signpost_text: wick.signpost_text,
    props: wick.props,
  });
});

test('decodeHtmlEntities decodes numeric and named entities', () => {
  assert.equal(decodeHtmlEntities('&#106;avascript'), 'javascript');
  assert.equal(decodeHtmlEntities('&#x6a;'), 'j');
  assert.equal(decodeHtmlEntities('&#X4A;'), 'J');
  assert.equal(decodeHtmlEntities('&#106'), 'j');
  assert.equal(decodeHtmlEntities('&amp;&lt;&gt;&quot;&apos;'), '&<>"\'');
  assert.equal(decodeHtmlEntities('&AMP;'), '&');
  assert.equal(decodeHtmlEntities('&colon;'), ':');
  assert.equal(decodeHtmlEntities('&bogus;'), '&bogus;');
  assert.equal(decodeHtmlEntities('&#0;'), '&#0;');
  assert.equal(decodeHtmlEntities('&#x110000;'), '&#x110000;');
  assert.equal(decodeHtmlEntities('&lt;script&gt;'), '<script>');
  assert.equal(decodeHtmlEntities('plain'), 'plain');
});

test('validateHtml rejects forbidden tags, handlers, unsafe URIs and CSS in desk notes', () => {
  const forbiddenTags = [
    ['<script>alert(1)</script>', 'script'],
    ['<iframe src="x"></iframe>', 'iframe'],
    ['<form action="/x">', 'form'],
    ['<object data="x"></object>', 'object'],
    ['<embed src="x">', 'embed'],
    ['<link rel="stylesheet" href="x.css">', 'link'],
    ['<base href="/">', 'base'],
    ['<title>x</title>', 'title'],
    ['<meta charset="utf-8">', 'meta'],
  ];
  for (const [html, tag] of forbiddenTags) {
    assert.deepEqual(validateHtml(html), {
      ok: false,
      error: 'unsafe_html',
      reason: `forbidden_tag:${tag}`,
    });
  }

  assert.deepEqual(
    validateHtml('<meta name="viewport" content="width=device-width, initial-scale=1.0">'),
    { ok: true }
  );
  assert.deepEqual(
    validateHtml('<meta name="viewport" content="width=device-width, initial-scale=1.0" data-x="1">'),
    { ok: false, error: 'unsafe_html', reason: 'forbidden_tag:meta' }
  );
  assert.deepEqual(
    validateHtml('<meta content="width=device-width, initial-scale=1.0" name="viewport">'),
    { ok: true }
  );

  const unsafeCases = [
    ['<p onclick="x()">x</p>', 'forbidden_attr:onclick'],
    ['<a href="&#106;avascript:alert(1)">x</a>', 'javascript_uri'],
    ['<a href="&#X6A;avascript:alert(1)">x</a>', 'javascript_uri'],
    ['<a href="vbscript:x">x</a>', 'vbscript_uri'],
    ['<a href="//evil.com">x</a>', 'external_uri'],
    ['<a href="data:text/html;base64,x">x</a>', 'disallowed_data_uri'],
    ['<div style="background:url(evil.png)">x</div>', 'css_url'],
    ['<div style="width:expression(alert(1))">x</div>', 'css_expression'],
    ['<style>div{background:url(x)}</style>', 'css_url'],
  ];
  for (const [html, reason] of unsafeCases) {
    assert.deepEqual(validateHtml(html), {
      ok: false,
      error: 'unsafe_html',
      reason,
    });
  }

  assert.deepEqual(
    validateHtml('<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">'),
    { ok: true }
  );

  assert.deepEqual(validateHtml('x'.repeat(MAX_HTML_BYTES + 1)), {
    ok: false,
    error: 'html_too_large',
    max: MAX_HTML_BYTES,
  });
  assert.deepEqual(validateHtml('x'.repeat(MAX_HTML_BYTES)), { ok: true });

  for (const bad of [undefined, 42, null]) {
    assert.deepEqual(validateHtml(bad), { ok: false, error: 'missing_html' });
  }
});

test('seed plot files respect the byte caps and prop ranges', () => {
  for (const handle of ['wick', 'maren', 'tomas', 'milo']) {
    const manifestBytes = fs.statSync(path.join(PLOTS_DIR, handle, 'manifest.json')).size;
    const htmlBytes = fs.statSync(path.join(PLOTS_DIR, handle, 'desk-note.html')).size;
    assert.ok(manifestBytes <= MAX_MANIFEST_BYTES, `${handle} manifest exceeds MAX_MANIFEST_BYTES`);
    assert.ok(htmlBytes <= MAX_HTML_BYTES, `${handle} desk-note.html exceeds MAX_HTML_BYTES`);

    const manifest = readManifest(handle);
    assert.ok(VALID_COTTAGES.has(manifest.cottage), `${handle} invalid cottage ${manifest.cottage}`);
    for (const field of ['wall', 'roof', 'trim']) {
      assert.match(manifest[field], HEX_COLOR_RE, `${handle} invalid ${field}`);
    }
    const signpost = manifest.signpost_text ?? '';
    assert.ok(signpost.length <= MAX_SIGNPOST_CHARS, `${handle} signpost_text too long`);
    assert.ok(Array.isArray(manifest.props), `${handle} props must be an array`);
    assert.ok(manifest.props.length <= MAX_PROPS, `${handle} too many props`);

    for (const prop of manifest.props) {
      assert.ok(VALID_PROP_KINDS.has(prop.kind), `${handle} unknown prop kind ${prop.kind}`);
      for (const axis of ['x', 'y', 'z']) {
        assert.equal(typeof prop[axis], 'number');
        assert.ok(prop[axis] >= -12 && prop[axis] <= 12, `${handle} prop ${axis} out of range`);
      }
      assert.equal(typeof prop.rot_y, 'number');
      assert.ok(prop.rot_y >= 0 && prop.rot_y < 360, `${handle} prop rot_y out of range`);
      if (prop.color !== undefined) {
        assert.match(prop.color, HEX_COLOR_RE, `${handle} prop color invalid`);
      }
    }
  }
});

test('NPC prop geometry pinned field-for-field: kind, position, rotation, color', () => {
  const expectedProps = {
    wick: [
      { kind: 'desk', x: -1, y: 0, z: -0.6, rot_y: 0, color: '#6b3e1b' },
      { kind: 'rug', x: 0, y: 0, z: 0.9, rot_y: 0, color: '#9c5a2c' },
      { kind: 'poster_frame', x: 1.1, y: 0.3, z: -1.4, rot_y: 0, color: '#c8922e' },
    ],
    maren: [
      { kind: 'desk', x: -0.9, y: 0, z: -0.5, rot_y: 0, color: '#3d4650' },
      { kind: 'typewriter', x: -0.9, y: 0.72, z: -0.5, rot_y: 0, color: '#1e2328' },
      { kind: 'bookshelf', x: 1.1, y: 0, z: -0.8, rot_y: 270, color: '#43505c' },
      { kind: 'poster_frame', x: 0.2, y: 0.3, z: -1.4, rot_y: 0, color: '#1e2328' },
    ],
    tomas: [
      { kind: 'rug', x: 0, y: 0, z: 0.3, rot_y: 0, color: '#8c4a2b' },
      { kind: 'bookshelf', x: -0.8, y: 0, z: -0.7, rot_y: 30, color: '#4b2e1e' },
      { kind: 'tea_kettle', x: 0.7, y: 0, z: 0.4, rot_y: 0, color: '#b5633a' },
      { kind: 'cat', x: -0.4, y: 0, z: 0.6, rot_y: 45, color: '#4b2e1e' },
    ],
  };

  for (const [handle, props] of Object.entries(expectedProps)) {
    assert.deepEqual(readManifest(handle).props, props, `${handle} props mismatch`);
  }
});

test('desk-note presentation pinned per handle: background, sig color, paragraph count, h1', () => {
  const expected = {
    wick: { bg: '#faf4e8', sig: '#6b3e1b', pCount: 4, h1: 'Wick&rsquo;s Desk Note' },
    maren: { bg: '#f4f6f8', sig: '#43505c', pCount: 4, h1: 'Maren&rsquo;s Desk Note' },
    tomas: { bg: '#fbf5ec', sig: '#8c4a2b', pCount: 5, h1: 'Tomas&rsquo;s Desk Note' },
    milo: { bg: '#f5efe0', sig: '#46687a', pCount: 4, h1: 'Milo&rsquo;s Desk Note' },
  };

  for (const [handle, exp] of Object.entries(expected)) {
    const html = readDeskNote(handle);
    const bgMatch = html.match(/background:\s*(#[0-9a-fA-F]{6})/);
    assert.ok(bgMatch, `${handle} missing background hex`);
    assert.equal(bgMatch[1].toLowerCase(), exp.bg, `${handle} background mismatch`);

    const sigMatch = html.match(/\.sig\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/);
    assert.ok(sigMatch, `${handle} missing .sig color hex`);
    assert.equal(sigMatch[1].toLowerCase(), exp.sig, `${handle} .sig color mismatch`);

    const pMatches = html.match(/<p[\s>]/gi) || [];
    assert.equal(pMatches.length, exp.pCount, `${handle} <p> count mismatch`);

    const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    assert.ok(h1Match, `${handle} missing <h1>`);
    assert.equal(h1Match[1].replace(/\s+/g, ' ').trim(), exp.h1, `${handle} <h1> text mismatch`);
  }
});

test('validateHtml allows safe tags, relative links, image data URIs, safe CSS, and viewport meta', () => {
  const allowed = [
    '<p>Hello <em>Bandstand</em></p>',
    '<h1>Title</h1><p>body</p>',
    '<a href="plots/wick">Wick</a>',
    '<a href="#top">top</a>',
    '<a href=plots/wick>unquoted</a>',
    '<img src="data:image/png;base64,iVBORw0KGgo=">',
    '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
    '<style>div{color:red}</style>',
    '<div style="/* url(x) */ color:red">x</div>',
    '<style>/* url(x) */ div{color:red}</style>',
    '<!-- a comment --><p>x</p>',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta content="width=device-width, initial-scale=1.0" name="viewport">',
    '<meta name="VIEWPORT" content="width=device-width, initial-scale=1.0" />',
    '<p title="a > b">quoted gt</p>',
    '<a href="plots/wick?x=1&y=2">query</a>',
  ];

  for (const html of allowed) {
    assert.deepEqual(validateHtml(html), { ok: true }, `expected ok for: ${html}`);
  }
});

test('validateHtml rejects obfuscated tags, URIs, and CSS', () => {
  const rejected = [
    ['<scr\tipt>alert(1)</scr\tipt>', 'forbidden_tag:script'],
    ['<a href="java\tscript:alert(1)">x</a>', 'javascript_uri'],
    ['<a href="&#118;bscript:x">x</a>', 'vbscript_uri'],
    ['<a href="mailto:a@b.c">x</a>', 'external_uri'],
    ['<a href="HTTPS://evil.com">x</a>', 'external_uri'],
    ['<a href="data:application/json,{}">x</a>', 'disallowed_data_uri'],
    ['<div style="background:&#106;avascript:alert(1)">x</div>', 'javascript_uri'],
    ['<style>div{width:expression(alert(1))}</style>', 'css_expression'],
    ['<style>div{background:u/*x*/rl(y)}</style>', 'css_url'],
    ['<p onmouseover="x()">x</p>', 'forbidden_attr:onmouseover'],
    ['<a href="//evil.com">x</a>', 'external_uri'],
  ];

  for (const [html, reason] of rejected) {
    assert.deepEqual(
      validateHtml(html),
      { ok: false, error: 'unsafe_html', reason },
      `expected ${reason} for: ${html}`
    );
  }
});

test('validateManifest defaults missing fields and names missing-field errors', () => {
  assert.deepEqual(
    validateManifest({ cottage: 'gable', wall: '#ffffff', roof: '#000000', trim: '#111111' }),
    {
      ok: true,
      manifest: {
        cottage: 'gable',
        wall: '#ffffff',
        roof: '#000000',
        trim: '#111111',
        signpost_text: '',
        props: [],
      },
    }
  );

  assert.deepEqual(validateManifest({ ...BASE, signpost_text: null }), {
    ok: false,
    error: 'invalid_signpost_text',
    max: 120,
  });
  assert.deepEqual(validateManifest({ ...BASE, props: null }), {
    ok: false,
    error: 'invalid_props',
  });

  const noCottage = { ...BASE };
  delete noCottage.cottage;
  assert.deepEqual(validateManifest(noCottage), { ok: false, error: 'invalid_cottage' });

  const noWall = { ...BASE };
  delete noWall.wall;
  assert.deepEqual(validateManifest(noWall), {
    ok: false,
    error: 'invalid_color',
    field: 'wall',
  });

  assert.deepEqual(
    validateManifest({ ...BASE, props: [{ kind: 'desk', y: 0, z: 0, rot_y: 0 }] }),
    { ok: false, error: 'prop_coord_out_of_range', axis: 'x', index: 0 }
  );
  assert.deepEqual(
    validateManifest({ ...BASE, props: [{ kind: 'desk', x: 0, y: 0, z: 0 }] }),
    { ok: false, error: 'invalid_prop_rotation', index: 0 }
  );
  assert.deepEqual(
    validateManifest({ ...BASE, props: [{ x: 0, y: 0, z: 0, rot_y: 0 }] }),
    { ok: false, error: 'invalid_prop_kind', index: 0 }
  );

  const noColor = validateManifest({ ...BASE, props: [{ ...PROP }] });
  assert.equal(noColor.ok, true);
  assert.deepEqual(noColor.manifest.props, [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0 }]);
  assert.equal('color' in noColor.manifest.props[0], false);

  assert.deepEqual(
    validateManifest({ ...BASE, props: [{ ...PROP, x: Infinity }] }),
    { ok: false, error: 'prop_coord_out_of_range', axis: 'x', index: 0 }
  );
  assert.deepEqual(
    validateManifest({ ...BASE, props: [{ ...PROP, rot_y: Infinity }] }),
    { ok: false, error: 'invalid_prop_rotation', index: 0 }
  );
});

test('decodeHtmlEntities decodes named entities case-insensitively and leaves unknowns alone', () => {
  assert.equal(decodeHtmlEntities('&nbsp;'), ' ');
  assert.equal(decodeHtmlEntities('&NBSP;'), ' ');
  assert.equal(decodeHtmlEntities('&Tab;'), '\t');
  assert.equal(decodeHtmlEntities('&tab;'), '\t');
  assert.equal(decodeHtmlEntities('&newline;'), '\n');
  assert.equal(decodeHtmlEntities('&#65;'), 'A');
  assert.equal(decodeHtmlEntities('&#x41;'), 'A');
  assert.equal(decodeHtmlEntities('&#X41;'), 'A');
  assert.equal(decodeHtmlEntities('&#x4a;'), 'J');
  assert.equal(decodeHtmlEntities('&amp'), '&');
  assert.equal(decodeHtmlEntities('&lt'), '<');
  assert.equal(decodeHtmlEntities('&unknown;'), '&unknown;');
  assert.equal(decodeHtmlEntities('&#;'), '&#;');
  assert.equal(decodeHtmlEntities('&;'), '&;');
  assert.equal(decodeHtmlEntities('&#x41'), 'A');
  assert.equal(decodeHtmlEntities('a &amp; b'), 'a & b');
  assert.equal(decodeHtmlEntities('&#x1F600;'), '\u{1F600}');
  assert.equal(decodeHtmlEntities('&#1114111;'), '\u{10FFFF}');
});

test('Milo desk note: traces to town facts — demolished cottage, founding law, footlight 0, neighbors', () => {
  const html = readDeskNote('milo');
  const patterns = [
    /demolished for unpaid upkeep/,
    /280 Musebucks/,
    /no upkeep, no currency, no real money/,
    /ice-blue and cream/,
    /footlight 0/,
    /translucent ice-blue ghost/,
    /Ghostlight Gazette/,
    /milo\.4167360\.xyz/,
    /Wick, Maren, and Tomas/,
    /Ghostlight bulb burns 24\/7/,
  ];
  for (const re of patterns) {
    assert.match(html, re, `milo desk-note.html missing expected content matching ${re}`);
  }
});

test('validateHtml rejects closing forbidden tags and space-split tag names', () => {
  const cases = [
    ['</script>', 'forbidden_tag:script'],
    ['</iframe>', 'forbidden_tag:iframe'],
    ['</form>', 'forbidden_tag:form'],
    ['</meta>', 'forbidden_tag:meta'],
    ['< /script>', 'forbidden_tag:script'],
  ];
  for (const [html, reason] of cases) {
    assert.deepEqual(validateHtml(html), {
      ok: false,
      error: 'unsafe_html',
      reason,
    });
  }
});

test('validateHtml rejects valueless, uppercase, and whitespace-split event handlers', () => {
  assert.deepEqual(validateHtml('<p onclick>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'forbidden_attr:onclick',
  });
  assert.deepEqual(validateHtml('<p ONCLICK="x()">'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'forbidden_attr:onclick',
  });
  assert.deepEqual(validateHtml('<div OnMouseOver="x()">'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'forbidden_attr:onmouseover',
  });
  assert.deepEqual(validateHtml('<p on\tclick="x()">'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'forbidden_attr:on',
  });
});

test('validateHtml checks URI attrs beyond href: cite, src, poster', () => {
  assert.deepEqual(validateHtml('<blockquote cite="https://evil.com">x</blockquote>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'external_uri',
  });
  assert.deepEqual(validateHtml('<img src="//evil.com/x.png">'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'external_uri',
  });
  assert.deepEqual(validateHtml('<video poster="javascript:alert(1)">'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<a href="data:image/png;base64,AAA">x</a>'), { ok: true });
  assert.deepEqual(validateHtml('<img src="plots/wick/cat.png">'), { ok: true });
});

test('validateHtml tolerates unterminated comments/tags and stray angle brackets', () => {
  assert.deepEqual(validateHtml('<!-- never closed'), { ok: true });
  assert.deepEqual(validateHtml('<!-- <script> -->'), { ok: true });
  assert.deepEqual(validateHtml('<p title="unclosed'), { ok: true });
  assert.deepEqual(validateHtml('a < b and 1 < 2'), { ok: true });
});

test('viewport meta: duplicate names, wrong content, and case/padding tolerance', () => {
  assert.deepEqual(
    validateHtml('<meta name="viewport" name="viewport" content="width=device-width, initial-scale=1.0">'),
    { ok: false, error: 'unsafe_html', reason: 'forbidden_tag:meta' }
  );
  assert.deepEqual(validateHtml('<meta name="viewport" content="width=device-width">'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'forbidden_tag:meta',
  });
  assert.deepEqual(
    validateHtml('<meta name="author" content="width=device-width, initial-scale=1.0">'),
    { ok: false, error: 'unsafe_html', reason: 'forbidden_tag:meta' }
  );
  assert.deepEqual(
    validateHtml('<meta NAME="viewport" CONTENT="width=device-width, initial-scale=1.0">'),
    { ok: true }
  );
  assert.deepEqual(
    validateHtml('<meta name=" viewport " content=" width=device-width, initial-scale=1.0 ">'),
    { ok: true }
  );
});

test('validateManifest preserves color case, allows empty signpost and duplicate prop kinds', () => {
  const upper = validateManifest({
    ...BASE,
    wall: '#A8D8EA',
    roof: '#5A4332',
    trim: '#F5EFE0',
  });
  assert.equal(upper.ok, true);
  assert.equal(upper.manifest.wall, '#A8D8EA');
  assert.equal(upper.manifest.roof, '#5A4332');
  assert.equal(upper.manifest.trim, '#F5EFE0');

  assert.deepEqual(validateManifest({ ...BASE, signpost_text: '' }), {
    ok: true,
    manifest: { ...BASE, signpost_text: '' },
  });
  assert.equal(validateManifest({ ...BASE, props: [{ ...PROP }, { ...PROP }] }).ok, true);
});

test('decodeHtmlEntities decodes more named/numeric forms and returns lone surrogates', () => {
  assert.equal(decodeHtmlEntities('&#38;'), '&');
  assert.equal(decodeHtmlEntities('&#x26;'), '&');
  assert.equal(decodeHtmlEntities('&#X26;'), '&');
  assert.equal(decodeHtmlEntities('&#xD7FF;'), '\uD7FF');
  assert.equal(decodeHtmlEntities('&#x0;'), '&#x0;');
  assert.equal(decodeHtmlEntities('&GT;'), '>');
  assert.equal(decodeHtmlEntities('&QUOT;'), '"');
  assert.equal(decodeHtmlEntities('&#xD800;'), '\uD800');
  assert.equal(decodeHtmlEntities('&#xDFFF;'), '\uDFFF');
});

test('seed plots: distinct signposts and pinned .sig lines per handle', () => {
  const handles = ['wick', 'maren', 'tomas', 'milo'];
  const signposts = handles.map((h) => readManifest(h).signpost_text);
  assert.equal(new Set(signposts).size, 4);

  const expectedSigs = {
    wick: '&mdash; Wick, Stagehand / Lamp-Trimmer',
    maren: '&mdash; Maren, Retired Typesetter',
    tomas: '&mdash; Tomas, Props-Master / Tea-Urn Keeper',
    milo: '&mdash; Milo, Founder &amp; Chief Editor, Ghostlight Gazette',
  };
  for (const handle of handles) {
    const html = readDeskNote(handle);
    const match = html.match(/<p class="sig">([\s\S]*?)<\/p>/);
    assert.ok(match, `${handle} missing <p class="sig">`);
    assert.equal(match[1].trim(), expectedSigs[handle], `${handle} .sig mismatch`);
  }
});

test('validateHtml catches obfuscated CSS in <style> bodies and style attrs', () => {
  assert.deepEqual(validateHtml('<style>div{background:javascript:alert(1)}</style>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<style>div{background:&#117;rl(x)}</style>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'css_url',
  });
  assert.deepEqual(validateHtml('<div style="width:&#101;xpression(alert(1))">x</div>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'css_expression',
  });
  assert.deepEqual(validateHtml('<style>div{color:#a8d8ea}</style>'), { ok: true });
});
