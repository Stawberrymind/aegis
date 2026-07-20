# Trusted source fetching

AEGIS supports only controlled trusted-source fetching. It must not search the open web or fetch URLs supplied by users.

Current implementation:

- `data/sources/allowlist.json` defines allowed source metadata.
- `services/api/src/trustedFetch.mjs` validates HTTPS, enabled source configuration, host, and base URL.
- The enabled live source is NDMA SACHET India CAP RSS: `https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml`.
- Live RSS items are parsed into evidence records with `evidence_origin: live_fetch`.
- Parsed live metadata includes best-effort event, severity, urgency, effective time, expiry time, instruction, and identifier fields.
- Tests assert that arbitrary URLs are blocked.

Production-style source ingestion should add more source-specific parsers, timeouts, cache TTLs, content-size limits, and parser-output validation before records are eligible for verdicts.
