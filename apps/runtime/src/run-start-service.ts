import type {
  PatternDefinition,
  RunConfig,
  SessionSummary,
  UserTaskInput,
} from "@cemeworm/shared";
import {
  resolveModeSelection,
  withMemoryPrompt,
  type ModeSelectionDeps,
} from "./mode-selection.js";

interface RunStartServiceDeps {
  now: () => number;
  ensureSessionForRun: (sessionId: string | undefined, input: UserTaskInput) => SessionSummary;
  enrichInputForSession: (input: UserTaskInput, session: SessionSummary) => UserTaskInput;
  modeSelectionDeps: () => ModeSelectionDeps;
  nextRunId: () => string;
  nextTurnIndex: (sessionId: string) => number;
}

export interface RunStartPreparation {
  session: SessionSummary;
  input: UserTaskInput;
  resolved: Awaited<ReturnType<typeof resolveModeSelection>>;
  fullConfig: RunConfig;
  modeSpec: RunStartPreparation["resolved"]["modeSpec"];
  definition: PatternDefinition;
  runId: string;
  turnIndex: number;
}

export class RunStartService {
  constructor(private readonly deps: RunStartServiceDeps) {}

  async prepare(params: {
    sessionId?: string;
    input: UserTaskInput;
    config?: Partial<RunConfig>;
  }): Promise<RunStartPreparation> {
    const session = this.deps.ensureSessionForRun(params.sessionId, params.input);
    const input = this.deps.enrichInputForSession({
      ...params.input,
      createdAt: params.input.createdAt ?? this.deps.now(),
    }, session);
    const resolved = await resolveModeSelection(params.config, input, session, this.deps.modeSelectionDeps());
    const fullConfig = withMemoryPrompt(resolved.fullConfig, input, session, this.deps.modeSelectionDeps());
    const runId = this.deps.nextRunId();
    const turnIndex = this.deps.nextTurnIndex(session.sessionId);
    return {
      session,
      input,
      resolved,
      fullConfig,
      modeSpec: resolved.modeSpec,
      definition: resolved.definition,
      runId,
      turnIndex,
    };
  }
}
