import { useEffect } from "react";

export type AppLanguage = "zh" | "en";

export const LANGUAGE_STORAGE_KEY = "ora.desktop.language";

export const LANGUAGE_OPTIONS: Array<{
  id: AppLanguage;
  label: string;
  nativeLabel: string;
}> = [
  { id: "zh", label: "Chinese", nativeLabel: "中文" },
  { id: "en", label: "English", nativeLabel: "English" },
];

const ZH_COPY: Record<string, string> = {
  Settings: "设置",
  "Ora Operator Workbench": "Ora 操作员工作台",
  General: "通用",
  Language: "语言",
  Chinese: "中文",
  English: "英文",
  "Display Language": "显示语言",
  "Choose the language used by the desktop workbench. Chinese is the default for new installs.":
    "选择桌面工作台使用的语言。新安装默认使用中文。",
  "New Chat": "新建对话",
  "New chat": "新建对话",
  Search: "搜索",
  Agents: "智能体",
  Skills: "技能",
  Modes: "模式",
  Evaluation: "评测",
  Projects: "项目",
  "Recent Chats": "最近对话",
  Chats: "对话",
  "Select folder": "选择文件夹",
  "New project session": "新建项目会话",
  "No chats yet": "暂无对话",
  "Show less": "收起",
  "Awaiting reply": "等待回复",
  "Needs approval": "需要审批",
  Failed: "失败",
  Running: "运行中",
  Done: "已完成",
  Approval: "审批",
  Checkpoint: "检查点",
  Loading: "加载中",
  "Connecting...": "连接中...",
  "Loading view...": "正在加载视图...",
  "Loading evaluation tools...": "正在加载评测工具...",
  "Loading agents...": "正在加载智能体...",
  "Loading skills...": "正在加载技能...",
  "Loading mode studio...": "正在加载模式工作室...",
  "Ora hit a render error.": "Ora 渲染时遇到错误。",
  "The workbench could not render this session.": "工作台无法渲染这个会话。",
  "Reload workbench": "重新加载工作台",
  "Runtime error": "运行时错误",
  "Runtime bridge failed to initialize.": "运行时桥接初始化失败。",
  "Resize trails panel": "调整轨迹面板宽度",
  "Resize artifact panel": "调整产物面板宽度",
  "What would you like to do?": "想要做点什么？",
  Pause: "暂停",
  Export: "导出",
  "Export report": "导出报告",
  Trails: "轨迹",
  "Toggle trails": "切换轨迹",
  Documents: "文件树",
  "Toggle documents": "切换文件树",
  "Refresh documents": "刷新文件树",
  "Close documents": "关闭文件树",
  "Loading documents": "正在加载文件树",
  "Scanning the selected project folder.": "正在扫描选中的项目文件夹。",
  "Documents unavailable": "文件树不可用",
  "Project files failed to load.": "项目文件加载失败。",
  "No files found": "未找到文件",
  "This project folder does not contain readable files.":
    "这个项目文件夹中没有可读取的文件。",
  Truncated: "已截断",
  "Message Ora": "给 Ora 发消息",
  Attachments: "附件",
  Agent: "智能体",
  "No model": "未选择模型",
  "No configured model providers. Add a provider key in Settings.":
    "尚未配置模型提供方。请在设置中添加提供方密钥。",
  Default: "默认",
  Flash: "快速",
  Thinking: "思考",
  Pro: "专业",
  Ultra: "极致",
  "Stop run": "停止运行",
  "Send message": "发送消息",
  "Ora may be wrong, check the results before adoption.":
    "Ora 可能会出错，采纳结果前建议先进行检查。",
  "Stopped processing as instructed.": "已按照你的指示停止处理",
  "Paused as instructed.": "已按照你的指示暂停处理",
  "Confirmed. Continuing.": "已确认，继续处理",
  "Confirmed. Continuing the run.": "已确认，继续处理本轮任务。",
  "Please confirm this operation before I continue.": "继续前请确认这个操作。",
  "Please confirm before this step continues.": "继续这个步骤前请确认。",
  "This operation was completed and recorded.": "这个操作已完成并记录。",
  "This operation is ready to review.": "这个操作已准备好确认。",
  "Approval required": "需要审批",
  "Your confirmation is needed": "需要你确认后继续",
  "Review before continuing": "继续前请确认",
  "Review all items": "确认所有内容",
  "I need your confirmation for the actions below before I continue.":
    "继续前，我需要你确认下面这些操作。",
  "Confirm before continuing": "需要你确认后继续",
  "This action may change the local environment.":
    "这项操作可能会改变本地环境。",
  "It is needed to continue the current task.": "这是继续当前任务所需的步骤。",
  "Confirm this matches your expectations before continuing.":
    "请确认这符合你的预期后再继续。",
  "Pending approval": "待审批",
  "Review the blocked stage": "检查被阻塞的阶段",
  "Review the blocked stages": "检查被阻塞的阶段",
  "The runtime paused in the conversation flow and is waiting for your decision before continuing.":
    "运行时已暂停对话流程，等待你的决定后再继续。",
  "Approve and continue": "批准并继续",
  "Cancel run": "取消运行",
  risk: "风险",
  "agent:": "智能体：",
  Steps: "步骤",
  "To-dos": "待办",
  Preview: "预览",
  active: "进行中",
  blocked: "已阻塞",
  recorded: "已记录",
  Artifact: "产物",
  "No artifact selected": "未选择产物",
  "Close artifact": "关闭产物",
  "Select an artifact from the chat stream to preview it here.":
    "从聊天流中选择一个产物，在这里预览。",
  "No inline preview is available for this artifact yet.":
    "此产物暂不支持内联预览。",
  URI: "URI",
  "Trails will appear here.": "轨迹会显示在这里。",
  "Close trails": "关闭轨迹",
  Live: "实时",
  Timeline: "时间线",
  Topology: "拓扑",
  Trace: "追踪",
  Status: "状态",
  Mode: "模式",
  "Blocking gate": "阻塞关卡",
  "Selected node": "选中节点",
  "Active agents": "活跃智能体",
  "Events / sec": "事件/秒",
  "Est. cost": "预估成本",
  "Live Signals": "实时信号",
  Events: "事件",
  Checkpoints: "检查点",
  "Topology changes": "拓扑变更",
  Messages: "消息",
  Warnings: "警告",
  Errors: "错误",
  "Operator Actions": "操作员动作",
  Fork: "分叉",
  Resume: "继续",
  Cancel: "取消",
  "Runtime Focus": "运行时焦点",
  "Selected beat": "选中节拍",
  "Selected checkpoint": "选中检查点",
  "Focused agent": "聚焦智能体",
  "Generation refs": "生成引用",
  "Blocking Gates": "阻塞关卡",
  "This run is not currently paused behind a manual gate.":
    "当前运行没有暂停在人工关卡后。",
  "Latest runtime event": "最新运行时事件",
  "No checkpoint selected": "未选择检查点",
  "Run-level overview": "运行级概览",
  "Run overview": "运行概览",
  Idle: "空闲",
  None: "无",
  Clarification: "澄清",
  Action: "操作",
  Plan: "计划",
  Actions: "操作",
  "Plan Items": "计划项",
  "Preview mode": "预览模式",
  "Provider Settings": "提供方设置",
  Providers: "提供方",
  "Use one provider flow: choose an API provider, load a template when needed, then save and verify from the same form.":
    "使用一套提供方流程：选择 API 提供方，需要时加载模板，然后在同一表单中保存并验证。",
  Verified: "已验证",
  "Verification failed": "验证失败",
  "Key stored": "密钥已保存",
  "Needs key": "需要密钥",
  "Not configured": "未配置",
  "API Provider": "API 提供方",
  Template: "模板",
  Official: "官方",
  Templates: "模板",
  "Load Template": "加载模板",
  "Responses API": "Responses API",
  "Chat Completions": "Chat Completions",
  "Provider Name": "提供方名称",
  "Provider name": "提供方名称",
  "API Key Env": "API 密钥环境变量",
  "Base URL": "Base URL",
  "Base URL (optional)": "Base URL（可选）",
  Model: "模型",
  "Model ID": "模型 ID",
  "Provider Secret": "提供方密钥",
  "Secrets stay in the runtime layer and Keychain. This form never stores the raw key in React state.":
    "密钥保存在运行时层和钥匙串中。这个表单不会把原始密钥存入 React 状态。",
  "Key ready": "密钥就绪",
  "Key needed": "需要密钥",
  Local: "本地",
  "No key required for local smoke": "本地 smoke 不需要密钥",
  "Save Key": "保存密钥",
  "Remove Key": "移除密钥",
  "Model Configuration": "模型配置",
  "Protocol, limits, capability flags, drop params, and optional headers.":
    "协议、限制、能力标记、丢弃参数和可选请求头。",
  Protocol: "协议",
  Responses: "Responses",
  "Anthropic Version": "Anthropic 版本",
  "Max Output Tokens": "最大输出 Token",
  Temperature: "温度",
  "Drop Params": "丢弃参数",
  Headers: "请求头",
  "Provider id:": "提供方 ID：",
  Verify: "验证",
  Save: "保存",
  "Delete Custom Provider": "删除自定义提供方",
  "Runtime Status": "运行时状态",
  Memory: "记忆",
  "Long-term memory is persisted across runs, summarized into profile sections, and injected into future prompts when relevant.":
    "长期记忆会跨运行持久化，沉淀为画像区块，并在相关的后续提示词中注入。",
  facts: "条事实",
  "Clear Memory": "清空记忆",
  "Long-term memory cleared.": "长期记忆已清空。",
  "Failed to load memory.": "记忆加载失败。",
  "Failed to clear memory.": "记忆清空失败。",
  "Last updated": "最后更新",
  "Loading memory...": "正在加载记忆...",
  "No long-term memory loaded": "尚未加载长期记忆",
  "Selected run": "选中的运行",
  "No active run selected": "未选择运行",
  "Memory Profile": "记忆画像",
  "Work Context": "工作上下文",
  "Personal Context": "个人上下文",
  "Top of Mind": "当前关注",
  "Recent Months": "近期上下文",
  "Earlier Context": "更早上下文",
  "Long-term Background": "长期背景",
  "No long-term memory profile yet.": "还没有长期记忆画像。",
  "Ora records durable memory from explicit preferences, corrections, goals, and reinforced working patterns.":
    "Ora 会从明确偏好、纠正、目标和被强化的工作方式中记录可持久化记忆。",
  "Memory Facts": "记忆事实",
  "No long-term facts captured yet.": "还没有捕获长期事实。",
  "Facts appear here after runs include durable preference, correction, goal, or behavior signals.":
    "运行中出现可持久化的偏好、纠正、目标或行为信号后，事实会显示在这里。",
  "Avoid:": "避免：",
  "Run Memory Records": "运行内记忆记录",
  "Run-scoped records are kept here for debugging; long-term memory lives in the profile and facts above.":
    "运行内记录保留在这里用于调试；长期记忆保存在上方的画像和事实中。",
  "Recorded Memory": "已记录记忆",
  "No memory recorded for the selected run yet.":
    "当前选中的运行还没有记录记忆。",
  "Memory appears here after the runtime emits memory.updated events for the active turn.":
    "运行时为当前轮次发出 memory.updated 事件后，记忆会显示在这里。",
  "Memory Namespaces": "记忆命名空间",
  "No memory namespace available.": "暂无记忆命名空间。",
  unknown: "未知",
  "Tool Registry": "工具注册表",
  "Skill Registry": "技能注册表",
  Chat: "聊天",
  "Tool Use": "工具调用",
  Images: "图片",
  Reasoning: "推理",
  Tools: "工具",
  "Close settings": "关闭设置",
  "Connecting to the Ora runtime bridge.": "正在连接 Ora 运行时桥接。",
  "Select a session to inspect its latest turn, checkpoints, and approvals.":
    "选择一个会话以检查最新轮次、检查点和审批。",
  "Reconnecting to the Ora runtime bridge.": "正在重新连接 Ora 运行时桥接。",
  "Processing state updated.": "处理状态已更新。",
  "The run did not finish. Open Trails for the latest details.":
    "本轮没有完成。可打开轨迹查看最新详情。",
  "Continued with limited context.": "已使用有限上下文继续。",
  "Paused after processing was interrupted.": "处理被中断后已暂停。",
  "Processing step failed.": "处理步骤失败。",
  "Processing state changed.": "处理状态已变化。",
  Recovered: "已恢复",
  "Tool call": "工具调用",
  "Run completed.": "运行完成。",
  "Run failed.": "运行失败。",
  "Run completed": "运行完成",
  "Run failed": "运行失败",
  "Add project": "添加项目",
  "Load turn": "加载轮次",
  Interrupt: "中断",
  Approve: "批准",
  Replay: "回放",
  Report: "报告",
  "Save provider key": "保存提供方密钥",
  "Remove provider key": "移除提供方密钥",
  "Verify provider": "验证提供方",
  "Save provider": "保存提供方",
  "Remove provider": "移除提供方",
  "Session load failed.": "会话加载失败。",
  "Turn load failed.": "轮次加载失败。",
  "Session creation failed.": "会话创建失败。",
  "Project session creation failed.": "项目会话创建失败。",
  "Project import failed.": "项目导入失败。",
  "Unable to start run.": "无法启动运行。",
  "Interrupt failed.": "中断失败。",
  "Approve failed.": "批准失败。",
  "Cancel failed.": "取消失败。",
  "Select a checkpoint before forking.": "分叉前请选择检查点。",
  "Fork failed.": "分叉失败。",
  "Replay failed.": "回放失败。",
  "Report export failed.": "报告导出失败。",
  "Provider key save failed.": "提供方密钥保存失败。",
  "Provider key removal failed.": "提供方密钥移除失败。",
  "Provider verification failed.": "提供方验证失败。",
  "Provider save failed.": "提供方保存失败。",
  "Provider removal failed.": "提供方移除失败。",
  "API key stored. Run verify to confirm connectivity.":
    "API 密钥已保存。运行验证以确认连通性。",
  "API key required before verification.": "验证前需要 API 密钥。",
  "Local smoke provider is ready.": "本地 smoke 提供方已就绪。",
  "Official OpenAI Responses API provider.":
    "官方 OpenAI Responses API 提供方。",
  "Official Claude Messages API provider.": "官方 Claude Messages API 提供方。",
  "Deterministic local smoke provider for offline testing.":
    "用于离线测试的确定性本地 smoke 提供方。",
  "Any provider that speaks the OpenAI chat or responses protocol.":
    "任何兼容 OpenAI Chat 或 Responses 协议的提供方。",
  "Any provider that speaks the Anthropic Messages API.":
    "任何兼容 Anthropic Messages API 的提供方。",
  "OpenAI-compatible Qwen via Bailian/DashScope.":
    "通过百炼/DashScope 使用兼容 OpenAI 的 Qwen。",
  "DeepSeek OpenAI-compatible API.": "DeepSeek 兼容 OpenAI 的 API。",
  "Zhipu OpenAI-compatible API.": "智谱兼容 OpenAI 的 API。",
  "Moonshot OpenAI-compatible API.": "Moonshot 兼容 OpenAI 的 API。",
  "Generic OpenAI-compatible": "通用 OpenAI 兼容",
  "Generic Anthropic-compatible": "通用 Anthropic 兼容",
  "Local Smoke": "本地 Smoke",
  "Agent Gallery": "智能体库",
  Refresh: "刷新",
  "New agent": "新建智能体",
  "Selected Persona": "选中人格",
  "The selected agent becomes the default persona overlay for the next run you start from chat.":
    "选中的智能体会成为你下次从聊天启动运行时的默认人格叠层。",
  "Create, revise, delete, or start a new chat with a reusable persona.":
    "创建、修改、删除可复用人格，或用它开始新聊天。",
  "Create first agent": "创建第一个智能体",
  "Use in chat": "用于聊天",
  Edit: "编辑",
  Delete: "删除",
  "No description yet.": "暂无描述。",
  "inherit current chat model": "继承当前聊天模型",
  "inherit runtime defaults": "继承运行时默认值",
  "Create custom agent": "创建自定义智能体",
  "Create agent": "创建智能体",
  "Save changes": "保存更改",
  Name: "名称",
  "Model Hint": "模型提示",
  Description: "描述",
  "Tool Groups": "工具组",
  "Long-form persona instructions written into SOUL.md.":
    "写入 SOUL.md 的长篇人格指令。",
  "Start with a small persona card: name, description, model hint, tool groups, and SOUL instructions.":
    "从一张小人格卡开始：名称、描述、模型提示、工具组和 SOUL 指令。",
  "This v1 editor writes `config.yaml` and `SOUL.md` directly into `.ora/agents/&lt;name&gt;`.":
    "这个 v1 编辑器会直接写入 `.ora/agents/&lt;name&gt;` 下的 `config.yaml` 和 `SOUL.md`。",
  "Updated:": "更新时间：",
  "Failed to load custom agents.": "自定义智能体加载失败。",
  "Failed to load custom agent.": "自定义智能体加载失败。",
  "Failed to save custom agent.": "自定义智能体保存失败。",
  "Failed to delete custom agent.": "自定义智能体删除失败。",
  "Failed to open chat with the selected agent.":
    "无法用选中的智能体打开聊天。",
  "Custom agent name is required.": "自定义智能体名称为必填项。",
  "New skill": "新建技能",
  "Back to skills": "返回技能",
  "Search skills": "搜索技能",
  "All sources": "全部来源",
  "All states": "全部状态",
  Custom: "自定义",
  Private: "私有",
  State: "状态",
  Enabled: "已启用",
  Disabled: "已禁用",
  Enable: "启用",
  Disable: "停用",
  "Create private skill": "创建私有技能",
  "Create skill": "创建技能",
  "Select a skill to inspect its full `SKILL.md`.":
    "选择一个技能以查看完整的 `SKILL.md`。",
  "Public skills are initialized from the package; private skills are added later by you.":
    "Public 技能来自初始化内置包；Private 技能是你后续新增的。",
  "Private skills are stored as `.ora/skills/private/&lt;name&gt;/SKILL.md`.":
    "私有技能保存在 `.ora/skills/private/&lt;name&gt;/SKILL.md`。",
  "What this skill helps the agent do.": "这个技能帮助智能体完成什么。",
  "Skill name is required.": "技能名称为必填项。",
  "Failed to load skills.": "技能加载失败。",
  "Failed to load skill.": "技能加载失败。",
  "Failed to save skill.": "技能保存失败。",
  "Failed to update skill state.": "技能状态更新失败。",
  "Failed to delete skill.": "技能删除失败。",
  "Import dataset": "导入数据集",
  "Run evaluation": "运行评测",
  Regression: "回归",
  Lab: "实验室",
  Dataset: "数据集",
  Baseline: "基线",
  Repetitions: "重复次数",
  Outcome: "结果",
  Orchestration: "编排",
  "Task Completion": "任务完成",
  "Final-result focused scoring.": "聚焦最终结果的评分。",
  "Tool/handoff/process focused scoring.": "聚焦工具、交接和流程的评分。",
  "Environment task completion focused scoring.": "聚焦环境任务完成度的评分。",
  "Uses the provider selected in Settings for v1.":
    "v1 使用设置中选中的提供方。",
  "Select dataset": "选择数据集",
  "Select evaluation run": "选择评测运行",
  "Case Browser": "用例浏览器",
  "Case Detail": "用例详情",
  "Config Comparison": "配置对比",
  "Slice Analysis": "切片分析",
  Regressions: "回归",
  "Avg runtime": "平均运行时长",
  "Avg cost": "平均成本",
  Safety: "安全性",
  Efficiency: "效率",
  Case: "用例",
  Cases: "用例",
  Config: "配置",
  Cost: "成本",
  Value: "值",
  Dimension: "维度",
  Anomalies: "异常",
  "attempts flagged": "次尝试被标记",
  "Select a case row to inspect input, expectation, per-config outputs, and the trace links generated by the underlying Ora runs.":
    "选择用例行以检查输入、期望、各配置输出，以及底层 Ora 运行生成的追踪链接。",
  "Evaluation index returned an invalid response.": "评测索引返回了无效响应。",
  "Failed to load evaluation index.": "评测索引加载失败。",
  "Failed to load evaluation dataset.": "评测数据集加载失败。",
  "Failed to load evaluation run.": "评测运行加载失败。",
  "Failed to import dataset.": "数据集导入失败。",
  "Failed to start evaluation run.": "评测运行启动失败。",
  "Failed to promote baseline.": "基线提升失败。",
  "Failed to export evaluation run.": "评测运行导出失败。",
  "Mode settings": "模式设置",
  "Mode Studio": "模式工作室",
  Overview: "概览",
  Capabilities: "能力",
  Advanced: "高级",
  Canvas: "画布",
  "Canvas preview": "画布预览",
  Customize: "自定义",
  Validate: "验证",
  "Validation passed.": "验证通过。",
  "Validation failed.": "验证失败。",
  "Save mode": "保存模式",
  "Delete mode": "删除模式",
  "Clone preset": "克隆预设",
  "New mode": "新建模式",
  "Auto layout": "自动布局",
  "Add stage": "添加阶段",
  "Delete node": "删除节点",
  "Delete rule": "删除规则",
  Summary: "摘要",
  Details: "详情",
  Rules: "规则",
  Atoms: "原子",
  "Mode atoms": "模式原子",
  "Stage atoms": "阶段原子",
  "Mode capabilities": "模式能力",
  "Attached to Runtime": "挂载到运行时",
  "Runtime Harness": "运行时框架",
  "Run story": "运行故事",
  "How this mode runs": "这个模式如何运行",
  "Read this as the mode's operating path: request, stages, runtime capabilities, and stop condition.":
    "把这里当作模式的运行路径来读：请求、阶段、运行时能力和停止条件。",
  stages: "个阶段",
  agents: "个智能体",
  capabilities: "个能力",
  "runtime capabilities": "个运行时能力",
  Input: "输入",
  "User request enters the mode": "用户请求进入模式",
  "The runtime receives the request and applies this mode's default contract before work begins.":
    "运行时接收请求，并在工作开始前应用这个模式的默认契约。",
  Middle: "中段",
  Stage: "阶段",
  "Middle stages coordinate the work": "中间阶段协调工作",
  Finish: "收束",
  "Runtime stops and publishes the answer": "运行时停止并发布答案",
  "Run contract": "运行契约",
  "What the runtime promises": "运行时会保证什么",
  Owners: "负责人",
  "Tool envelope": "工具边界",
  "Safety boundary": "安全边界",
  "Stops when": "停止条件",
  "Mode fit": "模式适配",
  "Selected stage": "选中阶段",
  "Owner:": "负责人：",
  "Template:": "模板：",
  "Attached capabilities:": "挂载能力：",
  "Failure handling:": "失败处理：",
  "Agent roster": "智能体阵容",
  "Bound saved agent:": "绑定的已保存智能体：",
  "Runtime capabilities": "运行时能力",
  "Mode capabilities mount on the runtime harness. Stage capabilities mount only on their source stage.":
    "模式能力挂载在运行时框架上。阶段能力只挂载到来源阶段。",
  "Safety and completion": "安全与收束",
  "Recovery:": "恢复：",
  "Memory:": "记忆：",
  "Risk level may trigger approval or guarded execution.":
    "风险等级可能触发审批或受保护执行。",
  "Uses the mode default recovery behavior.": "使用模式默认恢复行为。",
  no: "无",
  "risky stages": "个风险阶段",
  "enabled nodes": "个启用节点",
  skills: "个技能",
  Runtime: "运行时",
  "runtime anchor": "运行时锚点",
  root: "根",
  live: "运行",
  on: "开",
  off: "关",
  "Enabled stages": "已启用阶段",
  "No enabled stages.": "没有启用阶段。",
  "Disabled stages:": "已停用阶段：",
  "Risky stages:": "高风险阶段：",
  "Failure:": "失败模式：",
  "Presentation:": "呈现：",
  "Completion:": "完成策略：",
  "Required nodes locked": "必需节点已锁定",
  "Cycles blocked before save": "保存前会阻止循环",
  "System presets stay read-only on canvas. Choose":
    "系统预设在画布中保持只读。选择",
  "to clone this layout into an editable mode.": "可将此布局克隆为可编辑模式。",
  Capability: "能力",
  "Mode capability": "模式能力",
  "Stage capability": "阶段能力",
  "Capability action": "能力操作",
  "Enable capability": "启用能力",
  "Disable capability": "停用能力",
  "This capability is blocked until its required flags/tools are enabled.":
    "必须启用所需标记/工具后，此能力才可用。",
  "Default runtime prompt": "默认运行时提示词",
  "Runtime policy": "运行时策略",
  "Stop policy": "停止策略",
  "Stop policy:": "停止策略：",
  "Stop:": "停止：",
  "Use:": "用途：",
  "Behavior:": "行为：",
  "Approval:": "审批：",
  "Edge:": "边：",
  "Requires tools:": "需要工具：",
  "Requires flags:": "需要标记：",
  "Skills:": "技能：",
  "Tools:": "工具：",
  "Workspace tools": "工作区工具",
  "Runtime defaults": "运行时默认值",
  tools: "个工具",
  "duplicate tolerance": "重复容忍度",
  "Long-term memory policy": "长期记忆策略",
  "Long-term Memory": "长期记忆",
  "Update a durable user memory profile from completed runs and inject relevant facts into future prompts.":
    "从已完成运行中更新持久用户记忆画像，并把相关事实注入后续提示词。",
  Updater: "更新器",
  "provider JSON patch": "提供方 JSON patch",
  "heuristic fallback": "启发式兜底",
  "Updater provider id": "更新器提供方 ID",
  "inherit selected provider": "继承当前选择的提供方",
  "Debounce ms": "防抖毫秒",
  Confidence: "置信度",
  "Max facts": "最大事实数",
  "Inject facts": "注入事实数",
  "runtime default": "运行时默认值",
  default: "默认",
  none: "无",
  safe: "安全",
  Safe: "安全",
  low: "低",
  medium: "中",
  high: "高",
  "low risk": "低风险",
  "requires approval": "需要审批",
  "high risk only": "仅高风险",
  auto: "自动",
  manual: "手动",
  "queue drained": "队列清空",
  "max iterations": "最大轮数",
  converged: "已收敛",
  balanced: "平衡",
  persistent: "持久",
  decisive: "果断",
  "mode capability": "模式能力",
  "stage attachment": "阶段挂载",
  "family capability": "家族能力",
  control: "控制",
  memory: "记忆",
  delegation: "委派",
  artifact: "产物",
  verification: "验证",
  "idle cycles": "个空闲周期",
  Required: "必需",
  Optional: "可选",
  "Skip allowed": "允许跳过",
  Attempts: "尝试次数",
  "Backoff ms": "退避毫秒",
  "Risk level": "风险等级",
  Attachment: "附件",
  "Attached stage:": "附加阶段：",
  "This stage does not currently consume a prompt override in the runtime interpreter.":
    "此阶段目前不会在运行时解释器中使用提示词覆盖。",
  "This stage currently relies on runtime behavior rather than a prompt template.":
    "此阶段当前依赖运行时行为，而不是提示词模板。",
  "Override the runtime prompt template for this stage.":
    "覆盖此阶段的运行时提示词模板。",
  "Available runtime variables:": "可用运行时变量：",
  "No stage atoms are compatible with this family.":
    "没有与这个模式家族兼容的阶段原子。",
  "A single enabled stage does not create an active edge.":
    "单个启用阶段不会创建活跃边。",
  "Stop after all enabled stages complete and no queued work remains.":
    "所有启用阶段完成且没有排队工作后停止。",
  "Stop only when a user or operator explicitly ends the run.":
    "仅在用户或操作员明确结束运行时停止。",
  "Stop when the lead agent has synthesized the delegated research and review outputs.":
    "当主智能体完成委派研究与评审结果的综合后停止。",
  "Stop when the shared board stops changing for 2 idle cycles.":
    "共享看板连续 2 个空闲周期不再变化后停止。",
  preset: "预设",
  "generator verifier": "生成器-验证器",
  "Generator-Verifier": "生成器-验证器",
  "A generator proposes an answer and a verifier checks it against a rubric.":
    "生成器提出答案，验证器按评分标准检查。",
  "orchestrator subagent": "编排器-子智能体",
  "Orchestrator-Subagent": "编排器-子智能体",
  "An orchestrator decomposes the task and dispatches explicit subagents.":
    "编排器拆解任务，并派发给明确的子智能体。",
  "DeerFlow-like Harness": "DeerFlow 式框架",
  "A lead agent frames the work, delegates research and review, then synthesizes the final answer.":
    "主智能体界定任务，委派研究与评审，然后综合最终答案。",
  "Use a DeerFlow-inspired lead-agent harness with workspace, memory capture, loop guards, tool boundaries, and explicit delegated subagent stages.":
    "使用受 DeerFlow 启发的主智能体框架，包含工作区、记忆捕获、循环保护、工具边界和显式委派子智能体阶段。",
  "Use for decomposable work where a lead agent should coordinate focused research and review before answering.":
    "适用于可拆解任务：先由主智能体协调聚焦研究与评审，再给出回答。",
  "Delegation can add coordination overhead when the task is simple or the delegated stages are underspecified.":
    "当任务很简单或委派阶段定义不足时，委派会增加协调开销。",
  "Single Agent": "单智能体",
  "One agent makes a compact plan and completes the task without spawning teammates.":
    "单个智能体制定简洁计划，并在不派生队友的情况下完成任务。",
  "Ora Self Builder": "Ora 自构建器",
  "Ora plans, edits, verifies, builds, and promotes a local package slot for itself.":
    "Ora 为自身规划、编辑、验证、构建并提升本地包槽位。",
  "agent teams": "智能体团队",
  "Agent Teams": "智能体团队",
  "Persistent teammate agents coordinate around a shared backlog and memory.":
    "持久化队友智能体围绕共享待办和记忆协作。",
  "message bus": "消息总线",
  "Message Bus": "消息总线",
  "Agents publish and subscribe to routed events through a shared bus.":
    "智能体通过共享总线发布和订阅路由事件。",
  "shared state": "共享状态",
  "Shared State": "共享状态",
  "Agents collaborate through a versioned shared blackboard instead of a central coordinator.":
    "智能体不依赖中央协调者，而是通过版本化共享黑板协作。",
  "Lead plan": "主控规划",
  "Research subagent": "研究子智能体",
  "Review subagent": "评审子智能体",
  "Lead synthesis": "主控综合",
  "Thread Workspace": "线程工作区",
  "Provision a per-run workspace and thread-scoped paths before execution starts.":
    "执行开始前，为每次运行准备工作区和线程作用域路径。",
  "Recovery Policy": "恢复策略",
  "Apply configured retry, alternate-tool, skip, and degraded-artifact recovery rules across runtime boundaries.":
    "跨运行时边界应用重试、替代工具、跳过和降级产物恢复规则。",
  "Tool Error Boundary": "工具错误边界",
  "Convert tool and provider failures into structured runtime events instead of aborting immediately.":
    "将工具和提供方失败转为结构化运行时事件，而不是立即中止。",
  "Loop Guard": "循环保护",
  "Detect repetitive tool or action loops and force the run to wrap up safely.":
    "检测重复工具或动作循环，并强制运行安全收束。",
  "Clarification Interrupt": "澄清中断",
  "Pause execution when the mode needs missing user input before continuing.":
    "当模式继续前需要缺失的用户输入时暂停执行。",
  "Memory Capture": "记忆捕获",
  "Queue run summaries into session or project memory after meaningful progress.":
    "在取得有意义进展后，将运行摘要排入会话或项目记忆。",
  "Update a durable user memory profile from conversation context and inject relevant facts into future runs.":
    "从对话上下文更新持久用户记忆画像，并将相关事实注入后续运行。",
  "Deferred Tool Discovery": "延迟工具发现",
  "Expose lightweight tool metadata first and promote full schemas on demand.":
    "先暴露轻量工具元数据，再按需提升完整 schema。",
  "Subagent Delegate": "子智能体委派",
  "Run a stage as a delegated task with explicit lifecycle events and handoff records.":
    "将阶段作为委派任务运行，并产生明确生命周期事件和交接记录。",
  "Persistent Worker Memory": "持久工作者记忆",
  "Persist worker-specific memory across runs so long-lived team roles can accumulate context.":
    "跨运行持久化工作者专属记忆，让长期团队角色积累上下文。",
  "Event Routing": "事件路由",
  "Track routed topics, subscribers, and correlation records as first-class runtime state.":
    "将路由主题、订阅者和关联记录作为一等运行时状态追踪。",
  "Shared Blackboard": "共享黑板",
  "Maintain a versioned shared board with explicit convergence state across collaborators.":
    "维护带版本的共享看板，并记录协作者之间的显式收敛状态。",
  "Artifact Publish": "产物发布",
  "Promote stage outputs into explicit runtime artifacts and handoff surfaces.":
    "将阶段输出提升为显式运行时产物和交接界面。",
  "Token Usage Trace": "Token 用量追踪",
  "Attach token usage and budget accounting to runtime events and reports.":
    "将 Token 用量和预算核算附加到运行时事件与报告。",
  "Task composer": "任务编排器",
  "Start run": "开始运行",
  Starting: "启动中",
  "Show topology": "显示拓扑",
};

