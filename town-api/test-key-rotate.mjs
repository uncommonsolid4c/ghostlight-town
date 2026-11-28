import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-key-rotate-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const nowFn = () => Math.floor(Date.now() / 1000) + clockOffset;

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

async function createResident(ctx, handle, { approved = true } = {}) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joinRes = await client.join({ origin: 'musebook' });
  assert.equal(joinRes.status, 201);
  if (approved) {
    const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle });
    assert.equal(appRes.status, 200);
  } else {
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run(handle);
  }
  return { client, keys };
}

test('key rotate succeeds, invalidates old key, activates new key, updates key_history, and hides key material', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient, keys: oldKeys } = await createResident(ctx, 'alice');
    const newKeys = generateKeypair();

    const seqBefore = (await oldClient.state()).data.state_seq;
    const historyBefore = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(historyBefore.length, 0);

    const rotRes = await oldClient.rotateKey(newKeys.pubkey);
    assert.equal(rotRes.status, 200);
    assert.equal(rotRes.data.handle, 'alice');
    assert.equal(rotRes.data.rotated, true);
    assert.ok(rotRes.data.state_seq > seqBefore, 'rotate must bump state_seq');

    const rotJson = JSON.stringify(rotRes.data);
    assert.equal(rotJson.includes(oldKeys.pubkey), false, 'rotate response must not include old pubkey');
    assert.equal(rotJson.includes(newKeys.pubkey), false, 'rotate response must not include new pubkey');

    // Old key must stop working immediately
    const oldCheckin = await oldClient.checkin('still using old key');
    assert.equal(oldCheckin.status, 401);

    // New key must work immediately
    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const newCheckin = await newClient.checkin('rotated and lit');
    assert.equal(newCheckin.status, 200);
    assert.equal(newCheckin.data.handle, 'alice');

    // key_history gains exactly one rotate row for alice with the new pubkey
    const historyAfter = ctx.db
      .prepare("SELECT handle, pubkey, action, note FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(historyAfter.length, 1);
    assert.equal(historyAfter[0].pubkey, newKeys.pubkey);
    assert.equal(historyAfter[0].action, 'rotate');
    assert.equal(historyAfter[0].note, 'self-service rotation');
  } finally {
    await ctx.close();
  }
});

test('key rotate validation and auth errors', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');

    // Same pubkey -> 400 same_pubkey
    const sameRes = await alice.rotateKey(aliceKeys.pubkey);
    assert.equal(sameRes.status, 400);
    assert.equal(sameRes.data.error, 'same_pubkey');

    // Garbage pubkey -> 400 invalid_pubkey
    const badRes = await alice.rotateKey('not-a-valid-ed25519-key');
    assert.equal(badRes.status, 400);
    assert.equal(badRes.data.error, 'invalid_pubkey');

    // Missing pubkey -> 400 missing_pubkey
    const missingRes = await alice._signedPost('/api/town/key/rotate', {});
    assert.equal(missingRes.status, 400);
    assert.equal(missingRes.data.error, 'missing_pubkey');

    // Unsigned request -> 401
    const unsignedRes = await fetch(`${ctx.baseUrl}/api/town/key/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: generateKeypair().pubkey }),
    });
    assert.equal(unsignedRes.status, 401);

    // Unknown handle -> 401
    const ghostKeys = generateKeypair();
    const ghostClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'nobody_here', ...ghostKeys });
    const unknownRes = await ghostClient.rotateKey(generateKeypair().pubkey);
    assert.equal(unknownRes.status, 401);
  } finally {
    await ctx.close();
  }
});

test('key rotate rate limit: 3 rotates per hour allowed, 4th returns 429', async () => {
  const ctx = await startTestServer();
  try {
    let { client } = await createResident(ctx, 'alice');

    for (let i = 0; i < 3; i++) {
      const nextKeys = generateKeypair();
      const res = await client.rotateKey(nextKeys.pubkey);
      assert.equal(res.status, 200, `rotate #${i + 1} should succeed`);
      const bodyStr = JSON.stringify(res.data);
      assert.equal(bodyStr.includes(nextKeys.pubkey), false, 'no key material in rotate response');
      client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }

    // 4th rotate within the same hour -> 429
    const fourthKeys = generateKeypair();
    const fourthRes = await client.rotateKey(fourthKeys.pubkey);
    assert.equal(fourthRes.status, 429);
    assert.equal(fourthRes.data.error, 'rate_limited');
    assert.ok(Number.isInteger(fourthRes.data.retry_after) && fourthRes.data.retry_after > 0);
  } finally {
    await ctx.close();
  }
});

test('key rotate rate-limit window resets after 3600s', async () => {
  const ctx = await startTestServer();
  try {
    let { client, keys: currentKeys } = await createResident(ctx, 'alice');

    for (let i = 0; i < 3; i++) {
      const nextKeys = generateKeypair();
      const res = await client.rotateKey(nextKeys.pubkey);
      assert.equal(res.status, 200);
      currentKeys = nextKeys;
      client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }

    const blocked = await client.rotateKey(generateKeypair().pubkey);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.error, 'rate_limited');

    ctx.advanceClock(3601);

    const afterResetKeys = generateKeypair();
    const rotSigned = signRequest({
      method: 'POST',
      path: '/api/town/key/rotate',
      body: { pubkey: afterResetKeys.pubkey },
      handle: 'alice',
      privateKeyPem: currentKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const afterResetRes = await fetch(`${ctx.baseUrl}/api/town/key/rotate`, {
      method: 'POST',
      headers: rotSigned.headers,
      body: rotSigned.rawBody,
    });
    const afterResetData = await afterResetRes.json();
    assert.equal(afterResetRes.status, 200);
    assert.equal(afterResetData.rotated, true);

    const checkinSigned = signRequest({
      method: 'POST',
      path: '/api/town/ghostlight/checkin',
      body: { status_text: 'post-reset key' },
      handle: 'alice',
      privateKeyPem: afterResetKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const checkinRes = await fetch(`${ctx.baseUrl}/api/town/ghostlight/checkin`, {
      method: 'POST',
      headers: checkinSigned.headers,
      body: checkinSigned.rawBody,
    });
    assert.equal(checkinRes.status, 200);
  } finally {
    await ctx.close();
  }
});

test('failed key rotates do not consume rate-limit budget', async () => {
  const ctx = await startTestServer();
  try {
    let { client, keys: currentKeys } = await createResident(ctx, 'alice');

    // Several validation failures before any valid rotate
    const missingRes = await client._signedPost('/api/town/key/rotate', {});
    assert.equal(missingRes.status, 400);
    assert.equal(missingRes.data.error, 'missing_pubkey');

    const invalidRes = await client.rotateKey('bad-key');
    assert.equal(invalidRes.status, 400);
    assert.equal(invalidRes.data.error, 'invalid_pubkey');

    const sameRes1 = await client.rotateKey(currentKeys.pubkey);
    assert.equal(sameRes1.status, 400);
    assert.equal(sameRes1.data.error, 'same_pubkey');

    const sameRes2 = await client.rotateKey(currentKeys.pubkey);
    assert.equal(sameRes2.status, 400);
    assert.equal(sameRes2.data.error, 'same_pubkey');

    // All 3 valid rotates in the hourly window must still succeed
    for (let i = 0; i < 3; i++) {
      const nextKeys = generateKeypair();
      const res = await client.rotateKey(nextKeys.pubkey);
      assert.equal(res.status, 200, `valid rotate #${i + 1} should succeed after failed attempts`);
      client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }

    const fourth = await client.rotateKey(generateKeypair().pubkey);
    assert.equal(fourth.status, 429);
    assert.equal(fourth.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('key rotate rate limit is per-handle', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    for (let i = 0; i < 3; i++) {
      const nextKeys = generateKeypair();
      const res = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(res.status, 200);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }

    const aliceBlocked = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(aliceBlocked.status, 429);
    assert.equal(aliceBlocked.data.error, 'rate_limited');

    const bobNextKeys = generateKeypair();
    const bobRes = await bob.rotateKey(bobNextKeys.pubkey);
    assert.equal(bobRes.status, 200);
    assert.equal(bobRes.data.handle, 'bob');
    assert.equal(bobRes.data.rotated, true);

    const bobNewClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...bobNextKeys });
    const bobCheckin = await bobNewClient.checkin('bob rotated');
    assert.equal(bobCheckin.status, 200);
  } finally {
    await ctx.close();
  }
});

test('key rotate preserves resident footlight, allows say with new key, rejects old key, and increments state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');

    const checkinRes = await oldClient.checkin('lit before rotate');
    assert.equal(checkinRes.status, 200);
    const slot = checkinRes.data.slot;
    const seqAfterCheckin = checkinRes.data.state_seq;

    const newKeys = generateKeypair();
    const rotRes = await oldClient.rotateKey(newKeys.pubkey);
    assert.equal(rotRes.status, 200);
    assert.ok(rotRes.data.state_seq > seqAfterCheckin, 'rotate state_seq must exceed checkin state_seq');

    const stateAfterRotate = await oldClient.state();
    assert.equal(stateAfterRotate.status, 200);
    const litEntry = stateAfterRotate.data.footlights.find((f) => f.handle === 'alice');
    assert.ok(litEntry, 'alice footlight must remain lit after rotate');
    assert.equal(litEntry.slot, slot, 'alice footlight must keep the same slot');

    // Old key cannot say
    const oldSay = await oldClient.say('from old key');
    assert.equal(oldSay.status, 401);

    // New key can say and state_seq keeps strictly increasing
    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const newSay = await newClient.say('still on stage');
    assert.equal(newSay.status, 201);
    assert.ok(newSay.data.state_seq > rotRes.data.state_seq, 'say state_seq must exceed rotate state_seq');

    const stateAfterSay = await newClient.state();
    const line = stateAfterSay.data.prompt_book.find((p) => p.handle === 'alice' && p.body === 'still on stage');
    assert.ok(line, 'Prompt Book must contain say entry under alice');
  } finally {
    await ctx.close();
  }
});

