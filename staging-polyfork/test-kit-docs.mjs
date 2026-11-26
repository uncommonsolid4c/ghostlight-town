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

test('KIT.md heading inventory and Parts line numbers match', () => {
  const expectedHeadings = {
    'kit-campground': [
      '# Campground & Lake',
      '## What is in this folder',
      '## The ground',
      '## Using them together',
      '## Parts',
      '## Building this with an AI agent?',
    ],
    'kit-medieval': [
      '# Medieval Village Kit',
      '## What is in this folder',
      '## The ground',
      '## Using them together',
      '## Parts',
      '## Building this with an AI agent?',
    ],
  };
  const expectedPartsLineIdx = {
    'kit-campground': 85,
    'kit-medieval': 78,
  };
  for (const kit of KITS) {
    const md = readKitFile(kit, 'KIT.md');
    const lines = md.split('\n');
    const headings = lines.filter((l) => l.startsWith('#'));
    assert.deepEqual(headings, expectedHeadings[kit], `${kit}/KIT.md heading inventory`);
    assert.equal(
      lines[expectedPartsLineIdx[kit]],
      '## Parts',
      `${kit}/KIT.md ## Parts must be at 0-based line ${expectedPartsLineIdx[kit]}`
    );
  }
});

test('LICENSE.txt is byte-identical across kits with 29 lines and pinned first/last lines', () => {
  const camp = readKitFile('kit-campground', 'LICENSE.txt');
  const med = readKitFile('kit-medieval', 'LICENSE.txt');
  assert.equal(camp, med, 'LICENSE.txt must be byte-identical across kits');
  const splitLines = camp.split('\n');
  assert.equal(splitLines.length, 30, 'LICENSE.txt split(\\n) must have length 30 (29 lines + trailing newline)');
  assert.equal(splitLines[splitLines.length - 1], '', 'LICENSE.txt must end with a trailing newline');
  const trimmedLines = camp.trim().split('\n');
  assert.equal(trimmedLines.length, 29, 'LICENSE.txt trimmed must have 29 lines');
  assert.equal(trimmedLines[0], 'Licence', 'LICENSE.txt first line');
  assert.equal(
    trimmedLines[28],
    'Otherwise these files are yours permanently, including after a subscription ends.',
    'LICENSE.txt last content line'
  );
  assert.ok(
    camp.includes('Full terms: https://polyfork.dev/licensing'),
    'LICENSE.txt must include full terms URL'
  );
});

test('kit.json slug exact values and Building-section api URLs match', () => {
  const expectedSlugs = {
    'kit-campground': 'campground-lake-ad32b0',
    'kit-medieval': 'medieval-village-kit-ca0b43',
  };
  for (const kit of KITS) {
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));
    const slug = expectedSlugs[kit];
    assert.equal(kitJson.kit, slug, `${kit}/kit.json slug`);
    const md = readKitFile(kit, 'KIT.md');
    const parts = md.split('## Building this with an AI agent?\n');
    assert.equal(parts.length, 2, `${kit}/KIT.md must have Building section`);
    const body = parts[1];
    assert.equal(body.trim().split('\n').length, 3, `${kit}/KIT.md Building section must trim to 3 lines`);
    assert.ok(
      body.includes(`https://polyfork.dev/api/kits/${slug}`),
      `${kit}/KIT.md Building section must include api URL for ${slug}`
    );
    assert.ok(
      body.includes('https://polyfork.dev/prompt.txt'),
      `${kit}/KIT.md Building section must include prompt.txt URL`
    );
  }
});

test('The ground sections are byte-identical across kits despite medieval having no TERRAIN.json', () => {
  const campGround = readKitFile('kit-campground', 'KIT.md').split('## The ground\n')[1].split('\n## ')[0];
  const medGround = readKitFile('kit-medieval', 'KIT.md').split('## The ground\n')[1].split('\n## ')[0];
  assert.equal(campGround, medGround, '## The ground sections must be byte-identical across kits');
  assert.ok(campGround.includes('TERRAIN.json'), '## The ground section must mention TERRAIN.json');
  assert.equal(
    fs.existsSync(path.join(__dirname, 'kit-campground', 'TERRAIN.json')),
    true,
    'kit-campground must have TERRAIN.json on disk'
  );
  assert.equal(
    fs.existsSync(path.join(__dirname, 'kit-medieval', 'TERRAIN.json')),
    false,
    'kit-medieval must not have TERRAIN.json on disk'
  );
});

