import { describe, expect, it } from "vitest";
import { ORA_ROOT_AGENT_ID, ORA_ROOT_AGENT_LABEL } from "@cemeworm/shared";
import { deriveCurrentExecutorProjection } from "./currentExecutor";

function baseSnapshot() {
  return {
    profiles: [
      { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL },
      { id: "builder", label: "Builder" },
      { id: "reviewer", label: "Reviewer" },
      { id: "debugger", label: "Debugger" },
    ],
    childSessions: [],
    activeAgents: [] as string[],
    topology: { nodes: [], edges: [] },
    agentMessages: [],
    events: [],
  } as unknown as Parameters<typeof deriveCurrentExecutorProjection>[0];
}

describe("deriveCurrentExecutorProjection", () => {
  it("prefers a running mode-stage child session", () => {
    const projection = deriveCurrentExecutorProjection({
      ...baseSnapshot(),
      childSessions: [{
        id: "child-builder",
        agentId: "builder",
        label: "Builder",
        status: "running",
        authoritySource: "mode_stage",
        delegationKind: "mode_stage",
        updatedAt: 20,
        startedAt: 10,
        artifactIds: [],
      } as unknown as NonNullable<Parameters<typeof deriveCurrentExecutorProjection>[0]["childSessions"]>[number]],
      activeAgents: [ORA_ROOT_AGENT_ID, "builder"],
      topology: {
        nodes: [
          { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, kind: "agent", agentId: ORA_ROOT_AGENT_ID, status: "running", metadata: {} },
        ] as unknown as Parameters<typeof deriveCurrentExecutorProjection>[0]["topology"]["nodes"],
        edges: [],
      },
      events: [{
        id: "evt-root",
        runId: "run-test",
        seq: 1,
        type: "message.delta",
        agentId: ORA_ROOT_AGENT_ID,
        createdAt: 1,
        payload: { role: "assistant", content: "Ora 正在整理进展。" },
      }],
    });

    expect(projection).toEqual({
      agentId: "builder",
      agentLabel: "Builder",
      source: "mode_stage_child",
    });
  });

  it("falls back to a running non-root topology node", () => {
    const projection = deriveCurrentExecutorProjection({
      ...baseSnapshot(),
      topology: {
        nodes: [
          { id: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, kind: "agent", agentId: ORA_ROOT_AGENT_ID, status: "running", metadata: {} },
          { id: "reviewer", label: "Reviewer", kind: "agent", agentId: "reviewer", status: "running", metadata: {} },
        ],
        edges: [],
      },
    });

    expect(projection).toEqual({
      agentId: "reviewer",
      agentLabel: "Reviewer",
      source: "running_topology_node",
    });
  });

  it("falls back to activeAgents when there is no child session or running node", () => {
    const projection = deriveCurrentExecutorProjection({
      ...baseSnapshot(),
      activeAgents: [ORA_ROOT_AGENT_ID, "debugger"],
    });

    expect(projection).toEqual({
      agentId: "debugger",
      agentLabel: "Debugger",
      source: "active_agent",
    });
  });

  it("falls back to Ora when there is no active non-root executor", () => {
    const projection = deriveCurrentExecutorProjection(baseSnapshot());

    expect(projection).toEqual({
      agentId: ORA_ROOT_AGENT_ID,
      agentLabel: ORA_ROOT_AGENT_LABEL,
      source: "root_fallback",
    });
  });
});
