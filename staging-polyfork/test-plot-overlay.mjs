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

test('openGazetteOverlay falls back to issue-001 when fetch throws or returns not-ok, and returns the resolved object', async () => {
  const throwEls = makeFakeOverlayElements();
  const throwRes = await openGazetteOverlay({
    ...throwEls,
    fetchFn: async () => { throw new Error('network down'); },
  });
  assert.deepEqual(throwRes, {
    issueNum: 1,
    issueFile: 'issue-001.html',
    url: 'gazette/issue-001.html',
    title: 'The Ghostlight Gazette — Issue #1',
  });
  assert.equal(throwEls.titleEl.textContent, 'The Ghostlight Gazette — Issue #1');
  assert.equal(throwEls.iframeEl.src, 'gazette/issue-001.html');
  assert.equal(throwEls.iframeEl.getAttribute('srcdoc'), null);
  assert.equal(throwEls.overlayEl.hidden, false);

  const notOkEls = makeFakeOverlayElements();
  const notOkRes = await openGazetteOverlay({
    ...notOkEls,
    fetchFn: async () => ({
      ok: false,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; },
    }),
  });
  assert.deepEqual(notOkRes, {
    issueNum: 1,
    issueFile: 'issue-001.html',
    url: 'gazette/issue-001.html',
    title: 'The Ghostlight Gazette — Issue #1',
  });
  assert.equal(notOkEls.iframeEl.src, 'gazette/issue-001.html');

  const okEls = makeFakeOverlayElements();
  const okRes = await openGazetteOverlay({
    ...okEls,
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; },
    }),
  });
  assert.deepEqual(okRes, {
    issueNum: 2,
    issueFile: 'issue-002.html',
    url: 'gazette/issue-002.html',
    title: 'The Ghostlight Gazette — Issue #2',
  });
  assert.equal(okEls.titleEl.textContent, 'The Ghostlight Gazette — Issue #2');
});

test('openPlotOverlay returns the API resolution and passes apiBase through; an invalid handle falls back to static without fetching', async () => {
  const apiEls = makeFakeOverlayElements();
  const apiRes = await openPlotOverlay('wick', {
    ...apiEls,
    apiBase: 'https://example.test',
    fetchFn: async (url) => {
      assert.equal(url, 'https://example.test/api/town/plot?handle=wick');
      return { status: 200, async json() { return { html: '<h1>Wick</h1>' }; } };
    },
  });
  assert.deepEqual(apiRes, { kind: 'api', html: '<h1>Wick</h1>' });
  assert.equal(apiEls.titleEl.textContent, '@wick — Desk Note');
  assert.equal(apiEls.iframeEl.srcdoc, '<h1>Wick</h1>');
  assert.equal(apiEls.iframeEl.getAttribute('src'), null);

  const staticEls = makeFakeOverlayElements();
  const fetchCalls = [];
  const staticRes = await openPlotOverlay('Wick', {
    ...staticEls,
    fetchFn: async (url) => {
      fetchCalls.push(url);
      return { status: 200, async json() { return { html: '<h1>Nope</h1>' }; } };
    },
  });
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(staticRes, { kind: 'static', url: 'plots/Wick/index.html' });
  assert.equal(staticEls.titleEl.textContent, '@Wick — Desk Note');
  assert.equal(staticEls.iframeEl.src, 'plots/Wick/index.html');
  assert.equal(staticEls.iframeEl.getAttribute('srcdoc'), null);
});

test('resolvePlotOverlayContent asserts exact fetch URLs for empty and slash-less apiBase, and rejects leading-underscore / dotted handles without fetching', async () => {
  let emptyBaseUrl = null;
  await resolvePlotOverlayContent('wick', {
    fetchFn: async (url) => {
      emptyBaseUrl = url;
      return { status: 200, async json() { return { html: '<p>ok</p>' }; } };
    },
  });
  assert.equal(emptyBaseUrl, '/api/town/plot?handle=wick');

  let slashlessBaseUrl = null;
  await resolvePlotOverlayContent('wick', {
    apiBase: 'https://example.test',
    fetchFn: async (url) => {
      slashlessBaseUrl = url;
      return { status: 200, async json() { return { html: '<p>ok</p>' }; } };
    },
  });
  assert.equal(slashlessBaseUrl, 'https://example.test/api/town/plot?handle=wick');

  let invalidCalls = 0;
  const countingFetch = async () => {
    invalidCalls++;
    return { status: 200, async json() { return { html: '<p>nope</p>' }; } };
  };
  const underscoreRes = await resolvePlotOverlayContent('_ab', { fetchFn: countingFetch });
  const dottedRes = await resolvePlotOverlayContent('a.b', { fetchFn: countingFetch });
  assert.equal(invalidCalls, 0);
  assert.deepEqual(underscoreRes, { kind: 'static', url: 'plots/_ab/index.html' });
  assert.deepEqual(dottedRes, { kind: 'static', url: 'plots/a.b/index.html' });

  let validUrl = null;
  const validRes = await resolvePlotOverlayContent('a-b_c9', {
    fetchFn: async (url) => {
      validUrl = url;
      return { status: 200, async json() { return { html: '<p>ok</p>' }; } };
    },
  });
  assert.equal(validUrl, '/api/town/plot?handle=a-b_c9');
  assert.deepEqual(validRes, { kind: 'api', html: '<p>ok</p>' });
});

