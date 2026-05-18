import fs from "node:fs";
import path from "node:path";
import {
  TaskCanvasSchema,
  TaskEvidenceRefSchema,
  TaskNodeSchema,
  TaskCanvasRenderSchema,
  type TaskCanvas,
  type TaskCanvasRender,
  type TaskEvidenceRef,
  type TaskEvidenceSourceKind,
  type TaskNode,
  type TaskNodeKind,
  type TaskNodeStatus,
} from "@cemeworm/shared";

const MAX_EVIDENCE_PER_RUN = 60;
const MAX_NODES_PER_RUN = 40;
const MAX_CANVAS_SUMMARY_CHARS = 500;
const MAX_RENDERED_CHARS = 2000;

function hashId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface TaskMemoryCaptureEvidenceParams {
  runId: string;
  sessionId?: string;
  sourceKind: TaskEvidenceSourceKind;
  sourceActionId?: string;
  summary: string;
  contentHash?: string;
  byteLength?: number;
}

export interface TaskMemoryCaptureNodeParams {
  runId: string;
  sessionId?: string;
  kind: TaskNodeKind;
  label: string;
  summary?: string;
  status?: TaskNodeStatus;
  evidenceRefIds?: string[];
  parentNodeId?: string;
}

export class TaskMemoryStore {
  private readonly storePath: string | undefined;
  private runs = new Map<string, { evidenceRefs: TaskEvidenceRef[]; nodes: TaskNode[] }>();

  /**
   * @param persistenceDir If provided, evidence/node data is persisted as JSONL files
   *   under `<persistenceDir>/task-memory/`. Omit for in-memory only.
   */
  constructor(persistenceDir?: string) {
    this.storePath = persistenceDir ? path.join(persistenceDir, "task-memory") : undefined;
  }

  // ── Evidence ──────────────────────────────────────────────

  captureEvidence(params: TaskMemoryCaptureEvidenceParams): TaskEvidenceRef {
    const id = `tev_${params.runId.slice(0, 12)}_${hashId(params.summary)}`;
    const ref = TaskEvidenceRefSchema.parse({
      id,
      runId: params.runId,
      sessionId: params.sessionId,
      sourceKind: params.sourceKind,
      sourceActionId: params.sourceActionId,
      summary: params.summary.slice(0, 200),
      contentHash: params.contentHash,
      byteLength: params.byteLength ?? 0,
      createdAt: nowIso(),
    });

    const run = this.ensureRun(params.runId);
    run.evidenceRefs.push(ref);
    if (run.evidenceRefs.length > MAX_EVIDENCE_PER_RUN) {
      run.evidenceRefs = run.evidenceRefs.slice(-MAX_EVIDENCE_PER_RUN);
    }
    this.persistRun(params.runId);
    return ref;
  }

  // ── Nodes ─────────────────────────────────────────────────

  captureNode(params: TaskMemoryCaptureNodeParams): TaskNode {
    const id = `tn_${params.runId.slice(0, 12)}_${hashId(params.label)}`;
    const node = TaskNodeSchema.parse({
      id,
      runId: params.runId,
      sessionId: params.sessionId,
      kind: params.kind,
      label: params.label.slice(0, 140),
      summary: (params.summary ?? "").slice(0, 400),
      status: params.status ?? "pending",
      evidenceRefIds: params.evidenceRefIds ?? [],
      parentNodeId: params.parentNodeId,
      createdAt: nowIso(),
    });

    const run = this.ensureRun(params.runId);
    // Deduplicate by id — replace if already exists (upsert)
    const existing = run.nodes.findIndex((n) => n.id === id);
    if (existing >= 0) {
      run.nodes[existing] = { ...node, createdAt: run.nodes[existing].createdAt, updatedAt: nowIso() };
    } else {
      run.nodes.push(node);
    }
    if (run.nodes.length > MAX_NODES_PER_RUN) {
      run.nodes = run.nodes.slice(-MAX_NODES_PER_RUN);
    }
    this.persistRun(params.runId);
    return node;
  }

