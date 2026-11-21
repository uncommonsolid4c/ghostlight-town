import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TOWN_LAYOUT } from './avatar.mjs';
import { buildEmptyPadMarker, syncEmptyPadMarkers } from './empty-pad.mjs';

function makeFakeThree() {
  class BoxGeometry {
    constructor(w, h, d) {
      this.type = 'BoxGeometry';
      this.args = [w, h, d];
    }
  }
  class MeshStandardMaterial {
    constructor(opts) {
      this.type = 'MeshStandardMaterial';
      this.opts = opts;
      this.color = opts.color;
      this.map = opts.map;
      this.roughness = opts.roughness;
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.name = '';
      this.userData = {};
      this.parent = null;
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
      this.userData = {};
      this.children = [];
      this.parent = null;
      this.removedCount = 0;
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
    add(child) {
      child.parent = this;
      this.children.push(child);
    }
    removeFromParent() {
      this.removedCount++;
      if (this.parent) {
        const idx = this.parent.children.indexOf(this);
        if (idx !== -1) this.parent.children.splice(idx, 1);
        this.parent = null;
      }
    }
  }
  return { BoxGeometry, MeshStandardMaterial, Mesh, Group };
}

function makeFakeScene() {
  return {
    children: [],
    addCalls: 0,
    add(obj) {
      this.addCalls++;
      obj.parent = this;
      this.children.push(obj);
    },
  };
}

test('buildEmptyPadMarker mirrors town.js buildEmptyPlotPad geometry, colors, position, userData, and sign options', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[1]; // plotNumber 2
  const texCalls = [];
  const fakeTex = { isFakeTexture: true };
  const makeTextTexture = (threeArg, lines, opts) => {
    texCalls.push({ threeArg, lines, opts });
    return fakeTex;
  };

  const group = buildEmptyPadMarker(THREE, plot, 1.25, makeTextTexture);

  assert.equal(group.name, 'plot_pad_2');
  assert.equal(group.position.x, plot.x);
  assert.equal(group.position.y, 1.25);
  assert.equal(group.position.z, plot.z);
  assert.equal(group.rotation.y, plot.rotY);
  assert.deepEqual(group.userData, {
    clickable: true,
    kind: 'open_plot',
    plotNumber: 2,
    label: 'OPEN PLOT #2',
  });

  assert.equal(group.children.length, 2);
  const [slab, sign] = group.children;

  assert.equal(slab.geometry.type, 'BoxGeometry');
  assert.deepEqual(slab.geometry.args, [5.2, 0.18, 4.6]);
  assert.equal(slab.material.color, '#6e7278');
  assert.equal(slab.material.roughness, 0.95);
  assert.deepEqual([slab.position.x, slab.position.y, slab.position.z], [0, 0.09, 0]);

  assert.equal(texCalls.length, 1);
  assert.equal(texCalls[0].threeArg, THREE);
  assert.deepEqual(texCalls[0].lines, ['OPEN PLOT #2']);
  assert.deepEqual(texCalls[0].opts, {
    width: 512,
    height: 160,
    titleSize: 30,
    bg: '#3b2b1d',
    border: '#7d5a3c',
  });

  assert.equal(sign.geometry.type, 'BoxGeometry');
  assert.deepEqual(sign.geometry.args, [1.5, 0.75, 0.1]);
  assert.equal(sign.material.map, fakeTex);
  assert.equal(sign.material.roughness, 0.85);
  assert.equal(sign.name, 'plot_2_signpost');
  assert.deepEqual(sign.userData, { signpostText: 'OPEN PLOT #2' });
  assert.deepEqual([sign.position.x, sign.position.y, sign.position.z], [2.0, 0.45, 2.35]);
});

