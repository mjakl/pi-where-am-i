import assert from "node:assert/strict";
import test from "node:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  RenderThrottle,
  renderWhereAmILines,
  type Scheduler,
} from "../src/widget.js";

const plainTheme = {
  fg: (_color: string, text: string) => text,
} as Theme;

const ansiTheme = {
  fg: (_color: string, text: string) => `\u001b[31m${text}\u001b[39m`,
} as Theme;

test("keeps request and intermediate activity to one width-safe line each", () => {
  const lines = renderWhereAmILines({
    request: "Asked to explore a deliberately long\nimplementation detail",
    activity: "Exploring\r\nthe codebase",
  }, 24, plainTheme);

  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
  assert.ok(lines.every((line) => !/[\r\n]/.test(line)));
  assert.match(lines[0] ?? "", /^👤 /);
  assert.match(lines[1] ?? "", /^🤖 /);
});

test("wraps only completed outcomes and caps them at three lines", () => {
  const lines = renderWhereAmILines({
    request: "Add parser regression coverage",
    activity:
      "Done: Added parser regression coverage, documented malformed input behavior, and verified the complete test suite without failures.",
    wrapActivity: true,
  }, 24, plainTheme);

  assert.equal(lines.length, 4);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
  assert.match(lines[0] ?? "", /^👤 /);
  assert.match(lines[1] ?? "", /^🤖 /);
  assert.match(lines[2] ?? "", /^ {3}\S/);
  assert.match(lines[3] ?? "", /^ {3}.*…$/);
});

test("keeps wrapped themed outcomes display-width safe", () => {
  const lines = renderWhereAmILines({
    request: "Review wrapping",
    activity:
      "Done: Wrapped the completed outcome while preserving terminal styling and display widths.",
    wrapActivity: true,
  }, 24, ansiTheme);

  assert.ok(lines.length > 2);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
});

test("does not add rows when a completed outcome fits", () => {
  const lines = renderWhereAmILines({
    request: "Run tests",
    activity: "Done: All tests passed",
    wrapActivity: true,
  }, 80, plainTheme);

  assert.equal(lines.length, 2);
});

test("supports one-character ASCII icons", () => {
  const lines = renderWhereAmILines({
    request: "Review the change",
    activity: "Running tests",
  }, 24, plainTheme, "ascii");

  assert.match(lines[0] ?? "", /^H /);
  assert.match(lines[1] ?? "", /^A /);
});

test("coalesces renders while retaining a trailing update", () => {
  let now = 0;
  let callback: (() => void) | undefined;
  let delay = -1;
  let renders = 0;
  const timer = {} as ReturnType<typeof setTimeout>;
  const scheduler: Scheduler = {
    now: () => now,
    setTimeout: (next, nextDelay) => {
      callback = next;
      delay = nextDelay;
      return timer;
    },
    clearTimeout: () => {
      callback = undefined;
    },
  };
  const throttle = new RenderThrottle(() => renders += 1, 2_000, scheduler);

  throttle.request();
  assert.equal(renders, 1);

  now = 500;
  throttle.request();
  throttle.request();
  assert.equal(renders, 1);
  assert.equal(delay, 1_500);

  now = 2_000;
  callback?.();
  assert.equal(renders, 2);
});

test("cancels a trailing render on disposal", () => {
  let callback: (() => void) | undefined;
  let renders = 0;
  let now = 0;
  const scheduler: Scheduler = {
    now: () => now,
    setTimeout: (next) => {
      callback = next;
      return {} as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {
      callback = undefined;
    },
  };
  const throttle = new RenderThrottle(() => renders += 1, 2_000, scheduler);

  throttle.request();
  now = 1;
  throttle.request();
  throttle.dispose();
  callback?.();

  assert.equal(renders, 1);
});
