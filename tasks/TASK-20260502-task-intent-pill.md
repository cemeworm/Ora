# TASK-20260502: 任务目标 Pill 配置

Status: Done
Last Updated: 2026-05-02
Owner: Linus Assistant
Source of Truth: This file

## Goal

在 Ora 桌面应用输入框中新增「任务目标」pill 选择器，提供对话/计划/实施三种模式，控制模型可用工具范围和系统提示词行为。

## 三种模式

| 模式 | 工具限制 | 行为 |
|------|---------|------|
| 对话 (chat) | 不可用文件变更工具 | 问答模式，解释代码、回答问题 |
| 计划 (plan) | 不可用文件变更工具 | 分析意图、拆解方案、输出执行计划，等待确认后切换实施 |
| 实施 (implement) | 完整工具访问（默认） | 可以使用所有工具帮助用户完成任务 |

## 设计参考

参考 Codex 的 Collaboration Mode / Plan Mode 设计：
- codex-rs/collaboration-mode-templates/templates/plan.md — Plan 模式 prompt 模板
- codex-rs/models-manager/src/collaboration_mode_presets.rs — Preset 注册
- codex-rs/tui/src/collaboration_modes.rs — TUI 选择

## 架构决策

1. **TaskIntent 正交于现有的工作模式 (CoordinationPattern)**：任务目标控制工具可用性，工作模式控制 Agent 协作拓扑。
2. **TaskIntent 通过 RunConfig.metadata 传递**：不修改 RunConfigSchema 结构，遵循 memoryPromptOverlay 等现有字段的模式。
3. **工具过滤在客户端 (useRunActions.ts)**：发送运行请求前过滤 toolIds，简单直接。
4. **系统提示在运行时注入**：runtime-kernel.ts 读取 metadata.taskIntent 并注入中文提示词。
5. **Session-scoped 状态**：每个会话独立保存任务目标，切换会话自动恢复。
6. **默认 "实施" 模式**：向后兼容，现有用户无感知。

## 修改文件 (10 files, +279/-455)

### packages/shared/src/runtime.ts
- 新增 `TaskIntentSchema = z.enum(["chat", "plan", "implement"])`
- 新增 `TaskIntent` 类型

### apps/desktop/src/lib/state.tsx (+38)
- WorkbenchState 添加 `taskIntent`, `sessionTaskIntents`, `lastRunTaskIntent` 字段
- 新增 `SET_TASK_INTENT` action
- 新增辅助函数 `sessionTaskIntent`, `setSessionTaskIntent`, `clearSessionTaskIntent`
- 更新 6 个 reducer case: SET_TASK_INTENT, RESET_RUNTIME_VIEW, HYDRATE_SESSION, ARCHIVE_SESSION_OPTIMISTIC, SELECT_SESSION, APPLY_RUN_STREAM, BEGIN_RUN_REQUEST

### apps/desktop/src/components/ChatInput.tsx (+71)
- 新增 `Picker` 弹出选择器（在附件按钮与模型选择器之间）
- 三个选项：实施 (Play 图标)、计划 (ClipboardList 图标)、对话 (MessagesSquare 图标)
- 计划模式运行完成后显示「确认执行」按钮（emerald 色）

### apps/desktop/src/components/ChatView.tsx (+7)
- 传递 `taskIntent`, `onTaskIntentChange`, `lastRunTaskIntent`, `onConfirmPlan` 到 ChatInput

### apps/desktop/src/lib/useRunActions.ts (+25)
- 定义 `FILE_MODIFICATION_TOOL_IDS` (15 个 requires_approval 工具)
- Chat/Plan 模式下过滤文件修改工具
- metadata 中传递 `taskIntent`

### apps/runtime/src/harness/prompt-context.ts (+3)
- AgentPromptSectionId 新增 `"task_intent_context"`
- AgentPromptContextInput 新增 `taskIntentContext?: string`
- buildAgentPromptContext 中插入 task_intent_context section

### apps/runtime/src/harness/runtime-kernel.ts (+13)
- 读取 `config.metadata.taskIntent`
- 对话模式注入："你处于对话模式，不能修改任何文件..."
- 计划模式注入："你处于计划模式。请理解用户意图，拆解目标方案..."

### apps/desktop/src/components/AssistantTurnCard.tsx (-330)
### apps/desktop/src/components/AssistantTurnCard.test.tsx (-170)
### apps/desktop/src/lib/viewModel.ts (+74)
- 此前已存在的协作轨迹简化重构（将 Agent 交接步骤内联到 process timeline）

## 调用链

```
用户选择任务目标 (ChatInput pill)
  → dispatch SET_TASK_INTENT
    → state.taskIntent 更新
      → startRun() 读取 state.taskIntent
        → 过滤 FILE_MODIFICATION_TOOL_IDS (chat/plan 模式)
        → metadata.taskIntent 写入 RunConfig
          → runtime-kernel 读取 metadata.taskIntent
            → 注入对应系统提示词到 Agent prompt context
```

## 验证结果

- TypeScript 类型检查：通过 (pnpm typecheck)
- 构建：通过 (pnpm build)
- UI 验证项：
  - 底部工具栏出现「任务目标」pill
  - 弹出三个选项，含图标和描述
  - 默认选中「实施」
  - 计划模式完成后出现「确认执行」按钮
