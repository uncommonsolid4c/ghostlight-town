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

test('findFishingSpot treats ground exactly at waterY as land, not a crossing', () => {
  const groundAt = (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 37.1) return 2.0;
    if (r < 38.1) return 0.0;
    return -1.0;
  };
  const spot = findFishingSpot({ groundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.equal(spot.shoreR, 38.0);
  assert.equal(spot.r, 36.5);
  assert.equal(spot.y, 2.0);
});

test('findFishingSpot returns null when ground never drops below waterY', () => {
  assert.equal(findFishingSpot({ groundAt: () => 0.0, waterY: 0, groundY: -3 }), null);
  assert.equal(findFishingSpot({ groundAt: () => 0.5, waterY: 0, groundY: -3 }), null);
  assert.equal(findFishingSpot({ groundAt: () => -0.5, waterY: -0.5, groundY: -3 }), null);
});

test('findFishingSpot takes the first shore crossing, not a later one', () => {
  const groundAt = (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 30.1) return 2.0;
    if (r < 35.1) return -1.0;
    if (r < 50.1) return 2.0;
    return -1.0;
  };
  const spot = findFishingSpot({ groundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.equal(spot.r, 28.5);
  assert.equal(spot.shoreR, 30.0);
  assert.equal(spot.y, 2.0);
});

test('findFishingSpot returns null for a missing options object', () => {
  assert.equal(findFishingSpot({}), null);
  assert.equal(findFishingSpot({ groundAt: coneIslandGroundAt }), null);
  assert.equal(findFishingSpot({ waterY: 0, groundY: -3 }), null);
});

test('findFishingSpot returns null when the crossing is at the first sampled radius', () => {
  const groundAt = (x, z) => (Math.hypot(x, z) < 9.9 ? 2.0 : -1.0);
  assert.equal(findFishingSpot({ groundAt, waterY: 0, groundY: -3 }), null);
});

test('buildFishingSpot lays children out in rod, box, line, bobber, ripples order', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  const group = buildFishingSpot(THREE, spot, { waterY: 0 });
  assert.deepEqual(
    group.children.map((c) => c.name),
    ['propped-fishing-rod', 'tackle-box', 'fishing-line', 'bobber', 'ripple-0', 'ripple-1', 'ripple-2']
  );
  const rod = group.getObjectByName('propped-fishing-rod');
  const box = group.getObjectByName('tackle-box');
  assert.ok(rod instanceof THREE.Group);
  assert.ok(box instanceof THREE.Group);
  assert.notEqual(rod, box);
  assert.equal(group.rotation.x, 0);
  assert.equal(group.rotation.z, 0);
});

test('buildFishingSpot follows the spot bearing, not the module constant', () => {
  const THREE = makeFakeThree();
  for (const bearingRad of [Math.PI / 2, -Math.PI / 6]) {
    const spot = {
      x: 1,
      y: 0.4,
      z: 2,
      r: 36.5,
      shoreR: 38,
      bearingRad,
      dirX: Math.sin(bearingRad),
      dirZ: Math.cos(bearingRad),
    };
    const group = buildFishingSpot(THREE, spot, { waterY: 0 });
    assert.equal(group.rotation.y, bearingRad);
    const bobber = group.getObjectByName('bobber');
    assert.ok(bobber);
    assert.equal(bobber.position.x, 0);
    assert.equal(bobber.position.z, 2.5);
  }
});

test('buildFishingSpot line is vertical in Y when the bobber sits at rod-tip height', () => {
  const THREE = makeFakeThree();
  const spot = {
    x: 0,
    y: 0,
    z: 0,
    r: 36.5,
    shoreR: 38,
    bearingRad: Math.PI / 4,
    dirX: Math.sin(Math.PI / 4),
    dirZ: Math.cos(Math.PI / 4),
  };
  const group = buildFishingSpot(THREE, spot, { waterY: 0.9 });
  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber);
  assert.ok(Math.abs(bobber.position.y - 0.95) < 1e-9);
  assert.equal(bobber.position.x, 0);
  assert.equal(bobber.position.z, 2.5);

  const line = group.getObjectByName('fishing-line');
  assert.ok(line);
  assert.deepEqual(line.geometry.args, [0.008, 0.008, 1.75, 6]);
  assert.ok(Math.abs(line.rotation.x - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(line.position.y - 0.95) < 1e-9);
  assert.equal(line.position.z, 1.625);
  assert.equal(line.position.x, 0);
});

test('buildFishingSpot bobber material is cream at roughness 0.7 and the bobber sits 2.5 m out', () => {
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
  const group = buildFishingSpot(THREE, spot, { waterY: 0.5 });

  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber);
  assert.ok(Math.abs(bobber.position.y - 0.15) < 1e-9);
  assert.equal(bobber.position.x, 0);
  assert.equal(bobber.position.z, 2.5);
  assert.equal(bobber.material.color, '#f5efe0');
  assert.equal(bobber.material.opts.roughness, 0.7);

  const line = group.getObjectByName('fishing-line');
  assert.ok(line);
  assert.equal(line.position.x, 0);

  const ripple2 = group.getObjectByName('ripple-2');
  assert.ok(ripple2);
  assert.ok(Math.abs(ripple2.position.y - 0.12) < 1e-9);
  assert.equal(ripple2.position.x, 0);
  assert.equal(ripple2.position.z, 2.5);
});

