# Provenance

## Origin

The workflow began as the personal global `github-wait-for-codex-review` skill. Its first catalog version depended on a coding-agent-specific background-process API and the external `gh-codex-check` command.

The bundled watcher was adapted from the self-written `gh-codex-check` project at commit `15d80bc7741d59ed285026975e1e0b370e20a8dc`. It is now intentionally limited to generic bounded activity notification.

## Catalog adaptation

This is a best-effort convenience workflow, not an audit-grade or 100%-accurate review-state detector. It improves on having an agent poll GitHub every 60 seconds without claiming exact review-round attribution.

Two review-driven hardening passes demonstrated that accepting a reviewer's proposed remedy without rechecking this accuracy contract can turn a small notifier into a complex state detector. Review findings therefore receive serious investigation, but neither the conclusion nor the suggested implementation is authoritative. The receiving agent must prefer a simpler guard, conservative refusal, or accepted residual limitation when it robustly satisfies the supported contract.

- The script is a generic one-shot activity notifier. Codex interpretation, current-head context, and ambiguity remain agent responsibilities.
- It conditionally polls one timeline page: `per_page=100&exclude=committed`. A 200 body must be a JSON array and is refused above 90 non-commit events. A 304 is normal, and `X-Poll-Interval` is a minimum.
- Commits are intentionally excluded and do not wake the watcher. The agent checks the current head during inspection rather than the script polling it separately.
- A fixed 10-second initial cooldown precedes baseline capture. A changed 200 response receives a fixed 10-second cooldown before notification. These reduce common timing noise but do not close all races.
- Each watcher invocation has a monotonic timeout of at most 10 minutes; 600 seconds is both the default and maximum. Before every timeline call, the script caps the command timeout at the smaller of 30 seconds and the invocation's remaining time. Expiry at that reduced limit is structured `timeout`; an ordinary 30-second command timeout remains an operational error. Replacement watchers have independent invocation timeouts, and the script receives no shared round deadline.
- Readiness is emitted only after the initial cooldown and baseline, and communicates the effective polling interval, watcher timeout and 600-second maximum, both cooldowns, event cap, and baseline count.
- Fresh requests use one immediate bounded recheck before one plain `@codex review` post. The check and post are non-atomic, and the small residual race is accepted.
- After activity, a ready replacement is established before inspection. Agent judgment owns the remaining ambiguity instead of additional synchronization machinery.
- Only explicit clean text or approval is treated as clean. Empty reviews, reaction-only signals, unclear inline-comment attribution, and other ambiguity remain pending. Feedback takes precedence.
- Timeline and inline-comment inspection each use one complete page and refuse more than 90 items rather than interpreting partial data.
- Timeout triggers an inspection and never implies clean. The agent records each initial or follow-up round's wall-clock start and enforces both a firm 20-minute maximum and at most two watcher timeout cycles, including time across activity-driven replacements. It shortens or stops replacement watchers as needed. Reaching either limit means Codex is unavailable. This remains agent-owned guidance rather than a shared script deadline. Unsupported size and operational errors stop the workflow.

## Standing decisions

- Keep one review round and one watcher active at a time.
- Separate permission to wait from permission to edit, commit, or push.
- A fresh request is one plain `@codex review`, without retry. Monitoring a visible pending, automatic, or completed review does not post.
- Separate acceptance of a review finding from acceptance of its proposed remedy. Verify a concrete contract violation, compare implementation complexity with the risk removed, and choose the smallest complete robust response.
- Do not turn a heuristic or best-effort component into an audit-grade mechanism without explicit user approval. Conservative pending states, bounded inputs, and refusal are valid alternatives to state, synchronization, and cross-snapshot machinery.
- Permit at most one authorized coherent correction and normal push, followed by one Cloud review round using the same simple watcher contract.
- The same two-cycle, 20-minute maximum applies to a follow-up. A non-clean, ambiguous, unavailable, oversized, failed, or unresolved follow-up stops without merging and requires human direction. The skill never merges the pull request.
