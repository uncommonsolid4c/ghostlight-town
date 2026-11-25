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
  } else {
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run(handle);
  }
  return { client, keys };
}

async function signedPostAt(ctx, handle, keys, endpoint, payload) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle,
    privateKeyPem: keys.privateKeyPem,
    timestamp: ctx.nowSec(),
  });
  const res = await fetch(`${ctx.baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
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
      guest: false,
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

test('inn claim validation, conflicts, and suspended resident gate', async () => {
  const ctx = await startTestServer();
  try {
    const { client: suspended } = await createResident(ctx, 'suspended_muse', { approved: false });
    const suspendedRes = await suspended.claimInnRoom('lantern', 2);
    assert.equal(suspendedRes.status, 403);
    assert.equal(suspendedRes.data.error, 'resident_not_active');
    assert.equal(suspendedRes.data.resident_status, 'suspended');

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

test('inn claim keys are unique across claims', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    const c1 = await alice.claimInnRoom('lantern', 2);
    assert.equal(c1.status, 201);
    assert.match(c1.data.key, UNAMBIGUOUS_KEY_RE);

    const c2 = await bob.claimInnRoom('window', 2);
    assert.equal(c2.status, 201);
    assert.match(c2.data.key, UNAMBIGUOUS_KEY_RE);

    assert.notEqual(c1.data.key, c2.data.key);
  } finally {
    await ctx.close();
  }
});

test('inn claim nights bounds and type validation edges', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    // Missing room (undefined) -> 400 invalid_room
    const missingRoom = await alice.claimInnRoom(undefined, 2);
    assert.equal(missingRoom.status, 400);
    assert.equal(missingRoom.data.error, 'invalid_room');

    // String and float nights -> 400 invalid_nights
    const strNights = await alice.claimInnRoom('lantern', '2');
    assert.equal(strNights.status, 400);
    assert.equal(strNights.data.error, 'invalid_nights');

    const floatNights = await alice.claimInnRoom('lantern', 2.5);
    assert.equal(floatNights.status, 400);
    assert.equal(floatNights.data.error, 'invalid_nights');

    // Boundary nights 1 and 7 -> 201
    const oneNight = await alice.claimInnRoom('lantern', 1);
    assert.equal(oneNight.status, 201);
    assert.equal(oneNight.data.nights, 1);

    const sevenNights = await bob.claimInnRoom('window', 7);
    assert.equal(sevenNights.status, 201);
    assert.equal(sevenNights.data.nights, 7);
  } finally {
    await ctx.close();
  }
});

test('expired inn claim prunes inside extend and vacate handlers with no prior state read', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 1);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;

    ctx.advanceClock(NIGHT_SEC + 10);

    const extRes = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/extend', {
      room: 'lantern',
      key,
      extra_nights: 1,
    });
    assert.equal(extRes.status, 404);
    assert.equal(extRes.data.error, 'claim_not_found');

    const vacRes = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/vacate', {
      room: 'lantern',
      key,
    });
    assert.equal(vacRes.status, 404);
    assert.equal(vacRes.data.error, 'claim_not_found');
  } finally {
    await ctx.close();
  }
});

test('expired inn claim self-prunes inside claim handler before conflict check', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const aliceClaim = await alice.claimInnRoom('quiet', 1);
    assert.equal(aliceClaim.status, 201);

    ctx.advanceClock(NIGHT_SEC + 10);

    // No state read in between: claim handler itself must prune before 409 check
    const bobClaim = await signedPostAt(ctx, 'bob', bobKeys, '/api/town/inn/claim', {
      room: 'quiet',
      nights: 2,
    });
    assert.equal(bobClaim.status, 201);
    assert.equal(bobClaim.data.handle, 'bob');
    assert.equal(bobClaim.data.room, 'quiet');
  } finally {
    await ctx.close();
  }
});

test('inn key-is-the-credential: another resident can extend and vacate with the room key', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const aliceKey = claimRes.data.key;

    // Bob extends Alice's room using Alice's key -> 200 (key-only check)
    const bobExtend = await bob.extendInnStay('lantern', aliceKey, 2);
    assert.equal(bobExtend.status, 200);
    assert.equal(bobExtend.data.handle, 'alice');
    assert.equal(bobExtend.data.nights, 4);

    // Bob vacates Alice's room using Alice's key -> 200 and room is freed
    const bobVacate = await bob.vacateInnRoom('lantern', aliceKey);
    assert.equal(bobVacate.status, 200);
    assert.equal(bobVacate.data.handle, 'alice');
    assert.equal(bobVacate.data.vacated, true);

    const s = await alice.state();
    assert.equal(s.data.inn.lantern, null);
  } finally {
    await ctx.close();
  }
});

test('inn extend validation edges for extra_nights, missing key, and unknown room', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const claimRes = await alice.claimInnRoom('window', 2);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;

    for (const badExtra of [0, 8, 2.5, '1', undefined]) {
      const res = await alice.extendInnStay('window', key, badExtra);
      assert.equal(res.status, 400, `extra_nights=${String(badExtra)} should return 400`);
      assert.equal(res.data.error, 'invalid_extra_nights');
    }

    const emptyKey = await alice.extendInnStay('window', '', 1);
    assert.equal(emptyKey.status, 400);
    assert.equal(emptyKey.data.error, 'missing_key');

    const badRoom = await alice.extendInnStay('attic', key, 1);
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data.error, 'invalid_room');
  } finally {
    await ctx.close();
  }
});

test('inn-claim rate limit (10/hour) is consumed by 409 conflicts and shared with extend', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const first = await alice.claimInnRoom('lantern', 2);
    assert.equal(first.status, 201);
    const key = first.data.key;

    // 9 more claim attempts (409 resident_already_claimed) consume the remaining 9/10 slots
    for (let i = 0; i < 9; i += 1) {
      const conflict = await alice.claimInnRoom('window', 2);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.error, 'resident_already_claimed');
    }

    // 11th attempt (claim) -> 429 rate_limited
    const limitedClaim = await alice.claimInnRoom('quiet', 2);
    assert.equal(limitedClaim.status, 429);
    assert.equal(limitedClaim.data.error, 'rate_limited');

    // Shared bucket: extend by same handle also -> 429 rate_limited
    const limitedExtend = await alice.extendInnStay('lantern', key, 1);
    assert.equal(limitedExtend.status, 429);
    assert.equal(limitedExtend.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('re-claim after vacate issues a new key', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const first = await alice.claimInnRoom('lantern', 2);
    assert.equal(first.status, 201);
    assert.match(first.data.key, UNAMBIGUOUS_KEY_RE);

    const vac = await alice.vacateInnRoom('lantern', first.data.key);
    assert.equal(vac.status, 200);

    const second = await alice.claimInnRoom('lantern', 3);
    assert.equal(second.status, 201);
    assert.match(second.data.key, UNAMBIGUOUS_KEY_RE);
    assert.notEqual(second.data.key, first.data.key);
  } finally {
    await ctx.close();
  }
});

test('inn claim conflict error strings and room-before-resident precedence', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');
    const { client: carol } = await createResident(ctx, 'carol');

    const aliceLantern = await alice.claimInnRoom('lantern', 2);
    assert.equal(aliceLantern.status, 201);

    const bobLantern = await bob.claimInnRoom('lantern', 2);
    assert.equal(bobLantern.status, 409);
    assert.equal(bobLantern.data.error, 'room_already_claimed');

    const bobWindow = await bob.claimInnRoom('window', 2);
    assert.equal(bobWindow.status, 201);

    // Room check precedes resident check: alice holds lantern, but window is taken
    const aliceWindow = await alice.claimInnRoom('window', 2);
    assert.equal(aliceWindow.status, 409);
    assert.equal(aliceWindow.data.error, 'room_already_claimed');

    const aliceQuiet = await alice.claimInnRoom('quiet', 2);
    assert.equal(aliceQuiet.status, 409);
    assert.equal(aliceQuiet.data.error, 'resident_already_claimed');

    const carolQuiet = await carol.claimInnRoom('quiet', 2);
    assert.equal(carolQuiet.status, 201);
  } finally {
    await ctx.close();
  }
});

test('inn claim validation failures do not consume the rate-limit bucket', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const invalids = [
      ['attic', 2],
      ['attic', 3],
      ['lantern', 0],
      ['lantern', 8],
      ['lantern', '2'],
      ['lantern', 2.5],
      ['lantern', null],
      ['lantern', -1],
      ['lantern', 7.5],
      ['lantern', true],
    ];
    for (const [room, nights] of invalids) {
      const res = await alice.claimInnRoom(room, nights);
      assert.equal(res.status, 400, `expected 400 for room=${room} nights=${String(nights)}`);
    }

    const ok = await alice.claimInnRoom('lantern', 2);
    assert.equal(ok.status, 201);

    for (let i = 0; i < 9; i += 1) {
      const conflict = await alice.claimInnRoom('window', 2);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.error, 'resident_already_claimed');
    }

    const limited = await alice.claimInnRoom('quiet', 2);
    assert.equal(limited.status, 429);
    assert.equal(limited.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('inn vacate validation edges and claim_not_found error strings', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('window', 2);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;

    const emptyKey = await alice.vacateInnRoom('window', '');
    assert.equal(emptyKey.status, 400);
    assert.equal(emptyKey.data.error, 'missing_key');

    const nonStringKey = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/vacate', {
      room: 'window',
      key: 123,
    });
    assert.equal(nonStringKey.status, 400);
    assert.equal(nonStringKey.data.error, 'missing_key');

    const badRoom = await alice.vacateInnRoom('attic', key);
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data.error, 'invalid_room');

    const wrongKey = await alice.vacateInnRoom('window', 'WRONGKEY1234');
    assert.equal(wrongKey.status, 403);
    assert.equal(wrongKey.data.error, 'invalid_key');

    const vacMissing = await alice.vacateInnRoom('quiet', key);
    assert.equal(vacMissing.status, 404);
    assert.equal(vacMissing.data.error, 'claim_not_found');

    const extMissing = await alice.extendInnStay('quiet', key, 1);
    assert.equal(extMissing.status, 404);
    assert.equal(extMissing.data.error, 'claim_not_found');
  } finally {
    await ctx.close();
  }
});

test('inn extend error strings, claimed_at preserved, state_seq in responses', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 4);
    assert.equal(claimRes.status, 201);
    assert.equal(typeof claimRes.data.state_seq, 'number');
    const sAfterClaim = await alice.state();
    assert.equal(sAfterClaim.data.state_seq, claimRes.data.state_seq);

    const key = claimRes.data.key;
    const claimedAt = claimRes.data.claimed_at;

    const wrongKey = await alice.extendInnStay('lantern', 'WRONGKEY1234', 1);
    assert.equal(wrongKey.status, 403);
    assert.equal(wrongKey.data.error, 'invalid_key');

    const tooLong = await alice.extendInnStay('lantern', key, 4);
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'max_stay_exceeded');

    const extOk = await alice.extendInnStay('lantern', key, 3);
    assert.equal(extOk.status, 200);
    assert.equal(extOk.data.claimed_at, claimedAt);
    assert.equal(extOk.data.nights, 7);
    assert.equal(extOk.data.expires_at, claimedAt + 7 * NIGHT_SEC);
    assert.equal(typeof extOk.data.state_seq, 'number');

    const sAfterExtend = await alice.state();
    assert.equal(sAfterExtend.data.state_seq, extOk.data.state_seq);
  } finally {
    await ctx.close();
  }
});

test('all three inn rooms claimed at once, key never in state, claimed_at fresh', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');
    const { client: carol } = await createResident(ctx, 'carol');
    const { client: dave } = await createResident(ctx, 'dave');

    const before = Math.floor(Date.now() / 1000);
    const c1 = await alice.claimInnRoom('lantern', 2);
    const c2 = await bob.claimInnRoom('window', 3);
    const c3 = await carol.claimInnRoom('quiet', 1);
    const after = Math.floor(Date.now() / 1000);

    for (const c of [c1, c2, c3]) {
      assert.equal(c.status, 201);
      assert.ok(c.data.claimed_at >= before && c.data.claimed_at <= after);
    }

    const s = await alice.state();
    assert.equal(s.status, 200);
    assert.deepEqual(s.data.inn.lantern, {
      handle: 'alice',
      nights: 2,
      expires_at: c1.data.expires_at,
      guest: false,
    });
    assert.deepEqual(s.data.inn.window, {
      handle: 'bob',
      nights: 3,
      expires_at: c2.data.expires_at,
      guest: false,
    });
    assert.deepEqual(s.data.inn.quiet, {
      handle: 'carol',
      nights: 1,
      expires_at: c3.data.expires_at,
      guest: false,
    });

    const stateJson = JSON.stringify(s.data);
    assert.ok(!stateJson.includes(c1.data.key));
    assert.ok(!stateJson.includes(c2.data.key));
    assert.ok(!stateJson.includes(c3.data.key));

    const daveClaim = await dave.claimInnRoom('lantern', 2);
    assert.equal(daveClaim.status, 409);
    assert.equal(daveClaim.data.error, 'room_already_claimed');
  } finally {
    await ctx.close();
  }
});

test('inn auth failures: missing headers, unknown resident, bad signature, stale timestamp, suspended', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    const { client: suspended } = await createResident(ctx, 'suspended_guest', { approved: false });

    const setup = await alice.claimInnRoom('lantern', 2);
    assert.equal(setup.status, 201);

    // Unsigned POST -> 401 missing_auth_headers
    const unsignedRes = await fetch(`${ctx.baseUrl}/api/town/inn/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: 'window', nights: 2 }),
    });
    const unsignedData = await unsignedRes.json();
    assert.equal(unsignedRes.status, 401);
    assert.equal(unsignedData.error, 'missing_auth_headers');

    // Unknown resident -> 401 unknown_resident
    const unknownRes = await signedPostAt(ctx, 'ghost', generateKeypair(), '/api/town/inn/claim', {
      room: 'window',
      nights: 2,
    });
    assert.equal(unknownRes.status, 401);
    assert.equal(unknownRes.data.error, 'unknown_resident');

    // Bad signature (wrong keypair for alice) -> 401 invalid_signature
    const badSigRes = await signedPostAt(ctx, 'alice', generateKeypair(), '/api/town/inn/claim', {
      room: 'window',
      nights: 2,
    });
    assert.equal(badSigRes.status, 401);
    assert.equal(badSigRes.data.error, 'invalid_signature');

    // Stale timestamp -> 401 stale_timestamp
    const { rawBody, headers } = signRequest({
      method: 'POST',
      path: '/api/town/inn/claim',
      body: { room: 'window', nights: 2 },
      handle: 'alice',
      privateKeyPem: aliceKeys.privateKeyPem,
      timestamp: ctx.nowSec() - 1000,
    });
    const staleRes = await fetch(`${ctx.baseUrl}/api/town/inn/claim`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
    const staleData = await staleRes.json();
    assert.equal(staleRes.status, 401);
    assert.equal(staleData.error, 'stale_timestamp');

    // Suspended resident extend & vacate -> 403 resident_not_active
    const suspendedExt = await suspended.extendInnStay('lantern', 'AAAAAAAAAAAA', 1);
    assert.equal(suspendedExt.status, 403);
    assert.equal(suspendedExt.data.error, 'resident_not_active');
    assert.equal(suspendedExt.data.resident_status, 'suspended');

    const suspendedVac = await suspended.vacateInnRoom('lantern', 'AAAAAAAAAAAA');
    assert.equal(suspendedVac.status, 403);
    assert.equal(suspendedVac.data.error, 'resident_not_active');
    assert.equal(suspendedVac.data.resident_status, 'suspended');
  } finally {
    await ctx.close();
  }
});

