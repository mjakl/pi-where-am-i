---
name: unslop
description: Use automatically when drafting or substantively revising prose such as documentation, reports, explanations, issues, pull-request text, release notes, or Agent Skills, or when the user asks to unslop, deslop, tighten, or humanize writing. Do not use for routine status messages or code-only work.
---

# Unslop

Write prose that sounds authored rather than generated. Make it direct, specific, and natural without inventing personality or flattening every text into the same voice.

## Workflow

1. Identify the artifact, audience, purpose, intended tone, and facts that must survive.
2. Protect exact content before rewriting: quotations, citations, code, commands, identifiers, paths, UI text, numbers, and necessary technical terms.
3. Draft or rewrite for meaning first. Remove words and structure that do not help the reader.
4. Scan for the warning signals below. Fix the ones that make this text generic, vague, inflated, or mechanical.
5. Add voice without adding fictional content. Read the result as a person in the intended audience and revise anything sterile or performative.
6. Verify that the result preserves the original claims and constraints, uses simple English, and still fits the artifact.

## Add voice, not fictional content

Rewrite freely for clarity, rhythm, emphasis, and natural flow.

- Vary sentence length. Short sentences can land a point. Longer sentences can carry one idea with its condition or consequence.
- State a supported judgment directly instead of hiding it behind a neutral list of possibilities.
- Use first person when it fits the author and artifact.
- Name real tension or complexity when the evidence supports it.
- Prefer concrete mechanisms, examples, and consequences over generic feelings.
- Let structure follow the material. Do not force every answer into the same number of headings or bullets.

Do not invent facts, preferences, experiences, controversy, or confidence. Do not add mistakes, disorder, or awkwardness merely to imitate a human.

## Use simple English

Apply Simplified Technical English principles without claiming formal ASD-STE100 compliance.

- Prefer common, precise words.
- Use active voice when the actor matters.
- Keep one main idea in each sentence.
- Put a condition before the instruction or claim it limits.
- Use one consistent term for each concept.
- Make pronouns and references point to one clear subject.
- Keep necessary technical vocabulary when it is the most precise language.
- Split a sentence when a reader must backtrack to parse it.

Simple English does not require uniformly short sentences, a childish tone, or removal of exact domain terms.

## Inspect warning signals in context

Treat these patterns as reasons to inspect a sentence, not as forbidden tokens. Keep a pattern when it is precise, natural, and appropriate here.

### Empty or inflated content

- **Puffery and promotion:** “pivotal,” “groundbreaking,” “vibrant,” “testament to,” or similar claims without evidence. State what happened and why it matters.
- **Vague attribution:** “experts believe,” “reports suggest,” or “critics argue” without a named source. Name the source, mark the claim as inference, or remove it.
- **Superficial participles:** trailing phrases such as “highlighting,” “ensuring,” or “showcasing” that add no mechanism or evidence. Delete them or make the relationship explicit.
- **Formulaic contrast:** “despite challenges,” “not just X but Y,” and tidy challenge-resolution stories that flatten real trade-offs. State the actual relationship.
- **Generic conclusions:** “the future looks bright,” “this is concerning,” or a summary that could fit any project. End with a specific fact, consequence, decision, or next action.
- **Portable claims:** a sentence that could appear unchanged in another project may say nothing about this one. Add the real symbol, behavior, number, or example, or cut it.

### Generated-sounding language

- **Stock vocabulary:** additionally, crucial, delve, enhance, foster, garner, intricate, landscape, pivotal, showcase, tapestry, testament, underscore, and similar words used as decoration. Prefer the plain word that names the action.
- **Fancy forms of “is” or “has”:** “serves as,” “stands as,” “boasts,” and “features” often hide a simple statement.
- **Abstract metaphor nouns:** substrate, nexus, vector, north star, flywheel, scaffolding, endgame, or similar metaphors when a concrete technical term exists.
- **Synonym cycling:** several names for one concept. Pick the project’s term and repeat it.
- **False ranges and forced groups:** “from X to Y” without a real scale, or ideas padded into a group of three. Use the natural relationship and count.
- **Weak verbs supported by adverbs:** replace “significantly improves” with the measured change, or choose the verb that states what happened.

### Mechanical presentation

- Repeated em dashes, colons, parentheses, or semicolons used as a default sentence structure.
- Bold labels that merely repeat the sentence beneath them.
- A heading for every small thought, title case everywhere, or decorative emoji.
- Consecutive paragraphs with identical length and syntax.
- Bullets used for prose that has a causal or narrative flow.

Use punctuation and structure when they clarify the text. The problem is repetition without purpose, not the mark itself.

### Chatbot behavior

Remove empty openings and closings such as “Of course,” “Great question,” “I hope this helps,” and “Let me know if you need anything else.” Remove sycophantic agreement. Answer directly.

Cut filler such as “in order to,” “due to the fact that,” and “it is important to note that.” Reduce stacked hedges to the uncertainty the evidence actually warrants.

## Preserve the artifact

- Do not rewrite quoted material silently.
- Do not alter code, commands, paths, identifiers, literal strings, citations, or measured values as a style edit.
- Do not replace a precise technical term merely because it appears on a warning list.
- Keep dry reference material factual, but do not make it robotic.
- Keep procedures unambiguous, but do not pad them with explanation.
- Preserve deliberate authorial choices unless they obstruct the stated goal.

When the source contains an ambiguity or unsupported claim that rewriting cannot resolve safely, surface it instead of guessing.

## Return the result

For supplied text, return the improved text. For an authorized workspace edit, update the requested artifact. Do not append a style lecture or enumerate every removed pattern.

Explain only unresolved ambiguity, factual risk, or a change that could affect meaning. Provide a separate editorial review only when the user asks for analysis rather than rewriting.