test('every PARTS.json knob default is a valid enum member or in-range number', () => {
  const expected = {
    'kit-campground': { enum: 187, range: 241, total: 428 },
    'kit-medieval': { enum: 108, range: 143, total: 251 },
  };
  for (const kit of KITS) {
    const parts = JSON.parse(readKitFile(kit, 'PARTS.json'));
    let enumCount = 0;
    let rangeCount = 0;
    let bad = 0;
    for (const [partKey, entry] of Object.entries(parts)) {
      for (const [knobName, spec] of Object.entries(entry.knobs || {})) {
        const m = String(spec).match(/^(.*) \(([^)]*)\)$/);
        assert.ok(m, `${kit}/PARTS.json '${partKey}.${knobName}' must match '<body > (<default>)'`);
        const [, body, def] = m;
        if (body.includes('|')) {
          enumCount++;
          if (!body.split('|').includes(def)) bad++;
        } else {
          const rm = body.match(/^(-?[\d.]+)\.\.(-?[\d.]+)$/);
          if (!rm) {
            assert.fail(`${kit}/PARTS.json '${partKey}.${knobName}' has unexpected spec shape: ${spec}`);
          }
          rangeCount++;
          const lo = Number(rm[1]);
          const hi = Number(rm[2]);
          const val = Number(def);
          if (!Number.isFinite(val) || val < lo || val > hi) bad++;
        }
      }
    }
    assert.equal(bad, 0, `${kit}/PARTS.json must have 0 invalid knob defaults`);
    assert.deepEqual(
      { enum: enumCount, range: rangeCount, total: enumCount + rangeCount },
      expected[kit],
      `${kit}/PARTS.json enum/range knob counts`
    );
  }
});

test('LAYOUT.json row-shape counts, unused parts, and top part match', () => {
  const expected = {
    'kit-campground': {
      rows: 174,
      anim: 5,
      s: 7,
      params: 174,
      module: 1,
      unique: 62,
      unused: ['terrain'],
      top: ['campground-pine-stand', 22],
    },
    'kit-medieval': {
      rows: 559,
      anim: 0,
      s: 495,
      params: 0,
      module: 0,
      unique: 34,
      unused: [
        'barn',
        'bread-oven',
        'bridge-wood',
        'chicken',
        'dirt-terrain-blob',
        'draft-horse',
        'gatehouse',
        'granary',
        'ground-dirt',
        'ground-grass',
        'guard',
        'orchard-tree',
        'plough',
        'roof-gable',
        'roof-hip-corner',
        'stone-wall',
        'terrain',
        'torch-sconce',
        'villager',
        'wagon-four-wheel',
        'wall-corner',
        'wall-door',
        'wall-straight',
        'wall-window',
        'watermill',
        'wheat-plant',
      ],
      top: ['grass-terrain-blob', 175],
    },
  };
  for (const kit of KITS) {
    const parts = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const layout = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    let anim = 0;
    let s = 0;
    let params = 0;
    let moduleCount = 0;
    const counts = new Map();
    for (const row of layout) {
      if ('anim' in row) anim++;
      if ('s' in row) s++;
      if ('params' in row) params++;
      if ('module' in row) moduleCount++;
      counts.set(row.part, (counts.get(row.part) || 0) + 1);
    }
    const unused = Object.keys(parts).filter((k) => !counts.has(k)).sort();
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    assert.deepEqual(
      {
        rows: layout.length,
        anim,
        s,
        params,
        module: moduleCount,
        unique: counts.size,
        unused,
        top,
      },
      expected[kit],
      `${kit}/LAYOUT.json row-shape summary`
    );
  }
});

