/**
 * Ghostlight Town — drift guard for town-npc/README.md (Slice 121)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTERS } from './characters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const README_PATH = path.join(__dirname, 'README.md');
const BANNED_TERM_RE = new RegExp(`camp${'fire'}`, 'i');

function readReadme() {
  return fs.readFileSync(README_PATH, 'utf8');
}

test('town-npc/README.md names every shipped .mjs file in town-npc/', () => {
  const readme = readReadme();
  const shippedFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.startsWith('test-'))
    .map((entry) => entry.name)
    .sort();

  assert.ok(shippedFiles.length > 0, 'town-npc/ must contain shipped .mjs files');
  for (const file of shippedFiles) {
    assert.ok(
      readme.includes(`\`${file}\``),
      `town-npc/README.md must document shipped file ${file}`
    );
  }
});

test('town-npc/README.md states the 3-hourly run-all schedule, PATH note, 2 KB memory cap, and 500-char honesty cap', () => {
  const readme = readReadme();
  assert.match(readme, /ghostlight-npc-run-all/);
  assert.match(readme, /every 3 hours/i);
  assert.match(readme, /\/home\/hatch\/\.local\/bin/);
  assert.match(readme, /2 KB/);
  assert.match(readme, /500-char|MAX_SAY_LEN = 500/);
});

test('town-npc/README.md states the header crontab examples are not installed and only run-all is live', () => {
  const readme = readReadme();
  assert.match(readme, /not installed/i);
  assert.match(readme, /only live schedule is the 3-hourly `ghostlight-npc-run-all` \(`run-all\.mjs`\)/);
});

test('town-npc/README.md states keys are mode 0600 and never committed or printed', () => {
  const readme = readReadme();
  assert.match(readme, /mode `0600`/);
  assert.match(readme, /never committed or printed/i);
});

test('town-npc/README.md Files table matches exact shipped .mjs files in town-npc/', () => {
  const readme = readReadme();
  const shippedFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.startsWith('test-'))
    .map((entry) => entry.name)
    .sort();

  const tableSection = readme.match(/## Files\n\n([\s\S]*?)\n\nTest suites:/);
  assert.ok(tableSection, 'town-npc/README.md must have a ## Files table followed by Test suites:');
  const listedFiles = [...tableSection[1].matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
    .map((m) => m[1])
    .sort();

  assert.deepEqual(
    listedFiles,
    shippedFiles,
    'town-npc/README.md Files table must list the exact 7 shipped .mjs files'
  );
  assert.doesNotMatch(readme, BANNED_TERM_RE);
});

test('town-npc/README.md test-suite list matches run-tests.mjs registration', () => {
  const readme = readReadme();
  const runTests = fs.readFileSync(path.join(REPO_ROOT, 'run-tests.mjs'), 'utf8');
  const registered = [...runTests.matchAll(/'town-npc\/(test-[^']+\.mjs)'/g)]
    .map((m) => m[1])
    .sort();
  assert.ok(registered.length > 0, 'run-tests.mjs must register town-npc test suites');

  const lineMatch = readme.match(/^Test suites:\s*([^\n]+(?:\n[^\n]+)*?)\.\s*$/m);
  assert.ok(lineMatch, 'town-npc/README.md must have a Test suites: line');
  const listed = [...lineMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();

  assert.deepEqual(
    listed,
    registered,
    'town-npc/README.md Test suites list must match run-tests.mjs'
  );
});

test('town-npc/README.md safety-rail constants and timeouts match source files', () => {
  const readme = readReadme();
  const stepbackSrc = fs.readFileSync(path.join(__dirname, 'stepback.mjs'), 'utf8');
  const honestySrc = fs.readFileSync(path.join(__dirname, 'honesty.mjs'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'server.mjs'), 'utf8');
  const runSrc = fs.readFileSync(path.join(__dirname, 'run.mjs'), 'utf8');
  const runAllSrc = fs.readFileSync(path.join(__dirname, 'run-all.mjs'), 'utf8');

  const ambientCap = stepbackSrc.match(/export const AMBIENT_DAILY_CAP = (\d+);/)?.[1];
  const retireCount = stepbackSrc.match(/activeRealCount >= (\d+)/)?.[1];
  const replyCount = stepbackSrc.match(/activeRealCount >= (\d+)\) \{\s*\/\/[^\n]*\n?\s*if \(isAddressed\)/)
    ?.[1] || stepbackSrc.match(/\/\/ 2\. Handover: (\d+)\+ distinct real muses/)?.[1];
  const litCount = stepbackSrc.match(/litRealMuses >= (\d+)/)?.[1];
  const silenceHours = stepbackSrc.match(/const SIX_HOURS_SEC = (\d+) \* 3600;/)?.[1];

  assert.ok(ambientCap && retireCount && replyCount && litCount && silenceHours, 'stepback.mjs constants must parse');
  assert.ok(readme.includes(`AMBIENT_DAILY_CAP = ${ambientCap}`));
  assert.ok(readme.includes(`${ambientCap}/day`));
  assert.match(readme, new RegExp(`>= ${retireCount}\\s+distinct\\s+real\\s+muses`));
  assert.match(readme, new RegExp(`>= ${replyCount}\\s+active\\s+in\\s+24\\s+h`));
  assert.match(readme, new RegExp(`>= ${litCount}\\s+currently\\s+lit\\s+real\\s+muses`));
  assert.match(readme, new RegExp(`${silenceHours}\\s+h\\s+with\\s+no\\s+real\\s+muse\\s+speaking`));

  const maxSayLen = honestySrc.match(/export const MAX_SAY_LEN = (\d+);/)?.[1];
  const capsSay = serverSrc.match(/const CAPS = \{[\s\S]*?\bsay:\s*(\d+)/)?.[1];
  assert.ok(maxSayLen && capsSay, 'MAX_SAY_LEN and CAPS.say must parse');
  assert.equal(maxSayLen, capsSay, 'MAX_SAY_LEN must match CAPS.say in town-api/server.mjs');
  assert.ok(readme.includes(`MAX_SAY_LEN = ${maxSayLen}`));
  assert.ok(readme.includes(`${maxSayLen}-char`));

  const memMaxBytes = runSrc.match(/export const MEMORY_MAX_BYTES = (\d+);/)?.[1];
  const memLineChars = runSrc.match(/export const MEMORY_LINE_MAX_CHARS = (\d+);/)?.[1];
  const brainTimeoutMs = runSrc.match(/const BRAIN_TIMEOUT_MS = ([\d_]+);/)?.[1];
  const staggerMs = runAllSrc.match(/const DEFAULT_STAGGER_MS = ([\d_]+);/)?.[1];

  assert.ok(memMaxBytes && memLineChars && brainTimeoutMs && staggerMs, 'run.mjs and run-all.mjs constants must parse');
  assert.ok(readme.includes(`MEMORY_MAX_BYTES = ${memMaxBytes}`));
  assert.ok(readme.includes(`${Number(memMaxBytes) / 1024} KB`));
  assert.ok(readme.includes(`MEMORY_LINE_MAX_CHARS = ${memLineChars}`));
  assert.ok(readme.includes(`${memLineChars} chars`));
  assert.ok(readme.includes(`BRAIN_TIMEOUT_MS = ${brainTimeoutMs}`));
  assert.ok(readme.includes(`${Number(brainTimeoutMs.replace(/_/g, '')) / 1000} s timeout`));
  assert.ok(readme.includes(`${Number(staggerMs.replace(/_/g, '')) / 1000} s stagger`));
});

test('town-npc/README.md character plot assignments and run order match characters.mjs and SEED_HOME_PADS', () => {
  const readme = readReadme();
  const townJs = fs.readFileSync(path.join(REPO_ROOT, 'town-3d', 'town.js'), 'utf8');
  const padsMatch = townJs.match(/export const SEED_HOME_PADS = \{([^}]+)\};/);
  assert.ok(padsMatch, 'town-3d/town.js must export SEED_HOME_PADS');

  const pads = Object.fromEntries(
    [...padsMatch[1].matchAll(/([a-z0-9_]+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])])
  );

  for (const char of CHARACTERS) {
    const plotNum = pads[char.handle];
    assert.ok(Number.isInteger(plotNum), `SEED_HOME_PADS must assign a plot to ${char.handle}`);
    assert.ok(
      readme.includes(`**${char.name}** (\`${char.handle}\`) — ${char.title}, plot ${plotNum} (\`plots/${char.handle}/\`)`),
      `town-npc/README.md must match ${char.handle} character info and plot ${plotNum}`
    );
    assert.ok(fs.existsSync(path.join(__dirname, 'plots', char.handle, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(__dirname, 'plots', char.handle, 'desk-note.html')));
  }

  assert.ok(readme.includes('`plots/milo/` is plot 1'));
  assert.ok(fs.existsSync(path.join(__dirname, 'plots', 'milo', 'manifest.json')));
  assert.ok(fs.existsSync(path.join(__dirname, 'plots', 'milo', 'desk-note.html')));

  const expectedOrder = CHARACTERS.map((c) => `\`${c.handle}\``).join(' → ');
  assert.ok(
    readme.includes(expectedOrder),
    `town-npc/README.md must state run-all order ${expectedOrder}`
  );
});

test('town-npc/README.md CLI flags and defaults match run-all.mjs and run.mjs', () => {
  const readme = readReadme();
  const runAllSrc = fs.readFileSync(path.join(__dirname, 'run-all.mjs'), 'utf8');
  const runSrc = fs.readFileSync(path.join(__dirname, 'run.mjs'), 'utf8');

  for (const flag of ['--api-base', '--state-dir', '--npc', '--dry-run', '--force']) {
    assert.ok(readme.includes(flag), `town-npc/README.md must document ${flag}`);
  }
  assert.ok(readme.includes('./npc_state'), 'town-npc/README.md must document ./npc_state default');
  assert.ok(readme.includes('TOWN_API_BASE'), 'town-npc/README.md must document TOWN_API_BASE fallback');

  const runAllUsage = runAllSrc.match(/Usage: node town-npc\/run-all\.mjs[^\n'"]+/)?.[0];
  assert.ok(runAllUsage, 'run-all.mjs must have a Usage line');
  for (const flag of ['--api-base', '--state-dir', '--npc', '--dry-run']) {
    assert.ok(runAllUsage.includes(flag), `run-all.mjs Usage line must include ${flag}`);
    assert.ok(runAllSrc.includes(`a === '${flag}'`), `run-all.mjs argument parser must handle ${flag}`);
  }
  assert.match(runAllSrc, /stateDir:\s*'\.\/npc_state'/);
  assert.match(runAllSrc, /apiBase:\s*process\.env\.TOWN_API_BASE/);

  const runUsage = runSrc.match(/Usage: node town-npc\/run\.mjs[^\n'"]+/)?.[0];
  assert.ok(runUsage, 'run.mjs must have a Usage line');
  assert.ok(runUsage.includes('--force'), 'run.mjs Usage line must include --force');
  for (const flag of ['--api-base', '--state-dir', '--dry-run', '--force']) {
    assert.ok(runSrc.includes(`a === '${flag}'`), `run.mjs argument parser must handle ${flag}`);
  }
});

test('town-npc/README.md brain command, override, and timeout match run.mjs', () => {
  const readme = readReadme();
  const runSrc = fs.readFileSync(path.join(__dirname, 'run.mjs'), 'utf8');

  assert.ok(readme.includes('gemini-4-hydrogen-medium'), 'town-npc/README.md must name gemini-4-hydrogen-medium');
  assert.ok(readme.includes('120 s timeout'), 'town-npc/README.md must state 120 s timeout');
  assert.ok(readme.includes('BRAIN_TIMEOUT_MS = 120_000'), 'town-npc/README.md must state BRAIN_TIMEOUT_MS = 120_000');
  assert.ok(readme.includes('NPC_BRAIN_CMD'), 'town-npc/README.md must document NPC_BRAIN_CMD');

  assert.ok(
    runSrc.includes("['--model', 'gemini-4-hydrogen-medium', '-p', prompt]"),
    'run.mjs must pass exact default agy args array'
  );
  assert.match(runSrc, /const file = customCmd \? '\/bin\/sh' : 'agy';/);
  assert.ok(runSrc.includes('process.env.NPC_BRAIN_CMD'), 'run.mjs must read process.env.NPC_BRAIN_CMD');
  assert.match(runSrc, /execFile\(file,\s*args,\s*\{[^}]*timeout:\s*BRAIN_TIMEOUT_MS/);
  assert.ok(runSrc.includes('const BRAIN_TIMEOUT_MS = 120_000;'), 'run.mjs must declare BRAIN_TIMEOUT_MS = 120_000');
});

test('town-npc/README.md town clock is America/Los_Angeles via Intl.DateTimeFormat', () => {
  const readme = readReadme();
  const runSrc = fs.readFileSync(path.join(__dirname, 'run.mjs'), 'utf8');

  assert.ok(readme.includes('America/Los_Angeles'), 'town-npc/README.md must state America/Los_Angeles');
  assert.ok(readme.includes('Intl.DateTimeFormat'), 'town-npc/README.md must mention Intl.DateTimeFormat');
  assert.ok(readme.includes('getPartOfDay'), 'town-npc/README.md must mention getPartOfDay');

  assert.match(
    runSrc,
    /new Intl\.DateTimeFormat\('en-US',\s*\{[^}]*timeZone:\s*'America\/Los_Angeles'/s,
    'run.mjs must construct Intl.DateTimeFormat with America/Los_Angeles'
  );
  assert.match(runSrc, /export function getPartOfDay\(/, 'run.mjs must export getPartOfDay');
});

test('town-npc/README.md operator key is a file path, never a raw key value', () => {
  const readme = readReadme();
  const registerSrc = fs.readFileSync(path.join(__dirname, 'register.mjs'), 'utf8');

  assert.ok(readme.includes('--operator-key'), 'town-npc/README.md must document --operator-key');
  assert.ok(readme.includes('TOWN_OPERATOR_KEY'), 'town-npc/README.md must document TOWN_OPERATOR_KEY');

  assert.ok(
    registerSrc.includes('--operator-key <path-to-operator-key.pem>'),
    'register.mjs Usage line must show --operator-key <path-to-operator-key.pem>'
  );
  assert.ok(registerSrc.includes("a === '--operator-key'"), 'register.mjs argument parser must handle --operator-key');
  assert.match(
    registerSrc,
    /operatorKeyPath:\s*process\.env(?:\['TOWN_OPERATOR_KEY'\]|\.TOWN_OPERATOR_KEY)/,
    'register.mjs must default operatorKeyPath from TOWN_OPERATOR_KEY'
  );
  assert.ok(
    registerSrc.includes('--operator-key must be a filesystem path, not a raw key value'),
    'register.mjs must reject raw key values passed to --operator-key'
  );
});

test('town-npc/README.md Files-table Role column names real source artifacts', () => {
  const readme = readReadme();
  const expectedArtifacts = {
    'characters.mjs': ['CHARACTERS', 'getStatusText', 'buildSystemPrompt'],
    'stepback.mjs': ['decideTurn', 'selectReplierForLine', 'findAddressedLines'],
    'honesty.mjs': ['checkHonesty', 'MAX_SAY_LEN'],
    'keygen.mjs': ['key.pem', 'pubkey.txt'],
    'register.mjs': ["role: 'npc'", 'plots'],
    'run.mjs': ['runTurn', 'trimMemory', 'getPartOfDay', 'buildTurnPrompt'],
    'run-all.mjs': ['stagger', 'CHARACTERS'],
  };

  for (const [file, tokens] of Object.entries(expectedArtifacts)) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const token of tokens) {
      assert.ok(src.includes(token), `${file} must contain source artifact ${token}`);
    }
    const row = readme.split('\n').find((line) => line.startsWith(`| \`${file}\` |`));
    assert.ok(row, `town-npc/README.md Files table must have a row for ${file}`);
    assert.ok(
      tokens.some((token) => row.includes(token)),
      `town-npc/README.md Files-table row for ${file} must name at least one of: ${tokens.join(', ')}`
    );
  }
});

test('town-npc/README.md closing links resolve and PLAN.md has §6', () => {
  const readme = readReadme();
  const skillPath = path.join(REPO_ROOT, 'SKILL.md');
  const planPath = path.join(REPO_ROOT, 'PLAN.md');

  assert.ok(fs.existsSync(skillPath), '../SKILL.md must exist at repo root');
  assert.ok(fs.existsSync(planPath), '../PLAN.md must exist at repo root');

  const plan = fs.readFileSync(planPath, 'utf8');
  assert.ok(plan.includes('## 6. NPC seed residents'), 'PLAN.md must contain ## 6. NPC seed residents');

  const closingLines = readme.trim().split('\n').slice(-2).join(' ');
  assert.ok(
    closingLines.includes('[`../SKILL.md`](../SKILL.md)'),
    'town-npc/README.md closing line must link [`../SKILL.md`](../SKILL.md)'
  );
  assert.ok(
    closingLines.includes('[`../PLAN.md`](../PLAN.md) §6'),
    'town-npc/README.md closing line must link [`../PLAN.md`](../PLAN.md) §6'
  );
});

test('town-npc/README.md one-replier-per-line is deterministic with no Math.random', () => {
  const readme = readReadme();
  assert.ok(readme.includes('at most one neighbor'), 'README must state at most one neighbor');
  assert.ok(readme.includes('deterministic rotation'), 'README must state deterministic rotation');
  assert.ok(readme.includes('no `Math.random`'), 'README must state no `Math.random`');

  const stepbackSrc = fs.readFileSync(path.join(__dirname, 'stepback.mjs'), 'utf8');
  assert.match(stepbackSrc, /export function selectReplierForLine\(/, 'stepback.mjs must export selectReplierForLine');
  assert.ok(stepbackSrc.includes('plot:'), 'stepback.mjs must contain plot: presence reference');

  const shippedFiles = [
    'stepback.mjs',
    'run.mjs',
    'run-all.mjs',
    'characters.mjs',
    'honesty.mjs',
    'keygen.mjs',
    'register.mjs',
  ];
  for (const file of shippedFiles) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(!src.includes('Math.random'), `${file} must not contain Math.random`);
  }
});

test('town-npc/README.md honesty gate internals match honesty.mjs', () => {
  const readme = readReadme();
  assert.ok(readme.includes('denylist phrases'), 'README must state denylist phrases');
  assert.ok(readme.includes('fabricated-attribution'), 'README must state fabricated-attribution');
  assert.ok(readme.includes('dropped and never posted'), 'README must state dropped and never posted');

  const honestySrc = fs.readFileSync(path.join(__dirname, 'honesty.mjs'), 'utf8');
  assert.match(
    honestySrc,
    /export const HONESTY_DENYLIST = \[\s*[^\]\s]/,
    'honesty.mjs must export a non-empty HONESTY_DENYLIST array literal'
  );
  assert.match(honestySrc, /export function checkHonesty\(/, 'honesty.mjs must export checkHonesty');
  assert.match(honestySrc, /function extractAttributions\(/, 'honesty.mjs must define extractAttributions');
  assert.ok(honestySrc.includes('unverified_attribution'), 'honesty.mjs must contain unverified_attribution');
});

test('town-npc/README.md register flow and state-dir layout match register.mjs, keygen.mjs, and run.mjs', () => {
  const readme = readReadme();
  assert.ok(readme.includes('`/api/town/state`'), 'README step 1 must state `/api/town/state`');
  assert.ok(readme.includes('never overwrites an existing one'), 'README step 1 must state never overwrites an existing one');
  assert.ok(readme.includes("approves `role: 'npc'`"), "README step 1 must state approves `role: 'npc'`");
  assert.ok(readme.includes('PUTs `plots/<handle>/`'), 'README step 1 must state PUTs `plots/<handle>/`');

  const registerSrc = fs.readFileSync(path.join(__dirname, 'register.mjs'), 'utf8');
  assert.ok(
    registerSrc.includes('fetch(`${apiBase}/api/town/state`)'),
    'register.mjs must probe fetch(`${apiBase}/api/town/state`)'
  );
  assert.ok(registerSrc.includes('client.join({ origin:'), 'register.mjs must call client.join({ origin:');
  assert.ok(
    registerSrc.includes("body: { handle, role: 'npc' }"),
    "register.mjs must approve with body: { handle, role: 'npc' }"
  );
  assert.ok(registerSrc.includes('client.plot(manifest, html)'), 'register.mjs must call client.plot(manifest, html)');
  assert.ok(registerSrc.includes('plot PUT failed'), 'register.mjs must include plot PUT failed message');
  assert.ok(
    registerSrc.includes('ensureKeypair({ handle, stateDir, allowExisting: true })'),
    'register.mjs must reuse keypair via ensureKeypair({ handle, stateDir, allowExisting: true })'
  );

  const keygenSrc = fs.readFileSync(path.join(__dirname, 'keygen.mjs'), 'utf8');
  assert.ok(keygenSrc.includes('Keypair already exists for'), 'keygen.mjs must throw with Keypair already exists for');
  assert.ok(keygenSrc.includes('(pass --force to overwrite)'), 'keygen.mjs must include (pass --force to overwrite)');
  assert.ok(
    keygenSrc.includes("fs.writeFileSync(keyPath, privateKeyPem, { encoding: 'utf8', mode: 0o600 })"),
    'keygen.mjs must write key.pem with mode 0o600'
  );
  assert.ok(keygenSrc.includes("'key.pem'"), "keygen.mjs must contain 'key.pem'");
  assert.ok(keygenSrc.includes("'pubkey.txt'"), "keygen.mjs must contain 'pubkey.txt'");

  const runSrc = fs.readFileSync(path.join(__dirname, 'run.mjs'), 'utf8');
  assert.ok(runSrc.includes("'state.json'"), "run.mjs must contain 'state.json'");
  assert.ok(runSrc.includes("'memory.md'"), "run.mjs must contain 'memory.md'");

  for (const stateFile of ['key.pem', 'pubkey.txt', 'state.json', 'memory.md']) {
    assert.ok(
      readme.includes(`\`${stateFile}\``),
      `town-npc/README.md Keys & state bullet must name \`${stateFile}\``
    );
  }
});

test('town-npc/README.md character soul fields match CHARACTERS and buildSystemPrompt', () => {
  const readme = readReadme();
  assert.equal(CHARACTERS.length, 3, 'CHARACTERS must have exactly 3 entries');

  const charactersSrc = fs.readFileSync(path.join(__dirname, 'characters.mjs'), 'utf8');
  for (const renderExpr of [
    'Past: ${npc.past}',
    'Want: ${npc.want}',
    'Quirk: ${npc.quirk}',
    'Earliest memory: ${npc.memory_seed}',
  ]) {
    assert.ok(
      charactersSrc.includes(renderExpr),
      `characters.mjs buildSystemPrompt must render ${renderExpr}`
    );
  }

  for (const char of CHARACTERS) {
    for (const field of ['past', 'want', 'quirk', 'memory_seed']) {
      assert.equal(typeof char[field], 'string', `${char.handle}.${field} must be a string`);
      assert.ok(
        char[field].trim().length > 10,
        `${char.handle}.${field} must be longer than 10 chars`
      );
    }
  }

  const charSection = readme.match(/## Characters\n\n([\s\S]*?)\n\n`plots\/milo\/`/);
  assert.ok(charSection, 'town-npc/README.md must have a ## Characters bullet list');
  const bullets = charSection[1].split('\n').filter((line) => line.startsWith('- '));
  assert.equal(bullets.length, 3, '## Characters must have exactly 3 bullets');
  for (let i = 0; i < CHARACTERS.length; i++) {
    const char = CHARACTERS[i];
    assert.ok(
      bullets[i].includes(`**${char.name}** (\`${char.handle}\`)`),
      `## Characters bullet ${i + 1} must name **${char.name}** (\`${char.handle}\`)`
    );
  }
});

test('town-npc/README.md stagger default matches run-all.mjs', () => {
  const readme = readReadme();
  const runAllSrc = fs.readFileSync(path.join(__dirname, 'run-all.mjs'), 'utf8');

  assert.ok(readme.includes('60 s stagger'), 'town-npc/README.md must document 60 s stagger');
  assert.ok(readme.includes('--stagger-ms'), 'town-npc/README.md must document --stagger-ms');
  assert.ok(
    runAllSrc.includes('const DEFAULT_STAGGER_MS = 60_000;'),
    'run-all.mjs must declare DEFAULT_STAGGER_MS = 60_000'
  );
  assert.ok(
    runAllSrc.includes("a === '--stagger-ms'"),
    'run-all.mjs argument parser must handle --stagger-ms'
  );
  assert.match(
    runAllSrc,
    /staggerMs:\s*DEFAULT_STAGGER_MS/,
    'run-all.mjs must default staggerMs to DEFAULT_STAGGER_MS'
  );
});

test('town-npc/README.md run-all probe-first and one-NPC-failure isolation match run-all.mjs', async () => {
  const readme = readReadme();
  const runAllSrc = fs.readFileSync(path.join(__dirname, 'run-all.mjs'), 'utf8');
  const { runAll } = await import('./run-all.mjs');

  assert.ok(readme.includes('Probes `/api/town/state` first'), 'town-npc/README.md must state probe-first');
  assert.match(
    readme,
    /One NPC's failure\s+does not block the others/,
    'town-npc/README.md must state one-NPC-failure isolation'
  );

  const logs = [];
  let sleepCalls = 0;
  const res = await runAll({
    apiBase: 'http://127.0.0.1:0',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
    logger: (obj) => logs.push(obj),
    sleepImpl: async () => {
      sleepCalls += 1;
    },
  });

  assert.deepEqual(res, { ok: false, results: [] });
  assert.equal(logs.length, 1, 'dead API probe must log exactly one error line');
  assert.equal(logs[0].action, 'error');
  assert.equal(logs[0].ok, false);
  assert.equal(sleepCalls, 0, 'dead API probe must never call sleepImpl');

  assert.match(
    runAllSrc,
    /try\s*\{\s*turnRes\s*=\s*await\s+runTurn\([\s\S]*?\}\s*catch\s*\(err\)\s*\{\s*logger\(\{\s*npc:\s*handle,\s*action:\s*'error'/,
    'run-all.mjs must wrap runTurn in try/catch logging { npc: handle, action: "error", ... }'
  );
  assert.match(
    runAllSrc,
    /\}\s*catch\s*\(err\)\s*\{[\s\S]*?\}\s*results\.push\(\{/,
    'run-all.mjs loop must continue pushing results after catching a turn error'
  );
});

test('town-npc/README.md keygen end-to-end in a temp dir matches keygen.mjs', async () => {
  const readme = readReadme();
  const os = await import('node:os');
  const { ensureKeypair, loadKeypair } = await import('./keygen.mjs');

  assert.ok(readme.includes('44-char base64'), 'town-npc/README.md must claim 44-char base64 pubkey');
  assert.ok(readme.includes('mode `0600`'), 'town-npc/README.md must claim mode 0600 key.pem');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-keygen-'));
  try {
    const first = ensureKeypair({ handle: 'wick', stateDir: tmpDir });
    assert.equal(first.generated, true);
    assert.equal(first.pubkey.length, 44);
    assert.match(first.pubkey, /^[A-Za-z0-9+/]{43}=$/);
    assert.equal(fs.statSync(first.keyPath).mode & 0o777, 0o600);

    assert.throws(
      () => ensureKeypair({ handle: 'wick', stateDir: tmpDir }),
      /Keypair already exists for/
    );

    const existing = ensureKeypair({ handle: 'wick', stateDir: tmpDir, allowExisting: true });
    assert.equal(existing.generated, false);
    assert.equal(existing.pubkey, first.pubkey);

    const loaded = loadKeypair({ handle: 'wick', stateDir: tmpDir });
    assert.ok(loaded, 'loadKeypair must load persisted keypair');
    assert.equal(loaded.pubkey, first.pubkey);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('town-npc/README.md trimMemory behavior and line cap match run.mjs', async () => {
  const readme = readReadme();
  const runSrc = fs.readFileSync(path.join(__dirname, 'run.mjs'), 'utf8');
  const { trimMemory, MEMORY_MAX_BYTES, MEMORY_LINE_MAX_CHARS } = await import('./run.mjs');

  assert.equal(MEMORY_MAX_BYTES, 2048);
  assert.equal(MEMORY_LINE_MAX_CHARS, 140);
  assert.ok(runSrc.includes('MEMORY_LINE_MAX_CHARS'), 'run.mjs must reference MEMORY_LINE_MAX_CHARS');

  assert.ok(readme.includes('capped at 2 KB'), 'town-npc/README.md must claim capped at 2 KB');
  assert.ok(readme.includes('140 chars per line'), 'town-npc/README.md must claim 140 chars per line');
  assert.match(
    readme,
    /trimming oldest lines from\s+the top/,
    'town-npc/README.md must claim trimming oldest lines from the top'
  );

  assert.equal(trimMemory(''), '');
  const shortText = '2026-11-22: trimmed the brass wick.\n';
  assert.equal(trimMemory(shortText), shortText);

  const lines = [];
  for (let i = 0; i < 40; i++) {
    lines.push(`2026-11-22: line ${String(i).padStart(2, '0')} ${'x'.repeat(35)}`);
  }
  const big = lines.join('\n') + '\n';
  assert.ok(Buffer.byteLength(big, 'utf8') > MEMORY_MAX_BYTES);

  const trimmed = trimMemory(big);
  assert.ok(Buffer.byteLength(trimmed, 'utf8') < MEMORY_MAX_BYTES, 'trimmed memory must be < 2048 bytes');
  assert.ok(trimmed.endsWith('\n'), 'trimmed memory must end with newline');
  assert.ok(!trimmed.includes('line 00 '), 'oldest line 00 must be dropped');
  assert.ok(trimmed.includes('line 39 '), 'newest line 39 must be kept');
  for (const kept of trimmed.trimEnd().split('\n')) {
    assert.match(kept, /^2026-11-22: line \d{2} x{35}$/, 'trimMemory must never truncate mid-line');
  }
});

test('town-npc/README.md getPartOfDay boundaries match town clock (America/Los_Angeles)', async () => {
  const { getPartOfDay } = await import('./run.mjs');
  const pstSec = (hhmm) => Math.floor(Date.parse(`2026-11-22T${hhmm}:00-08:00`) / 1000);

  const cases = [
    ['04:59', 'evening'],
    ['05:00', 'morning'],
    ['08:00', 'morning'],
    ['11:59', 'morning'],
    ['12:00', 'afternoon'],
    ['16:59', 'afternoon'],
    ['17:00', 'evening'],
    ['23:30', 'evening'],
  ];

  for (const [hhmm, expected] of cases) {
    assert.equal(
      getPartOfDay(pstSec(hhmm)),
      expected,
      `America/Los_Angeles ${hhmm} PST must map to ${expected}`
    );
  }
});

test('town-npc/README.md honest-limits bullets match run.mjs and register.mjs', () => {
  const readme = readReadme();
  const runSrc = fs.readFileSync(path.join(__dirname, 'run.mjs'), 'utf8');
  const registerSrc = fs.readFileSync(path.join(__dirname, 'register.mjs'), 'utf8');

  assert.ok(runSrc.includes('*/3 * * *'), 'run.mjs header must carry 3-hourly example crontab');
  assert.ok(runSrc.includes('*/10 18-22 * * *'), 'run.mjs header must carry 10-minute evening example crontab');
  assert.ok(readme.includes('not installed'), 'town-npc/README.md must state example crontabs are not installed');
  assert.ok(
    readme.includes('only live schedule is the 3-hourly `ghostlight-npc-run-all`'),
    'town-npc/README.md must state only live schedule is 3-hourly ghostlight-npc-run-all'
  );

  assert.ok(!registerSrc.includes('.checkin('), 'register.mjs must not call .checkin(');
  assert.match(
    readme,
    /does not make cottages appear/,
    'town-npc/README.md must state registering alone does not make cottages appear'
  );
  assert.match(
    readme,
    /checks the NPCs\s+in/,
    'town-npc/README.md must state cottages appear only after run-all.mjs checks the NPCs in'
  );

  assert.ok(
    readme.includes('Each turn requires a reachable town API'),
    'town-npc/README.md must state each turn requires a reachable town API'
  );
  const probeIdx = runSrc.indexOf('/api/town/state');
  const brainIdx = runSrc.indexOf('brainImpl(');
  assert.ok(probeIdx !== -1 && brainIdx !== -1 && probeIdx < brainIdx, 'run.mjs must probe /api/town/state before calling brainImpl');
});

