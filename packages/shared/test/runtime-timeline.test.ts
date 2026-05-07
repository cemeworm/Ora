import { describe, expect, it } from "vitest";
import {
  deriveRuntimeTimelineProjection,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
} from "../src/index.js";

describe("runtime timeline projection", () => {
  it("normalizes run-scoped event order and agent labels for desktop/read-model timelines", () => {
    const snapshot = {
      runId: "run-timeline",
      profiles: [{ id: "builder", label: "Builder" }],
      events: [
        { id: "other:evt-0", runId: "other", seq: 0, type: "run.started", createdAt: 101, pattern: "orchestrator_subagent", payload: {} },
        { id: "run-timeline:evt-2", runId: "run-timeline", seq: 2, type: "run.done", createdAt: 103, pattern: "orchestrator_subagent", payload: {} },
        { id: "run-timeline:evt-1", runId: "run-timeline", seq: 1, type: "message.delta", createdAt: 102, pattern: "orchestrator_subagent", payload: { role: "assistant", content: "Working." }, agentId: "builder" },
      ],
      updatedAt: 104,
    };

    const projection = deriveRuntimeTimelineProjection(snapshot);

    expect(projection.events.map((event) => event.id)).toEqual([
      "run-timeline:evt-1",
      "run-timeline:evt-2",
    ]);
    expect(projection.baseTime).toBe(102);
    expect(projection.agentLabels.get("builder")).toBe("Builder");
    expect(projection.agentLabels.get(ORA_ROOT_AGENT_ID)).toBe(ORA_ROOT_AGENT_LABEL);
  });
});
