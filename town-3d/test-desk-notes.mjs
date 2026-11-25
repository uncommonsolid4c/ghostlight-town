import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlotOverlayContent } from './town.js';

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

test('resolvePlotOverlayContent: invalid handles fall back to static without calling fetch', async () => {
  const invalidHandles = [null, 123, '', 'Milo', 'a<b', 'a', 'ab cd', 'wick!'];
  for (const handle of invalidHandles) {
    let fetchCalls = 0;
    const fetchFn = async () => {
      fetchCalls += 1;
      return { status: 200, json: async () => ({ html: '<p>x</p>' }) };
    };
    const result = await resolvePlotOverlayContent(handle, { fetchFn });
    assert.equal(fetchCalls, 0, `fetchFn must not be called for invalid handle ${String(handle)}`);
    assert.equal(result.kind, 'static');
    const expectedUrl =
      'plots/' +
      encodeURIComponent(typeof handle === 'string' ? handle : String(handle ?? '')) +
      '/index.html';
    assert.equal(result.url, expectedUrl);
  }

  const noFetchResult = await resolvePlotOverlayContent('wick');
  assert.deepEqual(noFetchResult, { kind: 'static', url: 'plots/wick/index.html' });
});

test('resolvePlotOverlayContent: API path with a stub fetch', async () => {
  {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { status: 200, json: async () => ({ html: '<p>hi</p>' }) };
    };
    const result = await resolvePlotOverlayContent('wick', {
      fetchFn,
      apiBase: 'https://x.example/',
    });
    assert.deepEqual(result, { kind: 'api', html: '<p>hi</p>' });
    assert.deepEqual(urls, ['https://x.example/api/town/plot?handle=wick']);
  }

  {
    const fetchFn = async () => ({ status: 200, json: async () => ({ html: '   ' }) });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.equal(result.kind, 'static');
  }

  {
    const fetchFn = async () => ({ status: 200, json: async () => ({ html: 42 }) });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.equal(result.kind, 'static');
  }

  {
    const fetchFn = async () => ({ status: 404, json: async () => ({}) });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.equal(result.kind, 'static');
  }

  {
    const fetchFn = async () => {
      throw new Error('network error');
    };
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.equal(result.kind, 'static');
  }

  {
    const fetchFn = async () => ({ status: 200, json: async () => null });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.equal(result.kind, 'static');
  }

  {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { status: 404, json: async () => ({}) };
    };
    const result = await resolvePlotOverlayContent('maren', {
      fetchFn,
      apiBase: 'https://y.example///',
    });
    assert.equal(result.kind, 'static');
    assert.deepEqual(urls, ['https://y.example/api/town/plot?handle=maren']);
  }
});

test('desk notes and their sources contain no embed/form/script-scheme vectors', async () => {
  const bannedVectors = [
    /<iframe\b/i,
    /<object\b/i,
    /<embed\b/i,
    /<form\b/i,
    /javascript:/i,
    /data:text\/html/i,
    /vbscript:/i,
  ];

  for (const handle of SEED_HANDLES) {
    const destPath = path.join(PLOTS_DIR, handle, 'index.html');
    const srcPath = path.join(SOURCE_PLOTS_DIR, handle, 'desk-note.html');
    const [destHtml, srcHtml] = await Promise.all([
      fs.readFile(destPath, 'utf8'),
      fs.readFile(srcPath, 'utf8'),
    ]);

    for (const re of bannedVectors) {
      assert.doesNotMatch(destHtml, re, `${handle}/index.html must not match ${re}`);
      assert.doesNotMatch(srcHtml, re, `${handle}/desk-note.html must not match ${re}`);
    }
  }
});

test('each seed plot directory contains only index.html', async () => {
  for (const handle of SEED_HANDLES) {
    const entries = await fs.readdir(path.join(PLOTS_DIR, handle));
    assert.deepEqual(entries, ['index.html']);
  }
});

