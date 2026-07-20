# AEGIS agent instructions

Read [HANDOVER.md](HANDOVER.md) before making implementation decisions. It is the source of truth for scope, safety boundaries, architecture, test requirements, and the definition of done.

Non-negotiables:

- Build a civil-defence claim-verification product, not surveillance, enforcement, military tooling, or a generic fake-news detector.
- Every verdict must be evidence-linked and use only: `supported`, `contradicted`, or `not_established`.
- Never call missing provenance or an AI score proof that media is false.
- Ship a working local demo with tests and candid documentation. Do not invent partners, data, model accuracy, live integrations, or government affiliation.
