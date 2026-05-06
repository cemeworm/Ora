import path from "node:path";
import type { SkillListParams } from "@cemeworm/shared";
import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { RuntimeToolExecutionContext, SkillRegistryTools } from "./runtime-tool-executor.js";
import { readPositiveInt } from "./runtime-tool-utils.js";
import { prefersChinese, stringArg } from "./runtime-tool-approval.js";

const SKILL_FIRST_GUIDELINE = "Skill-first rule: when the user's request matches an available skill, inspect that skill before answering or acting. Use skills.get to read the full instructions for a matching skill when they are not already present in the prompt; use skills.list only when you need to rediscover enabled skills. Do not use skills for unrelated or trivial requests.";

export function skillToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "skills.list":
      return {
        promptExample: "{\"tool\":\"skills.list\",\"args\":{\"query\":\"frontend design\"}}",
        promptGuidelines: [SKILL_FIRST_GUIDELINE],
        execute: (args, context) => ({ output: listRuntimeSkills(context.skillRegistry, args) }),
      };
    case "skills.get":
      return {
        promptExample: "{\"tool\":\"skills.get\",\"args\":{\"name\":\"frontend-design\"}}",
        promptGuidelines: [SKILL_FIRST_GUIDELINE],
        execute: (args, context) => ({ output: getRuntimeSkill(context.skillRegistry, args) }),
      };
    case "skills.checkName":
      return {
        promptExample: "{\"tool\":\"skills.checkName\",\"args\":{\"name\":\"waza-think\"}}",
        promptGuidelines: [SKILL_FIRST_GUIDELINE],
        execute: (args, context) => ({ output: checkRuntimeSkillName(context.skillRegistry, args) }),
      };
    case "skills.create":
      return {
        promptExample: "{\"tool\":\"skills.create\",\"args\":{\"name\":\"waza-think\",\"description\":\"Think workflow\",\"content\":\"---\\nname: waza-think\\ndescription: Think workflow\\n---\\n...\",\"files\":[{\"path\":\"scripts/run.sh\",\"content\":\"echo ok\\n\",\"executable\":true}],\"enabled\":true}}",
        promptGuidelines: [
          SKILL_FIRST_GUIDELINE,
          "When installing skill packages, pass SKILL.md as content and include optional package files with relative paths such as scripts/run.sh in args.files.",
        ],
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        approvalRequest: skillCreateApprovalRequest,
        execute: (args, context) => ({ output: createRuntimeSkill(context.skillRegistry, args) }),
      };
    case "skills.update":
      return {
        promptExample: "{\"tool\":\"skills.update\",\"args\":{\"name\":\"waza-think\",\"content\":\"---\\nname: waza-think\\ndescription: Think workflow\\n---\\n...\"}}",
        promptGuidelines: [SKILL_FIRST_GUIDELINE],
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        approvalRequest: skillUpdateApprovalRequest,
        execute: (args, context) => ({ output: updateRuntimeSkill(context.skillRegistry, args) }),
      };
    case "skills.setEnabled":
      return {
        promptExample: "{\"tool\":\"skills.setEnabled\",\"args\":{\"name\":\"waza-think\",\"enabled\":true}}",
        promptGuidelines: [SKILL_FIRST_GUIDELINE],
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        approvalRequest: skillSetEnabledApprovalRequest,
        execute: (args, context) => ({ output: setRuntimeSkillEnabled(context.skillRegistry, args) }),
      };
    default:
      return {};
  }
}

function skillCreateApprovalRequest(args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = prefersChinese(context.userPrompt);
  const name = stringArg(args, "name", zh ? "这个技能" : "this skill");
  return zh
    ? {
        title: "需要你确认安装技能",
        summary: `我准备把“${name}”安装到 Ora 的本地技能库，并在安装后启用它。`,
        whatWillChange: "会新增一个本地技能条目，后续对话中的 agent 可以读取并使用它。",
        whyNeeded: "这是完成你刚才要求安装技能的必要步骤。",
        riskNote: "安装内容会写入本地 Ora 配置，确认前请确保来源和内容可信。",
        confirmLabel: "批准并继续",
      }
    : {
        title: "Confirm skill installation",
        summary: `I am ready to install "${name}" into Ora's local skill library and enable it afterward.`,
        whatWillChange: "A local skill entry will be added so agents can read and use it in later conversations.",
        whyNeeded: "This is needed to finish the skill installation you requested.",
        riskNote: "This writes local Ora configuration, so confirm only if the source and content are trusted.",
        confirmLabel: "Approve and continue",
      };
}

