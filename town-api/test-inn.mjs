import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNAMBIGUOUS_KEY_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$/;
const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');
const NIGHT_SEC = 86400;

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-inn-test-'));
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

test('inn claim happy path, state exposure, default nights, and state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    const s0 = await alice.state();
    assert.equal(s0.status, 200);
    assert.deepEqual(s0.data.inn, { lantern: null, window: null, quiet: null });
    const seq0 = s0.data.state_seq;

    // Claim lantern for 2 nights
    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    assert.equal(claimRes.data.room, 'lantern');
    assert.equal(claimRes.data.handle, 'alice');
    assert.equal(claimRes.data.nights, 2);
    assert.equal(claimRes.data.expires_at, claimRes.data.claimed_at + 2 * NIGHT_SEC);
    assert.match(claimRes.data.key, UNAMBIGUOUS_KEY_RE);
    assert.ok(!/[0O1lI]/.test(claimRes.data.key), 'key must not contain ambiguous characters');

    const s1 = await alice.state();
    assert.equal(s1.status, 200);
    assert.ok(s1.data.state_seq > seq0, 'claim must bump state_seq');
    assert.deepEqual(s1.data.inn.lantern, {
      handle: 'alice',
      nights: 2,
      expires_at: claimRes.data.expires_at,
    });
    assert.equal(s1.data.inn.window, null);
    assert.equal(s1.data.inn.quiet, null);
    assert.ok(!JSON.stringify(s1.data).includes(claimRes.data.key), 'key must never appear in public state');
    assert.equal(Object.hasOwn(s1.data.inn.lantern, 'key_code'), false);
    assert.equal(Object.hasOwn(s1.data.inn.lantern, 'key'), false);

    // Default nights = 3 when omitted
    const bobClaim = await bob.claimInnRoom('window');
    assert.equal(bobClaim.status, 201);
    assert.equal(bobClaim.data.nights, 3);
    assert.equal(bobClaim.data.expires_at, bobClaim.data.claimed_at + 3 * NIGHT_SEC);
    assert.match(bobClaim.data.key, UNAMBIGUOUS_KEY_RE);
  } finally {
    await ctx.close();
  }
});

test('inn claim validation, conflicts, and pending resident gate', async () => {
  const ctx = await startTestServer();
  try {
    const { client: pending } = await createResident(ctx, 'pending_muse', { approved: false });
    const pendingRes = await pending.claimInnRoom('lantern', 2);
    assert.equal(pendingRes.status, 403);
    assert.equal(pendingRes.data.error, 'resident_not_active');

    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    // Unknown room -> 400
    const badRoom = await alice.claimInnRoom('attic', 2);
    assert.equal(badRoom.status, 400);

    // Nights outside 1-7 -> 400
    const zeroNights = await alice.claimInnRoom('lantern', 0);
    assert.equal(zeroNights.status, 400);
    const eightNights = await alice.claimInnRoom('lantern', 8);
    assert.equal(eightNights.status, 400);
    const nullNights = await alice.claimInnRoom('lantern', null);
    assert.equal(nullNights.status, 400);

    // Valid claim
    const okClaim = await alice.claimInnRoom('lantern', 3);
    assert.equal(okClaim.status, 201);

    // Second claim on same room by another resident -> 409
    const dupRoom = await bob.claimInnRoom('lantern', 2);
    assert.equal(dupRoom.status, 409);

    // Second room by same resident -> 409
    const secondRoom = await alice.claimInnRoom('quiet', 2);
    assert.equal(secondRoom.status, 409);
  } finally {
    await ctx.close();
  }
});

