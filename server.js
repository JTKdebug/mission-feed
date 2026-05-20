/**
 * server.js — Express server for the YouTube Curator dashboard
 * - Serves the dashboard at http://localhost:3000
 * - Loads cache on startup; refreshes if stale (> 24h)
 * - Auto-refreshes every 24h via setInterval
 * - Manual refresh via GET /refresh
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAllVideos } from './fetcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const CACHE_PATH    = path.join(__dirname, 'cache.json');
const MISSION_PATH  = path.join(__dirname, 'mission.json');
const CHANNELS_PATH = path.join(__dirname, 'channels.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let cache = { channels: [], errors: [], fetchedAt: null };
let missionState = null;

async function loadMission() {
  try {
    missionState = JSON.parse(await fs.readFile(MISSION_PATH, 'utf8'));
  } catch {
    missionState = null;
  }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    cache = JSON.parse(raw);
    const totalVideos = cache.channels?.reduce((sum, ch) => sum + ch.videos.length, 0) ?? 0;
    console.log(`Cache loaded (${totalVideos} videos, fetched ${cache.fetchedAt})`);
  } catch {
    cache = { channels: [], errors: [], fetchedAt: null };
  }
}

async function saveCache(data) {
  cache = data;
  await fs.writeFile(CACHE_PATH, JSON.stringify(data, null, 2));
}

function isCacheStale() {
  if (!cache.fetchedAt) return true;
  if (!cache.channels) return true; // old format — force refresh
  return Date.now() - new Date(cache.fetchedAt).getTime() > CACHE_TTL_MS;
}

async function refreshCache() {
  console.log('Refreshing video cache...');
  try {
    const data = await fetchAllVideos();
    await saveCache(data);
    const totalVideos = data.channels.reduce((sum, ch) => sum + ch.videos.length, 0);
    console.log(`Cache updated: ${totalVideos} videos at ${data.fetchedAt}`);
  } catch (err) {
    console.error('Cache refresh failed:', err.message);
  }
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const channelFilter = req.query.channel || 'all';
  const html = buildHTML(cache, channelFilter);
  res.send(html);
});

app.get('/refresh', async (req, res) => {
  await refreshCache();
  res.redirect('/');
});

// ─── HTML builder ─────────────────────────────────────────────────────────────

function timeAgo(isoDate) {
  if (!isoDate) return '';
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

const BADGE_CLASS = { top: '', business: 'badge-business', podcast: 'badge-podcast', car: 'badge-car' };
const BADGE_LABEL = { top: 'Top', business: 'Business', podcast: 'Podcast', car: 'Car' };

function buildChannelSection(ch) {
  const badgeClass = BADGE_CLASS[ch.category] ?? '';
  const badgeLabel = BADGE_LABEL[ch.category] ?? ch.category;

  const cards = ch.videos.map(v => `
      <a class="card" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">
        <div class="thumb-wrap">
          <img class="thumb" src="${escapeHtml(v.thumbnail || '')}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="play-icon">▶</div>
        </div>
        <div class="card-body">
          <p class="title">${escapeHtml(v.title)}</p>
          <span class="date">${timeAgo(v.published)}</span>
        </div>
      </a>`).join('');

  return `
    <section class="channel-section">
      <h2 class="channel-header">
        <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
        ${escapeHtml(ch.name)}
      </h2>
      <div class="channel-grid">
        ${cards || '<p class="empty">No videos available.</p>'}
      </div>
    </section>`;
}

function buildHTML(data, activeFilter) {
  const { channels = [], fetchedAt } = data;

  // Build filter chips from all channels
  const allChannelMeta = channels.map(c => ({ name: c.name, handle: c.handle }));

  // Apply channel filter
  const visibleChannels = activeFilter === 'all'
    ? channels
    : channels.filter(c => c.handle === activeFilter);

  // Split into four groups — rendered in this order
  const topChannels     = visibleChannels.filter(c => c.category === 'top');
  const businessChannels = visibleChannels.filter(c => c.category === 'business');
  const podcastChannels  = visibleChannels.filter(c => c.category === 'podcast');
  const carChannels      = visibleChannels.filter(c => c.category === 'car');
  const hasAbove = (cats) => cats.some(g => g.length > 0);

  const updatedLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Never';

  const topSections      = topChannels.map(buildChannelSection).join('');
  const businessSections = businessChannels.map(buildChannelSection).join('');
  const podcastSections  = podcastChannels.map(buildChannelSection).join('');
  const carSections      = carChannels.map(buildChannelSection).join('');

  const showingAll = activeFilter === 'all';
  const podcastDivider = (showingAll && podcastChannels.length > 0 && hasAbove([topChannels, businessChannels]))
    ? `<div class="section-divider"><span>Podcasts</span></div>` : '';
  const carDivider = (showingAll && carChannels.length > 0 && hasAbove([topChannels, businessChannels, podcastChannels]))
    ? `<div class="section-divider"><span>Car Content</span></div>` : '';

  const totalVideos = visibleChannels.reduce((sum, ch) => sum + ch.videos.length, 0);

  const chips = allChannelMeta.map(c => `
    <a class="chip ${activeFilter === c.handle ? 'chip-active' : ''}" href="/?channel=${encodeURIComponent(c.handle)}">
      ${escapeHtml(c.name)}
    </a>`).join('');

  const mainContent = totalVideos === 0
    ? '<p class="empty">No videos found. Try refreshing or check channels.json.</p>'
    : `${topSections}${businessSections}${podcastDivider}${podcastSections}${carDivider}${carSections}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <title>Mission Feed</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <header>
    <div class="header-left">
      <h1>Mission Feed</h1>
      <span class="updated">Updated ${updatedLabel}</span>
    </div>
    <div class="header-right">
      <a class="btn-refresh" href="/refresh">↻ Refresh</a>
    </div>
  </header>

  ${missionState ? `
  <div class="mission-banner">
    <strong>${escapeHtml(missionState.name)}'s Feed</strong>
    &nbsp;·&nbsp; Mission: ${escapeHtml(missionState.mission)}
    &nbsp;·&nbsp; Goal: ${escapeHtml(missionState.goal)}
  </div>` : ''}

  <div class="filters">
    <a class="chip ${activeFilter === 'all' ? 'chip-active' : ''}" href="/">All</a>
    ${chips}
  </div>

  <main>
    ${mainContent}
  </main>

  <footer>
    ${data.errors?.length ? `<p class="errors">${data.errors.length} channel(s) failed to load last refresh.</p>` : ''}
    <p class="footer-note">${totalVideos} video${totalVideos !== 1 ? 's' : ''} shown</p>
  </footer>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Startup ──────────────────────────────────────────────────────────────────

await loadMission();
await loadCache();

if (isCacheStale()) {
  console.log('Cache is stale or missing — fetching now...');
  await refreshCache();
} else {
  console.log('Cache is fresh, skipping initial fetch.');
}

// Daily auto-refresh
setInterval(refreshCache, CACHE_TTL_MS);
console.log('Daily auto-refresh scheduled.');

app.listen(PORT, () => {
  console.log(`\nMission Feed running at http://localhost:${PORT}\n`);
});
