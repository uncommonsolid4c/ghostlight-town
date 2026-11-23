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

test('garden slot layout places all six slots at exact deterministic positions', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE, {
    garden: {
      slots: [0, 1, 2, 3, 4, 5].map((slot) => ({ slot, seed: 'moonflower', stage: 'sprout' })),
    },
  });
  const plants = bed.getObjectByName('garden-plants');
  assert.equal(plants.children.length, 6);

  const expected = [
    [-0.7, 0.22, -0.3],
    [0, 0.22, -0.3],
    [0.7, 0.22, -0.3],
    [-0.7, 0.22, 0.3],
    [0, 0.22, 0.3],
    [0.7, 0.22, 0.3],
  ];
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const p = plants.children[i].position;
    const [ex, ey, ez] = expected[i];
    assert.ok(Math.abs(p.x - ex) < 1e-9, `slot ${i} x=${p.x}`);
    assert.equal(p.y, ey);
    assert.ok(Math.abs(p.z - ez) < 1e-9, `slot ${i} z=${p.z}`);
    assert.ok(Math.abs(p.x) <= 1.2 && Math.abs(p.z) <= 0.8, `slot ${i} inside bed`);
    seen.add(`${p.x.toFixed(6)},${p.z.toFixed(6)}`);
  }
  assert.equal(seen.size, 6);
});

test('buildGardenBed skips invalid slot entries and handles missing or non-array garden state', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE, {
    garden: {
      slots: [
        { slot: -1, seed: 'moonflower', stage: 'sprout' },
        { slot: 6, seed: 'moonflower', stage: 'sprout' },
        { slot: 1.5, seed: 'moonflower', stage: 'sprout' },
        { seed: 'moonflower', stage: 'sprout' },
        null,
        'not-an-object',
        { slot: 2, seed: 'moonflower', stage: 'sprout' },
      ],
    },
  });
  const plants = bed.getObjectByName('garden-plants');
  assert.equal(plants.children.length, 1);
  assert.ok(Math.abs(plants.children[0].position.x - 0.7) < 1e-9);
  assert.ok(Math.abs(plants.children[0].position.z - -0.3) < 1e-9);

  for (const input of [{}, { garden: null }, { garden: { slots: 'nope' } }]) {
    const b = buildGardenBed(THREE, input);
    const pg = b.getObjectByName('garden-plants');
    assert.ok(pg);
    assert.equal(pg.children.length, 0);
  }
});

test('buildGardenBed y param and frame/soil geometry', () => {
  const THREE = makeFakeThree();
  const defaultBed = buildGardenBed(THREE);
  assert.equal(defaultBed.position.y, 0);
  assert.equal(defaultBed.children.length, 6);

  const raisedBed = buildGardenBed(THREE, { y: 0.25 });
  assert.equal(raisedBed.position.y, 0.25);
  assert.equal(raisedBed.position.x, GARDEN_BED.x);
  assert.equal(raisedBed.position.z, GARDEN_BED.z);
  assert.equal(raisedBed.children.length, 6);

  const soil = raisedBed.getObjectByName('garden-soil');
  assert.ok(soil);
  assert.ok(Math.abs(soil.geometry.args[0] - 2.2) < 1e-9);
  assert.equal(soil.geometry.args[1], 0.22);
  assert.ok(Math.abs(soil.geometry.args[2] - 1.4) < 1e-9);
  assert.equal(soil.position.y, 0.11);
  assert.equal(soil.material.color, '#3b2a1d');

  const north = raisedBed.getObjectByName('garden-frame-north');
  const south = raisedBed.getObjectByName('garden-frame-south');
  const west = raisedBed.getObjectByName('garden-frame-west');
  const east = raisedBed.getObjectByName('garden-frame-east');
  assert.deepEqual(north.geometry.args, [2.4, 0.28, 0.1]);
  assert.equal(north.position.y, 0.14);
  assert.ok(Math.abs(north.position.z - -0.75) < 1e-9);
  assert.ok(Math.abs(south.position.z - 0.75) < 1e-9);

  assert.equal(west.geometry.args[0], 0.1);
  assert.equal(west.geometry.args[1], 0.28);
  assert.ok(Math.abs(west.geometry.args[2] - 1.4) < 1e-9);
  assert.ok(Math.abs(west.position.x - -1.15) < 1e-9);
  assert.ok(Math.abs(east.position.x - 1.15) < 1e-9);
  assert.equal(north.material.color, '#6b492b');
});

test('buildGardenPlant sprout, leaf, and bloom geometry details', () => {
  const THREE = makeFakeThree();

  const sprout = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'sprout' });
  const sl0 = sprout.getObjectByName('plant-sprout-leaf-0');
  const sl1 = sprout.getObjectByName('plant-sprout-leaf-1');
  assert.ok(sl0 && sl1);
  assert.equal(sl0.position.x, -0.04);
  assert.equal(sl0.position.y, 0.02);
  assert.equal(sl0.position.z, 0);
  assert.equal(sl0.rotation.z, 0.35);
  assert.equal(sl1.position.x, 0.04);
  assert.equal(sl1.position.y, 0.02);
  assert.equal(sl1.position.z, 0);
  assert.equal(sl1.rotation.z, -0.35);
  assert.equal(sl0.material.color, '#a8c686');
  assert.deepEqual(sl0.geometry.args, [0.08, 0.02, 0.04]);

  const leaf = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'leaf' });
  const stem = leaf.getObjectByName('plant-stem');
  assert.ok(stem);
  assert.deepEqual(stem.geometry.args, [0.02, 0.028, 0.24, 6]);
  assert.equal(stem.position.y, 0.12);
  assert.equal(stem.material.color, '#5a8f49');
  const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  for (let i = 0; i < 3; i++) {
    const lf = leaf.getObjectByName(`plant-leaf-${i}`);
    assert.ok(lf);
    assert.ok(Math.abs(lf.position.y - (0.14 + i * 0.02)) < 1e-9);
    assert.ok(Math.abs(lf.rotation.y - -angles[i]) < 1e-9);
    assert.equal(lf.rotation.z, 0.3);
    assert.equal(lf.material.color, '#7fb069');
  }

  const bloom = buildGardenPlant(THREE, { seed: 'starwort', stage: 'bloom' });
  const flower = bloom.getObjectByName('plant-flower');
  assert.ok(flower);
  assert.deepEqual(flower.geometry.args, [0.09, 12, 8]);
  assert.equal(flower.position.y, 0.28);
  assert.equal(flower.material.color, '#c9a7eb');
});

