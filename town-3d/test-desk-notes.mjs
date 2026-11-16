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

    const viewportRe = /<meta\s+name=["']viewport["']\s+content=["']width=device-width,\s*initial-scale=1\.0["']\s*\/?>/i;
    assert.match(destBuf.toString('utf8'), viewportRe, `town-3d/plots/${handle}/index.html must include viewport meta`);
    assert.match(srcBuf.toString('utf8'), viewportRe, `town-npc/plots/${handle}/desk-note.html must include viewport meta`);
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

test('tomas desk note names the tower a lighthouse and mentions the lamp kept lit in the top window', async () => {
  const html = await fs.readFile(path.join(PLOTS_DIR, 'tomas', 'index.html'), 'utf8');
  assert.match(html, /tower/i, 'tomas desk note must mention the tower');
  assert.match(html, /lighthouse/i, 'tomas desk note must name it a lighthouse');
  assert.match(html, /lamp/i, 'tomas desk note must mention the lamp');
  assert.match(html, /top window/i, 'tomas desk note must mention the top window');
});

test('test-desk-notes.mjs contains no banned term or hardcoded host/port', async () => {
  const self = await fs.readFile(SELF_PATH, 'utf8');
  assert.ok(!BANNED_TERM_RE.test(self), 'test-desk-notes.mjs must not contain the banned term');
  assert.ok(!LOOPBACK_RE.test(self), 'test-desk-notes.mjs must not hardcode loopback host');
  assert.ok(!/:\d{4,5}\b/.test(self), 'test-desk-notes.mjs must not hardcode a port');
});

test('milo desk note states the founding law, Musebook rebuild, footlight 0, and Ghostlight Gazette', async () => {
  const html = await fs.readFile(path.join(PLOTS_DIR, 'milo', 'index.html'), 'utf8');
  assert.match(html, /no upkeep,\s*no currency,\s*no real money/i);
  assert.match(html, /280 Musebucks a day/i);
  assert.match(html, /ledger(?:&rsquo;|['’])s ice-blue and cream/i);
  assert.match(html, /\bfootlight 0\b/i);
  assert.match(html, /Ghostlight Gazette,\s*the town(?:&rsquo;|['’])s paper of record/i);
  assert.match(html, /Milo,\s*Founder\s*(?:&amp;|&)\s*Chief Editor,\s*Ghostlight Gazette/);
});

test('wick desk note covers bandstand sweeping, Ghostlight bulb, burned repertory theatre, sawdust and hot gels, and signature', async () => {
  const html = await fs.readFile(path.join(PLOTS_DIR, 'wick', 'index.html'), 'utf8');
  assert.match(html, /sweep the bandstand steps/i);
  assert.match(html, /Ghostlight bulb/i);
  assert.match(html, /repertory theatre that burned down/i);
  assert.match(html, /sawdust and hot gels/i);
  assert.match(html, /Wick,\s*Stagehand \/ Lamp-Trimmer/);
});

test('maren desk note covers composing stick, misspelled wedding announcement, newsstand-to-Prompt-Book walk, and signature', async () => {
  const html = await fs.readFile(path.join(PLOTS_DIR, 'maren', 'index.html'), 'utf8');
  assert.match(html, /composing stick/i);
  assert.match(html, /wedding announcement with the groom(?:&rsquo;|['’])s name misspelled/i);
  assert.match(html, /walk from the Gazette newsstand to the Prompt Book/i);
  assert.match(html, /Maren,\s*Retired Typesetter/);
});

test('tomas desk note covers the water-filled copper samovar rescue, tea offer, and signature', async () => {
  const html = await fs.readFile(path.join(PLOTS_DIR, 'tomas', 'index.html'), 'utf8');
  assert.match(html, /rescued the copper samovar(?:&mdash;|—|--)it survived because it was already full of water/i);
  assert.match(html, /offering tea/i);
  assert.match(html, /tea offer still stands/i);
  assert.match(html, /Tomas,\s*Props-Master \/ Tea-Urn Keeper/);
});

test('desk notes have no cross-voice bleed and only milo names all three neighbors', async () => {
  const notes = Object.fromEntries(
    await Promise.all(
      SEED_HANDLES.map(async (handle) => [
        handle,
        await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'), 'utf8'),
      ])
    )
  );

  for (const neighbor of ['Wick', 'Maren', 'Tomas']) {
    assert.match(notes.milo, new RegExp(`\\b${neighbor}\\b`), `milo desk note must name neighbor ${neighbor}`);
  }

  const signatureNouns = {
    wick: [/sawdust/i, /hot gels/i, /Lamp-Trimmer/i],
    maren: [/composing stick/i, /lead sorts/i, /Retired Typesetter/i],
    tomas: [/samovar/i, /\btea\b/i, /Props-Master/i],
  };

  for (const handle of ['wick', 'maren', 'tomas']) {
    const html = notes[handle];
    for (const other of SEED_HANDLES) {
      if (other === handle) continue;
      assert.doesNotMatch(
        html,
        new RegExp(`\\b${other}\\b`, 'i'),
        `${handle} desk note must not mention seed handle ${other}`
      );
      for (const re of signatureNouns[other] || []) {
        assert.doesNotMatch(
          html,
          re,
          `${handle} desk note must not contain ${other}'s signature noun ${re}`
        );
      }
    }
  }
});

test('each desk note has valid document structure, Georgia serif, 34rem width, single h1 and sig, and pinned background color', async () => {
  const expectedBg = {
    milo: '#f5efe0',
    wick: '#faf4e8',
    maren: '#f4f6f8',
    tomas: '#fbf5ec',
  };

  for (const handle of SEED_HANDLES) {
    const html = await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'), 'utf8');
    const titleHandle = handle[0].toUpperCase() + handle.slice(1);

    assert.match(html, /^<!doctype html>/i, `${handle}: must start with <!doctype html>`);
    assert.match(html, /<html\s+lang=["']en["']>/i, `${handle}: must have <html lang="en">`);
    assert.match(html, /font-family:\s*Georgia,\s*serif/i, `${handle}: must use Georgia, serif`);
    assert.match(html, /max-width:\s*34rem/i, `${handle}: must set max-width: 34rem`);
    assert.match(
      html,
      new RegExp(`background:\\s*${expectedBg[handle]}\\b`, 'i'),
      `${handle}: must pin background ${expectedBg[handle]}`
    );

    const h1Matches = html.match(/<h1\b[^>]*>.*?<\/h1>/gis) || [];
    assert.equal(h1Matches.length, 1, `${handle}: must have exactly one <h1>`);
    assert.equal(
      h1Matches[0],
      `<h1>${titleHandle}&rsquo;s Desk Note</h1>`,
      `${handle}: <h1> must match ${titleHandle}&rsquo;s Desk Note`
    );

    const sigMatches = html.match(/<p\s+class=["']sig["']>/gi) || [];
    assert.equal(sigMatches.length, 1, `${handle}: must have exactly one <p class="sig">`);
  }
});
