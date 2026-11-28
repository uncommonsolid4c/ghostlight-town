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

test('plot ring geometry: all 8 plots lie on the 18.5 m ring with mirrored pairs', () => {
  assert.equal(TOWN_LAYOUT.plots.length, 8);
  for (const plot of TOWN_LAYOUT.plots) {
    assert.ok(
      Math.abs(Math.hypot(plot.x, plot.z) - 18.5) < 0.01,
      `plot ${plot.plotNumber} should lie on the 18.5 m ring`
    );
  }

  for (const [a, b] of [[1, 8], [2, 7], [3, 6], [4, 5]]) {
    const pa = TOWN_LAYOUT.plots[a - 1];
    const pb = TOWN_LAYOUT.plots[b - 1];
    assert.ok(Math.abs(pa.x + pb.x) < 1e-9, `plots ${a} and ${b} x should be mirrored`);
    assert.ok(Math.abs(pa.z - pb.z) < 1e-9, `plots ${a} and ${b} z should match`);
    assert.ok(Math.abs(pa.rotY + pb.rotY) < 1e-9, `plots ${a} and ${b} rotY should be mirrored`);
  }
});

test('buildEmptyPadMarker does not mutate the plot object and passes negative groundY through', () => {
  const THREE = makeFakeThree();
  const plot = { ...TOWN_LAYOUT.plots[3] };
  const snapshot = JSON.stringify(plot);

  buildEmptyPadMarker(THREE, plot, 1.0, () => ({}));
  assert.equal(JSON.stringify(plot), snapshot);

  const group = buildEmptyPadMarker(THREE, TOWN_LAYOUT.plots[1], -0.5, () => ({}));
  assert.equal(group.position.y, -0.5);
});

test('slab has no map, sign has no color, slab keeps the default name, sign userData holds only signpostText', () => {
  const THREE = makeFakeThree();
  const tex = { tex: 1 };
  const group = buildEmptyPadMarker(THREE, TOWN_LAYOUT.plots[1], 0, () => tex);
  const [slab, sign] = group.children;

  assert.equal(slab.material.map, undefined);
  assert.equal(slab.material.color, '#6e7278');
  assert.equal(sign.material.color, undefined);
  assert.equal(sign.material.map, tex);
  assert.equal(slab.name, '');
  assert.equal(sign.name, 'plot_2_signpost');
  assert.equal(Object.keys(slab.userData).length, 0);
  assert.deepEqual(sign.userData, { signpostText: 'OPEN PLOT #2' });
});

test('syncEmptyPadMarkers rebuilds a freed plot with a fresh texture object', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  let texCount = 0;
  const opts = {
    THREE,
    makeTextTexture: () => ({ texId: ++texCount }),
    groundAt: () => 0,
  };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(texCount, 7);
  const savedTex2 = liveStore.emptyPadMarkers.get(2).children[1].material.map;

  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.equal(texCount, 7);

  liveStore.plotAssignments.delete('wick');
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(texCount, 8);

  const rebuiltTex2 = liveStore.emptyPadMarkers.get(2).children[1].material.map;
  assert.notEqual(rebuiltTex2, savedTex2);
  assert.equal(rebuiltTex2.texId, 8);
});

test('syncEmptyPadMarkers tolerates assignment objects with extra fields', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);

  liveStore.plotAssignments.set('wick', {
    plotNumber: 2,
    handle: 'wick',
    manifest: { cottage: 'cabin' },
    plot_updated_at: 123,
  });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.equal(liveStore.emptyPadMarkers.has(2), false);
});

test('drift guard: staging empty-pad literals match town.js buildEmptyPlotPad including the deliberate groundY difference', () => {
  const townSrc = readFileSync(new URL('../town-3d/town.js', import.meta.url), 'utf8');
  const stagingSrc = readFileSync(new URL('./empty-pad.mjs', import.meta.url), 'utf8');

  const match = townSrc.match(/function buildEmptyPlotPad\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'buildEmptyPlotPad must exist in town-3d/town.js');
  const townBody = match[0];

  const literals = [
    'open_plot',
    'clickable',
    'plot_pad_',
    'OPEN PLOT #',
    'signpostText',
    'plot_${plot.plotNumber}_signpost',
  ];

  for (const lit of literals) {
    assert.ok(townBody.includes(lit), `town.js buildEmptyPlotPad missing literal: ${lit}`);
    assert.ok(stagingSrc.includes(lit), `staging-polyfork/empty-pad.mjs missing literal: ${lit}`);
  }

  assert.ok(
    townBody.includes('group.position.set(plot.x, 0, plot.z)'),
    'town.js buildEmptyPlotPad should hardcode ground y to 0'
  );
  assert.ok(
    stagingSrc.includes('group.position.set(plot.x, groundY, plot.z)'),
    'staging-polyfork/empty-pad.mjs should parameterize groundY'
  );
});

test('buildEmptyPadMarker creates distinct geometry and material instances per build and per mesh', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[1]; // plotNumber 2
  const g1 = buildEmptyPadMarker(THREE, plot, 0, () => ({}));
  const g2 = buildEmptyPadMarker(THREE, plot, 0, () => ({}));

  const [slab1, sign1] = g1.children;
  const [slab2, sign2] = g2.children;

  assert.notEqual(slab1.geometry, slab2.geometry);
  assert.notEqual(slab1.material, slab2.material);
  assert.notEqual(sign1.geometry, sign2.geometry);
  assert.notEqual(sign1.material, sign2.material);

  assert.notEqual(slab1.material, sign1.material);
  assert.notEqual(slab1.geometry, sign1.geometry);
});

