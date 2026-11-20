import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildNoticeBoardOverlayHtml,
  openNoticeBoardOverlay,
} from './notice-board-overlay.mjs';

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

test('notice-board-overlay.mjs buildNoticeBoardOverlayHtml stays verbatim in sync with town-3d/town.js', async () => {
  const [townSrc, stagingSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'notice-board-overlay.mjs'), 'utf8'),
  ]);

  const townFn = townSrc.match(/export function buildNoticeBoardOverlayHtml\(\) \{[\s\S]*?<\/html>`;\n\}/);
  const stagingFn = stagingSrc.match(/export function buildNoticeBoardOverlayHtml\(\) \{[\s\S]*?<\/html>`;\n\}/);
  assert.ok(townFn, 'town-3d/town.js must export buildNoticeBoardOverlayHtml');
  assert.ok(stagingFn, 'staging-polyfork/notice-board-overlay.mjs must export buildNoticeBoardOverlayHtml');
  assert.equal(stagingFn[0], townFn[0], 'buildNoticeBoardOverlayHtml drifted from town-3d/town.js');

  const townPapers = townSrc.match(/const NOTICE_BOARD_PAPERS = \[[\s\S]*?\];/);
  const stagingPapers = stagingSrc.match(/const NOTICE_BOARD_PAPERS = \[[\s\S]*?\];/);
  assert.ok(townPapers && stagingPapers, 'NOTICE_BOARD_PAPERS must exist in both files');
  assert.equal(stagingPapers[0], townPapers[0], 'NOTICE_BOARD_PAPERS drifted from town-3d/town.js');
});

test('buildNoticeBoardOverlayHtml renders all three notices, viewport meta, no script or http URLs', () => {
  const html = buildNoticeBoardOverlayHtml();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
  assert.match(html, /<h1>Notice Board<\/h1>/);
  assert.ok(!/<script\b/i.test(html), 'overlay HTML must contain no <script>');
  assert.ok(!/https?:\/\//i.test(html), 'overlay HTML must contain no external http URLs');

  const expectedNotices = [
    ['GAZETTE #2', 'Issue #2 is out — read it at the newsstand.'],
    ['THE INN', 'Rooms for short stays — ask at the tavern.'],
    ['SOCIAL GATE', 'Plots are free, no upkeep — yours outright. Bring a friend.'],
  ];
  for (const [title, body] of expectedNotices) {
    assert.ok(html.includes(title), `overlay HTML must include title "${title}"`);
    assert.ok(html.includes(body), `overlay HTML must include body "${body}"`);
  }
});

test('openNoticeBoardOverlay sets title, sandbox, srcdoc, unhides overlay, calls onBeforeOpen, and guards missing elements', () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  iframeEl.src = 'stale.html';
  let beforeCount = 0;

  const html = openNoticeBoardOverlay({
    overlayEl,
    titleEl,
    iframeEl,
    onBeforeOpen: () => { beforeCount++; },
  });

  assert.equal(beforeCount, 1);
  assert.equal(typeof html, 'string');
  assert.equal(overlayEl.hidden, false);
  assert.equal(titleEl.textContent, 'Notice Board');
  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.equal(iframeEl.getAttribute('src'), null);
  assert.equal(iframeEl.srcdoc, html);

  assert.equal(openNoticeBoardOverlay({}), null);
  assert.equal(openNoticeBoardOverlay({ overlayEl, titleEl }), null);
});

test('notice-board-overlay.mjs escapeHtml stays verbatim in sync with town-3d/town.js', async () => {
  const [townSrc, stagingSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'notice-board-overlay.mjs'), 'utf8'),
  ]);

  const townEscape = townSrc.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/);
  const stagingEscape = stagingSrc.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/);
  assert.ok(townEscape, 'town-3d/town.js must define escapeHtml');
  assert.ok(stagingEscape, 'staging-polyfork/notice-board-overlay.mjs must define escapeHtml');
  assert.equal(stagingEscape[0], townEscape[0], 'escapeHtml drifted from town-3d/town.js');
});