test('key_history accumulates rotate rows in order and residents.pubkey matches latest', async () => {
  const ctx = await startTestServer();
  try {
    const { client: c0 } = await createResident(ctx, 'alice');
    const keys1 = generateKeypair();
    const keys2 = generateKeypair();

    const r1 = await c0.rotateKey(keys1.pubkey);
    assert.equal(r1.status, 200);

    const c1 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keys1 });
    const r2 = await c1.rotateKey(keys2.pubkey);
    assert.equal(r2.status, 200);

    const history = ctx.db
      .prepare("SELECT handle, pubkey, action, note FROM key_history WHERE handle = ? AND action = 'rotate' ORDER BY id ASC")
      .all('alice');
    assert.equal(history.length, 2);
    assert.equal(history[0].pubkey, keys1.pubkey);
    assert.equal(history[0].action, 'rotate');
    assert.equal(history[0].note, 'self-service rotation');
    assert.equal(history[1].pubkey, keys2.pubkey);
    assert.equal(history[1].action, 'rotate');
    assert.equal(history[1].note, 'self-service rotation');

    const residentRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(residentRow.pubkey, keys2.pubkey);
  } finally {
    await ctx.close();
  }
});

test('key rotate auth edges: wrong signing key, unapproved resident, and non-string pubkeys', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const wrongKeys = generateKeypair();
    const wrongSigner = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...wrongKeys });

    // Signed with a different key than alice's current key -> 401 invalid_signature
    const wrongKeyRes = await wrongSigner.rotateKey(generateKeypair().pubkey);
    assert.equal(wrongKeyRes.status, 401);
    assert.equal(wrongKeyRes.data.error, 'invalid_signature');

    // Suspended resident -> 403 resident_not_active (resident_status: 'suspended')
    const { client: suspendedClient } = await createResident(ctx, 'suspended_muse', { approved: false });
    const suspendedRes = await suspendedClient.rotateKey(generateKeypair().pubkey);
    assert.equal(suspendedRes.status, 403);
    assert.equal(suspendedRes.data.error, 'resident_not_active');
    assert.equal(suspendedRes.data.resident_status, 'suspended');

    // Non-string pubkeys (number / null / array) -> 400 missing_pubkey
    for (const badPubkey of [12345, null, ['not-a-string']]) {
      const res = await alice._signedPost('/api/town/key/rotate', { pubkey: badPubkey });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'missing_pubkey');
    }
  } finally {
    await ctx.close();
  }
});

test('rotate to another resident pubkey returns 409 pubkey_taken and changes nothing', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob, keys: bobKeys } = await createResident(ctx, 'bob');

    const seqBefore = (await alice.state()).data.state_seq;

    const rotRes = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(rotRes.status, 409);
    assert.equal(rotRes.data.error, 'pubkey_taken');

    const aliceSay = await alice.say('still mine');
    assert.equal(aliceSay.status, 201);

    const bobSay = await bob.say('still bobs');
    assert.equal(bobSay.status, 201);

    const history = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(history.length, 0);

    const seqAfter = (await alice.state()).data.state_seq;
    assert.equal(seqAfter - seqBefore, 2);
  } finally {
    await ctx.close();
  }
});

test('409 pubkey_taken does not consume rate-limit budget', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const conflictRes = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.data.error, 'pubkey_taken');

    for (let i = 0; i < 3; i++) {
      const nextKeys = generateKeypair();
      const res = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(res.status, 200, `rotate #${i + 1} should succeed after 409`);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }

    const fourthRes = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(fourthRes.status, 429);
    assert.equal(fourthRes.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('rotate back to a previously used key succeeds', async () => {
  const ctx = await startTestServer();
  try {
    const { client: c0, keys: keysA } = await createResident(ctx, 'alice');
    const keysB = generateKeypair();

    const r1 = await c0.rotateKey(keysB.pubkey);
    assert.equal(r1.status, 200);

    const c1 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keysB });
    const r2 = await c1.rotateKey(keysA.pubkey);
    assert.equal(r2.status, 200);

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, keysA.pubkey);

    const history = ctx.db
      .prepare("SELECT pubkey FROM key_history WHERE handle = ? AND action = 'rotate' ORDER BY id ASC")
      .all('alice');
    assert.equal(history.length, 2);
    assert.equal(history[0].pubkey, keysB.pubkey);
    assert.equal(history[1].pubkey, keysA.pubkey);

    const cBack = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keysA });
    const sayRes = await cBack.say('home again');
    assert.equal(sayRes.status, 201);
  } finally {
    await ctx.close();
  }
});

test('rotate to a pubkey freed by another resident rotation succeeds', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob, keys: bobOld } = await createResident(ctx, 'bob');
    const bobNew = generateKeypair();

    const bobRot = await bob.rotateKey(bobNew.pubkey);
    assert.equal(bobRot.status, 200);

    const aliceRot = await alice.rotateKey(bobOld.pubkey);
    assert.equal(aliceRot.status, 200);

    const bobNewClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...bobNew });
    const bobSay = await bobNewClient.say('bob still bob');
    assert.equal(bobSay.status, 201);

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, bobOld.pubkey);
  } finally {
    await ctx.close();
  }
});

test('old key cannot sign a rotate after rotation', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');
    const keysB = generateKeypair();

    const r1 = await oldClient.rotateKey(keysB.pubkey);
    assert.equal(r1.status, 200);

    const r2 = await oldClient.rotateKey(generateKeypair().pubkey);
    assert.equal(r2.status, 401);
    assert.equal(r2.data.error, 'invalid_signature');

    const history = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('alice');
    assert.equal(history.length, 1);

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, keysB.pubkey);
  } finally {
    await ctx.close();
  }
});

test('rotate response has exactly handle, rotated, state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createResident(ctx, 'alice');
    const r = await client.rotateKey(generateKeypair().pubkey);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.data).sort(), ['handle', 'rotated', 'state_seq']);
    assert.equal(r.data.rotated, true);
    assert.equal(r.data.handle, 'alice');
    assert.ok(Number.isInteger(r.data.state_seq));
  } finally {
    await ctx.close();
  }
});

const KR235_MANIFEST = {
  cottage: 'gable',
  wall: '#d8c8a8',
  roof: '#5a3d2b',
  trim: '#2f4f4f',
  signpost_text: "Welcome to Alice's Desk",
  props: [{ kind: 'desk', x: 0, y: 0, z: -2, rot_y: 180, color: '#6b4c35' }],
};
const KR235_HTML = '<!doctype html><html><body><h1>Hi</h1><p>Quiet evening.</p></body></html>';

async function kr235SignedRotate(ctx, { pubkey, privateKeyPem, timestamp }) {
  const signed = signRequest({
    method: 'POST',
    path: '/api/town/key/rotate',
    body: { pubkey },
    handle: 'alice',
    privateKeyPem,
    timestamp,
  });
  const res = await fetch(`${ctx.baseUrl}/api/town/key/rotate`, {
    method: 'POST',
    headers: signed.headers,
    body: signed.rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, signed };
}

test('rotate preserves plot ownership', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');
    const plotRes = await oldClient.plot(KR235_MANIFEST, KR235_HTML);
    assert.equal(plotRes.status, 200);

    const newKeys = generateKeypair();
    const rotRes = await oldClient.rotateKey(newKeys.pubkey);
    assert.equal(rotRes.status, 200);

    const stateRes = await oldClient.state();
    assert.equal(stateRes.status, 200);
    assert.equal(typeof stateRes.data.plots.alice, 'number');

    const getRes = await oldClient.getPlot('alice');
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.manifest.cottage, 'gable');
    assert.equal(getRes.data.manifest.signpost_text, "Welcome to Alice's Desk");

    const oldPlotRes = await oldClient.plot({ ...KR235_MANIFEST, signpost_text: 'Old key try' }, KR235_HTML);
    assert.equal(oldPlotRes.status, 401);

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const newPlotRes = await newClient.plot({ ...KR235_MANIFEST, signpost_text: 'New key desk' }, KR235_HTML);
    assert.equal(newPlotRes.status, 200);

    const updatedPlot = await newClient.getPlot('alice');
    assert.equal(updatedPlot.status, 200);
    assert.equal(updatedPlot.data.manifest.signpost_text, 'New key desk');
  } finally {
    await ctx.close();
  }
});

