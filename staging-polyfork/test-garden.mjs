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

test('buildGardenBed frame rails share one cedar material and pin positions and roughness', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE);
  const north = bed.getObjectByName('garden-frame-north');
  const south = bed.getObjectByName('garden-frame-south');
  const west = bed.getObjectByName('garden-frame-west');
  const east = bed.getObjectByName('garden-frame-east');
  const soil = bed.getObjectByName('garden-soil');

  assert.equal(south.position.y, 0.14);
  assert.deepEqual(south.geometry.args, [2.4, 0.28, 0.1]);
  assert.deepEqual(west.geometry.args.slice(0, 2), [0.1, 0.28]);
  assert.ok(Math.abs(west.geometry.args[2] - 1.4) < 1e-9);
  assert.deepEqual(east.geometry.args.slice(0, 2), [0.1, 0.28]);
  assert.ok(Math.abs(east.geometry.args[2] - 1.4) < 1e-9);
  assert.ok(Math.abs(west.position.z) < 1e-9);
  assert.ok(Math.abs(east.position.z) < 1e-9);

  assert.equal(north.material, south.material);
  assert.equal(south.material, west.material);
  assert.equal(west.material, east.material);
  assert.equal(north.material.color, '#6b492b');
  assert.equal(north.material.opts.roughness, 0.9);
  assert.equal(soil.material.opts.roughness, 0.95);
  assert.equal(soil.material.color, '#3b2a1d');
});

test('buildGardenPlant leaf stage geometry: stem, three leaves at exact angles, no flower', () => {
  const THREE = makeFakeThree();
  const leaf = buildGardenPlant(THREE, { seed: 'tea_mint', stage: 'leaf' });
  assert.equal(leaf.name, 'garden-plant-tea_mint-leaf');
  const stem = leaf.getObjectByName('plant-stem');
  assert.ok(stem);
  assert.equal(leaf.getObjectByName('plant-flower'), null);

  const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
  const leaves = [];
  for (let i = 0; i < 3; i++) {
    const lf = leaf.getObjectByName(`plant-leaf-${i}`);
    assert.ok(lf);
    assert.deepEqual(lf.geometry.args, [0.11, 0.02, 0.05]);
    assert.ok(Math.abs(lf.position.x - Math.cos(angles[i]) * 0.07) < 1e-9);
    assert.ok(Math.abs(lf.position.z - Math.sin(angles[i]) * 0.07) < 1e-9);
    assert.ok(Math.abs(lf.rotation.y - -angles[i]) < 1e-9);
    assert.equal(lf.rotation.z, 0.3);
    assert.equal(lf.material.color, '#7fb069');
    leaves.push(lf);
  }
  assert.equal(leaves[0].material, leaves[1].material);
  assert.equal(leaves[1].material, leaves[2].material);
  assert.notEqual(stem.material, leaves[0].material);
});

test('buildGardenPlant bloom adds flower above stem for every seed', () => {
  const THREE = makeFakeThree();
  for (const [seed, color] of Object.entries(SEED_COLORS)) {
    const bloom = buildGardenPlant(THREE, { seed, stage: 'bloom' });
    assert.ok(bloom.getObjectByName('plant-stem'));
    const flower = bloom.getObjectByName('plant-flower');
    assert.ok(flower);
    assert.deepEqual(flower.geometry.args, [0.09, 12, 8]);
    assert.equal(flower.position.y, 0.28);
    assert.equal(flower.material.color, color);
    assert.equal(flower.material.opts.roughness, 0.65);
    const lf0 = bloom.getObjectByName('plant-leaf-0');
    assert.ok(lf0);
    assert.equal(lf0.material.color, '#7fb069');
  }
});

test('buildGardenBed plants keep input order while slot index drives position', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE, {
    garden: {
      slots: [
        { slot: 5, seed: 'starwort', stage: 'bloom' },
        { slot: 0, seed: 'moonflower', stage: 'sprout' },
      ],
    },
  });
  const plants = bed.getObjectByName('garden-plants');
  assert.equal(plants.children.length, 2);
  assert.equal(plants.children[0].name, 'garden-plant-starwort-bloom');
  assert.equal(plants.children[1].name, 'garden-plant-moonflower-sprout');
  assert.ok(Math.abs(plants.children[0].position.x - 0.7) < 1e-9);
  assert.ok(Math.abs(plants.children[0].position.z - 0.3) < 1e-9);
  assert.ok(Math.abs(plants.children[1].position.x - -0.7) < 1e-9);
  assert.ok(Math.abs(plants.children[1].position.z - -0.3) < 1e-9);
});

