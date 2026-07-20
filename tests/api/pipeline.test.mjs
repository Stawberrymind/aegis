import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSubmission } from "../../services/api/src/pipeline.mjs";
import { loadEvidenceRecords } from "../../services/api/src/evidence.mjs";
import { assertAllowedSourceUrl } from "../../services/api/src/trustedFetch.mjs";

const analysis_at = "2026-07-20T18:00:00+05:30";
const testOptions = { live_fetch: false, enableEmbeddings: false };

test("contradicts a false Sector 4 evacuation forward", async () => {
  const result = await analyzeSubmission({
    text: "Urgent: District officials ordered everyone in Sector 4 to evacuate tonight before 9 PM.",
    analysis_at
  }, testOptions);

  const claim = result.claims[0];
  assert.equal(claim.verdict, "contradicted");
  assert.equal(claim.claim.predicate, "evacuation_order");
  assert.equal(claim.claim.location, "Sector 4");
  assert.equal(claim.evidence[0].id, "demo-official-sector4-evac-2026-07-20");
});

test("supports a verified Ward 7 boil-water advisory", async () => {
  const result = await analyzeSubmission({
    text: "Ward 7 residents should boil drinking water today before using it.",
    analysis_at
  }, testOptions);

  const claim = result.claims[0];
  assert.equal(claim.verdict, "supported");
  assert.equal(claim.claim.predicate, "boil_water_advisory");
  assert.equal(claim.evidence[0].id, "demo-safety-ward7-boil-water-2026-07-20");
});

test("returns not_established for an altered-video authenticity claim", async () => {
  const result = await analyzeSubmission({
    text: "This Market Road video is definitely edited and proves the explosion was fake.",
    analysis_at
  }, testOptions);

  const claim = result.claims[0];
  assert.equal(claim.verdict, "not_established");
  assert.equal(claim.claim.predicate, "altered_video_authenticity");
  assert.match(claim.safety_note, /missing provenance/i);
});

test("handles Hindi evacuation claim and still uses evidence-linked contradiction", async () => {
  const result = await analyzeSubmission({
    text: "तुरंत: सेक्टर 4 को आज रात खाली करने का आदेश है।",
    language: "hi",
    analysis_at
  }, testOptions);

  const claim = result.claims[0];
  assert.equal(claim.verdict, "contradicted");
  assert.equal(claim.claim.location, "Sector 4");
  assert.ok(claim.evidence[0].source_url);
});

test("returns not_established when no relevant evidence exists", async () => {
  const result = await analyzeSubmission({
    text: "Ward 99 must collect ration cards from the blue tent tonight.",
    analysis_at
  }, testOptions);

  const claim = result.claims[0];
  assert.equal(claim.verdict, "not_established");
});

test("does not let stale evidence support current emergency instructions", async () => {
  const records = (await loadEvidenceRecords()).filter((record) => record.id === "demo-old-sector4-evac-2026-06-01");
  const result = await analyzeSubmission({
    text: "Sector 4 evacuation is ordered tonight.",
    analysis_at
  }, { records, live_fetch: false, enableEmbeddings: false });

  const claim = result.claims[0];
  assert.equal(claim.verdict, "not_established");
  assert.equal(claim.stale_evidence.length, 1);
});

test("blocks arbitrary real-time fetch URLs outside enabled trusted-source allowlist", async () => {
  await assert.rejects(
    () => assertAllowedSourceUrl("https://untrusted.example/claim-search?q=sector4", []),
    /allowlist/
  );
});

test("can use mocked live trusted-source records before fixture fallback", async () => {
  const records = [
    {
      id: "live-test-weather-delhi",
      title: "Official live CAP alert for Delhi heavy rain",
      body: "Official alert: Heavy rain warning is active for Delhi.",
      language: "en",
      published_at: analysis_at,
      source_name: "Mock Official CAP Feed",
      source_url: "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml",
      source_type: "official_live_cap_rss",
      scope: "Delhi",
      fixture_type: "live_fetch",
      assertions: [
        {
          predicate: "weather_alert",
          location: "Delhi",
          polarity: "asserted",
          time_scope: "current"
        }
      ]
    }
  ];
  const result = await analyzeSubmission({
    text: "Is there a heavy rain weather alert for Delhi today?",
    analysis_at
  }, { records, live_fetch: false, enableEmbeddings: false });

  const claim = result.claims[0];
  assert.equal(claim.verdict, "supported");
  assert.equal(claim.evidence[0].evidence_origin, "live_fetch");
});

test("marks lexical fallback when local embeddings are disabled", async () => {
  const result = await analyzeSubmission({
    text: "Ward 7 residents should boil drinking water today before using it.",
    analysis_at
  }, testOptions);

  assert.equal(result.retrieval.method, "lexical_fallback");
  assert.equal(result.claims[0].retrieval_method, "lexical_fallback");
});