test('inn extend and vacate happy paths, error cases, and state_seq', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    // Extend / vacate with no claim -> 404
    const extMissing = await alice.extendInnStay('lantern', 'AAAAAAAAAAAA', 1);
    assert.equal(extMissing.status, 404);
    const vacMissing = await alice.vacateInnRoom('lantern', 'AAAAAAAAAAAA');
    assert.equal(vacMissing.status, 404);

    const claimRes = await alice.claimInnRoom('quiet', 4);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;
    const seqAfterClaim = (await alice.state()).data.state_seq;

    // Extend with wrong key -> 403
    const extWrongKey = await alice.extendInnStay('quiet', 'WRONGKEY1234', 1);
    assert.equal(extWrongKey.status, 403);

    // Extend past 7 total nights (4 + 4 = 8) -> 400
    const extTooLong = await alice.extendInnStay('quiet', key, 4);
    assert.equal(extTooLong.status, 400);

    // Extend happy path (4 + 3 = 7) -> 200
    const extOk = await alice.extendInnStay('quiet', key, 3);
    assert.equal(extOk.status, 200);
    assert.equal(extOk.data.room, 'quiet');
    assert.equal(extOk.data.handle, 'alice');
    assert.equal(extOk.data.nights, 7);
    assert.equal(extOk.data.expires_at, claimRes.data.claimed_at + 7 * NIGHT_SEC);

    const seqAfterExtend = (await alice.state()).data.state_seq;
    assert.ok(seqAfterExtend > seqAfterClaim, 'extend must bump state_seq');

    // Vacate with wrong key -> 403 and room stays claimed
    const vacWrongKey = await alice.vacateInnRoom('quiet', 'WRONGKEY1234');
    assert.equal(vacWrongKey.status, 403);
    const stateStillClaimed = await alice.state();
    assert.equal(stateStillClaimed.data.inn.quiet.handle, 'alice');

    // Vacate happy path -> 200 and room freed
    const vacOk = await alice.vacateInnRoom('quiet', key);
    assert.equal(vacOk.status, 200);
    assert.equal(vacOk.data.room, 'quiet');
    assert.equal(vacOk.data.handle, 'alice');
    assert.equal(vacOk.data.vacated, true);
    assert.ok(vacOk.data.state_seq > seqAfterExtend, 'vacate must bump state_seq');

    const stateAfterVacate = await alice.state();
    assert.equal(stateAfterVacate.data.inn.quiet, null);
  } finally {
    await ctx.close();
  }
});

test('inn expiry prunes on state read without bumping state_seq and room is immediately re-claimable', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const claimRes = await alice.claimInnRoom('window', 1);
    assert.equal(claimRes.status, 201);

    const sBefore = await alice.state();
    const seqBeforeExpiry = sBefore.data.state_seq;
    assert.equal(sBefore.data.inn.window.handle, 'alice');

    // Advance clock past 1 night
    ctx.advanceClock(NIGHT_SEC + 10);

    const sAfter = await (await fetch(`${ctx.baseUrl}/api/town/state`)).json();
    assert.equal(sAfter.inn.window, null, 'expired claim must be pruned on state read');
    assert.equal(sAfter.state_seq, seqBeforeExpiry, 'prune-only read must NOT bump state_seq');

    // Room is immediately claimable again (sign at server's advanced clock)
    const { rawBody, headers } = signRequest({
      method: 'POST',
      path: '/api/town/inn/claim',
      body: { room: 'window', nights: 2 },
      handle: 'bob',
      privateKeyPem: bobKeys.privateKeyPem,
      timestamp: ctx.nowSec(),
    });
    const bobRes = await fetch(`${ctx.baseUrl}/api/town/inn/claim`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
    const bobClaimData = await bobRes.json();
    assert.equal(bobRes.status, 201);
    assert.equal(bobClaimData.handle, 'bob');
  } finally {
    await ctx.close();
  }
});

test('no banned term in inn test file', () => {
  const selfSrc = fs.readFileSync(path.join(__dirname, 'test-inn.mjs'), 'utf8');
  assert.ok(!BANNED_TERM_RE.test(selfSrc), 'test-inn.mjs must not contain banned term');
});
