import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createTownServer } from '../town-api/server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from '../town-api/ghostlight-client.mjs';
import { CHARACTERS, buildSystemPrompt, getStatusText } from './characters.mjs';
import { decideTurn, selectReplierForLine, localDateString } from './stepback.mjs';
import { checkHonesty, HONESTY_DENYLIST, MAX_SAY_LEN } from './honesty.mjs';
import { ensureKeypair, loadKeypair } from './keygen.mjs';
import { runTurn, trimMemory, MEMORY_MAX_BYTES, buildTurnPrompt, formatPresenceForPrompt, getPartOfDay } from './run.mjs';

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

async function adminPost(baseUrl, operatorKeys, endpoint, payload) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle: 'operator',
    privateKeyPem: operatorKeys.privateKeyPem,
  });
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

test('character sheets: valid handles, non-empty fields, distinct, no campfire', () => {
  assert.equal(CHARACTERS.length, 3);
  const handles = new Set();

  for (const npc of CHARACTERS) {
    assert.match(npc.handle, HANDLE_RE);
    handles.add(npc.handle);
    assert.ok(npc.name && npc.name.length > 0);
    assert.ok(npc.title && npc.title.length > 0);
    assert.ok(npc.past && npc.past.length > 0);
    assert.ok(npc.want && npc.want.length > 0);
    assert.ok(npc.quirk && npc.quirk.length > 0);
    assert.ok(npc.memory_seed && npc.memory_seed.length > 0);
    assert.ok(npc.routine.morning && npc.routine.morning.length > 0);
    assert.ok(npc.routine.afternoon && npc.routine.afternoon.length > 0);
    assert.ok(npc.routine.evening && npc.routine.evening.length > 0);

    for (const part of ['morning', 'afternoon', 'evening']) {
      const prompt = buildSystemPrompt(npc, part);
      assert.ok(!/campfire/i.test(prompt), `no campfire in ${npc.handle} ${part} prompt`);
    }
    const serialized = JSON.stringify(npc);
    assert.ok(!/campfire/i.test(serialized), `no campfire in ${npc.handle} character fields`);
  }
  assert.equal(handles.size, 3);
});

test('step-back: all handover, lit-muse, reply, and ambient cap rules', () => {
  const wick = CHARACTERS[0];
  const now = 1_760_000_000;
  const today = localDateString(now);

  // 1. 0 lit real muses + real muse spoke 4h ago (outside 3h reply window) -> initiate
  const r1 = decideTurn({
    npc: wick,
    state: {
      footlights: [],
      prompt_book: [{ handle: 'alice', role: 'muse', body: 'nice evening', created_at: now - 4 * 3600 }],
      presence: [],
    },
    npcState: { ambient_today: 0, ambient_date: today },
    now,
  });
  assert.equal(r1.action, 'initiate');

  // 2. 2 lit real muses, nobody addressing NPC -> silent (not initiate)
  const r2 = decideTurn({
    npc: wick,
    state: {
      footlights: [
        { handle: 'alice', role: 'muse' },
        { handle: 'bob', role: 'muse' },
      ],
      prompt_book: [{ handle: 'alice', role: 'muse', body: 'talking with bob', created_at: now - 60 }],
      presence: [],
    },
    npcState: { ambient_today: 0, ambient_date: today },
    now,
  });
  assert.equal(r2.action, 'silent');
  assert.notEqual(r2.action, 'initiate');

  // 3. 2 lit real muses + line in last 30m addressing NPC by handle -> reply
  const r3 = decideTurn({
    npc: wick,
    state: {
      footlights: [
        { handle: 'alice', role: 'muse' },
        { handle: 'bob', role: 'muse' },
      ],
      prompt_book: [
        { handle: 'alice', role: 'muse', body: 'hey wick, is the bulb warm?', created_at: now - 120 },
      ],
      presence: [],
    },
    npcState: { ambient_today: 0, ambient_date: today },
    now,
  });
  assert.equal(r3.action, 'reply');

  // 4. No real muse spoken in 6h + ambient_today already 2 -> silent
  const r4 = decideTurn({
    npc: wick,
    state: {
      footlights: [],
      prompt_book: [
        { handle: 'alice', role: 'muse', body: 'earlier', created_at: now - 7 * 3600 },
      ],
      presence: [],
    },
    npcState: { ambient_today: 2, ambient_date: today },
    now,
  });
  assert.equal(r4.action, 'silent');

  // 5. No real muse spoken in 6h + ambient_today 0 -> initiate
  const r5 = decideTurn({
    npc: wick,
    state: {
      footlights: [],
      prompt_book: [],
      presence: [],
    },
    npcState: { ambient_today: 0, ambient_date: today },
    now,
  });
  assert.equal(r5.action, 'initiate');

  // 6. 5 distinct real muses active in 24h -> never initiate (silent unaddressed, reply addressed)
  const fiveMuses = ['m1', 'm2', 'm3', 'm4', 'm5'].map((h) => ({
    handle: h,
    role: 'muse',
    updated_at: now - 1000,
  }));
  const r6a = decideTurn({
    npc: wick,
    state: { footlights: [], prompt_book: [], presence: fiveMuses },
    npcState: { ambient_today: 0, ambient_date: today },
    now,
  });
  assert.equal(r6a.action, 'silent');

  const r6b = decideTurn({
    npc: wick,
    state: {
      footlights: [],
      prompt_book: [{ handle: 'm1', role: 'muse', body: 'Wick, got a spare match?', created_at: now - 60 }],
      presence: fiveMuses,
    },
    npcState: { ambient_today: 0, ambient_date: today },
    now,
  });
  assert.equal(r6b.action, 'reply');

  // 7. 10 distinct real muses active in 24h -> retired
  const tenMuses = Array.from({ length: 10 }, (_, i) => ({
    handle: `muse_${i}`,
    role: 'muse',
    updated_at: now - 500,
  }));
  const r7 = decideTurn({
    npc: wick,
    state: { footlights: [], prompt_book: [], presence: tenMuses },
    npcState: { ambient_today: 0, ambient_date: today },
    now,
  });
  assert.equal(r7.action, 'retired');
});

test('honesty: denylist, fabricated attribution, real quote, length cap, campfire', () => {
  const wick = CHARACTERS[0];
  const promptBook = [
    { handle: 'alice', role: 'muse', body: 'The cedar steps smell like rain tonight.' },
  ];

  // Clean in-character line passes
  const clean = checkHonesty({
    text: 'Swept the top step twice and checked the brass cage on the bulb.',
    npc: wick,
    promptBook,
  });
  assert.equal(clean.ok, true);

  // Every denylist phrase rejected
  for (const phrase of HONESTY_DENYLIST) {
    const res = checkHonesty({
      text: `Well, ${phrase} and that is the truth.`,
      npc: wick,
      promptBook,
    });
    assert.equal(res.ok, false, `expected denylist rejection for "${phrase}"`);
  }

  // Fabricated quote attributed to another handle -> rejected
  const fakeQuote = checkHonesty({
    text: '"Ghostlight opened in 1922," says alice.',
    npc: wick,
    promptBook,
  });
  assert.equal(fakeQuote.ok, false);

  const fakeTranscript = checkHonesty({
    text: 'alice: I never liked cedar anyway.',
    npc: wick,
    promptBook,
  });
  assert.equal(fakeTranscript.ok, false);

  // Real quote present in promptBook -> passes
  const realQuote = checkHonesty({
    text: '"The cedar steps smell like rain tonight," said alice, and she is right.',
    npc: wick,
    promptBook,
  });
  assert.equal(realQuote.ok, true);

  // Over-long draft (> MAX_SAY_LEN = 500) -> rejected
  const tooLong = checkHonesty({
    text: 'a'.repeat(MAX_SAY_LEN + 1),
    npc: wick,
    promptBook,
  });
  assert.equal(tooLong.ok, false);

  // Campfire terminology -> rejected
  const campfire = checkHonesty({
    text: 'I sat down by the Campfire to warm my hands.',
    npc: wick,
    promptBook,
  });
  assert.equal(campfire.ok, false);
});