test('buildEmptyPadMarker leaves group x/z rotations and child rotations at zero', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[1]; // plotNumber 2
  const group = buildEmptyPadMarker(THREE, plot, 0, () => ({}));
  const [slab, sign] = group.children;

  assert.equal(group.rotation.x, 0);
  assert.equal(group.rotation.y, plot.rotY);
  assert.equal(group.rotation.z, 0);
  assert.deepEqual(slab.rotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(sign.rotation, { x: 0, y: 0, z: 0 });
});

test('syncEmptyPadMarkers leaves stale foreign keys in emptyPadMarkers untouched and counts them in size', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const strayMarker = new THREE.Group();
  const liveStore = {
    plotAssignments: new Map(),
    emptyPadMarkers: new Map([[99, strayMarker]]),
  };

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => 0,
  });

  assert.equal(count, 8);
  assert.equal(liveStore.emptyPadMarkers.size, 8);
  assert.equal(liveStore.emptyPadMarkers.get(99), strayMarker);
  assert.equal(strayMarker.removedCount, 0);
  assert.equal(scene.children.length, 7);
});

test('syncEmptyPadMarkers removes an orphan pre-seeded marker cleanly on assignment', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const orphan = new THREE.Group();
  assert.equal(orphan.parent, null);
  const liveStore = {
    plotAssignments: new Map(),
    emptyPadMarkers: new Map([[2, orphan]]),
  };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  const count1 = syncEmptyPadMarkers(scene, liveStore, opts);
  assert.equal(count1, 7);
  assert.equal(scene.children.length, 6);

  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  const count2 = syncEmptyPadMarkers(scene, liveStore, opts);
  assert.equal(count2, 6);
  assert.equal(orphan.removedCount, 1);
  assert.equal(liveStore.emptyPadMarkers.has(2), false);
  assert.equal(scene.children.length, 6);
});

test('syncEmptyPadMarkers throws TypeError when plotAssignments contains a null entry', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = {
    plotAssignments: new Map([['ghost', null]]),
    emptyPadMarkers: new Map(),
  };

  assert.throws(
    () =>
      syncEmptyPadMarkers(scene, liveStore, {
        THREE,
        makeTextTexture: () => ({}),
        groundAt: () => 0,
      }),
    { name: 'TypeError', message: /plotNumber/ }
  );
});

test('buildEmptyPadMarker passes fresh lines array and options object to makeTextTexture per build', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[1]; // plotNumber 2
  const calls = [];
  const makeTextTexture = (_three, lines, opts) => {
    calls.push({ lines, opts });
    return {};
  };

  buildEmptyPadMarker(THREE, plot, 0, makeTextTexture);
  buildEmptyPadMarker(THREE, plot, 0, makeTextTexture);

  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].opts, calls[1].opts);
  assert.notEqual(calls[0].lines, calls[1].lines);
  assert.equal(JSON.stringify(calls[0].opts), JSON.stringify(calls[1].opts));
  assert.equal(JSON.stringify(calls[0].lines), JSON.stringify(calls[1].lines));
});

test('staging.js imports syncEmptyPadMarkers, wires both sync call sites, and handles open_plot clicks', () => {
  const stagingSrc = readFileSync(new URL('./staging.js', import.meta.url), 'utf8');

  assert.ok(
    stagingSrc.includes("import { syncEmptyPadMarkers } from './empty-pad.mjs?v=35';"),
    'staging.js must import syncEmptyPadMarkers from ./empty-pad.mjs?v=35'
  );

  const syncCalls = stagingSrc.match(/syncEmptyPadMarkers\(scene, liveStore, \{[\s\S]*?\}\);/g) || [];
  assert.equal(syncCalls.length, 2);
  for (const call of syncCalls) {
    assert.ok(call.includes('makeTextTexture: makeBandstandTextTexture,'));
    assert.ok(call.includes('groundAt: (x, z) => camp.groundAt(x, z),'));
  }

  assert.ok(stagingSrc.includes("if (kind === 'open_plot') {"));
  assert.ok(stagingSrc.includes('`OPEN PLOT #${target.userData.plotNumber} — no resident yet`'));
  assert.ok(stagingSrc.includes('infoStripEl.hidden = false;'));
});

test('drift guard: staging empty-pad rotation and position.set literals match town.js buildEmptyPlotPad', () => {
  const townSrc = readFileSync(new URL('../town-3d/town.js', import.meta.url), 'utf8');
  const stagingSrc = readFileSync(new URL('./empty-pad.mjs', import.meta.url), 'utf8');

  const match = townSrc.match(/function buildEmptyPlotPad\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'buildEmptyPlotPad must exist in town-3d/town.js');
  const townBody = match[0];

  const literals = [
    'group.rotation.y = plot.rotY',
    'pad.position.set(0, 0.09, 0)',
    'sign.position.set(2.0, 0.45, 2.35)',
  ];

  for (const lit of literals) {
    assert.ok(townBody.includes(lit), `town.js buildEmptyPlotPad missing literal: ${lit}`);
    assert.ok(stagingSrc.includes(lit), `staging-polyfork/empty-pad.mjs missing literal: ${lit}`);
  }
});

