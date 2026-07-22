import { ConfidenceBands, Verdicts } from "./types.mjs";
import { compatibleLocation } from "./retrieval.mjs";

const TIME_SENSITIVE_HOURS = 72;

export function compareClaimToEvidence(claim, candidates, options = {}) {
  const analysisAt = new Date(options.analysis_at ?? Date.now());
  const evidenceAnalysis = inspectEvidenceCandidates(claim, candidates, analysisAt);
  const usable = candidates
    .map((candidate) => ({
      ...candidate,
      staleness: assessStaleness(claim, candidate.record, analysisAt)
    }))
    .filter((candidate) => candidate.matched_assertion);

  const directlyRelevant = usable.filter((candidate) => {
    const assertion = candidate.matched_assertion;
    return assertion.predicate === claim.predicate && compatibleLocation(assertion.location, claim.location);
  });

  const freshRelevant = directlyRelevant.filter((candidate) => !candidate.staleness.is_stale);
  const authoritativeFreshRelevant = freshRelevant.filter((candidate) => candidate.record.source_type !== "official_social_api");
  const sourceConsensus = summarizeSourceConsensus(freshRelevant);
  evidenceAnalysis.source_consensus = sourceConsensus;

  if (sourceConsensus.status === "conflict") {
    return notEstablished(
      claim,
      freshRelevant,
      "Fresh trusted sources disagree about this claim, so AEGIS cannot establish a single evidence-backed result.",
      evidenceAnalysis
    );
  }

  if (freshRelevant.length === 0) {
    return notEstablished(claim, directlyRelevant, "No fresh trusted evidence directly matched the extracted claim.", evidenceAnalysis);
  }

  if (authoritativeFreshRelevant.length === 0) {
    return notEstablished(claim, freshRelevant, "An official social post was relevant, but social evidence alone cannot establish this claim.", evidenceAnalysis);
  }

  const unknown = freshRelevant.find((candidate) => candidate.matched_assertion.polarity === "unknown");
  if (unknown) {
    return notEstablished(claim, [unknown], "The closest trusted evidence says the claim is not confirmed.", evidenceAnalysis);
  }

  const contradicted = freshRelevant.find((candidate) => candidate.matched_assertion.polarity === "negated");
  if (contradicted) {
    return {
      claim_id: claim.claim_id,
      verdict: Verdicts.CONTRADICTED,
      confidence_band: sourceConsensus.publisher_count > 1 || contradicted.retrieval_score >= 0.8 ? ConfidenceBands.HIGH : ConfidenceBands.MEDIUM,
      confidence_score: clamp(0.66 + contradicted.retrieval_score / 4 + (sourceConsensus.publisher_count > 1 ? 0.08 : 0)),
      rationale: `${sourceConsensus.publisher_count > 1 ? `${sourceConsensus.publisher_count} trusted publishers ` : "The trusted evidence "}directly conflicts with the extracted claim for ${claim.location}.`,
      evidence: freshRelevant.slice(0, 3).map(formatEvidence),
      stale_evidence: directlyRelevant.filter((candidate) => candidate.staleness.is_stale).map(formatEvidence),
      evidence_analysis: evidenceAnalysis,
      safety_note: safeActionFor(claim, Verdicts.CONTRADICTED)
    };
  }

  const supported = freshRelevant.find((candidate) => candidate.matched_assertion.polarity === "asserted");
  if (supported) {
    return {
      claim_id: claim.claim_id,
      verdict: Verdicts.SUPPORTED,
      confidence_band: sourceConsensus.publisher_count > 1 || supported.retrieval_score >= 0.8 ? ConfidenceBands.HIGH : ConfidenceBands.MEDIUM,
      confidence_score: clamp(0.64 + supported.retrieval_score / 4 + (sourceConsensus.publisher_count > 1 ? 0.08 : 0)),
      rationale: `${sourceConsensus.publisher_count > 1 ? `${sourceConsensus.publisher_count} trusted publishers agree with ` : "The trusted evidence supports "}the extracted claim for ${claim.location}.`,
      evidence: freshRelevant.slice(0, 3).map(formatEvidence),
      stale_evidence: directlyRelevant.filter((candidate) => candidate.staleness.is_stale).map(formatEvidence),
      evidence_analysis: evidenceAnalysis,
      safety_note: safeActionFor(claim, Verdicts.SUPPORTED)
    };
  }

  return notEstablished(claim, directlyRelevant, "Trusted evidence was relevant but did not establish the claim.", evidenceAnalysis);
}

function notEstablished(claim, candidates, reason, evidenceAnalysis) {
  return {
    claim_id: claim.claim_id,
    verdict: Verdicts.NOT_ESTABLISHED,
    confidence_band: ConfidenceBands.LOW,
    confidence_score: 0.35,
    rationale: reason,
    evidence: candidates.filter((candidate) => !candidate.staleness?.is_stale).slice(0, 2).map(formatEvidence),
    stale_evidence: candidates.filter((candidate) => candidate.staleness?.is_stale).map(formatEvidence),
    evidence_analysis: evidenceAnalysis,
    safety_note: safeActionFor(claim, Verdicts.NOT_ESTABLISHED)
  };
}

