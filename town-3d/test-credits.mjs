import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROP_PLACEMENTS } from './town.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDITS_PATH = path.join(__dirname, 'CREDITS.md');
const README_PATH = path.join(__dirname, 'README.md');
const MODELS_DIR = path.join(__dirname, 'models');
const LOCAL_ONLY_GLB = new Set(['pine.glb']);

const MIN_GLB_BYTES = 1024;
const MAX_GLB_BYTES = 1024 * 1024;

const EXPECTED_TUPLES = [
  ['Post Lantern', 'models/post-lantern.glb', 'Kay Lousberg', 'ZSQ65S4lEu'],
  ['Lantern', 'models/lantern.glb', 'Kay Lousberg', 'CtHBJ1ufeW'],
  ['Bench', 'models/bench.glb', 'Kay Lousberg', '6d92UYCIC1'],
  ['Street Light', 'models/street-light.glb', 'Quaternius', 'nFwrlcLvM5'],
  ['Bookshelf', 'models/bookshelf.glb', 'CreativeTrio', '30Iealxb0p'],
  ['Lamp', 'models/oil-lamp.glb', 'Quaternius', 'RsWYHKkDhD'],
  ['Kettle', 'models/teapot.glb', 'MilkAndBanana', 'XggUrd5f03'],
];

const DISPLAY_NAME_TO_KIND = new Map([
  ['Post Lantern', 'post-lantern'],
  ['Lantern', 'lantern'],
  ['Bench', 'bench'],
  ['Street Light', 'street-light'],
  ['Bookshelf', 'bookshelf'],
  ['Lamp', 'oil-lamp'],
  ['Kettle', 'teapot'],
]);

function parseCreditedModels(creditsMd) {
  const models = [];
  for (const match of creditsMd.matchAll(/`models\/([^`\s]+\.glb)`/g)) {
    models.push(match[1]);
  }
  return models;
}

function parseCreditEntries(creditsMd) {
  const headerRe = /^- \*\*([^*]+)\*\* \(`models\/([^`\s]+\.glb)`\)/gm;
  const headers = [...creditsMd.matchAll(headerRe)];
  return headers.map((match, idx) => {
    const start = match.index + match[0].length;
    const end = idx + 1 < headers.length ? headers[idx + 1].index : creditsMd.length;
    const body = creditsMd.slice(start, end);
    const field = (re) => body.match(re)?.[1]?.trim() ?? null;
    return {
      displayName: match[1].trim(),
      file: match[2],
      author: field(/^\s*- Author:\s*(.+)$/m),
      id: field(/^\s*- Poly Pizza ID:\s*`([^`\s]+)`$/m),
      page: field(/^\s*- Page:\s*(\S+)$/m),
      licence: field(/^\s*- Licence:\s*(.+)$/m),
    };
  });
}

test('CREDITS.md entries match valid glTF v2 GLBs, committed models, and PROP_PLACEMENTS', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);
  assert.ok(creditedFiles.length > 0, 'CREDITS.md must list at least one models/*.glb entry');

  const uniqueCredited = new Set(creditedFiles);
  assert.equal(uniqueCredited.size, creditedFiles.length, 'CREDITS.md must not duplicate model entries');

  // 1. Every credited .glb exists under town-3d/models/ and parses as glTF v2.
  for (const file of creditedFiles) {
    const filePath = path.join(MODELS_DIR, file);
    const buf = await fs.readFile(filePath);
    assert.ok(buf.length >= 12, `${file} must be at least 12 bytes for a GLB header`);
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'glTF', `${file} must start with glTF magic bytes`);
    assert.equal(buf.readUInt32LE(4), 2, `${file} must be glTF version 2`);
    assert.equal(buf.readUInt32LE(8), buf.length, `${file} GLB header length must match file size`);
  }

  // 2. Every committed .glb in town-3d/models/ is credited (pine.glb is local-only and excluded).
  const diskEntries = await fs.readdir(MODELS_DIR);
  const diskGlbs = diskEntries.filter((name) => name.endsWith('.glb'));
  for (const excluded of LOCAL_ONLY_GLB) {
    assert.ok(!uniqueCredited.has(excluded), `${excluded} is local-only and must NOT be credited in CREDITS.md`);
  }
  for (const file of diskGlbs) {
    if (LOCAL_ONLY_GLB.has(file)) continue;
    assert.ok(uniqueCredited.has(file), `${file} in town-3d/models/ must be credited in CREDITS.md`);
  }

  // 3. Every credited model appears in town-3d/town.js PROP_PLACEMENTS.
  const placedModels = new Set(
    PROP_PLACEMENTS.map((p) => p.model).filter((m) => typeof m === 'string' && m.length > 0)
  );
  for (const file of creditedFiles) {
    const relPath = `models/${file}`;
    assert.ok(placedModels.has(relPath), `${relPath} credited in CREDITS.md must appear in PROP_PLACEMENTS`);
  }
});

test('CREDITS.md has 7 structured entries with Author, Poly Pizza ID, matching Page, and CC0 1.0 Licence', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);
  assert.equal(creditedFiles.length, 7, 'CREDITS.md must list exactly 7 models/*.glb entries');

  const entries = parseCreditEntries(creditsMd);
  assert.equal(entries.length, 7, 'CREDITS.md must have exactly 7 structured entry headings');

  for (const entry of entries) {
    assert.ok(entry.author, `${entry.displayName} must have an Author line`);
    assert.ok(entry.id, `${entry.displayName} must have a Poly Pizza ID line`);
    assert.ok(entry.page, `${entry.displayName} must have a Page line`);
    assert.ok(entry.licence, `${entry.displayName} must have a Licence line`);
    assert.equal(
      entry.page,
      `https://poly.pizza/m/${entry.id}`,
      `${entry.displayName} Page must match its Poly Pizza ID`
    );
    assert.equal(entry.licence, 'CC0 1.0', `${entry.displayName} must be CC0 1.0`);
  }
});

