import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const version = rootPkg.version;

const targets = [
  {
    path: "apps/desktop/package.json",
    get: (c) => JSON.parse(c).version,
    set: (c) => c.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
  },
  {
    path: "apps/runtime/package.json",
    get: (c) => JSON.parse(c).version,
    set: (c) => c.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
  },
  {
    path: "packages/shared/package.json",
    get: (c) => JSON.parse(c).version,
    set: (c) => c.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
  },
  {
    path: "apps/desktop/src-tauri/tauri.conf.json",
    get: (c) => JSON.parse(c).version,
    set: (c) => c.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
  },
  {
    path: "apps/desktop/src-tauri/Cargo.toml",
    get: (c) => c.match(/^version\s*=\s*"([^"]*)"/m)?.[1] ?? null,
    set: (c) => c.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`),
  },
];

const mode = process.argv[2];
if (mode !== "--check" && mode !== "--sync") {
  console.error("Usage: node version-sync.mjs [--check|--sync]");
  process.exit(1);
}

let ok = true;

for (const { path, get, set } of targets) {
  const fullPath = resolve(root, path);
  const content = readFileSync(fullPath, "utf-8");
  const current = get(content);

  if (current === null) {
    console.error(`❌ ${path}: could not read version`);
    ok = false;
    continue;
  }

  if (current !== version) {
    ok = false;
    if (mode === "--sync") {
      writeFileSync(fullPath, set(content), "utf-8");
      console.log(`✅ ${path}: ${current} → ${version}`);
    } else {
      console.log(`❌ ${path}: ${current} (expected ${version})`);
    }
  } else {
    console.log(`✔  ${path}: ${version}`);
  }
}

if (!ok) {
  if (mode === "--check") {
    console.log("\nRun 'pnpm version:sync' to fix mismatches.");
  }
  process.exit(1);
}

console.log(`\nAll files at version ${version}`);
