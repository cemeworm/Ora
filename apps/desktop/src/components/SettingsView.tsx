import { Activity, Bot, Settings, Sparkles, Wrench, X } from "lucide-react";
import { useRef, useState } from "react";
import { useWorkbench } from "../lib/state";
import { useRunActions } from "../lib/useRunActions";
import { cn } from "../lib/utils";
import { Dialog, DialogContent } from "./ui/dialog";

type SettingsSection = "providers" | "runtime" | "tools" | "skills";

const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: typeof Settings;
}> = [
  { id: "providers", label: "Providers", description: "Model providers and keys", icon: Bot },
  { id: "runtime", label: "Runtime", description: "Bridge health and status", icon: Activity },
  { id: "tools", label: "Tools", description: "Available tool registry", icon: Wrench },
  { id: "skills", label: "Skills", description: "Installed skill registry", icon: Sparkles },
];

interface SettingsViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsView({ open, onOpenChange }: SettingsViewProps) {
  const { state, dispatch } = useWorkbench();
  const { actions } = useRunActions();
  const secretInputRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("providers");
  const [customProvider, setCustomProvider] = useState({
    id: "",
    label: "",
    baseUrl: "",
    modelId: "",
    apiKeyEnv: "",
  });

  const providers = state.providerRegistry?.providers ?? [];
  const selectedProvider = providers.find((p) => p.id === state.selectedProviderId) ?? providers[0];
  const selectedStatus = state.providerSecretStatuses.find((s) => s.providerId === selectedProvider?.id);
  const needsSecret = selectedProvider && selectedProvider.type !== "local_smoke";

  function saveSecret() {
    if (!selectedProvider || !secretInputRef.current) return;
    const secret = secretInputRef.current.value.trim();
    if (!secret) return;
    actions.storeProviderSecret(selectedProvider.id, secret);
    secretInputRef.current.value = "";
  }

  function providerIdFromLabel(label: string) {
    return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom-provider";
  }