test('syncEmptyPadMarkers ignores fractional plotNumber 2.5 but removes marker 2 for 2.0', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);

  liveStore.plotAssignments.set('half', { plotNumber: 2.5 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(liveStore.emptyPadMarkers.has(2), true);

  liveStore.plotAssignments.set('whole', { plotNumber: 2.0 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.equal(liveStore.emptyPadMarkers.has(2), false);
});

test('buildEmptyPadMarker creates fresh userData objects per build with expected keys', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[1]; // plotNumber 2
  const g1 = buildEmptyPadMarker(THREE, plot, 0, () => ({}));
  const g2 = buildEmptyPadMarker(THREE, plot, 0, () => ({}));

  assert.notEqual(g1.userData, g2.userData);
  assert.notEqual(g1.children[1].userData, g2.children[1].userData);

  g1.userData.label = 'MUTATED';
  g1.children[1].userData.signpostText = 'MUTATED';

  assert.equal(g2.userData.label, 'OPEN PLOT #2');
  assert.equal(g2.children[1].userData.signpostText, 'OPEN PLOT #2');
  assert.deepEqual(Object.keys(g2.userData).sort(), ['clickable', 'kind', 'label', 'plotNumber']);
});

test('TOWN_LAYOUT constants are exact: clearing, plot ring, bandstand, gate, newsstand, notice board, inn, and all 8 plots', () => {
  assert.equal(TOWN_LAYOUT.clearingRadius, 30);
  assert.equal(TOWN_LAYOUT.plotRadius, 18.5);
  assert.deepEqual(TOWN_LAYOUT.bandstand, { x: 0, y: 0, z: 0, radius: 4.5, height: 0.6 });
  assert.deepEqual(TOWN_LAYOUT.gate, { x: 0, y: 0, z: 27 });
  assert.deepEqual(TOWN_LAYOUT.newsstand, { x: 6, y: 0, z: 14 });
  assert.deepEqual(TOWN_LAYOUT.noticeBoard, { x: -6, y: 0, z: 14 });
  assert.deepEqual(TOWN_LAYOUT.inn, { x: -11, y: 0, z: 20 });

  const expectedPlots = [
    [1, 17.919, 4.601, -1.8221],
    [2, 17.833, -4.922, -1.3015],
    [3, 13.023, -13.14, -0.7809],
    [4, 4.761, -17.877, -0.2603],
    [5, -4.761, -17.877, 0.2603],
    [6, -13.023, -13.14, 0.7809],
    [7, -17.833, -4.922, 1.3015],
    [8, -17.919, 4.601, 1.8221],
  ];
  assert.equal(TOWN_LAYOUT.plots.length, expectedPlots.length);
  for (let i = 0; i < expectedPlots.length; i++) {
    const [plotNumber, x, z, rotY] = expectedPlots[i];
    assert.deepEqual(TOWN_LAYOUT.plots[i], { plotNumber, x, y: 0, z, rotY });
  }
});

test('buildEmptyPadMarker material option objects are exact and children are real THREE instances', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[1]; // plotNumber 2
  const tex = { isKnownTexture: true };
  const group = buildEmptyPadMarker(THREE, plot, 0, () => tex);

  assert.ok(group instanceof THREE.Group);
  const [slab, sign] = group.children;
  assert.ok(slab instanceof THREE.Mesh);
  assert.ok(sign instanceof THREE.Mesh);
  assert.deepEqual(slab.material.opts, { color: '#6e7278', roughness: 0.95 });
  assert.deepEqual(sign.material.opts, { map: tex, roughness: 0.85 });
  assert.equal(slab.material.type, 'MeshStandardMaterial');
  assert.equal(sign.material.type, 'MeshStandardMaterial');
  assert.equal(slab.geometry.type, 'BoxGeometry');
  assert.equal(sign.geometry.type, 'BoxGeometry');
});

test('buildEmptyPadMarker ignores plot.y, passes Infinity and NaN groundY through, and builds a synthetic plot 9', () => {
  const THREE = makeFakeThree();
  const plotWithY = { ...TOWN_LAYOUT.plots[1], y: 5 };
  const g1 = buildEmptyPadMarker(THREE, plotWithY, 1.5, () => ({}));
  assert.equal(g1.position.y, 1.5);

  const gInf = buildEmptyPadMarker(THREE, TOWN_LAYOUT.plots[1], Infinity, () => ({}));
  assert.equal(gInf.position.y, Infinity);

  const gNaN = buildEmptyPadMarker(THREE, TOWN_LAYOUT.plots[1], NaN, () => ({}));
  assert.ok(Number.isNaN(gNaN.position.y));

  const syntheticPlot = { plotNumber: 9, x: 1, z: 2, rotY: 0.5 };
  const g9 = buildEmptyPadMarker(THREE, syntheticPlot, 0, () => ({}));
  assert.equal(g9.name, 'plot_pad_9');
  assert.equal(g9.userData.label, 'OPEN PLOT #9');
  assert.equal(g9.children[1].name, 'plot_9_signpost');
  assert.equal(g9.position.x, 1);
  assert.equal(g9.position.z, 2);
  assert.equal(g9.rotation.y, 0.5);
});

