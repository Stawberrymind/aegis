import { readFile, mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceRecord } from "./evidence.mjs";
import { INDIA_LOCATIONS } from "./claimExtractor.mjs";
import { fetchOfficialSocialEvidence } from "./social.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const allowlistPath = path.join(repoRoot, "data", "sources", "allowlist.json");
const cacheDir = path.join(repoRoot, "data", "source-cache");
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 6500;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_CACHE_FALLBACK_TTL_SECONDS = 6 * 60 * 60;
const DEFAULT_CACHE_RETENTION_PER_SOURCE = 12;
const sourceNextAllowedAt = new Map();
let lastSourceStatus = {
  enabled: false,
  records: [],
  statuses: [],
  updated_at: null
};
let liveFetchPromise = null;

export async function loadTrustedSourceAllowlist() {
  const raw = await readFile(allowlistPath, "utf8");
  return JSON.parse(raw);
}

export async function fetchLiveEvidence(options = {}) {
  const shareRefresh = options.allowlist === undefined && options.fetchImpl === undefined;
  if (!shareRefresh) return fetchLiveEvidenceOnce(options);
  if (!liveFetchPromise) {
    liveFetchPromise = fetchLiveEvidenceOnce(options).finally(() => { liveFetchPromise = null; });
  }
  return liveFetchPromise;
}

async function fetchLiveEvidenceOnce(options) {
  const allowlist = options.allowlist ?? await loadTrustedSourceAllowlist();
  const extendedSourcesEnabled = options.enable_extended_sources ?? process.env.AEGIS_ENABLE_EXTENDED_SOURCES === "true";
  const enabledSources = allowlist.filter((source) => source.enabled === true && (!source.optional || extendedSourcesEnabled));
  const sourceResults = await mapWithConcurrency(
    enabledSources,
    Number(options.max_concurrency ?? process.env.AEGIS_SOURCE_FETCH_CONCURRENCY ?? 3),
    (source) => fetchSourceEvidence(source, allowlist, options)
  );
  const records = sourceResults.flatMap((result) => result.records);
  const statuses = sourceResults.map((result) => result.status);

  if (options.include_social === true || process.env.AEGIS_ENABLE_SOCIAL_API === "true") {
    const social = await fetchOfficialSocialEvidence(options);
    records.push(...social.records);
    statuses.push(...social.statuses.map((status) => ({ ...status, source_type: "official_social_api" })));
  }

  lastSourceStatus = {
    enabled: enabledSources.length > 0,
    records,
    statuses,
    updated_at: new Date().toISOString()
  };
  return lastSourceStatus;
}

async function fetchSourceEvidence(source, allowlist, options) {
  const startedAt = new Date().toISOString();
  try {
    await assertAllowedSourceUrl(source.base_url, allowlist);
    await enforceSourceRateLimit(source, options);
    const xml = await fetchText(source.base_url, {
      allowlist,
      timeout_ms: options.timeout_ms ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: options.fetchImpl,
      retries: options.retries
    });
    const records = parseSource(source, xml).map(validateEvidenceRecord);
    await cacheFetchResult(source.id, source.base_url, {
      status: "ok",
      record_count: records.length,
      records,
      parser: source.parser,
      parser_version: "0.3.0"
    }, options);
    return {
      records,
      status: {
        source_config_id: source.id,
        source_name: source.name,
        url: source.base_url,
        status: "ok",
        fetched_at: startedAt,
        completed_at: new Date().toISOString(),
        record_count: records.length,
        evidence_origin: "live_fetch",
        cache_ttl_seconds: source.cache_ttl_seconds ?? 300,
        cache_age_seconds: 0
      }
    };
  } catch (error) {
    const fallback = await readCachedSource(source, options);
    if (fallback) {
      return {
        records: fallback.records,
        status: {
          source_config_id: source.id,
          source_name: source.name,
          url: source.base_url,
          status: "cache_fallback",
          fetched_at: startedAt,
          completed_at: new Date().toISOString(),
          record_count: fallback.records.length,
          evidence_origin: "live_cache",
          cache_fetched_at: fallback.fetched_at,
          cache_age_seconds: fallback.age_seconds,
          cache_ttl_seconds: source.cache_ttl_seconds ?? 300,
          error: error.message
        }
      };
    }
    return {
      records: [],
      status: {
          source_config_id: source.id,
          source_name: source.name,
          url: source.base_url,
          status: "error",
          fetched_at: startedAt,
          completed_at: new Date().toISOString(),
          evidence_origin: "none",
          cache_ttl_seconds: source.cache_ttl_seconds ?? 300,
          error: error.message,
          fallback: "No usable cache within the fallback window."
      }
    };
  }
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(items.length || 1, Number.isFinite(concurrency) ? Math.floor(concurrency) : 1));
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}

