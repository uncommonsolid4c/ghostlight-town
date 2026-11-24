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

test('KIT.md code-block placement count matches LAYOUT.json length', () => {
  for (const kit of KITS) {
    const kitMd = readKitFile(kit, 'KIT.md');
    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    const match = kitMd.match(/all (\d+) placements/);
    assert.ok(match, `${kit}/KIT.md code block must state 'all <N> placements'`);
    assert.equal(Number(match[1]), layoutJson.length, `${kit}/KIT.md code-block placement count must match LAYOUT.json`);
  }
});

test('KIT.md "## Parts" section count matches PARTS.json key count', () => {
  for (const kit of KITS) {
    const kitMd = readKitFile(kit, 'KIT.md');
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const match = kitMd.match(/^## Parts\r?\n+(\d+) parts\./m);
    assert.ok(match, `${kit}/KIT.md ## Parts section must start with '<N> parts.'`);
    assert.equal(Number(match[1]), Object.keys(partsJson).length, `${kit}/KIT.md ## Parts count must match PARTS.json`);
  }
});

test('kit.json night entries are well-formed and reference real PARTS.json keys', () => {
  const hexColorRe = /^#[0-9a-fA-F]{6}$/;
  for (const kit of KITS) {
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    assert.ok(Array.isArray(kitJson.night) && kitJson.night.length > 0, `${kit}/kit.json night must be a non-empty array`);

    for (let i = 0; i < kitJson.night.length; i++) {
      const entry = kitJson.night[i];
      assert.match(entry.from, hexColorRe, `${kit} night[${i}].from must be a 6-digit hex color`);
      assert.match(entry.to, hexColorRe, `${kit} night[${i}].to must be a 6-digit hex color`);
      assert.equal(typeof entry.intensity, 'number', `${kit} night[${i}].intensity must be a number`);
      assert.ok(Number.isFinite(entry.intensity) && entry.intensity > 0, `${kit} night[${i}].intensity must be > 0`);
      assert.ok(Array.isArray(entry.parts) && entry.parts.length > 0, `${kit} night[${i}].parts must be a non-empty array`);
      for (const part of entry.parts) {
        assert.ok(part in partsJson, `${kit} night[${i}].parts '${part}' must exist in PARTS.json`);
      }
    }
  }
});

test('CREDITS.txt and LICENSE.txt exist, are non-empty, and CREDITS.txt names Polyfork', () => {
  for (const kit of KITS) {
    for (const file of ['CREDITS.txt', 'LICENSE.txt']) {
      const filePath = path.join(__dirname, kit, file);
      assert.ok(fs.existsSync(filePath), `${kit}/${file} must exist on disk`);
      assert.ok(fs.statSync(filePath).size > 0, `${kit}/${file} must have size > 0`);
    }
    const credits = readKitFile(kit, 'CREDITS.txt');
    assert.match(credits, /polyfork/i, `${kit}/CREDITS.txt must name Polyfork`);
  }
});

test('terrain.mjs exports createAsset and TERRAIN.json matches _terrain row where present', () => {
  for (const kit of KITS) {
    const terrainSrc = readKitFile(kit, 'terrain.mjs');
    assert.match(terrainSrc, /export[^;]*createAsset/, `${kit}/terrain.mjs must export createAsset`);

    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    const terrainRows = layoutJson.filter((row) => row.part === '_terrain');
    const terrainJsonPath = path.join(__dirname, kit, 'TERRAIN.json');

    if (kit === 'kit-campground') {
      assert.ok(fs.existsSync(terrainJsonPath), `${kit}/TERRAIN.json must exist on disk`);
      assert.equal(terrainRows.length, 1, `${kit} LAYOUT.json must have 1 _terrain row`);
      const terrainJson = JSON.parse(readKitFile(kit, 'TERRAIN.json'));
      assert.deepEqual(terrainJson, terrainRows[0].params, `${kit}/TERRAIN.json must match _terrain row params`);
    } else {
      assert.equal(fs.existsSync(terrainJsonPath), false, `${kit} must not have TERRAIN.json`);
      assert.equal(terrainRows.length, 0, `${kit} LAYOUT.json must have 0 _terrain rows`);
    }
  }
});

test('LAYOUT.json non-_terrain row fields (rx/ry/rz, s, params) are well-typed', () => {
  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));

    for (let i = 0; i < layoutJson.length; i++) {
      const row = layoutJson[i];
      if (row.part === '_terrain') continue;

      for (const rot of ['rx', 'ry', 'rz']) {
        if (row[rot] !== undefined) {
          assert.equal(typeof row[rot], 'number', `${kit} LAYOUT[${i}].${rot} must be a number`);
          assert.ok(Number.isFinite(row[rot]), `${kit} LAYOUT[${i}].${rot} must be finite`);
        }
      }

      if (row.s !== undefined) {
        assert.ok(Array.isArray(row.s) && row.s.length === 3, `${kit} LAYOUT[${i}].s must be a 3-element array`);
        for (let j = 0; j < 3; j++) {
          assert.equal(typeof row.s[j], 'number', `${kit} LAYOUT[${i}].s[${j}] must be a number`);
          assert.ok(Number.isFinite(row.s[j]) && row.s[j] > 0, `${kit} LAYOUT[${i}].s[${j}] must be finite and > 0`);
        }
      }

      if (row.params !== undefined) {
        assert.ok(
          typeof row.params === 'object' && row.params !== null && !Array.isArray(row.params),
          `${kit} LAYOUT[${i}].params must be a plain object`
        );
        const knobs = partsJson[row.part].knobs || {};
        for (const key of Object.keys(row.params)) {
          assert.ok(key in knobs, `${kit} LAYOUT[${i}].params.${key} must exist in PARTS.json[${row.part}].knobs`);
        }
      }
    }
  }
});