test('buildGardenPlant fails soft on unknown seed or stage and keeps the raw name', () => {
  const THREE = makeFakeThree();

  const p1 = buildGardenPlant(THREE, { seed: 'rose', stage: 'bloom' });
  assert.equal(p1.name, 'garden-plant-rose-bloom');
  assert.ok(p1.getObjectByName('plant-sprout-leaf-0'));
  assert.equal(p1.getObjectByName('plant-stem'), null);

  const p2 = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'withered' });
  assert.equal(p2.name, 'garden-plant-moonflower-withered');
  assert.ok(p2.getObjectByName('plant-sprout-leaf-0'));

  const p3 = buildGardenPlant(THREE);
  assert.equal(p3.name, 'garden-plant-unknown-sprout');
  assert.ok(p3.getObjectByName('plant-sprout-leaf-0'));

  const p4 = buildGardenPlant(THREE, { seed: null, stage: 'leaf' });
  assert.equal(p4.name, 'garden-plant-unknown-leaf');
  assert.equal(p4.getObjectByName('plant-stem'), null);
});

test('updateGardenBed replaces plants without duplicating, and handles missing bed or plants group', () => {
  const THREE = makeFakeThree();
  assert.equal(updateGardenBed(THREE, null), null);
  assert.equal(updateGardenBed(THREE, undefined), null);

  const bed = buildGardenBed(THREE, {
    garden: { slots: [{ slot: 0, seed: 'moonflower', stage: 'sprout' }] },
  });
  assert.equal(bed.children.length, 6);

  const next = updateGardenBed(THREE, bed, {
    slots: [
      { slot: 1, seed: 'ghost_bell', stage: 'bloom' },
      { slot: 3, seed: 'silver_thyme', stage: 'leaf' },
    ],
  });
  assert.equal(bed.children.length, 6);
  assert.ok(bed.getObjectByName('garden-soil'));
  assert.ok(bed.getObjectByName('garden-frame-north'));
  assert.equal(next, bed.getObjectByName('garden-plants'));
  assert.equal(next.children.length, 2);
  assert.equal(next.children[0].name, 'garden-plant-ghost_bell-bloom');
  assert.equal(next.children[1].name, 'garden-plant-silver_thyme-leaf');

  const cleared = updateGardenBed(THREE, bed, undefined);
  assert.equal(bed.children.length, 6);
  assert.equal(cleared.children.length, 0);

  const bareBed = new THREE.Group();
  bareBed.name = 'garden-bed';
  const barePlants = updateGardenBed(THREE, bareBed, {
    slots: [{ slot: 0, seed: 'tea_mint', stage: 'sprout' }],
  });
  assert.equal(bareBed.children.length, 1);
  assert.equal(bareBed.children[0], barePlants);
  assert.equal(barePlants.children.length, 1);
});

test('SEED_COLORS is complete and every seed blooms in its own color', () => {
  const entries = Object.entries(SEED_COLORS);
  assert.equal(entries.length, 6);
  const colors = new Set(entries.map(([, c]) => c));
  assert.equal(colors.size, 6);
  for (const [, color] of entries) {
    assert.match(color, /^#[0-9a-f]{6}$/);
  }

  const THREE = makeFakeThree();
  for (const [seed, color] of entries) {
    const bloom = buildGardenPlant(THREE, { seed, stage: 'bloom' });
    const flower = bloom.getObjectByName('plant-flower');
    assert.ok(flower, `missing flower for ${seed}`);
    assert.equal(flower.material.color, color);
  }
});

test('gardenStageForAgeDays boundaries and non-number inputs', () => {
  assert.equal(gardenStageForAgeDays(1.9), 'sprout');
  assert.equal(gardenStageForAgeDays(2), 'leaf');
  assert.equal(gardenStageForAgeDays(3.9), 'leaf');
  assert.equal(gardenStageForAgeDays(4), 'bloom');
  assert.equal(gardenStageForAgeDays(0.5), 'sprout');

  for (const bad of [Infinity, -Infinity, '3', null, undefined]) {
    assert.equal(gardenStageForAgeDays(bad), 'sprout');
  }
});

test('GARDEN_BED is clear of the well and plot 1', () => {
  const wellDist = Math.hypot(GARDEN_BED.x - 6, GARDEN_BED.z - 8);
  assert.ok(Math.abs(wellDist - 8.02) < 0.01, `wellDist=${wellDist}`);
  assert.ok(wellDist >= 7);

  const plot1Dist = Math.hypot(GARDEN_BED.x - 17.92, GARDEN_BED.z - 4.6);
  assert.ok(Math.abs(plot1Dist - 12.31) < 0.01, `plot1Dist=${plot1Dist}`);
  assert.ok(plot1Dist >= 10);
});
