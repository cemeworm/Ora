import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SINGLE_AGENT_MODE_ID,
  getModePreset,
  modeSpecToPatternDefinition,
} from "@cemeworm/shared";
import { executeRuntimeKernel } from "../src/index.js";

type ProviderRequestBody = {
  messages?: Array<{ role?: string; content?: string | null }>;
  tool_choice?: string;
};

function textResponse(content: string): Response {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: {
        role: "assistant",
        content,
      },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function toolResponse(id: string, name: string, args: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id,
          type: "function",
          function: {
            name,
            arguments: JSON.stringify(args),
          },
        }],
      },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-causal-stage2-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("causal decision stage2 runtime policies", () => {
  it("forces a freshness follow-up before allowing final completion", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const workspaceRoot = fs.mkdtempSync(path.join(tempDir, "workspace-"));
    const previousFetch = globalThis.fetch;
    const previousProviderKey = process.env.CAUSAL_STAGE2_FRESHNESS_PROVIDER_KEY;
    let providerCalls = 0;
    let webSearchCalls = 0;
    process.env.CAUSAL_STAGE2_FRESHNESS_PROVIDER_KEY = "provider-key";
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("duckduckgo.com/html/")) {
        webSearchCalls += 1;
        return new Response(`
          <a class="result__a" href="/l/?uddg=https%3A%2F%2Freact.dev%2Fblog%2F2024%2F12%2F05%2Freact-19">React 19 Release</a>
          <a class="result__snippet">Official React 19 release notes covering Actions and the use API.</a>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (!url.includes("freshness-policy.test")) {
        throw new Error(`Unexpected fetch ${url}`);
      }

      providerCalls += 1;
      JSON.parse(String(init?.body ?? "{}")) as ProviderRequestBody;
      if (providerCalls === 1) {
        return textResponse("React 19 带来了 Actions、use API 和 hydration 改进。");
      }
      if (providerCalls === 2) {
        return toolResponse("call-search-react19", "web__search", {
          query: "React 19 new features official release",
          limit: 3,
        });
      }
      if (providerCalls >= 3) {
        return textResponse(
          "根据刚才的搜索结果，React 19 的官方发布说明覆盖了 Actions、`use` API 和 hydration 相关改进。"
          + " 这次回答基于刚刚检索到的 React 19 发布页，而不是未验证的旧知识，因此更适合回答“最新特性”这类时效敏感问题。",
        );
      }
      throw new Error(`Unexpected provider call ${providerCalls}`);
    }) as typeof fetch;

    try {
      const { snapshot } = await executeRuntimeKernel(
        "run-causal-stage2-freshness",
        {
          prompt: "React 19 有哪些新特性",
          createdAt: 1,
          context: { projectWorkspace: { label: "Test", rootPath: workspaceRoot } },
        },
        {
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "causal-stage2-freshness",
          modelRef: "causal-stage2-freshness-model",
          providerConfig: {
            id: "causal-stage2-freshness",
            label: "Causal Stage2 Freshness",
            type: "openai_compatible",
            modelId: "causal-stage2-freshness-model",
            baseUrl: "https://freshness-policy.test/v1",
            apiKeyEnv: "CAUSAL_STAGE2_FRESHNESS_PROVIDER_KEY",
            capabilities: ["chat", "tool_use"],
            headers: {},
          },
          searchProvider: { id: "duckduckgo" },
          metadata: {
            causalFreshnessBlockPolicy: true,
          },
          profileIds: ["solo_agent"],
          skillIds: [],
          toolIds: ["web.search"],
          approvalMode: "auto",
          budget: { maxTokens: 1024, maxToolCalls: 4, maxRuntimeMs: 60_000 },
        },
        { modeSpec, definition },
      );

      expect(snapshot.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(3);
      expect(webSearchCalls).toBe(1);
      expect(snapshot.toolCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolId: "web.search",
            status: "succeeded",
          }),
        ]),
      );
      expect(snapshot.output).toMatchObject({
        text: expect.stringContaining("根据刚才的搜索结果"),
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousProviderKey === undefined) {
        delete process.env.CAUSAL_STAGE2_FRESHNESS_PROVIDER_KEY;
      } else {
        process.env.CAUSAL_STAGE2_FRESHNESS_PROVIDER_KEY = previousProviderKey;
      }
    }
  });

  it("forces reading referenced context before allowing other tool execution", async () => {
    const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID)!;
    const definition = modeSpecToPatternDefinition(modeSpec);
    const workspaceRoot = fs.mkdtempSync(path.join(tempDir, "workspace-"));
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "auth.ts"),
      "export function validateToken(token: string) { return token.trim().length > 0; }\n",
      "utf8",
    );
    const previousFetch = globalThis.fetch;
    const previousProviderKey = process.env.CAUSAL_STAGE2_CONTEXT_PROVIDER_KEY;
    let providerCalls = 0;
    process.env.CAUSAL_STAGE2_CONTEXT_PROVIDER_KEY = "provider-key";
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (!url.includes("context-probe-policy.test")) {
        throw new Error(`Unexpected fetch ${url}`);
      }

      providerCalls += 1;
      JSON.parse(String(init?.body ?? "{}")) as ProviderRequestBody;
      if (providerCalls === 1) {
        return toolResponse("call-list-auth", "file__list", { path: "src" });
      }
      if (providerCalls === 2) {
        return toolResponse("call-read-auth", "file__read", { path: "src/auth.ts" });
      }
      if (providerCalls >= 3) {
        return textResponse(
          "auth.ts 目前只做了基础 token 非空校验，这说明它更像一个占位式校验函数。"
          + " 如果把它用于真实鉴权链路，review 时应该重点关注 token 格式校验、签名验证、过期处理和异常分支，而不是只看非空判断是否成立。",
        );
      }
      throw new Error(`Unexpected provider call ${providerCalls}`);
    }) as typeof fetch;

    try {
      const { snapshot } = await executeRuntimeKernel(
        "run-causal-stage2-context",
        {
          prompt: "帮我review src/auth.ts",
          createdAt: 1,
          context: { projectWorkspace: { label: "Test", rootPath: workspaceRoot } },
        },
        {
          pattern: "orchestrator_subagent",
          modeId: SINGLE_AGENT_MODE_ID,
          providerId: "causal-stage2-context",
          modelRef: "causal-stage2-context-model",
          providerConfig: {
            id: "causal-stage2-context",
            label: "Causal Stage2 Context",
            type: "openai_compatible",
            modelId: "causal-stage2-context-model",
            baseUrl: "https://context-probe-policy.test/v1",
            apiKeyEnv: "CAUSAL_STAGE2_CONTEXT_PROVIDER_KEY",
            capabilities: ["chat", "tool_use"],
            headers: {},
          },
          metadata: {
            causalRouterVersion: "v2",
            causalContextProbePolicy: true,
          },
          profileIds: ["solo_agent"],
          skillIds: [],
          toolIds: ["file.read", "file.list"],
          approvalMode: "auto",
          budget: { maxTokens: 1024, maxToolCalls: 4, maxRuntimeMs: 60_000 },
        },
        { modeSpec, definition },
      );

      expect(snapshot.status).toBe("succeeded");
      expect(providerCalls).toBeGreaterThanOrEqual(3);
      expect(snapshot.toolCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolId: "file.read",
            status: "succeeded",
          }),
        ]),
      );
      expect(snapshot.toolCalls.find((call) => call.toolId === "file.list")).toBeUndefined();
      expect(snapshot.output).toMatchObject({
        text: expect.stringContaining("auth.ts"),
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousProviderKey === undefined) {
        delete process.env.CAUSAL_STAGE2_CONTEXT_PROVIDER_KEY;
      } else {
        process.env.CAUSAL_STAGE2_CONTEXT_PROVIDER_KEY = previousProviderKey;
      }
    }
  });
});
