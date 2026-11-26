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

test('formatPromptBookEntries passes created_at through verbatim and preserves id 0', () => {
  const formatted = formatPromptBookEntries([
    { id: 0, handle: 'a', kind: 'say', body: 'x', created_at: '2026-11-20T00:00:00Z', role: 'muse' },
    { id: 1, handle: 'b', kind: 'say', body: 'y', created_at: null, role: 'muse' },
    { id: 2, handle: 'c', kind: 'say', body: 'z', role: 'muse' },
  ]);

  assert.equal(formatted[0].id, 0);
  assert.equal(formatted[0].created_at, '2026-11-20T00:00:00Z');
  assert.equal(formatted[1].created_at, 0);
  assert.equal(formatted[2].created_at, 0);
});

test('renderPromptBook resolves reply_to 0 to the id-0 entry\'s handle', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  // id 0 is a real id here (entry.id != null includes 0), so replying to the
  // first-ever line resolves instead of falling back to bare #0.
  renderPromptBook(
    container,
    [
      { id: 0, handle: 'zero', kind: 'say', body: 'first', role: 'muse' },
      { id: 1, handle: 'one', kind: 'say', body: 'reply', role: 'muse', reply_to: 0 },
    ],
    doc,
  );

  const replyEl = container.children[1].children[0];
  assert.equal(replyEl.className, 'pb-reply-to');
  assert.equal(replyEl.textContent, '\u21a9 #0 @zero');
});

test('renderPromptBook resolves duplicate ids to the last entry\'s handle', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 5, handle: 'old', kind: 'say', body: 'a', role: 'muse' },
      { id: 5, handle: 'new', kind: 'say', body: 'b', role: 'muse' },
      { id: 6, handle: 'q', kind: 'say', body: 'c', role: 'muse', reply_to: 5 },
    ],
    doc,
  );

  const replyEl = container.children[2].children.find((c) => c.className === 'pb-reply-to');
  assert.equal(replyEl.textContent, '\u21a9 #5 @new');
});

test('renderPromptBook renders an NPC emote with pill, emote class, and space separator', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [{ id: 7, handle: 'wick', kind: 'emote', body: 'trims a wick', role: 'npc' }],
    doc,
  );

  const line = container.children[0];
  assert.equal(line.className, 'pb-line pb-kind-emote');
  assert.deepEqual(
    line.children.map((c) => c.className),
    ['pb-npc-pill', 'pb-handle', 'pb-body'],
  );
  assert.equal(line.children[2].textContent, ' trims a wick');
});

test('renderPromptBook renders empty bodies as bare separators', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 8, handle: 'a', kind: 'say', body: '', role: 'muse' },
      { id: 9, handle: 'b', kind: 'emote', body: '', role: 'muse' },
    ],
    doc,
  );

  const sayBody = container.children[0].children.find((c) => c.className === 'pb-body');
  const emoteBody = container.children[1].children.find((c) => c.className === 'pb-body');
  assert.equal(sayBody.textContent, ': ');
  assert.equal(emoteBody.textContent, ' ');
});

test('renderPromptBook with omitted doc is a no-op in Node and format keeps unicode bodies verbatim', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();
  container.appendChild(doc.createElement('p'));

  const result = renderPromptBook(container, [{ id: 1, handle: 'a', body: 'hi' }]);
  assert.equal(result, undefined);
  assert.equal(container.children.length, 1);

  assert.equal(
    formatPromptBookEntries([{ id: 1, handle: 'a', kind: 'say', body: 'line1\nline2 👻', role: 'muse' }])[0].body,
    'line1\nline2 👻',
  );
});

test('renderPromptBook renders the [guest] pill for guest role, say vs emote vs system', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 1, handle: 'vis', kind: 'say', body: 'hello', role: 'guest' },
      { id: 2, handle: 'vis', kind: 'emote', body: 'waves', role: 'guest' },
      { id: 3, handle: 'vis', kind: 'system', body: 'arrived', role: 'guest' },
    ],
    doc,
  );

  assert.equal(container.children.length, 3);

  const [sayLine, emoteLine, sysLine] = container.children;
  assert.equal(sayLine.className, 'pb-line pb-kind-say');
  assert.deepEqual(
    sayLine.children.map((c) => c.className),
    ['pb-guest-pill', 'pb-handle', 'pb-body'],
  );
  assert.equal(sayLine.children[0].textContent, '[guest]');
  assert.equal(sayLine.children[2].textContent, ': hello');

  assert.equal(emoteLine.className, 'pb-line pb-kind-emote');
  assert.equal(emoteLine.children[0].textContent, '[guest]');
  assert.equal(emoteLine.children[2].textContent, ' waves');

  assert.equal(sysLine.className, 'pb-line pb-kind-system');
  assert.equal(sysLine.children[0].className, 'pb-guest-pill');
});

