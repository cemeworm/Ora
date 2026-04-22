import { createRuntimeMethodHandler } from "./json-rpc.js";

async function main() {
  if (!process.argv.includes("--smoke")) {
    process.stderr.write("Usage: ora-runtime --smoke\n");
    process.exitCode = 2;
    return;
  }

  const handle = createRuntimeMethodHandler();
  const run = await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "runs.start",
    params: {
      input: {
        prompt: "Verify the Ora runtime smoke path."
      },
      config: {
        pattern: "orchestrator_subagent"
      }
    }
  });

  const state = await handle({
    jsonrpc: "2.0",
    id: 2,
    method: "runs.state",
    params: {
      runId: (run as { runId: string }).runId
    }
  });

  const stream = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "runs.stream",
    params: {
      runId: (run as { runId: string }).runId
    }
  });

  const report = await handle({
    jsonrpc: "2.0",
    id: 4,
    method: "runs.exportReport",
    params: {
      runId: (run as { runId: string }).runId
    }
  });

  const fork = await handle({
    jsonrpc: "2.0",
    id: 5,
    method: "runs.fork",
    params: {
      runId: (run as { runId: string }).runId,
      checkpointId: (state as { checkpoints: { id: string }[] }).checkpoints[0]?.id
    }
  });

  const replay = await handle({
    jsonrpc: "2.0",
    id: 6,
    method: "runs.replay",
    params: {
      runId: (run as { runId: string }).runId,
      checkpointId: (state as { checkpoints: { id: string }[] }).checkpoints[0]?.id
    }
  });

  const runs = await handle({
    jsonrpc: "2.0",
    id: 7,
    method: "runs.list"
  });

  process.stdout.write(`${JSON.stringify({ run, state, stream, report, fork, replay, runs }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
