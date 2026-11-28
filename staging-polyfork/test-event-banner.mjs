import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadEvents,
  selectCurrentEvent,
  eventBannerLines,
  updateEventBanner,
  renderEventBannerHeader,
  formatEventWhen,
} from './event-banner.mjs';
import { collectSourceFiles } from '../scripts/stage-deploy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const VALID_EVENT = {
  title: 'Midnight Reading on the Bandstand',
  host_handle: 'milo',
  start_at: '2026-11-15T20:00:00Z',
  duration_min: 60,
  location: 'Bandstand',
  blurb: 'Short poems and tea by the ghostlight.',
};

test('loadEvents passes valid entries through and skips invalid ones', async () => {
  const fetchFn = async (url) => {
    assert.equal(url, 'events.json');
    return {
      ok: true,
      async json() {
        return {
          events: [
            VALID_EVENT,
            { ...VALID_EVENT, title: '' },
            { ...VALID_EVENT, title: 'x'.repeat(81) },
            { ...VALID_EVENT, host_handle: 'Bad Handle!' },
            { ...VALID_EVENT, start_at: 'not-a-date' },
            { ...VALID_EVENT, duration_min: 10 },
            { ...VALID_EVENT, duration_min: 241 },
            { ...VALID_EVENT, blurb: 'b'.repeat(201) },
            null,
          ],
        };
      },
    };
  };

  const result = await loadEvents(fetchFn);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0], VALID_EVENT);
});

test('loadEvents returns { events: [] } on 404, bad JSON, wrong shape, or throwing fetch', async () => {
  assert.deepEqual(await loadEvents(async () => ({ ok: false, status: 404 })), { events: [] });
  assert.deepEqual(
    await loadEvents(async () => ({
      ok: true,
      async json() {
        throw new SyntaxError('Unexpected token');
      },
    })),
    { events: [] }
  );
  assert.deepEqual(
    await loadEvents(async () => ({
      ok: true,
      async json() {
        return { wrong: 'shape' };
      },
    })),
    { events: [] }
  );
  assert.deepEqual(
    await loadEvents(async () => {
      throw new Error('network down');
    }),
    { events: [] }
  );
});

test('selectCurrentEvent handles now, next, none, past ignored, earliest-future wins, invalid skipped', () => {
  const past = { ...VALID_EVENT, title: 'Past', start_at: '2026-11-14T10:00:00Z', duration_min: 60 };
  const nowEv = { ...VALID_EVENT, title: 'Now', start_at: '2026-11-14T12:00:00Z', duration_min: 60 };
  const later = { ...VALID_EVENT, title: 'Later', start_at: '2026-11-16T18:00:00Z', duration_min: 30 };
  const sooner = { ...VALID_EVENT, title: 'Sooner', start_at: '2026-11-15T18:00:00Z', duration_min: 30 };
  const invalid = { ...VALID_EVENT, title: '', start_at: '2026-11-14T12:00:00Z' };

  const duringNow = Date.parse('2026-11-14T12:30:00Z');
  const resNow = selectCurrentEvent([past, invalid, later, nowEv, sooner], duringNow);
  assert.equal(resNow.status, 'now');
  assert.equal(resNow.event.title, 'Now');

  const afterNow = Date.parse('2026-11-14T13:00:00Z');
  const resNext = selectCurrentEvent([past, invalid, later, nowEv, sooner], afterNow);
  assert.equal(resNext.status, 'next');
  assert.equal(resNext.event.title, 'Sooner');

  const afterAll = Date.parse('2026-11-17T00:00:00Z');
  assert.equal(selectCurrentEvent([past, invalid, later, nowEv, sooner], afterAll), null);
  assert.equal(selectCurrentEvent([], duringNow), null);
});

test('eventBannerLines wraps title to <=30 chars and uses EVENTS vs NEXT EVENT heading', () => {
  const longEvent = {
    ...VALID_EVENT,
    title: 'An Evening of Ghostlight Stories and Lantern Songs',
  };
  const nowLines = eventBannerLines(longEvent, 'now');
  assert.equal(nowLines[0], 'EVENTS');
  for (const line of nowLines.slice(1)) {
    assert.ok(line.length <= 30, `Line too long (${line.length}): ${line}`);
  }

  const nextLines = eventBannerLines(longEvent, 'next');
  assert.equal(nextLines[0], 'NEXT EVENT');
  for (const line of nextLines.slice(1)) {
    assert.ok(line.length <= 30, `Line too long (${line.length}): ${line}`);
  }
});

test('updateEventBanner toggles visibility, redraws texture, caches key, and handles missing card', () => {
  let redrawCount = 0;
  const card = {
    name: 'event_banner',
    visible: true,
    material: { map: null, needsUpdate: false },
  };
  const bandstandBuilt = { eventBanner: card, group: { children: [card] } };
  const liveStore = { eventBannerKey: null };
  const makeTextTexture = (_THREE, lines, opts) => {
    redrawCount += 1;
    return { lines, opts };
  };
  const ctx = { THREE: {}, bandstandBuilt, liveStore, makeTextTexture };

  assert.equal(updateEventBanner(ctx, null, null), false);
  assert.equal(card.visible, false);
  assert.equal(redrawCount, 0);

  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), true);
  assert.equal(card.visible, true);
  assert.equal(redrawCount, 1);
  assert.equal(card.material.needsUpdate, true);
  assert.equal(card.material.map.lines[0], 'NEXT EVENT');
  assert.equal(card.material.map.opts.width, 768);
  assert.equal(card.material.map.opts.height, 256);

  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), false);
  assert.equal(redrawCount, 1);

  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'now'), true);
  assert.equal(redrawCount, 2);
  assert.equal(card.material.map.lines[0], 'EVENTS');

  assert.equal(
    updateEventBanner({ THREE: {}, bandstandBuilt: { group: { children: [] } }, liveStore, makeTextTexture }, VALID_EVENT, 'now'),
    false
  );
});

test('renderEventBannerHeader and formatEventWhen format textContent and toggle hidden', () => {
  const startMs = Date.parse('2026-11-15T20:00:00Z');
  const when = formatEventWhen(startMs);
  assert.match(when, /\bNov\b/, `Expected month abbreviation in "${when}"`);

  const el = { hidden: true, textContent: '' };
  assert.equal(renderEventBannerHeader(el, VALID_EVENT, 'now'), true);
  assert.equal(el.hidden, false);
  assert.ok(el.textContent.startsWith('Now: '));
  assert.ok(el.textContent.includes(VALID_EVENT.title));
  assert.ok(el.textContent.includes(`@${VALID_EVENT.host_handle}`));

  assert.equal(renderEventBannerHeader(el, VALID_EVENT, 'next'), true);
  assert.equal(el.hidden, false);
  assert.ok(el.textContent.startsWith('Next: '));
  assert.ok(el.textContent.includes(VALID_EVENT.title));
  assert.ok(el.textContent.includes(`@${VALID_EVENT.host_handle}`));

  assert.equal(renderEventBannerHeader(el, null, null), false);
  assert.equal(el.hidden, true);

  assert.equal(renderEventBannerHeader(null, VALID_EVENT, 'now'), false);
});

