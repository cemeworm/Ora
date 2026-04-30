import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ArtifactRef,
  ArtifactRefSchema,
  ChannelBindingSchema,
  ChannelConfigSchema,
  ChannelDeliverySchema,
  ChannelMessageRecordSchema,
  ProjectSummarySchema,
  SessionSummarySchema,
  StateSnapshotSchema
} from "@ora/shared";
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
  type StoredRun,
  type StoredSession
} from "./types.js";

export class JsonFileRuntimePersistenceBackend implements RuntimePersistenceBackend {
  private readonly manifestPath: string;
  private readonly sessionsDir: string;
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
    this.projectsDir = path.join(dataDir, "projects");
    this.runsDir = path.join(dataDir, "runs");
    this.artifactsDir = path.join(dataDir, "artifacts");
    this.channelConfigsDir = path.join(dataDir, "channels", "configs");
    this.channelBindingsDir = path.join(dataDir, "channels", "bindings");
    this.channelMessagesDir = path.join(dataDir, "channels", "messages");
    this.channelDeliveriesDir = path.join(dataDir, "channels", "deliveries");
  }

  load(): { manifest: StoreManifest; runs: StoredRun[]; sessions: StoredSession[]; projects: StoredProject[] } {
    this.ensureDirs();

    const manifest = this.readJsonFile(this.manifestPath, StoreManifestSchema, StoreManifestSchema.parse({
      schemaVersion: 3,
      nextRunNumber: 1,
      nextSessionNumber: 1,
      nextProjectNumber: 1,
    }));
    const sessions: StoredSession[] = fs
      .readdirSync(this.sessionsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJsonFile(path.join(this.sessionsDir, name), SessionSummarySchema))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
    const projects: StoredProject[] = fs
      .readdirSync(this.projectsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJsonFile(path.join(this.projectsDir, name), ProjectSummarySchema))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.projectId.localeCompare(b.projectId));
    const runs: StoredRun[] = fs
      .readdirSync(this.runsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.readJsonFile(path.join(this.runsDir, name), StateSnapshotSchema))
      .sort((a, b) => a.runId.localeCompare(b.runId));

    return {
      manifest: {
        ...manifest,
        nextRunNumber: Math.max(manifest.nextRunNumber, this.nextRunNumberAfter(runs)),
        nextSessionNumber: Math.max(manifest.nextSessionNumber, this.nextSessionNumberAfter(sessions)),
        nextProjectNumber: Math.max(manifest.nextProjectNumber, this.nextProjectNumberAfter(projects)),
      },
      runs,
      sessions,
      projects,
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

  saveSession(session: StoredSession): void {
    this.ensureDirs();
    this.writeJsonFile(path.join(this.sessionsDir, `${this.fileSafeId(session.sessionId)}.json`), session);
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

  private nextRunNumberAfter(runs: StoredRun[]): number {
    return (
      runs.reduce((max, run) => {
        const match = /^run-(\d+)$/.exec(run.runId);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1
    );
  }

  private nextSessionNumberAfter(sessions: StoredSession[]): number {
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
}
