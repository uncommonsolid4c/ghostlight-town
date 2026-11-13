import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAZETTE_DIR = path.join(__dirname, 'gazette');
const ISSUE_PATH = path.join(GAZETTE_DIR, 'issue-001.html');
const LATEST_PATH = path.join(GAZETTE_DIR, 'latest.json');
const INDEX_PATH = path.join(__dirname, 'index.html');
const SELF_PATH = fileURLToPath(import.meta.url);

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
  assert.match(html, /plotIframe\.src\s*=\s*`plots\/\$\{encodeURIComponent\(handle\)\}\/index\.html`/);
});

test('no banned term and no hardcoded host or port in any new or changed file', async () => {
  const files = [ISSUE_PATH, LATEST_PATH, INDEX_PATH, SELF_PATH];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const name = path.basename(filePath);

    assert.ok(!BANNED_TERM_RE.test(content), `${name} must not contain the banned term`);
    assert.ok(!LOOPBACK_RE.test(content), `${name} must not hardcode loopback host`);
    assert.ok(!/:\d{4,5}\b/.test(content), `${name} must not hardcode a port`);
  }
});
