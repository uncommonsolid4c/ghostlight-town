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
