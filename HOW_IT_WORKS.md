# How pi-where-am-i works

This document is for maintainers and coding agents. The [README](README.md)
contains the user-facing explanation, installation steps, and configuration.

## Design

The extension combines conversation text with observed lifecycle events:

```text
accepted user input ──► optional text model ──► request line
final assistant text ─► optional text model ──► completed outcome
Pi and tool events ───► activity reducer ─────► live activity
process lifecycle ────► tracked process map ─► background status
                                                   │
                                                   └──► throttled adaptive widget
```

A model is useful for resolving conversational shorthand and tightening a final
outcome. Pi's events are a better source for current activity because they are
cheaper and more precise. The extension does not ask a model to infer whether a
tool or process is running.

The implementation follows these rules:

1. The request model is optional and explicit. Never substitute the foreground
   model or auto-select another model.
2. Send bounded conversation text, not the whole session.
3. Show a local request label before waiting for a model response.
4. Let only the latest accepted input update the request line.
5. Track each active tool by `toolCallId` so parallel calls cannot erase one
   another.
6. Keep managed processes visible after their `process start` tool call ends.
7. Report completion only after `agent_settled`, `ctx.isIdle()`, and no tracked
   process remains.
8. Summarize a completed turn from bounded assistant text, never tool results.
9. Keep the request and intermediate activity to one row each; let only a
   completed outcome wrap, with a three-row cap.
10. Clear timers, pending requests, and the widget when the session runtime ends.

## Source map

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Extension registration, lifecycle wiring, input queues, cancellation, and session cleanup |
| `src/config.ts` | Configuration path, parsing, and validation |
| `src/conversation.ts` | Transcript text extraction, one-line normalization, clipping, and local fallback |
| `src/request-interpreter.ts` | Model lookup, authentication, bounded request and outcome prompts, and nested completion |
| `src/activity.ts` | Pure activity reducer, tool and managed-process tracking, and display text |
| `src/widget.ts` | Conditional outcome wrapping and trailing render throttle |
| `test/*.test.ts` | Unit and mocked lifecycle coverage |

Pi loads `src/index.ts` directly from the `pi.extensions` entry in
`package.json`; there is no build output.

## Request line

### Input timing

Idle input passes through two events:

1. `input` records the text and its immediate conversation context.
2. `before_agent_start` confirms that Pi accepted the input. Only then does the
   extension update the activity state and start interpretation.

This prevents input handled by another extension or rejected before agent start
from reaching the configured request model.

Steering and follow-up input is different. The extension immediately displays
the local label and marks `message queued`, but waits for the corresponding user
`message_start` before calling the model. Pi can then continue displaying the
current work until it delivers that queued message.

Input with `source: "extension"` is not interpreted. Blank text with an image
becomes the local label `Shared an image`; the image itself is not sent.

### Context selection

Each model request contains a `RequestSnapshot` with:

| Field | Source | Limit |
| --- | --- | ---: |
| `previousRequest` | Current request line | 240 characters |
| `priorAssistant` | Last assistant text before this input | 2,000 characters |
| `userInput` | Accepted user input | 1,000 characters |

`textContent()` keeps only text content blocks. `clipText()` collapses whitespace
and, when needed, keeps both the start and end of a field with an ellipsis
between them.

On `session_start`, the extension rebuilds a snapshot from the active context
branch. It uses the latest user message and the assistant text immediately
before it. No custom session entry is persisted.

### Local fallback

`startInterpretation()` first sets the line to `fallbackRequestLine(userInput)`.
The fallback is a one-line, 240-character form of the user's input. In the TUI,
it remains visible when:

- no model is configured;
- Pi cannot find the provider or model;
- the model does not accept text input;
- authentication is unavailable;
- the request times out, is aborted, or fails;
- the provider returns an error or empty response.

Background interpretation failures are intentionally silent because the local
label is already valid. Configuration parse errors are different: they produce
a Pi warning during `session_start`. Outside TUI mode, the extension still
computes local request state but installs no widget and makes no model call.

