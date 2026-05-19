# Ora Widget System：工作台组件

本文描述 Ora 的 Widget 系统 —— 从以 Session 为中心的产品形态升级为以 Workspace Dashboard 承载长期任务组件的个人 Agent 工作台。读完本文，应能理解 Widget 的数据模型、三种内置类型、三层信息架构、存储设计和版本管理。

> **最近更新 (2026-05-18)**：初始版本。覆盖 WidgetStore、三种 Widget 类型（artifact/todo/feed）、原子写入、events JSONL 分离、版本上限、三层信息架构。

## 阅读地图

| 关注点 | 对应章节 |
| --- | --- |
| Widget 是什么、为什么需要它 | [1. 定位：Widget 在 Ora 中的角色](#1-定位widget-在-ora-中的角色) |
| 数据模型（Widget / Manifest / Version） | [2. 核心数据结构](#2-核心数据结构) |
| 三种内置 Widget 类型 | [3. Widget 类型：Artifact / Todo / Feed](#3-widget-类型artifact--todo--feed) |
| 三层信息架构 | [4. 三层信息架构](#4-三层信息架构) |
| WidgetStore CRUD 与生命周期 | [5. WidgetStore：存储与操作](#5-widgetstore存储与操作) |
| 版本管理与回滚 | [6. 版本管理](#6-版本管理) |
| 持久化设计 | [7. 持久化设计](#7-持久化设计) |
| Component Builder Skill | [8. 组件构建 Skill](#8-组件构建-skill) |
| 与 Session / Automation 的关系 | [9. 与 Session 和 Automation 的协作](#9-与-session-和-automation-的协作) |
| 容易误解的点 | [10. 常见误解与边界](#10-常见误解与边界) |

核心源码文件：

| 文件 | 职责 |
| --- | --- |
| `packages/shared/src/widgets.ts` | Widget 类型定义、Zod schema、defaultWidgetState |
| `apps/runtime/src/widget-store.ts` | WidgetStore 核心实现：CRUD、版本、持久化 |
| `apps/desktop/src/components/SpaceDashboardView.tsx` | Dashboard 主视图 |
| `apps/desktop/src/components/WidgetCard.tsx` | Dashboard 小窗卡片 |
| `apps/desktop/src/components/ArtifactWidgetDetail.tsx` | Artifact Widget 详情视图 |
| `apps/desktop/src/components/TodoWidgetDetail.tsx` | Todo Widget 详情视图 |
| `apps/desktop/src/components/FeedWidgetDetail.tsx` | Feed Widget 详情视图 |

## 1. 定位：Widget 在 Ora 中的角色

Ora 从"以独立 Session 承载对话内容"的产品形态升级为"以 Workspace Dashboard 承载长期任务组件"的个人 Agent 工作台。核心产品定义：

> Ora Workspace：把对话变成可持续工作的组件。

Widget 是一等实体 —— 它们不是 Session 的附属品，而是独立持久化、可跨 Session 存在、可刷新、可提醒、可通过对话继续修改的任务组件。Session 降级为围绕 Widget 的交互与编辑通道。

```
用户自然语言描述需求
  → Component Builder Skill 指导 Agent
  → 生成 Widget Manifest + 关联 Skill
  → 持久化到 WidgetStore
  → 挂载到 Dashboard
  → 用户可在 Detail 面板交互
  → 可在 Builder Session 中继续对话修改
```

## 2. 核心数据结构

### 2.1 WidgetManifest（不可变元数据）

```typescript
WidgetManifest {
  id: string;
  workspaceId: string;
  title: string;
  kind: WidgetKind;           // "artifact" | "todo" | "feed"
  status: WidgetStatus;       // "active" | "archived" | "error"
  layout: { x, y, w, h, pinned };
  manifestVersion: number;
  dataSource?: unknown;       // 数据源配置（feed URL 等）
  actions?: unknown;          // 可执行操作
  schedule?: unknown;         // 调度配置（cron / interval）
  permissions?: unknown;
  artifactIds: string[];
  automationIds: string[];
  builderSessionId?: string;  // 创建此 widget 的 session
  builderSkillId?: string;    // 创建时使用的 skill
  componentSkillId?: string;  // 关联的私有 component skill
  currentVersionId: string;
  createdAt: number;
  updatedAt: number;
}
```

### 2.2 Widget（运行时完整对象）

```typescript
Widget extends WidgetManifest {
  state: Record<string, unknown>;  // 运行时可变状态
  lastRestoredVersionId?: string;   // 最近一次版本回滚目标
}
```

`manifest` 字段是结构性元数据（标题、布局、数据源），变更时触发版本快照。`state` 是运行时可变状态（todo 勾选、feed 最后刷新时间），state-only 更新不创建新版本。

### 2.3 WidgetVersion（版本快照）

```typescript
WidgetVersion {
  id: string;
  widgetId: string;
  version: number;                  // 单调递增
  createdAt: number;
  summary: string;                  // 变更摘要
  changeReason: string;             // 变更原因
  manifestSnapshot: WidgetManifest; // 完整 manifest 快照
  layoutSnapshot: WidgetLayout;
  stateSchemaSnapshot: Record<string, unknown>;
  automationBindingSnapshot: Record<string, unknown>;
  componentSkillId?: string;
  skillContentHash?: string;
  migrationNote: string;
}
```

## 3. Widget 类型：Artifact / Todo / Feed

MVP 支持三种内置 Widget 类型：

### 3.1 Artifact

沉淀生成内容：文章、摘要、Prompt、研究结果。

- **Dashboard 小窗**：标题 + 内容预览（前几行）；桌面端支持网格拖动与右下角拖拽改大小
- **Detail 面板**：完整内容渲染、编辑、导出
- **关联**：可关联到产生此 artifact 的 Session
- **状态**：仅 structural change 触发版本快照

### 3.2 Todo

待办事项、日期、提醒、完成状态。

- **Dashboard 小窗**：标题 + 待办数量 + 逾期标记；桌面端支持网格拖动与右下角拖拽改大小
- **Detail 面板**：待办列表、勾选、截止日期、排序
- **状态**：勾选/取消勾选是 state-only 更新（不创建版本）
- **提醒**：通过 schedule 关联 automation

### 3.3 Feed

定时刷新外部信息：微博热点、GitHub issue、关键词新闻。

- **Dashboard 小窗**：标题 + 最新条目数 + 上次刷新时间；桌面端支持网格拖动与右下角拖拽改大小
- **Detail 面板**：条目列表、手动刷新按钮、数据源配置
- **刷新**：通过 schedule 配置定时刷新（cron / interval）
- **状态**：刷新结果写入 state，不创建版本

## 4. 三层信息架构

```
Dashboard 小窗 (WidgetCard)
  ├── 摘要信息：标题、状态、关键数据
  ├── 快捷操作：Pin/Unpin、标记完成
  ├── 桌面端布局编辑：拖动位置、拖拽调整宽高
  └── 点击进入 ↓

Widget Detail (ArtifactWidgetDetail / TodoWidgetDetail / FeedWidgetDetail)
  ├── 完整交互界面
  ├── 数据操作：编辑、刷新、导出
  ├── 版本历史
  └── "在对话中继续" → ↓

Builder Session
  ├── 对话式修改组件
  ├── 自然语言描述需求
  └── Agent 通过 Component Builder Skill 执行修改
```

## 5. WidgetStore：存储与操作

### 5.1 CRUD 操作

| 操作 | 方法 | 版本行为 |
| --- | --- | --- |
| `list` | `list(params?)` | 只读，支持 workspaceId/kind/includeArchived 过滤 |
| `get` | `get(id)` | 只读 |
| `create` | `create(params)` | 创建 widget + 初始版本（version 1） |
| `update` | `update(params, createVersion?, changeReason?)` | structural change 时自动创建新版本 |
| `archive` | `archive(id)` | 状态变更，不创建版本 |
| `restore` | `restore(id)` | 从 archived 恢复为 active |
| `delete` | `delete(id)` | 删除 widget，保留版本历史 |

### 5.2 生命周期操作

| 操作 | 方法 | 说明 |
| --- | --- | --- |
| Pin/Unpin | `togglePin(id)` | 切换 `layout.pinned` |
| 查找重复 | `findDuplicate(title, kind?)` | 创建前检查重名（trim + 小写比较） |
| 陈旧检测 | `listStale()` | 超过 14 天未更新且无自动调度的 widget |
| 事件历史 | `listEvents(widgetId?, limit?)` | 生命周期事件日志 |

### 5.3 structural vs state-only 更新

`update()` 自动判断是否为 structural change：

- **Structural**（创建新版本）：title、layout、dataSource、schedule、permissions、actions、componentSkillId 变更
- **State-only**（不创建版本）：仅 state 字段变更

```typescript
const isStructural =
  createVersion ||
  parsed.title !== undefined ||
  parsed.layout !== undefined ||
  parsed.dataSource !== undefined ||
  parsed.schedule !== undefined ||
  parsed.permissions !== undefined ||
  parsed.actions !== undefined ||
  parsed.componentSkillId !== undefined;
```

## 6. 版本管理

### 6.1 版本创建时机

- Widget 创建：初始 version 1
- Structural 更新：version + 1，完整 manifest 快照
- 版本回滚：新版本记录回滚操作，manifest 恢复到目标版本快照

### 6.2 版本上限

每个 widget 最多保留 50 个版本。`save()` 时从后向前遍历，保留每个 widgetId 最近 50 个版本，超出部分丢弃。

### 6.3 版本回滚

`restoreVersion(params)` 从版本快照恢复 manifest/layout/schedule/componentSkillId，但保留当前 state 数据。回滚操作本身创建新版本记录。

### 6.4 版本比较

`compareVersions(versionIdA, versionIdB)` 返回两个版本的完整快照供 UI 差异对比。

## 7. 持久化设计

### 7.1 存储文件

| 文件 | 内容 | 格式 |
| --- | --- | --- |
| `.ora/widgets/widgets.json` | Widgets + Versions（结构化数据） | JSON，原子写入 |
| `.ora/widgets/widgets-events.jsonl` | 生命周期事件 | JSONL，append-only |

### 7.2 原子写入

`widgets.json` 使用 write-tmp → rename 模式：

```typescript
fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2), "utf-8");
fs.renameSync(tmpPath, this.storePath);
```

`rename` 在同一文件系统上是原子操作，崩溃时最多丢失当次写入，已有数据不受影响。

### 7.3 事件分离

生命周期事件（created/updated/archived/restored/deleted/pinned/unpinned/error）写入独立的 `widgets-events.jsonl` 文件（append-only），不再随 `widgets.json` 每次全量覆写。事件上限 1000 条，从旧 `widgets.json` 中的 events 自动迁移。

### 7.4 数据恢复

- 启动时 `load()` 尝试解析 `widgets.json`，失败则从空状态开始
- `loadEvents()` 从 JSONL 读取事件，失败时尝试从旧 `widgets.json` 迁移
- 版本号向前兼容（支持 version 1 和 version 2 格式）

## 8. 组件构建 Skill

用户通过自然语言创建和修改 Widget，由系统内置的 `component-builder` Skill 指导 Agent：

1. **澄清需求**：确认 Widget 类型、标题、数据源、刷新频率
2. **生成 Manifest**：构造完整的 `WidgetCreateParams`
3. **创建关联 Skill**：用户生成的组件沉淀为私有 component skill，作为后续迭代的认知包
4. **持久化**：调用 WidgetStore 写入
5. **挂载到 Dashboard**：通知桌面端刷新

## 9. 与 Session 和 Automation 的协作

### 9.1 Widget ↔ Session

- 创建 Widget 的对话在 Builder Session 中进行
- `builderSessionId` 记录创建来源
- 用户可随时在 Widget Detail 中点击"在对话中继续"，开启新的 Builder Session
- Widget 的修改通过对话提交，但最终 state 在 WidgetStore 中（不在 Session 历史中）

### 9.2 Widget ↔ Automation

- Feed Widget 通过 `schedule` 配置定时刷新
- Automation 系统负责按 schedule 触发刷新执行
- `automationIds` 记录关联的 automation 实例

### 9.3 Widget ↔ Artifact

- Artifact Widget 可引用 `artifactIds` 关联到 Session 中产生的 artifact
- 删除 Widget 不删除关联的 artifact

## 10. 常见误解与边界

1. **Widget state 不是 Session 历史的衍生**。Widget 的 `state` 是结构化 durable state，不从聊天历史或 timeline 反推。关闭 Session 后 Widget 继续存在。

2. **Widget 不是"任意小程序"**。MVP 仅支持三种内置类型。后续可支持 Custom Widget Code，但需经过权限、沙箱、版本、回滚和审查机制。

3. **state-only 更新不触发版本快照**。勾选 todo、刷新 feed 结果只更新 `state` 字段，不创建新版本。只有 title/layout/dataSource 等结构性变更才创建版本。

4. **删除 Widget 保留版本历史**。`delete()` 移除 widget 但保留 versions 数组中的历史记录，用于审计和恢复。

5. **Widget 不是 session-scoped**。Widget 属于 workspace（`workspaceId`），跨 session 存在。同一 workspace 的所有 session 共享 Widget。

6. **Dashboard 是新增入口，不替代 Session**。现有聊天工作流完整保留，Dashboard 是新增的产品形态。

7. **Component Builder Skill 是规范化的构建指导**。Agent 不是自由发挥生成 Widget，而是由 `component-builder` Skill 指导：澄清需求 → 生成 manifest → 创建关联 Skill → 持久化 → 挂载。

---

> **核心判断**：Widget 系统是 Ora 从"对话工具"到"工作台"的架构升级。它将对话成果沉淀为结构化、可刷新、可版本管理、可通过对话继续迭代的长期组件。Session 仍然是交互和编辑通道，但不再是一等产品主对象。
