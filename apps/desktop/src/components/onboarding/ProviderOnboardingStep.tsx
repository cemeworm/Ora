import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Zap,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useProviderSetup } from "../../hooks/useProviderSetup";
import {
  buildProviderConfigFromDraft,
  canEditBaseUrl,
  type ProviderCatalogEntry,
} from "../../lib/providerPresets";
import type {
  OraProviderModelsResult,
  OraProviderStatus,
} from "../../lib/runtimeClient";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface ProviderOnboardingStepProps {
  onComplete: () => void;
  onSkip: () => void;
}

function statusClasses(state: string) {
  switch (state) {
    case "verified":
      return "bg-lime-50 text-bench-900";
    case "failed":
      return "bg-red-50 text-bench-900";
    case "key_stored":
      return "bg-bench-100 text-bench-900";
    case "needs_key":
      return "bg-amber-50 text-bench-900";
    default:
      return "bg-bench-100 text-bench-900";
  }
}

function statusLabel(state: string) {
  switch (state) {
    case "verified":
      return "已验证";
    case "failed":
      return "验证失败";
    case "key_stored":
      return "密钥已保存";
    case "needs_key":
      return "需要密钥";
    default:
      return "未配置";
  }
}

interface ProviderModelOption {
  id: string;
  label: string;
  authoritativeMissing?: boolean;
}

export function canCompleteProviderOnboarding({
  draftProviderStatus,
  selectedCatalogEntry,
}: {
  draftProviderStatus: OraProviderStatus;
  selectedCatalogEntry?: ProviderCatalogEntry;
}) {
  return (
    draftProviderStatus.state === "verified" ||
    (selectedCatalogEntry?.providers.some(
      (provider) => provider.enabled !== false,
    ) ??
      false)
  );
}

