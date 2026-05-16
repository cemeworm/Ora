import type {
  RuntimeSessionLedger,
  StateSnapshot,
} from "@cemeworm/shared";

const MAX_CANDIDATE_LEAF_CACHE = 256;

export class RunLedgerBranchService {
  private readonly candidateLeafByRun = new Map<string, string>();

  recordCandidateLeaf(runId: string, leafEntryId: string): void {
    if (this.candidateLeafByRun.size >= MAX_CANDIDATE_LEAF_CACHE) {
      const oldestKey = this.candidateLeafByRun.keys().next().value;
      if (oldestKey !== undefined) {
        this.candidateLeafByRun.delete(oldestKey);
      }
    }
    this.candidateLeafByRun.set(runId, leafEntryId);
  }

  cachedCandidateLeaf(runId: string): string | undefined {
    return this.candidateLeafByRun.get(runId);
  }

  clearCandidateLeaf(runId: string): void {
    this.candidateLeafByRun.delete(runId);
  }

  candidateLedgerLeaf(
    snapshot: Pick<StateSnapshot, "runId" | "sessionId">,
    ledger: RuntimeSessionLedger | undefined,
  ): string | undefined {
    const cachedLeaf = this.candidateLeafByRun.get(snapshot.runId);
    if (cachedLeaf && ledger?.entries.find((entry) => entry.id === cachedLeaf)?.type !== "branch.candidate_started") {
      return cachedLeaf;
    }
    if (!snapshot.sessionId) {
      return undefined;
    }
    const leaf = ledger?.entries
      .filter((entry) => entry.runId === snapshot.runId && entry.type !== "branch.candidate_started")
      .sort((a, b) => b.seq - a.seq || b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .at(0)?.id;
    if (leaf) {
      this.candidateLeafByRun.set(snapshot.runId, leaf);
    }
    return leaf;
  }
}