test('shipped events.json validates and selects next, now, and null across the Gazette #3 reading window', async () => {
  const rawJson = await fs.readFile(path.join(HERE, 'events.json'), 'utf8');
  const parsed = JSON.parse(rawJson);
  assert.equal(Array.isArray(parsed.events), true);
  assert.equal(parsed.events.length, 1);

  const loaded = await loadEvents(async (url) => {
    assert.equal(url, 'events.json');
    return { ok: true, async json() { return parsed; } };
  });
  assert.equal(loaded.events.length, 1);
  const [ev] = loaded.events;
  assert.deepEqual(ev, {
    title: 'Gazette #3 — read aloud at the Bandstand',
    host_handle: 'milo',
    start_at: '2026-11-18T15:30:00Z',
    duration_min: 60,
    location: 'the Bandstand',
    blurb: "Issue #3, fresh off the press — the week's town news, read aloud. Come listen, or bring a line of your own.",
  });

  const beforeMs = Date.parse('2026-11-18T15:00:00Z');
  const nextSel = selectCurrentEvent(loaded.events, beforeMs);
  assert.equal(nextSel?.status, 'next');
  assert.equal(nextSel.event.title, ev.title);

  const when = formatEventWhen(Date.parse(ev.start_at));
  assert.equal(when, 'Nov 18, 7:30 AM');
  const headerEl = { hidden: true, textContent: '' };
  assert.equal(renderEventBannerHeader(headerEl, nextSel.event, nextSel.status), true);
  assert.equal(headerEl.hidden, false);
  assert.equal(
    headerEl.textContent,
    'Next: Gazette #3 — read aloud at the Bandstand — Nov 18, 7:30 AM · hosted by @milo'
  );

  const duringMs = Date.parse('2026-11-18T15:45:00Z');
  const nowSel = selectCurrentEvent(loaded.events, duringMs);
  assert.equal(nowSel?.status, 'now');
  assert.equal(nowSel.event.title, ev.title);
  assert.equal(renderEventBannerHeader(headerEl, nowSel.event, nowSel.status), true);
  assert.equal(
    headerEl.textContent,
    'Now: Gazette #3 — read aloud at the Bandstand — hosted by @milo'
  );

  const atEndMs = Date.parse('2026-11-18T16:30:00Z');
  assert.equal(selectCurrentEvent(loaded.events, atEndMs), null);
  const afterMs = Date.parse('2026-11-18T17:00:00Z');
  assert.equal(selectCurrentEvent(loaded.events, afterMs), null);
});

test('README Contents lists event-banner.mjs and events.json bullets', async () => {
  const readme = await fs.readFile(path.join(HERE, 'README.md'), 'utf8');
  const contentsStart = readme.indexOf('## Contents');
  assert.notEqual(contentsStart, -1, 'README.md must have a ## Contents section');
  const nextSection = readme.indexOf('\n## ', contentsStart + 1);
  const contentsBody = nextSection === -1
    ? readme.slice(contentsStart)
    : readme.slice(contentsStart, nextSection);

  assert.match(contentsBody, /^- `event-banner\.mjs` /m);
  assert.match(contentsBody, /^- `events\.json` /m);
});

test('README states the banner reads events.json directly and state.events is live', async () => {
  const readme = await fs.readFile(path.join(HERE, 'README.md'), 'utf8');
  assert.ok(readme.includes('reads `events.json` directly'));
  assert.ok(readme.includes('fail-open'));
  assert.ok(readme.includes('`state.events` is live'));
  assert.ok(!readme.includes('predates'));
  assert.ok(!readme.includes('does not yet serve'));
});

test('staging-polyfork staged bundle includes events.json', async () => {
  const { files } = await collectSourceFiles(REPO_ROOT, 'staging-polyfork');
  assert.ok(
    files.some((f) => f.relPath === 'events.json'),
    'staging-polyfork bundle must include events.json'
  );
});

test('loadEvents trims fields and accepts boundary values', async () => {
  const E = {
    ...VALID_EVENT,
    title: '  Midnight Reading  ',
    host_handle: '  milo ',
    start_at: ' 2026-11-15T20:00:00Z ',
    duration_min: 15,
    location: '  Bandstand ',
    blurb: '  poems ',
  };
  const payload = {
    events: [
      E,
      { ...E, title: 'x'.repeat(80), host_handle: 'ab' },
      { ...E, duration_min: 240 },
      { ...E, duration_min: 30.5 },
      { ...E, duration_min: '60' },
      ['array-entry'],
      { ...E, start_at: 123 },
      { ...E, blurb: 'b'.repeat(200) },
    ],
  };

  const result = await loadEvents(async () => ({
    ok: true,
    async json() {
      return payload;
    },
  }));

  assert.equal(result.events.length, 5);
  assert.deepEqual(result.events[0], {
    title: 'Midnight Reading',
    host_handle: 'milo',
    start_at: '2026-11-15T20:00:00Z',
    duration_min: 15,
    location: 'Bandstand',
    blurb: 'poems',
  });
});

test('loadEvents rejects a non-function fetchFn', async () => {
  assert.deepEqual(await loadEvents('nope'), { events: [] });
  assert.deepEqual(await loadEvents(null), { events: [] });
});

test('selectCurrentEvent handles guards, overlapping now events, and exact boundaries', () => {
  assert.equal(selectCurrentEvent(null, 0), null);
  assert.equal(selectCurrentEvent([VALID_EVENT], NaN), null);

  const early = {
    ...VALID_EVENT,
    title: 'Early',
    start_at: '2026-11-15T19:00:00Z',
    duration_min: 120,
  };
  const late = {
    ...VALID_EVENT,
    title: 'Late',
    start_at: '2026-11-15T19:30:00Z',
    duration_min: 120,
  };

  const during = Date.parse('2026-11-15T20:00:00Z');
  const overlapRes = selectCurrentEvent([late, early], during);
  assert.equal(overlapRes?.status, 'now');
  assert.equal(overlapRes.event.title, 'Early');

  const atStart = Date.parse('2026-11-15T19:00:00Z');
  assert.equal(selectCurrentEvent([early], atStart)?.status, 'now');

  const atEnd = Date.parse('2026-11-15T21:00:00Z');
  assert.equal(selectCurrentEvent([early], atEnd), null);
});

test('eventBannerLines handles non-now status and empty or non-string titles', () => {
  assert.equal(eventBannerLines(VALID_EVENT, 'soon')[0], 'NEXT EVENT');
  assert.equal(eventBannerLines(VALID_EVENT, undefined)[0], 'NEXT EVENT');
  assert.deepEqual(eventBannerLines({ ...VALID_EVENT, title: '   ' }, 'now'), ['EVENTS', '']);
  assert.deepEqual(eventBannerLines({ ...VALID_EVENT, title: 42 }, 'now'), ['EVENTS', '']);
});

