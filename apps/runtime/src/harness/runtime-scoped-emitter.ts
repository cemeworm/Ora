import type { OraEventEnvelope } from "@cemeworm/shared";

export type RuntimeEventEmit = (
  type: OraEventEnvelope["type"],
  payload: unknown,
  extra?: Partial<OraEventEnvelope>,
) => OraEventEnvelope;

export interface RuntimeEventScope {
  agentId?: string;
  nodeId?: string;
}

export function createScopedRuntimeEventEmitter(
  emit: RuntimeEventEmit,
  scope: RuntimeEventScope,
): RuntimeEventEmit {
  return (type, payload, extra = {}) => {
    const scopedExtra: Partial<OraEventEnvelope> = { ...extra };
    if (!scopedExtra.agentId && scope.agentId) {
      scopedExtra.agentId = scope.agentId;
    }
    if (!scopedExtra.nodeId && scope.nodeId) {
      scopedExtra.nodeId = scope.nodeId;
    }
    return emit(type, payload, scopedExtra);
  };
}
