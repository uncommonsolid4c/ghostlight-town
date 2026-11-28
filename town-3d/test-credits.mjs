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

const COMPONENT_BYTE_SIZE = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const TYPE_COMPONENT_COUNT = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const EXPECTED_MATERIAL_NAMES = {
  'post-lantern.glb': ['HalloweenBits'],
  'lantern.glb': ['HalloweenBits'],
  'bench.glb': ['citybits_texture'],
  'street-light.glb': ['Grey', 'Light'],
  'bookshelf.glb': ['Material'],
  'oil-lamp.glb': ['White', 'LightMetal'],
  'teapot.glb': ['Solid.151'],
};

const TEXTURED_GLBS = new Set([
  'post-lantern.glb',
  'lantern.glb',
  'bench.glb',
  'bookshelf.glb',
  'teapot.glb',
]);

const UNTEXTURED_GLBS = new Set([
  'street-light.glb',
  'oil-lamp.glb',
]);

async function loadAllCreditedGlbs() {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const files = parseCreditedModels(creditsMd);
  const out = [];
  for (const file of files) {
    const buf = await fs.readFile(path.join(MODELS_DIR, file));
    const jsonLen = buf.readUInt32LE(12);
    const binLen = buf.readUInt32LE(20 + jsonLen);
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    out.push({ file, buf, jsonLen, binLen, gltf });
  }
  return out;
}

test('credited GLBs have 4-byte-aligned chunks and a single default scene 0', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, jsonLen, binLen, gltf } of glbs) {
    assert.equal(jsonLen % 4, 0, `${file} JSON chunk length must be 4-byte aligned`);
    assert.equal(binLen % 4, 0, `${file} BIN chunk length must be 4-byte aligned`);
    assert.equal(gltf.scene, 0, `${file} default scene must be 0`);
    assert.equal(gltf.scenes?.length, 1, `${file} must have exactly 1 scene`);
  }
});

test('credited GLB accessors have expected componentType/type by role and no sparse/normalized', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    for (let i = 0; i < gltf.accessors.length; i += 1) {
      const acc = gltf.accessors[i];
      assert.equal(acc.sparse, undefined, `${file} accessor[${i}] must not be sparse`);
      assert.equal(acc.normalized ?? false, false, `${file} accessor[${i}] must not be normalized`);
    }
    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        const idxAcc = gltf.accessors[prim.indices];
        assert.equal(idxAcc.componentType, 5123, `${file} indices must be UNSIGNED_SHORT (5123)`);
        assert.equal(idxAcc.type, 'SCALAR', `${file} indices must be SCALAR`);

        const posAcc = gltf.accessors[prim.attributes.POSITION];
        assert.equal(posAcc.componentType, 5126, `${file} POSITION must be FLOAT (5126)`);
        assert.equal(posAcc.type, 'VEC3', `${file} POSITION must be VEC3`);

        const normAcc = gltf.accessors[prim.attributes.NORMAL];
        assert.equal(normAcc.componentType, 5126, `${file} NORMAL must be FLOAT (5126)`);
        assert.equal(normAcc.type, 'VEC3', `${file} NORMAL must be VEC3`);

        if (prim.attributes.TEXCOORD_0 !== undefined) {
          const uvAcc = gltf.accessors[prim.attributes.TEXCOORD_0];
          assert.equal(uvAcc.componentType, 5126, `${file} TEXCOORD_0 must be FLOAT (5126)`);
          assert.equal(uvAcc.type, 'VEC2', `${file} TEXCOORD_0 must be VEC2`);
        }
      }
    }
  }
});

test('credited GLB accessors and bufferViews stay within buffer bounds', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    for (let i = 0; i < gltf.accessors.length; i += 1) {
      const acc = gltf.accessors[i];
      const bv = gltf.bufferViews[acc.bufferView];
      const compSize = COMPONENT_BYTE_SIZE[acc.componentType];
      const typeCount = TYPE_COMPONENT_COUNT[acc.type];
      assert.ok(compSize > 0, `${file} accessor[${i}] has valid componentType`);
      assert.ok(typeCount > 0, `${file} accessor[${i}] has valid type`);
      const end = (acc.byteOffset ?? 0) + acc.count * compSize * typeCount;
      assert.ok(
        end <= bv.byteLength,
        `${file} accessor[${i}] end ${end} exceeds bufferView byteLength ${bv.byteLength}`
      );
    }
    for (let i = 0; i < gltf.bufferViews.length; i += 1) {
      const bv = gltf.bufferViews[i];
      const buf = gltf.buffers[bv.buffer];
      const end = (bv.byteOffset ?? 0) + bv.byteLength;
      assert.ok(
        end <= buf.byteLength,
        `${file} bufferView[${i}] end ${end} exceeds buffer byteLength ${buf.byteLength}`
      );
      if (bv.target !== undefined) {
        assert.ok(
          bv.target === 34962 || bv.target === 34963,
          `${file} bufferView[${i}] target must be 34962 or 34963`
        );
      }
      if (bv.byteStride !== undefined) {
        assert.equal(bv.byteStride % 4, 0, `${file} bufferView[${i}] byteStride must be multiple of 4`);
      }
    }
  }
});

test('credited GLB material names and PBR factors are pinned', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    const names = gltf.materials.map((m) => m.name);
    assert.deepEqual(names, EXPECTED_MATERIAL_NAMES[file], `${file} material names must match`);
    for (const mat of gltf.materials) {
      assert.equal(mat.alphaMode, 'OPAQUE', `${file} material ${mat.name} alphaMode must be OPAQUE`);
      const pbr = mat.pbrMetallicRoughness;
      assert.ok(pbr && typeof pbr === 'object', `${file} material ${mat.name} must have pbrMetallicRoughness`);
      assert.ok(
        pbr.metallicFactor >= 0 && pbr.metallicFactor <= 1,
        `${file} material ${mat.name} metallicFactor must be in [0, 1]`
      );
      assert.ok(
        pbr.roughnessFactor >= 0 && pbr.roughnessFactor <= 1,
        `${file} material ${mat.name} roughnessFactor must be in [0, 1]`
      );
      if (pbr.baseColorFactor !== undefined) {
        assert.equal(pbr.baseColorFactor.length, 4, `${file} material ${mat.name} baseColorFactor length 4`);
        for (const c of pbr.baseColorFactor) {
          assert.ok(c >= 0 && c <= 1, `${file} material ${mat.name} baseColorFactor entry in [0, 1]`);
        }
      }
      if (pbr.baseColorTexture !== undefined) {
        assert.ok(
          Number.isInteger(pbr.baseColorTexture.index) &&
            pbr.baseColorTexture.index >= 0 &&
            pbr.baseColorTexture.index < (gltf.textures?.length ?? 0),
          `${file} material ${mat.name} baseColorTexture.index in range`
        );
        assert.equal(
          pbr.baseColorTexture.texCoord ?? 0,
          0,
          `${file} material ${mat.name} baseColorTexture.texCoord must be 0`
        );
      }
    }
  }
});

