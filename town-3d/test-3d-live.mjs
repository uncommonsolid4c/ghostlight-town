import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TOWN_LAYOUT,
  MILO_REBUILD_MANIFEST,
  FOOTLIGHT_COLORS,
  buildTown,
  applyState,
  applyPlotManifest,
  updateTownAnimations,
  renderPromptBook,
  TownLive,
} from './town.js';
import { createTownServer } from '../town-api/server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from '../town-api/ghostlight-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createThreeStub() {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }
  class Euler {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }
  class Matrix4 {
    constructor() {
      this.elements = new Array(16).fill(0);
    }
    makeTranslation() { return this; }
    makeRotationY() { return this; }
    makeScale() { return this; }
    multiply() { return this; }
    compose() { return this; }
  }
  class Quaternion {
    setFromEuler() { return this; }
  }
  class Object3D {
    constructor() {
      this.name = '';
      this.children = [];
      this.parent = null;
      this.position = new Vector3();
      this.rotation = new Euler();
      this.scale = new Vector3(1, 1, 1);
      this.matrix = new Matrix4();
      this.userData = {};
    }
    add(...objs) {
      for (const obj of objs) {
        obj.parent = this;
        this.children.push(obj);
      }
      return this;
    }
    remove(obj) {
      const idx = this.children.indexOf(obj);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        obj.parent = null;
      }
      return this;
    }
    updateMatrix() {}
  }
  class Scene extends Object3D {
    constructor() {
      super();
      this.type = 'Scene';
      this.fog = null;
    }
  }
  class Group extends Object3D {
    constructor() {
      super();
      this.type = 'Group';
    }
  }
  class Mesh extends Object3D {
    constructor(geometry, material) {
      super();
      this.type = 'Mesh';
      this.isMesh = true;
      this.geometry = geometry;
      this.material = material;
    }
  }
  class InstancedMesh extends Mesh {
    constructor(geometry, material, count) {
      super(geometry, material);
      this.type = 'InstancedMesh';
      this.isInstancedMesh = true;
      this.count = count;
      this.matrices = new Array(count);
    }
    setMatrixAt(index, matrix) {
      this.matrices[index] = matrix;
    }
  }
  class Sprite extends Object3D {
    constructor(material) {
      super();
      this.type = 'Sprite';
      this.isSprite = true;
      this.material = material;
    }
  }
  class Geometry {
    constructor(type, parameters) {
      this.type = type;
      this.parameters = parameters;
    }
  }
  class Material {
    constructor(type, params = {}) {
      this.type = type;
      Object.assign(this, params);
    }
  }
  class Light extends Object3D {
    constructor(type, color, intensity, distance) {
      super();
      this.type = type;
      this.color = color;
      this.intensity = intensity;
      this.distance = distance;
    }
  }
  class CanvasTexture {
    constructor(image) {
      this.type = 'CanvasTexture';
      this.image = image;
      this.needsUpdate = false;
    }
  }
  class Fog {
    constructor(color, near, far) {
      this.color = color;
      this.near = near;
      this.far = far;
    }
  }

  return {
    BackSide: 1,
    Vector3,
    Euler,
    Matrix4,
    Quaternion,
    Object3D,
    Scene,
    Group,
    Mesh,
    InstancedMesh,
    Sprite,
    BoxGeometry: class extends Geometry { constructor(w, h, d) { super('BoxGeometry', { w, h, d }); } },
    CylinderGeometry: class extends Geometry { constructor(rt, rb, h, rs) { super('CylinderGeometry', { rt, rb, h, rs }); } },
    ConeGeometry: class extends Geometry { constructor(r, h, rs) { super('ConeGeometry', { r, h, rs }); } },
    SphereGeometry: class extends Geometry { constructor(r, ws, hs) { super('SphereGeometry', { r, ws, hs }); } },
    CircleGeometry: class extends Geometry { constructor(r, s) { super('CircleGeometry', { r, s }); } },
    PlaneGeometry: class extends Geometry { constructor(w, h) { super('PlaneGeometry', { w, h }); } },
    MeshStandardMaterial: class extends Material { constructor(p) { super('MeshStandardMaterial', p); } },
    MeshBasicMaterial: class extends Material { constructor(p) { super('MeshBasicMaterial', p); } },
    SpriteMaterial: class extends Material { constructor(p) { super('SpriteMaterial', p); } },
    PointLight: class extends Light { constructor(c, i, d) { super('PointLight', c, i, d); } },
    DirectionalLight: class extends Light { constructor(c, i) { super('DirectionalLight', c, i); } },
    AmbientLight: class extends Light { constructor(c, i) { super('AmbientLight', c, i); } },
    CanvasTexture,
    Fog,
  };
}

