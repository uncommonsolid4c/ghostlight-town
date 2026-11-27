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
  INN_WINDOW_COLORS,
  buildTown,
  applyState,
  createAvatarCapsule,
  setAvatarStatusText,
  updateNightlyCallCard,
  applyPlotManifest,
  updateTownAnimations,
  formatPromptBookEntries,
  renderPromptBook,
  resolvePlotOverlayContent,
  resolveInnOverlayContent,
  resolveGuestbookOverlayContent,
  resolvePlotGuestbookOverlayContent,
  formatPlotGuestbookTabLabel,
  TownLive,
  pinchFov,
  stepGlide,
  getPlotTargetPosition,
  buildNoticeBoardOverlayHtml,
  updateInnOccupancy,
} from './town.js';
import { lightFootlightSlot, buildConceptBandstand } from './concept-bandstand.js';
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
  assert.equal(town.parts.footlights[1].userData.statusText, 'hi');
  assert.equal(town._live.avatars.get('dave').userData.statusText, 'hi');
  assert.equal(town._live.avatars.get('dave').userData.nametagSprite.scale.y, 0.5625);

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
  for (const idx of [0, 1, 2, 3, 7]) {
    assert.ok(getInnWindow(town, idx).material.emissiveIntensity <= 0.2, `common inn_window_${idx} dims when all rooms are vacant`);
  }
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
    assert.ok(getInnWindow(town, idx).material.emissiveIntensity <= 0.2, `common inn_window_${idx} dims when all known rooms are vacant`);
  }
});

test('applyState dims all common inn windows when all rooms are vacant and re-lights them when one room is claimed', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  applyState(town, {
    inn: {
      lantern: null,
      window: null,
      quiet: null,
    },
  });

  for (const idx of [0, 1, 2, 3, 7]) {
    const mat = getInnWindow(town, idx).material;
    assert.ok(mat.emissiveIntensity <= 0.2, `vacant common inn_window_${idx} dims`);
    assert.equal(mat.color, INN_WINDOW_COLORS.vacant.color);
    assert.equal(mat.emissive, INN_WINDOW_COLORS.vacant.emissive);
  }

  applyState(town, {
    inn: {
      lantern: null,
      window: { handle: 'wick', nights: 1, expires_at: 9999999999 },
      quiet: null,
    },
  });

  for (const idx of [0, 1, 2, 3, 7]) {
    const mat = getInnWindow(town, idx).material;
    assert.equal(mat.emissiveIntensity, 1.4, `common inn_window_${idx} re-lights when a room is claimed`);
    assert.equal(mat.color, INN_WINDOW_COLORS.claimed.color);
    assert.equal(mat.emissive, INN_WINDOW_COLORS.claimed.emissive);
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

test('resolveGuestbookOverlayContent renders Signatures before Letters to the Editor and escapes HTML', async () => {
  const called = [];
  const res = await resolveGuestbookOverlayContent({
    apiBase: 'https://town.example/',
    fetchFn: async (url) => {
      called.push(url);
      return {
        status: 200,
        async json() {
          return {
            entries: [
              { id: 1, kind: 'guestbook', name: 'Clara', body: 'Warm lantern light.', created_at: 1794614400 },
              { id: 2, kind: 'guestbook', name: '<b>Bob</b>', body: '<b>hi</b> & "quoted"', created_at: 1794528000 },
              { id: 3, kind: 'letter', name: 'Wick', body: 'Letter about the bandstand.', created_at: 1794441600 },
              { id: 4, kind: 'unknown_kind', name: 'Ignored', body: 'Should not render', created_at: 1794441600 },
            ],
          };
        },
      };
    },
  });

  assert.deepEqual(called, ['https://town.example/api/town/guestbook?limit=50']);
  assert.equal(res.kind, 'api');
  assert.ok(res.html.includes('Clara'));
  assert.ok(res.html.includes('Warm lantern light.'));
  assert.ok(res.html.includes('&lt;b&gt;Bob&lt;/b&gt;'));
  assert.ok(res.html.includes('&lt;b&gt;hi&lt;/b&gt; &amp; &quot;quoted&quot;'));
  assert.equal(res.html.includes('<b>hi</b>'), false, 'raw HTML in entry body must be escaped');
  assert.equal(res.html.includes('Should not render'), false, 'unknown kinds must be ignored');

  const sigIdx = res.html.indexOf('<h2>Signatures</h2>');
  const letIdx = res.html.indexOf('<h2>Letters to the Editor</h2>');
  assert.ok(sigIdx !== -1 && letIdx !== -1 && sigIdx < letIdx, 'Signatures section must precede Letters to the Editor');

  const sigSection = res.html.slice(sigIdx, letIdx);
  const letSection = res.html.slice(letIdx);
  assert.equal(sigSection.includes('Letter about the bandstand.'), false, 'letter body must not appear in Signatures section');
  assert.ok(letSection.includes('Letter about the bandstand.'), 'letter body must appear in Letters section');
});

test('resolveGuestbookOverlayContent renders empty state copy when entries is empty', async () => {
  const res = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return { entries: [] };
      },
    }),
  });

  assert.equal(res.kind, 'api');
  assert.ok(res.html.includes('be the first to sign'));
  assert.ok(res.html.includes('signGuestbook'));
  assert.ok(res.html.includes('approved by Milo'));
});

test('resolveGuestbookOverlayContent falls back to guestbook/index.html on missing fetchFn or errors', async () => {
  assert.deepEqual(await resolveGuestbookOverlayContent(), { kind: 'static', url: 'guestbook/index.html' });

  const non200 = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 500, async json() { return { entries: [] }; } }),
  });
  assert.deepEqual(non200, { kind: 'static', url: 'guestbook/index.html' });

  const thrown = await resolveGuestbookOverlayContent({
    fetchFn: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(thrown, { kind: 'static', url: 'guestbook/index.html' });

  const badJson = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 200, async json() { throw new SyntaxError('bad json'); } }),
  });
  assert.deepEqual(badJson, { kind: 'static', url: 'guestbook/index.html' });

  const badEntries = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 200, async json() { return { entries: 'not-an-array' }; } }),
  });
  assert.deepEqual(badEntries, { kind: 'static', url: 'guestbook/index.html' });
});