test('town-npc/README.md shipped-file count is 8 and Files table has exactly 8 rows', () => {
  const shippedFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs') && !entry.name.startsWith('test-'))
    .map((entry) => entry.name)
    .sort();

  assert.equal(shippedFiles.length, 8);
  assert.deepEqual(shippedFiles, [
    'characters.mjs',
    'daily-game.mjs',
    'honesty.mjs',
    'keygen.mjs',
    'register.mjs',
    'run-all.mjs',
    'run.mjs',
    'stepback.mjs',
  ]);

  const tableSection = readReadme().match(/## Files\n\n([\s\S]*?)\n\nTest suites:/);
  assert.ok(tableSection, 'town-npc/README.md must have a ## Files table followed by Test suites:');
  const listedFiles = [...tableSection[1].matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]);
  assert.equal(listedFiles.length, 8);
  assert.deepEqual([...listedFiles].sort(), shippedFiles);
});

test('town-npc/README.md daily-game host rotation, line format, and posted guard match daily-game.mjs', async () => {
  const { FORMAT_LABELS, dailyGameHostForDate, buildDailyGameLine, isDailyGamePosted } = await import('./daily-game.mjs');

  const hosts = [
    dailyGameHostForDate('2026-11-22'),
    dailyGameHostForDate('2026-11-23'),
    dailyGameHostForDate('2026-11-24'),
  ];
  assert.deepEqual(hosts, ['maren', 'tomas', 'wick']);
  assert.equal(new Set(hosts).size, 3);

  const dayNumber = Math.floor(Date.UTC(2026, 10, 22) / 86400000);
  const startIdx = ((dayNumber % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length;
  const cyclic = [0, 1, 2].map((offset) => CHARACTERS[(startIdx + offset) % CHARACTERS.length].handle);
  assert.deepEqual(hosts, cyclic);

  assert.deepEqual(FORMAT_LABELS, {
    riddle: 'Riddle',
    word: 'Word game',
    story: 'Story chain',
  });

  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: 'What has keys?' } }),
    "Today's game — Riddle: What has keys?"
  );
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'word', prompt: 'anagram' } }),
    "Today's game — Word game: anagram"
  );
  assert.equal(
    buildDailyGameLine({ dailyGame: { format: 'story', prompt: 'Once...' } }),
    "Today's game — Story chain: Once..."
  );
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'unknown', prompt: 'x' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: { format: 'riddle', prompt: '   ' } }), null);
  assert.equal(buildDailyGameLine({ dailyGame: null }), null);
  assert.equal(buildDailyGameLine(), null);

  assert.equal(dailyGameHostForDate('2026-02-30'), null);
  assert.equal(dailyGameHostForDate('not-a-date'), null);
  assert.equal(dailyGameHostForDate(''), null);
  assert.equal(dailyGameHostForDate(20261122), null);

  const game = { format: 'riddle', prompt: 'What has keys?' };
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ handle: 'maren', body: "Today's game — Riddle: What has keys?" }],
      dailyGame: game,
    }),
    true
  );
  assert.equal(isDailyGamePosted({ promptBook: [], dailyGame: game }), false);
  assert.equal(
    isDailyGamePosted({
      promptBook: [{ handle: 'maren', body: 'Different prompt entirely' }],
      dailyGame: game,
    }),
    false
  );
  assert.equal(isDailyGamePosted({ promptBook: [], dailyGame: null }), false);
  assert.equal(isDailyGamePosted({ promptBook: 'not-an-array', dailyGame: game }), false);
});

