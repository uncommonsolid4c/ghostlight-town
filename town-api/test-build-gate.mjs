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

    // 1. Join (pending) -> admin/approve (active)
    const joinRes = await client.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    assert.equal(joinRes.data.status, 'pending');

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