test('resolveGazetteOverlayContent rejects filenames with spaces, subdirectories, or empty strings, and non-array / null-entry issues', async () => {
  const cases = [
    { latest: 2, issues: [{ n: 2, file: 'issue 002.html' }] },
    { latest: 2, issues: [{ n: 2, file: 'sub/issue-002.html' }] },
    { latest: 2, issues: [{ n: 2, file: '' }] },
    { issues: 'not-an-array' },
    { issues: [null] },
    { issues: [{ n: 2 }] },
  ];

  for (const payload of cases) {
    const res = await resolveGazetteOverlayContent({
      fetchFn: async () => ({ ok: true, async json() { return payload; } }),
    });
    assert.equal(res.issueFile, 'issue-001.html');
    assert.equal(res.issueNum, 1);
  }
});

test('resolveGazetteOverlayContent uses issues[0] when latest is missing or null, and keeps its n', async () => {
  const missingLatestRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() { return { issues: [{ n: 5, file: 'issue-005.html' }] }; },
    }),
  });
  assert.deepEqual(missingLatestRes, {
    issueNum: 5,
    issueFile: 'issue-005.html',
    url: 'gazette/issue-005.html',
    title: 'The Ghostlight Gazette — Issue #5',
  });

  const nullLatestRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: null, issues: [{ n: 3, file: 'issue-003.html' }] }; },
    }),
  });
  assert.deepEqual(nullLatestRes, {
    issueNum: 3,
    issueFile: 'issue-003.html',
    url: 'gazette/issue-003.html',
    title: 'The Ghostlight Gazette — Issue #3',
  });
});

test('openPlotOverlay overwrites a pre-set sandbox value, and closePlotOverlay clears an API-opened srcdoc', async () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  iframeEl.setAttribute('sandbox', 'allow-scripts');

  await openPlotOverlay('wick', {
    overlayEl,
    titleEl,
    iframeEl,
    fetchFn: async () => ({ status: 200, async json() { return { html: '<h1>Wick</h1>' }; } }),
  });
  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.equal(iframeEl.srcdoc, '<h1>Wick</h1>');
  assert.equal(iframeEl.getAttribute('src'), null);

  closePlotOverlay({ overlayEl, iframeEl });
  assert.equal(overlayEl.hidden, true);
  assert.equal(iframeEl.src, 'about:blank');
  assert.equal(iframeEl.getAttribute('srcdoc'), null);
});

test('resolvePlotOverlayContent returns static paths for undefined, object, and boolean handles without fetching, and treats a non-function fetchFn as absent', async () => {
  let calls = 0;
  const spyFetch = async () => {
    calls++;
    return { status: 200, async json() { return { html: '<p>x</p>' }; } };
  };

  assert.deepEqual(
    await resolvePlotOverlayContent(undefined, { fetchFn: spyFetch }),
    { kind: 'static', url: 'plots//index.html' },
  );
  assert.deepEqual(
    await resolvePlotOverlayContent({}, { fetchFn: spyFetch }),
    { kind: 'static', url: 'plots/%5Bobject%20Object%5D/index.html' },
  );
  assert.deepEqual(
    await resolvePlotOverlayContent(true, { fetchFn: spyFetch }),
    { kind: 'static', url: 'plots/true/index.html' },
  );
  assert.deepEqual(
    await resolvePlotOverlayContent('a b', { fetchFn: spyFetch }),
    { kind: 'static', url: 'plots/a%20b/index.html' },
  );
  assert.deepEqual(
    await resolvePlotOverlayContent('wick', { fetchFn: 'not-a-function' }),
    { kind: 'static', url: 'plots/wick/index.html' },
  );
  assert.equal(calls, 0);
});

test('resolveGazetteOverlayContent falls back to issue-001 when the latest-matched entry has an invalid file, and tolerates non-object data', async () => {
  const shadowedRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() {
        return {
          latest: 2,
          issues: [
            { n: 1, file: 'issue-001.html' },
            { n: 2, file: 'sub/bad.html' },
          ],
        };
      },
    }),
  });
  assert.equal(shadowedRes.issueFile, 'issue-001.html');
  assert.equal(shadowedRes.issueNum, 1);

  const nonObjectRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() { return 'not-an-object'; },
    }),
  });
  assert.equal(nonObjectRes.issueFile, 'issue-001.html');
  assert.equal(nonObjectRes.issueNum, 1);
});

test('resolveGazetteOverlayContent keeps a string issue n verbatim and tolerates an undefined response', async () => {
  const stringNRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() {
        return {
          latest: '2',
          issues: [{ n: '2', file: 'issue-002.html' }],
        };
      },
    }),
  });
  assert.deepEqual(stringNRes, {
    issueNum: '2',
    issueFile: 'issue-002.html',
    url: 'gazette/issue-002.html',
    title: 'The Ghostlight Gazette — Issue #2',
  });

  const undefRes = await resolveGazetteOverlayContent({
    fetchFn: async () => undefined,
  });
  assert.equal(undefRes.issueFile, 'issue-001.html');
  assert.equal(undefRes.issueNum, 1);
});

test('openPlotOverlay calls onBeforeOpen before any DOM change and still opens the static fallback when fetch throws', async () => {
  const els = makeFakeOverlayElements();
  let observedTitle = null;
  let observedHidden = null;

  await openPlotOverlay('wick', {
    ...els,
    fetchFn: async () => ({ status: 200, async json() { return { html: '<p>ok</p>' }; } }),
    onBeforeOpen: () => {
      observedTitle = els.titleEl.textContent;
      observedHidden = els.overlayEl.hidden;
    },
  });
  assert.equal(observedTitle, '');
  assert.equal(observedHidden, true);
  assert.equal(els.titleEl.textContent, '@wick — Desk Note');

  const throwEls = makeFakeOverlayElements();
  throwEls.iframeEl.srcdoc = '<p>stale</p>';
  const throwRes = await openPlotOverlay('wick', {
    ...throwEls,
    fetchFn: async () => { throw new Error('network boom'); },
  });
  assert.deepEqual(throwRes, { kind: 'static', url: 'plots/wick/index.html' });
  assert.equal(throwEls.overlayEl.hidden, false);
  assert.equal(throwEls.iframeEl.src, 'plots/wick/index.html');
  assert.equal(throwEls.iframeEl.getAttribute('srcdoc'), null);
});

