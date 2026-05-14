import readline from "node:readline";
import { createRuntimeMethodHandler, handleJsonRpcLine } from "./json-rpc.js";
import { shutdownLangfuseTelemetry } from "./telemetry/langfuse.js";

export async function runStdioServer(): Promise<void> {
  let responseWritten = false;
  let queuedStreams: unknown[] = [];
  const writeStream = (stream: unknown) => {
    const payload = appendRuntimeTransportLatencyMark(stream, "streamStdoutWriteAt", {
      transport: "stdio",
    });
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      method: "runs.stream",
      params: payload,
    })}\n`);
  };
  const handler = createRuntimeMethodHandler(undefined, undefined, {
    onRunStream(stream) {
      if (responseWritten) {
        writeStream(stream);
      } else {
        queuedStreams.push(stream);
      }
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  try {
    for await (const line of rl) {
      responseWritten = false;
      queuedStreams = [];
      const response = await handleJsonRpcLine(line, handler);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
        responseWritten = true;
        for (const stream of queuedStreams) {
          writeStream(stream);
        }
        queuedStreams = [];
      }
    }
  } finally {
    await shutdownLangfuseTelemetry();
  }
}

function appendRuntimeTransportLatencyMark(
  stream: unknown,
  name: string,
  detail: Record<string, unknown> = {},
): unknown {
  if (!isRecord(stream)) {
    return stream;
  }
  const latency = isRecord(stream.latency) ? stream.latency : {};
  const marks = Array.isArray(latency.marks) ? latency.marks.filter(isRecord) : [];
  if (marks.some((mark) => mark.source === "runtime" && mark.name === name)) {
    return stream;
  }
  return {
    ...stream,
    latency: {
      ...latency,
      marks: [
        ...marks,
        {
          source: "runtime",
          name,
          at: Date.now(),
          detail,
        },
      ],
    },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
