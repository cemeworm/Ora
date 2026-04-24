import type { ModelRequest, ModelResponse, ModelStreamCallbacks, ModelStreamChunk } from "./types.js";

type SseMessage = {
  event?: string;
  data: string;
};

export async function emitTextDelta(
  callbacks: ModelStreamCallbacks | undefined,
  chunk: ModelStreamChunk
) {
  await callbacks?.onTextDelta?.(chunk);
}

export async function readSseMessages(
  response: Response,
  onMessage: (message: SseMessage) => Promise<void> | void
): Promise<unknown[]> {
  if (!response.body) {
    throw new Error("Streaming response did not include a readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const rawEvents: unknown[] = [];
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const message = parseSseFrame(frame);
      if (!message || message.data === "[DONE]") {
        continue;
      }
      rawEvents.push(parseJsonOrText(message.data));
      await onMessage(message);
    }

    if (done) {
      break;
    }
  }

  const tail = parseSseFrame(buffer);
  if (tail && tail.data !== "[DONE]") {
    rawEvents.push(parseJsonOrText(tail.data));
    await onMessage(tail);
  }

  return rawEvents;
}

export function openAiResponsesDelta(data: unknown): string {
  if (!isRecord(data)) return "";
  if (data.type === "response.output_text.delta" && typeof data.delta === "string") {
    return data.delta;
  }
  return "";
}

export function openAiChatDelta(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.choices)) return "";
  return data.choices
    .map((choice) => {
      if (!isRecord(choice) || !isRecord(choice.delta)) return "";
      return typeof choice.delta.content === "string" ? choice.delta.content : "";
    })
    .join("");
}

export function anthropicTextDelta(data: unknown): string {
  if (!isRecord(data) || data.type !== "content_block_delta" || !isRecord(data.delta)) {
    return "";
  }
  return data.delta.type === "text_delta" && typeof data.delta.text === "string"
    ? data.delta.text
    : "";
}

export function streamFallback(provider: (request: ModelRequest) => Promise<ModelResponse>) {
  return async (request: ModelRequest, callbacks?: ModelStreamCallbacks): Promise<ModelResponse> => {
    const response = await provider(request);
    if (response.text) {
      await emitTextDelta(callbacks, {
        delta: response.text,
        text: response.text,
        raw: response.raw,
      });
    }
    return {
      ...response,
      raw: {
        streamMode: "fallback_single",
        response: response.raw,
      },
    };
  };
}

function parseSseFrame(frame: string): SseMessage | undefined {
  const lines = frame.split(/\r?\n/);
  const data: string[] = [];
  let event: string | undefined;

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }

  if (data.length === 0) {
    return undefined;
  }

  return { event, data: data.join("\n") };
}

function parseJsonOrText(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
