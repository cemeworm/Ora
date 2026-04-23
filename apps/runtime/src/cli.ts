import fs from "node:fs";
import path from "node:path";
import { createRuntimeMethodHandler } from "./json-rpc.js";
import { shutdownLangfuseTelemetry } from "./telemetry/langfuse.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--smoke")) {
    await runSmoke();
    await shutdownLangfuseTelemetry();
    return;
  }

  if (args[0] === "eval") {
    await runEvalCommand(args.slice(1));
    await shutdownLangfuseTelemetry();
    return;
  }

  process.stderr.write([
    "Usage:",
    "  ora-runtime --smoke",
    "  ora-runtime eval import --file <path> [--name <dataset-name>]",
    "  ora-runtime eval run --spec <path-to-spec.json>",
    "  ora-runtime eval list [--dataset-id <dataset-id>]",
    "  ora-runtime eval export --run <evaluation-run-id> [--format json|csv] [--output <path>]",
    "  ora-runtime eval promote-baseline --run <evaluation-run-id> --config <config-id> [--name <baseline-name>]",
  ].join("\n") + "\n");
  process.exitCode = 2;
}

async function runSmoke() {
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

async function runEvalCommand(args: string[]) {
  const handle = createRuntimeMethodHandler();
  const subcommand = args[0];
  const flags = parseFlags(args.slice(1));

  switch (subcommand) {
    case "import": {
      const filePath = requiredFlag(flags, "--file");
      const content = fs.readFileSync(filePath, "utf8");
      const result = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "evaluation.datasets.import",
        params: {
          filePath,
          sourceFileName: path.basename(filePath),
          sourceFormat: flags["--format"],
          name: flags["--name"],
          description: flags["--description"],
          tags: splitList(flags["--tags"]),
          content,
        }
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "run": {
      const specPath = requiredFlag(flags, "--spec");
      const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
      const result = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "evaluation.runs.start",
        params: spec,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "list": {
      const result = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "evaluation.runs.list",
        params: {
          datasetId: flags["--dataset-id"],
          profileId: flags["--profile"],
          limit: flags["--limit"] ? Number(flags["--limit"]) : undefined,
        }
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "export": {
      const evaluationRunId = requiredFlag(flags, "--run");
      const result = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "evaluation.runs.export",
        params: {
          evaluationRunId,
          format: flags["--format"] ?? "json",
        }
      }) as { format: string; content: string };
      const outputPath = flags["--output"];
      if (outputPath) {
        fs.writeFileSync(outputPath, result.content, "utf8");
        process.stdout.write(`${outputPath}\n`);
      } else {
        process.stdout.write(result.content);
      }
      return;
    }
    case "promote-baseline": {
      const evaluationRunId = requiredFlag(flags, "--run");
      const configId = requiredFlag(flags, "--config");
      const result = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "evaluation.runs.promoteBaseline",
        params: {
          evaluationRunId,
          configId,
          name: flags["--name"],
        }
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    default:
      throw new Error(`Unknown eval subcommand: ${subcommand ?? "<missing>"}`);
  }
}

function parseFlags(args: string[]) {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[arg] = "true";
      continue;
    }
    flags[arg] = next;
    index += 1;
  }
  return flags;
}

function requiredFlag(flags: Record<string, string>, flag: string) {
  const value = flags[flag];
  if (!value) {
    throw new Error(`Missing required flag: ${flag}`);
  }
  return value;
}

function splitList(value: string | undefined) {
  return value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
