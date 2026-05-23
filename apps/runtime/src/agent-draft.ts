import { z } from "zod";
import {
  CustomAgentCheckNameResult,
  CustomAgentCreateParamsSchema,
  CustomAgentGenerateDraftParams,
  CustomAgentGenerateDraftParamsSchema,
  CustomAgentGenerateDraftResult,
  CustomAgentGenerateDraftResultSchema,
  CustomAgentGeneratedDraft,
  CustomAgentGeneratedDraftSchema,
  RunConfigSchema,
  SINGLE_AGENT_MODE_ID
} from "@cemeworm/shared";
import { invokeRunProvider, type ModelMessage } from "./providers/index.js";
import { parseJsonObject } from "./provider-json.js";

const AgentDraftProviderResponseSchema = z.object({
  assistantMessage: z.string().min(1),
  draft: CustomAgentGeneratedDraftSchema.partial().optional(),
  needsInput: z.boolean().optional(),
  issues: z.array(z.object({
    field: z.enum(["name", "description", "model", "toolGroups", "soul", "general"]).default("general"),
    message: z.string().min(1),
  })).default([]),
});

export async function generateCustomAgentDraft(
  params: CustomAgentGenerateDraftParams | unknown,
  options: {
    existingNames: string[];
    checkName: (params: { name: string }) => CustomAgentCheckNameResult;
  },
): Promise<CustomAgentGenerateDraftResult> {
  const parsed = CustomAgentGenerateDraftParamsSchema.parse(params);
  const userText = parsed.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .join("\n")
    .trim();
  if (isVagueAgentDraftRequest(userText, parsed.partialDraft)) {
    return CustomAgentGenerateDraftResultSchema.parse({
      status: "needs_input",
      assistantMessage: "我可以帮你生成这个智能体。先告诉我它主要负责什么任务、希望怎样输出、以及是否需要使用 web / shell / github 这类工具。",
      draft: parsed.partialDraft,
      issues: [{ field: "description", message: "Need the agent's purpose and expected output style." }],
    });
  }

  const runConfig = RunConfigSchema.parse({
    pattern: "orchestrator_subagent",
    modeId: SINGLE_AGENT_MODE_ID,
    providerId: parsed.providerId,
    providerConfig: parsed.providerConfig,
    modelRef: parsed.modelRef || parsed.providerConfig?.modelId || undefined,
    deterministicSeed: "agent-draft-generation",
  });
  const request = {
    system: agentDraftSystemPrompt(options.existingNames),
    messages: parsed.messages.map((message): ModelMessage => ({
      role: message.role,
      content: message.content,
    })),
    prompt: agentDraftUserPrompt(parsed),
    temperature: 0.2,
    maxTokens: 1600,
    toolChoice: "none" as const,
  };

  const firstResponse = await invokeRunProvider(runConfig, request);
  const firstDraft = parseAgentDraftProviderText(firstResponse.text);
  const draftParseResult = firstDraft.success
    ? firstDraft
    : parseAgentDraftProviderText((await invokeRunProvider(runConfig, {
        system: "Repair the previous response into strict JSON only. Do not add markdown.",
        messages: [
          { role: "user", content: `Invalid response:\n${firstResponse.text}\n\nReturn JSON matching {"assistantMessage": string, "needsInput": boolean, "draft": {"name": string, "description": string, "model"?: string, "toolGroups": string[], "soul": string}, "issues": []}.` },
        ],
        temperature: 0,
        maxTokens: 1200,
        toolChoice: "none" as const,
      })).text);

  if (!draftParseResult.success) {
    return CustomAgentGenerateDraftResultSchema.parse({
      status: "needs_input",
      assistantMessage: "我没能把这次回复整理成可确认的智能体草稿。请再用一句话描述它的用途、输出风格和需要的工具。",
      draft: parsed.partialDraft,
      issues: [{ field: "general", message: "Draft generator returned invalid JSON." }],
    });
  }

  const parsedDraft = draftParseResult.data;
  if (parsedDraft.needsInput || !parsedDraft.draft) {
    return CustomAgentGenerateDraftResultSchema.parse({
      status: "needs_input",
      assistantMessage: parsedDraft.assistantMessage,
      draft: parsedDraft.draft ?? parsed.partialDraft,
      issues: parsedDraft.issues,
    });
  }

  const normalizedDraft = normalizeGeneratedAgentDraft(parsedDraft.draft);
  if (!normalizedDraft.description || !normalizedDraft.soul) {
    return CustomAgentGenerateDraftResultSchema.parse({
      status: "needs_input",
      assistantMessage: "这版草稿还缺少明确描述或 SOUL 指令。请补充这个智能体的职责、行为边界和好输出的标准。",
      draft: normalizedDraft,
      issues: [
        ...(!normalizedDraft.description ? [{ field: "description" as const, message: "Description is required." }] : []),
        ...(!normalizedDraft.soul ? [{ field: "soul" as const, message: "SOUL instructions are required." }] : []),
      ],
    });
  }
  const creatable = CustomAgentCreateParamsSchema.safeParse(normalizedDraft);
  if (!creatable.success) {
    return CustomAgentGenerateDraftResultSchema.parse({
      status: "needs_input",
      assistantMessage: "这版草稿还缺少有效名称、描述或 SOUL 指令。请补充这个智能体的职责和输出标准。",
      draft: normalizedDraft,
      issues: creatable.error.issues.map((issue) => ({
        field: fieldFromPath(issue.path),
        message: issue.message,
      })),
    });
  }

  const nameCheck = options.checkName({ name: creatable.data.name });
  if (!nameCheck.available) {
    return CustomAgentGenerateDraftResultSchema.parse({
      status: "needs_input",
      assistantMessage: `名称 ${nameCheck.name} 已经存在。请给我一个新的名称，或者说明这个智能体和现有智能体有什么区别。`,
      draft: creatable.data,
      issues: [{ field: "name", message: `Custom agent '${nameCheck.name}' already exists.` }],
    });
  }

  return CustomAgentGenerateDraftResultSchema.parse({
    status: "draft_ready",
    assistantMessage: parsedDraft.assistantMessage || "我生成了一版智能体草稿，请检查后确认创建。",
    draft: creatable.data,
    issues: parsedDraft.issues,
  });
}

