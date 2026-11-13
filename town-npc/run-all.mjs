#!/usr/bin/env node
/**
 * Ghostlight Town — Seed NPC Run-All Wrapper (Slice 21)
 *
 * Runs one turn sequentially for all three seed NPCs (wick, maren, tomas) in
 * canonical CHARACTERS order — or a single NPC with `--npc` — with a
 * configurable stagger between turns. Probes `/api/town/state` first so a dead
 * API fails cleanly with one JSON error line on stdout and writes nothing.
 *
 * Usage:
 *   node town-npc/run-all.mjs --api-base <url> [--state-dir ./npc_state] [--npc wick|maren|tomas] [--stagger-ms N] [--dry-run]
 *
 * Env fallbacks:
 *   TOWN_API_BASE for --api-base
 *
 * Never prints or commits any private key.
 */

import { pathToFileURL } from 'node:url';
import { CHARACTERS, getCharacter } from './characters.mjs';
import { runTurn } from './run.mjs';

const DEFAULT_STAGGER_MS = 60_000;
const PROBE_TIMEOUT_MS = 10_000;
const VALID_HANDLES = CHARACTERS.map((c) => c.handle);

function usageExit(reason) {
  if (reason) {
    console.error(`Error: ${reason}`);
  }
  console.error(
    'Usage: node town-npc/run-all.mjs --api-base <url> [--state-dir ./npc_state] [--npc wick|maren|tomas] [--stagger-ms N] [--dry-run]'
  );
  process.exit(1);
}

function parseCliArgs(argv) {
  const args = {
    apiBase: process.env.TOWN_API_BASE || '',
    stateDir: './npc_state',
    npc: '',
    staggerMs: DEFAULT_STAGGER_MS,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api-base' && i + 1 < argv.length) {
      args.apiBase = argv[++i];
    } else if (a === '--state-dir' && i + 1 < argv.length) {
      args.stateDir = argv[++i];
    } else if (a === '--npc' && i + 1 < argv.length) {
      args.npc = argv[++i];
    } else if (a === '--stagger-ms' && i + 1 < argv.length) {
      const raw = argv[++i];
      const parsed = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
        usageExit(`Invalid --stagger-ms "${raw}" (expected non-negative number)`);
      }
      args.staggerMs = parsed;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--help' || a === '-h') {
      usageExit();
    } else {
      usageExit(`Unknown or incomplete argument: ${a}`);
    }
  }

  return args;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeTownApi(base, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${base}/api/town/state`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: `API unreachable: ${err.message}` };
  }
  if (!res.ok) {
    return { ok: false, error: `API probe failed with HTTP ${res.status}`, status: res.status };
  }
  return { ok: true };
}

/**
 * Run one turn for all requested seed NPCs sequentially with stagger.
 * @param {object} opts
 * @returns {Promise<{ ok: boolean, results: Array<{ npc: string, action: string, posted: boolean, ok: boolean }> }>}
 */
export async function runAll({
  apiBase = '',
  stateDir = './npc_state',
  npc = '',
  staggerMs = DEFAULT_STAGGER_MS,
  dryRun = false,
  fetchImpl = globalThis.fetch,
  brainImpl = undefined,
  logger = (obj) => console.log(JSON.stringify(obj)),
  sleepImpl = defaultSleep,
} = {}) {
  const base = String(apiBase || '').replace(/\/+$/, '');
  if (!base) {
    logger({ action: 'error', ok: false, error: 'Missing apiBase' });
    return { ok: false, results: [] };
  }

  let targets;
  if (npc) {
    const char = getCharacter(npc);
    if (!char) {
      logger({ action: 'error', ok: false, error: `Unknown seed NPC: ${npc}` });
      return { ok: false, results: [] };
    }
    targets = [char.handle];
  } else {
    targets = VALID_HANDLES;
  }

  const probe = await probeTownApi(base, fetchImpl);
  if (!probe.ok) {
    const payload = { action: 'error', ok: false, error: probe.error, api_base: base };
    if (probe.status !== undefined) payload.status = probe.status;
    logger(payload);
    return { ok: false, results: [] };
  }

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const handle = targets[i];
    if (i > 0 && staggerMs > 0) {
      await sleepImpl(staggerMs);
    }

    let turnRes;
    try {
      turnRes = await runTurn({
        npcHandle: handle,
        apiBase: base,
        stateDir,
        dryRun,
        fetchImpl,
        brainImpl,
        logger,
      });
    } catch (err) {
      logger({ npc: handle, action: 'error', reason: err.message || String(err) });
      turnRes = { ok: false, action: 'error', posted: false };
    }

    results.push({
      npc: handle,
      action: turnRes?.action || 'error',
      posted: Boolean(turnRes?.posted),
      ok: Boolean(turnRes?.ok),
    });
  }

  const allOk = results.every((r) => r.ok);
  logger({
    action: 'run_all',
    npcs: results,
    ok: allOk,
  });

  return { ok: allOk, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.apiBase) {
    usageExit('Missing --api-base (or TOWN_API_BASE)');
  }
  if (args.npc && !VALID_HANDLES.includes(args.npc)) {
    usageExit(`Invalid --npc "${args.npc}" (expected one of: ${VALID_HANDLES.join(', ')})`);
  }

  runAll({
    apiBase: args.apiBase,
    stateDir: args.stateDir,
    npc: args.npc,
    staggerMs: args.staggerMs,
    dryRun: args.dryRun,
  })
    .then((res) => process.exit(res.ok ? 0 : 1))
    .catch((err) => {
      console.log(JSON.stringify({ action: 'error', ok: false, error: err.message || String(err) }));
      process.exit(1);
    });
}
