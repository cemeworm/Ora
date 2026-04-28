import { describe, expect, it } from "vitest";
import { classifyRecoveryError } from "../src/harness/recovery-policy.js";

describe("recovery policy classification", () => {
  it("does not retry OpenAI-compatible request-shape errors as transient provider failures", () => {
    const incident = classifyRecoveryError(
      new Error("OpenAI-compatible provider deepseek failed with 400: {\"error\":{\"message\":\"The `reasoning_content` in the thinking mode must be passed back to the API.\",\"type\":\"invalid_request_error\"}}"),
      { surface: "provider", nodeId: "solo_agent", agentId: "solo_agent" },
    );

    expect(incident).toMatchObject({
      errorType: "model_output_invalid",
      nodeId: "solo_agent",
      agentId: "solo_agent",
    });
  });
});
