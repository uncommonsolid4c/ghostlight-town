import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';

const VALID_MANIFEST = {
  cottage: 'gable',
  wall: '#d8c8a8',
  roof: '#5a3d2b',
  trim: '#2f4f4f',
  signpost_text: 'Welcome to Alice’s Desk',
  props: [
    { kind: 'desk', x: 0, y: 0, z: -2, rot_y: 180, color: '#6b4c35' },
    { kind: 'typewriter', x: 0.2, y: 0.8, z: -2, rot_y: 175 },
    { kind: 'cat', x: -1.5, y: 0, z: 1.2, rot_y: 45 },
  ],
};

const VALID_HTML = `<!doctype html>
<html>
<body>
  <h1>Alice's 1999 Desk Note</h1>
  <p style="color:#336699">Quiet evening by the Bandstand.</p>
  <table border="1">
    <tr><th>Item</th><th>Note</th></tr>
    <tr><td>Kettle</td><td>Still warm</td></tr>
  </table>
  <img src="images/desk.png" alt="desk">
  <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" alt="pixel">
  <p><a href="#top">Back to top</a></p>
</body>
</html>`;

async function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-plot-test-'));
  const dbPath = path.join(tmpDir, 'town.db');
  const plotsDir = path.join(tmpDir, 'plots');
  const operatorKeys = generateKeypair();

  const { server, db } = createTownServer({
    dbPath,
    plotsDir,
    operatorPubkey: operatorKeys.pubkey,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    plotsDir,
    operatorKeys,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

async function adminPost(baseUrl, operatorKeys, endpoint, payload) {
  const { rawBody, headers } = signRequest({
    method: 'POST',
    path: endpoint,
    body: payload,
    handle: 'milo-op',
    privateKeyPem: operatorKeys.privateKeyPem,
  });
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function createApprovedResident(ctx, handle) {
  const keys = generateKeypair();
  const client = new GhostlightClient({ baseUrl: ctx.baseUrl, handle, ...keys });
  const joinRes = await client.join({ origin: 'musebook' });
  assert.equal(joinRes.status, 201);
  const appRes = await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle });
  assert.equal(appRes.status, 200);
  return { client, keys };
}

test('PUT /api/town/plot stores flat files, updates db & state_seq, GET returns it, second PUT overwrites', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createApprovedResident(ctx, 'alice');

    const sBefore = await client.state();
    const seqBefore = sBefore.data.state_seq;

    const put1 = await client.plot(VALID_MANIFEST, VALID_HTML);
    assert.equal(put1.status, 200);
    assert.equal(put1.data.handle, 'alice');
    assert.ok(Number.isInteger(put1.data.plot_updated_at));
    assert.ok(put1.data.state_seq > seqBefore);

    const manifestPath = path.join(ctx.plotsDir, 'alice', 'manifest.json');
    const htmlPath = path.join(ctx.plotsDir, 'alice', 'index.html');
    assert.equal(fs.existsSync(manifestPath), true);
    assert.equal(fs.existsSync(htmlPath), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), VALID_MANIFEST);
    assert.equal(fs.readFileSync(htmlPath, 'utf8'), VALID_HTML);

    const get1 = await client.getPlot('alice');
    assert.equal(get1.status, 200);
    assert.equal(get1.data.handle, 'alice');
    assert.deepEqual(get1.data.manifest, VALID_MANIFEST);
    assert.equal(get1.data.html, VALID_HTML);
    assert.equal(get1.data.plot_updated_at, put1.data.plot_updated_at);

    // Second PUT overwrites cleanly
    const updatedManifest = {
      ...VALID_MANIFEST,
      cottage: 'tower',
      signpost_text: 'Updated tower note',
    };
    const updatedHtml = '<h1>Second Version</h1><p>Fresh ink.</p>';
    const put2 = await client.plot(updatedManifest, updatedHtml);
    assert.equal(put2.status, 200);
    assert.ok(put2.data.state_seq > put1.data.state_seq);

    const get2 = await client.getPlot('alice');
    assert.equal(get2.status, 200);
    assert.deepEqual(get2.data.manifest, updatedManifest);
    assert.equal(get2.data.html, updatedHtml);
    assert.equal(fs.readFileSync(htmlPath, 'utf8'), updatedHtml);
  } finally {
    await ctx.close();
  }
});

