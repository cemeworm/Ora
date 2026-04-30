import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Sparkles,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useProviderSetup } from "../../hooks/useProviderSetup";
import { canEditBaseUrl } from "../../lib/providerPresets";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface ProviderOnboardingStepProps {
  onComplete: () => void;
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

export function ProviderOnboardingStep({
  onComplete,
}: ProviderOnboardingStepProps) {
  const [apiKey, setApiKey] = useState("");
  const {
    activePreset,
    draftProviderStatus,
    draftSecretStatus,
    needsSecret,
    providerActionError,
    providerCatalog,
    providerDraft,
    saveDisabled,
    selectedProviderKey,
    selectProviderEntry,
    updateDraft,
    verifyAndEnableProvider,
  } = useProviderSetup({
    initialPresetId: "openrouter",
    syncSelectedProvider: false,
    selectSavedProvider: false,
  });
  const recommendedProviders = useMemo(
    () =>
      providerCatalog
        .filter((entry) => entry.preset.freeTier)
        .sort(
          (left, right) =>
            (left.preset.onboardingPriority ?? 100) -
            (right.preset.onboardingPriority ?? 100),
        ),
    [providerCatalog],
  );
  const selectedProviderHasKey = needsSecret
    ? draftSecretStatus?.hasSecret
    : true;
  const canVerify = !saveDisabled;

  async function handleVerify() {
    const status = await verifyAndEnableProvider(apiKey);
    if (status?.state === "verified") {
      onComplete();
    }
  }

  return (
    <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-h-0 space-y-5">
        {recommendedProviders.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-signal-amber" />
              <h3 className="text-sm font-semibold text-bench-900">
                免费模型推荐
              </h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {recommendedProviders.map((entry) => (
                <ProviderChoiceCard
                  key={entry.key}
                  active={selectedProviderKey === entry.key}
                  entry={entry}
                  onClick={() => {
                    setApiKey("");
                    selectProviderEntry(entry);
                  }}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Zap size={16} className="text-bench-700" />
            <h3 className="text-sm font-semibold text-bench-900">
              全部服务提供方
            </h3>
          </div>
          <div className="grid max-h-[320px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {providerCatalog.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  setApiKey("");
                  selectProviderEntry(entry);
                }}
                className={cn(
                  "flex min-h-[74px] items-center gap-3 rounded-2xl bg-bench-50/40 px-3 py-3 text-left transition hover:bg-white hover:shadow-xs hover:scale-[1.01] active:scale-[0.99]",
                  selectedProviderKey === entry.key && "bg-white shadow-xs",
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bench-100 text-[11px] font-bold text-bench-700">
                  {entry.preset.iconLabel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-bench-900">
                    {entry.label}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-bench-700">
                    {entry.preset.recommendationReason ?? entry.description}
                  </span>
                </span>
                {entry.saved && (
                  <CheckCircle2 size={15} className="shrink-0 text-lime-600" />
                )}
              </button>
            ))}
          </div>
        </section>
      </div>

      <aside className="rounded-2xl bg-sidebar p-5 shadow-pane">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
              已选服务提供方
            </p>
            <h3 className="mt-2 truncate text-xl font-semibold text-bench-900">
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
          <div className="mt-4 rounded-2xl bg-signal-acid/15 px-3 py-2.5 text-xs leading-5 text-bench-900">
            <span className="font-semibold">{activePreset.freeTier.label}</span>
            {activePreset.freeTier.description
              ? ` · ${activePreset.freeTier.description}`
              : ""}
          </div>
        )}

        <div className="mt-5 space-y-4">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
              模型
            </span>
            <Input
              value={providerDraft.modelId}
              onChange={(event) => updateDraft({ modelId: event.target.value })}
              className="h-11 rounded-xl bg-bench-50 font-mono"
            />
          </label>

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
                className="h-11 rounded-xl bg-bench-50 font-mono"
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
                className="h-11 rounded-xl bg-white pl-9"
              />
            </div>
          </label>
        </div>

        <div className="mt-4 rounded-2xl bg-bench-50/60 px-3 py-2.5 text-xs leading-5 text-bench-700">
          {providerActionError ?? draftProviderStatus.detail}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {activePreset.apiKeyUrl && (
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl bg-white"
              asChild
            >
              <a href={activePreset.apiKeyUrl} target="_blank" rel="noreferrer">
                <KeyRound size={15} />
                API 密钥页
                <ExternalLink size={13} />
              </a>
            </Button>
          )}
          <Button
            type="button"
            className="h-11 flex-1 rounded-xl"
            onClick={() => void handleVerify()}
            disabled={!canVerify}
          >
            <CheckCircle2 size={15} />
            验证并进入 Ora
          </Button>
        </div>
      </aside>
    </div>
  );
}

function ProviderChoiceCard({
  active,
  entry,
  onClick,
}: {
  active: boolean;
  entry: ReturnType<typeof useProviderSetup>["providerCatalog"][number];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-[138px] rounded-[22px] bg-bench-50/40 p-4 text-left transition hover:bg-white hover:shadow-xs hover:scale-[1.01] active:scale-[0.99]",
        active && "bg-white shadow-pane",
      )}
    >
      <span className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-bench-100 text-xs font-bold text-bench-700">
          {entry.preset.iconLabel}
        </span>
        <span className="max-w-full truncate rounded-full bg-signal-acid/15 px-2.5 py-1 text-xs font-semibold text-bench-900">
          {entry.preset.freeTier?.label}
        </span>
      </span>
      <span className="mt-4 block text-base font-semibold text-bench-900">
        {entry.label}
      </span>
      <span className="mt-1 block text-sm leading-5 text-bench-700">
        {entry.preset.recommendationReason ?? entry.description}
      </span>
    </button>
  );
}
