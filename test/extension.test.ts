import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { registerWhereAmIExtension } from "../src/index.js";

type Handler = (event: any, context: any) => any;

type WidgetFactory = (tui: any, theme: any) => {
  render(width: number): string[];
  invalidate(): void;
  dispose?(): void;
};

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "pi-where-am-i-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

after(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

function createHarness(options: {
  config?: any;
  interpreter?: any;
  outcomeInterpreter?: any;
} = {}) {
  const handlers = new Map<string, Handler>();
  let widgetFactory: WidgetFactory | undefined;
  let widgetCleared = false;
  let widgetInstalls = 0;
  let notifications = 0;
  let renderRequests = 0;
  const entries: unknown[] = [];
  const theme = { fg: (_color: string, text: string) => text };
  const tui = { requestRender: () => renderRequests += 1 };

  const context: any = {
    cwd: "/tmp/project",
    hasUI: true,
    mode: "tui",
    isIdle: () => true,
    hasPendingMessages: () => false,
    modelRegistry: {
      find: () => undefined,
    },
    sessionManager: {
      buildContextEntries: () => entries,
    },
    ui: {
      notify() { notifications += 1; },
      setWidget: (_key: string, content: WidgetFactory | undefined) => {
        if (content === undefined) {
          widgetCleared = true;
          widgetFactory = undefined;
        } else {
          widgetInstalls += 1;
          widgetFactory = content;
        }
      },
    },
  };

  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
  };
  let now = 0;
  registerWhereAmIExtension(pi as any, {
    config: options.config,
    interpreter: options.interpreter,
    outcomeInterpreter: options.outcomeInterpreter,
    scheduler: {
      now: () => now += 2_001,
      setTimeout: () => {
        throw new Error("test scheduler should render immediately");
      },
      clearTimeout() {},
    },
  });

  const run = async (name: string, event: any = {}) => {
    const handler = handlers.get(name);
    assert.ok(handler, `${name} should be registered`);
    return await handler(event, context);
  };

  const lines = () => {
    assert.ok(widgetFactory, "widget should be installed");
    return widgetFactory(tui, theme).render(100);
  };

  return {
    context,
    handlers,
    lines,
    run,
    get notifications() { return notifications; },
    get renderRequests() { return renderRequests; },
    get widgetCleared() { return widgetCleared; },
    get widgetInstalls() { return widgetInstalls; },
  };
}

test("does nothing outside TUI mode and disposes a prior TUI runtime", async () => {
  let interpretationCalls = 0;
  const harness = createHarness({
    config: { model: { provider: "test", id: "cheap" } },
    interpreter: async () => {
      interpretationCalls += 1;
      return "Should not run";
    },
    outcomeInterpreter: async () => {
      interpretationCalls += 1;
      return "Should not run";
    },
  });

  await harness.run("session_start");
  assert.equal(harness.widgetInstalls, 1);

  for (const mode of ["rpc", "json", "print"]) {
    harness.context.mode = mode;
    await harness.run("session_start");
    for (const [name] of harness.handlers) {
      if (name !== "session_start") await harness.run(name);
    }
  }

  assert.equal(harness.widgetCleared, true);
  assert.equal(harness.widgetInstalls, 1);
  assert.equal(harness.notifications, 0);
  assert.equal(interpretationCalls, 0);
});

test("does not read configuration while starting a non-TUI session", async () => {
  const handlers = new Map<string, Handler>();
  let configReads = 0;
  const options = Object.defineProperty({}, "config", {
    get() {
      configReads += 1;
      return { icons: "ascii" };
    },
  });

  registerWhereAmIExtension({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
  } as any, options);

  const sessionStart = handlers.get("session_start");
  assert.ok(sessionStart);
  await sessionStart({}, { mode: "rpc" });
  assert.equal(configReads, 0);
});

test("uses ASCII icons when configured", async () => {
  const harness = createHarness({ config: { icons: "ascii" } });
  await harness.run("session_start");
  assert.deepEqual(harness.lines(), ["H No request yet", "A Idle — waiting for you"]);
});

