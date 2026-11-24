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

test('GET /api/town/state accepts a padded start_at and trims it', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const trimmedStart = isoAt(baseNow, -900);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Padded Start',
          host_handle: 'milo',
          start_at: '  ' + trimmedStart + '  ',
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
    assert.equal(body.events.now.title, 'Padded Start');
    assert.equal(body.events.now.start_at, trimmedStart);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state host annotation clears after the window ends', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Short Reading',
          host_handle: 'host',
          start_at: isoAt(baseNow, 60),
          duration_min: 15,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    await registerAndCheckin(ctx, 'host', 'my own words', 0);

    const before = await ctx.getState();
    assert.equal(before.status, 200);
    assert.equal(before.body.events.next.title, 'Short Reading');
    const beforeHost = before.body.footlights.find((r) => r.handle === 'host');
    assert.ok(beforeHost);
    assert.equal(beforeHost.status_text, 'my own words');
    assert.equal(beforeHost.event, undefined);

    ctx.advanceClock(61);
    const during = await ctx.getState();
    assert.equal(during.status, 200);
    assert.equal(during.body.events.now.title, 'Short Reading');
    const duringHost = during.body.footlights.find((r) => r.handle === 'host');
    assert.ok(duringHost);
    assert.equal(duringHost.status_text, 'Short Reading');
    assert.equal(duringHost.event, true);

    ctx.advanceClock(900);
    const after = await ctx.getState();
    assert.equal(after.status, 200);
    assert.equal(after.body.events.now, null);
    const afterHost = after.body.footlights.find((r) => r.handle === 'host');
    assert.ok(afterHost);
    assert.equal(afterHost.status_text, 'my own words');
    assert.equal(afterHost.event, undefined);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state annotates only the earliest-start host among overlapping now events', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Early Long',
          host_handle: 'hosta',
          start_at: isoAt(baseNow, -3600),
          duration_min: 120,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Late Short',
          host_handle: 'hostb',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    await registerAndCheckin(ctx, 'hosta', 'aaa', 0);
    await registerAndCheckin(ctx, 'hostb', 'bbb', 1);

    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Early Long');
    const rowA = body.footlights.find((r) => r.handle === 'hosta');
    const rowB = body.footlights.find((r) => r.handle === 'hostb');
    assert.ok(rowA);
    assert.ok(rowB);
    assert.equal(rowA.status_text, 'Early Long');
    assert.equal(rowA.event, true);
    assert.equal(rowB.status_text, 'bbb');
    assert.equal(rowB.event, undefined);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state gives an expired footlight no annotation', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Long Evening',
          host_handle: 'host',
          start_at: isoAt(baseNow, -900),
          duration_min: 240,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    await registerAndCheckin(ctx, 'host', 'my own words', 0);
    ctx.advanceClock(2701);

    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Long Evening');
    assert.equal(body.footlights.length, 0);
    assert.equal(body.footlights.some((r) => r.event === true), false);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state guestbook_by_plot counts approved entries only', async () => {
  const ctx = await startStateServer();

  try {
    await registerResident(ctx, 'wick');
    await registerResident(ctx, 'maren');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl });

    ctx.advanceClock(-3601);
    const wickR = await visitor.signGuestbook('guestbook', 'Guest R', 'Rejected note', 'wick');
    const wickP = await visitor.signGuestbook('guestbook', 'Guest P', 'Pending note', 'wick');
    const wickA = await visitor.signGuestbook('guestbook', 'Guest A', 'Approved note', 'wick');

    ctx.advanceClock(3601);
    const marenC = await visitor.signGuestbook('guestbook', 'Guest C', 'Maren note', 'maren');

    assert.equal(wickR.status, 201);
    assert.equal(wickP.status, 201);
    assert.equal(wickA.status, 201);
    assert.equal(marenC.status, 201);

    const modR = await ctx.admin.moderateGuestbook(wickR.data.id, 'reject');
    const modA = await ctx.admin.moderateGuestbook(wickA.data.id, 'approve');
    const modC = await ctx.admin.moderateGuestbook(marenC.data.id, 'approve');
    assert.equal(modR.status, 200);
    assert.equal(modA.status, 200);
    assert.equal(modC.status, 200);

    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.deepEqual(body.guestbook_by_plot, { wick: 1, maren: 1 });
    assert.deepEqual(body.guestbook, { signed: 0, letters: 0 });
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state gives a guest host no annotation and no crash', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Guest Hour',
          host_handle: 'visitor1',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const guest = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'visitor1',
      ...generateKeypair(),
    });
    const checkRes = await guest.guestCheckin({ status_text: 'just visiting' });
    assert.equal(checkRes.status, 200);

    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Guest Hour');
    assert.equal(body.footlights.length, 0);
    const presenceRow = body.presence.find((r) => r.handle === 'visitor1');
    assert.ok(presenceRow);
    assert.equal(presenceRow.role, 'guest');
  } finally {
    await ctx.close();
  }
});

