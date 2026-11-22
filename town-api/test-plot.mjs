import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTownServer } from './server.mjs';
import { GhostlightClient, generateKeypair, signRequest } from './ghostlight-client.mjs';
import { validateHtml, validateManifest, VALID_PROP_KINDS } from './plot-validation.mjs';

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

    // Slice 93: lantern and planter are accepted in the starter prop catalog
    const slice93Res = await client.plot(
      {
        ...VALID_MANIFEST,
        props: [
          { kind: 'lantern', x: -1.8, y: 0, z: 2.2, rot_y: 0, color: '#6b492b' },
          { kind: 'planter', x: 1.8, y: 0, z: 2.2, rot_y: 180, color: '#6b492b' },
        ],
      },
      VALID_HTML
    );
    assert.equal(slice93Res.status, 200, 'lantern and planter props must validate');

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

test('validateHtml allows exact viewport meta and rejects all other meta tags', () => {
  const allowed = [
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"><p>ok</p>',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" /><p>ok</p>',
    '<meta content="width=device-width, initial-scale=1.0" name="viewport"><p>ok</p>',
    '<meta content="width=device-width, initial-scale=1.0" name="viewport" /><p>ok</p>',
    '<META NAME="VIEWPORT" CONTENT=" width=device-width, initial-scale=1.0 "><p>ok</p>',
  ];
  for (const html of allowed) {
    const res = validateHtml(html);
    assert.deepEqual(res, { ok: true }, `Expected ok for allowed viewport meta: ${html}`);
  }

  const rejected = [
    '<meta http-equiv="refresh" content="0;url=https://example.com">',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=500">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" data-x="1">',
    '<meta name="viewport">',
    '</meta name="viewport" content="width=device-width, initial-scale=1.0">',
  ];
  for (const html of rejected) {
    const res = validateHtml(html);
    assert.equal(res.ok, false, `Expected rejection for: ${html}`);
    assert.equal(res.error, 'unsafe_html', `Expected unsafe_html for: ${html}`);
    assert.equal(res.reason, 'forbidden_tag:meta', `Expected forbidden_tag:meta for: ${html}`);
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

test('validateManifest boundaries: 12 props, 120/121 signpost_text, x=12/12.0001, rot_y=359.999', () => {
  const twelveProps = Array.from({ length: 12 }, (_, i) => ({
    kind: 'cat',
    x: i - 6,
    y: 0,
    z: 0,
    rot_y: 0,
  }));
  const res12 = validateManifest({ ...VALID_MANIFEST, props: twelveProps });
  assert.equal(res12.ok, true);
  assert.equal(res12.manifest.props.length, 12);

  const resSign120 = validateManifest({ ...VALID_MANIFEST, signpost_text: 'a'.repeat(120) });
  assert.equal(resSign120.ok, true);
  assert.equal(resSign120.manifest.signpost_text.length, 120);

  const resSign121 = validateManifest({ ...VALID_MANIFEST, signpost_text: 'a'.repeat(121) });
  assert.deepEqual(resSign121, { ok: false, error: 'invalid_signpost_text', max: 120 });

  const resX12 = validateManifest({
    ...VALID_MANIFEST,
    props: [{ kind: 'desk', x: 12, y: 0, z: 0, rot_y: 0 }],
  });
  assert.equal(resX12.ok, true);

  const resXOver = validateManifest({
    ...VALID_MANIFEST,
    props: [{ kind: 'desk', x: 12.0001, y: 0, z: 0, rot_y: 0 }],
  });
  assert.deepEqual(resXOver, { ok: false, error: 'prop_coord_out_of_range', axis: 'x', index: 0 });

  const resRot = validateManifest({
    ...VALID_MANIFEST,
    props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 359.999 }],
  });
  assert.equal(resRot.ok, true);
});

test('validateManifest defaults, shape errors, and VALID_PROP_KINDS catalog', () => {
  const minimal = {
    cottage: 'gable',
    wall: '#d8c8a8',
    roof: '#5a3d2b',
    trim: '#2f4f4f',
  };
  assert.deepEqual(validateManifest(minimal), {
    ok: true,
    manifest: {
      cottage: 'gable',
      wall: '#d8c8a8',
      roof: '#5a3d2b',
      trim: '#2f4f4f',
      signpost_text: '',
      props: [],
    },
  });

  const noCottage = { wall: '#d8c8a8', roof: '#5a3d2b', trim: '#2f4f4f' };
  assert.deepEqual(validateManifest(noCottage), { ok: false, error: 'invalid_cottage' });
  assert.deepEqual(validateManifest(null), { ok: false, error: 'invalid_manifest' });
  assert.deepEqual(validateManifest([]), { ok: false, error: 'invalid_manifest' });

  assert.deepEqual(Array.from(VALID_PROP_KINDS), [
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
});

test('validateHtml URI reasons, image data URI, and HTML comments', () => {
  assert.deepEqual(validateHtml('<a href="vbscript:msgbox(1)">x</a>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'vbscript_uri',
  });
  assert.deepEqual(validateHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'disallowed_data_uri',
  });
  assert.deepEqual(validateHtml('<a href="&#106;avascript:alert(1)">x</a>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(
    validateHtml('<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">'),
    { ok: true }
  );
  assert.deepEqual(validateHtml('<!-- <script>alert(1)</script> --><p>ok</p>'), { ok: true });
});

test('validateHtml CSS, mixed-case event attr reasons, and non-string inputs', () => {
  assert.deepEqual(validateHtml('<div style="background:url(evil.png)">x</div>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'css_url',
  });
  assert.deepEqual(validateHtml('<div style="width:expression(alert(1))">x</div>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'css_expression',
  });
  assert.deepEqual(validateHtml('<div OnClick="x()">x</div>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'forbidden_attr:onclick',
  });
  assert.deepEqual(validateHtml(undefined), { ok: false, error: 'missing_html' });
  assert.deepEqual(validateHtml(42), { ok: false, error: 'missing_html' });
});

test('GET /api/town/state plots map tracks plot_updated_at across PUTs', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createApprovedResident(ctx, 'alice');

    const s0 = await client.state();
    assert.equal(s0.status, 200);
    assert.deepEqual(s0.data.plots, {});
    assert.equal(Object.hasOwn(s0.data.plots, 'alice'), false);

    const put1 = await client.plot(VALID_MANIFEST, VALID_HTML);
    assert.equal(put1.status, 200);
    assert.ok(Number.isInteger(put1.data.plot_updated_at));

    const s1 = await client.state();
    assert.equal(s1.status, 200);
    assert.equal(s1.data.plots.alice, put1.data.plot_updated_at);

    const put2 = await client.plot(
      { ...VALID_MANIFEST, signpost_text: 'Second visit' },
      '<p>Updated note</p>'
    );
    assert.equal(put2.status, 200);

    const s2 = await client.state();
    assert.equal(s2.status, 200);
    assert.equal(s2.data.plots.alice, put2.data.plot_updated_at);
  } finally {
    await ctx.close();
  }
});

test('PUT /api/town/plot rejects malformed bodies (null/array manifest, missing html/manifest)', async () => {
  const ctx = await startTestServer();
  try {
    const { keys } = await createApprovedResident(ctx, 'alice');

    const cases = [
      { body: { manifest: null, html: VALID_HTML }, expectedError: 'invalid_manifest' },
      { body: { manifest: [], html: VALID_HTML }, expectedError: 'invalid_manifest' },
      { body: { manifest: VALID_MANIFEST }, expectedError: 'missing_html' },
      { body: { html: VALID_HTML }, expectedError: 'missing_manifest' },
    ];

    for (const tc of cases) {
      const signed = signRequest({
        method: 'PUT',
        path: '/api/town/plot',
        body: tc.body,
        handle: 'alice',
        privateKeyPem: keys.privateKeyPem,
      });
      const res = await fetch(`${ctx.baseUrl}/api/town/plot`, {
        method: 'PUT',
        headers: signed.headers,
        body: signed.rawBody,
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, tc.expectedError);
    }
  } finally {
    await ctx.close();
  }
});

test('validateManifest field and shape errors', () => {
  assert.equal(validateManifest({ ...VALID_MANIFEST, wall: '#D8C8A8' }).ok, true);

  const { wall: _w, ...noWall } = VALID_MANIFEST;
  assert.deepEqual(validateManifest(noWall), {
    ok: false,
    error: 'invalid_color',
    field: 'wall',
  });
  assert.deepEqual(validateManifest({ ...VALID_MANIFEST, wall: 0xd8c8a8 }), {
    ok: false,
    error: 'invalid_color',
    field: 'wall',
  });

  assert.deepEqual(validateManifest({ ...VALID_MANIFEST, cottage: 'GABLE' }), {
    ok: false,
    error: 'invalid_cottage',
  });
  const { cottage: _c, ...noCottage } = VALID_MANIFEST;
  assert.deepEqual(validateManifest(noCottage), {
    ok: false,
    error: 'invalid_cottage',
  });

  assert.deepEqual(validateManifest({ ...VALID_MANIFEST, signpost_text: 42 }), {
    ok: false,
    error: 'invalid_signpost_text',
    max: 120,
  });

  assert.deepEqual(validateManifest({ ...VALID_MANIFEST, props: 'desk' }), {
    ok: false,
    error: 'invalid_props',
  });
  assert.deepEqual(validateManifest({ ...VALID_MANIFEST, props: [null] }), {
    ok: false,
    error: 'invalid_prop',
    index: 0,
  });
  assert.deepEqual(validateManifest({ ...VALID_MANIFEST, props: [[]] }), {
    ok: false,
    error: 'invalid_prop',
    index: 0,
  });
  assert.deepEqual(
    validateManifest({ ...VALID_MANIFEST, props: [{ x: 0, y: 0, z: 0, rot_y: 0 }] }),
    { ok: false, error: 'invalid_prop_kind', index: 0 }
  );
  assert.deepEqual(
    validateManifest({ ...VALID_MANIFEST, props: [{ kind: 'desk', y: 0, z: 0, rot_y: 0 }] }),
    { ok: false, error: 'prop_coord_out_of_range', axis: 'x', index: 0 }
  );
  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0, color: '#fff' }],
    }),
    { ok: false, error: 'invalid_prop_color', index: 0 }
  );

  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0 }],
    }),
    {
      ok: true,
      manifest: {
        cottage: 'gable',
        wall: '#d8c8a8',
        roof: '#5a3d2b',
        trim: '#2f4f4f',
        signpost_text: 'Welcome to Alice’s Desk',
        props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0 }],
      },
    }
  );
});