test('credited GLB texture, sampler, and image cross-references match per-file expectations', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    if (TEXTURED_GLBS.has(file)) {
      assert.equal(gltf.textures?.length, 1, `${file} must have 1 texture`);
      assert.equal(gltf.images?.length, 1, `${file} must have 1 image`);
      assert.equal(gltf.samplers?.length, 1, `${file} must have 1 sampler`);
      const tex = gltf.textures[0];
      assert.ok(
        Number.isInteger(tex.sampler) && tex.sampler >= 0 && tex.sampler < gltf.samplers.length,
        `${file} texture.sampler in range`
      );
      assert.ok(
        Number.isInteger(tex.source) && tex.source >= 0 && tex.source < gltf.images.length,
        `${file} texture.source in range`
      );
      const img = gltf.images[0];
      assert.equal(img.mimeType, 'image/png', `${file} image.mimeType must be image/png`);
      assert.ok(
        Number.isInteger(img.bufferView) && img.bufferView >= 0 && img.bufferView < gltf.bufferViews.length,
        `${file} image.bufferView in range`
      );
      if (file === 'teapot.glb') {
        assert.equal(img.name, 'misc_kettle', 'teapot.glb image.name must be misc_kettle');
        assert.deepEqual(gltf.samplers[0], { wrapS: 10497, wrapT: 10497 }, 'teapot.glb sampler must match');
      } else {
        assert.ok(img.name.endsWith('.png'), `${file} image.name must end with .png`);
      }
    } else {
      assert.ok(UNTEXTURED_GLBS.has(file), `${file} must be classified`);
      assert.equal(gltf.textures, undefined, `${file} must have no textures key`);
      assert.equal(gltf.images, undefined, `${file} must have no images key`);
      assert.equal(gltf.samplers?.length, 1, `${file} must have 1 sampler`);
      assert.deepEqual(gltf.samplers[0], {}, `${file} sampler[0] must be empty object`);
    }
  }
});

test('credited GLB scene and node hierarchy is a reachable TRS-only tree with unique names', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    const scene = gltf.scenes[0];
    if (file === 'teapot.glb') {
      assert.equal('name' in scene, false, 'teapot.glb scene must have no name key');
    } else {
      assert.equal(scene.name, 'Root Scene', `${file} scene name must be Root Scene`);
    }

    const visited = new Set();
    const visit = (idx) => {
      assert.ok(!visited.has(idx), `${file} node[${idx}] visited twice`);
      visited.add(idx);
      const node = gltf.nodes[idx];
      for (const child of node.children ?? []) {
        visit(child);
      }
    };
    for (const rootIdx of scene.nodes) {
      visit(rootIdx);
    }
    assert.equal(visited.size, gltf.nodes.length, `${file} all nodes must be reachable from scenes[0].nodes`);

    const names = new Set();
    for (let i = 0; i < gltf.nodes.length; i += 1) {
      const node = gltf.nodes[i];
      assert.equal('matrix' in node, false, `${file} node[${i}] must not have matrix`);
      assert.equal(typeof node.name, 'string', `${file} node[${i}] must have string name`);
      assert.ok(!names.has(node.name), `${file} duplicate node name ${node.name}`);
      names.add(node.name);
      if (node.mesh !== undefined) {
        assert.ok(node.name.length > 0, `${file} mesh node[${i}] must have non-empty name`);
      }
    }
  }
});

test('credited GLB node transforms are valid unit quaternions, positive scales, and teapot has no TRS', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    for (let i = 0; i < gltf.nodes.length; i += 1) {
      const node = gltf.nodes[i];
      if (file === 'teapot.glb') {
        assert.equal('translation' in node, false, `teapot.glb node[${i}] must have no translation`);
        assert.equal('rotation' in node, false, `teapot.glb node[${i}] must have no rotation`);
        assert.equal('scale' in node, false, `teapot.glb node[${i}] must have no scale`);
      }
      if (node.rotation !== undefined) {
        const len = Math.hypot(...node.rotation);
        assert.ok(Math.abs(len - 1) <= 1e-6, `${file} node[${i}] rotation must be unit quaternion`);
      }
      if (node.scale !== undefined) {
        for (const s of node.scale) {
          assert.ok(s > 0, `${file} node[${i}] scale component must be > 0`);
        }
      }
    }
  }
});

test('every primitive in every credited GLB uses TRIANGLES mode (4)', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        assert.equal(prim.mode, 4, `${file} primitive mode must be 4 (TRIANGLES)`);
      }
    }
  }
});

test('CREDITS.md preamble matches verbatim', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const firstEntryIdx = creditsMd.search(/^- \*\*/m);
  assert.ok(firstEntryIdx > 0, 'CREDITS.md must have a preamble before the first entry');
  const preamble = creditsMd.slice(0, firstEntryIdx);
  const expectedPreamble = [
    '# 3D Model Credits (`town-3d`)',
    '',
    "Ghostlight Town's architectural core (bandstand, gate, newsstand, cottages,",
    "Milo's ghost, and perimeter scenery) is procedural Three.js geometry.",
    'The following CC0 1.0 props are used as set dressing under `town-3d/models/`.',
    'Although CC0 1.0 requires no attribution, we credit the creator here.',
    '',
    '',
  ].join('\n');
  assert.equal(preamble, expectedPreamble);
  assert.equal(preamble.includes('`models/'), false, 'preamble must not mention `models/ directly');
});

test('PROP_PLACEMENTS completeness, unique IDs, valid parents, and model-less exclusion', () => {
  assert.equal(PROP_PLACEMENTS.length, 9, 'PROP_PLACEMENTS must have exactly 9 entries');
  const ids = new Set(PROP_PLACEMENTS.map((p) => p.id));
  assert.equal(ids.size, 9, 'PROP_PLACEMENTS ids must be unique');

  const modelLess = [];
  for (const p of PROP_PLACEMENTS) {
    assert.equal(typeof p.kind, 'string', `${p.id} must have a string kind`);
    assert.ok(p.kind.length > 0, `${p.id} must have a non-empty kind`);
    assert.ok(p.parent === 'scene' || p.parent === 'newsstand', `${p.id} parent must be scene or newsstand`);

    if (!('model' in p)) {
      modelLess.push(p);
      assert.equal('targetSize' in p, false, `${p.id} model-less placement must not have targetSize`);
      assert.equal('scaleAxis' in p, false, `${p.id} model-less placement must not have scaleAxis`);
    } else {
      assert.ok(Number.isFinite(p.targetSize) && p.targetSize > 0, `${p.id} targetSize must be finite > 0`);
      assert.equal(typeof p.scaleAxis, 'string', `${p.id} must have a string scaleAxis`);
      assert.ok(p.scaleAxis.length > 0, `${p.id} must have a non-empty scaleAxis`);
    }
  }

  assert.equal(modelLess.length, 1, 'expected exactly 1 model-less placement');
  assert.equal(modelLess[0].id, 'maren_typewriter');
});


test('credited GLB exact byte sizes and total are pinned', async () => {
  const expectedSizes = new Map([
    ['post-lantern.glb', 44024],
    ['lantern.glb', 29616],
    ['bench.glb', 24816],
    ['street-light.glb', 11056],
    ['bookshelf.glb', 24780],
    ['oil-lamp.glb', 10136],
    ['teapot.glb', 24584],
  ]);

  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);
  assert.equal(creditedFiles.length, expectedSizes.size);

  let totalBytes = 0;
  for (const file of creditedFiles) {
    const stat = await fs.stat(path.join(MODELS_DIR, file));
    assert.equal(stat.size, expectedSizes.get(file), `${file} exact byte size`);
    totalBytes += stat.size;
  }
  assert.equal(totalBytes, 169012, 'total credited GLB byte size');
});

