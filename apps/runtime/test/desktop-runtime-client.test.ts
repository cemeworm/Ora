import { describe, expect, it } from "vitest";
import { USER_CANCELLED_MESSAGE, createRuntimeClient } from "../../desktop/src/lib/runtimeClient";
import { adaptChatMessages } from "../../desktop/src/lib/viewModel";

describe("desktop browser-mock runtime lifecycle", () => {
  it("does not render pattern template plans as turn todos", async () => {
    const client = createRuntimeClient();
    const session = await client.createSession();
    const snapshot = await client.startRun(
      { prompt: "Render a simple answer without an explicit plan." },
      { modeId: "generator_verifier" },
      session.sessionId,
    );
    const legacySnapshot = { ...snapshot };
    delete (legacySnapshot as { todos?: unknown }).todos;
    delete (legacySnapshot as { pendingApprovals?: unknown }).pendingApprovals;
    delete (legacySnapshot as { pendingClarifications?: unknown }).pendingClarifications;

    const messages = adaptChatMessages(
      [
        {
          id: `${snapshot.runId}:user`,
          sessionId: session.sessionId,
          runId: snapshot.runId,
          turnIndex: snapshot.turnIndex ?? 1,
          role: "user",
          content: snapshot.input.prompt,
          pattern: snapshot.pattern,
          modeId: snapshot.modeId,
          createdAt: snapshot.input.createdAt ?? snapshot.updatedAt,
        },
      ],
      { [snapshot.runId]: legacySnapshot },
    );

    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.turn?.todos).toEqual([]);
    expect(assistant?.turn?.processSteps).toEqual([]);
  });

  it("renders real runtime tool calls with their target objects", async () => {
    const client = createRuntimeClient();
    const session = await client.createSession();
    const snapshot = await client.startRun(
      { prompt: "Read a file with a workspace tool." },
      { modeId: "generator_verifier" },
      session.sessionId,
    );
    const toolSnapshot = {
      ...snapshot,
      events: [
        ...snapshot.events,
        {
          id: `${snapshot.runId}:evt-tool`,
          runId: snapshot.runId,
          seq: snapshot.events.length,
          type: "tool.called" as const,
          createdAt: snapshot.updatedAt + 1,
          pattern: snapshot.pattern,
          payload: {
            toolId: "file.read",
            status: "succeeded",
            input: { path: "notes/project.md" },
            output: { path: "notes/project.md", sizeBytes: 2048, content: "# Project\n" },
          },
        },
      ],
    };

    const messages = adaptChatMessages(
      [
        {
          id: `${snapshot.runId}:user`,
          sessionId: session.sessionId,
          runId: snapshot.runId,
          turnIndex: snapshot.turnIndex ?? 1,
          role: "user",
          content: snapshot.input.prompt,
          pattern: snapshot.pattern,
          modeId: snapshot.modeId,
          createdAt: snapshot.input.createdAt ?? snapshot.updatedAt,
        },
      ],
      { [snapshot.runId]: toolSnapshot },
    );

    const steps = messages.find((message) => message.role === "assistant")?.turn?.processSteps ?? [];
    expect(steps.map((step) => step.eventType)).toEqual(["tool.called"]);
    expect(steps.at(-1)?.label).toBe("读取文件");
    expect(steps.at(-1)?.detail).toBe("已读取 notes/project.md (2.0 KB).");
    expect(steps.at(-1)?.contextLabel).toBe("notes/project.md");
  });

  it("keeps streamed assistant text in the process view before finalization", async () => {
    const client = createRuntimeClient();
    const session = await client.createSession();
    const snapshot = await client.startRun(
      { prompt: "Render partial streamed text." },
      { modeId: "generator_verifier" },
      session.sessionId,
    );
    const partialSnapshot = {
      ...snapshot,
      status: "running" as const,
      output: undefined,
      events: [
        ...snapshot.events.filter((event) => event.type !== "message.delta" && event.type !== "run.done"),
        {
          id: `${snapshot.runId}:evt-stream`,
          runId: snapshot.runId,
          seq: snapshot.events.length,
          type: "message.delta" as const,
          createdAt: snapshot.updatedAt + 1,
          pattern: snapshot.pattern,
          payload: {
            role: "assistant",
            content: "Partial answer",
            delta: "answer",
            streaming: true,
          },
        },
      ],
    };

    const messages = adaptChatMessages(
      [
        {
          id: `${snapshot.runId}:user`,
          sessionId: session.sessionId,
          runId: snapshot.runId,
          turnIndex: snapshot.turnIndex ?? 1,
          role: "user",
          content: snapshot.input.prompt,
          pattern: snapshot.pattern,
          modeId: snapshot.modeId,
          createdAt: snapshot.input.createdAt ?? snapshot.updatedAt,
        },
      ],
      { [snapshot.runId]: partialSnapshot },
    );

    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("");
    expect(assistant?.isPlaceholder).toBe(true);
  });

  it("blocks in-flight todos after cancelling an approval-required run", async () => {
    const client = createRuntimeClient();
    const session = await client.createSession();
    const run = await client.startRun(
      { prompt: "Verify cancel collapses smoke todo state." },
      { modeId: "generator_verifier" },
      session.sessionId,
    );

    expect(run.status).toBe("interrupted");
    expect(run.todos.some((todo) => todo.status === "running")).toBe(true);

    const cancelled = await client.cancelRun(run.runId);
    const cancelledText = JSON.stringify(cancelled);
    const messages = adaptChatMessages(
      [
        {
          id: `${run.runId}:user`,
          sessionId: session.sessionId,
          runId: run.runId,
          turnIndex: run.turnIndex ?? 1,
          role: "user",
          content: run.input.prompt,
          pattern: run.pattern,
          modeId: run.modeId,
          createdAt: run.input.createdAt ?? run.updatedAt,
        },
      ],
      { [run.runId]: cancelled },
    );
    const assistant = messages.find((message) => message.role === "assistant");

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.error).toBe(USER_CANCELLED_MESSAGE);
    expect(cancelled.todos.some((todo) => todo.status === "running")).toBe(false);
    expect(cancelled.todos.every((todo) => todo.status === "done" || todo.status === "blocked")).toBe(true);
    expect(cancelled.pendingApprovals).toEqual([]);
    expect(cancelled.activeAgents).toEqual([]);
    expect(cancelled.actions.find((action) => action.status === "approval_required")).toBeUndefined();
    expect(cancelled.actions.find((action) => action.status === "running")).toBeUndefined();
    expect(cancelled.toolCalls.find((call) => call.status === "approval_required")).toBeUndefined();
    expect(cancelledText).toContain(USER_CANCELLED_MESSAGE);
    expect(cancelledText).not.toContain("Cancelled by caller.");
    expect(assistant?.content).toBe(USER_CANCELLED_MESSAGE);
    expect(cancelled.events.at(-1)?.type).toBe("run.cancelled");
  });

  it("persists browser fallback feedback-loop rule updates", async () => {
    const client = createRuntimeClient();
    const project = await client.createProject({ label: "Signals", rootPath: "/tmp/ora-signals" });
    const rules = await client.listFeedbackLoopRules({ projectId: project.projectId });
    const recoveryRule = rules.find((rule) => rule.id.endsWith(":rule:repeated_recovery_exhausted"));
    expect(recoveryRule?.enabled).toBe(true);

    await client.updateFeedbackLoopRule({ ...recoveryRule!, enabled: false });
    const nextRules = await client.listFeedbackLoopRules({ projectId: project.projectId });
    expect(nextRules.find((rule) => rule.id === recoveryRule!.id)?.enabled).toBe(false);
  });
});
