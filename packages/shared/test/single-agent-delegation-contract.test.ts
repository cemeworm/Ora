import { describe, expect, it } from "vitest";
import { MVP_MODES, SINGLE_AGENT_MODE_ID } from "../src/index.js";

describe("single_agent delegation contract", () => {
  it("keeps single_agent mode default-direct while allowing explicit turn-local delegation", () => {
    const singleAgent = MVP_MODES.find((mode) => mode.id === SINGLE_AGENT_MODE_ID);
    expect(singleAgent).toBeDefined();
    expect(singleAgent?.summary).toContain("默认独立制定计划并完成任务");
    expect(singleAgent?.summary).toContain("明确要求团队协作");
    expect(singleAgent?.description).toContain("默认直接处理");
    expect(singleAgent?.recommendedUse).toContain("用户明确要求时临时协作");
    expect(singleAgent?.profiles[0]?.role).toContain("如果用户当前回合明确要求团队协作");
  });
});
