import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findFishingSpot, buildFishingSpot } from './fishing.mjs';

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
  class RingGeometry {
    constructor(innerR, outerR, seg) {
      this.type = 'RingGeometry';
      this.args = [innerR, outerR, seg];
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
    RingGeometry,
    MeshStandardMaterial,
    Mesh,
    Group,
  };
}

// Stub cone island: land inside r < 38 (slope down from center), water outside.
function coneIslandGroundAt(x, z) {
  const r = Math.hypot(x, z);
  return 10.0 - (r / 38) * 10.0;
}

test('findFishingSpot locates shore crossing on stub island with dry feet and bobber over water', () => {
  const waterY = 0;
  const groundY = -3;
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY, groundY });
  assert.ok(spot, 'Expected a valid spot on the stub cone island');
  assert.ok(spot.r >= 25 && spot.r <= 50, `Expected radius in [25, 50], got ${spot.r}`);
  assert.ok(
    coneIslandGroundAt(spot.x, spot.z) >= waterY + 0.3,
    'Spot ground must be at least waterY + 0.3'
  );

  // Build group and verify bobber world position is over water (ground < waterY)
  const THREE = makeFakeThree();
  const group = buildFishingSpot(THREE, spot, { waterY });
  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber, 'Group must contain bobber');
  const bobberWorldX = group.position.x + bobber.position.z * Math.sin(group.rotation.y);
  const bobberWorldZ = group.position.z + bobber.position.z * Math.cos(group.rotation.y);
  assert.ok(
    coneIslandGroundAt(bobberWorldX, bobberWorldZ) < waterY,
    'Bobber must sit out over water where groundAt < waterY'
  );
});

test('findFishingSpot returns null for all-land and all-water stubs', () => {
  assert.equal(
    findFishingSpot({ groundAt: () => 2.0, waterY: 0, groundY: -3 }),
    null,
    'All-land stub must return null'
  );
  assert.equal(
    findFishingSpot({ groundAt: () => -1.0, waterY: 0, groundY: -3 }),
    null,
    'All-water stub must return null'
  );
});

test('buildFishingSpot creates fishing-spot group with rod, tackle box, line, bobber, and 3 ripples', () => {
  const THREE = makeFakeThree();
  const waterY = 0.5;
  const spot = findFishingSpot({
    groundAt: (x, z) => 10.5 - (Math.hypot(x, z) / 38) * 10.0,
    waterY,
    groundY: -3,
  });
  assert.ok(spot);

  const group = buildFishingSpot(THREE, spot, {
    waterY,
    createRod: () => {
      const g = new THREE.Group();
      g.name = 'propped-fishing-rod';
      return g;
    },
    createTackleBox: () => {
      const g = new THREE.Group();
      g.name = 'tackle-box';
      return g;
    },
  });

  assert.equal(group.name, 'fishing-spot');
  assert.ok(group.getObjectByName('propped-fishing-rod'));
  assert.ok(group.getObjectByName('tackle-box'));
  assert.ok(group.getObjectByName('fishing-line'));

  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber);
  const bobberWorldY = group.position.y + bobber.position.y;
  assert.ok(Math.abs(bobberWorldY - (waterY + 0.05)) < 1e-9);

  const expectedRadii = [0.3, 0.6, 0.9];
  for (let i = 0; i < 3; i++) {
    const ripple = group.getObjectByName(`ripple-${i}`);
    assert.ok(ripple, `Missing ripple-${i}`);
    const rippleWorldY = group.position.y + ripple.position.y;
    assert.ok(Math.abs(rippleWorldY - (waterY + 0.02)) < 1e-9);
    assert.equal(ripple.position.x, bobber.position.x);
    assert.equal(ripple.position.z, bobber.position.z);
    assert.equal(ripple.geometry.type, 'RingGeometry');
    assert.equal(ripple.geometry.args[1], expectedRadii[i]);
  }
});