test('credited GLB exact triangle and vertex counts and totals are pinned', async () => {
  const expected = new Map([
    ['post-lantern.glb', { triangles: 568, vertices: 695 }],
    ['lantern.glb', { triangles: 264, vertices: 338 }],
    ['bench.glb', { triangles: 44, vertices: 80 }],
    ['street-light.glb', { triangles: 324, vertices: 265 }],
    ['bookshelf.glb', { triangles: 236, vertices: 454 }],
    ['oil-lamp.glb', { triangles: 276, vertices: 240 }],
    ['teapot.glb', { triangles: 618, vertices: 496 }],
  ]);

  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);

  let totalTriangles = 0;
  let totalVertices = 0;
  for (const { file, gltf } of glbs) {
    let triangles = 0;
    let vertices = 0;
    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        const idxCount = gltf.accessors[prim.indices].count;
        assert.equal(idxCount % 3, 0, `${file} index count must be divisible by 3`);
        triangles += idxCount / 3;
        vertices += gltf.accessors[prim.attributes.POSITION].count;
      }
    }
    const exp = expected.get(file);
    assert.equal(triangles, exp.triangles, `${file} triangle count`);
    assert.equal(vertices, exp.vertices, `${file} vertex count`);
    totalTriangles += triangles;
    totalVertices += vertices;
  }
  assert.equal(totalTriangles, 2330, 'total credited GLB triangles');
  assert.equal(totalVertices, 2568, 'total credited GLB vertices');
});

test('credited GLB exact PBR factors, FBX extras, and baseColorTexture shape are pinned', async () => {
  const expectedPbr = new Map([
    [
      'post-lantern.glb',
      {
        HalloweenBits: {
          metallicFactor: 0.400000005960464,
          roughnessFactor: 1,
          baseColorFactor: [1, 1, 1, 1],
        },
      },
    ],
    [
      'lantern.glb',
      {
        HalloweenBits: {
          metallicFactor: 0.400000005960464,
          roughnessFactor: 1,
          baseColorFactor: [1, 1, 1, 1],
        },
      },
    ],
    [
      'bench.glb',
      {
        citybits_texture: {
          metallicFactor: 0.400000005960464,
          roughnessFactor: 0.229415729641914,
          baseColorFactor: [1, 1, 1, 1],
        },
      },
    ],
    [
      'street-light.glb',
      {
        Grey: {
          metallicFactor: 0.400000005960464,
          roughnessFactor: 0.415087103843689,
          baseColorFactor: [0.219741851091385, 0.229952678084373, 0.281226128339767, 1],
        },
        Light: {
          metallicFactor: 0.400000005960464,
          roughnessFactor: 1,
          baseColorFactor: [0.800000011920929, 0.800000011920929, 0.800000011920929, 1],
        },
      },
    ],
    [
      'bookshelf.glb',
      {
        Material: {
          metallicFactor: 0.400000005960464,
          roughnessFactor: 0.272165536880493,
          baseColorFactor: [1, 1, 1, 1],
        },
      },
    ],
    [
      'oil-lamp.glb',
      {
        White: {
          metallicFactor: 0.400000005960464,
          roughnessFactor: 0.415087103843689,
          baseColorFactor: [0.358380317687988, 0.354632526636124, 0.343526810407639, 1],
        },
        LightMetal: {
          metallicFactor: 0.400000005960464,
          roughnessFactor: 0.415087103843689,
          baseColorFactor: [0.13868173956871, 0.13868173956871, 0.13868173956871, 1],
        },
      },
    ],
    [
      'teapot.glb',
      {
        'Solid.151': {
          metallicFactor: 0,
          roughnessFactor: 0.775,
          baseColorFactor: [1, 1, 1, 1],
        },
      },
    ],
  ]);

  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    const fileExp = expectedPbr.get(file);
    assert.ok(fileExp, `missing expected PBR map for ${file}`);
    for (const mat of gltf.materials) {
      const exp = fileExp[mat.name];
      assert.ok(exp, `unexpected material ${mat.name} in ${file}`);
      const pbr = mat.pbrMetallicRoughness;
      assert.equal(pbr.metallicFactor, exp.metallicFactor, `${file} ${mat.name} metallicFactor`);
      assert.equal(pbr.roughnessFactor, exp.roughnessFactor, `${file} ${mat.name} roughnessFactor`);
      assert.deepEqual(pbr.baseColorFactor, exp.baseColorFactor, `${file} ${mat.name} baseColorFactor`);

      if (file === 'teapot.glb') {
        assert.equal('extras' in mat, false, 'teapot material must have no extras key');
        assert.deepEqual(mat.emissiveFactor, [0, 0, 0], 'teapot emissiveFactor must be [0, 0, 0]');
        assert.equal(mat.doubleSided, false, 'teapot doubleSided must be false');
        assert.deepEqual(pbr.baseColorTexture, { index: 0 }, 'teapot baseColorTexture must be { index: 0 }');
        assert.equal('texCoord' in pbr.baseColorTexture, false, 'teapot baseColorTexture must omit texCoord');
      } else {
        assert.deepEqual(
          mat.extras?.fromFBX,
          { shadingModel: 'Phong', isTruePBR: false },
          `${file} ${mat.name} extras.fromFBX`
        );
        if (TEXTURED_GLBS.has(file)) {
          assert.ok(pbr.baseColorTexture, `${file} ${mat.name} must have baseColorTexture`);
          assert.equal(pbr.baseColorTexture.texCoord, 0, `${file} ${mat.name} baseColorTexture.texCoord must be 0`);
        } else {
          assert.equal(pbr.baseColorTexture, undefined, `${file} ${mat.name} must not have baseColorTexture`);
        }
      }
    }
  }
});

test('credited GLB exact JSON/BIN chunk lengths and buffer byteLength are pinned', async () => {
  const expected = new Map([
    ['post-lantern.glb', { jsonLen: 3252, binLen: 40744 }],
    ['lantern.glb', { jsonLen: 2092, binLen: 27496 }],
    ['bench.glb', { jsonLen: 2076, binLen: 22712 }],
    ['street-light.glb', { jsonLen: 2724, binLen: 8304 }],
    ['bookshelf.glb', { jsonLen: 2080, binLen: 22672 }],
    ['oil-lamp.glb', { jsonLen: 2692, binLen: 7416 }],
    ['teapot.glb', { jsonLen: 4220, binLen: 20336 }],
  ]);

  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);

  for (const { file, buf, jsonLen, binLen, gltf } of glbs) {
    const exp = expected.get(file);
    assert.equal(jsonLen, exp.jsonLen, `${file} jsonLen`);
    assert.equal(binLen, exp.binLen, `${file} binLen`);
    assert.equal(gltf.buffers[0].byteLength, exp.binLen, `${file} buffers[0].byteLength`);
    assert.equal(12 + 8 + jsonLen + 8 + binLen, buf.length, `${file} chunk sum matches file size`);
  }
});

