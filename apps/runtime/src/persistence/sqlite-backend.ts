import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
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
import type { ArtifactRef, RuntimeSessionEntry, RuntimeSessionLedger } from "@cemeworm/shared";
import { OraRuntimeError } from "../runtime-errors.js";
import type {
  PersistedArtifact,
  RuntimePersistenceBackend,
  StoreManifest,
  StoredChannelBinding,
  StoredChannelConfig,
  StoredChannelDelivery,
  StoredChannelMessage,
  StoredProject,
  RuntimeRunReadModel,
  RuntimeSessionReadModel,
} from "./types.js";
import { deriveRuntimeReadModelsFromLedgers } from "./session-ledger-projections.js";

const MANIFEST_SCHEMA_VERSION = 3;

const CREATE_MANIFEST_TABLE = `
CREATE TABLE IF NOT EXISTS manifest (
  schemaVersion INTEGER NOT NULL,
  nextRunNumber INTEGER NOT NULL,
  nextSessionNumber INTEGER NOT NULL DEFAULT 1,
  nextProjectNumber INTEGER NOT NULL DEFAULT 1
);
`;

const CREATE_SESSION_ENTRIES_TABLE = `
CREATE TABLE IF NOT EXISTS session_entries (
  sessionId TEXT NOT NULL,
  entryId TEXT NOT NULL,
  parentId TEXT,
  runId TEXT,
  turnIndex INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (sessionId, entryId)
);

CREATE INDEX IF NOT EXISTS idx_session_entries_session_seq
  ON session_entries(sessionId, seq, createdAt, entryId);
`;

