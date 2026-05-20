import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dynamically resolve the built CLI to get its RunStore setup
const cliPath = path.resolve(__dirname, "../../apps/runtime/dist/cli.js");

// Instead of loading the entire CLI, let's use the evaluation store directly
const { LocalEvaluationStore } = require("../../apps/runtime/dist/evaluation-store.js");

const runtimeDbPath = path.resolve(__dirname, "../../.ora/runtime.db");
const evalStoreDir = path.dirname(runtimeDbPath) + "/evaluation-store";

const datasetPath = process.argv[2];
if (!datasetPath) {
  console.error("Usage: node import-dataset.mjs <dataset-file.json>");
  process.exit(1);
}

const content = fs.readFileSync(datasetPath, "utf8");
const store = new LocalEvaluationStore(evalStoreDir);

const detail = store.importDataset({
  content,
  sourceFileName: path.basename(datasetPath),
  sourceFormat: "json",
});

console.log(detail.dataset.id);