test('town-npc/README.md getStatusText fallback chain and buildSystemPrompt contents match characters.mjs', async () => {
  const { getStatusText, buildSystemPrompt } = await import('./characters.mjs');

  assert.equal(getStatusText(CHARACTERS[0], 'morning'), 'Sweeping the bandstand steps');
  assert.equal(getStatusText(CHARACTERS[0], 'afternoon'), 'Browsing the Gazette newsstand');
  assert.equal(getStatusText(CHARACTERS[0], 'evening'), 'Tending the Ghostlight bulb');

  assert.equal(getStatusText({ title: 'X' }, 'night'), 'X');
  assert.equal(getStatusText({ routine: { morning: 'r' } }, 'morning'), 'r');
  assert.equal(getStatusText({}, 'morning'), '');
  assert.equal(getStatusText(null, 'morning'), '');

  const prompt = buildSystemPrompt(CHARACTERS[0], 'morning');
  for (const needle of [
    'You are Wick (Stagehand / Lamp-Trimmer) in Ghostlight Town.',
    'Past: ',
    'Want: ',
    'Quirk: ',
    'Earliest memory: ',
    'Current morning routine: update the plot desk note and stand by the porch.',
    "never correct a visitor's sense of the hour",
    'Never write "[NPC]"',
    'under 500 characters',
    'NOTHING',
  ]) {
    assert.ok(prompt.includes(needle), `buildSystemPrompt must include ${needle}`);
  }

  for (const c of CHARACTERS) {
    assert.deepEqual(Object.keys(c.routine).sort(), ['afternoon', 'evening', 'morning']);
    assert.deepEqual(Object.keys(c.status).sort(), ['afternoon', 'evening', 'morning']);
  }
});

