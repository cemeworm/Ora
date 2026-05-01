import {
  ArrowLeft,
  ArrowRight,
  Bot,
  KeyRound,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ProviderOnboardingStep } from "./ProviderOnboardingStep";

interface OnboardingViewProps {
  onComplete: () => void;
  onSkip: () => void;
}

const steps = [
  { id: "welcome", label: "Welcome" },
  { id: "provider", label: "Provider" },
] as const;

const modeFeatures = [
  {
    icon: MessageSquare,
    title: "对话风格你来定",
    body: "需要直接答案、一起讨论方案、还是逐步确认？换个模式，Ora 的回答方式跟着变。",
  },
  {
    icon: Bot,
    title: "干活有工具，聊天不干扰",
    body: "写代码时带上终端和文件访问，闲聊时只保留搜索。每个场景配合适的工具。",
  },
  {
    icon: ShieldCheck,
    title: "重要的你来把关",
    body: "删文件、跑命令这类操作，可以让 Ora 先问你。日常小事它自己跑就行。",
  },
] as const;

export function OnboardingView({ onComplete, onSkip }: OnboardingViewProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const isFirstStep = stepIndex === 0;
  const isProviderStep = stepIndex === steps.length - 1;

  return (
    <main className="flex h-full min-h-0 w-full bg-background p-3 text-bench-900 sm:p-4">
      <section className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-[28px] bg-sidebar shadow-pane">
        {/* Progress bar */}
        <div className="flex shrink-0 items-center gap-3 px-7 pt-6 pb-2">
          <div className="flex-1">
            <div className="h-[2px] rounded-full bg-bench-200">
              <div
                className="h-full rounded-full bg-bench-900 transition-all duration-500 ease-out"
                style={{
                  width: `${((stepIndex + 1) / steps.length) * 100}%`,
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {steps.map((step) => {
              const index = steps.indexOf(step);
              return (
                <span
                  key={step.id}
                  className={cn(
                    "h-2 w-2 rounded-full transition-all duration-300",
                    index === stepIndex
                      ? "bg-bench-900"
                      : index < stepIndex
                        ? "bg-bench-400"
                        : "bg-bench-200",
                  )}
                />
              );
            })}
          </div>
        </div>

        {/* Step content — absolute positioned for slide transitions */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                "absolute inset-0 overflow-y-auto px-7 py-6 transition-all duration-500 ease-out",
                index === stepIndex
                  ? "translate-x-0 opacity-100"
                  : index < stepIndex
                    ? "-translate-x-8 opacity-0 pointer-events-none"
                    : "translate-x-8 opacity-0 pointer-events-none",
              )}
            >
              {step.id === "welcome" && <WelcomeStep />}
              {step.id === "provider" && (
                <ProviderOnboardingStep
                  onBack={() => setStepIndex(0)}
                  onComplete={onComplete}
                  onSkip={onSkip}
                />
              )}
            </div>
          ))}
        </div>

        {/* Footer navigation */}
        {!isProviderStep && (
          <footer className="flex shrink-0 items-center justify-between gap-3 px-7 py-5">
            {isFirstStep ? (
              <Button
                type="button"
                variant="ghost"
                className="rounded-2xl"
                onClick={onSkip}
              >
                跳过
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="rounded-2xl"
                onClick={() =>
                  setStepIndex((current) => Math.max(0, current - 1))
                }
              >
                <ArrowLeft size={15} />
                上一步
              </Button>
            )}
            <Button
              type="button"
              className="rounded-2xl"
              onClick={() =>
                setStepIndex((current) =>
                  Math.min(steps.length - 1, current + 1),
                )
              }
            >
              继续
              <ArrowRight size={15} />
            </Button>
          </footer>
        )}
      </section>
    </main>
  );
}

