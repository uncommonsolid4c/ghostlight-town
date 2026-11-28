// Client-side "What you missed" catch-up view for Ghostlight Town (Slice 533).
// Pure functions + textContent-only DOM render; no THREE dependency, no top-level document access.

import { formatPromptBookEntries } from './prompt-book.mjs';

export const CATCHUP_STORAGE_KEY = 'ghostlight.catchup.seen.v1';

const STAGE_ORDER = Object.freeze({
  sprout: 0,
  leaf: 1,
  bloom: 2,
});

function normalizeGardenSlots(garden) {
  const rawSlots = Array.isArray(garden?.slots) ? garden.slots : [];
  const normalized = [];
  for (const s of rawSlots) {
    if (!s || typeof s !== 'object' || !Number.isInteger(s.slot)) continue;
    normalized.push({
      slot: s.slot,
      handle: typeof s.handle === 'string' ? s.handle : '',
      seed: typeof s.seed === 'string' ? s.seed : '',
      stage: typeof s.stage === 'string' ? s.stage : 'sprout',
    });
  }
  normalized.sort((a, b) => a.slot - b.slot);
  return normalized;
}

function getPromptBookMaxId(promptBook) {
  if (!Array.isArray(promptBook)) return 0;
  let maxId = 0;
  for (const entry of promptBook) {
    if (entry && typeof entry.id === 'number' && Number.isFinite(entry.id) && entry.id > maxId) {
      maxId = entry.id;
    }
  }
  return maxId;
}

function getSortedPlotHandles(plots) {
  if (!plots || typeof plots !== 'object' || Array.isArray(plots)) return [];
  return Object.keys(plots).sort();
}

/**
 * Load the per-browser catch-up snapshot from storage.
 * Returns null on missing, corrupt, or non-object storage; never throws.
 */
