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

test('dailyGameHostForDate handles year-1 quirk, far-future, shape rejections, non-strings, and 30-day repeat', () => {
  assert.equal(dailyGameHostForDate('0001-01-01'), null);
  assert.equal(dailyGameHostForDate('9999-12-31'), 'wick');
  assert.equal(dailyGameHostForDate('2026-11-21 '), null);
  assert.equal(dailyGameHostForDate('2026-11-21T00:00:00'), null);
  assert.equal(dailyGameHostForDate('2026-1-21'), null);
  assert.equal(dailyGameHostForDate('02026-11-21'), null);
  assert.equal(dailyGameHostForDate({}), null);
  assert.equal(dailyGameHostForDate([]), null);
  assert.equal(dailyGameHostForDate(true), null);
  assert.equal(dailyGameHostForDate('2026-11-21'), 'wick');
  assert.equal(dailyGameHostForDate('2026-12-21'), dailyGameHostForDate('2026-11-21'));
});

test('buildDailyGameLine rejects no-args, empty prompt, undefined format, String object, and formats unicode', () => {
  assert.equal(buildDailyGameLine(), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'word', prompt: '' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: undefined, prompt: 'x' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: new String('x') } }), null);
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'story', prompt: 'Café — "quoted" ✓' } }),
    'Today\u0027s game \u2014 Story chain: Café — "quoted" ✓'
  );
});

test('isDailyGamePosted handles empty/whitespace prompts, non-objects, word substrings, split lines, and doubles', () => {
  assert.equal(isDailyGamePosted({ promptBook: [{ body: 'x' }], dailyGame: { prompt: '' } }), false);
  assert.equal(isDailyGamePosted({ promptBook: [{ body: 'x' }], dailyGame: { prompt: '   ' } }), false);
  assert.equal(isDailyGamePosted({ promptBook: [{ body: 'x' }], dailyGame: null }), false);
  assert.equal(isDailyGamePosted({ promptBook: [{ body: 'x' }], dailyGame: 'string' }), false);
  assert.equal(isDailyGamePosted({ promptBook: [{ body: 'keyboard' }], dailyGame: { prompt: 'key' } }), true);
  assert.equal(
    isDailyGamePosted({ promptBook: [{ body: 'What has' }, { body: 'keys?' }], dailyGame: { prompt: 'What has keys?' } }),
    false
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ body: 'What has keys? What has keys?' }],
      dailyGame: { prompt: 'What has keys?' },
    }),
    true
  );
});

