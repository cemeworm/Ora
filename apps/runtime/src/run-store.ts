import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ArtifactRef,
  ArtifactRefSchema,
  CheckpointMeta,
  CoordinationPattern,
  DEFAULT_RESOURCE_BUDGETS,
  getPatternDefinition,
  MVP_PATTERNS,
  OraEventEnvelope,
  OraEventEnvelopeSchema,
  PatternDefinition,
  PolicyDecision,
  RunConfig,
  RunConfigSchema,
  RunEventStream,
  RunEventStreamSchema,
  RunForkParamsSchema,
  RunReplayParamsSchema,
  RunHandle,
  RunHandleSchema,
  RunResumeParamsSchema,
  RunStreamParamsSchema,
  RunSummary,
  RunSummarySchema,
  RunsListParamsSchema,
  StateSnapshot,
  StateSnapshotSchema,
  UserTaskInput,
  UserTaskInputSchema
} from "@ora/shared";
import {
  ActionLedger,
  AgentProfileRegistry,
  MemoryService,
  PlanService,
  PolicyService
} from "./capabilities.js";
import { SqliteRuntimePersistence } from "./persistence/sqlite-backend.js";
import type { RuntimePersistenceBackend } from "./persistence/sqlite-backend.js";
import { recordLangfuseSnapshotTrace } from "./telemetry/langfuse.js";

const StartRunParamsSchema = z.object({
  input: UserTaskInputSchema,
  config: RunConfigSchema.partial().optional()
});

const RunIdParamsSchema = z.object({
  runId: z.string().min(1)
});

const InterruptParamsSchema = RunIdParamsSchema.extend({
  reason: z.string().optional()
});

const StoreManifestSchema = z.object({
  schemaVersion: z.literal(1),
  nextRunNumber: z.number().int().positive()
});

type StoreManifest = z.infer<typeof StoreManifestSchema>;
type StoredRun = StateSnapshot;

export interface LocalRunStoreOptions {
  dataDir?: string;
  clock?: () => number;
}

interface PersistedArtifact {
  ref: ArtifactRef;
  payload: unknown;
}

// RuntimePersistenceBackend is imported from ./persistence/sqlite-backend.js

export class OraRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code = -32000,
    public readonly data?: unknown
  ) {
    super(message);
  }
}

class JsonFileRuntimePersistenceBackend implements RuntimePersistenceBackend {
  private readonly manifestPath: string;
  private readonly runsDir: string;
  private readonly artifactsDir: string;

  constructor(private readonly dataDir: string) {
    this.manifestPath = path.join(dataDir, "manifest.json");
    this.runsDir = path.join(dataDir, "runs");
    this.artifactsDir = path.join(dataDir, "artifacts");
  }

  load(): { manifest: StoreManifest; runs: StoredRun[] } {
    this.ensureDirs();

    const manifest = this.readJsonFile(this.manifestPath, StoreManifestSchema, StoreManifestSchema.parse({
      schemaVersion: 1,
      nextRunNumber: 1
    }));
    const runs: StoredRun[] = fs
      .readdirSync(this.runsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJsonFile(path.join(this.runsDir, name), StateSnapshotSchema))
      .sort((a, b) => a.runId.localeCompare(b.runId));

    return {
      manifest: {
        ...manifest,
        nextRunNumber: Math.max(manifest.nextRunNumber, this.nextRunNumberAfter(runs))
      },
      runs
    };
  }

  saveManifest(manifest: StoreManifest): void {
    this.ensureDirs();
    this.writeJsonFile(this.manifestPath, StoreManifestSchema.parse(manifest));
  }

  saveRun(run: StoredRun): void {
    this.ensureDirs();
    this.writeJsonFile(path.join(this.runsDir, `${this.fileSafeId(run.runId)}.json`), run);
  }

  saveArtifact(artifact: PersistedArtifact): ArtifactRef {
    this.ensureDirs();
    const runArtifactsDir = path.join(this.artifactsDir, this.fileSafeId(artifact.ref.runId));
    fs.mkdirSync(runArtifactsDir, { recursive: true });
    const artifactPath = path.join(runArtifactsDir, `${this.fileSafeId(artifact.ref.id)}.json`);
    const payloadText = `${JSON.stringify(artifact.payload, null, 2)}\n`;
    this.writeTextFile(artifactPath, payloadText);

    return ArtifactRefSchema.parse({
      ...artifact.ref,
      uri: pathToFileURL(artifactPath).href,
      sizeBytes: Buffer.byteLength(payloadText)
    });
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.mkdirSync(this.artifactsDir, { recursive: true });
  }