const CREATE_SESSION_LEDGER_META_TABLE = `
CREATE TABLE IF NOT EXISTS session_ledger_meta (
  sessionId TEXT PRIMARY KEY,
  leafEntryId TEXT
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


const CREATE_CHANNEL_CONFIGS_TABLE = `
CREATE TABLE IF NOT EXISTS channel_configs (
  channelId TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  data TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
`;

const CREATE_CHANNEL_BINDINGS_TABLE = `
CREATE TABLE IF NOT EXISTS channel_bindings (
  bindingId TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  externalChatId TEXT NOT NULL,
  externalThreadId TEXT,
  sessionId TEXT NOT NULL,
  externalUserId TEXT,
  data TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(channelId, externalChatId, externalThreadId)
);
`;

const CREATE_CHANNEL_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS channel_messages (
  messageId TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  externalMessageId TEXT,
  bindingId TEXT,
  sessionId TEXT,
  runId TEXT,
  direction TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  UNIQUE(channelId, externalMessageId)
);
`;

const CREATE_CHANNEL_DELIVERIES_TABLE = `
CREATE TABLE IF NOT EXISTS channel_deliveries (
  deliveryId TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  outboundMessageId TEXT NOT NULL,
  sessionId TEXT,
  runId TEXT,
  status TEXT NOT NULL,
  attemptCount INTEGER NOT NULL,
  nextAttemptAt INTEGER,
  lastError TEXT,
  data TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
`;

const SEED_MANIFEST = `
INSERT INTO manifest (schemaVersion, nextRunNumber, nextSessionNumber, nextProjectNumber)
SELECT ?, ?, ?, ?
WHERE NOT EXISTS (SELECT 1 FROM manifest);
`;

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export class SqliteRuntimePersistence implements RuntimePersistenceBackend {
  private readonly db: Database.Database;

  // Prepared statements
  private readonly stmtLoadManifest: Database.Statement;
  private readonly stmtSaveManifest: Database.Statement;
  private readonly stmtLoadAllProjects: Database.Statement;
  private readonly stmtInsertSessionEntry: Database.Statement;
  private readonly stmtLoadSessionEntries: Database.Statement;
  private readonly stmtLoadAllSessionEntries: Database.Statement;
  private readonly stmtLoadAllSessionEntriesExcludingEvents: Database.Statement;
  private readonly stmtLoadSessionEntriesExcludingEvents: Database.Statement;
  private readonly stmtLoadEventBatchesForRun: Database.Statement;
  private readonly stmtListSessionEntryIds: Database.Statement;
  private readonly stmtGetSessionLedgerCursor: Database.Statement;
  private readonly stmtSessionLedgerEntryRevision: Database.Statement;
  private readonly stmtSessionLedgerMetaRevision: Database.Statement;
  private readonly stmtSaveSessionLedgerMeta: Database.Statement;
  private readonly stmtGetSessionLedgerMeta: Database.Statement;
  private readonly stmtLoadAllSessionLedgerMetas: Database.Statement;
  private readonly stmtSaveProject: Database.Statement;
  private readonly stmtSaveArtifact: Database.Statement;
  private readonly stmtLoadArtifact: Database.Statement;
  private readonly stmtSaveChannelConfig: Database.Statement;
  private readonly stmtListChannelConfigs: Database.Statement;
  private readonly stmtGetChannelConfig: Database.Statement;
  private readonly stmtDeleteChannelConfig: Database.Statement;
  private readonly stmtSaveChannelBinding: Database.Statement;
  private readonly stmtListChannelBindings: Database.Statement;
  private readonly stmtGetChannelBindingByExternalKey: Database.Statement;
  private readonly stmtSaveChannelMessage: Database.Statement;
  private readonly stmtListChannelMessages: Database.Statement;
  private readonly stmtGetChannelMessageByExternalId: Database.Statement;
  private readonly stmtSaveChannelDelivery: Database.Statement;
  private readonly stmtListChannelDeliveries: Database.Statement;
  private readonly stmtGetChannelDelivery: Database.Statement;

  constructor(private readonly dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");

    // Create tables
    this.db.exec(CREATE_MANIFEST_TABLE);
    this.db.exec(CREATE_SESSION_ENTRIES_TABLE);
    this.db.exec(CREATE_SESSION_LEDGER_META_TABLE);
    this.db.exec(CREATE_PROJECTS_TABLE);
    this.db.exec(CREATE_ARTIFACTS_TABLE);
    this.db.exec(CREATE_CHANNEL_CONFIGS_TABLE);
    this.db.exec(CREATE_CHANNEL_BINDINGS_TABLE);
    this.db.exec(CREATE_CHANNEL_MESSAGES_TABLE);
    this.db.exec(CREATE_CHANNEL_DELIVERIES_TABLE);
    this.ensureColumn("manifest", "nextSessionNumber", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("manifest", "nextProjectNumber", "INTEGER NOT NULL DEFAULT 1");

    // Seed manifest if empty
    this.db.prepare(SEED_MANIFEST).run(MANIFEST_SCHEMA_VERSION, 1, 1, 1);
    this.db.prepare("UPDATE manifest SET nextProjectNumber = COALESCE(nextProjectNumber, 1)").run();

    // Prepare statements
    this.stmtLoadManifest = this.db.prepare("SELECT schemaVersion, nextRunNumber, nextSessionNumber, nextProjectNumber FROM manifest LIMIT 1");
    this.stmtSaveManifest = this.db.prepare("UPDATE manifest SET schemaVersion = ?, nextRunNumber = ?, nextSessionNumber = ?, nextProjectNumber = ?");
    this.stmtLoadAllProjects = this.db.prepare("SELECT data FROM projects ORDER BY updatedAt DESC, projectId ASC");
    this.stmtInsertSessionEntry = this.db.prepare(
      "INSERT OR IGNORE INTO session_entries (sessionId, entryId, parentId, runId, turnIndex, seq, createdAt, type, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    this.stmtLoadSessionEntries = this.db.prepare("SELECT data FROM session_entries WHERE sessionId = ? ORDER BY seq ASC, createdAt ASC, entryId ASC");
    this.stmtLoadAllSessionEntries = this.db.prepare("SELECT sessionId, data FROM session_entries ORDER BY sessionId ASC, seq ASC, createdAt ASC, entryId ASC");
    this.stmtLoadAllSessionEntriesExcludingEvents = this.db.prepare("SELECT sessionId, data FROM session_entries WHERE type != 'runtime.event_batch' ORDER BY sessionId ASC, seq ASC, createdAt ASC, entryId ASC");
    this.stmtLoadSessionEntriesExcludingEvents = this.db.prepare("SELECT data FROM session_entries WHERE sessionId = ? AND type != 'runtime.event_batch' ORDER BY seq ASC, createdAt ASC, entryId ASC");
    this.stmtLoadEventBatchesForRun = this.db.prepare("SELECT data FROM session_entries WHERE runId = ? AND type = 'runtime.event_batch' AND sessionId = ? ORDER BY seq ASC, createdAt ASC, entryId ASC");
    this.stmtListSessionEntryIds = this.db.prepare("SELECT DISTINCT sessionId FROM session_entries ORDER BY sessionId ASC");
    this.stmtGetSessionLedgerCursor = this.db.prepare(`
      SELECT
        COUNT(*) AS entryCount,
        COALESCE(MAX(seq), -1) AS maxSeq,
        (SELECT leafEntryId FROM session_ledger_meta WHERE sessionId = ? LIMIT 1) AS leafEntryId
      FROM session_entries
      WHERE sessionId = ?
    `);
    this.stmtSessionLedgerEntryRevision = this.db.prepare("SELECT COUNT(*) AS count, COALESCE(MAX(rowid), 0) AS maxRowid FROM session_entries");
    this.stmtSessionLedgerMetaRevision = this.db.prepare("SELECT COALESCE(group_concat(sessionId || ':' || COALESCE(leafEntryId, ''), '|'), '') AS meta FROM (SELECT sessionId, leafEntryId FROM session_ledger_meta ORDER BY sessionId ASC)");
    this.stmtSaveSessionLedgerMeta = this.db.prepare(
      "INSERT INTO session_ledger_meta (sessionId, leafEntryId) VALUES (?, ?) ON CONFLICT(sessionId) DO UPDATE SET leafEntryId = excluded.leafEntryId"
    );
    this.stmtGetSessionLedgerMeta = this.db.prepare("SELECT leafEntryId FROM session_ledger_meta WHERE sessionId = ? LIMIT 1");
    this.stmtLoadAllSessionLedgerMetas = this.db.prepare("SELECT sessionId, leafEntryId FROM session_ledger_meta");
    this.stmtSaveProject = this.db.prepare(
      "INSERT INTO projects (projectId, updatedAt, data) VALUES (?, ?, ?) ON CONFLICT(projectId) DO UPDATE SET updatedAt = excluded.updatedAt, data = excluded.data"
    );
    this.stmtSaveArtifact = this.db.prepare(
      "INSERT INTO artifacts (id, runId, kind, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET runId = excluded.runId, kind = excluded.kind, data = excluded.data"
    );
    this.stmtLoadArtifact = this.db.prepare("SELECT data FROM artifacts WHERE id = ?");

    this.stmtSaveChannelConfig = this.db.prepare(
      "INSERT INTO channel_configs (channelId, kind, enabled, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(channelId) DO UPDATE SET kind = excluded.kind, enabled = excluded.enabled, data = excluded.data, updatedAt = excluded.updatedAt"
    );
    this.stmtListChannelConfigs = this.db.prepare("SELECT data FROM channel_configs ORDER BY updatedAt DESC, channelId ASC");
    this.stmtGetChannelConfig = this.db.prepare("SELECT data FROM channel_configs WHERE channelId = ?");
    this.stmtDeleteChannelConfig = this.db.prepare("DELETE FROM channel_configs WHERE channelId = ?");
    this.stmtSaveChannelBinding = this.db.prepare(
      "INSERT INTO channel_bindings (bindingId, channelId, externalChatId, externalThreadId, sessionId, externalUserId, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bindingId) DO UPDATE SET channelId = excluded.channelId, externalChatId = excluded.externalChatId, externalThreadId = excluded.externalThreadId, sessionId = excluded.sessionId, externalUserId = excluded.externalUserId, data = excluded.data, updatedAt = excluded.updatedAt"
    );
    this.stmtListChannelBindings = this.db.prepare("SELECT data FROM channel_bindings ORDER BY updatedAt DESC, bindingId ASC");
    this.stmtGetChannelBindingByExternalKey = this.db.prepare("SELECT data FROM channel_bindings WHERE channelId = ? AND externalChatId = ? AND COALESCE(externalThreadId, '') = COALESCE(?, '') LIMIT 1");
    this.stmtSaveChannelMessage = this.db.prepare(
      "INSERT INTO channel_messages (messageId, channelId, externalMessageId, bindingId, sessionId, runId, direction, type, data, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(messageId) DO UPDATE SET bindingId = excluded.bindingId, sessionId = excluded.sessionId, runId = excluded.runId, data = excluded.data"
    );
    this.stmtListChannelMessages = this.db.prepare("SELECT data FROM channel_messages ORDER BY createdAt DESC, messageId ASC");
    this.stmtGetChannelMessageByExternalId = this.db.prepare("SELECT data FROM channel_messages WHERE channelId = ? AND externalMessageId = ? LIMIT 1");
    this.stmtSaveChannelDelivery = this.db.prepare(
      "INSERT INTO channel_deliveries (deliveryId, channelId, outboundMessageId, sessionId, runId, status, attemptCount, nextAttemptAt, lastError, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(deliveryId) DO UPDATE SET status = excluded.status, attemptCount = excluded.attemptCount, nextAttemptAt = excluded.nextAttemptAt, lastError = excluded.lastError, data = excluded.data, updatedAt = excluded.updatedAt"
    );
    this.stmtListChannelDeliveries = this.db.prepare("SELECT data FROM channel_deliveries ORDER BY updatedAt DESC, deliveryId ASC");
    this.stmtGetChannelDelivery = this.db.prepare("SELECT data FROM channel_deliveries WHERE deliveryId = ?");
  }

  load(): { manifest: StoreManifest; runs: RuntimeRunReadModel[]; sessions: RuntimeSessionReadModel[]; projects: StoredProject[] } {
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

    const projectRows = this.stmtLoadAllProjects.all() as { data: string }[];
    const projects: StoredProject[] = [];
    for (const row of projectRows) {
      projects.push(ProjectSummarySchema.parse(JSON.parse(row.data)));
    }

    let ledgerState;
    try {
      ledgerState = deriveRuntimeReadModelsFromLedgers(this.listLedgersExcludingEvents());
    } catch (err) {
      const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
      try {
        require("node:fs").writeFileSync("/tmp/ora-lite-load-error.txt", message);
      } catch (_) { /* best effort */ }
      ledgerState = deriveRuntimeReadModelsFromLedgers(this.listSessionLedgers());
    }

    // Ensure nextRunNumber is at least greater than any existing run number
    const maxRunNumber = ledgerState.runs.reduce((max, run) => {
      const match = /^run-(\d+)$/.exec(run.runId);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    const maxSessionNumber = ledgerState.sessions.reduce((max, session) => {
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
      runs: ledgerState.runs,
      sessions: ledgerState.sessions,
      projects,
    };
  }

  ledgerRevision(): string {
    const entries = this.stmtSessionLedgerEntryRevision.get() as { count: number; maxRowid: number };
    const meta = this.stmtSessionLedgerMetaRevision.get() as { meta: string };
    return `${entries.count}:${entries.maxRowid}:${meta.meta}`;
  }

  optimizeStorage() {
    const beforeBytes = this.databaseFileBytes();
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    this.db.exec("VACUUM");
    const afterBytes = this.databaseFileBytes();
    return RuntimeStorageOptimizationResultSchema.parse({
      backend: "sqlite",
      vacuumed: true,
      beforeBytes,
      afterBytes,
    });
  }

  saveManifest(manifest: StoreManifest): void {
    this.stmtSaveManifest.run(
      manifest.schemaVersion,
      manifest.nextRunNumber,
      manifest.nextSessionNumber,
      manifest.nextProjectNumber,
    );
  }

  appendSessionEntries(sessionId: string, entries: RuntimeSessionEntry[], leafEntryId?: string): RuntimeSessionLedger {
    this.appendSessionEntriesFast(sessionId, entries, leafEntryId);
    return this.getSessionLedger(sessionId) ?? RuntimeSessionLedgerSchema.parse({ sessionId, entries: [] });
  }

  appendSessionEntriesFast(sessionId: string, entries: RuntimeSessionEntry[], leafEntryId?: string): void {
    const parsedEntries = entries.map((entry) => RuntimeSessionEntrySchema.parse({
      ...entry,
      sessionId,
    }));
    const appendTransaction = this.db.transaction(() => {
      for (const entry of parsedEntries) {
        this.stmtInsertSessionEntry.run(
          entry.sessionId,
          entry.id,
          entry.parentId ?? null,
          entry.runId ?? null,
          entry.turnIndex,
          entry.seq,
          entry.createdAt,
          entry.type,
          JSON.stringify(entry),
        );
      }
      const nextLeafEntryId = leafEntryId ?? parsedEntries.at(-1)?.id;
      if (nextLeafEntryId) {
        this.stmtSaveSessionLedgerMeta.run(sessionId, nextLeafEntryId);
      }
    });
    appendTransaction();
  }

  getSessionLedger(sessionId: string): RuntimeSessionLedger | undefined {
    const rows = this.stmtLoadSessionEntries.all(sessionId) as { data: string }[];
    if (rows.length === 0) {
      return undefined;
    }
    const entries = rows.map((row) => RuntimeSessionEntrySchema.parse(JSON.parse(row.data)));
    const meta = this.stmtGetSessionLedgerMeta.get(sessionId) as { leafEntryId: string | null } | undefined;
    const entryIds = new Set(entries.map((entry) => entry.id));
    const leafEntryId = meta?.leafEntryId && entryIds.has(meta.leafEntryId)
      ? meta.leafEntryId
      : entries.at(-1)?.id;
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
    const row = this.stmtGetSessionLedgerCursor.get(sessionId, sessionId) as {
      entryCount: number;
      maxSeq: number;
      leafEntryId: string | null;
    } | undefined;
    if (!row || (row.entryCount === 0 && !row.leafEntryId)) {
      return undefined;
    }
    return {
      maxSeq: row.entryCount === 0 ? -1 : row.maxSeq,
      leafEntryId: row.leafEntryId ?? undefined,
    };
  }

  getSessionLedgerLeafEntryId(sessionId: string): string | null {
    const meta = this.stmtGetSessionLedgerMeta.get(sessionId) as { leafEntryId: string | null } | undefined;
    return meta?.leafEntryId ?? null;
  }

  listSessionLedgers(): RuntimeSessionLedger[] {
    const allRows = this.stmtLoadAllSessionEntries.all() as { sessionId: string; data: string }[];
    if (allRows.length === 0) return [];
    return this.buildLedgersFromRows(allRows);
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

  getEventBatchesForRun(sessionId: string, runId: string): RuntimeSessionEntry[] {
    const rows = this.stmtLoadEventBatchesForRun.all(runId, sessionId) as { data: string }[];
    return rows.map((row) => RuntimeSessionEntrySchema.parse(JSON.parse(row.data)));
  }

  private buildLedgersFromRows(allRows: { sessionId: string; data: string }[]): RuntimeSessionLedger[] {
    const rowsBySession = new Map<string, { data: string }[]>();
    for (const row of allRows) {
      const group = rowsBySession.get(row.sessionId);
      if (group) {
        group.push(row);
      } else {
        rowsBySession.set(row.sessionId, [row]);
      }
    }

    const metaRows = this.stmtLoadAllSessionLedgerMetas.all() as { sessionId: string; leafEntryId: string | null }[];
    const metaBySession = new Map<string, string | null>();
    for (const meta of metaRows) {
      metaBySession.set(meta.sessionId, meta.leafEntryId);
    }

    const ledgers: RuntimeSessionLedger[] = [];
    for (const [sessionId, rows] of rowsBySession) {
      const entries = rows.map((row) => RuntimeSessionEntrySchema.parse(JSON.parse(row.data)));
      const meta = metaBySession.get(sessionId);
      const entryIds = new Set(entries.map((entry) => entry.id));
      const leafEntryId = meta && entryIds.has(meta) ? meta : entries.at(-1)?.id;
      ledgers.push(RuntimeSessionLedgerSchema.parse({
        sessionId,
        leafEntryId,
        entries,
      }));
    }
    return ledgers;
  }

  private databaseFileBytes(): number {
    return [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]
      .reduce((total, filePath) => total + fileSize(filePath), 0);
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



  saveChannelConfig(config: StoredChannelConfig): void {
    const parsed = ChannelConfigSchema.parse(config);
    this.stmtSaveChannelConfig.run(
      parsed.channelId,
      parsed.kind,
      parsed.enabled ? 1 : 0,
      JSON.stringify(parsed),
      parsed.createdAt,
      parsed.updatedAt,
    );
  }

  listChannelConfigs(): StoredChannelConfig[] {
    const rows = this.stmtListChannelConfigs.all() as { data: string }[];
    return rows.map((row) => ChannelConfigSchema.parse(JSON.parse(row.data)));
  }

  getChannelConfig(channelId: string): StoredChannelConfig | undefined {
    const row = this.stmtGetChannelConfig.get(channelId) as { data: string } | undefined;
    return row ? ChannelConfigSchema.parse(JSON.parse(row.data)) : undefined;
  }

  deleteChannelConfig(channelId: string): void {
    this.stmtDeleteChannelConfig.run(channelId);
  }

  saveChannelBinding(binding: StoredChannelBinding): void {
    const parsed = ChannelBindingSchema.parse(binding);
    this.stmtSaveChannelBinding.run(
      parsed.bindingId,
      parsed.channelId,
      parsed.externalChatId,
      parsed.externalThreadId ?? null,
      parsed.sessionId,
      parsed.externalUserId ?? null,
      JSON.stringify(parsed),
      parsed.createdAt,
      parsed.updatedAt,
    );
  }

  listChannelBindings(params: { channelId?: string; externalChatId?: string; sessionId?: string; limit?: number } = {}): StoredChannelBinding[] {
    const rows = this.stmtListChannelBindings.all() as { data: string }[];
    return rows
      .map((row) => ChannelBindingSchema.parse(JSON.parse(row.data)))
      .filter((binding) => params.channelId ? binding.channelId === params.channelId : true)
      .filter((binding) => params.externalChatId ? binding.externalChatId === params.externalChatId : true)
      .filter((binding) => params.sessionId ? binding.sessionId === params.sessionId : true)
      .slice(0, params.limit);
  }

  getChannelBindingByExternalKey(channelId: string, externalChatId: string, externalThreadId?: string): StoredChannelBinding | undefined {
    const row = this.stmtGetChannelBindingByExternalKey.get(channelId, externalChatId, externalThreadId ?? null) as { data: string } | undefined;
    return row ? ChannelBindingSchema.parse(JSON.parse(row.data)) : undefined;
  }

  saveChannelMessage(message: StoredChannelMessage): void {
    const parsed = ChannelMessageRecordSchema.parse(message);
    this.stmtSaveChannelMessage.run(
      parsed.messageId,
      parsed.channelId,
      parsed.externalMessageId ?? null,
      parsed.bindingId ?? null,
      parsed.sessionId ?? null,
      parsed.runId ?? null,
      parsed.direction,
      parsed.type,
      JSON.stringify(parsed),
      parsed.createdAt,
    );
  }

  listChannelMessages(params: { channelId?: string; bindingId?: string; sessionId?: string; limit?: number } = {}): StoredChannelMessage[] {
    const rows = this.stmtListChannelMessages.all() as { data: string }[];
    return rows
      .map((row) => ChannelMessageRecordSchema.parse(JSON.parse(row.data)))
      .filter((message) => params.channelId ? message.channelId === params.channelId : true)
      .filter((message) => params.bindingId ? message.bindingId === params.bindingId : true)
      .filter((message) => params.sessionId ? message.sessionId === params.sessionId : true)
      .slice(0, params.limit);
  }

  getChannelMessageByExternalId(channelId: string, externalMessageId: string): StoredChannelMessage | undefined {
    const row = this.stmtGetChannelMessageByExternalId.get(channelId, externalMessageId) as { data: string } | undefined;
    return row ? ChannelMessageRecordSchema.parse(JSON.parse(row.data)) : undefined;
  }

  saveChannelDelivery(delivery: StoredChannelDelivery): void {
    const parsed = ChannelDeliverySchema.parse(delivery);
    this.stmtSaveChannelDelivery.run(
      parsed.deliveryId,
      parsed.channelId,
      parsed.outboundMessageId,
      parsed.sessionId ?? null,
      parsed.runId ?? null,
      parsed.status,
      parsed.attemptCount,
      parsed.nextAttemptAt ?? null,
      parsed.lastError ?? null,
      JSON.stringify(parsed),
      parsed.createdAt,
      parsed.updatedAt,
    );
  }

  listChannelDeliveries(params: { channelId?: string; status?: string; sessionId?: string; runId?: string; limit?: number } = {}): StoredChannelDelivery[] {
    const rows = this.stmtListChannelDeliveries.all() as { data: string }[];
    return rows
      .map((row) => ChannelDeliverySchema.parse(JSON.parse(row.data)))
      .filter((delivery) => params.channelId ? delivery.channelId === params.channelId : true)
      .filter((delivery) => params.status ? delivery.status === params.status : true)
      .filter((delivery) => params.sessionId ? delivery.sessionId === params.sessionId : true)
      .filter((delivery) => params.runId ? delivery.runId === params.runId : true)
      .slice(0, params.limit);
  }

  getChannelDelivery(deliveryId: string): StoredChannelDelivery | undefined {
    const row = this.stmtGetChannelDelivery.get(deliveryId) as { data: string } | undefined;
    return row ? ChannelDeliverySchema.parse(JSON.parse(row.data)) : undefined;
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