export function getLastSourceStatus() {
  return {
    enabled: lastSourceStatus.enabled,
    statuses: lastSourceStatus.statuses,
    live_record_count: lastSourceStatus.records.length,
    updated_at: lastSourceStatus.updated_at
  };
}

export async function getSourceHistory(limit = 30) {
  const targetDir = cacheDir;
  try {
    const names = (await readdir(targetDir)).filter((name) => name.endsWith(".json") && !name.endsWith("-latest.json"));
    const history = [];
    for (const name of names) {
      try {
        const record = JSON.parse(await readFile(path.join(targetDir, name), "utf8"));
        history.push({
          source_config_id: record.source_config_id,
          url: record.url,
          fetched_at: record.fetched_at,
          content_hash: record.content_hash,
          record_count: record.payload?.record_count ?? record.payload?.records?.length ?? 0,
          parser: record.payload?.parser ?? null,
          status: record.payload?.status ?? "unknown"
        });
      } catch {
        // Ignore an incomplete cache write; the next successful fetch will replace it.
      }
    }
    return history
      .sort((left, right) => new Date(right.fetched_at) - new Date(left.fetched_at))
      .slice(0, Math.max(1, Number(limit) || 30));
  } catch {
    return [];
  }
}

export async function assertAllowedSourceUrl(url, allowlist = null) {
  const sources = allowlist ?? await loadTrustedSourceAllowlist();
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS trusted-source fetches are allowed");
  }

  const source = sources.find((candidate) =>
    candidate.enabled === true &&
    candidate.allowed_hosts?.includes(parsed.hostname) &&
    url.startsWith(candidate.base_url)
  );

  if (!source) {
    throw new Error(`URL is not in the enabled trusted-source allowlist: ${parsed.hostname}`);
  }

  return source;
}

export async function cacheFetchResult(sourceConfigId, url, payload, options = {}) {
  const safeId = safeSourceConfigId(sourceConfigId);
  const targetDir = options.cache_dir ?? cacheDir;
  const retention = Math.max(1, Number(options.cache_retention_per_source ?? process.env.AEGIS_CACHE_RETENTION_PER_SOURCE ?? DEFAULT_CACHE_RETENTION_PER_SOURCE));
  await mkdir(targetDir, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const cacheRecord = {
    source_config_id: sourceConfigId,
    url,
    fetched_at: fetchedAt,
    content_hash: hash,
    payload
  };
  const serialized = JSON.stringify(cacheRecord, null, 2);
  const fileName = `${safeId}-${hash.slice(0, 16)}.json`;
  await writeFile(path.join(targetDir, fileName), serialized, "utf8");
  await writeFile(path.join(targetDir, `${safeId}-latest.json`), serialized, "utf8");
  await pruneSourceCache(targetDir, safeId, retention);
  return cacheRecord;
}

async function pruneSourceCache(targetDir, sourceId, retention) {
  const names = (await readdir(targetDir)).filter((name) => name.startsWith(`${sourceId}-`) && name.endsWith(".json") && !name.endsWith("-latest.json"));
  if (names.length <= retention) return;
  const entries = await Promise.all(names.map(async (name) => ({ name, modified: (await stat(path.join(targetDir, name))).mtimeMs })));
  entries.sort((left, right) => right.modified - left.modified);
  await Promise.all(entries.slice(retention).map((entry) => unlink(path.join(targetDir, entry.name)).catch(() => {})));
}

function safeSourceConfigId(value) {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id)) throw new Error("Invalid trusted-source cache identifier");
  return id;
}

