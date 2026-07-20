import { ConfidenceBands, Verdicts } from "./types.mjs";
import { compatibleLocation } from "./retrieval.mjs";

const TIME_SENSITIVE_HOURS = 72;

export function compareClaimToEvidence(claim, candidates, options = {}) {
  const analysisAt = new Date(options.analysis_at ?? Date.now());
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

  if (freshRelevant.length === 0) {
    return notEstablished(claim, usable, "No fresh trusted evidence directly matched the extracted claim.");
  }

  const unknown = freshRelevant.find((candidate) => candidate.matched_assertion.polarity === "unknown");
  if (unknown) {
    return notEstablished(claim, [unknown], "The closest trusted evidence says the claim is not confirmed.");
  }

  const contradicted = freshRelevant.find((candidate) => candidate.matched_assertion.polarity === "negated");
  if (contradicted) {
    return {
      claim_id: claim.claim_id,
      verdict: Verdicts.CONTRADICTED,
      confidence_band: contradicted.retrieval_score >= 0.8 ? ConfidenceBands.HIGH : ConfidenceBands.MEDIUM,
      confidence_score: clamp(0.66 + contradicted.retrieval_score / 4),
      rationale: `The evidence "${contradicted.record.title}" directly conflicts with the extracted claim for ${claim.location}.`,
      evidence: [formatEvidence(contradicted)],
      stale_evidence: directlyRelevant.filter((candidate) => candidate.staleness.is_stale).map(formatEvidence),
      safety_note: safeActionFor(claim, Verdicts.CONTRADICTED)
    };
  }

  const supported = freshRelevant.find((candidate) => candidate.matched_assertion.polarity === "asserted");
  if (supported) {
    return {
      claim_id: claim.claim_id,
      verdict: Verdicts.SUPPORTED,
      confidence_band: supported.retrieval_score >= 0.8 ? ConfidenceBands.HIGH : ConfidenceBands.MEDIUM,
      confidence_score: clamp(0.64 + supported.retrieval_score / 4),
      rationale: `The evidence "${supported.record.title}" supports the extracted claim for ${claim.location}.`,
      evidence: [formatEvidence(supported)],
      stale_evidence: directlyRelevant.filter((candidate) => candidate.staleness.is_stale).map(formatEvidence),
      safety_note: safeActionFor(claim, Verdicts.SUPPORTED)
    };
  }

  return notEstablished(claim, usable, "Trusted evidence was relevant but did not establish the claim.");
}

function notEstablished(claim, candidates, reason) {
  return {
    claim_id: claim.claim_id,
    verdict: Verdicts.NOT_ESTABLISHED,
    confidence_band: ConfidenceBands.LOW,
    confidence_score: 0.35,
    rationale: reason,
    evidence: candidates.slice(0, 2).map(formatEvidence),
    stale_evidence: candidates.filter((candidate) => candidate.staleness?.is_stale).map(formatEvidence),
    safety_note: safeActionFor(claim, Verdicts.NOT_ESTABLISHED)
  };
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
