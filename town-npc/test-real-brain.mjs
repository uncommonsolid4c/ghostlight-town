/**
 * Ghostlight Town — Real-Brain NPC Smoke Test (Slice 9)
 *
 * Gated behind GHOSTLIGHT_REAL_BRAIN=1 so the default test suite never hits the
 * live Gemini API or incurs the ~2-minute `agy` brain call.
 *
 * Run explicitly:
 *   GHOSTLIGHT_REAL_BRAIN=1 node town-npc/test-real-brain.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer } from '../town-api/server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from '../town-api/ghostlight-client.mjs';
import { ensureKeypair } from './keygen.mjs';
import { runTurn } from './run.mjs';
import { localDateString } from './stepback.mjs';

const REAL_BRAIN_ENABLED = process.env['GHOSTLIGHT_REAL_BRAIN'] === '1';

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-real-brain-api-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    operatorKeys,
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

test(
  'real-brain NPC smoke test: wick posts via live agy brain',
  {
    skip: REAL_BRAIN_ENABLED ? false : 'SKIP: set GHOSTLIGHT_REAL_BRAIN=1 to run live agy brain smoke test',
    timeout: 150_000,
  },
  async () => {
    delete process.env.NPC_BRAIN_CMD;

    const ctx = await startTestServer();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-real-brain-npc-'));

    try {
      const wickKeys = ensureKeypair({ handle: 'wick', stateDir });
      const wickClient = new GhostlightClient({
        baseUrl: ctx.baseUrl,
        handle: 'wick',
        privateKeyPem: wickKeys.privateKeyPem,
        pubkey: wickKeys.pubkey,
      });

      const joinRes = await wickClient.join({
        origin: 'colony',
        bio: 'Stagehand / Lamp-Trimmer',
      });
      assert.equal(joinRes.status, 201);

      const approveRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', {
        handle: 'wick',
        role: 'npc',
      });
      assert.equal(approveRes.status, 200);
      assert.equal(approveRes.data.role, 'npc');

      const result = await runTurn({
        npcHandle: 'wick',
        apiBase: ctx.baseUrl,
        stateDir,
        force: true,
      });

      assert.equal(result.ok, true);
      assert.equal(result.posted, true);

      const stateRes = await fetch(`${ctx.baseUrl}/api/town/state`);
      assert.equal(stateRes.status, 200);
      const townState = await stateRes.json();

      const wickLine = townState.prompt_book.find((l) => l.handle === 'wick' && l.role === 'npc');
      assert.ok(wickLine, 'posted line appears in prompt_book with handle wick and role npc');
      assert.equal(typeof wickLine.body, 'string');
      assert.ok(wickLine.body.trim().length > 0, 'posted line is non-empty');
      assert.ok(wickLine.body.length <= 500, `posted line <= 500 chars (got ${wickLine.body.length})`);

      const memoryPath = path.join(stateDir, 'wick', 'memory.md');
      assert.ok(fs.existsSync(memoryPath), 'wick/memory.md exists');
      const memoryBytes = fs.statSync(memoryPath).size;
      assert.ok(memoryBytes < 2048, `wick/memory.md < 2048 bytes (got ${memoryBytes})`);
      const memoryLines = fs.readFileSync(memoryPath, 'utf8').split('\n');
      const today = localDateString(Math.floor(Date.now() / 1000));
      assert.ok(
        memoryLines.some((l) => l.startsWith(today)),
        `wick/memory.md contains a line starting with ${today}`
      );

      const statePath = path.join(stateDir, 'wick', 'state.json');
      assert.ok(fs.existsSync(statePath), 'wick/state.json exists');
      const npcState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.ok(npcState.turns >= 1, `wick/state.json turns >= 1 (got ${npcState.turns})`);

      console.log(`WICK_POSTED_LINE: ${JSON.stringify(wickLine.body)}`);
    } finally {
      await ctx.close();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
);