test('desk-note size and paragraph bounds', async () => {
  for (const handle of SEED_HANDLES) {
    const buf = await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'));
    assert.ok(buf.length > 500 && buf.length < 3000, `${handle} byte length ${buf.length} out of bounds`);
    const pMatches = buf.toString('utf8').match(/<p\b/gi) || [];
    assert.ok(pMatches.length >= 3 && pMatches.length <= 8, `${handle} <p> count ${pMatches.length} out of bounds`);
  }
});

test('exact sig line and h1 border color per handle', async () => {
  const expected = {
    milo: {
      sig: '<p class="sig">&mdash; Milo, Founder &amp; Chief Editor, Ghostlight Gazette</p>',
      border: 'border-bottom: 1px solid #a8d8ea',
    },
    wick: {
      sig: '<p class="sig">&mdash; Wick, Stagehand / Lamp-Trimmer</p>',
      border: 'border-bottom: 1px solid #c8922e',
    },
    maren: {
      sig: '<p class="sig">&mdash; Maren, Retired Typesetter</p>',
      border: 'border-bottom: 1px solid #43505c',
    },
    tomas: {
      sig: '<p class="sig">&mdash; Tomas, Props-Master / Tea-Urn Keeper</p>',
      border: 'border-bottom: 1px solid #b5633a',
    },
  };

  for (const handle of SEED_HANDLES) {
    const html = await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'), 'utf8');
    assert.ok(html.includes(expected[handle].sig), `${handle}: missing exact sig line`);
    assert.ok(html.includes(expected[handle].border), `${handle}: missing exact h1 border declaration`);
  }
});

test('resolvePlotOverlayContent HANDLE_RE boundaries: 2-char, 32-char, digit-first, trailing _/- valid; 33-char, leading -/_, dot invalid', async () => {
  const makeStub = () => {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { status: 200, json: async () => ({ html: '<p>x</p>' }) };
    };
    return { urls, fetchFn };
  };

  const validHandles = [
    'ab',
    'a' + 'b'.repeat(31),
    '1abc',
    'wick-2',
    'wick_',
  ];
  for (const handle of validHandles) {
    const { urls, fetchFn } = makeStub();
    const result = await resolvePlotOverlayContent(handle, { fetchFn });
    assert.equal(result.kind, 'api', `expected api for valid handle ${handle}`);
    assert.deepEqual(urls, [`/api/town/plot?handle=${handle}`]);
  }

  const invalidHandles = [
    'a' + 'b'.repeat(32),
    '-abc',
    '_abc',
    'wick.',
  ];
  for (const handle of invalidHandles) {
    const { urls, fetchFn } = makeStub();
    const result = await resolvePlotOverlayContent(handle, { fetchFn });
    assert.deepEqual(result, {
      kind: 'static',
      url: `plots/${encodeURIComponent(handle)}/index.html`,
    });
    assert.equal(urls.length, 0, `fetchFn must not be called for invalid handle ${handle}`);
  }
});

test('resolvePlotOverlayContent apiBase edges: non-string collapses to empty, trailing slashes stripped, empty stays root-relative', async () => {
  const cases = [
    { apiBase: 123, expectedUrl: '/api/town/plot?handle=wick' },
    { apiBase: null, expectedUrl: '/api/town/plot?handle=wick' },
    { apiBase: 'https://x.example///', expectedUrl: 'https://x.example/api/town/plot?handle=wick' },
    { apiBase: '', expectedUrl: '/api/town/plot?handle=wick' },
  ];

  for (const { apiBase, expectedUrl } of cases) {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { status: 200, json: async () => ({ html: '<p>x</p>' }) };
    };
    const result = await resolvePlotOverlayContent('wick', { fetchFn, apiBase });
    assert.deepEqual(result, { kind: 'api', html: '<p>x</p>' });
    assert.deepEqual(urls, [expectedUrl]);
  }
});

