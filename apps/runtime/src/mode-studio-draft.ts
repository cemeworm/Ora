import { z } from "zod";
import {
  BuiltInCoordinationPattern,
  CoordinationPattern,
  CustomAgentGeneratedDraft,
  DEFAULT_WEB_TOOL_IDS,
  DEFAULT_RESOURCE_BUDGETS,
  ORA_ROOT_AGENT_ID,
  ORA_ROOT_AGENT_LABEL,
  ModeStudioContextResult,
  ModeStudioDraftBundle,
  ModeStudioDraftBundleSchema,
  ModeStudioGenerateDraftParams,
  ModeStudioStartBuilderRunParams,
  ModeSpecSchema,
  MVP_MODE_RUNTIME_ATOMS,
  PatternDefinition,
  getModeNodeRuntimeTemplateDefinition,
  getPatternDefinition,
  type ModeCreateParams,
  type ModeStageSpec,
  type ModeTranscriptLayout,
  type ModeSpec
} from "@cemeworm/shared";
import { normalizeGeneratedAgentDraft } from "./agent-draft.js";
import { parseJsonObject } from "./provider-json.js";

const ModeStudioBuilderProviderResponseSchema = z.object({
  assistantMessage: z.string().min(1),
  needsInput: z.boolean().default(false),
  modeDraft: z.unknown().optional(),
  agentDrafts: z.array(z.unknown()).default([]),
  changeSummary: z.array(z.string().min(1)).default([]),
  issues: z.array(z.object({
    field: z.string().min(1).default("general"),
    message: z.string().min(1),
  })).default([]),
});

export type ModeStudioBuilderProviderResponse = z.infer<typeof ModeStudioBuilderProviderResponseSchema>;

export function parseModeStudioBuilderProviderText(text: string) {
  try {
    return ModeStudioBuilderProviderResponseSchema.safeParse(parseJsonObject(text));
  } catch {
    return ModeStudioBuilderProviderResponseSchema.safeParse(undefined);
  }
}

export function modeStudioBuilderSystemPrompt(): string {
  return [
    "You are Ora Mode Studio's runtime builder agent system.",
    "Return strict JSON only. Do not use markdown or commentary outside JSON.",
    "Generate or refine a complete ModeStudio draft bundle from the supplied context, but ask focused clarification questions before generating when the mode design is incomplete.",
    "The JSON shape is: {\"assistantMessage\": string, \"needsInput\": boolean, \"modeDraft\": ModeSpec, \"agentDrafts\": CustomAgentGeneratedDraft[], \"changeSummary\": string[], \"issues\": [{\"field\": string, \"message\": string}]}",
    "A complete mode design defines: purpose, audience or operating context, topology/family, stages, agent roster and responsibilities, handoffs, tools/skills/runtime atoms, approval and safety posture, stop/completion policy, success criteria, and failure behavior.",
    "If any critical design area is missing, set needsInput true and ask 1-3 concrete questions in assistantMessage. You may include a preview-safe modeDraft, but it must not be presented as ready to apply.",
    "If the design is complete enough, set needsInput false and make assistantMessage summarize the proposed mode and tell the user they can apply it or keep chatting to refine it.",
    "ModeDraft must use Ora ModeSpec fields exactly. Keep family and node templates compatible with the selected topology.",
    "For structured staged workflows, use ModeSpec.stages[] plus transcriptLayout. stages[] is linear and each stage must reference an existing nodeId and, when speakerId is set, an existing profile id.",
    "Available transcript layouts for apply-ready drafts: stage_list for ordinary sequential workflows; two_sided_duel for debate/pro-con/red-team-blue-team/attack-defense flows; rubric_matrix for evaluation rubrics with criteria rows and score columns; judge_panel for multi-judge review with a final verdict; evidence_board for research with evidence grouped by category; comparison_table for side-by-side option comparison across dimensions; artifact_gallery for displaying generated artifacts as a card grid; kanban_pipeline for pipeline/kanban views with horizontal stage columns. Use only code-provided layout fields, not arbitrary UI.",
    "For two_sided_duel, set transcriptLayout.sideByStance, stanceLabels, summaryStances, and groupId/groupLabel. Keep stance strings open and descriptive, for example red_team/blue_team or affirmative/negative.",
    "Name the mode for the actual user purpose, not by copying the entire prompt. Use a concise human label and a lowercase kebab-case id.",
    "Every enabled stage must have ownerAgentId, concrete instructions, a concrete prompt, and config.story explaining what happens in that stage.",
    "Every generated agent must include name, description, toolGroups, toolIds, skillIds, and long-form soul instructions.",
    "If the current draft contains manual edits, preserve them unless the user explicitly asks to change them.",
    "Set systemPreset false and visibility user on generated modes.",
  ].join("\n");
}

