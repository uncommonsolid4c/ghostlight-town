/**
 * Ghostlight Town — drift guard for town-api/README.md (Slice 122)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_MANIFEST_BYTES,
  MAX_HTML_BYTES,
  MAX_PROPS,
} from './plot-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(__dirname);
const README_PATH = path.join(__dirname, 'README.md');
const SHIPPED_EXTS = new Set(['.mjs', '.json', '.sql']);

function readReadme() {
  return fs.readFileSync(README_PATH, 'utf8');
}

function isTestFile(name) {
  return name === 'test.mjs' || (name.startsWith('test-') && name.endsWith('.mjs'));
}

test('town-api/README.md names every shipped .mjs/.json/.sql file in town-api/', () => {
  const readme = readReadme();
  const shippedFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        SHIPPED_EXTS.has(path.extname(entry.name)) &&
        !isTestFile(entry.name)
    )
    .map((entry) => entry.name)
    .sort();

  assert.ok(shippedFiles.length > 0, 'town-api/ must contain shipped files');
  for (const file of shippedFiles) {
    assert.ok(
      readme.includes(`\`${file}\``),
      `town-api/README.md must document shipped file ${file}`
    );
  }
});

test('town-api/README.md names every test file in town-api/', () => {
  const readme = readReadme();
  const testFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isTestFile(entry.name))
    .map((entry) => entry.name)
    .sort();

  assert.ok(testFiles.length > 0, 'town-api/ must contain test files');
  for (const file of testFiles) {
    assert.ok(
      readme.includes(`\`${file}\``),
      `town-api/README.md must document test file ${file}`
    );
  }
});

test('town-api/README.md documents all env vars and ports 8124 / 8125', () => {
  const readme = readReadme();
  for (const envVar of [
    'TOWN_PORT',
    'TOWN_DB_PATH',
    'TOWN_PLOTS_DIR',
    'TOWN_OPERATOR_PUBKEY',
    'TOWN_EVENTS_PATH',
    'TOWN_API_BASE',
  ]) {
    assert.ok(
      readme.includes(`\`${envVar}\``),
      `town-api/README.md must document env var ${envVar}`
    );
  }
  assert.match(readme, /\b8124\b/);
  assert.match(readme, /\b8125\b/);
});

test('town-api/README.md states honest limits (live state keys, no pinned counters) and key-path rail', () => {
  const readme = readReadme();
  assert.match(readme, /serves the `events` and `guestbook_by_plot` keys/);
  assert.match(readme, /Live state keys/);
  const honestStart = readme.indexOf('## Honest limits');
  const honestEnd = readme.indexOf('\n## ', honestStart + 1);
  const honestSection = honestEnd === -1 ? readme.slice(honestStart) : readme.slice(honestStart, honestEnd);
  assert.doesNotMatch(honestSection, /predates/i);
  assert.match(readme, /foreground turn/i);
  assert.match(readme, /never pinned|not pinned/i);
  assert.match(readme, /filesystem paths only|file path only/i);
  assert.doesNotMatch(readme, /campfire/i);
});

test('town-api/README.md Shipped files table matches exact shipped files in town-api/', () => {
  const readme = readReadme();
  const sectionMatch = readme.match(/## Shipped files\s+([\s\S]*?)\n## /);
  assert.ok(sectionMatch, 'Shipped files section must exist');
  const tableFiles = [...sectionMatch[1].matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
    .map((m) => m[1])
    .sort();

  const shippedFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        SHIPPED_EXTS.has(path.extname(entry.name)) &&
        !isTestFile(entry.name)
    )
    .map((entry) => entry.name)
    .sort();

  assert.equal(
    tableFiles.some((name) => isTestFile(name)),
    false,
    'Shipped files table must not list test files'
  );
  assert.deepEqual(tableFiles, shippedFiles);
});

test('town-api/README.md test-suite count and list match run-tests.mjs and town-api/', () => {
  const readme = readReadme();
  const countMatch = readme.match(/(\d+)\s+suites in `town-api\/`/);
  assert.ok(countMatch, 'README must state "<N> suites in `town-api/`"');
  const readmeCount = Number(countMatch[1]);

  const testFiles = fs
    .readdirSync(__dirname, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isTestFile(entry.name))
    .map((entry) => entry.name)
    .sort();

  const runTestsSrc = fs.readFileSync(path.join(ROOT_DIR, 'run-tests.mjs'), 'utf8');
  const registered = [...runTestsSrc.matchAll(/'town-api\/([^']+)'/g)]
    .map((m) => m[1])
    .sort();

  assert.equal(readmeCount, testFiles.length, 'README suite count must match town-api/ test files');
  assert.deepEqual(registered, testFiles, 'run-tests.mjs town-api/ suites must match town-api/ test files');
});

test('town-api/README.md schema table count and names match schema.sql', () => {
  const readme = readReadme();
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const tables = [...schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length > 0, 'schema.sql must define tables');
  assert.ok(
    readme.includes(`${tables.length} tables:`),
    `README must document "${tables.length} tables:"`
  );
  for (const table of tables) {
    assert.ok(readme.includes(`\`${table}\``), `README must name schema table ${table}`);
  }
});

test('town-api/README.md nightly-topics count matches nightly-topics.json', () => {
  const readme = readReadme();
  const topics = JSON.parse(fs.readFileSync(path.join(__dirname, 'nightly-topics.json'), 'utf8'));
  assert.ok(Array.isArray(topics) && topics.length > 0, 'nightly-topics.json must be a non-empty array');
  assert.ok(
    readme.includes(`${topics.length} curated Nightly Call`),
    `README must state "${topics.length} curated Nightly Call"`
  );
});

test('town-api/README.md route count matches town.json', () => {
  const readme = readReadme();
  const townJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'town.json'), 'utf8'));
  const endpoints = townJson.endpoints;
  assert.ok(Array.isArray(endpoints) && endpoints.length > 0);
  const gets = endpoints.filter((e) => e.method === 'GET').length;
  const posts = endpoints.filter((e) => e.method === 'POST').length;
  const puts = endpoints.filter((e) => e.method === 'PUT').length;
  assert.ok(
    readme.includes(`${endpoints.length}-route contract (\`${gets} GET\`, \`${posts} POST\`, \`${puts} PUT\`)`),
    `README must state "${endpoints.length}-route contract (\`${gets} GET\`, \`${posts} POST\`, \`${puts} PUT\`)"`
  );
});

test('town-api/README.md rate limits, size caps, and retention match server.mjs and plot-validation.mjs', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  const numConst = (name) => {
    const m = serverSrc.match(new RegExp(`const ${name} = ([^;]+);`));
    assert.ok(m, `Missing constant ${name} in server.mjs`);
    return Function(`"use strict"; return (${m[1]});`)();
  };

  const capVal = (key) => {
    const m = serverSrc.match(new RegExp(`\\b${key}:\\s*(\\d+)`));
    assert.ok(m, `Missing CAPS.${key} in server.mjs`);
    return Number(m[1]);
  };

  const rateVal = (key) => {
    const m = serverSrc.match(new RegExp(`${key}:\\s*\\{\\s*max:\\s*(\\d+),\\s*windowSec:\\s*([^}]+)\\}`));
    assert.ok(m, `Missing RATE_LIMITS.${key} in server.mjs`);
    return {
      max: Number(m[1]),
      windowSec: Function(`"use strict"; return (${m[2]});`)(),
    };
  };

  const skewSec = numConst('TIMESTAMP_SKEW_SEC');
  const nonceSec = numConst('NONCE_TTL_SEC');
  const footlightMin = numConst('FOOTLIGHT_TTL_SEC') / 60;
  const retentionDays = numConst('PROMPT_BOOK_RETENTION_SEC') / 86400;
  const bodyKb = numConst('MAX_BODY_BYTES') / 1024;
  const innMaxNights = numConst('INN_MAX_NIGHTS');
  const innKeyLen = numConst('INN_KEY_LEN');

  assert.ok(readme.includes(`${skewSec} s timestamp skew`));
  assert.ok(readme.includes(`${nonceSec} s in-memory nonce`));
  assert.ok(readme.includes(`${footlightMin}-min footlight TTL`));
  assert.ok(readme.includes(`${retentionDays} days (\`PROMPT_BOOK_RETENTION_SEC\`)`));
  assert.ok(readme.includes(`\`${bodyKb} KB\` request body cap`));
  assert.ok(readme.includes(`1–${innMaxNights} nights`));
  assert.ok(readme.includes(`one-time ${innKeyLen}-char room key`));

  assert.ok(readme.includes(`\`say\` ${capVal('say')} chars`));
  assert.ok(readme.includes(`\`status_text\` ${capVal('statusText')} chars`));
  assert.ok(readme.includes(`\`bio\` ${capVal('bio')} chars`));
  assert.ok(
    readme.includes(`\`guestbook\` name ${capVal('guestbookName')} / body ${capVal('guestbookBody')} chars`)
  );

  assert.ok(readme.includes(`\`${MAX_MANIFEST_BYTES / 1024} KB\` (\`${MAX_PROPS}\` props max)`));
  assert.ok(readme.includes(`plot HTML \`${MAX_HTML_BYTES / 1024} KB\``));

  const joinRl = rateVal('joinIp');
  const checkinRl = rateVal('checkin');
  const sayRl = rateVal('say');
  const plotRl = rateVal('plot');
  const innRl = rateVal('innClaim');
  const rotateRl = rateVal('keyRotate');
  const guestbookRl = rateVal('guestbook');

  assert.ok(readme.includes(`\`join\` \`${joinRl.max}/h\` per IP`) && joinRl.windowSec === 3600);
  assert.ok(readme.includes(`\`checkin\` \`${checkinRl.max}/min\``) && checkinRl.windowSec === 60);
  assert.ok(readme.includes(`\`say\` \`${sayRl.max}/${sayRl.windowSec / 60} min\``));
  assert.ok(readme.includes(`\`plot\` \`${plotRl.max}/h\``) && plotRl.windowSec === 3600);
  assert.ok(readme.includes(`\`inn/claim\` & \`inn/extend\` \`${innRl.max}/h\``) && innRl.windowSec === 3600);
  assert.ok(readme.includes(`\`key/rotate\` \`${rotateRl.max}/h\``) && rotateRl.windowSec === 3600);
  assert.ok(readme.includes(`\`guestbook\` \`${guestbookRl.max}/h\` per IP`) && guestbookRl.windowSec === 3600);
});

test('town-api/README.md Endpoint map lists every town.json route and names eight groups', () => {
  const readme = readReadme();
  const townJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'town.json'), 'utf8'));
  const endpoints = townJson.endpoints;
  assert.equal(endpoints.length, 30);
  assert.equal(endpoints.filter((e) => e.method === 'GET').length, 4);
  assert.equal(endpoints.filter((e) => e.method === 'POST').length, 25);
  assert.equal(endpoints.filter((e) => e.method === 'PUT').length, 1);

  const sectionMatch = readme.match(/## Endpoint map\s+([\s\S]*?)\n## /);
  assert.ok(sectionMatch, 'Endpoint map section must exist');
  const section = sectionMatch[1];

  assert.ok(section.includes('eight groups:'), 'Endpoint map must name eight groups');
  const groupBullets = [...section.matchAll(/^- \*\*[^*]+\*\*/gm)];
  assert.equal(groupBullets.length, 8, 'Endpoint map must have 8 bold group bullets');

  for (const ep of endpoints) {
    const escapedPath = ep.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\`${ep.method} ${escapedPath}(\\?[^\`]*)?\``);
    assert.match(section, re, `Endpoint map must list ${ep.method} ${ep.path}`);
  }
});