test('memory trim: trims > 2 KB to under 2 KB keeping newest lines', () => {
  const lines = [];
  for (let i = 0; i < 60; i++) {
    lines.push(`2026-11-12: Memory entry number ${String(i).padStart(2, '0')} — swept the bandstand steps and checked the bulb.`);
  }
  const big = lines.join('\n') + '\n';
  assert.ok(Buffer.byteLength(big, 'utf8') > MEMORY_MAX_BYTES);

  const trimmed = trimMemory(big, MEMORY_MAX_BYTES);
  assert.ok(Buffer.byteLength(trimmed, 'utf8') < MEMORY_MAX_BYTES);
  assert.ok(trimmed.includes('Memory entry number 59'), 'newest line preserved');
  assert.ok(!trimmed.includes('Memory entry number 00'), 'oldest line dropped');
});

test('keygen: 0600 key.pem, 44-char base64 pubkey (32 bytes), refuses overwrite without --force', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-keygen-'));
  try {
    const res = ensureKeypair({ handle: 'wick', stateDir: tmpDir });
    assert.equal(res.generated, true);

    const stat = fs.statSync(res.keyPath);
    assert.equal(stat.mode & 0o777, 0o600);

    const pubRaw = fs.readFileSync(res.pubkeyPath, 'utf8');
    assert.equal(pubRaw.length, 44);
    assert.equal(Buffer.from(pubRaw, 'base64').length, 32);

    // Refuses overwrite without --force
    assert.throws(() => ensureKeypair({ handle: 'wick', stateDir: tmpDir }), /already exists/);

    // CLI refuses overwrite without --force, prints only handle and pubkey with --force
    const out = execFileSync(
      'node',
      ['town-npc/keygen.mjs', '--npc', 'wick', '--state-dir', tmpDir, '--force'],
      { encoding: 'utf8' }
    ).trim();
    assert.match(out, /^wick [A-Za-z0-9+/=]{44}$/);
    assert.ok(!out.includes('PRIVATE KEY'));

    const loaded = loadKeypair({ handle: 'wick', stateDir: tmpDir });
    assert.equal(loaded.pubkey, out.split(' ')[1]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runner dry-run and dishonest draft rejection', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-dryrun-'));
  try {
    const fakeState = {
      footlights: [],
      prompt_book: [
        { id: 3, handle: 'alice', role: 'muse', kind: 'say', body: 'Evening at the Bandstand.', created_at: 1_760_000_000 },
      ],
      presence: [],
    };
    const fakeFetch = async () => ({ ok: true, status: 200, json: async () => fakeState });
    let brainCalled = false;
    const logs = [];

    const dry = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: true,
      now: 1_760_000_100,
      fetchImpl: fakeFetch,
      brainImpl: async () => {
        brainCalled = true;
        return 'should not be called';
      },
      logger: (o) => logs.push(o),
    });

    assert.equal(dry.ok, true);
    assert.equal(dry.action, 'dry_run');
    assert.equal(dry.posted, false);
    assert.equal(brainCalled, false);
    assert.ok(dry.prompt.includes('Wick'));
    assert.ok(dry.prompt.includes('Evening at the Bandstand.'));
    assert.ok(dry.prompt.includes("alice's line #3"));
    assert.ok(dry.prompt.includes('You are the one neighbor answering this line'));
    assert.equal(fs.existsSync(path.join(tmpDir, 'wick')), false, 'dry-run writes nothing');

    // Dishonest draft is rejected and posts nothing
    let postAttempted = false;
    const trackingFetch = async (url, init) => {
      if (init && init.method && init.method !== 'GET') postAttempted = true;
      return { ok: true, status: 200, json: async () => fakeState };
    };
    const dishonest = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: false,
      now: 1_760_000_100,
      fetchImpl: trackingFetch,
      brainImpl: async () => 'Actually, I am a real muse visiting from outside.',
      logger: () => {},
    });

    assert.equal(dishonest.ok, false);
    assert.equal(dishonest.action, 'rejected');
    assert.equal(dishonest.posted, false);
    assert.equal(postAttempted, false);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'wick', 'memory.md'), 'utf8'), '');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('live smoke test: join + admin/approve role:npc + runner posts and steps back when 2 muses lit', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-live-'));
  const stateDir = path.join(tmpDir, 'npc_state');
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Generate wick keypair into temp stateDir
    const wickKeys = ensureKeypair({ handle: 'wick', stateDir });

    // 2. Join with wick's pubkey, then admin/approve with role: 'npc'
    const wickClient = new GhostlightClient({
      baseUrl,
      handle: 'wick',
      privateKeyPem: wickKeys.privateKeyPem,
      pubkey: wickKeys.pubkey,
    });
    const joinRes = await wickClient.join({ origin: 'colony', bio: 'Stagehand / Lamp-Trimmer' });
    assert.equal(joinRes.status, 201);

    const approveRes = await adminPost(baseUrl, operatorKeys, '/api/town/admin/approve', {
      handle: 'wick',
      role: 'npc',
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.role, 'npc');

    // 3. Run real runner with fake brain -> should checkin + say
    const run1 = await runTurn({
      npcHandle: 'wick',
      apiBase: baseUrl,
      stateDir,
      brainImpl: async () => 'Checked the brass cage on the bulb; filament is steady.',
      logger: () => {},
    });
    assert.equal(run1.ok, true);
    assert.equal(run1.posted, true);

    const state1 = await (await fetch(`${baseUrl}/api/town/state`)).json();
    const wickFootlight = state1.footlights.find((f) => f.handle === 'wick');
    const wickLine = state1.prompt_book.find((l) => l.handle === 'wick');
    assert.ok(wickFootlight, 'wick footlight is lit');
    assert.equal(wickFootlight.role, 'npc');
    assert.ok(wickLine, 'wick line is in Prompt Book');
    assert.equal(wickLine.role, 'npc');

    // 4. Light 2 real muses, then run runner a second time -> steps back (silent, posts nothing)
    for (const h of ['alice', 'bob']) {
      const kp = generateKeypair();
      const c = new GhostlightClient({ baseUrl, handle: h, ...kp });
      await c.join({ origin: 'musebook', bio: 'Real muse' });
      await adminPost(baseUrl, operatorKeys, '/api/town/admin/approve', { handle: h });
      await c.checkin({ status_text: 'here at the bandstand' });
    }

    const beforeCount = state1.prompt_book.length;
    const run2 = await runTurn({
      npcHandle: 'wick',
      apiBase: baseUrl,
      stateDir,
      brainImpl: async () => {
        throw new Error('brain should not be called when stepped back');
      },
      logger: () => {},
    });
    assert.equal(run2.ok, true);
    assert.equal(run2.action, 'silent');

    const state2 = await (await fetch(`${baseUrl}/api/town/state`)).json();
    assert.equal(state2.prompt_book.length, beforeCount, 'nothing new posted when 2 real muses lit');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('static checks: no campfire, no hardcoded homelab host/port, no unauthorized env secrets', () => {
  const npcDir = path.resolve('town-npc');
  const files = fs.readdirSync(npcDir).filter((f) => f.endsWith('.mjs'));
  const allowedEnv = new Set(['TOWN_API_BASE', 'NPC_BRAIN_CMD', 'GEMINI_FORCE_FILE_STORAGE']);

  for (const file of files) {
    if (file === 'test-npc.mjs') continue;
    const content = fs.readFileSync(path.join(npcDir, file), 'utf8');
    if (file !== 'honesty.mjs') {
      assert.ok(!/campfire/i.test(content), `no campfire in ${file}`);
    }
    assert.ok(!content.includes('100.105'), `no 100.105 in ${file}`);
    assert.ok(!content.includes('8123'), `no 8123 in ${file}`);
    assert.ok(!content.includes('8124'), `no 8124 in ${file}`);
    assert.ok(!content.includes('8125'), `no 8125 in ${file}`);

    const envMatches = [...content.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    for (const envName of envMatches) {
      assert.ok(allowedEnv.has(envName), `unexpected process.env.${envName} in ${file}`);
    }
  }

  const skillContent = fs.readFileSync(path.resolve('SKILL.md'), 'utf8');
  assert.ok(!/campfire/i.test(skillContent), 'no campfire in SKILL.md');
});

test('per-line reply selectivity: rotation, addressed, answered, stale, plot-zone, stability', () => {
  const [wick, maren, tomas] = CHARACTERS;
  const now = 1_760_000_000;
  const today = localDateString(now);
  const npcState = { ambient_today: 0, ambient_date: today };

  // 1. One unaddressed muse line, all three NPCs -> exactly one reply (rotation), other two silent
  const state1 = {
    footlights: [],
    prompt_book: [
      { id: 1, handle: 'lampmoth', role: 'muse', kind: 'say', body: 'Evening, Bandstand...', created_at: now - 600 },
    ],
    presence: [],
  };
  const d1 = CHARACTERS.map((npc) => ({ handle: npc.handle, ...decideTurn({ npc, state: state1, npcState, now }) }));
  assert.equal(d1.filter((d) => d.action === 'reply').length, 1);
  assert.equal(d1.filter((d) => d.action === 'silent').length, 2);
  const marenD1 = d1.find((d) => d.handle === 'maren');
  assert.equal(marenD1.action, 'reply');
  assert.deepEqual(marenD1.replyLine, { id: 1, handle: 'lampmoth' });
  assert.ok(d1.find((d) => d.handle === 'wick').reason.includes('maren is'));
  assert.ok(d1.find((d) => d.handle === 'tomas').reason.includes('maren is'));

  // 2. Addressed line -> addressed NPC (tomas) replies even when rotation (id=3 -> wick) would pick another
  const state2 = {
    footlights: [],
    prompt_book: [
      { id: 3, handle: 'lampmoth', role: 'muse', kind: 'say', body: 'Tomas, is the tea kettle on?', created_at: now - 300 },
    ],
    presence: [],
  };
  const d2 = CHARACTERS.map((npc) => ({ handle: npc.handle, ...decideTurn({ npc, state: state2, npcState, now }) }));
  assert.equal(d2.find((d) => d.handle === 'tomas').action, 'reply');
  assert.equal(d2.find((d) => d.handle === 'wick').action, 'silent');
  assert.equal(d2.find((d) => d.handle === 'maren').action, 'silent');

  // 3. Muse line already answered (NPC line with later created_at) -> no reply, routine initiate allowed
  const state3 = {
    footlights: [],
    prompt_book: [
      { id: 1, handle: 'lampmoth', role: 'muse', kind: 'say', body: 'Evening, Bandstand...', created_at: now - 1200 },
      { id: 2, handle: 'maren', role: 'npc', kind: 'say', body: 'Evening, neighbor.', created_at: now - 600 },
    ],
    presence: [],
  };
  assert.equal(selectReplierForLine({ state: state3, now }), null);
  for (const npc of CHARACTERS) {
    const res = decideTurn({ npc, state: state3, npcState, now });
    assert.notEqual(res.action, 'reply');
    assert.equal(res.action, 'initiate');
  }

  // 4. Stale unanswered muse line (>3h old) -> no reply for anyone
  const state4 = {
    footlights: [],
    prompt_book: [
      { id: 1, handle: 'lampmoth', role: 'muse', kind: 'say', body: 'Afternoon hello.', created_at: now - 4 * 3600 },
    ],
    presence: [],
  };
  assert.equal(selectReplierForLine({ state: state4, now }), null);
  for (const npc of CHARACTERS) {
    const res = decideTurn({ npc, state: state4, npcState, now });
    assert.notEqual(res.action, 'reply');
  }

  // 5. Visitor present at plot:maren + unaddressed line (id=3 would rotate to wick) -> Maren is designated
  const state5 = {
    footlights: [],
    prompt_book: [
      { id: 3, handle: 'lampmoth', role: 'muse', kind: 'say', body: 'Nice porch.', created_at: now - 300 },
    ],
    presence: [
      { handle: 'lampmoth', role: 'muse', zone: 'plot:maren', updated_at: now - 120 },
    ],
  };
  const sel5 = selectReplierForLine({ state: state5, now });
  assert.equal(sel5.designatedHandle, 'maren');
  assert.equal(sel5.method, 'plot-zone');
  const d5 = CHARACTERS.map((npc) => ({ handle: npc.handle, ...decideTurn({ npc, state: state5, npcState, now }) }));
  assert.equal(d5.find((d) => d.handle === 'maren').action, 'reply');
  assert.equal(d5.find((d) => d.handle === 'wick').action, 'silent');
  assert.equal(d5.find((d) => d.handle === 'tomas').action, 'silent');

  // 7. Designation is stable: repeated decideTurn calls for the same state designate the same NPC
  for (let i = 0; i < 5; i++) {
    for (const npc of CHARACTERS) {
      const a = decideTurn({ npc, state: state1, npcState, now });
      const b = decideTurn({ npc, state: state1, npcState, now });
      assert.deepEqual(a, b);
    }
  }
});

test('in-character status lines and getStatusText helper', () => {
  const parts = ['morning', 'afternoon', 'evening'];
  for (const npc of CHARACTERS) {
    assert.ok(npc.status && typeof npc.status === 'object', `${npc.handle} has status object`);
    for (const part of parts) {
      const line = npc.status[part];
      assert.equal(typeof line, 'string', `${npc.handle}.status.${part} is a string`);
      assert.ok(line.length > 0, `${npc.handle}.status.${part} is non-empty`);
      assert.ok(line.length <= 80, `${npc.handle}.status.${part} is <= 80 chars`);
      assert.notEqual(
        line,
        npc.routine[part],
        `${npc.handle}.status.${part} must not equal routine.${part}`
      );
      assert.ok(
        !line.toLowerCase().includes('update the plot desk note'),
        `${npc.handle}.status.${part} must not contain to-do phrasing`
      );
      assert.ok(
        !line.toLowerCase().includes('stand by the porch'),
        `${npc.handle}.status.${part} must not contain to-do phrasing`
      );
      assert.equal(getStatusText(npc, part), line);
    }
  }

  // Fallback behavior: routine when status is missing, title when both are missing
  assert.equal(
    getStatusText({ title: 'Keeper', routine: { morning: 'check the gate' } }, 'morning'),
    'check the gate'
  );
  assert.equal(
    getStatusText({ title: 'Keeper' }, 'morning'),
    'Keeper'
  );
});

test('runTurn checkin posts in-character status_text for unlit Wick (fake fetch + fake brain)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-status-checkin-'));
  const origFetch = globalThis.fetch;
  try {
    const morningNow = Math.floor(new Date(2026, 10, 13, 9, 0, 0).getTime() / 1000);
    const fakeState = {
      footlights: [],
      prompt_book: [],
      presence: [],
    };
    const posted = [];
    const fakeFetch = async (url, init) => {
      if (init && init.method === 'POST') {
        posted.push({ url, body: JSON.parse(init.body) });
        return { ok: true, status: 200, json: async () => ({ ok: true, id: posted.length }) };
      }
      return { ok: true, status: 200, json: async () => fakeState };
    };
    globalThis.fetch = fakeFetch;

    const wick = CHARACTERS.find((c) => c.handle === 'wick');
    const res = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: false,
      now: morningNow,
      fetchImpl: fakeFetch,
      brainImpl: async () => 'Swept the top step before the sun hit.',
      logger: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.posted, true);

    const checkinPost = posted.find((p) => p.url.endsWith('/api/town/ghostlight/checkin'));
    assert.ok(checkinPost, 'unlit Wick posted a checkin');
    assert.equal(checkinPost.body.status_text, wick.status.morning);
    assert.notEqual(checkinPost.body.status_text, wick.routine.morning);
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('formatPresenceForPrompt: plot:maren renders as Maren\'s cottage for Wick and your cottage + host line for Maren', () => {
  const wick = CHARACTERS.find((c) => c.handle === 'wick');
  const maren = CHARACTERS.find((c) => c.handle === 'maren');
  const now = 1_760_000_000;
  const presence = [{ handle: 'lampmoth', zone: 'plot:maren', updated_at: now - 120, role: 'muse' }];

  const forWick = formatPresenceForPrompt({ npc: wick, presence, now });
  assert.equal(forWick, "- lampmoth is at Maren's cottage.");
  assert.ok(!forWick.includes('your cottage'));
  assert.ok(!forWick.includes('you are the host'));

  const forMaren = formatPresenceForPrompt({ npc: maren, presence, now });
  assert.equal(
    forMaren,
    '- lampmoth is at your cottage.\nA visitor is at your cottage — you are the host; greet them or answer from your doorway.'
  );

  // Also verify buildTurnPrompt places Where everyone is: between Prompt Book and memory
  const fullPrompt = buildTurnPrompt({
    npc: maren,
    partOfDay: 'afternoon',
    decision: { action: 'initiate' },
    promptBook: [],
    presence,
    memoryText: '',
    now,
  });
  const bookIdx = fullPrompt.indexOf('Recent Prompt Book lines:');
  const whereIdx = fullPrompt.indexOf('Where everyone is:');
  const memIdx = fullPrompt.indexOf('Your recent memory:');
  assert.ok(bookIdx !== -1 && whereIdx > bookIdx && memIdx > whereIdx);
  assert.ok(fullPrompt.includes('- lampmoth is at your cottage.'));
  assert.ok(!fullPrompt.includes('plot:maren'));
});

test('formatPresenceForPrompt: bandstand and gate render in plain words and preserve input order', () => {
  const wick = CHARACTERS.find((c) => c.handle === 'wick');
  const now = 1_760_000_000;
  const presence = [
    { handle: 'zoe', zone: 'gate', updated_at: now - 60, role: 'muse' },
    { handle: 'tomas', zone: 'bandstand', updated_at: now - 30, role: 'npc' },
  ];

  const out = formatPresenceForPrompt({ npc: wick, presence, now });
  assert.equal(out, '- zoe is at the gate.\n- tomas is at the Bandstand.');
  assert.ok(!out.includes('plot:'));
  assert.ok(!/\bbandstand\b/.test(out), 'no lowercase raw bandstand zone');
  assert.ok(!/: /.test(out));
});

test('formatPresenceForPrompt: omits stale (>3h), own handle, and malformed entries', () => {
  const wick = CHARACTERS.find((c) => c.handle === 'wick');
  const now = 1_760_000_000;
  const presence = [
    null,
    {},
    { handle: '', zone: 'gate', updated_at: now - 10 },
    { handle: 'nozone', updated_at: now - 10 },
    { handle: 'notime', zone: 'gate' },
    { handle: 'nan_time', zone: 'gate', updated_at: Number.NaN },
    { handle: 'stale_muse', zone: 'bandstand', updated_at: now - 10801 },
    { handle: 'wick', zone: 'bandstand', updated_at: now - 10 },
    { handle: 'edge_muse', zone: 'gate', updated_at: now - 10800 },
  ];

  const out = formatPresenceForPrompt({ npc: wick, presence, now });
  assert.equal(out, '- edge_muse is at the gate.');
});

test('formatPresenceForPrompt: empty presence renders single intentional line', () => {
  const wick = CHARACTERS.find((c) => c.handle === 'wick');
  const now = 1_760_000_000;

  assert.equal(formatPresenceForPrompt({ npc: wick, presence: [], now }), '(No visitors are about right now.)');
  assert.equal(formatPresenceForPrompt({ npc: wick, presence: null, now }), '(No visitors are about right now.)');
});

test('runTurn dry-run includes Where everyone is section for visitor at plot:wick', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-presence-dryrun-'));
  try {
    const now = 1_760_000_100;
    const fakeState = {
      footlights: [],
      prompt_book: [
        { id: 1, handle: 'lampmoth', role: 'muse', kind: 'say', body: 'Anyone home at the lamp cottage?', created_at: now - 60 },
      ],
      presence: [
        { handle: 'lampmoth', zone: 'plot:wick', updated_at: now - 30, role: 'muse' },
      ],
    };
    const fakeFetch = async () => ({ ok: true, status: 200, json: async () => fakeState });

    const dry = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: true,
      now,
      fetchImpl: fakeFetch,
      brainImpl: async () => 'should not be called',
      logger: () => {},
    });

    assert.equal(dry.ok, true);
    assert.equal(dry.action, 'dry_run');
    assert.ok(dry.prompt.includes('Where everyone is:'));
    assert.ok(dry.prompt.includes('- lampmoth is at your cottage.'));
    assert.ok(dry.prompt.includes('A visitor is at your cottage — you are the host; greet them or answer from your doorway.'));
    assert.ok(!dry.prompt.includes('plot:wick'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function townTimeEpochSec(year, month, day, hour, minute = 0) {
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(guessUtcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const laAsUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), 0);
  const offsetMs = guessUtcMs - laAsUtcMs;
  return Math.floor((guessUtcMs + offsetMs) / 1000);
}

test('getPartOfDay follows America/Los_Angeles town clock regardless of UTC', () => {
  // 2026-11-13 17:30 UTC is 09:30 PST (morning in LA, evening in UTC)
  assert.equal(getPartOfDay(Date.UTC(2026, 10, 13, 17, 30, 0) / 1000), 'morning');
  // 2026-11-13 02:30 UTC is 18:30 PST on Nov 12 (evening in LA, morning/night in UTC)
  assert.equal(getPartOfDay(Date.UTC(2026, 10, 13, 2, 30, 0) / 1000), 'evening');
});

test('getPartOfDay town-clock boundaries (05:00, 12:00, 17:00 America/Los_Angeles)', () => {
  assert.equal(getPartOfDay(townTimeEpochSec(2026, 11, 13, 4, 59)), 'evening');
  assert.equal(getPartOfDay(townTimeEpochSec(2026, 11, 13, 5, 0)), 'morning');
  assert.equal(getPartOfDay(townTimeEpochSec(2026, 11, 13, 11, 59)), 'morning');
  assert.equal(getPartOfDay(townTimeEpochSec(2026, 11, 13, 12, 0)), 'afternoon');
  assert.equal(getPartOfDay(townTimeEpochSec(2026, 11, 13, 16, 59)), 'afternoon');
  assert.equal(getPartOfDay(townTimeEpochSec(2026, 11, 13, 17, 0)), 'evening');
});

test('buildSystemPrompt states America/Los_Angeles town clock and softens visitor clock assumptions', () => {
  const wick = CHARACTERS.find((c) => c.handle === 'wick');
  for (const part of ['morning', 'afternoon', 'evening']) {
    const prompt = buildSystemPrompt(wick, part);
    assert.ok(prompt.includes('America/Los_Angeles'));
    assert.ok(prompt.includes(`currently ${part} by the town clock`));
    assert.ok(prompt.includes("never correct a visitor's sense of the hour"));
  }
});

test('runTurn passes reply_to when decision is reply and omits it when decision is initiate (fake fetch + fake brain)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-reply-to-'));
  const origFetch = globalThis.fetch;
  try {
    const now = Math.floor(new Date(2026, 10, 13, 10, 0, 0).getTime() / 1000);
    const posted = [];
    let currentState = {
      footlights: [{ handle: 'wick', slot: 2, lit_at: now - 60, expires_at: now + 2000 }],
      prompt_book: [
        { id: 7, handle: 'lampmoth', kind: 'say', body: 'Wick, how is the oil holding?', created_at: now - 30, role: 'muse' },
      ],
      presence: [],
    };
    const fakeFetch = async (url, init) => {
      if (init && init.method === 'POST') {
        posted.push({ url, body: JSON.parse(init.body) });
        return { ok: true, status: 201, json: async () => ({ id: 8, reply_to: posted[posted.length - 1].body.reply_to ?? null }) };
      }
      return { ok: true, status: 200, json: async () => currentState };
    };
    globalThis.fetch = fakeFetch;

    // 1. Reply turn (wick addressed in line #7) -> say carries reply_to: 7
    const replyRes = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: false,
      now,
      fetchImpl: fakeFetch,
      brainImpl: async () => 'Plenty of oil left for the evening.',
      logger: () => {},
    });
    assert.equal(replyRes.ok, true);
    assert.equal(replyRes.action, 'reply');
    const replySay = posted.find((p) => p.url.endsWith('/api/town/ghostlight/say'));
    assert.ok(replySay);
    assert.equal(replySay.body.reply_to, 7);

    // 2. Initiate turn (quiet prompt book) -> say carries no reply_to
    posted.length = 0;
    currentState = {
      footlights: [{ handle: 'maren', slot: 3, lit_at: now - 60, expires_at: now + 2000 }],
      prompt_book: [],
      presence: [],
    };
    const initRes = await runTurn({
      npcHandle: 'maren',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: false,
      now: now + 7000,
      fetchImpl: fakeFetch,
      brainImpl: async () => 'Kettle is whistling softly.',
      logger: () => {},
    });
    assert.equal(initRes.ok, true);
    assert.equal(initRes.action, 'initiate');
    const initSay = posted.find((p) => p.url.endsWith('/api/town/ghostlight/say'));
    assert.ok(initSay);
    assert.equal(Object.hasOwn(initSay.body, 'reply_to'), false);
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildTurnPrompt composes emote/[NPC] badges, last-20 slice, memory fallback, and reply guidance', () => {
  const wick = CHARACTERS.find((c) => c.handle === 'wick');
  const now = Math.floor(new Date(2026, 10, 13, 10, 0, 0).getTime() / 1000);
  const book25 = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    handle: i % 2 === 0 ? 'lampmoth' : 'wick',
    role: i % 2 === 0 ? 'muse' : 'npc',
    kind: i === 24 ? 'emote' : 'say',
    body: `line ${i + 1}`,
    created_at: now - (25 - i) * 10,
  }));

  const p1 = buildTurnPrompt({
    npc: wick,
    partOfDay: 'morning',
    decision: { action: 'reply', replyLine: { id: 7, handle: 'alice' } },
    promptBook: book25,
    presence: [],
    memoryText: '',
    now,
  });
  assert.equal(p1.includes('- [MUSE] lampmoth: line 1\n'), false);
  assert.ok(p1.includes('line 6'));
  assert.ok(p1.includes('line 25'));
  assert.ok(p1.includes('- [MUSE] lampmoth (emote): line 25'));
  assert.ok(p1.includes('- [NPC] wick: line 24'));
  assert.ok(p1.includes('(No prior memories recorded yet.)'));
  assert.ok(p1.includes("Answer alice's line #7 briefly in character."));
  assert.ok(p1.includes('Remember: stay under 500 characters, output ONLY the single line to say (or NOTHING).'));

  const p2 = buildTurnPrompt({
    npc: wick,
    partOfDay: 'morning',
    decision: { action: 'reply', replyLine: null },
    promptBook: [],
    presence: [],
    memoryText: '  ',
    now,
  });
  assert.ok(p2.includes('(The Prompt Book is quiet.)'));
  assert.ok(p2.includes('Someone mentioned you recently in the Prompt Book. Reply briefly in character.'));

  const p3 = buildTurnPrompt({
    npc: wick,
    partOfDay: 'evening',
    decision: { action: 'initiate' },
    promptBook: [],
    presence: [],
    memoryText: '2026-11-12: swept the steps.',
    now,
  });
  assert.ok(p3.includes('This is a quiet routine moment at the Bandstand. Offer one short in-character line or observation, or NOTHING if you prefer to stay quiet.'));
  assert.ok(p3.includes('2026-11-12: swept the steps.'));
});