  private readJsonFile<T>(
    filePath: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    fallback?: T
  ): T {
    if (!fs.existsSync(filePath)) {
      if (fallback !== undefined) {
        return fallback;
      }
      throw new OraRuntimeError(`Persisted runtime file is missing: ${filePath}`, -32005, {
        filePath
      });
    }

    try {
      return schema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (error) {
      throw new OraRuntimeError(`Persisted runtime file is invalid: ${filePath}`, -32006, {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private writeJsonFile(filePath: string, value: unknown): void {
    this.writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  private writeTextFile(filePath: string, value: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, value, "utf8");
    fs.renameSync(tmpPath, filePath);
  }

  private nextRunNumberAfter(runs: StoredRun[]): number {
    return (
      runs.reduce((max, run) => {
        const match = /^run-(\d+)$/.exec(run.runId);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1
    );
  }

  private fileSafeId(id: string): string {
    return encodeURIComponent(id);
  }
}

export class LocalRunStore {
  private readonly backend: RuntimePersistenceBackend;
  private readonly clock: () => number;
  private readonly persistenceType: "sqlite" | "json-file";
  private runs = new Map<string, StoredRun>();
  private manifest: StoreManifest;

  constructor(options: LocalRunStoreOptions = {}) {
    this.clock = options.clock ?? Date.now;
    const dataDir = options.dataDir ?? process.env.ORA_RUNTIME_STORE_DIR ?? path.join(process.cwd(), ".ora", "runtime.db");

    if (dataDir.endsWith(".db")) {
      this.persistenceType = "sqlite";
      this.backend = new SqliteRuntimePersistence(dataDir);
    } else {
      this.persistenceType = "json-file";
      this.backend = new JsonFileRuntimePersistenceBackend(dataDir);
    }
    const loaded = this.backend.load();
    this.manifest = loaded.manifest;
    this.runs = new Map(loaded.runs.map((run) => [run.runId, run]));
    this.backend.saveManifest(this.manifest);
  }

  health() {
    return {
      ok: true,
      service: "ora-runtime",
      version: "0.1.0",
      deterministic: true,
      persistence: this.persistenceType
    };
  }

  listPatterns(): PatternDefinition[] {
    return MVP_PATTERNS;
  }

  listRuns(params: unknown = {}): RunSummary[] {
    const parsed = RunsListParamsSchema.parse(params ?? {});
    return [...this.runs.values()]
      .filter((run) => (parsed.status ? run.status === parsed.status : true))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.runId.localeCompare(b.runId))
      .slice(0, parsed.limit)
      .map((run) => this.toRunSummary(run));
  }

  startRun(params: unknown): RunHandle {
    const parsed = StartRunParamsSchema.parse(params);
    const run = this.createCompletedRun({
      input: parsed.input,
      config: parsed.config
    });
    recordLangfuseSnapshotTrace(run);
    this.persistRun(run);
    return this.toRunHandle(run);
  }

  async startRunWithSnapshot(
    params: unknown,
    createSnapshot: (
      runId: string,
      input: UserTaskInput,
      config: RunConfig
    ) => Promise<StateSnapshot | undefined>
  ): Promise<RunHandle | undefined> {
    const parsed = StartRunParamsSchema.parse(params);
    const config = RunConfigSchema.parse(parsed.config ?? {});
    const input = UserTaskInputSchema.parse({
      ...parsed.input,
      createdAt: parsed.input.createdAt ?? this.now()
    });
    const fullConfig = RunConfigSchema.parse({
      ...config,
      budget: config.budget ?? DEFAULT_RESOURCE_BUDGETS[config.pattern]
    });
    const runId = this.nextRunId();
    const snapshot = await createSnapshot(runId, input, fullConfig);
    if (!snapshot) {
      return undefined;
    }

    this.persistRun(StateSnapshotSchema.parse(snapshot));
    return this.toRunHandle(snapshot);
  }

  streamRun(params: unknown): RunEventStream {
    const parsed = RunStreamParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    const fromSeq = parsed.afterSeq === undefined ? 0 : parsed.afterSeq + 1;
    return RunEventStreamSchema.parse({
      runId: snapshot.runId,
      fromSeq,
      events: snapshot.events.filter((event) => event.seq >= fromSeq).sort((a, b) => a.seq - b.seq),
      nextSeq: snapshot.events.length
    });
  }

  interruptRun(params: unknown): StateSnapshot {
    const parsed = InterruptParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    return this.transitionRun(snapshot, "interrupted", "run.interrupted", {
      reason: parsed.reason ?? "Interrupted by caller."
    });
  }

  resumeRun(params: unknown): StateSnapshot {
    const parsed = RunResumeParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    let working = this.appendEvent(snapshot, "run.resumed", {
      reason: parsed.reason ?? "Resumed by caller.",
      patch: parsed.patch ?? {}
    });

    const pendingApprovalActions = working.actions.filter((action) => action.status === "approval_required");
    for (const action of pendingApprovalActions) {
      working = this.appendEvent(working, "approval.resolved", {
        actionId: action.id,
        decision: "approved",
        mode: "resume"
      });

      const approved = { ...action, status: "approved" as const };
      working = this.appendEvent(
        { ...working, actions: working.actions.map((item) => (item.id === action.id ? approved : item)) },
        "action.updated",
        { actionId: action.id, status: "approved", record: approved }
      );

      const running = { ...approved, status: "running" as const };
      working = this.appendEvent(
        { ...working, actions: working.actions.map((item) => (item.id === action.id ? running : item)) },
        "action.updated",
        { actionId: action.id, status: "running", record: running }
      );

      const output = this.patternOutput(working.pattern, working.input.prompt);
      const memory = {
        id: `${working.runId}:memory:resumed-pattern-state`,
        namespace: this.patternMemoryNamespace(working.pattern, working.input.projectId),
        kind: working.pattern === "agent_teams" ? "worker" as const : "session" as const,
        value: output.state,
        sourceRunId: working.runId,
        sourceActionId: action.id,
        createdAt: this.now(),
        updatedAt: this.now()
      };
      working = this.appendEvent(
        { ...working, memory: [...working.memory, memory] },
        "memory.updated",
        { record: memory }
      );

      const succeeded = {
        ...running,
        status: "succeeded" as const,
        output: output.state
      };
      working = this.appendEvent(
        {
          ...working,
          actions: working.actions.map((item) => (item.id === action.id ? succeeded : item)),
          output: output.state
        },
        "action.updated",
        { actionId: action.id, status: "succeeded", record: succeeded }
      );
    }

    const checkpoint: CheckpointMeta = {
      id: `${working.runId}:checkpoint-${working.checkpoints.length}`,
      runId: working.runId,
      label: "Resume checkpoint",
      createdAt: this.now(),
      eventSeq: working.events.length,
      stateHash: `${working.pattern}:resume:${working.events.length}`
    };
    working = this.appendEvent(
      {
        ...working,
        checkpoints: [...working.checkpoints, checkpoint],
        plan: working.plan.map((item) => ({
          ...item,
          status: "done",
          checkpointIds: [...new Set([...item.checkpointIds, checkpoint.id])]
        }))
      },
      "checkpoint.created",
      {
        checkpoint,
        summary: "Checkpoint captured after approval resume."
      },
      { checkpointId: checkpoint.id }
    );

    const completed = this.appendEvent(
      {
        ...working,
        status: "running",
        topology: this.withTopologyStatus(working, "running")
      },
      "run.done",
      {
        status: "succeeded",
        summary: "Deterministic MVP run resumed after approval and completed."
      }
    );
    const updated = StateSnapshotSchema.parse({
      ...completed,
      status: "succeeded",
      topology: this.withTopologyStatus(completed, "done"),
      plan: completed.plan.map((item) => ({ ...item, status: "done" })),
      updatedAt: completed.updatedAt
    });
    this.persistRun(updated);
    return updated;
  }

  cancelRun(params: unknown): StateSnapshot {
    const runId = this.requireRunId(params);
    const snapshot = this.getRunOrThrow(runId);
    return this.transitionRun(snapshot, "cancelled", "run.cancelled", {
      reason: "Cancelled by caller."
    });
  }

  getRunState(params: unknown): StateSnapshot {
    return this.getRunOrThrow(this.requireRunId(params));
  }

  listCheckpoints(params: unknown): CheckpointMeta[] {
    return this.getRunOrThrow(this.requireRunId(params)).checkpoints;
  }

  replayRun(params: unknown): RunEventStream {
    const parsed = RunReplayParamsSchema.parse(params);
    const snapshot = this.getRunOrThrow(parsed.runId);
    const checkpoint = parsed.checkpointId
      ? snapshot.checkpoints.find((candidate) => candidate.id === parsed.checkpointId)
      : snapshot.checkpoints.at(-1);

    if (!checkpoint) {
      throw new OraRuntimeError("Checkpoint not found for replay.", -32004, {
        runId: parsed.runId,
        checkpointId: parsed.checkpointId
      });
    }

    const replayableEvents = snapshot.events
      .filter((event) => event.seq <= checkpoint.eventSeq)
      .sort((a, b) => a.seq - b.seq);
    const replayed = this.appendEvent(snapshot, "run.replayed", {
      checkpointId: checkpoint.id,
      replayedEventCount: replayableEvents.length,
      events: replayableEvents
    });
    this.persistRun(replayed);

    return RunEventStreamSchema.parse({
      runId: snapshot.runId,
      fromSeq: 0,
      events: replayableEvents,
      nextSeq: replayed.events.length
    });
  }

  forkRun(params: unknown): RunHandle {
    const parsed = RunForkParamsSchema.parse(params);
    const source = this.getRunOrThrow(parsed.runId);
    const checkpoint = source.checkpoints.find((candidate) => candidate.id === parsed.checkpointId);
    if (!checkpoint) {
      throw new OraRuntimeError(`Checkpoint not found: ${parsed.checkpointId}`, -32004, {
        runId: parsed.runId,
        checkpointId: parsed.checkpointId
      });
    }

    const fork = this.createCompletedRun({
      input: {
        ...source.input,
        ...parsed.input,
        context: {
          ...source.input.context,
          ...(parsed.input?.context ?? {}),
          forkedFrom: {
            runId: source.runId,
            checkpointId: checkpoint.id,
            eventSeq: checkpoint.eventSeq
          }
        },
        createdAt: undefined
      },
      config: {
        ...source.config,
        ...parsed.config,
        metadata: {
          ...source.config.metadata,
          ...(parsed.config?.metadata ?? {}),
          forkedFromRunId: source.runId,
          forkedFromCheckpointId: checkpoint.id
        }
      },
      forkedFrom: {
        runId: source.runId,
        checkpointId: checkpoint.id,
        eventSeq: checkpoint.eventSeq
      }
    });
    this.persistRun(fork);
    return this.toRunHandle(fork);
  }

  exportReport(params: unknown): ArtifactRef {
    const snapshot = this.getRunOrThrow(this.requireRunId(params));
    const reportIndex = snapshot.artifacts.filter((artifact) => artifact.kind === "report").length;
    const payload = {
      runId: snapshot.runId,
      status: snapshot.status,
      pattern: snapshot.pattern,
      eventCount: snapshot.events.length,
      checkpointCount: snapshot.checkpoints.length,
      output: snapshot.output
    };
    const persistedRef = this.backend.saveArtifact({
      ref: ArtifactRefSchema.parse({
        id: `${snapshot.runId}:report-${reportIndex}`,
        runId: snapshot.runId,
        kind: "report",
        label: reportIndex === 0 ? "Smoke run report" : `Smoke run report ${reportIndex + 1}`,
        mimeType: "application/json",
        createdAt: this.now(),
        payload
      }),
      payload
    });
    const updated = this.appendEvent(
      {
        ...snapshot,
        artifacts: [...snapshot.artifacts, persistedRef]
      },
      "artifact.exported",
      {
        artifact: persistedRef
      }
    );
    this.persistRun(updated);
    return persistedRef;
  }

  private createCompletedRun(params: {
    input: UserTaskInput;
    config?: Partial<RunConfig>;
    forkedFrom?: { runId: string; checkpointId: string; eventSeq: number };
  }): StoredRun {
    const config = RunConfigSchema.parse(params.config ?? {});
    const input = UserTaskInputSchema.parse({
      ...params.input,
      createdAt: params.input.createdAt ?? this.now()
    });
    const pattern = config.pattern;
    const definition = getPatternDefinition(pattern);
    const runId = this.nextRunId();
    const startedAt = this.now();
    const budget = config.budget ?? DEFAULT_RESOURCE_BUDGETS[pattern];
    const fullConfig = RunConfigSchema.parse({ ...config, budget });
    const manualApproval =
      fullConfig.metadata.approvalMode === "manual" || fullConfig.metadata.requireApproval === true;
    const checkpoints: CheckpointMeta[] = [];
    const events: OraEventEnvelope[] = [];
    const profiles = new AgentProfileRegistry(definition).list(fullConfig.profileIds);
    const memoryService = new MemoryService(runId, () => startedAt + events.length);
    const planService = new PlanService(runId, definition);
    const actionLedger = new ActionLedger(runId);
    const policyService = new PolicyService(runId, () => startedAt + events.length);
    const policyDecisions: PolicyDecision[] = [];
    const baseTopology = {
      nodes: definition.topology.nodes.map((node) => ({
        ...node,
        status: node.kind === "run" ? "running" : node.status
      })),
      edges: definition.topology.edges
    };
    const appendEvent = (
      type: OraEventEnvelope["type"],
      payload: unknown,
      extra: Partial<OraEventEnvelope> = {}
    ) => {
      const seq = events.length;
      const event = OraEventEnvelopeSchema.parse({
        id: `${runId}:evt-${seq}`,
        runId,
        seq,
        type,
        createdAt: startedAt + seq,
        pattern,
        payload,
        ...extra
      });
      events.push(event);
      return event;
    };
    const appendActionEvent = (actionId: string, status: string, record: unknown) => {
      appendEvent("action.updated", {
        actionId,
        status,
        record
      });
    };
    const createCheckpoint = (label: string, stateHash: string) => {
      const checkpoint: CheckpointMeta = {
        id: `${runId}:checkpoint-${checkpoints.length}`,
        runId,
        label,
        createdAt: startedAt + events.length,
        eventSeq: events.length,
        stateHash
      };
      checkpoints.push(checkpoint);
      appendEvent(
        "checkpoint.created",
        {
          checkpoint,
          summary: `${label} captured for deterministic ${definition.label} execution.`
        },
        { checkpointId: checkpoint.id }
      );
      return checkpoint;
    };

    appendEvent("run.started", {
      input,
      config: fullConfig,
      message: "Deterministic Ora MVP pattern run started."
    });
    if (params.forkedFrom) {
      appendEvent("run.forked", {
        sourceRunId: params.forkedFrom.runId,
        checkpointId: params.forkedFrom.checkpointId,
        eventSeq: params.forkedFrom.eventSeq
      });
    }
    appendEvent("topology.updated", baseTopology);
    appendEvent("profile.updated", { profiles });
    appendEvent("plan.updated", { items: planService.list() });

    const firstPlanItem = planService.firstItem();
    const highRiskAction = actionLedger.propose({
      id: "external-effect",
      type: this.patternActionType(pattern),
      riskLevel: "high",
      planItemId: firstPlanItem.id,
      agentId: firstPlanItem.ownerAgentId,
      input: {
        prompt: input.prompt,
        effect: "deterministic-runtime-side-effect"
      }
    });
    planService.linkAction(firstPlanItem.id, highRiskAction.id);
    appendActionEvent(highRiskAction.id, "proposed", highRiskAction);

    const decision = policyService.evaluate(highRiskAction);
    policyDecisions.push(decision);
    const approvalRequired = actionLedger.transition(highRiskAction.id, "approval_required");
    appendEvent("approval.required", {
      actionId: highRiskAction.id,
      decision
    });
    appendActionEvent(highRiskAction.id, "approval_required", approvalRequired);

    if (manualApproval) {
      planService.markAll("blocked");
      const checkpoint = createCheckpoint(
        "Approval checkpoint",
        `${pattern}:approval_required:${planService.list().length}`
      );
      appendEvent("run.interrupted", {
        reason: "High-risk action requires approval before deterministic execution can continue.",
        actionId: highRiskAction.id,
        checkpointId: checkpoint.id
      });

      return StateSnapshotSchema.parse({
        runId,
        status: "interrupted",
        pattern,
        input,
        config: fullConfig,
        topology: {
          nodes: baseTopology.nodes.map((node) => ({
            ...node,
            status: node.kind === "run" ? "blocked" : node.status
          })),
          edges: baseTopology.edges
        },
        profiles,
        memory: memoryService.list(),
        plan: planService.list(),
        actions: actionLedger.list(),
        policyDecisions,
        checkpoints,
        events,
        artifacts: [],
        updatedAt: startedAt + events.length
      });
    }

    appendEvent("approval.resolved", {
      actionId: highRiskAction.id,
      decision: "approved",
      mode: "auto"
    });
    const approved = actionLedger.transition(highRiskAction.id, "approved");
    appendActionEvent(highRiskAction.id, "approved", approved);
    const running = actionLedger.transition(highRiskAction.id, "running");
    appendActionEvent(highRiskAction.id, "running", running);

    const patternOutput = this.patternOutput(pattern, input.prompt);
    const memory = memoryService.remember({
      id: "pattern-state",
      namespace: this.patternMemoryNamespace(pattern, input.projectId),
      kind: pattern === "agent_teams" ? "worker" : "session",
      sourceActionId: highRiskAction.id,
      value: patternOutput.state
    });
    appendEvent("memory.updated", { record: memory });
    planService.markAll("done");
    appendEvent("plan.updated", { items: planService.list() });
    appendEvent("message.delta", {
      role: "assistant",
      content: patternOutput.message
    });
    appendEvent("token.delta", {
      text: patternOutput.token,
      tokenCount: patternOutput.tokenCount,
      budget
    });

    const succeeded = actionLedger.transition(highRiskAction.id, "succeeded", {
      output: patternOutput.state
    });
    appendActionEvent(highRiskAction.id, "succeeded", succeeded);
    const checkpoint = createCheckpoint(
      params.forkedFrom ? "Fork checkpoint" : "Pattern checkpoint",
      `${pattern}:${planService.list().length}:${baseTopology.nodes.length}:${actionLedger.list().length}`
    );
    planService.attachCheckpoint(checkpoint.id);
    appendEvent("run.done", {
      status: "succeeded",
      summary: `Deterministic ${definition.label} run completed.`
    });

    return StateSnapshotSchema.parse({
      runId,
      status: "succeeded",
      pattern,
      input,
      config: fullConfig,
      topology: {
        nodes: baseTopology.nodes.map((node) => ({
          ...node,
          status: "done"
        })),
        edges: baseTopology.edges
      },
      profiles,
      memory: memoryService.list(),
      plan: planService.list(),
      actions: actionLedger.list(),
      policyDecisions,
      checkpoints,
      events,
      artifacts: [],
      output: patternOutput.state,
      updatedAt: startedAt + events.length
    });
  }

  private patternActionType(pattern: CoordinationPattern): string {
    switch (pattern) {
      case "generator_verifier":
        return "pattern.generator_verifier.verify_candidate";
      case "orchestrator_subagent":
        return "pattern.orchestrator_subagent.dispatch_subagent";
      case "agent_teams":
        return "pattern.agent_teams.assign_worker";
    }
  }

  private patternMemoryNamespace(pattern: CoordinationPattern, projectId?: string): string[] {
    const projectNamespace = projectId ?? "local-project";
    switch (pattern) {
      case "generator_verifier":
        return ["session", projectNamespace, "generator_verifier"];
      case "orchestrator_subagent":
        return ["session", projectNamespace, "orchestrator_subagent"];
      case "agent_teams":
        return ["worker", projectNamespace, "agent_teams"];
    }
  }

  private patternOutput(pattern: CoordinationPattern, prompt: string) {
    switch (pattern) {
      case "generator_verifier":
        return {
          token: "verified",
          tokenCount: 1,
          message: `Generator produced a candidate for "${prompt}" and verifier accepted it against the MVP rubric.`,
          state: {
            text: `Verified candidate: ${prompt}`,
            pattern,
            generator: {
              candidate: `Candidate answer for: ${prompt}`
            },
            verifier: {
              verdict: "pass",
              rubric: ["addresses prompt", "bounded deterministic output"]
            }
          }
        };
      case "orchestrator_subagent":
        return {
          token: "delegated",
          tokenCount: 1,
          message: `Orchestrator decomposed "${prompt}", dispatched subagents, and synthesized their deterministic findings.`,
          state: {
            text: `Orchestrated result: ${prompt}`,
            pattern,
            orchestrator: {
              decomposition: ["research", "review", "synthesize"]
            },
            subagents: {
              researcher: "focused context gathered",
              reviewer: "risks checked"
            }
          }
        };
      case "agent_teams":
        return {
          token: "assigned",
          tokenCount: 1,
          message: `Team lead assigned "${prompt}" to persistent workers and recorded the handoff.`,
          state: {
            text: `Team result: ${prompt}`,
            pattern,
            backlog: ["triage", "build", "check", "handoff"],
            workers: {
              builder: "completed assigned work",
              checker: "validated output"
            }
          }
        };
    }
  }

  private transitionRun(
    snapshot: StateSnapshot,
    status: StateSnapshot["status"],
    type: "run.interrupted" | "run.cancelled",
    payload: unknown
  ): StateSnapshot {
    const updated = StateSnapshotSchema.parse({
      ...this.appendEvent(snapshot, type, payload),
      status
    });
    this.persistRun(updated);
    return updated;
  }

  private appendEvent(
    snapshot: StateSnapshot,
    type: OraEventEnvelope["type"],
    payload: unknown,
    extra: Partial<OraEventEnvelope> = {}
  ): StateSnapshot {
    const seq = snapshot.events.length;
    const updatedAt = this.now();
    const event = OraEventEnvelopeSchema.parse({
      id: `${snapshot.runId}:evt-${seq}`,
      runId: snapshot.runId,
      seq,
      type,
      createdAt: updatedAt,
      pattern: snapshot.pattern,
      payload,
      ...extra
    });
    return StateSnapshotSchema.parse({
      ...snapshot,
      events: [...snapshot.events, event],
      updatedAt
    });
  }

  private withTopologyStatus(snapshot: StateSnapshot, status: "running" | "done") {
    return {
      nodes: snapshot.topology.nodes.map((node) => ({
        ...node,
        status
      })),
      edges: snapshot.topology.edges
    };
  }

  private toRunHandle(snapshot: StateSnapshot): RunHandle {
    return RunHandleSchema.parse({
      runId: snapshot.runId,
      status: snapshot.status,
      pattern: snapshot.pattern,
      startedAt: snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt
    });
  }

  private toRunSummary(snapshot: StateSnapshot): RunSummary {
    return RunSummarySchema.parse({
      runId: snapshot.runId,
      status: snapshot.status,
      pattern: snapshot.pattern,
      prompt: snapshot.input.prompt,
      startedAt: snapshot.events[0]?.createdAt ?? snapshot.input.createdAt ?? snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
      eventCount: snapshot.events.length,
      checkpointCount: snapshot.checkpoints.length,
      artifactCount: snapshot.artifacts.length
    });
  }

  private persistRun(snapshot: StateSnapshot): void {
    this.runs.set(snapshot.runId, snapshot);
    this.backend.saveRun(snapshot);
    this.backend.saveManifest(this.manifest);
  }

  private nextRunId(): string {
    const runId = `run-${String(this.manifest.nextRunNumber).padStart(4, "0")}`;
    this.manifest = {
      ...this.manifest,
      nextRunNumber: this.manifest.nextRunNumber + 1
    };
    return runId;
  }

  private requireRunId(params: unknown): string {
    return RunIdParamsSchema.parse(params).runId;
  }

  private getRunOrThrow(runId: string): StateSnapshot {
    const snapshot = this.runs.get(runId);
    if (!snapshot) {
      throw new OraRuntimeError(`Run not found: ${runId}`, -32004, { runId });
    }
    return snapshot;
  }

  private now(): number {
    return this.clock();
  }
}

export class InMemoryRunStore extends LocalRunStore {}

export function defaultRuntimeStoreDir(): string {
  return fileURLToPath(pathToFileURL(path.join(process.cwd(), ".ora", "runtime.db")));
}
