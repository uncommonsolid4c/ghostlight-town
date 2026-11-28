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
  assert.equal(suites.length, 67, `Expected 67 TEST_SUITES entries, got ${suites.length}`);

  const rootAndScripts = suites.filter((s) => !s.includes('/') || s.startsWith('scripts/')).length;
  const town3d = suites.filter((s) => s.startsWith('town-3d/')).length;
  const townApi = suites.filter((s) => s.startsWith('town-api/')).length;
  const townNpc = suites.filter((s) => s.startsWith('town-npc/')).length;
  const stagingPolyfork = suites.filter((s) => s.startsWith('staging-polyfork/')).length;

  assert.equal(rootAndScripts, 9, `Expected 9 root & scripts suites, got ${rootAndScripts}`);
  assert.equal(town3d, 7, `Expected 7 town-3d suites, got ${town3d}`);
  assert.equal(townApi, 23, `Expected 23 town-api suites, got ${townApi}`);
  assert.equal(townNpc, 7, `Expected 7 town-npc suites, got ${townNpc}`);
  assert.equal(stagingPolyfork, 21, `Expected 21 staging-polyfork suites, got ${stagingPolyfork}`);
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

test('invalid GHOSTLIGHT_TEST_SUITES JSON exits 1 with a clean error, no stack trace, no TOTAL', async () => {
  const res = await runRunner([], {
    GHOSTLIGHT_TEST_SUITES: '{not json',
  });

  assert.equal(res.code, 1, `Expected exit 1 for invalid JSON, got ${res.code}`);
  assert.match(res.stderr, /invalid JSON/i);
  assert.doesNotMatch(res.stderr, /\n    at /);
  assert.equal(res.stdout, '');
});

