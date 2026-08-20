#!/usr/bin/env python3
"""Wait once for bounded GitHub pull request timeline activity."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Optional, Sequence


DEFAULT_INTERVAL_SECONDS = 60
MAX_TIMEOUT_SECONDS = 600
DEFAULT_TIMEOUT_SECONDS = MAX_TIMEOUT_SECONDS
COMMAND_TIMEOUT_SECONDS = 30
INITIAL_COOLDOWN_SECONDS = 10
CHANGE_COOLDOWN_SECONDS = 10
MAX_TIMELINE_EVENTS = 90


class WatchError(RuntimeError):
    pass


class WatchTimeout(WatchError):
    pass


@dataclass
class ApiResponse:
    status: int
    etag: Optional[str]
    poll_interval: Optional[int]
    event_count: Optional[int] = None


def stderr(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def parse_response(output: str) -> ApiResponse:
    status_matches = list(re.finditer(r"(?m)^HTTP/\S+\s+(\d{3})\b", output))
    if not status_matches:
        raise WatchError("gh did not return an HTTP status")

    response_text = output[status_matches[-1].start() :]
    sections = re.split(r"\r?\n\r?\n", response_text, maxsplit=1)
    headers = sections[0]
    body = sections[1] if len(sections) == 2 else None
    status = int(status_matches[-1].group(1))

    etags = re.findall(r"(?im)^etag:\s*(.+?)\r?$", headers)
    poll_intervals = re.findall(r"(?im)^x-poll-interval:\s*(\d+)\s*\r?$", headers)

    event_count = None
    if status == 200:
        if body is None or not body.strip():
            raise WatchError("GitHub timeline response did not include a JSON body")
        try:
            events = json.loads(body)
        except (TypeError, ValueError) as exc:
            raise WatchError("GitHub timeline response body was malformed JSON") from exc
        if not isinstance(events, list):
            raise WatchError("GitHub timeline response body was not a JSON array")
        event_count = len(events)

    return ApiResponse(
        status=status,
        etag=etags[-1].strip() if etags else None,
        poll_interval=int(poll_intervals[-1]) if poll_intervals else None,
        event_count=event_count,
    )


def fetch_timeline(
    repo: str,
    pr_number: int,
    *,
    etag: Optional[str] = None,
    command_timeout_seconds: float = COMMAND_TIMEOUT_SECONDS,
    watcher_limited: bool = False,
) -> ApiResponse:
    endpoint = "repos/{}/issues/{}/timeline?per_page=100&exclude=committed".format(
        repo, pr_number
    )
    command = ["gh", "api", "--include"]
    if etag:
        command.extend(["-H", "If-None-Match: {}".format(etag)])
    command.append(endpoint)

    try:
        completed = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=command_timeout_seconds,
        )
    except FileNotFoundError as exc:
        raise WatchError("GitHub CLI (gh) is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        if watcher_limited:
            raise WatchTimeout("watcher timeout reached during timeline request") from exc
        raise WatchError("GitHub timeline request timed out") from exc

    response = parse_response(completed.stdout)
    if response.status == 304:
        return response
    if completed.returncode != 0 or response.status != 200:
        detail = completed.stderr.strip()
        suffix = ": {}".format(detail) if detail else ""
        raise WatchError(
            "GitHub timeline request failed with HTTP {}{}".format(
                response.status, suffix
            )
        )
    return response


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="GitHub repository in owner/name form")
    parser.add_argument("--pr", required=True, type=int, help="Pull request number")
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=DEFAULT_INTERVAL_SECONDS,
        help="polling interval in seconds (default: {})".format(DEFAULT_INTERVAL_SECONDS),
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="timeout for this watcher invocation in seconds (default and maximum: {})".format(
            MAX_TIMEOUT_SECONDS
        ),
    )

    args = parser.parse_args(argv)
    if not re.fullmatch(r"[^/\s]+/[^/\s]+", args.repo):
        parser.error("--repo must use owner/name form")
    if args.pr <= 0:
        parser.error("--pr must be > 0")
    if args.interval_seconds <= 0:
        parser.error("--interval-seconds must be > 0")
    if args.timeout_seconds <= 0 or args.timeout_seconds > MAX_TIMEOUT_SECONDS:
        parser.error("--timeout-seconds must be between 1 and {}".format(MAX_TIMEOUT_SECONDS))
    return args


def emit_result(status: str, args: argparse.Namespace, **context: object) -> None:
    result = {"status": status, "repo": args.repo, "pr_number": args.pr}
    result.update(context)
    print(json.dumps(result, separators=(",", ":"), sort_keys=True), flush=True)


def remaining_seconds(args: argparse.Namespace, started: float) -> float:
    return max(0.0, args.timeout_seconds - (time.monotonic() - started))


def sleep_capped(args: argparse.Namespace, started: float, seconds: int) -> bool:
    remaining = remaining_seconds(args, started)
    if remaining <= 0:
        return False
    time.sleep(min(seconds, remaining))
    return remaining_seconds(args, started) > 0


def unsupported_size(args: argparse.Namespace, event_count: int, phase: str) -> int:
    emit_result(
        "unsupported_size",
        args,
        event_count=event_count,
        max_event_count=MAX_TIMELINE_EVENTS,
        phase=phase,
    )
    return 0


def fetch_before_timeout(
    args: argparse.Namespace,
    started: float,
    *,
    etag: Optional[str] = None,
) -> ApiResponse:
    remaining = remaining_seconds(args, started)
    if remaining <= 0:
        raise WatchTimeout("watcher timeout reached before timeline request")
    return fetch_timeline(
        args.repo,
        args.pr,
        etag=etag,
        command_timeout_seconds=min(COMMAND_TIMEOUT_SECONDS, remaining),
        watcher_limited=remaining <= COMMAND_TIMEOUT_SECONDS,
    )


def watch(args: argparse.Namespace) -> int:
    started = time.monotonic()
    if not sleep_capped(args, started, INITIAL_COOLDOWN_SECONDS):
        emit_result("timeout", args)
        return 0

    try:
        baseline = fetch_before_timeout(args, started)
    except WatchTimeout:
        emit_result("timeout", args)
        return 0
    if remaining_seconds(args, started) <= 0:
        emit_result("timeout", args)
        return 0
    assert baseline.event_count is not None
    if baseline.event_count > MAX_TIMELINE_EVENTS:
        return unsupported_size(args, baseline.event_count, "baseline")
    if not baseline.etag:
        raise WatchError("GitHub timeline response did not include an ETag")

    interval = max(args.interval_seconds, baseline.poll_interval or 0)
    stderr(
        "WATCHING_PR_ACTIVITY {}#{} every {}s timeout_seconds={} "
        "max_timeout_seconds={} initial_cooldown_seconds={} "
        "change_cooldown_seconds={} max_timeline_events={} baseline_events={}".format(
            args.repo,
            args.pr,
            interval,
            args.timeout_seconds,
            MAX_TIMEOUT_SECONDS,
            INITIAL_COOLDOWN_SECONDS,
            CHANGE_COOLDOWN_SECONDS,
            MAX_TIMELINE_EVENTS,
            baseline.event_count,
        )
    )

    while True:
        if not sleep_capped(args, started, interval):
            emit_result("timeout", args)
            return 0

        try:
            response = fetch_before_timeout(args, started, etag=baseline.etag)
        except WatchTimeout:
            emit_result("timeout", args)
            return 0
        if remaining_seconds(args, started) <= 0:
            emit_result("timeout", args)
            return 0

        if response.status == 200:
            assert response.event_count is not None
            if response.event_count > MAX_TIMELINE_EVENTS:
                return unsupported_size(args, response.event_count, "poll")
            if not sleep_capped(args, started, CHANGE_COOLDOWN_SECONDS):
                emit_result("timeout", args)
                return 0
            emit_result("changed", args)
            return 0

        if response.poll_interval is not None:
            interval = max(args.interval_seconds, response.poll_interval)


def main(argv: Sequence[str]) -> int:
    try:
        return watch(parse_args(argv))
    except KeyboardInterrupt:
        stderr("Interrupted")
        return 130
    except WatchError as exc:
        stderr("Error: {}".format(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
