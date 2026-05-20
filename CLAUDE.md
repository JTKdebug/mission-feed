# Mission Feed

This is Mission Feed — a self-hosted YouTube dashboard built with Node.js + Express. It pulls RSS feeds for curated channels and shows them as a card dashboard. No YouTube API key required.

## Run it

```bash
npm install
npm start
```

Open `http://localhost:3000`. On first run, you'll be redirected to `/setup` to enter your mission and choose channels.

## Key files

| File | What it does |
|---|---|
| `server.js` | Express app — routes, cache, dashboard HTML, setup wizard |
| `fetcher.js` | Fetches RSS feeds for all channels, filters Shorts |
| `setup.js` | Resolves YouTube @handles → channel IDs |
| `channels.json` | Source of truth for channel list |
| `mission.json` | Created at setup — stores your name, mission, goal |
| `cache.json` | Auto-generated — cached RSS data |
| `public/style.css` | Dashboard styles (Visable AI dark theme) |
| `public/setup.css` | Onboarding wizard styles |
| `public/onboarding.js` | Keyword matching for channel suggestions |

## Adding a channel

1. Edit `channels.json` — add an entry with `"channelId": null`
2. Run `node setup.js` — resolves only null entries
3. Restart server or click ↻ Refresh

## Common commands

```bash
npm start          # Start the server
node setup.js      # Resolve new channel IDs
rm cache.json      # Force a full RSS refresh on next start
PORT=8080 npm start  # Run on a different port (Railway sets this automatically)
```

## Re-running setup

Delete `mission.json` and restart — the server will redirect to `/setup` automatically.
