import { useEffect, useState } from "react";
import type { OraStateSnapshot } from "../lib/runtimeClient";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

interface ClarificationPanelProps {
  pendingClarifications: OraStateSnapshot["pendingClarifications"];
  onSubmitAll: (answers: Record<string, string>) => void;
  disabled?: boolean;
}

export function ClarificationPanel({ pendingClarifications, onSubmitAll, disabled }: ClarificationPanelProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const clarificationKeys = pendingClarifications.map((clarification) => clarification.key).join("\n");

  useEffect(() => {
    setAnswers((prev) => {
      const next: Record<string, string> = {};
      for (const clarification of pendingClarifications) {
        if (prev[clarification.key] !== undefined) {
          next[clarification.key] = prev[clarification.key]!;
        }
      }
      return next;
    });
  }, [clarificationKeys]);

  function handleOption(clarificationKey: string, value: string) {
    setAnswers((prev) => ({ ...prev, [clarificationKey]: value }));
  }

  function handleText(clarificationKey: string, value: string) {
    setAnswers((prev) => ({ ...prev, [clarificationKey]: value }));
  }

  function submitAnswers() {
    const normalized = Object.fromEntries(
      pendingClarifications.map((clarification) => [
        clarification.key,
        (answers[clarification.key] ?? "").trim(),
      ]),
    );
    if (Object.values(normalized).some((answer) => !answer)) return;
    onSubmitAll(normalized);
  }

  if (pendingClarifications.length === 0) return null;

  const allAnswered = pendingClarifications.every((clarification) =>
    Boolean((answers[clarification.key] ?? "").trim()),
  );
  const title = pendingClarifications.length === 1
    ? "需要补充 1 个信息后继续计划"
    : `需要补充 ${pendingClarifications.length} 个信息后继续计划`;

  return (
    <div className="rounded-xl border border-border/70 bg-card/72 p-3 backdrop-blur-sm">
      <div className="mb-2">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/80">补齐这些信息后，Ora 会继续制定计划。</p>
      </div>
      <div className="flex max-h-[min(24rem,calc(100vh-15rem))] flex-col gap-2 overflow-y-auto pr-1">
        {pendingClarifications.map((clarification, index) => {
          const answer = answers[clarification.key] ?? "";
          const hasOptions = clarification.options.length > 0;
          const textPlaceholder = hasOptions ? "或输入自己的回答" : "输入补充信息";
          return (
            <div
              key={clarification.id}
              className={cn(
                "p-2.5",
                pendingClarifications.length > 1
                  ? "rounded-lg border border-border/60 bg-muted/20"
                  : "rounded-md bg-transparent",
              )}
            >
              <p className="text-xs font-medium leading-5 text-foreground">
                {pendingClarifications.length > 1 ? `${index + 1}. ` : ""}
                {clarification.question}
              </p>
              {hasOptions ? (
                <>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {clarification.options.map((option) => {
                      const value = (option.value ?? option.label).trim();
                      const selected = answer === value;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => handleOption(clarification.key, value)}
                          title={option.description}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 disabled:cursor-not-allowed disabled:opacity-60",
                            selected
                              ? "border-primary bg-primary text-primary-foreground shadow-sm"
                              : "border-border/70 bg-muted/35 text-foreground hover:bg-muted/60",
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
              <Textarea
                value={answer}
                disabled={disabled}
                onChange={(event) => handleText(clarification.key, event.target.value)}
                placeholder={textPlaceholder}
                rows={2}
                className="mt-2 min-h-[42px] resize-none border-border/60 bg-transparent px-2.5 py-1.5 text-xs leading-5 shadow-none placeholder:text-muted-foreground/70 focus-visible:border-border focus-visible:ring-1 focus-visible:ring-foreground/10"
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={submitAnswers}
          disabled={disabled || !allAnswered}
        >
          继续计划
        </Button>
      </div>
    </div>
  );
}
