import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PackageManager } from "../src/package-manager.js";

function fixtureRoot(name: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ora-package-${name}-`));
}

function writeCandidateAssets(root: string) {
  fs.mkdirSync(path.join(root, "apps", "desktop", "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps", "desktop", "dist", "index.html"), "<div>Ora</div>");
  fs.mkdirSync(path.join(root, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar", "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar", "app"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar", "bin", "node"), "");
  fs.writeFileSync(path.join(root, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar", "app", "runtime-sidecar.cjs"), "");
}

describe("PackageManager", () => {
  it("builds a verified candidate and promotes it with an active pointer", () => {
    const appDataRoot = fixtureRoot("promote");
    const repoRoot = fixtureRoot("repo");
    writeCandidateAssets(repoRoot);
    const manager = new PackageManager({
      appDataRoot,
      repoRoot,
      clock: () => 1000,
      runCommand: (command) => `ran ${command}\n`,
    });

    const candidate = manager.buildCandidate({
      versionId: "slot-a",
      semver: "0.1.1",
      verificationCommands: ["pnpm typecheck"],
    });
    expect(candidate.verification.status).toBe("passed");
    expect(fs.existsSync(path.join(candidate.slotPath, "manifest.json"))).toBe(true);

    const snapshot = manager.promote({ versionId: "slot-a" });
    expect(snapshot.active.activeVersionId).toBe("slot-a");
    expect(snapshot.active.compatibilityStatus).toBe("compatible");
    expect(snapshot.packages.find((item) => item.versionId === "slot-a")?.status).toBe("active");
  });

  it("rejects promotion when verification failed", () => {
    const appDataRoot = fixtureRoot("failed");
    const repoRoot = fixtureRoot("repo");
    writeCandidateAssets(repoRoot);
    const manager = new PackageManager({
      appDataRoot,
      repoRoot,
      runCommand: () => {
        throw new Error("boom");
      },
    });

    manager.buildCandidate({
      versionId: "slot-b",
      semver: "0.1.2",
      verificationCommands: ["pnpm typecheck"],
    });

    expect(() => manager.promote({ versionId: "slot-b" })).toThrow("must pass verification");
  });

  it("rolls back to the previous active slot", () => {
    const appDataRoot = fixtureRoot("rollback");
    const repoRoot = fixtureRoot("repo");
    writeCandidateAssets(repoRoot);
    const manager = new PackageManager({
      appDataRoot,
      repoRoot,
      clock: (() => {
        let now = 2000;
        return () => now++;
      })(),
      runCommand: (command) => `ran ${command}\n`,
    });

    manager.buildCandidate({ versionId: "slot-a", semver: "0.1.1", skipBuildCommands: true });
    manager.promote({ versionId: "slot-a" });
    manager.buildCandidate({ versionId: "slot-b", semver: "0.1.2", skipBuildCommands: true });
    manager.promote({ versionId: "slot-b" });

    const rolledBack = manager.rollback();
    expect(rolledBack.active.activeVersionId).toBe("slot-a");
    expect(rolledBack.active.previousVersionId).toBe("slot-b");
  });
});