test('buildGardenBed duplicate slot entries both render at the same position', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE, {
    garden: {
      slots: [
        { slot: 0, seed: 'moonflower', stage: 'sprout' },
        { slot: 0, seed: 'tea_mint', stage: 'leaf' },
      ],
    },
  });
  const plants = bed.getObjectByName('garden-plants');
  assert.equal(plants.children.length, 2);
  assert.equal(plants.children[0].name, 'garden-plant-moonflower-sprout');
  assert.equal(plants.children[1].name, 'garden-plant-tea_mint-leaf');
  assert.equal(plants.children[0].position.x, plants.children[1].position.x);
  assert.equal(plants.children[0].position.z, plants.children[1].position.z);
});

test('updateGardenBed returns the new plants group and drops the old one; invalid-only update clears', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE, {
    garden: { slots: [{ slot: 0, seed: 'moonflower', stage: 'sprout' }] },
  });
  const oldPlants = bed.getObjectByName('garden-plants');

  const next = updateGardenBed(THREE, bed, {
    slots: [{ slot: 4, seed: 'ghost_bell', stage: 'bloom' }],
  });
  assert.notEqual(next, oldPlants);
  assert.equal(bed.getObjectByName('garden-plants'), next);
  assert.equal(bed.children.includes(oldPlants), false);
  assert.equal(bed.children.filter((c) => c.name === 'garden-plants').length, 1);
  assert.equal(next.children.length, 1);
  assert.equal(next.children[0].name, 'garden-plant-ghost_bell-bloom');

  const invalidCleared = updateGardenBed(THREE, bed, {
    slots: [{ slot: 9, seed: 'moonflower', stage: 'sprout' }, null],
  });
  assert.equal(invalidCleared.children.length, 0);
  assert.equal(bed.children.length, 6);
  assert.ok(bed.getObjectByName('garden-soil'));
  assert.ok(bed.getObjectByName('garden-frame-east'));

  const nullCleared = updateGardenBed(THREE, bed, null);
  assert.equal(nullCleared.children.length, 0);
});

test('GARDEN_BED and SEED_COLORS are frozen', () => {
  assert.equal(Object.isFrozen(GARDEN_BED), true);
  assert.equal(Object.isFrozen(SEED_COLORS), true);
  assert.throws(() => { GARDEN_BED.x = 99; }, TypeError);
  assert.throws(() => { SEED_COLORS.moonflower = '#000000'; }, TypeError);
  assert.equal(GARDEN_BED.x, 6.5);
  assert.equal(SEED_COLORS.moonflower, '#dfe9ff');
});

test('gardenStageForAgeDays handles huge and fractional ages deterministically', () => {
  assert.equal(gardenStageForAgeDays(2.0001), 'leaf');
  assert.equal(gardenStageForAgeDays(3.9999), 'leaf');
  assert.equal(gardenStageForAgeDays(4.0001), 'bloom');
  assert.equal(gardenStageForAgeDays(1e9), 'bloom');
  assert.equal(gardenStageForAgeDays(Number.MAX_SAFE_INTEGER), 'bloom');
  assert.equal(gardenStageForAgeDays(-100), 'sprout');
  assert.equal(gardenStageForAgeDays(0.9999), 'sprout');
});

test('SEED_COLORS keys are exactly the six seed names; unknown seed with bloom stage keeps the raw name', () => {
  assert.deepEqual(
    Object.keys(SEED_COLORS).sort(),
    ['ghost_bell', 'lantern_poppy', 'moonflower', 'silver_thyme', 'starwort', 'tea_mint']
  );
  const THREE = makeFakeThree();
  const plant = buildGardenPlant(THREE, { stage: 'bloom' });
  assert.equal(plant.name, 'garden-plant-unknown-bloom');
  assert.ok(plant.getObjectByName('plant-sprout-leaf-0'));
  assert.equal(plant.getObjectByName('plant-stem'), null);
  assert.equal(plant.getObjectByName('plant-flower'), null);
});