test('LAYOUT.json coordinate bounds and campground anim values match', () => {
  const expectedBounds = {
    'kit-campground': { x: [-46.5, 192], y: [-4.339, 4], z: [-384, 34] },
    'kit-medieval': { x: [-21.299, 15.189], y: [-0.47, 0.05], z: [-19.103, 18.276] },
  };
  const expectedAnims = {
    'kit-campground': ['Fixing', 'Holding torch', 'Idle', 'Interact', 'Sitting'],
    'kit-medieval': [],
  };
  for (const kit of KITS) {
    const layout = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    const animSet = new Set();
    let animRows = 0;
    for (const row of layout) {
      if (row.x < minX) minX = row.x;
      if (row.x > maxX) maxX = row.x;
      if (row.y < minY) minY = row.y;
      if (row.y > maxY) maxY = row.y;
      if (row.z < minZ) minZ = row.z;
      if (row.z > maxZ) maxZ = row.z;
      if ('anim' in row) {
        animRows++;
        animSet.add(row.anim);
      }
    }
    assert.deepEqual(
      { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] },
      expectedBounds[kit],
      `${kit}/LAYOUT.json coordinate bounds`
    );
    assert.deepEqual([...animSet].sort(), expectedAnims[kit], `${kit}/LAYOUT.json anim values`);
    if (kit === 'kit-medieval') {
      assert.equal(animRows, 0, 'kit-medieval/LAYOUT.json must have 0 anim rows');
    }
  }
});

test('API.md contract lines 3-8 are verbatim', () => {
  const expectedLines3to8 = [
    "buildKit({ base, kit } | { folder }, plus: params | keep: [part keys you will move, hide or pick up; the rest is merged into a few draw calls] | only | skip | people | night | loose | setting | terrainParams (the ground's own knobs) | city: { seed, blocks: [x, z] }) -> place. `setting: true` builds the SETTING only: the kit's terrain, twice its composed span, with its vegetation and rock scattered over it and a plain to the horizon, no composed placements: ground to stand your own creatures and buildings in. `city` (street kits) lays a NEW, bigger town from the kit's own buildings instead of its composed layout: drawn streets with crossings, pavements, parks, parked cars, people who walk, a boundary of facades ([4, 3] is about 170 x 100 m); place.city then has streets { x, z } centre lines, junctions and lots [{ key, x, z, facing, door: [x, z] }].",
    "place: group | bounds | of(key) objects | where(key) positions | openSpot({ near }) a clear point to start at | spots(n, { from, road }) n clear, reachable, spread-out points to put things at | blocked(x, z, radius) the part a body there would touch, or null (convex outlines: use it for collision) | boxes() [{ key, box, low, hull }] the same data raw | surfaceAt(x, z) the ground tile under a point (road or pavement) | groundAt(x, z) | vista() { position, target } framing the whole place | surround() the kit's trees and rocks past its edge | night(0..1) | light(object, key) lights something you built yourself | loose [{ key, position, quaternion, radius, mass, apply() }] small props you may move (loose: true) | people[].anim | tick(seconds) each frame | city.",
    "stage(renderer, scene, { time }) -> look: shadows(root) | ground(place) | follow(object) | update() each frame | setTime('noon'|'day'|'golden'|'dusk'|'night'|'moonlit'|'dawn'|'overcast'|'space' or 0..1 day to night; YOUR choice: after dusk the place's windows, signs and lamps come on by themselves).",
    'animate(humanoid) -> anim: play(name) | locomotion(metresPerSecond) picks Idle/Walk/Run | update(delta).',
    "A PART'S OPTIONS (knobs, colourways, colour zones, rig nodes) are one line each in PARTS.json in the zip: grep its key rather than reading its .mjs.",
    'In the zip, kit.mjs, stage.mjs and clips.mjs open with these signatures in full: nothing in _internal/ needs reading. The game is yours.',
  ];
  for (const kit of KITS) {
    const lines = readKitFile(kit, 'API.md').trim().split('\n');
    assert.deepEqual(lines.slice(2, 8), expectedLines3to8, `${kit}/API.md lines 3-8`);
  }
});

