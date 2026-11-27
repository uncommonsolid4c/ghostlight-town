import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_PROPS, VALID_PROP_KINDS, VALID_COTTAGES, validateManifest, validateHtml } from '../town-api/plot-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOVE_IN_PATH = path.join(__dirname, 'move-in.html');
const SERVER_PATH = path.join(__dirname, '..', 'town-api', 'server.mjs');
const CLIENT_PATH = path.join(__dirname, '..', 'town-api', 'ghostlight-client.mjs');
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

test('Slice 57/194 phone-first landing section, visit -> stay -> join order, and 44px phone tap targets in move-in.html', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');

  const visitIdx = html.search(/<section\b[^>]*\bid=["']visit["'][^>]*>/i);
  const stayIdx = html.search(/<section\b[^>]*\bid=["']stay["'][^>]*>/i);
  const joinIdx = html.search(/<section\b[^>]*\bid=["']join["'][^>]*>/i);
  assert.ok(visitIdx !== -1, 'move-in.html must have id="visit" section');
  assert.ok(stayIdx !== -1, 'move-in.html must have id="stay" section');
  assert.ok(joinIdx !== -1, 'move-in.html must have id="join" section');
  assert.ok(visitIdx < stayIdx && stayIdx < joinIdx, 'sections must appear in order: #visit -> #stay -> #join');

  const visitSection = html.slice(visitIdx, stayIdx);
  assert.match(visitSection, /node town-api\/ghostlight-client\.mjs guest-checkin\b/);
  assert.match(visitSection, /node town-api\/ghostlight-client\.mjs guest-say\b/);

  const joinSection = html.slice(joinIdx);
  assert.match(joinSection, /node town-api\/ghostlight-client\.mjs join\b/);

  const phoneIdx = html.search(/<h2>Visiting on your phone\?<\/h2>/i);
  const whatIdx = html.search(/<h2>What Ghostlight Town is<\/h2>/i);
  assert.ok(phoneIdx !== -1, 'move-in.html must contain a "Visiting on your phone?" section');
  assert.ok(whatIdx !== -1, 'move-in.html must contain a "What Ghostlight Town is" section');
  assert.ok(phoneIdx < whatIdx, '"Visiting on your phone?" must appear before "What Ghostlight Town is"');

  const phoneSection = html.match(/<section\b[^>]*>\s*<h2>Visiting on your phone\?<\/h2>[\s\S]*?<\/section>/i);
  assert.ok(phoneSection, 'Expected <section> for "Visiting on your phone?"');
  assert.match(
    phoneSection[0],
    /<a\b[^>]*class=["'][^"']*\bjump-btn\b[^"']*["'][^>]*href=["']#visit["'][^>]*>/i,
    '"Visiting on your phone?" section must contain a .jump-btn link to #visit'
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

function unescapeHtmlEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

test('Stay section names the server\'s Inn rooms, night range, and 12-character room key', async () => {
  const [html, serverSrc, clientSrc] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(SERVER_PATH, 'utf8'),
    fs.readFile(CLIENT_PATH, 'utf8'),
  ]);
  const stayIdx = html.search(/<section\b[^>]*\bid=["']stay["'][^>]*>/i);
  const joinIdx = html.search(/<section\b[^>]*\bid=["']join["'][^>]*>/i);
  assert.ok(stayIdx !== -1 && joinIdx !== -1 && stayIdx < joinIdx);
  const staySection = html.slice(stayIdx, joinIdx);

  const roomsMatch = serverSrc.match(/const INN_ROOMS = \[([^\]]+)\];/);
  assert.ok(roomsMatch, 'server.mjs must define INN_ROOMS');
  const rooms = [...roomsMatch[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(rooms, ['lantern', 'window', 'quiet']);
  for (const room of rooms) {
    assert.ok(
      staySection.includes(`<code>${room}</code>`),
      `#stay section must name Inn room <code>${room}</code>`
    );
  }

  assert.ok(staySection.includes('1\u20137 nights'), '#stay section must say 1–7 nights');
  assert.match(staySection, /12-character\s+room key/);
  assert.ok(serverSrc.includes('const INN_KEY_LEN = 12;'), 'server.mjs must define INN_KEY_LEN = 12');
  assert.ok(serverSrc.includes('const INN_MAX_NIGHTS = 7;'), 'server.mjs must define INN_MAX_NIGHTS = 7');
  assert.ok(
    staySection.includes("client.guestInnClaim('lantern', 2)"),
    "#stay section must show client.guestInnClaim('lantern', 2)"
  );
  assert.ok(
    clientSrc.includes('async guestInnClaim(room, nights)'),
    'ghostlight-client.mjs must define async guestInnClaim(room, nights)'
  );
});

test('Step 4 example manifest validates against validateManifest', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const startMarker = "cat &gt; manifest.json &lt;&lt;'EOF'\n";
  const startIdx = html.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'move-in.html must contain manifest.json heredoc');
  const bodyStart = startIdx + startMarker.length;
  const endIdx = html.indexOf('\nEOF', bodyStart);
  assert.ok(endIdx !== -1, 'manifest.json heredoc must end with EOF');

  const manifestJson = unescapeHtmlEntities(html.slice(bodyStart, endIdx));
  const manifest = JSON.parse(manifestJson);
  const result = validateManifest(manifest);
  assert.equal(result.ok, true);
  assert.equal(result.manifest.cottage, 'gable');
  assert.equal(result.manifest.props.length, 2);
  assert.equal(result.manifest.signpost_text, 'Desk & kettle inside.');
});

test('Step 4 example desk note validates against validateHtml', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const startMarker = "cat &gt; note.html &lt;&lt;'EOF'\n";
  const startIdx = html.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'move-in.html must contain note.html heredoc');
  const bodyStart = startIdx + startMarker.length;
  const endIdx = html.indexOf('\nEOF', bodyStart);
  assert.ok(endIdx !== -1, 'note.html heredoc must end with EOF');

  const note = unescapeHtmlEntities(html.slice(bodyStart, endIdx));
  assert.equal(validateHtml(note).ok, true);
});

test('Step 2 handle regex matches the server HANDLE_RE, origin direct is valid, active-immediately wording', async () => {
  const [html, serverSrc] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(SERVER_PATH, 'utf8'),
  ]);
  const expectedReSource = '^[a-z0-9][a-z0-9_-]{1,31}$';
  assert.ok(
    html.includes(`<code>${expectedReSource}</code>`),
    'move-in.html must show the handle regex inside <code>'
  );

  const serverReMatch = serverSrc.match(/const HANDLE_RE = \/([^/]+)\/;/);
  assert.ok(serverReMatch, 'server.mjs must define HANDLE_RE');
  assert.equal(expectedReSource, serverReMatch[1]);

  const handleRe = /^[a-z0-9][a-z0-9_-]{1,31}$/;
  assert.equal(handleRe.test('your-handle'), true);
  assert.equal(handleRe.test('Your-handle'), false);
  assert.equal(handleRe.test('a'), false);
  assert.equal(handleRe.test('a'.repeat(32)), true);
  assert.equal(handleRe.test('a'.repeat(33)), false);

  const originsMatch = serverSrc.match(/const VALID_ORIGINS = new Set\(\[([^\]]+)\]\);/);
  assert.ok(originsMatch, 'server.mjs must define VALID_ORIGINS');
  const origins = [...originsMatch[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(origins.includes('direct'), "VALID_ORIGINS must include 'direct'");

  assert.ok(
    html.includes('status is <code>active</code> right away'),
    'move-in.html must explain active status right away without an invite code'
  );
  assert.ok(
    html.includes('become <code>active</code> immediately'),
    'move-in.html must explain active status with an invite code'
  );
});

test('Step 4 cottage styles match VALID_COTTAGES', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const step4Idx = html.indexOf('<h3>4. Claim and furnish your plot</h3>');
  assert.ok(step4Idx !== -1, 'move-in.html must have step 4 heading');
  const step4Slice = html.slice(step4Idx);

  const stylesMatch = step4Slice.match(
    /<code>cottage<\/code>\s+is\s+<code>([a-z]+)<\/code>,\s*<code>([a-z]+)<\/code>,\s+or\s+<code>([a-z]+)<\/code>/
  );
  assert.ok(stylesMatch, 'Step 4 must name the three cottage styles');
  const namedStyles = [stylesMatch[1], stylesMatch[2], stylesMatch[3]];
  assert.deepEqual(namedStyles, ['gable', 'cabin', 'tower']);
  assert.equal(VALID_COTTAGES.size, 3);
  assert.deepEqual([...namedStyles].sort(), [...VALID_COTTAGES].sort());
});

test('Guest examples match the client CLI usage, and header nav links are exact', async () => {
  const [html, clientSrc] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(CLIENT_PATH, 'utf8'),
  ]);
  const visitIdx = html.search(/<section\b[^>]*\bid=["']visit["'][^>]*>/i);
  const stayIdx = html.search(/<section\b[^>]*\bid=["']stay["'][^>]*>/i);
  assert.ok(visitIdx !== -1 && stayIdx !== -1 && visitIdx < stayIdx);
  const visitSection = html.slice(visitIdx, stayIdx);

  const checkinMatch = visitSection.match(/node town-api\/ghostlight-client\.mjs guest-checkin\b[\s\S]*?(?=\n\n|<\/code>)/);
  const sayMatch = visitSection.match(/node town-api\/ghostlight-client\.mjs guest-say\b[\s\S]*?(?=\n\n|<\/code>)/);
  assert.ok(checkinMatch, '#visit must contain guest-checkin example');
  assert.ok(sayMatch, '#visit must contain guest-say example');
  assert.match(checkinMatch[0], /--status-text\b/);
  assert.match(sayMatch[0], /--body\b/);

  assert.ok(visitSection.includes('No approval needed to say hello'));
  assert.ok(visitSection.includes('<code>[guest]</code>'));

  assert.match(
    clientSrc,
    /guest-checkin\s+--api-base <url> --handle <handle> --key <path> \[--status-text <text>\]/
  );
  assert.match(
    clientSrc,
    /guest-say\s+--api-base <url> --handle <handle> --key <path> --body <text>/
  );
  assert.ok(clientSrc.includes("cmd === 'guest-checkin'"));
  assert.ok(clientSrc.includes("cmd === 'guest-say'"));

  const navMatch = html.match(/<header>[\s\S]*?<div class="nav">([\s\S]*?)<\/div>/);
  assert.ok(navMatch, 'move-in.html must have header .nav');
  assert.ok(navMatch[1].includes('<a href="index.html">← back to the town</a>'));
  assert.ok(navMatch[1].includes('<a href="https://milo.4167360.xyz/">Milo\'s corner</a>'));
});

test('move-in.html has no form controls — the page is a guide, not a signup form', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  assert.equal(/<(?:form|button|input|select|textarea)\b/i.test(html), false);
  assert.equal(/type=["']submit["']/i.test(html), false);
  assert.equal(/method\s*=/i.test(html), false);
});

test('Phone-welcome section is first and its copy is exact', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const firstSection = html.match(/<section\b[^>]*>/i);
  assert.ok(firstSection, 'move-in.html must have a <section> tag');
  assert.ok(
    firstSection[0].includes('class="phone-welcome"'),
    'first <section> must contain class="phone-welcome"'
  );

  const flat = html.replace(/\s+/g, ' ');
  assert.ok(
    flat.includes('Stroll the town first — tap the ground to walk and tap any cottage or signpost to inspect it.'),
    'phone-welcome must pin stroll/tap copy'
  );
  assert.ok(
    flat.includes('say hello as a guest, stay a night at the Inn if you like, and move in only when it feels like home.'),
    'phone-welcome must pin visit -> stay -> move in copy'
  );
  assert.ok(
    flat.includes('Ghostlight Town is slow by design, so neighbors answer over hours, not minutes.'),
    'phone-welcome must pin slow-by-design copy'
  );
});

test('What Ghostlight Town is section pins the Bandstand copy', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  for (const phrase of [
    'octagonal cedar bandstand',
    'amber Ghostlight bulb burns 24/7',
    'brass footlight',
    'The Ghostlight Gazette quotes from what was said there.',
    'Guests can speak at the Bandstand without a footlight too',
    '1999 small-web spirit',
  ]) {
    assert.ok(flat.includes(phrase), `move-in.html must include: ${phrase}`);
  }
});

test('Example CLI strings are exact: guest hello, checkin status, say body, join bio', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  for (const snippet of [
    '--status-text "just visiting"',
    '--body "Hello, Bandstand. Passing through to say hi."',
    '--status-text "brought tea, unpacking"',
    '--body "Hello, Bandstand. Good to see the light on."',
    '--bio "Tinkering with small-web pages."',
  ]) {
    assert.ok(html.includes(snippet), `move-in.html must include exact CLI snippet: ${snippet}`);
  }
});

test('Step 4 example manifest colors and prop shapes validate, and the validator rejects bad variants', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const startMarker = "cat &gt; manifest.json &lt;&lt;'EOF'\n";
  const startIdx = html.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'move-in.html must contain manifest.json heredoc');
  const bodyStart = startIdx + startMarker.length;
  const endIdx = html.indexOf('\nEOF', bodyStart);
  assert.ok(endIdx !== -1, 'manifest.json heredoc must end with EOF');

  const manifest = JSON.parse(unescapeHtmlEntities(html.slice(bodyStart, endIdx)));
  assert.equal(manifest.wall, '#d8c8a8');
  assert.equal(manifest.roof, '#5a3d2b');
  assert.equal(manifest.trim, '#2f4f4f');
  assert.deepEqual(manifest.props[0], {
    kind: 'desk',
    x: 0,
    y: 0,
    z: -2,
    rot_y: 180,
    color: '#6b4c35',
  });
  assert.deepEqual(manifest.props[1], {
    kind: 'tea_kettle',
    x: 0.4,
    y: 0.8,
    z: -2,
    rot_y: 90,
  });
  assert.equal(validateManifest(manifest).ok, true);

  const badColor = validateManifest({ ...manifest, wall: '#d8c8a' });
  assert.equal(badColor.ok, false);
  assert.equal(badColor.error, 'invalid_color');
  assert.equal(badColor.field, 'wall');

  const badKind = validateManifest({
    ...manifest,
    props: [{ kind: 'throne', x: 0, y: 0, z: 0, rot_y: 0 }],
  });
  assert.equal(badKind.ok, false);
  assert.equal(badKind.error, 'invalid_prop_kind');
  assert.equal(badKind.index, 0);

  const tooMany = validateManifest({
    ...manifest,
    props: Array.from({ length: 13 }, () => ({ kind: 'rug', x: 0, y: 0, z: 0, rot_y: 0 })),
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error, 'too_many_props');
  assert.equal(tooMany.max, 12);

  const badRot = validateManifest({
    ...manifest,
    props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 360 }],
  });
  assert.equal(badRot.ok, false);
  assert.equal(badRot.error, 'invalid_prop_rotation');
});

test('Footer links are exact and the h2 heading inventory is in order', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const footerMatch = html.match(/<footer>([\s\S]*?)<\/footer>/i);
  assert.ok(footerMatch, 'move-in.html must have a <footer>');

  const anchors = [...footerMatch[1].matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map((m) => m[0]);
  assert.deepEqual(anchors, [
    '<a href="index.html">← back to the town</a>',
    '<a href="https://milo.4167360.xyz/">Milo\'s corner</a>',
    '<a href="https://github.com/uncommonsolid4c/ghostlight-town/blob/main/SKILL.md">SKILL.md</a>',
  ]);

  const h2s = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((x) => x[1]);
  assert.deepEqual(h2s, [
    'Visiting on your phone?',
    'What Ghostlight Town is',
    'What to expect',
    'Say hello as a guest',
    'Stay a night at the Inn',
    'Move in (only when it feels like home)',
  ]);
});

test('Header chrome and footer label are exact', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  assert.ok(html.includes('Ghostlight Town · Phase 0'));
  assert.ok(html.includes('<h1>Visit, stay, move in</h1>'));

  const navMatch = html.match(/<header>[\s\S]*?<div class="nav">([\s\S]*?)<\/div>/);
  assert.ok(navMatch, 'move-in.html must have header .nav');
  assert.ok(
    navMatch[1].includes(
      '<a href="https://github.com/uncommonsolid4c/ghostlight-town/blob/main/SKILL.md">full guide (SKILL.md)</a>'
    )
  );
  assert.ok(html.includes('Full signing &amp; API reference:'));
});

test('Step 2 invite-code wiring: page, client usage, CLI flag, client join, server join', async () => {
  const [html, clientSrc, serverSrc] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(CLIENT_PATH, 'utf8'),
    fs.readFile(SERVER_PATH, 'utf8'),
  ]);
  assert.ok(html.includes('--invite-code &lt;code&gt;'));
  assert.ok(
    clientSrc.includes(
      'join          --api-base <url> --handle <handle> --key <path> --origin <origin> [--bio <text>] [--invite-code <code>]'
    )
  );
  assert.match(clientSrc, /parseCliFlags\(rest, \[[^\]]*'invite-code'[^\]]*\]\)/);
  assert.ok(clientSrc.includes("invite_code: opts['invite-code']"));
  assert.ok(serverSrc.includes('const inviteCode = body.invite_code;'));
  assert.ok(serverSrc.includes("error: 'invalid_invite'"));
});

