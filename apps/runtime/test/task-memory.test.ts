import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { TaskMemoryStore } from "../src/task-memory.js";
import type { TaskCanvas } from "@cemeworm/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("TaskMemoryStore", () => {
  let store: TaskMemoryStore;

  beforeEach(() => {
    store = new TaskMemoryStore();
  });

  // ── Evidence ────────────────────────────────────────────

  it("captures evidence and reads it back", () => {
    const ref = store.captureEvidence({
      runId: "run_1",
      sourceKind: "tool_output",
      sourceActionId: "action_5",
      summary: "npm install failed with EACCES",
      byteLength: 2400,
    });

    expect(ref.runId).toBe("run_1");
    expect(ref.sourceKind).toBe("tool_output");
    expect(ref.summary).toContain("EACCES");
    expect(ref.byteLength).toBe(2400);

    const evidence = store.getEvidence("run_1");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.id).toBe(ref.id);
  });

  it("captures evidence with minimal params", () => {
    const ref = store.captureEvidence({
      runId: "run_min",
      sourceKind: "error_log",
      summary: "Connection refused",
    });

    expect(ref.byteLength).toBe(0);
    expect(ref.sourceActionId).toBeUndefined();
    expect(store.evidenceCount("run_min")).toBe(1);
  });

  it("truncates evidence summary to 200 chars", () => {
    const longSummary = "x".repeat(300);
    const ref = store.captureEvidence({
      runId: "run_1",
      sourceKind: "search_result",
      summary: longSummary,
    });

    expect(ref.summary.length).toBeLessThanOrEqual(200);
  });

  it("caps evidence per run at 60", () => {
    for (let i = 0; i < 70; i++) {
      store.captureEvidence({
        runId: "run_cap",
        sourceKind: "tool_output",
        summary: `Result ${i}`,
      });
    }

    expect(store.evidenceCount("run_cap")).toBe(60);
    // Should keep the most recent
    const evidence = store.getEvidence("run_cap");
    expect(evidence[evidence.length - 1]?.summary).toBe("Result 69");
  });

  // ── Nodes ───────────────────────────────────────────────

  it("captures a node and reads it back", () => {
    const node = store.captureNode({
      runId: "run_1",
      kind: "tool_operation",
      label: "Install dependencies",
      status: "done",
      summary: "Ran npm install successfully",
    });

    expect(node.runId).toBe("run_1");
    expect(node.kind).toBe("tool_operation");
    expect(node.status).toBe("done");

    const nodes = store.getNodes("run_1");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.label).toBe("Install dependencies");
  });

  it("captures a node with default status pending", () => {
    const node = store.captureNode({
      runId: "run_1",
      kind: "subproblem",
      label: "Configure database",
    });

    expect(node.status).toBe("pending");
  });

  it("upserts node by id (same label = same id)", () => {
    store.captureNode({
      runId: "run_1",
      kind: "subproblem",
      label: "Setup",
      status: "pending",
    });

    store.captureNode({
      runId: "run_1",
      kind: "subproblem",
      label: "Setup",
      status: "done",
    });

    expect(store.nodeCount("run_1")).toBe(1);
    const nodes = store.getNodes("run_1");
    expect(nodes[0]?.status).toBe("done");
    expect(nodes[0]?.updatedAt).toBeDefined();
  });

  it("links evidence to nodes via evidenceRefIds", () => {
    const ref = store.captureEvidence({
      runId: "run_1",
      sourceKind: "error_log",
      summary: "DB connection failed",
    });

    const node = store.captureNode({
      runId: "run_1",
      kind: "failure_recovery",
      label: "Retry DB connection",
      evidenceRefIds: [ref.id],
    });

    expect(node.evidenceRefIds).toEqual([ref.id]);
  });

  it("supports parent-child node tree", () => {
    const parent = store.captureNode({
      runId: "run_1",
      kind: "subproblem",
      label: "Auth feature",
    });

    const child = store.captureNode({
      runId: "run_1",
      kind: "tool_operation",
      label: "Add JWT middleware",
      parentNodeId: parent.id,
    });

    expect(child.parentNodeId).toBe(parent.id);
  });

  it("updates node status", () => {
    const node = store.captureNode({
      runId: "run_1",
      kind: "decision",
      label: "Choose DB",
      status: "pending",
    });

    const updated = store.updateNodeStatus("run_1", node.id, "done");
    expect(updated?.status).toBe("done");
    expect(updated?.updatedAt).toBeDefined();

    const nodes = store.getNodes("run_1");
    expect(nodes[0]?.status).toBe("done");
  });

  it("updateNodeStatus returns undefined for missing run/node", () => {
    expect(store.updateNodeStatus("nonexistent", "n1", "done")).toBeUndefined();

    store.captureNode({ runId: "run_1", kind: "subproblem", label: "Test" });
    expect(store.updateNodeStatus("run_1", "nonexistent", "done")).toBeUndefined();
  });

  it("caps nodes per run at 40", () => {
    for (let i = 0; i < 50; i++) {
      store.captureNode({
        runId: "run_cap",
        kind: "tool_operation",
        label: `Operation ${i}`,
      });
    }

    expect(store.nodeCount("run_cap")).toBe(40);
  });

  // ── Canvas ──────────────────────────────────────────────

  it("builds canvas from nodes and evidence", () => {
    store.captureEvidence({
      runId: "run_1",
      sourceKind: "tool_output",
      summary: "Test output",
    });

    store.captureNode({
      runId: "run_1",
      kind: "subproblem",
      label: "Main task",
      status: "done",
    });

    const canvas = store.buildCanvas("run_1", "session_1");
    expect(canvas.runId).toBe("run_1");
    expect(canvas.sessionId).toBe("session_1");
    expect(canvas.nodes).toHaveLength(1);
    expect(canvas.evidenceRefs).toHaveLength(1);
    expect(canvas.generatedAt).toBeTruthy();
    expect(canvas.summary).toContain("1 nodes");
  });

  it("buildCanvas returns empty canvas for unknown run", () => {
    const canvas = store.buildCanvas("unknown");
    expect(canvas.runId).toBe("unknown");
    expect(canvas.nodes).toHaveLength(0);
    expect(canvas.evidenceRefs).toHaveLength(0);
  });

  it("renders canvas as structured markdown", () => {
    store.captureEvidence({
      runId: "run_1",
      sourceKind: "error_log",
      summary: "Port 5432 in use",
      byteLength: 512,
    });

    store.captureNode({
      runId: "run_1",
      kind: "subproblem",
      label: "Start database",
      status: "failed",
      summary: "PostgreSQL port conflict",
    });

    store.captureNode({
      runId: "run_1",
      kind: "tool_operation",
      label: "Check port usage",
      status: "done",
    });

    const canvas = store.buildCanvas("run_1");
    const render = store.renderCanvas(canvas);

    expect(render.renderedPrompt).toContain("<ora_task_memory>");
    expect(render.renderedPrompt).toContain("</ora_task_memory>");
    expect(render.renderedPrompt).toContain("## Failed / Blocked");
    expect(render.renderedPrompt).toContain("Start database");
    expect(render.renderedPrompt).toContain("## Done");
    expect(render.renderedPrompt).toContain("Check port usage");
    expect(render.renderedPrompt).toContain("## Key Evidence");
    expect(render.renderedPrompt).toContain("Port 5432");
    expect(render.renderedPrompt).toContain("0.5KB");
    expect(render.renderedChars).toBeGreaterThan(0);
  });

  it("renderCanvas caps at maxChars", () => {
    // Add many nodes to create a large canvas
    for (let i = 0; i < 20; i++) {
      store.captureNode({
        runId: "run_1",
        kind: "tool_operation",
        label: `Operation with long label number ${i}`,
        summary: "Some detailed summary text that adds characters",
        status: "done",
      });
    }

    const canvas = store.buildCanvas("run_1");
    const render = store.renderCanvas(canvas, 400);
    expect(render.renderedChars).toBeLessThanOrEqual(403); // maxChars + "..."
  });

  it("renders nodes grouped by status in correct order", () => {
    store.captureNode({ runId: "r1", kind: "tool_operation", label: "Done task", status: "done" });
    store.captureNode({ runId: "r1", kind: "tool_operation", label: "Failed task", status: "failed" });
    store.captureNode({ runId: "r1", kind: "tool_operation", label: "Active task", status: "in_progress" });
    store.captureNode({ runId: "r1", kind: "tool_operation", label: "Waiting task", status: "pending" });

    const canvas = store.buildCanvas("r1");
    const render = store.renderCanvas(canvas);

    const inProgressIdx = render.renderedPrompt.indexOf("## In Progress");
    const failedIdx = render.renderedPrompt.indexOf("## Failed / Blocked");
    const pendingIdx = render.renderedPrompt.indexOf("## Pending");
    const doneIdx = render.renderedPrompt.indexOf("## Done");

    expect(inProgressIdx).toBeLessThan(failedIdx);
    expect(failedIdx).toBeLessThan(pendingIdx);
    expect(pendingIdx).toBeLessThan(doneIdx);
  });

  it("renderOverlay returns empty string for empty run", () => {
    const overlay = store.renderOverlay("nonexistent");
    expect(overlay).toBe("");
  });

  it("renderOverlay returns rendered prompt when data exists", () => {
    store.captureEvidence({
      runId: "run_1",
      sourceKind: "tool_output",
      summary: "Build completed",
    });
    store.captureNode({
      runId: "run_1",
      kind: "tool_operation",
      label: "Run build",
      status: "done",
    });

    const overlay = store.renderOverlay("run_1");
    expect(overlay).toContain("<ora_task_memory>");
    expect(overlay).toContain("Run build");
    expect(overlay).toContain("Build completed");
  });

  // ── Run lifecycle ───────────────────────────────────────

  it("activeRunIds returns runs with data", () => {
    store.captureEvidence({ runId: "run_a", sourceKind: "tool_output", summary: "A" });
    store.captureNode({ runId: "run_b", kind: "subproblem", label: "B" });

    const ids = store.activeRunIds();
    expect(ids).toContain("run_a");
    expect(ids).toContain("run_b");
  });

  it("discards run data", () => {
    store.captureEvidence({ runId: "run_1", sourceKind: "tool_output", summary: "Data" });
    store.captureNode({ runId: "run_1", kind: "subproblem", label: "Node" });

    expect(store.evidenceCount("run_1")).toBe(1);
    expect(store.nodeCount("run_1")).toBe(1);

    store.discardRun("run_1");

    expect(store.evidenceCount("run_1")).toBe(0);
    expect(store.nodeCount("run_1")).toBe(0);
    expect(store.activeRunIds()).not.toContain("run_1");
  });

  it("discardRun is idempotent", () => {
    expect(() => store.discardRun("nonexistent")).not.toThrow();
  });

  // ── Persistence ─────────────────────────────────────────

  describe("with persistence", () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "ora-task-memory-test-"));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("persists evidence and nodes to JSONL", () => {
      const pStore = new TaskMemoryStore(dir);

      pStore.captureEvidence({
        runId: "run_p",
        sourceKind: "tool_output",
        summary: "Persisted evidence",
      });

      pStore.captureNode({
        runId: "run_p",
        kind: "subproblem",
        label: "Persisted node",
      });

      // New store from same dir should load persisted data synchronously
      const pStore2 = new TaskMemoryStore(dir);

      const evidence = pStore2.getEvidence("run_p");
      expect(evidence.length).toBe(1);
      expect(evidence[0]?.summary).toContain("Persisted evidence");

      const nodes = pStore2.getNodes("run_p");
      expect(nodes.length).toBe(1);
      expect(nodes[0]?.label).toBe("Persisted node");
    });

    it("discardRun removes persisted file", () => {
      const pStore = new TaskMemoryStore(dir);

      pStore.captureEvidence({
        runId: "run_del",
        sourceKind: "tool_output",
        summary: "To be deleted",
      });

      const filePath = path.join(dir, "task-memory", "run_del.jsonl");
      expect(fs.existsSync(filePath)).toBe(true);

      pStore.discardRun("run_del");
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });
});