test('syncEmptyPadMarkers builds 7 markers (plots 2-8), removes on assignment, is idempotent, and rebuilds if freed', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = {
    plotAssignments: new Map(),
    emptyPadMarkers: new Map(),
  };
  let texCount = 0;
  const makeTextTexture = () => {
    texCount++;
    return { texId: texCount };
  };
  const groundAt = (x, z) => (x + z) * 0.01;

  // First sync: 7 markers for plots 2..8, none for plot 1.
  const count1 = syncEmptyPadMarkers(scene, liveStore, { THREE, makeTextTexture, groundAt });
  assert.equal(count1, 7);
  assert.equal(liveStore.emptyPadMarkers.size, 7);
  assert.equal(liveStore.emptyPadMarkers.has(1), false);
  for (let n = 2; n <= 8; n++) {
    assert.ok(liveStore.emptyPadMarkers.has(n), `plot ${n} marker must exist`);
  }
  assert.equal(scene.children.length, 7);
  assert.equal(scene.addCalls, 7);

  // Second sync with no changes: no-op, same group instances.
  const snapshotBefore = new Map(liveStore.emptyPadMarkers);
  const count2 = syncEmptyPadMarkers(scene, liveStore, { THREE, makeTextTexture, groundAt });
  assert.equal(count2, 7);
  assert.equal(scene.addCalls, 7);
  assert.equal(texCount, 7);
  for (let n = 2; n <= 8; n++) {
    assert.equal(liveStore.emptyPadMarkers.get(n), snapshotBefore.get(n));
  }

  // Assign plot 2 -> marker 2 removed.
  const marker2 = liveStore.emptyPadMarkers.get(2);
  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  const count3 = syncEmptyPadMarkers(scene, liveStore, { THREE, makeTextTexture, groundAt });
  assert.equal(count3, 6);
  assert.equal(liveStore.emptyPadMarkers.has(2), false);
  assert.equal(marker2.removedCount, 1);
  assert.equal(scene.children.length, 6);

  // Free plot 2 -> marker 2 rebuilt.
  liveStore.plotAssignments.delete('wick');
  const count4 = syncEmptyPadMarkers(scene, liveStore, { THREE, makeTextTexture, groundAt });
  assert.equal(count4, 7);
  assert.ok(liveStore.emptyPadMarkers.has(2));
  assert.notEqual(liveStore.emptyPadMarkers.get(2), marker2);
  assert.equal(scene.children.length, 7);
});

test('buildEmptyPadMarker uses plot 8 layout, label, group name, and sign name for the last plot', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[7]; // plotNumber 8
  assert.equal(plot.plotNumber, 8);
  const texCalls = [];
  const makeTextTexture = (threeArg, lines, opts) => {
    texCalls.push({ threeArg, lines, opts });
    return { isFakeTexture: true };
  };

  const group = buildEmptyPadMarker(THREE, plot, 2.5, makeTextTexture);

  assert.equal(group.name, 'plot_pad_8');
  assert.equal(group.position.x, plot.x);
  assert.equal(group.position.y, 2.5);
  assert.equal(group.position.z, plot.z);
  assert.equal(group.rotation.y, plot.rotY);
  assert.deepEqual(group.userData, {
    clickable: true,
    kind: 'open_plot',
    plotNumber: 8,
    label: 'OPEN PLOT #8',
  });
  const [, sign] = group.children;
  assert.equal(sign.name, 'plot_8_signpost');
  assert.deepEqual(sign.userData, { signpostText: 'OPEN PLOT #8' });
  assert.deepEqual(texCalls[0].lines, ['OPEN PLOT #8']);
});

test('buildEmptyPadMarker varies only group.position.y when groundY changes', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[2]; // plotNumber 3
  const fakeTex = { isFakeTexture: true };
  const makeTextTexture = () => fakeTex;

  const groupA = buildEmptyPadMarker(THREE, plot, 0.5, makeTextTexture);
  const groupB = buildEmptyPadMarker(THREE, plot, 4.25, makeTextTexture);

  assert.equal(groupA.position.y, 0.5);
  assert.equal(groupB.position.y, 4.25);
  assert.equal(groupA.position.x, groupB.position.x);
  assert.equal(groupA.position.z, groupB.position.z);
  assert.equal(groupA.rotation.y, groupB.rotation.y);
  assert.deepEqual(groupA.userData, groupB.userData);

  const [slabA, signA] = groupA.children;
  const [slabB, signB] = groupB.children;
  assert.deepEqual(slabA.geometry.args, slabB.geometry.args);
  assert.equal(slabA.material.color, slabB.material.color);
  assert.equal(slabA.material.roughness, slabB.material.roughness);
  assert.deepEqual([slabA.position.x, slabA.position.y, slabA.position.z], [slabB.position.x, slabB.position.y, slabB.position.z]);

  assert.deepEqual(signA.geometry.args, signB.geometry.args);
  assert.equal(signA.material.roughness, signB.material.roughness);
  assert.equal(signA.name, signB.name);
  assert.deepEqual(signA.userData, signB.userData);
  assert.deepEqual([signA.position.x, signA.position.y, signA.position.z], [signB.position.x, signB.position.y, signB.position.z]);
});

test('syncEmptyPadMarkers initializes emptyPadMarkers when missing from liveStore', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map() };

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => 0,
  });

  assert.equal(count, 7);
  assert.ok(liveStore.emptyPadMarkers instanceof Map);
  assert.equal(liveStore.emptyPadMarkers.size, 7);
  assert.equal(scene.children.length, 7);
});

