#!/usr/bin/env node
/**
 * Build a Markdown digest of Prompt Book lines for The Ghostlight Gazette.
 *
 * Honest scope note: GET /api/town/state surfaces only the last 24 hours /
 * last 100 lines, so a full Gazette cycle needs several saved snapshots
 * merged with --state (the script dedupes by line id). The digest covers
 * exactly the lines in the snapshots it was given — nothing more.
 *
 * Usage:
 *   node build-digest.mjs --state <path> [--state <path> ...]
 *                         [--since YYYY-MM-DD] [--until YYYY-MM-DD]
 *                         [--out <path>]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOWN_TIME_ZONE = 'America/Los_Angeles';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATE_PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TOWN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TIME_PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TOWN_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const DAY_HEADING_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TOWN_TIME_ZONE,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

function partsMap(formatter, date) {
  const out = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      out[part.type] = part.value;
    }
  }
  return out;
}

function toTownDateKey(date) {
  const p = partsMap(DATE_PARTS_FMT, date);
  return `${p.year}-${p.month}-${p.day}`;
}

function toTownTimeHHMM(date) {
  const p = partsMap(TIME_PARTS_FMT, date);
  return `${p.hour}:${p.minute}`;
}

function parseTownDate(dateStr, flagName) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!match) {
    throw new Error(`Invalid ${flagName} date (expected YYYY-MM-DD): ${dateStr}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${flagName} calendar date: ${dateStr}`);
  }
  return dateStr;
}

function subtractDaysFromDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day - days));
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseArgs(argv) {
  const statePaths = [];
  let since = null;
  let until = null;
  let outPath = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--state') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing path after --state');
      statePaths.push(path.resolve(next));
      i += 1;
    } else if (arg === '--since') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing date after --since');
      since = parseTownDate(next, '--since');
      i += 1;
    } else if (arg === '--until') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing date after --until');
      until = parseTownDate(next, '--until');
      i += 1;
    } else if (arg === '--out') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing path after --out');
      outPath = path.resolve(next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (statePaths.length === 0) {
    throw new Error('At least one --state <path> is required');
  }

  const today = toTownDateKey(new Date());
  const resolvedUntil = until ?? today;
  const resolvedSince = since ?? subtractDaysFromDateKey(resolvedUntil, 6);

  if (resolvedSince > resolvedUntil) {
    throw new Error(`--since (${resolvedSince}) cannot be after --until (${resolvedUntil})`);
  }

  return {
    statePaths,
    since: resolvedSince,
    until: resolvedUntil,
    outPath,
  };
}

function isValidLine(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.id === undefined || entry.id === null || entry.id === '') return false;
  if (typeof entry.id !== 'number' && typeof entry.id !== 'string') return false;
  if (typeof entry.id === 'number' && !Number.isFinite(entry.id)) return false;
  if (typeof entry.handle !== 'string' || entry.handle.trim() === '') return false;
  if (typeof entry.body !== 'string' || entry.body.trim() === '') return false;
  if (typeof entry.created_at !== 'number' || !Number.isFinite(entry.created_at)) return false;
  return true;
}

function compareIds(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

async function loadAndMergeSnapshots(statePaths) {
  const seenIds = new Set();
  const merged = [];
  let skippedCount = 0;

  for (const statePath of statePaths) {
    let raw;
    try {
      raw = await fs.readFile(statePath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read state file ${statePath}: ${err.message}`);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse state JSON ${statePath}: ${err.message}`);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.prompt_book)) {
      throw new Error(`State file ${statePath} must be an object with a prompt_book array`);
    }

    for (const entry of data.prompt_book) {
      if (!isValidLine(entry)) {
        skippedCount += 1;
        continue;
      }
      if (seenIds.has(entry.id)) {
        continue;
      }
      seenIds.add(entry.id);
      merged.push(entry);
    }
  }

  merged.sort((a, b) => compareIds(a.id, b.id));
  return { lines: merged, skippedCount };
}

function formatLineBullet(line) {
  const dt = new Date(line.created_at * 1000);
  const hhmm = toTownTimeHHMM(dt);
  const npcTag = line.role === 'npc' ? ' [NPC]' : '';
  const body = line.kind === 'emote' ? `*${line.body}*` : line.body;
  return `- **${line.handle}**${npcTag} ${hhmm} — ${body}`;
}

function buildDigestMarkdown(lines, since, until) {
  const inWindow = [];
  for (const line of lines) {
    const dt = new Date(line.created_at * 1000);
    const dateKey = toTownDateKey(dt);
    if (dateKey >= since && dateKey <= until) {
      inWindow.push({ line, dt, dateKey });
    }
  }

  const speakers = new Map();
  const byDate = new Map();

  for (const item of inWindow) {
    const { line, dt, dateKey } = item;
    const prev = speakers.get(line.handle);
    if (prev) {
      prev.count += 1;
      if (line.role === 'npc') prev.isNpc = true;
    } else {
      speakers.set(line.handle, {
        handle: line.handle,
        count: 1,
        isNpc: line.role === 'npc',
      });
    }

    let dayBucket = byDate.get(dateKey);
    if (!dayBucket) {
      dayBucket = {
        heading: DAY_HEADING_FMT.format(dt),
        items: [],
      };
      byDate.set(dateKey, dayBucket);
    }
    dayBucket.items.push(item);
  }

  const lineCount = inWindow.length;
  const speakerCount = speakers.size;

  const out = [
    `# Prompt Book digest — ${since} to ${until} (town time)`,
    '',
    `${lineCount} line(s) from ${speakerCount} speaker(s) in the window. Lines are quoted verbatim for Gazette use; [NPC] marks NPC neighbors.`,
    '',
    'Source: state snapshot(s) only — the API surfaces the last 24 hours / last 100 lines, so merge several snapshots for a full Gazette cycle.',
    '',
  ];

  if (lineCount === 0) {
    out.push('No lines in this window.', '');
    return { markdown: out.join('\n'), lineCount, speakerCount };
  }

  const sortedDateKeys = [...byDate.keys()].sort();
  for (const dateKey of sortedDateKeys) {
    const bucket = byDate.get(dateKey);
    bucket.items.sort(
      (a, b) => a.line.created_at - b.line.created_at || compareIds(a.line.id, b.line.id)
    );
    out.push(`## ${bucket.heading}`, '');
    for (const item of bucket.items) {
      out.push(formatLineBullet(item.line));
    }
    out.push('');
  }

  const sortedSpeakers = [...speakers.values()].sort(
    (a, b) => b.count - a.count || (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0)
  );
  out.push('## Speakers', '');
  for (const s of sortedSpeakers) {
    const npcTag = s.isNpc ? ' [NPC]' : '';
    out.push(`- ${s.handle}${npcTag}: ${s.count} line(s)`);
  }
  out.push('');

  return { markdown: out.join('\n'), lineCount, speakerCount };
}

async function main() {
  const { statePaths, since, until, outPath } = parseArgs(process.argv.slice(2));
  const { lines, skippedCount } = await loadAndMergeSnapshots(statePaths);

  if (skippedCount > 0) {
    process.stderr.write(`skipped ${skippedCount} malformed line(s)\n`);
  }

  const { markdown, lineCount, speakerCount } = buildDigestMarkdown(lines, since, until);

  if (outPath) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, markdown, 'utf8');
    process.stdout.write(`digest: ${lineCount} line(s), ${speakerCount} speaker(s)\n`);
  } else {
    process.stdout.write(markdown);
  }
}

// Keep __dirname referenced so script-relative resolution stays explicit.
void __dirname;

main().catch((err) => {
  process.stderr.write(`build-digest error: ${err.message}\n`);
  process.exit(1);
});
