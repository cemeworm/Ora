import readline from "node:readline";
import { createRuntimeMethodHandler, handleJsonRpcLine } from "./json-rpc.js";
import { shutdownLangfuseTelemetry } from "./telemetry/langfuse.js";

export async function runStdioServer(): Promise<void> {
  const handler = createRuntimeMethodHandler();
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  try {
    for await (const line of rl) {
      const response = await handleJsonRpcLine(line, handler);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  } finally {
    await shutdownLangfuseTelemetry();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStdioServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
