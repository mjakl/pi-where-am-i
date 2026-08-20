import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTool,
  createActivityState,
  describeActivity,
  reduceActivity,
} from "../src/activity.js";

test("classifies common coding activities", () => {
  assert.equal(classifyTool("read", { path: "src/index.ts" }), "explore");
  assert.equal(classifyTool("exa_search", { query: "Pi extensions" }), "research");
  assert.equal(classifyTool("edit", { path: "src/index.ts" }), "edit");
  assert.equal(classifyTool("bash", { command: "npm test" }), "test");
  assert.equal(classifyTool("bash", { command: "npm run typecheck" }), "build");
  assert.equal(classifyTool("bash", { command: "git diff --check" }), "explore");
  assert.equal(classifyTool("subagent", {}), "delegate");
});

test("tracks parallel tools until their own end events", () => {
  let state = createActivityState();
  state = reduceActivity(state, { type: "agent_start" });
  state = reduceActivity(state, { type: "tool_start", id: "read-1", name: "read", args: {} });
  state = reduceActivity(state, {
    type: "tool_start",
    id: "test-1",
    name: "bash",
    args: { command: "node --test" },
  });

  assert.equal(describeActivity(state), "Running tests + 1 other tool");

  state = reduceActivity(state, { type: "tool_end", id: "test-1" });
  assert.equal(describeActivity(state), "Exploring the codebase");

  state = reduceActivity(state, { type: "tool_end", id: "read-1" });
  assert.equal(describeActivity(state), "Reviewing results");
});

test("does not report done at agent_end", () => {
  let state = reduceActivity(createActivityState(), { type: "agent_start" });
  state = reduceActivity(state, { type: "agent_end" });
  assert.equal(describeActivity(state), "Reviewing results");

  state = reduceActivity(state, { type: "agent_settled" });
  assert.equal(describeActivity(state), "Done — waiting for you");
});

test("keeps queued follow-up visible while current work continues", () => {
  let state = reduceActivity(createActivityState(), { type: "agent_start" });
  state = reduceActivity(state, { type: "input", queued: true });
  assert.equal(describeActivity(state), "Thinking / preparing next step; message queued");

  state = reduceActivity(state, { type: "agent_settled" });
  assert.equal(describeActivity(state), "Done — waiting for you");
});

test("uses an honest fallback for unknown tools", () => {
  let state = createActivityState();
  state = reduceActivity(state, {
    type: "tool_start",
    id: "custom-1",
    name: "deploy_preview",
    args: {},
  });

  assert.equal(describeActivity(state), "Running deploy preview");
});