test('CREDITS.md author and Poly Pizza ID tuples match pinned records', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const entries = parseCreditEntries(creditsMd);
  const actualTuples = entries.map((e) => [e.displayName, `models/${e.file}`, e.author, e.id]);
  assert.deepEqual(actualTuples, EXPECTED_TUPLES);
});

test('every placed PROP_PLACEMENTS model is credited in CREDITS.md (model-less placements exempt)', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedPaths = new Set(parseCreditedModels(creditsMd).map((file) => `models/${file}`));

  const modelLessPlacements = PROP_PLACEMENTS.filter((p) => !('model' in p) || p.model == null);
  assert.ok(
    modelLessPlacements.length >= 1,
    'expected at least one model-less procedural placement (e.g. maren_typewriter) to pin exemption'
  );

  for (const placement of PROP_PLACEMENTS) {
    if (typeof placement.model === 'string') {
      assert.ok(
        creditedPaths.has(placement.model),
        `placed model ${placement.model} (${placement.id}) must be credited in CREDITS.md`
      );
    }
  }
});

test('CREDITS.md preamble claims match repo architecture and licensing', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const firstEntryIdx = creditsMd.search(/^- \*\*/m);
  assert.ok(firstEntryIdx > 0, 'CREDITS.md must have a preamble before the first entry');
  const preamble = creditsMd.slice(0, firstEntryIdx);

  assert.match(preamble, /architectural core/i);
  assert.match(
    preamble,
    /bandstand[\s\S]*gate[\s\S]*newsstand[\s\S]*cottages[\s\S]*Milo's ghost[\s\S]*perimeter scenery/i
  );
  assert.match(preamble, /procedural Three\.js geometry/i);
  assert.match(preamble, /CC0 1\.0[\s\S]*set dressing[\s\S]*town-3d\/models\//i);
  assert.match(preamble, /CC0 1\.0 requires no attribution/i);
  assert.match(preamble, /credit the creator/i);
});

