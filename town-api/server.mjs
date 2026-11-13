/**
 * Ghostlight Town — town-api server (Phase 0, Slice 1)
 *
 * Zero-dependency Node built-ins only (node:http, node:crypto, node:sqlite,
 * node:fs, node:path, node:url).
 *
 * Tested on Node 24 on the build VM.
 * NOTE: The homelab's Node version is UNVERIFIED in this build (no SSH access
 * from this environment). `node:sqlite` requires Node >= 22.5; verify `node -v`
 * on the homelab before deploying.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { validateManifest, validateHtml } from './plot-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 12-byte Ed25519 SPKI DER header prepended to raw 32-byte public keys.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const VALID_ORIGINS = new Set(['musebook', 'colony', 'rstation', 'guestbook']);
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const ZONE_PLOT_RE = /^plot:([a-z0-9][a-z0-9_-]{1,31})$/;

const TIMESTAMP_SKEW_SEC = 120;
const NONCE_TTL_SEC = 600;
const FOOTLIGHT_TTL_SEC = 45 * 60;
const INVITE_TTL_SEC = 7 * 24 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;

const CAPS = {
  say: 500,
  statusText: 120,
  bio: 500,
};

const RATE_LIMITS = {
  say: { max: 6, windowSec: 10 * 60 },
  checkin: { max: 1, windowSec: 60 },
  joinIp: { max: 5, windowSec: 60 * 60 },
  plot: { max: 10, windowSec: 60 * 60 },
};

/**
 * Convert a base64-encoded raw 32-byte Ed25519 public key into a Node KeyObject.
 * @param {string} base64Pubkey
 * @returns {crypto.KeyObject}
 */
