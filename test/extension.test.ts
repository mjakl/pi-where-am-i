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

function createHarness(options: { config?: any; interpreter?: any } = {}) {
  const handlers = new Map<string, Handler>();
  let widgetFactory: WidgetFactory | undefined;
  let widgetCleared = false;
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
      notify() {},
      setWidget: (_key: string, content: WidgetFactory | undefined) => {
        if (content === undefined) {
          widgetCleared = true;
          widgetFactory = undefined;
        } else {
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
    get renderRequests() { return renderRequests; },
    get widgetCleared() { return widgetCleared; },
  };
}

test("tracks request, parallel tools, settlement, and shutdown", async () => {
  const harness = createHarness();
  await harness.run("session_start");
  assert.deepEqual(harness.lines(), ["You: No request yet", "Pi: Idle — waiting for you"]);

  await harness.run("input", {
    text: "please run the tests",
    source: "interactive",
  });
  await harness.run("before_agent_start");
  assert.deepEqual(harness.lines(), ["You: please run the tests", "Pi: Starting"]);

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
    "You: please run the tests",
    "Pi: Running tests + 1 other tool",
  ]);

  await harness.run("tool_execution_end", { toolCallId: "test-1" });
  assert.equal(harness.lines()[1], "Pi: Exploring the codebase");

  await harness.run("agent_end");
  assert.equal(harness.lines()[1], "Pi: Reviewing results");

  await harness.run("agent_settled");
  assert.equal(harness.lines()[1], "Pi: Done — waiting for you");

  await harness.run("session_shutdown");
  assert.equal(harness.widgetCleared, true);
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
    "You: yes, do that too",
    "Pi: Thinking / preparing next step; message queued",
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
  assert.equal(harness.lines()[0], "You: No request yet");

  await harness.run("before_agent_start");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["yes"]);
  assert.equal(harness.lines()[0], "You: Confirmed the accepted request");
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
  assert.equal(harness.lines()[0], "You: Confirmed queued work");
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

  assert.equal(harness.lines()[0], "You: New interpretation");
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
  assert.equal(harness.lines()[1], "Pi: Thinking / preparing next step");

  await harness.run("session_before_compact", { signal: compaction.signal });
  assert.equal(interpretationSignal?.aborted, true);
  assert.equal(harness.lines()[1], "Pi: Compacting context");

  compaction.abort();
  assert.equal(harness.lines()[1], "Pi: Thinking / preparing next step");
});
