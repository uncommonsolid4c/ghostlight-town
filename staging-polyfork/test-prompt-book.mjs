import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatPromptBookEntries, renderPromptBook } from './prompt-book.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_BOOK_PATH = path.join(__dirname, 'prompt-book.mjs');

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
