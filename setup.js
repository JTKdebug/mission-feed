/**
 * setup.js — Channel ID resolver
 * Reads channels.json and resolves channelId for any entry where it is null.
 * Skips channels that already have an ID.
 *
 * Run: node setup.js
 */

import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function resolveChannelId(handle) {
  const url = `https://www.youtube.com/@${handle}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for @${handle}`);

  const html = await res.text();

  // Strategy 1: RSS <link> tag in HTML head
  const rssMatch = html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]+)/);
  if (rssMatch) return rssMatch[1];

  // Strategy 2: "channelId" in page JSON
  const idMatch = html.match(/"channelId"\s*:\s*"(UC[\w-]+)"/);
  if (idMatch) return idMatch[1];

  // Strategy 3: externalId
  const extMatch = html.match(/"externalId"\s*:\s*"(UC[\w-]+)"/);
  if (extMatch) return extMatch[1];

  throw new Error(`Could not extract channel ID for @${handle}`);
}

async function main() {
  const channelsPath = path.join(__dirname, 'channels.json');
  let channels;

  try {
    channels = JSON.parse(await fs.readFile(channelsPath, 'utf8'));
  } catch {
    throw new Error('channels.json not found');
  }

  const toResolve = channels.filter(c => !c.channelId);

  if (toResolve.length === 0) {
    console.log('All channels already have IDs — nothing to resolve.');
    return;
  }

  console.log(`Resolving ${toResolve.length} new channel(s)...\n`);

  for (const ch of channels) {
    if (ch.channelId) {
      console.log(`  –  ${ch.name.padEnd(36)} (already resolved)`);
      continue;
    }

    try {
      ch.channelId = await resolveChannelId(ch.handle);
      delete ch.error;
      console.log(`  ✓  ${ch.name.padEnd(36)} ${ch.channelId}`);
    } catch (err) {
      console.error(`  ✗  ${ch.name.padEnd(36)} FAILED: ${err.message}`);
      ch.error = err.message;
    }
    await new Promise(r => setTimeout(r, 800));
  }

  await fs.writeFile(channelsPath, JSON.stringify(channels, null, 2));

  const ok = channels.filter(r => r.channelId).length;
  console.log(`\nDone. ${ok}/${channels.length} channels resolved → channels.json`);

  const failed = channels.filter(r => !r.channelId);
  if (failed.length > 0) {
    console.log('\nFailed channels — fill in channelId manually in channels.json:');
    failed.forEach(c => console.log(`  - ${c.name} (@${c.handle})`));
  }
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
