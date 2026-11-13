#!/usr/bin/env node
// Ghostlight Town — Cron-Driven Seed NPC Runner (Phase 0)
//
// One invocation = one turn for one NPC.
//
// Example cron schedule (do NOT install automatically; fill in TOWN_API_BASE
// at deploy time):
//
//   # Staggered routine wakeups every 3 hours per NPC:
//   10 */3 * * * TOWN_API_BASE=http://127.0.0.1:<port> node town-npc/run.mjs --npc wick >> npc_state/wick/cron.log 2>&1
//   25 */3 * * * TOWN_API_BASE=http://127.0.0.1:<port> node town-npc/run.mjs --npc maren >> npc_state/maren/cron.log 2>&1
//   40 */3 * * * TOWN_API_BASE=http://127.0.0.1:<port> node town-npc/run.mjs --npc tomas >> npc_state/tomas/cron.log 2>&1
//
//   # Evening reactive check every 10 minutes:
//   */10 18-22 * * * TOWN_API_BASE=http://127.0.0.1:<port> node town-npc/run.mjs --npc wick >> npc_state/wick/cron.log 2>&1

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { GhostlightClient } from '../town-api/ghostlight-client.mjs';
import { getCharacter, buildSystemPrompt, getStatusText } from './characters.mjs';
import { decideTurn, findAddressedLines, localDateString } from './stepback.mjs';
import { checkHonesty, MAX_SAY_LEN } from './honesty.mjs';
import { ensureKeypair, loadKeypair } from './keygen.mjs';

export const MEMORY_MAX_BYTES = 2048;
export const MEMORY_LINE_MAX_CHARS = 140;
const BRAIN_TIMEOUT_MS = 120_000;

/**
 * Trim memory.md content to strictly under maxBytes (2 KB) by dropping the
 * oldest lines from the top without ever truncating mid-line.
 * @param {string} text
 * @param {number} [maxBytes]
 * @returns {string}
 */
export function trimMemory(text, maxBytes = MEMORY_MAX_BYTES) {
  if (!text) return '';
  if (Buffer.byteLength(text, 'utf8') < maxBytes) return text;
  const lines = text.split('\n').filter((l, idx, arr) => !(idx === arr.length - 1 && l === ''));
  while (lines.length > 0) {
    const candidate = lines.join('\n') + '\n';
    if (Buffer.byteLength(candidate, 'utf8') < maxBytes) {
      return candidate;
    }
    lines.shift();
  }
  return '';
}

/**
 * Determine part of day from local hour.
 * @param {number} nowSec
 * @returns {'morning'|'afternoon'|'evening'}
 */