test('CREDITS.txt has one .glb credit line per PARTS.json key', () => {
  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const credits = readKitFile(kit, 'CREDITS.txt');
    const keys = Object.keys(partsJson);
    const glbLines = credits.split(/\r?\n/).filter((line) => line.includes('.glb'));

    assert.equal(glbLines.length, keys.length, `${kit}/CREDITS.txt .glb line count must match PARTS.json`);
    for (const key of keys) {
      assert.ok(credits.includes(`${key}.glb`), `${kit}/CREDITS.txt must credit ${key}.glb`);
    }
  }
});

test('every PARTS.json knob spec string ends with " (default)"', () => {
  const defaultRe = / \([^)]*\)$/;
  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    for (const [partKey, entry] of Object.entries(partsJson)) {
      for (const [knobName, spec] of Object.entries(entry.knobs || {})) {
        assert.equal(typeof spec, 'string', `${kit} PARTS[${partKey}].knobs.${knobName} must be a string`);
        assert.match(spec, defaultRe, `${kit} PARTS[${partKey}].knobs.${knobName} must end with ' (default)'`);
      }
    }
  }
});

test('PARTS.json colors arrays are well-formed where present', () => {
  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    for (const [partKey, entry] of Object.entries(partsJson)) {
      if (entry.colors === undefined) continue;
      assert.ok(
        Array.isArray(entry.colors) && entry.colors.length > 0,
        `${kit} PARTS[${partKey}].colors must be a non-empty array`
      );
      for (const zone of entry.colors) {
        assert.equal(typeof zone, 'string', `${kit} PARTS[${partKey}].colors entries must be strings`);
        assert.ok(zone.length > 0, `${kit} PARTS[${partKey}].colors entries must be non-empty`);
      }
      assert.equal(
        new Set(entry.colors).size,
        entry.colors.length,
        `${kit} PARTS[${partKey}].colors must not contain duplicates`
      );
    }
  }
});

