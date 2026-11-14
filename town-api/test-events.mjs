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
  ];

  for (const c of cases) {
    assert.deepEqual(
      apiSelectCurrentEvent(c.events, c.nowMs),
      bannerSelectCurrentEvent(c.events, c.nowMs)
    );
  }
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
