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
  INN_ROOM_WINDOWS,
  buildTown,
  applyState,
  updateNightlyCallCard,
  applyPlotManifest,
  updateTownAnimations,
  renderPromptBook,
  resolvePlotOverlayContent,
  resolveInnOverlayContent,
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
    clone() {
      const cloned = new this.constructor(this);
      cloned.type = this.type;
      return cloned;
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

test('applyState staggers nametag heights for adjacent bandstand slots and gate avatars', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE);

  const live = applyState(town, {
    state_seq: 1,
    footlights: [
      { handle: 'alice', status_text: 'tea', lit_at: 100, expires_at: 2800, slot: 1, role: 'muse' },
      { handle: 'bob', status_text: 'sketch', lit_at: 100, expires_at: 2800, slot: 2, role: 'muse' },
    ],
    presence: [
      { handle: 'alice', zone: 'bandstand', updated_at: 100, role: 'muse' },
      { handle: 'bob', zone: 'bandstand', updated_at: 100, role: 'muse' },
      { handle: 'gate1', zone: 'gate', updated_at: 100, role: 'npc' },
      { handle: 'gate2', zone: 'gate', updated_at: 100, role: 'muse' },
    ],
    prompt_book: [],
  });

  const alice = live.avatars.get('alice');
  const bob = live.avatars.get('bob');
  assert.equal(alice.userData.nametagLift, 0.5);
  assert.equal(bob.userData.nametagLift, 0);
  assert.ok(
    Math.abs(Math.abs(alice.userData.nametagSprite.position.y - bob.userData.nametagSprite.position.y) - 0.5) < 1e-6
  );

  const gate1 = live.avatars.get('gate1');
  const gate2 = live.avatars.get('gate2');
  assert.equal(gate1.userData.nametagLift, 0);
  assert.equal(gate2.userData.nametagLift, 0.5);

  for (const avatar of [alice, bob, gate1, gate2]) {
    assert.equal(avatar.userData.nametagSprite.scale.x, 1.5);
    assert.equal(avatar.userData.nametagSprite.position.y, 1.8 + avatar.userData.nametagLift);
  }
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

test('TownLive invalidates plotCache when state.plots timestamp changes and skips re-fetch when unchanged', async () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE);

  let plotFetchCount = 0;
  let failingFetchCount = 0;
  let currentWall = '#224466';
  let currentUpdatedAt = 500;
  let failingAvailable = false;

  const fakeFetch = async (url) => {
    if (url.includes('/api/town/plot?handle=dave')) {
      plotFetchCount += 1;
      return {
        status: 200,
        async json() {
          return {
            handle: 'dave',
            plot_updated_at: currentUpdatedAt,
            manifest: {
              cottage: 'tower',
              wall: currentWall,
              roof: '#883322',
              trim: '#eeddcc',
              signpost_text: 'Dave Tower',
              props: [],
            },
          };
        },
      };
    }
    if (url.includes('/api/town/plot?handle=latecomer')) {
      failingFetchCount += 1;
      if (!failingAvailable) return { status: 404 };
      return {
        status: 200,
        async json() {
          return {
            handle: 'latecomer',
            plot_updated_at: 600,
            manifest: {
              cottage: 'cabin',
              wall: '#446644',
              roof: '#5a4332',
              trim: '#c9a66b',
              signpost_text: 'Latecomer',
              props: [],
            },
          };
        },
      };
    }
    return { status: 404 };
  };

  const live = new TownLive(town, { fetch: fakeFetch, apiBase: '' });

  // First sync: dave has plot at 500, latecomer has no plot (404)
  await live._syncPlotsFromState({
    state_seq: 1,
    footlights: [{ handle: 'dave', slot: 1, role: 'muse' }],
    presence: [{ handle: 'latecomer', zone: 'gate', role: 'muse' }],
    prompt_book: [],
    plots: { dave: 500 },
  });
  assert.equal(plotFetchCount, 1);
  assert.equal(failingFetchCount, 1);
  let daveBody = collectNodes(
    collectNodes(town.scene, (n) => n.name === 'cottage_dave')[0],
    (n) => n.name === 'tower_body'
  )[0];
  assert.equal(daveBody.material.color, '#224466');
  assert.equal(live.plotCache.get('latecomer').found, false);

  // Second sync: unchanged timestamp for dave -> no re-fetch
  await live._syncPlotsFromState({
    state_seq: 2,
    footlights: [{ handle: 'dave', slot: 1, role: 'muse' }],
    presence: [],
    prompt_book: [],
    plots: { dave: 500 },
  });
  assert.equal(plotFetchCount, 1, 'unchanged plot_updated_at must not re-fetch');

  // Third sync: dave edits plot (timestamp 550) and latecomer publishes plot (timestamp 600)
  currentWall = '#993355';
  currentUpdatedAt = 550;
  failingAvailable = true;
  await live._syncPlotsFromState({
    state_seq: 3,
    footlights: [{ handle: 'dave', slot: 1, role: 'muse' }],
    presence: [{ handle: 'latecomer', zone: 'gate', role: 'muse' }],
    prompt_book: [],
    plots: { dave: 550, latecomer: 600 },
  });
  assert.equal(plotFetchCount, 2, 'changed plot_updated_at must trigger re-fetch');
  assert.equal(failingFetchCount, 2, 'cached found:false must re-fetch when plots entry appears');
  daveBody = collectNodes(
    collectNodes(town.scene, (n) => n.name === 'cottage_dave')[0],
    (n) => n.name === 'tower_body'
  )[0];
  assert.equal(daveBody.material.color, '#993355', 'applyPlotManifest must re-run with updated manifest');
  assert.ok(collectNodes(town.scene, (n) => n.name === 'cottage_latecomer').length === 1);
});