test('credited GLB files are between 1 KB and 1 MB inclusive', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);
  for (const file of creditedFiles) {
    const stat = await fs.stat(path.join(MODELS_DIR, file));
    assert.ok(
      stat.size >= MIN_GLB_BYTES && stat.size <= MAX_GLB_BYTES,
      `${file} size ${stat.size} bytes must be between ${MIN_GLB_BYTES} and ${MAX_GLB_BYTES}`
    );
  }
});

test('credited GLB JSON chunks parse as glTF 2.0 with meshes, nodes, and matching BIN chunk', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);

  for (const file of creditedFiles) {
    const buf = await fs.readFile(path.join(MODELS_DIR, file));
    assert.ok(buf.length >= 20, `${file} must be large enough to hold GLB header and chunk 0 header`);

    const jsonLen = buf.readUInt32LE(12);
    const chunk0Type = buf.subarray(16, 20).toString('ascii');
    assert.equal(chunk0Type, 'JSON', `${file} chunk 0 type must be JSON`);

    const jsonEnd = 20 + jsonLen;
    assert.ok(jsonEnd + 8 <= buf.length, `${file} must have a second chunk header after JSON chunk`);

    const gltf = JSON.parse(buf.subarray(20, jsonEnd).toString('utf8'));
    assert.equal(gltf.asset?.version, '2.0', `${file} glTF asset.version must be 2.0`);
    assert.ok(Array.isArray(gltf.meshes) && gltf.meshes.length > 0, `${file} must have a non-empty meshes array`);
    assert.ok(Array.isArray(gltf.nodes) && gltf.nodes.length >= 2, `${file} must have at least 2 nodes`);

    const binLen = buf.readUInt32LE(jsonEnd);
    const chunk1Type = buf.subarray(jsonEnd + 4, jsonEnd + 8).toString('ascii');
    assert.equal(chunk1Type, 'BIN\0', `${file} chunk 1 type must be BIN`);
    assert.equal(
      12 + 8 + jsonLen + 8 + binLen,
      buf.length,
      `${file} header + JSON + BIN chunk lengths must equal file size`
    );
  }
});

test('PROP_PLACEMENTS counts per credited model are pinned (total 8)', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);

  const counts = new Map();
  let totalModelPlacements = 0;
  for (const placement of PROP_PLACEMENTS) {
    if (typeof placement.model === 'string') {
      totalModelPlacements += 1;
      counts.set(placement.model, (counts.get(placement.model) ?? 0) + 1);
    }
  }

  assert.equal(totalModelPlacements, 8, 'total model placements in PROP_PLACEMENTS must be 8');
  for (const file of creditedFiles) {
    const relPath = `models/${file}`;
    const expectedCount = relPath === 'models/post-lantern.glb' ? 2 : 1;
    assert.equal(
      counts.get(relPath),
      expectedCount,
      `${relPath} must appear ${expectedCount} time(s) in PROP_PLACEMENTS`
    );
  }
});

test('model placement geometry in PROP_PLACEMENTS is within clearing bounds and valid', () => {
  const modelPlacements = PROP_PLACEMENTS.filter((p) => typeof p.model === 'string');
  assert.ok(modelPlacements.length > 0, 'expected at least one model placement');

  for (const placement of modelPlacements) {
    assert.ok(
      Number.isFinite(placement.x) && Math.abs(placement.x) <= 30,
      `${placement.id} x (${placement.x}) must be finite and within [-30, 30]`
    );
    assert.ok(
      Number.isFinite(placement.z) && Math.abs(placement.z) <= 30,
      `${placement.id} z (${placement.z}) must be finite and within [-30, 30]`
    );
    assert.ok(
      Number.isFinite(placement.targetSize) && placement.targetSize > 0 && placement.targetSize <= 3.0,
      `${placement.id} targetSize (${placement.targetSize}) must be finite and in (0, 3.0]`
    );
    assert.ok(
      placement.scaleAxis === 'y' || placement.scaleAxis === 'length',
      `${placement.id} scaleAxis (${placement.scaleAxis}) must be 'y' or 'length'`
    );
    assert.ok(
      placement.parent === 'scene' || placement.parent === 'newsstand',
      `${placement.id} parent (${placement.parent}) must be 'scene' or 'newsstand'`
    );
  }
});