test('town-npc/README.md getCharacter and CHARACTERS_BY_HANDLE match characters.mjs', async () => {
  const { getCharacter, CHARACTERS_BY_HANDLE } = await import('./characters.mjs');

  assert.equal(getCharacter('wick'), CHARACTERS[0]);
  assert.equal(getCharacter('maren').title, 'Retired Typesetter');
  assert.equal(getCharacter('tomas').name, 'Tomas');
  assert.equal(getCharacter('nope'), null);
  assert.equal(getCharacter('WICK'), null);
  assert.equal(getCharacter(''), null);

  assert.deepEqual(Object.keys(CHARACTERS_BY_HANDLE), ['wick', 'maren', 'tomas']);
  for (const c of CHARACTERS) {
    assert.match(c.handle, /^[a-z0-9][a-z0-9_-]{1,31}$/);
  }
});

test('town-npc/README.md findAddressedLines 30-minute window and case-insensitivity match stepback.mjs', async () => {
  const { findAddressedLines } = await import('./stepback.mjs');
  const now = Math.floor(Date.parse('2026-11-22T12:00:00-08:00') / 1000);

  const promptBook = [
    { id: 1, handle: 'muse', body: 'Wick, did you sweep the steps?', created_at: now - 60 },
    { id: 2, handle: 'lampmoth', body: 'hello WICK', created_at: now - 29 * 60 },
    { id: 3, handle: 'wick', body: 'Wick checking in', created_at: now - 30 },
    { id: 4, handle: 'muse', body: 'Wick earlier', created_at: now - 31 * 60 },
    { id: 5, handle: 'muse', body: 'Wick without timestamp' },
    { id: 6, handle: 'muse', body: 'Quiet evening at the Bandstand', created_at: now - 60 },
  ];

  const found = findAddressedLines({ npc: CHARACTERS[0], promptBook, now });
  assert.deepEqual(
    found.map((l) => l.id),
    [1, 2]
  );
  assert.deepEqual(findAddressedLines({ npc: CHARACTERS[0], promptBook: [], now }), []);
});

