import { compareClaimToEvidence } from "./comparator.mjs";
import { loadEvidenceRecords } from "./evidence.mjs";
import { extractClaims } from "./claimExtractor.mjs";
import { retrieveEvidenceHybrid } from "./retrieval.mjs";
import { fetchLiveEvidence } from "./trustedFetch.mjs";
import { buildClaimUnderstanding, buildDecisionExplanation } from "./analysisInsights.mjs";
import { inspectImage } from "./media.mjs";
import { transcribeAudio } from "./voice.mjs";
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
  const audio = input.audio?.data
    ? await transcribeAudio({ data: input.audio.data, mime_type: input.audio.mime_type, language: input.language }, { provider: options.transcriptionProvider })
    : null;
  const submittedText = String(input.text ?? "").trim() || media?.ocr.text || audio?.text || "";
  const translation = media?.translation ?? await translateToEnglish(submittedText, input.language || detectLanguage(submittedText));
  const extractedText = translation.status === "completed" ? translation.text : submittedText;
  const extractionOptions = {
    language: input.language,
    location: input.location,
    document_context: Boolean(media)
  };
  // Keep the original-language extraction as the structural source of truth.
  // A local translation model may split or paraphrase a short message; it can
  // enrich missing fields, but must not replace the user's claim boundaries.
  const originalExtraction = extractClaims(submittedText, extractionOptions);
  let extraction = originalExtraction;
  if (extractedText !== submittedText) {
    const translatedExtraction = extractClaims(extractedText, extractionOptions);
    extraction = mergeTranslatedFields(originalExtraction, translatedExtraction);
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
      input_type: media ? "image" : audio ? "voice" : "text"
    },
    media,
    audio,
    translation,
    source_fetch: {
      mode: useFixtures
        ? "fixture_test_mode"
        : liveFetch.statuses.some((status) => status.status === "cache_fallback")
          ? "live_with_cache_fallback"
          : "live_only",
      enabled: liveFetch.enabled,
      statuses: liveFetch.statuses,
      live_record_count: liveFetch.records.length,
      fixture_record_count: fixtureRecords.length,
      live_evidence_available: liveFetch.records.length > 0,
      cache_fallback_record_count: liveFetch.statuses
        .filter((status) => status.status === "cache_fallback")
        .reduce((total, status) => total + Number(status.record_count ?? 0), 0),
      source_history_available: liveFetch.statuses.some((status) => status.cache_fetched_at || status.status === "ok")
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
      "Voice transcription is local and may mishear names, places, or numbers. Review the original recording before acting.",
      "Uploaded image and audio bytes are processed in memory for this analysis and are not retained by the API.",
      "Verdicts are limited to supported, contradicted, or not_established."
    ]
  };
}

function mergeTranslatedFields(originalExtraction, translatedExtraction) {
  return {
    ...originalExtraction,
    claims: originalExtraction.claims.map((claim, index) => {
      const translatedClaim = translatedExtraction.claims[index];
      if (!translatedClaim) return claim;
      const fills = {
        predicate: claim.predicate === "unknown_claim" && translatedClaim.predicate !== "unknown_claim",
        location: claim.location === "unspecified" && translatedClaim.location !== "unspecified",
        time_reference: claim.time_reference === "unspecified" && translatedClaim.time_reference !== "unspecified",
        harm_category: claim.harm_category === "unknown" && translatedClaim.harm_category !== "unknown",
        action_requested: claim.action_requested === "verify_before_forwarding" && translatedClaim.action_requested !== "verify_before_forwarding"
      };
      if (!Object.values(fills).some(Boolean)) return claim;
      return {
        ...claim,
        predicate: fills.predicate ? translatedClaim.predicate : claim.predicate,
        location: fills.location ? translatedClaim.location : claim.location,
        time_reference: fills.time_reference ? translatedClaim.time_reference : claim.time_reference,
        harm_category: fills.harm_category ? translatedClaim.harm_category : claim.harm_category,
        action_requested: fills.action_requested ? translatedClaim.action_requested : claim.action_requested,
        extraction_method: `${claim.extraction_method}+translation_enrichment`,
        extraction_signals: {
          ...claim.extraction_signals,
          translated_fields: Object.entries(fills)
            .filter(([, used]) => used)
            .map(([field]) => field)
        }
      };
    })
  };
}

function stableId(text) {
  let hash = 5381;
  for (const char of text) {
    hash = ((hash << 5) + hash) ^ char.charCodeAt(0);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