export function modeStudioBuilderUserPrompt(
  params: ModeStudioStartBuilderRunParams,
  context: ModeStudioContextResult,
): string {
  const contextPayload = {
    operation: params.operation,
    messages: params.messages,
    baseModeId: params.baseModeId,
    currentDraft: params.currentDraft,
    previousDraftBundle: params.draftBundle,
    validation: params.draftBundle?.validation,
    availableModes: context.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      family: mode.family,
      summary: mode.summary,
      templates: mode.nodes.map((node) => node.template),
    })),
    availableAgents: context.agents.map((agent) => ({
      name: agent.name,
      description: agent.description,
      toolIds: agent.toolIds,
      skillIds: agent.skillIds,
    })),
    availableTools: context.tools.tools.map((tool) => ({
      id: tool.id,
      label: tool.label,
      riskLevel: tool.riskLevel,
    })),
    availableSkills: context.skills.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      enabled: skill.enabled,
    })),
    availableAtoms: context.atoms.map((atom) => ({
      id: atom.id,
      scope: atom.scope,
      compatibleFamilies: atom.compatibleFamilies,
    })),
    availableTranscriptLayouts: [
      {
        style: "stage_list",
        use: "Default sequential staged transcript for research→analysis→synthesis or plan→execute→verify workflows.",
      },
      {
        style: "two_sided_duel",
        use: "Two-sided debate, red-team/blue-team, attack/defense, support/opposition, or pro/con review.",
      },
      {
        style: "rubric_matrix",
        use: "Evaluation rubric with criteria rows and scored dimensions as columns. For code review, PRD review, candidate evaluation, or architecture scoring.",
      },
      {
        style: "judge_panel",
        use: "Multi-judge review with separate evaluations and a final consolidated verdict. For safety gates, quality checks, go/no-go decisions.",
      },
      {
        style: "evidence_board",
        use: "Research evidence grouped by category with color-coded cards. For fact-checking, due diligence, source analysis.",
      },
      {
        style: "comparison_table",
        use: "Side-by-side comparison of options across multiple dimensions. For tool selection, technical route comparison, option analysis.",
      },
      {
        style: "artifact_gallery",
        use: "Card grid display of generated artifacts or outputs. For multi-file generation, prompt variants, batch processing.",
      },
      {
        style: "kanban_pipeline",
        use: "Horizontal pipeline with stage columns. For issue triage, content production, batch processing workflows.",
      },
    ],
  };
  return [
    "Generate or refine the Mode Studio draft from this runtime context.",
    "Respect existing currentDraft values unless the latest user message asks to change them.",
    "Before returning an apply-ready draft, check whether the conversation has enough detail for a complete mode design: goal, audience/context, topology, stages, agents, handoffs, capabilities, safety/approval posture, success criteria, and failure behavior.",
    "When details are missing, return needsInput true with targeted questions. When details are sufficient, return needsInput false and summarize that the user can apply the draft or continue refining.",
    JSON.stringify(contextPayload, null, 2),
    "Return only the strict JSON object.",
  ].join("\n\n");
}

type ModeStudioDesignArea =
  | "goal"
  | "topology"
  | "outcome"
  | "acceptance"
  | "capabilities"
  | "safety";

export interface ModeStudioDesignCompleteness {
  complete: boolean;
  missing: ModeStudioDesignArea[];
  questions: string[];
  assistantMessage: string;
}

interface ModeStudioRolePlan {
  profileId: string;
  label: string;
  role: string;
  style: string;
  toolIntent: "minimal" | "research" | "code" | "review";
}

export function modeStudioUserText(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function isVagueModeStudioRequest(text: string): boolean {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length < 10) return true;
  const words = compact.split(/\s+/).filter(Boolean);
  return words.length < 3 && !/[\u4e00-\u9fff]/.test(compact);
}

export function assessModeStudioDesignCompleteness(
  text: string,
  params: {
    currentDraft?: ModeSpec;
    previousDraftBundle?: ModeStudioDraftBundle;
  } = {},
): ModeStudioDesignCompleteness {
  const compact = text.replace(/\s+/g, " ").trim();
  const lower = compact.toLowerCase();
  const hasApplyReadyPriorDraft = params.previousDraftBundle?.needsInput === false &&
    params.previousDraftBundle.validation.valid;
  const hasGoal = !isVagueModeStudioRequest(compact) &&
    !/^(mode|模式|自定义模式|custom mode|做一个\s*mode|帮我做一个\s*mode)$/i.test(compact);
  const hasTopology = /(single|solo|agent|agents|builder|reviewer|verifier|checker|team|parallel|orchestrator|subagent|route|bus|shared|单个|智能体|多个|多人|并行|分工|团队|主控|派发|生成|验证|审查|审核|路由|共享)/i.test(lower);
  const hasOutcome = /(output|deliver|final|answer|report|summary|list|decision|result|handoff|输出|产出|交付|最终|答案|报告|摘要|列表|结论|通过|不通过|交接)/i.test(lower);
  const hasAcceptance = /(success|criteria|acceptance|verify|review|check|test|risk|quality|done|failure|edge|成功|标准|验收|验证|审查|审核|检查|测试|风险|质量|完成|失败|边界)/i.test(lower);
  const hasCapabilities = /(tool|tools|skill|skills|web|search|source|file|repo|shell|terminal|github|memory|mcp|工具|技能|搜索|来源|文件|仓库|命令|终端|记忆)/i.test(lower);
  const hasSafety = /(approval|approve|permission|human|safe|safety|risk|guard|confirm|审批|批准|权限|人工|安全|风险|确认)/i.test(lower);
  const hasDraftContext = Boolean(params.currentDraft || params.previousDraftBundle?.modeDraft);
  const signalCount = [
    hasGoal,
    hasTopology,
    hasOutcome || hasAcceptance,
    hasCapabilities || hasSafety || hasDraftContext,
  ].filter(Boolean).length;
  const complete = hasApplyReadyPriorDraft || (hasGoal && signalCount >= 3);
  const missing: ModeStudioDesignArea[] = [];
  if (!hasGoal) missing.push("goal");
  if (!hasTopology && !hasDraftContext) missing.push("topology");
  if (!hasOutcome) missing.push("outcome");
  if (!hasAcceptance) missing.push("acceptance");
  if (!hasCapabilities && !hasDraftContext) missing.push("capabilities");
  if (!hasSafety && /(shell|terminal|github|file|repo|命令|终端|仓库)/i.test(lower)) missing.push("safety");

  const questions = missing
    .map((area) => modeStudioClarificationQuestion(area))
    .filter((question, index, all) => all.indexOf(question) === index)
    .slice(0, 3);

  return {
    complete,
    missing,
    questions,
    assistantMessage: complete
      ? "这个 mode 的设计信息已经足够生成可应用草稿。你可以应用它，也可以继续补充要求让我 refine。"
      : [
          "我还需要补齐几个关键设计点，才能生成可应用的 mode：",
          ...questions.map((question) => `- ${question}`),
        ].join("\n"),
  };
}

