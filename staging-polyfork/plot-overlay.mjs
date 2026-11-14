// Copied verbatim from town-3d/town.js (HANDLE_RE + resolvePlotOverlayContent, lines 1678-1707)
// and town-3d/index.html (Gazette latest.json resolver + #plot-overlay open/close DOM wiring, lines 350-400, 447-453).
// Keep in step with town-3d/; no THREE dependency, no top-level document access.

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * Resolve a resident's desk note for the plot overlay: API-saved HTML first,
 * falling back to the static plots/<handle>/index.html path when offline,
 * invalid, or missing from the API.
 */
export async function resolvePlotOverlayContent(handle, { fetchFn = null, apiBase = '' } = {}) {
  const safeHandle = typeof handle === 'string' ? handle : String(handle ?? '');
  const staticUrl = `plots/${encodeURIComponent(safeHandle)}/index.html`;

  if (typeof handle !== 'string' || !HANDLE_RE.test(handle) || typeof fetchFn !== 'function') {
    return { kind: 'static', url: staticUrl };
  }

  const base = typeof apiBase === 'string' ? apiBase.replace(/\/+$/, '') : '';
  try {
    const res = await fetchFn(`${base}/api/town/plot?handle=${encodeURIComponent(handle)}`);
    if (res && res.status === 200) {
      const data = await res.json();
      if (data && typeof data.html === 'string' && data.html.trim().length > 0) {
        return { kind: 'api', html: data.html };
      }
    }
  } catch {
    // Fall back to static desk note
  }

  return { kind: 'static', url: staticUrl };
}

/**
 * Resolve the latest Ghostlight Gazette issue from gazette/latest.json,
 * falling back to issue-001.html when offline, missing, or malformed.
 */
export async function resolveGazetteOverlayContent({ fetchFn = null } = {}) {
  let issueNum = 1;
  let issueFile = 'issue-001.html';

  if (typeof fetchFn === 'function') {
    try {
      const res = await fetchFn('gazette/latest.json');
      if (res && res.ok) {
        const data = await res.json();
        const current = Array.isArray(data?.issues)
          ? data.issues.find((it) => it.n === data.latest) || data.issues[0]
          : null;
        if (current && typeof current.file === 'string' && /^[a-z0-9._-]+$/i.test(current.file)) {
          issueNum = current.n || 1;
          issueFile = current.file;
        }
      }
    } catch (_) {
      // Fall back to issue-001.html
    }
  }

  return {
    issueNum,
    issueFile,
    url: `gazette/${issueFile}`,
    title: `The Ghostlight Gazette — Issue #${issueNum}`,
  };
}

/**
 * Open the sandboxed plot overlay for a resident's desk note.
 */
export async function openPlotOverlay(handle, {
  overlayEl,
  titleEl,
  iframeEl,
  fetchFn = null,
  apiBase = '',
  onBeforeOpen = null,
} = {}) {
  if (!overlayEl || !titleEl || !iframeEl) return null;
  if (typeof onBeforeOpen === 'function') onBeforeOpen();
  titleEl.textContent = `@${handle} — Desk Note`;
  iframeEl.setAttribute('sandbox', '');
  const resolved = await resolvePlotOverlayContent(handle, { fetchFn, apiBase });
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
 * Open the sandboxed plot overlay for the latest Ghostlight Gazette issue.
 */
export async function openGazetteOverlay({
  overlayEl,
  titleEl,
  iframeEl,
  fetchFn = null,
  onBeforeOpen = null,
} = {}) {
  if (!overlayEl || !titleEl || !iframeEl) return null;
  if (typeof onBeforeOpen === 'function') onBeforeOpen();
  const resolved = await resolveGazetteOverlayContent({ fetchFn });
  titleEl.textContent = resolved.title;
  iframeEl.setAttribute('sandbox', '');
  iframeEl.removeAttribute('srcdoc');
  iframeEl.src = resolved.url;
  overlayEl.hidden = false;
  return resolved;
}

/**
 * Close the sandboxed plot overlay and reset the iframe to about:blank.
 */
export function closePlotOverlay({
  overlayEl,
  iframeEl,
  onAfterClose = null,
} = {}) {
  if (!overlayEl || !iframeEl) return;
  overlayEl.hidden = true;
  iframeEl.removeAttribute('srcdoc');
  iframeEl.src = 'about:blank';
  if (typeof onAfterClose === 'function') onAfterClose();
}