function skillUpdateApprovalRequest(args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = prefersChinese(context.userPrompt);
  const name = stringArg(args, "name", zh ? "这个技能" : "this skill");
  return zh
    ? {
        title: "需要你确认更新技能",
        summary: `我准备更新本地技能“${name}”的说明内容。`,
        whatWillChange: "这个技能之后会按新的说明运行。",
        whyNeeded: "这是应用你要求的技能变更所必需的步骤。",
        riskNote: "更新技能会改变 agent 后续使用该技能时遵循的规则。",
        confirmLabel: "批准并继续",
      }
    : {
        title: "Confirm skill update",
        summary: `I am ready to update the local instructions for "${name}".`,
        whatWillChange: "The skill will follow the new instructions afterward.",
        whyNeeded: "This is required to apply the skill change you requested.",
        riskNote: "Updating a skill changes the rules agents follow when they use it later.",
        confirmLabel: "Approve and continue",
      };
}

function skillSetEnabledApprovalRequest(args: Record<string, unknown>, context: { userPrompt?: string }) {
  const zh = prefersChinese(context.userPrompt);
  const name = stringArg(args, "name", zh ? "这个技能" : "this skill");
  const enabled = args.enabled === false ? (zh ? "停用" : "disable") : (zh ? "启用" : "enable");
  return zh
    ? {
        title: "需要你确认调整技能状态",
        summary: `我准备${enabled}本地技能“${name}”。`,
        whatWillChange: "这个技能在后续对话中是否可被 agent 使用会发生变化。",
        whyNeeded: "这是应用你要求的技能开关状态所必需的步骤。",
        riskNote: "技能可用性会影响后续 agent 的行为范围。",
        confirmLabel: "批准并继续",
      }
    : {
        title: "Confirm skill setting change",
        summary: `I am ready to ${enabled} the local skill "${name}".`,
        whatWillChange: "Whether agents can use this skill in later conversations will change.",
        whyNeeded: "This is required to apply the skill setting you requested.",
        riskNote: "Skill availability affects what agents can do later.",
        confirmLabel: "Approve and continue",
      };
}

function listRuntimeSkills(skillRegistry: SkillRegistryTools | undefined, args: Record<string, unknown>) {
  if (!skillRegistry) {
    throw new Error("A skill registry is required for skills.list.");
  }
  const category = args.category === "public" || args.category === "private"
    ? args.category
    : args.category === "custom"
      ? "private"
      : undefined;
  const params: SkillListParams = {
    ...(category ? { category } : {}),
    enabledOnly: args.enabledOnly === false ? false : true,
    ...(typeof args.query === "string" && args.query.trim() ? { query: args.query.trim() } : {}),
  };
  const limit = readPositiveInt(args.limit, 25, 100);
  const allSkills = skillRegistry.list(params);
  const skills = allSkills.slice(0, limit);
  return {
    skills,
    count: skills.length,
    truncated: allSkills.length > skills.length,
  };
}

function getRuntimeSkill(skillRegistry: SkillRegistryTools | undefined, args: Record<string, unknown>) {
  if (!skillRegistry) {
    throw new Error("A skill registry is required for skills.get.");
  }
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : undefined;
  if (!name) {
    throw new Error("skills.get requires a skill name.");
  }
  const detail = skillRegistry.get({ name });
  const localDirectory = detail.path ? path.dirname(detail.path) : undefined;
  return {
    ...detail,
    localDirectory,
    usageHint: [
      localDirectory ? `This skill is installed at ${localDirectory}; resolve relative references such as scripts/, references/, templates/, assets/, and evals/ from that directory.` : undefined,
      "If upstream instructions mention /mnt/skills/public or /mnt/skills/user, use this installed skill directory instead.",
      "If upstream instructions mention /mnt/user-data, use the selected Ora workspace or explicit user-provided file paths instead.",
    ].filter(Boolean).join(" "),
  };
}

function checkRuntimeSkillName(skillRegistry: SkillRegistryTools | undefined, args: Record<string, unknown>) {
  if (!skillRegistry) {
    throw new Error("A skill registry is required for skills.checkName.");
  }
  return skillRegistry.checkName(args);
}

function createRuntimeSkill(skillRegistry: SkillRegistryTools | undefined, args: Record<string, unknown>) {
  if (!skillRegistry) {
    throw new Error("A skill registry is required for skills.create.");
  }
  return skillRegistry.create(args);
}

function updateRuntimeSkill(skillRegistry: SkillRegistryTools | undefined, args: Record<string, unknown>) {
  if (!skillRegistry) {
    throw new Error("A skill registry is required for skills.update.");
  }
  return skillRegistry.update(args);
}

function setRuntimeSkillEnabled(skillRegistry: SkillRegistryTools | undefined, args: Record<string, unknown>) {
  if (!skillRegistry) {
    throw new Error("A skill registry is required for skills.setEnabled.");
  }
  return skillRegistry.setEnabled(args);
}
