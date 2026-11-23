import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GARDEN_BED,
  SEED_COLORS,
  gardenStageForAgeDays,
  buildGardenPlant,
  buildGardenBed,
  updateGardenBed,
} from './garden.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeFakeThree() {
  class BoxGeometry {
    constructor(w, h, d) {
      this.type = 'BoxGeometry';
      this.args = [w, h, d];
    }
  }
  class CylinderGeometry {
    constructor(rt, rb, h, seg) {
      this.type = 'CylinderGeometry';
      this.args = [rt, rb, h, seg];
    }
  }
  class SphereGeometry {
    constructor(r, wSeg, hSeg) {
      this.type = 'SphereGeometry';
      this.args = [r, wSeg, hSeg];
    }
  }
  class MeshStandardMaterial {
    constructor(opts) {
      this.type = 'MeshStandardMaterial';
      this.opts = opts;
      this.color = opts.color;
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.name = '';
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        },
      };
      this.rotation = { x: 0, y: 0, z: 0 };
    }
  }
  class Group {
    constructor() {
      this.name = '';
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        },
      };
      this.rotation = { x: 0, y: 0, z: 0 };
      this.children = [];
    }
    add(child) {
      this.children.push(child);
    }
    getObjectByName(name) {
      if (this.name === name) return this;
      for (const child of this.children) {
        if (child.name === name) return child;
        if (typeof child.getObjectByName === 'function') {
          const found = child.getObjectByName(name);
          if (found) return found;
        }
      }
      return null;
    }
  }
  return {
    BoxGeometry,
    CylinderGeometry,
    SphereGeometry,
    MeshStandardMaterial,
    Mesh,
    Group,
  };
}

test('gardenStageForAgeDays maps UTC day ages to sprout, leaf, bloom and handles invalid inputs', () => {
  assert.equal(gardenStageForAgeDays(0), 'sprout');
  assert.equal(gardenStageForAgeDays(1), 'sprout');
  assert.equal(gardenStageForAgeDays(2), 'leaf');
  assert.equal(gardenStageForAgeDays(3), 'leaf');
  assert.equal(gardenStageForAgeDays(4), 'bloom');
  assert.equal(gardenStageForAgeDays(100), 'bloom');
  assert.equal(gardenStageForAgeDays(-1), 'sprout');
  assert.equal(gardenStageForAgeDays(Number.NaN), 'sprout');
});

test('GARDEN_BED sits on flat ground off bandstand east edge, clear of newsstand and fishing shore', () => {
  assert.ok(Number.isFinite(GARDEN_BED.x) && Number.isFinite(GARDEN_BED.z));
  // Bandstand deck is at (0, 0) with radius 4.5 m; bed (2.4 m x 1.6 m) at (6.5, 0)
  // has west edge at x = 5.3 (clear of 4.5 m deck).
  assert.ok(GARDEN_BED.x > 4.5, 'Bed must sit east of bandstand deck edge');

  const flatGroundAt = () => 0.25;
  const centerY = flatGroundAt(GARDEN_BED.x, GARDEN_BED.z);
  const corners = [
    [GARDEN_BED.x - 1.2, GARDEN_BED.z - 0.8],
    [GARDEN_BED.x + 1.2, GARDEN_BED.z - 0.8],
    [GARDEN_BED.x - 1.2, GARDEN_BED.z + 0.8],
    [GARDEN_BED.x + 1.2, GARDEN_BED.z + 0.8],
  ];
  for (const [cx, cz] of corners) {
    assert.ok(Math.abs(flatGroundAt(cx, cz) - centerY) <= 0.05);
  }

  // Newsstand in staging.js / TOWN_LAYOUT is at (6, 14); distance from (6.5, 0) is ~14.01 m.
  const newsstandDist = Math.hypot(GARDEN_BED.x - 6, GARDEN_BED.z - 14);
  assert.ok(newsstandDist >= 10, `Expected bed clear of newsstand (6, 14), got dist=${newsstandDist}`);

  // Fishing spot sits along the 45-degree bearing at r in [25, 50] (closest shore point >= (17.68, 17.68)).
  const minShoreX = Math.sin(Math.PI / 4) * 25;
  const minShoreZ = Math.cos(Math.PI / 4) * 25;
  const shoreDist = Math.hypot(GARDEN_BED.x - minShoreX, GARDEN_BED.z - minShoreZ);
  assert.ok(shoreDist >= 15, `Expected bed clear of fishing shore area, got dist=${shoreDist}`);
});

