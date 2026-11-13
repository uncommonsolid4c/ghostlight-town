import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createTownServer } from '../town-api/server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from '../town-api/ghostlight-client.mjs';
import { CHARACTERS, buildSystemPrompt } from './characters.mjs';
import { decideTurn, selectReplierForLine, localDateString } from './stepback.mjs';
import { checkHonesty, HONESTY_DENYLIST, MAX_SAY_LEN } from './honesty.mjs';
import { ensureKeypair, loadKeypair } from './keygen.mjs';
import { runTurn, trimMemory, MEMORY_MAX_BYTES } from './run.mjs';

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