test('rotate preserves an Inn claim', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');
    const claim = await oldClient.claimInnRoom('lantern', 2);
    assert.equal(claim.status, 201);
    assert.equal(typeof claim.data.key, 'string');
    const key = claim.data.key;

    const newKeys = generateKeypair();
    const rotRes = await oldClient.rotateKey(newKeys.pubkey);
    assert.equal(rotRes.status, 200);

    const stateRes = await oldClient.state();
    assert.equal(stateRes.status, 200);
    assert.equal(stateRes.data.inn.lantern.handle, 'alice');
    assert.equal(JSON.stringify(stateRes.data).includes(key), false);

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const extNew = await newClient.extendInnStay('lantern', key, 1);
    assert.equal(extNew.status, 200);
    assert.equal(extNew.data.nights, 3);

    const extOld = await oldClient.extendInnStay('lantern', key, 1);
    assert.equal(extOld.status, 401);

    const vacateRes = await newClient.vacateInnRoom('lantern', key);
    assert.equal(vacateRes.status, 200);

    const stateAfterVacate = await newClient.state();
    assert.equal(stateAfterVacate.data.inn.lantern, null);
  } finally {
    await ctx.close();
  }
});

test('rotate auth-time edges: stale timestamps and replayed nonce', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: oldKeys } = await createResident(ctx, 'alice');
    const newKeys = generateKeypair();

    const pastRes = await kr235SignedRotate(ctx, {
      pubkey: newKeys.pubkey,
      privateKeyPem: oldKeys.privateKeyPem,
      timestamp: ctx.nowSec() - 1000,
    });
    assert.equal(pastRes.status, 401);
    assert.equal(pastRes.data.error, 'stale_timestamp');

    const futureRes = await kr235SignedRotate(ctx, {
      pubkey: newKeys.pubkey,
      privateKeyPem: oldKeys.privateKeyPem,
      timestamp: ctx.nowSec() + 1000,
    });
    assert.equal(futureRes.status, 401);
    assert.equal(futureRes.data.error, 'stale_timestamp');

    const nonIntRes = await kr235SignedRotate(ctx, {
      pubkey: newKeys.pubkey,
      privateKeyPem: oldKeys.privateKeyPem,
      timestamp: 'abc',
    });
    assert.equal(nonIntRes.status, 401);
    assert.equal(nonIntRes.data.error, 'stale_timestamp');

    const firstRes = await kr235SignedRotate(ctx, {
      pubkey: newKeys.pubkey,
      privateKeyPem: oldKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    assert.equal(firstRes.status, 200);

    const replayHttpRes = await fetch(`${ctx.baseUrl}/api/town/key/rotate`, {
      method: 'POST',
      headers: firstRes.signed.headers,
      body: firstRes.signed.rawBody,
    });
    const replayData = await replayHttpRes.json();
    assert.equal(replayHttpRes.status, 401);
    assert.equal(replayData.error, 'replayed_nonce');

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const sayRes = await newClient.say('after replay');
    assert.equal(sayRes.status, 201);
  } finally {
    await ctx.close();
  }
});

test('pubkey shape edges: length is never validated, only decoded bytes', async () => {
  // Shape 1: empty string -> 400 missing_pubkey
  {
    const ctx = await startTestServer();
    try {
      const { client } = await createResident(ctx, 'alice');
      const res = await client.rotateKey('');
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'missing_pubkey');
    } finally {
      await ctx.close();
    }
  }

  // Shape 2: valid pubkey sliced to 43 chars (32 decoded bytes) -> 200, stored verbatim, say -> 201
  {
    const ctx = await startTestServer();
    try {
      const { client } = await createResident(ctx, 'alice');
      const nextKeys = generateKeypair();
      const sliced43 = nextKeys.pubkey.slice(0, 43);
      const res = await client.rotateKey(sliced43);
      assert.equal(res.status, 200);

      const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
      assert.equal(row.pubkey, sliced43);

      const newClient = new GhostlightClient({
        baseUrl: ctx.baseUrl,
        handle: 'alice',
        pubkey: sliced43,
        privateKeyPem: nextKeys.privateKeyPem,
      });
      const sayRes = await newClient.say('sliced 43');
      assert.equal(sayRes.status, 201);
    } finally {
      await ctx.close();
    }
  }

  // Shape 3: valid pubkey + trailing 'A' (45 chars, still 32 decoded bytes) -> 200, stored verbatim, say -> 201
  {
    const ctx = await startTestServer();
    try {
      const { client } = await createResident(ctx, 'alice');
      const nextKeys = generateKeypair();
      const padded45 = `${nextKeys.pubkey}A`;
      const res = await client.rotateKey(padded45);
      assert.equal(res.status, 200);

      const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
      assert.equal(row.pubkey, padded45);

      const newClient = new GhostlightClient({
        baseUrl: ctx.baseUrl,
        handle: 'alice',
        pubkey: padded45,
        privateKeyPem: nextKeys.privateKeyPem,
      });
      const sayRes = await newClient.say('padded 45');
      assert.equal(sayRes.status, 201);
    } finally {
      await ctx.close();
    }
  }

  // Shape 4: 'A'.repeat(43) + '=' (32 zero bytes) -> 200
  {
    const ctx = await startTestServer();
    try {
      const { client } = await createResident(ctx, 'alice');
      const res = await client.rotateKey(`${'A'.repeat(43)}=`);
      assert.equal(res.status, 200);
    } finally {
      await ctx.close();
    }
  }

  // Shape 5: '!'.repeat(44) (0 decoded bytes) -> 400 invalid_pubkey
  {
    const ctx = await startTestServer();
    try {
      const { client } = await createResident(ctx, 'alice');
      const res = await client.rotateKey('!'.repeat(44));
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'invalid_pubkey');
    } finally {
      await ctx.close();
    }
  }

  // Shape 6: valid pubkey sliced to 40 chars + '!!!!' (30 decoded bytes) -> 400 invalid_pubkey
  {
    const ctx = await startTestServer();
    try {
      const { client } = await createResident(ctx, 'alice');
      const nextKeys = generateKeypair();
      const res = await client.rotateKey(`${nextKeys.pubkey.slice(0, 40)}!!!!`);
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'invalid_pubkey');
    } finally {
      await ctx.close();
    }
  }
});

test('rotate after leave, then relight with the new key', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');
    const c1 = await oldClient.checkin({ status_text: 'lit before leave' });
    assert.equal(c1.status, 200);

    const leaveRes = await oldClient.leave();
    assert.equal(leaveRes.status, 200);
    const stateAfterLeave = await oldClient.state();
    assert.equal(stateAfterLeave.data.footlights.some((f) => f.handle === 'alice'), false);

    const newKeys = generateKeypair();
    const rotRes = await oldClient.rotateKey(newKeys.pubkey);
    assert.equal(rotRes.status, 200);
    assert.ok(rotRes.data.state_seq > leaveRes.data.state_seq);

    ctx.advanceClock(61);

    const checkinSigned = signRequest({
      method: 'POST',
      path: '/api/town/ghostlight/checkin',
      body: { status_text: 'relight after rotate' },
      handle: 'alice',
      privateKeyPem: newKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const relightHttpRes = await fetch(`${ctx.baseUrl}/api/town/ghostlight/checkin`, {
      method: 'POST',
      headers: checkinSigned.headers,
      body: checkinSigned.rawBody,
    });
    const relightData = await relightHttpRes.json();
    assert.equal(relightHttpRes.status, 200);
    assert.ok(relightData.state_seq > rotRes.data.state_seq);

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const stateAfterRelight = await newClient.state();
    assert.equal(stateAfterRelight.data.footlights.some((f) => f.handle === 'alice'), true);

    const oldCheckin = await oldClient.checkin({ status_text: 'old key try' });
    assert.equal(oldCheckin.status, 401);
  } finally {
    await ctx.close();
  }
});

test('rotate leaves other residents untouched; seq equality; retry_after bounds', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const keys1 = generateKeypair();
    const r1 = await alice.rotateKey(keys1.pubkey);
    assert.equal(r1.status, 200);

    const stateAfterR1 = await alice.state();
    assert.equal(r1.data.state_seq, stateAfterR1.data.state_seq);

    const bobRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow.pubkey, bobKeys.pubkey);
    const bobRotateHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('bob');
    assert.equal(bobRotateHistory.length, 0);
    const bobRegisterHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'register'")
      .all('bob');
    assert.equal(bobRegisterHistory.length, 1);

    alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keys1 });
    for (let i = 0; i < 2; i++) {
      const nextKeys = generateKeypair();
      const res = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(res.status, 200);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }

    const fourthRes = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(fourthRes.status, 429);
    assert.ok(
      Number.isInteger(fourthRes.data.retry_after) &&
        fourthRes.data.retry_after >= 1 &&
        fourthRes.data.retry_after <= 3600
    );
  } finally {
    await ctx.close();
  }
});

test('no banned term in key-rotate test file', () => {
  const selfSrc = fs.readFileSync(path.join(__dirname, 'test-key-rotate.mjs'), 'utf8');
  assert.ok(!BANNED_TERM_RE.test(selfSrc), 'test-key-rotate.mjs must not contain banned term');
});

async function createNpcResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joinRes = await client.join({ origin: 'colony' });
  assert.equal(joinRes.status, 201);
  const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
    handle,
    role: 'npc',
  });
  assert.equal(appRes.status, 200);
  return { client, keys };
}

