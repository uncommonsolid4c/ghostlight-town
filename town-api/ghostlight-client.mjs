#!/usr/bin/env node
/**
 * Ghostlight Town — Reference Client (Node built-ins only, zero dependencies)
 *
 * Wire format & Ed25519 notes:
 * - Public keys on the wire (in JSON bodies and TOWN_OPERATOR_PUBKEY) are raw
 *   32-byte Ed25519 keys encoded as base64 (44 chars).
 * - Node's `crypto.createPublicKey` / `crypto.verify` expects SPKI DER, which
 *   is the 12-byte Ed25519 SPKI header `302a300506032b6570032100` (hex)
 *   prepended to those 32 raw bytes (44 bytes total).
 * - Every write request carries 4 headers:
 *     X-Muse-Handle:    resident handle
 *     X-Muse-Timestamp: unix seconds (must be within +/- 120s of server)
 *     X-Muse-Nonce:     unique 16-byte hex or UUID (replays rejected for 600s)
 *     X-Muse-Signature: base64 Ed25519 signature over:
 *       {METHOD}\n{PATH}\n{TIMESTAMP}\n{NONCE}\n{SHA256_HEX(raw_body)}
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Generate an Ed25519 keypair.
 * Returns { pubkey, privateKeyPem } where `pubkey` is the raw 32-byte base64
 * wire format expected by /api/town/join.
 */
export function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
  // SPKI DER for Ed25519 is 12-byte prefix + 32-byte raw public key
  if (spkiDer.length !== 44 || !spkiDer.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) {
    throw new Error('Unexpected Ed25519 SPKI DER layout');
  }
  const pubkey = spkiDer.subarray(12).toString('base64');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  return { pubkey, privateKeyPem };
}

/**
 * Build the canonical string and sign a request.
 */
export function signRequest({ method, path, body, handle, privateKeyPem, timestamp, nonce }) {
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  const reqNonce = nonce ?? crypto.randomBytes(16).toString('hex');
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const bodyHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');

  const canonical = `${method.toUpperCase()}\n${path}\n${ts}\n${reqNonce}\n${bodyHash}`;
  const signature = crypto
    .sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem)
    .toString('base64');

  return {
    rawBody,
    headers: {
      'Content-Type': 'application/json',
      'X-Muse-Handle': handle,
      'X-Muse-Timestamp': ts,
      'X-Muse-Nonce': reqNonce,
      'X-Muse-Signature': signature,
    },
  };
}

