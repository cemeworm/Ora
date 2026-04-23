import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  WRITES_IDX_MAP,
  copyCheckpoint,
  getCheckpointId
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

const CREATE_CHECKPOINTS_TABLE = `
CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  checkpoint_type TEXT NOT NULL,
  checkpoint_data BLOB NOT NULL,
  metadata_type TEXT NOT NULL,
  metadata_data BLOB NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
`;

const CREATE_WRITES_TABLE = `
CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  write_idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  value_type TEXT NOT NULL,
  value_data BLOB NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx)
);
`;

interface StoredCheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint_type: string;
  checkpoint_data: Buffer;
  metadata_type: string;
  metadata_data: Buffer;
}

interface StoredWriteRow {
  task_id: string;
  write_idx: number;
  channel: string;
  value_type: string;
  value_data: Buffer;
}

function toBuffer(data: Uint8Array): Buffer {
  return Buffer.from(data);
}

async function serializeTyped(
  serde: BaseCheckpointSaver["serde"],
  value: unknown
): Promise<[string, Buffer]> {
  const [type, data] = await serde.dumpsTyped(value);
  return [type, toBuffer(data)];
}

export interface OraSqliteCheckpointerOptions {
  dbPath?: string;
}

export class OraSqliteCheckpointer extends BaseCheckpointSaver {
  private readonly db: Database.Database;

  private readonly stmtGetCheckpoint: Database.Statement;
  private readonly stmtListCheckpoints: Database.Statement;
  private readonly stmtListAllCheckpoints: Database.Statement;
  private readonly stmtUpsertCheckpoint: Database.Statement;
  private readonly stmtDeleteThreadCheckpoints: Database.Statement;
  private readonly stmtListWrites: Database.Statement;
  private readonly stmtUpsertWrite: Database.Statement;
  private readonly stmtInsertWriteIgnore: Database.Statement;
  private readonly stmtDeleteThreadWrites: Database.Statement;

