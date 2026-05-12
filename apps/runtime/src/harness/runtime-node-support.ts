import type { OraEventEnvelope } from "@cemeworm/shared";
import {
  classifyRecoveryError,
  isRecoveryExhaustedError,
  type RecoveryCoordinator,
  type RecoveryDecision,
  type RecoveryIncident,
} from "./recovery-policy.js";
import {
  ApprovalInterruptError,
  ClarificationInterruptError,
} from "./runtime-interrupts.js";

type RuntimeNodeSupportEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

export async function runRecoverableRuntimeNode<T>(
  params: {
    nodeId: string;
    nodeTemplate: string;
    nodeLabel: string;
    agentId?: string;
  },
  execute: () => Promise<T>,
  deps: {
    recoveryCoordinator: RecoveryCoordinator;
    emitRecoveryDecision: (
      incident: RecoveryIncident,
      decision: RecoveryDecision,
    ) => void;
    publishRecoveryArtifact: (
      incident: RecoveryIncident,
      decision: RecoveryDecision,
    ) => { id: string };
    sleep: (ms: number) => Promise<void>;
    emit: RuntimeNodeSupportEmit;
  },
): Promise<
  { status: "completed"; output: T } | { status: "skipped"; output?: unknown }
> {
  while (true) {
    try {
      const output = await execute();
      return { status: "completed", output };
    } catch (error) {
      if (
        error instanceof ApprovalInterruptError ||
        error instanceof ClarificationInterruptError
      ) {
        throw error;
      }
      if (isRecoveryExhaustedError(error)) {
        throw error;
      }
      const incident = classifyRecoveryError(error, {
        surface: "node",
        nodeId: params.nodeId,
        nodeTemplate: params.nodeTemplate,
        agentId: params.agentId,
      });
      const recoveryDecision = deps.recoveryCoordinator.resolve(incident);
      deps.emitRecoveryDecision(incident, recoveryDecision);

      if (recoveryDecision.action === "retry") {
        await deps.sleep(recoveryDecision.retryDelayMs ?? 0);
        continue;
      }

      if (recoveryDecision.action === "skip_node") {
        deps.emit(
          "node.skipped",
          {
            nodeId: params.nodeId,
            nodeLabel: params.nodeLabel,
            decision: recoveryDecision,
            error: incident.detail,
          },
          { nodeId: params.nodeId, agentId: params.agentId },
        );
        return { status: "skipped", output: recoveryDecision.usableOutput };
      }

      if (recoveryDecision.action === "fallback_artifact") {
        const recoveryArtifact = deps.publishRecoveryArtifact(
          incident,
          recoveryDecision,
        );
        return {
          status: "completed",
          output: (recoveryDecision.usableOutput ?? {
            degraded: true,
            recoveryArtifactId: recoveryArtifact.id,
            nodeId: params.nodeId,
            errorType: incident.errorType,
            error: incident.detail,
          }) as T,
        };
      }

      throw error;
    }
  }
}

export async function runRuntimeDelegatedTask<T>(
  params: {
    taskId: string;
    nodeId: string;
    nodeLabel: string;
    agentId: string;
    title: string;
  },
  execute: () => Promise<T>,
  deps: {
    emit: RuntimeNodeSupportEmit;
  },
): Promise<T> {
  deps.emit(
    "task.started",
    {
      taskId: params.taskId,
      nodeId: params.nodeId,
      nodeLabel: params.nodeLabel,
      title: params.title,
    },
    { agentId: params.agentId, nodeId: params.nodeId },
  );
  deps.emit(
    "task.progress",
    {
      taskId: params.taskId,
      nodeId: params.nodeId,
      nodeLabel: params.nodeLabel,
      title: params.title,
      phase: "running",
    },
    { agentId: params.agentId, nodeId: params.nodeId },
  );
  try {
    const result = await execute();
    deps.emit(
      "task.completed",
      {
        taskId: params.taskId,
        nodeId: params.nodeId,
        nodeLabel: params.nodeLabel,
        title: params.title,
      },
      { agentId: params.agentId, nodeId: params.nodeId },
    );
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    deps.emit(
      "task.failed",
      {
        taskId: params.taskId,
        nodeId: params.nodeId,
        nodeLabel: params.nodeLabel,
        title: params.title,
        error: detail,
      },
      { agentId: params.agentId, nodeId: params.nodeId },
    );
    throw error;
  }
}