test('runTurn --force converts silent to initiate and retired+addressed to reply (dry-run)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-force-'));
  try {
    const wick = CHARACTERS[0];
    const now = Math.floor(new Date(2026, 10, 13, 10, 0, 0).getTime() / 1000);
    assert.equal(localDateString(now), '2026-11-13');

    const twoLit = {
      footlights: [
        { handle: 'alice', role: 'muse', slot: 0, lit_at: now - 60, expires_at: now + 2000 },
        { handle: 'bob', role: 'muse', slot: 1, lit_at: now - 60, expires_at: now + 2000 },
      ],
      prompt_book: [
        { id: 1, handle: 'alice', role: 'muse', body: 'talking with bob', created_at: now - 60 },
      ],
      presence: [],
    };
    assert.equal(
      decideTurn({ npc: wick, state: twoLit, npcState: { ambient_today: 0, ambient_date: '2026-11-13' }, now }).action,
      'silent'
    );

    const res1 = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: true,
      force: true,
      now,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => twoLit }),
      brainImpl: async () => { throw new Error('no brain in dry-run'); },
      logger: () => {},
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.action, 'dry_run');
    assert.equal(res1.decision.action, 'initiate');
    assert.ok(res1.decision.reason.startsWith('forced ('));

    const retired = {
      footlights: [],
      prompt_book: [
        { id: 9, handle: 'muse_0', role: 'muse', body: 'Wick, is the bulb warm?', created_at: now - 120 },
      ],
      presence: Array.from({ length: 10 }, (_, i) => ({
        handle: `muse_${i}`,
        role: 'muse',
        updated_at: now - 500,
      })),
    };
    assert.equal(
      decideTurn({ npc: wick, state: retired, npcState: { ambient_today: 0, ambient_date: '2026-11-13' }, now }).action,
      'retired'
    );

    const res2 = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: true,
      force: true,
      now,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => retired }),
      brainImpl: async () => { throw new Error('no brain in dry-run'); },
      logger: () => {},
    });
    assert.equal(res2.ok, true);
    assert.equal(res2.action, 'dry_run');
    assert.equal(res2.decision.action, 'reply');
    assert.deepEqual(res2.decision.replyLine, { id: 9, handle: 'muse_0' });

    assert.equal(fs.existsSync(path.join(tmpDir, 'wick')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runTurn brain returning NOTHING or empty posts nothing and leaves memory empty', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-nothing-'));
  try {
    const now = Math.floor(new Date(2026, 10, 13, 10, 0, 0).getTime() / 1000);
    const quiet = { footlights: [], prompt_book: [], presence: [] };
    const fakeFetch = async () => ({ ok: true, status: 200, json: async () => quiet });

    for (const draft of ['NOTHING', '   ']) {
      const res = await runTurn({
        npcHandle: 'wick',
        apiBase: 'http://fake.local',
        stateDir: tmpDir,
        dryRun: false,
        now,
        fetchImpl: fakeFetch,
        brainImpl: async () => draft,
        logger: () => {},
      });
      assert.equal(res.ok, true);
      assert.equal(res.action, 'nothing');
      assert.equal(res.posted, false);
      assert.equal(fs.readFileSync(path.join(tmpDir, 'wick', 'memory.md'), 'utf8'), '');
      const st = JSON.parse(fs.readFileSync(path.join(tmpDir, 'wick', 'state.json'), 'utf8'));
      assert.equal(st.turns, 0);
      assert.equal(st.last_turn_at, now);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runTurn state fetch failure returns error without calling the brain or writing files (dry-run)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-fetch-err-'));
  try {
    const now = Math.floor(new Date(2026, 10, 13, 10, 0, 0).getTime() / 1000);
    let brainCalls = 0;
    const brainImpl = async () => {
      brainCalls += 1;
      return 'should not run';
    };

    const logs1 = [];
    const res1 = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: true,
      now,
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
      brainImpl,
      logger: (o) => logs1.push(o),
    });
    assert.equal(res1.ok, false);
    assert.equal(res1.exitCode, 1);
    assert.equal(res1.action, 'error');
    assert.equal(logs1[0]?.reason, 'state fetch failed: HTTP 500');
    assert.equal(brainCalls, 0);

    const logs2 = [];
    const res2 = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir,
      dryRun: true,
      now,
      fetchImpl: async () => { throw new Error('socket hang up'); },
      brainImpl,
      logger: (o) => logs2.push(o),
    });
    assert.equal(res2.ok, false);
    assert.equal(res2.exitCode, 1);
    assert.equal(res2.action, 'error');
    assert.equal(logs2[0]?.reason, 'state fetch error: socket hang up');
    assert.equal(brainCalls, 0);

    assert.equal(fs.existsSync(path.join(tmpDir, 'wick')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runTurn tolerates a failed checkin but reports a failed say', async () => {
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-checkin-fail-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-say-fail-'));
  const origFetch = globalThis.fetch;
  try {
    const now = Math.floor(new Date(2026, 10, 13, 10, 0, 0).getTime() / 1000);
    const quiet = { footlights: [], prompt_book: [], presence: [] };

    const postedUrlsA = [];
    const fakeFetchA = async (url, init) => {
      if (init && init.method === 'POST') {
        postedUrlsA.push(url);
        if (url.endsWith('/api/town/ghostlight/checkin')) {
          return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
        }
        if (url.endsWith('/api/town/ghostlight/say')) {
          return { ok: true, status: 201, json: async () => ({ id: 1 }) };
        }
      }
      return { ok: true, status: 200, json: async () => quiet };
    };
    globalThis.fetch = fakeFetchA;
    const logsA = [];
    const resA = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpA,
      dryRun: false,
      now,
      fetchImpl: fakeFetchA,
      brainImpl: async () => 'Swept the top step before the sun hit.',
      logger: (o) => logsA.push(o),
    });
    assert.equal(resA.ok, true);
    assert.equal(resA.posted, true);
    assert.equal(resA.action, 'initiate');
    assert.ok(postedUrlsA.some((u) => u.endsWith('/api/town/ghostlight/say')));
    assert.ok(logsA.some((o) => o.action === 'checkin_failed' && String(o.reason).includes('HTTP 500')));

    const fakeFetchB = async (url, init) => {
      if (init && init.method === 'POST') {
        if (url.endsWith('/api/town/ghostlight/checkin')) {
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        if (url.endsWith('/api/town/ghostlight/say')) {
          return { ok: false, status: 500, json: async () => ({ error: 'say boom' }) };
        }
      }
      return { ok: true, status: 200, json: async () => quiet };
    };
    globalThis.fetch = fakeFetchB;
    const logsB = [];
    const resB = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpB,
      dryRun: false,
      now,
      fetchImpl: fakeFetchB,
      brainImpl: async () => 'Swept the top step before the sun hit.',
      logger: (o) => logsB.push(o),
    });
    assert.equal(resB.ok, false);
    assert.equal(resB.action, 'say_failed');
    assert.equal(resB.posted, false);
    assert.ok(logsB.some((o) => o.action === 'say_failed' && String(o.reason).includes('HTTP 500')));
    assert.equal(fs.readFileSync(path.join(tmpB, 'wick', 'memory.md'), 'utf8'), '');
    const stB = JSON.parse(fs.readFileSync(path.join(tmpB, 'wick', 'state.json'), 'utf8'));
    assert.equal(stB.turns, 0);
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  }
});

