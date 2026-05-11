import { describe, expect, it } from "vitest";
import { MVP_TOOLS } from "./capabilities.js";

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
});
