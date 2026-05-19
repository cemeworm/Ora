import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SINGLE_AGENT_MODE_ID, StateSnapshotSchema } from "@cemeworm/shared";
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
    let sawWaitToolResult = false;

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
        sawWaitToolResult = true;
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
          input: { prompt: "Coordinate explicit fan-in" },
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
      expect(sawWaitToolResult).toBe(true);
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

});
