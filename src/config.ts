import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface InterpreterModelConfig {
  provider: string;
  id: string;
}

export interface WhereAmIConfig {
  model?: InterpreterModelConfig;
}

export interface LoadedWhereAmIConfig {
  config: WhereAmIConfig;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getWhereAmIConfigPath(): string {
  return join(getAgentDir(), "extensions", "pi-where-am-i.json");
}

export function parseWhereAmIConfig(value: unknown): LoadedWhereAmIConfig {
  if (!isRecord(value)) {
    return { config: {}, errors: ["Expected a JSON object."] };
  }

  if (value.model === undefined) return { config: {}, errors: [] };
  if (!isRecord(value.model)) {
    return { config: {}, errors: ["model must be an object with provider and id strings."] };
  }

  const provider = typeof value.model.provider === "string" ? value.model.provider.trim() : "";
  const id = typeof value.model.id === "string" ? value.model.id.trim() : "";
  if (!provider || !id) {
    return { config: {}, errors: ["model.provider and model.id are required strings."] };
  }

  return { config: { model: { provider, id } }, errors: [] };
}

export function loadWhereAmIConfig(): LoadedWhereAmIConfig {
  const path = getWhereAmIConfigPath();
  if (!existsSync(path)) return { config: {}, errors: [] };

  try {
    return parseWhereAmIConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { config: {}, errors: [`Could not parse ${path}: ${message}`] };
  }
}
