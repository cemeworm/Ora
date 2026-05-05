import type { ProjectSummary, SessionSummary, StateSnapshot } from "@cemeworm/shared";
import type { RuntimePersistenceBackend, StoreManifest } from "./persistence/types.js";

export interface RuntimeMigrationState {
  projects: Map<string, ProjectSummary>;
  sessions: Map<string, SessionSummary>;
  runs: Map<string, StateSnapshot>;
  backend: RuntimePersistenceBackend;
  manifest: StoreManifest;
}

export function migrateLegacyRunsIntoSessions(state: RuntimeMigrationState): void {
  void state;
}

export function migrateLegacyOraMvpProjectPlaceholder(state: RuntimeMigrationState): void {
  void state;
}
