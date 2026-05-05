import type { ChannelKind, ModeSelection, PermissionMode, ProviderCapability, TaskIntent } from "@cemeworm/shared";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Database,
  ExternalLink,
  Globe2,
  KeyRound,
  Plus,
  Power,
  Radio,
  Save,
  Search,
  Settings,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProviderSetup } from "../hooks/useProviderSetup";
import { useWorkbench } from "../lib/state";
import {
  buildProviderConfigFromDraft,
  canEditBaseUrl,
  createDraftFromProvider,
  createModelProviderId,
  getModelProviderBaseId,
  type ProviderDraft,
} from "../lib/providerPresets";
import {
  DEFAULT_SEARCH_SETTINGS,
  loadDesktopSearchSettings,
  saveDesktopSearchSettings,
  type DesktopSearchProviderId,
  type DesktopSearchSettings,
} from "../lib/searchSettings";
import {
  loadDesktopToolModelSettings,
  saveDesktopToolModelSettings,
  type DesktopToolModelSettings,
} from "../lib/toolModelSettings";
import { useRunActions } from "../lib/useRunActions";
import type { OraChannelConfig, OraLongTermMemoryProfile, OraProviderConfig, OraProviderModelsResult } from "../lib/runtimeClient";
import { cn } from "../lib/utils";
import { LANGUAGE_OPTIONS } from "../lib/i18n";
import { ProjectSignalsView } from "./ProjectSignalsView";
import { WechatQrCodePanel } from "./WechatQrCodePanel";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Select } from "./ui/select";

type SettingsSection = "general" | "providers" | "memory" | "runtime" | "tools" | "channels";

const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof Settings;
}> = [
  { id: "general", label: "General", icon: Globe2 },
  { id: "providers", label: "Providers", icon: Bot },
  { id: "memory", label: "Memory", icon: Database },
  { id: "runtime", label: "Status", icon: Activity },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "channels", label: "渠道", icon: Radio },
];

const capabilityOptions: Array<{ id: ProviderCapability; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "tool_use", label: "Tool Use" },
  { id: "image_input", label: "Images" },
  { id: "json_mode", label: "JSON" },
  { id: "reasoning", label: "Reasoning" },
];

const searchProviderOptions: Array<{
  id: DesktopSearchProviderId;
  label: string;
}> = [
  { id: "auto", label: "Auto" },
  { id: "brave", label: "Brave" },
  { id: "tavily", label: "Tavily" },
  { id: "serpapi", label: "SerpAPI" },
  { id: "kagi", label: "Kagi" },
  { id: "duckduckgo", label: "DuckDuckGo" },
  { id: "mcp", label: "MCP" },
];

type ChannelProviderKind = ChannelKind;

type ChannelConfigField = {
  key: string;
  label: string;
  placeholder?: string;
  span?: "full";
  secret?: boolean;
};

const channelModeSelectionOptions: Array<{ value: ModeSelection; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "manual", label: "手动" },
];

type ChannelTaskIntentSetting = "auto" | TaskIntent;

const channelTaskIntentOptions: Array<{ value: ChannelTaskIntentSetting; label: string }> = [
  { value: "auto", label: "自动判断" },
  { value: "chat", label: "对话" },
  { value: "plan", label: "计划" },
  { value: "implement", label: "实施" },
];

const channelPermissionModeOptions: Array<{ value: PermissionMode; label: string }> = [
  { value: "default", label: "默认" },
  { value: "auto_review", label: "自动审查" },
  { value: "full_access", label: "完全访问" },
];

const channelProviderTabs: Array<{
  id: ChannelProviderKind;
  label: string;
  title: string;
  description: string;
  runtimeImplemented: boolean;
  channelKind: ChannelKind;
  fields: ChannelConfigField[];
}> = [
  {
    id: "telegram",
    label: "Telegram",
    title: "Telegram",
    description: "通过 Telegram Bot API 轮询消息，并可限制允许访问的用户。",
    runtimeImplemented: false,
    channelKind: "telegram",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456:telegram-bot-token", secret: true },
      { key: "allowedUsers", label: "Allowed Users", placeholder: "可选，逗号分隔 Telegram user id", span: "full" },
    ],
  },
  {
    id: "discord",
    label: "Discord",
    title: "Discord",
    description: "通过 Discord Bot 接入服务器频道，并可限制允许访问的 Guild。",
    runtimeImplemented: false,
    channelKind: "discord",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "Discord bot token", secret: true },
      { key: "allowedGuilds", label: "Allowed Guilds", placeholder: "可选，逗号分隔 guild id", span: "full" },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    title: "Slack",
    description: "参照 DeerFlow Socket Mode：Bot Token + App Token，无需公开 webhook。",
    runtimeImplemented: false,
    channelKind: "slack",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-...", secret: true },
      { key: "appToken", label: "App Token", placeholder: "xapp-...", secret: true },
      { key: "allowedUsers", label: "Allowed Users", placeholder: "可选，逗号分隔 Slack user id", span: "full" },
    ],
  },
  {
    id: "feishu",
    label: "飞书",
    title: "飞书",
    description: "通过飞书机器人 Webhook 连接 Ora；同时保留 DeerFlow 长连接所需 App 配置位。",
    runtimeImplemented: true,
    channelKind: "feishu",
    fields: [
      { key: "webhookUrl", label: "Bot Webhook URL", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...", span: "full" },
      { key: "appId", label: "App ID", placeholder: "cli_..." },
      { key: "appSecret", label: "App Secret", placeholder: "可选，长连接模式使用", secret: true },
      { key: "verificationToken", label: "Verification Token", placeholder: "可选，用于事件校验", secret: true },
      { key: "signingSecret", label: "Signing Secret", placeholder: "可选，用于签名校验", secret: true },
      { key: "domain", label: "Domain", placeholder: "https://open.feishu.cn", span: "full" },
    ],
  },
  {
    id: "wechat",
    label: "WeChat",
    title: "WeChat",
    description: "通过扫描微信 QR 码绑定 iLink Bot，实现消息收发。",
    runtimeImplemented: true,
    channelKind: "wechat",
    fields: [
      { key: "allowedUsers", label: "Allowed Users", placeholder: "可选，逗号分隔用户 id" },
    ],
  },
  {
    id: "wecom",
    label: "WeCom",
    title: "WeCom",
    description: "企业微信智能机器人 WebSocket：Bot ID + Bot Secret，支持流式回复。",
    runtimeImplemented: false,
    channelKind: "wecom",
    fields: [
      { key: "botId", label: "Bot ID", placeholder: "企业微信 bot_id" },
      { key: "botSecret", label: "Bot Secret", placeholder: "企业微信 bot_secret", secret: true },
      { key: "workingMessage", label: "Working Message", placeholder: "Working on it...", span: "full" },
    ],
  },
  {
    id: "dingtalk",
    label: "DingTalk",
    title: "DingTalk",
    description: "钉钉机器人使用 Client ID/Secret 鉴权，可选 AI Card 模板支持状态更新。",
    runtimeImplemented: false,
    channelKind: "dingtalk",
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "DingTalk client_id" },
      { key: "clientSecret", label: "Client Secret", placeholder: "DingTalk client_secret", secret: true },
      { key: "allowedUsers", label: "Allowed Users", placeholder: "可选，逗号分隔用户 id" },
      { key: "cardTemplateId", label: "Card Template ID", placeholder: "可选，AI Card 模板 ID" },
    ],
  },
  {
    id: "http_webhook",
    label: "HTTP",
    title: "HTTP Webhook",
    description: "通用 HTTP 入站 Webhook，可选回调地址、Bearer Token 与 HMAC 签名。",
    runtimeImplemented: true,
    channelKind: "http_webhook",
    fields: [
      { key: "token", label: "Inbound Token", placeholder: "可选，Authorization Bearer 或 x-ora-channel-token", secret: true },
      { key: "signingSecret", label: "Signing Secret", placeholder: "可选，校验 x-ora-signature", secret: true },
      { key: "callbackUrl", label: "Callback URL", placeholder: "https://example.com/ora/callback", span: "full" },
      { key: "callbackToken", label: "Callback Token", placeholder: "可选，发送回调时使用", secret: true },
    ],
  },
];

interface SettingsViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function statusLabel(state: string) {
  switch (state) {
    case "verified":
      return "Verified";
    case "failed":
      return "Verification failed";
    case "key_stored":
      return "Key stored";
    case "needs_key":
      return "Needs key";
    default:
      return "Not configured";
  }
}

function statusClasses(state: string) {
  switch (state) {
    case "verified":
      return "bg-lime-50 text-bench-900 ring-lime-200";
    case "failed":
      return "bg-red-50 text-bench-900 ring-red-200";
    case "key_stored":
      return "bg-bench-50 text-bench-900 ring-bench-200";
    case "needs_key":
      return "bg-amber-50 text-bench-900 ring-amber-200";
    default:
      return "bg-bench-50 text-bench-900 ring-bench-200";
  }
}

