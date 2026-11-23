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

test('daily_game rotates at the UTC midnight boundary', async () => {
  const games = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));
  const ctx = await startTestServer({
    baseNow: Math.floor(Date.UTC(2026, 10, 21, 23, 59, 0) / 1000),
  });
  try {
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl });
    const first = await client.state();
    assert.equal(first.status, 200);
    assert.equal(first.data.daily_game.date, '2026-11-21');
    assert.equal(
      first.data.daily_game.prompt,
      expectedGameForNow(games, ctx.nowSec()).game.prompt
    );

    ctx.advanceClock(120);
    const second = await client.state();
    assert.equal(second.status, 200);
    assert.equal(second.data.daily_game.date, '2026-11-22');
    assert.equal(
      second.data.daily_game.prompt,
      expectedGameForNow(games, ctx.nowSec()).game.prompt
    );
    assert.notEqual(second.data.daily_game.prompt, first.data.daily_game.prompt);
  } finally {
    await ctx.close();
  }
});

test('daily_game is identical within one UTC day', async () => {
  const ctx = await startTestServer({
    baseNow: Math.floor(Date.UTC(2026, 10, 21, 0, 30, 0) / 1000),
  });
  try {
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl });
    const first = await client.state();
    assert.equal(first.status, 200);

    ctx.advanceClock(23 * 3600);
    const second = await client.state();
    assert.equal(second.status, 200);
    assert.deepEqual(second.data.daily_game, first.data.daily_game);
  } finally {
    await ctx.close();
  }
});

test('a short games file rotates by its own length', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-short-games-'));
  const gamesPath = path.join(tmpDir, 'games.json');
  fs.writeFileSync(
    gamesPath,
    JSON.stringify([
      { format: 'riddle', prompt: 'First game prompt' },
      { format: 'word', prompt: 'Second game prompt' },
    ]),
    'utf8'
  );

  try {
    const ctx = await startTestServer({
      baseNow: Math.floor(Date.UTC(2026, 10, 21, 12, 0, 0) / 1000),
      gamesPath,
    });
    try {
      const client = new GhostlightClient({ baseUrl: ctx.baseUrl });
      const prompts = [];
      for (let i = 0; i < 3; i++) {
        if (i > 0) ctx.advanceClock(DAY_SEC);
        const res = await client.state();
        assert.equal(res.status, 200);
        prompts.push(res.data.daily_game.prompt);
      }
      assert.deepEqual(prompts, ['First game prompt', 'Second game prompt', 'First game prompt']);
    } finally {
      await ctx.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('an empty, non-array, or missing games file omits daily_game softly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-soft-games-'));
  const emptyPath = path.join(tmpDir, 'empty.json');
  const objPath = path.join(tmpDir, 'object.json');
  const missingPath = path.join(tmpDir, 'does-not-exist.json');
  fs.writeFileSync(emptyPath, '[]', 'utf8');
  fs.writeFileSync(objPath, JSON.stringify({ format: 'riddle', prompt: 'x' }), 'utf8');

  try {
    for (const gamesPath of [emptyPath, objPath, missingPath]) {
      const ctx = await startTestServer({ gamesPath });
      try {
        const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
        assert.equal(res.status, 200);
        assert.equal(res.data.daily_game, undefined);
        assert.ok(res.data.nightly_call, 'nightly_call still present');
      } finally {
        await ctx.close();
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('one invalid entry poisons the whole games file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-poison-games-'));
  const cases = [
    [{ format: 'riddle', prompt: 'x'.repeat(161) }],
    [{ format: 'riddle', prompt: '   ' }],
    [{ format: 'puzzle', prompt: 'Not a valid format' }],
    [null],
  ];

  try {
    for (let i = 0; i < cases.length; i++) {
      const gamesPath = path.join(tmpDir, `case-${i}.json`);
      fs.writeFileSync(gamesPath, JSON.stringify(cases[i]), 'utf8');
      const ctx = await startTestServer({ gamesPath });
      try {
        const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
        assert.equal(res.status, 200);
        assert.equal(res.data.daily_game, undefined);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('an empty-string gamesPath omits daily_game softly', async () => {
  const ctx = await startTestServer({ gamesPath: '' });
  try {
    const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
    assert.equal(res.status, 200);
    assert.equal(res.data.daily_game, undefined);
  } finally {
    await ctx.close();
  }
});

test('daily game host cycles a full week and handles leap day', () => {
  const week = [
    '2026-11-21',
    '2026-11-22',
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
    '2026-11-26',
    '2026-11-27',
  ].map(dailyGameHostForDate);
  assert.deepEqual(week, ['wick', 'maren', 'tomas', 'wick', 'maren', 'tomas', 'wick']);
  assert.notEqual(dailyGameHostForDate('2028-02-29'), null);
  assert.equal(dailyGameHostForDate('2025-02-29'), null);
  assert.notEqual(dailyGameHostForDate('2024-02-29'), null);
});

test('buildDailyGameLine preserves the prompt verbatim and isDailyGamePosted matches substrings', () => {
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: '  What has keys?  ' } }),
    'Today\u0027s game \u2014 Riddle:   What has keys?  '
  );

  const promptBook = [
    { body: 'Wick: quoting "Today\u0027s game \u2014 Riddle: What has keys but opens no locks?" for luck' },
    { body: 42 },
    null,
    { body: 'What has key?' },
  ];
  assert.equal(isDailyGamePosted({ promptBook, dailyGame: { prompt: 'What has keys but opens no locks?' } }), true);
  assert.equal(isDailyGamePosted({ promptBook, dailyGame: { prompt: 'What has keys' } }), true);
  assert.equal(isDailyGamePosted({ promptBook, dailyGame: { prompt: 'What has keys but opens no locks??' } }), false);
  assert.equal(isDailyGamePosted({ promptBook, dailyGame: { prompt: '  ' } }), false);
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: 'What has keys but opens no locks?' }],
      dailyGame: { prompt: 'What has keys but opens no locks?' },
    }),
    true
  );
});