test('validateManifest coord/rotation boundaries and size ordering', () => {
  assert.equal(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: -12, z: 0, rot_y: 0 }],
    }).ok,
    true
  );
  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: 12.0001, z: 0, rot_y: 0 }],
    }),
    { ok: false, error: 'prop_coord_out_of_range', axis: 'y', index: 0 }
  );

  assert.equal(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: 0, z: -12, rot_y: 0 }],
    }).ok,
    true
  );
  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: 0, z: 12.0001, rot_y: 0 }],
    }),
    { ok: false, error: 'prop_coord_out_of_range', axis: 'z', index: 0 }
  );

  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: -1 }],
    }),
    { ok: false, error: 'invalid_prop_rotation', index: 0 }
  );
  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: NaN }],
    }),
    { ok: false, error: 'invalid_prop_rotation', index: 0 }
  );
  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: '180' }],
    }),
    { ok: false, error: 'invalid_prop_rotation', index: 0 }
  );
  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: NaN, y: 0, z: 0, rot_y: 0 }],
    }),
    { ok: false, error: 'prop_coord_out_of_range', axis: 'x', index: 0 }
  );

  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      cottage: 'castle',
      signpost_text: 'a'.repeat(17 * 1024),
    }),
    { ok: false, error: 'manifest_too_large', max: 16384 }
  );
});

