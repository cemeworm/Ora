import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AutomationCreateParamsSchema,
  AutomationIdParamsSchema,
  AutomationListParamsSchema,
  AutomationPreviewScheduleParamsSchema,
  AutomationPreviewScheduleResultSchema,
  AutomationSchema,
  AutomationUpdateParamsSchema,
  type Automation,
  type AutomationCreateParams,
  type AutomationPreviewScheduleResult,
  type AutomationRunRecord,
  type AutomationUpdateParams,
  type RunEventStream,
  type RunConfig,
  type RunHandle,
  type SessionSummary,
  type StateSnapshot,
  type UserTaskInput,
} from "@cemeworm/shared";
import { nextAutomationRunAt, previewAutomationSchedule } from "./automation-schedule.js";

const FINAL_RUN_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

type AutomationStoreFile = {
  version: 1;
  automations: Automation[];
};

export interface AutomationServiceDeps {
  rootDir: string;
  clock?: () => number;
  runTimeoutMs?: number;
  createSession(params: { label?: string; projectId?: string }): SessionSummary;
  startStreamingRun(
    params: { input: UserTaskInput; config?: Partial<RunConfig>; sessionId?: string },
    options?: { onStream?: (stream: RunEventStream) => void },
  ): Promise<RunHandle>;
  listProjects(): { projectId: string }[];
  agentExists(agentId: string): boolean;
}