test('updateEventBanner handles guards, group-children fallback, and start_at cache key', () => {
  let redrawCount = 0;
  const makeTextTexture = () => {
    redrawCount += 1;
    return {};
  };
  const makeCard = () => ({
    name: 'event_banner',
    visible: false,
    material: { map: null, needsUpdate: false },
  });

  const card = makeCard();
  const ctx = {
    THREE: {},
    bandstandBuilt: { group: { children: [card] } },
    liveStore: { eventBannerKey: null },
    makeTextTexture,
  };
  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), true);
  assert.equal(redrawCount, 1);

  const noMaterialCard = { name: 'event_banner', visible: true };
  assert.equal(
    updateEventBanner(
      { THREE: {}, bandstandBuilt: { group: { children: [noMaterialCard] } }, liveStore: { eventBannerKey: null }, makeTextTexture },
      VALID_EVENT,
      'next'
    ),
    false
  );
  assert.equal(redrawCount, 1);

  assert.equal(
    updateEventBanner(
      { THREE: null, bandstandBuilt: { group: { children: [makeCard()] } }, liveStore: { eventBannerKey: null }, makeTextTexture },
      VALID_EVENT,
      'next'
    ),
    false
  );
  assert.equal(
    updateEventBanner(
      { THREE: {}, bandstandBuilt: { group: { children: [makeCard()] } }, liveStore: null, makeTextTexture },
      VALID_EVENT,
      'next'
    ),
    false
  );
  assert.equal(
    updateEventBanner(
      { THREE: {}, bandstandBuilt: { group: { children: [makeCard()] } }, liveStore: { eventBannerKey: null }, makeTextTexture: 'x' },
      VALID_EVENT,
      'next'
    ),
    false
  );
  assert.equal(redrawCount, 1);

  assert.equal(
    updateEventBanner(ctx, { ...VALID_EVENT, start_at: '2026-11-16T20:00:00Z' }, 'next'),
    true
  );
  assert.equal(redrawCount, 2);

  assert.equal(
    updateEventBanner(
      { THREE: {}, bandstandBuilt: { eventBanner: card }, liveStore: null, makeTextTexture: () => ({}) },
      null,
      null
    ),
    false
  );
});

test('formatEventWhen handles non-finite input and renderEventBannerHeader clears on invalid status', () => {
  assert.equal(formatEventWhen(NaN), '');
  assert.equal(formatEventWhen(undefined), '');

  const el = { hidden: false, textContent: 'old text' };
  assert.equal(renderEventBannerHeader(el, VALID_EVENT, 'soon'), false);
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, '');

  const el2 = { hidden: false, textContent: 'old text' };
  assert.equal(renderEventBannerHeader(el2, null, null), false);
  assert.equal(el2.textContent, '');
});

test('loadEvents accepts host_handle and duration boundaries, drops extra fields, and pins empty location/blurb', async () => {
  const load = (events) =>
    loadEvents(async () => ({
      ok: true,
      async json() {
        return { events };
      },
    }));

  assert.equal((await load([{ ...VALID_EVENT, host_handle: 'a'.repeat(32) }])).events.length, 1);
  assert.equal((await load([{ ...VALID_EVENT, host_handle: 'a'.repeat(33) }])).events.length, 0);
  assert.equal((await load([{ ...VALID_EVENT, host_handle: '1abc' }])).events.length, 1);
  assert.equal((await load([{ ...VALID_EVENT, host_handle: '-abc' }])).events.length, 0);
  assert.equal((await load([{ ...VALID_EVENT, host_handle: '_abc' }])).events.length, 0);

  assert.equal((await load([{ ...VALID_EVENT, duration_min: NaN }])).events.length, 0);
  assert.equal((await load([{ ...VALID_EVENT, duration_min: Infinity }])).events.length, 0);
  assert.deepEqual(await load([{ ...VALID_EVENT, duration_min: 30.5 }]), {
    events: [{ ...VALID_EVENT, duration_min: 30.5 }],
  });

  assert.deepEqual(
    await load([{ ...VALID_EVENT, extra_field: 'dropped', location: '', blurb: '' }]),
    { events: [{ ...VALID_EVENT, location: '', blurb: '' }] }
  );
  assert.deepEqual(await load([{ ...VALID_EVENT, location: '   ' }]), {
    events: [{ ...VALID_EVENT, location: '' }],
  });
  assert.deepEqual(await load([{ title: 'x' }]), { events: [] });
});

test('loadEvents returns { events: [] } on non-array events, null response, and null JSON', async () => {
  assert.deepEqual(
    await loadEvents(async () => ({ ok: true, async json() { return { events: 'x' }; } })),
    { events: [] }
  );
  assert.deepEqual(
    await loadEvents(async () => ({ ok: true, async json() { return { events: null }; } })),
    { events: [] }
  );
  assert.deepEqual(
    await loadEvents(async () => ({ ok: true, async json() { return null; } })),
    { events: [] }
  );
  assert.deepEqual(
    await loadEvents(async () => ({ ok: true, async json() { return [1, 2]; } })),
    { events: [] }
  );
  assert.deepEqual(await loadEvents(async () => null), { events: [] });
  assert.deepEqual(await loadEvents(async () => ({ ok: false, status: 500 })), { events: [] });
  assert.deepEqual(await loadEvents(async () => ({ ok: true })), { events: [] });
});

test('selectCurrentEvent skips non-object entries and accepts a padded start_at', () => {
  const nowMs = Date.parse('2026-11-15T20:30:00Z');
  assert.equal(selectCurrentEvent([null, 'x', 42, undefined, VALID_EVENT], nowMs)?.status, 'now');
  assert.equal(selectCurrentEvent([null, 'x', 42], nowMs), null);

  const padded = { ...VALID_EVENT, start_at: ' 2026-11-15T20:00:00Z ' };
  const res = selectCurrentEvent([padded], nowMs);
  assert.equal(res?.status, 'now');
  assert.equal(res.event.start_at, '2026-11-15T20:00:00Z');
  assert.equal(selectCurrentEvent([padded], Date.parse('2026-11-15T19:00:00Z'))?.status, 'next');

  assert.equal(selectCurrentEvent([VALID_EVENT], 'not-a-number'), null);
});

test('eventBannerLines hard-splits a long word, handles null event, and keeps embedded newlines', () => {
  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: 'a'.repeat(40) }, 'now'),
    ['EVENTS', 'a'.repeat(30), 'a'.repeat(10)]
  );

  const wrapped = eventBannerLines({ ...VALID_EVENT, title: 'word ' + 'b'.repeat(35) + ' tail' }, 'next');
  assert.equal(wrapped[0], 'NEXT EVENT');
  for (const line of wrapped.slice(1)) {
    assert.ok(line.length <= 30, `Line too long (${line.length}): ${line}`);
  }

  assert.deepEqual(eventBannerLines(null, 'now'), ['EVENTS', '']);
  assert.deepEqual(eventBannerLines(null, 'next'), ['NEXT EVENT', '']);
  assert.deepEqual(eventBannerLines(undefined, undefined), ['NEXT EVENT', '']);

  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: 'First line\nSecond line' }, 'now'),
    ['EVENTS', 'First line\nSecond line']
  );
});