test('validateHtml URI obfuscation and URI-attr coverage', () => {
  assert.deepEqual(validateHtml('<a href="JAVASCRIPT:alert(1)">x</a>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<a href="java\tscript:alert(1)">x</a>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<a href="javascript&colon;alert(1)">x</a>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<a href="jav&Tab;ascript:alert(1)">x</a>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<button formaction="javascript:alert(1)">x</button>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<table background="https://evil.example/x.png">x</table>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'external_uri',
  });
  assert.deepEqual(validateHtml('<q cite="javascript:alert(1)">x</q>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<div data="javascript:alert(1)">x</div>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<a href="HTTPS://evil.example/x">x</a>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'external_uri',
  });
  assert.deepEqual(validateHtml('<video poster="https://evil.example/x.png"></video>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'external_uri',
  });
  assert.deepEqual(validateHtml('<a href="notes/page.html">x</a>'), { ok: true });
  assert.deepEqual(validateHtml('<a href="VBSCRIPT:msgbox(1)">x</a>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'vbscript_uri',
  });
});

test('validateHtml style-block, comment, and unterminated-tag edges', () => {
  assert.deepEqual(validateHtml('<div style="background:javascript:alert(1)">x</div>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'javascript_uri',
  });
  assert.deepEqual(validateHtml('<style>/* hide */ body { background: url(evil.png); }</style>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'css_url',
  });
  assert.deepEqual(validateHtml('<style>p { color: red; }</style><p>x</p>'), { ok: true });
  assert.deepEqual(validateHtml('<!-- <script>alert(1)'), { ok: true });
  assert.deepEqual(validateHtml('<script'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'forbidden_tag:script',
  });
  assert.deepEqual(validateHtml(''), { ok: true });
  assert.deepEqual(validateHtml('<!-- just a note -->'), { ok: true });
  assert.deepEqual(validateHtml('<style>div { width: expr/**/ession(alert(1)); }</style>'), {
    ok: false,
    error: 'unsafe_html',
    reason: 'css_expression',
  });
  assert.deepEqual(validateHtml('</style><p>x</p>'), { ok: true });
});

