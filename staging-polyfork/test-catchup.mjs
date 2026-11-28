import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CATCHUP_STORAGE_KEY,
  loadSeenSnapshot,
  saveSeenSnapshot,
  buildSnapshot,
  computeCatchUp,
  renderCatchUp,
} from './catchup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATCHUP_PATH = path.join(__dirname, 'catchup.mjs');

function createFakeDoc() {
  const created = [];
  function makeNode(tagName) {
    const node = {
      tagName,
      id: '',
      type: '',
      placeholder: '',
      value: '',
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

function createFakeStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, val) {
      store.set(key, String(val));
    },
  };
}

test('(a) computeCatchUp with snapshot diffs replies, new neighbors, garden changes, and 100-capped new lines', () => {
  const snapshot = {
    state_seq: 300,
    promptBookMaxId: 10,
    plotHandles: ['lampmoth', 'maren', 'tomas'],
    garden: [
      { slot: 0, handle: 'milo', seed: 'moonflower', stage: 'leaf' },
      { slot: 1, handle: 'lampmoth', seed: 'lantern_poppy', stage: 'sprout' },
      { slot: 2, handle: 'tomas', seed: 'tea_mint', stage: 'leaf' },
    ],
    handle: 'lampmoth',
    seenAt: 1700000000,
  };

  // Build 105 new prompt book entries (ids 11..115) plus older entries (ids 8..10)
  const promptBook = [
    { id: 8, handle: 'lampmoth', kind: 'say', body: 'opening the lantern', reply_to: null, created_at: 1, role: 'muse' },
    { id: 9, handle: 'maren', kind: 'say', body: 'reply to lampmoth', reply_to: 8, created_at: 2, role: 'npc' },
    { id: 10, handle: 'lampmoth', kind: 'say', body: 'thanks maren', reply_to: 9, created_at: 3, role: 'muse' },
    { id: 11, handle: 'wick', kind: 'say', body: 'reply to lampmoth reply-line', reply_to: 10, created_at: 4, role: 'npc' },
    { id: 12, handle: 'muse', kind: 'say', body: 'reply to maren, not lampmoth', reply_to: 9, created_at: 5, role: 'muse' },
    { id: 13, handle: 'tomas', kind: 'say', body: 'reply to earlier line #8', reply_to: 8, created_at: 6, role: 'muse' },
  ];
  for (let id = 14; id <= 115; id++) {
    promptBook.push({ id, handle: `muse-${id}`, kind: 'say', body: `note ${id}`, reply_to: null, created_at: id, role: 'muse' });
  }

  const state = {
    state_seq: 383,
    plots: {
      lampmoth: '2026-11-28T00:00:00Z', // updated timestamp -> NOT a new neighbor
      maren: '2026-11-20T00:00:00Z',
      tomas: '2026-11-20T00:00:00Z',
      muse: '2026-11-27T12:00:00Z',     // new neighbor
      wick: '2026-11-27T13:00:00Z',     // new neighbor
    },
    garden: {
      slots: [
        { slot: 0, handle: 'milo', seed: 'moonflower', stage: 'bloom' },       // leaf -> bloom
        { slot: 1, handle: 'lampmoth', seed: 'lantern_poppy', stage: 'sprout' }, // unchanged
        // slot 2 vanished!
        { slot: 3, handle: 'muse', seed: 'starwort', stage: 'sprout' },         // newly planted
      ],
    },
    prompt_book: promptBook,
    nightly_call: { date: '2026-11-28', topic: 'What is a small kindness?' },
    daily_game: { date: '2026-11-28', format: 'word', prompt: 'Describe tonight in two words.' },
  };

  const cu = computeCatchUp(snapshot, state, 'lampmoth');
  assert.equal(cu.isFirstVisit, false);
  assert.deepEqual(cu.newNeighbors, ['muse', 'wick']);
  assert.deepEqual(cu.gardenChanges, [
    { slot: 0, handle: 'milo', seed: 'moonflower', from: 'leaf', to: 'bloom' },
    { slot: 2, handle: 'tomas', seed: 'tea_mint', from: 'leaf', to: null },
    { slot: 3, handle: 'muse', seed: 'starwort', from: null, to: 'sprout' },
  ]);

  // 105 new entries (11..115) capped to the most recent 100 (16..115)
  assert.equal(cu.newLines.length, 100);
  assert.equal(cu.newLines[0].id, 16);
  assert.equal(cu.newLines[99].id, 115);

  // Also check repliesToMe when new entries are <= 100 (e.g. 11..13)
  const smallState = { ...state, prompt_book: promptBook.slice(0, 6) };
  const smallCu = computeCatchUp(snapshot, smallState, 'lampmoth');
  assert.deepEqual(
    smallCu.repliesToMe.map((r) => r.id),
    [11, 13]
  );
  assert.equal(smallCu.nightlyCall.topic, 'What is a small kindness?');
  assert.equal(smallCu.dailyGame.prompt, 'Describe tonight in two words.');
});