  function saveCustomProvider() {
    const label = customProvider.label.trim();
    const baseUrl = customProvider.baseUrl.trim();
    const modelId = customProvider.modelId.trim();
    if (!label || !baseUrl || !modelId) return;

    const id = providerIdFromLabel(customProvider.id || label);
    actions.upsertCustomProvider({
      id,
      type: "openai_compatible",
      label,
      modelId,
      baseUrl,
      apiKeyEnv: customProvider.apiKeyEnv.trim() || undefined,
      enabled: true,
      maxTokens: 8192,
      capabilities: ["chat"],
      dropParams: [],
    });
    setCustomProvider({ id: "", label: "", baseUrl: "", modelId: "", apiKeyEnv: "" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88vh,860px)] w-full max-w-[1120px] flex-col overflow-hidden rounded-[28px] border border-black/[0.03] bg-background p-0 shadow-lift">
        <div className="flex items-start justify-between gap-4 border-b border-border/80 bg-sidebar/90 px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Settings</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.012em] text-bench-900">Provider & Runtime Configuration</h2>
            <p className="mt-2 max-w-2xl text-sm text-bench-700">
              Tune Ora&apos;s provider, runtime, tool, and skill settings without leaving the current workspace.
            </p>
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

        <div className="grid min-h-0 flex-1 grid-cols-1 bg-background lg:grid-cols-[240px_minmax(0,1fr)]">
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
                        <span className={cn("mt-0.5 block text-xs", active ? "text-bench-200" : "text-bench-700")}>
                          {section.description}
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
              {activeSection === "providers" && (
                <>
                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="mb-4 flex items-center gap-2">
                      <Settings size={18} />
                      <div>
                        <h3 className="text-sm font-semibold">Provider Settings</h3>
                        <p className="mt-1 text-xs text-bench-700">
                          Model choice is sent as Ora run config; secrets stay behind Rust Keychain commands.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {providers.map((provider) => {
                        const status = state.providerSecretStatuses.find((entry) => entry.providerId === provider.id);
                        const selected = provider.id === state.selectedProviderId;
                        return (
                          <button
                            key={provider.id}
                            onClick={() => dispatch({ type: "SET_PROVIDER", providerId: provider.id })}
                            className={cn(
                              "rounded-2xl px-4 py-4 text-left ring-1 ring-inset transition active:scale-[0.99]",
                              selected
                                ? "bg-bench-900 text-white ring-bench-900"
                                : "bg-bench-50 text-bench-900 ring-bench-200 hover:bg-white",
                            )}
                          >
                            <span className="block truncate text-sm font-semibold">{provider.label}</span>
                            <span className={cn("mt-1 block truncate font-mono text-xs", selected ? "text-bench-200" : "text-bench-700")}>
                              {provider.modelId}
                            </span>
                            <span className={cn("mt-2 block text-xs", selected ? "text-bench-200" : "text-bench-700")}>
                              {provider.type === "local_smoke"
                                ? "deterministic"
                                : status?.hasSecret
                                  ? "keychain ready"
                                  : provider.type === "openai_compatible"
                                    ? "custom endpoint"
                                    : "needs key"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">Add OpenAI-Compatible Provider</h3>
                        <p className="mt-1 text-xs text-bench-700">
                          Add custom chat-completions endpoints without exposing API keys to the React app.
                        </p>
                      </div>
                      <span className="rounded-full bg-bench-50 px-2.5 py-1 text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                        chat completions
                      </span>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={customProvider.label}
                        onChange={(event) => setCustomProvider((provider) => ({ ...provider, label: event.target.value }))}
                        placeholder="Provider name"
                        className="h-11 min-w-0 rounded-xl border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                      />
                      <input
                        value={customProvider.id}
                        onChange={(event) => setCustomProvider((provider) => ({ ...provider, id: event.target.value }))}
                        placeholder="Provider id"
                        className="h-11 min-w-0 rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                      />
                      <input
                        value={customProvider.baseUrl}
                        onChange={(event) => setCustomProvider((provider) => ({ ...provider, baseUrl: event.target.value }))}
                        placeholder="https://provider.example/v1"
                        className="h-11 min-w-0 rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                      />
                      <input
                        value={customProvider.modelId}
                        onChange={(event) => setCustomProvider((provider) => ({ ...provider, modelId: event.target.value }))}
                        placeholder="model id"
                        className="h-11 min-w-0 rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                      />
                      <input
                        value={customProvider.apiKeyEnv}
                        onChange={(event) => setCustomProvider((provider) => ({ ...provider, apiKeyEnv: event.target.value.toUpperCase() }))}
                        placeholder="API_KEY_ENV optional"
                        className="h-11 min-w-0 rounded-xl border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 md:col-span-2"
                      />
                    </div>

                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={saveCustomProvider}
                        disabled={!customProvider.label.trim() || !customProvider.baseUrl.trim() || !customProvider.modelId.trim() || state.busyCommand !== undefined}
                        className="h-10 rounded-xl bg-bench-900 px-4 text-sm font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save provider
                      </button>
                    </div>
                  </section>

                  {selectedProvider && (
                    <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold">API Key — {selectedProvider.label}</h3>
                          <p className="mt-1 text-xs text-bench-700">Secrets are saved through the platform keychain bridge.</p>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                            selectedStatus?.hasSecret || !needsSecret
                              ? "bg-lime-50 text-bench-900 ring-lime-200"
                              : "bg-amber-50 text-bench-900 ring-amber-200",
                          )}
                        >
                          {needsSecret ? (selectedStatus?.hasSecret ? "Key ready" : "Key needed") : "Local"}
                        </span>
                      </div>

                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
                        <input
                          ref={secretInputRef}
                          type="password"
                          disabled={!needsSecret || state.busyCommand !== undefined}
                          placeholder={needsSecret ? `${selectedProvider.label} API key` : "No key required for local smoke"}
                          className="h-11 min-w-0 rounded-xl border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <button
                          onClick={saveSecret}
                          disabled={!needsSecret || state.busyCommand !== undefined}
                          className="h-11 rounded-xl bg-bench-900 px-4 text-sm font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save key
                        </button>
                        <button
                          onClick={() => actions.deleteProviderSecret(selectedProvider.id)}
                          disabled={!needsSecret || state.busyCommand !== undefined || !selectedStatus?.hasSecret}
                          className="h-11 rounded-xl border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                        <button
                          onClick={() => actions.deleteCustomProvider(selectedProvider.id)}
                          disabled={selectedProvider.type !== "openai_compatible" || state.busyCommand !== undefined}
                          className="h-11 rounded-xl border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                      <p className="mt-3 truncate text-xs text-bench-700">{selectedStatus?.detail ?? "Provider status pending."}</p>
                    </section>
                  )}
                </>
              )}

              {activeSection === "runtime" && state.bridgeStatus && (
                <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                  <h3 className="text-sm font-semibold">Runtime Status</h3>
                  <p className="mt-1 text-xs text-bench-700">Monitor the runtime bridge before you start a new turn.</p>
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
              )}

              {activeSection === "tools" && state.toolRegistry && (
                <section className="rounded-[22px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                  <h3 className="text-sm font-semibold">Tool Registry</h3>
                  <p className="mt-1 text-xs text-bench-700">Inspect the tools that the runtime advertises to the desktop workbench.</p>
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
                  <p className="mt-1 text-xs text-bench-700">Review installed skills and the coordination patterns they support.</p>
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
