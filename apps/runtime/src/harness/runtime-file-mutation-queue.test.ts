import { describe, expect, it } from "vitest";
import { withWorkspaceFileMutationQueue } from "./runtime-file-mutation-queue.js";

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("runtime file mutation queue", () => {
  it("serializes mutations for the same file", async () => {
    const firstGate = defer();
    const events: string[] = [];

    const first = withWorkspaceFileMutationQueue("/tmp/ora/a.txt", async () => {
      events.push("first:start");
      await firstGate.promise;
      events.push("first:end");
      return "first";
    });
    const second = withWorkspaceFileMutationQueue("/tmp/ora/a.txt", async () => {
      events.push("second:start");
      return "second";
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    firstGate.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("allows different files to run concurrently", async () => {
    const firstGate = defer();
    const events: string[] = [];

    const first = withWorkspaceFileMutationQueue("/tmp/ora/a.txt", async () => {
      events.push("first:start");
      await firstGate.promise;
      events.push("first:end");
    });
    const second = withWorkspaceFileMutationQueue("/tmp/ora/b.txt", async () => {
      events.push("second:start");
    });

    await second;
    expect(events).toEqual(["first:start", "second:start"]);
    firstGate.resolve();
    await first;
  });
});