test('fishing.mjs and test-fishing.mjs contain no random PRNG and no forbidden terms', () => {
  const modSrc = fs.readFileSync(path.join(__dirname, 'fishing.mjs'), 'utf8');
  const testSrc = fs.readFileSync(path.join(__dirname, 'test-fishing.mjs'), 'utf8');
  const mathRndRe = new RegExp('Math\\.' + 'random');
  const forbiddenRe = new RegExp('camp\\s*' + 'fire', 'i');
  for (const [label, src] of [['fishing.mjs', modSrc], ['test-fishing.mjs', testSrc]]) {
    assert.equal(mathRndRe.test(src), false, `${label} must not use Math random`);
    assert.equal(forbiddenRe.test(src), false, `${label} must not mention forbidden term`);
  }
});

test('findFishingSpot exact shore-crossing math on the cone stub', () => {
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.equal(spot.r, 36.5);
  assert.equal(spot.shoreR, 38.0);
  assert.ok(Math.abs(spot.x - Math.sin(Math.PI / 4) * 36.5) < 1e-9);
  assert.ok(Math.abs(spot.z - Math.cos(Math.PI / 4) * 36.5) < 1e-9);
  assert.ok(Math.abs(spot.y - coneIslandGroundAt(spot.x, spot.z)) < 1e-9);
  assert.equal(spot.bearingRad, Math.PI / 4);
  assert.equal(spot.dirX, Math.sin(Math.PI / 4));
  assert.equal(spot.dirZ, Math.cos(Math.PI / 4));
});

test('findFishingSpot returns null for invalid inputs', () => {
  assert.equal(findFishingSpot({ groundAt: null, waterY: 0, groundY: -3 }), null);
  assert.equal(findFishingSpot({ groundAt: coneIslandGroundAt, waterY: NaN, groundY: -3 }), null);
  assert.equal(findFishingSpot({ groundAt: coneIslandGroundAt, waterY: '0', groundY: -3 }), null);
  assert.equal(findFishingSpot({ groundAt: () => NaN, waterY: 0, groundY: -3 }), null);
  assert.equal(findFishingSpot({ groundAt: () => Infinity, waterY: 0, groundY: -3 }), null);
});

test('findFishingSpot returns null when the crossing is outside the radius bounds', () => {
  assert.equal(
    findFishingSpot({
      groundAt: (x, z) => 5.0 - (Math.hypot(x, z) / 20) * 5.0,
      waterY: 0,
      groundY: -3,
    }),
    null
  );
  assert.equal(
    findFishingSpot({
      groundAt: (x, z) => 11.0 - (Math.hypot(x, z) / 55) * 11.0,
      waterY: 0,
      groundY: -3,
    }),
    null
  );
  assert.equal(
    findFishingSpot({
      groundAt: (x, z) => 10.4 - (Math.hypot(x, z) / 52) * 10.4,
      waterY: 0,
      groundY: -3,
    }),
    null
  );
});

test('findFishingSpot returns null when dry feet fails', () => {
  const plateauGroundAt = (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 30) return 2.0;
    if (r < 40) return 0.2;
    return -1.0;
  };
  assert.equal(findFishingSpot({ groundAt: plateauGroundAt, waterY: 0, groundY: -3 }), null);
});

test('findFishingSpot groundY guard rejects a spot at or below the lake bed', () => {
  assert.equal(findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: 0.5 }), null);
  const okSpot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: 0.38 });
  assert.ok(okSpot);
  assert.equal(okSpot.r, 36.5);
});

test('findFishingSpot is deterministic across calls', () => {
  const a = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  const b = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.deepEqual(a, b);
});

test('buildFishingSpot defaults create named rod and tackle box at expected positions', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  const group = buildFishingSpot(THREE, spot, { waterY: 0 });
  assert.equal(group.name, 'fishing-spot');
  assert.ok(Math.abs(group.position.x - spot.x) < 1e-9);
  assert.ok(Math.abs(group.position.y - spot.y) < 1e-9);
  assert.ok(Math.abs(group.position.z - spot.z) < 1e-9);
  assert.equal(group.rotation.y, Math.PI / 4);

  const rod = group.getObjectByName('propped-fishing-rod');
  assert.ok(rod);
  assert.deepEqual([rod.position.x, rod.position.y, rod.position.z], [0, 0, 0]);

  const box = group.getObjectByName('tackle-box');
  assert.ok(box);
  assert.deepEqual([box.position.x, box.position.y, box.position.z], [-0.55, 0, -0.25]);
});

