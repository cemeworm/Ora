import type {
  CoordinationPattern,
  OraEventEnvelope,
  OraEventType
} from "@ora/shared";

// LangGraph stream event types that we adapt to Ora events.
interface GraphNodeStartEvent {
  event: "on_chain_start" | "on_chat_model_start";
  name: string;
  data?: Record<string, unknown>;
}

interface GraphNodeEndEvent {
  event: "on_chain_end" | "on_chat_model_end";
  name: string;
  data?: Record<string, unknown>;
  output?: unknown;
}

interface GraphCheckpointEvent {
  event: "on_checkpoint";
  data?: Record<string, unknown>;
}

interface GraphStreamEvent {
  event: "on_chain_stream" | "on_chat_model_stream";
  name: string;
  data?: Record<string, unknown>;
  chunk?: unknown;
}

type GraphEvent =
  | GraphNodeStartEvent
  | GraphNodeEndEvent
  | GraphCheckpointEvent
  | GraphStreamEvent
  | { event: string; name?: string; data?: Record<string, unknown>; output?: unknown; chunk?: unknown };

/**
 * Adapts LangGraph stream events to Ora event envelopes.
 * Maps LangGraph node start/end events to Ora topology.updated, action.updated.
 * Maps LangGraph checkpoint events to Ora checkpoint.created.
 * Maps LangGraph stream events to Ora message.delta, token.delta.
 */
export function adaptGraphEvents(
  graphEvents: GraphEvent[],
  runId: string,
  pattern: CoordinationPattern,
  clock: () => number = Date.now
): OraEventEnvelope[] {
  const envelopes: OraEventEnvelope[] = [];
  let seq = 0;

  const emit = (type: OraEventType, payload: unknown, extra: Partial<OraEventEnvelope> = {}): OraEventEnvelope => {
    const envelope: OraEventEnvelope = {
      id: `${runId}:evt-${seq}`,
      runId,
      seq,
      type,
      createdAt: clock(),
      pattern,
      payload,
      ...extra,
    };
    envelopes.push(envelope);
    seq++;
    return envelope;
  };

  for (const event of graphEvents) {
    const eventType = event.event;

    if (eventType === "on_chain_start" || eventType === "on_chat_model_start") {
      // Node started
      const nodeName = event.name ?? "unknown";
      emit("topology.updated", {
        node: nodeName,
        status: "running",
        message: `Node ${nodeName} started.`,
      }, { nodeId: nodeName });
      emit("action.updated", {
        actionId: `${runId}:action:graph-${nodeName}`,
        status: "running",
        node: nodeName,
      });
    }

    if (eventType === "on_chain_end" || eventType === "on_chat_model_end") {
      // Node completed
      const nodeName = event.name ?? "unknown";
      emit("action.updated", {
        actionId: `${runId}:action:graph-${nodeName}`,
        status: "succeeded",
        node: nodeName,
        output: event.output ?? event.data,
      });
    }

    if (eventType === "on_checkpoint") {
      emit("checkpoint.created", {
        checkpoint: event.data,
        summary: "Checkpoint captured during graph execution.",
      });
    }

    if (eventType === "on_chain_stream" || eventType === "on_chat_model_stream") {
      const chunk = event.chunk ?? event.data;
      if (typeof chunk === "string") {
        emit("token.delta", {
          text: chunk,
          tokenCount: 1,
        });
      } else if (typeof chunk === "object" && chunk !== null) {
        const content = (chunk as Record<string, unknown>).content;
        if (typeof content === "string") {
          emit("message.delta", {
            role: "assistant",
            content,
          });
        }
      }
    }
  }

  return envelopes;
}
