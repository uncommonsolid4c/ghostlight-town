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
import { localDateString } from './stepback.mjs';
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

test('dailyGameHostForDate epoch, leap-day and invalid-shape edges', () => {
  assert.equal(dailyGameHostForDate('1970-01-01'), 'wick');
  assert.ok(['wick', 'maren', 'tomas'].includes(dailyGameHostForDate('2024-02-29')));
  assert.equal(dailyGameHostForDate('2023-02-29'), null);

  for (const bad of [
    '2026-13-01',
    '2026-00-10',
    '2026-11-00',
    '2026-11-32',
    '2026-2-3',
    '2026/11/21',
    ' 2026-11-21',
    20261121,
    undefined,
    {},
    ['2026-11-21'],
  ]) {
    assert.equal(dailyGameHostForDate(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }

  const three = ['2026-11-21', '2026-11-22', '2026-11-23'].map((d) => dailyGameHostForDate(d));
  assert.equal(new Set(three).size, 3);
  assert.equal(dailyGameHostForDate('2026-11-24'), dailyGameHostForDate('2026-11-21'));
});

test('buildDailyGameLine arg-less, non-object and non-string edges, whitespace preserved', () => {
  assert.equal(buildDailyGameLine(), null);
  assert.equal(buildDailyGameLine({}), null);
  assert.equal(buildDailyGameLine({ dailyGame: 'riddle' }), null);
  assert.equal(buildDailyGameLine({ dailyGame: 42 }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { prompt: 'Hi' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 123 } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: '' } }), null);

  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: '  What am I?  ' } }),
    "Today's game — Riddle:   What am I?  "
  );
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 'R?' } }),
    "Today's game — Riddle: R?"
  );
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'word', prompt: 'W?' } }),
    "Today's game — Word game: W?"
  );
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'story', prompt: 'S?' } }),
    "Today's game — Story chain: S?"
  );
});

test('isDailyGamePosted non-array promptBook, malformed lines and substring semantics', () => {
  const dailyGame = { format: 'riddle', prompt: 'What gets wetter?' };
  assert.equal(isDailyGamePosted({ promptBook: 'x', dailyGame }), false);
  assert.equal(isDailyGamePosted({ promptBook: null, dailyGame }), false);
  assert.equal(isDailyGamePosted({ promptBook: [{ body: null }], dailyGame }), false);
  assert.equal(isDailyGamePosted({ promptBook: [{ body: 123 }], dailyGame }), false);
  assert.equal(isDailyGamePosted({ promptBook: [null], dailyGame }), false);
  assert.equal(isDailyGamePosted({ dailyGame }), false);

  assert.equal(isDailyGamePosted({ promptBook: [], dailyGame: {} }), false);
  assert.equal(isDailyGamePosted({ promptBook: [], dailyGame: { prompt: '   ' } }), false);
  assert.equal(isDailyGamePosted({ promptBook: [], dailyGame: { prompt: 5 } }), false);

  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: 'I loved "What gets wetter the more it dries?" — a towel!' }],
      dailyGame: { format: 'riddle', prompt: 'What gets wetter the more it dries?' },
    }),
    true
  );
});

test('runTurn integration: capped host still posts the daily game (silent bypass)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const gameLine = buildDailyGameLine({ dailyGame: stateBefore.daily_game });

    const hostDir = path.join(env.stateDir, host);
    fs.mkdirSync(hostDir, { recursive: true });
    fs.writeFileSync(
      path.join(hostDir, 'state.json'),
      JSON.stringify({
        ambient_today: 2,
        ambient_date: localDateString(now),
        last_turn_at: now - 3600,
        turns: 2,
      }) + '\n',
      'utf8'
    );

    let brainCalled = false;
    const res = await runTurn({
      npcHandle: host,
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
    assert.equal(res.posted, true);
    assert.equal(res.postedGame, true);
    assert.equal(brainCalled, false);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.filter((l) => l.body === gameLine).length, 1);

    const npcState = JSON.parse(fs.readFileSync(path.join(hostDir, 'state.json'), 'utf8'));
    assert.equal(npcState.ambient_today, 3);
  } finally {
    await env.close();
  }
});