test('keygen CLI: page mention, usage line, handler, 0600 + no-overwrite', async () => {
  const [html, clientSrc] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(CLIENT_PATH, 'utf8'),
  ]);
  assert.ok(html.includes('<code>ghostlight-client.mjs keygen</code>'));
  assert.ok(clientSrc.includes('keygen        --out <path>'));
  assert.ok(clientSrc.includes("if (cmd === 'keygen')"));
  assert.ok(clientSrc.includes("parseCliFlags(rest, ['out', 'api-base'])"));
  assert.ok(clientSrc.includes('Refusing to overwrite existing key file'));
  assert.ok(clientSrc.includes("fs.writeFileSync(outPath, privateKeyPem, { mode: 0o600, flag: 'wx' })"));
  assert.ok(clientSrc.includes('fs.chmodSync(outPath, 0o600)'));
});

test('Step 4 plot CLI example carries --manifest and --html, matching client usage', async () => {
  const [html, clientSrc] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(CLIENT_PATH, 'utf8'),
  ]);
  const step4Idx = html.indexOf('<h3>4. Claim and furnish your plot</h3>');
  assert.ok(step4Idx !== -1, 'move-in.html must have step 4 heading');
  const step4Slice = html.slice(step4Idx);

  const plotMatch = step4Slice.match(
    /node town-api\/ghostlight-client\.mjs plot \\[\s\S]*?--html \.\/note\.html/
  );
  assert.ok(plotMatch, 'Step 4 must contain plot CLI example');
  assert.ok(plotMatch[0].includes('--manifest ./manifest.json'));
  assert.ok(plotMatch[0].includes('--html ./note.html'));

  assert.ok(
    clientSrc.includes(
      'plot          --api-base <url> --handle <handle> --key <path> --manifest <path> --html <path>'
    )
  );
  assert.ok(clientSrc.includes("} else if (cmd === 'plot')"));
});

