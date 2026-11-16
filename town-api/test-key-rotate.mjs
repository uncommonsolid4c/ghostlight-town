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

    // Joined-but-unapproved resident -> 403 resident_not_active (resident_status: 'pending')
    const { client: pendingClient } = await createResident(ctx, 'pending_muse', { approved: false });
    const pendingRes = await pendingClient.rotateKey(generateKeypair().pubkey);
    assert.equal(pendingRes.status, 403);
    assert.equal(pendingRes.data.error, 'resident_not_active');
    assert.equal(pendingRes.data.resident_status, 'pending');

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

test('no banned term in key-rotate test file', () => {
  const selfSrc = fs.readFileSync(path.join(__dirname, 'test-key-rotate.mjs'), 'utf8');
  assert.ok(!BANNED_TERM_RE.test(selfSrc), 'test-key-rotate.mjs must not contain banned term');
});
