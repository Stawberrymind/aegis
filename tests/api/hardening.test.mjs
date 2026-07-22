import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cacheFetchResult, fetchLiveEvidence, mapWithConcurrency, parseTrustedSourceXml, readResponseTextWithLimit } from "../../services/api/src/trustedFetch.mjs";
import { fetchOfficialSocialEvidence } from "../../services/api/src/social.mjs";
import { compareClaimToEvidence } from "../../services/api/src/comparator.mjs";
import { transcribeAudio } from "../../services/api/src/voice.mjs";
import { createRateLimiter, requestKey } from "../../services/api/src/rateLimit.mjs";
import { extractClaims } from "../../services/api/src/claimExtractor.mjs";
import { detectLanguage } from "../../services/api/src/nlp.mjs";
import { applyBrowserSecurityHeaders, evaluateCorsRequest, parseAllowedOrigins, resolveBindHost } from "../../services/api/src/httpSecurity.mjs";
import { validateAnalyzeRequest } from "../../services/api/src/httpRequest.mjs";

test("binds to loopback and rejects unapproved cross-origin requests by default", () => {
  assert.equal(resolveBindHost(""), "127.0.0.1");
  assert.deepEqual(
    evaluateCorsRequest(mockRequest({ origin: "http://evil.example", host: "127.0.0.1:8787" }), new Set()),
    { allowed: false, origin: null }
  );
  assert.deepEqual(
    evaluateCorsRequest(mockRequest({ origin: "http://127.0.0.1:8787", host: "127.0.0.1:8787" }), new Set()),
    { allowed: true, origin: "http://127.0.0.1:8787" }
  );
  assert.equal(evaluateCorsRequest(mockRequest({ origin: "not-an-origin" }), new Set()).allowed, false);
});

test("allows only explicitly configured separate frontend origins", () => {
  const allowed = parseAllowedOrigins("http://127.0.0.1:5173, https://aegis.example");
  assert.equal(evaluateCorsRequest(mockRequest({ origin: "http://127.0.0.1:5173" }), allowed).allowed, true);
  assert.equal(evaluateCorsRequest(mockRequest({ origin: "https://other.example" }), allowed).allowed, false);
});

test("sets a strict browser security policy without remote script or style origins", () => {
  const headers = new Map();
  applyBrowserSecurityHeaders({ setHeader(name, value) { headers.set(name, value); } });
  assert.match(headers.get("Content-Security-Policy"), /default-src 'self'/);
  assert.match(headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Referrer-Policy"), "no-referrer");
});

test("validates the analyze contract and strips non-pipeline media metadata", () => {
  const value = validateAnalyzeRequest({
    text: "Rain alert in Diu?",
    language: "en",
    location: "Diu",
    audio: { data: "UklGRg==", mime_type: "audio/wav", filename: "alert.wav", size: 4 }
  });
  assert.deepEqual(value.audio, { data: "UklGRg==", mime_type: "audio/wav" });
  assert.throws(() => validateAnalyzeRequest({ text: "hello", analysis_at: "2099-01-01T00:00:00Z" }), /unsupported request field/);
  assert.throws(() => validateAnalyzeRequest({ text: "hello", language: "xx" }), /unsupported language/);
  assert.throws(() => validateAnalyzeRequest({ audio: { data: "UklGRg==", mime_type: "audio/wav", filename: "..\\alert.wav" } }), /filename/);
  assert.throws(() => validateAnalyzeRequest({ text: "x".repeat(20_001) }), /too long/);
});

test("falls back to a bounded cache when a trusted source fetch fails", async () => {
  const source = {
    id: "test-cache-fallback",
    name: "Mock cache source",
    base_url: "https://cache.example.test/feed.xml",
    allowed_hosts: ["cache.example.test"],
    enabled: true,
    parser: "cap-rss-v1",
    cache_ttl_seconds: 30,
    cache_fallback_ttl_seconds: 3600
  };
  const record = {
    id: "live-cache-fallback-weather",
    title: "Mock rain warning for Diu",
    body: "Rain alert is active for Diu today.",
    language: "en",
    published_at: new Date().toISOString(),
    source_name: source.name,
    source_url: source.base_url,
    source_type: "official_live_cap_rss",
    scope: "Diu",
    fixture_type: "live_fetch",
    assertions: [{ predicate: "weather_alert", location: "Diu", polarity: "asserted", time_scope: "current" }]
  };
  await cacheFetchResult(source.id, source.base_url, { status: "ok", record_count: 1, records: [record], parser: source.parser });
  const result = await fetchLiveEvidence({ allowlist: [source], retries: 0, fetchImpl: async () => { throw new Error("simulated timeout"); } });
  assert.equal(result.statuses[0].status, "cache_fallback");
  assert.equal(result.records[0].fixture_type, "live_cache");
  assert.equal(result.statuses[0].record_count, 1);
});

test("aborts a trusted-source stream as soon as its byte limit is exceeded", async () => {
  let cancelled = false;
  let index = 0;
  const chunks = [Buffer.from("1234"), Buffer.from("5678")];
  const response = {
    headers: { get() { return null; } },
    body: { getReader() { return {
      async read() { return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }; },
      async cancel() { cancelled = true; },
      releaseLock() {}
    }; } }
  };
  await assert.rejects(() => readResponseTextWithLimit(response, { maxBytes: 6 }), /exceeded size limit/);
  assert.equal(cancelled, true);
  assert.equal(index, 2);
});