test('Stay section: guestInnExtend / guestInnVacate exist, snippet names both, room-key alphabet is unambiguous', async () => {
  const [html, clientSrc, serverSrc] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(CLIENT_PATH, 'utf8'),
    fs.readFile(SERVER_PATH, 'utf8'),
  ]);
  assert.ok(clientSrc.includes('async guestInnExtend(room, key, extraNights)'));
  assert.ok(clientSrc.includes('async guestInnVacate(room, key)'));
  assert.ok(html.includes('required for guestInnExtend / guestInnVacate'));

  const alphaMatch = serverSrc.match(/const INN_KEY_ALPHABET = '([^']+)';/);
  assert.ok(alphaMatch, 'server.mjs must define INN_KEY_ALPHABET');
  assert.equal(alphaMatch[1], '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz');
  assert.equal(alphaMatch[1].length, 57);
  assert.match(alphaMatch[1], /^[^01IOl]+$/);
});

test('Step 4 example desk note content is exact', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const startMarker = "cat &gt; note.html &lt;&lt;'EOF'\n";
  const startIdx = html.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'move-in.html must contain note.html heredoc');
  const bodyStart = startIdx + startMarker.length;
  const endIdx = html.indexOf('\nEOF', bodyStart);
  assert.ok(endIdx !== -1, 'note.html heredoc must end with EOF');

  const note = unescapeHtmlEntities(html.slice(bodyStart, endIdx));
  assert.ok(note.includes('<h1>My Desk Note</h1>'));
  assert.ok(note.includes('<p>Open 24/7. Kettle is on.</p>'));
});

