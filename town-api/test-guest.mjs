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

test('guest say needs no checkin: 500-char boundary posts, invalid bodies consume no quota, state_seq rises', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'solo-sayer', ...keys });

    const s1 = await guest.guestSay('x'.repeat(500));
    assert.equal(s1.status, 201);
    assert.equal(s1.data.body.length, 500);
    const seq1 = s1.data.state_seq;

    const empty = await guest.guestSay('');
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, 'invalid_body');

    const tooLong = await guest.guestSay('y'.repeat(501));
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'invalid_body');
    assert.equal(tooLong.data.max, 500);

    const s2 = await guest.guestSay('ok');
    assert.equal(s2.status, 201);
    assert.ok(s2.data.state_seq > seq1);

    const s3 = await guest.guestSay('third');
    assert.equal(s3.status, 429);
    assert.equal(s3.data.error, 'rate_limited');

    const st = await guest.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.presence.some((p) => p.handle === 'solo-sayer'), false);
    assert.equal(st.data.footlights.some((f) => f.handle === 'solo-sayer'), false);
  } finally {
    await ctx.close();
  }
});

test('guest checkin status_text edges: non-string rejected, null accepted, re-checkin refreshes updated_at', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'statusedge', ...keys });

    const badType = await signedPost(ctx, 'statusedge', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'statusedge',
      pubkey: keys.pubkey,
      status_text: 123,
    });
    assert.equal(badType.status, 400);
    assert.equal(badType.data.error, 'status_text_too_long');
    assert.equal(badType.data.max, 120);

    const c1 = await guest.guestCheckin({ status_text: null });
    assert.equal(c1.status, 200);

    ctx.advanceClock(301);

    const c2 = await signedPost(ctx, 'statusedge', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'statusedge',
      pubkey: keys.pubkey,
      status_text: 'still here',
    });
    assert.equal(c2.status, 200);
    assert.equal(c2.data.updated_at, c1.data.updated_at + 301);

    const st = await guest.state();
    assert.equal(st.status, 200);
    const pres = st.data.presence.find((p) => p.handle === 'statusedge');
    assert.ok(pres);
    assert.deepEqual(Object.keys(pres).sort(), ['handle', 'role', 'updated_at', 'zone']);
    assert.equal(pres.updated_at, c2.data.updated_at);
  } finally {
    await ctx.close();
  }
});

test('guest handle is not key-bound: second keypair checks in after the window; rate limit is per-handle', async () => {
  const ctx = await startTestServer();
  try {
    const keys1 = generateKeypair();
    const keys2 = generateKeypair();
    const guest1 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'shared-handle', ...keys1 });
    const guest2 = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'shared-handle', ...keys2 });

    const c1 = await guest1.guestCheckin();
    assert.equal(c1.status, 200);

    const c2 = await guest2.guestCheckin();
    assert.equal(c2.status, 429);
    assert.equal(c2.data.error, 'rate_limited');

    ctx.advanceClock(301);

    const c3 = await signedPost(ctx, 'shared-handle', keys2, '/api/town/ghostlight/guest/checkin', {
      handle: 'shared-handle',
      pubkey: keys2.pubkey,
    });
    assert.equal(c3.status, 200);

    const st = await guest1.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.presence.filter((p) => p.handle === 'shared-handle').length, 1);
  } finally {
    await ctx.close();
  }
});

test('guest inn claim: fractional/string nights rejected free; resident-held room 409s consume the bucket', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'nightsguest', ...keys });

    const frac = await guest.guestInnClaim('window', 2.5);
    assert.equal(frac.status, 400);
    assert.equal(frac.data.error, 'invalid_nights');

    const strNights = await signedPost(ctx, 'nightsguest', keys, '/api/town/inn/guest/claim', {
      handle: 'nightsguest',
      pubkey: keys.pubkey,
      room: 'window',
      nights: '3',
    });
    assert.equal(strNights.status, 400);
    assert.equal(strNights.data.error, 'invalid_nights');

    const okClaim = await guest.guestInnClaim('window', 2);
    assert.equal(okClaim.status, 201);

    const { client: alder } = await createResident(ctx, 'alder');
    const resClaim = await alder.claimInnRoom('lantern', 2);
    assert.equal(resClaim.status, 201);

    const roomKeys = generateKeypair();
    const roomGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'roomguest', ...roomKeys });

    const taken1 = await roomGuest.guestInnClaim('lantern', 1);
    assert.equal(taken1.status, 409);
    assert.equal(taken1.data.error, 'room_already_claimed');

    const taken2 = await roomGuest.guestInnClaim('lantern', 1);
    assert.equal(taken2.status, 409);
    assert.equal(taken2.data.error, 'room_already_claimed');

    const limited = await roomGuest.guestInnClaim('quiet', 1);
    assert.equal(limited.status, 429);
    assert.equal(limited.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('guest inn extend boundary: exactly 7 nights succeeds, the 8th exceeds; invalid extra_nights free', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'extendguest', ...keys });

    const claim = await guest.guestInnClaim('lantern', 3);
    assert.equal(claim.status, 201);
    const { key, claimed_at } = claim.data;

    const frac = await signedPost(ctx, 'extendguest', keys, '/api/town/inn/guest/extend', {
      handle: 'extendguest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key,
      extra_nights: 2.5,
    });
    assert.equal(frac.status, 400);
    assert.equal(frac.data.error, 'invalid_extra_nights');

    const strExtra = await signedPost(ctx, 'extendguest', keys, '/api/town/inn/guest/extend', {
      handle: 'extendguest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key,
      extra_nights: '2',
    });
    assert.equal(strExtra.status, 400);
    assert.equal(strExtra.data.error, 'invalid_extra_nights');

    const extOk = await guest.guestInnExtend('lantern', key, 4);
    assert.equal(extOk.status, 200);
    assert.equal(extOk.data.nights, 7);
    assert.equal(extOk.data.expires_at, claimed_at + 7 * NIGHT_SEC);

    ctx.advanceClock(3601);

    const extOver = await signedPost(ctx, 'extendguest', keys, '/api/town/inn/guest/extend', {
      handle: 'extendguest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key,
      extra_nights: 1,
    });
    assert.equal(extOver.status, 400);
    assert.equal(extOver.data.error, 'max_stay_exceeded');
  } finally {
    await ctx.close();
  }
});