test('town-3d/guestbook/index.html static fallback meets safety and copy rules', async () => {
  const html = await fs.readFile(path.join(__dirname, 'guestbook', 'index.html'), 'utf8');
  assert.ok(!/<script\b/i.test(html), 'guestbook/index.html must not contain <script>');
  assert.ok(!/https?:\/\//i.test(html), 'guestbook/index.html must not contain external http(s):// URLs');
  assert.match(
    html,
    /<meta\s+name=["']viewport["']\s+content=["']width=device-width,\s*initial-scale=1\.0["']\s*\/?>/i,
    'guestbook/index.html must declare viewport meta'
  );
  assert.match(html, /Milo/i, 'guestbook/index.html must mention Milo approval/moderation');
  assert.ok(html.includes('SKILL.md'), 'guestbook/index.html must reference SKILL.md');
  assert.ok(html.includes('signGuestbook'), 'guestbook/index.html must reference town-client signGuestbook');
  assert.ok(!new RegExp(`camp${'fire'}`, 'i').test(html), 'guestbook/index.html must not contain banned term');
});

test('formatPromptBookEntries passes reply_to integer through and normalizes non-integers to null', () => {
  const formatted = formatPromptBookEntries([
    { id: 1, handle: 'maren', kind: 'say', body: 'hi', reply_to: 3, created_at: 100, role: 'npc' },
    { id: 2, handle: 'wick', kind: 'say', body: 'yo', reply_to: '3', created_at: 101, role: 'npc' },
    { id: 3, handle: 'tomas', kind: 'say', body: 'hey', reply_to: null, created_at: 102, role: 'npc' },
    { id: 4, handle: 'alice', kind: 'say', body: 'ok', created_at: 103, role: 'muse' },
  ]);
  assert.equal(formatted[0].reply_to, 3);
  assert.equal(formatted[1].reply_to, null);
  assert.equal(formatted[2].reply_to, null);
  assert.equal(formatted[3].reply_to, null);
});

test('renderPromptBook renders pb-reply-to before handle with resolved or fallback label and escapes body', () => {
  const doc = createDomStub();
  const container = doc.createElement('div');
  const lines = [
    { id: 3, handle: 'maren', kind: 'say', body: 'Kettle is on.', reply_to: null, created_at: 100, role: 'npc' },
    { id: 4, handle: 'wick', kind: 'say', body: '<b>hi</b>', reply_to: 3, created_at: 101, role: 'npc' },
    { id: 5, handle: 'tomas', kind: 'say', body: 'Older thread.', reply_to: 99, created_at: 102, role: 'muse' },
    { id: 6, handle: 'alice', kind: 'say', body: 'Top-level.', reply_to: null, created_at: 103, role: 'muse' },
  ];

  renderPromptBook(container, lines, doc);
  assert.equal(container.children.length, 4);

  // Line 4: reply to line 3 (in window) -> [NPC], pb-reply-to "↩ #3 @maren", pb-handle "wick", pb-body ": <b>hi</b>"
  const line4 = container.children[1];
  const classes4 = line4.children.map((c) => c.className);
  assert.deepEqual(classes4, ['pb-npc-pill', 'pb-reply-to', 'pb-handle', 'pb-body']);
  assert.equal(line4.children[1].textContent, '↩ #3 @maren');
  assert.equal(line4.children[3].textContent, ': <b>hi</b>');
  assert.equal(line4.children[3]._textContent, ': <b>hi</b>');

  // Line 5: reply to line 99 (not in window) -> pb-reply-to "↩ #99" before pb-handle
  const line5 = container.children[2];
  const classes5 = line5.children.map((c) => c.className);
  assert.deepEqual(classes5, ['pb-reply-to', 'pb-handle', 'pb-body']);
  assert.equal(line5.children[0].textContent, '↩ #99');

  // Line 6: top-level -> no pb-reply-to span
  const line6 = container.children[3];
  const classes6 = line6.children.map((c) => c.className);
  assert.deepEqual(classes6, ['pb-handle', 'pb-body']);
});

test('resolvePlotGuestbookOverlayContent renders Signatures and Letters with escaping, town-time dates, and 50-cap', async () => {
  const calls = [];
  const entries = [
    { id: 1, kind: 'guestbook', name: '<script>milo</script>', body: 'Warm <b>porch</b>.', created_at: 1744500000 },
    { id: 2, kind: 'letter', name: 'maren', body: 'Left tea by the door.', created_at: 1744586400 },
    ...Array.from({ length: 55 }, (_, i) => ({
      id: 10 + i,
      kind: 'guestbook',
      name: `sig-${i + 1}`,
      body: `note-${i + 1}`,
      created_at: 1744600000 + i,
    })),
  ];
  const res = await resolvePlotGuestbookOverlayContent('lampmoth', {
    fetchFn: async (url) => {
      calls.push(url);
      return { status: 200, async json() { return { entries }; } };
    },
  });
  assert.deepEqual(calls, ['/api/town/guestbook?plot=lampmoth&limit=50']);
  assert.equal(res.kind, 'api');
  assert.ok(res.html.includes("<h1>@lampmoth's Guestbook</h1>"));
  assert.ok(res.html.includes('&lt;script&gt;milo&lt;/script&gt;'));
  assert.ok(res.html.includes('Warm &lt;b&gt;porch&lt;/b&gt;.'));
  assert.ok(!res.html.includes('<script>'));
  assert.ok(res.html.includes('Apr 12, 2025'));
  assert.ok(res.html.includes('<h2>Signatures</h2>'));
  assert.ok(res.html.includes('<h2>Letters</h2>'));
  assert.ok(res.html.includes('sig-48'));
  assert.ok(!res.html.includes('sig-49'), 'must cap at 50 entries');
  assert.ok(res.html.includes('"plot": "lampmoth"'));
});

test('resolvePlotGuestbookOverlayContent falls back to srcdoc on errors or invalid handles without static URL', async () => {
  let fetchCalled = false;
  const invalid = await resolvePlotGuestbookOverlayContent('../bad', {
    fetchFn: async () => {
      fetchCalled = true;
      return { status: 200, async json() { return { entries: [] }; } };
    },
  });
  assert.equal(fetchCalled, false, 'invalid handle must not call fetch');
  assert.equal(invalid.kind, 'fallback');
  assert.ok(invalid.html.includes('&lt;h1&gt;') === false);
  assert.ok(invalid.html.includes('../bad'));
  assert.ok(invalid.html.includes('How to sign'));

  const missingFetch = await resolvePlotGuestbookOverlayContent('lampmoth');
  assert.equal(missingFetch.kind, 'fallback');
  assert.ok(missingFetch.html.includes("@lampmoth's Guestbook"));
  assert.ok(missingFetch.html.includes('"plot": "lampmoth"'));

  const non200 = await resolvePlotGuestbookOverlayContent('lampmoth', {
    fetchFn: async () => ({ status: 500, async json() { return { entries: [] }; } }),
  });
  assert.equal(non200.kind, 'fallback');

  const thrown = await resolvePlotGuestbookOverlayContent('lampmoth', {
    fetchFn: async () => { throw new Error('offline'); },
  });
  assert.equal(thrown.kind, 'fallback');

  const badEntries = await resolvePlotGuestbookOverlayContent('lampmoth', {
    fetchFn: async () => ({ status: 200, async json() { return { entries: 'not-an-array' }; } }),
  });
  assert.equal(badEntries.kind, 'fallback');
});

test('formatPlotGuestbookTabLabel formats count only for finite numbers > 0', () => {
  assert.equal(formatPlotGuestbookTabLabel(undefined), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(0), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(3), 'Guestbook (3)');
});

function withRecordingCanvas(fn) {
  const prevDoc = globalThis.document;
  const draws = [];
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') return {};
      const canvas = { width: 0, height: 0 };
      const baseCtx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        font: '',
        textAlign: '',
        textBaseline: '',
        fillText(text, x, y) {
          draws.push({ text: String(text), font: ctx.font, x, y, width: canvas.width, height: canvas.height });
        },
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} }),
      };
      const ctx = new Proxy(baseCtx, {
        get(target, prop) {
          if (prop in target) return target[prop];
          return () => {};
        },
      });
      canvas.getContext = () => ctx;
      return canvas;
    },
  };
  try {
    return fn(draws);
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
}

