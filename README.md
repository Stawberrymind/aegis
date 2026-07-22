# AEGIS

> **An AI evidence layer that helps citizens verify harmful crisis claims before forwarding them as fact.**

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Local AI](https://img.shields.io/badge/AI-local%20models-7C3AED?logo=huggingface&logoColor=white)](#what-the-ai-does)
[![Live sources](https://img.shields.io/badge/sources-live%20allowlist-0E7490)](#trusted-evidence)
[![OCR](https://img.shields.io/badge/OCR-Tesseract.js-2563EB)](#what-the-ai-does)
[![API tests](https://img.shields.io/badge/API%20tests-49%20passing-16A34A)](#tests)
[![Browser tests](https://img.shields.io/badge/browser%20tests-3%20passing-16A34A)](#tests)
[![Competition prototype](https://img.shields.io/badge/status-competition%20prototype-D97706)](#competition-status)
[![GitHub repository](https://img.shields.io/badge/GitHub-Stawberrymind%2Faegis-181717?logo=github&logoColor=white)](https://github.com/Stawberrymind/aegis)

AEGIS is a local-first, multilingual crisis-claim verification demonstrator for India. A user can submit a forwarded message, image, or PCM WAV voice note; AEGIS extracts the claim, checks allowlisted official sources, and explains whether the available evidence **supports**, **contradicts**, or **does not establish** the claim.

AEGIS is designed for civil-defence information resilience. It is not an emergency authority, a surveillance tool, a universal fake-news detector, or a deepfake verdict engine.

## Competition status

The repository contains a working competition prototype with:

- Local AI for multilingual normalization, typo-tolerant claim extraction, translation, semantic retrieval, OCR, and optional voice transcription.
- Real-time fetching from configured NDMA SACHET and India Meteorological Department feeds.
- Evidence-linked verdicts with freshness, type, location, source-diversity, and conflict safeguards.
- Upload support for PNG, JPEG, WebP images and PCM WAV voice notes.
- All Indian states and Union Territories, including Diu, in the location selector.
- A four-step interface: **Add claim -> Set context -> Check -> Review**.
- Normal and Expert modes, an analysis timeline, source status, and evidence explanations.
- No paid model API key required.

The current validation baseline is 49 API tests and 3 Playwright browser tests passing locally.

## The problem

During a crisis, people receive messages claiming that an evacuation order, road closure, weather warning, public-authority announcement, donation request, or official statement is real. The useful question is not simply "is this fake?" It is:

> What does trusted evidence say about this exact claim, location, and time?

AEGIS makes that question easier to answer while preserving uncertainty.

## Verdicts

AEGIS uses only three verdicts:

| Verdict | Meaning |
| --- | --- |
| `supported` | Fresh, relevant trusted evidence directly supports the material claim. |
| `contradicted` | Fresh, relevant trusted evidence directly conflicts with the material claim. |
| `not_established` | Evidence is missing, stale, conflicting, weak, or otherwise insufficient. |

The system never displays a binary `REAL` / `FAKE` badge. A high similarity score is not treated as proof, and missing media provenance is not treated as proof that an image is false.

## What the AI does

AEGIS uses AI where it is useful and deterministic safety rules where a verdict must be controlled.

```text
Text / image / voice note
          |
OCR, transcription, language detection, normalization
          |
Structured claim extraction: incident, place, time, action, language
          |
Local multilingual embeddings and lexical retrieval
          |
Evidence comparison and freshness/location/type safeguards
          |
Evidence-linked verdict, explanation, sources, and safe action
```

### AI and model layers

- **Claim understanding:** deterministic multilingual rules, spelling correction, Hinglish patterns, Indian location recognition, and multiple-claim splitting.
- **Optional structured AI:** schema-constrained local `Xenova/flan-t5-small` extraction fills only missing fields. It cannot produce a verdict.
- **Semantic retrieval:** local `Xenova/paraphrase-multilingual-MiniLM-L12-v2` embeddings rank paraphrased evidence. A lexical fallback remains available.
- **OCR:** local Tesseract.js for image text, with language selection, English/Hindi fallback, confidence, and quality metadata.
- **Translation:** local Transformers.js adapters translate supported Indian-language text into English for retrieval when needed.
- **Voice:** local Transformers.js Whisper adapter for PCM WAV transcription.
- **Media provenance:** C2PA inspection reports supported provenance metadata when present. A manual OpenAI Verify link is provided for OpenAI-specific provenance signals; this is not a general AI-image detector.
- **Verdict logic:** deterministic evidence comparison. AI ranking scores help find candidates but do not decide the final verdict.

See the [model card](docs/model-card.md) for intended use, non-use, and limitations.

## Trusted evidence

AEGIS does not search the open web and never fetches arbitrary URLs supplied by users. It fetches only sources defined in [data/sources/allowlist.json](data/sources/allowlist.json).

### Enabled by default

- [NDMA SACHET India CAP RSS](https://sachet.ndma.gov.in/)
- India Meteorological Department CAP RSS
- India Meteorological Department district nowcast RSS

### Optional extended sources

- [PIB Fact Check](https://factcheck.pib.gov.in/)
- Goa State Disaster Management Authority public advisories
- Meghalaya State Disaster Management Authority public advisories

Optional sources are disabled by default because public pages can change structure or require access controls. AEGIS never bypasses CAPTCHA, login requirements, or source restrictions.

Official IMD, NDMA, and NDRF social handles are available as reference metadata. Official X API integration is optional, requires a bearer token, and treats posts as candidate context rather than sole proof. Scraping is disabled.

### Live-only runtime policy

Normal runtime uses validated live records and, when a source is temporarily unavailable, a bounded cache labelled `live_cache`. It does not load demo records in the browser runtime. Repository fixtures are used only in deterministic automated tests.

Every source record is validated for source identity, HTTPS, host allowlisting, content type, size, timestamp, parser output, freshness, and scope. Undated or stale records cannot establish a current emergency instruction.

## Safety and privacy boundaries

AEGIS:

- Does not replace NDMA, IMD, 112, PIB, local authorities, or emergency services.
- Does not issue autonomous emergency instructions.
- Does not identify or accuse people, accounts, communities, or organisations.
- Does not scrape social media or private groups.
- Does not send a user's submission to an external AI model by default.
- Processes uploaded media in memory and does not retain it by default.
- Uses an in-memory rate limiter and bounded request/upload limits.
- Shows uncertainty when trusted sources disagree or evidence is insufficient.

For an imminent emergency, contact the relevant official authority, including [112](https://112.gov.in/) where appropriate.

Read [privacy and safety](docs/privacy-and-safety.md), [data card](docs/data-card.md), and [media inspection](docs/media-inspection.md) for more detail.

## Run locally

### Requirements

- Node.js 20 or newer
- Internet access for live source feeds and first-run model downloads
- No paid API key

### Install

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
cd aegis
npm ci
```

### Start the app

```bash
npm run api
```

Open [http://localhost:8787](http://localhost:8787).

The same Node process serves the browser UI and API. The secure default binds to `127.0.0.1`, so the app is private to the local machine.

### First analysis

The first analysis with local embeddings enabled may download the embedding model. Later runs reuse the local cache. The optional structured extractor and Whisper adapter may also download models on first use.

Try a location-scoped claim:

```text
Is there a rain alert in Diu today?
```

Choose **Diu**, click **Check this claim**, then inspect the Answer, Understanding, Evidence, Timeline, and Expert tabs.

### Command-line analysis

```bash
npm run demo:analyze -- "Is there a weather alert in India today?"
```

The CLI is useful for smoke testing. The browser UI is the intended competition demonstration path.

## Configuration

The complete configuration reference is [.env.example](.env.example). The normal defaults require no environment variables.

For Windows PowerShell, set optional values for the current terminal session like this:

```powershell
$env:AEGIS_ENABLE_LOCAL_STRUCTURED_AI="true"
$env:AEGIS_ENABLE_EXTENDED_SOURCES="true"
npm run api
```

Important settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AEGIS_LIVE_FETCH` | `true` | Enable allowlisted real-time source fetching. |
| `AEGIS_USE_FIXTURES` | `false` | Test-only fixture mode; keep false for the normal live demo. |
| `AEGIS_ENABLE_LOCAL_EMBEDDINGS` | `true` | Enable local semantic retrieval. |
| `AEGIS_ENABLE_LOCAL_STRUCTURED_AI` | `false` | Enable optional schema-constrained structured extraction. |
| `AEGIS_ENABLE_EXTENDED_SOURCES` | `false` | Enable optional PIB and state-advisory adapters. |
| `AEGIS_ENABLE_SOCIAL_API` | `false` | Enable the official X API adapter when a token is configured. |
| `AEGIS_X_BEARER_TOKEN` | unset | Secret X API bearer token; never commit it. |
| `AEGIS_API_HOST` | `127.0.0.1` | Bind host. Use `0.0.0.0` only for an intentional hosted deployment. |
| `AEGIS_ALLOWED_ORIGINS` | same-origin only | Comma-separated allowed browser origins for a separate frontend. |

Do not put secrets in the repository. `.env` files are ignored by Git; `.env.example` contains documentation only.

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/analyze` | Analyze text, image, or voice input. |
| `GET` | `/health` | Service health check. |
| `GET` | `/models/status` | Local model and media adapter status. |
| `GET` | `/sources/status` | Latest source refresh status. |
| `GET` | `/sources/history` | Bounded source-fetch history. |
| `GET` | `/sources/catalog` | Configured source policy and metadata. |
| `GET` | `/sources/social` | Reference metadata for official social handles. |
| `GET` | `/sources/social/status` | Official social API configuration status. |
| `POST` | `/sources/refresh` | Manually refresh allowlisted sources. |

## Tests

Run the API, hardening, extraction, and evaluation tests:

```bash
npm test
```

Run the browser tests:

```bash
npm run test:web
```

Run everything:

```bash
npm run test:all
```

The Playwright suite covers claim submission, location selection, OCR input, Normal/Expert mode, result tabs, timeline rendering, accessible controls, and mobile layout. Its local web server starts the API automatically.

## Repository layout

```text
apps/web/                 Browser UI: HTML, CSS, and JavaScript
services/api/src/         Node API and AI/evidence pipeline
data/sources/             Trusted-source allowlist and social metadata
data/evidence/            Test-only evidence fixtures
data/*-cache/             Ignored runtime model/source caches
docs/                     Architecture, model, data, privacy, and demo documentation
tests/api/                Pipeline, security, source, and evaluation tests
tests/web/                Playwright browser tests
```

## Competition demo

Use the [90-second demo script](docs/demo-script.md):

1. Start the API and open the browser UI.
2. Submit a location-scoped weather question.
3. Show what AEGIS understood before showing the verdict.
4. Open Evidence to show trusted-source records and freshness.
5. Open Timeline to show the analysis process.
6. Switch to Expert mode to show retrieval, OCR, provenance, and policy detail.
7. Explain that the AI finds meaning and ranks evidence, while deterministic evidence rules produce the verdict.

## Known limitations

- The local extractor and translation adapters are not complete understanding of every Indian language or dialect.
- OCR quality depends on resolution, script, image layout, and model availability.
- Voice transcription currently accepts PCM WAV files only.
- Local models can create a slow first request and require local cache storage.
- Source coverage is intentionally allowlisted and narrower than the open web.
- Public feeds can be unavailable, malformed, delayed, or changed by their publishers.
- Source history and runtime caches are local/ephemeral; no production database is included.
- The in-memory rate limiter is appropriate for a local or controlled competition demo, not a high-traffic public service.
- C2PA or OpenAI Verify signals do not prove that a claim is true or that media is AI-generated.

AEGIS should be presented as a responsible, evidence-linked competition prototype - not as production emergency infrastructure.

## Further documentation

- [Handover and product contract](HANDOVER.md)
- [Architecture](docs/architecture.md)
- [Model card](docs/model-card.md)
- [Data card](docs/data-card.md)
- [Trusted-source fetching](docs/source-fetching.md)
- [Source history](docs/source-history.md)
- [Privacy and safety](docs/privacy-and-safety.md)
- [Media inspection](docs/media-inspection.md)
- [Voice transcription](docs/voice-transcription.md)
- [Evaluation plan](docs/evaluation.md)

## Pitch

> AEGIS is an AI evidence layer that helps citizens verify harmful crisis claims in their own language before they are forwarded as fact.

AI is useful here because multilingual extraction, OCR/transcription, paraphrase-aware retrieval, and evidence explanations are difficult to deliver with keyword rules alone. AEGIS remains responsible by separating AI interpretation from the final evidence decision and preferring `not_established` over unsupported certainty.