test('findFishingSpot returns exact key set and values on cone island', () => {
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.deepEqual(Object.keys(spot), [
    'x',
    'y',
    'z',
    'r',
    'shoreR',
    'bearingRad',
    'dirX',
    'dirZ',
  ]);
  assert.equal(spot.r, 36.5);
  assert.equal(spot.shoreR, 38.0);
  assert.ok(Math.abs(spot.x - Math.sin(Math.PI / 4) * 36.5) < 1e-9);
  assert.ok(Math.abs(spot.z - Math.cos(Math.PI / 4) * 36.5) < 1e-9);
  assert.ok(Math.abs(spot.y - coneIslandGroundAt(spot.x, spot.z)) < 1e-9);
  assert.equal(spot.bearingRad, Math.PI / 4);
});

test('findFishingSpot makes exactly 115 groundAt calls on cone island', () => {
  let calls = 0;
  const countingGroundAt = (x, z) => {
    calls++;
    return coneIslandGroundAt(x, z);
  };
  const first = findFishingSpot({ groundAt: countingGroundAt, waterY: 0, groundY: -3 });
  assert.equal(calls, 115);

  calls = 0;
  const second = findFishingSpot({ groundAt: countingGroundAt, waterY: 0, groundY: -3 });
  assert.deepEqual(second, first);
  assert.equal(calls, 115);
});

test('findFishingSpot returns null when groundAt returns non-finite mid-search', () => {
  const makeMidStub = (midVal) => (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 30) return 2.0;
    if (r < 35) return midVal;
    return -1.0;
  };
  assert.equal(findFishingSpot({ groundAt: makeMidStub(NaN), waterY: 0, groundY: -3 }), null);
  assert.equal(findFishingSpot({ groundAt: makeMidStub(Infinity), waterY: 0, groundY: -3 }), null);
});

test('findFishingSpot returns null when waterY is +/-Infinity', () => {
  assert.equal(
    findFishingSpot({ groundAt: coneIslandGroundAt, waterY: Infinity, groundY: -3 }),
    null
  );
  assert.equal(
    findFishingSpot({ groundAt: coneIslandGroundAt, waterY: -Infinity, groundY: -3 }),
    null
  );
});