function modeStudioClarificationQuestion(area: ModeStudioDesignArea): string {
  switch (area) {
    case "goal":
      return "这个 mode 主要服务哪类任务或用户场景？";
    case "topology":
      return "你希望它是单 agent、生成-验证、主控派发，还是多个 agent 分工并行？";
    case "outcome":
      return "最终输出应该长什么样，例如报告、列表、结论、代码改动摘要或交接记录？";
    case "acceptance":
      return "什么算这次 mode 运行成功，哪些风险、测试或质量标准必须检查？";
    case "capabilities":
      return "它需要哪些能力或工具，例如 web 搜索、文件读取、shell、GitHub、记忆或特定技能？";
    case "safety":
      return "哪些操作需要人工审批或更严格的安全边界？";
  }
}

export function inferModeStudioFamily(text: string, fallback: CoordinationPattern): CoordinationPattern {
  const lower = text.toLowerCase();
  const layoutIntent = modeStudioStructuredLayoutIntent(lower);
  // 有 staged layout 意图的模式都需要 orchestrator_subagent 来执行 stages[]
  if (layoutIntent.style) return "orchestrator_subagent";
  if (/(parallel|team|roles|roster|multiple|多人|多个|并行|分工|团队)/i.test(lower)) return "agent_teams";
  if (/(verify|verifier|review|critic|rubric|审核|审查|验证|互审|严格)/i.test(lower)) return "generator_verifier";
  if (/(route|event|bus|publish|subscribe|routing|路由|事件|消息)/i.test(lower)) return "message_bus";
  if (/(shared|blackboard|state|memory|collaborate|共享|黑板|状态|长期记忆)/i.test(lower)) return "shared_state";
  if (/(decompose|delegate|orchestrate|subagent|拆解|派发|编排|主控)/i.test(lower)) return "orchestrator_subagent";
  return fallback === "shared_state" || fallback === "message_bus" || fallback === "agent_teams" || fallback === "generator_verifier"
    ? fallback
    : "orchestrator_subagent";
}

export function modeStudioRolePlans(family: CoordinationPattern, text: string): ModeStudioRolePlan[] {
  const strict = /(strict|critical|risk|严谨|严格|风险|批判)/i.test(text);
  const fast = /(fast|speed|quick|快速|速度|轻量)/i.test(text);
  const creative = /(creative|brainstorm|idea|创意|发散)/i.test(text);
  const plannerStyle = strict ? "careful planner" : creative ? "creative planner" : "structured planner";
  const builderStyle = fast ? "fast builder" : strict ? "careful builder" : "focused builder";
  const reviewerStyle = strict ? "strict reviewer" : "balanced reviewer";
  if (family === "orchestrator_subagent" && modeStudioStructuredLayoutIntent(text).style === "two_sided_duel") {
    const duel = modeStudioDuelSides(text);
    return [
      { profileId: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "Frame the staged review and synthesize the final judgment.", style: plannerStyle, toolIntent: "minimal" },
      { profileId: duel.left.id, label: duel.left.label, role: duel.left.role, style: "adversarial reviewer", toolIntent: "review" },
      { profileId: duel.right.id, label: duel.right.label, role: duel.right.role, style: "defensive reviewer", toolIntent: "review" },
    ];
  }
  if (family === "generator_verifier") {
    return [
      { profileId: "generator", label: "Generator", role: "Produce the candidate result from the user's goal.", style: builderStyle, toolIntent: "code" },
      { profileId: "verifier", label: "Verifier", role: "Check the result against acceptance criteria and risks.", style: reviewerStyle, toolIntent: "review" },
    ];
  }
  if (family === "agent_teams") {
    return [
      { profileId: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "Prioritize work and coordinate the agent roster.", style: plannerStyle, toolIntent: "minimal" },
      { profileId: "builder", label: "Builder", role: "Complete assigned implementation or production work.", style: builderStyle, toolIntent: "code" },
      { profileId: "reviewer", label: "Reviewer", role: "Validate outputs, edge cases, and missing evidence.", style: reviewerStyle, toolIntent: "review" },
    ];
  }
  if (family === "message_bus") {
    return [
      { profileId: "router", label: "Router", role: "Classify requests and route them to the right handler.", style: "decisive router", toolIntent: "minimal" },
      { profileId: "researcher", label: "Researcher", role: "Handle routed work and publish findings.", style: "evidence-first researcher", toolIntent: "research" },
      { profileId: "responder", label: "Responder", role: "Synthesize routed findings into a final answer.", style: "clear responder", toolIntent: "review" },
    ];
  }
  if (family === "shared_state") {
    return [
      { profileId: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "Seed the shared board with the first hypothesis and plan.", style: plannerStyle, toolIntent: "minimal" },
      { profileId: "researcher", label: "Researcher", role: "Add new evidence and alternatives to shared state.", style: "curious researcher", toolIntent: "research" },
      { profileId: "reviewer", label: "Reviewer", role: "Validate convergence and challenge weak assumptions.", style: reviewerStyle, toolIntent: "review" },
    ];
  }
  return [
    { profileId: ORA_ROOT_AGENT_ID, label: ORA_ROOT_AGENT_LABEL, role: "Plan, delegate, and synthesize the mode run.", style: plannerStyle, toolIntent: "minimal" },
    { profileId: "researcher", label: "Research Subagent", role: "Gather focused context before execution.", style: "evidence-first researcher", toolIntent: "research" },
    { profileId: "reviewer", label: "Review Subagent", role: "Check completeness, risks, and acceptance criteria.", style: reviewerStyle, toolIntent: "review" },
  ];
}

