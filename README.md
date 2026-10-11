# Maha Cartoon TV — Full Website

Standalone project; no Higgsfield dependency. Requires Node.js 20+.

## Run locally
1. Extract the ZIP.
2. Copy `.env.example` to `.env`.
3. Run `npm install`, then `npm start`.
4. Open `http://localhost:3000`.

The upstream stream URL is configured in `.env` on the server, not in browser files.

## Deploy without a website builder
Create a Node Web Service on your preferred host (Render works):
- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `UPSTREAM_HLS_URL=https://tv-channel-server.onrender.com/live/stream.m3u8`
- Optional: set `PUBLIC_ORIGIN` to the exact deployed site origin.

Check `/api/health` after deploying.

## Live viewers counter (optional setup)

The site can show a real-time online-browser count across devices using Upstash Redis (shared storage; not an in-memory counter). Create a free Redis database at https://console.upstash.com, then add these environment variables in Vercel Project Settings → Environment Variables:

- `UPSTASH_REDIS_REST_URL`: the database's HTTPS REST URL
- `UPSTASH_REDIS_REST_TOKEN`: the database's REST token (keep it server-side; never add it to frontend files)

Add both to Production and redeploy. The counter heartbeats every 25 seconds and expires inactive visitors after 75 seconds. It counts browser identities, not verified individual people; shared browsers may count as one viewer. Until both variables are configured, the UI displays a dash rather than a fabricated number.

## Includes
- Premium dark red/pink responsive UI
- HLS.js/native HLS player, playback/mute/fullscreen/retry controls
- Backend HLS proxy with manifest URI rewriting
- Fixed upstream host and directory validation, rate limiting, Helmet security headers and origin checks

## Important
The browser uses `/api/live` instead of directly referencing the upstream URL. This helps conceal the upstream URL, but it is not DRM: viewers can still see the local proxy endpoint or record playback. Stronger access control requires authentication and origin-side restrictions.

The provided upstream server was reported as HTTP 503 / Service Suspended when last checked. The site can run, but video playback needs that stream server to be available.