test('formatPromptBookEntries keeps role guest and kind emote, normalizes missing/empty/null kind to say, and keeps empty handle', () => {
  const f = formatPromptBookEntries([
    { id: 1, handle: 'g', kind: 'emote', body: 'x', role: 'guest' },
    { id: 2, handle: 'h', body: 'y', role: 'muse' },
    { id: 3, handle: '', kind: '', body: 'z', role: 'muse' },
    { id: 4, handle: 'i', kind: null, body: 'w', role: 'muse' },
  ]);

  assert.equal(f[0].role, 'guest');
  assert.equal(f[0].kind, 'emote');
  assert.equal(f[1].kind, 'say');
  assert.equal(f[2].kind, 'say');
  assert.equal(f[2].handle, '');
  assert.equal(f[3].kind, 'say');
});

test('renderPromptBook resolves a forward reply_to when target entry appears after the reply', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 1, handle: 'early', kind: 'say', body: 'reply first', role: 'muse', reply_to: 2 },
      { id: 2, handle: 'later', kind: 'say', body: 'target second', role: 'muse' },
    ],
    doc,
  );

  const replyEl = container.children[0].children.find((c) => c.className === 'pb-reply-to');
  assert.equal(replyEl.textContent, '\u21a9 #2 @later');
});

test('renderPromptBook never resolves string ids as reply targets and keeps negative reply_to bare', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: '5', handle: 'str', kind: 'say', body: 'a', role: 'muse' },
      { id: 6, handle: 'q', kind: 'say', body: 'b', role: 'muse', reply_to: 5 },
    ],
    doc,
  );

  const strReplyEl = container.children[1].children.find((c) => c.className === 'pb-reply-to');
  assert.equal(strReplyEl.textContent, '\u21a9 #5');

  const negFormatted = formatPromptBookEntries([{ id: 1, handle: 'a', kind: 'say', body: 'x', reply_to: -1 }]);
  assert.equal(negFormatted[0].reply_to, -1);

  const negContainer = doc.makeContainer();
  renderPromptBook(negContainer, [{ id: 1, handle: 'a', kind: 'say', body: 'x', reply_to: -1 }], doc);
  const negReplyEl = negContainer.children[0].children.find((c) => c.className === 'pb-reply-to');
  assert.equal(negReplyEl.textContent, '\u21a9 #-1');
});

test('formatPromptBookEntries caps positionally so 120 reversed-id entries keep the last 100 positions', () => {
  const entries = Array.from({ length: 120 }, (_, i) => ({
    id: 120 - i,
    handle: `m-${120 - i}`,
    kind: 'say',
    body: `n${120 - i}`,
    role: 'muse',
  }));
  const f = formatPromptBookEntries(entries);

  assert.equal(f.length, 100);
  assert.equal(f[0].id, 100);
  assert.equal(f[99].id, 1);
  assert.equal(f[0].handle, 'm-100');
});

test('renderPromptBook renders null/empty entries as unknown lines and keeps empty-string handle empty', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(container, [null, {}], doc);
  assert.equal(container.children.length, 2);
  for (const line of container.children) {
    assert.equal(line.className, 'pb-line pb-kind-say');
    assert.equal(line.children.find((c) => c.className === 'pb-handle').textContent, 'unknown');
    assert.equal(line.children.find((c) => c.className === 'pb-body').textContent, ': ');
  }

  const emptyHandleContainer = doc.makeContainer();
  renderPromptBook(
    emptyHandleContainer,
    [{ id: 1, handle: '', kind: 'say', body: 'hi', role: 'muse' }],
    doc,
  );
  assert.equal(
    emptyHandleContainer.children[0].children.find((c) => c.className === 'pb-handle').textContent,
    '',
  );
});

