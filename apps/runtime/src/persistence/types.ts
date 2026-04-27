import { z } from "zod";
import type {
  ArtifactRef,
  ProjectSummary,
  SessionSummary,
  StateSnapshot
} from "@ora/shared";

export const StoreManifestSchema = z.object({
  schemaVersion: z.literal(3).default(3),
  nextRunNumber: z.number().int().positive(),
  nextSessionNumber: z.number().int().positive().default(1),
  nextProjectNumber: z.number().int().positive().default(1),
});

export type StoreManifest = z.infer<typeof StoreManifestSchema>;
export type StoredRun = StateSnapshot;
export type StoredSession = SessionSummary;
export type StoredProject = ProjectSummary;

export interface PersistedArtifact {
  ref: ArtifactRef;
  payload: unknown;
}

export interface RuntimePersistenceBackend {
  load(): { manifest: StoreManifest; runs: StoredRun[]; sessions: StoredSession[]; projects: StoredProject[] };
  saveManifest(manifest: StoreManifest): void;
  saveRun(run: StoredRun): void;
  saveSession(session: StoredSession): void;
  saveProject(project: StoredProject): void;
  saveArtifact(artifact: PersistedArtifact): ArtifactRef;
}