test('TownLive raises cottages for quiet residents and assigns pads independent of who is lit', async () => {
  const manifestFor = (handle) => ({
    cottage: 'gable',
    wall: '#ddccbb',
    roof: '#554433',
    trim: '#221100',
    signpost_text: handle,
    props: [],
  });
  const fakeFetch = async (url) => {
    const m = /\/api\/town\/plot\?handle=([a-z0-9_-]+)/.exec(url);
    if (!m) return { status: 404 };
    return {
      status: 200,
      async json() {
        return { handle: m[1], plot_updated_at: 100, manifest: manifestFor(m[1]) };
      },
    };
  };

  // Viewer A loads while zed is lit and talking; amy has gone quiet (plot only).
  const townA = buildTown(createThreeStub());
  const liveA = new TownLive(townA, { fetch: fakeFetch, apiBase: '' });
  await liveA._syncPlotsFromState({
    state_seq: 1,
    footlights: [{ handle: 'zed', slot: 0, role: 'muse' }],
    presence: [{ handle: 'zed', zone: 'bandstand', role: 'muse' }],
    prompt_book: [{ id: 1, handle: 'zed', kind: 'say', body: 'hi' }],
    plots: { amy: 100, zed: 100 },
  });
  assert.equal(
    collectNodes(townA.scene, (n) => n.name === 'cottage_amy').length,
    1,
    'a resident with a saved plot keeps a cottage even with no footlight, presence, or recent remark'
  );

  // Viewer B loads later when amy is lit instead of zed.
  const townB = buildTown(createThreeStub());
  const liveB = new TownLive(townB, { fetch: fakeFetch, apiBase: '' });
  await liveB._syncPlotsFromState({
    state_seq: 2,
    footlights: [{ handle: 'amy', slot: 0, role: 'muse' }],
    presence: [],
    prompt_book: [],
    plots: { amy: 100, zed: 100 },
  });

  for (const handle of ['amy', 'zed']) {
    assert.equal(
      townA._live.plotAssignments.get(handle).plotNumber,
      townB._live.plotAssignments.get(handle).plotNumber,
      `${handle} must stand on the same pad for every viewer`
    );
  }
  assert.notEqual(townA._live.plotAssignments.get('amy').plotNumber, townA._live.plotAssignments.get('zed').plotNumber);
});

