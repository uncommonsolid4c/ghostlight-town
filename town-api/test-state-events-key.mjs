/**
 * Drift-guard test for GET /api/town/state top-level `events` and
 * `guestbook_by_plot` keys (Slice 114).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair } from './ghostlight-client.mjs';

const EVENT_KEYS = ['blurb', 'duration_min', 'host_handle', 'location', 'start_at', 'title'];

function isoAt(baseSec, offsetSec) {
  return new Date((baseSec + offsetSec) * 1000).toISOString();
}

async function startStateServer({ eventsContent, baseNow = Math.floor(Date.now() / 1000) } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-state-events-key-'));
  const eventsPath = path.join(tmpDir, 'events.json');
  const topicsPath = path.join(tmpDir, 'missing-topics.json');
  if (eventsContent !== undefined) {
    fs.writeFileSync(
      eventsPath,
      typeof eventsContent === 'string' ? eventsContent : JSON.stringify(eventsContent),
      'utf8',
    );
  }
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const { server, db } = createTownServer({
    dbPath: path.join(tmpDir, 'town.db'),
    plotsDir: path.join(tmpDir, 'plots'),
    operatorPubkey: operatorKeys.pubkey,
    eventsPath,
    topicsPath,
    nowFn: () => baseNow + clockOffset,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const admin = new GhostlightClient({
    baseUrl,
    handle: 'milo-op',
    privateKeyPem: operatorKeys.privateKeyPem,
  });

  return {
    tmpDir,
    eventsPath,
    baseUrl,
    baseNow,
    db,
    admin,
    advanceClock(sec) {
      clockOffset += sec;
    },
    async getState(since) {
      const qs = since !== undefined ? `?since=${since}` : '';
      const res = await fetch(`${baseUrl}/api/town/state${qs}`);
      const body = res.status === 200 ? await res.json() : null;
      return { status: res.status, body };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function registerResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joinRes = await client.join({ origin: 'direct', bio: `${handle} bio` });
  assert.equal(joinRes.status, 201);
  const appRes = await ctx.admin._signedPost('/api/town/admin/approve', { handle });
  assert.equal(appRes.status, 200);
  return client;
}

async function registerAndCheckin(ctx, handle, statusText, slot) {
  const client = await registerResident(ctx, handle);
  const checkRes = await client.checkin({ status_text: statusText, slot });
  assert.equal(checkRes.status, 200);
  return client;
}

test('GET /api/town/state always emits events {now, next} and guestbook_by_plot object even when events file is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-state-events-key-'));
  const missingEventsPath = path.join(tmpDir, 'does-not-exist-events.json');
  const operatorKeys = generateKeypair();

  const { server } = createTownServer({
    dbPath: path.join(tmpDir, 'town.db'),
    plotsDir: path.join(tmpDir, 'plots'),
    operatorPubkey: operatorKeys.pubkey,
    eventsPath: missingEventsPath,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/town/state`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(Object.hasOwn(body, 'events'), true);
    assert.equal(typeof body.events, 'object');
    assert.notEqual(body.events, null);
    assert.deepEqual(Object.keys(body.events).sort(), ['next', 'now']);
    assert.equal(body.events.now, null);
    assert.equal(body.events.next, null);

    assert.equal(Object.hasOwn(body, 'guestbook_by_plot'), true);
    assert.equal(typeof body.guestbook_by_plot, 'object');
    assert.notEqual(body.guestbook_by_plot, null);
    assert.equal(Array.isArray(body.guestbook_by_plot), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


test('GET /api/town/state returns trimmed now and next events with full validated shape', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const nowStart = isoAt(baseNow, -1800);
  const nextStart = isoAt(baseNow, 3600);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: '  Lantern Hour  ',
          host_handle: 'milo',
          start_at: nowStart,
          duration_min: 60,
          location: '  bandstand  ',
          blurb: '  stories by brass light  ',
        },
        {
          title: '  Midnight Tea  ',
          host_handle: 'wick',
          start_at: nextStart,
          duration_min: 45,
          location: '  gate  ',
          blurb: '  kettle is on  ',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body.events.now).sort(), EVENT_KEYS);
    assert.deepEqual(body.events.now, {
      title: 'Lantern Hour',
      host_handle: 'milo',
      start_at: nowStart,
      duration_min: 60,
      location: 'bandstand',
      blurb: 'stories by brass light',
    });
    assert.deepEqual(Object.keys(body.events.next).sort(), EVENT_KEYS);
    assert.deepEqual(body.events.next, {
      title: 'Midnight Tea',
      host_handle: 'wick',
      start_at: nextStart,
      duration_min: 45,
      location: 'gate',
      blurb: 'kettle is on',
    });
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state sets events.now to null and events.next to future event when only-next', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Future Reading',
          host_handle: 'milo',
          start_at: isoAt(baseNow, 3600),
          duration_min: 30,
          location: 'bandstand',
          blurb: 'later tonight',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now, null);
    assert.equal(body.events.next.title, 'Future Reading');
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state sets both events.now and events.next to null when past-only', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Earlier Matinee',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -7200),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'already finished',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now, null);
    assert.equal(body.events.next, null);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state fails open with null events when events file is malformed JSON', async () => {
  const ctx = await startStateServer({
    eventsContent: '{ not valid json',
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now, null);
    assert.equal(body.events.next, null);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state ignores invalid entries and surfaces only valid events', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startAt = isoAt(baseNow, -900);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Bad Host Event',
          host_handle: 'bad host',
          start_at: startAt,
          duration_min: 30,
          location: 'bandstand',
          blurb: 'space in handle',
        },
        {
          title: 'Too Short Event',
          host_handle: 'milo',
          start_at: startAt,
          duration_min: 5,
          location: 'bandstand',
          blurb: 'below 15 min floor',
        },
        {
          title: 'x'.repeat(81),
          host_handle: 'milo',
          start_at: startAt,
          duration_min: 30,
          location: 'bandstand',
          blurb: 'title over 80 chars',
        },
        {
          title: 'Valid Evening',
          host_handle: 'milo',
          start_at: startAt,
          duration_min: 60,
          location: 'bandstand',
          blurb: 'passes validation',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Valid Evening');
    assert.equal(body.events.next, null);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state bumps state_seq and returns 200 for since=S when events flip', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({ baseNow });

  try {
    const initial = await ctx.getState();
    assert.equal(initial.status, 200);
    assert.equal(initial.body.events.now, null);
    assert.equal(initial.body.events.next, null);
    const seqBefore = initial.body.state_seq;

    fs.writeFileSync(
      ctx.eventsPath,
      JSON.stringify({
        events: [
          {
            title: 'Sudden Encore',
            host_handle: 'milo',
            start_at: isoAt(baseNow, -900),
            duration_min: 60,
            location: 'bandstand',
            blurb: 'just added',
          },
        ],
      }),
      'utf8',
    );
    const newer = new Date(Date.now() + 5000);
    fs.utimesSync(ctx.eventsPath, newer, newer);

    const flipped = await ctx.getState(seqBefore);
    assert.equal(flipped.status, 200);
    assert.ok(flipped.body.state_seq > seqBefore);
    assert.equal(flipped.body.events.now.title, 'Sudden Encore');
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state aggregates approved plot guestbook counts in guestbook_by_plot', async () => {
  const ctx = await startStateServer();

  try {
    await registerResident(ctx, 'wick');
    await registerResident(ctx, 'maren');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl });

    ctx.advanceClock(-3601);
    const wick1 = await visitor.signGuestbook('guestbook', 'Guest A', 'Nice porch', 'wick');
    const wick2 = await visitor.signGuestbook('guestbook', 'Guest B', 'Warm lamp', 'wick');
    const maren1 = await visitor.signGuestbook('guestbook', 'Guest C', 'Quiet garden', 'maren');

    ctx.advanceClock(3601);
    const gate1 = await visitor.signGuestbook('guestbook', 'Guest D', 'Hello town');
    const wickPending = await visitor.signGuestbook('guestbook', 'Guest E', 'Pending note', 'wick');

    assert.equal(wick1.status, 201);
    assert.equal(wick2.status, 201);
    assert.equal(maren1.status, 201);
    assert.equal(gate1.status, 201);
    assert.equal(wickPending.status, 201);

    for (const id of [wick1.data.id, wick2.data.id, maren1.data.id, gate1.data.id]) {
      const mod = await ctx.admin.moderateGuestbook(id, 'approve');
      assert.equal(mod.status, 200);
    }

    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.deepEqual(body.guestbook_by_plot, { wick: 2, maren: 1 });
    assert.deepEqual(body.guestbook, { signed: 1, letters: 0 });
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state excludes approved plot-scoped letters from guestbook_by_plot', async () => {
  const ctx = await startStateServer();

  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl });
    const rejected = await visitor.signGuestbook('letter', 'Reader', 'Letter mentioning wick', 'wick');
    assert.equal(rejected.status, 400);

    ctx.db
      .prepare("INSERT INTO guestbook (kind, name, body, plot, status, created_at) VALUES ('letter', 'Reader', 'Letter for wick', 'wick', 'approved', ?)")
      .run(ctx.baseNow);

    const gateLetter = await visitor.signGuestbook('letter', 'Reader', 'Dear editor');
    assert.equal(gateLetter.status, 201);
    const mod = await ctx.admin.moderateGuestbook(gateLetter.data.id, 'approve');
    assert.equal(mod.status, 200);

    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.deepEqual(body.guestbook_by_plot, {});
    assert.deepEqual(body.guestbook, { signed: 0, letters: 1 });
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state annotates now-event host footlight without flagging other lit footlights', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Host Spotlight',
          host_handle: 'host',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'live now',
        },
      ],
    },
  });

  try {
    await registerAndCheckin(ctx, 'host', 'my own words', 0);
    await registerAndCheckin(ctx, 'other', 'other words', 1);

    const { status, body } = await ctx.getState();
    assert.equal(status, 200);

    const hostRow = body.footlights.find((row) => row.handle === 'host');
    const otherRow = body.footlights.find((row) => row.handle === 'other');
    assert.ok(hostRow);
    assert.ok(otherRow);
    assert.equal(hostRow.status_text, 'Host Spotlight');
    assert.equal(hostRow.event, true);
    assert.equal(otherRow.status_text, 'other words');
    assert.equal(otherRow.event, undefined);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state picks earliest-start overlapping now event and earliest future next event', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Early Long',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -3600),
          duration_min: 120,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Late Short',
          host_handle: 'wick',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Later Future',
          host_handle: 'maren',
          start_at: isoAt(baseNow, 3600),
          duration_min: 30,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Sooner Future',
          host_handle: 'tomas',
          start_at: isoAt(baseNow, 1800),
          duration_min: 30,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Early Long');
    assert.equal(body.events.next.title, 'Sooner Future');
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state treats an event ending exactly at now as past', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Just Ended',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -3600),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now, null);
    assert.equal(body.events.next, null);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state treats an event starting exactly at now as now', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Starting Now',
          host_handle: 'milo',
          start_at: isoAt(baseNow, 0),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Starting Now');
    assert.equal(body.events.next, null);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state handles a now-event host who is not checked in without annotation or crash', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Ghost Host',
          host_handle: 'ghosthost',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Ghost Host');
    assert.deepEqual(body.footlights, []);
    assert.equal(body.footlights.some((r) => r.event === true), false);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state clears events and bumps state_seq when events file is deleted', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Live Now',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const first = await ctx.getState();
    assert.equal(first.status, 200);
    assert.equal(first.body.events.now.title, 'Live Now');
    const seqBefore = first.body.state_seq;

    fs.rmSync(ctx.eventsPath);

    const after = await ctx.getState(seqBefore);
    assert.equal(after.status, 200);
    assert.ok(after.body.state_seq > seqBefore);
    assert.equal(after.body.events.now, null);
    assert.equal(after.body.events.next, null);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state returns 304 for repeated read with since=state_seq while events are unchanged', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Steady',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const first = await ctx.getState();
    assert.equal(first.status, 200);
    const seq = first.body.state_seq;

    const second = await ctx.getState(seq);
    assert.equal(second.status, 304);
    assert.equal(second.body, null);
  } finally {
    await ctx.close();
  }
});
