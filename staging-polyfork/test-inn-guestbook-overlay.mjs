import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveInnOverlayContent,
  resolveGuestbookOverlayContent,
  resolvePlotGuestbookOverlayContent,
  formatPlotGuestbookTabLabel,
  openInnOverlay,
  openGuestbookOverlay,
  openPlotGuestbookOverlay,
} from './inn-guestbook-overlay.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function makeFakeOverlayElements() {
  function makeEl() {
    const attrs = new Map();
    return {
      hidden: true,
      textContent: '',
      _src: '',
      _srcdoc: '',
      setAttribute(k, v) {
        attrs.set(k, String(v));
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'src') this._src = undefined;
        if (k === 'srcdoc') this._srcdoc = undefined;
      },
      set src(v) {
        this._src = v;
        attrs.set('src', v);
      },
      get src() {
        return this._src;
      },
      set srcdoc(v) {
        this._srcdoc = v;
        attrs.set('srcdoc', v);
      },
      get srcdoc() {
        return this._srcdoc;
      },
    };
  }
  return {
    overlayEl: makeEl(),
    titleEl: makeEl(),
    iframeEl: makeEl(),
  };
}

test('resolveInnOverlayContent renders live/fetched inn state with escaped handles and falls back to inn/index.html', async () => {
  const nowSec = 1_700_000_000;
  let fetched = false;
  const directRes = await resolveInnOverlayContent({
    innState: {
      lantern: { handle: 'aaron<script>', expires_at: nowSec + 2 * 86400 },
      window: { handle: 'maren', nights: 3 },
      quiet: null,
    },
    nowSec,
    fetchFn: async () => {
      fetched = true;
      return { status: 200 };
    },
  });
  assert.equal(fetched, false, 'usable innState must not trigger /api/town/state fetch');
  assert.equal(directRes.kind, 'api');
  assert.match(directRes.html, /The Lantern Room/);
  assert.match(directRes.html, /Occupied — @aaron&lt;script&gt;, 2 nights left\./);
  assert.match(directRes.html, /Occupied — @maren, 3 nights left\./);
  assert.match(directRes.html, /The Quiet Room[\s\S]*?Vacant — free tonight\./);

  const apiRes = await resolveInnOverlayContent({
    innState: null,
    apiBase: 'https://example.test/',
    nowSec,
    fetchFn: async (url) => {
      assert.equal(url, 'https://example.test/api/town/state');
      return {
        status: 200,
        async json() {
          return { inn: { lantern: { handle: 'wick', nights: 1 }, window: null, quiet: null } };
        },
      };
    },
  });
  assert.equal(apiRes.kind, 'api');
  assert.match(apiRes.html, /Occupied — @wick, 1 night left\./);

  const absentInnRes = await resolveInnOverlayContent({
    innState: undefined,
    fetchFn: async () => ({ status: 200, async json() { return { state_seq: 1 }; } }),
  });
  assert.deepEqual(absentInnRes, { kind: 'static', url: 'inn/index.html' });

  const offlineRes = await resolveInnOverlayContent({
    fetchFn: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(offlineRes, { kind: 'static', url: 'inn/index.html' });

  const noFetchRes = await resolveInnOverlayContent({ fetchFn: null });
  assert.deepEqual(noFetchRes, { kind: 'static', url: 'inn/index.html' });
});

test('resolveGuestbookOverlayContent renders Signatures before Letters, escapes HTML, formats town dates, caps at 50, and falls back to guestbook/index.html', async () => {
  const entries = [
    { kind: 'letter', name: 'Maren', body: 'Letter <one>', created_at: 1700000000 },
    { kind: 'guestbook', name: 'Wick & Co', body: 'Signed "hello"', created_at: 1700000000 },
  ];
  for (let i = 0; i < 55; i++) {
    entries.push({ kind: 'guestbook', name: `Guest${i}`, body: `Note ${i}`, created_at: 1700000000 });
  }

  const apiRes = await resolveGuestbookOverlayContent({
    apiBase: 'https://example.test/',
    fetchFn: async (url) => {
      assert.equal(url, 'https://example.test/api/town/guestbook?limit=50');
      return {
        status: 200,
        async json() { return { entries }; },
      };
    },
  });
  assert.equal(apiRes.kind, 'api');
  const sigIdx = apiRes.html.indexOf('<h2>Signatures</h2>');
  const letIdx = apiRes.html.indexOf('<h2>Letters to the Editor</h2>');
  assert.ok(sigIdx !== -1 && letIdx !== -1 && sigIdx < letIdx, 'Signatures must appear before Letters to the Editor');
  assert.match(apiRes.html, /Wick &amp; Co/);
  assert.match(apiRes.html, /Signed &quot;hello&quot;/);
  assert.match(apiRes.html, /Letter &lt;one&gt;/);
  assert.match(apiRes.html, /Nov 14, 2023/);
  assert.ok(!apiRes.html.includes('Guest50'), 'entries beyond 50 must be capped');

  const notFoundRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 404 }),
  });
  assert.deepEqual(notFoundRes, { kind: 'static', url: 'guestbook/index.html' });

  const throwRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => { throw new Error('network'); },
  });
  assert.deepEqual(throwRes, { kind: 'static', url: 'guestbook/index.html' });

  const noFetchRes = await resolveGuestbookOverlayContent({ fetchFn: null });
  assert.deepEqual(noFetchRes, { kind: 'static', url: 'guestbook/index.html' });
});