test('kit.json night-entry parts have a lit zone and PARTS.json lit arrays are well-formed', () => {
  for (const kit of KITS) {
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));

    for (let i = 0; i < kitJson.night.length; i++) {
      for (const part of kitJson.night[i].parts) {
        assert.ok(
          partsJson[part].lit !== undefined,
          `${kit} night[${i}] part '${part}' must have a lit field in PARTS.json`
        );
      }
    }

    for (const [partKey, entry] of Object.entries(partsJson)) {
      if (entry.lit === undefined) continue;
      assert.ok(
        Array.isArray(entry.lit) && entry.lit.length > 0,
        `${kit} PARTS[${partKey}].lit must be a non-empty array`
      );
      for (const zone of entry.lit) {
        assert.equal(typeof zone, 'string', `${kit} PARTS[${partKey}].lit entries must be strings`);
        assert.ok(zone.length > 0, `${kit} PARTS[${partKey}].lit entries must be non-empty`);
      }
    }
  }
});

test('PARTS.json rig is a non-empty string array where present', () => {
  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    for (const [partKey, entry] of Object.entries(partsJson)) {
      if (entry.rig === undefined) continue;
      assert.ok(
        Array.isArray(entry.rig) && entry.rig.length > 0,
        `${kit} PARTS[${partKey}].rig must be a non-empty array`
      );
      for (const bone of entry.rig) {
        assert.equal(typeof bone, 'string', `${kit} PARTS[${partKey}].rig entries must be strings`);
        assert.ok(bone.length > 0, `${kit} PARTS[${partKey}].rig entries must be non-empty`);
      }
    }
  }
});

test('LAYOUT.json optional s is uniform and optional anim appears in _internal/clips.mjs', () => {
  for (const kit of KITS) {
    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    const clipsSrc = readKitFile(kit, '_internal/clips.mjs');

    for (let i = 0; i < layoutJson.length; i++) {
      const row = layoutJson[i];
      if (row.s !== undefined) {
        assert.ok(
          row.s[0] === row.s[1] && row.s[1] === row.s[2],
          `${kit} LAYOUT[${i}].s must be uniform [v, v, v]`
        );
      }
      if (row.anim !== undefined) {
        assert.equal(typeof row.anim, 'string', `${kit} LAYOUT[${i}].anim must be a string`);
        assert.ok(row.anim.length > 0, `${kit} LAYOUT[${i}].anim must be non-empty`);
        assert.ok(
          clipsSrc.includes(row.anim),
          `${kit} LAYOUT[${i}].anim '${row.anim}' must appear in _internal/clips.mjs`
        );
      }
    }
  }
});

test('PARTS.json class matches kit.json classes except the 3 pinned medieval divergences', () => {
  const validPartsClasses = new Set(['building', 'character', 'prop', 'terrain', 'vehicle']);
  const validKitClasses = new Set([...validPartsClasses, 'animal']);

  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));
    const keys = Object.keys(partsJson);
    const mismatches = {};

    for (const key of keys) {
      const partsClass = partsJson[key].class;
      const kitClass = kitJson.classes[key];
      assert.ok(validPartsClasses.has(partsClass), `${kit} PARTS[${key}].class '${partsClass}' must be in valid vocabulary`);
      assert.ok(validKitClasses.has(kitClass), `${kit} kit.json.classes['${key}'] '${kitClass}' must be in valid vocabulary`);
      if (partsClass !== kitClass) {
        mismatches[key] = [partsClass, kitClass];
      }
    }

    if (kit === 'kit-campground') {
      assert.equal(keys.length, 62, 'kit-campground PARTS.json must have 62 parts');
      assert.deepEqual(mismatches, {}, 'kit-campground PARTS.json class must match kit.json classes for all 62 parts');
    } else {
      // The 3 medieval divergences are vendor-file disagreement, pinned as a drift guard — do not "fix" either file.
      assert.deepEqual(
        mismatches,
        {
          chicken: ['character', 'animal'],
          'draft-horse': ['character', 'animal'],
          'market-stall': ['prop', 'building'],
        },
        'kit-medieval PARTS.json class vs kit.json classes must match except the 3 pinned divergences'
      );
    }
  }
});

