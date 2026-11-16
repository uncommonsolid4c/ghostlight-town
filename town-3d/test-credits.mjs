import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROP_PLACEMENTS } from './town.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDITS_PATH = path.join(__dirname, 'CREDITS.md');
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