export function modeStudioToolIds(intent: ModeStudioRolePlan["toolIntent"], text: string): string[] {
  const wantsWeb = /(web|search|research|source|sources|资料|搜索|来源|研究)/i.test(text);
  const wantsCode = /(code|repo|file|shell|test|build|代码|仓库|文件|测试|构建|实现)/i.test(text);
  const ids = new Set<string>();
  if (intent === "research" || wantsWeb) {
    for (const toolId of DEFAULT_WEB_TOOL_IDS) ids.add(toolId);
  }
  if (intent === "code" || wantsCode) {
    ids.add("file.read");
    ids.add("file.grep");
    if (/(shell|test|build|命令|测试|构建)/i.test(text)) ids.add("shell.execute");
  }
  if (intent === "review") {
    ids.add("file.read");
    ids.add("file.grep");
  }
  return [...ids];
}

export function prepareModeStudioDraft(
  source: ModeSpec,
  text: string,
  agentDrafts: CustomAgentGeneratedDraft[],
  params: Pick<ModeStudioGenerateDraftParams, "currentDraft">,
): ModeSpec {
  const now = Date.now();
  const idBase = params.currentDraft && !params.currentDraft.systemPreset
    ? params.currentDraft.id
    : `${slugifyModeStudio(modeStudioPurpose(text)) || "guided-mode"}-mode`;
  const agentNames = agentDrafts.map((agent) => agent.name);
  return {
    ...source,
    id: slugifyModeStudio(idBase) || "guided-mode",
    label: modeStudioLabel(text),
    systemPreset: false,
    createdAt: params.currentDraft?.createdAt ?? now,
    updatedAt: now,
    profiles: source.profiles.map((profile, index) => ({
      ...profile,
      customAgentId: agentNames[index] ?? profile.customAgentId,
    })),
  };
}

function modeStudioStructuredLayoutIntent(text: string): { style?: ModeTranscriptLayout["style"] } {
  if (/(debate|red\s*team|blue\s*team|red-team|blue-team|attack|defense|defence|pro\/con|pro-con|support|opposition|courtroom|辩论|正方|反方|红队|蓝队|攻防|支持|反对)/i.test(text)) {
    return { style: "two_sided_duel" };
  }
  if (/(rubric|matrix|scoring|评分|矩阵|打分|评分标准|评审标准)/i.test(text)) {
    return { style: "rubric_matrix" };
  }
  if (/(judge|panel|verdict|jury|评审团|裁决|判决|安全门|quality.?gate|go\/no.?go)/i.test(text)) {
    return { style: "judge_panel" };
  }
  if (/(evidence|investigat|fact.?check|due.?diligence|证据|调查|事实核查|尽职调查)/i.test(text)) {
    return { style: "evidence_board" };
  }
  if (/(compar(ison|e)|versus|option.*?(?:a|b)|对比|比较|选型|方案对比)/i.test(text)) {
    return { style: "comparison_table" };
  }
  if (/(gallery|artifact|portfolio|制品|画廊|作品集|批量生成)/i.test(text)) {
    return { style: "artifact_gallery" };
  }
  if (/(kanban|pipeline|triage|funnel|看板|流水线|分拣|漏斗)/i.test(text)) {
    return { style: "kanban_pipeline" };
  }
  return {};
}