test('each credited display name maps to exactly one PROP_PLACEMENTS kind', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const entries = parseCreditEntries(creditsMd);
  assert.equal(entries.length, DISPLAY_NAME_TO_KIND.size, 'credited entries count must match kind map');

  const modelPlacements = PROP_PLACEMENTS.filter((p) => typeof p.model === 'string');
  const actualKinds = new Set(modelPlacements.map((p) => p.kind));
  const expectedKinds = new Set(DISPLAY_NAME_TO_KIND.values());
  assert.deepEqual(actualKinds, expectedKinds, 'model placement kinds must match the 7 pinned kinds');

  for (const entry of entries) {
    const expectedKind = DISPLAY_NAME_TO_KIND.get(entry.displayName);
    assert.ok(expectedKind, `unexpected display name ${entry.displayName}`);
    const relPath = `models/${entry.file}`;
    const matching = modelPlacements.filter((p) => p.model === relPath);
    assert.ok(matching.length > 0, `${relPath} must have at least one placement`);
    for (const placement of matching) {
      assert.equal(
        placement.kind,
        expectedKind,
        `${entry.displayName} (${relPath}) placement ${placement.id} must have kind ${expectedKind}`
      );
    }
  }
});

test('CREDITS.md has no CC-BY anywhere and has 7 Licence: CC0 1.0 lines', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  assert.ok(!creditsMd.includes('CC-BY'), 'CREDITS.md must not contain CC-BY anywhere');
  const licenceLines = creditsMd.match(/^\s*- Licence: CC0 1\.0$/gm) ?? [];
  assert.equal(licenceLines.length, 7, 'CREDITS.md must have exactly 7 Licence: CC0 1.0 lines');
});

test('CREDITS.md is discoverable from town-3d/README.md and Poly Pizza IDs and URLs are pairwise distinct', async () => {
  const [creditsMd, readmeMd] = await Promise.all([
    fs.readFile(CREDITS_PATH, 'utf8'),
    fs.readFile(README_PATH, 'utf8'),
  ]);

  assert.ok(readmeMd.includes('CREDITS.md'), 'town-3d/README.md must mention CREDITS.md');

  const creditedFiles = parseCreditedModels(creditsMd);
  assert.ok(
    creditedFiles.some((file) => readmeMd.includes(file)),
    'town-3d/README.md must mention at least one credited model filename'
  );

  const entries = parseCreditEntries(creditsMd);
  const ids = entries.map((e) => e.id);
  const pages = entries.map((e) => e.page);
  assert.equal(new Set(ids).size, entries.length, 'credited Poly Pizza IDs must be pairwise distinct');
  assert.equal(new Set(pages).size, entries.length, 'credited Page URLs must be pairwise distinct');
});