test('updateEventBanner cache key ignores host change, clears on hide, and passes exact texture opts', () => {
  let redrawCount = 0;
  let lastLines = null;
  let lastOpts = null;
  const makeTextTexture = (_THREE, lines, opts) => {
    redrawCount += 1;
    lastLines = lines;
    lastOpts = opts;
    return { lines, opts };
  };
  const card = {
    name: 'event_banner',
    visible: false,
    material: { map: null, needsUpdate: false },
  };
  const liveStore = { eventBannerKey: null };
  const ctx = {
    THREE: {},
    bandstandBuilt: { group: { children: [{ name: 'other' }, card] } },
    liveStore,
    makeTextTexture,
  };

  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), true);
  assert.equal(redrawCount, 1);
  assert.deepEqual(lastOpts, {
    width: 768,
    height: 256,
    titleSize: 30,
    subSize: 20,
    bg: '#f2e6cf',
    border: '#b59449',
    fg: '#2b1e14',
  });
  assert.equal(lastLines[0], 'NEXT EVENT');

  assert.equal(updateEventBanner(ctx, { ...VALID_EVENT, host_handle: 'wick' }, 'next'), false);
  assert.equal(redrawCount, 1);
  assert.equal(
    liveStore.eventBannerKey,
    'next|Midnight Reading on the Bandstand|2026-11-15T20:00:00Z'
  );

  assert.equal(updateEventBanner(ctx, null, null), false);
  assert.equal(card.visible, false);
  assert.equal(liveStore.eventBannerKey, null);

  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), true);
  assert.equal(redrawCount, 2);

  const guardCard = {
    name: 'event_banner',
    visible: false,
    material: { map: null, needsUpdate: false },
  };
  assert.equal(
    updateEventBanner(
      { THREE: null, bandstandBuilt: { eventBanner: guardCard }, liveStore: { eventBannerKey: null }, makeTextTexture },
      VALID_EVENT,
      'next'
    ),
    false
  );
  assert.equal(guardCard.visible, false);
});

test('formatEventWhen pins noon, midnight, and the epoch, and renderEventBannerHeader exact strings', () => {
  assert.equal(formatEventWhen(Date.parse('2026-11-15T20:00:00Z')), 'Nov 15, 12:00 PM');
  assert.equal(formatEventWhen(Date.parse('2026-11-15T08:00:00Z')), 'Nov 15, 12:00 AM');
  assert.equal(formatEventWhen(Date.parse('2026-11-15T04:00:00Z')), 'Nov 14, 8:00 PM');
  assert.equal(formatEventWhen(Infinity), '');
  assert.equal(formatEventWhen(-Infinity), '');
  assert.equal(formatEventWhen(0), 'Dec 31, 4:00 PM');

  const el = { hidden: true, textContent: '' };
  assert.equal(renderEventBannerHeader(el, VALID_EVENT, 'now'), true);
  assert.equal(el.textContent, 'Now: Midnight Reading on the Bandstand — hosted by @milo');
  assert.equal(renderEventBannerHeader(el, VALID_EVENT, 'next'), true);
  assert.equal(
    el.textContent,
    'Next: Midnight Reading on the Bandstand — Nov 15, 12:00 PM · hosted by @milo'
  );
});

test('loadEvents rejects 1-char and uppercase host handles, accepts underscore/dash interiors, and keeps duplicate events in order', async () => {
  const load = (events) =>
    loadEvents(async () => ({
      ok: true,
      async json() {
        return { events };
      },
    }));

  assert.equal((await load([{ ...VALID_EVENT, host_handle: 'a' }])).events.length, 0);
  assert.equal((await load([{ ...VALID_EVENT, host_handle: 'a_b-c9' }])).events.length, 1);
  assert.equal((await load([{ ...VALID_EVENT, host_handle: 'Aabc' }])).events.length, 0);
  assert.equal((await load([{ ...VALID_EVENT, host_handle: 'a b' }])).events.length, 0);
  assert.equal((await load([{ ...VALID_EVENT, host_handle: 'a'.repeat(31) + '_' }])).events.length, 1);

  const dup = await load([VALID_EVENT, VALID_EVENT]);
  assert.equal(dup.events.length, 2);
  assert.deepEqual(dup.events[0], VALID_EVENT);
  assert.deepEqual(dup.events[1], VALID_EVENT);
});

test('selectCurrentEvent pins a fractional-duration end boundary and a same-start next tie-break', () => {
  const frac = {
    ...VALID_EVENT,
    start_at: '2026-11-15T20:00:00Z',
    duration_min: 30.5,
  };
  assert.equal(selectCurrentEvent([frac], Date.parse('2026-11-15T20:30:00Z'))?.status, 'now');
  assert.equal(selectCurrentEvent([frac], Date.parse('2026-11-15T20:30:30Z')), null);

  const n1 = {
    ...VALID_EVENT,
    title: 'First',
    start_at: '2026-11-16T18:00:00Z',
    duration_min: 30,
  };
  const n2 = {
    ...VALID_EVENT,
    title: 'Second',
    start_at: '2026-11-16T18:00:00Z',
    duration_min: 30,
  };
  const tie = selectCurrentEvent([n2, n1], Date.parse('2026-11-16T12:00:00Z'));
  assert.equal(tie?.status, 'next');
  assert.equal(tie.event.title, 'Second');
});

test('updateEventBanner prefers eventBanner over group children, and tolerates null bandstandBuilt and null children', () => {
  let redrawCount = 0;
  const makeTextTexture = () => {
    redrawCount += 1;
    return {};
  };
  const makeCard = () => ({
    name: 'event_banner',
    visible: false,
    material: { map: null, needsUpdate: false },
  });

  const cardA = makeCard();
  const cardB = makeCard();
  assert.equal(
    updateEventBanner(
      {
        THREE: {},
        bandstandBuilt: { eventBanner: cardA, group: { children: [cardB] } },
        liveStore: { eventBannerKey: null },
        makeTextTexture,
      },
      VALID_EVENT,
      'next'
    ),
    true
  );
  assert.equal(cardA.visible, true);
  assert.equal(cardB.visible, false);
  assert.equal(redrawCount, 1);

  assert.equal(
    updateEventBanner(
      { THREE: {}, bandstandBuilt: null, liveStore: { eventBannerKey: null }, makeTextTexture },
      VALID_EVENT,
      'next'
    ),
    false
  );
  assert.equal(
    updateEventBanner(
      { THREE: {}, bandstandBuilt: {}, liveStore: { eventBannerKey: null }, makeTextTexture },
      VALID_EVENT,
      'next'
    ),
    false
  );

  let redrawC = 0;
  const cardC = makeCard();
  assert.equal(
    updateEventBanner(
      {
        THREE: {},
        bandstandBuilt: { group: { children: [null, { name: 'other' }, cardC] } },
        liveStore: { eventBannerKey: null },
        makeTextTexture: () => {
          redrawC += 1;
          return {};
        },
      },
      VALID_EVENT,
      'next'
    ),
    true
  );
  assert.equal(cardC.visible, true);
  assert.equal(redrawC, 1);
});