test('LAYOUT.json params values are valid against PARTS.json knob specs', () => {
  let checked = 0;

  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));

    for (let i = 0; i < layoutJson.length; i++) {
      const row = layoutJson[i];
      if (row.part === '_terrain' || row.params === undefined) continue;

      const knobs = partsJson[row.part].knobs || {};
      for (const [knob, value] of Object.entries(row.params)) {
        const spec = knobs[knob];
        assert.equal(typeof spec, 'string', `${kit} PARTS[${row.part}].knobs.${knob} must be a string`);
        const body = spec.replace(/ \([^)]*\)$/, '');

        // Knob 'seed' is exempt from the range check — the vendor's own composed layout uses seeds up to 139
        // (primes: 101, 107, 113, 127, 137, 139) although the spec says "1..99 (7)".
        if (knob === 'seed') {
          assert.ok(Number.isInteger(value) && value >= 1, `${kit} LAYOUT[${i}].params.seed must be an integer >= 1`);
          checked++;
          continue;
        }

        if (body.includes('|')) {
          assert.ok(
            body.split('|').includes(String(value)),
            `${kit} LAYOUT[${i}].params.${knob}='${value}' must be in enum '${body}'`
          );
        } else {
          const rangeMatch = body.match(/^(-?[\d.]+)\.\.(-?[\d.]+)$/);
          if (rangeMatch) {
            const lo = Number(rangeMatch[1]);
            const hi = Number(rangeMatch[2]);
            assert.equal(typeof value, 'number', `${kit} LAYOUT[${i}].params.${knob} must be a number`);
            assert.ok(
              value >= lo && value <= hi,
              `${kit} LAYOUT[${i}].params.${knob}=${value} must be within ${lo}..${hi}`
            );
          } else {
            assert.fail(`${kit} LAYOUT[${i}].params.${knob} has unknown knob spec shape: '${spec}'`);
          }
        }
        checked++;
      }
    }
  }

  assert.equal(checked, 379, 'Expected 379 LAYOUT.json param values checked across both kits');
});

test('CREDITS.txt .glb lines follow the LICENSE.txt credit-line template', () => {
  const creditLineRe = /^([a-z0-9-]+)\.glb  (.+) by Polyfork \(https:\/\/polyfork\.dev\/asset\/[a-z0-9-]+-[0-9a-f]{6}\), CC BY 4\.0$/;

  for (const kit of KITS) {
    const credits = readKitFile(kit, 'CREDITS.txt');
    const license = readKitFile(kit, 'LICENSE.txt');

    assert.ok(
      credits.startsWith('Credit lines for CC BY 4.0'),
      `${kit}/CREDITS.txt must start with 'Credit lines for CC BY 4.0'`
    );

    const glbLines = credits.split(/\r?\n/).filter((line) => line.includes('.glb'));
    for (const line of glbLines) {
      assert.match(line, creditLineRe, `${kit}/CREDITS.txt .glb line must match LICENSE.txt credit-line template: ${line}`);
    }

    for (const phrase of ['CC BY 4.0', 'The Polyfork licence', 'EVERYTHING ELSE', '.mjs']) {
      assert.ok(license.includes(phrase), `${kit}/LICENSE.txt must contain '${phrase}'`);
    }
  }
});