test('openInnOverlay and openGuestbookOverlay manage sandboxed iframe, title, src/srcdoc, and hidden state', async () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  let beforeCount = 0;

  const innRes = await openInnOverlay({
    overlayEl,
    titleEl,
    iframeEl,
    innState: { lantern: { handle: 'alice', nights: 2 }, window: null, quiet: null },
    onBeforeOpen: () => { beforeCount++; },
  });
  assert.equal(beforeCount, 1);
  assert.equal(innRes.kind, 'api');
  assert.equal(overlayEl.hidden, false);
  assert.equal(titleEl.textContent, 'Ghostlight Inn — The Guest Book');
  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.match(iframeEl.srcdoc, /@alice, 2 nights left/);
  assert.equal(iframeEl.getAttribute('src'), null);

  const gbStaticRes = await openGuestbookOverlay({
    overlayEl,
    titleEl,
    iframeEl,
    fetchFn: async () => ({ status: 404 }),
    onBeforeOpen: () => { beforeCount++; },
  });
  assert.equal(beforeCount, 2);
  assert.equal(gbStaticRes.kind, 'static');
  assert.equal(overlayEl.hidden, false);
  assert.equal(titleEl.textContent, 'Town Gate Guestbook');
  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.equal(iframeEl.src, 'guestbook/index.html');
  assert.equal(iframeEl.getAttribute('srcdoc'), null);

  assert.equal(await openInnOverlay({}), null);
  assert.equal(await openGuestbookOverlay({}), null);
  assert.equal(await openPlotGuestbookOverlay('lampmoth', {}), null);
});

test('resolvePlotGuestbookOverlayContent and openPlotGuestbookOverlay render srcdoc for api and fallback', async () => {
  assert.equal(formatPlotGuestbookTabLabel(undefined), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(0), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(3), 'Guestbook (3)');

  let invalidFetched = false;
  const invalid = await resolvePlotGuestbookOverlayContent('../bad', {
    fetchFn: async () => {
      invalidFetched = true;
      return { status: 200, async json() { return { entries: [] }; } };
    },
  });
  assert.equal(invalidFetched, false);
  assert.equal(invalid.kind, 'fallback');

  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  let beforeCount = 0;
  const calls = [];
  const apiRes = await openPlotGuestbookOverlay('lampmoth', {
    overlayEl,
    titleEl,
    iframeEl,
    fetchFn: async (url) => {
      calls.push(url);
      return {
        status: 200,
        async json() {
          return {
            entries: [
              { id: 1, kind: 'guestbook', name: '<script>milo</script>', body: 'Hi <b>there</b>.', created_at: 1744500000 },
              { id: 2, kind: 'letter', name: 'maren', body: 'Door letter.', created_at: 1744586400 },
            ],
          };
        },
      };
    },
    onBeforeOpen: () => { beforeCount++; },
  });
  assert.deepEqual(calls, ['/api/town/guestbook?plot=lampmoth&limit=50']);
  assert.equal(beforeCount, 1);
  assert.equal(apiRes.kind, 'api');
  assert.equal(overlayEl.hidden, false);
  assert.equal(titleEl.textContent, '@lampmoth — Guestbook');
  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.equal(iframeEl.getAttribute('src'), null);
  assert.ok(iframeEl.srcdoc.includes("<h1>@lampmoth's Guestbook</h1>"));
  assert.ok(iframeEl.srcdoc.includes('&lt;script&gt;milo&lt;/script&gt;'));
  assert.ok(iframeEl.srcdoc.includes('Apr 12, 2025'));
  assert.ok(iframeEl.srcdoc.includes('<h2>Signatures</h2>'));
  assert.ok(iframeEl.srcdoc.includes('<h2>Letters</h2>'));

  const fbRes = await openPlotGuestbookOverlay('lampmoth', {
    overlayEl,
    titleEl,
    iframeEl,
    fetchFn: async () => ({ status: 500 }),
    onBeforeOpen: () => { beforeCount++; },
  });
  assert.equal(beforeCount, 2);
  assert.equal(fbRes.kind, 'fallback');
  assert.equal(overlayEl.hidden, false);
  assert.equal(titleEl.textContent, '@lampmoth — Guestbook');
  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.equal(iframeEl.getAttribute('src'), null);
  assert.ok(iframeEl.srcdoc.includes("<h1>@lampmoth's Guestbook</h1>"));
  assert.ok(iframeEl.srcdoc.includes('How to sign'));
});

test('inn-guestbook-overlay.mjs pure resolvers and helpers stay verbatim in sync with town-3d/town.js', async () => {
  const [townSrc, stagingSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'inn-guestbook-overlay.mjs'), 'utf8'),
  ]);

  const townBlock = townSrc.match(/const INN_ROOM_DETAILS = \[[\s\S]*?return \{ kind: 'fallback', html: buildPlotGuestbookFallbackHtml\(handle\) \};\n\}/);
  const stagingBlock = stagingSrc.match(/const INN_ROOM_DETAILS = \[[\s\S]*?return \{ kind: 'fallback', html: buildPlotGuestbookFallbackHtml\(handle\) \};\n\}/);
  assert.ok(townBlock, 'town-3d/town.js must contain INN_ROOM_DETAILS through resolvePlotGuestbookOverlayContent');
  assert.ok(stagingBlock, 'staging-polyfork/inn-guestbook-overlay.mjs must contain INN_ROOM_DETAILS through resolvePlotGuestbookOverlayContent');
  assert.equal(stagingBlock[0], townBlock[0], 'inn-guestbook-overlay.mjs drifted from town-3d/town.js');
});

