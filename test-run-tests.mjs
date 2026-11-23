/**
 * Ghostlight Town — tests for the repo-root test runner (Slice 27)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_PATH = path.join(__dirname, 'run-tests.mjs');

async function runRunner(args = [], env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [RUNNER_PATH, ...args], {
      cwd: __dirname,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

test('aggregates node:test summaries and env-gated skip JSON accurately', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    const stubPass = path.join(tmpDir, 'stub-pass.mjs');
    const stubFail = path.join(tmpDir, 'stub-fail.mjs');
    const stubSkip = path.join(tmpDir, 'stub-skip.mjs');

    fs.writeFileSync(
      stubPass,
      [
        "console.log('ℹ tests 3');",
        "console.log('ℹ pass 3');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      stubFail,
      [
        "console.log('ℹ tests 3');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 1');",
        "console.log('ℹ skipped 1');",
        'process.exit(1);',
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      stubSkip,
      'console.log(JSON.stringify({ status: "skip", reason: "env var unset" }));\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub-pass.mjs', 'stub-fail.mjs', 'stub-skip.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1 when a suite fails, got ${res.code}`);
    assert.match(res.stdout, /^stub-pass\.mjs pass=3 fail=0 skipped=0$/m);
    assert.match(res.stdout, /^stub-fail\.mjs pass=1 fail=1 skipped=1$/m);
    assert.match(res.stdout, /^stub-skip\.mjs pass=0 fail=0 skipped=1$/m);
    assert.match(res.stdout, /^TOTAL pass=4 fail=1 skipped=2 suites=3$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reports missing listed suite as failure, exits 1, and still runs remaining suites', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-missing-'));
  try {
    const stubOk = path.join(tmpDir, 'stub-ok.mjs');
    fs.writeFileSync(
      stubOk,
      [
        "console.log('ℹ tests 2');",
        "console.log('ℹ pass 2');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['does-not-exist.mjs', 'stub-ok.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1 when a suite is missing, got ${res.code}`);
    assert.match(res.stdout, /^does-not-exist\.mjs MISSING$/m);
    assert.match(res.stdout, /^stub-ok\.mjs pass=2 fail=0 skipped=0$/m);
    assert.match(res.stdout, /^TOTAL pass=2 fail=1 skipped=0 suites=2$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--help exits 0 and documents the skip convention', async () => {
  const res = await runRunner(['--help']);
  assert.equal(res.code, 0, `Expected exit 0 for --help, got ${res.code}`);
  assert.match(res.stdout, /Usage:/);
  assert.match(res.stdout, /skip/i);
  assert.match(res.stdout, /never as pass/i);
});

test('no legacy gathering-place terminology in runner or its tests', () => {
  const forbidden = new RegExp('camp' + 'fire', 'i');
  for (const file of ['run-tests.mjs', 'test-run-tests.mjs']) {
    const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(forbidden.test(content), false, `${file} must not contain legacy terminology`);
  }
});

function extractTestSuites() {
  const src = fs.readFileSync(RUNNER_PATH, 'utf8');
  const match = src.match(/const TEST_SUITES = \[([\s\S]*?)\];/);
  assert.ok(match, 'Could not find TEST_SUITES array in run-tests.mjs');
  const entries = [];
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '');
    const strMatch = line.match(/'([^']+)'/);
    if (strMatch) entries.push(strMatch[1]);
  }
  return entries;
}

function walkTestFiles(dir, relPrefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'argon-concept-test' ||
      entry.name === 'session' ||
      entry.name === '.git'
    ) {
      continue;
    }
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkTestFiles(abs, rel));
    } else if (
      (entry.name.startsWith('test-') && entry.name.endsWith('.mjs')) ||
      rel === 'town-api/test.mjs'
    ) {
      found.push(rel);
    }
  }
  return found;
}

test('TEST_SUITES length and per-prefix section counts match run-tests.mjs comments', () => {
  const suites = extractTestSuites();
  assert.equal(suites.length, 66, `Expected 66 TEST_SUITES entries, got ${suites.length}`);

  const rootAndScripts = suites.filter((s) => !s.includes('/') || s.startsWith('scripts/')).length;
  const town3d = suites.filter((s) => s.startsWith('town-3d/')).length;
  const townApi = suites.filter((s) => s.startsWith('town-api/')).length;
  const townNpc = suites.filter((s) => s.startsWith('town-npc/')).length;
  const stagingPolyfork = suites.filter((s) => s.startsWith('staging-polyfork/')).length;

  assert.equal(rootAndScripts, 9, `Expected 9 root & scripts suites, got ${rootAndScripts}`);
  assert.equal(town3d, 7, `Expected 7 town-3d suites, got ${town3d}`);
  assert.equal(townApi, 23, `Expected 23 town-api suites, got ${townApi}`);
  assert.equal(townNpc, 7, `Expected 7 town-npc suites, got ${townNpc}`);
  assert.equal(stagingPolyfork, 20, `Expected 20 staging-polyfork suites, got ${stagingPolyfork}`);
  assert.equal(rootAndScripts + town3d + townApi + townNpc + stagingPolyfork, suites.length);
});

test('every listed suite in TEST_SUITES exists on disk', () => {
  const suites = extractTestSuites();
  for (const suite of suites) {
    const abs = path.join(__dirname, suite);
    assert.equal(fs.existsSync(abs), true, `Listed suite does not exist on disk: ${suite}`);
  }
});

test('every test file on disk is listed in TEST_SUITES', () => {
  const suites = new Set(extractTestSuites());
  const onDisk = walkTestFiles(__dirname);
  assert.ok(onDisk.length > 0, 'Expected to find test files on disk');
  for (const file of onDisk) {
    assert.equal(suites.has(file), true, `Test file on disk is missing from TEST_SUITES: ${file}`);
  }
});

test('reports non-zero exit with fail=0 in summary as ERROR, fail=1, preserving skipped', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-nonzero-'));
  try {
    const stubErr = path.join(tmpDir, 'stub-nonzero.mjs');
    fs.writeFileSync(
      stubErr,
      [
        "console.log('ℹ tests 3');",
        "console.log('ℹ pass 2');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 1');",
        'process.exit(1);',
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub-nonzero.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1, got ${res.code}`);
    assert.match(res.stdout, /^stub-nonzero\.mjs ERROR \(exit 1 with fail=0 in summary\)$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=1 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reports exit 0 with no parseable summary and no skip JSON as ERROR with tail lines', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-nosummary-'));
  try {
    const stubPlain = path.join(tmpDir, 'stub-plain.mjs');
    fs.writeFileSync(stubPlain, "console.log('plain output line');\n", 'utf8');

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub-plain.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1, got ${res.code}`);
    assert.match(res.stdout, /^stub-plain\.mjs ERROR \(exit 0, no parseable summary\)$/m);
    assert.match(res.stdout, /^  \| plain output line$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('skip JSON precedence: buried with exit 0 skips, with exit 1 errors', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-skip-prec-'));
  try {
    const stubBuriedSkip = path.join(tmpDir, 'stub-buried-skip.mjs');
    const stubSkipExit1 = path.join(tmpDir, 'stub-skip-exit1.mjs');

    fs.writeFileSync(
      stubBuriedSkip,
      [
        "console.log('preamble line');",
        'console.log(JSON.stringify({ status: "skip", reason: "env var unset" }));',
        "console.log('trailing line');",
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      stubSkipExit1,
      [
        'console.log(JSON.stringify({ status: "skip", reason: "env var unset" }));',
        'process.exit(1);',
      ].join('\n'),
      'utf8'
    );

    const resSkip = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub-buried-skip.mjs']),
    });
    assert.equal(resSkip.code, 0, `Expected exit 0 for buried skip JSON, got ${resSkip.code}`);
    assert.match(resSkip.stdout, /^stub-buried-skip\.mjs pass=0 fail=0 skipped=1$/m);
    assert.match(resSkip.stdout, /^TOTAL pass=0 fail=0 skipped=1 suites=1$/m);

    const resErr = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub-skip-exit1.mjs']),
    });
    assert.equal(resErr.code, 1, `Expected exit 1 for skip JSON with exit 1, got ${resErr.code}`);
    assert.match(resErr.stdout, /^stub-skip-exit1\.mjs ERROR \(exit 1, no parseable summary\)$/m);
    assert.match(resErr.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exit 0 with a fail>0 summary still counts the failure and exits 1', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-fail-exit0-'));
  try {
    const stub = path.join(tmpDir, 'stub.mjs');
    fs.writeFileSync(
      stub,
      [
        "console.log('ℹ tests 3');",
        "console.log('ℹ pass 2');",
        "console.log('ℹ fail 1');",
        "console.log('ℹ skipped 0');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1 when summary has fail>0, got ${res.code}`);
    assert.match(res.stdout, /^stub\.mjs pass=2 fail=1 skipped=0$/m);
    assert.match(res.stdout, /^TOTAL pass=2 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('parses a node:test summary printed to stderr only', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-stderr-'));
  try {
    const stub = path.join(tmpDir, 'stub.mjs');
    fs.writeFileSync(
      stub,
      [
        "process.stderr.write('ℹ tests 4\\n');",
        "process.stderr.write('ℹ pass 4\\n');",
        "process.stderr.write('ℹ fail 0\\n');",
        "process.stderr.write('ℹ skipped 0\\n');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0 for stderr summary, got ${res.code}`);
    assert.match(res.stdout, /^stub\.mjs pass=4 fail=0 skipped=0$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('last summary wins when a suite prints two summary blocks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-two-summaries-'));
  try {
    const stub = path.join(tmpDir, 'stub.mjs');
    fs.writeFileSync(
      stub,
      [
        "console.log('ℹ tests 9');",
        "console.log('ℹ pass 9');",
        "console.log('ℹ fail 9');",
        "console.log('ℹ skipped 9');",
        "console.log('ℹ tests 2');",
        "console.log('ℹ pass 2');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0 when last summary has fail=0, got ${res.code}`);
    assert.match(res.stdout, /^stub\.mjs pass=2 fail=0 skipped=0$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a non-skip status JSON line is not a skip', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-nonskip-json-'));
  try {
    const stub = path.join(tmpDir, 'stub.mjs');
    fs.writeFileSync(
      stub,
      [
        'console.log(JSON.stringify({ status: "ok" }));',
        "console.log('{not json');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1 for non-skip status JSON, got ${res.code}`);
    assert.match(res.stdout, /^stub\.mjs ERROR \(exit 0, no parseable summary\)$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('error tail is capped at the last 5 lines', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-tail-'));
  try {
    const stub = path.join(tmpDir, 'stub.mjs');
    const lines = Array.from({ length: 8 }, (_, i) => `console.log('plain line ${i + 1}');`);
    fs.writeFileSync(stub, lines.join('\n'), 'utf8');

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1 for plain lines without summary, got ${res.code}`);
    const tailLines = res.stdout.split(/\r?\n/).filter((l) => l.startsWith('  | '));
    assert.equal(tailLines.length, 5, `Expected 5 tail lines, got ${tailLines.length}`);
    assert.equal(tailLines[0], '  | plain line 4');
    assert.equal(tailLines[4], '  | plain line 8');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GHOSTLIGHT_TEST_ROOT override resolves suites from the override root', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-root-'));
  try {
    const stub = path.join(tmpDir, 'stub-root.mjs');
    fs.writeFileSync(
      stub,
      [
        "console.log('ℹ tests 1');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['stub-root.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0 for override root, got ${res.code}`);
    assert.match(res.stdout, /^stub-root\.mjs pass=1 fail=0 skipped=0$/m);
    assert.match(res.stdout, /^TOTAL pass=1 fail=0 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('skips never fail the run: an all-skip run exits 0', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-allskip-'));
  try {
    const s1 = path.join(tmpDir, 's1.mjs');
    const s2 = path.join(tmpDir, 's2.mjs');
    fs.writeFileSync(
      s1,
      'console.log(JSON.stringify({ status: "skip", reason: "env var unset" }));\n',
      'utf8'
    );
    fs.writeFileSync(
      s2,
      'console.log(JSON.stringify({ status: "skip", reason: "env var unset" }));\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['s1.mjs', 's2.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0 for all-skip run, got ${res.code}`);
    assert.match(res.stdout, /^s1\.mjs pass=0 fail=0 skipped=1$/m);
    assert.match(res.stdout, /^s2\.mjs pass=0 fail=0 skipped=1$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=0 skipped=2 suites=2$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a throwing suite errors with the last-5-line tail, not the error line', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-boom-'));
  try {
    const boom = path.join(tmpDir, 'boom.mjs');
    fs.writeFileSync(boom, "throw new Error('boom-marker-247');\n", 'utf8');

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['boom.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1 for throwing suite, got ${res.code}`);
    assert.match(res.stdout, /^boom\.mjs ERROR \(exit 1, no parseable summary\)$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
    const tailLines = res.stdout.split(/\r?\n/).filter((l) => l.startsWith('  | '));
    assert.equal(tailLines.length, 5, `Expected 5 tail lines, got ${tailLines.length}`);
    assert.match(tailLines[4], /^  \| Node\.js v\d+\.\d+\.\d+$/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('skip JSON printed to stderr only still counts as a skip', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-errskip-'));
  try {
    const errskip = path.join(tmpDir, 'errskip.mjs');
    fs.writeFileSync(
      errskip,
      "process.stderr.write(JSON.stringify({ status: 'skip', reason: 'env var unset' }) + '\\n');\n",
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['errskip.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0 for stderr skip JSON, got ${res.code}`);
    assert.match(res.stdout, /^errskip\.mjs pass=0 fail=0 skipped=1$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=0 skipped=1 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('duplicate suite entries run twice and totals double', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-dup-'));
  try {
    const dup = path.join(tmpDir, 'dup.mjs');
    fs.writeFileSync(
      dup,
      [
        "console.log('ℹ tests 1');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['dup.mjs', 'dup.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0 for duplicate suite entries, got ${res.code}`);
    assert.match(res.stdout, /^TOTAL pass=2 fail=0 skipped=0 suites=2$/m);
    const matches = res.stdout.match(/^dup\.mjs pass=1 fail=0 skipped=0$/gm);
    assert.equal(matches?.length, 2, `Expected 2 suite lines, got ${matches?.length}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('an empty suite list exits 0 with TOTAL suites=0', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-empty-'));
  try {
    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify([]),
    });

    assert.equal(res.code, 0, `Expected exit 0 for empty suite list, got ${res.code}`);
    assert.match(res.stdout, /^TOTAL pass=0 fail=0 skipped=0 suites=0$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('a partial summary missing the skipped line errors, it is not a pass', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-partial-'));
  try {
    const partial = path.join(tmpDir, 'partial.mjs');
    fs.writeFileSync(
      partial,
      [
        "console.log('ℹ tests 3');",
        "console.log('ℹ pass 3');",
        "console.log('ℹ fail 0');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['partial.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1 for partial summary, got ${res.code}`);
    assert.match(res.stdout, /^partial\.mjs ERROR \(exit 0, no parseable summary\)$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
