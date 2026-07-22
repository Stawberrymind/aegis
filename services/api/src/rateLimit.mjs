import { isIP } from "node:net";

export function createRateLimiter({ windowMs = 60_000, maxRequests = 30, maxBuckets = 10_000 } = {}) {
  const buckets = new Map();
  let lastSweepAt = 0;

  return {
    check(key = "anonymous", now = Date.now()) {
      if (now - lastSweepAt >= windowMs || buckets.size >= maxBuckets) {
        for (const [bucketKey, candidate] of buckets) {
          if (now - candidate.startedAt >= windowMs) buckets.delete(bucketKey);
        }
        lastSweepAt = now;
      }

      const lookupKey = !buckets.has(key) && buckets.size >= maxBuckets ? "rate-limit-overflow" : key;
      const bucket = buckets.get(lookupKey);
      if (!bucket || now - bucket.startedAt >= windowMs) {
        if (!bucket && buckets.size >= maxBuckets) {
          const oldestKey = buckets.keys().next().value;
          if (oldestKey !== undefined) buckets.delete(oldestKey);
        }
        buckets.set(lookupKey, { startedAt: now, count: 1 });
        return { allowed: true, remaining: Math.max(0, maxRequests - 1), retry_after_seconds: 0 };
      }

      if (bucket.count >= maxRequests) {
        const retryAfterMs = Math.max(0, windowMs - (now - bucket.startedAt));
        return {
          allowed: false,
          remaining: 0,
          retry_after_seconds: Math.ceil(retryAfterMs / 1000)
        };
      }

      bucket.count += 1;
      return { allowed: true, remaining: Math.max(0, maxRequests - bucket.count), retry_after_seconds: 0 };
    },
    size() {
      return buckets.size;
    },
    clear() {
      buckets.clear();
    }
  };
}

export function requestKey(req, trustedProxies = parseTrustedProxies()) {
  const remoteAddress = normalizeIp(req.socket.remoteAddress) || "anonymous";
  if (!trustedProxies.has(remoteAddress)) return remoteAddress;

  const forwarded = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((value) => normalizeIp(value))
    .find(Boolean);
  return forwarded || remoteAddress;
}

export function parseTrustedProxies(value = process.env.AEGIS_TRUSTED_PROXY_ADDRESSES) {
  return new Set(String(value ?? "")
    .split(",")
    .map((address) => normalizeIp(address))
    .filter(Boolean));
}

function normalizeIp(value) {
  const address = String(value ?? "").trim().replace(/^::ffff:/, "");
  return isIP(address) ? address : null;
}