test('resolveInnOverlayContent handles occupancy-line edges and innState usability', async () => {
  const nowSec = 1_700_000_000;

  const edgesRes = await resolveInnOverlayContent({
    innState: {
      lantern: { handle: 'expired', expires_at: nowSec - 1000 },
      window: { handle: 'zero', nights: 0 },
      quiet: { handle: 'frac', nights: 2.5 },
    },
    nowSec,
  });
  assert.equal(edgesRes.kind, 'api');
  assert.match(edgesRes.html, /Occupied — @expired, 1 night left\./);
  assert.match(edgesRes.html, /Occupied — @zero, 1 night left\./);
  assert.match(edgesRes.html, /Occupied — @frac, 3 nights left\./);

  const precedenceRes = await resolveInnOverlayContent({
    innState: {
      lantern: { handle: 'precedence', expires_at: nowSec + 5 * 86400, nights: 1 },
      window: { handle: '', nights: 2 },
      quiet: { nights: 2 },
    },
    nowSec,
  });
  assert.equal(precedenceRes.kind, 'api');
  assert.match(precedenceRes.html, /Occupied — @precedence, 5 nights left\./);
  assert.match(precedenceRes.html, /The Window Room[\s\S]*?Vacant — free tonight\./);
  assert.match(precedenceRes.html, /The Quiet Room[\s\S]*?Vacant — free tonight\./);

  const nonObjectAndNullRes = await resolveInnOverlayContent({
    innState: {
      lantern: null,
      window: 'x',
    },
    nowSec,
  });
  assert.equal(nonObjectAndNullRes.kind, 'api');
  assert.match(nonObjectAndNullRes.html, /The Lantern Room[\s\S]*?Vacant — free tonight\./);
  assert.match(nonObjectAndNullRes.html, /The Window Room[\s\S]*?Vacant — free tonight\./);

  let fetchCalled = false;
  const unknownRoomRes = await resolveInnOverlayContent({
    innState: { attic: { handle: 'ghost', nights: 2 } },
    nowSec,
    fetchFn: async () => {
      fetchCalled = true;
      return { status: 404 };
    },
  });
  assert.equal(fetchCalled, true, 'innState with only unknown room keys must fall through to fetch');
  assert.deepEqual(unknownRoomRes, { kind: 'static', url: 'inn/index.html' });
});

test('resolveGuestbookOverlayContent handles entry-shape edges, empty lists, and non-array entries', async () => {
  const mixedRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return {
          entries: [
            null,
            'not-an-object',
            42,
            { kind: 'announcement', name: 'Ignored', body: 'Should be dropped', created_at: 1700000000 },
            { kind: 'guestbook', name: 'NoDate', body: 'Signed without timestamp' },
          ],
        };
      },
    }),
  });
  assert.equal(mixedRes.kind, 'api');
  assert.ok(!mixedRes.html.includes('Ignored'));
  assert.ok(!mixedRes.html.includes('Should be dropped'));
  assert.match(mixedRes.html, /<li><strong>NoDate<\/strong><br>Signed without timestamp<\/li>/);

  const emptyRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() { return { entries: [] }; },
    }),
  });
  assert.equal(emptyRes.kind, 'api');
  assert.ok(emptyRes.html.includes('No signatures yet'));
  assert.ok(emptyRes.html.includes('No letters yet'));

  const nonArrayRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() { return { entries: 'x' }; },
    }),
  });
  assert.deepEqual(nonArrayRes, { kind: 'static', url: 'guestbook/index.html' });
});

test('resolvePlotGuestbookOverlayContent handles non-array entries, thrown fetch, invalid handles, and trailing slashes', async () => {
  const nonArrayRes = await resolvePlotGuestbookOverlayContent('maren', {
    fetchFn: async () => ({
      status: 200,
      async json() { return { entries: 'invalid' }; },
    }),
  });
  assert.equal(nonArrayRes.kind, 'fallback');
  assert.ok(nonArrayRes.html.includes('maren'));
  assert.ok(nonArrayRes.html.includes('How to sign'));

  const throwRes = await resolvePlotGuestbookOverlayContent('maren', {
    fetchFn: async () => { throw new Error('network down'); },
  });
  assert.equal(throwRes.kind, 'fallback');
  assert.ok(throwRes.html.includes('maren'));

  for (const badHandle of ['Milo', 'milo.test', 'a<b']) {
    let called = false;
    const badRes = await resolvePlotGuestbookOverlayContent(badHandle, {
      fetchFn: async () => {
        called = true;
        return { status: 200, async json() { return { entries: [] }; } };
      },
    });
    assert.equal(called, false, `invalid handle ${badHandle} must not trigger fetch`);
    assert.equal(badRes.kind, 'fallback');
  }

  const fetchedUrls = [];
  const slashRes = await resolvePlotGuestbookOverlayContent('maren', {
    apiBase: 'https://example.test///',
    fetchFn: async (url) => {
      fetchedUrls.push(url);
      return {
        status: 200,
        async json() { return { entries: [] }; },
      };
    },
  });
  assert.equal(slashRes.kind, 'api');
  assert.deepEqual(fetchedUrls, ['https://example.test/api/town/guestbook?plot=maren&limit=50']);
});

test('formatPlotGuestbookTabLabel handles negative, non-finite, non-number, and singular inputs', () => {
  assert.equal(formatPlotGuestbookTabLabel(-1), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(NaN), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(Infinity), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel('3'), 'Guestbook');
  assert.equal(formatPlotGuestbookTabLabel(1), 'Guestbook (1)');
});