function modeStudioDuelSides(text: string) {
  if (/(debate|pro\/con|pro-con|support|opposition|辩论|正方|反方|支持|反对)/i.test(text)) {
    return {
      left: {
        id: "affirmative",
        label: "Affirmative",
        role: "Argue for the proposal, strongest interpretation, or support case.",
        stance: "affirmative",
      },
      right: {
        id: "negative",
        label: "Negative",
        role: "Argue against the proposal, expose missing proof, and pressure the opposing case.",
        stance: "negative",
      },
      groupId: "structured-debate",
      groupLabel: "Structured Debate",
    };
  }
  return {
    left: {
      id: "red_team",
      label: "Red Team",
      role: "Attack the plan's riskiest assumptions, failure modes, and exploitable gaps.",
      stance: "red_team",
    },
    right: {
      id: "blue_team",
      label: "Blue Team",
      role: "Defend the plan, propose mitigations, and strengthen the implementation path.",
      stance: "blue_team",
    },
    groupId: "red-blue-review",
    groupLabel: "Red/Blue Review",
  };
}

function modeStudioDuelStagePrompt(): string {
  return [
    "User request:\n{{prompt}}",
    "Framing:\n{{decompose}}",
    "Current speaker: {{speakerLabel}}",
    "Assigned stance: {{stance}}",
    "Stage instruction: {{stageInstruction}}",
    "Prior transcript:\n{{priorTranscript}}",
    "Write only this stage's contribution. Stay in role, respond to prior transcript when useful, and keep the argument concrete.",
  ].join("\n\n");
}

export function modeStudioStagedDraft(mode: ModeSpec, text: string, rolePlans: ModeStudioRolePlan[]): ModeSpec {
  if (modeStudioStructuredLayoutIntent(text).style !== "two_sided_duel" || mode.family !== "orchestrator_subagent") {
    return normalizeModeStudioStagesAndLayout(mode, text);
  }

  const duel = modeStudioDuelSides(text);
  const baseProfile = mode.profiles[0];
  const profiles = [
    {
      ...(baseProfile ?? mode.profiles[0]!),
      id: ORA_ROOT_AGENT_ID,
      label: ORA_ROOT_AGENT_LABEL,
      role: "Frame the staged exchange and synthesize the final decision.",
      toolPolicyId: baseProfile?.toolPolicyId ?? "orchestrator_subagent.default",
      toolIds: modeStudioToolIds("minimal", text),
      skillIds: baseProfile?.skillIds ?? [],
      memoryNamespaces: baseProfile?.memoryNamespaces ?? ["session", "project"],
      budget: baseProfile?.budget ?? DEFAULT_RESOURCE_BUDGETS.orchestrator_subagent,
    },
    ...[duel.left, duel.right].map((side, index) => {
      const role = rolePlans.find((candidate) => candidate.profileId === side.id);
      const source = mode.profiles[index + 1] ?? baseProfile;
      return {
        ...(source ?? baseProfile!),
        id: side.id,
        label: side.label,
        role: role?.role ?? side.role,
        toolPolicyId: source?.toolPolicyId ?? "orchestrator_subagent.default",
        toolIds: modeStudioToolIds("review", text),
        skillIds: source?.skillIds ?? [],
        memoryNamespaces: source?.memoryNamespaces ?? ["session", "project"],
        budget: source?.budget ?? DEFAULT_RESOURCE_BUDGETS.orchestrator_subagent,
      };
    }),
  ];
  const frameNode = mode.nodes.find((node) => node.template === "decompose") ?? mode.nodes[0];
  const exchangeNode = mode.nodes.find((node) => node.template === "research") ?? mode.nodes.find((node) => node.template === "review") ?? frameNode;
  const synthesisNode = mode.nodes.find((node) => node.template === "synthesize") ?? mode.nodes.at(-1) ?? exchangeNode;
  const promptTemplate = modeStudioDuelStagePrompt();
  const stages: ModeStageSpec[] = [
    {
      id: `${duel.left.stance}-opening`,
      label: "Opening pressure",
      nodeId: exchangeNode.id,
      speakerId: duel.left.id,
      speakerLabel: duel.left.label,
      stance: duel.left.stance,
      instruction: "Open with the strongest case for this side and name the core burden of proof.",
      promptTemplate,
    },
    {
      id: `${duel.right.stance}-response`,
      label: "Response",
      nodeId: exchangeNode.id,
      speakerId: duel.right.id,
      speakerLabel: duel.right.label,
      stance: duel.right.stance,
      instruction: "Answer the opening case, identify weak assumptions, and make the strongest opposing case.",
      promptTemplate,
    },
    {
      id: `${duel.left.stance}-rebuttal`,
      label: "Rebuttal",
      nodeId: exchangeNode.id,
      speakerId: duel.left.id,
      speakerLabel: duel.left.label,
      stance: duel.left.stance,
      instruction: "Rebut the response and sharpen the strongest unresolved pressure.",
      promptTemplate,
    },
    {
      id: `${duel.right.stance}-closing`,
      label: "Closing",
      nodeId: exchangeNode.id,
      speakerId: duel.right.id,
      speakerLabel: duel.right.label,
      stance: duel.right.stance,
      instruction: "Close with the strongest final answer and practical mitigation or rejection criteria.",
      promptTemplate,
    },
    {
      id: "moderator-synthesis",
      label: "Synthesis",
      nodeId: synthesisNode.id,
      speakerId: ORA_ROOT_AGENT_ID,
      speakerLabel: ORA_ROOT_AGENT_LABEL,
      stance: ORA_ROOT_AGENT_ID,
      outputKey: "synthesis",
    },
  ];
  const transcriptLayout: ModeTranscriptLayout = {
    style: "two_sided_duel",
    groupId: duel.groupId,
    groupLabel: duel.groupLabel,
    sideByStance: {
      [duel.left.stance]: "left",
      [duel.right.stance]: "right",
    },
    stanceLabels: {
      [duel.left.stance]: duel.left.label,
      [duel.right.stance]: duel.right.label,
      ora: ORA_ROOT_AGENT_LABEL,
      neutral: "Neutral",
    },
    stanceTones: {
      [duel.left.stance]: duel.left.stance === "red_team" ? "red" : "green",
      [duel.right.stance]: "blue",
      ora: "violet",
      neutral: "gray",
    },
    summaryStances: [ORA_ROOT_AGENT_ID, "neutral"],
    showStatus: true,
    showSpeaker: true,
  };

  return normalizeModeStudioStagesAndLayout(ModeSpecSchema.parse({
    ...mode,
    profiles,
    nodes: mode.nodes.map((node) => ({
      ...node,
      ownerAgentId: node.id === synthesisNode.id || node.id === frameNode.id ? ORA_ROOT_AGENT_ID : node.ownerAgentId,
      enabled: node.template === "review" && node.id !== exchangeNode.id ? false : node.enabled,
    })),
    stages,
    transcriptLayout,
  }), text);
}

