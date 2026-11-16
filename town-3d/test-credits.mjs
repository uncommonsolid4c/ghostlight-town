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
