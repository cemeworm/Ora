import {
  ArrowUp,
  BrainCircuit,
  Bot,
  Check,
  ClipboardList,
  FileText,
  LoaderCircle,
  MessagesSquare,
  Paperclip,
  Play,
  Rocket,
  Shield,
  Square,
  Unlock,
  X,
} from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { ActionRecord, ModeCard } from "../types";
import type { OraProviderConfig, OraSkillRegistry } from "../lib/runtimeClient";
import type { ComposerLocalFileAttachment, ComposerProjectFileAttachment } from "../lib/state";
import type { ModeSelection, PermissionMode, TaskIntent } from "@cemeworm/shared";
import { ApprovalRequestCard } from "./ApprovalRequestCard";
import { ClarificationPanel } from "./ClarificationPanel";
import { PlanDecisionPanel } from "./PlanDecisionPanel";
import type { OraStateSnapshot } from "../lib/runtimeClient";

type SkillDescriptor = OraSkillRegistry["skills"][number];

interface ChatInputProps {
  sessionId: string;
  composerPrompt: string;
  isLoading: boolean;
  isRunning: boolean;
  activeMode?: ModeCard;
  modeOptions: ModeCard[];
  selectedModeSelection: ModeSelection;
  activeProvider?: OraProviderConfig;
  providerOptions: OraProviderConfig[];
  skillOptions: SkillDescriptor[];
  selectedSkillIds: string[];
  selectedCustomAgentId?: string;
  projectFileAttachments: ComposerProjectFileAttachment[];
  localFileAttachments: ComposerLocalFileAttachment[];
  approvalActions?: ActionRecord[];
  approvalDisabled?: boolean;
  onApprove?: () => void;
  onCancelApproval?: () => void;
  clarificationQuestions?: OraStateSnapshot["pendingClarifications"];
  onSubmitAllClarifications?: (answers: Record<string, string>) => void;
  onModeChange: (modeId: string) => void;
  onModeSelectionChange: (selection: ModeSelection) => void;
  onProviderChange: (providerId: string) => void;
  onPromptChange: (prompt: string) => void;
  onSelectedSkillIdsChange: (skillIds: string[]) => void;
  onRemoveProjectFileAttachment: (path: string) => void;
  onRemoveLocalFileAttachment: (path: string) => void;
  onOpenLocalFiles: () => void;
  onClearSelectedCustomAgent?: () => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  taskIntent: TaskIntent;
  onTaskIntentChange: (taskIntent: TaskIntent) => void;
  planDecisionPending?: boolean;
  onConfirmPlanDecision?: () => void;
  onDeclinePlanDecision?: () => void;
  onOverlayHeightChange?: (height: number) => void;
  onStartRun: () => void;
  onStopRun: () => void;
}

export function getComposerInteractivity({
  composerPrompt,
  isLoading,
}: {
  composerPrompt: string;
  isLoading: boolean;
}) {
  return {
    canEditText: true,
    canSubmit: composerPrompt.trim().length > 0 && !isLoading,
  };
}

export function getComposerTrayVisibility({
  isLoading,
  clarificationCount,
  canSubmitClarifications,
  hasPlanDecision,
  canResolvePlanDecision,
}: {
  isLoading: boolean;
  clarificationCount: number;
  canSubmitClarifications: boolean;
  hasPlanDecision: boolean;
  canResolvePlanDecision: boolean;
}) {
  const showClarificationTray = !isLoading && clarificationCount > 0 && canSubmitClarifications;
  const showPlanDecisionTray = !showClarificationTray && hasPlanDecision && canResolvePlanDecision;
  const hideComposer = showPlanDecisionTray || Boolean(hasPlanDecision && showClarificationTray);
  return { showClarificationTray, showPlanDecisionTray, hideComposer };
}

function resizeComposerTextarea(target: HTMLTextAreaElement) {
  target.style.height = "auto";
  target.style.height = `${Math.min(target.scrollHeight, 220)}px`;
}