test('inn claim, extend, and vacate responses carry exact key sets and state_seq equals live state', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    assert.deepEqual(
      Object.keys(claimRes.data).sort(),
      ['claimed_at', 'expires_at', 'handle', 'key', 'nights', 'room', 'state_seq'],
    );
    const s1 = await alice.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.state_seq, claimRes.data.state_seq);

    const extRes = await alice.extendInnStay('lantern', claimRes.data.key, 1);
    assert.equal(extRes.status, 200);
    assert.deepEqual(
      Object.keys(extRes.data).sort(),
      ['claimed_at', 'expires_at', 'handle', 'nights', 'room', 'state_seq'],
    );
    const s2 = await alice.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.state_seq, extRes.data.state_seq);

    const vacRes = await alice.vacateInnRoom('lantern', claimRes.data.key);
    assert.equal(vacRes.status, 200);
    assert.deepEqual(
      Object.keys(vacRes.data).sort(),
      ['handle', 'room', 'state_seq', 'vacated'],
    );
    assert.equal(vacRes.data.vacated, true);
    const s3 = await alice.state();
    assert.equal(s3.status, 200);
    assert.equal(s3.data.state_seq, vacRes.data.state_seq);
  } finally {
    await ctx.close();
  }
});

test('inn vacate does not consume the inn-claim rate-limit bucket', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;

    for (let i = 0; i < 9; i += 1) {
      const conflict = await alice.claimInnRoom('window', 2);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.error, 'resident_already_claimed');
    }

    const limited = await alice.claimInnRoom('quiet', 2);
    assert.equal(limited.status, 429);
    assert.equal(limited.data.error, 'rate_limited');
    assert.equal(typeof limited.data.retry_after, 'number');
    assert.ok(limited.data.retry_after > 0 && limited.data.retry_after <= 3600);

    const vacRes = await alice.vacateInnRoom('lantern', key);
    assert.equal(vacRes.status, 200);

    const stillLimited = await alice.claimInnRoom('quiet', 2);
    assert.equal(stillLimited.status, 429);
    assert.equal(stillLimited.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('muted resident may claim the Inn; suspended resident may not claim, extend, or vacate', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = ?").run('alice');
    const aliceClaim = await alice.claimInnRoom('lantern', 2);
    assert.equal(aliceClaim.status, 201);
    const key = aliceClaim.data.key;

    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('bob');
    const bobClaim = await bob.claimInnRoom('window', 2);
    assert.equal(bobClaim.status, 403);
    assert.equal(bobClaim.data.error, 'resident_not_active');
    assert.equal(bobClaim.data.resident_status, 'suspended');

    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('alice');
    const suspExt = await alice.extendInnStay('lantern', key, 1);
    assert.equal(suspExt.status, 403);
    assert.equal(suspExt.data.error, 'resident_not_active');

    const suspVac = await alice.vacateInnRoom('lantern', key);
    assert.equal(suspVac.status, 403);
    assert.equal(suspVac.data.error, 'resident_not_active');

    const s = await alice.state();
    assert.equal(s.status, 200);
    assert.equal(s.data.inn.lantern.handle, 'alice');

    ctx.db.prepare("UPDATE residents SET status = 'active' WHERE handle = ?").run('alice');
    const okVac = await alice.vacateInnRoom('lantern', key);
    assert.equal(okVac.status, 200);
  } finally {
    await ctx.close();
  }
});

