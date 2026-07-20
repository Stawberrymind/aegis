# AEGIS model card

## Models and adapters

- Claim extraction: deterministic multilingual rules.
- Semantic retrieval: local `@huggingface/transformers` embeddings with `Xenova/paraphrase-multilingual-MiniLM-L12-v2`.
- Verdict comparison: deterministic evidence comparator.

No paid model API is required. The local embedding model may download on first use and then run from cache.

## Intended use

AEGIS helps check crisis-related public-safety claims against trusted evidence. The embedding model improves evidence retrieval across paraphrases and Hindi/English text.

## Non-use

The system is not a fake-news detector, surveillance system, emergency authority, or deepfake proof engine. Missing provenance or weak evidence must not be treated as proof that media is false.

## Limitations

Embeddings improve semantic matching but do not prove truth. Verdicts are emitted only by deterministic code and must be linked to evidence records with source, scope, and timestamp metadata.
