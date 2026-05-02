# 计划模式 UI 改造

## 背景

当前 Ora 在计划模式下，AI 输出计划后只是在文本中嵌入 `<proposed_plan>` 标签，并在输入框底部显示一个小小的"确认执行"按钮。需要将计划展示为独立卡片，并在输入区提供明确的决策 UI，同时在侧边栏显示"需要决策"状态。

## 修改清单

### 1. types.ts — 新增 RunStatus
- `/Users/quintenchen/developer/Ora/apps/desktop/src/types.ts`
- `RunStatus` 联合类型新增 `"decision_needed"`

### 2. state.tsx — 新增 plan decision 状态
- `/Users/quintenchen/developer/Ora/apps/desktop/src/lib/state.tsx`
- `WorkbenchState` 新增 `sessionPendingPlanDecision: Record<string, boolean>`
- 新增 action: `SET_PLAN_DECISION_PENDING` (`sessionId: string; pending: boolean`)
- `APPLY_RUN_STREAM`: 流结束时若 `taskIntent === "plan"` 且 snapshot 包含 `<proposed_plan>`，设为 `true`
- `HYDRATE_SESSION`: 初始化为当前 snapshot 是否有 plan（检查文本是否包含 `<proposed_plan>`）
- `BEGIN_RUN_REQUEST`: 清除当前 session 的 pending 状态
- `ARCHIVE_SESSION_OPTIMISTIC`: 清除被归档 session 的 pending 状态

### 3. Sidebar.tsx — 会话状态显示"需要决策"
- `/Users/quintenchen/developer/Ora/apps/desktop/src/components/Sidebar.tsx`
- `statusFromSession()` 新增第三个参数 `hasPendingPlanDecision?: boolean`，优先返回 `"decision_needed"`
- `SessionStatusBadge` 新增 `decision_needed` 分支：紫色徽章 "Needs decision"
- `SessionLeadingIndicator` 新增 `decision_needed` 分支：紫色圆点
- 调用 `statusFromSession` 处传入 `state.sessionPendingPlanDecision[session.sessionId]`

### 4. StatusPill.tsx / StatusBadge.tsx — 新增状态映射
- `/Users/quintenchen/developer/Ora/apps/desktop/src/components/StatusPill.tsx`
  - `statusLabels`: 新增 `decision_needed: "Decision"`
  - attention 条件包含 `status === "decision_needed"`
- `/Users/quintenchen/developer/Ora/apps/desktop/src/components/StatusBadge.tsx`
  - `STATUS_COLORS`: 新增 `decision_needed` 紫色配色

### 5. i18n.ts — 国际化
- `/Users/quintenchen/developer/Ora/apps/desktop/src/lib/i18n.ts`
- 新增 `"Needs decision": "需要决策"` 和 `"Decision": "决策"`

### 6. PlanCard.tsx（新组件）
- `/Users/quintenchen/developer/Ora/apps/desktop/src/components/PlanCard.tsx`
- Props: `{ planSteps: TurnPlanListStep[]; planContent?: string }`
- 布局：先渲染 markdown 正文，再渲染步骤列表
- 样式：Ora 主题色（`border border-border bg-card shadow-lift` 圆角卡片），与消息内容同宽
- 卡片标题："任务计划"

### 7. AssistantTurnCard.tsx — 集成 PlanCard
- `/Users/quintenchen/developer/Ora/apps/desktop/src/components/AssistantTurnCard.tsx`
- 当 `!isPlaceholder && turn?.hasProposedPlan && planList.length > 0` 时，用 `<PlanCard>` 替换原来的可折叠 Plan 卡片
- PlanCard 内部已渲染 markdown 正文 + 步骤列表，此时隐藏单独的 MarkdownContent 避免重复
- 原有可折叠 planList 逻辑保留（用于非 plan 模式）