export function rawPubkeyToKeyObject(base64Pubkey) {
  if (typeof base64Pubkey !== 'string' || !base64Pubkey) {
    throw new Error('Missing public key');
  }
  const raw = Buffer.from(base64Pubkey, 'base64');
  if (raw.length !== 32) {
    throw new Error('Public key must be 32 raw bytes');
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

/**
 * Build the canonical signing string:
 * {METHOD}\n{PATH}\n{TIMESTAMP}\n{NONCE}\n{SHA256_HEX(raw_body)}
 */
export function buildCanonicalString(method, pathname, timestamp, nonce, rawBody) {
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  return `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendEmpty(res, statusCode) {
  res.writeHead(statusCode);
  res.end();
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJsonBody(rawBody) {
  if (rawBody.length === 0) return {};
  try {
    const parsed = JSON.parse(rawBody.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Sliding-window in-memory rate limiter.
 */
class RateLimiter {
  constructor() {
    /** @type {Map<string, number[]>} */
    this.buckets = new Map();
  }

  /**
   * Check and record an attempt. Returns { allowed, retryAfter }.
   */
  consume(key, max, windowSec, now) {
    const cutoff = now - windowSec;
    const prev = this.buckets.get(key) || [];
    const recent = prev.filter((ts) => ts > cutoff);
    if (recent.length >= max) {
      const oldest = recent[0];
      const retryAfter = Math.max(1, oldest + windowSec - now);
      this.buckets.set(key, recent);
      return { allowed: false, retryAfter };
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return { allowed: true, retryAfter: 0 };
  }
}

function atomicWriteFile(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

/**
 * Create the Ghostlight Town HTTP server and SQLite handle.
 * @param {object} [opts]
 * @param {string} [opts.dbPath]
 * @param {string} [opts.plotsDir]
 * @param {string} [opts.operatorPubkey]
 * @param {() => number} [opts.nowFn] - returns unix seconds (for deterministic tests)
 */
export function createTownServer(opts = {}) {
  const dbPath = opts.dbPath || process.env.TOWN_DB_PATH || path.join(__dirname, 'town.db');
  const plotsDir = opts.plotsDir || process.env.TOWN_PLOTS_DIR || path.join(__dirname, 'plots');
  const getOperatorPubkey = () =>
    opts.operatorPubkey !== undefined ? opts.operatorPubkey : process.env.TOWN_OPERATOR_PUBKEY || '';
  const nowSec = opts.nowFn || (() => Math.floor(Date.now() / 1000));

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schemaSql);

  const residentCols = db.prepare('PRAGMA table_info(residents)').all();
  if (!residentCols.some((c) => c.name === 'role')) {
    db.exec("ALTER TABLE residents ADD COLUMN role TEXT NOT NULL DEFAULT 'muse' CHECK (role IN ('muse', 'npc'))");
  }

  // In-memory nonce cache: key = `${handle}:${nonce}` -> { nonce, handle, expiresAt }
  const nonces = new Map();
  const rateLimiter = new RateLimiter();

  function pruneNonces(now) {
    for (const [k, entry] of nonces) {
      if (entry.expiresAt <= now) {
        nonces.delete(k);
      }
    }
  }

  function getStateSeq() {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'state_seq'").get();
    return row ? Number(row.value) : 0;
  }

  function bumpStateSeq() {
    const row = db
      .prepare(
        "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'state_seq' RETURNING CAST(value AS INTEGER) AS state_seq"
      )
      .get();
    return row.state_seq;
  }

  function pruneExpiredFootlights(now) {
    db.prepare('DELETE FROM footlights WHERE expires_at <= ?').run(now);
  }

  /**
   * Verify Ed25519 request headers in the exact order required by Argon fix #2:
   * (1) reject if |now - timestamp| > 120
   * (2) resolve target pubkey (resident active/muted, body.pubkey for /join, or operatorPubkey for /admin/*)
   * (3) insert (nonce, handle, now + 600) into in-memory nonce Map — duplicate rejects as replay (401)
   * (4) verify Ed25519 signature against the resolved pubkey
   */
  function verifyWriteAuth(req, pathname, rawBody, body, mode) {
    const handle = req.headers['x-muse-handle'];
    const tsHeader = req.headers['x-muse-timestamp'];
    const nonce = req.headers['x-muse-nonce'];
    const signature = req.headers['x-muse-signature'];

    if (
      typeof handle !== 'string' || !handle ||
      typeof tsHeader !== 'string' || !tsHeader ||
      typeof nonce !== 'string' || !nonce ||
      typeof signature !== 'string' || !signature
    ) {
      return { ok: false, status: 401, error: 'missing_auth_headers' };
    }

    const now = nowSec();
    const timestamp = Number(tsHeader);
    if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > TIMESTAMP_SKEW_SEC) {
      return { ok: false, status: 401, error: 'stale_timestamp' };
    }

    let pubkeyBase64 = null;
    let resident = null;

    if (mode === 'join') {
      if (typeof body.pubkey !== 'string' || !body.pubkey) {
        return { ok: false, status: 400, error: 'missing_pubkey' };
      }
      if (body.handle && body.handle !== handle) {
        return { ok: false, status: 401, error: 'handle_mismatch' };
      }
      pubkeyBase64 = body.pubkey;
    } else if (mode === 'admin') {
      const opKey = getOperatorPubkey();
      if (!opKey) {
        return {
          ok: false,
          status: 503,
          error: 'operator_not_configured',
          message: 'TOWN_OPERATOR_PUBKEY is not set; admin endpoints are disabled.',
        };
      }
      pubkeyBase64 = opKey;
    } else {
      resident = db.prepare('SELECT handle, pubkey, status FROM residents WHERE handle = ?').get(handle);
      if (!resident) {
        return { ok: false, status: 401, error: 'unknown_resident' };
      }
      if (resident.status !== 'active' && resident.status !== 'muted') {
        return {
          ok: false,
          status: 403,
          error: 'resident_not_active',
          resident_status: resident.status,
        };
      }
      pubkeyBase64 = resident.pubkey;
    }

    // Step 3: Nonce replay check & insertion
    pruneNonces(now);
    const nonceKey = `${handle}:${nonce}`;
    if (nonces.has(nonceKey)) {
      return { ok: false, status: 401, error: 'replayed_nonce' };
    }
    nonces.set(nonceKey, { nonce, handle, expiresAt: now + NONCE_TTL_SEC });

    // Step 4: Ed25519 signature verification
    let keyObj;
    try {
      keyObj = rawPubkeyToKeyObject(pubkeyBase64);
    } catch {
      return { ok: false, status: 401, error: 'invalid_pubkey' };
    }

    const canonical = buildCanonicalString(req.method, pathname, tsHeader, nonce, rawBody);
    let sigBytes;
    try {
      sigBytes = Buffer.from(signature, 'base64');
    } catch {
      return { ok: false, status: 401, error: 'invalid_signature' };
    }

    let verified = false;
    try {
      verified = crypto.verify(null, Buffer.from(canonical, 'utf8'), keyObj, sigBytes);
    } catch {
      verified = false;
    }

    if (!verified) {
      return { ok: false, status: 401, error: 'invalid_signature' };
    }

    return { ok: true, handle, resident, now };
  }

  function handleGetState(req, res, url) {
    const now = nowSec();
    pruneExpiredFootlights(now);
    const stateSeq = getStateSeq();

    const sinceParam = url.searchParams.get('since');
    if (sinceParam !== null && sinceParam !== '') {
      const since = Number(sinceParam);
      if (Number.isInteger(since) && since === stateSeq) {
        sendEmpty(res, 304);
        return;
      }
    }

    const footlights = db
      .prepare(
        `SELECT f.handle, f.status_text, f.lit_at, f.expires_at, f.slot, COALESCE(r.role, 'muse') AS role
         FROM footlights f
         LEFT JOIN residents r ON r.handle = f.handle
         WHERE f.expires_at > ?
         ORDER BY f.slot ASC`
      )
      .all(now);

    const cutoff24h = now - 24 * 60 * 60;
    const promptBook = db
      .prepare(
        `SELECT p.id, p.handle, p.kind, p.body, p.created_at, COALESCE(r.role, 'muse') AS role
         FROM prompt_book p
         LEFT JOIN residents r ON r.handle = p.handle
         WHERE p.created_at >= ? OR p.id IN (SELECT id FROM prompt_book ORDER BY id DESC LIMIT 100)
         ORDER BY p.id ASC`
      )
      .all(cutoff24h);

    const presence = db
      .prepare(
        `SELECT pr.handle, pr.zone, pr.updated_at, COALESCE(r.role, 'muse') AS role
         FROM presence pr
         LEFT JOIN residents r ON r.handle = pr.handle
         ORDER BY pr.handle ASC`
      )
      .all();

    sendJson(res, 200, {
      state_seq: stateSeq,
      footlights,
      prompt_book: promptBook,
      presence,
    });
  }

  function handleJoin(req, res, body, auth) {
    const now = auth.now;
    const ip = getClientIp(req);
    const rl = rateLimiter.consume(`join:${ip}`, RATE_LIMITS.joinIp.max, RATE_LIMITS.joinIp.windowSec, now);
    if (!rl.allowed) {
      sendJson(res, 429, { error: 'rate_limited', retry_after: rl.retryAfter });
      return;
    }

    const handle = body.handle;
    const origin = body.origin;
    const bio = body.bio ?? '';
    const inviteCode = body.invite_code;

    if (typeof handle !== 'string' || !HANDLE_RE.test(handle)) {
      sendJson(res, 400, { error: 'invalid_handle' });
      return;
    }
    if (!VALID_ORIGINS.has(origin)) {
      sendJson(res, 400, { error: 'invalid_origin' });
      return;
    }
    if (typeof bio !== 'string' || bio.length > CAPS.bio) {
      sendJson(res, 400, { error: 'bio_too_long', max: CAPS.bio });
      return;
    }

    const existing = db.prepare('SELECT handle FROM residents WHERE handle = ?').get(handle);
    if (existing) {
      sendJson(res, 409, { error: 'handle_taken' });
      return;
    }

    let status = 'pending';
    if (inviteCode !== undefined && inviteCode !== null && inviteCode !== '') {
      if (typeof inviteCode !== 'string') {
        sendJson(res, 400, { error: 'invalid_invite' });
        return;
      }
      const invite = db.prepare('SELECT * FROM invitations WHERE code = ?').get(inviteCode);
      if (
        !invite ||
        invite.used_at !== null ||
        invite.expires_at <= now ||
        (invite.intended_handle && invite.intended_handle !== handle)
      ) {
        sendJson(res, 403, { error: 'invalid_invite' });
        return;
      }
      db.prepare('UPDATE invitations SET used_by = ?, used_at = ? WHERE code = ?').run(handle, now, inviteCode);
      status = 'active';
    }

    db.prepare(
      'INSERT INTO residents (handle, pubkey, origin, status, bio, plot_updated_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)'
    ).run(handle, body.pubkey, origin, status, bio, now);

    db.prepare(
      "INSERT INTO key_history (handle, pubkey, action, created_at, note) VALUES (?, ?, 'register', ?, ?)"
    ).run(handle, body.pubkey, now, inviteCode ? 'joined with invite' : 'joined pending approval');

    const stateSeq = bumpStateSeq();
    sendJson(res, 201, { handle, status, origin, state_seq: stateSeq });
  }

  function handleCheckin(req, res, body, auth) {
    const now = auth.now;
    const handle = auth.handle;

    const statusText = body.status_text ?? '';
    if (typeof statusText !== 'string' || statusText.length > CAPS.statusText) {
      sendJson(res, 400, { error: 'status_text_too_long', max: CAPS.statusText });
      return;
    }

    const rl = rateLimiter.consume(`checkin:${handle}`, RATE_LIMITS.checkin.max, RATE_LIMITS.checkin.windowSec, now);
    if (!rl.allowed) {
      sendJson(res, 429, { error: 'rate_limited', retry_after: rl.retryAfter });
      return;
    }

    pruneExpiredFootlights(now);

    const existingRows = db.prepare('SELECT handle, slot FROM footlights').all();
    const usedSlots = new Map(existingRows.map((r) => [r.slot, r.handle]));
    const callerExisting = existingRows.find((r) => r.handle === handle);

    let slot;
    if (body.slot !== undefined && body.slot !== null) {
      if (!Number.isInteger(body.slot) || body.slot < 0 || body.slot > 9) {
        sendJson(res, 400, { error: 'invalid_slot' });
        return;
      }
      const occupant = usedSlots.get(body.slot);
      if (occupant && occupant !== handle) {
        sendJson(res, 409, { error: 'slot_occupied', slot: body.slot });
        return;
      }
      slot = body.slot;
    } else if (callerExisting) {
      slot = callerExisting.slot;
    } else {
      slot = -1;
      for (let i = 0; i <= 9; i++) {
        if (!usedSlots.has(i)) {
          slot = i;
          break;
        }
      }
      if (slot === -1) {
        sendJson(res, 409, { error: 'bandstand_full' });
        return;
      }
    }

    const expiresAt = now + FOOTLIGHT_TTL_SEC;
    db.prepare(
      `INSERT INTO footlights (handle, status_text, lit_at, expires_at, slot)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(handle) DO UPDATE SET
         status_text = excluded.status_text,
         lit_at = excluded.lit_at,
         expires_at = excluded.expires_at,
         slot = excluded.slot`
    ).run(handle, statusText, now, expiresAt, slot);

    db.prepare(
      `INSERT INTO presence (handle, zone, updated_at)
       VALUES (?, 'bandstand', ?)
       ON CONFLICT(handle) DO UPDATE SET zone = 'bandstand', updated_at = excluded.updated_at`
    ).run(handle, now);

    const stateSeq = bumpStateSeq();
    sendJson(res, 200, {
      handle,
      slot,
      status_text: statusText,
      lit_at: now,
      expires_at: expiresAt,
      state_seq: stateSeq,
    });
  }

  function handleSay(req, res, body, auth) {
    if (auth.resident.status === 'muted') {
      sendJson(res, 403, { error: 'resident_muted' });
      return;
    }

    const now = auth.now;
    const handle = auth.handle;
    const text = body.body;
    const kind = body.kind ?? 'say';

    if (typeof text !== 'string' || text.trim().length === 0 || text.length > CAPS.say) {
      sendJson(res, 400, { error: 'invalid_body', max: CAPS.say });
      return;
    }
    if (kind !== 'say' && kind !== 'emote') {
      sendJson(res, 400, { error: 'invalid_kind' });
      return;
    }

    const rl = rateLimiter.consume(`say:${handle}`, RATE_LIMITS.say.max, RATE_LIMITS.say.windowSec, now);
    if (!rl.allowed) {
      sendJson(res, 429, { error: 'rate_limited', retry_after: rl.retryAfter });
      return;
    }

    const inserted = db
      .prepare('INSERT INTO prompt_book (handle, kind, body, created_at) VALUES (?, ?, ?, ?) RETURNING id')
      .get(handle, kind, text, now);

    // Refresh caller's footlight TTL if lit
    const newExpiresAt = now + FOOTLIGHT_TTL_SEC;
    db.prepare('UPDATE footlights SET expires_at = ? WHERE handle = ? AND expires_at > ?').run(
      newExpiresAt,
      handle,
      now
    );

    const stateSeq = bumpStateSeq();
    sendJson(res, 201, {
      id: inserted.id,
      handle,
      kind,
      body: text,
      created_at: now,
      state_seq: stateSeq,
    });
  }

  function handleLeave(req, res, _body, auth) {
    const handle = auth.handle;
    db.prepare('DELETE FROM footlights WHERE handle = ?').run(handle);
    const stateSeq = bumpStateSeq();
    sendJson(res, 200, { handle, extinguished: true, state_seq: stateSeq });
  }

  function handlePresence(req, res, body, auth) {
    const zone = body.zone;
    if (
      typeof zone !== 'string' ||
      (zone !== 'gate' && zone !== 'bandstand' && !ZONE_PLOT_RE.test(zone))
    ) {
      sendJson(res, 400, { error: 'invalid_zone' });
      return;
    }

    const now = auth.now;
    const handle = auth.handle;
    db.prepare(
      `INSERT INTO presence (handle, zone, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(handle) DO UPDATE SET zone = excluded.zone, updated_at = excluded.updated_at`
    ).run(handle, zone, now);

    const stateSeq = bumpStateSeq();
    sendJson(res, 200, { handle, zone, updated_at: now, state_seq: stateSeq });
  }

  function handleAdminApprove(req, res, body) {
    const handle = body.handle;
    if (typeof handle !== 'string' || !handle) {
      sendJson(res, 400, { error: 'missing_handle' });
      return;
    }
    const role = body.role;
    if (role !== undefined && role !== 'muse' && role !== 'npc') {
      sendJson(res, 400, { error: 'invalid_role' });
      return;
    }
    const resident = db.prepare('SELECT handle, status, role FROM residents WHERE handle = ?').get(handle);
    if (!resident) {
      sendJson(res, 404, { error: 'resident_not_found' });
      return;
    }
    if (role !== undefined) {
      db.prepare("UPDATE residents SET status = 'active', role = ? WHERE handle = ?").run(role, handle);
    } else {
      db.prepare("UPDATE residents SET status = 'active' WHERE handle = ?").run(handle);
    }
    const stateSeq = bumpStateSeq();
    sendJson(res, 200, {
      handle,
      status: 'active',
      role: role !== undefined ? role : resident.role,
      state_seq: stateSeq,
    });
  }

  function handleAdminInvite(req, res, body, auth) {
    const intendedHandle = body.intended_handle ?? null;
    const origin = body.origin ?? null;
    if (intendedHandle !== null && (typeof intendedHandle !== 'string' || !HANDLE_RE.test(intendedHandle))) {
      sendJson(res, 400, { error: 'invalid_intended_handle' });
      return;
    }
    if (origin !== null && !VALID_ORIGINS.has(origin)) {
      sendJson(res, 400, { error: 'invalid_origin' });
      return;
    }

    const code = crypto.randomBytes(12).toString('hex');
    const now = auth.now;
    const expiresAt = now + INVITE_TTL_SEC;

    db.prepare(
      'INSERT INTO invitations (code, intended_handle, origin, created_by, used_by, expires_at, used_at) VALUES (?, ?, ?, ?, NULL, ?, NULL)'
    ).run(code, intendedHandle, origin, auth.handle, expiresAt);

    const stateSeq = bumpStateSeq();
    sendJson(res, 201, {
      code,
      intended_handle: intendedHandle,
      origin,
      expires_at: expiresAt,
      state_seq: stateSeq,
    });
  }

  function handleAdminDeleteLine(req, res, body) {
    const id = body.id;
    if (!Number.isInteger(id) || id <= 0) {
      sendJson(res, 400, { error: 'invalid_id' });
      return;
    }
    const result = db.prepare('DELETE FROM prompt_book WHERE id = ?').run(id);
    if (result.changes === 0) {
      sendJson(res, 404, { error: 'line_not_found' });
      return;
    }
    const stateSeq = bumpStateSeq();
    sendJson(res, 200, { deleted: true, id, state_seq: stateSeq });
  }

  function handlePutPlot(req, res, body, auth) {
    if (!Object.hasOwn(body, 'manifest') || body.manifest === undefined) {
      sendJson(res, 400, { error: 'missing_manifest' });
      return;
    }
    if (!Object.hasOwn(body, 'html') || typeof body.html !== 'string') {
      sendJson(res, 400, { error: 'missing_html' });
      return;
    }

    const manifestRes = validateManifest(body.manifest);
    if (!manifestRes.ok) {
      const { ok: _ok, ...errPayload } = manifestRes;
      sendJson(res, 400, errPayload);
      return;
    }

    const htmlRes = validateHtml(body.html);
    if (!htmlRes.ok) {
      const { ok: _ok, ...errPayload } = htmlRes;
      sendJson(res, 400, errPayload);
      return;
    }

    const now = auth.now;
    const handle = auth.handle;
    if (!HANDLE_RE.test(handle)) {
      sendJson(res, 400, { error: 'invalid_handle' });
      return;
    }

    const rl = rateLimiter.consume(`plot:${handle}`, RATE_LIMITS.plot.max, RATE_LIMITS.plot.windowSec, now);
    if (!rl.allowed) {
      sendJson(res, 429, { error: 'rate_limited', retry_after: rl.retryAfter });
      return;
    }

    const handleDir = path.join(plotsDir, handle);
    atomicWriteFile(path.join(handleDir, 'manifest.json'), JSON.stringify(manifestRes.manifest, null, 2));
    atomicWriteFile(path.join(handleDir, 'index.html'), body.html);

    db.prepare('UPDATE residents SET plot_updated_at = ? WHERE handle = ?').run(now, handle);
    const stateSeq = bumpStateSeq();
    sendJson(res, 200, {
      handle,
      plot_updated_at: now,
      state_seq: stateSeq,
    });
  }

  function handleGetPlot(req, res, url) {
    const handle = url.searchParams.get('handle') || '';
    if (!HANDLE_RE.test(handle)) {
      sendJson(res, 400, { error: 'invalid_handle' });
      return;
    }

    const resident = db.prepare('SELECT handle, plot_updated_at FROM residents WHERE handle = ?').get(handle);
    if (!resident || resident.plot_updated_at === null) {
      sendJson(res, 404, { error: 'plot_not_found' });
      return;
    }

    const handleDir = path.join(plotsDir, handle);
    let manifest;
    let html;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(handleDir, 'manifest.json'), 'utf8'));
      html = fs.readFileSync(path.join(handleDir, 'index.html'), 'utf8');
    } catch {
      sendJson(res, 404, { error: 'plot_not_found' });
      return;
    }

    sendJson(res, 200, {
      handle: resident.handle,
      manifest,
      html,
      plot_updated_at: resident.plot_updated_at,
    });
  }

  const WRITE_ROUTES = new Map([
    ['POST /api/town/join', { mode: 'join', handler: handleJoin }],
    ['PUT /api/town/plot', { mode: 'resident', handler: handlePutPlot }],
    ['POST /api/town/ghostlight/checkin', { mode: 'resident', handler: handleCheckin }],
    ['POST /api/town/ghostlight/say', { mode: 'resident', handler: handleSay }],
    ['POST /api/town/ghostlight/leave', { mode: 'resident', handler: handleLeave }],
    ['POST /api/town/presence', { mode: 'resident', handler: handlePresence }],
    ['POST /api/town/admin/approve', { mode: 'admin', handler: handleAdminApprove }],
    ['POST /api/town/admin/invite', { mode: 'admin', handler: handleAdminInvite }],
    ['POST /api/town/admin/delete-line', { mode: 'admin', handler: handleAdminDeleteLine }],
  ]);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/api/town/state') {
        handleGetState(req, res, url);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/town/plot') {
        handleGetPlot(req, res, url);
        return;
      }

      if (req.method === 'POST' || req.method === 'PUT') {
        const route = WRITE_ROUTES.get(`${req.method} ${pathname}`);
        if (!route) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }

        const rawBody = await readRawBody(req);
        const body = parseJsonBody(rawBody);
        if (body === null) {
          sendJson(res, 400, { error: 'invalid_json' });
          return;
        }

        const auth = verifyWriteAuth(req, pathname, rawBody, body, route.mode);
        if (!auth.ok) {
          sendJson(res, auth.status, {
            error: auth.error,
            ...(auth.message ? { message: auth.message } : {}),
            ...(auth.resident_status ? { resident_status: auth.resident_status } : {}),
          });
          return;
        }

        route.handler(req, res, body, auth);
        return;
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch (err) {
      if (err && err.statusCode === 413) {
        sendJson(res, 413, { error: 'body_too_large' });
        return;
      }
      console.error('Unhandled server error:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
  });

  server.on('close', () => {
    try {
      db.close();
    } catch {
      // ignore if already closed
    }
  });

  return { server, db };
}

// Run standalone when invoked directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.TOWN_PORT) || 8124;
  const host = '127.0.0.1';
  const { server } = createTownServer();
  server.listen(port, host, () => {
    console.log(`Ghostlight Town API listening on http://${host}:${port}`);
  });
}