test('openPlotOverlay and openGazetteOverlay return null without fetching when any element is missing', async () => {
  for (const missingKey of ['overlayEl', 'titleEl', 'iframeEl']) {
    let plotCalls = 0;
    const plotEls = makeFakeOverlayElements();
    plotEls[missingKey] = null;
    const plotRes = await openPlotOverlay('wick', {
      ...plotEls,
      fetchFn: async () => {
        plotCalls++;
        return { status: 200, async json() { return { html: '<p>x</p>' }; } };
      },
    });
    assert.equal(plotRes, null);
    assert.equal(plotCalls, 0);

    let gazetteCalls = 0;
    const gazetteEls = makeFakeOverlayElements();
    gazetteEls[missingKey] = null;
    const gazetteRes = await openGazetteOverlay({
      ...gazetteEls,
      fetchFn: async () => {
        gazetteCalls++;
        return {
          ok: true,
          async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; },
        };
      },
    });
    assert.equal(gazetteRes, null);
    assert.equal(gazetteCalls, 0);
  }
});

test('closePlotOverlay leaves the title and sandbox untouched, and openGazetteOverlay overwrites a pre-set sandbox value', async () => {
  const plotEls = makeFakeOverlayElements();
  await openPlotOverlay('wick', {
    ...plotEls,
    fetchFn: async () => ({ status: 200, async json() { return { html: '<h1>W</h1>' }; } }),
  });
  closePlotOverlay({ overlayEl: plotEls.overlayEl, iframeEl: plotEls.iframeEl });
  assert.equal(plotEls.overlayEl.hidden, true);
  assert.equal(plotEls.iframeEl.src, 'about:blank');
  assert.equal(plotEls.iframeEl.getAttribute('srcdoc'), null);
  assert.equal(plotEls.titleEl.textContent, '@wick — Desk Note');
  assert.equal(plotEls.iframeEl.getAttribute('sandbox'), '');

  const gazetteEls = makeFakeOverlayElements();
  gazetteEls.iframeEl.setAttribute('sandbox', 'allow-scripts');
  await openGazetteOverlay({
    ...gazetteEls,
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; },
    }),
  });
  assert.equal(gazetteEls.iframeEl.getAttribute('sandbox'), '');
  assert.equal(gazetteEls.titleEl.textContent, 'The Ghostlight Gazette — Issue #2');
});


test('resolvePlotOverlayContent rejects empty, whitespace-only, and non-string html with static fallback', async () => {
  const apiHtml = (html) => async () => ({ status: 200, async json() { return { html }; } });
  assert.deepEqual(await resolvePlotOverlayContent('wick', { fetchFn: apiHtml('   ') }), { kind: 'static', url: 'plots/wick/index.html' });
  assert.deepEqual(await resolvePlotOverlayContent('wick', { fetchFn: apiHtml('') }), { kind: 'static', url: 'plots/wick/index.html' });
  assert.deepEqual(await resolvePlotOverlayContent('wick', { fetchFn: apiHtml(42) }), { kind: 'static', url: 'plots/wick/index.html' });
  assert.deepEqual(await resolvePlotOverlayContent('wick', { fetchFn: apiHtml(null) }), { kind: 'static', url: 'plots/wick/index.html' });
});

test('resolvePlotOverlayContent encodes traversal-shaped handles into static URLs without fetching', async () => {
  let calls = 0;
  const countingFetch = async () => {
    calls++;
    return { status: 200, async json() { return { html: '<p>x</p>' }; } };
  };
  assert.deepEqual(await resolvePlotOverlayContent('../wick', { fetchFn: countingFetch }), { kind: 'static', url: 'plots/..%2Fwick/index.html' });
  assert.equal(calls, 0);
  assert.deepEqual(await resolvePlotOverlayContent('wick\n', { fetchFn: countingFetch }), { kind: 'static', url: 'plots/wick%0A/index.html' });
  assert.equal(calls, 0);
  assert.deepEqual(await resolvePlotOverlayContent('a/b', { fetchFn: countingFetch }), { kind: 'static', url: 'plots/a%2Fb/index.html' });
  assert.equal(calls, 0);
  assert.deepEqual(await resolvePlotOverlayContent('', { fetchFn: countingFetch }), { kind: 'static', url: 'plots//index.html' });
  assert.equal(calls, 0);
});

test('resolvePlotOverlayContent apiBase edge values resolve to the bare path or strip trailing slash', async () => {
  let url = null;
  const captureFetch = async (u) => {
    url = u;
    return { status: 200, async json() { return { html: '<p>x</p>' }; } };
  };
  await resolvePlotOverlayContent('wick', { apiBase: '/', fetchFn: captureFetch });
  assert.equal(url, '/api/town/plot?handle=wick');
  await resolvePlotOverlayContent('wick', { apiBase: null, fetchFn: captureFetch });
  assert.equal(url, '/api/town/plot?handle=wick');
  await resolvePlotOverlayContent('wick', { apiBase: 'https://example.test/', fetchFn: captureFetch });
  assert.equal(url, 'https://example.test/api/town/plot?handle=wick');
  await resolvePlotOverlayContent('wick', { apiBase: undefined, fetchFn: captureFetch });
  assert.equal(url, '/api/town/plot?handle=wick');
});

