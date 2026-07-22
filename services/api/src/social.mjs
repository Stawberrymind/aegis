import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { extractClaims } from "./claimExtractor.mjs";
import { validateEvidenceRecord } from "./evidence.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const handlesPath = path.join(repoRoot, "data", "sources", "social-handles.json");
const API_ROOT = "https://api.x.com/2";
const nextAllowedAt = new Map();

export async function loadSocialHandles() {
  return JSON.parse(await readFile(handlesPath, "utf8"));
}

export async function getSocialIntegrationStatus() {
  const handles = await loadSocialHandles();
  return {
    provider: "X official API",
    configured: Boolean(process.env.AEGIS_X_BEARER_TOKEN),
    enabled: process.env.AEGIS_ENABLE_SOCIAL_API === "true",
    handles: handles.map((handle) => ({ ...handle, status: process.env.AEGIS_X_BEARER_TOKEN ? "api_ready" : "reference_only" })),
    policy: "Only posts returned by the documented official API are eligible; profile scraping is disabled."
  };
}

export async function fetchOfficialSocialEvidence(options = {}) {
  const handles = options.handles ?? await loadSocialHandles();
  const token = options.bearer_token ?? process.env.AEGIS_X_BEARER_TOKEN;
  if (!token) {
    return { enabled: false, status: "not_configured", records: [], statuses: [] };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const records = [];
  const statuses = [];
  for (const handle of handles) {
    const startedAt = new Date().toISOString();
    const minIntervalMs = Number(handle.min_request_interval_seconds ?? options.min_request_interval_seconds ?? 60) * 1000;
    const now = Date.now();
    if (now < (nextAllowedAt.get(handle.id) ?? 0)) {
      statuses.push({ source_config_id: handle.id, source_name: handle.name, status: "rate_limited", fetched_at: startedAt, record_count: 0, error: "Official social API spacing window is active." });
      continue;
    }
    nextAllowedAt.set(handle.id, now + minIntervalMs);
    try {
      const userResponse = await fetchJson(`${API_ROOT}/users/by/username/${encodeURIComponent(handle.handle.replace(/^@/, ""))}`, token, fetchImpl, options);
      const userId = userResponse?.data?.id;
      if (!userId) throw new Error("Official API did not return a user id");
      const tweets = await fetchJson(`${API_ROOT}/users/${userId}/tweets?max_results=10&tweet.fields=created_at,lang,text`, token, fetchImpl, options);
      const parsed = (tweets?.data ?? []).map((tweet) => socialPostToEvidence(handle, tweet)).filter(Boolean).map(validateEvidenceRecord);
      records.push(...parsed);
      statuses.push({ source_config_id: handle.id, source_name: handle.name, status: "ok", fetched_at: startedAt, record_count: parsed.length, evidence_origin: "live_fetch" });
    } catch (error) {
      statuses.push({ source_config_id: handle.id, source_name: handle.name, status: "error", fetched_at: startedAt, record_count: 0, error: error.message });
    }
  }
  return { enabled: true, status: "fetched", records, statuses };
}

async function fetchJson(url, token, fetchImpl, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeout_ms ?? 6500));
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Official social API returned HTTP ${response.status}`);
    const body = await response.json();
    if (!body || typeof body !== "object") throw new Error("Official social API returned invalid JSON");
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function socialPostToEvidence(handle, tweet) {
  const text = String(tweet?.text ?? "").replace(/\s+/g, " ").trim();
  const publishedAt = new Date(tweet?.created_at ?? "");
  if (!text || Number.isNaN(publishedAt.getTime())) return null;
  const extracted = extractClaims(text, { language: tweet.lang === "hi" ? "hi" : undefined });
  const claim = extracted.claims[0];
  if (!claim || ["unknown_claim", "altered_video_authenticity"].includes(claim.predicate)) return null;
  const id = crypto.createHash("sha256").update(`${handle.id}|${tweet.id}|${text}`).digest("hex").slice(0, 18);
  return {
    id: `social-${handle.id}-${id}`,
    title: `${handle.name} post: ${text.slice(0, 120)}`,
    body: text,
    language: tweet.lang || extracted.language || "en",
    published_at: publishedAt.toISOString(),
    source_name: `${handle.name} (official API)`,
    source_url: `${handle.url}/status/${tweet.id}`,
    source_type: "official_social_api",
    scope: claim.location,
    fixture_type: "live_fetch",
    live_metadata: { post_id: tweet.id, handle: handle.handle, api_provider: "X API v2" },
    assertions: [{
      predicate: claim.predicate,
      location: claim.location,
      polarity: detectPolarity(text),
      time_scope: claim.time_reference
    }]
  };
}

function detectPolarity(text) {
  const normalized = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  if (/(?:\bno\b|\bnot\b|\bwithout\b|\bnone\b|\bnever\b|\bnahi\b|\bnahi[ṃम]?\b|नहीं|नही|कोई नहीं|नाही)/i.test(normalized)) {
    return "negated";
  }
  return "asserted";
}
