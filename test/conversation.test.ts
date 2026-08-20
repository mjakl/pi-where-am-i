import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedRequestSnapshot,
  clipText,
  fallbackRequestLine,
  latestAssistantText,
  latestRequestSnapshot,
  textContent,
} from "../src/conversation.js";

function message(role: string, text: string): unknown {
  return {
    type: "message",
    message: { role, content: [{ type: "text", text }] },
  };
}

test("extracts text blocks without images, thinking, or tool calls", () => {
  assert.equal(textContent([
    { type: "thinking", thinking: "secret" },
    { type: "text", text: "Visible" },
    { type: "image", data: "base64" },
    { type: "toolCall", arguments: { secret: true } },
  ]), "Visible");
});

test("pairs the latest user input with the assistant message before it", () => {
  const entries = [
    message("user", "Explore the parser"),
    message("assistant", "Should I inspect the tokenizer too?"),
    message("user", "yes"),
    message("assistant", "I will inspect both."),
  ];

  assert.deepEqual(latestRequestSnapshot(entries, "Asked to explore the parser"), {
    previousRequest: "Asked to explore the parser",
    priorAssistant: "Should I inspect the tokenizer too?",
    userInput: "yes",
  });
  assert.equal(latestAssistantText(entries), "I will inspect both.");
});

test("bounds context fields and keeps both ends of long text", () => {
  const clipped = clipText(`start ${"x".repeat(100)} end`, 20);
  assert.equal(clipped.length, 20);
  assert.match(clipped, /^start/);
  assert.match(clipped, /end$/);

  const bounded = boundedRequestSnapshot({
    previousRequest: "p".repeat(300),
    priorAssistant: "a".repeat(2_500),
    userInput: "u".repeat(1_500),
  });
  assert.equal(bounded.previousRequest.length, 240);
  assert.equal(bounded.priorAssistant.length, 2_000);
  assert.equal(bounded.userInput.length, 1_000);
});

test("provides a compact deterministic fallback", () => {
  assert.equal(fallbackRequestLine("  yes\nplease  "), "yes please");
  assert.equal(fallbackRequestLine(""), "Sent a request");
});