test('renderEventBannerHeader renders missing host_handle and unparseable start_at verbatim', () => {
  const el = { hidden: true, textContent: '' };
  assert.equal(renderEventBannerHeader(el, { title: 'No Host' }, 'now'), true);
  assert.equal(el.textContent, 'Now: No Host — hosted by @undefined');

  assert.equal(
    renderEventBannerHeader(el, { ...VALID_EVENT, start_at: 'not-a-date' }, 'next'),
    true
  );
  assert.equal(
    el.textContent,
    'Next: Midnight Reading on the Bandstand —  · hosted by @milo'
  );

  assert.equal(renderEventBannerHeader(el, { ...VALID_EVENT, title: '' }, 'now'), true);
  assert.equal(el.textContent, 'Now:  — hosted by @milo');
});

test('formatEventWhen returns empty for string, boolean, and null input, and eventBannerLines trims but preserves inner whitespace', () => {
  assert.equal(formatEventWhen('2026-11-15T20:00:00Z'), '');
  assert.equal(formatEventWhen(true), '');
  assert.equal(formatEventWhen(null), '');

  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: '  Midnight Reading  ' }, 'now'),
    ['EVENTS', 'Midnight Reading']
  );
  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: 'word  word' }, 'now'),
    ['EVENTS', 'word  word']
  );
  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: 'word\tword' }, 'now'),
    ['EVENTS', 'word\tword']
  );
});

test('updateEventBanner hide path runs before the material and liveStore guards', () => {
  const card1 = { name: 'event_banner', visible: true };
  assert.equal(
    updateEventBanner(
      { THREE: {}, bandstandBuilt: { eventBanner: card1 }, liveStore: null, makeTextTexture: () => ({}) },
      null,
      null
    ),
    false
  );
  assert.equal(card1.visible, false);

  const card2 = { name: 'event_banner', visible: true };
  assert.equal(
    updateEventBanner(
      {
        THREE: {},
        bandstandBuilt: { eventBanner: card2 },
        liveStore: { eventBannerKey: 'stale' },
        makeTextTexture: () => ({}),
      },
      VALID_EVENT,
      'soon'
    ),
    false
  );
  assert.equal(card2.visible, false);

  const card3 = { name: 'event_banner', visible: true };
  assert.equal(
    updateEventBanner(
      { THREE: {}, bandstandBuilt: { eventBanner: card3 }, liveStore: null, makeTextTexture: () => ({}) },
      VALID_EVENT,
      'soon'
    ),
    false
  );
  assert.equal(card3.visible, false);
});

test('loadEvents with no argument or undefined fetchFn fail-opens to { events: [] }', async () => {
  assert.deepEqual(await loadEvents(), { events: [] });
  assert.deepEqual(await loadEvents(undefined), { events: [] });
});

test('loadEvents rejects bad field types, whitespace-only fields, and duration edges, and preserves newline titles', async () => {
  const invalidPayloads = [
    { ...VALID_EVENT, title: 42 },
    { ...VALID_EVENT, host_handle: 42 },
    { ...VALID_EVENT, start_at: new Date('2026-11-15T20:00:00Z') },
    { ...VALID_EVENT, duration_min: null },
    { ...VALID_EVENT, location: ['Bandstand'] },
    { ...VALID_EVENT, blurb: 7 },
    { ...VALID_EVENT, title: '   ' },
    { ...VALID_EVENT, start_at: '   ' },
    { ...VALID_EVENT, duration_min: 14.999 },
    { ...VALID_EVENT, duration_min: 240.5 },
    { ...VALID_EVENT, duration_min: 0 },
  ];
  for (const bad of invalidPayloads) {
    const res = await loadEvents(async () => ({
      ok: true,
      async json() {
        return { events: [bad] };
      },
    }));
    assert.deepEqual(res, { events: [] });
  }

  const newlineEvent = { ...VALID_EVENT, title: 'Line one\nLine two' };
  const res = await loadEvents(async () => ({
    ok: true,
    async json() {
      return { events: [newlineEvent] };
    },
  }));
  assert.deepEqual(res, { events: [newlineEvent] });
});

test('selectCurrentEvent returns normalized event and picks starting event at back-to-back boundary', () => {
  const padded = {
    ...VALID_EVENT,
    title: '  Midnight Reading on the Bandstand  ',
    host_handle: '  milo ',
    start_at: ' 2026-11-15T20:00:00Z ',
    extra: 'drop me',
  };
  const res = selectCurrentEvent([padded], Date.parse('2026-11-15T20:30:00Z'));
  assert.equal(res?.status, 'now');
  assert.deepEqual(res?.event, VALID_EVENT);

  const eventA = { ...VALID_EVENT, title: 'A', start_at: '2026-11-15T19:00:00Z', duration_min: 60 };
  const eventB = { ...VALID_EVENT, title: 'B', start_at: '2026-11-15T20:00:00Z', duration_min: 60 };
  const boundary = selectCurrentEvent([eventA, eventB], Date.parse('2026-11-15T20:00:00Z'));
  assert.equal(boundary?.status, 'now');
  assert.equal(boundary?.event.title, 'B');
});

test('selectCurrentEvent handles Infinity nowMs, non-array events, epoch nowMs, and array entries', () => {
  assert.equal(selectCurrentEvent([VALID_EVENT], Infinity), null);
  assert.equal(selectCurrentEvent([VALID_EVENT], -Infinity), null);
  assert.equal(selectCurrentEvent({ events: [VALID_EVENT] }, 0), null);
  assert.equal(selectCurrentEvent([VALID_EVENT], 0)?.status, 'next');
  assert.equal(selectCurrentEvent([[VALID_EVENT]], Date.parse('2026-11-15T20:30:00Z')), null);
});

test('eventBannerLines pins exact 30-char wrap points and trim-then-split order', () => {
  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: 'a'.repeat(30) }, 'now'),
    ['EVENTS', 'a'.repeat(30)]
  );
  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: 'alpha beta gamma delta epsilon zeta' }, 'next'),
    ['NEXT EVENT', 'alpha beta gamma delta epsilon', 'zeta']
  );
  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: '  ' + 'b'.repeat(35) + '  ' }, 'now'),
    ['EVENTS', 'b'.repeat(30), 'b'.repeat(5)]
  );
});

test('updateEventBanner redraws on title change, keeps hidden card hidden on cache hit, and falls back when eventBanner is null', () => {
  const card = { name: 'event_banner', visible: false, material: { map: null, needsUpdate: false } };
  let redraws = 0;
  const makeTextTexture = () => {
    redraws += 1;
    return { id: redraws };
  };
  const liveStore = { eventBannerKey: null };
  const ctx = { THREE: {}, bandstandBuilt: { group: { children: [card] } }, liveStore, makeTextTexture };

  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), true);
  assert.equal(redraws, 1);

  assert.equal(updateEventBanner(ctx, { ...VALID_EVENT, title: 'A Different Title' }, 'next'), true);
  assert.equal(redraws, 2);

  card.visible = false;
  assert.equal(updateEventBanner(ctx, { ...VALID_EVENT, title: 'A Different Title' }, 'next'), false);
  assert.equal(redraws, 2);
  assert.equal(card.visible, false);

  const card2 = { name: 'event_banner', visible: false, material: { map: null, needsUpdate: false } };
  assert.equal(
    updateEventBanner(
      {
        THREE: {},
        bandstandBuilt: { eventBanner: null, group: { children: [card2] } },
        liveStore: { eventBannerKey: null },
        makeTextTexture,
      },
      VALID_EVENT,
      'now'
    ),
    true
  );
  assert.equal(card2.visible, true);

  assert.equal(
    updateEventBanner(
      {
        THREE: {},
        bandstandBuilt: { eventBanner: undefined, group: undefined },
        liveStore: { eventBannerKey: null },
        makeTextTexture,
      },
      VALID_EVENT,
      'now'
    ),
    false
  );
});