test('Slice 102: applyState footlight placard renders status_text, re-renders on change, restores handle-only, and clears on unlight', () => {
  const THREE = createThreeStub();
  withRecordingCanvas((draws) => {
    const town = buildTown(THREE);
    const fl = town.parts.footlights[1];

    // 1. Absent status_text -> handle-only 256x96 titleSize 28
    draws.length = 0;
    applyState(town, {
      state_seq: 1,
      footlights: [{ handle: 'dave', slot: 1, role: 'muse' }],
      presence: [],
    });
    assert.equal(fl.userData.statusText, null);
    assert.deepEqual(draws.map((d) => d.text), ['dave']);
    assert.equal(draws[0].font, 'bold 28px monospace');
    assert.equal(draws[0].width, 256);
    assert.equal(draws[0].height, 96);

    // 2. Non-empty status_text -> re-renders with titleSize 22, subSize 16, wrapped <= 20 chars
    draws.length = 0;
    applyState(town, {
      state_seq: 2,
      footlights: [{ handle: 'dave', status_text: '  Listening by the gatehouse  ', slot: 1, role: 'muse' }],
      presence: [],
    });
    assert.equal(fl.userData.statusText, 'Listening by the gatehouse');
    assert.equal(draws.length, 3);
    assert.equal(draws[0].text, 'dave');
    assert.equal(draws[0].font, 'bold 22px monospace');
    assert.equal(draws[1].font, 'bold 16px monospace');
    assert.equal(draws[2].font, 'bold 16px monospace');
    assert.ok(draws[1].text.length <= 20);
    assert.ok(draws[2].text.length <= 20);
    assert.equal(`${draws[1].text} ${draws[2].text}`, 'Listening by the gatehouse');

    // 3. Unchanged status_text -> no re-render
    const sameMap = fl.userData.placard.material.map;
    draws.length = 0;
    applyState(town, {
      state_seq: 3,
      footlights: [{ handle: 'dave', status_text: 'Listening by the gatehouse', slot: 1, role: 'muse' }],
      presence: [],
    });
    assert.equal(draws.length, 0);
    assert.equal(fl.userData.placard.material.map, sameMap);

    // 4. Long status (> 40 chars) -> capped at 2 status lines <= 20 chars with ellipsis
    draws.length = 0;
    const longStatus = 'Reading old letters beside the warm lantern while the night wind moves across the quiet town square';
    applyState(town, {
      state_seq: 4,
      footlights: [{ handle: 'dave', status_text: longStatus, slot: 1, role: 'muse' }],
      presence: [],
    });
    assert.equal(draws.length, 3);
    assert.ok(draws[1].text.length <= 20);
    assert.ok(draws[2].text.length <= 20);
    assert.ok(draws[2].text.endsWith('…'));

    // 5. Status clears to whitespace -> restores handle-only
    draws.length = 0;
    applyState(town, {
      state_seq: 5,
      footlights: [{ handle: 'dave', status_text: '   ', slot: 1, role: 'muse' }],
      presence: [],
    });
    assert.equal(fl.userData.statusText, null);
    assert.deepEqual(draws.map((d) => d.text), ['dave']);
    assert.equal(draws[0].font, 'bold 28px monospace');

    // 6. Unlight -> clears statusText to null
    applyState(town, {
      state_seq: 6,
      footlights: [{ handle: 'dave', status_text: 'hi', slot: 1, role: 'muse' }],
      presence: [],
    });
    assert.equal(fl.userData.statusText, 'hi');
    applyState(town, { state_seq: 7, footlights: [], presence: [] });
    assert.equal(fl.userData.lit, false);
    assert.equal(fl.userData.handle, null);
    assert.equal(fl.userData.statusText, null);
  });
});

test('Slice 102: setAvatarStatusText and applyState presence wire 2-line nametag, 24-char truncation, idempotency, and cleanup', () => {
  const THREE = createThreeStub();
  withRecordingCanvas((draws) => {
    const avatar = createAvatarCapsule(THREE, { handle: 'maren', role: 'npc' });
    const sprite = avatar.userData.nametagSprite;
    const initialMap = sprite.material.map;
    assert.equal(initialMap.image.width, 384);
    assert.equal(initialMap.image.height, 96);
    assert.equal(sprite.scale.x, 1.5);
    assert.equal(sprite.scale.y, 0.375);

    // Null / whitespace keeps badge-only without swap
    setAvatarStatusText(THREE, avatar, null);
    assert.equal(avatar.userData.statusText, null);
    assert.equal(sprite.material.map, initialMap);
    setAvatarStatusText(THREE, avatar, '   ');
    assert.equal(avatar.userData.statusText, null);
    assert.equal(sprite.material.map, initialMap);

    // Setting status swaps to 384x144, scale 1.5 x 0.5625, and disposes old map
    let disposedCount = 0;
    initialMap.dispose = () => { disposedCount += 1; };
    draws.length = 0;
    setAvatarStatusText(THREE, avatar, '  Quiet tea  ');
    assert.equal(disposedCount, 1);
    assert.equal(avatar.userData.statusText, 'Quiet tea');
    const statusMap = sprite.material.map;
    assert.notEqual(statusMap, initialMap);
    assert.equal(statusMap.image.width, 384);
    assert.equal(statusMap.image.height, 144);
    assert.equal(sprite.scale.x, 1.5);
    assert.equal(sprite.scale.y, 0.5625);
    assert.deepEqual(draws.map((d) => d.text), ['[NPC] maren', 'Quiet tea']);

    // Idempotent when status is unchanged
    draws.length = 0;
    setAvatarStatusText(THREE, avatar, 'Quiet tea');
    assert.equal(draws.length, 0);
    assert.equal(sprite.material.map, statusMap);

    // Truncates past 24 chars with ellipsis
    draws.length = 0;
    setAvatarStatusText(THREE, avatar, 'Listening by the gatehouse tonight');
    assert.equal(avatar.userData.statusText.length, 24);
    assert.equal(avatar.userData.statusText, 'Listening by the gateho…');
    assert.deepEqual(draws.map((d) => d.text), ['[NPC] maren', 'Listening by the gateho…']);

    // Empty status restores badge-only
    draws.length = 0;
    setAvatarStatusText(THREE, avatar, '');
    assert.equal(avatar.userData.statusText, null);
    assert.equal(sprite.material.map.image.width, 384);
    assert.equal(sprite.material.map.image.height, 96);
    assert.equal(sprite.scale.x, 1.5);
    assert.equal(sprite.scale.y, 0.375);
    assert.deepEqual(draws.map((d) => d.text), ['[NPC] maren']);

    // Presence wiring via applyState: sets status, clears on empty/unlit, removes when resident leaves
    const town = buildTown(THREE);
    const live = applyState(town, {
      state_seq: 1,
      footlights: [{ handle: 'alice', status_text: 'Evening lanterns', slot: 1, role: 'muse' }],
      presence: [{ handle: 'alice', zone: 'bandstand', updated_at: 1, role: 'muse' }],
    });
    const alice = live.avatars.get('alice');
    assert.equal(alice.userData.statusText, 'Evening lanterns');
    assert.equal(alice.userData.nametagSprite.scale.y, 0.5625);

    applyState(town, {
      state_seq: 2,
      footlights: [],
      presence: [{ handle: 'alice', zone: 'bandstand', updated_at: 2, role: 'muse' }],
    });
    assert.equal(alice.userData.statusText, null);
    assert.equal(alice.userData.nametagSprite.scale.y, 0.375);

    applyState(town, { state_seq: 3, footlights: [], presence: [] });
    assert.equal(live.avatars.has('alice'), false);
  });
});

