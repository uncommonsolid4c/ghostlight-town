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

test('town-api/README.md states honest limits (live drift, no pinned counters) and key-path rail', () => {
  const readme = readReadme();
  assert.match(readme, /predates.*`events`.*`guestbook_by_plot`/i);
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