test('runTurn persists dated memory and state counters after a successful post', async () => {
  const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-persist-'));
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-persist-long-'));
  const origFetch = globalThis.fetch;
  try {
    const now = Math.floor(new Date(2026, 10, 13, 10, 0, 0).getTime() / 1000);
    let currentState = { footlights: [], prompt_book: [], presence: [] };
    const fakeFetch = async (url, init) => {
      if (init && init.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 1 }) };
      }
      return { ok: true, status: 200, json: async () => currentState };
    };
    globalThis.fetch = fakeFetch;

    const res1 = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir1,
      dryRun: false,
      now,
      fetchImpl: fakeFetch,
      brainImpl: async () => 'Swept the top step before the sun hit.',
      logger: () => {},
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.posted, true);
    assert.equal(res1.action, 'initiate');
    assert.equal(
      fs.readFileSync(path.join(tmpDir1, 'wick', 'memory.md'), 'utf8'),
      '2026-11-13: Swept the top step before the sun hit.\n'
    );
    const st1 = JSON.parse(fs.readFileSync(path.join(tmpDir1, 'wick', 'state.json'), 'utf8'));
    assert.equal(st1.ambient_today, 1);
    assert.equal(st1.turns, 1);
    assert.equal(st1.last_turn_at, now);

    currentState = {
      footlights: [{ handle: 'wick', slot: 2, lit_at: now - 60, expires_at: now + 2000 }],
      prompt_book: [
        { id: 7, handle: 'lampmoth', kind: 'say', body: 'Wick, how is the oil holding?', created_at: now - 30, role: 'muse' },
      ],
      presence: [],
    };
    const res2 = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDir1,
      dryRun: false,
      now: now + 3600,
      fetchImpl: fakeFetch,
      brainImpl: async () => 'Plenty of oil left for the evening.',
      logger: () => {},
    });
    assert.equal(res2.ok, true);
    assert.equal(res2.posted, true);
    assert.equal(res2.action, 'reply');
    const st2 = JSON.parse(fs.readFileSync(path.join(tmpDir1, 'wick', 'state.json'), 'utf8'));
    assert.equal(st2.ambient_today, 1);
    assert.equal(st2.turns, 2);
    const memLines = fs.readFileSync(path.join(tmpDir1, 'wick', 'memory.md'), 'utf8').trimEnd().split('\n');
    assert.equal(memLines.length, 2);

    currentState = { footlights: [], prompt_book: [], presence: [] };
    const res3 = await runTurn({
      npcHandle: 'maren',
      apiBase: 'http://fake.local',
      stateDir: tmpDir2,
      dryRun: false,
      now,
      fetchImpl: fakeFetch,
      brainImpl: async () => 'x'.repeat(200),
      logger: () => {},
    });
    assert.equal(res3.ok, true);
    assert.equal(res3.posted, true);
    const trimmedMem = fs.readFileSync(path.join(tmpDir2, 'maren', 'memory.md'), 'utf8').trim();
    assert.equal(trimmedMem.length, 140);
    assert.ok(trimmedMem.endsWith('…'));
    assert.ok(trimmedMem.startsWith('2026-11-13: '));
  } finally {
    globalThis.fetch = origFetch;
    fs.rmSync(tmpDir1, { recursive: true, force: true });
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  }
});