test('(b) computeCatchUp first visit (snapshot === null) sets isFirstVisit, empties diff sections, passes context', () => {
  const state = {
    state_seq: 383,
    plots: { lampmoth: '2026-11-20T00:00:00Z' },
    garden: { slots: [{ slot: 0, handle: 'milo', seed: 'moonflower', stage: 'bloom' }] },
    prompt_book: [{ id: 175, handle: 'maren', kind: 'say', body: 'lanterns lit', role: 'npc' }],
    nightly_call: { date: '2026-11-28', topic: 'Kindness' },
    daily_game: { date: '2026-11-28', format: 'word', prompt: 'Two words' },
  };

  const cu = computeCatchUp(null, state, '');
  assert.equal(cu.isFirstVisit, true);
  assert.deepEqual(cu.repliesToMe, []);
  assert.deepEqual(cu.newNeighbors, []);
  assert.deepEqual(cu.gardenChanges, []);
  assert.equal(cu.newLines.length, 1);
  assert.equal(cu.newLines[0].id, 175);
  assert.deepEqual(cu.nightlyCall, { date: '2026-11-28', topic: 'Kindness' });
  assert.deepEqual(cu.dailyGame, { date: '2026-11-28', format: 'word', prompt: 'Two words' });
});

test('(c) empty handle yields empty repliesToMe; handle matching is case and whitespace insensitive', () => {
  const snapshot = { state_seq: 1, promptBookMaxId: 1, plotHandles: [], garden: [] };
  const state = {
    prompt_book: [
      { id: 1, handle: 'LampMoth', kind: 'say', body: 'hello', role: 'muse' },
      { id: 2, handle: 'wick', kind: 'say', body: 'hi there', reply_to: 1, role: 'npc' },
    ],
  };

  assert.deepEqual(computeCatchUp(snapshot, state, '').repliesToMe, []);
  assert.deepEqual(computeCatchUp(snapshot, state, '   ').repliesToMe, []);

  const cu = computeCatchUp(snapshot, state, '  lampmoth  ');
  assert.equal(cu.repliesToMe.length, 1);
  assert.equal(cu.repliesToMe[0].id, 2);
});

