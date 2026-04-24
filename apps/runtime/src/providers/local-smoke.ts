import type { ProviderConfig } from "@ora/shared";
import { normalizeMessages, splitInstructionMessages } from "./provider-utils.js";
import type { ModelProvider, ModelResponse, ProviderRuntimeOptions } from "./types.js";
import { emitTextDelta } from "./streaming.js";

function stableSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function createLocalSmokeProvider(
  config: ProviderConfig,
  _options: ProviderRuntimeOptions = {}
): ModelProvider {
  const provider: ModelProvider = async (request) => {
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

  provider.stream = async (request, callbacks) => {
    const response = await provider(request);
    const parts = response.text.match(/\S+\s*/g) ?? [response.text];
    let text = "";
    for (const part of parts) {
      text += part;
      await emitTextDelta(callbacks, {
        delta: part,
        text,
        raw: { provider: config.type, model: config.modelId },
      });
    }
    return {
      ...response,
      raw: {
        streamMode: "local_smoke",
        response: response.raw,
      },
    };
  };

  return provider;
}