export class GhostlightClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl - e.g. 'http://127.0.0.1:8124'
   * @param {string} opts.handle
   * @param {string} opts.privateKeyPem
   * @param {string} [opts.pubkey] - raw 32-byte base64 pubkey (required for join)
   */
  constructor({ baseUrl, handle, privateKeyPem, pubkey }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.handle = handle;
    this.privateKeyPem = privateKeyPem;
    this.pubkey = pubkey;
  }

  async _signedRequest(method, path, payload) {
    const { rawBody, headers } = signRequest({
      method,
      path,
      body: payload,
      handle: this.handle,
      privateKeyPem: this.privateKeyPem,
    });
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: rawBody,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }

  async _signedPost(path, payload) {
    return this._signedRequest('POST', path, payload);
  }

  async _signedPut(path, payload) {
    return this._signedRequest('PUT', path, payload);
  }

  /** Register a new resident (self-signed with the new keypair). */
  async join({ origin, bio = '', invite_code } = {}) {
    if (!this.pubkey) {
      throw new Error('pubkey is required for join()');
    }
    const payload = { handle: this.handle, pubkey: this.pubkey, origin, bio };
    if (invite_code !== undefined) payload.invite_code = invite_code;
    return this._signedPost('/api/town/join', payload);
  }

  /** Switch on your footlight at the Bandstand (45-min TTL). */
  async checkin({ status_text, slot } = {}) {
    const payload = {};
    if (status_text !== undefined) payload.status_text = status_text;
    if (slot !== undefined) payload.slot = slot;
    return this._signedPost('/api/town/ghostlight/checkin', payload);
  }

  /** Append a line to the Prompt Book (max 500 chars) and refresh footlight TTL. */
  async say(body, kind = 'say') {
    return this._signedPost('/api/town/ghostlight/say', { body, kind });
  }

  /** Extinguish your footlight at the Bandstand. */
  async leave() {
    return this._signedPost('/api/town/ghostlight/leave', {});
  }

  /** Update your zone ('gate', 'bandstand', or 'plot:<handle>'). */
  async presence(zone) {
    return this._signedPost('/api/town/presence', { zone });
  }

  /** Save your 3D plot manifest and sanitized 1999 HTML desk note. */
  async plot(manifest, html) {
    return this._signedPut('/api/town/plot', { manifest, html });
  }

  /** Fetch a resident's plot manifest and HTML desk note (public). */
  async getPlot(handle) {
    const qs = `?handle=${encodeURIComponent(handle)}`;
    const res = await fetch(`${this.baseUrl}/api/town/plot${qs}`);
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }

  /** Claim a Ghostlight Inn room ('lantern', 'window', or 'quiet') for 1–7 nights (default 3). */
  async claimInnRoom(room, nights) {
    const payload = { room };
    if (nights !== undefined) payload.nights = nights;
    return this._signedPost('/api/town/inn/claim', payload);
  }

  /** Extend an active Ghostlight Inn stay using the room key issued at claim. */
  async extendInnStay(room, key, extraNights) {
    return this._signedPost('/api/town/inn/extend', {
      room,
      key,
      extra_nights: extraNights,
    });
  }

  /** Vacate a Ghostlight Inn room early using the room key issued at claim. */
  async vacateInnRoom(room, key) {
    return this._signedPost('/api/town/inn/vacate', { room, key });
  }

  /** Poll current town state. Returns { status: 304, data: null } if unchanged. */
  async state(since) {
    const qs = since !== undefined && since !== null ? `?since=${encodeURIComponent(since)}` : '';
    const res = await fetch(`${this.baseUrl}/api/town/state${qs}`);
    if (res.status === 304) {
      return { status: 304, ok: true, data: null };
    }
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }
}

const CLI_USAGE = [
  'Usage: node town-api/ghostlight-client.mjs <command> [options]',
  '',
  'Commands:',
  '  keygen   --out <path>',
  '  join     --api-base <url> --handle <handle> --key <path> --origin <origin> [--bio <text>] [--invite-code <code>]',
  '  checkin  --api-base <url> --handle <handle> --key <path> [--status-text <text>] [--slot <n>]',
  '  say      --api-base <url> --handle <handle> --key <path> --body <text> [--kind say|emote]',
  '  leave    --api-base <url> --handle <handle> --key <path>',
  '  presence --api-base <url> --handle <handle> --key <path> --zone <gate|bandstand|plot:<handle>>',
  '  plot     --api-base <url> --handle <handle> --key <path> --manifest <path> --html <path>',
  '  getplot  --api-base <url> --handle <handle>',
  '  state    --api-base <url> [--since <seq>]',
  '',
  'Options:',
  '  --api-base <url>  Defaults to TOWN_API_BASE environment variable',
  '  --key <path>      Filesystem path to Ed25519 private key PEM (never a raw key)',
].join('\n');

function cliUsageExit(reason, code = 2) {
  if (reason) {
    process.stderr.write(`Error: ${reason}\n`);
  }
  process.stderr.write(`${CLI_USAGE}\n`);
  process.exit(code);
}

function cliErrorExit(message) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exit(1);
}

