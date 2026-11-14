import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveInnOverlayContent,
  resolveGuestbookOverlayContent,
  openInnOverlay,
  openGuestbookOverlay,
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
});

test('inn-guestbook-overlay.mjs pure resolvers and helpers stay verbatim in sync with town-3d/town.js', async () => {
  const [townSrc, stagingSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'inn-guestbook-overlay.mjs'), 'utf8'),
  ]);

  const townBlock = townSrc.match(/const INN_ROOM_DETAILS = \[[\s\S]*?return \{ kind: 'static', url: 'guestbook\/index\.html' \};\n\}/);
  const stagingBlock = stagingSrc.match(/const INN_ROOM_DETAILS = \[[\s\S]*?return \{ kind: 'static', url: 'guestbook\/index\.html' \};\n\}/);
  assert.ok(townBlock, 'town-3d/town.js must contain INN_ROOM_DETAILS through resolveGuestbookOverlayContent');
  assert.ok(stagingBlock, 'staging-polyfork/inn-guestbook-overlay.mjs must contain INN_ROOM_DETAILS through resolveGuestbookOverlayContent');
  assert.equal(stagingBlock[0], townBlock[0], 'inn-guestbook-overlay.mjs drifted from town-3d/town.js');
});
