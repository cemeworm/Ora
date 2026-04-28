import { SessionSummarySchema, StateSnapshotSchema } from "@ora/shared";
import type { ProjectSummary, SessionSummary, StateSnapshot } from "@ora/shared";
import type { RuntimePersistenceBackend, StoreManifest } from "./persistence/types.js";
import { defaultSessionTitle } from "./session-title.js";

export interface RuntimeMigrationState {
  projects: Map<string, ProjectSummary>;
  sessions: Map<string, SessionSummary>;
  runs: Map<string, StateSnapshot>;
  backend: RuntimePersistenceBackend;
  manifest: StoreManifest;
}

export function migrateLegacyRunsIntoSessions(state: RuntimeMigrationState): void {
  let mutated = false;
  for (const [runId, existing] of state.runs.entries()) {
    if (existing.sessionId) {
      continue;
    }
    const sessionId = `session-legacy-${runId}`;
    const migrated = StateSnapshotSchema.parse({
      ...existing,
      sessionId,
      turnIndex: 1,
    });
    state.runs.set(runId, migrated);
    state.backend.saveRun(migrated);
    if (!state.sessions.has(sessionId)) {
      state.sessions.set(sessionId, SessionSummarySchema.parse({
        sessionId,
        title: defaultSessionTitle(migrated.input.prompt),
        projectId: migrated.input.projectId,
        status: migrated.status,
        latestRunId: migrated.runId,
        latestPattern: migrated.pattern,
        latestProviderId: typeof migrated.config.providerId === "string" ? migrated.config.providerId : undefined,
        latestModelRef: migrated.config.modelRef,
        turnCount: 1,
        createdAt: migrated.input.createdAt ?? migrated.updatedAt,
        updatedAt: migrated.updatedAt,
      }));
    }
    mutated = true;
  }
  if (mutated) {
    for (const session of state.sessions.values()) {
      state.backend.saveSession(session);
    }
    state.backend.saveManifest(state.manifest);
  }
}

export function migrateLegacyOraMvpProjectPlaceholder(state: RuntimeMigrationState): void {
  if (state.projects.has("ora-mvp")) {
    return;
  }

  let mutated = false;
  for (const [sessionId, session] of state.sessions.entries()) {
    if (session.projectId !== "ora-mvp") {
      continue;
    }
    const nextSession = SessionSummarySchema.parse({
      ...session,
      projectId: undefined,
    });
    state.sessions.set(sessionId, nextSession);
    state.backend.saveSession(nextSession);
    mutated = true;
  }

  for (const [runId, run] of state.runs.entries()) {
    if (run.input.projectId !== "ora-mvp") {
      continue;
    }
    const nextRun = StateSnapshotSchema.parse({
      ...run,
      input: {
        ...run.input,
        projectId: undefined,
      },
    });
    state.runs.set(runId, nextRun);
    state.backend.saveRun(nextRun);
    mutated = true;
  }

  if (mutated) {
    state.backend.saveManifest(state.manifest);
  }
}