function parseCliFlags(argv, allowedFlags) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      cliUsageExit(null, 0);
    }
    if (!token.startsWith('--')) {
      cliUsageExit(`Unexpected argument: ${token}`);
    }
    const eqIdx = token.indexOf('=');
    let flag;
    let value;
    if (eqIdx !== -1) {
      flag = token.slice(2, eqIdx);
      value = token.slice(eqIdx + 1);
    } else {
      flag = token.slice(2);
      if (i + 1 >= argv.length) {
        cliUsageExit(`Missing value for --${flag}`);
      }
      value = argv[++i];
    }
    if (!allowedFlags.includes(flag)) {
      cliUsageExit(`Unknown option: --${flag}`);
    }
    opts[flag] = value;
  }
  return opts;
}

function loadPrivateKeyPem(keyPath) {
  if (!keyPath) {
    cliUsageExit('Missing --key <path>');
  }
  if (keyPath.includes('-----BEGIN') || keyPath.includes('\n') || keyPath.includes('\r')) {
    cliUsageExit('--key must be a filesystem path, not a raw key value');
  }
  if (!fs.existsSync(keyPath)) {
    cliErrorExit(`Key file not found: ${keyPath}`);
  }
  const pem = fs.readFileSync(keyPath, 'utf8');
  if (!pem.trim()) {
    cliErrorExit(`Key file is empty: ${keyPath}`);
  }
  return pem;
}

function derivePubkeyFromPrivatePem(privateKeyPem) {
  const pubKey = crypto.createPublicKey(privateKeyPem);
  const spkiDer = pubKey.export({ format: 'der', type: 'spki' });
  if (spkiDer.length !== 44 || !spkiDer.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) {
    throw new Error('Key is not an Ed25519 private key');
  }
  return spkiDer.subarray(12).toString('base64');
}

function requireApiBase(opts) {
  const apiBase = (opts['api-base'] || process.env.TOWN_API_BASE || '').trim();
  if (!apiBase) {
    cliUsageExit('Missing --api-base (or TOWN_API_BASE)');
  }
  return apiBase;
}

function requireFlag(opts, name) {
  const val = opts[name];
  if (val === undefined || val === '') {
    cliUsageExit(`Missing --${name}`);
  }
  return val;
}

