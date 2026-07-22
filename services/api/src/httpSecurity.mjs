const LOOPBACK_HOST = "127.0.0.1";

export function resolveBindHost(value = process.env.AEGIS_API_HOST) {
  return String(value ?? "").trim() || LOOPBACK_HOST;
}

export function parseAllowedOrigins(value = process.env.AEGIS_ALLOWED_ORIGINS) {
  return new Set(String(value ?? "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean));
}

export function evaluateCorsRequest(req, allowedOrigins = parseAllowedOrigins()) {
  const originHeader = req.headers.origin;
  if (!originHeader) return { allowed: true, origin: null };
  const requestOrigin = normalizeOrigin(originHeader);
  if (!requestOrigin) return { allowed: false, origin: null };

  const sameOrigin = requestOrigin === requestServerOrigin(req);
  if (sameOrigin || allowedOrigins.has(requestOrigin)) {
    return { allowed: true, origin: requestOrigin };
  }

  return { allowed: false, origin: null };
}

export function applyCorsHeaders(res, decision) {
  res.setHeader("Vary", "Origin");
  if (decision.origin) res.setHeader("Access-Control-Allow-Origin", decision.origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

export function applyBrowserSecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'"
  ].join("; "));
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

function requestServerOrigin(req) {
  const host = String(req.headers.host ?? "").trim();
  if (!host) return null;
  const protocol = req.socket.encrypted ? "https" : "http";
  return normalizeOrigin(`${protocol}://${host}`);
}

function normalizeOrigin(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value).trim());
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}