test('guest inn vacate frees the room: extend 404s, re-claim gets a fresh key, old key is dead', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'vacguest', ...keys });

    const claim1 = await guest.guestInnClaim('lantern', 2);
    assert.equal(claim1.status, 201);
    const k1 = claim1.data.key;

    const vac = await guest.guestInnVacate('lantern', k1);
    assert.equal(vac.status, 200);
    assert.equal(vac.data.vacated, true);

    const st1 = await guest.state();
    assert.equal(st1.status, 200);
    assert.equal(st1.data.inn.lantern, null);

    const extDead = await signedPost(ctx, 'vacguest', keys, '/api/town/inn/guest/extend', {
      handle: 'vacguest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key: k1,
      extra_nights: 1,
    });
    assert.equal(extDead.status, 404);
    assert.equal(extDead.data.error, 'claim_not_found');

    ctx.advanceClock(3601);

    const claim2 = await signedPost(ctx, 'vacguest', keys, '/api/town/inn/guest/claim', {
      handle: 'vacguest',
      pubkey: keys.pubkey,
      room: 'lantern',
      nights: 1,
    });
    assert.equal(claim2.status, 201);
    const k2 = claim2.data.key;
    assert.notEqual(k2, k1);

    ctx.advanceClock(3601);

    const extOldKey = await signedPost(ctx, 'vacguest', keys, '/api/town/inn/guest/extend', {
      handle: 'vacguest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key: k1,
      extra_nights: 1,
    });
    assert.equal(extOldKey.status, 403);
    assert.equal(extOldKey.data.error, 'invalid_key');

    const st2 = await guest.state();
    assert.equal(st2.status, 200);
    assert.equal(st2.data.inn.lantern.handle, 'vacguest');
    assert.equal(st2.data.inn.lantern.nights, 1);
    assert.equal(st2.data.inn.lantern.guest, true);
  } finally {
    await ctx.close();
  }
});

test('guest auth: body.handle mismatch with the signed handle returns 401 handle_mismatch', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();

    const checkinMismatch = await signedPost(ctx, 'alice', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'bob',
      pubkey: keys.pubkey,
    });
    assert.equal(checkinMismatch.status, 401);
    assert.equal(checkinMismatch.data.error, 'handle_mismatch');

    const sayMismatch = await signedPost(ctx, 'alice', keys, '/api/town/ghostlight/guest/say', {
      handle: 'carol',
      pubkey: keys.pubkey,
      body: 'hi',
    });
    assert.equal(sayMismatch.status, 401);
    assert.equal(sayMismatch.data.error, 'handle_mismatch');

    const missingPubkey = await signedPost(ctx, 'alice', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'bob',
    });
    assert.equal(missingPubkey.status, 400);
    assert.equal(missingPubkey.data.error, 'missing_pubkey');

    const absentHandle = await signedPost(ctx, 'alice', keys, '/api/town/ghostlight/guest/checkin', {
      pubkey: keys.pubkey,
    });
    assert.equal(absentHandle.status, 200);
    assert.equal(absentHandle.data.handle, 'alice');
  } finally {
    await ctx.close();
  }
});

test('guest checkin response carries exact keys and updated_at in-window; presence is sorted by handle', async () => {
  const ctx = await startTestServer();
  try {
    const zebraKeys = generateKeypair();
    const zebra = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'zebra', ...zebraKeys });
    const appleKeys = generateKeypair();
    const apple = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'apple', ...appleKeys });

    const before = ctx.nowSec();
    const resZ = await zebra.guestCheckin({ status_text: 'hi' });
    const after = ctx.nowSec();
    assert.equal(resZ.status, 200);
    assert.deepEqual(Object.keys(resZ.data).sort(), ['handle', 'state_seq', 'updated_at', 'zone']);
    assert.ok(resZ.data.updated_at >= before && resZ.data.updated_at <= after);

    const resA = await apple.guestCheckin();
    assert.equal(resA.status, 200);
    assert.ok(resA.data.state_seq > resZ.data.state_seq);

    const st = await zebra.state();
    assert.equal(st.status, 200);
    assert.deepEqual(st.data.presence.map((p) => p.handle), ['apple', 'zebra']);

    const zebraPres = st.data.presence.find((p) => p.handle === 'zebra');
    assert.ok(zebraPres);
    assert.deepEqual(Object.keys(zebraPres).sort(), ['handle', 'role', 'updated_at', 'zone']);
    assert.equal(zebraPres.role, 'guest');
    assert.equal('status_text' in zebraPres, false);
  } finally {
    await ctx.close();
  }
});

test('guest say stores the body verbatim, accepts reply_to null, and supports guest-to-guest replies', async () => {
  const ctx = await startTestServer();
  try {
    const padderKeys = generateKeypair();
    const padder = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'padder', ...padderKeys });
    const replierKeys = generateKeypair();
    const replier = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'replier', ...replierKeys });

    const p1 = await padder.guestSay('  padded hello  ');
    assert.equal(p1.status, 201);
    assert.equal(p1.data.body, '  padded hello  ');
    assert.deepEqual(Object.keys(p1.data).sort(), ['body', 'created_at', 'handle', 'id', 'kind', 'reply_to', 'state_seq']);

    const st1 = await padder.state();
    assert.equal(st1.status, 200);
    const p1Entry = st1.data.prompt_book.find((l) => l.id === p1.data.id);
    assert.ok(p1Entry);
    assert.equal(p1Entry.body, '  padded hello  ');

    const r1 = await replier.guestSay('no reply', 'say', null);
    assert.equal(r1.status, 201);
    assert.equal(r1.data.reply_to, null);

    const r2 = await replier.guestSay('answering the padder', 'say', p1.data.id);
    assert.equal(r2.status, 201);
    assert.equal(r2.data.reply_to, p1.data.id);

    const st2 = await replier.state();
    assert.equal(st2.status, 200);
    const r2Entry = st2.data.prompt_book.find((l) => l.id === r2.data.id);
    assert.ok(r2Entry);
    assert.equal(r2Entry.role, 'guest');
    assert.equal(r2Entry.reply_to, p1.data.id);
  } finally {
    await ctx.close();
  }
});

test('guest inn claim validation edges: room case/non-string/empty, nights 0/8/-1/null; 7-night claim exact keys and expiry math', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'edgeguest', ...keys });

    for (const badRoom of ['Lantern', 123, '']) {
      const res = await signedPost(ctx, 'edgeguest', keys, '/api/town/inn/guest/claim', {
        handle: 'edgeguest',
        pubkey: keys.pubkey,
        room: badRoom,
        nights: 1,
      });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'invalid_room');
    }

    for (const badNights of [0, 8, -1, null]) {
      const res = await signedPost(ctx, 'edgeguest', keys, '/api/town/inn/guest/claim', {
        handle: 'edgeguest',
        pubkey: keys.pubkey,
        room: 'window',
        nights: badNights,
      });
      assert.equal(res.status, 400);
      assert.equal(res.data.error, 'invalid_nights');
    }

    const before = ctx.nowSec();
    const claim = await guest.guestInnClaim('window', 7);
    const after = ctx.nowSec();
    assert.equal(claim.status, 201);
    assert.deepEqual(Object.keys(claim.data).sort(), ['claimed_at', 'expires_at', 'handle', 'key', 'nights', 'room', 'state_seq']);
    assert.ok(claim.data.claimed_at >= before && claim.data.claimed_at <= after);
    assert.equal(claim.data.nights, 7);
    assert.equal(claim.data.expires_at, claim.data.claimed_at + 7 * NIGHT_SEC);
  } finally {
    await ctx.close();
  }
});