test('runTurn integration: capped non-host stays silent and posts nothing', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const nonHost = ['wick', 'maren', 'tomas'].find((h) => h !== host);

    const nonHostDir = path.join(env.stateDir, nonHost);
    fs.mkdirSync(nonHostDir, { recursive: true });
    fs.writeFileSync(
      path.join(nonHostDir, 'state.json'),
      JSON.stringify({
        ambient_today: 2,
        ambient_date: localDateString(now),
        last_turn_at: now - 3600,
        turns: 2,
      }) + '\n',
      'utf8'
    );

    let brainCalled = false;
    const res = await runTurn({
      npcHandle: nonHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => {
        brainCalled = true;
        return 'Sweeping the steps.';
      },
      logger: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'silent');
    assert.equal(res.posted, undefined);
    assert.equal(brainCalled, false);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.length, 0);
  } finally {
    await env.close();
  }
});

test('runTurn integration: dry-run host after the game posted reports no would_post_game', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);

    const first = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => 'NO',
      logger: () => {},
    });
    assert.equal(first.ok, true);
    assert.equal(first.postedGame, true);

    const logs = [];
    let brainCalled = false;
    const res = await runTurn({
      npcHandle: host,
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
    assert.equal(res.wouldPostGame, undefined);
    assert.equal(brainCalled, false);
    assert.equal(logs.some((l) => l.would_post_game === true), false);
  } finally {
    await env.close();
  }
});

test('runTurn integration: missing daily_game falls through to a normal brain turn', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const realState = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(realState.daily_game.date);
    const brainLine = 'A quiet evening by the steps.';

    let brainCalled = false;
    const res = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      fetchImpl: async (url, init) => {
        if (String(url).endsWith('/api/town/state')) {
          return { ok: true, json: async () => ({ ...realState, daily_game: null }) };
        }
        return globalThis.fetch(url, init);
      },
      brainImpl: async () => {
        brainCalled = true;
        return brainLine;
      },
      logger: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'initiate');
    assert.equal(res.posted, true);
    assert.notEqual(res.postedGame, true);
    assert.equal(brainCalled, true);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.some((l) => l.body.startsWith("Today's game —")), false);
    assert.equal(stateAfter.prompt_book.some((l) => l.handle === host && l.body === brainLine), true);
  } finally {
    await env.close();
  }
});

test('runTurn integration: honesty-rejected game line is logged and the brain turn proceeds', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const realState = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(realState.daily_game.date);
    const badGame = { date: realState.daily_game.date, format: 'riddle', prompt: 'A'.repeat(478) };
    const overLongLine = buildDailyGameLine({ dailyGame: badGame });
    assert.equal(overLongLine.length, 501);
    const brainLine = 'Just a quiet evening by the steps.';

    const logs = [];
    let brainCalled = false;
    const res = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      fetchImpl: async (url, init) => {
        if (String(url).endsWith('/api/town/state')) {
          return {
            ok: true,
            json: async () => ({
              ...realState,
              daily_game: badGame,
            }),
          };
        }
        return globalThis.fetch(url, init);
      },
      brainImpl: async () => {
        brainCalled = true;
        return brainLine;
      },
      logger: (obj) => logs.push(obj),
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'initiate');
    assert.equal(res.posted, true);
    assert.notEqual(res.postedGame, true);
    assert.equal(brainCalled, true);

    assert.equal(
      logs.some(
        (l) =>
          l.action === 'rejected' &&
          typeof l.reason === 'string' &&
          l.reason.includes('exceeds_max_length')
      ),
      true
    );

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.some((l) => l.body === overLongLine), false);
    assert.equal(stateAfter.prompt_book.some((l) => l.body.startsWith("Today's game —")), false);
    assert.equal(stateAfter.prompt_book.some((l) => l.handle === host && l.body === brainLine), true);
  } finally {
    await env.close();
  }
});

