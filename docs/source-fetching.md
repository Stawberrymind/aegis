# Trusted source fetching

AEGIS supports only controlled trusted-source fetching. It must not search the open web or fetch URLs supplied by users.

Current implementation:

- `data/sources/allowlist.json` defines allowed source metadata.
- `services/api/src/trustedFetch.mjs` validates HTTPS, enabled source configuration, host, and base URL.
- The enabled live sources are NDMA SACHET India CAP RSS: `https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml`, IMD CAP RSS, and the IMD district nowcast RSS.
- IMD public sources are also enabled: the WMO/IMD CAP RSS feed `https://cap-sources.s3.amazonaws.com/in-imd-en/rss.xml` and IMD district nowcast RSS `https://mausam.imd.gov.in/imd_latest/contents/dist_nowcast_rss.php`.
- IMD's documented API gateway exposes additional warnings, forecasts, rainfall, cyclone, marine, and nowcast APIs, but its current gateway uses authenticated JWT access. AEGIS does not claim access to those endpoints without credentials.
- Live RSS/HTML items are parsed into evidence records with `evidence_origin: live_fetch`. A bounded fallback is labelled `live_cache`.
- The `cap-rss-v2` parser preserves structured CAP `identifier`, `event`, `areaDesc`, `severity`, `urgency`, `certainty`, `sent`, `effective`, `expires`, and `instruction` values when an RSS item provides them.
- Sparse RSS items remain supported through conservative best-effort inference from their title and description, but must still carry an explicit publication date. Undated items are rejected. Generic HTML sources are parsed only within explicit `<article>` item boundaries; a whole page is never combined into one advisory record.
- Tests assert that arbitrary URLs are blocked.

## Runtime data policy

Normal AEGIS runtime is live-only: it analyzes validated records fetched from enabled allowlisted sources and does not load the repository's demo fixtures. If a live source fails, the newest cache within the bounded fallback window may be used and is labelled `live_cache`; if no live or usable cached record exists, the system returns `not_established` and exposes the source-fetch error. Fixtures remain in the repository solely for deterministic automated tests, where `use_fixtures: true` is passed explicitly.

The fetcher applies a timeout, bounded retries, streamed response-size limit, content-type check, redirect destination validation, schema validation, per-source spacing, bounded parallel refresh, and local cache write. On temporary failure it reads the per-source latest cache entry within the configured fallback window. It does not yet follow each RSS item to fetch a separate full CAP XML document, so detail quality still depends on fields present in the feed item.

Production-style source ingestion should add more source-specific parsers, retrieve allowlisted full CAP documents where terms and source behavior permit, and move rate limiting/cache history to durable operational infrastructure.

## Social channels

`data/sources/social-handles.json` records official-channel references for IMD, NDMA, and NDRF. They are exposed through `GET /sources/social`. When `AEGIS_ENABLE_SOCIAL_API=true` and `AEGIS_X_BEARER_TOKEN` is configured, the adapter uses documented X API v2 user/timeline endpoints, captures post IDs and timestamps, and treats parsed posts as candidate evidence. Without those settings, handles remain reference-only. Scraping profile pages or search results is disabled.

Source monitoring endpoints:

- `GET /sources/status` - latest in-process refresh status.
- `GET /sources/history` - content-hashed cache fetch history.
- `GET /sources/catalog` - configured source policy and optional-source notes.
- `GET /sources/social/status` - whether the official social API adapter is configured.