test('buildFishingSpot with no opts object fails soft with NaN water geometry', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  const group = buildFishingSpot(THREE, spot);
  assert.equal(group.name, 'fishing-spot');
  assert.equal(group.children.length, 7);

  const rod = group.getObjectByName('propped-fishing-rod');
  const box = group.getObjectByName('tackle-box');
  assert.ok(rod instanceof THREE.Group);
  assert.ok(box instanceof THREE.Group);

  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber);
  assert.ok(Number.isNaN(bobber.position.y));
  assert.equal(bobber.position.x, 0);
  assert.equal(bobber.position.z, 2.5);

  const line = group.getObjectByName('fishing-line');
  assert.ok(line);
  assert.ok(Number.isNaN(line.geometry.args[2]));
  assert.ok(Number.isNaN(line.rotation.x));
  assert.ok(Number.isNaN(line.position.y));

  const ripple0 = group.getObjectByName('ripple-0');
  assert.ok(ripple0);
  assert.ok(Number.isNaN(ripple0.position.y));
});

test('buildFishingSpot handles line below the rod tip (negative dy)', () => {
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
  const group = buildFishingSpot(THREE, spot, { waterY: -1 });
  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber);
  assert.ok(Math.abs(bobber.position.y - -1.35) < 1e-9);

  const line = group.getObjectByName('fishing-line');
  assert.ok(line);
  assert.ok(Math.abs(line.geometry.args[2] - Math.hypot(2.3, 1.75)) < 1e-9);
  assert.ok(Math.abs(line.rotation.x - Math.atan2(1.75, -2.3)) < 1e-9);
  assert.ok(line.rotation.x > Math.PI / 2);
  assert.ok(Math.abs(line.position.y - -0.2) < 1e-9);
  assert.equal(line.position.z, 1.625);
});

test('buildFishingSpot with negative spot.y still puts bobber at waterY + 0.05 in world space', () => {
  const THREE = makeFakeThree();
  const spot = {
    x: 1,
    y: -2,
    z: 2,
    r: 36.5,
    shoreR: 38,
    bearingRad: Math.PI / 4,
    dirX: Math.sin(Math.PI / 4),
    dirZ: Math.cos(Math.PI / 4),
  };
  const group = buildFishingSpot(THREE, spot, { waterY: 0 });
  assert.equal(group.position.y, -2);

  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber);
  assert.ok(Math.abs(bobber.position.y - 2.05) < 1e-9);
  assert.ok(Math.abs(group.position.y + bobber.position.y - 0.05) < 1e-9);

  const ripple2 = group.getObjectByName('ripple-2');
  assert.ok(ripple2);
  assert.ok(Math.abs(group.position.y + ripple2.position.y - 0.02) < 1e-9);
});

test('staging.js wires findFishingSpot and buildFishingSpot with kit factories', () => {
  const src = fs.readFileSync(path.join(__dirname, 'staging.js'), 'utf8');
  for (const snippet of [
    "import { findFishingSpot, buildFishingSpot } from './fishing.mjs?v=40';",
    "import { createAsset as createFishingRod } from './kit-campground/propped-fishing-rod.mjs';",
    "import { createAsset as createTackleBox } from './kit-campground/tackle-box.mjs';",
    'const waterY = camp.terrain?.userData?.terrain?.waterY ?? -Infinity;',
    'const fishingSpot = findFishingSpot({ groundAt: camp.groundAt, waterY, groundY: camp.groundY });',
    'if (fishingSpot) {',
    'scene.add(buildFishingSpot(THREE, fishingSpot, {',
    'createRod: createFishingRod,',
    'createTackleBox,',
  ]) {
    assert.ok(src.includes(snippet), `staging.js missing snippet: ${snippet}`);
  }
});

test('staging-polyfork/README.md documents fishing.mjs and test-fishing.mjs', () => {
  const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
  for (const snippet of [
    '`fishing.mjs` — minimal lakeside fishing spot (`findFishingSpot`,',
    '`buildFishingSpot`): deterministic 45° shore-crossing finder plus propped',
    'rod, tackle box, cedar line, cream bobber, and three ripple rings.',
    '`test-fishing.mjs` — unit tests for `fishing.mjs` (stub cone-island shore',
    'crossing, dry-feet + bobber-over-water checks, all-land/all-water null,',
    'group/ripples structure, static hygiene).',
  ]) {
    assert.ok(readme.includes(snippet), `staging-polyfork/README.md missing snippet: ${snippet}`);
  }
});

