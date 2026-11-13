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
  const files = [ISSUE_PATH, LATEST_PATH, INDEX_PATH, SELF_PATH, BUILD_FEED_PATH];
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