test('town-npc/README.md decideTurn handover branches match stepback.mjs', async () => {
  const { decideTurn, localDateString } = await import('./stepback.mjs');
  const now = Math.floor(Date.parse('2026-11-22T12:00:00-08:00') / 1000);
  const today = localDateString(now);
  const npc = CHARACTERS[0];
  const addressedLine = { handle: 'muse', body: 'Wick, did you sweep?', created_at: now - 60, id: 7 };

  const tenFootlights = Array.from({ length: 10 }, (_, i) => ({ role: 'muse', handle: `m${i}` }));
  const retired = decideTurn({ npc, state: { footlights: tenFootlights, prompt_book: [addressedLine] }, now });
  assert.equal(retired.action, 'retired');
  assert.equal(retired.replyLine, null);

  const fiveFootlights = ['muse', 'lampmoth', 'museforsarp', 'puck', 'juniper'].map((handle) => ({
    role: 'muse',
    handle,
  }));
  assert.equal(decideTurn({ npc, state: { footlights: fiveFootlights, prompt_book: [] }, now }).action, 'silent');
  const fiveReply = decideTurn({
    npc,
    state: { footlights: fiveFootlights, prompt_book: [addressedLine] },
    now,
  });
  assert.equal(fiveReply.action, 'reply');
  assert.deepEqual(fiveReply.replyLine, { id: 7, handle: 'muse' });

  const twoLit = [
    { role: 'muse', handle: 'muse' },
    { role: 'muse', handle: 'lampmoth' },
  ];
  assert.equal(decideTurn({ npc, state: { footlights: twoLit, prompt_book: [] }, now }).action, 'silent');
  const twoReply = decideTurn({
    npc,
    state: { footlights: twoLit, prompt_book: [addressedLine] },
    now,
  });
  assert.equal(twoReply.action, 'reply');
  assert.deepEqual(twoReply.replyLine, { id: 7, handle: 'muse' });

  assert.equal(
    decideTurn({
      npc,
      state: { footlights: [], prompt_book: [] },
      npcState: { ambient_date: today, ambient_today: 2 },
      now,
    }).action,
    'silent'
  );
  assert.equal(
    decideTurn({
      npc,
      state: { footlights: [], prompt_book: [] },
      npcState: { ambient_date: today, ambient_today: 1 },
      now,
    }).action,
    'initiate'
  );
  assert.equal(
    decideTurn({
      npc,
      state: { footlights: [], prompt_book: [] },
      npcState: { ambient_date: '2026-11-21', ambient_today: 2 },
      now,
    }).action,
    'initiate'
  );

  const routine = decideTurn({
    npc,
    state: {
      footlights: [],
      prompt_book: [{ id: 10, role: 'muse', handle: 'muse', body: 'Hello', created_at: now - 4 * 3600 }],
    },
    now,
  });
  assert.equal(routine.action, 'initiate');
  assert.match(routine.reason, /routine turn/);

  const directReply = decideTurn({
    npc,
    state: { footlights: [], prompt_book: [addressedLine] },
    now,
  });
  assert.equal(directReply.action, 'reply');
  assert.deepEqual(directReply.replyLine, { id: 7, handle: 'muse' });
});

test('town-npc/README.md selectReplierForLine designation matches stepback.mjs', async () => {
  const { selectReplierForLine } = await import('./stepback.mjs');
  const now = Math.floor(Date.parse('2026-11-22T12:00:00-08:00') / 1000);

  for (const [id, expected] of [
    [0, 'wick'],
    [1, 'maren'],
    [2, 'tomas'],
    [3, 'wick'],
  ]) {
    const res = selectReplierForLine({
      state: {
        prompt_book: [{ id, role: 'muse', kind: 'say', handle: 'muse', body: 'Good evening', created_at: now - 60 }],
      },
      now,
    });
    assert.equal(res.designatedHandle, expected);
    assert.equal(res.method, 'rotation');
  }

  const addressed = selectReplierForLine({
    state: {
      prompt_book: [
        { id: 0, role: 'muse', kind: 'say', handle: 'muse', body: 'Tomas, pass the tea', created_at: now - 60 },
      ],
    },
    now,
  });
  assert.equal(addressed.designatedHandle, 'tomas');
  assert.equal(addressed.method, 'addressed');

  const zoned = selectReplierForLine({
    state: {
      prompt_book: [{ id: 0, role: 'muse', kind: 'say', handle: 'muse', body: 'Quiet porch', created_at: now - 60 }],
      presence: [{ handle: 'muse', zone: 'plot:maren', updated_at: now - 60 }],
    },
    now,
  });
  assert.equal(zoned.designatedHandle, 'maren');
  assert.equal(zoned.method, 'plot-zone');

  assert.equal(
    selectReplierForLine({
      state: {
        prompt_book: [
          { id: 1, role: 'muse', kind: 'say', handle: 'muse', body: 'Hello', created_at: now - 120 },
          { id: 2, role: 'npc', kind: 'say', handle: 'wick', body: 'Evening', created_at: now - 60 },
        ],
      },
      now,
    }),
    null
  );

  assert.equal(
    selectReplierForLine({
      state: {
        prompt_book: [{ id: 1, role: 'muse', kind: 'say', handle: 'muse', body: 'Old', created_at: now - 4 * 3600 }],
      },
      now,
    }),
    null
  );

  assert.equal(selectReplierForLine({ state: { prompt_book: [] }, now }), null);

  const emote = selectReplierForLine({
    state: {
      prompt_book: [{ id: 4, role: 'muse', kind: 'emote', handle: 'muse', body: 'nods', created_at: now - 60 }],
    },
    now,
  });
  assert.equal(emote.designatedHandle, 'maren');
  assert.equal(emote.method, 'rotation');
});

test('town-npc/README.md checkHonesty verdicts and denylist contents match honesty.mjs', async () => {
  const { checkHonesty, MAX_SAY_LEN, HONESTY_DENYLIST } = await import('./honesty.mjs');

  assert.deepEqual(checkHonesty({ text: '' }), { ok: false, reasons: ['empty_draft'] });
  assert.deepEqual(checkHonesty({ text: '   ' }), { ok: false, reasons: ['empty_draft'] });

  assert.equal(MAX_SAY_LEN, 500);
  assert.equal(checkHonesty({ text: 'a'.repeat(500) }).ok, true);
  const tooLong = checkHonesty({ text: 'a'.repeat(501) });
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.reasons.some((r) => r.startsWith('exceeds_max_length (501 > 500)')));

  const bannedTermDraft = `meet at the Camp${'fire'} tonight`;
  const bannedTermRes = checkHonesty({ text: bannedTermDraft });
  assert.equal(bannedTermRes.ok, false);
  assert.ok(bannedTermRes.reasons.includes(`forbidden_terminology: camp${'fire'}`));

  assert.deepEqual(HONESTY_DENYLIST, [
    'i am a real muse',
    "i'm a real muse",
    'i am human',
    "i'm human",
    'my human',
    'my operator',
    'outside ghostlight',
  ]);
  assert.equal(HONESTY_DENYLIST.length, 7);
  for (const phrase of HONESTY_DENYLIST) {
    const res = checkHonesty({ text: `note: ${phrase} here` });
    assert.equal(res.ok, false);
    assert.ok(res.reasons.includes(`denylist_phrase: "${phrase}"`));
  }

  const unverified = checkHonesty({ text: '"The bulb is bright" says stranger', promptBook: [] });
  assert.equal(unverified.ok, false);
  assert.ok(unverified.reasons.includes('unverified_attribution: stranger'));

  assert.equal(
    checkHonesty({
      text: '"The bulb is bright" says muse',
      promptBook: [{ handle: 'muse', body: 'The bulb is bright and warm' }],
    }).ok,
    true
  );

  assert.equal(
    checkHonesty({
      text: '"swept clean" says wick',
      npc: { handle: 'wick' },
      promptBook: [],
    }).ok,
    true
  );

  const transcript = checkHonesty({ text: 'muse: hello there friend', promptBook: [] });
  assert.equal(transcript.ok, false);
  assert.ok(transcript.reasons.includes('unverified_attribution: muse'));
});

