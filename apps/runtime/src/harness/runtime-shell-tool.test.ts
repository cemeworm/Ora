import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedToolLimits } from "./runtime-tool-executor.js";
import { executeWorkspaceShell } from "./runtime-shell-tool.js";

const TEST_LIMITS: ResolvedToolLimits = {
  fileReadMaxBytes: 100_000,
  fileListMaxEntries: 100,
  fileSearchMaxFiles: 100,
  fileSearchMaxMatches: 100,
  fileSearchMaxBytes: 100_000,
  fileWriteMaxBytes: 100_000,
  webMaxBytes: 100_000,
  documentExtractMaxBytes: 100_000,
  documentSourceMaxBytes: 100_000,
  shellMaxOutputBytes: 100_000,
  shellTimeoutMs: 5_000,
};

function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ora-runtime-shell-tool-"));
}

function createFakeShell(rootPath: string, shellName: string): string {
  const shellPath = path.join(rootPath, shellName);
  fs.writeFileSync(
    shellPath,
    [
      "#!/usr/bin/env node",
      "const payload = { argv: process.argv.slice(2), shell: process.env.SHELL };",
      "process.stdout.write(JSON.stringify(payload));",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(shellPath, 0o755);
  return shellPath;
}

describe("runtime shell tool", () => {
  it("uses -c by default for a custom POSIX shell and preserves SHELL", async () => {
    const rootPath = tempWorkspace();
    const shellPath = createFakeShell(rootPath, "zsh");

    const result = await executeWorkspaceShell(rootPath, {
      command: "echo hello",
      shell: shellPath,
    }, TEST_LIMITS);

    expect(result.exitCode).toBe(0);
    expect(result.shell).toBe(shellPath);
    expect(result.login).toBe(false);
    const payload = JSON.parse(result.stdout) as { argv: string[]; shell?: string };
    expect(payload.argv).toEqual(["-c", "echo hello"]);
    expect(payload.shell).toBe(shellPath);
  });

  it("uses login shell flags and bootstrap when login=true for zsh", async () => {
    const rootPath = tempWorkspace();
    const shellPath = createFakeShell(rootPath, "zsh");

    const result = await executeWorkspaceShell(rootPath, {
      command: "ll && echo 'done'",
      shell: shellPath,
      login: true,
    }, TEST_LIMITS);

    expect(result.exitCode).toBe(0);
    expect(result.login).toBe(true);
    const payload = JSON.parse(result.stdout) as { argv: string[]; shell?: string };
    expect(payload.argv[0]).toBe("-lc");
    expect(payload.argv[1]).toContain("[ -f ~/.zshrc ] && . ~/.zshrc >/dev/null 2>&1 || true");
    expect(payload.argv[1]).toContain("eval -- 'll && echo ");
    expect(payload.argv[1]).toContain("done");
    expect(payload.shell).toBe(shellPath);
  });

  it("uses PowerShell login flags when requested", async () => {
    const rootPath = tempWorkspace();
    const shellPath = createFakeShell(rootPath, "pwsh");

    const result = await executeWorkspaceShell(rootPath, {
      command: "Get-ChildItem",
      shell: shellPath,
      login: true,
    }, TEST_LIMITS);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { argv: string[] };
    expect(payload.argv).toEqual(["-Login", "-Command", "Get-ChildItem"]);
  });

  it("rejects login=true for cmd shells", async () => {
    const rootPath = tempWorkspace();
    const shellPath = createFakeShell(rootPath, "cmd");

    await expect(executeWorkspaceShell(rootPath, {
      command: "dir",
      shell: shellPath,
      login: true,
    }, TEST_LIMITS)).rejects.toThrow("login=true is not supported for cmd.exe");
  });

  it("allows sed address regex patterns that look like absolute paths", async () => {
    const rootPath = tempWorkspace();
    const shellPath = createFakeShell(rootPath, "zsh");

    const result = await executeWorkspaceShell(rootPath, {
      command: "sed -n '/^# 8\\..*/,/^# 9\\..*/p' docs/ora-gates-and-resume.md",
      shell: shellPath,
    }, TEST_LIMITS);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { argv: string[] };
    expect(payload.argv).toEqual(["-c", "sed -n '/^# 8\\..*/,/^# 9\\..*/p' docs/ora-gates-and-resume.md"]);
  });

  it("still rejects real absolute paths outside the workspace", async () => {
    const rootPath = tempWorkspace();
    const shellPath = createFakeShell(rootPath, "zsh");

    await expect(executeWorkspaceShell(rootPath, {
      command: "cat /etc/passwd",
      shell: shellPath,
    }, TEST_LIMITS)).rejects.toThrow("shell.execute command paths must stay inside the project root.");
  });
});
