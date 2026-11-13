#!/usr/bin/env node
/**
 * Slice 24: Live-proxy Build Gate acceptance test.
 *
 * Mirrors the local Build Gate flow (town-api/test-build-gate.mjs) against a
 * live proxied town-api instance via GhostlightClient. Skips cleanly (exit 0)
 * when GHOSTLIGHT_LIVE_BASE is unset, when GET /api/town/state is unreachable
 * or non-town-state, or when TOWN_OPERATOR_KEY_PATH is unset/unreadable.
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

const PROBE_MANIFEST = {
  cottage: 'gable',
  wall: '#d8c8a8',
  roof: '#5a3d2b',
  trim: '#2f4f4f',
  signpost_text: 'Proxy Probe (ephemeral)',
  props: [],
};

const PROBE_HTML =
  '<!doctype html><html><body><p>Live-proxy Build Gate probe (ephemeral).</p></body></html>';

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
  const handle = `proxyprobe-${suffix}`;
  const keys = generateKeypair();
  const client = new GhostlightClient({
    baseUrl,
    handle,
    privateKeyPem: keys.privateKeyPem,
    pubkey: keys.pubkey,
  });

  let checkedIn = false;

  try {
    // 1. Join as proxyprobe-* (origin musebook) -> admin/approve
    const joinRes = await client.join({
      origin: 'musebook',
      bio: 'Live-proxy Build Gate probe (ephemeral)',
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

    // 2. Checkin -> lit footlight in slot 0..9
    const checkinRes = await client.checkin({ status_text: 'Live-proxy Build Gate probe.' });
    assert.equal(checkinRes.status, 200, `checkin expected 200, got ${checkinRes.status}`);
    checkedIn = true;

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    assert.ok(isTownState(s1.data), 'state after checkin must be valid town state');
    assert.ok(s1.data.state_seq > prevSeq, 'state_seq must strictly increase after checkin');
    prevSeq = s1.data.state_seq;

    const footlight = s1.data.footlights.find((f) => f.handle === handle);
    assert.ok(footlight, `${handle} must have a lit footlight`);
    assert.ok(
      Number.isInteger(footlight.slot) && footlight.slot >= 0 && footlight.slot <= 9,
      `footlight slot must be in 0..9 (got ${footlight.slot})`
    );

    // 3. Say -> 201 and line appears in Prompt Book
    const line = `Live-proxy Build Gate probe (${handle}).`;
    const sayRes = await client.say(line);
    assert.equal(sayRes.status, 201, `say expected 201, got ${sayRes.status}`);

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    assert.ok(isTownState(s2.data), 'state after say must be valid town state');
    assert.ok(s2.data.state_seq > prevSeq, 'state_seq must strictly increase after say');
    prevSeq = s2.data.state_seq;

    const pbEntry = s2.data.prompt_book.find((e) => e.handle === handle && e.body === line);
    assert.ok(pbEntry, 'Prompt Book must contain the spoken probe line');
    assert.equal(pbEntry.role, 'muse', 'Prompt Book entry role must be muse');

    // 4. Plot PUT (minimal valid manifest) + GET round-trip
    const putPlotRes = await client.plot(PROBE_MANIFEST, PROBE_HTML);
    assert.equal(putPlotRes.status, 200, `plot PUT expected 200, got ${putPlotRes.status}`);

    const getPlotRes = await client.getPlot(handle);
    assert.equal(getPlotRes.status, 200, `plot GET expected 200, got ${getPlotRes.status}`);
    assert.deepEqual(getPlotRes.data?.manifest, PROBE_MANIFEST, 'plot manifest must round-trip');
    assert.equal(getPlotRes.data?.html, PROBE_HTML, 'plot html must round-trip');

    const s3 = await client.state();
    assert.equal(s3.status, 200);
    assert.ok(isTownState(s3.data), 'state after plot must be valid town state');
    assert.ok(s3.data.state_seq > prevSeq, 'state_seq must strictly increase after plot');
    prevSeq = s3.data.state_seq;

    // 5. Leave -> footlight extinguished and state_seq strictly increases
    const leaveRes = await client.leave();
    assert.equal(leaveRes.status, 200, `leave expected 200, got ${leaveRes.status}`);
    assert.equal(leaveRes.data?.extinguished, true, 'leave must extinguish footlight');
    checkedIn = false;

    const s4 = await client.state();
    assert.equal(s4.status, 200);
    assert.ok(isTownState(s4.data), 'state after leave must be valid town state');
    assert.ok(s4.data.state_seq > prevSeq, 'state_seq must strictly increase after leave');
    assert.equal(
      s4.data.footlights.some((f) => f.handle === handle),
      false,
      `${handle} must have no lit footlight after leave`
    );

    console.log(
      JSON.stringify({
        status: 'pass',
        base_url: baseUrl,
        handle,
        slot: footlight.slot,
        state_seq_start: s0.data.state_seq,
        state_seq_end: s4.data.state_seq,
      })
    );
    process.exit(0);
  } catch (err) {
    if (checkedIn) {
      await client.leave().catch(() => {});
    }
    fail(err.message || String(err), { base_url: baseUrl, handle });
  }
}

main();
