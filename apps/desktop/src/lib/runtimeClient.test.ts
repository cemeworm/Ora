import { describe, expect, it } from "vitest";
import { createRuntimeClient } from "./runtimeClient";

describe("desktop runtime client agent catalog", () => {
  it("exposes built-in agents and applies global overrides in browser fallback", async () => {
    const client = createRuntimeClient();
    const catalog = await client.agentCatalog();
    const builder = catalog.systemAgents.find((agent) => agent.id === "builder");
    const ora = catalog.systemAgents.find((agent) => agent.id === "ora");
    const reviewer = catalog.systemAgents.find((agent) => agent.id === "reviewer");

    expect(catalog.systemAgents.map((agent) => agent.id).sort()).toEqual([
      "builder",
      "generator",
      "ora",
      "orchestrator",
      "release_reviewer",
      "researcher",
      "responder",
      "reviewer",
      "router",
      "team_lead",
      "verifier",
    ]);
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
});