test('PROP_PLACEMENTS pins exact coordinates, rotY, targetSize, and scaleAxis for all 8 model placements', () => {
  const expected = {
    gate_lantern_left: { x: -3.2, y: 0, z: 26.2, rotY: 0, targetSize: 2.2, scaleAxis: 'y' },
    gate_lantern_right: { x: 3.2, y: 0, z: 26.2, rotY: 0, targetSize: 2.2, scaleAxis: 'y' },
    bandstand_bench: {
      x: -6.2,
      y: 0,
      z: 5.5,
      rotY: +Math.atan2(6.2, -5.5).toFixed(4),
      targetSize: 1.8,
      scaleAxis: 'length',
    },
    newsstand_lantern: { x: 0.65, y: 1.03, z: 0.78, rotY: 0, targetSize: 0.35, scaleAxis: 'y' },
    newsstand_street_light: { x: 7.8, y: 0, z: 15.2, rotY: 0, targetSize: 3.0, scaleAxis: 'y' },
    newsstand_bookshelf: {
      x: 4.6,
      y: 0,
      z: 15.0,
      rotY: +Math.atan2(-4.6, -15.0).toFixed(4),
      targetSize: 1.6,
      scaleAxis: 'y',
    },
    wick_oil_lamp: { x: 14.41, y: 0, z: -6.05, rotY: -1.1733, targetSize: 0.9, scaleAxis: 'y' },
    tomas_teapot: { x: 2.06, y: 0, z: -15.49, rotY: -0.1322, targetSize: 0.9, scaleAxis: 'y' },
  };

  const modelPlacements = PROP_PLACEMENTS.filter((p) => typeof p.model === 'string');
  assert.deepEqual(
    new Set(modelPlacements.map((p) => p.id)),
    new Set(Object.keys(expected)),
    'model placement ids must match the 8 pinned placements'
  );

  for (const [id, exp] of Object.entries(expected)) {
    const placement = modelPlacements.find((p) => p.id === id);
    assert.ok(placement, `missing placement ${id}`);
    assert.equal(placement.x, exp.x, `${id} x mismatch`);
    assert.equal(placement.y, exp.y, `${id} y mismatch`);
    assert.equal(placement.z, exp.z, `${id} z mismatch`);
    assert.equal(placement.rotY, exp.rotY, `${id} rotY mismatch`);
    assert.equal(placement.targetSize, exp.targetSize, `${id} targetSize mismatch`);
    assert.equal(placement.scaleAxis, exp.scaleAxis, `${id} scaleAxis mismatch`);
  }
});

test('credited GLBs are self-contained with no external URI in buffers or images', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);
  const expectedImageCounts = new Map([
    ['post-lantern.glb', 1],
    ['lantern.glb', 1],
    ['bench.glb', 1],
    ['street-light.glb', 0],
    ['bookshelf.glb', 1],
    ['oil-lamp.glb', 0],
    ['teapot.glb', 1],
  ]);

  for (const file of creditedFiles) {
    const buf = await fs.readFile(path.join(MODELS_DIR, file));
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

    assert.ok(Array.isArray(gltf.buffers) && gltf.buffers.length === 1, `${file} must have exactly 1 buffer`);
    for (const buffer of gltf.buffers) {
      assert.equal('uri' in buffer, false, `${file} buffer must not have a uri property`);
    }

    const images = gltf.images ?? [];
    assert.equal(images.length, expectedImageCounts.get(file), `${file} image count mismatch`);
    for (const image of images) {
      assert.equal('uri' in image, false, `${file} image must not have a uri property`);
    }
  }
});

test('town.js procedural fallback dispatch covers all 7 credited kinds', async () => {
  const townJs = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');
  const kinds = ['post-lantern', 'lantern', 'bench', 'street-light', 'bookshelf', 'oil-lamp', 'teapot'];
  for (const kind of kinds) {
    assert.ok(
      townJs.includes(`kind === '${kind}'`),
      `town.js buildProceduralProp must dispatch kind === '${kind}'`
    );
  }
});

test('CREDITS.md entry order equals the pinned EXPECTED_TUPLES order', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const entries = parseCreditEntries(creditsMd);
  assert.deepEqual(
    entries.map((e) => e.displayName),
    EXPECTED_TUPLES.map(([name]) => name)
  );
});