test('kit.json has exactly 7 top-level keys, null ground, false interior, and a slug KIT.md links', () => {
  for (const kit of KITS) {
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));
    const kitMd = readKitFile(kit, 'KIT.md');

    assert.deepEqual(
      Object.keys(kitJson).sort(),
      ['classes', 'ground', 'interior', 'kit', 'night', 'terrain', 'title'],
      `${kit}/kit.json must have exactly the 7 expected top-level keys`
    );
    assert.equal(kitJson.ground, null, `${kit}/kit.json ground must be null`);
    assert.equal(kitJson.interior, false, `${kit}/kit.json interior must be false`);
    assert.match(kitJson.kit, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${kit}/kit.json kit must be a kebab-case slug`);
    assert.ok(
      kitMd.includes(`https://polyfork.dev/kit/${kitJson.kit}`),
      `${kit}/KIT.md must link https://polyfork.dev/kit/${kitJson.kit}`
    );
  }
});

test('TERRAIN.json keys are declared terrain.mjs knobs and pads are well-formed', () => {
  const kit = 'kit-campground';
  const terrainJson = JSON.parse(readKitFile(kit, 'TERRAIN.json'));
  const terrainSrc = readKitFile(kit, 'terrain.mjs');

  const paramsMatch = terrainSrc.match(/export const params = \{([\s\S]*?)\n\};/);
  assert.ok(paramsMatch, `${kit}/terrain.mjs must declare export const params`);
  const paramKeys = new Set([...paramsMatch[1].matchAll(/^  ([a-zA-Z]+): \{/gm)].map((m) => m[1]));

  const zonesMatch = terrainSrc.match(/const ZONES = \[([^\]]+)\];/);
  assert.ok(zonesMatch, `${kit}/terrain.mjs must declare const ZONES`);
  const zoneKeys = new Set([...zonesMatch[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]));

  const extraKeys = new Set(['cx', 'cz', 'seed', 'pads']);
  for (const key of Object.keys(terrainJson)) {
    assert.ok(
      paramKeys.has(key) || zoneKeys.has(key) || extraKeys.has(key),
      `${kit}/TERRAIN.json key '${key}' must be a terrain.mjs param, ZONES entry, or cx/cz/seed/pads`
    );
  }

  const colorwaysMatch = terrainSrc.match(/const COLORWAYS = \{([\s\S]*?)\n\};/);
  assert.ok(
    colorwaysMatch && colorwaysMatch[1].includes(`'${terrainJson.colorway}':`),
    `${kit}/TERRAIN.json colorway '${terrainJson.colorway}' must appear in COLORWAYS`
  );

  const seasonsMatch = terrainSrc.match(/const SEASONS = \{([\s\S]*?)\n\};/);
  assert.ok(
    seasonsMatch && seasonsMatch[1].includes(`${terrainJson.season}:`),
    `${kit}/TERRAIN.json season '${terrainJson.season}' must appear in SEASONS`
  );

  assert.ok(
    terrainJson.edges === 'island' || terrainJson.edges === 'tile',
    `${kit}/TERRAIN.json edges must be 'island' or 'tile'`
  );

  for (const zone of zoneKeys) {
    assert.match(
      terrainJson[zone],
      /^#[0-9A-Fa-f]{6}$/,
      `${kit}/TERRAIN.json zone '${zone}' must be a 6-digit hex color`
    );
  }

  assert.ok(Array.isArray(terrainJson.pads) && terrainJson.pads.length === 11, `${kit}/TERRAIN.json pads must have length 11`);
  for (let i = 0; i < terrainJson.pads.length; i++) {
    const pad = terrainJson.pads[i];
    assert.deepEqual(Object.keys(pad).sort(), ['d', 'w', 'x', 'y', 'z'], `${kit}/TERRAIN.json pads[${i}] keys`);
    for (const k of ['x', 'z', 'w', 'd', 'y']) {
      assert.equal(typeof pad[k], 'number', `${kit}/TERRAIN.json pads[${i}].${k} must be a number`);
      assert.ok(Number.isFinite(pad[k]), `${kit}/TERRAIN.json pads[${i}].${k} must be finite`);
    }
    assert.ok(pad.w > 0 && pad.d > 0, `${kit}/TERRAIN.json pads[${i}] w and d must be > 0`);
  }
});