test('failed PUTs do not consume quota or bump state_seq; limits are per-resident', async () => {
  const ctx = await startTestServer();
  try {
    const { client: alice } = await createApprovedResident(ctx, 'alice');
    const { client: bob } = await createApprovedResident(ctx, 'bob');

    const s0 = await alice.state();
    assert.equal(s0.status, 200);
    const seq0 = s0.data.state_seq;

    for (let i = 0; i < 10; i++) {
      const badPut = await alice.plot({ ...VALID_MANIFEST, cottage: 'castle' }, '<p>hi</p>');
      assert.equal(badPut.status, 400);
    }

    const sAfterFail = await alice.state();
    assert.equal(sAfterFail.status, 200);
    assert.equal(sAfterFail.data.state_seq, seq0);

    for (let i = 1; i <= 10; i++) {
      const goodPut = await alice.plot(VALID_MANIFEST, `<p>Save #${i}</p>`);
      assert.equal(goodPut.status, 200);
    }

    const eleventh = await alice.plot(VALID_MANIFEST, '<p>Save #11</p>');
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.data.error, 'rate_limited');
    assert.equal(Number.isInteger(eleventh.data.retry_after) && eleventh.data.retry_after >= 1, true);

    const bobPut = await bob.plot(VALID_MANIFEST, '<p>bob first</p>');
    assert.equal(bobPut.status, 200);
  } finally {
    await ctx.close();
  }
});

