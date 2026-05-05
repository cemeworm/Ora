import {
  JsonRpcRequest,
  JsonRpcRequestSchema,
  JsonRpcResponse,
  JsonRpcResponseSchema
} from "@cemeworm/shared";
import { ZodError } from "zod";
import { LocalRunStore } from "./run-store.js";
import { OraRuntimeError } from "./runtime-errors.js";
import { createDefaultProviderRegistry, fetchProviderModels, verifyProviderConfig } from "./providers/index.js";
import { RuntimeToolRegistry } from "./harness/capability-registries.js";
import { MVP_MODE_RUNTIME_ATOMS, ProviderModelsParamsSchema, ProviderVerifyParamsSchema, RuntimeBootstrapSchema, SkillRegistrySchema, ToolRegistrySchema } from "@cemeworm/shared";
import type { RunEventStream } from "@cemeworm/shared";
import { PackageManager } from "./package-manager.js";

export type JsonRpcMethodHandler = (request: JsonRpcRequest) => Promise<unknown> | unknown;

export interface RuntimeMethodHandlerOptions {
  onRunStream?: (stream: RunEventStream) => void;
}

export function createRuntimeMethodHandler(
  store = new LocalRunStore(),
  _unusedSecondArg?: unknown,
  options: RuntimeMethodHandlerOptions = {},
): JsonRpcMethodHandler {
  const providerRegistry = createDefaultProviderRegistry().config;
  const toolRegistry = new RuntimeToolRegistry().snapshot();
  const packageManager = new PackageManager();
  return (request) => {
    switch (request.method) {
      case "runtime.health":
        return store.health();
      case "runtime.bootstrap":
        return RuntimeBootstrapSchema.parse({
          health: {
            ...store.health(),
            mode: "runtime",
            detail: "Ora runtime bootstrap is served from the shared runtime kernel."
          },
          patterns: store.listPatterns(),
          modes: store.listModes(),
          atoms: MVP_MODE_RUNTIME_ATOMS,
          tools: toolRegistry,
          packages: packageManager.snapshot(),
          skills: store.listSkills(),
          providers: providerRegistry
        });
      case "runtime.maintenance":
        return store.runtimeMaintenance(request.params);
      case "patterns.list":
        return store.listPatterns();
      case "modes.list":
        return store.listModes();
      case "modes.get":
        return store.getMode(request.params);
      case "modes.create":
        return store.createMode(request.params);
      case "modes.update":
        return store.updateMode(request.params);
      case "modes.delete":
        return store.deleteMode(request.params);
      case "modes.validate":
        return store.validateMode(request.params);
      case "modes.cloneFromPreset":
        return store.cloneModeFromPreset(request.params);
      case "modeStudio.context":
        return store.modeStudioContext();
      case "modeStudio.generateDraft":
        return store.generateModeStudioDraft(request.params);
      case "modeStudio.refineDraft":
        return store.refineModeStudioDraft(request.params);
      case "modeStudio.startBuilderRun":
        return store.startModeStudioBuilderRun(request.params);
      case "modeStudio.builderResult":
        return store.modeStudioBuilderResult(request.params);
      case "modeStudio.validateDraft":
        return store.validateModeStudioDraft(request.params);
      case "modeStudio.applyDraft":
        return store.applyModeStudioDraft(request.params);
      case "tools.list":
        return ToolRegistrySchema.parse(toolRegistry);
      case "packages.list":
      case "packages.active":
        return packageManager.snapshot();
      case "packages.buildCandidate":
        return packageManager.buildCandidate(request.params);
      case "packages.verify":
        return packageManager.verify(request.params);
      case "packages.promote":
      case "packages.switch":
        return packageManager.promote(request.params);
      case "packages.rollback":
        return packageManager.rollback();
      case "packages.prune":
        return packageManager.prune(request.params);
      case "skills.list":
        return SkillRegistrySchema.parse(store.listSkills(request.params));
      case "skills.get":
        return store.getSkill(request.params);
      case "skills.file.get":
        return store.getSkillFile(request.params);
      case "skills.create":
        return store.createSkill(request.params);
      case "skills.update":
        return store.updateSkill(request.params);
      case "skills.file.upsert":
        return store.upsertSkillFile(request.params);
      case "skills.delete":
        return store.deleteSkill(request.params);
      case "skills.file.delete":
        return store.deleteSkillFile(request.params);
      case "skills.checkName":
        return store.checkSkillName(request.params);
      case "skills.setEnabled":
        return store.setSkillEnabled(request.params);
      case "providers.list":
        return providerRegistry;
      case "memory.get":
        return store.getLongTermMemory();
      case "memory.clear":
        return store.clearLongTermMemory();
      case "providers.verify": {
        const parsed = ProviderVerifyParamsSchema.parse(request.params);
        return verifyProviderConfig(parsed.provider);
      }
      case "providers.models": {
        const parsed = ProviderModelsParamsSchema.parse(request.params);
        return fetchProviderModels(parsed.provider);
      }
      case "agents.list":
        return store.listAgents();
      case "agents.get":
        return store.getAgent(request.params);
      case "agents.create":
        return store.createAgent(request.params);
      case "agents.update":
        return store.updateAgent(request.params);
      case "agents.delete":
        return store.deleteAgent(request.params);
      case "agents.checkName":
        return store.checkAgentName(request.params);
      case "agents.generateDraft":
        return store.generateAgentDraft(request.params);
      case "agents.catalog":
        return store.agentCatalog();
      case "agents.updateSystemOverride":
        return store.updateSystemAgentOverride(request.params);
      case "agents.resetSystemOverride":
        return store.resetSystemAgentOverride(request.params);
      case "projects.create":
        return store.createProject(request.params);
      case "projects.list":
        return store.listProjects(request.params);
      case "projects.get":
        return store.getProject(request.params);
      case "projects.files":
        return store.listProjectFiles(request.params);
      case "projects.file.read":
        return store.readProjectFile(request.params);
      case "sessions.create":
        return store.createSession(request.params);
      case "sessions.list":
        return store.listSessions(request.params);
      case "sessions.get":
        return store.getSession(request.params);
      case "sessions.branchGroups.list":
        return store.listSessionBranchGroups(request.params);
      case "sessions.branchGroups.get":
        return store.getSessionBranchGroup(request.params);
      case "sessions.branchGroups.createAndRun":
        return store.createAndRunSessionBranchGroup(request.params);
      case "sessions.branchGroups.adopt":
        return store.adoptSessionBranchGroup(request.params);
      case "sessions.branchGroups.dismiss":
        return store.dismissSessionBranchGroup(request.params);
      case "sessions.resolvePlanDecision":
        return store.resolvePlanDecision(request.params);
      case "sessions.archive":
        return store.archiveSession(request.params);
      case "channels.create":
        return store.createChannel(request.params);
      case "channels.list":
        return store.listChannels(request.params);
      case "channels.get":
        return store.getChannel(request.params);
      case "channels.update":
        return store.updateChannel(request.params);
      case "channels.delete":
        return store.deleteChannel(request.params);
      case "channels.start":
        return store.startChannel(request.params);
      case "channels.stop":
        return store.stopChannel(request.params);
      case "channels.restart":
        return store.restartChannel(request.params);
      case "channels.status":
        return store.channelStatus();
      case "channels.ingest":
        return store.ingestChannel(request.params);
      case "channels.bindings.list":
        return store.listChannelBindings(request.params);
      case "channels.deliveries.list":
        return store.listChannelDeliveries(request.params);
      case "channels.deliveries.retry":
        return store.retryChannelDelivery(request.params);
      case "channels.wechat.requestQrCode":
        return store.wechatRequestQrCode(request.params);
      case "channels.wechat.pollQrCodeStatus":
        return store.wechatPollQrCodeStatus(request.params);
      case "automations.list":
        return store.listAutomations(request.params);
      case "automations.get":
        return store.getAutomation(request.params);
      case "automations.create":
        return store.createAutomation(request.params);
      case "automations.update":
        return store.updateAutomation(request.params);
      case "automations.delete":
        return store.deleteAutomation(request.params);
      case "automations.pause":
        return store.pauseAutomation(request.params);
      case "automations.resume":
        return store.resumeAutomation(request.params);
      case "automations.runNow":
        return store.runAutomationNow(request.params);
      case "automations.previewSchedule":
        return store.previewAutomationSchedule(request.params);
      case "runs.start":
        return store.startRun(request.params);
      case "runs.startStreaming":
        return store.startStreamingRun(request.params, { onStream: options.onRunStream });
      case "runs.list":
        return store.listRuns(request.params);
      case "runs.stream":
        return store.streamRun(request.params);
      case "runs.interrupt":
        return store.interruptRun(request.params);
      case "runs.resume":
        return store.resumeRun(request.params);
      case "runs.resumeStreaming":
        return store.resumeStreamingRun(request.params, { onStream: options.onRunStream });
      case "runs.cancel":
        return store.cancelRun(request.params);
      case "runs.state":
        return store.getRunState(request.params);
      case "runs.trail":
        return store.getRunTrail(request.params);
      case "runs.checkpoints":
        return store.listCheckpoints(request.params);
      case "runs.replay":
        return store.replayRun(request.params);
      case "runs.fork":
        return store.forkRun(request.params);
      case "runs.exportReport":
        return store.exportReport(request.params);
      case "evaluation.datasets.import":
        return store.importEvaluationDataset(request.params);
      case "evaluation.datasets.list":
        return store.listEvaluationDatasets(request.params);
      case "evaluation.datasets.get":
        return store.getEvaluationDataset(request.params);
      case "evaluation.blueprints.create":
        return store.createEvaluationBlueprint(request.params);
      case "evaluation.blueprints.update":
        return store.updateEvaluationBlueprint(request.params);
      case "evaluation.blueprints.list":
        return store.listEvaluationBlueprints(request.params);
      case "evaluation.blueprints.get":
        return store.getEvaluationBlueprint(request.params);
      case "evaluation.blueprints.compile":
        return store.compileEvaluationBlueprint(request.params);
      case "evaluation.blueprints.generateDraft":
        return store.generateEvaluationBlueprintDraft(request.params);
      case "evaluation.blueprints.planTurn":
        return store.planEvaluationBlueprintTurn(request.params);
      case "evaluation.runs.start":
        return store.startEvaluationRun(request.params, async ({ input, config }) => {
          const handle = await store.startRun({ input, config });
          return store.getRunState({ runId: handle.runId });
        });
      case "evaluation.runs.list":
        return store.listEvaluationRuns(request.params);
      case "evaluation.runs.get":
        return store.getEvaluationRun(request.params);
      case "evaluation.runs.stream":
        return store.streamEvaluationRun(request.params);
      case "evaluation.runs.promoteBaseline":
        return store.promoteEvaluationBaseline(request.params);
      case "evaluation.runs.export":
        return store.exportEvaluationRun(request.params);
      case "evaluation.baselines.list":
        return store.listEvaluationBaselines(request.params);
      case "evaluation.feedback.submit":
        return store.submitEvaluationFeedback(request.params);
      case "evaluation.feedback.list":
        return store.listEvaluationFeedback(request.params);
      case "evaluation.feedback.get":
        return store.getEvaluationFeedback(request.params);
      case "evaluation.feedback.update":
        return store.updateEvaluationFeedback(request.params);
      case "evaluation.feedback.accept":
        return store.acceptEvaluationFeedback(request.params);
      case "evaluation.feedback.reject":
        return store.rejectEvaluationFeedback(request.params);
      case "evaluation.annotations.list":
        return store.listEvaluationAnnotations(request.params);
      case "evaluation.annotations.submit":
        return store.submitEvaluationAnnotation(request.params);
      case "feedbackLoop.signals.list":
        return store.listProjectSignals(request.params);
      case "feedbackLoop.insights.list":
        return store.listProjectInsights(request.params);
      case "feedbackLoop.insights.get":
        return store.getProjectInsight(request.params);
      case "feedbackLoop.insights.dismiss":
        return store.dismissProjectInsight(request.params);
      case "feedbackLoop.actions.preview":
        return store.previewProjectSignalAction(request.params);
      case "feedbackLoop.actions.apply":
        return store.applyProjectSignalAction(request.params);
      case "feedbackLoop.rules.list":
        return store.listFeedbackLoopRules(request.params);
      case "feedbackLoop.rules.update":
        return store.updateFeedbackLoopRule(request.params);
      case "selfIteration.scan":
        return store.scanSelfIteration(request.params);
      case "selfIteration.candidates.list":
        return store.listSelfIterationCandidates(request.params);
      case "selfIteration.candidates.get":
        return store.getSelfIterationCandidate(request.params);
      case "selfIteration.candidates.evaluate":
        return store.evaluateSelfIterationCandidate(request.params);
      case "selfIteration.candidates.reject":
        return store.rejectSelfIterationCandidate(request.params);
      case "selfIteration.candidates.apply":
        return store.applySelfIterationCandidate(request.params);
      case "selfIteration.policy.get":
        return store.getSelfIterationPolicy(request.params);
      case "selfIteration.policy.update":
        return store.updateSelfIterationPolicy(request.params);
      default:
        throw new OraRuntimeError(`Method not found: ${request.method}`, -32601, {
          method: request.method
        });
    }
  };
}

