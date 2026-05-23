import { describe, expect, it } from "vitest";
import {
  getModePreset,
  MVP_TOOLS,
  ORA_ROOT_AGENT_ID,
  SINGLE_AGENT_MODE_ID,
} from "@cemeworm/shared";
import { resolveVisibleToolsForAgent } from "./runtime-tool-visibility.js";

describe("runtime tool visibility", () => {
  const modeSpec = getModePreset(SINGLE_AGENT_MODE_ID);

  it("uses the readonly single-agent surface for chat intent", () => {
    expect(modeSpec).toBeDefined();
    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: MVP_TOOLS.map((tool) => tool.id),
      toolDescriptors: MVP_TOOLS,
      modeSpec: modeSpec!,
      agentId: ORA_ROOT_AGENT_ID,
      taskIntent: "chat",
    });

    expect(resolution.presetId).toBe("single_agent_readonly");
    expect(resolution.visibleToolIds).toContain("file.read");
    expect(resolution.visibleToolIds).not.toContain("repo.explore");
    expect(resolution.visibleToolIds).not.toContain("file.write");
  });

  it("keeps the implement surface for implement intent", () => {
    expect(modeSpec).toBeDefined();
    const resolution = resolveVisibleToolsForAgent({
      availableToolIds: MVP_TOOLS.map((tool) => tool.id),
      toolDescriptors: MVP_TOOLS,
      modeSpec: modeSpec!,
      agentId: ORA_ROOT_AGENT_ID,
      taskIntent: "implement",
    });

    expect(resolution.presetId).toBe("single_agent_implement");
    expect(resolution.visibleToolIds).toContain("repo.explore");
    expect(resolution.visibleToolIds).toContain("file.write");
  });
});
