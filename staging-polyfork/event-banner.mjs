// Staging-local Bandstand event banner + Prompt Book event header.
// No THREE import; no top-level document access.

import { splitNightlyCallLines } from './inn-nightly-call.mjs';

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
  const startMs = Date.parse(entry.start_at.trim());
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
 * Fetch and validate `events.json`. Fail-open: invalid entries are skipped,
 * and any fetch/parse/shape failure returns `{ events: [] }` without throwing.
 */
export async function loadEvents(fetchFn = fetch) {
  if (typeof fetchFn !== 'function') return { events: [] };
  try {
    const res = await fetchFn('events.json');
    if (!res || !res.ok) return { events: [] };
    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.events)) {
      return { events: [] };
    }
    const events = [];
    for (const raw of data.events) {
      const valid = validateEventEntry(raw);
      if (valid) events.push(valid);
    }
    return { events };
  } catch {
    return { events: [] };
  }
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
 * Build the 3D Bandstand `event_banner` card lines.
 */
export function eventBannerLines(event, status) {
  const heading = status === 'now' ? 'EVENTS' : 'NEXT EVENT';
  const title = typeof event?.title === 'string' ? event.title.trim() : '';
  return [heading, ...splitNightlyCallLines(title)];
}

/**
 * Update and toggle the Bandstand's `event_banner` 3D card.
 * Hides the card and returns `false` when no event is active/upcoming or card is missing.
 */
export function updateEventBanner(
  { THREE, bandstandBuilt, liveStore, makeTextTexture },
  event,
  status
) {
  const card =
    bandstandBuilt?.eventBanner ||
    (bandstandBuilt?.group?.children || []).find((c) => c && c.name === 'event_banner') ||
    null;
  if (!card) return false;

  if (!event || (status !== 'now' && status !== 'next')) {
    card.visible = false;
    if (liveStore) liveStore.eventBannerKey = null;
    return false;
  }

  if (!card.material || !THREE || !liveStore || typeof makeTextTexture !== 'function') {
    return false;
  }

  const key = `${status}|${event.title}|${event.start_at}`;
  if (liveStore.eventBannerKey === key) return false;

  card.material.map = makeTextTexture(THREE, eventBannerLines(event, status), {
    width: 768,
    height: 256,
    titleSize: 30,
    subSize: 20,
    bg: '#f2e6cf',
    border: '#b59449',
    fg: '#2b1e14',
  });
  card.material.needsUpdate = true;
  card.visible = true;
  liveStore.eventBannerKey = key;
  return true;
}

/**
 * Format an event start timestamp for the Prompt Book header.
 */
export function formatEventWhen(startMs) {
  if (!Number.isFinite(startMs)) return '';
  return new Date(startMs).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Update the Prompt Book event header element using `textContent` only.
 * Null/missing element is a no-op.
 */
export function renderEventBannerHeader(headerEl, event, status) {
  if (!headerEl) return false;
  if (!event || (status !== 'now' && status !== 'next')) {
    headerEl.hidden = true;
    headerEl.textContent = '';
    return false;
  }
  if (status === 'now') {
    headerEl.textContent = `Now: ${event.title} — hosted by @${event.host_handle}`;
  } else {
    const when = formatEventWhen(Date.parse(event.start_at));
    headerEl.textContent = `Next: ${event.title} — ${when} · hosted by @${event.host_handle}`;
  }
  headerEl.hidden = false;
  return true;
}