test("tracks request, parallel tools, settlement, and shutdown", async () => {
  const harness = createHarness();
  await harness.run("session_start");
  assert.deepEqual(harness.lines(), ["👤 No request yet", "🤖 Idle — waiting for you"]);

  await harness.run("input", {
    text: "please run the tests",
    source: "interactive",
  });
  await harness.run("before_agent_start");
  assert.deepEqual(harness.lines(), ["👤 please run the tests", "🤖 Starting"]);

  await harness.run("agent_start");
  await harness.run("tool_execution_start", {
    toolCallId: "read-1",
    toolName: "read",
    args: { path: "src/index.ts" },
  });
  await harness.run("tool_execution_start", {
    toolCallId: "test-1",
    toolName: "bash",
    args: { command: "npm test" },
  });
  assert.deepEqual(harness.lines(), [
    "👤 please run the tests",
    "🤖 Running tests + 1 other tool",
  ]);

  await harness.run("tool_execution_end", { toolCallId: "test-1" });
  assert.equal(harness.lines()[1], "🤖 Exploring the codebase");

  await harness.run("agent_end");
  assert.equal(harness.lines()[1], "🤖 Reviewing results");

  await harness.run("agent_settled");
  assert.equal(harness.lines()[1], "🤖 Done — waiting for you");

  await harness.run("session_shutdown");
  assert.equal(harness.widgetCleared, true);
});

test("shows the final assistant outcome after settlement", async () => {
  const harness = createHarness();
  await harness.run("session_start");
  await harness.run("input", {
    text: "add regression coverage",
    source: "interactive",
  });
  await harness.run("before_agent_start");
  await harness.run("agent_start");
  await harness.run("message_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Added regression coverage. All tests pass." }],
    },
  });
  await harness.run("agent_end");
  await harness.run("agent_settled");

  assert.equal(
    harness.lines()[1],
    "🤖 Done: Added regression coverage. All tests pass.",
  );
});

test("uses the configured model to refine the outcome", async () => {
  const calls: any[] = [];
  const harness = createHarness({
    config: { model: { provider: "test", id: "cheap" } },
    outcomeInterpreter: async (_context: any, _model: any, snapshot: any) => {
      calls.push(snapshot);
      return "Added coverage and verified the full suite";
    },
  });
  await harness.run("session_start");
  await harness.run("input", { text: "add coverage", source: "interactive" });
  await harness.run("before_agent_start");
  await harness.run("agent_start");
  await harness.run("message_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Implemented it. The suite passes." }],
    },
  });
  await harness.run("agent_end");
  await harness.run("agent_settled");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [{
    request: "add coverage",
    assistant: "Implemented it. The suite passes.",
  }]);
  assert.equal(
    harness.lines()[1],
    "🤖 Done: Added coverage and verified the full suite",
  );
});

test("keeps managed processes visible until their end notification", async () => {
  const harness = createHarness();
  await harness.run("session_start");
  await harness.run("agent_start");
  await harness.run("tool_execution_start", {
    toolCallId: "process-1",
    toolName: "process",
    args: { action: "start", name: "test-runner", command: "npm test" },
  });
  await harness.run("tool_execution_end", {
    toolCallId: "process-1",
    toolName: "process",
    result: {
      details: {
        action: "start",
        success: true,
        process: {
          id: "proc_1",
          name: "\u001b[31mtest-runner\u001b[0m\n",
          status: "running",
        },
      },
    },
  });
  await harness.run("agent_end");
  await harness.run("agent_settled");

  assert.equal(
    harness.lines()[1],
    "🤖 Background process running: test-runner",
  );

  await harness.run("message_start", {
    message: {
      role: "custom",
      customType: "pi-processes:update",
      details: { processId: "proc_1", status: "exited" },
      content: "Process completed successfully.",
    },
  });
  await harness.run("agent_start");
  await harness.run("message_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "The background test run passed." }],
    },
  });
  await harness.run("agent_end");
  await harness.run("agent_settled");

  assert.equal(
    harness.lines()[1],
    "🤖 Done: The background test run passed.",
  );
});

test("does not reuse a previous outcome for a textless turn", async () => {
  const harness = createHarness();
  await harness.run("session_start");
  await harness.run("agent_start");
  await harness.run("message_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "The first turn passed." }],
    },
  });
  await harness.run("agent_end");
  await harness.run("agent_settled");
  assert.equal(harness.lines()[1], "🤖 Done: The first turn passed.");

  await harness.run("input", { text: "try another check", source: "interactive" });
  await harness.run("before_agent_start");
  await harness.run("agent_start");
  await harness.run("message_end", {
    message: { role: "assistant", content: [{ type: "thinking", thinking: "failed" }] },
  });
  await harness.run("agent_end");
  await harness.run("agent_settled");

  assert.equal(harness.lines()[1], "🤖 Done — waiting for you");
});

