# Provenance

## Intent

Provide a portable editing workflow for substantive prose that removes generic AI patterns while preserving meaning and producing clear, natural, simple English.

## Source

- Repository: <https://github.com/cursor/plugins>
- Source area: `pstack/skills/unslop`
- Reviewed revision: `fd6dd6f7276956a532bb78a748a8d2818b6eb5f4`
- License: MIT, copyright Lauren Tan

The catalog skill is an independent adaptation, not a maintained copy of pstack.

## Durable decisions

- Preserve pstack's scan, rewrite, add-voice, and self-audit loop plus its concrete catalog of common AI-writing patterns.
- Trigger automatically for substantive prose artifacts and explicitly for requests to unslop, tighten, humanize, or deslop writing. Do not load for routine status messages or code-only work.
- Add voice rather than fictional content. Permit rhythm, direct supported judgment, first person, and natural structure without inventing facts, opinions, preferences, experiences, or deliberate disorder.
- Apply Simplified Technical English principles without claiming formal ASD-STE100 compliance or forcing uniformly short, sterile prose.
- Treat vocabulary, punctuation, and structural patterns as contextual warning signals rather than absolute bans.
- Preserve exact technical terms, quotations, citations, code, commands, paths, identifiers, literal strings, and measured values.
- Return improved prose directly by default. Explain only ambiguity, factual risk, or possible meaning changes unless the user requests an editorial review.
- Keep the skill portable and independently useful. It does not require another skill, tool, or client-specific invocation field.

Future source reviews should preserve these decisions unless a deliberate catalog change records new rationale.
