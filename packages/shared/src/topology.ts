import { z } from "zod";

export const TopologyNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["run", "agent", "capability", "checkpoint", "artifact"]),
  agentId: z.string().min(1).optional(),
  status: z.enum(["idle", "running", "blocked", "done", "failed"]).default("idle"),
  metadata: z.record(z.unknown()).default({})
});
export type TopologyNode = z.infer<typeof TopologyNodeSchema>;

export const TopologyEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: z.enum(["control", "delegation", "verification", "memory", "artifact"]),
  metadata: z.record(z.unknown()).default({})
});
export type TopologyEdge = z.infer<typeof TopologyEdgeSchema>;
