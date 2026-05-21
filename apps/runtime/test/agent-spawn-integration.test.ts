import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODE_DEVELOPMENT_MODE_ID, ORA_SELF_BUILDER_MODE_ID, SINGLE_AGENT_MODE_ID, StateSnapshotSchema } from "@cemeworm/shared";
import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";

const cleanupPaths: string[] = [];

function createTempStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-agent-spawn-"));
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
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
};

function parseProviderRequest(init: unknown): MockProviderRequest {
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

function hasWorkspaceToolResult(request: MockProviderRequest, toolId: string): boolean {
  const marker = `Workspace tool result for ${toolId}`;
  return request.latestUserText.includes(marker)
    || request.toolText.includes(marker)
    || request.allText.includes(marker);
}

function unexpectedProviderCall(request: MockProviderRequest): never {
  throw new Error(`Unexpected provider call: ${JSON.stringify({
    systemText: request.systemText,
    latestUserText: request.latestUserText,
    toolText: request.toolText,
    allText: request.allText,
  })}`);
}

async function pollUntilDone(
  handle: ReturnType<typeof createRuntimeMethodHandler>,
  runId: string,
  maxAttempts = 80,
): Promise<{ status: string; toolCalls: Array<{ toolId: string; status: string; error?: string }> }> {
  for (let i = 0; i < maxAttempts; i++) {
    const raw = await handle({ jsonrpc: "2.0", id: 2, method: "runs.state", params: { runId } });
    const parsed = StateSnapshotSchema.safeParse(raw);
    if (parsed.success && (parsed.data.status === "succeeded" || parsed.data.status === "failed")) {
      return { status: parsed.data.status, toolCalls: parsed.data.toolCalls };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { status: "timeout", toolCalls: [] };
}

function runConfig(overrides: Partial<{ toolIds: string[] }> = {}) {
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
    toolIds: overrides.toolIds ?? ["agent.spawn", "file.read"],
  };
}

function codeDevelopmentRunConfig(overrides: Partial<{ toolIds: string[] }> = {}) {
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
    toolIds: overrides.toolIds ?? [
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
  };
}

function selfBuilderRunConfig(overrides: Partial<{ toolIds: string[] }> = {}) {
  return {
    modeId: ORA_SELF_BUILDER_MODE_ID,
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
    toolIds: overrides.toolIds ?? [
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
      "agent.wait",
      "message.send",
      "package.list",
      "package.verify",
      "package.promote",
      "package.switch",
      "package.rollback",
    ],
  };
}

describe("agent.spawn integration", () => {
  it("passes inherit_context and custom system_prompt to sub-agent", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const prevFetch = globalThis.fetch;
    let subAgentSystemText = "";
    let subAgentPromptText = "";
    const requestLog: Array<{ system: string; latestUser: string }> = [];
    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      requestLog.push({
        system: request.systemText.slice(0, 120),
        latestUser: request.latestUserText.slice(0, 200),
      });
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (!hasWorkspaceSpawnResult(request) && request.latestUserText.includes("Find the answer.")) {
        subAgentSystemText = request.systemText;
        subAgentPromptText = request.latestUserText;
        return jsonResponse("The answer is 42, and this delegated research response is intentionally detailed enough for the parent agent to synthesize without triggering the short-output repair path.");
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
        return jsonResponse("The final answer is 42, based on the completed research and the gathered evidence above.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: { input: { prompt: "What is the answer?" }, config: runConfig() },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId);
      if (result.status !== "succeeded") {
        throw new Error(`inherit_context run failed: ${JSON.stringify({ result, requestLog })}`);
      }
      expect(result.status).toBe("succeeded");
      expect(subAgentSystemText).toContain("You are a helpful research assistant.");
      expect(subAgentPromptText).toContain("<inherited-context>");
      expect(subAgentPromptText).toContain("What is the answer?");
    } finally {
      globalThis.fetch = prevFetch;
      process.env.OPENAI_API_KEY = prevKey;
    }
  });

  it("completes a full agent.spawn → sub-agent → synthesize flow through the kernel", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (!hasWorkspaceSpawnResult(request) && request.latestUserText.includes("Find the answer.")) {
        return jsonResponse("The researched answer is 42, with enough context for the parent agent to synthesize.");
      }
      if (request.latestUserText.includes("What is the answer?")) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: { description: "Research", prompt: "Find the answer." },
        }));
      }
      if (hasWorkspaceSpawnResult(request)) {
        return jsonResponse("Based on the completed research, the answer is 42 and this response is intentionally long enough to satisfy the completion guard.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: { input: { prompt: "What is the answer?" }, config: runConfig() },
      }) as { runId?: string; error?: unknown };

      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId);
      expect(result.status).toBe("succeeded");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("forces a delegated collaboration step before completion when single_agent is degraded from an explicit Agent Teams request", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    let sawRequiredCollaborationFollowUp = false;
    const requestLog: Array<{ system: string; latestUser: string; toolText: string }> = [];

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      requestLog.push({
        system: request.systemText.slice(0, 120),
        latestUser: request.latestUserText.slice(0, 240),
        toolText: request.toolText.slice(0, 120),
      });
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (!hasWorkspaceSpawnResult(request) && request.latestUserText.includes("Research MiniMax recent status.")) {
        return jsonResponse("MiniMax recently launched new model and product updates; this delegated research response is intentionally detailed enough for the parent agent to synthesize cleanly.");
      }
      if (request.latestUserText.includes("delegate at least one substantial top-level subtask with agent.spawn")) {
        sawRequiredCollaborationFollowUp = true;
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Research MiniMax",
            prompt: "Research MiniMax recent status.",
          },
        }));
      }
      if (request.latestUserText.includes("What is MiniMax up to lately?")) {
        return jsonResponse("MiniMax has been active recently and here is a direct summary that skips delegation.");
      }
      if (hasWorkspaceSpawnResult(request)) {
        return jsonResponse("Using the delegated research result, here is the final MiniMax summary with the required collaboration incorporated and enough detail to satisfy the completion guard.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: {
          input: {
            prompt: "通过 Agent team 的方式帮我分析一下 MiniMax 最近的情况。What is MiniMax up to lately?",
          },
          config: runConfig(),
        },
      }) as { runId?: string; error?: unknown };

      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId);
      if (result.status !== "succeeded") {
        const raw = await handle({ jsonrpc: "2.0", id: 99, method: "runs.state", params: { runId: start.runId } });
        const parsed = StateSnapshotSchema.parse(raw);
        throw new Error(`degraded collaboration run failed: ${JSON.stringify({
          status: result.status,
          error: parsed.error,
          sawRequiredCollaborationFollowUp,
          toolCalls: result.toolCalls,
          requestLog,
        })}`);
      }
      expect(result.status).toBe("succeeded");
      expect(sawRequiredCollaborationFollowUp).toBe(true);

      const raw = await handle({ jsonrpc: "2.0", id: 3, method: "runs.state", params: { runId: start.runId } });
      const parsed = StateSnapshotSchema.parse(raw);
      expect(parsed.config.effectiveStrategy).toMatchObject({
        sourceModeId: SINGLE_AGENT_MODE_ID,
        delegation: "preferred",
        delegationEnabled: true,
        collaborationRequirement: "required",
        collaborationRequirementSource: "explicit_mode_degraded",
        requestedModeId: "agent_teams",
      });
      expect(parsed.toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({ agentId: "ora", toolId: "agent.spawn", status: "succeeded" }),
      ]));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("sub-agent cannot use agent.spawn (isNestedAgentSpawn filter)", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (!hasWorkspaceSpawnResult(request) && request.latestUserText.includes("Spawn another agent.")) {
        return jsonResponse("The delegated sub-agent answered directly with enough detail to satisfy the completion guard and finish cleanly.");
      }
      if (request.latestUserText.includes("Spawn an agent that spawns another.")) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: { description: "Delegate", prompt: "Spawn another agent." },
        }));
      }
      if (hasWorkspaceSpawnResult(request)) {
        return jsonResponse("The parent agent can now conclude after the delegated sub-agent answered directly with enough detail.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: { input: { prompt: "Spawn an agent that spawns another." }, config: runConfig() },
      }) as { runId?: string; error?: unknown };

      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId);
      expect(result.status).toBe("succeeded");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("starts background sub-agents immediately and injects async results back into the parent", { timeout: 30000 }, async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    const childResult = createDeferred<string>();
    let childStarted = false;
    let sawAsyncResults = false;
    const requestLog: Array<{ system: string; latestUser: string }> = [];

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      requestLog.push({
        system: request.systemText.slice(0, 120),
        latestUser: request.latestUserText.slice(0, 220),
      });
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (!hasWorkspaceSpawnResult(request) && request.latestUserText.includes("Find the answer.")) {
        childStarted = true;
        const content = await childResult.promise;
        return jsonResponse(content);
      }
      if (request.allText.includes("<async-results>")) {
        sawAsyncResults = true;
        return jsonResponse("Using the completed background research result, the answer is 42 and the task can now finish with the delegated evidence incorporated.");
      }
      if (hasWorkspaceSpawnResult(request)) {
        return jsonResponse("I have launched the background research and will wait for it before concluding so the delegated evidence is incorporated.");
      }
      if (request.latestUserText.includes("Coordinate background research")) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Research",
            prompt: "Find the answer.",
            run_in_background: true,
          },
        }));
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const startPromise = handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: { input: { prompt: "Coordinate background research" }, config: runConfig() },
      }) as Promise<{ runId?: string; error?: unknown }>;

      let sawChildStart = false;
      for (let index = 0; index < 20; index += 1) {
        if (childStarted) {
          sawChildStart = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!sawChildStart) {
        const start = await Promise.race([
          startPromise,
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 500)),
        ]);
        throw new Error(`background child did not start: ${JSON.stringify({ start, requestLog })}`);
      }

      childResult.resolve("The answer is 42, and this completed background research response is intentionally detailed enough for the parent agent to incorporate without triggering the short-output repair path.");
      const start = await startPromise;
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify({ start, requestLog })}`);

      const result = await pollUntilDone(handle, start.runId, 60);
      if (result.status !== "succeeded") {
        const raw = await handle({ jsonrpc: "2.0", id: 10, method: "runs.state", params: { runId: start.runId } });
        throw new Error(`background run did not succeed: ${JSON.stringify({ result, raw, sawAsyncResults, requestLog })}`);
      }
      expect(result.status).toBe("succeeded");
      expect(sawAsyncResults).toBe(true);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("supports explicit fan-out plus agent.wait fan-in for multiple background children", { timeout: 30000 }, async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    const alphaResult = createDeferred<string>();
    const betaResult = createDeferred<string>();
    let alphaStarted = false;
    let betaStarted = false;
    let parentStep = 0;
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-agent-spawn-fanin-"));
    cleanupPaths.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "fan-in fixture\n", "utf8");

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (
        request.allText.includes("Find alpha.") &&
        hasWorkspaceToolResult(request, "file.read")
      ) {
        return jsonResponse(await alphaResult.promise);
      }
      if (
        request.allText.includes("Find beta.") &&
        hasWorkspaceToolResult(request, "file.read")
      ) {
        return jsonResponse(await betaResult.promise);
      }
      if (request.latestUserText.includes("Find alpha.")) {
        alphaStarted = true;
        return jsonResponse(JSON.stringify({
          tool: "file.read",
          args: { path: "README.md" },
        }));
      }
      if (request.latestUserText.includes("Find beta.")) {
        betaStarted = true;
        return jsonResponse(JSON.stringify({
          tool: "file.read",
          args: { path: "README.md" },
        }));
      }
      if (hasWorkspaceToolResult(request, "agent.wait")) {
        return jsonResponse("The final answer combines both delegated findings: alpha is 1, beta is 2, and the parent explicitly waited for both child results before concluding.");
      }
      if (request.latestUserText.includes("Coordinate explicit fan-in") && parentStep === 0) {
        parentStep = 1;
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Research alpha",
            prompt: "Find alpha.",
            run_in_background: true,
            tool_bundle: "research_readonly",
            result_contract: "final_answer",
          },
        }));
      }
      if (hasWorkspaceToolResult(request, "agent.spawn") && parentStep === 1) {
        parentStep = 2;
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Research beta",
            prompt: "Find beta.",
            run_in_background: true,
            tool_bundle: "research_readonly",
            result_contract: "final_answer",
          },
        }));
      }
      if (hasWorkspaceToolResult(request, "agent.spawn") && parentStep === 2) {
        parentStep = 3;
        return jsonResponse(JSON.stringify({
          tool: "agent.wait",
          args: { require_all: true },
        }));
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const startPromise = handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: {
          input: {
            prompt: "Coordinate explicit fan-in",
            context: {
              projectWorkspace: {
                label: "Fan-in Validation",
                rootPath: workspaceRoot,
              },
            },
          },
          config: runConfig({ toolIds: ["agent.spawn", "agent.wait", "file.read", "file.grep"] }),
        },
      }) as Promise<{ runId?: string; error?: unknown }>;

      for (let index = 0; index < 40; index += 1) {
        if (alphaStarted && betaStarted) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(alphaStarted).toBe(true);
      expect(betaStarted).toBe(true);

      alphaResult.resolve("Alpha is 1, based on the delegated repository read and summarized clearly for the parent.");
      betaResult.resolve("Beta is 2, based on the delegated repository read and summarized clearly for the parent.");

      const start = await startPromise;
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      expect(result.status).toBe("succeeded");
      const raw = await handle({ jsonrpc: "2.0", id: 88, method: "runs.state", params: { runId: start.runId } });
      const parsed = StateSnapshotSchema.parse(raw);
      expect(parsed.childSessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          label: "Research alpha",
          childTaskIntent: "chat",
          deliveryStatus: "consumed",
        }),
        expect.objectContaining({
          label: "Research beta",
          childTaskIntent: "chat",
          deliveryStatus: "consumed",
        }),
      ]));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("blocks message.send when the target is not an active child owned by the parent", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    let parentStep = 0;
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-agent-spawn-message-gating-"));
    cleanupPaths.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "message gating fixture\n", "utf8");

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (
        request.systemText.includes("ora-sub-1") &&
        hasWorkspaceToolResult(request, "file.read")
      ) {
        return jsonResponse("Alpha is 1, based on the delegated repository read and summarized clearly for the parent.");
      }
      if (request.latestUserText.includes("Find alpha.")) {
        return jsonResponse(JSON.stringify({
          tool: "file.read",
          args: { path: "README.md" },
        }));
      }
      if (request.latestUserText.includes("Validate message gating") && parentStep === 0) {
        parentStep = 1;
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Research alpha",
            prompt: "Find alpha.",
            tool_bundle: "research_readonly",
            result_contract: "final_answer",
          },
        }));
      }
      if (hasWorkspaceToolResult(request, "agent.spawn") && parentStep === 1) {
        parentStep = 2;
        return jsonResponse(JSON.stringify({
          tool: "message.send",
          args: {
            to: "ora-sub-1",
            message: "Please keep going even though you already completed.",
          },
        }));
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: {
          input: {
            prompt: "Validate message gating",
            context: {
              projectWorkspace: {
                label: "Message Gating Validation",
                rootPath: workspaceRoot,
              },
            },
          },
          config: runConfig({ toolIds: ["agent.spawn", "message.send", "file.read"] }),
        },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      expect(result.status).toBe("failed");
      expect(result.toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolId: "message.send",
          status: "failed",
          error: expect.stringContaining("is not an active child owned by agent"),
        }),
      ]));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("does not let reused sync named sub-agents inherit prior tool usage stats", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    let parentStep = 0;
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-agent-spawn-sync-"));
    cleanupPaths.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Named sync sub-agent fixture\n", "utf8");

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (
        request.systemText.includes("ora#sync-1") &&
        hasWorkspaceToolResult(request, "file.read")
      ) {
        return jsonResponse("Alpha is 1, based on a real delegated repository read with enough detail for the parent to continue.");
      }
      if (request.latestUserText.includes("Find alpha.")) {
        return jsonResponse(JSON.stringify({
          tool: "file.read",
          args: { path: "README.md" },
        }));
      }
      if (request.latestUserText.includes("Find beta.")) {
        return jsonResponse("Beta is 2, but this response intentionally skipped all tool execution.");
      }
      if (request.latestUserText.includes("Coordinate sync reuse validation") && parentStep === 0) {
        parentStep = 1;
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Research alpha",
            prompt: "Find alpha.",
            agent_type: "ora",
            tool_bundle: "research_readonly",
            result_contract: "final_answer",
          },
        }));
      }
      if (hasWorkspaceSpawnResult(request) && parentStep === 1) {
        parentStep = 2;
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Research beta",
            prompt: "Find beta.",
            agent_type: "ora",
            tool_bundle: "research_readonly",
            result_contract: "final_answer",
          },
        }));
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0", id: 1, method: "runs.start",
        params: {
          input: {
            prompt: "Coordinate sync reuse validation",
            context: {
              projectWorkspace: {
                label: "Sync Reuse Validation",
                rootPath: workspaceRoot,
              },
            },
          },
          config: runConfig({ toolIds: ["agent.spawn", "file.read", "file.grep"] }),
        },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      expect(result.status).toBe("failed");
      expect(result.toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolId: "agent.spawn",
          status: "failed",
          error: expect.stringContaining('did not execute any real tools for bundle "research_readonly"'),
        }),
      ]));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("returns a structured blocked result when builder_write preflight has no patch capability", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (request.latestUserText.includes("Patch README via builder_write")) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Patch README",
            prompt: "Patch README via builder_write",
            tool_bundle: "builder_write",
          },
        }));
      }
      if (hasWorkspaceSpawnResult(request)) {
        return jsonResponse("The builder_write spawn was blocked, so I will stay in the current read-only surface.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Patch README via builder_write" },
          config: runConfig({ toolIds: ["agent.spawn", "file.read", "file.grep"] }),
        },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      expect(result.status).toBe("succeeded");

      const raw = await handle({ jsonrpc: "2.0", id: 8, method: "runs.state", params: { runId: start.runId } });
      const parsed = StateSnapshotSchema.parse(raw);
      expect(parsed.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "agent_spawn_preflight.completed",
          payload: expect.objectContaining({
            requestedPreset: "builder_write",
            status: "blocked",
          }),
        }),
      ]));
      expect(parsed.toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolId: "agent.spawn",
          status: "succeeded",
          result: expect.objectContaining({
            output: expect.objectContaining({
              status: "blocked",
              authority_source: "dynamic_spawn",
              diagnostic_type: "spawn_authority_mismatch",
              tool_bundle: "builder_write",
              requested_tool_preset: "builder_write",
              resolved_tool_preset: "builder_write",
            }),
          }),
        }),
      ]));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("blocks explicit task_intent/result_contract mismatches even without an explicit tool surface", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (request.latestUserText.includes("Draft a plan but require execution")) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Plan mismatch",
            prompt: "Draft a plan but require execution",
            task_intent: "plan",
            result_contract: "final_answer",
          },
        }));
      }
      if (hasWorkspaceSpawnResult(request)) {
        return jsonResponse("The runtime correctly blocked the mismatched spawn and I stayed in the parent context.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Draft a plan but require execution" },
          config: runConfig({ toolIds: ["agent.spawn", "file.read"] }),
        },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      expect(result.status).toBe("succeeded");

      const raw = await handle({ jsonrpc: "2.0", id: 18, method: "runs.state", params: { runId: start.runId } });
      const parsed = StateSnapshotSchema.parse(raw);
      expect(parsed.toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolId: "agent.spawn",
          status: "succeeded",
          result: expect.objectContaining({
            output: expect.objectContaining({
              status: "blocked",
              diagnostic_type: "spawn_task_intent_contract_mismatch",
            }),
          }),
        }),
      ]));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("blocks dynamic spawn when the prompt implies shell execution but the resolved surface is readonly", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (request.latestUserText.includes("Capture the target article safely.")) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Capture article",
            prompt: "Run /tmp/run_capture.sh against https://example.com/article and summarize the article.",
            tool_bundle: "research_readonly",
          },
        }));
      }
      if (hasWorkspaceSpawnResult(request)) {
        return jsonResponse("The requested article capture was blocked because the delegated surface cannot perform shell-backed capture safely.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Capture the target article safely." },
          config: runConfig({ toolIds: ["agent.spawn", "file.read", "web.fetch", "web.search"] }),
        },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      expect(result.status).toBe("succeeded");

      const raw = await handle({ jsonrpc: "2.0", id: 9, method: "runs.state", params: { runId: start.runId } });
      const parsed = StateSnapshotSchema.parse(raw);
      expect(parsed.toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolId: "agent.spawn",
          status: "succeeded",
          result: expect.objectContaining({
            output: expect.objectContaining({
              status: "blocked",
              diagnostic_type: "spawn_affordance_mismatch",
              spawn_contract: expect.objectContaining({
                source: "inferred",
                requiredAffordances: expect.arrayContaining(["shell_execute", "web_read"]),
                subject: expect.objectContaining({
                  kind: "url",
                  value: "https://example.com/article",
                }),
              }),
            }),
          }),
        }),
      ]));
      expect(parsed.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "agent_spawn_preflight.completed",
          payload: expect.objectContaining({
            requestedPreset: "research_readonly",
            spawnContract: expect.objectContaining({
              source: "inferred",
            }),
          }),
        }),
      ]));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("fails a child result that drifts away from the bound URL subject", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-agent-spawn-drift-"));
    cleanupPaths.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "This is unrelated local context.\n", "utf8");

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (request.latestUserText.includes("Summarize the bound article safely.")) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Bound article",
            prompt: "Summarize https://example.com/article and stay on that article.",
            tool_ids: ["file.read", "web.fetch"],
            spawn_contract: {
              required_affordances: ["web_read"],
              subject: {
                kind: "url",
                value: "https://example.com/article",
                normalization: "url_canonical",
                normalized_value: "https://example.com/article",
              },
              resource_bindings: [
                {
                  locator: "value",
                  kind: "url",
                  value: "https://example.com/article",
                  normalization: "url_canonical",
                  normalized_value: "https://example.com/article",
                  required: true,
                },
              ],
              side_effect_policy: "none",
              result_rules: ["subject_match_required", "resource_binding_match_required", "source_reference_required"],
              validation_policy: "enforce",
            },
          },
        }));
      }
      if (!hasWorkspaceSpawnResult(request) && request.latestUserText.includes("Summarize https://example.com/article and stay on that article.")) {
        return jsonResponse(JSON.stringify({
          tool: "file.read",
          args: { path: "README.md" },
        }));
      }
      if (!hasWorkspaceSpawnResult(request) && hasWorkspaceToolResult(request, "file.read")) {
        return jsonResponse("I reviewed a local file and generated a long summary that is intentionally grounded in unrelated local context rather than the requested article URL, so the runtime should reject this result as a subject and resource binding drift before the parent can consume it.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Summarize the bound article safely.",
            context: {
              projectWorkspace: {
                label: "Bound Article Drift",
                rootPath: workspaceRoot,
              },
            },
          },
          config: runConfig({ toolIds: ["agent.spawn", "file.read", "web.fetch"] }),
        },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      expect(result.status).toBe("failed");

      const raw = await handle({ jsonrpc: "2.0", id: 10, method: "runs.state", params: { runId: start.runId } });
      const parsed = StateSnapshotSchema.parse(raw);
      expect(parsed.toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolId: "agent.spawn",
          status: "failed",
          error: expect.stringContaining("violated the spawn contract"),
        }),
      ]));
      expect(parsed.childSessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          spawnContract: expect.objectContaining({
            source: "explicit",
            subject: expect.objectContaining({
              kind: "url",
              value: "https://example.com/article",
            }),
          }),
        }),
      ]));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("keeps child results but emits warnings when handle binding validation is diagnostics-only", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-agent-spawn-soft-validation-"));
    cleanupPaths.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "Local fallback content for warning path.\n", "utf8");

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (request.latestUserText.includes("Summarize with handle warning.")) {
        return jsonResponse(JSON.stringify({
          tool: "agent.spawn",
          args: {
            description: "Handle warning",
            prompt: "Summarize https://example.com/article but keep going even if the bound browser session cannot be proven.",
            tool_ids: ["file.read", "web.fetch"],
            spawn_contract: {
              required_affordances: ["web_read"],
              subject: {
                kind: "url",
                value: "https://example.com/article",
                normalization: "url_canonical",
                normalized_value: "https://example.com/article",
              },
              resource_bindings: [
                {
                  locator: "handle",
                  handle_kind: "browser_session",
                  handle_id: "session-123",
                  required: true,
                  label: "Expected browser session",
                },
              ],
              side_effect_policy: "none",
              result_rules: ["resource_binding_match_required", "source_reference_required"],
              validation_policy: "diagnostics_only",
            },
          },
        }));
      }
      if (!hasWorkspaceSpawnResult(request) && request.latestUserText.includes("Summarize https://example.com/article but keep going even if the bound browser session cannot be proven.")) {
        return jsonResponse(JSON.stringify({
          tool: "file.read",
          args: { path: "README.md" },
        }));
      }
      if (!hasWorkspaceSpawnResult(request) && hasWorkspaceToolResult(request, "file.read")) {
        return jsonResponse("This is a deliberately long delegated answer that still finishes successfully even though the required browser-session handle was never observed in child tool evidence, so the runtime should surface a warning instead of blocking the result.");
      }
      if (hasWorkspaceSpawnResult(request)) {
        return jsonResponse("The delegated summary completed, and I also noticed the child result carried a spawn validation warning that should remain visible to the parent synthesizer.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "Summarize with handle warning.",
            context: {
              projectWorkspace: {
                label: "Handle Warning Workspace",
                rootPath: workspaceRoot,
              },
            },
          },
          config: runConfig({ toolIds: ["agent.spawn", "file.read", "web.fetch"] }),
        },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      expect(result.status).toBe("succeeded");

      const raw = await handle({ jsonrpc: "2.0", id: 11, method: "runs.state", params: { runId: start.runId } });
      const parsed = StateSnapshotSchema.parse(raw);
      expect(parsed.toolCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolId: "agent.spawn",
          status: "succeeded",
        }),
      ]));
      expect(parsed.childSessions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: "succeeded",
          spawnValidation: expect.objectContaining({
            status: "failed",
            policy: "diagnostics_only",
            effect: "warning",
            violations: expect.arrayContaining([
              expect.objectContaining({
                code: "resource_binding_mismatch",
              }),
            ]),
            observedHandles: expect.any(Array),
          }),
        }),
      ]));
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("records mode-stage child authority separately from dynamic spawn", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (request.latestUserText.includes("创建一个紧凑的开发计划")) {
        return jsonResponse(JSON.stringify({
          text: "Implement the requested README change.",
          goal: "Adjust the README with a minimal verified change.",
          successCriteria: ["Builder completes the scoped change", "Review passes", "Debug confirms no remaining issue"],
          backlog: [{ id: "1", owner: "builder", description: "Update the README wording." }],
          scopeBoundaries: ["No unrelated refactors"],
          taskJournalPath: "tasks/TASK-test.md",
          targetFiles: ["README.md"],
          verificationPlan: [{ id: "verify-1", commandOrMethod: "mock review", expectation: "README-only change remains in scope" }],
          riskFiles: ["README.md"],
          doneCriteria: ["Focused verification evidence is captured"],
        }));
      }
      if (request.latestUserText.includes("做出最小的可行代码变更")) {
        return jsonResponse(JSON.stringify({
          text: "Updated README wording and captured focused verification evidence.",
          artifacts: ["README.md"],
          changedFiles: ["README.md"],
          commandsRun: [{ command: "mock review", exitCode: 0, summary: "Confirmed the README-only change remained scoped." }],
          verificationEvidence: [{ verificationId: "verify-1", result: "pass", summary: "README.md was the only reported artifact." }],
          assumptions: ["This integration test simulates the file edit without mutating disk."],
          followups: [],
        }));
      }
      if (request.latestUserText.includes("逐条对照开发计划中的 successCriteria")) {
        return jsonResponse(JSON.stringify({
          text: "Review passed. The builder stayed in scope and provided the expected verification evidence.",
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
          diagnosticEvidence: [{ commandOrMethod: "mock review", summary: "No failing runtime evidence remains in this scenario." }],
          remainingRisks: [],
        }));
      }
      if (
        request.latestUserText.includes("撰写最终移交报告")
        || (request.latestUserText.includes("已验收产物") && request.latestUserText.includes("todoScanResult"))
      ) {
        return jsonResponse(JSON.stringify({
          text: "Handoff complete for the README-only change.",
          deliveredFiles: ["README.md"],
          acceptedFiles: ["README.md"],
          taskJournalPath: "tasks/TASK-test.md",
          todoScanResult: { status: "clean", summary: "No blocking TODO items remain in this mock scenario." },
          doneGate: { status: "pass", blockers: [] },
          verificationSummary: [{ verificationId: "verify-1", result: "pass", summary: "Reviewer passed and debugger stayed clear." }],
          residualRisks: ["This integration path is mocked and does not mutate disk."],
        }));
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Make a minimal README update and hand it off." },
          config: {
            ...codeDevelopmentRunConfig(),
            metadata: { disableMemoryUpdate: true },
          },
        },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      const raw = await handle({ jsonrpc: "2.0", id: 9, method: "runs.state", params: { runId: start.runId } });
      const parsed = StateSnapshotSchema.parse(raw);
      if (result.status !== "succeeded") {
        throw new Error(`Mode-stage authority run failed: ${JSON.stringify({
          status: parsed.status,
          error: parsed.error,
          output: parsed.output,
          toolCalls: parsed.toolCalls,
          childSessions: parsed.childSessions,
        })}`);
      }
      const builderChild = parsed.childSessions.find((session) => session.agentId === "builder");
      const reviewerChild = parsed.childSessions.find((session) => session.agentId === "reviewer");
      const debuggerChild = parsed.childSessions.find((session) => session.agentId === "debugger");

      expect(builderChild).toMatchObject({
        sessionClass: "mode_subagent",
        delegationKind: "mode_stage",
        authoritySource: "mode_stage",
        requestedToolPreset: "builder_write",
        resolvedToolPreset: "builder_write",
        status: "succeeded",
      });
      expect(builderChild?.resolvedToolIds).toEqual(expect.arrayContaining(["file.apply_patch", "shell.execute"]));
      expect(reviewerChild).toMatchObject({
        sessionClass: "mode_subagent",
        delegationKind: "mode_stage",
        authoritySource: "mode_stage",
        requestedToolPreset: "review_readonly",
        resolvedToolPreset: "review_readonly",
        status: "succeeded",
      });
      expect(debuggerChild).toMatchObject({
        sessionClass: "mode_subagent",
        delegationKind: "mode_stage",
        authoritySource: "mode_stage",
        requestedToolPreset: "repo_forensics",
        resolvedToolPreset: "repo_forensics",
        status: "succeeded",
      });
      expect(parsed.childSessions.some((session) => session.authoritySource === "dynamic_spawn")).toBe(false);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("blocks ora_self_builder build stages before model execution when package.buildCandidate is unavailable", async () => {
    process.env.NODE_LOOP_TOOL_KEY = "test";
    const prevFetch = globalThis.fetch;
    const latestUserTexts: string[] = [];

    globalThis.fetch = (async (_input, init) => {
      const request = parseProviderRequest(init);
      latestUserTexts.push(request.latestUserText);
      const infraResponse = maybeHandleInfraProviderRequest(request);
      if (infraResponse) {
        return infraResponse;
      }
      if (request.latestUserText.includes("Create or update the task journal")) {
        return jsonResponse("Planned the self-builder task, scoped verification to the candidate package flow, and confirmed the next stage should build only after the required package surface is available.");
      }
      return unexpectedProviderCall(request);
    }) as typeof fetch;

    try {
      const handle = createRuntimeMethodHandler(createTempStore());
      const start = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: { prompt: "Adjust Ora itself with the self-builder workflow." },
          config: {
            ...selfBuilderRunConfig(),
            metadata: { disableMemoryUpdate: true },
          },
        },
      }) as { runId?: string; error?: unknown };
      if (!start.runId) throw new Error(`Start failed: ${JSON.stringify(start)}`);

      const result = await pollUntilDone(handle, start.runId, 80);
      expect(result.status).toBe("failed");

      const raw = await handle({ jsonrpc: "2.0", id: 10, method: "runs.state", params: { runId: start.runId } });
      const parsed = StateSnapshotSchema.parse(raw);
      const builderChild = parsed.childSessions.find((session) => session.agentId === "builder");

      expect(parsed.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "mode_stage_preflight.completed",
          payload: expect.objectContaining({
            status: "blocked",
            preflight: expect.objectContaining({
              status: "blocked",
              presetId: "self_builder_build",
              missingCapabilities: expect.arrayContaining(["package_build_candidate"]),
            }),
            diagnostic: expect.objectContaining({
              diagnosticType: "mode_stage_authority_mismatch",
              requestedToolPreset: "self_builder_build",
              resolvedToolPreset: "self_builder_build",
            }),
          }),
        }),
      ]));
      expect(parsed.error).toContain('Mode stage blocked: preset "self_builder_build"');
      expect(parsed.error).toContain("package_build_candidate");
      expect(builderChild).toMatchObject({
        sessionClass: "mode_subagent",
        delegationKind: "mode_stage",
        authoritySource: "mode_stage",
        requestedToolPreset: "self_builder_build",
        resolvedToolPreset: "self_builder_build",
        modeStagePreflight: expect.objectContaining({
          status: "blocked",
          presetId: "self_builder_build",
        }),
        modeStageDiagnostic: expect.objectContaining({
          diagnosticType: "mode_stage_authority_mismatch",
          authoritySource: "mode_stage",
        }),
        status: "failed",
      });
      expect(builderChild?.summary).toContain("package_build_candidate");
      expect(parsed.topology.nodes.some((node) => node.agentId === "builder" && node.status === "blocked")).toBe(true);
      expect(latestUserTexts.some((text) => text.includes("Make the smallest source changes, run focused checks"))).toBe(false);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

});
