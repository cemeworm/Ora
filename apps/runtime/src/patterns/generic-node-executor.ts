import type { ModeNodeSpec, ModeSpec } from "@cemeworm/shared";
import type { PatternExecutionContext } from "./execution-context.js";
import { nodeAtomIds, titleForNode } from "./driver-utils.js";

export async function runGenericModeNode(
  context: PatternExecutionContext,
  modeSpec: ModeSpec,
  node: ModeNodeSpec,
  totalActiveNodes: number,
  completedNodes: number,
  execute: () => Promise<unknown>,
): Promise<number> {
  const clarificationQuestion = typeof node.config?.clarificationQuestion === "string"
    ? node.config.clarificationQuestion
    : undefined;
  if (modeSpec.runtimeAtoms.includes("clarification_interrupt") && clarificationQuestion) {
    try {
      await context.ensureClarification({
        id: `clarification:${node.id}`,
        key: typeof node.config?.clarificationKey === "string" ? node.config.clarificationKey : node.id,
        nodeId: node.id,
        nodeLabel: node.label,
        question: clarificationQuestion,
      });
    } catch (error) {
      context.setPlanStatus(node.id, "blocked");
      context.setQueueSummary({
        pending: Math.max(0, totalActiveNodes - completedNodes),
        inProgress: 0,
        completed: completedNodes,
      });
      throw error;
    }
  }
  context.setPlanStatus(node.id, "running");
  context.setQueueSummary({
    pending: Math.max(0, totalActiveNodes - completedNodes - 1),
    inProgress: 1,
    completed: completedNodes,
  });
  const recovered = await context.runRecoverableNode({
    nodeId: node.id,
    nodeTemplate: node.template,
    nodeLabel: node.label,
    agentId: node.ownerAgentId ?? node.id,
  }, () => (
    nodeAtomIds(node).has("subagent_delegate")
      ? context.runDelegatedTask({
          taskId: `task:${node.id}`,
          nodeId: node.id,
          nodeLabel: node.label,
          agentId: node.ownerAgentId ?? node.id,
          title: titleForNode(node, node.label),
        }, execute)
      : execute()
  ));
  const result = recovered.output;
  const nextCompleted = completedNodes + 1;
  if (recovered.status === "skipped") {
    context.setPlanStatus(node.id, "skipped");
    context.setQueueSummary({
      pending: Math.max(0, totalActiveNodes - nextCompleted),
      inProgress: 0,
      completed: nextCompleted,
    });
    return nextCompleted;
  }
  if (modeSpec.runtimeAtoms.includes("memory_capture") && result !== undefined) {
    context.captureMemory({
      id: `atom-memory-${node.id}-${completedNodes + 1}`,
      namespace: ["session", context.projectId, modeSpec.family, "memory_capture"],
      kind: "session",
      value: {
        nodeId: node.id,
        nodeLabel: node.label,
        output: result,
      },
    });
  }
  if (nodeAtomIds(node).has("artifact_publish") && result !== undefined) {
    context.publishArtifact({
      id: `${node.id}-artifact-${completedNodes + 1}`,
      label: `${node.label} artifact`,
      kind: "log",
      mimeType: "application/json",
      payload: {
        nodeId: node.id,
        nodeLabel: node.label,
        output: result,
      },
    });
  }
  context.setPlanStatus(node.id, "done");
  context.setQueueSummary({
    pending: Math.max(0, totalActiveNodes - nextCompleted),
    inProgress: 0,
    completed: nextCompleted,
  });
  return nextCompleted;
}

export { runGenericModeNode as runModeNode };
