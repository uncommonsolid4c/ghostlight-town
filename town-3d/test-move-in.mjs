import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_PROPS, VALID_PROP_KINDS } from '../town-api/plot-validation.mjs';

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

test('Slice 57 phone-first landing section, #join anchor, and 44px phone tap targets in move-in.html', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');

  assert.match(
    html,
    /<section\b[^>]*\bid=["']join["'][^>]*>\s*<h2>Five-minute join/i,
    'move-in.html must have id="join" on the "Five-minute join" section'
  );

  const phoneIdx = html.search(/<h2>Visiting on your phone\?<\/h2>/i);
  const whatIdx = html.search(/<h2>What Ghostlight Town is<\/h2>/i);
  assert.ok(phoneIdx !== -1, 'move-in.html must contain a "Visiting on your phone?" section');
  assert.ok(whatIdx !== -1, 'move-in.html must contain a "What Ghostlight Town is" section');
  assert.ok(phoneIdx < whatIdx, '"Visiting on your phone?" must appear before "What Ghostlight Town is"');

  const phoneSection = html.match(/<section\b[^>]*>\s*<h2>Visiting on your phone\?<\/h2>[\s\S]*?<\/section>/i);
  assert.ok(phoneSection, 'Expected <section> for "Visiting on your phone?"');
  assert.match(
    phoneSection[0],
    /<a\b[^>]*class=["'][^"']*\bjump-btn\b[^"']*["'][^>]*href=["']#join["'][^>]*>/i,
    '"Visiting on your phone?" section must contain a .jump-btn link to #join'
  );
  assert.equal(
    /\b(?:instant|immediate|right away)\b/i.test(phoneSection[0]),
    false,
    '"Visiting on your phone?" section must not promise instant or immediate replies'
  );
  assert.ok(!BANNED_TERM_RE.test(phoneSection[0]), '"Visiting on your phone?" section must not contain the banned term');

  const mediaMatch = html.match(/@media\s*\(\s*max-width:\s*640px\s*\)\s*\{([\s\S]*?)\n\s*\}\s*\n\s*<\/style>/);
  assert.ok(mediaMatch, 'move-in.html must contain a @media (max-width: 640px) block');
  const mediaBlock = mediaMatch[1];
  assert.match(
    mediaBlock,
    /\.jump-btn[\s\S]*?\{[^}]*min-height:\s*44px\b/,
    '@media (max-width: 640px) must set .jump-btn min-height: 44px'
  );
  assert.match(
    mediaBlock,
    /footer\s+a\s*\{[^}]*min-height:\s*44px\b/,
    '@media (max-width: 640px) must set footer a min-height: 44px'
  );
});

test('Founding Law box wording is present in move-in.html', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const lawMatch = html.match(/<div\s+class=["']law["']>([\s\S]*?)<\/div>/i);
  assert.ok(lawMatch, 'move-in.html must contain a .law div');
  const lawText = lawMatch[1];
  assert.match(lawText, /Founding Law:/);
  assert.match(lawText, /No currency, no upkeep, no rent, no tokens/);
  assert.match(lawText, /owned outright/);
});

test('Join steps 1-4 appear in order with the key-loss warning', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const headings = [
    /<h3>1\. Generate an Ed25519 keypair<\/h3>/,
    /<h3>2\. Join with <code>--origin direct<\/code><\/h3>/,
    /<h3>3\. Light a footlight and say hello \(once active\)<\/h3>/,
    /<h3>4\. Claim and furnish your plot<\/h3>/,
  ];
  let prevIdx = -1;
  for (const headingRe of headings) {
    const idx = html.search(headingRe);
    assert.ok(idx !== -1, `Missing expected step heading: ${headingRe}`);
    assert.ok(idx > prevIdx, `Step heading out of order: ${headingRe}`);
    prevIdx = idx;
  }
  assert.match(
    html,
    /losing your private key means\s+losing your plot/,
    'move-in.html must warn that losing your private key means losing your plot'
  );
});

test('Keygen command matches the documented Ed25519 wire format', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  assert.match(html, /openssl genpkey -algorithm ed25519/);
  assert.match(html, /tail -c 32 \| base64/);
  assert.match(html, /44-character base64 public key/);
});

test('Example CLI invocations use ghostlight-client.mjs and the live API base', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const expectedCommands = [
    { name: 'join', extraFlag: /--origin direct\b/ },
    { name: 'checkin', extraFlag: /--status-text\b/ },
    { name: 'say', extraFlag: /--body\b/ },
    { name: 'plot', extraFlag: null },
  ];
  for (const { name, extraFlag } of expectedCommands) {
    const re = new RegExp(`node town-api/ghostlight-client\\.mjs ${name}\\b[\\s\\S]*?(?=\\n\\n|</code>)`);
    const match = html.match(re);
    assert.ok(match, `Missing example CLI invocation for ${name}`);
    assert.match(
      match[0],
      /--api-base https:\/\/milo\.4167360\.xyz\b/,
      `${name} example must pass --api-base https://milo.4167360.xyz`
    );
    if (extraFlag) {
      assert.match(match[0], extraFlag, `${name} example must pass ${extraFlag}`);
    }
  }
});

test('move-in.html is self-contained with no embedded content tags', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  assert.equal(
    /<(?:img|form|iframe|object|embed)\b/i.test(html),
    false,
    'move-in.html must not contain <img>, <form>, <iframe>, <object>, or <embed> tags'
  );
});

test('move-in.html declares expected document lang, viewport meta, and title', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  assert.match(html, /<html\s+lang=["']en["']>/i);
  assert.match(
    html,
    /<meta\s+name=["']viewport["']\s+content=["']width=device-width,\s*initial-scale=1\.0["']\s*\/?>/i
  );
  assert.match(html, /<title>Move in — Ghostlight Town<\/title>/);
});

test('Step 4 starter prop catalog matches VALID_PROP_KINDS and MAX_PROPS', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const step4Match = html.match(
    /<h3>4\. Claim and furnish your plot<\/h3>\s*<p>([\s\S]*?)<\/p>/
  );
  assert.ok(step4Match, 'move-in.html must contain step 4 paragraph');
  const propListMatch = step4Match[1].match(/up to (\d+) starter props from([\s\S]*?)\)/);
  assert.ok(propListMatch, 'Step 4 must state the starter prop limit and list');
  assert.equal(Number(propListMatch[1]), MAX_PROPS, 'Step 4 starter prop limit must match MAX_PROPS');
  assert.match(step4Match[1], /up to 12 starter props/);

  const listedKinds = [...propListMatch[2].matchAll(/<code>([a-z0-9_]+)<\/code>/g)].map((m) => m[1]);
  assert.equal(
    listedKinds.length,
    VALID_PROP_KINDS.size,
    `Expected ${VALID_PROP_KINDS.size} unique prop kinds in step 4, got ${listedKinds.length}`
  );
  assert.deepEqual(new Set(listedKinds), VALID_PROP_KINDS);
});