test('runTurn integration: game post lights the host footlight and records the line in memory', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const gameLine = buildDailyGameLine({ dailyGame: stateBefore.daily_game });

    const res = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => 'NO',
      logger: () => {},
    });
    assert.equal(res.ok, true);
    assert.equal(res.postedGame, true);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(
      stateAfter.footlights.some((f) => f && f.handle === host && f.role === 'npc'),
      true
    );

    const memory = fs.readFileSync(path.join(env.stateDir, host, 'memory.md'), 'utf8');
    assert.equal(memory.includes(gameLine), true);
  } finally {
    await env.close();
  }
});

test('dailyGameHostForDate rotation: 30 days split 10-10-10, 9-day window 3-3-3, pre-epoch and far-future edges', () => {
  const startMs = Date.UTC(2026, 10, 21);
  const counts30 = { wick: 0, maren: 0, tomas: 0 };
  const counts9 = { wick: 0, maren: 0, tomas: 0 };

  for (let i = 0; i < 30; i++) {
    const dateStr = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
    const host = dailyGameHostForDate(dateStr);
    counts30[host] += 1;
    if (i < 9) counts9[host] += 1;
  }

  assert.deepEqual(counts30, { wick: 10, maren: 10, tomas: 10 });
  assert.deepEqual(counts9, { wick: 3, maren: 3, tomas: 3 });

  const h21 = dailyGameHostForDate('2026-11-21');
  assert.equal(dailyGameHostForDate('2026-11-24'), h21);
  assert.equal(dailyGameHostForDate('2026-11-27'), h21);

  assert.equal(dailyGameHostForDate('1969-12-31'), 'tomas');
  assert.ok(['wick', 'maren', 'tomas'].includes(dailyGameHostForDate('2100-01-01')));
});

test('buildDailyGameLine is case-sensitive on format, preserves newlines, and has no length cap', () => {
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'Riddle', prompt: 'What am I?' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'riddle ', prompt: 'What am I?' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: '', prompt: 'What am I?' } }), null);

  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 'Line one\nLine two' } }),
    "Today's game — Riddle: Line one\nLine two"
  );

  const longLine = buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 'A'.repeat(600) } });
  assert.ok(longLine !== null);
  assert.equal(longLine.length, 623);
});

test('isDailyGamePosted is case-sensitive, format-agnostic, and rejects trailing-space prompts', () => {
  const prompt = 'What gets wetter?';
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: "Today's game — Riddle: what gets wetter?" }],
      dailyGame: { format: 'riddle', prompt },
    }),
    false
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: "Today's game — Riddle: What gets wetter?" }],
      dailyGame: { prompt },
    }),
    true
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: "Today's game — Riddle: What gets wetter?" }],
      dailyGame: { prompt: 'What gets wetter? ' },
    }),
    false
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: 'What gets wetter?' }],
      dailyGame: { format: 'riddle', prompt },
    }),
    true
  );
});

test('runTurn integration: game already quoted by a muse — host stays silent, no re-post', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const gameLine = buildDailyGameLine({ dailyGame: stateBefore.daily_game });

    const kp = generateKeypair();
    const muse = new GhostlightClient({ baseUrl: env.baseUrl, handle: 'alice', ...kp });
    const joinRes = await muse.join({ origin: 'musebook', bio: 'Real muse' });
    assert.equal(joinRes.status, 201);
    const approveRes = await adminPost(env.baseUrl, env.operatorKeys, '/api/town/admin/approve', {
      handle: 'alice',
    });
    assert.equal(approveRes.status, 200);
    const sayRes = await muse.say(gameLine, 'say');
    assert.equal(sayRes.status, 201);

    let brainCalled = false;
    const res = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => {
        brainCalled = true;
        return 'A quiet evening by the steps.';
      },
      logger: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'silent');
    assert.equal(res.posted, undefined);
    assert.notEqual(res.postedGame, true);
    assert.equal(brainCalled, false);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.filter((l) => l.body === gameLine).length, 1);
    assert.equal(stateAfter.prompt_book.some((l) => l.handle === host), false);
  } finally {
    await env.close();
  }
});

