import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MVP_TOOLS } from "@cemeworm/shared";
import { RuntimeToolExecutor } from "./runtime-tool-executor.js";

function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-file-tools-"));
}

function executor(rootPath: string): RuntimeToolExecutor {
  return new RuntimeToolExecutor({
    workspace: { rootPath },
    toolDescriptors: MVP_TOOLS,
  });
}

describe("runtime file tools", () => {
  it("patches multiple exact edits against the original file and returns diff metadata", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "sample.txt"), "alpha\nbeta\ngamma\n", "utf8");

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.patch",
      args: {
        path: "sample.txt",
        edits: [
          { oldText: "alpha", newText: "ALPHA" },
          { oldText: "gamma", newText: "GAMMA" },
        ],
      },
    });

    expect(fs.readFileSync(path.join(rootPath, "sample.txt"), "utf8")).toBe("ALPHA\nbeta\nGAMMA\n");
    expect(result.output).toMatchObject({
      path: "sample.txt",
      replacements: 2,
      firstChangedLine: 1,
    });
    expect(result.fileChange?.metadata).toMatchObject({
      replacements: 2,
      firstChangedLine: 1,
      created: false,
    });
    expect(result.fileChange?.metadata.diff).toContain("--- a/sample.txt");
    expect(result.fileChange?.metadata.diff).toContain("+++ b/sample.txt");
  });

  it("keeps the legacy search and replace arguments working", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "legacy.txt"), "hello old world", "utf8");

    const result = await executor(rootPath).executeWithMetadata({
      tool: "file.patch",
      args: {
        path: "legacy.txt",
        search: "old",
        replace: "new",
      },
    });

    expect(fs.readFileSync(path.join(rootPath, "legacy.txt"), "utf8")).toBe("hello new world");
    expect(result.output).toMatchObject({
      path: "legacy.txt",
      replacements: 1,
    });
  });

  it("rejects oldText that matches more than once", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "duplicate.txt"), "same\nsame\n", "utf8");

    await expect(executor(rootPath).executeWithMetadata({
      tool: "file.patch",
      args: {
        path: "duplicate.txt",
        edits: [{ oldText: "same", newText: "changed" }],
      },
    })).rejects.toThrow("matched more than once");

    expect(fs.readFileSync(path.join(rootPath, "duplicate.txt"), "utf8")).toBe("same\nsame\n");
  });

  it("rejects overlapping edits resolved against the original file", async () => {
    const rootPath = tempWorkspace();
    fs.writeFileSync(path.join(rootPath, "overlap.txt"), "abcdef", "utf8");

    await expect(executor(rootPath).executeWithMetadata({
      tool: "file.patch",
      args: {
        path: "overlap.txt",
        edits: [
          { oldText: "abc", newText: "ABC" },
          { oldText: "bcd", newText: "BCD" },
        ],
      },
    })).rejects.toThrow("must not overlap");

    expect(fs.readFileSync(path.join(rootPath, "overlap.txt"), "utf8")).toBe("abcdef");
  });

  it("exposes structured file, web, and document schemas in tool definitions", () => {
    const definitions = executor(tempWorkspace()).toolDefinitions([
      "file.read",
      "file.write",
      "file.patch",
      "web.fetch",
      "web.search",
      "document.extract",
    ]);
    const byId = new Map(definitions.map((definition) => [definition.id, definition.parameters]));

    expect(byId.get("file.read")).toMatchObject({ required: ["path"] });
    expect(byId.get("file.write")).toMatchObject({ required: ["path", "content"] });
    expect(byId.get("file.patch")).toMatchObject({
      anyOf: [
        { required: ["edits"] },
        { required: ["search", "replace"] },
      ],
      properties: {
        path: expect.any(Object),
        edits: expect.any(Object),
        approvalRequest: expect.any(Object),
      },
    });
    expect(byId.get("web.fetch")).toMatchObject({ required: ["url"] });
    expect(byId.get("web.search")).toMatchObject({ required: ["query"] });
    expect(byId.get("document.extract")).toMatchObject({
      oneOf: [
        { required: ["path"] },
        { required: ["url"] },
      ],
      properties: {
        path: expect.any(Object),
        url: expect.any(Object),
        format: expect.any(Object),
      },
    });
  });
});
