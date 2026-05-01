# TASK: mode-creator Skill

> 唯一真相源 (Single Source of Truth)
> Created: 2026-05-01 01:31
> Completed: 2026-05-01 01:42
> Status: DONE

## Goal

将 Mode Studio Builder 从硬编码表单流程升级为 AI Native 的 `mode-creator` Skill。
通过 SKILL.md 指令编排 mode 创建流程（追问 → 设计 → 生成方案 → 调用接口写入），
让用户在对话中自然完成 mode 创建。与现有 Builder Panel 共存。

## Architecture

```
User Chat → Agent picks up SKILL.md → Calls modes.* runtime tools → Writes mode spec
```

新增 5 个运行时工具：`modes.list`, `modes.generateDraft`, `modes.refineDraft`, `modes.validate`, `modes.applyDraft`

---

## Checklist

### Phase 1: Runtime Tools (运行时工具层)

- [x] **1.1** `packages/shared/src/capabilities.ts` — 在 `MVP_TOOLS` 添加 5 个 `modes.*` ToolDescriptor
  - `modes.list` (safe)
  - `modes.generateDraft` (safe)
  - `modes.refineDraft` (safe)
  - `modes.validate` (safe)
  - `modes.applyDraft` (requires_approval)

- [x] **1.2** `apps/runtime/src/harness/runtime-tool-executor.ts` — 注册和实现
  - [x] `IMPLEMENTED_RUNTIME_TOOL_IDS` 添加 5 个 ID
  - [x] 定义 `ModeRegistryTools` 接口 (exported)
  - [x] `RuntimeToolExecutorOptions` 添加 `modeRegistry?`
  - [x] 构造函数存储 `modeRegistry`
  - [x] `execute()` switch 添加 5 个 case
  - [x] `riskLevel()` 添加 `modes.applyDraft` → "high"
  - [x] `toolNeedsUserApprovalCopy()` 添加 `modes.applyDraft`
  - [x] `exampleForTool()` 添加 5 个示例
  - [x] `approvalRequestForToolCall()` 添加 `modes.applyDraft` case (中英双语)
  - [x] 实现委托函数（`listRuntimeModes`, `generateRuntimeModeDraft` 等）

- [x] **1.3** `apps/runtime/src/harness/runtime-kernel.ts` — 传入 modeRegistry
  - [x] `RuntimeKernelOptions` 添加 `modeRegistry?` 字段
  - [x] `RuntimeToolExecutor` 构造传入 `options.modeRegistry`
  - [x] `run-kernel-lifecycle.ts` 添加 `modeRegistry` 参数透传
  - [x] `run-store.ts` 7 个调用点传入 `modeRegistry: this`

- [x] **1.4** `apps/runtime/src/run-store.ts` — 确保方法可委托
  - [x] 确认 5 个方法签名兼容 `ModeRegistryTools` 接口（结构类型系统保证）

### Phase 2: Skill Files (Skill 文件)

- [x] **2.1** `skills/mode-creator/SKILL.md` — 主文件 (~200 行)
  - [x] frontmatter (name, description, trigger)
  - [x] 流程总览 5 阶段
  - [x] Stage 1: Capture Intent + 拓扑速查表
  - [x] Stage 2: Design Interview (6 维度)
  - [x] Stage 3: Generate Draft (modes.generateDraft)
  - [x] Stage 4: Review & Refine (modes.validate + modes.refineDraft)
  - [x] Stage 5: Apply (modes.applyDraft)
  - [x] Domain Knowledge 内联 + 参考文档指引
  - [x] Communicating with the User

- [x] **2.2** `skills/mode-creator/references/topology-guide.md` — 5 种拓扑指南
- [x] **2.3** `skills/mode-creator/references/runtime-atoms-guide.md` — 14 种原子能力
- [x] **2.4** `skills/mode-creator/references/mode-spec-fields.md` — ModeSpec 字段速查

### Phase 3: Verification (验证)

- [x] `pnpm typecheck` 通过 (packages/shared + apps/runtime + apps/desktop)
- [x] `pnpm test` 通过 (21 files, 292 runtime tests + 91 desktop tests)
- [x] 现有 `mode-studio-builder.test.ts` 回归通过 (11 tests)

---

## Changes Summary

### Modified files
| File | Change |
|------|--------|
| `packages/shared/src/capabilities.ts` | +5 tool descriptors in MVP_TOOLS |
| `apps/runtime/src/harness/runtime-tool-executor.ts` | +ModeRegistryTools interface, +5 tool registrations, +5 execute cases, +approval, +examples |
| `apps/runtime/src/harness/runtime-kernel.ts` | +modeRegistry in RuntimeKernelOptions, passed to executor |
| `apps/runtime/src/run-kernel-lifecycle.ts` | +modeRegistry in KernelLifecycleBaseParams, kernelOptions() |
| `apps/runtime/src/run-store.ts` | +modeRegistry: this in 7 executeTracedKernelRun calls |

### Created files
| File | Purpose |
|------|---------|
| `skills/mode-creator/SKILL.md` | Skill main instructions (~200 lines) |
| `skills/mode-creator/references/topology-guide.md` | 5 coordination patterns guide |
| `skills/mode-creator/references/runtime-atoms-guide.md` | 14 runtime atoms reference |
| `skills/mode-creator/references/mode-spec-fields.md` | Mode spec field reference |

### Reuse (复用)
- `apps/runtime/src/run-store.ts` — `LocalRunStore` methods directly implement `ModeRegistryTools`
- `apps/runtime/src/mode-studio-draft.ts` — Core draft generation logic (unchanged)
- `apps/runtime/src/mode-studio-store.ts` — Draft CRUD (unchanged)