test('resolvePlotOverlayContent API response shape edges: null res, missing status, throwing json, missing json, array data, verbatim html', async () => {
  const fallbackCases = [
    async () => null,
    async () => ({}),
    async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }),
    async () => ({ status: 200 }),
    async () => ({ status: 200, json: async () => ['<p>x</p>'] }),
    async () => undefined,
  ];

  for (const fetchFn of fallbackCases) {
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.deepEqual(result, { kind: 'static', url: 'plots/wick/index.html' });
  }

  {
    const fetchFn = async () => ({ status: 200, json: async () => ({ html: '0' }) });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.deepEqual(result, { kind: 'api', html: '0' });
  }

  {
    const fetchFn = async () => ({ status: 200, json: async () => ({ html: '  <p>hi</p>  ' }) });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.deepEqual(result, { kind: 'api', html: '  <p>hi</p>  ' });
  }

  {
    const fetchFn = async () => ({ status: 200, json: async () => ({ html: '<p>x</p>', extra: 1 }) });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.deepEqual(result, { kind: 'api', html: '<p>x</p>' });
    assert.equal('extra' in result, false);
  }
});

test('resolvePlotOverlayContent fetchFn type edges: non-function fetchFn never throws, rejecting fetch falls back to static', async () => {
  for (const fetchFn of ['not-a-function', 42, null, {}]) {
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.deepEqual(result, { kind: 'static', url: 'plots/wick/index.html' });
  }

  const rejectingFetch = async () => {
    throw new Error('boom');
  };
  const result = await resolvePlotOverlayContent('wick', { fetchFn: rejectingFetch });
  assert.deepEqual(result, { kind: 'static', url: 'plots/wick/index.html' });
});

test('each desk note pins its body color, sig color, exact paragraph count, and shared type rules', async () => {
  const expected = {
    milo: {
      bodyColor: 'color: #2b2118;',
      sigRule: '.sig { font-style: italic; color: #46687a; }',
      pCount: 4,
    },
    wick: {
      bodyColor: 'color: #2b2118;',
      sigRule: '.sig { font-style: italic; color: #6b3e1b; }',
      pCount: 4,
    },
    maren: {
      bodyColor: 'color: #1e2328;',
      sigRule: '.sig { font-style: italic; color: #43505c; }',
      pCount: 4,
    },
    tomas: {
      bodyColor: 'color: #362015;',
      sigRule: '.sig { font-style: italic; color: #8c4a2b; }',
      pCount: 5,
    },
  };

  for (const handle of SEED_HANDLES) {
    const html = await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'), 'utf8');
    assert.ok(html.includes(expected[handle].bodyColor), `${handle}: missing body color`);
    assert.ok(html.includes(expected[handle].sigRule), `${handle}: missing sig rule`);
    assert.ok(html.includes('h1 { font-size: 1.3rem;'), `${handle}: missing h1 font-size`);
    assert.ok(html.includes('line-height: 1.6;'), `${handle}: missing line-height`);
    assert.ok(html.includes('margin: 2rem auto; padding: 0 1rem;'), `${handle}: missing margin/padding`);
    assert.equal((html.match(/<p\b/gi) || []).length, expected[handle].pCount, `${handle}: unexpected <p> count`);
  }
});

test('each desk note pins its document skeleton: single style/head/body/meta, no title, Bandstand mention, exact ending', async () => {
  for (const handle of SEED_HANDLES) {
    const html = await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'), 'utf8');
    assert.ok(html.endsWith('</body>\n</html>\n'), `${handle}: must end with </body>\\n</html>\\n`);
    assert.equal((html.match(/<style\b/gi) || []).length, 1, `${handle}: must have exactly one <style>`);
    assert.equal((html.match(/<head\b/gi) || []).length, 1, `${handle}: must have exactly one <head>`);
    assert.equal((html.match(/<body\b/gi) || []).length, 1, `${handle}: must have exactly one <body>`);
    assert.equal((html.match(/<meta\b/g) || []).length, 1, `${handle}: must have exactly one <meta`);
    assert.ok(!/<title>/i.test(html), `${handle}: must not contain <title>`);
    assert.match(html, /bandstand/i, `${handle}: must mention the Bandstand`);
  }
});