export function getPartOfDay(nowSec) {
  const hour = new Date(nowSec * 1000).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

const PRESENCE_WINDOW_SEC = 10800; // 3 hours, matching stepback.mjs
const HOST_LINE = 'A visitor is at your cottage — you are the host; greet them or answer from your doorway.';

function formatPresenceZone(zone, ownHandle) {
  if (zone === 'bandstand') return { place: 'the Bandstand', atOwnPlot: false };
  if (zone === 'gate') return { place: 'the gate', atOwnPlot: false };
  if (zone.startsWith('plot:')) {
    const plotHandle = zone.slice('plot:'.length);
    if (!plotHandle) return null;
    if (ownHandle && plotHandle === ownHandle) {
      return { place: 'your cottage', atOwnPlot: true };
    }
    const owner = getCharacter(plotHandle);
    const label = owner ? owner.name : plotHandle;
    return { place: `${label}'s cottage`, atOwnPlot: false };
  }
  return { place: 'around town', atOwnPlot: false };
}

/**
 * Format recent town presence into plain-language lines for the NPC brain prompt.
 * @param {object} opts
 * @returns {string}
 */
export function formatPresenceForPrompt({ npc, presence = [], now = Math.floor(Date.now() / 1000) } = {}) {
  const list = Array.isArray(presence) ? presence : [];
  const ownHandle = npc && typeof npc.handle === 'string' ? npc.handle : '';
  const lines = [];
  let hasHostVisitor = false;

  for (const pr of list) {
    if (!pr || typeof pr !== 'object') continue;
    if (typeof pr.handle !== 'string' || !pr.handle) continue;
    if (typeof pr.zone !== 'string' || !pr.zone) continue;
    if (typeof pr.updated_at !== 'number' || !Number.isFinite(pr.updated_at)) continue;
    if (now - pr.updated_at > PRESENCE_WINDOW_SEC) continue;
    if (ownHandle && pr.handle === ownHandle) continue;

    const formatted = formatPresenceZone(pr.zone, ownHandle);
    if (!formatted) continue;
    if (formatted.atOwnPlot) hasHostVisitor = true;
    lines.push(`- ${pr.handle} is at ${formatted.place}.`);
  }

  if (lines.length === 0) {
    return '(No visitors are about right now.)';
  }
  if (hasHostVisitor) {
    lines.push(HOST_LINE);
  }
  return lines.join('\n');
}

/**
 * Build the full prompt passed to the NPC brain.
 */
export function buildTurnPrompt({ npc, partOfDay, decision, promptBook, presence = [], memoryText, now }) {
  const systemBlock = buildSystemPrompt(npc, partOfDay);
  const recentLines = (Array.isArray(promptBook) ? promptBook : []).slice(-20);
  const formattedBook =
    recentLines.length === 0
      ? '(The Prompt Book is quiet.)'
      : recentLines
          .map((l) => {
            const badge = l.role === 'npc' ? '[NPC]' : '[MUSE]';
            const kind = l.kind === 'emote' ? ' (emote)' : '';
            return `- ${badge} ${l.handle}${kind}: ${l.body}`;
          })
          .join('\n');

  const formattedPresence = formatPresenceForPrompt({ npc, presence, now });
  const trimmedMem = (memoryText || '').trim() || '(No prior memories recorded yet.)';
  let turnGuidance;
  if (decision.action === 'reply') {
    if (decision.replyLine && decision.replyLine.handle) {
      const target =
        decision.replyLine.id != null
          ? `${decision.replyLine.handle}'s line #${decision.replyLine.id}`
          : `${decision.replyLine.handle}'s line`;
      turnGuidance = `Answer ${target} briefly in character. You are the one neighbor answering this line; the others will stay quiet.`;
    } else {
      turnGuidance = 'Someone mentioned you recently in the Prompt Book. Reply briefly in character.';
    }
  } else {
    turnGuidance =
      'This is a quiet routine moment at the Bandstand. Offer one short in-character line or observation, or NOTHING if you prefer to stay quiet.';
  }

  return [
    systemBlock,
    '',
    'Recent Prompt Book lines:',
    formattedBook,
    '',
    'Where everyone is:',
    formattedPresence,
    '',
    'Your recent memory:',
    trimmedMem,
    '',
    `Turn context: ${turnGuidance}`,
    `Remember: stay under ${MAX_SAY_LEN} characters, output ONLY the single line to say (or NOTHING).`,
  ].join('\n');
}

function defaultBrain(prompt) {
  const customCmd = process.env.NPC_BRAIN_CMD;
  const env = { ...process.env, GEMINI_FORCE_FILE_STORAGE: 'true' };

  return new Promise((resolve, reject) => {
    const file = customCmd ? '/bin/sh' : 'agy';
    const args = customCmd
      ? ['-c', `${customCmd} "$1"`, '_', prompt]
      : ['--model', 'gemini-4-hydrogen-medium', '-p', prompt];

    execFile(file, args, { env, timeout: BRAIN_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr ? `${err.message}: ${stderr.trim()}` : err.message;
        reject(new Error(msg));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function formatMemoryEntry(dateStr, text) {
  const prefix = `${dateStr}: `;
  const clean = text.replace(/\s+/g, ' ').trim();
  const maxBody = MEMORY_LINE_MAX_CHARS - prefix.length;
  const body = clean.length > maxBody ? `${clean.slice(0, maxBody - 1)}…` : clean;
  return `${prefix}${body}`;
}

function readNpcState(statePath, today) {
  const fallback = { ambient_today: 0, ambient_date: today, last_turn_at: null, turns: 0 };
  if (!fs.existsSync(statePath)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const ambientToday = parsed.ambient_date === today ? Number(parsed.ambient_today || 0) : 0;
    return {
      ambient_today: ambientToday,
      ambient_date: today,
      last_turn_at: parsed.last_turn_at ?? null,
      turns: Number(parsed.turns || 0),
    };
  } catch {
    return fallback;
  }
}

function writeNpcState(statePath, npcState) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(npcState, null, 2) + '\n', 'utf8');
}

/**
 * Execute one NPC turn.
 * @param {object} opts
 * @returns {Promise<{ ok: boolean, exitCode: number, action: string, posted?: boolean, draft?: string, prompt?: string, decision?: object }>}
 */
export async function runTurn({
  npcHandle,
  apiBase = '',
  stateDir = './npc_state',
  dryRun = false,
  force = false,
  now = Math.floor(Date.now() / 1000),
  fetchImpl = globalThis.fetch,
  brainImpl = defaultBrain,
  logger = (obj) => console.log(JSON.stringify(obj)),
} = {}) {
  const npc = getCharacter(npcHandle);
  if (!npc) {
    logger({ npc: npcHandle || null, action: 'error', reason: `unknown npc: ${npcHandle}` });
    return { ok: false, exitCode: 1, action: 'error' };
  }

  const resolvedStateDir = path.resolve(stateDir);
  const npcDir = path.join(resolvedStateDir, npc.handle);
  const statePath = path.join(npcDir, 'state.json');
  const memoryPath = path.join(npcDir, 'memory.md');
  const today = localDateString(now);

  // Load (or auto-generate on non-dry-run) keypair
  let keypair = loadKeypair({ handle: npc.handle, stateDir: resolvedStateDir });
  if (!keypair && !dryRun) {
    keypair = ensureKeypair({ handle: npc.handle, stateDir: resolvedStateDir, allowExisting: true });
    if (keypair.generated) {
      logger({ npc: npc.handle, action: 'keygen', reason: 'auto-generated missing keypair' });
    }
  }

  // Load state & memory (create empty on first non-dry-run)
  const npcState = readNpcState(statePath, today);
  let memoryText = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : '';
  if (!dryRun) {
    fs.mkdirSync(npcDir, { recursive: true });
    if (!fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, '', 'utf8');
    if (!fs.existsSync(statePath)) writeNpcState(statePath, npcState);
  }

  // Fetch full town state (no ?since=)
  const base = apiBase.replace(/\/+$/, '');
  let townState;
  try {
    const res = await fetchImpl(`${base}/api/town/state`);
    if (!res.ok) {
      logger({ npc: npc.handle, action: 'error', reason: `state fetch failed: HTTP ${res.status}` });
      return { ok: false, exitCode: 1, action: 'error' };
    }
    townState = await res.json();
  } catch (err) {
    logger({ npc: npc.handle, action: 'error', reason: `state fetch error: ${err.message}` });
    return { ok: false, exitCode: 1, action: 'error' };
  }

  let decision = decideTurn({ npc, state: townState, npcState, now });

  if (force && (decision.action === 'silent' || decision.action === 'retired')) {
    const addressed = findAddressedLines({ npc, promptBook: townState.prompt_book, now });
    const latest = addressed.length > 0 ? addressed[addressed.length - 1] : null;
    decision = {
      action: addressed.length > 0 ? 'reply' : 'initiate',
      reason: `forced (${decision.reason})`,
      replyLine: latest ? { id: latest.id ?? null, handle: latest.handle } : null,
    };
  }

  // Defensive check: reply requires a designated replyLine or an addressed line in the last 30m
  if (decision.action === 'reply' && !decision.replyLine) {
    const addressed = findAddressedLines({ npc, promptBook: townState.prompt_book, now });
    if (addressed.length === 0) {
      decision = { action: 'silent', reason: 'reply requested but no addressed line found in 30m', replyLine: null };
    }
  }

  if (decision.action === 'silent' || decision.action === 'retired') {
    logger({ npc: npc.handle, action: decision.action, reason: decision.reason });
    if (!dryRun) {
      writeNpcState(statePath, { ...npcState, last_turn_at: now });
    }
    return { ok: true, exitCode: 0, action: decision.action, decision };
  }

  const partOfDay = getPartOfDay(now);
  const prompt = buildTurnPrompt({
    npc,
    partOfDay,
    decision,
    promptBook: townState.prompt_book,
    presence: townState.presence,
    memoryText,
    now,
  });

  if (dryRun) {
    logger({
      npc: npc.handle,
      action: 'dry_run',
      would_act: decision.action,
      reason: decision.reason,
      prompt,
    });
    return { ok: true, exitCode: 0, action: 'dry_run', decision, prompt, posted: false };
  }

  // Call brain
  let draft;
  try {
    draft = (await brainImpl(prompt)).trim();
  } catch (err) {
    logger({ npc: npc.handle, action: 'error', reason: `brain failed: ${err.message}` });
    return { ok: false, exitCode: 1, action: 'error', decision };
  }

  if (!draft || draft.toUpperCase() === 'NOTHING') {
    logger({ npc: npc.handle, action: 'nothing', reason: 'brain returned NOTHING' });
    writeNpcState(statePath, { ...npcState, last_turn_at: now });
    return { ok: true, exitCode: 0, action: 'nothing', decision, posted: false };
  }

  // Honesty check
  const honesty = checkHonesty({ text: draft, npc, promptBook: townState.prompt_book });
  if (!honesty.ok) {
    logger({
      npc: npc.handle,
      action: 'rejected',
      reason: honesty.reasons.join('; '),
    });
    return { ok: false, exitCode: 1, action: 'rejected', decision, draft, posted: false };
  }

  // Post to town-api using GhostlightClient
  const client = new GhostlightClient({
    baseUrl: base,
    handle: npc.handle,
    privateKeyPem: keypair.privateKeyPem,
    pubkey: keypair.pubkey,
  });

  const isLit = Array.isArray(townState.footlights)
    && townState.footlights.some((f) => f && f.handle === npc.handle);

  if (!isLit) {
    const statusText = getStatusText(npc, partOfDay).slice(0, 80);
    try {
      const checkinRes = await client.checkin({ status_text: statusText });
      if (!checkinRes.ok) {
        logger({
          npc: npc.handle,
          action: 'checkin_failed',
          reason: `HTTP ${checkinRes.status}: ${checkinRes.data?.error || 'unknown'}`,
        });
      }
    } catch (err) {
      logger({ npc: npc.handle, action: 'checkin_failed', reason: err.message });
    }
  }

  try {
    const sayRes = await client.say(draft, 'say');
    if (!sayRes.ok) {
      logger({
        npc: npc.handle,
        action: 'say_failed',
        reason: `HTTP ${sayRes.status}: ${sayRes.data?.error || 'unknown'}`,
      });
      return { ok: false, exitCode: 1, action: 'say_failed', decision, draft, posted: false };
    }
  } catch (err) {
    logger({ npc: npc.handle, action: 'say_failed', reason: err.message });
    return { ok: false, exitCode: 1, action: 'say_failed', decision, draft, posted: false };
  }

  // Persist memory & state after successful post
  const memLine = formatMemoryEntry(today, draft);
  const nextMemory = trimMemory(`${memoryText}${memoryText && !memoryText.endsWith('\n') ? '\n' : ''}${memLine}\n`);
  fs.writeFileSync(memoryPath, nextMemory, 'utf8');

  const nextState = {
    ambient_today: decision.action === 'initiate' ? npcState.ambient_today + 1 : npcState.ambient_today,
    ambient_date: today,
    last_turn_at: now,
    turns: npcState.turns + 1,
  };
  writeNpcState(statePath, nextState);

  logger({
    npc: npc.handle,
    action: decision.action,
    reason: decision.reason,
    posted: true,
  });

  return { ok: true, exitCode: 0, action: decision.action, decision, draft, posted: true };
}

function parseCliArgs(argv) {
  const args = {
    npc: '',
    apiBase: process.env.TOWN_API_BASE || '',
    stateDir: './npc_state',
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--npc' && argv[i + 1]) args.npc = argv[++i];
    else if (a === '--api-base' && argv[i + 1]) args.apiBase = argv[++i];
    else if (a === '--state-dir' && argv[i + 1]) args.stateDir = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.npc || !args.apiBase) {
    console.error(
      'Usage: node town-npc/run.mjs --npc <handle> --api-base <url> [--state-dir ./npc_state] [--dry-run] [--force]'
    );
    process.exit(1);
  }
  runTurn({
    npcHandle: args.npc,
    apiBase: args.apiBase,
    stateDir: args.stateDir,
    dryRun: args.dryRun,
    force: args.force,
  })
    .then((res) => process.exit(res.exitCode))
    .catch((err) => {
      console.log(JSON.stringify({ npc: args.npc, action: 'error', reason: err.message }));
      process.exit(1);
    });
}