test('credited GLB exact image names, bufferView indices, and untextured absence are pinned', async () => {
  const expectedImages = new Map([
    ['post-lantern.glb', { name: 'halloweenbits_texture.png', bufferView: 0, mimeType: 'image/png' }],
    ['lantern.glb', { name: 'halloweenbits_texture.png', bufferView: 0, mimeType: 'image/png' }],
    ['bench.glb', { name: 'citybits_texture.png', bufferView: 0, mimeType: 'image/png' }],
    ['bookshelf.glb', { name: 'House_Props_Diffuse.png', bufferView: 0, mimeType: 'image/png' }],
    ['teapot.glb', { name: 'misc_kettle', bufferView: 4, mimeType: 'image/png' }],
  ]);

  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    if (expectedImages.has(file)) {
      const exp = expectedImages.get(file);
      assert.equal(gltf.images.length, 1, `${file} must have 1 image`);
      assert.equal(gltf.images[0].name, exp.name, `${file} image.name`);
      assert.equal(gltf.images[0].bufferView, exp.bufferView, `${file} image.bufferView`);
      assert.equal(gltf.images[0].mimeType, exp.mimeType, `${file} image.mimeType`);
    } else {
      assert.ok(UNTEXTURED_GLBS.has(file), `${file} must be untextured`);
      assert.equal('images' in gltf, false, `${file} must not have images key`);
    }
  }
});

test('credited GLB exact node names and scene root indices are pinned', async () => {
  const expectedNodes = new Map([
    ['post-lantern.glb', ['RootNode', 'post_lantern', 'post_lantern_lantern']],
    ['lantern.glb', ['RootNode', 'lantern_standing']],
    ['bench.glb', ['RootNode', 'bench']],
    ['street-light.glb', ['RootNode', 'StreetLight']],
    ['bookshelf.glb', ['RootNode', 'Bookshelf']],
    ['oil-lamp.glb', ['RootNode', 'Light_Floor2']],
    [
      'teapot.glb',
      ['misc_kettle_cover_Cylinder.018', 'misc_kettle_nozzle_Cylinder.019', 'misc_kettle_Cylinder.017'],
    ],
  ]);

  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expectedNodes.size);

  for (const { file, gltf } of glbs) {
    assert.deepEqual(
      gltf.nodes.map((n) => n.name),
      expectedNodes.get(file),
      `${file} node names`
    );
    const expectedRoots = file === 'teapot.glb' ? [0, 1, 2] : [0];
    assert.deepEqual(gltf.scenes[0].nodes, expectedRoots, `${file} scenes[0].nodes`);
  }
});

test('PROP_PLACEMENTS deep-equals all 9 placements in exact order and key shape', () => {
  const expected = [
    {
      id: 'gate_lantern_left',
      kind: 'post-lantern',
      model: 'models/post-lantern.glb',
      parent: 'scene',
      x: -3.2,
      y: 0,
      z: 26.2,
      rotY: 0,
      targetSize: 2.2,
      scaleAxis: 'y',
    },
    {
      id: 'gate_lantern_right',
      kind: 'post-lantern',
      model: 'models/post-lantern.glb',
      parent: 'scene',
      x: 3.2,
      y: 0,
      z: 26.2,
      rotY: 0,
      targetSize: 2.2,
      scaleAxis: 'y',
    },
    {
      id: 'bandstand_bench',
      kind: 'bench',
      model: 'models/bench.glb',
      parent: 'scene',
      x: -6.2,
      y: 0,
      z: 5.5,
      rotY: 2.2964,
      targetSize: 1.8,
      scaleAxis: 'length',
    },
    {
      id: 'newsstand_lantern',
      kind: 'lantern',
      model: 'models/lantern.glb',
      parent: 'newsstand',
      x: 0.65,
      y: 1.03,
      z: 0.78,
      rotY: 0,
      targetSize: 0.35,
      scaleAxis: 'y',
    },
    {
      id: 'newsstand_street_light',
      kind: 'street-light',
      model: 'models/street-light.glb',
      parent: 'scene',
      x: 7.8,
      y: 0,
      z: 15.2,
      rotY: 0,
      targetSize: 3,
      scaleAxis: 'y',
    },
    {
      id: 'newsstand_bookshelf',
      kind: 'bookshelf',
      model: 'models/bookshelf.glb',
      parent: 'scene',
      x: 4.6,
      y: 0,
      z: 15,
      rotY: -2.844,
      targetSize: 1.6,
      scaleAxis: 'y',
    },
    {
      id: 'wick_oil_lamp',
      kind: 'oil-lamp',
      model: 'models/oil-lamp.glb',
      parent: 'scene',
      x: 14.41,
      y: 0,
      z: -6.05,
      rotY: -1.1733,
      targetSize: 0.9,
      scaleAxis: 'y',
    },
    {
      id: 'tomas_teapot',
      kind: 'teapot',
      model: 'models/teapot.glb',
      parent: 'scene',
      x: 2.06,
      y: 0,
      z: -15.49,
      rotY: -0.1322,
      targetSize: 0.9,
      scaleAxis: 'y',
    },
    {
      id: 'maren_typewriter',
      kind: 'typewriter',
      parent: 'scene',
      x: 9.49,
      y: 0,
      z: -12.42,
      rotY: -0.6525,
    },
  ];

  assert.deepEqual(PROP_PLACEMENTS, expected);

  const maren = PROP_PLACEMENTS[8];
  assert.deepEqual(Object.keys(maren), ['id', 'kind', 'parent', 'x', 'y', 'z', 'rotY']);
  assert.equal('model' in maren, false);
  assert.equal('targetSize' in maren, false);
  assert.equal('scaleAxis' in maren, false);
});

test('CREDITS.md and town-3d/README.md exact byte sizes and line geometry are pinned', async () => {
  const [creditsStat, creditsMd, readmeStat, readmeMd] = await Promise.all([
    fs.stat(CREDITS_PATH),
    fs.readFile(CREDITS_PATH, 'utf8'),
    fs.stat(README_PATH),
    fs.readFile(README_PATH, 'utf8'),
  ]);

  assert.equal(creditsStat.size, 1445, 'CREDITS.md exact byte size');
  const newlineCount = (creditsMd.match(/\n/g) ?? []).length;
  assert.equal(newlineCount, 48, 'CREDITS.md exact newline count');

  const lines = creditsMd.split('\n');
  assert.equal(lines.length, 49, 'CREDITS.md split("\\n") length');
  assert.equal(lines[lines.length - 1], '', 'CREDITS.md trailing empty element after final newline');

  const headerLines = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('- **')) {
      headerLines.push(i + 1);
    }
  }
  assert.deepEqual(headerLines, [8, 14, 20, 26, 32, 38, 44], 'CREDITS.md 1-based entry header line numbers');

  for (const blankLine of [13, 19, 25, 31, 37, 43]) {
    assert.equal(lines[blankLine - 1], '', `CREDITS.md line ${blankLine} must be blank`);
  }
  assert.equal(lines[47].trim(), '- Licence: CC0 1.0', 'CREDITS.md line 48 must be the last entry 4th field');

  assert.equal(readmeStat.size, 4272, 'town-3d/README.md exact byte size');
  assert.equal(readmeMd.split('\n').length, 83, 'town-3d/README.md split("\\n") length');
});