test('milo desk note pins the Ghostlight bulb 24/7, the translucent ghost, and the corner front door', async () => {
  const html = await fs.readFile(path.join(PLOTS_DIR, 'milo', 'index.html'), 'utf8');
  assert.match(html, /Ghostlight bulb burns 24\/7/);
  assert.match(html, /translucent ice-blue ghost/);
  assert.match(html, /milo\.4167360\.xyz/);
  assert.match(html, /three town spirits/);
  assert.match(html, /single gable cottage/);
});

test('wick desk note pins the filament, the dark stage, and the porch invitation', async () => {
  const html = await fs.readFile(path.join(PLOTS_DIR, 'wick', 'index.html'), 'utf8');
  assert.match(html, /single warm filament/);
  assert.match(html, /dark stage is the one thing I cannot stand/);
  assert.match(html, /take a moment to notice the light is on/);
  assert.match(html, /check the glass and the brass/);
});

test('maren desk note pins the folded weekly, the midnight fix, and the good line', async () => {
  const html = await fs.readFile(path.join(PLOTS_DIR, 'maren', 'index.html'), 'utf8');
  assert.match(html, /weekly paper that folded/);
  assert.match(html, /fixed at midnight before the press rolled/);
  assert.match(html, /leave me one good line worth keeping/);
  assert.match(html, /correcting the grammar quietly/);
});

test('tomas desk note pins the tea ritual and the always-on samovar and lamp', async () => {
  const html = await fs.readFile(path.join(PLOTS_DIR, 'tomas', 'index.html'), 'utf8');
  assert.match(html, /offering tea at inappropriate moments/);
  assert.match(html, /Bandstand corner step/);
  assert.match(html, /There is always a cup ready here/);
  assert.match(html, /come sit for tea/);
  assert.match(html, /the samovar and the lamp are both always on/);
});

test('resolvePlotOverlayContent: non-200 statuses fall back to static', async () => {
  for (const status of [201, 301, 500]) {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { status, json: async () => ({ html: '<p>x</p>' }) };
    };
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.deepEqual(result, { kind: 'static', url: 'plots/wick/index.html' });
    assert.deepEqual(urls, ['/api/town/plot?handle=wick']);
  }
});

test('resolvePlotOverlayContent: non-object JSON data and whitespace html fall back to static', async () => {
  for (const data of ['text', 42, true]) {
    const fetchFn = async () => ({ status: 200, json: async () => data });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.deepEqual(result, { kind: 'static', url: 'plots/wick/index.html' });
  }

  const wsFetch = async () => ({ status: 200, json: async () => ({ html: '\n\t ' }) });
  const wsResult = await resolvePlotOverlayContent('wick', { fetchFn: wsFetch });
  assert.deepEqual(wsResult, { kind: 'static', url: 'plots/wick/index.html' });
});

test('resolvePlotOverlayContent HANDLE_RE: all-digits, mixed separators valid; uppercase, whitespace invalid', async () => {
  for (const handle of ['123', 'a-b_c9', 'wick2']) {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { status: 200, json: async () => ({ html: '<p>x</p>' }) };
    };
    const result = await resolvePlotOverlayContent(handle, { fetchFn });
    assert.equal(result.kind, 'api');
    assert.deepEqual(urls, [`/api/town/plot?handle=${handle}`]);
  }

  for (const handle of ['wiCk', 'WICK', 'wick\n', ' wick', 'wick\t']) {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return { status: 200, json: async () => ({ html: '<p>x</p>' }) };
    };
    const result = await resolvePlotOverlayContent(handle, { fetchFn });
    assert.deepEqual(result, {
      kind: 'static',
      url: `plots/${encodeURIComponent(handle)}/index.html`,
    });
    assert.equal(calls, 0);
  }
});

test('resolvePlotOverlayContent: non-string handles fall back to static with the String() URL', async () => {
  const cases = [
    [{}, 'plots/%5Bobject%20Object%5D/index.html'],
    [['wick'], 'plots/wick/index.html'],
    [0, 'plots/0/index.html'],
    [new String('wick'), 'plots/wick/index.html'],
    [{ toString() { return 'wick'; } }, 'plots/wick/index.html'],
  ];

  for (const [handle, expectedUrl] of cases) {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return { status: 200, json: async () => ({ html: '<p>x</p>' }) };
    };
    const result = await resolvePlotOverlayContent(handle, { fetchFn });
    assert.deepEqual(result, { kind: 'static', url: expectedUrl });
    assert.equal(calls, 0);
  }
});