test('buildNoticeBoardOverlayHtml renders 3 notice sections in order with one h2 and one p each', () => {
  const html = buildNoticeBoardOverlayHtml();
  const sections = [...html.matchAll(/<section class="notice">([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length, 3);

  const expectedTitles = ['GAZETTE #2', 'THE INN', 'SOCIAL GATE'];
  const actualTitles = [];
  const actualBodies = [];

  for (const [, inner] of sections) {
    const h2Matches = [...inner.matchAll(/<h2>([\s\S]*?)<\/h2>/g)];
    const pMatches = [...inner.matchAll(/<p>([\s\S]*?)<\/p>/g)];
    assert.equal(h2Matches.length, 1, 'each notice section must have exactly one <h2>');
    assert.equal(pMatches.length, 1, 'each notice section must have exactly one <p>');
    actualTitles.push(h2Matches[0][1]);
    actualBodies.push(pMatches[0][1]);
  }

  assert.deepEqual(actualTitles, expectedTitles);
  assert.equal(actualBodies[2], 'Plots are free, no upkeep — yours outright. Bring a friend.');
});

test('buildNoticeBoardOverlayHtml renders document shell, Georgia serif #f5efe0 style, and no inline handlers or javascript: URLs', () => {
  const html = buildNoticeBoardOverlayHtml();
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('<title>Notice Board</title>'));

  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(styleMatch, 'overlay HTML must include a <style> block');
  assert.match(styleMatch[1], /font-family:\s*Georgia,\s*serif/);
  assert.match(styleMatch[1], /background:\s*#f5efe0/);

  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'overlay HTML must contain no on*= event attributes');
  assert.ok(!/javascript:/i.test(html), 'overlay HTML must contain no javascript: URLs');
});

test('openNoticeBoardOverlay returns null with no args or any single missing element', () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();

  assert.equal(openNoticeBoardOverlay(), null);
  assert.equal(openNoticeBoardOverlay({ titleEl, iframeEl }), null);
  assert.equal(openNoticeBoardOverlay({ overlayEl, iframeEl }), null);
  assert.equal(openNoticeBoardOverlay({ overlayEl, titleEl }), null);
  assert.equal(overlayEl.hidden, true);
});

test('openNoticeBoardOverlay opens normally when onBeforeOpen is omitted or not a function', () => {
  const els1 = makeFakeOverlayElements();
  const html1 = openNoticeBoardOverlay(els1);
  assert.equal(typeof html1, 'string');
  assert.equal(els1.overlayEl.hidden, false);
  assert.equal(els1.titleEl.textContent, 'Notice Board');
  assert.equal(els1.iframeEl.srcdoc, html1);

  const els2 = makeFakeOverlayElements();
  const html2 = openNoticeBoardOverlay({ ...els2, onBeforeOpen: 'x' });
  assert.equal(html2, html1);
  assert.equal(els2.overlayEl.hidden, false);
  assert.equal(els2.titleEl.textContent, 'Notice Board');
  assert.equal(els2.iframeEl.srcdoc, html2);
});

test('openNoticeBoardOverlay returns buildNoticeBoardOverlayHtml() and is idempotent across repeated calls', () => {
  const els = makeFakeOverlayElements();
  let beforeCount = 0;
  const expectedHtml = buildNoticeBoardOverlayHtml();

  const first = openNoticeBoardOverlay({
    ...els,
    onBeforeOpen: () => { beforeCount++; },
  });
  const second = openNoticeBoardOverlay({
    ...els,
    onBeforeOpen: () => { beforeCount++; },
  });

  assert.equal(first, expectedHtml);
  assert.equal(second, expectedHtml);
  assert.equal(beforeCount, 2);
  assert.equal(els.overlayEl.hidden, false);
  assert.equal(els.iframeEl.srcdoc, expectedHtml);
});

test('buildNoticeBoardOverlayHtml renders all three <p> bodies verbatim in order', () => {
  const html = buildNoticeBoardOverlayHtml();
  const bodies = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(bodies, [
    'Issue #2 is out — read it at the newsstand.',
    'Rooms for short stays — ask at the tavern.',
    'Plots are free, no upkeep — yours outright. Bring a friend.',
  ]);
});

test('buildNoticeBoardOverlayHtml <style> block pins layout, typography, and colors', () => {
  const html = buildNoticeBoardOverlayHtml();
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(styleMatch, 'overlay HTML must include a <style> block');
  const css = styleMatch[1];

  assert.match(css, /h1\s*\{[^}]*border-bottom:\s*1px\s+solid\s+#6b492b/);
  assert.match(css, /h2\s*\{[^}]*color:\s*#5a4332/);
  assert.match(css, /body\s*\{[^}]*color:\s*#2b2118/);
  assert.match(css, /max-width:\s*34rem/);
  assert.match(css, /line-height:\s*1\.6/);
  assert.match(css, /\.notice\s+p\s*\{\s*margin:\s*0;\s*\}/);
});

test('buildNoticeBoardOverlayHtml contains no links, forms, or frames and has exact shell shape', () => {
  const html = buildNoticeBoardOverlayHtml();
  assert.ok(!/<a\b/i.test(html), 'overlay HTML must contain no <a>');
  assert.ok(!/<form\b/i.test(html), 'overlay HTML must contain no <form>');
  assert.ok(!/<iframe\b/i.test(html), 'overlay HTML must contain no <iframe>');
  assert.ok(!/\btarget=/i.test(html), 'overlay HTML must contain no target=');
  assert.ok(!/\bsrc=/i.test(html), 'overlay HTML must contain no src=');

  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.endsWith('</html>'));
  assert.equal([...html.matchAll(/<style>/gi)].length, 1);
  assert.equal([...html.matchAll(/<h1>/gi)].length, 1);
});

test('openNoticeBoardOverlay invokes onBeforeOpen with 0 args before any DOM mutation', () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  let observed = null;

  openNoticeBoardOverlay({
    overlayEl,
    titleEl,
    iframeEl,
    onBeforeOpen: function () {
      observed = {
        argCount: arguments.length,
        title: titleEl.textContent,
        hidden: overlayEl.hidden,
        srcdoc: iframeEl.srcdoc,
      };
    },
  });

  assert.deepEqual(observed, {
    argCount: 0,
    title: '',
    hidden: true,
    srcdoc: '',
  });
});

test('openNoticeBoardOverlay propagates throwing onBeforeOpen and leaves overlay untouched', () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();

  assert.throws(() => {
    openNoticeBoardOverlay({
      overlayEl,
      titleEl,
      iframeEl,
      onBeforeOpen: () => {
        throw new Error('boom');
      },
    });
  }, /boom/);

  assert.equal(overlayEl.hidden, true);
  assert.equal(titleEl.textContent, '');
  assert.equal(iframeEl.srcdoc, '');
});

test('openNoticeBoardOverlay keeps pre-visible overlay visible and overwrites stale title, src, and srcdoc', () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  overlayEl.hidden = false;
  titleEl.textContent = 'Old Title';
  iframeEl.src = 'stale.html';
  iframeEl.srcdoc = 'stale doc';

  const html = openNoticeBoardOverlay({ overlayEl, titleEl, iframeEl });
  const expectedHtml = buildNoticeBoardOverlayHtml();

  assert.equal(overlayEl.hidden, false);
  assert.equal(titleEl.textContent, 'Notice Board');
  assert.equal(iframeEl.getAttribute('src'), null);
  assert.equal(iframeEl.srcdoc, html);
  assert.equal(html, expectedHtml);
});