test('resolveGazetteOverlayContent issue-selection handles duplicate, leading junk, array, and number payloads', async () => {
  const rDup = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }, { n: 2, file: 'issue-002b.html' }] }; },
    }),
  });
  assert.equal(rDup.issueFile, 'issue-002.html');
  assert.equal(rDup.issueNum, 2);

  const rJunk = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: ['x', { n: 2, file: 'issue-002.html' }] }; },
    }),
  });
  assert.equal(rJunk.issueFile, 'issue-002.html');

  const rArr = await resolveGazetteOverlayContent({
    fetchFn: async () => ({ ok: true, async json() { return [1, 2]; } }),
  });
  assert.equal(rArr.issueFile, 'issue-001.html');
  assert.equal(rArr.issueNum, 1);

  const rNum = await resolveGazetteOverlayContent({
    fetchFn: async () => ({ ok: true, async json() { return 42; } }),
  });
  assert.equal(rNum.issueFile, 'issue-001.html');
  assert.equal(rNum.issueNum, 1);
});

test('resolveGazetteOverlayContent filename accept and reject matrix', async () => {
  const resolveWithFile = (file) => resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file }] }; },
    }),
  });
  assert.equal((await resolveWithFile('issue_002.html')).issueFile, 'issue_002.html');
  assert.equal((await resolveWithFile('issue-002.htm')).issueFile, 'issue-002.htm');
  assert.equal((await resolveWithFile('2.html')).issueFile, '2.html');

  const rQuery = await resolveWithFile('issue-002.html?x=1');
  assert.equal(rQuery.issueFile, 'issue-001.html');
  assert.equal(rQuery.issueNum, 1);

  const rBackslash = await resolveWithFile('sub\\issue.html');
  assert.equal(rBackslash.issueFile, 'issue-001.html');
  assert.equal(rBackslash.issueNum, 1);

  const rSpace = await resolveWithFile('issue-002.html ');
  assert.equal(rSpace.issueFile, 'issue-001.html');
  assert.equal(rSpace.issueNum, 1);
});

test('openPlotOverlay sets title and sandbox before the fetch resolves', async () => {
  const els = makeFakeOverlayElements();
  let release;
  const gate = new Promise((res) => { release = res; });
  const p = openPlotOverlay('wick', { ...els, fetchFn: async () => { await gate; return { status: 200, async json() { return { html: '<p>ok</p>' }; } }; } });
  assert.equal(els.titleEl.textContent, '@wick — Desk Note');
  assert.equal(els.iframeEl.getAttribute('sandbox'), '');
  assert.equal(els.overlayEl.hidden, true);
  assert.equal(els.iframeEl.src, '');
  assert.equal(els.iframeEl.srcdoc, '');
  release();
  const res = await p;
  assert.deepEqual(res, { kind: 'api', html: '<p>ok</p>' });
  assert.equal(els.overlayEl.hidden, false);
});

test('openGazetteOverlay sets the title only after the fetch resolves', async () => {
  const els = makeFakeOverlayElements();
  let release;
  const gate = new Promise((res) => { release = res; });
  const p = openGazetteOverlay({ ...els, fetchFn: async () => { await gate; return { ok: true, async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; } }; } });
  assert.equal(els.titleEl.textContent, '');
  assert.equal(els.overlayEl.hidden, true);
  assert.equal(els.iframeEl.src, '');
  release();
  const res = await p;
  assert.equal(res.issueNum, 2);
  assert.equal(els.titleEl.textContent, 'The Ghostlight Gazette — Issue #2');
  assert.equal(els.overlayEl.hidden, false);
});

test('openPlotOverlay handles back-to-back API and static transitions on shared elements', async () => {
  const apiToStaticEls = makeFakeOverlayElements();
  await openPlotOverlay('wick', {
    ...apiToStaticEls,
    fetchFn: async () => ({ status: 200, async json() { return { html: '<h1>Wick</h1>' }; } }),
  });
  assert.equal(apiToStaticEls.iframeEl.srcdoc, '<h1>Wick</h1>');
  assert.equal(apiToStaticEls.iframeEl.getAttribute('src'), null);
  const staticRes = await openPlotOverlay('maren', {
    ...apiToStaticEls,
    fetchFn: async () => ({ status: 404 }),
  });
  assert.deepEqual(staticRes, { kind: 'static', url: 'plots/maren/index.html' });
  assert.equal(apiToStaticEls.titleEl.textContent, '@maren — Desk Note');
  assert.equal(apiToStaticEls.iframeEl.getAttribute('srcdoc'), null);
  assert.equal(apiToStaticEls.iframeEl.src, 'plots/maren/index.html');
  assert.equal(apiToStaticEls.overlayEl.hidden, false);

  const staticToApiEls = makeFakeOverlayElements();
  await openPlotOverlay('wick', {
    ...staticToApiEls,
    fetchFn: async () => ({ status: 404 }),
  });
  assert.equal(staticToApiEls.iframeEl.src, 'plots/wick/index.html');
  const apiRes = await openPlotOverlay('wick', {
    ...staticToApiEls,
    fetchFn: async () => ({ status: 200, async json() { return { html: '<h1>Wick</h1>' }; } }),
  });
  assert.deepEqual(apiRes, { kind: 'api', html: '<h1>Wick</h1>' });
  assert.equal(staticToApiEls.iframeEl.srcdoc, '<h1>Wick</h1>');
  assert.equal(staticToApiEls.iframeEl.getAttribute('src'), null);
});