test('guest inn claim after expiry: expired unclaimed room 404s on extend; re-claim by another guest succeeds with a fresh key', async () => {
  const ctx = await startTestServer();
  try {
    const firstKeys = generateKeypair();
    const firstGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'first-guest', ...firstKeys });
    const secondKeys = generateKeypair();
    const secondGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'second-guest', ...secondKeys });
    const thirdKeys = generateKeypair();
    const thirdGuest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'third-guest', ...thirdKeys });

    const firstClaim = await firstGuest.guestInnClaim('window', 1);
    assert.equal(firstClaim.status, 201);

    const thirdClaim = await thirdGuest.guestInnClaim('quiet', 1);
    assert.equal(thirdClaim.status, 201);

    ctx.advanceClock(NIGHT_SEC + 1);
    ctx.advanceClock(3601);

    const extExpired = await signedPost(ctx, 'third-guest', thirdKeys, '/api/town/inn/guest/extend', {
      handle: 'third-guest',
      pubkey: thirdKeys.pubkey,
      room: 'quiet',
      key: thirdClaim.data.key,
      extra_nights: 1,
    });
    assert.equal(extExpired.status, 404);
    assert.equal(extExpired.data.error, 'claim_not_found');

    const st1 = await secondGuest.state();
    assert.equal(st1.status, 200);
    assert.equal(st1.data.inn.window, null);

    const reclaim = await signedPost(ctx, 'second-guest', secondKeys, '/api/town/inn/guest/claim', {
      handle: 'second-guest',
      pubkey: secondKeys.pubkey,
      room: 'window',
      nights: 2,
    });
    assert.equal(reclaim.status, 201);
    assert.notEqual(reclaim.data.key, firstClaim.data.key);
    assert.equal(reclaim.data.nights, 2);

    const extOld = await signedPost(ctx, 'first-guest', firstKeys, '/api/town/inn/guest/extend', {
      handle: 'first-guest',
      pubkey: firstKeys.pubkey,
      room: 'window',
      key: firstClaim.data.key,
      extra_nights: 1,
    });
    assert.equal(extOld.status, 403);
    assert.equal(extOld.data.error, 'invalid_key');

    const st2 = await secondGuest.state();
    assert.equal(st2.status, 200);
    assert.equal(st2.data.inn.window.handle, 'second-guest');
  } finally {
    await ctx.close();
  }
});

test('guest validation order: handle beats status_text, body beats kind beats reply_to, room beats nights', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'orderguest', ...keys });

    const badHandle = await signedPost(ctx, 'BAD!', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'BAD!',
      pubkey: keys.pubkey,
      status_text: 'x'.repeat(121),
    });
    assert.equal(badHandle.status, 400);
    assert.equal(badHandle.data.error, 'invalid_handle');

    const emptySay = await guest.guestSay('', 'shout');
    assert.equal(emptySay.status, 400);
    assert.equal(emptySay.data.error, 'invalid_body');

    const badKind = await guest.guestSay('ok', 'shout', 99999);
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');

    const wsSay = await guest.guestSay('   ', 'say', 99999);
    assert.equal(wsSay.status, 400);
    assert.equal(wsSay.data.error, 'invalid_body');

    const badRoom = await signedPost(ctx, 'orderguest', keys, '/api/town/inn/guest/claim', {
      handle: 'orderguest',
      pubkey: keys.pubkey,
      room: 'nope',
      nights: 99,
    });
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data.error, 'invalid_room');

    const badNights = await signedPost(ctx, 'orderguest', keys, '/api/town/inn/guest/claim', {
      handle: 'orderguest',
      pubkey: keys.pubkey,
      room: 'window',
      nights: 99,
    });
    assert.equal(badNights.status, 400);
    assert.equal(badNights.data.error, 'invalid_nights');

    const longStatus = await signedPost(ctx, 'orderguest', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'orderguest',
      pubkey: keys.pubkey,
      status_text: 'x'.repeat(121),
    });
    assert.equal(longStatus.status, 400);
    assert.equal(longStatus.data.error, 'status_text_too_long');
  } finally {
    await ctx.close();
  }
});

test('guest mutations step state_seq by exactly +1 each', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'seq-guest', ...keys });

    const st0 = await guest.state();
    assert.equal(st0.status, 200);
    const s0 = st0.data.state_seq;

    const checkin = await guest.guestCheckin({ status_text: 'stepping' });
    assert.equal(checkin.status, 200);
    assert.equal(checkin.data.state_seq, s0 + 1);

    const st1 = await guest.state();
    assert.equal(st1.status, 200);
    assert.equal(st1.data.state_seq, s0 + 1);
    const s1 = st1.data.state_seq;

    const say = await guest.guestSay('hello step');
    assert.equal(say.status, 201);
    assert.equal(say.data.state_seq, s1 + 1);

    const claim = await guest.guestInnClaim('lantern', 1);
    assert.equal(claim.status, 201);
    assert.equal(claim.data.state_seq, say.data.state_seq + 1);

    const extend = await guest.guestInnExtend('lantern', claim.data.key, 1);
    assert.equal(extend.status, 200);
    assert.equal(extend.data.state_seq, claim.data.state_seq + 1);

    const vacate = await guest.guestInnVacate('lantern', claim.data.key);
    assert.equal(vacate.status, 200);
    assert.equal(vacate.data.state_seq, extend.data.state_seq + 1);
  } finally {
    await ctx.close();
  }
});

test('guest checkin ignores zone/role body fields; empty and 120-multibyte status_text accepted', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'visitor-g2', ...keys });

    const res1 = await signedPost(ctx, 'visitor-g2', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'visitor-g2',
      pubkey: keys.pubkey,
      zone: 'plot:wick',
      role: 'npc',
      status_text: '',
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.data.zone, 'bandstand');

    const st = await guest.state();
    assert.equal(st.status, 200);
    const pres = st.data.presence.find((p) => p.handle === 'visitor-g2');
    assert.ok(pres);
    assert.equal(pres.role, 'guest');
    assert.equal(pres.zone, 'bandstand');

    ctx.advanceClock(301);
    const res2 = await signedPost(ctx, 'visitor-g2', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'visitor-g2',
      pubkey: keys.pubkey,
      status_text: 'é'.repeat(120),
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.zone, 'bandstand');
  } finally {
    await ctx.close();
  }
});