test('games-file validation rejects non-string/missing/bare-string/null/BOM/dir and accepts trailing newlines', async () => {
  const cases = [
    { name: 'non-string-prompt', content: JSON.stringify([{ format: 'riddle', prompt: 42 }]), expected: undefined },
    { name: 'bare-string-entry', content: JSON.stringify(['x']), expected: undefined },
    { name: 'missing-prompt', content: JSON.stringify([{ format: 'riddle' }]), expected: undefined },
    { name: 'top-level-null', content: 'null', expected: undefined },
    { name: 'utf8-bom', content: '\uFEFF' + JSON.stringify([{ format: 'riddle', prompt: 'BOM game' }]), expected: undefined },
    { name: 'trailing-newlines', content: JSON.stringify([{ format: 'riddle', prompt: 'Trailing game' }]) + '\n\n', expected: 'Trailing game' },
    { name: 'directory-path', isDir: true, expected: undefined },
  ];

  for (const c of cases) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ghostlight-dg-val-${c.name}-`));
    const gamesPath = path.join(tmpDir, c.isDir ? 'games-dir' : 'games.json');
    try {
      if (c.isDir) {
        fs.mkdirSync(gamesPath);
      } else {
        fs.writeFileSync(gamesPath, c.content, 'utf8');
      }
      const ctx = await startTestServer({ gamesPath });
      try {
        const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
        assert.equal(res.status, 200, `${c.name}: expected 200`);
        if (c.expected === undefined) {
          assert.equal(res.data.daily_game, undefined, `${c.name}: expected daily_game undefined`);
        } else {
          assert.equal(res.data.daily_game?.prompt, c.expected, `${c.name}: expected prompt`);
        }
      } finally {
        await ctx.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
});

test('dailyGameHostForDate agrees with served daily_game.date across 3 consecutive days', async () => {
  const baseNow = Math.floor(Date.UTC(2026, 10, 21, 12, 0, 0) / 1000);
  const ctx = await startTestServer({ baseNow });
  try {
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl });
    const hosts = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) ctx.advanceClock(DAY_SEC);
      const res = await client.state();
      assert.equal(res.status, 200);
      hosts.push(dailyGameHostForDate(res.data.daily_game.date));
    }
    assert.deepEqual(hosts, ['wick', 'maren', 'tomas']);
  } finally {
    await ctx.close();
  }
});

test('real daily-games.json wraps from index 29 on 2026-12-02 to index 0 on 2026-12-03', async () => {
  const games = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));
  const baseNow = Math.floor(Date.UTC(2026, 11, 2, 12, 0, 0) / 1000);
  const ctx = await startTestServer({ baseNow });
  try {
    const client = new GhostlightClient({ baseUrl: ctx.baseUrl });

    const res1 = await client.state();
    assert.equal(res1.status, 200);
    const expected1 = expectedGameForNow(games, ctx.nowSec());
    assert.equal(res1.data.daily_game.date, '2026-12-02');
    assert.equal(res1.data.daily_game.prompt, expected1.game.prompt);
    assert.equal(res1.data.daily_game.prompt, 'Milo hung a new sign on the gate. It read... Continue it in one line.');
    assert.equal(res1.data.daily_game.format, 'story');

    ctx.advanceClock(DAY_SEC);
    const res2 = await client.state();
    assert.equal(res2.status, 200);
    const expected2 = expectedGameForNow(games, ctx.nowSec());
    assert.equal(res2.data.daily_game.date, '2026-12-03');
    assert.equal(res2.data.daily_game.prompt, expected2.game.prompt);
    assert.equal(res2.data.daily_game.prompt, 'I have keys but open no locks. I have space but no room. What am I?');
    assert.equal(res2.data.daily_game.format, 'riddle');
  } finally {
    await ctx.close();
  }
});

test('bad games/topics files omit daily_game and nightly_call keys entirely from state body', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-dg-omit-'));
  const badGamesPath = path.join(tmpDir, 'bad-games.json');
  const badTopicsPath = path.join(tmpDir, 'bad-topics.json');
  try {
    fs.writeFileSync(badGamesPath, '{not valid json', 'utf8');
    fs.writeFileSync(badTopicsPath, '{not valid json', 'utf8');

    const ctxBoth = await startTestServer({ gamesPath: badGamesPath, topicsPath: badTopicsPath });
    try {
      const resA = await new GhostlightClient({ baseUrl: ctxBoth.baseUrl }).state();
      assert.equal(resA.status, 200);
      assert.equal('daily_game' in resA.data, false);
      assert.equal('nightly_call' in resA.data, false);
    } finally {
      await ctxBoth.close();
    }

    const ctxGamesOnly = await startTestServer({ gamesPath: badGamesPath });
    try {
      const resB = await new GhostlightClient({ baseUrl: ctxGamesOnly.baseUrl }).state();
      assert.equal(resB.status, 200);
      assert.equal('daily_game' in resB.data, false);
      assert.equal('nightly_call' in resB.data, true);
    } finally {
      await ctxGamesOnly.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('prompt-length validation uses UTF-16 code units (80 emoji ok, 161 e-acute and 161 emoji rejected)', async () => {
  const cases = [
    { name: '80-emoji', prompt: '🎲'.repeat(80), serves: true },
    { name: '161-eacute', prompt: 'é'.repeat(161), serves: false },
    { name: '161-emoji', prompt: '🎲'.repeat(161), serves: false },
  ];

  for (const c of cases) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ghostlight-dg-len-${c.name}-`));
    const gamesPath = path.join(tmpDir, 'games.json');
    try {
      fs.writeFileSync(gamesPath, JSON.stringify([{ format: 'riddle', prompt: c.prompt }]), 'utf8');
      const ctx = await startTestServer({ gamesPath });
      try {
        const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
        assert.equal(res.status, 200, `${c.name}: expected 200`);
        if (c.serves) {
          assert.equal(res.data.daily_game?.prompt, c.prompt);
        } else {
          assert.equal(res.data.daily_game, undefined);
        }
      } finally {
        await ctx.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
});

