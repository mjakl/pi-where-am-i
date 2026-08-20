import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";

import { normalizeOneLine } from "./conversation.js";

export const WHERE_AM_I_WIDGET_ID = "pi-where-am-i";
export const RENDER_INTERVAL_MS = 2_000;

export interface WhereAmIView {
  request: string;
  activity: string;
}

export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const DEFAULT_SCHEDULER: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
};

export class RenderThrottle {
  private lastRenderAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly callback: () => void,
    private readonly intervalMs = RENDER_INTERVAL_MS,
    private readonly scheduler: Scheduler = DEFAULT_SCHEDULER,
  ) {}

  request(): void {
    const elapsed = this.scheduler.now() - this.lastRenderAt;
    if (elapsed >= this.intervalMs) {
      this.flush();
      return;
    }

    if (this.timer) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, Math.max(0, this.intervalMs - elapsed));
  }

  dispose(): void {
    if (this.timer) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private flush(): void {
    this.lastRenderAt = this.scheduler.now();
    this.callback();
  }
}

export function renderWhereAmILines(view: WhereAmIView, width: number, theme: Theme): string[] {
  if (width <= 0) return ["", ""];

  const request = normalizeOneLine(view.request) || "No request yet";
  const activity = normalizeOneLine(view.activity) || "Idle — waiting for you";
  const youLine = `${theme.fg("muted", "You:")} ${theme.fg("text", request)}`;
  const piLine = `${theme.fg("muted", "Pi:")} ${theme.fg("text", activity)}`;

  return [
    truncateToWidth(youLine, width, ""),
    truncateToWidth(piLine, width, ""),
  ];
}

export interface WidgetController {
  requestRender(): void;
  dispose(): void;
}

export function setupWhereAmIWidget(
  context: ExtensionContext,
  getView: () => WhereAmIView,
  scheduler: Scheduler = DEFAULT_SCHEDULER,
): WidgetController {
  if (context.mode !== "tui") {
    return { requestRender() {}, dispose() {} };
  }

  let tui: TUI | null = null;
  let disposed = false;
  let committedView = getView();
  const throttle = new RenderThrottle(() => {
    committedView = getView();
    tui?.requestRender();
  }, RENDER_INTERVAL_MS, scheduler);

  context.ui.setWidget(
    WHERE_AM_I_WIDGET_ID,
    (nextTui, theme) => {
      tui = nextTui;
      const component: Component & { dispose(): void } = {
        render: (width) => renderWhereAmILines(committedView, width, theme),
        invalidate() {},
        dispose() {
          if (tui === nextTui) tui = null;
        },
      };
      return component;
    },
    { placement: "aboveEditor" },
  );

  return {
    requestRender(): void {
      if (!disposed) throttle.request();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      throttle.dispose();
      context.ui.setWidget(WHERE_AM_I_WIDGET_ID, undefined);
      tui = null;
    },
  };
}
