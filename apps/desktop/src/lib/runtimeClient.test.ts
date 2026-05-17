import { MVP_MODES, ORA_ROOT_AGENT_ID } from "@cemeworm/shared";
import { describe, expect, it } from "vitest";
import { createRuntimeClient } from "./runtimeClient";

function expectedBrowserFallbackSystemAgentIds(): string[] {
  return [...new Set([
    ORA_ROOT_AGENT_ID,
    ...MVP_MODES
      .filter((mode) => mode.visibility !== "internal")
      .flatMap((mode) => mode.profiles.map((profile) => profile.id)),
  ])].sort();
}

describe("desktop runtime client agent catalog", () => {
  it("bootstraps the workbench in one browser-fallback call", async () => {
    const client = createRuntimeClient();
    const session = await client.createSession();
    const snapshot = await client.startRun(
      { prompt: "Keep startup light.", context: {} },
      { modeId: "single_agent" },
      session.sessionId,
    );

    const bootstrap = await client.workbenchBootstrap();

    expect(bootstrap.bootstrap.health.ok).toBe(true);
    expect(bootstrap.sessions).toHaveLength(1);
    expect(bootstrap.activeSessionDetail.session.sessionId).toBe(bootstrap.sessions[0]?.sessionId);
    expect(bootstrap.activeSessionDetail.turns.map((turn) => turn.runId)).toEqual([snapshot.runId]);
    expect(bootstrap.activeSessionDetail.latestSnapshot).toBeUndefined();
    expect(bootstrap.projects).toEqual([]);
  });

  it("mirrors task flow aliases in browser fallback", async () => {
    const client = createRuntimeClient();
    const session = await client.createSession({});
    const flow = await client.createFlow(
      { prompt: "Run through the flow client.", context: {} },
      { modeId: "single_agent", modelRef: "local/smoke-model" },
      session.sessionId,
    );
    expect(flow.flowRunId).toBe(flow.runId);

    const detail = await client.getFlowRun(flow.flowRunId);
    expect(detail).toMatchObject({
      flowRunId: flow.runId,
      runId: flow.runId,
      sessionId: session.sessionId,
      definition: { source: "mode_spec", modeId: "single_agent" },
    });
    expect(detail.linkedSessionIds).toEqual([session.sessionId]);

    const stream = await client.streamRun(flow.runId);
    const flowStream = await client.replayFlow(flow.flowRunId, detail.checkpoints[0]?.id);
    expect(stream.runId).toBe(flow.runId);
    expect(flowStream.runId).toBe(flow.runId);

    const fork = await client.forkFlow(flow.flowRunId, detail.checkpoints[0]!.id);
    expect(fork.flowRunId).toBe(fork.runId);
    expect(fork.runId).not.toBe(flow.runId);

    const cancelled = await client.cancelFlow(fork.flowRunId, "Cancel flow client fork.");
    expect(cancelled.status).toBe("cancelled");
    expect((await client.getFlowRun(fork.flowRunId)).gates).toContainEqual(expect.objectContaining({
      kind: "cancellation",
      status: "cancelled",
    }));
  });

  it("mirrors automation lifecycle in browser fallback", async () => {
    const client = createRuntimeClient();
    const automation = await client.createAutomation({
      title: "Morning review",
      prompt: "Summarize overnight changes.",
      schedule: {
        kind: "rrule",
        rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
        timezone: "UTC",
      },
      status: "active",
      modeSelection: "manual",
      taskIntent: "plan",
      skillIds: [],
      toolIds: [],
      runConfig: {},
    });

    expect((await client.listAutomations()).map((item) => item.id)).toContain(automation.id);
    expect((await client.previewAutomationSchedule({ schedule: automation.schedule, limit: 2 })).occurrences).toHaveLength(2);
    expect((await client.pauseAutomation(automation.id)).status).toBe("paused");
    expect((await client.resumeAutomation(automation.id)).status).toBe("active");

    const run = await client.runAutomationNow(automation.id);
    expect(run.status).toBe("succeeded");
    expect(run.sessionId).toBeTruthy();

    const updated = await client.getAutomation(automation.id);
    expect(updated.state.runHistory[0]?.runId).toBe(run.runId);
  });

  it("mirrors widget duplicate lookup and pinning in browser fallback", async () => {
    const client = createRuntimeClient();

    const created = await client.createWidget({
      title: "任务清单",
      kind: "todo",
      layout: { x: 0, y: 0, w: 1, h: 1, pinned: false },
    });

    await expect(client.findDuplicateWidget("任务清单", "todo")).resolves.toMatchObject({
      id: created.id,
      kind: "todo",
      status: "active",
    });

    const pinned = await client.toggleWidgetPin(created.id);
    expect(pinned.layout.pinned).toBe(true);
    expect((await client.listWidgets()).find((widget) => widget.id === created.id)?.layout.pinned).toBe(true);

    await client.archiveWidget(created.id);
    await expect(client.findDuplicateWidget("任务清单", "todo")).resolves.toBeNull();
  });

  it("lists provider models in browser fallback", async () => {
    const client = createRuntimeClient();

    await expect(client.listProviderModels({
      id: "local-smoke",
      type: "local_smoke",
      label: "Smoke",
      modelId: "smoke-model",
      enabled: true,
      capabilities: ["chat"],
      dropParams: [],
      headers: {},
    })).resolves.toMatchObject({
      status: "ok",
      authoritative: true,
      models: [{ id: "smoke-model", source: "local" }],
    });

    await expect(client.listProviderModels({
      id: "deepseek",
      type: "openai_compatible",
      label: "DeepSeek",
      modelId: "deepseek-chat",
      enabled: false,
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      protocol: "chat_completions",
      capabilities: ["chat"],
      dropParams: [],
      headers: {},
    })).resolves.toMatchObject({
      status: "ok",
      authoritative: false,
    });
  });

  it("exposes built-in agents and applies global overrides in browser fallback", async () => {
    const client = createRuntimeClient();
    const catalog = await client.agentCatalog();
    const builder = catalog.systemAgents.find((agent) => agent.id === "builder");
    const ora = catalog.systemAgents.find((agent) => agent.id === "ora");
    const reviewer = catalog.systemAgents.find((agent) => agent.id === "reviewer");

    expect(catalog.systemAgents.map((agent) => agent.id).sort()).toEqual(
      expectedBrowserFallbackSystemAgentIds(),
    );
    expect(catalog.systemAgents.map((agent) => agent.id)).not.toContain("solo_agent");
    expect(builder).toBeDefined();
    expect(ora?.usages.some((usage) => usage.modeId === "global_entry")).toBe(true);
    expect(ora?.usages.some((usage) => usage.modeId === "single_agent")).toBe(true);
    expect(builder?.usages.some((usage) => usage.modeId === "agent_teams")).toBe(true);
    expect(builder?.usages.some((usage) => usage.modeId === "ora_self_builder")).toBe(true);
    expect(reviewer?.usages.some((usage) => usage.modeId === "agent_teams")).toBe(true);
    expect(reviewer?.usages.some((usage) => usage.modeId === "deerflow_harness")).toBe(true);
    expect(await client.checkAgentName("builder")).toMatchObject({ available: false, name: "builder" });
    expect(await client.checkAgentName("ora")).toMatchObject({ available: false, name: "ora" });
    await expect(client.createAgent({
      name: "builder",
      description: "Collides with a built-in role.",
      toolIds: [],
      skillIds: [],
      soul: "Should not be created.",
    })).rejects.toThrow(/built-in system agent/);

    await client.updateSystemAgentOverride({
      agentId: "builder",
      label: "Build Captain",
      role: "Implement assigned work with a stronger ownership stance.",
      toolIds: ["file.read"],
      skillIds: ["long-task-protocol"],
      soul: "Prefer scoped implementation steps.",
    });

    const updatedCatalog = await client.agentCatalog();
    expect(updatedCatalog.systemAgents.find((agent) => agent.id === "builder")).toMatchObject({
      label: "Build Captain",
      overridden: true,
      toolIds: ["file.read"],
      skillIds: ["long-task-protocol"],
    });

    const modes = await client.listModes();
    expect(
      modes.some((mode) =>
        mode.id === "agent_teams" &&
        mode.profiles.some((profile) => profile.id === "builder" && profile.label === "Build Captain")
      )
    ).toBe(true);

    await client.resetSystemAgentOverride("builder");
    const resetCatalog = await client.agentCatalog();
    expect(resetCatalog.systemAgents.find((agent) => agent.id === "builder")?.overridden).toBe(false);
  });

  it("mirrors evaluation blueprint lifecycle and compile in browser fallback", async () => {
    const client = createRuntimeClient();
    const dataset = await client.importEvaluationDataset({
      name: "Router Dataset",
      sourceFileName: "router.json",
      sourceFormat: "json",
      content: JSON.stringify([{ id: "case-1", prompt: "Choose the right mode." }]),
    });
    const draft = await client.generateEvaluationBlueprintDraft({
      goal: "评估 Auto Mode Router 是否能选对 mode。",
      recipe: "auto_router_quality",
      datasetId: dataset.dataset.id,
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
    });
    expect(draft.recipe).toBe("auto_router_quality");

    const updated = await client.updateEvaluationBlueprint({
      blueprintId: draft.id,
      updates: { status: "ready", title: "Ready Router Blueprint" },
    });
    expect(updated.status).toBe("ready");

    const listed = await client.listEvaluationBlueprints({ recipe: "auto_router_quality" });
    expect(listed.map((blueprint) => blueprint.id)).toContain(draft.id);
    await expect(client.getEvaluationBlueprint(draft.id)).resolves.toMatchObject({ title: "Ready Router Blueprint" });

    const compiled = await client.compileEvaluationBlueprint({ blueprintId: draft.id });
    expect(compiled.spec.objective?.target).toBe("runtime.mode_selection");
    expect(compiled.spec.configs[0]?.runConfig.modeSelection).toBe("auto");
    expect(compiled.spec.configs[0]?.runConfig.metadata?.evaluationRouterOnly).toBe(true);
  });

  it("mirrors evaluation planner turns and annotation queue in browser fallback", async () => {
    const client = createRuntimeClient();
    const dataset = await client.importEvaluationDataset({
      name: "Planner Dataset",
      sourceFileName: "planner.json",
      sourceFormat: "json",
      content: JSON.stringify([{ id: "case-1", prompt: "Answer briefly.", expected: "Brief answer." }]),
    });
    const planned = await client.planEvaluationBlueprintTurn({
      message: "评估输出质量，需要 LLM judge 和人工标注。",
      providerId: "local-smoke",
      modelRef: "local/smoke-model",
    });
    expect(planned.blueprint.evaluatorPlan.evaluators.map((evaluator) => evaluator.kind)).toContain("human_annotation");

    const compiled = await client.compileEvaluationBlueprint({
      blueprintId: planned.blueprint.id,
      datasetId: dataset.dataset.id,
      modeIds: ["orchestrator_subagent"],
    });
    const detail = await client.startEvaluationRun(compiled.spec);
    expect(detail.run.scorecard.pendingAnnotationCount).toBe(1);

    const pending = await client.listEvaluationAnnotations({ status: "pending" });
    expect(pending).toHaveLength(1);
    const submitted = await client.submitEvaluationAnnotation({
      taskId: pending[0]!.id,
      score: { value: true, normalizedScore: 1, passed: true },
      comment: "Looks good.",
    });
    expect(submitted.status).toBe("submitted");
  });

  it("mirrors Self-Iteration candidates and low-risk apply policy in browser fallback", async () => {
    const client = createRuntimeClient();
    const snapshot = await client.startRun(
      { prompt: "Answer with a source.", context: {} },
      { pattern: "generator_verifier", providerId: "local-smoke", modelRef: "local/smoke-model" },
    );
    await client.submitEvaluationFeedback({
      runId: snapshot.runId,
      feedbackText: "The answer missed the required source citation.",
    });

    const scan = await client.scanSelfIteration();
    expect(scan.candidates[0]?.targetKind).toBe("evaluation");
    expect(scan.autoApplied[0]?.status).toBe("applied");

    const listed = await client.listSelfIterationCandidates({ targetKind: "evaluation" });
    expect(listed[0]?.status).toBe("applied");

    const policy = await client.getSelfIterationPolicy();
    expect(policy.autonomy).toBe("low_risk_auto");
    const updated = await client.updateSelfIterationPolicy({ ...policy, evaluationAutoApply: false });
    expect(updated.evaluationAutoApply).toBe(false);
  });
});