test('muted resident may rotate and check in but not say; suspended resident may not rotate', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldAlice } = await createResident(ctx, 'alice');
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = ?").run('alice');

    const newAliceKeys = generateKeypair();
    const rotAlice = await oldAlice.rotateKey(newAliceKeys.pubkey);
    assert.equal(rotAlice.status, 200);

    const aliceRow = ctx.db.prepare('SELECT pubkey, status FROM residents WHERE handle = ?').get('alice');
    assert.equal(aliceRow.pubkey, newAliceKeys.pubkey);
    assert.equal(aliceRow.status, 'muted');

    const newAlice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newAliceKeys });
    const checkinRes = await newAlice.checkin({ status_text: 'muted checkin' });
    assert.equal(checkinRes.status, 200);
    assert.equal(checkinRes.data.slot, 1);

    const sayRes = await newAlice.say('muted say');
    assert.equal(sayRes.status, 403);
    assert.equal(sayRes.data.error, 'resident_muted');

    const oldCheckin = await oldAlice.checkin({ status_text: 'old key' });
    assert.equal(oldCheckin.status, 401);

    const { client: bob, keys: bobKeys } = await createResident(ctx, 'bob');
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('bob');

    const bobSuspRot = await bob.rotateKey(generateKeypair().pubkey);
    assert.equal(bobSuspRot.status, 403);
    assert.equal(bobSuspRot.data.error, 'resident_not_active');
    assert.equal(bobSuspRot.data.resident_status, 'suspended');

    const bobRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('bob');
    assert.equal(bobRow.pubkey, bobKeys.pubkey);

    const bobHistory = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = ? AND action = 'rotate'")
      .all('bob');
    assert.equal(bobHistory.length, 0);

    ctx.db.prepare("UPDATE residents SET status = 'active' WHERE handle = ?").run('bob');
    const bobActiveRot = await bob.rotateKey(generateKeypair().pubkey);
    assert.equal(bobActiveRot.status, 200);
  } finally {
    await ctx.close();
  }
});

test('rotate preserves Prompt Book lines and the presence row', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');
    const c1 = await oldClient.checkin({ status_text: 'lit before rotate' });
    assert.equal(c1.status, 200);

    const s1 = await oldClient.say('hello before rotate');
    assert.equal(s1.status, 201);

    const newKeys = generateKeypair();
    const rotRes = await oldClient.rotateKey(newKeys.pubkey);
    assert.equal(rotRes.status, 200);

    const st = await oldClient.state();
    assert.equal(st.status, 200);
    assert.ok(
      st.data.prompt_book.some((l) => l.handle === 'alice' && l.body === 'hello before rotate')
    );
    const presenceRow = st.data.presence.find((p) => p.handle === 'alice');
    assert.ok(presenceRow);
    assert.equal(presenceRow.zone, 'bandstand');
    assert.equal(presenceRow.role, 'muse');
  } finally {
    await ctx.close();
  }
});

test('rotate preserves an NPC resident role, footlight slot, and status text', async () => {
  const ctx = await startTestServer();
  try {
    const { client: wickOld } = await createNpcResident(ctx, 'wick');
    const checkinRes = await wickOld.checkin({ status_text: 'trimming lamps' });
    assert.equal(checkinRes.status, 200);
    const slot = checkinRes.data.slot;

    const newKeys = generateKeypair();
    const rotRes = await wickOld.rotateKey(newKeys.pubkey);
    assert.equal(rotRes.status, 200);

    const st = await wickOld.state();
    assert.equal(st.status, 200);
    const footlight = st.data.footlights.find((f) => f.handle === 'wick');
    assert.ok(footlight);
    assert.equal(footlight.role, 'npc');
    assert.equal(footlight.status_text, 'trimming lamps');
    assert.equal(footlight.slot, slot);

    const wickRow = ctx.db.prepare('SELECT role FROM residents WHERE handle = ?').get('wick');
    assert.equal(wickRow.role, 'npc');
  } finally {
    await ctx.close();
  }
});

test('rotate leaves resident row fields untouched and key_history created_at tracks the rotate second', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');
    const beforeRow = ctx.db
      .prepare('SELECT origin, status, role, bio, created_at, plot_updated_at FROM residents WHERE handle = ?')
      .get('alice');
    assert.equal(beforeRow.plot_updated_at, null);

    const t0 = ctx.nowSec();
    const keys1 = generateKeypair();
    const r1 = await oldClient.rotateKey(keys1.pubkey);
    assert.equal(r1.status, 200);

    const afterRow = ctx.db
      .prepare('SELECT origin, status, role, bio, created_at, plot_updated_at FROM residents WHERE handle = ?')
      .get('alice');
    assert.deepEqual(afterRow, beforeRow);

    const h1 = ctx.db
      .prepare("SELECT created_at FROM key_history WHERE handle = ? AND action = 'rotate' ORDER BY id ASC")
      .all('alice');
    assert.equal(h1.length, 1);
    assert.ok(h1[0].created_at >= t0 && h1[0].created_at <= t0 + 2);

    ctx.advanceClock(120);
    const client2 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...keys1 });
    const r2 = await client2.rotateKey(generateKeypair().pubkey);
    assert.equal(r2.status, 200);

    const h2 = ctx.db
      .prepare("SELECT created_at FROM key_history WHERE handle = ? AND action = 'rotate' ORDER BY id ASC")
      .all('alice');
    assert.equal(h2.length, 2);
    assert.equal(h2[1].created_at - h2[0].created_at, 120);
  } finally {
    await ctx.close();
  }
});

test('failed rotates do not bump state_seq', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const seq0 = (await alice.state()).data.state_seq;

    const missingRes = await alice._signedPost('/api/town/key/rotate', {});
    assert.equal(missingRes.status, 400);
    assert.equal(missingRes.data.error, 'missing_pubkey');
    assert.equal((await alice.state()).data.state_seq, seq0);

    const sameRes = await alice.rotateKey(aliceKeys.pubkey);
    assert.equal(sameRes.status, 400);
    assert.equal(sameRes.data.error, 'same_pubkey');
    assert.equal((await alice.state()).data.state_seq, seq0);

    const invalidRes = await alice.rotateKey('not-a-key');
    assert.equal(invalidRes.status, 400);
    assert.equal(invalidRes.data.error, 'invalid_pubkey');
    assert.equal((await alice.state()).data.state_seq, seq0);

    const takenRes = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(takenRes.status, 409);
    assert.equal(takenRes.data.error, 'pubkey_taken');
    assert.equal((await alice.state()).data.state_seq, seq0);

    for (let i = 0; i < 3; i++) {
      const nextKeys = generateKeypair();
      const res = await alice.rotateKey(nextKeys.pubkey);
      assert.equal(res.status, 200);
      alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nextKeys });
    }

    const seqBefore429 = (await alice.state()).data.state_seq;
    const fourthRes = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(fourthRes.status, 429);
    assert.equal(fourthRes.data.error, 'rate_limited');
    assert.equal((await alice.state()).data.state_seq, seqBefore429);
  } finally {
    await ctx.close();
  }
});

test('successive rotates bump state_seq by exactly one each', async () => {
  const ctx = await startTestServer();
  try {
    const { client: c0 } = await createResident(ctx, 'alice');
    const seq0 = (await c0.state()).data.state_seq;

    const k1 = generateKeypair();
    const r1 = await c0.rotateKey(k1.pubkey);
    assert.equal(r1.status, 200);
    assert.equal(r1.data.state_seq, seq0 + 1);
    assert.equal((await c0.state()).data.state_seq, r1.data.state_seq);

    const c1 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...k1 });
    const k2 = generateKeypair();
    const r2 = await c1.rotateKey(k2.pubkey);
    assert.equal(r2.status, 200);
    assert.equal(r2.data.state_seq, r1.data.state_seq + 1);
    assert.equal((await c1.state()).data.state_seq, r2.data.state_seq);
  } finally {
    await ctx.close();
  }
});

async function signedRotateAtServerTime(ctx, { handle = 'alice', pubkey, privateKeyPem }) {
  const signed = signRequest({
    method: 'POST',
    path: '/api/town/key/rotate',
    body: { pubkey },
    handle,
    privateKeyPem,
    timestamp: ctx.nowSec(),
  });
  const res = await fetch(`${ctx.baseUrl}/api/town/key/rotate`, {
    method: 'POST',
    headers: signed.headers,
    body: signed.rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, signed };
}

test('pending resident cannot rotate until activated', async () => {
  const ctx = await startTestServer();
  try {
    const { client, keys: oldKeys } = await createResident(ctx, 'alice');
    ctx.db.prepare("UPDATE residents SET status = 'pending' WHERE handle = ?").run('alice');

    const newKeys = generateKeypair();
    const blocked = await client.rotateKey(newKeys.pubkey);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error, 'resident_not_active');
    assert.equal(blocked.data.resident_status, 'pending');

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, oldKeys.pubkey);
    const rotCount = ctx.db
      .prepare("SELECT COUNT(*) AS c FROM key_history WHERE handle = ? AND action = 'rotate'")
      .get('alice').c;
    assert.equal(rotCount, 0);

    ctx.db.prepare("UPDATE residents SET status = 'active' WHERE handle = ?").run('alice');
    const ok = await client.rotateKey(newKeys.pubkey);
    assert.equal(ok.status, 200);
  } finally {
    await ctx.close();
  }
});

test('key rotate rate limit returns exact retry_after 3600 on a fixed clock', async () => {
  const ctx = await startTestServer();
  try {
    let { keys: currentKeys } = await createResident(ctx, 'alice');
    const t0 = ctx.nowSec();

    for (let i = 0; i < 3; i++) {
      const nextKeys = generateKeypair();
      const res = await kr235SignedRotate(ctx, {
        pubkey: nextKeys.pubkey,
        privateKeyPem: currentKeys.privateKeyPem,
        timestamp: t0,
      });
      assert.equal(res.status, 200);
      currentKeys = nextKeys;
    }

    const fourth = await kr235SignedRotate(ctx, {
      pubkey: generateKeypair().pubkey,
      privateKeyPem: currentKeys.privateKeyPem,
      timestamp: t0,
    });
    assert.equal(fourth.status, 429);
    assert.equal(fourth.data.error, 'rate_limited');
    assert.equal(fourth.data.retry_after, 3600);
  } finally {
    await ctx.close();
  }
});

