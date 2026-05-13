import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DYNAMIC_ORCHESTRATOR_MODE_ID, ORA_ROOT_AGENT_ID, StateSnapshotSchema } from "@cemeworm/shared";
import { LocalRunStore, createRuntimeMethodHandler } from "../src/index.js";
import { parseDelegationPlan, type DelegationPlan } from "../src/patterns/mode-driver-helpers.js";

function createTempStore() {
  return new LocalRunStore({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-dynamic-delegation-test-")),
  });
}

describe("parseDelegationPlan", () => {
  it("parses both subagents enabled with focus", () => {
    const input = `
<delegation_plan>
research: enabled
research_focus: Investigate auth middleware patterns
review: enabled
review_focus: Check for security gaps
</delegation_plan>`;
    const plan = parseDelegationPlan(input);
    expect(plan).not.toBeNull();
    expect(plan!.researchEnabled).toBe(true);
    expect(plan!.researchFocus).toBe("Investigate auth middleware patterns");
    expect(plan!.reviewEnabled).toBe(true);
    expect(plan!.reviewFocus).toBe("Check for security gaps");
  });

  it("parses both subagents disabled", () => {
    const plan = parseDelegationPlan("research: disabled\nreview: disabled");
    expect(plan).not.toBeNull();
    expect(plan!.researchEnabled).toBe(false);
    expect(plan!.reviewEnabled).toBe(false);
    expect(plan!.researchFocus).toBeUndefined();
    expect(plan!.reviewFocus).toBeUndefined();
  });

  it("parses research enabled, review disabled", () => {
    const plan = parseDelegationPlan("research: enabled\nresearch_focus: Look at X\nreview: disabled");
    expect(plan).not.toBeNull();
    expect(plan!.researchEnabled).toBe(true);
    expect(plan!.researchFocus).toBe("Look at X");
    expect(plan!.reviewEnabled).toBe(false);
  });

  it("returns null for malformed input", () => {
    expect(parseDelegationPlan("no delegation plan here")).toBeNull();
    expect(parseDelegationPlan("")).toBeNull();
    expect(parseDelegationPlan("research: maybe\nreview: enabled")).toBeNull();
  });

  it("handles case-insensitive enabled/disabled", () => {
    const plan = parseDelegationPlan("research: ENABLED\nreview: Disabled");
    expect(plan).not.toBeNull();
    expect(plan!.researchEnabled).toBe(true);
    expect(plan!.reviewEnabled).toBe(false);
  });
});

describe("dynamic_orchestrator mode preset", () => {
  it("lists and returns the Dynamic Orchestrator system preset", () => {
    const store = new LocalRunStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-dyn-orch-")) });
    const listed = store.listModes().find((mode) => mode.id === DYNAMIC_ORCHESTRATOR_MODE_ID);
    const fetched = store.getMode({ modeId: DYNAMIC_ORCHESTRATOR_MODE_ID });

    expect(listed).toBeDefined();
    expect(fetched.id).toBe(DYNAMIC_ORCHESTRATOR_MODE_ID);
    expect(fetched.systemPreset).toBe(true);
    expect(fetched.family).toBe("orchestrator_subagent");
    expect(fetched.runtimeAtoms).toContain("dynamic_delegation");
    expect(fetched.profiles.map((p) => p.id)).toEqual([ORA_ROOT_AGENT_ID, "researcher", "reviewer"]);
    expect(fetched.nodes.map((n) => n.id)).toEqual(["decompose", "research", "review", "synthesize"]);
  });

  it("has research and review nodes with subagent_delegate enabled", () => {
    const store = new LocalRunStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-dyn-orch-2-")) });
    const mode = store.getMode({ modeId: DYNAMIC_ORCHESTRATOR_MODE_ID });
    const research = mode.nodes.find((n) => n.id === "research");
    const review = mode.nodes.find((n) => n.id === "review");

    expect(research?.config?.atoms).toContain("subagent_delegate");
    expect(review?.config?.atoms).toContain("subagent_delegate");
  });

  it("is not read-only, allowing user customization", () => {
    const store = new LocalRunStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ora-dyn-orch-3-")) });
    const mode = store.getMode({ modeId: DYNAMIC_ORCHESTRATOR_MODE_ID });
    expect(mode.editorConstraints?.readOnly).toBe(false);
  });
});

describe("dynamic delegation integration", () => {
  it("completes a run with all nodes using local-smoke provider", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());

    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "What is 2+2?" },
        config: { modeId: DYNAMIC_ORCHESTRATOR_MODE_ID },
      },
    })) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(state.status).toBe("succeeded");

    // With local-smoke, decompose output won't contain a valid delegation plan,
    // so parseDelegationPlan returns null and all nodes execute by default.
    const planStatuses = state.plan?.map((p) => ({ id: p.id, status: p.status }));
    expect(planStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining("decompose"), status: "done" }),
        expect.objectContaining({ id: expect.stringContaining("research"), status: "done" }),
        expect.objectContaining({ id: expect.stringContaining("review"), status: "done" }),
        expect.objectContaining({ id: expect.stringContaining("synthesize"), status: "done" }),
      ]),
    );
  });

  it("emits agent.started for orchestrator, researcher, and reviewer", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());

    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Explain the delegation pattern." },
        config: { modeId: DYNAMIC_ORCHESTRATOR_MODE_ID },
      },
    })) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    const eventTypes = state.events.map((e) => e.type);
    expect(eventTypes).toContain("agent.started");
    expect(eventTypes).toContain("agent.completed");

    // Task lifecycle events from subagent_delegate
    expect(eventTypes).toContain("task.started");
    expect(eventTypes).toContain("task.completed");
  });

  it("includes subagent_delegate in topology for research and review nodes", async () => {
    const handle = createRuntimeMethodHandler(createTempStore());

    const run = (await handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runs.start",
      params: {
        input: { prompt: "Hello." },
        config: { modeId: DYNAMIC_ORCHESTRATOR_MODE_ID },
      },
    })) as { runId: string };

    const state = StateSnapshotSchema.parse(
      await handle({
        jsonrpc: "2.0",
        id: 2,
        method: "runs.state",
        params: { runId: run.runId },
      }),
    );

    expect(
      state.topology.nodes.some((n) =>
        n.kind === "capability"
        && n.metadata.atomId === "subagent_delegate"
        && n.metadata.sourceNodeId === "research",
      ),
    ).toBe(true);
    expect(
      state.topology.nodes.some((n) =>
        n.kind === "capability"
        && n.metadata.atomId === "subagent_delegate"
        && n.metadata.sourceNodeId === "review",
      ),
    ).toBe(true);
  });
});
