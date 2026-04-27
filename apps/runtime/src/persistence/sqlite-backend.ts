import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  ArtifactRefSchema,
  ProjectSummarySchema,
  SessionSummarySchema,
  StateSnapshotSchema
} from "@ora/shared";
import type { ArtifactRef } from "@ora/shared";
import { OraRuntimeError } from "../runtime-errors.js";
import type {
  PersistedArtifact,
  RuntimePersistenceBackend,
  StoreManifest,
  StoredProject,
  StoredRun,
  StoredSession
} from "./types.js";

const MANIFEST_SCHEMA_VERSION = 3;

const CREATE_MANIFEST_TABLE = `
CREATE TABLE IF NOT EXISTS manifest (
  schemaVersion INTEGER NOT NULL,
  nextRunNumber INTEGER NOT NULL,
  nextSessionNumber INTEGER NOT NULL DEFAULT 1,
  nextProjectNumber INTEGER NOT NULL DEFAULT 1
);
`;

const CREATE_RUNS_TABLE = `
CREATE TABLE IF NOT EXISTS runs (
  runId TEXT PRIMARY KEY,
  sessionId TEXT,
  turnIndex INTEGER,
  status TEXT NOT NULL,
  pattern TEXT NOT NULL,
  data TEXT NOT NULL
);
`;

const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  sessionId TEXT PRIMARY KEY,
  updatedAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