test('resolvePlotOverlayContent prefers API html and falls back to static path', async () => {
  // 1. API returns valid non-empty html
  const apiRes = await resolvePlotOverlayContent('alice', {
    apiBase: 'https://example.test/',
    fetchFn: async (url) => {
      assert.equal(url, 'https://example.test/api/town/plot?handle=alice');
      return { status: 200, async json() { return { html: '<p>Hello from API</p>' }; } };
    },
  });
  assert.deepEqual(apiRes, { kind: 'api', html: '<p>Hello from API</p>' });

  // 2. 404 falls back to static
  const notFoundRes = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ status: 404 }),
  });
  assert.deepEqual(notFoundRes, { kind: 'static', url: 'plots/wick/index.html' });

  // 3. Fetch throws falls back to static
  const throwRes = await resolvePlotOverlayContent('maren', {
    fetchFn: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(throwRes, { kind: 'static', url: 'plots/maren/index.html' });

  // 4. Invalid handle falls back to static WITHOUT calling fetch
  let called = false;
  const badHandleRes = await resolvePlotOverlayContent('../etc/passwd', {
    fetchFn: async () => { called = true; return { status: 200 }; },
  });
  assert.equal(called, false, 'invalid handle must not trigger fetch');
  assert.deepEqual(badHandleRes, { kind: 'static', url: 'plots/..%2Fetc%2Fpasswd/index.html' });

  // 5. Empty or non-string html falls back to static
  const emptyRes = await resolvePlotOverlayContent('tomas', {
    fetchFn: async () => ({ status: 200, async json() { return { html: '   ' }; } }),
  });
  assert.deepEqual(emptyRes, { kind: 'static', url: 'plots/tomas/index.html' });

  const nonStringRes = await resolvePlotOverlayContent('tomas', {
    fetchFn: async () => ({ status: 200, async json() { return { html: 123 }; } }),
  });
  assert.deepEqual(nonStringRes, { kind: 'static', url: 'plots/tomas/index.html' });

  // 6. No fetchFn (offline/static preview) falls back to static without error
  const noFetchRes = await resolvePlotOverlayContent('milo', { fetchFn: null });
  assert.deepEqual(noFetchRes, { kind: 'static', url: 'plots/milo/index.html' });
});

function getInnWindow(town, idx) {
  return collectNodes(town.parts.inn, (n) => n.name === `inn_window_${idx}`)[0];
}

test('buildTown gives each inn room window its own cloned material instance', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  assert.deepEqual(INN_ROOM_WINDOWS, { lantern: 4, window: 5, quiet: 6 });

  const sharedMat = getInnWindow(town, 0).material;
  const w4 = getInnWindow(town, 4);
  const w5 = getInnWindow(town, 5);
  const w6 = getInnWindow(town, 6);

  assert.notEqual(w4.material, sharedMat, 'lantern window must not share common windowMat');
  assert.notEqual(w5.material, sharedMat, 'window room window must not share common windowMat');
  assert.notEqual(w6.material, sharedMat, 'quiet window must not share common windowMat');
  assert.notEqual(w4.material, w5.material);
  assert.notEqual(w4.material, w6.material);
  assert.notEqual(w5.material, w6.material);

  for (const idx of [1, 2, 3, 7]) {
    assert.equal(getInnWindow(town, idx).material, sharedMat, `inn_window_${idx} keeps shared material`);
  }
});

test('applyState updates inn room window glow for claimed and vacant rooms', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  applyState(town, {
    inn: {
      lantern: { handle: 'wick', nights: 3, expires_at: 9999999999 },
      window: null,
      quiet: { handle: 'maren', nights: 2, expires_at: 9999999999 },
    },
  });

  assert.equal(getInnWindow(town, 4).material.emissiveIntensity, 1.4, 'claimed lantern window stays bright');
  assert.ok(getInnWindow(town, 5).material.emissiveIntensity <= 0.2, 'vacant window room dims');
  assert.equal(getInnWindow(town, 6).material.emissiveIntensity, 1.4, 'claimed quiet window stays bright');

  for (const idx of [0, 1, 2, 3, 7]) {
    assert.equal(getInnWindow(town, idx).material.emissiveIntensity, 1.4, `common inn_window_${idx} stays at 1.4`);
  }
});