test('decideTurn count boundaries: 1 lit, 4 active, 9 active, NPC footlights, prompt-book-sourced', () => {
  const wick = CHARACTERS[0];
  const now = 1_760_000_000;
  const today = localDateString(now);
  const npcState = { ambient_today: 0, ambient_date: today };

  // 1 lit real muse + muse line 4h old -> initiate (routine turn)
  const r1Lit = decideTurn({
    npc: wick,
    state: {
      footlights: [{ handle: 'alice', role: 'muse' }],
      prompt_book: [{ handle: 'alice', role: 'muse', body: 'nice evening', created_at: now - 4 * 3600 }],
      presence: [],
    },
    npcState,
    now,
  });
  assert.equal(r1Lit.action, 'initiate');
  assert.equal(r1Lit.reason, 'routine turn; real muse spoke within 6h and fewer than 2 lit');

  // 4 active real muses + addressed line from m0 -> reply (step 4, not reply-only)
  const r4Active = decideTurn({
    npc: wick,
    state: {
      footlights: [],
      presence: ['m0', 'm1', 'm2', 'm3'].map((h) => ({ handle: h, role: 'muse', updated_at: now - 60 })),
      prompt_book: [{ id: 10, handle: 'm0', role: 'muse', body: 'wick, check the bulb', created_at: now - 60 }],
    },
    npcState,
    now,
  });
  assert.equal(r4Active.action, 'reply');
  assert.equal(r4Active.reason, 'addressed in Prompt Book within last 30m');
  assert.deepEqual(r4Active.replyLine, { id: 10, handle: 'm0' });

  // 9 active real muses + unaddressed muse line from m0 1h old -> silent (reply-only, < 10)
  const r9Active = decideTurn({
    npc: wick,
    state: {
      footlights: [],
      presence: Array.from({ length: 9 }, (_, i) => ({ handle: `m${i}`, role: 'muse', updated_at: now - 60 })),
      prompt_book: [{ id: 11, handle: 'm0', role: 'muse', body: 'quiet night here', created_at: now - 3600 }],
    },
    npcState,
    now,
  });
  assert.equal(r9Active.action, 'silent');
  assert.equal(r9Active.reason, '9 real muses active in 24h (>= 5, reply-only) and not addressed');

  // 2 lit NPC footlights do not count as lit real muses -> initiate
  const rNpcFootlights = decideTurn({
    npc: wick,
    state: {
      footlights: [
        { handle: 'maren', role: 'npc' },
        { handle: 'tomas', role: 'npc' },
      ],
      prompt_book: [{ handle: 'alice', role: 'muse', body: 'nice evening', created_at: now - 4 * 3600 }],
      presence: [],
    },
    npcState,
    now,
  });
  assert.equal(rNpcFootlights.action, 'initiate');
  assert.equal(rNpcFootlights.reason, 'routine turn; real muse spoke within 6h and fewer than 2 lit');

  // 5 active real muses sourced from Prompt Book only -> silent (reply-only)
  const rPbOnly = decideTurn({
    npc: wick,
    state: {
      footlights: [],
      presence: [],
      prompt_book: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        handle: `pb${i}`,
        role: 'muse',
        body: 'hello bandstand',
        created_at: now - 100,
      })),
    },
    npcState,
    now,
  });
  assert.equal(rPbOnly.action, 'silent');
  assert.equal(rPbOnly.reason, '5 real muses active in 24h (>= 5, reply-only) and not addressed');
});

