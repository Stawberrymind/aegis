import { readFile, mkdir, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceRecord } from "./evidence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const allowlistPath = path.join(repoRoot, "data", "sources", "allowlist.json");
const cacheDir = path.join(repoRoot, "data", "source-cache");
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 6500;
let lastSourceStatus = {
  enabled: false,
  records: [],
  statuses: []
};

export async function loadTrustedSourceAllowlist() {
  const raw = await readFile(allowlistPath, "utf8");
  return JSON.parse(raw);
}

export async function fetchLiveEvidence(options = {}) {
  const allowlist = options.allowlist ?? await loadTrustedSourceAllowlist();
  const enabledSources = allowlist.filter((source) => source.enabled === true);
  const statuses = [];
  const records = [];

  for (const source of enabledSources) {
    const startedAt = new Date().toISOString();
    try {
      await assertAllowedSourceUrl(source.base_url, allowlist);
      const xml = await fetchText(source.base_url, {
        allowlist,
        timeout_ms: options.timeout_ms ?? DEFAULT_TIMEOUT_MS
      });
      const parsedRecords = parseSource(source, xml).map(validateEvidenceRecord);
      records.push(...parsedRecords);
      await cacheFetchResult(source.id, source.base_url, {
        status: "ok",
        record_count: parsedRecords.length,
        records: parsedRecords
      });
      statuses.push({
        source_config_id: source.id,
        source_name: source.name,
        url: source.base_url,
        status: "ok",
        fetched_at: startedAt,
        record_count: parsedRecords.length
      });
    } catch (error) {
      statuses.push({
        source_config_id: source.id,
        source_name: source.name,
        url: source.base_url,
        status: "error",
        fetched_at: startedAt,
        error: error.message
      });
    }
  }

  lastSourceStatus = {
    enabled: enabledSources.length > 0,
    records,
    statuses
  };
  return lastSourceStatus;
}

export function getLastSourceStatus() {
  return {
    enabled: lastSourceStatus.enabled,
    statuses: lastSourceStatus.statuses,
    live_record_count: lastSourceStatus.records.length
  };
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

export async function cacheFetchResult(sourceConfigId, url, payload) {
  await mkdir(cacheDir, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const cacheRecord = {
    source_config_id: sourceConfigId,
    url,
    fetched_at: fetchedAt,
    content_hash: hash,
    payload
  };
  const fileName = `${sourceConfigId}-${hash.slice(0, 16)}.json`;
  await writeFile(path.join(cacheDir, fileName), JSON.stringify(cacheRecord, null, 2), "utf8");
  return cacheRecord;
}

async function fetchText(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout_ms);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
        "user-agent": "AEGIS local claim-verification demo/0.1"
      }
    });

    await assertAllowedSourceUrl(response.url, options.allowlist);
    if (!response.ok) {
      throw new Error(`Trusted source returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/xml|rss|text\/plain|octet-stream/i.test(contentType)) {
      throw new Error(`Unexpected trusted-source content type: ${contentType || "unknown"}`);
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("Trusted-source response exceeded size limit");
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSource(source, xml) {
  if (source.parser !== "cap-rss-v1") {
    throw new Error(`Unsupported trusted-source parser: ${source.parser}`);
  }

  return parseRssItems(xml)
    .slice(0, 60)
    .map((item) => rssItemToEvidence(source, item));
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item\b[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRegex) ?? [];

  for (const rawItem of matches) {
    const title = xmlValue(rawItem, "title");
    const description = xmlValue(rawItem, "description");
    const link = xmlValue(rawItem, "link") || xmlValue(rawItem, "guid");
    const pubDate = xmlValue(rawItem, "pubDate") || xmlValue(rawItem, "updated") || xmlValue(rawItem, "dc:date");
    if (!title && !description) continue;
    items.push({ title, description, link, pubDate });
  }

  return items;
}

function rssItemToEvidence(source, item) {
  const text = [item.title, item.description].filter(Boolean).join(" ");
  const publishedAt = normalizeDate(item.pubDate) ?? new Date().toISOString();
  const sourceUrl = item.link && isLikelyHttpUrl(item.link) ? item.link : source.base_url;
  const assertion = inferAssertion(text);
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
      identifier: sourceUrl,
      event: assertion.predicate,
      severity: inferSeverity(text),
      urgency: inferUrgency(text),
      certainty: "observed_or_likely",
      effective_at: publishedAt,
      expires_at: inferExpiry(text, publishedAt),
      instruction: cleanText(item.description || item.title)
    },
    assertions: [assertion]
  };
}

function inferAssertion(text) {
  const lower = text.toLowerCase();
  const location = inferLocation(text);
  const weatherTerms = ["weather", "rain", "thunderstorm", "cyclone", "storm", "flood", "lightning", "heat wave", "cold wave", "warning", "alert", "watch"];
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
    "India",
    "Delhi",
    "Mumbai",
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

  return "India";
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