test('runTurn integration: malformed daily_game format falls through to a normal brain turn', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const realState = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(realState.daily_game.date);
    const brainLine = 'Just a quiet evening by the steps.';

    let brainCalled = false;
    const res = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      fetchImpl: async (url, init) => {
        if (String(url).endsWith('/api/town/state')) {
          return {
            ok: true,
            json: async () => ({
              ...realState,
              daily_game: { date: realState.daily_game.date, format: 'quiz', prompt: 'Is this a quiz?' },
            }),
          };
        }
        return globalThis.fetch(url, init);
      },
      brainImpl: async () => {
        brainCalled = true;
        return brainLine;
      },
      logger: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'initiate');
    assert.equal(res.posted, true);
    assert.notEqual(res.postedGame, true);
    assert.equal(brainCalled, true);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.some((l) => l.body.startsWith("Today's game —")), false);
    assert.equal(stateAfter.prompt_book.some((l) => l.handle === host && l.body === brainLine), true);
  } finally {
    await env.close();
  }
});

test('runTurn integration: next-day host rotation — new host posts, old host skips the game', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const realState = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const todayHost = dailyGameHostForDate(realState.daily_game.date);
    const [y, m, d] = realState.daily_game.date.split('-').map(Number);
    const nextDate = new Date(Date.UTC(y, m - 1, d) + 86400000).toISOString().slice(0, 10);
    const nextHost = dailyGameHostForDate(nextDate);
    assert.notEqual(nextHost, todayHost);

    const nextGame = { ...realState.daily_game, date: nextDate };
    const nextLine = buildDailyGameLine({ dailyGame: nextGame });

    const fetchWithNextGame = async (url, init) => {
      const r = await globalThis.fetch(url, init);
      if (String(url).endsWith('/api/town/state')) {
        const data = await r.json();
        return { ok: r.ok, status: r.status, json: async () => ({ ...data, daily_game: nextGame }) };
      }
      return r;
    };

    let oldBrainCalled = false;
    const oldRes = await runTurn({
      npcHandle: todayHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      fetchImpl: fetchWithNextGame,
      brainImpl: async () => {
        oldBrainCalled = true;
        return 'Old host checking in.';
      },
      logger: () => {},
    });
    assert.equal(oldRes.ok, true);
    assert.notEqual(oldRes.postedGame, true);
    assert.equal(oldBrainCalled, true);

    let newBrainCalled = false;
    const newRes = await runTurn({
      npcHandle: nextHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      fetchImpl: fetchWithNextGame,
      brainImpl: async () => {
        newBrainCalled = true;
        return 'NO';
      },
      logger: () => {},
    });
    assert.equal(newRes.ok, true);
    assert.equal(newRes.postedGame, true);
    assert.equal(newBrainCalled, false);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const gameLines = stateAfter.prompt_book.filter((l) => l.body === nextLine);
    assert.equal(gameLines.length, 1);
    assert.equal(gameLines[0].handle, nextHost);
  } finally {
    await env.close();
  }
});

test('runTurn integration: non-host dry-run reports no would_post_game', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const nonHost = ['wick', 'maren', 'tomas'].find((h) => h !== host);

    const logs = [];
    let brainCalled = false;
    const res = await runTurn({
      npcHandle: nonHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      dryRun: true,
      now,
      brainImpl: async () => {
        brainCalled = true;
        return 'NO';
      },
      logger: (obj) => logs.push(obj),
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'dry_run');
    assert.equal(res.posted, false);
    assert.equal(res.wouldPostGame, undefined);
    assert.equal(brainCalled, false);
    assert.equal(logs.some((l) => l.would_post_game === true), false);
    assert.equal(typeof res.prompt, 'string');

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.length, 0);
  } finally {
    await env.close();
  }
});