test('buildFishingSpot falls back to default Groups for non-function factories', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);

  const g1 = buildFishingSpot(THREE, spot, {
    waterY: 0,
    createRod: 'rod',
    createTackleBox: 42,
  });
  assert.equal(g1.children.length, 7);
  const rod1 = g1.getObjectByName('propped-fishing-rod');
  const box1 = g1.getObjectByName('tackle-box');
  assert.ok(rod1 instanceof THREE.Group);
  assert.ok(box1 instanceof THREE.Group);
  assert.deepEqual([rod1.position.x, rod1.position.y, rod1.position.z], [0, 0, 0]);
  assert.deepEqual([box1.position.x, box1.position.y, box1.position.z], [-0.55, 0, -0.25]);

  const g2 = buildFishingSpot(THREE, spot, {
    waterY: 0,
    createRod: null,
    createTackleBox: undefined,
  });
  assert.ok(g2.getObjectByName('propped-fishing-rod') instanceof THREE.Group);
  assert.ok(g2.getObjectByName('tackle-box') instanceof THREE.Group);
});

test('Slice 440: findFishingSpot rejects non-finite groundAt returns and skips the guard for infinite groundY (G1)', () => {
  for (const bad of ['2.0', null, undefined, true, {}]) {
    assert.equal(findFishingSpot({ groundAt: () => bad, waterY: 0, groundY: -3 }), null);
  }
  for (const groundY of [Infinity, -Infinity]) {
    const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY });
    assert.ok(spot);
    assert.equal(spot.r, 36.5);
    assert.equal(spot.shoreR, 38.0);
  }
});

test('Slice 440: findFishingSpot does not retry after a dry-feet failure at the first crossing (G2)', () => {
  const noRetryGroundAt = (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 30) return 2.0;
    if (r < 37.9) return 0.2;
    if (r < 45) return -1.0;
    if (r < 50.5) return 2.0;
    return -1.0;
  };
  assert.equal(findFishingSpot({ groundAt: noRetryGroundAt, waterY: 0, groundY: -3 }), null);

  const passingFirst = (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 30) return 2.0;
    if (r < 37.9) return 2.0;
    if (r < 45) return -1.0;
    if (r < 50.5) return 2.0;
    return -1.0;
  };
  const spot = findFishingSpot({ groundAt: passingFirst, waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.equal(spot.r, 36.25);
  assert.equal(spot.shoreR, 37.75);
  assert.equal(spot.y, 2.0);
});