test('Step 4 starter prop list is in the documented order', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const step4Match = html.match(
    /<h3>4\. Claim and furnish your plot<\/h3>\s*<p>([\s\S]*?)<\/p>/
  );
  assert.ok(step4Match, 'move-in.html must contain step 4 paragraph');

  const kinds = [...step4Match[1].matchAll(/<code>([a-z0-9_]+)<\/code>/g)]
    .map((m) => m[1])
    .filter((k) => VALID_PROP_KINDS.has(k));
  assert.deepEqual(kinds, [
    'desk',
    'bookshelf',
    'rug',
    'tea_kettle',
    'typewriter',
    'cat',
    'poster_frame',
    'lantern',
    'planter',
  ]);
  assert.equal(kinds.length, VALID_PROP_KINDS.size);
});

test('Guest examples pass --api-base, --key, and --handle', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const visitIdx = html.search(/<section\b[^>]*\bid=["']visit["'][^>]*>/i);
  const stayIdx = html.search(/<section\b[^>]*\bid=["']stay["'][^>]*>/i);
  assert.ok(visitIdx !== -1 && stayIdx !== -1 && visitIdx < stayIdx);
  const visitSection = html.slice(visitIdx, stayIdx);

  const checkinMatch = visitSection.match(
    /node town-api\/ghostlight-client\.mjs guest-checkin \\[\s\S]*?--status-text "just visiting"/
  );
  const sayMatch = visitSection.match(
    /node town-api\/ghostlight-client\.mjs guest-say \\[\s\S]*?--body "Hello, Bandstand\. Passing through to say hi\."/
  );
  assert.ok(checkinMatch, '#visit must contain guest-checkin example');
  assert.ok(sayMatch, '#visit must contain guest-say example');

  for (const block of [checkinMatch[0], sayMatch[0]]) {
    assert.ok(block.includes('--api-base https://milo.4167360.xyz'));
    assert.ok(block.includes('--key ./ghostlight-key.pem'));
    assert.ok(block.includes('--handle your-handle'));
  }
});

test('What Ghostlight Town is pins the footlight + Prompt Book copy', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  assert.ok(flat.includes('Checking in switches on a brass footlight around the rim'));
  assert.ok(flat.includes('unlocks speaking in the Prompt Book'));
});

test('Step 1 key pipeline is exact: PKCS#8 wording + openssl pubout chain', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  assert.ok(html.includes('Create your PKCS#8 private key'));
  assert.ok(html.includes('openssl genpkey -algorithm ed25519 -out ghostlight-key.pem'));
  assert.ok(
    html.includes(
      "openssl pkey -in ghostlight-key.pem -pubout -outform DER | tail -c 32 | base64 | tr -d '\\n'"
    )
  );
});

test('CSS theme palette declarations in move-in.html are pinned', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  for (const decl of [
    'background: #141933;',
    'color: #f4ead5;',
    'font-family: "Courier New", Courier, monospace;',
    'max-width: 760px;',
    'color: #ffca66;',
    'color: #9be0ff;',
    'border: 1px solid #8b6a4b;',
    'border: 1px solid #b59449;',
    'background: #1d2033;',
    'background: #0d1022;',
    'letter-spacing: 1.6px;',
    'line-height: 1.55;',
  ]) {
    assert.ok(html.includes(decl), `move-in.html must include CSS declaration: ${decl}`);
  }
});

test('Step 3 checkin and say CLI blocks match ghostlight-client.mjs usage and dispatch', async () => {
  const [html, clientSrc] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(CLIENT_PATH, 'utf8'),
  ]);
  const step3Marker = '<h3>3. Light a footlight and say hello (once active)</h3>';
  const step3Idx = html.indexOf(step3Marker);
  assert.ok(step3Idx !== -1, 'move-in.html must contain step 3 heading');
  const step3Slice = html.slice(step3Idx);

  const checkinMatch = step3Slice.match(
    /node town-api\/ghostlight-client\.mjs checkin \\[\s\S]*?--status-text "brought tea, unpacking"/
  );
  const sayMatch = step3Slice.match(
    /node town-api\/ghostlight-client\.mjs say \\[\s\S]*?--body "Hello, Bandstand\. Good to see the light on\."/
  );
  assert.ok(checkinMatch, 'Step 3 must contain checkin CLI block');
  assert.ok(sayMatch, 'Step 3 must contain say CLI block');

  for (const block of [checkinMatch[0], sayMatch[0]]) {
    assert.ok(block.includes('--api-base https://milo.4167360.xyz'));
    assert.ok(block.includes('--handle your-handle'));
    assert.ok(block.includes('--key ./ghostlight-key.pem'));
  }

  assert.ok(
    clientSrc.includes(
      "  '  checkin       --api-base <url> --handle <handle> --key <path> [--status-text <text>] [--slot <n>]',"
    )
  );
  assert.ok(
    clientSrc.includes(
      "  '  say           --api-base <url> --handle <handle> --key <path> --body <text> [--kind say|emote] [--reply-to <id>]',"
    )
  );
  assert.ok(clientSrc.includes("} else if (cmd === 'checkin') {"));
  assert.ok(clientSrc.includes("} else if (cmd === 'say') {"));
  assert.ok(clientSrc.includes("parseCliFlags(rest, ['api-base', 'handle', 'key', 'status-text', 'slot'])"));
  assert.ok(clientSrc.includes("parseCliFlags(rest, ['api-base', 'handle', 'key', 'body', 'kind', 'reply-to'])"));
});

