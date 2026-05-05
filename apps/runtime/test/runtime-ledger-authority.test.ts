import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(runtimeRoot, "src");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(runtimeRoot, relativePath), "utf8");
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

function methodBody(source: string, methodName: string): string {
  const markerMatch = new RegExp(`\\n\\s+(?:private\\s+)?(?:async\\s+)?${methodName}\\s*\\(`).exec(source);
  const marker = markerMatch?.index ?? -1;
  expect(marker, `${methodName} should exist`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", marker);
  expect(open, `${methodName} should have a body`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }
  }
  throw new Error(`Could not find body for ${methodName}.`);
}

describe("runtime ledger authority guards", () => {
  it("does not reintroduce persistent run/session snapshot authority outside persistence adapters", () => {
    const offenders = sourceFiles(sourceRoot)
      .filter((file) => !file.includes(`${path.sep}persistence${path.sep}`))
      .filter((file) => !file.endsWith(`${path.sep}evaluation-store.ts`))
      .flatMap((file) => {
        const source = fs.readFileSync(file, "utf8");
        return [...source.matchAll(/\bbackend\.save(?:Run|Session)\s*\(|\bsave(?:Run|Session)\s*\(/g)]
          .map((match) => `${path.relative(runtimeRoot, file)}:${match.index ?? 0}`);
      });

    expect(offenders).toEqual([]);
  });

  it("does not expose persistent run/session snapshot writes on runtime persistence backends", () => {
    const typeSource = readSource("src/persistence/types.ts");
    const jsonSource = readSource("src/persistence/json-file-backend.ts");
    const sqliteSource = readSource("src/persistence/sqlite-backend.ts");

    for (const source of [typeSource, jsonSource, sqliteSource]) {
      expect(source).not.toContain("saveRun(");
      expect(source).not.toContain("saveSession(");
    }
    expect(jsonSource).not.toContain("mergeStoredRuns");
    expect(jsonSource).not.toContain("mergeStoredSessions");
    expect(sqliteSource).not.toContain("mergeStoredRuns");
    expect(sqliteSource).not.toContain("mergeStoredSessions");
    expect(sqliteSource).not.toContain("stmtLoadAllRuns");
    expect(sqliteSource).not.toContain("stmtLoadAllSessions");
  });

  it("names in-memory session/run compatibility shapes as read models, not stored authority", () => {
    const typeSource = readSource("src/persistence/types.ts");
    const runStoreSource = readSource("src/run-store.ts");
    const projectionSource = readSource("src/persistence/session-ledger-projections.ts");

    for (const source of [typeSource, runStoreSource, projectionSource]) {
      expect(source).not.toContain("StoredRun");
      expect(source).not.toContain("StoredSession");
    }
    expect(typeSource).toContain("export type RuntimeRunReadModel = StateSnapshot");
    expect(typeSource).toContain("export type RuntimeSessionReadModel = SessionSummary");
    expect(typeSource).toContain("not persistence");
    expect(runStoreSource).toContain("new Map<string, RuntimeRunReadModel>");
    expect(runStoreSource).toContain("new Map<string, RuntimeSessionReadModel>");
    expect(projectionSource).toContain("deriveRuntimeReadModelsFromLedgers");
  });

  it("keeps gate, handoff, compaction, and branch business facts on ledger entry paths", () => {
    const source = readSource("src/run-store.ts");

    expect(methodBody(source, "resolvePlanDecision")).toContain('type: "gate.resolved"');
    expect(methodBody(source, "resolvePlanDecision")).toContain('type: "handoff.accepted_plan"');
    expect(methodBody(source, "persistSessionContextState")).toContain('type: "compaction.summary"');
    expect(methodBody(source, "appendSnapshotBusinessFactsToLedger")).toContain('type: "gate.opened"');
    expect(methodBody(source, "appendGateResolutionsForResume")).toContain('type: "gate.resolved"');
    expect(methodBody(source, "createAndRunSessionBranchGroup")).toContain('"branch.created"');
    expect(methodBody(source, "createAndRunSessionBranchGroup")).toContain('"branch.candidate_started"');
    expect(methodBody(source, "adoptSessionBranchGroup")).toContain('type: "branch.adopted"');
    expect(methodBody(source, "dismissSessionBranchGroup")).toContain('"branch.dismissed"');
  });

  it("keeps run state, stream, and replay reads pointed at ledger projections", () => {
    const source = readSource("src/run-store.ts");

    expect(methodBody(source, "getRunState")).toContain("ledgerRebasedRunSnapshot");
    expect(methodBody(source, "streamRun")).toContain("ledgerRebasedRunSnapshot");
    expect(methodBody(source, "replayRun")).toContain("ledgerProjectedRunSnapshot");
    expect(methodBody(source, "replayRunFromSnapshot")).toContain("appendRunSnapshotUpdateToLedger");
  });

  it("consumes accepted-plan handoffs only after the consuming run has started", () => {
    const source = readSource("src/run-store.ts");

    expect(methodBody(source, "acceptedPlanHandoffForNextImplementationRun")).not.toContain('type: "handoff.accepted_plan"');
    expect(methodBody(source, "consumeAcceptedPlanHandoffForStartedRun")).toContain('type: "handoff.accepted_plan"');
    expect(methodBody(source, "startRun")).toContain("this.appendRunStartedToLedger");
    expect(methodBody(source, "startRun")).toContain("this.consumeAcceptedPlanHandoffForStartedRun");
  });

  it("persists streaming resume failures through ledger snapshot updates", () => {
    const source = readSource("src/run-store.ts");
    const resumeStreamingRun = source.slice(
      source.indexOf("async resumeStreamingRun"),
      source.indexOf("async startRunWithKernel"),
    );

    expect(resumeStreamingRun.match(/appendRunSnapshotUpdateToLedger/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(resumeStreamingRun).toContain("createStreamingFailure");
  });

  it("keeps active streaming flushes on ledger projection paths", () => {
    const source = readSource("src/run-store.ts");
    const startStreamingRun = source.slice(
      source.indexOf("async startStreamingRun"),
      source.indexOf("private approvedFileWriteResumeDeps"),
    );
    const resumeStreamingRun = source.slice(
      source.indexOf("async resumeStreamingRun"),
      source.indexOf("async startRunWithKernel"),
    );
    const appendRuntimeEventBatchToLedger = methodBody(source, "appendRuntimeEventBatchToLedger");

    expect(startStreamingRun).toContain("liveSnapshot = this.appendRuntimeEventBatchToLedger");
    expect(resumeStreamingRun).toContain("liveSnapshot = this.appendRuntimeEventBatchToLedger");
    expect(appendRuntimeEventBatchToLedger).toContain("ledgerSnapshotOrFallback");
    expect(appendRuntimeEventBatchToLedger).toContain("this.runs.set(projected.runId, projected)");
  });

  it("rebases active running reads on ledger projection plus unflushed event tails", () => {
    const source = readSource("src/run-store.ts");
    const ledgerRebasedRunSnapshot = methodBody(source, "ledgerRebasedRunSnapshot");
    const rebaseActiveRunSnapshot = methodBody(source, "rebaseActiveRunSnapshot");
    const getRunOrThrow = methodBody(source, "getRunOrThrow");
    const cancelledSnapshot = methodBody(source, "cancelledSnapshot");

    expect(ledgerRebasedRunSnapshot).toContain("this.ledgerProjectedRunSnapshot");
    expect(ledgerRebasedRunSnapshot).toContain("this.ledgerProjectedRunSnapshotForCachedRun");
    expect(ledgerRebasedRunSnapshot).toContain("rebaseActiveRunSnapshot");
    expect(ledgerRebasedRunSnapshot).not.toContain("return cached");
    expect(rebaseActiveRunSnapshot).toContain("event.seq > lastLedgerSeq");
    expect(rebaseActiveRunSnapshot).toContain("applyStreamingRunEvent");
    expect(getRunOrThrow).toContain("ledgerProjectedRunSnapshotForCachedRun");
    expect(getRunOrThrow).toContain("rebaseActiveRunSnapshot");
    expect(cancelledSnapshot).toContain("ledgerRebasedRunSnapshot");
  });
});