test('openInnOverlay fetch path and openGuestbookOverlay api path set srcdoc and remove src', async () => {
  const innEls = makeFakeOverlayElements();
  innEls.iframeEl.src = 'stale.html';
  const innRes = await openInnOverlay({
    ...innEls,
    fetchFn: async () => ({
      status: 200,
      async json() {
        return { inn: { lantern: { handle: 'wick', nights: 4 }, window: null, quiet: null } };
      },
    }),
  });
  assert.equal(innRes.kind, 'api');
  assert.equal(innEls.overlayEl.hidden, false);
  assert.equal(innEls.iframeEl.getAttribute('src'), null);
  assert.match(innEls.iframeEl.srcdoc, /@wick, 4 nights left\./);

  const gbEls = makeFakeOverlayElements();
  gbEls.iframeEl.src = 'stale.html';
  const gbRes = await openGuestbookOverlay({
    ...gbEls,
    fetchFn: async () => ({
      status: 200,
      async json() {
        return { entries: [{ kind: 'guestbook', name: 'Rowan', body: 'Hello town' }] };
      },
    }),
  });
  assert.equal(gbRes.kind, 'api');
  assert.equal(gbEls.overlayEl.hidden, false);
  assert.equal(gbEls.iframeEl.getAttribute('src'), null);
  assert.ok(gbEls.iframeEl.srcdoc.includes('Rowan'));
});

test('openPlotGuestbookOverlay with invalid handle and openInnOverlay static fallback update iframe correctly', async () => {
  const plotEls = makeFakeOverlayElements();
  plotEls.iframeEl.src = 'stale.html';
  let plotFetchCalled = false;
  const plotRes = await openPlotGuestbookOverlay('BadHandle', {
    ...plotEls,
    fetchFn: async () => {
      plotFetchCalled = true;
      return { status: 200, async json() { return { entries: [] }; } };
    },
  });
  assert.equal(plotFetchCalled, false);
  assert.equal(plotRes.kind, 'fallback');
  assert.equal(plotEls.overlayEl.hidden, false);
  assert.equal(plotEls.titleEl.textContent, '@BadHandle — Guestbook');
  assert.equal(plotEls.iframeEl.getAttribute('src'), null);
  assert.ok(plotEls.iframeEl.srcdoc.includes("couldn't be reached"));

  const innEls = makeFakeOverlayElements();
  innEls.iframeEl.srcdoc = '<p>stale</p>';
  const innRes = await openInnOverlay({
    ...innEls,
    fetchFn: async () => ({ status: 404 }),
  });
  assert.equal(innRes.kind, 'static');
  assert.equal(innEls.overlayEl.hidden, false);
  assert.equal(innEls.iframeEl.src, 'inn/index.html');
  assert.equal(innEls.iframeEl.getAttribute('srcdoc'), null);
});

test('resolveInnOverlayContent handles innState shape fall-through and apiBase handling', async () => {
  const nowSec = 1_700_000_000;

  let recordedUrl = null;
  const strRes = await resolveInnOverlayContent({
    innState: 'x',
    apiBase: 'https://example.test///',
    nowSec,
    fetchFn: async (url) => {
      recordedUrl = url;
      return {
        status: 200,
        json: async () => ({
          inn: { lantern: { handle: 'wick', nights: 1 }, window: null, quiet: null },
        }),
      };
    },
  });
  assert.equal(strRes.kind, 'api');
  assert.match(strRes.html, /@wick, 1 night left\./);
  assert.equal(recordedUrl, 'https://example.test/api/town/state');

  const arrRes = await resolveInnOverlayContent({
    innState: [],
    nowSec,
    fetchFn: async () => ({ status: 200, json: async () => null }),
  });
  assert.deepEqual(arrRes, { kind: 'static', url: 'inn/index.html' });

  const emptyObjRes = await resolveInnOverlayContent({
    innState: {},
    nowSec,
    fetchFn: async () => ({ status: 200, json: async () => ({ inn: null }) }),
  });
  assert.deepEqual(emptyObjRes, { kind: 'static', url: 'inn/index.html' });

  let nonStringBaseUrl = null;
  const nonStringBaseRes = await resolveInnOverlayContent({
    apiBase: 42,
    nowSec,
    fetchFn: async (url) => {
      nonStringBaseUrl = url;
      return { status: 404 };
    },
  });
  assert.deepEqual(nonStringBaseRes, { kind: 'static', url: 'inn/index.html' });
  assert.equal(nonStringBaseUrl, '/api/town/state');
});

test('resolveInnOverlayContent handles occupancy-line edges, room order, and inn html structure', async () => {
  const nowSec = 1_700_000_000;
  const res = await resolveInnOverlayContent({
    nowSec,
    innState: {
      lantern: { handle: 'a"b<c', expires_at: nowSec },
      window: { handle: 'frac', expires_at: nowSec + 2.5 * 86400 },
      quiet: { handle: 'neg', nights: -2 },
    },
  });

  assert.equal(res.kind, 'api');
  assert.match(res.html, /Occupied — @a&quot;b&lt;c, 1 night left\./);
  assert.match(res.html, /Occupied — @frac, 3 nights left\./);
  assert.match(res.html, /Occupied — @neg, 1 night left\./);

  const lanternIdx = res.html.indexOf('The Lantern Room');
  const windowIdx = res.html.indexOf('The Window Room');
  const quietIdx = res.html.indexOf('The Quiet Room');
  assert.ok(lanternIdx !== -1 && windowIdx !== -1 && quietIdx !== -1);
  assert.ok(lanternIdx < windowIdx && windowIdx < quietIdx);

  assert.match(res.html, /front corner upstairs/);
  assert.match(res.html, /side gable overlooking the pines/);
  assert.match(res.html, /tucked at the back/);

  assert.ok(res.html.startsWith('<!doctype html>'));
  assert.ok(res.html.includes('<meta charset="utf-8">'));
  assert.ok(res.html.includes('<h1>Ghostlight Inn &mdash; The Guest Book</h1>'));
  assert.ok(res.html.includes('How to stay'));
  assert.ok(!res.html.includes('key_code'));
  assert.ok(!res.html.includes('<script'));
});

