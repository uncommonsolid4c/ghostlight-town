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

test('NOTICE_BOARD_PAPERS 3D data stays structured: unique names, symmetric x offsets, line counts', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'notice-board-overlay.mjs'), 'utf8');
  const papersMatch = stagingSrc.match(/const NOTICE_BOARD_PAPERS = \[([\s\S]*?)\];/);
  assert.ok(papersMatch, 'notice-board-overlay.mjs must define NOTICE_BOARD_PAPERS');

  const entries = [...papersMatch[1].matchAll(
    /\['(notice_board_paper_\w+)',\s*(-?[\d.]+),\s*\[((?:'[^']*',?\s*)+)\]\]/g,
  )];
  assert.equal(entries.length, 3);

  const names = entries.map((m) => m[1]);
  const xOffsets = entries.map((m) => Number(m[2]));
  const entryLines = entries.map((m) => [...m[3].matchAll(/'([^']*)'/g)].map((lm) => lm[1]));

  assert.deepEqual(names, [
    'notice_board_paper_gazette',
    'notice_board_paper_inn',
    'notice_board_paper_gate',
  ]);
  assert.deepEqual(xOffsets, [-0.6, 0, 0.6]);
  assert.deepEqual(entryLines.map((lines) => lines.length), [4, 4, 5]);
  for (const lines of entryLines) {
    assert.ok(lines.length >= 4, 'each notice entry must have at least 4 lines');
  }

  const html = buildNoticeBoardOverlayHtml();
  const bodies = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(bodies, entryLines.map((lines) => lines.slice(1).join(' ')));
});

test('buildNoticeBoardOverlayHtml shell is exact: one of each tag, no blank lines, no trailing newline', () => {
  const html = buildNoticeBoardOverlayHtml();

  for (const tag of [
    '<html lang="en">',
    '<head>',
    '</head>',
    '<body>',
    '</body>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>',
    '</title>',
  ]) {
    assert.equal(html.split(tag).length - 1, 1, `expected exactly one ${tag}`);
  }

  assert.equal(/\n\n/.test(html), false, 'overlay HTML must contain no blank lines');
  assert.ok(html.endsWith('</html>') && !html.endsWith('\n'));

  for (const [, body] of html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
    assert.equal(body, body.trim());
    assert.equal(/  /.test(body), false, 'notice body must contain no double spaces');
  }
  for (const [, title] of html.matchAll(/<h2>([\s\S]*?)<\/h2>/g)) {
    assert.equal(title, title.trim());
  }
});

test('openNoticeBoardOverlay applies DOM mutations in order: title, sandbox, remove src, srcdoc, unhide', () => {
  const order = [];
  const overlayEl = {
    set hidden(_v) {
      order.push('hidden');
    },
  };
  const titleEl = {
    set textContent(_v) {
      order.push('title');
    },
  };
  const iframeEl = {
    setAttribute(k, _v) {
      order.push(`setAttribute:${k}`);
    },
    removeAttribute(k) {
      order.push(`removeAttribute:${k}`);
    },
    set srcdoc(_v) {
      order.push('srcdoc');
    },
  };

  const html = openNoticeBoardOverlay({ overlayEl, titleEl, iframeEl });
  assert.deepEqual(order, [
    'title',
    'setAttribute:sandbox',
    'removeAttribute:src',
    'srcdoc',
    'hidden',
  ]);
  assert.equal(typeof html, 'string');
  assert.equal(html, buildNoticeBoardOverlayHtml());
});

test('openNoticeBoardOverlay(undefined) returns null; null throws TypeError; onBeforeOpen return value ignored', () => {
  assert.equal(openNoticeBoardOverlay(undefined), null);
  assert.throws(() => openNoticeBoardOverlay(null), TypeError);

  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  const html = openNoticeBoardOverlay({
    overlayEl,
    titleEl,
    iframeEl,
    onBeforeOpen: () => 'ignored-value',
  });

  assert.equal(typeof html, 'string');
  assert.equal(overlayEl.hidden, false);
  assert.equal(titleEl.textContent, 'Notice Board');
  assert.equal(iframeEl.srcdoc, html);
});

test("openNoticeBoardOverlay overwrites a stale sandbox value and calls removeAttribute('src') exactly once", () => {
  const attrs = new Map();
  const setAttrs = [];
  const removed = [];
  const overlayEl = { hidden: true };
  const titleEl = { textContent: '' };
  const iframeEl = {
    _src: '',
    _srcdoc: '',
    setAttribute(k, v) {
      const val = String(v);
      attrs.set(k, val);
      setAttrs.push([k, val]);
    },
    getAttribute(k) {
      return attrs.has(k) ? attrs.get(k) : null;
    },
    removeAttribute(k) {
      attrs.delete(k);
      removed.push(k);
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

  iframeEl.setAttribute('sandbox', 'allow-scripts');
  iframeEl.src = 'stale.html';
  setAttrs.length = 0;

  openNoticeBoardOverlay({ overlayEl, titleEl, iframeEl });

  assert.equal(iframeEl.getAttribute('sandbox'), '');
  assert.deepEqual(setAttrs, [['sandbox', '']]);
  assert.deepEqual(removed, ['src']);
  assert.equal(iframeEl.getAttribute('src'), null);
});

test('buildNoticeBoardOverlayHtml style block has exactly the four pinned rules in order; exactly three em-dashes', () => {
  const html = buildNoticeBoardOverlayHtml();
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(styleMatch, 'overlay HTML must include a <style> block');
  const css = styleMatch[1];

  assert.equal((css.match(/\{/g) || []).length, 4);
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  assert.deepEqual(selectors, ['body', 'h1', 'h2', '.notice p']);

  assert.equal((html.match(/—/g) || []).length, 3);
  assert.equal(/[‘’“”]/.test(html), false, 'overlay HTML must contain no curly quotes');
});

test('openNoticeBoardOverlay missing-element guard runs before onBeforeOpen and mutates nothing', () => {
  const cases = [
    (els) => ({ titleEl: els.titleEl, iframeEl: els.iframeEl }),
    (els) => ({ overlayEl: els.overlayEl, iframeEl: els.iframeEl }),
    (els) => ({ overlayEl: els.overlayEl, titleEl: els.titleEl }),
  ];

  for (const pick of cases) {
    const els = makeFakeOverlayElements();
    const partial = pick(els);
    const result = openNoticeBoardOverlay({
      ...partial,
      onBeforeOpen: () => {
        throw new Error('must not be called');
      },
    });
    assert.equal(result, null);
    if (partial.overlayEl) assert.equal(partial.overlayEl.hidden, true);
    if (partial.titleEl) assert.equal(partial.titleEl.textContent, '');
    if (partial.iframeEl) {
      assert.equal(partial.iframeEl.srcdoc, '');
      assert.equal(partial.iframeEl.getAttribute('sandbox'), null);
    }
  }
});

test('openNoticeBoardOverlay throwing onBeforeOpen leaves stale sandbox and src intact', () => {
  const { overlayEl, titleEl, iframeEl } = makeFakeOverlayElements();
  iframeEl.setAttribute('sandbox', 'allow-scripts');
  iframeEl.src = 'stale.html';

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

  assert.equal(iframeEl.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(iframeEl.getAttribute('src'), 'stale.html');
  assert.equal(iframeEl.srcdoc, '');
  assert.equal(overlayEl.hidden, true);
  assert.equal(titleEl.textContent, '');
});

test('buildNoticeBoardOverlayHtml renders the three sections with exact indentation and markup', () => {
  const html = buildNoticeBoardOverlayHtml();
  const expectedSections = [
    '  <section class="notice">\n    <h2>GAZETTE #2</h2>\n    <p>Issue #2 is out — read it at the newsstand.</p>\n  </section>',
    '  <section class="notice">\n    <h2>THE INN</h2>\n    <p>Rooms for short stays — ask at the tavern.</p>\n  </section>',
    '  <section class="notice">\n    <h2>SOCIAL GATE</h2>\n    <p>Plots are free, no upkeep — yours outright. Bring a friend.</p>\n  </section>',
  ];

  for (const section of expectedSections) {
    assert.ok(html.includes(section), `overlay HTML must include section:\n${section}`);
  }
  assert.equal(html.split('<section class="notice">').length - 1, 3);
});

test('buildNoticeBoardOverlayHtml is deterministic and its h1 matches the overlay title', () => {
  const html1 = buildNoticeBoardOverlayHtml();
  const html2 = buildNoticeBoardOverlayHtml();
  assert.equal(html1, html2);

  const els = makeFakeOverlayElements();
  const returned = openNoticeBoardOverlay(els);
  const h1Match = returned.match(/<h1>([\s\S]*?)<\/h1>/);
  assert.ok(h1Match, 'overlay HTML must include an <h1> element');
  assert.equal(h1Match[1], els.titleEl.textContent);
  assert.equal(h1Match[1], 'Notice Board');
});

test('buildNoticeBoardOverlayHtml lines have no trailing whitespace and sections join on single newlines', () => {
  const html = buildNoticeBoardOverlayHtml();
  for (const line of html.split('\n')) {
    assert.equal(line, line.trimEnd(), `line must have no trailing whitespace: ${JSON.stringify(line)}`);
  }
  assert.equal(html.split('</section>\n  <section class="notice">').length - 1, 2);
  assert.equal(/\n\n/.test(html), false);
});

test('openNoticeBoardOverlay opens two different element sets to the same html with no cross-element leakage', () => {
  const elsA = makeFakeOverlayElements();
  const elsB = makeFakeOverlayElements();
  const expectedHtml = buildNoticeBoardOverlayHtml();

  const htmlA = openNoticeBoardOverlay(elsA);
  const htmlB = openNoticeBoardOverlay(elsB);

  assert.equal(htmlA, expectedHtml);
  assert.equal(htmlB, expectedHtml);
  assert.equal(elsA.iframeEl.srcdoc, expectedHtml);
  assert.equal(elsB.iframeEl.srcdoc, expectedHtml);
  assert.equal(elsA.overlayEl.hidden, false);
  assert.equal(elsB.overlayEl.hidden, false);
});

test('buildNoticeBoardOverlayHtml <style> block text matches verbatim literal', () => {
  const html = buildNoticeBoardOverlayHtml();
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(match, 'overlay HTML must include a <style> block');
  assert.equal(
    match[1],
    '\n    body { font-family: Georgia, serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #2b2118; background: #f5efe0; line-height: 1.6; }\n    h1 { font-size: 1.35rem; border-bottom: 1px solid #6b492b; padding-bottom: 0.4rem; }\n    h2 { font-size: 1.05rem; margin-top: 1.4rem; margin-bottom: 0.3rem; color: #5a4332; }\n    .notice p { margin: 0; }\n  ',
  );
});

test('buildNoticeBoardOverlayHtml document elements appear in strict order with head before body', () => {
  const html = buildNoticeBoardOverlayHtml();
  const needles = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Notice Board</title>',
    '<style>',
    '</style>',
    '</head>',
    '<body>',
    '<h1>Notice Board</h1>',
    '<section class="notice">',
    '</body>',
    '</html>',
  ];
  let prevIdx = -1;
  for (const needle of needles) {
    const idx = html.indexOf(needle);
    assert.ok(idx > prevIdx, `expected "${needle}" (idx=${idx}) after prevIdx=${prevIdx}`);
    prevIdx = idx;
  }
});

test('buildNoticeBoardOverlayHtml contains no ampersands or entities and keeps em-dashes literal', () => {
  const html = buildNoticeBoardOverlayHtml();
  assert.equal(/&/.test(html), false);
  assert.equal(/&[a-z]+;|&#\d+;/.test(html), false);
  assert.equal((html.match(/—/g) || []).length, 3);
  assert.equal(/&mdash;/.test(html), false);
});

test('openNoticeBoardOverlay rejects falsy elements before onBeforeOpen and mutates nothing', () => {
  const shared = makeFakeOverlayElements();
  const onBeforeOpen = () => {
    throw new Error('must not be called');
  };
  const badInputs = [
    { overlayEl: 0, titleEl: shared.titleEl, iframeEl: shared.iframeEl, onBeforeOpen },
    { overlayEl: shared.overlayEl, titleEl: '', iframeEl: shared.iframeEl, onBeforeOpen },
    { overlayEl: shared.overlayEl, titleEl: shared.titleEl, iframeEl: false, onBeforeOpen },
    { overlayEl: null, titleEl: shared.titleEl, iframeEl: shared.iframeEl, onBeforeOpen },
  ];
  for (const input of badInputs) {
    assert.equal(openNoticeBoardOverlay(input), null);
  }
  assert.equal(shared.overlayEl.hidden, true);
  assert.equal(shared.titleEl.textContent, '');
  assert.equal(shared.iframeEl.srcdoc, '');

  const fresh = makeFakeOverlayElements();
  const html = openNoticeBoardOverlay({ ...fresh, onBeforeOpen: undefined });
  assert.equal(html, buildNoticeBoardOverlayHtml());
  assert.equal(fresh.overlayEl.hidden, false);
});

test('openNoticeBoardOverlay invokes async onBeforeOpen without awaiting and ignores its return', () => {
  const els = makeFakeOverlayElements();
  let flag = false;
  const html = openNoticeBoardOverlay({
    ...els,
    onBeforeOpen: async () => {
      flag = true;
    },
  });
  assert.equal(typeof html, 'string');
  assert.equal(flag, true);
  assert.equal(els.overlayEl.hidden, false);
  assert.equal(els.iframeEl.srcdoc, html);
});

test('openNoticeBoardOverlay invokes only the per-call onBeforeOpen without retaining stale callbacks', () => {
  const els = makeFakeOverlayElements();
  let a = 0;
  let b = 0;
  openNoticeBoardOverlay({
    ...els,
    onBeforeOpen: () => {
      a += 1;
    },
  });
  openNoticeBoardOverlay({
    ...els,
    onBeforeOpen: () => {
      b += 1;
    },
  });
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('openNoticeBoardOverlay propagates throwing titleEl.textContent setter and leaves iframe and overlay untouched', () => {
  const { overlayEl, iframeEl } = makeFakeOverlayElements();
  const titleEl = {
    get textContent() {
      return '';
    },
    set textContent(_v) {
      throw new Error('title-boom');
    },
  };
  assert.throws(() => openNoticeBoardOverlay({ overlayEl, titleEl, iframeEl }), /title-boom/);
  assert.equal(overlayEl.hidden, true);
  assert.equal(iframeEl.getAttribute('sandbox'), null);
  assert.equal(iframeEl.srcdoc, '');
  assert.equal(iframeEl.getAttribute('src'), null);
});

test('notice-board-overlay.mjs NOTICE_BOARD_PAPERS line arrays match expected literals', async () => {
  const src = await fs.readFile(path.join(__dirname, 'notice-board-overlay.mjs'), 'utf8');
  const blockMatch = src.match(/const NOTICE_BOARD_PAPERS = \[([\s\S]*?)\];/);
  assert.ok(blockMatch, 'NOTICE_BOARD_PAPERS block must exist');
  const entryRe = /\['(notice_board_paper_\w+)',\s*(-?[\d.]+),\s*\[((?:'[^']*',?\s*)+)\]\]/g;
  const parsedLines = [];
  for (const match of blockMatch[1].matchAll(entryRe)) {
    const lines = [...match[3].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    parsedLines.push(lines);
  }
  assert.deepEqual(parsedLines, [
    ['GAZETTE #2', 'Issue #2 is out —', 'read it at the', 'newsstand.'],
    ['THE INN', 'Rooms for short', 'stays — ask at', 'the tavern.'],
    ['SOCIAL GATE', 'Plots are free,', 'no upkeep — yours', 'outright. Bring a', 'friend.'],
  ]);
});

test('openNoticeBoardOverlay ignores extra option keys and opens normally when onBeforeOpen is null or undefined', () => {
  const elsA = makeFakeOverlayElements();
  const expected = buildNoticeBoardOverlayHtml();
  const htmlA = openNoticeBoardOverlay({
    ...elsA,
    extra: 'x',
    unused: { a: 1 },
    onBeforeOpen: null,
  });
  assert.equal(htmlA, expected);
  assert.equal(elsA.overlayEl.hidden, false);

  const elsB = makeFakeOverlayElements();
  const htmlB = openNoticeBoardOverlay({
    ...elsB,
    onBeforeOpen: undefined,
  });
  assert.equal(htmlB, expected);
  assert.equal(elsB.overlayEl.hidden, false);
});

test('buildNoticeBoardOverlayHtml has exactly one em-dash in each of the three <p> bodies', () => {
  const html = buildNoticeBoardOverlayHtml();
  const bodies = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  assert.equal(bodies.length, 3);
  for (const body of bodies) {
    assert.equal(
      (body.match(/—/g) || []).length,
      1,
      `expected exactly 1 em-dash in <p> body: ${JSON.stringify(body)}`,
    );
  }
});

test('staging.js NOTICE_BOARD_PAPERS third copy matches the overlay and town.js copies', async () => {
  const [stagingSrc, overlaySrc, townSrc] = await Promise.all([
    fs.readFile(path.join(__dirname, 'staging.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'notice-board-overlay.mjs'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
  ]);
  const re = /const NOTICE_BOARD_PAPERS = \[([\s\S]*?)\];/;
  const stagingBlock = stagingSrc.match(re);
  const overlayBlock = overlaySrc.match(re);
  const townBlock = townSrc.match(re);
  assert.ok(stagingBlock, 'staging.js must define NOTICE_BOARD_PAPERS');
  assert.ok(overlayBlock, 'notice-board-overlay.mjs must define NOTICE_BOARD_PAPERS');
  assert.ok(townBlock, 'town-3d/town.js must define NOTICE_BOARD_PAPERS');
  assert.equal(stagingBlock[0], overlayBlock[0]);
  assert.equal(stagingBlock[0], townBlock[0]);
});

test('notice-board-overlay.mjs escapeHtml source stays verbatim with five ordered replaces', async () => {
  const overlaySrc = await fs.readFile(path.join(__dirname, 'notice-board-overlay.mjs'), 'utf8');
  const match = overlaySrc.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'notice-board-overlay.mjs must define escapeHtml');
  assert.deepEqual(
    match[0],
    [
      'function escapeHtml(value) {',
      "  return String(value ?? '')",
      "    .replace(/&/g, '&amp;')",
      "    .replace(/</g, '&lt;')",
      "    .replace(/>/g, '&gt;')",
      '    .replace(/"/g, \'&quot;\')',
      "    .replace(/'/g, '&#39;');",
      '}',
    ].join('\n'),
  );
  assert.ok(overlaySrc.includes("const title = escapeHtml(lines[0] ?? '');"));
  assert.ok(overlaySrc.includes("const body = escapeHtml(lines.slice(1).join(' '));"));
});

test('staging.js buildNoticeBoard pins posts, panel, papers, and noticeBoard layout', async () => {
  const [stagingSrc, townSrc] = await Promise.all([
    fs.readFile(path.join(__dirname, 'staging.js'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
  ]);
  const needles = [
    '  const { x, z } = TOWN_LAYOUT.noticeBoard;',
    "  group.name = 'town_notice_board';",
    '  group.rotation.y = Math.atan2(-x, -z);',
    "  group.userData = { clickable: true, kind: 'notice_board', label: 'Notice Board' };",
    "  const woodMat = new THREE.MeshStandardMaterial({ color: '#6b492b', roughness: 0.88 });",
    '  const postGeo = new THREE.BoxGeometry(0.12, 2.2, 0.12);',
    '  for (const postX of [-0.95, 0.95]) {',
    '    post.position.set(postX, 1.1, 0);',
    "  const panelTex = makeBandstandTextTexture(THREE, ['NOTICE BOARD'], {",
    '    titleSize: 44,',
    '  const panel = new THREE.Mesh(',
    '    new THREE.BoxGeometry(2.2, 1.3, 0.08),',
    '  panel.position.set(0, 1.35, 0);',
    '  const paperGeo = new THREE.BoxGeometry(0.5, 0.7, 0.02);',
    '    paper.position.set(paperX, 1.35, 0.06);',
  ];
  for (const needle of needles) {
    assert.ok(stagingSrc.includes(needle), `staging.js must include line: ${needle}`);
  }
  const layoutMatch = townSrc.match(
    /noticeBoard: \{\n    x: (-?[\d.]+),\n    y: (-?[\d.]+),\n    z: (-?[\d.]+),\n  \}/,
  );
  assert.ok(layoutMatch, 'town-3d/town.js must define TOWN_LAYOUT.noticeBoard');
  assert.deepEqual(
    [Number(layoutMatch[1]), Number(layoutMatch[2]), Number(layoutMatch[3])],
    [-6, 0, 14],
  );
});

test('staging.js notice_board click branch opens the overlay with plot elements and returns true', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const expectedBlock = [
    "        if (kind === 'notice_board') {",
    '          if (infoStripEl) infoStripEl.hidden = true;',
    '          currentPlotHandle = null;',
    '          setPlotTabs(null);',
    '          openNoticeBoardOverlay({',
    '            overlayEl: plotOverlayEl,',
    '            titleEl: plotOverlayTitleEl,',
    '            iframeEl: plotIframeEl,',
    '            onBeforeOpen: onBeforeOverlayOpen,',
    '          });',
    '          return true;',
    '        }',
  ].join('\n');
  assert.ok(stagingSrc.includes(expectedBlock), 'staging.js must include the exact notice_board click branch');
});

test('staging.js notice-board-overlay import is unversioned with exactly one call site', async () => {
  const [stagingSrc, indexHtml] = await Promise.all([
    fs.readFile(path.join(__dirname, 'staging.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8'),
  ]);
  const lines = stagingSrc.split('\n');
  assert.deepEqual(
    lines[60],
    "import { openNoticeBoardOverlay } from './notice-board-overlay.mjs';",
  );
  assert.equal((stagingSrc.match(/openNoticeBoardOverlay\(/g) || []).length, 1);
  assert.equal(stagingSrc.includes('notice-board-overlay.mjs?v='), false);
  assert.equal(indexHtml.includes('notice-board-overlay'), false);
});

test('buildNoticeBoardOverlayHtml has exact byte length, line count, and shell line positions', () => {
  const html = buildNoticeBoardOverlayHtml();
  const lines = html.split('\n');
  assert.equal(Buffer.byteLength(html, 'utf8'), 978);
  assert.equal(html.length, 972);
  assert.equal(lines.length, 29);
  assert.equal(lines[0], '<!doctype html>');
  assert.equal(lines[1], '<html lang="en">');
  assert.equal(lines[2], '<head>');
  assert.equal(lines[3], '  <meta charset="utf-8">');
  assert.equal(lines[14], '  <h1>Notice Board</h1>');
  assert.equal(lines[28], '</html>');
});

test('openNoticeBoardOverlay opens normally for non-function truthy and falsy onBeforeOpen values', () => {
  const expectedHtml = buildNoticeBoardOverlayHtml();
  for (const onBeforeOpen of [42, {}, [], 0, '']) {
    const els = makeFakeOverlayElements();
    const html = openNoticeBoardOverlay({ ...els, onBeforeOpen });
    assert.equal(html, expectedHtml);
    assert.equal(els.overlayEl.hidden, false);
    assert.equal(els.iframeEl.srcdoc, html);
  }
});

test('openNoticeBoardOverlay accepts plain-object elements but throws for a plain iframe object', () => {
  const expectedHtml = buildNoticeBoardOverlayHtml();

  const els1 = makeFakeOverlayElements();
  const html1 = openNoticeBoardOverlay({ overlayEl: {}, titleEl: {}, iframeEl: els1.iframeEl });
  assert.equal(html1, expectedHtml);

  const els2 = makeFakeOverlayElements();
  const html2 = openNoticeBoardOverlay({
    overlayEl: els2.overlayEl,
    titleEl: {},
    iframeEl: els2.iframeEl,
  });
  assert.equal(html2, expectedHtml);

  const els3 = makeFakeOverlayElements();
  assert.throws(
    () => openNoticeBoardOverlay({ overlayEl: els3.overlayEl, titleEl: els3.titleEl, iframeEl: {} }),
    TypeError,
  );
});

test('notice paper x-order matches the overlay h2 order left to right', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const papersMatch = stagingSrc.match(/const NOTICE_BOARD_PAPERS = \[([\s\S]*?)\];/);
  assert.ok(papersMatch, 'staging.js must define NOTICE_BOARD_PAPERS');

  const entryRe = /\['(notice_board_paper_\w+)',\s*(-?[\d.]+),\s*\[((?:'[^']*',?\s*)+)\]\]/g;
  const entries = [...papersMatch[1].matchAll(entryRe)].map((m) => ({
    x: Number(m[2]),
    lines: [...m[3].matchAll(/'([^']*)'/g)].map((lm) => lm[1]),
  }));
  entries.sort((a, b) => a.x - b.x);
  const orderedTitles = entries.map((e) => e.lines[0]);

  const html = buildNoticeBoardOverlayHtml();
  const h2Titles = [...html.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(orderedTitles, h2Titles);
  assert.deepEqual(h2Titles, ['GAZETTE #2', 'THE INN', 'SOCIAL GATE']);
});

test('file hygiene: 47 unique names, 6 imports, pinned as-true counts', async () => {
  const src = await fs.readFile(new URL(import.meta.url), 'utf8');
  const lines = src.split('\n');

  const singleQuoted = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  const doubleQuoted = [...src.matchAll(/^test\("([^"]+)",/gm)].map((m) => m[1]);
  assert.equal(singleQuoted.length, 56);
  assert.equal(doubleQuoted.length, 1);
  assert.equal(new Set([...singleQuoted, ...doubleQuoted]).size, 57);

  const importLines = lines.filter((line) => line.startsWith('import '));
  assert.equal(importLines.length, 6);
  assert.deepEqual(lines.slice(0, 5), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
  ]);
  assert.deepEqual(lines.slice(6, 10), [
    'import {',
    '  buildNoticeBoardOverlayHtml,',
    '  openNoticeBoardOverlay,',
    "} from './notice-board-overlay.mjs';",
  ]);

  const bannedTerm = 'camp' + 'fire';
  const todoNeedle = 'TO' + 'DO';
  const fixmeNeedle = 'FIX' + 'ME';
  const dateNowRe = new RegExp('Date' + '.now');
  const mathRandomRe = new RegExp('Math' + '.random');
  const fetchNeedle = 'fet' + 'ch(';

  assert.equal(lines.filter((l) => l.toLowerCase().includes(bannedTerm)).length, 0);
  assert.equal(lines.filter((l) => l.includes(todoNeedle)).length, 0);
  assert.equal(lines.filter((l) => l.includes(fixmeNeedle)).length, 0);
  assert.equal(lines.filter((l) => dateNowRe.test(l)).length, 0);
  assert.equal(lines.filter((l) => mathRandomRe.test(l)).length, 0);
  assert.equal(lines.filter((l) => l.includes(fetchNeedle)).length, 0);
});

test('town-3d/town.js and staging.js buildNoticeBoard agree on placement and diverge only on the texture helper', async () => {
  const [townSrc, stagingSrc] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8'),
    fs.readFile(path.join(__dirname, 'staging.js'), 'utf8'),
  ]);
  const bodyRe = /function buildNoticeBoard\(THREE\) \{([\s\S]*?)\n  return group;\n\}/;
  const townBody = townSrc.match(bodyRe);
  const stagingBody = stagingSrc.match(bodyRe);
  assert.ok(townBody, 'town-3d/town.js must define buildNoticeBoard');
  assert.ok(stagingBody, 'staging.js must define buildNoticeBoard');
  assert.ok(townBody[1].includes('  group.position.set(x, 0, z);'));
  assert.ok(stagingBody[1].includes('  group.position.set(x, 0, z);'));
  assert.ok(townBody[1].includes('  group.rotation.y = Math.atan2(-x, -z);'));
  assert.ok(stagingBody[1].includes('  group.rotation.y = Math.atan2(-x, -z);'));
  assert.ok(townBody[1].includes("  const panelTex = makeTextTexture(THREE, ['NOTICE BOARD'], {"));
  assert.equal(townBody[1].includes('makeBandstandTextTexture'), false);
  assert.ok(stagingBody[1].includes("  const panelTex = makeBandstandTextTexture(THREE, ['NOTICE BOARD'], {"));
  assert.equal(stagingBody[1].includes('makeTextTexture('), false);
});

test('town-3d/town.js buildNoticeBoard paper and panel texture blocks stay verbatim', async () => {
  const townSrc = await fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8');
  const body = townSrc.match(/function buildNoticeBoard\(THREE\) \{([\s\S]*?)\n  return group;\n\}/);
  assert.ok(body, 'town-3d/town.js must define buildNoticeBoard');
  assert.ok(body[1].includes([
    "  const panelTex = makeTextTexture(THREE, ['NOTICE BOARD'], {",
    '    width: 512,',
    '    height: 304,',
    '    titleSize: 44,',
    "    bg: '#3b2b1d',",
    "    border: '#7d5a3c',",
    '  });',
  ].join('\n')));
  assert.ok(body[1].includes([
    '    const paperTex = makeTextTexture(THREE, lines, {',
    '      width: 256,',
    '      height: 358,',
    '      titleSize: 30,',
    '      subSize: 20,',
    "      bg: '#f5efe0',",
    "      fg: '#2e2218',",
    "      border: '#8b6a4b',",
    '    });',
    '    const paper = new THREE.Mesh(',
    '      paperGeo,',
    '      new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.9 })',
    '    );',
    '    paper.name = name;',
    '    paper.position.set(paperX, 1.35, 0.06);',
    '    group.add(paper);',
  ].join('\n')));
});

test('staging.js buildNoticeBoard paper and panel texture blocks stay verbatim with makeBandstandTextTexture', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const body = stagingSrc.match(/function buildNoticeBoard\(THREE\) \{([\s\S]*?)\n  return group;\n\}/);
  assert.ok(body, 'staging.js must define buildNoticeBoard');
  assert.ok(body[1].includes([
    "  const panelTex = makeBandstandTextTexture(THREE, ['NOTICE BOARD'], {",
    '    width: 512,',
    '    height: 304,',
    '    titleSize: 44,',
    "    bg: '#3b2b1d',",
    "    border: '#7d5a3c',",
    '  });',
  ].join('\n')));
  assert.ok(body[1].includes([
    '    const paperTex = makeBandstandTextTexture(THREE, lines, {',
    '      width: 256,',
    '      height: 358,',
    '      titleSize: 30,',
    '      subSize: 20,',
    "      bg: '#f5efe0',",
    "      fg: '#2e2218',",
    "      border: '#8b6a4b',",
    '    });',
    '    const paper = new THREE.Mesh(',
    '      paperGeo,',
    '      new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.9 })',
    '    );',
    '    paper.name = name;',
    '    paper.position.set(paperX, 1.35, 0.06);',
    '    group.add(paper);',
  ].join('\n')));
});

test('town-3d/town.js buildTown wires the notice board between the newsstand and the inn', async () => {
  const townSrc = await fs.readFile(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8');
  const block = [
    '  // Town Notice Board',
    '  const noticeBoard = buildNoticeBoard(THREE);',
    '  scene.add(noticeBoard);',
  ].join('\n');
  assert.ok(townSrc.includes(block));
  assert.ok(townSrc.indexOf('  scene.add(newsstand);') < townSrc.indexOf(block));
  assert.ok(townSrc.indexOf(block) < townSrc.indexOf('  // Ghostlight Inn (southwest clearing near the gate)'));
});

test('staging.js positions the notice board with camp.groundAt and adds it to the scene', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  assert.ok(stagingSrc.includes([
    '  const noticeBoard = buildNoticeBoard(THREE);',
    '  noticeBoard.position.set(',
    '    TOWN_LAYOUT.noticeBoard.x,',
    '    camp.groundAt(TOWN_LAYOUT.noticeBoard.x, TOWN_LAYOUT.noticeBoard.z),',
    '    TOWN_LAYOUT.noticeBoard.z',
    '  );',
    '  scene.add(noticeBoard);',
  ].join('\n')));
});

test('staging.js notice board layout, terrain pad, and pine keepClear entry agree on (-6, 14)', async () => {
  const [avatarSrc, stagingSrc] = await Promise.all([
    fs.readFile(path.join(__dirname, 'avatar.mjs'), 'utf8'),
    fs.readFile(path.join(__dirname, 'staging.js'), 'utf8'),
  ]);
  assert.ok(avatarSrc.includes([
    '  noticeBoard: {',
    '    x: -6,',
    '    y: 0,',
    '    z: 14,',
    '  },',
  ].join('\n')));
  const avatarImport = stagingSrc.match(/import \{[^}]*\} from '\.\/avatar\.mjs\?v=28';/);
  assert.ok(avatarImport, 'staging.js must import from avatar.mjs');
  assert.ok(avatarImport[0].includes('  TOWN_LAYOUT,'));
  assert.ok(stagingSrc.includes([
    '    { x: -186, z: 398, w: 4, d: 4 },   // newsstand (6, 14)',
    '    { x: -198, z: 398, w: 4, d: 4 },   // notice board (-6, 14)',
  ].join('\n')));
  assert.ok(stagingSrc.includes('    [0, 27, 8], [6, 8, 7], [TOWN_LAYOUT.newsstand.x, TOWN_LAYOUT.newsstand.z, 5], [-6, 14, 5], [-22, -20, 11],'));
  assert.equal((stagingSrc.match(/\[-6, 14, 5\]/g) || []).length, 1);
});

test('town-3d/index.html openNoticeBoardOverlay resets input state and opens the board without a callback', async () => {
  const indexHtml = await fs.readFile(path.join(REPO_ROOT, 'town-3d', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes([
    '    function openNoticeBoardOverlay() {',
    '      keys.clear();',
    '      glideTarget = null;',
    '      activePointers.clear();',
    '      isDragging = false;',
    "      canvas.classList.remove('dragging');",
    '      currentPlotHandle = null;',
    '      setPlotTabs(null);',
    '      infoStrip.hidden = true;',
    "      plotOverlayTitle.textContent = 'Notice Board';",
    "      plotIframe.setAttribute('sandbox', '');",
    "      plotIframe.removeAttribute('src');",
    '      plotIframe.srcdoc = buildNoticeBoardOverlayHtml();',
    '      plotOverlay.hidden = false;',
    '    }',
  ].join('\n')));
  const fnStart = indexHtml.indexOf('    function openNoticeBoardOverlay() {');
  const fnEnd = indexHtml.indexOf('\n    }', fnStart);
  const fnBody = indexHtml.slice(fnStart, fnEnd);
  assert.equal(fnBody.includes('onBeforeOpen'), false);
  assert.equal(fnBody.includes('return'), false);
  assert.equal((indexHtml.match(/buildNoticeBoardOverlayHtml/g) || []).length, 2);
  assert.equal((indexHtml.match(/openNoticeBoardOverlay/g) || []).length, 2);
});

test('town-3d/index.html notice_board click branch opens the overlay between the newsstand and inn branches', async () => {
  const indexHtml = await fs.readFile(path.join(REPO_ROOT, 'town-3d', 'index.html'), 'utf8');
  const block = [
    "          if (kind === 'notice_board') {",
    '            infoStrip.hidden = true;',
    '            openNoticeBoardOverlay();',
    '            return true;',
    '          }',
  ].join('\n');
  assert.ok(indexHtml.includes(block));
  assert.ok(indexHtml.indexOf("if (kind === 'newsstand')") < indexHtml.indexOf(block));
  assert.ok(indexHtml.indexOf(block) < indexHtml.indexOf("if (kind === 'inn')"));
});

test('openNoticeBoardOverlay overwrites onBeforeOpen mutations and touches nothing else on the title or overlay', () => {
  const els = makeFakeOverlayElements();
  const expected = buildNoticeBoardOverlayHtml();
  const html = openNoticeBoardOverlay({
    ...els,
    onBeforeOpen: () => {
      els.overlayEl.hidden = true;
      els.titleEl.textContent = 'Stale title';
      els.iframeEl.srcdoc = 'stale doc';
      els.iframeEl.src = 'stale-src';
    },
  });
  assert.equal(html, expected);
  assert.equal(els.overlayEl.hidden, false);
  assert.equal(els.titleEl.textContent, 'Notice Board');
  assert.equal(els.iframeEl.srcdoc, expected);
  assert.equal(els.iframeEl.src, undefined);
  assert.equal(els.titleEl.hidden, true);
  assert.equal(els.overlayEl.getAttribute('sandbox'), null);
});

test('notice-board-overlay.mjs exports exactly the two overlay functions and keeps its data private', async () => {
  const src = await fs.readFile(path.join(__dirname, 'notice-board-overlay.mjs'), 'utf8');
  assert.deepEqual(src.match(/^export function (\w+)/gm), [
    'export function buildNoticeBoardOverlayHtml',
    'export function openNoticeBoardOverlay',
  ]);
  assert.equal(src.includes('export default'), false);
  assert.equal(src.includes('export const NOTICE_BOARD_PAPERS'), false);
  assert.equal(src.includes('export function escapeHtml'), false);
  assert.equal(src.includes('export {'), false);
});
