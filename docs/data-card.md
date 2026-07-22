# AEGIS data card

## Data used

AEGIS uses two deliberately separate data paths:

- Versioned demonstration records in `data/evidence/records.json`, used only by deterministic tests and the fixture CLI path.
- Runtime candidate evidence from the HTTPS allowlist in `data/sources/allowlist.json`. Each fetched record retains its source name, source URL, publication time, parser metadata, and origin (`live_fetch` or `live_cache`).

The current live registry includes NDMA SACHET and IMD CAP/RSS feeds. PIB Fact Check and initial Goa/Meghalaya State Disaster Management Authority page adapters are opt-in with `AEGIS_ENABLE_EXTENDED_SOURCES=true`, because their public page structure and access conditions can change. AEGIS does not bypass login, CAPTCHA, or robots/terms restrictions.

## Language balance

Fixtures include English and Hindi. Runtime OCR and translation adapters support English, Hindi, Bengali, Gujarati, Marathi, Tamil, Telugu, Kannada, and Malayalam where the required local model files are available. Coverage and quality are not uniform across languages; the result exposes the original language and translation state.

## Labelling rules

Records are not treated as evidence merely because they are similar. A record must have required schema fields, a valid HTTPS source, a timestamp, a scope, and a machine-readable assertion. A fresh direct assertion may support or contradict a claim; stale, conflicting, weak, or undated material leaves the verdict `not_established`.

## Licensing and use

Demo records are clearly labelled fictional examples and are not government notices. Public-source fetching is limited to documented official endpoints and should be reviewed against each source's terms before production deployment. AEGIS is not affiliated with any government body.

## Known gaps

The language matrix is not an accuracy benchmark, state sources are not yet comprehensive, and the optional social adapter only uses posts returned by the official X API when credentials are supplied. Social posts remain candidate context and do not override disagreement between trusted publishers.
