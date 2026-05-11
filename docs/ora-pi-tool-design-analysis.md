# Ora 与 Pi tool 设计和管理机制对比

本文记录对 `earendil-works/pi` 中 `packages/coding-agent/src/core/tools` 与 Ora 当前 runtime tool 体系的对比分析。重点不是判断谁更好，而是识别 Ora 在保留自身 runtime 治理优势的前提下，可以借鉴 Pi 做迭代优化的方向。

## 1. 结论摘要

Ora 的 tool 体系更像一个产品级 agent runtime：它围绕 run、action、approval、continuation、snapshot 和 desktop projection 建立了完整治理链。Pi 的 tool 体系更像一个高质量 coding agent toolkit：单个工具的定义、执行、渲染、流式输出、参数准备和文件操作安全边界更内聚。

因此建议是：**Ora 保留现有 runtime governance 主干，吸收 Pi 在单个 tool 工程质量上的设计。**

优先可借鉴点：

1. 补齐每个 tool 的强参数 schema。
2. 收拢 descriptor、prompt、risk、execute、approval copy 等定义，形成更内聚的 runtime tool definition。
3. 为文件写入和 patch 增加 per-file mutation queue。
4. 给 shell/web/MCP 等工具执行链传入 AbortSignal。
5. 为 `file.patch` 增加多 edit、唯一匹配校验和 diff preview。
6. Desktop Trails 增加 tool-specific renderer，让工具账本更可读。

## 2. 源码入口地图

### 2.1 Pi tool 相关入口

Pi 代码位置：