test('town-api/README.md Startup migrations match server.mjs', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const sectionMatch = readme.match(/## Startup migrations\s+([\s\S]*?)\n## /);
  assert.ok(sectionMatch, 'Startup migrations section must exist');
  const section = sectionMatch[1];

  assert.ok(section.includes('`residents.role`'));
  assert.ok(section.includes('`prompt_book.reply_to`'));
  assert.ok(section.includes('`guestbook.plot`'));
  assert.ok(section.includes('`residents`'));

  assert.ok(
    serverSrc.includes(
      "ALTER TABLE residents ADD COLUMN role TEXT NOT NULL DEFAULT 'muse' CHECK (role IN ('muse', 'npc'))"
    ),
    'server.mjs must add residents.role with muse/npc CHECK'
  );
  assert.ok(
    serverSrc.includes('ALTER TABLE prompt_book ADD COLUMN reply_to INTEGER'),
    'server.mjs must add prompt_book.reply_to as INTEGER'
  );
  assert.ok(
    serverSrc.includes('ALTER TABLE guestbook ADD COLUMN plot TEXT'),
    'server.mjs must add guestbook.plot as TEXT'
  );
  assert.ok(
    serverSrc.includes("!residentsMaster.sql.includes(\"'direct'\")") &&
      serverSrc.includes('CREATE TABLE residents_new'),
    "server.mjs must rebuild residents when stored CREATE TABLE SQL lacks 'direct'"
  );
});

