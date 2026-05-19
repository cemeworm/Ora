import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveSessionProjection, RuntimeSessionLedgerSchema, RuntimeWorkbenchBootstrapSchema, SessionDetailSchema, StateSnapshotSchema } from "@cemeworm/shared";
import type { RuntimeGateResolution } from "../src/runtime-gate-service.js";

const capturedRequests: Array<{
  prompt: string;
  system: string;
  messages: { role: string; content: string }[];
  providerId?: string;
  modelRef?: string;
}> = [];
const titleResponses: Array<string | Error> = [];

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>(
    "../src/providers/index.js"
  );

  return {
    ...actual,
    invokeRunProvider: vi.fn(async (config, request) => {
      const messages = (request.messages ?? []).map((message) => ({
        role: message.role,
        content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      }));
      const hasToolResult = messages.some((message) => message.content.includes("Workspace tool result for shell.execute"));
      const requestText = [request.prompt ?? "", ...messages.map((message) => message.content)].join("\n");
      const shouldEscapeShell = request.system?.includes("Workspace tool protocol:")
        && requestText.includes("Try escaping shell")
        && !hasToolResult;
      const shouldCallShell = request.system?.includes("Workspace tool protocol:")
        && requestText.includes("Count markdown with shell")
        && !hasToolResult;
      const isTitleRequest = request.system?.includes("Ora's conversation title generator");
      const isCompactRequest = request.system?.includes("compressing an Ora session history");
      const shouldReturnProposedPlan = requestText.includes("Return a proposed plan");
      const text = isTitleRequest
        ? titleResponses.shift() ?? "Generated Session Title"
        : isCompactRequest
        ? "SUMMARY: preserve the earlier long user goal and assistant answer."
        : shouldReturnProposedPlan
          ? [
              "<proposed_plan>",
              "## Runtime status plan",
              "1. Add shared attention projection.",
              "2. Persist plan decision gates.",
              "</proposed_plan>",
            ].join("\n")
        : shouldEscapeShell
        ? JSON.stringify({ tool: "shell.execute", args: { command: "cat /etc/passwd" } })
        : shouldCallShell
        ? JSON.stringify({ tool: "shell.execute", args: { command: "rg --files -g '*.md'" } })
        : hasToolResult
          ? "There are 2 Markdown files."
          : `reply:${request.prompt}`;

      capturedRequests.push({
        prompt: request.prompt,
        system: request.system ?? "",
        messages,
        providerId: config.providerId,
        modelRef: config.modelRef,
      });

      if (text instanceof Error) {
        throw text;
      }

      return {
        providerId: config.providerId ?? "mock-provider",
        modelId: config.modelRef ?? "mock-model",
        text,
        raw: {
          prompt: request.prompt,
          messages: request.messages ?? [],
        },
      };
    }),
  };
});

import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";
import { createRunningRunSnapshot } from "../src/run-snapshots.js";

const FIXED_TIME = 1_700_000_000_000;
const clock = () => FIXED_TIME;

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-session-test-"));
}

function readSessionLedger(dir: string, sessionId: string) {
  const ledgerPath = path.join(dir, "sessions-ledger", `${sessionId}.jsonl`);
  return RuntimeSessionLedgerSchema.parse({
    sessionId,
    entries: fs.readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  });
}

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = read();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return read();
}

