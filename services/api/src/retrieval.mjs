import {
  cosineSimilarity,
  embedText,
  embedMany,
  embeddingInputForClaim,
  embeddingInputForEvidence,
  getEmbeddingStatus,
  localEmbeddingsEnabled
} from "./embeddings.mjs";
import { jaccard, tokenSet } from "./nlp.mjs";

export function retrieveEvidence(claim, records, limit = 5) {
  return retrieveEvidenceLexical(claim, records, limit);
}

export async function retrieveEvidenceHybrid(claim, records, options = {}) {
  if (options.enableEmbeddings === false || !localEmbeddingsEnabled()) {
    const candidates = diversifyCandidates(
      retrieveEvidenceLexical(claim, records, options.limit ?? 12),
      options.limit ?? 12
    );
    return {
      candidates,
      metadata: {
        retrieval_method: "lexical_fallback",
        embedding: { ...getEmbeddingStatus(), fallback_used: true },
        source_diversity: countSources(candidates)
      }
    };
  }

  try {
    const claimVector = await embedText(embeddingInputForClaim(claim), options);
    const evidenceVectors = await embedMany(records.map((record) => embeddingInputForEvidence(record)), options);
    const scored = [];
    for (const [index, record] of records.entries()) {
      const lexicalCandidate = scoreRecordLexically(claim, record);
      const evidenceVector = evidenceVectors[index];
      const embeddingScore = cosineSimilarity(claimVector, evidenceVector);
      const finalScore = (
        embeddingScore * 0.72 +
        lexicalCandidate.lexical_score * 0.18 +
        boostForAssertion(claim, lexicalCandidate.matched_assertion, record) * 0.1
      );
      scored.push({
        record,
        retrieval_score: Number(finalScore.toFixed(4)),
        final_retrieval_score: Number(finalScore.toFixed(4)),
        embedding_score: Number(embeddingScore.toFixed(4)),
        lexical_score: lexicalCandidate.lexical_score,
        retrieval_method: "hybrid_local_embedding",
        matched_assertion: lexicalCandidate.matched_assertion
      });
    }

    const candidates = diversifyCandidates(
      scored
        .filter((candidate) => candidate.final_retrieval_score >= 0.12)
        .sort((a, b) => b.final_retrieval_score - a.final_retrieval_score),
      options.limit ?? 12
    );
    return {
      candidates,
      metadata: {
        retrieval_method: "hybrid_local_embedding",
        embedding: getEmbeddingStatus(),
        source_diversity: countSources(candidates)
      }
    };
  } catch (error) {
    return {
      candidates: diversifyCandidates(retrieveEvidenceLexical(claim, records, options.limit ?? 12), options.limit ?? 12).map((candidate) => ({
        ...candidate,
        retrieval_method: "lexical_fallback"
      })),
      metadata: {
        retrieval_method: "lexical_fallback",
        embedding: {
          ...getEmbeddingStatus(),
          fallback_used: true,
          error: error.message
        },
        source_diversity: countSources(retrieveEvidenceLexical(claim, records, options.limit ?? 12))
      }
    };
  }
}

export function retrieveEvidenceLexical(claim, records, limit = 5) {
  const claimTokens = tokenSet([
    claim.text,
    claim.predicate,
    claim.location,
    claim.action_requested,
    claim.harm_category
  ].join(" "));

  const ranked = records
    .map((record) => scoreRecordLexically(claim, record, claimTokens))
    .filter((candidate) => candidate.retrieval_score >= 0.12)
    .sort((a, b) => b.retrieval_score - a.retrieval_score);
  return diversifyCandidates(ranked, limit);
}

function diversifyCandidates(candidates, limit) {
  const selected = [];
  const seenSources = new Set();
  for (const candidate of candidates) {
    const source = sourceKey(candidate.record);
    if (seenSources.has(source)) continue;
    seenSources.add(source);
    selected.push(candidate);
    if (selected.length >= limit) return selected;
  }
  for (const candidate of candidates) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function countSources(candidates) {
  return new Set(candidates.map((candidate) => sourceKey(candidate.record))).size;
}

function sourceKey(record) {
  return `${record.source_name ?? "unknown source"}|${record.fixture_type ?? "fixture"}`;
}

function scoreRecordLexically(claim, record, precomputedClaimTokens = null) {
  const claimTokens = precomputedClaimTokens ?? tokenSet([
    claim.text,
    claim.predicate,
    claim.location,
    claim.action_requested,
    claim.harm_category
  ].join(" "));
  const recordTokens = tokenSet([
    record.title,
    record.body,
    record.scope,
    ...record.assertions.map((assertion) => `${assertion.predicate} ${assertion.location} ${assertion.polarity}`)
  ].join(" "));

  const lexicalScore = jaccard(claimTokens, recordTokens);
  const assertionScore = bestAssertionScore(claim, record);
  const languageScore = claim.language === record.language ? 0.08 : 0;
  const score = lexicalScore + assertionScore + languageScore;

  return {
    record,
    retrieval_score: Number(score.toFixed(4)),
    final_retrieval_score: Number(score.toFixed(4)),
    lexical_score: Number(lexicalScore.toFixed(4)),
    embedding_score: null,
    retrieval_method: "lexical",
    matched_assertion: bestAssertion(claim, record)
  };
}

function bestAssertionScore(claim, record) {
  const assertion = bestAssertion(claim, record);
  if (!assertion) return 0;
  let score = 0;
  if (assertion.predicate === claim.predicate) score += 0.55;
  if (sameLocation(assertion.location, claim.location)) score += 0.28;
  if (assertion.polarity === "unknown") score += 0.05;
  return score;
}

function boostForAssertion(claim, assertion, record) {
  if (!assertion) return 0;
  let boost = 0;
  if (assertion.predicate === claim.predicate) boost += 0.55;
  if (compatibleLocation(assertion.location, claim.location)) boost += 0.25;
  if (record.fixture_type === "live_fetch") boost += 0.08;
  if (assertion.time_scope === "current") boost += 0.05;
  return boost;
}

function bestAssertion(claim, record) {
  let best = null;
  let bestScore = -1;
  for (const assertion of record.assertions) {
    let score = 0;
    if (assertion.predicate === claim.predicate) score += 2;
    if (sameLocation(assertion.location, claim.location)) score += 1;
    if (assertion.location === "District" && claim.location !== "unspecified") score += 0.25;
    if (score > bestScore) {
      best = assertion;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export function sameLocation(a, b) {
  if (!a || !b || a === "unspecified" || b === "unspecified") return false;
  return normalizeLocation(a) === normalizeLocation(b);
}

export function compatibleLocation(a, b) {
  if (a && b && b !== "unspecified" && normalizeLocation(b) === "india" && a !== "unspecified") {
    return normalizeLocation(a) === "india";
  }
  return sameLocation(a, b);
}

function normalizeLocation(location) {
  return String(location).toLowerCase().replace(/\s+/g, " ").trim();
}
