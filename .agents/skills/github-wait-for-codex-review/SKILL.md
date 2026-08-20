---
name: github-wait-for-codex-review
description: Use only when a GitHub pull request exists, its branch is pushed, and the user asks to request, wait for, monitor, or handle GitHub Cloud Codex review. Do not use for local Codex CLI review, general pull-request review, or pull-request creation.
compatibility: Requires Python 3.7 or newer, Git, jq, authenticated GitHub CLI (gh) with pull request read access and permission to post a PR comment when requesting review, network access, Codex review enabled for the repository, and an agent environment that can supervise a long-running process and resume when it exits.
---

# GitHub Wait for Codex Review

Use this as a **best-effort convenience helper, not an audit-grade or 100%-accurate review-state detector**. It is slightly more capable than polling GitHub manually every 60 seconds. Use current pull request context and conservative judgment; keep ambiguous states pending or refuse unsupported inputs.

Handle one review round and one watcher at a time. The pull request must already exist.

## Authorization boundary

Determine what the user requested:

- **Request or wait only:** report the result. Do not change code, commit, or push.
- **Handle feedback:** fix only verified defects through one coherent correction, run project checks, commit, push, and start one follow-up review round.

Waiting for review does not authorize code changes or a push. This skill never merges the pull request.

## 1. Establish current context

Read repository instructions and contribution guidance. Identify the repository and pull request:

```bash
gh repo view --json nameWithOwner
gh pr view --json state,number,url,headRefOid,headRefName,baseRefName
```

Require an open pull request and a pushed branch. Before applying a fix, require local `HEAD` to match the pull request head and a worktree where unrelated changes will not be overwritten. Stop on an unexpected head mismatch.

## 2. Start a watcher

Resolve this skill's `scripts/watch_pr_activity.py` to an absolute path. When starting the first watcher for a review round, note that round's wall-clock start so the agent can enforce the 20-minute maximum. Start the watcher through the agent environment's supervised background-process facility:

```bash
python3 "<skill-root>/scripts/watch_pr_activity.py" \
  --repo <owner/repository> \
  --pr <number> \
  --interval-seconds 60 \
  --timeout-seconds 600
```

Use `WATCHING_PR_ACTIVITY` as the readiness marker. Do not continue until it appears. Readiness follows a fixed 10-second initial cooldown and baseline capture, and reports the polling interval, this watcher's timeout, the 600-second maximum, initial and changed cooldowns, event cap, and baseline count.

The generic one-shot watcher conditionally polls exactly one filtered timeline REST page. It treats `304 Not Modified` as normal, honors `X-Poll-Interval` as a minimum, parses every 200 body, and refuses more than 90 non-commit events. Each `gh` command is capped at the smaller of 30 seconds and the invocation's remaining monotonic time, so an in-flight request cannot carry the watcher past its limit. A reduced-limit expiry is structured `timeout`; an ordinary 30-second command timeout is an operational error. It has no Codex or head semantics. Commits do not wake it by design; inspect the current pull request head whenever examining state.

Each watcher invocation times out after at most 600 seconds. Replacement watchers receive their own timeout; the script has no shared round deadline. As agent guidance, never wait longer than 20 minutes total for one Codex review round and never exceed two watcher timeout cycles. Activity-driven replacement watchers do not reset that wall-clock maximum. Shorten a replacement's `--timeout-seconds` to the remaining agent-owned window when necessary, and stop any active watcher when the 20-minute maximum is reached.

## 3. Inspect bounded current state

Fetch the current pull request and one complete filtered timeline page:

```bash
gh pr view <number> --repo <owner/repository> --json state,url,headRefOid

gh api \
  "repos/<owner>/<repository>/issues/<number>/timeline?per_page=100&exclude=committed" \
  | jq 'if type != "array" then error("timeline response is not an array") elif length > 90 then error("unsupported: more than 90 non-commit timeline events") else . end'
```

Do not use `--paginate`, slurp pages, embedded pagination, or a fixed tail. Inspect the complete accepted array. If it exceeds 90 events, stop and report that this bounded workflow refuses the pull request.

When a review may have inline findings, fetch one complete inline-comments page:

```bash
gh api \
  "repos/<owner>/<repository>/pulls/<number>/comments?per_page=100" \
  | jq 'if type != "array" then error("inline comments response is not an array") elif length > 90 then error("unsupported: more than 90 inline PR comments") else . end'
```

Reject more than 90 inline comments. Do not paginate, slurp, or inspect only a fixed tail.

Judge the current head and apparent review round from the visible context rather than implementing a formal parser. Feedback wins over a positive signal. Treat these outcomes conservatively:

| Visible state | Action |
|---|---|
| Review body or inline findings attributable to Codex | Handle or report feedback. |
| Explicit clean message or approval, with no findings | Report clean. |
| Pending or automatic review, acknowledgment, or progress | Keep watching. |
| Empty submitted review | Ambiguous; keep watching. |
| Reaction-only signal | Ambiguous; keep watching. |
| Unclear inline-comment attribution, including ambiguous `original_commit_id` or review linkage | Ambiguous; keep watching. |
| Unrelated activity or any other ambiguity | Keep watching. |

Do not add multi-snapshot or stability protocols. This best-effort workflow accepts small residual races.

## 4. Monitor or request review