test('resolveGuestbookOverlayContent handles json edges, apiBase, and date edges', async () => {
  const nullJsonRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 200, json: async () => null }),
  });
  assert.deepEqual(nullJsonRes, { kind: 'static', url: 'guestbook/index.html' });

  const missingEntriesRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 200, json: async () => ({}) }),
  });
  assert.deepEqual(missingEntriesRes, { kind: 'static', url: 'guestbook/index.html' });

  const badJsonRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    }),
  });
  assert.deepEqual(badJsonRes, { kind: 'static', url: 'guestbook/index.html' });

  let recordedUrl = null;
  const slashRes = await resolveGuestbookOverlayContent({
    apiBase: 'https://example.test///',
    fetchFn: async (url) => {
      recordedUrl = url;
      return { status: 200, json: async () => ({ entries: [] }) };
    },
  });
  assert.equal(slashRes.kind, 'api');
  assert.equal(recordedUrl, 'https://example.test/api/town/guestbook?limit=50');

  const strDateRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      json: async () => ({
        entries: [{ kind: 'guestbook', name: 'NoDate', body: 'Signed', created_at: 'x' }],
      }),
    }),
  });
  assert.equal(strDateRes.kind, 'api');
  assert.ok(strDateRes.html.includes('NoDate'));
  assert.ok(strDateRes.html.includes('Signed'));
  assert.ok(!strDateRes.html.includes('<span class="meta">'));

  const epochRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      json: async () => ({
        entries: [{ kind: 'guestbook', name: 'Epoch', body: 'First', created_at: 0 }],
      }),
    }),
  });
  assert.ok(epochRes.html.includes('Dec 31, 1969'));
});

test('resolvePlotGuestbookOverlayContent enforces api 50-cap, section order, escaping, and fallback pins', async () => {
  const entries = [];
  for (let i = 0; i < 48; i++) {
    entries.push({ kind: 'guestbook', name: `Guest${i}`, body: `Note ${i}`, created_at: 1700000000 });
  }
  entries.push({ kind: 'letter', name: 'Maren', body: 'Door <letter>.', created_at: 1700000000 });
  entries.push({ kind: 'guestbook', name: 'Guest48', body: 'Last in', created_at: 1700000000 });
  entries.push({ kind: 'guestbook', name: 'Guest49', body: 'Beyond cap', created_at: 1700000000 });

  const apiRes = await resolvePlotGuestbookOverlayContent('wick', {
    fetchFn: async () => ({ status: 200, json: async () => ({ entries }) }),
  });
  assert.equal(apiRes.kind, 'api');
  assert.ok(apiRes.html.includes('Guest47'));
  assert.ok(apiRes.html.includes('Guest48'));
  assert.ok(!apiRes.html.includes('Guest49'));
  const sigIdx = apiRes.html.indexOf('<h2>Signatures</h2>');
  const letIdx = apiRes.html.indexOf('<h2>Letters</h2>');
  assert.ok(sigIdx !== -1 && letIdx !== -1 && sigIdx < letIdx);
  assert.ok(apiRes.html.includes('Door &lt;letter&gt;.'));
  assert.ok(apiRes.html.includes("<h1>@wick's Guestbook</h1>"));
  assert.ok(apiRes.html.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">'));

  const fbRes = await resolvePlotGuestbookOverlayContent('a<b', {});
  assert.equal(fbRes.kind, 'fallback');
  assert.ok(fbRes.html.includes('a&lt;b'));
  assert.ok(fbRes.html.includes("couldn't be reached"));
  assert.ok(fbRes.html.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">'));
});

test('open* overlays with partial elements return null and never call onBeforeOpen', async () => {
  const { overlayEl, titleEl } = makeFakeOverlayElements();
  let before = 0;

  assert.equal(
    await openInnOverlay({ overlayEl, titleEl, onBeforeOpen: () => { before++; } }),
    null,
  );
  assert.equal(before, 0);

  assert.equal(
    await openGuestbookOverlay({ overlayEl, onBeforeOpen: () => { before++; } }),
    null,
  );
  assert.equal(before, 0);

  assert.equal(
    await openPlotGuestbookOverlay('wick', { overlayEl, titleEl, onBeforeOpen: () => { before++; } }),
    null,
  );
  assert.equal(before, 0);
});

test('non-200 responses fall back across all three resolvers and tab-label handles floats', async () => {
  const innRes = await resolveInnOverlayContent({
    fetchFn: async () => ({
      status: 201,
      async json() {
        return { inn: { lantern: { handle: 'wick', nights: 1 } } };
      },
    }),
  });
  assert.deepEqual(innRes, { kind: 'static', url: 'inn/index.html' });

  const gbRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 201,
      async json() {
        return { entries: [] };
      },
    }),
  });
  assert.deepEqual(gbRes, { kind: 'static', url: 'guestbook/index.html' });

  const plotRes = await resolvePlotGuestbookOverlayContent('wick', {
    fetchFn: async () => ({
      status: 201,
      async json() {
        return { entries: [] };
      },
    }),
  });
  assert.equal(plotRes.kind, 'fallback');
  assert.ok(plotRes.html.includes('wick'));

  assert.equal(formatPlotGuestbookTabLabel(2.5), 'Guestbook (2.5)');
  assert.equal(formatPlotGuestbookTabLabel(0.5), 'Guestbook (0.5)');
  assert.equal(formatPlotGuestbookTabLabel(100), 'Guestbook (100)');
});

