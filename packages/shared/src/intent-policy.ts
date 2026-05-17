import { z } from "zod";
import type { TaskIntent } from "./runtime.js";
import {
  CODE_DEVELOPMENT_MODE_ID,
  DEEP_RESEARCH_MODE_ID,
  REVIEW_CRITIQUE_MODE_ID,
  SINGLE_AGENT_MODE_ID,
} from "./primitives.js";

/* ── Intent Policy — modeId + taskIntent → execution contract ─────────── */

export const IntentStagePolicySchema = z.enum([
  "run",
  "skip",
  "read_only",
  "degraded",
]);
export type IntentStagePolicy = z.infer<typeof IntentStagePolicySchema>;

export const IntentBehaviorRuleSchema = z.object({
  taskIntent: z.enum(["chat", "plan", "implement"]),
  writeAllowed: z.boolean(),
  stopAfterStage: z.string().optional(),
  skipStages: z.array(z.string()).default([]),
  stageOverrides: z.record(z.string(), IntentStagePolicySchema).default({}),
  completionContract: z.string().min(1),
});
export type IntentBehaviorRule = z.infer<typeof IntentBehaviorRuleSchema>;

export const ModeIntentPolicySchema = z.object({
  modeId: z.string().min(1),
  rules: z.record(z.enum(["chat", "plan", "implement"]), IntentBehaviorRuleSchema),
});
export type ModeIntentPolicy = z.infer<typeof ModeIntentPolicySchema>;

/* ── Canonical policies per user task mode ─────────────────────────────── */

export const DIRECT_INTENT_POLICY: ModeIntentPolicy = ModeIntentPolicySchema.parse({
  modeId: SINGLE_AGENT_MODE_ID,
  rules: {
    chat: {
      taskIntent: "chat",
      writeAllowed: false,
      skipStages: [],
      completionContract: "直接回答用户问题，可以解释和检索但不执行修改操作",
    },
    plan: {
      taskIntent: "plan",
      writeAllowed: false,
      skipStages: [],
      completionContract: "仅产出简短计划或方案，不执行任何修改操作",
    },
    implement: {
      taskIntent: "implement",
      writeAllowed: true,
      skipStages: [],
      completionContract: "仅适合低风险单步动作；复杂任务应 route 到领域 mode",
    },
  },
});

export const CODE_AGENT_INTENT_POLICY: ModeIntentPolicy = ModeIntentPolicySchema.parse({
  modeId: CODE_DEVELOPMENT_MODE_ID,
  rules: {
    chat: {
      taskIntent: "chat",
      writeAllowed: false,
      stopAfterStage: "context_scan",
      skipStages: ["implement", "verify", "repair", "delivery"],
      stageOverrides: {
        scope: "read_only",
        context_scan: "read_only",
        delivery: "read_only",
      },
      completionContract: "只解释或检查代码，不修改任何文件",
    },
    plan: {
      taskIntent: "plan",
      writeAllowed: false,
      stopAfterStage: "context_scan",
      skipStages: ["implement", "verify", "repair", "delivery"],
      stageOverrides: {
        scope: "read_only",
        context_scan: "read_only",
        implement: "skip",
        verify: "skip",
        repair: "skip",
        delivery: "skip",
      },
      completionContract: "产出 proposed plan 后停止，不修改文件",
    },
    implement: {
      taskIntent: "implement",
      writeAllowed: true,
      skipStages: [],
      stageOverrides: {
        scope: "read_only",
        context_scan: "read_only",
        verify: "read_only",
        delivery: "read_only",
        repair: "degraded",
      },
      completionContract: "执行完整链路：Scope → Context Scan → Implement → Verify → Repair(按需) → Delivery。写权限集中在 Builder 和 Repair 阶段",
    },
  },
});

export const DEEP_RESEARCH_INTENT_POLICY: ModeIntentPolicy = ModeIntentPolicySchema.parse({
  modeId: DEEP_RESEARCH_MODE_ID,
  rules: {
    chat: {
      taskIntent: "chat",
      writeAllowed: false,
      skipStages: ["source_collection", "evidence_matrix", "gap_review", "citation_check"],
      stageOverrides: {
        scope: "read_only",
        research_plan: "read_only",
        synthesis: "read_only",
      },
      completionContract: "简要调查并回答，保留来源可追踪性",
    },
    plan: {
      taskIntent: "plan",
      writeAllowed: false,
      stopAfterStage: "research_plan",
      skipStages: ["source_collection", "evidence_matrix", "gap_review", "synthesis", "citation_check"],
      stageOverrides: {
        scope: "read_only",
        research_plan: "read_only",
      },
      completionContract: "产出研究计划后停止，不执行搜索",
    },
    implement: {
      taskIntent: "implement",
      writeAllowed: false,
      skipStages: [],
      stageOverrides: {},
      completionContract: "执行完整研究链路，最终输出必须有来源、证据矩阵、缺口审查和引用校验支撑",
    },
  },
});

export const REVIEW_CRITIQUE_INTENT_POLICY: ModeIntentPolicy = ModeIntentPolicySchema.parse({
  modeId: REVIEW_CRITIQUE_MODE_ID,
  rules: {
    chat: {
      taskIntent: "chat",
      writeAllowed: false,
      skipStages: [],
      stageOverrides: {
        scope: "read_only",
        inspect: "read_only",
        findings: "read_only",
        verdict: "read_only",
      },
      completionContract: "只读审查，产出 findings 和 verdict",
    },
    plan: {
      taskIntent: "plan",
      writeAllowed: false,
      skipStages: [],
      stageOverrides: {
        scope: "read_only",
        inspect: "read_only",
        findings: "read_only",
        verdict: "read_only",
      },
      completionContract: "只产出审查方案，不执行修改",
    },
    implement: {
      taskIntent: "implement",
      writeAllowed: true,
      skipStages: [],
      stageOverrides: {
        scope: "read_only",
        inspect: "read_only",
        findings: "read_only",
      },
      completionContract: "审查后可在 Fix 阶段修改；写权限限于 Fix 阶段",
    },
  },
});

export const BUILT_IN_INTENT_POLICIES: ModeIntentPolicy[] = [
  DIRECT_INTENT_POLICY,
  CODE_AGENT_INTENT_POLICY,
  DEEP_RESEARCH_INTENT_POLICY,
  REVIEW_CRITIQUE_INTENT_POLICY,
];

/* ── Resolution helpers ─────────────────────────────────────────────────── */

export function resolveIntentPolicy(
  modeId: string,
  taskIntent: TaskIntent,
): IntentBehaviorRule | undefined {
  const policy = BUILT_IN_INTENT_POLICIES.find((candidate) => candidate.modeId === modeId);
  return policy?.rules[taskIntent];
}

export function effectiveWriteAllowed(
  modeId: string,
  taskIntent: TaskIntent,
): boolean {
  return resolveIntentPolicy(modeId, taskIntent)?.writeAllowed ?? false;
}

export function effectiveSkipStages(
  modeId: string,
  taskIntent: TaskIntent,
): string[] {
  return resolveIntentPolicy(modeId, taskIntent)?.skipStages ?? [];
}

export function effectiveStopAfterStage(
  modeId: string,
  taskIntent: TaskIntent,
): string | undefined {
  return resolveIntentPolicy(modeId, taskIntent)?.stopAfterStage;
}
