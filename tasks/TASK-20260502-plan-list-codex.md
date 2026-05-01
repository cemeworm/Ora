# TASK-20260502: Plan List 能力（参考 codex update_plan）

Status: Done
Last Updated: 2026-05-02
Owner: Linus Assistant
Source of Truth: This file

## Goal

为 Ora 新增 codex 风格的 LLM 驱动动态 plan list 能力：`plan.update` 工具让模型在 turn 内创建和维护工作计划，并在前端展示。同时完成 Plan Mode 分离——Plan Mode 下硬拦截 `plan.update`。

## 背景

Ora 已有基于 pattern template 的 PlanItem/PlanService 体系（工作流阶段管理），但缺少 LLM 可调用的动态 checklist 工具。codex 的设计将 `update_plan` 定位为 TODO/checklist 工具，模型每次提交完整 plan list，状态约束靠 prompt 维护。

Ora 已有 `TaskIntent = "plan"` 作为 Plan Mode 概念，但缺少 Plan Mode 下禁用 `plan.update` 的硬拦截。

## 设计参考

- codex-rs/protocol/src/plan_tool.rs — PlanItemArg, UpdatePlanArgs, StepStatus
- codex-rs/core/src/tools/handlers/plan.rs — handle_update_plan
- codex-rs/protocol/src/protocol.rs — EventMsg::PlanUpdate
- codex-rs/tui/src/chatwidget.rs — saw_plan_update_this_turn, last_plan_progress
- codex-rs/protocol/src/prompts/base_instructions/default.md — prompt 约束
- codex-rs/collaboration-mode-templates/templates/plan.md — Plan Mode ≠ update_plan

## 架构决策

1. **独立于现有 PlanItem 体系**: pattern-template PlanItem 用于工作流节点管理，plan list 是 LLM 驱动的动态 checklist，两者共存互不干扰。
2. **简单数据结构**: `{step, status}` 其中 status ∈ {pending, in_progress, completed}，模型每次提交完整数组。
3. **Thin handler**: 工具处理器只做 JSON 校验，不维护复杂状态机。语义约束靠 prompt。
4. **事件驱动**: 工具调用成功后发射 `plan_list.updated` 事件，存入 StateSnapshot.planList。
5. **Plan Mode 硬拦截**: `taskIntent === "plan"` 时 `plan.update` 抛 Error，由恢复机制捕获。
6. **UI 复用现有模式**: 使用 CollapsibleCard + TaskItem 组件，与 todos 渲染一致。

## 修改清单 (8 files)

### 1. packages/shared/src/actions.ts
新增 PlanListStepStatus, PlanListStep, UpdatePlanArgs schemas。

### 2. packages/shared/src/runtime.ts
- OraEventTypeSchema 新增 `"plan_list.updated"`
- StateSnapshotSchema 新增 `planList` 字段

### 3. packages/shared/src/capabilities.ts
MVP_TOOLS 新增 `plan.update` 工具描述符。

### 4. apps/runtime/src/harness/runtime-tool-executor.ts
- IMPLEMENTED_RUNTIME_TOOL_IDS 新增 `"plan.update"`
- RuntimeToolExecutorOptions 新增 `taskIntent` 字段
- executeWithMetadata 新增 plan.update case（含 Plan Mode 拦截）
- systemPrompt 新增 plan list 使用规则
- 新增 handleUpdatePlan 函数

### 5. apps/runtime/src/harness/runtime-kernel.ts
- 构造 RuntimeToolExecutor 时传入 taskIntent
- plan.update 成功后发射 plan_list.updated 事件，更新 snapshot.planList

### 6. apps/desktop/src/types.ts
- 新增 TurnPlanListStep 接口
- AssistantTurnAttachment 新增 planList 字段

### 7. apps/desktop/src/lib/viewModel.ts
从 snapshot.planList 提取到 AssistantTurnAttachment。

### 8. apps/desktop/src/components/AssistantTurnCard.tsx
在 process steps 之后、todos 之前渲染 plan list CollapsibleCard。

## 调用链

```
LLM 调用 plan.update({ explanation, plan: [...] })
  → RuntimeToolExecutor.executeWithMetadata("plan.update", args)
    → Plan Mode 检查: taskIntent === "plan" → throw Error
    → UpdatePlanArgsSchema.parse(args)
    → 返回确认消息
  → runtime-kernel 检测到 plan.update 工具调用
    → 发射 plan_list.updated 事件 (payload = UpdatePlanArgs)
    → 更新 StateSnapshot.planList
  → desktop APPLY_RUN_STREAM 合并事件
    → viewModel 从 snapshot.planList 提取 TurnPlanListStep[]
    → AssistantTurnCard 渲染 CollapsibleCard
```

## Plan Mode 拦截链

```
LLM 在 plan intent 下调用 plan.update
  → executeWithMetadata 检查 this.taskIntent === "plan"
    → throw Error("plan.update is not available in plan mode...")
  → 被 node-runtime-loop 的工具错误恢复捕获
    → RecoveryRule: tool_error → fallback_artifact
    → LLM 收到错误消息，被告知 plan mode 下不可用此工具
```

## 验证

1. implement intent: 提出 "帮我实现计数器组件" → LLM 调用 plan.update → UI 渲染 plan list → 进度随工具调用更新
2. plan intent: 提出 "分析并计划..." → LLM 调用 plan.update → 收到错误 → 被恢复机制捕获
3. chat intent: plan.update 正常工作
4. 现有 pattern-template plan/todo 功能不受影响
5. TypeScript 类型检查通过 (pnpm typecheck) ✅
6. 构建通过 (pnpm build) ✅