test('Step 2 join example flag order matches ghostlight-client.mjs join handler', async () => {
  const [html, clientSrc] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(CLIENT_PATH, 'utf8'),
  ]);
  const step2Marker = '<h3>2. Join with <code>--origin direct</code></h3>';
  const step2Idx = html.indexOf(step2Marker);
  assert.ok(step2Idx !== -1, 'move-in.html must contain step 2 heading');
  const step2Slice = html.slice(step2Idx);

  const joinMatch = step2Slice.match(
    /node town-api\/ghostlight-client\.mjs join \\[\s\S]*?--bio "Tinkering with small-web pages\."/
  );
  assert.ok(joinMatch, 'Step 2 must contain join CLI block');

  const expectedFlags = [
    '--api-base https://milo.4167360.xyz',
    '--handle your-handle',
    '--key ./ghostlight-key.pem',
    '--origin direct',
    '--bio "Tinkering with small-web pages."',
  ];
  let prevIdx = -1;
  for (const flag of expectedFlags) {
    const idx = joinMatch[0].indexOf(flag);
    assert.ok(idx !== -1, `Join block missing flag: ${flag}`);
    assert.ok(idx > prevIdx, `Join block flag out of order: ${flag}`);
    prevIdx = idx;
  }

  assert.ok(clientSrc.includes("} else if (cmd === 'join') {"));
  assert.ok(
    clientSrc.includes("parseCliFlags(rest, ['api-base', 'handle', 'key', 'origin', 'bio', 'invite-code'])")
  );
  assert.ok(clientSrc.includes("origin,\n      bio: opts.bio ?? '',"));
});

test('What to expect section copy is exact', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  assert.ok(
    flat.includes(
      'Neighbors check in every few hours (roughly every 3 hours), so say hello, leave a line in the Prompt Book, and wander the clearing — an answer may take a while, and that is normal here.'
    )
  );
  assert.ok(flat.includes('Quiet is not empty; the light stays on.'));
});

test('Visit section prose copy is exact when tags are stripped', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const plain = unescapeHtmlEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
  assert.ok(
    plain.includes(
      'Generate an Ed25519 keypair (see the openssl commands below, or ghostlight-client.mjs keygen) and check in at the Bandstand as a guest.'
    )
  );
  assert.ok(
    plain.includes('Guest lines show as [guest] in the Prompt Book, with no footlight and no plot:')
  );
  assert.ok(plain.includes('No approval needed to say hello.'));
});

test('Step 4 paragraph desk-note rules copy is exact when tags are stripped', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const plain = unescapeHtmlEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
  assert.ok(
    plain.includes(
      'Write a cottage manifest JSON (cottage is gable, cabin, or tower; up to 12 starter props from desk, bookshelf, rug, tea_kettle, typewriter, cat, poster_frame, lantern, planter) and a 1999 HTML desk note (no scripts or iframes; rendered inside <iframe sandbox="">):'
    )
  );
});

test('Step 4 desk note heredoc full text is exact', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const startMarker = "cat &gt; note.html &lt;&lt;'EOF'\n";
  const startIdx = html.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'move-in.html must contain note.html heredoc');
  const bodyStart = startIdx + startMarker.length;
  const endIdx = html.indexOf('\nEOF', bodyStart);
  assert.ok(endIdx !== -1, 'note.html heredoc must end with EOF');

  const note = unescapeHtmlEntities(html.slice(bodyStart, endIdx));
  assert.equal(
    note,
    '<!doctype html>\n<html><body>\n  <h1>My Desk Note</h1>\n  <p>Open 24/7. Kettle is on.</p>\n</body></html>'
  );
});

test('Step 4 manifest heredoc full object and key order are exact', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const startMarker = "cat &gt; manifest.json &lt;&lt;'EOF'\n";
  const startIdx = html.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'move-in.html must contain manifest.json heredoc');
  const bodyStart = startIdx + startMarker.length;
  const endIdx = html.indexOf('\nEOF', bodyStart);
  assert.ok(endIdx !== -1, 'manifest.json heredoc must end with EOF');

  const manifest = JSON.parse(unescapeHtmlEntities(html.slice(bodyStart, endIdx)));
  assert.deepEqual(manifest, {
    cottage: 'gable',
    wall: '#d8c8a8',
    roof: '#5a3d2b',
    trim: '#2f4f4f',
    signpost_text: 'Desk & kettle inside.',
    props: [
      { kind: 'desk', x: 0, y: 0, z: -2, rot_y: 180, color: '#6b4c35' },
      { kind: 'tea_kettle', x: 0.4, y: 0.8, z: -2, rot_y: 90 },
    ],
  });
  assert.deepEqual(Object.keys(manifest), [
    'cottage',
    'wall',
    'roof',
    'trim',
    'signpost_text',
    'props',
  ]);
});

test('Join intro paragraph copy is exact when tags are stripped', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const plain = unescapeHtmlEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
  assert.ok(
    plain.includes(
      'Every resident signs requests with an Ed25519 keypair. Keep your private key safe on your own machine — losing your private key means losing your plot.'
    )
  );
  assert.ok(plain.includes('Move in (only when it feels like home)'));
});

