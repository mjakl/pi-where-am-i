import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  createActivityState,
  describeActivity,
  reduceActivity,
  type ActivityEvent,
  type ActivityState,
} from "./activity.js";
import { loadWhereAmIConfig, type WhereAmIConfig } from "./config.js";
import {
  fallbackOutcomeLine,
  fallbackRequestLine,
  latestAssistantText,
  latestRequestSnapshot,
  textContent,
  type OutcomeSnapshot,
  type RequestSnapshot,
} from "./conversation.js";
import { interpretOutcome, interpretRequest } from "./request-interpreter.js";
import {
  setupWhereAmIWidget,
  type Scheduler,
  type WidgetController,
} from "./widget.js";

interface PendingInput {
  snapshot: RequestSnapshot;
  behavior: "idle" | "steer" | "followUp";
}

interface PendingProcessCall {
  name: string;
  args: unknown;
}

interface Runtime {
  context: ExtensionContext;
  config: WhereAmIConfig;
  interpreter: typeof interpretRequest;
  outcomeInterpreter: typeof interpretOutcome;
  epoch: number;
  requestGeneration: number;
  requestAbort: AbortController | null;
  outcomeGeneration: number;
  outcomeAbort: AbortController | null;
  requestLine: string;
  outcomeLine: string;
  activity: ActivityState;
  lastAssistantText: string;
  turnAssistantText: string;
  streamingAssistantText: string;
  pendingIdleInput: PendingInput | null;
  steeringInputs: PendingInput[];
  followUpInputs: PendingInput[];
  pendingProcessCalls: Map<string, PendingProcessCall>;
  compactionTimer: ReturnType<typeof setTimeout> | null;
  compactionPreviousActivity: ActivityState | null;
  widget: WidgetController;
}

const LIVE_PROCESS_STATUSES = new Set([
  "running",
  "terminating",
  "terminate_timeout",
]);
const PROCESS_UPDATE_MESSAGE = "pi-processes:update";
const TERMINAL_ESCAPE_PATTERN = new RegExp(
  [
    "\\x1B\\[[0-?]*[ -/]*[@-~]",
    "\\x1B\\][^\\x07\\x1B]*(?:\\x07|\\x1B\\\\)",
    "\\x1B[PX^_][^\\x07\\x1B]*(?:\\x07|\\x1B\\\\)",
    "\\x1B[@-_]",
  ].join("|"),
  "gu",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanProcessName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const safe = value
    .replace(TERMINAL_ESCAPE_PATTERN, "")
    .replace(/[\p{Cc}]/gu, " ");
  return safe.replace(/\s+/g, " ").trim() || fallback;
}

function sessionEntries(context: ExtensionContext): readonly unknown[] {
  return context.sessionManager.buildContextEntries();
}

function processActivityEvent(
  toolName: string,
  args: unknown,
  result: unknown,
): ActivityEvent | undefined {
  if (toolName.toLowerCase() !== "process" || !isRecord(result)) return undefined;
  const details = result.details;
  if (!isRecord(details) || details.success !== true || typeof details.action !== "string") {
    return undefined;
  }

  if (details.action === "start" && isRecord(details.process)) {
    const id = details.process.id;
    if (
      typeof id !== "string" ||
      typeof details.process.status !== "string" ||
      !LIVE_PROCESS_STATUSES.has(details.process.status)
    ) {
      return undefined;
    }
    return {
      type: "background_process_start",
      id,
      name: cleanProcessName(details.process.name, id),
    };
  }

  if (details.action === "list" && Array.isArray(details.processes)) {
    if (
      typeof details.totalProcesses === "number" &&
      details.totalProcesses > details.processes.length
    ) {
      return undefined;
    }
    const processes = details.processes.flatMap((process) => {
      if (
        !isRecord(process) ||
        typeof process.id !== "string" ||
        typeof process.status !== "string"
      ) {
        return [];
      }
      if (!LIVE_PROCESS_STATUSES.has(process.status)) return [];
      return [{
        id: process.id,
        name: cleanProcessName(process.name, process.id),
      }];
    });
    return { type: "background_process_sync", processes };
  }

  if (!isRecord(args) || typeof args.id !== "string") return undefined;
  if (details.action === "kill") {
    return { type: "background_process_end", id: args.id };
  }
  if (
    details.action === "output" &&
    isRecord(details.output) &&
    typeof details.output.status === "string" &&
    !LIVE_PROCESS_STATUSES.has(details.output.status)
  ) {
    return { type: "background_process_end", id: args.id };
  }

  return undefined;
}

function processEndMessageEvent(message: unknown): ActivityEvent | undefined {
  if (!isRecord(message) || message.role !== "custom") return undefined;
  if (message.customType !== PROCESS_UPDATE_MESSAGE || !isRecord(message.details)) {
    return undefined;
  }
  const id = message.details.processId;
  if (typeof id !== "string") return undefined;
  return { type: "background_process_end", id };
}