test('resolveInnOverlayContent handles fetch/json edges: thrown json, null response, unusable inn, and no-args call', async () => {
  const throwJsonRes = await resolveInnOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        throw new Error('broken json');
      },
    }),
  });
  assert.deepEqual(throwJsonRes, { kind: 'static', url: 'inn/index.html' });

  const nullRespRes = await resolveInnOverlayContent({
    fetchFn: async () => null,
  });
  assert.deepEqual(nullRespRes, { kind: 'static', url: 'inn/index.html' });

  const unknownRoomsRes = await resolveInnOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return { inn: { attic: { handle: 'g', nights: 2 } } };
      },
    }),
  });
  assert.deepEqual(unknownRoomsRes, { kind: 'static', url: 'inn/index.html' });

  const arrayInnRes = await resolveInnOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return { inn: [] };
      },
    }),
  });
  assert.deepEqual(arrayInnRes, { kind: 'static', url: 'inn/index.html' });

  const noArgsRes = await resolveInnOverlayContent();
  assert.deepEqual(noArgsRes, { kind: 'static', url: 'inn/index.html' });
});

test('resolveGuestbookOverlayContent handles no-args, null response, 50-cap swallowing, bare entries, and negative dates', async () => {
  const noArgsRes = await resolveGuestbookOverlayContent();
  assert.deepEqual(noArgsRes, { kind: 'static', url: 'guestbook/index.html' });

  const nullRespRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => null,
  });
  assert.deepEqual(nullRespRes, { kind: 'static', url: 'guestbook/index.html' });

  const entriesWith50Nulls = Array.from({ length: 50 }, () => null);
  entriesWith50Nulls.push({ kind: 'guestbook', name: 'Real51', body: 'Fifty-first', created_at: 1700000000 });
  const capRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return { entries: entriesWith50Nulls };
      },
    }),
  });
  assert.equal(capRes.kind, 'api');
  assert.ok(capRes.html.includes('No signatures yet'));
  assert.ok(!capRes.html.includes('Real51'));

  const bareRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return { entries: [{ kind: 'guestbook' }] };
      },
    }),
  });
  assert.equal(bareRes.kind, 'api');
  assert.ok(bareRes.html.includes('<li><strong></strong><br></li>'));

  const negDateRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      async json() {
        return { entries: [{ kind: 'guestbook', name: 'Neg', body: 'B', created_at: -86400 }] };
      },
    }),
  });
  assert.ok(negDateRes.html.includes('Dec 30, 1969'));
});

test('resolvePlotGuestbookOverlayContent handles handle length edges, thrown json, and non-string apiBase', async () => {
  let oneCharCalled = false;
  const oneCharRes = await resolvePlotGuestbookOverlayContent('a', {
    fetchFn: async () => {
      oneCharCalled = true;
      return { status: 200, async json() { return { entries: [] }; } };
    },
  });
  assert.equal(oneCharCalled, false);
  assert.equal(oneCharRes.kind, 'fallback');

  const handle32 = 'a' + 'b'.repeat(31);
  let url32 = null;
  const res32 = await resolvePlotGuestbookOverlayContent(handle32, {
    fetchFn: async (url) => {
      url32 = url;
      return { status: 200, async json() { return { entries: [] }; } };
    },
  });
  assert.equal(res32.kind, 'api');
  assert.equal(url32, `/api/town/guestbook?plot=${handle32}&limit=50`);

  const handle33 = 'a' + 'b'.repeat(32);
  let called33 = false;
  const res33 = await resolvePlotGuestbookOverlayContent(handle33, {
    fetchFn: async () => {
      called33 = true;
      return { status: 200, async json() { return { entries: [] }; } };
    },
  });
  assert.equal(called33, false);
  assert.equal(res33.kind, 'fallback');

  const throwJsonRes = await resolvePlotGuestbookOverlayContent('wick', {
    fetchFn: async () => ({
      status: 200,
      async json() {
        throw new Error('bad json');
      },
    }),
  });
  assert.equal(throwJsonRes.kind, 'fallback');

  let nonStringBaseUrl = null;
  const nonStringBaseRes = await resolvePlotGuestbookOverlayContent('wick', {
    apiBase: 42,
    fetchFn: async (url) => {
      nonStringBaseUrl = url;
      return { status: 200, async json() { return { entries: [] }; } };
    },
  });
  assert.equal(nonStringBaseRes.kind, 'api');
  assert.equal(nonStringBaseUrl, '/api/town/guestbook?plot=wick&limit=50');
});

