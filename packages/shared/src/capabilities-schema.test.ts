import { describe, expect, it } from "vitest";
import {
  MVP_TOOLS,
  RepoExploreRequestSchema,
  RepoExploreResponseSchema,
  resolveToolVisibility,
  visibleToolIdsForPreset,
} from "./capabilities.js";

describe("MVP_TOOLS parameter schemas", () => {
  const implementedTools = MVP_TOOLS.filter((t) => t.implemented);

  it("every implemented tool has a non-empty parameters schema", () => {
    for (const tool of implementedTools) {
      const params = tool.parameters as Record<string, unknown>;
      const keys = Object.keys(params);
      if (keys.length === 0) {
        throw new Error(
          `Tool '${tool.id}' is implemented but has empty parameters ({}). ` +
          `Add a JSON Schema definition with at least 'type' and 'properties'.`,
        );
      }
    }
    expect(implementedTools.length).toBeGreaterThan(0);
  });

  it("every implemented tool parameters has type: object", () => {
    for (const tool of implementedTools) {
      const params = tool.parameters as Record<string, unknown>;
      if (Object.keys(params).length === 0) continue;
      expect(params.type).toBe("object");
    }
  });

  it("every implemented tool parameters has properties defined", () => {
    for (const tool of implementedTools) {
      const params = tool.parameters as Record<string, unknown>;
      if (Object.keys(params).length === 0) continue;
      const props = params.properties;
      expect(props).toBeDefined();
      expect(typeof props).toBe("object");
      expect(props).not.toBeNull();
    }
  });

  it("file.read exposes optional line range parameters", () => {
    const fileRead = implementedTools.find((t) => t.id === "file.read");
    const params = fileRead?.parameters as Record<string, unknown> | undefined;
    const props = params?.properties as Record<string, unknown> | undefined;

    expect(fileRead).toBeDefined();
    expect(props?.path).toBeDefined();
    expect(props?.offset).toMatchObject({ type: "number", minimum: 1 });
    expect(props?.limit).toMatchObject({ type: "number", minimum: 1 });
    expect(params?.additionalProperties).toBe(false);
  });

  it("skills tools have name-based schemas", () => {
    const skillsTools = implementedTools.filter((t) => t.id.startsWith("skills."));
    for (const tool of skillsTools) {
      const params = tool.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, unknown> | undefined;
      expect(props).toBeDefined();
      // skills.get, skills.checkName, skills.create, skills.update, skills.setEnabled all need name
      if (tool.id !== "skills.list") {
        expect(props?.name).toBeDefined();
      }
    }
  });

  it("mcp tools have server-based schemas", () => {
    const mcpTools = implementedTools.filter((t) => t.id.startsWith("mcp."));
    for (const tool of mcpTools) {
      const params = tool.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, unknown> | undefined;
      expect(props).toBeDefined();
      expect(props?.server).toBeDefined();
    }
  });

  it("package tools that operate on a slot require an id", () => {
    const slotTools = ["package.buildCandidate", "package.verify", "package.promote", "package.switch", "package.rollback"];
    for (const toolId of slotTools) {
      const tool = implementedTools.find((t) => t.id === toolId);
      expect(tool).toBeDefined();
      const params = tool!.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, unknown> | undefined;
      expect(props?.id).toBeDefined();
      const required = params.required as string[] | undefined;
      expect(required).toContain("id");
    }
  });

  it("modes draft tools require draftId", () => {
    const draftTools = ["modes.refineDraft", "modes.validate", "modes.applyDraft"];
    for (const toolId of draftTools) {
      const tool = implementedTools.find((t) => t.id === toolId);
      expect(tool).toBeDefined();
      const params = tool!.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, unknown> | undefined;
      if (Object.keys(params).length > 0) {
        expect(props?.draftId).toBeDefined();
        const required = params.required as string[] | undefined;
        expect(required).toContain("draftId");
      }
    }
  });

  it("selfIteration tools that target a candidate require an id", () => {
    const candidateTools = ["selfIteration.get", "selfIteration.evaluate", "selfIteration.apply"];
    for (const toolId of candidateTools) {
      const tool = implementedTools.find((t) => t.id === toolId);
      expect(tool).toBeDefined();
      const params = tool!.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, unknown> | undefined;
      if (Object.keys(params).length > 0) {
        expect(props?.id).toBeDefined();
        const required = params.required as string[] | undefined;
        expect(required).toContain("id");
      }
    }
  });

  it("normalizes every tool descriptor with a tool family", () => {
    for (const tool of MVP_TOOLS) {
      expect(tool.family).toBeDefined();
    }
  });

  it("resolves root_default to a narrow visible surface", () => {
    const availableToolIds = MVP_TOOLS.map((tool) => tool.id);
    const resolution = resolveToolVisibility({
      availableToolIds,
      toolDescriptors: MVP_TOOLS,
      presetId: "root_default",
      defaultDecisionSource: "resolver_default",
    });

    expect(resolution.visibleToolIds).toEqual(visibleToolIdsForPreset("root_default", availableToolIds));
    expect(resolution.visibleToolIds).toContain("repo.explore");
    expect(resolution.visibleToolIds).not.toContain("shell.execute");
    expect(resolution.visibleToolIds).not.toContain("skills.create");
    expect(resolution.hiddenToolIds).toContain("shell.execute");
  });

  it("resolves single_agent_implement to a writable root surface", () => {
    const availableToolIds = MVP_TOOLS.map((tool) => tool.id);
    const resolution = resolveToolVisibility({
      availableToolIds,
      toolDescriptors: MVP_TOOLS,
      presetId: "single_agent_implement",
      defaultDecisionSource: "resolver_default",
    });

    expect(resolution.visibleToolIds).toEqual(visibleToolIdsForPreset("single_agent_implement", availableToolIds));
    expect(resolution.visibleToolIds).toContain("file.write");
    expect(resolution.visibleToolIds).toContain("file.apply_patch");
    expect(resolution.visibleToolIds).toContain("shell.execute");
    expect(resolution.visibleToolIds).toContain("agent.spawn");
    expect(resolution.visibleToolIds).not.toContain("skills.create");
  });

  it("repo.explore request and response contracts parse the phase-1 shape", () => {
    const request = RepoExploreRequestSchema.parse({
      goal: "Find the auth entrypoint",
      kind: "trace",
      subject: "authMiddleware",
      scope: {
        paths: ["apps/runtime/src"],
        includeGlobs: ["**/*.ts"],
      },
      evidenceBudget: 4,
    });
    const response = RepoExploreResponseSchema.parse({
      status: "answered",
      kind: "trace",
      summary: "trace answered — 2 evidence items across 2 paths",
      answer: "Found the middleware wiring.",
      evidence: [
        {
          path: "apps/runtime/src/server.ts",
          kind: "callsite",
          summary: "Matched repository evidence for authMiddleware at line 12.",
          lineStart: 12,
          lineEnd: 12,
          relevance: "primary",
        },
      ],
      relatedPaths: ["apps/runtime/src/server.ts"],
      gaps: [],
      nextActions: [{ kind: "none", reason: "Enough evidence." }],
      metadata: {},
    });

    expect(request.kind).toBe("trace");
    expect(response.evidence[0]?.kind).toBe("callsite");
  });
});
