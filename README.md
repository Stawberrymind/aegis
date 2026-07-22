# AEGIS

> **AI Crisis-Claim Verification for India**

AEGIS is a privacy-first, multilingual AI product for checking high-harm public-safety claims. It accepts typed claims and images: open-source Tesseract.js OCR extracts text locally, then the same evidence pipeline checks it. Voice transcription remains a planned adapter. It does not try to be a universal "truth machine". It turns a message into specific claims, searches an approved evidence collection, and reports whether each claim is **supported**, **contradicted**, or **not established**.

The project is framed as **civil defence and national resilience**: helping citizens, volunteers, and community organisations resist harmful misinformation, impersonation, and panic during emergencies or sensitive events.

## Why this exists

India already has official emergency infrastructure. NDMA's [SACHET](https://sachet.ndma.gov.in/) disseminates geo-targeted official alerts, and the [PIB Fact Check portal](https://factcheck.pib.gov.in/) accepts suspicious information for verification. AEGIS is deliberately not another alerting or reporting platform. Its role is the missing interpretation step: a person should be able to paste the confusing message they received and see clear, cited, plain-language evidence.

The problem is current and concrete. Government guidance identifies misinformation and synthetically generated content, including deepfakes, as risks to a safe and trusted digital ecosystem. See the [MeitY / PIB update from March 2026](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2245053&lang=2&reg=48).

## Product promise

Given a user submission, AEGIS will:

1. Accept typed text or an uploaded PNG, JPEG, or WebP image in a supported language. Image OCR is local; voice-note transcription remains planned.
2. Extract the actionable claims: **who**, **what**, **where**, **when**, and **what action is proposed**.
3. Retrieve relevant material from a curated, versioned collection of official sources and checked records.
4. Compare the claim with the retrieved evidence.
5. Show an understandable verdict, evidence snippets, source links, timestamp, confidence, and safe next step.

The product must be able to say **"not established"**. Uncertainty is a feature, not a failure.

## Non-goals and safety boundary

AEGIS must never:

- claim that it can conclusively detect every deepfake or prove a media item is false;
- issue public emergency instructions or replace NDMA, 112, PIB, law enforcement, or platform moderation;
- ingest social-media feeds, scrape private groups, identify people, profile communities, or score political viewpoints;
- label an individual, organisation, or account as malicious;
- retain uploaded media by default or expose user submissions to other users.

