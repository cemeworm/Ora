# TASK-20260502-1752: 修复 plan 模式输出后不弹出确认交互

## Problem

当用户选择"计划"任务意图时，存在两个问题：
1. **Run 不停止** — LLM 持续调用只读工具探索，不停刷新正文
2. **"确认执行"按钮不出现** — 按钮需要 run settle 才显示，但 run 永远不 settle

**根本原因：** 当前 plan 模式只有一句模糊的系统提示（"计划输出后等待用户确认"），LLM 不知道何时该停止探索、用什么格式输出、如何判定"计划完备"。

## Solution

借鉴 Codex 的 prompt 协议 + 输出标签 + UI 渲染约定方案：

- **Prompt 定义三阶段推进和"决策完备性"停止标准**
- **LLM 在计划完备时输出 `<proposed_plan>` 标签并停止调用工具**
- **Desktop 端检测 `<proposed_plan>` 标签，渲染确认按钮**

## Changes

### 1. `apps/runtime/src/harness/runtime-kernel.ts:779-780`
- 替换简短的 plan 模式提示为完整的 plan 协议提示
- 包含停止标准、未知分类、三阶段推进、输出协议

### 2. `apps/desktop/src/types.ts:277-291`
- `AssistantTurnAttachment` 接口增加 `hasProposedPlan: boolean`

### 3. `apps/desktop/src/lib/viewModel.ts`
- 新增 `hasProposedPlanInSnapshot()` 检测函数
- `buildAssistantTurnAttachment()` 返回值增加 `hasProposedPlan` 字段

### 4. `apps/desktop/src/components/ChatView.tsx`
- 从最新 chatMessage 的 `turn?.hasProposedPlan` 提取状态
- 传递给 ChatInput

### 5. `apps/desktop/src/components/ChatInput.tsx:464`
- Props 增加 `hasProposedPlan: boolean`
- 确认按钮条件从 `lastRunTaskIntent === "plan"` 改为 `lastRunTaskIntent === "plan" || hasProposedPlan`

## NOT Changed

- `runtime-completion.ts` — 不硬编码工具预算上限
- `state.tsx` — `lastRunTaskIntent` 逻辑保持不变（作为后备）
- `node-runtime-loop.ts` — 工具循环逻辑不变
- `useRunActions.ts` — 工具过滤逻辑不变

## Verification

1. 运行现有测试确认无回归
2. 手动测试：选择"计划"模式 → 提交任务 → LLM 在决策完备后输出 `<proposed_plan>` 并停止 → "确认执行"按钮出现
3. 验证复杂任务也能正常完成计划输出
4. 验证确认执行后切换到 implement 模式