function collectNodes(root, predicate, out = []) {
  if (predicate(root)) out.push(root);
  for (const child of root.children || []) {
    collectNodes(child, predicate, out);
  }
  return out;
}

function createDomStub() {
  class El {
    constructor(tag) {
      this.tagName = tag;
      this.className = '';
      this.children = [];
      this._textContent = '';
    }
    get firstChild() {
      return this.children[0] || null;
    }
    set textContent(v) {
      this._textContent = String(v);
    }
    get textContent() {
      if (this.children.length === 0) return this._textContent;
      return this.children.map((c) => c.textContent).join('');
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i !== -1) this.children.splice(i, 1);
      return child;
    }
  }
  return {
    createElement(tag) {
      return new El(tag);
    },
  };
}

test('applyState lights muse and npc footlights, extinguishes absent ones, and places/removes avatars without stacking', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE);

  // Assign carol a plot first so plot:carol presence can target her cottage
  applyPlotManifest(town, 'carol', {
    cottage: 'cabin',
    wall: '#ccbbaa',
    roof: '#443322',
    trim: '#ffffff',
    signpost_text: 'Carol Cabin',
    props: [],
  });

  const live = applyState(town, {
    state_seq: 1,
    footlights: [
      { handle: 'alice', status_text: 'tea', lit_at: 100, expires_at: 2800, slot: 3, role: 'muse' },
      { handle: 'trimmer', status_text: 'wick', lit_at: 100, expires_at: 2800, slot: 7, role: 'npc' },
    ],
    presence: [
      { handle: 'bob', zone: 'bandstand', updated_at: 100, role: 'muse' },
      { handle: 'erin', zone: 'bandstand', updated_at: 100, role: 'muse' },
      { handle: 'carol', zone: 'plot:carol', updated_at: 100, role: 'muse' },
      { handle: 'trimmer', zone: 'gate', updated_at: 100, role: 'npc' },
    ],
    prompt_book: [
      { id: 1, handle: 'alice', kind: 'say', body: 'hello', created_at: 100, role: 'muse' },
      { id: 2, handle: 'trimmer', kind: 'emote', body: 'sweeps', created_at: 101, role: 'npc' },
    ],
  });

  // Footlight slot 3 lit as muse, slot 7 lit as npc, slot 0 stays lit as
  // Milo's permanent footlight, all others dark
  for (const fl of town.parts.footlights) {
    const slot = fl.userData.slot;
    if (slot === 0) {
      assert.equal(fl.userData.lit, true, 'Milo permanent footlight stays lit');
      assert.equal(fl.userData.handle, 'milo');
      assert.equal(fl.userData.shell.material.emissive, FOOTLIGHT_COLORS.muse.emissive);
    } else if (slot === 3) {
      assert.equal(fl.userData.lit, true);
      assert.equal(fl.userData.handle, 'alice');
      assert.equal(fl.userData.shell.material.emissive, FOOTLIGHT_COLORS.muse.emissive);
      assert.ok(fl.userData.placard.rotation.x < 0, 'lit placard flips up');
    } else if (slot === 7) {
      assert.equal(fl.userData.lit, true);
      assert.equal(fl.userData.handle, 'trimmer');
      assert.equal(fl.userData.shell.material.emissive, FOOTLIGHT_COLORS.npc.emissive);
    } else {
      assert.equal(fl.userData.lit, false);
      assert.equal(fl.userData.shell.material.emissive, FOOTLIGHT_COLORS.unlit.emissive);
    }
  }

  // Avatars: bob and erin at bandstand must get distinct spots
  const bobAvatar = live.avatars.get('bob');
  const erinAvatar = live.avatars.get('erin');
  assert.ok(bobAvatar && erinAvatar);
  const distBobErin = Math.hypot(
    bobAvatar.position.x - erinAvatar.position.x,
    bobAvatar.position.z - erinAvatar.position.z
  );
  assert.ok(distBobErin > 0.5, 'bandstand avatars must never stack at one point');

  // Carol at plot:carol near carol's plot layout
  const carolAvatar = live.avatars.get('carol');
  const carolPlot = live.plotAssignments.get('carol').layout;
  const distToPlot = Math.hypot(
    carolAvatar.position.x - carolPlot.x,
    carolAvatar.position.z - carolPlot.z
  );
  assert.ok(distToPlot < 5, `carol avatar should be near her plot, got dist ${distToPlot}`);

  // Prompt book model
  assert.equal(live.promptBook.length, 2);
  assert.equal(live.promptBook[0].handle, 'alice');
  assert.equal(live.promptBook[1].role, 'npc');

  // Next state: slot 3 footlight absent (expired), bob removed from presence, erin moves to gate
  applyState(town, {
    state_seq: 2,
    footlights: [
      { handle: 'trimmer', status_text: 'wick', lit_at: 100, expires_at: 2800, slot: 7, role: 'npc' },
    ],
    presence: [
      { handle: 'erin', zone: 'gate', updated_at: 105, role: 'muse' },
    ],
    prompt_book: [],
  });

  assert.equal(town.parts.footlights[3].userData.lit, false, 'expired footlight goes dark');
  assert.equal(town.parts.footlights[7].userData.lit, true);
  assert.equal(live.avatars.has('bob'), false, 'removed handle deletes avatar');
  assert.equal(collectNodes(town.scene, (n) => n.name === 'avatar_bob').length, 0);

  // Smooth lerp toward new target
  const startZ = erinAvatar.position.z;
  updateTownAnimations(town, 0.25);
  assert.ok(erinAvatar.position.z > startZ, 'avatar should lerp toward gate target');
  updateTownAnimations(town, 0.5);
  assert.equal(erinAvatar.position.z, erinAvatar.userData.target.z);
});