test('top-level infra wrappers are identical across kits with API headers and _internal re-exports', () => {
  for (const name of ['kit', 'clips', 'merge', 'stage']) {
    const camp = readKitFile('kit-campground', `${name}.mjs`);
    const med = readKitFile('kit-medieval', `${name}.mjs`);
    assert.equal(camp, med, `${name}.mjs must be byte-identical across kits`);
    assert.ok(
      camp.startsWith(`// Polyfork ${name}.mjs. THIS FILE IS THE API. The implementation is ./_internal/${name}.mjs`),
      `${name}.mjs must start with the API header`
    );
    assert.ok(
      camp.includes(`export * from './_internal/${name}.mjs';`),
      `${name}.mjs must re-export * from ./_internal/${name}.mjs`
    );
    if (name === 'merge') {
      assert.equal(
        camp.includes('export { default }'),
        false,
        'merge.mjs must not have a default re-export'
      );
    } else {
      assert.ok(
        camp.includes(`export { default } from './_internal/${name}.mjs';`),
        `${name}.mjs must re-export default from ./_internal/${name}.mjs`
      );
    }
  }
});

test('terrain.mjs SEASONS asymmetry and season-knob counts match', () => {
  for (const kit of KITS) {
    const src = readKitFile(kit, 'terrain.mjs');
    assert.ok(src.includes('export const params'), `${kit}/terrain.mjs must export params`);
    assert.ok(src.includes('const ZONES'), `${kit}/terrain.mjs must define ZONES`);
    assert.ok(src.includes('const COLORWAYS'), `${kit}/terrain.mjs must define COLORWAYS`);
    assert.equal(
      src.includes('const SEASONS'),
      kit === 'kit-campground',
      `${kit}/terrain.mjs SEASONS presence`
    );
  }

  const medParts = JSON.parse(readKitFile('kit-medieval', 'PARTS.json'));
  const medSeasonParts = Object.entries(medParts)
    .filter(([, entry]) => entry.knobs && 'season' in entry.knobs)
    .map(([key, entry]) => [key, entry.knobs.season]);
  assert.deepEqual(
    medSeasonParts,
    [['orchard-tree', 'bare|blossom|summer|fruiting (summer)']],
    'kit-medieval must have only orchard-tree with a season knob'
  );

  const campParts = JSON.parse(readKitFile('kit-campground', 'PARTS.json'));
  const campKeys = Object.keys(campParts);
  assert.equal(campKeys.length, 62, 'kit-campground must have 62 parts');
  const dist = {};
  for (const key of campKeys) {
    const spec = campParts[key].knobs && campParts[key].knobs.season;
    assert.ok(spec, `kit-campground/${key} must have a season knob`);
    const m = String(spec).match(/^(.*) \(([^)]*)\)$/);
    assert.ok(m, `kit-campground/${key} season knob must match '<enum> (<default>)'`);
    assert.equal(m[1], 'spring|summer|autumn|winter', `kit-campground/${key} season enum`);
    dist[m[2]] = (dist[m[2]] || 0) + 1;
  }
  assert.deepEqual(dist, { summer: 59, autumn: 2, spring: 1 }, 'kit-campground season default distribution');
});

test('KIT.md "## What is in this folder" opening paragraph is identical across kits and the buildKit snippet placement counts match LAYOUT.json', () => {
  const sections = {};
  for (const kit of KITS) {
    const kitMd = readKitFile(kit, 'KIT.md');
    sections[kit] = kitMd.split('## What is in this folder\n')[1].split('\n## ')[0];
  }

  const opening = [
    '',
    'Every part twice: `<part>.glb` for any engine, `<part>.mjs` as a drop-in three.js',
    'module with its options. `scene.glb` is the composed kit scene, the whole thing',
  ];
  for (const kit of KITS) {
    assert.deepEqual(
      sections[kit].split('\n').slice(0, 3),
      opening,
      `${kit}/KIT.md "## What is in this folder" opening paragraph`
    );
    assert.ok(sections[kit].includes('`scene.glb` is the composed kit scene'), `${kit}/KIT.md folder section must mention scene.glb`);
  }

  const expectedPlacements = { 'kit-campground': 174, 'kit-medieval': 559 };
  for (const kit of KITS) {
    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    assert.equal(layoutJson.length, expectedPlacements[kit], `${kit}/LAYOUT.json row count`);
    assert.ok(
      sections[kit].includes(`all ${expectedPlacements[kit]} placements`),
      `${kit}/KIT.md buildKit snippet must state 'all ${expectedPlacements[kit]} placements'`
    );
  }
});

