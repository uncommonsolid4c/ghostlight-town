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

test('resolvePlotOverlayContent validates handle length, case, and non-string edges', async () => {
  const fetchedHandles = [];
  const makeSpyFetch = () => async (url) => {
    fetchedHandles.push(url);
    return { status: 200, async json() { return { html: '<p>ok</p>' }; } };
  };

  // Minimum valid length (2 chars) and maximum valid length (32 chars)
  const twoChar = await resolvePlotOverlayContent('ab', { fetchFn: makeSpyFetch() });
  assert.deepEqual(twoChar, { kind: 'api', html: '<p>ok</p>' });

  const handle32 = 'a'.repeat(32);
  const thirtyTwoChar = await resolvePlotOverlayContent(handle32, { fetchFn: makeSpyFetch() });
  assert.deepEqual(thirtyTwoChar, { kind: 'api', html: '<p>ok</p>' });
  assert.deepEqual(fetchedHandles, [
    '/api/town/plot?handle=ab',
    `/api/town/plot?handle=${handle32}`,
  ]);

  // Invalid handles must not call fetchFn
  let invalidFetchCalls = 0;
  const noCallFetch = async () => {
    invalidFetchCalls++;
    return { status: 200, async json() { return { html: '<p>nope</p>' }; } };
  };

  const oneChar = await resolvePlotOverlayContent('a', { fetchFn: noCallFetch });
  assert.deepEqual(oneChar, { kind: 'static', url: 'plots/a/index.html' });

  const handle33 = 'a'.repeat(33);
  const thirtyThreeChar = await resolvePlotOverlayContent(handle33, { fetchFn: noCallFetch });
  assert.deepEqual(thirtyThreeChar, { kind: 'static', url: `plots/${handle33}/index.html` });

  const upperRes = await resolvePlotOverlayContent('Wick', { fetchFn: noCallFetch });
  assert.deepEqual(upperRes, { kind: 'static', url: 'plots/Wick/index.html' });

  const numRes = await resolvePlotOverlayContent(42, { fetchFn: noCallFetch });
  assert.deepEqual(numRes, { kind: 'static', url: 'plots/42/index.html' });

  const nullRes = await resolvePlotOverlayContent(null, { fetchFn: noCallFetch });
  assert.deepEqual(nullRes, { kind: 'static', url: 'plots//index.html' });

  assert.equal(invalidFetchCalls, 0, 'invalid handles must not trigger fetchFn');
});

test('resolvePlotOverlayContent handles apiBase trailing slashes and malformed responses', async () => {
  const slashRes = await resolvePlotOverlayContent('wick', {
    apiBase: 'https://example.test///',
    fetchFn: async (url) => {
      assert.equal(url, 'https://example.test/api/town/plot?handle=wick');
      return { status: 200, async json() { return { html: '<p>slash</p>' }; } };
    },
  });
  assert.deepEqual(slashRes, { kind: 'api', html: '<p>slash</p>' });

  const status500 = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ status: 500, async json() { return { html: '<p>err</p>' }; } }),
  });
  assert.deepEqual(status500, { kind: 'static', url: 'plots/wick/index.html' });

  const nullResponse = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => null,
  });
  assert.deepEqual(nullResponse, { kind: 'static', url: 'plots/wick/index.html' });

  const jsonThrows = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ status: 200, async json() { throw new Error('bad json'); } }),
  });
  assert.deepEqual(jsonThrows, { kind: 'static', url: 'plots/wick/index.html' });

  const dataNull = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ status: 200, async json() { return null; } }),
  });
  assert.deepEqual(dataNull, { kind: 'static', url: 'plots/wick/index.html' });

  const missingStatus = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ ok: true, async json() { return { html: '<p>no status</p>' }; } }),
  });
  assert.deepEqual(missingStatus, { kind: 'static', url: 'plots/wick/index.html' });
});

test('resolveGazetteOverlayContent handles fallback issue selection and response edges', async () => {
  const fallbackFirst = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() {
        return {
          latest: 99,
          issues: [
            { n: 3, file: 'issue-003.html' },
            { n: 4, file: 'issue-004.html' },
          ],
        };
      },
    }),
  });
  assert.deepEqual(fallbackFirst, {
    issueNum: 3,
    issueFile: 'issue-003.html',
    url: 'gazette/issue-003.html',
    title: 'The Ghostlight Gazette — Issue #3',
  });

  const emptyIssues = await resolveGazetteOverlayContent({
    fetchFn: async () => ({ ok: true, async json() { return { latest: 1, issues: [] }; } }),
  });
  assert.equal(emptyIssues.issueFile, 'issue-001.html');
  assert.equal(emptyIssues.issueNum, 1);

  const notOk = await resolveGazetteOverlayContent({
    fetchFn: async () => ({ ok: false, async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; } }),
  });
  assert.equal(notOk.issueFile, 'issue-001.html');

  const jsonThrows = await resolveGazetteOverlayContent({
    fetchFn: async () => ({ ok: true, async json() { throw new Error('parse'); } }),
  });
  assert.equal(jsonThrows.issueFile, 'issue-001.html');

  const dataNull = await resolveGazetteOverlayContent({
    fetchFn: async () => ({ ok: true, async json() { return null; } }),
  });
  assert.equal(dataNull.issueFile, 'issue-001.html');

  const upperFile = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'Issue-002.HTML' }] }; },
    }),
  });
  assert.deepEqual(upperFile, {
    issueNum: 2,
    issueFile: 'Issue-002.HTML',
    url: 'gazette/Issue-002.HTML',
    title: 'The Ghostlight Gazette — Issue #2',
  });

  const missingN = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() { return { issues: [{ file: 'issue-005.html' }] }; },
    }),
  });
  assert.deepEqual(missingN, {
    issueNum: 1,
    issueFile: 'issue-005.html',
    url: 'gazette/issue-005.html',
    title: 'The Ghostlight Gazette — Issue #1',
  });
});

