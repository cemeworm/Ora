import { describe, expect, it } from "vitest";
import { ORA_ROOT_AGENT_ID, type OraToolCallEnvelope } from "@cemeworm/shared";
import {
  shouldBlockFinalForFreshnessPolicy,
  shouldBlockToolForContextProbePolicy,
  hasReadContextEvidence,
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
  it("blocks stale final answers only when structured freshness evidence requires search", () => {
    expect(shouldBlockFinalForFreshnessPolicy({
      enabled: true,
      prompt: "React 19 有哪些新特性",
      toolCalls: [],
      currentTaskState: { needsFreshnessEvidence: true },
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
      currentTaskState: { needsFreshnessEvidence: true },
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

  it("does not block when freshness evidence is missing even if the prompt looks freshness-sensitive", () => {
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

  it("does not block explicit artifact review prompts without structured freshness evidence", () => {
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

  it("respects needsFreshnessEvidence=false even when keywords match", () => {
    expect(shouldBlockFinalForFreshnessPolicy({
      enabled: true,
      prompt: "React 19 有哪些新特性",
      toolCalls: [],
      currentTaskState: { needsFreshnessEvidence: false },
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "React 19 有很多新特性。",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("respects needsFreshnessEvidence=true even without keyword match", () => {
    expect(shouldBlockFinalForFreshnessPolicy({
      enabled: true,
      prompt: "python有哪些好用的库",
      toolCalls: [],
      currentTaskState: { needsFreshnessEvidence: true },
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "Python 有很多好用的库。",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("does not fall back to prompt keywords when needsFreshnessEvidence is undefined", () => {
    expect(shouldBlockFinalForFreshnessPolicy({
      enabled: true,
      prompt: "React 19 有哪些新特性",
      toolCalls: [],
      currentTaskState: { surfaceRequest: "React 19 有哪些新特性" },
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "React 19 有很多新特性。",
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

  it("blocks when the prompt references a file path with extension", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我 review apps/runtime/src/harness/causal-policy-router.ts 里的路由逻辑",
      toolCalls: [],
      proposedToolId: "shell.exec",
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("blocks when the prompt contains diff/PR reference", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "看看这个 diff 有没有问题",
      toolCalls: [],
      proposedToolId: "plan.update",
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("blocks when proposed tool is plan.update and prompt has log/trace reference", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我分析这段日志里的错误",
      toolCalls: [],
      proposedToolId: "plan.update",
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("does not block when recommended action is not read_context", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我review这个PR",
      toolCalls: [],
      proposedToolId: "shell.exec",
      recommendedAction: "clarify",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("does not block when policy is disabled", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: false,
      prompt: "帮我review这个PR",
      toolCalls: [],
      proposedToolId: "shell.exec",
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("does not block when routerVersion is v1", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我review这个PR",
      toolCalls: [],
      proposedToolId: "shell.exec",
      recommendedAction: "read_context",
      routerVersion: "v1",
    })).toBe(false);
  });

  it("blocks non-read tools whenever the structured policy already recommends read_context", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "如何优化React性能？",
      toolCalls: [],
      proposedToolId: "web.search",
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("does not block when read-context evidence already exists as proposed", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我看看这段代码",
      toolCalls: [{
        id: "tool-read-1",
        runId: "run-1",
        toolId: "file.read",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        args: {},
        source: "provider_native",
        status: "proposed",
        requestedAt: 1,
        updatedAt: 2,
      }],
      proposedToolId: "shell.exec",
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(false);
  });
});

describe("hasReadContextEvidence", () => {
  it("returns true when any read-context tool is proposed", () => {
    expect(hasReadContextEvidence([{
      id: "tool-1",
      runId: "run-1",
      toolId: "file.read",
      agentId: ORA_ROOT_AGENT_ID,
      nodeId: ORA_ROOT_AGENT_ID,
      args: {},
      source: "provider_native",
      status: "proposed",
      requestedAt: 1,
      updatedAt: 2,
    }])).toBe(true);
  });

  it("returns true when a read-context tool succeeded", () => {
    expect(hasReadContextEvidence([{
      id: "tool-1",
      runId: "run-1",
      toolId: "file.read",
      agentId: ORA_ROOT_AGENT_ID,
      nodeId: ORA_ROOT_AGENT_ID,
      args: {},
      source: "provider_native",
      status: "succeeded",
      requestedAt: 1,
      updatedAt: 2,
    }])).toBe(true);
  });

  it("returns false when no read-context tools exist", () => {
    expect(hasReadContextEvidence([{
      id: "tool-1",
      runId: "run-1",
      toolId: "shell.exec",
      agentId: ORA_ROOT_AGENT_ID,
      nodeId: ORA_ROOT_AGENT_ID,
      args: {},
      source: "provider_native",
      status: "succeeded",
      requestedAt: 1,
      updatedAt: 2,
    }])).toBe(false);
  });

  it("returns false for empty tool calls", () => {
    expect(hasReadContextEvidence([])).toBe(false);
  });

  it("returns false for failed read-context tools", () => {
    expect(hasReadContextEvidence([{
      id: "tool-1",
      runId: "run-1",
      toolId: "file.read",
      agentId: ORA_ROOT_AGENT_ID,
      nodeId: ORA_ROOT_AGENT_ID,
      args: {},
      source: "provider_native",
      status: "failed",
      requestedAt: 1,
      updatedAt: 2,
    }])).toBe(false);
  });
});