test('daily_game survives a Prompt Book mutation unchanged', async () => {
  const ctx = await startTestServer({ baseNow: Math.floor(Date.now() / 1000) });
  try {
    const alice = new GhostlightClient({
      baseUrl: ctx.baseUrl,
      handle: 'alice',
      ...generateKeypair(),
    });
    const before = await alice.state();
    assert.equal(before.status, 200);

    const joined = await alice.join({ origin: 'musebook', bio: 'scratch' });
    assert.equal(joined.status, 201);

    const said = await alice.say('Hello, Bandstand.');
    assert.equal(said.status, 201);

    const after = await alice.state();
    assert.equal(after.status, 200);
    assert.deepEqual(after.data.daily_game, before.data.daily_game);
    assert.ok(after.data.state_seq > before.data.state_seq);
    assert.ok(Array.isArray(after.data.prompt_book) && after.data.prompt_book.length >= 1);
  } finally {
    await ctx.close();
  }
});

test('daily_game date is the UTC date, not the local date', async () => {
  const games = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));
  const ctx1 = await startTestServer({
    baseNow: Math.floor(Date.UTC(2026, 10, 22, 0, 30, 0) / 1000),
  });
  try {
    const res1 = await new GhostlightClient({ baseUrl: ctx1.baseUrl }).state();
    assert.equal(res1.status, 200);
    assert.equal(res1.data.daily_game.date, '2026-11-22');
    assert.equal(res1.data.nightly_call.date, '2026-11-22');
    assert.equal(res1.data.daily_game.prompt, expectedGameForNow(games, ctx1.nowSec()).game.prompt);
  } finally {
    await ctx1.close();
  }

  const ctx2 = await startTestServer({
    baseNow: Math.floor(Date.UTC(2026, 10, 21, 23, 30, 0) / 1000),
  });
  try {
    const res2 = await new GhostlightClient({ baseUrl: ctx2.baseUrl }).state();
    assert.equal(res2.status, 200);
    assert.equal(res2.data.daily_game.date, '2026-11-21');
    assert.equal(res2.data.nightly_call.date, '2026-11-21');
  } finally {
    await ctx2.close();
  }
});