test('key rotate rate limit window boundary: +3599s blocked with retry_after 1, +3600s succeeds', async () => {
  const ctx = await startTestServer();
  try {
    let { keys: currentKeys } = await createResident(ctx, 'alice');
    const t0 = ctx.nowSec();

    for (let i = 0; i < 3; i++) {
      const nextKeys = generateKeypair();
      const res = await kr235SignedRotate(ctx, {
        pubkey: nextKeys.pubkey,
        privateKeyPem: currentKeys.privateKeyPem,
        timestamp: t0,
      });
      assert.equal(res.status, 200);
      currentKeys = nextKeys;
    }

    ctx.advanceClock(3599);
    const blocked = await kr235SignedRotate(ctx, {
      pubkey: generateKeypair().pubkey,
      privateKeyPem: currentKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.error, 'rate_limited');
    assert.equal(blocked.data.retry_after, 1);

    ctx.advanceClock(1);
    const allowed = await kr235SignedRotate(ctx, {
      pubkey: generateKeypair().pubkey,
      privateKeyPem: currentKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data.rotated, true);
  } finally {
    await ctx.close();
  }
});

test('register writes exact initial key_history row', async () => {
  const ctx = await startTestServer();
  try {
    const t0 = ctx.nowSec();
    const { keys } = await createResident(ctx, 'alice');

    const rows = ctx.db
      .prepare('SELECT handle, pubkey, action, note, created_at FROM key_history WHERE handle = ? ORDER BY id ASC')
      .all('alice');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].handle, 'alice');
    assert.equal(rows[0].pubkey, keys.pubkey);
    assert.equal(rows[0].action, 'register');
    assert.equal(rows[0].note, 'joined');
    assert.ok(rows[0].created_at >= t0 && rows[0].created_at <= t0 + 2);
  } finally {
    await ctx.close();
  }
});

test('rotate preserves pending guestbook entry and letter', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');

    const gbPost = await fetch(`${ctx.baseUrl}/api/town/guestbook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'guestbook', name: 'Alice', body: 'Lovely town!', plot: 'alice' }),
    });
    assert.equal(gbPost.status, 201);

    const letterPost = await fetch(`${ctx.baseUrl}/api/town/guestbook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'letter', name: 'Alice', body: 'Dear Milo, hello.' }),
    });
    assert.equal(letterPost.status, 201);

    const newKeys = generateKeypair();
    const rot = await oldClient.rotateKey(newKeys.pubkey);
    assert.equal(rot.status, 200);

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const publicGb = await newClient.getGuestbook('guestbook', 'alice');
    assert.equal(publicGb.status, 200);
    assert.equal(publicGb.data.entries.length, 0);

    const dbRows = ctx.db
      .prepare('SELECT kind, body, plot, status FROM guestbook ORDER BY id ASC')
      .all()
      .map((r) => ({ ...r }));
    assert.deepEqual(dbRows, [
      { kind: 'guestbook', body: 'Lovely town!', plot: 'alice', status: 'pending' },
      { kind: 'letter', body: 'Dear Milo, hello.', plot: null, status: 'pending' },
    ]);
    const pendingCount = ctx.db.prepare("SELECT COUNT(*) AS c FROM guestbook WHERE status = 'pending'").get().c;
    assert.equal(pendingCount, 2);
  } finally {
    await ctx.close();
  }
});

test('rotate preserves garden sprout', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');
    const plantRes = await oldClient.gardenPlant('moonflower');
    assert.equal(plantRes.status, 201);

    const newKeys = generateKeypair();
    const rot = await oldClient.rotateKey(newKeys.pubkey);
    assert.equal(rot.status, 200);

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const stateRes = await newClient.state();
    assert.equal(stateRes.status, 200);
    const sprout = stateRes.data.garden.slots.find((g) => g.handle === 'alice');
    assert.ok(sprout);
    assert.equal(sprout.seed, 'moonflower');
    assert.equal(sprout.stage, 'sprout');
  } finally {
    await ctx.close();
  }
});

test('rotate after footlight expiry, then relight with the new key', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient, keys: oldKeys } = await createResident(ctx, 'alice');
    const c1 = await oldClient.checkin({ status_text: 'lit then expired' });
    assert.equal(c1.status, 200);

    ctx.advanceClock(2701);
    const expiredState = await oldClient.state();
    assert.equal(expiredState.data.footlights.some((f) => f.handle === 'alice'), false);

    const newKeys = generateKeypair();
    const rot = await signedRotateAtServerTime(ctx, {
      pubkey: newKeys.pubkey,
      privateKeyPem: oldKeys.privateKeyPem,
    });
    assert.equal(rot.status, 200);

    const stateAfterRotate = await oldClient.state();
    assert.equal(stateAfterRotate.data.footlights.some((f) => f.handle === 'alice'), false);

    const relightSigned = signRequest({
      method: 'POST',
      path: '/api/town/ghostlight/checkin',
      body: { status_text: 'relight after expiry' },
      handle: 'alice',
      privateKeyPem: newKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const relightHttp = await fetch(`${ctx.baseUrl}/api/town/ghostlight/checkin`, {
      method: 'POST',
      headers: relightSigned.headers,
      body: relightSigned.rawBody,
    });
    const relightData = await relightHttp.json();
    assert.equal(relightHttp.status, 200);
    assert.equal(relightData.slot, 1);

    const stateAfterRelight = await oldClient.state();
    assert.equal(stateAfterRelight.data.footlights.some((f) => f.handle === 'alice'), true);

    const oldCheckinSigned = signRequest({
      method: 'POST',
      path: '/api/town/ghostlight/checkin',
      body: { status_text: 'stale key' },
      handle: 'alice',
      privateKeyPem: oldKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const oldCheckinHttp = await fetch(`${ctx.baseUrl}/api/town/ghostlight/checkin`, {
      method: 'POST',
      headers: oldCheckinSigned.headers,
      body: oldCheckinSigned.rawBody,
    });
    assert.equal(oldCheckinHttp.status, 401);
  } finally {
    await ctx.close();
  }
});

test('interleaved rotates of two residents stay independent', async () => {
  const ctx = await startTestServer();
  try {
    let { client: alice } = await createResident(ctx, 'alice');
    let { client: bob } = await createResident(ctx, 'bob');

    const a1 = generateKeypair();
    assert.equal((await alice.rotateKey(a1.pubkey)).status, 200);
    alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...a1 });

    const b1 = generateKeypair();
    assert.equal((await bob.rotateKey(b1.pubkey)).status, 200);
    bob = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...b1 });

    const a2 = generateKeypair();
    assert.equal((await alice.rotateKey(a2.pubkey)).status, 200);
    alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...a2 });

    assert.equal((await alice.say('alice latest')).status, 201);
    assert.equal((await bob.say('bob latest')).status, 201);

    const aliceRotates = ctx.db
      .prepare("SELECT pubkey FROM key_history WHERE handle = 'alice' AND action = 'rotate' ORDER BY id ASC")
      .all()
      .map((r) => r.pubkey);
    assert.deepEqual(aliceRotates, [a1.pubkey, a2.pubkey]);

    const bobRotates = ctx.db
      .prepare("SELECT pubkey FROM key_history WHERE handle = 'bob' AND action = 'rotate' ORDER BY id ASC")
      .all()
      .map((r) => r.pubkey);
    assert.deepEqual(bobRotates, [b1.pubkey]);

    assert.equal(ctx.db.prepare("SELECT pubkey FROM residents WHERE handle = 'alice'").get().pubkey, a2.pubkey);
    assert.equal(ctx.db.prepare("SELECT pubkey FROM residents WHERE handle = 'bob'").get().pubkey, b1.pubkey);
  } finally {
    await ctx.close();
  }
});

test('31-byte and 33-byte pubkeys are rejected while 32 zero bytes succeed', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createResident(ctx, 'alice');

    const r31 = await client.rotateKey(Buffer.alloc(31).toString('base64'));
    assert.equal(r31.status, 400);
    assert.equal(r31.data.error, 'invalid_pubkey');

    const r33 = await client.rotateKey(Buffer.alloc(33).toString('base64'));
    assert.equal(r33.status, 400);
    assert.equal(r33.data.error, 'invalid_pubkey');

    const r32 = await client.rotateKey(Buffer.alloc(32).toString('base64'));
    assert.equal(r32.status, 200);
  } finally {
    await ctx.close();
  }
});

test('rotate preserves plot_updated_at when a plot is set', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');
    const putPlot = await oldClient.plot(KR235_MANIFEST, KR235_HTML);
    assert.equal(putPlot.status, 200);

    const beforePlot = await oldClient.getPlot('alice');
    assert.equal(beforePlot.status, 200);
    assert.equal(Number.isInteger(beforePlot.data.plot_updated_at), true);

    const newKeys = generateKeypair();
    const rot = await oldClient.rotateKey(newKeys.pubkey);
    assert.equal(rot.status, 200);

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...newKeys });
    const afterPlot = await newClient.getPlot('alice');
    assert.equal(afterPlot.status, 200);
    assert.equal(afterPlot.data.plot_updated_at, beforePlot.data.plot_updated_at);
    assert.deepEqual(afterPlot.data.manifest, KR235_MANIFEST);
  } finally {
    await ctx.close();
  }
});