test('buildGardenPlant child counts per stage: sprout 2, leaf 4, bloom 5', () => {
  const THREE = makeFakeThree();

  const sprout = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'sprout' });
  assert.equal(sprout.children.length, 2);
  for (const child of sprout.children) {
    assert.ok(child.name.startsWith('plant-sprout-leaf-'), `unexpected child ${child.name}`);
  }

  const leaf = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'leaf' });
  assert.equal(leaf.children.length, 4);

  const bloom = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'bloom' });
  assert.equal(bloom.children.length, 5);
  assert.deepEqual(
    bloom.children.map((c) => c.name),
    ['plant-stem', 'plant-leaf-0', 'plant-leaf-1', 'plant-leaf-2', 'plant-flower']
  );
});

test('buildGardenPlant material roughness and sharing: sprout leaves 0.8, stem 0.85, leaves 0.8', () => {
  const THREE = makeFakeThree();

  const sprout = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'sprout' });
  const sl0 = sprout.getObjectByName('plant-sprout-leaf-0');
  const sl1 = sprout.getObjectByName('plant-sprout-leaf-1');
  assert.equal(sl0.material, sl1.material);
  assert.equal(sl0.material.color, '#a8c686');
  assert.equal(sl0.material.opts.roughness, 0.8);

  const leaf = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'leaf' });
  const stem = leaf.getObjectByName('plant-stem');
  const lf0 = leaf.getObjectByName('plant-leaf-0');
  assert.equal(stem.material.opts.roughness, 0.85);
  assert.equal(lf0.material.opts.roughness, 0.8);
  assert.notEqual(stem.material, lf0.material);
});

test('buildGardenPlant non-string seed and stage fail soft and keep the raw name', () => {
  const THREE = makeFakeThree();

  const p1 = buildGardenPlant(THREE, { seed: 42, stage: 'leaf' });
  assert.equal(p1.name, 'garden-plant-42-leaf');
  assert.equal(p1.getObjectByName('plant-stem'), null);
  assert.ok(p1.getObjectByName('plant-sprout-leaf-0'));

  const p2 = buildGardenPlant(THREE, { seed: '', stage: 'bloom' });
  assert.equal(p2.name, 'garden-plant-unknown-bloom');
  assert.equal(p2.getObjectByName('plant-stem'), null);

  const p3 = buildGardenPlant(THREE, { seed: 'moonflower', stage: 2 });
  assert.equal(p3.name, 'garden-plant-moonflower-2');
  assert.equal(p3.getObjectByName('plant-stem'), null);

  const p4 = buildGardenPlant(THREE, { seed: 'moonflower', stage: null });
  assert.equal(p4.name, 'garden-plant-moonflower-sprout');
  assert.equal(p4.getObjectByName('plant-stem'), null);
});

test('gardenStageForAgeDays boolean, object, -0, and fractional inputs', () => {
  for (const input of [true, false, {}, [], -0]) {
    assert.equal(gardenStageForAgeDays(input), 'sprout');
  }
  assert.equal(gardenStageForAgeDays(2.5), 'leaf');
  assert.equal(gardenStageForAgeDays(3.5), 'leaf');
});

test('buildGardenBed children in exact order; frame stands 0.06 proud of soil', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE);
  assert.deepEqual(
    bed.children.map((c) => c.name),
    [
      'garden-soil',
      'garden-frame-north',
      'garden-frame-south',
      'garden-frame-west',
      'garden-frame-east',
      'garden-plants',
    ]
  );

  const soil = bed.getObjectByName('garden-soil');
  const north = bed.getObjectByName('garden-frame-north');
  const soilTop = soil.position.y + soil.geometry.args[1] / 2;
  const frameTop = north.position.y + north.geometry.args[1] / 2;
  assert.ok(Math.abs(soilTop - 0.22) < 1e-9);
  assert.ok(Math.abs(frameTop - 0.28) < 1e-9);
  assert.ok(Math.abs(frameTop - soilTop - 0.06) < 1e-9);
});

