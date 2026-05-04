import { runStdioServer } from "./stdio.js";
import { LocalRunStore } from "./run-store.js";
import { shutdownLangfuseTelemetry } from "./telemetry/langfuse.js";

// Redirect console.log/info/warn to stderr so they don't corrupt the JSON-RPC protocol on stdout
console.log = console.error;
console.info = console.error;
console.warn = console.error;

async function runChannelDaemon(): Promise<void> {
  new LocalRunStore({
    onChannelSessionUpdate(event) {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        method: "channels.sessionUpdated",
        params: event,
      })}\n`);
    },
  });
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await shutdownLangfuseTelemetry();
}

const entrypoint = process.argv.includes("--channel-daemon")
  ? runChannelDaemon
  : runStdioServer;

entrypoint().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
