import { useEffect } from "react";

export type AppLanguage = "zh" | "en";

export const LANGUAGE_STORAGE_KEY = "ora.desktop.language";

export const LANGUAGE_OPTIONS: Array<{ id: AppLanguage; label: string; nativeLabel: string }> = [
  { id: "zh", label: "Chinese", nativeLabel: "中文" },
  { id: "en", label: "English", nativeLabel: "English" },
];

const ZH_COPY: Record<string, string> = {
  "Settings": "设置",
  "Ora Operator Workbench": "Ora 操作员工作台",
  "General": "通用",
  "Language": "语言",
  "Chinese": "中文",
  "English": "英文",
  "Display Language": "显示语言",
  "Choose the language used by the desktop workbench. Chinese is the default for new installs.": "选择桌面工作台使用的语言。新安装默认使用中文。",
  "New Chat": "新建对话",
  "New chat": "新建对话",
  "Search": "搜索",
  "Agents": "智能体",
  "Skills": "技能",
  "Modes": "模式",
  "Evaluation": "评测",
  "Projects": "项目",
  "Recent Chats": "最近对话",
  "Chats": "对话",
  "Select folder": "选择文件夹",
  "New project session": "新建项目会话",
  "No chats yet": "暂无对话",
  "Show less": "收起",
  "Awaiting reply": "等待回复",
  "Needs approval": "需要审批",
  "Failed": "失败",
  "Running": "运行中",
  "Done": "已完成",
  "Approval": "审批",
  "Checkpoint": "检查点",
  "Loading": "加载中",
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
  "Resize artifact panel": "调整制品面板宽度",
  "Welcome back to Ora": "欢迎回到 Ora",
  "Pause": "暂停",
  "Export": "导出",
  "Export report": "导出报告",
  "Trails": "轨迹",
  "Toggle trails": "切换轨迹",
  "Run in progress...": "运行进行中...",
  "Message Ora...": "给 Ora 发消息...",
  "Attachments": "附件",
  "Agent": "智能体",
  "No model": "未选择模型",
  "No configured model providers. Add a provider key in Settings.": "尚未配置模型提供方。请在设置中添加提供方密钥。",
  "Default": "默认",
  "Flash": "快速",
  "Thinking": "思考",
  "Pro": "专业",
  "Ultra": "极致",
  "Stop run": "停止运行",
  "Send message": "发送消息",
  "Ora can make mistakes. Review plans, actions, and checkpoints before using results.": "Ora 可能会出错。使用结果前请检查计划、操作和检查点。",
  "Approval required": "需要审批",
  "Pending approval": "待审批",
  "Review the blocked stage": "检查被阻塞的阶段",
  "Review the blocked stages": "检查被阻塞的阶段",
  "The runtime paused in the conversation flow and is waiting for your decision before continuing.": "运行时已暂停对话流程，等待你的决定后再继续。",
  "Approve and continue": "批准并继续",
  "Cancel run": "取消运行",
  "risk": "风险",
  "agent:": "智能体：",
  "Steps": "步骤",
  "To-dos": "待办",
  "Preview": "预览",
  "active": "进行中",
  "blocked": "已阻塞",
  "recorded": "已记录",
  "Artifact": "制品",
  "No artifact selected": "未选择制品",
  "Close artifact": "关闭制品",
  "Select an artifact from the chat stream to preview it here.": "从聊天流中选择一个制品，在这里预览。",
  "No inline preview is available for this artifact yet.": "此制品暂不支持内联预览。",
  "URI": "URI",
  "Trails will appear here.": "轨迹会显示在这里。",
  "Close trails": "关闭轨迹",
  "Live": "实时",
  "Timeline": "时间线",
  "Topology": "拓扑",
  "Trace": "追踪",
  "Status": "状态",
  "Mode": "模式",
  "Blocking gate": "阻塞关卡",
  "Selected node": "选中节点",
  "Active agents": "活跃智能体",
  "Events / sec": "事件/秒",
  "Est. cost": "预估成本",
  "Live Signals": "实时信号",
  "Events": "事件",
  "Checkpoints": "检查点",
  "Topology changes": "拓扑变更",
  "Messages": "消息",
  "Warnings": "警告",
  "Errors": "错误",
  "Operator Actions": "操作员动作",
  "Fork": "分叉",
  "Resume": "继续",
  "Cancel": "取消",
  "Runtime Focus": "运行时焦点",
  "Selected beat": "选中节拍",
  "Selected checkpoint": "选中检查点",
  "Focused agent": "聚焦智能体",
  "Generation refs": "生成引用",
  "Blocking Gates": "阻塞关卡",
  "This run is not currently paused behind a manual gate.": "当前运行没有暂停在人工关卡后。",
  "Latest runtime event": "最新运行时事件",
  "No checkpoint selected": "未选择检查点",
  "Run-level overview": "运行级概览",
  "Run overview": "运行概览",
  "Idle": "空闲",
  "None": "无",
  "Clarification": "澄清",
  "Action": "操作",
  "Plan": "计划",
  "Actions": "操作",
  "Plan Items": "计划项",
  "Preview mode": "预览模式",
  "Provider Settings": "提供方设置",
  "Providers": "提供方",
  "Use one provider flow: choose an API provider, load a template when needed, then save and verify from the same form.": "使用一套提供方流程：选择 API 提供方，需要时加载模板，然后在同一表单中保存并验证。",
  "Verified": "已验证",
  "Verification failed": "验证失败",
  "Key stored": "密钥已保存",
  "Needs key": "需要密钥",
  "Not configured": "未配置",
  "API Provider": "API 提供方",
  "Template": "模板",
  "Official": "官方",
  "Templates": "模板",
  "Load Template": "加载模板",
  "Responses API": "Responses API",
  "Chat Completions": "Chat Completions",
  "Provider Name": "提供方名称",
  "Provider name": "提供方名称",
  "API Key Env": "API 密钥环境变量",
  "Base URL": "Base URL",
  "Base URL (optional)": "Base URL（可选）",
  "Model": "模型",
  "Model ID": "模型 ID",
  "Provider Secret": "提供方密钥",
  "Secrets stay in the runtime layer and Keychain. This form never stores the raw key in React state.": "密钥保存在运行时层和钥匙串中。这个表单不会把原始密钥存入 React 状态。",
  "Key ready": "密钥就绪",
  "Key needed": "需要密钥",
  "Local": "本地",
  "No key required for local smoke": "本地 smoke 不需要密钥",
  "Save Key": "保存密钥",
  "Remove Key": "移除密钥",
  "Model Configuration": "模型配置",
  "Protocol, limits, capability flags, drop params, and optional headers.": "协议、限制、能力标记、丢弃参数和可选请求头。",
  "Protocol": "协议",
  "Responses": "Responses",
  "Anthropic Version": "Anthropic 版本",
  "Max Output Tokens": "最大输出 Token",
  "Temperature": "温度",
  "Drop Params": "丢弃参数",
  "Headers": "请求头",
  "Capabilities": "能力",
  "Provider id:": "提供方 ID：",
  "Verify": "验证",
  "Save": "保存",
  "Delete Custom Provider": "删除自定义提供方",
  "Runtime Status": "运行时状态",
  "Tool Registry": "工具注册表",
  "Skill Registry": "技能注册表",
  "Chat": "聊天",
  "Tool Use": "工具调用",
  "Images": "图片",
  "Reasoning": "推理",
  "Runtime": "运行时",
  "Tools": "工具",
  "Close settings": "关闭设置",
  "Connecting to the Ora runtime bridge.": "正在连接 Ora 运行时桥接。",
  "Select a session to inspect its latest turn, checkpoints, and approvals.": "选择一个会话以检查最新轮次、检查点和审批。",
  "Reconnecting to the Ora runtime bridge.": "正在重新连接 Ora 运行时桥接。",
  "Run completed.": "运行完成。",
  "Run failed.": "运行失败。",
  "Run completed": "运行完成",
  "Run failed": "运行失败",
  "Add project": "添加项目",
  "Load turn": "加载轮次",
  "Interrupt": "中断",
  "Approve": "批准",
  "Replay": "回放",
  "Report": "报告",
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
  "API key stored. Run verify to confirm connectivity.": "API 密钥已保存。运行验证以确认连通性。",
  "API key required before verification.": "验证前需要 API 密钥。",
  "Local smoke provider is ready.": "本地 smoke 提供方已就绪。",
  "Official OpenAI Responses API provider.": "官方 OpenAI Responses API 提供方。",
  "Official Claude Messages API provider.": "官方 Claude Messages API 提供方。",
  "Deterministic local smoke provider for offline testing.": "用于离线测试的确定性本地 smoke 提供方。",
  "Any provider that speaks the OpenAI chat or responses protocol.": "任何兼容 OpenAI Chat 或 Responses 协议的提供方。",
  "Any provider that speaks the Anthropic Messages API.": "任何兼容 Anthropic Messages API 的提供方。",
  "OpenAI-compatible Qwen via Bailian/DashScope.": "通过百炼/DashScope 使用兼容 OpenAI 的 Qwen。",
  "DeepSeek OpenAI-compatible API.": "DeepSeek 兼容 OpenAI 的 API。",
  "Zhipu OpenAI-compatible API.": "智谱兼容 OpenAI 的 API。",
  "Moonshot OpenAI-compatible API.": "Moonshot 兼容 OpenAI 的 API。",
  "Generic OpenAI-compatible": "通用 OpenAI 兼容",
  "Generic Anthropic-compatible": "通用 Anthropic 兼容",
  "Local Smoke": "本地 Smoke",
  "Agent Gallery": "智能体库",
  "Refresh": "刷新",
  "New agent": "新建智能体",
  "Selected Persona": "选中人格",
  "The selected agent becomes the default persona overlay for the next run you start from chat.": "选中的智能体会成为你下次从聊天启动运行时的默认人格叠层。",
  "Create, revise, delete, or start a new chat with a reusable persona.": "创建、修改、删除可复用人格，或用它开始新聊天。",
  "Create first agent": "创建第一个智能体",
  "Use in chat": "用于聊天",
  "Edit": "编辑",
  "Delete": "删除",
  "No description yet.": "暂无描述。",
  "inherit current chat model": "继承当前聊天模型",
  "inherit runtime defaults": "继承运行时默认值",
  "Create custom agent": "创建自定义智能体",
  "Create agent": "创建智能体",
  "Save changes": "保存更改",
  "Name": "名称",
  "Model Hint": "模型提示",
  "Description": "描述",
  "Tool Groups": "工具组",
  "Long-form persona instructions written into SOUL.md.": "写入 SOUL.md 的长篇人格指令。",
  "Start with a small persona card: name, description, model hint, tool groups, and SOUL instructions.": "从一张小人格卡开始：名称、描述、模型提示、工具组和 SOUL 指令。",
  "This v1 editor writes `config.yaml` and `SOUL.md` directly into `.ora/agents/&lt;name&gt;`.": "这个 v1 编辑器会直接写入 `.ora/agents/&lt;name&gt;` 下的 `config.yaml` 和 `SOUL.md`。",
  "Updated:": "更新时间：",
  "Failed to load custom agents.": "自定义智能体加载失败。",
  "Failed to load custom agent.": "自定义智能体加载失败。",
  "Failed to save custom agent.": "自定义智能体保存失败。",
  "Failed to delete custom agent.": "自定义智能体删除失败。",
  "Failed to open chat with the selected agent.": "无法用选中的智能体打开聊天。",
  "Custom agent name is required.": "自定义智能体名称为必填项。",
  "New skill": "新建技能",
  "Back to skills": "返回技能",
  "Search skills": "搜索技能",
  "All sources": "全部来源",
  "All states": "全部状态",
  "Custom": "自定义",
  "State": "状态",
  "Enabled": "已启用",
  "Disabled": "已禁用",
  "Enable": "启用",
  "Disable": "停用",
  "Create custom skill": "创建自定义技能",
  "Create skill": "创建技能",
  "Select a skill to inspect its full `SKILL.md`.": "选择一个技能以查看完整的 `SKILL.md`。",
  "Custom skills are stored as `.ora/skills/custom/&lt;name&gt;/SKILL.md`.": "自定义技能保存在 `.ora/skills/custom/&lt;name&gt;/SKILL.md`。",
  "What this skill helps the agent do.": "这个技能帮助智能体完成什么。",
  "Skill name is required.": "技能名称为必填项。",
  "Failed to load skills.": "技能加载失败。",
  "Failed to load skill.": "技能加载失败。",
  "Failed to save skill.": "技能保存失败。",
  "Failed to update skill state.": "技能状态更新失败。",
  "Failed to delete skill.": "技能删除失败。",
  "Import dataset": "导入数据集",
  "Run evaluation": "运行评测",
  "Regression": "回归",
  "Lab": "实验室",
  "Dataset": "数据集",
  "Baseline": "基线",
  "Repetitions": "重复次数",
  "Outcome": "结果",
  "Orchestration": "编排",
  "Task Completion": "任务完成",
  "Final-result focused scoring.": "聚焦最终结果的评分。",
  "Tool/handoff/process focused scoring.": "聚焦工具、交接和流程的评分。",
  "Environment task completion focused scoring.": "聚焦环境任务完成度的评分。",
  "Uses the provider selected in Settings for v1.": "v1 使用设置中选中的提供方。",
  "Select dataset": "选择数据集",
  "Select evaluation run": "选择评测运行",
  "Case Browser": "用例浏览器",
  "Case Detail": "用例详情",
  "Config Comparison": "配置对比",
  "Slice Analysis": "切片分析",
  "Regressions": "回归",
  "Avg runtime": "平均运行时长",
  "Avg cost": "平均成本",
  "Safety": "安全性",
  "Efficiency": "效率",
  "Case": "用例",
  "Cases": "用例",
  "Config": "配置",
  "Cost": "成本",
  "Value": "值",
  "Dimension": "维度",
  "Anomalies": "异常",
  "attempts flagged": "次尝试被标记",
  "Select a case row to inspect input, expectation, per-config outputs, and the trace links generated by the underlying Ora runs.": "选择用例行以检查输入、期望、各配置输出，以及底层 Ora 运行生成的追踪链接。",
  "Evaluation index returned an invalid response.": "评测索引返回了无效响应。",
  "Failed to load evaluation index.": "评测索引加载失败。",
  "Failed to load evaluation dataset.": "评测数据集加载失败。",
  "Failed to load evaluation run.": "评测运行加载失败。",
  "Failed to import dataset.": "数据集导入失败。",
  "Failed to start evaluation run.": "评测运行启动失败。",
  "Failed to promote baseline.": "基线提升失败。",
  "Failed to export evaluation run.": "评测运行导出失败。",
  "Mode settings": "模式设置",
  "Canvas": "画布",
  "Canvas preview": "画布预览",
  "Customize": "自定义",
  "Validate": "验证",
  "Validation passed.": "验证通过。",
  "Validation failed.": "验证失败。",
  "Save mode": "保存模式",
  "Delete mode": "删除模式",
  "Clone preset": "克隆预设",
  "Auto layout": "自动布局",
  "Add stage": "添加阶段",
  "Delete node": "删除节点",
  "Delete rule": "删除规则",
  "Summary": "摘要",
  "Details": "详情",
  "Rules": "规则",
  "Atoms": "原子",
  "Stage atoms": "阶段原子",
  "Enabled stages": "已启用阶段",
  "Disabled stages:": "已停用阶段：",
  "Risky stages:": "高风险阶段：",
  "Required nodes locked": "必需节点已锁定",
  "Cycles blocked before save": "保存前会阻止循环",
  "System presets stay read-only on canvas. Choose": "系统预设在画布中保持只读。选择",
  "to clone this layout into an editable mode.": "可将此布局克隆为可编辑模式。",
  "Capability": "能力",
  "Stage capability": "阶段能力",
  "Capability action": "能力操作",
  "Enable capability": "启用能力",
  "Disable capability": "停用能力",
  "This capability is blocked until its required flags/tools are enabled.": "必须启用所需标记/工具后，此能力才可用。",
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
  "runtime default": "运行时默认值",
  "safe": "安全",
  "Safe": "安全",
  "Required": "必需",
  "Skip allowed": "允许跳过",
  "Attempts": "尝试次数",
  "Backoff ms": "退避毫秒",
  "Risk level": "风险等级",
  "Attachment": "附件",
  "Attached stage:": "附加阶段：",
  "This stage does not currently consume a prompt override in the runtime interpreter.": "此阶段目前不会在运行时解释器中使用提示词覆盖。",
  "A single enabled stage does not create an active edge.": "单个启用阶段不会创建活跃边。",
  "Stop after all enabled stages complete and no queued work remains.": "所有启用阶段完成且没有排队工作后停止。",
  "Stop only when a user or operator explicitly ends the run.": "仅在用户或操作员明确结束运行时停止。",
  "Task composer": "任务编排器",
  "Start run": "开始运行",
  "Starting": "启动中",
  "Show topology": "显示拓扑",
};