function providerEnabledLabel(enabled: boolean, state: string) {
  if (enabled) {
    return state === "verified" ? "Enabled" : "Enabled";
  }
  return state === "verified" ? "Verified off" : "Disabled";
}

function providerTypeLabel(type: ProviderDraft["type"]) {
  switch (type) {
    case "anthropic":
      return "Anthropic";
    case "anthropic_compatible":
      return "Anthropic-compatible";
    case "openai":
      return "OpenAI";
    case "openai_compatible":
      return "OpenAI-compatible";
    case "local_smoke":
      return "Local";
  }
}

function memoryValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "summary" in value &&
    typeof value.summary === "string"
  ) {
    return value.summary;
  }
  return JSON.stringify(value, null, 2);
}

function memoryTimestamp(value: number): string {
  if (!Number.isFinite(value)) {
    return "unknown";
  }
  return new Date(value).toLocaleString();
}

interface ProviderModelOption {
  id: string;
  label: string;
  source: "remote" | "preset" | "saved" | "draft";
  authoritativeMissing?: boolean;
}

function memoryKindClasses(kind: string) {
  switch (kind) {
    case "project":
      return "bg-emerald-50 text-bench-900 ring-emerald-200";
    case "worker":
      return "bg-violet-50 text-bench-900 ring-violet-200";
    case "artifact":
      return "bg-bench-50 text-bench-900 ring-bench-200";
    case "profile":
      return "bg-amber-50 text-bench-900 ring-amber-200";
    default:
      return "bg-bench-50 text-bench-900 ring-bench-200";
  }
}

