# AEGIS implementation handover

## Read this first

You are taking over a new repository for **AEGIS - AI Crisis-Claim Verification for India**. Build a complete, polished, local-first demonstrator, not a slideware dashboard. The goal is a credible AI Impact Festival submission: a real product whose limitations are explicit and whose AI is genuinely central.

Do not broaden the product into military surveillance, autonomous enforcement, a general fake-news classifier, or a universal deepfake detector. It is a **civil-defence information-resilience tool**.

## The user-facing problem

During a crisis, a person may receive a forwarded text, image, or voice note that claims an evacuation order, road closure, public-authority announcement, donation request, or official statement. They need a quick, understandable answer to one question:

> What does trusted evidence say about this exact claim?

The product should return one of three verdicts:

| Verdict | Meaning | Required UI behaviour |
| --- | --- | --- |
| **Supported** | Retrieved evidence directly supports the material claim. | Show the source, date, and any scope limits. |
| **Contradicted** | Retrieved evidence directly conflicts with the material claim. | Explain the conflict; do not accuse a person or account. |
| **Not established** | Evidence is absent, weak, stale, or inconclusive. | Explain uncertainty and point to the official channel. |

Never display a binary `REAL` / `FAKE` badge.

## Required deliverable

Build a working local monorepo with this practical shape:

```text
apps/
  web/                 # React + TypeScript frontend
services/
  api/                 # FastAPI backend and AI pipeline
data/
  evidence/            # versioned JSON fixtures and source metadata
  source-cache/         # ignored cache for allowlisted official-source fetches
  submissions/         # ignored local development uploads only
docs/
  architecture.md
  model-card.md
  data-card.md
  privacy-and-safety.md
  demo-script.md
tests/
  api/
  web/
```

Choose tooling that works cleanly on Windows. A recommended baseline is Vite + React + TypeScript, FastAPI + Pydantic, SQLite for local metadata, and a lightweight local retrieval implementation. Use package-lock or pnpm-lock plus a Python requirements/lock file so setup is reproducible.

### Product screens

1. **Landing / submit** - text box, image upload, language selector, clear privacy notice.
2. **Analysis result** - verdict, confidence band, structured claims, retrieved evidence, source links, timestamp, and a safe action card.
3. **How it works** - a simple explanation of claim extraction, evidence retrieval, and uncertainty.
4. **Evidence library** - the exact curated source records used in the demo, including dates and URLs.
5. **Source fetch status** - the latest allowlisted official-source fetch attempt, cache timestamp, errors, and whether the current verdict used fixture or live-fetched evidence.

Make the UI excellent: responsive, keyboard usable, high contrast, readable Hindi font support, and no fake government branding.

## AI implementation contract

Implement the pipeline in layers so it is useful without paid APIs and enhanced when model credentials are provided.

### 1. Input normalisation

- Text: normalise whitespace and preserve original text.
- Image: perform OCR through a swappable adapter. Return a graceful "text could not be read" state instead of inventing text.
- Voice: make transcription an adapter. Do not claim live audio support until it works in local testing.
- Language: detect English/Hindi; preserve user-selected language as an override.

### 2. Claim extraction

Represent each claim with a typed schema:

```json
{
  "claim_id": "claim-001",
  "text": "The district has ordered an evacuation of Sector 4 tonight.",
  "subject": "district administration",
  "predicate": "ordered evacuation",
  "location": "Sector 4",
  "time_reference": "tonight",
  "harm_category": "emergency_instruction",
  "action_requested": "evacuate"
}
```

Start with a deterministic extractor for the supplied fixtures. Add an optional LLM-backed structured extractor behind an environment flag, validating every response with Pydantic. Never expose raw model prose as a verdict.

### 3. Evidence retrieval

- Create at least 18 well-documented fixtures, split across English and Hindi.
- Each evidence record must include `id`, `title`, `body`, `language`, `published_at`, `source_name`, `source_url`, `source_type`, and `scope`.
- Include supported, contradicted, and genuinely unresolved examples.
- Use local lexical retrieval first. If adding embeddings, make them optional and record the model/version in the UI or docs.
- Never fabricate a source URL or date.

### 3a. Real-time trusted-source fetching

Add a controlled real-time evidence fetch path for trusted public sources, while keeping the fixture-backed local demo fully functional without network access.

- Fetch only from an explicit allowlist of official or otherwise trusted sources configured in repository-owned metadata, such as disaster-management portals, PIB Fact Check, emergency advisory feeds, weather alerts, or other documented public-authority pages.
- Do not perform open web search, scrape social media, or fetch arbitrary URLs supplied by users.
- Treat fetched records as candidate evidence only after parsing, source validation, timestamp extraction, and schema validation.
- Store fetched records in a local cache under `data/source-cache/` or equivalent ignored runtime storage, with `fetched_at`, `source_config_id`, HTTP status, parser version, content hash, and any parsing errors.
- Prefer versioned local fixtures for deterministic tests. Runtime analysis may combine local fixtures and successfully validated live-fetched records, but the UI must clearly mark each evidence item as `fixture` or `live_fetch`.
- If a live source is unavailable, slow, malformed, or rate-limited, degrade gracefully to cached or fixture evidence and state that live source refresh was unavailable.
- Never let stale or undated live-fetched content justify a current emergency instruction. Apply the same stale-evidence checks used for fixtures.
- Add per-source timeout, retry, cache TTL, robots/terms review notes where applicable, and rate limiting. Do not repeatedly hammer public sites during demos or tests.
- Keep live fetching disabled or mock-backed in automated tests unless a test is explicitly marked as an integration test.
- Document every configured source, parser rule, cache policy, known fragility, and non-affiliation disclaimer.