test('town-api/README.md Ed25519 auth wire format matches server.mjs and ghostlight-client.mjs', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(__dirname, 'ghostlight-client.mjs'), 'utf8');

  const headers = [
    ['X-Muse-Handle', 'x-muse-handle'],
    ['X-Muse-Timestamp', 'x-muse-timestamp'],
    ['X-Muse-Nonce', 'x-muse-nonce'],
    ['X-Muse-Signature', 'x-muse-signature'],
  ];
  for (const [wireName, lowerName] of headers) {
    assert.ok(readme.includes(`\`${wireName}\``), `README must document ${wireName}`);
    assert.ok(
      serverSrc.includes(`req.headers['${lowerName}']`),
      `server.mjs must read req.headers['${lowerName}']`
    );
    assert.ok(
      clientSrc.includes(`'${wireName}':`),
      `ghostlight-client.mjs must send '${wireName}'`
    );
  }

  const canonical = '{METHOD}\\n{PATH}\\n{TIMESTAMP}\\n{NONCE}\\n{SHA256_HEX(raw_body)}';
  assert.ok(readme.includes(canonical), 'README must document canonical string');
  assert.ok(serverSrc.includes(canonical), 'server.mjs must comment canonical string');
  assert.ok(clientSrc.includes(canonical), 'ghostlight-client.mjs must comment canonical string');

  const spkiHex = '302a300506032b6570032100';
  assert.equal(spkiHex.length, 24, 'SPKI prefix hex must be 24 chars (12 bytes)');
  assert.ok(readme.includes(`\`${spkiHex}\``), 'README must document SPKI prefix hex');
  assert.ok(serverSrc.includes(spkiHex), 'server.mjs must define SPKI prefix hex');
  assert.ok(clientSrc.includes(spkiHex), 'ghostlight-client.mjs must define SPKI prefix hex');
});