  constructor(options: OraSqliteCheckpointerOptions = {}) {
    super();

    const dbPath = options.dbPath ?? process.env.ORA_LANGGRAPH_CHECKPOINT_DB ?? path.join(
      process.cwd(),
      ".ora",
      "langgraph-checkpoints.db"
    );

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(CREATE_CHECKPOINTS_TABLE);
    this.db.exec(CREATE_WRITES_TABLE);

    this.stmtGetCheckpoint = this.db.prepare(
      `
      SELECT
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        parent_checkpoint_id,
        checkpoint_type,
        checkpoint_data,
        metadata_type,
        metadata_data
      FROM langgraph_checkpoints
      WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      `
    );
    this.stmtListCheckpoints = this.db.prepare(
      `
      SELECT
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        parent_checkpoint_id,
        checkpoint_type,
        checkpoint_data,
        metadata_type,
        metadata_data
      FROM langgraph_checkpoints
      WHERE thread_id = ? AND checkpoint_ns = ?
      ORDER BY checkpoint_id DESC
      `
    );
    this.stmtListAllCheckpoints = this.db.prepare(
      `
      SELECT
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        parent_checkpoint_id,
        checkpoint_type,
        checkpoint_data,
        metadata_type,
        metadata_data
      FROM langgraph_checkpoints
      WHERE thread_id = ?
      ORDER BY checkpoint_ns ASC, checkpoint_id DESC
      `
    );
    this.stmtUpsertCheckpoint = this.db.prepare(
      `
      INSERT INTO langgraph_checkpoints (
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        parent_checkpoint_id,
        checkpoint_type,
        checkpoint_data,
        metadata_type,
        metadata_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
        parent_checkpoint_id = excluded.parent_checkpoint_id,
        checkpoint_type = excluded.checkpoint_type,
        checkpoint_data = excluded.checkpoint_data,
        metadata_type = excluded.metadata_type,
        metadata_data = excluded.metadata_data
      `
    );
    this.stmtDeleteThreadCheckpoints = this.db.prepare(
      `DELETE FROM langgraph_checkpoints WHERE thread_id = ?`
    );
    this.stmtListWrites = this.db.prepare(
      `
      SELECT task_id, write_idx, channel, value_type, value_data
      FROM langgraph_checkpoint_writes
      WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      ORDER BY task_id ASC, write_idx ASC
      `
    );
    this.stmtUpsertWrite = this.db.prepare(
      `
      INSERT INTO langgraph_checkpoint_writes (
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        task_id,
        write_idx,
        channel,
        value_type,
        value_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx) DO UPDATE SET
        channel = excluded.channel,
        value_type = excluded.value_type,
        value_data = excluded.value_data
      `
    );
    this.stmtInsertWriteIgnore = this.db.prepare(
      `
      INSERT OR IGNORE INTO langgraph_checkpoint_writes (
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        task_id,
        write_idx,
        channel,
        value_type,
        value_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    );
    this.stmtDeleteThreadWrites = this.db.prepare(
      `DELETE FROM langgraph_checkpoint_writes WHERE thread_id = ?`
    );
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const checkpointId = getCheckpointId(config);

    if (threadId === undefined) {
      return undefined;
    }

    const checkpointRow = checkpointId
      ? (this.stmtGetCheckpoint.get(threadId, checkpointNs, checkpointId) as StoredCheckpointRow | undefined)
      : (this.stmtListCheckpoints.get(threadId, checkpointNs) as StoredCheckpointRow | undefined);

    if (!checkpointRow) {
      return undefined;
    }

    return this.rowToTuple(checkpointRow);
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const threadIds = config.configurable?.thread_id ? [config.configurable.thread_id] : this.allThreadIds();
    const checkpointNs = config.configurable?.checkpoint_ns;
    const checkpointId = config.configurable?.checkpoint_id;
    let remaining = options?.limit;

    for (const threadId of threadIds) {
      const rows = checkpointNs === undefined
        ? (this.stmtListAllCheckpoints.all(threadId) as StoredCheckpointRow[])
        : (this.stmtListCheckpoints.all(threadId, checkpointNs) as StoredCheckpointRow[]);
      for (const row of rows) {
        if (checkpointId !== undefined && row.checkpoint_id !== checkpointId) {
          continue;
        }
        if (options?.before?.configurable?.checkpoint_id !== undefined) {
          const beforeId = options.before.configurable.checkpoint_id;
          if (row.checkpoint_id >= beforeId) {
            continue;
          }
        }

        const tuple = await this.rowToTuple(
          row
        );

        if (options?.filter && !this.matchesFilter(tuple.metadata!, options.filter)) {
          continue;
        }

        if (remaining !== undefined) {
          if (remaining <= 0) {
            return;
          }
          remaining -= 1;
        }

        yield tuple;
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, string | number>
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    if (threadId === undefined) {
      throw new Error(
        'Failed to put checkpoint. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.'
      );
    }

    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const parentCheckpointId = getCheckpointId(config) || null;
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const [checkpointType, checkpointData] = await serializeTyped(this.serde, preparedCheckpoint);
    const [metadataType, metadataData] = await serializeTyped(this.serde, metadata);

    this.stmtUpsertCheckpoint.run(
      threadId,
      checkpointNs,
      preparedCheckpoint.id,
      parentCheckpointId,
      checkpointType,
      checkpointData,
      metadataType,
      metadataData
    );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: preparedCheckpoint.id
      }
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";

    if (threadId === undefined) {
      throw new Error(
        'Failed to put writes. The passed RunnableConfig is missing a required "thread_id" field in its "configurable" property.'
      );
    }

    if (checkpointId === undefined) {
      throw new Error(
        'Failed to put writes. The passed RunnableConfig is missing a required "checkpoint_id" field in its "configurable" property.'
      );
    }

    for (let idx = 0; idx < writes.length; idx += 1) {
      const [channel, value] = writes[idx]!;
      const writeIdx = WRITES_IDX_MAP[channel] ?? idx;
      const [valueType, valueData] = await serializeTyped(this.serde, value);

      if (writeIdx < 0) {
        this.stmtUpsertWrite.run(
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          writeIdx,
          channel,
          valueType,
          valueData
        );
      } else {
        this.stmtInsertWriteIgnore.run(
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          writeIdx,
          channel,
          valueType,
          valueData
        );
      }
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.stmtDeleteThreadWrites.run(threadId);
    this.stmtDeleteThreadCheckpoints.run(threadId);
  }

  close(): void {
    this.db.close();
  }

  private async rowToTuple(row: StoredCheckpointRow): Promise<CheckpointTuple> {
    const checkpoint = (await this.serde.loadsTyped(row.checkpoint_type, row.checkpoint_data)) as Checkpoint;
    const metadata = (await this.serde.loadsTyped(row.metadata_type, row.metadata_data)) as CheckpointMetadata;
    const writesRows = this.stmtListWrites.all(row.thread_id, row.checkpoint_ns, row.checkpoint_id) as StoredWriteRow[];
    const pendingWrites = await Promise.all(
      writesRows.map(async (write) => [
        write.task_id,
        write.channel,
        await this.serde.loadsTyped(write.value_type, write.value_data)
      ] as const)
    );

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.checkpoint_id
        }
      },
      checkpoint,
      metadata,
      pendingWrites: pendingWrites.map((entry) => [entry[0], entry[1], entry[2]]) as CheckpointTuple["pendingWrites"]
    };

    if (row.parent_checkpoint_id !== null) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.parent_checkpoint_id
        }
      };
    }

    return tuple;
  }

  private allThreadIds(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT thread_id FROM langgraph_checkpoints ORDER BY thread_id ASC")
      .all() as { thread_id: string }[];
    return rows.map((row) => row.thread_id);
  }

  private matchesFilter(metadata: CheckpointMetadata, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([key, value]) => metadata[key as keyof CheckpointMetadata] === value);
  }
}

export function createOraSqliteCheckpointer(
  options: OraSqliteCheckpointerOptions = {}
): OraSqliteCheckpointer {
  return new OraSqliteCheckpointer(options);
}
