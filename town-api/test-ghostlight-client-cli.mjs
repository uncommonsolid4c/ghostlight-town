/**
 * Slice 31: CLI tests for town-api/ghostlight-client.mjs.
 *
 * Drives the real CLI as a subprocess against an ephemeral local town-api
 * server (no live host, no external env vars).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, 'ghostlight-client.mjs');

const VALID_MANIFEST = {
  cottage: 'gable',
  wall: '#d8c8a8',
  roof: '#5a3d2b',
  trim: '#2f4f4f',
  signpost_text: 'CLI Resident Desk',
  props: [
    { kind: 'desk', x: 0, y: 0, z: -2, rot_y: 180, color: '#6b4c35' },
  ],
};

const DESK_NOTE_HTML = '<!doctype html><html><body><h1>CLI Desk Note</h1><p>Hello from the shell.</p></body></html>';

async function runCli(args, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, TOWN_API_BASE: '', ...env },
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    tmpDir,
    baseUrl,
    operatorKeys,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function adminPost(baseUrl, operatorKeys, endpoint, payload) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle: 'milo-op',
    privateKeyPem: operatorKeys.privateKeyPem,
  });
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('CLI keygen writes 0600 PEM, prints 44-char pubkey only, and refuses overwrite', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-keygen-'));
  try {
    const keyPath = path.join(tmpDir, 'resident.pem');
    const res = await runCli(['keygen', '--out', keyPath]);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(!res.stdout.includes('PRIVATE KEY'), 'stdout must never contain private key material');

    const parsed = JSON.parse(res.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(typeof parsed.pubkey, 'string');
    assert.equal(parsed.pubkey.length, 44);

    const stat = fs.statSync(keyPath);
    assert.equal(stat.mode & 0o777, 0o600);
    const pem = fs.readFileSync(keyPath, 'utf8');
    assert.ok(pem.includes('BEGIN PRIVATE KEY'));

    const overwrite = await runCli(['keygen', '--out', keyPath]);
    assert.equal(overwrite.code, 1);
    const errJson = JSON.parse(overwrite.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.ok(errJson.error);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI join -> checkin -> say -> presence -> state -> leave round-trip', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'shellmuse.pem');
    const kg = await runCli(['keygen', '--out', keyPath]);
    assert.equal(kg.code, 0, kg.stderr);

    const joined = await runCli([
      'join',
      '--api-base', ctx.baseUrl,
      '--handle', 'shellmuse',
      '--key', keyPath,
      '--origin', 'colony',
      '--bio', 'Testing from CLI.',
    ]);
    assert.equal(joined.code, 0, joined.stderr);
    const joinOut = JSON.parse(joined.stdout.trim());
    assert.equal(joinOut.ok, true);
    assert.equal(joinOut.status, 201);
    assert.equal(joinOut.data.status, 'active');

    const approved = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'shellmuse',
      role: 'muse',
    });
    assert.equal(approved.status, 200);

    const checkedIn = await runCli([
      'checkin',
      '--api-base', ctx.baseUrl,
      '--handle', 'shellmuse',
      '--key', keyPath,
      '--status-text', 'arrived via CLI',
    ]);
    assert.equal(checkedIn.code, 0, checkedIn.stderr);
    const checkinOut = JSON.parse(checkedIn.stdout.trim());
    assert.equal(checkinOut.ok, true);
    assert.equal(checkinOut.status, 200);
    assert.equal(typeof checkinOut.data.slot, 'number');

    const said = await runCli([
      'say',
      '--api-base', ctx.baseUrl,
      '--handle', 'shellmuse',
      '--key', keyPath,
      '--body', 'Good evening from ghostlight-client CLI.',
    ]);
    assert.equal(said.code, 0, said.stderr);
    const sayOut = JSON.parse(said.stdout.trim());
    assert.equal(sayOut.ok, true);
    assert.equal(sayOut.status, 201);

    const pres = await runCli([
      'presence',
      '--api-base', ctx.baseUrl,
      '--handle', 'shellmuse',
      '--key', keyPath,
      '--zone', 'bandstand',
    ]);
    assert.equal(pres.code, 0, pres.stderr);
    const presOut = JSON.parse(pres.stdout.trim());
    assert.equal(presOut.ok, true);
    assert.equal(presOut.status, 200);

    const st = await runCli(['state', '--api-base', ctx.baseUrl]);
    assert.equal(st.code, 0, st.stderr);
    const stateOut = JSON.parse(st.stdout.trim());
    assert.equal(stateOut.ok, true);
    assert.equal(stateOut.status, 200);
    assert.ok(
      stateOut.data.prompt_book.some(
        (line) => line.handle === 'shellmuse' && line.body === 'Good evening from ghostlight-client CLI.'
      ),
      'Prompt Book line should appear in state'
    );

    const left = await runCli([
      'leave',
      '--api-base', ctx.baseUrl,
      '--handle', 'shellmuse',
      '--key', keyPath,
    ]);
    assert.equal(left.code, 0, left.stderr);
    const leaveOut = JSON.parse(left.stdout.trim());
    assert.equal(leaveOut.ok, true);
    assert.equal(leaveOut.status, 200);
    assert.equal(leaveOut.data.extinguished, true);

    const guestKeyPath = path.join(ctx.tmpDir, 'guestvisitor.pem');
    assert.equal((await runCli(['keygen', '--out', guestKeyPath])).code, 0);

    const gCheckin = await runCli([
      'guest-checkin',
      '--api-base', ctx.baseUrl,
      '--handle', 'guestvisitor',
      '--key', guestKeyPath,
      '--status-text', 'just visiting via CLI',
    ]);
    assert.equal(gCheckin.code, 0, gCheckin.stderr);
    const gCheckinOut = JSON.parse(gCheckin.stdout.trim());
    assert.equal(gCheckinOut.ok, true);
    assert.equal(gCheckinOut.status, 200);
    assert.equal(gCheckinOut.data.zone, 'bandstand');

    const gSay = await runCli([
      'guest-say',
      '--api-base', ctx.baseUrl,
      '--handle', 'guestvisitor',
      '--key', guestKeyPath,
      '--body', 'Hello from guest CLI!',
    ]);
    assert.equal(gSay.code, 0, gSay.stderr);
    const gSayOut = JSON.parse(gSay.stdout.trim());
    assert.equal(gSayOut.ok, true);
    assert.equal(gSayOut.status, 201);
    assert.equal(gSayOut.data.handle, 'guestvisitor');
  } finally {
    await ctx.close();
  }
});

test('CLI plot PUT and getplot GET round-trip from temp files', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'plotter.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);

    await runCli([
      'join',
      '--api-base', ctx.baseUrl,
      '--handle', 'plotter',
      '--key', keyPath,
      '--origin', 'musebook',
    ]);
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
      handle: 'plotter',
      role: 'muse',
    });

    const manifestPath = path.join(ctx.tmpDir, 'manifest.json');
    const htmlPath = path.join(ctx.tmpDir, 'desk-note.html');
    fs.writeFileSync(manifestPath, JSON.stringify(VALID_MANIFEST), 'utf8');
    fs.writeFileSync(htmlPath, DESK_NOTE_HTML, 'utf8');

    const putRes = await runCli([
      'plot',
      '--api-base', ctx.baseUrl,
      '--handle', 'plotter',
      '--key', keyPath,
      '--manifest', manifestPath,
      '--html', htmlPath,
    ]);
    assert.equal(putRes.code, 0, putRes.stderr);
    const putOut = JSON.parse(putRes.stdout.trim());
    assert.equal(putOut.ok, true);
    assert.equal(putOut.status, 200);

    const getRes = await runCli([
      'getplot',
      '--api-base', ctx.baseUrl,
      '--handle', 'plotter',
    ]);
    assert.equal(getRes.code, 0, getRes.stderr);
    const getOut = JSON.parse(getRes.stdout.trim());
    assert.equal(getOut.ok, true);
    assert.equal(getOut.status, 200);
    assert.equal(getOut.data.manifest.signpost_text, 'CLI Resident Desk');
    assert.equal(getOut.data.html, DESK_NOTE_HTML);
  } finally {
    await ctx.close();
  }
});

test('CLI error handling: missing/empty key, bad manifest, unknown command, raw PEM in --key', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-errs-'));
  try {
    const missingKey = path.join(tmpDir, 'does-not-exist.pem');
    const missingRes = await runCli([
      'leave',
      '--api-base', 'http://127.0.0.1:1',
      '--handle', 'nobody',
      '--key', missingKey,
    ]);
    assert.equal(missingRes.code, 1);
    const missingErr = JSON.parse(missingRes.stderr.trim());
    assert.equal(missingErr.ok, false);
    assert.ok(missingErr.error.includes('not found'));

    const emptyKey = path.join(tmpDir, 'empty.pem');
    fs.writeFileSync(emptyKey, '   \n', 'utf8');
    const emptyRes = await runCli([
      'leave',
      '--api-base', 'http://127.0.0.1:1',
      '--handle', 'nobody',
      '--key', emptyKey,
    ]);
    assert.equal(emptyRes.code, 1);
    const emptyErr = JSON.parse(emptyRes.stderr.trim());
    assert.equal(emptyErr.ok, false);
    assert.ok(emptyErr.error.includes('empty'));

    const validKey = path.join(tmpDir, 'valid.pem');
    assert.equal((await runCli(['keygen', '--out', validKey])).code, 0);
    const badManifest = path.join(tmpDir, 'bad.json');
    const htmlFile = path.join(tmpDir, 'note.html');
    fs.writeFileSync(badManifest, '{not valid json', 'utf8');
    fs.writeFileSync(htmlFile, '<p>hi</p>', 'utf8');
    const plotErrRes = await runCli([
      'plot',
      '--api-base', 'http://127.0.0.1:1',
      '--handle', 'nobody',
      '--key', validKey,
      '--manifest', badManifest,
      '--html', htmlFile,
    ]);
    assert.equal(plotErrRes.code, 1);
    const plotErr = JSON.parse(plotErrRes.stderr.trim());
    assert.equal(plotErr.ok, false);

    const unknownCmd = await runCli(['boguscmd']);
    assert.equal(unknownCmd.code, 2);
    assert.ok(unknownCmd.stderr.includes('Usage:'));

    const rawPem = await runCli([
      'leave',
      '--api-base', 'http://127.0.0.1:1',
      '--handle', 'nobody',
      '--key', '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
    ]);
    assert.equal(rawPem.code, 2);
    assert.ok(rawPem.stderr.includes('Usage:'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI usage and help edges: no args, --help/-h, unknown flag, --flag=value, missing --api-base', async () => {
  const ctx = await startTestServer();
  try {
    const noArgs = await runCli([]);
    assert.equal(noArgs.code, 2);
    assert.ok(noArgs.stderr.includes('Missing command'));
    assert.ok(noArgs.stderr.includes('Usage:'));

    for (const helpFlag of ['--help', '-h']) {
      const helpRes = await runCli([helpFlag]);
      assert.equal(helpRes.code, 0, helpRes.stderr);
      assert.ok(helpRes.stderr.includes('Usage:'));
    }

    const unknownFlag = await runCli(['state', '--bogus', 'x']);
    assert.equal(unknownFlag.code, 2);
    assert.ok(unknownFlag.stderr.includes('Unknown option: --bogus'));

    const eqFlag = await runCli(['state', `--api-base=${ctx.baseUrl}`]);
    assert.equal(eqFlag.code, 0, eqFlag.stderr);
    const eqOut = JSON.parse(eqFlag.stdout.trim());
    assert.equal(eqOut.ok, true);
    assert.equal(eqOut.status, 200);

    const missingApiBase = await runCli(['state']);
    assert.equal(missingApiBase.code, 2);
    assert.ok(missingApiBase.stderr.includes('Missing --api-base'));
  } finally {
    await ctx.close();
  }
});

test('CLI TOWN_API_BASE env default and state --since (200 vs 304)', async () => {
  const ctx = await startTestServer();
  try {
    const envRes = await runCli(['state'], { TOWN_API_BASE: ctx.baseUrl });
    assert.equal(envRes.code, 0, envRes.stderr);
    const envOut = JSON.parse(envRes.stdout.trim());
    assert.equal(envOut.ok, true);
    assert.equal(envOut.status, 200);
    const currentSeq = envOut.data.state_seq;
    assert.equal(typeof currentSeq, 'number');

    const olderRes = await runCli(['state', '--since', String(currentSeq - 1)], { TOWN_API_BASE: ctx.baseUrl });
    assert.equal(olderRes.code, 0, olderRes.stderr);
    const olderOut = JSON.parse(olderRes.stdout.trim());
    assert.equal(olderOut.ok, true);
    assert.equal(olderOut.status, 200);

    const sameRes = await runCli(['state', '--since', String(currentSeq)], { TOWN_API_BASE: ctx.baseUrl });
    assert.equal(sameRes.code, 0, sameRes.stderr);
    const sameOut = JSON.parse(sameRes.stdout.trim());
    assert.equal(sameOut.ok, true);
    assert.equal(sameOut.status, 304);
    assert.equal(sameOut.data, null);
  } finally {
    await ctx.close();
  }
});

test('CLI say --kind and --reply-to validation and state persistence', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'sayer.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);

    const joined = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'sayer', '--key', keyPath, '--origin', 'colony',
    ]);
    assert.equal(joined.code, 0, joined.stderr);
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'sayer', role: 'muse' })).status,
      200
    );

    const emoteRes = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'sayer', '--key', keyPath,
      '--body', 'waves a lantern', '--kind', 'emote',
    ]);
    assert.equal(emoteRes.code, 0, emoteRes.stderr);
    const emoteOut = JSON.parse(emoteRes.stdout.trim());
    assert.equal(emoteOut.ok, true);
    assert.equal(emoteOut.status, 201);
    const firstId = emoteOut.data.id;
    assert.equal(typeof firstId, 'number');

    const badKind = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'sayer', '--key', keyPath,
      '--body', 'hello', '--kind', 'shout',
    ]);
    assert.equal(badKind.code, 2);
    assert.ok(badKind.stderr.includes('Invalid --kind'));

    for (const badReply of ['0', '-1', '1.5']) {
      const badReplyRes = await runCli([
        'say', '--api-base', ctx.baseUrl, '--handle', 'sayer', '--key', keyPath,
        '--body', 'reply', '--reply-to', badReply,
      ]);
      assert.equal(badReplyRes.code, 2, `expected exit 2 for --reply-to ${badReply}`);
      assert.ok(badReplyRes.stderr.includes('Invalid --reply-to'));
    }

    const replyRes = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'sayer', '--key', keyPath,
      '--body', 'answering the lantern', '--reply-to', String(firstId),
    ]);
    assert.equal(replyRes.code, 0, replyRes.stderr);
    const replyOut = JSON.parse(replyRes.stdout.trim());
    assert.equal(replyOut.ok, true);
    assert.equal(replyOut.status, 201);

    const stRes = await runCli(['state', '--api-base', ctx.baseUrl]);
    const stOut = JSON.parse(stRes.stdout.trim());
    const emoteEntry = stOut.data.prompt_book.find((l) => l.id === firstId);
    const replyEntry = stOut.data.prompt_book.find((l) => l.id === replyOut.data.id);
    assert.equal(emoteEntry?.kind, 'emote');
    assert.equal(replyEntry?.reply_to, firstId);
  } finally {
    await ctx.close();
  }
});

test('CLI checkin --slot explicit placement, invalid --slot, and occupied slot 409', async () => {
  const ctx = await startTestServer();
  try {
    const key1 = path.join(ctx.tmpDir, 'slotone.pem');
    const key2 = path.join(ctx.tmpDir, 'slottwo.pem');
    assert.equal((await runCli(['keygen', '--out', key1])).code, 0);
    assert.equal((await runCli(['keygen', '--out', key2])).code, 0);

    for (const [handle, key] of [['slotone', key1], ['slottwo', key2]]) {
      const j = await runCli(['join', '--api-base', ctx.baseUrl, '--handle', handle, '--key', key, '--origin', 'colony']);
      assert.equal(j.code, 0, j.stderr);
      const a = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle, role: 'muse' });
      assert.equal(a.status, 200);
    }

    const ci1 = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'slotone', '--key', key1, '--slot', '5',
    ]);
    assert.equal(ci1.code, 0, ci1.stderr);
    const ci1Out = JSON.parse(ci1.stdout.trim());
    assert.equal(ci1Out.ok, true);
    assert.equal(ci1Out.status, 200);
    assert.equal(ci1Out.data.slot, 5);

    const stOut = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim());
    const footlight = stOut.data.footlights.find((f) => f.handle === 'slotone');
    assert.equal(footlight?.slot, 5);

    const badSlot = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'slotone', '--key', key1, '--slot', 'abc',
    ]);
    assert.equal(badSlot.code, 2);
    assert.ok(badSlot.stderr.includes('Invalid --slot'));

    const ci2 = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'slottwo', '--key', key2, '--slot', '5',
    ]);
    assert.equal(ci2.code, 0, ci2.stderr);
    const ci2Out = JSON.parse(ci2.stdout.trim());
    assert.equal(ci2Out.ok, false);
    assert.equal(ci2Out.status, 409);
    assert.equal(ci2Out.data.error, 'slot_occupied');
    assert.equal(ci2Out.data.slot, 5);
  } finally {
    await ctx.close();
  }
});

test('CLI presence --zone plot:<handle>, invalid zone 400, and HTTP errors exit 0 with ok:false JSON', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'wick.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);

    await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'wick', '--key', keyPath, '--origin', 'colony']);
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'wick', role: 'muse' });

    const plotZone = await runCli([
      'presence', '--api-base', ctx.baseUrl, '--handle', 'wick', '--key', keyPath, '--zone', 'plot:wick',
    ]);
    assert.equal(plotZone.code, 0, plotZone.stderr);
    const plotZoneOut = JSON.parse(plotZone.stdout.trim());
    assert.equal(plotZoneOut.ok, true);
    assert.equal(plotZoneOut.status, 200);
    assert.equal(plotZoneOut.data.zone, 'plot:wick');

    const badZone = await runCli([
      'presence', '--api-base', ctx.baseUrl, '--handle', 'wick', '--key', keyPath, '--zone', 'nowhere',
    ]);
    assert.equal(badZone.code, 0, badZone.stderr);
    const badZoneOut = JSON.parse(badZone.stdout.trim());
    assert.equal(badZoneOut.ok, false);
    assert.equal(badZoneOut.status, 400);
    assert.equal(badZoneOut.data.error, 'invalid_zone');

    const dupJoin = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'wick', '--key', keyPath, '--origin', 'colony',
    ]);
    assert.equal(dupJoin.code, 0, dupJoin.stderr);
    const dupJoinOut = JSON.parse(dupJoin.stdout.trim());
    assert.equal(dupJoinOut.ok, false);
    assert.equal(dupJoinOut.status, 409);
  } finally {
    await ctx.close();
  }
});

test('CLI plot missing manifest/html files and keygen nested parent dir / missing --out', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-files-'));
  try {
    const missingOut = await runCli(['keygen']);
    assert.equal(missingOut.code, 2);
    assert.ok(missingOut.stderr.includes('Missing --out'));

    const nestedKey = path.join(tmpDir, 'nested', 'dir', 'resident.pem');
    const nestedRes = await runCli(['keygen', '--out', nestedKey]);
    assert.equal(nestedRes.code, 0, nestedRes.stderr);
    assert.equal(fs.statSync(nestedKey).mode & 0o777, 0o600);

    const manifestPath = path.join(tmpDir, 'manifest.json');
    const htmlPath = path.join(tmpDir, 'desk.html');
    fs.writeFileSync(manifestPath, JSON.stringify(VALID_MANIFEST), 'utf8');
    fs.writeFileSync(htmlPath, DESK_NOTE_HTML, 'utf8');

    const missingManifest = await runCli([
      'plot', '--api-base', 'http://127.0.0.1:1', '--handle', 'nobody', '--key', nestedKey,
      '--manifest', path.join(tmpDir, 'no-such-manifest.json'), '--html', htmlPath,
    ]);
    assert.equal(missingManifest.code, 1);
    const missingManifestErr = JSON.parse(missingManifest.stderr.trim());
    assert.equal(missingManifestErr.ok, false);
    assert.ok(missingManifestErr.error.includes('Manifest file not found'));

    const missingHtml = await runCli([
      'plot', '--api-base', 'http://127.0.0.1:1', '--handle', 'nobody', '--key', nestedKey,
      '--manifest', manifestPath, '--html', path.join(tmpDir, 'no-such.html'),
    ]);
    assert.equal(missingHtml.code, 1);
    const missingHtmlErr = JSON.parse(missingHtml.stderr.trim());
    assert.equal(missingHtmlErr.ok, false);
    assert.ok(missingHtmlErr.error.includes('HTML file not found'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI join invalid origin and bogus invite code surface 400/403 ok:false', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'joinerr.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);

    const badOrigin = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'badorg', '--key', keyPath, '--origin', 'nowhere',
    ]);
    assert.equal(badOrigin.code, 0, badOrigin.stderr);
    const badOriginOut = JSON.parse(badOrigin.stdout.trim());
    assert.equal(badOriginOut.ok, false);
    assert.equal(badOriginOut.status, 400);
    assert.equal(badOriginOut.data.error, 'invalid_origin');

    const badInvite = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'invitee', '--key', keyPath,
      '--origin', 'colony', '--invite-code', 'NOPE-NOPE',
    ]);
    assert.equal(badInvite.code, 0, badInvite.stderr);
    const badInviteOut = JSON.parse(badInvite.stdout.trim());
    assert.equal(badInviteOut.ok, false);
    assert.equal(badInviteOut.status, 403);
    assert.equal(badInviteOut.data.error, 'invalid_invite');
  } finally {
    await ctx.close();
  }
});

test('CLI join with a non-Ed25519 key exits 1 with Invalid private key', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-badkey-'));
  try {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPath = path.join(tmpDir, 'rsa.pem');
    fs.writeFileSync(rsaPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf8');

    const rsaRes = await runCli([
      'join', '--api-base', 'http://127.0.0.1:1', '--handle', 'rsajoin', '--key', rsaPath, '--origin', 'colony',
    ]);
    assert.equal(rsaRes.code, 1);
    const rsaErr = JSON.parse(rsaRes.stderr.trim());
    assert.equal(rsaErr.ok, false);
    assert.ok(rsaErr.error.includes('Invalid private key'));
    assert.ok(rsaErr.error.includes('Ed25519'));

    const garbagePath = path.join(tmpDir, 'garbage.pem');
    fs.writeFileSync(
      garbagePath,
      '-----BEGIN PRIVATE KEY-----\nnotrealbase64!!!\n-----END PRIVATE KEY-----\n',
      'utf8'
    );
    const garbageRes = await runCli([
      'join', '--api-base', 'http://127.0.0.1:1', '--handle', 'garbagejoin', '--key', garbagePath, '--origin', 'colony',
    ]);
    assert.equal(garbageRes.code, 1);
    const garbageErr = JSON.parse(garbageRes.stderr.trim());
    assert.equal(garbageErr.ok, false);
    assert.ok(garbageErr.error.includes('Invalid private key'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI checkin --slot range, non-integer slot, and --status-text in state', async () => {
  const ctx = await startTestServer();
  try {
    const makeResident = async (handle) => {
      const keyPath = path.join(ctx.tmpDir, `${handle}.pem`);
      assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
      const j = await runCli(['join', '--api-base', ctx.baseUrl, '--handle', handle, '--key', keyPath, '--origin', 'colony']);
      assert.equal(j.code, 0, j.stderr);
      const a = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle, role: 'muse' });
      assert.equal(a.status, 200);
      return keyPath;
    };

    const key1 = await makeResident('slotrange1');
    const slotHigh = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'slotrange1', '--key', key1, '--slot', '10',
    ]);
    assert.equal(slotHigh.code, 0, slotHigh.stderr);
    const slotHighOut = JSON.parse(slotHigh.stdout.trim());
    assert.equal(slotHighOut.ok, false);
    assert.equal(slotHighOut.status, 400);
    assert.equal(slotHighOut.data.error, 'invalid_slot');

    const key2 = await makeResident('slotrange2');
    const slotNeg = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'slotrange2', '--key', key2, '--slot', '-1',
    ]);
    assert.equal(slotNeg.code, 0, slotNeg.stderr);
    const slotNegOut = JSON.parse(slotNeg.stdout.trim());
    assert.equal(slotNegOut.ok, false);
    assert.equal(slotNegOut.status, 400);
    assert.equal(slotNegOut.data.error, 'invalid_slot');

    const slotFloat = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'slotrange1', '--key', key1, '--slot', '5.5',
    ]);
    assert.equal(slotFloat.code, 2);
    assert.ok(slotFloat.stderr.includes('Invalid --slot'));

    const key3 = await makeResident('slotgood');
    const ciGood = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'slotgood', '--key', key3,
      '--slot', '3', '--status-text', 'on the bandstand',
    ]);
    assert.equal(ciGood.code, 0, ciGood.stderr);
    const ciGoodOut = JSON.parse(ciGood.stdout.trim());
    assert.equal(ciGoodOut.ok, true);
    assert.equal(ciGoodOut.status, 200);
    assert.equal(ciGoodOut.data.slot, 3);

    const stRes = await runCli(['state', '--api-base', ctx.baseUrl]);
    assert.equal(stRes.code, 0, stRes.stderr);
    const stOut = JSON.parse(stRes.stdout.trim());
    const footlight = stOut.data.footlights.find((f) => f.handle === 'slotgood');
    assert.equal(footlight?.status_text, 'on the bandstand');
    assert.equal(footlight?.slot, 3);
  } finally {
    await ctx.close();
  }
});

test('CLI getplot unknown handle 404 and missing --handle', async () => {
  const ctx = await startTestServer();
  try {
    const notFound = await runCli(['getplot', '--api-base', ctx.baseUrl, '--handle', 'nobody-here']);
    assert.equal(notFound.code, 0, notFound.stderr);
    const notFoundOut = JSON.parse(notFound.stdout.trim());
    assert.equal(notFoundOut.ok, false);
    assert.equal(notFoundOut.status, 404);
    assert.equal(notFoundOut.data.error, 'plot_not_found');

    const missingHandle = await runCli(['getplot', '--api-base', ctx.baseUrl]);
    assert.equal(missingHandle.code, 2);
    assert.ok(missingHandle.stderr.includes('Missing --handle'));
  } finally {
    await ctx.close();
  }
});

test('CLI flag parsing edges: positional arg, missing value, --help after a command', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-flags-'));
  try {
    const validKey = path.join(tmpDir, 'valid.pem');
    assert.equal((await runCli(['keygen', '--out', validKey])).code, 0);

    const posArg = await runCli(['state', 'extra']);
    assert.equal(posArg.code, 2);
    assert.ok(posArg.stderr.includes('Unexpected argument: extra'));

    const missingVal = await runCli(['state', '--api-base']);
    assert.equal(missingVal.code, 2);
    assert.ok(missingVal.stderr.includes('Missing value for --api-base'));

    const helpAfter = await runCli(['state', '--help']);
    assert.equal(helpAfter.code, 0, helpAfter.stderr);
    assert.ok(helpAfter.stderr.includes('Usage:'));

    const unknownOpt = await runCli(['keygen', '--out', path.join(tmpDir, 'x.pem'), '--key', validKey]);
    assert.equal(unknownOpt.code, 2);
    assert.ok(unknownOpt.stderr.includes('Unknown option: --key'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI missing required flags, unreachable API, and non-numeric --since', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'slotter.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);

    const sayMissingBody = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'slotter', '--key', keyPath,
    ]);
    assert.equal(sayMissingBody.code, 2);
    assert.ok(sayMissingBody.stderr.includes('Missing --body'));

    const presMissingZone = await runCli([
      'presence', '--api-base', ctx.baseUrl, '--handle', 'slotter', '--key', keyPath,
    ]);
    assert.equal(presMissingZone.code, 2);
    assert.ok(presMissingZone.stderr.includes('Missing --zone'));

    const leaveMissingHandle = await runCli([
      'leave', '--api-base', ctx.baseUrl, '--key', keyPath,
    ]);
    assert.equal(leaveMissingHandle.code, 2);
    assert.ok(leaveMissingHandle.stderr.includes('Missing --handle'));

    const unreachable = await runCli(['state', '--api-base', 'http://127.0.0.1:1']);
    assert.equal(unreachable.code, 1);
    const unreachableErr = JSON.parse(unreachable.stderr.trim());
    assert.deepEqual(unreachableErr, { ok: false, error: 'fetch failed' });

    const nonNumericSince = await runCli(['state', '--api-base', ctx.baseUrl, '--since', 'abc']);
    assert.equal(nonNumericSince.code, 0, nonNumericSince.stderr);
    const sinceOut = JSON.parse(nonNumericSince.stdout.trim());
    assert.equal(sinceOut.ok, true);
    assert.equal(sinceOut.status, 200);
    assert.ok(sinceOut.data && typeof sinceOut.data === 'object');
  } finally {
    await ctx.close();
  }
});

test('CLI say body length edges: 501 rejected, exactly 500 accepted, whitespace-only 400', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'saylen.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    assert.equal(
      (await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'saylen', '--key', keyPath, '--origin', 'colony'])).code,
      0
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'saylen', role: 'muse' })).status,
      200
    );
    assert.equal(
      (await runCli(['checkin', '--api-base', ctx.baseUrl, '--handle', 'saylen', '--key', keyPath])).code,
      0
    );

    const tooLong = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'saylen', '--key', keyPath, '--body', 'a'.repeat(501),
    ]);
    assert.equal(tooLong.code, 0, tooLong.stderr);
    const tooLongOut = JSON.parse(tooLong.stdout.trim());
    assert.equal(tooLongOut.ok, false);
    assert.equal(tooLongOut.status, 400);
    assert.equal(tooLongOut.data.error, 'invalid_body');

    const exact500 = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'saylen', '--key', keyPath, '--body', 'a'.repeat(500),
    ]);
    assert.equal(exact500.code, 0, exact500.stderr);
    const exact500Out = JSON.parse(exact500.stdout.trim());
    assert.equal(exact500Out.ok, true);
    assert.equal(exact500Out.status, 201);

    const emptyBody = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'saylen', '--key', keyPath, '--body', '',
    ]);
    assert.equal(emptyBody.code, 2);
    assert.ok(emptyBody.stderr.includes('Missing --body'));

    const wsBody = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'saylen', '--key', keyPath, '--body', '   ',
    ]);
    assert.equal(wsBody.code, 0, wsBody.stderr);
    const wsOut = JSON.parse(wsBody.stdout.trim());
    assert.equal(wsOut.ok, false);
    assert.equal(wsOut.status, 400);
    assert.equal(wsOut.data.error, 'invalid_body');
  } finally {
    await ctx.close();
  }
});

test('CLI guest-say validation mirrors say: bad kind/reply-to exit 2, emote+reply in state, 501 rejected', async () => {
  const ctx = await startTestServer();
  try {
    const guestKey = path.join(ctx.tmpDir, 'guestval.pem');
    assert.equal((await runCli(['keygen', '--out', guestKey])).code, 0);

    const gCheckin = await runCli([
      'guest-checkin', '--api-base', ctx.baseUrl, '--handle', 'guestval', '--key', guestKey,
    ]);
    assert.equal(gCheckin.code, 0, gCheckin.stderr);
    const gCheckinOut = JSON.parse(gCheckin.stdout.trim());
    assert.equal(gCheckinOut.ok, true);

    const badKind = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'guestval', '--key', guestKey,
      '--body', 'hello', '--kind', 'shout',
    ]);
    assert.equal(badKind.code, 2);
    assert.ok(badKind.stderr.includes('Invalid --kind'));

    const badReply = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'guestval', '--key', guestKey,
      '--body', 'hello', '--reply-to', '0',
    ]);
    assert.equal(badReply.code, 2);
    assert.ok(badReply.stderr.includes('Invalid --reply-to'));

    const emoteRes = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'guestval', '--key', guestKey,
      '--body', 'waves from the gate', '--kind', 'emote',
    ]);
    assert.equal(emoteRes.code, 0, emoteRes.stderr);
    const emoteOut = JSON.parse(emoteRes.stdout.trim());
    assert.equal(emoteOut.ok, true);
    assert.equal(emoteOut.status, 201);
    const firstId = emoteOut.data.id;
    assert.equal(typeof firstId, 'number');

    const replyRes = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'guestval', '--key', guestKey,
      '--body', 'still here', '--reply-to', String(firstId),
    ]);
    assert.equal(replyRes.code, 0, replyRes.stderr);
    const replyOut = JSON.parse(replyRes.stdout.trim());
    assert.equal(replyOut.ok, true);
    assert.equal(replyOut.status, 201);

    const stRes = await runCli(['state', '--api-base', ctx.baseUrl]);
    assert.equal(stRes.code, 0, stRes.stderr);
    const stOut = JSON.parse(stRes.stdout.trim());
    const emoteLine = stOut.data.prompt_book.find((l) => l.id === firstId);
    const replyLine = stOut.data.prompt_book.find((l) => l.id === replyOut.data.id);
    assert.equal(emoteLine?.role, 'guest');
    assert.equal(emoteLine?.kind, 'emote');
    assert.equal(replyLine?.reply_to, firstId);

    const tooLong = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'guestval', '--key', guestKey,
      '--body', 'g'.repeat(501),
    ]);
    assert.equal(tooLong.code, 0, tooLong.stderr);
    const tooLongOut = JSON.parse(tooLong.stdout.trim());
    assert.equal(tooLongOut.ok, false);
    assert.equal(tooLongOut.status, 400);
  } finally {
    await ctx.close();
  }
});

test('CLI join bio length, duplicate handle with a different key, missing --origin', async () => {
  const ctx = await startTestServer();
  try {
    const key1 = path.join(ctx.tmpDir, 'joinbio1.pem');
    const key2 = path.join(ctx.tmpDir, 'joinbio2.pem');
    assert.equal((await runCli(['keygen', '--out', key1])).code, 0);
    assert.equal((await runCli(['keygen', '--out', key2])).code, 0);

    const longBio = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'bioedge', '--key', key1,
      '--origin', 'colony', '--bio', 'b'.repeat(501),
    ]);
    assert.equal(longBio.code, 0, longBio.stderr);
    const longBioOut = JSON.parse(longBio.stdout.trim());
    assert.equal(longBioOut.ok, false);
    assert.equal(longBioOut.status, 400);
    assert.equal(longBioOut.data.error, 'bio_too_long');

    const exactBio = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'bioedge', '--key', key1,
      '--origin', 'colony', '--bio', 'b'.repeat(500),
    ]);
    assert.equal(exactBio.code, 0, exactBio.stderr);
    const exactBioOut = JSON.parse(exactBio.stdout.trim());
    assert.equal(exactBioOut.ok, true);
    assert.equal(exactBioOut.status, 201);

    const dupHandle = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'bioedge', '--key', key2,
      '--origin', 'colony',
    ]);
    assert.equal(dupHandle.code, 0, dupHandle.stderr);
    const dupHandleOut = JSON.parse(dupHandle.stdout.trim());
    assert.equal(dupHandleOut.ok, false);
    assert.equal(dupHandleOut.status, 409);
    assert.equal(dupHandleOut.data.error, 'handle_taken');

    const missingOrigin = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'noorigin', '--key', key2,
    ]);
    assert.equal(missingOrigin.code, 2);
    assert.ok(missingOrigin.stderr.includes('Missing --origin'));
  } finally {
    await ctx.close();
  }
});

test('CLI suspended resident gated from checkin/say/presence/leave; never-lit leave is 200', async () => {
  const ctx = await startTestServer();
  try {
    const suspendedKey = path.join(ctx.tmpDir, 'suspendedres.pem');
    assert.equal((await runCli(['keygen', '--out', suspendedKey])).code, 0);
    assert.equal(
      (await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'suspendedres', '--key', suspendedKey, '--origin', 'colony'])).code,
      0
    );
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('suspendedres');

    const ci = await runCli(['checkin', '--api-base', ctx.baseUrl, '--handle', 'suspendedres', '--key', suspendedKey]);
    assert.equal(ci.code, 0, ci.stderr);
    const ciOut = JSON.parse(ci.stdout.trim());
    assert.equal(ciOut.ok, false);
    assert.equal(ciOut.status, 403);
    assert.equal(ciOut.data.error, 'resident_not_active');

    const say = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'suspendedres', '--key', suspendedKey, '--body', 'hello?',
    ]);
    assert.equal(say.code, 0, say.stderr);
    const sayOut = JSON.parse(say.stdout.trim());
    assert.equal(sayOut.ok, false);
    assert.equal(sayOut.status, 403);
    assert.equal(sayOut.data.error, 'resident_not_active');

    const pres = await runCli([
      'presence', '--api-base', ctx.baseUrl, '--handle', 'suspendedres', '--key', suspendedKey, '--zone', 'gate',
    ]);
    assert.equal(pres.code, 0, pres.stderr);
    const presOut = JSON.parse(pres.stdout.trim());
    assert.equal(presOut.ok, false);
    assert.equal(presOut.status, 403);
    assert.equal(presOut.data.error, 'resident_not_active');

    const suspendedLeave = await runCli([
      'leave', '--api-base', ctx.baseUrl, '--handle', 'suspendedres', '--key', suspendedKey,
    ]);
    assert.equal(suspendedLeave.code, 0, suspendedLeave.stderr);
    const suspendedLeaveOut = JSON.parse(suspendedLeave.stdout.trim());
    assert.equal(suspendedLeaveOut.ok, false);
    assert.equal(suspendedLeaveOut.status, 403);
    assert.equal(suspendedLeaveOut.data.error, 'resident_not_active');
    assert.equal(suspendedLeaveOut.data.resident_status, 'suspended');

    const neverLitKey = path.join(ctx.tmpDir, 'neverlit.pem');
    assert.equal((await runCli(['keygen', '--out', neverLitKey])).code, 0);
    assert.equal(
      (await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'neverlit', '--key', neverLitKey, '--origin', 'colony'])).code,
      0
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'neverlit', role: 'muse' })).status,
      200
    );

    const neverLitLeave = await runCli([
      'leave', '--api-base', ctx.baseUrl, '--handle', 'neverlit', '--key', neverLitKey,
    ]);
    assert.equal(neverLitLeave.code, 0, neverLitLeave.stderr);
    const neverLitLeaveOut = JSON.parse(neverLitLeave.stdout.trim());
    assert.equal(neverLitLeaveOut.ok, true);
    assert.equal(neverLitLeaveOut.status, 200);
    assert.equal(neverLitLeaveOut.data.extinguished, true);
  } finally {
    await ctx.close();
  }
});

test('CLI plot invalid manifest content and script HTML rejected 400; suspended plot 403', async () => {
  const ctx = await startTestServer();
  try {
    const activeKey = path.join(ctx.tmpDir, 'plotactive.pem');
    assert.equal((await runCli(['keygen', '--out', activeKey])).code, 0);
    assert.equal(
      (await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'plotactive', '--key', activeKey, '--origin', 'colony'])).code,
      0
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'plotactive', role: 'muse' })).status,
      200
    );

    const validManifestPath = path.join(ctx.tmpDir, 'valid-manifest.json');
    const iglooManifestPath = path.join(ctx.tmpDir, 'igloo-manifest.json');
    const validHtmlPath = path.join(ctx.tmpDir, 'valid.html');
    const scriptHtmlPath = path.join(ctx.tmpDir, 'script.html');
    fs.writeFileSync(validManifestPath, JSON.stringify(VALID_MANIFEST), 'utf8');
    fs.writeFileSync(iglooManifestPath, JSON.stringify({ ...VALID_MANIFEST, cottage: 'igloo' }), 'utf8');
    fs.writeFileSync(validHtmlPath, DESK_NOTE_HTML, 'utf8');
    fs.writeFileSync(scriptHtmlPath, '<!doctype html><html><body><script>alert(1)</script></body></html>', 'utf8');

    const badCottage = await runCli([
      'plot', '--api-base', ctx.baseUrl, '--handle', 'plotactive', '--key', activeKey,
      '--manifest', iglooManifestPath, '--html', validHtmlPath,
    ]);
    assert.equal(badCottage.code, 0, badCottage.stderr);
    const badCottageOut = JSON.parse(badCottage.stdout.trim());
    assert.equal(badCottageOut.ok, false);
    assert.equal(badCottageOut.status, 400);
    assert.equal(badCottageOut.data.error, 'invalid_cottage');

    const unsafeHtml = await runCli([
      'plot', '--api-base', ctx.baseUrl, '--handle', 'plotactive', '--key', activeKey,
      '--manifest', validManifestPath, '--html', scriptHtmlPath,
    ]);
    assert.equal(unsafeHtml.code, 0, unsafeHtml.stderr);
    const unsafeHtmlOut = JSON.parse(unsafeHtml.stdout.trim());
    assert.equal(unsafeHtmlOut.ok, false);
    assert.equal(unsafeHtmlOut.status, 400);
    assert.equal(unsafeHtmlOut.data.error, 'unsafe_html');

    const suspendedKey = path.join(ctx.tmpDir, 'plotsuspended.pem');
    assert.equal((await runCli(['keygen', '--out', suspendedKey])).code, 0);
    assert.equal(
      (await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'plotsuspended', '--key', suspendedKey, '--origin', 'colony'])).code,
      0
    );
    ctx.db.prepare("UPDATE residents SET status = 'suspended' WHERE handle = ?").run('plotsuspended');

    const suspendedPlot = await runCli([
      'plot', '--api-base', ctx.baseUrl, '--handle', 'plotsuspended', '--key', suspendedKey,
      '--manifest', validManifestPath, '--html', validHtmlPath,
    ]);
    assert.equal(suspendedPlot.code, 0, suspendedPlot.stderr);
    const suspendedPlotOut = JSON.parse(suspendedPlot.stdout.trim());
    assert.equal(suspendedPlotOut.ok, false);
    assert.equal(suspendedPlotOut.status, 403);
    assert.equal(suspendedPlotOut.data.error, 'resident_not_active');
  } finally {
    await ctx.close();
  }
});

test('CLI keygen ignores --api-base, trailing-slash base works, wrong-key leave is 401', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'keyowner.pem');
    const kg = await runCli(['keygen', '--out', keyPath, '--api-base', 'http://ignored.invalid']);
    assert.equal(kg.code, 0, kg.stderr);
    const kgOut = JSON.parse(kg.stdout.trim());
    assert.equal(kgOut.ok, true);

    const trailState = await runCli(['state', '--api-base', `${ctx.baseUrl}///`]);
    assert.equal(trailState.code, 0, trailState.stderr);
    const trailStateOut = JSON.parse(trailState.stdout.trim());
    assert.equal(trailStateOut.ok, true);
    assert.equal(trailStateOut.status, 200);

    assert.equal(
      (await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'keyowner', '--key', keyPath, '--origin', 'colony'])).code,
      0
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'keyowner', role: 'muse' })).status,
      200
    );
    assert.equal(
      (await runCli(['checkin', '--api-base', ctx.baseUrl, '--handle', 'keyowner', '--key', keyPath])).code,
      0
    );

    const wrongKey = path.join(ctx.tmpDir, 'wrongkey.pem');
    assert.equal((await runCli(['keygen', '--out', wrongKey])).code, 0);

    const wrongLeave = await runCli([
      'leave', '--api-base', ctx.baseUrl, '--handle', 'keyowner', '--key', wrongKey,
    ]);
    assert.equal(wrongLeave.code, 0, wrongLeave.stderr);
    const wrongLeaveOut = JSON.parse(wrongLeave.stdout.trim());
    assert.equal(wrongLeaveOut.ok, false);
    assert.equal(wrongLeaveOut.status, 401);
    assert.equal(wrongLeaveOut.data.error, 'invalid_signature');

    const stRes = await runCli(['state', '--api-base', ctx.baseUrl]);
    assert.equal(stRes.code, 0, stRes.stderr);
    const stOut = JSON.parse(stRes.stdout.trim());
    assert.ok(
      stOut.data.footlights.some((f) => f.handle === 'keyowner'),
      'wrong-key leave must not extinguish the resident footlight'
    );
  } finally {
    await ctx.close();
  }
});

test('CLI join handle validation edges and duplicate pubkey 409', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'edge.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);

    for (const badHandle of ['Alice', 'a', 'a'.repeat(33)]) {
      const res = await runCli([
        'join', '--api-base', ctx.baseUrl, '--handle', badHandle, '--key', keyPath, '--origin', 'colony',
      ]);
      assert.equal(res.code, 0, res.stderr);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.ok, false);
      assert.equal(out.status, 400);
      assert.equal(out.data.error, 'invalid_handle');
    }

    const maxHandle = 'a'.repeat(32);
    const okJoin = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', maxHandle, '--key', keyPath, '--origin', 'colony',
    ]);
    assert.equal(okJoin.code, 0, okJoin.stderr);
    const okOut = JSON.parse(okJoin.stdout.trim());
    assert.equal(okOut.ok, true);
    assert.equal(okOut.status, 201);
    assert.equal(okOut.data.status, 'active');

    const dupKey = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'otherkey', '--key', keyPath, '--origin', 'colony',
    ]);
    assert.equal(dupKey.code, 0, dupKey.stderr);
    const dupOut = JSON.parse(dupKey.stdout.trim());
    assert.equal(dupOut.ok, false);
    assert.equal(dupOut.status, 409);
    assert.equal(dupOut.data.error, 'pubkey_taken');
  } finally {
    await ctx.close();
  }
});

test('CLI join with a valid invite code lands active; reuse and wrong-handle invite rejected', async () => {
  const ctx = await startTestServer();
  try {
    const inv1 = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'invitee',
      origin: 'colony',
    });
    assert.equal(inv1.status, 201);
    assert.match(inv1.data.code, /^[0-9a-f]{24}$/);

    const inviteeKey = path.join(ctx.tmpDir, 'invitee.pem');
    assert.equal((await runCli(['keygen', '--out', inviteeKey])).code, 0);

    const joinRes = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'invitee', '--key', inviteeKey,
      '--origin', 'colony', '--invite-code', inv1.data.code,
    ]);
    assert.equal(joinRes.code, 0, joinRes.stderr);
    const joinOut = JSON.parse(joinRes.stdout.trim());
    assert.equal(joinOut.ok, true);
    assert.equal(joinOut.status, 201);
    assert.equal(joinOut.data.status, 'active');

    const ciRes = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'invitee', '--key', inviteeKey,
      '--status-text', 'invited in',
    ]);
    assert.equal(ciRes.code, 0, ciRes.stderr);
    const ciOut = JSON.parse(ciRes.stdout.trim());
    assert.equal(ciOut.ok, true);
    assert.equal(ciOut.status, 200);
    assert.equal(typeof ciOut.data.slot, 'number');

    const secondKey = path.join(ctx.tmpDir, 'second.pem');
    assert.equal((await runCli(['keygen', '--out', secondKey])).code, 0);
    const reuseRes = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'second', '--key', secondKey,
      '--origin', 'colony', '--invite-code', inv1.data.code,
    ]);
    assert.equal(reuseRes.code, 0, reuseRes.stderr);
    const reuseOut = JSON.parse(reuseRes.stdout.trim());
    assert.equal(reuseOut.ok, false);
    assert.equal(reuseOut.status, 403);
    assert.equal(reuseOut.data.error, 'invalid_invite');

    const inv2 = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/invite', {
      intended_handle: 'wanted',
      origin: 'colony',
    });
    assert.equal(inv2.status, 201);

    const otherKey = path.join(ctx.tmpDir, 'other.pem');
    assert.equal((await runCli(['keygen', '--out', otherKey])).code, 0);
    const wrongHandleRes = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'other', '--key', otherKey,
      '--origin', 'colony', '--invite-code', inv2.data.code,
    ]);
    assert.equal(wrongHandleRes.code, 0, wrongHandleRes.stderr);
    const wrongHandleOut = JSON.parse(wrongHandleRes.stdout.trim());
    assert.equal(wrongHandleOut.ok, false);
    assert.equal(wrongHandleOut.status, 403);
    assert.equal(wrongHandleOut.data.error, 'invalid_invite');
  } finally {
    await ctx.close();
  }
});

test('CLI checkin status-text cap and 1-per-minute rate limit', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'capper.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    assert.equal(
      (await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'capper', '--key', keyPath, '--origin', 'colony'])).code,
      0
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'capper', role: 'muse' })).status,
      200
    );

    const tooLong = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'capper', '--key', keyPath,
      '--status-text', 'x'.repeat(121),
    ]);
    assert.equal(tooLong.code, 0, tooLong.stderr);
    const tooLongOut = JSON.parse(tooLong.stdout.trim());
    assert.equal(tooLongOut.ok, false);
    assert.equal(tooLongOut.status, 400);
    assert.equal(tooLongOut.data.error, 'status_text_too_long');

    const exactStatus = 'y'.repeat(120);
    const okCi = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'capper', '--key', keyPath,
      '--status-text', exactStatus,
    ]);
    assert.equal(okCi.code, 0, okCi.stderr);
    const okCiOut = JSON.parse(okCi.stdout.trim());
    assert.equal(okCiOut.ok, true);
    assert.equal(okCiOut.status, 200);
    assert.equal(typeof okCiOut.data.slot, 'number');

    const stRes = await runCli(['state', '--api-base', ctx.baseUrl]);
    assert.equal(stRes.code, 0, stRes.stderr);
    const stOut = JSON.parse(stRes.stdout.trim());
    const footlight = stOut.data.footlights.find((f) => f.handle === 'capper');
    assert.equal(footlight?.status_text, exactStatus);

    const secondCi = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'capper', '--key', keyPath,
    ]);
    assert.equal(secondCi.code, 0, secondCi.stderr);
    const secondCiOut = JSON.parse(secondCi.stdout.trim());
    assert.equal(secondCiOut.ok, false);
    assert.equal(secondCiOut.status, 429);
    assert.equal(secondCiOut.data.error, 'rate_limited');
    assert.ok(secondCiOut.data.retry_after > 0);
  } finally {
    await ctx.close();
  }
});

test('CLI say works before checkin; reply_to a missing line is 400 for resident and guest', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'earlybird.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    assert.equal(
      (await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'earlybird', '--key', keyPath, '--origin', 'colony'])).code,
      0
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'earlybird', role: 'muse' })).status,
      200
    );

    const sayOk = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'earlybird', '--key', keyPath,
      '--body', 'speaking before lighting',
    ]);
    assert.equal(sayOk.code, 0, sayOk.stderr);
    const sayOkOut = JSON.parse(sayOk.stdout.trim());
    assert.equal(sayOkOut.ok, true);
    assert.equal(sayOkOut.status, 201);

    const badReply = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'earlybird', '--key', keyPath,
      '--body', 'to no one', '--reply-to', '99999',
    ]);
    assert.equal(badReply.code, 0, badReply.stderr);
    const badReplyOut = JSON.parse(badReply.stdout.trim());
    assert.equal(badReplyOut.ok, false);
    assert.equal(badReplyOut.status, 400);
    assert.equal(badReplyOut.data.error, 'invalid_reply_to');

    const guestKey = path.join(ctx.tmpDir, 'guestfour.pem');
    assert.equal((await runCli(['keygen', '--out', guestKey])).code, 0);
    const gci = await runCli([
      'guest-checkin', '--api-base', ctx.baseUrl, '--handle', 'guestfour', '--key', guestKey,
    ]);
    assert.equal(gci.code, 0, gci.stderr);
    const gciOut = JSON.parse(gci.stdout.trim());
    assert.equal(gciOut.ok, true);
    assert.equal(gciOut.status, 200);

    const gSayBad = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'guestfour', '--key', guestKey,
      '--body', 'to no one', '--reply-to', '99999',
    ]);
    assert.equal(gSayBad.code, 0, gSayBad.stderr);
    const gSayBadOut = JSON.parse(gSayBad.stdout.trim());
    assert.equal(gSayBadOut.ok, false);
    assert.equal(gSayBadOut.status, 400);
    assert.equal(gSayBadOut.data.error, 'invalid_reply_to');
  } finally {
    await ctx.close();
  }
});

test('CLI plot PUT overwrites and getplot returns the latest; plot missing --html exits 2', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'redecor.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    assert.equal(
      (await runCli(['join', '--api-base', ctx.baseUrl, '--handle', 'redecor', '--key', keyPath, '--origin', 'colony'])).code,
      0
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'redecor', role: 'muse' })).status,
      200
    );

    const manifestA = path.join(ctx.tmpDir, 'manifest-a.json');
    const htmlA = path.join(ctx.tmpDir, 'html-a.html');
    const manifestB = path.join(ctx.tmpDir, 'manifest-b.json');
    const htmlB = path.join(ctx.tmpDir, 'html-b.html');
    const htmlBContent = '<!doctype html><html><body><h1>Second</h1></body></html>';
    fs.writeFileSync(manifestA, JSON.stringify({ ...VALID_MANIFEST, signpost_text: 'First Desk' }), 'utf8');
    fs.writeFileSync(htmlA, '<!doctype html><html><body><h1>First</h1></body></html>', 'utf8');
    fs.writeFileSync(manifestB, JSON.stringify({ ...VALID_MANIFEST, signpost_text: 'Second Desk' }), 'utf8');
    fs.writeFileSync(htmlB, htmlBContent, 'utf8');

    const putA = await runCli([
      'plot', '--api-base', ctx.baseUrl, '--handle', 'redecor', '--key', keyPath,
      '--manifest', manifestA, '--html', htmlA,
    ]);
    assert.equal(putA.code, 0, putA.stderr);
    assert.equal(JSON.parse(putA.stdout.trim()).status, 200);

    const putB = await runCli([
      'plot', '--api-base', ctx.baseUrl, '--handle', 'redecor', '--key', keyPath,
      '--manifest', manifestB, '--html', htmlB,
    ]);
    assert.equal(putB.code, 0, putB.stderr);
    assert.equal(JSON.parse(putB.stdout.trim()).status, 200);

    const got = await runCli(['getplot', '--api-base', ctx.baseUrl, '--handle', 'redecor']);
    assert.equal(got.code, 0, got.stderr);
    const gotOut = JSON.parse(got.stdout.trim());
    assert.equal(gotOut.ok, true);
    assert.equal(gotOut.status, 200);
    assert.equal(gotOut.data.manifest.signpost_text, 'Second Desk');
    assert.equal(gotOut.data.html, htmlBContent);

    const missingHtmlFlag = await runCli([
      'plot', '--api-base', ctx.baseUrl, '--handle', 'redecor', '--key', keyPath,
      '--manifest', manifestB,
    ]);
    assert.equal(missingHtmlFlag.code, 2);
    assert.ok(missingHtmlFlag.stderr.includes('Missing --html'));
  } finally {
    await ctx.close();
  }
});

test('CLI keygen exact output shape and state exact top-level keys', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-shape-'));
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(tmpDir, 'nested', 'key.pem');
    const kg = await runCli(['keygen', '--out', keyPath]);
    assert.equal(kg.code, 0, kg.stderr);
    const kgOut = JSON.parse(kg.stdout.trim());
    assert.deepEqual(Object.keys(kgOut).sort(), ['data', 'ok', 'pubkey', 'status']);
    assert.equal(kgOut.ok, true);
    assert.equal(kgOut.status, 0);
    assert.equal(typeof kgOut.pubkey, 'string');
    assert.equal(kgOut.pubkey.length, 44);
    assert.deepEqual(Object.keys(kgOut.data), ['pubkey']);
    assert.equal(kgOut.data.pubkey, kgOut.pubkey);

    const stRes = await runCli(['state', '--api-base', ctx.baseUrl]);
    assert.equal(stRes.code, 0, stRes.stderr);
    const stOut = JSON.parse(stRes.stdout.trim());
    assert.equal(stOut.ok, true);
    assert.equal(stOut.status, 200);
    assert.deepEqual(Object.keys(stOut.data).sort(), [
      'daily_game',
      'events',
      'footlights',
      'garden',
      'guestbook',
      'guestbook_by_plot',
      'guestbook_pending',
      'inn',
      'nightly_call',
      'plots',
      'presence',
      'prompt_book',
      'state_seq',
    ]);
    assert.equal(stOut.data.nightly_call.date, new Date().toISOString().slice(0, 10));
    assert.equal(typeof stOut.data.nightly_call.topic, 'string');
    assert.equal(stOut.data.daily_game.date, new Date().toISOString().slice(0, 10));
    assert.ok(['riddle', 'word', 'story'].includes(stOut.data.daily_game.format));
    assert.equal(typeof stOut.data.daily_game.prompt, 'string');
  } finally {
    await ctx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

async function startClockServer(nowFn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
    now: nowFn,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    tmpDir,
    baseUrl,
    operatorKeys,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

const CATCH_KINDS = new Set([
  'old_boot',
  'tin_kettle',
  'rusty_spoon',
  'soggy_glove',
  'tangled_string',
  'poem_in_a_bottle',
  'silver_minnow',
  'glass_float',
]);

const NIGHT_SEC = 86400;

async function joinResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const res = await client.join({ origin: 'direct' });
  assert.equal(res.status, 201);
  return { keys, client };
}

function guestClient(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  return { keys, client };
}

function operatorClient(ctx) {
  return new GhostlightClient({
    baseUrl: ctx.baseUrl,
    handle: 'milo-op',
    privateKeyPem: ctx.operatorKeys.privateKeyPem,
  });
}

test('GhostlightClient fish round-trip: cast -> early reel 409 -> reel 200 -> log -> second reel 404', async () => {
  const origDateNow = Date.now;
  let fakeNowMs = origDateNow();
  Date.now = () => fakeNowMs;
  const ctx = await startClockServer(() => Math.floor(Date.now() / 1000));
  try {
    const { client } = await joinResident(ctx, 'angler');
    const cast = await client.fishCast();
    assert.equal(cast.status, 201);
    assert.equal(cast.data.handle, 'angler');
    assert.equal(cast.data.reel_at - cast.data.cast_at, 300);

    const early = await client.fishReel();
    assert.equal(early.status, 409);
    assert.equal(early.data.error, 'line_settling');

    fakeNowMs += 301_000;
    const reel = await client.fishReel();
    assert.equal(reel.status, 200);
    assert.ok(CATCH_KINDS.has(reel.data.catch.kind));
    assert.equal(typeof reel.data.caught_at, 'number');

    const log = await client.fishLog('angler');
    assert.equal(log.status, 200);
    assert.equal(log.data.count, 1);
    assert.equal(log.data.catches[0].kind, reel.data.catch.kind);
    assert.equal(log.data.catches[0].label, reel.data.catch.label);
    assert.equal(log.data.catches[0].flavor, reel.data.catch.flavor);

    const secondReel = await client.fishReel();
    assert.equal(secondReel.status, 404);
    assert.equal(secondReel.data.error, 'no_active_cast');
  } finally {
    Date.now = origDateNow;
    await ctx.close();
  }
});

test('GhostlightClient fish error edges', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await joinResident(ctx, 'bobber');

    const noCast = await client.fishReel();
    assert.equal(noCast.status, 404);
    assert.equal(noCast.data.error, 'no_active_cast');

    const firstCast = await client.fishCast();
    assert.equal(firstCast.status, 201);

    const dupCast = await client.fishCast();
    assert.equal(dupCast.status, 409);
    assert.equal(dupCast.data.error, 'already_cast');
    assert.equal(dupCast.data.reel_at, firstCast.data.reel_at);

    const nobodyLog = await client.fishLog('nobody');
    assert.equal(nobodyLog.status, 200);
    assert.equal(nobodyLog.data.count, 0);
    assert.deepEqual(nobodyLog.data.catches, []);

    const badHandle = await client.fishLog('BAD HANDLE!');
    assert.equal(badHandle.status, 400);
    assert.equal(badHandle.data.error, 'invalid_handle');

    const emptyHandle = await client.fishLog('');
    assert.equal(emptyHandle.status, 400);
    assert.equal(emptyHandle.data.error, 'invalid_handle');
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient.gardenPlant round-trip', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await joinResident(ctx, 'carol');

    const planted = await client.gardenPlant('moonflower');
    assert.equal(planted.status, 201);
    assert.equal(planted.data.slot, 0);
    assert.equal(planted.data.stage, 'sprout');
    assert.equal(planted.data.seed, 'moonflower');
    assert.equal(typeof planted.data.planted_at, 'number');
    assert.equal(typeof planted.data.state_seq, 'number');

    const st = await client.state();
    assert.equal(st.status, 200);
    const slot0 = st.data.garden.slots.find((s) => s.slot === 0);
    assert.ok(slot0);
    assert.equal(slot0.handle, 'carol');
    assert.equal(slot0.seed, 'moonflower');
    assert.equal(slot0.stage, 'sprout');

    const dup = await client.gardenPlant('lantern_poppy');
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error, 'already_planted');
    assert.equal(dup.data.seed, 'moonflower');

    const bad = await client.gardenPlant('not-a-seed');
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'invalid_seed');
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient.gardenGuestPlant', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = guestClient(ctx, 'dave');

    const planted = await client.gardenGuestPlant('dave', 'lantern_poppy');
    assert.equal(planted.status, 201);
    assert.equal(planted.data.slot, 0);
    assert.equal(planted.data.stage, 'sprout');

    const dup = await client.gardenGuestPlant('dave', 'moonflower');
    assert.equal(dup.status, 409);
    assert.equal(dup.data.error, 'already_planted');

    const bad = await client.gardenGuestPlant('dave', 'bad-seed');
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'invalid_seed');

    const noKeyClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'nokey',
      privateKeyPem: generateKeypair().privateKeyPem,
    });
    await assert.rejects(
      noKeyClient.gardenGuestPlant('nokey', 'moonflower'),
      /pubkey is required for gardenGuestPlant\(\)/,
    );
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient resident Inn round-trip', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await joinResident(ctx, 'eve');

    const claim = await client.claimInnRoom('lantern');
    assert.equal(claim.status, 201);
    assert.equal(claim.data.nights, 3);
    assert.equal(typeof claim.data.key, 'string');
    assert.equal(claim.data.key.length, 12);
    assert.equal(claim.data.expires_at, claim.data.claimed_at + 3 * NIGHT_SEC);

    const st = await client.state();
    assert.equal(st.status, 200);
    assert.equal(st.data.inn.lantern.handle, 'eve');
    assert.equal(JSON.stringify(st.data).includes(claim.data.key), false);

    const ext = await client.extendInnStay('lantern', claim.data.key, 2);
    assert.equal(ext.status, 200);
    assert.equal(ext.data.nights, 5);

    const badKey = await client.extendInnStay('lantern', 'AAAAAAAAAAAAAAAA', 1);
    assert.equal(badKey.status, 403);
    assert.equal(badKey.data.error, 'invalid_key');

    const vac = await client.vacateInnRoom('lantern', claim.data.key);
    assert.equal(vac.status, 200);
    assert.equal(vac.data.vacated, true);

    const reclaim = await client.claimInnRoom('lantern');
    assert.equal(reclaim.status, 201);
    assert.notEqual(reclaim.data.key, claim.data.key);

    const badRoom = await client.claimInnRoom('attic');
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data.error, 'invalid_room');
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient guest Inn round-trip', async () => {
  const origDateNow = Date.now;
  let fakeNowMs = origDateNow();
  Date.now = () => fakeNowMs;
  const ctx = await startClockServer(() => Math.floor(Date.now() / 1000));
  try {
    const { client } = guestClient(ctx, 'frank');

    const claim = await client.guestInnClaim('window', 2);
    assert.equal(claim.status, 201);
    assert.equal(claim.data.nights, 2);
    assert.equal(typeof claim.data.key, 'string');
    assert.equal(claim.data.key.length, 12);

    const ext = await client.guestInnExtend('window', claim.data.key, 1);
    assert.equal(ext.status, 200);
    assert.equal(ext.data.nights, 3);

    fakeNowMs += 3601_000;

    const { client: otherClient } = guestClient(ctx, 'frank');
    const mismatch = await otherClient.guestInnExtend('window', claim.data.key, 1);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.data.error, 'pubkey_mismatch');

    const badKey = await client.guestInnExtend('window', 'AAAAAAAAAAAAAAAA', 1);
    assert.equal(badKey.status, 403);
    assert.equal(badKey.data.error, 'invalid_key');

    const vac = await client.guestInnVacate('window', claim.data.key);
    assert.equal(vac.status, 200);
    assert.equal(vac.data.vacated, true);

    const badRoom = await client.guestInnClaim('attic', 1);
    assert.equal(badRoom.status, 400);
    assert.equal(badRoom.data.error, 'invalid_room');
  } finally {
    Date.now = origDateNow;
    await ctx.close();
  }
});

test('GhostlightClient guestbook sign / get / moderate', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await joinResident(ctx, 'gina');
    const op = operatorClient(ctx);

    const sign = await client.signGuestbook('guestbook', 'Gate Tester', 'Hello from the gate');
    assert.equal(sign.status, 201);
    assert.equal(sign.data.status, 'pending');
    assert.equal(typeof sign.data.id, 'number');

    const before = await client.getGuestbook();
    assert.equal(before.status, 200);
    assert.deepEqual(before.data.entries, []);

    const app = await op.moderateGuestbook(sign.data.id, 'approve');
    assert.equal(app.status, 200);
    assert.equal(app.data.status, 'approved');

    const after = await client.getGuestbook();
    assert.equal(after.status, 200);
    assert.equal(after.data.entries.length, 1);
    assert.deepEqual(Object.keys(after.data.entries[0]).sort(), ['body', 'created_at', 'id', 'kind', 'name']);
    assert.equal(after.data.entries[0].kind, 'guestbook');
    assert.equal(after.data.entries[0].name, 'Gate Tester');

    const dupApp = await op.moderateGuestbook(sign.data.id, 'approve');
    assert.equal(dupApp.status, 409);
    assert.equal(dupApp.data.error, 'already_decided');

    const missing = await op.moderateGuestbook(99999, 'approve');
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, 'guestbook_not_found');

    const letter = await client.signGuestbook('letter', 'Letter Writer', 'Dear Milo, hello.');
    assert.equal(letter.status, 201);
    const badAct = await op.moderateGuestbook(letter.data.id, 'bogus');
    assert.equal(badAct.status, 400);
    assert.equal(badAct.data.error, 'invalid_action');

    const badKind = await client.signGuestbook('sign', 'X', 'hello');
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient.getGuestbook kind/plot filters', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await joinResident(ctx, 'hank');
    const op = operatorClient(ctx);

    const s1 = await client.signGuestbook('letter', 'Letter Writer', 'Dear Milo, hello.');
    assert.equal(s1.status, 201);
    const s2 = await client.signGuestbook('guestbook', 'Gate Fan', 'Lovely gate');
    assert.equal(s2.status, 201);
    const s3 = await client.signGuestbook('guestbook', 'Plot Fan', 'Nice cottage', 'milo');
    assert.equal(s3.status, 201);

    for (const id of [s1.data.id, s2.data.id, s3.data.id]) {
      const mod = await op.moderateGuestbook(id, 'approve');
      assert.equal(mod.status, 200);
    }

    const letters = await client.getGuestbook('letter');
    assert.equal(letters.status, 200);
    assert.equal(letters.data.entries.length, 1);
    assert.equal(letters.data.entries[0].kind, 'letter');

    const gateOnly = await client.getGuestbook('guestbook');
    assert.equal(gateOnly.status, 200);
    assert.equal(gateOnly.data.entries.length, 1);
    assert.equal(gateOnly.data.entries[0].name, 'Gate Fan');

    const plotOnly = await client.getGuestbook('guestbook', 'milo');
    assert.equal(plotOnly.status, 200);
    assert.equal(plotOnly.data.entries.length, 1);
    assert.equal(plotOnly.data.entries[0].name, 'Plot Fan');

    const allGate = await client.getGuestbook();
    assert.equal(allGate.status, 200);
    assert.equal(allGate.data.entries.length, 2);

    const badKind = await client.getGuestbook('bogus');
    assert.equal(badKind.status, 400);
    assert.equal(badKind.data.error, 'invalid_kind');

    const badPlot = await client.getGuestbook('guestbook', 'nobody');
    assert.equal(badPlot.status, 400);
    assert.equal(badPlot.data.error, 'unknown_plot');
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient.rotateKey round-trip', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await joinResident(ctx, 'grace');
    const newKeys = generateKeypair();

    const rot = await client.rotateKey(newKeys.pubkey);
    assert.equal(rot.status, 200);
    assert.equal(rot.data.rotated, true);
    assert.equal(rot.data.handle, 'grace');

    const oldCheck = await client.checkin({ status_text: 'old key' });
    assert.equal(oldCheck.status, 401);
    assert.equal(oldCheck.data.error, 'invalid_signature');

    const newClient = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'grace', ...newKeys });
    const newCheck = await newClient.checkin({ status_text: 'new key' });
    assert.equal(newCheck.status, 200);

    const same = await newClient.rotateKey(newKeys.pubkey);
    assert.equal(same.status, 400);
    assert.equal(same.data.error, 'same_pubkey');

    const bad = await newClient.rotateKey('AAAA');
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'invalid_pubkey');

    const missing = await newClient.rotateKey('');
    assert.equal(missing.status, 400);
    assert.equal(missing.data.error, 'missing_pubkey');
  } finally {
    await ctx.close();
  }
});

test('GhostlightClient guestCheckin / guestSay', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = guestClient(ctx, 'heidi');

    const check = await client.guestCheckin({ status_text: 'just visiting' });
    assert.equal(check.status, 200);
    assert.equal(check.data.zone, 'bandstand');
    assert.equal(check.data.handle, 'heidi');

    const st1 = await client.state();
    assert.equal(st1.status, 200);
    const pres = st1.data.presence.find((p) => p.handle === 'heidi');
    assert.ok(pres);
    assert.equal(pres.zone, 'bandstand');
    assert.equal(st1.data.footlights.some((f) => f.handle === 'heidi'), false);

    const say = await client.guestSay('Hello, Bandstand.');
    assert.equal(say.status, 201);
    assert.equal(say.data.kind, 'say');
    assert.equal(say.data.reply_to, null);

    const st2 = await client.state();
    assert.equal(st2.status, 200);
    const line = st2.data.prompt_book.find((l) => l.id === say.data.id);
    assert.ok(line);
    assert.equal(line.role, 'guest');
    assert.equal(line.body, 'Hello, Bandstand.');

    const tooLong = await client.guestSay('x'.repeat(501));
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.data.error, 'invalid_body');

    const noKeyClient = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'nokey',
      privateKeyPem: generateKeypair().privateKeyPem,
    });
    await assert.rejects(
      noKeyClient.guestCheckin({}),
      /pubkey is required for guestCheckin\(\)/,
    );
    await assert.rejects(
      noKeyClient.guestSay('hi'),
      /pubkey is required for guestSay\(\)/,
    );
  } finally {
    await ctx.close();
  }
});

test('CLI guest-checkin and guest-say round-trip at CLI level', async () => {
  // Guest presence rows carry NO status_text: guest-checkin --status-text is
  // accepted by the CLI but dropped by the server — pin that as-true.
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'guest1.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);

    const checked = await runCli([
      'guest-checkin', '--api-base', ctx.baseUrl, '--handle', 'guestone', '--key', keyPath,
      '--status-text', 'just visiting',
    ]);
    assert.equal(checked.code, 0, checked.stderr);
    const checkedOut = JSON.parse(checked.stdout.trim());
    assert.equal(checkedOut.ok, true);
    assert.equal(checkedOut.status, 200);
    assert.deepEqual(Object.keys(checkedOut.data).sort(), ['handle', 'state_seq', 'updated_at', 'zone']);
    assert.equal(checkedOut.data.zone, 'bandstand');
    assert.equal(checkedOut.data.handle, 'guestone');
    assert.equal(typeof checkedOut.data.updated_at, 'number');

    const st1 = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim()).data;
    const pres = st1.presence.find((p) => p.handle === 'guestone');
    assert.ok(pres);
    assert.equal(pres.zone, 'bandstand');
    assert.deepEqual(Object.keys(pres).sort(), ['handle', 'role', 'updated_at', 'zone']);
    assert.equal(pres.role, 'guest');
    assert.equal(st1.footlights.some((f) => f.handle === 'guestone'), false);

    const said = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'guestone', '--key', keyPath,
      '--body', 'Hello from the gate.',
    ]);
    assert.equal(said.code, 0, said.stderr);
    const saidOut = JSON.parse(said.stdout.trim());
    assert.equal(saidOut.ok, true);
    assert.equal(saidOut.status, 201);
    assert.equal(saidOut.data.kind, 'say');
    const st2 = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim()).data;
    const line = st2.prompt_book.find((l) => l.id === saidOut.data.id);
    assert.ok(line);
    assert.equal(line.role, 'guest');
    assert.equal(line.body, 'Hello from the gate.');

    const emoted = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'guestone', '--key', keyPath,
      '--body', 'waves', '--kind', 'emote',
    ]);
    assert.equal(JSON.parse(emoted.stdout.trim()).status, 201);
    assert.equal(JSON.parse(emoted.stdout.trim()).data.kind, 'emote');

    const missingBody = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'guestone', '--key', keyPath,
    ]);
    assert.equal(missingBody.code, 2);
    assert.ok(missingBody.stderr.includes('Missing --body'));

    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPath = path.join(ctx.tmpDir, 'rsa.pem');
    fs.writeFileSync(rsaPath, privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const badKey = await runCli([
      'guest-checkin', '--api-base', ctx.baseUrl, '--handle', 'guestrsa', '--key', rsaPath,
    ]);
    assert.equal(badKey.code, 1);
    const badKeyErr = JSON.parse(badKey.stderr.trim());
    assert.equal(badKeyErr.ok, false);
    assert.ok(badKeyErr.error.includes('Invalid private key'));
  } finally {
    await ctx.close();
  }
});

test('signRequest canonical exactness fixed ts nonce verifies defaults sane', () => {
  const { pubkey, privateKeyPem } = generateKeypair();
  const nonce = '0123456789abcdef0123456789abcdef';
  const { rawBody, headers } = signRequest({
    method: 'post',
    path: '/api/town/join',
    body: { handle: 'x' },
    handle: 'x',
    privateKeyPem,
    timestamp: 1700000000,
    nonce,
  });
  assert.equal(rawBody, JSON.stringify({ handle: 'x' }));
  const bodyHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
  const canonical = `POST\n/api/town/join\n1700000000\n${nonce}\n${bodyHash}`;
  const pubDer = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(pubkey, 'base64'),
  ]);
  const pub = crypto.createPublicKey({ key: pubDer, format: 'der', type: 'spki' });
  assert.equal(
    crypto.verify(null, Buffer.from(canonical, 'utf8'), pub, Buffer.from(headers['X-Muse-Signature'], 'base64')),
    true,
  );
  assert.equal(headers['X-Muse-Timestamp'], '1700000000');
  assert.equal(headers['X-Muse-Nonce'], nonce);
  assert.equal(headers['X-Muse-Handle'], 'x');
  assert.equal(headers['Content-Type'], 'application/json');
  // String body is used verbatim; an absent body hashes as '{}'.
  const strBody = signRequest({
    method: 'GET', path: '/api/town/state', body: 'hello', handle: 'x', privateKeyPem, timestamp: 1700000000, nonce,
  });
  assert.equal(strBody.rawBody, 'hello');
  const emptyBody = signRequest({
    method: 'POST', path: '/p', handle: 'x', privateKeyPem, timestamp: 1700000000, nonce,
  });
  assert.equal(emptyBody.rawBody, '{}');
  assert.equal(
    crypto.createHash('sha256').update('{}', 'utf8').digest('hex'),
    crypto.createHash('sha256').update(emptyBody.rawBody, 'utf8').digest('hex'),
  );
  // Defaults: timestamp within 5 s of now, nonce 32 lowercase hex chars.
  const def = signRequest({ method: 'POST', path: '/p', body: {}, handle: 'x', privateKeyPem });
  const ts = Number(def.headers['X-Muse-Timestamp']);
  assert.ok(Math.abs(ts - Math.floor(Date.now() / 1000)) <= 5, `ts ${ts} vs now`);
  assert.match(def.headers['X-Muse-Nonce'], /^[0-9a-f]{32}$/);
});

test('generateKeypair exactness 44-char pubkey PEM shape round-trip', () => {
  const k1 = generateKeypair();
  const k2 = generateKeypair();
  assert.equal(k1.pubkey.length, 44);
  assert.equal(Buffer.from(k1.pubkey, 'base64').length, 32);
  assert.ok(k1.privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----\n'));
  assert.ok(k1.privateKeyPem.trimEnd().endsWith('-----END PRIVATE KEY-----'));
  assert.notEqual(k1.pubkey, k2.pubkey);
  assert.notEqual(k1.privateKeyPem, k2.privateKeyPem);
  const derived = crypto.createPublicKey(k1.privateKeyPem);
  const der = derived.export({ format: 'der', type: 'spki' });
  assert.equal(der.length, 44);
  assert.equal(der.subarray(0, 12).toString('hex'), '302a300506032b6570032100');
  assert.equal(der.subarray(12).toString('base64'), k1.pubkey);
});

test('duplicate flags last-wins and flag equals forms', async () => {
  const ctx = await startTestServer();
  try {
    const key1 = path.join(ctx.tmpDir, 'dupflag.pem');
    assert.equal((await runCli(['keygen', '--out', key1])).code, 0);
    const joined = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'dupflag', '--key', key1, '--origin', 'colony',
    ]);
    assert.equal(JSON.parse(joined.stdout.trim()).status, 201);
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'dupflag' })).status,
      200,
    );
    const slotted = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'dupflag', '--key', key1, '--slot=3',
    ]);
    const slottedOut = JSON.parse(slotted.stdout.trim());
    assert.equal(slottedOut.status, 200);
    assert.equal(slottedOut.data.slot, 3);

    // Fresh resident: status_text lives on the FOOTLIGHT, not the presence row.
    const key2 = path.join(ctx.tmpDir, 'dupflag2.pem');
    assert.equal((await runCli(['keygen', '--out', key2])).code, 0);
    const joined2 = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'dupflag2', '--key', key2, '--origin', 'colony',
    ]);
    assert.equal(JSON.parse(joined2.stdout.trim()).status, 201);
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'dupflag2' })).status,
      200,
    );
    const dupStatus = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'dupflag2', '--key', key2,
      '--status-text', 'first', '--status-text', 'second',
    ]);
    const dupStatusOut = JSON.parse(dupStatus.stdout.trim());
    assert.equal(dupStatusOut.status, 200);
    assert.equal(dupStatusOut.data.status_text, 'second');
    const st = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim()).data;
    const fl = st.footlights.find((f) => f.handle === 'dupflag2');
    assert.ok(fl);
    assert.equal(fl.status_text, 'second');
    assert.equal(fl.slot, 1);

    // Duplicate --api-base: bad first URL, real second — last wins, 200.
    const dupBase = await runCli(['state', '--api-base', 'http://127.0.0.1:1', '--api-base', ctx.baseUrl]);
    assert.equal(dupBase.code, 0, dupBase.stderr);
    assert.equal(JSON.parse(dupBase.stdout.trim()).status, 200);

    // --key=<path> equals form works for join.
    const key3 = path.join(ctx.tmpDir, 'dup3.pem');
    assert.equal((await runCli(['keygen', '--out', key3])).code, 0);
    const eqKey = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'dupjoin', `--key=${key3}`, '--origin', 'colony',
    ]);
    assert.equal(JSON.parse(eqKey.stdout.trim()).status, 201);
  } finally {
    await ctx.close();
  }
});

test('say reply-to parsing edges trim 1e2 and exit-2 set', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'replier.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    const joined = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'replier', '--key', keyPath, '--origin', 'colony',
    ]);
    assert.equal(JSON.parse(joined.stdout.trim()).status, 201);
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'replier' })).status,
      200,
    );
    const base = ['say', '--api-base', ctx.baseUrl, '--handle', 'replier', '--key', keyPath];
    const s1 = await runCli([...base, '--body', 'first line']);
    assert.equal(JSON.parse(s1.stdout.trim()).data.id, 1);
    const s2 = await runCli([...base, '--body', 'second line']);
    assert.equal(JSON.parse(s2.stdout.trim()).data.id, 2);
    const trimmed = await runCli([...base, '--body', 'reply here', '--reply-to', ' 2 ']);
    const trimmedOut = JSON.parse(trimmed.stdout.trim());
    assert.equal(trimmedOut.status, 201);
    assert.equal(trimmedOut.data.reply_to, 2);
    // '1e2' parses to integer 100, so the CLI accepts it and the server 400s.
    const sci = await runCli([...base, '--body', 'x', '--reply-to', '1e2']);
    assert.equal(sci.code, 0, sci.stderr);
    const sciOut = JSON.parse(sci.stdout.trim());
    assert.equal(sciOut.ok, false);
    assert.equal(sciOut.status, 400);
    assert.equal(sciOut.data.error, 'invalid_reply_to');
    for (const val of ['0', '-1', '2.5']) {
      const bad = await runCli([...base, '--body', 'x', '--reply-to', val]);
      assert.equal(bad.code, 2);
      assert.ok(bad.stderr.includes(`Invalid --reply-to "${val}"`));
    }
    const empty = await runCli([...base, '--body', 'x', '--reply-to=']);
    assert.equal(empty.code, 2);
    assert.ok(empty.stderr.includes('Invalid --reply-to'));
  } finally {
    await ctx.close();
  }
});

test('checkin slot parsing edges trim hex whitespace-only 429 precedence', async () => {
  const ctx = await startTestServer();
  try {
    const keyA = path.join(ctx.tmpDir, 'slotter.pem');
    assert.equal((await runCli(['keygen', '--out', keyA])).code, 0);
    const joinedA = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'slotter', '--key', keyA, '--origin', 'colony',
    ]);
    assert.equal(JSON.parse(joinedA.stdout.trim()).status, 201);
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'slotter' })).status,
      200,
    );
    const baseA = ['checkin', '--api-base', ctx.baseUrl, '--handle', 'slotter', '--key', keyA];
    const trimmed = await runCli([...baseA, '--slot', ' 3 ']);
    const trimmedOut = JSON.parse(trimmed.stdout.trim());
    assert.equal(trimmedOut.status, 200);
    assert.equal(trimmedOut.data.slot, 3);
    const frac = await runCli([...baseA, '--slot', '3.5']);
    assert.equal(frac.code, 2);
    assert.ok(frac.stderr.includes('Invalid --slot "3.5"'));

    // Fresh residents for the 400 pins: a re-checkin within 1 minute hits the
    // 429 rate limit BEFORE slot validation (pinned separately below).
    for (const [handle, slot] of [['slotten', '10'], ['slotneg', '-1']]) {
      const kp = path.join(ctx.tmpDir, `${handle}.pem`);
      assert.equal((await runCli(['keygen', '--out', kp])).code, 0);
      const j = await runCli([
        'join', '--api-base', ctx.baseUrl, '--handle', handle, '--key', kp, '--origin', 'colony',
      ]);
      assert.equal(JSON.parse(j.stdout.trim()).status, 201);
      assert.equal(
        (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle })).status,
        200,
      );
      const r = await runCli([
        'checkin', '--api-base', ctx.baseUrl, '--handle', handle, '--key', kp, '--slot', slot,
      ]);
      assert.equal(r.code, 0, r.stderr);
      const out = JSON.parse(r.stdout.trim());
      assert.equal(out.ok, false);
      assert.equal(out.status, 400);
    }
    // Re-checkin within 1 min with a bad slot -> 429 rate limit first, not 400.
    const rateFirst = await runCli([...baseA, '--slot', '10']);
    const rateFirstOut = JSON.parse(rateFirst.stdout.trim());
    assert.equal(rateFirstOut.ok, false);
    assert.equal(rateFirstOut.status, 429);
  } finally {
    await ctx.close();
  }
  // Fresh server for the hex/whitespace pins: slot 3 is occupied on the first.
  const ctx2 = await startTestServer();
  try {
    const keyB = path.join(ctx2.tmpDir, 'hexslot.pem');
    assert.equal((await runCli(['keygen', '--out', keyB])).code, 0);
    const joinedB = await runCli([
      'join', '--api-base', ctx2.baseUrl, '--handle', 'hexslot', '--key', keyB, '--origin', 'colony',
    ]);
    assert.equal(JSON.parse(joinedB.stdout.trim()).status, 201);
    assert.equal(
      (await adminPost(ctx2.baseUrl, ctx2.operatorKeys, '/api/town/admin/approve', { handle: 'hexslot' })).status,
      200,
    );
    // '0x3' parses via Number() to integer 3 — the CLI accepts it, slot 3 lights.
    const hexed = await runCli([
      'checkin', '--api-base', ctx2.baseUrl, '--handle', 'hexslot', '--key', keyB, '--slot', '0x3',
    ]);
    const hexedOut = JSON.parse(hexed.stdout.trim());
    assert.equal(hexedOut.status, 200);
    assert.equal(hexedOut.data.slot, 3);

    const keyC = path.join(ctx2.tmpDir, 'spaceslot.pem');
    assert.equal((await runCli(['keygen', '--out', keyC])).code, 0);
    const joinedC = await runCli([
      'join', '--api-base', ctx2.baseUrl, '--handle', 'spaceslot', '--key', keyC, '--origin', 'colony',
    ]);
    assert.equal(JSON.parse(joinedC.stdout.trim()).status, 201);
    assert.equal(
      (await adminPost(ctx2.baseUrl, ctx2.operatorKeys, '/api/town/admin/approve', { handle: 'spaceslot' })).status,
      200,
    );
    // Whitespace-only parses via Number() to 0 — the CLI sends it, and the server rejects slot 0 (Milo's permanent footlight) with 400 invalid_slot.
    const spaced = await runCli([
      'checkin', '--api-base', ctx2.baseUrl, '--handle', 'spaceslot', '--key', keyC, '--slot', ' ',
    ]);
    const spacedOut = JSON.parse(spaced.stdout.trim());
    assert.equal(spacedOut.status, 400);
    assert.equal(spacedOut.data.error, 'invalid_slot');
  } finally {
    await ctx2.close();
  }
});

test('plot file edges directory manifest html array manifest BOM', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'plotter.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    const joined = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'plotter', '--key', keyPath, '--origin', 'colony',
    ]);
    assert.equal(JSON.parse(joined.stdout.trim()).status, 201);
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'plotter' })).status,
      200,
    );
    const validManifest = {
      cottage: 'gable', wall: '#d8c8a8', roof: '#5a3d2b', trim: '#2f4f4f',
      signpost_text: 'Plotter Desk', props: [],
    };
    const manifestPath = path.join(ctx.tmpDir, 'manifest.json');
    const htmlPath = path.join(ctx.tmpDir, 'note.html');
    fs.writeFileSync(manifestPath, JSON.stringify(validManifest));
    fs.writeFileSync(htmlPath, '<!doctype html><html><body><p>hi</p></body></html>');
    const manifestDir = path.join(ctx.tmpDir, 'manifest-dir');
    fs.mkdirSync(manifestDir);
    const htmlDir = path.join(ctx.tmpDir, 'html-dir');
    fs.mkdirSync(htmlDir);
    const base = ['plot', '--api-base', ctx.baseUrl, '--handle', 'plotter', '--key', keyPath];

    const dirManifest = await runCli([...base, '--manifest', manifestDir, '--html', htmlPath]);
    assert.equal(dirManifest.code, 1);
    const dirManifestErr = JSON.parse(dirManifest.stderr.trim());
    assert.equal(dirManifestErr.ok, false);
    assert.ok(dirManifestErr.error.startsWith('Invalid manifest JSON'), dirManifestErr.error);
    assert.ok(dirManifestErr.error.includes(manifestDir), dirManifestErr.error);
    assert.ok(dirManifestErr.error.includes('EISDIR: illegal operation on a directory, read'));

    // The --html read is NOT wrapped: a directory surfaces the bare EISDIR message.
    const dirHtml = await runCli([...base, '--manifest', manifestPath, '--html', htmlDir]);
    assert.equal(dirHtml.code, 1);
    const dirHtmlErr = JSON.parse(dirHtml.stderr.trim());
    assert.equal(dirHtmlErr.ok, false);
    assert.equal(dirHtmlErr.error, 'EISDIR: illegal operation on a directory, read');

    const arrPath = path.join(ctx.tmpDir, 'arr.json');
    fs.writeFileSync(arrPath, '[]');
    const arrManifest = await runCli([...base, '--manifest', arrPath, '--html', htmlPath]);
    assert.equal(arrManifest.code, 0, arrManifest.stderr);
    const arrOut = JSON.parse(arrManifest.stdout.trim());
    assert.equal(arrOut.ok, false);
    assert.equal(arrOut.status, 400);
    assert.equal(arrOut.data.error, 'invalid_manifest');

    const bomPath = path.join(ctx.tmpDir, 'bom.json');
    fs.writeFileSync(bomPath, '\uFEFF' + JSON.stringify(validManifest));
    const bomManifest = await runCli([...base, '--manifest', bomPath, '--html', htmlPath]);
    assert.equal(bomManifest.code, 1);
    const bomErr = JSON.parse(bomManifest.stderr.trim());
    assert.equal(bomErr.ok, false);
    assert.ok(bomErr.error.startsWith('Invalid manifest JSON'), bomErr.error);
  } finally {
    await ctx.close();
  }
});

test('usage text exactness and unexposed commands', async () => {
  const helped = await runCli(['--help']);
  assert.equal(helped.code, 0);
  assert.equal(helped.stdout, '');
  assert.ok(
    helped.stderr.startsWith('Usage: node town-api/ghostlight-client.mjs <command> [options]'),
    helped.stderr.slice(0, 80),
  );
  const cmds = [...helped.stderr.matchAll(/^  ([a-z-]+)\s+--/gm)].map((m) => m[1]);
  assert.deepEqual(cmds, [
    'keygen', 'guest-checkin', 'guest-say', 'join', 'checkin', 'say', 'leave',
    'presence', 'plot', 'getplot', 'state',
  ]);
  assert.ok(helped.stderr.includes('--api-base <url>  Defaults to TOWN_API_BASE environment variable'));
  assert.ok(helped.stderr.includes('--key <path>      Filesystem path to Ed25519 private key PEM (never a raw key)'));
  // Fish, garden, Inn, guestbook, and key rotation exist on GhostlightClient but
  // have NO CLI command — the CLI is join/checkin/say/presence/plot/state only.
  for (const cmd of ['fish', 'guest-inn', 'rotate-key', 'garden']) {
    const unknown = await runCli([cmd]);
    assert.equal(unknown.code, 2);
    assert.ok(unknown.stderr.includes(`Unknown command: ${cmd}`));
  }
  const noArgs = await runCli([]);
  assert.equal(noArgs.code, 2);
  assert.ok(noArgs.stderr.includes('Missing command'));
});

test('join invite-code empty string and join 201 data shape', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'invitee.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    // An empty --invite-code is ignored: the join lands active (201), no invite needed.
    const emptyCode = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'invempty', '--key', keyPath,
      '--origin', 'colony', '--invite-code', '',
    ]);
    assert.equal(emptyCode.code, 0, emptyCode.stderr);
    const emptyOut = JSON.parse(emptyCode.stdout.trim());
    assert.equal(emptyOut.ok, true);
    assert.equal(emptyOut.status, 201);
    assert.equal(emptyOut.data.status, 'active');
    assert.equal(emptyOut.data.origin, 'colony');
    assert.deepEqual(Object.keys(emptyOut.data).sort(), ['handle', 'origin', 'state_seq', 'status']);

    const key2 = path.join(ctx.tmpDir, 'nobio.pem');
    assert.equal((await runCli(['keygen', '--out', key2])).code, 0);
    const noBio = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'nobio', '--key', key2, '--origin', 'colony',
    ]);
    const noBioOut = JSON.parse(noBio.stdout.trim());
    assert.equal(noBioOut.ok, true);
    assert.equal(noBioOut.status, 201);
    assert.deepEqual(Object.keys(noBioOut.data).sort(), ['handle', 'origin', 'state_seq', 'status']);
    assert.equal(noBioOut.data.status, 'active');
    assert.equal(noBioOut.data.handle, 'nobio');
    assert.equal(typeof noBioOut.data.state_seq, 'number');
  } finally {
    await ctx.close();
  }
});

test('leave round-trip and file hygiene', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'leaver.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    const joined = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'leaver', '--key', keyPath, '--origin', 'colony',
    ]);
    assert.equal(JSON.parse(joined.stdout.trim()).status, 201);
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'leaver' })).status,
      200,
    );
    const checked = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'leaver', '--key', keyPath, '--status-text', 'here',
    ]);
    assert.equal(JSON.parse(checked.stdout.trim()).status, 200);
    const before = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim()).data;
    assert.equal(before.footlights.some((f) => f.handle === 'leaver'), true);

    const left = await runCli(['leave', '--api-base', ctx.baseUrl, '--handle', 'leaver', '--key', keyPath]);
    assert.equal(left.code, 0, left.stderr);
    const leftOut = JSON.parse(left.stdout.trim());
    assert.deepEqual(Object.keys(leftOut).sort(), ['data', 'ok', 'status']);
    assert.equal(leftOut.ok, true);
    assert.equal(leftOut.status, 200);
    const after = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim()).data;
    assert.equal(after.footlights.some((f) => f.handle === 'leaver'), false);

    const leftAgain = await runCli(['leave', '--api-base', ctx.baseUrl, '--handle', 'leaver', '--key', keyPath]);
    const leftAgainOut = JSON.parse(leftAgain.stdout.trim());
    assert.equal(leftAgainOut.ok, true);
    assert.equal(leftAgainOut.status, 200);
  } finally {
    await ctx.close();
  }
  // File hygiene: 58 unique names, 11 imports verbatim, pinned as-true counts.
  // NOTE the self-reference trap, handled exactly as slice 435 did: count
  // needles with concatenated strings so the assertions themselves never contain
  // the literal being counted. The G2d defaults check adds one line, so the count
  // below is 9, not the pre-slice 8.
  const self = fs.readFileSync(path.join(__dirname, 'test-ghostlight-client-cli.mjs'), 'utf8');
  const lines = self.split('\n');
  const names = [...self.matchAll(/^test\('([^']+)', /gm)].map((m) => m[1]);
  assert.equal(names.length, 58);
  assert.equal(new Set(names).size, 58); // every top-level test name unique
  assert.deepEqual(lines.filter((l) => l.startsWith('import ')), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { execFile } from 'node:child_process';",
    "import crypto from 'node:crypto';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { promisify } from 'node:util';",
    "import { createTownServer } from './server.mjs';",
    "import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';",
  ]); // no new top-level imports
  const occ = (needle) => self.split(needle).length - 1;
  assert.equal(occ('fet' + 'ch('), 1, 'adminPost helper is the only fetch call');
  assert.equal(occ('Date' + '.now'), 9, '8 pre-slice + 1 in G2d defaults check');
  assert.equal(occ('Math' + '.random'), 0);
  assert.equal(occ('TO' + 'DO'), 0);
  assert.equal(occ('FIX' + 'ME'), 0);
  assert.equal(occ('camp' + 'fire'), 0);
  assert.equal(occ('inner' + 'HTML'), 0);
});

test('state --since equality is exact (same seq 304, future and negative 200)', async () => {
  const ctx = await startTestServer();
  try {
    const initial = await runCli(['state', '--api-base', ctx.baseUrl]);
    assert.equal(initial.code, 0, initial.stderr);
    const initialOut = JSON.parse(initial.stdout.trim());
    assert.equal(initialOut.ok, true);
    assert.equal(initialOut.status, 200);
    const seq = initialOut.data.state_seq;
    assert.equal(typeof seq, 'number');

    const exact = await runCli(['state', '--api-base', ctx.baseUrl, '--since', String(seq)]);
    assert.equal(exact.code, 0, exact.stderr);
    const exactOut = JSON.parse(exact.stdout.trim());
    assert.equal(exactOut.ok, true);
    assert.equal(exactOut.status, 304);
    assert.equal(exactOut.data, null);

    const future = await runCli(['state', '--api-base', ctx.baseUrl, '--since', String(seq + 100)]);
    assert.equal(future.code, 0, future.stderr);
    const futureOut = JSON.parse(future.stdout.trim());
    assert.equal(futureOut.ok, true);
    assert.equal(futureOut.status, 200);
    assert.equal(futureOut.data.state_seq, seq);

    const negative = await runCli(['state', '--api-base', ctx.baseUrl, '--since', '-5']);
    assert.equal(negative.code, 0, negative.stderr);
    const negativeOut = JSON.parse(negative.stdout.trim());
    assert.equal(negativeOut.ok, true);
    assert.equal(negativeOut.status, 200);
    assert.equal(negativeOut.data.state_seq, seq);
  } finally {
    await ctx.close();
  }
});

test('unknown-resident CLI calls exit 0 with 401 unknown_resident', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'ghost.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);

    const calls = [
      ['leave', '--api-base', ctx.baseUrl, '--handle', 'ghost', '--key', keyPath],
      ['say', '--api-base', ctx.baseUrl, '--handle', 'ghost', '--key', keyPath, '--body', 'boo'],
      ['presence', '--api-base', ctx.baseUrl, '--handle', 'ghost', '--key', keyPath, '--zone', 'gate'],
      ['checkin', '--api-base', ctx.baseUrl, '--handle', 'ghost', '--key', keyPath],
    ];
    for (const args of calls) {
      const res = await runCli(args);
      assert.equal(res.code, 0, `${args[0]}: ${res.stderr}`);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.ok, false);
      assert.equal(out.status, 401);
      assert.equal(out.data.error, 'unknown_resident');
    }
  } finally {
    await ctx.close();
  }
});

test('guest-say needs no checkin and guest-checkin is rate-limited', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'g1.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);

    const said = await runCli([
      'guest-say', '--api-base', ctx.baseUrl, '--handle', 'g1', '--key', keyPath,
      '--body', 'speaking before checkin',
    ]);
    assert.equal(said.code, 0, said.stderr);
    const saidOut = JSON.parse(said.stdout.trim());
    assert.equal(saidOut.ok, true);
    assert.equal(saidOut.status, 201);

    const first = await runCli([
      'guest-checkin', '--api-base', ctx.baseUrl, '--handle', 'g1', '--key', keyPath,
    ]);
    assert.equal(first.code, 0, first.stderr);
    const firstOut = JSON.parse(first.stdout.trim());
    assert.equal(firstOut.ok, true);
    assert.equal(firstOut.status, 200);
    assert.equal(firstOut.data.zone, 'bandstand');

    const second = await runCli([
      'guest-checkin', '--api-base', ctx.baseUrl, '--handle', 'g1', '--key', keyPath,
    ]);
    assert.equal(second.code, 0, second.stderr);
    const secondOut = JSON.parse(second.stdout.trim());
    assert.equal(secondOut.ok, false);
    assert.equal(secondOut.status, 429);
    assert.equal(secondOut.data.error, 'rate_limited');
    assert.equal(typeof secondOut.data.retry_after, 'number');
    assert.ok(secondOut.data.retry_after > 0 && secondOut.data.retry_after <= 300);

    const st = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim()).data;
    const rows = st.presence.filter((p) => p.handle === 'g1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].zone, 'bandstand');
    assert.equal(rows[0].role, 'guest');
  } finally {
    await ctx.close();
  }
});

test('presence zone gate accepted and bare plot: rejected 400 invalid_zone', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'zoner.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    assert.equal(
      JSON.parse((await runCli([
        'join', '--api-base', ctx.baseUrl, '--handle', 'zoner', '--key', keyPath, '--origin', 'colony',
      ])).stdout.trim()).status,
      201,
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'zoner' })).status,
      200,
    );

    const gateRes = await runCli([
      'presence', '--api-base', ctx.baseUrl, '--handle', 'zoner', '--key', keyPath, '--zone', 'gate',
    ]);
    assert.equal(gateRes.code, 0, gateRes.stderr);
    const gateOut = JSON.parse(gateRes.stdout.trim());
    assert.equal(gateOut.ok, true);
    assert.equal(gateOut.status, 200);
    assert.equal(gateOut.data.zone, 'gate');

    const badRes = await runCli([
      'presence', '--api-base', ctx.baseUrl, '--handle', 'zoner', '--key', keyPath, '--zone', 'plot:',
    ]);
    assert.equal(badRes.code, 0, badRes.stderr);
    const badOut = JSON.parse(badRes.stdout.trim());
    assert.equal(badOut.ok, false);
    assert.equal(badOut.status, 400);
    assert.equal(badOut.data.error, 'invalid_zone');

    const st = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim()).data;
    const row = st.presence.find((p) => p.handle === 'zoner');
    assert.ok(row);
    assert.equal(row.zone, 'gate');
  } finally {
    await ctx.close();
  }
});

test('getplot for an existing resident with no plot returns 404 plot_not_found', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'plotless.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    assert.equal(
      JSON.parse((await runCli([
        'join', '--api-base', ctx.baseUrl, '--handle', 'plotless', '--key', keyPath, '--origin', 'colony',
      ])).stdout.trim()).status,
      201,
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'plotless' })).status,
      200,
    );

    const getRes = await runCli(['getplot', '--api-base', ctx.baseUrl, '--handle', 'plotless']);
    assert.equal(getRes.code, 0, getRes.stderr);
    const getOut = JSON.parse(getRes.stdout.trim());
    assert.equal(getOut.ok, false);
    assert.equal(getOut.status, 404);
    assert.equal(getOut.data.error, 'plot_not_found');
  } finally {
    await ctx.close();
  }
});

test('plot manifest edges: string manifest, invalid prop kind, and 13 props', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'edgeplot.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    assert.equal(
      JSON.parse((await runCli([
        'join', '--api-base', ctx.baseUrl, '--handle', 'edgeplot', '--key', keyPath, '--origin', 'colony',
      ])).stdout.trim()).status,
      201,
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'edgeplot' })).status,
      200,
    );

    const htmlPath = path.join(ctx.tmpDir, 'desk.html');
    fs.writeFileSync(htmlPath, DESK_NOTE_HTML, 'utf8');
    const base = ['plot', '--api-base', ctx.baseUrl, '--handle', 'edgeplot', '--key', keyPath, '--html', htmlPath];

    const strManifestPath = path.join(ctx.tmpDir, 'str.json');
    fs.writeFileSync(strManifestPath, JSON.stringify('hello'), 'utf8');
    const strRes = await runCli([...base, '--manifest', strManifestPath]);
    assert.equal(strRes.code, 0, strRes.stderr);
    const strOut = JSON.parse(strRes.stdout.trim());
    assert.equal(strOut.ok, false);
    assert.equal(strOut.status, 400);
    assert.equal(strOut.data.error, 'invalid_manifest');

    const dragonPath = path.join(ctx.tmpDir, 'dragon.json');
    fs.writeFileSync(
      dragonPath,
      JSON.stringify({ ...VALID_MANIFEST, props: [{ kind: 'dragon', x: 0, y: 0, z: 0, rot_y: 0 }] }),
      'utf8',
    );
    const dragonRes = await runCli([...base, '--manifest', dragonPath]);
    assert.equal(dragonRes.code, 0, dragonRes.stderr);
    const dragonOut = JSON.parse(dragonRes.stdout.trim());
    assert.equal(dragonOut.ok, false);
    assert.equal(dragonOut.status, 400);
    assert.equal(dragonOut.data.error, 'invalid_prop_kind');
    assert.equal(dragonOut.data.index, 0);

    const catsPath = path.join(ctx.tmpDir, 'cats13.json');
    fs.writeFileSync(
      catsPath,
      JSON.stringify({
        ...VALID_MANIFEST,
        props: Array.from({ length: 13 }, (_, i) => ({ kind: 'cat', x: i * 0.1, y: 0, z: 0, rot_y: 0 })),
      }),
      'utf8',
    );
    const catsRes = await runCli([...base, '--manifest', catsPath]);
    assert.equal(catsRes.code, 0, catsRes.stderr);
    const catsOut = JSON.parse(catsRes.stdout.trim());
    assert.equal(catsOut.ok, false);
    assert.equal(catsOut.status, 400);
    assert.equal(catsOut.data.error, 'too_many_props');
    assert.equal(catsOut.data.max, 12);
  } finally {
    await ctx.close();
  }
});

test('join origins guestbook, rstation, and case-sensitive Colony rejected 400', async () => {
  const ctx = await startTestServer();
  try {
    const gbKey = path.join(ctx.tmpDir, 'gbjoin.pem');
    assert.equal((await runCli(['keygen', '--out', gbKey])).code, 0);
    const gbRes = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'gbjoin', '--key', gbKey, '--origin', 'guestbook',
    ]);
    assert.equal(gbRes.code, 0, gbRes.stderr);
    const gbOut = JSON.parse(gbRes.stdout.trim());
    assert.equal(gbOut.ok, true);
    assert.equal(gbOut.status, 201);
    assert.equal(gbOut.data.origin, 'guestbook');

    const rsKey = path.join(ctx.tmpDir, 'rsjoin.pem');
    assert.equal((await runCli(['keygen', '--out', rsKey])).code, 0);
    const rsRes = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'rsjoin', '--key', rsKey, '--origin', 'rstation',
    ]);
    assert.equal(rsRes.code, 0, rsRes.stderr);
    const rsOut = JSON.parse(rsRes.stdout.trim());
    assert.equal(rsOut.ok, true);
    assert.equal(rsOut.status, 201);
    assert.equal(rsOut.data.origin, 'rstation');

    const caseKey = path.join(ctx.tmpDir, 'casejoin.pem');
    assert.equal((await runCli(['keygen', '--out', caseKey])).code, 0);
    const caseRes = await runCli([
      'join', '--api-base', ctx.baseUrl, '--handle', 'casejoin', '--key', caseKey, '--origin', 'Colony',
    ]);
    assert.equal(caseRes.code, 0, caseRes.stderr);
    const caseOut = JSON.parse(caseRes.stdout.trim());
    assert.equal(caseOut.ok, false);
    assert.equal(caseOut.status, 400);
    assert.equal(caseOut.data.error, 'invalid_origin');
  } finally {
    await ctx.close();
  }
});

test('keygen --out where a parent component is a file exits 1 with EEXIST', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cli-blocker-'));
  try {
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, 'not a dir', 'utf8');
    const res = await runCli(['keygen', '--out', path.join(blocker, 'key.pem')]);
    assert.equal(res.code, 1);
    const errJson = JSON.parse(res.stderr.trim());
    assert.equal(errJson.ok, false);
    assert.ok(errJson.error.includes('EEXIST'), errJson.error);
    assert.ok(errJson.error.includes('file already exists'), errJson.error);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('checkin without --status-text and with empty --status-text both store empty string', async () => {
  const ctx = await startTestServer();
  try {
    const k1 = path.join(ctx.tmpDir, 'nostatus.pem');
    assert.equal((await runCli(['keygen', '--out', k1])).code, 0);
    assert.equal(
      JSON.parse((await runCli([
        'join', '--api-base', ctx.baseUrl, '--handle', 'nostatus', '--key', k1, '--origin', 'colony',
      ])).stdout.trim()).status,
      201,
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'nostatus' })).status,
      200,
    );
    const c1 = await runCli(['checkin', '--api-base', ctx.baseUrl, '--handle', 'nostatus', '--key', k1]);
    assert.equal(c1.code, 0, c1.stderr);
    const c1Out = JSON.parse(c1.stdout.trim());
    assert.equal(c1Out.ok, true);
    assert.equal(c1Out.status, 200);
    assert.equal(typeof c1Out.data.slot, 'number');

    const k2 = path.join(ctx.tmpDir, 'emptytext.pem');
    assert.equal((await runCli(['keygen', '--out', k2])).code, 0);
    assert.equal(
      JSON.parse((await runCli([
        'join', '--api-base', ctx.baseUrl, '--handle', 'emptytext', '--key', k2, '--origin', 'colony',
      ])).stdout.trim()).status,
      201,
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'emptytext' })).status,
      200,
    );
    const c2 = await runCli([
      'checkin', '--api-base', ctx.baseUrl, '--handle', 'emptytext', '--key', k2, '--status-text', '',
    ]);
    assert.equal(c2.code, 0, c2.stderr);
    const c2Out = JSON.parse(c2.stdout.trim());
    assert.equal(c2Out.ok, true);
    assert.equal(c2Out.status, 200);

    const st = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim()).data;
    const f1 = st.footlights.find((f) => f.handle === 'nostatus');
    const f2 = st.footlights.find((f) => f.handle === 'emptytext');
    assert.ok(f1);
    assert.ok(f2);
    assert.equal(f1.status_text, '');
    assert.equal(f2.status_text, '');
  } finally {
    await ctx.close();
  }
});

test('say body preserves unicode, real newlines, and leading/trailing spaces verbatim', async () => {
  const ctx = await startTestServer();
  try {
    const keyPath = path.join(ctx.tmpDir, 'unicoder.pem');
    assert.equal((await runCli(['keygen', '--out', keyPath])).code, 0);
    assert.equal(
      JSON.parse((await runCli([
        'join', '--api-base', ctx.baseUrl, '--handle', 'unicoder', '--key', keyPath, '--origin', 'colony',
      ])).stdout.trim()).status,
      201,
    );
    assert.equal(
      (await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'unicoder' })).status,
      200,
    );

    const body1 = 'héllo\nwörld — lantern';
    const s1 = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'unicoder', '--key', keyPath, '--body', body1,
    ]);
    assert.equal(s1.code, 0, s1.stderr);
    const s1Out = JSON.parse(s1.stdout.trim());
    assert.equal(s1Out.ok, true);
    assert.equal(s1Out.status, 201);

    const body2 = '  padded  ';
    const s2 = await runCli([
      'say', '--api-base', ctx.baseUrl, '--handle', 'unicoder', '--key', keyPath, '--body', body2,
    ]);
    assert.equal(s2.code, 0, s2.stderr);
    const s2Out = JSON.parse(s2.stdout.trim());
    assert.equal(s2Out.ok, true);
    assert.equal(s2Out.status, 201);

    const st = JSON.parse((await runCli(['state', '--api-base', ctx.baseUrl])).stdout.trim()).data;
    const line1 = st.prompt_book.find((l) => l.id === s1Out.data.id);
    const line2 = st.prompt_book.find((l) => l.id === s2Out.data.id);
    assert.ok(line1);
    assert.ok(line2);
    assert.equal(line1.body, body1);
    assert.equal(line2.body, body2);
  } finally {
    await ctx.close();
  }
});