test('resolveInnOverlayContent handles occupancy-line type edges: string expires_at/nights and non-finite nowSec', async () => {
  const nowSec = 1_700_000_000;
  const typeRes = await resolveInnOverlayContent({
    nowSec,
    innState: {
      lantern: { handle: "a&b'c", expires_at: 'soon', nights: 2 },
      window: { handle: 'x', nights: '4' },
      quiet: { handle: 'y', expires_at: nowSec + 3 * 86400, nights: 9 },
    },
  });
  assert.equal(typeRes.kind, 'api');
  assert.match(typeRes.html, /Occupied — @a&amp;b&#39;c, 2 nights left\./);
  assert.match(typeRes.html, /Occupied — @x, 1 night left\./);
  assert.match(typeRes.html, /Occupied — @y, 3 nights left\./);

  const nonFiniteNowRes = await resolveInnOverlayContent({
    nowSec: 'bad',
    innState: {
      lantern: { handle: 'z', expires_at: Math.floor(Date.now() / 1000) + 2 * 86400 },
      window: null,
      quiet: null,
    },
  });
  assert.equal(nonFiniteNowRes.kind, 'api');
  assert.match(nonFiniteNowRes.html, /Occupied — @z, 2 nights left\./);
});

test('open* overlays: onBeforeOpen runs even for invalid handles, and non-function onBeforeOpen never throws', async () => {
  const els1 = makeFakeOverlayElements();
  let before = 0;
  const plotRes = await openPlotGuestbookOverlay('BadHandle', {
    ...els1,
    fetchFn: async () => {
      throw new Error('must not be called');
    },
    onBeforeOpen: () => {
      before++;
    },
  });
  assert.equal(before, 1);
  assert.equal(plotRes.kind, 'fallback');

  const els2 = makeFakeOverlayElements();
  const innRes = await openInnOverlay({
    ...els2,
    innState: { lantern: { handle: 'wick', nights: 1 }, window: null, quiet: null },
    onBeforeOpen: 'not-a-function',
  });
  assert.equal(innRes.kind, 'api');
  assert.equal(els2.overlayEl.hidden, false);

  const els3 = makeFakeOverlayElements();
  const gbRes = await openGuestbookOverlay({
    ...els3,
    fetchFn: async () => ({ status: 200, json: async () => ({ entries: [] }) }),
    onBeforeOpen: 42,
  });
  assert.equal(gbRes.kind, 'api');
});

test('overlay HTML pins inn note, guestbook headings, and empty plot guestbook copy', async () => {
  const innRes = await resolveInnOverlayContent({
    innState: { lantern: null, window: null, quiet: null },
  });
  assert.equal(innRes.kind, 'api');
  assert.ok(innRes.html.includes('Short stays only'));
  assert.ok(innRes.html.includes('1&ndash;7 nights, default 3'));

  const gbRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 200, json: async () => ({ entries: [] }) }),
  });
  assert.equal(gbRes.kind, 'api');
  assert.ok(gbRes.html.includes('<h1>Town Gate Guestbook</h1>'));
  assert.ok(gbRes.html.includes('How to sign'));
  assert.ok(gbRes.html.includes('wooden ledger'));

  const plotRes = await resolvePlotGuestbookOverlayContent('wick', {
    fetchFn: async () => ({ status: 200, json: async () => ({ entries: [] }) }),
  });
  assert.equal(plotRes.kind, 'api');
  assert.ok(plotRes.html.includes('No signatures yet — be the first to sign at this cottage door.'));
  assert.ok(plotRes.html.includes('No letters yet.'));
  assert.ok(plotRes.html.includes('"plot": "wick"'));
});

test('resolveGuestbookOverlayContent renders dates in America/Los_Angeles, tolerates float created_at, and omits the date span for NaN created_at', async () => {
  const entries = [
    { kind: 'guestbook', name: 'UtcNov15', body: 'B', created_at: 1700011200 },
    { kind: 'guestbook', name: 'Float', body: 'B', created_at: 1700000000.5 },
    { kind: 'guestbook', name: 'NanDate', body: 'B', created_at: NaN },
  ];
  const res = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 200, json: async () => ({ entries }) }),
  });
  assert.equal(res.kind, 'api');
  assert.equal(res.html.split('Nov 14, 2023').length - 1, 2);
  assert.ok(!res.html.includes('Nov 15, 2023'));
  assert.ok(!res.html.includes('NanDate</strong> <span class="meta">'));
});

test('resolveGuestbookOverlayContent escapes & first, renders numeric names, and renders null bodies empty', async () => {
  const entries = [
    { kind: 'guestbook', name: '&lt;already&gt;', body: 'B', created_at: 1700000000 },
    { kind: 'guestbook', name: 42, body: null, created_at: 1700000000 },
  ];
  const res = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 200, json: async () => ({ entries }) }),
  });
  assert.equal(res.kind, 'api');
  assert.ok(res.html.includes('&amp;lt;already&amp;gt;'));
  assert.ok(res.html.includes('<strong>42</strong>'));
  assert.ok(res.html.includes('<li><strong>42</strong> <span class="meta">&middot; Nov 14, 2023</span><br></li>'));
});

test('resolveInnOverlayContent handles usable-inn-state edges: undefined/zero room values and a function innState', async () => {
  const nowSec = 1_700_000_000;

  const undefRes = await resolveInnOverlayContent({
    innState: { lantern: undefined },
    nowSec,
  });
  assert.equal(undefRes.kind, 'api');
  assert.match(undefRes.html, /The Lantern Room[\s\S]*?Vacant — free tonight\./);

  const zeroRes = await resolveInnOverlayContent({
    innState: { lantern: 0 },
    nowSec,
  });
  assert.equal(zeroRes.kind, 'api');
  assert.match(zeroRes.html, /The Lantern Room[\s\S]*?Vacant — free tonight\./);

  let fetchCalled = false;
  const fnRes = await resolveInnOverlayContent({
    innState: Object.assign(() => {}, { lantern: { handle: 'wick', nights: 1 } }),
    nowSec,
    fetchFn: async () => {
      fetchCalled = true;
      return { status: 404 };
    },
  });
  assert.equal(fetchCalled, true);
  assert.deepEqual(fnRes, { kind: 'static', url: 'inn/index.html' });
});

test('resolveInnOverlayContent handles occupancy-line finite and boundary edges', async () => {
  const nowSec = 1_700_000_000;

  const nonFiniteRes = await resolveInnOverlayContent({
    innState: {
      lantern: { handle: 'nanexp', expires_at: NaN, nights: 3 },
      window: { handle: 'infexp', expires_at: Infinity, nights: 2 },
      quiet: { handle: 'seven', nights: 7 },
    },
    nowSec,
  });
  assert.equal(nonFiniteRes.kind, 'api');
  assert.match(nonFiniteRes.html, /@nanexp, 3 nights left\./);
  assert.match(nonFiniteRes.html, /@infexp, 2 nights left\./);
  assert.match(nonFiniteRes.html, /@seven, 7 nights left\./);

  const boundaryRes = await resolveInnOverlayContent({
    innState: {
      lantern: { handle: 'one', expires_at: nowSec + 86400 },
      window: { handle: 'two', expires_at: nowSec + 86401 },
      quiet: null,
    },
    nowSec,
  });
  assert.equal(boundaryRes.kind, 'api');
  assert.match(boundaryRes.html, /@one, 1 night left\./);
  assert.match(boundaryRes.html, /@two, 2 nights left\./);
});

