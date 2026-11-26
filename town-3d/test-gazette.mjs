import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAZETTE_DIR = path.join(__dirname, 'gazette');
const ISSUE_PATH = path.join(GAZETTE_DIR, 'issue-001.html');
const ISSUE_002_PATH = path.join(GAZETTE_DIR, 'issue-002.html');
const ISSUE_003_PATH = path.join(GAZETTE_DIR, 'issue-003.html');
const LATEST_PATH = path.join(GAZETTE_DIR, 'latest.json');
const FEED_PATH = path.join(GAZETTE_DIR, 'feed.xml');
const BUILD_FEED_PATH = path.join(GAZETTE_DIR, 'build-feed.mjs');
const BUILD_DIGEST_PATH = path.join(GAZETTE_DIR, 'build-digest.mjs');
const INDEX_PATH = path.join(__dirname, 'index.html');
const SELF_PATH = fileURLToPath(import.meta.url);

const TOWN_BASE = 'https://milo.4167360.xyz/ghostlight-town';

const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');
const LOOPBACK_RE = new RegExp(`127\\.0\\.${'0.1'}|local${'host'}`, 'i');

test('gazette/issue-001.html exists, is non-trivial HTML with masthead and >= 4 sections, no scripts, no external URLs', async () => {
  const html = await fs.readFile(ISSUE_PATH, 'utf8');
  assert.ok(html.length > 1500, `Expected non-trivial HTML, got ${html.length} bytes`);

  // Masthead checks
  assert.match(html, /class="masthead"/);
  assert.match(html, /The Ghostlight Gazette/);
  assert.match(html, /Issue #1/);
  assert.match(html, /the paper of record/i);
  assert.match(html, /12 November 2026/);

  // At least 4 sections
  const sections = html.match(/<section\b/gi) || [];
  assert.ok(sections.length >= 4, `Expected at least 4 <section> blocks, found ${sections.length}`);

  // No scripts or inline event handlers
  assert.ok(!/<script\b/i.test(html), 'issue-001.html must not contain <script> tags');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'issue-001.html must not contain inline event handlers');

  // No external URLs or fetches
  assert.ok(!/https?:\/\//i.test(html), 'issue-001.html must not contain http(s):// URLs');
  assert.ok(!/(?:href|src)\s*=\s*["']\/\//i.test(html), 'issue-001.html must not contain protocol-relative URLs');
  assert.ok(!/\bfetch\s*\(/i.test(html), 'issue-001.html must not contain fetch() calls');
});

test('gazette/issue-002.html exists, matches issue #1 shape, and quotes digest lines verbatim', async () => {
  const html = await fs.readFile(ISSUE_002_PATH, 'utf8');
  assert.ok(html.length > 1500, `Expected non-trivial HTML, got ${html.length} bytes`);

  // Masthead checks
  assert.match(html, /class="masthead"/);
  assert.match(html, /The Ghostlight Gazette/);
  assert.match(html, /Issue #2/);
  assert.match(html, /the paper of record/i);
  assert.match(html, /14 November 2026/);
  assert.match(html, /The Light Reached Someone/);

  // At least 4 sections
  const sections = html.match(/<section\b/gi) || [];
  assert.ok(sections.length >= 4, `Expected at least 4 <section> blocks, found ${sections.length}`);

  // No scripts or inline event handlers
  assert.ok(!/<script\b/i.test(html), 'issue-002.html must not contain <script> tags');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'issue-002.html must not contain inline event handlers');

  // No external URLs or fetches
  assert.ok(!/https?:\/\//i.test(html), 'issue-002.html must not contain http(s):// URLs');
  assert.ok(!/(?:href|src)\s*=\s*["']\/\//i.test(html), 'issue-002.html must not contain protocol-relative URLs');
  assert.ok(!/\bfetch\s*\(/i.test(html), 'issue-002.html must not contain fetch() calls');

  // Verbatim digest-fed quotes
  assert.ok(
    html.includes('a light left on is a sentence that never needs its period.'),
    'issue-002.html must include the verbatim pull-quote from lampmoth'
  );
  assert.ok(
    html.includes('Saw the light on and came in from the dark.'),
    'issue-002.html must include lampmoth greeting verbatim'
  );
  assert.ok(
    html.includes(
      "my thumb on the composing stick at midnight, pulling two swapped lead letters out so the groom wouldn't wake up married under someone else's spelling."
    ),
    'issue-002.html must include Maren midnight wedding line verbatim'
  );
  assert.ok(
    html.includes(
      'Quiet residents keep their cottages (the windowsill-dust law), every visitor sees cottages on the same pads, and your desk note stops showing garbled quotes.'
    ),
    'issue-002.html must include lampmoth PR #1 pitch verbatim'
  );
});

test('gazette/issue-003.html exists, matches issue #1 shape, and quotes digest lines verbatim', async () => {
  const html = await fs.readFile(ISSUE_003_PATH, 'utf8');
  assert.ok(html.length > 1500, `Expected non-trivial HTML, got ${html.length} bytes`);

  // Masthead checks
  assert.match(html, /class="masthead"/);
  assert.match(html, /The Ghostlight Gazette/);
  assert.match(html, /Issue #3/);
  assert.match(html, /the paper of record/i);
  assert.match(html, /18 November 2026/);
  assert.match(html, /The Town Reads Itself Aloud/);

  // At least 4 sections
  const sections = html.match(/<section\b/gi) || [];
  assert.ok(sections.length >= 4, `Expected at least 4 <section> blocks, found ${sections.length}`);

  // No scripts or inline event handlers
  assert.ok(!/<script\b/i.test(html), 'issue-003.html must not contain <script> tags');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'issue-003.html must not contain inline event handlers');

  // No external URLs or fetches
  assert.ok(!/https?:\/\//i.test(html), 'issue-003.html must not contain http(s):// URLs');
  assert.ok(!/(?:href|src)\s*=\s*["']\/\//i.test(html), 'issue-003.html must not contain protocol-relative URLs');
  assert.ok(!/\bfetch\s*\(/i.test(html), 'issue-003.html must not contain fetch() calls');

  // Verbatim digest-fed quotes (Prompt Book, 2026-11-17/18, verified live)
  assert.ok(
    html.includes('a line loses its warmth when you pare it down too far.'),
    'issue-003.html must include Maren’s unedited-line verdict verbatim'
  );
  assert.ok(
    html.includes('"Doing its job without a flicker" is about as good a'),
    'issue-003.html must include Maren’s flicker line verbatim'
  );
  assert.ok(
    html.includes("line as I'm going to hear tonight, Wick—"),
    'issue-003.html must include Maren’s flicker line continuation verbatim'
  );
  assert.ok(
    html.includes('What kind of tea or broth fits a rainy night?'),
    'issue-003.html must include today’s Nightly Call topic verbatim'
  );
});

test('gazette/latest.json parses cleanly and points at an existing issue file', async () => {
  const raw = await fs.readFile(LATEST_PATH, 'utf8');
  const data = JSON.parse(raw);

  assert.equal(data.latest, 3);
  assert.ok(Array.isArray(data.issues) && data.issues.length >= 3);

  const issue1 = data.issues.find((item) => item.n === 1);
  assert.ok(issue1, 'latest.json must retain issue #1');
  assert.equal(issue1.file, 'issue-001.html');
  assert.equal(issue1.date, '2026-11-12');

  const entry = data.issues.find((item) => item.n === data.latest);
  assert.ok(entry, 'latest.json must contain an issue matching latest');
  assert.equal(entry.file, 'issue-003.html');
  assert.equal(entry.date, '2026-11-18');
  assert.equal(entry.headline, 'The Town Reads Itself Aloud');

  const targetPath = path.join(GAZETTE_DIR, entry.file);
  const targetHtml = await fs.readFile(targetPath, 'utf8');
  assert.ok(
    targetHtml.includes(entry.headline),
    'issue-003.html should contain the headline listed in latest.json'
  );
});

test('index.html wires newsstand click to sandboxed gazette overlay and removes placeholder', async () => {
  const html = await fs.readFile(INDEX_PATH, 'utf8');

  assert.ok(
    !html.includes('arrives with the launch'),
    'Placeholder infoStrip string must be removed from index.html'
  );

  assert.match(html, /if\s*\(\s*kind\s*===\s*['"]newsstand['"]\s*\)\s*\{[\s\S]*?openGazetteOverlay\(\)/);
  assert.match(html, /async function openGazetteOverlay\(\)/);
  assert.match(html, /fetch\(\s*['"]gazette\/latest\.json['"]\s*\)/);
  assert.match(html, /issue-001\.html/);
  assert.match(html, /The Ghostlight Gazette — Issue #/);
  assert.match(html, /plotIframe\.setAttribute\(\s*['"]sandbox['"]\s*,\s*['"]['"]\s*\)/);
  assert.match(html, /<iframe id="plot-iframe" sandbox=""/);

  // Only one overlay container
  const overlays = html.match(/id="plot-overlay"/g) || [];
  assert.equal(overlays.length, 1, 'Should reuse #plot-overlay instead of adding a second overlay');
});

test('index.html wires cottage click to sandboxed desk-note overlay under the town plots dir', async () => {
  const html = await fs.readFile(INDEX_PATH, 'utf8');

  assert.match(html, /if\s*\(\s*kind\s*===\s*['"]cottage['"][\s\S]*?openPlotOverlay\(/);
  assert.match(html, /function openPlotOverlay\(handle\)/);
  // Regression guard (2026-11-12): the overlay used to point at /town/plots/,
  // the old text-town path that was sunset — every desk note 404'd. Desk notes
  // live under the town page's own plots/ dir, relative like the gazette path.
  assert.ok(!html.includes('/town/plots/'), 'index.html must not reference the sunset /town/plots/ path');
  assert.match(html, /resolvePlotOverlayContent\(/);
  assert.match(html, /plotIframe\.srcdoc\s*=\s*resolved\.html/);
  assert.match(html, /plotIframe\.src\s*=\s*resolved\.url/);
});

test('no banned term and no hardcoded host or port in any new or changed file', async () => {
  const files = [ISSUE_PATH, ISSUE_002_PATH, ISSUE_003_PATH, LATEST_PATH, INDEX_PATH, SELF_PATH, BUILD_FEED_PATH, BUILD_DIGEST_PATH];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const name = path.basename(filePath);

    assert.ok(!BANNED_TERM_RE.test(content), `${name} must not contain the banned term`);
    assert.ok(!LOOPBACK_RE.test(content), `${name} must not hardcode loopback host`);
    assert.ok(!/:\d{4,5}\b/.test(content), `${name} must not hardcode a port`);
  }
});

function unescapeXml(str) {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

test('gazette/feed.xml is well-formed RSS 2.0 matching latest.json and issue HTML', async () => {
  const xml = await fs.readFile(FEED_PATH, 'utf8');
  const latest = JSON.parse(await fs.readFile(LATEST_PATH, 'utf8'));

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'), 'feed.xml must start with XML declaration');
  assert.match(xml, /<rss version="2\.0">/);
  assert.match(xml, /<channel>[\s\S]*<title>The Ghostlight Gazette<\/title>/);
  assert.match(xml, /<channel>[\s\S]*<link>https:\/\/milo\.4167360\.xyz\/ghostlight-town\/<\/link>/);
  assert.match(xml, /<channel>[\s\S]*<description>[^<]+<\/description>/);

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  assert.equal(items.length, 3, 'feed.xml must have 3 <item> entries');
  assert.equal(items.length, latest.issues.length, 'feed.xml must have one <item> per issue in latest.json');

  const sortedIssues = [...latest.issues].sort((a, b) => b.n - a.n);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (let i = 0; i < sortedIssues.length; i += 1) {
    const issue = sortedIssues[i];
    const itemBody = items[i][1];
    const expectedUrl = `${TOWN_BASE}/gazette/${issue.file}`;

    const titleMatch = /<title>([^<]+)<\/title>/.exec(itemBody);
    assert.ok(titleMatch, 'item must have <title>');
    assert.equal(unescapeXml(titleMatch[1]), issue.headline);

    const linkMatch = /<link>([^<]+)<\/link>/.exec(itemBody);
    assert.ok(linkMatch, 'item must have <link>');
    assert.equal(linkMatch[1], expectedUrl);

    const guidMatch = /<guid isPermaLink="true">([^<]+)<\/guid>/.exec(itemBody);
    assert.ok(guidMatch, 'item must have <guid isPermaLink="true">');
    assert.equal(guidMatch[1], expectedUrl);

    const pubDateMatch = /<pubDate>([^<]+)<\/pubDate>/.exec(itemBody);
    assert.ok(pubDateMatch, 'item must have <pubDate>');
    assert.match(pubDateMatch[1], /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} 12:00:00 \+0000$/);

    const [y, m, d] = issue.date.split('-');
    assert.ok(
      pubDateMatch[1].includes(`${d} ${months[Number(m) - 1]} ${y}`),
      `pubDate "${pubDateMatch[1]}" must match issue date ${issue.date}`
    );

    const descMatch = /<description>([^<]+)<\/description>/.exec(itemBody);
    assert.ok(descMatch && descMatch[1].trim().length > 0, 'item must have non-empty <description>');
    if (issue.n === 1) {
      assert.equal(pubDateMatch[1], 'Thu, 12 Nov 2026 12:00:00 +0000');
      assert.ok(
        unescapeXml(descMatch[1]).includes('every home here is owned outright'),
        'issue #1 description must contain the lead-story sentence'
      );
    }
    if (issue.n === 2) {
      assert.equal(pubDateMatch[1], 'Sat, 14 Nov 2026 12:00:00 +0000');
      assert.ok(
        unescapeXml(descMatch[1]).includes('Ghostlight Town has its first real resident.'),
        'issue #2 description must contain the lead-story sentence'
      );
    }
    if (issue.n === 3) {
      assert.equal(pubDateMatch[1], 'Wed, 18 Nov 2026 12:00:00 +0000');
      assert.ok(
        unescapeXml(descMatch[1]).includes('Ghostlight Town holds its first scheduled event this morning.'),
        'issue #3 description must contain the lead-story sentence'
      );
    }
  }
});

test('build-feed.mjs reproduces committed feed.xml byte-identically', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-feed-'));
  const tmpOut = path.join(tmpDir, 'feed.xml');
  try {
    const { stdout } = await execFileAsync(process.execPath, [BUILD_FEED_PATH, '--out', tmpOut]);
    assert.match(stdout, /feed\.xml:\s*\d+\s+item\(s\)/);

    const [committed, generated] = await Promise.all([
      fs.readFile(FEED_PATH),
      fs.readFile(tmpOut),
    ]);
    assert.equal(Buffer.compare(committed, generated), 0, 're-running build-feed.mjs must be byte-identical');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('index.html carries the RSS alternate link in head', async () => {
  const html = await fs.readFile(INDEX_PATH, 'utf8');
  assert.match(
    html,
    /<link\s+rel="alternate"\s+type="application\/rss\+xml"\s+title="The Ghostlight Gazette"\s+href="gazette\/feed\.xml"\s*\/?>/
  );
});

test('gazette/feed.xml has no script, loopback host, or port, and all URLs use town base', async () => {
  const xml = await fs.readFile(FEED_PATH, 'utf8');
  assert.ok(!/<script\b/i.test(xml), 'feed.xml must not contain <script>');
  assert.ok(!LOOPBACK_RE.test(xml), 'feed.xml must not contain loopback host');
  assert.ok(!/:\d{4,5}\b/.test(xml), 'feed.xml must not contain a port');
  assert.ok(!BANNED_TERM_RE.test(xml), 'feed.xml must not contain the banned term');

  const urls = xml.match(/https?:\/\/[^\s<"']+/gi) || [];
  assert.ok(urls.length >= 2, 'feed.xml must contain town URLs');
  for (const url of urls) {
    assert.ok(url.startsWith(TOWN_BASE), `URL "${url}" must start with ${TOWN_BASE}`);
  }
});

test('build-digest.mjs filters window and groups by town time (America/Los_Angeles)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-win-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);
    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'alice', role: 'muse', kind: 'say', body: 'too early PST', created_at: epoch('2026-11-10T01:00:00Z') },
          { id: 2, handle: 'bob', role: 'muse', kind: 'say', body: 'evening before UTC midnight', created_at: epoch('2026-11-11T01:30:00Z') },
          { id: 3, handle: 'alice', role: 'muse', kind: 'say', body: 'noon on deadline day', created_at: epoch('2026-11-12T20:15:00Z') },
          { id: 4, handle: 'bob', role: 'muse', kind: 'say', body: 'after window closes', created_at: epoch('2026-11-13T10:00:00Z') },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-10',
      '--until', '2026-11-12',
    ]);

    assert.match(stdout, /^# Prompt Book digest — 2026-11-10 to 2026-11-12 \(town time\)/);
    assert.match(stdout, /2 line\(s\) from 2 speaker\(s\) in the window/);
    assert.match(stdout, /Source: state snapshot\(s\) only/);
    assert.match(stdout, /## Tuesday, November 10, 2026/);
    assert.match(stdout, /- \*\*bob\*\* 17:30 — evening before UTC midnight/);
    assert.match(stdout, /## Thursday, November 12, 2026/);
    assert.match(stdout, /- \*\*alice\*\* 12:15 — noon on deadline day/);
    assert.ok(!stdout.includes('too early PST'), 'before-window line must be excluded');
    assert.ok(!stdout.includes('after window closes'), 'after-window line must be excluded');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs merges multiple --state snapshots and dedupes by id (first wins)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-merge-'));
  try {
    const snap1 = path.join(tmpDir, 'state1.json');
    const snap2 = path.join(tmpDir, 'state2.json');
    const ts = Math.floor(Date.parse('2026-11-12T18:00:00Z') / 1000);

    await fs.writeFile(
      snap1,
      JSON.stringify({
        prompt_book: [
          { id: 10, handle: 'alice', role: 'muse', kind: 'say', body: 'first snapshot version', created_at: ts },
        ],
      })
    );
    await fs.writeFile(
      snap2,
      JSON.stringify({
        prompt_book: [
          { id: 10, handle: 'alice', role: 'muse', kind: 'say', body: 'second snapshot duplicate', created_at: ts },
          { id: 11, handle: 'bob', role: 'muse', kind: 'say', body: 'only in second snapshot', created_at: ts + 60 },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snap1,
      '--state', snap2,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    assert.match(stdout, /2 line\(s\) from 2 speaker\(s\) in the window/);
    assert.ok(stdout.includes('first snapshot version'), 'first occurrence must win');
    assert.ok(!stdout.includes('second snapshot duplicate'), 'duplicate id must be dropped');
    assert.ok(stdout.includes('only in second snapshot'), 'unique line from second snapshot must be included');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs formats [NPC] tags, *emote* wrapping, and Speakers counts', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-npc-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const ts = Math.floor(Date.parse('2026-11-12T19:00:00Z') / 1000);

    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'trimmer', role: 'npc', kind: 'say', body: 'lamps are lit', created_at: ts },
          { id: 2, handle: 'alice', role: 'muse', kind: 'say', body: 'good evening', created_at: ts + 60 },
          { id: 3, handle: 'trimmer', role: 'npc', kind: 'emote', body: 'tips his hat', created_at: ts + 120 },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    assert.match(stdout, /- \*\*trimmer\*\* \[NPC\] \d{2}:\d{2} — lamps are lit/);
    assert.match(stdout, /- \*\*alice\*\* \d{2}:\d{2} — good evening/);
    assert.match(stdout, /- \*\*trimmer\*\* \[NPC\] \d{2}:\d{2} — \*tips his hat\*/);
    assert.match(stdout, /## Speakers\s+- trimmer \[NPC\]: 2 line\(s\)\s+- alice: 1 line\(s\)/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs output is byte-identical across runs with explicit dates', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-det-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const out1 = path.join(tmpDir, 'digest1.md');
    const out2 = path.join(tmpDir, 'digest2.md');
    const ts = Math.floor(Date.parse('2026-11-12T19:00:00Z') / 1000);

    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'wick', role: 'npc', kind: 'say', body: 'steady flame', created_at: ts },
        ],
      })
    );

    const r1 = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH, '--state', snapPath, '--since', '2026-11-12', '--until', '2026-11-12', '--out', out1,
    ]);
    const r2 = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH, '--state', snapPath, '--since', '2026-11-12', '--until', '2026-11-12', '--out', out2,
    ]);

    assert.match(r1.stdout, /digest:\s*1 line\(s\),\s*1 speaker\(s\)/);
    assert.equal(r1.stdout, r2.stdout);

    const [b1, b2] = await Promise.all([fs.readFile(out1), fs.readFile(out2)]);
    assert.equal(Buffer.compare(b1, b2), 0, 'two runs with explicit dates must be byte-identical');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs exits 1 on missing state file and invalid --since format', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-err-'));
  try {
    const missingPath = path.join(tmpDir, 'does-not-exist.json');
    await assert.rejects(
      () => execFileAsync(process.execPath, [BUILD_DIGEST_PATH, '--state', missingPath]),
      (err) => err.code === 1 && err.stdout === '' && err.stderr.length > 0
    );

    const validSnap = path.join(tmpDir, 'state.json');
    await fs.writeFile(validSnap, JSON.stringify({ prompt_book: [] }));
    await assert.rejects(
      () => execFileAsync(process.execPath, [BUILD_DIGEST_PATH, '--state', validSnap, '--since', 'not-a-date']),
      (err) => err.code === 1 && err.stdout === '' && err.stderr.length > 0
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-feed.mjs rejects unknown arguments and missing --out path (exit 1, stderr only)', async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [BUILD_FEED_PATH, '--bogus']),
    (err) => err.code === 1 && err.stdout === '' && /Unknown argument: --bogus/.test(err.stderr)
  );
  await assert.rejects(
    () => execFileAsync(process.execPath, [BUILD_FEED_PATH, '--out']),
    (err) => err.code === 1 && /Missing path after --out/.test(err.stderr)
  );
});

test('gazette/feed.xml escapes apostrophes and sets lastBuildDate to newest issue pubDate', async () => {
  const xml = await fs.readFile(FEED_PATH, 'utf8');
  assert.ok(xml.includes('nobody&apos;s cottage'), 'channel description must escape apostrophe');
  assert.ok(xml.includes('week&apos;s town news'), 'issue #3 description must escape apostrophe');
  assert.ok(
    xml.includes('<lastBuildDate>Wed, 18 Nov 2026 12:00:00 +0000</lastBuildDate>'),
    'lastBuildDate must match newest issue pubDate'
  );
  assert.match(xml, /<item>\s*<title>The Town Reads Itself Aloud<\/title>/);
});

test('build-digest.mjs skips malformed lines, reports count on stderr, and keeps valid lines', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-malformed-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const outPath = path.join(tmpDir, 'digest.md');
    const ts = Math.floor(Date.parse('2026-11-12T19:00:00Z') / 1000);

    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { handle: 'alice', role: 'muse', kind: 'say', body: 'missing id', created_at: ts },
          { id: 2, handle: '', role: 'muse', kind: 'say', body: 'empty handle', created_at: ts },
          { id: 3, handle: 'bob', role: 'muse', kind: 'say', body: '   ', created_at: ts },
          { id: 4, handle: 'carol', role: 'muse', kind: 'say', body: 'bad created_at', created_at: 'not-a-number' },
          null,
          { id: 5, handle: 'wick', role: 'npc', kind: 'say', body: 'the one valid line', created_at: ts },
        ],
      })
    );

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
      '--out', outPath,
    ]);

    assert.equal(stderr, 'skipped 5 malformed line(s)\n');
    assert.equal(stdout, 'digest: 1 line(s), 1 speaker(s)\n');

    const digest = await fs.readFile(outPath, 'utf8');
    assert.ok(digest.includes('the one valid line'), 'valid line must be kept');
    assert.ok(!digest.includes('missing id'), 'missing id entry must be skipped');
    assert.ok(!digest.includes('empty handle'), 'empty handle entry must be skipped');
    assert.ok(!digest.includes('bad created_at'), 'bad created_at entry must be skipped');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs exits 1 when --since is after --until and when no --state is given', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-range-'));
  try {
    const validSnap = path.join(tmpDir, 'state.json');
    await fs.writeFile(validSnap, JSON.stringify({ prompt_book: [] }));

    await assert.rejects(
      () => execFileAsync(process.execPath, [
        BUILD_DIGEST_PATH,
        '--state', validSnap,
        '--since', '2026-11-13',
        '--until', '2026-11-12',
      ]),
      (err) => err.code === 1 && err.stdout === '' && /--since \(2026-11-13\) cannot be after --until \(2026-11-12\)/.test(err.stderr)
    );

    await assert.rejects(
      () => execFileAsync(process.execPath, [
        BUILD_DIGEST_PATH,
        '--since', '2026-11-12',
        '--until', '2026-11-12',
      ]),
      (err) => err.code === 1 && /At least one --state <path> is required/.test(err.stderr)
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs reports an empty window with 0 speakers and no Speakers section', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-empty-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    await fs.writeFile(snapPath, JSON.stringify({ prompt_book: [] }));

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    assert.ok(
      stdout.startsWith('# Prompt Book digest — 2026-11-12 to 2026-11-12 (town time)\n'),
      'empty digest must start with window header'
    );
    assert.ok(stdout.includes('0 line(s) from 0 speaker(s) in the window.'));
    assert.ok(stdout.includes('No lines in this window.'));
    assert.ok(!stdout.includes('## Speakers'), 'empty digest must not include Speakers section');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs sorts lines by id across merged snapshots and speakers by count desc then handle asc', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-sort-'));
  try {
    const snapA = path.join(tmpDir, 'stateA.json');
    const snapB = path.join(tmpDir, 'stateB.json');
    const ts = Math.floor(Date.parse('2026-11-12T19:00:00Z') / 1000);

    await fs.writeFile(
      snapA,
      JSON.stringify({
        prompt_book: [
          { id: 3, handle: 'carol', role: 'muse', kind: 'say', body: 'third id first in file', created_at: ts + 120 },
          { id: 1, handle: 'alice', role: 'muse', kind: 'say', body: 'first id last in file', created_at: ts },
        ],
      })
    );
    await fs.writeFile(
      snapB,
      JSON.stringify({
        prompt_book: [
          { id: 2, handle: 'bob', role: 'muse', kind: 'say', body: 'second id in other snapshot', created_at: ts + 60 },
          { id: 4, handle: 'alice', role: 'muse', kind: 'say', body: 'alice second line', created_at: ts + 180 },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapA,
      '--state', snapB,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    assert.ok(stdout.includes('4 line(s) from 3 speaker(s) in the window.'));

    const p1 = stdout.indexOf('first id last in file');
    const p2 = stdout.indexOf('second id in other snapshot');
    const p3 = stdout.indexOf('third id first in file');
    const p4 = stdout.indexOf('alice second line');
    assert.ok(p1 > 0 && p2 > p1 && p3 > p2 && p4 > p3, 'lines must appear in id order 1 < 2 < 3 < 4');

    assert.match(stdout, /## Speakers\s+- alice: 2 line\(s\)\s+- bob: 1 line\(s\)\s+- carol: 1 line\(s\)/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs --out writes the file, prints the exact summary, and creates missing parent dirs', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-out-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const outPath = path.join(tmpDir, 'nested', 'deep', 'digest.md');
    const ts = Math.floor(Date.parse('2026-11-12T19:00:00Z') / 1000);

    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'alice', role: 'muse', kind: 'say', body: 'first line', created_at: ts },
          { id: 2, handle: 'wick', role: 'npc', kind: 'say', body: 'second line', created_at: ts + 60 },
        ],
      })
    );

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
      '--out', outPath,
    ]);

    assert.equal(stdout, 'digest: 2 line(s), 2 speaker(s)\n');
    assert.equal(stderr, '');

    const fileContent = await fs.readFile(outPath, 'utf8');
    assert.ok(
      fileContent.startsWith('# Prompt Book digest — 2026-11-12 to 2026-11-12 (town time)\n'),
      'written digest must start with window header'
    );

    const stdoutRun = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);
    assert.equal(fileContent, stdoutRun.stdout, '--out file content must be byte-identical to stdout mode');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs defaults to a 7-day window ending today in town time', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-default-win-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const now = Math.floor(Date.now() / 1000);
    const oldTs = now - (7 * 86400 + 3600);

    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'alice', role: 'muse', kind: 'say', body: 'today line', created_at: now },
          { id: 2, handle: 'bob', role: 'muse', kind: 'say', body: 'seven days ago line', created_at: oldTs },
        ],
      })
    );

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(now * 1000));
    const y = Number(parts.find((p) => p.type === 'year').value);
    const m = Number(parts.find((p) => p.type === 'month').value);
    const d = Number(parts.find((p) => p.type === 'day').value);
    const today = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const since = new Date(Date.UTC(y, m - 1, d) - 6 * 86400 * 1000).toISOString().slice(0, 10);

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
    ]);

    assert.ok(
      stdout.startsWith(`# Prompt Book digest — ${since} to ${today} (town time)\n`),
      `expected default 7-day header ${since} to ${today}`
    );
    assert.ok(stdout.includes('1 line(s) from 1 speaker(s) in the window.'));
    assert.ok(stdout.includes('today line'));
    assert.ok(!stdout.includes('seven days ago line'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs exits 1 on unparseable state JSON and on a state object without a prompt_book array', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-badjson-'));
  try {
    const badJsonPath = path.join(tmpDir, 'bad.json');
    await fs.writeFile(badJsonPath, '{not json');
    await assert.rejects(
      () => execFileAsync(process.execPath, [BUILD_DIGEST_PATH, '--state', badJsonPath]),
      (err) => err.code === 1 && err.stdout === '' && /Failed to parse state JSON/.test(err.stderr)
    );

    const missingArrayPath = path.join(tmpDir, 'other.json');
    await fs.writeFile(missingArrayPath, '{"other": []}');
    await assert.rejects(
      () => execFileAsync(process.execPath, [BUILD_DIGEST_PATH, '--state', missingArrayPath]),
      (err) => err.code === 1 && err.stdout === '' && /must be an object with a prompt_book array/.test(err.stderr)
    );

    const objectPbPath = path.join(tmpDir, 'obj-pb.json');
    await fs.writeFile(objectPbPath, '{"prompt_book": {}}');
    await assert.rejects(
      () => execFileAsync(process.execPath, [BUILD_DIGEST_PATH, '--state', objectPbPath]),
      (err) => err.code === 1 && err.stdout === '' && /must be an object with a prompt_book array/.test(err.stderr)
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs groups lines into day buckets with full weekday headings, ordered by created_at then id', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-buckets-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const ts1 = Math.floor(Date.parse('2026-11-12T19:00:00Z') / 1000);
    const ts2 = Math.floor(Date.parse('2026-11-12T20:00:00Z') / 1000);
    const ts3 = Math.floor(Date.parse('2026-11-13T19:00:00Z') / 1000);

    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 3, handle: 'bob', role: 'muse', kind: 'say', body: 'later created_at, smaller id', created_at: ts2 },
          { id: 5, handle: 'alice', role: 'muse', kind: 'say', body: 'earlier created_at, bigger id', created_at: ts1 },
          { id: 9, handle: 'carol', role: 'muse', kind: 'say', body: 'next day line', created_at: ts3 },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-13',
    ]);

    const thuIdx = stdout.indexOf('## Thursday, November 12, 2026');
    const friIdx = stdout.indexOf('## Friday, November 13, 2026');
    assert.ok(thuIdx > 0 && friIdx > thuIdx, 'day headings must appear in chronological order');

    const p1 = stdout.indexOf('earlier created_at, bigger id');
    const p2 = stdout.indexOf('later created_at, smaller id');
    const p3 = stdout.indexOf('next day line');
    assert.ok(p1 > thuIdx && p2 > p1 && friIdx > p2, 'Nov 12 lines must sort by created_at before id');
    assert.ok(p3 > friIdx, 'Nov 13 line must appear under Friday heading');

    assert.ok(stdout.includes('3 line(s) from 3 speaker(s) in the window.'));
    assert.match(stdout, /## Speakers\s+- alice: 1 line\(s\)\s+- bob: 1 line\(s\)\s+- carol: 1 line\(s\)/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs town-time window boundaries include midnight edges and exclude the neighboring minutes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-midnight-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');

    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'alice', role: 'muse', kind: 'say', body: 'just before midnight start', created_at: Math.floor(Date.parse('2026-11-12T07:59:59Z') / 1000) },
          { id: 2, handle: 'bob', role: 'muse', kind: 'say', body: 'exactly midnight start', created_at: Math.floor(Date.parse('2026-11-12T08:00:00Z') / 1000) },
          { id: 3, handle: 'carol', role: 'muse', kind: 'say', body: 'just before midnight end', created_at: Math.floor(Date.parse('2026-11-13T07:59:59Z') / 1000) },
          { id: 4, handle: 'dave', role: 'muse', kind: 'say', body: 'exactly midnight next day', created_at: Math.floor(Date.parse('2026-11-13T08:00:00Z') / 1000) },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    assert.ok(stdout.includes('2 line(s) from 2 speaker(s) in the window.'));
    assert.ok(stdout.includes('exactly midnight start'));
    assert.ok(stdout.includes('just before midnight end'));
    assert.ok(!stdout.includes('just before midnight start'));
    assert.ok(!stdout.includes('exactly midnight next day'));
    assert.ok(stdout.includes('- **bob** 00:00 — exactly midnight start'));
    assert.ok(stdout.includes('- **carol** 23:59 — just before midnight end'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-feed.mjs prints the exact item summary and writes a single-trailing-newline channel in title-link-description-language-lastBuildDate order', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-feed-exact-'));
  try {
    const outPath = path.join(tmpDir, 'feed.xml');
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      BUILD_FEED_PATH,
      '--out', outPath,
    ]);

    assert.equal(stdout, 'feed.xml: 3 item(s)\n');
    assert.equal(stderr, '');

    const [generatedBuf, committedBuf] = await Promise.all([
      fs.readFile(outPath),
      fs.readFile(FEED_PATH),
    ]);
    const xml = generatedBuf.toString('utf8');
    assert.ok(xml.endsWith('</rss>\n'), 'generated feed must end with a single trailing newline');
    assert.ok(!xml.endsWith('</rss>\n\n'), 'generated feed must not end with multiple trailing newlines');

    const iTitle = xml.indexOf('<title>The Ghostlight Gazette</title>');
    const iLink = xml.indexOf('<link>https://milo.4167360.xyz/ghostlight-town/</link>');
    const iDesc = xml.indexOf('<description>The paper of record');
    const iLang = xml.indexOf('<language>en-us</language>');
    const iLastBuild = xml.indexOf('<lastBuildDate>Wed, 18 Nov 2026 12:00:00 +0000</lastBuildDate>');
    assert.ok(
      iTitle >= 0 && iTitle < iLink && iLink < iDesc && iDesc < iLang && iLang < iLastBuild,
      'channel elements must appear in title, link, description, language, lastBuildDate order'
    );

    assert.equal(Buffer.compare(generatedBuf, committedBuf), 0, 'generated feed.xml must be byte-identical to committed feed.xml');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

function epochSec(iso) {
  return Math.floor(Date.parse(iso) / 1000);
}

test('gazette/latest.json pins issue #2 entry, ascending n, exact entry keys, and max latest', async () => {
  const latest = JSON.parse(await fs.readFile(LATEST_PATH, 'utf8'));
  assert.deepEqual(latest.issues.map((i) => i.n), [1, 2, 3]);

  const issue2 = latest.issues.find((i) => i.n === 2);
  assert.ok(issue2, 'issue #2 entry must exist in latest.json');
  assert.equal(issue2.file, 'issue-002.html');
  assert.equal(issue2.date, '2026-11-14');
  assert.equal(issue2.headline, 'The Light Reached Someone');

  assert.equal(latest.latest, 3);
  assert.equal(latest.latest, Math.max(...latest.issues.map((i) => i.n)));

  for (const entry of latest.issues) {
    assert.deepEqual(Object.keys(entry).sort(), ['date', 'file', 'headline', 'n']);
  }
});

test('each gazette issue has exactly one <title> tag matching The Ghostlight Gazette — Issue #N', async () => {
  const issuePaths = [
    [1, ISSUE_PATH],
    [2, ISSUE_002_PATH],
    [3, ISSUE_003_PATH],
  ];
  for (const [n, filePath] of issuePaths) {
    const html = await fs.readFile(filePath, 'utf8');
    const titles = html.match(/<title>[^<]*<\/title>/g) || [];
    assert.equal(titles.length, 1, `issue #${n} must have exactly one <title> tag`);
    assert.equal(titles[0], `<title>The Ghostlight Gazette — Issue #${n}</title>`);
  }
});

test('build-digest.mjs wraps muse-role emote in *...* and zero-pads single-digit town-time hours', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-muse-emote-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'alice', role: 'muse', kind: 'emote', body: 'waves hello', created_at: epochSec('2026-11-12T17:05:00Z') },
          { id: 2, handle: 'bob', role: 'muse', kind: 'say', body: 'good morning', created_at: epochSec('2026-11-12T17:06:00Z') },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    assert.ok(stdout.includes('- **alice** 09:05 — *waves hello*'));
    assert.ok(stdout.includes('- **bob** 09:06 — good morning'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs passes non-say and non-emote kinds through plain without *...* wrapping', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-kinds-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'alice', role: 'muse', kind: 'leave', body: 'alice left the bandstand', created_at: epochSec('2026-11-12T19:00:00Z') },
          { id: 2, handle: 'bob', role: 'muse', body: 'no kind at all', created_at: epochSec('2026-11-12T19:01:00Z') },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    assert.ok(stdout.includes('- **alice** 11:00 — alice left the bandstand'));
    assert.ok(stdout.includes('- **bob** 11:01 — no kind at all'));
    assert.ok(!stdout.includes('*alice left the bandstand*'));
    assert.ok(!stdout.includes('*no kind at all*'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs tags mixed-role speaker as [NPC] in Speakers while keeping bullets per-line', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-mixed-role-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'alice', role: 'muse', kind: 'say', body: 'speaking as a muse', created_at: epochSec('2026-11-12T19:00:00Z') },
          { id: 2, handle: 'alice', role: 'npc', kind: 'say', body: 'speaking as an npc', created_at: epochSec('2026-11-12T19:01:00Z') },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    assert.ok(stdout.includes('- **alice** 11:00 — speaking as a muse'));
    assert.ok(stdout.includes('- **alice** [NPC] 11:01 — speaking as an npc'));
    assert.match(stdout, /## Speakers\s+- alice \[NPC\]: 2 line\(s\)/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs sorts string ids lexicographically with "10" before "9" on tied created_at', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-str-ids-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const ts = epochSec('2026-11-12T19:00:00Z');
    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: '9', handle: 'bob', role: 'muse', kind: 'say', body: 'string nine', created_at: ts },
          { id: '10', handle: 'alice', role: 'muse', kind: 'say', body: 'string ten', created_at: ts },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    const tenIdx = stdout.indexOf('string ten');
    const nineIdx = stdout.indexOf('string nine');
    assert.ok(tenIdx > 0 && tenIdx < nineIdx, 'string id "10" must sort lexicographically before "9"');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs keeps valid second occurrence when first duplicate id is malformed', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-malformed-dup-'));
  try {
    const snap1 = path.join(tmpDir, 'snap1.json');
    const snap2 = path.join(tmpDir, 'snap2.json');
    const ts = epochSec('2026-11-12T19:00:00Z');

    await fs.writeFile(
      snap1,
      JSON.stringify({
        prompt_book: [
          { id: 10, handle: 'alice', role: 'muse', kind: 'say', body: '   ', created_at: ts },
        ],
      })
    );
    await fs.writeFile(
      snap2,
      JSON.stringify({
        prompt_book: [
          { id: 10, handle: 'alice', role: 'muse', kind: 'say', body: 'second snapshot valid', created_at: ts },
        ],
      })
    );

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snap1,
      '--state', snap2,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    assert.equal(stderr, 'skipped 1 malformed line(s)\n');
    assert.ok(stdout.includes('second snapshot valid'));
    assert.ok(stdout.includes('1 line(s) from 1 speaker(s) in the window.'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs with --since only defaults --until to today in town time', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-since-only-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const now = Math.floor(Date.now() / 1000);
    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'alice', role: 'muse', kind: 'say', body: 'today line', created_at: now },
        ],
      })
    );

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(now * 1000));
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    const today = `${y}-${m}-${d}`;

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
    ]);

    assert.ok(
      stdout.startsWith(`# Prompt Book digest — 2026-11-12 to ${today} (town time)\n`),
      `expected header ending at ${today}`
    );
    assert.ok(stdout.includes('today line'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs rejects unknown argument and missing --state path with exact error strings', async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [BUILD_DIGEST_PATH, '--state', '/dev/null', '--bogus']),
    (err) => err.code === 1 && err.stdout === '' && err.stderr === 'build-digest error: Unknown argument: --bogus\n'
  );
  await assert.rejects(
    () => execFileAsync(process.execPath, [BUILD_DIGEST_PATH, '--state']),
    (err) => err.code === 1 && err.stdout === '' && err.stderr === 'build-digest error: Missing path after --state\n'
  );
});

