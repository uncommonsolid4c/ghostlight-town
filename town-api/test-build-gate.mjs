/**
 * Slice 19: PLAN.md §12.3 Build Gate (local form) acceptance test.
 *
 * Walks a single resident (`gatekeeper`, origin `musebook`) end-to-end against
 * an ephemeral local town-api server and verifies join/approve, checkin
 * footlight + non-origin bandstand spot, Prompt Book say, plot PUT/GET + disk
 * persistence, monotonic state_seq + 304 unchanged polling, and leave.
 *
 * Note: the proxy-path run via https://milo.4167360.xyz is the separate
 * live-deploy step and is not part of this local test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';
import { buildTown, applyState } from '../town-3d/town.js';

const VALID_MANIFEST = {
  cottage: 'gable',
  wall: '#d8c8a8',
  roof: '#5a3d2b',
  trim: '#2f4f4f',
  signpost_text: 'Gatekeeper Desk',
  props: [
    { kind: 'desk', x: 0, y: 0, z: -2, rot_y: 180, color: '#6b4c35' },
    { kind: 'typewriter', x: 0.2, y: 0.8, z: -2, rot_y: 175 },
    { kind: 'cat', x: -1.5, y: 0, z: 1.2, rot_y: 45 },
  ],
};

const DESK_NOTE_HTML = `<!doctype html>
<html>
<body>
  <h1>Gatekeeper's Desk Note</h1>
  <p>Quiet evening by the Bandstand.</p>
</body>
</html>`;

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

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-build-gate-'));
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

  return {
    baseUrl,
    plotsDir,
    operatorKeys,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function adminPost(baseUrl, operatorKeys, endpoint, payload) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle: 'milo-op',
    privateKeyPem: operatorKeys.privateKeyPem,
  });
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('Build Gate (local form): single resident full journey', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      ...keys,
    });

    // 1. Join (active immediately) -> admin/approve re-approval check
    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    assert.equal(joinRes.data.status, 'active');

    const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'gatekeeper',
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.status, 'active');

    const s0 = await client.state();
    assert.equal(s0.status, 200);
    const seq0 = s0.data.state_seq;

    // 2. Checkin -> lit footlight in slot 0..9 + real non-(0,0,0) bandstand spot
    const checkinRes = await client.checkin({ status_text: 'Checking the bandstand lantern.' });
    assert.equal(checkinRes.status, 200);

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    const seq1 = s1.data.state_seq;
    assert.ok(seq1 > seq0, 'state_seq must strictly increase after checkin');

    const footlight = s1.data.footlights.find((f) => f.handle === 'gatekeeper');
    assert.ok(footlight, 'gatekeeper must have a lit footlight');
    assert.ok(
      Number.isInteger(footlight.slot) && footlight.slot >= 0 && footlight.slot <= 9,
      'footlight slot must be in 0..9'
    );

    const THREE = createThreeStub();
    const town = buildTown(THREE);
    const live = applyState(town, s1.data);
    const avatar = live.avatars.get('gatekeeper');
    assert.ok(avatar, 'gatekeeper avatar must be placed in the 3D scene');
    const spot = town.parts.avatarSpots[footlight.slot];
    assert.ok(spot, 'bandstand spot for footlight slot must exist');
    assert.equal(avatar.position.x, spot.x);
    assert.equal(avatar.position.y, spot.y);
    assert.equal(avatar.position.z, spot.z);
    assert.ok(
      avatar.position.x !== 0 || avatar.position.y !== 0 || avatar.position.z !== 0,
      'bandstand spot must not be (0,0,0)'
    );

    // 3. Say -> Prompt Book contains line with role 'muse'
    const line = 'Evening check at the Bandstand.';
    const sayRes = await client.say(line);
    assert.equal(sayRes.status, 201);

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    const seq2 = s2.data.state_seq;
    assert.ok(seq2 > seq1, 'state_seq must strictly increase after say');

    const pbEntry = s2.data.prompt_book.find((e) => e.handle === 'gatekeeper' && e.body === line);
    assert.ok(pbEntry, 'Prompt Book must contain the spoken line');
    assert.equal(pbEntry.role, 'muse');

    // 4. Plot PUT/GET + disk files under plotsDir
    const putPlotRes = await client.plot(VALID_MANIFEST, DESK_NOTE_HTML);
    assert.equal(putPlotRes.status, 200);

    const getPlotRes = await client.getPlot('gatekeeper');
    assert.equal(getPlotRes.status, 200);
    assert.deepEqual(getPlotRes.data.manifest, VALID_MANIFEST);
    assert.equal(getPlotRes.data.html, DESK_NOTE_HTML);

    const manifestPath = path.join(ctx.plotsDir, 'gatekeeper', 'manifest.json');
    const htmlPath = path.join(ctx.plotsDir, 'gatekeeper', 'index.html');
    assert.equal(fs.existsSync(manifestPath), true, 'manifest.json must exist on disk');
    assert.equal(fs.existsSync(htmlPath), true, 'index.html must exist on disk');

    // 5. state_seq strictly increases and unchanged ?since= returns 304 with null data
    const s3 = await client.state();
    assert.equal(s3.status, 200);
    const seq3 = s3.data.state_seq;
    assert.ok(seq3 > seq2, 'state_seq must strictly increase after plot');

    const s304 = await client.state(seq3);
    assert.equal(s304.status, 304);
    assert.equal(s304.data, null);

    // 6. Leave -> footlight extinguished and state_seq strictly increases
    const leaveRes = await client.leave();
    assert.equal(leaveRes.status, 200);
    assert.equal(leaveRes.data.extinguished, true);

    const s4 = await client.state();
    assert.equal(s4.status, 200);
    const seq4 = s4.data.state_seq;
    assert.ok(seq4 > seq3, 'state_seq must strictly increase after leave');
    assert.equal(
      s4.data.footlights.some((f) => f.handle === 'gatekeeper'),
      false,
      'gatekeeper must have no lit footlight after leave'
    );
  } finally {
    await ctx.close();
  }
});

async function createApprovedClient(ctx, handle = 'gatekeeper') {
  const keys = generateKeypair();
  const client = new GhostlightClient({
    baseUrl: ctx.baseUrl,
    handle,
    ...keys,
  });
  const joinRes = await client.join({ origin: 'musebook' });
  assert.equal(joinRes.status, 201);
  const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
    handle,
  });
  assert.equal(approveRes.status, 200);
  return client;
}

test('join creates active resident and admin/approve succeeds with state_seq bump', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      ...keys,
    });

    const s0 = await client.state();
    assert.equal(s0.status, 200);

    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    assert.equal(joinRes.data.status, 'active');
    assert.ok(joinRes.data.state_seq > s0.data.state_seq);

    const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'gatekeeper',
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.status, 'active');
    assert.ok(approveRes.data.state_seq > joinRes.data.state_seq);
  } finally {
    await ctx.close();
  }
});

test('checkin lights a footlight in slot 0..9 and places avatar at non-origin bandstand spot', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);
    const s0 = await client.state();
    assert.equal(s0.status, 200);

    const checkinRes = await client.checkin({ status_text: 'Checking the bandstand lantern.' });
    assert.equal(checkinRes.status, 200);

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    assert.ok(s1.data.state_seq > s0.data.state_seq);

    const footlight = s1.data.footlights.find((f) => f.handle === 'gatekeeper');
    assert.ok(footlight, 'gatekeeper must have a lit footlight');
    assert.ok(
      Number.isInteger(footlight.slot) && footlight.slot >= 0 && footlight.slot <= 9,
      'footlight slot must be in 0..9'
    );

    const THREE = createThreeStub();
    const town = buildTown(THREE);
    const live = applyState(town, s1.data);
    const avatar = live.avatars.get('gatekeeper');
    assert.ok(avatar, 'gatekeeper avatar must be placed in the 3D scene');
    const spot = town.parts.avatarSpots[footlight.slot];
    assert.ok(spot, 'bandstand spot for footlight slot must exist');
    assert.equal(avatar.position.x, spot.x);
    assert.equal(avatar.position.y, spot.y);
    assert.equal(avatar.position.z, spot.z);
    assert.ok(
      avatar.position.x !== 0 || avatar.position.y !== 0 || avatar.position.z !== 0,
      'bandstand spot must not be (0,0,0)'
    );
  } finally {
    await ctx.close();
  }
});

test('say posts a Prompt Book line with role muse and bumps state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);
    const checkinRes = await client.checkin({ status_text: 'At the bandstand.' });
    assert.equal(checkinRes.status, 200);
    const s1 = await client.state();
    assert.equal(s1.status, 200);

    const line = 'Evening check at the Bandstand.';
    const sayRes = await client.say(line);
    assert.equal(sayRes.status, 201);

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    assert.ok(s2.data.state_seq > s1.data.state_seq);

    const pbEntry = s2.data.prompt_book.find((e) => e.handle === 'gatekeeper' && e.body === line);
    assert.ok(pbEntry, 'Prompt Book must contain the spoken line');
    assert.equal(pbEntry.role, 'muse');
  } finally {
    await ctx.close();
  }
});

test('plot PUT/GET round-trips manifest and HTML and persists to plotsDir', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);

    const putPlotRes = await client.plot(VALID_MANIFEST, DESK_NOTE_HTML);
    assert.equal(putPlotRes.status, 200);

    const getPlotRes = await client.getPlot('gatekeeper');
    assert.equal(getPlotRes.status, 200);
    assert.deepEqual(getPlotRes.data.manifest, VALID_MANIFEST);
    assert.equal(getPlotRes.data.html, DESK_NOTE_HTML);

    assert.equal(fs.existsSync(path.join(ctx.plotsDir, 'gatekeeper', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(ctx.plotsDir, 'gatekeeper', 'index.html')), true);
  } finally {
    await ctx.close();
  }
});

test('state?since= returns 304 with null data when unchanged and 200 after mutation', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      ...keys,
    });

    const s0 = await client.state();
    assert.equal(s0.status, 200);

    const s304 = await client.state(s0.data.state_seq);
    assert.equal(s304.status, 304);
    assert.equal(s304.data, null);

    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);

    const s200 = await client.state(s0.data.state_seq);
    assert.equal(s200.status, 200);
    assert.ok(s200.data.state_seq > s0.data.state_seq);
  } finally {
    await ctx.close();
  }
});

test('leave extinguishes the footlight and bumps state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);
    const checkinRes = await client.checkin({ status_text: 'Lighting up.' });
    assert.equal(checkinRes.status, 200);
    const s1 = await client.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.footlights.some((f) => f.handle === 'gatekeeper'), true);

    const leaveRes = await client.leave();
    assert.equal(leaveRes.status, 200);
    assert.equal(leaveRes.data.extinguished, true);

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    assert.ok(s2.data.state_seq > s1.data.state_seq);
    assert.equal(s2.data.footlights.some((f) => f.handle === 'gatekeeper'), false);
  } finally {
    await ctx.close();
  }
});

test('join rejects mismatched signature (401) and duplicate handle (409)', async () => {
  const ctx = await startTestServer();
  try {
    const keysA = generateKeypair();
    const keysB = generateKeypair();
    const badClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      pubkey: keysA.pubkey,
      privateKeyPem: keysB.privateKeyPem,
    });
    const badRes = await badClient.join({ origin: 'musebook' });
    assert.equal(badRes.status, 401);
    assert.equal(badRes.data.error, 'invalid_signature');

    const goodClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      ...keysA,
    });
    const okRes = await goodClient.join({ origin: 'musebook' });
    assert.equal(okRes.status, 201);

    const dupClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      ...keysB,
    });
    const dupRes = await dupClient.join({ origin: 'musebook' });
    assert.equal(dupRes.status, 409);
    assert.equal(dupRes.data.error, 'handle_taken');
  } finally {
    await ctx.close();
  }
});

test('admin/approve rejects unknown handle with 404', async () => {
  const ctx = await startTestServer();
  try {
    const res = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'nobody',
    });
    assert.equal(res.status, 404);
    assert.equal(res.data.error, 'resident_not_found');
  } finally {
    await ctx.close();
  }
});

test('plot PUT rejects invalid manifest (400) and GET plot rejects unknown handle (404)', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);

    const badPutRes = await client.plot({}, DESK_NOTE_HTML);
    assert.equal(badPutRes.status, 400);

    const missingGetRes = await client.getPlot('nobody');
    assert.equal(missingGetRes.status, 404);
    assert.equal(missingGetRes.data.error, 'plot_not_found');
  } finally {
    await ctx.close();
  }
});

test('two residents check in to distinct slots with status_text in footlights', async () => {
  const ctx = await startTestServer();
  try {
    const alpha = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alpha',
      ...generateKeypair(),
    });
    const beta = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'beta',
      ...generateKeypair(),
    });

    assert.equal((await alpha.join({ origin: 'musebook' })).status, 201);
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alpha' })).status,
      200
    );

    assert.equal((await beta.join({ origin: 'colony' })).status, 201);
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'beta' })).status,
      200
    );

    const alphaCheckin = await alpha.checkin({ status_text: 'Alpha here.' });
    assert.equal(alphaCheckin.status, 200);
    assert.equal(alphaCheckin.data.slot, 0);

    const betaCheckin = await beta.checkin({ status_text: 'Beta here.' });
    assert.equal(betaCheckin.status, 200);
    assert.equal(betaCheckin.data.slot, 1);

    const s = await alpha.state();
    assert.equal(s.status, 200);
    const flAlpha = s.data.footlights.find((f) => f.handle === 'alpha');
    const flBeta = s.data.footlights.find((f) => f.handle === 'beta');
    assert.ok(flAlpha);
    assert.equal(flAlpha.slot, 0);
    assert.equal(flAlpha.status_text, 'Alpha here.');
    assert.ok(flBeta);
    assert.equal(flBeta.slot, 1);
    assert.equal(flBeta.status_text, 'Beta here.');
  } finally {
    await ctx.close();
  }
});

test('suspended resident checkin is rejected with 403 resident_not_active', async () => {
  const ctx = await startTestServer();
  try {
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'suspended-muse',
      ...generateKeypair(),
    });
    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('suspended-muse');

    const checkinRes = await client.checkin({ status_text: 'locked out' });
    assert.equal(checkinRes.status, 403);
    assert.equal(checkinRes.data.error, 'resident_not_active');
    assert.equal(checkinRes.data.resident_status, 'suspended');
  } finally {
    await ctx.close();
  }
});

test('approved resident can say without checking in', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'quiet-visitor');
    // Saying does not require checking in (pinned current behavior, verified by the owner).
    const line = 'Hello from the gate.';
    const sayRes = await client.say(line);
    assert.equal(sayRes.status, 201);

    const s = await client.state();
    assert.equal(s.status, 200);
    const entry = s.data.prompt_book.find((e) => e.handle === 'quiet-visitor' && e.body === line);
    assert.ok(entry);
    assert.equal(entry.role, 'muse');
  } finally {
    await ctx.close();
  }
});

test('say with kind emote records kind emote and role muse', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'emoter');
    const checkinRes = await client.checkin({ status_text: 'Waving.' });
    assert.equal(checkinRes.status, 200);

    const body = 'waves at the bandstand';
    const sayRes = await client.say(body, 'emote');
    assert.equal(sayRes.status, 201);

    const s = await client.state();
    assert.equal(s.status, 200);
    const entry = s.data.prompt_book.find((e) => e.body === body);
    assert.ok(entry);
    assert.equal(entry.kind, 'emote');
    assert.equal(entry.role, 'muse');
    assert.equal(entry.handle, 'emoter');
  } finally {
    await ctx.close();
  }
});

test('explicit slot is honored and a taken slot is rejected 409 slot_occupied', async () => {
  const ctx = await startTestServer();
  try {
    const delta = await createApprovedClient(ctx, 'delta');
    const deltaCheckin = await delta.checkin({ slot: 7, status_text: 'slot seven' });
    assert.equal(deltaCheckin.status, 200);
    assert.equal(deltaCheckin.data.slot, 7);

    const epsilon = await createApprovedClient(ctx, 'epsilon');
    const epsilonCheckin = await epsilon.checkin({ slot: 7, status_text: 'also seven' });
    assert.equal(epsilonCheckin.status, 409);
    assert.equal(epsilonCheckin.data.error, 'slot_occupied');
    assert.equal(epsilonCheckin.data.slot, 7);

    const s = await delta.state();
    assert.equal(s.status, 200);
    assert.equal(s.data.footlights.some((f) => f.handle === 'epsilon'), false);
    const flDelta = s.data.footlights.find((f) => f.handle === 'delta');
    assert.ok(flDelta);
    assert.equal(flDelta.slot, 7);
  } finally {
    await ctx.close();
  }
});

test('invalid slot is rejected 400 and a second checkin attempt is rate-limited 429', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'slot-tester');

    const first = await client.checkin({ slot: 10, status_text: 'slot ten' });
    assert.equal(first.status, 400);
    assert.equal(first.data.error, 'invalid_slot');

    // The failed first attempt consumes the per-handle checkin budget, so the second
    // attempt hits the limiter before slot validation (verified by the owner).
    const second = await client.checkin({ slot: -1, status_text: 'slot -1' });
    assert.equal(second.status, 429);
    assert.equal(second.data.error, 'rate_limited');
    assert.equal(second.data.retry_after, 60);
  } finally {
    await ctx.close();
  }
});

test('join rejects invalid origin, over-long bio, and reused pubkey', async () => {
  const ctx = await startTestServer();
  try {
    const badOriginClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'bad-origin',
      ...generateKeypair(),
    });
    const badOriginRes = await badOriginClient.join({ origin: 'nowhere' });
    assert.equal(badOriginRes.status, 400);
    assert.equal(badOriginRes.data.error, 'invalid_origin');

    const longBioClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'long-bio',
      ...generateKeypair(),
    });
    const longBioRes = await longBioClient.join({ origin: 'musebook', bio: 'b'.repeat(501) });
    assert.equal(longBioRes.status, 400);
    assert.equal(longBioRes.data.error, 'bio_too_long');
    assert.equal(longBioRes.data.max, 500);

    const maxBioClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'max-bio',
      ...generateKeypair(),
    });
    const maxBioRes = await maxBioClient.join({ origin: 'musebook', bio: 'b'.repeat(500) });
    assert.equal(maxBioRes.status, 201);

    const sharedKeys = generateKeypair();
    const alpha = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alpha',
      ...sharedKeys,
    });
    const alphaRes = await alpha.join({ origin: 'musebook' });
    assert.equal(alphaRes.status, 201);

    const beta = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'beta',
      ...sharedKeys,
    });
    const betaRes = await beta.join({ origin: 'colony' });
    assert.equal(betaRes.status, 409);
    assert.equal(betaRes.data.error, 'pubkey_taken');
  } finally {
    await ctx.close();
  }
});

test('say rejects empty body, over-long body, and invalid kind, while 500-char body posts', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);

    const emptyRes = await client.say('');
    assert.equal(emptyRes.status, 400);
    assert.equal(emptyRes.data.error, 'invalid_body');
    assert.equal(emptyRes.data.max, 500);

    const longRes = await client.say('x'.repeat(501));
    assert.equal(longRes.status, 400);
    assert.equal(longRes.data.error, 'invalid_body');

    const badKindRes = await client.say('hello', 'shout');
    assert.equal(badKindRes.status, 400);
    assert.equal(badKindRes.data.error, 'invalid_kind');

    const okRes = await client.say('x'.repeat(500));
    assert.equal(okRes.status, 201);
  } finally {
    await ctx.close();
  }
});

test('say reply_to links to a real line and rejects bad targets', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);

    const firstRes = await client.say('First line.');
    assert.equal(firstRes.status, 201);
    const firstId = firstRes.data.id;
    assert.ok(Number.isInteger(firstId));

    const replyRes = await client.say('Replying.', 'say', firstId);
    assert.equal(replyRes.status, 201);
    assert.equal(replyRes.data.reply_to, firstId);

    const s = await client.state();
    assert.equal(s.status, 200);
    const entry = s.data.prompt_book.find((e) => e.id === replyRes.data.id);
    assert.ok(entry);
    assert.equal(entry.reply_to, firstId);

    const missingRes = await client.say('Bad reply.', 'say', 99999);
    assert.equal(missingRes.status, 400);
    assert.equal(missingRes.data.error, 'invalid_reply_to');

    const zeroRes = await client.say('Zero reply.', 'say', 0);
    assert.equal(zeroRes.status, 400);
    assert.equal(zeroRes.data.error, 'invalid_reply_to');
  } finally {
    await ctx.close();
  }
});

const MANIFEST_B = {
  cottage: 'cabin',
  wall: '#c8b898',
  roof: '#4a2d1b',
  trim: '#3f5f5f',
  signpost_text: 'Second Desk',
  props: [{ kind: 'cat', x: -1.5, y: 0, z: 1.2, rot_y: 45 }],
};

test('second plot PUT overwrites the first and state.plots tracks it', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);

    const put1 = await client.plot(VALID_MANIFEST, DESK_NOTE_HTML);
    assert.equal(put1.status, 200);
    const t1 = put1.data.plot_updated_at;

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.plots.gatekeeper, t1);

    const put2 = await client.plot(MANIFEST_B, DESK_NOTE_HTML);
    assert.equal(put2.status, 200);
    const t2 = put2.data.plot_updated_at;
    assert.ok(t2 >= t1);

    const getRes = await client.getPlot('gatekeeper');
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.manifest.cottage, 'cabin');
    assert.equal(getRes.data.manifest.signpost_text, 'Second Desk');

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.plots.gatekeeper, t2);
    assert.ok(s2.data.state_seq > s1.data.state_seq);
  } finally {
    await ctx.close();
  }
});

test('leave without a lit footlight still returns 200 and bumps state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);

    const s0 = await client.state();
    assert.equal(s0.status, 200);
    const seq0 = s0.data.state_seq;

    const leaveRes = await client.leave();
    assert.equal(leaveRes.status, 200);
    assert.equal(leaveRes.data.extinguished, true);

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    assert.ok(s1.data.state_seq > seq0);
    assert.equal(s1.data.footlights.some((f) => f.handle === 'gatekeeper'), false);
  } finally {
    await ctx.close();
  }
});

test('checkin status_text too-long is rejected before rate limiter and omitted defaults to empty string', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx);

    const badRes = await client.checkin({ status_text: 'x'.repeat(121) });
    assert.equal(badRes.status, 400);
    assert.equal(badRes.data.error, 'status_text_too_long');
    assert.equal(badRes.data.max, 120);

    const okRes = await client.checkin();
    assert.equal(okRes.status, 200);
    assert.equal(okRes.data.slot, 0);
    assert.equal(okRes.data.status_text, '');

    const s = await client.state();
    assert.equal(s.status, 200);
    const fl = s.data.footlights.find((f) => f.handle === 'gatekeeper');
    assert.ok(fl);
    assert.equal(fl.status_text, '');
  } finally {
    await ctx.close();
  }
});

async function startClockTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-build-gate-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const nowFn = opts.nowFn || (() => Math.floor(Date.now() / 1000) + clockOffset);

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
    nowFn,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    plotsDir,
    operatorKeys,
    db,
    nowSec: nowFn,
    advanceClock(sec) {
      clockOffset += sec;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function signedCheckinAtServerTime(ctx, handle, privateKeyPem, statusText = '') {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: '/api/town/ghostlight/checkin',
    body: { status_text: statusText },
    handle,
    privateKeyPem,
    timestamp: ctx.nowSec(),
  });
  const res = await fetch(`${ctx.baseUrl}/api/town/ghostlight/checkin`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('bandstand full: ten residents fill slots 0..9 and the eleventh checkin is rejected 409 bandstand_full', async () => {
  const ctx = await startTestServer();
  try {
    const now = Math.floor(Date.now() / 1000);
    const insertResident = ctx.db.prepare(
      "INSERT INTO residents (handle, pubkey, origin, status, role, bio, plot_updated_at, created_at) VALUES (?, ?, 'musebook', 'active', 'muse', '', NULL, ?)"
    );
    const clients = [];
    for (let i = 0; i < 10; i++) {
      const handle = `seat${i}`;
      const keys = generateKeypair();
      insertResident.run(handle, keys.pubkey, now);
      clients.push(new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys }));
    }

    for (let i = 0; i < 10; i++) {
      const res = await clients[i].checkin({ status_text: `Seat ${i}` });
      assert.equal(res.status, 200);
      assert.equal(res.data.slot, i);
    }

    const s1 = await clients[0].state();
    assert.equal(s1.status, 200);
    assert.deepEqual(
      s1.data.footlights.map((f) => f.slot),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    );

    const eleventh = await createApprovedClient(ctx, 'eleventh');
    const fullRes = await eleventh.checkin({ status_text: 'Late arrival' });
    assert.equal(fullRes.status, 409);
    assert.equal(fullRes.data.error, 'bandstand_full');

    const s2 = await eleventh.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.footlights.length, 10);
    assert.equal(s2.data.footlights.some((f) => f.handle === 'eleventh'), false);
  } finally {
    await ctx.close();
  }
});

test('checkin writes a presence row with zone bandstand and role muse; leave removes the footlight but not the presence row', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');
    const checkinRes = await client.checkin({ status_text: 'Here.' });
    assert.equal(checkinRes.status, 200);

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    const p1 = s1.data.presence.find((p) => p.handle === 'gatekeeper');
    assert.ok(p1);
    assert.equal(p1.zone, 'bandstand');
    assert.equal(p1.role, 'muse');
    assert.ok(Number.isInteger(p1.updated_at));

    const leaveRes = await client.leave();
    assert.equal(leaveRes.status, 200);

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.footlights.some((f) => f.handle === 'gatekeeper'), false);
    const p2 = s2.data.presence.find((p) => p.handle === 'gatekeeper');
    assert.ok(p2);
    assert.equal(p2.zone, 'bandstand');
  } finally {
    await ctx.close();
  }
});

test('say rate limit: six lines post, the seventh is rejected 429 rate_limited', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'chatter');
    for (let i = 0; i < 6; i++) {
      const res = await client.say(`line ${i}`);
      assert.equal(res.status, 201);
    }

    const seventh = await client.say('line 6');
    assert.equal(seventh.status, 429);
    assert.equal(seventh.data.error, 'rate_limited');
    assert.ok(Number.isInteger(seventh.data.retry_after) && seventh.data.retry_after > 0);
  } finally {
    await ctx.close();
  }
});

test('plot rate limit: ten PUTs succeed, the eleventh is rejected 429 rate_limited', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'plotter');
    for (let i = 0; i < 10; i++) {
      const res = await client.plot(VALID_MANIFEST, DESK_NOTE_HTML);
      assert.equal(res.status, 200);
    }

    const eleventh = await client.plot(VALID_MANIFEST, DESK_NOTE_HTML);
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.data.error, 'rate_limited');
    assert.ok(Number.isInteger(eleventh.data.retry_after) && eleventh.data.retry_after > 0);
  } finally {
    await ctx.close();
  }
});

test('footlight expires after the 45-minute TTL and the slot frees for re-checkin', async () => {
  const ctx = await startClockTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      ...keys,
    });
    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'gatekeeper',
    });
    assert.equal(approveRes.status, 200);

    const c1 = await client.checkin({ status_text: 'First watch' });
    assert.equal(c1.status, 200);
    assert.equal(c1.data.slot, 0);

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.footlights.length, 1);
    const seq1 = s1.data.state_seq;

    ctx.advanceClock(45 * 60 + 1);

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.footlights.length, 0);
    assert.equal(s2.data.state_seq, seq1);

    const c2 = await signedCheckinAtServerTime(ctx, 'gatekeeper', keys.privateKeyPem, 'Back again');
    assert.equal(c2.status, 200);
    assert.equal(c2.data.slot, 0);
    assert.equal(c2.data.expires_at, ctx.nowSec() + 45 * 60);
  } finally {
    await ctx.close();
  }
});

test('fresh server state pins nightly_call, plots, inn, guestbook and events shapes', async () => {
  const ctx = await startClockTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');
    const s = await client.state();
    assert.equal(s.status, 200);

    assert.ok(Number.isInteger(s.data.state_seq));
    assert.deepEqual(s.data.footlights, []);
    assert.deepEqual(s.data.prompt_book, []);
    assert.deepEqual(s.data.presence, []);
    assert.deepEqual(s.data.plots, {});
    assert.deepEqual(s.data.inn, { lantern: null, window: null, quiet: null });
    assert.deepEqual(s.data.guestbook, { signed: 0, letters: 0 });
    assert.deepEqual(s.data.guestbook_by_plot, {});
    assert.deepEqual(s.data.events, { now: null, next: null });
    assert.deepEqual(s.data.garden, { slots: [] });

    const nowSec = ctx.nowSec();
    const expectedDate = new Date(nowSec * 1000).toISOString().slice(0, 10);
    assert.equal(s.data.nightly_call.date, expectedDate);

    const topicsPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'nightly-topics.json');
    const topics = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
    const midnightMs = Date.UTC(
      Number(expectedDate.slice(0, 4)),
      Number(expectedDate.slice(5, 7)) - 1,
      Number(expectedDate.slice(8, 10))
    );
    const dayNumber = Math.floor(midnightMs / 86400000);
    const idx = ((dayNumber % 30) + 30) % 30;
    assert.equal(s.data.nightly_call.topic, topics[idx]);

    const gamesPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'daily-games.json');
    const games = JSON.parse(fs.readFileSync(gamesPath, 'utf8'));
    assert.equal(s.data.daily_game.date, expectedDate);
    assert.equal(s.data.daily_game.format, games[idx].format);
    assert.equal(s.data.daily_game.prompt, games[idx].prompt);
  } finally {
    await ctx.close();
  }
});

async function signedSayAtServerTime(ctx, handle, privateKeyPem, body, kind = 'say') {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: '/api/town/ghostlight/say',
    body: { body, kind },
    handle,
    privateKeyPem,
    timestamp: ctx.nowSec(),
  });
  const res = await fetch(`${ctx.baseUrl}/api/town/ghostlight/say`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('G1: join, checkin, say, and leave responses return exact sorted key sets', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      ...keys,
    });

    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    assert.deepEqual(Object.keys(joinRes.data).sort(), ['handle', 'origin', 'state_seq', 'status']);

    const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'gatekeeper',
    });
    assert.equal(approveRes.status, 200);

    const checkinRes = await client.checkin({ status_text: 'hi' });
    assert.equal(checkinRes.status, 200);
    assert.deepEqual(Object.keys(checkinRes.data).sort(), [
      'expires_at',
      'handle',
      'lit_at',
      'slot',
      'state_seq',
      'status_text',
    ]);
    assert.equal(checkinRes.data.lit_at + 2700, checkinRes.data.expires_at);

    const sayRes = await client.say('hello');
    assert.equal(sayRes.status, 201);
    assert.deepEqual(Object.keys(sayRes.data).sort(), [
      'body',
      'created_at',
      'handle',
      'id',
      'kind',
      'reply_to',
      'state_seq',
    ]);
    assert.equal(sayRes.data.reply_to, null);

    const leaveRes = await client.leave();
    assert.equal(leaveRes.status, 200);
    assert.deepEqual(Object.keys(leaveRes.data).sort(), ['extinguished', 'handle', 'state_seq']);
  } finally {
    await ctx.close();
  }
});

test('G2: plot PUT and GET responses return exact sorted key sets and matching timestamps', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');

    const putRes = await client.plot(VALID_MANIFEST, DESK_NOTE_HTML);
    assert.equal(putRes.status, 200);
    assert.deepEqual(Object.keys(putRes.data).sort(), ['handle', 'plot_updated_at', 'state_seq']);

    const getRes = await client.getPlot('gatekeeper');
    assert.equal(getRes.status, 200);
    assert.deepEqual(Object.keys(getRes.data).sort(), [
      'handle',
      'html',
      'manifest',
      'plot_updated_at',
    ]);
    assert.equal(getRes.data.plot_updated_at, putRes.data.plot_updated_at);
  } finally {
    await ctx.close();
  }
});

test('G3: full journey steps state_seq by exactly +1 per mutation', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      ...keys,
    });

    const s0 = await client.state();
    assert.equal(s0.status, 200);
    const seq0 = s0.data.state_seq;

    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    assert.equal(joinRes.data.state_seq, seq0 + 1);

    const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'gatekeeper',
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.state_seq, seq0 + 2);

    const checkinRes = await client.checkin({ status_text: 'stepping' });
    assert.equal(checkinRes.status, 200);
    assert.equal(checkinRes.data.state_seq, seq0 + 3);

    const sayRes = await client.say('step four');
    assert.equal(sayRes.status, 201);
    assert.equal(sayRes.data.state_seq, seq0 + 4);

    const plotRes = await client.plot(VALID_MANIFEST, DESK_NOTE_HTML);
    assert.equal(plotRes.status, 200);
    assert.equal(plotRes.data.state_seq, seq0 + 5);

    const leaveRes = await client.leave();
    assert.equal(leaveRes.status, 200);
    assert.equal(leaveRes.data.state_seq, seq0 + 6);

    const sFinal = await client.state();
    assert.equal(sFinal.status, 200);
    assert.equal(sFinal.data.state_seq, seq0 + 6);
  } finally {
    await ctx.close();
  }
});

test('G4: fresh server state returns exact 13 top-level keys and matching UTC date on nightly_call and daily_game', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');
    const s = await client.state();
    assert.equal(s.status, 200);
    assert.deepEqual(Object.keys(s.data).sort(), [
      'daily_game',
      'events',
      'footlights',
      'garden',
      'guestbook',
      'guestbook_by_plot',
      'guestbook_pending',
      'inn',
      'nightly_call',
      'plots',
      'presence',
      'prompt_book',
      'state_seq',
    ]);

    const todayUtc = new Date().toISOString().slice(0, 10);
    assert.equal(s.data.nightly_call.date, todayUtc);
    assert.equal(s.data.daily_game.date, s.data.nightly_call.date);
  } finally {
    await ctx.close();
  }
});

test('G5: state rows for footlight, prompt_book, and presence return exact sorted key sets', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');

    const checkinRes = await client.checkin({ status_text: 'At the bandstand.' });
    assert.equal(checkinRes.status, 200);
    const sayRes = await client.say('Evening check.');
    assert.equal(sayRes.status, 201);

    const s = await client.state();
    assert.equal(s.status, 200);

    assert.equal(s.data.footlights.length, 1);
    assert.deepEqual(Object.keys(s.data.footlights[0]).sort(), [
      'expires_at',
      'handle',
      'lit_at',
      'role',
      'slot',
      'status_text',
    ]);
    assert.equal(s.data.footlights[0].role, 'muse');

    assert.equal(s.data.prompt_book.length, 1);
    assert.deepEqual(Object.keys(s.data.prompt_book[0]).sort(), [
      'body',
      'created_at',
      'handle',
      'id',
      'kind',
      'reply_to',
      'role',
    ]);

    assert.equal(s.data.presence.length, 1);
    assert.deepEqual(Object.keys(s.data.presence[0]).sort(), [
      'handle',
      'role',
      'updated_at',
      'zone',
    ]);
  } finally {
    await ctx.close();
  }
});

test('G6: immediate re-checkin within 60 s window returns 429 rate_limited with exact retry_after 60', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');

    const c1 = await client.checkin({ status_text: 'first' });
    assert.equal(c1.status, 200);

    const c2 = await client.checkin({ status_text: 'second' });
    assert.equal(c2.status, 429);
    assert.equal(c2.data.error, 'rate_limited');
    assert.equal(c2.data.retry_after, 60);

    const s = await client.state();
    assert.equal(s.status, 200);
    const fl = s.data.footlights.find((f) => f.handle === 'gatekeeper');
    assert.ok(fl);
    assert.equal(fl.status_text, 'first');
  } finally {
    await ctx.close();
  }
});

test('G7: say refreshes a lit footlight TTL while say by an unlit resident lights no footlight', async () => {
  const ctx = await startClockTestServer();
  try {
    const gatekeeper = await createApprovedClient(ctx, 'gatekeeper');
    const quietone = await createApprovedClient(ctx, 'quietone');

    const c1 = await gatekeeper.checkin({ status_text: 'watch' });
    assert.equal(c1.status, 200);
    const exp1 = c1.data.expires_at;

    ctx.advanceClock(1000);

    const say1 = await signedSayAtServerTime(ctx, 'gatekeeper', gatekeeper.privateKeyPem, 'keeping watch');
    assert.equal(say1.status, 201);

    const s1 = await gatekeeper.state();
    assert.equal(s1.status, 200);
    const fl = s1.data.footlights.find((f) => f.handle === 'gatekeeper');
    assert.ok(fl);
    assert.equal(fl.expires_at, ctx.nowSec() + 2700);
    assert.ok(fl.expires_at > exp1);

    const say2 = await signedSayAtServerTime(ctx, 'quietone', quietone.privateKeyPem, 'hello from the gate');
    assert.equal(say2.status, 201);

    const s2 = await quietone.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.footlights.some((f) => f.handle === 'quietone'), false);
  } finally {
    await ctx.close();
  }
});

test('G8: presence endpoint accepts gate and plot zones with exact keys and rejects invalid zone', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');

    const pGate = await client.presence('gate');
    assert.equal(pGate.status, 200);
    assert.deepEqual(Object.keys(pGate.data).sort(), [
      'handle',
      'state_seq',
      'updated_at',
      'zone',
    ]);
    assert.equal(pGate.data.zone, 'gate');

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    const row = s1.data.presence.find((p) => p.handle === 'gatekeeper');
    assert.ok(row);
    assert.equal(row.zone, 'gate');

    const pBad = await client.presence('roof');
    assert.equal(pBad.status, 400);
    assert.equal(pBad.data.error, 'invalid_zone');

    const pPlot = await client.presence('plot:wick');
    assert.equal(pPlot.status, 200);
    assert.equal(pPlot.data.zone, 'plot:wick');
  } finally {
    await ctx.close();
  }
});

test('G9: plot PUT auth edges reject unknown and suspended residents while muted resident can plot but not say', async () => {
  const ctx = await startTestServer();
  try {
    const ghost = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'ghost',
      ...generateKeypair(),
    });
    const ghostRes = await ghost.plot(VALID_MANIFEST, DESK_NOTE_HTML);
    assert.equal(ghostRes.status, 401);
    assert.equal(ghostRes.data.error, 'unknown_resident');

    const suspended = await createApprovedClient(ctx, 'suspended-one');
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('suspended-one');
    const suspRes = await suspended.plot(VALID_MANIFEST, DESK_NOTE_HTML);
    assert.equal(suspRes.status, 403);
    assert.equal(suspRes.data.error, 'resident_not_active');
    assert.equal(suspRes.data.resident_status, 'suspended');

    const muted = await createApprovedClient(ctx, 'muted-one');
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = ?").run('muted-one');
    const mutedPlot = await muted.plot(VALID_MANIFEST, DESK_NOTE_HTML);
    assert.equal(mutedPlot.status, 200);

    const mutedSay = await muted.say('trying to speak');
    assert.equal(mutedSay.status, 403);
    assert.equal(mutedSay.data.error, 'resident_muted');
  } finally {
    await ctx.close();
  }
});

test('G10: all 10 bandstand avatarSpots are distinct and non-origin, and slot 9 places an avatar at spots[9]', async () => {
  const THREE = createThreeStub();
  const town = buildTown(THREE);
  const spots = town.parts.avatarSpots;
  assert.equal(spots.length, 10);

  const uniqueCoords = new Set(spots.map((s) => `${s.x},${s.y},${s.z}`));
  assert.equal(uniqueCoords.size, 10);
  for (const spot of spots) {
    assert.ok(spot.x !== 0 || spot.y !== 0 || spot.z !== 0);
  }

  const ctx = await startTestServer();
  try {
    const slotnine = await createApprovedClient(ctx, 'slotnine');
    const c = await slotnine.checkin({ slot: 9, status_text: 'nine' });
    assert.equal(c.status, 200);
    assert.equal(c.data.slot, 9);

    const s = await slotnine.state();
    assert.equal(s.status, 200);
    const live = applyState(town, s.data);
    const avatar = live.avatars.get('slotnine');
    assert.ok(avatar);
    assert.equal(avatar.position.x, spots[9].x);
    assert.equal(avatar.position.y, spots[9].y);
    assert.equal(avatar.position.z, spots[9].z);
  } finally {
    await ctx.close();
  }
});

async function signedJoinRaw(ctx, handle, keys, extraBody = {}) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: '/api/town/join',
    body: { handle, pubkey: keys.pubkey, origin: 'musebook', bio: '', ...extraBody },
    handle,
    privateKeyPem: keys.privateKeyPem,
  });
  const res = await fetch(`${ctx.baseUrl}/api/town/join`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('G11: admin approve with role npc flows through footlight presence and Prompt Book', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'npc-one',
      ...keys,
    });

    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);

    const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'npc-one',
      role: 'npc',
    });
    assert.equal(approveRes.status, 200);
    assert.deepEqual(Object.keys(approveRes.data).sort(), ['handle', 'role', 'state_seq', 'status']);
    assert.equal(approveRes.data.role, 'npc');
    assert.equal(approveRes.data.status, 'active');

    const checkinRes = await client.checkin({ status_text: 'npc watch' });
    assert.equal(checkinRes.status, 200);

    const sayRes = await client.say('npc line');
    assert.equal(sayRes.status, 201);

    const s = await client.state();
    assert.equal(s.status, 200);

    const fl = s.data.footlights.find((f) => f.handle === 'npc-one');
    assert.ok(fl);
    assert.equal(fl.role, 'npc');

    const pr = s.data.presence.find((p) => p.handle === 'npc-one');
    assert.ok(pr);
    assert.equal(pr.role, 'npc');
    assert.equal(pr.zone, 'bandstand');

    const pb = s.data.prompt_book.find((e) => e.handle === 'npc-one');
    assert.ok(pb);
    assert.equal(pb.role, 'npc');
  } finally {
    await ctx.close();
  }
});

test('G12: Prompt Book keeps last 100 lines past 24h and prunes rows older than 7 days', async () => {
  const ctx = await startClockTestServer();
  try {
    const insert = ctx.db.prepare(
      "INSERT INTO residents (handle, pubkey, origin, status, role, bio, plot_updated_at, created_at) VALUES (?, ?, 'musebook', 'active', 'muse', '', NULL, ?)"
    );
    const now = ctx.nowSec();
    const clients = [];
    for (let i = 0; i < 17; i += 1) {
      const handle = `chatter${i}`;
      const keys = generateKeypair();
      insert.run(handle, keys.pubkey, now);
      clients.push(new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys }));
    }

    let lineNum = 0;
    for (const client of clients) {
      for (let j = 0; j < 6; j += 1) {
        const r = await signedSayAtServerTime(ctx, client.handle, client.privateKeyPem, `line ${lineNum}`);
        assert.equal(r.status, 201);
        lineNum += 1;
      }
    }

    const sBefore = await clients[0].state();
    assert.equal(sBefore.status, 200);
    assert.equal(sBefore.data.prompt_book.length, 102);
    assert.equal(sBefore.data.prompt_book[0].id, 1);

    ctx.advanceClock(25 * 3600);

    const sAfter = await clients[0].state();
    assert.equal(sAfter.status, 200);
    assert.equal(sAfter.data.prompt_book.length, 100);
    assert.equal(sAfter.data.prompt_book[0].id, 3);
    assert.equal(sAfter.data.prompt_book[0].body, 'line 2');
    assert.equal(sAfter.data.prompt_book[99].body, 'line 101');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM prompt_book').get().c, 102);
  } finally {
    await ctx.close();
  }

  const ctx2 = await startClockTestServer();
  try {
    const client = await createApprovedClient(ctx2, 'gatekeeper');
    const r = await signedSayAtServerTime(ctx2, 'gatekeeper', client.privateKeyPem, 'old line');
    assert.equal(r.status, 201);

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.prompt_book.length, 1);

    ctx2.advanceClock(8 * 86400 + 1);

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.prompt_book.length, 0);
    assert.equal(ctx2.db.prepare('SELECT COUNT(*) AS c FROM prompt_book').get().c, 0);
  } finally {
    await ctx2.close();
  }
});

test('G13: checkin status_text of exactly 120 chars succeeds and echoes verbatim', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');
    const text120 = 'x'.repeat(120);

    const c = await client.checkin({ status_text: text120 });
    assert.equal(c.status, 200);
    assert.equal(c.data.status_text.length, 120);
    assert.equal(c.data.status_text, text120);

    const s = await client.state();
    assert.equal(s.status, 200);
    const fl = s.data.footlights.find((f) => f.handle === 'gatekeeper');
    assert.ok(fl);
    assert.equal(fl.status_text.length, 120);
  } finally {
    await ctx.close();
  }
});

test('G14: cross-resident reply_to links and non-integer reply_to is rejected', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await createApprovedClient(ctx, 'alice');
    const bob = await createApprovedClient(ctx, 'bob');

    const r1 = await alice.say('first line');
    assert.equal(r1.status, 201);
    const firstId = r1.data.id;
    assert.ok(Number.isInteger(firstId));

    const r2 = await bob.say('replying across', 'say', firstId);
    assert.equal(r2.status, 201);
    assert.equal(r2.data.reply_to, firstId);

    const s = await alice.state();
    assert.equal(s.status, 200);
    const entry = s.data.prompt_book.find((e) => e.id === r2.data.id);
    assert.ok(entry);
    assert.equal(entry.reply_to, firstId);
    assert.equal(entry.handle, 'bob');

    const badStr = await bob.say('string reply', 'say', '1');
    assert.equal(badStr.status, 400);
    assert.equal(badStr.data.error, 'invalid_reply_to');

    const badFloat = await bob.say('float reply', 'say', 1.5);
    assert.equal(badFloat.status, 400);
    assert.equal(badFloat.data.error, 'invalid_reply_to');
  } finally {
    await ctx.close();
  }
});

test('G15: plot PUT returns named validation errors for manifest and HTML', async () => {
  const ctx = await startTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');

    const badCottage = await client.plot({ ...VALID_MANIFEST, cottage: 'igloo' }, DESK_NOTE_HTML);
    assert.equal(badCottage.status, 400);
    assert.equal(badCottage.data.error, 'invalid_cottage');

    const badColor = await client.plot({ ...VALID_MANIFEST, wall: '#zzz' }, DESK_NOTE_HTML);
    assert.equal(badColor.status, 400);
    assert.equal(badColor.data.error, 'invalid_color');
    assert.equal(badColor.data.field, 'wall');

    const tooManyProps = await client.plot(
      {
        ...VALID_MANIFEST,
        props: Array.from({ length: 13 }, (_, i) => ({ kind: 'cat', x: 0, y: 0, z: 0, rot_y: i })),
      },
      DESK_NOTE_HTML
    );
    assert.equal(tooManyProps.status, 400);
    assert.equal(tooManyProps.data.error, 'too_many_props');
    assert.equal(tooManyProps.data.max, 12);

    const longSignpost = await client.plot(
      { ...VALID_MANIFEST, signpost_text: 's'.repeat(121) },
      DESK_NOTE_HTML
    );
    assert.equal(longSignpost.status, 400);
    assert.equal(longSignpost.data.error, 'invalid_signpost_text');
    assert.equal(longSignpost.data.max, 120);

    const badPropKind = await client.plot(
      { ...VALID_MANIFEST, props: [{ kind: 'rocket', x: 0, y: 0, z: 0, rot_y: 0 }] },
      DESK_NOTE_HTML
    );
    assert.equal(badPropKind.status, 400);
    assert.equal(badPropKind.data.error, 'invalid_prop_kind');
    assert.equal(badPropKind.data.index, 0);

    const scriptHtml = await client.plot(
      VALID_MANIFEST,
      DESK_NOTE_HTML.replace('</body>', '<script>alert(1)</script></body>')
    );
    assert.equal(scriptHtml.status, 400);
    assert.equal(scriptHtml.data.error, 'unsafe_html');
    assert.equal(scriptHtml.data.reason, 'forbidden_tag:script');
  } finally {
    await ctx.close();
  }
});

test('G16: state since edges return 304 only on exact seq match', async () => {
  const ctx = await startTestServer();
  try {
    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'gatekeeper',
      ...generateKeypair(),
    });

    const s0 = await client.state();
    assert.equal(s0.status, 200);
    assert.equal(s0.data.state_seq, 0);

    const s0Match = await client.state(0);
    assert.equal(s0Match.status, 304);
    assert.equal(s0Match.data, null);

    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    assert.equal(joinRes.data.state_seq, 1);

    const sBehind = await client.state(0);
    assert.equal(sBehind.status, 200);
    assert.equal(sBehind.data.state_seq, 1);

    const sFuture = await client.state(1001);
    assert.equal(sFuture.status, 200);
    assert.equal(sFuture.data.state_seq, 1);

    const s1Match = await client.state(1);
    assert.equal(s1Match.status, 304);
    assert.equal(s1Match.data, null);

    const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'gatekeeper',
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.state_seq, 2);

    const sAfterApprove = await client.state(1);
    assert.equal(sAfterApprove.status, 200);
    assert.equal(sAfterApprove.data.state_seq, 2);
  } finally {
    await ctx.close();
  }
});

test('G17: Prompt Book lines order by id across two residents', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await createApprovedClient(ctx, 'alice');
    const bob = await createApprovedClient(ctx, 'bob');

    assert.equal((await alice.say('one')).status, 201);
    assert.equal((await bob.say('two')).status, 201);
    assert.equal((await alice.say('three')).status, 201);

    const s = await alice.state();
    assert.equal(s.status, 200);
    assert.deepEqual(s.data.prompt_book.map((e) => e.body), ['one', 'two', 'three']);
    assert.deepEqual(s.data.prompt_book.map((e) => e.handle), ['alice', 'bob', 'alice']);
    const ids = s.data.prompt_book.map((e) => e.id);
    assert.ok(ids[0] < ids[1] && ids[1] < ids[2]);
  } finally {
    await ctx.close();
  }
});

test('G18: presence upserts to one row and updated_at advances with the clock', async () => {
  const ctx = await startClockTestServer();
  try {
    const client = await createApprovedClient(ctx, 'gatekeeper');

    const p1 = await client.presence('gate');
    assert.equal(p1.status, 200);
    assert.deepEqual(Object.keys(p1.data).sort(), ['handle', 'state_seq', 'updated_at', 'zone']);
    assert.equal(p1.data.zone, 'gate');

    const p2 = await client.presence('plot:wick');
    assert.equal(p2.status, 200);

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    const rows1 = s1.data.presence.filter((p) => p.handle === 'gatekeeper');
    assert.equal(rows1.length, 1);
    assert.equal(rows1[0].zone, 'plot:wick');
    const t1 = rows1[0].updated_at;

    ctx.advanceClock(60);

    const p3 = await client.presence('bandstand');
    assert.equal(p3.status, 200);
    assert.equal(p3.data.updated_at, ctx.nowSec());

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    const rows2 = s2.data.presence.filter((p) => p.handle === 'gatekeeper');
    assert.equal(rows2.length, 1);
    assert.equal(rows2[0].zone, 'bandstand');
    assert.ok(rows2[0].updated_at > t1);
  } finally {
    await ctx.close();
  }
});

test('G19: join ignores role in body and approve role edges', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const joinRes = await signedJoinRaw(ctx, 'role-tester', keys, { role: 'npc' });
    assert.equal(joinRes.status, 201);
    assert.deepEqual(Object.keys(joinRes.data).sort(), ['handle', 'origin', 'state_seq', 'status']);

    const badApprove = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'role-tester',
      role: 'admin',
    });
    assert.equal(badApprove.status, 400);
    assert.equal(badApprove.data.error, 'invalid_role');

    const defaultApprove = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'role-tester',
    });
    assert.equal(defaultApprove.status, 200);
    assert.deepEqual(Object.keys(defaultApprove.data).sort(), ['handle', 'role', 'state_seq', 'status']);
    assert.equal(defaultApprove.data.role, 'muse');

    const client = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'role-tester',
      ...keys,
    });
    const checkinRes = await client.checkin({ status_text: 'role check' });
    assert.equal(checkinRes.status, 200);

    const s = await client.state();
    assert.equal(s.status, 200);
    const fl = s.data.footlights.find((f) => f.handle === 'role-tester');
    assert.ok(fl);
    assert.equal(fl.role, 'muse');

    const museApprove = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'role-tester',
      role: 'muse',
    });
    assert.equal(museApprove.status, 200);
    assert.equal(museApprove.data.role, 'muse');
  } finally {
    await ctx.close();
  }
});

test('G20: file hygiene 48 unique names 8 imports pinned as-true counts', () => {
  const src = fs.readFileSync(new URL(import.meta.url).pathname, 'utf8');
  const lines = src.split('\n');

  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 48);
  assert.equal(new Set(names).size, 48);

  const imports = lines.filter((l) => l.startsWith('import '));
  assert.deepEqual(imports, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { createTownServer } from './server.mjs';",
    "import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';",
    "import { buildTown, applyState } from '../town-3d/town.js';",
  ]);

  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 4);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 2);
  assert.equal(lines.filter((l) => l.includes('Math' + '.random')).length, 0);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.toLowerCase().includes('camp' + 'fire')).length, 0);
});
