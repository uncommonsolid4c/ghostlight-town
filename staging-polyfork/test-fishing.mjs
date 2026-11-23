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
