/**
 * town-api events unit + integration tests (Slice 81).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';
import {
  selectCurrentEvent as apiSelectCurrentEvent,
  selectNowNext,
  loadEventsFile,
  eventStateKey,
} from './events.mjs';
import { selectCurrentEvent as bannerSelectCurrentEvent } from '../staging-polyfork/event-banner.mjs';

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const baseNow = opts.baseNow !== undefined ? opts.baseNow : Math.floor(Date.now() / 1000);
  const nowFn = opts.nowFn || (() => baseNow + clockOffset);

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: opts.operatorPubkey !== undefined ? opts.operatorPubkey : operatorKeys.pubkey,
    topicsPath: opts.topicsPath,
    eventsPath: opts.eventsPath,
    nowFn,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    tmpDir,
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

async function registerActiveResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({
    baseUrl: ctx.baseUrl,
    handle,
    ...keys,
  });
  const joinRes = await client.join({ origin: 'direct', bio: `${handle} bio` });
  assert.equal(joinRes.status, 201);
  const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
    handle,
  });
  assert.equal(appRes.status, 200);
  return client;
}

test('parity: town-api/events.mjs selectCurrentEvent matches staging-polyfork/event-banner.mjs', () => {
  const baseMs = Date.parse('2026-11-15T18:00:00Z');
  const invalidEntries = [
    null,
    undefined,
    'string',
    [],
    {},
    { title: '', host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: 30, location: 'bandstand', blurb: '' },
    { title: '   ', host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: 30, location: 'bandstand', blurb: '' },
    { title: 'x'.repeat(81), host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: 30, location: 'bandstand', blurb: '' },
    { title: 'Bad Host', host_handle: 'Milo_Upper', start_at: '2026-11-15T18:00:00Z', duration_min: 30, location: 'bandstand', blurb: '' },
    { title: 'Bad Host 2', host_handle: '-milo', start_at: '2026-11-15T18:00:00Z', duration_min: 30, location: 'bandstand', blurb: '' },
    { title: 'Bad Date', host_handle: 'milo', start_at: 'not-a-date', duration_min: 30, location: 'bandstand', blurb: '' },
    { title: 'Short Dur', host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: 14, location: 'bandstand', blurb: '' },
    { title: 'Long Dur', host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: 241, location: 'bandstand', blurb: '' },
    { title: 'Non-num Dur', host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: '30', location: 'bandstand', blurb: '' },
    { title: 'Bad Loc', host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: 30, location: 123, blurb: '' },
    { title: 'Long Blurb', host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: 30, location: 'bandstand', blurb: 'b'.repeat(201) },
  ];

  const pastEv = {
    title: 'Past Reading',
    host_handle: 'milo',
    start_at: '2026-11-15T16:00:00Z',
    duration_min: 60,
    location: 'bandstand',
    blurb: 'already over',
  };
  const nowEvLaterStart = {
    title: 'Later Start Overlap',
    host_handle: 'vera',
    start_at: '2026-11-15T17:45:00Z',
    duration_min: 60,
    location: 'bandstand',
    blurb: '',
  };
  const nowEvEarlierStart = {
    title: 'Earlier Start Overlap',
    host_handle: 'milo',
    start_at: '2026-11-15T17:30:00Z',
    duration_min: 60,
    location: 'bandstand',
    blurb: 'trimmed blurb ',
  };
  const exactStartEv = {
    title: 'Exact Boundary',
    host_handle: 'alice',
    start_at: '2026-11-15T18:00:00Z',
    duration_min: 30,
    location: 'bandstand',
    blurb: '',
  };
  const futureEv = {
    title: 'Future Salon',
    host_handle: 'bob',
    start_at: '2026-11-15T20:00:00Z',
    duration_min: 45,
    location: 'bandstand',
    blurb: '',
  };
  // Slice 236 follow-up: padded start_at must parse (trimmed) in both copies.
  const paddedNowEv = {
    title: 'Padded Now',
    host_handle: 'milo',
    start_at: '  2026-11-15T17:30:00Z  ',
    duration_min: 60,
    location: 'bandstand',
    blurb: '',
  };
  const paddedFutureEv = {
    title: 'Padded Future',
    host_handle: 'vera',
    start_at: '\t2026-11-15T20:00:00Z\n',
    duration_min: 45,
    location: 'bandstand',
    blurb: '',
  };
  const paddedExactEv = {
    title: 'Padded Exact',
    host_handle: 'alice',
    start_at: ' 2026-11-15T18:00:00Z ',
    duration_min: 30,
    location: 'bandstand',
    blurb: '',
  };
  const blankStartEv = {
    title: 'Blank Start',
    host_handle: 'milo',
    start_at: '   ',
    duration_min: 30,
    location: 'bandstand',
    blurb: '',
  };

  const cases = [
    { events: invalidEntries, nowMs: baseMs },
    { events: [...invalidEntries, pastEv], nowMs: baseMs },
    { events: [...invalidEntries, pastEv, nowEvLaterStart, nowEvEarlierStart, futureEv], nowMs: baseMs },
    { events: [exactStartEv, futureEv], nowMs: baseMs }, // now == start_at -> now
    { events: [exactStartEv, futureEv], nowMs: baseMs + 30 * 60_000 }, // now == end -> not now, selects future
    { events: [exactStartEv], nowMs: baseMs + 30 * 60_000 }, // now == end -> null
    { events: [futureEv], nowMs: baseMs - 10_000 },
    { events: 'not-an-array', nowMs: baseMs },
    { events: [exactStartEv], nowMs: NaN },
    { events: [paddedNowEv], nowMs: baseMs }, // padded start parses as now
    { events: [paddedFutureEv], nowMs: baseMs }, // padded start parses as next
    { events: [paddedExactEv, paddedFutureEv], nowMs: baseMs }, // padded exact start -> now
    { events: [blankStartEv], nowMs: baseMs }, // whitespace-only start is invalid
    { events: [blankStartEv, paddedNowEv], nowMs: baseMs }, // blank skipped, padded wins
  ];

  for (const c of cases) {
    assert.deepEqual(
      apiSelectCurrentEvent(c.events, c.nowMs),
      bannerSelectCurrentEvent(c.events, c.nowMs)
    );
  }

  // The returned event carries the trimmed start_at in both copies.
  assert.equal(
    apiSelectCurrentEvent([paddedNowEv], baseMs)?.event?.start_at,
    '2026-11-15T17:30:00Z'
  );
  assert.equal(
    bannerSelectCurrentEvent([paddedNowEv], baseMs)?.event?.start_at,
    '2026-11-15T17:30:00Z'
  );
});

test('selectNowNext returns now+next, only-next, none, ignores past, earliest start wins', () => {
  const t0 = Date.parse('2026-11-15T18:00:00Z');
  const past = {
    title: 'Past',
    host_handle: 'milo',
    start_at: '2026-11-15T16:00:00Z',
    duration_min: 30,
    location: 'bandstand',
    blurb: '',
  };
  const now1 = {
    title: 'Now Later',
    host_handle: 'vera',
    start_at: '2026-11-15T17:50:00Z',
    duration_min: 60,
    location: 'bandstand',
    blurb: '',
  };
  const now2 = {
    title: 'Now Earlier',
    host_handle: 'milo',
    start_at: '2026-11-15T17:30:00Z',
    duration_min: 60,
    location: 'bandstand',
    blurb: '',
  };
  const next1 = {
    title: 'Next Later',
    host_handle: 'bob',
    start_at: '2026-11-15T21:00:00Z',
    duration_min: 30,
    location: 'bandstand',
    blurb: '',
  };
  const next2 = {
    title: 'Next Earlier',
    host_handle: 'alice',
    start_at: '2026-11-15T19:00:00Z',
    duration_min: 30,
    location: 'bandstand',
    blurb: '',
  };

  const both = selectNowNext([past, now1, now2, next1, next2], t0);
  assert.equal(both.now?.title, 'Now Earlier');
  assert.equal(both.next?.title, 'Next Earlier');

  const onlyNext = selectNowNext([past, next1, next2], t0);
  assert.equal(onlyNext.now, null);
  assert.equal(onlyNext.next?.title, 'Next Earlier');

  const none = selectNowNext([past, { title: 'bad' }], t0);
  assert.deepEqual(none, { now: null, next: null });
});

test('eventStateKey formats now, next-only, and empty keys', () => {
  const evA = { title: 'Open Mic', host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: 30, location: '', blurb: '' };
  const evB = { title: 'Late Tea', host_handle: 'vera', start_at: '2026-11-15T20:00:00Z', duration_min: 30, location: '', blurb: '' };

  assert.equal(eventStateKey(evA, evB), 'now|Open Mic|2026-11-15T18:00:00Z');
  assert.equal(eventStateKey(null, evB), 'next|Late Tea|2026-11-15T20:00:00Z');
  assert.equal(eventStateKey(null, null), '');
});

test('selectCurrentEvent guards against non-array, empty, non-finite nowMs, and blank title', () => {
  const T0 = Date.parse('2026-11-20T18:00:00Z');
  const ev = (overrides = {}) => ({
    title: 'Reading',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'Bandstand',
    blurb: 'A reading.',
    ...overrides,
  });

  assert.equal(apiSelectCurrentEvent(null, T0), null);
  assert.equal(apiSelectCurrentEvent('nope', T0), null);
  assert.equal(apiSelectCurrentEvent([], T0), null);
  assert.equal(apiSelectCurrentEvent([ev()], NaN), null);
  assert.equal(apiSelectCurrentEvent([ev()], Infinity), null);
  assert.equal(apiSelectCurrentEvent([ev({ title: '  ' })], T0), null);
});

test('selectCurrentEvent handles start and end time boundaries', () => {
  const T0 = Date.parse('2026-11-20T18:00:00Z');
  const endMs = T0 + 60 * 60_000;
  const ev = (overrides = {}) => ({
    title: 'Reading',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'Bandstand',
    blurb: 'A reading.',
    ...overrides,
  });
  const base = ev();
  const later = ev({ title: 'Later', start_at: '2026-11-20T20:00:00Z' });

  assert.deepEqual(apiSelectCurrentEvent([base], T0), { event: base, status: 'now' });
  assert.deepEqual(apiSelectCurrentEvent([base], T0 - 1), { event: base, status: 'next' });
  assert.equal(apiSelectCurrentEvent([base], endMs), null);
  assert.equal(apiSelectCurrentEvent([base], endMs - 1)?.status, 'now');
  assert.deepEqual(apiSelectCurrentEvent([base, later], endMs), { event: later, status: 'next' });
});

test('selectCurrentEvent picks earliest start among overlapping now events regardless of order', () => {
  const T0 = Date.parse('2026-11-20T18:00:00Z');
  const ev = (overrides = {}) => ({
    title: 'Reading',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'Bandstand',
    blurb: 'A reading.',
    ...overrides,
  });
  const a = ev({ title: 'Early', start_at: '2026-11-20T17:30:00Z', duration_min: 120 });
  const b = ev({ title: 'Late', start_at: '2026-11-20T18:00:00Z', duration_min: 60 });

  assert.equal(apiSelectCurrentEvent([b, a], T0)?.event.title, 'Early');
  assert.equal(apiSelectCurrentEvent([a, b], T0)?.event.title, 'Early');
});

test('selectCurrentEvent enforces validation edges and trims string fields', () => {
  const T0 = Date.parse('2026-11-20T18:00:00Z');
  const ev = (overrides = {}) => ({
    title: 'Reading',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'Bandstand',
    blurb: 'A reading.',
    ...overrides,
  });

  assert.equal(apiSelectCurrentEvent([ev({ duration_min: 14 })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ duration_min: 15 })], T0)?.status, 'now');
  assert.equal(apiSelectCurrentEvent([ev({ duration_min: 241 })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ duration_min: 240 })], T0)?.status, 'now');

  assert.equal(apiSelectCurrentEvent([ev({ blurb: 'x'.repeat(201) })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ blurb: 'x'.repeat(200) })], T0)?.status, 'now');

  assert.equal(apiSelectCurrentEvent([ev({ title: 'x'.repeat(81) })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ title: 'x'.repeat(80) })], T0)?.status, 'now');

  assert.equal(apiSelectCurrentEvent([ev({ host_handle: 'Milo' })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ host_handle: 'a b' })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ start_at: 'not-a-date' })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ duration_min: '60' })], T0), null);

  const trimmed = apiSelectCurrentEvent(
    [ev({ title: '  Reading  ', host_handle: '  milo ', blurb: '  hi  ' })],
    T0
  );
  assert.equal(trimmed?.event.title, 'Reading');
  assert.equal(trimmed?.event.host_handle, 'milo');
  assert.equal(trimmed?.event.blurb, 'hi');
  assert.equal(trimmed?.event.location, 'Bandstand');
});

test('selectNowNext handles guards, now+later, and now-only', () => {
  const T0 = Date.parse('2026-11-20T18:00:00Z');
  const ev = (overrides = {}) => ({
    title: 'Reading',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'Bandstand',
    blurb: 'A reading.',
    ...overrides,
  });
  const base = ev();
  const later = ev({ title: 'Later', start_at: '2026-11-20T20:00:00Z' });

  assert.deepEqual(selectNowNext(null, T0), { now: null, next: null });
  assert.deepEqual(selectNowNext([base], NaN), { now: null, next: null });

  const both = selectNowNext([base, later], T0);
  assert.equal(both.now?.title, 'Reading');
  assert.equal(both.next?.title, 'Later');

  const nowOnly = selectNowNext([base], T0);
  assert.equal(nowOnly.now?.title, 'Reading');
  assert.equal(nowOnly.next, null);
});

test('eventStateKey prefers now when both now and next are present', () => {
  const ev = (overrides = {}) => ({
    title: 'Reading',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'Bandstand',
    blurb: 'A reading.',
    ...overrides,
  });
  const nowEvent = ev();
  const nextEvent = ev({ title: 'Later', start_at: '2026-11-20T20:00:00Z' });

  assert.equal(eventStateKey(nowEvent, nextEvent), 'now|Reading|2026-11-20T18:00:00Z');
  assert.equal(eventStateKey(null, nextEvent), 'next|Later|2026-11-20T20:00:00Z');
  assert.equal(eventStateKey(null, null), '');
});

test('loadEventsFile validates entries and fails open on missing/malformed/bad-shape/null paths', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-load-events-'));
  try {
    const validFile = path.join(tmpDir, 'valid.json');
    fs.writeFileSync(
      validFile,
      JSON.stringify({
        events: [
          {
            title: '  Reading Hour  ',
            host_handle: 'milo',
            start_at: '2026-11-15T18:00:00Z',
            duration_min: 30,
            location: 'bandstand',
            blurb: 'bring tea',
          },
          { title: '', host_handle: 'milo', start_at: '2026-11-15T18:00:00Z', duration_min: 30, location: '', blurb: '' },
          null,
        ],
      }),
      'utf8'
    );
    const loaded = loadEventsFile(validFile);
    assert.equal(loaded.events.length, 1);
    assert.equal(loaded.events[0].title, 'Reading Hour');

    assert.deepEqual(loadEventsFile(path.join(tmpDir, 'missing.json')), { events: [] });

    const badJsonFile = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badJsonFile, '{not json', 'utf8');
    assert.deepEqual(loadEventsFile(badJsonFile), { events: [] });

    const wrongShapeFile = path.join(tmpDir, 'shape.json');
    fs.writeFileSync(wrongShapeFile, JSON.stringify({ items: [] }), 'utf8');
    assert.deepEqual(loadEventsFile(wrongShapeFile), { events: [] });

    assert.deepEqual(loadEventsFile(null), { events: [] });
    assert.deepEqual(loadEventsFile(''), { events: [] });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('server integration: host footlight override, state_seq bump on flip, since= 304/200, and end of window', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startIso = new Date((baseNow + 300) * 1000).toISOString();
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-srv-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({
      events: [
        {
          title: 'Lantern Reading',
          host_handle: 'host',
          start_at: startIso,
          duration_min: 30,
          location: 'bandstand',
          blurb: 'poetry by lantern light',
        },
      ],
    }),
    'utf8'
  );

  // Start 5 minutes before start_at
  const ctx = await startTestServer({ baseNow, eventsPath });
  try {
    const host = await registerActiveResident(ctx, 'host');
    const other = await registerActiveResident(ctx, 'other');

    await host.checkin({ status_text: 'my own words', slot: 0 });
    await other.checkin({ status_text: 'other words', slot: 1 });

    // Before start_at: events.next is populated, host keeps 'my own words' and has no event flag
    const beforeRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(beforeRes.status, 200);
    const beforeState = await beforeRes.json();
    assert.equal(beforeState.events.now, null);
    assert.equal(beforeState.events.next?.title, 'Lantern Reading');
    const hostBefore = beforeState.footlights.find((f) => f.handle === 'host');
    assert.equal(hostBefore.status_text, 'my own words');
    assert.equal('event' in hostBefore, false);

    // Poll with since=beforeState.state_seq while still before start_at -> 304
    const stillBefore = await fetch(`${ctx.baseUrl}/api/town/state?since=${beforeState.state_seq}`);
    assert.equal(stillBefore.status, 304);

    // Advance clock into the event window (at start_at + 60s)
    ctx.advanceClock(360);
    const duringRes = await fetch(`${ctx.baseUrl}/api/town/state?since=${beforeState.state_seq}`);
    assert.equal(duringRes.status, 200);
    const duringState = await duringRes.json();
    assert.ok(duringState.state_seq > beforeState.state_seq);
    assert.equal(duringState.events.now?.title, 'Lantern Reading');
    assert.equal(duringState.events.next, null);

    const hostDuring = duringState.footlights.find((f) => f.handle === 'host');
    assert.equal(hostDuring.status_text, 'Lantern Reading');
    assert.equal(hostDuring.event, true);

    const otherDuring = duringState.footlights.find((f) => f.handle === 'other');
    assert.equal(otherDuring.status_text, 'other words');
    assert.equal('event' in otherDuring, false);

    // Advance past window end (30 min = 1800s, still within 45-min footlight TTL)
    ctx.advanceClock(1800);
    const afterRes = await fetch(`${ctx.baseUrl}/api/town/state?since=${duringState.state_seq}`);
    assert.equal(afterRes.status, 200);
    const afterState = await afterRes.json();
    assert.ok(afterState.state_seq > duringState.state_seq);
    assert.deepEqual(afterState.events, { now: null, next: null });
    const hostAfter = afterState.footlights.find((f) => f.handle === 'host');
    assert.equal(hostAfter.status_text, 'my own words');
    assert.equal('event' in hostAfter, false);
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('server integration: host not checked in does not fabricate a footlight row', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startIso = new Date((baseNow - 60) * 1000).toISOString();
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-nolit-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({
      events: [
        {
          title: 'Silent Host Event',
          host_handle: 'host',
          start_at: startIso,
          duration_min: 30,
          location: 'bandstand',
          blurb: '',
        },
      ],
    }),
    'utf8'
  );

  const ctx = await startTestServer({ baseNow, eventsPath });
  try {
    await registerActiveResident(ctx, 'host');
    const res = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(res.status, 200);
    const state = await res.json();
    assert.equal(state.events.now?.title, 'Silent Host Event');
    assert.equal(state.footlights.length, 0);
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('server integration: host handle not a resident does not crash', async () => {
  const startSec = Math.floor(Date.parse('2026-11-15T18:00:00Z') / 1000);
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-nores-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({
      events: [
        {
          title: 'Ghost Host Event',
          host_handle: 'nonexistent',
          start_at: '2026-11-15T18:00:00Z',
          duration_min: 30,
          location: 'bandstand',
          blurb: '',
        },
      ],
    }),
    'utf8'
  );

  const ctx = await startTestServer({ baseNow: startSec + 60, eventsPath });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(res.status, 200);
    const state = await res.json();
    assert.equal(state.events.now?.title, 'Ghost Host Event');
    assert.equal(state.footlights.length, 0);
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('server integration: missing events file serves null/null without crashing', async () => {
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-miss-'));
  const missingPath = path.join(tmpEventsDir, 'does-not-exist.json');
  const ctx = await startTestServer({ eventsPath: missingPath });
  try {
    const res = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(res.status, 200);
    const state = await res.json();
    assert.deepEqual(state.events, { now: null, next: null });
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('server integration: file edit picked up via mtime without server restart', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startIso = new Date((baseNow - 60) * 1000).toISOString();
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-mtime-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({
      events: [
        {
          title: 'Original Title',
          host_handle: 'host',
          start_at: startIso,
          duration_min: 30,
          location: 'bandstand',
          blurb: '',
        },
      ],
    }),
    'utf8'
  );
  const t1 = new Date('2026-11-15T17:00:00Z');
  fs.utimesSync(eventsPath, t1, t1);

  const ctx = await startTestServer({ baseNow, eventsPath });
  try {
    const host = await registerActiveResident(ctx, 'host');
    await host.checkin({ status_text: 'initial', slot: 0 });

    const res1 = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(res1.status, 200);
    const s1 = await res1.json();
    assert.equal(s1.events.now?.title, 'Original Title');
    assert.equal(s1.footlights.find((f) => f.handle === 'host').status_text, 'Original Title');

    // Rewrite with a new title and bump mtime
    fs.writeFileSync(
      eventsPath,
      JSON.stringify({
        events: [
          {
            title: 'Updated Title',
            host_handle: 'host',
            start_at: startIso,
            duration_min: 30,
            location: 'bandstand',
            blurb: '',
          },
        ],
      }),
      'utf8'
    );
    const t2 = new Date('2026-11-15T17:05:00Z');
    fs.utimesSync(eventsPath, t2, t2);

    const res2 = await fetch(`${ctx.baseUrl}/api/town/state?since=${s1.state_seq}`);
    assert.equal(res2.status, 200);
    const s2 = await res2.json();
    assert.ok(s2.state_seq > s1.state_seq);
    assert.equal(s2.events.now?.title, 'Updated Title');
    assert.equal(s2.footlights.find((f) => f.handle === 'host').status_text, 'Updated Title');
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

async function registerResidentWithKeys(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({
    baseUrl: ctx.baseUrl,
    handle,
    ...keys,
  });
  const joinRes = await client.join({ origin: 'direct', bio: `${handle} bio` });
  assert.equal(joinRes.status, 201);
  const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
    handle,
  });
  assert.equal(appRes.status, 200);
  return { client, keys };
}

async function signedCheckin(ctx, keys, handle, payload) {
  const endpoint = '/api/town/ghostlight/checkin';
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

test('selectCurrentEvent next: earliest start wins among multiple future events, regardless of order', () => {
  const T0 = Date.parse('2026-11-20T18:00:00Z');
  const ev = (overrides = {}) => ({
    title: 'E',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'bandstand',
    blurb: '',
    ...overrides,
  });
  const Later = ev({ title: 'Later', start_at: '2026-11-20T21:00:00Z' });
  const Earlier = ev({ title: 'Earlier', start_at: '2026-11-20T19:00:00Z' });

  const r1 = apiSelectCurrentEvent([Later, Earlier], T0);
  assert.equal(r1?.status, 'next');
  assert.equal(r1?.event.title, 'Earlier');

  const r2 = apiSelectCurrentEvent([Earlier, Later], T0);
  assert.equal(r2?.event.title, 'Earlier');

  const oneMsFuture = ev({ title: 'OneMs', start_at: new Date(T0 + 1).toISOString() });
  assert.equal(apiSelectCurrentEvent([oneMsFuture], T0)?.status, 'next');

  assert.equal(
    JSON.stringify(apiSelectCurrentEvent([Earlier], T0)),
    JSON.stringify({ event: Earlier, status: 'next' })
  );
});

test('selectNowNext: an event ending exactly at nowMs is neither now nor next', () => {
  const T0 = Date.parse('2026-11-20T18:00:00Z');
  const ev = (overrides = {}) => ({
    title: 'E',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'bandstand',
    blurb: '',
    ...overrides,
  });
  const Ending = ev({ title: 'Ending', start_at: '2026-11-20T17:00:00Z', duration_min: 60 });
  const Future = ev({ title: 'Future', start_at: '2026-11-20T20:00:00Z' });
  const Live = ev({ title: 'Live', start_at: '2026-11-20T17:30:00Z', duration_min: 60 });

  const r1 = selectNowNext([Ending, Future], T0);
  assert.equal(r1.now, null);
  assert.equal(r1.next?.title, 'Future');

  const r2 = selectNowNext([Ending, Live, Future], T0);
  assert.equal(r2.now?.title, 'Live');
  assert.equal(r2.next?.title, 'Future');
});

test('loadEventsFile shape edges', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-load-edges-'));
  try {
    const arrFile = path.join(tmpDir, 'arr.json');
    fs.writeFileSync(arrFile, '[{"title":"x"}]', 'utf8');
    assert.deepEqual(loadEventsFile(arrFile), { events: [] });

    for (const badVal of ['not-array', { a: 1 }, null]) {
      const f = path.join(tmpDir, 'bad-events.json');
      fs.writeFileSync(f, JSON.stringify({ events: badVal }), 'utf8');
      assert.deepEqual(loadEventsFile(f), { events: [] });
    }

    const extraKeysFile = path.join(tmpDir, 'extra.json');
    fs.writeFileSync(
      extraKeysFile,
      JSON.stringify({
        version: 2,
        note: 'hi',
        events: [
          {
            title: 'Kept',
            host_handle: 'milo',
            start_at: '2026-11-20T18:00:00Z',
            duration_min: 30,
            location: 'bandstand',
            blurb: '',
          },
        ],
      }),
      'utf8'
    );
    const extraLoaded = loadEventsFile(extraKeysFile);
    assert.equal(extraLoaded.events.length, 1);
    assert.equal(extraLoaded.events[0].title, 'Kept');

    assert.deepEqual(loadEventsFile(tmpDir), { events: [] });

    const bomFile = path.join(tmpDir, 'bom.json');
    fs.writeFileSync(bomFile, '\uFEFF{"events":[]}', 'utf8');
    assert.deepEqual(loadEventsFile(bomFile), { events: [] });

    const fracFile = path.join(tmpDir, 'frac.json');
    fs.writeFileSync(
      fracFile,
      JSON.stringify({
        events: [
          {
            title: 'HalfPlus',
            host_handle: 'milo',
            start_at: '2026-11-20T18:00:00Z',
            duration_min: 30.5,
            location: 'bandstand',
            blurb: '',
          },
        ],
      }),
      'utf8'
    );
    const fracLoaded = loadEventsFile(fracFile);
    assert.equal(fracLoaded.events.length, 1);
    assert.equal(fracLoaded.events[0].duration_min, 30.5);

    const tzFile = path.join(tmpDir, 'tz.json');
    fs.writeFileSync(
      tzFile,
      JSON.stringify({
        events: [
          {
            title: 'Offset',
            host_handle: 'milo',
            start_at: '2026-11-20T18:00:00+02:00',
            duration_min: 30,
            location: 'bandstand',
            blurb: '',
          },
        ],
      }),
      'utf8'
    );
    const tzLoaded = loadEventsFile(tzFile);
    assert.equal(tzLoaded.events.length, 1);
    assert.equal(tzLoaded.events[0].start_at, '2026-11-20T18:00:00+02:00');

    const dupTitleFile = path.join(tmpDir, 'dup.json');
    fs.writeFileSync(
      dupTitleFile,
      JSON.stringify({
        events: [
          {
            title: 'Same',
            host_handle: 'milo',
            start_at: '2026-11-20T18:00:00Z',
            duration_min: 30,
            location: 'bandstand',
            blurb: '',
          },
          {
            title: 'Same',
            host_handle: 'vera',
            start_at: '2026-11-20T19:00:00Z',
            duration_min: 30,
            location: 'bandstand',
            blurb: '',
          },
        ],
      }),
      'utf8'
    );
    const dupLoaded = loadEventsFile(dupTitleFile);
    assert.equal(dupLoaded.events.length, 2);
    assert.equal(dupLoaded.events[0].host_handle, 'milo');
    assert.equal(dupLoaded.events[1].host_handle, 'vera');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('eventStateKey concatenates raw — a pipe in a title is not escaped', () => {
  assert.equal(
    eventStateKey({ title: 'A|B', start_at: '2026-11-20T18:00:00Z' }, null),
    'now|A|B|2026-11-20T18:00:00Z'
  );
  assert.equal(
    eventStateKey({ title: '', start_at: '2026-11-20T18:00:00Z' }, null),
    'now||2026-11-20T18:00:00Z'
  );
  assert.equal(
    eventStateKey(null, { title: 'A|B', start_at: '2026-11-20T20:00:00Z' }),
    'next|A|B|2026-11-20T20:00:00Z'
  );
});

test('server integration: host who checks in during the window gets event title immediately and own text back when window ends', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startIso = new Date((baseNow + 300) * 1000).toISOString();
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-inwin-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({
      events: [
        {
          title: 'Lantern Reading',
          host_handle: 'host',
          start_at: startIso,
          duration_min: 30,
          location: 'bandstand',
          blurb: '',
        },
      ],
    }),
    'utf8'
  );

  const ctx = await startTestServer({ baseNow, eventsPath });
  try {
    const { keys } = await registerResidentWithKeys(ctx, 'host');

    ctx.advanceClock(360);
    const checkinRes = await signedCheckin(ctx, keys, 'host', {
      status_text: 'my own words',
      slot: 0,
    });
    assert.equal(checkinRes.status, 200);

    const duringRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(duringRes.status, 200);
    const duringState = await duringRes.json();
    assert.equal(duringState.events.now?.title, 'Lantern Reading');
    const hostDuring = duringState.footlights.find((f) => f.handle === 'host');
    assert.equal(hostDuring.status_text, 'Lantern Reading');
    assert.equal(hostDuring.event, true);

    ctx.advanceClock(1800);
    const afterRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(afterRes.status, 200);
    const afterState = await afterRes.json();
    assert.deepEqual(afterState.events, { now: null, next: null });
    const hostAfter = afterState.footlights.find((f) => f.handle === 'host');
    assert.equal(hostAfter.status_text, 'my own words');
    assert.equal('event' in hostAfter, false);
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('server integration: rewriting events file with identical content does not bump state_seq (304); corrupting it does bump', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startIso = new Date((baseNow - 60) * 1000).toISOString();
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-seq-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  const rawContent = JSON.stringify({
    events: [
      {
        title: 'Steady Event',
        host_handle: 'host',
        start_at: startIso,
        duration_min: 30,
        location: 'bandstand',
        blurb: '',
      },
    ],
  });
  fs.writeFileSync(eventsPath, rawContent, 'utf8');
  const t1 = new Date('2026-11-15T17:00:00Z');
  fs.utimesSync(eventsPath, t1, t1);

  const ctx = await startTestServer({ baseNow, eventsPath });
  try {
    const res1 = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(res1.status, 200);
    const s1 = await res1.json();
    assert.equal(s1.events.now?.title, 'Steady Event');

    fs.writeFileSync(eventsPath, rawContent, 'utf8');
    const t2 = new Date('2026-11-15T17:05:00Z');
    fs.utimesSync(eventsPath, t2, t2);
    const res2 = await fetch(`${ctx.baseUrl}/api/town/state?since=${s1.state_seq}`);
    assert.equal(res2.status, 304);

    fs.writeFileSync(eventsPath, '{not json', 'utf8');
    const t3 = new Date('2026-11-15T17:10:00Z');
    fs.utimesSync(eventsPath, t3, t3);
    const res3 = await fetch(`${ctx.baseUrl}/api/town/state?since=${s1.state_seq}`);
    assert.equal(res3.status, 200);
    const s3 = await res3.json();
    assert.ok(s3.state_seq > s1.state_seq);
    assert.equal(s3.events.now, null);
    assert.equal(s3.events.next, null);
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('server integration: event flip with no host checked in still bumps state_seq', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startIso = new Date((baseNow + 300) * 1000).toISOString();
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-nohost-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({
      events: [
        {
          title: 'Solo Flip',
          host_handle: 'host',
          start_at: startIso,
          duration_min: 30,
          location: 'bandstand',
          blurb: '',
        },
      ],
    }),
    'utf8'
  );

  const ctx = await startTestServer({ baseNow, eventsPath });
  try {
    const res1 = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(res1.status, 200);
    const s1 = await res1.json();
    assert.equal(s1.events.next?.title, 'Solo Flip');
    assert.equal(s1.events.now, null);
    assert.deepEqual(s1.footlights, []);

    ctx.advanceClock(360);
    const res2 = await fetch(`${ctx.baseUrl}/api/town/state?since=${s1.state_seq}`);
    assert.equal(res2.status, 200);
    const s2 = await res2.json();
    assert.ok(s2.state_seq > s1.state_seq);
    assert.equal(s2.events.now?.title, 'Solo Flip');
    assert.equal(s2.events.next, null);
    assert.deepEqual(s2.footlights, []);
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('server integration: host checked in before the window gets the event title on the next state read', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startIso = new Date((baseNow + 300) * 1000).toISOString();
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-prewin-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({
      events: [
        {
          title: 'Lantern Reading',
          host_handle: 'host',
          start_at: startIso,
          duration_min: 30,
          location: 'bandstand',
          blurb: '',
        },
      ],
    }),
    'utf8'
  );

  const ctx = await startTestServer({ baseNow, eventsPath });
  try {
    const { keys } = await registerResidentWithKeys(ctx, 'host');
    const checkinRes = await signedCheckin(ctx, keys, 'host', {
      status_text: 'my own words',
      slot: 0,
    });
    assert.equal(checkinRes.status, 200);

    const beforeRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(beforeRes.status, 200);
    const beforeState = await beforeRes.json();
    const hostBefore = beforeState.footlights.find((f) => f.handle === 'host');
    assert.equal(hostBefore.status_text, 'my own words');
    assert.equal('event' in hostBefore, false);

    ctx.advanceClock(360);
    const duringRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(duringRes.status, 200);
    const duringState = await duringRes.json();
    const hostDuring = duringState.footlights.find((f) => f.handle === 'host');
    assert.equal(hostDuring.status_text, 'Lantern Reading');
    assert.equal(hostDuring.event, true);

    ctx.advanceClock(1800);
    const afterRes = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(afterRes.status, 200);
    const afterState = await afterRes.json();
    const hostAfter = afterState.footlights.find((f) => f.handle === 'host');
    assert.equal(hostAfter.status_text, 'my own words');
    assert.equal('event' in hostAfter, false);
    assert.deepEqual(afterState.events, { now: null, next: null });
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('server integration: now and next announced together; now-to-next transition as the clock advances', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const firstIso = new Date((baseNow - 60) * 1000).toISOString();
  const secondIso = new Date((baseNow + 3600) * 1000).toISOString();
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-nownext-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({
      events: [
        {
          title: 'First',
          host_handle: 'host',
          start_at: firstIso,
          duration_min: 30,
          location: 'bandstand',
          blurb: '',
        },
        {
          title: 'Second',
          host_handle: 'host',
          start_at: secondIso,
          duration_min: 30,
          location: 'bandstand',
          blurb: '',
        },
      ],
    }),
    'utf8'
  );

  const ctx = await startTestServer({ baseNow, eventsPath });
  try {
    const res1 = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(res1.status, 200);
    const s1 = await res1.json();
    assert.equal(s1.events.now?.title, 'First');
    assert.equal(s1.events.next?.title, 'Second');

    ctx.advanceClock(1800);
    const res2 = await fetch(`${ctx.baseUrl}/api/town/state?since=${s1.state_seq}`);
    assert.equal(res2.status, 200);
    const s2 = await res2.json();
    assert.equal(s2.events.now, null);
    assert.equal(s2.events.next?.title, 'Second');
    assert.ok(s2.state_seq > s1.state_seq);

    ctx.advanceClock(1800);
    const res3 = await fetch(`${ctx.baseUrl}/api/town/state?since=${s2.state_seq}`);
    assert.equal(res3.status, 200);
    const s3 = await res3.json();
    assert.equal(s3.events.now?.title, 'Second');
    assert.equal(s3.events.next, null);
    assert.ok(s3.state_seq > s2.state_seq);
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('server integration: events file deleted mid-run fails open and bumps state_seq', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startIso = new Date((baseNow + 3600) * 1000).toISOString();
  const tmpEventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-delete-'));
  const eventsPath = path.join(tmpEventsDir, 'events.json');
  fs.writeFileSync(
    eventsPath,
    JSON.stringify({
      events: [
        {
          title: 'Vanishing',
          host_handle: 'host',
          start_at: startIso,
          duration_min: 30,
          location: 'bandstand',
          blurb: '',
        },
      ],
    }),
    'utf8'
  );

  const ctx = await startTestServer({ baseNow, eventsPath });
  try {
    const res1 = await fetch(`${ctx.baseUrl}/api/town/state`);
    assert.equal(res1.status, 200);
    const s1 = await res1.json();
    assert.equal(s1.events.next?.title, 'Vanishing');

    fs.unlinkSync(eventsPath);
    const res2 = await fetch(`${ctx.baseUrl}/api/town/state?since=${s1.state_seq}`);
    assert.equal(res2.status, 200);
    const s2 = await res2.json();
    assert.ok(s2.state_seq > s1.state_seq);
    assert.deepEqual(s2.events, { now: null, next: null });

    const res3 = await fetch(`${ctx.baseUrl}/api/town/state?since=${s2.state_seq}`);
    assert.equal(res3.status, 304);
  } finally {
    await ctx.close();
    fs.rmSync(tmpEventsDir, { recursive: true, force: true });
  }
});

test('selectNowNext with two overlapping now events and a future event returns earliest-start now and earliest future next', () => {
  const T0 = Date.parse('2026-11-20T18:15:00Z');
  const ev = (overrides = {}) => ({
    title: 'E',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'bandstand',
    blurb: '',
    ...overrides,
  });
  const Early = ev({ title: 'Early', start_at: '2026-11-20T17:30:00Z', duration_min: 60 });
  const Late = ev({ title: 'Late', start_at: '2026-11-20T18:00:00Z', duration_min: 60 });
  const Future = ev({ title: 'Future', start_at: '2026-11-20T20:00:00Z', duration_min: 30 });

  const nn1 = selectNowNext([Late, Future, Early], T0);
  assert.equal(nn1.now?.title, 'Early');
  assert.equal(nn1.next?.title, 'Future');

  const cur = apiSelectCurrentEvent([Late, Future, Early], T0);
  assert.equal(cur?.status, 'now');
  assert.equal(cur?.event.title, 'Early');

  const nn2 = selectNowNext([Late, Early], T0);
  assert.equal(nn2.now?.title, 'Early');
  assert.equal(nn2.next, null);
});

test('validateEventEntry rejects non-string fields and enforces host_handle length 2..32', () => {
  const T0 = Date.parse('2026-11-20T18:00:00Z');
  const ev = (overrides = {}) => ({
    title: 'E',
    host_handle: 'milo',
    start_at: '2026-11-20T18:00:00Z',
    duration_min: 60,
    location: 'bandstand',
    blurb: '',
    ...overrides,
  });

  assert.equal(apiSelectCurrentEvent([ev({ title: 123 })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ blurb: 123 })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ host_handle: undefined })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ start_at: undefined })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ duration_min: NaN })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ duration_min: Infinity })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ host_handle: 'a' })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ host_handle: 'a'.repeat(32) })], T0)?.status, 'now');
  assert.equal(apiSelectCurrentEvent([ev({ host_handle: 'a'.repeat(33) })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ location: null })], T0), null);
  assert.equal(apiSelectCurrentEvent([ev({ location: '' })], T0)?.status, 'now');
  assert.equal(apiSelectCurrentEvent([ev({ blurb: '' })], T0)?.status, 'now');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-events-mixed-'));
  try {
    const filePath = path.join(tmpDir, 'events.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        events: ['nope', 42, ['x'], true, ev({ title: 'Kept' }), null],
      }),
      'utf8'
    );
    const loaded = loadEventsFile(filePath);
    assert.equal(loaded.events.length, 1);
    assert.equal(loaded.events[0].title, 'Kept');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