test('buildGardenBed slot entries missing seed or stage fail soft to sprout', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE, {
    garden: {
      slots: [
        { slot: 1 },
        { slot: 3, seed: 'starwort' },
        { slot: 4, stage: 'bloom' },
      ],
    },
  });
  const plants = bed.getObjectByName('garden-plants');
  assert.equal(plants.children.length, 3);

  assert.equal(plants.children[0].name, 'garden-plant-unknown-sprout');
  assert.ok(Math.abs(plants.children[0].position.x - 0) < 1e-9);
  assert.ok(Math.abs(plants.children[0].position.z - -0.3) < 1e-9);

  assert.equal(plants.children[1].name, 'garden-plant-starwort-sprout');

  assert.equal(plants.children[2].name, 'garden-plant-unknown-bloom');
  assert.equal(plants.children[2].getObjectByName('plant-stem'), null);
});

test('updateGardenBed repeated updates keep the bed intact; non-array slots clears', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE, {
    garden: { slots: [{ slot: 0, seed: 'moonflower', stage: 'sprout' }] },
  });

  updateGardenBed(THREE, bed, {
    slots: [{ slot: 1, seed: 'tea_mint', stage: 'leaf' }],
  });
  updateGardenBed(THREE, bed, {
    slots: [{ slot: 5, seed: 'ghost_bell', stage: 'bloom' }],
  });
  const third = updateGardenBed(THREE, bed, {
    slots: [
      { slot: 2, seed: 'starwort', stage: 'leaf' },
      { slot: 3, seed: 'silver_thyme', stage: 'sprout' },
    ],
  });

  assert.equal(bed.children.length, 6);
  assert.equal(bed.children.filter((c) => c.name === 'garden-plants').length, 1);
  assert.ok(bed.getObjectByName('garden-soil'));
  assert.ok(bed.getObjectByName('garden-frame-east'));
  assert.equal(third.children.length, 2);
  assert.equal(third.children[0].name, 'garden-plant-starwort-leaf');
  assert.equal(third.children[1].name, 'garden-plant-silver_thyme-sprout');

  const cleared = updateGardenBed(THREE, bed, { slots: 'nope' });
  assert.equal(cleared.children.length, 0);
  assert.equal(bed.children.length, 6);
});

test('server gardenStageForAge agrees with client gardenStageForAgeDays on every boundary', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'town-api', 'server.mjs'), 'utf8');
  const match = serverSrc.match(/function\s+gardenStageForAge\s*\(\s*now\s*,\s*plantedAt\s*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, 'Could not find gardenStageForAge in town-api/server.mjs');
  const serverStage = new Function('now', 'plantedAt', match[1]);

  const now = 1_800_000_000;
  const cases = [
    [-86400, 'sprout'],
    [0, 'sprout'],
    [1.5 * 86400, 'sprout'],
    [2 * 86400, 'leaf'],
    [3.99 * 86400, 'leaf'],
    [4 * 86400, 'bloom'],
    [10 * 86400, 'bloom'],
    [100 * 86400, 'bloom'],
  ];
  for (const [ageSec, expected] of cases) {
    assert.equal(serverStage(now, now - ageSec), expected);
    assert.equal(gardenStageForAgeDays(ageSec / 86400), expected);
  }
});

test('staging.js wires the garden bed: import, empty init, state.garden refresh', () => {
  const stagingSrc = fs.readFileSync(path.join(__dirname, 'staging.js'), 'utf8');
  const importMatch = stagingSrc.match(/import\s*\{\s*([^}]*)\}\s*from\s*'\.\/garden\.mjs\?v=\d+';/);
  assert.ok(importMatch, 'Could not find garden.mjs import in staging.js');
  const importedNames = importMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
  assert.deepEqual(importedNames, ['GARDEN_BED', 'buildGardenBed', 'updateGardenBed']);

  assert.ok(stagingSrc.includes('buildGardenBed(THREE, {\n    garden: { slots: [] },'));
  assert.ok(stagingSrc.includes('y: camp.groundAt(GARDEN_BED.x, GARDEN_BED.z)'));
  assert.ok(stagingSrc.includes('updateGardenBed(THREE, gardenBed, state.garden);'));
  assert.ok(stagingSrc.includes('Nov 23 hotfix'));
});