test('formatPromptBookEntries returns exactly seven keys, strips extra fields, and passes id and created_at through verbatim', () => {
  const f = formatPromptBookEntries([
    { id: 1.5, handle: 'a', kind: 'say', body: 'x', reply_to: null, created_at: false, role: 'muse', extra: 'drop', nested: { z: 1 } },
    { id: '7', handle: 'b', kind: 'say', body: 'y', created_at: '', role: 'muse' },
    { id: 3, handle: 'c', kind: 'say', body: 'z', created_at: 0, role: 'muse' },
  ]);

  assert.deepEqual(Object.keys(f[0]), ['id', 'handle', 'kind', 'body', 'reply_to', 'created_at', 'role']);
  assert.equal(f[0].id, 1.5);
  assert.equal(f[0].created_at, false);
  assert.equal('extra' in f[0], false);
  assert.equal('nested' in f[0], false);
  assert.equal(f[1].id, '7');
  assert.equal(f[1].created_at, '');
  assert.equal(f[2].created_at, 0);
});

test('formatPromptBookEntries is case-sensitive on role and kind and rejects non-integer reply_to values', () => {
  const f = formatPromptBookEntries([
    { id: 1, handle: 'a', kind: 'EMOTE', body: 'x', role: 'NPC' },
    { id: 2, handle: 'b', kind: 'System', body: 'x', role: 'ADMIN' },
    { id: 3, handle: 'c', kind: ' SAY ', body: 'x', role: '' },
    { id: 4, handle: 'd', kind: 'say', body: 'x', role: null, reply_to: NaN },
    { id: 5, handle: 'e', kind: 'say', body: 'x', reply_to: Infinity },
    { id: 6, handle: 'f', kind: 'say', body: 'x', reply_to: true },
    { id: 7, handle: 'g', kind: 'say', body: 'x', reply_to: '2' },
    { id: 8, handle: 'h', kind: 'say', body: 'x', reply_to: -0 },
  ]);

  assert.equal(f[0].kind, 'say');
  assert.equal(f[0].role, 'muse');
  assert.equal(f[1].kind, 'say');
  assert.equal(f[1].role, 'muse');
  assert.equal(f[2].kind, 'say');
  assert.equal(f[2].role, 'muse');
  assert.equal(f[3].role, 'muse');
  assert.equal(f[3].reply_to, null);
  assert.equal(f[4].reply_to, null);
  assert.equal(f[5].reply_to, null);
  assert.equal(f[6].reply_to, null);
  assert.equal(f[7].reply_to === 0, true);
});

test('renderPromptBook renders a reply to a capped-out target as a bare #id', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();
  const entries = Array.from({ length: 101 }, (_, i) => ({
    id: i + 1,
    handle: `m${i + 1}`,
    kind: 'say',
    body: `n${i + 1}`,
    role: 'muse',
    reply_to: i === 100 ? 1 : null,
  }));

  renderPromptBook(container, entries, doc);

  assert.equal(container.children.length, 100);
  const lastLine = container.children[99];
  assert.equal(lastLine.children.find((c) => c.className === 'pb-handle').textContent, 'm101');
  assert.equal(lastLine.children.find((c) => c.className === 'pb-reply-to').textContent, '\u21a9 #1');
});

test('renderPromptBook child order, tag names, and exact line textContent for NPC emote and guest system replies', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 10, handle: 'wick', kind: 'say', body: 'lanterns lit', role: 'npc' },
      { id: 11, handle: 'wick', kind: 'emote', body: 'trims a wick', role: 'npc', reply_to: 10 },
      { id: 12, handle: 'vis', kind: 'system', body: 'arrived', role: 'guest', reply_to: 10 },
    ],
    doc,
  );

  const [line0, line1, line2] = container.children;
  assert.equal(line0.tagName, 'div');
  assert.deepEqual(
    line1.children.map((c) => c.tagName),
    ['span', 'span', 'span', 'span'],
  );
  assert.deepEqual(
    line1.children.map((c) => c.className),
    ['pb-npc-pill', 'pb-reply-to', 'pb-handle', 'pb-body'],
  );
  assert.equal(line1.textContent, '[NPC]\u21a9 #10 @wickwick trims a wick');

  assert.equal(line2.className, 'pb-line pb-kind-system');
  assert.deepEqual(
    line2.children.map((c) => c.className),
    ['pb-guest-pill', 'pb-reply-to', 'pb-handle', 'pb-body'],
  );
  assert.equal(line2.children[1].textContent, '\u21a9 #10 @wick');
  assert.equal(line2.textContent, '[guest]\u21a9 #10 @wickvis: arrived');
});

