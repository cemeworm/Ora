import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  ArtifactRef,
  ArtifactRefSchema,
  StateSnapshot,
  StateSnapshotSchema
} from "@ora/shared";
import { OraRuntimeError } from "../run-store.js";

const MANIFEST_SCHEMA_VERSION = 1;

interface StoreManifest {
  schemaVersion: 1;
  nextRunNumber: number;
}

interface StoredRun extends StateSnapshot {}

interface PersistedArtifact {
  ref: ArtifactRef;
  payload: unknown;
}

export interface RuntimePersistenceBackend {
  load(): { manifest: StoreManifest; runs: StoredRun[] };
  saveManifest(manifest: StoreManifest): void;
  saveRun(run: StoredRun): void;
  saveArtifact(artifact: PersistedArtifact): ArtifactRef;
}

const CREATE_MANIFEST_TABLE = `
CREATE TABLE IF NOT EXISTS manifest (
  schemaVersion INTEGER NOT NULL,
  nextRunNumber INTEGER NOT NULL
);
`;

const CREATE_RUNS_TABLE = `
CREATE TABLE IF NOT EXISTS runs (
  runId TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  pattern TEXT NOT NULL,
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
INSERT INTO manifest (schemaVersion, nextRunNumber)
SELECT ?, ?
WHERE NOT EXISTS (SELECT 1 FROM manifest);
`;

export class SqliteRuntimePersistence implements RuntimePersistenceBackend {
  private readonly db: Database.Database;

  // Prepared statements
  private readonly stmtLoadManifest: Database.Statement;
  private readonly stmtSaveManifest: Database.Statement;
  private readonly stmtLoadAllRuns: Database.Statement;
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
    this.db.exec(CREATE_ARTIFACTS_TABLE);

    // Seed manifest if empty
    this.db.prepare(SEED_MANIFEST).run(MANIFEST_SCHEMA_VERSION, 1);

    // Prepare statements
    this.stmtLoadManifest = this.db.prepare("SELECT schemaVersion, nextRunNumber FROM manifest LIMIT 1");
    this.stmtSaveManifest = this.db.prepare("UPDATE manifest SET schemaVersion = ?, nextRunNumber = ?");
    this.stmtLoadAllRuns = this.db.prepare("SELECT data FROM runs ORDER BY runId ASC");
    this.stmtSaveRun = this.db.prepare(
      "INSERT INTO runs (runId, status, pattern, data) VALUES (?, ?, ?, ?) ON CONFLICT(runId) DO UPDATE SET status = excluded.status, pattern = excluded.pattern, data = excluded.data"
    );
    this.stmtSaveArtifact = this.db.prepare(
      "INSERT INTO artifacts (id, runId, kind, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET runId = excluded.runId, kind = excluded.kind, data = excluded.data"
    );
    this.stmtLoadArtifact = this.db.prepare("SELECT data FROM artifacts WHERE id = ?");
  }

  load(): { manifest: StoreManifest; runs: StoredRun[] } {
    const manifestRow = this.stmtLoadManifest.get() as
      | { schemaVersion: number; nextRunNumber: number }
      | undefined;

    if (!manifestRow) {
      throw new OraRuntimeError("SQLite manifest table is empty after init.", -32005);
    }

    const manifest: StoreManifest = {
      schemaVersion: manifestRow.schemaVersion as 1,
      nextRunNumber: manifestRow.nextRunNumber
    };

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

    return {
      manifest: {
        ...manifest,
        nextRunNumber: Math.max(manifest.nextRunNumber, maxRunNumber + 1)
      },
      runs
    };
  }

  saveManifest(manifest: StoreManifest): void {
    this.stmtSaveManifest.run(manifest.schemaVersion, manifest.nextRunNumber);
  }

  saveRun(run: StoredRun): void {
    const data = JSON.stringify(run);
    this.stmtSaveRun.run(run.runId, run.status, run.pattern, data);
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
}
