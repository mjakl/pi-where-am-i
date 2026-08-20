export interface RequestSnapshot {
  previousRequest: string;
  priorAssistant: string;
  userInput: string;
}

export interface OutcomeSnapshot {
  request: string;
  assistant: string;
}

interface MessageEntry {
  type: "message";
  message: {
    role: string;
    content: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMessageEntry(value: unknown): MessageEntry | undefined {
  if (!isRecord(value) || value.type !== "message" || !isRecord(value.message)) return undefined;
  if (typeof value.message.role !== "string") return undefined;
  return value as unknown as MessageEntry;
}

export function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        isRecord(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

export function normalizeOneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function clipText(text: string, maxCharacters: number): string {
  const normalized = normalizeOneLine(text);
  if (normalized.length <= maxCharacters) return normalized;
  if (maxCharacters <= 1) return normalized.slice(0, Math.max(0, maxCharacters));

  const available = maxCharacters - 1;
  const headLength = Math.ceil(available * 0.6);
  const tailLength = available - headLength;
  return `${normalized.slice(0, headLength).trimEnd()}…${normalized.slice(-tailLength).trimStart()}`;
}

export function latestAssistantText(entries: readonly unknown[]): string {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = asMessageEntry(entries[index]);
    if (entry?.message.role !== "assistant") continue;
    const text = textContent(entry.message.content);
    if (normalizeOneLine(text)) return text;
  }
  return "";
}

export function latestRequestSnapshot(
  entries: readonly unknown[],
  previousRequest = "",
): RequestSnapshot | undefined {
  let userIndex = -1;
  let userInput = "";

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = asMessageEntry(entries[index]);
    if (entry?.message.role !== "user") continue;
    const text = textContent(entry.message.content);
    if (!normalizeOneLine(text)) continue;
    userIndex = index;
    userInput = text;
    break;
  }

  if (userIndex < 0) return undefined;

  let priorAssistant = "";
  for (let index = userIndex - 1; index >= 0; index--) {
    const entry = asMessageEntry(entries[index]);
    if (entry?.message.role !== "assistant") continue;
    const text = textContent(entry.message.content);
    if (!normalizeOneLine(text)) continue;
    priorAssistant = text;
    break;
  }

  return { previousRequest, priorAssistant, userInput };
}

export function boundedRequestSnapshot(snapshot: RequestSnapshot): RequestSnapshot {
  return {
    previousRequest: clipText(snapshot.previousRequest, 240),
    priorAssistant: clipText(snapshot.priorAssistant, 2_000),
    userInput: clipText(snapshot.userInput, 1_000),
  };
}

export function boundedOutcomeSnapshot(snapshot: OutcomeSnapshot): OutcomeSnapshot {
  return {
    request: clipText(snapshot.request, 240),
    assistant: clipText(snapshot.assistant, 2_000),
  };
}

export function fallbackRequestLine(userInput: string): string {
  return clipText(userInput, 240) || "Sent a request";
}

export function fallbackOutcomeLine(assistantText: string): string {
  return clipText(assistantText, 240);
}
