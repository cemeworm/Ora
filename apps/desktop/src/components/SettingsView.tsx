import type { ProviderCapability } from "@ora/shared";
import { Activity, Bot, ChevronDown, ChevronUp, Globe2, Settings, Sparkles, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkbench } from "../lib/state";
import {
  BUILT_IN_PROVIDER_IDS,
  PROVIDER_PRESETS,
  buildProviderConfigFromDraft,
  canEditBaseUrl,
  createDraftFromPreset,
  createDraftFromProvider,
  findPresetById,
  findPresetForProvider,
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
import { cn } from "../lib/utils";
import { LANGUAGE_OPTIONS } from "../lib/i18n";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

type SettingsSection = "general" | "providers" | "runtime" | "tools" | "skills";

const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof Settings;
}> = [
  { id: "general", label: "General", icon: Globe2 },
  { id: "providers", label: "Providers", icon: Bot },
  { id: "runtime", label: "Runtime", icon: Activity },
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

function emptyDraft(): ProviderDraft {
  return createDraftFromPreset(PROVIDER_PRESETS[0], []);
}

export function SettingsView({ open, onOpenChange }: SettingsViewProps) {
  const { state, dispatch } = useWorkbench();
  const { actions } = useRunActions();
  const secretInputRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("openai-compatible-generic");
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(emptyDraft());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [searchSettings, setSearchSettings] = useState<DesktopSearchSettings>(() => loadDesktopSearchSettings());

  const providers = state.providerRegistry?.providers ?? [];
  const selectedProvider = providers.find((provider) => provider.id === state.selectedProviderId) ?? providers[0];
  const selectedPreset = useMemo(() => findPresetById(selectedTemplateId), [selectedTemplateId]);
  const activePreset = useMemo(() => findPresetById(providerDraft.presetId), [providerDraft.presetId]);

  useEffect(() => {
    if (!selectedProvider) {
      return;
    }
    const preset = findPresetForProvider(selectedProvider);
    setSelectedTemplateId(preset.id);
    setProviderDraft(createDraftFromProvider(selectedProvider));
  }, [selectedProvider]);

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

  function loadTemplate() {
    const preset = findPresetById(selectedTemplateId);
    if (preset.fixedProviderId) {
      const existing = providers.find((provider) => provider.id === preset.fixedProviderId);
      if (existing) {
        dispatch({ type: "SET_PROVIDER", providerId: existing.id });
        setProviderDraft(createDraftFromProvider(existing));
        setSelectedTemplateId(preset.id);
        return;
      }
    }

    setProviderDraft(createDraftFromPreset(preset, providers));
    setSelectedTemplateId(preset.id);
  }

  function saveSecret() {
    if (!secretInputRef.current) return;
    const secret = secretInputRef.current.value.trim();
    if (!secret) return;
    void actions.storeProviderSecret(providerDraft.id, secret);
    secretInputRef.current.value = "";
  }

  function saveProvider() {
    void actions.upsertCustomProvider(draftProvider);
  }

  function verifyProvider() {
    void actions.verifyProvider(draftProvider);
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
          <aside className="border-b border-border bg-sidebar/75 p-4 lg:border-b-0 lg:border-r">
            <div className="rounded-[22px] bg-white/72 p-2 shadow-xs ring-1 ring-inset ring-bench-200/85">
              <nav className="space-y-1.5">
                {settingsSections.map((section) => {
                  const Icon = section.icon;
                  const active = section.id === activeSection;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition active:scale-[0.99]",
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
                        <span className="block text-sm font-semibold">{section.label}</span>
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
                <>
                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <Settings size={18} />
                          <h3 className="text-sm font-semibold">Provider Settings</h3>
                        </div>
                        <p className="text-sm leading-6 text-bench-700">
                          Use one provider flow: choose an API provider, load a template when needed, then save and verify from the same form.
                        </p>
                      </div>
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", statusClasses(draftProviderStatus.state))}>
                        {statusLabel(draftProviderStatus.state)}
                      </span>
                    </div>

                    <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_auto]">
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">API Provider</span>
                        <select
                          value={selectedProvider?.id ?? ""}
                          onChange={(event) => dispatch({ type: "SET_PROVIDER", providerId: event.target.value })}
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                        >
                          {providers.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.label} · {provider.type}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Template</span>
                        <select
                          value={selectedTemplateId}
                          onChange={(event) => setSelectedTemplateId(event.target.value)}
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                        >
                          <optgroup label="Official">
                            {PROVIDER_PRESETS.filter((preset) => preset.group === "official").map((preset) => (
                              <option key={preset.id} value={preset.id}>{preset.label}</option>
                            ))}
                          </optgroup>
                          <optgroup label="Templates">
                            {PROVIDER_PRESETS.filter((preset) => preset.group === "template").map((preset) => (
                              <option key={preset.id} value={preset.id}>{preset.label}</option>
                            ))}
                          </optgroup>
                        </select>
                      </label>

                      <div className="flex items-end">
                        <Button type="button" variant="outline" className="h-11 rounded-xl px-4" onClick={loadTemplate}>
                          Load Template
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 rounded-2xl bg-bench-50/80 px-4 py-3 ring-1 ring-inset ring-bench-200">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700 ring-1 ring-inset ring-bench-200">
                          {providerDraft.type}
                        </span>
                        {providerDraft.type === "openai_compatible" && (
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700 ring-1 ring-inset ring-bench-200">
                            {providerDraft.protocol === "responses" ? "Responses API" : "Chat Completions"}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-bench-700">{activePreset.description}</p>
                      <p className="mt-2 text-xs text-bench-700">{draftProviderStatus.detail}</p>
                    </div>
                  </section>

                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Provider Name</span>
                        <input
                          value={providerDraft.label}
                          onChange={(event) => updateDraft({ label: event.target.value })}
                          placeholder="Provider name"
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                        />
                      </label>

                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">API Key Env</span>
                        <input
                          value={providerDraft.apiKeyEnv}
                          onChange={(event) => updateDraft({ apiKeyEnv: event.target.value.toUpperCase() })}
                          placeholder="OPENAI_API_KEY"
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                        />
                      </label>

                      {canEditBaseUrl(providerDraft.type) && (
                        <label className="space-y-2 lg:col-span-2">
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

                      <label className="space-y-2 lg:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Model</span>
                        <input
                          list={`provider-models-${providerDraft.id}`}
                          value={providerDraft.modelId}
                          onChange={(event) => updateDraft({ modelId: event.target.value })}
                          placeholder="Model ID"
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                        />
                        <datalist id={`provider-models-${providerDraft.id}`}>
                          {modelSuggestions.map((modelId) => (
                            <option key={modelId} value={modelId} />
                          ))}
                        </datalist>
                      </label>
                    </div>

                    <div className="mt-5 rounded-[22px] bg-bench-50/70 p-4 ring-1 ring-inset ring-bench-200">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-bench-900">Provider Secret</h4>
                          <p className="mt-1 text-xs text-bench-700">
                            Secrets stay in the runtime layer and Keychain. This form never stores the raw key in React state.
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
                          Save Key
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl px-4"
                          onClick={() => void actions.deleteProviderSecret(providerDraft.id)}
                          disabled={!needsSecret || state.busyCommand !== undefined || !draftSecretStatus?.hasSecret}
                        >
                          Remove Key
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
                          <span className="block text-sm font-semibold text-bench-900">Model Configuration</span>
                          <span className="mt-1 block text-xs text-bench-700">Protocol, limits, capability flags, drop params, and optional headers.</span>
                        </span>
                        {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>

                      {advancedOpen && (
                        <div className="mt-3 space-y-4 rounded-[22px] bg-bench-50/60 p-4 ring-1 ring-inset ring-bench-200">
                          <div className="grid gap-4 lg:grid-cols-2">
                            {providerDraft.type === "openai_compatible" && (
                              <label className="space-y-2">
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">Protocol</span>
                                <select
                                  value={providerDraft.protocol}
                                  onChange={(event) => updateDraft({ protocol: event.target.value as ProviderDraft["protocol"] })}
                                  className="h-11 w-full rounded-xl border border-bench-200 bg-white px-3 text-sm outline-none transition focus:border-bench-900"
                                >
                                  <option value="chat_completions">Chat Completions</option>
                                  <option value="responses">Responses</option>
                                </select>
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
                        </div>
                      )}
                    </div>

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-bench-700">
                        Provider id: <span className="font-mono">{providerDraft.id}</span>
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" className="rounded-xl" onClick={verifyProvider} disabled={state.busyCommand !== undefined}>
                          Verify
                        </Button>
                        <Button type="button" className="rounded-xl" onClick={saveProvider} disabled={saveDisabled}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => void actions.deleteCustomProvider(providerDraft.id)}
                          disabled={!canDeleteProvider || state.busyCommand !== undefined}
                        >
                          Delete Custom Provider
                        </Button>
                      </div>
                    </div>
                  </section>
                </>
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
                        <select
                          value={searchSettings.providerId}
                          disabled={!searchSettings.enabled}
                          onChange={(event) => updateSearchSettings({ providerId: event.target.value as DesktopSearchProviderId })}
                          className="h-11 w-full rounded-xl border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {searchProviderOptions.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.label}</option>
                          ))}
                        </select>
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