function updateActivity(
  runtime: Runtime,
  event: ActivityEvent,
  context?: ExtensionContext,
  render = true,
): void {
  let next = reduceActivity(runtime.activity, event);
  if (context?.hasPendingMessages() && !next.pendingMessage) {
    next = { ...next, pendingMessage: true };
  }
  runtime.activity = next;
  if (render) runtime.widget.requestRender();
}

function invalidateInterpretation(runtime: Runtime): void {
  runtime.epoch += 1;
  runtime.requestGeneration += 1;
  runtime.requestAbort?.abort();
  runtime.requestAbort = null;
}

function invalidateOutcomeInterpretation(runtime: Runtime): void {
  runtime.outcomeGeneration += 1;
  runtime.outcomeAbort?.abort();
  runtime.outcomeAbort = null;
}

function startInterpretation(
  runtime: Runtime,
  snapshot: RequestSnapshot,
): void {
  const rawInput = snapshot.userInput;
  runtime.requestLine = fallbackRequestLine(rawInput);
  runtime.widget.requestRender();

  runtime.requestGeneration += 1;
  runtime.requestAbort?.abort();
  runtime.requestAbort = null;

  const modelConfig = runtime.config.model;
  if (!modelConfig || runtime.context.mode !== "tui") return;

  const controller = new AbortController();
  const generationAtStart = runtime.requestGeneration;
  const epochAtStart = runtime.epoch;
  runtime.requestAbort = controller;

  void runtime.interpreter(runtime.context, modelConfig, snapshot, controller.signal)
    .then((interpretation) => {
      if (
        !interpretation ||
        controller.signal.aborted ||
        runtime.epoch !== epochAtStart ||
        runtime.requestGeneration !== generationAtStart
      ) {
        return;
      }

      runtime.requestLine = interpretation;
      runtime.widget.requestRender();
    })
    .catch(() => {
      // The local fallback is already visible. Background interpretation fails silent.
    })
    .finally(() => {
      if (runtime.requestAbort === controller) runtime.requestAbort = null;
    });
}

function startOutcomeInterpretation(
  runtime: Runtime,
  snapshot: OutcomeSnapshot,
): void {
  runtime.outcomeLine = fallbackOutcomeLine(snapshot.assistant);
  invalidateOutcomeInterpretation(runtime);
  runtime.widget.requestRender();

  const modelConfig = runtime.config.model;
  if (!runtime.outcomeLine || !modelConfig || runtime.context.mode !== "tui") return;

  const controller = new AbortController();
  const generationAtStart = runtime.outcomeGeneration;
  const epochAtStart = runtime.epoch;
  runtime.outcomeAbort = controller;

  void runtime.outcomeInterpreter(
    runtime.context,
    modelConfig,
    snapshot,
    controller.signal,
  )
    .then((interpretation) => {
      if (
        !interpretation ||
        controller.signal.aborted ||
        runtime.epoch !== epochAtStart ||
        runtime.outcomeGeneration !== generationAtStart
      ) {
        return;
      }

      runtime.outcomeLine = interpretation;
      runtime.widget.requestRender();
    })
    .catch(() => {
      // The final assistant text is already visible as the local fallback.
    })
    .finally(() => {
      if (runtime.outcomeAbort === controller) runtime.outcomeAbort = null;
    });
}

function reconstructRequest(runtime: Runtime): void {
  const entries = sessionEntries(runtime.context);
  runtime.lastAssistantText = latestAssistantText(entries);
  runtime.turnAssistantText = "";
  runtime.streamingAssistantText = "";
  runtime.outcomeLine = fallbackOutcomeLine(runtime.lastAssistantText);

  const snapshot = latestRequestSnapshot(entries, runtime.requestLine);
  if (snapshot) startInterpretation(runtime, snapshot);
}

function clearCompactionTimer(runtime: Runtime): void {
  if (runtime.compactionTimer) clearTimeout(runtime.compactionTimer);
  runtime.compactionTimer = null;
  runtime.compactionPreviousActivity = null;
}

function disposeRuntime(runtime: Runtime): void {
  invalidateInterpretation(runtime);
  invalidateOutcomeInterpretation(runtime);
  clearCompactionTimer(runtime);
  runtime.pendingIdleInput = null;
  runtime.steeringInputs = [];
  runtime.followUpInputs = [];
  runtime.pendingProcessCalls.clear();
  runtime.widget.dispose();
}

export interface WhereAmIExtensionOptions {
  scheduler?: Scheduler;
  interpreter?: typeof interpretRequest;
  outcomeInterpreter?: typeof interpretOutcome;
  config?: WhereAmIConfig;
}