test('renderPromptBook caps at 100 lines, preserves newest-at-bottom order, and escapes via textContent', () => {
  const doc = createDomStub();
  const container = doc.createElement('div');
  const lines = Array.from({ length: 120 }, (_, i) => ({
    id: i + 1,
    handle: i === 119 ? 'trimmer' : 'alice',
    kind: i === 119 ? 'emote' : 'say',
    body: i === 119 ? '<script>alert(1)</script>' : `line ${i + 1}`,
    created_at: 1000 + i,
    role: i === 119 ? 'npc' : 'muse',
  }));

  renderPromptBook(container, lines, doc);
  assert.equal(container.children.length, 100);
  assert.ok(container.children[0].textContent.includes('line 21'));
  const last = container.children[99];
  assert.ok(last.textContent.includes('[NPC]'));
  assert.ok(last.textContent.includes('<script>alert(1)</script>'));
});

test('TownLive polling handles ?since=, 304, 500 backoff, malformed JSON, and plot manifests', async () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE);

  const calls = [];
  let mode = 'first';
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('/api/town/plot?handle=dave')) {
      return {
        status: 200,
        async json() {
          return {
            handle: 'dave',
            plot_updated_at: 500,
            manifest: {
              cottage: 'tower',
              wall: '#224466',
              roof: '#883322',
              trim: '#eeddcc',
              signpost_text: 'Dave Tower',
              props: [],
            },
          };
        },
      };
    }
    if (url.includes('/api/town/plot?handle=failing')) {
      throw new Error('plot fetch failed');
    }
    if (mode === 'first') {
      return {
        status: 200,
        async json() {
          return {
            state_seq: 42,
            footlights: [{ handle: 'dave', status_text: 'hi', lit_at: 1, expires_at: 9999, slot: 1, role: 'muse' }],
            presence: [
              { handle: 'dave', zone: 'bandstand', updated_at: 1, role: 'muse' },
              { handle: 'failing', zone: 'gate', updated_at: 1, role: 'muse' },
              { handle: 'milo', zone: 'bandstand', updated_at: 1, role: 'muse' },
            ],
            prompt_book: [{ id: 1, handle: 'dave', kind: 'say', body: 'tower built', created_at: 1, role: 'muse' }],
          };
        },
      };
    }
    if (mode === '304') {
      return { status: 304 };
    }
    if (mode === '500') {
      return { status: 500 };
    }
    if (mode === 'badjson') {
      return {
        status: 200,
        async json() {
          throw new SyntaxError('Unexpected token');
        },
      };
    }
    return { status: 500 };
  };

  const live = new TownLive(town, {
    fetch: fakeFetch,
    apiBase: '',
    pollIntervalMs: 5000,
    maxBackoffMs: 20000,
    timer: { setInterval: () => 1, clearInterval: () => {} },
  });

  // First poll: no ?since
  const r1 = await live.pollOnce();
  assert.equal(r1.changed, true);
  assert.equal(calls[0], '/api/town/state');
  assert.equal(live.lastSeq, 42);

  // Dave's tower manifest was fetched and built onto a pad with manifest colors
  const daveCottage = collectNodes(town.scene, (n) => n.name === 'cottage_dave')[0];
  assert.ok(daveCottage, 'dave tower cottage should be added to scene');
  const daveBody = collectNodes(daveCottage, (n) => n.name === 'tower_body')[0];
  assert.equal(daveBody.material.color, '#224466');

  // Milo's cottage (plot 1) is never replaced
  assert.equal(town.parts.milosCottage.userData.cottageStyle, MILO_REBUILD_MANIFEST.cottage);
  assert.ok(collectNodes(town.scene, (n) => n.name === 'milos_cottage').length === 1);
  assert.equal(applyPlotManifest(town, 'milo', { cottage: 'tower', wall: '#000000' }), null);

  // Failing plot fetch did not throw and left remaining pads empty
  assert.equal(town._live.plotAssignments.has('failing'), false);

  // Second poll: sends ?since=42, gets 304
  mode = '304';
  const r2 = await live.pollOnce();
  assert.equal(r2.changed, false);
  assert.equal(r2.status, 304);
  assert.ok(calls.includes('/api/town/state?since=42'));

  // 500 response backs off (doubles interval) and preserves lastState
  mode = '500';
  const r3 = await live.pollOnce();
  assert.equal(r3.changed, false);
  assert.equal(live.currentIntervalMs, 10000);
  assert.equal(live.lastSeq, 42);

  // Malformed JSON backs off further and does not crash
  mode = 'badjson';
  const r4 = await live.pollOnce();
  assert.equal(r4.changed, false);
  assert.equal(live.currentIntervalMs, 20000);
  assert.equal(live.lastSeq, 42);
});