test('PUT stores the normalized manifest; plots are isolated; GET handle validation; empty html', async () => {
  const ctx = await startTestServer();
  try {
    const { client: carol } = await createApprovedResident(ctx, 'carol');
    const { client: dave } = await createApprovedResident(ctx, 'dave');

    const minimalManifest = {
      cottage: 'cabin',
      wall: '#aabbcc',
      roof: '#112233',
      trim: '#445566',
    };
    const carolPut = await carol.plot(minimalManifest, '<p>carol note</p>');
    assert.equal(carolPut.status, 200);

    const storedManifest = JSON.parse(
      fs.readFileSync(path.join(ctx.plotsDir, 'carol', 'manifest.json'), 'utf8')
    );
    assert.deepEqual(storedManifest, {
      cottage: 'cabin',
      wall: '#aabbcc',
      roof: '#112233',
      trim: '#445566',
      signpost_text: '',
      props: [],
    });

    const davePut = await dave.plot(VALID_MANIFEST, '<p>dave note</p>');
    assert.equal(davePut.status, 200);

    const carolGet = await carol.getPlot('carol');
    assert.equal(carolGet.status, 200);
    assert.equal(carolGet.data.html, '<p>carol note</p>');

    const stateRes = await carol.state();
    assert.equal(stateRes.status, 200);
    assert.ok(stateRes.data.plots.carol);
    assert.ok(stateRes.data.plots.dave);

    const noHandleRes = await fetch(`${ctx.baseUrl}/api/town/plot`);
    assert.equal(noHandleRes.status, 400);
    assert.equal((await noHandleRes.json()).error, 'invalid_handle');

    for (const badHandle of ['ALICE', 'a', 'a/b', 'alice..x', 'a b']) {
      const badRes = await fetch(
        `${ctx.baseUrl}/api/town/plot?handle=${encodeURIComponent(badHandle)}`
      );
      assert.equal(badRes.status, 400);
      assert.equal((await badRes.json()).error, 'invalid_handle');
    }

    const carolEmptyPut = await carol.plot(minimalManifest, '');
    assert.equal(carolEmptyPut.status, 200);

    const carolEmptyGet = await carol.getPlot('carol');
    assert.equal(carolEmptyGet.status, 200);
    assert.equal(carolEmptyGet.data.html, '');
  } finally {
    await ctx.close();
  }
});

test('PUT/GET response shapes are exact; second PUT bumps state_seq by exactly 1', async () => {
  const ctx = await startTestServer();
  try {
    const { client } = await createApprovedResident(ctx, 'alice');

    const put1 = await client.plot(VALID_MANIFEST, VALID_HTML);
    assert.equal(put1.status, 200);
    assert.deepEqual(Object.keys(put1.data).sort(), ['handle', 'plot_updated_at', 'state_seq']);
    assert.equal(put1.data.handle, 'alice');

    const get1 = await client.getPlot('alice');
    assert.equal(get1.status, 200);
    assert.deepEqual(Object.keys(get1.data).sort(), ['handle', 'html', 'manifest', 'plot_updated_at']);

    const put2 = await client.plot(VALID_MANIFEST, '<p>updated</p>');
    assert.equal(put2.status, 200);
    assert.equal(put2.data.state_seq, put1.data.state_seq + 1);
    assert.ok(put2.data.plot_updated_at >= put1.data.plot_updated_at);

    const missing = await client.getPlot('nobody');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.data, { error: 'plot_not_found' });
  } finally {
    await ctx.close();
  }
});

test('validateManifest names unknown keys and too_many_props exactly', () => {
  assert.deepEqual(validateManifest({ ...VALID_MANIFEST, cotage: 'gable' }), {
    ok: false,
    error: 'unknown_manifest_key',
    key: 'cotage',
  });
  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0, extra: 1 }],
    }),
    { ok: false, error: 'unknown_prop_key', key: 'extra', index: 0 }
  );
  assert.deepEqual(
    validateManifest({
      ...VALID_MANIFEST,
      props: Array.from({ length: 13 }, () => ({ kind: 'cat', x: 0, y: 0, z: 0, rot_y: 0 })),
    }),
    { ok: false, error: 'too_many_props', max: 12 }
  );
});

test('validateManifest preserves hex case and counts signpost_text in characters', () => {
  const hexRes = validateManifest({
    ...VALID_MANIFEST,
    wall: '#D8C8A8',
    roof: '#AA00FF',
    trim: '#112233',
    props: [{ kind: 'desk', x: 0, y: 0, z: 0, rot_y: 0, color: '#ABCDEF' }],
  });
  assert.equal(hexRes.ok, true);
  assert.equal(hexRes.manifest.wall, '#D8C8A8');
  assert.equal(hexRes.manifest.roof, '#AA00FF');
  assert.equal(hexRes.manifest.trim, '#112233');
  assert.equal(hexRes.manifest.props[0].color, '#ABCDEF');

  assert.equal(
    validateManifest({ ...VALID_MANIFEST, signpost_text: 'é'.repeat(120) }).ok,
    true
  );
  assert.deepEqual(
    validateManifest({ ...VALID_MANIFEST, signpost_text: 'é'.repeat(121) }),
    { ok: false, error: 'invalid_signpost_text', max: 120 }
  );

  for (const cottage of ['gable', 'cabin', 'tower']) {
    assert.equal(validateManifest({ ...VALID_MANIFEST, cottage }).ok, true);
  }
});