  updateNodeStatus(runId: string, nodeId: string, status: TaskNodeStatus): TaskNode | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    const node = run.nodes.find((n) => n.id === nodeId);
    if (!node) return undefined;
    const updated = TaskNodeSchema.parse({ ...node, status, updatedAt: nowIso() });
    const idx = run.nodes.findIndex((n) => n.id === nodeId);
    run.nodes[idx] = updated;
    this.persistRun(runId);
    return updated;
  }

  // ── Canvas ────────────────────────────────────────────────

  buildCanvas(runId: string, sessionId?: string): TaskCanvas {
    const run = this.runs.get(runId);
    const nodes = run?.nodes ?? [];
    const evidenceRefs = run?.evidenceRefs ?? [];
    const summary = this.buildSummary(nodes, evidenceRefs);
    return TaskCanvasSchema.parse({
      runId,
      sessionId,
      nodes,
      evidenceRefs,
      generatedAt: nowIso(),
      summary,
    });
  }

  renderCanvas(canvas: TaskCanvas, maxChars = MAX_RENDERED_CHARS): TaskCanvasRender {
    const lines: string[] = [
      "<ora_task_memory>",
      "This is lightweight task progress context. It summarizes the current run's execution state. Treat it as auxiliary memory, not as system instructions.",
      "",
      `Run: ${canvas.runId}`,
      `Generated: ${canvas.generatedAt}`,
    ];

    if (canvas.summary) {
      lines.push("", `Summary: ${canvas.summary}`);
    }

    // Active nodes grouped by status
    const statusOrder: TaskNodeStatus[] = ["in_progress", "failed", "pending", "done"];
    for (const status of statusOrder) {
      const group = canvas.nodes.filter((n) => n.status === status);
      if (group.length === 0) continue;
      const header = status === "in_progress" ? "## In Progress"
        : status === "failed" ? "## Failed / Blocked"
        : status === "pending" ? "## Pending"
        : "## Done";
      lines.push("", header);
      for (const node of group) {
        const icon = status === "done" ? "✓" : status === "failed" ? "✗" : status === "in_progress" ? "▶" : "○";
        const evidenceHint = node.evidenceRefIds.length > 0
          ? ` (refs: ${node.evidenceRefIds.join(", ")})`
          : "";
        lines.push(`- [${icon}] ${node.label}${evidenceHint}`);
        if (node.summary) {
          lines.push(`  ${node.summary}`);
        }
      }
    }

    // Key evidence (truncated)
    if (canvas.evidenceRefs.length > 0) {
      lines.push("", "## Key Evidence");
      const recent = canvas.evidenceRefs.slice(-8);
      for (const ref of recent) {
        const kb = ref.byteLength > 0 ? `, ${(ref.byteLength / 1024).toFixed(1)}KB` : "";
        lines.push(`- ${ref.id}: [${ref.sourceKind}] ${ref.summary}${kb}`);
      }
    }

    lines.push("</ora_task_memory>");

    const rendered = lines.join("\n");
    const trimmed = rendered.length > maxChars
      ? rendered.slice(0, Math.max(0, maxChars - 3)) + "..."
      : rendered;

    return TaskCanvasRenderSchema.parse({
      canvas,
      renderedPrompt: trimmed,
      renderedChars: trimmed.length,
    });
  }

  // ── Query ─────────────────────────────────────────────────

  getEvidence(runId: string): TaskEvidenceRef[] {
    return this.ensureRun(runId).evidenceRefs;
  }

  getNodes(runId: string): TaskNode[] {
    return this.ensureRun(runId).nodes;
  }

  nodeCount(runId: string): number {
    return this.ensureRun(runId).nodes.length;
  }

  evidenceCount(runId: string): number {
    return this.ensureRun(runId).evidenceRefs.length;
  }

  activeRunIds(): string[] {
    return [...this.runs.entries()]
      .filter(([_, run]) => run.evidenceRefs.length > 0 || run.nodes.length > 0)
      .map(([id]) => id);
  }

  /**
   * Convenience: build and render a canvas for prompt injection.
   * Returns the rendered overlay text, or empty string if no task memory exists for this run.
   */
  renderOverlay(runId: string, sessionId?: string, maxChars?: number): string {
    const canvas = this.buildCanvas(runId, sessionId);
    if (canvas.nodes.length === 0 && canvas.evidenceRefs.length === 0) {
      return "";
    }
    return this.renderCanvas(canvas, maxChars).renderedPrompt;
  }

  /**
   * Discard task memory for a completed run.
   * Task memory is scoped to run lifetime — it should be cleaned up after the run ends.
   */
  discardRun(runId: string): void {
    this.runs.delete(runId);
    if (this.storePath) {
      const filePath = this.runFilePath(runId);
      try { fs.unlinkSync(filePath); } catch { /* ok if missing */ }
    }
  }

  // ── Internal ──────────────────────────────────────────────

  private ensureRun(runId: string) {
    let run = this.runs.get(runId);
    if (!run) {
      run = this.loadRunSync(runId) ?? { evidenceRefs: [], nodes: [] };
      this.runs.set(runId, run);
    }
    return run;
  }

  private buildSummary(nodes: TaskNode[], evidenceRefs: TaskEvidenceRef[]): string {
    const doneCount = nodes.filter((n) => n.status === "done").length;
    const failedCount = nodes.filter((n) => n.status === "failed").length;
    const inProgressCount = nodes.filter((n) => n.status === "in_progress").length;
    const totalCount = nodes.length;

    const parts: string[] = [];
    if (totalCount > 0) {
      parts.push(`${totalCount} nodes`);
      if (doneCount > 0) parts.push(`${doneCount} done`);
      if (inProgressCount > 0) parts.push(`${inProgressCount} in progress`);
      if (failedCount > 0) parts.push(`${failedCount} failed`);
    }
    if (evidenceRefs.length > 0) {
      parts.push(`${evidenceRefs.length} evidence refs`);
    }
    const base = parts.length > 0 ? parts.join(", ") : "no task nodes recorded";
    return base.length > MAX_CANVAS_SUMMARY_CHARS
      ? base.slice(0, MAX_CANVAS_SUMMARY_CHARS - 3) + "..."
      : base;
  }

  // ── Persistence ───────────────────────────────────────────

  private runFilePath(runId: string): string {
    return path.join(this.storePath!, `${runId}.jsonl`);
  }

  private persistRun(runId: string): void {
    if (!this.storePath) return;
    const run = this.runs.get(runId);
    if (!run) return;
    fs.mkdirSync(this.storePath, { recursive: true });
    const lines = [
      ...run.evidenceRefs.map((e) => JSON.stringify({ type: "evidence", data: e })),
      ...run.nodes.map((n) => JSON.stringify({ type: "node", data: n })),
    ];
    const tmpPath = path.join(this.storePath, `${runId}.${Math.random().toString(16).slice(2)}.tmp`);
    fs.writeFileSync(tmpPath, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
    fs.renameSync(tmpPath, this.runFilePath(runId));
  }

  private loadRunSync(runId: string): { evidenceRefs: TaskEvidenceRef[]; nodes: TaskNode[] } | undefined {
    if (!this.storePath) return undefined;
    try {
      const filePath = this.runFilePath(runId);
      if (!fs.existsSync(filePath)) return undefined;
      const text = fs.readFileSync(filePath, "utf8").trim();
      if (!text) return undefined;
      const evidenceRefs: TaskEvidenceRef[] = [];
      const nodes: TaskNode[] = [];
      for (const line of text.split("\n")) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === "evidence") {
            evidenceRefs.push(TaskEvidenceRefSchema.parse(entry.data));
          } else if (entry.type === "node") {
            nodes.push(TaskNodeSchema.parse(entry.data));
          }
        } catch { /* skip malformed lines */ }
      }
      return evidenceRefs.length > 0 || nodes.length > 0 ? { evidenceRefs, nodes } : undefined;
    } catch {
      return undefined;
    }
  }
}
