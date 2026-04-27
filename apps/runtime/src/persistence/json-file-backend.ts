import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  ArtifactRef,
  ArtifactRefSchema,
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

  constructor(private readonly dataDir: string) {
    this.manifestPath = path.join(dataDir, "manifest.json");
    this.sessionsDir = path.join(dataDir, "sessions");
    this.projectsDir = path.join(dataDir, "projects");
    this.runsDir = path.join(dataDir, "runs");
    this.artifactsDir = path.join(dataDir, "artifacts");
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

  private ensureDirs(): void {
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    fs.mkdirSync(this.projectsDir, { recursive: true });
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
