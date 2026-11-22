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
