export type ActivityPhase =
  | "idle"
  | "starting"
  | "thinking"
  | "responding"
  | "reviewing"
  | "compacting"
  | "done";

export type ToolCategory =
  | "test"
  | "build"
  | "edit"
  | "research"
  | "explore"
  | "delegate"
  | "checkpoint"
  | "process"
  | "command"
  | "unknown";

export interface ActiveTool {
  id: string;
  name: string;
  category: ToolCategory;
}

export interface ActivityState {
  phase: ActivityPhase;
  activeTools: ReadonlyMap<string, ActiveTool>;
  pendingMessage: boolean;
}

export type ActivityEvent =
  | { type: "input"; queued: boolean }
  | { type: "agent_start" }
  | { type: "thinking" }
  | { type: "responding" }
  | { type: "tool_start"; id: string; name: string; args: unknown }
  | { type: "tool_end"; id: string }
  | { type: "agent_end" }
  | { type: "agent_settled" }
  | { type: "queue_sync"; pending: boolean }
  | { type: "compaction_start" }
  | { type: "compaction_end"; running: boolean }
  | { type: "reset"; done?: boolean };

const CATEGORY_PRIORITY: readonly ToolCategory[] = [
  "test",
  "build",
  "edit",
  "research",
  "explore",
  "delegate",
  "checkpoint",
  "process",
  "command",
  "unknown",
];

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  test: "Running tests",
  build: "Building",
  edit: "Editing code",
  research: "Researching",
  explore: "Exploring the codebase",
  delegate: "Delegating work",
  checkpoint: "Saving a checkpoint",
  process: "Running a background process",
  command: "Running a command",
  unknown: "Running a tool",
};

const TEST_COMMAND =
  /(?:^|[;&|]\s*)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:node\s+--test|vitest|jest|pytest|cargo\s+test|go\s+test|rspec|mvn\s+test|gradle\s+test)\b/i;
const BUILD_COMMAND =
  /(?:^|[;&|]\s*)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|check|typecheck)\b|\b(?:tsc|cargo\s+build|go\s+build|mvn\s+package|gradle\s+build)\b/i;
const REPOSITORY_COMMAND = /\bgit\s+(?:status|diff|log|show|branch|rev-parse|ls-files)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandFromArgs(args: unknown): string {
  if (!isRecord(args)) return "";
  return typeof args.command === "string" ? args.command : "";
}

function categoryForCommand(command: string): ToolCategory {
  if (TEST_COMMAND.test(command)) return "test";
  if (BUILD_COMMAND.test(command)) return "build";
  if (REPOSITORY_COMMAND.test(command)) return "explore";
  return "command";
}

export function classifyTool(name: string, args: unknown): ToolCategory {
  const normalized = name.toLowerCase();

  if (normalized === "bash") return categoryForCommand(commandFromArgs(args));
  if (normalized === "process") {
    const command = commandFromArgs(args);
    return command ? categoryForCommand(command) : "process";
  }
  if (["read", "find", "grep", "ls"].includes(normalized)) return "explore";
  if (["edit", "write"].includes(normalized)) return "edit";
  if (normalized === "subagent" || normalized.includes("delegate")) return "delegate";
  if (normalized === "auto_commit_checkpoint") return "checkpoint";
  if (
    normalized.includes("search") ||
    normalized.includes("fetch") ||
    normalized.includes("research") ||
    normalized.includes("web") ||
    normalized.includes("kagi") ||
    normalized.includes("linkup") ||
    normalized.includes("exa")
  ) {
    return "research";
  }

  return "unknown";
}

export function createActivityState(): ActivityState {
  return {
    phase: "idle",
    activeTools: new Map(),
    pendingMessage: false,
  };
}

export function reduceActivity(state: ActivityState, event: ActivityEvent): ActivityState {
  switch (event.type) {
    case "input":
      return event.queued
        ? { ...state, pendingMessage: true }
        : { phase: "starting", activeTools: new Map(), pendingMessage: false };
    case "agent_start":
      return { ...state, phase: "thinking", activeTools: new Map() };
    case "thinking":
      return state.activeTools.size > 0 ? state : { ...state, phase: "thinking" };
    case "responding":
      return state.activeTools.size > 0 ? state : { ...state, phase: "responding" };
    case "tool_start": {
      const activeTools = new Map(state.activeTools);
      activeTools.set(event.id, {
        id: event.id,
        name: event.name,
        category: classifyTool(event.name, event.args),
      });
      return { ...state, activeTools, phase: "thinking" };
    }
    case "tool_end": {
      const activeTools = new Map(state.activeTools);
      activeTools.delete(event.id);
      return {
        ...state,
        activeTools,
        phase: activeTools.size === 0 ? "reviewing" : state.phase,
      };
    }
    case "agent_end":
      return { ...state, phase: "reviewing", activeTools: new Map() };
    case "agent_settled":
      return { phase: "done", activeTools: new Map(), pendingMessage: false };
    case "queue_sync":
      return { ...state, pendingMessage: event.pending };
    case "compaction_start":
      return { ...state, phase: "compacting", activeTools: new Map() };
    case "compaction_end":
      return {
        ...state,
        phase: event.running ? "starting" : "done",
        activeTools: new Map(),
        pendingMessage: event.running ? state.pendingMessage : false,
      };
    case "reset":
      return {
        phase: event.done ? "done" : "idle",
        activeTools: new Map(),
        pendingMessage: false,
      };
  }
}

function primaryTool(tools: readonly ActiveTool[]): ActiveTool | undefined {
  for (const category of CATEGORY_PRIORITY) {
    const match = tools.find((tool) => tool.category === category);
    if (match) return match;
  }
  return tools[0];
}

function humanizeToolName(name: string): string {
  return name.replace(/[_-]+/g, " ").trim() || "tool";
}

export function describeActivity(state: ActivityState): string {
  const tools = [...state.activeTools.values()];
  let description: string;

  if (tools.length > 0) {
    const primary = primaryTool(tools);
    description = primary?.category === "unknown"
      ? `Running ${humanizeToolName(primary.name)}`
      : CATEGORY_LABELS[primary?.category ?? "unknown"];
    if (tools.length > 1) description += ` + ${tools.length - 1} other tool${tools.length === 2 ? "" : "s"}`;
  } else {
    switch (state.phase) {
      case "idle":
        description = "Idle — waiting for you";
        break;
      case "starting":
        description = "Starting";
        break;
      case "thinking":
        description = "Thinking / preparing next step";
        break;
      case "responding":
        description = "Writing response";
        break;
      case "reviewing":
        description = "Reviewing results";
        break;
      case "compacting":
        description = "Compacting context";
        break;
      case "done":
        description = "Done — waiting for you";
        break;
    }
  }

  return state.pendingMessage ? `${description}; message queued` : description;
}
