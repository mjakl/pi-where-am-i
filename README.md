# pi-where-am-i

**Always-visible context for Pi sessions: what you asked and what Pi is doing.**

`pi-where-am-i` keeps two compact lines above Pi's editor:

```text
You: Confirmed exploring the tokenizer as well as the parser
Pi: Exploring the codebase + 1 other tool
```

It is designed for working in several terminals at once, where returning to a
session can otherwise mean scrolling back just to remember its task and state.

## Features

- **Contextual request line** — an explicitly configured cheap model can turn a
  short reply such as `yes` into a useful description using the immediately
  preceding assistant text.
- **Live activity line** — derives honest status from Pi lifecycle and tool
  events without spending model tokens.
- **Parallel-tool tracking** — a tool remains active until its own completion
  event; another tool finishing cannot erase it.
- **Correct completion state** — shows done only after `agent_settled`, not an
  intermediate `agent_end` before retries, compaction, or queued work.
- **Bounded updates** — internal state changes immediately while terminal
  renders are coalesced to at most once every two seconds.
- **Safe fallback** — without a configured/authenticated summary model, the
  request line shows a clipped local form of the user's input. It never falls
  back to Pi's foreground model.

## Install

From Git:

```bash
pi install git:github.com/mjakl/pi-where-am-i
```

From a local checkout:

```bash
pi install /path/to/pi-where-am-i
```

For one temporary session:

```bash
pi -e /path/to/pi-where-am-i
```

Restart Pi or run `/reload` after installation.

## Configure the request model

The activity line needs no model. Contextual request interpretation is enabled
only when one explicit model is configured at:

```text
~/.pi/agent/extensions/pi-where-am-i.json
```

If `PI_CODING_AGENT_DIR` is set, the file is resolved below that directory
instead.

```json
{
  "model": {
    "provider": "your-provider",
    "id": "your-cheap-text-model"
  }
}
```

Use `pi --list-models` to find the exact provider and model ID. Choose a cheap,
fast text model, preferably one that does not reason. The side request does not
opt into reasoning, disables retries and prompt-cache retention, emits at most
96 tokens, and times out after eight seconds.

Copy [`where-am-i.example.json`](where-am-i.example.json) as a starting point.
Invalid configuration produces a warning and uses the local fallback.

## What the model sees

The request interpreter receives only three clipped text fields:

1. the previous request label, up to 240 characters;
2. the assistant text immediately before the new input, up to 2,000 characters;
3. the new user input, up to 1,000 characters.

It does not deliberately receive Pi's system prompt, images, tool calls,
tool results, or raw file payloads. Assistant prose can itself contain a code
excerpt, so choose the configured provider accordingly.

Idle input is sent to the interpreter only after Pi accepts it; queued input is
sent only when Pi delivers its user message. Input handled by another extension
or rejected during foreground validation is not sent to the configured model.

Newer user input aborts or supersedes older interpretation. Session replacement,
tree navigation, compaction, reload, and shutdown invalidate late results.

## Activity vocabulary

The second line reports observable Pi activity:

| Evidence | Status |
| --- | --- |
| Agent/model work | `Thinking / preparing next step` |
| Assistant text stream | `Writing response` |
| Read/find/grep/list or read-only Git inspection | `Exploring the codebase` |
| Web search/fetch | `Researching` |
| Edit/write | `Editing code` |
| Recognized test command | `Running tests` |
| Recognized build/typecheck command | `Building` |
| Subagent call | `Delegating work` |
| Compaction | `Compacting context` |
| Fully settled | `Done — waiting for you` |

Unknown tools appear as `Running <tool name>`. Concurrent work adds a compact
`+ N other tools` suffix. Steering and follow-up input add `message queued`.

This is intentionally an observable status, not a semantic guess. Pi cannot
keep reporting a detached process after the responsible tool stops emitting
lifecycle events.

## Scope

The widget is a TUI feature. Print and JSON modes have no persistent terminal
surface, and Pi's RPC mode ignores component widget factories.

The extension explains the terminal currently in view. It does not provide a
cross-terminal dashboard. Terminal-title or tmux integration can be added
separately if locating the right pane remains the main problem.

## Development

Pi loads the TypeScript source directly from the package manifest.

```bash
npm install
npm run check
pi -e .
```

`npm run check` runs the strict TypeScript check, Node test suite, and package
dry run.

The research, trade-offs, panel critique, and implementation acceptance criteria
are documented in [`PLAN.md`](PLAN.md).

## License

MIT