test('guest say: emote + reply_to combined; created_at in-window; reply_to 0 and -1 rejected', async () => {
  const ctx = await startTestServer();
  try {
    const keysA = generateKeypair();
    const keysB = generateKeypair();
    const guestA = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'say-a', ...keysA });
    const guestB = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'say-b', ...keysB });

    const top = await guestA.guestSay('top line');
    assert.equal(top.status, 201);

    const tBefore = ctx.nowSec();
    const reply = await guestB.guestSay('nods along', 'emote', top.data.id);
    const tAfter = ctx.nowSec();
    assert.equal(reply.status, 201);
    assert.equal(reply.data.kind, 'emote');
    assert.equal(reply.data.reply_to, top.data.id);
    assert.ok(reply.data.created_at >= tBefore && reply.data.created_at <= tAfter);

    const badZero = await guestB.guestSay('bad zero', 'say', 0);
    assert.equal(badZero.status, 400);
    assert.equal(badZero.data.error, 'invalid_reply_to');

    const badNeg = await guestB.guestSay('bad neg', 'say', -1);
    assert.equal(badNeg.status, 400);
    assert.equal(badNeg.data.error, 'invalid_reply_to');
  } finally {
    await ctx.close();
  }
});

test('guest say multibyte body: 500 chars accepted, 501 rejected (chars, not bytes)', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'mb-guest', ...keys });

    const ok = await guest.guestSay('é'.repeat(500));
    assert.equal(ok.status, 201);
    assert.equal(ok.data.body.length, 500);

    const tooLong = await guest.guestSay('é'.repeat(501));
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'invalid_body');
    assert.equal(tooLong.data.max, 500);
  } finally {
    await ctx.close();
  }
});

test('failed guest validations consume no bucket', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'free-fail', ...keys });

    const badStatus = await signedPost(ctx, 'free-fail', keys, '/api/town/ghostlight/guest/checkin', {
      handle: 'free-fail',
      pubkey: keys.pubkey,
      status_text: 'x'.repeat(121),
    });
    assert.equal(badStatus.status, 400);
    assert.equal(badStatus.data.error, 'status_text_too_long');

    const okCheckin = await guest.guestCheckin();
    assert.equal(okCheckin.status, 200);

    const badRoom = await guest.guestInnClaim('attic', 1);
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data.error, 'invalid_room');

    const okClaim = await guest.guestInnClaim('window', 1);
    assert.equal(okClaim.status, 201);
  } finally {
    await ctx.close();
  }
});

test('guest inn extend 404 consumes the shared 2/hour bucket', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'ext404-guest', ...keys });

    const ext1 = await guest.guestInnExtend('window', 'AAAAAAAAAAAA', 1);
    assert.equal(ext1.status, 404);
    assert.equal(ext1.data.error, 'claim_not_found');

    const ext2 = await guest.guestInnExtend('window', 'AAAAAAAAAAAA', 1);
    assert.equal(ext2.status, 404);
    assert.equal(ext2.data.error, 'claim_not_found');

    const ext3 = await guest.guestInnExtend('window', 'AAAAAAAAAAAA', 1);
    assert.equal(ext3.status, 429);
    assert.equal(ext3.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('exact guest retry_after values: checkin 300, say 600, inn 3600', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'retry-guest', ...keys });

    const c1 = await guest.guestCheckin();
    assert.equal(c1.status, 200);
    const c2 = await guest.guestCheckin();
    assert.equal(c2.status, 429);
    assert.equal(c2.data.error, 'rate_limited');
    assert.equal(c2.data.retry_after, 300);

    const s1 = await guest.guestSay('one');
    assert.equal(s1.status, 201);
    const s2 = await guest.guestSay('two');
    assert.equal(s2.status, 201);
    const s3 = await guest.guestSay('three');
    assert.equal(s3.status, 429);
    assert.equal(s3.data.error, 'rate_limited');
    assert.equal(s3.data.retry_after, 600);

    const claim = await guest.guestInnClaim('lantern', 1);
    assert.equal(claim.status, 201);
    const ext1 = await guest.guestInnExtend('lantern', claim.data.key, 1);
    assert.equal(ext1.status, 200);
    const ext2 = await guest.guestInnExtend('lantern', claim.data.key, 1);
    assert.equal(ext2.status, 429);
    assert.equal(ext2.data.error, 'rate_limited');
    assert.equal(ext2.data.retry_after, 3600);
  } finally {
    await ctx.close();
  }
});

test('guest inn extend/vacate validation edges + exact response keys', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'edge-guest', ...keys });

    const claim = await guest.guestInnClaim('lantern', 2);
    assert.equal(claim.status, 201);
    const { key } = claim.data;

    const extMissing = await signedPost(ctx, 'edge-guest', keys, '/api/town/inn/guest/extend', {
      handle: 'edge-guest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key,
    });
    assert.equal(extMissing.status, 400);
    assert.equal(extMissing.data.error, 'invalid_extra_nights');

    const extNeg = await signedPost(ctx, 'edge-guest', keys, '/api/town/inn/guest/extend', {
      handle: 'edge-guest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key,
      extra_nights: -1,
    });
    assert.equal(extNeg.status, 400);
    assert.equal(extNeg.data.error, 'invalid_extra_nights');

    const extNumKey = await signedPost(ctx, 'edge-guest', keys, '/api/town/inn/guest/extend', {
      handle: 'edge-guest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key: 123,
      extra_nights: 1,
    });
    assert.equal(extNumKey.status, 400);
    assert.equal(extNumKey.data.error, 'missing_key');

    const vacEmptyKey = await signedPost(ctx, 'edge-guest', keys, '/api/town/inn/guest/vacate', {
      handle: 'edge-guest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key: '',
    });
    assert.equal(vacEmptyKey.status, 400);
    assert.equal(vacEmptyKey.data.error, 'missing_key');

    const vacNumRoom = await signedPost(ctx, 'edge-guest', keys, '/api/town/inn/guest/vacate', {
      handle: 'edge-guest',
      pubkey: keys.pubkey,
      room: 123,
      key,
    });
    assert.equal(vacNumRoom.status, 400);
    assert.equal(vacNumRoom.data.error, 'invalid_room');

    const extOk = await guest.guestInnExtend('lantern', key, 1);
    assert.equal(extOk.status, 200);
    assert.deepEqual(
      Object.keys(extOk.data).sort(),
      ['claimed_at', 'expires_at', 'handle', 'nights', 'room', 'state_seq'],
    );

    ctx.advanceClock(3601);
    const swappedKey = [...key]
      .map((c) => (c >= 'a' && c <= 'z' ? c.toUpperCase() : c >= 'A' && c <= 'Z' ? c.toLowerCase() : c))
      .join('');
    assert.notEqual(swappedKey, key);

    const extWrongCase = await signedPost(ctx, 'edge-guest', keys, '/api/town/inn/guest/extend', {
      handle: 'edge-guest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key: swappedKey,
      extra_nights: 1,
    });
    assert.equal(extWrongCase.status, 403);
    assert.equal(extWrongCase.data.error, 'invalid_key');

    const vacOk = await signedPost(ctx, 'edge-guest', keys, '/api/town/inn/guest/vacate', {
      handle: 'edge-guest',
      pubkey: keys.pubkey,
      room: 'lantern',
      key,
    });
    assert.equal(vacOk.status, 200);
    assert.deepEqual(Object.keys(vacOk.data).sort(), ['handle', 'room', 'state_seq', 'vacated']);
  } finally {
    await ctx.close();
  }
});

