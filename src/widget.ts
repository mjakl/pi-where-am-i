import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

import type { IconStyle } from "./config.js";
import { normalizeOneLine } from "./conversation.js";

export const WHERE_AM_I_WIDGET_ID = "pi-where-am-i";
export const RENDER_INTERVAL_MS = 2_000;
export const MAX_OUTCOME_LINES = 3;

export interface WhereAmIView {
  request: string;
  activity: string;
  wrapActivity?: boolean;
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

function capOutcomeLines(lines: string[], width: number): string[] {
  if (lines.length <= MAX_OUTCOME_LINES) return lines;

  const visible = lines.slice(0, MAX_OUTCOME_LINES);
  const lastIndex = visible.length - 1;
  const lastLine = visible[lastIndex] ?? "";
  visible[lastIndex] = `${truncateToWidth(lastLine, Math.max(0, width - 1), "")}…`;
  return visible;
}

function renderAgentLines(
  activity: string,
  width: number,
  theme: Theme,
  agentIcon: string,
  wrap: boolean,
): string[] {
  const prefix = `${theme.fg("muted", agentIcon)} `;
  const content = theme.fg("text", activity);
  if (!wrap) return [truncateToWidth(`${prefix}${content}`, width, "")];

  const prefixWidth = visibleWidth(prefix);
  const contentWidth = width - prefixWidth;
  if (contentWidth <= 0) {
    return [truncateToWidth(`${prefix}${content}`, width, "")];
  }

  const wrapped = capOutcomeLines(
    wrapTextWithAnsi(content, contentWidth),
    contentWidth,
  );
  const indent = " ".repeat(prefixWidth);
  return wrapped.map((line, index) => `${index === 0 ? prefix : indent}${line}`);
}

export function renderWhereAmILines(
  view: WhereAmIView,
  width: number,
  theme: Theme,
  iconStyle: IconStyle = "emoji",
): string[] {
  if (width <= 0) return ["", ""];

  const request = normalizeOneLine(view.request) || "No request yet";
  const activity = normalizeOneLine(view.activity) || "Idle — waiting for you";
  const [humanIcon, agentIcon] = iconStyle === "ascii" ? ["H", "A"] : ["👤", "🤖"];
  const humanLine = `${theme.fg("muted", humanIcon)} ${theme.fg("text", request)}`;

  return [
    truncateToWidth(humanLine, width, ""),
    ...renderAgentLines(activity, width, theme, agentIcon, view.wrapActivity === true),
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
  iconStyle: IconStyle = "emoji",
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
        render: (width) => renderWhereAmILines(committedView, width, theme, iconStyle),
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
