import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionDetailSchema, StateSnapshotSchema } from "@ora/shared";

const capturedRequests: Array<{
  prompt: string;
  system: string;
  messages: { role: string; content: string }[];
}> = [];

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
      const text = shouldEscapeShell
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
      });

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

describe("session thread runtime behavior", () => {
  beforeEach(() => {
    capturedRequests.length = 0;
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
        config: { pattern: "orchestrator_subagent" },
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

  it("passes rebuilt session transcript through the LangGraph session manager path", async () => {
    const capturedConversationMessages: Array<Array<{ role: string; content: string }>> = [];
    const managerBackedStore = new LocalRunStore({ dataDir: freshStoreDir(), clock });
    const fakeSessionManager = {
      isEnabled: () => true,
      startRun: async (
        _runId: string,
        input: { prompt: string },
        config: { pattern: string },
        conversationMessages: Array<{ role: string; content: string }>
      ) => {
        capturedConversationMessages.push(
          conversationMessages.map((message) => ({
            role: message.role,
            content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
          }))
        );
        const nestedStore = new LocalRunStore({ dataDir: freshStoreDir(), clock });
        const handle = await nestedStore.startRun({
          input: { prompt: input.prompt },
          config: { pattern: config.pattern },
        });
        return nestedStore.getRunState({ runId: handle.runId });
      },
    };
    const handle = createRuntimeMethodHandler(
      managerBackedStore,
      fakeSessionManager as never
    );

    const first = await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "First managed turn" },
        config: { pattern: "orchestrator_subagent" },
      },
    }) as { sessionId: string };

    await handle({
      jsonrpc: "2.0",
      id: 2,
      method: "runs.start",
      params: {
        sessionId: first.sessionId,
        input: { prompt: "Second managed turn" },
        config: { pattern: "orchestrator_subagent" },
      },
    });

    expect(capturedConversationMessages).toHaveLength(2);
    expect(capturedConversationMessages[0]).toEqual([
      { role: "user", content: "First managed turn" },
    ]);
    expect(capturedConversationMessages[1]).toHaveLength(3);
    expect(capturedConversationMessages[1]?.[0]).toEqual({
      role: "user",
      content: "First managed turn",
    });
    expect(capturedConversationMessages[1]?.[1]?.role).toBe("assistant");
    expect(capturedConversationMessages[1]?.[1]?.content).toContain("First managed turn");
    expect(capturedConversationMessages[1]?.[2]).toEqual({
      role: "user",
      content: "Second managed turn",
    });
  });
});