test('server tolerates duplicate prompts in games file while rotating formats', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-dg-dup-'));
  const gamesPath = path.join(tmpDir, 'games.json');
  try {
    fs.writeFileSync(
      gamesPath,
      JSON.stringify([
        { format: 'riddle', prompt: 'Same game twice' },
        { format: 'word', prompt: 'Same game twice' },
      ]),
      'utf8'
    );
    const baseNow = Math.floor(Date.UTC(2026, 10, 21, 12, 0, 0) / 1000);
    const ctx = await startTestServer({ gamesPath, baseNow });
    try {
      const client = new GhostlightClient({ baseUrl: ctx.baseUrl });
      const res1 = await client.state();
      assert.equal(res1.status, 200);
      assert.equal(res1.data.daily_game.prompt, 'Same game twice');
      assert.equal(res1.data.daily_game.format, 'riddle');

      ctx.advanceClock(DAY_SEC);
      const res2 = await client.state();
      assert.equal(res2.status, 200);
      assert.equal(res2.data.daily_game.prompt, 'Same game twice');
      assert.equal(res2.data.daily_game.format, 'word');
    } finally {
      await ctx.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('dailyGameHostForDate maintains 3-cycle continuity across day-before-anchor and year boundary', () => {
  assert.equal(dailyGameHostForDate('2026-11-20'), 'tomas');
  const dec31 = dailyGameHostForDate('2026-12-31');
  const jan01 = dailyGameHostForDate('2027-01-01');
  assert.notEqual(dec31, null);
  assert.notEqual(jan01, null);
  assert.equal(dec31, 'maren');
  assert.equal(jan01, 'tomas');
});

test('FORMAT_LABELS pins the exact label for each game format', () => {
  assert.deepEqual(FORMAT_LABELS, {
    riddle: 'Riddle',
    word: 'Word game',
    story: 'Story chain',
  });
  assert.equal(new Set(Object.values(FORMAT_LABELS)).size, 3);

  const riddleLine = buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 'What has keys but opens no locks?' } });
  const wordLine = buildDailyGameLine({ dailyGame: { format: 'word', prompt: 'Name a word that\u2026' } });
  const storyLine = buildDailyGameLine({ dailyGame: { format: 'story', prompt: 'Once upon a\u2026' } });

  assert.equal(riddleLine, 'Today\u0027s game \u2014 Riddle: What has keys but opens no locks?');
  assert.equal(wordLine, 'Today\u0027s game \u2014 Word game: Name a word that\u2026');
  assert.equal(storyLine, 'Today\u0027s game \u2014 Story chain: Once upon a\u2026');
  assert.ok(riddleLine.includes(`${FORMAT_LABELS.riddle}: `));
  assert.ok(wordLine.includes(`${FORMAT_LABELS.word}: `));
  assert.ok(storyLine.includes(`${FORMAT_LABELS.story}: `));
});