export function loadSeenSnapshot(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(CATCHUP_STORAGE_KEY);
    if (typeof raw !== 'string' || !raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save the per-browser catch-up snapshot to storage.
 * Silently no-ops when storage is unavailable or throws.
 */
export function saveSeenSnapshot(storage, snapshot) {
  if (!storage || typeof storage.setItem !== 'function' || !snapshot || typeof snapshot !== 'object') {
    return;
  }
  try {
    storage.setItem(CATCHUP_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota/privacy-mode errors.
  }
}

/**
 * Build a snapshot object from the live town state and visitor handle.
 */
export function buildSnapshot(state, handle = '') {
  const cleanHandle = typeof handle === 'string' ? handle.trim() : '';
  return {
    state_seq: typeof state?.state_seq === 'number' && Number.isFinite(state.state_seq) ? state.state_seq : 0,
    promptBookMaxId: getPromptBookMaxId(state?.prompt_book),
    plotHandles: getSortedPlotHandles(state?.plots),
    garden: normalizeGardenSlots(state?.garden),
    handle: cleanHandle,
    seenAt: Math.floor(Date.now() / 1000),
  };
}

function buildHandleById(promptBook) {
  const map = new Map();
  if (!Array.isArray(promptBook)) return map;
  for (const entry of promptBook) {
    if (entry && entry.id != null && typeof entry.handle === 'string') {
      map.set(entry.id, entry.handle);
    }
  }
  return map;
}

function computeGardenChanges(prevSlots, currSlots) {
  const prevBySlot = new Map();
  for (const s of Array.isArray(prevSlots) ? prevSlots : []) {
    if (s && Number.isInteger(s.slot)) prevBySlot.set(s.slot, s);
  }
  const currBySlot = new Map();
  for (const s of currSlots) {
    currBySlot.set(s.slot, s);
  }

  const allSlots = Array.from(new Set([...prevBySlot.keys(), ...currBySlot.keys()])).sort((a, b) => a - b);
  const changes = [];

  for (const slot of allSlots) {
    const prev = prevBySlot.get(slot);
    const curr = currBySlot.get(slot);

    if (!prev && curr) {
      changes.push({ slot, handle: curr.handle, seed: curr.seed, from: null, to: curr.stage });
      continue;
    }
    if (prev && !curr) {
      changes.push({ slot, handle: prev.handle, seed: prev.seed, from: prev.stage, to: null });
      continue;
    }
    if (prev && curr) {
      if (prev.handle !== curr.handle || prev.seed !== curr.seed) {
        changes.push({ slot, handle: prev.handle, seed: prev.seed, from: prev.stage, to: null });
        changes.push({ slot, handle: curr.handle, seed: curr.seed, from: null, to: curr.stage });
        continue;
      }
      const prevRank = STAGE_ORDER[prev.stage] ?? -1;
      const currRank = STAGE_ORDER[curr.stage] ?? -1;
      if (currRank > prevRank) {
        changes.push({ slot, handle: curr.handle, seed: curr.seed, from: prev.stage, to: curr.stage });
      }
    }
  }

  return changes;
}

/**
 * Compute the "What you missed" diff from a saved snapshot and current town state.
 */
export function computeCatchUp(snapshot, state, handle = '') {
  const displayHandle = typeof handle === 'string' ? handle.trim() : '';
  const normHandle = displayHandle.toLowerCase();
  const isFirstVisit = !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot);

  const nightlyCall = state?.nightly_call && typeof state.nightly_call === 'object'
    ? { date: state.nightly_call.date ?? '', topic: state.nightly_call.topic ?? '' }
    : null;
  const dailyGame = state?.daily_game && typeof state.daily_game === 'object'
    ? { date: state.daily_game.date ?? '', format: state.daily_game.format ?? '', prompt: state.daily_game.prompt ?? '' }
    : null;

  const rawPromptBook = Array.isArray(state?.prompt_book) ? state.prompt_book : [];
  const replyHandles = buildHandleById(rawPromptBook);

  if (isFirstVisit) {
    return {
      isFirstVisit: true,
      handle: displayHandle,
      repliesToMe: [],
      newNeighbors: [],
      gardenChanges: [],
      newLines: formatPromptBookEntries(rawPromptBook),
      nightlyCall,
      dailyGame,
      replyHandles,
    };
  }

  const prevMaxId = typeof snapshot.promptBookMaxId === 'number' && Number.isFinite(snapshot.promptBookMaxId)
    ? snapshot.promptBookMaxId
    : 0;

  const rawNewEntries = rawPromptBook.filter(
    (e) => e && typeof e.id === 'number' && Number.isFinite(e.id) && e.id > prevMaxId
  );
  const newLines = formatPromptBookEntries(rawNewEntries);

  const repliesToMe = normHandle
    ? newLines.filter((entry) => {
        if (entry.reply_to === null) return false;
        const targetHandle = replyHandles.get(entry.reply_to);
        return typeof targetHandle === 'string' && targetHandle.trim().toLowerCase() === normHandle;
      })
    : [];

  const prevPlotSet = new Set(Array.isArray(snapshot.plotHandles) ? snapshot.plotHandles : []);
  const currentPlotHandles = getSortedPlotHandles(state?.plots);
  const newNeighbors = currentPlotHandles.filter((h) => !prevPlotSet.has(h));

  const currentGarden = normalizeGardenSlots(state?.garden);
  const gardenChanges = computeGardenChanges(snapshot.garden, currentGarden);

  return {
    isFirstVisit: false,
    handle: displayHandle,
    repliesToMe,
    newNeighbors,
    gardenChanges,
    newLines,
    nightlyCall,
    dailyGame,
    replyHandles,
  };
}

function appendPromptLine(parentEl, entry, handleById, doc) {
  const line = doc.createElement('div');
  line.className = `pb-line pb-kind-${entry.kind}`;

  if (entry.role === 'npc') {
    const pill = doc.createElement('span');
    pill.className = 'pb-npc-pill';
    pill.textContent = '[NPC]';
    line.appendChild(pill);
  } else if (entry.role === 'guest') {
    const pill = doc.createElement('span');
    pill.className = 'pb-guest-pill';
    pill.textContent = '[guest]';
    line.appendChild(pill);
  }

  if (entry.reply_to !== null) {
    const replyEl = doc.createElement('span');
    replyEl.className = 'pb-reply-to';
    const targetHandle = handleById.get(entry.reply_to);
    replyEl.textContent = targetHandle
      ? `\u21a9 #${entry.reply_to} @${targetHandle}`
      : `\u21a9 #${entry.reply_to}`;
    line.appendChild(replyEl);
  }

  const handleEl = doc.createElement('span');
  handleEl.className = 'pb-handle';
  handleEl.textContent = entry.handle;
  line.appendChild(handleEl);

  const bodyEl = doc.createElement('span');
  bodyEl.className = 'pb-body';
  bodyEl.textContent = entry.kind === 'emote' ? ` ${entry.body}` : `: ${entry.body}`;
  line.appendChild(bodyEl);

  parentEl.appendChild(line);
}

function formatSeedName(seed) {
  return typeof seed === 'string' && seed ? seed.replace(/_/g, ' ') : 'plant';
}

function formatGardenChange(change) {
  const owner = change.handle || 'someone';
  const seedName = formatSeedName(change.seed);
  if (change.to === null) {
    return `${owner}'s ${seedName} is no longer planted`;
  }
  if (change.from === null) {
    return `${owner} planted ${seedName} (${change.to})`;
  }
  if (change.to === 'bloom') {
    return `${owner}'s ${seedName} bloomed`;
  }
  return `${owner}'s ${seedName} grew from ${change.from} to ${change.to}`;
}

function appendSectionHeading(containerEl, title, doc) {
  const h = doc.createElement('h3');
  h.className = 'cu-heading';
  h.textContent = title;
  containerEl.appendChild(h);
}

function appendEmptyNote(containerEl, text, doc) {
  const p = doc.createElement('p');
  p.className = 'pb-empty cu-empty';
  p.textContent = text;
  containerEl.appendChild(p);
}

/**
 * Render the "What you missed" catch-up view into containerEl using textContent only.
 */
export function renderCatchUp(containerEl, catchup, doc = globalThis.document) {
  if (!containerEl || !doc) return;
  while (containerEl.firstChild) {
    containerEl.removeChild(containerEl.firstChild);
  }

  const data = catchup && typeof catchup === 'object' ? catchup : {};
  const isFirstVisit = Boolean(data.isFirstVisit);
  const handle = typeof data.handle === 'string' ? data.handle.trim() : '';
  const repliesToMe = Array.isArray(data.repliesToMe) ? data.repliesToMe : [];
  const newNeighbors = Array.isArray(data.newNeighbors) ? data.newNeighbors : [];
  const gardenChanges = Array.isArray(data.gardenChanges) ? data.gardenChanges : [];
  const newLines = Array.isArray(data.newLines) ? data.newLines : [];

  const handleById = data.replyHandles instanceof Map ? data.replyHandles : new Map();
  if (!(data.replyHandles instanceof Map)) {
    for (const entry of [...repliesToMe, ...newLines]) {
      if (entry && entry.id != null && typeof entry.handle === 'string') {
        handleById.set(entry.id, entry.handle);
      }
    }
  }

  // Handle input row
  const handleRow = doc.createElement('div');
  handleRow.className = 'cu-handle-row';
  const input = doc.createElement('input');
  input.id = 'catchup-handle';
  input.type = 'text';
  input.placeholder = 'your handle';
  input.value = handle;
  handleRow.appendChild(input);
  const hint = doc.createElement('span');
  hint.className = 'cu-hint';
  hint.textContent = 'Applies on next open';
  handleRow.appendChild(hint);
  containerEl.appendChild(handleRow);

  if (isFirstVisit) {
    const welcome = doc.createElement('p');
    welcome.className = 'cu-welcome';
    welcome.textContent =
      "Everything here is new to this browser \u2014 this is your first catch-up; from now on I'll remember what you've seen.";
    containerEl.appendChild(welcome);
  } else if (
    repliesToMe.length === 0 &&
    newNeighbors.length === 0 &&
    gardenChanges.length === 0 &&
    newLines.length === 0
  ) {
    appendEmptyNote(containerEl, 'Nothing new since you last looked.', doc);
  }

  // (a) Replies to my lines
  appendSectionHeading(containerEl, 'Replies to my lines', doc);
  if (!handle) {
    appendEmptyNote(containerEl, 'Enter your handle above to see replies to your lines.', doc);
  } else if (repliesToMe.length === 0) {
    appendEmptyNote(
      containerEl,
      isFirstVisit
        ? 'Nothing to compare against yet \u2014 your first visit is saved now.'
        : 'No replies to your lines since your last visit.',
      doc
    );
  } else {
    for (const entry of repliesToMe) {
      appendPromptLine(containerEl, entry, handleById, doc);
    }
  }

  // (b) New neighbors
  appendSectionHeading(containerEl, 'New neighbors', doc);
  if (newNeighbors.length === 0) {
    appendEmptyNote(
      containerEl,
      isFirstVisit
        ? 'Nothing to compare against yet.'
        : 'No new neighbors since your last visit.',
      doc
    );
  } else {
    for (const neighbor of newNeighbors) {
      const p = doc.createElement('p');
      p.className = 'pb-line cu-neighbor';
      p.textContent = neighbor;
      containerEl.appendChild(p);
    }
  }

  // (c) How the garden grew
  appendSectionHeading(containerEl, 'How the garden grew', doc);
  if (gardenChanges.length === 0) {
    appendEmptyNote(
      containerEl,
      isFirstVisit
        ? 'Nothing to compare against yet.'
        : 'No garden changes since your last visit.',
      doc
    );
  } else {
    for (const change of gardenChanges) {
      const p = doc.createElement('p');
      p.className = 'pb-line cu-garden';
      p.textContent = formatGardenChange(change);
      containerEl.appendChild(p);
    }
  }

  // (d) New lines since your last visit + context
  appendSectionHeading(
    containerEl,
    isFirstVisit ? 'Latest Prompt Book lines' : 'New lines since your last visit',
    doc
  );
  if (newLines.length === 0) {
    appendEmptyNote(containerEl, 'No new lines since your last visit.', doc);
  } else {
    for (const entry of newLines) {
      appendPromptLine(containerEl, entry, handleById, doc);
    }
  }

  // Context: Nightly Call & Daily Game
  appendSectionHeading(containerEl, "Tonight's Nightly Call & Today's Game", doc);
  const callP = doc.createElement('p');
  callP.className = 'pb-line cu-context';
  callP.textContent = data.nightlyCall?.topic
    ? `Nightly Call: ${data.nightlyCall.topic}`
    : 'Nightly Call: None posted.';
  containerEl.appendChild(callP);

  const gameP = doc.createElement('p');
  gameP.className = 'pb-line cu-context';
  gameP.textContent = data.dailyGame?.prompt
    ? `Daily Game: ${data.dailyGame.prompt}`
    : 'Daily Game: None posted.';
  containerEl.appendChild(gameP);
}
