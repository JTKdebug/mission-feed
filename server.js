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
import { resolveChannelId } from './setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const CACHE_PATH    = path.join(DATA_DIR, 'cache.json');
const MISSION_PATH  = path.join(DATA_DIR, 'mission.json');
const CHANNELS_PATH = path.join(DATA_DIR, 'channels.json');
const CHANNELS_DEFAULT = path.join(__dirname, 'channels.json');
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

async function loadChannels() {
  for (const p of [CHANNELS_PATH, CHANNELS_DEFAULT]) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch {}
  }
  return [];
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
app.use(express.json());

app.get('/', (req, res) => {
  if (!missionState) return res.redirect('/setup');
  const channelFilter = req.query.channel || 'all';
  const html = buildHTML(cache, channelFilter);
  res.send(html);
});

app.get('/refresh', async (req, res) => {
  await refreshCache();
  res.redirect('/');
});

app.get('/setup', async (req, res) => {
  const channels = await loadChannels();
  res.send(buildSetupHTML(channels));
});

app.post('/save-setup', async (req, res) => {
  const { name, mission, goal, channels } = req.body;

  const newMission = { name, mission, goal, createdAt: new Date().toISOString() };
  await fs.writeFile(MISSION_PATH, JSON.stringify(newMission, null, 2));
  missionState = newMission;

  const resolved = await Promise.all(channels.map(async ch => {
    if (ch.channelId) return ch;
    try {
      const id = await resolveChannelId(ch.handle);
      return { ...ch, channelId: id };
    } catch {
      return { ...ch, channelId: null, error: `Could not resolve @${ch.handle}` };
    }
  }));

  await fs.writeFile(CHANNELS_PATH, JSON.stringify(resolved, null, 2));

  refreshCache();
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

function buildSetupHTML(channels) {
  const STOP_WORDS = "the,and,to,a,i,my,of,in,for,on,with,is,are,we,that,this,an,it,be,at,by,or,from,but,not,as,up,so,if,do,go,get,you,your,our,their,have,has,been,was,will,can,all,one,two,how,why,what,when,who,more,into";

  const CATEGORY_TAGS = {
    'Business':              ['business','revenue','startup','saas','agency','scale','case-study'],
    'Mindset & Mental Game': ['mindset','psychology','leadership','success','performance','hustle','purpose','relationships'],
    'Finance & Investing':   ['finance','investing','money','wealth','investment'],
    'Entrepreneurship':      ['entrepreneurship','entrepreneur','startup','side-hustle','hustle'],
    'Tech':                  ['ai','automation','tools','software','productivity','make','claude'],
    'Sales & Marketing':     ['sales','marketing','smma','offer'],
    'Health & Fitness':      ['health','gym','fitness'],
  };

  const channelsJson = JSON.stringify(channels).replace(/<\/script>/gi, '<\\/script>');
  const categoryTagsJson = JSON.stringify(CATEGORY_TAGS).replace(/<\/script>/gi, '<\\/script>');

  const categoryCards = Object.keys(CATEGORY_TAGS).map(name => `
    <div class="category-card" data-category="${escapeHtml(name)}" onclick="toggleCategory(this)">
      <span>${escapeHtml(name)}</span>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mission Feed — Setup</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/public/style.css">
  <link rel="stylesheet" href="/public/setup.css">
</head>
<body>
  <div class="setup-container">

    <div class="setup-progress-track">
      <div class="setup-progress-fill" id="progressFill" style="width:20%"></div>
    </div>
    <div class="step-dots">
      <div class="step-dot active" id="dot1"></div>
      <div class="step-dot" id="dot2"></div>
      <div class="step-dot" id="dot3"></div>
      <div class="step-dot" id="dot4"></div>
      <div class="step-dot" id="dot5"></div>
    </div>

    <!-- Step 1: Welcome -->
    <div class="setup-step active" id="step1">
      <div class="setup-logo">Mission Feed</div>
      <p class="setup-tagline">Your curated feed of YouTube content that actually moves you forward. No algorithm. No noise. Just the creators that matter to your mission.</p>
      <button class="btn-primary" onclick="goToStep(2)">Get Started →</button>
    </div>

    <!-- Step 2: Mission & Goal -->
    <div class="setup-step" id="step2">
      <h2>What are you on a mission to accomplish?</h2>
      <div class="form-group">
        <label>Your name</label>
        <input type="text" id="nameInput" placeholder="e.g. Justin" autocomplete="off">
      </div>
      <div class="form-group">
        <label>What mission are you currently on?</label>
        <textarea id="missionInput" rows="3" placeholder="e.g. Build an AI automation agency to $1M ARR"></textarea>
      </div>
      <div class="form-group">
        <label>What's your main goal right now?</label>
        <textarea id="goalInput" rows="3" placeholder="e.g. Launch my LinkedIn content pipeline this month"></textarea>
      </div>
      <button class="btn-primary" onclick="goToStep(3)">Next →</button>
    </div>

    <!-- Step 3: Categories -->
    <div class="setup-step" id="step3">
      <h2>What topics matter to your mission?</h2>
      <div class="category-grid">${categoryCards}</div>
      <button class="btn-primary" onclick="goToStep(4)">Next →</button>
    </div>

    <!-- Step 4: Channels -->
    <div class="setup-step" id="step4">
      <h2>Choose your channels</h2>
      <div class="channels-list" id="channelsList"></div>
      <div class="add-channel-row">
        <input type="text" id="customHandle" placeholder="@handle or youtube.com/...">
        <button class="btn-add" onclick="addCustomChannel()">+ Add</button>
      </div>
      <button class="btn-primary" onclick="goToStep(5)">Next →</button>
    </div>

    <!-- Step 5: Confirm & Launch -->
    <div class="setup-step" id="step5">
      <h2>Your feed is ready to launch</h2>
      <div class="summary-card" id="summaryCard"></div>
      <button class="btn-primary" onclick="submitSetup()">Launch My Feed →</button>
    </div>

  </div>

  <script>
    const ALL_CHANNELS = ${channelsJson};
    const CATEGORY_TAGS = ${categoryTagsJson};
    const STOP_WORDS = new Set("${STOP_WORDS}".split(','));

    let currentStep = 1;
    let selectedCategories = new Set();
    let channelList = [];
    let dragSrc = null;

    // ── Keyword matcher ──────────────────────────────────────────────────────
    function matchChannels(missionText, goalText, channels) {
      const text = (missionText + ' ' + goalText).toLowerCase();
      const tokens = new Set(text.split(/\\W+/).filter(w => w.length > 2 && !STOP_WORDS.has(w)));
      const scored = channels.map(ch => {
        const score = (ch.tags || []).filter(t => tokens.has(t)).length;
        return { ...ch, score, suggested: false };
      });
      scored.sort((a, b) => b.score - a.score);
      let n = 0;
      for (const ch of scored) { if (ch.score > 0 && n < 2) { ch.suggested = true; n++; } }
      return scored;
    }

    // ── Step navigation ──────────────────────────────────────────────────────
    function goToStep(n) {
      document.querySelectorAll('.setup-step').forEach(el => el.classList.remove('active'));
      document.getElementById('step' + n).classList.add('active');
      document.querySelectorAll('.step-dot').forEach((dot, i) => {
        dot.classList.toggle('done', i < n - 1);
        dot.classList.toggle('active', i === n - 1);
      });
      document.getElementById('progressFill').style.width = (n * 20) + '%';

      if (n === 4) populateChannels();
      if (n === 5) populateSummary();
      currentStep = n;
    }

    // ── Category toggle ──────────────────────────────────────────────────────
    function toggleCategory(el) {
      const cat = el.dataset.category;
      if (selectedCategories.has(cat)) {
        selectedCategories.delete(cat);
        el.classList.remove('selected');
      } else {
        selectedCategories.add(cat);
        el.classList.add('selected');
      }
    }

    // ── Channel list ─────────────────────────────────────────────────────────
    function populateChannels() {
      const missionText = document.getElementById('missionInput').value;
      const goalText    = document.getElementById('goalInput').value;

      const unionTags = new Set(
        [...selectedCategories].flatMap(cat => CATEGORY_TAGS[cat] || [])
      );

      let filtered = ALL_CHANNELS;
      if (unionTags.size > 0) {
        filtered = ALL_CHANNELS.filter(ch =>
          (ch.tags || []).some(t => unionTags.has(t))
        );
      }

      const scored = matchChannels(missionText, goalText, filtered);
      channelList = scored.map(ch => ({ ...ch, included: true }));
      renderChannelList();
    }

    function renderChannelList() {
      const list = document.getElementById('channelsList');
      list.innerHTML = channelList.map((ch, idx) => \`
        <div class="channel-card \${ch.included ? '' : 'excluded'}"
             draggable="true"
             data-idx="\${idx}"
             ondragstart="onDragStart(event,\${idx})"
             ondragover="onDragOver(event)"
             ondrop="onDrop(event,\${idx})"
             ondragleave="onDragLeave(event)"
             ondragend="onDragEnd(event)">
          <span class="drag-handle">⠿</span>
          <span class="channel-card-name">\${escapeStr(ch.name)}</span>
          \${ch.suggested ? '<span class="suggested-badge">✦ Suggested</span>' : ''}
          <button class="channel-card-toggle \${ch.included ? '' : 'excluded'}"
                  onclick="toggleChannel(\${idx})">
            \${ch.included ? 'Remove' : 'Add back'}
          </button>
        </div>\`).join('');
    }

    function toggleChannel(idx) {
      channelList[idx].included = !channelList[idx].included;
      renderChannelList();
    }

    function addCustomChannel() {
      const input = document.getElementById('customHandle');
      let raw = input.value.trim();
      if (!raw) return;
      let handle = raw.replace(/^@/, '').replace(/.*youtube\\.com\\/@?/, '').replace(/\\/.*/, '');
      if (!handle) return;
      channelList.push({ name: handle, handle, channelId: null, category: 'top', tags: [], included: true });
      renderChannelList();
      input.value = '';
    }

    // ── Drag and drop ────────────────────────────────────────────────────────
    function onDragStart(e, idx) {
      dragSrc = idx;
      e.currentTarget.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }

    function onDragOver(e) {
      e.preventDefault();
      e.currentTarget.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'move';
    }

    function onDragLeave(e) {
      e.currentTarget.classList.remove('drag-over');
    }

    function onDrop(e, targetIdx) {
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      if (dragSrc === null || dragSrc === targetIdx) return;
      const moved = channelList.splice(dragSrc, 1)[0];
      channelList.splice(targetIdx, 0, moved);
      dragSrc = null;
      renderChannelList();
    }

    function onDragEnd(e) {
      e.currentTarget.classList.remove('dragging');
      document.querySelectorAll('.channel-card').forEach(el => el.classList.remove('drag-over'));
      dragSrc = null;
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    function populateSummary() {
      const name    = document.getElementById('nameInput').value.trim() || '(no name)';
      const mission = document.getElementById('missionInput').value.trim() || '(none)';
      const goal    = document.getElementById('goalInput').value.trim() || '(none)';
      const count   = channelList.filter(c => c.included).length;

      document.getElementById('summaryCard').innerHTML = \`
        <div class="summary-row"><span class="summary-label">Name</span><span class="summary-value">\${escapeStr(name)}</span></div>
        <div class="summary-row"><span class="summary-label">Mission</span><span class="summary-value">\${escapeStr(mission)}</span></div>
        <div class="summary-row"><span class="summary-label">Goal</span><span class="summary-value">\${escapeStr(goal)}</span></div>
        <div class="summary-row"><span class="summary-label">Channels</span><span class="summary-value">\${count} selected</span></div>\`;
    }

    // ── Submit ───────────────────────────────────────────────────────────────
    async function submitSetup() {
      const payload = {
        name:     document.getElementById('nameInput').value.trim(),
        mission:  document.getElementById('missionInput').value.trim(),
        goal:     document.getElementById('goalInput').value.trim(),
        channels: channelList.filter(c => c.included).map(c => ({
          name:      c.name,
          handle:    c.handle,
          channelId: c.channelId || null,
          category:  c.category || 'top',
          tags:      c.tags || [],
        })),
      };

      const res = await fetch('/save-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      window.location.href = res.redirected ? res.url : '/';
    }

    // ── Utility ──────────────────────────────────────────────────────────────
    function escapeStr(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
  </script>
</body>
</html>`;
}

// ─── Startup ──────────────────────────────────────────────────────────────────

await fs.mkdir(DATA_DIR, { recursive: true });
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
