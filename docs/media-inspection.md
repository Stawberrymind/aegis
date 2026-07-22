# Media inspection

AEGIS accepts PNG, JPEG, and WebP uploads up to 8 MB. The API processes them locally and does not send user media to OpenAI or to trusted-source websites.

## OCR

`Tesseract.js` is the open-source OCR adapter. It runs in the Node service and selects an Indian-language Tesseract model from the user’s language choice; with automatic language selection it uses English+Hindi OCR. The response includes OCR confidence and a coarse quality band for review. The OCR text is passed into the same claim extraction, live retrieval, and evidence-verdict pipeline as typed text. OCR failure is represented as `unavailable` or `no_text_found`; AEGIS never invents replacement text.

## Provenance

`@contentauth/c2pa-node` checks for embedded C2PA Content Credentials. A detected manifest is a provenance signal, not proof that the accompanying crisis claim is accurate or correctly contextualized. No manifest is reported as `not_detected`, never as “real” or “fake”.

The UI links to [OpenAI Verify](https://openai.com/research/verify/) as a manual secondary check. OpenAI Verify checks OpenAI-origin signals such as C2PA and SynthID; it is not a documented general-purpose image-detector API and does not detect images made by every AI system.

Neither OCR nor provenance inspection changes AEGIS’s three allowed verdicts. Only fresh, directly matching trusted evidence can produce `supported` or `contradicted`; otherwise the result is `not_established`.