test('town-3d/README.md names all 7 credited model filenames and disk holds exactly 8 GLBs', async () => {
  const [creditsMd, readmeMd, diskEntries] = await Promise.all([
    fs.readFile(CREDITS_PATH, 'utf8'),
    fs.readFile(README_PATH, 'utf8'),
    fs.readdir(MODELS_DIR),
  ]);

  const creditedFiles = parseCreditedModels(creditsMd);
  for (const file of creditedFiles) {
    assert.ok(readmeMd.includes(file), `town-3d/README.md must mention ${file}`);
  }

  const diskGlbs = diskEntries.filter((name) => name.endsWith('.glb')).sort();
  const expectedGlbs = [...creditedFiles, 'pine.glb'].sort();
  assert.equal(diskGlbs.length, 8, 'town-3d/models/ must hold exactly 8 .glb files');
  assert.deepEqual(diskGlbs, expectedGlbs);
});

test('PROP_PLACEMENTS rotation/height bounds and CREDITS.md title pin', async () => {
  for (const placement of PROP_PLACEMENTS) {
    if (typeof placement.rotY === 'number') {
      assert.ok(
        placement.rotY >= -Math.PI && placement.rotY <= Math.PI,
        `${placement.id} rotY (${placement.rotY}) must be in [-Math.PI, Math.PI]`
      );
    }
    if (typeof placement.y === 'number') {
      assert.ok(placement.y >= 0, `${placement.id} y (${placement.y}) must be >= 0`);
    }
  }

  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const firstLine = creditsMd.split(/\r?\n/, 1)[0];
  assert.equal(firstLine, '# 3D Model Credits (`town-3d`)');
});

test('credited GLB mesh/primitive/accessor/material counts and generator are pinned', async () => {
  const expected = new Map([
    ['post-lantern.glb', { meshes: 2, primitives: 2, nodes: 3, accessors: 8, bufferViews: 9, materials: 1, generator: 'FBX2glTF v0.9.7', scenes: 1, hasTexcoord: true }],
    ['lantern.glb', { meshes: 1, primitives: 1, nodes: 2, accessors: 4, bufferViews: 5, materials: 1, generator: 'FBX2glTF v0.9.7', scenes: 1, hasTexcoord: true }],
    ['bench.glb', { meshes: 1, primitives: 1, nodes: 2, accessors: 4, bufferViews: 5, materials: 1, generator: 'FBX2glTF v0.9.7', scenes: 1, hasTexcoord: true }],
    ['street-light.glb', { meshes: 1, primitives: 2, nodes: 2, accessors: 6, bufferViews: 6, materials: 2, generator: 'FBX2glTF v0.9.7', scenes: 1, hasTexcoord: false }],
    ['bookshelf.glb', { meshes: 1, primitives: 1, nodes: 2, accessors: 4, bufferViews: 5, materials: 1, generator: 'FBX2glTF v0.9.7', scenes: 1, hasTexcoord: true }],
    ['oil-lamp.glb', { meshes: 1, primitives: 2, nodes: 2, accessors: 6, bufferViews: 6, materials: 2, generator: 'FBX2glTF v0.9.7', scenes: 1, hasTexcoord: false }],
    ['teapot.glb', { meshes: 3, primitives: 3, nodes: 3, accessors: 12, bufferViews: 5, materials: 1, generator: 'obj2gltf', scenes: 1, hasTexcoord: true }],
  ]);

  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);
  assert.equal(creditedFiles.length, expected.size);

  for (const file of creditedFiles) {
    const exp = expected.get(file);
    assert.ok(exp, `missing expected entry for ${file}`);
    const buf = await fs.readFile(path.join(MODELS_DIR, file));
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

    const primCount = gltf.meshes.reduce((sum, m) => sum + m.primitives.length, 0);
    assert.equal(gltf.meshes.length, exp.meshes, `${file} meshes count`);
    assert.equal(primCount, exp.primitives, `${file} primitives count`);
    assert.equal(gltf.nodes.length, exp.nodes, `${file} nodes count`);
    assert.equal(gltf.accessors.length, exp.accessors, `${file} accessors count`);
    assert.equal(gltf.bufferViews.length, exp.bufferViews, `${file} bufferViews count`);
    assert.equal((gltf.materials ?? []).length, exp.materials, `${file} materials count`);
    assert.equal(gltf.asset?.generator, exp.generator, `${file} asset.generator`);
    assert.equal((gltf.scenes ?? []).length, exp.scenes, `${file} scenes.length`);

    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        assert.equal(typeof prim.attributes?.POSITION, 'number', `${file} primitive missing POSITION`);
        assert.equal(typeof prim.attributes?.NORMAL, 'number', `${file} primitive missing NORMAL`);
        if (exp.hasTexcoord) {
          assert.equal(typeof prim.attributes?.TEXCOORD_0, 'number', `${file} primitive missing TEXCOORD_0`);
        } else {
          assert.equal('TEXCOORD_0' in (prim.attributes ?? {}), false, `${file} primitive should not have TEXCOORD_0`);
        }
      }
    }
  }
});

