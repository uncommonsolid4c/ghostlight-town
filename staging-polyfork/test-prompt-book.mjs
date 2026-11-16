import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatPromptBookEntries, renderPromptBook } from './prompt-book.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROMPT_BOOK_PATH = path.join(__dirname, 'prompt-book.mjs');
const TOWN_JS_PATH = path.join(REPO_ROOT, 'town-3d', 'town.js');

function createFakeDoc() {
  const created = [];
  function makeNode(tagName) {
    const node = {
      tagName,
      className: '',
      _textContent: '',
      children: [],
      get firstChild() {
        return this.children[0] ?? null;
      },
      get textContent() {
        if (this.children.length === 0) return this._textContent;
        return this.children.map((c) => c.textContent).join('');
      },
      set textContent(val) {
        this._textContent = String(val);
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) this.children.splice(idx, 1);
        return child;
      },
    };
    return node;
  }

  return {
    created,
    createElement(tag) {
      const el = makeNode(tag);
      created.push(el);
      return el;
    },
    makeContainer() {
      return makeNode('div');
    },
  };
}

test('formatPromptBookEntries caps at last 100 entries in chronological order', () => {
  assert.deepEqual(formatPromptBookEntries(null), []);
  const entries = Array.from({ length: 120 }, (_, i) => ({
    id: i + 1,
    handle: `muse-${i + 1}`,
    kind: 'say',
    body: `line ${i + 1}`,
    role: 'muse',
  }));
  const formatted = formatPromptBookEntries(entries);
  assert.equal(formatted.length, 100);
  assert.equal(formatted[0].id, 21);
  assert.equal(formatted[99].id, 120);
  assert.equal(formatted[0].handle, 'muse-21');
  assert.equal(formatted[99].handle, 'muse-120');
});

test('renderPromptBook renders empty state when there are no remarks', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();
  container.appendChild(doc.createElement('p'));

  renderPromptBook(container, [], doc);

  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].tagName, 'p');
  assert.equal(container.children[0].className, 'pb-empty');
  assert.equal(container.children[0].textContent, 'No remarks yet in the last 24h.');
});

test('renderPromptBook renders [NPC] pill only for npc role, say vs emote, and reply-to threading', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  const entries = [
    { id: 10, handle: 'wick', kind: 'say', body: 'lanterns lit', role: 'npc', reply_to: null },
    { id: 11, handle: 'luna', kind: 'emote', body: 'waves from the steps', role: 'muse', reply_to: 10 },
    { id: 12, handle: 'sol', kind: 'say', body: 'missed the earlier note', role: 'muse', reply_to: 2 },
  ];

  renderPromptBook(container, entries, doc);
  assert.equal(container.children.length, 3);

  const [line0, line1, line2] = container.children;

  // Line 0: NPC say without reply_to
  assert.equal(line0.className, 'pb-line pb-kind-say');
  assert.equal(line0.children.map((c) => c.className).join(','), 'pb-npc-pill,pb-handle,pb-body');
  assert.equal(line0.children[0].textContent, '[NPC]');
  assert.equal(line0.children[1].textContent, 'wick');
  assert.equal(line0.children[2].textContent, ': lanterns lit');

  // Line 1: muse emote with in-window reply_to
  assert.equal(line1.className, 'pb-line pb-kind-emote');
  assert.equal(line1.children.map((c) => c.className).join(','), 'pb-reply-to,pb-handle,pb-body');
  assert.equal(line1.children[0].textContent, '\u21a9 #10 @wick');
  assert.equal(line1.children[1].textContent, 'luna');
  assert.equal(line1.children[2].textContent, ' waves from the steps');

  // Line 2: muse say with out-of-window reply_to -> bare #2
  assert.equal(line2.className, 'pb-line pb-kind-say');
  assert.equal(line2.children.map((c) => c.className).join(','), 'pb-reply-to,pb-handle,pb-body');
  assert.equal(line2.children[0].textContent, '\u21a9 #2');
  assert.equal(line2.children[1].textContent, 'sol');
  assert.equal(line2.children[2].textContent, ': missed the earlier note');
});