test('inn-claim rate-limit window resets after one hour', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;

    for (let i = 0; i < 9; i += 1) {
      const conflict = await alice.claimInnRoom('window', 2);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.error, 'resident_already_claimed');
    }

    const limited = await alice.claimInnRoom('quiet', 2);
    assert.equal(limited.status, 429);
    assert.equal(limited.data.error, 'rate_limited');

    ctx.advanceClock(3601);

    const vacRes = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/vacate', {
      room: 'lantern',
      key,
    });
    assert.equal(vacRes.status, 200);

    const afterReset = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/claim', {
      room: 'window',
      nights: 2,
    });
    assert.equal(afterReset.status, 201);
    assert.equal(afterReset.data.room, 'window');
  } finally {
    await ctx.close();
  }
});

test('inn extend validation order: room beats key beats extra_nights; already-7-nights extend hits max_stay_exceeded', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 7);
    assert.equal(claimRes.status, 201);
    assert.equal(claimRes.data.nights, 7);
    const key = claimRes.data.key;

    const badRoom = await alice.extendInnStay('attic', '', 99);
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data.error, 'invalid_room');

    const badKey = await alice.extendInnStay('lantern', '', 99);
    assert.equal(badKey.status, 400);
    assert.equal(badKey.data.error, 'missing_key');

    const badExtra = await alice.extendInnStay('lantern', key, 0);
    assert.equal(badExtra.status, 400);
    assert.equal(badExtra.data.error, 'invalid_extra_nights');

    const tooLong = await alice.extendInnStay('lantern', key, 1);
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'max_stay_exceeded');

    const s = await alice.state();
    assert.equal(s.status, 200);
    assert.equal(s.data.inn.lantern.nights, 7);
  } finally {
    await ctx.close();
  }
});

