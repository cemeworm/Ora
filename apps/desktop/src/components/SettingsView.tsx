import { ArrowLeft, Settings } from "lucide-react";
import { useRef } from "react";
import { useWorkbench } from "../lib/state";
import { useRunActions } from "../lib/useRunActions";

export function SettingsView() {
  const { state, dispatch } = useWorkbench();
  const { actions } = useRunActions();
  const secretInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="flex h-full flex-col bg-bench-100">
      <div className="border-b border-bench-200 bg-bench-50 px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => dispatch({ type: "SET_VIEW", view: "chat" })}
            className="rounded-md border border-bench-200 bg-white p-2 text-bench-700 shadow-sm transition hover:text-bench-900 active:scale-95"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Settings</p>
            <h2 className="text-lg font-semibold">Provider & Runtime Configuration</h2>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Provider Selection */}
          <section className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
            <div className="flex items-center gap-2 mb-4">
              <Settings size={18} />
              <h3 className="text-sm font-semibold">Provider Settings</h3>
            </div>
            <p className="text-xs text-bench-700 mb-4">Model choice is sent as Ora run config; secrets stay behind Rust Keychain commands.</p>

            <div className="grid grid-cols-3 gap-3">
              {providers.map((provider) => {
                const status = state.providerSecretStatuses.find((entry) => entry.providerId === provider.id);
                const selected = provider.id === state.selectedProviderId;
                return (
                  <button
                    key={provider.id}
                    onClick={() => dispatch({ type: "SET_PROVIDER", providerId: provider.id })}
                    className={`rounded-md px-4 py-3 text-left ring-1 ring-inset transition active:scale-[0.99] ${
                      selected ? "bg-bench-900 text-white ring-bench-900" : "bg-bench-50 text-bench-900 ring-bench-200 hover:bg-white"
                    }`}
                  >
                    <span className="block truncate text-sm font-semibold">{provider.label}</span>
                    <span className={`mt-1 block truncate font-mono text-xs ${selected ? "text-bench-200" : "text-bench-700"}`}>
                      {provider.modelId}
                    </span>
                    <span className={`mt-1 block text-xs ${selected ? "text-bench-200" : "text-bench-700"}`}>
                      {provider.type === "local_smoke" ? "deterministic" : status?.hasSecret ? "keychain ready" : "needs key"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* API Key Management */}
          {selectedProvider && (
            <section className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-semibold">API Key — {selectedProvider.label}</h3>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                    selectedStatus?.hasSecret || !needsSecret
                      ? "bg-lime-50 text-bench-900 ring-lime-200"
                      : "bg-amber-50 text-bench-900 ring-amber-200"
                  }`}
                >
                  {needsSecret ? (selectedStatus?.hasSecret ? "Key ready" : "Key needed") : "Local"}
                </span>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                <input
                  ref={secretInputRef}
                  type="password"
                  disabled={!needsSecret || state.busyCommand !== undefined}
                  placeholder={needsSecret ? `${selectedProvider.label} API key` : "No key required for local smoke"}
                  className="h-10 min-w-0 rounded-md border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  onClick={saveSecret}
                  disabled={!needsSecret || state.busyCommand !== undefined}
                  className="h-10 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save key
                </button>
                <button
                  onClick={() => actions.deleteProviderSecret(selectedProvider.id)}
                  disabled={!needsSecret || state.busyCommand !== undefined || !selectedStatus?.hasSecret}
                  className="h-10 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
              <p className="mt-3 truncate text-xs text-bench-700">{selectedStatus?.detail ?? "Provider status pending."}</p>
            </section>
          )}

          {/* Runtime Status */}
          {state.bridgeStatus && (
            <section className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
              <h3 className="text-sm font-semibold mb-3">Runtime Status</h3>
              <div className="flex items-center gap-2 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${state.bridgeStatus.ok ? "bg-signal-acid" : "bg-red-500"}`} />
                <span className="font-semibold">{state.bridgeStatus.label}</span>
                <span className="text-bench-700">{state.bridgeStatus.detail}</span>
              </div>
              {state.busyCommand && (
                <p className="mt-2 text-xs text-bench-700">{state.busyCommand} in progress.</p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