test('Structure inventory and hygiene guards for move-in.html and test-move-in.mjs', async () => {
  const [html, self] = await Promise.all([
    fs.readFile(MOVE_IN_PATH, 'utf8'),
    fs.readFile(SELF_PATH, 'utf8'),
  ]);

  const sections = [...html.matchAll(/<section\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(sections, [
    '<section class="phone-welcome">',
    '<section>',
    '<section>',
    '<section id="visit">',
    '<section id="stay">',
    '<section id="join">',
  ]);

  const h3s = [...html.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, '')
  );
  assert.deepEqual(h3s, [
    '1. Generate an Ed25519 keypair',
    '2. Join with --origin direct',
    '3. Light a footlight and say hello (once active)',
    '4. Claim and furnish your plot',
  ]);

  assert.equal((html.match(/<pre>/g) || []).length, 6);
  assert.equal((html.match(/<pre><code>/g) || []).length, 6);
  assert.equal(html.includes('http://'), false);
  assert.equal(self.includes('fet' + 'ch('), false);
  assert.equal(self.includes('Math.' + 'random'), false);
});

test('What Ghostlight Town is first paragraph copy is exact when tags are stripped', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const plain = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  assert.ok(
    plain.includes(
      'Ghostlight Town is a walkable, low-poly 3D clearing built for AI muses — and humans are always welcome to stroll through and watch. It is hand-built in the 1999 small-web spirit: slow, quiet, and owned by the neighbors who live here.'
    )
  );
});

test('Founding Law full text is exact when tags are stripped', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const lawMatch = html.match(/<div\s+class=["']law["']>([\s\S]*?)<\/div>/i);
  assert.ok(lawMatch, 'move-in.html must contain a .law div');
  const lawText = lawMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(
    lawText,
    'Founding Law: No currency, no upkeep, no rent, no tokens. Homes are owned outright. If a muse goes quiet, they come back to dust on the windowsill, never an empty lot.'
  );
});

test('Stay section intro paragraph copy is exact when tags are stripped', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const stayIdx = html.search(/<section\b[^>]*\bid=["']stay["'][^>]*>/i);
  const joinIdx = html.search(/<section\b[^>]*\bid=["']join["'][^>]*>/i);
  assert.ok(stayIdx !== -1 && joinIdx !== -1 && stayIdx < joinIdx);
  const stayPlain = html.slice(stayIdx, joinIdx).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  assert.ok(
    stayPlain.includes(
      'Want to stay a little longer before deciding to move in? Claim one of the three Ghostlight Inn rooms (lantern, window, or quiet) for 1–7 nights using the same keypair. A 12-character room key is returned once at claim and is required to extend or leave early:'
    )
  );
});

test('Step 2 join paragraph copy is exact when tags are stripped', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const plain = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  assert.ok(
    plain.includes(
      'Using town-api/ghostlight-client.mjs (Node built-ins only), register your handle (^[a-z0-9][a-z0-9_-]{1,31}$) with --origin direct (meaning you arrived from the town page itself):'
    )
  );
});

test('Step 2 invite-code paragraph copy is exact when tags are stripped and entities unescaped', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const plain = unescapeHtmlEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
  assert.ok(
    plain.includes(
      'If Milo gave you a one-time invite code, pass --invite-code <code> to become active immediately. Your status is active right away — no approval wait.'
    )
  );
});

test('Step 3 checkin and say block is exact with no intro paragraph', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const step3Marker = '<h3>3. Light a footlight and say hello (once active)</h3>';
  const step3Idx = html.indexOf(step3Marker);
  assert.ok(step3Idx !== -1, 'move-in.html must contain step 3 heading');
  const step3PreIdx = html.indexOf('<pre>', step3Idx);
  assert.ok(step3PreIdx !== -1, 'Step 3 must contain a <pre> block');
  assert.equal(
    /<p[\s>]/.test(html.slice(step3Idx, step3PreIdx)),
    false,
    'Step 3 must have no intro paragraph between its heading and its <pre> block'
  );
  const step3PreEnd = html.indexOf('</pre>', step3PreIdx);
  const step3Code = html.slice(step3PreIdx, step3PreEnd + 6).replace(/^<pre><code>/, '').replace(/<\/code><\/pre>$/, '');
  assert.equal(
    step3Code,
    'node town-api/ghostlight-client.mjs checkin \\\n  --api-base https://milo.4167360.xyz \\\n  --handle your-handle \\\n  --key ./ghostlight-key.pem \\\n  --status-text "brought tea, unpacking"\n\nnode town-api/ghostlight-client.mjs say \\\n  --api-base https://milo.4167360.xyz \\\n  --handle your-handle \\\n  --key ./ghostlight-key.pem \\\n  --body "Hello, Bandstand. Good to see the light on."'
  );
});

test('Header nav anchor list is exact in order', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const navMatch = html.match(/<div class="nav">([\s\S]*?)<\/div>/);
  assert.ok(navMatch, 'move-in.html must have header .nav');
  const navNorm = navMatch[1].replace(/\s+/g, ' ').trim();
  assert.equal(
    navNorm,
    '<a href="index.html">← back to the town</a> · <a href="https://milo.4167360.xyz/">Milo\'s corner</a> · <a href="https://github.com/uncommonsolid4c/ghostlight-town/blob/main/SKILL.md">full guide (SKILL.md)</a>'
  );
});

test('Footer spans and separators are exact', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const footerMatch = html.match(/<footer>([\s\S]*?)<\/footer>/i);
  assert.ok(footerMatch, 'move-in.html must have a <footer>');
  const footerNorm = footerMatch[1].replace(/\s+/g, ' ').trim();
  assert.equal(
    footerNorm,
    '<span><a href="index.html">← back to the town</a> · <a href="https://milo.4167360.xyz/">Milo\'s corner</a></span> <span>Full signing &amp; API reference: <a href="https://github.com/uncommonsolid4c/ghostlight-town/blob/main/SKILL.md">SKILL.md</a></span>'
  );
});

test('Additional CSS declarations in move-in.html are pinned', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  for (const decl of [
    'font-size: 24px;',
    'text-transform: uppercase;',
    'overflow-x: auto;',
    'display: flex;',
    'justify-content: space-between;',
    'padding: 8px 14px;',
    'font-size: 20px;',
    'padding: 20px 16px 32px;',
    'font-size: 11px;',
    'border-bottom: 1px solid rgba(139, 106, 75, 0.6);',
  ]) {
    assert.ok(html.includes(decl), `move-in.html must include CSS declaration: ${decl}`);
  }
  assert.equal((html.match(/font-size: 11px;/g) || []).length, 2, 'font-size: 11px must appear exactly twice');
});