test('syncEmptyPadMarkers adds markers in plot order 2..8 with scene as parent and THREE as the texture first arg', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const texCalls = [];
  const makeTextTexture = (threeArg, lines, opts) => {
    texCalls.push({ threeArg, lines, opts });
    return {};
  };

  syncEmptyPadMarkers(scene, liveStore, { THREE, makeTextTexture, groundAt: () => 0 });

  assert.equal(scene.addCalls, 7);
  assert.equal(scene.children.length, 7);
  assert.equal(texCalls.length, 7);
  for (let i = 0; i < 7; i++) {
    assert.equal(scene.children[i].name, `plot_pad_${i + 2}`);
    assert.equal(scene.children[i].parent, scene);
    assert.equal(texCalls[i].threeArg, THREE);
    assert.deepEqual(texCalls[i].lines, [`OPEN PLOT #${i + 2}`]);
  }
});

test('syncEmptyPadMarkers error edges: undefined entry, NaN and -0 plotNumbers, missing plotAssignments, numeric Map key', () => {
  const THREE = makeFakeThree();
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.throws(
    () =>
      syncEmptyPadMarkers(
        makeFakeScene(),
        { plotAssignments: new Map([['ghost', undefined]]), emptyPadMarkers: new Map() },
        opts
      ),
    { name: 'TypeError', message: /plotNumber/ }
  );

  const sceneNan = makeFakeScene();
  const storeNan = {
    plotAssignments: new Map([
      ['nan', { plotNumber: NaN }],
      ['negZero', { plotNumber: -0 }],
    ]),
    emptyPadMarkers: new Map(),
  };
  assert.equal(syncEmptyPadMarkers(sceneNan, storeNan, opts), 7);
  assert.equal(storeNan.emptyPadMarkers.size, 7);
  assert.equal(sceneNan.children.length, 7);

  assert.throws(
    () => syncEmptyPadMarkers(makeFakeScene(), { emptyPadMarkers: new Map() }, opts),
    { name: 'TypeError', message: /values/ }
  );

  const sceneNum = makeFakeScene();
  const storeNum = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  assert.equal(syncEmptyPadMarkers(sceneNum, storeNum, opts), 7);
  storeNum.plotAssignments.set(2, { plotNumber: 2 });
  assert.equal(syncEmptyPadMarkers(sceneNum, storeNum, opts), 6);
  assert.equal(storeNum.emptyPadMarkers.has(2), false);
});

test('syncEmptyPadMarkers propagates texture and groundAt throws with partial state', () => {
  const THREE = makeFakeThree();

  const scene1 = makeFakeScene();
  const store1 = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const texErr = new Error('tex boom');
  assert.throws(
    () =>
      syncEmptyPadMarkers(scene1, store1, {
        THREE,
        makeTextTexture: (_three, lines) => {
          if (lines[0] === 'OPEN PLOT #4') throw texErr;
          return {};
        },
        groundAt: () => 0,
      }),
    (err) => err === texErr
  );
  assert.equal(store1.emptyPadMarkers.size, 2);
  assert.equal(store1.emptyPadMarkers.has(2), true);
  assert.equal(store1.emptyPadMarkers.has(3), true);
  assert.equal(store1.emptyPadMarkers.has(4), false);
  assert.equal(scene1.children.length, 2);
  assert.equal(scene1.addCalls, 2);

  const scene2 = makeFakeScene();
  const store2 = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const groundErr = new Error('ground boom');
  assert.throws(
    () =>
      syncEmptyPadMarkers(scene2, store2, {
        THREE,
        makeTextTexture: () => ({}),
        groundAt: () => {
          throw groundErr;
        },
      }),
    (err) => err === groundErr
  );
  assert.equal(store2.emptyPadMarkers.size, 0);
  assert.equal(scene2.children.length, 0);
});

test('syncEmptyPadMarkers keeps a pre-seeded orphan marker without adding it to the scene', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const orphan = new THREE.Group();
  assert.equal(orphan.parent, null);
  const liveStore = {
    plotAssignments: new Map(),
    emptyPadMarkers: new Map([[2, orphan]]),
  };

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => 0,
  });

  assert.equal(count, 7);
  assert.equal(scene.addCalls, 6);
  assert.equal(scene.children.length, 6);
  assert.equal(liveStore.emptyPadMarkers.get(2), orphan);
  assert.equal(orphan.parent, null);
  assert.equal(orphan.removedCount, 0);
});

test('plot angles step evenly around the ring and rotY recomputes from atan2', () => {
  const expectedStep = ((1.58 - 0.42) * Math.PI) / 7;
  for (let i = 0; i < TOWN_LAYOUT.plots.length - 1; i++) {
    const a = TOWN_LAYOUT.plots[i];
    const b = TOWN_LAYOUT.plots[i + 1];
    let diff = Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z);
    if (diff < -Math.PI) diff += 2 * Math.PI;
    assert.ok(
      Math.abs(diff - expectedStep) < 1e-3,
      `step between plots ${a.plotNumber} and ${b.plotNumber} should match expectedStep`
    );
  }

  for (const p of TOWN_LAYOUT.plots) {
    const recomputed = +Math.atan2(-p.x, -p.z).toFixed(4);
    assert.ok(
      Math.abs(recomputed - p.rotY) < 1e-4,
      `plot ${p.plotNumber} rotY should match recomputed atan2`
    );
  }
});

