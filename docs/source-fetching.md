# Trusted source fetching

AEGIS supports only controlled trusted-source fetching. It must not search the open web or fetch URLs supplied by users.

Current implementation:

- `data/sources/allowlist.json` defines allowed source metadata.
- `services/api/src/trustedFetch.mjs` validates HTTPS, enabled source configuration, host, and base URL.
- The enabled live source is NDMA SACHET India CAP RSS: `https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml`.
- IMD public sources are also enabled: the WMO/IMD CAP RSS feed `https://cap-sources.s3.amazonaws.com/in-imd-en/rss.xml` and IMD district nowcast RSS `https://mausam.imd.gov.in/imd_latest/contents/dist_nowcast_rss.php`.
- IMD's documented API gateway exposes additional warnings, forecasts, rainfall, cyclone, marine, and nowcast APIs, but its current gateway uses authenticated JWT access. AEGIS does not claim access to those endpoints without credentials.
- Live RSS items are parsed into evidence records with `evidence_origin: live_fetch`.
- The `cap-rss-v2` parser preserves structured CAP `identifier`, `event`, `areaDesc`, `severity`, `urgency`, `certainty`, `sent`, `effective`, `expires`, and `instruction` values when an RSS item provides them.
- Sparse RSS items remain supported through conservative best-effort inference from their title and description. The record marks whether structured CAP fields were present.
- Tests assert that arbitrary URLs are blocked.

## Runtime data policy

Normal AEGIS runtime is live-only: it analyzes validated records fetched from enabled allowlisted sources and does not load the repository's demo fixtures. If no live record can be fetched, the system returns `not_established` and exposes the source-fetch error. Fixtures remain in the repository solely for deterministic automated tests, where `use_fixtures: true` is passed explicitly.

The current fetcher applies a timeout, response-size limit, content-type check, redirect destination validation, schema validation, and local cache write. It does not yet follow each RSS item to fetch a separate full CAP XML document, so detail quality still depends on fields present in the feed item.

Production-style source ingestion should add more source-specific parsers, enforce cache TTL reads and request-rate limits, and retrieve allowlisted full CAP documents where terms and source behavior permit.

## Social channels

`data/sources/social-handles.json` records official-channel references for IMD, NDMA, and NDRF. They are exposed through `GET /sources/social` for the future website reference panel, but posts are not automatically fetched or used as verdict evidence. X/Twitter integration should use the platform’s documented API with explicit credentials, rate limits, and provenance capture; scraping profile pages or search results is not a reliable verification mechanism.