export class AutomationService {
  private readonly rootDir: string;
  private readonly storePath: string;
  private readonly clock: () => number;
  private readonly runTimeoutMs: number;
  private readonly deps: AutomationServiceDeps;
  private automations: Automation[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickInFlight = false;

  constructor(deps: AutomationServiceDeps) {
    this.deps = deps;
    this.rootDir = deps.rootDir;
    this.storePath = path.join(this.rootDir, "automations.json");
    this.clock = deps.clock ?? Date.now;
    this.runTimeoutMs = deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    this.automations = this.load();
  }

  start() {
    if (this.timer) return;
    this.recomputeAllNextRuns();
    this.timer = setInterval(() => {
      void this.tick();
    }, 30_000);
    void this.tick();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  list(params: unknown = {}): Automation[] {
    const parsed = AutomationListParamsSchema.parse(params);
    return this.sortedAutomations().filter((automation) => parsed.includePaused || automation.status !== "paused");
  }

  get(params: unknown): Automation {
    const { id } = AutomationIdParamsSchema.parse(params);
    return this.getById(id);
  }

  create(params: AutomationCreateParams | unknown): Automation {
    const parsed = AutomationCreateParamsSchema.parse(params);
    const now = this.clock();
    const automation = AutomationSchema.parse({
      ...parsed,
      id: `automation-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      state: {
        nextRunAt: parsed.status === "active" ? nextAutomationRunAt(parsed.schedule, now) : undefined,
      },
    });
    this.automations = [automation, ...this.automations];
    this.save();
    return automation;
  }

  update(params: AutomationUpdateParams | unknown): Automation {
    const parsed = AutomationUpdateParamsSchema.parse(params);
    const current = this.getById(parsed.id);
    const now = this.clock();
    const next = AutomationSchema.parse({
      ...current,
      ...parsed,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now,
      state: {
        ...current.state,
        nextRunAt: parsed.schedule || parsed.status === "active"
          ? nextAutomationRunAt(parsed.schedule ?? current.schedule, now)
          : parsed.status === "paused"
            ? undefined
            : current.state.nextRunAt,
      },
    });
    this.replace(next);
    return next;
  }

  delete(params: unknown): { deleted: true; id: string } {
    const { id } = AutomationIdParamsSchema.parse(params);
    const automation = this.getById(id);
    if (automation.state.runningRunId) {
      throw new Error(`Automation '${automation.title}' is currently running and cannot be deleted.`);
    }
    this.automations = this.automations.filter((automation) => automation.id !== id);
    this.save();
    return { deleted: true, id };
  }

  pause(params: unknown): Automation {
    const { id } = AutomationIdParamsSchema.parse(params);
    const automation = this.getById(id);
    const next = AutomationSchema.parse({
      ...automation,
      status: "paused",
      updatedAt: this.clock(),
      state: {
        ...automation.state,
        nextRunAt: undefined,
      },
    });
    this.replace(next);
    return next;
  }

  resume(params: unknown): Automation {
    const { id } = AutomationIdParamsSchema.parse(params);
    const automation = this.getById(id);
    const now = this.clock();
    const next = AutomationSchema.parse({
      ...automation,
      status: "active",
      updatedAt: now,
      state: {
        ...automation.state,
        nextRunAt: nextAutomationRunAt(automation.schedule, now),
      },
    });
    this.replace(next);
    return next;
  }

  async runNow(params: unknown): Promise<AutomationRunRecord> {
    const { id } = AutomationIdParamsSchema.parse(params);
    const automation = this.getById(id);
    if (automation.state.runningRunId) {
      throw new Error(`Automation '${automation.title}' is already running.`);
    }
    return this.runAutomation(automation, "force");
  }

  previewSchedule(params: unknown): AutomationPreviewScheduleResult {
    const parsed = AutomationPreviewScheduleParamsSchema.parse(params);
    return AutomationPreviewScheduleResultSchema.parse({
      occurrences: previewAutomationSchedule(parsed.schedule, parsed.from ?? this.clock(), parsed.limit),
    });
  }

  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      const now = this.clock();
      for (const automation of this.sortedAutomations()) {
        if (automation.status !== "active") continue;
        if (automation.state.runningRunId) continue;
        if (typeof automation.state.nextRunAt !== "number" || automation.state.nextRunAt > now) continue;
        await this.runAutomation(automation, "due");
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  private async runAutomation(automation: Automation, mode: "due" | "force"): Promise<AutomationRunRecord> {
    const startedAt = this.clock();
    const runRecord: AutomationRunRecord = {
      id: `automation-run-${randomUUID()}`,
      automationId: automation.id,
      sessionId: automation.state.dedicatedSessionId,
      status: "running",
      startedAt,
    };
    this.replace({
      ...automation,
      state: {
        ...automation.state,
        runningRunId: runRecord.id,
        runHistory: [runRecord, ...automation.state.runHistory].slice(0, 20),
      },
    });

    try {
      const runnable = this.prepareRunnableAutomation(this.getById(automation.id));
      const session = runnable.state.dedicatedSessionId
        ? { sessionId: runnable.state.dedicatedSessionId }
        : this.deps.createSession({ label: `Automation: ${runnable.title}`, projectId: runnable.projectId });
      const config: Partial<RunConfig> = {
        ...runnable.runConfig,
        modeId: runnable.modeId,
        modeSelection: runnable.modeSelection,
        providerId: runnable.providerId,
        customAgentId: runnable.customAgentId,
        modelRef: runnable.modelRef,
        skillIds: runnable.skillIds,
        toolIds: runnable.toolIds,
        metadata: {
          ...(runnable.runConfig.metadata ?? {}),
          automationId: runnable.id,
          automationTitle: runnable.title,
          automationRunMode: mode,
          taskIntent: runnable.taskIntent,
        },
      };
      const { handle, snapshot } = await this.startAndWaitForRun({
        input: {
          prompt: runnable.prompt,
          projectId: runnable.projectId,
          context: {
            automationId: runnable.id,
            automationTitle: runnable.title,
          },
          createdAt: startedAt,
        },
        config,
        sessionId: session.sessionId,
      });
      const completedAt = this.clock();
      const completed: AutomationRunRecord = {
        ...runRecord,
        runId: handle.runId,
        sessionId: handle.sessionId ?? session.sessionId,
        status: snapshot.status === "failed" || snapshot.status === "cancelled" ? "failed" : "succeeded",
        completedAt,
        durationMs: completedAt - startedAt,
        error: snapshot.status === "failed" ? snapshot.error : undefined,
      };
      this.completeRun(runnable.id, completed);
      return completed;
    } catch (error) {
      const completedAt = this.clock();
      const failed: AutomationRunRecord = {
        ...runRecord,
        status: "failed",
        completedAt,
        durationMs: completedAt - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
      this.completeRun(automation.id, failed);
      return failed;
    }
  }

  private prepareRunnableAutomation(automation: Automation): Automation {
    if (automation.projectId && !this.deps.listProjects().some((project) => project.projectId === automation.projectId)) {
      throw new Error(`Automation project '${automation.projectId}' is no longer available.`);
    }
    if (automation.customAgentId && !this.deps.agentExists(automation.customAgentId)) {
      throw new Error(`Automation agent '${automation.customAgentId}' is no longer available.`);
    }
    return automation;
  }

  private async startAndWaitForRun(
    params: { input: UserTaskInput; config?: Partial<RunConfig>; sessionId?: string },
  ): Promise<{ handle: RunHandle; snapshot: StateSnapshot }> {
    let handle: RunHandle | undefined;
    const snapshot = await new Promise<StateSnapshot>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Automation run timed out after ${this.runTimeoutMs}ms.`)),
        this.runTimeoutMs,
      );
      this.deps.startStreamingRun(params, {
        onStream: (stream) => {
          if (stream.snapshot && FINAL_RUN_STATUSES.has(stream.snapshot.status)) {
            clearTimeout(timer);
            resolve(stream.snapshot);
          }
        },
      }).then((created) => {
        handle = created;
      }).catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return {
      handle: handle ?? {
        runId: snapshot.runId,
        sessionId: snapshot.sessionId,
        turnIndex: snapshot.turnIndex,
        status: snapshot.status,
        pattern: snapshot.pattern,
        modeId: snapshot.modeId,
        startedAt: snapshot.input.createdAt ?? snapshot.updatedAt,
      },
      snapshot,
    };
  }

  private completeRun(id: string, runRecord: AutomationRunRecord): void {
    const automation = this.getById(id);
    const now = this.clock();
    const failed = runRecord.status === "failed";
    const nextRunAt = automation.status === "active"
      ? nextAutomationRunAt(automation.schedule, now)
      : undefined;
    this.replace({
      ...automation,
      updatedAt: now,
      state: {
        ...automation.state,
        dedicatedSessionId: runRecord.sessionId ?? automation.state.dedicatedSessionId,
        runningRunId: undefined,
        lastRunId: runRecord.runId,
        lastRunAt: runRecord.startedAt,
        lastRunStatus: runRecord.status,
        lastError: runRecord.error,
        lastDurationMs: runRecord.durationMs,
        consecutiveFailures: failed ? automation.state.consecutiveFailures + 1 : 0,
        nextRunAt,
        runHistory: [runRecord, ...automation.state.runHistory.filter((item) => item.id !== runRecord.id)].slice(0, 20),
      },
    });
  }

  private recomputeAllNextRuns(): void {
    const now = this.clock();
    let changed = false;
    this.automations = this.automations.map((automation) => {
      if (automation.status !== "active" || typeof automation.state.nextRunAt === "number") {
        return automation;
      }
      changed = true;
      return AutomationSchema.parse({
        ...automation,
        state: {
          ...automation.state,
          nextRunAt: nextAutomationRunAt(automation.schedule, now),
        },
      });
    });
    if (changed) this.save();
  }

  private sortedAutomations(): Automation[] {
    return [...this.automations].sort((a, b) => {
      const aNext = a.state.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      const bNext = b.state.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      return aNext - bNext || b.updatedAt - a.updatedAt;
    });
  }

  private getById(id: string): Automation {
    const automation = this.automations.find((item) => item.id === id);
    if (!automation) {
      throw new Error(`Automation '${id}' was not found.`);
    }
    return automation;
  }

  private replace(next: Automation): void {
    this.automations = this.automations.map((automation) => automation.id === next.id ? next : automation);
    this.save();
  }

  private load(): Automation[] {
    try {
      const raw = fs.readFileSync(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AutomationStoreFile>;
      return (parsed.automations ?? []).map((automation) => AutomationSchema.parse(automation));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private save(): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const file: AutomationStoreFile = {
      version: 1,
      automations: this.automations.map((automation) => AutomationSchema.parse(automation)),
    };
    fs.writeFileSync(this.storePath, `${JSON.stringify(file, null, 2)}\n`);
  }
}