function normalizeModeStudioStagesAndLayout(mode: ModeSpec, text: string): ModeSpec {
  const nodeIds = new Set(mode.nodes.map((node) => node.id));
  const profileIds = new Set(mode.profiles.map((profile) => profile.id));
  const fallbackNode = mode.nodes.find((node) => node.template === "research")
    ?? mode.nodes.find((node) => node.template === "synthesize")
    ?? mode.nodes[0];
  const normalizedStages = mode.stages?.map((stage) => {
    const node = nodeIds.has(stage.nodeId) ? mode.nodes.find((candidate) => candidate.id === stage.nodeId) : fallbackNode;
    const speakerId = stage.speakerId && profileIds.has(stage.speakerId)
      ? stage.speakerId
      : node?.ownerAgentId && profileIds.has(node.ownerAgentId)
        ? node.ownerAgentId
        : mode.profiles[0]?.id;
    return {
      ...stage,
      nodeId: node?.id ?? stage.nodeId,
      speakerId,
    };
  });
  const layoutIntent = modeStudioStructuredLayoutIntent(text);
  const layout = mode.transcriptLayout
    ?? (normalizedStages?.length
      ? {
          style: (layoutIntent.style ?? "stage_list") as ModeTranscriptLayout["style"],
          groupId: slugifyModeStudio(mode.label) || mode.id,
          groupLabel: mode.label,
          ...(layoutIntent.style === "judge_panel" ? { summaryStances: ["moderator", "verdict"] } : {}),
          ...(layoutIntent.style === "evidence_board" ? { groupBy: "stance" as const } : {}),
          ...(layoutIntent.style === "kanban_pipeline" ? { lanes: deriveKanbanLanesFromStages(normalizedStages) } : {}),
          showStatus: true,
          showSpeaker: true,
        }
      : undefined);
  return ModeSpecSchema.parse({
    ...mode,
    stages: normalizedStages,
    transcriptLayout: layout,
  });
}

function deriveKanbanLanesFromStages(stages?: ModeStageSpec[]): Array<{ id: string; label: string }> {
  if (!stages) return [];
  const seen = new Set<string>();
  const lanes: Array<{ id: string; label: string }> = [];
  for (const stage of stages) {
    if (!seen.has(stage.id)) {
      lanes.push({ id: stage.id, label: stage.label });
      seen.add(stage.id);
    }
  }
  return lanes;
}

export function modeStudioLabel(text: string): string {
  const purpose = modeStudioPurpose(text);
  const label = purpose.length > 40 ? `${purpose.slice(0, 40).trim()} Mode` : `${purpose} Mode`;
  return label.replace(/\s+/g, " ").trim() || "Guided Mode";
}

export function modeStudioSummary(text: string, fallback: string): string {
  const purpose = modeStudioPurpose(text);
  return purpose ? `Guided mode for ${purpose}.` : fallback;
}

export function modeStudioDescription(text: string, pattern: PatternDefinition): string {
  return [
    `This mode was generated from a Mode Studio guided builder conversation for: ${modeStudioPurpose(text)}.`,
    `It uses the ${pattern.label} topology so agents can follow explicit roles, handoffs, and validation boundaries.`,
  ].join(" ");
}

export function modeStudioPurpose(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.slice(0, 96) || "a custom workflow";
}

export function isCoordinationPattern(value: string): value is CoordinationPattern {
  return value === "generator_verifier"
    || value === "orchestrator_subagent"
    || value === "agent_teams"
    || value === "message_bus"
    || value === "shared_state";
}

export function modeStudioNeedsInputBundle(
  source: ModeSpec,
  params: Pick<ModeStudioStartBuilderRunParams, "messages" | "currentDraft">,
  message: string,
): ModeStudioDraftBundle {
  const text = modeStudioUserText(params.messages);
  return ModeStudioDraftBundleSchema.parse({
    modeDraft: prepareModeStudioDraft(params.currentDraft ?? source, text, [], params),
    agentDrafts: [],
    guidance: {
      step: "goal",
      assistantMessage: `这次 builder run 还不能生成可应用草稿：${message}`,
      choices: modeStudioTopologyChoices(),
    },
    changeSummary: ["Kept the current draft unchanged because the builder could not produce a valid bundle."],
    validation: { valid: false, errors: [], warnings: [] },
    needsInput: true,
  });
}