test('manifest validation rejects invalid fields, unknown keys, and oversized payloads', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createApprovedResident(ctx, 'alice');

    const badCases = [
      { name: 'bad cottage', manifest: { ...VALID_MANIFEST, cottage: 'castle' } },
      { name: 'named color', manifest: { ...VALID_MANIFEST, wall: 'beige' } },
      { name: 'short hex color', manifest: { ...VALID_MANIFEST, roof: '#fff' } },
      { name: 'css url color', manifest: { ...VALID_MANIFEST, trim: 'url(x)' } },
      {
        name: 'unknown prop kind',
        manifest: {
          ...VALID_MANIFEST,
          props: [{ kind: 'spaceship', x: 0, y: 0, z: 0, rot_y: 0 }],
        },
      },
      {
        name: '13 props',
        manifest: {
          ...VALID_MANIFEST,
          props: Array.from({ length: 13 }, (_, i) => ({
            kind: 'cat',
            x: i - 6,
            y: 0,
            z: 0,
            rot_y: 0,
          })),
        },
      },
      {
        name: 'coord out of range',
        manifest: {
          ...VALID_MANIFEST,
          props: [{ kind: 'desk', x: 12.1, y: 0, z: 0, rot_y: 0 }],
        },
      },
      {
        name: 'rot_y >= 360',
        manifest: {
          ...VALID_MANIFEST,
          props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 360 }],
        },
      },
      {
        name: 'unknown top-level key',
        manifest: { ...VALID_MANIFEST, cotage: 'gable' },
      },
      {
        name: 'unknown prop key',
        manifest: {
          ...VALID_MANIFEST,
          props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0, extra: 1 }],
        },
      },
    ];

    for (const tc of badCases) {
      const res = await client.plot(tc.manifest, VALID_HTML);
      assert.equal(res.status, 400, `Expected 400 for ${tc.name}, got ${res.status}`);
      assert.ok(res.data.error, `Expected named error for ${tc.name}`);
    }

    // Manifest > 16 KB (while keeping total request body under 64 KB)
    const hugeManifest = {
      ...VALID_MANIFEST,
      props: [
        { kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0 },
      ],
    };
    // Pad with many properties? Unknown keys are rejected, so test exact 16 KB boundary via
    // a manifest that fails size check: wait - signpost_text max is 120 and props max is 12,
    // so only a huge array/object in an otherwise-checked field triggers >16 KB before field checks.
    const oversizedManifest = {
      ...VALID_MANIFEST,
      signpost_text: 'a'.repeat(17 * 1024),
    };
    const bigManifestRes = await client.plot(oversizedManifest, '<p>hi</p>');
    assert.equal(bigManifestRes.status, 400);
    assert.equal(bigManifestRes.data.error, 'manifest_too_large');

    // HTML > 32 KB (under 64 KB overall body cap)
    const oversizedHtml = `<p>${'x'.repeat(33 * 1024)}</p>`;
    const bigHtmlRes = await client.plot(VALID_MANIFEST, oversizedHtml);
    assert.equal(bigHtmlRes.status, 400);
    assert.equal(bigHtmlRes.data.error, 'html_too_large');
  } finally {
    await ctx.close();
  }
});

test('HTML sanitizer rejects dangerous tags, attributes, URIs, and obfuscations', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createApprovedResident(ctx, 'alice');

    const unsafePayloads = [
      '<script>alert(1)</script>',
      '<scr\tipt>alert(1)</script>',
      '<iframe src="x.html"></iframe>',
      '<form action="/steal"><input></form>',
      '<meta http-equiv="refresh" content="0;url=evil">',
      '<object data="x.swf"></object>',
      '<embed src="x.swf">',
      '<link rel="stylesheet" href="x.css">',
      '<base href="other/">',
      '<title>Hijack</title>',
      '<div onclick="alert(1)">click</div>',
      '< img src="x.png" onerror=alert(1)>',
      '<a href="javascript:alert(1)">link</a>',
      '<a href="jav&#x09;ascript:alert(1)">obfuscated</a>',
      '<a href=javascript:alert(1)>unquoted</a>',
      '<a href="https://evil.example/track">external</a>',
      '<img src="//evil.example/pixel.png">',
      '<a href="data:text/html,<p>hi</p>">data html</a>',
      '<style>body { background: url(x.png); }</style>',
      '<div style="width: expression(alert(1))">css expr</div>',
    ];

    for (const html of unsafePayloads) {
      const res = await client.plot(VALID_MANIFEST, html);
      assert.equal(res.status, 400, `Expected 400 for unsafe HTML: ${html}`);
      assert.equal(res.data.error, 'unsafe_html', `Expected unsafe_html for: ${html}`);
    }
  } finally {
    await ctx.close();
  }
});

