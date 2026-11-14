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

test('no banned term in key-rotate test file', () => {
  const selfSrc = fs.readFileSync(path.join(__dirname, 'test-key-rotate.mjs'), 'utf8');
  assert.ok(!BANNED_TERM_RE.test(selfSrc), 'test-key-rotate.mjs must not contain banned term');
});