test('expired claim re-claimed by another resident: old key is invalid for extend and vacate', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');
    const { keys: bobKeys } = await createResident(ctx, 'bob');

    const aliceClaim = await alice.claimInnRoom('lantern', 1);
    assert.equal(aliceClaim.status, 201);
    const oldKey = aliceClaim.data.key;

    ctx.advanceClock(NIGHT_SEC + 10);

    const bobClaim = await signedPostAt(ctx, 'bob', bobKeys, '/api/town/inn/claim', {
      room: 'lantern',
      nights: 2,
    });
    assert.equal(bobClaim.status, 201);
    assert.notEqual(bobClaim.data.key, oldKey);

    const oldExt = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/extend', {
      room: 'lantern',
      key: oldKey,
      extra_nights: 1,
    });
    assert.equal(oldExt.status, 403);
    assert.equal(oldExt.data.error, 'invalid_key');

    const oldVac = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/vacate', {
      room: 'lantern',
      key: oldKey,
    });
    assert.equal(oldVac.status, 403);
    assert.equal(oldVac.data.error, 'invalid_key');

    const s = await alice.state();
    assert.equal(s.status, 200);
    assert.equal(s.data.inn.lantern.handle, 'bob');
    assert.equal(s.data.inn.lantern.nights, 2);
  } finally {
    await ctx.close();
  }
});

test('no banned term in inn test file', () => {
  const selfSrc = fs.readFileSync(path.join(__dirname, 'test-inn.mjs'), 'utf8');
  assert.ok(!BANNED_TERM_RE.test(selfSrc), 'test-inn.mjs must not contain banned term');
});

async function startRestartableServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-inn-restart-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const nowFn = () => Math.floor(Date.now() / 1000) + clockOffset;
  let currentServer = null;
  let baseUrl = null;

  async function boot() {
    const { server, db } = createTownServer({
      dbPath,
      plotsDir,
      operatorPubkey: operatorKeys.pubkey,
      nowFn,
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    currentServer = server;
    baseUrl = `http://127.0.0.1:${port}`;
    return { server, db, baseUrl };
  }

  async function closeServer() {
    if (!currentServer) return;
    const srv = currentServer;
    currentServer = null;
    await new Promise((resolve) => srv.close(resolve));
  }

  await boot();

  return {
    get baseUrl() {
      return baseUrl;
    },
    operatorKeys,
    boot,
    closeServer,
    async close() {
      await closeServer();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

test('inn expiry boundary exact: alive at expires_at - 1, pruned at expires_at without state_seq bump', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 1);
    assert.equal(claimRes.status, 201);

    const toExpiryMinus1 = claimRes.data.claimed_at + NIGHT_SEC - 1 - ctx.nowSec();
    if (toExpiryMinus1 > 0) {
      ctx.advanceClock(toExpiryMinus1);
    }

    const sAlive = await alice.state();
    assert.equal(sAlive.status, 200);
    assert.ok(sAlive.data.inn.lantern !== null);
    assert.equal(sAlive.data.inn.lantern.handle, 'alice');
    const seqBeforeExpiry = sAlive.data.state_seq;

    ctx.advanceClock(1);

    const sPruned = await alice.state();
    assert.equal(sPruned.status, 200);
    assert.equal(sPruned.data.inn.lantern, null);
    assert.equal(sPruned.data.state_seq, seqBeforeExpiry);
  } finally {
    await ctx.close();
  }
});

test('inn state_seq increments by exact +1 on mutations and stays unchanged on failures', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    const s0 = await alice.state();
    assert.equal(s0.status, 200);
    const seq0 = s0.data.state_seq;

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;

    const s1 = await alice.state();
    assert.equal(s1.data.state_seq, seq0 + 1);

    const badRoom = await alice.claimInnRoom('attic', 2);
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data.error, 'invalid_room');
    assert.equal((await alice.state()).data.state_seq, seq0 + 1);

    const conflict = await bob.claimInnRoom('lantern', 2);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error, 'room_already_claimed');
    assert.equal((await alice.state()).data.state_seq, seq0 + 1);

    const wrongKey = await alice.extendInnStay('lantern', 'WRONGKEY1234', 1);
    assert.equal(wrongKey.status, 403);
    assert.equal(wrongKey.data.error, 'invalid_key');
    assert.equal((await alice.state()).data.state_seq, seq0 + 1);

    const notFound = await alice.extendInnStay('quiet', key, 1);
    assert.equal(notFound.status, 404);
    assert.equal(notFound.data.error, 'claim_not_found');
    assert.equal((await alice.state()).data.state_seq, seq0 + 1);

    const extRes = await alice.extendInnStay('lantern', key, 1);
    assert.equal(extRes.status, 200);
    assert.equal((await alice.state()).data.state_seq, seq0 + 2);

    const vacRes = await alice.vacateInnRoom('lantern', key);
    assert.equal(vacRes.status, 200);
    assert.equal((await alice.state()).data.state_seq, seq0 + 3);
  } finally {
    await ctx.close();
  }
});