async function fetchText(url, options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = Number.isInteger(options.retries) ? options.retries : DEFAULT_RETRY_COUNT;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout_ms);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "accept": "application/rss+xml, application/xml, text/xml, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1",
          "user-agent": "AEGIS local claim-verification demo/0.3"
        }
      });

      await assertAllowedSourceUrl(response.url, options.allowlist);
      if (!response.ok) {
        const error = new Error(`Trusted source returned HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!/xml|rss|html|text\/plain|octet-stream/i.test(contentType)) {
        throw new Error(`Unexpected trusted-source content type: ${contentType || "unknown"}`);
      }

      return await readResponseTextWithLimit(response, {
        maxBytes: MAX_RESPONSE_BYTES,
        abortController: controller
      });
    } catch (error) {
      lastError = error;
      const retryable = error.retryable !== false && (!error.status || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500);
      if (attempt >= retries || !retryable) throw error;
      await delay(250 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Trusted source fetch failed");
}

export async function readResponseTextWithLimit(response, options = {}) {
  const maxBytes = Number(options.maxBytes ?? MAX_RESPONSE_BYTES);
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    options.abortController?.abort();
    throw responseTooLargeError();
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw responseTooLargeError();
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        options.abortController?.abort();
        await reader.cancel("response size limit exceeded").catch(() => {});
        throw responseTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
}

function responseTooLargeError() {
  const error = new Error("Trusted-source response exceeded size limit");
  error.retryable = false;
  return error;
}

async function enforceSourceRateLimit(source, options) {
  const minIntervalMs = Number(source.min_request_interval_seconds ?? options.min_request_interval_seconds ?? 10) * 1000;
  const now = Date.now();
  const nextAllowedAt = sourceNextAllowedAt.get(source.id) ?? 0;
  if (now < nextAllowedAt) {
    const waitSeconds = Math.ceil((nextAllowedAt - now) / 1000);
    throw new Error(`Trusted source rate limit active; retry after ${waitSeconds}s`);
  }
  sourceNextAllowedAt.set(source.id, now + minIntervalMs);
}

async function readCachedSource(source, options) {
  const targetDir = options.cache_dir ?? cacheDir;
  const safeId = safeSourceConfigId(source.id);
  try {
    const latest = await readCachedCandidate(path.join(targetDir, `${safeId}-latest.json`));
    const latestResult = usableCachedSource(latest, source, options);
    if (latestResult) return latestResult;

    const names = (await readdir(targetDir)).filter((name) => name.startsWith(`${safeId}-`) && name.endsWith(".json") && !name.endsWith("-latest.json"));
    const candidates = [];
    for (const name of names) {
      try {
        const cached = await readCachedCandidate(path.join(targetDir, name));
        const prepared = prepareCachedSource(cached);
        if (prepared) candidates.push(prepared);
      } catch {
        // Ignore malformed or partially-written cache records.
      }
    }
    candidates.sort((left, right) => right.fetchedTime - left.fetchedTime);
    const newest = candidates[0];
    if (!newest) return null;
    return usableCachedSource(newest, source, options);
  } catch {
    return null;
  }
}

async function readCachedCandidate(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch { return null; }
}

function prepareCachedSource(cached) {
  if (!cached) return null;
  try {
    const records = Array.isArray(cached.payload?.records) ? cached.payload.records.map(validateEvidenceRecord) : [];
    if (!records.length) return null;
    const fetchedTime = new Date(cached.fetched_at).getTime();
    if (!Number.isFinite(fetchedTime)) return null;
    return { ...cached, records, fetchedTime };
  } catch { return null; }
}

function usableCachedSource(cached, source, options) {
  const prepared = prepareCachedSource(cached);
  if (!prepared) return null;
  const ageSeconds = Math.max(0, Math.floor((Date.now() - prepared.fetchedTime) / 1000));
  const fallbackTtl = Number(options.cache_fallback_ttl_seconds ?? source.cache_fallback_ttl_seconds ?? DEFAULT_CACHE_FALLBACK_TTL_SECONDS);
  if (ageSeconds > fallbackTtl) return null;
  return { records: prepared.records.map((record) => ({ ...record, fixture_type: "live_cache" })), fetched_at: prepared.fetched_at, age_seconds: ageSeconds };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseTrustedSourceXml(source, xml) {
  if (["pib-fact-check-html", "state-advisory-html-v1"].includes(source.parser)) {
    return parsePublicAdvisoryHtml(source, xml);
  }
  if (!["cap-rss-v1", "cap-rss-v2", "imd-nowcast-rss"].includes(source.parser)) {
    throw new Error(`Unsupported trusted-source parser: ${source.parser}`);
  }

  return parseRssItems(xml)
    .slice(0, 60)
    .map((item) => rssItemToEvidence(source, item))
    .filter(Boolean);
}

function parsePublicAdvisoryHtml(source, html) {
  const blocks = String(html).match(/<article\b[\s\S]*?<\/article>/gi) ?? [];
  return blocks.map((block) => parsePublicAdvisoryItem(source, block)).filter(Boolean);
}

function parsePublicAdvisoryItem(source, html) {
  const plainText = cleanText(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " "));
  const date = extractPublicDate(html, plainText);
  if (!date) return null;
  const alertTerms = /alert|warning|advisory|fact.?check|rain|flood|cyclone|evacuat|बारिश|बाढ़|चेतावनी/i;
  if (!alertTerms.test(plainText)) return null;
  const title = cleanText(firstHtmlValue(html, ["h1", "h2", "title"]) || source.name);
  const body = plainText.slice(0, 4000);
  const inferred = inferAssertion(body);
  const assertion = { ...inferred, location: inferKnownLocation(body) ?? inferred.location };
  const idHash = crypto.createHash("sha256").update(`${source.id}|${source.base_url}|${date}|${title}`).digest("hex").slice(0, 16);
  return {
    id: `live-${source.id}-${idHash}`,
    title,
    body,
    language: "en",
    published_at: date,
    source_name: source.name,
    source_url: source.base_url,
    source_type: source.parser === "pib-fact-check-html" ? "official_pib_fact_check" : "official_state_advisory_html",
    scope: assertion.location,
    fixture_type: "live_fetch",
    live_metadata: { parser: source.parser, html_page: true, item_boundary: "article" },
    assertions: [assertion]
  };
}

function inferKnownLocation(text) {
  const knownLocations = [
    ...INDIA_LOCATIONS,
    "India", "Delhi", "Mumbai", "Hyderabad", "Kolkata", "Chennai", "Bengaluru", "Bangalore", "Diu",
    "Kerala", "Karnataka", "Maharashtra", "Tamil Nadu", "West Bengal", "Rajasthan", "Odisha", "Assam",
    "Bihar", "Uttar Pradesh", "Madhya Pradesh", "Himachal Pradesh", "Uttarakhand", "Jammu and Kashmir"
  ];
  return knownLocations.find((location) => new RegExp(`\\b${escapeRegExp(location)}\\b`, "i").test(text)) ?? null;
}

function firstHtmlValue(html, tags) {
  for (const tag of tags) {
    const match = String(html).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match) return match[1];
  }
  return "";
}

function extractPublicDate(html, text) {
  const timeMatch = String(html).match(/<time[^>]+datetime=["']([^"']+)["']/i);
  const timeDate = normalizeDate(timeMatch?.[1]);
  if (timeDate) return timeDate;
  const dateMatch = String(text).match(/\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\b/);
  return normalizeDate(dateMatch?.[0]);
}

const parseSource = parseTrustedSourceXml;

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item\b[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRegex) ?? [];

  for (const rawItem of matches) {
    const title = xmlValue(rawItem, "title");
    const description = xmlValue(rawItem, "description");
    const link = xmlValue(rawItem, "link") || xmlValue(rawItem, "guid");
    const pubDate = xmlValue(rawItem, "pubDate") || xmlValue(rawItem, "updated") || xmlValue(rawItem, "dc:date");
    const cap = {
      identifier: xmlValue(rawItem, "cap:identifier") || xmlValue(rawItem, "identifier"),
      event: xmlValue(rawItem, "cap:event") || xmlValue(rawItem, "event"),
      severity: xmlValue(rawItem, "cap:severity") || xmlValue(rawItem, "severity"),
      urgency: xmlValue(rawItem, "cap:urgency") || xmlValue(rawItem, "urgency"),
      certainty: xmlValue(rawItem, "cap:certainty") || xmlValue(rawItem, "certainty"),
      sent: xmlValue(rawItem, "cap:sent") || xmlValue(rawItem, "sent"),
      effective: xmlValue(rawItem, "cap:effective") || xmlValue(rawItem, "effective"),
      expires: xmlValue(rawItem, "cap:expires") || xmlValue(rawItem, "expires"),
      area: xmlValue(rawItem, "cap:areaDesc") || xmlValue(rawItem, "areaDesc"),
      instruction: xmlValue(rawItem, "cap:instruction") || xmlValue(rawItem, "instruction")
    };
    if (!title && !description) continue;
    items.push({ title, description, link, pubDate, cap });
  }

  return items;
}

function rssItemToEvidence(source, item) {
  const cap = item.cap ?? {};
  const text = [item.title, item.description, cap.event, cap.area, cap.instruction].filter(Boolean).join(" ");
  const publishedAt = normalizeDate(cap.sent) ?? normalizeDate(item.pubDate);
  if (!publishedAt) return null;
  const sourceUrl = item.link && isLikelyHttpUrl(item.link) ? item.link : source.base_url;
  const assertion = inferAssertion(text, cap);
  const idHash = crypto
    .createHash("sha256")
    .update(`${source.id}|${sourceUrl}|${item.title}|${publishedAt}`)
    .digest("hex")
    .slice(0, 16);

  return {
    id: `live-${source.id}-${idHash}`,
    title: cleanText(item.title) || source.name,
    body: cleanText(item.description || item.title),
    language: "en",
    published_at: publishedAt,
    source_name: source.name,
    source_url: sourceUrl,
    source_type: "official_live_cap_rss",
    scope: assertion.location,
    fixture_type: "live_fetch",
    live_metadata: {
      identifier: cleanText(cap.identifier) || sourceUrl,
      event: cleanText(cap.event) || assertion.predicate,
      area_description: cleanText(cap.area) || assertion.location,
      severity: normalizeCapValue(cap.severity) || inferSeverity(text),
      urgency: normalizeCapValue(cap.urgency) || inferUrgency(text),
      certainty: normalizeCapValue(cap.certainty) || "unknown",
      effective_at: normalizeDate(cap.effective) ?? publishedAt,
      expires_at: normalizeDate(cap.expires) ?? inferExpiry(text, publishedAt),
      instruction: cleanText(cap.instruction || item.description || item.title),
      cap_fields_present: Object.values(cap).filter(Boolean).length > 0
    },
    assertions: [assertion]
  };
}

function inferAssertion(text, cap = {}) {
  const lower = text.toLowerCase();
  const location = inferLocation(cap.area || text);
  const weatherTerms = [
    "weather", "forecast", "rain", "thunderstorm", "cyclone", "storm", "flood", "lightning", "heat wave", "cold wave",
    "बारिश", "वर्षा", "बाढ़", "वज्रपात", "मेघगर्जन", "आंधी", "चक्रवात", "तूफान", "बिजली", "पाऊस", "पूर", "वादळ", "अतिवृष्टी",
    "વરસાદ", "વાવાઝોડ", "વીજળી", "પૂર",
    "বৃষ্টি", "বজ্রপাত", "ঝড়", "বন্যা",
    "மழை", "வெள்ளம்", "புயல்", "இடி",
    "వర్షం", "వరద", "తుఫాను", "పిడుగు",
    "ಮಳೆ", "ಪ್ರವಾಹ", "ಚಂಡಮಾರುತ", "ಗುಡುಗು",
    "മഴ", "വെള്ളപ്പൊക്കം", "ചുഴലിക്കാറ്റ്", "ഇടിമിന്നൽ"
  ];
  const predicate = weatherTerms.some((term) => lower.includes(term)) ? "weather_alert" : "public_safety_alert";
  return {
    predicate,
    location,
    polarity: "asserted",
    time_scope: "current"
  };
}

function inferSeverity(text) {
  const lower = text.toLowerCase();
  if (lower.includes("red alert") || lower.includes("extreme") || lower.includes("very heavy")) return "severe";
  if (lower.includes("orange alert") || lower.includes("heavy")) return "moderate";
  if (lower.includes("light") || lower.includes("isolated")) return "minor";
  return "unknown";
}

function inferUrgency(text) {
  const lower = text.toLowerCase();
  if (lower.includes("next 1-2 hours") || lower.includes("next 3 hours") || lower.includes("immediate")) return "immediate";
  if (lower.includes("today") || lower.includes("tonight")) return "expected";
  return "unknown";
}

function inferExpiry(text, publishedAt) {
  const lower = text.toLowerCase();
  const hoursMatch = lower.match(/next\s+(\d+)(?:-\d+)?\s+hours?/);
  const base = new Date(publishedAt);
  if (hoursMatch && !Number.isNaN(base.getTime())) {
    base.setHours(base.getHours() + Number(hoursMatch[1]));
    return base.toISOString();
  }
  return null;
}

function inferLocation(text) {
  const districtMatch = text.match(/\bover\s+([A-Z][A-Za-z .'-]{1,60}?)\s+district\b/i);
  if (districtMatch) return `${toTitleCase(districtMatch[1])} district`;

  const overMatch = text.match(/\bover\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+in\s+next|\s+for\s+next|\.|,|$)/i);
  if (overMatch) return toTitleCase(overMatch[1]);

  const forMatch = text.match(/\bfor\s+([A-Z][A-Za-z .'-]{1,60}?)(?:\s+district|\s+state|\s+in\b|$)/i);
  if (forMatch) return toTitleCase(forMatch[1]);

  const knownLocations = [
    ...INDIA_LOCATIONS,
    "India",
    "Delhi",
    "Mumbai",
    "Hyderabad",
    "Kolkata",
    "Chennai",
    "Bengaluru",
    "Bangalore",
    "Kerala",
    "Karnataka",
    "Maharashtra",
    "Tamil Nadu",
    "West Bengal",
    "Gujarat",
    "Rajasthan",
    "Odisha",
    "Assam",
    "Bihar",
    "Uttar Pradesh",
    "Madhya Pradesh",
    "Himachal Pradesh",
    "Uttarakhand",
    "Jammu and Kashmir"
  ];

  for (const location of knownLocations) {
    const pattern = new RegExp(`\\b${escapeRegExp(location)}\\b`, "i");
    if (pattern.test(text)) return location === "Bangalore" ? "Bengaluru" : location;
  }

  return "unspecified";
}

function normalizeCapValue(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "_");
}

function toTitleCase(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function xmlValue(xml, tag) {
  const escapedTag = escapeRegExp(tag);
  const match = xml.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return match ? decodeXml(stripCdata(match[1])).trim() : "";
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanText(value) {
  return decodeXml(stripTags(String(value ?? ""))).replace(/\s+/g, " ").trim();
}

function stripCdata(value) {
  return String(value).replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function stripTags(value) {
  return String(value).replace(/<[^>]+>/g, " ");
}

function decodeXml(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'");
}

function isLikelyHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