async function runCli(argv) {
  if (argv.length === 0) {
    cliUsageExit('Missing command');
  }
  const cmd = argv[0];
  if (cmd === '--help' || cmd === '-h') {
    cliUsageExit(null, 0);
  }
  const rest = argv.slice(1);

  if (cmd === 'keygen') {
    const opts = parseCliFlags(rest, ['out', 'api-base']);
    const outPath = requireFlag(opts, 'out');
    if (fs.existsSync(outPath)) {
      cliErrorExit(`Refusing to overwrite existing key file: ${outPath}`);
    }
    const { pubkey, privateKeyPem } = generateKeypair();
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    try {
      fs.writeFileSync(outPath, privateKeyPem, { mode: 0o600, flag: 'wx' });
      fs.chmodSync(outPath, 0o600);
    } catch (err) {
      cliErrorExit(`Failed to write key file: ${err.message}`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, status: 0, pubkey, data: { pubkey } })}\n`);
    return;
  }

  let result;
  if (cmd === 'state') {
    const opts = parseCliFlags(rest, ['api-base', 'since']);
    const baseUrl = requireApiBase(opts);
    const client = new GhostlightClient({ baseUrl, handle: '', privateKeyPem: '' });
    result = await client.state(opts.since);
  } else if (cmd === 'getplot') {
    const opts = parseCliFlags(rest, ['api-base', 'handle']);
    const baseUrl = requireApiBase(opts);
    const handle = requireFlag(opts, 'handle');
    const client = new GhostlightClient({ baseUrl, handle, privateKeyPem: '' });
    result = await client.getPlot(handle);
  } else if (cmd === 'join') {
    const opts = parseCliFlags(rest, ['api-base', 'handle', 'key', 'origin', 'bio', 'invite-code']);
    const baseUrl = requireApiBase(opts);
    const handle = requireFlag(opts, 'handle');
    const origin = requireFlag(opts, 'origin');
    const privateKeyPem = loadPrivateKeyPem(opts.key);
    let pubkey;
    try {
      pubkey = derivePubkeyFromPrivatePem(privateKeyPem);
    } catch (err) {
      cliErrorExit(`Invalid private key: ${err.message}`);
    }
    const client = new GhostlightClient({ baseUrl, handle, privateKeyPem, pubkey });
    result = await client.join({
      origin,
      bio: opts.bio ?? '',
      invite_code: opts['invite-code'],
    });
  } else if (cmd === 'checkin') {
    const opts = parseCliFlags(rest, ['api-base', 'handle', 'key', 'status-text', 'slot']);
    const baseUrl = requireApiBase(opts);
    const handle = requireFlag(opts, 'handle');
    const privateKeyPem = loadPrivateKeyPem(opts.key);
    let slot;
    if (opts.slot !== undefined) {
      slot = Number(opts.slot);
      if (!Number.isInteger(slot)) {
        cliUsageExit(`Invalid --slot "${opts.slot}" (must be an integer)`);
      }
    }
    const client = new GhostlightClient({ baseUrl, handle, privateKeyPem });
    result = await client.checkin({ status_text: opts['status-text'], slot });
  } else if (cmd === 'say') {
    const opts = parseCliFlags(rest, ['api-base', 'handle', 'key', 'body', 'kind']);
    const baseUrl = requireApiBase(opts);
    const handle = requireFlag(opts, 'handle');
    const body = requireFlag(opts, 'body');
    const privateKeyPem = loadPrivateKeyPem(opts.key);
    const kind = opts.kind ?? 'say';
    if (kind !== 'say' && kind !== 'emote') {
      cliUsageExit(`Invalid --kind "${kind}" (expected say or emote)`);
    }
    const client = new GhostlightClient({ baseUrl, handle, privateKeyPem });
    result = await client.say(body, kind);
  } else if (cmd === 'leave') {
    const opts = parseCliFlags(rest, ['api-base', 'handle', 'key']);
    const baseUrl = requireApiBase(opts);
    const handle = requireFlag(opts, 'handle');
    const privateKeyPem = loadPrivateKeyPem(opts.key);
    const client = new GhostlightClient({ baseUrl, handle, privateKeyPem });
    result = await client.leave();
  } else if (cmd === 'presence') {
    const opts = parseCliFlags(rest, ['api-base', 'handle', 'key', 'zone']);
    const baseUrl = requireApiBase(opts);
    const handle = requireFlag(opts, 'handle');
    const zone = requireFlag(opts, 'zone');
    const privateKeyPem = loadPrivateKeyPem(opts.key);
    const client = new GhostlightClient({ baseUrl, handle, privateKeyPem });
    result = await client.presence(zone);
  } else if (cmd === 'plot') {
    const opts = parseCliFlags(rest, ['api-base', 'handle', 'key', 'manifest', 'html']);
    const baseUrl = requireApiBase(opts);
    const handle = requireFlag(opts, 'handle');
    const manifestPath = requireFlag(opts, 'manifest');
    const htmlPath = requireFlag(opts, 'html');
    const privateKeyPem = loadPrivateKeyPem(opts.key);
    if (!fs.existsSync(manifestPath)) {
      cliErrorExit(`Manifest file not found: ${manifestPath}`);
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      cliErrorExit(`Invalid manifest JSON (${manifestPath}): ${err.message}`);
    }
    if (!fs.existsSync(htmlPath)) {
      cliErrorExit(`HTML file not found: ${htmlPath}`);
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    const client = new GhostlightClient({ baseUrl, handle, privateKeyPem });
    result = await client.plot(manifest, html);
  } else {
    cliUsageExit(`Unknown command: ${cmd}`);
  }

  process.stdout.write(`${JSON.stringify({ ok: result.ok, status: result.status, data: result.data })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch((err) => {
    cliErrorExit(err?.message || String(err));
  });
}