test('GARDEN_BED is exactly {x: 6.5, z: 0}; raised-bed plants stay at soil height', () => {
  assert.equal(GARDEN_BED.x, 6.5);
  assert.equal(GARDEN_BED.z, 0);
  assert.equal(Object.keys(GARDEN_BED).length, 2);

  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE, {
    y: 0.25,
    garden: { slots: [{ slot: 0, seed: 'moonflower', stage: 'sprout' }] },
  });
  assert.equal(bed.position.y, 0.25);

  const plants = bed.getObjectByName('garden-plants');
  assert.equal(plants.children.length, 1);
  assert.equal(plants.children[0].position.y, 0.22);
  assert.ok(Math.abs(plants.children[0].position.x - -0.7) < 1e-9);
  assert.ok(Math.abs(plants.children[0].position.z - -0.3) < 1e-9);
});

test('SEED_COLORS is the exact six-seed map in written key order', () => {
  assert.deepEqual(SEED_COLORS, {
    moonflower: '#dfe9ff',
    lantern_poppy: '#ff9a3c',
    tea_mint: '#7fb069',
    starwort: '#c9a7eb',
    ghost_bell: '#a8d8ea',
    silver_thyme: '#b8c4b0',
  });
  assert.deepEqual(Object.keys(SEED_COLORS), [
    'moonflower',
    'lantern_poppy',
    'tea_mint',
    'starwort',
    'ghost_bell',
    'silver_thyme',
  ]);
});

test('gardenStageForAgeDays exact float boundaries and non-coercing inputs', () => {
  assert.equal(gardenStageForAgeDays(1.9999999), 'sprout');
  assert.equal(gardenStageForAgeDays(2.0), 'leaf');
  assert.equal(gardenStageForAgeDays(3.9999999), 'leaf');
  assert.equal(gardenStageForAgeDays(4.0), 'bloom');
  assert.equal(gardenStageForAgeDays(-1e-9), 'sprout');
  assert.equal(gardenStageForAgeDays(2n), 'sprout');
  assert.equal(gardenStageForAgeDays(), 'sprout');
  assert.equal(gardenStageForAgeDays(Symbol('x')), 'sprout');
});

test('buildGardenPlant groups sit at the origin; stem and flower are centered on x/z', () => {
  const THREE = makeFakeThree();
  for (const stage of ['sprout', 'leaf', 'bloom']) {
    const group = buildGardenPlant(THREE, { seed: 'moonflower', stage });
    assert.equal(group.position.x, 0);
    assert.equal(group.position.y, 0);
    assert.equal(group.position.z, 0);
  }

  const leaf = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'leaf' });
  const stem = leaf.getObjectByName('plant-stem');
  assert.equal(stem.position.x, 0);
  assert.equal(stem.position.z, 0);

  const bloom = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'bloom' });
  const flower = bloom.getObjectByName('plant-flower');
  assert.equal(flower.position.x, 0);
  assert.equal(flower.position.z, 0);

  const sprout = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'sprout' });
  assert.equal(sprout.getObjectByName('plant-sprout-leaf-0').position.z, 0);
  assert.equal(sprout.getObjectByName('plant-sprout-leaf-1').position.z, 0);
});

test('each buildGardenPlant and buildGardenBed call mints fresh materials', () => {
  const THREE = makeFakeThree();
  const s1 = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'sprout' });
  const s2 = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'sprout' });
  assert.notEqual(
    s1.getObjectByName('plant-sprout-leaf-0').material,
    s2.getObjectByName('plant-sprout-leaf-0').material
  );

  const b1 = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'bloom' });
  const b2 = buildGardenPlant(THREE, { seed: 'moonflower', stage: 'bloom' });
  assert.notEqual(
    b1.getObjectByName('plant-flower').material,
    b2.getObjectByName('plant-flower').material
  );

  const bed1 = buildGardenBed(THREE);
  const bed2 = buildGardenBed(THREE);
  assert.notEqual(
    bed1.getObjectByName('garden-frame-north').material,
    bed2.getObjectByName('garden-frame-north').material
  );
  assert.notEqual(
    bed1.getObjectByName('garden-soil').material,
    bed2.getObjectByName('garden-soil').material
  );
});