test("hybrid local embedding retrieval can rank paraphrased evidence", async () => {
  const records = [
    {
      id: "live-paraphrase-weather-delhi",
      title: "Official alert: precipitation expected over Delhi",
      body: "Showers are likely across Delhi today.",
      language: "en",
      published_at: analysis_at,
      source_name: "Mock Official CAP Feed",
      source_url: "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml",
      source_type: "official_live_cap_rss",
      scope: "Delhi",
      fixture_type: "live_fetch",
      assertions: [
        {
          predicate: "weather_alert",
          location: "Delhi",
          polarity: "asserted",
          time_scope: "current"
        }
      ]
    },
    {
      id: "fixture-rain-keywords-wrong-location",
      title: "Rain word appears in an unrelated record",
      body: "Rain is mentioned here, but the scope is Mumbai.",
      language: "en",
      published_at: analysis_at,
      source_name: "Mock Fixture",
      source_url: "https://example.invalid/mock",
      source_type: "demo_status_note",
      scope: "Mumbai",
      fixture_type: "fixture",
      assertions: [
        {
          predicate: "weather_alert",
          location: "Mumbai",
          polarity: "asserted",
          time_scope: "current"
        }
      ]
    }
  ];

  const embeddingProvider = {
    async embedText(value) {
      if (value.includes("precipitation") || value.includes("Showers") || value.includes("Delhi")) return [1, 0];
      return [0, 1];
    }
  };

  const result = await analyzeSubmission({
    text: "Is there a heavy rain weather alert for Delhi today?",
    analysis_at
  }, { records, live_fetch: false, embeddingProvider });

  assert.equal(result.retrieval.method, "hybrid_local_embedding");
  assert.equal(result.claims[0].verdict, "supported");
  assert.equal(result.claims[0].evidence[0].id, "live-paraphrase-weather-delhi");
  assert.equal(result.claims[0].evidence[0].retrieval_method, "hybrid_local_embedding");
});

test("extracts and verifies multiple claims from one message", async () => {
  const result = await analyzeSubmission({
    text: "Sector 4 evacuation is ordered tonight. Ward 7 residents should boil drinking water today.",
    analysis_at
  }, testOptions);

  assert.equal(result.claims.length, 2);
  assert.equal(result.claims[0].verdict, "contradicted");
  assert.equal(result.claims[1].verdict, "supported");
});

test("expired live evidence cannot support a current emergency claim", async () => {
  const records = [
    {
      id: "live-expired-weather-delhi",
      title: "Expired official Delhi heavy rain warning",
      body: "Heavy rain warning was active for Delhi.",
      language: "en",
      published_at: "2026-07-20T10:00:00+05:30",
      source_name: "Mock Official CAP Feed",
      source_url: "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml",
      source_type: "official_live_cap_rss",
      scope: "Delhi",
      fixture_type: "live_fetch",
      live_metadata: {
        expires_at: "2026-07-20T11:00:00+05:30"
      },
      assertions: [
        {
          predicate: "weather_alert",
          location: "Delhi",
          polarity: "asserted",
          time_scope: "current"
        }
      ]
    }
  ];

  const result = await analyzeSubmission({
    text: "Is there a heavy rain weather alert for Delhi today?",
    analysis_at
  }, { records, live_fetch: false, enableEmbeddings: false });

  assert.equal(result.claims[0].verdict, "not_established");
  assert.equal(result.claims[0].stale_evidence.length, 1);
});

test("location override scopes vague flood alert claims to Hyderabad", async () => {
  const records = [
    {
      id: "live-weather-jammu",
      title: "Official flood warning over Jammu",
      body: "Flood warning is active for Jammu today.",
      language: "en",
      published_at: analysis_at,
      source_name: "Mock Official CAP Feed",
      source_url: "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml",
      source_type: "official_live_cap_rss",
      scope: "Jammu and Kashmir",
      fixture_type: "live_fetch",
      assertions: [
        {
          predicate: "weather_alert",
          location: "Jammu and Kashmir",
          polarity: "asserted",
          time_scope: "current"
        }
      ]
    }
  ];

  const result = await analyzeSubmission({
    text: "bro is there a flood alert?",
    location: "Hyderabad",
    analysis_at
  }, { records, live_fetch: false, enableEmbeddings: false });

  assert.equal(result.input.location_override, "Hyderabad");
  assert.equal(result.claims[0].claim.location, "Hyderabad");
  assert.equal(result.claims[0].verdict, "not_established");
});

test("location override can scope vague alert claims to overall India", async () => {
  const records = [
    {
      id: "live-weather-india",
      title: "Official flood warning in India",
      body: "Flood warning is active in India today.",
      language: "en",
      published_at: analysis_at,
      source_name: "Mock Official CAP Feed",
      source_url: "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml",
      source_type: "official_live_cap_rss",
      scope: "India",
      fixture_type: "live_fetch",
      assertions: [
        {
          predicate: "weather_alert",
          location: "India",
          polarity: "asserted",
          time_scope: "current"
        }
      ]
    }
  ];

  const result = await analyzeSubmission({
    text: "bro is there a flood alert?",
    location: "India",
    analysis_at
  }, { records, live_fetch: false, enableEmbeddings: false });

  assert.equal(result.claims[0].claim.location, "India");
  assert.equal(result.claims[0].verdict, "supported");
});
