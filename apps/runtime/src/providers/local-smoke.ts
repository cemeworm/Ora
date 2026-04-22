import type { ProviderConfig } from "@ora/shared";
import { normalizeMessages, splitInstructionMessages } from "./provider-utils.js";
import type { ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";

function stableSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function createLocalSmokeProvider(
  config: ProviderConfig,
  _options: ProviderRuntimeOptions = {}
): ModelProvider {
  return async (request) => {
    const messages = normalizeMessages(request);
    const { instructions, dialog } = splitInstructionMessages(messages);
    const prompt = stableSummary(
      dialog.map((message) => message.content).join("\n").trim() || request.prompt || ""
    );
    const instructionSummary = stableSummary(request.system?.trim() || instructions);

    const text = [
      `[${config.id}]`,
      prompt ? `prompt=${prompt}` : "prompt=",
      instructionSummary ? `instructions=${instructionSummary}` : "instructions=",
      `tokens=${request.maxTokens ?? config.maxTokens ?? 0}`,
    ].join(" ");

    const raw = {
      provider: config.type,
      model: config.modelId,
      prompt,
      instructions: instructionSummary,
      messages,
    };

    return {
      providerId: config.id,
      providerType: config.type,
      modelId: config.modelId,
      text,
      raw,
    };
  };
}

