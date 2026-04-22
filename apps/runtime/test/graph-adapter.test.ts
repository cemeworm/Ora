import { describe, expect, it } from "vitest";
import { OraEventEnvelopeSchema } from "@ora/shared";
import { adaptGraphEvents, createPatternGraph } from "../src/index.js";

describe("graph event adapter", () => {
  it("adapts LangGraph stream events into ordered Ora envelopes", () => {
    const envelopes = adaptGraphEvents(
      [
        { event: "on_chain_start", name: "planner" },
        { event: "on_chat_model_stream", name: "planner", chunk: "token-1" },
        {
          event: "on_chat_model_stream",
          name: "planner",
          chunk: { content: "message-1" }
        },
        {
          event: "on_chain_end",
          name: "planner",
          output: { done: true }
        },
        {
          event: "on_checkpoint",
          data: { checkpointId: "ckpt-1" }
        }
      ],
      "run-graph",
      "orchestrator_subagent",
      () => 1_700_000_000_000
    );

    expect(envelopes.map((event) => event.type)).toEqual([
      "topology.updated",
      "action.updated",
      "token.delta",
      "message.delta",
      "action.updated",
      "checkpoint.created"
    ]);
    expect(envelopes.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(OraEventEnvelopeSchema.parse(envelopes[0])).toMatchObject({
      nodeId: "planner",
      payload: {
        node: "planner",
        status: "running"
      }
    });
    expect(OraEventEnvelopeSchema.parse(envelopes[2])).toMatchObject({
      type: "token.delta",
      payload: {
        text: "token-1",
        tokenCount: 1
      }
    });
    expect(OraEventEnvelopeSchema.parse(envelopes[3])).toMatchObject({
      type: "message.delta",
      payload: {
        role: "assistant",
        content: "message-1"
      }
    });
    expect(OraEventEnvelopeSchema.parse(envelopes[5])).toMatchObject({
      type: "checkpoint.created",
      payload: {
        checkpoint: { checkpointId: "ckpt-1" }
      }
    });
  });

  it("creates a compiled graph for each MVP pattern through the public registry", () => {
    for (const pattern of [
      "generator_verifier",
      "orchestrator_subagent",
      "agent_teams"
    ] as const) {
      const graph = createPatternGraph(pattern);

      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");
    }
  });
});