test('credited GLB internal indices are all in range', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);

  for (const file of creditedFiles) {
    const buf = await fs.readFile(path.join(MODELS_DIR, file));
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

    const accLen = gltf.accessors.length;
    const bvLen = gltf.bufferViews.length;
    const matLen = (gltf.materials ?? []).length;
    const meshLen = gltf.meshes.length;
    const nodeLen = gltf.nodes.length;

    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        for (const [attr, idx] of Object.entries(prim.attributes ?? {})) {
          assert.ok(Number.isInteger(idx) && idx >= 0 && idx < accLen, `${file} ${attr} index ${idx} out of range`);
        }
        if (prim.indices !== undefined) {
          assert.ok(
            Number.isInteger(prim.indices) && prim.indices >= 0 && prim.indices < accLen,
            `${file} indices ${prim.indices} out of range`
          );
        }
        if (prim.material !== undefined) {
          assert.ok(
            Number.isInteger(prim.material) && prim.material >= 0 && prim.material < matLen,
            `${file} material ${prim.material} out of range`
          );
        }
      }
    }

    for (const acc of gltf.accessors) {
      assert.ok(
        Number.isInteger(acc.bufferView) && acc.bufferView >= 0 && acc.bufferView < bvLen,
        `${file} accessor bufferView ${acc.bufferView} out of range`
      );
    }

    for (const node of gltf.nodes) {
      if (node.mesh !== undefined) {
        assert.ok(
          Number.isInteger(node.mesh) && node.mesh >= 0 && node.mesh < meshLen,
          `${file} node mesh ${node.mesh} out of range`
        );
      }
      for (const child of node.children ?? []) {
        assert.ok(
          Number.isInteger(child) && child >= 0 && child < nodeLen,
          `${file} node child ${child} out of range`
        );
      }
    }
  }
});

test('credited GLB POSITION accessor min/max are finite, ordered, and span under 10 m', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);

  for (const file of creditedFiles) {
    const buf = await fs.readFile(path.join(MODELS_DIR, file));
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        assert.ok(Array.isArray(acc.min) && acc.min.length === 3, `${file} POSITION min must be length-3 array`);
        assert.ok(Array.isArray(acc.max) && acc.max.length === 3, `${file} POSITION max must be length-3 array`);
        for (let i = 0; i < 3; i += 1) {
          assert.ok(Number.isFinite(acc.min[i]), `${file} min[${i}] must be finite`);
          assert.ok(Number.isFinite(acc.max[i]), `${file} max[${i}] must be finite`);
          assert.ok(acc.min[i] <= acc.max[i], `${file} min[${i}] <= max[${i}]`);
          assert.ok(acc.max[i] - acc.min[i] <= 10, `${file} span[${i}] must be <= 10 m`);
        }
      }
    }
  }
});