test('validateHtml allows safe everyday desk-note markup', () => {
  const safeInputs = [
    '<ul><li>one</li><li>two</li></ul>',
    '<p>Hello <em>Bandstand</em> and <strong>ghost</strong></p>',
    '<blockquote>quoted line</blockquote>',
    '<a href="plots/wick">Wick</a>',
    '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
    '<p title="a > b">quoted gt</p>',
    '<a href="?x=1">query only</a>',
    '<a href="">empty href</a>',
    '<hr><h2>Sub</h2><p>x</p>',
    '<ol><li>a</li></ol><dl><dt>term</dt><dd>def</dd></dl>',
    VALID_HTML,
  ];
  for (const html of safeInputs) {
    assert.deepEqual(validateHtml(html), { ok: true });
  }
});

test('validateManifest/validateHtml size boundaries are exact', () => {
  // '<p>' (3) + 32761 + '</p>' (4) = 32768 bytes (max); 32762 -> 32769 bytes
  assert.deepEqual(validateHtml('<p>' + 'x'.repeat(32761) + '</p>'), { ok: true });
  assert.deepEqual(validateHtml('<p>' + 'x'.repeat(32762) + '</p>'), {
    ok: false,
    error: 'html_too_large',
    max: 32768,
  });

  // VALID_MANIFEST with 16114-char signpost serializes to 16384 bytes (passes size check -> invalid_signpost_text); 16115 -> 16385 bytes
  assert.deepEqual(
    validateManifest({ ...VALID_MANIFEST, signpost_text: 'a'.repeat(16114) }),
    { ok: false, error: 'invalid_signpost_text', max: 120 }
  );
  assert.deepEqual(
    validateManifest({ ...VALID_MANIFEST, signpost_text: 'a'.repeat(16115) }),
    { ok: false, error: 'manifest_too_large', max: 16384 }
  );
});

test('PUT ignores a body handle field and failed PUTs leave the stored plot untouched', async () => {
  const ctx = await startTestServer();
  try {
    const { client, keys } = await createApprovedResident(ctx, 'alice');

    const signed = signRequest({
      method: 'PUT',
      path: '/api/town/plot',
      body: { handle: 'bob', manifest: VALID_MANIFEST, html: VALID_HTML },
      handle: 'alice',
      privateKeyPem: keys.privateKeyPem,
    });
    const res = await fetch(`${ctx.baseUrl}/api/town/plot`, {
      method: 'PUT',
      headers: signed.headers,
      body: signed.rawBody,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.handle, 'alice');

    const bobGet = await client.getPlot('bob');
    assert.equal(bobGet.status, 404);

    const manifestPath = path.join(ctx.plotsDir, 'alice', 'manifest.json');
    const htmlPath = path.join(ctx.plotsDir, 'alice', 'index.html');
    const manifestBefore = fs.readFileSync(manifestPath);
    const htmlBefore = fs.readFileSync(htmlPath);
    const stateBefore = await client.state();
    assert.equal(stateBefore.status, 200);

    const badManifestPut = await client.plot({ ...VALID_MANIFEST, cottage: 'castle' }, VALID_HTML);
    assert.equal(badManifestPut.status, 400);

    const badHtmlPut = await client.plot(VALID_MANIFEST, '<script>alert(1)</script>');
    assert.equal(badHtmlPut.status, 400);

    assert.deepEqual(fs.readFileSync(manifestPath), manifestBefore);
    assert.deepEqual(fs.readFileSync(htmlPath), htmlBefore);

    const stateAfter = await client.state();
    assert.equal(stateAfter.status, 200);
    assert.equal(stateAfter.data.plots.alice, stateBefore.data.plots.alice);
  } finally {
    await ctx.close();
  }
});
