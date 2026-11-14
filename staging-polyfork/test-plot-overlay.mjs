import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolvePlotOverlayContent,
  resolveGazetteOverlayContent,
  openPlotOverlay,
  openGazetteOverlay,
  closePlotOverlay,
} from './plot-overlay.mjs';

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

test('resolvePlotOverlayContent prefers API html and falls back to static path', async () => {
  const apiRes = await resolvePlotOverlayContent('alice', {
    apiBase: 'https://example.test/',
    fetchFn: async (url) => {
      assert.equal(url, 'https://example.test/api/town/plot?handle=alice');
      return { status: 200, async json() { return { html: '<p>Hello from API</p>' }; } };
    },
  });
  assert.deepEqual(apiRes, { kind: 'api', html: '<p>Hello from API</p>' });

  const notFoundRes = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ status: 404 }),
  });
  assert.deepEqual(notFoundRes, { kind: 'static', url: 'plots/wick/index.html' });

  const throwRes = await resolvePlotOverlayContent('maren', {
    fetchFn: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(throwRes, { kind: 'static', url: 'plots/maren/index.html' });

  let called = false;
  const badHandleRes = await resolvePlotOverlayContent('../etc/passwd', {
    fetchFn: async () => { called = true; return { status: 200 }; },
  });
  assert.equal(called, false, 'invalid handle must not trigger fetch');
  assert.deepEqual(badHandleRes, { kind: 'static', url: 'plots/..%2Fetc%2Fpasswd/index.html' });

  const emptyRes = await resolvePlotOverlayContent('tomas', {
    fetchFn: async () => ({ status: 200, async json() { return { html: '   ' }; } }),
  });
  assert.deepEqual(emptyRes, { kind: 'static', url: 'plots/tomas/index.html' });

  const nonStringRes = await resolvePlotOverlayContent('tomas', {
    fetchFn: async () => ({ status: 200, async json() { return { html: 123 }; } }),
  });
  assert.deepEqual(nonStringRes, { kind: 'static', url: 'plots/tomas/index.html' });

  const noFetchRes = await resolvePlotOverlayContent('milo', { fetchFn: null });
  assert.deepEqual(noFetchRes, { kind: 'static', url: 'plots/milo/index.html' });
});

test('resolveGazetteOverlayContent resolves gazette/latest.json and falls back safely', async () => {
  const okRes = await resolveGazetteOverlayContent({
    fetchFn: async (url) => {
      assert.equal(url, 'gazette/latest.json');
      return {
        ok: true,
        async json() {
          return {
            latest: 2,
            issues: [
              { n: 1, file: 'issue-001.html' },
              { n: 2, file: 'issue-002.html' },
            ],
          };
        },
      };
    },
  });
  assert.deepEqual(okRes, {
    issueNum: 2,
    issueFile: 'issue-002.html',
    url: 'gazette/issue-002.html',
    title: 'The Ghostlight Gazette — Issue #2',
  });

  const unsafeRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { latest: 9, issues: [{ n: 9, file: '../secret.html' }] };
      },
    }),
  });
  assert.equal(unsafeRes.issueFile, 'issue-001.html');
  assert.equal(unsafeRes.url, 'gazette/issue-001.html');

  const offlineRes = await resolveGazetteOverlayContent({
    fetchFn: async () => { throw new Error('network error'); },
  });
  assert.equal(offlineRes.issueNum, 1);
  assert.equal(offlineRes.url, 'gazette/issue-001.html');

  const noFetchRes = await resolveGazetteOverlayContent({ fetchFn: null });
  assert.equal(noFetchRes.issueNum, 1);
  assert.equal(noFetchRes.url, 'gazette/issue-001.html');
});

test('openPlotOverlay, openGazetteOverlay, and closePlotOverlay manage sandboxed iframe and hidden state', async () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  let beforeCount = 0;
  let afterCount = 0;

  await openPlotOverlay('wick', {
    overlayEl,
    titleEl,
    iframeEl,
    fetchFn: async () => ({ status: 200, async json() { return { html: '<h1>Wick</h1>' }; } }),
    onBeforeOpen: () => { beforeCount++; },
  });
  assert.equal(beforeCount, 1);
  assert.equal(overlayEl.hidden, false);
  assert.equal(titleEl.textContent, '@wick — Desk Note');
  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.equal(iframeEl.srcdoc, '<h1>Wick</h1>');
  assert.equal(iframeEl.getAttribute('src'), null);

  await openGazetteOverlay({
    overlayEl,
    titleEl,
    iframeEl,
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; },
    }),
    onBeforeOpen: () => { beforeCount++; },
  });
  assert.equal(beforeCount, 2);
  assert.equal(overlayEl.hidden, false);
  assert.equal(titleEl.textContent, 'The Ghostlight Gazette — Issue #2');
  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.equal(iframeEl.src, 'gazette/issue-002.html');
  assert.equal(iframeEl.getAttribute('srcdoc'), null);

  closePlotOverlay({
    overlayEl,
    iframeEl,
    onAfterClose: () => { afterCount++; },
  });
  assert.equal(afterCount, 1);
  assert.equal(overlayEl.hidden, true);
  assert.equal(iframeEl.src, 'about:blank');
  assert.equal(iframeEl.getAttribute('srcdoc'), null);
});

test('resolvePlotOverlayContent in plot-overlay.mjs stays in sync with town-3d/town.js', async () => {
  const [townSrc, stagingSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'plot-overlay.mjs'), 'utf8'),
  ]);
  const townMatch = townSrc.match(/export async function resolvePlotOverlayContent[\s\S]*?\n\}/);
  const stagingMatch = stagingSrc.match(/export async function resolvePlotOverlayContent[\s\S]*?\n\}/);
  assert.ok(townMatch, 'town-3d/town.js must export resolvePlotOverlayContent');
  assert.ok(stagingMatch, 'staging-polyfork/plot-overlay.mjs must export resolvePlotOverlayContent');
  assert.equal(stagingMatch[0], townMatch[0], 'resolvePlotOverlayContent drifted from town-3d/town.js');
});