function makeFakeFootlightSlot(slot = 1) {
  return {
    userData: {
      slot,
      shell: {
        material: {
          color: { value: '#7a6230', set(v) { this.value = v; } },
          emissive: { value: '#000000', set(v) { this.value = v; } },
          emissiveIntensity: 0,
        },
      },
      placard: {
        rotation: { x: 0 },
        position: { y: 0.06 },
        material: {
          map: null,
          color: { value: '#4d301c', set(v) { this.value = v; } },
          needsUpdate: false,
        },
      },
      lit: false,
      handle: null,
      role: null,
      statusText: null,
    },
  };
}

test('Slice 319: fallback lightFootlightSlot renders handle-only placard unchanged when statusText is absent or empty', () => {
  const THREE = createThreeStub();
  withRecordingCanvas((draws) => {
    const fl = makeFakeFootlightSlot(1);

    for (const opts of [
      { handle: 'wick', role: 'npc' },
      { handle: 'wick', role: 'npc', statusText: '' },
      { handle: 'wick', role: 'npc', statusText: '   ' },
    ]) {
      draws.length = 0;
      lightFootlightSlot(THREE, fl, opts);
      assert.equal(fl.userData.lit, true);
      assert.equal(fl.userData.handle, 'wick');
      assert.equal(fl.userData.role, 'npc');
      assert.equal(fl.userData.statusText, null);
      assert.equal(draws.length, 1);
      assert.equal(draws[0].text, 'wick');
      assert.equal(draws[0].font, 'bold 28px monospace');
      assert.equal(draws[0].width, 256);
      assert.equal(draws[0].height, 96);
    }
  });
});

test('Slice 319: fallback lightFootlightSlot wraps statusText with smaller subSize and updates on change', () => {
  const THREE = createThreeStub();
  withRecordingCanvas((draws) => {
    const fl = makeFakeFootlightSlot(1);

    draws.length = 0;
    lightFootlightSlot(THREE, fl, {
      handle: 'maren',
      role: 'npc',
      statusText: 'Listening by the gatehouse',
    });
    assert.equal(fl.userData.statusText, 'Listening by the gatehouse');
    assert.equal(draws.length, 3);
    assert.equal(draws[0].text, 'maren');
    assert.equal(draws[0].font, 'bold 22px monospace');
    assert.equal(draws[1].font, 'bold 16px monospace');
    assert.equal(draws[2].font, 'bold 16px monospace');
    assert.ok(draws[1].text.length <= 20);
    assert.ok(draws[2].text.length <= 20);
    assert.equal(draws[1].text, 'Listening by');
    assert.equal(draws[2].text, 'the gatehouse');

    draws.length = 0;
    lightFootlightSlot(THREE, fl, {
      handle: 'maren',
      role: 'npc',
      statusText: 'Quiet tea',
    });
    assert.equal(fl.userData.statusText, 'Quiet tea');
    assert.equal(draws.length, 2);
    assert.equal(draws[1].text, 'Quiet tea');
    assert.equal(draws[1].font, 'bold 16px monospace');
  });
});

test('Slice 319: fallback lightFootlightSlot truncates long status with ellipsis (fallback 40-char semantics)', () => {
  const THREE = createThreeStub();
  withRecordingCanvas((draws) => {
    const fl = makeFakeFootlightSlot(1);

    draws.length = 0;
    lightFootlightSlot(THREE, fl, {
      handle: 'maren',
      role: 'npc',
      statusText: 'Reading old letters beside the warm lantern while the night wind moves across the quiet town square',
    });
    assert.equal(draws.length, 3);
    assert.ok(draws[1].text.length <= 20);
    assert.ok(draws[2].text.length <= 20);
    assert.equal(draws[2].text, 'beside the warm lan…');

    draws.length = 0;
    lightFootlightSlot(THREE, fl, {
      handle: 'maren',
      role: 'npc',
      statusText: 'Reading old letters beside the warm lantern while the night wind moves across the quiet town square and cobbles',
    });
    assert.equal(draws.length, 3);
    assert.equal(draws[2].text, 'beside the warm lan…');
  });
});

test('Slice 319: fallback lightFootlightSlot sets npc palette, permanent flag, and statusText transitions', () => {
  const THREE = createThreeStub();
  withRecordingCanvas((draws) => {
    const fl = makeFakeFootlightSlot(1);

    lightFootlightSlot(THREE, fl, { handle: 'wick', role: 'npc', permanent: true });
    assert.equal(fl.userData.shell.material.color.value, '#ffbe55');
    assert.equal(fl.userData.shell.material.emissive.value, '#ffaa33');
    assert.equal(fl.userData.shell.material.emissiveIntensity, 1.0);
    assert.equal(fl.userData.permanent, true);

    lightFootlightSlot(THREE, fl, { handle: 'wick', role: 'muse' });
    assert.equal(fl.userData.shell.material.color.value, '#bfeaff');
    assert.equal(fl.userData.shell.material.emissive.value, '#9be0ff');
    assert.equal(fl.userData.shell.material.emissiveIntensity, 0.9);

    lightFootlightSlot(THREE, fl, { handle: 'wick', role: 'muse', statusText: 'At the bandstand' });
    assert.equal(fl.userData.statusText, 'At the bandstand');

    draws.length = 0;
    lightFootlightSlot(THREE, fl, { handle: 'wick', role: 'muse', statusText: null });
    assert.equal(fl.userData.statusText, null);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].text, 'wick');
    assert.equal(draws[0].font, 'bold 28px monospace');
  });
});

