import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  KeyRound,
  MessageSquare,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
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
  { id: "welcome", label: "Welcome", icon: Sparkles },
  { id: "modes", label: "Modes", icon: SlidersHorizontal },
  { id: "provider", label: "Provider", icon: KeyRound },
] as const;

const modeFeatures = [
  {
    icon: MessageSquare,
    title: "Collaboration style",
    body: "Modes shape how direct, exploratory, careful, or concise Ora should be in a conversation.",
  },
  {
    icon: Bot,
    title: "Tool access",
    body: "Each Mode can carry its own tool choices, so project work and everyday chat do not need the same setup.",
  },
  {
    icon: ShieldCheck,
    title: "Safety behavior",
    body: "Approvals, output format, and boundaries can match the kind of work you are doing.",
  },
] as const;

export function OnboardingView({ onComplete, onSkip }: OnboardingViewProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const isFirstStep = stepIndex === 0;
  const isProviderStep = stepIndex === steps.length - 1;

  return (
    <main className="flex h-full min-h-0 w-full bg-background p-3 text-bench-900 sm:p-4">
      <section className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-[28px] bg-sidebar shadow-pane ring-1 ring-inset ring-bench-200">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-bench-200/80 px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-bench-900 text-sm font-bold text-white shadow-xs">
              O
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-bench-900">
                Ora first-use setup
              </p>
              <p className="truncate text-xs text-bench-700">
                Configure the workspace once, then start chatting.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl bg-white"
            onClick={onSkip}
          >
            Skip
          </Button>
        </header>

        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-bench-200/70 px-5 py-3 sm:px-7">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const active = index === stepIndex;
            const complete = index < stepIndex;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setStepIndex(index)}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-semibold transition",
                  active
                    ? "bg-bench-900 text-white"
                    : complete
                      ? "bg-white text-bench-900 ring-1 ring-inset ring-bench-200"
                      : "text-bench-700 hover:bg-white",
                )}
              >
                {complete ? <Check size={15} /> : <Icon size={15} />}
                {step.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {stepIndex === 0 && <WelcomeStep />}
          {stepIndex === 1 && <ModesStep />}
          {stepIndex === 2 && (
            <ProviderOnboardingStep onComplete={onComplete} />
          )}
        </div>

        {!isProviderStep && (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-bench-200/80 px-5 py-4 sm:px-7">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl bg-white"
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              disabled={isFirstStep}
            >
              <ArrowLeft size={15} />
              Back
            </Button>
            <Button
              type="button"
              className="rounded-xl"
              onClick={() =>
                setStepIndex((current) =>
                  Math.min(steps.length - 1, current + 1),
                )
              }
            >
              Continue
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
    <div className="grid min-h-full content-center gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(320px,0.6fr)] lg:items-center">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-bench-700">
          Welcome to Ora
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-bench-900 sm:text-5xl">
          An AI workspace that adapts to how you work.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-bench-700">
          Ora brings chat, tools, projects, and custom Modes into one focused
          desktop workbench. Set up a provider now and the first conversation can
          use a real model right away.
        </p>
      </div>

      <div className="rounded-[26px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-bench-900 text-white">
            <BrainCircuit size={20} />
          </div>
          <div>
            <p className="text-sm font-semibold text-bench-900">
              First-run checklist
            </p>
            <p className="text-xs text-bench-700">
              Three quick steps before the workbench opens.
            </p>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {["Meet the workspace", "Understand Modes", "Verify a provider"].map(
            (item, index) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-2xl bg-bench-50 px-3 py-3 ring-1 ring-inset ring-bench-200"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-bench-900 ring-1 ring-inset ring-bench-200">
                  {index + 1}
                </span>
                <span className="text-sm font-semibold text-bench-900">
                  {item}
                </span>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function ModesStep() {
  return (
    <div className="grid min-h-full content-center gap-6">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-bench-700">
          Modes are the control surface
        </p>
        <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight text-bench-900 sm:text-4xl">
          Different work deserves different AI behavior.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-bench-700">
          In Ora, Modes are reusable working styles. You can start from a preset,
          clone it, customize it, or describe the Mode you want in natural
          language and use it in chat.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {modeFeatures.map((feature) => {
          const Icon = feature.icon;
          return (
            <article
              key={feature.title}
              className="rounded-[24px] bg-card p-5 shadow-pane ring-1 ring-inset ring-bench-200"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-bench-50 text-bench-900 ring-1 ring-inset ring-bench-200">
                <Icon size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-bench-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-bench-700">
                {feature.body}
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