test('syncEmptyPadMarkers rebuilds two freed plots with fresh groundAt values and fresh textures', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  let groundY = 1.0;
  let texCount = 0;
  const opts = {
    THREE,
    makeTextTexture: () => ({ id: ++texCount }),
    groundAt: () => groundY,
  };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(texCount, 7);
  const old2 = liveStore.emptyPadMarkers.get(2);
  const old5 = liveStore.emptyPadMarkers.get(5);

  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  liveStore.plotAssignments.set('maren', { plotNumber: 5 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 5);

  groundY = 3.5;
  liveStore.plotAssignments.delete('wick');
  liveStore.plotAssignments.delete('maren');
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(texCount, 9);

  const new2 = liveStore.emptyPadMarkers.get(2);
  const new5 = liveStore.emptyPadMarkers.get(5);
  assert.notEqual(new2, old2);
  assert.notEqual(new5, old5);
  assert.equal(new2.position.y, 3.5);
  assert.equal(new5.position.y, 3.5);
  assert.equal(new2.children[1].material.map.id, 8);
  assert.equal(new5.children[1].material.map.id, 9);
});

test('test-file hygiene: unique names, no banned terms, exact import count, no live calls or wall-clock reads', () => {
  const src = readFileSync(new URL('./test-empty-pad.mjs', import.meta.url), 'utf8');
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 64);
  assert.equal(new Set(names).size, 64);

  assert.equal(src.toLowerCase().includes('camp' + 'fire'), false);
  assert.equal(src.includes('Math' + '.random'), false);
  assert.equal(src.includes('Date' + '.now'), false);
  assert.equal(src.includes('fet' + 'ch('), false);
  assert.equal(src.includes('TO' + 'DO'), false);
  assert.equal(src.includes('FIX' + 'ME'), false);

  const imports = [...src.matchAll(/^import\b[\s\S]*?\bfrom\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.equal(imports.length, 5);
  assert.deepEqual(imports, [
    'node:test',
    'node:assert/strict',
    'node:fs',
    './avatar.mjs',
    './empty-pad.mjs',
  ]);
});

test('syncEmptyPadMarkers appends a rebuilt marker at the end of scene.children', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  let groundY = 1.0;
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => groundY };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  const old2 = liveStore.emptyPadMarkers.get(2);

  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.deepEqual(scene.children.map((m) => m.name), [
    'plot_pad_3', 'plot_pad_4', 'plot_pad_5', 'plot_pad_6', 'plot_pad_7', 'plot_pad_8',
  ]);

  groundY = 2.5;
  liveStore.plotAssignments.delete('wick');
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);

  const new2 = liveStore.emptyPadMarkers.get(2);
  assert.notEqual(new2, old2);
  assert.equal(new2.position.y, 2.5);
  assert.equal(new2.parent, scene);
  assert.equal(scene.children[6], new2);
  assert.deepEqual(scene.children.map((m) => m.name), [
    'plot_pad_3', 'plot_pad_4', 'plot_pad_5', 'plot_pad_6', 'plot_pad_7', 'plot_pad_8', 'plot_pad_2',
  ]);
});

test('syncEmptyPadMarkers never builds a pre-assigned plot on first sync', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = {
    plotAssignments: new Map([['wick', { plotNumber: 2 }]]),
    emptyPadMarkers: new Map(),
  };
  const groundCalls = [];
  const texLines = [];

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: (_three, lines) => {
      texLines.push(lines[0]);
      return {};
    },
    groundAt: (x, z) => {
      groundCalls.push([x, z]);
      return 0;
    },
  });

  assert.equal(count, 6);
  assert.equal(scene.addCalls, 6);
  assert.equal(scene.children.length, 6);
  assert.equal(liveStore.emptyPadMarkers.has(2), false);

  const expectedPlots = TOWN_LAYOUT.plots.slice(2);
  assert.equal(groundCalls.length, 6);
  assert.deepEqual(groundCalls, expectedPlots.map((p) => [p.x, p.z]));
  assert.deepEqual(texLines, [
    'OPEN PLOT #3', 'OPEN PLOT #4', 'OPEN PLOT #5',
    'OPEN PLOT #6', 'OPEN PLOT #7', 'OPEN PLOT #8',
  ]);
});

test('syncEmptyPadMarkers rebuilds two freed plots in plot order at the end of scene.children', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  let groundY = 1.0;
  let texCount = 0;
  const opts = {
    THREE,
    makeTextTexture: () => ({ id: ++texCount }),
    groundAt: () => groundY,
  };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(texCount, 7);
  const old2 = liveStore.emptyPadMarkers.get(2);
  const old7 = liveStore.emptyPadMarkers.get(7);

  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  liveStore.plotAssignments.set('maren', { plotNumber: 7 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 5);
  assert.deepEqual(scene.children.map((m) => m.name), [
    'plot_pad_3', 'plot_pad_4', 'plot_pad_5', 'plot_pad_6', 'plot_pad_8',
  ]);

  groundY = 3.5;
  liveStore.plotAssignments.delete('wick');
  liveStore.plotAssignments.delete('maren');
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(texCount, 9);

  const new2 = liveStore.emptyPadMarkers.get(2);
  const new7 = liveStore.emptyPadMarkers.get(7);
  assert.notEqual(new2, old2);
  assert.notEqual(new7, old7);
  assert.equal(new2.position.y, 3.5);
  assert.equal(new7.position.y, 3.5);
  assert.equal(new2.children[1].material.map.id, 8);
  assert.equal(new7.children[1].material.map.id, 9);
  assert.deepEqual(scene.children.map((m) => m.name), [
    'plot_pad_3', 'plot_pad_4', 'plot_pad_5', 'plot_pad_6', 'plot_pad_8', 'plot_pad_2', 'plot_pad_7',
  ]);
});