test('closePlotOverlay is idempotent on double close and guards missing or empty arguments', () => {
  const els = makeFakeOverlayElements();
  els.overlayEl.hidden = false;
  els.iframeEl.srcdoc = '<p>hi</p>';
  let calls = 0;
  closePlotOverlay({ overlayEl: els.overlayEl, iframeEl: els.iframeEl, onAfterClose: () => { calls++; } });
  closePlotOverlay({ overlayEl: els.overlayEl, iframeEl: els.iframeEl, onAfterClose: () => { calls++; } });
  assert.equal(els.overlayEl.hidden, true);
  assert.equal(els.iframeEl.src, 'about:blank');
  assert.equal(els.iframeEl.getAttribute('srcdoc'), null);
  assert.equal(calls, 2);

  assert.equal(closePlotOverlay(), undefined);
  assert.equal(closePlotOverlay({}), undefined);
});

test('openPlotOverlay sets title for non-string handle and openGazetteOverlay clears stale srcdoc', async () => {
  const plotEls = makeFakeOverlayElements();
  let calls = 0;
  const plotRes = await openPlotOverlay(42, {
    ...plotEls,
    fetchFn: async () => {
      calls++;
      return { status: 200, async json() { return { html: '<p>x</p>' }; } };
    },
  });
  assert.deepEqual(plotRes, { kind: 'static', url: 'plots/42/index.html' });
  assert.equal(plotEls.titleEl.textContent, '@42 — Desk Note');
  assert.equal(calls, 0);

  const gazetteEls = makeFakeOverlayElements();
  gazetteEls.iframeEl.srcdoc = '<p>stale api note</p>';
  gazetteEls.iframeEl.src = 'plots/wick/index.html';
  const gazetteRes = await openGazetteOverlay({
    ...gazetteEls,
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; },
    }),
  });
  assert.equal(gazetteRes.issueFile, 'issue-002.html');
  assert.equal(gazetteEls.iframeEl.getAttribute('srcdoc'), null);
  assert.equal(gazetteEls.iframeEl.src, 'gazette/issue-002.html');
  assert.equal(gazetteEls.overlayEl.hidden, false);
});

test('resolvePlotOverlayContent missing res.json, String-object html, extra fields ignored, and no options', async () => {
  const noJsonRes = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ status: 200 }),
  });
  assert.deepEqual(noJsonRes, { kind: 'static', url: 'plots/wick/index.html' });

  const stringObjRes = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ status: 200, async json() { return { html: new String('<p>x</p>') }; } }),
  });
  assert.deepEqual(stringObjRes, { kind: 'static', url: 'plots/wick/index.html' });

  const extraRes = await resolvePlotOverlayContent('wick', {
    fetchFn: async () => ({ status: 200, async json() { return { html: '<p>x</p>', extra: 1 }; } }),
  });
  assert.deepEqual(extraRes, { kind: 'api', html: '<p>x</p>' });

  assert.deepEqual(await resolvePlotOverlayContent('wick'), { kind: 'static', url: 'plots/wick/index.html' });
  assert.deepEqual(await resolvePlotOverlayContent('wick', {}), { kind: 'static', url: 'plots/wick/index.html' });
});

test('resolveGazetteOverlayContent numeric latest vs string n, missing res.json, and no args', async () => {
  const stringNRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() {
        return { latest: 2, issues: [{ n: '2', file: 'issue-002.html' }, { n: 1, file: 'issue-001.html' }] };
      },
    }),
  });
  assert.deepEqual(stringNRes, {
    issueNum: '2',
    issueFile: 'issue-002.html',
    url: 'gazette/issue-002.html',
    title: 'The Ghostlight Gazette — Issue #2',
  });

  const noJsonRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({ ok: true }),
  });
  assert.equal(noJsonRes.issueFile, 'issue-001.html');
  assert.equal(noJsonRes.issueNum, 1);

  assert.deepEqual(await resolveGazetteOverlayContent(), {
    issueNum: 1,
    issueFile: 'issue-001.html',
    url: 'gazette/issue-001.html',
    title: 'The Ghostlight Gazette — Issue #1',
  });
  assert.deepEqual(await resolveGazetteOverlayContent({}), {
    issueNum: 1,
    issueFile: 'issue-001.html',
    url: 'gazette/issue-001.html',
    title: 'The Ghostlight Gazette — Issue #1',
  });
});

test('null options throws for resolvers and openers and openers with no options return null', async () => {
  await assert.rejects(() => resolvePlotOverlayContent('wick', null), TypeError);
  await assert.rejects(() => resolveGazetteOverlayContent(null), TypeError);
  await assert.rejects(() => openPlotOverlay('wick', null), TypeError);
  await assert.rejects(() => openGazetteOverlay(null), TypeError);
  assert.throws(() => closePlotOverlay(null), TypeError);

  assert.equal(await openPlotOverlay('wick'), null);
  assert.equal(await openGazetteOverlay(), null);
  assert.equal(await openPlotOverlay(), null);
});

test('resolvePlotOverlayContent apiBase path prefix, slash-only base, and double api segment', async () => {
  let url = null;
  const captureFetch = async (u) => {
    url = u;
    return { status: 200, async json() { return { html: '<p>x</p>' }; } };
  };
  await resolvePlotOverlayContent('wick', { apiBase: 'https://example.test/town', fetchFn: captureFetch });
  assert.equal(url, 'https://example.test/town/api/town/plot?handle=wick');
  await resolvePlotOverlayContent('wick', { apiBase: '///', fetchFn: captureFetch });
  assert.equal(url, '/api/town/plot?handle=wick');
  await resolvePlotOverlayContent('wick', { apiBase: 'https://example.test/api/', fetchFn: captureFetch });
  assert.equal(url, 'https://example.test/api/api/town/plot?handle=wick');
});