test("runs independent source fetches with bounded concurrency and stable ordering", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([30, 10, 20, 5], 2, async (delay) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return delay;
  });
  assert.deepEqual(results, [30, 10, 20, 5]);
  assert.equal(peak, 2);
});

test("retains only the configured source-cache history and maintains a latest pointer", async () => {
  const cache_dir = await mkdtemp(path.join(os.tmpdir(), "aegis-source-cache-"));
  try {
    for (let index = 0; index < 8; index += 1) {
      await cacheFetchResult("retention-test", "https://cache.example.test/feed.xml", {
        status: "ok",
        record_count: 1,
        records: [{
          id: `cache-${index}`,
          title: `Cache record ${index}`,
          body: "Rain alert for Diu.",
          language: "en",
          published_at: "2026-07-22T09:00:00Z",
          source_name: "Cache source",
          source_url: "https://cache.example.test/feed.xml",
          source_type: "official_live_cap_rss",
          scope: "Diu",
          fixture_type: "live_fetch",
          assertions: [{ predicate: "weather_alert", location: "Diu", polarity: "asserted", time_scope: "current" }]
        }],
        parser: "cap-rss-v1",
        index
      }, { cache_dir, cache_retention_per_source: 3 });
    }
    const names = await readdir(cache_dir);
    assert.equal(names.filter((name) => name.endsWith(".json") && !name.endsWith("-latest.json")).length, 3);
    assert.equal(names.includes("retention-test-latest.json"), true);
  } finally {
    await rm(cache_dir, { recursive: true, force: true });
  }
});

test("parses dated official HTML advisory content but rejects undated pages", () => {
  const source = {
    id: "mock-state-html",
    name: "Mock State Disaster Authority",
    base_url: "https://state.example.test/",
    parser: "state-advisory-html-v1"
  };
  const html = `<html><article><h1>Weather alert for Diu</h1><time datetime="2026-07-22T09:00:00+05:30"></time><p>Rain warning advisory.</p></article></html>`;
  const [record] = parseTrustedSourceXml(source, html);
  assert.equal(record.source_type, "official_state_advisory_html");
  assert.equal(record.scope, "Diu");
  assert.deepEqual(parseTrustedSourceXml(source, "<article><h1>Weather alert</h1><p>No date here</p></article>"), []);
  assert.deepEqual(parseTrustedSourceXml(source, "<h1>Weather alert</h1><time datetime=\"2026-07-22T09:00:00Z\"></time><p>Rain warning</p>"), []);
});

test("rejects undated RSS items instead of assigning them the current time", () => {
  const source = {
    id: "mock-undated-rss",
    name: "Mock RSS source",
    base_url: "https://rss.example.test/feed.xml",
    parser: "cap-rss-v1"
  };
  const xml = `<rss><channel><item><title>Rain alert for Diu</title><description>Weather warning</description></item></channel></rss>`;
  assert.deepEqual(parseTrustedSourceXml(source, xml), []);
});

test("keeps an alert with no parsed location scoped as unspecified", () => {
  const source = {
    id: "mock-unscoped-rss",
    name: "Mock RSS source",
    base_url: "https://rss.example.test/feed.xml",
    parser: "cap-rss-v1"
  };
  const xml = `<rss><channel><item><title>Weather alert</title><description>Heavy rain warning</description><pubDate>Wed, 22 Jul 2026 09:00:00 GMT</pubDate></item></channel></rss>`;
  const [record] = parseTrustedSourceXml(source, xml);
  assert.equal(record.scope, "unspecified");
  assert.equal(record.assertions[0].location, "unspecified");
});

test("uses the official social API adapter only with API-shaped responses", async () => {
  const calls = [];
  const result = await fetchOfficialSocialEvidence({
    bearer_token: "test-token",
    handles: [{ id: "imd-x", name: "IMD", handle: "@Indiametdept", url: "https://x.com/Indiametdept" }],
    fetchImpl: async (url, init) => {
      calls.push({ url, authorization: init.headers.authorization });
      if (url.includes("users/by/username")) return fakeResponse({ data: { id: "123" } });
      return fakeResponse({ data: [{ id: "tweet-1", text: "Rain alert for Diu today", lang: "en", created_at: "2026-07-22T09:00:00Z" }] });
    }
  });
  assert.equal(result.statuses[0].status, "ok");
  assert.equal(result.records[0].source_type, "official_social_api");
  assert.equal(result.records[0].scope, "Diu");
  assert.ok(calls.every((call) => call.authorization === "Bearer test-token"));
});

