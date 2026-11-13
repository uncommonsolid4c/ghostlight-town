#!/usr/bin/env node
/**
 * Ghostlight Town — single repo-root test runner (Slice 27)
 *
 * Why this exists:
 *   Earlier sessions kept miscounting the suite total: `test-*.mjs` globs
 *   missed `town-api/test.mjs`, env-gated skips were counted inconsistently
 *   (sometimes as a pass, sometimes as a skip), and totals had to be
 *   re-derived by hand. This runner executes every suite in one command and
 *   reports deterministic totals.
 *
 * Explicit suite list:
 *   Suites are listed explicitly below rather than discovered by glob so new
 *   test files are added deliberately and never silently skipped or missed.
 *   If a listed file is missing, the runner reports it as a failure and
 *   continues running the remaining suites.
 *
 * Skip convention:
 *   A skip is always counted as a skip, never as a pass, and skips never fail
 *   the run. Both `node:test` skipped counts (`ℹ skipped N`) and env-gated
 *   suites that exit 0 with a `{"status":"skip",...}` JSON line (such as
 *   `town-api/test-live-proxy.mjs`) count toward `skipped`.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_SUITES = [
  // root & scripts (3)
  'test-run-tests.mjs',
  'scripts/test-check-live.mjs',
  'scripts/test-stage-deploy.mjs',
  // town-3d (4)
  'town-3d/test-3d-live.mjs',
  'town-3d/test-3d.mjs',
  'town-3d/test-desk-notes.mjs',
  'town-3d/test-gazette.mjs',
  // town-api (8)
  'town-api/test-backup-plots.mjs',
  'town-api/test-backup.mjs',
  'town-api/test-build-gate.mjs',
  'town-api/test-ghostlight-client-cli.mjs',
  'town-api/test-live-proxy.mjs',
  'town-api/test-onboarding.mjs',
  'town-api/test-plot.mjs',
  'town-api/test.mjs',
  // town-npc (5)
  'town-npc/test-npc.mjs',
  'town-npc/test-plots.mjs',
  'town-npc/test-real-brain.mjs',
  'town-npc/test-register.mjs',
  'town-npc/test-run-all.mjs',
];

function printHelp() {
  const lines = [
    'Usage: node run-tests.mjs [--help]',
    '',
    'Runs all Ghostlight Town test suites sequentially from the repo root:',
    `  - ${TEST_SUITES.length} explicit suites across repo root, scripts/, town-3d/, town-api/, and town-npc/`,
    '  - Set GHOSTLIGHT_TEST_ROOT to override the repo root for suite resolution/cwd',
    '',
    'Skip convention:',
    '  - `node:test` `ℹ skipped N` and env-gated `{"status":"skip",...}` JSON lines',
    '    (exit 0) are counted as skipped, never as pass.',
    '  - Skips never fail the run.',
    '',
    'Exit codes:',
    '  0  All suites ran with fail=0 and no missing or errored suites',
    '  1  One or more suites failed, errored, or were missing',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function parseNodeTestSummary(output) {
  const passMatches = [...output.matchAll(/^ℹ pass (\d+)\s*$/gm)];
  const failMatches = [...output.matchAll(/^ℹ fail (\d+)\s*$/gm)];
  const skippedMatches = [...output.matchAll(/^ℹ skipped (\d+)\s*$/gm)];

  if (passMatches.length === 0 || failMatches.length === 0 || skippedMatches.length === 0) {
    return null;
  }

  return {
    pass: Number(passMatches[passMatches.length - 1][1]),
    fail: Number(failMatches[failMatches.length - 1][1]),
    skipped: Number(skippedMatches[skippedMatches.length - 1][1]),
  };
}

function parseSkipJson(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && parsed.status === 'skip') {
        return true;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return false;
}

function lastFiveLines(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-5);
}

function runSuite(rootDir, suiteRelPath) {
  const suiteAbsPath = path.join(rootDir, suiteRelPath);
  if (!fs.existsSync(suiteAbsPath)) {
    return { kind: 'missing', pass: 0, fail: 1, skipped: 0, tail: [] };
  }

  const res = spawnSync(process.execPath, [suiteAbsPath], {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
  });

  const combined = `${res.stdout || ''}${res.stderr || ''}`;
  const exitCode = typeof res.status === 'number' ? res.status : 1;

  if (res.error) {
    return {
      kind: 'error',
      reason: res.error.message,
      pass: 0,
      fail: 1,
      skipped: 0,
      tail: lastFiveLines(combined),
    };
  }

  const summary = parseNodeTestSummary(combined);
  if (summary) {
    if (exitCode !== 0 && summary.fail === 0) {
      return {
        kind: 'error',
        reason: `exit ${exitCode} with fail=0 in summary`,
        pass: 0,
        fail: 1,
        skipped: summary.skipped,
        tail: lastFiveLines(combined),
      };
    }
    return {
      kind: 'summary',
      pass: summary.pass,
      fail: summary.fail,
      skipped: summary.skipped,
      tail: [],
    };
  }

  if (exitCode === 0 && parseSkipJson(combined)) {
    return {
      kind: 'summary',
      pass: 0,
      fail: 0,
      skipped: 1,
      tail: [],
    };
  }

  return {
    kind: 'error',
    reason: `exit ${exitCode}, no parseable summary`,
    pass: 0,
    fail: 1,
    skipped: 0,
    tail: lastFiveLines(combined),
  };
}

function main() {
  if (process.argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const rootDir = process.env.GHOSTLIGHT_TEST_ROOT
    ? path.resolve(process.env.GHOSTLIGHT_TEST_ROOT)
    : __dirname;

  const suites = process.env.GHOSTLIGHT_TEST_SUITES
    ? JSON.parse(process.env.GHOSTLIGHT_TEST_SUITES)
    : TEST_SUITES;

  let totalPass = 0;
  let totalFail = 0;
  let totalSkipped = 0;
  let hasErrorOrMissing = false;

  for (const suite of suites) {
    const result = runSuite(rootDir, suite);
    totalPass += result.pass;
    totalFail += result.fail;
    totalSkipped += result.skipped;

    if (result.kind === 'missing') {
      hasErrorOrMissing = true;
      console.log(`${suite} MISSING`);
    } else if (result.kind === 'error') {
      hasErrorOrMissing = true;
      console.log(`${suite} ERROR (${result.reason})`);
      for (const line of result.tail) {
        console.log(`  | ${line}`);
      }
    } else {
      console.log(`${suite} pass=${result.pass} fail=${result.fail} skipped=${result.skipped}`);
    }
  }

  console.log(
    `TOTAL pass=${totalPass} fail=${totalFail} skipped=${totalSkipped} suites=${suites.length}`
  );

  process.exit(totalFail === 0 && !hasErrorOrMissing ? 0 : 1);
}

main();
