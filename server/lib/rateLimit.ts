import type express from "express";

type RateLimitKey = string;
type RateLimitEntry = { windowStartMs: number; count: number };

const rateLimit = new Map<RateLimitKey, RateLimitEntry>();
const RATE_LIMIT_MAX_ENTRIES = 5_000;

export function getClientIp(req: express.Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) return xf.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function cleanupRateLimit(maxAgeMs: number) {
  const now = Date.now();
  for (const [key, entry] of rateLimit.entries()) {
    if (now - entry.windowStartMs > maxAgeMs) {
      rateLimit.delete(key);
    }
  }
  // Hard cap as a last resort
  if (rateLimit.size > RATE_LIMIT_MAX_ENTRIES) {
    const toDelete = rateLimit.size - RATE_LIMIT_MAX_ENTRIES;
    let i = 0;
    for (const key of rateLimit.keys()) {
      rateLimit.delete(key);
      i++;
      if (i >= toDelete) break;
    }
  }
}

export function checkRateLimitOrRespond(
  req: express.Request,
  res: express.Response,
  opts: { key: RateLimitKey; limit: number; windowMs: number; cleanupMaxAgeMs?: number },
): boolean {
  if (opts.cleanupMaxAgeMs) cleanupRateLimit(opts.cleanupMaxAgeMs);

  const now = Date.now();
  const existing = rateLimit.get(opts.key);
  const windowStartMs = existing?.windowStartMs ?? now;
  const inSameWindow = now - windowStartMs < opts.windowMs;
  const next: RateLimitEntry = inSameWindow
    ? { windowStartMs, count: (existing?.count ?? 0) + 1 }
    : { windowStartMs: now, count: 1 };

  rateLimit.set(opts.key, next);

  if (next.count > opts.limit) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((opts.windowMs - (now - next.windowStartMs)) / 1000),
    );
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: "Rate limit exceeded" });
    return false;
  }
  return true;
}

