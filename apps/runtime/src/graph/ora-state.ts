import { Annotation } from "@langchain/langgraph";
import type {
  ActionRecord,
  AgentProfile,
  ArtifactRef,
  CheckpointMeta,
  CoordinationPattern,
  MemoryRecord,
  OraEventEnvelope,
  OraToolCallEnvelope,
  PlanItem,
  PolicyDecision,
  RunConfig,
  TopologyEdge,
  TopologyNode,
  UserTaskInput
} from "@ora/shared";
import type { ModelMessage } from "../providers/index.js";

export const OraGraphAnnotation = Annotation.Root({
  runId: Annotation<string>,
  pattern: Annotation<CoordinationPattern>,
  input: Annotation<UserTaskInput>,
  conversationMessages: Annotation<ModelMessage[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  config: Annotation<RunConfig>,
  topology: Annotation<{ nodes: TopologyNode[]; edges: TopologyEdge[] }>,
  profiles: Annotation<AgentProfile[]>,
  memory: Annotation<MemoryRecord[]>({
    reducer: (a: MemoryRecord[], b: MemoryRecord[]) => [...a, ...b],
    default: () => [],
  }),
  plan: Annotation<PlanItem[]>,
  actions: Annotation<ActionRecord[]>({
    reducer: (a: ActionRecord[], b: ActionRecord[]) => [...a, ...b],
    default: () => [],
  }),
  toolCalls: Annotation<OraToolCallEnvelope[]>({
    reducer: (a: OraToolCallEnvelope[], b: OraToolCallEnvelope[]) => [...a, ...b],
    default: () => [],
  }),
  policyDecisions: Annotation<PolicyDecision[]>({
    reducer: (a: PolicyDecision[], b: PolicyDecision[]) => [...a, ...b],
    default: () => [],
  }),
  events: Annotation<OraEventEnvelope[]>({
    reducer: (a: OraEventEnvelope[], b: OraEventEnvelope[]) => [...a, ...b],
    default: () => [],
  }),
  checkpoints: Annotation<CheckpointMeta[]>({
    reducer: (a: CheckpointMeta[], b: CheckpointMeta[]) => [...a, ...b],
    default: () => [],
  }),
  artifacts: Annotation<ArtifactRef[]>({
    reducer: (a: ArtifactRef[], b: ArtifactRef[]) => [...a, ...b],
    default: () => [],
  }),
  output: Annotation<unknown>,
  error: Annotation<string | undefined>,
});

export type OraGraphState = typeof OraGraphAnnotation.State;