test('resolveGazetteOverlayContent filename regex accepts dot names and rejects trailing newline and tab', async () => {
  const withFile = (file) => resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file }] }; },
    }),
  });
  assert.equal((await withFile('..')).issueFile, '..');
  assert.equal((await withFile('..')).url, 'gazette/..');
  assert.equal((await withFile('.html')).issueFile, '.html');
  assert.equal((await withFile('a')).issueFile, 'a');
  assert.equal((await withFile('issue-002.html\n')).issueFile, 'issue-001.html');
  assert.equal((await withFile('issue-002.html\t')).issueFile, 'issue-001.html');
  assert.equal((await withFile('issue-002.html\n')).issueNum, 1);
});

test('openPlotOverlay dash-handle title with static apiBase passthrough and openGazetteOverlay string-n title', async () => {
  const els = makeFakeOverlayElements();
  let seenUrl = null;
  const staticRes = await openPlotOverlay('wick-2', {
    ...els,
    apiBase: 'https://example.test/',
    fetchFn: async (u) => {
      seenUrl = u;
      return { status: 404 };
    },
  });
  assert.deepEqual(staticRes, { kind: 'static', url: 'plots/wick-2/index.html' });
  assert.equal(seenUrl, 'https://example.test/api/town/plot?handle=wick-2');
  assert.equal(els.titleEl.textContent, '@wick-2 — Desk Note');
  assert.equal(els.iframeEl.src, 'plots/wick-2/index.html');

  const gazetteEls = makeFakeOverlayElements();
  const gazetteRes = await openGazetteOverlay({
    ...gazetteEls,
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: '2', issues: [{ n: '2', file: 'issue-002.html' }] }; },
    }),
  });
  assert.equal(gazetteRes.issueNum, '2');
  assert.equal(gazetteEls.titleEl.textContent, 'The Ghostlight Gazette — Issue #2');
  assert.equal(gazetteEls.iframeEl.src, 'gazette/issue-002.html');
});

test('openGazetteOverlay onBeforeOpen pre-open state, close after gazette open, and api plot to gazette transition', async () => {
  const beforeEls = makeFakeOverlayElements();
  let seenTitle = null;
  let seenHidden = null;
  await openGazetteOverlay({
    ...beforeEls,
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; },
    }),
    onBeforeOpen: () => {
      seenTitle = beforeEls.titleEl.textContent;
      seenHidden = beforeEls.overlayEl.hidden;
    },
  });
  assert.equal(seenTitle, '');
  assert.equal(seenHidden, true);
  assert.equal(beforeEls.titleEl.textContent, 'The Ghostlight Gazette — Issue #2');

  const closeEls = makeFakeOverlayElements();
  await openGazetteOverlay({
    ...closeEls,
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; },
    }),
  });
  closePlotOverlay({ overlayEl: closeEls.overlayEl, iframeEl: closeEls.iframeEl });
  assert.equal(closeEls.overlayEl.hidden, true);
  assert.equal(closeEls.iframeEl.src, 'about:blank');
  assert.equal(closeEls.iframeEl.getAttribute('srcdoc'), null);
  assert.equal(closeEls.titleEl.textContent, 'The Ghostlight Gazette — Issue #2');

  const sharedEls = makeFakeOverlayElements();
  await openPlotOverlay('wick', {
    ...sharedEls,
    fetchFn: async () => ({ status: 200, async json() { return { html: '<h1>Wick</h1>' }; } }),
  });
  assert.equal(sharedEls.iframeEl.srcdoc, '<h1>Wick</h1>');
  await openGazetteOverlay({
    ...sharedEls,
    fetchFn: async () => ({
      ok: true,
      async json() { return { latest: 2, issues: [{ n: 2, file: 'issue-002.html' }] }; },
    }),
  });
  assert.equal(sharedEls.iframeEl.getAttribute('srcdoc'), null);
  assert.equal(sharedEls.iframeEl.src, 'gazette/issue-002.html');
  assert.equal(sharedEls.titleEl.textContent, 'The Ghostlight Gazette — Issue #2');
  assert.equal(sharedEls.overlayEl.hidden, false);
});

test('plot-overlay.mjs source pins — header, HANDLE_RE, no imports, five exports, and no banned calls', async () => {
  const src = await fs.readFile(path.join(__dirname, 'plot-overlay.mjs'), 'utf8');
  const lines = src.split('\n');
  assert.equal(lines[0], '// Copied verbatim from town-3d/town.js (HANDLE_RE + resolvePlotOverlayContent, lines 1678-1707)');
  assert.equal(lines[1], '// and town-3d/index.html (Gazette latest.json resolver + #plot-overlay open/close DOM wiring, lines 350-400, 447-453).');
  assert.equal(lines[2], '// Keep in step with town-3d/; no THREE dependency, no top-level document access.');
  assert.equal(lines[4], 'const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;');
  assert.equal(lines.filter((l) => l.startsWith('import ')).length, 0);
  assert.equal(lines.filter((l) => l.startsWith('export ')).length, 5);
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Math' + '.random')).length, 0);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.toLowerCase().includes('camp' + 'fire')).length, 0);
  assert.equal(lines.filter((l) => l.includes('inner' + 'HTML')).length, 0);
  assert.equal(lines.filter((l) => l.includes('document')).length, 1);
});