test('credited GLB samplers count and exact objects are pinned across all 7 models', async () => {
  const glbs = await loadAllCreditedGlbs();
  let totalSamplers = 0;
  for (const { file, gltf } of glbs) {
    assert.equal(gltf.samplers?.length, 1, `${file} must have exactly 1 sampler`);
    totalSamplers += gltf.samplers.length;
    if (file === 'teapot.glb') {
      assert.deepEqual(gltf.samplers[0], { wrapS: 10497, wrapT: 10497 }, 'teapot.glb sampler');
    } else {
      assert.deepEqual(gltf.samplers[0], {}, `${file} sampler must be empty object`);
    }
  }
  assert.equal(totalSamplers, 7, 'total samplers across credited GLBs must be 7');
});

test('test-credits.mjs file hygiene and CREDITS.md Poly Pizza URL exclusivity are pinned', async () => {
  const [selfSrc, creditsMd] = await Promise.all([
    fs.readFile(fileURLToPath(import.meta.url), 'utf8'),
    fs.readFile(CREDITS_PATH, 'utf8'),
  ]);

  const testNames = [...selfSrc.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(testNames.length, 64, 'test-credits.mjs must have exactly 54 top-level tests');
  assert.equal(new Set(testNames).size, 64, 'all 54 top-level test names must be unique');

  const importLines = selfSrc.match(/^import /gm) ?? [];
  assert.equal(importLines.length, 6, 'test-credits.mjs must have exactly 6 top-level import lines');

  const bannedNeedles = [
    'camp' + 'fire',
    'Math.' + 'random',
    'fetch' + '(',
    'TO' + 'DO',
    'FIX' + 'ME',
    'Date.' + 'now',
  ];
  for (const needle of bannedNeedles) {
    assert.equal(selfSrc.includes(needle), false, `test-credits.mjs must not contain ${needle}`);
  }

  const polyPizzaUrls = creditsMd.match(/https:\/\/poly\.pizza\/m\//g) ?? [];
  assert.equal(polyPizzaUrls.length, 7, 'CREDITS.md must contain exactly 7 https://poly.pizza/m/ URLs');
  const allHttp = creditsMd.match(/http/gi) ?? [];
  assert.equal(allHttp.length, 7, 'CREDITS.md must contain no http substring outside the 7 Poly Pizza URLs');
});

test('credited GLB accessor min and max vectors are pinned exactly', async () => {
  const expected = new Map([
    ["post-lantern.glb", [[null,null],[[-0.0020823935046792,-6.55670864824209e-11,-0.00216403021477163],[0.00215450138784945,0.0329999998211861,0.0134999984875321]],[null,null],[null,null],[null,null],[[-0.00320010050199926,-0.0130857536569238,-0.00320008024573326],[0.00320010050199926,0.00100000493694097,0.00320012075826526]],[null,null],[null,null]]],
    ["lantern.glb", [[null,null],[[-0.00320010050199926,-3.9415190555836e-10,-0.00320010096766055],[0.00320010050199926,0.00925191678106785,0.00320010026916862]],[null,null],[null,null]]],
    ["bench.glb", [[null,null],[[-0.0020000000949949,-9.69331073741309e-11,-0.000750000472180545],[0.0020000000949949,0.00100000039674342,0.000750000181142241]],[null,null],[null,null]]],
    ["street-light.glb", [[null,null],[[-0.00356861995533109,-0.0321329906582832,-0.000136919203214347],[0.00356861646287143,0.00346586992964149,0.0962077379226685]],[null,null],[null,null],[[-0.00228774710558355,-0.0307274665683508,0.0895240753889084],[0.00228774733841419,-0.0182720646262169,0.0937066599726677]],[null,null]]],
    ["bookshelf.glb", [[null,null],[[-0.00292035890743136,-2.97847267682894e-11,-0.000771486957091838],[0.0028209644369781,0.0132017778232694,0.000763820891734213]],[null,null],[null,null]]],
    ["oil-lamp.glb", [[null,null],[[-0.00156644126400352,-0.001647041994147,0.00431230757385492],[0.00156644126400352,0.00164706574287266,0.00751049676910043]],[null,null],[null,null],[[-0.00153906107880175,-0.0015390490880236,0],[0.00153906061314046,0.00153907260391861,0.00756699172779918]],[null,null]]],
    ["teapot.glb", [[[-1.0370800495147705,0.9144729971885681,-1.0370839834213257],[1.0370800495147705,1.897515058517456,1.0370759963989258]],[[-1,-1,-1],[1,1,1]],[[0.00457700015977025,0.41162899136543274],[0.020648999139666557,0.41162899136543274]],[[0],[103]],[[2.656141996383667,0.30347201228141785,-0.3783020079135895],[3.6701819896698,1.3341890573501587,0.3782939910888672]],[[-0.9378238320350647,-0.9378172159194946,-1],[0.9378238320350647,0.9378172159194946,1]],[[0.00457700015977025,0.41162899136543274],[0.0065449997782707214,0.4955970048904419]],[[0],[95]],[[-2.3452889919281006,-2.25803804397583,-2.3452889919281006],[3.0984630584716797,4.0816779136657715,2.3452889919281006]],[[-0.9977326393127441,-0.9991175532341003,-1],[0.9977326393127441,1,1]],[[0.007201000116765499,0.41162899136543274],[0.020648999139666557,0.663532018661499]],[[0],[295]]]],
  ]);
  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);
  for (const { file, gltf } of glbs) {
    assert.deepEqual(
      gltf.accessors.map((a) => [a.min ?? null, a.max ?? null]),
      expected.get(file),
      `${file} accessor min/max vectors`
    );
  }
});

test('credited GLB accessor counts are pinned exactly per file', async () => {
  const expected = new Map([
    ["post-lantern.glb", [288,175,175,175,1416,520,520,520]],
    ["lantern.glb", [792,338,338,338]],
    ["bench.glb", [132,80,80,80]],
    ["street-light.glb", [876,225,225,96,40,40]],
    ["bookshelf.glb", [708,454,454,454]],
    ["oil-lamp.glb", [240,80,80,588,160,160]],
    ["teapot.glb", [104,104,104,324,96,96,96,276,296,296,296,1254]],
  ]);
  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);
  let totalAccessors = 0;
  for (const { file, gltf } of glbs) {
    assert.deepEqual(
      gltf.accessors.map((a) => a.count),
      expected.get(file),
      `${file} accessor counts`
    );
    totalAccessors += gltf.accessors.length;
  }
  assert.equal(totalAccessors, 44, 'total credited GLB accessors');
});

test('credited GLB bufferView byteOffset, byteLength, and target are pinned exactly', async () => {
  const expected = new Map([
    ["post-lantern.glb", [[0,0,15093,null],[0,15096,576,34963],[0,15672,2100,34962],[0,17772,2100,34962],[0,19872,1400,34962],[0,21272,2832,34963],[0,24104,6240,34962],[0,30344,6240,34962],[0,36584,4160,34962]]],
    ["lantern.glb", [[0,0,15093,null],[0,15096,1584,34963],[0,16680,4056,34962],[0,20736,4056,34962],[0,24792,2704,34962]]],
    ["bench.glb", [[0,0,19885,null],[0,19888,264,34963],[0,20152,960,34962],[0,21112,960,34962],[0,22072,640,34962]]],
    ["street-light.glb", [[0,0,1752,34963],[0,1752,2700,34962],[0,4452,2700,34962],[0,7152,192,34963],[0,7344,480,34962],[0,7824,480,34962]]],
    ["bookshelf.glb", [[0,0,6727,null],[0,6728,1416,34963],[0,8144,5448,34962],[0,13592,5448,34962],[0,19040,3632,34962]]],
    ["oil-lamp.glb", [[0,0,480,34963],[0,480,960,34962],[0,1440,960,34962],[0,2400,1176,34963],[0,3576,1920,34962],[0,5496,1920,34962]]],
    ["teapot.glb", [[0,0,5952,34962],[0,5952,5952,34962],[0,11904,3968,34962],[0,15872,3708,34963],[0,19580,755,null]]],
  ]);
  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);
  let totalBufferViews = 0;
  for (const { file, gltf } of glbs) {
    assert.deepEqual(
      gltf.bufferViews.map((b) => [b.buffer, b.byteOffset ?? 0, b.byteLength, b.target ?? null]),
      expected.get(file),
      `${file} bufferView vectors`
    );
    totalBufferViews += gltf.bufferViews.length;
  }
  assert.equal(totalBufferViews, 41, 'total credited GLB bufferViews');
});

