import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MVP_TOOLS } from "@cemeworm/shared";
import { RuntimeToolExecutor } from "../src/harness/runtime-tool-executor.js";

const cleanupPaths: string[] = [];

function createWorkspace() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ora-repo-explore-"));
  cleanupPaths.push(rootPath);
  fs.mkdirSync(path.join(rootPath, "src"), { recursive: true });
  fs.mkdirSync(path.join(rootPath, "test"), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, "src", "auth.ts"),
    [
      "export function authMiddleware(req, res, next) {",
      "  if (!req.headers.authorization) throw new Error('missing auth');",
      "  next();",
      "}",
      "",
      "export function installAuth(app) {",
      "  app.use(authMiddleware);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(rootPath, "test", "auth.test.ts"),
    [
      "import { authMiddleware } from '../src/auth';",
      "test('auth middleware requires a header', () => {",
      "  expect(typeof authMiddleware).toBe('function');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    workspace: {
      label: "Repo Explore Test",
      rootPath,
    },
  };
}

afterEach(() => {
  for (const cleanupPath of cleanupPaths.splice(0)) {
    fs.rmSync(cleanupPath, { recursive: true, force: true });
  }
});

describe("repo.explore runtime tool", () => {
  it("returns structured repository evidence for trace questions", async () => {
    const { workspace } = createWorkspace();
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });

    const result = await executor.execute({
      tool: "repo.explore" as never,
      args: {
        goal: "Find where auth middleware is wired",
        kind: "trace",
        subject: "authMiddleware",
        scope: { includeGlobs: ["**/*.ts"] },
      },
    });

    const output = result as Record<string, unknown>;
    expect(output.status).toBe("answered");
    expect(output.relatedPaths).toContain("src/auth.ts");
    expect((output.evidence as Array<Record<string, unknown>>)[0]?.path).toBe("src/auth.ts");
  });

  it("returns insufficient_evidence when no repository clue is found", async () => {
    const { workspace } = createWorkspace();
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });

    const result = await executor.execute({
      tool: "repo.explore" as never,
      args: {
        goal: "Find the payment adapter",
        kind: "locate",
        subject: "PaymentAdapterThatDoesNotExist",
        scope: { includeGlobs: ["**/*.ts"] },
      },
    });

    const output = result as Record<string, unknown>;
    expect(output.status).toBe("insufficient_evidence");
    expect(Array.isArray(output.gaps)).toBe(true);
    expect((output.nextActions as Array<Record<string, unknown>>)[0]?.kind).toBe("none");
  });

  it("can explore utf16 text files without misclassifying them as binary", async () => {
    const { workspace } = createWorkspace();
    fs.writeFileSync(
      path.join(workspace.rootPath, "src", "utf16-note.md"),
      Buffer.from([0xff, 0xfe, ...Buffer.from("auth middleware lives here\n", "utf16le")]),
    );
    const executor = new RuntimeToolExecutor({ workspace, toolDescriptors: MVP_TOOLS });

    const result = await executor.execute({
      tool: "repo.explore" as never,
      args: {
        goal: "Find auth middleware notes",
        kind: "trace",
        subject: "middleware",
        scope: { includeGlobs: ["**/*.md"] },
      },
    });

    const output = result as Record<string, unknown>;
    expect(output.status).toBe("answered");
    expect(output.relatedPaths).toContain("src/utf16-note.md");
  });
});
