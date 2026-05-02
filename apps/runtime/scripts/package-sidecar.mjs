import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const runtimeDir = path.join(repoRoot, "apps", "runtime");
const stageRoot = path.join(repoRoot, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar");
const langfuseSourceDir = path.join(repoRoot, "infra", "observability", "langfuse");
const langfuseStageRoot = path.join(repoRoot, "apps", "desktop", "src-tauri", "resources", "langfuse");
const stageBinDir = path.join(stageRoot, "bin");
const stageAppDir = path.join(stageRoot, "app");
const stageNodeModulesDir = path.join(stageAppDir, "node_modules");
const nodeSource = process.execPath;
const nodeBinaryName = process.platform === "win32" ? "node.exe" : "node";
const stagedNodePath = path.join(stageBinDir, nodeBinaryName);
const bundledRuntimePath = path.join(stageAppDir, "runtime-sidecar.cjs");
const skillsSourceDir = path.join(repoRoot, "skills");
const stageSkillsDir = path.join(stageAppDir, "skills");

rmSync(stageRoot, { recursive: true, force: true });
rmSync(langfuseStageRoot, { recursive: true, force: true });
mkdirSync(stageBinDir, { recursive: true });
mkdirSync(stageNodeModulesDir, { recursive: true });
mkdirSync(langfuseStageRoot, { recursive: true });
writeFileSync(path.join(langfuseStageRoot, ".keep"), "\n");

copyFileSync(nodeSource, stagedNodePath);
chmodSync(stagedNodePath, 0o755);

run(
  resolveEsbuildBinary(),
  [
    path.join(runtimeDir, "src", "sidecar-entry.ts"),
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--target=node22",
    `--outfile=${bundledRuntimePath}`,
    "--external:better-sqlite3",
    "--external:pdf-parse",
  ],
  repoRoot
);

for (const packageName of runtimePackageNames()) {
  copyRuntimePackage(packageName);
}

copyLangfuseBundle();
copySkillsBundle();

if (!existsSync(bundledRuntimePath)) {
  throw new Error(`Missing packaged sidecar bundle at ${bundledRuntimePath}`);
}

verifyPackagedSidecar();

function resolveEsbuildBinary() {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  const esbuildPackage = ["esbuild@0.27.7", "esbuild@0.25.12", "esbuild@0.21.5"]
    .map((dirname) => path.join(pnpmDir, dirname, "node_modules", "esbuild", "bin", "esbuild"))
    .find((candidate) => existsSync(candidate));

  if (!esbuildPackage) {
    throw new Error("Unable to locate an esbuild binary in the workspace install.");
  }

  return esbuildPackage;
}

function runtimePackageNames() {
  return [
    "better-sqlite3",
    "bindings",
    "file-uri-to-path",
    "pdf-parse",
    "pdfjs-dist",
    "@napi-rs/canvas",
    nativeCanvasPackageName(),
  ].filter(Boolean);
}

function nativeCanvasPackageName() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") return "@napi-rs/canvas-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "@napi-rs/canvas-darwin-x64";
  if (platform === "linux" && arch === "x64") return "@napi-rs/canvas-linux-x64-gnu";
  if (platform === "linux" && arch === "arm64") return "@napi-rs/canvas-linux-arm64-gnu";
  if (platform === "win32" && arch === "x64") return "@napi-rs/canvas-win32-x64-msvc";
  if (platform === "win32" && arch === "arm64") return "@napi-rs/canvas-win32-arm64-msvc";
  return undefined;
}

function copyRuntimePackage(packageName) {
  const packageSource = realpathSync(resolveInstalledPackageDir(packageName));
  const packageDestination = path.join(stageNodeModulesDir, packageName);
  mkdirSync(path.dirname(packageDestination), { recursive: true });
  cpSync(packageSource, packageDestination, {
    recursive: true,
    force: true
  });
  const destinationStat = lstatSync(packageDestination);
  if (destinationStat.isSymbolicLink()) {
    throw new Error(`Expected ${packageDestination} to be materialized, but it is still a symlink.`);
  }
}

function copyLangfuseBundle() {
  const composeSource = path.join(langfuseSourceDir, "docker-compose.yml");
  const composeDestination = path.join(langfuseStageRoot, "docker-compose.yml");
  if (!existsSync(composeSource)) {
    throw new Error(`Missing managed Langfuse compose file at ${composeSource}`);
  }
  copyFileSync(composeSource, composeDestination);
}

function copySkillsBundle() {
  if (!existsSync(skillsSourceDir)) {
    throw new Error(`Missing skills directory at ${skillsSourceDir}`);
  }
  cpSync(skillsSourceDir, stageSkillsDir, {
    recursive: true,
    force: true,
    filter: (src) => !path.basename(src).startsWith("."),
  });
}

function resolveInstalledPackageDir(packageName) {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  for (const entry of readdirSync(pnpmDir)) {
    const candidate = path.join(pnpmDir, entry, "node_modules", packageName);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate installed package directory for ${packageName}`);
}

function verifyPackagedSidecar() {
  const smokeDbPath = path.join(os.tmpdir(), `ora-runtime-sidecar-smoke-${process.pid}.db`);
  try {
    const output = execFileSync(stagedNodePath, [bundledRuntimePath], {
      cwd: stageAppDir,
      input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "runtime.bootstrap" })}\n`,
      encoding: "utf8",
      env: {
        ...process.env,
        ORA_RUNTIME_STORE_DIR: smokeDbPath,
      },
      stdio: ["pipe", "pipe", "inherit"],
    });
    const response = JSON.parse(output.trim());
    if (response.jsonrpc !== "2.0" || response.id !== 1 || !response.result) {
      throw new Error(`Unexpected runtime.bootstrap smoke response: ${output.trim()}`);
    }
  } finally {
    rmSync(smokeDbPath, { force: true });
    rmSync(`${smokeDbPath}-shm`, { force: true });
    rmSync(`${smokeDbPath}-wal`, { force: true });
  }
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit"
  });
}
