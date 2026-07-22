# AEGIS evaluation coverage

The deterministic extraction matrix in `tests/api/evaluation.test.mjs` checks representative high-risk inputs:

- common spelling errors in flood and alert wording;
- Hinglish rain-alert questions;
- earthquake and landslide alerts;
- evacuation orders with time references;
- underspecified messages that must remain `unknown_claim`.

The API pipeline tests additionally cover stale evidence, live-source allowlist enforcement, fresh publisher disagreement, multilingual translation, OCR input validation, and actionable clarification data. These tests are regression checks, not accuracy claims for every Indian language or emergency type.