test('buildFishingSpot line geometry connects rod tip to bobber', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  const group = buildFishingSpot(THREE, spot, { waterY: 0 });
  const bobberY = 0 - spot.y + 0.05;
  const dy = bobberY - 0.95;
  const dz = 2.5 - 0.75;

  const line = group.getObjectByName('fishing-line');
  assert.ok(line);
  assert.equal(line.geometry.type, 'CylinderGeometry');
  assert.equal(line.geometry.args[0], 0.008);
  assert.equal(line.geometry.args[1], 0.008);
  assert.ok(Math.abs(line.geometry.args[2] - Math.hypot(dy, dz)) < 1e-9);
  assert.equal(line.geometry.args[3], 6);
  assert.ok(Math.abs(line.rotation.x - Math.atan2(dz, dy)) < 1e-9);
  assert.ok(Math.abs(line.position.y - (0.95 + bobberY) / 2) < 1e-9);
  assert.ok(Math.abs(line.position.z - (0.75 + 2.5) / 2) < 1e-9);
  assert.equal(line.material.color, '#6b492b');
  assert.equal(line.material.opts.roughness, 0.9);

  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber);
  assert.equal(bobber.geometry.type, 'SphereGeometry');
  assert.deepEqual(bobber.geometry.args, [0.06, 12, 8]);
  assert.equal(bobber.material.color, '#f5efe0');
});

test('buildFishingSpot ripples share the bobber material and sit at the bobber', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  const group = buildFishingSpot(THREE, spot, { waterY: 0 });
  const bobber = group.getObjectByName('bobber');
  const outers = [0.3, 0.6, 0.9];
  for (let i = 0; i < 3; i++) {
    const ripple = group.getObjectByName(`ripple-${i}`);
    assert.ok(ripple);
    assert.equal(ripple.geometry.type, 'RingGeometry');
    assert.deepEqual(ripple.geometry.args, [outers[i] - 0.025, outers[i], 24]);
    assert.equal(ripple.rotation.x, -Math.PI / 2);
    assert.equal(ripple.material, bobber.material);
    assert.equal(ripple.position.x, bobber.position.x);
    assert.equal(ripple.position.z, bobber.position.z);
  }
  assert.equal(group.children.length, 7);
});

function stepStub(edge) {
  return (x, z) => (Math.hypot(x, z) < edge ? 2.0 : -1.0);
}

test('findFishingSpot radius bounds are inclusive at both ends, exclusive just outside', () => {
  const minSpot = findFishingSpot({ groundAt: stepStub(26.6), waterY: 0, groundY: -3 });
  assert.ok(minSpot);
  assert.equal(minSpot.r, 25);
  assert.equal(minSpot.shoreR, 26.5);

  const maxSpot = findFishingSpot({ groundAt: stepStub(51.6), waterY: 0, groundY: -3 });
  assert.ok(maxSpot);
  assert.equal(maxSpot.r, 50);
  assert.equal(maxSpot.shoreR, 51.5);

  assert.equal(findFishingSpot({ groundAt: stepStub(26.35), waterY: 0, groundY: -3 }), null);
  assert.equal(findFishingSpot({ groundAt: stepStub(51.85), waterY: 0, groundY: -3 }), null);
});

test('findFishingSpot dry-feet boundary: exactly waterY + 0.3 passes, 0.29 fails', () => {
  const bandStub = (mid) => (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 30) return 2.0;
    if (r < 37.9) return mid;
    return -1.0;
  };

  const passSpot = findFishingSpot({ groundAt: bandStub(0.3), waterY: 0, groundY: -3 });
  assert.ok(passSpot);
  assert.equal(passSpot.r, 36.25);

  assert.equal(findFishingSpot({ groundAt: bandStub(0.29), waterY: 0, groundY: -3 }), null);
});

test('findFishingSpot groundY boundary: y equal to groundY + 0.01 is rejected, just above passes', () => {
  const baseSpot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(baseSpot);
  const ySpot = coneIslandGroundAt(baseSpot.x, baseSpot.z);

  assert.equal(
    findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: ySpot - 0.01 }),
    null
  );

  const passSpot = findFishingSpot({
    groundAt: coneIslandGroundAt,
    waterY: 0,
    groundY: ySpot - 0.01 - 1e-9,
  });
  assert.ok(passSpot);
  assert.equal(passSpot.r, 36.5);
});

