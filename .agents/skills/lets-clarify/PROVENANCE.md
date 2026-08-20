# Provenance

## Intent

Provide one focused clarification workflow for a concrete plan, design, decision, or change without competing grilling or domain-document systems.

## Sources

The original catalog skill was self-written. The 2026 source review consulted these skills from `mattpocock/skills` at commit `8b78b531ab965735c5dc74f6f7a219e1e37326df`:

- `grilling`
- `grill-me`
- `grill-with-docs`
- `domain-modeling`

The 2026 system-areas revision additionally consulted `addyosmani/agent-skills` at commit
`df1edb2e05487d0aa6d93c747141e0aed1187f25`:

- `doubt-driven-development`

## Durable decisions

- Keep one question at a time for dependent decisions. Batch questions only when they are
  independent and can be answered against the same settled prerequisites.
- Preserve dependency ordering, fact investigation, recommendations, shared understanding, and explicit acceptance criteria from the existing workflow.
- Use project vocabulary and clarify ambiguous terms before recording them.
- Write decisions into the project's existing authoritative structure. Do not require `CONTEXT.md`, `docs/adr`, or another fixed layout.
- Document only after decisions settle and after the user approves named files.
- Keep `wayfinder` separate for initiatives that span several pull requests or sessions.
- Reject separate grilling aliases and router skills because they create overlapping triggers and hidden dependencies.
- Separate the areas that describe the decision from the areas that describe the system.
  Prior implementation reviews repeatedly found code correct against what was written while
  the defect lay in a dimension the specification never named, including prior data,
  consumers of altered state, and accepted input forms.
- Treat prior states and consumers as contract evidence, then derive observable acceptance
  criteria from them so a test-first cycle can generate tests and a reviewer can check the
  required behavior.
- Treat scope exclusion as excluding implementation, not consequence. Code excluded from the
  work still needs a criterion when it reads state or a contract the change alters.
- State each acceptance criterion with its bound, because a criterion with no stated
  boundary invites over-application.
- Before closing, ask what important scenario, affected party, or consequence has not yet
  been covered. The named system areas record known failure shapes and cannot anticipate the
  next one.
- Adapt the risk emphasis from `doubt-driven-development` into explicit checks for changes
  to state, lifecycle, compatibility, externally consumed contracts, shared resources,
  concurrency, and accepted input. Investigate uncertain applicability rather than relying
  on an initial estimate of material risk. Reject mandatory fresh-context review inside
  clarification because it would turn a requirements interview into an artifact-review
  workflow and overlap the catalog's separately owned review phase.
