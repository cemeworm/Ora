---
name: scheduled-task-manager
description: 当用户要求创建、查看、调整、暂停、恢复、删除、立即运行或规划 Ora 定时任务时使用。适用于“定时”“每天/每周/每月”“定期检查/汇报/执行”“管理定时任务”等请求。
---

# 定时任务管理

当用户想让 Ora 在未来或按固定节奏自动执行 agent 任务时，使用这个技能。

## 先确认任务意图

- 明确任务目标：定时任务要让 agent 做什么，最终输出给谁看。
- 明确调度：一次性时间，或每天/每周/每月/每 N 分钟/小时的重复规则。
- 明确执行上下文：项目、模式、模型、agent、需要挂载的技能和工具。
- 如果调度时间、任务目标或影响范围缺失，先提一个聚焦问题，不要猜。

## 创建或更新前

- 先用 `automations.previewSchedule` 预览未来触发时间。
- 把预览结果用用户语言简短说明给用户，确认它符合预期。
- 创建新任务用 `automations.create`；修改已有任务先用 `automations.list` 或 `automations.get` 找到目标，再用 `automations.update`。

## 管理已有任务

- 查看任务列表用 `automations.list`，查看详情用 `automations.get`。
- 暂停用 `automations.pause`，恢复用 `automations.resume`。
- 立即执行一次用 `automations.runNow`。
- 删除用 `automations.delete`。如果任务正在运行，等待运行结束后再删除。

## 审批要求

- 读取和预览可以直接执行。
- 创建、更新、暂停、恢复、删除、立即运行都会改变本地状态或触发 agent 运行，必须附带用户可读的 `approvalRequest`。
- 审批文案要说明：会改变什么、为什么需要、风险是什么。不要暴露内部 tool id。

## 调度格式

- 一次性任务使用 `{ "kind": "once", "at": <毫秒时间戳> }`。
- 重复任务使用 RRULE，例如每天 9 点：`FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0`。
- `timezone` 使用用户所在时区或用户明确指定的时区。
