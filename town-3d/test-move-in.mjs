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

test('Step 2 handle regex matches the server HANDLE_RE, origin direct is valid, pending/active wording', async () => {
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
    html.includes('starts as <code>pending</code> until Milo approves'),
    'move-in.html must explain pending status without an invite code'
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