test('kit.json classes distribution matches PARTS.json part counts', () => {
  const expected = {
    'kit-campground': { building: 5, prop: 45, character: 5, vehicle: 6, terrain: 1 },
    'kit-medieval': { prop: 31, building: 18, vehicle: 4, animal: 2, character: 4, terrain: 1 },
  };
  for (const kit of KITS) {
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const dist = {};
    for (const value of Object.values(kitJson.classes)) {
      dist[value] = (dist[value] || 0) + 1;
    }
    assert.deepEqual(dist, expected[kit], `${kit}/kit.json classes distribution`);
    assert.equal(
      Object.values(dist).reduce((a, b) => a + b, 0),
      Object.keys(partsJson).length,
      `${kit}/kit.json classes must cover every PARTS.json key`
    );
  }
});

test('PARTS.json knob-name vocabulary counts and seed/wear presence match', () => {
  const expected = {
    'kit-campground': { knobs: 150, seedParts: ['campground-pine-stand', 'lakeside-swing-tree'], wearParts: 61 },
    'kit-medieval': { knobs: 147, seedParts: [], wearParts: 1 },
  };
  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const knobNames = new Set();
    const seedParts = [];
    let wearParts = 0;
    for (const [partKey, entry] of Object.entries(partsJson)) {
      for (const knobName of Object.keys(entry.knobs || {})) {
        knobNames.add(knobName);
        if (knobName === 'seed') seedParts.push(partKey);
        if (knobName === 'wear') wearParts++;
      }
    }
    assert.equal(knobNames.size, expected[kit].knobs, `${kit}/PARTS.json distinct knob-name count`);
    assert.deepEqual(seedParts, expected[kit].seedParts, `${kit}/PARTS.json parts with a seed knob`);
    assert.equal(wearParts, expected[kit].wearParts, `${kit}/PARTS.json parts with a wear knob`);
    assert.ok(knobNames.has('colorway'), `${kit}/PARTS.json knob vocabulary must include colorway`);
    assert.ok(knobNames.has('season'), `${kit}/PARTS.json knob vocabulary must include season`);
  }
});

test('LAYOUT.json ry is present on every row with pinned distinct counts and zero counts', () => {
  const expected = {
    'kit-campground': { rows: 174, distinctRy: 65, ryZero: 29 },
    'kit-medieval': { rows: 559, distinctRy: 515, ryZero: 5 },
  };
  for (const kit of KITS) {
    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    const ryValues = new Set();
    let ryZero = 0;
    for (let i = 0; i < layoutJson.length; i++) {
      assert.equal(typeof layoutJson[i].ry, 'number', `${kit} LAYOUT[${i}].ry must be a number`);
      ryValues.add(layoutJson[i].ry);
      if (layoutJson[i].ry === 0) ryZero++;
    }
    assert.equal(layoutJson.length, expected[kit].rows, `${kit}/LAYOUT.json row count`);
    assert.equal(ryValues.size, expected[kit].distinctRy, `${kit}/LAYOUT.json distinct ry count`);
    assert.equal(ryZero, expected[kit].ryZero, `${kit}/LAYOUT.json rows with ry === 0`);
  }
});

