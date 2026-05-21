import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODE_DEVELOPMENT_MODE_ID, SINGLE_AGENT_MODE_ID, StateSnapshotSchema } from "@cemeworm/shared";
import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";

const cleanupPaths: string[] = [];

function createTempStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-delegation-boundary-smoke-"));
  cleanupPaths.push(dataDir);
  return new LocalRunStore({ dataDir });
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

function causalTaskStateResponse() {
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

function delegationIntentResponse() {
  return jsonResponse(JSON.stringify({
    requestedByUser: false,
    preference: "none",
    confidence: 0.98,
    reason: "No explicit delegation preference was expressed in this test request.",
  }));
}

function memoryUpdateResponse() {
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

type MockProviderRequest = {
  messages: Array<{ role: string; content?: string }>;
  systemText: string;
  userText: string;
  latestUserText: string;
  toolText: string;
  allText: string;
  toolNames: string[];
};

function parseProviderRequest(init: unknown): MockProviderRequest {
  const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as {
    messages?: Array<{ role: string; content?: string }>;
    tools?: Array<{ function?: { name?: string } }>;
  };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const roleText = (role: string) =>
    messages
      .filter((message) => message.role === role)
      .map((message) => typeof message.content === "string" ? message.content : "")
      .join("\n");
  const userMessages = messages.filter((message) => message.role === "user");
  const toolNames = Array.isArray(body.tools)
    ? body.tools
      .map((tool) => tool?.function?.name)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  return {
    messages,
    systemText: roleText("system"),
    userText: roleText("user"),
    latestUserText: [...userMessages]
      .reverse()
      .map((message) => typeof message.content === "string" ? message.content : "")
      .find((content) => content.length > 0) ?? "",
    toolText: roleText("tool"),
    allText: messages
      .map((message) => typeof message.content === "string" ? message.content : "")
      .join("\n"),
    toolNames,
  };
}

function maybeHandleInfraProviderRequest(request: MockProviderRequest): Response | undefined {
  if (request.systemText.includes("delegation intent classifier")) {
    return delegationIntentResponse();
  }
  if (request.systemText.includes("causal task-state extractor")) {
    return causalTaskStateResponse();
  }
  if (request.userText.includes("Analyze this conversation and update Ora's long-term memory profile.")) {
    return memoryUpdateResponse();
  }
  return undefined;
}

function hasWorkspaceSpawnResult(request: MockProviderRequest): boolean {
  return request.latestUserText.includes("Workspace tool result for agent.spawn")
    || request.toolText.includes("Workspace tool result for agent.spawn")
    || request.allText.includes("Workspace tool result for agent.spawn");
}

async function pollUntilDone(
  handle: ReturnType<typeof createRuntimeMethodHandler>,
  runId: string,
  maxAttempts = 80,
): Promise<{ status: string }> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const raw = await handle({ jsonrpc: "2.0", id: 2, method: "runs.state", params: { runId } });
    const parsed = StateSnapshotSchema.safeParse(raw);
    if (parsed.success && (parsed.data.status === "succeeded" || parsed.data.status === "failed")) {
      return { status: parsed.data.status };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { status: "timeout" };
}

function singleAgentRunConfig() {
  return {
    modeId: SINGLE_AGENT_MODE_ID,
    providerId: "agent-spawn-provider",
    modelRef: "agent-spawn-model",
    providerConfig: {
      id: "agent-spawn-provider",
      label: "Agent Spawn Provider",
      type: "openai_compatible" as const,
      modelId: "agent-spawn-model",
      baseUrl: "https://agent-spawn.test/v1",
      apiKeyEnv: "NODE_LOOP_TOOL_KEY",
      capabilities: ["chat", "tool_use"] as string[],
      headers: {},
    },
    toolIds: ["agent.spawn", "file.read"],
    metadata: { disableMemoryUpdate: true },
  };
}

function codeDevelopmentRunConfig() {
  return {
    modeId: CODE_DEVELOPMENT_MODE_ID,
    providerId: "agent-spawn-provider",
    modelRef: "agent-spawn-model",
    providerConfig: {
      id: "agent-spawn-provider",
      label: "Agent Spawn Provider",
      type: "openai_compatible" as const,
      modelId: "agent-spawn-model",
      baseUrl: "https://agent-spawn.test/v1",
      apiKeyEnv: "NODE_LOOP_TOOL_KEY",
      capabilities: ["chat", "tool_use"] as string[],
      headers: {},
    },
    toolIds: [
      "repo.explore",
      "file.read",
      "file.list",
      "file.glob",
      "file.grep",
      "file.write",
      "file.patch",
      "file.apply_patch",
      "shell.execute",
      "plan.update",
      "agent.spawn",
      "agent.wait",
      "message.send",
      "web.fetch",
      "web.search",
    ],
    metadata: { disableMemoryUpdate: true },
  };
}

describe("runtime delegation boundary smoke", () => {
  it("keeps agent.spawn visible for single_agent root runs", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    let sawRootAgentSpawnTool = false;

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (
        request.systemText.includes("root conversation agent for Ora")
        && request.toolNames.length > 0
        && request.toolNames.includes("agent__spawn")
      ) {
        sawRootAgentSpawnTool = true;
      }
      if (!hasWorkspaceSpawnResult(request) && request.latestUserText.includes("Find the answer.")) {
        return jsonResponse("The answer is 42, and this delegated research response is intentionally detailed enough for the parent agent to synthesize.");
      }
      if (request.latestUserText.includes("What is the answer?")) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Research",
            prompt: "Find the answer.",
            inherit_context: true,
            system_prompt: "You are a helpful research assistant.",
          },
        }));
      }
      if (hasWorkspaceSpawnResult(request)) {
        return jsonResponse("The final answer is 42, based on the delegated research result.");
      }
      throw new Error(`Unexpected provider call: ${JSON.stringify({
        systemText: request.systemText,
        latestUserText: request.latestUserText,
        toolNames: request.toolNames,
      })}`);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "What is the answer?" },
          config: singleAgentRunConfig(),
        },
      }) as { runId?: string };
      if (!start.runId) {
        throw new Error(`single_agent smoke start failed: ${JSON.stringify(start)}`);
      }

      const result = await pollUntilDone(handle, start.runId);
      expect(result.status).toBe("succeeded");
      expect(sawRootAgentSpawnTool).toBe(true);
    } finally {
      globalThis.fetch = prevFetch;
    }
  }, 20_000);

  it("hides agent.spawn from code_development root runs while preserving stage-owned execution", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    let sawCodeDevelopmentRootToolSurface = false;
    let codeDevelopmentRootHadAgentSpawn = false;

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (
        (
          request.systemText.includes("root conversation agent for Ora")
          || request.latestUserText.includes("Make a minimal README update and hand it off.")
        )
        && request.toolNames.length > 0
      ) {
        sawCodeDevelopmentRootToolSurface = true;
        codeDevelopmentRootHadAgentSpawn = request.toolNames.includes("agent__spawn");
      }
      if (request.latestUserText.includes("创建一个紧凑的开发计划")) {
        return jsonResponse(JSON.stringify({
          text: "Implement the requested README change.",
          goal: "Adjust the README with a minimal verified change.",
          successCriteria: ["Builder completes the scoped change", "Review passes", "Debug confirms no remaining issue"],
          backlog: [{ id: "1", owner: "builder", description: "Update the README wording." }],
          scopeBoundaries: ["No unrelated refactors"],
          taskJournalPath: "tasks/TASK-readme.md",
          targetFiles: ["README.md"],
          verificationPlan: [{ id: "verify-readme", commandOrMethod: "manual diff review", expectation: "README only change stays in scope" }],
          riskFiles: ["README.md"],
          doneCriteria: ["TODO scan clean", "DONE gate pass"],
        }));
      }
      if (request.latestUserText.includes("做出最小的可行代码变更")) {
        return jsonResponse(JSON.stringify({
          text: "Updated README wording and captured focused verification evidence.",
          artifacts: ["README.md"],
          changedFiles: ["README.md"],
          commandsRun: [{ command: "manual diff review", exitCode: 0, summary: "Confirm only README changed" }],
          verificationEvidence: [{ verificationId: "verify-readme", result: "pass", summary: "README wording updated in scope" }],
          assumptions: [],
          followups: [],
        }));
      }
      if (request.latestUserText.includes("逐条对照开发计划中的 successCriteria")) {
        return jsonResponse(JSON.stringify({
          text: "Review passed for the focused README change.",
          verdict: "pass",
          acceptedArtifactIds: ["build"],
          findings: [],
          blockingIssues: [],
          acceptedFiles: ["README.md"],
          verificationGaps: [],
          rejectedFiles: [],
        }));
      }
      if (request.latestUserText.includes("审查已通过。执行最终诊断")) {
        return jsonResponse(JSON.stringify({
          text: "No further debugging is needed.",
          status: "clear",
          rootCauses: [],
          requiredRework: [],
          diagnosticEvidence: [{ commandOrMethod: "manual diff review", summary: "No runtime/debug issue applies to this README-only change" }],
          remainingRisks: [],
        }));
      }
      if (
        request.latestUserText.includes("撰写最终移交报告")
        || request.latestUserText.includes("最终移交摘要")
        || request.latestUserText.includes("verificationSummary")
      ) {
        return jsonResponse(JSON.stringify({
          text: "Handoff complete. Changed file: README.md. Validation passed.",
          deliveredFiles: ["README.md"],
          acceptedFiles: ["README.md"],
          taskJournalPath: "tasks/TASK-readme.md",
          todoScanResult: { status: "clean", summary: "No blocking TODO items" },
          doneGate: { status: "pass", blockers: [] },
          verificationSummary: [{ verificationId: "verify-readme", result: "pass", summary: "Review and debug gates cleared" }],
          residualRisks: [],
        }));
      }
      throw new Error(`Unexpected provider call: ${JSON.stringify({
        systemText: request.systemText,
        latestUserText: request.latestUserText,
        toolNames: request.toolNames,
      })}`);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Make a minimal README update and hand it off." },
          config: codeDevelopmentRunConfig(),
        },
      }) as { runId?: string };
      if (!start.runId) {
        throw new Error(`code_development smoke start failed: ${JSON.stringify(start)}`);
      }

      const result = await pollUntilDone(handle, start.runId);
      expect(result.status).toBe("succeeded");
      expect(sawCodeDevelopmentRootToolSurface).toBe(true);
      expect(codeDevelopmentRootHadAgentSpawn).toBe(false);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