test('pending resident handle still collides on all three guest entry points', async () => {
  const ctx = await startTestServer();
  try {
    await createResident(ctx, 'alder354');
    ctx.db.prepare("UPDATE residents SET status = 'pending' WHERE handle = ?").run('alder354');

    const guestKeys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alder354', ...guestKeys });

    const checkin = await guest.guestCheckin();
    assert.equal(checkin.status, 409);
    assert.equal(checkin.data.error, 'handle_taken');

    const say = await guest.guestSay('hi');
    assert.equal(say.status, 409);
    assert.equal(say.data.error, 'handle_taken');

    const claim = await guest.guestInnClaim('lantern', 1);
    assert.equal(claim.status, 409);
    assert.equal(claim.data.error, 'handle_taken');
  } finally {
    await ctx.close();
  }
});

test('same keypair, two guest handles, two Inn rooms; guest presence never expires', async () => {
  const ctx = await startTestServer();
  try {
    const sharedKeys = generateKeypair();
    const guestA = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'keypair-a', ...sharedKeys });
    const guestB = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'keypair-b', ...sharedKeys });

    const checkinA = await guestA.guestCheckin();
    assert.equal(checkinA.status, 200);

    const claimA = await guestA.guestInnClaim('lantern', 1);
    assert.equal(claimA.status, 201);

    const claimB = await guestB.guestInnClaim('window', 1);
    assert.equal(claimB.status, 201);
    assert.notEqual(claimB.data.key, claimA.data.key);

    const extA = await guestA.guestInnExtend('lantern', claimA.data.key, 1);
    assert.equal(extA.status, 200);
    assert.equal(extA.data.nights, 2);

    ctx.advanceClock(2 * NIGHT_SEC);

    const st = await guestA.state();
    assert.equal(st.status, 200);
    const presA = st.data.presence.find((p) => p.handle === 'keypair-a');
    assert.ok(presA);
    assert.equal(presA.zone, 'bandstand');
    assert.equal(st.data.inn.lantern, null);
  } finally {
    await ctx.close();
  }
});

test('guest say reply_to nonexistent positive id 400s free and reply to resident line succeeds', async () => {
  const ctx = await startTestServer();
  try {
    const { client: resClient } = await createResident(ctx, 'res-one');
    const resSay = await resClient.say('a resident line');
    assert.equal(resSay.status, 201);
    const resId = resSay.data.id;

    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'reply-guest', ...keys });

    const bad = await guest.guestSay('nope', 'say', 9999);
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.data, { error: 'invalid_reply_to' });

    const reply = await guest.guestSay('hello back', 'say', resId);
    assert.equal(reply.status, 201);
    assert.equal(reply.data.reply_to, resId);

    const plain = await guest.guestSay('plain line');
    assert.equal(plain.status, 201);

    const limited = await guest.guestSay('third line');
    assert.equal(limited.status, 429);
    assert.equal(limited.data.error, 'rate_limited');

    const st = await guest.state();
    assert.equal(st.status, 200);
    const entry = st.data.prompt_book.find((e) => e.id === reply.data.id);
    assert.ok(entry);
    assert.equal(entry.role, 'guest');
    assert.equal(entry.reply_to, resId);
    assert.equal(entry.body, 'hello back');
  } finally {
    await ctx.close();
  }
});

test('guest say 201 exact response keys, kind edges, and per-handle say buckets', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'keys-guest', ...keys });

    const first = await guest.guestSay('first');
    assert.equal(first.status, 201);
    assert.deepEqual(Object.keys(first.data).sort(), [
      'body',
      'created_at',
      'handle',
      'id',
      'kind',
      'reply_to',
      'state_seq',
    ]);
    assert.equal(first.data.kind, 'say');
    assert.equal(first.data.reply_to, null);

    const second = await signedPost(ctx, 'keys-guest', keys, '/api/town/ghostlight/guest/say', {
      handle: 'keys-guest',
      pubkey: keys.pubkey,
      body: 'second',
      kind: null,
    });
    assert.equal(second.status, 201);
    assert.equal(second.data.kind, 'say');

    const badCase = await signedPost(ctx, 'keys-guest', keys, '/api/town/ghostlight/guest/say', {
      handle: 'keys-guest',
      pubkey: keys.pubkey,
      body: 'bad case',
      kind: 'Say',
    });
    assert.equal(badCase.status, 400);
    assert.deepEqual(badCase.data, { error: 'invalid_kind' });

    const emptyKind = await signedPost(ctx, 'keys-guest', keys, '/api/town/ghostlight/guest/say', {
      handle: 'keys-guest',
      pubkey: keys.pubkey,
      body: 'empty kind',
      kind: '',
    });
    assert.equal(emptyKind.status, 400);
    assert.deepEqual(emptyKind.data, { error: 'invalid_kind' });

    const keysB = generateKeypair();
    const guestB = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'keys-guest-b', ...keysB });
    assert.equal((await guestB.guestSay('b1')).status, 201);
    assert.equal((await guestB.guestSay('b2')).status, 201);
    const b3 = await guestB.guestSay('b3');
    assert.equal(b3.status, 429);
    assert.equal(b3.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});