const ZH_PATTERNS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^Show (\d+) more$/, (match) => `再显示 ${match[1]} 个`],
  [/^(\d+) pending gates?$/, (match) => `${match[1]} 个待处理关卡`],
  [/^(\d+) active$/, (match) => `${match[1]} 个进行中`],
  [/^(\d+) blocked$/, (match) => `${match[1]} 个已阻塞`],
  [/^(\d+) recorded$/, (match) => `${match[1]} 条记录`],
  [/^(\d+)\/(\d+) done$/, (match) => `${match[1]}/${match[2]} 已完成`],
  [/^(.+) in progress\.$/, (match) => `${translateCopy("zh", match[1])} 进行中。`],
  [/^Provider id:$/, () => "提供方 ID："],
  [/^Model: (.+)$/, (match) => `模型：${translateCopy("zh", match[1])}`],
  [/^Tool groups: (.+)$/, (match) => `工具组：${translateCopy("zh", match[1])}`],
  [/^(.+) risk$/, (match) => `${translateCopy("zh", match[1])} 风险`],
  [/^(.+) selected for the next turn\.$/, (match) => `${match[1]} 已选择用于下一轮。`],
  [/^Mode (.+) selected for the next turn\.$/, (match) => `模式 ${match[1]} 已选择用于下一轮。`],
  [/^Provider (.+) selected for the next turn\.$/, (match) => `提供方 ${match[1]} 已选择用于下一轮。`],
  [/^Custom agent (.+) selected for the next run\.$/, (match) => `自定义智能体 ${match[1]} 已选择用于下一次运行。`],
  [/^Removed provider (.+)\.$/, (match) => `已移除提供方 ${match[1]}。`],
  [/^(.+) saved for future turns\.$/, (match) => `${match[1]} 已保存用于后续轮次。`],
  [/^(.+) is ready to configure\.$/, (match) => `${match[1]} 已可配置。`],
  [/^Started turn (.+)\.$/, (match) => `已启动第 ${match[1]} 轮。`],
  [/^Created custom agent (.+)\.$/, (match) => `已创建自定义智能体 ${match[1]}。`],
  [/^Updated custom agent (.+)\.$/, (match) => `已更新自定义智能体 ${match[1]}。`],
  [/^Deleted custom agent (.+)\.$/, (match) => `已删除自定义智能体 ${match[1]}。`],
  [/^Editing custom agent (.+)\.$/, (match) => `正在编辑自定义智能体 ${match[1]}。`],
  [/^(.+) skill saved\.$/, (match) => `${match[1]} 技能已保存。`],
  [/^Deleted skill (.+)\.$/, (match) => `已删除技能 ${match[1]}。`],
];

