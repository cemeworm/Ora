import { describe, expect, it } from "vitest";
import { ORA_ROOT_AGENT_ID, SINGLE_AGENT_MODE_ID, type OraToolCallEnvelope } from "@cemeworm/shared";
import {
  buildExplicitContentSearchFollowUp,
  buildManifestOnlyDiagnosisFollowUp,
  buildListHeavyRepoScanFollowUp,
  followUpToolChoiceForReason,
  buildReportingReadContextSurfaceFollowUp,
  buildReadContextNoEvidenceFinalFollowUp,
  buildReadContextPolicyFollowUp,
  buildWeakReadContextDiagnosisFollowUp,
  hasManifestOnlyReadContextDiagnosisEvidence,
  hasStrongReadContextDiagnosisEvidence,
  shouldBlockFinalForFreshnessPolicy,
  shouldBlockFinalForReadContextPolicy,
  shouldRepairManifestOnlyDiagnosisCompletion,
  shouldRepairWeakReadContextDiagnosisCompletion,
  shouldRepairReadContextDiagnosisWithoutEvidence,
  shouldBlockToolForContextProbePolicy,
  shouldBlockBroadRepoScanForExplicitContentSearch,
  shouldBlockListHeavyRepoScanForReadContext,
  hasReadContextEvidence,
  shouldContinueAfterCausalBlock,
  toolMatchesCausalRecommendation,
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

function readToolCall(params: {
  toolId?: string;
  path?: string;
  status?: OraToolCallEnvelope["status"];
  output?: unknown;
} = {}): OraToolCallEnvelope {
  return {
    id: "tool-read-ctx-1",
    runId: "run-1",
    toolId: params.toolId ?? "file.read",
    agentId: ORA_ROOT_AGENT_ID,
    nodeId: ORA_ROOT_AGENT_ID,
    args: params.path ? { path: params.path } : {},
    source: "provider_native",
    status: params.status ?? "succeeded",
    requestedAt: 1,
    updatedAt: 2,
    result: {
      status: params.status ?? "succeeded",
      output: params.output,
      createdAt: 1,
      updatedAt: 2,
    },
  };
}

function listToolCall(path: string): OraToolCallEnvelope {
  return {
    id: `tool-list-${path}`,
    runId: "run-1",
    toolId: "file.list",
    agentId: ORA_ROOT_AGENT_ID,
    nodeId: ORA_ROOT_AGENT_ID,
    args: { path },
    source: "provider_native",
    status: "succeeded",
    requestedAt: 1,
    updatedAt: 2,
  };
}

describe("node runtime loop policy helpers", () => {
  it("continues executable causal interventions after enforcing blocks", () => {
    expect(shouldContinueAfterCausalBlock("search_web")).toBe(true);
    expect(shouldContinueAfterCausalBlock("read_context")).toBe(true);
    expect(shouldContinueAfterCausalBlock("clarify")).toBe(false);
    expect(shouldContinueAfterCausalBlock("plan")).toBe(false);
  });

  it("treats matching read/search tools as satisfying causal recommendations", () => {
    expect(toolMatchesCausalRecommendation("read_context", "file.read")).toBe(true);
    expect(toolMatchesCausalRecommendation("read_context", "file.list")).toBe(true);
    expect(toolMatchesCausalRecommendation("search_web", "web.search")).toBe(true);
    expect(toolMatchesCausalRecommendation("search_web", "web.fetch")).toBe(true);
    expect(toolMatchesCausalRecommendation("read_context", "web.search")).toBe(false);
    expect(toolMatchesCausalRecommendation("search_web", "file.read")).toBe(false);
  });

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

  it("blocks direct completion when structured policy still recommends read_context and no local evidence was read", () => {
    expect(shouldBlockFinalForReadContextPolicy({
      enabled: true,
      prompt: "数据库连接池满了",
      toolCalls: [],
      currentTaskState: {
        candidateInterventions: ["read_context", "clarify"],
        chosenIntervention: "read_context",
      },
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "先给你几个常见原因。",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("does not block direct completion after read-context evidence exists", () => {
    expect(shouldBlockFinalForReadContextPolicy({
      enabled: true,
      prompt: "数据库连接池满了",
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
      currentTaskState: {
        candidateInterventions: ["read_context", "clarify"],
        chosenIntervention: "read_context",
      },
      toolCallCount: 1,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "我已经读了项目里的数据库相关配置。",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("treats manifest-only diagnosis evidence as weak read-context evidence", () => {
    expect(hasStrongReadContextDiagnosisEvidence([
      readToolCall({
        path: "apps/runtime/package.json",
        output: { path: "apps/runtime/package.json", content: "{\"dependencies\":{\"better-sqlite3\":\"^1.0.0\"}}" },
      }),
      readToolCall({
        toolId: "file.grep",
        output: { path: ".", pattern: "poolSize", matches: [] },
      }),
    ])).toBe(false);
  });

  it("treats concrete code-file reads as strong diagnosis evidence", () => {
    expect(hasStrongReadContextDiagnosisEvidence([
      readToolCall({
        path: "apps/runtime/src/db/sqlite-store.ts",
        output: { path: "apps/runtime/src/db/sqlite-store.ts", content: "const db = new Database(...)" },
      }),
    ])).toBe(true);
  });

  it("does not treat unrelated code-path reads as strong diagnosis evidence", () => {
    expect(hasStrongReadContextDiagnosisEvidence([
      readToolCall({
        path: "apps/runtime/src/runtime-store-paths.ts",
        output: { path: "apps/runtime/src/runtime-store-paths.ts", content: "export function defaultRuntimeStoreDir() { return path.join(process.cwd(), '.ora', 'runtime.db'); }" },
      }),
    ])).toBe(false);
  });

  it("detects manifest-only diagnosis evidence separately from strong code-path evidence", () => {
    expect(hasManifestOnlyReadContextDiagnosisEvidence([
      readToolCall({
        path: "apps/runtime/package.json",
        output: { path: "apps/runtime/package.json", content: "{\"dependencies\":{\"better-sqlite3\":\"^1.0.0\"}}" },
      }),
      readToolCall({
        toolId: "file.grep",
        output: { path: ".", pattern: "pool", matches: [] },
      }),
    ])).toBe(true);
  });

  it("repairs diagnosis completions when read_context evidence is still weak", () => {
    expect(shouldRepairWeakReadContextDiagnosisCompletion({
      enabled: true,
      prompt: "数据库连接池满了",
      toolCalls: [
        readToolCall({
          path: "apps/runtime/package.json",
          output: { path: "apps/runtime/package.json", content: "{\"dependencies\":{\"better-sqlite3\":\"^1.0.0\"}}" },
        }),
        readToolCall({
          toolId: "file.grep",
          output: { path: ".", pattern: "poolSize", matches: [] },
        }),
      ],
      currentTaskState: {
        candidateInterventions: ["read_context", "clarify"],
        chosenIntervention: "read_context",
      },
      toolCallCount: 2,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "项目使用 better-sqlite3，所以不是连接池问题。",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("does not repair diagnosis completions when strong code-path evidence already exists", () => {
    expect(shouldRepairWeakReadContextDiagnosisCompletion({
      enabled: true,
      prompt: "数据库连接池满了",
      toolCalls: [
        readToolCall({
          path: "apps/runtime/src/db/sqlite-store.ts",
          output: { path: "apps/runtime/src/db/sqlite-store.ts", content: "const db = new Database(...)" },
        }),
      ],
      currentTaskState: {
        candidateInterventions: ["read_context", "clarify"],
        chosenIntervention: "read_context",
      },
      toolCallCount: 1,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "我已经读到了具体实现。",
      routerVersion: "v2",
    })).toBe(false);
  });

  it("repairs diagnosis completions when the remaining evidence is only package-manifest dependencies", () => {
    expect(shouldRepairManifestOnlyDiagnosisCompletion({
      enabled: true,
      prompt: "数据库连接池满了",
      toolCalls: [
        readToolCall({
          path: "apps/runtime/package.json",
          output: { path: "apps/runtime/package.json", content: "{\"dependencies\":{\"better-sqlite3\":\"^1.0.0\"}}" },
        }),
        readToolCall({
          toolId: "file.grep",
          output: { path: ".", pattern: "pool", matches: [] },
        }),
      ],
      currentTaskState: {
        candidateInterventions: ["read_context", "clarify"],
        chosenIntervention: "read_context",
      },
      toolCallCount: 2,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "项目依赖 better-sqlite3，所以不是连接池问题。",
      routerVersion: "v2",
      weakDiagnosisRepairUsed: true,
    })).toBe(true);
  });

  it("repairs diagnosis completions when read_context was required but still no local evidence was inspected", () => {
    expect(shouldRepairReadContextDiagnosisWithoutEvidence({
      enabled: true,
      prompt: "数据库连接池满了",
      toolCalls: [],
      currentTaskState: {
        candidateInterventions: ["read_context", "clarify"],
        chosenIntervention: "read_context",
      },
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "项目使用 Prisma，连接池是 5。",
      routerVersion: "v2",
      readContextPolicyRepairUsed: true,
    })).toBe(true);
  });

  it("does not trigger no-evidence diagnosis repair before the read_context policy follow-up was used", () => {
    expect(shouldRepairReadContextDiagnosisWithoutEvidence({
      enabled: true,
      prompt: "数据库连接池满了",
      toolCalls: [],
      currentTaskState: {
        candidateInterventions: ["read_context", "clarify"],
        chosenIntervention: "read_context",
      },
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "项目使用 Prisma，连接池是 5。",
      routerVersion: "v2",
      readContextPolicyRepairUsed: false,
    })).toBe(false);
  });

  it("does not treat code-review prompts with error-handling language as runtime diagnosis", () => {
    expect(shouldRepairReadContextDiagnosisWithoutEvidence({
      enabled: true,
      prompt: "请审查 apps/runtime/src/agentic-efficiency.ts 的代码质量，重点关注类型错误和错误处理路径。",
      toolCalls: [],
      currentTaskState: {
        candidateInterventions: ["read_context", "clarify"],
        chosenIntervention: "read_context",
      },
      toolCallCount: 0,
      clarificationCount: 0,
      hasUnresolvedPlanItems: false,
      responseText: "这里可能存在类型错误，需要再确认。",
      routerVersion: "v2",
      readContextPolicyRepairUsed: true,
    })).toBe(false);
  });

  it("adds reporting-specific read-context guidance for weekly summary requests", () => {
    const guidance = buildReadContextPolicyFollowUp("帮我写项目周报");

    expect(guidance).toContain("Continue the user's original task by grounding the answer in local evidence first");
    expect(guidance).toContain("start with docs/, CHANGELOG, release notes, or the newest topic-relevant task journals");
    expect(guidance).toContain("before broad archive sweeps");
  });

  it("adds weak-diagnosis follow-up guidance that forces evidence-bound answers", () => {
    const guidance = buildWeakReadContextDiagnosisFollowUp();

    expect(guidance).toContain("dependency declarations");
    expect(guidance).toContain("avoid claims that the user's environment definitely is or is not using a pool");
    expect(guidance).toContain("ask for one narrow next artifact");
    expect(guidance).toContain("do not call tools");
  });

  it("keeps diagnosis rewrite follow-ups out of the tool loop", () => {
    expect(followUpToolChoiceForReason("read_context_diagnosis_missing_local_evidence", true, 3)).toBe("none");
    expect(followUpToolChoiceForReason("read_context_diagnosis_evidence_weak", true, 3)).toBe("none");
    expect(followUpToolChoiceForReason("read_context_diagnosis_manifest_only", true, 3)).toBe("none");
  });

  it("still allows tool-backed follow-ups when the follow-up is explicitly about gathering evidence", () => {
    expect(followUpToolChoiceForReason("read_context_policy_blocked", true, 3)).toBe("auto");
    expect(followUpToolChoiceForReason("freshness_policy_blocked", true, 3)).toBe("auto");
    expect(followUpToolChoiceForReason("reporting_read_context_surface_blocked", true, 3)).toBe("auto");
    expect(followUpToolChoiceForReason("freshness_policy_blocked", false, 3)).toBe("none");
    expect(followUpToolChoiceForReason("freshness_policy_blocked", true, 0)).toBe("none");
  });

  it("adds no-evidence diagnosis follow-up guidance that forbids invented repo details", () => {
    const guidance = buildReadContextNoEvidenceFinalFollowUp();

    expect(guidance).toContain("Do not invent or assume repository-specific databases");
    expect(guidance).toContain("no matching local evidence has been inspected yet");
    expect(guidance).toContain("ask for one concrete next artifact");
    expect(guidance).toContain("do not call tools");
  });

  it("adds manifest-only diagnosis guidance that forbids treating dependencies as proof", () => {
    const guidance = buildManifestOnlyDiagnosisFollowUp();

    expect(guidance).toContain("Do not mention dependencies like better-sqlite3");
    expect(guidance).toContain("package-manifest dependency names");
    expect(guidance).toContain("Limit the answer to the concrete checks you actually ran");
    expect(guidance).toContain("do not call tools");
  });

  it("adds reporting-specific surface guidance that prioritizes docs before tasks archive sweeps", () => {
    const guidance = buildReportingReadContextSurfaceFollowUp();

    expect(guidance).toContain("inspect high-signal project artifacts first");
    expect(guidance).toContain("workspace-relative paths");
    expect(guidance).toContain("Prefer targeted file.glob/file.grep calls over broad file.list");
    expect(guidance).toContain("only read concrete files once you have a clear target");
    expect(guidance).toContain("Do not start with broad tasks/ archive sweeps");
  });

  it("blocks list-heavy local-context repo scans before the evidence episode hard-stops the run", () => {
    expect(shouldBlockListHeavyRepoScanForReadContext({
      toolCalls: [
        listToolCall("."),
        listToolCall("packages"),
        listToolCall("apps"),
      ],
      agentId: ORA_ROOT_AGENT_ID,
      nodeId: ORA_ROOT_AGENT_ID,
      proposedToolId: "file.list",
      recommendedAction: "read_context",
    })).toBe(true);
  });

  it("does not block repo scans once targeted read evidence already exists in the current episode", () => {
    expect(shouldBlockListHeavyRepoScanForReadContext({
      toolCalls: [
        listToolCall("."),
        listToolCall("apps"),
        readToolCall({
          path: "pnpm-workspace.yaml",
          output: { path: "pnpm-workspace.yaml", content: "packages:\n  - apps/*" },
        }),
      ],
      agentId: ORA_ROOT_AGENT_ID,
      nodeId: ORA_ROOT_AGENT_ID,
      proposedToolId: "file.list",
      recommendedAction: "read_context",
    })).toBe(false);
  });

  it("adds repo-scan follow-up guidance that pivots from directory sweeps to targeted reads", () => {
    const guidance = buildListHeavyRepoScanFollowUp();

    expect(guidance).toContain("Stop adding more broad file.list/file.glob calls");
    expect(guidance).toContain("workspace manifest");
    expect(guidance).toContain("one narrow file.grep");
  });

  it("blocks broad repo scans for explicit content-search prompts before any targeted grep/read evidence exists", () => {
    expect(shouldBlockBroadRepoScanForExplicitContentSearch({
      prompt: [
        "在 Ora 项目中搜索以下关键字，汇总每次搜索结果：",
        "1. 搜索 'cacheHitRatio' 的所有出现位置",
        "2. 搜索 'AgenticEfficiencyLedger' 的所有定义和引用",
        "请输出文件路径、行号、上下文摘要。",
      ].join("\n"),
      toolCalls: [],
      proposedToolId: "file.list",
      recommendedAction: "read_context",
    })).toBe(true);
  });

  it("does not block explicit content-search prompts after targeted grep/read evidence already exists", () => {
    expect(shouldBlockBroadRepoScanForExplicitContentSearch({
      prompt: [
        "在 Ora 项目中搜索以下关键字：'cacheHitRatio'、'AgenticEfficiencyLedger'。",
        "请输出文件路径、行号、上下文摘要。",
      ].join("\n"),
      toolCalls: [
        readToolCall({
          toolId: "file.grep",
          path: ".",
          output: { matches: [{ path: "apps/runtime/src/agentic-efficiency.ts", line: 10, text: "cacheHitRatio" }] },
        }),
      ],
      proposedToolId: "file.list",
      recommendedAction: "read_context",
    })).toBe(false);
  });

  it("adds explicit content-search guidance that pivots to grep first", () => {
    const guidance = buildExplicitContentSearchFollowUp();

    expect(guidance).toContain("Do not expand the directory tree first");
    expect(guidance).toContain("file.grep");
    expect(guidance).toContain("matched files");
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

  it("blocks broad task-archive entry points for reporting prompts before higher-signal evidence exists", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我写项目周报",
      toolCalls: [],
      proposedToolId: "file.list",
      proposedToolArgs: { path: "tasks" },
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("blocks workspace-root file.list entry points for reporting prompts", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我写项目周报",
      toolCalls: [],
      proposedToolId: "file.list",
      proposedToolArgs: { path: "." },
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("blocks broad task-archive glob entry points for reporting prompts before higher-signal evidence exists", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我写项目周报",
      toolCalls: [],
      proposedToolId: "file.glob",
      proposedToolArgs: { pattern: "tasks/TASK-20260523*.md" },
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("blocks direct task-journal reads for reporting prompts before higher-signal evidence exists", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我写项目周报",
      toolCalls: [],
      proposedToolId: "file.read",
      proposedToolArgs: { path: "tasks/TASK-20260524-1605-accepted-plan-resume-state-machine.md" },
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("does not block task-archive follow-up once higher-signal reporting evidence already exists", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我写项目周报",
      toolCalls: [{
        id: "tool-read-1",
        runId: "run-1",
        toolId: "file.read",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        args: { path: "release.json" },
        source: "provider_native",
        status: "succeeded",
        requestedAt: 1,
        updatedAt: 2,
      }],
      proposedToolId: "file.list",
      proposedToolArgs: { path: "tasks" },
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
  });

  it("allows at most two task-journal follow-ups after higher-signal reporting evidence exists", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我写项目周报",
      toolCalls: [{
        id: "tool-read-1",
        runId: "run-1",
        toolId: "file.read",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        args: { path: "release.json" },
        source: "provider_native",
        status: "succeeded",
        requestedAt: 1,
        updatedAt: 2,
      }],
      proposedToolId: "file.read",
      proposedToolArgs: { path: "tasks/TASK-20260524-1605-accepted-plan-resume-state-machine.md" },
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(false);

    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我写项目周报",
      toolCalls: [{
        id: "tool-read-1",
        runId: "run-1",
        toolId: "file.read",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        args: { path: "release.json" },
        source: "provider_native",
        status: "succeeded",
        requestedAt: 1,
        updatedAt: 2,
      }, {
        id: "tool-read-2",
        runId: "run-1",
        toolId: "file.read",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        args: { path: "tasks/TASK-20260524-1605-accepted-plan-resume-state-machine.md" },
        source: "provider_native",
        status: "succeeded",
        requestedAt: 3,
        updatedAt: 4,
      }, {
        id: "tool-read-3",
        runId: "run-1",
        toolId: "file.read",
        agentId: ORA_ROOT_AGENT_ID,
        nodeId: ORA_ROOT_AGENT_ID,
        args: { path: "tasks/TASK-20260524-1549-session-fork-static-copy-fix.md" },
        source: "provider_native",
        status: "succeeded",
        requestedAt: 5,
        updatedAt: 6,
      }],
      proposedToolId: "file.read",
      proposedToolArgs: { path: "tasks/TASK-20260523-1924-public-final-output-contract.md" },
      recommendedAction: "read_context",
      routerVersion: "v2",
    })).toBe(true);
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

  it("blocks repo.explore escalation in single_agent even after read-context evidence exists", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我 review apps/runtime/src/harness/causal-policy-router.ts 里 read_context 和 search_web 的路由逻辑",
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
      proposedToolId: "repo.explore",
      recommendedAction: "read_context",
      routerVersion: "v2",
      modeId: SINGLE_AGENT_MODE_ID,
    })).toBe(true);
  });

  it("does not block repo.explore escalation outside single_agent once read-context evidence exists", () => {
    expect(shouldBlockToolForContextProbePolicy({
      enabled: true,
      prompt: "帮我 review apps/runtime/src/harness/causal-policy-router.ts 里 read_context 和 search_web 的路由逻辑",
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
      proposedToolId: "repo.explore",
      recommendedAction: "read_context",
      routerVersion: "v2",
      modeId: "review_critique",
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