### Model call

`interpretRequest()` resolves both the model and its registered Pi provider,
then asks Pi's model registry for authentication. It calls the provider's
`streamSimple()` method with:

- an 8,000 ms timeout;
- zero retries;
- a 96-token output limit;
- `cacheRetention: "none"`;
- a fresh side-request session ID;
- the extension's system prompt and one JSON user message.

The call does not set a reasoning level. Provider and model defaults still
apply.

Only the first non-empty output line is used. Leading labels such as `User:` and
surrounding quotes are removed, whitespace is collapsed, and the result is
clipped to 240 characters.

### Stale-result protection

Every interpretation records the current runtime epoch and request generation.
New input increments the generation and aborts the previous controller. Session
tree changes, compaction, reload, replacement, and shutdown also invalidate
pending work.

The interpreter checks the abort signal after authentication and after the model
response. Before applying a result, the runtime also checks the abort signal,
epoch, and generation. A provider that ignores cancellation can therefore
finish late, but its result cannot replace current state.

## Completed outcome

`message_end` retains the latest assistant text from the current agent run.
Once `agent_settled` reports an idle agent and no managed process remains, that
text becomes the local outcome fallback. It is collapsed and clipped to 240
characters, then shown as `Done: <outcome>`. If there is no assistant text, the
line stays `Done — waiting for you`.

When a model is configured, the extension sends one more bounded request with:

| Field | Limit |
| --- | ---: |
| Current request label | 240 characters |
| Final assistant text | 2,000 characters |

The outcome prompt asks for the main result, decision, blocker, or next step in
one line. It does not include tool arguments, tool results, process commands, or
raw files. New input or a new agent run cancels an older outcome request, and a
late result cannot overwrite current activity.

## Activity line

`activity.ts` is a pure reducer. `src/index.ts` translates Pi events into reducer
events and asks the widget to render the resulting description.

### Phases

| Pi evidence | Display when no tool is active |
| --- | --- |
| New accepted input | `Starting` |
| `agent_start`, `turn_start`, or thinking stream | `Thinking / preparing next step` |
| Assistant text stream | `Writing response` |
| Last tool ends or `agent_end` | `Reviewing results` |
| `session_before_compact` | `Compacting context` |
| New session with no work | `Idle — waiting for you` |
| `agent_settled` while idle, with final assistant text | `Done: <outcome>` |
| `agent_settled` while idle, without final assistant text | `Done — waiting for you` |
| Settled or idle with a tracked managed process | `Background process running: <name>` |

`agent_end` is not a completion signal. Pi can still retry, compact and retry,
or process queued input. `agent_settled` becomes `Done` only when `ctx.isIdle()`
is true and the tracked managed-process map is empty.

### Tool classification

| Category | Recognized evidence | Display |
| --- | --- | --- |
| Tests | `npm`, `pnpm`, `yarn`, or `bun` test scripts; `node --test`, `vitest`, `jest`, `pytest`, `cargo test`, `go test`, `rspec`, `mvn test`, or `gradle test` | `Running tests` |
| Build | `npm`, `pnpm`, `yarn`, or `bun` build/check/typecheck scripts; `tsc`, `cargo build`, `go build`, `mvn package`, or `gradle build` | `Building` |
| Edit | `edit`, `write` | `Editing code` |
| Research | Tool names containing `search`, `fetch`, `research`, `web`, `kagi`, `linkup`, or `exa` | `Researching` |
| Explore | `read`, `find`, `grep`, `ls`; Git `status`, `diff`, `log`, `show`, `branch`, `rev-parse`, or `ls-files` commands | `Exploring the codebase` |
| Delegate | `subagent` or a tool name containing `delegate` | `Delegating work` |
| Checkpoint | `auto_commit_checkpoint` | `Saving a checkpoint` |
| Process | A `process` call without a classifiable command | `Running a background process` |
| Command | Other `bash` or `process` commands | `Running a command` |
| Unknown | Any other tool | `Running <humanized tool name>` |

