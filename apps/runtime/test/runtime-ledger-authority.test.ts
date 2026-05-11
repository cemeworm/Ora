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

function sourceSlice(source: string, startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern);
  expect(start, `${startPattern} should exist`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endPattern, start + startPattern.length);
  expect(end, `${endPattern} should exist after ${startPattern}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, end);
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
    const planDecisionSource = readSource("src/plan-decision-service.ts");
    const gateServiceSource = readSource("src/runtime-gate-service.ts");
    const branchServiceSource = readSource("src/run-ledger-branch-service.ts");
    const ledgerServiceSource = readSource("src/run-ledger-service.ts");

    expect(methodBody(source, "resolvePlanDecision")).toContain("this.planDecisionService.resolve");
    expect(methodBody(planDecisionSource, "resolve")).toContain("this.gateService.resolvePlanDecisionGateLifecycle");
    expect(methodBody(planDecisionSource, "resolve")).toContain("createRuntimeGateAppendAdapter");
    expect(gateServiceSource).toContain("export function createRuntimeGateAppendAdapter");
    expect(gateServiceSource).toContain("for (const entry of result.entries)");
    expect(methodBody(planDecisionSource, "resolve")).not.toContain("this.gateService.resolvedEntry");
    expect(methodBody(gateServiceSource, "clarificationOpenedEntry")).toContain('type: "gate.opened"');
    expect(methodBody(gateServiceSource, "approvalOpenedEntry")).toContain('type: "gate.opened"');
    expect(methodBody(gateServiceSource, "planDecisionOpenedEntry")).toContain('type: "gate.opened"');
    expect(gateServiceSource).toContain('type: "gate.resolved"');
    expect(gateServiceSource).toContain("ClarificationGateOpenedParams");
    expect(gateServiceSource).toContain("ApprovalGateOpenedParams");
    expect(gateServiceSource).toContain("PlanDecisionGateOpenedParams");
    expect(gateServiceSource).toContain("RuntimeGateResolvedParams");
    expect(gateServiceSource).toContain("RuntimeGateResolution");
    expect(gateServiceSource).toContain("RuntimeGatePlanDecisionResolutionParams");
    expect(gateServiceSource).toContain("resumeResolutions(params:");
    expect(gateServiceSource).toContain("openSnapshotGates(params: RuntimeGateSnapshotOpenParams)");
    expect(gateServiceSource).toContain("resolveResumeGates(params: RuntimeGateResumeResolutionParams)");
    expect(gateServiceSource).toContain("resolvePlanDecisionGate(params: RuntimeGatePlanDecisionResolutionParams)");
    expect(methodBody(planDecisionSource, "resolve")).toContain('type: "handoff.accepted_plan"');
    expect(methodBody(source, "persistSessionContextState")).toContain('type: "compaction.summary"');
    expect(methodBody(source, "appendSnapshotBusinessFactsToLedger")).toContain("this.appendOpenedGateFactsForSnapshot(snapshot)");
    const gateLedgerServiceSource = readSource("src/runtime-gate-ledger-service.ts");
    expect(source).toContain("private readonly runtimeGateLedgerService = new RuntimeGateLedgerService()");
    expect(methodBody(source, "appendOpenedGateFactsForSnapshot")).toContain("this.runtimeGateLedgerService.appendSnapshotOpenLifecycle");
    expect(methodBody(source, "appendOpenedGateFactsForSnapshot")).toContain("appendAdapter: this.gateLifecycleAppendAdapter(snapshot)");
    expect(gateLedgerServiceSource).toContain("this.gateService.openSnapshotGateLifecycle");
    expect(gateLedgerServiceSource).toContain('gateLifecycle.kind !== "snapshot_open"');
    expect(gateLedgerServiceSource).toContain("params.appendAdapter.appendGateLifecycleResult(gateLifecycle)");
    expect(methodBody(source, "appendSnapshotBusinessFactsToLedger")).not.toContain("this.runtimeGateService.openedEntries");
    expect(methodBody(source, "appendOpenedGateFactsForSnapshot")).not.toContain("this.runtimeGateService.openSnapshotGates");
    expect(methodBody(source, "appendOpenedGateFactsForSnapshot")).not.toContain("this.runtimeGateService.openedEntries");
    expect(methodBody(source, "appendOpenedGateFactsForSnapshot")).not.toContain("this.runtimeGateService.clarificationOpenedEntry");
    expect(methodBody(source, "appendOpenedGateFactsForSnapshot")).not.toContain("this.runtimeGateService.approvalOpenedEntry");
    expect(methodBody(source, "appendOpenedGateFactsForSnapshot")).not.toContain("this.runtimeGateService.planDecisionOpenedEntry");
    expect(methodBody(source, "appendRunSnapshotUpdateToLedger")).toContain("this.appendSnapshotBusinessFactsToLedger(snapshot)");
    expect(methodBody(source, "appendGateResolutionsForResume")).toContain("this.runtimeGateLedgerService.appendResumeResolveLifecycle");
    expect(methodBody(source, "appendGateResolutionsForResume")).toContain("resolutions: gateResolutions");
    expect(methodBody(source, "appendGateResolutionsForResume")).toContain("appendAdapter: this.gateLifecycleAppendAdapter(snapshot)");
    expect(gateLedgerServiceSource).toContain("this.gateService.resolveResumeGateLifecycle");
    expect(gateLedgerServiceSource).toContain('gateLifecycle.kind !== "resume_resolve"');
    expect(methodBody(source, "appendGateResolutionsForResume")).not.toContain("this.runtimeGateService.resolvedEntry");
    expect(methodBody(source, "appendGateResolutionsForResume")).not.toContain("this.runtimeGateService.resolveResumeGates");
    const gateRunAppendAdapterSource = readSource("src/runtime-gate-run-append-adapter.ts");
    expect(methodBody(source, "gateLifecycleAppendAdapter")).toContain("createRuntimeGateRunAppendAdapter");
    expect(methodBody(source, "gateLifecycleAppendAdapter")).toContain("candidateParentId: () => this.candidateLedgerLeaf(snapshot)");
    expect(methodBody(source, "gateLifecycleAppendAdapter")).toContain("appendRunLedgerEntry: (runSnapshot, entry, options) => this.appendRunLedgerEntry(runSnapshot, entry, options)");
    expect(gateServiceSource).not.toContain("export function createRuntimeGateRunAppendAdapter");
    expect(gateRunAppendAdapterSource).toContain("export function createRuntimeGateRunAppendAdapter");
    expect(gateRunAppendAdapterSource).toContain('params.snapshot.config.metadata.branchRole === "candidate"');
    expect(gateRunAppendAdapterSource).toContain("candidateParentId: params.candidateParentId?.()");
    expect(gateRunAppendAdapterSource).toContain("params.appendRunLedgerEntry(params.snapshot, entry, candidateAppendOptions)");
    expect(gateLedgerServiceSource).not.toContain("candidateParentId");
    expect(gateLedgerServiceSource).not.toContain("candidateLedgerLeaf");
    expect(gateServiceSource).not.toContain("candidateParentId");
    expect(gateServiceSource).not.toContain("candidateLedgerLeaf");
    expect(source).toContain('const candidate = snapshot.config.metadata.branchRole === "candidate";');
    expect(methodBody(source, "appendRuntimeEventBatchToLedger")).toContain("this.appendRunLedgerEntry(snapshot");
    expect(methodBody(source, "appendRunSnapshotUpdateToLedger")).toContain("candidate ? this.candidateLedgerLeaf(snapshot) : undefined");
    expect(ledgerServiceSource).toContain("parentId: options.candidateParentId ?? this.candidateLedgerLeaf(snapshot)");
    expect(source).not.toContain("branchCandidateLeafByRun");
    expect(source).toContain("return this.runLedgerService.appendRunLedgerEntry(snapshot, entry, options)");
    expect(source).toContain("return this.runLedgerService.appendSessionLedgerEntries(sessionId, entries, options)");
    expect(methodBody(source, "candidateLedgerLeaf")).toContain("this.runLedgerService.candidateLedgerLeaf(snapshot)");
    expect(ledgerServiceSource).toContain("this.deps.branchService.recordCandidateLeaf(snapshot.runId, appended.id)");
    expect(ledgerServiceSource).toContain("this.deps.backend.appendSessionEntries(sessionId, parsed, nextLeafEntryId)");
    expect(branchServiceSource).toContain('entry.type !== "branch.candidate_started"');
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
    const startRunSource = sourceSlice(source, "async startRun(params", "async startStreamingRun(params");
    const startStreamingRunSource = sourceSlice(source, "async startStreamingRun(params", "private approvedFileWriteResumeDeps");

    expect(source).toContain("private readonly runStartService: RunStartService");
    expect(startRunSource).toContain("this.runStartService.prepare");
    expect(startStreamingRunSource).toContain("this.runStartService.prepare");
    expect(methodBody(source, "acceptedPlanHandoffForNextImplementationRun")).not.toContain('type: "handoff.accepted_plan"');
    expect(methodBody(source, "consumeAcceptedPlanHandoffForStartedRun")).toContain('type: "handoff.accepted_plan"');
    expect(startRunSource).toContain("this.appendRunStartedToLedger");
    expect(startRunSource).toContain("this.consumeAcceptedPlanHandoffForStartedRun");
  });

  it("keeps resume preparation in RunResumeService while resolution and execution stay in LocalRunStore", () => {
    const source = readSource("src/run-store.ts");
    const resumeServiceSource = readSource("src/run-resume-service.ts");
    const resumeRun = methodBody(source, "resumeRun");
    const resumeStreamingRun = sourceSlice(source, "async resumeStreamingRun", "async startRunWithKernel");

    expect(source).toContain("private readonly runResumeService: RunResumeService");
    expect(resumeRun).toContain("this.runResumeService.prepare");
    expect(resumeStreamingRun).toContain("this.runResumeService.prepare");
    expect(resumeRun).toContain("this.assertResumeStrategyBoundary");
    expect(resumeStreamingRun).toContain("this.assertResumeStrategyBoundary");
    expect(resumeServiceSource).toContain("RunResumeParamsSchema.parse");
    expect(resumeServiceSource).toContain("this.deps.getRunOrThrow");
    expect(resumeServiceSource).toContain("parseResumePatch");
    expect(resumeServiceSource).toContain("this.gateService.resumeResolutions");
    expect(resumeServiceSource).toContain("approvedActionsForResume");
    expect(resumeServiceSource).toContain("hasKernelResumeWork");
    expect(resumeServiceSource).toContain("executeNonKernelResumeStrategy(params:");
    expect(resumeRun).toContain("executeNonKernelResumeStrategy({");
    expect(resumeRun).not.toContain("beginNonKernelResume");
    expect(resumeRun).not.toContain("completeNonKernelResumeMutation");
    expect(resumeRun).not.toContain("nonKernelResumeNeedsInput");
    expect(resumeServiceSource).not.toContain("appendGateResolutionsForResume");
    expect(resumeServiceSource).not.toContain("executeTracedKernelResume");
    expect(resumeServiceSource).toContain("executeApprovedToolContinuationStrategy(params:");
    expect(resumeServiceSource).toContain("completeApprovedToolContinuation(");
    expect(resumeServiceSource).not.toContain("appendRunSnapshotUpdateToLedger");
    const resumeFinalizationServiceSource = readSource("src/run-resume-finalization-service.ts");
    expect(source).toContain("private readonly runResumeFinalizationService: RunResumeFinalizationService");
    expect(resumeFinalizationServiceSource).toContain("persistTerminal(params:");
    expect(resumeFinalizationServiceSource).toContain("persistInterrupted(params:");
    expect(resumeFinalizationServiceSource).toContain("persistStreamingTerminal(params:");
    expect(resumeFinalizationServiceSource).toContain("persistStreamingFailure(params:");
    expect(resumeFinalizationServiceSource).toContain("this.deps.withResumeResolutionEvents");
    expect(resumeFinalizationServiceSource).toContain("this.deps.appendRunSnapshotUpdateToLedger");
    expect(resumeFinalizationServiceSource).toContain("this.deps.persistRunWithGeneratedTitle(projected)");
    expect(resumeFinalizationServiceSource).toContain("this.deps.persistRun(projected)");
    expect(resumeFinalizationServiceSource).toContain("params.stream.replaceSnapshot(projected)");
    expect(resumeFinalizationServiceSource).toContain("params.stream.markLedgerSynced()");
    expect(resumeFinalizationServiceSource).toContain("params.stream.publish([], liveSnapshot)");
    expect(source).not.toContain("from \"./run-kernel-lifecycle.js\"");
    expect(source).toContain("private readonly runKernelExecutionService: RunKernelExecutionService");
    expect(source).toContain("this.runKernelExecutionService = new RunKernelExecutionService({");
    expect(resumeRun).toContain("this.appendGateResolutionsForResume");
    expect(resumeRun).toContain("executeApprovedToolContinuationStrategy({");
    expect(resumeRun).toContain("this.runKernelExecutionService.executeKernelResumeWork");
    expect(resumeRun).toContain("this.runResumeFinalizationService.persistTerminal");
    expect(resumeRun).toContain("this.runResumeFinalizationService.persistInterrupted");
    expect(resumeStreamingRun).toContain("this.appendGateResolutionsForResume");
    expect(resumeStreamingRun).toContain("executeApprovedToolContinuationStrategy({");
    expect(resumeStreamingRun).toContain("this.runKernelExecutionService.executeKernelResumeWork");
    expect(resumeStreamingRun).toContain("this.runResumeFinalizationService.persistStreamingTerminal");
    expect(resumeStreamingRun).toContain("this.runResumeFinalizationService.persistStreamingFailure");
  });

  it("keeps RunResumeStrategy wired as a read-only LocalRunStore boundary guard", () => {
    const source = readSource("src/run-store.ts");
    const strategyGuard = sourceSlice(source, "private assertResumeStrategyBoundary", "async resumeStreamingRun");

    expect(source).toContain("type RunResumeStrategy");
    expect(strategyGuard).toContain("strategy: RunResumeStrategy");
    expect(strategyGuard).toContain("approvedToolContinuationActions");
    expect(strategyGuard).toContain("params.hasKernelWork ? \"kernel\" : \"non_kernel\"");
    expect(strategyGuard).not.toContain("completeApprovedToolContinuation");
    expect(strategyGuard).not.toContain("executeTracedKernelResume");
    expect(strategyGuard).not.toContain("appendGateResolutionsForResume");
    expect(strategyGuard).not.toContain("appendRunSnapshotUpdateToLedger");
    expect(strategyGuard).not.toContain("persistRunWithGeneratedTitle");
  });

  it("keeps narrow lifecycle facades away from run-owned lifecycle side effects", () => {
    const source = readSource("src/run-store.ts");
    const lifecycleServicePath = path.join(runtimeRoot, "src/run-lifecycle-service.ts");
    const lifecycleServiceSource = fs.existsSync(lifecycleServicePath)
      ? fs.readFileSync(lifecycleServicePath, "utf8")
      : "";
    const startRun = sourceSlice(source, "async startRun(params", "async startStreamingRun(params");
    const startStreamingRun = sourceSlice(source, "async startStreamingRun(params", "private approvedFileWriteResumeDeps");
    const resumeStreamingRun = sourceSlice(source, "async resumeStreamingRun", "async startRunWithKernel");
    const resumeRun = methodBody(source, "resumeRun");

    for (const riskyOperation of [
      "completeApprovedToolContinuation",
      "appendRunSnapshotUpdateToLedger",
      "appendRuntimeEventBatchToLedger",
      "appendRunLedgerEntry",
      "persistRunWithGeneratedTitle",
    ]) {
      expect(lifecycleServiceSource).not.toContain(riskyOperation);
    }

    const streamingServiceSource = readSource("src/run-streaming-service.ts");
    const persistenceServiceSource = readSource("src/run-persistence-service.ts");
    expect(source).not.toContain("activeStreamingAbortControllers");
    expect(streamingServiceSource).toContain("private readonly activeAbortControllers = new Map<string, AbortController>");
    expect(streamingServiceSource).toContain("createAbortController(runId: string): AbortController");
    expect(streamingServiceSource).toContain("abort(runId: string, reason?: string): void");
    expect(methodBody(source, "persistRun")).toContain("this.runPersistenceService.persistRun(snapshot)");
    expect(methodBody(source, "persistRunWithGeneratedTitle")).toContain("this.runPersistenceService.persistRunWithGeneratedTitle(snapshot)");
    expect(persistenceServiceSource).toContain("generateSessionTitle(");
    expect(persistenceServiceSource).toContain("this.deps.scheduleLongTermMemoryUpdate(snapshot)");
    expect(persistenceServiceSource).toContain("this.deps.queueSelfIterationAfterTerminalRun(snapshot)");
    expect(source).toContain("private readonly runStreamingService: RunStreamingService");
    const kernelExecutionServiceSource = readSource("src/run-kernel-execution-service.ts");
    expect(kernelExecutionServiceSource).toContain("executeTracedKernelRun(params)");
    expect(kernelExecutionServiceSource).toContain("executeTracedKernelResume(params)");
    expect(kernelExecutionServiceSource).toContain("executePreparedRun(params:");
    expect(kernelExecutionServiceSource).toContain("executePreparedResume(params:");
    expect(kernelExecutionServiceSource).toContain("continueAfterApprovedTool(params:");
    expect(kernelExecutionServiceSource).toContain("executeKernelResumeWork(params:");
    expect(kernelExecutionServiceSource).toContain("modeSpecToPatternDefinition(modeSpec)");
    expect(kernelExecutionServiceSource).toContain("resumedInputWithClarifications");
    expect(kernelExecutionServiceSource).toContain("runtimeConversationToModelMessages(params.continuationSnapshot.conversation)");
    expect(kernelExecutionServiceSource).toContain("runtimeConversationToModelMessages(params.snapshot.conversation)");
    expect(kernelExecutionServiceSource).toContain("customAgentOverlay: this.deps.customAgentOverlay(config.customAgentId)");
    expect(startRun).toContain("this.runKernelExecutionService.executePreparedRun");
    expect(startRun).toContain("this.appendRuntimeEventBatchToLedger");
    expect(startRun).toContain("this.appendAssistantMessageToLedger");
    expect(startRun).toContain("this.persistRunWithGeneratedTitle");
    expect(startStreamingRun).toContain("this.runStreamingService.createAbortController");
    expect(startStreamingRun).toContain("this.runStreamingService.deleteAbortController");
    expect(startStreamingRun).toContain("this.runKernelExecutionService.executePreparedRun");
    expect(startStreamingRun).toContain("this.runStreamingService.createSession");
    expect(startStreamingRun).toContain("this.appendAssistantMessageToLedger");
    expect(startStreamingRun).toContain("this.persistRunWithGeneratedTitle");
    expect(resumeStreamingRun).toContain("this.runStreamingService.createAbortController");
    expect(resumeStreamingRun).toContain("this.runStreamingService.deleteAbortController");
    expect(resumeStreamingRun).toContain("executeApprovedToolContinuationStrategy({");
    expect(resumeStreamingRun).toContain("this.runKernelExecutionService.continueAfterApprovedTool");
    expect(resumeStreamingRun).toContain("this.runStreamingService.createSession");
    expect(resumeStreamingRun).toContain("this.runResumeFinalizationService.persistStreamingTerminal");
    expect(resumeStreamingRun).toContain("this.runResumeFinalizationService.persistStreamingFailure");
    expect(resumeStreamingRun).not.toContain("this.appendRunSnapshotUpdateToLedger");
    expect(resumeStreamingRun).not.toContain("this.persistRunWithGeneratedTitle");
    expect(resumeRun).toContain("executeApprovedToolContinuationStrategy({");
    expect(resumeRun).toContain("this.runKernelExecutionService.continueAfterApprovedTool");
    expect(resumeRun).toContain("this.runKernelExecutionService.executeKernelResumeWork");
    expect(resumeRun).toContain("this.runResumeFinalizationService.persistTerminal");
    expect(resumeRun).toContain("this.runResumeFinalizationService.persistInterrupted");
  });

  it("persists streaming resume failures through ledger snapshot updates", () => {
    const source = readSource("src/run-store.ts");
    const resumeStreamingRun = source.slice(
      source.indexOf("async resumeStreamingRun"),
      source.indexOf("async startRunWithKernel"),
    );

    const resumeFinalizationServiceSource = readSource("src/run-resume-finalization-service.ts");
    expect(resumeStreamingRun).toContain("this.runResumeFinalizationService.persistStreamingFailure");
    expect(resumeStreamingRun).not.toContain("appendRunSnapshotUpdateToLedger");
    expect(resumeFinalizationServiceSource).toContain("persistStreamingFailure(params:");
    expect(resumeFinalizationServiceSource).toContain("this.deps.appendRunSnapshotUpdateToLedger");
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
    const streamingServiceSource = readSource("src/run-streaming-service.ts");

    expect(source).toContain("appendRuntimeEventBatchToLedger: (snapshot, events, status) =>");
    expect(startStreamingRun).toContain("this.runStreamingService.createSession");
    expect(resumeStreamingRun).toContain("this.runStreamingService.createSession");
    expect(streamingServiceSource).toContain("this.deps.appendRuntimeEventBatchToLedger");
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

  it("derives ledger run attention from gate projection, not from continuation frames", () => {
    const ledgerSource = readSource("../../packages/shared/src/runtime-ledger.ts");
    const fn = sourceSlice(ledgerSource, "export function deriveLedgerRunAttention", "function hasIncompleteResolvedHumanGateResume");

    // Must read gate status from ledger gate projection
    expect(fn).toContain("run.gates.filter");
    expect(fn).toContain('gate.kind === "clarification"');
    expect(fn).toContain('gate.kind === "approval"');
    expect(fn).toContain('gate.kind === "plan_decision"');

    // Must NOT read from continuation frames for gate decisions
    expect(fn).not.toContain("continuation");
    expect(fn).not.toContain("frame");
  });

  it("marks ledger-derived snapshots with snapshotSource ledger for terminal/hydrate consumers", () => {
    const ledgerSource = readSource("../../packages/shared/src/runtime-ledger.ts");
    const fn = sourceSlice(ledgerSource, "function runtimeRunProjectionToSnapshot", "function reconcileSnapshotRuntimeFields");

    // Both paths (with and without finalSnapshot) must mark snapshotSource as "ledger"
    const occurrences = [...fn.matchAll(/snapshotSource:\s*"ledger"/g)];
    expect(occurrences.length, "runtimeRunProjectionToSnapshot should mark both paths with snapshotSource: ledger").toBeGreaterThanOrEqual(2);
  });

  it("marks live snapshot factories with snapshotSource live", () => {
    const snapshotsSource = readSource("src/run-snapshots.ts");

    expect(snapshotsSource).toContain('snapshotSource: "live"');
  });

  it("propagates snapshotSource through toFlowRunDetail", () => {
    const projectionsSource = readSource("src/run-projections.ts");
    const toFlowRunDetail = sourceSlice(projectionsSource, "export function toFlowRunDetail", "export function toRunSummary");

    expect(toFlowRunDetail).toContain("snapshotSource:");
  });

  it("keeps desktop tool ledger reading from both toolCalls and ledger-backed toolResults", () => {
    const trailVmSource = readSource("../../apps/desktop/src/lib/trailViewModel.ts");
    expect(trailVmSource).toContain("fromToolCalls");
    expect(trailVmSource).toContain("fromToolResults");
    expect(trailVmSource).toContain("snapshot.toolResults");
  });
});
