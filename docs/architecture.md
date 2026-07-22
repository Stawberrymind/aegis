# AEGIS architecture

AEGIS is a local-first claim-verification demo. The current working implementation uses a Node API because Python is not available in this workspace; the service boundary remains compatible with a future FastAPI port.

## Data flow

```text
User text
  -> normalization and language detection
  -> deterministic multilingual claim extraction
  -> optional schema-constrained local structured extraction
  -> local multilingual embedding retrieval
  -> publisher-diversified evidence candidates and source consensus
  -> visible structured match diagnostics
  -> schema-grounded claim/evidence comparison
  -> evidence-linked verdict
```

The local AI pipeline lives in `services/api/src/`:

- `claimExtractor.mjs`: extracts subject, predicate, location, time reference, harm category, and requested action.
- `structuredExtractor.mjs`: optionally asks a local Transformers.js text-to-JSON model to fill only missing structured fields, validates its enum values, and falls back to the deterministic result on any failure.
- `embeddings.mjs`: loads `@huggingface/transformers` and creates local multilingual embeddings.
- `retrieval.mjs`: ranks evidence with hybrid local embeddings plus token/assertion/location matching.
- `comparator.mjs`: returns only `supported`, `contradicted`, or `not_established`, reports candidate match signals and gaps without treating scores as truth, and refuses to establish a verdict when fresh trusted publishers conflict.
- `media.mjs`, `voice.mjs`, and `translation.mjs`: run local OCR, optional PCM-WAV Whisper transcription, and supported Indian-language translation before extraction and retrieval. User media stays in memory.
- `analysisInsights.mjs`: creates the structured user-facing interpretation and deterministic verdict explanation.
- `analysisInsights.mjs`: also emits controlled missing-field explanations and clarification actions; the browser can focus the relevant input without silently changing the user’s claim.
- `trustedFetch.mjs`: enforces the live-source allowlist and parses sparse RSS plus structured CAP fields when available.

## Evidence

Evidence records are JSON fixtures in `data/evidence/records.json` for tests, or validated live/cache records from the allowlist at runtime. Each record includes source metadata, publication time, scope, and machine-readable assertions. Verdicts are generated only from validated evidence records.

## Local versus live evidence

Default tests use local fixtures and mocked embedding vectors for determinism. Real app runs use validated live records and, during temporary source failures, bounded `live_cache` records. Repository fixtures are test-only and are not a runtime fallback. Real-time fetching uses the configured allowlist in `data/sources/allowlist.json`, validates source/parser output, rejects undated records, and bounds cache history outside versioned fixtures.
