# Memory Long Task Fixture

这个 fixture bundle 服务于：

- `evaluation/specs/memory-long-task-smoke-ab.json`
- `evaluation/specs/memory-long-task-full-ab.json`

目标是让每个 `caseId / configId / repetition` 都在独立 workspace 中执行，避免：

- 一个 case 改过的文件污染下一个 case
- `memory-disabled` 与 `memory-enabled` 共享同一工作区
- smoke / full 批次互相覆盖中间产物

## 运行方式

1. 从仓库根目录导入对应数据集，记录返回的 `datasetId`
2. 把 spec 里的占位符替换成实际 `datasetId`
3. 运行 `ora-runtime eval run --spec <spec>`

运行时，evaluation runner 会读取 `fixture.manifest.json`，先复制源码树，再在副本内准备依赖，最终把可运行 workspace 物化到：

- `evaluation/fixtures/memory-long-task-representative/workspaces/<evaluationRunId>/<caseId>/<configId>/rep-<n>/`

## 设计约束

- `sourceRoot` 指向当前 Ora 仓库根目录，因此会带上当前工作树的未提交修改
- `materializationRoot` 默认位于本目录下的 `workspaces/`
- 复制时默认排除 `.DS_Store`、`.git`、`.ora`、`node_modules`、`dist`、`build`、`coverage`、`.turbo`、`apps/desktop/src-tauri/target`
- 这样可以避免把本地运行态数据和超大原生构建产物一起复制进评估 workspace，降低 `ENOSPC` 风险并缩短 materialize 时间
- `node_modules` 不会从宿主仓库直接复制。Ora 使用 pnpm workspace，应用包和共享包的依赖目录里有大量符号链接；直接继承宿主机链接布局会把外部 `.pnpm` 假设一起带进副本，最终在 `file.glob`、shell、test 命令里暴露成 dangling symlink
- 当前 fixture 在副本根目录执行 `pnpm install --frozen-lockfile`，并在注入给 agent 之前校验关键依赖路径存在且没有逃逸到 workspace 外
- 如果后续发现还需要排除更大的生成目录，优先在 manifest 的 `isolation.exclude` 中追加

## 何时不用它

- 如果你要评估的是只读问答数据集，不涉及文件写入或 shell 写入
- 如果你已经有外部 worktree orchestration，并且明确不想在 runner 内再做一次复制