function WelcomeStep() {
  const notePositions = [
    "sm:absolute sm:left-0 sm:top-2 sm:w-[53%] sm:-rotate-2",
    "sm:absolute sm:right-0 sm:top-28 sm:w-[55%] sm:rotate-2",
    "sm:absolute sm:left-14 sm:bottom-0 sm:w-[56%] sm:-rotate-1",
  ];

  return (
    <div className="mx-auto grid min-h-full w-full max-w-6xl items-center gap-10 py-8 text-left lg:grid-cols-[0.9fr_1.1fr] lg:py-4">
      <div className="max-w-xl">
        <p
          className="animate-fade-in text-sm font-semibold tracking-[0.28em] text-bench-600"
          style={{ animationDelay: "120ms" }}
        >
          嗨，我是 Ora
        </p>
        <h1
          className="animate-fade-in mt-5 text-5xl font-semibold leading-[0.95] tracking-[-0.05em] text-bench-900 sm:text-6xl lg:text-7xl"
          style={{ animationDelay: "320ms" }}
        >
          把事情做完，
          <span className="block font-serif italic tracking-[-0.04em]">
            不用切来切去。
          </span>
        </h1>
        <p
          className="animate-fade-in mt-7 max-w-md text-base leading-8 text-bench-700"
          style={{ animationDelay: "520ms" }}
        >
          Ora 是你的 AI 工作台。写文档、查资料、跑任务，都在这一个窗口里完成。
          选一个服务，一分钟就能开始。
        </p>
        <div
          className="animate-fade-in mt-8 inline-flex items-center gap-3 rounded-full border border-bench-200 bg-white/55 px-4 py-2 text-sm text-bench-700 shadow-sm"
          style={{ animationDelay: "720ms" }}
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          只需两步，即可开始使用
        </div>
      </div>

      <div
        className="animate-fade-in relative mx-auto w-full max-w-2xl"
        style={{ animationDelay: "420ms" }}
        aria-label="Ora 工作台插画"
      >
        <div className="absolute -left-5 top-10 h-28 w-24 -rotate-6 rounded-3xl border border-[#dbcbb3] bg-[#eee1cf] shadow-sm" />
        <div className="absolute -right-3 bottom-8 h-32 w-28 rotate-6 rounded-3xl border border-[#d8c4a6] bg-[#f0dcc1] shadow-sm" />

        <div className="animate-paper-float relative overflow-hidden rounded-[34px] border border-[#d6c4a8] bg-[#f8efe2] p-5 shadow-[0_24px_70px_rgba(77,58,34,0.16)] sm:p-7">
          <div
            className="absolute inset-0 opacity-45"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(89, 70, 44, 0.16) 1px, transparent 0)",
              backgroundSize: "22px 22px",
            }}
          />
          <div className="absolute left-1/2 top-3 h-6 w-28 -translate-x-1/2 -rotate-2 rounded-sm bg-[#d9b98f]/55 shadow-sm" />
          <div className="relative rounded-[26px] border border-[#d9c8ad] bg-[#fffaf1]/90 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="animate-ink-in text-xs font-semibold uppercase tracking-[0.35em] text-bench-500">
                  Ora desk map
                </p>
                <p className="animate-ink-in mt-3 font-serif text-6xl font-bold leading-none text-bench-900 sm:text-7xl">
                  Ora
                </p>
              </div>
              <div className="animate-ink-in rounded-full border border-[#dac8ad] bg-[#f6ead8] px-3 py-1 text-xs font-medium text-bench-700">
                先聊清楚，再动手
              </div>
            </div>

            <svg
              className="pointer-events-none absolute inset-x-7 top-32 hidden h-40 text-[#b99363] opacity-45 sm:block"
              viewBox="0 0 520 180"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M148 22 C212 34 220 78 292 75 C358 72 380 44 432 64"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="7 9"
              />
              <path
                d="M114 118 C188 90 220 142 302 128 C356 118 380 100 438 130"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="7 9"
              />
            </svg>

            <div className="relative mt-9 grid gap-4 sm:min-h-[330px] sm:block">
              {modeFeatures.map((feature, index) => {
                const Icon = feature.icon;
                const notePosition = notePositions[index] ?? "";

                return (
                  <div
                    key={feature.title}
                    className={cn(
                      "animate-ink-in rounded-[24px] border border-[#decbb0] bg-[#fff7ea] p-4 text-left shadow-[0_12px_32px_rgba(86,62,33,0.10)]",
                      notePosition,
                    )}
                    style={{ animationDelay: `${780 + index * 200}ms` }}
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#efe0ca] text-bench-900">
                        <Icon size={18} />
                      </span>
                      <h3 className="text-sm font-semibold text-bench-900">
                        {feature.title}
                      </h3>
                    </div>
                    <p className="text-sm leading-6 text-bench-700">
                      {feature.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