test("does not discard tracked processes from a truncated process list", async () => {
  const harness = createHarness();
  await harness.run("session_start");
  await harness.run("agent_start");
  await harness.run("tool_execution_start", {
    toolCallId: "start-1",
    toolName: "process",
    args: { action: "start", name: "older-runner", command: "npm test" },
  });
  await harness.run("tool_execution_end", {
    toolCallId: "start-1",
    toolName: "process",
    result: {
      details: {
        action: "start",
        success: true,
        process: { id: "proc_old", name: "older-runner", status: "running" },
      },
    },
  });

  await harness.run("tool_execution_start", {
    toolCallId: "list-1",
    toolName: "process",
    args: { action: "list" },
  });
  await harness.run("tool_execution_end", {
    toolCallId: "list-1",
    toolName: "process",
    result: {
      details: {
        action: "list",
        success: true,
        totalProcesses: 31,
        processes: Array.from({ length: 30 }, (_, index) => ({
          id: `finished_${index}`,
          name: `finished-${index}`,
          status: "exited",
        })),
      },
    },
  });
  await harness.run("agent_end");
  await harness.run("agent_settled");

  assert.equal(
    harness.lines()[1],
    "🤖 Background process running: older-runner",
  );
});

test("shows a queued follow-up without replacing current work", async () => {
  const harness = createHarness();
  await harness.run("session_start");
  await harness.run("agent_start");
  await harness.run("input", {
    text: "yes, do that too",
    source: "interactive",
    streamingBehavior: "followUp",
  });

  assert.deepEqual(harness.lines(), [
    "👤 yes, do that too",
    "🤖 Thinking / preparing next step; message queued",
  ]);
});

test("starts remote interpretation only after idle input is accepted", async () => {
  const calls: string[] = [];
  const harness = createHarness({
    config: { model: { provider: "test", id: "cheap" } },
    interpreter: async (_context: any, _model: any, snapshot: any) => {
      calls.push(snapshot.userInput);
      return "Confirmed the accepted request";
    },
  });
  await harness.run("session_start");

  await harness.run("input", { text: "yes", source: "interactive" });
  assert.deepEqual(calls, []);
  assert.equal(harness.lines()[0], "👤 No request yet");

  await harness.run("before_agent_start");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["yes"]);
  assert.equal(harness.lines()[0], "👤 Confirmed the accepted request");
});

test("starts queued interpretation when Pi delivers the user message", async () => {
  const calls: string[] = [];
  const harness = createHarness({
    config: { model: { provider: "test", id: "cheap" } },
    interpreter: async (_context: any, _model: any, snapshot: any) => {
      calls.push(snapshot.userInput);
      return "Confirmed queued work";
    },
  });
  await harness.run("session_start");
  await harness.run("agent_start");
  await harness.run("input", {
    text: "yes, do that too",
    source: "interactive",
    streamingBehavior: "followUp",
  });
  assert.deepEqual(calls, []);
  assert.match(harness.lines()[1] ?? "", /message queued/);

  await harness.run("message_start", {
    message: { role: "user", content: [{ type: "text", text: "yes, do that too" }] },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["yes, do that too"]);
  assert.equal(harness.lines()[0], "👤 Confirmed queued work");
  assert.doesNotMatch(harness.lines()[1] ?? "", /queued/);
});

test("aborts and discards superseded interpretations", async () => {
  const pending: Array<{
    input: string;
    signal: AbortSignal;
    resolve(value: string): void;
  }> = [];
  const harness = createHarness({
    config: { model: { provider: "test", id: "cheap" } },
    interpreter: async (_context: any, _model: any, snapshot: any, signal: AbortSignal) =>
      await new Promise<string>((resolve) => pending.push({
        input: snapshot.userInput,
        signal,
        resolve,
      })),
  });
  await harness.run("session_start");

  await harness.run("input", { text: "first", source: "interactive" });
  await harness.run("before_agent_start");
  await harness.run("input", { text: "second", source: "interactive" });
  await harness.run("before_agent_start");

  assert.equal(pending.length, 2);
  assert.equal(pending[0]?.signal.aborted, true);
  pending[0]?.resolve("Old interpretation");
  pending[1]?.resolve("New interpretation");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.lines()[0], "👤 New interpretation");
});

test("aborts interpretation and rolls back status when compaction is aborted", async () => {
  let interpretationSignal: AbortSignal | undefined;
  const harness = createHarness({
    config: { model: { provider: "test", id: "cheap" } },
    interpreter: async (_context: any, _model: any, _snapshot: any, signal: AbortSignal) => {
      interpretationSignal = signal;
      return await new Promise<string>(() => {});
    },
  });
  const compaction = new AbortController();
  await harness.run("session_start");
  await harness.run("input", { text: "continue", source: "interactive" });
  await harness.run("before_agent_start");
  await harness.run("agent_start");
  assert.equal(harness.lines()[1], "🤖 Thinking / preparing next step");

  await harness.run("session_before_compact", { signal: compaction.signal });
  assert.equal(interpretationSignal?.aborted, true);
  assert.equal(harness.lines()[1], "🤖 Compacting context");

  compaction.abort();
  assert.equal(harness.lines()[1], "🤖 Thinking / preparing next step");
});
