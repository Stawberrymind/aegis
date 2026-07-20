# AEGIS architecture

AEGIS is a local-first claim-verification demo. The current working implementation uses a Node API because Python is not available in this workspace; the service boundary remains compatible with a future FastAPI port.

## Data flow

```text
User text
  -> normalization and language detection
  -> deterministic multilingual claim extraction
  -> local multilingual embedding retrieval
  -> schema-grounded claim/evidence comparison
  -> evidence-linked verdict
```

The local AI pipeline lives in `services/api/src/`:

- `claimExtractor.mjs`: extracts subject, predicate, location, time reference, harm category, and requested action.
- `embeddings.mjs`: loads `@huggingface/transformers` and creates local multilingual embeddings.
- `retrieval.mjs`: ranks evidence with hybrid local embeddings plus token/assertion/location matching.
- `comparator.mjs`: returns only `supported`, `contradicted`, or `not_established`.
- `trustedFetch.mjs`: enforces the allowlist contract for future real-time official-source fetching.

## Evidence

Evidence records are JSON fixtures in `data/evidence/records.json`. Each record includes source metadata, publication time, scope, and machine-readable assertions. Verdicts are generated only from validated evidence records.

## Local versus live evidence

Default tests use local fixtures and mocked embedding vectors for determinism. Real app runs use live SACHET records when available and fixture fallback otherwise. Real-time fetching must use the configured allowlist in `data/sources/allowlist.json`, validate source and parser output, and cache results outside versioned fixtures.
