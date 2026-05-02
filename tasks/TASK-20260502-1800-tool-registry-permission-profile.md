# TASK-20260502-1800: 工具系统架构升级 — 注册表模式 + 权限 Profile

## 背景

借鉴 Codex 的工具系统设计，对 Ora 运行时工具系统做架构级升级。

### 当前状态
- 工具描述符 `MVP_TOOLS` 是 37 条硬编码数组（`packages/shared/src/capabilities.ts:429`）
- 已实现工具 ID 是 38 条 `as const` 元组（`apps/runtime/src/harness/runtime-tool-executor.ts:13`）
- `RuntimeToolRegistry` 直接用 `MVP_TOOLS` 初始化，无动态注册能力
- `allowedForProfiles` 字段已预留但全为空数组，未实际使用
- 权限控制只有单一 `requiresApproval` 布尔值

### 已有优势
- Mode → Agent → RunConfig 三层动态工具可见性过滤已完备

---

## 迭代 A：工具注册表模式

**目标**：将静态 `MVP_TOOLS` 数组改为可动态注册的注册表，支持运行时添加工具（MCP、插件等）。

### A1. `packages/shared/src/capabilities.ts` — 新增 `ToolRegistryBuilder`

- 新增 `ToolRegistryBuilder` 类，内部用 `Map<string, ToolDescriptor>` 管理
- `static fromDefaults()` 用 `MVP_TOOLS` 初始化
- `register(descriptor)` / `unregister(toolId)` / `get(toolId)` / `list()` / `snapshot()` 方法
- 保留 `MVP_TOOLS` 作为默认数据源（向后兼容）
- `DEFAULT_AGENT_MODE_TOOL_IDS` 保持不变（从 MVP_TOOLS map）

### A2. `apps/runtime/src/harness/capability-registries.ts` — RuntimeToolRegistry 改用 builder

- 构造函数接受可选 `ToolRegistryBuilder`（默认 `fromDefaults()`）
- `list()` 和 `snapshot()` 委托给 builder
- 新增 `register()` / `unregister()` 方法

### A3. `apps/runtime/src/harness/runtime-tool-executor.ts` — 工具 ID 改为动态

- `IMPLEMENTED_TOOL_SET` 改为模块级可变 Set，初始从 `IMPLEMENTED_RUNTIME_TOOL_IDS` 填充
- 新增 `registerImplementedToolId()` / `unregisterImplementedToolId()` 函数
- `isRuntimeToolImplemented()` 检查动态 Set
- `IMPLEMENTED_RUNTIME_TOOL_IDS` 和 `RuntimeToolId` 类型保持不变（switch-case 需要）

### A4. MCP 工具注册集成

- `apps/runtime/src/harness/search-providers/mcp.ts` 相关逻辑
- MCP 启动时 `register()`，停止时 `unregister()`
- 暂不在本次实施（需要 MCP 生命周期管理改动），只留接口

---

## 迭代 B：权限 Profile

**目标**：将单一 `requiresApproval: boolean` 升级为基于 `riskLevel` + `allowedForProfiles` 的权限 Profile 系统。

### B1. `packages/shared/src/capabilities.ts` — PermissionProfile schema

- 新增 `PermissionProfileSchema` + `PermissionProfile` 类型
- 新增 `PermissionProfileRuleSchema`：category + riskLevel → permission (allow/deny/ask)
- 三个内置 profile：
  - `"runtime.full_trust"` — 全部 allow
  - `"runtime.default_policy"` — safe/low_risk 自动放行，requires_approval 需审批
  - `"runtime.readonly"` — 只允许 read 类工具
- 新增 `BUILTIN_PERMISSION_PROFILES` 常量数组
- 新增 `resolvePermissionProfile()` 工具函数

### B2. 激活 `allowedForProfiles` 字段

- 填充 `MVP_TOOLS` 中每个工具的 `allowedForProfiles`：
  - `[]` = 所有 profile 可用
  - `["runtime.readonly"]` = 只在 readonly profile 中可用（仅 read 类工具）
  - 不填充的保持 `[]`

### B3. `apps/runtime/src/harness/runtime-tool-executor.ts` — 执行前权限检查

- 新增 `checkToolPermission()` 函数，在 `executeWithMetadata()` 中调用
- 检查逻辑：从工具描述符取 category + riskLevel，从当前 profile 取匹配规则
- `allow` → 继续执行，`deny` → 抛错，`ask` → 走现有 approval 流程
- `requiresApproval: true` 等效于 profile rule `permission: "ask"`（向后兼容）

### B4. Profile 传递链路

- `RunConfig` 新增 `permissionProfileId?: string` 字段
- `ModeSpec` 新增 `permissionProfileId?: string` 字段
- 运行时解析：Mode 默认 → RunConfig 覆盖 → 不指定则 `"runtime.default_policy"`

---

## 涉及文件汇总

| 文件 | 改动类型 |
|------|----------|
| `packages/shared/src/capabilities.ts` | A1 + B1 + B2 |
| `packages/shared/src/runtime.ts` | B4 (RunConfig) |
| `packages/shared/src/modes.ts` | B4 (ModeSpec) |
| `apps/runtime/src/harness/capability-registries.ts` | A2 |
| `apps/runtime/src/harness/runtime-tool-executor.ts` | A3 + B3 |
| `apps/runtime/src/harness/runtime-kernel.ts` | B4 (profile 解析传递) |

## 不做的事

- 不合并 `file.write` 和 `file.patch`
- 不引入操作系统级沙箱
- 不删除 `requiresApproval` 字段（保持向后兼容）
- 不实施 A4 MCP 动态注册（只留接口）

## 验证标准

1. `pnpm --filter shared test` — shared 包测试全通过
2. `pnpm --filter runtime test` — 运行时测试全通过
3. 迭代 A 验证：通过 `RuntimeToolRegistry.register()` 动态添加测试工具，`snapshot()` 包含它
4. 迭代 B 验证：readonly profile 拒绝 write 类工具；full_trust profile 不需要审批
