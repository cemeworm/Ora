import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SINGLE_AGENT_MODE_ID,
  StateSnapshotSchema,
  getModePreset,
  modeSpecToPatternDefinition,
} from "@cemeworm/shared";
import { executeRuntimeKernel } from "../src/index.js";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-final-output-guard-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("final output completeness guard (integration)", () => {
  it("does not succeed with empty output when model returns empty post-tool response", async () => {
    // Simulates run-0018 shape:
    // 1. Model emits text with a tool call intent
    // 2. Tool executes successfully
    // 3. Post-tool model response is empty
    //
    // Expected: run must not complete with status=succeeded and empty output.
    // The guard should either trigger a repair or fail with a concrete error.

    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const workspaceRoot = fs.mkdtempSync(path.join(tempDir, "workspace-"));
    fs.writeFileSync(path.join(workspaceRoot, "target.txt"), "hello\n", "utf8");

    let providerCalls = 0;
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.FINAL_OUTPUT_GUARD_KEY;
    process.env.FINAL_OUTPUT_GUARD_KEY = "test";
    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      if (providerCalls === 1) {
        // First call: model requests a tool
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call-read-1",
                type: "function",
                function: {
                  name: "file__read",
                  arguments: JSON.stringify({ path: "target.txt" }),
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (providerCalls === 2) {
        // Second call (post-tool): model returns empty text
        // This is the run-0018 scenario
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "",
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (providerCalls === 3) {
        // Third call (repair turn): model returns final answer
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "The file contains 'hello'. This is the final answer after repair.",
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Unexpected provider call." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const { snapshot } = await executeRuntimeKernel(
        "run-final-output-001",
        {
          prompt: "Read target.txt and summarize.",
          createdAt: 1,
          context: { projectWorkspace: { label: "Test", rootPath: workspaceRoot } },
        },
        {
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "final-output-guard",
          modelRef: "final-output-guard-model",
          providerConfig: {
            id: "final-output-guard",
            label: "Final Output Guard",
            type: "openai_compatible",
            modelId: "final-output-guard-model",
            baseUrl: "https://final-output-guard.test/v1",
            apiKeyEnv: "FINAL_OUTPUT_GUARD_KEY",
            capabilities: ["chat", "tool_use"],
            headers: {},
          },
          metadata: {},
          profileIds: ["solo_agent"],
          skillIds: [],
          toolIds: ["file.read"],
          approvalMode: "auto",
          budget: { maxTokens: 1024, maxToolCalls: 4, maxRuntimeMs: 60_000 },
        },
        { modeSpec, definition },
      );

      // Should not succeed with empty output
      // The repair turn (call 3) should have produced the final answer
      expect(snapshot.status).toBe("succeeded");
      const output = snapshot.output as { text?: string };
      expect(output.text).toBeTruthy();
      expect(output.text).toContain("final answer after repair");
      // Provider was called exactly 3 times: initial, post-tool, repair
      expect(providerCalls).toBe(3);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.FINAL_OUTPUT_GUARD_KEY;
      } else {
        process.env.FINAL_OUTPUT_GUARD_KEY = previousKey;
      }
    }
  });

  it("triggers exactly one no-tools repair turn when post-tool response is empty", async () => {
    // Verifies that an empty post-tool response triggers exactly one
    // no-tools repair turn before completing.

    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const workspaceRoot = fs.mkdtempSync(path.join(tempDir, "workspace-"));
    fs.writeFileSync(path.join(workspaceRoot, "target.txt"), "hello\n", "utf8");

    let providerCalls = 0;
    let repairCallHadTools = false;
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.REPAIR_TURN_KEY;
    process.env.REPAIR_TURN_KEY = "test";
    globalThis.fetch = (async (_input, init) => {
      providerCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tool_choice?: string;
        tools?: unknown[];
      };

      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call-read-2",
                type: "function",
                function: {
                  name: "file__read",
                  arguments: JSON.stringify({ path: "target.txt" }),
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (providerCalls === 2) {
        // Post-tool: empty response
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "stop",
            message: { role: "assistant", content: "" },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (providerCalls === 3) {
        // Repair turn: should be called with tool_choice="none"
        if (body.tool_choice === "none") {
          repairCallHadTools = false;
        } else if (body.tools && (body.tools as unknown[]).length > 0) {
          repairCallHadTools = true;
        }
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "stop",
            message: { role: "assistant", content: "Repaired: file contains 'hello'." },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Extra call." } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const { snapshot } = await executeRuntimeKernel(
        "run-repair-turn",
        {
          prompt: "Read target.txt and summarize.",
          createdAt: 1,
          context: { projectWorkspace: { label: "Test", rootPath: workspaceRoot } },
        },
        {
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "repair-turn",
          modelRef: "repair-turn-model",
          providerConfig: {
            id: "repair-turn",
            label: "Repair Turn",
            type: "openai_compatible",
            modelId: "repair-turn-model",
            baseUrl: "https://repair-turn.test/v1",
            apiKeyEnv: "REPAIR_TURN_KEY",
            capabilities: ["chat", "tool_use"],
            headers: {},
          },
          metadata: {},
          profileIds: ["solo_agent"],
          skillIds: [],
          toolIds: ["file.read"],
          approvalMode: "auto",
          budget: { maxTokens: 1024, maxToolCalls: 4, maxRuntimeMs: 60_000 },
        },
        { modeSpec, definition },
      );

      expect(snapshot.status).toBe("succeeded");
      // Exactly 3 calls: initial, post-tool, repair
      expect(providerCalls).toBe(3);
      // Repair call should not have tools enabled
      expect(repairCallHadTools).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.REPAIR_TURN_KEY;
      } else {
        process.env.REPAIR_TURN_KEY = previousKey;
      }
    }
  });

  it("fails with concrete error when repair turn also returns empty", async () => {
    // Verifies that repeated empty repair results become failed/degraded
    // with a concrete error, not succeeded with empty output.

    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const workspaceRoot = fs.mkdtempSync(path.join(tempDir, "workspace-"));
    fs.writeFileSync(path.join(workspaceRoot, "target.txt"), "hello\n", "utf8");

    let providerCalls = 0;
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.DOUBLE_EMPTY_KEY;
    process.env.DOUBLE_EMPTY_KEY = "test";
    globalThis.fetch = (async () => {
      providerCalls += 1;

      if (providerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call-read-3",
                type: "function",
                function: {
                  name: "file__read",
                  arguments: JSON.stringify({ path: "target.txt" }),
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // All subsequent calls return empty text
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "" },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const { snapshot } = await executeRuntimeKernel(
        "run-double-empty",
        {
          prompt: "Read target.txt and summarize.",
          createdAt: 1,
          context: { projectWorkspace: { label: "Test", rootPath: workspaceRoot } },
        },
        {
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "double-empty",
          modelRef: "double-empty-model",
          providerConfig: {
            id: "double-empty",
            label: "Double Empty",
            type: "openai_compatible",
            modelId: "double-empty-model",
            baseUrl: "https://double-empty.test/v1",
            apiKeyEnv: "DOUBLE_EMPTY_KEY",
            capabilities: ["chat", "tool_use"],
            headers: {},
          },
          metadata: {},
          profileIds: ["solo_agent"],
          skillIds: [],
          toolIds: ["file.read"],
          approvalMode: "auto",
          budget: { maxTokens: 1024, maxToolCalls: 4, maxRuntimeMs: 60_000 },
        },
        { modeSpec, definition },
      );

      // Should NOT succeed
      expect(snapshot.status).not.toBe("succeeded");
      // Should be failed with an error containing "final_output_empty" or similar
      const error = snapshot.error;
      expect(error).toBeTruthy();
      expect(
        error?.includes("final_output_empty") ||
        error?.includes("final output is empty") ||
        error?.includes("empty after repair"),
      ).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.DOUBLE_EMPTY_KEY;
      } else {
        process.env.DOUBLE_EMPTY_KEY = previousKey;
      }
    }
  });

  it("allows successful completion when forced-final fallback produces non-empty text", async () => {
    // Verifies existing forced-final fallback behavior is not regressed.
    // When tool budget is exhausted, the runtime should still complete
    // successfully if the forced-final response is non-empty.

    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);

    let providerCalls = 0;
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.FORCED_FINAL_GUARD_KEY;
    process.env.FORCED_FINAL_GUARD_KEY = "test";
    globalThis.fetch = (async () => {
      providerCalls += 1;

      // Always return non-empty text, but trigger tool calls to exhaust budget
      if (providerCalls <= 2) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: `call-tool-${providerCalls}`,
                type: "function",
                function: {
                  name: "file__read",
                  arguments: JSON.stringify({ path: "nonexistent.txt" }),
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // Forced final call: return non-empty text
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { role: "assistant", content: "Tool budget exhausted. Final summary based on available data." },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const { snapshot } = await executeRuntimeKernel(
        "run-forced-final",
        {
          prompt: "Read files and summarize.",
          createdAt: 1,
          context: {},
        },
        {
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "forced-final-guard",
          modelRef: "forced-final-guard-model",
          providerConfig: {
            id: "forced-final-guard",
            label: "Forced Final Guard",
            type: "openai_compatible",
            modelId: "forced-final-guard-model",
            baseUrl: "https://forced-final-guard.test/v1",
            apiKeyEnv: "FORCED_FINAL_GUARD_KEY",
            capabilities: ["chat", "tool_use"],
            headers: {},
          },
          metadata: {},
          profileIds: ["solo_agent"],
          skillIds: [],
          toolIds: ["file.read"],
          approvalMode: "auto",
          budget: { maxTokens: 1024, maxToolCalls: 2, maxRuntimeMs: 60_000 },
        },
        { modeSpec, definition },
      );

      expect(snapshot.status).toBe("succeeded");
      const output = snapshot.output as { text?: string };
      expect(output.text).toBeTruthy();
      expect(output.text).toContain("Tool budget exhausted");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.FORCED_FINAL_GUARD_KEY;
      } else {
        process.env.FORCED_FINAL_GUARD_KEY = previousKey;
      }
    }
  });
});
