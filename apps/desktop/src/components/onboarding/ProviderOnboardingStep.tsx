import {
  ArrowLeft,
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
  onBack: () => void;
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

export function ProviderOnboardingStep({
  onBack,
  onComplete,
  onSkip,
}: ProviderOnboardingStepProps) {
  const [apiKey, setApiKey] = useState("");
  const [showAllProviders, setShowAllProviders] = useState(false);
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
    <div className="animate-fade-in mx-auto flex min-h-full w-full flex-col gap-5">
      <div className="relative flex-1 overflow-hidden rounded-[34px] border border-bench-200 bg-white/80 p-5 shadow-sm sm:p-6 lg:p-7">
        <div className="relative grid min-h-full gap-6 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_460px]">
          <div className="min-h-0 space-y-5">
            <header className="animate-ink-in rounded-[26px] border border-bench-200 bg-white p-5 shadow-sm sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-bench-500">
                Connect a provider
              </p>
              <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h2 className="text-4xl font-semibold tracking-[-0.05em] text-bench-900 xl:text-5xl">
                    选择你的 AI 引擎。
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-bench-700">
                    推荐从免费模型开始，有自有密钥也可以随时填入。随时可以跳过，之后在设置里更改。
                  </p>
                </div>
                <span className="w-fit rounded-full border border-bench-200 bg-bench-50 px-3 py-1.5 text-xs font-medium text-bench-600">
                  最后一步
                </span>
              </div>
            </header>

            {recommendedProviders.length > 0 && (
              <section className="animate-ink-in" style={{ animationDelay: "150ms" }}>
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles size={16} className="text-signal-amber" />
                  <h3 className="text-sm font-semibold text-bench-900">
                    免费推荐
                  </h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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

            {!showAllProviders ? (
              <div className="animate-ink-in flex justify-center" style={{ animationDelay: "280ms" }}>
                <button
                  type="button"
                  onClick={() => setShowAllProviders(true)}
                  className="flex items-center gap-2 rounded-2xl border border-bench-200 bg-white px-5 py-2.5 text-sm font-medium text-bench-700 shadow-sm transition hover:bg-bench-50 hover:shadow active:scale-[0.99]"
                >
                  <Zap size={16} />
                  显示更多服务提供方
                </button>
              </div>
            ) : (
              <section className="animate-ink-in" style={{ animationDelay: "280ms" }}>
                <div className="mb-3 flex items-center gap-2">
                  <Zap size={16} className="text-bench-700" />
                  <h3 className="text-sm font-semibold text-bench-900">
                    全部服务提供方
                  </h3>
                </div>
                <div className="grid max-h-[360px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-4">
                  {providerCatalog.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => {
                        setApiKey("");
                        selectProviderEntry(entry);
                      }}
                      className={cn(
                        "flex min-h-[76px] items-center gap-3 rounded-[20px] border border-bench-200 bg-white px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-bench-50 hover:shadow-sm active:scale-[0.99]",
                        selectedProviderKey === entry.key &&
                          "border-bench-900 bg-bench-50 shadow-sm",
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
                        <CheckCircle2
                          size={15}
                          className="shrink-0 text-lime-600"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}
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
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-bench-700">
                  模型
                </span>
                <Input
                  value={providerDraft.modelId}
                  onChange={(event) =>
                    updateDraft({ modelId: event.target.value })
                  }
                  className="h-11 rounded-xl border-[#e0cfb5] bg-[#f8efe2]/70 font-mono"
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
            </div>

            <div className="mt-4 rounded-2xl border border-[#e5d4ba] bg-[#f8efe2]/75 px-3 py-2.5 text-xs leading-5 text-bench-700">
              {providerActionError ?? draftProviderStatus.detail}
            </div>

            {activePreset.apiKeyUrl && (
              <div className="mt-auto pt-5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full rounded-xl border-[#d7c4aa] bg-white/70 active:scale-95"
                  asChild
                >
                  <a
                    href={activePreset.apiKeyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <KeyRound size={15} />
                    API 密钥页
                    <ExternalLink size={13} />
                  </a>
                </Button>
              </div>
            )}
          </aside>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="rounded-2xl text-bench-700 active:scale-95"
            onClick={onBack}
          >
            <ArrowLeft size={15} />
            返回上一页
          </Button>
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
          onClick={() => void handleVerify()}
          disabled={!canVerify}
        >
          <CheckCircle2 size={15} />
          验证并进入 Ora
        </Button>
      </footer>
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
        "min-h-[132px] rounded-[24px] border border-bench-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-bench-50 hover:shadow-sm active:scale-[0.99]",
        active && "border-bench-900 bg-bench-50 shadow-sm",
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