test('syncEmptyPadMarkers trusts a pre-seeded marker under key 2 and never re-adds or rebuilds it', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const seeded = new THREE.Group();
  seeded.name = 'plot_pad_5';
  assert.equal(seeded.parent, null);
  const liveStore = {
    plotAssignments: new Map(),
    emptyPadMarkers: new Map([[2, seeded]]),
  };

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => 0,
  });

  assert.equal(count, 7);
  assert.equal(scene.addCalls, 6);
  assert.equal(scene.children.length, 6);
  assert.equal(liveStore.emptyPadMarkers.get(2), seeded);
  assert.equal(seeded.parent, null);
  assert.equal(seeded.removedCount, 0);
  assert.equal(seeded.name, 'plot_pad_5');
});

test('buildEmptyPadMarker builds plot 1 by name and label when called directly', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[0];
  assert.equal(plot.plotNumber, 1);
  const texCalls = [];
  const makeTextTexture = (threeArg, lines, opts) => {
    texCalls.push({ threeArg, lines, opts });
    return { isFakeTexture: true };
  };

  const group = buildEmptyPadMarker(THREE, plot, 0.75, makeTextTexture);

  assert.equal(group.name, 'plot_pad_1');
  assert.deepEqual(group.userData, {
    clickable: true,
    kind: 'open_plot',
    plotNumber: 1,
    label: 'OPEN PLOT #1',
  });
  assert.equal(group.position.x, plot.x);
  assert.equal(group.position.y, 0.75);
  assert.equal(group.position.z, plot.z);
  assert.equal(group.rotation.y, plot.rotY);

  const [, sign] = group.children;
  assert.equal(sign.name, 'plot_1_signpost');
  assert.deepEqual(sign.userData, { signpostText: 'OPEN PLOT #1' });
  assert.deepEqual(texCalls[0].lines, ['OPEN PLOT #1']);
});

test('syncEmptyPadMarkers scene.add runs before the marker lands in emptyPadMarkers', () => {
  const THREE = makeFakeThree();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const seenAtAdd = [];
  const scene = {
    children: [],
    addCalls: 0,
    add(obj) {
      this.addCalls++;
      const n = Number(obj.name.replace('plot_pad_', ''));
      seenAtAdd.push([n, liveStore.emptyPadMarkers.has(n)]);
      obj.parent = this;
      this.children.push(obj);
    },
  };

  assert.equal(
    syncEmptyPadMarkers(scene, liveStore, {
      THREE,
      makeTextTexture: () => ({}),
      groundAt: () => 0,
    }),
    7
  );

  assert.equal(scene.addCalls, 7);
  assert.deepEqual(seenAtAdd, [
    [2, false], [3, false], [4, false], [5, false], [6, false], [7, false], [8, false],
  ]);
  for (let n = 2; n <= 8; n++) {
    assert.equal(liveStore.emptyPadMarkers.has(n), true);
  }
});

test('syncEmptyPadMarkers rebuild throw leaves the freed plot absent and the other six intact', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  const normal = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, normal), 7);

  liveStore.plotAssignments.set('maren', { plotNumber: 3 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, normal), 6);

  liveStore.plotAssignments.delete('maren');
  const texErr = new Error('tex boom 3');
  assert.throws(
    () =>
      syncEmptyPadMarkers(scene, liveStore, {
        THREE,
        makeTextTexture: (_three, lines) => {
          if (lines[0] === 'OPEN PLOT #3') throw texErr;
          return {};
        },
        groundAt: () => 0,
      }),
    (err) => err === texErr
  );

  assert.equal(liveStore.emptyPadMarkers.has(3), false);
  assert.equal(liveStore.emptyPadMarkers.size, 6);
  assert.equal(scene.children.length, 6);
  assert.equal(scene.addCalls, 7);
  for (const n of [2, 4, 5, 6, 7, 8]) {
    assert.equal(liveStore.emptyPadMarkers.has(n), true);
  }
});

test('syncEmptyPadMarkers counts a stale foreign key after a removal and a rebuild', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const stray = new THREE.Group();
  const liveStore = {
    plotAssignments: new Map([['wick', { plotNumber: 2 }]]),
    emptyPadMarkers: new Map([[99, stray]]),
  };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(liveStore.emptyPadMarkers.size, 7);
  assert.equal(liveStore.emptyPadMarkers.get(99), stray);
  assert.equal(stray.removedCount, 0);
  assert.equal(scene.children.length, 6);
  assert.equal(liveStore.emptyPadMarkers.has(2), false);

  liveStore.plotAssignments.delete('wick');
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 8);
  assert.equal(liveStore.emptyPadMarkers.size, 8);
  assert.equal(scene.children.length, 7);
  assert.equal(liveStore.emptyPadMarkers.has(2), true);
});