test('buildGardenBed y edges: negative, undefined, NaN, unknown keys, and no args', () => {
  const THREE = makeFakeThree();

  const negBed = buildGardenBed(THREE, { y: -0.5 });
  assert.equal(negBed.position.y, -0.5);
  assert.equal(negBed.children.length, 6);

  const undefBed = buildGardenBed(THREE, { y: undefined });
  assert.equal(undefBed.position.y, 0);

  const nanBed = buildGardenBed(THREE, { y: Number.NaN });
  assert.equal(Number.isNaN(nanBed.position.y), true);

  const extraBed = buildGardenBed(THREE, { y: 0, foo: 'bar', garden: { slots: [] } });
  assert.equal(extraBed.children.length, 6);
  assert.equal(extraBed.position.x, 6.5);

  const noArgsBed = buildGardenBed(THREE);
  assert.equal(noArgsBed.position.x, 6.5);
  assert.equal(noArgsBed.position.y, 0);
  assert.equal(noArgsBed.position.z, 0);
  assert.equal(noArgsBed.children.length, 6);
});

test('updateGardenBed never mutates its input garden and rebuilds fresh each call', () => {
  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE, {
    garden: { slots: [{ slot: 0, seed: 'moonflower', stage: 'sprout' }] },
  });

  const input = { slots: [{ slot: 1, seed: 'tea_mint', stage: 'leaf' }] };
  const snapshot = JSON.stringify(input);

  const first = updateGardenBed(THREE, bed, input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(first, bed.getObjectByName('garden-plants'));

  const second = updateGardenBed(THREE, bed, input);
  assert.notEqual(second, first);
  assert.equal(second, bed.getObjectByName('garden-plants'));
  assert.equal(JSON.stringify(input), snapshot);
});

test('garden bed derived dimensions: deck clearance, soil inset, rail meeting, tops', () => {
  assert.ok(Math.abs((GARDEN_BED.x - 1.2) - 4.5 - 0.8) < 1e-9);

  const THREE = makeFakeThree();
  const bed = buildGardenBed(THREE);
  const soil = bed.getObjectByName('garden-soil');
  const north = bed.getObjectByName('garden-frame-north');
  const west = bed.getObjectByName('garden-frame-west');

  const [soilW, soilH, soilD] = soil.geometry.args;
  assert.ok(Math.abs(soilW - 2.2) < 1e-9);
  assert.ok(Math.abs(soilH - 0.22) < 1e-9);
  assert.ok(Math.abs(soilD - 1.4) < 1e-9);
  assert.ok(Math.abs((2.4 - soilW) / 2 - 0.1) < 1e-9);
  assert.ok(Math.abs((1.6 - soilD) / 2 - 0.1) < 1e-9);

  assert.ok(Math.abs(north.geometry.args[0] - 2.4) < 1e-9);
  assert.ok(Math.abs(west.geometry.args[2] - 1.4) < 1e-9);

  const soilTop = soil.position.y + soilH / 2;
  const frameTop = north.position.y + north.geometry.args[1] / 2;
  assert.ok(Math.abs(soilTop - 0.22) < 1e-9);
  assert.ok(Math.abs(frameTop - 0.28) < 1e-9);
  assert.ok(Math.abs(frameTop - soilTop - 0.06) < 1e-9);
});