const ZH_PATTERNS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^Show (\d+) more$/, (match) => `再显示 ${match[1]} 个`],
  [/^(\d+) pending gates?$/, (match) => `${match[1]} 个待处理关卡`],
  [/^(\d+) active$/, (match) => `${match[1]} 个进行中`],
  [/^(\d+) blocked$/, (match) => `${match[1]} 个已阻塞`],
  [/^(\d+) recorded$/, (match) => `${match[1]} 条记录`],
  [/^(\d+) facts$/, (match) => `${match[1]} 条事实`],
  [/^(\d+) mounted capabilities$/, (match) => `${match[1]} 个已挂载能力`],
  [/^(\d+)\/(\d+) done$/, (match) => `${match[1]}/${match[2]} 已完成`],
  [
    /^Stop after (\d+) passes if verification does not accept the result earlier\.$/,
    (match) => `如果验证没有更早接受结果，则在 ${match[1]} 轮后停止。`,
  ],
  [
    /^Stop when the shared board stops changing for (\d+) idle cycles\.$/,
    (match) => `共享看板连续 ${match[1]} 个空闲周期不再变化后停止。`,
  ],
  [
    /^This section compresses (\d+) enabled stages so the operating path stays readable\.$/,
    (match) => `这里压缩展示 ${match[1]} 个启用阶段，让运行路径保持可读。`,
  ],
  [
    /^(.+) drafts a candidate answer that the verifier can inspect and improve\.$/,
    (match) => `${translateCopy("zh", match[1])} 起草候选答案，供验证者检查和改进。`,
  ],
  [
    /^(.+) checks the candidate against the rubric and decides whether it is ready\.$/,
    (match) => `${translateCopy("zh", match[1])} 按 rubric 检查候选答案，并判断是否就绪。`,
  ],
  [
    /^(.+) makes the accept, retry, or stop decision for this verification loop\.$/,
    (match) => `${translateCopy("zh", match[1])} 为这轮验证循环做出接受、重试或停止决策。`,
  ],
  [
    /^(.+) breaks the request into clear responsibilities before other stages start\.$/,
    (match) => `${translateCopy("zh", match[1])} 在其他阶段开始前，将请求拆成清晰职责。`,
  ],
  [
    /^(.+) gathers focused context for the plan instead of answering from first impressions\.$/,
    (match) => `${translateCopy("zh", match[1])} 为计划收集聚焦上下文，而不是凭第一印象回答。`,
  ],
  [
    /^(.+) reviews the work for gaps, contradictions, risks, and missing evidence\.$/,
    (match) => `${translateCopy("zh", match[1])} 检查工作中的缺口、矛盾、风险和缺失证据。`,
  ],
  [
    /^(.+) combines the completed work into a final response with the mode's context intact\.$/,
    (match) => `${translateCopy("zh", match[1])} 在保留模式上下文的前提下，将已完成工作合成为最终回复。`,
  ],
  [
    /^(.+) turns the request into a small backlog with explicit ownership\.$/,
    (match) => `${translateCopy("zh", match[1])} 将请求转成带明确负责人的小型 backlog。`,
  ],
  [
    /^(.+) completes the assigned work item using the mode's available capabilities\.$/,
    (match) => `${translateCopy("zh", match[1])} 使用模式可用能力完成分配到的工作项。`,
  ],
  [
    /^(.+) checks the completed work and reports approval or concrete issues\.$/,
    (match) => `${translateCopy("zh", match[1])} 检查已完成工作，并给出通过结论或具体问题。`,
  ],
  [
    /^(.+) packages the current state so the next stage knows what changed and what remains\.$/,
    (match) => `${translateCopy("zh", match[1])} 打包当前状态，让下一阶段知道发生了什么、还剩什么。`,
  ],
  [
    /^(.+) publishes the initial event so downstream subscribers can react to it\.$/,
    (match) => `${translateCopy("zh", match[1])} 发布初始事件，让下游订阅者能够响应。`,
  ],
  [
    /^(.+) classifies the event and routes it to the subscriber that should handle it\.$/,
    (match) => `${translateCopy("zh", match[1])} 对事件分类，并路由给应该处理它的订阅者。`,
  ],
  [
    /^(.+) handles the routed work item and emits findings back into the bus\.$/,
    (match) => `${translateCopy("zh", match[1])} 处理被路由的工作项，并把发现发回消息总线。`,
  ],
  [
    /^(.+) turns routed findings into the final response event for the user\.$/,
    (match) => `${translateCopy("zh", match[1])} 将路由后的发现转成给用户的最终响应事件。`,
  ],
  [
    /^(.+) initializes the shared board so every collaborator starts from the same state\.$/,
    (match) => `${translateCopy("zh", match[1])} 初始化共享看板，让所有协作者从同一状态开始。`,
  ],
  [
    /^(.+) contributes the next useful finding to the shared board\.$/,
    (match) => `${translateCopy("zh", match[1])} 向共享看板补充下一条有用发现。`,
  ],
  [
    /^(.+) reviews the shared board and decides whether the collaborators have converged\.$/,
    (match) => `${translateCopy("zh", match[1])} 检查共享看板，并判断协作者是否已经收敛。`,
  ],
  [
    /^(.+) drafts the first candidate answer or working artifact\.$/,
    (match) => `${translateCopy("zh", match[1])} 起草第一版候选答案或工作产物。`,
  ],
  [
    /^(.+) breaks the request into an executable plan and decides what needs attention first\.$/,
    (match) => `${translateCopy("zh", match[1])} 将请求拆成可执行计划，并判断最先需要关注什么。`,
  ],
  [
    /^(.+) gathers focused context before the mode commits to an answer\.$/,
    (match) => `${translateCopy("zh", match[1])} 在模式给出答案前收集聚焦上下文。`,
  ],
  [
    /^(.+) reviews the work for gaps, risks, and missing evidence\.$/,
    (match) => `${translateCopy("zh", match[1])} 检查工作中的缺口、风险和缺失证据。`,
  ],
  [
    /^(.+) checks the result against the mode's quality and risk boundary\.$/,
    (match) => `${translateCopy("zh", match[1])} 按模式的质量和风险边界检查结果。`,
  ],
  [
    /^(.+) chooses the next action from the available state and constraints\.$/,
    (match) => `${translateCopy("zh", match[1])} 根据当前状态和约束选择下一步动作。`,
  ],
  [
    /^(.+) turns the completed work into the final response for the user\.$/,
    (match) => `${translateCopy("zh", match[1])} 将已完成的工作转成给用户的最终回复。`,
  ],
  [
    /^(.+) publishes an event or artifact so later stages can consume it\.$/,
    (match) => `${translateCopy("zh", match[1])} 发布事件或产物，供后续阶段消费。`,
  ],
  [
    /^(.+) routes events to the subscribers that should handle the next piece of work\.$/,
    (match) => `${translateCopy("zh", match[1])} 将事件路由给应该处理下一段工作的订阅者。`,
  ],
  [
    /^(.+) handles subscribed work and updates the shared runtime state\.$/,
    (match) => `${translateCopy("zh", match[1])} 处理订阅工作，并更新共享运行时状态。`,
  ],
  [
    /^(.+) combines partial outputs into a coherent answer\.$/,
    (match) => `${translateCopy("zh", match[1])} 将部分输出综合成连贯答案。`,
  ],
  [
    /^(.+) classifies the request and chooses the right handling lane\.$/,
    (match) => `${translateCopy("zh", match[1])} 对请求分类，并选择合适的处理通道。`,
  ],
  [
    /^(.+) executes the main construction or implementation step\.$/,
    (match) => `${translateCopy("zh", match[1])} 执行主要构建或实现步骤。`,
  ],
  [
    /^(.+) checks the completed work before handoff\.$/,
    (match) => `${translateCopy("zh", match[1])} 在交接前检查已完成的工作。`,
  ],
  [
    /^(.+) packages the result for the next stage or the final response\.$/,
    (match) => `${translateCopy("zh", match[1])} 将结果打包给下一阶段或最终回复。`,
  ],
  [
    /^(.+) initializes the shared state so collaborators start from the same context\.$/,
    (match) => `${translateCopy("zh", match[1])} 初始化共享状态，让协作者从同一上下文开始。`,
  ],
  [
    /^(.+) watches for shared-state convergence before the run wraps up\.$/,
    (match) => `${translateCopy("zh", match[1])} 在运行收束前观察共享状态是否收敛。`,
  ],
  [
    /^(.+) runs this stage using the selected runtime template\.$/,
    (match) => `${translateCopy("zh", match[1])} 使用选定的运行时模板执行这个阶段。`,
  ],
  [
    /^(.+) in progress\.$/,
    (match) => `${translateCopy("zh", match[1])} 进行中。`,
  ],
  [
    /^Processing state updated: (.+)\.$/,
    (match) => `处理状态已更新：${match[1]}。`,
  ],
  [
    /^Could not complete this operation: (.+)$/,
    (match) => `无法完成这个操作：${match[1]}`,
  ],
  [
    /^Continued with limited context (.+)\.$/,
    (match) => `已使用有限上下文继续：${match[1]}。`,
  ],
  [
    /^Paused after processing was interrupted (.+)\.$/,
    (match) => `处理被中断后已暂停：${match[1]}。`,
  ],
  [/^Processing step failed (.+)\.$/, (match) => `处理步骤失败：${match[1]}。`],
  [
    /^Processing state changed (.+)\.$/,
    (match) => `处理状态已变化：${match[1]}。`,
  ],
  [/^Provider id:$/, () => "提供方 ID："],
  [/^Model: (.+)$/, (match) => `模型：${translateCopy("zh", match[1])}`],
  [
    /^Tool groups: (.+)$/,
    (match) => `工具组：${translateCopy("zh", match[1])}`,
  ],
  [/^(.+) risk$/, (match) => `${translateCopy("zh", match[1])} 风险`],
  [
    /^(.+) selected for the next turn\.$/,
    (match) => `${match[1]} 已选择用于下一轮。`,
  ],
  [
    /^Mode (.+) selected for the next turn\.$/,
    (match) => `模式 ${match[1]} 已选择用于下一轮。`,
  ],
  [
    /^Provider (.+) selected for the next turn\.$/,
    (match) => `提供方 ${match[1]} 已选择用于下一轮。`,
  ],
  [
    /^Custom agent (.+) selected for the next run\.$/,
    (match) => `自定义智能体 ${match[1]} 已选择用于下一次运行。`,
  ],
  [/^Removed provider (.+)\.$/, (match) => `已移除提供方 ${match[1]}。`],
  [
    /^(.+) saved for future turns\.$/,
    (match) => `${match[1]} 已保存用于后续轮次。`,
  ],
  [/^(.+) is ready to configure\.$/, (match) => `${match[1]} 已可配置。`],
  [/^Started turn (.+)\.$/, (match) => `已启动第 ${match[1]} 轮。`],
  [
    /^Created custom agent (.+)\.$/,
    (match) => `已创建自定义智能体 ${match[1]}。`,
  ],
  [
    /^Updated custom agent (.+)\.$/,
    (match) => `已更新自定义智能体 ${match[1]}。`,
  ],
  [
    /^Deleted custom agent (.+)\.$/,
    (match) => `已删除自定义智能体 ${match[1]}。`,
  ],
  [
    /^Editing custom agent (.+)\.$/,
    (match) => `正在编辑自定义智能体 ${match[1]}。`,
  ],
  [/^(.+) skill saved\.$/, (match) => `${match[1]} 技能已保存。`],
  [/^Deleted skill (.+)\.$/, (match) => `已删除技能 ${match[1]}。`],
];