test('syncEmptyPadMarkers plot-1 assign-then-free cycle builds nothing new', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  let texCount = 0;
  const opts = {
    THREE,
    makeTextTexture: () => {
      texCount++;
      return {};
    },
    groundAt: () => 0,
  };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(texCount, 7);
  const snapshot = new Map(liveStore.emptyPadMarkers);

  liveStore.plotAssignments.set('milo', { plotNumber: 1 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(scene.addCalls, 7);
  assert.equal(texCount, 7);

  liveStore.plotAssignments.delete('milo');
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(scene.addCalls, 7);
  assert.equal(texCount, 7);
  for (let n = 2; n <= 8; n++) {
    assert.equal(liveStore.emptyPadMarkers.get(n), snapshot.get(n));
  }
});

test('syncEmptyPadMarkers throws TypeError when emptyPadMarkers is a non-Map object', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.throws(
    () =>
      syncEmptyPadMarkers(scene, { plotAssignments: new Map(), emptyPadMarkers: {} }, opts),
    { name: 'TypeError', message: /get is not a function/ }
  );
  assert.throws(
    () =>
      syncEmptyPadMarkers(scene, { plotAssignments: new Map(), emptyPadMarkers: [] }, opts),
    { name: 'TypeError', message: /get is not a function/ }
  );
});

test('buildEmptyPadMarker handles synthetic plotNumber 0 and string plotNumber 2', () => {
  const THREE = makeFakeThree();
  const makeTextTexture = () => ({});

  const g0 = buildEmptyPadMarker(THREE, { plotNumber: 0, x: 1, z: 2, rotY: 0.5 }, 0, makeTextTexture);
  assert.equal(g0.name, 'plot_pad_0');
  assert.equal(g0.userData.label, 'OPEN PLOT #0');
  assert.equal(g0.userData.plotNumber, 0);
  assert.equal(g0.children[1].name, 'plot_0_signpost');
  assert.deepEqual(g0.children[1].userData, { signpostText: 'OPEN PLOT #0' });

  const gStr = buildEmptyPadMarker(THREE, { plotNumber: '2', x: 1, z: 2, rotY: 0 }, 0, makeTextTexture);
  assert.equal(gStr.name, 'plot_pad_2');
  assert.equal(gStr.userData.label, 'OPEN PLOT #2');
  assert.equal(gStr.userData.plotNumber, '2');
  assert.equal(gStr.children[1].name, 'plot_2_signpost');
});

test('buildEmptyPadMarker passes non-numeric groundY values through unchanged', () => {
  const THREE = makeFakeThree();
  const plot = TOWN_LAYOUT.plots[1];
  const makeTextTexture = () => ({});

  assert.equal(buildEmptyPadMarker(THREE, plot, '1.5', makeTextTexture).position.y, '1.5');
  assert.equal(buildEmptyPadMarker(THREE, plot, null, makeTextTexture).position.y, null);
  assert.equal(buildEmptyPadMarker(THREE, plot, undefined, makeTextTexture).position.y, undefined);
});

test('syncEmptyPadMarkers ignores non-object plotAssignments entries without throwing', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = {
    plotAssignments: new Map([['str', 'wick'], ['num', 5]]),
    emptyPadMarkers: new Map(),
  };

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => 0,
  });

  assert.equal(count, 7);
  assert.equal(scene.children.length, 7);
  assert.equal(liveStore.emptyPadMarkers.size, 7);
});

test('syncEmptyPadMarkers does not match BigInt plotNumber 2n to plot 2', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = {
    plotAssignments: new Map([['big', { plotNumber: 2n }]]),
    emptyPadMarkers: new Map(),
  };

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => 0,
  });

  assert.equal(count, 7);
  assert.equal(liveStore.emptyPadMarkers.has(2), true);
  assert.equal(scene.children.length, 7);
});

test('syncEmptyPadMarkers skips two pre-assigned plots on first sync in plot order', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = {
    plotAssignments: new Map([['wick', { plotNumber: 2 }], ['tomas', { plotNumber: 8 }]]),
    emptyPadMarkers: new Map(),
  };
  const groundCalls = [];
  const texLines = [];

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: (_three, lines) => {
      texLines.push(lines[0]);
      return {};
    },
    groundAt: (x, z) => {
      groundCalls.push([x, z]);
      return 0;
    },
  });

  assert.equal(count, 5);
  assert.equal(scene.addCalls, 5);
  assert.deepEqual(
    scene.children.map((m) => m.name),
    ['plot_pad_3', 'plot_pad_4', 'plot_pad_5', 'plot_pad_6', 'plot_pad_7']
  );
  assert.deepEqual(
    groundCalls,
    TOWN_LAYOUT.plots.slice(2, 7).map((p) => [p.x, p.z])
  );
  assert.deepEqual(texLines, [
    'OPEN PLOT #3',
    'OPEN PLOT #4',
    'OPEN PLOT #5',
    'OPEN PLOT #6',
    'OPEN PLOT #7',
  ]);
  assert.equal(liveStore.emptyPadMarkers.has(2), false);
  assert.equal(liveStore.emptyPadMarkers.has(8), false);
});

