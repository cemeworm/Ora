export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Provider returned an empty response.");
  }
  try {
    return parseJsonRecord(JSON.parse(trimmed));
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fenced?.[1]) {
      return parseJsonRecord(JSON.parse(fenced[1]));
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return parseJsonRecord(JSON.parse(trimmed.slice(start, end + 1)));
    }
    throw new Error("Provider response did not contain a JSON object.");
  }
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error("Provider JSON must be an object.");
  }
  return value;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