test('renderPromptBook renders non-array promptBook as the empty state and clears stale lines on re-render to empty', () => {
  const doc = createFakeDoc();
  const c1 = doc.makeContainer();
  renderPromptBook(c1, null, doc);
  assert.equal(c1.children.length, 1);
  assert.equal(c1.children[0].className, 'pb-empty');

  const c2 = doc.makeContainer();
  renderPromptBook(c2, 'nope', doc);
  assert.equal(c2.children.length, 1);
  assert.equal(c2.children[0].textContent, 'No remarks yet in the last 24h.');

  const c3 = doc.makeContainer();
  renderPromptBook(
    c3,
    [
      { id: 1, handle: 'ada', kind: 'say', body: 'one', role: 'muse' },
      { id: 2, handle: 'sol', kind: 'say', body: 'two', role: 'muse' },
    ],
    doc,
  );
  assert.equal(c3.children.length, 2);

  renderPromptBook(c3, [], doc);
  assert.equal(c3.children.length, 1);
  assert.equal(c3.children[0].tagName, 'p');
  assert.equal(c3.children[0].className, 'pb-empty');
  assert.equal(c3.children[0].textContent, 'No remarks yet in the last 24h.');
});

test('renderPromptBook gives system kind an NPC pill for npc role, a guest pill plus reply for guest role, and no pill for muse', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 1, handle: 'wick', kind: 'system', body: 'lamps checked', role: 'npc' },
      { id: 2, handle: 'vis', kind: 'say', body: 'hello', role: 'guest', reply_to: 1 },
      { id: 3, handle: 'bell', kind: 'system', body: 'chimes', role: 'muse', reply_to: 1 },
    ],
    doc,
  );

  const [line0, line1, line2] = container.children;
  assert.equal(line0.className, 'pb-line pb-kind-system');
  assert.deepEqual(
    line0.children.map((c) => c.className),
    ['pb-npc-pill', 'pb-handle', 'pb-body'],
  );
  assert.equal(line0.children[0].textContent, '[NPC]');

  assert.deepEqual(
    line1.children.map((c) => c.className),
    ['pb-guest-pill', 'pb-reply-to', 'pb-handle', 'pb-body'],
  );
  assert.equal(line1.children[1].textContent, '\u21a9 #1 @wick');

  assert.deepEqual(
    line2.children.map((c) => c.className),
    ['pb-reply-to', 'pb-handle', 'pb-body'],
  );
  assert.equal(line2.children[0].textContent, '\u21a9 #1 @wick');
});

test('formatPromptBookEntries passes id through verbatim for falsy/NaN values and normalizes non-string handles and bodies', () => {
  const f = formatPromptBookEntries([
    { id: false, handle: { x: 1 }, kind: 'say', body: ['a'], role: 'muse' },
    { id: NaN, handle: ['h'], kind: 'say', body: { b: 1 }, role: 'muse' },
    { id: -5, handle: true, kind: 'say', body: 0, role: 'muse' },
    { id: 0, handle: Symbol('s'), kind: 'say', body: '', role: 'muse' },
  ]);

  assert.equal(f[0].id, false);
  assert.equal(Number.isNaN(f[1].id), true);
  assert.equal(f[2].id, -5);
  assert.equal(f[3].id, 0);

  for (const entry of f) {
    assert.equal(typeof entry.handle, 'string');
    assert.equal(entry.handle, 'unknown');
    assert.equal(typeof entry.body, 'string');
    assert.equal(entry.body, '');
  }
});

test('formatPromptBookEntries keeps float integers, huge integers, and -0 as 0 in reply_to while rejecting fractional floats', () => {
  const f = formatPromptBookEntries([
    { id: 1, reply_to: 1.0 },
    { id: 2, reply_to: 2 ** 53 },
    { id: 3, reply_to: 2.5 },
    { id: 4, reply_to: -0 },
    { id: 5, reply_to: Number.MAX_SAFE_INTEGER },
  ]);

  assert.equal(f[0].reply_to, 1);
  assert.equal(f[1].reply_to, 2 ** 53);
  assert.equal(f[2].reply_to, null);
  assert.equal(f[3].reply_to === 0, true);
  assert.equal(Number.isInteger(f[4].reply_to), true);
  assert.equal(f[4].reply_to, Number.MAX_SAFE_INTEGER);
});