test('syncEmptyPadMarkers removes multiple assigned plots at once and calls removeFromParent on each', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  const removed = [2, 3, 4].map((n) => liveStore.emptyPadMarkers.get(n));

  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  liveStore.plotAssignments.set('maren', { plotNumber: 3 });
  liveStore.plotAssignments.set('tomas', { plotNumber: 4 });

  const remaining = syncEmptyPadMarkers(scene, liveStore, opts);
  assert.equal(remaining, 4);
  assert.deepEqual([...liveStore.emptyPadMarkers.keys()].sort((a, b) => a - b), [5, 6, 7, 8]);
  assert.equal(scene.children.length, 4);
  for (const marker of removed) {
    assert.equal(marker.removedCount, 1);
  }
});

test('syncEmptyPadMarkers ignores assignments with an unknown plotNumber', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = {
    plotAssignments: new Map([['stranger', { plotNumber: 9 }]]),
    emptyPadMarkers: new Map(),
  };

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => 0,
  });

  assert.equal(count, 7);
  assert.equal(liveStore.emptyPadMarkers.size, 7);
  assert.equal(liveStore.emptyPadMarkers.has(9), false);
  assert.equal(scene.children.length, 7);
});

test('syncEmptyPadMarkers sets each marker position.y from groundAt(plot.x, plot.z)', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const groundCalls = [];
  const groundAt = (x, z) => {
    groundCalls.push([x, z]);
    return +(x * 0.1 - z * 0.05).toFixed(4);
  };

  syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt,
  });

  const expectedPlots = TOWN_LAYOUT.plots.slice(1);
  assert.equal(groundCalls.length, expectedPlots.length);
  expectedPlots.forEach((plot, idx) => {
    assert.deepEqual(groundCalls[idx], [plot.x, plot.z]);
    const expectedY = +(plot.x * 0.1 - plot.z * 0.05).toFixed(4);
    assert.equal(liveStore.emptyPadMarkers.get(plot.plotNumber).position.y, expectedY);
  });
});

test('syncEmptyPadMarkers ignores an assignment to plot 1 (removes no marker and creates none)', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);

  liveStore.plotAssignments.set('milo', { plotNumber: 1 });
  const count = syncEmptyPadMarkers(scene, liveStore, opts);

  assert.equal(count, 7);
  assert.equal(liveStore.emptyPadMarkers.size, 7);
  assert.equal(liveStore.emptyPadMarkers.has(1), false);
  assert.equal(scene.children.length, 7);
});

test('syncEmptyPadMarkers removes a marker once when two residents share a plotNumber and does not double-remove', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  const marker2 = liveStore.emptyPadMarkers.get(2);

  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  liveStore.plotAssignments.set('maren', { plotNumber: 2 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.equal(marker2.removedCount, 1);

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.equal(marker2.removedCount, 1);
});

test('syncEmptyPadMarkers rebuilds a freed plot with the fresh groundAt value', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  let groundY = 1.0;
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => groundY };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  const oldMarker3 = liveStore.emptyPadMarkers.get(3);
  assert.equal(oldMarker3.position.y, 1.0);

  liveStore.plotAssignments.set('maren', { plotNumber: 3 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.equal(liveStore.emptyPadMarkers.has(3), false);

  groundY = 2.5;
  liveStore.plotAssignments.delete('maren');
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);

  assert.equal(liveStore.emptyPadMarkers.has(3), true);
  const newMarker3 = liveStore.emptyPadMarkers.get(3);
  assert.notEqual(newMarker3, oldMarker3);
  assert.equal(newMarker3.position.y, 2.5);
});

test('staging empty-pad literals match town.js buildEmptyPlotPad (drift guard)', () => {
  const townSrc = readFileSync(new URL('../town-3d/town.js', import.meta.url), 'utf8');
  const stagingSrc = readFileSync(new URL('./empty-pad.mjs', import.meta.url), 'utf8');

  const match = townSrc.match(/function buildEmptyPlotPad\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'buildEmptyPlotPad must exist in town-3d/town.js');
  const townBody = match[0];

  const literals = [
    '5.2, 0.18, 4.6',
    "'#6e7278'",
    '0.95',
    '1.5, 0.75, 0.1',
    '0.85',
    '2.0, 0.45, 2.35',
    '0, 0.09, 0',
    'width: 512',
    'height: 160',
    'titleSize: 30',
    "'#3b2b1d'",
    "'#7d5a3c'",
  ];

  for (const lit of literals) {
    assert.ok(townBody.includes(lit), `town.js buildEmptyPlotPad missing literal: ${lit}`);
    assert.ok(stagingSrc.includes(lit), `staging-polyfork/empty-pad.mjs missing literal: ${lit}`);
  }
});

