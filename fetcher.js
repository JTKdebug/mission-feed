/**
 * fetcher.js — RSS feed fetcher + parser
 * Reads channels.json, fetches each channel's YouTube RSS feed,
 * parses the XML, and returns videos grouped by channel with longform-first ordering.
 */

import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEOS_PER_CHANNEL = 5;  // shown per channel in the feed
const FETCH_PER_CHANNEL = 15;  // fetched from RSS before shorts filtering

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
});

function extractVideoId(ytIdString) {
  // yt:video:VIDEO_ID
  if (!ytIdString) return null;
  const parts = ytIdString.split(':');
  return parts[parts.length - 1] || null;
}

function isShort(video) {
  const text = (video.title + ' ' + (video.description || '')).toLowerCase();
  return text.includes('#shorts') || text.includes('#short') || /\bshorts?\b/.test(text);
}

function parseFeed(xml, channelMeta) {
  const feed = parser.parse(xml);
  const entries = feed?.feed?.entry;
  if (!entries) return [];

  const list = Array.isArray(entries) ? entries : [entries];

  // Parse up to FETCH_PER_CHANNEL entries to have enough longform content after filtering
  const videos = list.slice(0, FETCH_PER_CHANNEL).map(entry => {
    const videoId = extractVideoId(entry['yt:videoId'] || entry.id);
    const thumbnail =
      entry['media:group']?.['media:thumbnail']?.['@_url'] ||
      (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);
    const description = entry['media:group']?.['media:description'] || '';

    return {
      videoId,
      title: entry.title || 'Untitled',
      channelName: channelMeta.name,
      channelHandle: channelMeta.handle,
      channelCategory: channelMeta.category,
      published: entry.published || entry.updated || null,
      thumbnail,
      description,
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : (entry.link?.['@_href'] || '#'),
    };
  });

  // Sort longform first, shorts last — within each group, newest first
  const longform = videos
    .filter(v => !isShort(v))
    .sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  const shorts = videos
    .filter(v => isShort(v))
    .sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));

  // Max 1 short per channel — fill remaining slots with longforms
  const shortSlot = shorts.slice(0, 1);
  const longformSlots = longform.slice(0, VIDEOS_PER_CHANNEL - shortSlot.length);
  return [...longformSlots, ...shortSlot];
}

export async function fetchAllVideos() {
  const channelsPath = path.join(__dirname, 'channels.json');
  let channels;

  try {
    channels = JSON.parse(await fs.readFile(channelsPath, 'utf8'));
  } catch {
    throw new Error('channels.json not found — run "node setup.js" first');
  }

  const active = channels.filter(c => c.channelId);
  console.log(`Fetching RSS for ${active.length} channels...`);

  const channelResults = [];
  const errors = [];

  for (const ch of active) {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`;
    try {
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const videos = parseFeed(xml, ch);
      channelResults.push({ name: ch.name, handle: ch.handle, category: ch.category, videos });
      console.log(`  ✓  ${ch.name} (${videos.length} videos)`);
    } catch (err) {
      errors.push({ channel: ch.name, error: err.message });
      console.error(`  ✗  ${ch.name}: ${err.message}`);
    }
    // Small delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  const totalVideos = channelResults.reduce((sum, ch) => sum + ch.videos.length, 0);
  console.log(`Fetched ${totalVideos} videos total across ${channelResults.length} channels.`);
  return { channels: channelResults, errors, fetchedAt: new Date().toISOString() };
}
