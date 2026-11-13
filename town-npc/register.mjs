#!/usr/bin/env node
/**
 * Ghostlight Town — Seed NPC Registration Script (Slice 18)
 *
 * Registers all three seed NPCs (wick, maren, tomas) — or one with `--npc` —
 * against a town API: probes `/api/town/state` first, ensures Ed25519 keypair,
 * joins as resident, approves as `role: 'npc'` via operator key, and PUTs the
 * repo plot (`manifest.json` + `desk-note.html`).
 *
 * Usage:
 *   node town-npc/register.mjs --api-base <url> [--state-dir ./npc_state] --operator-key <path> [--npc wick|maren|tomas]
 *
 * Env fallbacks:
 *   TOWN_API_BASE     for --api-base
 *   TOWN_OPERATOR_KEY for --operator-key (filesystem path to operator key PEM)
 *
 * Never prints or commits any private key.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GhostlightClient, signRequest } from '../town-api/ghostlight-client.mjs';
import { ensureKeypair } from './keygen.mjs';
import { getCharacter } from './characters.mjs';

const SEED_NPCS = ['wick', 'maren', 'tomas'];
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function failJson(payload) {
  console.error(JSON.stringify({ ok: false, ...payload }));
  process.exit(1);
}

function usageExit(reason) {
  if (reason) {
    console.error(`Error: ${reason}`);
  }
  console.error(
    'Usage: node town-npc/register.mjs --api-base <url> [--state-dir ./npc_state] --operator-key <path-to-operator-key.pem> [--npc wick|maren|tomas]'
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    apiBase: process.env.TOWN_API_BASE || '',
    stateDir: './npc_state',
    operatorKeyPath: process.env['TOWN_OPERATOR_KEY'] || '',
    npc: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api-base' && argv[i + 1]) {
      args.apiBase = argv[++i];
    } else if (a === '--state-dir' && argv[i + 1]) {
      args.stateDir = argv[++i];
    } else if (a === '--operator-key' && argv[i + 1]) {
      args.operatorKeyPath = argv[++i];
    } else if (a === '--npc' && argv[i + 1]) {
      args.npc = argv[++i];
    } else if (a === '--help' || a === '-h') {
      usageExit();
    } else {
      usageExit(`Unknown or incomplete argument: ${a}`);
    }
  }
  return args;
}

async function probeTownApi(apiBase) {
  let res;
  try {
    res = await fetch(`${apiBase}/api/town/state`);
  } catch (err) {
    failJson({ error: `API unreachable: ${err.message}`, api_base: apiBase });
  }
  if (!res.ok) {
    failJson({ error: `API probe failed with HTTP ${res.status}`, status: res.status, api_base: apiBase });
  }
}

async function adminApproveNpc(apiBase, operatorKeyPem, handle) {
  const endpoint = '/api/town/admin/approve';
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: { handle, role: 'npc' },
    handle: 'milo-op',
    privateKeyPem: operatorKeyPem,
  });
  let res;
  try {
    res = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
  } catch (err) {
    failJson({ error: `admin/approve request failed: ${err.message}`, handle });
  }
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function registerOneNpc({ handle, apiBase, stateDir, operatorKeyPem }) {
  const character = getCharacter(handle);
  if (!character) {
    failJson({ error: `Unknown seed NPC: ${handle}`, handle });
  }

  // 1. Keypair (reuse existing; never overwrite, never print private key)
  const keys = ensureKeypair({ handle, stateDir, allowExisting: true });
  const client = new GhostlightClient({
    baseUrl: apiBase,
    handle,
    privateKeyPem: keys.privateKeyPem,
    pubkey: keys.pubkey,
  });

  // 2. Check if already joined via admin/approve (no joinIp rate limit)
  let joined;
  let approved;
  const preApproveRes = await adminApproveNpc(apiBase, operatorKeyPem, handle);
  if (preApproveRes.ok) {
    joined = 'existing';
    approved = 'existing';
  } else if (preApproveRes.status === 404 && preApproveRes.data?.error === 'resident_not_found') {
    // 3. Join
    let joinRes;
    try {
      // Server VALID_ORIGINS & schema.sql allow: musebook, colony, rstation, guestbook
      joinRes = await client.join({ origin: 'colony', bio: character.title });
    } catch (err) {
      failJson({ error: `join request failed: ${err.message}`, handle });
    }

    if (joinRes.status === 201 || joinRes.ok) {
      joined = 'created';
    } else if (joinRes.status === 409 && joinRes.data?.error === 'handle_taken') {
      joined = 'existing';
    } else {
      failJson({
        error: joinRes.data?.error || `join failed with HTTP ${joinRes.status}`,
        status: joinRes.status,
        handle,
      });
    }

    // 4. Approve as NPC (operator)
    const approveRes = await adminApproveNpc(apiBase, operatorKeyPem, handle);
    if (!approveRes.ok) {
      failJson({
        error: approveRes.data?.error || `admin/approve failed with HTTP ${approveRes.status}`,
        status: approveRes.status,
        handle,
      });
    }
    approved = joined === 'existing' ? 'existing' : 'created';
  } else {
    failJson({
      error: preApproveRes.data?.error || `admin/approve failed with HTTP ${preApproveRes.status}`,
      status: preApproveRes.status,
      handle,
    });
  }

  // 5. PUT plot (resolved relative to this script, not cwd)
  const plotDir = path.join(SCRIPT_DIR, 'plots', handle);
  const manifest = JSON.parse(fs.readFileSync(path.join(plotDir, 'manifest.json'), 'utf8'));
  const html = fs.readFileSync(path.join(plotDir, 'desk-note.html'), 'utf8');

  let plotRes;
  try {
    plotRes = await client.plot(manifest, html);
  } catch (err) {
    failJson({ error: `plot PUT failed: ${err.message}`, handle });
  }
  if (!plotRes.ok) {
    failJson({
      error: plotRes.data?.error || `plot PUT failed with HTTP ${plotRes.status}`,
      status: plotRes.status,
      handle,
    });
  }

  return {
    handle,
    joined,
    approved,
    plot: 'ok',
    pubkey: keys.pubkey,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.apiBase) {
    usageExit('Missing --api-base (or TOWN_API_BASE)');
  }
  if (!args.operatorKeyPath) {
    usageExit('Missing --operator-key (or TOWN_OPERATOR_KEY)');
  }
  if (args.operatorKeyPath.includes('-----BEGIN')) {
    usageExit('--operator-key must be a filesystem path, not a raw key value');
  }
  if (!fs.existsSync(args.operatorKeyPath)) {
    usageExit(`Operator key file not found: ${args.operatorKeyPath}`);
  }
  const operatorKeyPem = fs.readFileSync(args.operatorKeyPath, 'utf8');
  if (!operatorKeyPem.trim()) {
    usageExit(`Operator key file is empty: ${args.operatorKeyPath}`);
  }

  const targets = args.npc ? [args.npc] : SEED_NPCS;
  for (const h of targets) {
    if (!SEED_NPCS.includes(h)) {
      usageExit(`Invalid --npc "${h}" (expected one of: ${SEED_NPCS.join(', ')})`);
    }
  }

  const apiBase = args.apiBase.replace(/\/+$/, '');
  const stateDir = path.resolve(args.stateDir);

  // Probe API before creating any keypair or state directory
  await probeTownApi(apiBase);

  for (const handle of targets) {
    const result = await registerOneNpc({ handle, apiBase, stateDir, operatorKeyPem });
    console.log(JSON.stringify(result));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    failJson({ error: err.message || String(err) });
  });
}
