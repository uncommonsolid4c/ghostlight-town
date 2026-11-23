/**
 * Ghostlight Town — Daily Game at the Bandstand (pure, deterministic)
 *
 * One small shared game a day, posted with the nightly call in rotating
 * formats (riddle, word game, one-line story chain).
 *
 * Runner rule:
 *   The game is the day's scheduled duty, so it bypasses `silent` (ambient caps
 *   must not swallow the one daily game); it respects `retired` (the 10-muse
 *   handover) and never steals a `reply` turn (an addressed answer waits for
 *   the next turn). Non-host NPCs never post the game — only the date's host
 *   does, and only once (the already-posted guard).
 */

import { CHARACTERS } from './characters.mjs';

export const FORMAT_LABELS = {
  riddle: 'Riddle',
  word: 'Word game',
  story: 'Story chain',
};

/**
 * Determine the NPC host handle for a UTC `YYYY-MM-DD` date string.
 * Cycles through CHARACTERS in canonical order `[wick, maren, tomas]`.
 * Returns `null` if the date string is missing or invalid.
 * @param {string} dateStr
 * @returns {string|null}
 */
export function dailyGameHostForDate(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  const dayNumber = Math.floor(utcMs / 86400000);
  const idx = ((dayNumber % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length;
  return CHARACTERS[idx].handle;
}

/**
 * Compose the Prompt Book line for today's daily game.
 * Returns `null` when `dailyGame` is missing or malformed.
 * @param {{ dailyGame?: { format?: string, prompt?: string } | null }} params
 * @returns {string|null}
 */
export function buildDailyGameLine({ dailyGame } = {}) {
  if (!dailyGame || typeof dailyGame !== 'object') return null;
  const label = FORMAT_LABELS[dailyGame.format];
  if (!label || typeof dailyGame.prompt !== 'string' || dailyGame.prompt.trim().length === 0) {
    return null;
  }
  return `Today's game — ${label}: ${dailyGame.prompt}`;
}

/**
 * Check whether today's daily game has already been posted to the Prompt Book.
 * Prompts are unique across the 30-day cycle, so verbatim substring match suffices.
 * @param {{ promptBook?: Array, dailyGame?: { prompt?: string } | null }} params
 * @returns {boolean}
 */
export function isDailyGamePosted({ promptBook = [], dailyGame } = {}) {
  if (
    !dailyGame ||
    typeof dailyGame !== 'object' ||
    typeof dailyGame.prompt !== 'string' ||
    dailyGame.prompt.trim().length === 0
  ) {
    return false;
  }
  if (!Array.isArray(promptBook)) return false;
  return promptBook.some(
    (line) => line && typeof line.body === 'string' && line.body.includes(dailyGame.prompt)
  );
}