test('applyState with no inn key leaves all eight inn windows lit as built', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  applyState(town, { footlights: [], presence: [] });

  for (let idx = 0; idx < 8; idx++) {
    assert.equal(getInnWindow(town, idx).material.emissiveIntensity, 1.4, `inn_window_${idx} stays at 1.4`);
  }
});

test('applyState inn occupancy round-trip dims a previously claimed room when vacated', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  applyState(town, {
    inn: {
      lantern: { handle: 'wick', nights: 1, expires_at: 9999999999 },
      window: null,
      quiet: null,
    },
  });
  assert.equal(getInnWindow(town, 4).material.emissiveIntensity, 1.4);

  applyState(town, {
    inn: {
      lantern: null,
      window: null,
      quiet: null,
    },
  });
  assert.ok(getInnWindow(town, 4).material.emissiveIntensity <= 0.2, 'vacated lantern window dims again');
});

test('applyState ignores unknown inn room keys without throwing', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  applyState(town, {
    inn: {
      lantern: null,
      penthouse: { handle: 'x' },
    },
  });

  assert.ok(getInnWindow(town, 4).material.emissiveIntensity <= 0.2, 'lantern window dims');
  for (const idx of [0, 1, 2, 3, 7]) {
    assert.equal(getInnWindow(town, idx).material.emissiveIntensity, 1.4, `common inn_window_${idx} unchanged`);
  }
});

test('resolveInnOverlayContent renders occupied nights-left and vacant rooms from innState', async () => {
  const nowSec = 1700000000;
  const res = await resolveInnOverlayContent({
    innState: {
      lantern: { handle: 'wick', nights: 3, expires_at: nowSec + 2.5 * 86400 },
      window: null,
      quiet: { handle: 'maren', nights: 1, expires_at: nowSec + 0.2 * 86400 },
    },
    nowSec,
  });

  assert.equal(res.kind, 'api');
  assert.ok(res.html.includes('Ghostlight Inn &mdash; The Guest Book'));
  assert.ok(res.html.includes('Occupied — @wick, 3 nights left.'));
  assert.ok(res.html.includes('Vacant — free tonight.'));
  assert.ok(res.html.includes('Occupied — @maren, 1 night left.'));
  assert.equal((res.html.match(/class="occupancy"/g) || []).length, 3);
});

test('resolveInnOverlayContent falls back to static when innState is missing or null', async () => {
  assert.deepEqual(await resolveInnOverlayContent(), { kind: 'static', url: 'inn/index.html' });
  assert.deepEqual(await resolveInnOverlayContent({ innState: null }), { kind: 'static', url: 'inn/index.html' });
  assert.deepEqual(await resolveInnOverlayContent({ innState: {} }), { kind: 'static', url: 'inn/index.html' });
});

