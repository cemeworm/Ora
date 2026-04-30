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
                <ProviderOnboardingStep onComplete={onComplete} />
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
  return (
    <div className="flex min-h-full flex-col items-center justify-center text-center">
      <span className="animate-breathe font-serif text-7xl font-bold text-bench-900">
        O
      </span>
      <h1
        className="animate-fade-in mt-6 text-4xl font-semibold leading-tight text-bench-900 sm:text-5xl"
        style={{ animationDelay: "150ms" }}
      >
        让 AI 按你的方式来。
      </h1>
      <p
        className="animate-fade-in mt-5 max-w-lg text-base leading-7 text-bench-700"
        style={{ animationDelay: "300ms" }}
      >
        同一个窗口里写代码、查资料、跑脚本，不用在十个应用之间切来切去。
        下面选一个服务提供方，一分钟就能开始。
      </p>

      {/* Modes overview */}
      <div className="animate-fade-in mt-10 w-full max-w-xl space-y-4">
        {modeFeatures.map((feature, index) => {
          const Icon = feature.icon;
          const isReversed = index % 2 !== 0;
          return (
            <div
              key={feature.title}
              className={cn(
                "animate-fade-in flex items-start gap-5",
                isReversed && "flex-row-reverse text-right",
              )}
              style={{ animationDelay: `${(index + 2) * 150}ms` }}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-bench-100 text-bench-900">
                <Icon size={20} />
              </div>
              <div className={cn(isReversed ? "text-right" : "text-left")}>
                <h3 className="text-sm font-semibold text-bench-900">
                  {feature.title}
                </h3>
                <p className="mt-0.5 text-sm leading-6 text-bench-700">
                  {feature.body}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