async function registerNpcResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joinRes = await client.join({ origin: 'direct', bio: `${handle} bio` });
  assert.equal(joinRes.status, 201);
  const appRes = await ctx.admin._signedPost('/api/town/admin/approve', { handle, role: 'npc' });
  assert.equal(appRes.status, 200);
  return client;
}

test('GET /api/town/state fails open with null events for wrong-shape events files', async () => {
  const wrongShapes = ['{}', '{"events": "not-an-array"}', '{"events": null}', '[{"title": "x"}]'];
  for (const eventsContent of wrongShapes) {
    const ctx = await startStateServer({ eventsContent });
    try {
      const { status, body } = await ctx.getState();
      assert.equal(status, 200);
      assert.equal(body.events.now, null);
      assert.equal(body.events.next, null);
    } finally {
      await ctx.close();
    }
  }
});

test('GET /api/town/state enforces the 15–240 minute duration bounds', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startAt = isoAt(baseNow, -600);
  const ctx1 = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Too Short',
          host_handle: 'milo',
          start_at: startAt,
          duration_min: 14,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Too Long',
          host_handle: 'milo',
          start_at: startAt,
          duration_min: 241,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Floor Fifteen',
          host_handle: 'milo',
          start_at: startAt,
          duration_min: 15,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx1.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Floor Fifteen');
    assert.equal(body.events.next, null);
  } finally {
    await ctx1.close();
  }

  const ctx2 = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Ceiling Four Hours',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -3600),
          duration_min: 240,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx2.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Ceiling Four Hours');
  } finally {
    await ctx2.close();
  }
});

