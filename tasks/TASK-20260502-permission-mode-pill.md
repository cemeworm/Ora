# 权限模式 Pill

## 目标

在输入框中新增权限模式选择器（pill），提供三种权限模式：完全访问 / 默认 / 自动审查，控制审批行为。

## 三种权限模式

| 模式 | 标识 | 行为 |
|------|------|------|
| 完全访问 | `full_access` | 永不询问审批，所有操作自动通过 |
| 默认 | `default` | 当前行为，高风险操作需用户审批 |
| 自动审查 | `auto_review` | 自动审批但记录日志，不打断用户 |

## 技术方案

### 数据流

```
ChatInput Picker → WorkbenchState.permissionMode → RunConfig.permissionMode
  → runtime-kernel deps → resolveRuntimeActionApproval() → 审批决策
```

### 修改文件清单

1. `packages/shared/src/config.ts` — 新增 PermissionModeSchema，SessionConfigSchema 加字段
2. `packages/shared/src/runtime.ts` — RunConfigSchema 加 permissionMode 字段
3. `apps/runtime/src/harness/runtime-action-runner.ts` — 审批逻辑适配
4. `apps/runtime/src/harness/runtime-kernel.ts` — 传递 permissionMode
5. `apps/desktop/src/lib/state.tsx` — 状态管理
6. `apps/desktop/src/lib/useRunActions.ts` — RunConfig 构建
7. `apps/desktop/src/components/ChatInput.tsx` — 新增权限模式 Picker
8. `apps/desktop/src/components/ChatView.tsx` — 传递 props

### 验证

- typecheck 通过
- 三种模式切换正常
- full_access 下高风险操作不触发审批
- default 下审批行为不变
- 切换 session 后权限模式保持