test('Slice 319: town.js applyState delegates lit footlight placards to lightFootlightSlot', () => {
  const townJs = fsSync.readFileSync(path.join(__dirname, 'town.js'), 'utf8');
  const applyStart = townJs.indexOf('export function applyState(');
  assert.notEqual(applyStart, -1);
  const applyBody = townJs.slice(applyStart);
  assert.match(applyBody, /lightFootlightSlot\(THREE, flGroup, \{[^}]*statusText/);
  assert.equal(townJs.includes('function formatFootlightStatusLines'), false);
  assert.equal(townJs.includes('function splitNightlyCallLines'), true);

  const THREE = createThreeStub();
  withRecordingCanvas((draws) => {
    const town = buildTown(THREE);
    const fl = town.parts.footlights[1];
    draws.length = 0;
    applyState(town, {
      state_seq: 1,
      footlights: [{ handle: 'dave', status_text: '  Listening by the gatehouse  ', slot: 1, role: 'muse' }],
      presence: [],
    });
    assert.equal(draws.length, 3);
    assert.equal(draws[0].text, 'dave');
    assert.equal(draws[0].font, 'bold 22px monospace');
    assert.equal(draws[1].font, 'bold 16px monospace');
    assert.equal(draws[2].font, 'bold 16px monospace');
    assert.equal(draws[1].text, 'Listening by');
    assert.equal(draws[2].text, 'the gatehouse');
    assert.equal(fl.userData.statusText, 'Listening by the gatehouse');
  });
});

test('Slice 319: fallback concept-bandstand stays dependency-free and Milo pre-light stays handle-only', () => {
  const bandstandJs = fsSync.readFileSync(path.join(__dirname, 'concept-bandstand.js'), 'utf8');
  assert.equal(/^\s*import\b/m.test(bandstandJs), false);

  const THREE = createThreeStub();
  withRecordingCanvas((draws) => {
    draws.length = 0;
    const built = buildConceptBandstand(THREE, { lightMiloFootlight: true });
    const fl0 = built.footlights[0];
    assert.equal(fl0.userData.handle, 'milo');
    assert.equal(fl0.userData.statusText, null);
    assert.equal(fl0.userData.permanent, true);
    const placardDraws = draws.filter((d) => d.text !== 'The Ghostlight Bandstand');
    assert.equal(placardDraws.length, 1);
    assert.equal(placardDraws[0].text, 'milo');
    assert.equal(placardDraws[0].font, 'bold 28px monospace');
  });
});

test('Slice 439: createAvatarCapsule renders muse, npc, and guest badges with role colors and defaults (G1)', () => {
  const THREE = createThreeStub();
  withRecordingCanvas((draws) => {
    draws.length = 0;
    const alice = createAvatarCapsule(THREE, { handle: 'alice', role: 'muse' });
    assert.equal(alice.name, 'avatar_alice');
    assert.equal(alice.userData.role, 'muse');
    assert.equal(alice.userData.handle, 'alice');
    assert.equal(alice.userData.nametagLift, 0);
    assert.equal(alice.children[0].material.color, '#6cb4d8');
    assert.equal(alice.children[1].material.color, '#f2dcc4');
    assert.equal(alice.userData.nametagSprite.scale.x, 1.5);
    assert.equal(alice.userData.nametagSprite.scale.y, 0.375);
    assert.equal(alice.userData.nametagSprite.position.y, 1.8);
    assert.deepEqual(draws.map((d) => d.text), ['[MUSE] alice']);
    assert.equal(draws[0].font, 'bold 30px monospace');

    draws.length = 0;
    const wick = createAvatarCapsule(THREE, { handle: 'wick', role: 'npc', nametagLift: 0.5 });
    assert.equal(wick.userData.role, 'npc');
    assert.equal(wick.children[0].material.color, '#d49a45');
    assert.equal(wick.userData.nametagSprite.position.y, 2.3);
    assert.deepEqual(draws.map((d) => d.text), ['[NPC] wick']);

    draws.length = 0;
    const rue = createAvatarCapsule(THREE, { handle: 'rue', role: 'guest' });
    assert.equal(rue.userData.role, 'guest');
    assert.equal(rue.children[0].material.color, '#6cb4d8');
    assert.deepEqual(draws.map((d) => d.text), ['[guest] rue']);

    draws.length = 0;
    const admin = createAvatarCapsule(THREE, { handle: 'x', role: 'admin' });
    assert.equal(admin.userData.role, 'muse');
    assert.deepEqual(draws.map((d) => d.text), ['[MUSE] x']);

    draws.length = 0;
    const def = createAvatarCapsule(THREE, {});
    assert.equal(def.name, 'avatar_muse');
    assert.equal(def.userData.role, 'muse');
    assert.deepEqual(draws.map((d) => d.text), ['[MUSE] muse']);
  });
});

test('Slice 439: formatPromptBookEntries normalizes kind, handle, body, role, and ids, and caps at 100 (G2)', () => {
  const kinds = formatPromptBookEntries([
    { id: 1, handle: 'a', kind: 'emote', body: 'waves', created_at: 1, role: 'muse' },
    { id: 2, handle: 'b', kind: 'system', body: 'sys', created_at: 2, role: 'muse' },
    { id: 3, handle: 'c', kind: 'shout', body: 'hey', created_at: 3, role: 'muse' },
    { id: 4, handle: 'd', body: 'no kind', created_at: 4, role: 'muse' },
  ]);
  assert.deepEqual(kinds.map((e) => e.kind), ['emote', 'system', 'say', 'say']);

  const defaults = formatPromptBookEntries([
    { id: 5, handle: 123, body: 456, role: 'admin', created_at: 9 },
    {},
    null,
    'nope',
  ]);
  assert.equal(defaults[0].handle, 'unknown');
  assert.equal(defaults[0].body, '');
  assert.equal(defaults[0].role, 'muse');
  assert.equal(defaults[1].id, null);
  assert.equal(defaults[1].handle, 'unknown');
  assert.equal(defaults[1].kind, 'say');
  assert.equal(defaults[1].body, '');
  assert.equal(defaults[1].reply_to, null);
  assert.equal(defaults[1].created_at, 0);
  assert.equal(defaults[1].role, 'muse');
  assert.equal(defaults[2].handle, 'unknown');
  assert.equal(defaults[3].handle, 'unknown');

  const guest = formatPromptBookEntries([{ id: 1, handle: 'rue', kind: 'say', body: 'hi', role: 'guest' }]);
  assert.equal(guest[0].role, 'guest');

  assert.deepEqual(formatPromptBookEntries(null), []);
  assert.deepEqual(formatPromptBookEntries('x'), []);
  assert.deepEqual(formatPromptBookEntries(undefined), []);

  const many = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, handle: 'a', kind: 'say', body: `b${i + 1}`, created_at: i + 1, role: 'muse' }));
  const capped = formatPromptBookEntries(many);
  assert.equal(capped.length, 100);
  assert.equal(capped[0].id, 21);
  assert.equal(capped[99].id, 120);

  const replies = formatPromptBookEntries([
    { id: 1, handle: 'a', kind: 'say', body: 'x', reply_to: 0 },
    { id: 2, handle: 'b', kind: 'say', body: 'y', reply_to: 3.5 },
  ]);
  assert.equal(replies[0].reply_to, 0);
  assert.equal(replies[1].reply_to, null);
});

test('Slice 439: renderPromptBook empty state, emote spacing, guest pill, and re-render clearing (G3)', () => {
  const doc = createDomStub();
  const empty = doc.createElement('div');
  renderPromptBook(empty, [], doc);
  assert.equal(empty.children.length, 1);
  assert.equal(empty.children[0].className, 'pb-empty');
  assert.equal(empty.children[0].textContent, 'No remarks yet in the last 24h.');

  assert.doesNotThrow(() => renderPromptBook(null, [{ id: 1, handle: 'a', kind: 'say', body: 'x' }], doc));
  const noDoc = doc.createElement('div');
  assert.doesNotThrow(() => renderPromptBook(noDoc, [{ id: 1, handle: 'a', kind: 'say', body: 'x' }], null));

  const container = doc.createElement('div');
  renderPromptBook(container, [
    { id: 1, handle: 'wick', kind: 'emote', body: 'waves', role: 'npc' },
    { id: 2, handle: 'alice', kind: 'say', body: 'hello', role: 'muse' },
    { id: 3, handle: 'sys', kind: 'system', body: 'joined', role: 'muse' },
  ], doc);
  assert.equal(container.children.length, 3);
  assert.equal(container.children[0].className, 'pb-line pb-kind-emote');
  assert.equal(container.children[0].children.at(-1).textContent, ' waves');
  assert.equal(container.children[1].className, 'pb-line pb-kind-say');
  assert.equal(container.children[1].children.at(-1).textContent, ': hello');
  assert.equal(container.children[2].className, 'pb-line pb-kind-system');
  assert.equal(container.children[2].children.at(-1).textContent, ': joined');

  const guest = doc.createElement('div');
  renderPromptBook(guest, [{ id: 1, handle: 'rue', kind: 'say', body: 'hi', role: 'guest' }], doc);
  assert.deepEqual(guest.children[0].children.map((x) => x.className), ['pb-guest-pill', 'pb-handle', 'pb-body']);
  assert.equal(guest.children[0].children[0].textContent, '[guest]');

  renderPromptBook(container, [
    { id: 1, handle: 'a', kind: 'say', body: 'one', role: 'muse' },
    { id: 2, handle: 'b', kind: 'say', body: 'two', role: 'muse' },
  ], doc);
  assert.equal(container.children.length, 2);
  renderPromptBook(container, [{ id: 3, handle: 'c', kind: 'say', body: 'three', role: 'muse' }], doc);
  assert.equal(container.children.length, 1);
  assert.ok(container.children[0].textContent.includes('three'));
});