test('resolveInnOverlayContent fetches /api/town/state when innState is absent and falls back on errors', async () => {
  const nowSec = 1700000000;
  const called = [];
  const okRes = await resolveInnOverlayContent({
    apiBase: 'https://town.example/',
    nowSec,
    fetchFn: async (url) => {
      called.push(url);
      return {
        status: 200,
        async json() {
          return {
            inn: {
              lantern: { handle: 'tomas', nights: 2, expires_at: nowSec + 1.5 * 86400 },
              window: null,
              quiet: null,
            },
          };
        },
      };
    },
  });
  assert.deepEqual(called, ['https://town.example/api/town/state']);
  assert.equal(okRes.kind, 'api');
  assert.ok(okRes.html.includes('Occupied — @tomas, 2 nights left.'));

  const notFound = await resolveInnOverlayContent({
    fetchFn: async () => ({ status: 404, async json() { return {}; } }),
  });
  assert.deepEqual(notFound, { kind: 'static', url: 'inn/index.html' });

  const badJson = await resolveInnOverlayContent({
    fetchFn: async () => ({ status: 200, async json() { throw new SyntaxError('bad json'); } }),
  });
  assert.deepEqual(badJson, { kind: 'static', url: 'inn/index.html' });

  const netErr = await resolveInnOverlayContent({
    fetchFn: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(netErr, { kind: 'static', url: 'inn/index.html' });

  const noInnInPayload = await resolveInnOverlayContent({
    fetchFn: async () => ({ status: 200, async json() { return { footlights: [] }; } }),
  });
  assert.deepEqual(noInnInPayload, { kind: 'static', url: 'inn/index.html' });
});

test('resolveInnOverlayContent never leaks key_code, ignores unknown rooms, and escapes handles', async () => {
  const nowSec = 1700000000;
  const secretKey = 'SECRET-ROOM-KEY-9999';
  const res = await resolveInnOverlayContent({
    innState: {
      lantern: { handle: '<script>wick</script>', nights: 2, expires_at: nowSec + 86400, key_code: secretKey },
      window: null,
      quiet: null,
      penthouse: { handle: 'intruder', nights: 5, expires_at: nowSec + 5 * 86400 },
      key_code: secretKey,
    },
    nowSec,
  });

  assert.equal(res.kind, 'api');
  assert.equal(res.html.includes(secretKey), false, 'room key_code must never appear in HTML');
  assert.equal(res.html.includes('penthouse'), false, 'unknown room key must be ignored');
  assert.equal(res.html.includes('intruder'), false, 'unknown room handle must be ignored');
  assert.equal((res.html.match(/<li>/g) || []).length, 3, 'exactly three room list items');
  assert.equal(res.html.includes('<script>'), false, 'handle must be HTML-escaped');
  assert.ok(res.html.includes('&lt;script&gt;wick&lt;/script&gt;'));
});

test('applyState updates nightly_call_card texture from state.nightly_call and skips redundant redraws', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  const card = town.parts.nightlyCallCard;
  assert.ok(card, 'buildTown must expose parts.nightlyCallCard');
  const initialMap = card.material.map;
  assert.ok(initialMap, 'static placeholder texture must exist at build time');

  const topic = "What's one small object on your desk tonight?";
  const live = applyState(town, {
    nightly_call: { date: '2026-11-13', topic },
  });

  assert.notEqual(card.material.map, initialMap, 'card material map must update on new topic');
  assert.equal(card.material.needsUpdate, true);
  assert.equal(live.nightlyCallTopic, topic);

  const firstLiveMap = card.material.map;
  applyState(town, {
    nightly_call: { date: '2026-11-13', topic },
  });
  assert.equal(card.material.map, firstLiveMap, 'same topic must not redraw texture');

  // Long topic (>60 chars) wraps without throwing and updates texture
  const longTopic = 'What is one small thing on your windowsill or desk that reminds you of a neighbor?';
  applyState(town, {
    nightly_call: { date: '2026-11-14', topic: longTopic },
  });
  assert.notEqual(card.material.map, firstLiveMap, 'new long topic must redraw texture');
  assert.equal(live.nightlyCallTopic, longTopic);
});

test('applyState leaves nightly_call_card untouched when nightly_call is missing or malformed', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  const card = town.parts.nightlyCallCard;
  const staticMap = card.material.map;

  applyState(town, { footlights: [], presence: [] });
  assert.equal(card.material.map, staticMap, 'missing nightly_call leaves static texture untouched');

  for (const bad of [
    null,
    'not-an-object',
    [],
    {},
    { date: '2026-11-13', topic: '' },
    { date: '2026-11-13', topic: '   ' },
    { date: '2026-11-13', topic: 123 },
    { date: '2026-11-13', topic: null },
  ]) {
    applyState(town, { nightly_call: bad });
    assert.equal(card.material.map, staticMap, 'malformed nightly_call leaves static texture untouched');
  }
});

test('updateNightlyCallCard is a no-op when card mesh is missing', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  town.parts.nightlyCallCard = null;
  town.parts.bandstand.children = town.parts.bandstand.children.filter((c) => c.name !== 'nightly_call_card');

  assert.doesNotThrow(() => {
    updateNightlyCallCard(town, { date: '2026-11-13', topic: "What's in your mug?" });
    applyState(town, { nightly_call: { date: '2026-11-13', topic: "What's in your mug?" } });
  });
});
