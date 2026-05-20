import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const desktopPackageJsonPath = path.join(desktopRoot, "package.json");
const outputPath = path.join(
  desktopRoot,
  "src-tauri",
  "resources",
  "build-meta.json",
);

function readGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function optionalString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function main() {
  const desktopPackageJson = JSON.parse(
    await fs.readFile(desktopPackageJsonPath, "utf8"),
  );
  const version = String(desktopPackageJson.version ?? "").trim();
  if (!version) {
    throw new Error("apps/desktop/package.json is missing version");
  }

  const tag =
    optionalString(process.env.ORA_BUILD_TAG) ??
    optionalString(readGit(["describe", "--tags", "--exact-match", "HEAD"]));
  const commit =
    optionalString(process.env.ORA_BUILD_COMMIT) ??
    optionalString(readGit(["rev-parse", "HEAD"]));
  const builtAt =
    optionalString(process.env.ORA_BUILD_BUILT_AT) ?? new Date().toISOString();
  const workflow =
    optionalString(process.env.ORA_BUILD_WORKFLOW) ?? "local";

  const payload = {
    version,
    tag,
    commit,
    builtAt,
    workflow,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

await main();
