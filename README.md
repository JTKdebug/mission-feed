# Mission Feed

A self-hosted YouTube dashboard that shows your curated channels — no algorithm, no ads, no feed poisoning. Built for founders and creators who want mission-aligned content.

![MIT License](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

---

## Quickstart (Self-host)

1. **Clone the repo**
   ```bash
   git clone https://github.com/JTKdebug/mission-feed
   cd mission-feed
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Open your browser** → `http://localhost:3000`

5. **Complete the setup wizard** — enter your name, mission, and goals. Choose your starter channels. You're done.

No API keys. No database. No accounts. Just YouTube RSS feeds.

---

## One-Click Deploy (Railway)

Don't want to run a terminal? Deploy to Railway in one click:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/JTKdebug/mission-feed)

Railway provisions a server, runs the setup wizard, and gives you a public URL. Free tier works fine.

**To make your setup persist across deploys** (recommended), add a Railway volume:
1. In your Railway service → **Volumes** → Add Volume → mount at `/data`
2. Add an environment variable: `DATA_DIR=/data`

Without this, your mission and channel selections reset if the container restarts.

---

## Adding Your Own Channels

1. Open `channels.json`
2. Add a new entry:
   ```json
   {
     "name": "Display Name",
     "handle": "YouTubeHandle",
     "category": "top",
     "channelId": null,
     "tags": ["keyword1", "keyword2"]
   }
   ```
3. Run `node setup.js` to resolve the channel ID
4. Restart the server or click ↻ Refresh in the UI

Valid categories: `top`, `business`, `podcast`, `car`

---

## How It Works

- Fetches YouTube RSS feeds (no API key required, no quota limits)
- Caches results for 24 hours, auto-refreshes in the background
- Filters out YouTube Shorts (heuristic-based)
- Stores your mission and channel list as local JSON files
- No database, no auth, no external dependencies beyond npm packages

---

## Built With

- [Node.js](https://nodejs.org) + [Express](https://expressjs.com)
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) for RSS parsing
- Vanilla JS, CSS custom properties
- Inter font via Google Fonts

---

Built by [Visable AI](https://visable.ai) — AI automation for founders.