function inspectEvidenceCandidates(claim, candidates, analysisAt) {
  const matches = candidates.map((candidate) => {
    const assertion = candidate.matched_assertion;
    const staleness = assessStaleness(claim, candidate.record, analysisAt);
    const predicateMatch = assertion?.predicate === claim.predicate;
    const locationMatch = assertion ? compatibleLocation(assertion.location, claim.location) : false;
    const directMatch = Boolean(predicateMatch && locationMatch);
    const reasons = [];
    const gaps = [];

    if (predicateMatch) reasons.push("same claim or alert type");
    else gaps.push("different claim or alert type");
    if (locationMatch) reasons.push("compatible location scope");
    else gaps.push("location scope does not match");
    if (candidate.embedding_score !== null && candidate.embedding_score !== undefined) {
      reasons.push(`local semantic similarity signal ${Math.round(candidate.embedding_score * 100)}%`);
    }
    if ((candidate.lexical_score ?? 0) > 0) reasons.push("shared words or phrases");
    if (staleness.is_stale) gaps.push("evidence is stale or expired");

    return {
      evidence: formatEvidence({ ...candidate, staleness }),
      direct_match: directMatch,
      fresh_direct_match: directMatch && !staleness.is_stale,
      predicate_match: predicateMatch,
      location_match: locationMatch,
      match_strength: matchStrength(candidate.final_retrieval_score ?? candidate.retrieval_score),
      match_reasons: reasons,
      gaps,
      explanation: candidateExplanation(reasons, gaps)
    };
  }).sort((a, b) => {
    if (a.fresh_direct_match !== b.fresh_direct_match) return Number(b.fresh_direct_match) - Number(a.fresh_direct_match);
    if (a.direct_match !== b.direct_match) return Number(b.direct_match) - Number(a.direct_match);
    return (b.evidence.final_retrieval_score ?? 0) - (a.evidence.final_retrieval_score ?? 0);
  }).slice(0, 8);

  return {
    candidate_count: candidates.length,
    direct_match_count: matches.filter((match) => match.direct_match).length,
    fresh_direct_match_count: matches.filter((match) => match.fresh_direct_match).length,
    matches,
    score_disclaimer: "Match scores help rank evidence and are not probabilities that the claim is true."
  };
}

function summarizeSourceConsensus(candidates) {
  const publishers = [...new Set(candidates.map((candidate) => candidate.record.source_name ?? "unknown source"))];
  const polarityCounts = candidates.reduce((counts, candidate) => {
    const polarity = candidate.matched_assertion?.polarity ?? "unknown";
    counts[polarity] = (counts[polarity] ?? 0) + 1;
    return counts;
  }, {});
  const hasAsserted = (polarityCounts.asserted ?? 0) > 0;
  const hasNegated = (polarityCounts.negated ?? 0) > 0;
  return {
    status: hasAsserted && hasNegated
      ? "conflict"
      : candidates.length === 0
        ? "no_fresh_direct_evidence"
        : publishers.length > 1
          ? "agreement"
          : "single_source",
    publisher_count: publishers.length,
    publishers,
    polarity_counts: polarityCounts
  };
}

function matchStrength(score) {
  if (score >= 0.8) return "strong";
  if (score >= 0.45) return "moderate";
  return "weak";
}

function candidateExplanation(reasons, gaps) {
  const positive = reasons.length ? `Matched on ${reasons.join(", ")}.` : "No strong matching signals were found.";
  const limitation = gaps.length ? ` Limits: ${gaps.join(", ")}.` : "";
  return `${positive}${limitation}`;
}

function assessStaleness(claim, record, analysisAt) {
  const publishedAt = new Date(record.published_at);
  const ageHours = Math.max(0, (analysisAt.getTime() - publishedAt.getTime()) / 36e5);
  const expiresAt = record.live_metadata?.expires_at ? new Date(record.live_metadata.expires_at) : null;
  const expired = expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < analysisAt.getTime();
  const timeSensitive = [
    "emergency_instruction",
    "movement_restriction",
    "hazard_warning",
    "public_health",
    "utility_disruption",
    "relief_service"
  ].includes(claim.harm_category);

  const assertionTimeScope = record.assertions.some((assertion) => assertion.time_scope === "stale") ? "stale" : "current";
  const isStale = expired || assertionTimeScope === "stale" || (timeSensitive && ageHours > TIME_SENSITIVE_HOURS);
  return {
    is_stale: isStale,
    age_hours: Number(ageHours.toFixed(2)),
    expires_at: record.live_metadata?.expires_at ?? null,
    reason: isStale ? "Evidence is expired, too old, or explicitly archived for this time-sensitive claim." : "Evidence is current enough for this demo policy."
  };
}

function formatEvidence(candidate) {
  return {
    id: candidate.record.id,
    title: candidate.record.title,
    body: candidate.record.body,
    source_name: candidate.record.source_name,
    source_url: candidate.record.source_url,
    source_type: candidate.record.source_type,
    published_at: candidate.record.published_at,
    scope: candidate.record.scope,
    evidence_origin: candidate.record.fixture_type ?? "fixture",
    live_metadata: candidate.record.live_metadata ?? null,
    retrieval_score: candidate.retrieval_score,
    final_retrieval_score: candidate.final_retrieval_score ?? candidate.retrieval_score,
    embedding_score: candidate.embedding_score ?? null,
    lexical_score: candidate.lexical_score ?? null,
    retrieval_method: candidate.retrieval_method ?? "lexical",
    matched_assertion: candidate.matched_assertion,
    staleness: candidate.staleness
  };
}

function safeActionFor(claim, verdict) {
  if (claim.harm_category === "emergency_instruction" && verdict !== Verdicts.SUPPORTED) {
    return "Do not forward this as confirmed. Check the official emergency channel and call 112 if there is immediate danger.";
  }
  if (claim.harm_category === "media_authenticity") {
    return "Do not treat missing provenance as proof of falsity. Share only with clear uncertainty and check official channels.";
  }
  if (verdict === Verdicts.SUPPORTED) {
    return "Follow the cited advisory within its stated scope and time. Use official emergency services for immediate danger.";
  }
  return "Treat this as unverified. Check the named official channel before forwarding or acting.";
}

function clamp(value) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}
