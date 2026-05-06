import type { PackageManager } from "../package-manager.js";
import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { RuntimeToolExecutionContext } from "./runtime-tool-executor.js";

export function packageToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  switch (toolId) {
    case "package.list":
      return {
        promptExample: "{\"tool\":\"package.list\",\"args\":{}}",
        requiresApprovalCopy: true,
        actionRiskLevel: () => "high",
        execute: (_args, context) => ({ output: packageManager(context.packageManager).snapshot() }),
      };
    case "package.buildCandidate":
      return riskyPackageTool("{\"tool\":\"package.buildCandidate\",\"args\":{\"semver\":\"0.1.1\"}}", async (args, context) => ({ output: await packageManager(context.packageManager).buildCandidate(args) }));
    case "package.verify":
      return riskyPackageTool("{\"tool\":\"package.verify\",\"args\":{\"versionId\":\"local-0.1.1\"}}", async (args, context) => ({ output: await packageManager(context.packageManager).verify(args) }));
    case "package.promote":
      return riskyPackageTool("{\"tool\":\"package.promote\",\"args\":{\"versionId\":\"local-0.1.1\"}}", async (args, context) => ({ output: await packageManager(context.packageManager).promote(args) }));
    case "package.switch":
      return riskyPackageTool("{\"tool\":\"package.switch\",\"args\":{\"versionId\":\"local-0.1.1\"}}", async (args, context) => ({ output: await packageManager(context.packageManager).promote(args) }));
    case "package.rollback":
      return riskyPackageTool("{\"tool\":\"package.rollback\",\"args\":{}}", async (_args, context) => ({ output: await packageManager(context.packageManager).rollback() }));
    default:
      return {};
  }
}

function riskyPackageTool(
  promptExample: string,
  execute: NonNullable<RuntimeToolDefinition<RuntimeToolExecutionContext>["execute"]>,
): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  return {
    promptExample,
    requiresApprovalCopy: true,
    actionRiskLevel: () => "high",
    execute,
  };
}

function packageManager(manager: PackageManager | undefined): PackageManager {
  if (!manager) {
    throw new Error("A package manager is required for package tools.");
  }
  return manager;
}
