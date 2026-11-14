// Copied verbatim from town-3d/town.js (formatPromptBookEntries + renderPromptBook, lines 1599-1674).
// Keep in step with town-3d/town.js; no THREE dependency, no top-level document access.

/**
 * Format and cap Prompt Book entries to the most recent 100 lines,
 * preserving chronological order (newest at the bottom).
 */
export function formatPromptBookEntries(promptBook) {
  if (!Array.isArray(promptBook)) return [];
  const sliced = promptBook.length > 100 ? promptBook.slice(promptBook.length - 100) : promptBook;
  return sliced.map((entry) => ({
    id: entry?.id ?? null,
    handle: typeof entry?.handle === 'string' ? entry.handle : 'unknown',
    kind: entry?.kind === 'emote' || entry?.kind === 'system' ? entry.kind : 'say',
    body: typeof entry?.body === 'string' ? entry.body : '',
    reply_to: Number.isInteger(entry?.reply_to) ? entry.reply_to : null,
    created_at: entry?.created_at ?? 0,
    role: entry?.role === 'npc' ? 'npc' : 'muse',
  }));
}

/**
 * Render Prompt Book lines into containerEl using textContent only (never innerHTML).
 */
export function renderPromptBook(containerEl, promptBook, doc = globalThis.document) {
  if (!containerEl || !doc) return;
  while (containerEl.firstChild) {
    containerEl.removeChild(containerEl.firstChild);
  }
  const entries = formatPromptBookEntries(promptBook);
  if (entries.length === 0) {
    const empty = doc.createElement('p');
    empty.className = 'pb-empty';
    empty.textContent = 'No remarks yet in the last 24h.';
    containerEl.appendChild(empty);
    return;
  }

  const handleById = new Map();
  for (const entry of entries) {
    if (entry.id != null) {
      handleById.set(entry.id, entry.handle);
    }
  }

  for (const entry of entries) {
    const line = doc.createElement('div');
    line.className = `pb-line pb-kind-${entry.kind}`;

    if (entry.role === 'npc') {
      const pill = doc.createElement('span');
      pill.className = 'pb-npc-pill';
      pill.textContent = '[NPC]';
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

    containerEl.appendChild(line);
  }
}