test('Static checks: no campfire, sandbox="", no hardcoded homelab API base, textContent prompt book', async () => {
  const indexHtml = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const townJs = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');

  assert.equal(/campfire/i.test(indexHtml), false, 'index.html must not contain campfire terminology');
  assert.equal(/campfire/i.test(townJs), false, 'town.js must not contain campfire terminology');

  // Iframe has sandbox="" with zero allow-* exceptions
  const iframeMatch = indexHtml.match(/<iframe\b[^>]*>/i);
  assert.ok(iframeMatch, 'index.html must contain an iframe');
  assert.ok(/sandbox=""/.test(iframeMatch[0]), 'iframe must have sandbox=""');
  assert.equal(/allow-/i.test(iframeMatch[0]), false, 'iframe must not have any allow-* sandbox exceptions');

  // No hardcoded homelab host/IP/port as API base
  assert.match(indexHtml, /const API_BASE\s*=\s*''/);
  for (const forbidden of ['100.105', '8123', '8124']) {
    assert.equal(townJs.includes(forbidden), false, `town.js must not contain ${forbidden}`);
    assert.equal(indexHtml.includes(forbidden), false, `index.html must not contain ${forbidden}`);
  }
  assert.equal(townJs.includes('milo.4167360'), false, 'town.js must not contain milo.4167360');

  // Prompt book rendering uses textContent and never innerHTML
  assert.equal(/\.innerHTML\s*=/.test(townJs), false, 'town.js must never assign innerHTML');
  assert.equal(/\.innerHTML\s*=/.test(indexHtml), false, 'index.html must never assign innerHTML');
  assert.ok(/\.textContent\s*=/.test(townJs), 'town.js must render Prompt Book with textContent');
});

