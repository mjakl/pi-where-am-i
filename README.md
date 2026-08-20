# pi-where-am-i

**See what you asked Pi to do and what it is doing now, without scrolling.**

`pi-where-am-i` keeps two lines above the Pi editor:

```text
👤 Confirmed exploring the tokenizer as well as the parser
🤖 Exploring the codebase + 1 other tool
```

The first line describes your latest request. The second reports Pi's current
activity.

## Why use it?

When several Pi sessions are open, it is easy to return to a terminal and lose
your place. This extension answers two questions at a glance:

- What did I ask this session to do?
- Is Pi thinking, using tools, or waiting for me?

The activity line works without a model. The request line also works without a
model, but it then shows a shortened form of your input. You can configure a
small text model to turn a reply such as `yes` or `do that` into a useful label
based on the preceding exchange.

## Install

> Pi extensions run with your user account's permissions. Review third-party
> source code before installing it.

Install from GitHub:

```bash
pi install git:github.com/mjakl/pi-where-am-i
```

Or install a local checkout:

```bash
pi install /path/to/pi-where-am-i
```

To try it for one session without installing it:

```bash
pi -e /path/to/pi-where-am-i
```

Restart Pi or run `/reload` after installation.

This release requires Node.js 22.19 or newer. Development checks use Pi
0.84.2; other Pi versions are currently unverified.

## Configure it

Configuration is optional. Without it, you get emoji icons, live activity, and
a request line based on your latest input.

Create this file:

```text
~/.pi/agent/extensions/pi-where-am-i.json
```

If you set `PI_CODING_AGENT_DIR`, place the file in that directory's
`extensions/` subdirectory instead.

```json
{
  "model": {
    "provider": "your-provider",
    "id": "your-cheap-text-model"
  },
  "icons": "emoji"
}
```

The fields are:

| Field | Required | Meaning |
| --- | --- | --- |
| `model.provider` | No | Exact Pi provider ID for contextual request labels |
| `model.id` | No | Exact Pi model ID |
| `icons` | No | `"emoji"` (default) or `"ascii"` |

The model is optional, but `model.provider` and `model.id` must be set together.
Authenticate the provider with Pi's `/login` command or its API-key environment
variable. Then use `pi --list-models` to find the exact provider and model IDs.
Choose a fast, inexpensive text model. The extension does not request a
reasoning level, but the provider or model can still apply its own defaults.

If the configuration is invalid, Pi shows a warning and the extension keeps the
local request label. An unavailable model or failed authentication also leaves
the local label in place. The extension never falls back to Pi's foreground
model.

Copy [`where-am-i.example.json`](where-am-i.example.json) if you want a starting
point.

### ASCII icons

If your terminal font does not render the emoji, set:

```json
{
  "icons": "ascii"
}
```

The widget will use `H` for the human line and `A` for the agent line.

## Model use and privacy

When you configure a request model, the extension makes a separate short model
request for each accepted user input. It can also make one request when it
restores or reloads a session, or when you move to another point in the session
tree. The provider can charge for these calls, but their usage is not added to
Pi's session totals.

The conversation data contains only these text fields:

| Field | Maximum length |
| --- | ---: |
| Previous request label | 240 characters |
| Assistant text immediately before the new input | 2,000 characters |
| New user input | 1,000 characters |

The call also includes a fixed instruction that asks the model for a one-line
orientation label. The extension does not deliberately send Pi's system prompt,
images, tool calls, tool results, or raw file contents. Assistant text can
contain code or other sensitive text, so choose the provider with that in mind.

Each request has an eight-second timeout, no retries, a 96-token output limit,
and asks Pi not to retain a prompt cache. This setting does not control the
provider's logging or data-retention policy. New input cancels or supersedes an
older request; a late result cannot replace a newer label.

## What the activity line means

The activity line comes from Pi's lifecycle and tool events. It reports states
such as `Writing response`, `Exploring the codebase`, `Editing code`,
`Running tests`, `Building`, `Researching`, and `Done — waiting for you`.
Parallel tools stay visible until their own completion events arrive.

This is an observable status, not a guess about Pi's intent. An unknown tool is
shown by name. A detached process cannot remain visible after the tool that
started it stops emitting lifecycle events.

## Limits

- The widget appears only in Pi's interactive TUI.
- It describes the terminal in front of you; it is not a dashboard for all Pi
  sessions.
- It always uses two rows. Long text and embedded newlines are collapsed and
  clipped to the terminal width.
- It shows `Done` only after Pi reports that retries, compaction, and queued work
  have settled.

For the event flow, activity classification, safety rules, and source map, see
[`HOW_IT_WORKS.md`](HOW_IT_WORKS.md).

## Development

```bash
npm install
npm run check
pi -e .
```

`npm run check` runs the TypeScript check, test suite, and package dry run.

## License

MIT
