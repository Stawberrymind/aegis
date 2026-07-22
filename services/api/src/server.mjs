import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSubmission } from "./pipeline.mjs";
import { getEmbeddingStatus } from "./embeddings.mjs";
import { getStructuredExtractionStatus } from "./structuredExtractor.mjs";
import { fetchLiveEvidence, getLastSourceStatus, getSourceHistory, loadTrustedSourceAllowlist } from "./trustedFetch.mjs";
import { getSocialIntegrationStatus } from "./social.mjs";
import { audioLimits } from "./voice.mjs";
import { createRateLimiter, requestKey } from "./rateLimit.mjs";
import { applyBrowserSecurityHeaders, applyCorsHeaders, evaluateCorsRequest, parseAllowedOrigins, resolveBindHost } from "./httpSecurity.mjs";
import { readJsonBody, validateAnalyzeRequest } from "./httpRequest.mjs";

const PORT = Number(process.env.AEGIS_API_PORT ?? 8787);
const HOST = resolveBindHost();
const ALLOWED_ORIGINS = parseAllowedOrigins();
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const analysisLimiter = createRateLimiter({
  windowMs: Number(process.env.AEGIS_ANALYZE_RATE_WINDOW_MS ?? 60_000),
  maxRequests: Number(process.env.AEGIS_ANALYZE_RATE_MAX ?? 12)
});
const refreshLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const webRoot = path.join(repoRoot, "apps", "web");
const socialHandlesPath = path.join(repoRoot, "data", "sources", "social-handles.json");
const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/main.js", { file: "main.js", type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }]
]);
const server = http.createServer(async (req, res) => {
  try {
    applyBrowserSecurityHeaders(res);
    const corsDecision = evaluateCorsRequest(req, ALLOWED_ORIGINS);
    applyCorsHeaders(res, corsDecision);
    if (!corsDecision.allowed) {
      sendJson(res, 403, { error: "cross-origin request is not allowed" });
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && STATIC_FILES.has(url.pathname)) {
      await sendStatic(res, STATIC_FILES.get(url.pathname));
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "aegis-api" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/sources/status") {
      sendJson(res, 200, getLastSourceStatus());
      return;
    }

    if (req.method === "GET" && url.pathname === "/sources/history") {
      sendJson(res, 200, { history: await getSourceHistory(url.searchParams.get("limit") ?? 30) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/sources/catalog") {
      const allowlist = await loadTrustedSourceAllowlist();
      sendJson(res, 200, {
        sources: allowlist.map(({ id, name, base_url, enabled, optional, parser, cache_ttl_seconds, notes }) => ({ id, name, base_url, enabled, optional: Boolean(optional), parser, cache_ttl_seconds, notes }))
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/sources/social") {
      sendJson(res, 200, JSON.parse(await readFile(socialHandlesPath, "utf8")));
      return;
    }

    if (req.method === "GET" && url.pathname === "/sources/social/status") {
      sendJson(res, 200, await getSocialIntegrationStatus());
      return;
    }

    if (req.method === "POST" && url.pathname === "/sources/refresh") {
      if (!enforceRateLimit(req, res, refreshLimiter, "source refresh")) return;
      const refreshed = await fetchLiveEvidence();
      sendJson(res, 200, {
        enabled: refreshed.enabled,
        statuses: refreshed.statuses,
        live_record_count: refreshed.records.length
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/models/status") {
      sendJson(res, 200, {
        embedding: getEmbeddingStatus(),
        structured_extraction: getStructuredExtractionStatus(),
        voice: audioLimits()
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/analyze") {
      if (!enforceRateLimit(req, res, analysisLimiter, "analysis")) return;
      const body = validateAnalyzeRequest(await readJsonBody(req, MAX_BODY_BYTES));
      const result = await analyzeSubmission({
        text: body.text,
        image: body.image,
        audio: body.audio,
        language: body.language,
        location: body.location,
        analysis_at: new Date().toISOString()
      });
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    const status = error.isPublic && Number(error.status) >= 400 && Number(error.status) < 500 ? Number(error.status) : 500;
    const payload = status < 500
      ? { error: error.message, code: error.code }
      : { error: "AEGIS could not complete the request.", code: "internal_error" };
    sendJson(res, status, payload);
  }
});

server.requestTimeout = 120_000;
server.headersTimeout = 15_000;
server.timeout = 120_000;
server.on("error", (error) => {
  console.error(`AEGIS server error: ${error.code ?? error.message}`);
});

server.listen(PORT, HOST, () => {
  console.log(`AEGIS running at http://${HOST}:${PORT}`);
});

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function enforceRateLimit(req, res, limiter, operation) {
  const outcome = limiter.check(`${operation}:${requestKey(req)}`);
  res.setHeader("X-RateLimit-Remaining", String(outcome.remaining));
  if (outcome.allowed) return true;
  res.setHeader("Retry-After", String(outcome.retry_after_seconds));
  sendJson(res, 429, { code: "rate_limited", error: `Too many ${operation} requests. Try again in ${outcome.retry_after_seconds} seconds.` });
  return false;
}

async function sendStatic(res, asset) {
  const content = await readFile(path.join(webRoot, asset.file));
  res.writeHead(200, { "content-type": asset.type });
  res.end(content);
}
