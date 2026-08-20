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

test("renders exactly two width-safe lines", () => {
  const lines = renderWhereAmILines({
    request: "Asked to explore a deliberately long implementation detail",
    activity: "Exploring the codebase",
  }, 24, plainTheme);

  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
  assert.match(lines[0] ?? "", /^You:/);
  assert.match(lines[1] ?? "", /^Pi:/);
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