test('openPlotOverlay opens static fallback path when API returns 404', async () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  iframeEl.srcdoc = '<p>stale</p>';

  const result = await openPlotOverlay('wick', {
    overlayEl,
    titleEl,
    iframeEl,
    fetchFn: async () => ({ status: 404 }),
  });

  assert.deepEqual(result, { kind: 'static', url: 'plots/wick/index.html' });
  assert.equal(titleEl.textContent, '@wick — Desk Note');
  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.equal(iframeEl.src, 'plots/wick/index.html');
  assert.equal(iframeEl.getAttribute('srcdoc'), null);
  assert.equal(overlayEl.hidden, false);
});

test('openPlotOverlay and openGazetteOverlay guard missing elements and tolerate non-function onBeforeOpen', async () => {
  for (const missingKey of ['overlayEl', 'titleEl', 'iframeEl']) {
    const plotEls = makeFakeOverlayElements();
    plotEls[missingKey] = null;
    assert.equal(await openPlotOverlay('wick', plotEls), null);

    const gazetteEls = makeFakeOverlayElements();
    gazetteEls[missingKey] = null;
    assert.equal(await openGazetteOverlay(gazetteEls), null);
  }

  const plotEls = makeFakeOverlayElements();
  const plotRes = await openPlotOverlay('wick', { ...plotEls, onBeforeOpen: 'x' });
  assert.deepEqual(plotRes, { kind: 'static', url: 'plots/wick/index.html' });
  assert.equal(plotEls.overlayEl.hidden, false);

  const gazetteEls = makeFakeOverlayElements();
  const gazetteRes = await openGazetteOverlay({ ...gazetteEls, onBeforeOpen: 'x' });
  assert.equal(gazetteRes.issueFile, 'issue-001.html');
  assert.equal(gazetteEls.overlayEl.hidden, false);

  const omittedEls = makeFakeOverlayElements();
  const omittedRes = await openPlotOverlay('wick', omittedEls);
  assert.deepEqual(omittedRes, { kind: 'static', url: 'plots/wick/index.html' });
  assert.equal(omittedEls.overlayEl.hidden, false);
});

test('closePlotOverlay guards missing elements and tolerates non-function or omitted onAfterClose', () => {
  let afterCalled = 0;
  const { iframeEl } = makeFakeOverlayElements();
  assert.equal(
    closePlotOverlay({ overlayEl: null, iframeEl, onAfterClose: () => { afterCalled++; } }),
    undefined,
  );
  assert.equal(afterCalled, 0);

  const { overlayEl } = makeFakeOverlayElements();
  overlayEl.hidden = false;
  assert.equal(
    closePlotOverlay({ overlayEl, iframeEl: null, onAfterClose: () => { afterCalled++; } }),
    undefined,
  );
  assert.equal(afterCalled, 0);
  assert.equal(overlayEl.hidden, false);

  const nonFnEls = makeFakeOverlayElements();
  nonFnEls.overlayEl.hidden = false;
  nonFnEls.iframeEl.srcdoc = '<p>hi</p>';
  closePlotOverlay({
    overlayEl: nonFnEls.overlayEl,
    iframeEl: nonFnEls.iframeEl,
    onAfterClose: 'x',
  });
  assert.equal(nonFnEls.overlayEl.hidden, true);
  assert.equal(nonFnEls.iframeEl.src, 'about:blank');
  assert.equal(nonFnEls.iframeEl.getAttribute('srcdoc'), null);

  const omittedEls = makeFakeOverlayElements();
  omittedEls.overlayEl.hidden = false;
  omittedEls.iframeEl.srcdoc = '<p>hi</p>';
  closePlotOverlay({
    overlayEl: omittedEls.overlayEl,
    iframeEl: omittedEls.iframeEl,
  });
  assert.equal(omittedEls.overlayEl.hidden, true);
  assert.equal(omittedEls.iframeEl.src, 'about:blank');
  assert.equal(omittedEls.iframeEl.getAttribute('srcdoc'), null);
});