test('clips.mjs falls back to the Polyfork CDN and animate defaults to HOME', () => {
  // Pins the runtime clip-fetch dependency — served away from polyfork.dev, animate() fetches clips from the CDN.
  for (const kit of KITS) {
    const clipsSrc = readKitFile(kit, '_internal/clips.mjs');

    assert.ok(clipsSrc.includes("const CDN = 'https://polyfork.dev/cdn/';"), `${kit}/_internal/clips.mjs must define CDN`);
    assert.ok(clipsSrc.includes("const HERE = new URL('.', import.meta.url).href;"), `${kit}/_internal/clips.mjs must define HERE`);
    assert.ok(
      clipsSrc.includes('const HOME = /^https:\\/\\/polyfork\\.dev\\//.test(HERE) ? HERE : CDN;'),
      `${kit}/_internal/clips.mjs must define HOME fallback to CDN`
    );
    assert.ok(
      clipsSrc.includes("export async function animate(character, { clips = ['Idle', 'Walk', 'Run'], inPlace = true, fade = 0.2, base = HOME } = {})"),
      `${kit}/_internal/clips.mjs animate() must default base = HOME`
    );
    assert.ok(clipsSrc.includes('fetch' + '(url)'), `${kit}/_internal/clips.mjs must call ` + 'fetch' + '(url)');
  }
});

test('_internal/merge.mjs and city.mjs are byte-identical across kits with expected exports', () => {
  assert.equal(
    readKitFile('kit-campground', '_internal/merge.mjs'),
    readKitFile('kit-medieval', '_internal/merge.mjs'),
    '_internal/merge.mjs must be byte-identical across kits'
  );
  assert.equal(
    readKitFile('kit-campground', '_internal/city.mjs'),
    readKitFile('kit-medieval', '_internal/city.mjs'),
    '_internal/city.mjs must be byte-identical across kits'
  );

  const mergeSrc = readKitFile('kit-campground', '_internal/merge.mjs');
  assert.ok(
    mergeSrc.includes('export function mergeAssets(list, { keepDynamic = true } = {})'),
    '_internal/merge.mjs must export mergeAssets'
  );
  assert.ok(
    mergeSrc.includes("import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';"),
    '_internal/merge.mjs must import mergeGeometries'
  );

  const citySrc = readKitFile('kit-campground', '_internal/city.mjs');
  assert.ok(citySrc.includes('export function cityLayout('), '_internal/city.mjs must export cityLayout');
  assert.ok(citySrc.includes('export default cityLayout;'), '_internal/city.mjs must default-export cityLayout');
});

test('API.md is the 8-line one-paragraph contract in both kits', () => {
  for (const kit of KITS) {
    const apiMd = readKitFile(kit, 'API.md');
    assert.ok(apiMd.startsWith('# The API, all of it\n'), `${kit}/API.md must start with # The API, all of it`);
    const trimmed = apiMd.trim();
    assert.equal(trimmed.split('\n').length, 8, `${kit}/API.md must have 8 lines when trimmed`);
    assert.ok(trimmed.endsWith('The game is yours.'), `${kit}/API.md must end with The game is yours.`);
    assert.ok(
      apiMd.includes("setTime('noon'|'day'|'golden'|'dusk'|'night'|'moonlit'|'dawn'|'overcast'|'space' or 0..1 day to night"),
      `${kit}/API.md must document setTime modes`
    );
    assert.ok(
      apiMd.includes('`setting: true` builds the SETTING only'),
      `${kit}/API.md must document setting: true`
    );
  }
});