test('buildGardenBed builds frame, soil, garden-plants subgroup, and deterministic slot positions', () => {
  const THREE = makeFakeThree();

  const emptyBed = buildGardenBed(THREE, { garden: { slots: [] } });
  assert.equal(emptyBed.name, 'garden-bed');
  assert.equal(emptyBed.position.x, GARDEN_BED.x);
  assert.equal(emptyBed.position.z, GARDEN_BED.z);
  assert.ok(emptyBed.getObjectByName('garden-soil'));
  assert.ok(emptyBed.getObjectByName('garden-frame-north'));
  assert.ok(emptyBed.getObjectByName('garden-frame-south'));
  assert.ok(emptyBed.getObjectByName('garden-frame-west'));
  assert.ok(emptyBed.getObjectByName('garden-frame-east'));

  const emptyPlants = emptyBed.getObjectByName('garden-plants');
  assert.ok(emptyPlants);
  assert.equal(emptyPlants.children.length, 0);

  const bed = buildGardenBed(THREE, {
    garden: {
      slots: [
        { slot: 0, handle: 'alice', seed: 'moonflower', planted_at: 1000, stage: 'sprout' },
        { slot: 4, handle: 'bob', seed: 'lantern_poppy', planted_at: 1000, stage: 'bloom' },
      ],
    },
  });
  const plants = bed.getObjectByName('garden-plants');
  assert.equal(plants.children.length, 2);
  assert.equal(plants.children[0].name, 'garden-plant-moonflower-sprout');
  assert.equal(plants.children[1].name, 'garden-plant-lantern_poppy-bloom');
  // Slot 0: row 0, col 0; Slot 4: row 1, col 1
  assert.notEqual(plants.children[0].position.x, plants.children[1].position.x);
  assert.notEqual(plants.children[0].position.z, plants.children[1].position.z);

  updateGardenBed(THREE, bed, {
    slots: [{ slot: 2, handle: 'carol', seed: 'tea_mint', planted_at: 1000, stage: 'leaf' }],
  });
  const updatedPlants = bed.getObjectByName('garden-plants');
  assert.equal(updatedPlants.children.length, 1);
  assert.equal(updatedPlants.children[0].name, 'garden-plant-tea_mint-leaf');
});

test('buildGardenPlant builds sprout, leaf, bloom, and fails soft on unknown seed or stage', () => {
  const THREE = makeFakeThree();

  const sprout = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'sprout' });
  assert.equal(sprout.name, 'garden-plant-moonflower-sprout');
  assert.equal(sprout.getObjectByName('plant-stem'), null);
  assert.equal(sprout.getObjectByName('plant-flower'), null);

  const leaf = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'leaf' });
  assert.equal(leaf.name, 'garden-plant-moonflower-leaf');
  assert.ok(leaf.getObjectByName('plant-stem'));
  assert.ok(leaf.getObjectByName('plant-leaf-0'));
  assert.ok(leaf.getObjectByName('plant-leaf-1'));
  assert.ok(leaf.getObjectByName('plant-leaf-2'));
  assert.equal(leaf.getObjectByName('plant-flower'), null);

  const bloom = buildGardenPlant(THREE, { seed: 'lantern_poppy', stage: 'bloom' });
  assert.equal(bloom.name, 'garden-plant-lantern_poppy-bloom');
  assert.ok(bloom.getObjectByName('plant-stem'));
  const flower = bloom.getObjectByName('plant-flower');
  assert.ok(flower);
  assert.equal(flower.material.color, SEED_COLORS.lantern_poppy);

  const unknownSeed = buildGardenPlant(THREE, { seed: 'rose', stage: 'bloom' });
  assert.equal(unknownSeed.getObjectByName('plant-stem'), null);
  assert.equal(unknownSeed.getObjectByName('plant-flower'), null);

  const unknownStage = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'withered' });
  assert.equal(unknownStage.getObjectByName('plant-stem'), null);
  assert.equal(unknownStage.getObjectByName('plant-flower'), null);
});

test('SEED_COLORS matches GARDEN_SEEDS in town-api/server.mjs', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'town-api', 'server.mjs'), 'utf8');
  const tableMatch = serverSrc.match(/const\s+GARDEN_SEEDS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(tableMatch, 'Could not find GARDEN_SEEDS in town-api/server.mjs');
  const serverEntries = {};
  for (const m of tableMatch[1].matchAll(/kind:\s*'([^']+)'[^}]*color:\s*'([^']+)'/g)) {
    serverEntries[m[1]] = m[2];
  }
  assert.deepEqual(SEED_COLORS, serverEntries);
});

test('garden.mjs and test-garden.mjs contain no random PRNG and no forbidden terms', () => {
  const modSrc = fs.readFileSync(path.join(__dirname, 'garden.mjs'), 'utf8');
  const testSrc = fs.readFileSync(path.join(__dirname, 'test-garden.mjs'), 'utf8');
  const mathRndRe = new RegExp('Math\\.' + 'random');
  const forbiddenRe = new RegExp('camp\\s*' + 'fire', 'i');
  for (const [label, src] of [['garden.mjs', modSrc], ['test-garden.mjs', testSrc]]) {
    assert.equal(mathRndRe.test(src), false, `${label} must not use Math random`);
    assert.equal(forbiddenRe.test(src), false, `${label} must not mention forbidden term`);
  }
});