test('Slice 439: formatPlotGuestbookTabLabel formats only finite counts above zero (G4)', () => {
  assert.equal(formatPlotGuestbookTabLabel(-1), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(NaN), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(Infinity), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel('3'), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(null), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(1), 'Guestbook (1)');
  assert.equal(formatPlotGuestbookTabLabel(50), 'Guestbook (50)');
  assert.equal(formatPlotGuestbookTabLabel(1.5), 'Guestbook (1.5)');
});

test('Slice 439: resolveGuestbookOverlayContent renders town-time dates, skips bad entries, caps at 50, keeps order (G5)', async () => {
  const dated = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return {
          entries: [
            { id: 1, kind: 'guestbook', name: 'A', body: 'x', created_at: 1794614400 },
            { id: 2, kind: 'guestbook', name: 'B', body: 'y', created_at: 0 },
            { id: 3, kind: 'guestbook', name: 'C', body: 'z' },
            { id: 4, kind: 'guestbook', name: 'D', body: 'w', created_at: 'nope' },
          ],
        };
      },
    }),
  });
  assert.equal(dated.kind, 'api');
  assert.ok(dated.html.includes('Nov 13, 2026'));
  assert.ok(dated.html.includes('Dec 31, 1969'));
  assert.equal((dated.html.match(/<span class="meta">&middot;/g) || []).length, 2);

  const bad = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return { entries: [null, 'x', { id: 1, kind: 'guestbook' }, { id: 2, kind: 'letter', name: 'L' }] };
      },
    }),
  });
  assert.equal(bad.kind, 'api');
  assert.equal((bad.html.match(/<li>/g) || []).length, 2);
  assert.ok(bad.html.includes('<li><strong></strong><br></li>'));

  const entries = [
    ...Array.from({ length: 48 }, (_, i) => ({ id: i + 1, kind: 'guestbook', name: `g${i + 1}`, body: 'x', created_at: 1794614400 })),
    { id: 49, kind: 'unknown_kind', name: 'u1', body: 'x', created_at: 1794614400 },
    { id: 50, kind: 'guestbook', name: 'g49', body: 'x', created_at: 1794614400 },
    { id: 51, kind: 'guestbook', name: 'g50', body: 'x', created_at: 1794614400 },
    { id: 52, kind: 'guestbook', name: 'g51', body: 'x', created_at: 1794614400 },
  ];
  const capped = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 200, async json() { return { entries }; } }),
  });
  assert.equal((capped.html.match(/<li>/g) || []).length, 49);
  assert.ok(capped.html.includes('g49'));
  assert.ok(!capped.html.includes('g50'));
  assert.ok(!capped.html.includes('g51'));
  assert.ok(!capped.html.includes('u1'));

  const ordered = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return {
          entries: [
            { id: 9, kind: 'guestbook', name: 'new', body: 'x', created_at: 1794614400 },
            { id: 1, kind: 'guestbook', name: 'old', body: 'y', created_at: 1794441600 },
          ],
        };
      },
    }),
  });
  assert.ok(ordered.html.indexOf('>new<') < ordered.html.indexOf('>old<'));
});

test('Slice 439: resolveInnOverlayContent nights-left math, vacant edges, and handle escaping (G6)', async () => {
  const nowSec = 1700000000;
  const math = await resolveInnOverlayContent({
    innState: {
      lantern: { handle: 'a', nights: 3, expires_at: nowSec + 1.5 * 86400 },
      window: { handle: 'b', nights: 3, expires_at: nowSec + 0.2 * 86400 },
      quiet: { handle: 'c', nights: 3, expires_at: nowSec - 86400 },
    },
    nowSec,
  });
  assert.equal(math.kind, 'api');
  assert.ok(math.html.includes('Occupied — @a, 2 nights left.'));
  assert.ok(math.html.includes('Occupied — @b, 1 night left.'));
  assert.ok(math.html.includes('Occupied — @c, 1 night left.'));

  const fallback = await resolveInnOverlayContent({
    innState: {
      lantern: { handle: 'a', nights: 2.5 },
      window: { handle: 'b' },
      quiet: { handle: 'c', nights: 0 },
    },
    nowSec,
  });
  assert.ok(fallback.html.includes('Occupied — @a, 3 nights left.'));
  assert.ok(fallback.html.includes('Occupied — @b, 1 night left.'));
  assert.ok(fallback.html.includes('Occupied — @c, 1 night left.'));

  const vacant = await resolveInnOverlayContent({
    innState: {
      lantern: {},
      window: 'not-an-object',
      quiet: { handle: '' },
    },
    nowSec,
  });
  assert.equal(vacant.kind, 'api');
  assert.equal((vacant.html.match(/Vacant — free tonight\./g) || []).length, 3);

  const escaped = await resolveInnOverlayContent({
    innState: { lantern: { handle: '<b>wick</b>', nights: 1, expires_at: nowSec + 86400 }, window: null, quiet: null },
    nowSec,
  });
  assert.equal(escaped.html.includes('<b>wick</b>'), false);
  assert.ok(escaped.html.includes('&lt;b&gt;wick&lt;/b&gt;'));
});

test('Slice 439: applyState ignores out-of-range and non-integer footlight slots, last duplicate wins, unknown role reads muse (G7)', () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE);
  assert.equal(town.parts.footlights.length, 10);
  applyState(town, {
    state_seq: 1,
    footlights: [
      { handle: 'a', slot: 10, role: 'muse' },
      { handle: 'b', slot: -1, role: 'muse' },
      { handle: 'c', slot: 1.5, role: 'muse' },
      { handle: 'd', slot: '2', role: 'muse' },
    ],
    presence: [],
  });
  for (const fl of town.parts.footlights) {
    if (fl.userData.slot === 0) {
      assert.equal(fl.userData.handle, 'milo');
      continue;
    }
    assert.equal(fl.userData.lit, false, `slot ${fl.userData.slot} must stay dark`);
  }

  const town2 = buildTown(createThreeStub());
  applyState(town2, {
    state_seq: 1,
    footlights: [
      { handle: 'alice', slot: 1, role: 'muse' },
      { handle: 'bob', slot: 1, role: 'npc' },
    ],
    presence: [],
  });
  assert.equal(town2.parts.footlights[1].userData.handle, 'bob');
  assert.equal(town2.parts.footlights[1].userData.role, 'npc');

  const town3 = buildTown(createThreeStub());
  applyState(town3, {
    state_seq: 1,
    footlights: [{ handle: 'z', slot: 4, role: 'guest' }],
    presence: [],
  });
  assert.equal(town3.parts.footlights[4].userData.role, 'muse');
  assert.equal(town3.parts.footlights[4].userData.shell.material.emissive, FOOTLIGHT_COLORS.muse.emissive);
});