test('KIT.md packed date and part counts match PARTS.json', () => {
  for (const kit of KITS) {
    const kitMd = readKitFile(kit, 'KIT.md');
    const partsCount = Object.keys(JSON.parse(readKitFile(kit, 'PARTS.json'))).length;
    const m = kitMd.match(/(\d+) of (\d+) parts, packed (\d{4}-\d{2}-\d{2})\./);
    assert.ok(m, `${kit}/KIT.md must declare packed part counts and date`);
    assert.equal(Number(m[1]), partsCount, `${kit}/KIT.md first part count must match PARTS.json`);
    assert.equal(Number(m[2]), partsCount, `${kit}/KIT.md second part count must match PARTS.json`);
    assert.equal(m[3], '2026-11-10', `${kit}/KIT.md packed date must be 2026-11-10`);
  }
});

test('KIT.md shared-knob bullet lists and campground season/wear text match contract', () => {
  const campMd = readKitFile('kit-campground', 'KIT.md');
  const medMd = readKitFile('kit-medieval', 'KIT.md');

  const campBullets = [...campMd.matchAll(/^-\s+\*\*`([a-z]+)`\*\*/gm)].map((m) => m[1]);
  const medBullets = [...medMd.matchAll(/^-\s+\*\*`([a-z]+)`\*\*/gm)].map((m) => m[1]);

  assert.deepEqual(campBullets, ['season', 'wear', 'snow', 'leaves', 'blossom', 'colorway']);
  assert.deepEqual(medBullets, ['colorway']);
  assert.ok(
    campMd.includes('- **`season`** (62 of 62 parts): `spring`, `summer`, `autumn`, `winter`. One value per scene'),
    'campground KIT.md must document season enum values'
  );
  assert.ok(
    campMd.includes('- **`wear`** (61 of 62 parts): 0 to 1. One value per scene'),
    'campground KIT.md must document wear range'
  );
});

test('KIT.md palette lists contain valid, unique hex colors', () => {
  const expectedCounts = { 'kit-campground': 25, 'kit-medieval': 16 };
  for (const kit of KITS) {
    const kitMd = readKitFile(kit, 'KIT.md');
    const m = kitMd.match(/\*\*Palette\.\*\*([^\n]*)/);
    assert.ok(m, `${kit}/KIT.md must include a **Palette.** paragraph`);
    const hexes = m[1].match(/#[0-9a-fA-F]{6}/g) || [];
    assert.equal(hexes.length, expectedCounts[kit], `${kit}/KIT.md palette hex count`);
    assert.equal(
      new Set(hexes.map((h) => h.toLowerCase())).size,
      expectedCounts[kit],
      `${kit}/KIT.md palette hex colors must be unique`
    );
  }
});

test('KIT.md Scale sections contain expected kit-specific phrases', () => {
  const campMd = readKitFile('kit-campground', 'KIT.md');
  for (const phrase of [
    'Everything snaps to a 4 m grid',
    '2.6 m storey',
    '2.0 m doors',
    'exactly 0.6 m above it',
    "the lake's water plane is y=0",
  ]) {
    assert.ok(campMd.includes(phrase), `kit-campground/KIT.md must include '${phrase}'`);
  }

  const medMd = readKitFile('kit-medieval', 'KIT.md');
  for (const phrase of [
    'Everything snaps to a 2m grid',
    'wall modules are 2m wide and 3m tall',
    'doorways 2.1m',
    'roof pitch a constant 45 degrees',
  ]) {
    assert.ok(medMd.includes(phrase), `kit-medieval/KIT.md must include '${phrase}'`);
  }
});

test('PARTS.json entry key vocabulary and field presence counts match', () => {
  const allowedKeys = new Set(['class', 'colors', 'knobs', 'lit', 'rig']);
  const expected = {
    'kit-campground': { colors: 62, lit: 16, rig: 56 },
    'kit-medieval': { colors: 49, lit: 16, rig: 28 },
  };
  for (const kit of KITS) {
    const parts = JSON.parse(readKitFile(kit, 'PARTS.json'));
    let colors = 0;
    let lit = 0;
    let rig = 0;
    for (const [partKey, entry] of Object.entries(parts)) {
      for (const key of Object.keys(entry)) {
        assert.ok(allowedKeys.has(key), `${kit}/PARTS.json '${partKey}' has unexpected key '${key}'`);
      }
      assert.ok('class' in entry && 'knobs' in entry, `${kit}/PARTS.json '${partKey}' must have class and knobs`);
      if ('colors' in entry) colors++;
      if ('lit' in entry) lit++;
      if ('rig' in entry) rig++;
    }
    assert.deepEqual({ colors, lit, rig }, expected[kit], `${kit}/PARTS.json presence counts`);
  }
});

test('kit.json night-entry totals, from/to distinctness, and intensity bounds', () => {
  const expected = {
    'kit-campground': { entries: 26, partsTotal: 30, maxIntensity: 1.4 },
    'kit-medieval': { entries: 10, partsTotal: 10, maxIntensity: 1 },
  };
  for (const kit of KITS) {
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));
    const night = kitJson.night || [];
    let partsTotal = 0;
    let maxIntensity = 0;
    for (const entry of night) {
      assert.notEqual(entry.from, entry.to, `${kit}/kit.json night entry must have from !== to`);
      assert.ok(
        entry.intensity > 0 && entry.intensity <= 1.4,
        `${kit}/kit.json night entry intensity must be in (0, 1.4]`
      );
      if (entry.intensity > maxIntensity) maxIntensity = entry.intensity;
      partsTotal += entry.parts.length;
    }
    assert.equal(night.length, expected[kit].entries, `${kit}/kit.json night entry count`);
    assert.equal(partsTotal, expected[kit].partsTotal, `${kit}/kit.json night parts total`);
    assert.equal(maxIntensity, expected[kit].maxIntensity, `${kit}/kit.json max night intensity`);
  }
});

