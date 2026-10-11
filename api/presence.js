const REDIS_KEY = "maha:live-presence";
const PRESENCE_TTL_MS = 75_000;

function json(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { configured: false, error: "Method not allowed." });
  }

  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== String(host).split(",")[0].trim()) {
        return json(res, 403, { configured: false, error: "Forbidden." });
      }
    } catch {
      return json(res, 403, { configured: false, error: "Forbidden." });
    }
  }

  const redisUrl = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const redisToken = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!redisUrl || !redisToken) {
    return json(res, 503, { configured: false, error: "Presence storage is not configured." });
  }

  const visitorId = String(req.query?.id || "");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(visitorId)) {
    return json(res, 400, { configured: true, error: "Invalid visitor id." });
  }

  async function redis(command) {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("Redis request failed.");
    const payload = await response.json();
    if (payload.error) throw new Error("Redis command failed.");
    return payload.result;
  }

  try {
    const now = Date.now();
    await redis(["ZREMRANGEBYSCORE", REDIS_KEY, "-inf", now - PRESENCE_TTL_MS]);
    await redis(["ZADD", REDIS_KEY, now, visitorId]);
    const count = Number(await redis(["ZCARD", REDIS_KEY]));
    return json(res, 200, {
      configured: true,
      count: Number.isFinite(count) ? count : 0,
      updatedAt: now
    });
  } catch (error) {
    console.error("Live viewer counter error:", error.message);
    return json(res, 503, { configured: false, error: "Live viewer count temporarily unavailable." });
  }
}