export async function handleJsonRpcLine(
  line: string,
  handler: JsonRpcMethodHandler
): Promise<JsonRpcResponse | undefined> {
  if (!line.trim()) {
    return undefined;
  }

  let id: JsonRpcResponse["id"] = null;

  try {
    const decoded = JSON.parse(line);
    id = typeof decoded?.id === "string" || typeof decoded?.id === "number" ? decoded.id : null;
    const request = JsonRpcRequestSchema.parse(decoded);
    const result = await handler(request);

    if (request.id === undefined) {
      return undefined;
    }

    return JsonRpcResponseSchema.parse({
      jsonrpc: "2.0",
      id: request.id,
      result
    });
  } catch (error) {
    return JsonRpcResponseSchema.parse({
      jsonrpc: "2.0",
      id,
      error: normalizeError(error)
    });
  }
}

function normalizeError(error: unknown) {
  if (error instanceof SyntaxError) {
    return {
      code: -32700,
      message: "Parse error"
    };
  }

  if (error instanceof ZodError) {
    return {
      code: -32602,
      message: "Invalid params",
      data: error.flatten()
    };
  }

  if (error instanceof OraRuntimeError) {
    return {
      code: error.code,
      message: error.message,
      data: error.data
    };
  }

  return {
    code: -32603,
    message: error instanceof Error ? error.message : "Internal error"
  };
}
