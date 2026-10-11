import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const app = express();
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const upstreamValue = process.env.UPSTREAM_HLS_URL;
const publicOrigin = (process.env.PUBLIC_ORIGIN || "").trim();
const proxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || "1", 10);

if (!upstreamValue) {
  console.error("Set UPSTREAM_HLS_URL in .env or your hosting provider's environment settings.");
  process.exit(1);
}
let upstreamUrl, upstreamBase;
try {
  upstreamUrl = new URL(upstreamValue);
  if (upstreamUrl.protocol !== "https:") throw new Error("HTTPS required");
  upstreamBase = new URL(".", upstreamUrl);
  if (!upstreamBase.pathname.endsWith("/")) upstreamBase.pathname += "/";
} catch (e) {
  console.error("Invalid UPSTREAM_HLS_URL:", e.message);
  process.exit(1);
}

if (Number.isInteger(proxyHops) && proxyHops > 0) app.set("trust proxy", proxyHops);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    imgSrc: ["'self'", "data:"], mediaSrc: ["'self'", "blob:"],
    connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"]
  }},
  crossOriginResourcePolicy: { policy: "same-origin" }
}));
app.use(morgan("tiny"));
app.use(rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-7", legacyHeaders: false }));

function originAllowed(req) {
  const origin = req.get("origin");
  if (!origin) return true;
  return origin === (publicOrigin || `${req.protocol}://${req.get("host")}`);
}
function safeResolve(raw, base = upstreamBase) {
  if (typeof raw !== "string" || raw.length > 2048 || raw.startsWith("//") ||
      raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return null;
  let target;
  try { target = new URL(raw, base); } catch { return null; }
  if (target.protocol !== "https:" || target.hostname !== upstreamBase.hostname ||
      target.port || target.username || target.password ||
      !target.pathname.startsWith(upstreamBase.pathname)) return null;
  return target;
}
function localUrl(req, target) {
  const relative = target.pathname.slice(upstreamBase.pathname.length) + target.search;
  return `${req.protocol}://${req.get("host")}/api/live?path=${encodeURIComponent(relative)}`;
}
function rewriteManifest(text, req, manifestUrl) {
  return text.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        const target = safeResolve(uri, manifestUrl);
        return target ? `URI="${localUrl(req, target)}"` : 'URI=""';
      });
    }
    const target = safeResolve(t, manifestUrl);
    return target ? localUrl(req, target) : "";
  }).join("\n");
}

app.get("/api/health", (_req, res) => res.set("Cache-Control", "no-store").json({ ok: true }));
app.post("/api/presence", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!originAllowed(req)) return res.status(403).json({ configured: false, error: "Forbidden" });
  const redisUrl = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const redisToken = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!redisUrl || !redisToken) return res.status(503).json({ configured: false, error: "Presence storage is not configured." });
  const visitorId = String(req.query.id || "");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(visitorId)) return res.status(400).json({ configured: true, error: "Invalid visitor id." });
  const now = Date.now();
  const cutoff = now - 75_000;
  async function redis(command) {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("Presence storage request failed.");
    const payload = await response.json();
    if (payload.error) throw new Error("Presence storage command failed.");
    return payload.result;
  }
  try {
    await redis(["ZREMRANGEBYSCORE", "maha:live-presence", "-inf", cutoff]);
    await redis(["ZADD", "maha:live-presence", now, visitorId]);
    const count = Number(await redis(["ZCARD", "maha:live-presence"]));
    return res.json({ configured: true, count: Number.isFinite(count) ? count : 0, updatedAt: now });
  } catch (error) {
    console.error("Live viewer counter error:", error.message);
    return res.status(503).json({ configured: false, error: "Live viewer count temporarily unavailable." });
  }
});
app.all("/api/live", async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) return res.status(405).set("Allow", "GET, HEAD").end();
  if (!originAllowed(req)) return res.status(403).send("Forbidden");
  const target = req.query.path === undefined ? upstreamUrl : safeResolve(String(req.query.path));
  if (!target) return res.status(400).set("Cache-Control", "no-store").send("Invalid stream path");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(target, {
      method: req.method, redirect: "manual", signal: controller.signal,
      headers: { Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, video/mp2t, video/mp4, application/octet-stream, */*", "User-Agent": "MahaCartoonTV/1.0" }
    });
    if (!upstream.ok) return res.status(upstream.status).set({
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
    }).send(upstream.status === 503 ? "Live stream server is suspended or unavailable." : "Live stream unavailable.");

    const type = upstream.headers.get("content-type") || "application/octet-stream";
    const playlist = target.pathname.toLowerCase().endsWith(".m3u8") || type.toLowerCase().includes("mpegurl");
    res.set({
      "Content-Type": playlist ? "application/vnd.apple.mpegurl; charset=utf-8" : type,
      "Cache-Control": playlist ? "no-store, max-age=0" : "public, max-age=3",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin"
    });
    if (req.method === "HEAD") return res.status(200).end();
    if (playlist) return res.status(200).send(rewriteManifest(await upstream.text(), req, target));
    if (!upstream.body) return res.status(502).send("Empty stream response.");
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(e.name === "AbortError" ? 504 : 502).set("Cache-Control", "no-store").send("Could not reach the live stream server.");
    else res.destroy(e);
  } finally { clearTimeout(timeout); }
});
app.use(express.static(path.join(rootDir, "public"), { extensions: ["html"], maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get("*", (_req, res) => res.sendFile(path.join(rootDir, "public", "index.html")));
app.listen(port, "0.0.0.0", () => console.log(`Maha Cartoon TV listening on ${port}`));