const CREATE_PROJECTS_TABLE = `
CREATE TABLE IF NOT EXISTS projects (
  projectId TEXT PRIMARY KEY,
  updatedAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

const CREATE_ARTIFACTS_TABLE = `
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL
);
`;

const SEED_MANIFEST = `
INSERT INTO manifest (schemaVersion, nextRunNumber, nextSessionNumber, nextProjectNumber)
SELECT ?, ?, ?, ?
WHERE NOT EXISTS (SELECT 1 FROM manifest);
`;

export class SqliteRuntimePersistence implements RuntimePersistenceBackend {
  private readonly db: Database.Database;

  // Prepared statements
  private readonly stmtLoadManifest: Database.Statement;
  private readonly stmtSaveManifest: Database.Statement;
  private readonly stmtLoadAllSessions: Database.Statement;
  private readonly stmtLoadAllProjects: Database.Statement;
  private readonly stmtLoadAllRuns: Database.Statement;
  private readonly stmtSaveSession: Database.Statement;
  private readonly stmtSaveProject: Database.Statement;
  private readonly stmtSaveRun: Database.Statement;
  private readonly stmtSaveArtifact: Database.Statement;
  private readonly stmtLoadArtifact: Database.Statement;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");

    // Create tables
    this.db.exec(CREATE_MANIFEST_TABLE);
    this.db.exec(CREATE_RUNS_TABLE);
    this.db.exec(CREATE_SESSIONS_TABLE);
    this.db.exec(CREATE_PROJECTS_TABLE);
    this.db.exec(CREATE_ARTIFACTS_TABLE);
    this.ensureColumn("manifest", "nextSessionNumber", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("manifest", "nextProjectNumber", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("runs", "sessionId", "TEXT");
    this.ensureColumn("runs", "turnIndex", "INTEGER");

    // Seed manifest if empty
    this.db.prepare(SEED_MANIFEST).run(MANIFEST_SCHEMA_VERSION, 1, 1, 1);
    this.db.prepare("UPDATE manifest SET nextProjectNumber = COALESCE(nextProjectNumber, 1)").run();

    // Prepare statements
    this.stmtLoadManifest = this.db.prepare("SELECT schemaVersion, nextRunNumber, nextSessionNumber, nextProjectNumber FROM manifest LIMIT 1");
    this.stmtSaveManifest = this.db.prepare("UPDATE manifest SET schemaVersion = ?, nextRunNumber = ?, nextSessionNumber = ?, nextProjectNumber = ?");
    this.stmtLoadAllSessions = this.db.prepare("SELECT data FROM sessions ORDER BY updatedAt DESC, sessionId ASC");
    this.stmtLoadAllProjects = this.db.prepare("SELECT data FROM projects ORDER BY updatedAt DESC, projectId ASC");
    this.stmtLoadAllRuns = this.db.prepare("SELECT data FROM runs ORDER BY runId ASC");
    this.stmtSaveSession = this.db.prepare(
      "INSERT INTO sessions (sessionId, updatedAt, data) VALUES (?, ?, ?) ON CONFLICT(sessionId) DO UPDATE SET updatedAt = excluded.updatedAt, data = excluded.data"
    );
    this.stmtSaveProject = this.db.prepare(
      "INSERT INTO projects (projectId, updatedAt, data) VALUES (?, ?, ?) ON CONFLICT(projectId) DO UPDATE SET updatedAt = excluded.updatedAt, data = excluded.data"
    );
    this.stmtSaveRun = this.db.prepare(
      "INSERT INTO runs (runId, sessionId, turnIndex, status, pattern, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(runId) DO UPDATE SET sessionId = excluded.sessionId, turnIndex = excluded.turnIndex, status = excluded.status, pattern = excluded.pattern, data = excluded.data"
    );
    this.stmtSaveArtifact = this.db.prepare(
      "INSERT INTO artifacts (id, runId, kind, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET runId = excluded.runId, kind = excluded.kind, data = excluded.data"
    );
    this.stmtLoadArtifact = this.db.prepare("SELECT data FROM artifacts WHERE id = ?");
  }

  load(): { manifest: StoreManifest; runs: StoredRun[]; sessions: StoredSession[]; projects: StoredProject[] } {
    const manifestRow = this.stmtLoadManifest.get() as
      | { schemaVersion: number; nextRunNumber: number; nextSessionNumber?: number; nextProjectNumber?: number }
      | undefined;

    if (!manifestRow) {
      throw new OraRuntimeError("SQLite manifest table is empty after init.", -32005);
    }

    const manifest: StoreManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      nextRunNumber: manifestRow.nextRunNumber,
      nextSessionNumber: manifestRow.nextSessionNumber ?? 1,
      nextProjectNumber: manifestRow.nextProjectNumber ?? 1,
    };

    const sessionRows = this.stmtLoadAllSessions.all() as { data: string }[];
    const sessions: StoredSession[] = [];
    for (const row of sessionRows) {
      sessions.push(SessionSummarySchema.parse(JSON.parse(row.data)));
    }

    const projectRows = this.stmtLoadAllProjects.all() as { data: string }[];
    const projects: StoredProject[] = [];
    for (const row of projectRows) {
      projects.push(ProjectSummarySchema.parse(JSON.parse(row.data)));
    }

    const runRows = this.stmtLoadAllRuns.all() as { data: string }[];
    const runs: StoredRun[] = [];
    for (const row of runRows) {
      runs.push(StateSnapshotSchema.parse(JSON.parse(row.data)));
    }

    // Ensure nextRunNumber is at least greater than any existing run number
    const maxRunNumber = runs.reduce((max, run) => {
      const match = /^run-(\d+)$/.exec(run.runId);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    const maxSessionNumber = sessions.reduce((max, session) => {
      const match = /^session-(\d+)$/.exec(session.sessionId);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    const maxProjectNumber = projects.reduce((max, project) => {
      const match = /^project-(\d+)$/.exec(project.projectId);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    return {
      manifest: {
        ...manifest,
        nextRunNumber: Math.max(manifest.nextRunNumber, maxRunNumber + 1),
        nextSessionNumber: Math.max(manifest.nextSessionNumber, maxSessionNumber + 1),
        nextProjectNumber: Math.max(manifest.nextProjectNumber, maxProjectNumber + 1),
      },
      runs,
      sessions,
      projects,
    };
  }

  saveManifest(manifest: StoreManifest): void {
    this.stmtSaveManifest.run(
      manifest.schemaVersion,
      manifest.nextRunNumber,
      manifest.nextSessionNumber,
      manifest.nextProjectNumber,
    );
  }

  saveRun(run: StoredRun): void {
    const data = JSON.stringify(run);
    this.stmtSaveRun.run(run.runId, run.sessionId ?? null, run.turnIndex ?? 1, run.status, run.pattern, data);
  }

  saveSession(session: StoredSession): void {
    const data = JSON.stringify(session);
    this.stmtSaveSession.run(session.sessionId, session.updatedAt, data);
  }

  saveProject(project: StoredProject): void {
    const data = JSON.stringify(project);
    this.stmtSaveProject.run(project.projectId, project.updatedAt, data);
  }

  saveArtifact(artifact: PersistedArtifact): ArtifactRef {
    const data = JSON.stringify(artifact.payload);
    this.stmtSaveArtifact.run(artifact.ref.id, artifact.ref.runId, artifact.ref.kind, data);

    return ArtifactRefSchema.parse({
      ...artifact.ref,
      sizeBytes: Buffer.byteLength(data)
    });
  }

  close(): void {
    this.db.close();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