test('LAYOUT.json row key vocabulary and rx/rz=180 upright pairing', () => {
  const allowedKeys = new Set(['part', 'x', 'y', 'z', 'rx', 'ry', 'rz', 's', 'params', 'anim', 'module']);
  for (const kit of KITS) {
    const layout = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    for (let i = 0; i < layout.length; i++) {
      const row = layout[i];
      for (const key of Object.keys(row)) {
        assert.ok(allowedKeys.has(key), `${kit}/LAYOUT.json row ${i} has unexpected key '${key}'`);
      }
      assert.equal(
        row.rx === 180,
        row.rz === 180,
        `${kit}/LAYOUT.json row ${i} must pair rx === 180 with rz === 180`
      );
    }
  }
});

test('CREDITS.txt line counts and non-glb header lines are identical across kits', () => {
  const expectedCounts = {
    'kit-campground': { total: 68, glb: 62 },
    'kit-medieval': { total: 66, glb: 60 },
  };
  const expectedHeader = [
    'Credit lines for CC BY 4.0, https://creativecommons.org/licenses/by/4.0/',
    'If you share or re-host one of these mesh files under CC BY, keep its line with it',
    "(the same line covers that model's .fbx, .usdz, .usda and .obj). Under the Polyfork",
    'licence no credit is needed. LICENSE.txt has both.',
  ];
  for (const kit of KITS) {
    const lines = readKitFile(kit, 'CREDITS.txt').trim().split('\n');
    const glbLines = lines.filter((l) => l.includes('.glb'));
    const nonGlbNonEmpty = lines.filter((l) => l.trim() !== '' && !l.includes('.glb'));
    assert.equal(lines.length, expectedCounts[kit].total, `${kit}/CREDITS.txt trimmed line count`);
    assert.equal(glbLines.length, expectedCounts[kit].glb, `${kit}/CREDITS.txt .glb line count`);
    assert.deepEqual(nonGlbNonEmpty, expectedHeader, `${kit}/CREDITS.txt non-glb header lines`);
  }
});