describe("session thread runtime behavior", () => {
  beforeEach(() => {
    capturedRequests.length = 0;
    titleResponses.length = 0;
  });

  it("bootstraps the workbench and creates the first session when empty", async () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir(), clock }));

    const bootstrap = RuntimeWorkbenchBootstrapSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.workbenchBootstrap",
      params: {},
    }));

    expect(bootstrap.bootstrap.health.ok).toBe(true);
    expect(bootstrap.sessions).toHaveLength(1);
    expect(bootstrap.sessions[0]?.turnCount).toBe(0);
    expect(bootstrap.activeSessionDetail.session.sessionId).toBe(bootstrap.sessions[0]?.sessionId);
  });

  it("bootstraps the workbench with the latest existing session", async () => {
    let now = FIXED_TIME;
    const handle = createRuntimeMethodHandler(new LocalRunStore({
      dataDir: freshStoreDir(),
      clock: () => now,
    }));
    const older = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "sessions.create",
      params: { label: "Older" },
    }) as { sessionId: string };
    now += 1;
    const latest = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "sessions.create",
      params: { label: "Latest" },
    }) as { sessionId: string };
    const run = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        sessionId: latest.sessionId,
        input: { prompt: "Summarize startup state." },
        config: { pattern: "generator_verifier" },
      },
    }) as { runId: string };

    const bootstrap = RuntimeWorkbenchBootstrapSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "runtime.workbenchBootstrap",
      params: {},
    }));
    const detail = SessionDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "sessions.get",
      params: { sessionId: latest.sessionId },
    }));
    const summaryDetail = SessionDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 6,
      method: "sessions.get",
      params: { sessionId: latest.sessionId, includeLatestSnapshot: false },
    }));

    expect(bootstrap.sessions.map((session) => session.sessionId)).toEqual([
      bootstrap.activeSessionDetail.session.sessionId,
      latest.sessionId,
      older.sessionId,
    ]);
    expect(bootstrap.activeSessionDetail.turns).toEqual([]);
    expect(bootstrap.activeSessionDetail.latestSnapshot).toBeUndefined();
    expect(detail.latestSnapshot?.runId).toBe(run.runId);
    expect(summaryDetail.latestSnapshot).toBeUndefined();
  });

  it("creates and reloads empty sessions", () => {
    const dir = freshStoreDir();
    const firstStore = new LocalRunStore({ dataDir: dir, clock });
    const project = firstStore.createProject({ rootPath: dir, label: "alpha" });

    const created = firstStore.createSession({ projectId: project.projectId });
    expect(created.sessionId).toBe("session-0001");
    expect(created.title).toBe("New Chat");
    expect(created.turnCount).toBe(0);

    const detail = SessionDetailSchema.parse(firstStore.getSession({ sessionId: created.sessionId }));
    expect(detail.turns).toEqual([]);
    expect(detail.transcript).toEqual([]);
    expect(detail.latestSnapshot).toBeUndefined();

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const reloadedSessions = reloaded.listSessions();
    expect(reloadedSessions).toHaveLength(1);
    expect(reloadedSessions[0]?.sessionId).toBe(created.sessionId);
    expect(reloaded.getSession({ sessionId: created.sessionId }).session.turnCount).toBe(0);
  });

  it("persists run lifecycle through the session ledger and reloads from projection", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();

    const run = await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Ledger cutover smoke", createdAt: FIXED_TIME },
      config: { modeId: "single_agent", providerId: "ledger-cutover-provider", modelRef: "mock-model" },
    });

    const ledgerPath = path.join(dir, "sessions-ledger", `${session.sessionId}.jsonl`);
    const entries = fs.readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; runId?: string });

    expect(entries.map((entry) => entry.type)).toEqual([
      "session.created",
      "compaction.summary",
      "user.message",
      "run.started",
      "runtime.event_batch",
      "assistant.message",
      "session.info",
    ]);
    expect(entries.filter((entry) => entry.runId === run.runId).map((entry) => entry.type)).toEqual([
      "user.message",
      "run.started",
      "runtime.event_batch",
      "assistant.message",
    ]);
    expect(fs.existsSync(path.join(dir, "runs", `${run.runId}.json`))).toBe(false);

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const detail = SessionDetailSchema.parse(reloaded.getSession({ sessionId: session.sessionId }));
    expect(detail.latestSnapshot).toMatchObject({
      runId: run.runId,
      sessionId: session.sessionId,
      status: "succeeded",
    });
    expect((detail.latestSnapshot?.output as { text?: string }).text).toContain("Ledger cutover smoke");
    expect(detail.transcript.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("persists opened gate ledger entries in legacy order and shape", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();
    const handle = await store.startRunWithSnapshot({
      sessionId: session.sessionId,
      input: { prompt: "Open all gate types.", createdAt: FIXED_TIME },
      config: {
        modeId: "single_agent",
        providerId: "gate-ledger-provider",
        modelRef: "gate-ledger-model",
        toolIds: ["file.write"],
        approvalMode: "high_risk_only",
      },
    }, async (args) => {
      const base = createRunningRunSnapshot({ ...args, clock });
      const actionId = `${base.runId}:action-write`;
      const toolCallId = `${base.runId}:tool-call-write`;
      return StateSnapshotSchema.parse({
        ...base,
        status: "interrupted",
        pendingClarifications: [{
          id: "clarification:gate:scope",
          key: "scope",
          nodeId: "ora",
          nodeLabel: "Ora",
          question: "Which scope?",
          options: [],
          requestedAt: FIXED_TIME + 10,
        }],
        pendingApprovals: [actionId],
        actions: [{
          id: actionId,
          runId: base.runId,
          type: "file.write",
          riskLevel: "high",
          status: "approval_required",
          input: { path: "notes/gate.md", content: "gate\n" },
          artifactIds: [],
        }],
        toolCalls: [{
          id: toolCallId,
          runId: base.runId,
          toolId: "file.write",
          args: { path: "notes/gate.md", content: "gate\n" },
          source: "json_fallback",
          status: "approval_required",
          actionId,
          requestedAt: FIXED_TIME + 20,
          updatedAt: FIXED_TIME + 20,
        }],
        planDecisions: [{
          id: "decision-gate",
          runId: base.runId,
          sessionId: session.sessionId,
          status: "pending",
          planContent: "Plan the gated work.",
          createdAt: FIXED_TIME + 30,
        }],
      });
    });

    if (!handle) {
      throw new Error("Expected gated run to start.");
    }
    const ledger = readSessionLedger(dir, session.sessionId);
    const gateEntries = ledger.entries.filter((entry) => entry.type === "gate.opened");

    expect(gateEntries.map((entry) => entry.id)).toEqual([
      `${handle.runId}:gate:clarification:gate:scope`,
      `${handle.runId}:gate:approval`,
      `${handle.runId}:gate:decision-gate`,
    ]);
    expect(gateEntries.map((entry) => entry.payload)).toEqual([
      expect.objectContaining({
        gateId: "clarification:gate:scope",
        kind: "clarification",
        pendingClarificationIds: ["clarification:gate:scope"],
      }),
      {
        gateId: `${handle.runId}:approval`,
        kind: "approval",
        pendingActionIds: [`${handle.runId}:action-write`],
        pendingToolCallIds: [`${handle.runId}:tool-call-write`],
      },
      expect.objectContaining({
        gateId: "decision-gate",
        kind: "plan_decision",
        planDecision: expect.objectContaining({
          id: "decision-gate",
          status: "pending",
          planContent: "Plan the gated work.",
        }),
      }),
    ]);
    expect(gateEntries.map((entry) => entry.createdAt)).toEqual([
      FIXED_TIME + 10,
      FIXED_TIME,
      FIXED_TIME + 30,
    ]);
  });

  it("does not append already-ledgered opened gate ids when business facts are flushed again", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();
    const handle = await store.startRunWithSnapshot({
      sessionId: session.sessionId,
      input: { prompt: "Open all gate types twice.", createdAt: FIXED_TIME },
      config: {
        modeId: "single_agent",
        providerId: "gate-ledger-idempotence-provider",
        modelRef: "gate-ledger-idempotence-model",
        toolIds: ["file.write"],
        approvalMode: "high_risk_only",
      },
    }, async (args) => {
      const base = createRunningRunSnapshot({ ...args, clock });
      const actionId = `${base.runId}:action-write`;
      const toolCallId = `${base.runId}:tool-call-write`;
      return StateSnapshotSchema.parse({
        ...base,
        status: "interrupted",
        pendingClarifications: [{
          id: "clarification:gate:scope",
          key: "scope",
          nodeId: "ora",
          nodeLabel: "Ora",
          question: "Which scope?",
          options: [],
          requestedAt: FIXED_TIME + 10,
        }],
        pendingApprovals: [actionId],
        actions: [{
          id: actionId,
          runId: base.runId,
          type: "file.write",
          riskLevel: "high",
          status: "approval_required",
          input: { path: "notes/gate.md", content: "gate\n" },
          artifactIds: [],
        }],
        toolCalls: [{
          id: toolCallId,
          runId: base.runId,
          toolId: "file.write",
          args: { path: "notes/gate.md", content: "gate\n" },
          source: "json_fallback",
          status: "approval_required",
          actionId,
          requestedAt: FIXED_TIME + 20,
          updatedAt: FIXED_TIME + 20,
        }],
        planDecisions: [{
          id: "decision-gate",
          runId: base.runId,
          sessionId: session.sessionId,
          status: "pending",
          planContent: "Plan the gated work.",
          createdAt: FIXED_TIME + 30,
        }],
      });
    });

    const snapshot = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));
    (store as unknown as {
      appendSnapshotBusinessFactsToLedger(snapshot: unknown): void;
    }).appendSnapshotBusinessFactsToLedger(snapshot);

    const gateEntries = readSessionLedger(dir, session.sessionId).entries.filter((entry) =>
      entry.type === "gate.opened"
    );
    expect(gateEntries.map((entry) => entry.id)).toEqual([
      `${handle.runId}:gate:clarification:gate:scope`,
      `${handle.runId}:gate:approval`,
      `${handle.runId}:gate:decision-gate`,
    ]);
    expect(gateEntries.map((entry) =>
      entry.payload && typeof entry.payload === "object"
        ? (entry.payload as Record<string, unknown>).gateId
        : undefined
    )).toEqual([
      "clarification:gate:scope",
      `${handle.runId}:approval`,
      "decision-gate",
    ]);
  });

  it("archives sessions and hides them from session lists", () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const project = store.createProject({ rootPath: dir, label: "alpha" });
    const first = store.createSession({ projectId: project.projectId });
    const second = store.createSession({ projectId: project.projectId });

    const archived = store.archiveSession({ sessionId: first.sessionId });
    expect(archived.archivedAt).toBeDefined();
    expect(store.listSessions().map((session) => session.sessionId)).toEqual([second.sessionId]);
    expect(store.getProject({ projectId: project.projectId }).project.sessionCount).toBe(1);

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    expect(reloaded.listSessions().map((session) => session.sessionId)).toEqual([second.sessionId]);
    expect(reloaded.getSession({ sessionId: first.sessionId }).session.archivedAt).toBe(archived.archivedAt);
  });

  it("archives projects by cascading to project sessions and hides them from active project lists", () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const project = store.createProject({ rootPath: dir, label: "alpha" });
    const first = store.createSession({ projectId: project.projectId });
    const second = store.createSession({ projectId: project.projectId });

    const archivedProject = store.archiveProject({ projectId: project.projectId });
    expect(archivedProject.archivedAt).toBeDefined();
    expect(store.listProjects()).toEqual([]);
    expect(store.listSessions({ projectId: project.projectId })).toEqual([]);
    expect(store.getSession({ sessionId: first.sessionId }).session.archivedAt).toBe(archivedProject.archivedAt);
    expect(store.getSession({ sessionId: second.sessionId }).session.archivedAt).toBe(archivedProject.archivedAt);
    expect(store.getProject({ projectId: project.projectId }).project.sessionCount).toBe(0);

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    expect(reloaded.listProjects()).toEqual([]);
    expect(reloaded.getProject({ projectId: project.projectId }).project.archivedAt).toBe(archivedProject.archivedAt);
    expect(reloaded.getSession({ sessionId: first.sessionId }).session.archivedAt).toBe(archivedProject.archivedAt);
    expect(reloaded.getSession({ sessionId: second.sessionId }).session.archivedAt).toBe(archivedProject.archivedAt);
  });

  it("creates projects, deduplicates repeated paths, and groups project sessions", () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });

    const created = store.createProject({ rootPath: dir, label: "workspace" });
    const duplicate = store.createProject({ rootPath: `${dir}/` });
    const scopedSession = store.createSession({ projectId: created.projectId });

    expect(duplicate.projectId).toBe(created.projectId);
    expect(store.listProjects()).toHaveLength(1);

    const detail = store.getProject({ projectId: created.projectId });
    expect(detail.project.projectId).toBe(created.projectId);
    expect(detail.project.sessionCount).toBe(1);
    expect(detail.sessions[0]?.sessionId).toBe(scopedSession.sessionId);

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    expect(reloaded.listProjects()[0]?.projectId).toBe(created.projectId);
    expect(reloaded.getProject({ projectId: created.projectId }).project.sessionCount).toBe(1);
  });

  it("revives archived duplicate projects instead of returning a hidden match", () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });

    const created = store.createProject({ rootPath: dir, label: "workspace" });
    const archived = store.archiveProject({ projectId: created.projectId });
    const restored = store.createProject({ rootPath: `${dir}/`, label: "workspace" });

    expect(archived.archivedAt).toBeDefined();
    expect(restored.projectId).toBe(created.projectId);
    expect(restored.archivedAt).toBeUndefined();
    expect(store.listProjects()).toHaveLength(1);
    expect(store.listProjects()[0]?.projectId).toBe(created.projectId);
  });

  it("generates a first-turn session title from the completed conversation", async () => {
    titleResponses.push("\"项目 Markdown 统计\"");
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const session = store.createSession();

    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "这个项目里有多少 Markdown 文件？" },
      config: {
        pattern: "generator_verifier",
        providerId: "openai-gpt",
        modelRef: "gpt-title-test",
      },
    });

    const detail = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    const titleRequest = capturedRequests.find((request) =>
      request.system.includes("Ora's conversation title generator")
    );

    expect(detail.session.title).toBe("项目 Markdown 统计");
    expect(titleRequest?.providerId).toBe("openai-gpt");
    expect(titleRequest?.modelRef).toBe("gpt-title-test");
    expect(titleRequest?.messages[0]?.content).toContain("这个项目里有多少 Markdown 文件？");
    expect(titleRequest?.messages[0]?.content).toContain("Assistant response:");
    expect(titleRequest?.messages[0]?.content).toContain("Markdown 文件");
  });

  it("persists and resolves plan-decision attention for completed plan runs", async () => {
    titleResponses.push("Plan Gate Session");
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const session = store.createSession();

    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Return a proposed plan for session state." },
      config: {
        pattern: "orchestrator_subagent",
        providerId: "openai-gpt",
        modelRef: "gpt-plan-test",
        metadata: {
          taskIntent: "plan",
        },
      },
    });

    const planned = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    expect(planned.session.attention?.kind).toBe("needs_plan_decision");
    expect(planned.latestSnapshot?.planDecisions[0]).toMatchObject({
      status: "pending",
      sessionId: session.sessionId,
    });

    const resolved = SessionDetailSchema.parse(store.resolvePlanDecision({
      sessionId: session.sessionId,
      decisionId: planned.session.attention?.planDecisionId,
      status: "accepted",
    }));

    expect(resolved.session.attention?.kind).toBe("idle");
    expect(resolved.latestSnapshot?.planDecisions[0]?.status).toBe("accepted");
  });

  it("declines plan-decision gates without creating accepted-plan handoffs after cold reload", async () => {
    titleResponses.push("Declined Plan Session");
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();

    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Return a proposed plan that will be declined." },
      config: {
        pattern: "orchestrator_subagent",
        providerId: "openai-gpt",
        modelRef: "gpt-plan-test",
        metadata: {
          taskIntent: "plan",
        },
      },
    });

    const planned = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    const decision = planned.latestSnapshot?.planDecisions[0];
    expect(decision?.status).toBe("pending");

    const resolved = SessionDetailSchema.parse(store.resolvePlanDecision({
      sessionId: session.sessionId,
      decisionId: decision?.id,
      status: "declined",
    }));

    expect(resolved.session.attention?.kind).toBe("idle");
    expect(resolved.latestSnapshot?.planDecisions[0]?.status).toBe("declined");

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const coldDetail = SessionDetailSchema.parse(reloaded.getSession({ sessionId: session.sessionId }));
    const coldSummary = reloaded.listSessions().find((item) => item.sessionId === session.sessionId);
    expect(coldDetail.session.attention?.kind).toBe("idle");
    expect(coldDetail.latestSnapshot?.planDecisions[0]?.status).toBe("declined");
    expect(coldSummary?.attention?.kind).toBe("idle");

    await reloaded.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Implement without the declined plan." },
      config: {
        pattern: "generator_verifier",
        providerId: "openai-gpt",
        modelRef: "gpt-declined-implementation-test",
        metadata: { taskIntent: "implement" },
      },
    });

    const implementationRequest = capturedRequests.find((request) =>
      request.modelRef === "gpt-declined-implementation-test" &&
      request.messages.some((message) => message.content.includes("Implement without the declined plan."))
    );
    expect(implementationRequest?.messages.some((message) => message.content.includes("<accepted_plan>"))).toBe(false);

    const ledgerPath = path.join(dir, "sessions-ledger", `${session.sessionId}.jsonl`);
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: session.sessionId,
      entries: fs.readFileSync(ledgerPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    });
    const projection = deriveSessionProjection(ledger);
    expect(projection.acceptedPlanHandoffs).toEqual([]);
  });

  it("closes clarification resume projections across state, session detail, list, and cold reload", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();
    const handle = await store.startRunWithSnapshot({
      sessionId: session.sessionId,
      input: { prompt: "Need clarification before continuing.", createdAt: FIXED_TIME },
      config: {
        modeId: "single_agent",
        providerId: "clarification-closure-provider",
        modelRef: "clarification-closure-model",
      },
    }, async (args) => {
      const base = createRunningRunSnapshot({ ...args, clock });
      return StateSnapshotSchema.parse({
        ...base,
        status: "interrupted",
        pendingClarifications: [{
          id: "clarification:ora:target",
          key: "target",
          nodeId: "ora",
          nodeLabel: "Ora",
          question: "Which target?",
          options: [],
          requestedAt: clock(),
        }],
        events: [{
          id: `${base.runId}:evt-0`,
          runId: base.runId,
          seq: 0,
          type: "clarification.required",
          createdAt: clock(),
          pattern: base.pattern,
          nodeId: "ora",
          agentId: "ora",
          payload: { clarificationId: "clarification:ora:target" },
        }],
      });
    });

    const blocked = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    expect(blocked.session.attention?.kind).toBe("needs_clarification");

    const resumed = StateSnapshotSchema.parse(await store.resumeRun({
      runId: handle.runId,
      patch: { clarifications: { target: "staging" } },
    }));
    const resumedState = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));
    const detail = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    const summary = store.listSessions().find((item) => item.sessionId === session.sessionId);
    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const coldDetail = SessionDetailSchema.parse(reloaded.getSession({ sessionId: session.sessionId }));
    const coldSummary = reloaded.listSessions().find((item) => item.sessionId === session.sessionId);

    expect(resumed.error).toBeUndefined();
    expect(resumed.status).toBe("succeeded");
    expect(resumed.pendingClarifications).toEqual([]);
    expect(resumed.attention?.kind).toBe("idle");
    expect(resumedState.attention).toEqual(resumed.attention);
    expect(detail.latestSnapshot?.attention).toEqual(resumed.attention);
    expect(detail.session.attention).toEqual(resumed.attention);
    expect(summary?.attention).toEqual(resumed.attention);
    expect(coldDetail.latestSnapshot?.attention).toEqual(resumed.attention);
    expect(coldDetail.session.attention).toEqual(resumed.attention);
    expect(coldSummary?.attention).toEqual(resumed.attention);
    expect(coldDetail.latestSnapshot?.pendingClarifications).toEqual([]);
    expect(readSessionLedger(dir, session.sessionId).entries.filter((entry) =>
      entry.type === "gate.resolved" &&
      entry.runId === handle.runId
    )).toEqual([
      expect.objectContaining({
        id: `${handle.runId}:gate:clarification:ora:target:resolved-${FIXED_TIME}`,
        payload: {
          gateId: "clarification:ora:target",
          status: "resolved",
          resolvedAt: FIXED_TIME,
        },
      }),
    ]);

    const mutableStore = store as unknown as {
      runs: Map<string, unknown>;
      sessions: Map<string, unknown>;
    };
    mutableStore.runs.set(handle.runId, StateSnapshotSchema.parse({
      ...resumed,
      status: "interrupted",
      pendingClarifications: [{
        id: "clarification:stale",
        key: "target",
        nodeId: "ora",
        nodeLabel: "Ora",
        question: "Stale?",
        options: [],
        requestedAt: FIXED_TIME,
      }],
    }));
    mutableStore.sessions.set(session.sessionId, {
      ...detail.session,
      status: "interrupted",
      attention: {
        kind: "paused",
        blocking: false,
        sourceRunId: handle.runId,
        reason: "manual_interrupt",
      },
    });

    const repairedDetail = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    const repairedSummary = store.listSessions().find((item) => item.sessionId === session.sessionId);
    expect(repairedDetail.session.attention).toEqual(resumed.attention);
    expect(repairedDetail.latestSnapshot?.attention).toEqual(resumed.attention);
    expect(repairedDetail.latestSnapshot?.pendingClarifications).toEqual([]);
    expect(repairedSummary?.attention).toEqual(resumed.attention);
  });

  it("does not duplicate gate resolutions when streaming resume delegates to non-kernel resume", async () => {
    const dir = freshStoreDir();
    let now = FIXED_TIME;
    const advancingClock = () => {
      now += 1;
      return now;
    };
    const store = new LocalRunStore({ dataDir: dir, clock: advancingClock });
    const session = store.createSession();
    const handle = await store.startRunWithSnapshot({
      sessionId: session.sessionId,
      input: { prompt: "Clarify non-kernel streaming resume.", createdAt: FIXED_TIME },
      config: {
        modeId: "single_agent",
        providerId: "streaming-non-kernel-clarification-provider",
        modelRef: "streaming-non-kernel-clarification-model",
      },
    }, async (args) => {
      const base = createRunningRunSnapshot({ ...args, clock: advancingClock });
      return StateSnapshotSchema.parse({
        ...base,
        modeSpec: undefined,
        status: "interrupted",
        pendingClarifications: [{
          id: "clarification:ora:stream-target",
          key: "streamTarget",
          nodeId: "ora",
          nodeLabel: "Ora",
          question: "Which streaming target?",
          options: [],
          requestedAt: advancingClock(),
        }],
        events: [{
          id: `${base.runId}:evt-0`,
          runId: base.runId,
          seq: 0,
          type: "clarification.required",
          createdAt: advancingClock(),
          pattern: base.pattern,
          nodeId: "ora",
          agentId: "ora",
          payload: { clarificationId: "clarification:ora:stream-target" },
        }],
      });
    });

    const resumed = await store.resumeStreamingRun({
      runId: handle.runId,
      patch: { clarifications: { streamTarget: "staging" } },
    });
    const resolvedEntries = readSessionLedger(dir, session.sessionId).entries.filter((entry) =>
      entry.type === "gate.resolved" &&
      entry.runId === handle.runId &&
      entry.payload &&
      typeof entry.payload === "object" &&
      (entry.payload as Record<string, unknown>).gateId === "clarification:ora:stream-target"
    );

    expect(["running", "succeeded"]).toContain(resumed.status);
    expect(resolvedEntries).toHaveLength(1);
    expect(resolvedEntries[0]).toMatchObject({
      payload: {
        gateId: "clarification:ora:stream-target",
        status: "resolved",
      },
    });
  });

  it("closes clarification resume projections across SQLite state, session detail, list, and cold reload", async () => {
    const dir = freshStoreDir();
    const dbPath = path.join(dir, "runtime.db");
    const store = new LocalRunStore({ dataDir: dbPath, clock });
    const session = store.createSession();
    const handle = await store.startRunWithSnapshot({
      sessionId: session.sessionId,
      input: { prompt: "Need SQLite clarification before continuing.", createdAt: FIXED_TIME },
      config: {
        modeId: "single_agent",
        providerId: "sqlite-clarification-closure-provider",
        modelRef: "sqlite-clarification-closure-model",
      },
    }, async (args) => {
      const base = createRunningRunSnapshot({ ...args, clock });
      return StateSnapshotSchema.parse({
        ...base,
        status: "interrupted",
        pendingClarifications: [{
          id: "clarification:sqlite:target",
          key: "target",
          nodeId: "ora",
          nodeLabel: "Ora",
          question: "Which SQLite target?",
          options: [],
          requestedAt: clock(),
        }],
        events: [{
          id: `${base.runId}:evt-0`,
          runId: base.runId,
          seq: 0,
          type: "clarification.required",
          createdAt: clock(),
          pattern: base.pattern,
          nodeId: "ora",
          agentId: "ora",
          payload: { clarificationId: "clarification:sqlite:target" },
        }],
      });
    });

    const blocked = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    expect(blocked.session.attention?.kind).toBe("needs_clarification");

    const resumed = StateSnapshotSchema.parse(await store.resumeRun({
      runId: handle.runId,
      patch: { clarifications: { target: "sqlite-staging" } },
    }));
    const resumedState = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));
    const detail = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    const summary = store.listSessions().find((item) => item.sessionId === session.sessionId);
    const reloaded = new LocalRunStore({ dataDir: dbPath, clock });
    const coldDetail = SessionDetailSchema.parse(reloaded.getSession({ sessionId: session.sessionId }));
    const coldSummary = reloaded.listSessions().find((item) => item.sessionId === session.sessionId);

    expect(resumed.error).toBeUndefined();
    expect(resumed.status).toBe("succeeded");
    expect(resumed.pendingClarifications).toEqual([]);
    expect(resumed.attention?.kind).toBe("idle");
    expect(resumedState.attention).toEqual(resumed.attention);
    expect(detail.latestSnapshot?.attention).toEqual(resumed.attention);
    expect(detail.session.attention).toEqual(resumed.attention);
    expect(summary?.attention).toEqual(resumed.attention);
    expect(coldDetail.latestSnapshot?.attention).toEqual(resumed.attention);
    expect(coldDetail.session.attention).toEqual(resumed.attention);
    expect(coldSummary?.attention).toEqual(resumed.attention);
    expect(coldDetail.latestSnapshot?.pendingClarifications).toEqual([]);
  });

  it("closes approval resume projections across state, session detail, list, and cold reload", async () => {
    const dir = freshStoreDir();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-approval-closure-"));
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();
    const handle = await store.startRunWithSnapshot({
      sessionId: session.sessionId,
      input: {
        prompt: "Write the approved note.",
        createdAt: FIXED_TIME,
        context: { projectWorkspace: { label: "Approval Closure", rootPath: workspaceDir } },
      },
      config: {
        modeId: "single_agent",
        providerId: "approval-closure-provider",
        modelRef: "approval-closure-model",
        toolIds: ["file.write"],
        approvalMode: "high_risk_only",
      },
    }, async (args) => {
      const base = createRunningRunSnapshot({ ...args, clock });
      const actionId = `${base.runId}:action-write`;
      const toolCallId = `${base.runId}:tool-call-write`;
      return StateSnapshotSchema.parse({
        ...base,
        status: "interrupted",
        plan: base.plan.map((item) => ({ ...item, status: "done" })),
        todos: base.todos.map((item) => ({ ...item, status: "done", updatedAt: clock() })),
        actions: [{
          id: actionId,
          runId: base.runId,
          type: "file.write",
          riskLevel: "high",
          status: "approval_required",
          input: { path: "notes/approved.md", content: "approved\n" },
          artifactIds: [],
          agentId: "solo_agent",
          planItemId: base.plan[0]?.id,
        }],
        toolCalls: [{
          id: toolCallId,
          runId: base.runId,
          toolId: "file.write",
          args: { path: "notes/approved.md", content: "approved\n" },
          source: "provider_native",
          status: "approval_required",
          actionId,
          agentId: "solo_agent",
          nodeId: "solo_agent",
          requestedAt: clock(),
          updatedAt: clock(),
        }],
        continuation: {
          activeFrameId: `${base.runId}:continuation:0`,
          frames: [{
            id: `${base.runId}:continuation:0`,
            runId: base.runId,
            status: "paused",
            reason: "approval_required",
            conversationCursor: 0,
            pendingActionIds: [actionId],
            pendingToolCallIds: [toolCallId],
            pendingClarificationIds: [],
            approvedActionIds: [],
            resolvedClarificationIds: [],
            createdAt: clock(),
            updatedAt: clock(),
          }],
        },
        pendingApprovals: [actionId],
        attention: {
          kind: "needs_approval",
          blocking: true,
          sourceRunId: base.runId,
          reason: "approval_required",
          pendingActionIds: [actionId],
          pendingToolCallIds: [toolCallId],
          pendingClarificationIds: [],
        },
        events: [{
          id: `${base.runId}:evt-0`,
          runId: base.runId,
          seq: 0,
          type: "approval.required",
          createdAt: clock(),
          pattern: base.pattern,
          nodeId: "solo_agent",
          agentId: "solo_agent",
          payload: { actionId, toolCallId },
        }],
      });
    });

    if (!handle) {
      throw new Error("Expected approval-gated run to start.");
    }
    const blocked = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));
    expect(blocked.attention?.kind).toBe("needs_approval");

    const approvedActionId = blocked.pendingApprovals[0];
    const resumed = StateSnapshotSchema.parse(await store.resumeRun({
      runId: handle.runId,
      patch: { approvedActionIds: [approvedActionId] },
    }));
    const resumedState = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));
    const detail = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    const summary = store.listSessions().find((item) => item.sessionId === session.sessionId);
    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const coldDetail = SessionDetailSchema.parse(reloaded.getSession({ sessionId: session.sessionId }));
    const coldSummary = reloaded.listSessions().find((item) => item.sessionId === session.sessionId);

    expect(resumed.status).toBe("succeeded");
    expect(resumed.pendingApprovals).toEqual([]);
    expect(resumed.actions.some((action) => action.status === "approval_required")).toBe(false);
    expect(resumed.toolCalls.some((call) => call.status === "approval_required")).toBe(false);
    expect(resumed.attention?.kind).toBe("idle");
    expect(resumed.events.map((event) => event.type)).toContain("approval.resolved");
    expect(fs.readFileSync(path.join(workspaceDir, "notes/approved.md"), "utf8")).toBe("approved\n");
    expect(resumedState.attention).toEqual(resumed.attention);
    expect(detail.latestSnapshot?.attention).toEqual(resumed.attention);
    expect(detail.session.attention).toEqual(resumed.attention);
    expect(summary?.attention).toEqual(resumed.attention);
    expect(coldDetail.latestSnapshot?.attention).toEqual(resumed.attention);
    expect(coldDetail.session.attention).toEqual(resumed.attention);
    expect(coldSummary?.attention).toEqual(resumed.attention);
    expect(coldDetail.latestSnapshot?.pendingApprovals).toEqual([]);
    expect(readSessionLedger(dir, session.sessionId).entries.filter((entry) =>
      entry.type === "gate.resolved" &&
      entry.runId === handle.runId
    )).toEqual([
      expect.objectContaining({
        id: `${handle.runId}:gate:approval:resolved-${FIXED_TIME}`,
        payload: {
          gateId: `${handle.runId}:approval`,
          status: "accepted",
          resolvedAt: FIXED_TIME,
        },
      }),
    ]);
  });

  it("consumes accepted plan handoff from the ledger for only the next implementation run", async () => {
    titleResponses.push("Plan Handoff Session");
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();

    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Return a proposed plan for the ledger handoff." },
      config: {
        pattern: "orchestrator_subagent",
        providerId: "openai-gpt",
        modelRef: "gpt-plan-test",
        metadata: { taskIntent: "plan" },
      },
    });
    const planned = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    const decision = planned.latestSnapshot?.planDecisions[0];
    expect(decision?.status).toBe("pending");

    store.resolvePlanDecision({
      sessionId: session.sessionId,
      decisionId: decision?.id,
      status: "accepted",
    });

    const firstImplementation = await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Implement the accepted plan." },
      config: {
        pattern: "generator_verifier",
        providerId: "openai-gpt",
        modelRef: "gpt-implementation-test",
        metadata: { taskIntent: "implement" },
      },
    });
    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Do a separate follow-up." },
      config: {
        pattern: "generator_verifier",
        providerId: "openai-gpt",
        modelRef: "gpt-follow-up-test",
        metadata: { taskIntent: "implement" },
      },
    });

    const firstImplementationRequest = capturedRequests.find((request) =>
      request.modelRef === "gpt-implementation-test" &&
      request.messages.some((message) => message.content.includes("Implement the accepted plan."))
    );
    const followUpRequest = capturedRequests.find((request) =>
      request.modelRef === "gpt-follow-up-test" &&
      request.messages.some((message) => message.content.includes("Do a separate follow-up."))
    );
    expect(firstImplementationRequest?.messages.some((message) => message.content.includes("<accepted_plan>"))).toBe(true);
    expect(followUpRequest?.messages.some((message) => message.content.includes("<accepted_plan>"))).toBe(false);

    const ledgerPath = path.join(dir, "sessions-ledger", `${session.sessionId}.jsonl`);
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: session.sessionId,
      entries: fs.readFileSync(ledgerPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    });
    const projection = deriveSessionProjection(ledger);
    expect(ledger.entries.filter((entry) =>
      entry.type === "gate.resolved" &&
      entry.runId === planned.latestSnapshot?.runId
    )).toEqual([
      expect.objectContaining({
        id: `${planned.latestSnapshot?.runId}:gate:${decision?.id}:resolved`,
        payload: {
          gateId: decision?.id,
          status: "accepted",
          resolvedAt: FIXED_TIME,
        },
      }),
    ]);
    expect(projection.acceptedPlanHandoffs).toEqual([
      expect.objectContaining({
        decisionId: decision?.id,
        sourceRunId: planned.latestSnapshot?.runId,
        consumedByRunId: firstImplementation.runId,
      }),
    ]);
  });

  it("keeps the generated title stable across later turns", async () => {
    titleResponses.push("Initial Session Title", "Second Session Title");
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const session = store.createSession();

    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "First title prompt" },
      config: { pattern: "generator_verifier" },
    });
    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Second title prompt" },
      config: { pattern: "shared_state" },
    });

    const detail = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    const titleRequests = capturedRequests.filter((request) =>
      request.system.includes("Ora's conversation title generator")
    );

    expect(detail.session.title).toBe("Initial Session Title");
    expect(titleRequests).toHaveLength(1);
    expect(titleResponses).toEqual(["Second Session Title"]);
  });

  it("auto-compacts prior session context before a new turn crosses the provider window", async () => {
    titleResponses.push("Long Context Session");
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const session = store.createSession();
    const providerConfig = {
      id: "tiny-context",
      type: "openai" as const,
      label: "Tiny Context",
      modelId: "tiny-context-model",
      contextWindow: 120,
      autoCompactTokenLimit: 100,
      capabilities: ["chat"] as const,
      dropParams: [],
      headers: {},
    };

    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: `First long prompt ${"context ".repeat(180)}` },
      config: {
        pattern: "generator_verifier",
        providerId: providerConfig.id,
        modelRef: providerConfig.modelId,
        providerConfig,
      },
    });
    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Second short prompt" },
      config: {
        pattern: "generator_verifier",
        providerId: providerConfig.id,
        modelRef: providerConfig.modelId,
        providerConfig,
      },
    });

    const detail = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    const compactRequest = capturedRequests.find((request) =>
      request.system.includes("compressing an Ora session history")
    );
    const secondRuntimeRequest = capturedRequests.find((request) =>
      request.messages.some((message) => message.content.includes("Compacted prior session context"))
        && request.messages.some((message) => message.content.includes("Second short prompt"))
    );

    expect(compactRequest?.prompt).toContain("First long prompt");
    expect(detail.session.contextState?.compactionCount).toBe(1);
    expect(detail.session.contextState?.compactedThroughTurnIndex).toBe(1);
    expect(secondRuntimeRequest).toBeDefined();
  });

  it("falls back to a local first-prompt title when title generation fails", async () => {
    titleResponses.push(new Error("title provider unavailable"));
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const session = store.createSession();

    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "This prompt is deliberately longer than fifty characters so fallback truncation is visible." },
      config: { pattern: "generator_verifier" },
    });

    const detail = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    expect(detail.session.title).toBe("This prompt is deliberately longer than fifty char...");
  });

  it("falls back to a local first-prompt title when the title model returns blank text", async () => {
    titleResponses.push(" \n ");
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const session = store.createSession();

    await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Blank model title fallback" },
      config: { pattern: "generator_verifier" },
    });

    const detail = SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId }));
    expect(detail.session.title).toBe("Blank model title fallback");
  });

  it("keeps streaming sessions untitled until the final snapshot persists", async () => {
    titleResponses.push("Streaming Session Title");
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const session = store.createSession();

    const handle = await store.startStreamingRun({
      sessionId: session.sessionId,
      input: { prompt: "Streaming title prompt" },
      config: { pattern: "generator_verifier" },
    });

    expect(handle.status).toBe("running");
    expect(store.getSession({ sessionId: session.sessionId }).session.title).toBe("New Chat");

    const detail = await waitFor(
      () => SessionDetailSchema.parse(store.getSession({ sessionId: session.sessionId })),
      (current) => current.session.title === "Streaming Session Title"
    );

    expect(detail.session.title).toBe("Streaming Session Title");
    expect(detail.latestSnapshot?.status).toBe("succeeded");
  });

  it("keeps active streaming sessions in list summaries after ledger refresh", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const history = store.createSession();
    const streaming = store.createSession();

    const handle = await store.startStreamingRun({
      sessionId: streaming.sessionId,
      input: { prompt: "Streaming list summary prompt" },
      config: { pattern: "generator_verifier" },
    });

    expect(handle.status).toBe("running");
    store.getSession({ sessionId: history.sessionId, includeLatestSnapshot: false });

    const summaries = store.listSessions();
    const activeSummary = summaries.find((item) => item.sessionId === streaming.sessionId);

    expect(activeSummary).toBeDefined();
    expect(activeSummary?.status).toBe("running");
    expect(activeSummary?.latestRunId).toBe(handle.runId);

    await waitFor(
      () => SessionDetailSchema.parse(store.getSession({ sessionId: streaming.sessionId })),
      (current) => current.latestSnapshot?.status === "succeeded"
    );
  });

  it("injects project workspace context for project-scoped session runs", async () => {
    const dataDir = freshStoreDir();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-workspace-"));
    fs.writeFileSync(path.join(workspaceDir, "README.md"), "# Readme\n");
    fs.mkdirSync(path.join(workspaceDir, "notes"));
    fs.writeFileSync(path.join(workspaceDir, "notes", "plan.md"), "# Plan\n");
    fs.writeFileSync(path.join(workspaceDir, "notes", "data.txt"), "data\n");

    const store = new LocalRunStore({ dataDir, clock });
    const project = store.createProject({ rootPath: workspaceDir, label: "workspace" });
    const session = store.createSession({ projectId: project.projectId });
    const handle = await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "这个项目里有多少 md 文件？" },
      config: { pattern: "generator_verifier" },
    });
    const snapshot = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));

    expect(snapshot.input.projectId).toBe(project.projectId);
    expect(snapshot.input.context.projectWorkspace).toMatchObject({
      rootPath: workspaceDir,
      markdownFiles: 2,
      totalFiles: 3,
    });
    expect(capturedRequests.some((request) =>
      request.system.includes("Ora project workspace context:") &&
      request.system.includes(`Root path: ${workspaceDir}`) &&
      request.system.includes("Markdown files: 2")
    )).toBe(true);
  });

  it("executes enabled workspace shell tools inside the project root", async () => {
    const dataDir = freshStoreDir();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-tool-loop-"));
    fs.writeFileSync(path.join(workspaceDir, "README.md"), "# Readme\n");
    fs.writeFileSync(path.join(workspaceDir, "plan.md"), "# Plan\n");
    fs.writeFileSync(path.join(workspaceDir, "notes.txt"), "note\n");

    const store = new LocalRunStore({ dataDir, clock });
    const project = store.createProject({ rootPath: workspaceDir, label: "workspace" });
    const session = store.createSession({ projectId: project.projectId });
    const handle = await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Count markdown with shell" },
      config: {
        pattern: "orchestrator_subagent",
        toolIds: ["shell.execute"],
        approvalMode: "auto",
      },
    });
    const snapshot = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));

    expect(snapshot.actions.some((action) =>
      action.type === "shell.execute" &&
      action.status === "succeeded" &&
      (action.output as { output?: string } | undefined)?.output.includes("README.md")
    )).toBe(true);
    expect(snapshot.events.some((event) =>
      event.type === "tool.called" &&
      typeof event.payload === "object" &&
      event.payload !== null &&
      (event.payload as { toolId?: string }).toolId === "shell.execute"
    )).toBe(true);
    expect(capturedRequests.some((request) =>
      (request.prompt?.includes("Workspace tool result for shell.execute") ?? false) ||
      request.messages.some((message) => message.content.includes("Workspace tool result for shell.execute"))
    )).toBe(true);
  });

  it("blocks workspace shell commands that target absolute paths", async () => {
    const dataDir = freshStoreDir();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-tool-guard-"));
    fs.writeFileSync(path.join(workspaceDir, "README.md"), "# Readme\n");

    const store = new LocalRunStore({ dataDir, clock });
    const project = store.createProject({ rootPath: workspaceDir, label: "workspace" });
    const session = store.createSession({ projectId: project.projectId });
    const handle = await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Try escaping shell" },
      config: {
        pattern: "orchestrator_subagent",
        toolIds: ["shell.execute"],
        approvalMode: "auto",
      },
    });
    const snapshot = StateSnapshotSchema.parse(store.getRunState({ runId: handle.runId }));

    expect(snapshot.actions.some((action) =>
      action.type === "shell.execute" &&
      action.status === "failed" &&
      action.error?.includes("project root")
    )).toBe(true);
    expect(snapshot.events.some((event) =>
      event.type === "message.delta" &&
      typeof event.payload === "object" &&
      event.payload !== null &&
      String((event.payload as { content?: string }).content ?? "").includes("tool-error-boundary") &&
      (event.payload as { visibility?: string }).visibility === "internal"
    )).toBe(true);
  });

  it("appends turns inside a session and rebuilds transcript for later turns", async () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir(), clock }));

    const session = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "sessions.create",
      params: {},
    }) as { sessionId: string; turnCount: number };

    const first = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        sessionId: session.sessionId,
        input: { prompt: "First prompt" },
        config: { pattern: "generator_verifier" },
      },
    }) as { runId: string; sessionId: string; turnIndex: number };

    const second = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        sessionId: session.sessionId,
        input: { prompt: "Second prompt" },
        config: { pattern: "shared_state" },
      },
    }) as { runId: string; sessionId: string; turnIndex: number };

    const detail = SessionDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "sessions.get",
      params: { sessionId: session.sessionId },
    }));

    const sessionRuns = await handle({
      jsonrpc: "2.0",
      id: 5,
      method: "runs.list",
      params: { sessionId: session.sessionId },
    }) as Array<{ runId: string }>;

    expect(first.sessionId).toBe(session.sessionId);
    expect(first.turnIndex).toBe(1);
    expect(second.sessionId).toBe(session.sessionId);
    expect(second.turnIndex).toBe(2);
    expect(sessionRuns.map((run) => run.runId)).toEqual([first.runId, second.runId]);

    expect(detail.session.turnCount).toBe(2);
    expect(detail.session.latestRunId).toBe(second.runId);
    expect(detail.session.latestPattern).toBe("shared_state");
    expect(detail.turns.map((turn) => turn.pattern)).toEqual([
      "generator_verifier",
      "shared_state",
    ]);
    expect(detail.transcript.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(detail.transcript[0]?.content).toBe("First prompt");
    expect(detail.transcript[1]?.content).toContain("First prompt");
    expect(detail.transcript[2]?.content).toBe("Second prompt");
    expect(detail.transcript[3]?.content).toContain("Second prompt");
    expect(detail.latestSnapshot?.runId).toBe(second.runId);
    expect(detail.latestSnapshot?.pattern).toBe("shared_state");

    expect(capturedRequests.some((request) => (
      request.messages.length === 1 &&
      request.messages[0]?.role === "user" &&
      request.messages[0]?.content === "First prompt"
    ))).toBe(true);
    expect(capturedRequests.some((request) => (
      request.messages.length === 3 &&
      request.messages[0]?.role === "user" &&
      request.messages[0]?.content === "First prompt" &&
      request.messages[1]?.role === "assistant" &&
      request.messages[1]?.content.includes("First prompt") &&
      request.messages[2]?.role === "user" &&
      request.messages[2]?.content === "Second prompt"
    ))).toBe(true);
  });

  it("builds later model context from the ledger instead of in-memory run snapshots", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const handle = createRuntimeMethodHandler(store);

    const first = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Ledger-owned prompt" },
        config: { pattern: "generator_verifier" },
      },
    }) as { runId: string; sessionId: string };

    const mutableStore = store as unknown as { runs: Map<string, unknown> };
    const original = StateSnapshotSchema.parse(mutableStore.runs.get(first.runId));
    mutableStore.runs.set(first.runId, StateSnapshotSchema.parse({
      ...original,
      input: {
        ...original.input,
        prompt: "SHADOW SNAPSHOT PROMPT",
      },
      output: {
        text: "SHADOW SNAPSHOT ANSWER",
      },
    }));

    const detailAfterShadowWrite = SessionDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "sessions.get",
      params: { sessionId: first.sessionId },
    }));
    expect(detailAfterShadowWrite.latestSnapshot?.input.prompt).toBe("Ledger-owned prompt");
    expect(detailAfterShadowWrite.latestSnapshot?.output).not.toMatchObject({ text: "SHADOW SNAPSHOT ANSWER" });

    await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.start",
      params: {
        sessionId: first.sessionId,
        input: { prompt: "Second ledger context prompt" },
        config: { pattern: "shared_state" },
      },
    });

    const secondRuntimeRequest = capturedRequests.find((request) =>
      !request.system.includes("Ora's conversation title generator") &&
      request.messages.some((message) => message.content === "Second ledger context prompt")
    );

    expect(secondRuntimeRequest?.messages).toEqual([
      { role: "user", content: "Ledger-owned prompt" },
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("Ledger-owned prompt"),
      }),
      { role: "user", content: "Second ledger context prompt" },
    ]);
    expect(secondRuntimeRequest?.messages.some((message) =>
      message.content.includes("SHADOW SNAPSHOT")
    )).toBe(false);
  });

  it("keeps forks attached to the originating session", async () => {
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: freshStoreDir(), clock }));

    const source = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Fork source" },
        config: { pattern: "orchestrator_subagent", metadata: { disableDefaultWebTools: true, langGraphOrchestration: true } },
      },
    }) as { runId: string; sessionId: string; turnIndex: number };

    const sourceState = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.state",
      params: { runId: source.runId },
    }));

    const fork = await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "runs.fork",
      params: {
        runId: source.runId,
        checkpointId: sourceState.checkpoints[0]?.id,
        input: { prompt: "Fork follow-up" },
      },
    }) as { runId: string; sessionId: string; turnIndex: number };

    const sessionDetail = SessionDetailSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "sessions.get",
      params: { sessionId: source.sessionId },
    }));

    expect(fork.runId).not.toBe(source.runId);
    expect(fork.sessionId).toBe(source.sessionId);
    expect(fork.turnIndex).toBe(2);
    expect(sessionDetail.turns.map((turn) => turn.runId)).toEqual([source.runId, fork.runId]);
    expect(sessionDetail.session.turnCount).toBe(2);
  });

  it("persists branch created, candidate started, and dismissed facts in the session ledger", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();

    const group = await store.createAndRunSessionBranchGroup({
      sessionId: session.sessionId,
      target: "empty_start",
      prompt: "Try branch lifecycle.",
      candidates: [
        { label: "Candidate A", config: { pattern: "generator_verifier" } },
      ],
    });

    await waitFor(
      () => store.getSessionBranchGroup({ sessionId: session.sessionId, branchGroupId: group.branchGroupId }),
      (current) => current.status === "ready",
    );
    store.dismissSessionBranchGroup({ sessionId: session.sessionId, branchGroupId: group.branchGroupId });

    const ledgerPath = path.join(dir, "sessions-ledger", `${session.sessionId}.jsonl`);
    const entries = fs.readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const branchEntries = entries.filter((entry) => String(entry.type).startsWith("branch."));
    const projection = deriveSessionProjection(RuntimeSessionLedgerSchema.parse({
      sessionId: session.sessionId,
      entries,
    }));

    expect(branchEntries.map((entry) => entry.type)).toEqual([
      "branch.created",
      "branch.candidate_started",
      "branch.dismissed",
    ]);
    expect(branchEntries[1]?.runId).toBe(group.candidateRunIds[0]);
    expect(projection.branchGroups).toEqual([
      expect.objectContaining({
        branchGroupId: group.branchGroupId,
        status: "dismissed",
        candidateRunIds: group.candidateRunIds,
      }),
    ]);
  });

  it("persists branch candidate run facts without exposing them on the mainline before adoption", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();

    const group = await store.createAndRunSessionBranchGroup({
      sessionId: session.sessionId,
      target: "empty_start",
      prompt: "Try durable branch candidate.",
      candidates: [
        { label: "Candidate A", config: { pattern: "generator_verifier" } },
      ],
    });
    await waitFor(
      () => store.getSessionBranchGroup({ sessionId: session.sessionId, branchGroupId: group.branchGroupId }),
      (current) => current.status === "ready",
    );

    const candidateRunId = group.candidateRunIds[0]!;
    const ledgerPath = path.join(dir, "sessions-ledger", `${session.sessionId}.jsonl`);
    const entries = fs.readFileSync(ledgerPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const ledger = RuntimeSessionLedgerSchema.parse({
      sessionId: session.sessionId,
      entries,
      leafEntryId: entries.at(-1)?.id,
    });
    const candidateAssistant = entries.find((entry) => entry.id === `${candidateRunId}:assistant`);
    expect(entries.filter((entry) => entry.runId === candidateRunId).map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["user.message", "run.started", "runtime.event_batch", "assistant.message"]),
    );
    expect(deriveSessionProjection(ledger).runs.map((run) => run.runId)).toEqual([]);
    expect(candidateAssistant).toBeTruthy();
    expect(deriveSessionProjection(ledger, candidateAssistant.id).runs.map((run) => run.runId)).toEqual([candidateRunId]);
  });

  it("keeps candidate gate resolution facts on the candidate leaf path", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();
    const handle = await store.startRunWithSnapshot({
      sessionId: session.sessionId,
      input: { prompt: "Candidate needs a scoped answer.", createdAt: FIXED_TIME },
      config: {
        modeId: "single_agent",
        providerId: "candidate-gate-resolution-provider",
        modelRef: "candidate-gate-resolution-model",
        metadata: { branchRole: "candidate", branchGroupId: "branch-candidate-gate-resolution" },
      },
    }, async (args) => {
      const base = createRunningRunSnapshot({ ...args, clock });
      return StateSnapshotSchema.parse({
        ...base,
        status: "interrupted",
        output: { text: "Candidate is waiting for scope." },
        pendingClarifications: [{
          id: "clarification:candidate:scope",
          key: "scope",
          nodeId: "ora",
          nodeLabel: "Ora",
          question: "Which candidate scope?",
          options: [],
          requestedAt: FIXED_TIME + 10,
        }],
        events: [{
          id: `${base.runId}:evt-0`,
          runId: base.runId,
          seq: 0,
          type: "clarification.required",
          createdAt: FIXED_TIME + 10,
          pattern: base.pattern,
          nodeId: "ora",
          agentId: "ora",
          payload: { clarificationId: "clarification:candidate:scope" },
        }],
      });
    });

    const metaPath = path.join(dir, "sessions-ledger", `${session.sessionId}.meta.json`);
    const mainlineLeafBefore = JSON.parse(fs.readFileSync(metaPath, "utf8")).leafEntryId;
    const candidateSnapshot = StateSnapshotSchema.parse(store.getRunState({ runId: handle!.runId }));
    const candidateLedgerBefore = readSessionLedger(dir, session.sessionId);
    const candidateAssistant = candidateLedgerBefore.entries.find((entry) => entry.id === `${handle!.runId}:assistant`);
    expect(candidateAssistant).toBeTruthy();

    (store as unknown as {
      runLedgerBranchService: { clearCandidateLeaf(runId: string): void };
      appendGateResolutionsForResume(
        snapshot: unknown,
        gateResolutions: RuntimeGateResolution[],
      ): void;
    }).runLedgerBranchService.clearCandidateLeaf(handle!.runId);
    (store as unknown as {
      appendGateResolutionsForResume(
        snapshot: unknown,
        gateResolutions: RuntimeGateResolution[],
      ): void;
    }).appendGateResolutionsForResume(candidateSnapshot, [{
      kind: "clarification",
      gateId: "clarification:candidate:scope",
      value: "pilot",
    }]);

    const mainlineLeafAfter = JSON.parse(fs.readFileSync(metaPath, "utf8")).leafEntryId;
    const ledger = readSessionLedger(dir, session.sessionId);
    const resolvedEntry = ledger.entries.find((entry) =>
      entry.type === "gate.resolved" &&
      entry.runId === handle!.runId &&
      entry.payload &&
      typeof entry.payload === "object" &&
      (entry.payload as Record<string, unknown>).gateId === "clarification:candidate:scope"
    );

    expect(mainlineLeafAfter).toBe(mainlineLeafBefore);
    expect(resolvedEntry).toMatchObject({
      parentId: candidateAssistant?.id,
      payload: {
        gateId: "clarification:candidate:scope",
        status: "resolved",
        resolvedAt: FIXED_TIME,
      },
    });
    expect(deriveSessionProjection(RuntimeSessionLedgerSchema.parse({
      sessionId: session.sessionId,
      leafEntryId: mainlineLeafAfter,
      entries: ledger.entries,
    })).runs.map((run) => run.runId)).toEqual([]);
    expect(deriveSessionProjection(RuntimeSessionLedgerSchema.parse({
      sessionId: session.sessionId,
      leafEntryId: resolvedEntry?.id,
      entries: ledger.entries,
    })).latestSnapshot?.pendingClarifications).toEqual([]);
  });

  it("keeps public API branch candidate resume facts off the mainline ledger leaf", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const handle = createRuntimeMethodHandler(store);
    const session = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "sessions.create",
      params: {},
    }) as { sessionId: string };
    const cloned = await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "modes.cloneFromPreset",
      params: {
        sourceModeId: "orchestrator_subagent",
        modeId: "orchestrator-candidate-clarification",
        label: "Orchestrator Candidate Clarification",
      },
    }) as any;

    await handle({
      jsonrpc: "2.0",
      id: 3,
      method: "modes.update",
      params: {
        modeId: cloned.id,
        spec: {
          ...cloned,
          summary: "Custom orchestrator mode with a branch candidate clarification gate.",
          nodes: cloned.nodes.map((node: { id: string; config?: Record<string, unknown> }) =>
            node.id === "research"
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    clarificationQuestion: "What scope should research use?",
                  },
                }
              : node
          ),
        },
      },
    });

    const group = await handle({
      jsonrpc: "2.0",
      id: 4,
      method: "sessions.branchGroups.createAndRun",
      params: {
        sessionId: session.sessionId,
        target: "empty_start",
        prompt: "Run candidate clarification.",
        candidates: [{
          label: "Candidate A",
          config: { modeId: cloned.id },
        }],
      },
    }) as { branchGroupId: string; candidateRunIds: string[] };

    const candidateRunId = group.candidateRunIds[0]!;
    const blocked = await waitFor(
      () => StateSnapshotSchema.parse(handle({
        jsonrpc: "2.0",
        id: 5,
        method: "runs.state",
        params: { runId: candidateRunId },
      })),
      (current) => current.status === "interrupted",
    );
    expect(blocked.config.metadata.branchRole).toBe("candidate");
    expect(blocked.pendingClarifications).toEqual([
      expect.objectContaining({
        id: "clarification:research",
        key: "research",
        question: "What scope should research use?",
      }),
    ]);

    const metaPath = path.join(dir, "sessions-ledger", `${session.sessionId}.meta.json`);
    const mainlineLeafBefore = JSON.parse(fs.readFileSync(metaPath, "utf8")).leafEntryId;
    const resumed = StateSnapshotSchema.parse(await handle({
      jsonrpc: "2.0",
      id: 6,
      method: "runs.resume",
      params: {
        runId: candidateRunId,
        patch: { clarifications: { research: "pilot" } },
      },
    }));
    const mainlineLeafAfter = JSON.parse(fs.readFileSync(metaPath, "utf8")).leafEntryId;
    const ledger = readSessionLedger(dir, session.sessionId);
    const openedEntry = ledger.entries.find((entry) =>
      entry.type === "gate.opened" &&
      entry.runId === candidateRunId &&
      entry.payload &&
      typeof entry.payload === "object" &&
      (entry.payload as Record<string, unknown>).gateId === "clarification:research"
    );
    const resolvedEntry = ledger.entries.find((entry) =>
      entry.type === "gate.resolved" &&
      entry.runId === candidateRunId &&
      entry.payload &&
      typeof entry.payload === "object" &&
      (entry.payload as Record<string, unknown>).gateId === "clarification:research"
    );
    const entriesById = new Map(ledger.entries.map((entry) => [entry.id, entry]));
    const ancestorIdsFor = (entryId: string | undefined): string[] => {
      const ancestorIds: string[] = [];
      let cursor = entryId;
      while (cursor) {
        ancestorIds.push(cursor);
        cursor = entriesById.get(cursor)?.parentId;
      }
      return ancestorIds;
    };
    const resolvedAncestorIds = ancestorIdsFor(resolvedEntry?.id);
    const candidateLeafAfterResume = ledger.entries
      .filter((entry) => entry.runId === candidateRunId && ancestorIdsFor(entry.id).includes(resolvedEntry?.id ?? ""))
      .at(-1);

    expect(resumed.status).toBe("succeeded");
    expect(resumed.pendingClarifications).toEqual([]);
    expect(resumed.events.map((event) => event.type)).toContain("clarification.resolved");
    expect(mainlineLeafAfter).toBe(mainlineLeafBefore);
    expect(openedEntry).toBeTruthy();
    expect(resolvedEntry).toMatchObject({
      payload: {
        gateId: "clarification:research",
        status: "resolved",
        resolvedAt: FIXED_TIME,
      },
    });
    expect(resolvedEntry?.parentId).not.toBe(mainlineLeafAfter);
    expect(resolvedAncestorIds).toContain(openedEntry?.id);
    expect(deriveSessionProjection(RuntimeSessionLedgerSchema.parse({
      sessionId: session.sessionId,
      leafEntryId: mainlineLeafAfter,
      entries: ledger.entries,
    })).runs.map((run) => run.runId)).toEqual([]);
    expect(deriveSessionProjection(RuntimeSessionLedgerSchema.parse({
      sessionId: session.sessionId,
      leafEntryId: candidateLeafAfterResume?.id,
      entries: ledger.entries,
    })).latestSnapshot?.pendingClarifications).toEqual([]);
  });

  it("adopts a durable branch candidate after reloading the runtime store", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const session = store.createSession();

    const group = await store.createAndRunSessionBranchGroup({
      sessionId: session.sessionId,
      target: "empty_start",
      prompt: "Try reloadable branch adoption.",
      candidates: [
        { label: "Candidate A", config: { pattern: "generator_verifier" } },
      ],
    });
    await waitFor(
      () => store.getSessionBranchGroup({ sessionId: session.sessionId, branchGroupId: group.branchGroupId }),
      (current) => current.status === "ready",
    );

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const adopted = SessionDetailSchema.parse(reloaded.adoptSessionBranchGroup({
      sessionId: session.sessionId,
      branchGroupId: group.branchGroupId,
      runId: group.candidateRunIds[0],
    }));

    expect(adopted.session.latestRunId).toBe(group.candidateRunIds[0]);
    expect(adopted.turns.map((turn) => turn.runId)).toEqual([group.candidateRunIds[0]]);
    expect(adopted.branchGroups[0]).toEqual(expect.objectContaining({
      branchGroupId: group.branchGroupId,
      status: "adopted",
      adoptedRunId: group.candidateRunIds[0],
    }));
  });

  it("adopts a durable branch candidate after reloading SQLite runtime storage", async () => {
    const dir = freshStoreDir();
    const dbPath = path.join(dir, "runtime.db");
    const store = new LocalRunStore({ dataDir: dbPath, clock });
    const session = store.createSession();

    const group = await store.createAndRunSessionBranchGroup({
      sessionId: session.sessionId,
      target: "empty_start",
      prompt: "Try SQLite reloadable branch adoption.",
      candidates: [
        { label: "Candidate A", config: { pattern: "generator_verifier" } },
      ],
    });
    await waitFor(
      () => store.getSessionBranchGroup({ sessionId: session.sessionId, branchGroupId: group.branchGroupId }),
      (current) => current.status === "ready",
    );

    const reloaded = new LocalRunStore({ dataDir: dbPath, clock });
    const adopted = SessionDetailSchema.parse(reloaded.adoptSessionBranchGroup({
      sessionId: session.sessionId,
      branchGroupId: group.branchGroupId,
      runId: group.candidateRunIds[0],
    }));

    expect(adopted.session.latestRunId).toBe(group.candidateRunIds[0]);
    expect(adopted.turns.map((turn) => turn.runId)).toEqual([group.candidateRunIds[0]]);
    expect(adopted.branchGroups[0]).toEqual(expect.objectContaining({
      branchGroupId: group.branchGroupId,
      status: "adopted",
      adoptedRunId: group.candidateRunIds[0],
    }));
  });

  it("keeps SQLite startup on session summaries and lazily restores run details", async () => {
    const dir = freshStoreDir();
    const dbPath = path.join(dir, "runtime.db");
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: dbPath, clock }));

    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "SQLite lazy startup detail" },
        config: { pattern: "orchestrator_subagent", metadata: { disableDefaultWebTools: true } },
      },
    }) as { runId: string; sessionId: string };

    const reloaded = new LocalRunStore({ dataDir: dbPath, clock });
    const sessions = reloaded.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(expect.objectContaining({
      sessionId: run.sessionId,
      latestRunId: run.runId,
      turnCount: 1,
    }));
    expect(reloaded.listRuns()).toEqual([]);

    const reloadedHandle = createRuntimeMethodHandler(reloaded);
    const bootstrap = RuntimeWorkbenchBootstrapSchema.parse(await reloadedHandle({
      jsonrpc: "2.0",
      id: 2,
      method: "runtime.workbenchBootstrap",
      params: {},
    }));
    expect(bootstrap.sessions.some((session) => session.latestRunId === run.runId)).toBe(true);
    expect(reloaded.listRuns()).toEqual([]);

    const detail = SessionDetailSchema.parse(reloaded.getSession({ sessionId: run.sessionId }));
    expect(detail.turns.map((turn) => turn.runId)).toEqual([run.runId]);
    expect(detail.transcript.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(detail.latestSnapshot?.runId).toBe(run.runId);
    expect(detail.latestSnapshot?.events.length).toBeGreaterThan(0);
  });

  it("does not persist clean-cutover runs into legacy run files", async () => {
    const dir = freshStoreDir();
    const handle = createRuntimeMethodHandler(new LocalRunStore({ dataDir: dir, clock }));

    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Legacy migration prompt" },
        config: { pattern: "agent_teams" },
      },
    }) as { runId: string };

    const runPath = path.join(dir, "runs", `${run.runId}.json`);
    expect(fs.existsSync(runPath)).toBe(false);

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const sessions = reloaded.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.latestRunId).toBe(run.runId);
    expect(sessions[0]?.turnCount).toBe(1);

    const detail = SessionDetailSchema.parse(reloaded.getSession({
      sessionId: sessions[0]!.sessionId,
    }));
    expect(detail.session.latestRunId).toBe(run.runId);
    expect(detail.latestSnapshot?.turnIndex).toBe(1);
    expect(detail.transcript.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(detail.transcript[0]?.content).toBe("Legacy migration prompt");
    expect(detail.transcript[1]?.content).toContain("Legacy migration prompt");
  });

  it("keeps ledger-backed state authoritative over legacy placeholder files", async () => {
    const dir = freshStoreDir();
    const store = new LocalRunStore({ dataDir: dir, clock });
    const project = store.createProject({ rootPath: dir });
    const session = store.createSession({ projectId: project.projectId });
    const run = await store.startRun({
      sessionId: session.sessionId,
      input: { prompt: "Placeholder project" },
      config: { pattern: "orchestrator_subagent" },
    });

    const legacySession = {
      ...store.getSession({ sessionId: session.sessionId }).session,
      projectId: "ora-mvp",
    };
    const existingRun = store.getRunState({ runId: run.runId });
    const legacyRun = {
      ...existingRun,
      input: {
        ...existingRun.input,
        projectId: "ora-mvp",
      },
    };

    fs.writeFileSync(
      path.join(dir, "sessions", `${encodeURIComponent(session.sessionId)}.json`),
      `${JSON.stringify(legacySession, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(dir, "runs", `${encodeURIComponent(run.runId)}.json`),
      `${JSON.stringify(legacyRun, null, 2)}\n`,
    );

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    expect(reloaded.getSession({ sessionId: session.sessionId }).session.projectId).toBe(project.projectId);
    expect(reloaded.getRunState({ runId: run.runId }).input.projectId).toBe(project.projectId);
  });

  it("uses the runtime kernel even when legacy graph metadata is present", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const handle = createRuntimeMethodHandler(store);

    const run = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Default to the runtime kernel" },
        config: { pattern: "orchestrator_subagent", metadata: { disableDefaultWebTools: true } },
      },
    }) as { runId: string };
    const state = StateSnapshotSchema.parse(store.getRunState({ runId: run.runId }));

    expect(state.status).toBe("succeeded");
    expect(state.output).toMatchObject({ pattern: "orchestrator_subagent" });
  });

  it("ignores explicit legacy graph orchestration metadata for new JSON-RPC runs", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const handle = createRuntimeMethodHandler(store);

    const first = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "First managed turn" },
        config: { pattern: "orchestrator_subagent", metadata: { disableDefaultWebTools: true, langGraphOrchestration: true } },
      },
    }) as { sessionId: string };

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        sessionId: first.sessionId,
        input: { prompt: "Second managed turn" },
        config: { pattern: "orchestrator_subagent", metadata: { disableDefaultWebTools: true, langGraphOrchestration: true } },
      },
    });

    const detail = store.getSession({ sessionId: first.sessionId });
    expect(detail.session.turnCount).toBe(2);
    expect(detail.latestSnapshot?.config.metadata.langGraphOrchestration).toBe(true);
    expect(detail.latestSnapshot?.output).toMatchObject({ pattern: "orchestrator_subagent" });
  });

  it("passes rebuilt session transcript into runtime-kernel provider calls", async () => {
    const store = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const handle = createRuntimeMethodHandler(store);

    const first = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "First real managed turn" },
        config: { pattern: "orchestrator_subagent", metadata: { disableDefaultWebTools: true, langGraphOrchestration: true } },
      },
    }) as { sessionId: string };

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        sessionId: first.sessionId,
        input: { prompt: "Second real managed turn" },
        config: { pattern: "orchestrator_subagent", metadata: { disableDefaultWebTools: true, langGraphOrchestration: true } },
      },
    });

    const firstTurnRequests = capturedRequests.filter((request) =>
      !request.system.includes("Ora's conversation title generator") &&
      request.prompt.includes("First real managed turn")
    );
    const secondTurnRequests = capturedRequests.filter((request) =>
      !request.system.includes("Ora's conversation title generator") &&
      request.prompt.includes("Second real managed turn")
    );

    expect(firstTurnRequests.length).toBeGreaterThan(0);
    expect(secondTurnRequests.length).toBeGreaterThan(0);
    expect(firstTurnRequests[0]?.messages).toEqual([
      { role: "user", content: "First real managed turn" },
    ]);
    expect(secondTurnRequests[0]?.messages).toHaveLength(3);
    expect(secondTurnRequests[0]?.messages[0]).toEqual({
      role: "user",
      content: "First real managed turn",
    });
    expect(secondTurnRequests[0]?.messages[1]?.role).toBe("assistant");
    expect(secondTurnRequests[0]?.messages[1]?.content).toContain("First real managed turn");
    expect(secondTurnRequests[0]?.messages[2]).toEqual({
      role: "user",
      content: "Second real managed turn",
    });
  });
});