test('resolvePlotOverlayContent returns API html verbatim and accepts dash/underscore handles; non-200 status falls back', async () => {
  const fetchedUrls = [];

  const verbatimRes = await resolvePlotOverlayContent('wick', {
    fetchFn: async (url) => {
      fetchedUrls.push(url);
      return { status: 200, async json() { return { html: '  <p>hi</p>\n' }; } };
    },
  });
  assert.deepEqual(verbatimRes, { kind: 'api', html: '  <p>hi</p>\n' });

  const dashRes = await resolvePlotOverlayContent('wick-2', {
    fetchFn: async (url) => {
      fetchedUrls.push(url);
      return { status: 200, async json() { return { html: '<p>ok</p>' }; } };
    },
  });
  assert.deepEqual(dashRes, { kind: 'api', html: '<p>ok</p>' });

  const underscoreRes = await resolvePlotOverlayContent('a_b', {
    fetchFn: async (url) => {
      fetchedUrls.push(url);
      return { status: 200, async json() { return { html: '<p>ok</p>' }; } };
    },
  });
  assert.deepEqual(underscoreRes, { kind: 'api', html: '<p>ok</p>' });

  assert.deepEqual(fetchedUrls, [
    '/api/town/plot?handle=wick',
    '/api/town/plot?handle=wick-2',
    '/api/town/plot?handle=a_b',
  ]);

  const status201Res = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ status: 201, async json() { return { html: '<p>created</p>' }; } }),
  });
  assert.deepEqual(status201Res, { kind: 'static', url: 'plots/wick/index.html' });
});

test('resolvePlotOverlayContent treats a non-string apiBase as empty and an undefined response as static', async () => {
  let fetchedUrl = null;
  const nonStringBaseRes = await resolvePlotOverlayContent('wick', {
    apiBase: 42,
    fetchFn: async (url) => {
      fetchedUrl = url;
      return { status: 200, async json() { return { html: '<p>ok</p>' }; } };
    },
  });
  assert.equal(fetchedUrl, '/api/town/plot?handle=wick');
  assert.deepEqual(nonStringBaseRes, { kind: 'api', html: '<p>ok</p>' });

  const undefRes = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => undefined,
  });
  assert.deepEqual(undefRes, { kind: 'static', url: 'plots/wick/index.html' });
});

test('resolveGazetteOverlayContent ignores a string latest and a non-string file, and tolerates a null response', async () => {
  const stringLatestRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() {
        return {
          latest: '2',
          issues: [
            { n: 1, file: 'issue-001.html' },
            { n: 2, file: 'issue-002.html' },
          ],
        };
      },
    }),
  });
  assert.deepEqual(stringLatestRes, {
    issueNum: 1,
    issueFile: 'issue-001.html',
    url: 'gazette/issue-001.html',
    title: 'The Ghostlight Gazette — Issue #1',
  });

  const nonStringFileRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() {
        return {
          latest: 2,
          issues: [{ n: 2, file: 42 }],
        };
      },
    }),
  });
  assert.equal(nonStringFileRes.issueFile, 'issue-001.html');
  assert.equal(nonStringFileRes.issueNum, 1);

  const nullRes = await resolveGazetteOverlayContent({
    fetchFn: async () => null,
  });
  assert.equal(nullRes.issueFile, 'issue-001.html');
  assert.equal(nullRes.issueNum, 1);
});

test('resolveGazetteOverlayContent maps issue n 0 to title Issue #1 while keeping its file', async () => {
  const zeroRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() {
        return {
          latest: 0,
          issues: [{ n: 0, file: 'issue-000.html' }],
        };
      },
    }),
  });
  assert.deepEqual(zeroRes, {
    issueNum: 1,
    issueFile: 'issue-000.html',
    url: 'gazette/issue-000.html',
    title: 'The Ghostlight Gazette — Issue #1',
  });
});

test('openPlotOverlay and openGazetteOverlay let a throwing onBeforeOpen propagate before any DOM change', async () => {
  const plotEls = makeFakeOverlayElements();
  await assert.rejects(
    () => openPlotOverlay('wick', {
      ...plotEls,
      onBeforeOpen: () => { throw new Error('boom'); },
    }),
    /boom/,
  );
  assert.equal(plotEls.overlayEl.hidden, true);
  assert.equal(plotEls.titleEl.textContent, '');

  const gazetteEls = makeFakeOverlayElements();
  await assert.rejects(
    () => openGazetteOverlay({
      ...gazetteEls,
      onBeforeOpen: () => { throw new Error('boom'); },
    }),
    /boom/,
  );
  assert.equal(gazetteEls.overlayEl.hidden, true);
  assert.equal(gazetteEls.titleEl.textContent, '');
});

test('closePlotOverlay propagates a throwing onAfterClose after hiding the overlay', () => {
  const { overlayEl, iframeEl } = makeFakeOverlayElements();
  overlayEl.hidden = false;
  iframeEl.srcdoc = '<p>hi</p>';

  assert.throws(
    () => closePlotOverlay({
      overlayEl,
      iframeEl,
      onAfterClose: () => { throw new Error('after-boom'); },
    }),
    /after-boom/,
  );

  assert.equal(overlayEl.hidden, true);
  assert.equal(iframeEl.src, 'about:blank');
  assert.equal(iframeEl.getAttribute('srcdoc'), null);
});