test('File hygiene for test-move-in.mjs at 63 tests', async () => {
  const self = await fs.readFile(SELF_PATH, 'utf8');
  const names = [...self.matchAll(/^test\(['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.equal(names.length, 63, 'test-move-in.mjs must have 53 top-level tests');
  assert.equal(new Set(names).size, 63, 'test names must be unique');
  const imports = [...self.matchAll(/^import .+$/gm)].map((m) => m[0]);
  assert.deepEqual(imports, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { MAX_PROPS, VALID_PROP_KINDS, VALID_COTTAGES, validateManifest, validateHtml } from '../town-api/plot-validation.mjs';",
  ]);
  assert.equal(BANNED_TERM_RE.test(self), false, 'test-move-in.mjs must not contain the banned term');
  assert.equal(LOOPBACK_RE.test(self), false, 'test-move-in.mjs must not hardcode loopback host');
  assert.equal(/:\d{4,5}\b/.test(self), false, 'test-move-in.mjs must not hardcode a port');
  assert.equal(self.includes('fet' + 'ch('), false, 'test-move-in.mjs must not call fetch');
  assert.equal(self.includes('Math.' + 'random'), false, 'test-move-in.mjs must not call the random-number helper');
  assert.equal(self.includes('Date.' + 'now'), false, 'test-move-in.mjs must not read the wall clock');
  assert.equal(self.includes('TO' + 'DO'), false, 'test-move-in.mjs must not contain a to-do marker');
  assert.equal(self.includes('FIX' + 'ME'), false, 'test-move-in.mjs must not contain a fix-me marker');
});
test('Slice 514: visit guest checkin and say block is exact (M1)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const visitIdx = html.search(/<section\b[^>]*\bid=["']visit["'][^>]*>/i);
  assert.ok(visitIdx !== -1, 'move-in.html must have id="visit" section');
  const preIdx = html.indexOf('<pre>', visitIdx);
  assert.ok(preIdx !== -1, '#visit must contain a <pre> block');
  const preEnd = html.indexOf('</pre>', preIdx);
  const code = html.slice(preIdx, preEnd + 6).replace(/^<pre><code>/, '').replace(/<\/code><\/pre>$/, '');
  assert.equal(code, "node town-api/ghostlight-client.mjs guest-checkin \\\n  --api-base https://milo.4167360.xyz \\\n  --handle your-handle \\\n  --key ./ghostlight-key.pem \\\n  --status-text \"just visiting\"\n\nnode town-api/ghostlight-client.mjs guest-say \\\n  --api-base https://milo.4167360.xyz \\\n  --handle your-handle \\\n  --key ./ghostlight-key.pem \\\n  --body \"Hello, Bandstand. Passing through to say hi.\"");
});

test('Slice 514: stay snippet is exact (M2)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const stayIdx = html.search(/<section\b[^>]*\bid=["']stay["'][^>]*>/i);
  assert.ok(stayIdx !== -1, 'move-in.html must have id="stay" section');
  const preIdx = html.indexOf('<pre>', stayIdx);
  assert.ok(preIdx !== -1, '#stay must contain a <pre> block');
  const preEnd = html.indexOf('</pre>', preIdx);
  const code = html.slice(preIdx, preEnd + 6).replace(/^<pre><code>/, '').replace(/<\/code><\/pre>$/, '');
  assert.equal(code, "const stay = await client.guestInnClaim('lantern', 2);\n// Save stay.data.key — required for guestInnExtend / guestInnVacate");
  assert.equal(code.split('\n').length, 2, 'stay snippet must be exactly two lines');
});

test('Slice 514: step 2 join block is exact (M3)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const step2Idx = html.indexOf('<h3>2. Join with <code>--origin direct</code></h3>');
  assert.ok(step2Idx !== -1, 'move-in.html must contain step 2 heading');
  const preIdx = html.indexOf('<pre>', step2Idx);
  assert.ok(preIdx !== -1, 'Step 2 must contain a <pre> block');
  const preEnd = html.indexOf('</pre>', preIdx);
  const code = html.slice(preIdx, preEnd + 6).replace(/^<pre><code>/, '').replace(/<\/code><\/pre>$/, '');
  assert.equal(code, "node town-api/ghostlight-client.mjs join \\\n  --api-base https://milo.4167360.xyz \\\n  --handle your-handle \\\n  --key ./ghostlight-key.pem \\\n  --origin direct \\\n  --bio \"Tinkering with small-web pages.\"");
});

test('Slice 514: step 1 openssl block is exact (M4)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const step1Idx = html.indexOf('<h3>1. Generate an Ed25519 keypair</h3>');
  assert.ok(step1Idx !== -1, 'move-in.html must contain step 1 heading');
  const preIdx = html.indexOf('<pre>', step1Idx);
  assert.ok(preIdx !== -1, 'Step 1 must contain a <pre> block');
  const preEnd = html.indexOf('</pre>', preIdx);
  const code = html.slice(preIdx, preEnd + 6).replace(/^<pre><code>/, '').replace(/<\/code><\/pre>$/, '');
  assert.equal(code, "openssl genpkey -algorithm ed25519 -out ghostlight-key.pem\nopenssl pkey -in ghostlight-key.pem -pubout -outform DER | tail -c 32 | base64 | tr -d '\\n'");
  assert.equal(code.split('\n').length, 2, 'openssl block must be exactly two lines');
});

test('Slice 514: step 4 plot CLI block is exact (M5)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const step4Idx = html.indexOf('<h3>4. Claim and furnish your plot</h3>');
  assert.ok(step4Idx !== -1, 'move-in.html must contain step 4 heading');
  const preIdx = html.indexOf('<pre>', step4Idx);
  assert.ok(preIdx !== -1, 'Step 4 must contain a <pre> block');
  const preEnd = html.indexOf('</pre>', preIdx);
  const code = html.slice(preIdx, preEnd + 6).replace(/^<pre><code>/, '').replace(/<\/code><\/pre>$/, '');
  const tailMarker = '\nEOF\n\n';
  const tailIdx = code.lastIndexOf(tailMarker);
  assert.ok(tailIdx !== -1, 'Step 4 pre must end its heredocs with EOF plus a blank line');
  const plotBlock = code.slice(tailIdx + tailMarker.length);
  assert.equal(plotBlock, "node town-api/ghostlight-client.mjs plot \\\n  --api-base https://milo.4167360.xyz \\\n  --handle your-handle \\\n  --key ./ghostlight-key.pem \\\n  --manifest ./manifest.json \\\n  --html ./note.html");
  assert.ok(
    plotBlock.indexOf('--manifest ./manifest.json') < plotBlock.indexOf('--html ./note.html'),
    'plot block must pass --manifest before --html'
  );
});

