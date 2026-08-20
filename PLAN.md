# Pi “Where Am I?” extension — research and plan

## Goal

Keep two short lines visible in each interactive Pi session:

```text
You: Confirmed exploring existing Pi recap extensions and planning a minimal alternative
Pi: Reviewing findings and preparing a recommendation
```

The first line interprets the latest user input in conversation context. The
second reports observable agent activity. This is primarily an in-terminal
orientation aid for users who switch among several Pi sessions.

## Existing work

There are several close Pi extensions; this is not a greenfield product area.
None provides the requested combination unchanged.

| Extension | What it already does | Why it is not the requested extension | Ideas worth carrying over |
| --- | --- | --- | --- |
| [pasky/pi-session-summary](https://github.com/pasky/pi-session-summary) | Maintains a cheap-model, one-line session summary as Pi's session name; optional widget; cost reporting | Updates after `agent_end` with a default 60-second gate; no live activity line; overall session headline rather than latest contextual request | Pi model-registry integration, simple config, cost visibility |
| [lukemelnik/pi-session-recap](https://github.com/lukemelnik/pi-session-recap) | One-line widget, bounded conversation input, branch-aware state, deterministic fallback | Refreshes after a completed run; explicitly excludes tool activity; no live status | Bounded text extraction, fallback behavior, latest-generation wins |
| [Fornace/pi-recap](https://github.com/Fornace/pi-recap) | Visually closest: always-visible goal plus recent `you`/`pi` recaps, cheap-model picker, streamed recap UI | A larger animated/history panel; current user recap sees the raw prompt without preceding context, so `yes` is ambiguous; the Pi recap starts after `agent_end`, not while tools run | Model completion plumbing, context clipping, model reasoning disabled |
| [adityavkk/pi-session-recap](https://github.com/adityavkk/pi-session-recap) | Well-tested idle/focus recap with timeout, abort, epoch, fingerprint, and stale-result protection | Designed to appear only after idle/focus conditions and to disappear during activity | Abort/epoch lifecycle pattern, output sanitization, width-safe widget |

Related tools support the event-derived half of the design:

- [Claude Code status lines](https://code.claude.com/docs/en/statusline) are
  event-driven and debounced. They can render multiple persistent lines.
- [Claude HUD](https://github.com/jarrodwatts/claude-hud) derives active tools,
  agents, and task progress from local lifecycle/transcript data instead of
  asking another LLM to infer all activity.
- [tmux-agent-status](https://github.com/samleeney/tmux-agent-status) uses agent
  hooks for `working`/`done` transitions across panes. It also demonstrates
  that a separate tmux-level view is useful when the problem is finding the
  right pane, not understanding the pane already in view.

The installed Pi 0.84.2 API already supplies the required primitives:
`input`, `before_agent_start`, `agent_*`, `tool_execution_*`, compaction and
session events; `ctx.isIdle()`/`ctx.hasPendingMessages()`; nested model calls;
and persistent `setWidget` content. The official examples demonstrate both
status and widget rendering.

## Decision

Build a fresh, small local extension and validate it before packaging it.
Do not fork one of the recap products: removing its history, focus, animation,
model-selection, and persistence behavior would be more work and risk than
implementing the two required lines directly.

Reuse documented patterns and small MIT-licensed ideas, not an existing
extension's architecture.

## V1 design

```text
accepted user input ──► cheap contextual interpreter ──► request line
Pi lifecycle events  ──► deterministic state reducer  ──► activity line
                                      │
                                      └── throttled two-line widget
```

### 1. Request line: one cheap, contextual model call

Trigger interpretation once for each accepted interactive/RPC user input. The
`input` event records the raw text and source; `before_agent_start` confirms
that Pi accepted it and starts the nested completion without blocking the main
agent. On startup/resume, at most one reconstruction call may use the latest
user input already in the active branch.

Send only:

1. the previous interpreted request, if any;
2. a clipped text block from the assistant message immediately preceding that
   user input;
3. the clipped raw user input.

Do not deliberately include system prompts, images, tool arguments/results, or
raw file payloads. Assistant prose can itself contain a code excerpt, so the
configured provider still receives that small clipped field. Ask for one short
line with no label. This gives the model enough context to turn `yes` into a
useful statement without transmitting the whole session.

V1 uses one explicitly configured `provider/model` with reasoning disabled.
If it is absent or unauthenticated, display a deterministic, clipped form of
the user's input. Do not auto-select another provider and never fall back
silently to the potentially expensive foreground model.

Only one request interpretation may be in flight. A newer accepted input
aborts or supersedes the older call; an epoch/version check discards late
results. There is no time delay and no second call after the agent settles.

### 2. Activity line: deterministic and honest

Do not spend model tokens on activity that Pi already reports precisely.
Maintain an in-flight map keyed by `toolCallId`; parallel starts and ends must
not overwrite each other.

Initial status vocabulary:

| Evidence | Display |
| --- | --- |
| Agent starts, no tool active | `Thinking / preparing next step` |
| `read`, `find`, `grep`, repository search | `Exploring the codebase` |
| Web search/fetch | `Researching` |
| `edit` or `write` | `Editing code` |
| Recognized test/build command | `Running tests` / `Building` |
| Several concurrent tools | Primary category plus `+ N other tools` |
| Tool batch ended, agent still active | `Reviewing results` |
| Compaction starts | `Compacting context` |
| A follow-up exists | Add `follow-up queued` (Pi exposes a boolean, not a count) |
| `agent_settled` and `ctx.isIdle()` | `Done — waiting for you` |
| Unknown tool | `Running <tool name>` |

`agent_end` must not mean done: Pi may retry, compact and retry, or process a
queued follow-up. `agent_settled` is the terminal signal.

This line promises observable Pi activity, not omniscience. It cannot track a
detached process after the responsible tool has completed unless that tool
continues to emit lifecycle events.

### 3. Rendering and cadence

- Keep internal state current on every event.
- Commit the latest two-line snapshot at most once every two seconds, with a
  trailing update so the final state is never lost.
- Do not stream nested-model tokens into the widget.
- Use one plain, borderless component factory whose `render(width)` returns
  exactly two lines clipped with Pi TUI width utilities.
- Use a unique widget key and clear it during `session_shutdown`.
- Treat “always visible” as a TUI-only V1 guarantee. RPC ignores component
  factories, while print/JSON modes have no persistent terminal UI.

Model-call cadence and render cadence are independent: one asynchronous model
call per accepted input; at most one widget commit per render interval.

### 4. Session safety

Maintain a session epoch and request generation number. Abort the interpreter
and invalidate pending work on session shutdown/replacement, tree navigation,
compaction, and reload. Check epoch and generation after every `await` before
performing UI side effects.

V1 does not append custom persistence entries. On `session_start`, reconstruct
a safe initial request from the active branch and show activity as idle. Add
persistence only if real use shows that reconstruction is too slow or loses
important context.

## Implementation stages

### Stage 1 — deterministic core

- Add the package skeleton and a pure activity-state reducer.
- Wire session, input, agent, tool, and compaction events.
- Add the two-line, width-safe widget and render scheduler.
- Unit-test parallel tool ordering, unknown tools, queued follow-ups,
  compaction, settle, render throttling, and teardown.
- Keep optional debug event logging inside this stage rather than building a
  separate diagnostic subsystem.

### Stage 2 — request interpreter

- Add explicit cheap-model configuration and authentication checks.
- Add bounded context extraction, prompt, timeout/abort, output normalization,
  and local fallback.
- Test contextual confirmations (`yes`, `do that`), overlapping inputs,
  missing auth, timeout, and stale results after session changes.

### Stage 3 — integration validation

- Run alongside other widget/status extensions and Pi plan mode.
- Exercise `/new`, `/resume`, `/fork`, `/tree`, `/compact`, queued steering and
  follow-ups, parallel tools, cancellation, and narrow terminals.
- Compare the result with a temporary trial of `pi-recap`; keep only behavior
  that makes orientation measurably clearer.
- Package for installation only after the local extension is useful and stable.

## Acceptance criteria

- `yes` and similarly short replies are interpreted using the immediately
  relevant assistant context.
- The interpretation model receives only the three bounded text fields above,
  never direct tool/file payloads, images, or the system prompt.
- Missing model/authentication uses a local fallback and never invokes the
  foreground model.
- Older completions cannot overwrite newer input or a replacement session.
- Parallel tools remain active until their own end events arrive.
- Done appears only after `agent_settled`/idle, not merely `agent_end`.
- The UI commits no more than once per configured render interval and still
  renders the final state.
- The widget remains exactly two clipped lines on narrow terminals.
- Resume/reload starts with reconstructed request context and never restores a
  stale “running” state.

## Panel critique and resolutions

The Sol and GLM panel seats agreed on the fresh minimal split: a model for
contextual intent and events for observable activity. The Qwen critic kept that
verdict but removed unnecessary machinery.

Resolved changes:

- Track a set of parallel tools and use `agent_settled`, not `agent_end`.
- Separate render throttling from model-call cadence.
- Use one explicit cheap model in V1 instead of an allowlist, benchmark chain,
  or role-resolution subsystem.
- Start once per accepted input, latest-wins; do not delay calls by three
  seconds or refresh again after settlement.
- Omit custom-entry persistence and transcript fingerprints in V1.
- Use the boolean text `follow-up queued`; Pi does not expose a queued-message
  count.
- Keep the widget plain and width-safe; omit animation, borders, and decoy-row
  work.
- Fold diagnostic logging into implementation rather than making it a separate
  phase.

A remaining product boundary is intentionally deferred: a widget explains the
session currently in view, but it does not create an overview of all terminals.
Pi can update the terminal title, and tmux can provide a fleet view, but both
introduce UI ownership/integration questions. Validate the two-line widget
first; add a title or tmux bridge only if locating the right pane remains the
main problem.

## Reversal conditions

- If event-derived statuses are too generic, improve the small taxonomy before
  adding a second activity-model call.
- If contextual interpretation is too slow, costly, or privacy-sensitive,
  keep deterministic request extraction and make model interpretation opt-in.
- If a persistent widget conflicts with other extensions, try below-editor
  placement or the additive footer status before replacing Pi's footer.
- If users mainly need to find which terminal needs attention, prioritize a
  terminal-title/tmux bridge as a separate feature instead of expanding the
  in-pane widget.