test('runTurn integration: host posts the game while a muse is checked in at the bandstand', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const gameLine = buildDailyGameLine({ dailyGame: stateBefore.daily_game });

    const kp = generateKeypair();
    const muse = new GhostlightClient({ baseUrl: env.baseUrl, handle: 'alice', ...kp });
    const joinRes = await muse.join({ origin: 'musebook', bio: 'Real muse' });
    assert.equal(joinRes.status, 201);
    const approveRes = await adminPost(env.baseUrl, env.operatorKeys, '/api/town/admin/approve', {
      handle: 'alice',
    });
    assert.equal(approveRes.status, 200);
    const checkinRes = await muse.checkin({ status_text: 'visiting the bandstand' });
    assert.equal(checkinRes.status, 200);

    const stateMid = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(
      stateMid.presence.some((p) => p.handle === 'alice' && p.zone === 'bandstand'),
      true
    );

    let brainCalled = false;
    const res = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => {
        brainCalled = true;
        return 'NO';
      },
      logger: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.posted, true);
    assert.equal(res.postedGame, true);
    assert.equal(brainCalled, false);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.filter((l) => l.body === gameLine).length, 1);
  } finally {
    await env.close();
  }
});

test('runTurn integration: game-post line has reply_to null and role npc; memory line is dated and within 140 chars', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const gameLine = buildDailyGameLine({ dailyGame: stateBefore.daily_game });

    const res = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => 'NO',
      logger: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.postedGame, true);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const postedLine = stateAfter.prompt_book.find((l) => l.body === gameLine);
    assert.ok(postedLine);
    assert.equal(postedLine.role, 'npc');
    assert.equal(postedLine.handle, host);
    assert.equal(postedLine.reply_to, null);

    const memoryLines = fs
      .readFileSync(path.join(env.stateDir, host, 'memory.md'), 'utf8')
      .split('\n')
      .filter(Boolean);
    const memLine = memoryLines.find((l) => l.includes(gameLine));
    assert.ok(memLine);
    assert.equal(memLine.startsWith(`${localDateString(now)}: `), true);
    assert.ok(memLine.length <= 140);
  } finally {
    await env.close();
  }
});

test('daily-games.json cycle data guards: 30 unique non-substring prompts with valid formats', () => {
  const games = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));
  assert.equal(games.length, 30);

  const prompts = games.map((g) => g.prompt);
  assert.equal(new Set(prompts).size, 30);

  for (const g of games) {
    assert.equal(Object.hasOwn(FORMAT_LABELS, g.format), true);
    assert.equal(typeof g.prompt, 'string');
    assert.ok(g.prompt.trim().length > 0);
  }

  for (let i = 0; i < games.length; i++) {
    for (let j = 0; j < games.length; j++) {
      if (i !== j) {
        assert.equal(games[j].prompt.includes(games[i].prompt), false);
      }
    }
  }
});

test('dailyGameHostForDate date-shape edges and 30-day cycle alignment', () => {
  assert.equal(dailyGameHostForDate('2026-11-21T00:00:00Z'), null);
  assert.equal(dailyGameHostForDate('2026-11-21\n'), null);
  assert.equal(dailyGameHostForDate('2026-11-21 '), null);
  assert.equal(dailyGameHostForDate('12026-11-21'), null);
  assert.equal(dailyGameHostForDate('2026-11-2'), null);
  assert.equal(['wick', 'maren', 'tomas'].includes(dailyGameHostForDate('9999-12-31')), true);
  assert.equal(dailyGameHostForDate('2026-12-21'), dailyGameHostForDate('2026-11-21'));
  assert.equal(dailyGameHostForDate('0001-01-01'), null);
});

test('buildDailyGameLine ignores extra fields, rejects non-string format and tab-only prompt', () => {
  assert.equal(
    buildDailyGameLine({
      dailyGame: { format: 'riddle', prompt: 'Q?', extra: 1, date: '2026-11-21' },
    }),
    "Today's game — Riddle: Q?"
  );
  assert.equal(buildDailyGameLine({ dailyGame: { format: 5, prompt: 'Q?' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: null, prompt: 'Q?' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: '\t\n ' } }), null);
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: '\tTabbed?' } }),
    "Today's game — Riddle: \tTabbed?"
  );
});

