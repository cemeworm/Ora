import { describe, expect, it, vi } from "vitest";
import { readSseMessages } from "../../src/providers/streaming.js";

describe("provider SSE streaming", () => {
  it("fails idle streams instead of waiting forever", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const response = {
      body: {
        getReader: () => ({
          read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
          cancel,
        }),
      },
    } as unknown as Response;

    await expect(readSseMessages(response, () => undefined, { idleTimeoutMs: 5 }))
      .rejects
      .toThrow("Streaming response timed out after 5ms without data.");
    expect(cancel).toHaveBeenCalled();
  });
});