test('Slice 439: applyPlotManifest pins seed pads, orders strangers, replaces on re-apply, guards, and exhausts at 7 pads (G8)', () => {
  const manifestFor = (handle) => ({
    cottage: 'gable',
    wall: '#ddccbb',
    roof: '#554433',
    trim: '#221100',
    signpost_text: handle,
    props: [],
  });
  const THREE = createThreeStub();
  const town = buildTown(THREE);
  assert.deepEqual(town.parts.plotPads.map((p) => p.userData.plotNumber), [2, 3, 4, 5, 6, 7, 8]);

  const wick = applyPlotManifest(town, 'wick', manifestFor('wick'));
  const maren = applyPlotManifest(town, 'maren', manifestFor('maren'));
  const tomas = applyPlotManifest(town, 'tomas', manifestFor('tomas'));
  assert.equal(wick.userData.plotNumber, 2);
  assert.equal(maren.userData.plotNumber, 3);
  assert.equal(tomas.userData.plotNumber, 4);
  assert.equal(wick.userData.handle, 'wick');
  assert.equal(town._live.plotAssignments.get('wick').plotNumber, 2);
  assert.equal(town._live.cottagesByHandle.get('maren'), maren);

  const amy = applyPlotManifest(town, 'amy', manifestFor('amy'));
  const bob = applyPlotManifest(town, 'bob', manifestFor('bob'));
  assert.equal(amy.userData.plotNumber, 5);
  assert.equal(bob.userData.plotNumber, 6);

  const first = applyPlotManifest(town, 'wick', manifestFor('wick'));
  const second = applyPlotManifest(town, 'wick', { ...manifestFor('wick'), wall: '#112233', cottage: 'tower' });
  assert.equal(second.userData.plotNumber, 2);
  assert.notEqual(second, first);
  assert.equal(first.parent, null);
  assert.equal(town._live.cottagesByHandle.get('wick'), second);
  assert.equal(town.scene.children.includes(second), true);

  assert.equal(applyPlotManifest(town, 'milo', manifestFor('milo')), null);
  assert.equal(applyPlotManifest(town, 'amy', null), null);
  assert.equal(applyPlotManifest(town, '', manifestFor('x')), null);
  assert.equal(applyPlotManifest(town, 'amy', 'not-an-object'), null);
  assert.equal(applyPlotManifest(null, 'amy', manifestFor('amy')), null);

  const town2 = buildTown(createThreeStub());
  for (const h of ['wick', 'maren', 'tomas', 'a', 'b', 'c', 'd']) {
    assert.notEqual(applyPlotManifest(town2, h, manifestFor(h)), null, `${h} should get a pad`);
  }
  assert.deepEqual([...town2._live.plotAssignments.values()].map((a) => a.plotNumber).sort((x, y) => x - y), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(applyPlotManifest(town2, 'e', manifestFor('e')), null);
  assert.equal(applyPlotManifest(town2, 'ninth', manifestFor('ninth')), null);
});

test('Slice 439: TownLive start and stop, backoff cap, invalid state, no-fetch, and status callbacks (G9)', async () => {
  const makeTimer = () => {
    const calls = { set: 0, clear: 0 };
    let nextId = 1;
    return {
      calls,
      setInterval: () => { calls.set += 1; return nextId++; },
      clearInterval: () => { calls.clear += 1; },
    };
  };

  const THREE = createThreeStub();
  const town = buildTown(THREE);
  const timer = makeTimer();
  let fetchCalls = 0;
  const live = new TownLive(town, {
    fetch: async () => { fetchCalls += 1; return { status: 304 }; },
    apiBase: '',
    timer,
  });
  live.start();
  live.start();
  assert.equal(timer.calls.set, 1);
  assert.equal(fetchCalls, 1);
  live.stop();
  assert.equal(timer.calls.clear, 1);
  live.stop();
  assert.equal(timer.calls.clear, 1);

  const town2 = buildTown(createThreeStub());
  const live2 = new TownLive(town2, {
    fetch: async () => { throw new Error('down'); },
    apiBase: '',
    pollIntervalMs: 5000,
    maxBackoffMs: 12000,
    timer: makeTimer(),
  });
  let r = await live2.pollOnce();
  assert.equal(r.error, 'network_error');
  assert.equal(live2.currentIntervalMs, 10000);
  r = await live2.pollOnce();
  assert.equal(live2.currentIntervalMs, 12000);
  r = await live2.pollOnce();
  assert.equal(live2.currentIntervalMs, 12000);
  assert.equal(live2.connected, false);

  const town3 = buildTown(createThreeStub());
  let mode = 'invalid';
  const live3 = new TownLive(town3, {
    fetch: async () => {
      if (mode === 'invalid') return { status: 200, async json() { return { footlights: [] }; } };
      return { status: 200, async json() { return { state_seq: 7, footlights: [], presence: [], prompt_book: [] }; } };
    },
    apiBase: '',
    pollIntervalMs: 5000,
    maxBackoffMs: 60000,
    timer: makeTimer(),
  });
  r = await live3.pollOnce();
  assert.equal(r.error, 'invalid_state');
  assert.equal(live3.currentIntervalMs, 10000);
  assert.equal(live3.lastSeq, null);
  mode = 'valid';
  r = await live3.pollOnce();
  assert.equal(r.changed, true);
  assert.equal(live3.currentIntervalMs, 5000);
  assert.equal(live3.lastSeq, 7);
  assert.equal(live3.connected, true);

  const town4 = buildTown(createThreeStub());
  const live4 = new TownLive(town4, { apiBase: '' });
  live4.fetchFn = null;
  r = await live4.pollOnce();
  assert.deepEqual(r, { changed: false, error: 'no_fetch' });

  const town5 = buildTown(createThreeStub());
  const states = [];
  const statuses = [];
  const live5 = new TownLive(town5, {
    fetch: async () => ({ status: 200, async json() { return { state_seq: 3, footlights: [], presence: [], prompt_book: [] }; } }),
    apiBase: '',
    timer: makeTimer(),
    onState: (s) => states.push(s.state_seq),
    onStatus: (s) => statuses.push(s),
  });
  r = await live5.pollOnce();
  assert.equal(r.changed, true);
  assert.deepEqual(states, [3]);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].connected, true);
  assert.equal(statuses[0].intervalMs, 5000);
  assert.equal(statuses[0].stateSeq, 3);

  const live6 = new TownLive(buildTown(createThreeStub()), { fetch: async () => ({ status: 304 }), apiBase: 'https://x.example///' });
  assert.equal(live6.apiBase, 'https://x.example');
});

test('Slice 501: file hygiene - 60 unique test names, 11 import lines, and pinned literal counts (G10)', () => {
  const src = fsSync.readFileSync(path.join(__dirname, 'test-3d-live.mjs'), 'utf8');
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 60);
  assert.equal(new Set(names).size, 60);
  for (const name of names) {
    assert.equal(name.includes("'"), false, 'test names must contain no apostrophes');
  }
  const lines = src.split('\n');
  assert.equal(lines.filter((l) => l.startsWith('import ')).length, 11);
  const countLines = (needle) => lines.filter((l) => l.includes(needle)).length;
  assert.equal(countLines('fet' + 'ch('), 1);
  assert.equal(countLines('Date' + '.now'), 0);
  assert.equal(countLines('Math' + '.random'), 0);
  assert.equal(countLines('TO' + 'DO'), 0);
  assert.equal(countLines('FIX' + 'ME'), 0);
  assert.equal(countLines('inner' + 'HTML'), 3);
  assert.equal(lines.filter((l) => new RegExp('camp' + 'fire', 'i').test(l)).length, 3);
});

