import { compareClaimToEvidence } from "./comparator.mjs";
import { loadEvidenceRecords } from "./evidence.mjs";
import { extractClaims } from "./claimExtractor.mjs";
import { retrieveEvidenceHybrid } from "./retrieval.mjs";
import { fetchLiveEvidence } from "./trustedFetch.mjs";

export async function analyzeSubmission(input, options = {}) {
  const fixtureRecords = options.records ?? await loadEvidenceRecords();
  const shouldFetchLive = options.live_fetch ?? process.env.AEGIS_LIVE_FETCH !== "false";
  const liveFetch = shouldFetchLive
    ? await fetchLiveEvidence({ timeout_ms: options.live_fetch_timeout_ms })
    : { enabled: false, records: [], statuses: [] };
  const records = [...liveFetch.records, ...fixtureRecords];
  const extraction = extractClaims(input.text, {
    language: input.language,
    location: input.location
  });

  const results = [];
  let retrievalMetadata = null;

  for (const claim of extraction.claims) {
    const retrieval = await retrieveEvidenceHybrid(claim, records, {
      enableEmbeddings: options.enableEmbeddings,
      embeddingProvider: options.embeddingProvider
    });
    retrievalMetadata = retrieval.metadata;
    const comparison = compareClaimToEvidence(claim, retrieval.candidates, {
      analysis_at: input.analysis_at
    });

    results.push({
      claim,
      retrieval_method: retrieval.metadata.retrieval_method,
      ...comparison
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
      input_type: "text"
    },
    source_fetch: {
      enabled: liveFetch.enabled,
      statuses: liveFetch.statuses,
      live_record_count: liveFetch.records.length,
      fixture_record_count: fixtureRecords.length
    },
    model: {
      name: "aegis-local-deterministic-ai",
      version: "0.1.0",
      components: [
        "multilingual rule-based claim extraction",
        "local multilingual embedding retrieval",
        "lexical fallback retrieval",
        "schema-grounded claim-evidence comparison",
        "stale-evidence guardrail"
      ],
      paid_credentials_required: false
    },
    retrieval: {
      method: retrievalMetadata?.retrieval_method ?? "none",
      embedding: retrievalMetadata?.embedding ?? null
    },
    claims: results,
    disclaimers: [
      "AEGIS checks claims against configured trusted evidence; it does not replace official emergency services.",
      "Missing provenance or unavailable evidence does not prove that media is false.",
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