test('resolveGuestbookOverlayContent renders one-sided empty blocks for letters-only and signatures-only lists', async () => {
  const lettersOnlyRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      json: async () => ({
        entries: [{ kind: 'letter', name: 'Maren', body: 'L', created_at: 1700000000 }],
      }),
    }),
  });
  assert.equal(lettersOnlyRes.kind, 'api');
  assert.ok(lettersOnlyRes.html.includes('No signatures yet — be the first to sign.'));
  assert.ok(lettersOnlyRes.html.includes('<strong>Maren</strong>'));

  const sigsOnlyRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({
      status: 200,
      json: async () => ({
        entries: [{ kind: 'guestbook', name: 'Wick', body: 'S', created_at: 1700000000 }],
      }),
    }),
  });
  assert.equal(sigsOnlyRes.kind, 'api');
  assert.ok(sigsOnlyRes.html.includes('<p class="meta">No letters yet.</p>'));
  assert.ok(sigsOnlyRes.html.includes('<strong>Wick</strong>'));
});

test('resolveGuestbookOverlayContent handles non-string and undefined apiBase', async () => {
  let numUrl = null;
  const numRes = await resolveGuestbookOverlayContent({
    apiBase: 42,
    fetchFn: async (url) => {
      numUrl = url;
      return { status: 200, json: async () => ({ entries: [] }) };
    },
  });
  assert.equal(numRes.kind, 'api');
  assert.equal(numUrl, '/api/town/guestbook?limit=50');

  let undefUrl = null;
  const undefRes = await resolveGuestbookOverlayContent({
    apiBase: undefined,
    fetchFn: async (url) => {
      undefUrl = url;
      return { status: 200, json: async () => ({ entries: [] }) };
    },
  });
  assert.equal(undefRes.kind, 'api');
  assert.equal(undefUrl, '/api/town/guestbook?limit=50');
});

test('resolveInnOverlayContent handles fetch json edges: array json and mixed known/unknown rooms', async () => {
  const arrRes = await resolveInnOverlayContent({
    fetchFn: async () => ({ status: 200, json: async () => [] }),
  });
  assert.deepEqual(arrRes, { kind: 'static', url: 'inn/index.html' });

  const mixedRes = await resolveInnOverlayContent({
    fetchFn: async () => ({
      status: 200,
      json: async () => ({
        inn: { attic: { handle: 'g', nights: 2 }, lantern: { handle: 'wick', nights: 1 } },
      }),
    }),
  });
  assert.equal(mixedRes.kind, 'api');
  assert.match(mixedRes.html, /@wick, 1 night left\./);
  assert.ok(!mixedRes.html.includes('attic'));
  assert.ok(!mixedRes.html.includes('The Attic'));
});

test('resolvePlotGuestbookOverlayContent handles non-string handles without fetching', async () => {
  for (const h of [42, null, undefined]) {
    let called = false;
    const res = await resolvePlotGuestbookOverlayContent(h, {
      fetchFn: async () => {
        called = true;
        return { status: 200, json: async () => ({ entries: [] }) };
      },
    });
    assert.equal(called, false);
    assert.equal(res.kind, 'fallback');
  }

  const numTitleRes = await resolvePlotGuestbookOverlayContent(42, {});
  assert.ok(numTitleRes.html.includes("<title>@42's Guestbook</title>"));

  const nullTitleRes = await resolvePlotGuestbookOverlayContent(null, {});
  assert.ok(nullTitleRes.html.includes("<title>@'s Guestbook</title>"));
});

test('resolvePlotGuestbookOverlayContent accepts HANDLE_RE valid edges: two-char, leading digit, underscore and hyphen', async () => {
  for (const h of ['ab', '1abc', 'a_b-c']) {
    let recordedUrl = null;
    const res = await resolvePlotGuestbookOverlayContent(h, {
      fetchFn: async (url) => {
        recordedUrl = url;
        return { status: 200, json: async () => ({ entries: [] }) };
      },
    });
    assert.equal(res.kind, 'api');
    assert.equal(recordedUrl, `/api/town/guestbook?plot=${h}&limit=50`);
  }
});

test('overlay HTML pins guestbook title and POST line, inn vacant occupancy spans, and plot title', async () => {
  const gbRes = await resolveGuestbookOverlayContent({
    fetchFn: async () => ({ status: 200, json: async () => ({ entries: [] }) }),
  });
  assert.equal(gbRes.kind, 'api');
  assert.ok(gbRes.html.includes('<title>Town Gate Guestbook</title>'));
  assert.ok(gbRes.html.includes('<code>/api/town/guestbook</code>'));
  assert.ok(gbRes.html.includes('Entries are approved by Milo before they appear.'));

  const innRes = await resolveInnOverlayContent({
    innState: { lantern: null, window: null, quiet: null },
  });
  assert.equal(innRes.kind, 'api');
  assert.equal(innRes.html.split('<span class="occupancy">Vacant — free tonight.</span>').length - 1, 3);

  const plotRes = await resolvePlotGuestbookOverlayContent('wick', {
    fetchFn: async () => ({ status: 200, json: async () => ({ entries: [] }) }),
  });
  assert.equal(plotRes.kind, 'api');
  assert.ok(plotRes.html.includes("<title>@wick's Guestbook</title>"));
});
