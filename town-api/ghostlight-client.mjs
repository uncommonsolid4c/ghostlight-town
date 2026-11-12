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

  async _signedPost(path, payload) {
    const { rawBody, headers } = signRequest({
      method: 'POST',
      path,
      body: payload,
      handle: this.handle,
      privateKeyPem: this.privateKeyPem,
    });
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
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
