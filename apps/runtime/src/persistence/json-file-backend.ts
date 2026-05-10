import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ArtifactRef,
  ArtifactRefSchema,
  buildVisibleLedger,
  ChannelBindingSchema,
  ChannelConfigSchema,
  ChannelDeliverySchema,
  ChannelMessageRecordSchema,
  ProjectSummarySchema,
  RuntimeSessionEntrySchema,
  RuntimeSessionLedgerSchema,
  RuntimeStorageOptimizationResultSchema,
} from "@cemeworm/shared";
import { OraRuntimeError } from "../runtime-errors.js";
import {
  StoreManifestSchema,
  type PersistedArtifact,
  type RuntimePersistenceBackend,
  type StoreManifest,
  type StoredChannelBinding,
  type StoredChannelConfig,
  type StoredChannelDelivery,
  type StoredChannelMessage,
  type StoredProject,
  type RuntimeRunReadModel,
  type RuntimeSessionReadModel
} from "./types.js";
import type { RuntimeSessionEntry, RuntimeSessionLedger } from "@cemeworm/shared";
import {
  deriveRuntimeReadModelsFromLedgers,
} from "./session-ledger-projections.js";

export class JsonFileRuntimePersistenceBackend implements RuntimePersistenceBackend {
  private readonly manifestPath: string;
  private readonly sessionsDir: string;
  private readonly sessionLedgerDir: string;
  private readonly projectsDir: string;
  private readonly runsDir: string;
  private readonly artifactsDir: string;
  private readonly channelConfigsDir: string;
  private readonly channelBindingsDir: string;
  private readonly channelMessagesDir: string;
  private readonly channelDeliveriesDir: string;

  constructor(private readonly dataDir: string) {
    this.manifestPath = path.join(dataDir, "manifest.json");
    this.sessionsDir = path.join(dataDir, "sessions");
    this.sessionLedgerDir = path.join(dataDir, "sessions-ledger");
    this.projectsDir = path.join(dataDir, "projects");
    this.runsDir = path.join(dataDir, "runs");
    this.artifactsDir = path.join(dataDir, "artifacts");
    this.channelConfigsDir = path.join(dataDir, "channels", "configs");
    this.channelBindingsDir = path.join(dataDir, "channels", "bindings");
    this.channelMessagesDir = path.join(dataDir, "channels", "messages");
    this.channelDeliveriesDir = path.join(dataDir, "channels", "deliveries");
  }

  load(): { manifest: StoreManifest; runs: RuntimeRunReadModel[]; sessions: RuntimeSessionReadModel[]; projects: StoredProject[] } {
    this.ensureDirs();

    const manifest = this.readJsonFile(this.manifestPath, StoreManifestSchema, StoreManifestSchema.parse({
      schemaVersion: 3,
      nextRunNumber: 1,
      nextSessionNumber: 1,
      nextProjectNumber: 1,
    }));
    const projects: StoredProject[] = fs
      .readdirSync(this.projectsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJsonFile(path.join(this.projectsDir, name), ProjectSummarySchema))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.projectId.localeCompare(b.projectId));

    const ledgerState = deriveRuntimeReadModelsFromLedgers(this.listSessionLedgers());