These are name and command heuristics, not a security classifier. For example,
only the listed Git subcommands count as exploration.

When tools run in parallel, the display chooses the first category in this
priority order:

```text
test → build → edit → research → explore → delegate → checkpoint
     → process → command → unknown
```

It then adds `+ N other tool(s)`. The active map retains every tool until Pi
emits its matching `tool_execution_end`.

If Pi has queued input, `; message queued` is appended to the current activity.
Pi exposes whether pending messages exist, not a reliable public count.

### Managed background processes

A `process` tool call finishes as soon as `start` returns, even though the
managed command keeps running. The extension therefore treats the successful
tool result as a second lifecycle:

1. A successful `start` result with a live status adds its process ID and name.
2. A complete successful `list` result refreshes the live set. A truncated list
   cannot remove processes that it omitted.
3. A successful `kill`, or an `output` result with a finished status, removes
   the target.
4. A `pi-processes:update` custom message removes the process named by its ID.

The custom message is the automatic end notification from `pi-processes`.
Readiness messages do not remove a process because a ready server or watcher is
still running. While the agent is settled, the process line takes precedence
over `Done`. Multiple processes appear as the first name plus an additional
count.

This integration observes the public tool result and custom-message shapes from
`@mjakl/pi-processes`. It does not poll, invoke another extension's tool, or
send process data to the summary model. Other process tools remain visible only
for the duration of their own Pi tool event.

## Compaction, tree changes, and shutdown

`session_before_compact` invalidates request and outcome interpretation, saves
the previous activity, and switches to `Compacting context`. If compaction
aborts, or no `session_compact` arrives within 15 seconds, the previous activity
is restored.
A completed compaction refreshes the latest assistant text and reports either
`Starting` for continuing work or `Done` for an idle session.

`session_tree` clears queued input, invalidates pending request and outcome
interpretation, resets activity, and tries to reconstruct the request from the
new active branch. If the branch has no text-bearing user message, the current
request line remains unchanged.

`session_shutdown` aborts request and outcome interpretation, clears the
compaction timer, input queues, and pending process tool calls, disposes the
render throttle, and removes the widget. Pi's replacement and reload flows then
create a fresh runtime on the next `session_start`.

## Rendering

`setupWhereAmIWidget()` installs a component factory under the key
`pi-where-am-i` with `placement: "aboveEditor"`. It does nothing unless
`ctx.mode === "tui"`.

The renderer:

- keeps the request and intermediate activity to one row each;
- wraps only a completed outcome, and only when it exceeds the available width;
- indents continuation rows beneath the agent icon;
- limits the outcome to three rows and marks omitted text with an ellipsis;
- collapses embedded whitespace before wrapping;
- uses Pi's ANSI- and display-width-safe wrapping and clipping utilities;
- uses `👤` and `🤖`, or `H` and `A` in ASCII mode.

The widget therefore uses two rows while Pi works and between two and four rows
when an outcome is complete. Height changes are confined to the completed state
instead of occurring with every intermediate status.

Runtime state updates on every event. UI commits are separate: `RenderThrottle`
commits immediately when the interval permits and retains one trailing update
for changes within the two-second interval. Disposal cancels that trailing
update.

## Tests and change checks

Run:

```bash
npm run check
```

This performs the strict TypeScript check, Node test suite, and `npm pack --dry-run`.
The tests cover:

- tool classification and parallel-tool ordering;
- the distinction between `agent_end` and settled completion;
- completed-outcome fallback and model refinement;
- managed-process start, settlement, and automatic end notification;
- queued follow-up delivery;
- configuration parsing and agent-directory resolution;
- bounded context extraction and model-output normalization;
- accepted-input timing and stale-result rejection;
- compaction cancellation;
- one-row intermediate rendering, capped outcome wrapping, and ASCII icons;
- immediate plus trailing render throttling;
- widget cleanup on shutdown.

The lifecycle test uses a mocked Pi context. Development checks use Pi 0.84.2,
but there is no end-to-end test against a live Pi process. Other Pi versions are
currently unverified.
