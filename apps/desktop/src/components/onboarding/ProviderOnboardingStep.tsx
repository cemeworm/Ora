import {
  ArrowLeft,
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
  const [configOpen, setConfigOpen] = useState(false);
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
        fetchedModelsAuthoritative &&
        !activeProviderModelIds.has(provider.modelId);
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
            error instanceof Error ? error.message : "获取提供方模型列表失败。",
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

  function handleSelectProvider(entry: ProviderCatalogEntry) {
    setApiKey("");
    resetModelFetchState();
    setProviderActionError(undefined);
    selectProviderEntry(entry);
    setConfigOpen(true);
  }

  function handleBackToProviderList() {
    setProviderActionError(undefined);
    setConfigOpen(false);
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
    <div className="relative mx-auto flex min-h-screen w-full flex-col gap-5 overflow-y-auto px-4 py-20 sm:px-6 sm:py-24 lg:px-7">
      <div className="animate-fade-in relative flex flex-1 items-center overflow-hidden p-4 sm:p-6 lg:p-7">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-7 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-20">
          <section className="animate-ink-in flex w-full flex-col items-center text-center lg:sticky lg:top-6 lg:items-start lg:text-left">
            <div className="space-y-3">
              <h3 className="text-3xl font-semibold leading-[0.96] tracking-[-0.05em] text-bench-900 sm:text-4xl">
                嗨，欢迎使用 Ora
              </h3>
              <h4 className="text-xl leading-6 text-bench-700">
                配置好模型就可以开始啦
              </h4>
            </div>

            <div className="mt-4 w-full max-w-[700px] sm:max-w-[800px] lg:mx-0">
              <img
                src="/welcome_trans.png"
                alt="小狐狸欢迎图"
                width={1367}
                height={1647}
                className="block h-auto w-full object-contain"
              />
            </div>
          </section>

          <section className="animate-ink-in flex min-h-[520px] w-full flex-col overflow-hidden lg:min-h-[640px]">
            <div className="flex min-h-0 flex-1 flex-col">
              {configOpen ? (
                <div className="mb-3 flex items-start">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleBackToProviderList}
                    className="h-9 shrink-0 rounded-full border border-[#e4d4bc] bg-white/85 px-3.5 text-xs font-semibold text-bench-800 shadow-[0_2px_8px_rgba(90,68,39,0.05)] active:scale-95"
                  >
                    <ArrowLeft size={13} />
                    换一个
                  </Button>
                </div>
              ) : null}

              <div className="relative min-h-0 flex-1">
                <div
                  className={cn(
                    "absolute inset-0 transition-[opacity,transform] duration-300 ease-out",
                    configOpen
                      ? "pointer-events-none translate-y-2 opacity-0"
                      : "translate-y-0 opacity-100",
                  )}
                  aria-hidden={configOpen}
                >
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3 overflow-y-auto pr-1 pt-1">
                    {providerCatalog.map((entry) => (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => handleSelectProvider(entry)}
                        className={cn(
                          "flex min-h-[82px] items-center gap-3 rounded-[18px] border border-[#e6d8c1] bg-white px-4 py-3 text-left shadow-[0_1px_1px_rgba(23,23,23,0.03)] transition-[transform,background-color,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-[#fcf7ef] hover:shadow-[0_8px_18px_rgba(78,58,33,0.08)] active:scale-[0.99]",
                          selectedProviderKey === entry.key &&
                            "bg-[#faf0e3] shadow-[0_4px_14px_rgba(90,68,39,0.07)]",
                        )}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f2e3cf] p-2 text-[11px] font-bold text-bench-700">
                          {entry.preset.logoUrl ? (
                            <img
                              src={entry.preset.logoUrl}
                              alt=""
                              aria-hidden="true"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            entry.preset.iconLabel
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-5 text-bench-900">
                            {entry.label}
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-bench-700">
                            {entry.preset.recommendationReason ??
                              entry.description}
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
                </div>

                <div
                  className={cn(
                    "absolute inset-0 transition-[opacity,transform] duration-300 ease-out",
                    configOpen
                      ? "translate-y-0 opacity-100"
                      : "pointer-events-none translate-y-2 opacity-0",
                  )}
                  aria-hidden={!configOpen}
                >
                  <div className="flex h-full min-h-0 flex-col gap-4 pt-4">
                    <div>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 space-y-2.5">
                          <h4 className="truncate text-2xl font-semibold tracking-[-0.03em] text-bench-900">
                            {providerDraft.label || activePreset.label}
                          </h4>
                        </div>
                        {activePreset.apiKeyUrl ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="mt-0.5 h-9 shrink-0 rounded-full border border-[#e5d4ba] bg-white/78 px-3.5 text-xs font-semibold text-bench-800 shadow-[0_2px_8px_rgba(90,68,39,0.05)] active:scale-95"
                            onClick={() => {
                              void runtimeClient.openExternalUrl(
                                activePreset.apiKeyUrl!,
                              );
                            }}
                          >
                            <KeyRound size={13} />
                            API 密钥页
                            <ExternalLink size={12} />
                          </Button>
                        ) : null}
                      </div>

                      <p className="mt-4 max-w-[32rem] text-sm leading-6 text-bench-700">
                        {activePreset.recommendationReason ??
                          activePreset.description}
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
                    </div>

                    <div className="grid min-h-0 gap-4 overflow-y-auto pr-1 lg:grid-cols-[minmax(0,1fr)]">
                      <div className="space-y-4">
                        <div className="flex flex-col gap-4">
                          {canEditBaseUrl(providerDraft.type) && (
                            <div className="space-y-2">
                              <label
                                htmlFor="onboarding-provider-base-url"
                                className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700"
                              >
                                Base URL
                              </label>
                              <Input
                                id="onboarding-provider-base-url"
                                value={providerDraft.baseUrl}
                                onChange={(event) =>
                                  updateDraft({ baseUrl: event.target.value })
                                }
                                placeholder="https://provider.example/v1"
                                className="h-11 rounded-xl border-[#e0cfb5] bg-white font-mono"
                              />
                            </div>
                          )}

                          <div className="space-y-2">
                            <label
                              htmlFor="onboarding-provider-api-key"
                              className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700"
                            >
                              API 密钥
                            </label>
                            <div className="relative">
                              <LockKeyhole
                                size={16}
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bench-700"
                              />
                              <Input
                                id="onboarding-provider-api-key"
                                type="password"
                                value={apiKey}
                                onChange={(event) =>
                                  setApiKey(event.target.value)
                                }
                                disabled={!needsSecret}
                                placeholder={
                                  needsSecret
                                    ? selectedProviderHasKey
                                      ? "密钥已保存，粘贴新密钥可替换"
                                      : `${providerDraft.label || "服务提供方"} API 密钥`
                                    : "无需密钥"
                                }
                                className="h-11 rounded-xl border-[#e0cfb5] bg-white pl-9"
                              />
                            </div>
                          </div>

                          <div className="pt-6">
                            <Button
                              type="button"
                              className="h-11 w-full rounded-xl active:scale-95"
                              onClick={() => void handleVerify()}
                              disabled={!canVerify || providerModelsLoading}
                            >
                              <Zap size={15} />
                              {providerModelsLoading
                                ? "验证并获取模型中..."
                                : "验证并获取模型"}
                            </Button>
                          </div>
                        </div>

                        {providerActionError ? (
                          <p className="mt-3 text-xs leading-5 text-red-600">
                            {providerActionError}
                          </p>
                        ) : null}
                      </div>

                      {(activeProviderModelsResult ||
                        draftProviderStatus.state === "verified") && (
                        <div>
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
                                  ? (providerModelsResult.message ??
                                    "获取提供方模型列表失败。")
                                  : providerModelsResult.authoritative
                                    ? `已拉取 ${providerModelsResult.models.length} 个远程模型。`
                                    : (providerModelsResult.message ??
                                      "正在展示预设模型建议。")}
                              {lastFetchedProviderModelsKey &&
                              lastFetchedProviderModelsKey !== providerModelsKey
                                ? " 提供方信息已变化，请重新验证。"
                                : ""}
                            </p>
                          )}

                          <div className="mt-3 max-h-[36rem] overflow-y-auto rounded-xl border border-[#e5d4ba] bg-white lg:max-h-[42rem]">
                            {modelOptions.map((modelOption) => {
                              const modelId = modelOption.id;
                              const selected =
                                providerDraft.modelId === modelId;
                              const modelProvider =
                                modelProviderByModelId.get(modelId);
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
                                      enabled
                                        ? `停用 ${modelId}`
                                        : `启用 ${modelId}`
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
                                        enabled
                                          ? "bg-bench-900"
                                          : "bg-bench-200",
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
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
        <div className="relative mx-auto w-full px-4 sm:px-6 lg:px-7">
          <div className="pointer-events-none absolute inset-x-4 bottom-full h-16 bg-gradient-to-b from-[#efe5d6]/0 via-[#efe5d6]/42 to-[#f7f0e5]/92 sm:inset-x-6 lg:inset-x-7" />
          <footer className="animate-fade-in relative mb-4 flex items-center justify-between gap-3 sm:mb-6 lg:mb-7">
            <div className="pointer-events-auto flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                className="rounded-2xl border border-[#e1d0b7]/75 bg-[#f8f1e6]/88 px-4 py-2.5 whitespace-nowrap text-bench-700 shadow-[0_10px_22px_rgba(90,68,39,0.12)] backdrop-blur-md active:scale-95"
                onClick={onSkip}
              >
                跳过
              </Button>
            </div>
            <Button
              type="button"
              className="pointer-events-auto rounded-2xl border border-black/10 bg-black px-4 py-2.5 whitespace-nowrap shadow-[0_14px_28px_rgba(0,0,0,0.24)] active:scale-95"
              onClick={onComplete}
              disabled={!canCompleteOnboarding}
            >
              <CheckCircle2 size={15} />
              进入 Ora
            </Button>
          </footer>
        </div>
      </div>
    </div>
  );
}
