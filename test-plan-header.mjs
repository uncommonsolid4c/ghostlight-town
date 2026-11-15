/**
 * Ghostlight Town — drift guard for PLAN.md header & §12.6 history (Slice 112)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = path.join(__dirname, 'PLAN.md');

test('PLAN.md **Status:** header does not pin a live state_seq and §12.6 history stays intact', () => {
  const planText = fs.readFileSync(PLAN_PATH, 'utf8');
  const statusLine = planText.split(/\r?\n/).find((line) => line.startsWith('**Status:**'));

  assert.ok(statusLine, 'PLAN.md must have a **Status:** header line');
  assert.doesNotMatch(
    statusLine,
    /state_seq[^0-9;)]*[0-9]/,
    'PLAN.md **Status:** header must not pin a live state_seq number'
  );
  assert.match(
    statusLine,
    /town API live since 2026-11-13/,
    'PLAN.md **Status:** header must retain town API live since 2026-11-13'
  );
  assert.match(
    statusLine,
    /§12\.6/,
    'PLAN.md **Status:** header must still point at §12.6'
  );
  assert.match(
    planText,
    /### 12\.6[\s\S]*?2026-11-13[\s\S]*?`state_seq` `83`/,
    'PLAN.md §12.6 historical state_seq 83 record must remain intact'
  );
});