test('Slice 440: findFishingSpot exact spot values on a flat-shore stub (G3)', () => {
  const flatGroundAt = (x, z) => (Math.hypot(x, z) < 40 ? 2.0 : -1.0);
  const spot = findFishingSpot({ groundAt: flatGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.equal(spot.r, 38.25);
  assert.equal(spot.shoreR, 39.75);
  assert.equal(spot.y, 2.0);
  assert.ok(Math.abs(spot.x - Math.sin(Math.PI / 4) * 38.25) < 1e-9);
  assert.ok(Math.abs(spot.z - Math.cos(Math.PI / 4) * 38.25) < 1e-9);
  assert.equal(spot.bearingRad, Math.PI / 4);
});

test('Slice 440: findFishingSpot groundAt call counts for all-land, all-water, and last-radius crossings (G4)', () => {
  let calls = 0;
  const allLand = () => { calls++; return 2.0; };
  assert.equal(findFishingSpot({ groundAt: allLand, waterY: 0, groundY: -3 }), null);
  assert.equal(calls, 201);

  calls = 0;
  const allWater = () => { calls++; return -1.0; };
  assert.equal(findFishingSpot({ groundAt: allWater, waterY: 0, groundY: -3 }), null);
  assert.equal(calls, 1);

  calls = 0;
  const lastRadius = (x, z) => { calls++; return Math.hypot(x, z) < 60 ? 2.0 : -1.0; };
  assert.equal(findFishingSpot({ groundAt: lastRadius, waterY: 0, groundY: -3 }), null);
  assert.equal(calls, 201);
});

test('Slice 440: buildFishingSpot throwing factories propagate and a Mesh factory is renamed and positioned (G5)', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);

  assert.throws(
    () => buildFishingSpot(THREE, spot, { waterY: 0, createRod: () => { throw new Error('rod boom'); } }),
    /rod boom/
  );
  assert.throws(
    () => buildFishingSpot(THREE, spot, { waterY: 0, createTackleBox: () => { throw new Error('box boom'); } }),
    /box boom/
  );

  const meshRod = new THREE.Mesh(
    new THREE.SphereGeometry(1, 2, 3),
    new THREE.MeshStandardMaterial({ color: '#ffffff' })
  );
  const group = buildFishingSpot(THREE, spot, { waterY: 0, createRod: () => meshRod });
  const rod = group.getObjectByName('propped-fishing-rod');
  assert.equal(rod, meshRod);
  assert.ok(rod instanceof THREE.Mesh);
  assert.equal(rod.name, 'propped-fishing-rod');
  assert.deepEqual([rod.position.x, rod.position.y, rod.position.z], [0, 0, 0]);
  assert.equal(group.children.length, 7);
});

test('Slice 440: buildFishingSpot aliases one shared object used for both factories (G6)', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);

  const shared = new THREE.Group();
  shared.name = 'shared';
  const group = buildFishingSpot(THREE, spot, {
    waterY: 0,
    createRod: () => shared,
    createTackleBox: () => shared,
  });
  assert.equal(group.children.length, 7);
  assert.equal(group.children[0], shared);
  assert.equal(group.children[1], shared);
  assert.equal(group.getObjectByName('propped-fishing-rod'), null);
  assert.equal(group.getObjectByName('tackle-box'), shared);
  assert.equal(shared.name, 'tackle-box');
  assert.deepEqual([shared.position.x, shared.position.y, shared.position.z], [-0.55, 0, -0.25]);
});

test('Slice 440: buildFishingSpot coerces non-number waterY values (G7)', () => {
  const spot = {
    x: 1, y: 0.4, z: 2, r: 36.5, shoreR: 38,
    bearingRad: Math.PI / 4, dirX: Math.sin(Math.PI / 4), dirZ: Math.cos(Math.PI / 4),
  };

  const THREE = makeFakeThree();
  const bad = buildFishingSpot(THREE, spot, { waterY: 'x' });
  const badBobber = bad.getObjectByName('bobber');
  assert.ok(Number.isNaN(badBobber.position.y));
  assert.equal(badBobber.position.x, 0);
  assert.equal(badBobber.position.z, 2.5);
  const badLine = bad.getObjectByName('fishing-line');
  assert.ok(Number.isNaN(badLine.geometry.args[2]));
  assert.ok(Number.isNaN(badLine.rotation.x));
  assert.ok(Number.isNaN(badLine.position.y));
  assert.ok(Number.isNaN(bad.getObjectByName('ripple-0').position.y));

  const nulled = buildFishingSpot(THREE, spot, { waterY: null });
  const nullBobber = nulled.getObjectByName('bobber');
  assert.ok(Math.abs(nullBobber.position.y - -0.35) < 1e-9);
  const nullLine = nulled.getObjectByName('fishing-line');
  assert.ok(Math.abs(nullLine.geometry.args[2] - Math.hypot(1.3, 1.75)) < 1e-9);
  assert.ok(Math.abs(nullLine.rotation.x - Math.atan2(1.75, -1.3)) < 1e-9);
  assert.ok(Math.abs(nullLine.position.y - 0.3) < 1e-9);
  assert.equal(nullLine.position.z, 1.625);
  assert.ok(Math.abs(nulled.getObjectByName('ripple-2').position.y - -0.38) < 1e-9);

  const trued = buildFishingSpot(THREE, spot, { waterY: true });
  const trueBobber = trued.getObjectByName('bobber');
  assert.ok(Math.abs(trueBobber.position.y - 0.65) < 1e-9);
  const trueLine = trued.getObjectByName('fishing-line');
  assert.ok(Math.abs(trueLine.geometry.args[2] - Math.hypot(0.3, 1.75)) < 1e-9);
  assert.ok(Math.abs(trueLine.rotation.x - Math.atan2(1.75, -0.3)) < 1e-9);
  assert.ok(Math.abs(trueLine.position.y - 0.8) < 1e-9);

  const zeroed = buildFishingSpot(THREE, spot, { waterY: '0' });
  assert.ok(Math.abs(zeroed.getObjectByName('bobber').position.y - -0.35) < 1e-9);
});

