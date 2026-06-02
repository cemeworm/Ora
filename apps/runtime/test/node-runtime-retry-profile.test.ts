import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SINGLE_AGENT_MODE_ID,
  StateSnapshotSchema,
} from "@cemeworm/shared";
import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";

function createTempStore() {
  return new LocalRunStore({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-retry-profile-store-")),
  });
}

describe("node runtime progressed completion retry profile", () => {
  let workspaceRoot = "";

  afterEach(() => {
    if (workspaceRoot) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("gives explicit content-search initial completions the stronger progressed retry budget", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.EXPLICIT_SEARCH_RETRY_KEY;
    process.env.EXPLICIT_SEARCH_RETRY_KEY = "test";
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ora-retry-profile-workspace-"));
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "search.ts"),
      [
        "export const cacheHitRatio = 0.91;",
        "export class AgenticEfficiencyLedger {",
        "  value() {",
        "    return cacheHitRatio;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    let initialSearchFetchAttempts = 0;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: unknown[];
        messages?: Array<{ role?: string; content?: string }>;
      };
      const messages = body.messages ?? [];
      const hasToolResult = messages.some((message) => message.role === "tool");
      const hasReadResult = messages.some((message) =>
        message.role === "tool" && String(message.content ?? "").includes("Workspace tool result for file.read"),
      );
      const hasGrepResult = messages.some((message) =>
        message.role === "tool" && String(message.content ?? "").includes("Workspace tool result for file.grep"),
      );

      if (!Array.isArray(body.tools) || body.tools.length === 0) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{}" } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (!hasToolResult) {
        initialSearchFetchAttempts += 1;
        if (initialSearchFetchAttempts <= 4) {
          throw new Error("fetch failed", {
            cause: Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" }),
          });
        }
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-explicit-grep",
                type: "function",
                function: {
                  name: "file__grep",
                  arguments: "{\"path\":\"src\",\"pattern\":\"cacheHitRatio|AgenticEfficiencyLedger\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      if (hasGrepResult && !hasReadResult) {
        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{
                id: "call-explicit-read",
                type: "function",
                function: {
                  name: "file__read",
                  arguments: "{\"path\":\"src/search.ts\"}",
                },
              }],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: [
              "已完成真实搜索。",
              "我先用 file.grep 定位了 `cacheHitRatio` 和 `AgenticEfficiencyLedger`，随后读取了 `src/search.ts`。",
              "这两个标识都在同一个源码文件中出现，可以继续按该文件里的上下文追踪定义和引用。",
            ].join(" "),
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      const run = await handle({
        jsonrpc: "2.0",
        id: 1,
        method: "runs.start",
        params: {
          input: {
            prompt: "请搜索 `cacheHitRatio` 和 `AgenticEfficiencyLedger` 的所有出现位置，给出文件路径、行号和上下文。",
            context: {
              projectWorkspace: {
                label: "Retry Profile Workspace",
                rootPath: workspaceRoot,
              },
            },
          },
          config: {
            modeId: SINGLE_AGENT_MODE_ID,
            providerId: "explicit-search-retry",
            modelRef: "explicit-search-retry-model",
            providerConfig: {
              id: "explicit-search-retry",
              label: "Explicit Search Retry",
              type: "openai_compatible",
              modelId: "explicit-search-retry-model",
              baseUrl: "https://explicit-search-retry.test/v1",
              apiKeyEnv: "EXPLICIT_SEARCH_RETRY_KEY",
              capabilities: ["chat", "tool_use"],
              headers: {},
            },
            toolIds: ["file.grep", "file.read"],
          },
        },
      }) as { runId: string; status: string };

      const state = StateSnapshotSchema.parse(await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }));

      expect(run.status).toBe("succeeded");
      expect(state.status).toBe("succeeded");
      expect(initialSearchFetchAttempts).toBe(5);
      expect(state.toolCalls.map((call) => call.toolId)).toContain("file.grep");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.EXPLICIT_SEARCH_RETRY_KEY;
      } else {
        process.env.EXPLICIT_SEARCH_RETRY_KEY = previousKey;
      }
    }
  });
});