test('isDailyGamePosted handles non-object entries, missing body, substring match, and emote lines', () => {
  assert.equal(
    isDailyGamePosted({
      promptBook: ['raw string', 42, { body: "Today's game — Riddle: What gets wetter?" }],
      dailyGame: { prompt: 'What gets wetter?' },
    }),
    true
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: ['raw string', 42],
      dailyGame: { prompt: 'What gets wetter?' },
    }),
    false
  );
  assert.equal(isDailyGamePosted({ promptBook: [{}], dailyGame: { prompt: 'What gets wetter?' } }), false);
  assert.equal(
    isDailyGamePosted({ promptBook: [{ body: undefined }], dailyGame: { prompt: 'What gets wetter?' } }),
    false
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: 'I love wetter towels' }],
      dailyGame: { prompt: 'wet' },
    }),
    true
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ kind: 'emote', body: 'gestures toward What gets wetter?' }],
      dailyGame: { prompt: 'What gets wetter?' },
    }),
    true
  );
});

test('runTurn integration: host posts the game under 5-muse reply-only silent', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const gameLine = buildDailyGameLine({ dailyGame: stateBefore.daily_game });

    for (let i = 0; i < 5; i++) {
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
      npcHandle: host,
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
    assert.equal(res.posted, true);
    assert.equal(res.postedGame, true);
    assert.equal(brainCalled, false);
    assert.equal(res.decision.action, 'silent');
    assert.match(res.decision.reason, /reply-only/);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.filter((l) => l.body === gameLine).length, 1);

    const npcState = JSON.parse(
      fs.readFileSync(path.join(env.stateDir, host, 'state.json'), 'utf8')
    );
    assert.equal(npcState.ambient_today, 1);
    assert.equal(npcState.turns, 1);
    assert.equal(npcState.last_turn_at, now);
  } finally {
    await env.close();
  }
});

test('runTurn integration: host posts the game under 2-lit-muse reply-only silent', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const gameLine = buildDailyGameLine({ dailyGame: stateBefore.daily_game });

    for (const handle of ['alice', 'bob']) {
      const kp = generateKeypair();
      const muse = new GhostlightClient({ baseUrl: env.baseUrl, handle, ...kp });
      const joinRes = await muse.join({ origin: 'musebook', bio: `Real muse ${handle}` });
      assert.equal(joinRes.status, 201);
      const approveRes = await adminPost(env.baseUrl, env.operatorKeys, '/api/town/admin/approve', {
        handle,
      });
      assert.equal(approveRes.status, 200);
      const checkinRes = await muse.checkin({ status_text: `${handle} at the bandstand` });
      assert.equal(checkinRes.status, 200);
    }

    const stateMid = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateMid.footlights.filter((f) => f.role === 'muse').length, 2);

    let brainCalled = false;
    const res = await runTurn({
      npcHandle: host,
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
    assert.equal(res.postedGame, true);
    assert.equal(brainCalled, false);
    assert.match(res.decision.reason, /reply-only/);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.filter((l) => l.body === gameLine).length, 1);
  } finally {
    await env.close();
  }
});

test('runTurn integration: dry-run honesty-rejected game logs rejection and posts nothing', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const realState = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(realState.daily_game.date);
    const badGame = {
      date: realState.daily_game.date,
      format: 'riddle',
      prompt: 'A'.repeat(478),
    };
    const badLine = buildDailyGameLine({ dailyGame: badGame });
    assert.equal(badLine.length, MAX_SAY_LEN + 1);
    assert.equal(checkHonesty(badLine).ok, false);

    let brainCalled = false;
    const logs = [];
    const res = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      dryRun: true,
      fetchImpl: async (url, init) => {
        if (String(url).endsWith('/api/town/state')) {
          return {
            ok: true,
            json: async () => ({
              ...realState,
              daily_game: badGame,
            }),
          };
        }
        return globalThis.fetch(url, init);
      },
      brainImpl: async () => {
        brainCalled = true;
        return 'Should not be called';
      },
      logger: (entry) => logs.push(entry),
    });

    assert.equal(res.ok, true);
    assert.equal(res.action, 'dry_run');
    assert.equal(res.posted, false);
    assert.equal(res.wouldPostGame, undefined);
    assert.equal(brainCalled, false);
    assert.equal(typeof res.prompt, 'string');
    assert.equal(
      logs.some((l) => l.action === 'rejected' && String(l.reason).includes('exceeds_max_length')),
      true
    );

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.length, 0);
  } finally {
    await env.close();
  }
});

