/**
 * Ghostlight Town — town-api events loader and selector.
 *
 * `validateEventEntry` and `selectCurrentEvent` (and their constants) are
 * vendored verbatim from `staging-polyfork/event-banner.mjs`. Drift is guarded
 * by the parity test in `town-api/test-events.mjs`.
 *
 * Node built-ins only; no THREE import, no top-level `document`.
 */

import fs from 'node:fs';

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const MIN_DURATION_MIN = 15;
const MAX_DURATION_MIN = 240;
const MAX_TITLE_LEN = 80;
const MAX_BLURB_LEN = 200;

function validateEventEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (typeof entry.title !== 'string') return null;
  const title = entry.title.trim();
  if (!title || title.length > MAX_TITLE_LEN) return null;

  if (typeof entry.host_handle !== 'string') return null;
  const hostHandle = entry.host_handle.trim();
  if (!HANDLE_RE.test(hostHandle)) return null;

  if (typeof entry.start_at !== 'string' || !entry.start_at.trim()) return null;
  const startMs = Date.parse(entry.start_at);
  if (!Number.isFinite(startMs)) return null;

  if (
    typeof entry.duration_min !== 'number' ||
    !Number.isFinite(entry.duration_min) ||
    entry.duration_min < MIN_DURATION_MIN ||
    entry.duration_min > MAX_DURATION_MIN
  ) {
    return null;
  }

  if (typeof entry.location !== 'string') return null;
  const location = entry.location.trim();

  if (typeof entry.blurb !== 'string') return null;
  const blurb = entry.blurb.trim();
  if (blurb.length > MAX_BLURB_LEN) return null;

  return {
    title,
    host_handle: hostHandle,
    start_at: entry.start_at.trim(),
    duration_min: entry.duration_min,
    location,
    blurb,
  };
}

/**
 * Select the active `'now'` event (start_at <= nowMs < start_at + duration_min)
 * or the earliest upcoming `'next'` event (start_at > nowMs). Past and invalid
 * entries are ignored. Returns `null` when none applies.
 */
export function selectCurrentEvent(events, nowMs = Date.now()) {
  if (!Array.isArray(events) || !Number.isFinite(nowMs)) return null;
  let nowCandidate = null;
  let nowStartMs = Infinity;
  let nextCandidate = null;
  let nextStartMs = Infinity;

  for (const raw of events) {
    const ev = validateEventEntry(raw);
    if (!ev) continue;
    const startMs = Date.parse(ev.start_at);
    const endMs = startMs + ev.duration_min * 60_000;
    if (startMs <= nowMs && nowMs < endMs) {
      if (startMs < nowStartMs) {
        nowStartMs = startMs;
        nowCandidate = ev;
      }
    } else if (startMs > nowMs) {
      if (startMs < nextStartMs) {
        nextStartMs = startMs;
        nextCandidate = ev;
      }
    }
  }

  if (nowCandidate) return { event: nowCandidate, status: 'now' };
  if (nextCandidate) return { event: nextCandidate, status: 'next' };
  return null;
}

/**
 * Return `{ now, next }` from an events array at `nowMs`:
 * - `now`: the active `'now'` event from `selectCurrentEvent` (or `null`)
 * - `next`: the earliest future event (`start_at > nowMs`), whether or not `now` exists
 * Past and invalid entries are ignored.
 */
export function selectNowNext(events, nowMs = Date.now()) {
  if (!Array.isArray(events) || !Number.isFinite(nowMs)) {
    return { now: null, next: null };
  }
  const current = selectCurrentEvent(events, nowMs);
  const nowEvent = current && current.status === 'now' ? current.event : null;

  let nextEvent = null;
  if (current && current.status === 'next') {
    nextEvent = current.event;
  } else {
    let nextStartMs = Infinity;
    for (const raw of events) {
      const ev = validateEventEntry(raw);
      if (!ev) continue;
      const startMs = Date.parse(ev.start_at);
      if (startMs > nowMs && startMs < nextStartMs) {
        nextStartMs = startMs;
        nextEvent = ev;
      }
    }
  }

  return { now: nowEvent, next: nextEvent };
}

/**
 * Load and validate an `events.json` file from disk. Fail-open: invalid
 * entries are skipped, and any missing/unreadable/malformed file or invalid
 * path returns `{ events: [] }` without throwing.
 */
export function loadEventsFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    return { events: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.events)) {
      return { events: [] };
    }
    const events = [];
    for (const entry of data.events) {
      const valid = validateEventEntry(entry);
      if (valid) events.push(valid);
    }
    return { events };
  } catch {
    return { events: [] };
  }
}

/**
 * Build the state key for event-flip detection (`now|title|start_at`,
 * `next|title|start_at`, or `''`). Matches `liveStore.eventBannerKey`.
 */
export function eventStateKey(nowEvent, nextEvent) {
  if (nowEvent) return `now|${nowEvent.title}|${nowEvent.start_at}`;
  if (nextEvent) return `next|${nextEvent.title}|${nextEvent.start_at}`;
  return '';
}