test('Live smoke test: booted town-api server + TownLive polling + 304 on ?since=', async () => {
  const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-3d-smoke-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const museKeys = generateKeypair();
    const npcKeys = generateKeypair();
    const muse = new GhostlightClient({ baseUrl, handle: 'alice', ...museKeys });
    const npc = new GhostlightClient({ baseUrl, handle: 'trimmer', ...npcKeys });

    await muse.join({ origin: 'musebook', bio: 'Muse' });
    await npc.join({ origin: 'colony', bio: 'NPC' });

    for (const h of ['alice', 'trimmer']) {
      const signed = signRequest({
        method: 'POST',
        path: '/api/town/admin/approve',
        body: { handle: h },
        handle: 'milo-op',
        privateKeyPem: operatorKeys.privateKeyPem,
      });
      const r = await fetch(`${baseUrl}/api/town/admin/approve`, {
        method: 'POST',
        headers: signed.headers,
        body: signed.rawBody,
      });
      assert.equal(r.status, 200);
    }
    db.prepare("UPDATE residents SET role = 'npc' WHERE handle = ?").run('trimmer');

    await muse.checkin({ status_text: 'arrived' });
    await muse.say('hello ghostlight');
    const p1 = await muse.presence('bandstand');
    assert.equal(p1.status, 200);
    const p2 = await npc.presence('gate');
    assert.equal(p2.status, 200);

    const THREE = createThreeStub();
    const town = buildTown(THREE);
    const live = new TownLive(town, { fetch, apiBase: baseUrl });

    const first = await live.pollOnce();
    assert.equal(first.changed, true);
    assert.equal(first.status, 200);
    assert.ok(first.state.footlights.some((f) => f.handle === 'alice' && f.role === 'muse'));
    assert.ok(first.state.prompt_book.some((p) => p.handle === 'alice' && p.role === 'muse'));
    assert.ok(first.state.presence.some((p) => p.handle === 'trimmer' && p.role === 'npc'));

    const second = await live.pollOnce();
    assert.equal(second.changed, false);
    assert.equal(second.status, 304);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Lit footlight emissive intensities stay at or under 1.0 (no white-out)', () => {
  // Regression guard (2026-11-12): the pale-blue muse emissive at 1.4 blew out
  // to a white-hot triangle under the ghost's hem in the dusk scene. Lit must
  // still read as lit, just not blaze.
  assert.ok(FOOTLIGHT_COLORS.muse.emissiveIntensity > 0, 'muse footlight must be lit');
  assert.ok(FOOTLIGHT_COLORS.muse.emissiveIntensity <= 1.0, 'muse footlight must not blaze white');
  assert.ok(FOOTLIGHT_COLORS.npc.emissiveIntensity > 0, 'npc footlight must be lit');
  assert.ok(FOOTLIGHT_COLORS.npc.emissiveIntensity <= 1.0, 'npc footlight must not blaze white');
  assert.equal(FOOTLIGHT_COLORS.unlit.emissiveIntensity, 0, 'unlit footlight stays dark');
});