test('guest can join as resident afterwards and roles flip at read time', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'soon-resident', ...keys });

    assert.equal((await guest.guestCheckin()).status, 200);
    const say = await guest.guestSay('visiting first');
    assert.equal(say.status, 201);
    const sayId = say.data.id;
    assert.equal((await guest.guestInnClaim('lantern', 2)).status, 201);

    const before = await guest.state();
    assert.equal(before.status, 200);
    const presBefore = before.data.presence.find((p) => p.handle === 'soon-resident');
    assert.ok(presBefore);
    assert.equal(presBefore.role, 'guest');

    const joined = await guest.join({ origin: 'musebook' });
    assert.equal(joined.status, 201);
    const approved = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'soon-resident',
      role: 'muse',
    });
    assert.equal(approved.status, 200);

    const after = await guest.state();
    assert.equal(after.status, 200);
    const presAfter = after.data.presence.find((p) => p.handle === 'soon-resident');
    assert.ok(presAfter);
    assert.equal(presAfter.role, 'muse');
    const lineAfter = after.data.prompt_book.find((e) => e.id === sayId);
    assert.ok(lineAfter);
    assert.equal(lineAfter.role, 'muse');
    assert.equal(after.data.inn.lantern.handle, 'soon-resident');
    assert.equal(after.data.inn.lantern.guest, true);
  } finally {
    await ctx.close();
  }
});

test('guest inn extend expiry is anchored to claimed_at, not to now', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'extend-guest', ...keys });

    const claim = await guest.guestInnClaim('window', 2);
    assert.equal(claim.status, 201);
    const claimedAt = claim.data.claimed_at;
    assert.equal(claim.data.expires_at, claimedAt + 2 * NIGHT_SEC);

    ctx.advanceClock(NIGHT_SEC);

    const ext = await signedPost(ctx, 'extend-guest', keys, '/api/town/inn/guest/extend', {
      handle: 'extend-guest',
      pubkey: keys.pubkey,
      room: 'window',
      key: claim.data.key,
      extra_nights: 1,
    });
    assert.equal(ext.status, 200);
    assert.equal(ext.data.nights, 3);
    assert.equal(ext.data.claimed_at, claimedAt);
    assert.equal(ext.data.expires_at, claimedAt + 3 * NIGHT_SEC);
  } finally {
    await ctx.close();
  }
});

test('wrong pubkey with right key returns 403 pubkey_mismatch on extend and vacate and claim survives', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'mismatch-guest', ...keys });

    const claim = await guest.guestInnClaim('lantern', 2);
    assert.equal(claim.status, 201);

    const otherKeys = generateKeypair();
    const imposter = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'mismatch-guest', ...otherKeys });

    const badExt = await imposter.guestInnExtend('lantern', claim.data.key, 1);
    assert.equal(badExt.status, 403);
    assert.deepEqual(badExt.data, { error: 'pubkey_mismatch' });

    const badVac = await imposter.guestInnVacate('lantern', claim.data.key);
    assert.equal(badVac.status, 403);
    assert.deepEqual(badVac.data, { error: 'pubkey_mismatch' });

    const st = await guest.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.inn.lantern.handle, 'mismatch-guest');
    assert.equal(st.data.inn.lantern.nights, 2);

    const okVac = await guest.guestInnVacate('lantern', claim.data.key);
    assert.equal(okVac.status, 200);
  } finally {
    await ctx.close();
  }
});

test('guest inn vacate is not rate-limited and consumes no claim bucket', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'nolimit-guest', ...keys });

    const claim = await guest.guestInnClaim('quiet', 1);
    assert.equal(claim.status, 201);

    const ext = await guest.guestInnExtend('quiet', claim.data.key, 1);
    assert.equal(ext.status, 200);

    const vac = await guest.guestInnVacate('quiet', claim.data.key);
    assert.equal(vac.status, 200);

    const vacAgain = await guest.guestInnVacate('quiet', claim.data.key);
    assert.equal(vacAgain.status, 404);
    assert.deepEqual(vacAgain.data, { error: 'claim_not_found' });

    const reclaim = await guest.guestInnClaim('quiet', 1);
    assert.equal(reclaim.status, 429);
    assert.equal(reclaim.data.error, 'rate_limited');
    assert.equal(reclaim.data.retry_after, 3600);
  } finally {
    await ctx.close();
  }
});

test('inn_claims DB row exact shape and PRAGMA table_info schema', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'dbrow-guest', ...keys });

    const claim = await guest.guestInnClaim('window', 2);
    assert.equal(claim.status, 201);

    const rows = ctx.db
      .prepare('SELECT room, handle, claimed_at, nights, expires_at, key_code, pubkey FROM inn_claims')
      .all()
      .map((r) => ({ ...r }));
    assert.deepEqual(rows, [
      {
        room: 'window',
        handle: 'dbrow-guest',
        claimed_at: claim.data.claimed_at,
        nights: 2,
        expires_at: claim.data.claimed_at + 2 * NIGHT_SEC,
        key_code: claim.data.key,
        pubkey: keys.pubkey,
      },
    ]);

    const cols = ctx.db
      .prepare("PRAGMA table_info('inn_claims')")
      .all()
      .map((r) => ({ ...r }));
    assert.deepEqual(
      cols.map((c) => c.name),
      ['room', 'handle', 'claimed_at', 'nights', 'expires_at', 'key_code', 'pubkey']
    );
    assert.deepEqual(
      cols.map((c) => c.type),
      ['TEXT', 'TEXT', 'INTEGER', 'INTEGER', 'INTEGER', 'TEXT', 'TEXT']
    );
    assert.deepEqual(
      cols.map((c) => c.pk),
      [1, 0, 0, 0, 0, 0, 0]
    );
    assert.deepEqual(
      cols.map((c) => c.notnull),
      [0, 1, 1, 1, 1, 1, 0]
    );
  } finally {
    await ctx.close();
  }
});

test('source pins: guest rate limits, Inn constants, bucket keys, state SELECT, and schema DDL', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const serverSrc = fs.readFileSync(path.join(dir, 'server.mjs'), 'utf8');
  const schemaSrc = fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8');

  assert.ok(serverSrc.includes('  guestCheckin: { max: 1, windowSec: 5 * 60 },'));
  assert.ok(serverSrc.includes('  guestSay: { max: 2, windowSec: 10 * 60 },'));
  assert.ok(serverSrc.includes('  guestInnClaim: { max: 2, windowSec: 60 * 60 },'));

  assert.ok(serverSrc.includes("const INN_ROOMS = ['lantern', 'window', 'quiet'];"));
  assert.ok(serverSrc.includes('const INN_MAX_NIGHTS = 7;'));
  assert.ok(serverSrc.includes('const INN_DEFAULT_NIGHTS = 3;'));
  assert.ok(serverSrc.includes('const INN_KEY_LEN = 12;'));

  assert.ok(serverSrc.includes('`guest-checkin:${handle}`'));
  assert.ok(serverSrc.includes('`guest-say:${handle}`'));
  assert.ok(serverSrc.includes('`guest-inn-claim:${handle}`'));

  assert.ok(serverSrc.includes('SELECT room, handle, nights, expires_at, pubkey FROM inn_claims WHERE expires_at > ?'));

  const expectedDdl = [
    'CREATE TABLE IF NOT EXISTS inn_claims (',
    "    room            TEXT PRIMARY KEY CHECK (room IN ('lantern', 'window', 'quiet')),",
    '    handle          TEXT NOT NULL,',
    '    claimed_at      INTEGER NOT NULL,',
    '    nights          INTEGER NOT NULL CHECK (nights >= 1 AND nights <= 7),',
    '    expires_at      INTEGER NOT NULL,',
    '    key_code        TEXT NOT NULL UNIQUE,',
    '    pubkey          TEXT',
    ');',
  ].join('\n');
  assert.ok(schemaSrc.includes(expectedDdl));
});