function buildChannelConfig(fields: ChannelConfigField[], draft: Record<string, string>) {
  return Object.fromEntries(
    fields
      .map((field) => [field.key, draft[field.key]?.trim() ?? ""] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function buildChannelRunConfig(
  provider: OraProviderConfig | undefined,
  defaults: {
    modeSelection: ModeSelection;
    modeId?: string;
    permissionMode: PermissionMode;
    taskIntent: ChannelTaskIntentSetting;
    metadata?: Record<string, unknown>;
  },
) {
  const metadata = { ...(defaults.metadata ?? {}) };
  delete metadata.taskIntent;
  delete metadata.taskIntentMode;
  const taskIntentMetadata = defaults.taskIntent === "auto"
    ? { taskIntentMode: "auto" }
    : { taskIntentMode: "fixed", taskIntent: defaults.taskIntent };
  return {
    modeSelection: defaults.modeSelection,
    ...(defaults.modeSelection === "manual" && defaults.modeId ? { modeId: defaults.modeId } : {}),
    permissionMode: defaults.permissionMode,
    metadata: { ...metadata, ...taskIntentMetadata },
    ...(provider ? {
      providerId: provider.id,
      modelRef: provider.modelId,
      providerConfig: provider,
    } : {}),
  };
}

function channelRunConfig(channel: OraChannelConfig | undefined): Record<string, unknown> {
  const candidate = channel?.config.runConfig;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : {};
}

function channelRunConfigMetadata(channel: OraChannelConfig | undefined): Record<string, unknown> {
  const metadata = channelRunConfig(channel).metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

function channelDraftValue(draft: Record<string, string>, key: string, fallback: unknown, defaultValue: string) {
  if (draft[key] !== undefined) {
    return draft[key];
  }
  return typeof fallback === "string" && fallback ? fallback : defaultValue;
}

function channelModeSelectionValue(value: string): ModeSelection {
  return value === "manual" ? "manual" : "auto";
}

function channelTaskIntentValue(value: string): ChannelTaskIntentSetting {
  return value === "chat" || value === "plan" || value === "implement" ? value : "auto";
}

function channelPermissionModeValue(value: string): PermissionMode {
  return value === "auto_review" || value === "full_access" ? value : "default";
}

function channelFieldPlaceholder(channel: OraChannelConfig | undefined, field: ChannelConfigField) {
  const value = channel?.config[field.key];
  if (value === "[redacted]") {
    return "已保存；留空保持不变";
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return field.placeholder ?? "可选";
}

function channelStateLabel(channel: OraChannelConfig | undefined, runtimeImplemented: boolean) {
  if (channel?.enabled) {
    return "运行中";
  }
  if (!channel) {
    return "未配置";
  }
  return runtimeImplemented ? "已配置" : "已保存，适配器待实现";
}

export function SettingsView({ open, onOpenChange }: SettingsViewProps) {
  const { state, dispatch } = useWorkbench();
  const { runtimeClient } = useRunActions();
  const providerSetup = useProviderSetup();
  const secretInputRef = useRef<HTMLInputElement>(null);
  const providerModelsRequestRef = useRef(0);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("general");
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [providerModelsResult, setProviderModelsResult] = useState<OraProviderModelsResult | undefined>();
  const [providerModelsLoading, setProviderModelsLoading] = useState(false);
  const [lastFetchedProviderModelsKey, setLastFetchedProviderModelsKey] = useState<string | undefined>();
  const [editingModelProviderId, setEditingModelProviderId] = useState<string | undefined>();
  const [editingOriginalModelId, setEditingOriginalModelId] = useState<string | undefined>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [searchSettings, setSearchSettings] = useState<DesktopSearchSettings>(
    () => loadDesktopSearchSettings(),
  );
  const [toolModelSettings, setToolModelSettings] = useState<DesktopToolModelSettings>(
    () => loadDesktopToolModelSettings(),
  );
  const [longTermMemory, setLongTermMemory] = useState<
    OraLongTermMemoryProfile | undefined
  >();
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | undefined>();
  const [channels, setChannels] = useState<OraChannelConfig[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | undefined>();
  const [selectedChannelProvider, setSelectedChannelProvider] =
    useState<ChannelProviderKind>("feishu");
  const [channelDraft, setChannelDraft] = useState<Record<string, string>>({ label: "" });

  const {
    actions,
    activePreset,
    buildProviderConfigForModel,
    canDeleteProvider,
    draftProviderStatus,
    draftSecretStatus,
    modelProviderByModelId,
    needsSecret,
    providerActionError,
    providerCatalog,
    providerDraft,
    providers,
    saveDisabled,
    selectedCatalogEntry,
    selectedProvider,
    selectedProviderKey,
    addCustomProvider,
    saveProviderSecret,
    selectProviderEntry,
    setProviderDraft,
    toggleCapability,
    updateDraft,
    verifyAndEnableProvider,
  } = providerSetup;
  const enabledToolModelProviders = useMemo(() => {
    return (state.providerRegistry?.providers ?? []).filter(
      (provider) => provider.enabled !== false && provider.type !== "local_smoke",
    );
  }, [state.providerRegistry?.providers]);

  const handleToolModelChange = (providerId: string) => {
    const next: DesktopToolModelSettings = { providerId };
    setToolModelSettings(next);
    saveDesktopToolModelSettings(next);
  };

  const filteredProviderCatalog = useMemo(() => {
    const query = providerSearch.trim().toLowerCase();
    if (!query) {
      return providerCatalog;
    }
    return providerCatalog.filter((entry) => {
      const draft = entry.draft;
      return [
        entry.label,
        entry.description,
        draft.type,
        draft.modelId,
        draft.baseUrl,
        draft.apiKeyEnv,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [providerCatalog, providerSearch]);

  const selectedChannelTab = useMemo(
    () =>
      channelProviderTabs.find((tab) => tab.id === selectedChannelProvider) ??
      channelProviderTabs[0],
    [selectedChannelProvider],
  );
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.kind === selectedChannelTab.channelKind),
    [channels, selectedChannelTab.channelKind],
  );
  const selectedChannelRunConfig = channelRunConfig(selectedChannel);
  const selectedChannelRunMetadata = channelRunConfigMetadata(selectedChannel);
  const channelModelProviders = useMemo(
    () => (state.providerRegistry?.providers ?? []).filter((provider) => provider.enabled !== false),
    [state.providerRegistry?.providers],
  );
  const channelProviderId = channelDraftValue(
    channelDraft,
    "runProviderId",
    selectedChannelRunConfig.providerId,
    selectedProvider?.id ?? channelModelProviders[0]?.id ?? "",
  );
  const selectedChannelRunProvider =
    channelModelProviders.find((provider) => provider.id === channelProviderId) ??
    (selectedProvider?.id === channelProviderId ? selectedProvider : undefined);
  const channelModeSelection = channelModeSelectionValue(
    channelDraftValue(channelDraft, "runModeSelection", selectedChannelRunConfig.modeSelection, "auto"),
  );
  const channelModeId = channelDraftValue(
    channelDraft,
    "runModeId",
    selectedChannelRunConfig.modeId,
    state.selectedModeId || state.modes[0]?.id || "",
  );
  const channelPermissionMode = channelPermissionModeValue(
    channelDraftValue(channelDraft, "runPermissionMode", selectedChannelRunConfig.permissionMode, "default"),
  );
  const selectedChannelTaskIntent =
    selectedChannelRunMetadata.taskIntentMode === "auto"
      ? "auto"
      : selectedChannelRunMetadata.taskIntent;
  const channelTaskIntent = channelTaskIntentValue(
    channelDraftValue(channelDraft, "runTaskIntent", selectedChannelTaskIntent, "auto"),
  );
  const selectedChannelStartedAt = selectedChannel
    ? new Date(selectedChannel.createdAt).toLocaleString()
    : "未启动";

  const memoryRecords = state.activeSnapshot?.memory ?? [];
  const longTermFacts = longTermMemory?.facts ?? [];
  const longTermSections = longTermMemory
    ? [
        { label: "Work Context", value: longTermMemory.user.workContext },
        {
          label: "Personal Context",
          value: longTermMemory.user.personalContext,
        },
        { label: "Top of Mind", value: longTermMemory.user.topOfMind },
        { label: "Recent Months", value: longTermMemory.history.recentMonths },
        {
          label: "Earlier Context",
          value: longTermMemory.history.earlierContext,
        },
        {
          label: "Long-term Background",
          value: longTermMemory.history.longTermBackground,
        },
      ].filter((section) => section.value.summary.trim().length > 0)
    : [];
  const memoryNamespaces = useMemo(() => {
    const namespaces = new Set<string>();
    for (const record of memoryRecords) {
      namespaces.add(record.namespace.join("/"));
    }
    for (const profile of state.activeSnapshot?.profiles ?? []) {
      for (const namespace of profile.memoryNamespaces) {
        namespaces.add(`${namespace}/${profile.id}`);
      }
    }
    return [...namespaces].sort((left, right) => left.localeCompare(right));
  }, [memoryRecords, state.activeSnapshot?.profiles]);

  useEffect(() => {
    if (!open || activeSection !== "memory") {
      return;
    }
    void loadMemory();
  }, [activeSection, open]);

  useEffect(() => {
    if (!open || activeSection !== "channels") {
      return;
    }
    void loadChannels();
  }, [activeSection, open]);

  const providerModelsKey = `${providerDraft.type}:${providerDraft.baseUrl}:${providerDraft.apiKeyEnv}:${providerDraft.id}`;
  const activeProviderModelsResult = lastFetchedProviderModelsKey === providerModelsKey ? providerModelsResult : undefined;
  const fetchedModelsAuthoritative = activeProviderModelsResult?.status === "ok" && activeProviderModelsResult.authoritative;
  const activeProviderModelIds = new Set(activeProviderModelsResult?.models.map((model) => model.id) ?? []);
  const modelSuggestions =
    activePreset.modelSuggestions.length > 0
      ? activePreset.modelSuggestions
      : [providerDraft.modelId];
  const modelOptions = useMemo<ProviderModelOption[]>(() => {
    const byId = new Map<string, ProviderModelOption>();
    const add = (option: ProviderModelOption) => {
      if (!option.id.trim() || byId.has(option.id)) {
        return;
      }
      byId.set(option.id, option);
    };

    if (activeProviderModelsResult?.status === "ok") {
      for (const model of activeProviderModelsResult.models) {
        add({
          id: model.id,
          label: activeProviderModelsResult.authoritative ? "Remote model" : "Preset suggestion",
          source: model.source === "preset" ? "preset" : "remote",
        });
      }
    }

    if (providerDraft.modelId.trim()) {
      const missing = fetchedModelsAuthoritative && !activeProviderModelIds.has(providerDraft.modelId.trim());
      add({
        id: providerDraft.modelId.trim(),
        label: missing ? "Not in provider list" : "Current draft",
        source: "draft",
        authoritativeMissing: missing,
      });
    }

    for (const provider of selectedCatalogEntry?.providers ?? []) {
      const missing = fetchedModelsAuthoritative && !activeProviderModelIds.has(provider.modelId);
      add({
        id: provider.modelId,
        label: provider.enabled !== false ? "Enabled model" : "Saved disabled",
        source: "saved",
        authoritativeMissing: missing,
      });
    }

    if (!fetchedModelsAuthoritative) {
      for (const modelId of modelSuggestions) {
        add({ id: modelId, label: activePreset.label, source: "preset" });
      }
    }

    return [...byId.values()];
  }, [activePreset.label, activeProviderModelIds, activeProviderModelsResult, fetchedModelsAuthoritative, modelSuggestions, providerDraft.modelId, selectedCatalogEntry]);
  const filteredModelOptions = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) {
      return modelOptions;
    }
    return modelOptions.filter((model) =>
      model.id.toLowerCase().includes(query),
    );
  }, [modelOptions, modelSearch]);
  const canUseModelSearch =
    modelSearch.trim().length > 0 &&
    !modelOptions.some(
      (model) => model.id.toLowerCase() === modelSearch.trim().toLowerCase(),
    );
  function clearModelFetchState() {
    setProviderModelsResult(undefined);
    setLastFetchedProviderModelsKey(undefined);
  }

  function handleSelectProviderEntry(entry: typeof providerCatalog[number]) {
    selectProviderEntry(entry);
    setEditingModelProviderId(undefined);
    setEditingOriginalModelId(undefined);
    clearModelFetchState();
    setModelSearch("");
    setAdvancedOpen(false);
  }

  function handleAddCustomProvider() {
    addCustomProvider();
    setEditingModelProviderId(undefined);
    setEditingOriginalModelId(undefined);
    clearModelFetchState();
    setModelSearch("");
    setAdvancedOpen(false);
  }

  function saveSecret() {
    if (!secretInputRef.current) return;
    const secret = secretInputRef.current.value.trim();
    if (!secret) return;
    void saveProviderSecret(secret);
    secretInputRef.current.value = "";
  }

  async function fetchModels() {
    setProviderModelsLoading(true);
    const requestId = ++providerModelsRequestRef.current;
    const key = providerModelsKey;
    setLastFetchedProviderModelsKey(key);
    try {
      const result = await runtimeClient.listProviderModels(buildProviderConfigFromDraft(providerDraft));
      if (requestId === providerModelsRequestRef.current) {
        setProviderModelsResult(result);
      }
    } catch (error) {
      if (requestId === providerModelsRequestRef.current) {
        setProviderModelsResult({
          models: [],
          status: "error",
          authoritative: false,
          message: error instanceof Error ? error.message : "Failed to fetch provider models.",
          fetchedAt: new Date().toISOString(),
        });
      }
    } finally {
      if (requestId === providerModelsRequestRef.current) {
        setProviderModelsLoading(false);
      }
    }
  }

  function editModel(modelId: string) {
    const modelProvider = modelProviderByModelId.get(modelId);
    if (modelProvider) {
      setProviderDraft(createDraftFromProvider(modelProvider));
      setEditingModelProviderId(modelProvider.id);
      setEditingOriginalModelId(modelProvider.modelId);
    } else {
      const provider = buildProviderConfigForModel(modelId, false);
      setProviderDraft(createDraftFromProvider(provider));
      setEditingModelProviderId(provider.id);
      setEditingOriginalModelId(modelId);
    }
    setModelSearch("");
    setAdvancedOpen(true);
  }

  async function saveProviderDetails() {
    const oldProviderId = editingModelProviderId ?? providerDraft.id;
    const baseProviderId = getModelProviderBaseId(oldProviderId);
    const newModelId = providerDraft.modelId.trim();
    const newProviderId = newModelId === activePreset.defaultModelId
      ? baseProviderId
      : createModelProviderId(baseProviderId, newModelId);
    const conflict = providers.some((provider) => provider.id === newProviderId && provider.id !== oldProviderId);
    if (conflict) {
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback: `Provider ${newProviderId} already exists. Choose a different model ID.`,
      });
      return;
    }

    const provider = buildProviderConfigFromDraft({
      ...providerDraft,
      id: newProviderId,
      modelId: newModelId,
    });
    await actions.upsertCustomProvider(provider, {
      select: provider.enabled !== false,
      replacementForProviderId: oldProviderId,
    });
    if (oldProviderId !== newProviderId) {
      await actions.deleteCustomProvider(oldProviderId, {
        replacementProviderId: provider.enabled !== false ? newProviderId : undefined,
        deleteSecret: false,
      });
    }
    setEditingModelProviderId(newProviderId);
    setEditingOriginalModelId(newModelId);
    setProviderDraft(createDraftFromProvider(provider));
  }

  function disableProvider() {
    const disabledProvider = buildProviderConfigForModel(
      providerDraft.modelId,
      false,
    );
    updateDraft({ enabled: false });
    void actions.upsertCustomProvider(disabledProvider, { select: false });
  }

  function addCustomModel() {
    const modelId = modelSearch.trim();
    if (!modelId) {
      return;
    }
    updateDraft({ modelId, enabled: false });
    setModelSearch("");
    void actions.upsertCustomProvider(buildProviderConfigForModel(modelId, false), { select: false });
  }

  async function enableModel(modelId: string) {
    const provider = buildProviderConfigForModel(modelId, true);
    const status = await actions.verifyProvider(provider);
    if (status?.state !== "verified") {
      updateDraft({ modelId, enabled: false });
      return;
    }
    updateDraft({ modelId, enabled: true });
    void actions.upsertCustomProvider(provider, { select: true });
  }

  function disableModel(modelId: string) {
    const provider = buildProviderConfigForModel(modelId, false);
    updateDraft({ modelId, enabled: false });
    void actions.upsertCustomProvider(provider, { select: false });
  }

  function updateSearchSettings(patch: Partial<DesktopSearchSettings>) {
    setSearchSettings((current) => ({ ...current, ...patch }));
  }

  function saveSearchSettings() {
    saveDesktopSearchSettings(searchSettings);
    dispatch({
      type: "SET_COMMAND_FEEDBACK",
      feedback: "Web search settings saved for future turns.",
    });
  }

  function resetSearchSettings() {
    setSearchSettings(DEFAULT_SEARCH_SETTINGS);
    saveDesktopSearchSettings(DEFAULT_SEARCH_SETTINGS);
    dispatch({
      type: "SET_COMMAND_FEEDBACK",
      feedback: "Web search settings reset to auto.",
    });
  }


  async function loadChannels() {
    setChannelsLoading(true);
    setChannelsError(undefined);
    try {
      setChannels(await runtimeClient.listChannels());
    } catch (error) {
      setChannelsError(error instanceof Error ? error.message : String(error));
    } finally {
      setChannelsLoading(false);
    }
  }

  async function saveSelectedChannel(nextEnabled = true) {
    const label = channelDraft.label?.trim() || selectedChannel?.label || selectedChannelTab.title;
    const runConfig = buildChannelRunConfig(selectedChannelRunProvider, {
      modeSelection: channelModeSelection,
      modeId: channelModeId,
      permissionMode: channelPermissionMode,
      taskIntent: channelTaskIntent,
      metadata: selectedChannelRunMetadata,
    });
    const config = {
      ...buildChannelConfig(selectedChannelTab.fields, channelDraft),
      runConfig,
    };
    const enabled = selectedChannelTab.runtimeImplemented ? nextEnabled : false;
    try {
      if (selectedChannel) {
        await runtimeClient.updateChannel({
          channelId: selectedChannel.channelId,
          label,
          enabled,
          config,
        });
      } else {
        await runtimeClient.createChannel({
          label,
          kind: selectedChannelTab.channelKind,
          enabled,
          config,
          secretRefs: {},
        });
      }
      setChannelDraft({ label: "" });
      await loadChannels();
    } catch (error) {
      setChannelsError(error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleSelectedChannel() {
    if (!selectedChannelTab.runtimeImplemented) {
      return;
    }
    if (!selectedChannel) {
      await saveSelectedChannel(true);
      return;
    }
    try {
      await runtimeClient.updateChannel({ channelId: selectedChannel.channelId, enabled: !selectedChannel.enabled });
      await loadChannels();
    } catch (error) {
      setChannelsError(error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleChannel(channel: OraChannelConfig) {
    try {
      await runtimeClient.updateChannel({ channelId: channel.channelId, enabled: !channel.enabled });
      await loadChannels();
    } catch (error) {
      setChannelsError(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteChannel(channelId: string) {
    try {
      await runtimeClient.deleteChannel(channelId);
      await loadChannels();
    } catch (error) {
      setChannelsError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadMemory() {
    setMemoryLoading(true);
    setMemoryError(undefined);
    try {
      setLongTermMemory(await runtimeClient.getMemory());
    } catch (error) {
      setMemoryError(
        error instanceof Error ? error.message : "Failed to load memory.",
      );
    } finally {
      setMemoryLoading(false);
    }
  }

  async function clearMemory() {
    setMemoryLoading(true);
    setMemoryError(undefined);
    try {
      setLongTermMemory(await runtimeClient.clearMemory());
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback: "Long-term memory cleared.",
      });
    } catch (error) {
      setMemoryError(
        error instanceof Error ? error.message : "Failed to clear memory.",
      );
    } finally {
      setMemoryLoading(false);
    }
  }

  const webSearchSection = (
    <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Web Search</h3>
          <p className="mt-2 text-sm leading-6 text-bench-700">
            Runtime tool: web.search and web.fetch. Provider-native browsing is
            not required.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            updateSearchSettings({
              enabled: !searchSettings.enabled,
            })
          }
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition",
            searchSettings.enabled
              ? "bg-bench-900 text-white ring-bench-900"
              : "bg-white text-bench-700 ring-bench-200 hover:bg-bench-50",
          )}
        >
          {searchSettings.enabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
            Search Provider
          </span>
          <Select
            aria-label="Search Provider"
            value={searchSettings.providerId}
            disabled={!searchSettings.enabled}
            onChange={(event) =>
              updateSearchSettings({
                providerId: event.target.value as DesktopSearchProviderId,
              })
            }
            className="h-11 bg-bench-50"
          >
            {searchProviderOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
            API Key Env
          </span>
          <input
            value={searchSettings.apiKeyEnv}
            disabled={
              !searchSettings.enabled ||
              searchSettings.providerId === "duckduckgo" ||
              searchSettings.providerId === "mcp"
            }
            onChange={(event) =>
              updateSearchSettings({
                apiKeyEnv: event.target.value.toUpperCase(),
              })
            }
            placeholder={
              searchSettings.providerId === "auto"
                ? "Use provider default env"
                : `${searchSettings.providerId.toUpperCase()}_API_KEY`
            }
            className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
            Max Results
          </span>
          <input
            value={searchSettings.maxResults}
            disabled={!searchSettings.enabled}
            onChange={(event) =>
              updateSearchSettings({
                maxResults: event.target.value,
              })
            }
            className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
            Timeout Ms
          </span>
          <input
            value={searchSettings.timeoutMs}
            disabled={!searchSettings.enabled}
            onChange={(event) =>
              updateSearchSettings({
                timeoutMs: event.target.value,
              })
            }
            className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        {searchSettings.providerId === "mcp" && (
          <>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                MCP Server ID
              </span>
              <input
                value={searchSettings.mcpServerId}
                disabled={!searchSettings.enabled}
                onChange={(event) =>
                  updateSearchSettings({
                    mcpServerId: event.target.value,
                  })
                }
                placeholder="local-docs"
                className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                MCP Tool Name
              </span>
              <input
                value={searchSettings.mcpToolName}
                disabled={!searchSettings.enabled}
                onChange={(event) =>
                  updateSearchSettings({
                    mcpToolName: event.target.value,
                  })
                }
                placeholder="search"
                className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </>
        )}
      </div>

      <div className="mt-5 rounded-2xl bg-bench-50 px-4 py-3 text-xs leading-5 text-bench-700 ring-1 ring-inset ring-bench-200">
        Auto checks `ORA_SEARCH_PROVIDER`, then configured provider API key env
        vars, then DuckDuckGo fallback. MCP search uses configured MCP servers
        and requires approval because it calls an MCP tool.
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          onClick={resetSearchSettings}
        >
          Reset
        </Button>
        <Button
          type="button"
          className="rounded-xl"
          onClick={saveSearchSettings}
        >
          Save Search Settings
        </Button>
      </div>
    </section>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,860px)] w-[min(1120px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px] border border-black/[0.03] bg-background p-0 shadow-lift">
        <div className="flex items-start justify-between gap-4 border-b border-border/80 bg-sidebar/90 px-6 py-5">
          <div>
            <h2 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-bench-700">
              Settings
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-bench-200 bg-white text-bench-700 shadow-xs transition hover:bg-bench-50 hover:text-bench-900 active:scale-95"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-background lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="border-b border-border bg-sidebar/75 p-3 lg:border-b-0 lg:border-r lg:p-4">
            <div className="overflow-x-auto rounded-[22px] bg-white/72 p-2 shadow-xs ring-1 ring-inset ring-bench-200/85">
              <nav className="flex gap-1.5 lg:block lg:space-y-1.5">
                {settingsSections.map((section) => {
                  const Icon = section.icon;
                  const active = section.id === activeSection;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        "flex shrink-0 items-start gap-2 rounded-2xl px-3 py-2.5 text-left transition active:scale-[0.99] lg:w-full lg:gap-3 lg:py-3",
                        active
                          ? "bg-bench-900 text-white shadow-xs"
                          : "text-bench-700 hover:bg-bench-50 hover:text-bench-900",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition",
                          active
                            ? "border-white/10 bg-white/10 text-white"
                            : "border-bench-200 bg-white text-bench-700",
                        )}
                      >
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="block whitespace-nowrap text-sm font-semibold">
                          {section.label}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto overscroll-contain bg-background px-5 py-5 lg:px-6 lg:py-6">
            <div className="space-y-6">
              {activeSection === "general" && (
                <>
                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <Globe2 size={18} />
                          <h3 className="text-sm font-semibold">Language</h3>
                        </div>
                      </div>
                      <div className="inline-flex rounded-xl bg-bench-50 p-1 ring-1 ring-inset ring-bench-200">
                        {LANGUAGE_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() =>
                              dispatch({
                                type: "SET_LANGUAGE",
                                language: option.id,
                              })
                            }
                            className={cn(
                              "h-9 rounded-lg px-3 text-sm font-semibold transition",
                              state.language === option.id
                                ? "bg-bench-900 text-white shadow-xs"
                                : "text-bench-700 hover:bg-white",
                            )}
                            aria-pressed={state.language === option.id}
                          >
                            {option.nativeLabel}
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Zap size={18} />
                          <h3 className="text-sm font-semibold">工具模型</h3>
                        </div>
                        <p className="mt-1 text-xs text-bench-500">
                          为模式路由、标题生成、记忆提取等后台流程选用更快的模型
                        </p>
                      </div>
                      <Select
                        value={toolModelSettings.providerId}
                        onChange={(e) => handleToolModelChange((e.target as HTMLSelectElement).value)}
                        className="min-w-[220px]"
                      >
                        <option value="auto">跟随主模型</option>
                        {enabledToolModelProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label} / {provider.modelId}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </section>
                </>
              )}

              {activeSection === "providers" && (
                <section className="grid overflow-hidden rounded-[22px] bg-card shadow-pane ring-1 ring-inset ring-bench-200 lg:min-h-[640px] lg:grid-cols-[260px_minmax(0,1fr)]">
                  <div className="flex h-[360px] min-h-0 flex-col border-b border-bench-200 bg-sidebar/70 p-4 lg:h-auto lg:border-b-0 lg:border-r">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Bot size={18} />
                        <h3 className="truncate text-sm font-semibold">
                          Providers
                        </h3>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="Add custom provider"
                        className="rounded-lg bg-white"
                        onClick={handleAddCustomProvider}
                      >
                        <Plus size={14} />
                      </Button>
                    </div>

                    <label className="relative mt-4 block">
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bench-700"
                      />
                      <input
                        value={providerSearch}
                        onChange={(event) =>
                          setProviderSearch(event.target.value)
                        }
                        placeholder="Search providers..."
                        className="h-10 w-full rounded-xl border border-bench-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-bench-900"
                      />
                    </label>

                    <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                      {filteredProviderCatalog.map((entry) => {
                        const draft = entry.draft;
                        const active =
                          selectedProviderKey === entry.key ||
                          providerDraft.id === draft.id;
                        const entryStatus = state.providerStatuses.find(
                          (status) => status.providerId === draft.id,
                        );
                        const entrySecretStatus =
                          state.providerSecretStatuses.find(
                            (status) => status.providerId === draft.id,
                          );
                        const ready =
                          draft.type === "local_smoke" ||
                          (draft.enabled &&
                            Boolean(entrySecretStatus?.hasSecret));
                        const stateText =
                          draft.type === "local_smoke"
                            ? "Ready"
                            : draft.enabled
                              ? "Enabled"
                              : entrySecretStatus?.hasSecret
                                ? "Key saved"
                                : entry.saved
                                  ? "Saved"
                                  : "Preset";
                        return (
                          <button
                            key={entry.key}
                            type="button"
                            aria-label={`${entry.label} ${entryStatus?.state === "failed" ? "failed" : stateText}`}
                            onClick={() => handleSelectProviderEntry(entry)}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
                              active
                                ? "border-bench-900/60 bg-white shadow-xs"
                                : "border-bench-200 bg-white/72 hover:border-bench-300 hover:bg-white",
                            )}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bench-50 text-[11px] font-bold text-bench-700 ring-1 ring-inset ring-bench-200">
                              {entry.preset.iconLabel}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-sm font-semibold text-bench-900">
                                  {entry.label}
                                </span>
                                {entry.preset.isRecommended && (
                                  <Zap
                                    size={12}
                                    className="shrink-0 text-signal-amber"
                                  />
                                )}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              {ready ? (
                                <CheckCircle2
                                  size={14}
                                  className="text-lime-600"
                                />
                              ) : (
                                <Circle size={12} className="text-bench-300" />
                              )}
                            </span>
                          </button>
                        );
                      })}
                      {filteredProviderCatalog.length === 0 && (
                        <div className="rounded-xl bg-white/72 px-3 py-4 text-sm text-bench-700 ring-1 ring-inset ring-bench-200">
                          No providers match that search.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="min-h-0 overflow-y-auto p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-xl font-semibold text-bench-900">
                            {providerDraft.label || activePreset.label}
                          </h3>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                              statusClasses(draftProviderStatus.state),
                            )}
                          >
                            {statusLabel(draftProviderStatus.state)}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                              providerDraft.enabled
                                ? "bg-lime-50 text-bench-900 ring-lime-200"
                                : "bg-white text-bench-700 ring-bench-200",
                            )}
                          >
                            {providerEnabledLabel(
                              providerDraft.enabled,
                              draftProviderStatus.state,
                            )}
                          </span>
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-bench-700">
                          {selectedCatalogEntry?.description ??
                            activePreset.description}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-bench-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700 ring-1 ring-inset ring-bench-200">
                            {providerTypeLabel(providerDraft.type)}
                          </span>
                          {providerDraft.type === "openai_compatible" && (
                            <span className="rounded-full bg-bench-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700 ring-1 ring-inset ring-bench-200">
                              {providerDraft.protocol === "responses"
                                ? "Responses API"
                                : "Chat Completions"}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {activePreset.apiKeyUrl && (
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-xl bg-white"
                            asChild
                          >
                            <a
                              href={activePreset.apiKeyUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <KeyRound size={15} />
                              API Keys
                              <ExternalLink size={13} />
                            </a>
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl bg-white"
                          onClick={disableProvider}
                          disabled={
                            !providerDraft.enabled ||
                            state.busyCommand !== undefined
                          }
                        >
                          <Power size={15} />
                          Disable
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl bg-bench-50/70 px-4 py-3 text-xs leading-5 text-bench-700 ring-1 ring-inset ring-bench-200">
                      {providerActionError ?? draftProviderStatus.detail}
                    </div>

                    <div className="mt-5 grid gap-4">
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                          Provider Name
                        </span>
                        <input
                          value={providerDraft.label}
                          onChange={(event) =>
                            updateDraft({ label: event.target.value })
                          }
                          placeholder="Provider name"
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                        />
                      </label>

                      {canEditBaseUrl(providerDraft.type) && (
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                            {providerDraft.type === "openai" ||
                            providerDraft.type === "anthropic"
                              ? "Base URL (optional)"
                              : "Base URL"}
                          </span>
                          <input
                            value={providerDraft.baseUrl}
                            onChange={(event) =>
                              updateDraft({ baseUrl: event.target.value })
                            }
                            placeholder={
                              providerDraft.type === "openai_compatible"
                                ? "https://provider.example/v1"
                                : providerDraft.type === "anthropic_compatible"
                                  ? "https://provider.example"
                                  : "https://api.provider.com"
                            }
                            className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                          />
                        </label>
                      )}
                    </div>

                    <div className="mt-5 rounded-[18px] bg-bench-50/70 p-4 ring-1 ring-inset ring-bench-200">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-bench-900">
                            API Key
                          </h4>
                          <p className="mt-1 text-xs text-bench-700">
                            Stored in the runtime layer and Keychain.
                          </p>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                            statusClasses(draftProviderStatus.state),
                          )}
                        >
                          {needsSecret
                            ? draftSecretStatus?.hasSecret
                              ? "Key ready"
                              : "Key needed"
                            : "Local"}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <input
                          ref={secretInputRef}
                          type="password"
                          disabled={
                            !needsSecret || state.busyCommand !== undefined
                          }
                          placeholder={
                            needsSecret
                              ? `${providerDraft.label || "Provider"} API key`
                              : "No key required for local smoke"
                          }
                          className="h-11 min-w-0 rounded-xl border border-bench-200 bg-white px-3 text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <Button
                          type="button"
                          className="h-11 rounded-xl px-4"
                          onClick={saveSecret}
                          disabled={
                            !needsSecret || state.busyCommand !== undefined
                          }
                        >
                          <Save size={15} />
                          Save Key
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl bg-white px-4"
                          onClick={() =>
                            void actions.deleteProviderSecret(providerDraft.id)
                          }
                          disabled={
                            !needsSecret ||
                            state.busyCommand !== undefined ||
                            !draftSecretStatus?.hasSecret
                          }
                        >
                          <Trash2 size={15} />
                          Remove
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5 rounded-[18px] bg-bench-50/70 p-4 ring-1 ring-inset ring-bench-200">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-bench-900">
                            Models
                          </h4>
                          <p className="mt-1 text-xs text-bench-700">
                            Enable one or more models for this provider. Enter a
                            custom model ID when it is not listed.
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 font-mono text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                          {providerDraft.modelId}
                        </span>
                      </div>
                      {editingOriginalModelId && (
                        <p className="mt-2 text-xs text-bench-700">
                          Editing: <span className="font-mono">{editingOriginalModelId}</span>
                          {editingOriginalModelId !== providerDraft.modelId.trim()
                            ? ` · Saving will replace ${editingOriginalModelId} with ${providerDraft.modelId.trim() || "new model"}.`
                            : ""}
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <label className="relative block min-w-[220px] flex-1">
                          <Search
                            size={15}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bench-700"
                          />
                          <input
                            value={modelSearch}
                            onChange={(event) =>
                              setModelSearch(event.target.value)
                            }
                            placeholder="Search or enter model ID..."
                            className="h-10 w-full rounded-xl border border-bench-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-bench-900"
                          />
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 rounded-xl bg-white"
                          onClick={addCustomModel}
                          disabled={
                            !canUseModelSearch ||
                            state.busyCommand !== undefined
                          }
                        >
                          <Plus size={14} />
                          Add model
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 rounded-xl bg-white"
                          onClick={() => void fetchModels()}
                          disabled={providerModelsLoading || state.busyCommand !== undefined}
                        >
                          <Zap size={14} />
                          {providerModelsLoading ? "Fetching..." : "Fetch models"}
                        </Button>
                      </div>

                      {providerModelsResult && (
                        <p className="mt-3 text-xs text-bench-700">
                          {providerModelsResult.status === "unsupported"
                            ? "Provider does not expose model discovery."
                            : providerModelsResult.status === "error"
                              ? providerModelsResult.message ?? "Failed to fetch provider models."
                              : providerModelsResult.authoritative
                                ? `Fetched ${providerModelsResult.models.length} remote models.`
                                : providerModelsResult.message ?? "Showing fallback model suggestions."}
                          {lastFetchedProviderModelsKey && lastFetchedProviderModelsKey !== providerModelsKey ? " Provider details changed after the last fetch." : ""}
                        </p>
                      )}

                      <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-bench-200 bg-white">
                        {filteredModelOptions.map((modelOption) => {
                          const modelId = modelOption.id;
                          const selected = providerDraft.modelId === modelId;
                          const modelProvider =
                            modelProviderByModelId.get(modelId);
                          const enabled = modelProvider
                            ? modelProvider.enabled !== false
                            : selected && providerDraft.enabled;
                          return (
                            <div
                              key={modelId}
                              className={cn(
                                "flex w-full items-center justify-between gap-3 border-b border-bench-100 last:border-b-0 transition hover:bg-bench-50",
                                selected && "bg-bench-50",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  updateDraft({ modelId, enabled });
                                  setModelSearch("");
                                }}
                                className="min-w-0 flex-1 px-3 py-2.5 text-left"
                              >
                                <span className="block truncate font-mono text-sm text-bench-900">
                                  {modelId}
                                </span>
                                <span className="mt-0.5 block text-xs text-bench-700">
                                  {modelOption.authoritativeMissing ? "Not in provider list" : enabled ? "Enabled model" : modelProvider ? "Saved disabled" : modelOption.label}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => editModel(modelId)}
                                className="rounded-lg px-2 py-1 text-xs font-semibold text-bench-700 transition hover:bg-bench-100"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                aria-label={
                                  enabled
                                    ? `Disable ${modelId}`
                                    : `Verify and enable ${modelId}`
                                }
                                onClick={() => {
                                  if (enabled) {
                                    disableModel(modelId);
                                  } else {
                                    void enableModel(modelId);
                                  }
                                }}
                                disabled={state.busyCommand !== undefined}
                                className="mr-3 inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <span
                                  className={cn(
                                    "inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition",
                                    enabled ? "bg-bench-900" : "bg-bench-200",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "h-5 w-5 rounded-full bg-white shadow-xs transition",
                                      enabled && "translate-x-4",
                                    )}
                                  />
                                </span>
                              </button>
                            </div>
                          );
                        })}
                        {canUseModelSearch && (
                          <button
                            type="button"
                            onClick={addCustomModel}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-bench-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-sm text-bench-900">
                                {modelSearch.trim()}
                              </span>
                              <span className="mt-0.5 block text-xs text-bench-700">
                                Use custom model ID
                              </span>
                            </span>
                            <Plus
                              size={15}
                              className="shrink-0 text-bench-700"
                            />
                          </button>
                        )}
                        {filteredModelOptions.length === 0 &&
                          !canUseModelSearch && (
                            <div className="px-3 py-4 text-sm text-bench-700">
                              No models match that search.
                            </div>
                          )}
                      </div>
                    </div>

                    <div className="mt-5">
                      <button
                        type="button"
                        onClick={() => setAdvancedOpen((current) => !current)}
                        className="flex w-full items-center justify-between rounded-2xl border border-bench-200 bg-bench-50/75 px-4 py-3 text-left transition hover:bg-white"
                      >
                        <span>
                          <span className="block text-sm font-semibold text-bench-900">
                            Advanced
                          </span>
                          <span className="mt-1 block text-xs text-bench-700">
                            Protocol, environment variable, limits,
                            capabilities, drop params, and headers.
                          </span>
                        </span>
                        {advancedOpen ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )}
                      </button>

                      {advancedOpen && (
                        <div className="mt-3 space-y-4 rounded-[18px] bg-bench-50/60 p-4 ring-1 ring-inset ring-bench-200">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                                API Key Env
                              </span>
                              <input
                                value={providerDraft.apiKeyEnv}
                                onChange={(event) =>
                                  updateDraft({
                                    apiKeyEnv: event.target.value.toUpperCase(),
                                  })
                                }
                                placeholder="OPENAI_API_KEY"
                                className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>

                            {providerDraft.type === "openai_compatible" && (
                              <label className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                                  Protocol
                                </span>
                                <Select
                                  aria-label="Protocol"
                                  value={providerDraft.protocol}
                                  onChange={(event) =>
                                    updateDraft({
                                      protocol: event.target
                                        .value as ProviderDraft["protocol"],
                                    })
                                  }
                                  className="h-11 bg-white"
                                >
                                  <option value="chat_completions">
                                    Chat Completions
                                  </option>
                                  <option value="responses">Responses</option>
                                </Select>
                              </label>
                            )}

                            {(providerDraft.type === "anthropic" ||
                              providerDraft.type ===
                                "anthropic_compatible") && (
                              <label className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                                  Anthropic Version
                                </span>
                                <input
                                  value={providerDraft.anthropicVersion}
                                  onChange={(event) =>
                                    updateDraft({
                                      anthropicVersion: event.target.value,
                                    })
                                  }
                                  placeholder="2023-06-01"
                                  className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                                />
                              </label>
                            )}

                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                                Max Output Tokens
                              </span>
                              <input
                                value={providerDraft.maxTokens}
                                onChange={(event) =>
                                  updateDraft({ maxTokens: event.target.value })
                                }
                                placeholder="8192"
                                className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>

                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                                Temperature
                              </span>
                              <input
                                value={providerDraft.temperature}
                                onChange={(event) =>
                                  updateDraft({
                                    temperature: event.target.value,
                                  })
                                }
                                placeholder="0.2"
                                className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>

                            <label className="space-y-2 lg:col-span-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                                Drop Params
                              </span>
                              <input
                                value={providerDraft.dropParams}
                                onChange={(event) =>
                                  updateDraft({
                                    dropParams: event.target.value,
                                  })
                                }
                                placeholder="temperature, top_p"
                                className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>

                            <label className="space-y-2 lg:col-span-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                                Headers
                              </span>
                              <textarea
                                value={providerDraft.headersText}
                                onChange={(event) =>
                                  updateDraft({
                                    headersText: event.target.value,
                                  })
                                }
                                placeholder={
                                  "Header-Name: value\nanthropic-beta: prompt-caching-2024-07-31"
                                }
                                className="min-h-28 w-full rounded-2xl border border-bench-200 bg-white px-3 py-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>
                          </div>

                          <div>
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                              Capabilities
                            </span>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {capabilityOptions.map((capability) => {
                                const active =
                                  providerDraft.capabilities.includes(
                                    capability.id,
                                  );
                                return (
                                  <button
                                    key={capability.id}
                                    type="button"
                                    onClick={() =>
                                      toggleCapability(capability.id)
                                    }
                                    className={cn(
                                      "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition",
                                      active
                                        ? "bg-bench-900 text-white ring-bench-900"
                                        : "bg-white text-bench-700 ring-bench-200 hover:bg-bench-50",
                                    )}
                                  >
                                    {capability.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <p className="text-xs text-bench-700">
                            Provider id:{" "}
                            <span className="font-mono">
                              {providerDraft.id}
                            </span>
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-bench-200 pt-5">
                      <p className="text-xs text-bench-700">
                        {selectedCatalogEntry?.saved
                          ? "Saved provider"
                          : "Preset draft"}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl bg-white"
                          onClick={saveProviderDetails}
                          disabled={saveDisabled}
                        >
                          <Save size={15} />
                          Save Details
                        </Button>
                        <Button
                          type="button"
                          className="rounded-xl"
                          onClick={() => void verifyAndEnableProvider()}
                          disabled={saveDisabled}
                        >
                          <CheckCircle2 size={15} />
                          Verify & Enable
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl bg-white"
                          onClick={() =>
                            void actions.deleteCustomProvider(providerDraft.id)
                          }
                          disabled={
                            !canDeleteProvider ||
                            state.busyCommand !== undefined
                          }
                        >
                          <Trash2 size={15} />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activeSection === "runtime" && state.bridgeStatus && (
                <>
                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <h3 className="text-sm font-semibold">Status</h3>
                    <div className="mt-5 rounded-2xl bg-bench-50 p-4 ring-1 ring-inset ring-bench-200">
                      <div className="flex items-center gap-2 text-sm">
                        <span
                          className={cn(
                            "h-2.5 w-2.5 rounded-full",
                            state.bridgeStatus.ok
                              ? "bg-signal-acid"
                              : "bg-red-500",
                          )}
                        />
                        <span className="font-semibold">
                          {state.bridgeStatus.label}
                        </span>
                        <span className="text-bench-700">
                          {state.bridgeStatus.detail}
                        </span>
                      </div>
                      {state.busyCommand && (
                        <p className="mt-3 text-xs text-bench-700">
                          {state.busyCommand} in progress.
                        </p>
                      )}
                    </div>
                  </section>

                  <section className="h-[680px] min-h-[520px] max-h-[calc(88vh-9rem)] overflow-hidden rounded-[22px] bg-card shadow-pane ring-1 ring-inset ring-bench-200">
                    <ProjectSignalsView
                      runtimeClient={runtimeClient}
                      bridgeStatus={state.bridgeStatus}
                      onOpenEvidence={() => onOpenChange(false)}
                    />
                  </section>
                </>
              )}

              {activeSection === "memory" && (
                <>
                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <Database size={18} />
                          <h3 className="text-sm font-semibold">Memory</h3>
                        </div>
                        <p className="text-sm leading-6 text-bench-700">
                          Long-term memory is persisted across runs, summarized
                          into profile sections, and injected into future
                          prompts when relevant.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                          {longTermFacts.length} facts
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 rounded-xl px-3 text-xs"
                          onClick={loadMemory}
                          disabled={memoryLoading}
                        >
                          Refresh
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 rounded-xl px-3 text-xs"
                          onClick={clearMemory}
                          disabled={memoryLoading || !longTermMemory}
                        >
                          Clear Memory
                        </Button>
                      </div>
                    </div>

                    {memoryError && (
                      <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-bench-900 ring-1 ring-inset ring-red-200">
                        {memoryError}
                      </p>
                    )}

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl bg-bench-50/80 px-4 py-3 ring-1 ring-inset ring-bench-200">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                          Last updated
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-bench-900">
                          {longTermMemory?.lastUpdated ??
                            (memoryLoading
                              ? "Loading memory..."
                              : "No long-term memory loaded")}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-bench-50/80 px-4 py-3 ring-1 ring-inset ring-bench-200">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                          Selected run
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-bench-900">
                          {state.activeSnapshot?.runId ??
                            "No active run selected"}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <h3 className="text-sm font-semibold">Memory Profile</h3>
                    {longTermSections.length > 0 ? (
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {longTermSections.map((section) => (
                          <article
                            key={section.label}
                            className="rounded-2xl bg-bench-50 px-4 py-4 ring-1 ring-inset ring-bench-200"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-sm font-semibold text-bench-900">
                                {section.label}
                              </h4>
                              {section.value.updatedAt && (
                                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-bench-700 ring-1 ring-inset ring-bench-200">
                                  {section.value.updatedAt}
                                </span>
                              )}
                            </div>
                            <p className="mt-3 text-sm leading-6 text-bench-700">
                              {section.value.summary}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-5 rounded-2xl bg-bench-50 px-4 py-5 text-sm text-bench-700 ring-1 ring-inset ring-bench-200">
                        <p className="font-semibold text-bench-900">
                          No long-term memory profile yet.
                        </p>
                        <p className="mt-2 leading-6">
                          Ora records durable memory from explicit preferences,
                          corrections, goals, and reinforced working patterns.
                        </p>
                      </div>
                    )}
                  </section>

                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <h3 className="text-sm font-semibold">Memory Facts</h3>
                    {longTermFacts.length > 0 ? (
                      <div className="mt-5 space-y-3">
                        {longTermFacts.map((fact) => (
                          <article
                            key={fact.id}
                            className="rounded-2xl bg-bench-50 px-4 py-4 ring-1 ring-inset ring-bench-200"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-all font-mono text-xs font-semibold text-bench-900">
                                  {fact.id}
                                </p>
                                <p className="mt-1 break-all font-mono text-[11px] text-bench-700">
                                  source: {fact.source}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                <span
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                                    memoryKindClasses(fact.category),
                                  )}
                                >
                                  {fact.category}
                                </span>
                                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                                  {Math.round(fact.confidence * 100)}%
                                </span>
                              </div>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-bench-900">
                              {fact.content}
                            </p>
                            {fact.sourceError && (
                              <p className="mt-2 text-xs leading-5 text-bench-700">
                                Avoid: {fact.sourceError}
                              </p>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-5 rounded-2xl bg-bench-50 px-4 py-5 text-sm text-bench-700 ring-1 ring-inset ring-bench-200">
                        <p className="font-semibold text-bench-900">
                          No long-term facts captured yet.
                        </p>
                        <p className="mt-2 leading-6">
                          Facts appear here after runs include durable
                          preference, correction, goal, or behavior signals.
                        </p>
                      </div>
                    )}
                  </section>

                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <h3 className="text-sm font-semibold">
                      Run Memory Records
                    </h3>
                    {memoryRecords.length > 0 ? (
                      <div className="mt-5 space-y-3">
                        {memoryRecords.map((record) => (
                          <article
                            key={record.id}
                            className="rounded-2xl bg-bench-50 px-4 py-4 ring-1 ring-inset ring-bench-200"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-all font-mono text-xs font-semibold text-bench-900">
                                  {record.namespace.join("/")}
                                </p>
                                <p className="mt-1 break-all font-mono text-[11px] text-bench-700">
                                  {record.id}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                <span
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                                    memoryKindClasses(record.kind),
                                  )}
                                >
                                  {record.kind}
                                </span>
                                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                                  {memoryTimestamp(record.updatedAt)}
                                </span>
                              </div>
                            </div>
                            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white px-3 py-3 text-xs leading-5 text-bench-900 ring-1 ring-inset ring-bench-200">
                              {memoryValue(record.value)}
                            </pre>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-5 rounded-2xl bg-bench-50 px-4 py-5 text-sm text-bench-700 ring-1 ring-inset ring-bench-200">
                        <p className="font-semibold text-bench-900">
                          No memory recorded for the selected run yet.
                        </p>
                        <p className="mt-2 leading-6">
                          Run-scoped records are kept here for debugging;
                          long-term memory lives in the profile and facts above.
                        </p>
                      </div>
                    )}
                    {memoryNamespaces.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {memoryNamespaces.map((namespace) => (
                          <span
                            key={namespace}
                            className="rounded-full bg-bench-50 px-3 py-1.5 font-mono text-xs text-bench-700 ring-1 ring-inset ring-bench-200"
                          >
                            {namespace}
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}


              {activeSection === "channels" && (
                <>
                  <div className="flex items-center gap-2 px-1">
                    <Power size={18} className="text-bench-500" />
                    <h3 className="text-[18px] font-semibold text-bench-900">渠道</h3>
                  </div>

                  <div className="rounded-[22px] bg-bench-50/80 p-1 shadow-xs ring-1 ring-inset ring-bench-200/80">
                    <div className="grid grid-cols-2 gap-1 md:grid-cols-4 xl:grid-cols-8">
                      {channelProviderTabs.map((tab) => {
                        const active = tab.id === selectedChannelProvider;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                              setSelectedChannelProvider(tab.id);
                              setChannelDraft({ label: "" });
                            }}
                            className={cn(
                              "flex h-10 items-center justify-center gap-1.5 rounded-2xl px-2 text-sm font-semibold transition active:scale-[0.98]",
                              active
                                ? "bg-white text-bench-900 shadow-xs ring-2 ring-bench-300"
                                : "text-bench-600 hover:bg-white/70 hover:text-bench-900",
                            )}
                          >
                            <span>{tab.label}</span>
                            {!tab.runtimeImplemented && (
                              <span className="h-1.5 w-1.5 rounded-full bg-bench-300" aria-label="adapter pending" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {(channelsLoading || channelsError) && (
                    <div className={cn(
                      "rounded-2xl px-4 py-3 text-sm ring-1 ring-inset",
                      channelsError
                        ? "bg-red-50 text-red-700 ring-red-200"
                        : "bg-bench-50 text-bench-600 ring-bench-200",
                    )}
                    >
                      {channelsError ?? "正在读取渠道配置..."}
                    </div>
                  )}

                  <section className="rounded-[22px] bg-card p-6 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-bench-50 text-bench-500 ring-1 ring-inset ring-bench-200">
                        <Bot size={17} />
                      </span>
                      <div>
                        <h3 className="text-lg font-semibold text-bench-900">{selectedChannelTab.title}</h3>
                      </div>
                    </div>

                    <div className="mt-8 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-bench-900">
                          启用 {selectedChannelTab.title} Bot
                        </p>
                        <p className="mt-1 text-xs text-bench-500">
                          {selectedChannelTab.runtimeImplemented
                            ? `Connect Ora to ${selectedChannelTab.title} for messaging`
                            : "配置项可先保存；运行时适配器尚未接入，暂不能启用。"}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-pressed={Boolean(selectedChannel?.enabled)}
                        disabled={!selectedChannelTab.runtimeImplemented}
                        onClick={toggleSelectedChannel}
                        className={cn(
                          "relative h-6 w-11 rounded-full transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
                          selectedChannel?.enabled ? "bg-bench-900" : "bg-bench-200",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition",
                            selectedChannel?.enabled ? "left-5" : "left-0.5",
                          )}
                        />
                      </button>
                    </div>

                    <div className="mt-5 rounded-2xl bg-white px-5 py-4 shadow-xs ring-1 ring-inset ring-bench-200">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full", selectedChannel?.enabled ? "bg-emerald-500" : "bg-bench-300")} />
                          <span className="text-sm font-semibold text-bench-900">
                            {channelStateLabel(selectedChannel, selectedChannelTab.runtimeImplemented)}
                          </span>
                        </div>
                        {selectedChannel ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-xl border-red-200 text-red-600 hover:bg-red-50"
                            onClick={() => deleteChannel(selectedChannel.channelId)}
                          >
                            删除配置
                          </Button>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-500">Name</span>
                          <input
                            value={channelDraft.label ?? ""}
                            onChange={(event) => setChannelDraft((draft) => ({ ...draft, label: event.target.value }))}
                            placeholder={selectedChannel?.label ?? selectedChannelTab.title}
                            className="h-10 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                          />
                        </label>
                        {selectedChannelTab.fields.map((field) => (
                          <label
                            key={field.key}
                            className={cn("space-y-2", field.span === "full" && "md:col-span-2")}
                          >
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-500">
                              {field.label}
                            </span>
                            <input
                              type={field.secret ? "password" : "text"}
                              value={channelDraft[field.key] ?? ""}
                              onChange={(event) => setChannelDraft((draft) => ({ ...draft, [field.key]: event.target.value }))}
                              placeholder={channelFieldPlaceholder(selectedChannel, field)}
                              className="h-10 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                            />
                          </label>
                        ))}
                      </div>
                      {selectedChannelTab.id === "wechat" && (
                        <div className="mt-4">
                          {selectedChannel ? (
                            <WechatQrCodePanel
                              channelId={selectedChannel.channelId}
                              isBound={Boolean(selectedChannel.config?.bound)}
                              runtimeClient={runtimeClient}
                              onBind={async (id, credentials) => {
                                const runConfig = buildChannelRunConfig(selectedChannelRunProvider, {
                                  modeSelection: channelModeSelection,
                                  modeId: channelModeId,
                                  permissionMode: channelPermissionMode,
                                  taskIntent: channelTaskIntent,
                                  metadata: selectedChannelRunMetadata,
                                });
                                await runtimeClient.updateChannel({
                                  channelId: id,
                                  config: {
                                    botToken: credentials.botToken,
                                    baseUrl: credentials.baseUrl,
                                    bound: true,
                                    runConfig,
                                  },
                                });
                                await loadChannels();
                              }}
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-3 rounded-xl bg-bench-50 px-4 py-6 ring-1 ring-inset ring-bench-200">
                              <p className="text-xs text-bench-500">
                                请先点击"保存"创建 WeChat 渠道，然后扫码绑定。
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                      {!selectedChannelTab.runtimeImplemented && (
                        <p className="mt-4 rounded-xl bg-bench-50 px-3 py-2 text-xs leading-5 text-bench-500 ring-1 ring-inset ring-bench-200">
                          该渠道配置按 DeerFlow 字段预留，可保存为禁用配置；真正启用需要补齐对应 runtime adapter。
                        </p>
                      )}
                    </div>

                    <div className="mt-5 space-y-4 rounded-2xl bg-white px-5 py-4 shadow-xs ring-1 ring-inset ring-bench-200">
                      <div className="flex items-center gap-2 text-sm font-semibold text-bench-900">
                        <Settings size={15} className="text-bench-400" />
                        Channel defaults
                      </div>
                      <p className="text-xs text-bench-500">
                        Defaults applied to new {selectedChannelTab.title} conversations.
                      </p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-500">默认模型</span>
                          <Select
                            value={channelProviderId}
                            onChange={(event) => setChannelDraft((draft) => ({ ...draft, runProviderId: event.target.value }))}
                            className="h-10 rounded-xl bg-bench-50"
                          >
                            {channelModelProviders.length > 0 ? (
                              channelModelProviders.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.label} · {provider.modelId}
                                </option>
                              ))
                            ) : (
                              <option value="">global default</option>
                            )}
                          </Select>
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-500">默认工作模式</span>
                          <Select
                            value={channelModeSelection}
                            onChange={(event) => setChannelDraft((draft) => ({ ...draft, runModeSelection: event.target.value }))}
                            className="h-10 rounded-xl bg-bench-50"
                          >
                            {channelModeSelectionOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </Select>
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-500">手动模式</span>
                          <Select
                            value={channelModeId}
                            onChange={(event) => setChannelDraft((draft) => ({ ...draft, runModeId: event.target.value }))}
                            disabled={channelModeSelection === "auto"}
                            className="h-10 rounded-xl bg-bench-50 disabled:opacity-60"
                          >
                            {state.modes.map((mode) => (
                              <option key={mode.id} value={mode.id}>{mode.label}</option>
                            ))}
                          </Select>
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-500">默认权限</span>
                          <Select
                            value={channelPermissionMode}
                            onChange={(event) => setChannelDraft((draft) => ({ ...draft, runPermissionMode: event.target.value }))}
                            className="h-10 rounded-xl bg-bench-50"
                          >
                            {channelPermissionModeOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </Select>
                        </label>
                        <label className="space-y-2 md:col-span-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-500">默认目标</span>
                          <Select
                            value={channelTaskIntent}
                            onChange={(event) => setChannelDraft((draft) => ({ ...draft, runTaskIntent: event.target.value }))}
                            className="h-10 rounded-xl bg-bench-50"
                          >
                            {channelTaskIntentOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </Select>
                        </label>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[22px] bg-card p-6 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="mb-8 flex items-center gap-3">
                      <Activity size={20} className="text-bench-400" />
                      <h3 className="text-lg font-semibold text-bench-900">Status</h3>
                    </div>
                    <div className="grid gap-4 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-semibold text-bench-500">Connection</span>
                        <span className="inline-flex items-center gap-2 font-semibold text-bench-900">
                          <span className={cn("h-2 w-2 rounded-full", selectedChannel?.enabled ? "bg-emerald-500" : "bg-bench-300")} />
                          {channelStateLabel(selectedChannel, selectedChannelTab.runtimeImplemented)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-semibold text-bench-500">Started</span>
                        <span className="font-mono text-bench-900">{selectedChannelStartedAt}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-semibold text-bench-500">Last Event</span>
                        <span className="font-mono text-bench-900">No events yet</span>
                      </div>
                    </div>
                  </section>

                  <div className="flex items-center justify-between rounded-[22px] bg-card px-5 py-4 shadow-pane ring-1 ring-inset ring-bench-200">
                    <span className="text-xs text-bench-500">
                      {selectedChannelTab.runtimeImplemented ? "所有更改会保存到渠道配置" : "仅保存配置草稿，暂不启用适配器"}
                    </span>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
                        关闭
                      </Button>
                      <Button type="button" className="rounded-xl bg-bench-900 text-white hover:bg-bench-800" onClick={() => saveSelectedChannel(Boolean(selectedChannel?.enabled ?? true))}>
                        保存
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {activeSection === "tools" && (
                <>
                  {state.toolRegistry && (
                    <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                      <h3 className="text-sm font-semibold">Tool Registry</h3>
                      <div className="mt-5 grid gap-2 md:grid-cols-2">
                        {state.toolRegistry.tools.map((tool) => (
                          <div
                            key={tool.id}
                            className="rounded-2xl bg-bench-50 px-3 py-3 ring-1 ring-inset ring-bench-200"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-bench-900">
                                {tool.label}
                              </span>
                              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-bench-700 ring-1 ring-inset ring-bench-200">
                                {tool.riskLevel}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-bench-700">
                              {tool.description}
                            </p>
                            <p className="mt-2 font-mono text-[11px] text-bench-700">
                              {tool.id}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {webSearchSection}
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
