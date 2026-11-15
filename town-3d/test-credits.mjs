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

function parseCreditedModels(creditsMd) {
  const models = [];
  for (const match of creditsMd.matchAll(/`models\/([^`\s]+\.glb)`/g)) {
    models.push(match[1]);
  }
  return models;
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