test('(d) snapshot round-trip, corrupt JSON, and throwing storage', () => {
  const state = {
    state_seq: 383,
    plots: { wick: '2', lampmoth: '1', maren: '3' },
    garden: {
      slots: [
        { slot: 4, handle: 'lampmoth', seed: 'lantern_poppy', stage: 'bloom', planted_at: 'x' },
        { slot: 0, handle: 'milo', seed: 'moonflower', stage: 'bloom', planted_at: 'y' },
      ],
    },
    prompt_book: [{ id: 170 }, { id: 175 }],
  };

  const snap = buildSnapshot(state, ' lampmoth ');
  assert.equal(snap.state_seq, 383);
  assert.equal(snap.promptBookMaxId, 175);
  assert.deepEqual(snap.plotHandles, ['lampmoth', 'maren', 'wick']);
  assert.deepEqual(snap.garden, [
    { slot: 0, handle: 'milo', seed: 'moonflower', stage: 'bloom' },
    { slot: 4, handle: 'lampmoth', seed: 'lantern_poppy', stage: 'bloom' },
  ]);
  assert.equal(snap.handle, 'lampmoth');
  assert.equal(typeof snap.seenAt, 'number');

  const fakeStorage = createFakeStorage();
  saveSeenSnapshot(fakeStorage, snap);
  const loaded = loadSeenSnapshot(fakeStorage);
  assert.deepEqual(loaded, snap);

  // Corrupt JSON -> null, no throw
  fakeStorage.setItem(CATCHUP_STORAGE_KEY, '{not valid json');
  assert.equal(loadSeenSnapshot(fakeStorage), null);

  // Non-object JSON -> null, no throw
  fakeStorage.setItem(CATCHUP_STORAGE_KEY, '[1,2,3]');
  assert.equal(loadSeenSnapshot(fakeStorage), null);

  // Throwing storage -> no-op, no throw
  const throwingStorage = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(loadSeenSnapshot(throwingStorage), null);
  assert.doesNotThrow(() => saveSeenSnapshot(throwingStorage, snap));
  assert.equal(loadSeenSnapshot(null), null);
  assert.doesNotThrow(() => saveSeenSnapshot(null, snap));
});

test('(e) renderCatchUp renders sections, empty messages, first-visit note, handle input, [NPC] pills, and never uses innerHTML', async () => {
  const src = await fs.readFile(CATCHUP_PATH, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\.innerHTML\b/.test(codeOnly), 'catchup.mjs must never use innerHTML');

  const doc = createFakeDoc();
  const container = doc.makeContainer();

  // First-visit render with empty handle
  renderCatchUp(
    container,
    {
      isFirstVisit: true,
      handle: '',
      repliesToMe: [],
      newNeighbors: [],
      gardenChanges: [],
      newLines: [{ id: 175, handle: 'maren', kind: 'say', body: 'evening', reply_to: null, created_at: 0, role: 'npc' }],
      nightlyCall: { date: '2026-11-28', topic: 'Kindness' },
      dailyGame: { date: '2026-11-28', format: 'word', prompt: 'Two words' },
    },
    doc
  );

  const fullText = container.textContent;
  assert.ok(fullText.includes('this is your first catch-up'), 'first-visit welcome note missing');
  assert.ok(fullText.includes('Enter your handle above to see replies to your lines.'), 'empty handle prompt missing');
  assert.ok(fullText.includes('[NPC]'), 'NPC pill missing');
  assert.ok(fullText.includes('Nightly Call: Kindness'), 'Nightly Call missing');
  assert.ok(fullText.includes('Daily Game: Two words'), 'Daily Game missing');
  assert.ok(doc.created.some((el) => el.tagName === 'input' && el.id === 'catchup-handle'), '#catchup-handle input missing');

  // Empty non-first-visit render
  renderCatchUp(
    container,
    {
      isFirstVisit: false,
      handle: 'lampmoth',
      repliesToMe: [],
      newNeighbors: [],
      gardenChanges: [],
      newLines: [],
      nightlyCall: null,
      dailyGame: null,
    },
    doc
  );
  const emptyText = container.textContent;
  assert.ok(emptyText.includes('Nothing new since you last looked.'));
  assert.ok(emptyText.includes('No replies to your lines since your last visit.'));
  assert.ok(emptyText.includes('No new neighbors since your last visit.'));
  assert.ok(emptyText.includes('No garden changes since your last visit.'));
  assert.ok(emptyText.includes('No new lines since your last visit.'));
});