export function enrichModeStudioGeneratedDraft(
  mode: ModeSpec,
  params: {
    text: string;
    agentDrafts: CustomAgentGeneratedDraft[];
    currentDraft?: ModeSpec;
  },
): ModeSpec {
  const agentNames = params.agentDrafts.map((agent) => agent.name);
  const profiles = mode.profiles.map((profile, index) => ({
    ...profile,
    customAgentId: profile.customAgentId ?? agentNames[index] ?? params.currentDraft?.profiles[index]?.customAgentId,
    systemPrompt: profile.systemPrompt ?? params.agentDrafts[index]?.soul ?? profile.role,
    toolIds: profile.toolIds.length > 0 ? profile.toolIds : params.agentDrafts[index]?.toolIds ?? profile.toolIds,
    skillIds: profile.skillIds.length > 0 ? profile.skillIds : params.agentDrafts[index]?.skillIds ?? profile.skillIds,
  }));
  return normalizeModeStudioStagesAndLayout(ModeSpecSchema.parse({
    ...mode,
    systemPreset: false,
    visibility: "user",
    profiles,
    nodes: mode.nodes.map((node) => {
      const currentNode = params.currentDraft?.nodes.find((candidate) => candidate.id === node.id);
      const ownerAgentId = node.ownerAgentId ?? currentNode?.ownerAgentId ?? profiles[0]?.id;
      const prompt = node.prompt?.trim()
        ? node.prompt
        : currentNode?.prompt?.trim()
          ? currentNode.prompt
          : modeStudioNodePrompt(node.template, params.text, undefined);
      const instructions = node.instructions?.trim()
        ? node.instructions
        : currentNode?.instructions?.trim()
          ? currentNode.instructions
          : getModeNodeRuntimeTemplateDefinition(mode.family, node.template).fallbackInstructions;
      return {
        ...node,
        ownerAgentId,
        instructions,
        prompt,
        config: {
          ...currentNode?.config,
          ...node.config,
          story: node.config?.story ?? currentNode?.config?.story ?? modeStudioNodeStoryConfig(mode.family, node, ownerAgentId, profiles, params.text),
        },
      };
    }),
    capabilityFlags: {
      ...mode.capabilityFlags,
      toolIds: [...new Set([
        ...mode.capabilityFlags.toolIds,
        ...params.agentDrafts.flatMap((agent) => agent.toolIds),
      ])],
      skillIds: [...new Set([
        ...mode.capabilityFlags.skillIds,
        ...params.agentDrafts.flatMap((agent) => agent.skillIds),
      ])],
    },
  }), params.text);
}

export function modeStudioRuntimeAtoms(family: CoordinationPattern, text: string, existing: ModeSpec["runtimeAtoms"]): ModeSpec["runtimeAtoms"] {
  const atoms = new Set(existing);
  const add = (atomId: ModeSpec["runtimeAtoms"][number]) => {
    const atom = MVP_MODE_RUNTIME_ATOMS.find((candidate) => candidate.id === atomId);
    if (atom?.compatibleFamilies.includes(family)) {
      atoms.add(atomId);
    }
  };
  add("thread_workspace");
  add("tool_error_boundary");
  if (/(memory|remember|长期|记忆|上下文)/i.test(text) || family === "agent_teams") add("memory_capture");
  if (family === "agent_teams") add("persistent_worker_memory");
  if (family === "message_bus") add("event_routing");
  if (family === "shared_state") add("shared_blackboard");
  if (/(clarify|ask|澄清|提问)/i.test(text)) add("clarification_interrupt");
  return [...atoms];
}

export function ownerForModeStudioTemplate(template: ModeSpec["nodes"][number]["template"], roles: ModeStudioRolePlan[]): string | undefined {
  const byId = new Set(roles.map((role) => role.profileId));
  if ((template === "verify" || template === "review" || template === "check" || template === "converge") && byId.has("verifier")) return "verifier";
  if ((template === "verify" || template === "review" || template === "check" || template === "converge") && byId.has("reviewer")) return "reviewer";
  if ((template === "research" || template === "handle") && byId.has("researcher")) return "researcher";
  if ((template === "draft" || template === "build") && byId.has("generator")) return "generator";
  if ((template === "draft" || template === "build") && byId.has("builder")) return "builder";
  if ((template === "decompose" || template === "synthesize") && byId.has(ORA_ROOT_AGENT_ID)) return ORA_ROOT_AGENT_ID;
  if ((template === "triage" || template === "handoff") && byId.has(ORA_ROOT_AGENT_ID)) return ORA_ROOT_AGENT_ID;
  if ((template === "route" || template === "publish") && byId.has("router")) return "router";
  if ((template === "respond") && byId.has("responder")) return "responder";
  if ((template === "seed") && byId.has(ORA_ROOT_AGENT_ID)) return ORA_ROOT_AGENT_ID;
  return roles[0]?.profileId;
}

export function modeStudioNodePrompt(template: ModeSpec["nodes"][number]["template"], text: string, existing?: string): string {
  const base = existing?.trim();
  if (base) return base;
  const guidance = `For this stage, stay aligned with the user's Mode Studio goal: ${modeStudioPurpose(text)}.`;
  return guidance;
}