test('guest validation order: handle beats room, body, and status_text', async () => {
  const ctx = await startTestServer();
  try {
    await createResident(ctx, 'order-res');

    const k1 = generateKeypair();
    const takenClaim = await signedPost(ctx, 'order-res', k1, '/api/town/inn/guest/claim', {
      handle: 'order-res',
      pubkey: k1.pubkey,
      room: 'Bogus',
    });
    assert.equal(takenClaim.status, 409);
    assert.deepEqual(takenClaim.data, { error: 'handle_taken' });

    const k2 = generateKeypair();
    const badClaim = await signedPost(ctx, 'BAD!', k2, '/api/town/inn/guest/claim', {
      handle: 'BAD!',
      pubkey: k2.pubkey,
      room: 'Bogus',
    });
    assert.equal(badClaim.status, 400);
    assert.deepEqual(badClaim.data, { error: 'invalid_handle' });

    const k3 = generateKeypair();
    const badCheckin = await signedPost(ctx, 'BAD!', k3, '/api/town/ghostlight/guest/checkin', {
      handle: 'BAD!',
      pubkey: k3.pubkey,
      status_text: 'x'.repeat(121),
    });
    assert.equal(badCheckin.status, 400);
    assert.deepEqual(badCheckin.data, { error: 'invalid_handle' });

    const k4 = generateKeypair();
    const takenSay = await signedPost(ctx, 'order-res', k4, '/api/town/ghostlight/guest/say', {
      handle: 'order-res',
      pubkey: k4.pubkey,
      body: '',
    });
    assert.equal(takenSay.status, 409);
    assert.deepEqual(takenSay.data, { error: 'handle_taken' });
  } finally {
    await ctx.close();
  }
});

test('file hygiene: 46 unique names, 7 imports, zero banned terms, pinned as-true counts', () => {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const src = fs.readFileSync(path.join(dir, 'test-guest.mjs'), 'utf8');
  const lines = src.split('\n');

  const names = lines
    .map((l) => l.match(/^test\('([^']+)'/))
    .filter(Boolean)
    .map((m) => m[1]);
  assert.equal(names.length, 56);
  assert.equal(new Set(names).size, 56);

  const importLines = lines.filter((l) => l.startsWith('import '));
  assert.equal(importLines.length, 7);

  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 1);
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 3);
  assert.equal(lines.filter((l) => new RegExp('Math' + '.random').test(l)).length, 0);
});

test('Slice 478 G1: guest checkin handle length and charset boundaries', async () => {
  const ctx = await startTestServer();
  try {
    const cases = [
      ['a', 400], ['ab', 200], ['a'.repeat(32), 200], ['a'.repeat(33), 400],
      ['Ab', 400], ['-ab', 400], ['_ab', 400], ['9lives', 200], ['a_b-c9', 200],
    ];
    for (const [handle, want] of cases) {
      const keys = generateKeypair();
      const res = await signedPost(ctx, handle, keys, '/api/town/ghostlight/guest/checkin', {
        handle, pubkey: keys.pubkey, status_text: 'bounds',
      });
      assert.equal(res.status, want, `${handle} -> ${res.status}`);
      if (want === 400) {
        assert.deepEqual(res.data, { error: 'invalid_handle' });
      } else {
        assert.equal(res.data.zone, 'bandstand');
        assert.equal(typeof res.data.updated_at, 'number');
      }
    }
  } finally {
    await ctx.close();
  }
});

test('Slice 478 G2: all three inn rooms fill and state inn carries exact guest shapes', async () => {
  const ctx = await startTestServer();
  try {
    const probeKeys = generateKeypair();
    const probe = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'probe-g2', ...probeKeys });
    const st0 = await probe.state();
    assert.deepEqual(st0.data.inn, { lantern: null, window: null, quiet: null });

    const claims = [];
    for (const [handle, room, nights] of [['room-a', 'lantern', 1], ['room-b', 'window', 2], ['room-c', 'quiet', 3]]) {
      const keys = generateKeypair();
      const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
      const c = await guest.guestInnClaim(room, nights);
      assert.equal(c.status, 201, `${room} claim ${c.status}`);
      assert.equal(c.data.nights, nights);
      assert.match(c.data.key, UNAMBIGUOUS_KEY_RE);
      claims.push(c.data);
    }
    assert.notEqual(claims[0].key, claims[1].key);
    assert.notEqual(claims[0].key, claims[2].key);
    assert.notEqual(claims[1].key, claims[2].key);

    const st = await probe.state();
    for (const c of claims) {
      const row = st.data.inn[c.room];
      assert.deepEqual(Object.keys(row).sort(), ['expires_at', 'guest', 'handle', 'nights']);
      assert.equal(row.guest, true);
      assert.equal(row.handle, c.handle);
      assert.equal(row.nights, c.nights);
      assert.equal(row.expires_at, c.claimed_at + c.nights * NIGHT_SEC);
    }

    const k4 = generateKeypair();
    const fourth = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'room-d', ...k4 });
    const taken = await fourth.guestInnClaim('lantern', 1);
    assert.equal(taken.status, 409);
    assert.deepEqual(taken.data, { error: 'room_already_claimed' });
  } finally {
    await ctx.close();
  }
});

test('Slice 478 G3: already_claimed consumes the claim bucket and the bucket is per-handle across keypairs', async () => {
  const ctx = await startTestServer();
  try {
    const k1 = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'bucket-guest', ...k1 });
    const c1 = await guest.guestInnClaim('lantern', 1);
    assert.equal(c1.status, 201);
    const c2 = await guest.guestInnClaim('window', 1);
    assert.equal(c2.status, 409);
    assert.deepEqual(c2.data, { error: 'already_claimed' });
    const k2 = generateKeypair();
    const c3 = await signedPost(ctx, 'bucket-guest', k2, '/api/town/inn/guest/claim', {
      handle: 'bucket-guest', pubkey: k2.pubkey, room: 'quiet', nights: 1,
    });
    assert.equal(c3.status, 429);
    assert.equal(c3.data.error, 'rate_limited');
    // 1s tolerance: the wall-clock second can tick between the consuming claim and this attempt.
    assert.ok(c3.data.retry_after >= 3599 && c3.data.retry_after <= 3600);
  } finally {
    await ctx.close();
  }
});