test('Slice 440: buildFishingSpot with an empty or null spot (G8)', () => {
  const THREE = makeFakeThree();
  const group = buildFishingSpot(THREE, {}, { waterY: 0 });
  assert.equal(group.name, 'fishing-spot');
  assert.equal(group.position.x, undefined);
  assert.equal(group.position.y, undefined);
  assert.equal(group.position.z, undefined);
  assert.equal(group.rotation.y, undefined);
  assert.equal(group.children.length, 7);
  assert.ok(Number.isNaN(group.getObjectByName('bobber').position.y));
  assert.ok(Number.isNaN(group.getObjectByName('fishing-line').geometry.args[2]));

  assert.throws(() => buildFishingSpot(THREE, null, { waterY: 0 }), TypeError);
});

test('Slice 440: buildFishingSpot creates fresh rod, box, and materials on every call (G9)', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);

  const g1 = buildFishingSpot(THREE, spot, { waterY: 0 });
  const g2 = buildFishingSpot(THREE, spot, { waterY: 0 });
  assert.notEqual(g1.getObjectByName('propped-fishing-rod'), g2.getObjectByName('propped-fishing-rod'));
  assert.notEqual(g1.getObjectByName('tackle-box'), g2.getObjectByName('tackle-box'));
  assert.notEqual(g1.getObjectByName('bobber').material, g2.getObjectByName('bobber').material);
  assert.notEqual(g1.getObjectByName('fishing-line').material, g2.getObjectByName('fishing-line').material);
  assert.notEqual(g1.getObjectByName('bobber'), g2.getObjectByName('bobber'));
  assert.equal(g1.getObjectByName('bobber').material.color, '#f5efe0');
  assert.equal(g2.getObjectByName('bobber').material.color, '#f5efe0');
});

test('Slice 440: file hygiene - 61 unique test names, 6 import lines, and pinned literal counts (G10)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-fishing.mjs'), 'utf8');
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 61);
  assert.equal(new Set(names).size, 61);
  for (const name of names) {
    assert.equal(name.includes("'"), false, 'test names must contain no apostrophes');
  }
  const lines = src.split('\n');
  assert.equal(lines.filter((l) => l.startsWith('import ')).length, 6);
  const countLines = (needle) => lines.filter((l) => l.includes(needle)).length;
  assert.equal(countLines('fet' + 'ch('), 0);
  assert.equal(countLines('Date' + '.now'), 0);
  assert.equal(countLines('Math' + '.random'), 0);
  assert.equal(countLines('TO' + 'DO'), 0);
  assert.equal(countLines('FIX' + 'ME'), 0);
  assert.equal(countLines('inner' + 'HTML'), 0);
  assert.equal(lines.filter((l) => new RegExp('camp' + 'fire', 'i').test(l)).length, 0);
});

test('Slice 509: findFishingSpot propagates a throwing groundAt (P1)', () => {
  assert.throws(
    () => findFishingSpot({
      groundAt: () => { throw new Error('ground boom'); },
      waterY: 0,
      groundY: -3,
    }),
    /ground boom/
  );
});

