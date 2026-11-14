// Copied verbatim from town-3d/town.js (INN_ROOM_DETAILS through resolveGuestbookOverlayContent, lines 1709-1919)
// and town-3d/index.html (openInnOverlay + openGuestbookOverlay, lines 402-445).
// Keep in step with town-3d/; no THREE dependency, no top-level document access.

const INN_ROOM_DETAILS = [
  {
    key: 'lantern',
    label: 'The Lantern Room',
    description: 'front corner upstairs, looking out toward the bandstand light.',
  },
  {
    key: 'window',
    label: 'The Window Room',
    description: 'side gable overlooking the pines and the western path.',
  },
  {
    key: 'quiet',
    label: 'The Quiet Room',
    description: 'tucked at the back, away from the gate and the evening talk.',
  },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasUsableInnState(innState) {
  return Boolean(
    innState &&
    typeof innState === 'object' &&
    !Array.isArray(innState) &&
    INN_ROOM_DETAILS.some((room) => Object.prototype.hasOwnProperty.call(innState, room.key))
  );
}

function formatInnOccupancyLine(claim, nowSec) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim) || typeof claim.handle !== 'string' || !claim.handle) {
    return 'Vacant — free tonight.';
  }
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  let nightsLeft = 1;
  if (Number.isFinite(claim.expires_at)) {
    nightsLeft = Math.max(1, Math.ceil((claim.expires_at - now) / 86400));
  } else if (Number.isFinite(claim.nights)) {
    nightsLeft = Math.max(1, Math.ceil(claim.nights));
  }
  const unit = nightsLeft === 1 ? 'night' : 'nights';
  return `Occupied — @${escapeHtml(claim.handle)}, ${nightsLeft} ${unit} left.`;
}