export function registerWhereAmIExtension(
  pi: ExtensionAPI,
  options: WhereAmIExtensionOptions = {},
): void {
  let runtime: Runtime | null = null;

  pi.on("session_start", (_event, context) => {
    if (runtime) disposeRuntime(runtime);

    const loaded = options.config
      ? { config: options.config, errors: [] }
      : loadWhereAmIConfig();
    const nextRuntime: Runtime = {
      context,
      config: loaded.config,
      interpreter: options.interpreter ?? interpretRequest,
      outcomeInterpreter: options.outcomeInterpreter ?? interpretOutcome,
      epoch: 0,
      requestGeneration: 0,
      requestAbort: null,
      outcomeGeneration: 0,
      outcomeAbort: null,
      requestLine: "No request yet",
      outcomeLine: "",
      activity: createActivityState(),
      lastAssistantText: "",
      turnAssistantText: "",
      streamingAssistantText: "",
      pendingIdleInput: null,
      steeringInputs: [],
      followUpInputs: [],
      pendingProcessCalls: new Map(),
      compactionTimer: null,
      compactionPreviousActivity: null,
      widget: { requestRender() {}, dispose() {} },
    };

    nextRuntime.widget = setupWhereAmIWidget(
      context,
      () => ({
        request: nextRuntime.requestLine,
        activity: describeActivity(nextRuntime.activity, nextRuntime.outcomeLine),
        wrapActivity:
          nextRuntime.activity.phase === "done" &&
          nextRuntime.activity.backgroundProcesses.size === 0 &&
          Boolean(nextRuntime.outcomeLine),
      }),
      options.scheduler,
      nextRuntime.config.icons ?? "emoji",
    );
    runtime = nextRuntime;

    if (context.hasUI) {
      for (const error of loaded.errors) {
        context.ui.notify(`pi-where-am-i config: ${error}`, "warning");
      }
    }

    reconstructRequest(nextRuntime);
    nextRuntime.widget.requestRender();
  });

  pi.on("input", (event, context) => {
    const current = runtime;
    if (!current) return;
    if (event.source === "extension") {
      current.pendingIdleInput = null;
      return;
    }

    current.requestGeneration += 1;
    current.requestAbort?.abort();
    current.requestAbort = null;
    invalidateOutcomeInterpretation(current);
    current.outcomeLine = "";

    const rawInput = event.text.trim() || (event.images?.length ? "Shared an image" : "Sent a request");
    const priorAssistant = current.streamingAssistantText || current.lastAssistantText || latestAssistantText(sessionEntries(context));
    const behavior = event.streamingBehavior ?? "idle";
    const pending: PendingInput = {
      behavior,
      snapshot: {
        previousRequest: current.requestLine,
        priorAssistant,
        userInput: rawInput,
      },
    };

    if (behavior === "idle") {
      current.pendingIdleInput = pending;
      return;
    }

    current.requestLine = fallbackRequestLine(rawInput);
    updateActivity(current, { type: "input", queued: true }, context, false);
    if (behavior === "steer") current.steeringInputs.push(pending);
    else current.followUpInputs.push(pending);
    current.widget.requestRender();
  });

  pi.on("before_agent_start", (_event, context) => {
    const current = runtime;
    if (!current) return;

    const pending = current.pendingIdleInput;
    current.pendingIdleInput = null;
    updateActivity(current, { type: "input", queued: false }, context, false);
    if (pending) startInterpretation(current, pending.snapshot);
    else current.widget.requestRender();
  });

  pi.on("agent_start", (_event, context) => {
    const current = runtime;
    if (!current) return;
    invalidateOutcomeInterpretation(current);
    current.outcomeLine = "";
    current.turnAssistantText = "";
    current.streamingAssistantText = "";
    updateActivity(current, { type: "agent_start" }, context);
  });

  pi.on("turn_start", (_event, context) => {
    const current = runtime;
    if (!current) return;
    current.streamingAssistantText = "";
    updateActivity(current, { type: "thinking" }, context);
  });

  pi.on("message_start", (event, context) => {
    const current = runtime;
    if (!current) return;

    const processEnd = processEndMessageEvent(event.message);
    if (processEnd) {
      invalidateOutcomeInterpretation(current);
      current.outcomeLine = "";
      updateActivity(current, processEnd, context);
      return;
    }
    if (event.message.role !== "user") return;

    const pending = current.steeringInputs.shift() ?? current.followUpInputs.shift();
    updateActivity(
      current,
      { type: "queue_sync", pending: context.hasPendingMessages() },
      undefined,
      false,
    );
    if (pending) startInterpretation(current, pending.snapshot);
    else current.widget.requestRender();
  });

  pi.on("message_update", (event, context) => {
    const current = runtime;
    if (!current || event.message.role !== "assistant") return;

    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type === "text_delta") {
      current.streamingAssistantText = `${current.streamingAssistantText}${streamEvent.delta}`.slice(-4_000);
      if (current.activity.activeTools.size === 0 && current.activity.phase !== "responding") {
        updateActivity(current, { type: "responding" }, context);
      }
    } else if (streamEvent.type === "thinking_start" || streamEvent.type === "thinking_delta") {
      if (current.activity.activeTools.size === 0 && current.activity.phase !== "thinking") {
        updateActivity(current, { type: "thinking" }, context);
      }
    }
  });

  pi.on("message_end", (event) => {
    const current = runtime;
    if (!current || event.message.role !== "assistant") return;

    const assistantText = textContent(event.message.content);
    current.turnAssistantText = assistantText.trim() ? assistantText : "";
    if (current.turnAssistantText) current.lastAssistantText = current.turnAssistantText;
    current.streamingAssistantText = "";
  });

  pi.on("tool_execution_start", (event, context) => {
    const current = runtime;
    if (!current) return;
    if (event.toolName.toLowerCase() === "process") {
      current.pendingProcessCalls.set(event.toolCallId, {
        name: event.toolName,
        args: event.args,
      });
    }
    updateActivity(current, {
      type: "tool_start",
      id: event.toolCallId,
      name: event.toolName,
      args: event.args,
    }, context);
  });

  pi.on("tool_execution_end", (event, context) => {
    const current = runtime;
    if (!current) return;

    const pendingProcessCall = current.pendingProcessCalls.get(event.toolCallId);
    current.pendingProcessCalls.delete(event.toolCallId);
    if (pendingProcessCall) {
      const processEvent = processActivityEvent(
        pendingProcessCall.name,
        pendingProcessCall.args,
        event.result,
      );
      if (processEvent) updateActivity(current, processEvent, undefined, false);
    }

    updateActivity(current, { type: "tool_end", id: event.toolCallId }, context);
  });

  pi.on("agent_end", (_event, context) => {
    const current = runtime;
    if (!current) return;
    updateActivity(current, { type: "agent_end" }, context);
  });

  pi.on("agent_settled", (_event, context) => {
    const current = runtime;
    if (!current) return;
    current.pendingIdleInput = null;
    current.steeringInputs = [];
    current.followUpInputs = [];
    current.pendingProcessCalls.clear();

    const settled = context.isIdle();
    if (settled && current.activity.backgroundProcesses.size === 0) {
      startOutcomeInterpretation(current, {
        request: current.requestLine,
        assistant: current.turnAssistantText,
      });
    } else {
      invalidateOutcomeInterpretation(current);
      current.outcomeLine = "";
    }
    updateActivity(
      current,
      settled ? { type: "agent_settled" } : { type: "agent_end" },
      context,
    );
  });

  pi.on("session_before_compact", (event, context) => {
    const current = runtime;
    if (!current) return;

    invalidateInterpretation(current);
    invalidateOutcomeInterpretation(current);
    clearCompactionTimer(current);
    current.compactionPreviousActivity = current.activity;
    updateActivity(current, { type: "compaction_start" }, context);

    const rollback = () => {
      if (runtime !== current || current.activity.phase !== "compacting") return;
      const previous = current.compactionPreviousActivity;
      clearCompactionTimer(current);
      if (previous) current.activity = previous;
      current.widget.requestRender();
    };
    event.signal.addEventListener("abort", rollback, { once: true });
    current.compactionTimer = setTimeout(rollback, 15_000);
  });

  pi.on("session_compact", (event, context) => {
    const current = runtime;
    if (!current) return;
    clearCompactionTimer(current);
    current.lastAssistantText = latestAssistantText(sessionEntries(context));
    current.streamingAssistantText = "";
    updateActivity(current, { type: "compaction_end", running: event.willRetry || !context.isIdle() }, context);
  });

  pi.on("session_tree", (_event, context) => {
    const current = runtime;
    if (!current) return;
    invalidateInterpretation(current);
    invalidateOutcomeInterpretation(current);
    clearCompactionTimer(current);
    current.pendingIdleInput = null;
    current.steeringInputs = [];
    current.followUpInputs = [];
    current.pendingProcessCalls.clear();
    current.activity = reduceActivity(current.activity, { type: "reset", done: context.isIdle() });
    reconstructRequest(current);
    current.widget.requestRender();
  });

  pi.on("session_shutdown", () => {
    if (!runtime) return;
    disposeRuntime(runtime);
    runtime = null;
  });
}

export default function whereAmIExtension(pi: ExtensionAPI): void {
  registerWhereAmIExtension(pi);
}
