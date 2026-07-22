# Privacy and safety

## Retention

Typed text, image bytes, and voice-note bytes are processed in memory by the local service. The API does not write submissions to `data/submissions/`, serve them as static files, or send them to OpenAI, X, or trusted-source sites. Runtime source/model caches contain fetched public evidence or model artifacts, not user uploads. A deployment that adds logging, accounts, or persistent history must document and obtain consent for those changes.

The browser previews selected files locally and provides a remove control before submission. Users should still avoid uploading sensitive personal information.

## Safety boundary

AEGIS is an evidence layer for civil-defence information resilience. It does not issue emergency orders, identify people, monitor private groups, profile communities, or replace 112, NDMA, IMD, local authorities, or emergency services. For immediate danger, contact official emergency services.

The only verdicts are `supported`, `contradicted`, and `not_established`. Missing provenance, an unavailable AI-image signal, low OCR confidence, a social-media post, or a similarity score is never proof that media or a person is false.

## External requests

Runtime evidence requests use only repository-owned allowlist entries. User-provided URLs are never fetched. Redirect destinations, content types, response sizes, parser output, time freshness, source spacing, and retry behavior are controlled. Temporary source failures use only a bounded local cache; an old cache still cannot pass the evidence freshness rules.

The optional social connector uses the documented X API v2 with a bearer token supplied through the environment. It does not scrape profiles or search pages. The token must remain uncommitted and should be restricted and rotated by the operator; AEGIS reads `AEGIS_X_BEARER_TOKEN` from the process environment and does not automatically load `.env` files.

## Upload controls

Images are limited to PNG, JPEG, and WebP with signature validation and an 8 MB limit. Voice notes are limited to PCM WAV and a 16 MB adapter limit; the JSON HTTP body limit is 24 MB to account for base64 encoding overhead. The analysis endpoint is rate-limited in memory. These are local-demo safeguards, not a substitute for a production gateway, malware scanning, authentication, or durable abuse reporting.

## Human review

Review the original message, image, or recording when wording, location, dates, names, or numbers matter. Use the cited official source and contact the relevant authority for unresolved or high-consequence claims. AEGIS should prefer uncertainty over an unsupported instruction.
