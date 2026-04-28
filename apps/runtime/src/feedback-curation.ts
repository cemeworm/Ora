import {
  EvaluationFeedbackDraftCaseSchema,
  RunConfig,
  RunTrail,
  SessionTranscriptMessage,
  StateSnapshot
} from "@ora/shared";
import { parseJsonObject } from "./provider-json.js";
import { invokeRunProvider } from "./providers/index.js";
import { summarizeEventPayload } from "./run-projections.js";
import { assistantTextForRun } from "./session-title.js";

export interface FeedbackSourceContextDeps {
  getRunTrail: (params: { runId: string }) => Promise<RunTrail>;
  sessionTranscript: (sessionId: string) => SessionTranscriptMessage[];
}

export async function buildFeedbackSourceContext(
  snapshot: StateSnapshot,
  deps: FeedbackSourceContextDeps,
): Promise<Record<string, unknown>> {
  const trail = await deps.getRunTrail({ runId: snapshot.runId }).catch(() => undefined);
  const transcript = snapshot.sessionId
    ? deps.sessionTranscript(snapshot.sessionId).slice(-8).map((message) => ({
        role: message.role,
        content: message.content,
        runId: message.runId,
        turnIndex: message.turnIndex,
      }))
    : [];
  return {
    runId: snapshot.runId,
    sessionId: snapshot.sessionId,
    turnIndex: snapshot.turnIndex,
    userPrompt: snapshot.input.prompt,
    assistantOutput: assistantTextForRun(snapshot),
    transcript,
    pattern: snapshot.pattern,
    modeId: snapshot.modeId,
    providerId: typeof snapshot.config.providerId === "string" ? snapshot.config.providerId : undefined,
    modelRef: typeof snapshot.config.modelRef === "string" ? snapshot.config.modelRef : undefined,
    status: snapshot.status,
    trail: trail
      ? {
          liveMetrics: trail.liveMetrics,
          trace: {
            enabled: trail.trace.enabled,
            available: trail.trace.available,
            traceId: trail.trace.traceId,
            source: trail.trace.source,
            generationCount: trail.trace.generationRefs.length,
          },
          observations: trail.observations.slice(0, 12).map((observation) => ({
            id: observation.id,
            type: observation.type,
            name: observation.name,
            level: observation.level,
            statusMessage: observation.statusMessage,
            model: observation.model,
          })),
        }
      : undefined,
    topology: {
      nodes: snapshot.topology.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        role: typeof node.metadata.role === "string" ? node.metadata.role : node.kind,
        status: node.status,
      })),
      edges: snapshot.topology.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        label: edge.label,
        kind: edge.kind,
      })),
    },
    events: snapshot.events.slice(-20).map((event) => ({
      type: event.type,
      seq: event.seq,
      nodeId: event.nodeId,
      agentId: event.agentId,
      payload: summarizeEventPayload(event.payload),
    })),
  };
}

export async function curateFeedbackDraft(
  config: RunConfig,
  feedbackId: string,
  feedbackText: string,
  sourceContext: Record<string, unknown>,
) {
  const response = await invokeRunProvider(config, {
    system: [
      "You are Ora's independent evaluation dataset curator.",
      "Convert natural-language user feedback about an assistant reply into one JSON evaluation draft.",
      "Do not grade the original run. Produce a future-facing evaluation case.",
      "Return only JSON with keys: case, curatorRationale.",
      "The case must match Ora EvaluationCase: { id, input: { prompt, context }, expected, metadata }.",
      "Put failureMode, severity, idealBehavior, mustAddress, shouldAvoid, rubric in expected.structured.",
      "Use metadata.source='chat_feedback' and include feedbackId, sourceRunId, failureMode, severity, tags.",
    ].join("\n"),
    messages: [{
      role: "user",
      content: JSON.stringify({
        feedbackId,
        feedbackText,
        sourceContext,
      }, null, 2),
    }],
    temperature: 0,
    maxTokens: 1400,
    toolChoice: "none",
  });
  const parsed = parseJsonObject(response.text);
  const draftSource = parsed.case
    ? {
        case: parsed.case,
        curatorRationale: typeof parsed.curatorRationale === "string" ? parsed.curatorRationale : undefined,
      }
    : {
        case: parsed,
        curatorRationale: "Curator returned an EvaluationCase object.",
      };
  return EvaluationFeedbackDraftCaseSchema.parse({
    ...draftSource,
    curatorStatus: "generated",
  });
}