test('renderEventBannerHeader renders markup verbatim via textContent and formats next with missing host', () => {
  const el = { hidden: true, textContent: '' };
  assert.equal(
    renderEventBannerHeader(el, { ...VALID_EVENT, title: '<b>Bold</b> & "quotes"' }, 'now'),
    true
  );
  assert.equal(el.textContent, 'Now: <b>Bold</b> & "quotes" — hosted by @milo');

  const el2 = { hidden: true, textContent: '' };
  assert.equal(
    renderEventBannerHeader(el2, { title: 'No Host', start_at: '2026-11-15T20:00:00Z' }, 'next'),
    true
  );
  assert.equal(el2.textContent, 'Next: No Host — Nov 15, 12:00 PM · hosted by @undefined');
});

test('formatEventWhen pads single-digit minutes, rejects Date objects, and handles epoch minus 1ms', () => {
  assert.equal(formatEventWhen(Date.parse('2026-11-15T20:05:00Z')), 'Nov 15, 12:05 PM');
  assert.equal(formatEventWhen(new Date('2026-11-15T20:00:00Z')), '');
  assert.equal(formatEventWhen(-1), 'Dec 31, 3:59 PM');
});

test('loadEvents calls fetchFn once with events.json, skips undefined entries, and handles empty events', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return {
      ok: true,
      async json() {
        return { events: [undefined, VALID_EVENT] };
      },
    };
  };
  const res = await loadEvents(fetchFn);
  assert.deepEqual(calls, ['events.json']);
  assert.equal(res.events.length, 1);
  assert.deepEqual(res.events[0], VALID_EVENT);

  assert.deepEqual(
    await loadEvents(async () => ({
      ok: true,
      async json() {
        return { events: [] };
      },
    })),
    { events: [] }
  );
});

test('selectCurrentEvent prefers now over next regardless of order and tie-breaks same-start now first-in-file', () => {
  const nowEv = { ...VALID_EVENT, title: 'Now', start_at: '2026-11-15T20:00:00Z', duration_min: 60 };
  const nextEv = { ...VALID_EVENT, title: 'Next', start_at: '2026-11-16T18:00:00Z', duration_min: 30 };
  const t = Date.parse('2026-11-15T20:30:00Z');
  assert.equal(selectCurrentEvent([nextEv, nowEv], t)?.event.title, 'Now');
  assert.equal(selectCurrentEvent([nowEv, nextEv], t)?.event.title, 'Now');

  const tie1 = { ...VALID_EVENT, title: 'TieOne', start_at: '2026-11-15T20:00:00Z', duration_min: 60 };
  const tie2 = { ...VALID_EVENT, title: 'TieTwo', start_at: '2026-11-15T20:00:00Z', duration_min: 60 };
  assert.equal(selectCurrentEvent([tie2, tie1], t)?.event.title, 'TieTwo');
});

test('loadEvents rejects json primitives, accepts truthy ok, and preserves mixed valid/invalid order', async () => {
  const load = (events) =>
    loadEvents(async () => ({
      ok: true,
      async json() {
        return { events };
      },
    }));
  assert.deepEqual(await load('x'), { events: [] });
  assert.deepEqual(await load(42), { events: [] });
  assert.deepEqual(await load(true), { events: [] });
  assert.deepEqual(
    await loadEvents(async () => ({ ok: 1, async json() { return { events: [VALID_EVENT] }; } })),
    { events: [VALID_EVENT] }
  );
  const v2 = { ...VALID_EVENT, title: 'Second' };
  const v3 = { ...VALID_EVENT, title: 'Third' };
  const mixed = await load([VALID_EVENT, { ...VALID_EVENT, title: '' }, v2, { ...VALID_EVENT, duration_min: 10 }, v3]);
  assert.deepEqual(mixed.events, [VALID_EVENT, v2, v3]);
});

test('selectCurrentEvent handles 1ms boundary edges, skips invalid earliest start, and accepts 15-min duration', () => {
  const ev = { ...VALID_EVENT, start_at: '2026-11-15T20:00:00Z', duration_min: 60 };
  const startMs = Date.parse('2026-11-15T20:00:00Z');
  assert.equal(selectCurrentEvent([ev], startMs - 1)?.status, 'next');
  assert.equal(selectCurrentEvent([ev], startMs + 3600000 - 1)?.status, 'now');
  assert.equal(selectCurrentEvent([ev], startMs + 3600000), null);
  const invalidEarly = { ...VALID_EVENT, title: '', start_at: '2026-11-15T19:00:00Z' };
  const later = { ...VALID_EVENT, title: 'Later', start_at: '2026-11-16T18:00:00Z', duration_min: 30 };
  const r = selectCurrentEvent([invalidEarly, later], Date.parse('2026-11-15T20:30:00Z'));
  assert.equal(r?.status, 'next');
  assert.equal(r?.event.title, 'Later');
  const min15 = { ...VALID_EVENT, start_at: '2026-11-15T20:00:00Z', duration_min: 15 };
  assert.equal(selectCurrentEvent([min15], startMs)?.status, 'now');
});

test('eventBannerLines falls through on non-now status, hard-splits 31-char token, and wraps greedily', () => {
  assert.deepEqual(eventBannerLines(VALID_EVENT, ''), ['NEXT EVENT', 'Midnight Reading on the', 'Bandstand']);
  assert.equal(eventBannerLines(VALID_EVENT, 'NOW')[0], 'NEXT EVENT');
  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: 'x'.repeat(31) }, 'now'),
    ['EVENTS', 'x'.repeat(30), 'x']
  );
  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: 'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp' }, 'now'),
    ['EVENTS', 'aa bb cc dd ee ff gg hh ii jj', 'kk ll mm nn oo pp']
  );
});

test('updateEventBanner forwards THREE and lines, replaces map, and leaves needsUpdate false on cache hit', () => {
  let gotThree = null;
  let gotLines = null;
  let calls = 0;
  const THREE = { marker: 1 };
  const oldMap = { old: true };
  const card = { name: 'event_banner', visible: false, material: { map: oldMap, needsUpdate: false } };
  const liveStore = { eventBannerKey: null };
  const makeTextTexture = (t, lines, opts) => {
    calls += 1;
    gotThree = t;
    gotLines = lines;
    return { lines, opts };
  };
  const ctx = { THREE, bandstandBuilt: { eventBanner: card }, liveStore, makeTextTexture };
  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), true);
  assert.equal(gotThree, THREE);
  assert.deepEqual(gotLines, eventBannerLines(VALID_EVENT, 'next'));
  assert.notEqual(card.material.map, oldMap);
  assert.equal(card.material.needsUpdate, true);
  card.material.needsUpdate = false;
  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), false);
  assert.equal(card.material.needsUpdate, false);
  assert.equal(card.visible, true);
  assert.equal(calls, 1);
});