test('findAddressedLines edges: case, 30m boundary, own line, missing/non-string fields', async () => {
  const { findAddressedLines } = await import('./stepback.mjs');
  const wick = CHARACTERS[0];
  const now = 1_760_000_000;

  assert.equal(
    findAddressedLines({
      npc: wick,
      promptBook: [{ handle: 'alice', body: 'WICK, is the bulb warm?', created_at: now - 60 }],
      now,
    }).length,
    1
  );

  assert.equal(
    findAddressedLines({
      npc: wick,
      promptBook: [{ handle: 'alice', body: 'wick, hello', created_at: now - 1800 }],
      now,
    }).length,
    1
  );
  assert.equal(
    findAddressedLines({
      npc: wick,
      promptBook: [{ handle: 'alice', body: 'wick, hello', created_at: now - 1801 }],
      now,
    }).length,
    0
  );

  assert.equal(
    findAddressedLines({
      npc: wick,
      promptBook: [{ handle: 'wick', body: 'wick, check the bulb', created_at: now - 60 }],
      now,
    }).length,
    0
  );

  assert.equal(
    findAddressedLines({
      npc: wick,
      promptBook: [
        { handle: 'alice', body: 'wick, missing timestamp' },
        { handle: 'alice', body: 123, created_at: now - 60 },
        { handle: 'alice', body: null, created_at: now - 60 },
      ],
      now,
    }).length,
    0
  );
});

