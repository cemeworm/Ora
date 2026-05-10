import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtInModeDriverPaths = [
  "src/patterns/agent-teams-driver.ts",
  "src/patterns/generator-verifier-driver.ts",
  "src/patterns/message-bus-driver.ts",
  "src/patterns/orchestrator-subagent-driver.ts",
  "src/patterns/shared-state-driver.ts",
];

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(runtimeRoot, relativePath), "utf8");
}

function kernelRunnerSource(): string {
  return readSource("src/harness/runtime-kernel-runner.ts");
}

function kernelRunnerDepsSource(): string {
  const source = readSource("src/harness/runtime-kernel.ts");
  const depsStart = source.indexOf("  const snapshot = await new KernelRunner(createKernelRunnerDeps({");
  const depsEnd = source.indexOf(
    "\n  })).run();",
    depsStart,
  );

  expect(depsStart).toBeGreaterThanOrEqual(0);
  expect(depsEnd).toBeGreaterThan(depsStart);
  return source.slice(depsStart, depsEnd);
}

describe("runtime kernel architecture guards", () => {
  it("routes node runtime loop dependencies through KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");

    expect(source).toContain("class KernelRuntimeContext");
    expect(source).toContain("setNodeLoopDepsFactory(factory: () => RunNodeRuntimeLoopDeps)");
    expect(source).toContain("const kernelRuntimeContext = new KernelRuntimeContext");
    expect(source).toContain("runNodeRuntimeLoop(params, kernelRuntimeContext.nodeLoopDeps)");
  });

  it("keeps event timeline and plan-list projection owned by KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");
    const runnerSource = kernelRunnerSource();

    expect(source).toContain("private readonly eventsValue: OraEventEnvelope[] = []");
    expect(source).toContain("private planListValue: PlanListStep[]");
    expect(runnerSource).toContain("eventSeq: kernelRuntimeContext.eventCount()");
    expect(source).toContain("planList: this.planList");
    expect(source).toContain("events: this.events");
    expect(source).not.toContain("const events: OraEventEnvelope[] = []");
    expect(source).not.toContain("let planList: PlanListStep[] =");
  });

  it("keeps artifact collection owned by KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");

    expect(source).toContain("private readonly artifactsValue: ArtifactRef[] = []");
    expect(source).toContain("artifactCount(): number");
    expect(source).toContain("appendArtifact(artifact: ArtifactRef): ArtifactRef");
    expect(source).toContain("artifacts: this.artifacts");
    expect(source).not.toContain("const artifacts: ArtifactRef[] = []");
    expect(source).not.toContain("artifacts.push(artifact)");
  });

  it("keeps agent message collection owned by KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");

    expect(source).toContain("private readonly agentMessagesValue: AgentConversationMessage[] = []");
    expect(source).toContain("agentMessageCount(): number");
    expect(source).toContain("appendAgentMessage(message: AgentConversationMessage): AgentConversationMessage");
    expect(source).toContain("agentMessages: this.agentMessages");
    expect(source).not.toContain("const agentMessages: AgentConversationMessage[] = []");
    expect(source).not.toContain("agentMessages.push(message)");
  });

  it("keeps tool-call ledger ownership inside KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");

    expect(source).toContain("private readonly toolCallLedger: RuntimeToolCallLedger");
    expect(source).toContain("initialToolCalls: OraToolCallEnvelope[]");
    expect(source).toContain("appendToolCall = (params: AppendRuntimeToolCallParams): OraToolCallEnvelope");
    expect(source).toContain("toolCalls: this.toolCalls");
    expect(source).not.toContain("const toolCallLedger = new RuntimeToolCallLedger");
    expect(source).not.toContain("toolCalls: () => toolCallLedger.list()");
  });

  it("keeps active agent collection owned by KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");

    expect(source).toContain("private readonly activeAgentsValue = new Set<string>()");
    expect(source).toContain("activeAgentCount(): number");
    expect(source).toContain("activateAgent(agentId: string): void");
    expect(source).toContain("deactivateAgent(agentId: string): void");
    expect(source).toContain("activeAgents: this.activeAgents");
    expect(source).not.toContain("const activeAgents = new Set<string>()");
    expect(source).not.toContain("activeAgents.add(");
    expect(source).not.toContain("activeAgents.delete(");
  });

  it("keeps topology ownership and status mutation inside KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");
    const runnerSource = kernelRunnerSource();

    expect(source).toContain("private readonly topologyValue: StateSnapshot[\"topology\"]");
    expect(source).toContain("initialTopology: StateSnapshot[\"topology\"]");
    expect(source).toContain("setTopologyStatus(");
    expect(source).toContain("topology: this.topology");
    expect(runnerSource).toContain("emit(\"topology.updated\", kernelRuntimeContext.topology)");
    expect(source).not.toContain("const topology = {");
    expect(source).not.toContain("for (const node of topology.nodes)");
  });

  it("keeps pending clarification collection owned by KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");

    expect(source).toContain("private readonly pendingClarificationsValue: PendingClarification[] = []");
    expect(source).toContain("pendingClarificationCount(): number");
    expect(source).toContain("pendingClarifications: this.pendingClarifications");
    expect(source).toContain("pendingClarificationIds: this.pendingClarifications.map");
    expect(source).not.toContain("const pendingClarifications: PendingClarification[] = []");
    expect(source).not.toContain("pendingClarifications.length > 0");
  });

  it("assembles continuation state through KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");
    const runnerSource = kernelRunnerSource();

    expect(source).toContain("assembleContinuation(params:");
    expect(source).toContain("pendingApprovalToolCallIds");
    expect(source).toContain("pendingClarificationIds: this.pendingClarifications.map");
    expect(source).toContain("const { continuation, pendingApprovals } = this.assembleContinuation");
    expect(runnerSource).toContain("return kernelRuntimeContext.assembleFinalSnapshot");
    expect(source).not.toContain("const pendingApprovalToolCallIds = kernelRuntimeContext.toolCalls");
    expect(source).not.toContain("pendingClarificationIds: kernelRuntimeContext.pendingClarifications.map");
  });

  it("coordinates kernel lifecycle through KernelRunner", () => {
    const source = readSource("src/harness/runtime-kernel.ts");
    const runnerSource = kernelRunnerSource();

    expect(source).toContain("from \"./runtime-kernel-runner.js\"");
    expect(source).not.toContain("class KernelRunner");
    expect(runnerSource).toContain("export class KernelRunner");
    expect(runnerSource).toContain("async run(): Promise<StateSnapshot>");
    expect(runnerSource).toContain("this.emitStartEvents();");
    expect(runnerSource).toContain("await this.executeMode();");
    expect(runnerSource).toContain("this.flushMemory();");
    expect(runnerSource).toContain("return this.checkpoint();");
    expect(runnerSource).toContain("constructor(private readonly deps: KernelRunnerDeps) {}");
    expect(source).toContain("const snapshot = await new KernelRunner(createKernelRunnerDeps({");
    expect(source).not.toContain("\n  emit(\"run.started\"");
  });

  it("keeps delegated-agent wrapper node states behind a local helper", () => {
    const source = readSource("src/harness/runtime-kernel.ts");

    expect(source).toContain("const emitDelegatedAgentState = (");
    expect(source).toContain('emitDelegatedAgentState("interrupted"');
    expect(source).toContain('emitDelegatedAgentState("failed"');
    expect(source).toContain('emitDelegatedAgentState("degraded"');
    expect(source).not.toContain('emitNodeRuntimeState("interrupted"');
    expect(source).not.toContain('emitNodeRuntimeState("degraded"');
  });

  it("freezes the explicit KernelRunner dependency surface as narrow runner-facing groups", () => {
    const source = readSource("src/harness/runtime-kernel.ts");
    const depsSource = kernelRunnerDepsSource();
    const runnerSource = kernelRunnerSource();

    const explicitRunnerDependencyGroups = {
      request: [
        "input",
        "config",
        "options",
      ],
      runtime: [
        "kernelRuntimeContext",
        "emit",
      ],
      start: [
        "skills",
        "tools",
        "profiles",
      ],
      progress: [
        "emitPlanUpdated",
        "emitTodoUpdated",
      ],
      topology: [
        "setTopologyStatus",
      ],
      stores: [
        "planService",
        "todoService",
      ],
      execution: [
        "executeModeSpec",
        "kernelPatternExecutionContextAdapter",
        "resolvedModeSpec",
        "resolvedDefinition",
      ],
      preflight: [
        "clarificationAnswer",
        "requestIntentClarificationQuestion",
        "ensureClarification",
        "rootTopology",
        "emitOraObservation",
        "agentLabel",
      ],
      finalization: [
        "inferCompletionStopReason",
        "modeProgressFinalizationError",
        "outputWithCompletionMetadata",
        "completionMetadata",
        "finalizeAsOra",
        "incompleteForcedFinalError",
      ],
      memory: [
        "memoryCaptureQueue",
        "memoryService",
      ],
      checkpoint: [
        "runId",
        "checkpointLabelForStatus",
        "now",
        "actionLedger",
      ],
    };

    expect(source).not.toContain("const kernelRunnerDeps: KernelRunnerDeps = {");
    expect(source).toContain("createKernelRunnerDeps({");
    expect(runnerSource).toContain("export function createKernelRunnerDeps(deps: KernelRunnerDeps): KernelRunnerDeps");
    expect(runnerSource).toContain("export interface KernelRunnerDeps");
    expect(runnerSource).toContain("constructor(private readonly deps: KernelRunnerDeps) {}");
    for (const [group, dependencies] of Object.entries(explicitRunnerDependencyGroups)) {
      expect(depsSource, `KernelRunner dependency group changed: ${group}`).toContain(`${group}: {`);
      expect(runnerSource, `KernelRunner should consume grouped deps: ${group}`).toContain(`this.deps.${group}`);
      for (const dependency of dependencies) {
        expect(depsSource, `KernelRunner dependency changed: ${group}.${dependency}`).toContain(dependency);
      }
    }
    expect(runnerSource).not.toContain("} = this.deps;");
    expect(depsSource).not.toContain("runtimeToolExecutor");
    expect(depsSource).not.toContain("runNodeRuntimeLoop(");
    expect(depsSource).not.toContain("new RuntimeToolExecutor");
    expect(depsSource).not.toContain("createRuntimePatternExecutionContext");
    expect(depsSource).not.toContain("runRecoverableNode");
    expect(depsSource).not.toContain("LocalRunStore");
    expect(depsSource).not.toContain("RunLedgerService");
    expect(depsSource).not.toContain("RunPersistenceService");
    expect(depsSource).not.toContain("RuntimeGateService");
    expect(source).toContain("createKernelPatternExecutionContextAdapter({");
    expect(runnerSource).toContain("kernelPatternExecutionContextAdapter.create()");
    expect(runnerSource).not.toContain("runtimeToolExecutor");
    expect(runnerSource).not.toContain("runNodeRuntimeLoop(");
    expect(runnerSource).not.toContain("new RuntimeToolExecutor");
    expect(runnerSource).not.toContain("createRuntimePatternExecutionContext");
  });

  it("passes live summary getters into PatternExecutionContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");

    expect(source).toContain("queueSummary: () => kernelRuntimeContext.queueSummary");
    expect(source).toContain("sharedStateSummary: () => kernelRuntimeContext.sharedStateSummary");
    expect(source).toContain("busStats: () => kernelRuntimeContext.busStats");
    expect(source).not.toContain("projectId,\n        queueSummary,\n        sharedStateSummary,\n        busStats,");
  });

  it("keeps queue, bus, and shared-state summaries owned by KernelRuntimeContext", () => {
    const source = readSource("src/harness/runtime-kernel.ts");

    expect(source).toContain("private queueSummaryValue: QueueSummary");
    expect(source).toContain("private busStatsValue: BusStats");
    expect(source).toContain("private sharedStateSummaryValue: SharedStateSummary");
    expect(source).toContain("private readonly busTopicCountsValue: Record<string, number> = {}");
    expect(source).toContain("private readonly sharedEntriesValue: SharedStateSummary[\"entries\"] = []");
    expect(source).toContain("recordBusPublished(topic: string)");
    expect(source).toContain("recordBusRouted(topic: string)");
    expect(source).toContain("writeSharedStateEntry(params:");
    expect(source).toContain("queueSummary: this.queueSummary");
    expect(source).toContain("sharedStateSummary: this.sharedStateSummary");
    expect(source).toContain("busStats: this.busStats");
    expect(source).not.toContain("let queueSummary: QueueSummary");
    expect(source).not.toContain("let busStats: BusStats");
    expect(source).not.toContain("let sharedStateSummary: SharedStateSummary");
    expect(source).not.toContain("const busTopicCounts: Record<string, number> = {}");
    expect(source).not.toContain("const sharedEntries: SharedStateSummary[\"entries\"] = []");
  });

  it("routes node loop state emission through NodeLoopController", () => {
    const source = readSource("src/harness/node-runtime-loop.ts");
    const transitionSource = readSource("src/harness/node-loop-transitions.ts");

    expect(source).toContain("new NodeLoopController");
    expect(source).not.toContain("CORE_NODE_RUNTIME_TRANSITIONS");
    expect(source).toContain("onInvalidTransition: \"throw\"");
    expect(source).toContain("kind: \"runtime_diagnostic\"");
    expect(source).toContain("source: \"node_loop_transition\"");
    expect(source).toContain("const emitNodeRuntimeState = nodeLoopController.emit");
    expect(transitionSource).toContain("export class NodeLoopReducer");
    expect(transitionSource).toContain("deps.allowedTransitions ?? CORE_NODE_RUNTIME_TRANSITIONS");
    expect(transitionSource).toContain("reduce(state: NodeRuntimeLoopState): NodeLoopReduction");
    expect(transitionSource).toContain("commit(reduction: NodeLoopReduction): void");
    expect(transitionSource).toContain("this.reducer = new NodeLoopReducer");
  });

  it("keeps built-in mode family executors outside the public driver registry", () => {
    const source = readSource("src/patterns/driver-registry.ts");

    expect(source).toContain("createBuiltInModeDriverRegistry({");
    expect(source).toContain("from \"./agent-teams-driver.js\"");
    expect(source).toContain("from \"./generator-verifier-driver.js\"");
    expect(source).toContain("from \"./message-bus-driver.js\"");
    expect(source).toContain("from \"./orchestrator-subagent-driver.js\"");
    expect(source).toContain("from \"./shared-state-driver.js\"");
    expect(source).not.toMatch(/async function execute(?:AgentTeams|GeneratorVerifier|MessageBus|OrchestratorSubagent|SharedState)/);

    expect(readSource("src/patterns/agent-teams-driver.ts")).toContain("export async function executeAgentTeams");
    expect(readSource("src/patterns/generator-verifier-driver.ts")).toContain("export async function executeGeneratorVerifier");
    expect(readSource("src/patterns/message-bus-driver.ts")).toContain("export async function executeMessageBus");
    expect(readSource("src/patterns/orchestrator-subagent-driver.ts")).toContain("export async function executeOrchestratorSubagent");
    expect(readSource("src/patterns/shared-state-driver.ts")).toContain("export async function executeSharedState");
  });

  it("routes built-in mode node lifecycle through the generic node executor", () => {
    const executorSource = readSource("src/patterns/generic-node-executor.ts");
    const helperSource = readSource("src/patterns/mode-driver-helpers.ts");

    expect(executorSource).toContain("export async function runGenericModeNode");
    expect(executorSource).toContain("context.ensureClarification");
    expect(executorSource).toContain("context.runRecoverableNode");
    expect(executorSource).toContain("context.setQueueSummary");
    expect(executorSource).toContain("context.captureMemory");
    expect(executorSource).toContain("context.publishArtifact");
    expect(helperSource).toContain("export { runGenericModeNode, runModeNode } from \"./generic-node-executor.js\"");
    expect(helperSource).not.toContain("async function runModeNode");

    for (const driverPath of builtInModeDriverPaths) {
      const driverSource = readSource(driverPath);

      expect(driverSource).toContain("from \"./generic-node-executor.js\"");
      expect(driverSource).toMatch(/runGenericModeNode\(|runModeLayer\(/);
      for (const lifecyclePrimitive of [
        "ensureClarification(",
        "runRecoverableNode(",
        "setQueueSummary(",
        "captureMemory(",
        "publishArtifact(",
      ]) {
        expect(driverSource, `${driverPath} must not own ${lifecyclePrimitive}`).not.toContain(lifecyclePrimitive);
      }
    }
  });

  it("assembles the final snapshot through KernelRuntimeContext-owned sources", () => {
    const source = readSource("src/harness/runtime-kernel.ts");
    const runnerSource = kernelRunnerSource();
    const callSiteStart = runnerSource.indexOf("return kernelRuntimeContext.assembleFinalSnapshot({");
    const callSiteEnd = runnerSource.indexOf("\n    });", callSiteStart);
    const finalSnapshotCallSite = runnerSource.slice(callSiteStart, callSiteEnd);

    expect(source).toContain("assembleFinalSnapshot(params:");
    expect(callSiteStart).toBeGreaterThanOrEqual(0);
    expect(callSiteEnd).toBeGreaterThan(callSiteStart);
    expect(runnerSource).toContain("return kernelRuntimeContext.assembleFinalSnapshot({");
    expect(source).toContain("continuation,");
    expect(source).toContain("pendingApprovals,");
    for (const contextOwnedSource of [
      "topology: this.topology",
      "planList: this.planList",
      "toolCalls: this.toolCalls",
      "events: this.events",
      "agentMessages: this.agentMessages",
      "artifacts: this.artifacts",
      "activeAgents: this.activeAgents",
      "queueSummary: this.queueSummary",
      "sharedStateSummary: this.sharedStateSummary",
      "busStats: this.busStats",
      "pendingClarifications: this.pendingClarifications",
    ]) {
      expect(source).toContain(contextOwnedSource);
    }
    for (const callSiteSource of [
      "topology: kernelRuntimeContext.topology",
      "planList: kernelRuntimeContext.planList",
      "toolCalls: kernelRuntimeContext.toolCalls",
      "events: kernelRuntimeContext.events",
      "agentMessages: kernelRuntimeContext.agentMessages",
      "artifacts: kernelRuntimeContext.artifacts",
      "activeAgents: kernelRuntimeContext.activeAgents",
      "queueSummary: kernelRuntimeContext.queueSummary",
      "sharedStateSummary: kernelRuntimeContext.sharedStateSummary",
      "busStats: kernelRuntimeContext.busStats",
      "pendingClarifications: kernelRuntimeContext.pendingClarifications",
    ]) {
      expect(finalSnapshotCallSite).not.toContain(callSiteSource);
    }
    expect(source).not.toContain("const snapshot = StateSnapshotSchema.parse({");
  });
});
