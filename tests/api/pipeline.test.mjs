import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSubmission } from "../../services/api/src/pipeline.mjs";
import { loadEvidenceRecords } from "../../services/api/src/evidence.mjs";
import { assertAllowedSourceUrl, parseTrustedSourceXml } from "../../services/api/src/trustedFetch.mjs";
import { inspectImage } from "../../services/api/src/media.mjs";
import { extractClaims, INDIA_LOCATIONS } from "../../services/api/src/claimExtractor.mjs";

const analysis_at = "2026-07-20T18:00:00+05:30";
const testOptions = { live_fetch: false, enableEmbeddings: false, use_fixtures: true };

test("rejects image uploads whose bytes do not match the declared type", async () => {
  await assert.rejects(
    () => inspectImage({ data: "data:image/png;base64,ZmFrZQ==", mime_type: "image/png" }),
    /content does not match/i
  );
});

test("understands drill notices, named locations, and dated OCR times", () => {
  const result = extractClaims(
    "CITYWIDE DRILL IN PROGRESS. This is a simulated emergency communications test. DATE & TIME May 24, 2025 · 2:00 PM Local Time. AFFECTED AREA Example City and surrounding areas."
    , { document_context: true });
  const claim = result.claims[0];
  assert.equal(claim.predicate, "emergency_drill_notice");
  assert.equal(claim.location, "Example City");
  assert.match(claim.time_reference, /May 24, 2025.*2:00 PM/i);
});

test("extracts Diu and current time from a scoped rain-alert question", () => {
  const result = extractClaims("Is there a rain alert in Daman & Diu specifically Diu?");
  const claim = result.claims[0];
  assert.equal(claim.predicate, "weather_alert");
  assert.equal(claim.location, "Diu");
  assert.equal(claim.time_reference, "current");
});

test("corrects a common evacuation typo before classifying", () => {
  const claim = extractClaims("Is there an evacutaton order in Diu?").claims[0];
  assert.equal(claim.predicate, "evacuation_order");
  assert.deepEqual(claim.extraction_signals.spelling_corrections, [{ from: "evacutaton", to: "evacuation" }]);
});

test("understands Hinglish weather-alert wording", () => {
  const claim = extractClaims("Diu mein baarish ka alert hai kya?").claims[0];
  assert.equal(claim.predicate, "weather_alert");
  assert.equal(claim.location, "Diu");
  assert.equal(claim.time_reference, "current");
});

test("can fill an unknown claim with validated local structured-AI fields", async () => {
  const result = await analyzeSubmission({
    text: "Is there a hazard alert in Diu right now?"
  }, {
    ...testOptions,
    structuredExtractorProvider: {
      async generate() {
        return JSON.stringify({
          claims: [{ predicate: "weather_alert", location: "Diu", time_reference: "current" }]
        });
      }
    }
  });

  const claim = result.claims[0].claim;
  assert.equal(claim.predicate, "weather_alert");
  assert.equal(claim.location, "Diu");
  assert.equal(claim.time_reference, "current");
  assert.match(claim.extraction_method, /local_structured_ai/);
  assert.deepEqual(claim.extraction_signals.structured_fields, ["predicate"]);
  assert.equal(result.structured_extraction.loaded, true);
});

test("classifies additional hazard types", () => {
  assert.equal(extractClaims("Is there an earthquake warning in Assam?").claims[0].predicate, "earthquake_alert");
  assert.equal(extractClaims("Is there a landslide alert in Uttarakhand?").claims[0].predicate, "landslide_alert");
  assert.equal(extractClaims("Is there a heatwave warning in Rajasthan?").claims[0].predicate, "heatwave_alert");
});

test("recognizes every Indian state and union territory in location extraction", () => {
  for (const location of INDIA_LOCATIONS) {
    const claim = extractClaims(`Is there a rain alert in ${location}?`).claims[0];
    assert.equal(claim.location, location, `Expected location to be recognized: ${location}`);
  }
});

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
    text: "\u0924\u0941\u0930\u0902\u0924: \u0938\u0947\u0915\u094d\u091f\u0930 4 \u0915\u094b \u0906\u091c \u0930\u093e\u0924 \u0916\u093e\u0932\u0940 \u0915\u0930\u0928\u0947 \u0915\u093e \u0906\u0926\u0947\u0936 \u0939\u0948\u0964",
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

test("returns actionable clarification data when a claim is underspecified", async () => {
  const result = await analyzeSubmission({
    text: "Please check this message from a group chat.",
    analysis_at
  }, testOptions);

  const understanding = result.claims[0].ai_analysis.understanding;
  assert.equal(understanding.needs_clarification, true);
  assert.deepEqual(understanding.missing_fields, ["alert or claim type", "location", "time"]);
  assert.equal(understanding.clarification_options[0].action, "focus_claim");
  assert.equal(understanding.clarification_options[1].action, "focus_location");
  assert.match(understanding.missing_field_details[0].explanation, /incident/i);
});