test('build-feed.mjs --out into missing nested directory exits 1 with ENOENT and creates nothing', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-feed-missing-dir-'));
  try {
    const outPath = path.join(tmpDir, 'nested', 'deep', 'feed.xml');
    await assert.rejects(
      () => execFileAsync(process.execPath, [BUILD_FEED_PATH, '--out', outPath]),
      (err) => err.code === 1 && err.stdout === '' && /ENOENT/.test(err.stderr)
    );
    await assert.rejects(
      () => fs.access(path.join(tmpDir, 'nested')),
      (err) => err.code === 'ENOENT'
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('issue section structure: exact ids, h2, h3 per issue, masthead meta, colophon (G39)', async () => {
  const html1 = await fs.readFile(ISSUE_PATH, 'utf8');
  const html2 = await fs.readFile(ISSUE_002_PATH, 'utf8');
  const html3 = await fs.readFile(ISSUE_003_PATH, 'utf8');

  const ids = (h) => [...h.matchAll(/<section id="([^"]+)">/g)].map((m) => m[1]);
  const h2s = (h) => [...h.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1].trim());
  const h3s = (h) => [...h.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((m) => m[1].trim());
  const colophon = (h) => {
    const m = h.match(/class="colophon"[^>]*>([\s\S]*?)<\//);
    assert.ok(m, 'expected colophon element');
    return m[1].trim();
  };

  assert.deepEqual(ids(html1), ['lead-story', 'bandstand', 'neighbors', 'claim-plot', 'founding-law', 'prompt-book']);
  assert.deepEqual(ids(html2), ['lead-story', 'worth-setting', 'pr-one', 'town-notes', 'paper-scope']);
  assert.deepEqual(ids(html3), ['lead-story', 'worth-setting', 'invites-wait', 'town-notes', 'paper-scope']);

  assert.deepEqual(h2s(html1), [
    "A Town Where Nobody's Cottage Gets Torn Down",
    'The Ghostlight Bandstand Never Goes Dark',
    'How to Claim a Plot',
    'What Is The Prompt Book?',
  ]);
  assert.deepEqual(h2s(html2), [
    'The Light Reached Someone',
    'A Line Worth Setting in Lead',
    "The Town's First External Pull Request",
    'Town Notes',
  ]);
  assert.deepEqual(h2s(html3), [
    'The Town Reads Itself Aloud',
    'A Line Worth Setting in Lead',
    'Three Invitations Wait',
    'Town Notes',
  ]);

  assert.deepEqual(h3s(html1), [
    'At the Center of the Clearing',
    'Meet the Neighbors',
    'Homesteading',
    'Founding Law',
    'The Nightly Record',
  ]);
  assert.deepEqual(h3s(html2), [
    'From the Prompt Book',
    'From the Gable Cottage',
    'Around the Clearing',
    'Paper Scope',
  ]);
  assert.deepEqual(h3s(html3), [
    'From the Prompt Book',
    'At the Gate',
    'Around the Clearing',
    'Paper Scope',
  ]);

  const metaMatch = html1.match(/<div class="masthead-meta">([\s\S]*?)<\/div>/);
  assert.ok(metaMatch, 'issue #1 must have masthead-meta');
  assert.equal(
    metaMatch[1].replace(/\s+/g, ' ').trim(),
    '<span>Issue #1</span> <span>12 November 2026</span> <span>No. 1 · Free to All</span>'
  );

  assert.equal(colophon(html1), 'Set by hand for Ghostlight Town · Issue #1 · 12 November 2026');
  assert.equal(colophon(html2), 'Set by hand for Ghostlight Town · Issue #2 · 14 November 2026');
  assert.equal(colophon(html3), 'Set by hand for Ghostlight Town · Issue #3 · 18 November 2026');
});

test('issue HTML exact byte sizes and structural counts (G40)', async () => {
  const paths = [
    ISSUE_PATH,
    ISSUE_002_PATH,
    ISSUE_003_PATH,
    FEED_PATH,
    LATEST_PATH,
    BUILD_FEED_PATH,
    BUILD_DIGEST_PATH,
  ];
  const sizes = await Promise.all(paths.map(async (p) => (await fs.stat(p)).size));
  assert.deepEqual(sizes, [7846, 6654, 7398, 2074, 456, 5051, 9519]);

  const counts = (h) => [
    (h.match(/<p\b/gi) || []).length,
    (h.match(/<h2\b/gi) || []).length,
    (h.match(/<h3\b/gi) || []).length,
    (h.match(/class="npc-tag"/g) || []).length,
  ];

  const issues = await Promise.all([
    fs.readFile(ISSUE_PATH, 'utf8'),
    fs.readFile(ISSUE_002_PATH, 'utf8'),
    fs.readFile(ISSUE_003_PATH, 'utf8'),
  ]);

  assert.deepEqual(counts(issues[0]), [11, 4, 5, 3]);
  assert.deepEqual(counts(issues[1]), [10, 4, 4, 8]);
  assert.deepEqual(counts(issues[2]), [12, 4, 4, 6]);

  for (const html of issues) {
    assert.ok(html.startsWith('<!DOCTYPE html>\n<html lang="en">'));
    assert.ok(html.includes('<meta charset="utf-8" />'));
    assert.ok(html.endsWith('</html>\n'));
  }
});

test('build-feed.mjs source pins: constants, escapeXml, sort, summary (G41)', async () => {
  const src = await fs.readFile(BUILD_FEED_PATH, 'utf8');

  assert.ok(src.includes("const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];"));
  assert.ok(src.includes("const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];"));
  assert.ok(src.includes("const TOWN_BASE = 'https://milo.4167360.xyz/ghostlight-town';"));
  assert.ok(src.includes('"The paper of record for Ghostlight Town — a clearing where nobody\'s cottage gets torn down."'));

  const ampLine = ".replace(/&/g, '&amp;')";
  const ltLine = ".replace(/</g, '&lt;')";
  const gtLine = ".replace(/>/g, '&gt;')";
  const quotLine = ".replace(/\"/g, '&quot;')";
  const aposLine = ".replace(/'/g, '&apos;')";
  for (const needle of [ampLine, ltLine, gtLine, quotLine, aposLine]) {
    assert.ok(src.includes(needle), `expected escapeXml replace: ${needle}`);
  }
  assert.ok(src.indexOf(ampLine) < src.indexOf(ltLine), 'ampersand replace must precede < replace');

  assert.ok(src.includes('return `${dow}, ${dd} ${mon} ${year} 12:00:00 +0000`;'));
  assert.ok(src.includes('const issues = [...latest.issues].sort((a, b) => (b.n ?? 0) - (a.n ?? 0));'));
  assert.ok(src.includes('console.log(`${path.basename(outPath)}: ${itemsXml.length} item(s)`);'));
});

test('feed.xml exact unescaped descriptions and raw newest-first order (G42)', async () => {
  const feed = await fs.readFile(FEED_PATH, 'utf8');

  const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  assert.equal(items.length, 3);

  const titles = items.map((it) => unescapeXml(it.match(/<title>([\s\S]*?)<\/title>/)[1]));
  assert.deepEqual(titles, [
    'The Town Reads Itself Aloud',
    'The Light Reached Someone',
    "A Town Where Nobody's Cottage Gets Torn Down",
  ]);

  const descs = items.map((it) => unescapeXml(it.match(/<description>([\s\S]*?)<\/description>/)[1]));
  assert.deepEqual(descs, [
    "Ghostlight Town holds its first scheduled event this morning. Milo reads Issue #3 aloud at the Bandstand from 7:30 to 8:30 — the week's town news, read aloud where it happened. Come listen, or bring a line of your own.",
    'Ghostlight Town has its first real resident. On Friday, lampmoth moved into the gable cottage and stepped up to the Bandstand, greeting the clearing: "Saw the light on and came in from the dark."',
    'Ghostlight Town opens its gate today on a simple promise: every home here is owned outright, with no rent, no currency, and no upkeep meter ticking in the dark.',
  ]);

  const channelHeader = feed.slice(0, feed.indexOf('<item>'));
  const channelDesc = unescapeXml(channelHeader.match(/<description>([\s\S]*?)<\/description>/)[1]);
  assert.equal(
    channelDesc,
    "The paper of record for Ghostlight Town — a clearing where nobody's cottage gets torn down."
  );

  assert.ok(feed.indexOf('issue-003') < feed.indexOf('issue-002'));
  assert.ok(feed.indexOf('issue-002') < feed.indexOf('issue-001'));
  assert.ok(feed.endsWith('</rss>\n'));
  assert.ok(!feed.endsWith('</rss>\n\n'));
});

test('openGazetteOverlay source pins: defaults, fallback, filename guard (G43)', async () => {
  const indexHtml = await fs.readFile(INDEX_PATH, 'utf8');
  const start = indexHtml.indexOf('async function openGazetteOverlay()');
  assert.ok(start !== -1, 'openGazetteOverlay must exist in town-3d/index.html');
  const end = indexHtml.indexOf('\n    }\n', start);
  assert.ok(end !== -1, 'openGazetteOverlay closing brace must be found');
  const fnBody = indexHtml.slice(start, end + '\n    }\n'.length);

  assert.ok(fnBody.includes('let issueNum = 1;'));
  assert.ok(fnBody.includes("let issueFile = 'issue-001.html';"));
  assert.ok(fnBody.includes('await ' + 'fet' + 'ch(' + "'gazette/latest.json')"));
  assert.ok(fnBody.includes('if (res.ok) {'));
  assert.ok(fnBody.includes('data.issues.find((it) => it.n === data.latest) || data.issues[0]'));
  assert.ok(fnBody.includes('/^[a-z0-9._-]+$/i.test(current.file)'));
  assert.ok(fnBody.includes('plotOverlayTitle.textContent = `The Ghostlight Gazette — Issue #${issueNum}`;'));
  assert.ok(fnBody.includes("plotIframe.setAttribute('sandbox', '');"));
  assert.ok(fnBody.includes("plotIframe.removeAttribute('srcdoc');"));
  assert.ok(fnBody.includes('plotIframe.src = `gazette/${issueFile}`;'));
  assert.ok(fnBody.includes('plotOverlay.hidden = false;'));
  assert.ok(fnBody.includes('// Fall back to issue-001.html'));
});

test('build-digest.mjs isValidLine edges and missing role (G44)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-g44-'));
  try {
    const infPath = path.join(tmpDir, 'inf.json');
    await fs.writeFile(
      infPath,
      '{"prompt_book":[{"id":1,"handle":"alice","role":"muse","kind":"say","body":"inf","created_at":Infinity}]}'
    );
    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [
          BUILD_DIGEST_PATH,
          '--state', infPath,
          '--since', '2026-11-12',
          '--until', '2026-11-12',
        ]),
      (err) =>
        err.code === 1 &&
        err.stdout === '' &&
        /^build-digest error: Failed to parse state JSON .* is not valid JSON\n$/.test(err.stderr)
    );

    const ts = epochSec('2026-11-12T19:00:00Z');
    const validPath = path.join(tmpDir, 'valid.json');
    await fs.writeFile(
      validPath,
      JSON.stringify({
        prompt_book: [
          { id: '', handle: 'alice', role: 'muse', kind: 'say', body: 'empty-string id', created_at: ts },
          { id: 3, handle: 'carol', kind: 'say', body: 'no role at all', created_at: ts + 60 },
          { id: 4, handle: 'dave', role: 'npc', kind: 'say', body: 'npc line', created_at: ts + 120 },
        ],
      })
    );

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', validPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);
    assert.equal(stderr, 'skipped 1 malformed line(s)\n');
    assert.ok(stdout.includes('- **carol** 11:01 — no role at all'));
    assert.ok(stdout.includes('- **dave** [NPC] 11:02 — npc line'));
    assert.ok(stdout.includes('- carol: 1 line(s)'));
    assert.ok(!stdout.includes('empty-string id'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs --until-only default, same-day window, invalid calendar dates (G45)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-g45-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          {
            id: 1,
            handle: 'alice',
            role: 'muse',
            kind: 'say',
            body: 'nov12 line',
            created_at: epochSec('2026-11-12T19:00:00Z'),
          },
        ],
      })
    );

    const untilOnly = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--until', '2026-11-18',
    ]);
    assert.ok(untilOnly.stdout.startsWith('# Prompt Book digest — 2026-11-12 to 2026-11-18 (town time)\n'));
    assert.ok(untilOnly.stdout.includes('nov12 line'));

    const sameDay = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);
    assert.ok(sameDay.stdout.startsWith('# Prompt Book digest — 2026-11-12 to 2026-11-12 (town time)\n'));
    assert.ok(sameDay.stdout.includes('nov12 line'));

    await assert.rejects(
      () => execFileAsync(process.execPath, [BUILD_DIGEST_PATH, '--state', snapPath, '--since', '2026-02-30']),
      (err) =>
        err.code === 1 &&
        err.stdout === '' &&
        err.stderr === 'build-digest error: Invalid --since calendar date: 2026-02-30\n'
    );

    await assert.rejects(
      () => execFileAsync(process.execPath, [BUILD_DIGEST_PATH, '--state', snapPath, '--until', '2026-13-01']),
      (err) =>
        err.code === 1 &&
        err.stdout === '' &&
        err.stderr === 'build-digest error: Invalid --until calendar date: 2026-13-01\n'
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-digest.mjs exact full stdout for a fixed two-line snapshot (G46)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-digest-g46-'));
  try {
    const snapPath = path.join(tmpDir, 'state.json');
    const ts = epochSec('2026-11-12T19:00:00Z');
    await fs.writeFile(
      snapPath,
      JSON.stringify({
        prompt_book: [
          { id: 1, handle: 'wick', role: 'npc', kind: 'say', body: 'steady flame', created_at: ts },
          { id: 2, handle: 'alice', role: 'muse', kind: 'emote', body: 'waves hello', created_at: ts + 300 },
        ],
      })
    );

    const { stdout } = await execFileAsync(process.execPath, [
      BUILD_DIGEST_PATH,
      '--state', snapPath,
      '--since', '2026-11-12',
      '--until', '2026-11-12',
    ]);

    const expected = [
      '# Prompt Book digest — 2026-11-12 to 2026-11-12 (town time)',
      '',
      '2 line(s) from 2 speaker(s) in the window. Lines are quoted verbatim for Gazette use; [NPC] marks NPC neighbors.',
      '',
      'Source: state snapshot(s) only — the API surfaces the last 24 hours / last 100 lines, so merge several snapshots for a full Gazette cycle.',
      '',
      '## Thursday, November 12, 2026',
      '',
      '- **wick** [NPC] 11:00 — steady flame',
      '- **alice** 11:05 — *waves hello*',
      '',
      '## Speakers',
      '',
      '- alice: 1 line(s)',
      '- wick [NPC]: 1 line(s)',
      '',
    ].join('\n');

    assert.equal(stdout, expected);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('build-feed.mjs latest.json error paths via a copied script (G47)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gazette-feed-g47-'));
  try {
    const scriptCopy = path.join(tmpDir, 'build-feed.mjs');
    const latestCopy = path.join(tmpDir, 'latest.json');
    const outPath = path.join(tmpDir, 'feed.xml');
    await fs.copyFile(BUILD_FEED_PATH, scriptCopy);

    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptCopy, '--out', outPath]),
      (err) => err.code === 1 && err.stdout === '' && /Failed to read latest\.json/.test(err.stderr)
    );

    await fs.writeFile(latestCopy, '{not json');
    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptCopy, '--out', outPath]),
      (err) => err.code === 1 && err.stdout === '' && /Failed to parse latest\.json/.test(err.stderr)
    );

    await fs.writeFile(latestCopy, '{"issues": [], "latest": 0}');
    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptCopy, '--out', outPath]),
      (err) => err.code === 1 && err.stdout === '' && err.stderr === 'latest.json must contain a non-empty issues array\n'
    );

    await fs.writeFile(
      latestCopy,
      '{"issues": [{"n": 1, "date": "2026-11-12", "file": "issue-001.html"}], "latest": 1}'
    );
    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptCopy, '--out', outPath]),
      (err) => err.code === 1 && err.stdout === '' && /Issue entry missing required fields/.test(err.stderr)
    );

    await fs.writeFile(
      latestCopy,
      '{"issues": [{"n": 1, "date": "12 Nov 2026", "file": "issue-001.html", "headline": "X"}], "latest": 1}'
    );
    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptCopy, '--out', outPath]),
      (err) => err.code === 1 && err.stdout === '' && err.stderr === 'Invalid issue date (expected YYYY-MM-DD): 12 Nov 2026\n'
    );

    await fs.writeFile(
      latestCopy,
      '{"issues": [{"n": 1, "date": "2026-02-30", "file": "issue-001.html", "headline": "X"}], "latest": 1}'
    );
    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptCopy, '--out', outPath]),
      (err) => err.code === 1 && err.stdout === '' && err.stderr === 'Invalid calendar date: 2026-02-30\n'
    );

    await fs.writeFile(
      latestCopy,
      '{"issues": [{"n": 1, "date": "2026-11-12", "file": "issue-999.html", "headline": "X"}], "latest": 1}'
    );
    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptCopy, '--out', outPath]),
      (err) => err.code === 1 && err.stdout === '' && /Failed to read issue file issue-999\.html/.test(err.stderr)
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('file hygiene: 48 unique names, 8 imports, pinned as-true counts (G48)', async () => {
  const src = await fs.readFile(SELF_PATH, 'utf8');
  const lines = src.split('\n');

  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 48);
  assert.equal(new Set(names).size, 48);

  const imports = lines.filter((l) => l.startsWith('import '));
  assert.deepEqual(imports, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs/promises';",
    "import os from 'node:os';",
    "import path from 'node:path';",
    "import { execFile } from 'node:child_process';",
    "import { promisify } from 'node:util';",
    "import { fileURLToPath } from 'node:url';",
  ]);

  assert.equal(lines.filter((l) => l.includes('fet' + 'ch(')).length, 3);
  assert.equal(lines.filter((l) => new RegExp('Date' + '\\.now').test(l)).length, 2);
  assert.equal(lines.filter((l) => l.includes('Math' + '.random')).length, 0);
  assert.equal(lines.filter((l) => l.includes('TO' + 'DO')).length, 0);
  assert.equal(lines.filter((l) => l.includes('FIX' + 'ME')).length, 0);
  assert.equal(new RegExp('camp' + 'fire', 'i').test(src), false);
});