const textOriginals = new WeakMap<Text, string>();
const attributeOriginals = new WeakMap<Element, Map<string, string>>();
const TRANSLATED_ATTRIBUTES = ["title", "placeholder", "aria-label", "alt"];

export function readStoredLanguage(): AppLanguage {
  if (typeof window === "undefined") {
    return "zh";
  }
  return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "zh";
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

    const translateTextNode = (node: Text) => {
      const current = node.nodeValue ?? "";
      let original = textOriginals.get(node) ?? current;
      const translatedOriginal = translateCopy("zh", original);
      if (textOriginals.has(node) && current !== original && current !== translatedOriginal) {
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
      const nextValue = translated === trimmed ? original : `${leading}${translated}${trailing}`;
      if (current !== nextValue) {
        node.nodeValue = nextValue;
      }
    };

    const translateElementAttributes = (element: Element) => {
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
        if (originals.has(attr) && current !== original && current !== translatedOriginal) {
          original = current;
        }
        originals.set(attr, original);
        const nextValue = language === "en" ? original : translateCopy(language, original);
        if (current !== nextValue) {
          element.setAttribute(attr, nextValue);
        }
      }
    };

    const translateTree = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root as Text);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
        return;
      }

      const element = root as Element;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.closest?.("[data-i18n-skip]")) {
        translateElementAttributes(element);
        return;
      }

      if (root.nodeType === Node.ELEMENT_NODE) {
        translateElementAttributes(element);
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
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