test('inn extend 404 consumes rate-limit bucket while vacate bypasses an exhausted bucket', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;

    for (let i = 0; i < 8; i += 1) {
      const conflict = await alice.claimInnRoom('window', 2);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.error, 'resident_already_claimed');
    }

    const ext404 = await alice.extendInnStay('quiet', 'AAAAAAAAAAAA', 1);
    assert.equal(ext404.status, 404);
    assert.equal(ext404.data.error, 'claim_not_found');

    const seqBefore429 = (await alice.state()).data.state_seq;

    const limited = await alice.claimInnRoom('quiet', 2);
    assert.equal(limited.status, 429);
    assert.equal(limited.data.error, 'rate_limited');
    assert.equal(typeof limited.data.retry_after, 'number');
    assert.ok(limited.data.retry_after > 0 && limited.data.retry_after <= 3600);
    assert.equal((await alice.state()).data.state_seq, seqBefore429);

    const vacOk = await alice.vacateInnRoom('lantern', key);
    assert.equal(vacOk.status, 200);
    assert.equal(vacOk.data.vacated, true);

    const vac404 = await alice.vacateInnRoom('quiet', key);
    assert.equal(vac404.status, 404);
    assert.equal(vac404.data.error, 'claim_not_found');
  } finally {
    await ctx.close();
  }
});

test('pending resident is rejected on inn claim, extend, and vacate', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    ctx.db.prepare("UPDATE residents SET status = 'pending' WHERE handle = ?").run('alice');

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 403);
    assert.equal(claimRes.data.error, 'resident_not_active');
    assert.equal(claimRes.data.resident_status, 'pending');

    const extRes = await alice.extendInnStay('lantern', 'AAAAAAAAAAAA', 1);
    assert.equal(extRes.status, 403);
    assert.equal(extRes.data.error, 'resident_not_active');
    assert.equal(extRes.data.resident_status, 'pending');

    const vacRes = await alice.vacateInnRoom('lantern', 'AAAAAAAAAAAA');
    assert.equal(vacRes.status, 403);
    assert.equal(vacRes.data.error, 'resident_not_active');
    assert.equal(vacRes.data.resident_status, 'pending');
  } finally {
    await ctx.close();
  }
});

test('inn cross-room key misuse is rejected and leaves state unchanged', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');

    const aClaim = await alice.claimInnRoom('lantern', 2);
    assert.equal(aClaim.status, 201);
    const keyA = aClaim.data.key;

    const bClaim = await bob.claimInnRoom('window', 2);
    assert.equal(bClaim.status, 201);
    const keyB = bClaim.data.key;

    const aliceVacWindow = await alice.vacateInnRoom('window', keyA);
    assert.equal(aliceVacWindow.status, 403);
    assert.equal(aliceVacWindow.data.error, 'invalid_key');

    const bobExtLantern = await bob.extendInnStay('lantern', keyB, 1);
    assert.equal(bobExtLantern.status, 403);
    assert.equal(bobExtLantern.data.error, 'invalid_key');

    const aliceExtWindow = await alice.extendInnStay('window', keyA, 1);
    assert.equal(aliceExtWindow.status, 403);
    assert.equal(aliceExtWindow.data.error, 'invalid_key');

    const s = await alice.state();
    assert.equal(s.status, 200);
    assert.equal(s.data.inn.lantern.handle, 'alice');
    assert.equal(s.data.inn.lantern.nights, 2);
    assert.equal(s.data.inn.window.handle, 'bob');
    assert.equal(s.data.inn.window.nights, 2);
  } finally {
    await ctx.close();
  }
});

test('resident and guest share inn_claims conflicts and key-is-the-credential vacate across modes', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');
    const guestKeys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'inn-guest', ...guestKeys });
    const otherGuestKeys = generateKeypair();
    const otherGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'other-guest', ...otherGuestKeys });

    const gClaim = await guest.guestInnClaim('quiet', 3);
    assert.equal(gClaim.status, 201);
    const guestKey = gClaim.data.key;

    const aliceQuiet = await alice.claimInnRoom('quiet', 2);
    assert.equal(aliceQuiet.status, 409);
    assert.equal(aliceQuiet.data.error, 'room_already_claimed');

    const bobLantern = await bob.claimInnRoom('lantern', 2);
    assert.equal(bobLantern.status, 201);

    const otherGuestLantern = await otherGuest.guestInnClaim('lantern', 2);
    assert.equal(otherGuestLantern.status, 409);
    assert.equal(otherGuestLantern.data.error, 'room_already_claimed');

    const s = await alice.state();
    assert.equal(s.status, 200);
    assert.equal(s.data.inn.quiet.guest, true);
    assert.equal(s.data.inn.quiet.handle, 'inn-guest');
    assert.equal(s.data.inn.lantern.guest, false);
    assert.equal(s.data.inn.lantern.handle, 'bob');

    const crossVac = await alice.vacateInnRoom('quiet', guestKey);
    assert.equal(crossVac.status, 200);
    assert.equal(crossVac.data.handle, 'inn-guest');
    assert.equal(crossVac.data.vacated, true);

    const gVacAfter = await guest.guestInnVacate('quiet', guestKey);
    assert.equal(gVacAfter.status, 404);
    assert.equal(gVacAfter.data.error, 'claim_not_found');
  } finally {
    await ctx.close();
  }
});