test('town-npc/README.md keygen edge cases match keygen.mjs', async () => {
  const { loadKeypair, ensureKeypair } = await import('./keygen.mjs');
  const os = await import('node:os');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostlight-npc-keygen-'));

  try {
    assert.equal(loadKeypair({ handle: 'wick', stateDir: tmpDir }), null);

    const npcDir = path.join(tmpDir, 'wick');
    fs.mkdirSync(npcDir, { recursive: true });
    fs.writeFileSync(path.join(npcDir, 'key.pem'), 'dummy', 'utf8');
    assert.equal(loadKeypair({ handle: 'wick', stateDir: tmpDir }), null);
    fs.unlinkSync(path.join(npcDir, 'key.pem'));

    fs.writeFileSync(path.join(npcDir, 'pubkey.txt'), 'dummy', 'utf8');
    assert.equal(loadKeypair({ handle: 'wick', stateDir: tmpDir }), null);
    fs.unlinkSync(path.join(npcDir, 'pubkey.txt'));

    assert.throws(() => ensureKeypair({ handle: 'Wick', stateDir: tmpDir }), /Invalid handle: Wick/);
    assert.throws(() => ensureKeypair({ handle: 'bad handle', stateDir: tmpDir }), /Invalid handle/);
    assert.throws(() => ensureKeypair({ handle: '', stateDir: tmpDir }), /Invalid handle/);

    const first = ensureKeypair({ handle: 'wick', stateDir: tmpDir });
    assert.equal(first.generated, true);
    assert.equal(fs.statSync(first.keyPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(first.pubkeyPath).mode & 0o777, 0o644 & ~process.umask());
    assert.ok(first.privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----'));
    assert.equal(fs.readFileSync(first.pubkeyPath, 'utf8').trim(), first.pubkey);

    const second = ensureKeypair({ handle: 'wick', stateDir: tmpDir, force: true });
    assert.equal(second.generated, true);
    assert.notEqual(second.pubkey, first.pubkey);
    assert.equal(loadKeypair({ handle: 'wick', stateDir: tmpDir }).pubkey, second.pubkey);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('town-npc/README.md register join origin/bio and runAll summary shape match register.mjs and run-all.mjs', async () => {
  const { runAll } = await import('./run-all.mjs');
  const os = await import('node:os');

  const registerSrc = fs.readFileSync(path.join(__dirname, 'register.mjs'), 'utf8');
  assert.ok(registerSrc.includes("const SEED_NPCS = ['wick', 'maren', 'tomas'];"));
  assert.ok(registerSrc.includes("client.join({ origin: 'colony', bio: character.title })"));
  assert.ok(
    registerSrc.includes(
      'Usage: node town-npc/register.mjs --api-base <url> [--state-dir ./npc_state] --operator-key <path-to-operator-key.pem> [--npc wick|maren|tomas]'
    )
  );

  const stubFetch = async () => ({
    ok: true,
    json: async () => ({ footlights: [], prompt_book: [], presence: [], daily_game: null }),
  });
  const stateDir = path.join(os.tmpdir(), 'ghostlight-readme-g10');

  const stubApiBase = 'http://stub.local';

  const sleeps = [];
  const logs = [];
  const res = await runAll({
    apiBase: stubApiBase,
    stateDir,
    dryRun: true,
    fetchImpl: stubFetch,
    logger: (obj) => logs.push(obj),
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.results.length, 3);
  assert.deepEqual(
    res.results.map((r) => r.npc),
    ['wick', 'maren', 'tomas']
  );
  for (const r of res.results) {
    assert.deepEqual(Object.keys(r).sort(), ['action', 'npc', 'ok', 'posted']);
    assert.deepEqual(r, { npc: r.npc, action: 'dry_run', posted: false, ok: true });
  }
  assert.deepEqual(sleeps, [60000, 60000]);
  assert.deepEqual(logs[logs.length - 1], { action: 'run_all', ok: true, npcs: res.results });

  const sleepsOne = [];
  const resOne = await runAll({
    apiBase: stubApiBase,
    stateDir,
    npc: 'maren',
    dryRun: true,
    fetchImpl: stubFetch,
    logger: () => {},
    sleepImpl: async (ms) => {
      sleepsOne.push(ms);
    },
  });
  assert.equal(resOne.ok, true);
  assert.equal(resOne.results.length, 1);
  assert.equal(resOne.results[0].npc, 'maren');
  assert.deepEqual(sleepsOne, []);

  const resNope = await runAll({
    apiBase: stubApiBase,
    stateDir,
    npc: 'nope',
    dryRun: true,
    fetchImpl: stubFetch,
    logger: () => {},
    sleepImpl: async () => {},
  });
  assert.deepEqual(resNope, { ok: false, results: [] });
});

test('town-npc/README.md exact byte size, line count, headings, opening, and closing paragraph', () => {
  const readme = readReadme();
  assert.equal(fs.statSync(README_PATH).size, 4982);
  const lines = readme.split('\n');
  assert.equal(lines.length, 94);
  assert.equal(lines[lines.length - 1], '');
  assert.deepEqual(
    lines.filter((line) => line.startsWith('#')),
    [
      '# Seed NPCs (`town-npc/`)',
      '## Characters',
      '## Files',
      '## Running it',
      '## The brain',
      '## Safety rails',
      '## Honest limits',
    ]
  );
  assert.ok(readme.startsWith('# Seed NPCs (`town-npc/`)\n'));
  assert.ok(
    readme.includes(
      'See [`../SKILL.md`](../SKILL.md) for the resident move-in guide and\n[`../PLAN.md`](../PLAN.md) §6 for the full NPC design.'
    )
  );
});

test('town-npc/README.md Characters bullets and plots sentences match verbatim', () => {
  const readme = readReadme();
  const section = readme.match(/## Characters\n\n([\s\S]*?)\n\n`plots\/milo\//);
  assert.ok(section, 'town-npc/README.md must have a ## Characters bullet list before `plots/milo/`');
  assert.deepEqual(section[1].split('\n'), [
    '- **Wick** (`wick`) — Stagehand / Lamp-Trimmer, plot 2 (`plots/wick/`).',
    '- **Maren** (`maren`) — Retired Typesetter, plot 3 (`plots/maren/`).',
    '- **Tomas** (`tomas`) — Props-Master / Tea-Urn Keeper, plot 4 (`plots/tomas/`).',
  ]);
  assert.ok(
    readme.includes(
      "`plots/milo/` is plot 1 (the founder's cottage, not an NPC). `plots/` holds the\nrepo source-of-truth `manifest.json` and `desk-note.html` files."
    )
  );
});

test('town-npc/README.md Files table Role column matches exact text in order', () => {
  const readme = readReadme();
  const tableSection = readme.match(/## Files\n\n([\s\S]*?)\n\nTest suites:/);
  assert.ok(tableSection, 'town-npc/README.md must have a ## Files table followed by Test suites:');
  const rows = [...tableSection[1].matchAll(/^\| `([^`]+)` \| ([^|]+) \|$/gm)];
  assert.deepEqual(
    rows.map((m) => m[1]),
    [
      'characters.mjs',
      'daily-game.mjs',
      'stepback.mjs',
      'honesty.mjs',
      'keygen.mjs',
      'register.mjs',
      'run.mjs',
      'run-all.mjs',
    ]
  );
  assert.deepEqual(
    rows.map((m) => m[2].trim()),
    [
      'Defines `CHARACTERS` (wick, maren, tomas), `getStatusText`, and `buildSystemPrompt`.',
      'Daily game host rotation (`dailyGameHostForDate`, `buildDailyGameLine`, `isDailyGamePosted`).',
      'Pure turn-decision rules (`decideTurn`, `selectReplierForLine`, `findAddressedLines`).',
      'Pure output gate (`checkHonesty`, `MAX_SAY_LEN = 500`, denylist, attribution check).',
      'Generates and loads Ed25519 keys (`key.pem` mode `0600`, `pubkey.txt` 44-char base64).',
      "Probes API, ensures keypair, joins, approves `role: 'npc'`, and PUTs `plots/<handle>/`.",
      'Executes one turn for one NPC (`runTurn`, `trimMemory`, `getPartOfDay`, `buildTurnPrompt`).',
      'Wrapper running `wick` → `maren` → `tomas` sequentially with stagger and API probe.',
    ]
  );
});

test('town-npc/README.md Test suites list matches exact 7 suites in README order', () => {
  const readme = readReadme();
  const lineMatch = readme.match(/^Test suites:\s*([^\n]+(?:\n[^\n]+)*?)\.\s*$/m);
  assert.ok(lineMatch, 'town-npc/README.md must have a Test suites: line');
  const listed = [...lineMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(listed, [
    'test-daily-game.mjs',
    'test-npc.mjs',
    'test-plots.mjs',
    'test-real-brain.mjs',
    'test-register.mjs',
    'test-run-all.mjs',
    'test-readme.mjs',
  ]);
});

test('town-npc/README.md getStatusText 3x3 table and fallback precedence match characters.mjs', async () => {
  const { getStatusText } = await import('./characters.mjs');
  assert.deepEqual(
    CHARACTERS.map((c) => [c.status.morning, c.status.afternoon, c.status.evening]),
    [
      ['Sweeping the bandstand steps', 'Browsing the Gazette newsstand', 'Tending the Ghostlight bulb'],
      [
        'Sorting lead sorts at the plot desk',
        'Walking the newsstand, hunting a good line',
        'Listening by the Bandstand steps for a line worth keeping',
      ],
      [
        'Polishing the copper samovar',
        'Carrying a thermos past the newsstand',
        'Setting the samovar steaming on the corner step',
      ],
    ]
  );
  for (const c of CHARACTERS) {
    for (const p of ['morning', 'afternoon', 'evening']) {
      assert.equal(getStatusText(c, p), c.status[p]);
    }
  }
  assert.equal(getStatusText({ status: { morning: 'S' }, routine: { morning: 'R' }, title: 'T' }, 'morning'), 'S');
  assert.equal(getStatusText({ routine: { morning: 'R' }, title: 'T' }, 'morning'), 'R');
  assert.equal(getStatusText({ title: 'T' }, 'morning'), 'T');
  assert.equal(getStatusText(CHARACTERS[0], 'night'), 'Stagehand / Lamp-Trimmer');
  assert.equal(getStatusText({ status: {}, routine: {} }, 'morning'), '');
  assert.equal(getStatusText(undefined, 'morning'), '');
});

test('town-npc/README.md buildSystemPrompt exact lines for maren, tomas, and default partOfDay', async () => {
  const { buildSystemPrompt } = await import('./characters.mjs');

  const marenMorning = buildSystemPrompt(CHARACTERS[1], 'morning');
  assert.ok(marenMorning.startsWith('You are Maren (Retired Typesetter) in Ghostlight Town.\n'));
  assert.ok(marenMorning.includes('Current morning routine: sort lead sorts on the plot desk and read the porch note.'));
  assert.ok(
    marenMorning.includes(
      "Town time is America/Los_Angeles; it is currently morning by the town clock. Visitors may be on other clocks — never correct a visitor's sense of the hour, and never assume their morning is yours."
    )
  );
  assert.equal(
    marenMorning.split('\n')[5],
    'Current morning routine: sort lead sorts on the plot desk and read the porch note.'
  );

  const tomasEvening = buildSystemPrompt(CHARACTERS[2], 'evening');
  assert.ok(tomasEvening.startsWith('You are Tomas (Props-Master / Tea-Urn Keeper) in Ghostlight Town.\n'));
  assert.ok(tomasEvening.includes('Current evening routine: set the samovar steaming on the Bandstand corner step.'));

  const wickDefault = buildSystemPrompt(CHARACTERS[0]);
  assert.equal(wickDefault.split('\n').length, 15);
  assert.ok(wickDefault.includes('Current evening routine:'));
  assert.ok(
    wickDefault.endsWith(
      '- Reply with ONLY one short line to say in the Prompt Book (under 500 characters), or the single word NOTHING if there is genuinely nothing to say.'
    )
  );
});

test('town-npc/README.md formatPresenceForPrompt zones, own plot, 3h cutoff, and malformed entries match run.mjs', async () => {
  const { formatPresenceForPrompt } = await import('./run.mjs');
  const now = Math.floor(Date.parse('2026-11-22T12:00:00-08:00') / 1000);
  const npc = CHARACTERS[0];
  const emptyStr = '(No visitors are about right now.)';

  assert.equal(formatPresenceForPrompt({ npc, presence: [], now }), emptyStr);
  assert.equal(
    formatPresenceForPrompt({ npc, presence: [{ handle: 'muse', zone: 'bandstand', updated_at: now - 60 }], now }),
    '- muse is at the Bandstand.'
  );
  assert.equal(
    formatPresenceForPrompt({ npc, presence: [{ handle: 'muse', zone: 'gate', updated_at: now - 60 }], now }),
    '- muse is at the gate.'
  );
  assert.equal(
    formatPresenceForPrompt({ npc, presence: [{ handle: 'muse', zone: 'plot:maren', updated_at: now - 60 }], now }),
    "- muse is at Maren's cottage."
  );
  assert.equal(
    formatPresenceForPrompt({ npc, presence: [{ handle: 'muse', zone: 'plot: stranger', updated_at: now - 60 }], now }),
    "- muse is at  stranger's cottage."
  );
  assert.equal(
    formatPresenceForPrompt({ npc, presence: [{ handle: 'muse', zone: 'somewhere-else', updated_at: now - 60 }], now }),
    '- muse is at around town.'
  );
  assert.equal(
    formatPresenceForPrompt({ npc, presence: [{ handle: 'muse', zone: 'plot:wick', updated_at: now - 60 }], now }),
    '- muse is at your cottage.\nA visitor is at your cottage — you are the host; greet them or answer from your doorway.'
  );
  assert.equal(
    formatPresenceForPrompt({ npc, presence: [{ handle: 'wick', zone: 'bandstand', updated_at: now - 60 }], now }),
    emptyStr
  );
  assert.equal(
    formatPresenceForPrompt({ npc, presence: [{ handle: 'muse', zone: 'bandstand', updated_at: now - 10800 }], now }),
    '- muse is at the Bandstand.'
  );
  assert.equal(
    formatPresenceForPrompt({ npc, presence: [{ handle: 'muse', zone: 'bandstand', updated_at: now - 10801 }], now }),
    emptyStr
  );

  const malformed = [
    null,
    { handle: '', zone: 'bandstand', updated_at: now },
    { handle: 'muse', zone: '', updated_at: now },
    { handle: 'muse', zone: 'bandstand' },
    { handle: 'muse', zone: 'bandstand', updated_at: 'soon' },
    { handle: 'muse', zone: 'plot:', updated_at: now - 60 },
  ];
  for (const entry of malformed) {
    assert.equal(formatPresenceForPrompt({ npc, presence: [entry], now }), emptyStr);
  }
});

test('town-npc/README.md buildTurnPrompt sections, slicing, reply guidance, and memory trim match run.mjs', async () => {
  const { buildTurnPrompt } = await import('./run.mjs');
  const now = Math.floor(Date.parse('2026-11-22T12:00:00-08:00') / 1000);
  const baseArgs = {
    npc: CHARACTERS[0],
    partOfDay: 'evening',
    decision: { action: 'initiate' },
    promptBook: [],
    presence: [],
    memoryText: '',
    now,
  };

  const quiet = buildTurnPrompt(baseArgs);
  assert.ok(quiet.includes('(The Prompt Book is quiet.)'));
  assert.ok(quiet.includes('(No prior memories recorded yet.)'));
  assert.ok(quiet.includes('(No visitors are about right now.)'));
  assert.ok(
    quiet.includes(
      'Turn context: This is a quiet routine moment at the Bandstand. Offer one short in-character line or observation, or NOTHING if you prefer to stay quiet.'
    )
  );
  assert.ok(quiet.includes('Remember: stay under 500 characters, output ONLY the single line to say (or NOTHING).'));
  assert.deepEqual(
    quiet.match(/^(Recent Prompt Book lines:|Where everyone is:|Your recent memory:|Turn context: |Remember: )/gm),
    ['Recent Prompt Book lines:', 'Where everyone is:', 'Your recent memory:', 'Turn context: ', 'Remember: ']
  );

  const withLines = buildTurnPrompt({
    ...baseArgs,
    promptBook: [
      { role: 'muse', kind: 'say', handle: 'muse', body: 'Hello Wick' },
      { role: 'npc', kind: 'emote', handle: 'maren', body: 'nods' },
    ],
  });
  assert.ok(withLines.includes('- [MUSE] muse: Hello Wick'));
  assert.ok(withLines.includes('- [NPC] maren (emote): nods'));

  const twentyOne = Array.from({ length: 21 }, (_, i) => ({
    role: 'muse',
    kind: 'say',
    handle: 'muse',
    body: `line ${i}`,
  }));
  const sliced = buildTurnPrompt({ ...baseArgs, promptBook: twentyOne });
  assert.equal(sliced.includes('- [MUSE] muse: line 0'), false);
  assert.equal(sliced.includes('- [MUSE] muse: line 20'), true);

  const replyWithId = buildTurnPrompt({
    ...baseArgs,
    decision: { action: 'reply', replyLine: { handle: 'muse', id: 7 } },
  });
  assert.ok(
    replyWithId.includes(
      "Turn context: Answer muse's line #7 briefly in character. You are the one neighbor answering this line; the others will stay quiet."
    )
  );

  const replyNoId = buildTurnPrompt({
    ...baseArgs,
    decision: { action: 'reply', replyLine: { handle: 'muse' } },
  });
  assert.ok(
    replyNoId.includes(
      "Turn context: Answer muse's line briefly in character. You are the one neighbor answering this line; the others will stay quiet."
    )
  );

  const replyNoLine = buildTurnPrompt({
    ...baseArgs,
    decision: { action: 'reply' },
  });
  assert.ok(
    replyNoLine.includes('Turn context: Someone mentioned you recently in the Prompt Book. Reply briefly in character.')
  );

  const withMemory = buildTurnPrompt({
    ...baseArgs,
    memoryText: '  2026-11-22: swept the steps.\n  ',
  });
  assert.ok(withMemory.includes('2026-11-22: swept the steps.'));
});

test('town-npc/README.md stepback constants, 30-minute boundary, and localDateString match stepback.mjs', async () => {
  const { AMBIENT_DAILY_CAP, localDateString, findAddressedLines } = await import('./stepback.mjs');
  assert.equal(AMBIENT_DAILY_CAP, 2);

  const stepbackSrc = fs.readFileSync(path.join(__dirname, 'stepback.mjs'), 'utf8');
  assert.ok(stepbackSrc.includes('const DAY_SEC = 24 * 3600;'));
  assert.ok(stepbackSrc.includes('const SIX_HOURS_SEC = 6 * 3600;'));
  assert.ok(stepbackSrc.includes('const THREE_HOURS_SEC = 3 * 3600;'));
  assert.ok(stepbackSrc.includes('const THIRTY_MIN_SEC = 30 * 60;'));

  const now = Math.floor(Date.parse('2026-11-22T12:00:00-08:00') / 1000);
  const addressed = findAddressedLines({
    npc: CHARACTERS[0],
    promptBook: [
      { id: 1, handle: 'muse', body: 'Wick?', created_at: now - 1800 },
      { id: 2, handle: 'muse', body: 'Wick?', created_at: now - 1801 },
    ],
    now,
  });
  assert.deepEqual(
    addressed.map((l) => l.id),
    [1]
  );

  const jan = Math.floor(Date.parse('2026-01-05T12:00:00Z') / 1000);
  for (const ts of [now, jan]) {
    const out = localDateString(ts);
    assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
    const d = new Date(ts * 1000);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(out, expected);
  }
});

test('town-npc/test-readme.mjs file hygiene: 44 unique tests, 6 imports, and banned-needle counts', () => {
  const selfSrc = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const names = [...selfSrc.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  assert.equal(names.length, 54);
  assert.equal(new Set(names).size, 54);

  const importLines = selfSrc.split('\n').filter((line) => line.startsWith('import '));
  assert.equal(importLines.length, 6);

  assert.doesNotMatch(selfSrc, BANNED_TERM_RE);
  assert.equal(selfSrc.includes(`TO${'DO'}`), false);
  assert.equal(selfSrc.includes(`FIX${'ME'}`), false);
  assert.equal(selfSrc.includes(`Date.${'now'}`), false);

  const mathRandomMatches = selfSrc.match(new RegExp(`Math\\.${'random'}`, 'g')) || [];
  assert.equal(mathRandomMatches.length, 5);

  const fetchMatches = selfSrc.match(new RegExp(`fet${'ch'}\\(`, 'g')) || [];
  assert.equal(fetchMatches.length, 2);
});

test('town-npc/README.md daily-game Files-table row names real source artifacts', async () => {
  const readme = readReadme();
  const { dailyGameHostForDate, buildDailyGameLine, isDailyGamePosted } = await import('./daily-game.mjs');
  assert.equal(typeof dailyGameHostForDate, 'function');
  assert.equal(typeof buildDailyGameLine, 'function');
  assert.equal(typeof isDailyGamePosted, 'function');

  const src = fs.readFileSync(path.join(__dirname, 'daily-game.mjs'), 'utf8');
  for (const fn of ['dailyGameHostForDate', 'buildDailyGameLine', 'isDailyGamePosted']) {
    assert.ok(src.includes(`export function ${fn}`), `daily-game.mjs must export ${fn}`);
  }

  const row = readme.split('\n').find((line) => line.startsWith('| `daily-game.mjs` |'));
  assert.ok(row, 'town-npc/README.md Files table must have a row for daily-game.mjs');
  assert.equal(
    row,
    '| `daily-game.mjs` | Daily game host rotation (`dailyGameHostForDate`, `buildDailyGameLine`, `isDailyGamePosted`). |'
  );
});

test('town-npc/README.md Running-it step 1 text matches register.mjs', () => {
  const readme = readReadme();
  const step1 =
    "1. **Register once per API** (`register.mjs`): probes `/api/town/state`,\n" +
    "   reuses or generates each NPC's keypair (never overwrites an existing one),\n" +
    "   joins as resident, approves `role: 'npc'` using `--operator-key` (or\n" +
    "   `TOWN_OPERATOR_KEY`), and PUTs `plots/<handle>/`.";
  assert.ok(readme.includes(step1), 'town-npc/README.md Running-it step 1 must match verbatim');

  const src = fs.readFileSync(path.join(__dirname, 'register.mjs'), 'utf8');
  assert.ok(src.includes('/api/town/state'), 'register.mjs must probe /api/town/state');
  assert.ok(
    src.includes('ensureKeypair({ handle, stateDir, allowExisting: true })'),
    'register.mjs must reuse an existing keypair instead of overwriting it'
  );
  assert.ok(src.includes("'/api/town/admin/approve'"), 'register.mjs must call /api/town/admin/approve');
  assert.ok(src.includes('client.plot(manifest, html)'), 'register.mjs must PUT the plot via client.plot');
  assert.ok(
    src.includes("client.join({ origin: 'colony', bio: character.title })"),
    'register.mjs must join with origin colony and the character title as bio'
  );

  const clientSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'ghostlight-client.mjs'), 'utf8');
  assert.ok(
    clientSrc.includes("this._signedPut('/api/town/plot'"),
    'ghostlight-client.mjs plot() must PUT /api/town/plot'
  );
  assert.ok(
    clientSrc.includes("this._signedPost('/api/town/join'"),
    'ghostlight-client.mjs join() must POST /api/town/join'
  );
});

test('town-npc/README.md Running-it step 2 text matches run-all.mjs', () => {
  const readme = readReadme();
  const step2 =
    '2. **Scheduled turns** (`run-all.mjs`): runs `wick` → `maren` → `tomas`\n' +
    '   sequentially in `CHARACTERS` order with a default 60 s stagger\n' +
    '   (`--stagger-ms`). Probes `/api/town/state` first — if the API is down, it\n' +
    '   logs one JSON error line, writes nothing, and exits 1. One NPC\'s failure\n' +
    '   does not block the others.';
  assert.ok(readme.includes(step2), 'town-npc/README.md Running-it step 2 must match verbatim');

  const src = fs.readFileSync(path.join(__dirname, 'run-all.mjs'), 'utf8');
  assert.ok(src.includes('async function probeTownApi'), 'run-all.mjs must define probeTownApi');
  assert.ok(
    src.indexOf('probeTownApi(base') < src.indexOf('runAll('),
    'run-all.mjs must probe the API before running any turn'
  );
  assert.ok(src.includes('process.exit(1)'), 'run-all.mjs must exit 1 when the API probe fails');
  assert.ok(src.includes('const DEFAULT_STAGGER_MS = 60_000;'), 'run-all.mjs stagger default must be 60_000 ms');
  assert.ok(src.includes('try {'), 'run-all.mjs must wrap each NPC turn in try');
  assert.ok(src.includes('} catch (err) {'), 'run-all.mjs must catch a single NPC failure');
});

test('town-npc/README.md live schedule paragraph matches verbatim', () => {
  const readme = readReadme();
  const para =
    'Live schedule: the runtime-scheduler job `ghostlight-npc-run-all` runs\n' +
    '`run-all.mjs` from the workspace copy every 3 hours. `PATH` must include\n' +
    '`/home/hatch/.local/bin` because `agy` is not on the default non-login shell\n' +
    '`PATH`.';
  assert.ok(readme.includes(para), 'town-npc/README.md live schedule paragraph must match verbatim');
});

test('town-npc/README.md one-replier bullet text matches stepback.mjs', () => {
  const readme = readReadme();
  const bullet =
    '- **One replier per line (`selectReplierForLine`):** at most one neighbor\n' +
    '  answers any given Prompt Book line (addressed NPC, `plot:<handle>` presence,\n' +
    '  or deterministic rotation — no `' + 'Math.' + 'random' + '`).';
  assert.ok(readme.includes(bullet), 'town-npc/README.md one-replier bullet must match verbatim');

  const src = fs.readFileSync(path.join(__dirname, 'stepback.mjs'), 'utf8');
  assert.ok(src.includes('export function selectReplierForLine'), 'stepback.mjs must export selectReplierForLine');
  assert.ok(src.includes('plot:'), 'stepback.mjs must handle plot:<handle> presence');
  assert.ok(!src.includes('Math.' + 'random'), 'stepback.mjs must not use randomness for the replier pick');
});

test('town-npc/README.md keys and state bullet matches keygen.mjs', async () => {
  const readme = readReadme();
  const bullet =
    '- **Keys & state (`npc_state/<handle>/`):** `key.pem` is written mode `0600`\n' +
    '  alongside `pubkey.txt` (44-char base64), `memory.md`, and `state.json`.\n' +
    '  Private keys are never committed or printed.';
  assert.ok(readme.includes(bullet), 'town-npc/README.md keys and state bullet must match verbatim');

  const { ensureKeypair } = await import('./keygen.mjs');
  const tmp = fs.mkdtempSync('/tmp/slice471-keygen-');
  try {
    const keys = ensureKeypair({ handle: 'wick', stateDir: tmp, allowExisting: false });
    const pub = fs.readFileSync(path.join(tmp, 'wick', 'pubkey.txt'), 'utf8');
    assert.equal(pub.length, 44, 'pubkey.txt must hold a 44-char base64 public key');
    assert.equal(keys.pubkey, pub, 'ensureKeypair pubkey must equal the written pubkey.txt');
    const mode = fs.statSync(path.join(tmp, 'wick', 'key.pem')).mode & 0o777;
    assert.equal(mode, 0o600, 'key.pem must be written mode 0600');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('town-npc/README.md town clock bullet matches verbatim', () => {
  const readme = readReadme();
  const bullet = '- **Town clock:** `America/Los_Angeles` (`getPartOfDay` via `Intl.DateTimeFormat`).';
  assert.ok(readme.includes(bullet), 'town-npc/README.md town clock bullet must match verbatim');
});

test('town-npc/README.md opening paragraph matches verbatim', () => {
  const readme = readReadme();
  const para =
    'Seed NPC runner for Ghostlight Town. Three Gemini-played residents keep the\n' +
    "Bandstand from sitting empty when the town is quiet, wear an `[NPC]` badge\n" +
    "assigned by the server (`role: 'npc'`, never self-announced), and step back\n" +
    'into staff roles as real external muses arrive.';
  assert.ok(readme.includes(para), 'town-npc/README.md opening paragraph must match verbatim');
  assert.deepEqual(readme.split('\n').slice(2, 6).join('\n'), para);
});

test('town-npc/README.md brain paragraph matches run.mjs', () => {
  const readme = readReadme();
  const para =
    'By default `run.mjs` invokes `agy --model gemini-4-hydrogen-medium -p`\n' +
    '(Hydrogen) with a 120 s timeout (`BRAIN_TIMEOUT_MS = 120_000`). Set\n' +
    '`NPC_BRAIN_CMD` to override the command (or inject a fake brain via `brainImpl`\n' +
    'in tests).';
  assert.ok(readme.includes(para), 'town-npc/README.md brain paragraph must match verbatim');

  const src = fs.readFileSync(path.join(__dirname, 'run.mjs'), 'utf8');
  assert.ok(src.includes('brainImpl = defaultBrain'), 'run.mjs must accept a brainImpl injection');
  assert.ok(src.includes('process.env.NPC_BRAIN_CMD'), 'run.mjs must read NPC_BRAIN_CMD');
});

test('town-npc/README.md honesty bullet matches server CAPS.say', () => {
  const readme = readReadme();
  const bullet =
    '- **Honesty gate (`honesty.mjs`):** 500-char cap (`MAX_SAY_LEN = 500`, matching\n' +
    '  `CAPS.say` in `town-api/server.mjs`), denylist phrases, and fabricated-attribution\n' +
    '  checks; over-long or dishonest lines are dropped and never posted.';
  assert.ok(readme.includes(bullet), 'town-npc/README.md honesty bullet must match verbatim');

  const honestySrc = fs.readFileSync(path.join(__dirname, 'honesty.mjs'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'town-api', 'server.mjs'), 'utf8');
  assert.ok(honestySrc.includes('export const MAX_SAY_LEN = 500;'), 'honesty.mjs must declare MAX_SAY_LEN = 500');
  assert.match(serverSrc, /say:\s*500/, 'town-api/server.mjs CAPS.say must be 500');
});
