import { describe, expect, it } from "vitest";
import { createRuntimeClient } from "./runtimeClient";

describe("desktop runtime client agent catalog", () => {
  it("exposes built-in agents and applies global overrides in browser fallback", async () => {
    const client = createRuntimeClient();
    const catalog = await client.agentCatalog();
    const builder = catalog.systemAgents.find((agent) => agent.id === "builder");

    expect(builder).toBeDefined();
    expect(builder?.usages.some((usage) => usage.modeId === "agent_teams")).toBe(true);
    expect(await client.checkAgentName("builder")).toMatchObject({ available: false, name: "builder" });
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
});
