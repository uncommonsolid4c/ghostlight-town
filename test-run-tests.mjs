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