test('syncEmptyPadMarkers full assign-all then free-all cycle rebuilds fresh markers in plot order', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const liveStore = { plotAssignments: new Map(), emptyPadMarkers: new Map() };
  let texCount = 0;
  const opts = {
    THREE,
    makeTextTexture: () => {
      texCount++;
      return {};
    },
    groundAt: () => 0,
  };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(texCount, 7);
  const saved = new Map(liveStore.emptyPadMarkers);

  const handles = ['h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'];
  handles.forEach((h, i) => liveStore.plotAssignments.set(h, { plotNumber: i + 2 }));
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 0);
  assert.equal(scene.children.length, 0);

  handles.forEach((h) => liveStore.plotAssignments.delete(h));
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(texCount, 14);
  assert.deepEqual(
    scene.children.map((m) => m.name),
    ['plot_pad_2', 'plot_pad_3', 'plot_pad_4', 'plot_pad_5', 'plot_pad_6', 'plot_pad_7', 'plot_pad_8']
  );
  for (let n = 2; n <= 8; n++) {
    assert.notEqual(liveStore.emptyPadMarkers.get(n), saved.get(n));
  }
});

test('syncEmptyPadMarkers preserves stale foreign key when all seven plots are assigned', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const stray = new THREE.Group();
  const liveStore = {
    plotAssignments: new Map(),
    emptyPadMarkers: new Map([[99, stray]]),
  };
  const handles = ['h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'];
  handles.forEach((h, i) => liveStore.plotAssignments.set(h, { plotNumber: i + 2 }));

  const count = syncEmptyPadMarkers(scene, liveStore, {
    THREE,
    makeTextTexture: () => ({}),
    groundAt: () => 0,
  });

  assert.equal(count, 1);
  assert.equal(liveStore.emptyPadMarkers.size, 1);
  assert.equal(liveStore.emptyPadMarkers.get(99), stray);
  assert.equal(stray.removedCount, 0);
  assert.equal(scene.children.length, 0);
  assert.equal(scene.addCalls, 0);
});

test('syncEmptyPadMarkers removes a seeded in-scene marker on plot assignment', () => {
  const THREE = makeFakeThree();
  const scene = makeFakeScene();
  const seeded = new THREE.Group();
  seeded.name = 'plot_pad_2';
  scene.add(seeded);
  const liveStore = {
    plotAssignments: new Map(),
    emptyPadMarkers: new Map([[2, seeded]]),
  };
  const opts = { THREE, makeTextTexture: () => ({}), groundAt: () => 0 };

  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 7);
  assert.equal(scene.addCalls, 7);
  assert.equal(scene.children.length, 7);
  assert.equal(liveStore.emptyPadMarkers.get(2), seeded);
  assert.equal(seeded.parent, scene);

  liveStore.plotAssignments.set('wick', { plotNumber: 2 });
  assert.equal(syncEmptyPadMarkers(scene, liveStore, opts), 6);
  assert.equal(seeded.removedCount, 1);
  assert.equal(seeded.parent, null);
  assert.equal(liveStore.emptyPadMarkers.has(2), false);
  assert.equal(scene.children.includes(seeded), false);
  assert.equal(scene.children.length, 6);
});

test('empty-pad.mjs source shape pins function counts and single-statement invariants', () => {
  const src = readFileSync(new URL('./empty-pad.mjs', import.meta.url), 'utf8');
  const countOf = (needle) => src.split(needle).length - 1;

  assert.equal(countOf('buildEmptyPadMarker'), 2);
  assert.equal(countOf('syncEmptyPadMarkers'), 1);
  assert.equal(countOf('emptyPadMarkers'), 6);
  assert.equal(countOf('removeFromParent'), 1);
  assert.equal(countOf('scene.add(group);'), 1);
  assert.ok(src.includes('TOWN_LAYOUT.plots.slice(1)'));
  assert.ok(src.includes('liveStore.emptyPadMarkers = new Map();'));
  assert.ok(src.includes('existing.removeFromParent();'));
  assert.ok(src.includes('return liveStore.emptyPadMarkers.size;'));
});

test('staging.js creates liveStore before first sync and wires open_plot info strip without overlays', () => {
  const src = readFileSync(new URL('./staging.js', import.meta.url), 'utf8');
  const storeFn = src.match(/function createStagingLiveStore\(\) \{[\s\S]*?\n\}/);
  assert.ok(storeFn, 'createStagingLiveStore must exist');
  assert.ok(storeFn[0].includes('plotAssignments: new Map(),'));
  assert.ok(storeFn[0].includes('emptyPadMarkers: new Map(),'));
  assert.ok(
    storeFn[0].indexOf('plotAssignments: new Map(),') <
      storeFn[0].indexOf('emptyPadMarkers: new Map(),')
  );

  const liveStoreCall = src.indexOf('const liveStore = createStagingLiveStore();');
  const firstSync = src.indexOf('syncEmptyPadMarkers(scene, liveStore, {');
  assert.ok(liveStoreCall !== -1 && firstSync > liveStoreCall);

  const branchStart = src.indexOf("if (kind === 'open_plot') {");
  assert.ok(branchStart !== -1);
  const branchEnd = src.indexOf('return true;', branchStart);
  assert.ok(branchEnd !== -1);
  const branch = src.slice(branchStart, branchEnd);

  assert.ok(branch.includes('`OPEN PLOT #${target.userData.plotNumber} — no resident yet`'));
  assert.ok(branch.includes('infoStripEl.hidden = false;'));
  assert.equal(branch.includes('openGuestbookOverlay'), false);
  assert.equal(branch.includes('openPlotOverlay'), false);
});
