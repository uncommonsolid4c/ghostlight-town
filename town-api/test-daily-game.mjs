/**
 * Daily game at the Bandstand — town-api tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair } from './ghostlight-client.mjs';
import { dailyGameHostForDate, buildDailyGameLine, isDailyGamePosted, FORMAT_LABELS } from '../town-npc/daily-game.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAMES_PATH = path.join(__dirname, 'daily-games.json');
const DAY_SEC = 86400;

async function startTestServer(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-daily-game-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();
  let clockOffset = 0;
  const baseNow = opts.baseNow ?? Math.floor(Date.UTC(2026, 10, 22, 12, 0, 0) / 1000);
  const nowFn = opts.nowFn || (() => baseNow + clockOffset);

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: opts.operatorPubkey !== undefined ? opts.operatorPubkey : operatorKeys.pubkey,
    topicsPath: opts.topicsPath,
    gamesPath: opts.gamesPath,
    nowFn,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    tmpDir,
    db,
    nowSec: nowFn,
    advanceClock(sec) {
      clockOffset += sec;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function expectedGameForNow(games, nowSec) {
  const d = new Date(nowSec * 1000);
  const utcMidnightMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dayNumber = Math.floor(utcMidnightMs / 86400000);
  const idx = ((dayNumber % games.length) + games.length) % games.length;
  return {
    dayNumber,
    date: d.toISOString().slice(0, 10),
    game: games[idx],
  };
}

test('daily-games.json has 30 valid entries, 10 per format, no duplicate prompts', () => {
  const games = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));
  assert.ok(Array.isArray(games));
  assert.equal(games.length, 30);

  const counts = { riddle: 0, word: 0, story: 0 };
  const seenPrompts = new Set();
  for (const entry of games) {
    assert.ok(entry && typeof entry === 'object');
    assert.ok(['riddle', 'word', 'story'].includes(entry.format), `unexpected format: ${entry.format}`);
    assert.equal(typeof entry.prompt, 'string');
    assert.ok(entry.prompt.trim().length > 0, 'prompt must be non-empty');
    assert.ok(entry.prompt.length <= 160, `prompt exceeds 160 chars: ${entry.prompt.length}`);
    assert.equal(seenPrompts.has(entry.prompt), false, `duplicate prompt: ${entry.prompt}`);
    seenPrompts.add(entry.prompt);
    counts[entry.format] += 1;
  }

  assert.deepEqual(counts, { riddle: 10, word: 10, story: 10 });
});

test('GET /api/town/state serves deterministic daily_game and rotates formats across 3 consecutive UTC days', async () => {
  const games = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));
  // Pick a base day whose dayNumber % 3 === 0 so consecutive days are riddle -> word -> story
  const baseDayNumber = 20778; // 20778 % 3 === 0 (2026-11-21)
  const baseNow = baseDayNumber * DAY_SEC + 3600;
  const ctx = await startTestServer({ baseNow });

  try {
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl });
    const formats = [];
    for (let offset = 0; offset < 3; offset++) {
      if (offset > 0) ctx.advanceClock(DAY_SEC);
      const res = await client.state();
      assert.equal(res.status, 200);
      assert.ok(res.data.nightly_call, 'nightly_call is still present alongside daily_game');
      assert.ok(res.data.daily_game, 'daily_game is present');
      assert.deepEqual(Object.keys(res.data.daily_game).sort(), ['date', 'format', 'prompt']);
      assert.match(res.data.daily_game.date, /^\d{4}-\d{2}-\d{2}$/);

      const expected = expectedGameForNow(games, ctx.nowSec());
      assert.equal(res.data.daily_game.date, expected.date);
      assert.equal(res.data.daily_game.format, expected.game.format);
      assert.equal(res.data.daily_game.prompt, expected.game.prompt);
      formats.push(res.data.daily_game.format);
    }

    assert.deepEqual(formats, ['riddle', 'word', 'story']);
  } finally {
    await ctx.close();
  }
});

test('bad or invalid daily-games file omits daily_game softly without failing state', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-bad-games-'));
  const invalidJsonPath = path.join(tmpDir, 'invalid.json');
  const badEntryPath = path.join(tmpDir, 'bad-entry.json');
  fs.writeFileSync(invalidJsonPath, '{ not valid json', 'utf8');
  fs.writeFileSync(
    badEntryPath,
    JSON.stringify([{ format: 'puzzle', prompt: 'Not a valid format' }]),
    'utf8'
  );

  try {
    const ctx1 = await startTestServer({ gamesPath: invalidJsonPath });
    try {
      const res1 = await new GhostlightClient({ baseUrl: ctx1.baseUrl }).state();
      assert.equal(res1.status, 200);
      assert.equal(res1.data.daily_game, undefined);
      assert.ok(res1.data.nightly_call, 'nightly_call still present');
    } finally {
      await ctx1.close();
    }

    const ctx2 = await startTestServer({ gamesPath: badEntryPath });
    try {
      const res2 = await new GhostlightClient({ baseUrl: ctx2.baseUrl }).state();
      assert.equal(res2.status, 200);
      assert.equal(res2.data.daily_game, undefined);
      assert.ok(res2.data.nightly_call, 'nightly_call still present');
    } finally {
      await ctx2.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('daily game host rotates wick -> maren -> tomas across consecutive UTC days', () => {
  const hosts = ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'].map(dailyGameHostForDate);
  assert.deepEqual(hosts, ['wick', 'maren', 'tomas', 'wick']);
});

test('daily game host returns null for invalid dates', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-11-31', '11/22/2026', '', null, undefined, 20261122]) {
    assert.equal(dailyGameHostForDate(bad), null, `expected null for ${String(bad)}`);
  }
});

test('daily game line composes the exact line for each format', () => {
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 'What has keys but opens no locks?' } }),
    'Today\u0027s game \u2014 Riddle: What has keys but opens no locks?'
  );
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'word', prompt: 'Name a word that\u2026' } }),
    'Today\u0027s game \u2014 Word game: Name a word that\u2026'
  );
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'story', prompt: 'Once upon a\u2026' } }),
    'Today\u0027s game \u2014 Story chain: Once upon a\u2026'
  );
});

test('daily game line returns null for malformed input', () => {
  const bad = [
    {},
    { dailyGame: { format: 'puzzle', prompt: 'x' } },
    { dailyGame: { format: 'riddle', prompt: '  ' } },
    { dailyGame: null },
    { dailyGame: { format: 'riddle' } },
  ];
  for (const input of bad) {
    assert.equal(buildDailyGameLine(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

test('isDailyGamePosted detects the posted prompt and nothing else', () => {
  const promptBook = [
    { body: 'Today\u0027s game \u2014 Riddle: What has keys but opens no locks?' },
    { body: 'hello' },
  ];
  assert.equal(isDailyGamePosted({ promptBook, dailyGame: { prompt: 'What has keys but opens no locks?' } }), true);
  assert.equal(isDailyGamePosted({ promptBook, dailyGame: { prompt: 'something else' } }), false);
  assert.equal(isDailyGamePosted({ promptBook }), false);
  assert.equal(isDailyGamePosted({ promptBook: 'nope', dailyGame: { prompt: 'What has keys but opens no locks?' } }), false);
  assert.equal(isDailyGamePosted({ dailyGame: { prompt: 'What has keys but opens no locks?' } }), false);
  assert.equal(isDailyGamePosted({ promptBook: [], dailyGame: { prompt: 'What has keys but opens no locks?' } }), false);
});

test('daily game labels and host align with the state endpoint', async () => {
  assert.deepEqual(Object.keys(FORMAT_LABELS).sort(), ['riddle', 'story', 'word']);
  const baseNow = Math.floor(Date.UTC(2026, 10, 21, 12, 0, 0) / 1000);
  const ctx = await startTestServer({ baseNow });
  try {
    const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
    assert.equal(res.status, 200);
    assert.equal(res.data.daily_game.date, '2026-11-21');
    assert.equal(res.data.daily_game.format, 'riddle');
    assert.equal(dailyGameHostForDate(res.data.daily_game.date), 'wick');
    assert.ok(buildDailyGameLine({ dailyGame: res.data.daily_game }).startsWith('Today\u0027s game \u2014 Riddle: '));
  } finally {
    await ctx.close();
  }
});