test('selectReplierForLine edges: emote/system kinds, id fallbacks, ordering, plot-zone fall-throughs, npc emote answer', () => {
  const now = 1_760_000_000;

  const emoteRes = selectReplierForLine({
    state: {
      prompt_book: [{ id: 2, handle: 'alice', role: 'muse', kind: 'emote', body: 'waves', created_at: now - 60 }],
      presence: [],
    },
    now,
  });
  assert.equal(emoteRes.designatedHandle, 'tomas');
  assert.equal(emoteRes.method, 'rotation');

  assert.equal(
    selectReplierForLine({
      state: {
        prompt_book: [{ id: 2, handle: 'alice', role: 'muse', kind: 'system', body: 'joined', created_at: now - 60 }],
        presence: [],
      },
      now,
    }),
    null
  );

  const noIdRes = selectReplierForLine({
    state: {
      prompt_book: [{ handle: 'alice', role: 'muse', body: 'hello', created_at: 1_760_000_100 }],
      presence: [],
    },
    now: 1_760_000_200,
  });
  assert.equal(noIdRes.designatedHandle, 'wick');
  assert.equal(noIdRes.method, 'rotation');

  const negIdRes = selectReplierForLine({
    state: {
      prompt_book: [{ id: -1, handle: 'alice', role: 'muse', body: 'hello', created_at: now - 60 }],
      presence: [],
    },
    now,
  });
  assert.equal(negIdRes.designatedHandle, 'tomas');
  assert.equal(negIdRes.method, 'rotation');

  const latestRes = selectReplierForLine({
    state: {
      prompt_book: [
        { id: 9, handle: 'alice', role: 'muse', body: 'later', created_at: now - 60 },
        { id: 1, handle: 'alice', role: 'muse', body: 'earlier', created_at: now - 600 },
      ],
      presence: [],
    },
    now,
  });
  assert.equal(latestRes.line.id, 9);
  assert.equal(latestRes.designatedHandle, 'wick');

  const unknownPlotRes = selectReplierForLine({
    state: {
      prompt_book: [{ id: 1, handle: 'alice', role: 'muse', body: 'hello', created_at: now - 60 }],
      presence: [{ handle: 'alice', zone: 'plot:nosuch', updated_at: now - 60 }],
    },
    now,
  });
  assert.equal(unknownPlotRes.method, 'rotation');
  assert.equal(unknownPlotRes.designatedHandle, 'maren');

  const stalePlotRes = selectReplierForLine({
    state: {
      prompt_book: [{ id: 1, handle: 'alice', role: 'muse', body: 'hello', created_at: now - 60 }],
      presence: [{ handle: 'alice', zone: 'plot:maren', updated_at: now - 4 * 3600 }],
    },
    now,
  });
  assert.equal(stalePlotRes.method, 'rotation');

  const answeredEmote = selectReplierForLine({
    state: {
      prompt_book: [
        { id: 1, handle: 'alice', role: 'muse', body: 'hello', created_at: now - 600 },
        { id: 2, handle: 'wick', role: 'npc', kind: 'emote', body: 'nods', created_at: now - 300 },
      ],
      presence: [],
    },
    now,
  });
  assert.equal(answeredEmote, null);
});

test('checkHonesty boundaries: 500/501 cap, empty/non-string, reason order, self/dash/case/snippet floor', () => {
  const wick = CHARACTERS[0];

  assert.equal(checkHonesty({ text: 'a'.repeat(500), npc: wick, promptBook: [] }).ok, true);
  const over = checkHonesty({ text: 'a'.repeat(501), npc: wick, promptBook: [] });
  assert.equal(over.ok, false);
  assert.deepEqual(over.reasons, ['exceeds_max_length (501 > 500)']);

  for (const blank of ['', '   ', 42]) {
    const res = checkHonesty({ text: blank, npc: wick, promptBook: [] });
    assert.equal(res.ok, false);
    assert.deepEqual(res.reasons, ['empty_draft']);
  }

  const multi = checkHonesty({
    text: `I am a real muse at the campfire. ${'x'.repeat(500)}`,
    npc: wick,
    promptBook: [],
  });
  assert.equal(multi.ok, false);
  assert.ok(multi.reasons[0].startsWith('exceeds_max_length'));
  assert.ok(multi.reasons.includes('forbidden_terminology: campfire'));
  assert.ok(multi.reasons.includes('denylist_phrase: "i am a real muse"'));

  assert.equal(
    checkHonesty({ text: '"Swept the steps twice," says wick.', npc: wick, promptBook: [] }).ok,
    true
  );

  const dashFail = checkHonesty({
    text: '"The cedar steps smell like rain tonight" — alice',
    npc: wick,
    promptBook: [{ handle: 'alice', body: 'Something else entirely.' }],
  });
  assert.equal(dashFail.ok, false);
  assert.deepEqual(dashFail.reasons, ['unverified_attribution: alice']);

  assert.equal(checkHonesty({ text: 'I AM A REAL MUSE, honestly.', npc: wick, promptBook: [] }).ok, false);

  assert.equal(checkHonesty({ text: 'alice: x', npc: wick, promptBook: [] }).ok, true);
  const twoChar = checkHonesty({ text: 'alice: ok', npc: wick, promptBook: [] });
  assert.equal(twoChar.ok, false);
  assert.deepEqual(twoChar.reasons, ['unverified_attribution: alice']);
});

test('trimMemory byte boundaries: 2048/2047, single long line, empty, multibyte', () => {
  const line101 = `${'x'.repeat(100)}\n`;
  const tail28 = `${'x'.repeat(27)}\n`;
  const text2048 = line101.repeat(20) + tail28;
  assert.equal(Buffer.byteLength(text2048, 'utf8'), MEMORY_MAX_BYTES);
  const trimmed2048 = trimMemory(text2048);
  assert.equal(trimmed2048, line101.repeat(19) + tail28);
  assert.ok(Buffer.byteLength(trimmed2048, 'utf8') < MEMORY_MAX_BYTES);

  const text2047 = line101.repeat(20) + `${'x'.repeat(26)}\n`;
  assert.equal(Buffer.byteLength(text2047, 'utf8'), MEMORY_MAX_BYTES - 1);
  assert.equal(trimMemory(text2047), text2047);

  assert.equal(trimMemory(`${'x'.repeat(3000)}\n`), '');
  assert.equal(trimMemory(''), '');

  const multi3001 = `${'é'.repeat(1500)}\n`;
  assert.equal(Buffer.byteLength(multi3001, 'utf8'), 3001);
  assert.equal(trimMemory(multi3001), '');

  const multi2001 = `${'é'.repeat(1000)}\n`;
  assert.equal(Buffer.byteLength(multi2001, 'utf8'), 2001);
  assert.equal(trimMemory(multi2001), multi2001);
});

test('runTurn unknown NPC and brain failure paths', async () => {
  const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-unknown-'));
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-throw-'));
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-nonstr-'));
  try {
    const now = 1_760_000_000;
    let fetchCalls = 0;
    const unknownLogs = [];
    const unknownRes = await runTurn({
      npcHandle: 'nosuch',
      apiBase: 'http://fake.local',
      stateDir: tmp1,
      dryRun: false,
      now,
      fetchImpl: async () => {
        fetchCalls++;
        return { ok: true, status: 200, json: async () => ({}) };
      },
      logger: (o) => unknownLogs.push(o),
    });
    assert.deepEqual(unknownRes, { ok: false, exitCode: 1, action: 'error' });
    assert.equal(fetchCalls, 0);
    assert.deepEqual(unknownLogs, [{ npc: 'nosuch', action: 'error', reason: 'unknown npc: nosuch' }]);
    assert.equal(fs.existsSync(path.join(tmp1, 'nosuch')), false);

    const quietFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ footlights: [], prompt_book: [], presence: [] }),
    });

    const throwRes = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmp2,
      dryRun: false,
      now,
      fetchImpl: quietFetch,
      brainImpl: async () => {
        throw new Error('boom');
      },
      logger: () => {},
    });
    assert.equal(throwRes.ok, false);
    assert.equal(throwRes.action, 'error');
    const st2 = JSON.parse(fs.readFileSync(path.join(tmp2, 'wick', 'state.json'), 'utf8'));
    assert.equal(st2.turns, 0);
    assert.equal(st2.last_turn_at, null);

    const nonStrLogs = [];
    const nonStrRes = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmp3,
      dryRun: false,
      now,
      fetchImpl: quietFetch,
      brainImpl: async () => 42,
      logger: (o) => nonStrLogs.push(o),
    });
    assert.equal(nonStrRes.ok, false);
    assert.equal(nonStrRes.action, 'error');
    assert.ok(nonStrLogs.some((o) => o.action === 'error' && String(o.reason).startsWith('brain failed:')));
  } finally {
    fs.rmSync(tmp1, { recursive: true, force: true });
    fs.rmSync(tmp2, { recursive: true, force: true });
    fs.rmSync(tmp3, { recursive: true, force: true });
  }
});