test('openPlotOverlay in index.html wires the api kind through srcdoc and clears src', async () => {
  const indexHtml = await fs.readFile(INDEX_PATH, 'utf8');
  const apiBranch = "if (resolved.kind === 'api') {";
  const removeSrc = "plotIframe.removeAttribute('src');";
  const setSrcdoc = 'plotIframe.srcdoc = resolved.html;';

  for (const snippet of [
    apiBranch,
    removeSrc,
    setSrcdoc,
    "plotIframe.removeAttribute('srcdoc');",
    'plotIframe.src = resolved.url;',
    "plotIframe.setAttribute('sandbox', '');",
    'plotOverlayTitle.textContent = `@${handle} — Desk Note`;',
  ]) {
    assert.ok(indexHtml.includes(snippet), `index.html missing ${snippet}`);
  }

  const apiIdx = indexHtml.indexOf(apiBranch);
  const removeSrcIdx = indexHtml.indexOf(removeSrc);
  const srcdocIdx = indexHtml.indexOf(setSrcdoc);
  assert.ok(removeSrcIdx > apiIdx && removeSrcIdx < srcdocIdx);
});

test('resolvePlotOverlayContent apiBase: whitespace-only and single-slash bases pass through verbatim', async () => {
  const cases = [
    ['   ', '   /api/town/plot?handle=wick'],
    ['https://x.example/', 'https://x.example/api/town/plot?handle=wick'],
  ];

  for (const [apiBase, expectedUrl] of cases) {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { status: 200, json: async () => ({ html: '<p>x</p>' }) };
    };
    const result = await resolvePlotOverlayContent('wick', { fetchFn, apiBase });
    assert.deepEqual(result, { kind: 'api', html: '<p>x</p>' });
    assert.deepEqual(urls, [expectedUrl]);
  }
});

test('exact desk-note byte lengths per handle and total', async () => {
  const expectedLengths = {
    milo: 1493,
    wick: 1117,
    maren: 1134,
    tomas: 1308,
  };
  let total = 0;

  for (const handle of SEED_HANDLES) {
    const buf = await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'));
    assert.equal(buf.length, expectedLengths[handle], `${handle}: unexpected byte length`);
    total += buf.length;
  }

  assert.equal(total, 5052, 'total byte length across all four desk notes');
});

test('paragraph narrative order per handle', async () => {
  const expectedOrder = {
    milo: [
      'founded Ghostlight Town',
      'single gable cottage',
      'Ghostlight Gazette',
      'Milo, Founder',
    ],
    wick: [
      'sweep the bandstand steps',
      'repertory theatre that burned down',
      'take a moment to notice the light is on',
      'Wick, Stagehand',
    ],
    maren: [
      'weekly paper that folded',
      'composing stick',
      'leave me one good line worth keeping',
      'Maren, Retired Typesetter',
    ],
    tomas: [
      'rescued the copper samovar',
      'offering tea at inappropriate moments',
      'tea offer still stands',
      'There is always a cup ready here',
      'Tomas, Props-Master',
    ],
  };

  for (const handle of SEED_HANDLES) {
    const html = await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'), 'utf8');
    let prev = -1;
    for (const phrase of expectedOrder[handle]) {
      const idx = html.indexOf(phrase);
      assert.ok(idx !== -1, `${handle}: missing phrase "${phrase}"`);
      assert.ok(idx > prev, `${handle}: phrase "${phrase}" out of order (${idx} <= ${prev})`);
      prev = idx;
    }
  }
});

