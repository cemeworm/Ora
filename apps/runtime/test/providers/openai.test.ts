import { describe, expect, it, vi } from "vitest";
import { createOpenAIProvider } from "../../src/providers/openai.js";

describe("openai provider streaming timeouts", () => {
  it("applies config.timeoutMs to SSE open/idle timeout handling", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
          cancel,
        }),
      },
    })) as typeof fetch;
    const provider = createOpenAIProvider({
      id: "openai-test",
      label: "OpenAI Test",
      type: "openai",
      modelId: "gpt-test",
      capabilities: ["chat"],
      headers: {},
      timeoutMs: 5,
    }, {
      fetchImpl,
      env: { OPENAI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
    });

    await expect(provider.stream?.({
      prompt: "Stream a response.",
      system: "You are a test provider.",
    }, undefined)).rejects.toThrow("Streaming response timed out after 5ms without data.");
    expect(cancel).toHaveBeenCalled();
  });
});