test('renderPromptBook treats HTML/script payloads as plain textContent and never uses innerHTML', async () => {
  const src = await fs.readFile(PROMPT_BOOK_PATH, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\.innerHTML\b/.test(codeOnly), 'prompt-book.mjs must never use innerHTML');

  const doc = createFakeDoc();
  const container = doc.makeContainer();
  const payload = '<script>alert(1)</script>';
  renderPromptBook(container, [{ id: 1, handle: 'ada', kind: 'say', body: payload, role: 'muse' }], doc);

  assert.equal(doc.created.some((el) => el.tagName === 'script'), false);
  const bodyEl = container.children[0].children.find((c) => c.className === 'pb-body');
  assert.equal(bodyEl.textContent, `: ${payload}`);
});

test('formatPromptBookEntries normalizes non-arrays, missing fields, invalid values, and null entries', () => {
  assert.deepEqual(formatPromptBookEntries(undefined), []);
  assert.deepEqual(formatPromptBookEntries({}), []);
  assert.deepEqual(formatPromptBookEntries('not-an-array'), []);

  const normalized = formatPromptBookEntries([
    {},
    null,
    { id: 1, handle: 42, kind: 'system', body: 99, reply_to: 1.5, created_at: 100, role: 'npc' },
    { id: 2, handle: 'maren', kind: 'shout', body: 'hi', reply_to: '3', role: 'admin' },
  ]);

  assert.deepEqual(normalized, [
    { id: null, handle: 'unknown', kind: 'say', body: '', reply_to: null, created_at: 0, role: 'muse' },
    { id: null, handle: 'unknown', kind: 'say', body: '', reply_to: null, created_at: 0, role: 'muse' },
    { id: 1, handle: 'unknown', kind: 'system', body: '', reply_to: null, created_at: 100, role: 'npc' },
    { id: 2, handle: 'maren', kind: 'say', body: 'hi', reply_to: null, created_at: 0, role: 'muse' },
  ]);
});

test('formatPromptBookEntries preserves 100 entries, drops only #1 at 101, and returns new objects without mutating input', () => {
  const exact100 = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    handle: `muse-${i + 1}`,
    kind: 'say',
    body: `note ${i + 1}`,
    role: 'muse',
  }));
  const kept100 = formatPromptBookEntries(exact100);
  assert.equal(kept100.length, 100);
  assert.equal(kept100[0].id, 1);
  assert.equal(kept100[99].id, 100);

  const input101 = Array.from({ length: 101 }, (_, i) => ({
    id: i + 1,
    handle: `muse-${i + 1}`,
    kind: 'say',
    body: `note ${i + 1}`,
    role: 'muse',
  }));
  const kept101 = formatPromptBookEntries(input101);
  assert.equal(kept101.length, 100);
  assert.equal(kept101[0].id, 2);
  assert.equal(kept101[99].id, 101);
  assert.equal(input101.length, 101);
  assert.equal(input101[0].id, 1);

  kept101[0].body = 'mutated';
  assert.equal(input101[1].body, 'note 2');
});

test('renderPromptBook guards null container/doc and clears stale children before rendering', () => {
  const doc = createFakeDoc();
  assert.equal(renderPromptBook(null, [{ id: 1, handle: 'ada', body: 'hi' }], doc), undefined);

  const container = doc.makeContainer();
  assert.equal(renderPromptBook(container, [{ id: 1, handle: 'ada', body: 'hi' }], null), undefined);
  assert.equal(container.children.length, 0);

  const stale = doc.createElement('div');
  stale.className = 'pb-line pb-stale';
  container.appendChild(stale);

  renderPromptBook(
    container,
    [
      { id: 1, handle: 'ada', kind: 'say', body: 'first', role: 'muse' },
      { id: 2, handle: 'tomas', kind: 'say', body: 'second', role: 'muse' },
    ],
    doc,
  );

  assert.equal(container.children.length, 2);
  assert.equal(container.children.includes(stale), false);
  assert.equal(container.children[0].children.find((c) => c.className === 'pb-handle').textContent, 'ada');
  assert.equal(container.children[1].children.find((c) => c.className === 'pb-handle').textContent, 'tomas');
});