test('staging.js plot-overlay wiring source pins', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const sl = stagingSrc.split('\n');
  assert.equal(sl[57], '  openPlotOverlay,');
  assert.equal(sl[58], '  openGazetteOverlay,');
  assert.equal(sl[59], '  closePlotOverlay,');
  assert.equal(sl[60], "} from './plot-overlay.mjs';");
  assert.equal(sl[168], "const plotOverlayEl = document.getElementById('plot-overlay');");
  assert.equal(sl[169], "const plotOverlayTitleEl = document.getElementById('plot-overlay-title');");
  assert.equal(sl[174], "const plotIframeEl = document.getElementById('plot-iframe');");
  assert.equal(sl[225], '  closePlotOverlay({');
  assert.equal(sl[248], '  openPlotOverlay(currentPlotHandle, {');
  assert.equal(sl[1379], '          openPlotOverlay(target.userData.handle, {');
  assert.equal(sl[1393], '          openGazetteOverlay({');
  assert.equal(sl.filter((l) => l.includes('openPlotOverlay(')).length, 2);
  assert.equal(sl.filter((l) => l.includes('openGazetteOverlay(')).length, 1);
  assert.equal(sl.filter((l) => l.includes('closePlotOverlay(')).length, 1);
  assert.equal(sl.filter((l) => l.includes('plot-overlay.mjs')).length, 1);
  assert.equal(sl.filter((l) => l.includes('resolvePlotOverlayContent')).length, 0);
  assert.equal(sl.filter((l) => l.includes('resolveGazetteOverlayContent')).length, 0);
});

test('file hygiene — 58 unique names, 6 imports, and pinned as-true counts', async () => {
  const self = await fs.readFile(path.join(__dirname, 'test-plot-overlay.mjs'), 'utf8');
  const lines = self.split('\n');
  const names = [...self.matchAll(/^(?:await )?test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 58);
  assert.equal(new Set(names).size, 58); // every top-level test name unique
  assert.deepEqual(lines.filter((l) => l.startsWith('import ')), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'import {',
  ]); // no new top-level imports
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Math' + '.random')).length, 0);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.toLowerCase().includes('camp' + 'fire')).length, 0);
  assert.equal(lines.filter((l) => l.includes('inner' + 'HTML')).length, 0);
});

test('P1 — HANDLE_RE drift pin between town-3d/town.js and staging-polyfork/plot-overlay.mjs', async () => {
  const expected = 'const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;';
  const [townSrc, overlaySrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'plot-overlay.mjs'), 'utf8'),
  ]);
  const townLine = townSrc.split('\n').find((l) => l.includes('const HANDLE_RE'));
  const overlayLine = overlaySrc.split('\n').find((l) => l.includes('const HANDLE_RE'));
  assert.equal(townLine, expected);
  assert.equal(overlayLine, expected);
});

test('P2 — resolvePlotOverlayContent apiBase object, boolean, and 0 resolve to bare path', async () => {
  for (const apiBase of [{}, true, 0]) {
    let seenUrl = null;
    const res = await resolvePlotOverlayContent('wick', {
      apiBase,
      fetchFn: async (url) => {
        seenUrl = url;
        return { status: 200, json: async () => ({ html: '<p>x</p>' }) };
      },
    });
    assert.equal(seenUrl, '/api/town/plot?handle=wick');
    assert.deepEqual(res, { kind: 'api', html: '<p>x</p>' });
  }
});

test('P3 — resolvePlotOverlayContent plot data null or html boolean fall back to static', async () => {
  for (const payload of [null, { html: true }, { html: false }]) {
    const res = await resolvePlotOverlayContent('wick', {
      fetchFn: async () => ({ status: 200, json: async () => payload }),
    });
    assert.deepEqual(res, { kind: 'static', url: 'plots/wick/index.html' });
  }
});

test('P4 — resolvePlotOverlayContent percent and query-shaped handles encode into static URLs with no fetch', async () => {
  let calls = 0;
  const countingFetch = async () => {
    calls += 1;
    return { status: 200, json: async () => ({ html: '<p>nope</p>' }) };
  };
  const pctRes = await resolvePlotOverlayContent('wick%20x', { fetchFn: countingFetch });
  const qryRes = await resolvePlotOverlayContent('wick?x=1', { fetchFn: countingFetch });
  assert.deepEqual(pctRes, { kind: 'static', url: 'plots/wick%2520x/index.html' });
  assert.deepEqual(qryRes, { kind: 'static', url: 'plots/wick%3Fx%3D1/index.html' });
  assert.equal(calls, 0);
});

test('P5 — resolveGazetteOverlayContent leading-dot file, missing latest, and latest true', async () => {
  const dotRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ latest: 2, issues: [{ n: 2, file: '.issue-002.html' }] }),
    }),
  });
  assert.equal(dotRes.issueNum, 2);
  assert.equal(dotRes.issueFile, '.issue-002.html');

  const noLatestRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ issues: [{ n: 5, file: 'issue-005.html' }] }),
    }),
  });
  assert.equal(noLatestRes.issueNum, 5);
  assert.equal(noLatestRes.issueFile, 'issue-005.html');

  const boolLatestRes = await resolveGazetteOverlayContent({
    fetchFn: async () => ({
      ok: true,
      json: async () => ({
        latest: true,
        issues: [
          { n: 3, file: 'issue-003.html' },
          { n: 4, file: 'issue-004.html' },
        ],
      }),
    }),
  });
  assert.equal(boolLatestRes.issueNum, 3);
  assert.equal(boolLatestRes.issueFile, 'issue-003.html');
});