test('daily_game and nightly_call rotate on their own cycle lengths', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-cycles-'));
  const gamesPath = path.join(tmpDir, 'games.json');
  fs.writeFileSync(
    gamesPath,
    JSON.stringify([
      { format: 'riddle', prompt: 'Game A' },
      { format: 'word', prompt: 'Game B' },
    ]),
    'utf8'
  );

  try {
    const ctx = await startTestServer({
      baseNow: Math.floor(Date.UTC(2026, 10, 21, 12, 0, 0) / 1000),
      gamesPath,
    });
    try {
      const client = new GhostlightClient({ baseUrl: ctx.baseUrl });
      const prompts = [];
      const topics = [];
      const dates = [];
      for (let i = 0; i < 3; i++) {
        if (i > 0) ctx.advanceClock(DAY_SEC);
        const res = await client.state();
        assert.equal(res.status, 200);
        assert.equal(res.data.daily_game.date, res.data.nightly_call.date);
        prompts.push(res.data.daily_game.prompt);
        topics.push(res.data.nightly_call.topic);
        dates.push(res.data.daily_game.date);
      }
      assert.deepEqual(prompts, ['Game A', 'Game B', 'Game A']);
      assert.equal(new Set(topics).size, 3);
      assert.deepEqual(dates, ['2026-11-21', '2026-11-22', '2026-11-23']);
    } finally {
      await ctx.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a 160-char prompt serves, a 161-char prompt poisons the file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-len-games-'));
  const okPath = path.join(tmpDir, 'ok.json');
  const badPath = path.join(tmpDir, 'bad.json');
  const okPrompt = 'x'.repeat(160);
  const badPrompt = 'x'.repeat(161);
  fs.writeFileSync(okPath, JSON.stringify([{ format: 'riddle', prompt: okPrompt }]), 'utf8');
  fs.writeFileSync(badPath, JSON.stringify([{ format: 'riddle', prompt: badPrompt }]), 'utf8');

  try {
    const ctxOk = await startTestServer({ gamesPath: okPath });
    try {
      const resOk = await new GhostlightClient({ baseUrl: ctxOk.baseUrl }).state();
      assert.equal(resOk.status, 200);
      assert.equal(resOk.data.daily_game.prompt, okPrompt);
    } finally {
      await ctxOk.close();
    }

    const ctxBad = await startTestServer({ gamesPath: badPath });
    try {
      const resBad = await new GhostlightClient({ baseUrl: ctxBad.baseUrl }).state();
      assert.equal(resBad.status, 200);
      assert.equal(resBad.data.daily_game, undefined);
    } finally {
      await ctxBad.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('daily_game prompt is served verbatim, including unicode and surrounding spaces', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-verbatim-games-'));
  const gamesPath = path.join(tmpDir, 'games.json');
  const verbatimPrompt = '  Café — "quoted" ✓  ';
  fs.writeFileSync(
    gamesPath,
    JSON.stringify([{ format: 'story', prompt: verbatimPrompt }]),
    'utf8'
  );

  try {
    const ctx = await startTestServer({ gamesPath });
    try {
      const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
      assert.equal(res.status, 200);
      assert.equal(res.data.daily_game.format, 'story');
      assert.equal(res.data.daily_game.prompt, verbatimPrompt);
    } finally {
      await ctx.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('games entries with extra fields still serve daily_game without leaking them', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-extra-games-'));
  const gamesPath = path.join(tmpDir, 'games.json');
  fs.writeFileSync(
    gamesPath,
    JSON.stringify([
      { format: 'riddle', prompt: 'Extra fields game', answer: 'the answer', difficulty: 3 },
    ]),
    'utf8'
  );

  try {
    const ctx = await startTestServer({ gamesPath });
    try {
      const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
      assert.equal(res.status, 200);
      assert.equal(res.data.daily_game.prompt, 'Extra fields game');
      assert.deepEqual(Object.keys(res.data.daily_game).sort(), ['date', 'format', 'prompt']);
    } finally {
      await ctx.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('daily game host handles pre-epoch, far-future, and non-leap-century dates', () => {
  assert.equal(dailyGameHostForDate('1970-01-01'), 'wick');
  assert.equal(dailyGameHostForDate('1969-12-31'), 'tomas');
  assert.equal(dailyGameHostForDate('2099-12-31'), 'wick');
  assert.notEqual(dailyGameHostForDate('2000-02-29'), null);
  assert.equal(dailyGameHostForDate('1900-02-29'), null);
  assert.notEqual(dailyGameHostForDate('2100-03-01'), null);
});

test('buildDailyGameLine and isDailyGamePosted reject wrong-case formats and non-string prompts', () => {
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'Riddle', prompt: 'x' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 42 } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: 'string' }), null);
  assert.equal(buildDailyGameLine({ dailyGame: [] }), null);
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 'x', extra: 1 } }),
    "Today's game \u2014 Riddle: x"
  );

  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: 'WHAT HAS KEYS?' }],
      dailyGame: { prompt: 'What has keys?' },
    }),
    false
  );
  assert.equal(
    isDailyGamePosted({ promptBook: [{ body: 'x' }], dailyGame: { prompt: 42 } }),
    false
  );
  assert.equal(
    isDailyGamePosted({ promptBook: [{ body: 42 }], dailyGame: { prompt: 'x' } }),
    false
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: 'prefix What has keys? suffix' }],
      dailyGame: { prompt: 'What has keys?' },
    }),
    true
  );
});

