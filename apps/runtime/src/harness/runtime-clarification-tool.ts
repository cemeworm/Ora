import type { RuntimeToolDefinition } from "./capability-registries.js";
import type { RuntimeToolExecutionContext } from "./runtime-tool-executor.js";

export function clarificationToolRuntimeFields(toolId: string): Partial<RuntimeToolDefinition<RuntimeToolExecutionContext>> {
  if (toolId !== "user.clarify") {
    return {};
  }
  return {
    promptExample: "{\"tool\":\"user.clarify\",\"args\":{\"key\":\"target_environment\",\"question\":\"你希望我在哪个环境执行这一步？\",\"options\":[{\"id\":\"staging\",\"label\":\"预发环境\"},{\"id\":\"production\",\"label\":\"生产环境\"}]}}",
    execute: () => {
      throw new Error("user.clarify must be handled by the runtime loop as a clarification interrupt.");
    },
  };
}
