import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInterpreterPrompt,
  buildOutcomePrompt,
  interpretOutcome,
  interpretRequest,
  normalizeInterpreterOutput,
} from "../src/request-interpreter.js";

test("builds a bounded data-only interpreter prompt", () => {
  const prompt = buildInterpreterPrompt({
    previousRequest: "Explore the parser",
    priorAssistant: "Should I inspect the tokenizer too?",
    userInput: "yes",
  });
  const parsed = JSON.parse(prompt);

  assert.deepEqual(parsed, {
    previousRequest: "Explore the parser",
    priorAssistant: "Should I inspect the tokenizer too?",
    userInput: "yes",
  });
});

test("builds a bounded outcome prompt", () => {
  const prompt = buildOutcomePrompt({
    request: "Run the tests",
    assistant: "The tests passed.",
  });

  assert.deepEqual(JSON.parse(prompt), {
    request: "Run the tests",
    assistant: "The tests passed.",
  });
});

test("normalizes model output to one unlabeled line", () => {
  assert.equal(
    normalizeInterpreterOutput('You: "Confirmed inspecting the tokenizer"\nExtra commentary'),
    "Confirmed inspecting the tokenizer",
  );
  assert.equal(normalizeInterpreterOutput("\n\n"), "");
});

test("dispatches through Pi's registered provider", async () => {
  const calls: any[] = [];
  const model = {
    id: "cheap",
    provider: "native-test",
    api: "custom-api",
    baseUrl: "http://localhost",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10_000,
    maxTokens: 100,
  };
  const provider = {
    streamSimple: (...args: any[]) => {
      calls.push(args);
      return {
        result: async () => ({
          role: "assistant",
          content: [{ type: "text", text: "Confirmed using the native provider" }],
          stopReason: "stop",
        }),
      };
    },
  };
  const context = {
    modelRegistry: {
      find: () => model,
      getProvider: () => provider,
      getApiKeyAndHeaders: async () => ({ ok: true }),
    },
  };

  const result = await interpretRequest(
    context as any,
    { provider: "native-test", id: "cheap" },
    { previousRequest: "", priorAssistant: "Proceed?", userInput: "yes" },
    new AbortController().signal,
  );

  const outcome = await interpretOutcome(
    context as any,
    { provider: "native-test", id: "cheap" },
    { request: "Use the native provider", assistant: "It worked." },
    new AbortController().signal,
  );

  assert.equal(result, "Confirmed using the native provider");
  assert.equal(outcome, "Confirmed using the native provider");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.[0], model);
  assert.match(calls[1]?.[1].systemPrompt ?? "", /outcome summary/);
});