test('credited GLB primitive attribute, indices, and material wiring is pinned exactly', async () => {
  const expected = new Map([
    ["post-lantern.glb", [[[{"NORMAL":2,"POSITION":1,"TEXCOORD_0":3},0,0]],[[{"NORMAL":6,"POSITION":5,"TEXCOORD_0":7},4,0]]]],
    ["lantern.glb", [[[{"NORMAL":2,"POSITION":1,"TEXCOORD_0":3},0,0]]]],
    ["bench.glb", [[[{"NORMAL":2,"POSITION":1,"TEXCOORD_0":3},0,0]]]],
    ["street-light.glb", [[[{"NORMAL":2,"POSITION":1},0,0],[{"NORMAL":5,"POSITION":4},3,1]]]],
    ["bookshelf.glb", [[[{"NORMAL":2,"POSITION":1,"TEXCOORD_0":3},0,0]]]],
    ["oil-lamp.glb", [[[{"NORMAL":2,"POSITION":1},0,0],[{"NORMAL":5,"POSITION":4},3,1]]]],
    ["teapot.glb", [[[{"POSITION":0,"NORMAL":1,"TEXCOORD_0":2},3,0]],[[{"POSITION":4,"NORMAL":5,"TEXCOORD_0":6},7,0]],[[{"POSITION":8,"NORMAL":9,"TEXCOORD_0":10},11,0]]]],
  ]);
  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);
  let totalPrimitives = 0;
  for (const { file, gltf } of glbs) {
    assert.deepEqual(
      gltf.meshes.map((m) => m.primitives.map((p) => [p.attributes, p.indices, p.material ?? null])),
      expected.get(file),
      `${file} primitive wiring`
    );
    totalPrimitives += gltf.meshes.reduce((sum, m) => sum + m.primitives.length, 0);
  }
  assert.equal(totalPrimitives, 12, 'total credited GLB primitives');
});

test('credited GLB mesh names are pinned exactly', async () => {
  const expected = new Map([
    ["post-lantern.glb", ["post_lantern","post_lantern_lantern"]],
    ["lantern.glb", ["lantern_standing"]],
    ["bench.glb", ["bench"]],
    ["street-light.glb", ["StreetLight"]],
    ["bookshelf.glb", ["Bookshelf"]],
    ["oil-lamp.glb", ["Light_Floor2"]],
    ["teapot.glb", ["misc_kettle_cover_Cylinder.018-Mesh","misc_kettle_nozzle_Cylinder.019-Mesh","misc_kettle_Cylinder.017-Mesh"]],
  ]);
  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);
  let totalMeshes = 0;
  for (const { file, gltf } of glbs) {
    assert.deepEqual(
      gltf.meshes.map((m) => m.name),
      expected.get(file),
      `${file} mesh names`
    );
    totalMeshes += gltf.meshes.length;
  }
  assert.equal(totalMeshes, 10, 'total credited GLB meshes');
});

test('credited GLB node name, mesh, and children triples are pinned exactly', async () => {
  const expected = new Map([
    ["post-lantern.glb", [["RootNode",null,[1]],["post_lantern",0,[2]],["post_lantern_lantern",1,null]]],
    ["lantern.glb", [["RootNode",null,[1]],["lantern_standing",0,null]]],
    ["bench.glb", [["RootNode",null,[1]],["bench",0,null]]],
    ["street-light.glb", [["RootNode",null,[1]],["StreetLight",0,null]]],
    ["bookshelf.glb", [["RootNode",null,[1]],["Bookshelf",0,null]]],
    ["oil-lamp.glb", [["RootNode",null,[1]],["Light_Floor2",0,null]]],
    ["teapot.glb", [["misc_kettle_cover_Cylinder.018",0,null],["misc_kettle_nozzle_Cylinder.019",1,null],["misc_kettle_Cylinder.017",2,null]]],
  ]);
  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);
  let totalNodes = 0;
  for (const { file, gltf } of glbs) {
    assert.deepEqual(
      gltf.nodes.map((n) => [n.name, n.mesh ?? null, n.children ?? null]),
      expected.get(file),
      `${file} node triples`
    );
    totalNodes += gltf.nodes.length;
  }
  assert.equal(totalNodes, 16, 'total credited GLB nodes');
});

test('credited GLB texture objects are pinned exactly for textured models', async () => {
  const expected = new Map([
    ["post-lantern.glb", [{"name":"base_color_texture","sampler":0,"source":0}]],
    ["lantern.glb", [{"name":"base_color_texture","sampler":0,"source":0}]],
    ["bench.glb", [{"name":"base_color_texture","sampler":0,"source":0}]],
    ["bookshelf.glb", [{"name":"base_color_texture","sampler":0,"source":0}]],
    ["teapot.glb", [{"name":"misc_kettle","sampler":0,"source":0}]],
  ]);
  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, 7);
  let totalTextures = 0;
  for (const { file, gltf } of glbs) {
    if (expected.has(file)) {
      assert.deepEqual(gltf.textures, expected.get(file), `${file} textures`);
      totalTextures += gltf.textures.length;
    }
  }
  assert.equal(totalTextures, 5, 'total credited GLB textures');
});

test('credited GLB accessor bufferView and byteOffset mapping is pinned exactly', async () => {
  const expected = new Map([
    ["post-lantern.glb", [[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0]]],
    ["lantern.glb", [[1,0],[2,0],[3,0],[4,0]]],
    ["bench.glb", [[1,0],[2,0],[3,0],[4,0]]],
    ["street-light.glb", [[0,0],[1,0],[2,0],[3,0],[4,0],[5,0]]],
    ["bookshelf.glb", [[1,0],[2,0],[3,0],[4,0]]],
    ["oil-lamp.glb", [[0,0],[1,0],[2,0],[3,0],[4,0],[5,0]]],
    ["teapot.glb", [[0,0],[1,0],[2,0],[3,0],[0,1248],[1,1248],[2,832],[3,648],[0,2400],[1,2400],[2,1600],[3,1200]]],
  ]);
  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);
  let sharedBufferViews = 0;
  for (const { file, gltf } of glbs) {
    assert.deepEqual(
      gltf.accessors.map((a) => [a.bufferView, a.byteOffset ?? 0]),
      expected.get(file),
      `${file} accessor bufferView mapping`
    );
    const seen = new Set(gltf.accessors.map((a) => a.bufferView));
    sharedBufferViews += gltf.accessors.length - seen.size;
  }
  assert.equal(sharedBufferViews, 8, 'accessors sharing a bufferView with another accessor (teapot only)');
});

