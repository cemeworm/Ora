import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SINGLE_AGENT_MODE_ID, StateSnapshotSchema } from "@cemeworm/shared";
import { createRuntimeMethodHandler, LocalRunStore } from "../src/index.js";
import { synthesizeLocalTrail } from "../src/telemetry/trails.js";

const cleanupPaths: string[] = [];

function createTempStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-repo-explore-telemetry-"));
  cleanupPaths.push(dataDir);
  return new LocalRunStore({ dataDir });
}

function createWorkspace() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ora-repo-explore-workspace-"));
  cleanupPaths.push(rootPath);
  fs.mkdirSync(path.join(rootPath, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, "src", "auth.ts"),
    [
      "export function authMiddleware(req, res, next) {",
      "  next();",
      "}",
      "",
      "export function installAuth(app) {",
      "  app.use(authMiddleware);",
      "}",
    ].join("\n"),
    "utf8",
  );
  return {
    label: "Repo Explore Telemetry Fixture",
    rootPath,
  };
}

afterEach(() => {
  for (const cleanupPath of cleanupPaths.splice(0)) {
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
  delete process.env.NODE_LOOP_TOOL_KEY;
});

function jsonResponse(content: string) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function parseProviderRequest(init: unknown) {
  const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as {
    messages?: Array<{ role: string; content?: string }>;
  };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const roleText = (role: string) =>
    messages
      .filter((message) => message.role === role)
      .map((message) => typeof message.content === "string" ? message.content : "")
      .join("\n");
  const userMessages = messages.filter((message) => message.role === "user");
  return {
    systemText: roleText("system"),
    latestUserText: [...userMessages]
      .reverse()
      .map((message) => typeof message.content === "string" ? message.content : "")
      .find((content) => content.length > 0) ?? "",
    toolText: roleText("tool"),
    allText: messages
      .map((message) => typeof message.content === "string" ? message.content : "")
      .join("\n"),
  };
}

function maybeHandleInfraProviderRequest(request: ReturnType<typeof parseProviderRequest>): Response | undefined {
  if (request.systemText.includes("delegation intent classifier")) {
    return jsonResponse(JSON.stringify({
      requestedByUser: false,
      preference: "none",
      confidence: 0.99,
      reason: "No explicit delegation preference was expressed in this test request.",
    }));
  }
  if (request.systemText.includes("causal task-state extractor")) {
    return jsonResponse(JSON.stringify({
      latentGoalHypotheses: [],
      selectedLatentGoal: "",
      constraints: [],
      candidateInterventions: [],
      counterfactualRiskIfSkipped: "",
      expectedOutcomeLift: "",
      stopCondition: "",
      confidence: 0,
    }));
  }
  if (request.allText.includes("Analyze this conversation and update Ora's long-term memory profile.")) {
    return jsonResponse(JSON.stringify({
      user: {
        workContext: { summary: "", shouldUpdate: false },
        personalContext: { summary: "", shouldUpdate: false },
        topOfMind: { summary: "", shouldUpdate: false },
      },
      history: {
        recentMonths: { summary: "", shouldUpdate: false },
        earlierContext: { summary: "", shouldUpdate: false },
        longTermBackground: { summary: "", shouldUpdate: false },
      },
      newFacts: [],
      factsToRemove: [],
    }));
  }
  return undefined;
}

function hasWorkspaceToolResult(request: ReturnType<typeof parseProviderRequest>, toolId: string): boolean {
  const marker = `Workspace tool result for ${toolId}`;
  return request.latestUserText.includes(marker)
    || request.toolText.includes(marker)
    || request.allText.includes(marker);
}

async function pollUntilDone(
  handle: ReturnType<typeof createRuntimeMethodHandler>,
  runId: string,
  maxAttempts = 80,
) {
  for (let index = 0; index < maxAttempts; index += 1) {
    const raw = await handle({ jsonrpc: "2.0", id: 2, method: "runs.state", params: { runId } });
    const parsed = StateSnapshotSchema.parse(raw);
    if (parsed.status === "succeeded" || parsed.status === "failed") {
      return parsed;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for run ${runId} to finish.`);
}

describe("repo.explore telemetry", () => {
  it("emits tool.repo_explore.completed and classifies it as a tool trail observation", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const workspace = createWorkspace();
    const prevFetch = globalThis.fetch;

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (request.latestUserText.includes("Find auth wiring") && !hasWorkspaceToolResult(request, "repo.explore")) {
        return jsonResponse(JSON.stringify({
          tool: "repo.explore",
          args: {
            goal: "Find auth wiring",
            kind: "trace",
            subject: "authMiddleware",
            scope: { includeGlobs: ["**/*.ts"] },
          },
        }));
      }
      if (hasWorkspaceToolResult(request, "repo.explore")) {
        return jsonResponse("The middleware is wired through installAuth in src/auth.ts, and the repo.explore evidence shows both the authMiddleware declaration and the app.use(authMiddleware) callsite clearly enough for the run to conclude without another repair loop.");
      }
      throw new Error(`Unexpected provider call: ${JSON.stringify(request)}`);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Find auth wiring",
            context: { projectWorkspace: workspace },
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "repo-explore-provider",
            modelRef: "repo-explore-model",
            providerConfig: {
              id: "repo-explore-provider",
              label: "Repo Explore Provider",
              type: "openai_compatible" as const,
              modelId: "repo-explore-model",
              baseUrl: "https://repo-explore.test/v1",
              apiKeyEnv: "NODE_LOOP_TOOL_KEY",
              capabilities: ["chat", "tool_use"] as string[],
              headers: {},
            },
            toolIds: ["repo.explore"],
          },
        },
      }) as { runId?: string };
      if (!start.runId) {
        throw new Error(`Run failed to start: ${JSON.stringify(start)}`);
      }

      const snapshot = await pollUntilDone(handle, start.runId);
      if (snapshot.status !== "succeeded") {
        throw new Error(JSON.stringify({
          status: snapshot.status,
          error: snapshot.error,
          events: snapshot.events.map((event) => ({ type: event.type, payload: event.payload })).slice(-10),
          toolCalls: snapshot.toolCalls.map((call) => ({
            toolId: call.toolId,
            status: call.status,
            error: call.error,
            output: call.result?.output,
          })),
        }, null, 2));
      }
      expect(snapshot.status).toBe("succeeded");

      const repoExploreEvent = snapshot.events.find((event) => event.type === "tool.repo_explore.completed");
      expect(repoExploreEvent).toBeDefined();
      expect(repoExploreEvent?.payload).toMatchObject({
        kind: "trace",
        status: "answered",
        modeId: SINGLE_AGENT_MODE_ID,
      });

      const trail = synthesizeLocalTrail(snapshot);
      const observation = trail.observations.find((item) => item.name === "tool.repo_explore.completed");
      expect(observation?.type).toBe("tool");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
