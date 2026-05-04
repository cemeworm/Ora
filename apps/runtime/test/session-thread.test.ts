import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionDetailSchema, StateSnapshotSchema } from "@cemeworm/shared";

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
        ? JSON.stringify({ tool: "shell.execute", args: { command: "rg --files -g *.md" } })
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

const FIXED_TIME = 1_700_000_000_000;
const clock = () => FIXED_TIME;

function freshStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-session-test-"));
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
      String((event.payload as { content?: string }).content ?? "").includes("tool-error-boundary")
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

  it("migrates legacy runs into single-turn legacy sessions", async () => {
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
    const persistedRun = JSON.parse(fs.readFileSync(runPath, "utf8")) as Record<string, unknown>;
    delete persistedRun.sessionId;
    delete persistedRun.turnIndex;
    fs.writeFileSync(runPath, JSON.stringify(persistedRun, null, 2));
    fs.rmSync(path.join(dir, "sessions"), { recursive: true, force: true });

    const reloaded = new LocalRunStore({ dataDir: dir, clock });
    const sessions = reloaded.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(`session-legacy-${run.runId}`);
    expect(sessions[0]?.turnCount).toBe(1);

    const detail = SessionDetailSchema.parse(reloaded.getSession({
      sessionId: `session-legacy-${run.runId}`,
    }));
    expect(detail.session.latestRunId).toBe(run.runId);
    expect(detail.latestSnapshot?.sessionId).toBe(`session-legacy-${run.runId}`);
    expect(detail.latestSnapshot?.turnIndex).toBe(1);
    expect(detail.transcript.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(detail.transcript[0]?.content).toBe("Legacy migration prompt");
    expect(detail.transcript[1]?.content).toContain("Legacy migration prompt");
  });

  it("migrates legacy ora-mvp placeholder project ids into unscoped recent chats", async () => {
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
    expect(reloaded.getSession({ sessionId: session.sessionId }).session.projectId).toBeUndefined();
    expect(reloaded.getRunState({ runId: run.runId }).input.projectId).toBeUndefined();
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