    return {
      manifest: {
        ...manifest,
        nextRunNumber: Math.max(manifest.nextRunNumber, this.nextRunNumberAfter(ledgerState.runs)),
        nextSessionNumber: Math.max(manifest.nextSessionNumber, this.nextSessionNumberAfter(ledgerState.sessions)),
        nextProjectNumber: Math.max(manifest.nextProjectNumber, this.nextProjectNumberAfter(projects)),
      },
      runs: ledgerState.runs,
      sessions: ledgerState.sessions,
      projects,
    };
  }

  optimizeStorage() {
    const bytes = this.directoryBytes(this.dataDir);
    return RuntimeStorageOptimizationResultSchema.parse({
      backend: "json-file",
      vacuumed: false,
      beforeBytes: bytes,
      afterBytes: bytes,
    });
  }

  saveManifest(manifest: StoreManifest): void {
    this.ensureDirs();
    this.writeJsonFile(this.manifestPath, StoreManifestSchema.parse(manifest));
  }

  appendSessionEntries(sessionId: string, entries: RuntimeSessionEntry[], leafEntryId?: string): RuntimeSessionLedger {
    this.appendSessionEntriesFast(sessionId, entries, leafEntryId);
    return this.getSessionLedger(sessionId)!;
  }

  appendSessionEntriesFast(sessionId: string, entries: RuntimeSessionEntry[], leafEntryId?: string): void {
    this.ensureDirs();
    const parsedEntries = entries.map((entry) => RuntimeSessionEntrySchema.parse({
      ...entry,
      sessionId,
    }));
    const existing = this.getSessionLedger(sessionId) ?? RuntimeSessionLedgerSchema.parse({
      sessionId,
      entries: [],
    });
    const existingIds = new Set(existing.entries.map((entry) => entry.id));
    const appendEntries = parsedEntries.filter((entry) => !existingIds.has(entry.id));
    const ledgerPath = this.sessionLedgerPath(sessionId);
    if (appendEntries.length > 0) {
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.appendFileSync(
        ledgerPath,
        appendEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
        "utf8",
      );
    }
    const nextLeafEntryId = leafEntryId ?? appendEntries.at(-1)?.id ?? existing.leafEntryId;
    if (nextLeafEntryId) {
      this.writeJsonFile(this.sessionLedgerMetaPath(sessionId), { sessionId, leafEntryId: nextLeafEntryId });
    }
  }

  getSessionLedger(sessionId: string): RuntimeSessionLedger | undefined {
    this.ensureDirs();
    const ledgerPath = this.sessionLedgerPath(sessionId);
    if (!fs.existsSync(ledgerPath)) {
      return undefined;
    }
    const entries = parseLedgerJsonl(fs.readFileSync(ledgerPath, "utf8"))
      .filter((entry) => entry.sessionId === sessionId);
    const meta = this.readSessionLedgerMeta(sessionId);
    const entryIds = new Set(entries.map((entry) => entry.id));
    const leafEntryId = meta?.leafEntryId && entryIds.has(meta.leafEntryId)
      ? meta.leafEntryId
      : entries.sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt || a.id.localeCompare(b.id)).at(-1)?.id;
    return RuntimeSessionLedgerSchema.parse({
      sessionId,
      leafEntryId,
      entries,
    });
  }

  getSessionLedgerExcludingEvents(sessionId: string): RuntimeSessionLedger | undefined {
    const full = this.getSessionLedger(sessionId);
    if (!full) return undefined;
    try {
      return buildVisibleLedger(full);
    } catch {
      return full;
    }
  }

  getSessionLedgerCursor(sessionId: string) {
    const ledger = this.getSessionLedger(sessionId);
    if (!ledger) {
      return undefined;
    }
    return {
      maxSeq: ledger.entries.reduce((max, entry) => Math.max(max, entry.seq), -1),
      leafEntryId: ledger.leafEntryId,
    };
  }

  getSessionLedgerLeafEntryId(sessionId: string): string | null {
    const meta = this.readSessionLedgerMeta(sessionId);
    return meta?.leafEntryId ?? null;
  }

  listSessionLedgers(): RuntimeSessionLedger[] {
    this.ensureDirs();
    return fs.readdirSync(this.sessionLedgerDir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => decodeURIComponent(name.slice(0, -".jsonl".length)))
      .map((sessionId) => this.getSessionLedger(sessionId))
      .filter((ledger): ledger is RuntimeSessionLedger => ledger !== undefined)
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  }

  listLedgersExcludingEvents(): RuntimeSessionLedger[] {
    return this.listSessionLedgers().map((ledger) => {
      try {
        return buildVisibleLedger(ledger);
      } catch {
        return ledger;
      }
    });
  }

  private directoryBytes(dir: string): number {
    if (!fs.existsSync(dir)) {
      return 0;
    }
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return total + this.directoryBytes(entryPath);
      }
      if (!entry.isFile()) {
        return total;
      }
      return total + fs.statSync(entryPath).size;
    }, 0);
  }

  saveProject(project: StoredProject): void {
    this.ensureDirs();
    this.writeJsonFile(path.join(this.projectsDir, `${this.fileSafeId(project.projectId)}.json`), project);
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



  saveChannelConfig(config: StoredChannelConfig): void {
    this.ensureDirs();
    const parsed = ChannelConfigSchema.parse(config);
    this.writeJsonFile(path.join(this.channelConfigsDir, `${this.fileSafeId(parsed.channelId)}.json`), parsed);
  }

  listChannelConfigs(): StoredChannelConfig[] {
    this.ensureDirs();
    return this.readJsonDir(this.channelConfigsDir, ChannelConfigSchema)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.channelId.localeCompare(b.channelId));
  }

  getChannelConfig(channelId: string): StoredChannelConfig | undefined {
    const filePath = path.join(this.channelConfigsDir, `${this.fileSafeId(channelId)}.json`);
    return fs.existsSync(filePath) ? this.readJsonFile(filePath, ChannelConfigSchema) : undefined;
  }

  deleteChannelConfig(channelId: string): void {
    const filePath = path.join(this.channelConfigsDir, `${this.fileSafeId(channelId)}.json`);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
    }
  }

  saveChannelBinding(binding: StoredChannelBinding): void {
    this.ensureDirs();
    const parsed = ChannelBindingSchema.parse(binding);
    this.writeJsonFile(path.join(this.channelBindingsDir, `${this.fileSafeId(parsed.bindingId)}.json`), parsed);
  }

  listChannelBindings(params: { channelId?: string; externalChatId?: string; sessionId?: string; limit?: number } = {}): StoredChannelBinding[] {
    this.ensureDirs();
    return this.readJsonDir(this.channelBindingsDir, ChannelBindingSchema)
      .filter((binding) => params.channelId ? binding.channelId === params.channelId : true)
      .filter((binding) => params.externalChatId ? binding.externalChatId === params.externalChatId : true)
      .filter((binding) => params.sessionId ? binding.sessionId === params.sessionId : true)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.bindingId.localeCompare(b.bindingId))
      .slice(0, params.limit);
  }

  getChannelBindingByExternalKey(channelId: string, externalChatId: string, externalThreadId?: string): StoredChannelBinding | undefined {
    return this.listChannelBindings({ channelId, externalChatId })
      .find((binding) => (binding.externalThreadId ?? "") === (externalThreadId ?? ""));
  }

  saveChannelMessage(message: StoredChannelMessage): void {
    this.ensureDirs();
    const parsed = ChannelMessageRecordSchema.parse(message);
    this.writeJsonFile(path.join(this.channelMessagesDir, `${this.fileSafeId(parsed.messageId)}.json`), parsed);
  }

  listChannelMessages(params: { channelId?: string; bindingId?: string; sessionId?: string; limit?: number } = {}): StoredChannelMessage[] {
    this.ensureDirs();
    return this.readJsonDir(this.channelMessagesDir, ChannelMessageRecordSchema)
      .filter((message) => params.channelId ? message.channelId === params.channelId : true)
      .filter((message) => params.bindingId ? message.bindingId === params.bindingId : true)
      .filter((message) => params.sessionId ? message.sessionId === params.sessionId : true)
      .sort((a, b) => b.createdAt - a.createdAt || a.messageId.localeCompare(b.messageId))
      .slice(0, params.limit);
  }

  getChannelMessageByExternalId(channelId: string, externalMessageId: string): StoredChannelMessage | undefined {
    return this.listChannelMessages({ channelId }).find((message) => message.externalMessageId === externalMessageId);
  }

  saveChannelDelivery(delivery: StoredChannelDelivery): void {
    this.ensureDirs();
    const parsed = ChannelDeliverySchema.parse(delivery);
    this.writeJsonFile(path.join(this.channelDeliveriesDir, `${this.fileSafeId(parsed.deliveryId)}.json`), parsed);
  }

  listChannelDeliveries(params: { channelId?: string; status?: string; sessionId?: string; runId?: string; limit?: number } = {}): StoredChannelDelivery[] {
    this.ensureDirs();
    return this.readJsonDir(this.channelDeliveriesDir, ChannelDeliverySchema)
      .filter((delivery) => params.channelId ? delivery.channelId === params.channelId : true)
      .filter((delivery) => params.status ? delivery.status === params.status : true)
      .filter((delivery) => params.sessionId ? delivery.sessionId === params.sessionId : true)
      .filter((delivery) => params.runId ? delivery.runId === params.runId : true)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.deliveryId.localeCompare(b.deliveryId))
      .slice(0, params.limit);
  }

  getChannelDelivery(deliveryId: string): StoredChannelDelivery | undefined {
    const filePath = path.join(this.channelDeliveriesDir, `${this.fileSafeId(deliveryId)}.json`);
    return fs.existsSync(filePath) ? this.readJsonFile(filePath, ChannelDeliverySchema) : undefined;
  }


  private ensureDirs(): void {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    fs.mkdirSync(this.sessionLedgerDir, { recursive: true });
    fs.mkdirSync(this.projectsDir, { recursive: true });
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.mkdirSync(this.artifactsDir, { recursive: true });
    fs.mkdirSync(this.channelConfigsDir, { recursive: true });
    fs.mkdirSync(this.channelBindingsDir, { recursive: true });
    fs.mkdirSync(this.channelMessagesDir, { recursive: true });
    fs.mkdirSync(this.channelDeliveriesDir, { recursive: true });
  }



  private readJsonDir<T>(dirPath: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T[] {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    return fs
      .readdirSync(dirPath)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJsonFile(path.join(dirPath, name), schema));
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

  private nextRunNumberAfter(runs: RuntimeRunReadModel[]): number {
    return (
      runs.reduce((max, run) => {
        const match = /^run-(\d+)$/.exec(run.runId);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1
    );
  }

  private nextSessionNumberAfter(sessions: RuntimeSessionReadModel[]): number {
    return (
      sessions.reduce((max, session) => {
        const match = /^session-(\d+)$/.exec(session.sessionId);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1
    );
  }

  private nextProjectNumberAfter(projects: StoredProject[]): number {
    return (
      projects.reduce((max, project) => {
        const match = /^project-(\d+)$/.exec(project.projectId);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1
    );
  }

  private fileSafeId(id: string): string {
    return encodeURIComponent(id);
  }

  private sessionLedgerPath(sessionId: string): string {
    return path.join(this.sessionLedgerDir, `${this.fileSafeId(sessionId)}.jsonl`);
  }

  private sessionLedgerMetaPath(sessionId: string): string {
    return path.join(this.sessionLedgerDir, `${this.fileSafeId(sessionId)}.meta.json`);
  }

  private readSessionLedgerMeta(sessionId: string): { sessionId: string; leafEntryId?: string } | undefined {
    const metaPath = this.sessionLedgerMetaPath(sessionId);
    if (!fs.existsSync(metaPath)) {
      return undefined;
    }
    return this.readJsonFile(
      metaPath,
      z.object({
        sessionId: z.string().min(1),
        leafEntryId: z.string().min(1).optional(),
      }),
    );
  }
}

function parseLedgerJsonl(contents: string): RuntimeSessionEntry[] {
  const lines = contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const entries: RuntimeSessionEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    try {
      entries.push(RuntimeSessionEntrySchema.parse(JSON.parse(line)));
    } catch (error) {
      if (index === lines.length - 1) {
        break;
      }
      throw error;
    }
  }
  return entries;
}