export function ProviderOnboardingStep({
  onComplete,
  onSkip,
}: ProviderOnboardingStepProps) {
  const [apiKey, setApiKey] = useState("");
  const providerModelsRequestRef = useRef(0);
  const [providerModelsResult, setProviderModelsResult] =
    useState<OraProviderModelsResult>();
  const [providerModelsLoading, setProviderModelsLoading] = useState(false);
  const [lastFetchedProviderModelsKey, setLastFetchedProviderModelsKey] =
    useState<string>();
  const {
    actions,
    activePreset,
    buildProviderConfigForModel,
    draftProviderStatus,
    draftSecretStatus,
    modelProviderByModelId,
    needsSecret,
    providerActionError,
    providerCatalog,
    providerDraft,
    runtimeClient,
    saveDisabled,
    selectedCatalogEntry,
    selectedProviderKey,
    selectProviderEntry,
    setProviderActionError,
    updateDraft,
    verifyAndEnableProvider,
  } = useProviderSetup({
    initialPresetId: "deepseek",
    syncSelectedProvider: false,
    selectSavedProvider: false,
  });
  const selectedProviderHasKey = needsSecret
    ? draftSecretStatus?.hasSecret
    : true;
  const canVerify = !saveDisabled;
  const canCompleteOnboarding = canCompleteProviderOnboarding({
    draftProviderStatus,
    selectedCatalogEntry,
  });
  const providerModelsKey = `${providerDraft.type}:${providerDraft.baseUrl}:${providerDraft.apiKeyEnv}:${providerDraft.id}`;
  const activeProviderModelsResult =
    lastFetchedProviderModelsKey === providerModelsKey
      ? providerModelsResult
      : undefined;
  const fetchedModelsAuthoritative =
    activeProviderModelsResult?.status === "ok" &&
    activeProviderModelsResult.authoritative;
  const activeProviderModelIds = new Set(
    activeProviderModelsResult?.models.map((model) => model.id) ?? [],
  );
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
          label: activeProviderModelsResult.authoritative
            ? "远程模型"
            : "预设建议",
        });
      }
    }

    if (providerDraft.modelId.trim()) {
      const missing =
        fetchedModelsAuthoritative &&
        !activeProviderModelIds.has(providerDraft.modelId.trim());
      add({
        id: providerDraft.modelId.trim(),
        label: missing ? "不在提供方列表中" : "当前模型",
        authoritativeMissing: missing,
      });
    }

    for (const provider of selectedCatalogEntry?.providers ?? []) {
      const missing =
        fetchedModelsAuthoritative && !activeProviderModelIds.has(provider.modelId);
      add({
        id: provider.modelId,
        label: provider.enabled !== false ? "已启用" : "已保存，未启用",
        authoritativeMissing: missing,
      });
    }

    if (!fetchedModelsAuthoritative) {
      for (const modelId of modelSuggestions) {
        add({ id: modelId, label: activePreset.label });
      }
    }

    return [...byId.values()];
  }, [
    activePreset.label,
    activeProviderModelIds,
    activeProviderModelsResult,
    fetchedModelsAuthoritative,
    modelSuggestions,
    providerDraft.modelId,
    selectedCatalogEntry,
  ]);
  async function handleVerify() {
    const status = await verifyAndEnableProvider(apiKey);
    if (status?.state === "verified") {
      setApiKey("");
      await fetchModels();
    }
  }

  async function fetchModels() {
    setProviderModelsLoading(true);
    const requestId = ++providerModelsRequestRef.current;
    const key = providerModelsKey;
    setLastFetchedProviderModelsKey(key);
    try {
      const result = await runtimeClient.listProviderModels(
        buildProviderConfigFromDraft(providerDraft),
      );
      if (requestId === providerModelsRequestRef.current) {
        setProviderModelsResult(result);
      }
    } catch (error) {
      if (requestId === providerModelsRequestRef.current) {
        setProviderModelsResult({
          models: [],
          status: "error",
          authoritative: false,
          message:
            error instanceof Error
              ? error.message
              : "获取提供方模型列表失败。",
          fetchedAt: new Date().toISOString(),
        });
      }
    } finally {
      if (requestId === providerModelsRequestRef.current) {
        setProviderModelsLoading(false);
      }
    }
  }

  function resetModelFetchState() {
    setProviderModelsResult(undefined);
    setLastFetchedProviderModelsKey(undefined);
  }

  async function enableModel(modelId: string) {
    const provider = buildProviderConfigForModel(modelId, true);
    updateDraft({ modelId, enabled: true });
    await actions.upsertCustomProvider(provider, { select: true });
  }

  async function disableModel(modelId: string) {
    const provider = buildProviderConfigForModel(modelId, false);
    updateDraft({ modelId, enabled: false });
    await actions.upsertCustomProvider(provider, { select: false });
  }

  return (
    <div className="animate-fade-in mx-auto flex min-h-full w-full flex-col gap-5">
      <div className="relative flex-1 overflow-hidden rounded-[34px]  p-5  sm:p-6 lg:p-7">
        <div className="relative grid min-h-full gap-6 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_460px]">
          <div className="min-h-0 space-y-5">
            <header className="animate-ink-in rounded-[26px]  p-5  sm:p-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h3
                    className="animate-fade-in mt-5 text-2xl font-semibold leading-[0.95] tracking-[-0.05em] text-bench-900 sm:text-5xl lg:text-5xl"
                    style={{ animationDelay: "320ms" }}
                  >
                    <span className="block font-serif italic tracking-[-0.04em]">
                      我还需要配置模型才能启动
                    </span>
                  </h3>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-bench-700"></p>
                </div>
              </div>
            </header>

            <section
              className="animate-ink-in"
              style={{ animationDelay: "150ms" }}
            >
              <div className="grid max-h-[420px] grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3 overflow-y-auto pr-1">
                {providerCatalog.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => {
                      setApiKey("");
                      resetModelFetchState();
                      setProviderActionError(undefined);
                      selectProviderEntry(entry);
                    }}
                    className={cn(
                      "flex min-h-[92px] items-center gap-3 rounded-[20px] border border-bench-200 bg-white px-4 py-3 text-left transition hover:-translate-y-0.5 hover:bg-bench-50 hover:shadow-sm active:scale-[0.99]",
                      selectedProviderKey === entry.key &&
                        "border-bench-900 bg-bench-50 shadow-sm",
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bench-100 text-[11px] font-bold text-bench-700">
                      {entry.preset.iconLabel}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-5 text-bench-900">
                        {entry.label}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-bench-700">
                        {entry.preset.recommendationReason ?? entry.description}
                      </span>
                    </span>
                    {entry.saved && (
                      <CheckCircle2
                        size={15}
                        className="shrink-0 text-lime-600"
                      />
                    )}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside
            className="animate-ink-in flex min-h-full flex-col rounded-[28px] border border-[#d9c8ad] bg-[#fffaf1]/92 p-5 shadow-[0_18px_44px_rgba(77,58,34,0.14),inset_0_1px_0_rgba(255,255,255,0.7)] sm:p-6"
            style={{ animationDelay: "200ms" }}
          >
            <div className="mx-auto mb-4 h-5 w-28 -rotate-1 rounded-sm bg-[#d9b98f]/45 shadow-sm" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bench-600">
                  已选服务提供方
                </p>
                <h3 className="mt-2 truncate text-2xl font-semibold tracking-[-0.03em] text-bench-900">
                  {providerDraft.label || activePreset.label}
                </h3>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                  statusClasses(draftProviderStatus.state),
                )}
              >
                {statusLabel(draftProviderStatus.state)}
              </span>
            </div>

            <p className="mt-3 text-sm leading-6 text-bench-700">
              {activePreset.recommendationReason ?? activePreset.description}
            </p>

            {activePreset.freeTier && (
              <div className="mt-4 rounded-2xl border border-[#e5d4ba] bg-[#f6ead8] px-3 py-2.5 text-xs leading-5 text-bench-900">
                <span className="font-semibold">
                  {activePreset.freeTier.label}
                </span>
                {activePreset.freeTier.description
                  ? ` · ${activePreset.freeTier.description}`
                  : ""}
              </div>
            )}

            <div className="mt-5 space-y-4">
              {canEditBaseUrl(providerDraft.type) && (
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                    Base URL
                  </span>
                  <Input
                    value={providerDraft.baseUrl}
                    onChange={(event) =>
                      updateDraft({ baseUrl: event.target.value })
                    }
                    placeholder="https://provider.example/v1"
                    className="h-11 rounded-xl border-[#e0cfb5] bg-[#f8efe2]/70 font-mono"
                  />
                </label>
              )}

              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                  API 密钥
                </span>
                <div className="relative">
                  <LockKeyhole
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bench-700"
                  />
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    disabled={!needsSecret}
                    placeholder={
                      needsSecret
                        ? selectedProviderHasKey
                          ? "密钥已保存，粘贴新密钥可替换"
                          : `${providerDraft.label || "服务提供方"} API 密钥`
                        : "无需密钥"
                    }
                    className="h-11 rounded-xl border-[#e0cfb5] bg-white/80 pl-9"
                  />
                </div>
              </label>

              <Button
                type="button"
                className="h-11 w-full rounded-xl active:scale-95"
                onClick={() => void handleVerify()}
                disabled={!canVerify || providerModelsLoading}
              >
                <Zap size={15} />
                {providerModelsLoading ? "验证并获取模型中..." : "验证并获取模型"}
              </Button>
            </div>

            <div className="mt-4 rounded-2xl border border-[#e5d4ba] bg-[#f8efe2]/75 px-3 py-2.5 text-xs leading-5 text-bench-700">
              {providerActionError ?? draftProviderStatus.detail}
            </div>

            {(activeProviderModelsResult || draftProviderStatus.state === "verified") && (
              <div className="mt-4 rounded-2xl border border-[#e5d4ba] bg-white/65 p-3">
                <div>
                  <p className="text-sm font-semibold text-bench-900">
                    模型开关
                  </p>
                  <p className="mt-1 text-xs leading-5 text-bench-700">
                    选择要在 Ora 中启用的模型。
                  </p>
                </div>

                {providerModelsResult && (
                  <p className="mt-2 text-xs leading-5 text-bench-700">
                    {providerModelsResult.status === "unsupported"
                      ? "该提供方未开放模型发现。"
                      : providerModelsResult.status === "error"
                        ? providerModelsResult.message ?? "获取提供方模型列表失败。"
                        : providerModelsResult.authoritative
                          ? `已拉取 ${providerModelsResult.models.length} 个远程模型。`
                          : providerModelsResult.message ?? "正在展示预设模型建议。"}
                    {lastFetchedProviderModelsKey &&
                    lastFetchedProviderModelsKey !== providerModelsKey
                      ? " 提供方信息已变化，请重新验证。"
                      : ""}
                  </p>
                )}

                <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-[#e5d4ba] bg-white">
                  {modelOptions.map((modelOption) => {
                    const modelId = modelOption.id;
                    const selected = providerDraft.modelId === modelId;
                    const modelProvider = modelProviderByModelId.get(modelId);
                    const enabled = modelProvider
                      ? modelProvider.enabled !== false
                      : selected && providerDraft.enabled;
                    return (
                      <div
                        key={modelId}
                        className={cn(
                          "flex items-center justify-between gap-3 border-b border-[#efe2cf] px-3 py-2.5 last:border-b-0",
                          selected && "bg-[#f8efe2]/70",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm text-bench-900">
                            {modelId}
                          </p>
                          <p className="mt-0.5 text-xs text-bench-700">
                            {modelOption.authoritativeMissing
                              ? "不在提供方列表中"
                              : enabled
                                ? "已启用"
                                : modelProvider
                                  ? "已保存，未启用"
                                  : modelOption.label}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={
                            enabled ? `停用 ${modelId}` : `启用 ${modelId}`
                          }
                          onClick={() => {
                            void (enabled
                              ? disableModel(modelId)
                              : enableModel(modelId));
                          }}
                          disabled={providerModelsLoading}
                          className="inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition disabled:cursor-not-allowed disabled:opacity-60"
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
                  {modelOptions.length === 0 && (
                    <div className="px-3 py-4 text-sm text-bench-700">
                      没有匹配的模型。
                    </div>
                  )}
                </div>
              </div>
            )}

            {activePreset.apiKeyUrl && (
              <div className="mt-auto pt-5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full rounded-xl border-[#d7c4aa] bg-white/70 active:scale-95"
                  onClick={() => {
                    void runtimeClient.openExternalUrl(activePreset.apiKeyUrl!);
                  }}
                >
                  <KeyRound size={15} />
                  API 密钥页
                  <ExternalLink size={13} />
                </Button>
              </div>
            )}
          </aside>
        </div>
      </div>

      <footer className="-mx-7 -mb-6 flex shrink-0 items-center justify-between gap-3 px-7 py-5">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="rounded-2xl text-bench-700 active:scale-95"
            onClick={onSkip}
          >
            跳过
          </Button>
        </div>
        <Button
          type="button"
          className="rounded-2xl active:scale-95"
          onClick={onComplete}
          disabled={!canCompleteOnboarding}
        >
          <CheckCircle2 size={15} />
          进入 Ora
        </Button>
      </footer>
    </div>
  );
}
