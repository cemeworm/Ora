import readline from "node:readline";
import { createRuntimeMethodHandler, handleJsonRpcLine } from "./json-rpc.js";
import { shutdownLangfuseTelemetry } from "./telemetry/langfuse.js";

export async function runStdioServer(): Promise<void> {
  let responseWritten = false;
  let queuedStreams: unknown[] = [];
  const writeStream = (stream: unknown) => {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      method: "runs.stream",
      params: stream,
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