test('findFishingSpot accepts different water levels', () => {
  const lowWater = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: -2, groundY: -3 });
  assert.ok(lowWater);
  assert.equal(lowWater.r, 44);
  assert.equal(lowWater.shoreR, 45.5);

  const highWater = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 2, groundY: -3 });
  assert.ok(highWater);
  assert.equal(highWater.r, 28.75);
  assert.equal(highWater.shoreR, 30.25);
});

test('findFishingSpot returns null when the crossing is at or beyond the search limit', () => {
  for (const edge of [60, 70, 60.25]) {
    assert.equal(
      findFishingSpot({
        groundAt: (x, z) => 10.0 - (Math.hypot(x, z) / edge) * 10.0,
        waterY: 0,
        groundY: -3,
      }),
      null
    );
  }
});

test('findFishingSpot pins the shore to the last sampled land radius', () => {
  const spot = findFishingSpot({ groundAt: stepStub(37.9), waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.equal(spot.shoreR, 37.75);
  assert.equal(spot.r, 36.25);
});

test('findFishingSpot without groundY skips the lake-bed guard', () => {
  for (const opts of [{ waterY: 0 }, { waterY: 0, groundY: NaN }, { waterY: 0, groundY: 'deep' }]) {
    const spot = findFishingSpot({ groundAt: coneIslandGroundAt, ...opts });
    assert.ok(spot);
    assert.equal(spot.r, 36.5);
  }
});

test('buildFishingSpot places bobber and ripples at the water level for any waterY', () => {
  const THREE = makeFakeThree();
  const spot = {
    x: 1,
    y: 0.4,
    z: 2,
    r: 36.5,
    shoreR: 38,
    bearingRad: Math.PI / 4,
    dirX: Math.sin(Math.PI / 4),
    dirZ: Math.cos(Math.PI / 4),
  };

  for (const waterY of [1.5, -1]) {
    const group = buildFishingSpot(THREE, spot, { waterY });
    assert.equal(group.position.x, spot.x);
    assert.equal(group.position.y, spot.y);
    assert.equal(group.position.z, spot.z);
    assert.equal(group.rotation.y, Math.PI / 4);

    const bobber = group.getObjectByName('bobber');
    assert.ok(bobber);
    const expectedBobberY = waterY - 0.4 + 0.05;
    assert.ok(Math.abs(bobber.position.y - expectedBobberY) < 1e-9);
    assert.ok(Math.abs(group.position.y + bobber.position.y - (waterY + 0.05)) < 1e-9);

    const ripple1 = group.getObjectByName('ripple-1');
    assert.ok(ripple1);
    assert.ok(Math.abs(group.position.y + ripple1.position.y - (waterY + 0.02)) < 1e-9);

    const line = group.getObjectByName('fishing-line');
    assert.ok(line);
    assert.ok(Math.abs(line.geometry.args[2] - Math.hypot(expectedBobberY - 0.95, 2.5 - 0.75)) < 1e-9);
    assert.ok(Math.abs(line.rotation.x - Math.atan2(2.5 - 0.75, expectedBobberY - 0.95)) < 1e-9);
  }
});

test('buildFishingSpot uses custom factories verbatim and renames them', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);

  const customRod = new THREE.Group();
  customRod.name = 'my-rod';
  const customBox = new THREE.Group();
  customBox.name = 'my-box';

  const group = buildFishingSpot(THREE, spot, {
    waterY: 0,
    createRod: () => customRod,
    createTackleBox: () => customBox,
  });

  const rod = group.getObjectByName('propped-fishing-rod');
  assert.equal(rod, customRod);
  assert.equal(rod.name, 'propped-fishing-rod');
  assert.deepEqual([rod.position.x, rod.position.y, rod.position.z], [0, 0, 0]);

  const box = group.getObjectByName('tackle-box');
  assert.equal(box, customBox);
  assert.equal(box.name, 'tackle-box');
  assert.deepEqual([box.position.x, box.position.y, box.position.z], [-0.55, 0, -0.25]);

  assert.equal(group.children.length, 7);
});