test('Slice 478 G4: guest reply chain nests two deep', async () => {
  const ctx = await startTestServer();
  try {
    const { client: resClient } = await createResident(ctx, 'alder478');
    const s1 = await resClient.say('root line');
    assert.equal(s1.status, 201);
    const ka = generateKeypair();
    const a = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'replier-a', ...ka });
    const r2 = await a.guestSay('reply one', 'say', s1.data.id);
    assert.equal(r2.status, 201);
    assert.equal(r2.data.reply_to, s1.data.id);
    const kb = generateKeypair();
    const b = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'replier-b', ...kb });
    const r3 = await b.guestSay('reply two', 'say', r2.data.id);
    assert.equal(r3.status, 201);
    assert.equal(r3.data.reply_to, r2.data.id);
    assert.ok(s1.data.id < r2.data.id && r2.data.id < r3.data.id);
    const st = await b.state();
    const entry = st.data.prompt_book.find((l) => l.id === r3.data.id);
    assert.ok(entry);
    assert.equal(entry.role, 'guest');
    assert.equal(entry.reply_to, r2.data.id);
    assert.equal(entry.body, 'reply two');
  } finally {
    await ctx.close();
  }
});

test('Slice 478 G5: guest checkin bucket is per-handle across keypairs', async () => {
  const ctx = await startTestServer();
  try {
    const k1 = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'solo-key-guest', ...k1 });
    const c1 = await guest.guestCheckin();
    assert.equal(c1.status, 200);
    const k2 = generateKeypair();
    const c2 = await signedPost(ctx, 'solo-key-guest', k2, '/api/town/ghostlight/guest/checkin', {
      handle: 'solo-key-guest', pubkey: k2.pubkey,
    });
    assert.equal(c2.status, 429);
    assert.equal(c2.data.error, 'rate_limited');
    // 1s tolerance: the wall-clock second can tick between the consuming checkin and this attempt.
    assert.ok(c2.data.retry_after >= 299 && c2.data.retry_after <= 300);
  } finally {
    await ctx.close();
  }
});

test('Slice 478 G6: guest say bucket is per-handle across keypairs', async () => {
  const ctx = await startTestServer();
  try {
    const k1 = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'solo-say-guest', ...k1 });
    assert.equal((await guest.guestSay('one')).status, 201);
    assert.equal((await guest.guestSay('two')).status, 201);
    const k2 = generateKeypair();
    const third = await signedPost(ctx, 'solo-say-guest', k2, '/api/town/ghostlight/guest/say', {
      handle: 'solo-say-guest', pubkey: k2.pubkey, body: 'three', kind: 'say',
    });
    assert.equal(third.status, 429);
    assert.equal(third.data.error, 'rate_limited');
    // 1s tolerance: the wall-clock second can tick between the consuming says and this attempt.
    assert.ok(third.data.retry_after >= 599 && third.data.retry_after <= 600);
  } finally {
    await ctx.close();
  }
});

test('Slice 478 G7: guest inn claim ignores unknown body fields', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const res = await signedPost(ctx, 'extra-guest', keys, '/api/town/inn/guest/claim', {
      handle: 'extra-guest', pubkey: keys.pubkey, room: 'lantern', nights: 2, note: 'hello', vip: true,
    });
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.data).sort(), ['claimed_at', 'expires_at', 'handle', 'key', 'nights', 'room', 'state_seq']);
    const g = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'extra-guest', ...keys });
    const st = await g.state();
    assert.deepEqual(Object.keys(st.data.inn.lantern).sort(), ['expires_at', 'guest', 'handle', 'nights']);
    assert.equal('note' in st.data.inn.lantern, false);
  } finally {
    await ctx.close();
  }
});

test('Slice 478 G8: guest inn extend and vacate with a different handle but the right key and pubkey succeed', async () => {
  const ctx = await startTestServer();
  try {
    const ka = generateKeypair();
    const a = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'claim-guest', ...ka });
    const claim = await a.guestInnClaim('lantern', 2);
    assert.equal(claim.status, 201);
    const claimedAt = claim.data.claimed_at;
    const ext = await signedPost(ctx, 'other-guest', ka, '/api/town/inn/guest/extend', {
      handle: 'other-guest', pubkey: ka.pubkey, room: 'lantern', key: claim.data.key, extra_nights: 1,
    });
    assert.equal(ext.status, 200);
    assert.equal(ext.data.handle, 'claim-guest');
    assert.equal(ext.data.nights, 3);
    assert.equal(ext.data.expires_at, claimedAt + 3 * NIGHT_SEC);
    const vac = await signedPost(ctx, 'other-guest', ka, '/api/town/inn/guest/vacate', {
      handle: 'other-guest', pubkey: ka.pubkey, room: 'lantern', key: claim.data.key,
    });
    assert.equal(vac.status, 200);
    assert.equal(vac.data.vacated, true);
    assert.equal(vac.data.handle, 'claim-guest');
    const st = await a.state();
    assert.equal(st.data.inn.lantern, null);
  } finally {
    await ctx.close();
  }
});

test('Slice 478 G9: guest say emoji boundary counts UTF-16 code units', async () => {
  const ctx = await startTestServer();
  try {
    assert.equal('😀'.length, 2);
    const keys = generateKeypair();
    const guest = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'emoji-guest', ...keys });
    const ok = await guest.guestSay('😀'.repeat(250));
    assert.equal(ok.status, 201);
    assert.equal(ok.data.body.length, 500);
    assert.equal(ok.data.body, '😀'.repeat(250));
    const tooLong = await guest.guestSay('😀'.repeat(251));
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'invalid_body');
    assert.equal(tooLong.data.max, 500);
  } finally {
    await ctx.close();
  }
});

test('Slice 478 G10: guest checkin and claim fall back to the signed handle when body.handle is omitted', async () => {
  const ctx = await startTestServer();
  try {
    const keys = generateKeypair();
    const checkin = await signedPost(ctx, 'fallback-guest', keys, '/api/town/ghostlight/guest/checkin', {
      pubkey: keys.pubkey,
    });
    assert.equal(checkin.status, 200);
    assert.equal(checkin.data.handle, 'fallback-guest');
    const claim = await signedPost(ctx, 'fallback-guest', keys, '/api/town/inn/guest/claim', {
      pubkey: keys.pubkey, room: 'window', nights: 1,
    });
    assert.equal(claim.status, 201);
    assert.equal(claim.data.handle, 'fallback-guest');
  } finally {
    await ctx.close();
  }
});