test('pine.glb stays local-only with pinned identity and no COLOR_0 in credited models', async () => {
  const pineBuf = await fs.readFile(path.join(MODELS_DIR, 'pine.glb'));
  assert.equal(pineBuf.length, 2221932, 'pine.glb exact byte size');
  assert.equal(pineBuf.subarray(0, 4).toString('ascii'), 'glTF', 'pine.glb must start with glTF magic bytes');
  assert.equal(pineBuf.readUInt32LE(4), 2, 'pine.glb must be glTF version 2');
  assert.equal(pineBuf.readUInt32LE(8), pineBuf.length, 'pine.glb GLB header length must match file size');
  const jsonLen = pineBuf.readUInt32LE(12);
  const pineGltf = JSON.parse(pineBuf.subarray(20, 20 + jsonLen).toString('utf8'));
  assert.equal(pineGltf.asset?.generator, "FBX2glTF v0.9.7", 'pine.glb generator');
  assert.equal(pineGltf.asset?.version, '2.0', 'pine.glb glTF asset.version must be 2.0');
  assert.deepEqual(
    pineGltf.meshes.map((m) => m.name),
    ["Pine_4"],
    'pine.glb mesh names'
  );
  assert.deepEqual(
    pineGltf.materials.map((m) => m.name),
    ["Bark_NormalTree","Leaves_Pine"],
    'pine.glb material names'
  );
  assert.equal(pineGltf.images?.length, 3, 'pine.glb must have 3 images');
  assert.equal(pineGltf.textures?.length, 3, 'pine.glb must have 3 textures');
  for (const mesh of pineGltf.meshes) {
    for (const prim of mesh.primitives) {
      assert.equal(typeof prim.attributes?.COLOR_0, 'number', 'pine.glb primitive must have COLOR_0');
    }
  }

  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const creditedFiles = parseCreditedModels(creditsMd);
  assert.equal(creditedFiles.includes('pine.glb'), false, 'pine.glb must not be credited in CREDITS.md');
  const placedModels = new Set(
    PROP_PLACEMENTS.map((p) => p.model).filter((m) => typeof m === 'string' && m.length > 0)
  );
  assert.equal(placedModels.has('models/pine.glb'), false, 'pine.glb must not appear in PROP_PLACEMENTS');

  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        assert.equal('COLOR_0' in (prim.attributes ?? {}), false, `${file} primitive must not have COLOR_0`);
      }
    }
  }
});

test('CREDITS.md and town-3d README.md FNV-1a checksums are pinned', async () => {
  const fnv1aHex = (buf) => {
    let hash = 0x811c9dc5;
    for (const byte of buf) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const [creditsBuf, readmeBuf] = await Promise.all([
    fs.readFile(CREDITS_PATH),
    fs.readFile(README_PATH),
  ]);
  assert.equal(fnv1aHex(creditsBuf), "c5545889", 'CREDITS.md FNV-1a checksum');
  assert.equal(fnv1aHex(readmeBuf), "de40d877", 'town-3d/README.md FNV-1a checksum');
});

test('credited GLB JSON top-level key order is pinned per exporter', async () => {
  const expected = new Map([
    ['post-lantern.glb', ['asset', 'scene', 'buffers', 'bufferViews', 'scenes', 'accessors', 'images', 'samplers', 'textures', 'materials', 'meshes', 'nodes']],
    ['lantern.glb', ['asset', 'scene', 'buffers', 'bufferViews', 'scenes', 'accessors', 'images', 'samplers', 'textures', 'materials', 'meshes', 'nodes']],
    ['bench.glb', ['asset', 'scene', 'buffers', 'bufferViews', 'scenes', 'accessors', 'images', 'samplers', 'textures', 'materials', 'meshes', 'nodes']],
    ['bookshelf.glb', ['asset', 'scene', 'buffers', 'bufferViews', 'scenes', 'accessors', 'images', 'samplers', 'textures', 'materials', 'meshes', 'nodes']],
    ['street-light.glb', ['asset', 'scene', 'buffers', 'bufferViews', 'scenes', 'accessors', 'samplers', 'materials', 'meshes', 'nodes']],
    ['oil-lamp.glb', ['asset', 'scene', 'buffers', 'bufferViews', 'scenes', 'accessors', 'samplers', 'materials', 'meshes', 'nodes']],
    ['teapot.glb', ['accessors', 'asset', 'buffers', 'bufferViews', 'images', 'materials', 'meshes', 'nodes', 'samplers', 'scene', 'scenes', 'textures']],
  ]);
  const glbs = await loadAllCreditedGlbs();
  assert.equal(glbs.length, expected.size);
  for (const { file, gltf } of glbs) {
    assert.deepEqual(Object.keys(gltf), expected.get(file), `${file} top-level key order`);
  }
});

test('credited GLB material key sets and alphaMode are pinned', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    for (const mat of gltf.materials) {
      assert.equal(mat.alphaMode, 'OPAQUE', `${file} ${mat.name} alphaMode`);
      if (file === 'teapot.glb') {
        assert.deepEqual(Object.keys(mat), ['name', 'pbrMetallicRoughness', 'emissiveFactor', 'alphaMode', 'doubleSided'], `${file} material keys`);
      } else {
        assert.deepEqual(Object.keys(mat), ['name', 'alphaMode', 'extras', 'pbrMetallicRoughness'], `${file} ${mat.name} material keys`);
        assert.equal('doubleSided' in mat, false, `${file} ${mat.name} must have no doubleSided key`);
        assert.equal('emissiveFactor' in mat, false, `${file} ${mat.name} must have no emissiveFactor key`);
      }
    }
  }
});

test('credited GLB asset is exactly generator plus version and no animation skin camera or extension keys exist', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    const generator = file === 'teapot.glb' ? 'obj2gltf' : 'FBX2glTF v0.9.7';
    assert.deepEqual(gltf.asset, { generator, version: '2.0' }, `${file} asset`);
    assert.equal('copyright' in gltf.asset, false, `${file} asset must have no copyright key`);
    for (const key of ['animations', 'skins', 'cameras', 'extensionsUsed', 'extensionsRequired', 'extensions']) {
      assert.equal(key in gltf, false, `${file} must have no ${key} key`);
    }
  }
});

test('credited GLB chunk-type magic and buffer naming are pinned', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, buf, jsonLen, gltf } of glbs) {
    assert.equal(buf.readUInt32LE(16), 0x4E4F534A, `${file} JSON chunk type must be 0x4E4F534A`);
    assert.equal(buf.readUInt32LE(20 + jsonLen + 4), 0x004E4942, `${file} BIN chunk type must be 0x004E4942`);
    assert.equal(gltf.buffers.length, 1, `${file} must have exactly 1 buffer`);
    if (file === 'teapot.glb') {
      assert.equal(gltf.buffers[0].name, 'misc_kettle', `${file} buffer name`);
    } else {
      assert.equal('name' in gltf.buffers[0], false, `${file} buffer must have no name key`);
    }
  }
});