test('buildEmptyPadMarker produces expected group, slab, and signpost for every plot 2..8', () => {
  const THREE = makeFakeThree();
  const makeTextTexture = () => ({ isFakeTexture: true });

  assert.equal(TOWN_LAYOUT.plots.length, 8);
  for (const plot of TOWN_LAYOUT.plots.slice(1)) {
    const n = plot.plotNumber;
    const group = buildEmptyPadMarker(THREE, plot, 0, makeTextTexture);

    assert.equal(group.name, `plot_pad_${n}`);
    assert.deepEqual(group.userData, {
      clickable: true,
      kind: 'open_plot',
      plotNumber: n,
      label: `OPEN PLOT #${n}`,
    });
    assert.equal(group.rotation.y, plot.rotY);
    assert.equal(group.children.length, 2);

    const [slab, sign] = group.children;
    assert.deepEqual(slab.geometry.args, [5.2, 0.18, 4.6]);
    assert.equal(slab.material.color, '#6e7278');

    assert.deepEqual(sign.geometry.args, [1.5, 0.75, 0.1]);
    assert.equal(sign.name, `plot_${n}_signpost`);
    assert.deepEqual(sign.userData, { signpostText: `OPEN PLOT #${n}` });
  }
});

test('syncEmptyPadMarkers calls groundAt only when building missing or freed markers', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  let groundCalls = 0;
  const opts = {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => {
      groundCalls++;
      return 0;
    },
  };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(groundCalls, 7);

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(groundCalls, 7);

  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.equal(groundCalls, 7);

  liveStore.plotAssignments.delete('wick');
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(groundCalls, 8);
});

test('syncEmptyPadMarkers removes all 7 markers when all plots 2..8 are assigned and rebuilds 1 when one is freed', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  const saved = new Map(liveStore.emptyPadMarkers);

  const handles = ['h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'];
  handles.forEach((handle, idx) => {
    liveStore.plotAssignments.set(handle, { plotNumber: idx + 2 });
  });

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 0);
  assert.equal(scene.children.length, 0);
  for (const marker of saved.values()) {
    assert.equal(marker.removedCount, 1);
  }

  liveStore.plotAssignments.delete('h5');
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 1);
  assert.equal(scene.children.length, 1);
  assert.equal(liveStore.emptyPadMarkers.has(5), true);
  assert.notEqual(liveStore.emptyPadMarkers.get(5), saved.get(5));
});

test('syncEmptyPadMarkers preserves the other six marker instances when one plot is assigned', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  const snapshot = new Map(liveStore.emptyPadMarkers);
  const addCallsBefore = scene.addCalls;

  liveStore.plotAssignments.set('wick', { plotNumber: 5 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.equal(scene.addCalls, addCallsBefore);
  assert.equal(liveStore.emptyPadMarkers.has(5), false);
  for (let n = 2; n <= 8; n++) {
    if (n === 5) continue;
    assert.equal(liveStore.emptyPadMarkers.get(n), snapshot.get(n));
  }
});

test('syncEmptyPadMarkers ignores string, missing, null, 0, and -1 plotNumber assignments', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = {
    plotAssignments: new Map([
      ['str', { plotNumber: '2' }],
      ['missing', {}],
      ['nil', { plotNumber: null }],
      ['zero', { plotNumber: 0 }],
      ['neg', { plotNumber: -1 }],
    ]),
    emptyPadMarkers: new Map(),
  };

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => 0,
  });

  assert.equal(count, 7);
  assert.equal(scene.children.length, 7);
  assert.equal(liveStore.emptyPadMarkers.has(2), true);
});

test('buildEmptyPadMarker aligns signpost and slab geometry within floating-point tolerance', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[1]; // plotNumber 2
  const group = buildEmptyPadMarker(THREE, plot, 0, () => ({ isFakeTexture: true }));
  const [slab, sign] = group.children;

  assert.ok(
    Math.abs((sign.position.z - sign.geometry.args[2] / 2) - slab.geometry.args[2] / 2) < 1e-9,
    'sign near face should be flush with slab edge (2.3)'
  );
  assert.ok(
    Math.abs((sign.position.y - sign.geometry.args[1] / 2) - 0.075) < 1e-9,
    'sign bottom should sit 0.075 above ground'
  );
  assert.ok(
    Math.abs((slab.position.y + slab.geometry.args[1] / 2) - 0.18) < 1e-9,
    'slab top should sit at 0.18'
  );

  assert.equal(slab.position.x, 0);
  assert.equal(slab.position.z, 0);
  assert.equal(sign.position.x, 2.0);
});
