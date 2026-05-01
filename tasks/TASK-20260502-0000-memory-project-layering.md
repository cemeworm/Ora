# Task: Ora Memory 项目分层优化

## 背景

Ora 的 memory 系统在 schema 层已预留 `project` 作为一种 `MemoryKind`，`ActiveMemoryScope` 也有 `projectId` 过滤字段，但实际存储和检索都只操作全局 `memory.json`，没有真正的项目级 memory 分层。

同时 CLAUDE.md 项目 memory 也是扁平的 —— `MEMORY.md` 本身是内容而非索引，只有一个 task 文件。

参考 Codex 的 memory 设计：
- **读写分离** — read crate 负责注入（memory_summary.md，≤5000 tokens），write crate 负责提取和合并
- **MEMORY.md 纯索引** — 不含实际内容，只有指针
- **两阶段管道** — Phase 1 从 rollout 提取 raw_memory，Phase 2 合并为全局 memory
- **项目边界意识** — write path 有 cwd/repo 边界
- **按用途分离文件** — raw / consolidated / skills / extensions

## 方案

### Part 1: CLAUDE.md Memory 重组

将 `MEMORY.md` 从内容文件改为纯索引，拆分为分类文件：

```
.claude/projects/-Users-quintenchen-developer-Ora/memory/
  MEMORY.md                  ← 纯索引，只有链接和描述
  project-overview.md        ← 项目概述、技术栈、关键路径
  architecture/
    ui-architecture.md       ← UI 重构后的组件树和布局
  design-system.md           ← 颜色、字体、阴影
  build-commands.md          ← 构建命令
  tasks/
    tool-limits-configurable.md
```

### Part 2: 运行时项目级 memory 存储

1. `apps/runtime/src/memory.ts` — `FileLongTermMemoryStore` 加可选 `projectId`，路径变为 `projects/<projectId>/memory.json`
2. `apps/runtime/src/memory.ts` — `LongTermMemoryManager` 加 `getProject()` / `updateFromRunProject()` 方法
3. `apps/runtime/src/active-memory.ts` — `ActiveMemoryRequest` 加可选 `projectMemory`；`collectActiveMemoryCandidates` 接受项目 memory 并设 `scope: { projectId }`，使 `candidateMatchesScope` 的 projectId 过滤从死代码变生效
4. `apps/runtime/src/mode-selection.ts` — `withMemoryPrompt` 当 `input.projectId` 存在时加载项目 memory
5. `apps/runtime/src/memory-updates.ts` — 路由项目级更新到项目 store

### 不做

- 不引入 Codex 式的 raw_memories.md 中间格式（Ora 已有提取→去重合并，当前规模不需要）
- 不修改 `packages/shared/src/memory.ts` schema（已有字段满足需求）

## 修改文件

| 文件 | 改动 |
|------|------|
| `apps/runtime/src/memory.ts` | FileLongTermMemoryStore 加 projectId；LongTermMemoryManager 加项目方法 |
| `apps/runtime/src/active-memory.ts` | ActiveMemoryRequest 加 projectMemory；候选项 scope 补 projectId |
| `apps/runtime/src/mode-selection.ts` | withMemoryPrompt 加载并传入项目 memory |
| `apps/runtime/src/memory-updates.ts` | 路由项目级更新 |

## 验证

- `FileLongTermMemoryStore` 带/不带 projectId 路径正确
- `collectActiveMemoryCandidates` 项目候选项带正确 scope
- 有 projectId 的 run 能检索到项目级 memory
- 无 projectId 的 run 行为不变（回归）
- 现有 `active-memory.test.ts` 和 `runtime-integration.test.ts` 全部通过
