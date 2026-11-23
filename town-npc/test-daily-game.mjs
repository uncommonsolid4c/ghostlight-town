/**
 * Daily game at the Bandstand — town-npc tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTownServer } from '../town-api/server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from '../town-api/ghostlight-client.mjs';
import { ensureKeypair } from './keygen.mjs';
import { checkHonesty, MAX_SAY_LEN } from './honesty.mjs';
import { runTurn } from './run.mjs';
import {
  FORMAT_LABELS,
  dailyGameHostForDate,
  buildDailyGameLine,
  isDailyGamePosted,
} from './daily-game.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_PATH = path.join(__dirname, '..', 'town-api', 'daily-games.json');

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
  return { status: res.status, data: await res.json() };
}

async function setupNpcEnv(now) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-game-'));
  const stateDir = path.join(tmpDir, 'npc_state');
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
    nowFn: () => now,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Register and approve all 3 seed NPCs as role: 'npc'
    for (const handle of ['wick', 'maren', 'tomas']) {
      const keys = ensureKeypair({ handle, stateDir });
      const client = new GhostlightClient({
        baseUrl,
        handle,
        privateKeyPem: keys.privateKeyPem,
        pubkey: keys.pubkey,
      });
      const joinRes = await client.join({ origin: 'colony', bio: `Seed NPC ${handle}` });
      assert.equal(joinRes.status, 201);
      const approveRes = await adminPost(baseUrl, operatorKeys, '/api/town/admin/approve', {
        handle,
        role: 'npc',
      });
      assert.equal(approveRes.status, 200);
    }
  } catch (err) {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  return {
    tmpDir,
    stateDir,
    baseUrl,
    operatorKeys,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

test('dailyGameHostForDate cycles wick -> maren -> tomas and rejects invalid dates', () => {
  // 20778 = 2026-11-21 -> 20778 % 3 === 0 -> wick
  assert.equal(dailyGameHostForDate('2026-11-21'), 'wick');
  assert.equal(dailyGameHostForDate('2026-11-22'), 'maren');
  assert.equal(dailyGameHostForDate('2026-11-23'), 'tomas');
  assert.equal(dailyGameHostForDate('2026-11-24'), 'wick');

  assert.equal(dailyGameHostForDate(''), null);
  assert.equal(dailyGameHostForDate('2026-02-31'), null);
  assert.equal(dailyGameHostForDate('not-a-date'), null);
  assert.equal(dailyGameHostForDate(null), null);
});

test('buildDailyGameLine formats valid games and returns null on malformed input', () => {
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 'What am I?' } }),
    "Today's game — Riddle: What am I?"
  );
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'word', prompt: 'One word.' } }),
    "Today's game — Word game: One word."
  );
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'story', prompt: 'Continue it.' } }),
    "Today's game — Story chain: Continue it."
  );
  assert.equal(buildDailyGameLine({ dailyGame: null }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'unknown', prompt: 'Hi' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: '   ' } }), null);
  assert.deepEqual(Object.keys(FORMAT_LABELS), ['riddle', 'word', 'story']);
});

test('isDailyGamePosted detects verbatim prompt in promptBook', () => {
  const dailyGame = { format: 'riddle', prompt: 'What gets wetter the more it dries?' };
  assert.equal(isDailyGamePosted({ promptBook: [], dailyGame }), false);
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: "Today's game — Riddle: What can you catch but never throw?" }],
      dailyGame,
    }),
    false
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: "Today's game — Riddle: What gets wetter the more it dries?" }],
      dailyGame,
    }),
    true
  );
  assert.equal(isDailyGamePosted({ promptBook: [], dailyGame: null }), false);
});

test('all 30 composed daily game lines pass checkHonesty and stay under MAX_SAY_LEN', () => {
  const games = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));
  assert.equal(games.length, 30);

  for (const game of games) {
    const line = buildDailyGameLine({ dailyGame: game });
    assert.ok(line, `line should compose for ${game.prompt}`);
    assert.ok(line.length <= MAX_SAY_LEN, `line too long (${line.length}): ${line}`);
    const honesty = checkHonesty({ text: line, npc: { handle: 'wick' }, promptBook: [] });
    assert.equal(honesty.ok, true, `honesty failed for "${line}": ${honesty.reasons.join('; ')}`);
  }
});

test('runTurn integration: host posts daily game without brain call, non-host skips game, no duplicate', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const expectedHost = dailyGameHostForDate(stateBefore.daily_game.date);
    assert.ok(['wick', 'maren', 'tomas'].includes(expectedHost));
    const nonHosts = ['wick', 'maren', 'tomas'].filter((h) => h !== expectedHost);
    const expectedLine = buildDailyGameLine({ dailyGame: stateBefore.daily_game });

    // 1. Host posts the game without calling brain
    let hostBrainCalled = false;
    const hostRun = await runTurn({
      npcHandle: expectedHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => {
        hostBrainCalled = true;
        return 'Should not be called';
      },
      logger: () => {},
    });
    assert.equal(hostRun.ok, true);
    assert.equal(hostRun.posted, true);
    assert.equal(hostRun.postedGame, true);
    assert.equal(hostBrainCalled, false);

    const stateAfterHost = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const gameLines = stateAfterHost.prompt_book.filter((l) => l.body === expectedLine);
    assert.equal(gameLines.length, 1);
    assert.equal(gameLines[0].handle, expectedHost);
    assert.equal(gameLines[0].role, 'npc');

    const npcState = JSON.parse(
      fs.readFileSync(path.join(env.stateDir, expectedHost, 'state.json'), 'utf8')
    );
    assert.equal(npcState.ambient_today, 1);

    // 2. Non-hosts do not post the game
    for (const nonHost of nonHosts) {
      await runTurn({
        npcHandle: nonHost,
        apiBase: env.baseUrl,
        stateDir: env.stateDir,
        now,
        brainImpl: async () => 'Sweeping the bandstand steps.',
        logger: () => {},
      });
    }
    const stateAfterOthers = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const gameLinesAfterOthers = stateAfterOthers.prompt_book.filter((l) => l.body === expectedLine);
    assert.equal(gameLinesAfterOthers.length, 1);

    // 3. Running host again does not duplicate the game
    const hostRun2 = await runTurn({
      npcHandle: expectedHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => 'NOTHING',
      logger: () => {},
    });
    assert.equal(hostRun2.ok, true);
    assert.notEqual(hostRun2.postedGame, true);
    const stateAfterDup = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(
      stateAfterDup.prompt_book.filter((l) => l.body === expectedLine).length,
      1
    );
  } finally {
    await env.close();
  }
});

test('runTurn integration: retired host does not post daily game', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const expectedHost = dailyGameHostForDate(stateBefore.daily_game.date);

    // Seed 10 real active muses directly in DB (avoids joinIp 5/h rate limit in tests)
    for (let i = 0; i < 10; i++) {
      const h = `muse_${i}`;
      const kp = generateKeypair();
      env.db
        .prepare(
          "INSERT INTO residents (handle, pubkey, origin, status, role, bio, created_at) VALUES (?, ?, 'musebook', 'active', 'muse', 'Real muse', ?)"
        )
        .run(h, kp.pubkey, now - 600);
      env.db
        .prepare("INSERT INTO presence (handle, zone, updated_at) VALUES (?, 'bandstand', ?)")
        .run(h, now - 300);
    }

    let brainCalled = false;
    const res = await runTurn({
      npcHandle: expectedHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => {
        brainCalled = true;
        return 'Should not be called';
      },
      logger: () => {},
    });
    assert.equal(res.ok, true);
    assert.equal(res.action, 'retired');
    assert.equal(brainCalled, false);

    const state = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(state.prompt_book.length, 0);
  } finally {
    await env.close();
  }
});

test('runTurn integration: reply turn is not stolen by daily game', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const expectedHost = dailyGameHostForDate(stateBefore.daily_game.date);
    const hostDisplayName = expectedHost.charAt(0).toUpperCase() + expectedHost.slice(1);

    // Seed 1 muse who addresses today's host directly
    const kp = generateKeypair();
    const muse = new GhostlightClient({ baseUrl: env.baseUrl, handle: 'alice', ...kp });
    await muse.join({ origin: 'musebook', bio: 'Real muse' });
    await adminPost(env.baseUrl, env.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });
    await muse.say(`${hostDisplayName}, what did you notice at the bandstand today?`, 'say');

    let brainCalled = false;
    const res = await runTurn({
      npcHandle: expectedHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => {
        brainCalled = true;
        return 'Just a quiet evening by the steps.';
      },
      logger: () => {},
    });
    assert.equal(res.ok, true);
    assert.equal(res.action, 'reply');
    assert.equal(res.posted, true);
    assert.notEqual(res.postedGame, true);
    assert.equal(brainCalled, true);

    const state = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(state.prompt_book.some((l) => l.body.startsWith("Today's game —")), false);
    assert.equal(
      state.prompt_book.some((l) => l.handle === expectedHost && l.body === 'Just a quiet evening by the steps.'),
      true
    );
  } finally {
    await env.close();
  }
});

test('runTurn integration: dryRun logs game line and posts nothing', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const expectedHost = dailyGameHostForDate(stateBefore.daily_game.date);

    const logs = [];
    let brainCalled = false;
    const res = await runTurn({
      npcHandle: expectedHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      dryRun: true,
      now,
      brainImpl: async () => {
        brainCalled = true;
        return 'Should not be called';
      },
      logger: (obj) => logs.push(obj),
    });
    assert.equal(res.ok, true);
    assert.equal(res.action, 'dry_run');
    assert.equal(res.posted, false);
    assert.equal(res.wouldPostGame, true);
    assert.equal(brainCalled, false);
    assert.equal(logs.some((l) => l.would_post_game === true && typeof l.line === 'string'), true);

    const state = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(state.prompt_book.length, 0);
  } finally {
    await env.close();
  }
});