test('CREDITS.md entry bodies have exactly 4 fields in Author/ID/Page/Licence order, and the file is clean text', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const entries = parseCreditEntries(creditsMd);
  assert.equal(entries.length, 7);

  const headerRe = /^- \*\*([^*]+)\*\* \(`models\/([^`\s]+\.glb)`\)/gm;
  const headers = [...creditsMd.matchAll(headerRe)];
  assert.equal(headers.length, entries.length);

  const expectedPrefixes = ['- Author:', '- Poly Pizza ID:', '- Page:', '- Licence:'];
  for (let i = 0; i < headers.length; i += 1) {
    const start = headers[i].index + headers[i][0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : creditsMd.length;
    const body = creditsMd.slice(start, end);
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    assert.equal(lines.length, 4, `${entries[i].displayName} must have exactly 4 body lines`);
    for (let j = 0; j < expectedPrefixes.length; j += 1) {
      assert.ok(
        lines[j].startsWith(expectedPrefixes[j]),
        `${entries[i].displayName} line ${j} must start with ${expectedPrefixes[j]}`
      );
    }
  }

  assert.ok(creditsMd.endsWith('\n'), 'CREDITS.md must end with a newline');
  assert.ok(!creditsMd.endsWith('\n\n'), 'CREDITS.md must end with exactly one newline');
  assert.equal(/[ \t]$/m.test(creditsMd), false, 'CREDITS.md must have no trailing whitespace');
  assert.equal(creditsMd.includes('\r'), false, 'CREDITS.md must not contain CR characters');
});

test('Poly Pizza IDs are 10-char alphanumeric and the author distribution is pinned', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const entries = parseCreditEntries(creditsMd);
  assert.equal(entries.length, EXPECTED_TUPLES.length);

  const counts = {};
  for (const entry of entries) {
    assert.match(entry.id, /^[A-Za-z0-9]{10}$/, `${entry.displayName} Poly Pizza ID must be 10-char alphanumeric`);
    assert.match(entry.author, /^[A-Za-z ]+$/, `${entry.displayName} author must be letters/spaces`);
    counts[entry.author] = (counts[entry.author] ?? 0) + 1;
  }

  assert.deepEqual(counts, {
    'Kay Lousberg': 3,
    Quaternius: 2,
    CreativeTrio: 1,
    MilkAndBanana: 1,
  });
});

test('model placement parents ground the props and town-3d/README.md lists the models alphabetically', async () => {
  const modelPlacements = PROP_PLACEMENTS.filter((p) => typeof p.model === 'string');
  for (const p of modelPlacements) {
    assert.equal(typeof p.parent, 'string', `${p.id} must have a string parent`);
  }

  const scenePlacements = modelPlacements.filter((p) => p.parent === 'scene');
  assert.equal(scenePlacements.length, 7, 'expected 7 scene-parented model placements');
  for (const p of scenePlacements) {
    assert.equal(p.y, 0, `${p.id} scene placement must have y === 0`);
  }

  const newsstandPlacements = modelPlacements.filter((p) => p.parent === 'newsstand');
  assert.equal(newsstandPlacements.length, 1, 'expected 1 newsstand-parented model placement');
  assert.equal(newsstandPlacements[0].id, 'newsstand_lantern');
  assert.ok(newsstandPlacements[0].y >= 1.0, 'newsstand_lantern must have y >= 1.0');

  const readmeMd = await fs.readFile(README_PATH, 'utf8');
  const alphabetical = [
    'bench.glb',
    'bookshelf.glb',
    'lantern.glb',
    'oil-lamp.glb',
    'post-lantern.glb',
    'street-light.glb',
    'teapot.glb',
  ];
  let prevIdx = -1;
  for (const name of alphabetical) {
    const idx = readmeMd.indexOf(name);
    assert.ok(idx >= 0, `town-3d/README.md must mention ${name}`);
    assert.ok(idx > prevIdx, `town-3d/README.md must list ${name} in alphabetical order`);
    prevIdx = idx;
  }
});
