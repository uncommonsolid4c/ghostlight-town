/**
 * Ghostlight Town — drift guard for vendored Polyfork kit docs (Slice 115)
 *
 * Verifies KIT.md and API.md claims in staging-polyfork/kit-campground/ and
 * staging-polyfork/kit-medieval/ against the vendored PARTS.json, LAYOUT.json,
 * kit.json, part .mjs files, and _internal/{kit,stage,clips}.mjs modules.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KITS = ['kit-campground', 'kit-medieval'];
const INFRA_MJS = ['clips.mjs', 'kit.mjs', 'merge.mjs', 'stage.mjs'];

function readKitFile(kit, relPath) {
  return fs.readFileSync(path.join(__dirname, kit, relPath), 'utf8');
}

function countPartsStats(partsJson) {
  const keys = Object.keys(partsJson);
  const knobCounts = {};
  const colorCounts = {};
  const colorwaySets = new Set();

  for (const key of keys) {
    const entry = partsJson[key];
    for (const [knobName, spec] of Object.entries(entry.knobs || {})) {
      knobCounts[knobName] = (knobCounts[knobName] || 0) + 1;
      if (knobName === 'colorway') {
        const options = String(spec).replace(/\s*\([^)]*\)\s*$/, '');
        colorwaySets.add(options);
      }
    }
    for (const zone of entry.colors || []) {
      colorCounts[zone] = (colorCounts[zone] || 0) + 1;
    }
  }

  return {
    total: keys.length,
    keys,
    knobCounts,
    colorCounts,
    colorwayOptionSets: colorwaySets.size,
  };
}

test('KIT.md part counts, LAYOUT counts, .mjs reconciliation, and knob/color counts match vendored kit files', () => {
  for (const kit of KITS) {
    const kitDir = path.join(__dirname, kit);
    const kitMd = readKitFile(kit, 'KIT.md');
    const partsRaw = readKitFile(kit, 'PARTS.json');
    const partsJson = JSON.parse(partsRaw);
    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));

    // 1. PARTS.json is one line per part entry (plus opening `{` and closing `}`)
    const partsLines = partsRaw.trim().split(/\r?\n/);
    const stats = countPartsStats(partsJson);
    assert.equal(
      partsLines.length,
      stats.total + 2,
      `${kit}/PARTS.json must have one line per part plus { and }`
    );

    // 2. KIT.md `<N> of <N> parts` matches PARTS.json key count
    const partsClaim = kitMd.match(/(\d+) of (\d+) parts, packed/);
    assert.ok(partsClaim, `${kit}/KIT.md must state '<N> of <N> parts, packed'`);
    assert.equal(Number(partsClaim[1]), stats.total, `${kit}/KIT.md part count must match PARTS.json`);
    assert.equal(Number(partsClaim[2]), stats.total, `${kit}/KIT.md total part count must match PARTS.json`);

    // 3. kit.json slug matches KIT.md polyfork.dev/kit/<slug> URL
    assert.ok(
      kitMd.includes(`https://polyfork.dev/kit/${kitJson.kit}`),
      `${kit}/KIT.md URL must match kit.json slug ${kitJson.kit}`
    );

    // 4. .mjs files on disk reconcile with PARTS.json + 4 infra wrappers
    const mjsFiles = fs.readdirSync(kitDir).filter((f) => f.endsWith('.mjs')).sort();
    const partMjsSet = new Set(stats.keys.map((k) => `${k}.mjs`));
    const nonPartMjs = mjsFiles.filter((f) => !partMjsSet.has(f));
    const missingPartMjs = stats.keys.filter((k) => !mjsFiles.includes(`${k}.mjs`));

    assert.deepEqual(missingPartMjs, [], `${kit} must have a .mjs file for every PARTS.json key`);
    assert.deepEqual(nonPartMjs, INFRA_MJS, `${kit} non-part .mjs files must be the 4 infra wrappers`);
    assert.equal(mjsFiles.length, stats.total + INFRA_MJS.length);

    // 5. LAYOUT.json placement count and unique part count match KIT.md
    const layoutClaim = kitMd.match(/`LAYOUT\.json` is the composition: (\d+) placements of (\d+) parts/);
    assert.ok(layoutClaim, `${kit}/KIT.md must state LAYOUT.json placement and part counts`);
    const uniqueLayoutParts = new Set(layoutJson.map((row) => row.part));
    assert.equal(Number(layoutClaim[1]), layoutJson.length, `${kit}/KIT.md LAYOUT row count`);
    assert.equal(Number(layoutClaim[2]), uniqueLayoutParts.size, `${kit}/KIT.md LAYOUT unique part count`);

    // 6. KIT.md knob/colorway/color-zone counts match PARTS.json
    const colorwayClaim = kitMd.match(/\*\*`colorway`\*\* \((\d+) of (\d+) parts\): (\d+) different option sets/);
    assert.ok(colorwayClaim, `${kit}/KIT.md must state colorway counts`);
    assert.equal(Number(colorwayClaim[1]), stats.knobCounts.colorway);
    assert.equal(Number(colorwayClaim[2]), stats.total);
    assert.equal(Number(colorwayClaim[3]), stats.colorwayOptionSets);

    if (kit === 'kit-campground') {
      const expected = [
        ['season', stats.knobCounts.season],
        ['wear', stats.knobCounts.wear],
        ['snow', stats.colorCounts.snow],
        ['leaves', stats.colorCounts.leaves],
        ['blossom', stats.colorCounts.blossom],
      ];
      for (const [name, actualCount] of expected) {
        const m = kitMd.match(new RegExp(`\\*\\*\`${name}\`\\*\\* \\((\\d+) of (\\d+) parts\\)`));
        assert.ok(m, `${kit}/KIT.md must state ${name} count`);
        assert.equal(Number(m[1]), actualCount, `${kit} ${name} count must match PARTS.json`);
        assert.equal(Number(m[2]), stats.total, `${kit} ${name} denominator must match PARTS.json`);
      }
    }
  }
});

test('API.md is identical across kits and all documented API names exist in vendored _internal modules', () => {
  const apiCamp = readKitFile('kit-campground', 'API.md');
  const apiMed = readKitFile('kit-medieval', 'API.md');
  assert.equal(apiCamp, apiMed, 'API.md must be byte-identical across both vendored kits');

  for (const mod of ['_internal/kit.mjs', '_internal/stage.mjs', '_internal/clips.mjs']) {
    assert.equal(
      readKitFile('kit-campground', mod),
      readKitFile('kit-medieval', mod),
      `${mod} must be byte-identical across both vendored kits`
    );
  }

  const kitSrc = readKitFile('kit-campground', '_internal/kit.mjs');
  const stageSrc = readKitFile('kit-campground', '_internal/stage.mjs');
  const clipsSrc = readKitFile('kit-campground', '_internal/clips.mjs');

  const buildKitOpts = [
    'base', 'kit', 'folder', 'params', 'keep', 'only', 'skip',
    'people', 'night', 'loose', 'setting', 'terrainParams', 'city',
  ];
  const placeProps = [
    'group', 'bounds', 'of', 'where', 'openSpot', 'spots', 'blocked',
    'boxes', 'surfaceAt', 'groundAt', 'vista', 'surround', 'night',
    'light', 'loose', 'people', 'tick', 'city',
    // Also used by staging.js:
    'placed', 'missing', 'groundY',
  ];
  const stageLook = ['shadows', 'ground', 'follow', 'update', 'setTime', 'shadowSpan'];
  const timeNames = ['noon', 'day', 'golden', 'dusk', 'night', 'moonlit', 'dawn', 'overcast', 'space'];
  const animProps = ['play', 'locomotion', 'update', 'base'];

  for (const name of [...buildKitOpts, ...placeProps]) {
    assert.match(kitSrc, new RegExp(`\\b${name}\\b`), `_internal/kit.mjs must define ${name}`);
  }
  for (const name of stageLook) {
    assert.match(stageSrc, new RegExp(`\\b${name}\\b`), `_internal/stage.mjs must define ${name}`);
  }
  for (const name of timeNames) {
    assert.match(stageSrc, new RegExp(`['"]${name}['"]|${name}\\s*:`), `_internal/stage.mjs must define time '${name}'`);
  }
  for (const name of animProps) {
    assert.match(clipsSrc, new RegExp(`\\b${name}\\b`), `_internal/clips.mjs must define ${name}`);
  }
});

test('LAYOUT.json rows reference valid PARTS.json keys or _terrain with numeric coordinates', () => {
  const expectedTerrainRows = { 'kit-campground': 1, 'kit-medieval': 0 };
  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    let terrainCount = 0;

    for (let i = 0; i < layoutJson.length; i++) {
      const row = layoutJson[i];
      assert.equal(typeof row.x, 'number', `${kit} LAYOUT[${i}].x must be a number`);
      assert.equal(typeof row.y, 'number', `${kit} LAYOUT[${i}].y must be a number`);
      assert.equal(typeof row.z, 'number', `${kit} LAYOUT[${i}].z must be a number`);
      assert.ok(Number.isFinite(row.x) && Number.isFinite(row.y) && Number.isFinite(row.z));

      if (row.part === '_terrain') {
        terrainCount++;
        assert.equal(typeof row.module, 'string', `${kit} _terrain row must have a module string`);
        assert.ok(row.module.length > 0, `${kit} _terrain row module must be non-empty`);
      } else {
        assert.ok(row.part in partsJson, `${kit} LAYOUT[${i}].part '${row.part}' must exist in PARTS.json`);
      }
    }

    assert.equal(terrainCount, expectedTerrainRows[kit], `${kit} _terrain row count`);
  }
});

test('kit.json title, classes keys, and terrain flag match KIT.md and PARTS.json', () => {
  for (const kit of KITS) {
    const kitMd = readKitFile(kit, 'KIT.md');
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));

    const h1Match = kitMd.match(/^#\s+(.+)$/m);
    assert.ok(h1Match, `${kit}/KIT.md must have an H1 title`);
    assert.equal(kitJson.title, h1Match[1], `${kit}/kit.json title must match KIT.md H1`);

    const classKeys = Object.keys(kitJson.classes || {}).sort();
    const partKeys = Object.keys(partsJson).sort();
    assert.deepEqual(classKeys, partKeys, `${kit}/kit.json classes keys must match PARTS.json keys`);

    assert.equal(
      kitJson.terrain,
      'terrain' in partsJson,
      `${kit}/kit.json terrain flag must match presence of terrain in PARTS.json`
    );
  }
});

test('vendored kit documentation, metadata, and runtime modules named in KIT.md exist on disk', () => {
  const commonFiles = [
    'API.md',
    'KIT.md',
    'PARTS.json',
    'LAYOUT.json',
    'kit.json',
    'terrain.mjs',
    ...INFRA_MJS,
    '_internal/kit.mjs',
    '_internal/stage.mjs',
    '_internal/clips.mjs',
  ];
  const kitSpecificFiles = {
    'kit-campground': ['TERRAIN.json'],
    'kit-medieval': [],
  };

  for (const kit of KITS) {
    for (const rel of [...commonFiles, ...kitSpecificFiles[kit]]) {
      assert.ok(
        fs.existsSync(path.join(__dirname, kit, rel)),
        `${kit}/${rel} must exist on disk`
      );
    }
  }
});

test('every part .mjs module in PARTS.json is non-empty and exports createAsset', () => {
  const exportRe = /export\s+function\s+createAsset\b|export\s*\{[^}]*\bcreateAsset\b/;
  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    for (const partKey of Object.keys(partsJson)) {
      const src = readKitFile(kit, `${partKey}.mjs`);
      assert.ok(src.trim().length > 0, `${kit}/${partKey}.mjs must be non-empty`);
      assert.match(src, exportRe, `${kit}/${partKey}.mjs must export createAsset`);
    }
  }
});
