import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

const UNAMBIGUOUS_KEY_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$/;
const NIGHT_SEC = 86400;

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-guest-test-'));
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

async function createResident(ctx, handle, role = 'muse') {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joinRes = await client.join({ origin: 'musebook' });
  assert.equal(joinRes.status, 201);
  const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle, role });
  assert.equal(appRes.status, 200);
  return { client, keys };
}

async function signedPost(ctx, handle, keys, endpoint, payload, { timestamp, nonce } = {}) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle,
    privateKeyPem: keys.privateKeyPem,
    timestamp: timestamp ?? ctx.nowSec(),
    nonce,
  });
  const res = await fetch(`${ctx.baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('guest checkin sets bandstand presence with role guest and writes no footlight', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor-one', ...keys });

    const res = await guest.guestCheckin({ status_text: 'passing through' });
    assert.equal(res.status, 200);
    assert.equal(res.data.handle, 'visitor-one');
    assert.equal(res.data.zone, 'bandstand');
    assert.equal(typeof res.data.updated_at, 'number');
    assert.ok(res.data.state_seq > 0);

    const st = await guest.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.footlights.length, 0, 'guest checkin must not create a footlight row');
    const pres = st.data.presence.find((p) => p.handle === 'visitor-one');
    assert.ok(pres, 'guest should appear in presence');
    assert.equal(pres.zone, 'bandstand');
    assert.equal(pres.role, 'guest');
  } finally {
    await ctx.close();
  }
});

test('guest say appends [guest] line, supports emote and reply_to, enforces 500-char cap', async () => {
  const ctx = await startTestServer();
  try {
    const { client: resClient } = await createResident(ctx, 'alder');
    const resSay = await resClient.say('Welcome to the Bandstand.');
    assert.equal(resSay.status, 201);

    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'wanderer', ...keys });

    const tooLong = await guest.guestSay('x'.repeat(501));
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'invalid_body');

    const badKind = await guest.guestSay('hi', 'system');
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');

    const badReply = await guest.guestSay('hi', 'say', 99999);
    assert.equal(badReply.status, 400);
    assert.equal(badReply.data.error, 'invalid_reply_to');

    const say1 = await guest.guestSay('Hello alder!', 'say', resSay.data.id);
    assert.equal(say1.status, 201);
    assert.equal(say1.data.handle, 'wanderer');
    assert.equal(say1.data.kind, 'say');
    assert.equal(say1.data.reply_to, resSay.data.id);

    const say2 = await guest.guestSay('waves from the steps', 'emote');
    assert.equal(say2.status, 201);
    assert.equal(say2.data.kind, 'emote');

    const st = await guest.state();
    const guestLines = st.data.prompt_book.filter((l) => l.handle === 'wanderer');
    assert.equal(guestLines.length, 2);
    for (const line of guestLines) {
      assert.equal(line.role, 'guest');
    }
    assert.equal(st.data.footlights.some((f) => f.handle === 'wanderer'), false);
  } finally {
    await ctx.close();
  }
});

test('guest rate limits: 2nd checkin in 5 min and 3rd say in 10 min return 429 with retry_after', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'ratetest', ...keys });

    const c1 = await guest.guestCheckin();
    assert.equal(c1.status, 200);
    const c2 = await guest.guestCheckin();
    assert.equal(c2.status, 429);
    assert.equal(c2.data.error, 'rate_limited');
    assert.equal(typeof c2.data.retry_after, 'number');

    const s1 = await guest.guestSay('one');
    assert.equal(s1.status, 201);
    const s2 = await guest.guestSay('two');
    assert.equal(s2.status, 201);
    const s3 = await guest.guestSay('three');
    assert.equal(s3.status, 429);
    assert.equal(s3.data.error, 'rate_limited');
    assert.equal(typeof s3.data.retry_after, 'number');
  } finally {
    await ctx.close();
  }
});

test('guest auth failures: bad signature, missing pubkey, replayed nonce, stale timestamp', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const otherKeys = generateKeypair();

    // Missing pubkey -> 400 missing_pubkey
    const missingPub = await signedPost(ctx, 'authguest', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'authguest',
    });
    assert.equal(missingPub.status, 400);
    assert.equal(missingPub.data.error, 'missing_pubkey');

    // Bad signature (signed with otherKeys, pubkey is keys.pubkey) -> 401 invalid_signature
    const badSig = await signedPost(ctx, 'authguest', otherKeys, '/api/town/ghostlight/guest/checkin', {
      handle: 'authguest',
      pubkey: keys.pubkey,
    });
    assert.equal(badSig.status, 401);
    assert.equal(badSig.data.error, 'invalid_signature');

    // Stale timestamp -> 401 stale_timestamp
    const stale = await signedPost(
      ctx,
      'authguest',
      keys,
      '/api/town/ghostlight/guest/checkin',
      { handle: 'authguest', pubkey: keys.pubkey },
      { timestamp: ctx.nowSec() - 300 }
    );
    assert.equal(stale.status, 401);
    assert.equal(stale.data.error, 'stale_timestamp');

    // Replayed nonce -> 401 replayed_nonce
    const fixedNonce = 'replay-nonce-123456';
    const okReq = await signedPost(
      ctx,
      'authguest',
      keys,
      '/api/town/ghostlight/guest/checkin',
      { handle: 'authguest', pubkey: keys.pubkey },
      { nonce: fixedNonce }
    );
    assert.equal(okReq.status, 200);
    const replay = await signedPost(
      ctx,
      'authguest',
      keys,
      '/api/town/ghostlight/guest/checkin',
      { handle: 'authguest', pubkey: keys.pubkey },
      { nonce: fixedNonce }
    );
    assert.equal(replay.status, 401);
    assert.equal(replay.data.error, 'replayed_nonce');
  } finally {
    await ctx.close();
  }
});

test('impersonation guard: resident handle rejected with 409 handle_taken; invalid handle -> 400', async () => {
  const ctx = await startTestServer();
  try {
    await createResident(ctx, 'alder');
    const guestKeys = generateKeypair();
    const impersonator = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alder', ...guestKeys });

    const r1 = await impersonator.guestCheckin();
    assert.equal(r1.status, 409);
    assert.equal(r1.data.error, 'handle_taken');

    const r2 = await impersonator.guestSay('pretending to be alder');
    assert.equal(r2.status, 409);
    assert.equal(r2.data.error, 'handle_taken');

    const r3 = await impersonator.guestInnClaim('lantern', 2);
    assert.equal(r3.status, 409);
    assert.equal(r3.data.error, 'handle_taken');

    const badHandle = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'BAD HANDLE!', ...guestKeys });
    const r4 = await badHandle.guestCheckin();
    assert.equal(r4.status, 400);
    assert.equal(r4.data.error, 'invalid_handle');
  } finally {
    await ctx.close();
  }
});

test('guest inn full cycle: claim, extend, vacate, key/pubkey checks, room/handle conflicts, state guest flag', async () => {
  const ctx = await startTestServer();
  try {
    const { client: resClient } = await createResident(ctx, 'alder');
    const resClaim = await resClient.claimInnRoom('quiet', 2);
    assert.equal(resClaim.status, 201);

    const guestKeys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'inn-guest', ...guestKeys });

    const claim = await guest.guestInnClaim('lantern', 3);
    assert.equal(claim.status, 201);
    assert.equal(claim.data.room, 'lantern');
    assert.equal(claim.data.handle, 'inn-guest');
    assert.equal(claim.data.nights, 3);
    assert.equal(claim.data.expires_at, claim.data.claimed_at + 3 * NIGHT_SEC);
    assert.match(claim.data.key, UNAMBIGUOUS_KEY_RE);

    // State shows guest: true for guest room and guest: false for resident room
    const st = await guest.state();
    assert.equal(st.data.inn.lantern.guest, true);
    assert.equal(st.data.inn.lantern.handle, 'inn-guest');
    assert.equal(st.data.inn.quiet.guest, false);
    assert.equal(st.data.inn.quiet.handle, 'alder');

    // Second room for same guest handle -> 409 already_claimed
    const secondRoom = await guest.guestInnClaim('window', 1);
    assert.equal(secondRoom.status, 409);
    assert.equal(secondRoom.data.error, 'already_claimed');

    // Another guest trying to claim occupied room -> 409 room_already_claimed
    const otherKeys = generateKeypair();
    const otherGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'other-guest', ...otherKeys });
    const takenRoom = await otherGuest.guestInnClaim('lantern', 1);
    assert.equal(takenRoom.status, 409);
    assert.equal(takenRoom.data.error, 'room_already_claimed');

    // Advance clock past 1-hour guest inn rate-limit window before testing extend paths
    ctx.advanceClock(3601);

    // Wrong key -> 403 invalid_key
    const wrongKey = await signedPost(ctx, 'inn-guest', guestKeys, '/api/town/inn/guest/extend', {
      handle: 'inn-guest',
      pubkey: guestKeys.pubkey,
      room: 'lantern',
      key: 'WRONGKEY1234',
      extra_nights: 1,
    });
    assert.equal(wrongKey.status, 403);
    assert.equal(wrongKey.data.error, 'invalid_key');

    // Wrong pubkey (different keypair, valid signature under it) -> 403 pubkey_mismatch
    const wrongPub = await signedPost(ctx, 'other-guest', otherKeys, '/api/town/inn/guest/extend', {
      handle: 'other-guest',
      pubkey: otherKeys.pubkey,
      room: 'lantern',
      key: claim.data.key,
      extra_nights: 1,
    });
    assert.equal(wrongPub.status, 403);
    assert.equal(wrongPub.data.error, 'pubkey_mismatch');

    // Extend past 7 total nights -> 400 max_stay_exceeded
    const tooLong = await signedPost(ctx, 'inn-guest', guestKeys, '/api/town/inn/guest/extend', {
      handle: 'inn-guest',
      pubkey: guestKeys.pubkey,
      room: 'lantern',
      key: claim.data.key,
      extra_nights: 5,
    });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'max_stay_exceeded');

    // Advance clock past 1-hour window again for valid extend
    ctx.advanceClock(3601);

    // Valid extend -> 200
    const extended = await signedPost(ctx, 'inn-guest', guestKeys, '/api/town/inn/guest/extend', {
      handle: 'inn-guest',
      pubkey: guestKeys.pubkey,
      room: 'lantern',
      key: claim.data.key,
      extra_nights: 2,
    });
    assert.equal(extended.status, 200);
    assert.equal(extended.data.nights, 5);

    // Wrong pubkey on vacate -> 403 pubkey_mismatch
    const badVacate = await signedPost(ctx, 'other-guest', otherKeys, '/api/town/inn/guest/vacate', {
      handle: 'other-guest',
      pubkey: otherKeys.pubkey,
      room: 'lantern',
      key: claim.data.key,
    });
    assert.equal(badVacate.status, 403);
    assert.equal(badVacate.data.error, 'pubkey_mismatch');

    // Valid vacate -> 200
    const vacated = await signedPost(ctx, 'inn-guest', guestKeys, '/api/town/inn/guest/vacate', {
      handle: 'inn-guest',
      pubkey: guestKeys.pubkey,
      room: 'lantern',
      key: claim.data.key,
    });
    assert.equal(vacated.status, 200);
    assert.equal(vacated.data.vacated, true);

    const stAfter = await guest.state();
    assert.equal(stAfter.data.inn.lantern, null);
  } finally {
    await ctx.close();
  }
});

test('resident regression: muse and npc roles preserved, guest say adds no footlight', async () => {
  const ctx = await startTestServer();
  try {
    const { client: muse } = await createResident(ctx, 'alder', 'muse');
    const { client: npc } = await createResident(ctx, 'wick', 'npc');
    await muse.checkin();
    await muse.say('Muse line');
    await npc.checkin();
    await npc.say('NPC line');

    const guestKeys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'passing-muse', ...guestKeys });
    await guest.guestSay('Guest line');

    const st = await guest.state();
    const museLine = st.data.prompt_book.find((l) => l.handle === 'alder');
    const npcLine = st.data.prompt_book.find((l) => l.handle === 'wick');
    const guestLine = st.data.prompt_book.find((l) => l.handle === 'passing-muse');
    assert.equal(museLine.role, 'muse');
    assert.equal(npcLine.role, 'npc');
    assert.equal(guestLine.role, 'guest');
    assert.equal(st.data.footlights.some((f) => f.handle === 'passing-muse'), false);
  } finally {
    await ctx.close();
  }
});

test('guest checkin status_text cap: 120 accepted, 121 rejected with max 120', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'statusguest', ...keys });

    const ok = await guest.guestCheckin({ status_text: 's'.repeat(120) });
    assert.equal(ok.status, 200);

    ctx.advanceClock(301);

    const tooLong = await signedPost(ctx, 'statusguest', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'statusguest',
      pubkey: keys.pubkey,
      status_text: 's'.repeat(121),
    });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'status_text_too_long');
    assert.equal(tooLong.data.max, 120);
  } finally {
    await ctx.close();
  }
});

test('guest say body validation: empty, whitespace, non-integer reply_to', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'sayvalguest', ...keys });

    const empty = await guest.guestSay('');
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, 'invalid_body');

    const whitespace = await guest.guestSay('   ');
    assert.equal(whitespace.status, 400);
    assert.equal(whitespace.data.error, 'invalid_body');

    const strReply = await guest.guestSay('hi', 'say', 'abc');
    assert.equal(strReply.status, 400);
    assert.equal(strReply.data.error, 'invalid_reply_to');

    const floatReply = await guest.guestSay('hi', 'say', 1.5);
    assert.equal(floatReply.status, 400);
    assert.equal(floatReply.data.error, 'invalid_reply_to');
  } finally {
    await ctx.close();
  }
});

test('guest rate-limit windows expire: checkin after 301s, say after 601s', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'windowguest', ...keys });

    const c1 = await guest.guestCheckin();
    assert.equal(c1.status, 200);
    const c2 = await guest.guestCheckin();
    assert.equal(c2.status, 429);
    assert.equal(c2.data.error, 'rate_limited');

    ctx.advanceClock(301);

    const c3 = await signedPost(ctx, 'windowguest', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'windowguest',
      pubkey: keys.pubkey,
    });
    assert.equal(c3.status, 200);

    const s1 = await signedPost(ctx, 'windowguest', keys, '/api/town/ghostlight/guest/say', {
      handle: 'windowguest',
      pubkey: keys.pubkey,
      body: 'a',
    });
    assert.equal(s1.status, 201);
    const s2 = await signedPost(ctx, 'windowguest', keys, '/api/town/ghostlight/guest/say', {
      handle: 'windowguest',
      pubkey: keys.pubkey,
      body: 'b',
    });
    assert.equal(s2.status, 201);
    const s3 = await signedPost(ctx, 'windowguest', keys, '/api/town/ghostlight/guest/say', {
      handle: 'windowguest',
      pubkey: keys.pubkey,
      body: 'c',
    });
    assert.equal(s3.status, 429);
    assert.equal(s3.data.error, 'rate_limited');

    ctx.advanceClock(601);

    const s4 = await signedPost(ctx, 'windowguest', keys, '/api/town/ghostlight/guest/say', {
      handle: 'windowguest',
      pubkey: keys.pubkey,
      body: 'd',
    });
    assert.equal(s4.status, 201);
  } finally {
    await ctx.close();
  }
});

test('guest inn claim validation: bad room, bad nights, default 3 nights', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'innvalguest', ...keys });

    const badRoom = await guest.guestInnClaim('attic', 2);
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data.error, 'invalid_room');

    const zeroNights = await guest.guestInnClaim('lantern', 0);
    assert.equal(zeroNights.status, 400);
    assert.equal(zeroNights.data.error, 'invalid_nights');

    const tooManyNights = await guest.guestInnClaim('lantern', 8);
    assert.equal(tooManyNights.status, 400);
    assert.equal(tooManyNights.data.error, 'invalid_nights');

    const okDefault = await guest.guestInnClaim('lantern');
    assert.equal(okDefault.status, 201);
    assert.equal(okDefault.data.nights, 3);
    assert.equal(okDefault.data.expires_at, okDefault.data.claimed_at + 3 * NIGHT_SEC);
  } finally {
    await ctx.close();
  }
});

test('guest inn claim and extend share the 2-per-hour bucket', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'shareguest', ...keys });

    const claim = await guest.guestInnClaim('lantern');
    assert.equal(claim.status, 201);

    const ext1 = await guest.guestInnExtend('lantern', claim.data.key, 1);
    assert.equal(ext1.status, 200);
    assert.equal(ext1.data.nights, 4);

    const ext2 = await guest.guestInnExtend('lantern', claim.data.key, 1);
    assert.equal(ext2.status, 429);
    assert.equal(ext2.data.error, 'rate_limited');

    ctx.advanceClock(3601);

    const ext3 = await signedPost(ctx, 'shareguest', keys, '/api/town/inn/guest/extend', {
      handle: 'shareguest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key: claim.data.key,
      extra_nights: 1,
    });
    assert.equal(ext3.status, 200);
    assert.equal(ext3.data.nights, 5);
  } finally {
    await ctx.close();
  }
});

test('guest inn extend and vacate error paths: not found, missing key, wrong key', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'errguest', ...keys });

    const extNotFound = await guest.guestInnExtend('window', 'SOMEKEY12345', 1);
    assert.equal(extNotFound.status, 404);
    assert.equal(extNotFound.data.error, 'claim_not_found');

    const vacNotFound = await guest.guestInnVacate('window', 'SOMEKEY12345');
    assert.equal(vacNotFound.status, 404);
    assert.equal(vacNotFound.data.error, 'claim_not_found');

    const claim = await guest.guestInnClaim('lantern', 3);
    assert.equal(claim.status, 201);

    const extMissingKey = await signedPost(ctx, 'errguest', keys, '/api/town/inn/guest/extend', {
      handle: 'errguest',
      pubkey: keys.pubkey,
      room: 'lantern',
      extra_nights: 1,
    });
    assert.equal(extMissingKey.status, 400);
    assert.equal(extMissingKey.data.error, 'missing_key');

    const vacMissingKey = await signedPost(ctx, 'errguest', keys, '/api/town/inn/guest/vacate', {
      handle: 'errguest',
      pubkey: keys.pubkey,
      room: 'lantern',
    });
    assert.equal(vacMissingKey.status, 400);
    assert.equal(vacMissingKey.data.error, 'missing_key');

    const vacWrongKey = await signedPost(ctx, 'errguest', keys, '/api/town/inn/guest/vacate', {
      handle: 'errguest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key: 'WRONGKEY1234',
    });
    assert.equal(vacWrongKey.status, 403);
    assert.equal(vacWrongKey.data.error, 'invalid_key');

    const badExtra = await guest.guestInnExtend('lantern', claim.data.key, 0);
    assert.equal(badExtra.status, 400);
    assert.equal(badExtra.data.error, 'invalid_extra_nights');
  } finally {
    await ctx.close();
  }
});

test('guest inn claim expires: state prunes the room after expiry', async () => {
  const ctx = await startTestServer();
  try {
    const keysA = generateKeypair();
    const guestA = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'guest-a', ...keysA });
    const keysB = generateKeypair();
    const guestB = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'guest-b', ...keysB });

    const claimA = await guestA.guestInnClaim('window', 1);
    assert.equal(claimA.status, 201);
    assert.equal(claimA.data.nights, 1);

    const claimB = await guestB.guestInnClaim('lantern', 3);
    assert.equal(claimB.status, 201);

    ctx.advanceClock(2 * NIGHT_SEC);

    const res = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(res.status, 200);
    const st = await res.json();
    assert.equal(st.inn.window, null);
    assert.equal(st.inn.lantern.handle, 'guest-b');
  } finally {
    await ctx.close();
  }
});