test('Slice 509: findFishingSpot samples exactly along the 45-degree bearing (P2)', () => {
  const points = [];
  const recordingGroundAt = (x, z) => {
    points.push([x, z]);
    return coneIslandGroundAt(x, z);
  };
  const spot = findFishingSpot({ groundAt: recordingGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.equal(points.length, 115);
  for (const [x, z] of points) {
    assert.ok(Math.abs(x - z) < 1e-14);
  }
  for (let k = 1; k < 114; k++) {
    assert.ok(points[k][0] > points[k - 1][0]);
  }
  assert.ok(Math.abs(Math.hypot(...points[113]) - 38.25) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...points[114]) - 36.5) < 1e-9);
  assert.equal(points[0][0], Math.sin(Math.PI / 4) * 10);
});

test('Slice 509: findFishingSpot and buildFishingSpot do not mutate frozen inputs (P3)', () => {
  const opts = Object.freeze({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  const spot = findFishingSpot(opts);
  assert.ok(spot);
  assert.equal(spot.r, 36.5);
  const frozenSpot = Object.freeze({
    x: 1, y: 0.4, z: 2, r: 36.5, shoreR: 38,
    bearingRad: Math.PI / 4, dirX: Math.sin(Math.PI / 4), dirZ: Math.cos(Math.PI / 4),
  });
  const THREE = makeFakeThree();
  const group = buildFishingSpot(THREE, frozenSpot, { waterY: 0 });
  assert.equal(group.name, 'fishing-spot');
  assert.equal(group.children.length, 7);
  assert.equal(frozenSpot.x, 1);
});

test('Slice 509: findFishingSpot returns null for boolean or null waterY (P4)', () => {
  for (const waterY of [true, false, null]) {
    assert.equal(findFishingSpot({ groundAt: coneIslandGroundAt, waterY, groundY: -3 }), null);
  }
});

test('Slice 509: buildFishingSpot with waterY equal to spot.y puts the bobber just above the spot (P5)', () => {
  const THREE = makeFakeThree();
  const spot = {
    x: 1, y: 0.4, z: 2, r: 36.5, shoreR: 38,
    bearingRad: Math.PI / 4, dirX: Math.sin(Math.PI / 4), dirZ: Math.cos(Math.PI / 4),
  };
  const group = buildFishingSpot(THREE, spot, { waterY: 0.4 });
  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber);
  assert.ok(Math.abs(bobber.position.y - 0.05) < 1e-9);
  const ripple0 = group.getObjectByName('ripple-0');
  assert.ok(ripple0);
  assert.ok(Math.abs(ripple0.position.y - 0.02) < 1e-9);
  const line = group.getObjectByName('fishing-line');
  assert.ok(line);
  assert.ok(Math.abs(line.geometry.args[2] - Math.hypot(0.9, 1.75)) < 1e-9);
  assert.ok(Math.abs(line.rotation.x - Math.atan2(1.75, -0.9)) < 1e-9);
  assert.ok(Math.abs(line.position.y - 0.5) < 1e-9);
  assert.equal(line.position.z, 1.625);
});

test('Slice 509: findFishingSpot makes exactly 122 groundAt calls on a flat-shore stub (P6)', () => {
  const radii = [];
  const flatGroundAt = (x, z) => {
    radii.push(Math.hypot(x, z));
    return Math.hypot(x, z) < 40 ? 2.0 : -1.0;
  };
  const spot = findFishingSpot({ groundAt: flatGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.equal(radii.length, 122);
  assert.ok(Math.abs(radii[120] - 40) < 1e-9);
  assert.ok(Math.abs(radii[121] - 38.25) < 1e-9);
  assert.equal(spot.r, 38.25);
  assert.equal(spot.shoreR, 39.75);
});

test('Slice 509: buildFishingSpot line material is distinct from the bobber and ripple material (P7)', () => {
  const THREE = makeFakeThree();
  const spot = findFishingSpot({ groundAt: coneIslandGroundAt, waterY: 0, groundY: -3 });
  assert.ok(spot);
  const group = buildFishingSpot(THREE, spot, { waterY: 0 });
  const line = group.getObjectByName('fishing-line');
  const bobber = group.getObjectByName('bobber');
  const ripple1 = group.getObjectByName('ripple-1');
  assert.ok(line);
  assert.ok(bobber);
  assert.ok(ripple1);
  assert.notEqual(line.material, bobber.material);
  assert.notEqual(line.material, ripple1.material);
  assert.equal(line.material.type, 'MeshStandardMaterial');
  assert.equal(line.material.color, '#6b492b');
  assert.equal(line.material.opts.roughness, 0.9);
  assert.equal(bobber.material.type, 'MeshStandardMaterial');
  assert.equal(bobber.material.color, '#f5efe0');
});

test('Slice 509: buildFishingSpot ignores spot.dirX and dirZ and uses only bearingRad (P8)', () => {
  const THREE = makeFakeThree();
  for (const [dirX, dirZ] of [[0, 0], [1, 0]]) {
    const spot = {
      x: 1, y: 0.4, z: 2, r: 36.5, shoreR: 38,
      bearingRad: Math.PI / 3, dirX, dirZ,
    };
    const group = buildFishingSpot(THREE, spot, { waterY: 0 });
    assert.equal(group.rotation.y, Math.PI / 3);
    assert.deepEqual([group.position.x, group.position.y, group.position.z], [1, 0.4, 2]);
    const bobber = group.getObjectByName('bobber');
    assert.ok(bobber);
    assert.equal(bobber.position.z, 2.5);
    assert.equal(bobber.position.x, 0);
  }
});

test('Slice 509: findFishingSpot dry-feet reads the ground at spotR, not at the shore (P9)', () => {
  const shoreHighSpotLow = (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 36.5) return 0.2;
    if (r < 38) return 2.0;
    return -1.0;
  };
  assert.equal(findFishingSpot({ groundAt: shoreHighSpotLow, waterY: 0, groundY: -3 }), null);

  const shoreLowSpotHigh = (x, z) => {
    const r = Math.hypot(x, z);
    if (r < 36.5) return 2.0;
    if (r < 38) return 0.35;
    return -1.0;
  };
  const spot = findFishingSpot({ groundAt: shoreLowSpotHigh, waterY: 0, groundY: -3 });
  assert.ok(spot);
  assert.equal(spot.r, 36.25);
  assert.equal(spot.shoreR, 37.75);
  assert.equal(spot.y, 2.0);
});

test('Slice 509: buildFishingSpot coerces a numeric-string waterY (P10)', () => {
  const THREE = makeFakeThree();
  const spot = {
    x: 1, y: 0.4, z: 2, r: 36.5, shoreR: 38,
    bearingRad: Math.PI / 4, dirX: Math.sin(Math.PI / 4), dirZ: Math.cos(Math.PI / 4),
  };
  const group = buildFishingSpot(THREE, spot, { waterY: '0.5' });
  const bobber = group.getObjectByName('bobber');
  assert.ok(bobber);
  assert.ok(Math.abs(bobber.position.y - 0.15) < 1e-9);
  const ripple2 = group.getObjectByName('ripple-2');
  assert.ok(ripple2);
  assert.ok(Math.abs(ripple2.position.y - 0.12) < 1e-9);
  const line = group.getObjectByName('fishing-line');
  assert.ok(line);
  assert.ok(Math.abs(line.geometry.args[2] - Math.hypot(0.8, 1.75)) < 1e-9);
  assert.ok(Math.abs(line.rotation.x - Math.atan2(1.75, -0.8)) < 1e-9);
  assert.ok(Math.abs(line.position.y - 0.55) < 1e-9);
  assert.equal(line.position.z, 1.625);
});