test('terrain.mjs ZONES and COLORWAYS agree, with one colorway per zone set', () => {
  const expectedZones = {
    'kit-campground': ['grass', 'meadow', 'duff', 'soil', 'sand', 'rock', 'camp', 'water', 'ice'],
    'kit-medieval': ['pasture', 'meadow', 'soil', 'stone', 'water'],
  };
  const expectedColorways = {
    'kit-campground': ['summer-weekend', 'golden-evening', 'high-tarn', 'red-clay'],
    'kit-medieval': ['green-shire', 'harvest-gold', 'wet-spring', 'winter-fell'],
  };
  for (const kit of KITS) {
    const terrainSrc = readKitFile(kit, 'terrain.mjs');
    const zonesMatch = terrainSrc.match(/const ZONES = \[([^\]]+)\];/);
    assert.ok(zonesMatch, `${kit}/terrain.mjs must declare const ZONES`);
    const zones = [...zonesMatch[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
    assert.deepEqual(zones, expectedZones[kit], `${kit}/terrain.mjs ZONES`);

    const cwMatch = terrainSrc.match(/const COLORWAYS = \{([\s\S]*?)\n\};/);
    assert.ok(cwMatch, `${kit}/terrain.mjs must declare const COLORWAYS`);
    const colorways = [...cwMatch[1].matchAll(/'([a-z0-9-]+)':\s*\{([^}]*)\}/g)];
    assert.deepEqual(
      colorways.map((m) => m[1]),
      expectedColorways[kit],
      `${kit}/terrain.mjs COLORWAYS names`
    );
    for (const [, name, body] of colorways.map((m) => [m[0], m[1], m[2]])) {
      const keys = [...body.matchAll(/([a-zA-Z]+): '#[0-9a-fA-F]{6}'/g)].map((m) => m[1]);
      assert.deepEqual(keys, zones, `${kit}/terrain.mjs COLORWAYS '${name}' keys must equal ZONES`);
      for (const hex of [...body.matchAll(/#([0-9a-fA-F]{6})/g)].map((m) => m[0])) {
        assert.match(hex, /^#[0-9a-fA-F]{6}$/, `${kit}/terrain.mjs COLORWAYS '${name}' value '${hex}' must be 6-digit hex`);
      }
    }
  }
});

test('CREDITS.txt asset ids are unique 6-hex suffixes, one per PARTS.json key', () => {
  const expectedCounts = { 'kit-campground': 62, 'kit-medieval': 60 };
  for (const kit of KITS) {
    const credits = readKitFile(kit, 'CREDITS.txt');
    const ids = [...credits.matchAll(/polyfork\.dev\/asset\/[a-z0-9-]+-([0-9a-f]{6})\)/g)].map((m) => m[1]);
    assert.equal(ids.length, expectedCounts[kit], `${kit}/CREDITS.txt asset-id count`);
    assert.equal(new Set(ids).size, ids.length, `${kit}/CREDITS.txt asset ids must be unique`);
    for (const id of ids) {
      assert.match(id, /^[0-9a-f]{6}$/, `${kit}/CREDITS.txt asset id '${id}' must be 6 hex digits`);
    }
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    assert.equal(ids.length, Object.keys(partsJson).length, `${kit}/CREDITS.txt asset ids must number one per PARTS.json key`);
  }
});

test('KIT.md "## Parts" section is the pinned two-paragraph form with the kit page URL', () => {
  for (const kit of KITS) {
    const kitMd = readKitFile(kit, 'KIT.md');
    const kitJson = JSON.parse(readKitFile(kit, 'kit.json'));
    const partsCount = Object.keys(JSON.parse(readKitFile(kit, 'PARTS.json'))).length;
    const body = kitMd.split('## Parts\n')[1].split('\n## ')[0];
    const lines = body.trim().split('\n');
    assert.deepEqual(
      lines,
      [
        `${partsCount} parts. \`PARTS.json\` beside this file lists each one on one line: file, size, knobs with their options and defaults, colour zones, rig nodes, lit zones. \`grep '"<key>"' PARTS.json\` rather than opening its \`.mjs\`.`,
        '',
        'Every part also has its own page with renders and live options:',
        `https://polyfork.dev/kit/${kitJson.kit}`,
      ],
      `${kit}/KIT.md ## Parts section body`
    );
  }
});

test('stage.mjs TIMES gradient and LIGHTING order match the API contract', () => {
  for (const kit of KITS) {
    const stageSrc = readKitFile(kit, '_internal/stage.mjs');
    const timesBlock = stageSrc.match(/const TIMES = \[([\s\S]*?)\n\];/);
    assert.ok(timesBlock, `${kit}/_internal/stage.mjs must declare const TIMES`);
    const pairs = [...timesBlock[1].matchAll(/\{ at: ([\d.]+), name: '([a-z]+)'/g)].map((m) => [m[2], Number(m[1])]);
    assert.deepEqual(
      pairs,
      [['day', 0], ['golden', 0.55], ['dusk', 0.82], ['night', 1]],
      `${kit}/_internal/stage.mjs TIMES name/at pairs`
    );
    assert.ok(
      stageSrc.includes('const NAMED = Object.fromEntries(TIMES.map((t) => [t.name, t.at]));'),
      `${kit}/_internal/stage.mjs must build NAMED from TIMES`
    );

    const lightingMatch = stageSrc.match(/export const LIGHTING = \[([^\]]+)\];/);
    assert.ok(lightingMatch, `${kit}/_internal/stage.mjs must export LIGHTING`);
    const lighting = lightingMatch[1].split(', ').map((s) => s.replace(/^'|'$/g, ''));
    assert.deepEqual(
      lighting,
      ['noon', 'day', 'golden', 'dusk', 'night', 'dawn', 'overcast', 'moonlit', 'space'],
      `${kit}/_internal/stage.mjs LIGHTING order`
    );

    const looksMatch = stageSrc.match(/const LOOKS = \{([\s\S]*?)\n\};/);
    assert.ok(looksMatch, `${kit}/_internal/stage.mjs must declare const LOOKS`);
    const looksNames = [...looksMatch[1].matchAll(/^  ([a-z]+):/gm)].map((m) => m[1]);
    assert.deepEqual(
      looksNames,
      ['dawn', 'noon', 'overcast', 'moonlit', 'space'],
      `${kit}/_internal/stage.mjs LOOKS preset names`
    );
  }
});

test('PARTS.json color-zone vocabularies: counts, 47-zone overlap, and terrain zones present', () => {
  const expectedCounts = { 'kit-campground': 223, 'kit-medieval': 169 };
  const expectedOverlap = ['bark', 'blossom', 'board', 'boards', 'boot', 'brass', 'char', 'coat', 'cream', 'cut', 'denim', 'door', 'edge', 'flame', 'frame', 'glass', 'hair', 'handle', 'hatBand', 'heartwood', 'hose', 'interior', 'iron', 'leaf', 'meadow', 'mortar', 'mouth', 'plank', 'plate', 'post', 'rail', 'rope', 'shirt', 'skin', 'skirt', 'slate', 'soil', 'sole', 'soot', 'steel', 'stone', 'strap', 'straw', 'tail', 'timber', 'water', 'wood'];
  const zoneSets = {};
  for (const kit of KITS) {
    const partsJson = JSON.parse(readKitFile(kit, 'PARTS.json'));
    const zones = new Set();
    for (const entry of Object.values(partsJson)) {
      for (const zone of entry.colors || []) zones.add(zone);
    }
    zoneSets[kit] = zones;
    assert.equal(zones.size, expectedCounts[kit], `${kit}/PARTS.json distinct color-zone count`);
  }
  const overlap = [...zoneSets['kit-campground']].filter((z) => zoneSets['kit-medieval'].has(z)).sort();
  assert.deepEqual(overlap, expectedOverlap, 'color-zone overlap across kits');

  const expectedZones = {
    'kit-campground': ['grass', 'meadow', 'duff', 'soil', 'sand', 'rock', 'camp', 'water', 'ice'],
    'kit-medieval': ['pasture', 'meadow', 'soil', 'stone', 'water'],
  };
  for (const kit of KITS) {
    for (const zone of expectedZones[kit]) {
      assert.ok(zoneSets[kit].has(zone), `${kit}/PARTS.json color zones must include terrain zone '${zone}'`);
    }
  }
});

test('LAYOUT.json y values: distinct counts and non-zero row counts match', () => {
  const expected = {
    'kit-campground': { distinctY: 93, nonZero: 154, zero: 20 },
    'kit-medieval': { distinctY: 65, nonZero: 554, zero: 5 },
  };
  for (const kit of KITS) {
    const layoutJson = JSON.parse(readKitFile(kit, 'LAYOUT.json'));
    const yValues = new Set();
    let nonZero = 0;
    let zero = 0;
    for (const row of layoutJson) {
      yValues.add(row.y);
      if (row.y === 0) zero++;
      else nonZero++;
    }
    assert.equal(yValues.size, expected[kit].distinctY, `${kit}/LAYOUT.json distinct y count`);
    assert.equal(nonZero, expected[kit].nonZero, `${kit}/LAYOUT.json rows with y !== 0`);
    assert.equal(zero, expected[kit].zero, `${kit}/LAYOUT.json rows with y === 0`);
  }
});
