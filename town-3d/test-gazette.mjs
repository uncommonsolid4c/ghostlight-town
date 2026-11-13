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

test('gazette/latest.json parses cleanly and points at an existing issue file', async () => {
  const raw = await fs.readFile(LATEST_PATH, 'utf8');
  const data = JSON.parse(raw);

  assert.equal(data.latest, 1);
  assert.ok(Array.isArray(data.issues) && data.issues.length >= 1);

  const entry = data.issues.find((item) => item.n === data.latest);
  assert.ok(entry, 'latest.json must contain an issue matching latest');
  assert.equal(entry.file, 'issue-001.html');
  assert.equal(entry.date, '2026-11-12');
  assert.ok(typeof entry.headline === 'string' && entry.headline.length > 0);

  const targetPath = path.join(GAZETTE_DIR, entry.file);
  const targetHtml = await fs.readFile(targetPath, 'utf8');
  assert.ok(
    targetHtml.includes(entry.headline),
    'issue-001.html should contain the headline listed in latest.json'
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
  const files = [ISSUE_PATH, LATEST_PATH, INDEX_PATH, SELF_PATH, BUILD_FEED_PATH, BUILD_DIGEST_PATH];
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
      assert.ok(
        unescapeXml(descMatch[1]).includes('every home here is owned outright'),
        'issue #1 description must contain the lead-story sentence'
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
