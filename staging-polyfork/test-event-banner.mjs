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

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