test("preserves negation in an official social post and does not treat social evidence as sufficient alone", async () => {
  const result = await fetchOfficialSocialEvidence({
    bearer_token: "test-token",
    handles: [{ id: "imd-x-negation", name: "IMD", handle: "@Indiametdept", url: "https://x.com/Indiametdept" }],
    fetchImpl: async (url) => url.includes("users/by/username")
      ? fakeResponse({ data: { id: "123" } })
      : fakeResponse({ data: [{ id: "tweet-negated", text: "No rain alert for Diu today", lang: "en", created_at: "2026-07-22T09:00:00Z" }] })
  });
  const record = result.records[0];
  assert.equal(record.assertions[0].polarity, "negated");
  const comparison = compareClaimToEvidence({
    claim_id: "claim-social-only",
    predicate: "weather_alert",
    location: "Diu",
    harm_category: "hazard_warning"
  }, [{
    record,
    retrieval_score: 0.9,
    final_retrieval_score: 0.9,
    matched_assertion: record.assertions[0]
  }], { analysis_at: "2026-07-22T10:00:00Z" });
  assert.equal(comparison.verdict, "not_established");
});

test("transcribes a valid PCM WAV through an injected local provider", async () => {
  const wav = makeWav(16000, 1600);
  const result = await transcribeAudio({ data: `data:audio/wav;base64,${wav.toString("base64")}`, mime_type: "audio/wav", language: "hi" }, {
    provider: async (samples, options) => {
      assert.equal(samples.length, 1600);
      assert.equal(options.language, "hindi");
      return { text: "Diu mein baarish ka alert hai" };
    }
  });
  assert.equal(result.status, "completed");
  assert.match(result.text, /baarish/i);
  assert.equal(result.duration_seconds, 0.1);
});

test("resamples non-16-kHz PCM WAV input for the transcription model", async () => {
  const wav = makeWav(8000, 800);
  const result = await transcribeAudio({ data: `data:audio/wav;base64,${wav.toString("base64")}`, mime_type: "audio/wav", language: "en" }, {
    provider: async (samples) => {
      assert.equal(samples.length, 1600);
      return { text: "rain alert" };
    }
  });
  assert.equal(result.sample_rate, 16000);
  assert.equal(result.original_sample_rate, 8000);
});

test("rate limiter returns retry information without logging request identity", () => {
  const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 2 });
  assert.equal(limiter.check("local", 100).allowed, true);
  assert.equal(limiter.check("local", 200).allowed, true);
  const blocked = limiter.check("local", 300);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retry_after_seconds, 1);
  assert.equal(limiter.check("local", 1200).allowed, true);
});

test("rate limiting ignores forwarded identities unless the direct proxy is trusted", () => {
  const req = { headers: { "x-forwarded-for": "203.0.113.10" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(requestKey(req, new Set()), "127.0.0.1");
  assert.equal(requestKey(req, new Set(["127.0.0.1"])), "203.0.113.10");
});

test("rate limiter bounds identity buckets and expires old entries", () => {
  const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 2, maxBuckets: 2 });
  limiter.check("one", 100);
  limiter.check("two", 100);
  limiter.check("three", 100);
  assert.equal(limiter.size(), 2);
  limiter.check("four", 1200);
  assert.equal(limiter.size(), 1);
});

test("evaluation matrix covers hazard types, locations, and language scripts", () => {
  const cases = [
    ["rain alert", "Diu", "weather_alert"],
    ["earthquake warning", "Assam", "earthquake_alert"],
    ["landslide alert", "Uttarakhand", "landslide_alert"],
    ["wildfire alert", "Maharashtra", "wildfire_alert"],
    ["heatwave warning", "Rajasthan", "heatwave_alert"],
    ["tsunami alert", "Andaman and Nicobar Islands", "tsunami_alert"],
    ["disease outbreak alert", "Kerala", "health_outbreak_alert"],
    ["evacuation order", "Telangana", "evacuation_order"]
  ];
  for (const [term, location, expected] of cases) {
    assert.equal(extractClaims(`Is there a ${term} in ${location}?`).claims[0].predicate, expected);
    assert.equal(extractClaims(`Is there a ${term} in ${location}?`).claims[0].location, location);
  }
  const scriptSamples = {
    hi: "बारिश चेतावनी",
    bn: "বৃষ্টি সতর্কতা",
    gu: "વરસાદ ચેતવણી",
    ta: "மழை எச்சரிக்கை",
    te: "వర్షం హెచ్చరిక",
    kn: "ಮಳೆ ಎಚ್ಚರಿಕೆ",
    ml: "മഴ മുന്നറിയിപ്പ്"
  };
  for (const [language, sample] of Object.entries(scriptSamples)) assert.equal(detectLanguage(sample), language);
});

function fakeResponse(body) {
  return { ok: true, status: 200, async json() { return body; } };
}

function mockRequest({ origin, host = "127.0.0.1:8787" }) {
  return { headers: { origin, host }, socket: { encrypted: false } };
}

function makeWav(sampleRate, frames) {
  const dataSize = frames * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
