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
import { generateKeypair, signRequest } from './ghostlight-client.mjs';

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
    assert.equal(joinOut.data.status, 'pending');

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
