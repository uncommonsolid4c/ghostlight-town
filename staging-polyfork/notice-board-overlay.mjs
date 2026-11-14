/**
 * Notice Board overlay module for staging-polyfork (Slice 79).
 *
 * NOTICE_BOARD_PAPERS, escapeHtml, and buildNoticeBoardOverlayHtml are vendored
 * verbatim from town-3d/town.js (see test-notice-board-overlay.mjs drift guard).
 */

const NOTICE_BOARD_PAPERS = [
  ['notice_board_paper_gazette', -0.60, ['GAZETTE #2', 'Issue #2 is out —', 'read it at the', 'newsstand.']],
  ['notice_board_paper_inn', 0, ['THE INN', 'Rooms for short', 'stays — ask at', 'the tavern.']],
  ['notice_board_paper_gate', 0.60, ['SOCIAL GATE', 'Plots are free,', 'no upkeep — yours', 'outright. Bring a', 'friend.']],
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build static HTML for the Notice Board overlay from NOTICE_BOARD_PAPERS.
 */
export function buildNoticeBoardOverlayHtml() {
  const noticesHtml = NOTICE_BOARD_PAPERS.map(([, , lines]) => {
    const title = escapeHtml(lines[0] ?? '');
    const body = escapeHtml(lines.slice(1).join(' '));
    return `  <section class="notice">\n    <h2>${title}</h2>\n    <p>${body}</p>\n  </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notice Board</title>
  <style>
    body { font-family: Georgia, serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #2b2118; background: #f5efe0; line-height: 1.6; }
    h1 { font-size: 1.35rem; border-bottom: 1px solid #6b492b; padding-bottom: 0.4rem; }
    h2 { font-size: 1.05rem; margin-top: 1.4rem; margin-bottom: 0.3rem; color: #5a4332; }
    .notice p { margin: 0; }
  </style>
</head>
<body>
  <h1>Notice Board</h1>
${noticesHtml}
</body>
</html>`;
}

/**
 * Open the sandboxed overlay for the Town Notice Board.
 */
export function openNoticeBoardOverlay({
  overlayEl,
  titleEl,
  iframeEl,
  onBeforeOpen = null,
} = {}) {
  if (!overlayEl || !titleEl || !iframeEl) return null;
  if (typeof onBeforeOpen === 'function') onBeforeOpen();
  titleEl.textContent = 'Notice Board';
  iframeEl.setAttribute('sandbox', '');
  const html = buildNoticeBoardOverlayHtml();
  iframeEl.removeAttribute('src');
  iframeEl.srcdoc = html;
  overlayEl.hidden = false;
  return html;
}
