# Source freshness and history

Every successful allowlisted fetch writes a content-hashed JSON record under the ignored `data/source-cache/` directory. The record stores the source configuration ID, URL, fetch timestamp, content hash, parser version, record count, and parsed evidence payload. The API exposes a compact view through `GET /sources/history`.

During a temporary timeout, HTTP error, parser failure, or source-rate-limit window, AEGIS can use the newest cache entry within the source's fallback window (six hours by default). The result labels this origin as `live_cache`, shows the cache age, and still applies the normal evidence publication/expiry checks. Once the fallback window expires, no cache is used and the verdict remains `not_established` unless another current source directly addresses the claim.
