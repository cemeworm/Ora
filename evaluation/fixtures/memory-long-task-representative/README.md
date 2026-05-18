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

运行时，evaluation runner 会读取 `fixture.manifest.json`，并把当前仓库复制到：

- `evaluation/fixtures/memory-long-task-representative/workspaces/<evaluationRunId>/<caseId>/<configId>/rep-<n>/`

## 设计约束

- `sourceRoot` 指向当前 Ora 仓库根目录，因此会带上当前工作树的未提交修改
- `materializationRoot` 默认位于本目录下的 `workspaces/`
- 复制时默认排除 `.git`、`node_modules`、`dist`、`build`、`coverage`、`.turbo`
- 如果后续发现还需要排除更大的生成目录，优先在 manifest 的 `isolation.exclude` 中追加

## 何时不用它

- 如果你要评估的是只读问答数据集，不涉及文件写入或 shell 写入
- 如果你已经有外部 worktree orchestration，并且明确不想在 runner 内再做一次复制