test('renderEventBannerHeader formats epoch next, dash/underscore host, verbatim punctuation, and stays visible', () => {
  const el = { hidden: true, textContent: '' };
  assert.equal(renderEventBannerHeader(el, { ...VALID_EVENT, start_at: '1970-01-01T00:00:00Z' }, 'next'), true);
  assert.equal(el.textContent, 'Next: Midnight Reading on the Bandstand — Dec 31, 4:00 PM · hosted by @milo');
  const el2 = { hidden: true, textContent: '' };
  assert.equal(renderEventBannerHeader(el2, { ...VALID_EVENT, host_handle: 'wick-2_x', title: 'A — B · C' }, 'now'), true);
  assert.equal(el2.textContent, 'Now: A — B · C — hosted by @wick-2_x');
  const el3 = { hidden: false, textContent: 'old' };
  assert.equal(renderEventBannerHeader(el3, VALID_EVENT, 'now'), true);
  assert.equal(el3.hidden, false);
});

test('formatEventWhen matches exact Pacific Time pins across midday, midnight, and pre-epoch timestamps', () => {
  assert.equal(formatEventWhen(Date.parse('2026-11-15T21:00:00Z')), 'Nov 15, 1:00 PM');
  assert.equal(formatEventWhen(Date.parse('2026-11-15T00:30:00Z')), 'Nov 14, 4:30 PM');
  assert.equal(formatEventWhen(Date.parse('2026-11-05T20:00:00Z')), 'Nov 5, 12:00 PM');
  assert.equal(formatEventWhen(Date.parse('2027-01-01T08:00:00Z')), 'Jan 1, 12:00 AM');
  assert.equal(formatEventWhen(-86400000), 'Dec 30, 4:00 PM');
});

test('loadEvents accepts offset start_at, date-only start_at, unicode title, and trims tab whitespace', async () => {
  const load = (events) =>
    loadEvents(async () => ({
      ok: true,
      async json() {
        return { events };
      },
    }));
  const off = { ...VALID_EVENT, start_at: '2026-11-15T20:00:00+02:00' };
  assert.deepEqual((await load([off])).events, [off]);
  const dateOnly = { ...VALID_EVENT, start_at: '2026-11-15' };
  assert.deepEqual((await load([dateOnly])).events, [dateOnly]);
  const uni = { ...VALID_EVENT, title: '🎃 Lantern Night — lueur' };
  assert.deepEqual((await load([uni])).events, [uni]);
  const tab = { ...VALID_EVENT, title: '\tTabbed Title\t' };
  assert.deepEqual((await load([tab])).events, [{ ...VALID_EVENT, title: 'Tabbed Title' }]);
});

test('event-banner.mjs source pins header, single import, validation constants, and no three import', async () => {
  const src = await fs.readFile(path.join(HERE, 'event-banner.mjs'), 'utf8');
  const lines = src.split('\n');
  assert.equal(lines[0], '// Staging-local Bandstand event banner + Prompt Book event header.');
  assert.equal(lines[1], '// No THREE import; no top-level document access.');
  assert.equal(lines[3], "import { splitNightlyCallLines } from './inn-nightly-call.mjs';");
  assert.equal(lines[5], 'const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;');
  assert.equal(lines[6], 'const MIN_DURATION_MIN = 15;');
  assert.equal(lines[7], 'const MAX_DURATION_MIN = 240;');
  assert.equal(lines[8], 'const MAX_TITLE_LEN = 80;');
  assert.equal(lines[9], 'const MAX_BLURB_LEN = 200;');
  assert.equal(lines.filter((l) => l.startsWith('import ')).length, 1);
  assert.equal(lines.filter((l) => l.includes("from 'three'")).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 1);
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 0);
});

test('staging.js event-banner wiring pins import, store key, applyStagingState, and loadEvents calls', async () => {
  const stagingSrc = await fs.readFile(path.join(HERE, 'staging.js'), 'utf8');
  const sl = stagingSrc.split('\n');
  assert.equal(sl[43], '  loadEvents,');
  assert.equal(sl[543], '    eventBannerKey: null,');
  assert.equal(sl[843], '  const selectedEvent = selectCurrentEvent(liveStore.events, ' + 'Date' + '.now());');
  assert.equal(sl[844], '  updateEventBanner(');
  assert.equal(sl[854], '  renderEventBannerHeader(');
  assert.equal(sl[1258], '  loadEvents()');
  assert.equal(sl[1262], '        const selectedEvent = selectCurrentEvent(liveStore.events, ' + 'Date' + '.now());');
  assert.equal(sl.filter((l) => l.includes('selectCurrentEvent(')).length, 2);
  assert.equal(sl.filter((l) => l.includes('updateEventBanner(')).length, 2);
  assert.equal(sl.filter((l) => l.includes('renderEventBannerHeader(')).length, 2);
  assert.equal(sl.filter((l) => l.includes('loadEvents()')).length, 1);
});

test('test-event-banner.mjs file hygiene pins 59 unique names, 7 imports, and forbidden-literal counts', async () => {
  const self = await fs.readFile(path.join(HERE, 'test-event-banner.mjs'), 'utf8');
  const lines = self.split('\n');
  const names = [...self.matchAll(/^(?:await )?test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 59);
  assert.equal(new Set(names).size, 59); // every top-level test name unique
  assert.deepEqual(lines.filter((l) => l.startsWith('import ')), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'import {',
    "import { collectSourceFiles } from '../scripts/stage-deploy.mjs';",
  ]); // no new top-level imports
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Math' + '.random')).length, 0);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.toLowerCase().includes('camp' + 'fire')).length, 0);
  assert.equal(lines.filter((l) => l.includes('inner' + 'HTML')).length, 0);
});

test('P1 — loadEvents fail-opens on a non-Error throw, undefined JSON, and missing ok', async () => {
  assert.deepEqual(
    await loadEvents(async () => {
      throw 'boom';
    }),
    { events: [] }
  );
  assert.deepEqual(
    await loadEvents(async () => ({
      ok: true,
      async json() {
        return undefined;
      },
    })),
    { events: [] }
  );
  assert.deepEqual(
    await loadEvents(async () => ({
      async json() {
        return { events: [VALID_EVENT] };
      },
    })),
    { events: [] }
  );
});

test('P2 — millisecond-precision and offset start_at pass through verbatim, and select on exact boundaries', async () => {
  const ms = { ...VALID_EVENT, start_at: '2026-11-15T20:00:00.500Z' };
  const loaded = await loadEvents(async () => ({
    ok: true,
    async json() {
      return { events: [ms] };
    },
  }));
  assert.deepEqual(loaded.events, [ms]);
  assert.equal(
    selectCurrentEvent([ms], Date.parse('2026-11-15T20:00:00.250Z'))?.status,
    'next'
  );
  assert.equal(
    selectCurrentEvent([ms], Date.parse('2026-11-15T20:00:00.500Z'))?.status,
    'now'
  );
  const off = { ...VALID_EVENT, start_at: '2026-11-15T22:00:00+02:00' };
  assert.equal(
    selectCurrentEvent([off], Date.parse('2026-11-15T20:00:00Z'))?.status,
    'now'
  );
});

