import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { afterEach } from "node:test";

import {
  getWhereAmIConfigPath,
  loadWhereAmIConfig,
  parseWhereAmIConfig,
} from "../src/config.js";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function temporaryAgentDir(): string {
  const path = mkdtempSync(join(tmpdir(), "pi-where-am-i-config-"));
  temporaryDirectories.push(path);
  process.env.PI_CODING_AGENT_DIR = path;
  return path;
}

test("accepts one explicit provider and model id", () => {
  assert.deepEqual(parseWhereAmIConfig({
    model: { provider: "openrouter", id: "google/gemini-flash-lite" },
  }), {
    config: { model: { provider: "openrouter", id: "google/gemini-flash-lite" } },
    errors: [],
  });
});

test("accepts emoji or ASCII icon styles", () => {
  assert.deepEqual(parseWhereAmIConfig({ icons: "ascii" }), {
    config: { icons: "ascii" },
    errors: [],
  });
  assert.deepEqual(parseWhereAmIConfig({ icons: "unsupported" }), {
    config: {},
    errors: ['icons must be either "emoji" or "ascii".'],
  });
});

test("reports malformed model configuration", () => {
  assert.deepEqual(parseWhereAmIConfig({ model: { provider: "openrouter" } }), {
    config: {},
    errors: ["model.provider and model.id are required strings."],
  });
});

test("loads config from the Pi agent extensions directory", () => {
  temporaryAgentDir();
  const configPath = getWhereAmIConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    model: { provider: "test-provider", id: "cheap-model" },
  }));

  assert.deepEqual(loadWhereAmIConfig().config, {
    model: { provider: "test-provider", id: "cheap-model" },
  });
});