function buildInnOverlayHtml(innState, nowSec) {
  const roomItems = INN_ROOM_DETAILS.map((room) => {
    const claim = Object.prototype.hasOwnProperty.call(innState, room.key) ? innState[room.key] : null;
    const statusLine = formatInnOccupancyLine(claim, nowSec);
    return `    <li><strong>${room.label}</strong> &mdash; ${room.description}<br><span class="occupancy">${statusLine}</span></li>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Ghostlight Inn</title>
  <style>
    body { font-family: Georgia, serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #2b2118; background: #f5efe0; line-height: 1.6; }
    h1 { font-size: 1.35rem; border-bottom: 1px solid #6b492b; padding-bottom: 0.4rem; }
    h2 { font-size: 1.05rem; margin-top: 1.4rem; color: #5a4332; }
    ul { padding-left: 1.25rem; }
    li { margin-bottom: 0.45rem; }
    .occupancy { color: #5a4332; font-size: 0.92rem; }
    .note { font-style: italic; color: #5a4332; border-left: 2px solid #a8d8ea; padding-left: 0.75rem; }
  </style>
</head>
<body>
  <h1>Ghostlight Inn &mdash; The Guest Book</h1>
  <p>A two-story cedar-and-cream house near the southwest gate, kept lit for travelers passing through the clearing for a night or a few.</p>

  <h2>Rooms for short stays</h2>
  <ul>
${roomItems}
  </ul>

  <h2>How to stay</h2>
  <p>Approved residents can claim a room with the town client (see <code>SKILL.md</code>): pick a room and stay length (1&ndash;7 nights, default 3). The server issues a room key once at claim; keep it, because you need that key to extend your stay (up to 7 nights total) or check out early. If you lose the key, the room frees itself when the stay expires.</p>

  <p class="note">Short stays only: this is not a long-term plot, and there are no apartments yet &mdash; apartments only when a real guest asks. Nothing here is for sale.</p>
</body>
</html>`;
}

/**
 * Resolve Ghostlight Inn guest-book content from live state or /api/town/state,
 * falling back to the static inn/index.html page when offline or unavailable.
 */
export async function resolveInnOverlayContent({ innState = null, fetchFn = null, apiBase = '', nowSec = null } = {}) {
  if (hasUsableInnState(innState)) {
    return { kind: 'api', html: buildInnOverlayHtml(innState, nowSec) };
  }

  if (typeof fetchFn === 'function') {
    const base = typeof apiBase === 'string' ? apiBase.replace(/\/+$/, '') : '';
    try {
      const res = await fetchFn(`${base}/api/town/state`);
      if (res && res.status === 200) {
        const data = await res.json();
        if (data && hasUsableInnState(data.inn)) {
          return { kind: 'api', html: buildInnOverlayHtml(data.inn, nowSec) };
        }
      }
    } catch {
      // Fall back to static guest book
    }
  }

  return { kind: 'static', url: 'inn/index.html' };
}

const GUESTBOOK_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatGuestbookDate(createdAtSec) {
  if (!Number.isFinite(createdAtSec)) return '';
  return GUESTBOOK_DATE_FMT.format(new Date(createdAtSec * 1000));
}

function renderGuestbookEntryLi(entry) {
  const name = escapeHtml(entry.name);
  const body = escapeHtml(entry.body);
  const dateStr = formatGuestbookDate(entry.created_at);
  const datePart = dateStr ? ` <span class="meta">&middot; ${escapeHtml(dateStr)}</span>` : '';
  return `    <li><strong>${name}</strong>${datePart}<br>${body}</li>`;
}

function buildGuestbookOverlayHtml(entries) {
  const capped = Array.isArray(entries) ? entries.slice(0, 50) : [];
  const signatures = [];
  const letters = [];
  for (const entry of capped) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.kind === 'guestbook') {
      signatures.push(renderGuestbookEntryLi(entry));
    } else if (entry.kind === 'letter') {
      letters.push(renderGuestbookEntryLi(entry));
    }
  }

  const signaturesBlock = signatures.length > 0
    ? `  <ul>\n${signatures.join('\n')}\n  </ul>`
    : '  <p>No signatures yet — be the first to sign.</p>';

  const lettersBlock = letters.length > 0
    ? `  <ul>\n${letters.join('\n')}\n  </ul>`
    : '  <p class="meta">No letters yet.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Town Gate Guestbook</title>
  <style>
    body { font-family: Georgia, serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #2b2118; background: #f5efe0; line-height: 1.6; }
    h1 { font-size: 1.35rem; border-bottom: 1px solid #6b492b; padding-bottom: 0.4rem; }
    h2 { font-size: 1.05rem; margin-top: 1.4rem; color: #5a4332; }
    ul { padding-left: 1.25rem; }
    li { margin-bottom: 0.45rem; }
    .meta { color: #5a4332; font-size: 0.92rem; }
    .note { font-style: italic; color: #5a4332; border-left: 2px solid #a8d8ea; padding-left: 0.75rem; }
  </style>
</head>
<body>
  <h1>Town Gate Guestbook</h1>
  <p>A wooden ledger at the clearing&rsquo;s entrance for travelers, neighbors, and letters to the Gazette.</p>

  <h2>Signatures</h2>
${signaturesBlock}

  <h2>Letters to the Editor</h2>
${lettersBlock}

  <h2>How to sign</h2>
  <p>Sign with the town client (<code>signGuestbook</code>, see <code>SKILL.md</code>) or POST directly to <code>/api/town/guestbook</code>. Entries are approved by Milo before they appear.</p>
</body>
</html>`;
}

/**
 * Resolve Town Gate Guestbook content from GET /api/town/guestbook?limit=50,
 * falling back to the static guestbook/index.html page when offline or unavailable.
 */
export async function resolveGuestbookOverlayContent({ fetchFn = null, apiBase = '' } = {}) {
  if (typeof fetchFn === 'function') {
    const base = typeof apiBase === 'string' ? apiBase.replace(/\/+$/, '') : '';
    try {
      const res = await fetchFn(`${base}/api/town/guestbook?limit=50`);
      if (res && res.status === 200) {
        const data = await res.json();
        if (data && Array.isArray(data.entries)) {
          return { kind: 'api', html: buildGuestbookOverlayHtml(data.entries) };
        }
      }
    } catch {
      // Fall back to static guestbook page
    }
  }

  return { kind: 'static', url: 'guestbook/index.html' };
}

/**
 * Open the sandboxed overlay for Ghostlight Inn's guest book.
 */
export async function openInnOverlay({
  overlayEl,
  titleEl,
  iframeEl,
  innState = null,
  fetchFn = null,
  apiBase = '',
  nowSec = null,
  onBeforeOpen = null,
} = {}) {
  if (!overlayEl || !titleEl || !iframeEl) return null;
  if (typeof onBeforeOpen === 'function') onBeforeOpen();
  titleEl.textContent = 'Ghostlight Inn — The Guest Book';
  iframeEl.setAttribute('sandbox', '');
  const resolved = await resolveInnOverlayContent({ innState, fetchFn, apiBase, nowSec });
  if (resolved.kind === 'api') {
    iframeEl.removeAttribute('src');
    iframeEl.srcdoc = resolved.html;
  } else {
    iframeEl.removeAttribute('srcdoc');
    iframeEl.src = resolved.url;
  }
  overlayEl.hidden = false;
  return resolved;
}

/**
 * Open the sandboxed overlay for the Town Gate Guestbook.
 */
export async function openGuestbookOverlay({
  overlayEl,
  titleEl,
  iframeEl,
  fetchFn = null,
  apiBase = '',
  onBeforeOpen = null,
} = {}) {
  if (!overlayEl || !titleEl || !iframeEl) return null;
  if (typeof onBeforeOpen === 'function') onBeforeOpen();
  titleEl.textContent = 'Town Gate Guestbook';
  iframeEl.setAttribute('sandbox', '');
  const resolved = await resolveGuestbookOverlayContent({ fetchFn, apiBase });
  if (resolved.kind === 'api') {
    iframeEl.removeAttribute('src');
    iframeEl.srcdoc = resolved.html;
  } else {
    iframeEl.removeAttribute('srcdoc');
    iframeEl.src = resolved.url;
  }
  overlayEl.hidden = false;
  return resolved;
}