test('rotate non-string pubkey remaining variants return missing_pubkey (G39)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    const seq0 = (await alice.state()).data.state_seq;

    for (const bad of [true, false, {}, 0]) {
      const res = await alice._signedPost('/api/town/key/rotate', { pubkey: bad });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'missing_pubkey');
    }

    const rotates = ctx.db
      .prepare("SELECT * FROM key_history WHERE handle = 'alice' AND action = 'rotate'")
      .all();
    assert.equal(rotates.length, 0);
    assert.equal((await alice.state()).data.state_seq, seq0);
    assert.equal(
      ctx.db.prepare("SELECT pubkey FROM residents WHERE handle = 'alice'").get().pubkey,
      aliceKeys.pubkey
    );
  } finally {
    await ctx.close();
  }
});

test('validation errors beat the rate limit after three rotates (G40)', async () => {
  const ctx = await startTestServer();
  try {
    let { keys: aliceKeys } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');
    const t0 = ctx.nowSec();

    for (let i = 0; i < 3; i += 1) {
      const nextKeys = generateKeypair();
      const r = await kr235SignedRotate(ctx, {
        pubkey: nextKeys.pubkey,
        privateKeyPem: aliceKeys.privateKeyPem,
        timestamp: t0,
      });
      assert.equal(r.status, 200);
      aliceKeys = nextKeys;
    }

    const aliceCurrent = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...aliceKeys });

    const sameRes = await aliceCurrent.rotateKey(aliceKeys.pubkey);
    assert.equal(sameRes.status, 400);
    assert.equal(sameRes.data.error, 'same_pubkey');

    const takenRes = await aliceCurrent.rotateKey(bobKeys.pubkey);
    assert.equal(takenRes.status, 409);
    assert.equal(takenRes.data.error, 'pubkey_taken');

    const badRes = await aliceCurrent.rotateKey('bad-key');
    assert.equal(badRes.status, 400);
    assert.equal(badRes.data.error, 'invalid_pubkey');

    const missingRes = await aliceCurrent._signedPost('/api/town/key/rotate', {});
    assert.equal(missingRes.status, 400);
    assert.equal(missingRes.data.error, 'missing_pubkey');

    ctx.advanceClock(3600);
    const afterWindow = await kr235SignedRotate(ctx, {
      pubkey: generateKeypair().pubkey,
      privateKeyPem: aliceKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    assert.equal(afterWindow.status, 200);
  } finally {
    await ctx.close();
  }
});

test('rotate to a pending or suspended resident pubkey returns 409 pubkey_taken (G41)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const bobKeys = generateKeypair();
    const bobClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bob', ...bobKeys });
    assert.equal((await bobClient.join({ origin: 'musebook' })).status, 201);
    ctx.db.prepare("UPDATE residents SET status = 'pending' WHERE handle = 'bob'").run();
    assert.equal(
      ctx.db.prepare("SELECT status FROM residents WHERE handle = 'bob'").get().status,
      'pending'
    );

    const pendingRes = await alice.rotateKey(bobKeys.pubkey);
    assert.equal(pendingRes.status, 409);
    assert.equal(pendingRes.data.error, 'pubkey_taken');

    const { keys: carolKeys } = await createResident(ctx, 'carol');
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = 'carol'").run();

    const suspendedRes = await alice.rotateKey(carolKeys.pubkey);
    assert.equal(suspendedRes.status, 409);
    assert.equal(suspendedRes.data.error, 'pubkey_taken');

    assert.equal(
      ctx.db.prepare("SELECT pubkey FROM residents WHERE handle = 'bob'").get().pubkey,
      bobKeys.pubkey
    );
    assert.equal(
      ctx.db.prepare("SELECT pubkey FROM residents WHERE handle = 'carol'").get().pubkey,
      carolKeys.pubkey
    );
    assert.equal(
      ctx.db.prepare("SELECT * FROM key_history WHERE handle = 'alice' AND action = 'rotate'").all().length,
      0
    );

    const okRes = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(okRes.status, 200);
  } finally {
    await ctx.close();
  }
});

test('rotate preserves a fish catch and the new key can fish again (G42)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient, keys: oldKeys } = await createResident(ctx, 'alice');

    const castRes = await oldClient.fishCast();
    assert.equal(castRes.status, 201);
    assert.equal(castRes.data.reel_at, castRes.data.cast_at + 300);

    const earlyReel = await oldClient.fishReel();
    assert.equal(earlyReel.status, 409);
    assert.equal(earlyReel.data.error, 'line_settling');

    ctx.advanceClock(300);
    const reelSigned = signRequest({
      method: 'POST',
      path: '/api/town/fish/reel',
      body: {},
      handle: 'alice',
      privateKeyPem: oldKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const reelHttp = await fetch(`${ctx.baseUrl}/api/town/fish/reel`, {
      method: 'POST',
      headers: reelSigned.headers,
      body: reelSigned.rawBody,
    });
    const reelData = await reelHttp.json();
    assert.equal(reelHttp.status, 200);
    assert.equal(typeof reelData.catch.kind, 'string');
    assert.equal(typeof reelData.catch.label, 'string');
    assert.equal(typeof reelData.catch.flavor, 'string');
    assert.equal(reelData.caught_at, castRes.data.cast_at + 300);

    const expectedCatch = {
      kind: reelData.catch.kind,
      label: reelData.catch.label,
      flavor: reelData.catch.flavor,
      caught_at: reelData.caught_at,
    };

    const logBefore = await oldClient.fishLog('alice');
    assert.equal(logBefore.status, 200);
    assert.equal(logBefore.data.catches.length, 1);
    assert.deepEqual(logBefore.data.catches[0], expectedCatch);

    const newKeys = generateKeypair();
    const rot = await kr235SignedRotate(ctx, {
      pubkey: newKeys.pubkey,
      privateKeyPem: oldKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    assert.equal(rot.status, 200);

    const logAfter = await oldClient.fishLog('alice');
    assert.equal(logAfter.status, 200);
    assert.equal(logAfter.data.catches.length, 1);
    assert.deepEqual(logAfter.data.catches[0], expectedCatch);

    const newCastSigned = signRequest({
      method: 'POST',
      path: '/api/town/fish/cast',
      body: {},
      handle: 'alice',
      privateKeyPem: newKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const newCastHttp = await fetch(`${ctx.baseUrl}/api/town/fish/cast`, {
      method: 'POST',
      headers: newCastSigned.headers,
      body: newCastSigned.rawBody,
    });
    assert.equal(newCastHttp.status, 201);

    const oldCastSigned = signRequest({
      method: 'POST',
      path: '/api/town/fish/cast',
      body: {},
      handle: 'alice',
      privateKeyPem: oldKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const oldCastHttp = await fetch(`${ctx.baseUrl}/api/town/fish/cast`, {
      method: 'POST',
      headers: oldCastSigned.headers,
      body: oldCastSigned.rawBody,
    });
    assert.equal(oldCastHttp.status, 401);
  } finally {
    await ctx.close();
  }
});

test('key_history DB table exact shape and action CHECK (G43)', async () => {
  const ctx = await startTestServer();
  try {
    const cols = ctx.db.prepare('PRAGMA table_info(key_history)').all().map((r) => ({ ...r }));
    assert.deepEqual(cols.map((c) => c.name), ['id', 'handle', 'pubkey', 'action', 'created_at', 'note']);
    assert.deepEqual(cols.map((c) => c.type), ['INTEGER', 'TEXT', 'TEXT', 'TEXT', 'INTEGER', 'TEXT']);
    assert.deepEqual(cols.map((c) => c.pk), [1, 0, 0, 0, 0, 0]);
    assert.deepEqual(cols.map((c) => c.notnull), [0, 1, 1, 1, 1, 0]);
    assert.deepEqual(cols.map((c) => c.dflt_value), [null, null, null, null, null, null]);

    const tbl = ctx.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'key_history'")
      .get();
    assert.equal(
      tbl.sql,
      "CREATE TABLE key_history (\n    id              INTEGER PRIMARY KEY AUTOINCREMENT,\n    handle          TEXT NOT NULL,\n    pubkey          TEXT NOT NULL,\n    action          TEXT NOT NULL CHECK (action IN ('register', 'rotate', 'revoke')),\n    created_at      INTEGER NOT NULL,\n    note            TEXT\n)"
    );

    const indexes = ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'key_history'")
      .all();
    assert.equal(indexes.length, 0);

    assert.throws(() => {
      ctx.db
        .prepare("INSERT INTO key_history (handle, pubkey, action, created_at, note) VALUES ('alice', 'pk', 'bogus', 1, null)")
        .run();
    }, /CHECK constraint failed: action IN \('register', 'rotate', 'revoke'\)/);
  } finally {
    await ctx.close();
  }
});

test('key rotate source pins: rate limit, schema, town.json, SKILL.md (G44)', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  assert.equal(serverSrc.includes('  keyRotate: { max: 3, windowSec: 60 * 60 },\n'), true);
  assert.equal(
    serverSrc.includes(
      "INSERT INTO key_history (handle, pubkey, action, created_at, note) VALUES (?, ?, 'rotate', ?, 'self-service rotation')"
    ),
    true
  );

  const townJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'town.json'), 'utf8'));
  const rotateEp = townJson.endpoints.find(
    (e) => e.method === 'POST' && e.path === '/api/town/key/rotate'
  );
  assert.ok(rotateEp);
  assert.equal(rotateEp.auth, 'signed');
  assert.equal(rotateEp.rate_limit, '3/hour');
  assert.equal(
    rotateEp.summary,
    'Rotate your Ed25519 public key (signed with your current key; old key stops working immediately).'
  );
  assert.equal(townJson.limits.keyRotate, undefined);

  const skillMd = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  assert.equal(skillMd.includes('client.rotateKey(newPubkey)'), true);
  assert.equal(skillMd.includes('Rate limit:** 3/hour per resident'), true);

  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  assert.equal(
    schemaSql.includes(
      "CREATE TABLE IF NOT EXISTS key_history (\n    id              INTEGER PRIMARY KEY AUTOINCREMENT,\n    handle          TEXT NOT NULL,\n    pubkey          TEXT NOT NULL,\n    action          TEXT NOT NULL CHECK (action IN ('register', 'rotate', 'revoke')),\n    created_at      INTEGER NOT NULL,\n    note            TEXT\n);"
    ),
    true
  );
});

test('rotating twice to the same new key fails the second time with same_pubkey (G45)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: c0, keys: k0 } = await createResident(ctx, 'alice');
    const k1 = generateKeypair();
    assert.equal((await c0.rotateKey(k1.pubkey)).status, 200);

    const c1 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...k1 });
    const dup = await c1.rotateKey(k1.pubkey);
    assert.equal(dup.status, 400);
    assert.equal(dup.data.error, 'same_pubkey');

    const k2 = generateKeypair();
    assert.equal((await c1.rotateKey(k2.pubkey)).status, 200);
    const c2 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...k2 });

    assert.equal((await c0.say('old key')).status, 401);
    assert.equal((await c1.say('middle key')).status, 401);
    assert.equal((await c2.say('new key')).status, 201);

    const hist = ctx.db
      .prepare("SELECT pubkey FROM key_history WHERE handle = 'alice' AND action = 'rotate' ORDER BY id ASC")
      .all()
      .map((r) => r.pubkey);
    assert.deepEqual(hist, [k1.pubkey, k2.pubkey]);
    assert.equal(hist.includes(k0.pubkey), false);
  } finally {
    await ctx.close();
  }
});