test('renderPromptBook renders system kind with pb-kind-system, no NPC pill for muse, and say separator', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [{ id: 5, handle: 'bell', kind: 'system', body: 'dawn chimes', role: 'muse' }],
    doc,
  );

  assert.equal(container.children.length, 1);
  const line = container.children[0];
  assert.equal(line.className, 'pb-line pb-kind-system');
  assert.deepEqual(
    line.children.map((c) => c.className),
    ['pb-handle', 'pb-body'],
  );
  assert.equal(line.children[0].textContent, 'bell');
  assert.equal(line.children[1].textContent, ': dawn chimes');
});

test('renderPromptBook combines NPC pill with reply_to and resolves self-referential reply_to', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 20, handle: 'maren', kind: 'say', body: 'lantern check', role: 'muse', reply_to: null },
      { id: 21, handle: 'wick', kind: 'say', body: 'all lit', role: 'npc', reply_to: 20 },
      { id: 22, handle: 'tomas', kind: 'say', body: 'noting my own post', role: 'muse', reply_to: 22 },
    ],
    doc,
  );

  assert.equal(container.children.length, 3);
  const npcReplyLine = container.children[1];
  assert.deepEqual(
    npcReplyLine.children.map((c) => c.className),
    ['pb-npc-pill', 'pb-reply-to', 'pb-handle', 'pb-body'],
  );
  assert.equal(npcReplyLine.children[0].textContent, '[NPC]');
  assert.equal(npcReplyLine.children[1].textContent, '\u21a9 #20 @maren');
  assert.equal(npcReplyLine.children[2].textContent, 'wick');
  assert.equal(npcReplyLine.children[3].textContent, ': all lit');

  const selfReplyLine = container.children[2];
  assert.equal(selfReplyLine.children[0].className, 'pb-reply-to');
  assert.equal(selfReplyLine.children[0].textContent, '\u21a9 #22 @tomas');
});

test('renderPromptBook is idempotent across re-renders and stays verbatim in sync with town-3d/town.js', async () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 1, handle: 'ada', kind: 'say', body: 'old one', role: 'muse' },
      { id: 2, handle: 'sol', kind: 'say', body: 'old two', role: 'muse' },
    ],
    doc,
  );
  renderPromptBook(
    container,
    [{ id: 3, handle: 'luna', kind: 'say', body: 'fresh entry', role: 'muse' }],
    doc,
  );

  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].children.find((c) => c.className === 'pb-handle').textContent, 'luna');
  assert.equal(container.children[0].children.find((c) => c.className === 'pb-body').textContent, ': fresh entry');

  const [stagingSrc, townSrc] = await Promise.all([
    fs.readFile(PROMPT_BOOK_PATH, 'utf8'),
    fs.readFile(TOWN_JS_PATH, 'utf8'),
  ]);

  const extractFn = (src, name) => {
    const normalized = src.replace(/\r\n/g, '\n');
    const match = normalized.match(new RegExp(`export function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    return match ? match[0].trim() : null;
  };

  for (const fnName of ['formatPromptBookEntries', 'renderPromptBook']) {
    const stagingFn = extractFn(stagingSrc, fnName);
    const townFn = extractFn(townSrc, fnName);
    assert.ok(stagingFn, `staging-polyfork/prompt-book.mjs must export ${fnName}`);
    assert.ok(townFn, `town-3d/town.js must export ${fnName}`);
    assert.equal(stagingFn, townFn, `${fnName} drifted from town-3d/town.js`);
  }
});
