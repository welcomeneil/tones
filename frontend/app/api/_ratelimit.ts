// Per-IP rate limiter for the proxy endpoints.
//
// In-memory token bucket per (ip, route). This is *approximate* on serverless:
// each warm function instance has its own buckets, so a determined attacker
// can bypass by forcing cold starts across regions. It is still a meaningful
// floor against accidental loops and casual abuse, and it costs zero infra.
//
// To upgrade to a durable cross-instance limiter, replace the body of
// `rateLimit` with an Upstash call:
//
//   import { Ratelimit } from "@upstash/ratelimit";
//   import { Redis } from "@upstash/redis";
//   const limiter = new Ratelimit({
//     redis: Redis.fromEnv(),
//     limiter: Ratelimit.slidingWindow(LIMITS[key].max, `${LIMITS[key].windowMs} ms`),
//   });
//   const { success } = await limiter.limit(`${key}:${ip}`);
//   return { allowed: success };

type RouteKey = "ingest" | "analyze" | "zone";

const LIMITS: Record<RouteKey, { max: number; windowMs: number }> = {
  ingest: { max: 30, windowMs: 60_000 },
  analyze: { max: 60, windowMs: 60_000 },
  zone: { max: 240, windowMs: 60_000 },
};

const MAX_BUCKETS = 5_000;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function evictIfNeeded(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
  if (buckets.size >= MAX_BUCKETS) {
    // Hard cap: drop the oldest-resetting buckets so a flood of unique IPs
    // can't unbound the map.
    const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [k] of sorted.slice(0, Math.floor(MAX_BUCKETS / 4))) buckets.delete(k);
  }
}

export type RateDecision = { allowed: boolean; remaining: number; resetAt: number };

export async function rateLimit(ip: string, key: RouteKey): Promise<RateDecision> {
  const { max, windowMs } = LIMITS[key];
  const now = Date.now();
  const bucketKey = `${key}:${ip}`;

  evictIfNeeded(now);

  let bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(bucketKey, bucket);
  }

  if (bucket.count >= max) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { allowed: true, remaining: max - bucket.count, resetAt: bucket.resetAt };
}