test('P6 — openGazetteOverlay with no fetchFn opens issue-001', async () => {
  const els = makeFakeOverlayElements();
  const res = await openGazetteOverlay({ ...els });
  assert.deepEqual(res, {
    issueNum: 1,
    issueFile: 'issue-001.html',
    url: 'gazette/issue-001.html',
    title: 'The Ghostlight Gazette — Issue #1',
  });
  assert.equal(els.titleEl.textContent, 'The Ghostlight Gazette — Issue #1');
  assert.equal(els.iframeEl.src, 'gazette/issue-001.html');
  assert.equal(els.overlayEl.hidden, false);
  assert.equal(els.iframeEl.getAttribute('sandbox'), '');
});

test('P7 — staging.js handleClosePlotOverlay source lines 216-230', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const sl = stagingSrc.split('\n');
  assert.equal(sl[222], 'function handleClosePlotOverlay() {');
  assert.equal(sl[223], '  currentPlotHandle = null;');
  assert.equal(sl[224], '  setPlotTabs(null);');
  assert.equal(sl[225], '  closePlotOverlay({');
  assert.equal(sl[226], '    overlayEl: plotOverlayEl,');
  assert.equal(sl[227], '    iframeEl: plotIframeEl,');
  assert.equal(sl[228], '    onAfterClose: () => {');
  assert.equal(sl[229], '      keys.clear();');
  assert.equal(sl[230], '      if (!interiorVisit.isInside()) {');
  assert.equal(sl[231], '        controls.enabled = true;');
  assert.equal(sl[232], '      }');
  assert.equal(sl[233], '      renderer.domElement.focus?.();');
  assert.equal(sl[234], '    },');
  assert.equal(sl[235], '  });');
  assert.equal(sl[236], '}');
});

test('P8 — staging.js tab-note click handler source lines 234-253', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const sl = stagingSrc.split('\n');
  assert.equal(sl[240], "plotOverlayTabNoteEl?.addEventListener('click', () => {");
  assert.equal(sl[241], '  if (!currentPlotHandle) return;');
  assert.equal(sl[242], "  const fetchFn = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;");
  assert.equal(sl[243], '  // NOTE: no liveStore here — these handlers run at module scope, outside');
  assert.equal(sl[244], '  // init() where liveStore lives. Referencing it threw a ReferenceError and');
  assert.equal(sl[245], '  // killed both tabs (Nov 23 hotfix). The cottage opener sets the tab label');
  assert.equal(sl[246], '  // fresh on every open, which is when it matters.');
  assert.equal(sl[247], "  setPlotTabs('note');");
  assert.equal(sl[248], '  openPlotOverlay(currentPlotHandle, {');
  assert.equal(sl[249], '    overlayEl: plotOverlayEl,');
  assert.equal(sl[250], '    titleEl: plotOverlayTitleEl,');
  assert.equal(sl[251], '    iframeEl: plotIframeEl,');
  assert.equal(sl[252], '    fetchFn,');
  assert.equal(sl[253], '    onBeforeOpen: () => {');
  assert.equal(sl[254], '      keys.clear();');
  assert.equal(sl[255], '      controls.enabled = false;');
  assert.equal(sl[256], '      glideTarget = null;');
  assert.equal(sl[257], '    },');
  assert.equal(sl[258], '  });');
  assert.equal(sl[259], '});');
});

test('P9 — staging.js cottage-click branch source lines 1347-1361', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const sl = stagingSrc.split('\n');
  assert.equal(sl[1373], '          currentPlotHandle = target.userData.handle;');
  assert.equal(sl[1374], '          if (plotOverlayTabGuestbookEl) {');
  assert.equal(sl[1375], '            plotOverlayTabGuestbookEl.textContent = formatPlotGuestbookTabLabel(');
  assert.equal(sl[1376], '              liveStore.lastState?.guestbook_by_plot?.[currentPlotHandle]');
  assert.equal(sl[1377], '            );');
  assert.equal(sl[1378], '          }');
  assert.equal(sl[1379], '          openPlotOverlay(target.userData.handle, {');
  assert.equal(sl[1407], '            overlayEl: plotOverlayEl,');
  assert.equal(sl[1408], '            titleEl: plotOverlayTitleEl,');
  assert.equal(sl[1409], '            iframeEl: plotIframeEl,');
  assert.equal(sl[1383], '            fetchFn,');
  assert.equal(sl[1384], '            onBeforeOpen: onBeforeOverlayOpen,');
  assert.equal(sl[1385], '          });');
  assert.equal(sl[1386], "          setPlotTabs('note');");
  assert.equal(sl[1387], '          return true;');
});

test('P10 — staging.js newsstand branch source lines 1363-1375', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const sl = stagingSrc.split('\n');
  assert.equal(sl[1389], "        if (kind === 'newsstand') {");
  assert.equal(sl[1390], '          if (infoStripEl) infoStripEl.hidden = true;');
  assert.equal(sl[1391], '          currentPlotHandle = null;');
  assert.equal(sl[1392], '          setPlotTabs(null);');
  assert.equal(sl[1393], '          openGazetteOverlay({');
  assert.equal(sl[1394], '            overlayEl: plotOverlayEl,');
  assert.equal(sl[1395], '            titleEl: plotOverlayTitleEl,');
  assert.equal(sl[1396], '            iframeEl: plotIframeEl,');
  assert.equal(sl[1397], '            fetchFn,');
  assert.equal(sl[1398], '            onBeforeOpen: onBeforeOverlayOpen,');
  assert.equal(sl[1399], '          });');
  assert.equal(sl[1400], '          return true;');
  assert.equal(sl[1401], '        }');
});