const textOriginals = new WeakMap<Text, string>();
const attributeOriginals = new WeakMap<Element, Map<string, string>>();
const TRANSLATED_ATTRIBUTES = ["title", "placeholder", "aria-label", "alt"];
const I18N_SKIP_SELECTOR = "[data-i18n-skip]";

export function readStoredLanguage(): AppLanguage {
  if (typeof window === "undefined") {
    return "zh";
  }
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en"
    ? "en"
    : "zh";
}

export function translateCopy(language: AppLanguage, value: string): string {
  if (language === "en") {
    return value;
  }

  const exact = ZH_COPY[value];
  if (exact) {
    return exact;
  }

  for (const [pattern, replacer] of ZH_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      return replacer(match);
    }
  }

  return value;
}

export function useDocumentTranslations(language: AppLanguage) {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";

    const isInSkippedSubtree = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return Boolean(node.parentElement?.closest(I18N_SKIP_SELECTOR));
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        return Boolean((node as Element).closest(I18N_SKIP_SELECTOR));
      }
      return false;
    };

    const translateTextNode = (node: Text) => {
      if (isInSkippedSubtree(node)) {
        return;
      }

      const current = node.nodeValue ?? "";
      let original = textOriginals.get(node) ?? current;
      const translatedOriginal = translateCopy("zh", original);
      if (
        textOriginals.has(node) &&
        current !== original &&
        current !== translatedOriginal
      ) {
        original = current;
        textOriginals.set(node, original);
      }
      if (!textOriginals.has(node)) {
        textOriginals.set(node, original);
      }

      if (language === "en") {
        if (current !== original) {
          node.nodeValue = original;
        }
        return;
      }

      const leading = original.match(/^\s*/)?.[0] ?? "";
      const trailing = original.match(/\s*$/)?.[0] ?? "";
      const trimmed = original.trim();
      if (!trimmed) {
        return;
      }
      const translated = translateCopy(language, trimmed);
      const nextValue =
        translated === trimmed
          ? original
          : `${leading}${translated}${trailing}`;
      if (current !== nextValue) {
        node.nodeValue = nextValue;
      }
    };

    const translateElementAttributes = (element: Element) => {
      if (isInSkippedSubtree(element)) {
        return;
      }

      let originals = attributeOriginals.get(element);
      for (const attr of TRANSLATED_ATTRIBUTES) {
        const current = element.getAttribute(attr);
        if (!current) {
          continue;
        }
        if (!originals) {
          originals = new Map();
          attributeOriginals.set(element, originals);
        }
        let original = originals.get(attr) ?? current;
        const translatedOriginal = translateCopy("zh", original);
        if (
          originals.has(attr) &&
          current !== original &&
          current !== translatedOriginal
        ) {
          original = current;
        }
        originals.set(attr, original);
        const nextValue =
          language === "en" ? original : translateCopy(language, original);
        if (current !== nextValue) {
          element.setAttribute(attr, nextValue);
        }
      }
    };

    const translateTree = (root: Node) => {
      if (isInSkippedSubtree(root)) {
        return;
      }

      if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root as Text);
        return;
      }
      if (
        root.nodeType !== Node.ELEMENT_NODE &&
        root.nodeType !== Node.DOCUMENT_NODE
      ) {
        return;
      }

      const element = root as Element;
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        translateElementAttributes(element);
        return;
      }

      if (root.nodeType === Node.ELEMENT_NODE) {
        translateElementAttributes(element);
      }

      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      let node = walker.nextNode();
      while (node) {
        if (isInSkippedSubtree(node)) {
          node = walker.nextNode();
          continue;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          translateTextNode(node as Text);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          translateElementAttributes(node as Element);
        }
        node = walker.nextNode();
      }
    };

    translateTree(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          translateTree(mutation.target);
        } else if (mutation.type === "attributes") {
          translateTree(mutation.target);
        } else {
          mutation.addedNodes.forEach(translateTree);
        }
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: TRANSLATED_ATTRIBUTES,
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [language]);
}
