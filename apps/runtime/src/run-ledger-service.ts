import {
  RuntimeSessionEntrySchema,
  type RuntimeSessionEntry,
  type RuntimeSessionEntryType,
  type StateSnapshot,
} from "@cemeworm/shared";
import type { RuntimePersistenceBackend } from "./persistence/types.js";
import { OraRuntimeError } from "./runtime-errors.js";
import type { RunLedgerBranchService } from "./run-ledger-branch-service.js";

export class RunLedgerService {
  constructor(private readonly deps: {
    backend: RuntimePersistenceBackend;
    branchService: RunLedgerBranchService;
  }) {}

  appendRunLedgerEntry(
    snapshot: Pick<StateSnapshot, "runId" | "sessionId" | "config">,
    entry: Omit<RuntimeSessionEntry, "sessionId" | "seq"> & { type: RuntimeSessionEntryType },
    options: { candidateParentId?: string } = {},
  ): RuntimeSessionEntry {
    if (!snapshot.sessionId) {
      throw new OraRuntimeError("Cannot append a run ledger entry without a session id.", -32004, {
        runId: snapshot.runId,
      });
    }
    const candidate = snapshot.config.metadata.branchRole === "candidate";
    const appended = this.appendSessionLedgerEntry(
      snapshot.sessionId,
      entry,
      candidate
        ? { updateLeaf: false, parentId: options.candidateParentId ?? this.candidateLedgerLeaf(snapshot) }
        : undefined,
    );
    if (candidate) {
      this.deps.branchService.recordCandidateLeaf(snapshot.runId, appended.id);
    }
    return appended;
  }

  appendSessionLedgerEntry(
    sessionId: string,
    entry: Omit<RuntimeSessionEntry, "sessionId" | "seq"> & { type: RuntimeSessionEntryType },
    options: { updateLeaf?: boolean; parentId?: string } = {},
  ): RuntimeSessionEntry {
    return this.appendSessionLedgerEntries(sessionId, [entry], options).at(-1)!;
  }

  appendSessionLedgerEntries(
    sessionId: string,
    entries: Array<Omit<RuntimeSessionEntry, "sessionId" | "seq"> & { type: RuntimeSessionEntryType }>,
    options: { updateLeaf?: boolean; parentId?: string } = {},
  ): RuntimeSessionEntry[] {
    const ledger = this.deps.backend.getSessionLedger(sessionId);
    const maxSeq = ledger?.entries.reduce((max, entry) => Math.max(max, entry.seq), -1) ?? -1;
    let parentId = options.parentId ?? ledger?.leafEntryId;
    const parsed = entries.map((entry, index) => {
      const next = RuntimeSessionEntrySchema.parse({
        ...entry,
        sessionId,
        parentId,
        seq: maxSeq + index + 1,
      });
      parentId = next.id;
      return next;
    });
    const nextLeafEntryId = options.updateLeaf === false ? ledger?.leafEntryId : parsed.at(-1)?.id;
    this.deps.backend.appendSessionEntries(sessionId, parsed, nextLeafEntryId);
    return parsed;
  }

  candidateLedgerLeaf(snapshot: Pick<StateSnapshot, "runId" | "sessionId">): string | undefined {
    const ledger = snapshot.sessionId ? this.deps.backend.getSessionLedger(snapshot.sessionId) : undefined;
    return this.deps.branchService.candidateLedgerLeaf(snapshot, ledger);
  }
}