test('server daily_game wiring: state matches daily-games.json for today', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const state = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const todayUtc = new Date(now * 1000).toISOString().slice(0, 10);
    assert.equal(state.daily_game.date, todayUtc);

    const [y, m, d] = todayUtc.split('-').map(Number);
    const dayNumber = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
    const idx = ((dayNumber % 30) + 30) % 30;
    const games = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));

    assert.equal(state.daily_game.prompt, games[idx].prompt);
    assert.equal(state.daily_game.format, games[idx].format);
    assert.equal(['wick', 'maren', 'tomas'].includes(dailyGameHostForDate(state.daily_game.date)), true);
    assert.equal(
      buildDailyGameLine({ dailyGame: state.daily_game }),
      `Today's game — ${FORMAT_LABELS[state.daily_game.format]}: ${state.daily_game.prompt}`
    );
  } finally {
    await env.close();
  }
});

test('runTurn integration: non-host normal turn posts after the game is already posted', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);
    const nonHost = ['wick', 'maren', 'tomas'].find((h) => h !== host);
    const gameLine = buildDailyGameLine({ dailyGame: stateBefore.daily_game });

    const resHost = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => 'NO',
      logger: () => {},
    });
    assert.equal(resHost.ok, true);
    assert.equal(resHost.postedGame, true);

    const brainLine = 'A quiet evening by the steps.';
    let brainCalled = false;
    const res = await runTurn({
      npcHandle: nonHost,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => {
        brainCalled = true;
        return brainLine;
      },
      logger: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.posted, true);
    assert.notEqual(res.postedGame, true);
    assert.equal(brainCalled, true);

    const stateAfter = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    assert.equal(stateAfter.prompt_book.filter((l) => l.body === gameLine).length, 1);
    assert.equal(
      stateAfter.prompt_book.some((l) => l.handle === nonHost && l.body === brainLine),
      true
    );
  } finally {
    await env.close();
  }
});

test('runTurn integration: stale ambient_date rolls over on the game path', async () => {
  const now = Math.floor(Date.now() / 1000);
  const env = await setupNpcEnv(now);

  try {
    const stateBefore = await (await fetch(`${env.baseUrl}/api/town/state`)).json();
    const host = dailyGameHostForDate(stateBefore.daily_game.date);

    fs.mkdirSync(path.join(env.stateDir, host), { recursive: true });
    fs.writeFileSync(
      path.join(env.stateDir, host, 'state.json'),
      JSON.stringify({
        ambient_date: localDateString(now - 86400),
        ambient_today: 2,
        last_turn_at: now - 3600,
        turns: 5,
      })
    );

    const res = await runTurn({
      npcHandle: host,
      apiBase: env.baseUrl,
      stateDir: env.stateDir,
      now,
      brainImpl: async () => 'NO',
      logger: () => {},
    });

    assert.equal(res.ok, true);
    assert.equal(res.postedGame, true);

    const npcState = JSON.parse(
      fs.readFileSync(path.join(env.stateDir, host, 'state.json'), 'utf8')
    );
    assert.equal(npcState.ambient_today, 1);
    assert.equal(npcState.turns, 6);
    assert.equal(npcState.last_turn_at, now);
    assert.equal(npcState.ambient_date, localDateString(now));
  } finally {
    await env.close();
  }
});
