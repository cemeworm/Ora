# TASK-20260502: 计划模式 UI 改造 — 计划卡片 + 决策面板 + 会话状态

## Problem

当前计划模式存在两个体验问题：
1. **计划内容不突出** — 计划以普通 Markdown 文本展示，与普通对话无区分
2. **确认交互太弱** — "确认执行"只是工具栏中的一个小 chip 按钮，用户容易忽略

## Solution

1. 计划内容以独立 **PlanCard** 卡片展示（先正文后步骤），与普通消息区分
2. 输入区替换为 **PlanDecisionPanel**，明确询问"是否按该计划实施？"，两个按钮上下排布
3. 侧边栏会话状态新增 **"需要决策"**（decision_needed），紫色徽章

## Changes

### 1. `apps/desktop/src/types.ts:8-14`
- `RunStatus` 联合类型新增 `"decision_needed"`

### 2. `apps/desktop/src/lib/state.tsx`
- `WorkbenchState` 新增 `sessionPendingPlanDecision: Record<string, boolean>` 字段
- 新增 action: `SET_PLAN_DECISION_PENDING` (`sessionId: string; pending: boolean`)
- `APPLY_RUN_STREAM`: 流结束时若 `taskIntent === "plan"` 且 snapshot 文本含 `<proposed_plan>`，设为 `true`
- `HYDRATE_SESSION`: 初始化时检查 snapshot 是否有 `<proposed_plan>`
- `BEGIN_RUN_REQUEST`: 清除当前 session 的 pending 状态
- `ARCHIVE_SESSION_OPTIMISTIC`: 清除被归档 session 的 pending 状态

### 3. `apps/desktop/src/components/Sidebar.tsx`
- `statusFromSession()` 新增第三参数 `hasPendingPlanDecision?: boolean`，优先返回 `"decision_needed"`
- `SessionStatusBadge` 新增 `decision_needed` 分支：紫色徽章
- `SessionLeadingIndicator` 新增 `decision_needed` 分支：紫色圆点

### 4. `apps/desktop/src/components/StatusPill.tsx`
- `statusLabels` 新增 `decision_needed: "Decision"`
- attention 条件包含 `status === "decision_needed"`

### 5. `apps/desktop/src/components/StatusBadge.tsx`
- `STATUS_COLORS` 新增 `decision_needed` 紫色配色

### 6. `apps/desktop/src/lib/i18n.ts`
- 新增 `"Needs decision": "需要决策"` 和 `"Decision": "决策"`

### 7. `apps/desktop/src/components/PlanCard.tsx`（新文件）
- Props: `{ planSteps: TurnPlanListStep[]; planContent?: string }`
- 布局：先 Markdown 正文，再步骤列表（编号 + 状态图标）
- 样式：Ora 主题色（`border border-border bg-card shadow-lift`），标题"任务计划"

### 8. `apps/desktop/src/components/AssistantTurnCard.tsx`
- 当 `turn?.hasProposedPlan && planList.length > 0` 时，用 `<PlanCard>` 替换原可折叠 Plan 卡片
- `hasProposedPlan` 时隐藏单独 MarkdownContent（内容已在 PlanCard 中渲染）
- 原可折叠 planList 保留给非 plan 模式使用

### 9. `apps/desktop/src/components/PlanDecisionPanel.tsx`（新文件）
- Props: `{ onConfirm: () => void; onDecline: () => void; disabled?: boolean }`
- 布局：标题"是否按该计划实施？" + 两个按钮上下排布（`flex-col`）
- "是，按该计划实施" emerald 配色，"否，我要调整计划" secondary 配色

### 10. `apps/desktop/src/components/ChatInput.tsx`
- 新增 props: `planDecisionPending`, `onConfirmPlanDecision`, `onDeclinePlanDecision`
- 当 `showPlanDecisionTray` 时渲染 `<PlanDecisionPanel>` 替代输入卡片
- 原"确认执行"chip 按钮仅在 `!planDecisionPending` 时显示

### 11. `apps/desktop/src/components/ChatView.tsx`
- 从 `state.sessionPendingPlanDecision[selectedSession.id]` 读取 `planDecisionPending`
- `onConfirmPlanDecision`: 清除 pending + 切换 implement + 设置 prompt
- `onDeclinePlanDecision`: 清除 pending

### 12. `apps/desktop/src/components/ChatMessages.tsx`
- 新增 `hasPlanDecisionTray` prop，调整底部 padding

## 数据流

```
流结束 → hasProposedPlan && taskIntent === "plan"
  → sessionPendingPlanDecision[sessionId] = true
  → Sidebar: "需要决策" 紫色徽章
  → ChatInput: PlanDecisionPanel 替换输入框
  → AssistantTurnCard: PlanCard 卡片展示计划

点击"是" → 清除 pending → 切 implement → 设置执行 prompt
点击"否" → 清除 pending → 输入框恢复 → 状态归 done
```

## Verification

1. `pnpm desktop dev` 启动应用
2. 新建会话，切换任务目标为"计划"
3. 输入计划请求 → AI 回复后计划以"任务计划"卡片展示（先正文后步骤）
4. 输入区显示"是否按该计划实施？" + 两个上下排布按钮
5. 侧边栏该会话显示紫色"Needs decision"
6. 点击"是" → 进入实施模式开始执行
7. 重新测试点击"否" → 输入框恢复，侧边栏状态消失

## 实施进度

- [x] 1. `types.ts` — RunStatus 新增 `decision_needed`
- [x] 2. `state.tsx` — 新增 `sessionPendingPlanDecision` / `SET_PLAN_DECISION_PENDING` action / reducer 逻辑
- [x] 3. `Sidebar.tsx` — statusFromSession 第三参数 / decision_needed badge + indicator
- [x] 4. `StatusPill.tsx` — statusLabels + attention 条件
- [x] 5. `StatusBadge.tsx` — STATUS_COLORS 新紫色配色
- [x] 6. `i18n.ts` — "Needs decision" / "Decision" 翻译
- [x] 7. `PlanCard.tsx` — 新组件：先正文后步骤
- [x] 8. `AssistantTurnCard.tsx` — hasProposedPlan 时使用 PlanCard
- [x] 9. `PlanDecisionPanel.tsx` — 新组件：确认/调整按钮
- [x] 10. `ChatInput.tsx` — planDecisionPending 时渲染 PlanDecisionPanel
- [x] 11. `ChatView.tsx` — 从 state 读取 planDecisionPending，接线 confirm/decline
- [x] 12. `ChatMessages.tsx` — hasPlanDecisionTray prop，调整底部 padding