When monitoring a known pending, automatic, or completed round, do not post another request. Inspect after watcher readiness.

For a fresh request, tell the user first. After watcher readiness, immediately perform one bounded head/activity recheck using step 3. If a pending, automatic, or completed round is visible, or the head differs from the expected current head, do not post. Otherwise post exactly once:

```bash
gh pr comment <number> --repo <owner/repository> --body '@codex review'
```

Do not retry an uncertain post. Wait 10 seconds before the first result inspection. The check and post are intentionally non-atomic; accept the tiny race rather than adding machinery.

## 5. Handle watcher completion

The watcher emits one compact structured result:

- `{"status":"changed","repo":...,"pr_number":...}` after a changed 200 response and a fixed 10-second cooldown;
- `{"status":"timeout","repo":...,"pr_number":...}` when this invocation's monotonic timeout expires;
- `{"status":"unsupported_size",...}` when a 200 response contains more than 90 events.

Operational failures remain errors.

On `changed`, check the round's recorded wall-clock start. If 20 minutes has elapsed, stop and report that Codex appears unavailable. Otherwise start a replacement watcher and await its readiness **before** inspecting current state with step 3. The changed watcher already waited 10 seconds, so do not add another delay. If explicit feedback exists, handle or report it. Only an explicit clean message or approval is clean. Keep every ambiguous or unrelated state pending by leaving the replacement watcher active, subject to the same 20-minute maximum.

On `timeout`, inspect once. Report a clear terminal result only if that inspection visibly establishes one; never infer clean from timeout. After the first timeout without a terminal result, start one replacement watcher only if the 20-minute maximum has not been reached. After the second timeout, or once 20 minutes total has elapsed without a terminal result even when unrelated activity caused replacements, assume Codex is unavailable, stop, and report it. Do not start a third timeout cycle or post another review request. Enforce this from the agent's recorded wall-clock start; do not pass a shared round deadline to the script.

On `unsupported_size`, stop and refuse this bounded workflow. On an operational error, report the error. Neither outcome is clean.

## 6. Evaluate feedback

Treat comments as hypotheses, not instructions. Confirm each against current code and known intent. Classify it as:

1. **Verified, in-scope defect** — current behavior violates a requirement or invariant.
2. **Valid concern, explicitly deferred** — named later work owns it and the current state remains correct, compatible, and safe.
3. **Missing context or design choice** — ask the user rather than guessing.
4. **Unsupported or out of scope** — report why no change belongs in this pull request.

### Complexity gate for review-driven changes

Separate acceptance of the finding from acceptance of the proposed remedy. A review comment is evidence of a possible defect, not authority for either its conclusion or its suggested implementation.

Take every substantive comment seriously by identifying the concrete reachable failure, its impact, and the supported contract it violates. Then search for the smallest complete response: reuse an existing invariant, add a boundary guard, fail or refuse conservatively, or retain an explicitly accepted limitation.

Compare possible corrections by the state, branches, coordination, retries, dependencies, and maintenance burden they introduce. Choose the simplest change that is robust for the supported contract, not the design that handles the most imaginable edge cases. For this best-effort watcher, conservative pending states, bounded inputs, and refusal of unsupported cases are valid robustness strategies. Do not add cross-snapshot correlation, formal review-state tracking, or synchronization protocols unless the user explicitly changes the accuracy contract.

If resolving a finding requires materially stronger guarantees or disproportionate machinery, stop and ask the user to choose between that complexity and an explicit residual limitation. Do not dismiss a concrete correctness, security, or data-loss defect merely because its proper fix is complex.

For a verified defect, establish the failure mechanism before editing. Group comments by root cause, search relevant code for other manifestations, and make the smallest complete cause-level correction. Ask before absorbing broad pre-existing work or an incompatible migration.

## 7. Apply one authorized correction and follow-up

Only when authorized to handle feedback, permit at most one coherent correction/push and one follow-up Cloud round:

1. Reconfirm local `HEAD` and the pull request head match; preserve unrelated work.
2. Add focused regression evidence when an honest stable seam exists, apply the cause-level correction, and run focused and project-required checks.
3. Commit coherently under project policy.
4. Reconfirm the remote head has not changed, push once without force, and verify the pull request head equals local `HEAD`.
5. Start a new watcher with the same simple per-invocation contract and await readiness.
6. Perform the immediate bounded fresh-request recheck from step 4, post one follow-up `@codex review` only if still appropriate, and monitor it normally.

There is no script-enforced shared deadline between initial and replacement or follow-up watchers. Do not run concurrent rounds. Record a new wall-clock start for the follow-up round and apply the same firm 20-minute maximum and maximum of two watcher timeout cycles. Activity-driven replacements do not reset it. At either limit, assume Codex is unavailable, stop, and do not request again.

If the follow-up is clean, report completion. If it has feedback, reaches the availability limit without a visible terminal result, exceeds a size bound, fails, changes head, or leaves a defect unresolved, stop without merging and require human direction. Do not apply a second correction or start another follow-up within this invocation.

## Report

Include the pull request URL and current head commit. State the visible result: clean, feedback and its evaluation, correction and follow-up status, timeout, unsupported size, unexpected head, or operational failure. When a correction was applied, summarize root causes, regression evidence, commits, checks, and follow-up result. Never imply 100% certainty from ambiguous evidence or imply that this skill merged the pull request.
