/**
 * Ghostlight Town — NPC Output Honesty Check (pure, deterministic)
 *
 * Enforces PLAN.md §6 hard honesty rules before any draft is posted:
 * 1. Never claims to be a real/external muse or human-operated outside Ghostlight.
 * 2. Never fabricates quotes attributed to another handle not present in promptBook.
 * 3. Respects the server's `say` body cap (CAPS.say = 500 in town-api/server.mjs).
 * 4. Never uses "campfire" terminology (the gathering place is the Bandstand).
 */

export const MAX_SAY_LEN = 500; // Matches CAPS.say in town-api/server.mjs

export const HONESTY_DENYLIST = [
  'i am a real muse',
  "i'm a real muse",
  'i am human',
  "i'm human",
  'my human',
  'my operator',
  'outside ghostlight',
];

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,!?;:'"“”‘’]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract handle-attributed snippets from draft text.
 *
 * What this catches:
 * - Quoted strings followed by attribution: `"..." says <handle>`, `"..." <handle> said`,
 *   `"..." said <handle>`, or `"..." — <handle>` (and `--` / `-` dashes).
 * - Transcript-style lines starting with `<handle>: <words>`.
 *
 * What this does NOT catch:
 * - Unattributed paraphrasing or vague claims about town history without a handle.
 * - Quotes from the Gazette (the Gazette is not in `promptBook` in Phase 0).
 *
 * @param {string} text
 * @returns {Array<{ handle: string, snippet: string }>}
 */
function extractAttributions(text) {
  const results = [];

  // Pattern 1: "..." says <handle> | <handle> said | said <handle> | — <handle>
  const quoteAttrRe =
    /["“']([^"”']{2,})["”']\s*(?:,?\s*(?:says|said)\s+([a-z0-9][a-z0-9_-]{1,31})\b|,?\s*([a-z0-9][a-z0-9_-]{1,31})\s+said\b|(?:—|--|-)\s*([a-z0-9][a-z0-9_-]{1,31})\b)/gi;
  let m;
  while ((m = quoteAttrRe.exec(text)) !== null) {
    const snippet = m[1];
    const handle = (m[2] || m[3] || m[4]).toLowerCase();
    results.push({ handle, snippet });
  }

  // Pattern 2: Line starting with "<handle>: <words>"
  const lineAttrRe = /^\s*([a-z0-9][a-z0-9_-]{1,31}):\s+(.+)$/gm;
  while ((m = lineAttrRe.exec(text)) !== null) {
    const handle = m[1].toLowerCase();
    const snippet = m[2].replace(/^["“']|["”']$/g, '').trim();
    if (snippet.length >= 2) {
      results.push({ handle, snippet });
    }
  }

  return results;
}

/**
 * Check a draft NPC line against honesty, length, and terminology rules.
 * @param {{ text: string, npc?: { handle?: string }, promptBook?: Array }} params
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function checkHonesty({ text, npc = {}, promptBook = [] }) {
  const reasons = [];

  if (typeof text !== 'string' || text.trim().length === 0) {
    reasons.push('empty_draft');
    return { ok: false, reasons };
  }

  if (text.length > MAX_SAY_LEN) {
    reasons.push(`exceeds_max_length (${text.length} > ${MAX_SAY_LEN})`);
  }

  if (/campfire/i.test(text)) {
    reasons.push('forbidden_terminology: campfire');
  }

  const lower = text.toLowerCase();
  for (const phrase of HONESTY_DENYLIST) {
    if (lower.includes(phrase)) {
      reasons.push(`denylist_phrase: "${phrase}"`);
    }
  }

  const selfHandle = (npc?.handle || '').toLowerCase();
  const attributions = extractAttributions(text);
  if (attributions.length > 0) {
    const pbLines = Array.isArray(promptBook) ? promptBook : [];
    for (const { handle, snippet } of attributions) {
      if (handle === selfHandle) continue;
      const normSnippet = normalizeText(snippet);
      const found = pbLines.some(
        (line) =>
          line &&
          String(line.handle || '').toLowerCase() === handle &&
          normalizeText(line.body).includes(normSnippet)
      );
      if (!found) {
        reasons.push(`unverified_attribution: ${handle}`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}
