/**
 * Ghostlight Town — Phase 0 NPC Step-Back & Handover Logic (pure)
 *
 * Implements PLAN.md §6 + §12.2 Argon fix #5:
 * - Retire at >= 10 active real muses (24h).
 * - Reply-only at >= 5 active real muses (24h) or >= 2 currently lit real muses.
 * - Cap ambient initiations at 2/day when no real muse has spoken in 6h.
 * - Replies when addressed in the last 30 min are always allowed (unless retired).
 */

import { CHARACTERS } from './characters.mjs';

const DAY_SEC = 24 * 3600;
const SIX_HOURS_SEC = 6 * 3600;
const THREE_HOURS_SEC = 3 * 3600;
const THIRTY_MIN_SEC = 30 * 60;
export const AMBIENT_DAILY_CAP = 2;

/**
 * Format unix seconds as local YYYY-MM-DD calendar date.
 * @param {number} nowSec
 * @returns {string}
 */
export function localDateString(nowSec) {
  const d = new Date(nowSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Find Prompt Book lines in the last 30 minutes that address this NPC by
 * handle or name (case-insensitive), excluding lines authored by the NPC.
 * @param {{ npc: { handle: string, name: string }, promptBook: Array, now: number }} params
 * @returns {Array}
 */
export function findAddressedLines({ npc, promptBook = [], now }) {
  const cutoff = now - THIRTY_MIN_SEC;
  const handleLower = npc.handle.toLowerCase();
  const nameLower = (npc.name || npc.handle).toLowerCase();

  return promptBook.filter((line) => {
    if (!line || line.handle === npc.handle) return false;
    if (typeof line.created_at !== 'number' || line.created_at < cutoff) return false;
    const body = String(line.body || '').toLowerCase();
    return body.includes(handleLower) || body.includes(nameLower);
  });
}

/**
 * Find the latest unanswered real-muse Prompt Book line within the 3h reply
 * window and deterministically designate the single NPC who should reply.
 *
 * Designation order (first match wins):
 * 1. Addressed NPC (via findAddressedLines)
 * 2. Presence-zone hook (author present at `plot:<npc>` within 3h)
 * 3. Deterministic rotation: `line.id % CHARACTERS.length` over canonical
 *    CHARACTERS order `[wick, maren, tomas]`. Falls back to
 *    `created_at % CHARACTERS.length` if `line.id` is missing or not an integer
 *    (defensive fallback for test fixtures).
 *
 * @param {{ state?: object, now?: number }} params
 * @returns {{ line: object, designatedHandle: string, method: 'addressed'|'plot-zone'|'rotation' } | null}
 */
export function selectReplierForLine({ state = {}, now = Math.floor(Date.now() / 1000) } = {}) {
  const promptBook = Array.isArray(state.prompt_book) ? state.prompt_book : [];
  const presence = Array.isArray(state.presence) ? state.presence : [];

  let latestMuseLine = null;
  for (const line of promptBook) {
    if (!line || line.role !== 'muse') continue;
    if (line.kind && line.kind !== 'say' && line.kind !== 'emote') continue;
    if (typeof line.created_at !== 'number') continue;
    if (!latestMuseLine || line.created_at >= latestMuseLine.created_at) {
      latestMuseLine = line;
    }
  }

  if (!latestMuseLine) return null;

  const cutoff3h = now - THREE_HOURS_SEC;
  if (latestMuseLine.created_at < cutoff3h) return null;

  const answered = promptBook.some(
    (p) => p && p.role === 'npc' && typeof p.created_at === 'number' && p.created_at > latestMuseLine.created_at
  );
  if (answered) return null;

  // 2a. Addressed NPC
  for (const char of CHARACTERS) {
    const addressed = findAddressedLines({
      npc: char,
      promptBook: [latestMuseLine],
      now: latestMuseLine.created_at,
    });
    if (addressed.length > 0) {
      return {
        line: latestMuseLine,
        designatedHandle: char.handle,
        method: 'addressed',
      };
    }
  }

  // 2b. Presence-zone hook (`plot:<handle>` within the 3h window)
  let latestPresence = null;
  for (const pr of presence) {
    if (
      pr &&
      pr.handle === latestMuseLine.handle &&
      typeof pr.updated_at === 'number' &&
      pr.updated_at >= cutoff3h &&
      typeof pr.zone === 'string' &&
      pr.zone.startsWith('plot:')
    ) {
      if (!latestPresence || pr.updated_at >= latestPresence.updated_at) {
        latestPresence = pr;
      }
    }
  }
  if (latestPresence) {
    const plotHandle = latestPresence.zone.slice('plot:'.length);
    const plotNpc = CHARACTERS.find((c) => c.handle === plotHandle);
    if (plotNpc) {
      return {
        line: latestMuseLine,
        designatedHandle: plotNpc.handle,
        method: 'plot-zone',
      };
    }
  }

  // 2c. Deterministic rotation (falls back to created_at when id is not an integer)
  const seed = Number.isInteger(latestMuseLine.id) ? latestMuseLine.id : Math.trunc(latestMuseLine.created_at);
  const idx = ((seed % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length;
  return {
    line: latestMuseLine,
    designatedHandle: CHARACTERS[idx].handle,
    method: 'rotation',
  };
}

/**
 * Decide what turn action an NPC should take given current town state.
 * @param {{ npc: object, state: object, npcState?: object, now?: number }} params
 * @returns {{ action: 'initiate'|'reply'|'silent'|'retired', reason: string, replyLine: { id: number|null, handle: string }|null }}
 */
export function decideTurn({
  npc,
  state = {},
  npcState = {},
  now = Math.floor(Date.now() / 1000),
}) {
  const footlights = Array.isArray(state.footlights) ? state.footlights : [];
  const promptBook = Array.isArray(state.prompt_book) ? state.prompt_book : [];
  const presence = Array.isArray(state.presence) ? state.presence : [];

  const litRealMuses = footlights.filter((f) => f && f.role === 'muse').length;

  const dayCutoff = now - DAY_SEC;
  const activeRealHandles = new Set();
  for (const f of footlights) {
    if (f && f.role === 'muse' && f.handle) activeRealHandles.add(f.handle);
  }
  for (const p of promptBook) {
    if (p && p.role === 'muse' && p.handle && p.created_at >= dayCutoff) {
      activeRealHandles.add(p.handle);
    }
  }
  for (const pr of presence) {
    if (pr && pr.role === 'muse' && pr.handle && pr.updated_at >= dayCutoff) {
      activeRealHandles.add(pr.handle);
    }
  }
  const activeRealCount = activeRealHandles.size;

  // 1. Handover: 10+ distinct real muses active -> retired
  if (activeRealCount >= 10) {
    return {
      action: 'retired',
      reason: `${activeRealCount} real muses active in 24h (>= 10); retired to town-staff role`,
      replyLine: null,
    };
  }

  const addressedLines = findAddressedLines({ npc, promptBook, now });
  const isAddressed = addressedLines.length > 0;
  const latestAddressed = isAddressed ? addressedLines[addressedLines.length - 1] : null;
  const addressedReplyLine = latestAddressed
    ? { id: latestAddressed.id ?? null, handle: latestAddressed.handle }
    : null;

  // 2. Handover: 5+ distinct real muses active -> reply-only
  if (activeRealCount >= 5) {
    if (isAddressed) {
      return {
        action: 'reply',
        reason: `${activeRealCount} real muses active in 24h (>= 5, reply-only); addressed in Prompt Book`,
        replyLine: addressedReplyLine,
      };
    }
    return {
      action: 'silent',
      reason: `${activeRealCount} real muses active in 24h (>= 5, reply-only) and not addressed`,
      replyLine: null,
    };
  }

  // 3. Step-back: 2+ real muses currently lit -> reply-only
  if (litRealMuses >= 2) {
    if (isAddressed) {
      return {
        action: 'reply',
        reason: `${litRealMuses} real muses lit (>= 2, reply-only); addressed in Prompt Book`,
        replyLine: addressedReplyLine,
      };
    }
    return {
      action: 'silent',
      reason: `${litRealMuses} real muses lit (>= 2, reply-only) and not addressed`,
      replyLine: null,
    };
  }

  // 4. Direct reply when addressed (never counts against ambient cap)
  if (isAddressed) {
    return {
      action: 'reply',
      reason: 'addressed in Prompt Book within last 30m',
      replyLine: addressedReplyLine,
    };
  }

  // 5. Ambient cap when no real muse has spoken in 6h
  const sixHourCutoff = now - SIX_HOURS_SEC;
  const realMuseSpokeIn6h = promptBook.some(
    (p) => p && p.role === 'muse' && typeof p.created_at === 'number' && p.created_at >= sixHourCutoff
  );

  if (!realMuseSpokeIn6h) {
    const today = localDateString(now);
    const ambientToday =
      npcState && npcState.ambient_date === today ? Number(npcState.ambient_today || 0) : 0;
    if (ambientToday >= AMBIENT_DAILY_CAP) {
      return {
        action: 'silent',
        reason: `no real muse spoke in 6h and ambient cap (${AMBIENT_DAILY_CAP}/day) reached`,
        replyLine: null,
      };
    }
    return {
      action: 'initiate',
      reason: `no real muse spoke in 6h; ambient observation allowed (${ambientToday}/${AMBIENT_DAILY_CAP} today)`,
      replyLine: null,
    };
  }

  // 6. Per-line reply selectivity: at most one designated NPC replies to an unanswered muse line (3h)
  const designation = selectReplierForLine({ state, now });
  if (designation) {
    const lineId = designation.line.id ?? '?';
    if (designation.designatedHandle === npc.handle) {
      return {
        action: 'reply',
        reason: `designated replier for muse line #${lineId} (${designation.method})`,
        replyLine: { id: designation.line.id ?? null, handle: designation.line.handle },
      };
    }
    return {
      action: 'silent',
      reason: `not the designated replier for muse line #${lineId} (${designation.designatedHandle} is)`,
      replyLine: null,
    };
  }

  // 7. Routine turn: no recent unanswered muse line, real muse spoke within 6h, fewer than 2 lit
  return {
    action: 'initiate',
    reason: 'routine turn; real muse spoke within 6h and fewer than 2 lit',
    replyLine: null,
  };
}
