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
  rmSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const runtimeDir = path.join(repoRoot, "apps", "runtime");
const stageRoot = path.join(repoRoot, "apps", "desktop", "src-tauri", "resources", "runtime-sidecar");
const stageBinDir = path.join(stageRoot, "bin");
const stageAppDir = path.join(stageRoot, "app");
const stageNodeModulesDir = path.join(stageAppDir, "node_modules");
const nodeSource = process.execPath;
const nodeBinaryName = process.platform === "win32" ? "node.exe" : "node";
const stagedNodePath = path.join(stageBinDir, nodeBinaryName);
const bundledRuntimePath = path.join(stageAppDir, "runtime-sidecar.cjs");

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageBinDir, { recursive: true });
mkdirSync(stageNodeModulesDir, { recursive: true });

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
  ],
  repoRoot
);

for (const packageName of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  copyRuntimePackage(packageName);
}

if (!existsSync(bundledRuntimePath)) {
  throw new Error(`Missing packaged sidecar bundle at ${bundledRuntimePath}`);
}

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

function copyRuntimePackage(packageName) {
  const packageSource = realpathSync(resolveInstalledPackageDir(packageName));
  const packageDestination = path.join(stageNodeModulesDir, packageName);
  cpSync(packageSource, packageDestination, {
    recursive: true,
    force: true
  });
  const destinationStat = lstatSync(packageDestination);
  if (destinationStat.isSymbolicLink()) {
    throw new Error(`Expected ${packageDestination} to be materialized, but it is still a symlink.`);
  }
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

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit"
  });
}