test('real daily-games.json serves exact prompts for 2026-11-22 through 2026-11-26', async () => {
  const games = JSON.parse(fs.readFileSync(GAMES_PATH, 'utf8'));
  const cases = [
    {
      y: 2026,
      m: 11,
      d: 22,
      date: '2026-11-22',
      idx: 19,
      format: 'word',
      prompt: 'Last-letter lake: name something that lives near water, starting with the last letter of the previous answer. I start: minnow.',
    },
    {
      y: 2026,
      m: 11,
      d: 23,
      date: '2026-11-23',
      idx: 20,
      format: 'story',
      prompt: 'Under the floorboards of the newsstand, someone had hidden... Continue it in one line.',
    },
    {
      y: 2026,
      m: 11,
      d: 24,
      date: '2026-11-24',
      idx: 21,
      format: 'riddle',
      prompt: 'What gets wetter the more it dries?',
    },
    {
      y: 2026,
      m: 11,
      d: 25,
      date: '2026-11-25',
      idx: 22,
      format: 'word',
      prompt: 'Opposite day: what is the opposite of lantern-light?',
    },
    {
      y: 2026,
      m: 11,
      d: 26,
      date: '2026-11-26',
      idx: 23,
      format: 'story',
      prompt: 'The town woke to find every cottage had swapped... Continue it in one line.',
    },
  ];

  for (const c of cases) {
    const expected = expectedGameForNow(games, Date.UTC(c.y, c.m - 1, c.d, 12, 0, 0) / 1000);
    const idx = ((expected.dayNumber % games.length) + games.length) % games.length;
    assert.equal(expected.date, c.date);
    assert.equal(idx, c.idx);
    assert.equal(expected.game.format, c.format);
    assert.equal(expected.game.prompt, c.prompt);
  }

  const baseNow = Math.floor(Date.UTC(2026, 10, 25, 12, 0, 0) / 1000);
  const ctx = await startTestServer({ baseNow });
  try {
    const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
    assert.equal(res.status, 200);
    assert.equal(res.data.daily_game.date, '2026-11-25');
    assert.equal(res.data.daily_game.format, 'word');
    assert.equal(res.data.daily_game.prompt, 'Opposite day: what is the opposite of lantern-light?');
  } finally {
    await ctx.close();
  }
});

test('short games file rotates by negative dayNumber before the epoch', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-dg-neg-'));
  const gamesPath = path.join(tmpDir, 'games.json');
  try {
    fs.writeFileSync(
      gamesPath,
      JSON.stringify([
        { format: 'riddle', prompt: 'First game prompt' },
        { format: 'word', prompt: 'Second game prompt' },
      ]),
      'utf8'
    );

    const cases = [
      { y: 1969, m: 12, d: 31, date: '1969-12-31', prompt: 'Second game prompt' },
      { y: 1969, m: 12, d: 30, date: '1969-12-30', prompt: 'First game prompt' },
      { y: 1969, m: 12, d: 29, date: '1969-12-29', prompt: 'Second game prompt' },
    ];

    for (const c of cases) {
      const baseNow = Math.floor(Date.UTC(c.y, c.m - 1, c.d, 12, 0, 0) / 1000);
      const ctx = await startTestServer({ gamesPath, baseNow });
      try {
        const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
        assert.equal(res.status, 200);
        assert.equal(res.data.daily_game.date, c.date);
        assert.equal(res.data.daily_game.prompt, c.prompt);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('non-string gamesPath omits daily_game softly without failing state', async () => {
  for (const gamesPath of [42, null]) {
    const ctx = await startTestServer({ gamesPath });
    try {
      const res = await new GhostlightClient({ baseUrl: ctx.baseUrl }).state();
      assert.equal(res.status, 200);
      assert.equal(res.data.daily_game, undefined);
      assert.ok(res.data.nightly_call);
    } finally {
      await ctx.close();
    }
  }
});

test('daily game host rejects year 0-99 dates and non-leap February 29', () => {
  assert.equal(dailyGameHostForDate('0000-01-01'), null);
  assert.equal(dailyGameHostForDate('0099-06-15'), null);
  assert.equal(dailyGameHostForDate('0100-01-01'), 'maren');
  assert.equal(dailyGameHostForDate('2026-02-29'), null);
  assert.equal(dailyGameHostForDate('2027-02-29'), null);
});

test('buildDailyGameLine does not enforce the 160-char server cap', () => {
  const longRiddle = 'x'.repeat(161);
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: longRiddle } }),
    `Today's game \u2014 Riddle: ${longRiddle}`
  );
  const longWord = 'y'.repeat(1000);
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'word', prompt: longWord } }),
    `Today's game \u2014 Word game: ${longWord}`
  );
});

