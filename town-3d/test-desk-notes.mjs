import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PLOTS_DIR = path.join(__dirname, 'plots');
const SOURCE_PLOTS_DIR = path.join(REPO_ROOT, 'town-npc', 'plots');
const INDEX_PATH = path.join(__dirname, 'index.html');
const SELF_PATH = fileURLToPath(import.meta.url);

const SEED_HANDLES = ['milo', 'wick', 'maren', 'tomas'];
const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');
const LOOPBACK_RE = new RegExp(`127\\.0\\.${'0.1'}|local${'host'}`, 'i');

test('seed desk notes exist under town-3d/plots/<handle>/index.html and are byte-identical to town-npc/plots/<handle>/desk-note.html', async () => {
  for (const handle of SEED_HANDLES) {
    const destPath = path.join(PLOTS_DIR, handle, 'index.html');
    const srcPath = path.join(SOURCE_PLOTS_DIR, handle, 'desk-note.html');

    const [destBuf, srcBuf] = await Promise.all([
      fs.readFile(destPath),
      fs.readFile(srcPath),
    ]);

    assert.ok(destBuf.length > 0, `${handle}/index.html must not be empty`);
    assert.ok(
      destBuf.equals(srcBuf),
      `town-3d/plots/${handle}/index.html drifted from town-npc/plots/${handle}/desk-note.html`
    );
  }
});

test('seed desk notes contain no <script>, inline handlers, external URLs, or banned term', async () => {
  for (const handle of SEED_HANDLES) {
    const destPath = path.join(PLOTS_DIR, handle, 'index.html');
    const html = await fs.readFile(destPath, 'utf8');

    assert.ok(!/<script\b/i.test(html), `${handle}/index.html must not contain <script> tags`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${handle}/index.html must not contain inline event handlers`);
    assert.ok(!/https?:\/\//i.test(html), `${handle}/index.html must not contain http(s):// URLs`);
    assert.ok(!/(?:href|src)\s*=/i.test(html), `${handle}/index.html must not contain href= or src= attributes`);
    assert.ok(!/(?:href|src)\s*=\s*["']\/\//i.test(html), `${handle}/index.html must not contain protocol-relative URLs`);
    assert.ok(!/\bfetch\s*\(/i.test(html), `${handle}/index.html must not contain fetch() calls`);
    assert.ok(!BANNED_TERM_RE.test(html), `${handle}/index.html must not contain the banned term`);
  }
});

test('openPlotOverlay URL pattern in town-3d resolves to an existing static file for all four seed handles', async () => {
  const indexHtml = await fs.readFile(INDEX_PATH, 'utf8');
  const townJs = await fs.readFile(path.join(__dirname, 'town.js'), 'utf8');
  assert.match(indexHtml, /resolvePlotOverlayContent\(/, 'index.html openPlotOverlay must call resolvePlotOverlayContent');
  assert.match(indexHtml, /plotIframe\.src\s*=\s*resolved\.url/, 'index.html openPlotOverlay must set plotIframe.src to resolved.url on static fallback');
  assert.match(townJs, /plots\/\$\{encodeURIComponent\(safeHandle\)\}\/index\.html/, 'town.js resolvePlotOverlayContent must build static plots/<handle>/index.html URL');

  for (const handle of SEED_HANDLES) {
    const relPath = `plots/${encodeURIComponent(handle)}/index.html`;
    const resolved = path.join(__dirname, relPath);
    const stat = await fs.stat(resolved);
    assert.ok(stat.isFile(), `Expected ${relPath} to resolve to a file on disk`);
  }
});

test('test-desk-notes.mjs contains no banned term or hardcoded host/port', async () => {
  const self = await fs.readFile(SELF_PATH, 'utf8');
  assert.ok(!BANNED_TERM_RE.test(self), 'test-desk-notes.mjs must not contain the banned term');
  assert.ok(!LOOPBACK_RE.test(self), 'test-desk-notes.mjs must not hardcode loopback host');
  assert.ok(!/:\d{4,5}\b/.test(self), 'test-desk-notes.mjs must not hardcode a port');
});