test('string GHOSTLIGHT_TEST_SUITES JSON exits 1 with a clean array error, not per-character suites', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-strjson-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'a.mjs'),
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
      GHOSTLIGHT_TEST_SUITES: JSON.stringify('a.mjs'),
    });

    assert.equal(res.code, 1, `Expected exit 1 for string JSON, got ${res.code}`);
    assert.match(res.stderr, /must be a JSON array/i);
    assert.doesNotMatch(res.stderr, /\n    at /);
    assert.equal(res.stdout, '');
    assert.doesNotMatch(res.stdout, /a MISSING/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('number GHOSTLIGHT_TEST_SUITES JSON exits 1 with a clean array error', async () => {
  const res = await runRunner([], {
    GHOSTLIGHT_TEST_SUITES: '123',
  });

  assert.equal(res.code, 1, `Expected exit 1 for number JSON, got ${res.code}`);
  assert.match(res.stderr, /must be a JSON array/i);
  assert.doesNotMatch(res.stderr, /\n    at /);
  assert.equal(res.stdout, '');
});

test('object GHOSTLIGHT_TEST_SUITES JSON exits 1 with a clean array error', async () => {
  const res = await runRunner([], {
    GHOSTLIGHT_TEST_SUITES: '{"a":1}',
  });

  assert.equal(res.code, 1, `Expected exit 1 for object JSON, got ${res.code}`);
  assert.match(res.stderr, /must be a JSON array/i);
  assert.doesNotMatch(res.stderr, /\n    at /);
  assert.equal(res.stdout, '');
});

test('non-string GHOSTLIGHT_TEST_SUITES entry exits 1 naming the entry index, before any suite runs', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-nonstring-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'a.mjs'),
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
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['a.mjs', 42]),
    });

    assert.equal(res.code, 1, `Expected exit 1 for non-string entry, got ${res.code}`);
    assert.match(res.stderr, /entry 1 is not a string/);
    assert.doesNotMatch(res.stderr, /\n    at /);
    assert.equal(res.stdout, '');
    assert.doesNotMatch(res.stdout, /a\.mjs pass=/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('nonexistent GHOSTLIGHT_TEST_ROOT reports every suite MISSING with a TOTAL', async () => {
  const res = await runRunner([], {
    GHOSTLIGHT_TEST_ROOT: '/tmp/does-not-exist-ghostlight-320',
    GHOSTLIGHT_TEST_SUITES: JSON.stringify(['x.mjs', 'y.mjs']),
  });

  assert.equal(res.code, 1, `Expected exit 1 for nonexistent root, got ${res.code}`);
  assert.match(res.stdout, /^x\.mjs MISSING$/m);
  assert.match(res.stdout, /^y\.mjs MISSING$/m);
  assert.match(res.stdout, /^TOTAL pass=0 fail=2 skipped=0 suites=2$/m);
});

test('a suite printing both a summary and a skip JSON counts the summary, not the skip', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-both-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'both.mjs'),
      [
        "console.log('ℹ tests 2');",
        "console.log('ℹ pass 2');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
        'console.log(JSON.stringify({ status: "skip", reason: "also here" }));',
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['both.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0 when summary has fail=0, got ${res.code}`);
    assert.match(res.stdout, /^both\.mjs pass=2 fail=0 skipped=0$/m);
    assert.match(res.stdout, /^TOTAL pass=2 fail=0 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Note: the Node stack tail for a directory suite is a known wart left alone in this slice.
test('a directory listed as a suite errors cleanly with a TOTAL', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-dir-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'adir.mjs'));

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['adir.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1 for directory suite, got ${res.code}`);
    assert.match(res.stdout, /^adir\.mjs ERROR \(exit 1, no parseable summary\)$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--help documents the GHOSTLIGHT_TEST_SUITES override', async () => {
  const res = await runRunner(['--help']);

  assert.equal(res.code, 0, `Expected exit 0 for --help, got ${res.code}`);
  assert.match(res.stdout, /GHOSTLIGHT_TEST_SUITES/);
  assert.match(res.stdout, /Usage:/);
  assert.match(res.stdout, /skip/i);
});

test('--help prints the live suite count and all six areas', async () => {
  const suites = extractTestSuites();
  const res = await runRunner(['--help']);

  assert.equal(res.code, 0, `Expected exit 0 for --help, got ${res.code}`);
  const countMatch = res.stdout.match(/(\d+) explicit suites/);
  assert.ok(countMatch, 'Expected --help output to print "<n> explicit suites"');
  assert.equal(Number(countMatch[1]), suites.length);
  for (const area of ['repo root', 'scripts/', 'staging-polyfork/', 'town-3d/', 'town-api/', 'town-npc/']) {
    assert.equal(res.stdout.includes(area), true, `Expected --help output to include ${area}`);
  }
});

test('TEST_SUITES has no duplicates and no session/ or argon-concept-test/ entries', () => {
  const suites = extractTestSuites();
  assert.equal(new Set(suites).size, suites.length);
  assert.equal(suites.some((s) => s.startsWith('session/')), false);
  assert.equal(suites.some((s) => s.startsWith('argon-concept-test/')), false);
});

test('TEST_SUITES section comment numbers match computed counts', () => {
  const src = fs.readFileSync(RUNNER_PATH, 'utf8');
  const suites = extractTestSuites();
  const comments = [...src.matchAll(/^  \/\/ (.+?) \((\d+)\)$/gm)];
  assert.equal(comments.length, 5, `Expected 5 section comments, got ${comments.length}`);

  const expected = {
    'root & scripts': suites.filter((s) => !s.includes('/') || s.startsWith('scripts/')).length,
    'town-3d': suites.filter((s) => s.startsWith('town-3d/')).length,
    'town-api': suites.filter((s) => s.startsWith('town-api/')).length,
    'town-npc': suites.filter((s) => s.startsWith('town-npc/')).length,
    'staging-polyfork': suites.filter((s) => s.startsWith('staging-polyfork/')).length,
  };

  for (const [, label, num] of comments) {
    assert.equal(Number(num), expected[label], `Section comment ${label} (${num}) should match ${expected[label]}`);
  }
});

test('TEST_SUITES sections are ordered and contiguous', () => {
  const suites = extractTestSuites();
  const first = (pred) => suites.findIndex(pred);
  const idx = [
    first((s) => !s.includes('/') || s.startsWith('scripts/')),
    first((s) => s.startsWith('town-3d/')),
    first((s) => s.startsWith('town-api/')),
    first((s) => s.startsWith('town-npc/')),
    first((s) => s.startsWith('staging-polyfork/')),
  ];
  assert.equal(idx.every((i) => i >= 0), true, `Expected all sections present, got ${JSON.stringify(idx)}`);
  assert.equal(
    idx.every((v, i) => i === 0 || v > idx[i - 1]),
    true,
    `Expected section first-indices strictly increasing, got ${JSON.stringify(idx)}`
  );

  const sectionOf = (s) =>
    !s.includes('/') || s.startsWith('scripts/')
      ? 0
      : s.startsWith('town-3d/')
        ? 1
        : s.startsWith('town-api/')
          ? 2
          : s.startsWith('town-npc/')
            ? 3
            : 4;
  const seq = suites.map(sectionOf);
  assert.equal(
    seq.every((v, i) => i === 0 || v >= seq[i - 1]),
    true,
    'Expected TEST_SUITES sections to be contiguous (non-decreasing)'
  );
});

test('summary with skipped > 0, fail=0, and exit 0 is a green pass', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-skip-pass-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 's.mjs'),
      [
        "console.log('ℹ tests 3');",
        "console.log('ℹ pass 2');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 1');",
      ].join('\n') + '\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['s.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^s\.mjs pass=2 fail=0 skipped=1$/m);
    assert.match(res.stdout, /^TOTAL pass=2 fail=0 skipped=1 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('exit 2 with a valid fail=0 summary names exit 2 and preserves skipped', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-exit2-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 's.mjs'),
      [
        "console.log('ℹ tests 2');",
        "console.log('ℹ pass 2');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 1');",
        'process.exit(2);',
      ].join('\n') + '\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['s.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1, got ${res.code}`);
    assert.match(res.stdout, /^s\.mjs ERROR \(exit 2 with fail=0 in summary\)$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=1 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reason-less skip JSON still counts as a skip', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-skip-no-reason-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 's.mjs'),
      'console.log(JSON.stringify({ status: "skip" }));\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['s.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^s\.mjs pass=0 fail=0 skipped=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('missing, failing, and skipping suites in one run sum correctly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-mix-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'bad.mjs'),
      [
        "console.log('ℹ tests 2');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 1');",
        "console.log('ℹ skipped 0');",
      ].join('\n') + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'sk.mjs'),
      'console.log(JSON.stringify({ status: "skip", reason: "x" }));\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['gone.mjs', 'bad.mjs', 'sk.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1, got ${res.code}`);
    assert.match(res.stdout, /^gone\.mjs MISSING$/m);
    assert.match(res.stdout, /^bad\.mjs pass=1 fail=1 skipped=0$/m);
    assert.match(res.stdout, /^sk\.mjs pass=0 fail=0 skipped=1$/m);
    assert.match(res.stdout, /^TOTAL pass=1 fail=2 skipped=1 suites=3$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('suite lines print in list order and TOTAL is the last line', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-order-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'a.mjs'),
      [
        "console.log('ℹ tests 1');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n') + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'b.mjs'),
      [
        "console.log('ℹ tests 1');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n') + '\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['a.mjs', 'b.mjs']),
    });

    const lines = res.stdout.split(/\r?\n/).filter(Boolean);
    assert.match(lines[lines.length - 1] || '', /^TOTAL /);
    assert.ok(res.stdout.indexOf('a.mjs pass=') < res.stdout.indexOf('b.mjs pass='));
    assert.ok(res.stdout.indexOf('b.mjs pass=') < res.stdout.indexOf('TOTAL '));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CRLF summary lines parse cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-crlf-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'crlf.mjs'),
      "process.stdout.write('ℹ tests 2\\r\\n');\nprocess.stdout.write('ℹ pass 2\\r\\n');\nprocess.stdout.write('ℹ fail 0\\r\\n');\nprocess.stdout.write('ℹ skipped 0\\r\\n');\n",
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['crlf.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^crlf\.mjs pass=2 fail=0 skipped=0$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 441: --help beats invalid GHOSTLIGHT_TEST_SUITES JSON and extra arguments (G1)', async () => {
  const res = await runRunner(['--help', 'extra'], { GHOSTLIGHT_TEST_SUITES: '{not json' });
  assert.equal(res.code, 0, `Expected exit 0 for --help with bad JSON override, got ${res.code}`);
  assert.match(res.stdout, /Usage:/);
  assert.equal(res.stderr, '', 'Expected --help to print nothing to stderr');
});

test('Slice 441: a subdirectory suite path resolves under the override root (G2)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-subdir-'));
  try {
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'sub', 's.mjs'),
      [
        "console.log('ℹ tests 1');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n') + '\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['sub/s.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0 for subdirectory suite, got ${res.code}`);
    assert.match(res.stdout, /^sub\/s\.mjs pass=1 fail=0 skipped=0$/m);
    assert.match(res.stdout, /^TOTAL pass=1 fail=0 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 441: an absolute suite path is MISSING, path.join does not reset to it (G3)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-absolute-'));
  try {
    const abs = path.join(tmpDir, 'abs.mjs');
    fs.writeFileSync(
      abs,
      [
        "console.log('ℹ tests 1');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n') + '\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify([abs]),
    });

    assert.equal(res.code, 1, `Expected exit 1 for absolute suite path, got ${res.code}`);
    const escaped = abs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(res.stdout, new RegExp(`^${escaped} MISSING$`, 'm'));
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 441: skip JSON with extra fields counts, capital-S Skip does not (G4)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-skip-fields-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'extra.mjs'),
      'console.log(JSON.stringify({ status: "skip", reason: "x", extra: 1 }));\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'caps.mjs'),
      'console.log(JSON.stringify({ status: "Skip", reason: "x" }));\n',
      'utf8'
    );

    const resSkip = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['extra.mjs']),
    });
    assert.equal(resSkip.code, 0, `Expected exit 0 for extra-fields skip JSON, got ${resSkip.code}`);
    assert.match(resSkip.stdout, /^extra\.mjs pass=0 fail=0 skipped=1$/m);

    const resCaps = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['caps.mjs']),
    });
    assert.equal(resCaps.code, 1, `Expected exit 1 for capital-S Skip, got ${resCaps.code}`);
    assert.match(resCaps.stdout, /^caps\.mjs ERROR \(exit 0, no parseable summary\)$/m);
    assert.match(resCaps.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 441: a leading-space summary does not parse, a trailing-space summary does (G5)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-spacing-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'lead.mjs'),
      [
        "console.log(' ℹ tests 1');",
        "console.log(' ℹ pass 1');",
        "console.log(' ℹ fail 0');",
        "console.log(' ℹ skipped 0');",
      ].join('\n') + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'trail.mjs'),
      [
        "console.log('ℹ tests 1 ');",
        "console.log('ℹ pass 1 ');",
        "console.log('ℹ fail 0 ');",
        "console.log('ℹ skipped 0 ');",
      ].join('\n') + '\n',
      'utf8'
    );

    const resLead = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['lead.mjs']),
    });
    assert.equal(resLead.code, 1, `Expected exit 1 for leading-space summary, got ${resLead.code}`);
    assert.match(resLead.stdout, /^lead\.mjs ERROR \(exit 0, no parseable summary\)$/m);

    const resTrail = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['trail.mjs']),
    });
    assert.equal(resTrail.code, 0, `Expected exit 0 for trailing-space summary, got ${resTrail.code}`);
    assert.match(resTrail.stdout, /^trail\.mjs pass=1 fail=0 skipped=0$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 441: a non-numeric pass value errors and a huge numeric pass totals (G6)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-numbers-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'word.mjs'),
      [
        "console.log('ℹ tests 3');",
        "console.log('ℹ pass three');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n') + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDir, 'huge.mjs'),
      [
        "console.log('ℹ tests 999999999');",
        "console.log('ℹ pass 999999999');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n') + '\n',
      'utf8'
    );

    const resWord = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['word.mjs']),
    });
    assert.equal(resWord.code, 1, `Expected exit 1 for non-numeric pass, got ${resWord.code}`);
    assert.match(resWord.stdout, /^word\.mjs ERROR \(exit 0, no parseable summary\)$/m);

    const resHuge = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['huge.mjs']),
    });
    assert.equal(resHuge.code, 0, `Expected exit 0 for huge numeric pass, got ${resHuge.code}`);
    assert.match(resHuge.stdout, /^huge\.mjs pass=999999999 fail=0 skipped=0$/m);
    assert.match(resHuge.stdout, /^TOTAL pass=999999999 fail=0 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 441: an error tail merges stderr lines with stdout lines (G7)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-errtail-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'errtail.mjs'),
      [
        "process.stderr.write('err tail line\\n');",
        "console.log('plain stdout line');",
        'process.exit(1);',
      ].join('\n') + '\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['errtail.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1, got ${res.code}`);
    assert.match(res.stdout, /^errtail\.mjs ERROR \(exit 1, no parseable summary\)$/m);
    const tailLines = res.stdout.split(/\r?\n/).filter((l) => l.startsWith('  | '));
    assert.equal(tailLines.includes('  | err tail line'), true, 'Expected stderr line in tail');
    assert.equal(tailLines.includes('  | plain stdout line'), true, 'Expected stdout line in tail');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 441: a null suite entry names index 0 and an empty-string entry errors on the root dir (G8)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-entries-'));
  try {
    const resNull = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify([null]),
    });
    assert.equal(resNull.code, 1, `Expected exit 1 for null entry, got ${resNull.code}`);
    assert.match(resNull.stderr, /entry 0 is not a string/);
    assert.equal(resNull.stdout, '');

    const resEmpty = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['']),
    });
    assert.equal(resEmpty.code, 1, `Expected exit 1 for empty-string entry, got ${resEmpty.code}`);
    assert.match(resEmpty.stdout, /^ ERROR \(exit 1, no parseable summary\)$/m);
    assert.match(resEmpty.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 441: green and MISSING runs print nothing to stderr (G9)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-quiet-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'ok.mjs'),
      [
        "console.log('ℹ tests 1');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n') + '\n',
      'utf8'
    );

    const resGreen = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['ok.mjs']),
    });
    assert.equal(resGreen.code, 0, `Expected exit 0, got ${resGreen.code}`);
    assert.equal(resGreen.stderr, '', 'Expected a green run to print nothing to stderr');

    const resMissing = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['gone.mjs']),
    });
    assert.equal(resMissing.code, 1, `Expected exit 1, got ${resMissing.code}`);
    assert.equal(resMissing.stderr, '', 'Expected a MISSING run to print nothing to stderr');
    assert.match(resMissing.stdout, /^gone\.mjs MISSING$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: file hygiene - 61 unique test names, 8 import lines, and pinned literal counts (P10)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'test-run-tests.mjs'), 'utf8');
  const names = [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 61);
  assert.equal(new Set(names).size, 61);
  for (const name of names) {
    assert.equal(name.includes("'"), false, 'test names must contain no apostrophes');
  }
  const lines = src.split('\n');
  assert.equal(lines.filter((l) => l.startsWith('import ')).length, 8);
  const countLines = (needle) => lines.filter((l) => l.includes(needle)).length;
  assert.equal(countLines('fet' + 'ch('), 0);
  assert.equal(countLines('Date' + '.now'), 0);
  assert.equal(countLines('Math' + '.random'), 0);
  assert.equal(countLines('TO' + 'DO'), 0);
  assert.equal(countLines('FIX' + 'ME'), 0);
  assert.equal(countLines('inner' + 'HTML'), 0);
  assert.equal(lines.filter((l) => new RegExp('camp' + 'fire', 'i').test(l)).length, 0);
});

test('Slice 507: a summary without the tests line still parses (P1)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'no-tests-line.mjs'),
      [
        "console.log('ℹ pass 2');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 1');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['no-tests-line.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^no-tests-line\.mjs pass=2 fail=0 skipped=1$/m);
    assert.match(res.stdout, /^TOTAL pass=2 fail=0 skipped=1 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: an unknown flag is ignored and override suites still run (P2)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'ok.mjs'),
      [
        "console.log('ℹ tests 1');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner(['--bogus'], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['ok.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^ok\.mjs pass=1 fail=0 skipped=0$/m);
    assert.match(res.stdout, /^TOTAL pass=1 fail=0 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: a suite runs with cwd equal to the override root (P3)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'cwd-stub.mjs'),
      [
        "import fs from 'node:fs';",
        "fs.writeFileSync('cwd.txt', process.cwd());",
        "console.log('ℹ tests 1');",
        "console.log('ℹ pass 1');",
        "console.log('ℹ fail 0');",
        "console.log('ℹ skipped 0');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['cwd-stub.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^cwd-stub\.mjs pass=1 fail=0 skipped=0$/m);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'cwd.txt'), 'utf8'), tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: a leading-whitespace skip JSON line still counts as a skip (P4)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'padded-skip.mjs'),
      'console.log(\'   {"status":"skip","reason":"padded"}\');\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['padded-skip.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^padded-skip\.mjs pass=0 fail=0 skipped=1$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=0 skipped=1 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: two skip JSON lines count as exactly one skip (P5)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'two-skips.mjs'),
      [
        'console.log(JSON.stringify({ status: "skip", reason: "first" }));',
        'console.log(JSON.stringify({ status: "skip", reason: "second" }));',
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['two-skips.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^two-skips\.mjs pass=0 fail=0 skipped=1$/m);
    assert.match(res.stdout, /^TOTAL pass=0 fail=0 skipped=1 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: a CRLF skip JSON line still counts as a skip (P6)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'crlf-skip.mjs'),
      'process.stdout.write(JSON.stringify({ status: "skip", reason: "crlf" }) + "\\r\\n");\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['crlf-skip.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^crlf-skip\.mjs pass=0 fail=0 skipped=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: a summary split across stdout and stderr parses and totals (P7)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'split-streams.mjs'),
      [
        "console.log('ℹ tests 5');",
        "console.log('ℹ pass 4');",
        "console.error('ℹ fail 1');",
        "console.error('ℹ skipped 0');",
        'process.exit(1);',
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['split-streams.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1, got ${res.code}`);
    assert.match(res.stdout, /^split-streams\.mjs pass=4 fail=1 skipped=0$/m);
    assert.match(res.stdout, /^TOTAL pass=4 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: leading-zero summary numbers parse as their numeric value (P8)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'leading-zero.mjs'),
      [
        "console.log('ℹ tests 007');",
        "console.log('ℹ pass 007');",
        "console.log('ℹ fail 000');",
        "console.log('ℹ skipped 00');",
      ].join('\n'),
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['leading-zero.mjs']),
    });

    assert.equal(res.code, 0, `Expected exit 0, got ${res.code}`);
    assert.match(res.stdout, /^leading-zero\.mjs pass=7 fail=0 skipped=0$/m);
    assert.match(res.stdout, /^TOTAL pass=7 fail=0 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: skip JSON with trailing garbage after the brace is ignored, not a skip (P9)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, 'trailing-garbage.mjs'),
      'console.log(\'{"status":"skip"} trailing\');\n',
      'utf8'
    );

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['trailing-garbage.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1, got ${res.code}`);
    assert.match(res.stdout, /^trailing-garbage\.mjs ERROR \(exit 0, no parseable summary\)$/m);
    assert.equal(res.stdout.includes('  | {"status":"skip"} trailing'), true);
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Slice 507: empty output with exit 0 errors with no tail lines (P10)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-runner-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'silent.mjs'), '\n', 'utf8');

    const res = await runRunner([], {
      GHOSTLIGHT_TEST_ROOT: tmpDir,
      GHOSTLIGHT_TEST_SUITES: JSON.stringify(['silent.mjs']),
    });

    assert.equal(res.code, 1, `Expected exit 1, got ${res.code}`);
    assert.match(res.stdout, /^silent\.mjs ERROR \(exit 0, no parseable summary\)$/m);
    assert.equal(res.stdout.split('\n').some((l) => l.startsWith('  | ')), false);
    assert.match(res.stdout, /^TOTAL pass=0 fail=1 skipped=0 suites=1$/m);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