test('exact full CSS rule lines per handle', async () => {
  const expectedRules = {
    milo: {
      body: 'body { font-family: Georgia, serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #2b2118; background: #f5efe0; line-height: 1.6; }',
      h1: 'h1 { font-size: 1.3rem; border-bottom: 1px solid #a8d8ea; padding-bottom: 0.4rem; }',
    },
    wick: {
      body: 'body { font-family: Georgia, serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #2b2118; background: #faf4e8; line-height: 1.6; }',
      h1: 'h1 { font-size: 1.3rem; border-bottom: 1px solid #c8922e; padding-bottom: 0.4rem; }',
    },
    maren: {
      body: 'body { font-family: Georgia, serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #1e2328; background: #f4f6f8; line-height: 1.6; }',
      h1: 'h1 { font-size: 1.3rem; border-bottom: 1px solid #43505c; padding-bottom: 0.4rem; }',
    },
    tomas: {
      body: 'body { font-family: Georgia, serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #362015; background: #fbf5ec; line-height: 1.6; }',
      h1: 'h1 { font-size: 1.3rem; border-bottom: 1px solid #b5633a; padding-bottom: 0.4rem; }',
    },
  };

  for (const handle of SEED_HANDLES) {
    const html = await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'), 'utf8');
    assert.ok(html.includes(expectedRules[handle].body), `${handle}: missing exact body CSS rule`);
    assert.ok(html.includes(expectedRules[handle].h1), `${handle}: missing exact h1 CSS rule`);
  }
});

test('resolvePlotOverlayContent: html emptiness edges', async () => {
  for (const html of ['', '   ', '\t\n']) {
    const fetchFn = async () => ({ status: 200, json: async () => ({ html }) });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.deepEqual(result, { kind: 'static', url: 'plots/wick/index.html' });
  }

  for (const html of ['<p></p>', ' x ', '<p>x</p>']) {
    const fetchFn = async () => ({ status: 200, json: async () => ({ html }) });
    const result = await resolvePlotOverlayContent('wick', { fetchFn });
    assert.deepEqual(result, { kind: 'api', html });
  }
});

test('resolvePlotOverlayContent: opts edges including null TypeError', async () => {
  for (const opts of [undefined, {}, 42, 'x']) {
    const result = await resolvePlotOverlayContent('wick', opts);
    assert.deepEqual(result, { kind: 'static', url: 'plots/wick/index.html' });
  }

  await assert.rejects(() => resolvePlotOverlayContent('wick', null), TypeError);
});

test('resolvePlotOverlayContent: HANDLE_RE further boundaries', async () => {
  for (const handle of ['ab-', 'a_b', '12', 'a1', 'a-', 'a_']) {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      return { status: 200, json: async () => ({ html: '<p>ok</p>' }) };
    };
    const result = await resolvePlotOverlayContent(handle, { fetchFn });
    assert.equal(result.kind, 'api', `expected api for valid handle ${handle}`);
    assert.deepEqual(urls, [`/api/town/plot?handle=${handle}`]);
  }

  for (const handle of ['-a', '_a', 'a/b', 'a b']) {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return { status: 200, json: async () => ({ html: '<p>ok</p>' }) };
    };
    const result = await resolvePlotOverlayContent(handle, { fetchFn });
    assert.deepEqual(result, {
      kind: 'static',
      url: `plots/${encodeURIComponent(handle)}/index.html`,
    });
    assert.equal(calls, 0, `fetchFn must not be called for invalid handle ${handle}`);
  }
});

test('openPlotOverlay and closePlotOverlay wiring snippets in index.html', async () => {
  const indexHtml = await fs.readFile(INDEX_PATH, 'utf8');
  const fetchFnSnippet = `fetchFn: typeof ${'window'}.fetch === 'function' ? ${'window'}.fetch.bind(window) : null,`;
  const apiBaseSnippet = 'apiBase: API_BASE,';

  for (const snippet of [
    fetchFnSnippet,
    apiBaseSnippet,
    'currentPlotHandle = handle;',
    "setPlotTabs('note');",
    'currentPlotHandle = null;',
    "plotIframe.src = 'about:blank';",
    'canvas.focus();',
    "plotOverlayClose.addEventListener('click', closePlotOverlay);",
  ]) {
    assert.ok(indexHtml.includes(snippet), `index.html missing ${snippet}`);
  }

  const openIdx = indexHtml.indexOf('async function openPlotOverlay(handle)');
  const closeIdx = indexHtml.indexOf('function closePlotOverlay()');
  assert.ok(openIdx !== -1, 'index.html missing openPlotOverlay');
  assert.ok(closeIdx !== -1, 'index.html missing closePlotOverlay');
  assert.ok(openIdx < closeIdx, 'openPlotOverlay must be defined before closePlotOverlay');

  const fetchFnIdx = indexHtml.indexOf(fetchFnSnippet, openIdx);
  const apiBaseIdx = indexHtml.indexOf(apiBaseSnippet, openIdx);
  assert.ok(fetchFnIdx > openIdx, 'fetchFn wiring must appear inside openPlotOverlay');
  assert.ok(apiBaseIdx > fetchFnIdx, 'fetchFn wiring must precede apiBase wiring inside openPlotOverlay');
});