test('formatPromptBookEntries passes created_at through verbatim for negative, fractional, zero, and object values while defaulting undefined to 0', () => {
  const stamp = { when: 'then' };
  const f = formatPromptBookEntries([
    { id: 1, created_at: undefined },
    { id: 2, created_at: -100 },
    { id: 3, created_at: stamp },
    { id: 4, created_at: 1.5 },
    { id: 5, created_at: 0 },
  ]);

  assert.equal(f[0].created_at, 0);
  assert.equal(f[1].created_at, -100);
  assert.equal(f[2].created_at, stamp);
  assert.equal(f[3].created_at, 1.5);
  assert.equal(f[4].created_at, 0);
});

test('renderPromptBook renders [null] as one unknown line and undefined input as the empty state', () => {
  const doc = createFakeDoc();
  const c1 = doc.makeContainer();
  renderPromptBook(c1, [null], doc);
  assert.equal(c1.children.length, 1);
  assert.equal(c1.children[0].className, 'pb-line pb-kind-say');
  assert.equal(c1.children[0].children.find((c) => c.className === 'pb-handle').textContent, 'unknown');

  const c2 = doc.makeContainer();
  renderPromptBook(c2, undefined, doc);
  assert.equal(c2.children.length, 1);
  assert.equal(c2.children[0].className, 'pb-empty');
});

test('renderPromptBook renders reply targets with normalized unknown handle as @unknown and empty-string handle bare', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 3, handle: 42, kind: 'say', body: 'hi', role: 'muse' },
      { id: 4, handle: '', kind: 'say', body: 'yo', role: 'muse' },
      { id: 5, handle: 'q', kind: 'say', body: 'r1', role: 'muse', reply_to: 3 },
      { id: 6, handle: 'r', kind: 'say', body: 'r2', role: 'muse', reply_to: 4 },
    ],
    doc,
  );

  assert.equal(
    container.children[2].children.find((c) => c.className === 'pb-reply-to').textContent,
    '\u21a9 #3 @unknown',
  );
  assert.equal(
    container.children[3].children.find((c) => c.className === 'pb-reply-to').textContent,
    '\u21a9 #4',
  );
});

test('renderPromptBook calls removeChild once per stale child and zero times on an empty container', () => {
  const doc = createFakeDoc();
  const c1 = doc.makeContainer();
  c1.appendChild(doc.createElement('div'));
  c1.appendChild(doc.createElement('div'));
  c1.appendChild(doc.createElement('div'));

  let calls1 = 0;
  const orig1 = c1.removeChild.bind(c1);
  c1.removeChild = (child) => {
    calls1++;
    return orig1(child);
  };

  renderPromptBook(c1, [{ id: 1, handle: 'ada', kind: 'say', body: 'one', role: 'muse' }], doc);
  assert.equal(calls1, 3);
  assert.equal(c1.children.length, 1);
  assert.equal(c1.children[0].className, 'pb-line pb-kind-say');

  const c2 = doc.makeContainer();
  let calls2 = 0;
  const orig2 = c2.removeChild.bind(c2);
  c2.removeChild = (child) => {
    calls2++;
    return orig2(child);
  };

  renderPromptBook(c2, [{ id: 1, handle: 'ada', kind: 'say', body: 'one', role: 'muse' }], doc);
  assert.equal(calls2, 0);
  assert.equal(c2.children.length, 1);
});

test('renderPromptBook renders a guest emote with reply in exact child order with pill, target, and space separator', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 10, handle: 'wick', kind: 'say', body: 'lanterns lit', role: 'npc' },
      { id: 11, handle: 'vis', kind: 'emote', body: 'waves', role: 'guest', reply_to: 10 },
    ],
    doc,
  );

  const line1 = container.children[1];
  assert.equal(line1.className, 'pb-line pb-kind-emote');
  assert.equal(line1.children.map((c) => c.className).join(','), 'pb-guest-pill,pb-reply-to,pb-handle,pb-body');
  assert.equal(line1.children[0].textContent, '[guest]');
  assert.equal(line1.children[1].textContent, '\u21a9 #10 @wick');
  assert.equal(line1.children[3].textContent, ' waves');
});

