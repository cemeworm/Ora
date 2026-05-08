import { z } from "zod";

export const BuiltInTopologyNodeKindSchema = z.enum(["run", "agent", "capability", "checkpoint", "artifact"]);
export const TopologyNodeKindSchema = BuiltInTopologyNodeKindSchema.or(z.string());

export const TopologyNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: TopologyNodeKindSchema,
  agentId: z.string().min(1).optional(),
  status: z.enum(["idle", "running", "blocked", "done", "failed"]).default("idle"),
  metadata: z.record(z.unknown()).default({})
});
export type TopologyNode = z.infer<typeof TopologyNodeSchema>;

/**
 * Edge between two topology nodes.
 *
 * NOTE: `kind` is CURRENTLY VISUALIZATION/OBSERVABILITY ONLY. The runtime execution engine
 * (mode drivers, topological sort) does not branch on edge kind — it only reads `source` and
 * `target`. The single consumer that inspects `kind` is `feedback-curation.ts`, which uses it
 * for human-readable context descriptions. Do not assume the engine routes differently based on
 * edge kind. This may change in the future if edge-aware routing is added to mode drivers.
 */
export const BuiltInTopologyEdgeKindSchema = z.enum(["control", "delegation", "verification", "memory", "artifact"]);
export const TopologyEdgeKindSchema = BuiltInTopologyEdgeKindSchema.or(z.string());

/**
 * Edge between two topology nodes.
 *
 * NOTE: `kind` is CURRENTLY VISUALIZATION/OBSERVABILITY ONLY. The runtime execution engine
 * (mode drivers, topological sort) does not branch on edge kind — it only reads `source` and
 * `target`. The single consumer that inspects `kind` is `feedback-curation.ts`, which uses it
 * for human-readable context descriptions. Do not assume the engine routes differently based on
 * edge kind. This may change in the future if edge-aware routing is added to mode drivers.
 */
export const TopologyEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: TopologyEdgeKindSchema,
  metadata: z.record(z.unknown()).default({})
});
export type TopologyEdge = z.infer<typeof TopologyEdgeSchema>;