For media, AEGIS inspects available [C2PA Content Credentials](https://contentcredentials.org/adopt/) with an open-source adapter and reports the result precisely. It also links to [OpenAI Verify](https://openai.com/research/verify/) for a manual check of OpenAI-specific C2PA/SynthID signals. Verify is not a general-purpose detector or an AEGIS API dependency; the absence of provenance is **not** proof that media is synthetic or false.

## Live-only scope

The first working release is intentionally narrow and credible:

- **Languages:** English and Hindi, with an architecture that can add more Indian languages.
- **Inputs:** typed text or PNG/JPEG/WebP image with local OCR. Voice-note transcription remains planned.
- **Evidence base:** controlled live fetching from the allowlisted NDMA SACHET CAP/RSS source. No open-web or user-supplied URL scraping. Versioned fixtures exist only for deterministic automated tests and are not loaded by normal runtime.
- **Verdicts:** supported, contradicted, not established.
- **Use cases:** false emergency/evacuation instructions, impersonated public-authority messages, and altered-media claims.
- **Interface:** accessible, mobile-first, text-first, low-bandwidth friendly, and clear enough for a non-technical user.

## Target architecture

```text
Text / image / voice note
        |
  OCR / transcription / language detection
        |
  Structured claim extraction
        |
  Multilingual embeddings + evidence retrieval
        |
  Claim-evidence comparison (entailment / contradiction / unknown)
        |
  Calibrated verdict + citations + safe action
```

The current working stack is a static browser client, a Node HTTP service, an allowlisted live-source fetcher, and a pluggable retrieval layer. A React/TypeScript and FastAPI migration remains an architectural option. See [HANDOVER.md](HANDOVER.md) for the implementation contract.

## Responsible AI controls

- Evidence-first responses: every factual verdict links to the evidence used.
- Fixed verdict vocabulary: no free-form "fake" accusations.
- Human-readable uncertainty and confidence explanations.
- Private-by-default processing and deletion controls.
- No identity, demographic, or political inference.
- Test cases for Hindi and English, contradictory evidence, missing evidence, OCR failure, and unsafe prompt-style inputs.
- A visible disclaimer directing imminent emergencies to official channels such as [112](https://112.gov.in/).

## Project status

This repository now contains a working AI verification core and a small browser UI. It does not require a paid API key. It extracts structured claims, fetches an allowlisted live official CAP/RSS source, uses local multilingual embeddings for semantic retrieval when available, can optionally run a local schema-constrained text-to-JSON model to fill missing claim fields, falls back to deterministic rules when needed, compares claims with evidence assertions, and returns only `supported`, `contradicted`, or `not_established`.

Python is not available in the current workspace, so the first working service is implemented with Node's built-in HTTP server instead of FastAPI. The API contract and service layout are kept simple so it can be ported to FastAPI later.

## Run locally

Prerequisite: Node.js 20 or newer.

Install the pinned JavaScript dependencies:

```bash
npm install
```

Start the local app:

```bash
npm run api
```

Open `http://localhost:8787` in a browser and submit a real current claim. The same Node process serves both the API and the static web UI. If NDMA SACHET is unreachable, AEGIS returns `not_established`; it does not fall back to demo records.

The first analysis with local AI embeddings enabled may download the local model `Xenova/paraphrase-multilingual-MiniLM-L12-v2`. After that, cached model files are reused by Transformers.js.

Run a command-line analysis:

```bash
npm run demo:analyze -- "Is there a weather alert in India today?"
```

Run tests:

```bash
npm test
```

The test command runs the API pipeline regressions and the extraction evaluation matrix in `tests/api/evaluation.test.mjs`.

## Implemented AI pipeline

- Multilingual text normalization and Hindi/English detection.
- Fuzzy spelling correction for common emergency terms, including typo-tolerant evacuation, flood, alert, and hazard wording.
- Hinglish vocabulary and question-pattern handling, plus extraction of all Indian states, Union Territories, and Diu as scoped locations.
- Expanded hazard taxonomy for weather, earthquake, landslide, wildfire, heatwave, tsunami, and health-outbreak alerts.
- Deterministic structured claim extraction with multiple-claim splitting.
- Optional schema-constrained local structured extraction using `Xenova/flan-t5-small`; it only fills missing fields and never produces a verdict.
- Live trusted-source fetching from the configured NDMA SACHET CAP/RSS allowlist.
- Local multilingual embedding retrieval using `@huggingface/transformers`.
- Hybrid evidence retrieval using embedding similarity plus lexical/predicate/location boosts.
- Publisher-diversified candidate retrieval with fresh-source agreement/conflict analysis; conflicting fresh trusted sources remain `not_established`.
- Lexical fallback when local embeddings are disabled or unavailable.
- Claim-evidence comparison with stale-evidence protection.
- Visible AI Evidence Analyst output: extracted fields, missing information, ranked match reasons, location/type/freshness gaps, and the evidence rule behind each verdict.
- Actionable clarification output: missing-field explanations and UI controls that focus the user on adding a claim type, location, or time instead of guessing.
- Structured CAP metadata preservation for event, area, severity, urgency, certainty, effective time, expiry, and official instructions when the feed supplies those fields.
- Evidence-linked verdicts only: `supported`, `contradicted`, `not_established`.
- Trusted-source fetch allowlist guard for future real-time official-source ingestion.
- Multilingual OCR selection with automatic English+Hindi fallback, OCR confidence/quality metadata, and local translation across supported Indian languages.

To enable the optional structured model on Windows PowerShell, set `$env:AEGIS_ENABLE_LOCAL_STRUCTURED_AI="true"` before `npm run api`. The model may download on first use and is cached under `data/structured-ai-cache/`; leave it disabled for the fast deterministic path.

Useful endpoints:

- `POST /analyze`
- `GET /health`
- `GET /sources/status`
- `GET /sources/social`
- `POST /sources/refresh`
- `GET /models/status`

## References

- [NDMA SACHET - National Disaster Alert Portal](https://sachet.ndma.gov.in/)
- [PIB Fact Check](https://factcheck.pib.gov.in/)
- [Emergency Response Support System - 112](https://112.gov.in/)
- [BHASHINI - Indian language digital public infrastructure](https://bhashini.gov.in/)
- [MeitY / PIB: framework addressing synthetic information](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2245053&lang=2&reg=48)
- [Content Credentials and provenance](https://contentcredentials.org/adopt/)