test('formatPromptBookEntries preserves arbitrary unsorted input order and duplicate ids', () => {
  const f = formatPromptBookEntries([
    { id: 9, handle: 'a' },
    { id: 3, handle: 'b' },
    { id: 7, handle: 'c' },
    { id: 3, handle: 'd' },
  ]);

  assert.equal(f.map((e) => e.id).join(','), '9,3,7,3');
  assert.equal(f.map((e) => e.handle).join(','), 'a,b,c,d');
});

test('renderPromptBook produces exact full line textContent for a mixed three-role render', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();

  renderPromptBook(
    container,
    [
      { id: 10, handle: 'wick', kind: 'say', body: 'lanterns lit', role: 'npc' },
      { id: 11, handle: 'vis', kind: 'emote', body: 'waves', role: 'guest', reply_to: 10 },
      { id: 12, handle: 'bell', kind: 'system', body: 'chimes', role: 'muse', reply_to: 10 },
    ],
    doc,
  );

  assert.equal(container.children[0].textContent, '[NPC]wick: lanterns lit');
  assert.equal(container.children[1].textContent, '[guest]\u21a9 #10 @wickvis waves');
  assert.equal(container.children[2].textContent, '\u21a9 #10 @wickbell: chimes');
});

test('prompt-book.mjs has no fetch, Math.random, innerHTML, or imports, exports exactly two functions, and names its sync source', async () => {
  const src = await fs.readFile(PROMPT_BOOK_PATH, 'utf8');
  assert.equal(/fetch\s*\(/.test(src), false);
  assert.equal(/Math\.random/.test(src), false);
  assert.equal(/\.innerHTML\b/.test(src), false);
  assert.equal(/^import /m.test(src), false);
  assert.equal(
    [...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]).join(','),
    'formatPromptBookEntries,renderPromptBook',
  );
  assert.equal(src.includes('Copied verbatim from town-3d/town.js'), true);
});

test('renderPromptBook doc.created accounting for empty and mixed three-role renders', () => {
  // Empty render creates exactly the one <p>.
  const doc0 = createFakeDoc();
  const c0 = doc0.makeContainer();
  renderPromptBook(c0, [], doc0);
  assert.equal(doc0.created.length, 1);
  assert.equal(doc0.created[0].tagName, 'p');
  assert.equal(c0.children.length, 1);

  // Mixed 3-entry render: NPC say (4) + guest emote with reply (5) + muse system with reply (4) = 13.
  const doc = createFakeDoc();
  const container = doc.makeContainer();
  renderPromptBook(container, [
    { id: 10, handle: 'wick', kind: 'say', body: 'lanterns lit', role: 'npc' },
    { id: 11, handle: 'vis', kind: 'emote', body: 'waves', role: 'guest', reply_to: 10 },
    { id: 12, handle: 'bell', kind: 'system', body: 'chimes', role: 'muse', reply_to: 10 },
  ], doc);
  assert.equal(doc.created.length, 13);
  assert.deepEqual(doc.created.map((e) => e.tagName), ['div', 'span', 'span', 'span', 'div', 'span', 'span', 'span', 'span', 'div', 'span', 'span', 'span']);
  assert.equal(container.children.length, 3);
  assert.equal(doc.created.filter((e) => e.tagName === 'div').length, 3);
  assert.equal(doc.created.filter((e) => e.className === 'pb-npc-pill').length, 1);
  assert.equal(doc.created.filter((e) => e.className === 'pb-guest-pill').length, 1);
  assert.equal(doc.created.filter((e) => e.className === 'pb-reply-to').length, 2);
});

test('staging.js applyStagingState wires renderPromptBook with scroll-to-bottom', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const stagingLines = stagingSrc.split('\n');
  assert.equal(stagingLines[25], "import { renderPromptBook } from './prompt-book.mjs';");
  assert.equal(stagingLines[770], 'function applyStagingState(liveStore, bandstandBuilt, npcStandIns, state = {}, promptBookLinesEl = null, tavernGroup = null, eventBannerEl = null) {');
  assert.equal(stagingLines[853], '  if (promptBookLinesEl) {');
  assert.equal(stagingLines[854], '    renderPromptBook(promptBookLinesEl, state?.prompt_book, document);');
  assert.equal(stagingLines[855], '    promptBookLinesEl.scrollTop = promptBookLinesEl.scrollHeight;');
  assert.equal(stagingLines[856], '  }');
  assert.equal(stagingLines.filter((l) => l.includes('renderPromptBook(')).length, 1); // only the applyStagingState call
});