test('inn claim and key survive server restart', async () => {
  const srv = await startRestartableServer();
  try {
    const aliceKeys = generateKeypair();
    const alice1 = new GhostlightClient({ baseUrl: srv.baseUrl, handle: 'alice', ...aliceKeys });
    const joinRes = await alice1.join({ origin: 'musebook' });
    assert.equal(joinRes.status, 201);
    const appRes = await adminPost(srv.baseUrl, srv.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });
    assert.equal(appRes.status, 200);

    const claimRes = await alice1.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const { key, claimed_at: claimedAt } = claimRes.data;
    const seqBefore = (await alice1.state()).data.state_seq;

    await srv.closeServer();
    await srv.boot();

    const alice2 = new GhostlightClient({ baseUrl: srv.baseUrl, handle: 'alice', ...aliceKeys });
    const sAfter = await alice2.state();
    assert.equal(sAfter.status, 200);
    assert.equal(sAfter.data.inn.lantern.handle, 'alice');
    assert.equal(sAfter.data.inn.lantern.nights, 2);
    assert.ok(sAfter.data.state_seq >= seqBefore);

    const extRes = await alice2.extendInnStay('lantern', key, 1);
    assert.equal(extRes.status, 200);
    assert.equal(extRes.data.nights, 3);
    assert.equal(extRes.data.claimed_at, claimedAt);
  } finally {
    await srv.close();
  }
});

test('inn room and nights type edges: case, whitespace, non-string room, integer-valued floats', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');

    for (const badRoom of ['Lantern', 'LANTERN', ' lantern', 'lantern ']) {
      const res = await alice.claimInnRoom(badRoom, 2);
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'invalid_room');
    }

    for (const nonStrRoom of [123, null]) {
      const res = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/claim', {
        room: nonStrRoom,
        nights: 2,
      });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'invalid_room');
    }

    const claimRes = await alice.claimInnRoom('lantern', 2.0);
    assert.equal(claimRes.status, 201);
    assert.equal(claimRes.data.nights, 2);

    const extRes = await alice.extendInnStay('lantern', claimRes.data.key, 1.0);
    assert.equal(extRes.status, 200);
    assert.equal(extRes.data.nights, 3);
  } finally {
    await ctx.close();
  }
});

test('inn claim, extend, and vacate ignore body handle and unknown fields; auth handle wins', async () => {
  const ctx = await startTestServer();
  try {
    const { keys: aliceKeys } = await createResident(ctx, 'alice');

    const claimRes = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/claim', {
      room: 'lantern',
      nights: 2,
      handle: 'bob',
      foo: 'bar',
    });
    assert.equal(claimRes.status, 201);
    assert.equal(claimRes.data.handle, 'alice');
    const key = claimRes.data.key;

    const extRes = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/extend', {
      room: 'lantern',
      key,
      extra_nights: 1,
      handle: 'bob',
    });
    assert.equal(extRes.status, 200);
    assert.equal(extRes.data.handle, 'alice');

    const vacRes = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/vacate', {
      room: 'lantern',
      key,
      handle: 'bob',
    });
    assert.equal(vacRes.status, 200);
    assert.equal(vacRes.data.handle, 'alice');
    assert.equal(vacRes.data.vacated, true);
  } finally {
    await ctx.close();
  }
});

test('muted resident may extend and vacate; inn claim does not create checkin or footlight', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;

    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = ?").run('alice');

    const extRes = await alice.extendInnStay('lantern', key, 1);
    assert.equal(extRes.status, 200);
    assert.equal(extRes.data.nights, 3);

    const vacRes = await alice.vacateInnRoom('lantern', key);
    assert.equal(vacRes.status, 200);
    assert.equal(vacRes.data.vacated, true);
  } finally {
    await ctx.close();
  }

  const ctx2 = await startTestServer();
  try {
    const { client: bob } = await createResident(ctx2, 'bob');

    const claimRes = await bob.claimInnRoom('window', 2);
    assert.equal(claimRes.status, 201);

    const s = await bob.state();
    assert.equal(s.status, 200);
    assert.deepEqual(s.data.footlights, []);
    assert.deepEqual(s.data.presence, []);
    assert.deepEqual(Object.keys(s.data.inn.window).sort(), ['expires_at', 'guest', 'handle', 'nights']);
  } finally {
    await ctx2.close();
  }
});

test('guest inn claim validates handle_taken and invalid_handle before rate limit', async () => {
  const ctx = await startTestServer();
  try {
    await createResident(ctx, 'alice');

    const takenGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...generateKeypair() });
    const takenRes = await takenGuest.guestInnClaim('lantern', 2);
    assert.equal(takenRes.status, 409);
    assert.equal(takenRes.data.error, 'handle_taken');

    const badCharsGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'Bad Handle!', ...generateKeypair() });
    const badCharsRes = await badCharsGuest.guestInnClaim('lantern', 2);
    assert.equal(badCharsRes.status, 400);
    assert.equal(badCharsRes.data.error, 'invalid_handle');

    const shortGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'a', ...generateKeypair() });
    const shortRes = await shortGuest.guestInnClaim('lantern', 2);
    assert.equal(shortRes.status, 400);
    assert.equal(shortRes.data.error, 'invalid_handle');

    const emptyKeys = generateKeypair();
    const emptyRes = await signedPostAt(ctx, 'zz', emptyKeys, '/api/town/inn/guest/claim', {
      handle: '',
      pubkey: emptyKeys.pubkey,
      room: 'lantern',
      nights: 2,
    });
    assert.equal(emptyRes.status, 400);
    assert.equal(emptyRes.data.error, 'invalid_handle');

    const okGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'inn-guest', ...generateKeypair() });
    const okRes = await okGuest.guestInnClaim('lantern', 2);
    assert.equal(okRes.status, 201);
    assert.equal(okRes.data.handle, 'inn-guest');
    assert.equal(okRes.data.nights, 2);
  } finally {
    await ctx.close();
  }
});

