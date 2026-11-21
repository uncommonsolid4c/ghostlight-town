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