test('state?since= returns 304 across the UTC midnight rollover — the known edge', async () => {
  const ctx = await startTestServer({
    baseNow: Math.floor(Date.UTC(2026, 10, 21, 23, 0, 0) / 1000),
  });
  try {
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl });
    const first = await client.state();
    assert.equal(first.status, 200);
    assert.equal(first.data.daily_game.date, '2026-11-21');
    const seq = first.data.state_seq;

    const sameDay = await client.state(seq);
    assert.equal(sameDay.status, 304);
    assert.equal(sameDay.data, null);

    ctx.advanceClock(2 * 3600);
    const afterMidnightSince = await client.state(seq);
    assert.equal(afterMidnightSince.status, 304);
    assert.equal(afterMidnightSince.data, null);

    const afterMidnightPlain = await client.state();
    assert.equal(afterMidnightPlain.status, 200);
    assert.equal(afterMidnightPlain.data.daily_game.date, '2026-11-22');
    assert.equal(afterMidnightPlain.data.state_seq, seq);
    assert.notEqual(afterMidnightPlain.data.daily_game.prompt, first.data.daily_game.prompt);
  } finally {
    await ctx.close();
  }
});

test('daily_game reloads from disk on server restart', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-reload-games-'));
  const gamesPath = path.join(tmpDir, 'games.json');

  try {
    fs.writeFileSync(
      gamesPath,
      JSON.stringify([{ format: 'riddle', prompt: 'First version game' }]),
      'utf8'
    );
    const ctx1 = await startTestServer({ gamesPath });
    try {
      const res1 = await new GhostlightClient({ baseUrl: ctx1.baseUrl }).state();
      assert.equal(res1.status, 200);
      assert.equal(res1.data.daily_game.prompt, 'First version game');
    } finally {
      await ctx1.close();
    }

    fs.writeFileSync(
      gamesPath,
      JSON.stringify([{ format: 'riddle', prompt: 'Second version game' }]),
      'utf8'
    );
    const ctx2 = await startTestServer({ gamesPath });
    try {
      const res2 = await new GhostlightClient({ baseUrl: ctx2.baseUrl }).state();
      assert.equal(res2.status, 200);
      assert.equal(res2.data.daily_game.prompt, 'Second version game');
    } finally {
      await ctx2.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
