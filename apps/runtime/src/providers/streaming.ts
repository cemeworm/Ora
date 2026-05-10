import type { ModelRequest, ModelResponse, ModelStreamCallbacks, ModelStreamChunk } from "./types.js";

type SseMessage = {
  event?: string;
  data: string;
};

export interface ReadSseMessagesOptions {
  idleTimeoutMs?: number;
  openTimeoutMs?: number;
}

const DEFAULT_SSE_IDLE_TIMEOUT_MS = 120_000;

export async function emitTextDelta(
  callbacks: ModelStreamCallbacks | undefined,
  chunk: ModelStreamChunk
) {
  await callbacks?.onTextDelta?.(chunk);
}

export function createAsyncStreamCallbackQueue() {
  let tail = Promise.resolve();
  let firstError: unknown;
  const enqueue = (callback: () => Promise<void> | void) => {
    const run = async () => {
      try {
        await callback();
      } catch (error) {
        firstError ??= error;
      }
    };
    tail = tail.then(run, run);
    tail.catch(() => undefined);
  };
  return {
    enqueue,
    drain: async () => {
      await tail;
      if (firstError) {
        throw firstError;
      }
    },
  };
}

export async function readSseMessages(
  response: Response,
  onMessage: (message: SseMessage) => Promise<void> | void,
  options: ReadSseMessagesOptions = {},
): Promise<unknown[]> {
  if (!response.body) {
    throw new Error("Streaming response did not include a readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const rawEvents: unknown[] = [];
  const callbackQueue = createAsyncStreamCallbackQueue();
  const idleTimeoutMs = positiveTimeout(options.idleTimeoutMs, DEFAULT_SSE_IDLE_TIMEOUT_MS);
  const openTimeoutMs = positiveTimeout(options.openTimeoutMs, idleTimeoutMs);
  let buffer = "";
  let firstRead = true;

  while (true) {
    const timeout = firstRead ? openTimeoutMs : idleTimeoutMs;
    firstRead = false;
    const { value, done } = await readWithIdleTimeout(reader, timeout);
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const message = parseSseFrame(frame);
      if (!message) {
        continue;
      }
      if (message.data === "[DONE]") {
        await reader.cancel().catch(() => undefined);
        await callbackQueue.drain();
        return rawEvents;
      }
      rawEvents.push(parseJsonOrText(message.data));
      callbackQueue.enqueue(() => onMessage(message));
    }

    if (done) {
      break;
    }
  }

  const tail = parseSseFrame(buffer);
  if (tail && tail.data === "[DONE]") {
    return rawEvents;
  }
  if (tail) {
    rawEvents.push(parseJsonOrText(tail.data));
    callbackQueue.enqueue(() => onMessage(tail));
  }

  await callbackQueue.drain();
  return rawEvents;
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeout = setTimeout(() => {
          void reader.cancel().catch(() => undefined);
          reject(new Error(`Streaming response timed out after ${idleTimeoutMs}ms without data.`));
        }, idleTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function positiveTimeout(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
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
    await callbacks?.onStreamEvent?.({ kind: "fallback_started", streamMode: "fallback_single" });
    const response = await provider(request);
    await callbacks?.onStreamEvent?.({ kind: "fallback_response", streamMode: "fallback_single", raw: response.raw });
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