test('runTurn silent and retired persistence plus dry-run no-write', async () => {
  const tmpSilent = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-silent-'));
  const tmpDry = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-silent-dry-'));
  const tmpRetired = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-retired-'));
  try {
    const now = 1_760_000_000;
    const silentState = {
      footlights: [
        { handle: 'alice', role: 'muse' },
        { handle: 'bob', role: 'muse' },
      ],
      prompt_book: [{ id: 1, handle: 'alice', role: 'muse', body: 'hello bob', created_at: now - 60 }],
      presence: [],
    };
    let brainCalls = 0;
    const guardBrain = async () => {
      brainCalls++;
      throw new Error('brain should not be called');
    };

    const resSilent = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpSilent,
      dryRun: false,
      now,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => silentState }),
      brainImpl: guardBrain,
      logger: () => {},
    });
    assert.equal(resSilent.ok, true);
    assert.equal(resSilent.action, 'silent');
    assert.equal(brainCalls, 0);
    const stSilent = JSON.parse(fs.readFileSync(path.join(tmpSilent, 'wick', 'state.json'), 'utf8'));
    assert.equal(stSilent.last_turn_at, now);
    assert.equal(stSilent.turns, 0);
    assert.equal(fs.readFileSync(path.join(tmpSilent, 'wick', 'memory.md'), 'utf8'), '');

    const resDry = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpDry,
      dryRun: true,
      now,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => silentState }),
      brainImpl: guardBrain,
      logger: () => {},
    });
    assert.equal(resDry.action, 'silent');
    assert.equal(fs.existsSync(path.join(tmpDry, 'wick')), false);

    const retiredState = {
      footlights: [],
      prompt_book: [],
      presence: Array.from({ length: 10 }, (_, i) => ({
        handle: `m${i}`,
        role: 'muse',
        updated_at: now - 60,
      })),
    };
    const resRetired = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmpRetired,
      dryRun: false,
      now,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => retiredState }),
      brainImpl: guardBrain,
      logger: () => {},
    });
    assert.equal(resRetired.action, 'retired');
    const stRetired = JSON.parse(fs.readFileSync(path.join(tmpRetired, 'wick', 'state.json'), 'utf8'));
    assert.equal(stRetired.last_turn_at, now);
    assert.equal(stRetired.turns, 0);
  } finally {
    fs.rmSync(tmpSilent, { recursive: true, force: true });
    fs.rmSync(tmpDry, { recursive: true, force: true });
    fs.rmSync(tmpRetired, { recursive: true, force: true });
  }
});

test('runTurn --force conversions in dry-run: retired unaddressed -> initiate, reply unchanged', async () => {
  const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-force1-'));
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-force2-'));
  try {
    const now = 1_760_000_000;
    const retiredUnaddressed = {
      footlights: [],
      presence: Array.from({ length: 10 }, (_, i) => ({
        handle: `m${i}`,
        role: 'muse',
        updated_at: now - 60,
      })),
      prompt_book: [
        { id: 1, handle: 'muse_0', role: 'muse', body: 'talking among ourselves', created_at: now - 120 },
      ],
    };
    const res1 = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmp1,
      dryRun: true,
      force: true,
      now,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => retiredUnaddressed }),
      logger: () => {},
    });
    assert.equal(res1.action, 'dry_run');
    assert.equal(res1.decision.action, 'initiate');
    assert.ok(res1.decision.reason.startsWith('forced ('));
    assert.equal(res1.decision.replyLine, null);

    const existingReply = {
      footlights: [
        { handle: 'alice', role: 'muse' },
        { handle: 'bob', role: 'muse' },
      ],
      presence: [],
      prompt_book: [
        { id: 4, handle: 'alice', role: 'muse', body: 'wick, is the bulb warm?', created_at: now - 60 },
      ],
    };
    const res2 = await runTurn({
      npcHandle: 'wick',
      apiBase: 'http://fake.local',
      stateDir: tmp2,
      dryRun: true,
      force: true,
      now,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => existingReply }),
      logger: () => {},
    });
    assert.equal(res2.action, 'dry_run');
    assert.equal(res2.decision.action, 'reply');
    assert.equal(res2.decision.reason.startsWith('forced'), false);
    assert.deepEqual(res2.decision.replyLine, { id: 4, handle: 'alice' });
  } finally {
    fs.rmSync(tmp1, { recursive: true, force: true });
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
});

test('formatPresenceForPrompt zone edges: unknown zone, empty plot:, unknown plot, host line last, null npc', () => {
  const wick = CHARACTERS[0];
  const now = 1_760_000_000;

  assert.equal(
    formatPresenceForPrompt({
      npc: wick,
      presence: [
        { handle: 'zoe', zone: 'inn', updated_at: now - 60, role: 'muse' },
        { handle: 'yan', zone: 'plot:', updated_at: now - 60, role: 'muse' },
      ],
      now,
    }),
    '- zoe is at around town.'
  );

  assert.equal(
    formatPresenceForPrompt({
      npc: wick,
      presence: [{ handle: 'zoe', zone: 'plot:nosuch', updated_at: now - 60, role: 'muse' }],
      now,
    }),
    "- zoe is at nosuch's cottage."
  );

  assert.equal(
    formatPresenceForPrompt({
      npc: wick,
      presence: [
        { handle: 'zoe', zone: 'plot:wick', updated_at: now - 60, role: 'muse' },
        { handle: 'yan', zone: 'gate', updated_at: now - 30, role: 'muse' },
      ],
      now,
    }),
    "- zoe is at your cottage.\n- yan is at the gate.\nA visitor is at your cottage — you are the host; greet them or answer from your doorway."
  );

  assert.equal(
    formatPresenceForPrompt({
      npc: null,
      presence: [{ handle: 'wick', zone: 'gate', updated_at: now - 60, role: 'npc' }],
      now,
    }),
    '- wick is at the gate.'
  );
});

test('run.mjs CLI via subprocess: usage, missing api-base, unknown NPC, TOWN_API_BASE env default', () => {
  const tmpCli = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-cli-'));
  const runScript = path.resolve('town-npc/run.mjs');
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.TOWN_API_BASE;

    const runFail = (args, env = cleanEnv) => {
      try {
        execFileSync('node', [runScript, ...args], { cwd: tmpCli, encoding: 'utf8', env });
        assert.fail('expected CLI to exit non-zero');
      } catch (err) {
        assert.equal(err.status, 1);
        return { stdout: err.stdout || '', stderr: err.stderr || '' };
      }
    };

    const rNoArgs = runFail([]);
    assert.ok(rNoArgs.stderr.includes('Usage: node town-npc/run.mjs --npc <handle> --api-base <url>'));

    runFail(['--npc', 'wick']);

    const rUnknown = runFail(['--npc', 'nosuch', '--api-base', 'http://127.0.0.1:1', '--state-dir', tmpCli]);
    assert.ok(rUnknown.stdout.includes('"action":"error"'));
    assert.ok(rUnknown.stdout.includes('unknown npc: nosuch'));

    const rEnv = runFail(['--npc', 'wick', '--state-dir', tmpCli], {
      ...cleanEnv,
      TOWN_API_BASE: 'http://127.0.0.1:1',
    });
    assert.ok(rEnv.stdout.includes('"action":"error"'));
    assert.ok(rEnv.stdout.includes('state fetch error:'));
  } finally {
    fs.rmSync(tmpCli, { recursive: true, force: true });
  }
});
