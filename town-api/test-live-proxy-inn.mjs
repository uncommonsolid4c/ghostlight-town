#!/usr/bin/env node
/**
 * Slice 50: Live-proxy Inn acceptance test.
 *
 * Mirrors the local Inn flow (town-api/test-inn.mjs) against a live proxied
 * town-api instance via GhostlightClient. Skips cleanly (exit 0) when
 * GHOSTLIGHT_LIVE_BASE is unset, when GET /api/town/state is unreachable or
 * non-town-state, when the live API predates the inn map (pre-slice-48), or
 * when TOWN_OPERATOR_KEY_PATH is unset/unreadable.
 *
 * Env:
 *   GHOSTLIGHT_LIVE_BASE   - Base URL of the live town API (e.g. https://host)
 *   TOWN_OPERATOR_KEY_PATH - Filesystem path to operator Ed25519 PEM key
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

const PROBE_TIMEOUT_MS = 10_000;
const NIGHT_SEC = 86400;
const UNAMBIGUOUS_KEY_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$/;

function skip(reason, extra = {}) {
  console.log(JSON.stringify({ status: 'skip', reason, ...extra }));
  process.exit(0);
}

function fail(reason, extra = {}) {
  console.log(JSON.stringify({ status: 'fail', reason, ...extra }));
  process.exit(1);
}

function isTownState(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Number.isInteger(data.state_seq) &&
    Array.isArray(data.footlights) &&
    Array.isArray(data.prompt_book) &&
    Array.isArray(data.presence)
  );
}

async function probeTownState(baseUrl) {
  let res;
  try {
    res = await fetch(`${baseUrl}/api/town/state`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, reason: `API unreachable: ${err.message}` };
  }

  if (!res.ok) {
    return { ok: false, reason: `API probe returned HTTP ${res.status}` };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'API probe did not return valid JSON' };
  }

  if (!isTownState(data)) {
    return { ok: false, reason: 'API probe response is not town state' };
  }

  return { ok: true, state: data };
}

async function adminApprove(baseUrl, operatorKeyPem, handle) {
  const endpoint = '/api/town/admin/approve';
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: { handle },
    handle: 'milo-op',
    privateKeyPem: operatorKeyPem,
  });
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function main() {
  const rawBase = (process.env.GHOSTLIGHT_LIVE_BASE || '').trim();
  if (!rawBase) {
    skip('GHOSTLIGHT_LIVE_BASE is not set');
  }

  let parsedBase;
  try {
    parsedBase = new URL(rawBase);
  } catch {
    skip('GHOSTLIGHT_LIVE_BASE is not a valid URL');
  }
  if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
    skip('GHOSTLIGHT_LIVE_BASE must use http or https');
  }

  const baseUrl = rawBase.replace(/\/+$/, '');

  const probe = await probeTownState(baseUrl);
  if (!probe.ok) {
    skip(probe.reason, { base_url: baseUrl });
  }

  if (!probe.state.inn || typeof probe.state.inn !== 'object' || Array.isArray(probe.state.inn)) {
    skip('live API has no inn map (pre-slice-48 server)', { base_url: baseUrl });
  }

  const operatorKeyPath = (process.env.TOWN_OPERATOR_KEY_PATH || '').trim();
  if (!operatorKeyPath) {
    skip('TOWN_OPERATOR_KEY_PATH is not set', { base_url: baseUrl });
  }
  if (operatorKeyPath.includes('-----BEGIN')) {
    fail('TOWN_OPERATOR_KEY_PATH must be a filesystem path, not a raw key value');
  }

  let operatorKeyPem;
  try {
    operatorKeyPem = fs.readFileSync(operatorKeyPath, 'utf8');
  } catch (err) {
    skip(`TOWN_OPERATOR_KEY_PATH unreadable: ${err.code || err.message}`, { base_url: baseUrl });
  }
  if (!operatorKeyPem.trim()) {
    skip('TOWN_OPERATOR_KEY_PATH file is empty', { base_url: baseUrl });
  }

  const suffix = crypto.randomBytes(3).toString('hex');
  const handle = `proxyprobe-inn-${suffix}`;
  const keys = generateKeypair();
  const client = new GhostlightClient({
    baseUrl,
    handle,
    privateKeyPem: keys.privateKeyPem,
    pubkey: keys.pubkey,
  });

  let innKey = null;

  try {
    // 1. Join as proxyprobe-inn-* (origin musebook) -> admin/approve
    const joinRes = await client.join({
      origin: 'musebook',
      bio: 'Live-proxy inn probe (ephemeral)',
    });
    assert.equal(joinRes.status, 201, `join expected 201, got ${joinRes.status}`);
    assert.equal(joinRes.data?.status, 'pending', 'join status must be pending');

    const approveRes = await adminApprove(baseUrl, operatorKeyPem, handle);
    assert.equal(approveRes.status, 200, `admin/approve expected 200, got ${approveRes.status}`);
    assert.equal(approveRes.data?.status, 'active', 'approved status must be active');

    const s0 = await client.state();
    assert.equal(s0.status, 200);
    assert.ok(isTownState(s0.data), 'state after approve must be valid town state');
    let prevSeq = s0.data.state_seq;

    // 2. Claim lantern for 2 nights -> 201 + 12-char unambiguous key
    const claimRes = await client.claimInnRoom('lantern', 2);
    assert.equal(claimRes.status, 201, `claim expected 201, got ${claimRes.status}`);
    if (typeof claimRes.data?.key === 'string') {
      innKey = claimRes.data.key;
    }
    assert.equal(claimRes.data?.room, 'lantern', 'claim room must be lantern');
    assert.equal(claimRes.data?.handle, handle, 'claim handle must match');
    assert.equal(claimRes.data?.nights, 2, 'claim nights must be 2');
    assert.equal(
      claimRes.data?.expires_at,
      claimRes.data?.claimed_at + 2 * NIGHT_SEC,
      'expires_at must equal claimed_at + 2*86400'
    );
    assert.match(
      claimRes.data?.key ?? '',
      UNAMBIGUOUS_KEY_RE,
      'claim key must be 12 unambiguous base58-like characters'
    );

    // 3. Verify state after claim (state_seq, inn map, key never exposed)
    const s1 = await client.state();
    assert.equal(s1.status, 200);
    assert.ok(isTownState(s1.data), 'state after claim must be valid town state');
    assert.ok(s1.data.state_seq > prevSeq, 'state_seq must strictly increase after claim');
    prevSeq = s1.data.state_seq;

    assert.deepEqual(
      s1.data.inn?.lantern,
      {
        handle,
        nights: 2,
        expires_at: claimRes.data.expires_at,
      },
      'state.inn.lantern must match claimed room details'
    );
    assert.equal(s1.data.inn?.window, null, 'state.inn.window must be null');
    assert.equal(s1.data.inn?.quiet, null, 'state.inn.quiet must be null');
    assert.equal(
      JSON.stringify(s1.data).includes(innKey),
      false,
      'public state must never contain the inn key'
    );

    // 4. Extend +1 night with the key -> 200
    const extendRes = await client.extendInnStay('lantern', innKey, 1);
    assert.equal(extendRes.status, 200, `extend expected 200, got ${extendRes.status}`);
    assert.equal(extendRes.data?.nights, 3, 'extended nights must be 3');
    assert.equal(
      extendRes.data?.expires_at,
      claimRes.data.claimed_at + 3 * NIGHT_SEC,
      'extended expires_at must equal claimed_at + 3*86400'
    );

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    assert.ok(isTownState(s2.data), 'state after extend must be valid town state');
    assert.ok(s2.data.state_seq > prevSeq, 'state_seq must strictly increase after extend');
    prevSeq = s2.data.state_seq;
    assert.equal(s2.data.inn?.lantern?.nights, 3, 'state.inn.lantern.nights must be 3');

    // 5. Wrong-key extend -> 403
    const wrongExtendRes = await client.extendInnStay('lantern', 'WRONGKEY1234', 1);
    assert.equal(wrongExtendRes.status, 403, `wrong-key extend expected 403, got ${wrongExtendRes.status}`);

    // 6. Vacate with the key -> 200
    const vacateRes = await client.vacateInnRoom('lantern', innKey);
    assert.equal(vacateRes.status, 200, `vacate expected 200, got ${vacateRes.status}`);
    innKey = null;

    const s3 = await client.state();
    assert.equal(s3.status, 200);
    assert.ok(isTownState(s3.data), 'state after vacate must be valid town state');
    assert.ok(s3.data.state_seq > prevSeq, 'state_seq must strictly increase after vacate');
    assert.equal(s3.data.inn?.lantern, null, 'state.inn.lantern must be null after vacate');

    console.log(
      JSON.stringify({
        status: 'pass',
        base_url: baseUrl,
        handle,
        state_seq_start: s0.data.state_seq,
        state_seq_end: s3.data.state_seq,
      })
    );
    process.exit(0);
  } catch (err) {
    if (innKey) {
      await client.vacateInnRoom('lantern', innKey).catch(() => {});
    }
    fail(err.message || String(err), { base_url: baseUrl, handle });
  }
}

main();