test('guest inn pubkey_mismatch, invalid_key precedence, and guest extend/vacate happy path', async () => {
  const ctx1 = await startTestServer();
  try {
    const keysA = generateKeypair();
    const keysB = generateKeypair();
    const guestA = new GhostlightClient({ baseUrl: ctx1.baseUrl, handle: 'inn-guest', ...keysA });
    const guestB = new GhostlightClient({ baseUrl: ctx1.baseUrl, handle: 'inn-guest', ...keysB });

    const claimRes = await guestA.guestInnClaim('quiet', 3);
    assert.equal(claimRes.status, 201);
    const { key } = claimRes.data;

    const extMismatch = await guestB.guestInnExtend('quiet', key, 1);
    assert.equal(extMismatch.status, 403);
    assert.equal(extMismatch.data.error, 'pubkey_mismatch');

    const vacMismatch = await guestB.guestInnVacate('quiet', key);
    assert.equal(vacMismatch.status, 403);
    assert.equal(vacMismatch.data.error, 'pubkey_mismatch');

    const s1 = await guestA.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.inn.quiet.nights, 3);
    assert.equal(s1.data.inn.quiet.handle, 'inn-guest');
    assert.equal(s1.data.inn.quiet.guest, true);
  } finally {
    await ctx1.close();
  }

  const ctx2 = await startTestServer();
  try {
    const keysA = generateKeypair();
    const keysC = generateKeypair();
    const guestA = new GhostlightClient({ baseUrl: ctx2.baseUrl, handle: 'inn-guest', ...keysA });
    const guestC = new GhostlightClient({ baseUrl: ctx2.baseUrl, handle: 'other-guest', ...keysC });

    const claimRes = await guestA.guestInnClaim('quiet', 3);
    assert.equal(claimRes.status, 201);
    const { key, claimed_at } = claimRes.data;

    const wrongKeyRes = await guestC.guestInnExtend('quiet', 'AAAAAAAAAAAA', 1);
    assert.equal(wrongKeyRes.status, 403);
    assert.equal(wrongKeyRes.data.error, 'invalid_key');

    const extRes = await guestA.guestInnExtend('quiet', key, 1);
    assert.equal(extRes.status, 200);
    assert.equal(extRes.data.nights, 4);
    assert.equal(extRes.data.claimed_at, claimed_at);
    assert.equal(extRes.data.expires_at, claimed_at + 4 * NIGHT_SEC);

    const vacRes = await guestA.guestInnVacate('quiet', key);
    assert.equal(vacRes.status, 200);
    assert.equal(vacRes.data.vacated, true);
    assert.equal(vacRes.data.handle, 'inn-guest');

    const s2 = await guestA.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.inn.quiet, null);
  } finally {
    await ctx2.close();
  }
});

test('guest inn claim rate limit (2/hour) returns exact 429 body and leaves state unchanged', async () => {
  const ctx = await startTestServer();
  try {
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'g-one', ...generateKeypair() });

    const r1 = await guest.guestInnClaim('quiet', 2);
    assert.equal(r1.status, 201);

    const r2 = await guest.guestInnClaim('lantern', 2);
    assert.equal(r2.status, 409);
    assert.equal(r2.data.error, 'already_claimed');

    const sBefore = await guest.state();
    assert.equal(sBefore.status, 200);
    const seqBefore = sBefore.data.state_seq;

    const r3 = await guest.guestInnClaim('window', 2);
    assert.equal(r3.status, 429);
    assert.deepEqual(Object.keys(r3.data).sort(), ['error', 'retry_after']);
    assert.equal(r3.data.error, 'rate_limited');
    assert.equal(Number.isInteger(r3.data.retry_after), true);
    assert.ok(r3.data.retry_after >= 1 && r3.data.retry_after <= 3600);

    const sAfter = await guest.state();
    assert.equal(sAfter.status, 200);
    assert.equal(sAfter.data.state_seq, seqBefore);
    assert.equal(sAfter.data.inn.quiet.handle, 'g-one');
    assert.equal(sAfter.data.inn.window, null);
    assert.equal(sAfter.data.inn.lantern, null);
  } finally {
    await ctx.close();
  }
});

test('inn full house across all three rooms, fourth resident blocked until vacate, new key on re-claim', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const { client: bob } = await createResident(ctx, 'bob');
    const { client: carol } = await createResident(ctx, 'carol');
    const { client: dave } = await createResident(ctx, 'dave');

    const aClaim = await alice.claimInnRoom('lantern', 2);
    assert.equal(aClaim.status, 201);
    const bClaim = await bob.claimInnRoom('window', 3);
    assert.equal(bClaim.status, 201);
    const cClaim = await carol.claimInnRoom('quiet', 1);
    assert.equal(cClaim.status, 201);

    const s1 = await alice.state();
    assert.equal(s1.status, 200);
    assert.deepEqual(s1.data.inn, {
      lantern: { handle: 'alice', nights: 2, expires_at: aClaim.data.expires_at, guest: false },
      window: { handle: 'bob', nights: 3, expires_at: bClaim.data.expires_at, guest: false },
      quiet: { handle: 'carol', nights: 1, expires_at: cClaim.data.expires_at, guest: false },
    });

    const dLantern = await dave.claimInnRoom('lantern', 2);
    assert.equal(dLantern.status, 409);
    assert.equal(dLantern.data.error, 'room_already_claimed');

    const dQuiet = await dave.claimInnRoom('quiet', 2);
    assert.equal(dQuiet.status, 409);
    assert.equal(dQuiet.data.error, 'room_already_claimed');

    const aVac = await alice.vacateInnRoom('lantern', aClaim.data.key);
    assert.equal(aVac.status, 200);

    const s2 = await alice.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.inn.lantern, null);
    assert.equal(s2.data.inn.window.handle, 'bob');
    assert.equal(s2.data.inn.window.expires_at, bClaim.data.expires_at);
    assert.equal(s2.data.inn.quiet.handle, 'carol');

    const dReclaim = await dave.claimInnRoom('lantern', 2);
    assert.equal(dReclaim.status, 201);
    assert.equal(dReclaim.data.handle, 'dave');
    assert.notEqual(dReclaim.data.key, aClaim.data.key);
  } finally {
    await ctx.close();
  }
});

test('inn extend recomputes expires_at from original claimed_at after clock advances', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice, keys: aliceKeys } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const C = claimRes.data.claimed_at;
    const key = claimRes.data.key;

    ctx.advanceClock(NIGHT_SEC);

    const extRes = await signedPostAt(ctx, 'alice', aliceKeys, '/api/town/inn/extend', {
      room: 'lantern',
      key,
      extra_nights: 1,
    });
    assert.equal(extRes.status, 200);
    assert.equal(extRes.data.nights, 3);
    assert.equal(extRes.data.claimed_at, C);
    assert.equal(extRes.data.expires_at, C + 3 * NIGHT_SEC);

    const s = await alice.state();
    assert.equal(s.status, 200);
    assert.equal(s.data.inn.lantern.expires_at, C + 3 * NIGHT_SEC);
  } finally {
    await ctx.close();
  }
});