export function ChatInput({
  sessionId,
  composerPrompt,
  isLoading,
  isRunning,
  activeMode,
  modeOptions,
  selectedModeSelection,
  activeProvider,
  providerOptions,
  skillOptions,
  selectedSkillIds,
  selectedCustomAgentId,
  projectFileAttachments,
  localFileAttachments,
  approvalActions = [],
  approvalDisabled,
  onApprove,
  onCancelApproval,
  clarificationQuestions = [],
  onSubmitAllClarifications,
  onModeChange,
  onModeSelectionChange,
  onProviderChange,
  onPromptChange,
  onSelectedSkillIdsChange,
  onRemoveProjectFileAttachment,
  onRemoveLocalFileAttachment,
  onOpenLocalFiles,
  onClearSelectedCustomAgent,
  permissionMode,
  onPermissionModeChange,
  taskIntent,
  onTaskIntentChange,
  planDecisionPending,
  onConfirmPlanDecision,
  onDeclinePlanDecision,
  onOverlayHeightChange,
  onStartRun,
  onStopRun,
}: ChatInputProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastOverlayHeightRef = useRef<number | undefined>();
  const [openPicker, setOpenPicker] = useState<
    "pattern" | "provider" | "skills" | "taskIntent" | "permissionMode" | undefined
  >();
  const [skillListExpanded, setSkillListExpanded] = useState(false);
  const interactivity = getComposerInteractivity({ composerPrompt, isLoading });
  const selectedSkillIdSet = useMemo(
    () => new Set(selectedSkillIds),
    [selectedSkillIds],
  );
  const selectedSkills = useMemo(
    () =>
      selectedSkillIds
        .map((skillId) => skillOptions.find((skill) => skill.id === skillId || skill.name === skillId))
        .filter((skill): skill is SkillDescriptor => Boolean(skill)),
    [selectedSkillIds, skillOptions],
  );
  const slashQuery = composerPrompt.startsWith("/")
    ? composerPrompt.slice(1).trim().toLowerCase()
    : "";
  const filteredSkillOptions = useMemo(() => {
    return skillOptions
      .filter((skill) => skill.enabled)
      .filter((skill) => !selectedSkillIdSet.has(skill.id) && !selectedSkillIdSet.has(skill.name))
      .filter((skill) => {
        if (!slashQuery) return true;
        return [skill.name, skill.description, skill.category]
          .some((value) => value.toLowerCase().includes(slashQuery));
      })
      .sort((left, right) => {
        if (left.category !== right.category) {
          return left.category === "private" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
  }, [selectedSkillIdSet, skillOptions, slashQuery]);
  const visibleSkillOptions = skillListExpanded
    ? filteredSkillOptions
    : filteredSkillOptions.slice(0, 12);
  const hiddenSkillCount = filteredSkillOptions.length - visibleSkillOptions.length;
  const showSkillPicker = openPicker === "skills"
    && composerPrompt.startsWith("/")
    && filteredSkillOptions.length > 0;
  const hasTopChips = selectedSkills.length > 0 || projectFileAttachments.length > 0 || localFileAttachments.length > 0;
  const showApprovalTray = approvalActions.length > 0 && Boolean(onApprove && onCancelApproval);
  const { showClarificationTray, showPlanDecisionTray, hideComposer } = getComposerTrayVisibility({
    isLoading,
    clarificationCount: clarificationQuestions.length,
    canSubmitClarifications: Boolean(onSubmitAllClarifications),
    hasPlanDecision: Boolean(planDecisionPending),
    canResolvePlanDecision: Boolean(onConfirmPlanDecision && onDeclinePlanDecision),
  });

  useLayoutEffect(() => {
    const target = textareaRef.current;
    if (!target) return;
    resizeComposerTextarea(target);
    if (!composerPrompt) {
      target.scrollLeft = 0;
      target.scrollTop = 0;
    }
  }, [composerPrompt]);

  useLayoutEffect(() => {
    const target = textareaRef.current;
    if (!target) return;
    resizeComposerTextarea(target);
    target.scrollLeft = 0;
    target.scrollTop = 0;
  }, [sessionId]);

  useLayoutEffect(() => {
    const target = overlayRef.current;
    if (!target || !onOverlayHeightChange) return;

    const reportHeight = () => {
      const height = Math.ceil(target.getBoundingClientRect().height);
      if (lastOverlayHeightRef.current === height) return;
      lastOverlayHeightRef.current = height;
      onOverlayHeightChange(height);
    };

    reportHeight();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(reportHeight);
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    onOverlayHeightChange,
    showApprovalTray,
    showClarificationTray,
    showPlanDecisionTray,
    hideComposer,
    hasTopChips,
    composerPrompt,
    clarificationQuestions,
    approvalActions,
    planDecisionPending,
  ]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && openPicker === "skills") {
      setOpenPicker(undefined);
      return;
    }
    if (e.key === "Enter" && openPicker === "skills") {
      e.preventDefault();
      if (visibleSkillOptions[0]) {
        selectSkill(visibleSkillOptions[0]);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isRunning) {
        onStopRun();
        return;
      }
      if (interactivity.canSubmit) {
        onStartRun();
      }
    }
  }

  function updatePrompt(nextPrompt: string) {
    onPromptChange(nextPrompt);
    const nextQuery = nextPrompt.startsWith("/") ? nextPrompt.slice(1).trim().toLowerCase() : "";
    const hasMatches = nextPrompt.startsWith("/") && skillOptions
      .filter((skill) => skill.enabled)
      .filter((skill) => !selectedSkillIdSet.has(skill.id) && !selectedSkillIdSet.has(skill.name))
      .some((skill) => {
        if (!nextQuery) return true;
        return [skill.name, skill.description, skill.category]
          .some((value) => value.toLowerCase().includes(nextQuery));
      });

    if (hasMatches) {
      setOpenPicker("skills");
    } else if (openPicker === "skills") {
      setOpenPicker(undefined);
      setSkillListExpanded(false);
    }
  }

  function selectSkill(skill: SkillDescriptor) {
    const nextSkillIds = [...selectedSkillIds, skill.id];
    onSelectedSkillIdsChange([...new Set(nextSkillIds)]);
    onPromptChange(composerPrompt.startsWith("/") ? "" : composerPrompt);
    setOpenPicker(undefined);
    setSkillListExpanded(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function removeSkill(skillId: string) {
    onSelectedSkillIdsChange(selectedSkillIds.filter((id) => id !== skillId));
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const modeTriggerLabel =
    selectedModeSelection === "auto"
      ? "Auto"
      : (activeMode?.label ?? "Default");

  const taskIntentOptions = [
    { value: "implement" as TaskIntent, label: "实施", icon: <Play size={13} />, description: "可以修改文件，帮助完成任务" },
    { value: "plan" as TaskIntent, label: "计划", icon: <ClipboardList size={13} />, description: "分析问题并输出执行计划，不修改文件" },
    { value: "chat" as TaskIntent, label: "对话", icon: <MessagesSquare size={13} />, description: "问答模式，不能修改任何文件" },
  ];

  const permissionModeOptions = [
    { value: "full_access" as PermissionMode, label: "完全访问", icon: <Unlock size={13} />, description: "所有操作自动批准，不询问" },
    { value: "default" as PermissionMode, label: "默认", icon: <Shield size={13} />, description: "高风险操作需要确认" },
    { value: "auto_review" as PermissionMode, label: "自动审查", icon: <Bot size={13} />, description: "自动批准并记录，不打断工作" },
  ];

  return (
    <div ref={overlayRef} className="pointer-events-none absolute bottom-0 left-0 right-0 z-30 flex justify-center px-4">
      <div className="pointer-events-auto relative w-full max-w-[88rem]">
        {showSkillPicker && (
          <div className="absolute bottom-full left-3 z-50 mb-2 max-h-[min(32rem,calc(100vh-12rem))] w-[min(26rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lift">
            {visibleSkillOptions.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => selectSkill(skill)}
                className="w-full rounded-md px-3 py-2 text-left transition hover:bg-accent"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">{skill.name}</span>
                  <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {skill.category}
                  </span>
                </div>
                <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                  {skill.description}
                </div>
              </button>
            ))}
            {hiddenSkillCount > 0 && (
              <button
                type="button"
                onClick={() => setSkillListExpanded(true)}
                className="mt-1 w-full rounded-md bg-transparent px-3 py-2 text-left text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                Show all {filteredSkillOptions.length} skills
              </button>
            )}
          </div>
        )}
        {showApprovalTray ? (
          <div className="mb-2">
            <ApprovalRequestCard
              actions={approvalActions}
              onResume={onApprove!}
              onCancel={onCancelApproval!}
              disabled={approvalDisabled}
            />
          </div>
        ) : null}
        {showClarificationTray ? (
          <div className="mb-2">
            <ClarificationPanel
              pendingClarifications={clarificationQuestions}
              onSubmitAll={onSubmitAllClarifications!}
              disabled={isLoading}
            />
          </div>
        ) : null}
        {showPlanDecisionTray ? (
          <div className="mb-2">
            <PlanDecisionPanel
              onConfirm={onConfirmPlanDecision!}
              onDecline={onDeclinePlanDecision!}
              disabled={isLoading}
            />
          </div>
        ) : null}
        {hideComposer ? null : (
        <div className="rounded-2xl border border-border bg-card/96 shadow-lift backdrop-blur-sm transition-[background-color,border-color,box-shadow] duration-300">
          <div className={cn("relative", hasTopChips ? "min-h-[148px]" : "min-h-[96px]")}>
            {hasTopChips && (
              <div className="absolute left-3 right-3 top-3 z-10 flex max-h-16 flex-wrap items-center gap-1.5 overflow-y-auto pr-1">
                {selectedSkills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => removeSkill(skill.id)}
                    className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 text-xs font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
                    title={`Remove ${skill.name}`}
                  >
                    <Check size={12} />
                    <span className="truncate">{skill.name}</span>
                    <X size={11} className="text-violet-500" />
                  </button>
                ))}
                {projectFileAttachments.map((file) => (
                  <button
                    key={`${file.projectId}:${file.path}`}
                    type="button"
                    onClick={() => onRemoveProjectFileAttachment(file.path)}
                    className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 text-xs font-medium text-muted-foreground shadow-[0_1px_2px_rgba(23,23,23,0.04)] transition hover:bg-accent hover:text-accent-foreground active:scale-95"
                    title={`Remove ${file.path}`}
                  >
                    <FileText size={12} />
                    <span className="truncate text-foreground">{file.name}</span>
                    <X size={11} />
                  </button>
                ))}
                {localFileAttachments.map((file) => (
                  <button
                    key={`local:${file.path}`}
                    type="button"
                    onClick={() => onRemoveLocalFileAttachment(file.path)}
                    className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 text-xs font-medium text-muted-foreground shadow-[0_1px_2px_rgba(23,23,23,0.04)] transition hover:bg-accent hover:text-accent-foreground active:scale-95"
                    title={`Remove ${file.path}`}
                  >
                    <FileText size={12} />
                    <span className="truncate text-foreground">{file.name}</span>
                    <X size={11} />
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={composerPrompt}
              onChange={(e) => updatePrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isRunning ? "" : "Message Ora"}
              disabled={!interactivity.canEditText}
              rows={2}
              className={cn(
                "max-h-[220px] w-full resize-none bg-transparent px-4 pb-14 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
                hasTopChips ? "min-h-[148px] pt-20" : "min-h-[96px] pt-4",
              )}
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                resizeComposerTextarea(e.target as HTMLTextAreaElement);
              }}
            />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onOpenLocalFiles}
                  title="载入本地文件"
                >
                  <Paperclip size={14} />
                </Button>
                <Picker
                  open={openPicker === "taskIntent"}
                  onOpenChange={(open) =>
                    setOpenPicker(open ? "taskIntent" : undefined)
                  }
                  trigger={
                    <>
                      {taskIntentOptions.find((o) => o.value === taskIntent)?.icon ?? <Play size={13} />}
                      <span className="hidden xl:inline">任务目标</span>
                      <span className="max-w-[100px] truncate text-foreground">
                        {taskIntentOptions.find((o) => o.value === taskIntent)?.label ?? "实施"}
                      </span>
                    </>
                  }
                  widthClassName="w-60"
                >
                  {taskIntentOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onTaskIntentChange(option.value);
                        setOpenPicker(undefined);
                      }}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left transition hover:bg-accent",
                        taskIntent === option.value &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2 text-xs font-medium">
                        {option.icon}
                        <span>{option.label}</span>
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                        {option.description}
                      </div>
                    </button>
                  ))}
                </Picker>
                <Picker
                  open={openPicker === "permissionMode"}
                  onOpenChange={(open) =>
                    setOpenPicker(open ? "permissionMode" : undefined)
                  }
                  trigger={
                    <>
                      {permissionModeOptions.find((o) => o.value === permissionMode)?.icon ?? <Shield size={13} />}
                      <span className="hidden xl:inline">权限</span>
                      <span className="max-w-[100px] truncate text-foreground">
                        {permissionModeOptions.find((o) => o.value === permissionMode)?.label ?? "默认"}
                      </span>
                    </>
                  }
                >
                  {permissionModeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onPermissionModeChange(option.value);
                        setOpenPicker(undefined);
                      }}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left transition hover:bg-accent",
                        permissionMode === option.value &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2 text-xs font-medium">
                        {option.icon}
                        <span>{option.label}</span>
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                        {option.description}
                      </div>
                    </button>
                  ))}
                </Picker>

                {selectedCustomAgentId && (
                  <button
                    type="button"
                    onClick={onClearSelectedCustomAgent}
                    className="flex h-7 max-w-[260px] items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background/70 px-2.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                    title={`Clear custom agent ${selectedCustomAgentId}`}
                  >
                    <Bot size={13} />
                    <span className="hidden xl:inline">Agent</span>
                    <span className="max-w-[140px] truncate text-foreground">
                      {selectedCustomAgentId}
                    </span>
                    <X size={12} />
                  </button>
                )}
                <Picker
                  open={openPicker === "provider"}
                  onOpenChange={(open) =>
                    setOpenPicker(open ? "provider" : undefined)
                  }
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
                          activeProvider?.id === provider.id &&
                            "bg-accent text-accent-foreground",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium">
                            {provider.label}
                          </span>
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {provider.type === "local_smoke"
                              ? "local"
                              : provider.type}
                          </span>
                        </div>
                        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                          {provider.modelId}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-xs leading-5 text-muted-foreground">
                      No configured model providers. Add a provider key in
                      Settings.
                    </div>
                  )}
                </Picker>
                <Picker
                  open={openPicker === "pattern"}
                  onOpenChange={(open) =>
                    setOpenPicker(open ? "pattern" : undefined)
                  }
                  trigger={
                    <>
                      {selectedModeSelection === "auto" ? (
                        <BrainCircuit size={13} />
                      ) : (
                        <Rocket size={13} />
                      )}
                      <span className="hidden xl:inline">工作模式</span>
                      <span className="max-w-[150px] truncate text-foreground">
                        {modeTriggerLabel}
                      </span>
                    </>
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      onModeSelectionChange("auto");
                      setOpenPicker(undefined);
                    }}
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left transition hover:bg-accent",
                      selectedModeSelection === "auto" &&
                        "bg-accent text-accent-foreground",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs font-medium">
                      <span>Auto</span>
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        router
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                      Let Ora choose the best mode from the current mode list
                      for this turn.
                    </div>
                  </button>
                  {modeOptions.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        onModeChange(mode.id);
                        onModeSelectionChange("manual");
                        setOpenPicker(undefined);
                      }}
                      className={cn(
                        "w-full rounded-md px-3 py-2 text-left transition hover:bg-accent",
                        selectedModeSelection === "manual" &&
                          activeMode?.id === mode.id &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-medium">
                        <span>{mode.label}</span>
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {mode.isPreset ? "preset" : mode.family}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                        {mode.summary}
                      </div>
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
                disabled={!isRunning && !interactivity.canSubmit}
                title={isRunning ? "Stop run" : "Send message"}
              >
                {isRunning ? (
                  <Square size={14} />
                ) : isLoading ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <ArrowUp size={16} />
                )}
              </Button>
            </div>
          </div>
        </div>
        )}
        <p className="pb-3 pt-2 text-center text-[11px] text-muted-foreground">
          Ora may be wrong, check the results before adoption.
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
        <div
          className={cn(
            "absolute bottom-9 left-0 z-50 w-72 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lift",
            widthClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
