---
name: lets-clarify
description: Use when the user says "let's clarify" or asks to resolve or refine one focused plan, decision, design, or change before action, for example to test assumptions and trade-offs, define acceptance criteria, or record settled decisions. Do not use for an initiative spanning multiple pull requests or work sessions.
---

# Let's Clarify

Interview the user systematically until the important requirements, constraints, assumptions, trade-offs, and unresolved decisions are clear.

Order decisions by dependency. Discuss a decision only after its prerequisites are settled. Do not proceed while an unresolved decision blocks the next action.

Investigate facts available in project files, documentation, tools, or external sources. Ask the user for decisions, preferences, and facts that cannot be discovered safely.

Use the project's established vocabulary. When one term hides several meanings, clarify the distinction before continuing. Update an existing glossary only after the meaning is settled and the user approves the edit.

## Core workflow

1. Identify unresolved decisions and their dependencies.
2. Choose a decision whose prerequisites are settled.
3. Ask one question at a time. Batch questions only when they are independent and can be answered against the same settled prerequisites.
4. Recommend an answer when evidence supports one. Otherwise, give a small set of concrete options and explain what is unknown.
5. Examine the answer before moving to another topic.
6. Ask the user to clarify uncertain answers. Point out contradictions, missing constraints, and undefined trade-offs.
7. Continue until no currently identified unresolved decision blocks the next action.
8. Check every applicable system dimension below. Turn relevant evidence into bounded, observable acceptance criteria; ask about missing behavior instead of treating facts as criteria. If this raises a new decision, return to step 2.
9. Before closing, ask what important scenario, affected party, or consequence has not yet been covered. If this raises a new decision, return to step 2.
10. Once no unresolved decision blocks the next action and the acceptance criteria are clear, present a concise statement of shared understanding. Ask the user to confirm it before acting.

If the user asks to stop the interview, proceed, or change the task, follow that request. Briefly state any unresolved issue that could change the next action.

## Question rules

- Ask concrete questions instead of abstract questions.
- Provide a recommended answer or a specific proposal when useful.
- Do not require the user to supply facts that you can discover.
- Do not accept uncertain words such as "probably," "later," or "something like that" when the uncertainty affects the decision.
- Ask what must be true for an answer to remain valid.
- Do not replace progress with repeated summaries.

## Areas to examine

### The decision

Use only the areas relevant to the decision:

- **Outcome:** What observable result defines success?
- **Intent:** Why does this result matter?
- **Constraints:** What limits cannot change?
- **Assumptions:** What must be true for the plan to work?
- **Alternatives:** What is the strongest alternative, and why is it not preferred?
- **Dependencies:** Which decisions must be made first?
- **Trade-offs:** What is being optimized, and what cost or limitation is acceptable?
- **Failure modes:** What likely event would make the plan fail?
- **Scope:** What work is explicitly excluded?
- **Reversibility:** How difficult or costly is the decision to reverse?
- **Acceptance criteria:** How will the user verify that the next action is complete?

### The system

For any proposed system change, check whether it alters stored state, lifecycle transitions, compatibility, an externally consumed contract, a shared resource, concurrency behavior, or accepted input. Examine every dimension that it alters. If applicability is uncertain, investigate rather than skip it. Establish prerequisite decisions first. Batch only dimensions that are independent for this change.

Investigate prior states and consumers from the project where possible. Their identities are contract evidence, not acceptance criteria. Use that evidence to ask what observable behavior is required:

- **Prior states:** What states can existing data already be in, including states written by an earlier version, and what must happen for each supported state?
- **Interruption:** For each settled transition, what can an interruption between the commit and its effect leave behind, and what recovery behavior is required?
- **Consumers:** What reads the state or contract this change alters, including code excluded by the scope above, and what must each affected consumer continue to observe?
- **Accepted input:** What forms must this accept, and what must it reject?
- **Concurrency:** What runs at the same time, and what ordering must hold?

Excluding work from scope excludes it from implementation, not from consequence. When excluded code reads state or a contract this change alters, its required behavior still needs an acceptance criterion.

State each acceptance criterion with its bound: what must happen, where it applies, and where it must not happen.

## Documentation handoff

Do not make documentation the first question about the main task.

When the discussion creates durable project knowledge and the user did not specify an output, ask once whether to keep the result in the conversation or update project documentation. Recommend the most suitable option. If the user does not choose, keep it in the conversation.

Do not edit documentation while decisions are still changing.

After the user confirms the shared understanding:

1. Summarize the decisions and their reasons.
2. Prefer an existing authoritative document.
3. Propose a separate decision record only for a decision that is difficult to reverse, surprising without context, and based on a real trade-off.
4. State the files you propose to change and obtain confirmation before editing them.

If the user already asked for documentation changes, do not ask again whether to document the result.