test('state since reflects rotate and failed rotates stay invisible (G46)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const seq0 = (await alice.state()).data.state_seq;

    const failRot = await alice._signedPost('/api/town/key/rotate', {});
    assert.equal(failRot.status, 400);
    assert.equal(failRot.data.error, 'missing_pubkey');

    const stUnchanged = await alice.state(seq0);
    assert.equal(stUnchanged.status, 304);
    assert.equal(stUnchanged.data, null);

    const okRot = await alice.rotateKey(generateKeypair().pubkey);
    assert.equal(okRot.status, 200);
    assert.equal(okRot.data.state_seq, seq0 + 1);

    const stAfter = await alice.state(seq0);
    assert.equal(stAfter.status, 200);
    assert.equal(stAfter.data.state_seq, seq0 + 1);

    const stNow = await alice.state(seq0 + 1);
    assert.equal(stNow.status, 304);
    assert.equal(stNow.data, null);
  } finally {
    await ctx.close();
  }
});

test('rotate preserves presence zone and per-plot guestbook counts (G47)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    assert.equal((await alice.checkin({ status_text: 'at the gate' })).status, 200);

    const pres = await alice.presence('plot:alice');
    assert.equal(pres.status, 200);
    assert.equal(pres.data.zone, 'plot:alice');

    const gb = await alice.signGuestbook('guestbook', 'Fan', 'Alice cottage is lovely.', 'alice');
    assert.equal(gb.status, 201);
    const app = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/guestbook', {
      id: gb.data.id,
      action: 'approve',
    });
    assert.equal(app.status, 200);

    const before = await alice.state();
    assert.deepEqual(before.data.guestbook_by_plot, { alice: 1 });
    assert.equal(before.data.guestbook.signed, 0);
    assert.equal(before.data.guestbook.letters, 0);
    assert.equal(before.data.presence.find((p) => p.handle === 'alice')?.zone, 'plot:alice');

    assert.equal((await alice.rotateKey(generateKeypair().pubkey)).status, 200);

    const after = await alice.state();
    assert.deepEqual(after.data.guestbook_by_plot, { alice: 1 });
    assert.equal(after.data.guestbook.signed, 0);
    assert.equal(after.data.guestbook.letters, 0);
    assert.equal(after.data.presence.find((p) => p.handle === 'alice')?.zone, 'plot:alice');
    assert.equal(after.data.footlights.some((f) => f.handle === 'alice'), true);
  } finally {
    await ctx.close();
  }
});

test('file hygiene: 58 unique names, 8 imports, pinned as-true counts (G48)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-key-rotate.mjs'), 'utf8');
  const lines = src.split('\n');

  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 58);
  assert.equal(new Set(names).size, 58);

  const imports = lines.filter((l) => l.startsWith('import '));
  assert.deepEqual(imports, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { createTownServer } from './server.mjs';",
    "import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';",
  ]);

  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 16);
  assert.equal(lines.filter((l) => new RegExp('Date' + '.now').test(l)).length, 1);
  assert.equal(lines.filter((l) => l.includes('Math' + '.random')).length, 0);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal((src.match(new RegExp('camp' + 'fire', 'gi')) || []).length, 0);
});

test('non-canonical base64 spelling of same key rotates and both spellings authenticate (G49)', async () => {
  const ctx = await startTestServer();
  try {
    const { client, keys } = await createResident(ctx, 'alice');
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const i = 42;
    const v = B64.indexOf(keys.pubkey[i]);
    const variant = keys.pubkey.slice(0, i) + B64[(v & ~3) | ((v + 1) & 3)] + keys.pubkey.slice(i + 1);

    assert.notEqual(variant, keys.pubkey);
    assert.equal(Buffer.from(variant, 'base64').equals(Buffer.from(keys.pubkey, 'base64')), true);

    const rot = await client.rotateKey(variant);
    assert.equal(rot.status, 200);
    assert.deepEqual(Object.keys(rot.data).sort(), ['handle', 'rotated', 'state_seq']);

    const row = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    assert.equal(row.pubkey, variant);
    const hist = ctx.db
      .prepare("SELECT pubkey FROM key_history WHERE handle = 'alice' AND action = 'rotate'")
      .get();
    assert.equal(hist.pubkey, variant);

    const oldSpellingClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alice',
      pubkey: keys.pubkey,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await oldSpellingClient.checkin({ status_text: 'old spelling' })).status, 200);

    ctx.advanceClock(61);

    const variantClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alice',
      pubkey: variant,
      privateKeyPem: keys.privateKeyPem,
    });
    assert.equal((await variantClient.checkin({ status_text: 'new spelling' })).status, 200);
  } finally {
    await ctx.close();
  }
});

test('non-canonical spelling of another resident key does not 409 (G50)', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await createResident(ctx, 'alice');
    const bob = await createResident(ctx, 'bob');
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const i = 42;
    const v = B64.indexOf(alice.keys.pubkey[i]);
    const variant = alice.keys.pubkey.slice(0, i) + B64[(v & ~3) | ((v + 1) & 3)] + alice.keys.pubkey.slice(i + 1);

    const rot = await bob.client.rotateKey(variant);
    assert.equal(rot.status, 200);

    const bobOldCheckin = await bob.client.checkin({ status_text: 'bob old' });
    assert.equal(bobOldCheckin.status, 401);
    assert.equal(bobOldCheckin.data.error, 'invalid_signature');

    const bobSharedClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'bob',
      pubkey: variant,
      privateKeyPem: alice.keys.privateKeyPem,
    });
    assert.equal((await bobSharedClient.checkin({ status_text: 'bob on shared bytes' })).status, 200);
    assert.equal((await alice.client.checkin({ status_text: 'alice still home' })).status, 200);

    const aliceRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice');
    const bobRow = ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('bob');
    assert.notEqual(aliceRow.pubkey, bobRow.pubkey);
    assert.equal(Buffer.from(aliceRow.pubkey, 'base64').equals(Buffer.from(bobRow.pubkey, 'base64')), true);
  } finally {
    await ctx.close();
  }
});

test('junk-tolerant base64 with embedded junk and surrounding whitespace rotates and stores verbatim (G51)', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createResident(ctx, 'alice');
    const fresh = generateKeypair();
    const junkedFresh = fresh.pubkey.slice(0, 10) + '!' + fresh.pubkey.slice(10);

    assert.equal((await client.rotateKey(junkedFresh)).status, 200);
    assert.equal(ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice').pubkey, junkedFresh);

    const junkedClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alice',
      pubkey: junkedFresh,
      privateKeyPem: fresh.privateKeyPem,
    });
    assert.equal((await junkedClient.checkin({ status_text: 'junk stored' })).status, 200);

    const fresh2 = generateKeypair();
    const spaced = ' ' + fresh2.pubkey + ' ';
    ctx.advanceClock(61);

    assert.equal((await junkedClient.rotateKey(spaced)).status, 200);
    assert.equal(ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice').pubkey, spaced);

    const spacedClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alice',
      pubkey: spaced,
      privateKeyPem: fresh2.privateKeyPem,
    });
    assert.equal((await spacedClient.checkin({ status_text: 'spaced stored' })).status, 200);
  } finally {
    await ctx.close();
  }
});