### 8. PlanDecisionPanel.tsx（新组件）
- `/Users/quintenchen/developer/Ora/apps/desktop/src/components/PlanDecisionPanel.tsx`
- Props: `{ onConfirm: () => void; onDecline: () => void; disabled?: boolean }`
- 两个按钮上下排布（`flex-col`），各占满宽
- "是，按该计划实施" emerald 配色，"否，我要调整计划" secondary/ghost 配色
- 圆角卡片 + shadow-lift

### 9. ChatInput.tsx — 集成 PlanDecisionPanel
- `/Users/quintenchen/developer/Ora/apps/desktop/src/components/ChatInput.tsx`
- 新增 props: `planDecisionPending`, `onConfirmPlanDecision`, `onDeclinePlanDecision`
- 当 `showPlanDecisionTray`（非 loading 且有 pending decision）时：
  - 渲染 `<PlanDecisionPanel>` 替代整个输入卡片
  - textarea + toolbar 卡片隐藏
- 原有"确认执行"chip 按钮仅在 `!planDecisionPending` 且满足原有条件时显示

### 10. ChatView.tsx — 数据连接
- `/Users/quintenchen/developer/Ora/apps/desktop/src/components/ChatView.tsx`
- 从 `state.sessionPendingPlanDecision[selectedSession.id]` 读取 `planDecisionPending`
- `onConfirmPlanDecision`: dispatch `SET_PLAN_DECISION_PENDING` false + `SET_TASK_INTENT` implement + 设置 prompt
- `onDeclinePlanDecision`: dispatch `SET_PLAN_DECISION_PENDING` false
- 将新 props 传递给 `ChatInput`

### 11. ChatMessages.tsx — padding 调整
- `/Users/quintenchen/developer/Ora/apps/desktop/src/components/ChatMessages.tsx`
- 新增 `hasPlanDecisionTray` prop，调整底部 padding（与 `hasApprovalTray`/`hasClarificationTray` 同逻辑）

## 数据流

```
后端流结束 → APPLY_RUN_STREAM
  → hasProposedPlanInSnapshot(activeSnapshot) === true && taskIntent === "plan"
  → sessionPendingPlanDecision[sessionId] = true
  → Sidebar: statusFromSession → "decision_needed" → 紫色徽章
  → ChatView: planDecisionPending = true
  → ChatInput: 显示 PlanDecisionPanel（隐藏输入框）
  → AssistantTurnCard: 显示 PlanCard（计划内容卡片化）

用户点击"是":
  → dispatch CLEAR pending
  → dispatch taskIntent = "implement"
  → 设置 prompt = "请按照上述计划开始执行"
  → 用户可发送消息开始实施

用户点击"否":
  → dispatch CLEAR pending
  → 侧边栏状态恢复为 done
  → 输入框恢复正常，用户自行输入
```

## 实施顺序

1. types.ts — 新增 RunStatus
2. state.tsx — 新增 plan decision 状态和 reducer 逻辑
3. StatusPill.tsx / StatusBadge.tsx — 状态映射
4. i18n.ts — 国际化
5. Sidebar.tsx — 会话状态显示
6. PlanCard.tsx — 新组件
7. AssistantTurnCard.tsx — 集成 PlanCard
8. PlanDecisionPanel.tsx — 新组件
9. ChatInput.tsx — 集成 PlanDecisionPanel
10. ChatView.tsx — 数据连接
11. ChatMessages.tsx — padding 调整

## 验证方法

1. 启动桌面应用 `pnpm desktop dev`
2. 创建新会话，将任务目标切换为"计划"
3. 输入一个需要计划的请求（如"帮我设计一个用户认证系统"）
4. 验证：AI 回复后，计划内容以"任务计划"卡片展示（先正文后步骤）
5. 验证：输入区显示"是否按该计划实施？"和两个上下排布的选项按钮
6. 验证：侧边栏该会话显示紫色"Needs decision"徽章
7. 点击"是，按该计划实施"→ 进入实施模式，可开始执行
8. 重新测试，点击"否，我要调整计划"→ 输入框恢复正常，侧边栏状态消失