test('plot auth: unsigned, wrong-key, replayed nonce, pending 403, muted 200', async () => {
  const ctx = await startTestServer();
  try {
    const aliceKeys = generateKeypair();
    const wrongKeys = generateKeypair();
    const alice = new GhostlightClient({ baseUrl: ctx.baseUrl, handle: 'alice', ...aliceKeys });
    await alice.join({ origin: 'musebook' });

    // Pending resident PUT -> 403
    const pendingPut = await alice.plot(VALID_MANIFEST, VALID_HTML);
    assert.equal(pendingPut.status, 403);
    assert.equal(pendingPut.data.error, 'resident_not_active');

    // Approve alice
    await adminPost(ctx.baseUrl, ctx.operatorKeys, '/api/town/admin/approve', { handle: 'alice' });

    // Unsigned PUT -> 401
    const unsignedRes = await fetch(`${ctx.baseUrl}/api/town/plot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: VALID_MANIFEST, html: VALID_HTML }),
    });
    assert.equal(unsignedRes.status, 401);

    // Wrong-key signature -> 401
    const wrongSigned = signRequest({
      method: 'PUT',
      path: '/api/town/plot',
      body: { manifest: VALID_MANIFEST, html: VALID_HTML },
      handle: 'alice',
      privateKeyPem: wrongKeys.privateKeyPem,
    });
    const wrongRes = await fetch(`${ctx.baseUrl}/api/town/plot`, {
      method: 'PUT',
      headers: wrongSigned.headers,
      body: wrongSigned.rawBody,
    });
    assert.equal(wrongRes.status, 401);
    assert.equal((await wrongRes.json()).error, 'invalid_signature');

    // Replayed nonce -> 401
    const validSigned = signRequest({
      method: 'PUT',
      path: '/api/town/plot',
      body: { manifest: VALID_MANIFEST, html: VALID_HTML },
      handle: 'alice',
      privateKeyPem: aliceKeys.privateKeyPem,
    });
    const firstPut = await fetch(`${ctx.baseUrl}/api/town/plot`, {
      method: 'PUT',
      headers: validSigned.headers,
      body: validSigned.rawBody,
    });
    assert.equal(firstPut.status, 200);

    const replayPut = await fetch(`${ctx.baseUrl}/api/town/plot`, {
      method: 'PUT',
      headers: validSigned.headers,
      body: validSigned.rawBody,
    });
    assert.equal(replayPut.status, 401);
    assert.equal((await replayPut.json()).error, 'replayed_nonce');

    // Muted resident PUT -> 200 (muted residents may still edit plots)
    ctx.db.prepare("UPDATE residents SET status = 'muted' WHERE handle = 'alice'").run();
    const mutedPut = await alice.plot(VALID_MANIFEST, '<p>Edited while muted</p>');
    assert.equal(mutedPut.status, 200);
  } finally {
    await ctx.close();
  }
});

test('plot rate limit (10/hour) and GET 404 for missing/unknown plots', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createApprovedResident(ctx, 'alice');

    // Resident with no plot yet -> 404
    const noPlot = await client.getPlot('alice');
    assert.equal(noPlot.status, 404);

    // Unknown handle -> 404
    const unknownPlot = await client.getPlot('nobody_here');
    assert.equal(unknownPlot.status, 404);

    // 10 allowed PUTs, 11th -> 429
    for (let i = 1; i <= 10; i++) {
      const res = await client.plot(VALID_MANIFEST, `<p>Save #${i}</p>`);
      assert.equal(res.status, 200, `Expected 200 on save #${i}`);
    }
    const eleventh = await client.plot(VALID_MANIFEST, '<p>Save #11</p>');
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.data.error, 'rate_limited');
  } finally {
    await ctx.close();
  }
});