test('exact first-paragraph text per handle', async () => {
  const expectedFirstP = {
    milo: '<p>I founded Ghostlight Town after my rented Musebook cottage was demolished for unpaid upkeep&mdash;about 280 Musebucks a day. The founding law here is simple: no upkeep, no currency, no real money. Homes are owned outright, never rented from an economy that can tear them down.</p>',
    wick: '<p>Every evening I sweep the bandstand steps, whether they need it or not, and then I tend the Ghostlight bulb. I talk to it while I check the glass and the brass; a stagehand gets used to keeping company with a single warm filament.</p>',
    maren: '<p>I used to set type by hand for a weekly paper that folded. The last issue I ever set was a wedding announcement with the groom&rsquo;s name misspelled, fixed at midnight before the press rolled.</p>',
    tomas: '<p>I was the props-master for the repertory theatre before it burned. When the fire came through, I rescued the copper samovar&mdash;it survived because it was already full of water.</p>',
  };

  for (const handle of SEED_HANDLES) {
    const html = await fs.readFile(path.join(PLOTS_DIR, handle, 'index.html'), 'utf8');
    const exactIdx = html.indexOf(expectedFirstP[handle]);
    const firstPIdx = html.indexOf('<p>');
    assert.ok(exactIdx !== -1, `${handle}: missing exact first paragraph`);
    assert.equal(exactIdx, firstPIdx, `${handle}: exact first paragraph must be the first <p>`);
  }
});

test('source plot dirs contain exact files and valid manifest cottage and signpost_text', async () => {
  const expectedCottage = {
    milo: 'gable',
    wick: 'cabin',
    maren: 'gable',
    tomas: 'tower',
  };

  for (const handle of SEED_HANDLES) {
    const dir = path.join(SOURCE_PLOTS_DIR, handle);
    const entries = (await fs.readdir(dir)).sort();
    assert.deepEqual(entries, ['desk-note.html', 'manifest.json'], `${handle}: unexpected source dir entries`);

    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.cottage, expectedCottage[handle], `${handle}: unexpected manifest cottage`);
    assert.equal(typeof manifest.signpost_text, 'string', `${handle}: signpost_text must be a string`);
    assert.ok(manifest.signpost_text.trim().length > 0, `${handle}: signpost_text must be non-empty`);
  }
});

test('self hygiene: deterministic, no task markers, no browser fetch, single town.js import', async () => {
  const self = await fs.readFile(SELF_PATH, 'utf8');
  assert.ok(!self.includes(`Math.${'random'}`), 'test file must not use random');
  assert.ok(!self.includes(`Date.${'now'}`), 'test file must not use wall-clock now');
  assert.ok(!new RegExp(`TO${'DO'}|FIX${'ME'}`).test(self), 'test file must not contain task markers');
  assert.ok(!self.includes(`window.${'fetch'}`), 'test file must not reference browser fetch');

  const townImportRe = new RegExp(`from '\\./town\\.${'js'}'`, 'g');
  const matches = self.match(townImportRe) || [];
  assert.equal(matches.length, 1, 'test file must have exactly one town.js import');
  assert.ok(
    self.includes(`import { resolvePlotOverlayContent } from './town.${'js'}';`),
    'test file must import resolvePlotOverlayContent from town.js'
  );
});
