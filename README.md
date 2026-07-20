# AEGIS

> **AI Crisis-Claim Verification for India**

AEGIS is a privacy-first, multilingual AI product for checking high-harm public-safety claims received through text, images, videos, and voice notes. It does not try to be a universal "truth machine". It turns a message into specific claims, searches an approved evidence collection, and reports whether each claim is **supported**, **contradicted**, or **not established**.

The project is framed as **civil defence and national resilience**: helping citizens, volunteers, and community organisations resist harmful misinformation, impersonation, and panic during emergencies or sensitive events.

## Why this exists

India already has official emergency infrastructure. NDMA's [SACHET](https://sachet.ndma.gov.in/) disseminates geo-targeted official alerts, and the [PIB Fact Check portal](https://factcheck.pib.gov.in/) accepts suspicious information for verification. AEGIS is deliberately not another alerting or reporting platform. Its role is the missing interpretation step: a person should be able to paste the confusing message they received and see clear, cited, plain-language evidence.

The problem is current and concrete. Government guidance identifies misinformation and synthetically generated content, including deepfakes, as risks to a safe and trusted digital ecosystem. See the [MeitY / PIB update from March 2026](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2245053&lang=2&reg=48).

## Product promise

Given a user submission, AEGIS will:

1. Accept typed text, an image, or a short voice note in a supported language.
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

For media, AEGIS may inspect available provenance such as [Content Credentials](https://contentcredentials.org/adopt/) and report the result precisely: for example, *valid provenance found*, *provenance unavailable*, or *provenance invalid*. The absence of provenance is **not** proof that media is synthetic or false.

## Demo scope - first release

The first working demo is intentionally narrow and credible:

- **Languages:** English and Hindi, with an architecture that can add more Indian languages.
- **Inputs:** typed text and image OCR; voice-note transcription is a stretch only if it is tested end to end.
- **Evidence base:** a small, curated, versioned fixture set of public official notices and fact-check records. No undocumented live scraping.
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

The intended stack is a React/TypeScript web client, a Python FastAPI service, local development fixtures, and a pluggable retrieval layer. See [HANDOVER.md](HANDOVER.md) for the implementation contract.

## Responsible AI controls

- Evidence-first responses: every factual verdict links to the evidence used.
- Fixed verdict vocabulary: no free-form "fake" accusations.
- Human-readable uncertainty and confidence explanations.
- Private-by-default processing and deletion controls.
- No identity, demographic, or political inference.
- Test cases for Hindi and English, contradictory evidence, missing evidence, OCR failure, and unsafe prompt-style inputs.
- A visible disclaimer directing imminent emergencies to official channels such as [112](https://112.gov.in/).

## Project status

This repository now contains a working AI verification core and a small browser UI. It does not require a paid API key. It extracts structured claims, fetches an allowlisted live official CAP/RSS source, uses local multilingual embeddings for semantic retrieval when available, falls back to lexical retrieval when needed, compares claims with evidence assertions, and returns only `supported`, `contradicted`, or `not_established`.

Python is not available in the current workspace, so the first working service is implemented with Node's built-in HTTP server instead of FastAPI. The API contract and service layout are kept simple so it can be ported to FastAPI later.

## Run locally

Prerequisite: Node.js 20 or newer.

Install step is not required because the current demo uses no third-party npm dependencies.

Start the API:
Start the local app:

```bash
npm run api
```

Open `http://localhost:8787` in a browser and submit one of the demo claims. The same Node process serves both the API and the static web UI.

The first analysis with local AI embeddings enabled may download the local model `Xenova/paraphrase-multilingual-MiniLM-L12-v2`. After that, cached model files are reused by Transformers.js.

Run a command-line analysis:

```bash
npm run demo:analyze -- "Sector 4 evacuation ordered tonight. Leave before 9 PM."
```

Run tests:

```bash
npm test
```

## Implemented AI pipeline

- Multilingual text normalization and Hindi/English detection.
- Deterministic structured claim extraction with multiple-claim splitting.
- Live trusted-source fetching from the configured NDMA SACHET CAP/RSS allowlist.
- Local multilingual embedding retrieval using `@huggingface/transformers`.
- Hybrid evidence retrieval using embedding similarity plus lexical/predicate/location boosts.
- Lexical fallback when local embeddings are disabled or unavailable.
- Claim-evidence comparison with stale-evidence protection.
- Evidence-linked verdicts only: `supported`, `contradicted`, `not_established`.
- Trusted-source fetch allowlist guard for future real-time official-source ingestion.

Useful endpoints:

- `POST /analyze`
- `GET /health`
- `GET /evidence`
- `GET /sources/status`
- `POST /sources/refresh`
- `GET /models/status`
- `GET /demo/scenarios`

## References

- [NDMA SACHET - National Disaster Alert Portal](https://sachet.ndma.gov.in/)
- [PIB Fact Check](https://factcheck.pib.gov.in/)
- [Emergency Response Support System - 112](https://112.gov.in/)
- [BHASHINI - Indian language digital public infrastructure](https://bhashini.gov.in/)
- [MeitY / PIB: framework addressing synthetic information](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2245053&lang=2&reg=48)
- [Content Credentials and provenance](https://contentcredentials.org/adopt/)