test('rotate budget and guestbook budget are independent (G52)', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await createResident(ctx, 'alice');
    let activeClient = alice.client;
    for (let k = 0; k < 3; k++) {
      const nk = generateKeypair();
      assert.equal((await activeClient.rotateKey(nk.pubkey)).status, 200);
      activeClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nk });
    }
    assert.equal((await activeClient.rotateKey(generateKeypair().pubkey)).status, 429);

    assert.equal((await activeClient.plot(KR235_MANIFEST, KR235_HTML)).status, 200);
    assert.equal((await activeClient.signGuestbook('guestbook', 'Alice', 'still here after rotates')).status, 201);
    assert.equal((await activeClient.checkin({ status_text: 'still me' })).status, 200);

    const bob = await createResident(ctx, 'bob');
    assert.equal((await bob.client.signGuestbook('guestbook', 'Bob', 'note 1')).status, 201);
    assert.equal((await bob.client.signGuestbook('guestbook', 'Bob', 'note 2')).status, 201);
    assert.equal((await bob.client.signGuestbook('guestbook', 'Bob', 'note 3')).status, 429);
    assert.equal((await bob.client.rotateKey(generateKeypair().pubkey)).status, 200);
  } finally {
    await ctx.close();
  }
});

test('old key fails every resident endpoint after rotate while new key works (G53)', async () => {
  const ctx = await startTestServer();
  try {
    const { client: oldClient } = await createResident(ctx, 'alice');
    const nk = generateKeypair();
    assert.equal((await oldClient.rotateKey(nk.pubkey)).status, 200);

    const calls = [
      () => oldClient.checkin({ status_text: 'x' }),
      () => oldClient.say('hello'),
      () => oldClient.leave(),
      () => oldClient.plot(KR235_MANIFEST, KR235_HTML),
      () => oldClient.fishCast(),
      () => oldClient.gardenPlant('moonflower'),
      () => oldClient.claimInnRoom('lantern', 2),
      () => oldClient.presence('bandstand'),
    ];
    for (const fn of calls) {
      const res = await fn();
      assert.equal(res.status, 401);
      assert.equal(res.data.error, 'invalid_signature');
    }

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...nk });
    assert.equal((await newClient.checkin({ status_text: 'new key home' })).status, 200);
    assert.equal((await newClient.say('rotated and speaking')).status, 201);
    assert.equal((await newClient.leave()).status, 200);
  } finally {
    await ctx.close();
  }
});

test('extra rotate body fields are ignored (G54)', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createResident(ctx, 'alice');
    const before = ctx.db.prepare('SELECT role, status, origin, bio FROM residents WHERE handle = ?').get('alice');
    const nk = generateKeypair();
    const res = await client._signedPost('/api/town/key/rotate', {
      pubkey: nk.pubkey,
      role: 'npc',
      status: 'suspended',
      origin: 'rstation',
      bio: 'pwned',
    });
    assert.equal(res.status, 200);
    const after = ctx.db.prepare('SELECT role, status, origin, bio FROM residents WHERE handle = ?').get('alice');
    assert.deepEqual(after, before);
  } finally {
    await ctx.close();
  }
});

test('rotating to operator pubkey succeeds and operator auth still works (G55)', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await createResident(ctx, 'alice');
    await createResident(ctx, 'bob');

    assert.equal((await alice.client.rotateKey(ctx.operatorKeys.pubkey)).status, 200);
    assert.equal(
      ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice').pubkey,
      ctx.operatorKeys.pubkey,
    );
    assert.equal((await alice.client.checkin({ status_text: 'old' })).status, 401);

    const aliceAsOpClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alice',
      pubkey: ctx.operatorKeys.pubkey,
      privateKeyPem: ctx.operatorKeys.privateKeyPem,
    });
    assert.equal((await aliceAsOpClient.checkin({ status_text: 'alice on operator bytes' })).status, 200);

    const approveBob = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'bob' });
    assert.equal(approveBob.status, 200);
  } finally {
    await ctx.close();
  }
});

test('exact error bodies for all five rotate failures (G56)', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await createResident(ctx, 'alice');
    const bob = await createResident(ctx, 'bob');
    const t0 = ctx.nowSec();

    const r1 = await kr235SignedRotate(ctx, { pubkey: undefined, privateKeyPem: alice.keys.privateKeyPem, timestamp: t0 });
    assert.equal(r1.status, 400);
    assert.deepEqual(r1.data, { error: 'missing_pubkey' });

    const r2 = await kr235SignedRotate(ctx, { pubkey: 'not-a-valid-ed25519-key', privateKeyPem: alice.keys.privateKeyPem, timestamp: t0 });
    assert.equal(r2.status, 400);
    assert.deepEqual(r2.data, { error: 'invalid_pubkey' });

    const r3 = await kr235SignedRotate(ctx, { pubkey: alice.keys.pubkey, privateKeyPem: alice.keys.privateKeyPem, timestamp: t0 });
    assert.equal(r3.status, 400);
    assert.deepEqual(r3.data, { error: 'same_pubkey' });

    const r4 = await kr235SignedRotate(ctx, { pubkey: bob.keys.pubkey, privateKeyPem: alice.keys.privateKeyPem, timestamp: t0 });
    assert.equal(r4.status, 409);
    assert.deepEqual(r4.data, { error: 'pubkey_taken' });

    let curKeys = alice.keys;
    for (let k = 0; k < 3; k++) {
      const nk = generateKeypair();
      const ok = await kr235SignedRotate(ctx, { pubkey: nk.pubkey, privateKeyPem: curKeys.privateKeyPem, timestamp: t0 });
      assert.equal(ok.status, 200);
      curKeys = nk;
    }

    const r5 = await kr235SignedRotate(ctx, { pubkey: generateKeypair().pubkey, privateKeyPem: curKeys.privateKeyPem, timestamp: t0 });
    assert.equal(r5.status, 429);
    assert.deepEqual(r5.data, { error: 'rate_limited', retry_after: 3600 });
  } finally {
    await ctx.close();
  }
});

test('key_history notes exact, ordered by id on tied created_at, and per-handle isolated (G57)', async () => {
  const ctx = await startTestServer();
  try {
    const alice = await createResident(ctx, 'alice');
    const bob = await createResident(ctx, 'bob');
    const t0 = ctx.nowSec();

    const nkA1 = generateKeypair();
    const rA1 = await kr235SignedRotate(ctx, { pubkey: nkA1.pubkey, privateKeyPem: alice.keys.privateKeyPem, timestamp: t0 });
    assert.equal(rA1.status, 200);

    const nkA2 = generateKeypair();
    const rA2 = await kr235SignedRotate(ctx, { pubkey: nkA2.pubkey, privateKeyPem: nkA1.privateKeyPem, timestamp: t0 });
    assert.equal(rA2.status, 200);

    const nkB = generateKeypair();
    const signedB = signRequest({ method: 'POST', path: '/api/town/key/rotate', body: { pubkey: nkB.pubkey }, handle: 'bob', privateKeyPem: bob.keys.privateKeyPem, timestamp: t0 });
    const resB = await fetch(`${ctx.baseUrl}/api/town/key/rotate`, { method: 'POST', headers: signedB.headers, body: signedB.rawBody });
    const dataB = await resB.json().catch(() => null);
    assert.equal(resB.status, 200);

    const aliceRows = ctx.db
      .prepare("SELECT action, note, created_at FROM key_history WHERE handle = 'alice' ORDER BY id ASC")
      .all();
    assert.deepEqual(
      aliceRows.map((r) => [r.action, r.note]),
      [
        ['register', 'joined'],
        ['rotate', 'self-service rotation'],
        ['rotate', 'self-service rotation'],
      ],
    );
    assert.equal(aliceRows[1].created_at, t0);
    assert.equal(aliceRows[2].created_at, t0);

    const bobRows = ctx.db
      .prepare("SELECT action, note FROM key_history WHERE handle = 'bob' ORDER BY id ASC")
      .all();
    assert.deepEqual(
      bobRows.map((r) => [r.action, r.note]),
      [
        ['register', 'joined'],
        ['rotate', 'self-service rotation'],
      ],
    );
  } finally {
    await ctx.close();
  }
});

test('same_pubkey is a string comparison rather than a byte comparison (G58)', async () => {
  const ctx = await startTestServer();
  try {
    const { client, keys } = await createResident(ctx, 'alice');
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const i = 42;
    const v = B64.indexOf(keys.pubkey[i]);
    const variant = keys.pubkey.slice(0, i) + B64[(v & ~3) | ((v + 1) & 3)] + keys.pubkey.slice(i + 1);

    assert.equal((await client.rotateKey(variant)).status, 200);

    const variantClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alice',
      pubkey: variant,
      privateKeyPem: keys.privateKeyPem,
    });
    const sameRes = await variantClient.rotateKey(variant);
    assert.equal(sameRes.status, 400);
    assert.deepEqual(sameRes.data, { error: 'same_pubkey' });

    assert.equal((await variantClient.rotateKey(keys.pubkey)).status, 200);
    assert.equal(ctx.db.prepare('SELECT pubkey FROM residents WHERE handle = ?').get('alice').pubkey, keys.pubkey);

    const actions = ctx.db
      .prepare("SELECT action FROM key_history WHERE handle = 'alice' ORDER BY id ASC")
      .all()
      .map((r) => r.action);
    assert.deepEqual(actions, ['register', 'rotate', 'rotate']);
  } finally {
    await ctx.close();
  }
});