test('staging.js setPromptBookVisible toggles hidden, aria-expanded, and button label', async () => {
  const stagingSrc = await fs.readFile(path.join(__dirname, 'staging.js'), 'utf8');
  const stagingLines = stagingSrc.split('\n');
  assert.equal(stagingLines[1216], "  const promptBookEl = document.getElementById('prompt-book');");
  assert.equal(stagingLines[1217], "  const promptBookToggleEl = document.getElementById('prompt-book-toggle');");
  assert.equal(stagingLines[1218], "  const promptBookLinesEl = document.getElementById('prompt-book-lines');");
  assert.equal(stagingLines[1219], "  const eventBannerEl = document.getElementById('prompt-book-event');");
  assert.equal(stagingLines[1220], '  function setPromptBookVisible(visible) {');
  assert.equal(stagingLines[1221], '    if (!promptBookEl || !promptBookToggleEl) return;');
  assert.equal(stagingLines[1222], '    promptBookEl.hidden = !visible;');
  assert.equal(stagingLines[1223], "    promptBookToggleEl.setAttribute('aria-expanded', String(visible));");
  assert.equal(stagingLines[1224], "    promptBookToggleEl.textContent = visible ? 'Hide Prompt Book' : 'Prompt Book';");
  assert.equal(stagingLines[1225], '  }');
  assert.equal(stagingLines[1226], '  setPromptBookVisible(window.innerWidth >= 640);');
  assert.equal(stagingLines[1227], "  promptBookToggleEl?.addEventListener('click', () => {");
  assert.equal(stagingLines[1228], '    setPromptBookVisible(Boolean(promptBookEl?.hidden));');
  assert.equal(stagingLines[1229], '  });');
});

test('prompt-book.mjs header line range matches town.js definitions and call site', async () => {
  const pbSrc = await fs.readFile(PROMPT_BOOK_PATH, 'utf8');
  assert.equal(pbSrc.split('\n')[0], '// Copied verbatim from town-3d/town.js (formatPromptBookEntries + renderPromptBook, lines 1813-1889).');
  const townSrc = await fs.readFile(TOWN_JS_PATH, 'utf8');
  const townLines = townSrc.split('\n');
  assert.equal(townLines[1812], 'export function formatPromptBookEntries(promptBook) {');
  assert.equal(townLines[1829], 'export function renderPromptBook(containerEl, promptBook, doc = globalThis.document) {');
  assert.equal(townLines[1888], '}');
  assert.equal(townLines[1889], '');
  assert.ok(townLines[1890].startsWith('export const SEED_HOME_PADS'));
  assert.equal(townLines[2648], '  live.promptBook = formatPromptBookEntries(state?.prompt_book);');
});

test('formatPromptBookEntries returns new objects and never mutates its input array', () => {
  const input = [{ id: 1, handle: 'a', kind: 'say', body: 'x', role: 'muse' }];
  const snapshot = JSON.stringify(input);
  const f = formatPromptBookEntries(input);
  assert.notEqual(f, input);
  assert.notEqual(f[0], input[0]);
  assert.equal(JSON.stringify(input), snapshot);
  f[0].body = 'mutated';
  assert.equal(input[0].body, 'x');

  const input101 = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, handle: `m${i + 1}`, kind: 'say', body: `n${i + 1}`, role: 'muse' }));
  const f101 = formatPromptBookEntries(input101);
  assert.equal(f101.length, 100);
  assert.equal(input101.length, 101);
  assert.equal(input101[0].id, 1);
  assert.equal(f101[0].id, 2);
});

test('renderPromptBook preserves unicode handles and long or multiline bodies verbatim', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();
  const long = 'x'.repeat(500);
  renderPromptBook(container, [{ id: 1, handle: '👻-ghost', kind: 'say', body: long, role: 'npc' }], doc);
  assert.equal(container.children[0].textContent, `[NPC]👻-ghost: ${long}`);
  assert.equal(container.children[0].children.find((e) => e.className === 'pb-handle').textContent, '👻-ghost');

  const doc2 = createFakeDoc();
  const c2 = doc2.makeContainer();
  renderPromptBook(c2, [{ id: 2, handle: 'a b', kind: 'say', body: 'hi\nthere\t!', role: 'muse' }], doc2);
  assert.equal(c2.children[0].textContent, 'a b: hi\nthere\t!');
  assert.equal(c2.children[0].children.find((e) => e.className === 'pb-body').textContent, ': hi\nthere\t!');
});

