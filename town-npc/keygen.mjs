#!/usr/bin/env node
/**
 * Ghostlight Town — Seed NPC Keypair Generator & Loader
 *
 * Generates an Ed25519 keypair using ghostlight-client.mjs `generateKeypair()`
 * and stores:
 *   <state-dir>/<handle>/key.pem     (0600 PKCS8 PEM)
 *   <state-dir>/<handle>/pubkey.txt  (raw 32-byte base64, 44 chars)
 *
 * Never prints or commits private keys.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateKeypair } from '../town-api/ghostlight-client.mjs';

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * Load an existing NPC keypair from <stateDir>/<handle>/.
 * Returns null if either key.pem or pubkey.txt is missing.
 * @param {{ handle: string, stateDir: string }} params
 * @returns {{ handle: string, pubkey: string, privateKeyPem: string, keyPath: string, pubkeyPath: string } | null}
 */
export function loadKeypair({ handle, stateDir }) {
  const npcDir = path.join(stateDir, handle);
  const keyPath = path.join(npcDir, 'key.pem');
  const pubkeyPath = path.join(npcDir, 'pubkey.txt');
  if (!fs.existsSync(keyPath) || !fs.existsSync(pubkeyPath)) {
    return null;
  }
  const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
  const pubkey = fs.readFileSync(pubkeyPath, 'utf8').trim();
  return { handle, pubkey, privateKeyPem, keyPath, pubkeyPath };
}

/**
 * Generate and persist an NPC keypair, or return existing if `allowExisting` is true.
 * Throws if keypair already exists and neither `force` nor `allowExisting` is set.
 * @param {{ handle: string, stateDir: string, force?: boolean, allowExisting?: boolean }} params
 */
export function ensureKeypair({ handle, stateDir, force = false, allowExisting = false }) {
  if (!HANDLE_RE.test(handle)) {
    throw new Error(`Invalid handle: ${handle}`);
  }
  const npcDir = path.join(stateDir, handle);
  const keyPath = path.join(npcDir, 'key.pem');
  const pubkeyPath = path.join(npcDir, 'pubkey.txt');

  const keyExists = fs.existsSync(keyPath);
  const pubExists = fs.existsSync(pubkeyPath);

  if ((keyExists || pubExists) && !force) {
    if (allowExisting && keyExists && pubExists) {
      return { ...loadKeypair({ handle, stateDir }), generated: false };
    }
    throw new Error(`Keypair already exists for "${handle}" at ${npcDir} (pass --force to overwrite)`);
  }

  fs.mkdirSync(npcDir, { recursive: true });
  const { pubkey, privateKeyPem } = generateKeypair();

  fs.writeFileSync(keyPath, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  fs.writeFileSync(pubkeyPath, pubkey, { encoding: 'utf8', mode: 0o644 });

  return { handle, pubkey, privateKeyPem, keyPath, pubkeyPath, generated: true };
}

function parseArgs(argv) {
  const args = { npc: '', stateDir: './npc_state', force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--npc' && argv[i + 1]) {
      args.npc = argv[++i];
    } else if (a === '--state-dir' && argv[i + 1]) {
      args.stateDir = argv[++i];
    } else if (a === '--force') {
      args.force = true;
    }
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.npc) {
    console.error('Usage: node town-npc/keygen.mjs --npc <handle> [--state-dir ./npc_state] [--force]');
    process.exit(1);
  }
  try {
    const res = ensureKeypair({
      handle: args.npc,
      stateDir: path.resolve(args.stateDir),
      force: args.force,
      allowExisting: false,
    });
    // Print ONLY handle and pubkey (never private key)
    console.log(`${res.handle} ${res.pubkey}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