test('P3 — updateEventBanner guard failure preserves a stale key and leaves the card untouched', () => {
  const card = {
    name: 'event_banner',
    visible: false,
    material: { map: null, needsUpdate: false },
  };
  const liveStore = { eventBannerKey: 'stale-key' };
  assert.equal(
    updateEventBanner(
      { THREE: null, bandstandBuilt: { eventBanner: card }, liveStore, makeTextTexture: () => ({}) },
      VALID_EVENT,
      'next'
    ),
    false
  );
  assert.equal(liveStore.eventBannerKey, 'stale-key');
  assert.equal(card.visible, false);

  const card2 = { name: 'event_banner', visible: true, material: null };
  const liveStore2 = { eventBannerKey: 'k2' };
  assert.equal(
    updateEventBanner(
      { THREE: {}, bandstandBuilt: { eventBanner: card2 }, liveStore: liveStore2, makeTextTexture: () => ({}) },
      VALID_EVENT,
      'next'
    ),
    false
  );
  assert.equal(card2.visible, true);
  assert.equal(liveStore2.eventBannerKey, 'k2');
});

test('P4 — formatEventWhen future pins in Pacific Time', () => {
  assert.equal(formatEventWhen(Date.parse('2030-06-15T20:00:00Z')), 'Jun 15, 1:00 PM');
  assert.equal(formatEventWhen(Date.parse('2027-02-14T20:00:00Z')), 'Feb 14, 12:00 PM');
});

test('P5 — renderEventBannerHeader handles undefined title, null event with now, and newline title verbatim', () => {
  const el = { hidden: true, textContent: '' };
  assert.equal(
    renderEventBannerHeader(el, { title: undefined, host_handle: 'milo' }, 'now'),
    true
  );
  assert.equal(el.textContent, 'Now: undefined — hosted by @milo');
  assert.equal(renderEventBannerHeader(el, null, 'now'), false);
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, '');

  const el2 = { hidden: true, textContent: '' };
  assert.equal(
    renderEventBannerHeader(el2, { ...VALID_EVENT, title: 'Line one\nLine two' }, 'now'),
    true
  );
  assert.equal(el2.textContent, 'Now: Line one\nLine two — hosted by @milo');
});

test('P6 — eventBannerLines wraps a 30-char word plus trailing words', () => {
  assert.deepEqual(
    eventBannerLines({ ...VALID_EVENT, title: 'a'.repeat(30) + ' b c' }, 'now'),
    ['EVENTS', 'a'.repeat(30), 'b c']
  );
});

test('P7 — staging.js applyStagingState event block source lines', async () => {
  const sl = (await fs.readFile(path.join(HERE, 'staging.js'), 'utf8')).split('\n');
  assert.equal(sl[845], '    {');
  assert.equal(sl[846], '      THREE,');
  assert.equal(sl[847], '      bandstandBuilt,');
  assert.equal(sl[848], '      liveStore,');
  assert.equal(sl[849], '      makeTextTexture: makeBandstandTextTexture,');
  assert.equal(sl[850], '    },');
  assert.equal(sl[851], '    selectedEvent?.event || null,');
  assert.equal(sl[852], '    selectedEvent?.status || null');
  assert.equal(sl[853], '  );');
  assert.equal(sl[855], '    eventBannerEl,');
  assert.equal(sl[856], '    selectedEvent?.event || null,');
  assert.equal(sl[857], '    selectedEvent?.status || null');
  assert.equal(sl[858], '  );');
});

test('P8 — staging.js loadEvents().then block source lines', async () => {
  const sl = (await fs.readFile(path.join(HERE, 'staging.js'), 'utf8')).split('\n');
  assert.equal(sl[1259], '    .then(({ events }) => {');
  assert.equal(sl[1260], '      liveStore.events = Array.isArray(events) ? events : [];');
  assert.equal(sl[1261], '      if (liveStore.lastState) {');
  assert.equal(sl[1263], '        updateEventBanner(');
  assert.equal(sl[1264], '          {');
  assert.equal(sl[1265], '            THREE,');
  assert.equal(sl[1266], '            bandstandBuilt,');
  assert.equal(sl[1267], '            liveStore,');
  assert.equal(sl[1268], '            makeTextTexture: makeBandstandTextTexture,');
  assert.equal(sl[1269], '          },');
  assert.equal(sl[1270], '          selectedEvent?.event || null,');
  assert.equal(sl[1271], '          selectedEvent?.status || null');
  assert.equal(sl[1272], '        );');
  assert.equal(sl[1273], '        renderEventBannerHeader(');
  assert.equal(sl[1274], '          eventBannerEl,');
  assert.equal(sl[1275], '          selectedEvent?.event || null,');
  assert.equal(sl[1276], '          selectedEvent?.status || null');
  assert.equal(sl[1277], '        );');
});

test('P9 — selectCurrentEvent returns the normalized event for next too', () => {
  const padded = {
    ...VALID_EVENT,
    title: '  Midnight Reading on the Bandstand  ',
    host_handle: '  milo ',
    start_at: ' 2026-11-15T20:00:00Z ',
    extra: 'drop me',
  };
  const res = selectCurrentEvent([padded], Date.parse('2026-11-15T19:00:00Z'));
  assert.equal(res?.status, 'next');
  assert.deepEqual(res?.event, VALID_EVENT);
});

test('P10 — updateEventBanner cache hit leaves the map object untouched', () => {
  const oldMap = { old: true };
  const card = {
    name: 'event_banner',
    visible: true,
    material: { map: oldMap, needsUpdate: false },
  };
  const liveStore = { eventBannerKey: null };
  let calls = 0;
  const ctx = {
    THREE: {},
    bandstandBuilt: { eventBanner: card },
    liveStore,
    makeTextTexture: () => {
      calls += 1;
      return { fresh: true };
    },
  };
  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), true);
  assert.notEqual(card.material.map, oldMap);
  const drawnMap = card.material.map;
  card.material.needsUpdate = false;
  assert.equal(updateEventBanner(ctx, VALID_EVENT, 'next'), false);
  assert.equal(card.material.map, drawnMap);
  assert.equal(card.material.needsUpdate, false);
  assert.equal(calls, 1);
});

test('P11 — formatEventWhen pins America/Los_Angeles under hostile TZ=Pacific/Kiritimati and TZ=UTC', async () => {
  const { execFileSync } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const modUrl = pathToFileURL(path.join(HERE, 'event-banner.mjs')).href;
  const script = [
    `import assert from 'node:assert/strict';`,
    `import { formatEventWhen } from ${JSON.stringify(modUrl)};`,
    `assert.equal(formatEventWhen(Date.parse('2030-06-15T20:00:00Z')), 'Jun 15, 1:00 PM');`,
    `assert.equal(formatEventWhen(Date.parse('2027-02-14T20:00:00Z')), 'Feb 14, 12:00 PM');`,
  ].join('\n');
  for (const tz of ['Pacific/Kiritimati', 'UTC']) {
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    });
  }
});
