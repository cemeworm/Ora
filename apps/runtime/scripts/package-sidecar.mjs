import { execFileSync, spawn } from "node:child_process";
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
warmStagedNodeBinary();

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

await verifyPackagedSidecar();

function resolveEsbuildBinary() {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  let tried = [];

  if (existsSync(pnpmDir)) {
    const esbuildDirs = readdirSync(pnpmDir)
      .filter((name) => name.startsWith("esbuild@") && !name.startsWith("@esbuild"))
      .sort()
      .reverse();
    for (const esbuildDir of esbuildDirs) {
      const candidate = path.join(pnpmDir, esbuildDir, "node_modules", "esbuild", "bin", "esbuild");
      tried.push(candidate);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const dotBinPath = path.join(repoRoot, "node_modules", ".bin", "esbuild");
  if (existsSync(dotBinPath)) {
    tried.push(dotBinPath);
    return realpathSync(dotBinPath);
  }

  throw new Error(`Unable to locate an esbuild binary. Tried:\n${tried.map((p) => `  - ${p}`).join("\n")}`);
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

async function verifyPackagedSidecar() {
  const smokeDbPath = path.join(os.tmpdir(), `ora-runtime-sidecar-smoke-${process.pid}.db`);
  const SMOKE_TIMEOUT_MS = 15_000;
  try {
    // Keep the packaging smoke path lightweight: bootstrap enumerates the full
    // runtime surface (skills, packages, providers, etc.) and can take much
    // longer on the bundled single-file sidecar than the liveness check needs.
    const output = await runSidecarSmokeWithTimeout(
      stagedNodePath,
      [bundledRuntimePath],
      { jsonrpc: "2.0", id: 1, method: "runtime.health" },
      {
      cwd: stageAppDir,
      env: { ...process.env, ORA_RUNTIME_STORE_DIR: smokeDbPath },
      timeoutMs: SMOKE_TIMEOUT_MS,
      }
    );
    const response = JSON.parse(output.trim());
    if (
      response.jsonrpc !== "2.0" ||
      response.id !== 1 ||
      !response.result ||
      response.result.ok !== true ||
      response.result.service !== "ora-runtime"
    ) {
      throw new Error(`Unexpected runtime.health smoke response: ${output.trim()}`);
    }
  } finally {
    rmSync(smokeDbPath, { force: true });
    rmSync(`${smokeDbPath}-shm`, { force: true });
    rmSync(`${smokeDbPath}-wal`, { force: true });
  }
}

function warmStagedNodeBinary() {
  // Newly copied Node binaries can incur a large one-time launch cost on macOS.
  // Warm it once outside the smoke budget so the actual liveness probe stays stable.
  execFileSync(stagedNodePath, ["-v"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
}

function runSidecarSmokeWithTimeout(command, args, requestPayload, options) {
  const { timeoutMs, ...spawnOptions } = options;
  const request = `${JSON.stringify(requestPayload)}\n`;

  const child = spawn(command, args, {
    ...spawnOptions,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000);
      reject(new Error(`Sidecar smoke test timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Read only the first line from stdout (the JSON-RPC response), then kill
    let resolved = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const newlineIdx = stdout.indexOf("\n");
      if (!resolved && newlineIdx >= 0) {
        resolved = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        resolve(stdout.slice(0, newlineIdx));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (!resolved) {
        clearTimeout(timer);
        reject(new Error(`Sidecar smoke test exited with code ${code} before returning a response: ${stderr.trim() || stdout.trim()}`));
      }
    });

    child.stdin.write(request);
    child.stdin.end();
  });
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit"
  });
}