- `packages/coding-agent/src/core/tools/index.ts`
- `packages/coding-agent/src/core/tools/read.ts`
- `packages/coding-agent/src/core/tools/write.ts`
- `packages/coding-agent/src/core/tools/edit.ts`
- `packages/coding-agent/src/core/tools/bash.ts`
- `packages/coding-agent/src/core/tools/find.ts`
- `packages/coding-agent/src/core/tools/grep.ts`
- `packages/coding-agent/src/core/tools/file-mutation-queue.ts`
- `packages/coding-agent/src/core/tools/output-accumulator.ts`
- `packages/coding-agent/src/core/tools/truncate.ts`
- `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`
- `packages/coding-agent/src/core/extensions/types.ts`
- `packages/coding-agent/src/core/extensions/loader.ts`
- `packages/coding-agent/src/core/extensions/wrapper.ts`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts`

### 2.2 Ora tool 相关入口

Ora 当前代码位置：

- `packages/shared/src/capabilities.ts`
- `packages/shared/src/runtime.ts`
- `apps/runtime/src/harness/capability-registries.ts`
- `apps/runtime/src/harness/runtime-tool-executor.ts`
- `apps/runtime/src/harness/runtime-tool-call-service.ts`
- `apps/runtime/src/harness/runtime-tool-loop.ts`
- `apps/runtime/src/harness/runtime-tool-action-proposal.ts`
- `apps/runtime/src/harness/runtime-action-runner.ts`
- `apps/runtime/src/harness/runtime-middleware.ts`
- `apps/runtime/src/harness/runtime-tool-ledger.ts`
- `apps/runtime/src/harness/runtime-tool-boundary.ts`
- `apps/runtime/src/harness/runtime-file-tools.ts`
- `apps/runtime/src/harness/runtime-shell-tool.ts`
- `apps/runtime/src/harness/node-runtime-loop.ts`
- `apps/runtime/src/run-projections.ts`
- `apps/desktop/src/lib/trailViewModel.ts`
- `apps/desktop/src/components/ApprovalRequestCard.tsx`
- `apps/desktop/src/components/TrailsDrawer.tsx`
- `apps/desktop/src/components/TrailsTabs.tsx`

## 3. 机制对比

| 维度 | Ora | Pi | 判断 |
| --- | --- | --- | --- |
| 设计中心 | Runtime orchestration | Tool definition | Ora 更适合产品级 runtime；Pi 更适合工具单体质量 |
| 工具注册 | `ToolDescriptor` + runtime fields + dynamic definitions | `createToolDefinition` / extension `registerTool` | Ora 分层更强，但定义分散 |
| 参数 schema | 部分工具较完整，部分工具仍是 `{}` | 每个工具都有 TypeBox schema | Ora 应补齐强 schema |
| 执行链 | `RuntimeToolExecutor` + middleware + action ledger | `AgentTool.execute` + before/after hooks | Ora 治理更完整 |
| 权限审批 | policy profile、approval mode、permission mode、continuation frame | extension `tool_call` hook 可拦截或修改 | Ora 明显更强 |
| UI 投影 | snapshot / Trails / approval card | tool 自带 `renderCall` / `renderResult` | Pi 单工具可读性更好 |
| 流式输出 | runtime 事件化强，但 shell tool partial result 较弱 | bash 有 `onUpdate`、节流、OutputAccumulator | Ora 可吸收 |
| 文件修改 | `file.write` / `file.patch` 高风险审批 | edit/write 有同文件 mutation queue | Ora 可补 per-file queue |
| patch 能力 | 单次替换语义更明显 | `edits[]` 多替换、唯一匹配、diff preview | Ora 可升级 |
| 后端抽象 | 多数工具绑定本地实现 | 每个工具支持 `operations` 注入 | Ora 可为 remote workspace 预留 |
| 取消机制 | model call 有 signal；tool executor context 未统一传 signal | read/write/edit/bash/find 等都支持 AbortSignal | Ora 应统一补齐 |

## 4. Pi 的 tool 设计特点

### 4.1 ToolDefinition 内聚

Pi 的单个工具通常把以下内容放在同一个 definition 中：

- `name`
- `label`
- `description`
- `parameters`
- `promptSnippet`
- `promptGuidelines`
- `prepareArguments`
- `executionMode`
- `execute`
- `renderCall`
- `renderResult`
- `renderShell`

代表文件：`tool-definition-wrapper.ts`、`read.ts`、`edit.ts`、`bash.ts`。

这个结构的优势是：一个工具的模型提示、输入约束、执行逻辑和 UI 呈现能一起演进，不容易出现 schema、prompt、execute 三者漂移。

### 4.2 Operations 可插拔

Pi 的 read/write/edit/bash/find/grep 都有 operations 接口。例如：

- `ReadOperations.readFile/access/detectImageMimeType`
- `WriteOperations.writeFile/mkdir`
- `EditOperations.readFile/writeFile/access`
- `BashOperations.exec`
- `FindOperations.exists/glob`
- `GrepOperations.isDirectory/readFile`

这意味着同一套 tool definition 可以接本地文件系统，也可以接 SSH、远程容器或其他 workspace backend。

### 4.3 流式输出与截断处理

Pi 的 bash tool 通过 `OutputAccumulator` 处理流式输出：

- 增量 append stdout/stderr。
- 按时间节流触发 `onUpdate`。
- 保留 bounded memory。
- 输出过大时写入临时完整日志文件。
- 对展示内容做 tail truncation。

这对 coding agent 很关键，因为测试、构建、安装依赖等命令常常输出很大。

### 4.4 文件 patch 的工程细节

Pi 的 edit tool 支持：

- `edits[]` 多个 replacement。
- 每个 `oldText` 必须唯一、非重叠。
- 多个 edit 按原始文件匹配，而不是增量串联匹配。
- 保留 BOM 和原始 line ending。
- 生成 unified diff。
- 在 UI 中提前渲染 diff preview。

这比单纯 search/replace 更适合大模型稳定改代码。

### 4.5 同文件 mutation queue

Pi 的 `withFileMutationQueue(filePath, fn)` 会把同一个文件的写操作串行化，不同文件仍可并行。它解决的是 agent 并行或连续 tool call 中的同文件竞态。

## 5. Ora 当前机制特点

### 5.1 ToolDescriptor 与 runtime fields

Ora 的共享描述符定义在 `packages/shared/src/capabilities.ts`。核心字段包括：

- `id`
- `label`
- `description`
- `category`
- `riskLevel`
- `parameters`
- `promptSnippet`
- `promptGuidelines`
- `executionMetadata`
- `requiresApproval`
- `implemented`
- `allowedForProfiles`

runtime 执行字段由 `RuntimeToolDefinition` 承载，位于 `apps/runtime/src/harness/capability-registries.ts`：

- `descriptor`
- `promptSnippet`
- `promptGuidelines`
- `promptExample`
- `requiresApprovalCopy`
- `actionRiskLevel`
- `approvalRequest`
- `riskLevel`
- `execute`

工具具体执行再分散在 `runtime-file-tools.ts`、`runtime-shell-tool.ts`、`runtime-mcp-tools.ts`、`runtime-skill-tools.ts` 等文件中。

### 5.2 RuntimeToolExecutor

`RuntimeToolExecutor` 负责：

- 过滤可用工具：`enabledToolIds()`。
- 生成 provider native tool definitions：`toolDefinitions()`。
- 生成 JSON fallback system prompt：`systemPrompt()`。
- 从模型文本中提取 fallback tool call：`extractToolCall()`。
- 计算风险等级：`riskLevel()`。
- 生成 approval copy：`approvalRequest()`。
- 执行工具：`executeWithMetadata()`。
- 跑 pre/post policy hooks。

这是 Ora 的核心优势：工具不是孤立执行，而是进入 policy、risk、approval、action、ledger 体系。

### 5.3 Tool call 到 action 的运行链

单个 node 内，`node-runtime-loop.ts` 会选择工具调用，然后进入 `RuntimeToolCallService.runToolTurn()`。

主要流程：

1. 模型返回 native tool call 或 JSON fallback tool call。
2. `selectRuntimeToolAttempt()` 选择本轮 tool attempt。
3. `registerRuntimeToolAttempt()` 做重复调用和循环边界检查。
4. `codeDevelopmentToolBoundaryError()` 做 mode/agent 边界检查。
5. `proposeRuntimeToolAction()` 创建 action 和 toolCall record。
6. `resolveRuntimeActionApproval()` 根据 policy/approval mode 进入 approved、approval_required 或 interrupted。
7. `invokeRuntimeToolExecution()` 进入 middleware chain。
8. terminal 调用 `runtimeToolExecutor.executeWithMetadata()`。
9. `recordRuntimeToolActionSucceeded()` 写 action ledger、tool ledger、event。
10. 工具结果进入 message 列表，触发 follow-up model call。

### 5.4 Snapshot 与 desktop projection

Ora 的 tool call 会进入：

- `StateSnapshot.toolCalls`
- `StateSnapshot.actions`
- `StateSnapshot.events`
- `pendingApprovals`
- `continuation.frames`

Desktop 再通过：

- `trailViewModel.ts`
- `ApprovalRequestCard.tsx`
- `TrailsDrawer.tsx`
- `TrailsTabs.tsx`

把工具调用、审批、agent lane、semantic timeline、evidence 等投影出来。

这使 Ora 比 Pi 更适合长任务、可恢复任务、需要审批和审计的任务。

## 6. Ora 可借鉴的迭代建议

### P0：补齐 tool 参数 schema

当前 `MVP_TOOLS` 中不少工具仍然是 `parameters: {}`，例如：

- `file.read`
- `file.list`
- `file.glob`
- `file.grep`
- `file.write`
- `file.patch`
- `web.fetch`
- `web.search`
- `document.extract`

建议优先补齐 JSON schema，并在 runtime definition 构造时统一校验。

预期收益：

- 减少模型填错参数。
- 提升 provider native tool call 成功率。
- 减少 fallback JSON 解析和 repair 负担。
- 让 approval copy 能依赖更稳定的字段。

### P1：引入更内聚的 RuntimeToolDefinitionV2

建议在 runtime 内部引入更完整的定义结构，把 descriptor、prompt、risk、approval、execute、preview metadata 收到同一层。例如：

```ts
interface RuntimeToolDefinitionV2<TContext, TArgs, TResult> {
  descriptor: ToolDescriptor;
  parameters: JsonSchema;
  promptSnippet?: string;
  promptGuidelines?: string[];
  promptExample?: string;
  prepareArguments?: (input: unknown) => TArgs;
  riskLevel?: (args: TArgs, context: TContext) => ToolRiskLevel;
  actionRiskLevel?: (args: TArgs, context: TContext) => ActionRiskLevel;
  approvalRequest?: (args: TArgs, context: ApprovalContext) => ActionApprovalRequestCopy;
  execute: (args: TArgs, context: TContext) => Promise<TResult> | TResult;
  resultPreview?: (result: TResult) => ToolResultPreview;
}
```

这不要求立刻改 shared public contract，可以先作为 runtime 内部抽象。

### P1：为文件变更加 per-file mutation queue

建议新增：

```ts
withWorkspaceFileMutationQueue(absolutePath, fn)
```

覆盖：

- `file.write`
- `file.patch`
- 未来 `file.delete`

如果后续 Ora 支持多 agent 并行工具执行，这个机制会避免同一文件被同时读改写导致 patch 丢失。

### P1：统一 AbortSignal 进入 tool execution context

当前 provider request 已有 `signal`，但 runtime tool executor 的 execution context 没有统一传入 `AbortSignal`。建议：

```ts
interface RuntimeToolExecutionContext {
  signal?: AbortSignal;
  ...
}
```

优先改造：

- `shell.execute`
- `web.fetch`
- `web.search`
- `mcp.call`
- `document.extract`

`shell.execute` 还应支持 abort 时 kill process tree，而不只是 kill 直接 child。

### P1：升级 `file.patch`

建议把 `file.patch` 从单替换升级为多 edit：

```json
{
  "path": "src/file.ts",
  "edits": [
    { "oldText": "...", "newText": "..." }
  ]
}
```

规则：

- 每个 `oldText` 必须唯一。
- 不允许重叠 edit。
- 多个 edit 都基于原始文件匹配。
- 保留 BOM 和 line ending。
- 执行结果返回 unified diff、firstChangedLine、additions/deletions。
- approval card 和 Trails 展示 diff preview。

### P2：Desktop Trails 增加 tool-specific renderer

Ora 不必把 renderer 放进 shared，但 desktop 可以加一层 renderer registry：

```ts
const toolRenderers = {
  "file.patch": renderDiffPreview,
  "file.write": renderFileWritePreview,
  "shell.execute": renderShellOutput,
  "file.read": renderCodePreview,
  "web.fetch": renderDocumentPreview,
};
```

这样 Trails 不只是展示 JSON preview，而是针对工具类型展示更可读的结果。

### P2：引入 workspace operations adapter

参考 Pi 的 operations 设计，Ora 可在 `RuntimeToolExecutionContext` 中加入：

```ts
interface WorkspaceOperations {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(path: string): Promise<WorkspaceEntry[]>;
  grep(args: GrepArgs): Promise<GrepResult>;
  exec(args: ShellArgs): Promise<ShellResult>;
}
```

短期默认本地实现，长期可接：

- SSH workspace
- container workspace
- cloud sandbox
- remote coding session

## 7. 不建议照搬的部分

### 7.1 不要弱化 Ora 的 approval/action/continuation 体系

Pi 的 hook 拦截机制适合轻量 coding agent，但 Ora 已经有：

- action ledger
- policy decision
- approval gate
- continuation frame
- resume strategy
- desktop approval UI

这些是 Ora 的产品级能力，不应退化成单纯 beforeToolCall hook。

### 7.2 不要把 UI renderer 放入 shared contract

Pi 是 TUI 产品，tool renderer 和 tool definition 放一起合理。Ora 有 runtime、desktop、未来 web/channel 多投影形态。建议 renderer 留在 UI 层，通过 toolId registry 做映射。

### 7.3 不要收缩到 coding-only 工具集

Pi 的工具集偏 coding：read/bash/edit/write/grep/find/ls。Ora 的差异点包括：

- skills
- modes
- selfIteration
- package
- automations
- mcp
- plan.update
- clarification

这些应继续保留，并以统一 tool definition 方式治理。

## 8. 建议实施顺序

### Phase 1：低风险质量补齐

1. 补齐 `MVP_TOOLS` 中 file/web/document 工具的 JSON schema。
2. 给 `RuntimeToolExecutor.toolDefinitions()` 增加 schema 测试。
3. 给 `file.patch` 和 `file.write` 的 approval copy 增加目标路径、影响范围、是否创建/覆盖等字段。

### Phase 2：工具定义内聚

1. 引入 `RuntimeToolDefinitionV2` 内部类型。
2. 先迁移 file tools 和 shell tool。
3. 保持 `ToolDescriptor` shared contract 不破坏。
4. 新增 definition-level `prepareArguments`，兼容模型偶发 JSON string 参数等情况。

### Phase 3：执行可靠性

1. 加 `RuntimeToolExecutionContext.signal`。
2. shell/web/MCP/document 消费 signal。
3. 增加 per-file mutation queue。
4. shell abort 改为 kill process tree。

### Phase 4：可观察性和交互体验

1. `file.patch` 输出 diff metadata。
2. 文件变更 artifact 带 unified diff。
3. Desktop Trails 增加 tool renderer registry。
4. approval card 展示 diff preview 和 shell command structured preview。

## 9. 最小可行 PR 切片

如果要用最小 PR 推进，建议先做这个切片：

1. 在 `packages/shared/src/capabilities.ts` 补齐 `file.read/list/glob/grep/write/patch` 参数 schema。
2. 在 `runtime-file-tools.ts` 为 `file.patch` 增加 `edits[]` 入参兼容，但保留旧 `search/replace`。
3. 新增 `runtime-file-mutation-queue.ts`，只包住 `writeWorkspaceFile` 和 `patchWorkspaceFile`。
4. 给 `file.patch` result 增加 diff 字段，不先改 desktop。
5. 补测试覆盖：唯一匹配、重复匹配报错、同文件串行、旧参数兼容。

这个切片风险低，但能明显提升 tool 稳定性。

## 10. 最终判断

Ora 的方向不是变成 Pi，而是吸收 Pi 的工具单体工程化经验：

- **Ora 保留治理链**：policy、approval、resume、ledger、snapshot、Trails。
- **Ora 补齐工具内核**：schema、operations、abort、streaming、diff、mutation queue。

这样 Ora 的 tool 系统会更像一个可恢复、可审计、可扩展的 agent runtime，而不是简单函数调用列表。