test('GET /api/town/state breaks same-start ties by file order for now and next', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const nowStart = isoAt(baseNow, -900);
  const nextStart = isoAt(baseNow, 3600);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'First Now',
          host_handle: 'milo',
          start_at: nowStart,
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Second Now',
          host_handle: 'wick',
          start_at: nowStart,
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'First Next',
          host_handle: 'maren',
          start_at: nextStart,
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Second Next',
          host_handle: 'tomas',
          start_at: nextStart,
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
    assert.equal(body.events.now.title, 'First Now');
    assert.equal(body.events.next.title, 'First Next');
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state returns 200 full state for garbage, empty, negative, and future since values', async () => {
  const ctx = await startStateServer();

  try {
    const initial = await ctx.getState();
    assert.equal(initial.status, 200);
    const seq = initial.body.state_seq;

    for (const since of ['abc', '1.5', '-1', '', String(seq + 999)]) {
      const res = await ctx.getState(since);
      assert.equal(res.status, 200);
      assert.equal(res.body.state_seq, seq);
    }

    const control = await ctx.getState(seq);
    assert.equal(control.status, 304);
    assert.equal(control.body, null);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state annotates the NPC now-host and leaves the lit next-host unflagged', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Now Show',
          host_handle: 'wick',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Later Show',
          host_handle: 'maren',
          start_at: isoAt(baseNow, 3600),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const wick = await registerNpcResident(ctx, 'wick');
    const maren = await registerResident(ctx, 'maren');
    const wickCheck = await wick.checkin({ status_text: 'trimming lamps', slot: 1 });
    const marenCheck = await maren.checkin({ status_text: 'setting type', slot: 2 });
    assert.equal(wickCheck.status, 200);
    assert.equal(marenCheck.status, 200);

    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    const wickRow = body.footlights.find((r) => r.handle === 'wick');
    const marenRow = body.footlights.find((r) => r.handle === 'maren');
    assert.ok(wickRow);
    assert.ok(marenRow);
    assert.equal(wickRow.role, 'npc');
    assert.equal(wickRow.status_text, 'Now Show');
    assert.equal(wickRow.event, true);
    assert.equal(marenRow.role, 'muse');
    assert.equal(marenRow.status_text, 'setting type');
    assert.equal(marenRow.event, undefined);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state does not bump state_seq on an identical-content rewrite, but does on a title change', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startAt = isoAt(baseNow, -900);
  const initialEvents = {
    events: [
      {
        title: 'Steady Show',
        host_handle: 'milo',
        start_at: startAt,
        duration_min: 60,
        location: 'bandstand',
        blurb: 'b',
      },
    ],
  };
  const ctx = await startStateServer({ baseNow, eventsContent: initialEvents });

  try {
    const first = await ctx.getState();
    assert.equal(first.status, 200);
    const seq = first.body.state_seq;

    fs.writeFileSync(ctx.eventsPath, JSON.stringify(initialEvents), 'utf8');
    const newer1 = new Date(Date.now() + 5000);
    fs.utimesSync(ctx.eventsPath, newer1, newer1);

    const untouched = await ctx.getState(seq);
    assert.equal(untouched.status, 304);
    assert.equal(untouched.body, null);

    fs.writeFileSync(
      ctx.eventsPath,
      JSON.stringify({
        events: [
          {
            title: 'Renamed Show',
            host_handle: 'milo',
            start_at: startAt,
            duration_min: 60,
            location: 'bandstand',
            blurb: 'b',
          },
        ],
      }),
      'utf8',
    );
    const newer2 = new Date(Date.now() + 10000);
    fs.utimesSync(ctx.eventsPath, newer2, newer2);

    const renamed = await ctx.getState(seq);
    assert.equal(renamed.status, 200);
    assert.ok(renamed.body.state_seq > seq);
    assert.equal(renamed.body.events.now.title, 'Renamed Show');
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state reports guestbook_pending count for the moderation queue (slice 329)', async () => {
  const ctx = await startStateServer();

  try {
    await registerResident(ctx, 'wick');
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl });

    const s0 = await ctx.getState();
    assert.equal(s0.status, 200);
    assert.equal(s0.body.guestbook_pending, 0);

    // Two pendings: one town-wide, one plot-scoped; neither approved yet.
    const gate = await visitor.signGuestbook('guestbook', 'Guest A', 'Hello town');
    const plot = await visitor.signGuestbook('guestbook', 'Guest B', 'Nice porch', 'wick');
    assert.equal(gate.status, 201);
    assert.equal(plot.status, 201);

    const s1 = await ctx.getState();
    assert.equal(s1.body.guestbook_pending, 2);
    // Reader counts stay untouched by pendings.
    assert.deepEqual(s1.body.guestbook, { signed: 0, letters: 0 });
    assert.deepEqual(s1.body.guestbook_by_plot, {});

    // Approving one drops the count; rejecting the other clears it.
    const mod1 = await ctx.admin.moderateGuestbook(gate.data.id, 'approve');
    assert.equal(mod1.status, 200);
    const s2 = await ctx.getState();
    assert.equal(s2.body.guestbook_pending, 1);
    assert.deepEqual(s2.body.guestbook, { signed: 1, letters: 0 });

    const mod2 = await ctx.admin.moderateGuestbook(plot.data.id, 'reject');
    assert.equal(mod2.status, 200);
    const s3 = await ctx.getState();
    assert.equal(s3.body.guestbook_pending, 0);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state counts pending letters in guestbook_pending', async () => {
  const ctx = await startStateServer();

  try {
    const visitor = new GhostlightClient({ baseUrl: ctx.baseUrl });
    const gb = await visitor.signGuestbook('guestbook', 'Guest A', 'Hello town');
    const lt = await visitor.signGuestbook('letter', 'Reader', 'Dear editor');
    assert.equal(gb.status, 201);
    assert.equal(lt.status, 201);

    const s1 = await ctx.getState();
    assert.equal(s1.status, 200);
    assert.equal(s1.body.guestbook_pending, 2);
    assert.deepEqual(s1.body.guestbook, { signed: 0, letters: 0 });
    assert.deepEqual(s1.body.guestbook_by_plot, {});

    const modLt = await ctx.admin.moderateGuestbook(lt.data.id, 'approve');
    assert.equal(modLt.status, 200);
    const s2 = await ctx.getState();
    assert.equal(s2.status, 200);
    assert.equal(s2.body.guestbook_pending, 1);
    assert.deepEqual(s2.body.guestbook, { signed: 0, letters: 1 });

    const modGb = await ctx.admin.moderateGuestbook(gb.data.id, 'approve');
    assert.equal(modGb.status, 200);
    const s3 = await ctx.getState();
    assert.equal(s3.status, 200);
    assert.equal(s3.body.guestbook_pending, 0);
    assert.deepEqual(s3.body.guestbook, { signed: 1, letters: 1 });
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state returns null events for an empty events array', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({ baseNow, eventsContent: { events: [] } });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now, null);
    assert.equal(body.events.next, null);
    assert.deepEqual(Object.keys(body.events).sort(), ['next', 'now']);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state strips extra fields from surfaced events', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Extra Fields',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
          foo: 'bar',
          notes: 'x',
          id: 42,
          extra: { nested: true },
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Extra Fields');
    assert.deepEqual(Object.keys(body.events.now).sort(), EVENT_KEYS);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state drops non-object entries from the events array', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        'just a string',
        42,
        null,
        ['nested'],
        {
          title: 'Real One',
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
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Real One');
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state accepts a fractional duration_min and drops a string one', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'String Duration',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -3600),
          duration_min: '60',
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Half Minute',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -1800),
          duration_min: 30.5,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Half Minute');
    assert.equal(body.events.now.duration_min, 30.5);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state accepts an 80-char title and 200-char blurb, rejects a 201-char blurb', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const title80 = 'T'.repeat(80);
  const blurb200 = 'B'.repeat(200);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Too Verbose',
          host_handle: 'milo',
          start_at: isoAt(baseNow, -3600),
          duration_min: 240,
          location: 'bandstand',
          blurb: 'B'.repeat(201),
        },
        {
          title: title80,
          host_handle: 'milo',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: blurb200,
        },
      ],
    },
  });

  try {
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, title80);
    assert.equal(body.events.now.blurb, blurb200);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state drops entries with unparseable, empty, or non-string start_at', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Not A Date',
          host_handle: 'milo',
          start_at: 'not a date',
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Empty Start',
          host_handle: 'milo',
          start_at: '',
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Blank Start',
          host_handle: 'milo',
          start_at: '   ',
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Number Start',
          host_handle: 'milo',
          start_at: 12345,
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Good Date',
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
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Good Date');
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state drops an uppercase host_handle and trims a padded one', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'Upper Host',
          host_handle: 'HOST',
          start_at: isoAt(baseNow, -3600),
          duration_min: 240,
          location: 'bandstand',
          blurb: 'b',
        },
        {
          title: 'Padded Host',
          host_handle: '  host  ',
          start_at: isoAt(baseNow, -900),
          duration_min: 60,
          location: 'bandstand',
          blurb: 'b',
        },
      ],
    },
  });

  try {
    await registerAndCheckin(ctx, 'host', 'my own words', 0);
    const { status, body } = await ctx.getState();
    assert.equal(status, 200);
    assert.equal(body.events.now.title, 'Padded Host');
    assert.equal(body.events.now.host_handle, 'host');
    const hostRow = body.footlights.find((r) => r.handle === 'host');
    assert.ok(hostRow);
    assert.equal(hostRow.status_text, 'Padded Host');
    assert.equal(hostRow.event, true);
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state does not reload events on a same-mtime rewrite, but does on a mtime bump', async () => {
  const baseNow = Math.floor(Date.now() / 1000);
  const startAt = isoAt(baseNow, -900);
  const ctx = await startStateServer({
    baseNow,
    eventsContent: {
      events: [
        {
          title: 'First Title',
          host_handle: 'milo',
          start_at: startAt,
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
    assert.equal(first.body.events.now.title, 'First Title');
    const seq = first.body.state_seq;
    const origMtimeMs = fs.statSync(ctx.eventsPath).mtimeMs;

    fs.writeFileSync(
      ctx.eventsPath,
      JSON.stringify({
        events: [
          {
            title: 'Second Title',
            host_handle: 'milo',
            start_at: startAt,
            duration_min: 60,
            location: 'bandstand',
            blurb: 'b',
          },
        ],
      }),
      'utf8',
    );
    fs.utimesSync(ctx.eventsPath, origMtimeMs / 1000, origMtimeMs / 1000);
    assert.equal(fs.statSync(ctx.eventsPath).mtimeMs, origMtimeMs);

    const stale = await ctx.getState(seq);
    assert.equal(stale.status, 304);
    assert.equal(stale.body, null);

    const plain = await ctx.getState();
    assert.equal(plain.status, 200);
    assert.equal(plain.body.events.now.title, 'First Title');

    const newer = new Date(Date.now() + 5000);
    fs.utimesSync(ctx.eventsPath, newer, newer);

    const reloaded = await ctx.getState(seq);
    assert.equal(reloaded.status, 200);
    assert.ok(reloaded.body.state_seq > seq);
    assert.equal(reloaded.body.events.now.title, 'Second Title');
  } finally {
    await ctx.close();
  }
});

test('GET /api/town/state counts a plot-scoped pending letter in guestbook_pending only', async () => {
  const ctx = await startStateServer();

  try {
    await registerResident(ctx, 'wick');
    ctx.db
      .prepare(
        "INSERT INTO guestbook (kind, name, body, plot, status, created_at) VALUES ('letter', 'Reader', 'Letter for wick', 'wick', 'pending', ?)",
      )
      .run(ctx.baseNow);

    const s1 = await ctx.getState();
    assert.equal(s1.status, 200);
    assert.equal(s1.body.guestbook_pending, 1);
    assert.deepEqual(s1.body.guestbook_by_plot, {});
    assert.deepEqual(s1.body.guestbook, { signed: 0, letters: 0 });

    const row = ctx.db.prepare("SELECT id FROM guestbook WHERE plot = 'wick'").get();
    assert.ok(row);
    const mod = await ctx.admin.moderateGuestbook(row.id, 'approve');
    assert.equal(mod.status, 200);

    const s2 = await ctx.getState();
    assert.equal(s2.status, 200);
    assert.equal(s2.body.guestbook_pending, 0);
    assert.equal(s2.body.guestbook.letters, 0);
    assert.deepEqual(s2.body.guestbook_by_plot, {});
  } finally {
    await ctx.close();
  }
});
