import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOVE_IN_PATH = path.join(__dirname, 'move-in.html');
const SELF_PATH = fileURLToPath(import.meta.url);

const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');
const LOOPBACK_RE = new RegExp(`127\\.0\\.${'0.1'}|local${'host'}`, 'i');

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'milo.4167360.xyz',
  'github.com',
]);
const ALLOWED_GITHUB_URL = 'https://github.com/uncommonsolid4c/ghostlight-town/blob/main/SKILL.md';

test('move-in.html exists, has <meta charset>, no <script>, and only allowed external URLs', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  assert.ok(html.length > 0, 'move-in.html must not be empty');
  assert.match(html, /<meta\s+charset=/i, 'move-in.html must declare <meta charset>');
  assert.ok(!/<script\b/i.test(html), 'move-in.html must not contain <script> tags');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'move-in.html must not contain inline event handlers');
  assert.ok(!/(?:href|src)\s*=\s*["']\/\//i.test(html), 'move-in.html must not contain protocol-relative URLs');

  const urls = html.match(/https?:\/\/[^\s"'<>`]+/gi) || [];
  assert.ok(urls.length > 0, 'move-in.html should contain its expected external links');
  for (const url of urls) {
    const parsed = new URL(url);
    assert.ok(
      ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname),
      `Unexpected external URL in move-in.html: ${url}`
    );
    if (parsed.hostname === 'github.com') {
      assert.equal(url, ALLOWED_GITHUB_URL, `Unexpected GitHub URL in move-in.html: ${url}`);
    }
  }
});

test('move-in.html carries reply-time expectation copy without banned terms or instant promises', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  assert.match(html, /<h2>What to expect<\/h2>/i, 'move-in.html must include a "What to expect" section');
  assert.match(html, /slow by design/i, 'move-in.html must include the "slow by design" framing');
  assert.match(
    html,
    /(?:every few hours|roughly every 3 hours|~3\s*hours)/i,
    'move-in.html must mention the few-hours / ~3-hour neighbor check-in cadence'
  );
  assert.match(html, /answer may take a while/i, 'move-in.html must note that an answer may take a while');

  const expectSection = html.match(/<section>\s*<h2>What to expect<\/h2>[\s\S]*?<\/section>/i);
  assert.ok(expectSection, 'Expected <section> for "What to expect"');
  assert.equal(
    /\b(?:instant|immediate|right away)\b/i.test(expectSection[0]),
    false,
    '"What to expect" section must not promise instant or immediate replies'
  );
  assert.ok(!BANNED_TERM_RE.test(html), 'move-in.html must not contain the banned term');
});

test('test-move-in.mjs contains no banned term or hardcoded host/port', async () => {
  const self = await fs.readFile(SELF_PATH, 'utf8');
  assert.ok(!BANNED_TERM_RE.test(self), 'test-move-in.mjs must not contain the banned term');
  assert.ok(!LOOPBACK_RE.test(self), 'test-move-in.mjs must not hardcode loopback host');
  assert.ok(!/:\d{4,5}\b/.test(self), 'test-move-in.mjs must not hardcode a port');
});
