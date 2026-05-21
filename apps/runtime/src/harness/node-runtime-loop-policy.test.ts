import { describe, expect, it } from "vitest";
import { ORA_ROOT_AGENT_ID, type OraToolCallEnvelope } from "@cemeworm/shared";
import {
  shouldBlockFinalForFreshnessPolicy,
  shouldBlockToolForContextProbePolicy,
} from "./node-runtime-loop.js";

function searchToolCall(status: OraToolCallEnvelope["status"]): OraToolCallEnvelope {
  return {
    id: "tool-search-1",
    runId: "run-1",
    toolId: "web.search",
    agentId: ORA_ROOT_AGENT_ID,
    nodeId: ORA_ROOT_AGENT_ID,
    args: {},
    source: "provider_native",
    status,
    requestedAt: 1,
    updatedAt: 2,
  };
}

describe("node runtime loop policy helpers", () => {
  it("blocks stale final answers for freshness-sensitive prompts when no search evidence exists", () => {
    expect(shouldBlockFinalForFreshnessPolicy({
      enabled: true,
      prompt: "React 19 有哪些新特性",
      toolCalls: [],
      currentTaskState: undefined,
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "React 19 有很多新特性。",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("does not block freshness-sensitive prompts after successful search evidence exists", () => {
    expect(shouldBlockFinalForFreshnessPolicy({
      enabled: true,
      prompt: "React 19 有哪些新特性",
      toolCalls: [searchToolCall("succeeded")],
      currentTaskState: undefined,
      toolCallCount: 1,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "根据搜索结果，React 19 ...",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("does not block non-freshness prompts", () => {
    expect(shouldBlockFinalForFreshnessPolicy({
      enabled: true,
      prompt: "解释什么是闭包",
      toolCalls: [],
      currentTaskState: undefined,
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "闭包是 JavaScript 中...",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("does not block implementation-oriented prompts even if they mention freshness-sensitive topics", () => {
    expect(shouldBlockFinalForFreshnessPolicy({
      enabled: true,
      prompt: "请基于 React 19 新特性改造 src/auth.ts",
      toolCalls: [],
      currentTaskState: undefined,
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "我会先查看 src/auth.ts 再决定改造方案。",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("does not block explicit artifact review prompts that mention freshness-sensitive topics", () => {
    expect(shouldBlockFinalForFreshnessPolicy({
      enabled: true,
      prompt: "帮我 review apps/runtime/src/harness/causal-policy-router.ts，顺便看看 React 19 新特性会不会影响这里的逻辑",
      toolCalls: [],
      currentTaskState: undefined,
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "我会先阅读目标文件，再判断是否需要额外查证。",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("blocks non-read tools when context probe policy requires reading the referenced artifact first", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我review这个PR",
      toolCalls: [],
      proposedToolId: "shell.exec",
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("does not block when the proposed tool already reads context", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我review这个PR",
      toolCalls: [],
      proposedToolId: "file.read",
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("does not block when read-context evidence already exists", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我review这个PR",
      toolCalls: [{
        id: "tool-read-1",
        runId: "run-1",
        toolId: "file.read",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        args: {},
        source: "provider_native",
        status: "succeeded",
        requestedAt: 1,
        updatedAt: 2,
      }],
      proposedToolId: "shell.exec",
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(false);
  });
});