test('credited GLB mesh primitive and attribute key order is pinned', async () => {
  const glbs = await loadAllCreditedGlbs();
  for (const { file, gltf } of glbs) {
    for (const mesh of gltf.meshes) {
      assert.deepEqual(Object.keys(mesh), ['name', 'primitives'], `${file} mesh keys`);
      for (const prim of mesh.primitives) {
        const wantPrim = file === 'teapot.glb'
          ? ['attributes', 'indices', 'material', 'mode']
          : ['material', 'mode', 'attributes', 'indices'];
        assert.deepEqual(Object.keys(prim), wantPrim, `${file} primitive keys`);
        const wantAttr = file === 'teapot.glb'
          ? ['POSITION', 'NORMAL', 'TEXCOORD_0']
          : (file === 'street-light.glb' || file === 'oil-lamp.glb'
            ? ['NORMAL', 'POSITION']
            : ['NORMAL', 'POSITION', 'TEXCOORD_0']);
        assert.deepEqual(Object.keys(prim.attributes), wantAttr, `${file} attribute keys`);
      }
    }
  }
});

test('credit parsers handle synthetic edge inputs without leaking fields', () => {
  const synthetic = [
    'intro `models/not-a-model.png` and models/bare.glb are not entries',
    '- **Alpha** (`models/alpha.glb`)',
    '  - Author: Someone',
    '  - Poly Pizza ID: `ABCDEFGHIJ`',
    '  - Page: https://poly.pizza/m/ABCDEFGHIJ',
    '  - Licence: CC0 1.0',
    '  - Colour: red',
    '- **Beta** (`models/beta.glb`)',
    '  - Author: Other',
    '  - Poly Pizza ID: `0123456789`',
    '  - Page: https://poly.pizza/m/0123456789',
    '- **Gamma** (models/gamma.glb)',
    '  - Author: NoBackticks',
    '- **Alpha** (`models/alpha.glb`)',
    '  - Author: Someone Again',
    '  - Poly Pizza ID: `ABCDEFGHIJ`',
    '  - Page: https://poly.pizza/m/ABCDEFGHIJ',
    '  - Licence: CC0 1.0',
    '',
  ].join('\n');
  assert.deepEqual(parseCreditedModels(synthetic), ['alpha.glb', 'beta.glb', 'alpha.glb']);
  const entries = parseCreditEntries(synthetic);
  assert.equal(entries.length, 3, 'synthetic input must yield 3 entries');
  assert.deepEqual(entries[0], { displayName: 'Alpha', file: 'alpha.glb', author: 'Someone', id: 'ABCDEFGHIJ', page: 'https://poly.pizza/m/ABCDEFGHIJ', licence: 'CC0 1.0' });
  assert.equal(entries[1].licence, null, 'Beta is missing Licence so licence must be null');
  assert.deepEqual([entries[1].displayName, entries[1].file, entries[1].author, entries[1].id, entries[1].page], ['Beta', 'beta.glb', 'Other', '0123456789', 'https://poly.pizza/m/0123456789']);
  assert.deepEqual(Object.keys(entries[0]), ['displayName', 'file', 'author', 'id', 'page', 'licence']);
  assert.equal(entries.some((e) => e.displayName === 'Gamma'), false, 'Gamma has no backticked path so it is not an entry');
  assert.equal(entries[2].author, 'Someone Again', 'duplicate Alpha heading is a second entry');
  assert.equal(entries[0].page, 'https://poly.pizza/m/ABCDEFGHIJ', 'no field leaks across entries');
});

test('CREDITS.md line geometry is pinned', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const lines = creditsMd.split('\n');
  assert.equal(lines.length, 49, 'CREDITS.md split on newline must have 49 parts');
  assert.equal(lines.at(-1), '', 'CREDITS.md must end with a trailing newline');
  assert.equal(lines.length - 1, 48, 'CREDITS.md must have 48 content lines');
  const headerLines = lines.map((l, i) => (l.startsWith('- **') ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(headerLines, [8, 14, 20, 26, 32, 38, 44], 'entry header lines');
  const blankLines = lines.map((l, i) => (l === '' && i + 1 < 49 ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(blankLines, [2, 7, 13, 19, 25, 31, 37, 43], 'blank content lines');
  assert.equal(creditsMd.includes('\r'), false, 'CREDITS.md must have no carriage returns');
});

test('town-3d README.md models paragraph lines are pinned verbatim', async () => {
  const readmeMd = await fs.readFile(README_PATH, 'utf8');
  const lines = readmeMd.split('\n');
  assert.deepEqual(lines.slice(25, 30), [
    '- **Models (`models/`):** 8 `.glb` files locally — 7 committed CC0 props',
    '  (`bench.glb`, `bookshelf.glb`, `lantern.glb`, `oil-lamp.glb`,',
    '  `post-lantern.glb`, `street-light.glb`, `teapot.glb`; see `CREDITS.md`).',
    '  `pine.glb` is **local-only** (~2.2 MB, deliberately never committed or',
    '  shipped; procedural trees stay, and `stage-deploy.mjs` excludes it).',
  ]);
  assert.equal(lines[30].startsWith('- **Gazette'), true, 'line 31 must start the Gazette bullet');
});

test('town.js procedural fallback builder inventory and dispatch order are pinned', async () => {
  const townJs = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');
  const builders = [...townJs.matchAll(/^export function (buildProcedural[A-Z]\w+)|^function (buildProcedural[A-Z]\w+)/gm)]
    .map((m) => m[1] ?? m[2]);
  assert.deepEqual(builders, ['buildProceduralPostLantern', 'buildProceduralLantern', 'buildProceduralBench', 'buildProceduralStreetLight', 'buildProceduralBookshelf', 'buildProceduralOilLamp', 'buildProceduralTypewriter', 'buildProceduralTeapot', 'buildProceduralProp']);
  const exported = [...townJs.matchAll(/^export function (buildProcedural[A-Z]\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, ['buildProceduralStreetLight', 'buildProceduralBookshelf', 'buildProceduralOilLamp', 'buildProceduralTypewriter', 'buildProceduralTeapot', 'buildProceduralProp']);
  const dispatch = [...townJs.matchAll(/if \(kind === '([a-z-]+)'\) return buildProcedural\w+\(THREE\);/g)].map((m) => m[1]);
  assert.deepEqual(dispatch, ['post-lantern', 'lantern', 'bench', 'street-light', 'bookshelf', 'oil-lamp', 'typewriter', 'teapot']);
  assert.equal(townJs.includes('return new THREE.Group();'), true, 'unknown kind must fall through to an empty Group');
  assert.equal(/export function buildProceduralProp\(THREE, kind\) \{[\s\S]*?return new THREE\.Group\(\);/.test(townJs), true, 'fallthrough must be inside buildProceduralProp');
});

test('credited GLB loader returns files in CREDITS.md order', async () => {
  const creditsMd = await fs.readFile(CREDITS_PATH, 'utf8');
  const credited = parseCreditedModels(creditsMd);
  assert.deepEqual(credited, ['post-lantern.glb', 'lantern.glb', 'bench.glb', 'street-light.glb', 'bookshelf.glb', 'oil-lamp.glb', 'teapot.glb']);
  assert.deepEqual(credited.map((f) => `models/${f}`), EXPECTED_TUPLES.map((t) => t[1]));
  const glbs = await loadAllCreditedGlbs();
  assert.deepEqual(glbs.map((g) => g.file), credited, 'loader must return files in CREDITS.md order');
  assert.equal(glbs.length, 7, 'loader must return 7 credited GLBs');
});