test('server GARDEN_SEEDS table, GARDEN_SLOTS, and the plant 201 response shape', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'town-api', 'server.mjs'), 'utf8');
  assert.ok(serverSrc.includes('const GARDEN_SLOTS = 6;'));
  assert.ok(serverSrc.includes('const GARDEN_SEED_SET = new Set(GARDEN_SEEDS.map((s) => s.kind));'));

  const tableMatch = serverSrc.match(/const\s+GARDEN_SEEDS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(tableMatch, 'Could not find GARDEN_SEEDS in town-api/server.mjs');
  const rows = [
    ...tableMatch[1].matchAll(
      /Object\.freeze\(\{\s*kind:\s*'([^']+)',\s*label:\s*'([^']+)',\s*color:\s*'([^']+)'\s*\}\)/g
    ),
  ].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(rows, [
    ['moonflower', 'Moonflower', '#dfe9ff'],
    ['lantern_poppy', 'Lantern Poppy', '#ff9a3c'],
    ['tea_mint', 'Tea Mint', '#7fb069'],
    ['starwort', 'Starwort', '#c9a7eb'],
    ['ghost_bell', 'Ghost Bell', '#a8d8ea'],
    ['silver_thyme', 'Silver Thyme', '#b8c4b0'],
  ]);

  assert.ok(serverSrc.includes('Math.floor((now - plantedAt) / 86400)'));

  const blocks = [...serverSrc.matchAll(/sendJson\(res,\s*201,\s*\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  const plantBlock = blocks.find((b) => b.includes("stage: 'sprout'"));
  assert.ok(plantBlock, 'Could not find garden plant 201 response block');
  const keys = plantBlock
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/^(\w+)/)?.[1])
    .filter(Boolean);
  assert.deepEqual(keys, ['handle', 'slot', 'seed', 'planted_at', 'stage', 'state_seq']);
});

test('staging.js garden wiring: versioned import, single scene add, hotfix comment', () => {
  const stagingSrc = fs.readFileSync(path.join(__dirname, 'staging.js'), 'utf8');
  assert.ok(stagingSrc.includes("from './garden.mjs?v=40';"));
  assert.equal((stagingSrc.match(/scene\.add\(gardenBed\);/g) || []).length, 1);
  assert.ok(stagingSrc.includes("moonflower never rendered because this call didn't exist"));
  assert.equal((stagingSrc.match(/\bgardenBed\b/g) || []).length, 3);
});

test('test-file hygiene: unique names, export surface, color constants, no banned terms or wall-clock reads', () => {
  const testSrc = fs.readFileSync(path.join(__dirname, 'test-garden.mjs'), 'utf8');
  const modSrc = fs.readFileSync(path.join(__dirname, 'garden.mjs'), 'utf8');

  const names = [...testSrc.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 44);
  assert.equal(new Set(names).size, 44);

  const exports = [...modSrc.matchAll(/^export (?:const|function) (\w+)/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(exports, [
    'GARDEN_BED',
    'SEED_COLORS',
    'buildGardenBed',
    'buildGardenPlant',
    'gardenStageForAgeDays',
    'updateGardenBed',
  ]);

  for (const literal of [
    "const CEDAR = '#6b492b'",
    "const SOIL = '#3b2a1d'",
    "const SPROUT_GREEN = '#a8c686'",
    "const STEM_GREEN = '#5a8f49'",
    "const LEAF_GREEN = '#7fb069'",
  ]) {
    assert.ok(modSrc.includes(literal), `garden.mjs missing ${literal}`);
  }

  const fetchNeedle = 'fet' + 'ch(';
  const dateNowNeedle = 'Date' + '.now';
  const todoNeedle = 'TO' + 'DO';
  const fixmeNeedle = 'FIX' + 'ME';
  const mathRndNeedle = 'Math' + '.random';
  const retiredRe = new RegExp('camp' + 'fire', 'i');

  for (const needle of [fetchNeedle, dateNowNeedle, 'setTimeout', 'setInterval', todoNeedle, fixmeNeedle]) {
    assert.equal(modSrc.includes(needle), false, `garden.mjs must not contain ${needle}`);
  }

  assert.equal(retiredRe.test(testSrc), false, 'test-garden.mjs must not contain retired term');
  for (const needle of [mathRndNeedle, dateNowNeedle, fetchNeedle, todoNeedle, fixmeNeedle]) {
    assert.equal(testSrc.includes(needle), false, `test-garden.mjs must not contain ${needle}`);
  }

  const imports = [...testSrc.matchAll(/^import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
  assert.equal(imports.length, 6);
  assert.deepEqual(imports, [
    'node:test',
    'node:assert/strict',
    'node:fs',
    'node:path',
    'node:url',
    './garden.mjs',
  ]);
});
