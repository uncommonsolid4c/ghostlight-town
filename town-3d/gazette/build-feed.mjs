import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOWN_BASE = 'https://milo.4167360.xyz/ghostlight-town';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LATEST_PATH = path.join(__dirname, 'latest.json');
const DEFAULT_OUT_PATH = path.join(__dirname, 'feed.xml');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatRfc822NoonUtc(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (!match) {
    throw new Error(`Invalid issue date (expected YYYY-MM-DD): ${dateStr}`);
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
    throw new Error(`Invalid calendar date: ${dateStr}`);
  }
  const dow = DAYS[dt.getUTCDay()];
  const mon = MONTHS[month - 1];
  const dd = String(day).padStart(2, '0');
  return `${dow}, ${dd} ${mon} ${year} 12:00:00 +0000`;
}

function extractLeadDescription(html, fileName) {
  const sectionMatch = /<section\b[^>]*>([\s\S]*?)<\/section>/i.exec(html);
  if (!sectionMatch) {
    throw new Error(`No <section> found in ${fileName}`);
  }
  const pMatch = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(sectionMatch[1]);
  if (!pMatch) {
    throw new Error(`No <p> found inside first <section> of ${fileName}`);
  }
  const plain = pMatch[1]
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= 500) {
    return plain;
  }
  const slice = plain.slice(0, 500);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd();
}

function parseArgs(argv) {
  let outPath = DEFAULT_OUT_PATH;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing path after --out');
      }
      outPath = path.resolve(next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { outPath };
}

async function main() {
  const { outPath } = parseArgs(process.argv.slice(2));

  let latestRaw;
  try {
    latestRaw = await fs.readFile(LATEST_PATH, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read latest.json: ${err.message}`);
  }

  let latest;
  try {
    latest = JSON.parse(latestRaw);
  } catch (err) {
    throw new Error(`Failed to parse latest.json: ${err.message}`);
  }

  if (!latest || !Array.isArray(latest.issues) || latest.issues.length === 0) {
    throw new Error('latest.json must contain a non-empty issues array');
  }

  const issues = [...latest.issues].sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
  const lastBuildDate = formatRfc822NoonUtc(issues[0].date);

  const itemsXml = [];
  for (const issue of issues) {
    if (!issue.file || !issue.date || !issue.headline) {
      throw new Error(`Issue entry missing required fields: ${JSON.stringify(issue)}`);
    }
    const issuePath = path.join(__dirname, issue.file);
    let html;
    try {
      html = await fs.readFile(issuePath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read issue file ${issue.file}: ${err.message}`);
    }

    const description = extractLeadDescription(html, issue.file);
    const link = `${TOWN_BASE}/gazette/${issue.file}`;
    const pubDate = formatRfc822NoonUtc(issue.date);

    itemsXml.push([
      '    <item>',
      `      <title>${escapeXml(issue.headline)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `      <pubDate>${escapeXml(pubDate)}</pubDate>`,
      `      <description>${escapeXml(description)}</description>`,
      '    </item>',
    ].join('\n'));
  }

  const channelDesc =
    "The paper of record for Ghostlight Town — a clearing where nobody's cottage gets torn down.";

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${escapeXml('The Ghostlight Gazette')}</title>`,
    `    <link>${escapeXml(`${TOWN_BASE}/`)}</link>`,
    `    <description>${escapeXml(channelDesc)}</description>`,
    '    <language>en-us</language>',
    `    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`,
    ...itemsXml,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  await fs.writeFile(outPath, xml, 'utf8');
  console.log(`${path.basename(outPath)}: ${itemsXml.length} item(s)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
