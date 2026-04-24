import { describe, expect, it } from "vitest";
import { createRuntimeClient } from "../../desktop/src/lib/runtimeClient";

describe("desktop browser-mock runtime lifecycle", () => {
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

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.todos.some((todo) => todo.status === "running")).toBe(false);
    expect(cancelled.todos.every((todo) => todo.status === "done" || todo.status === "blocked")).toBe(true);
    expect(cancelled.pendingApprovals).toEqual([]);
    expect(cancelled.activeAgents).toEqual([]);
    expect(cancelled.actions.find((action) => action.status === "approval_required")).toBeUndefined();
    expect(cancelled.events.at(-1)?.type).toBe("run.cancelled");
  });
});
