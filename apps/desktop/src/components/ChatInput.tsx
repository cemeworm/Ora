import {
  ArrowUp,
  Bot,
  GraduationCap,
  Lightbulb,
  Paperclip,
  Rocket,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { CoordinationPattern, PatternCard } from "../types";
import type { OraProviderConfig } from "../lib/runtimeClient";

type InputMode = "flash" | "thinking" | "pro" | "ultra";

interface ChatInputProps {
  composerPrompt: string;
  isLoading: boolean;
  isRunning: boolean;
  activePattern?: PatternCard;
  patternOptions: PatternCard[];
  activeProvider?: OraProviderConfig;
  providerOptions: OraProviderConfig[];
  selectedCustomAgentId?: string;
  inputMode: InputMode;
  onInputModeChange: (mode: InputMode) => void;
  onPatternChange: (pattern: CoordinationPattern) => void;
  onProviderChange: (providerId: string) => void;
  onPromptChange: (prompt: string) => void;
  onClearSelectedCustomAgent?: () => void;
  onStartRun: () => void;
  onStopRun: () => void;
}

const modeOptions: Array<{ mode: InputMode; label: string; icon: typeof Zap }> = [
  { mode: "flash", label: "Flash", icon: Zap },
  { mode: "thinking", label: "Thinking", icon: Lightbulb },
  { mode: "pro", label: "Pro", icon: GraduationCap },
  { mode: "ultra", label: "Ultra", icon: Rocket },
];

export function ChatInput({
  composerPrompt,
  isLoading,
  isRunning,
  activePattern,
  patternOptions,
  activeProvider,
  providerOptions,
  selectedCustomAgentId,
  inputMode,
  onInputModeChange,
  onPatternChange,
  onProviderChange,
  onPromptChange,
  onClearSelectedCustomAgent,
  onStartRun,
  onStopRun,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [openPicker, setOpenPicker] = useState<"pattern" | "provider" | "mode" | undefined>();

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isRunning) {
        onStopRun();
        return;
      }
      if (composerPrompt.trim() && !isLoading) {
        onStartRun();
      }
    }
  }

  const selectedMode = modeOptions.find((option) => option.mode === inputMode) ?? modeOptions[2];
  const SelectedIcon = selectedMode.icon;

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-30 flex justify-center px-4">
      <div className="pointer-events-auto relative w-full max-w-[88rem]">
        <div className="rounded-2xl border border-border bg-card/96 shadow-lift backdrop-blur-sm transition-[background-color,border-color,box-shadow] duration-300">
          <div className="relative min-h-[96px]">
            <textarea
              ref={textareaRef}
              value={composerPrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isRunning ? "Run in progress..." : "Message Ora..."}
              disabled={isLoading}
              rows={2}
              className="min-h-[96px] max-h-[220px] w-full resize-none bg-transparent px-4 pb-14 pt-4 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 220)}px`;
              }}
            />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <Button type="button" variant="ghost" size="icon-sm" title="Attachments">
                  <Paperclip size={14} />
                </Button>
                {selectedCustomAgentId && (
                  <button
                    type="button"
                    onClick={onClearSelectedCustomAgent}
                    className="flex h-7 max-w-[260px] items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background/70 px-2.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                    title={`Clear custom agent ${selectedCustomAgentId}`}
                  >
                    <Bot size={13} />
                    <span className="hidden xl:inline">Agent</span>
                    <span className="max-w-[140px] truncate text-foreground">{selectedCustomAgentId}</span>
                    <X size={12} />
                  </button>
                )}
                <Picker
                  open={openPicker === "provider"}
                  onOpenChange={(open) => setOpenPicker(open ? "provider" : undefined)}
                  widthClassName="w-80"
                  trigger={
                    <>
                      <Bot size={13} />
                      <span className="hidden xl:inline">模型</span>
                      <span className="max-w-[140px] truncate text-foreground">
                        {activeProvider?.modelId ?? "No model"}
                      </span>
                    </>
                  }
                >
                  {providerOptions.length > 0 ? (
                    providerOptions.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => {
                          onProviderChange(provider.id);
                          setOpenPicker(undefined);
                        }}
                        className={cn(
                          "w-full rounded-md px-3 py-2 text-left transition hover:bg-accent",
                          activeProvider?.id === provider.id && "bg-accent text-accent-foreground",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium">{provider.label}</span>
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {provider.type === "local_smoke" ? "local" : provider.type}
                          </span>
                        </div>
                        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{provider.modelId}</div>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-xs leading-5 text-muted-foreground">
                      No configured model providers. Add a provider key in Settings.
                    </div>
                  )}
                </Picker>
                <Picker
                  open={openPicker === "pattern"}
                  onOpenChange={(open) => setOpenPicker(open ? "pattern" : undefined)}
                  trigger={
                    <>
                      <Rocket size={13} />
                      <span className="hidden xl:inline">工作模式</span>
                      <span className="max-w-[150px] truncate text-foreground">{activePattern?.label ?? "Default"}</span>
                    </>
                  }
                >
                  {patternOptions.map((pattern) => (
                    <button
                      key={pattern.id}
                      type="button"
                      onClick={() => {
                        onPatternChange(pattern.id);
                        setOpenPicker(undefined);
                      }}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left transition hover:bg-accent",
                        activePattern?.id === pattern.id && "bg-accent text-accent-foreground",
                      )}
                    >
                      <div className="text-xs font-medium">{pattern.label}</div>
                      <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{pattern.summary}</div>
                    </button>
                  ))}
                </Picker>
                <Picker
                  open={openPicker === "mode"}
                  onOpenChange={(open) => setOpenPicker(open ? "mode" : undefined)}
                  trigger={
                    <>
                      <SelectedIcon size={13} className={cn(inputMode === "ultra" && "text-[#dabb5e]")} />
                      <span className="hidden xl:inline">思考程度</span>
                      <span className={cn("text-foreground", inputMode === "ultra" && "golden-text")}>{selectedMode.label}</span>
                    </>
                  }
                >
                  {modeOptions.map(({ mode, label, icon: Icon }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        onInputModeChange(mode);
                        setOpenPicker(undefined);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs transition hover:bg-accent",
                        inputMode === mode && "bg-accent text-accent-foreground",
                      )}
                    >
                      <Icon size={13} className={cn(mode === "ultra" && "text-[#dabb5e]")} />
                      <span className={cn(mode === "ultra" && "golden-text")}>{label}</span>
                    </button>
                  ))}
                </Picker>
              </div>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="rounded-full"
                onClick={isRunning ? onStopRun : onStartRun}
                disabled={!isRunning && (!composerPrompt.trim() || isLoading)}
                title={isRunning ? "Stop run" : "Send message"}
              >
                {isRunning ? <Square size={14} /> : <ArrowUp size={16} />}
              </Button>
            </div>
          </div>
        </div>
        <p className="pb-3 pt-2 text-center text-[11px] text-muted-foreground">
          Ora can make mistakes. Review plans, actions, and checkpoints before using results.
        </p>
      </div>
    </div>
  );
}

function Picker({
  open,
  onOpenChange,
  widthClassName,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widthClassName?: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "flex h-7 max-w-[260px] items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background/70 px-2.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground",
          open && "bg-accent text-accent-foreground",
        )}
      >
        {trigger}
      </button>
      {open && (
        <div className={cn("absolute bottom-9 left-0 z-50 w-72 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lift", widthClassName)}>
          {children}
        </div>
      )}
    </div>
  );
}
