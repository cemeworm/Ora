import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionDetailSchema, StateSnapshotSchema } from "@ora/shared";

const capturedRequests: Array<{
  prompt: string;
  messages: { role: string; content: string }[];
}> = [];

vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>(
    "../src/providers/index.js"
  );

  return {
    ...actual,
    invokeRunProvider: vi.fn(async (config, request) => {
      capturedRequests.push({
        prompt: request.prompt,
        messages: (request.messages ?? []).map((message) => ({
          role: message.role,
          content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        })),
      });

      return {
        providerId: config.providerId ?? "mock-provider",
        modelId: config.modelRef ?? "mock-model",
        text: `reply:${request.prompt}`,
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

    const created = firstStore.createSession({ projectId: "project-alpha" });
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
