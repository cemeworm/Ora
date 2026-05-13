import { beforeEach, describe, expect, it } from "vitest";
import { fallbackShellSnapshot, filterShellEnvironment, shellSnapshotInternals } from "./shell-snapshot.js";

describe("shell-snapshot", () => {
  beforeEach(() => {
    shellSnapshotInternals.resetForTests();
  });

  it("builds a zsh snapshot command that bootstraps login files", () => {
    const command = shellSnapshotInternals.buildShellSnapshotCommand("/bin/zsh", "/custom/node");
    expect(command).toContain(".zshenv");
    expect(command).toContain(".zprofile");
    expect(command).toContain(".zshrc");
    expect(command).toContain("/custom/node");
    expect(command).toContain("JSON.stringify(process.env)");
  });

  it("parses the JSON payload after the snapshot marker", () => {
    const env = shellSnapshotInternals.parseShellSnapshotOutput([
      "some shell noise",
      "__ORA_SHELL_SNAPSHOT_START__",
      '{"PATH":"/custom/bin","NVM_DIR":"/Users/test/.nvm","NUM":123}',
    ].join("\n"));
    expect(env).toEqual({
      PATH: "/custom/bin",
      NVM_DIR: "/Users/test/.nvm",
    });
  });

  it("throws when the marker is missing", () => {
    expect(() => shellSnapshotInternals.parseShellSnapshotOutput('{"PATH":"/bin"}'))
      .toThrow(/marker not found/i);
  });

  it("filters sensitive variables while preserving shell path and PATH", () => {
    const filtered = filterShellEnvironment({
      PATH: "/custom/bin",
      SHELL: "/bin/zsh",
      HOME: "/Users/test",
      OPENAI_API_KEY: "secret",
      GITHUB_TOKEN: "secret",
      DB_PASSWORD: "secret",
      NORMAL_VALUE: "ok",
    });
    expect(filtered).toMatchObject({
      PATH: "/custom/bin",
      SHELL: "/bin/zsh",
      HOME: "/Users/test",
      NORMAL_VALUE: "ok",
    });
    expect(filtered.OPENAI_API_KEY).toBeUndefined();
    expect(filtered.GITHUB_TOKEN).toBeUndefined();
    expect(filtered.DB_PASSWORD).toBeUndefined();
  });

  it("falls back to the current process environment shape", () => {
    const snapshot = fallbackShellSnapshot({
      PATH: "/fallback/bin",
      SHELL: "/bin/bash",
      HOME: "/Users/fallback",
      USER: "quinten",
      TMPDIR: "/tmp/fallback",
    });
    expect(snapshot.shellPath).toBe("/bin/bash");
    expect(snapshot.env).toMatchObject({
      PATH: "/fallback/bin",
      SHELL: "/bin/bash",
      HOME: "/Users/fallback",
      USER: "quinten",
      TMPDIR: "/tmp/fallback",
    });
    expect(typeof snapshot.capturedAt).toBe("number");
  });
});
