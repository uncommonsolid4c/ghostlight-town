/**
 * Drift-guard test for GET /api/town/state top-level `events` and
 * `guestbook_by_plot` keys (Slice 114).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer } from './server.mjs';
import { generateKeypair } from './ghostlight-client.mjs';

test('GET /api/town/state always emits events {now, next} and guestbook_by_plot object even when events file is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-state-events-key-'));
  const missingEventsPath = path.join(tmpDir, 'does-not-exist-events.json');
  const operatorKeys = generateKeypair();

  const { server } = createTownServer({
    dbPath: path.join(tmpDir, 'town.db'),
    plotsDir: path.join(tmpDir, 'plots'),
    operatorPubkey: operatorKeys.pubkey,
    eventsPath: missingEventsPath,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/town/state`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(Object.hasOwn(body, 'events'), true);
    assert.equal(typeof body.events, 'object');
    assert.notEqual(body.events, null);
    assert.deepEqual(Object.keys(body.events).sort(), ['next', 'now']);
    assert.equal(body.events.now, null);
    assert.equal(body.events.next, null);

    assert.equal(Object.hasOwn(body, 'guestbook_by_plot'), true);
    assert.equal(typeof body.guestbook_by_plot, 'object');
    assert.notEqual(body.guestbook_by_plot, null);
    assert.equal(Array.isArray(body.guestbook_by_plot), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