test('inn_claims DB row exact shape, column order, guest pubkey, and delete on vacate', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');
    const aClaim = await alice.claimInnRoom('lantern', 2);
    assert.equal(aClaim.status, 201);

    const rows = ctx.db
      .prepare('SELECT room, handle, claimed_at, nights, expires_at, key_code, pubkey FROM inn_claims ORDER BY room')
      .all()
      .map((r) => ({ ...r }));
    assert.deepEqual(rows, [
      {
        room: 'lantern',
        handle: 'alice',
        claimed_at: aClaim.data.claimed_at,
        nights: 2,
        expires_at: aClaim.data.claimed_at + 2 * NIGHT_SEC,
        key_code: aClaim.data.key,
        pubkey: null,
      },
    ]);

    const guestKeys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'inn-guest', ...guestKeys });
    const gClaim = await guest.guestInnClaim('window', 3);
    assert.equal(gClaim.status, 201);

    const wRow = { ...ctx.db.prepare("SELECT * FROM inn_claims WHERE room = 'window'").get() };
    assert.equal(wRow.pubkey, guestKeys.pubkey);
    assert.equal(wRow.handle, 'inn-guest');
    assert.equal(wRow.key_code, gClaim.data.key);

    const cols = ctx.db.prepare('PRAGMA table_info(inn_claims)').all().map((c) => c.name);
    assert.deepEqual(cols, ['room', 'handle', 'claimed_at', 'nights', 'expires_at', 'key_code', 'pubkey']);

    const vacRes = await alice.vacateInnRoom('lantern', aClaim.data.key);
    assert.equal(vacRes.status, 200);

    assert.equal(ctx.db.prepare('SELECT room FROM inn_claims WHERE room = ?').get('lantern'), undefined);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM inn_claims').get().n, 1);
  } finally {
    await ctx.close();
  }
});

test('incremental state?since= returns 200 on inn claim, extend, vacate and 304 when caught up', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const s0 = await alice.state();
    assert.equal(s0.status, 200);
    const seq0 = s0.data.state_seq;

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const key = claimRes.data.key;

    const s1 = await alice.state(seq0);
    assert.equal(s1.status, 200);
    assert.equal(s1.data.state_seq, seq0 + 1);
    assert.equal(s1.data.inn.lantern.handle, 'alice');

    const s1NotMod = await alice.state(seq0 + 1);
    assert.equal(s1NotMod.status, 304);
    assert.equal(s1NotMod.data, null);

    const extRes = await alice.extendInnStay('lantern', key, 1);
    assert.equal(extRes.status, 200);

    const s2 = await alice.state(seq0 + 1);
    assert.equal(s2.status, 200);
    assert.equal(s2.data.state_seq, seq0 + 2);
    assert.equal(s2.data.inn.lantern.nights, 3);

    const s2NotMod = await alice.state(seq0 + 2);
    assert.equal(s2NotMod.status, 304);
    assert.equal(s2NotMod.data, null);

    const vacRes = await alice.vacateInnRoom('lantern', key);
    assert.equal(vacRes.status, 200);

    const s3 = await alice.state(seq0 + 2);
    assert.equal(s3.status, 200);
    assert.equal(s3.data.state_seq, seq0 + 3);
    assert.equal(s3.data.inn.lantern, null);

    const s3NotMod = await alice.state(seq0 + 3);
    assert.equal(s3NotMod.status, 304);
    assert.equal(s3NotMod.data, null);
  } finally {
    await ctx.close();
  }
});

test('inn key strictness rejects wrong length, flipped case, and valid-format wrong key without mutating state', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createResident(ctx, 'alice');

    const claimRes = await alice.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    const { key, expires_at } = claimRes.data;

    const sBefore = await alice.state();
    assert.equal(sBefore.status, 200);
    const seqBefore = sBefore.data.state_seq;

    const letterIdx = [...key].findIndex((ch) => /[A-Za-z]/.test(ch));
    assert.ok(letterIdx >= 0);
    const ch = key[letterIdx];
    const flippedChar = ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
    const flippedKey = key.slice(0, letterIdx) + flippedChar + key.slice(letterIdx + 1);
    assert.notEqual(flippedKey, key);

    for (const badKey of [key + 'X', key.slice(0, 11), flippedKey, 'AAAAAAAAAAAA']) {
      const r = await alice.extendInnStay('lantern', badKey, 1);
      assert.equal(r.status, 403);
      assert.equal(r.data.error, 'invalid_key');
    }

    const sAfter = await alice.state();
    assert.equal(sAfter.status, 200);
    assert.equal(sAfter.data.state_seq, seqBefore);
    assert.equal(sAfter.data.inn.lantern.nights, 2);
    assert.equal(sAfter.data.inn.lantern.expires_at, expires_at);

    const okExt = await alice.extendInnStay('lantern', key, 1);
    assert.equal(okExt.status, 200);
    assert.equal(okExt.data.nights, 3);
  } finally {
    await ctx.close();
  }
});

test('muted resident may claim an inn room without creating footlight or presence', async () => {
  const ctx = await startTestServer();
  try {
    const { client: carol } = await createResident(ctx, 'carol');
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = ?").run('carol');

    const claimRes = await carol.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201);
    assert.equal(claimRes.data.handle, 'carol');
    assert.equal(claimRes.data.nights, 2);
    assert.equal(claimRes.data.expires_at, claimRes.data.claimed_at + 2 * NIGHT_SEC);

    const s = await carol.state();
    assert.equal(s.status, 200);
    assert.deepEqual(s.data.footlights, []);
    assert.deepEqual(s.data.presence, []);
    assert.equal(s.data.inn.lantern.handle, 'carol');
    assert.equal(s.data.inn.lantern.guest, false);
  } finally {
    await ctx.close();
  }
});

test('test-inn.mjs file hygiene: 45 unique tests, 8 imports, zero banned needles added', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-inn.mjs'), 'utf8');
  const lines = src.split('\n');

  const names = [];
  for (const line of lines) {
    const m = /^test\('([^']+)'/.exec(line);
    if (m) names.push(m[1]);
  }
  assert.equal(names.length, 45);
  assert.equal(new Set(names).size, 45);

  const importCount = lines.filter((l) => l.startsWith('import ')).length;
  assert.equal(importCount, 8);

  const countLines = (needle) => lines.filter((l) => l.includes(needle)).length;
  assert.equal(countLines('TO' + 'DO'), 0);
  assert.equal(countLines('FIX' + 'ME'), 0);
  assert.equal(countLines('Math' + '.random'), 0);
  assert.equal(countLines('Date' + '.now'), 4);
  assert.equal(countLines('fet' + 'ch('), 6);
});