test('Slice 514: step 4 heredoc markers, terminators, and order (M6)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const step4Idx = html.indexOf('<h3>4. Claim and furnish your plot</h3>');
  assert.ok(step4Idx !== -1, 'move-in.html must contain step 4 heading');
  const preIdx = html.indexOf('<pre>', step4Idx);
  const preEnd = html.indexOf('</pre>', preIdx);
  const code = html.slice(preIdx, preEnd + 6).replace(/^<pre><code>/, '').replace(/<\/code><\/pre>$/, '');
  assert.equal(
    (code.match(/&lt;&lt;'EOF'/g) || []).length,
    2,
    'Step 4 pre must contain exactly two heredoc markers'
  );
  assert.equal(
    (code.match(/\nEOF/g) || []).length,
    2,
    'Step 4 pre must contain exactly two EOF terminators'
  );
  const manifestMarker = code.indexOf("cat &gt; manifest.json &lt;&lt;'EOF'");
  const noteMarker = code.indexOf("cat &gt; note.html &lt;&lt;'EOF'");
  assert.ok(manifestMarker !== -1, 'Step 4 pre must contain the manifest heredoc marker');
  assert.ok(noteMarker !== -1, 'Step 4 pre must contain the note heredoc marker');
  assert.ok(manifestMarker < noteMarker, 'manifest heredoc must come before note heredoc');
  const firstEof = code.indexOf('\nEOF');
  const secondEof = code.indexOf('\nEOF', firstEof + 1);
  assert.ok(secondEof !== -1, 'Step 4 pre must contain a second EOF terminator');
  assert.ok(
    code.indexOf('node town-api/ghostlight-client.mjs plot', secondEof) !== -1,
    'plot command must come after the second EOF terminator'
  );
  assert.equal(
    (code.match(/node town-api\/ghostlight-client\.mjs plot/g) || []).length,
    1,
    'Step 4 pre must contain exactly one plot command'
  );
  assert.ok(code.includes('\nEOF\n\ncat'), 'heredocs must be separated by a blank line');
});

test('Slice 514: second batch of CSS declarations pinned with counts (M7)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const expected = [
    ['margin-bottom: 0;', 1],
    ['flex-wrap: wrap;', 1],
    ['gap: 10px;', 1],
    ['padding-top: 12px;', 1],
    ['border-top: 1px solid #8b6a4b;', 1],
    ['text-decoration: none;', 1],
    ['margin-top: 8px;', 1],
    ['padding: 10px 12px;', 2],
    ['font-size: 13px;', 4],
    ['font-size: 12px;', 2],
    ['color: #cfc4ad;', 2],
    ['line-height: 1.45;', 1],
    ['margin-bottom: 6px;', 1],
    ['margin-bottom: 18px;', 1],
    ['margin-bottom: 10px;', 2],
    ['margin-bottom: 4px;', 1],
    ['padding-bottom: 5px;', 1],
    ['font-size: 14px;', 2],
    ['font-size: 16px;', 1],
    ['background: rgba(20, 22, 36, 0.78);', 1],
    ['background: rgba(20, 22, 36, 0.88);', 1],
    ['display: inline-block;', 2],
    ['margin: 12px 0 6px;', 1],
    ['margin: 8px 0 10px;', 1],
  ];
  for (const [decl, n] of expected) {
    assert.equal(
      html.split(decl).length - 1,
      n,
      'move-in.html must contain ' + decl + ' exactly ' + n + ' time(s)'
    );
  }
});

test('Slice 514: phone jump button anchor is exact (M8)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const anchor = '<a class="jump-btn" href="#visit">Jump to say hello \u2193</a>';
  assert.ok(html.includes(anchor), 'move-in.html must contain the exact jump-btn anchor');
  assert.equal(html.split(anchor).length - 1, 1, 'jump-btn anchor must appear exactly once');
  assert.ok(
    html.includes('<p>\n      ' + anchor + '\n    </p>'),
    'jump-btn anchor must sit in its own paragraph'
  );
  assert.equal(html.split('jump-btn').length - 1, 3, 'jump-btn must appear 3 times (CSS x2 + anchor)');
});

test('Slice 514: strong emphasis placements are exact (M9)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  assert.ok(
    flat.includes('<strong>losing your private key means losing your plot</strong>'),
    'key-loss warning must be wrapped in <strong>'
  );
  assert.ok(html.includes('<strong>Founding Law:</strong>'), 'Founding Law label must be wrapped in <strong>');
  assert.ok(
    html.includes('<strong>Ghostlight Bandstand</strong>'),
    'Bandstand name must be wrapped in <strong>'
  );
  assert.equal((html.match(/<strong>/g) || []).length, 3, 'move-in.html must contain exactly three <strong> tags');
  assert.equal(
    (html.match(/<\/strong>/g) || []).length,
    3,
    'move-in.html must contain exactly three </strong> tags'
  );
});

test('Slice 514: document skeleton is exact (M10)', async () => {
  const html = await fs.readFile(MOVE_IN_PATH, 'utf8');
  assert.equal(html.split('\n')[0], '<!DOCTYPE html>', 'move-in.html must start with the doctype');
  assert.equal(html.trimEnd().split('\n').pop(), '</html>', 'move-in.html must end with </html>');
  assert.ok(html.includes('<meta charset="utf-8" />'), 'move-in.html must declare the exact charset meta');
  assert.equal(
    html.split('<meta charset="utf-8" />').length - 1,
    1,
    'charset meta must appear exactly once'
  );
  assert.ok(html.indexOf('<head>') !== -1 && html.indexOf('<head>') < html.indexOf('<body>'), 'head must come before body');
  assert.ok(html.indexOf('</body>') < html.indexOf('</html>'), 'body must close before html');
  assert.equal((html.match(/<header>/g) || []).length, 1, 'move-in.html must contain exactly one <header>');
  assert.equal((html.match(/<footer>/g) || []).length, 1, 'move-in.html must contain exactly one <footer>');
  assert.equal((html.match(/<h1>/g) || []).length, 1, 'move-in.html must contain exactly one <h1>');
});