export function normalizeGeneratedAgentDraft(draft: unknown): CustomAgentGeneratedDraft {
  const parsed = CustomAgentGeneratedDraftSchema.parse(draft);
  const name = parsed.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return {
    name,
    description: parsed.description.trim(),
    model: parsed.model?.trim() || undefined,
    toolGroups: [...new Set(parsed.toolGroups.map((group) => group.trim()).filter(Boolean))],
    toolIds: [...new Set(parsed.toolIds.map((toolId) => toolId.trim()).filter(Boolean))],
    skillIds: [...new Set(parsed.skillIds.map((skillId) => skillId.trim()).filter(Boolean))],
    soul: parsed.soul.trim(),
  };
}

function isVagueAgentDraftRequest(text: string, partialDraft: CustomAgentGenerateDraftParams["partialDraft"]): boolean {
  const signal = [
    text,
    partialDraft?.description,
    partialDraft?.soul,
  ].filter(Boolean).join(" ").trim();
  if (signal.length < 18) {
    return true;
  }
  const words = signal.split(/\s+/).filter(Boolean);
  return words.length < 4 && !/[\u4e00-\u9fff]/.test(signal);
}

function agentDraftSystemPrompt(existingNames: string[]): string {
  return [
    "You generate Ora custom agent drafts from a short natural-language setup conversation.",
    "Return strict JSON only. Do not use markdown or commentary outside JSON.",
    "The JSON shape must be: {\"assistantMessage\": string, \"needsInput\": boolean, \"draft\": {\"name\": string, \"description\": string, \"model\"?: string, \"toolGroups\": string[], \"soul\": string}, \"issues\": [{\"field\": \"name\"|\"description\"|\"model\"|\"toolGroups\"|\"soul\"|\"general\", \"message\": string}]}",
    "Ask for more input when the user's desired purpose, behavior, or output standard is unclear.",
    "When enough information is present, produce a complete draft. The name must be lowercase kebab-case with letters, digits, and hyphens only.",
    "Description should be one concise sentence. SOUL should be concrete long-form instructions for behavior, output quality, boundaries, and success criteria.",
    "Use toolGroups only when clearly useful; common values are web, shell, github. Leave model omitted unless the user requested a model.",
    existingNames.length > 0 ? `Existing custom agent names: ${existingNames.join(", ")}.` : "No existing custom agents.",
  ].join("\n");
}

function agentDraftUserPrompt(params: CustomAgentGenerateDraftParams): string {
  return [
    "Generate or refine an Ora custom agent draft from this conversation.",
    params.partialDraft ? `Current partial draft:\n${JSON.stringify(params.partialDraft, null, 2)}` : "",
    "Return only the strict JSON object.",
  ].filter(Boolean).join("\n\n");
}

function parseAgentDraftProviderText(text: string) {
  try {
    return AgentDraftProviderResponseSchema.safeParse(parseJsonObject(text));
  } catch {
    return AgentDraftProviderResponseSchema.safeParse(undefined);
  }
}

function fieldFromPath(pathValue: Array<string | number>): "name" | "description" | "model" | "toolGroups" | "soul" | "general" {
  const field = pathValue[0];
  return field === "name" ||
    field === "description" ||
    field === "model" ||
    field === "toolGroups" ||
    field === "soul"
    ? field
    : "general";
}