export function modeStudioNodeStoryConfig(
  family: CoordinationPattern,
  node: ModeSpec["nodes"][number],
  ownerAgentId: string | undefined,
  profiles: ModeSpec["profiles"],
  text: string,
) {
  const owner = profiles.find((profile) => profile.id === ownerAgentId);
  const ownerLabel = owner?.label ?? ownerAgentId ?? "Runtime";
  const definition = getModeNodeRuntimeTemplateDefinition(family, node.template);
  const ownerCapabilities = [
    ...(owner?.toolIds ?? []),
    ...(owner?.skillIds ?? []),
  ];
  const nodeAtoms = Array.isArray(node.config?.atoms)
    ? node.config.atoms.filter((value): value is string => typeof value === "string")
    : [];
  const capabilityHint = [
    ownerCapabilities.length > 0 ? `${ownerCapabilities.length} assigned capabilities` : "",
    nodeAtoms.length > 0 ? `${nodeAtoms.length} stage capabilities` : "",
  ].filter(Boolean).join(" and ");
  const purpose = modeStudioPurpose(text);
  const capabilityClause = capabilityHint ? ` using ${capabilityHint}` : "";

  return {
    summary: `${ownerLabel} handles "${purpose}" through this ${node.template.replace(/_/g, " ")} stage: ${definition.description}${capabilityClause}.`,
    generatedBy: "mode_studio_builder" as const,
    updatedAt: Date.now(),
  };
}

export function modeStudioGuidance(family: CoordinationPattern, text: string) {
  const choices = [
    {
      id: "style-strict",
      label: "Make review stricter",
      description: "Tighten reviewer behavior around risks, missing tests, and contradictions.",
      prompt: "让审查 agent 更严格，优先指出风险、缺失验证和不清晰的验收标准。",
    },
    {
      id: "parallel-more",
      label: "Use more parallel work",
      description: "Bias the mode toward more independent agent work before synthesis.",
      prompt: "这个 mode 更偏多个 agent 分工并行，然后再汇总。",
    },
    {
      id: "tools-minimal",
      label: "Keep tools minimal",
      description: "Reduce mounted tools unless a role clearly needs them.",
      prompt: "保持工具能力最小化，只给 agent 分配完成职责必须的工具。",
    },
  ];
  return {
    step: "preview" as const,
    assistantMessage: `我生成了一版可应用的 ${getPatternDefinition(family).label} mode 草稿。你可以点 Apply 创建它，也可以继续聊天调整 agent 风格、并行方式、工具/技能范围或验收标准。`,
    choices: /(parallel|并行|多个|team|团队)/i.test(text)
      ? choices.filter((choice) => choice.id !== "parallel-more")
      : choices,
  };
}

export function modeStudioTopologyChoices() {
  return [
    {
      id: "topology-generator-verifier",
      label: "Generator + Verifier",
      description: "One agent produces, another agent checks against criteria.",
      prompt: "使用生成-验证结构，一个 agent 负责产出，另一个 agent 负责严格审查。",
    },
    {
      id: "topology-orchestrator",
      label: "Orchestrator + Subagents",
      description: "A lead agent decomposes the task and delegates focused work.",
      prompt: "使用主控 agent 拆解任务，再派发给 researcher/reviewer 等 subagent。",
    },
    {
      id: "topology-team",
      label: "Team Parallel",
      description: "Multiple role agents divide work and can run more independently.",
      prompt: "使用多个 agent 分工协作，尽量让可独立的阶段并行推进。",
    },
  ];
}

export function modeStudioFamilyReason(family: CoordinationPattern): string {
  const builtInFamily = family as BuiltInCoordinationPattern;
  switch (builtInFamily) {
    case "generator_verifier":
      return "a production stage followed by explicit verification";
    case "agent_teams":
      return "multiple role agents or parallel division of labor";
    case "message_bus":
      return "event routing across handlers";
    case "shared_state":
      return "collaboration through shared state or memory";
    case "orchestrator_subagent":
      return "decomposition and delegated subagent work";
    default:
      builtInFamily satisfies never;
      return "decomposition and delegated subagent work";
  }
}

export function slugifyModeStudio(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, "guided")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function modeCreateParamsFromSpec(spec: ModeSpec): ModeCreateParams {
  const {
    id,
    family,
    label,
    summary,
    description,
    recommendedUse,
    failureMode,
    visibility,
    nodes,
    edges,
    stopPolicy,
    capabilityFlags,
    editorConstraints,
    defaultBudget,
    profiles,
    runtimeAtoms,
    stages,
    transcriptLayout,
    completionPolicy,
    runtimePolicy,
    recoveryPolicy,
    memoryPolicy,
    toolLimits,
  } = spec;
  return {
    id,
    family,
    label,
    summary,
    description,
    recommendedUse,
    failureMode,
    visibility,
    nodes,
    edges,
    stopPolicy,
    capabilityFlags,
    editorConstraints,
    defaultBudget,
    profiles,
    runtimeAtoms,
    stages,
    transcriptLayout,
    completionPolicy,
    runtimePolicy,
    recoveryPolicy,
    memoryPolicy,
    toolLimits,
  };
}

export { normalizeGeneratedAgentDraft };