### 4. Claim-evidence comparison

Create a deterministic baseline for fixtures plus a pluggable semantic comparator. The output must be one of `supported`, `contradicted`, or `not_established`, with:

- evidence record IDs used;
- a confidence score or band;
- a short templated rationale that names the evidence, not a free-form hallucinated explanation;
- a stale-evidence check so old records cannot justify a current emergency instruction.

### 5. Provenance inspection

Keep this minimal and accurate in v1. Parse supported metadata if it is present and report only what was found. Do not use a generic image classifier to pronounce an image "AI-generated." The visible result must explain that missing provenance does not establish falsity.

## Fixture scenarios for the demo

At minimum, create these three polished flows using fictitious, clearly labelled demonstration locations and notices. Do not create realistic-looking government notices.

1. **Contradicted evacuation forward** - a Hindi or English claim conflicts with a clearly dated demo official notice.
2. **Supported safety notice** - a message accurately repeats a verified public safety advisory.
3. **Not-established altered-video claim** - the text claim lacks adequate evidence; provenance is unavailable; the result carefully states that AEGIS cannot authenticate it.

Seed additional neutral examples for robust tests. Never use current real crises as demo content.

## Security and privacy requirements

- Validate file types, filenames, size, and content signatures; reject unexpected uploads.
- Store uploads outside the served static path and delete them automatically after analysis in development mode.
- Do not log user text, media, IP addresses, or generated analysis by default.
- Keep secrets in `.env`, include `.env.example`, and ignore `.env`.
- Apply rate limits to analysis endpoints.
- Do not fetch arbitrary URLs supplied by users.
- Restrict real-time fetches to the configured trusted-source allowlist. Validate destination host, scheme, redirects, response content type, size, and parser output before using fetched content as evidence.
- Do not send user submissions to external source sites as query text. Fetch official-source pages or feeds independently, then perform local retrieval against validated records.
- Add a clear abuse report / feedback affordance without collecting sensitive information by default.

## Tests that must pass

Do not stop at unit tests. Add and run:

- API unit tests for each verdict, stale evidence, unknown evidence, malicious filename, oversized upload, and invalid media type.
- API unit tests for trusted-source allowlist enforcement, blocked arbitrary URL fetches, live-source timeout fallback, cache freshness, malformed fetched content, and source attribution.
- Frontend component tests for all verdict states and accessibility labels.
- Playwright end-to-end tests that submit each of the three fixture scenarios and verify the evidence and disclaimer are visible.
- A deterministic test proving that the system returns `not_established` when there is no relevant evidence.
- Mocked integration tests for the real-time fetch adapter. Do not require public network availability for the default test suite.

Document the exact setup and commands in the README only after confirming they execute successfully.

## Documentation to write before handoff

- `docs/architecture.md`: components, data flow, local vs optional model paths.
- `docs/model-card.md`: models/adapters, intended use, non-use, evaluation, limitations.
- `docs/data-card.md`: every fixture source, licensing/usage note, language balance, labelling rules, and known gaps.
- `docs/source-fetching.md`: allowlisted real-time sources, parser design, cache policy, timeout/rate-limit behaviour, validation rules, and fallback behaviour.
- `docs/privacy-and-safety.md`: retention, threat boundaries, misuse cases, human escalation, and limitations.
- `docs/demo-script.md`: a 90-second jury demonstration with exact clicks and expected results.

## Definition of done

The handoff is complete only when all of the following are true:

- The README contains verified setup, run, test, and demo commands.
- A new user can run the app locally without paid credentials.
- The full submit-to-result journey works for the three fixtures.
- Every visible verdict is traceable to validated evidence data, with clear marking for local fixture evidence versus live-fetched evidence.
- Real-time trusted-source fetching works against mocked sources in tests and degrades safely when public sources are unavailable.
- The app is polished on desktop and mobile sizes.
- Accessibility and low-bandwidth choices are documented.
- API, UI, and end-to-end tests pass locally.
- Documentation candidly states limitations; no fake accuracy claims, partners, deployment, or government affiliation.

## Pitch framing

Use this sentence:

> AEGIS is an AI evidence layer that helps citizens verify harmful crisis claims in their own language before they are forwarded as fact.

When asked why AI is necessary: multilingual claim extraction, semantic retrieval, comparison across paraphrases, OCR/transcription, and calibrated evidence explanations cannot be delivered by keyword rules alone.

When asked what makes it responsible: AEGIS never replaces official institutions, never labels people or communities, and prefers "not established" over a confident but unsupported verdict.
