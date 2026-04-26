import type { ProviderCapability } from "@ora/shared";
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
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkbench } from "../lib/state";
import {
  BUILT_IN_PROVIDER_IDS,
  PROVIDER_PRESETS,
  buildProviderConfigFromDraft,
  buildProviderCatalog,
  canEditBaseUrl,
  createDraftFromPreset,
  createDraftFromProvider,
  createModelProviderId,
  findPresetById,
  getModelProviderBaseId,
  type ProviderCatalogEntry,
  type ProviderDraft,
} from "../lib/providerPresets";
import {
  DEFAULT_SEARCH_SETTINGS,
  loadDesktopSearchSettings,
  saveDesktopSearchSettings,
  type DesktopSearchProviderId,
  type DesktopSearchSettings,
} from "../lib/searchSettings";
import { useRunActions } from "../lib/useRunActions";
import type { OraLongTermMemoryProfile } from "../lib/runtimeClient";
import { cn } from "../lib/utils";
import { LANGUAGE_OPTIONS } from "../lib/i18n";
import { ProjectSignalsView } from "./ProjectSignalsView";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Select } from "./ui/select";

type SettingsSection = "general" | "providers" | "runtime" | "memory" | "signals" | "tools" | "skills";

const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof Settings;
}> = [
  { id: "general", label: "General", icon: Globe2 },
  { id: "providers", label: "Providers", icon: Bot },
  { id: "runtime", label: "Runtime", icon: Activity },
  { id: "memory", label: "Memory", icon: Database },
  { id: "signals", label: "Signals", icon: Activity },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "skills", label: "Skills", icon: Sparkles },
];

const capabilityOptions: Array<{ id: ProviderCapability; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "tool_use", label: "Tool Use" },
  { id: "image_input", label: "Images" },
  { id: "json_mode", label: "JSON" },
  { id: "reasoning", label: "Reasoning" },
];

const searchProviderOptions: Array<{ id: DesktopSearchProviderId; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "brave", label: "Brave" },
  { id: "tavily", label: "Tavily" },
  { id: "serpapi", label: "SerpAPI" },
  { id: "kagi", label: "Kagi" },
  { id: "duckduckgo", label: "DuckDuckGo" },
  { id: "mcp", label: "MCP" },
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
      return "bg-sky-50 text-bench-900 ring-sky-200";
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

function emptyDraft(): ProviderDraft {
  return createDraftFromPreset(PROVIDER_PRESETS[0], []);
}

function memoryValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "summary" in value && typeof value.summary === "string") {
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

function memoryKindClasses(kind: string) {
  switch (kind) {
    case "project":
      return "bg-emerald-50 text-bench-900 ring-emerald-200";
    case "worker":
      return "bg-violet-50 text-bench-900 ring-violet-200";
    case "artifact":
      return "bg-sky-50 text-bench-900 ring-sky-200";
    case "profile":
      return "bg-amber-50 text-bench-900 ring-amber-200";
    default:
      return "bg-bench-50 text-bench-900 ring-bench-200";
  }
}

export function SettingsView({ open, onOpenChange }: SettingsViewProps) {
  const { state, dispatch } = useWorkbench();
  const { runtimeClient, actions } = useRunActions();
  const secretInputRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [selectedProviderKey, setSelectedProviderKey] = useState<string>("");
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(emptyDraft());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [searchSettings, setSearchSettings] = useState<DesktopSearchSettings>(() => loadDesktopSearchSettings());
  const [longTermMemory, setLongTermMemory] = useState<OraLongTermMemoryProfile | undefined>();
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | undefined>();

  const providers = state.providerRegistry?.providers ?? [];
  const selectedProvider = providers.find((provider) => provider.id === state.selectedProviderId) ?? providers[0];
  const providerCatalog = useMemo(() => buildProviderCatalog(providers), [providers]);
  const activePreset = useMemo(() => findPresetById(providerDraft.presetId), [providerDraft.presetId]);
  const selectedCatalogEntry = useMemo(
    () => providerCatalog.find((entry) => entry.key === selectedProviderKey)
      ?? providerCatalog.find((entry) => entry.providers.some((provider) => provider.id === providerDraft.id))
      ?? providerCatalog.find((entry) => entry.draft.id === providerDraft.id),
    [providerCatalog, providerDraft.id, selectedProviderKey],
  );
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
  const memoryRecords = state.activeSnapshot?.memory ?? [];
  const longTermFacts = longTermMemory?.facts ?? [];
  const longTermSections = longTermMemory
    ? [
        { label: "Work Context", value: longTermMemory.user.workContext },
        { label: "Personal Context", value: longTermMemory.user.personalContext },
        { label: "Top of Mind", value: longTermMemory.user.topOfMind },
        { label: "Recent Months", value: longTermMemory.history.recentMonths },
        { label: "Earlier Context", value: longTermMemory.history.earlierContext },
        { label: "Long-term Background", value: longTermMemory.history.longTermBackground },
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
    if (!selectedProvider) {
      return;
    }
    const entry = providerCatalog.find((candidate) => candidate.providers.some((provider) => provider.id === selectedProvider.id));
    setSelectedProviderKey(entry?.key ?? `provider:${getModelProviderBaseId(selectedProvider.id)}`);
    setProviderDraft(createDraftFromProvider(selectedProvider));
  }, [providerCatalog, selectedProvider]);

  useEffect(() => {
    if (!open || activeSection !== "memory") {
      return;
    }
    void loadMemory();
  }, [activeSection, open]);

  const draftProvider = useMemo(() => buildProviderConfigFromDraft(providerDraft), [providerDraft]);
  const draftSecretStatus = state.providerSecretStatuses.find((status) => status.providerId === providerDraft.id);
  const draftProviderStatus = state.providerStatuses.find((status) => status.providerId === providerDraft.id)
    ?? (draftProvider.type === "local_smoke"
      ? { providerId: providerDraft.id, state: "verified", detail: "Local smoke provider is ready." }
      : draftSecretStatus?.hasSecret
        ? { providerId: providerDraft.id, state: "key_stored", detail: "API key stored. Run verify to confirm connectivity." }
        : { providerId: providerDraft.id, state: "needs_key", detail: "API key required before verification." });

  const modelSuggestions = activePreset.modelSuggestions.length > 0
    ? activePreset.modelSuggestions
    : [providerDraft.modelId];
  const modelProviderByModelId = useMemo(() => {
    return new Map((selectedCatalogEntry?.providers ?? []).map((provider) => [provider.modelId, provider]));
  }, [selectedCatalogEntry]);
  const modelOptions = useMemo(() => {
    const models = new Set(modelSuggestions);
    for (const provider of selectedCatalogEntry?.providers ?? []) {
      models.add(provider.modelId);
    }
    if (providerDraft.modelId.trim()) {
      models.add(providerDraft.modelId.trim());
    }
    return [...models];
  }, [modelSuggestions, providerDraft.modelId, selectedCatalogEntry]);
  const filteredModelOptions = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    if (!query) {
      return modelOptions;
    }
    return modelOptions.filter((modelId) => modelId.toLowerCase().includes(query));
  }, [modelOptions, modelSearch]);
  const canUseModelSearch = modelSearch.trim().length > 0
    && !modelOptions.some((modelId) => modelId.toLowerCase() === modelSearch.trim().toLowerCase());
  const isBuiltInProvider = BUILT_IN_PROVIDER_IDS.has(providerDraft.id);
  const isSavedProvider = providers.some((provider) => provider.id === providerDraft.id);
  const canDeleteProvider = isSavedProvider && !isBuiltInProvider;
  const needsSecret = providerDraft.type !== "local_smoke";
  const saveDisabled = !providerDraft.label.trim()
    || !providerDraft.modelId.trim()
    || ((providerDraft.type === "openai_compatible" || providerDraft.type === "anthropic_compatible") && !providerDraft.baseUrl.trim())
    || state.busyCommand !== undefined;

  function updateDraft(patch: Partial<ProviderDraft>) {
    setProviderDraft((current) => ({ ...current, ...patch }));
  }

  function buildModelProviderConfig(modelId: string, enabled: boolean) {
    const existingProvider = modelProviderByModelId.get(modelId);
    const baseProviderId = getModelProviderBaseId(providerDraft.id);
    const providerId = existingProvider?.id
      ?? (modelId === activePreset.defaultModelId ? baseProviderId : createModelProviderId(baseProviderId, modelId));
    return buildProviderConfigFromDraft({
      ...providerDraft,
      id: providerId,
      label: providerDraft.label.trim() || activePreset.label,
      modelId,
      enabled,
    });
  }

  function selectProviderEntry(entry: ProviderCatalogEntry) {
    setSelectedProviderKey(entry.key);
    setProviderDraft(entry.draft);
    setModelSearch("");
    setAdvancedOpen(false);
    if (entry.provider) {
      dispatch({ type: "SET_PROVIDER", providerId: entry.provider.id });
    }
  }

  function addCustomProvider() {
    const preset = findPresetById("openai-compatible-generic");
    const draft = createDraftFromPreset(preset, providers);
    setSelectedProviderKey(`draft:${draft.id}`);
    setProviderDraft(draft);
    setModelSearch("");
    setAdvancedOpen(false);
  }

  function saveSecret() {
    if (!secretInputRef.current) return;
    const secret = secretInputRef.current.value.trim();
    if (!secret) return;
    void actions.storeProviderSecret(providerDraft.id, secret);
    secretInputRef.current.value = "";
  }

  function saveProviderDetails() {
    void actions.upsertCustomProvider(buildModelProviderConfig(providerDraft.modelId, providerDraft.enabled));
  }

  async function verifyAndEnableProvider() {
    const provider = buildModelProviderConfig(providerDraft.modelId, true);
    const status = await actions.verifyProvider(provider);
    if (status?.state !== "verified") {
      return;
    }
    updateDraft({ enabled: true });
    void actions.upsertCustomProvider(provider);
  }

  function disableProvider() {
    const disabledProvider = buildModelProviderConfig(providerDraft.modelId, false);
    updateDraft({ enabled: false });
    void actions.upsertCustomProvider(disabledProvider);
  }

  function addCustomModel() {
    const modelId = modelSearch.trim();
    if (!modelId) {
      return;
    }
    updateDraft({ modelId, enabled: false });
    setModelSearch("");
    void actions.upsertCustomProvider(buildModelProviderConfig(modelId, false));
  }

  async function enableModel(modelId: string) {
    const provider = buildModelProviderConfig(modelId, true);
    const status = await actions.verifyProvider(provider);
    if (status?.state !== "verified") {
      updateDraft({ modelId, enabled: false });
      return;
    }
    updateDraft({ modelId, enabled: true });
    void actions.upsertCustomProvider(provider);
  }

  function disableModel(modelId: string) {
    const provider = buildModelProviderConfig(modelId, false);
    updateDraft({ modelId, enabled: false });
    void actions.upsertCustomProvider(provider);
  }

  function toggleCapability(capability: ProviderCapability) {
    updateDraft({
      capabilities: providerDraft.capabilities.includes(capability)
        ? providerDraft.capabilities.filter((entry) => entry !== capability)
        : [...providerDraft.capabilities, capability],
    });
  }

  function updateSearchSettings(patch: Partial<DesktopSearchSettings>) {
    setSearchSettings((current) => ({ ...current, ...patch }));
  }

  function saveSearchSettings() {
    saveDesktopSearchSettings(searchSettings);
    dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: "Web search settings saved for future turns." });
  }

  function resetSearchSettings() {
    setSearchSettings(DEFAULT_SEARCH_SETTINGS);
    saveDesktopSearchSettings(DEFAULT_SEARCH_SETTINGS);
    dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: "Web search settings reset to auto." });
  }

  async function loadMemory() {
    setMemoryLoading(true);
    setMemoryError(undefined);
    try {
      setLongTermMemory(await runtimeClient.getMemory());
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Failed to load memory.");
    } finally {
      setMemoryLoading(false);
    }
  }

  async function clearMemory() {
    setMemoryLoading(true);
    setMemoryError(undefined);
    try {
      setLongTermMemory(await runtimeClient.clearMemory());
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: "Long-term memory cleared." });
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Failed to clear memory.");
    } finally {
      setMemoryLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,860px)] w-[min(1120px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[28px] border border-black/[0.03] bg-background p-0 shadow-lift">
        <div className="flex items-start justify-between gap-4 border-b border-border/80 bg-sidebar/90 px-6 py-5">
          <div>
            <h2 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-bench-700">Settings</h2>
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
                          active ? "border-white/10 bg-white/10 text-white" : "border-bench-200 bg-white text-bench-700",
                        )}
                      >
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="block whitespace-nowrap text-sm font-semibold">{section.label}</span>
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
                <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <Globe2 size={18} />
                        <h3 className="text-sm font-semibold">Display Language</h3>
                      </div>
                      <p className="text-sm leading-6 text-bench-700">
                        Choose the language used by the desktop workbench. Chinese is the default for new installs.
                      </p>
                    </div>
                    <div className="inline-flex rounded-xl bg-bench-50 p-1 ring-1 ring-inset ring-bench-200">
                      {LANGUAGE_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => dispatch({ type: "SET_LANGUAGE", language: option.id })}
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
              )}

              {activeSection === "providers" && (
                <section className="grid overflow-hidden rounded-[22px] bg-card shadow-pane ring-1 ring-inset ring-bench-200 lg:min-h-[640px] lg:grid-cols-[260px_minmax(0,1fr)]">
                  <div className="flex h-[360px] min-h-0 flex-col border-b border-bench-200 bg-sidebar/70 p-4 lg:h-auto lg:border-b-0 lg:border-r">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Bot size={18} />
                        <h3 className="truncate text-sm font-semibold">Providers</h3>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label="Add custom provider"
                        className="rounded-lg bg-white"
                        onClick={addCustomProvider}
                      >
                        <Plus size={14} />
                      </Button>
                    </div>

                    <label className="relative mt-4 block">
                      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bench-700" />
                      <input
                        value={providerSearch}
                        onChange={(event) => setProviderSearch(event.target.value)}
                        placeholder="Search providers..."
                        className="h-10 w-full rounded-xl border border-bench-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-bench-900"
                      />
                    </label>

                    <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                      {filteredProviderCatalog.map((entry) => {
                        const draft = entry.draft;
                        const active = selectedProviderKey === entry.key || providerDraft.id === draft.id;
                        const entryStatus = state.providerStatuses.find((status) => status.providerId === draft.id);
                        const entrySecretStatus = state.providerSecretStatuses.find((status) => status.providerId === draft.id);
                        const ready = draft.type === "local_smoke" || (draft.enabled && Boolean(entrySecretStatus?.hasSecret));
                        const stateText = draft.type === "local_smoke"
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
                            onClick={() => selectProviderEntry(entry)}
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
                                <span className="truncate text-sm font-semibold text-bench-900">{entry.label}</span>
                                {entry.preset.isRecommended && (
                                  <Zap size={12} className="shrink-0 text-signal-amber" />
                                )}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              {ready ? (
                                <CheckCircle2 size={14} className="text-lime-600" />
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
                          <h3 className="truncate text-xl font-semibold text-bench-900">{providerDraft.label || activePreset.label}</h3>
                          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", statusClasses(draftProviderStatus.state))}>
                            {statusLabel(draftProviderStatus.state)}
                          </span>
                          <span className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                            providerDraft.enabled ? "bg-lime-50 text-bench-900 ring-lime-200" : "bg-white text-bench-700 ring-bench-200",
                          )}>
                            {providerEnabledLabel(providerDraft.enabled, draftProviderStatus.state)}
                          </span>
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-bench-700">
                          {selectedCatalogEntry?.description ?? activePreset.description}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-bench-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700 ring-1 ring-inset ring-bench-200">
                            {providerTypeLabel(providerDraft.type)}
                          </span>
                          {providerDraft.type === "openai_compatible" && (
                            <span className="rounded-full bg-bench-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700 ring-1 ring-inset ring-bench-200">
                              {providerDraft.protocol === "responses" ? "Responses API" : "Chat Completions"}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {activePreset.apiKeyUrl && (
                          <Button type="button" variant="outline" className="rounded-xl bg-white" asChild>
                            <a href={activePreset.apiKeyUrl} target="_blank" rel="noreferrer">
                              <KeyRound size={15} />
                              API Keys
                              <ExternalLink size={13} />
                            </a>
                          </Button>
                        )}
                        <Button type="button" variant="outline" className="rounded-xl bg-white" onClick={disableProvider} disabled={!providerDraft.enabled || state.busyCommand !== undefined}>
                          <Power size={15} />
                          Disable
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl bg-bench-50/70 px-4 py-3 text-xs leading-5 text-bench-700 ring-1 ring-inset ring-bench-200">
                      {draftProviderStatus.detail}
                    </div>

                    <div className="mt-5 grid gap-4">
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Provider Name</span>
                        <input
                          value={providerDraft.label}
                          onChange={(event) => updateDraft({ label: event.target.value })}
                          placeholder="Provider name"
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                        />
                      </label>

                      {canEditBaseUrl(providerDraft.type) && (
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                            {providerDraft.type === "openai" || providerDraft.type === "anthropic" ? "Base URL (optional)" : "Base URL"}
                          </span>
                          <input
                            value={providerDraft.baseUrl}
                            onChange={(event) => updateDraft({ baseUrl: event.target.value })}
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
                          <h4 className="text-sm font-semibold text-bench-900">Models</h4>
                          <p className="mt-1 text-xs text-bench-700">
                            Enable one or more models for this provider. Enter a custom model ID when it is not listed.
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 font-mono text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                          {providerDraft.modelId}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <label className="relative block min-w-[220px] flex-1">
                          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bench-700" />
                          <input
                            value={modelSearch}
                            onChange={(event) => setModelSearch(event.target.value)}
                            placeholder="Search or enter model ID..."
                            className="h-10 w-full rounded-xl border border-bench-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-bench-900"
                          />
                        </label>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 rounded-xl bg-white"
                          onClick={addCustomModel}
                          disabled={!canUseModelSearch || state.busyCommand !== undefined}
                        >
                          <Plus size={14} />
                          Add model
                        </Button>
                      </div>

                      <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-bench-200 bg-white">
                        {filteredModelOptions.map((modelId) => {
                          const selected = providerDraft.modelId === modelId;
                          const modelProvider = modelProviderByModelId.get(modelId);
                          const enabled = modelProvider ? modelProvider.enabled !== false : selected && providerDraft.enabled;
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
                                <span className="block truncate font-mono text-sm text-bench-900">{modelId}</span>
                                <span className="mt-0.5 block text-xs text-bench-700">
                                  {enabled ? "Enabled model" : modelProvider ? "Saved disabled" : activePreset.label}
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label={enabled ? `Disable ${modelId}` : `Verify and enable ${modelId}`}
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
                                <span className={cn(
                                  "inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition",
                                  enabled ? "bg-bench-900" : "bg-bench-200",
                                )}>
                                  <span className={cn(
                                    "h-5 w-5 rounded-full bg-white shadow-xs transition",
                                    enabled && "translate-x-4",
                                  )} />
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
                              <span className="block truncate font-mono text-sm text-bench-900">{modelSearch.trim()}</span>
                              <span className="mt-0.5 block text-xs text-bench-700">Use custom model ID</span>
                            </span>
                            <Plus size={15} className="shrink-0 text-bench-700" />
                          </button>
                        )}
                        {filteredModelOptions.length === 0 && !canUseModelSearch && (
                          <div className="px-3 py-4 text-sm text-bench-700">
                            No models match that search.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 rounded-[18px] bg-bench-50/70 p-4 ring-1 ring-inset ring-bench-200">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-bench-900">API Key</h4>
                          <p className="mt-1 text-xs text-bench-700">
                            Stored in the runtime layer and Keychain.
                          </p>
                        </div>
                        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", statusClasses(draftProviderStatus.state))}>
                          {needsSecret ? (draftSecretStatus?.hasSecret ? "Key ready" : "Key needed") : "Local"}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <input
                          ref={secretInputRef}
                          type="password"
                          disabled={!needsSecret || state.busyCommand !== undefined}
                          placeholder={needsSecret ? `${providerDraft.label || "Provider"} API key` : "No key required for local smoke"}
                          className="h-11 min-w-0 rounded-xl border border-bench-200 bg-white px-3 text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <Button type="button" className="h-11 rounded-xl px-4" onClick={saveSecret} disabled={!needsSecret || state.busyCommand !== undefined}>
                          <Save size={15} />
                          Save Key
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl bg-white px-4"
                          onClick={() => void actions.deleteProviderSecret(providerDraft.id)}
                          disabled={!needsSecret || state.busyCommand !== undefined || !draftSecretStatus?.hasSecret}
                        >
                          <Trash2 size={15} />
                          Remove
                        </Button>
                      </div>
                    </div>

                    <div className="mt-5">
                      <button
                        type="button"
                        onClick={() => setAdvancedOpen((current) => !current)}
                        className="flex w-full items-center justify-between rounded-2xl border border-bench-200 bg-bench-50/75 px-4 py-3 text-left transition hover:bg-white"
                      >
                        <span>
                          <span className="block text-sm font-semibold text-bench-900">Advanced</span>
                          <span className="mt-1 block text-xs text-bench-700">Protocol, environment variable, limits, capabilities, drop params, and headers.</span>
                        </span>
                        {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>

                      {advancedOpen && (
                        <div className="mt-3 space-y-4 rounded-[18px] bg-bench-50/60 p-4 ring-1 ring-inset ring-bench-200">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">API Key Env</span>
                              <input
                                value={providerDraft.apiKeyEnv}
                                onChange={(event) => updateDraft({ apiKeyEnv: event.target.value.toUpperCase() })}
                                placeholder="OPENAI_API_KEY"
                                className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>

                            {providerDraft.type === "openai_compatible" && (
                              <label className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Protocol</span>
                                <Select
                                  aria-label="Protocol"
                                  value={providerDraft.protocol}
                                  onChange={(event) => updateDraft({ protocol: event.target.value as ProviderDraft["protocol"] })}
                                  className="h-11 bg-white"
                                >
                                  <option value="chat_completions">Chat Completions</option>
                                  <option value="responses">Responses</option>
                                </Select>
                              </label>
                            )}

                            {(providerDraft.type === "anthropic" || providerDraft.type === "anthropic_compatible") && (
                              <label className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Anthropic Version</span>
                                <input
                                  value={providerDraft.anthropicVersion}
                                  onChange={(event) => updateDraft({ anthropicVersion: event.target.value })}
                                  placeholder="2023-06-01"
                                  className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                                />
                              </label>
                            )}

                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Max Output Tokens</span>
                              <input
                                value={providerDraft.maxTokens}
                                onChange={(event) => updateDraft({ maxTokens: event.target.value })}
                                placeholder="8192"
                                className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>

                            <label className="space-y-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Temperature</span>
                              <input
                                value={providerDraft.temperature}
                                onChange={(event) => updateDraft({ temperature: event.target.value })}
                                placeholder="0.2"
                                className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>

                            <label className="space-y-2 lg:col-span-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Drop Params</span>
                              <input
                                value={providerDraft.dropParams}
                                onChange={(event) => updateDraft({ dropParams: event.target.value })}
                                placeholder="temperature, top_p"
                                className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>

                            <label className="space-y-2 lg:col-span-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Headers</span>
                              <textarea
                                value={providerDraft.headersText}
                                onChange={(event) => updateDraft({ headersText: event.target.value })}
                                placeholder={"Header-Name: value\nanthropic-beta: prompt-caching-2024-07-31"}
                                className="min-h-28 w-full rounded-2xl border border-bench-200 bg-white px-3 py-3 font-mono text-sm outline-none transition focus:border-bench-900"
                              />
                            </label>
                          </div>

                          <div>
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Capabilities</span>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {capabilityOptions.map((capability) => {
                                const active = providerDraft.capabilities.includes(capability.id);
                                return (
                                  <button
                                    key={capability.id}
                                    type="button"
                                    onClick={() => toggleCapability(capability.id)}
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
                            Provider id: <span className="font-mono">{providerDraft.id}</span>
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-bench-200 pt-5">
                      <p className="text-xs text-bench-700">
                        {selectedCatalogEntry?.saved ? "Saved provider" : "Preset draft"}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" className="rounded-xl bg-white" onClick={saveProviderDetails} disabled={saveDisabled}>
                          <Save size={15} />
                          Save Details
                        </Button>
                        <Button type="button" className="rounded-xl" onClick={() => void verifyAndEnableProvider()} disabled={saveDisabled}>
                          <CheckCircle2 size={15} />
                          Verify & Enable
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl bg-white"
                          onClick={() => void actions.deleteCustomProvider(providerDraft.id)}
                          disabled={!canDeleteProvider || state.busyCommand !== undefined}
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
                    <h3 className="text-sm font-semibold">Runtime Status</h3>
                    <div className="mt-5 rounded-2xl bg-bench-50 p-4 ring-1 ring-inset ring-bench-200">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={cn("h-2.5 w-2.5 rounded-full", state.bridgeStatus.ok ? "bg-signal-acid" : "bg-red-500")} />
                        <span className="font-semibold">{state.bridgeStatus.label}</span>
                        <span className="text-bench-700">{state.bridgeStatus.detail}</span>
                      </div>
                      {state.busyCommand && (
                        <p className="mt-3 text-xs text-bench-700">{state.busyCommand} in progress.</p>
                      )}
                    </div>
                  </section>

                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">Web Search</h3>
                        <p className="mt-2 text-sm leading-6 text-bench-700">
                          Runtime tool: web.search and web.fetch. Provider-native browsing is not required.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateSearchSettings({ enabled: !searchSettings.enabled })}
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
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Search Provider</span>
                        <Select
                          aria-label="Search Provider"
                          value={searchSettings.providerId}
                          disabled={!searchSettings.enabled}
                          onChange={(event) => updateSearchSettings({ providerId: event.target.value as DesktopSearchProviderId })}
                          className="h-11 bg-bench-50"
                        >
                          {searchProviderOptions.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.label}</option>
                          ))}
                        </Select>
                      </label>

                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">API Key Env</span>
                        <input
                          value={searchSettings.apiKeyEnv}
                          disabled={!searchSettings.enabled || searchSettings.providerId === "duckduckgo" || searchSettings.providerId === "mcp"}
                          onChange={(event) => updateSearchSettings({ apiKeyEnv: event.target.value.toUpperCase() })}
                          placeholder={searchSettings.providerId === "auto" ? "Use provider default env" : `${searchSettings.providerId.toUpperCase()}_API_KEY`}
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Max Results</span>
                        <input
                          value={searchSettings.maxResults}
                          disabled={!searchSettings.enabled}
                          onChange={(event) => updateSearchSettings({ maxResults: event.target.value })}
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Timeout Ms</span>
                        <input
                          value={searchSettings.timeoutMs}
                          disabled={!searchSettings.enabled}
                          onChange={(event) => updateSearchSettings({ timeoutMs: event.target.value })}
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>

                      {searchSettings.providerId === "mcp" && (
                        <>
                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">MCP Server ID</span>
                            <input
                              value={searchSettings.mcpServerId}
                              disabled={!searchSettings.enabled}
                              onChange={(event) => updateSearchSettings({ mcpServerId: event.target.value })}
                              placeholder="local-docs"
                              className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </label>

                          <label className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">MCP Tool Name</span>
                            <input
                              value={searchSettings.mcpToolName}
                              disabled={!searchSettings.enabled}
                              onChange={(event) => updateSearchSettings({ mcpToolName: event.target.value })}
                              placeholder="search"
                              className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </label>
                        </>
                      )}
                    </div>

                    <div className="mt-5 rounded-2xl bg-bench-50 px-4 py-3 text-xs leading-5 text-bench-700 ring-1 ring-inset ring-bench-200">
                      Auto checks `ORA_SEARCH_PROVIDER`, then configured provider API key env vars, then DuckDuckGo fallback. MCP search uses configured MCP servers and requires approval because it calls an MCP tool.
                    </div>

                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" className="rounded-xl" onClick={resetSearchSettings}>
                        Reset
                      </Button>
                      <Button type="button" className="rounded-xl" onClick={saveSearchSettings}>
                        Save Search Settings
                      </Button>
                    </div>
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
                          Long-term memory is persisted across runs, summarized into profile sections, and injected into future prompts when relevant.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                          {longTermFacts.length} facts
                        </span>
                        <Button type="button" variant="outline" className="h-8 rounded-xl px-3 text-xs" onClick={loadMemory} disabled={memoryLoading}>
                          Refresh
                        </Button>
                        <Button type="button" variant="outline" className="h-8 rounded-xl px-3 text-xs" onClick={clearMemory} disabled={memoryLoading || !longTermMemory}>
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
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Last updated</p>
                        <p className="mt-2 break-all font-mono text-xs text-bench-900">
                          {longTermMemory?.lastUpdated ?? (memoryLoading ? "Loading memory..." : "No long-term memory loaded")}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-bench-50/80 px-4 py-3 ring-1 ring-inset ring-bench-200">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Selected run</p>
                        <p className="mt-2 break-all font-mono text-xs text-bench-900">
                          {state.activeSnapshot?.runId ?? "No active run selected"}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <h3 className="text-sm font-semibold">Memory Profile</h3>
                    {longTermSections.length > 0 ? (
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {longTermSections.map((section) => (
                          <article key={section.label} className="rounded-2xl bg-bench-50 px-4 py-4 ring-1 ring-inset ring-bench-200">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-sm font-semibold text-bench-900">{section.label}</h4>
                              {section.value.updatedAt && (
                                <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-bench-700 ring-1 ring-inset ring-bench-200">
                                  {section.value.updatedAt}
                                </span>
                              )}
                            </div>
                            <p className="mt-3 text-sm leading-6 text-bench-700">{section.value.summary}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-5 rounded-2xl bg-bench-50 px-4 py-5 text-sm text-bench-700 ring-1 ring-inset ring-bench-200">
                        <p className="font-semibold text-bench-900">No long-term memory profile yet.</p>
                        <p className="mt-2 leading-6">
                          Ora records durable memory from explicit preferences, corrections, goals, and reinforced working patterns.
                        </p>
                      </div>
                    )}
                  </section>

                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <h3 className="text-sm font-semibold">Memory Facts</h3>
                    {longTermFacts.length > 0 ? (
                      <div className="mt-5 space-y-3">
                        {longTermFacts.map((fact) => (
                          <article key={fact.id} className="rounded-2xl bg-bench-50 px-4 py-4 ring-1 ring-inset ring-bench-200">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-all font-mono text-xs font-semibold text-bench-900">
                                  {fact.id}
                                </p>
                                <p className="mt-1 break-all font-mono text-[11px] text-bench-700">source: {fact.source}</p>
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", memoryKindClasses(fact.category))}>
                                  {fact.category}
                                </span>
                                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                                  {Math.round(fact.confidence * 100)}%
                                </span>
                              </div>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-bench-900">{fact.content}</p>
                            {fact.sourceError && <p className="mt-2 text-xs leading-5 text-bench-700">Avoid: {fact.sourceError}</p>}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-5 rounded-2xl bg-bench-50 px-4 py-5 text-sm text-bench-700 ring-1 ring-inset ring-bench-200">
                        <p className="font-semibold text-bench-900">No long-term facts captured yet.</p>
                        <p className="mt-2 leading-6">Facts appear here after runs include durable preference, correction, goal, or behavior signals.</p>
                      </div>
                    )}
                  </section>

                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <h3 className="text-sm font-semibold">Run Memory Records</h3>
                    {memoryRecords.length > 0 ? (
                      <div className="mt-5 space-y-3">
                        {memoryRecords.map((record) => (
                          <article key={record.id} className="rounded-2xl bg-bench-50 px-4 py-4 ring-1 ring-inset ring-bench-200">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-all font-mono text-xs font-semibold text-bench-900">
                                  {record.namespace.join("/")}
                                </p>
                                <p className="mt-1 break-all font-mono text-[11px] text-bench-700">{record.id}</p>
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", memoryKindClasses(record.kind))}>
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
                        <p className="font-semibold text-bench-900">No memory recorded for the selected run yet.</p>
                        <p className="mt-2 leading-6">
                          Run-scoped records are kept here for debugging; long-term memory lives in the profile and facts above.
                        </p>
                      </div>
                    )}
                    {memoryNamespaces.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {memoryNamespaces.map((namespace) => (
                          <span key={namespace} className="rounded-full bg-bench-50 px-3 py-1.5 font-mono text-xs text-bench-700 ring-1 ring-inset ring-bench-200">
                            {namespace}
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}

              {activeSection === "signals" && state.bridgeStatus && (
                <section className="h-[680px] min-h-[520px] max-h-[calc(88vh-9rem)] overflow-hidden rounded-[22px] bg-card shadow-pane ring-1 ring-inset ring-bench-200">
                  <ProjectSignalsView
                    runtimeClient={runtimeClient}
                    bridgeStatus={state.bridgeStatus}
                    onOpenEvidence={() => onOpenChange(false)}
                  />
                </section>
              )}

              {activeSection === "tools" && state.toolRegistry && (
                <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                  <h3 className="text-sm font-semibold">Tool Registry</h3>
                  <div className="mt-5 grid gap-2 md:grid-cols-2">
                    {state.toolRegistry.tools.map((tool) => (
                      <div key={tool.id} className="rounded-2xl bg-bench-50 px-3 py-3 ring-1 ring-inset ring-bench-200">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-bench-900">{tool.label}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-bench-700 ring-1 ring-inset ring-bench-200">
                            {tool.riskLevel}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-bench-700">{tool.description}</p>
                        <p className="mt-2 font-mono text-[11px] text-bench-700">{tool.id}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeSection === "skills" && state.skillRegistry && (
                <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                  <h3 className="text-sm font-semibold">Skill Registry</h3>
                  <div className="mt-5 space-y-2">
                    {state.skillRegistry.skills.map((skill) => (
                      <div key={skill.id} className="rounded-2xl bg-bench-50 px-3 py-3 ring-1 ring-inset ring-bench-200">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-bench-900">{skill.name}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-bench-700 ring-1 ring-inset ring-bench-200">
                            {skill.id}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-bench-700">{skill.description}</p>
                        {skill.allowedPatterns.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {skill.allowedPatterns.map((pattern) => (
                              <span key={pattern} className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-bench-700 ring-1 ring-inset ring-bench-200">
                                {pattern}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