test('renderPromptBook resolves reply chains entry by entry and leaves unknown targets bare', () => {
  const doc = createFakeDoc();
  const container = doc.makeContainer();
  renderPromptBook(container, [
    { id: 1, handle: 'a', kind: 'say', body: 'first', role: 'muse' },
    { id: 2, handle: 'b', kind: 'say', body: 'second', role: 'muse', reply_to: 1 },
    { id: 3, handle: 'c', kind: 'say', body: 'third', role: 'muse', reply_to: 2 },
    { id: 4, handle: 'd', kind: 'say', body: 'orphan', role: 'muse', reply_to: 99 },
  ], doc);
  assert.equal(container.children[1].children.find((e) => e.className === 'pb-reply-to').textContent, '\u21a9 #1 @a');
  assert.equal(container.children[2].children.find((e) => e.className === 'pb-reply-to').textContent, '\u21a9 #2 @b');
  assert.equal(container.children[3].children.find((e) => e.className === 'pb-reply-to').textContent, '\u21a9 #99');
  assert.equal(container.children[2].textContent, '\u21a9 #2 @bc: third');
});

test('renderPromptBook is a no-op for undefined or false doc and undefined container', () => {
  const doc = createFakeDoc();
  const c1 = doc.makeContainer();
  assert.equal(renderPromptBook(c1, [{ id: 1, handle: 'a', body: 'hi' }]), undefined); // no doc arg: globalThis.document is undefined in Node
  assert.equal(c1.children.length, 0);

  assert.equal(renderPromptBook(undefined, [{ id: 1, handle: 'a', body: 'hi' }], doc), undefined);

  const c3 = doc.makeContainer();
  c3.appendChild(doc.createElement('p'));
  assert.equal(renderPromptBook(c3, [{ id: 1, handle: 'a', body: 'hi' }], false), undefined);
  assert.equal(c3.children.length, 1); // stale child untouched: no doc means no clearing either
});

test('prompt-book.mjs source pins header, JSDoc, clearing loop, and no scroll handling', async () => {
  const src = await fs.readFile(PROMPT_BOOK_PATH, 'utf8');
  const lines = src.split('\n');
  assert.equal(lines[1], '// Keep in step with town-3d/town.js; no THREE dependency, no top-level document access.');
  assert.equal(lines[3], '/**');
  assert.equal(lines[4], ' * Format and cap Prompt Book entries to the most recent 100 lines,');
  assert.equal(lines[5], ' * preserving chronological order (newest at the bottom).');
  assert.equal(lines[6], ' */');
  assert.equal(src.includes('Render Prompt Book lines into containerEl using textContent only (never inner' + 'HTML).'), true);
  assert.equal(src.includes('  while (containerEl.firstChild) {\n    containerEl.removeChild(containerEl.firstChild);\n  }'), true);
  assert.equal(src.includes('scrollTop'), false); // scrolling is staging.js's job, not this module's
  assert.equal(lines.filter((l) => l.includes('document')).length, 2); // header comment + default parameter
  assert.equal(lines.filter((l) => l.includes('globalThis.document')).length, 1);
});

test('test-prompt-book.mjs hygiene pins 48 unique tests, 6 imports, and clean literals', async () => {
  const self = await fs.readFile(path.join(__dirname, 'test-prompt-book.mjs'), 'utf8');
  const lines = self.split('\n');
  const names = [...self.matchAll(/^(?:await )?test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 48);
  assert.equal(new Set(names).size, 48); // every top-level test name unique
  assert.deepEqual(lines.filter((l) => l.startsWith('import ')), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { formatPromptBookEntries, renderPromptBook } from './prompt-book.mjs';",
  ]); // no new top-level imports
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Date' + '.now')).length, 0);
  assert.equal(lines.filter((l) => l.includes('Math' + '.random')).length, 1); // line 887 test name only (regex /Math\.random/ has no literal)
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => l.toLowerCase().includes('camp' + 'fire')).length, 0);
  assert.equal(lines.filter((l) => l.includes('inner' + 'HTML')).length, 4); // lines 125, 128, 887, 891
});