test('Slice 501: pinchFov clamps to [40, 85] and passes through mid values (P1)', () => {
  assert.equal(pinchFov(60, 100, 50), 85);
  assert.equal(pinchFov(60, 100, 200), 40);
  assert.equal(pinchFov(60, 100, 100), 60);
  assert.equal(pinchFov(60, 100, 150), 40);
  assert.equal(pinchFov(60, 100, 80), 75);
});

test('Slice 501: pinchFov invalid inputs return startFov unchanged (P2)', () => {
  assert.ok(Number.isNaN(pinchFov(NaN, 100, 100)));
  assert.equal(pinchFov(60, 0, 100), 60);
  assert.equal(pinchFov(60, 100, -5), 60);
  assert.equal(pinchFov(60, 100, Infinity), 60);
  assert.equal(pinchFov(60, Infinity, 100), 60);
});

test('Slice 501: stepGlide with invalid dt returns the position, never arrived (P3)', () => {
  assert.deepEqual(stepGlide({ x: 1, z: 2 }, { x: 5, z: 6 }, 0), { x: 1, z: 2, arrived: false });
  assert.deepEqual(stepGlide({ x: 1, z: 2 }, { x: 5, z: 6 }, -1), { x: 1, z: 2, arrived: false });
  assert.deepEqual(stepGlide({ x: 1, z: 2 }, { x: 5, z: 6 }, NaN), { x: 1, z: 2, arrived: false });
  assert.deepEqual(stepGlide({ x: 5, z: 6 }, { x: 5, z: 6 }, 1), { x: 5, z: 6, arrived: true });
});

test('Slice 501: stepGlide clamps far targets and far positions to maxRadius 28.5 (P4)', () => {
  assert.deepEqual(stepGlide({ x: 0, z: 0 }, { x: 40, z: 0 }, 10), { x: 28.5, z: 0, arrived: true });
  const r = stepGlide({ x: 40, z: 0 }, { x: 0, z: 0 }, 0.1);
  assert.ok(Math.abs(r.x - 28.5) < 1e-9, `x ${r.x} is ~28.5`);
  assert.equal(r.z, 0);
  assert.equal(r.arrived, false);
});

test('Slice 501: getPlotTargetPosition lateral offsets mirror across the forward axis (P5)', () => {
  const layout = TOWN_LAYOUT.plots[0];
  const p0 = getPlotTargetPosition(layout, 0);
  const p1 = getPlotTargetPosition(layout, 1);
  const p2 = getPlotTargetPosition(layout, 2);
  const p3 = getPlotTargetPosition(layout, 3);
  const p4 = getPlotTargetPosition(layout, 4);
  assert.equal(p0.rotY, layout.rotY);
  assert.equal(p0.y, 0);
  assert.ok(Math.abs(Math.hypot(p0.x - layout.x, p0.z - layout.z) - 3.6) < 1e-3);
  assert.ok(Math.abs((p1.x + p2.x) / 2 - p0.x) < 1e-3);
  assert.ok(Math.abs((p1.z + p2.z) / 2 - p0.z) < 1e-3);
  assert.ok(Math.abs(Math.hypot(p1.x - p2.x, p1.z - p2.z) - 1.8) < 1e-3);
  assert.ok(Math.abs((p3.x + p4.x) / 2 - p0.x) < 1e-3);
  assert.ok(Math.abs((p3.z + p4.z) / 2 - p0.z) < 1e-3);
  assert.ok(Math.abs(Math.hypot(p3.x - p4.x, p3.z - p4.z) - 3.6) < 1e-3);
  assert.ok(Math.abs(Math.hypot(p3.x - p1.x, p3.z - p1.z) - 0.9) < 1e-3);
});

test('Slice 501: buildNoticeBoardOverlayHtml renders the three papers in order, no script (P6)', () => {
  const html = buildNoticeBoardOverlayHtml();
  assert.equal((html.match(/<section class="notice">/g) || []).length, 3);
  assert.ok(html.includes('<h1>Notice Board</h1>'));
  const titles = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['GAZETTE #2', 'THE INN', 'SOCIAL GATE']);
  assert.ok(html.includes('<p>Issue #2 is out — read it at the newsstand.</p>'));
  assert.ok(html.includes('<p>Rooms for short stays — ask at the tavern.</p>'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('http'));
});

test('Slice 501: updateInnOccupancy direct claim shape decides palette and non-objects are no-ops (P7)', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  updateInnOccupancy(town, { lantern: { handle: 'wick' }, window: [], quiet: 'x' });
  assert.equal(getInnWindow(town, 4).material.emissiveIntensity, 1.4);
  assert.equal(getInnWindow(town, 4).material.color, '#ffbe5c');
  assert.equal(getInnWindow(town, 5).material.emissiveIntensity, 0.15);
  assert.equal(getInnWindow(town, 6).material.emissiveIntensity, 0.15);
  assert.equal(getInnWindow(town, 0).material.emissiveIntensity, 1.4);
  updateInnOccupancy(town, { lantern: null, window: null, quiet: null });
  for (let idx = 0; idx < 8; idx++) {
    assert.equal(getInnWindow(town, idx).material.emissiveIntensity, 0.15);
  }
  const before = getInnWindow(town, 4).material.emissiveIntensity;
  updateInnOccupancy(town, null);
  updateInnOccupancy(town, 'x');
  updateInnOccupancy(town, []);
  assert.equal(getInnWindow(town, 4).material.emissiveIntensity, before);
});

test('Slice 501: applyState trusts a slot-0 row for a non-milo handle (P8)', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  const fl0 = town.parts.footlights[0];
  assert.equal(fl0.userData.handle, 'milo');
  assert.equal(fl0.userData.lit, true);
  assert.equal(fl0.userData.permanent, true);
  applyState(town, { footlights: [{ handle: 'wick', slot: 0, role: 'npc' }], presence: [] });
  assert.equal(fl0.userData.handle, 'wick');
  assert.equal(fl0.userData.lit, true);
  assert.equal(fl0.userData.role, 'npc');
  assert.equal(fl0.userData.permanent, true);
  assert.equal(fl0.userData.shell.material.emissiveIntensity, 1.0);
});

test('Slice 501: permanent flag is sticky so slot 0 stays lit as wick after row disappears (P9)', () => {
  const town = buildTown(createThreeStub(), { loadProps: false });
  applyState(town, { footlights: [{ handle: 'wick', slot: 0, role: 'npc' }], presence: [] });
  applyState(town, { footlights: [], presence: [] });
  const fl0 = town.parts.footlights[0];
  assert.equal(fl0.userData.lit, true);
  assert.equal(fl0.userData.handle, 'wick');
});

test('Slice 501: handle-less footlight row lights slot with muse palette and milo placard (P10)', () => {
  withRecordingCanvas((draws) => {
    const town = buildTown(createThreeStub(), { loadProps: false });
    draws.length = 0;
    applyState(town, { footlights: [{ slot: 3 }], presence: [] });
    const fl3 = town.parts.footlights[3];
    assert.equal(fl3.userData.lit, true);
    assert.equal(fl3.userData.handle, undefined);
    assert.equal(fl3.userData.statusText, null);
    assert.equal(fl3.userData.role, 'muse');
    assert.equal(fl3.userData.shell.material.emissiveIntensity, 0.9);
    assert.deepEqual(draws.map((d) => d.text), ['milo']);
  });
});
