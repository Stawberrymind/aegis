import { compareClaimToEvidence } from "./comparator.mjs";
import { loadEvidenceRecords } from "./evidence.mjs";
import { extractClaims } from "./claimExtractor.mjs";
import { retrieveEvidenceHybrid } from "./retrieval.mjs";
import { fetchLiveEvidence } from "./trustedFetch.mjs";
import { buildClaimUnderstanding, buildDecisionExplanation } from "./analysisInsights.mjs";
import { inspectImage } from "./media.mjs";
import { translateToEnglish } from "./translation.mjs";
import { detectLanguage } from "./nlp.mjs";
import { enrichClaimsWithLocalAI } from "./structuredExtractor.mjs";

export async function analyzeSubmission(input, options = {}) {
  const useFixtures = options.use_fixtures ?? process.env.AEGIS_USE_FIXTURES === "true";
  const fixtureRecords = options.records ?? (useFixtures ? await loadEvidenceRecords() : []);
  const shouldFetchLive = options.live_fetch ?? process.env.AEGIS_LIVE_FETCH !== "false";
  const liveFetch = shouldFetchLive
    ? await fetchLiveEvidence({ timeout_ms: options.live_fetch_timeout_ms })
    : { enabled: false, records: [], statuses: [] };
  const records = [...liveFetch.records, ...fixtureRecords];
  const media = input.image?.data
    ? await inspectImage({ data: input.image.data, mime_type: input.image.mime_type, language: input.language })
    : null;
  const submittedText = String(input.text ?? "").trim() || media?.ocr.text || "";
  const translation = media?.translation ?? await translateToEnglish(submittedText, input.language || detectLanguage(submittedText));
  const extractedText = translation.status === "completed" ? translation.text : submittedText;
  const extractionOptions = {
    language: input.language,
    location: input.location,
    document_context: Boolean(media)
  };
  let extraction = extractClaims(extractedText, extractionOptions);
  if (extractedText !== submittedText && extraction.claims.length) {
    const originalExtraction = extractClaims(submittedText, extractionOptions);
    extraction.claims = extraction.claims.map((claim, index) => {
      const originalClaim = originalExtraction.claims[index];
      if (!originalClaim) return claim;
      return {
        ...claim,
        predicate: claim.predicate === "unknown_claim" ? originalClaim.predicate : claim.predicate,
        location: claim.location === "unspecified" ? originalClaim.location : claim.location,
        time_reference: claim.time_reference === "unspecified" ? originalClaim.time_reference : claim.time_reference,
        harm_category: claim.harm_category === "unknown" ? originalClaim.harm_category : claim.harm_category,
        action_requested: claim.action_requested === "verify_before_forwarding" ? originalClaim.action_requested : claim.action_requested
      };
    });
  }

  const structuredExtraction = await enrichClaimsWithLocalAI(extractedText, extraction, {
    model: options.structuredModel,
    structuredExtractorProvider: options.structuredExtractorProvider
  });
  extraction = structuredExtraction.extraction;

  const results = [];
  let retrievalMetadata = null;

  for (const claim of extraction.claims) {
    const retrieval = await retrieveEvidenceHybrid(claim, records, {
      enableEmbeddings: options.enableEmbeddings,
      embeddingProvider: options.embeddingProvider,
      limit: options.retrieval_limit ?? 12
    });
    retrievalMetadata = retrieval.metadata;
    const comparison = compareClaimToEvidence(claim, retrieval.candidates, {
      analysis_at: input.analysis_at
    });
    comparison.evidence_analysis.records_checked = records.length;
    comparison.evidence_analysis.sources_checked_count = new Set(records.map((record) => record.source_name)).size;
    comparison.evidence_analysis.source_diversity = retrieval.metadata.source_diversity ?? 0;
    comparison.evidence_analysis.sources_checked = [...new Map(records.map((record) => [
      `${record.source_name}|${record.fixture_type ?? "fixture"}`,
      {
        name: record.source_name,
        url: record.source_url,
        origin: record.fixture_type ?? "fixture"
      }
    ])).values()];

    results.push({
      claim,
      retrieval_method: retrieval.metadata.retrieval_method,
      ...comparison,
      ai_analysis: {
        understanding: buildClaimUnderstanding(claim, {
          location_override: input.location,
          language_override: input.language
        }),
        evidence_search: comparison.evidence_analysis,
        decision: buildDecisionExplanation(claim, comparison)
      }
    });
  }

  return {
    analysis_id: `analysis-${stableId(extraction.normalized_text)}`,
    analyzed_at: input.analysis_at ?? new Date().toISOString(),
    input: {
      original_text: extraction.original_text,
      normalized_text: extraction.normalized_text,
      language: extraction.language,
      location_override: input.location ?? null,
      input_type: media ? "image" : "text"
    },
    media,
    translation,
    source_fetch: {
      mode: useFixtures ? "fixture_test_mode" : "live_only",
      enabled: liveFetch.enabled,
      statuses: liveFetch.statuses,
      live_record_count: liveFetch.records.length,
      fixture_record_count: fixtureRecords.length,
      live_evidence_available: liveFetch.records.length > 0
    },
    model: {
      name: "aegis-local-ai-pipeline",
      version: "0.2.0",
      role: "Local AI translates, extracts structured claim fields when enabled, and ranks semantically similar evidence. Evidence rules, not model output or scores, produce the verdict.",
      components: [
        "multilingual rule-based claim extraction",
        "optional local structured claim extraction with schema validation",
        "local multilingual embedding retrieval",
        "lexical fallback retrieval",
        "schema-grounded claim-evidence comparison",
        "stale-evidence guardrail"
      ],
      paid_credentials_required: false
    },
    structured_extraction: structuredExtraction.status,
    retrieval: {
      method: retrievalMetadata?.retrieval_method ?? "none",
      embedding: retrievalMetadata?.embedding ?? null
    },
    claims: results,
    disclaimers: [
      "AEGIS checks claims against configured trusted evidence; it does not replace official emergency services.",
      "This live-only mode does not use demo records. If the trusted source is unavailable, AEGIS returns not_established rather than substituting demo evidence.",
      "Missing provenance or unavailable evidence does not prove that media is false.",
      "OCR text is an aid to claim extraction. Review the original image when wording or context is important.",
      "Verdicts are limited to supported, contradicted, or not_established."
    ]
  };
}

function stableId(text) {
  let hash = 5381;
  for (const char of text) {
    hash = ((hash << 5) + hash) ^ char.charCodeAt(0);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
