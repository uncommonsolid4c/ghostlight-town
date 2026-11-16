/**
 * Slice 31: CLI tests for town-api/ghostlight-client.mjs.
 *
 * Drives the real CLI as a subprocess against an ephemeral local town-api
 * server (no live host, no external env vars).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