test("uses no fixture evidence in the default live-only runtime mode", async () => {
  const result = await analyzeSubmission({
    text: "Sector 4 evacuation is ordered tonight.",
    analysis_at
  }, { live_fetch: false, enableEmbeddings: false });

  assert.equal(result.source_fetch.mode, "live_only");
  assert.equal(result.source_fetch.fixture_record_count, 0);
  assert.equal(result.claims[0].verdict, "not_established");
  assert.equal(result.claims[0].evidence.length, 0);
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

test("does not force a verdict when fresh trusted publishers disagree", async () => {
  const records = [
    {
      id: "live-imd-diu-rain",
      title: "IMD advisory: rain alert for Diu",
      body: "Rain alert is active for Diu today.",
      language: "en",
      published_at: analysis_at,
      source_name: "India Meteorological Department",
      source_url: "https://mausam.imd.gov.in/",
      source_type: "official_live_cap_rss",
      scope: "Diu",
      fixture_type: "live_fetch",
      assertions: [{ predicate: "weather_alert", location: "Diu", polarity: "asserted", time_scope: "current" }]
    },
    {
      id: "live-ndma-diu-clear",
      title: "NDMA bulletin: no rain alert for Diu",
      body: "No rain alert is currently active for Diu.",
      language: "en",
      published_at: analysis_at,
      source_name: "NDMA SACHET",
      source_url: "https://sachet.ndma.gov.in/",
      source_type: "official_live_cap_rss",
      scope: "Diu",
      fixture_type: "live_fetch",
      assertions: [{ predicate: "weather_alert", location: "Diu", polarity: "negated", time_scope: "current" }]
    }
  ];

  const result = await analyzeSubmission({
    text: "Is there a rain alert in Diu today?",
    analysis_at
  }, { records, live_fetch: false, enableEmbeddings: false });

  const claim = result.claims[0];
  assert.equal(claim.verdict, "not_established");
  assert.equal(claim.ai_analysis.evidence_search.source_consensus.status, "conflict");
  assert.equal(claim.ai_analysis.evidence_search.source_consensus.publisher_count, 2);
  assert.equal(claim.evidence.length, 2);
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
  assert.equal(result.claims[0].evidence.length, 0);
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

test("returns transparent AI understanding and evidence-match reasons", async () => {
  const result = await analyzeSubmission({
    text: "bro is there a flood alert?",
    location: "Hyderabad",
    analysis_at
  }, testOptions);

  const claim = result.claims[0];
  assert.equal(claim.ai_analysis.understanding.fields.claim_type, "weather or hazard alert");
  assert.equal(claim.ai_analysis.understanding.fields.location_source, "user_selected");
  assert.ok(Array.isArray(claim.ai_analysis.evidence_search.matches));
  assert.match(claim.ai_analysis.evidence_search.score_disclaimer, /not probabilities/i);
  assert.match(claim.ai_analysis.decision.semantic_score_role, /do not determine/i);
});

test("shows fresh direct matches before stale semantic candidates", async () => {
  const result = await analyzeSubmission({
    text: "Sector 4 evacuation is ordered tonight.",
    analysis_at
  }, testOptions);

  const matches = result.claims[0].ai_analysis.evidence_search.matches;
  assert.equal(matches[0].fresh_direct_match, true);
  assert.equal(matches[0].evidence.staleness.is_stale, false);
});

test("parses structured CAP fields from an allowlisted RSS item", () => {
  const source = {
    id: "mock-cap",
    name: "Mock Official CAP Feed",
    base_url: "https://official.example/rss.xml",
    parser: "cap-rss-v2"
  };
  const xml = `
    <rss xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2"><channel><item>
      <title>Flood warning for Hyderabad</title>
      <description>Move away from low-lying areas.</description>
      <link>https://official.example/alerts/123</link>
      <pubDate>Wed, 22 Jul 2026 04:30:00 GMT</pubDate>
      <cap:identifier>cap-alert-123</cap:identifier>
      <cap:event>Flood</cap:event>
      <cap:severity>Severe</cap:severity>
      <cap:urgency>Immediate</cap:urgency>
      <cap:certainty>Likely</cap:certainty>
      <cap:sent>2026-07-22T10:00:00+05:30</cap:sent>
      <cap:effective>2026-07-22T10:15:00+05:30</cap:effective>
      <cap:expires>2026-07-22T16:00:00+05:30</cap:expires>
      <cap:areaDesc>Hyderabad district</cap:areaDesc>
      <cap:instruction>Avoid low-lying roads and follow local authority instructions.</cap:instruction>
    </item></channel></rss>`;

  const [record] = parseTrustedSourceXml(source, xml);
  assert.equal(record.scope, "Hyderabad");
  assert.equal(record.live_metadata.identifier, "cap-alert-123");
  assert.equal(record.live_metadata.event, "Flood");
  assert.equal(record.live_metadata.severity, "severe");
  assert.equal(record.live_metadata.urgency, "immediate");
  assert.equal(record.live_metadata.certainty, "likely");
  assert.equal(record.live_metadata.expires_at, "2026-07-22T10:30:00.000Z");
  assert.match(record.live_metadata.instruction, /Avoid low-lying roads/);
  assert.equal(record.live_metadata.cap_fields_present, true);
});

test("classifies sparse multilingual weather RSS items as weather alerts", () => {
  const source = {
    id: "mock-cap",
    name: "Mock Official CAP Feed",
    base_url: "https://official.example/rss.xml",
    parser: "cap-rss-v2"
  };
  const xml = `
    <rss><channel><item>
      <title>अगले 3 घंटों में तेज़ वर्षा और वज्रपात की संभावना है</title>
      <description>मौसम चेतावनी जारी की गई है।</description>
      <pubDate>Wed, 22 Jul 2026 04:30:00 GMT</pubDate>
    </item></channel></rss>`;

  const [record] = parseTrustedSourceXml(source, xml);
  assert.equal(record.assertions[0].predicate, "weather_alert");
});
