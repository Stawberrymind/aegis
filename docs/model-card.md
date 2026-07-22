# AEGIS model card

## Models and adapters

- Claim extraction: deterministic multilingual rules, with an optional schema-constrained `Xenova/flan-t5-small` local text-to-JSON adapter for filling fields the rules could not identify.
- Semantic retrieval: local `@huggingface/transformers` embeddings with `Xenova/paraphrase-multilingual-MiniLM-L12-v2`.
- Media intelligence: local Tesseract.js OCR with selected-language or automatic English+Hindi processing, a low-confidence fallback pass, and local Transformers.js Whisper transcription for PCM WAV voice notes; OCR/transcription confidence is a quality signal, not a truth signal.
- Verdict comparison: deterministic evidence comparator.
- Explanation layer: deterministic templates derived from structured extraction, retrieval signals, evidence assertions, and freshness checks.

No paid model API is required. The local embedding model may download on first use and then run from cache.
The optional structured extractor is disabled by default; when enabled with `AEGIS_ENABLE_LOCAL_STRUCTURED_AI=true`, it may download its model on first use and caches it under `data/structured-ai-cache/`.
The voice adapter uses `Xenova/whisper-tiny` by default and caches model files under `data/transcription-cache/`. It accepts PCM WAV only in this release and returns an explicit unavailable state for other audio formats.

## Intended use

AEGIS helps check crisis-related public-safety claims against trusted evidence. The embedding model improves evidence retrieval across paraphrases and Hindi/English text.

The visible AI Evidence Analyst reports what was extracted, which candidate records were ranked, why each candidate matched, and which limitations prevented it from counting as verdict evidence. These are structured diagnostics, not hidden chain-of-thought or free-form model conclusions.

## Non-use

The system is not a fake-news detector, surveillance system, emergency authority, or deepfake proof engine. Missing provenance or weak evidence must not be treated as proof that media is false.

## Limitations

Embeddings improve semantic matching but do not prove truth. Verdicts are emitted only by deterministic code and must be linked to evidence records with source, scope, and timestamp metadata.

When multiple fresh trusted publishers directly address the same claim, AEGIS shows their consensus. If one asserts the claim and another negates it, AEGIS returns `not_established` rather than choosing the higher-scoring record.

Embedding and lexical values are ranking signals, not calibrated truth probabilities. A candidate can have high semantic similarity and still be excluded because its location differs, its assertion concerns another claim type, or it is stale. The UI states this explicitly.

The deterministic extractor has a limited hazard vocabulary. The optional structured model can fill missing predicate, location, or time fields, but its output is enum-validated, never used as evidence, and never allowed to determine a verdict. The live-feed adapter recognizes common weather terms across several Indian scripts, but this is not comprehensive language understanding. Unrecognized incidents are shown as an unclassified crisis claim and should prompt the user for a clearer incident type rather than producing a confident verdict.

OCR and translation quality varies with image resolution, script, code-switching, and model availability. Translation now processes bounded sentence chunks to reduce truncation, but users should compare the original wording whenever a date, place, person, or number affects safety.
