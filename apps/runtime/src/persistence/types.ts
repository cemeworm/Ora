import { z } from "zod";
import type {
  ArtifactRef,
  ChannelBinding,
  ChannelConfig,
  ChannelDelivery,
  ChannelMessageRecord,
  ProjectSummary,
  RuntimeSessionEntry,
  RuntimeSessionLedger,
  RuntimeStorageOptimizationResult,
  SessionSummary,
  StateSnapshot
} from "@cemeworm/shared";

export const StoreManifestSchema = z.object({
  schemaVersion: z.literal(3).default(3),
  nextRunNumber: z.number().int().positive(),
  nextSessionNumber: z.number().int().positive().default(1),
  nextProjectNumber: z.number().int().positive().default(1),
});

export type StoreManifest = z.infer<typeof StoreManifestSchema>;
// RPC-compatible read models derived from the session ledger. These shapes are
// intentionally legacy-compatible, but they are projections, not persistence
// authority.
export type RuntimeRunReadModel = StateSnapshot;
export type RuntimeSessionReadModel = SessionSummary;
export type StoredProject = ProjectSummary;
export type StoredChannelConfig = ChannelConfig;
export type StoredChannelBinding = ChannelBinding;
export type StoredChannelMessage = ChannelMessageRecord;
export type StoredChannelDelivery = ChannelDelivery;

export interface PersistedArtifact {
  ref: ArtifactRef;
  payload: unknown;
}

export interface RuntimePersistenceBackend {
  load(): { manifest: StoreManifest; runs: RuntimeRunReadModel[]; sessions: RuntimeSessionReadModel[]; projects: StoredProject[] };
  optimizeStorage(): RuntimeStorageOptimizationResult;
  appendSessionEntries(sessionId: string, entries: RuntimeSessionEntry[], leafEntryId?: string): RuntimeSessionLedger;
  getSessionLedger(sessionId: string): RuntimeSessionLedger | undefined;
  listSessionLedgers(): RuntimeSessionLedger[];
  saveManifest(manifest: StoreManifest): void;
  saveProject(project: StoredProject): void;
  saveArtifact(artifact: PersistedArtifact): ArtifactRef;
  saveChannelConfig(config: StoredChannelConfig): void;
  listChannelConfigs(): StoredChannelConfig[];
  getChannelConfig(channelId: string): StoredChannelConfig | undefined;
  deleteChannelConfig(channelId: string): void;
  saveChannelBinding(binding: StoredChannelBinding): void;
  listChannelBindings(params?: { channelId?: string; externalChatId?: string; sessionId?: string; limit?: number }): StoredChannelBinding[];
  getChannelBindingByExternalKey(channelId: string, externalChatId: string, externalThreadId?: string): StoredChannelBinding | undefined;
  saveChannelMessage(message: StoredChannelMessage): void;
  listChannelMessages(params?: { channelId?: string; bindingId?: string; sessionId?: string; limit?: number }): StoredChannelMessage[];
  getChannelMessageByExternalId(channelId: string, externalMessageId: string): StoredChannelMessage | undefined;
  saveChannelDelivery(delivery: StoredChannelDelivery): void;
  listChannelDeliveries(params?: { channelId?: string; status?: string; sessionId?: string; runId?: string; limit?: number }): StoredChannelDelivery[];
  getChannelDelivery(deliveryId: string): StoredChannelDelivery | undefined;
}