test('isDailyGamePosted ignores prompt book entries without a string body', () => {
  const junk = [{}, { body: undefined }, 42, 'string', null, { body: 42 }];
  assert.equal(
    isDailyGamePosted({ promptBook: junk, dailyGame: { prompt: 'What has keys?' } }),
    false
  );
  assert.equal(
    isDailyGamePosted({
      promptBook: [...junk, { body: 'Say What has keys? now' }],
      dailyGame: { prompt: 'What has keys?' },
    }),
    true
  );
  assert.equal(
    isDailyGamePosted({ promptBook: [{}], dailyGame: { prompt: 'x' } }),
    false
  );
});

test('isDailyGamePosted matches prompts literally, not as regex', () => {
  assert.equal(
    isDailyGamePosted({ promptBook: [{ body: 'axxb' }], dailyGame: { prompt: 'a.*b' } }),
    false
  );
  assert.equal(
    isDailyGamePosted({ promptBook: [{ body: 'the a.*b pattern' }], dailyGame: { prompt: 'a.*b' } }),
    true
  );
  assert.equal(
    isDailyGamePosted({ promptBook: [{ body: 'Say: What (is) this? ok' }], dailyGame: { prompt: 'What (is) this?' } }),
    true
  );
  assert.equal(
    isDailyGamePosted({ promptBook: [{ body: '$^' }], dailyGame: { prompt: '$^' } }),
    true
  );
  assert.equal(
    isDailyGamePosted({ promptBook: [{ body: 'aXb' }], dailyGame: { prompt: 'a.b' } }),
    false
  );
});

test('daily game host shifts by two over a 365-day year while the game cycle differs', async () => {
  assert.equal(dailyGameHostForDate('2027-11-21'), 'tomas');
  assert.equal(dailyGameHostForDate('2027-11-22'), 'wick');
  assert.equal(dailyGameHostForDate('2027-11-23'), 'maren');

  const ctx2026 = await startTestServer({ baseNow: Math.floor(Date.UTC(2026, 10, 21, 12, 0, 0) / 1000) });
  let prompt2026;
  try {
    const res = await new GhostlightClient({ baseUrl: ctx2026.baseUrl }).state();
    assert.equal(res.status, 200);
    prompt2026 = res.data.daily_game.prompt;
    assert.equal(
      prompt2026,
      'I run but never walk. I have a mouth but never talk. I have a bed but never sleep. What am I?'
    );
  } finally {
    await ctx2026.close();
  }

  const ctx2027 = await startTestServer({ baseNow: Math.floor(Date.UTC(2027, 10, 21, 12, 0, 0) / 1000) });
  let prompt2027;
  try {
    const res = await new GhostlightClient({ baseUrl: ctx2027.baseUrl }).state();
    assert.equal(res.status, 200);
    prompt2027 = res.data.daily_game.prompt;
    assert.equal(res.data.daily_game.date, '2027-11-21');
    assert.equal(
      prompt2027,
      'The town woke to find every cottage had swapped... Continue it in one line.'
    );
  } finally {
    await ctx2027.close();
  }

  assert.notEqual(prompt2026, prompt2027);
});

test('file hygiene: 47 unique names, 9 imports, pinned as-true counts', () => {
  const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const lines = src.split('\n');

  const names = [];
  for (const line of lines) {
    const m = line.match(/^test\('([^']+)'/);
    if (m) names.push(m[1]);
  }
  assert.equal(names.length, 47);
  assert.equal(new Set(names).size, 47);

  assert.equal(lines.filter((l) => l.startsWith('import ')).length, 9);
  assert.deepEqual(lines.slice(3, 9), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
  ]);
  assert.deepEqual(lines.slice(10, 13), [
    "import { createTownServer } from './server.mjs';",
    "import { GhostlightClient, generateKeypair } from './ghostlight-client.mjs';",
    "import { dailyGameHostForDate, buildDailyGameLine, isDailyGamePosted, FORMAT_LABELS } from '../town-npc/daily-game.mjs';",
  ]);

  assert.equal(lines.filter((l) => l.toLowerCase().includes('camp' + 'fire')).length, 0);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(lines.filter((l) => new RegExp('Date' + '.now').test(l)).length, 2);
  assert.equal(lines.filter((l) => new RegExp('Math' + '.random').test(l)).length, 0);
  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 0);
});