test('town-api/README.md CLI quickstart lists every command ghostlight-client.mjs dispatches', () => {
  const readme = readReadme();
  const clientSrc = fs.readFileSync(path.join(__dirname, 'ghostlight-client.mjs'), 'utf8');

  const usageMatch = clientSrc.match(/const CLI_USAGE = \[([\s\S]*?)\]\.join\('\\n'\);/);
  assert.ok(usageMatch, 'CLI_USAGE must exist in ghostlight-client.mjs');
  const cmds = [...usageMatch[1].matchAll(/'  ([a-z-]+)\s+--/g)].map((m) => m[1]);
  assert.deepEqual(cmds, [
    'keygen',
    'guest-checkin',
    'guest-say',
    'join',
    'checkin',
    'say',
    'leave',
    'presence',
    'plot',
    'getplot',
    'state',
  ]);

  const quickstartMatch = readme.match(
    /## `ghostlight-client\.mjs` CLI quickstart\s+```bash\n([\s\S]*?)\n```/
  );
  assert.ok(quickstartMatch, 'CLI quickstart bash block must exist');
  const quickstart = quickstartMatch[1];

  for (const cmd of cmds) {
    assert.ok(
      quickstart.includes(`ghostlight-client.mjs ${cmd}`),
      `CLI quickstart must list command ${cmd}`
    );
    assert.ok(
      clientSrc.includes(`cmd === '${cmd}'`),
      `ghostlight-client.mjs must dispatch command ${cmd}`
    );
  }
});

test('town-api/README.md Backups section matches backup.mjs and backup-plots.mjs', () => {
  const readme = readReadme();
  const backupSrc = fs.readFileSync(path.join(__dirname, 'backup.mjs'), 'utf8');
  const backupPlotsSrc = fs.readFileSync(path.join(__dirname, 'backup-plots.mjs'), 'utf8');

  assert.ok(readme.includes('`town-YYYYMMDD-HHMMSS.db`'));
  assert.ok(readme.includes('`plots-YYYYMMDD-HHMMSS/`'));
  assert.ok(readme.includes('(rejecting symlinks)'));

  assert.ok(backupSrc.includes('const base = `town-${timestamp}`;'));
  assert.ok(backupSrc.includes('let candidate = `${base}.db`;'));
  assert.ok(backupPlotsSrc.includes('const base = `plots-${timestamp}`;'));

  for (const [label, src] of [
    ['backup.mjs', backupSrc],
    ['backup-plots.mjs', backupPlotsSrc],
  ]) {
    assert.ok(src.includes('getUTCFullYear()'), `${label} must use UTC year`);
    assert.ok(src.includes("padStart(2, '0')"), `${label} must zero-pad timestamp fields`);
    assert.ok(
      src.includes('return `${y}${m}${d}-${hh}${mm}${ss}`;'),
      `${label} must format timestamp as YYYYMMDD-HHMMSS`
    );
  }

  const tablesMatch = backupSrc.match(/export const SCHEMA_TABLES = \[([\s\S]*?)\];/);
  assert.ok(tablesMatch, 'SCHEMA_TABLES must exist in backup.mjs');
  const codeTables = [...tablesMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const expectedTables = [
    'residents',
    'invitations',
    'prompt_book',
    'footlights',
    'presence',
    'key_history',
    'meta',
    'inn_claims',
    'guestbook',
    'fish_casts',
    'fish_catches',
    'garden_plants',
  ];
  assert.deepEqual(codeTables, expectedTables);

  const readmeTablesMatch = readme.match(/across the 12 core schema tables \(([^)]+)\)/);
  assert.ok(readmeTablesMatch, 'README must list the 12 core schema tables');
  const readmeTables = [...readmeTablesMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(readmeTables, codeTables);

  assert.ok(backupPlotsSrc.includes('function copyTreeNoSymlinks('));
  assert.match(
    backupPlotsSrc,
    /if \(lstat\.isSymbolicLink\(\)\) \{\s*throw new Error\(`Symlink found/
  );
});

test('town-api/README.md Rate limits line covers guest limits matching server.mjs', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  const rateVal = (key) => {
    const m = serverSrc.match(new RegExp(`${key}:\\s*\\{\\s*max:\\s*(\\d+),\\s*windowSec:\\s*([^}]+)\\}`));
    assert.ok(m, `Missing RATE_LIMITS.${key} in server.mjs`);
    return {
      max: Number(m[1]),
      windowSec: Function(`"use strict"; return (${m[2]});`)(),
    };
  };

  const guestCheckinRl = rateVal('guestCheckin');
  const guestSayRl = rateVal('guestSay');
  const guestInnRl = rateVal('guestInnClaim');

  assert.equal(guestCheckinRl.max, 1);
  assert.equal(guestCheckinRl.windowSec, 300);
  assert.equal(guestSayRl.max, 2);
  assert.equal(guestSayRl.windowSec, 600);
  assert.equal(guestInnRl.max, 2);
  assert.equal(guestInnRl.windowSec, 3600);
  assert.equal(
    serverSrc.includes('guestInnExtend'),
    false,
    'server.mjs must not have a separate guestInnExtend bucket'
  );

  assert.ok(readme.includes('`guest-checkin` `1/5 min`'));
  assert.ok(readme.includes('`guest-say` `2/10 min`'));
  assert.ok(readme.includes('`inn/guest/claim` & `inn/guest/extend` `2/h`'));
});

test('town-api/README.md env-vars table rows match code', () => {
  const readme = readReadme();
  const sectionMatch = readme.match(/## Environment variables & ports\s+([\s\S]*?)\n\nLive production/);
  assert.ok(sectionMatch, 'Environment variables & ports table section must exist');

  const rows = new Map();
  for (const m of sectionMatch[1].matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)) {
    const usedBy = m[2].replace(/`/g, '').split(',').map((s) => s.trim()).join(', ');
    rows.set(m[1], { usedBy, purpose: m[3] });
  }
  assert.equal(rows.size, 6, 'Env-vars table must have 6 rows');

  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const backupSrc = fs.readFileSync(path.join(__dirname, 'backup.mjs'), 'utf8');
  const backupPlotsSrc = fs.readFileSync(path.join(__dirname, 'backup-plots.mjs'), 'utf8');
  const eventsSrc = fs.readFileSync(path.join(__dirname, 'events.mjs'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(__dirname, 'ghostlight-client.mjs'), 'utf8');

  assert.equal(rows.get('TOWN_PORT').usedBy, 'server.mjs');
  assert.ok(rows.get('TOWN_PORT').purpose.includes('8124'));
  assert.ok(serverSrc.includes('Number(process.env.TOWN_PORT) || 8124'));

  assert.equal(rows.get('TOWN_DB_PATH').usedBy, 'server.mjs, backup.mjs');
  assert.ok(rows.get('TOWN_DB_PATH').purpose.includes('town-api/town.db'));
  assert.ok(serverSrc.includes('process.env.TOWN_DB_PATH'));
  assert.ok(backupSrc.includes('process.env.TOWN_DB_PATH'));

  assert.equal(rows.get('TOWN_PLOTS_DIR').usedBy, 'server.mjs, backup-plots.mjs');
  assert.ok(rows.get('TOWN_PLOTS_DIR').purpose.includes('town-api/plots'));
  assert.ok(serverSrc.includes('process.env.TOWN_PLOTS_DIR'));
  assert.ok(backupPlotsSrc.includes('process.env.TOWN_PLOTS_DIR'));

  assert.equal(rows.get('TOWN_OPERATOR_PUBKEY').usedBy, 'server.mjs');
  assert.ok(rows.get('TOWN_OPERATOR_PUBKEY').purpose.includes('503'));
  assert.ok(serverSrc.includes('status: 503'));

  assert.equal(rows.get('TOWN_EVENTS_PATH').usedBy, 'server.mjs');
  assert.ok(rows.get('TOWN_EVENTS_PATH').purpose.includes('town-api/events.json'));
  assert.ok(rows.get('TOWN_EVENTS_PATH').purpose.includes('fail-open'));
  assert.ok(eventsSrc.includes('Fail-open'));

  assert.equal(rows.get('TOWN_API_BASE').usedBy, 'ghostlight-client.mjs');
  assert.ok(rows.get('TOWN_API_BASE').purpose.includes('http://127.0.0.1:8124'));
  assert.ok(clientSrc.includes('process.env.TOWN_API_BASE'));
});

test('town-api/README.md shipped-files Role column names real exported symbols', () => {
  const readme = readReadme();
  const sectionMatch = readme.match(/## Shipped files\s+([\s\S]*?)\n## /);
  assert.ok(sectionMatch, 'Shipped files section must exist');

  const roles = new Map();
  for (const m of sectionMatch[1].matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|$/gm)) {
    roles.set(m[1], m[2]);
  }

  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(__dirname, 'ghostlight-client.mjs'), 'utf8');
  const eventsSrc = fs.readFileSync(path.join(__dirname, 'events.mjs'), 'utf8');
  const backupSrc = fs.readFileSync(path.join(__dirname, 'backup.mjs'), 'utf8');
  const backupPlotsSrc = fs.readFileSync(path.join(__dirname, 'backup-plots.mjs'), 'utf8');

  assert.ok(roles.get('server.mjs').includes('createTownServer'));
  assert.ok(serverSrc.includes('export function createTownServer'));

  assert.ok(roles.get('ghostlight-client.mjs').includes('GhostlightClient'));
  assert.ok(clientSrc.includes('export class GhostlightClient'));

  for (const fn of ['loadEventsFile', 'selectNowNext', 'selectCurrentEvent', 'eventStateKey']) {
    assert.ok(roles.get('events.mjs').includes(fn), `events.mjs role must name ${fn}`);
    assert.ok(eventsSrc.includes(`export function ${fn}`), `events.mjs must export ${fn}`);
  }

  assert.ok(roles.get('plot-validation.mjs').includes('validator'));
  assert.ok(roles.get('plot-validation.mjs').includes('sanitizer'));

  assert.ok(roles.get('backup.mjs').includes('VACUUM INTO'));
  assert.ok(backupSrc.includes('VACUUM INTO'));

  assert.ok(roles.get('backup-plots.mjs').includes('SHA-256'));
  assert.ok(backupPlotsSrc.includes("createHash('sha256')"));

  assert.ok(roles.get('nightly-topics.json').includes('30 curated'));
});

test('town-api/README.md live production line matches town.json', () => {
  const readme = readReadme();
  const townJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'town.json'), 'utf8'));

  const liveMatch = readme.match(/Live production runs on[\s\S]*?\/api\/town\/\*`/);
  assert.ok(liveMatch, 'Live production paragraph must exist');
  const livePara = liveMatch[0];

  assert.ok(livePara.includes(townJson.base_url), 'Live production paragraph must include town.json base_url');
  assert.ok(livePara.includes('/api/town/*'), 'Live production paragraph must include /api/town/*');
  assert.match(livePara, /\b8125\b/, 'Live production paragraph must include port 8125');

  const quickstartMatch = readme.match(
    /## `ghostlight-client\.mjs` CLI quickstart\s+```bash\n([\s\S]*?)\n```/
  );
  assert.ok(quickstartMatch, 'CLI quickstart bash block must exist');
  assert.ok(
    quickstartMatch[1].includes(`export TOWN_API_BASE=${townJson.dev_base_url}`),
    'CLI quickstart must export TOWN_API_BASE=<town.json dev_base_url>'
  );

  assert.ok(townJson.live_note.includes('Live since 2026-11-13'));
  assert.ok(townJson.live_note.includes('/api/town/*'));
});

test('town-api/README.md CLI quickstart flags match allowed flags per command', () => {
  const readme = readReadme();
  const clientSrc = fs.readFileSync(path.join(__dirname, 'ghostlight-client.mjs'), 'utf8');

  const allowedByCmd = new Map();
  for (const m of clientSrc.matchAll(
    /cmd === '([a-z-]+)'\)\s*\{\s*\n\s*const opts = parseCliFlags\(rest,\s*\[([^\]]*)\]\)/g
  )) {
    const flags = [...m[2].matchAll(/'([^']+)'/g)].map((f) => f[1]);
    allowedByCmd.set(m[1], new Set(flags));
  }
  assert.equal(allowedByCmd.size, 11, 'ghostlight-client.mjs must dispatch 11 commands');

  const quickstartMatch = readme.match(
    /## `ghostlight-client\.mjs` CLI quickstart\s+```bash\n([\s\S]*?)\n```/
  );
  assert.ok(quickstartMatch, 'CLI quickstart bash block must exist');
  const lines = quickstartMatch[1]
    .split('\n')
    .filter((line) => line.includes('ghostlight-client.mjs '));

  assert.equal(lines.length, 11, 'CLI quickstart must have exactly 11 command lines');
  const seenCmds = new Set();
  for (const line of lines) {
    assert.equal(line.includes('--api-base'), false, 'CLI quickstart lines must not pass --api-base');
    const cmdMatch = line.match(/ghostlight-client\.mjs\s+([a-z-]+)/);
    assert.ok(cmdMatch, `Quickstart line must name a command: ${line}`);
    const cmd = cmdMatch[1];
    assert.ok(allowedByCmd.has(cmd), `Unknown quickstart command ${cmd}`);
    seenCmds.add(cmd);

    const allowed = allowedByCmd.get(cmd);
    for (const flagMatch of line.matchAll(/--([a-z-]+)/g)) {
      assert.ok(
        allowed.has(flagMatch[1]),
        `Quickstart flag --${flagMatch[1]} is not allowed for ${cmd}`
      );
    }
  }
  assert.equal(seenCmds.size, 11, 'CLI quickstart must cover all 11 dispatched commands once');
});

test('town-api/README.md backup commands match the backup CLIs', () => {
  const readme = readReadme();
  const backupSrc = fs.readFileSync(path.join(__dirname, 'backup.mjs'), 'utf8');
  const backupPlotsSrc = fs.readFileSync(path.join(__dirname, 'backup-plots.mjs'), 'utf8');

  const extractParsedFlags = (src) =>
    new Set([...src.matchAll(/arg === '(--[a-z-]+)'/g)].map((m) => m[1]));

  const backupFlags = extractParsedFlags(backupSrc);
  const backupPlotsFlags = extractParsedFlags(backupPlotsSrc);
  assert.deepEqual([...backupFlags].sort(), ['--db', '--help', '--out-dir']);
  assert.deepEqual([...backupPlotsFlags].sort(), ['--help', '--out-dir', '--plots-dir']);

  const backupCmdMatch = readme.match(/`node town-api\/backup\.mjs ([^`]+)`/);
  const plotsCmdMatch = readme.match(/`node town-api\/backup-plots\.mjs ([^`]+)`/);
  assert.ok(backupCmdMatch, 'README must document node town-api/backup.mjs command');
  assert.ok(plotsCmdMatch, 'README must document node town-api/backup-plots.mjs command');

  for (const m of backupCmdMatch[1].matchAll(/--[a-z-]+/g)) {
    assert.ok(backupFlags.has(m[0]), `backup.mjs must parse ${m[0]}`);
  }
  for (const m of plotsCmdMatch[1].matchAll(/--[a-z-]+/g)) {
    assert.ok(backupPlotsFlags.has(m[0]), `backup-plots.mjs must parse ${m[0]}`);
  }

  assert.equal(backupCmdMatch[1], '[--db <path>] [--out-dir <dir>]');
  assert.ok(
    backupSrc.includes('node town-api/backup.mjs [--db <path>] [--out-dir <dir>] [--help]'),
    'backup.mjs Usage line must match README + [--help]'
  );

  assert.equal(plotsCmdMatch[1], '[--plots-dir <path>] [--out-dir <dir>]');
  assert.ok(
    backupPlotsSrc.includes('node town-api/backup-plots.mjs [--plots-dir <path>] [--out-dir <dir>] [--help]'),
    'backup-plots.mjs Usage line must match README + [--help]'
  );
});

test('town-api/README.md endpoint-map group membership is exact', () => {
  const readme = readReadme();
  const townJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'town.json'), 'utf8'));

  const sectionMatch = readme.match(/## Endpoint map\s+([\s\S]*?)\n## /);
  assert.ok(sectionMatch, 'Endpoint map section must exist');

  const actualGroups = new Map();
  for (const m of sectionMatch[1].matchAll(/^- \*\*([^*]+?):\*\*\s*(.+)$/gm)) {
    const routes = [
      ...m[2].matchAll(/`((?:GET|POST|PUT) \/api\/town\/[^`?]+)(?:\?[^`]*)?`/g),
    ].map((r) => r[1]);
    actualGroups.set(m[1], routes.sort());
  }

  const expectedGroups = {
    'Join / approve / invite': [
      'POST /api/town/join',
      'POST /api/town/admin/approve',
      'POST /api/town/admin/invite',
    ],
    'Checkin / say / leave / presence': [
      'GET /api/town/state',
      'POST /api/town/ghostlight/checkin',
      'POST /api/town/ghostlight/say',
      'POST /api/town/ghostlight/leave',
      'POST /api/town/presence',
      'POST /api/town/fish/cast',
      'POST /api/town/fish/reel',
      'GET /api/town/fish/log',
      'POST /api/town/garden/plant',
    ],
    Plot: ['PUT /api/town/plot', 'GET /api/town/plot'],
    Inn: [
      'POST /api/town/inn/claim',
      'POST /api/town/inn/extend',
      'POST /api/town/inn/vacate',
    ],
    Guest: [
      'POST /api/town/ghostlight/guest/checkin',
      'POST /api/town/ghostlight/guest/say',
      'POST /api/town/inn/guest/claim',
      'POST /api/town/inn/guest/extend',
      'POST /api/town/inn/guest/vacate',
      'POST /api/town/fish/guest/cast',
      'POST /api/town/fish/guest/reel',
      'POST /api/town/garden/guest/plant',
    ],
    'Key rotate': ['POST /api/town/key/rotate'],
    Guestbook: [
      'POST /api/town/guestbook',
      'GET /api/town/guestbook',
      'POST /api/town/admin/guestbook',
    ],
    Admin: [
      'POST /api/town/admin/approve',
      'POST /api/town/admin/invite',
      'POST /api/town/admin/delete-line',
      'POST /api/town/admin/guestbook',
    ],
  };

  assert.equal(actualGroups.size, 8, 'Endpoint map must have 8 groups');
  const union = new Set();
  for (const [name, expected] of Object.entries(expectedGroups)) {
    assert.deepEqual(
      actualGroups.get(name),
      [...expected].sort(),
      `Endpoint map group "${name}" membership mismatch`
    );
    for (const route of expected) union.add(route);
  }

  const townRoutes = townJson.endpoints.map((ep) => `${ep.method} ${ep.path}`).sort();
  assert.equal(townRoutes.length, 30);
  assert.deepEqual([...union].sort(), townRoutes, 'Union of all 8 groups must cover all 30 town.json routes');
});

test('town-api/README.md nightly-topics and daily-games counts and formats match the JSON files', () => {
  const readme = readReadme();
  const topics = JSON.parse(fs.readFileSync(path.join(__dirname, 'nightly-topics.json'), 'utf8'));
  const games = JSON.parse(fs.readFileSync(path.join(__dirname, 'daily-games.json'), 'utf8'));

  assert.ok(Array.isArray(topics));
  assert.equal(topics.length, 30);

  assert.ok(Array.isArray(games));
  assert.equal(games.length, 30);
  const formats = [...new Set(games.map((g) => g.format))].sort();
  assert.deepEqual(formats, ['riddle', 'story', 'word']);

  assert.match(readme, /30 curated Nightly Call/);
  assert.match(readme, /30 daily Bandstand game prompts \(riddle, word, story;/);
});

test('town-api/README.md fish and garden rate limits match server.mjs RATE_LIMITS', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  const rateVal = (key) => {
    const m = serverSrc.match(new RegExp(`${key}:\\s*\\{\\s*max:\\s*(\\d+),\\s*windowSec:\\s*([^}]+)\\}`));
    assert.ok(m, `Missing RATE_LIMITS.${key} in server.mjs`);
    return {
      max: Number(m[1]),
      windowSec: Function(`"use strict"; return (${m[2]});`)(),
    };
  };

  const fishCast = rateVal('fishCast');
  const gardenPlant = rateVal('gardenPlant');
  const guestFishCast = rateVal('guestFishCast');
  const guestGardenPlant = rateVal('guestGardenPlant');

  assert.deepEqual(fishCast, { max: 10, windowSec: 3600 });
  assert.deepEqual(gardenPlant, { max: 10, windowSec: 3600 });
  assert.deepEqual(guestFishCast, { max: 2, windowSec: 3600 });
  assert.deepEqual(guestGardenPlant, { max: 2, windowSec: 3600 });

  assert.ok(readme.includes('`fish/cast` `10/h`'));
  assert.ok(readme.includes('`fish/guest/cast` `2/h`'));
  assert.ok(readme.includes('`POST /api/town/garden/plant` (10/h, 6-slot communal bed)'));
  assert.ok(readme.includes('`POST /api/town/garden/guest/plant` (2/h)'));
});

test('town-api/README.md fish settle time matches SETTLE_SEC', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  assert.ok(serverSrc.includes('const SETTLE_SEC = 300;'));
  assert.ok(readme.includes('`POST /api/town/fish/cast` (10/h, 300s settle)'));
});

test('town-api/README.md garden slot count matches GARDEN_SLOTS', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  assert.ok(serverSrc.includes('const GARDEN_SLOTS = 6;'));
  assert.ok(readme.includes('`POST /api/town/garden/plant` (10/h, 6-slot communal bed)'));
});

test('town-api/README.md fish log cap matches server.mjs LIMIT 50', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  assert.match(serverSrc, /FROM fish_catches[\s\S]*?LIMIT 50/);
  assert.ok(readme.includes('`GET /api/town/fish/log?handle=<handle>` (personal collection, cap 50, not a leaderboard)'));
});

test('town-api/README.md presence zones match server.mjs zone guard', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  assert.ok(serverSrc.includes('const ZONE_PLOT_RE = /^plot:([a-z0-9][a-z0-9_-]{1,31})$/;'));
  assert.ok(serverSrc.includes("zone !== 'gate' && zone !== 'bandstand'"));
  assert.ok(readme.includes('`POST /api/town/presence` (`gate`, `bandstand`, `plot:<handle>`)'));
});

test('town-api/README.md WAL mode matches server.mjs pragma', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  assert.ok(serverSrc.includes("db.exec('PRAGMA journal_mode = WAL;');"));
  assert.ok(readme.includes('in WAL mode'));
});

test('town-api/README.md keygen 0600 and no-overwrite match ghostlight-client.mjs', () => {
  const readme = readReadme();
  const clientSrc = fs.readFileSync(path.join(__dirname, 'ghostlight-client.mjs'), 'utf8');

  assert.ok(clientSrc.includes('mode: 0o600'));
  assert.ok(clientSrc.includes('Refusing to overwrite existing key file'));
  assert.ok(readme.includes('`keygen` writes mode `0600` and refuses to overwrite'));
});

test('town-api/README.md join ignores role matches handleJoin vs handleAdminApprove', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  const joinStart = serverSrc.indexOf('function handleJoin(');
  const checkinStart = serverSrc.indexOf('function handleCheckin(');
  assert.ok(joinStart !== -1 && checkinStart > joinStart, 'handleJoin and handleCheckin boundaries must exist');
  const joinBody = serverSrc.slice(joinStart, checkinStart);
  assert.equal(/\brole\b/.test(joinBody), false, 'handleJoin must not read or reference role');

  const approveStart = serverSrc.indexOf('function handleAdminApprove(');
  assert.ok(approveStart !== -1, 'handleAdminApprove must exist');
  const approveSlice = serverSrc.slice(approveStart, approveStart + 400);
  assert.ok(approveSlice.includes('const role = body.role;'));

  assert.ok(readme.includes('`POST /api/town/join` (self-signed; ignores `role` in body)'));
  assert.ok(readme.includes('`join` ignores any `role` in the body'));
});

test('town-api/README.md Node >= 22.5 requirement matches server.mjs and the running Node', () => {
  const readme = readReadme();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

  const readmeMatch = readme.match(/requires Node >= (\d+)\.(\d+)/);
  assert.ok(readmeMatch, 'town-api/README.md must state requires Node >= <major>.<minor>');
  const serverMatch = serverSrc.match(/`node:sqlite` requires Node >= (\d+)\.(\d+)/);
  assert.ok(serverMatch, 'town-api/server.mjs must state `node:sqlite` requires Node >= <major>.<minor>');

  assert.equal(readmeMatch[1], serverMatch[1], 'README and server.mjs Node major version must agree');
  assert.equal(readmeMatch[2], serverMatch[2], 'README and server.mjs Node minor version must agree');

  const reqMajor = Number(readmeMatch[1]);
  const reqMinor = Number(readmeMatch[2]);
  const nodeMatch = process.version.match(/^v(\d+)\.(\d+)/);
  assert.ok(nodeMatch, `Unexpected process.version format: ${process.version}`);
  const curMajor = Number(nodeMatch[1]);
  const curMinor = Number(nodeMatch[2]);
  assert.ok(
    curMajor > reqMajor || (curMajor === reqMajor && curMinor >= reqMinor),
    `Running Node ${process.version} must satisfy >= ${reqMajor}.${reqMinor}`
  );
});
