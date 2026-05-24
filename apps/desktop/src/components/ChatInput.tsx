import {
  ArrowUp,
  BrainCircuit,
  Bot,
  Check,
  Sparkles,
  ClipboardList,
  FileText,
  LoaderCircle,
  PanelTop,
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
  type CompositionEvent,
  type FormEvent,
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { translateCopy, type AppLanguage } from "../lib/i18n";
import { cn } from "../lib/utils";
import type { ActionRecord, ModeCard, TurnPlanListStep } from "../types";
import type { OraProviderConfig, OraSkillRegistry } from "../lib/runtimeClient";
import { inferProviderContextWindow } from "../lib/providerPresets";
import type {
  ComposerImageAttachment,
  ComposerLocalFileAttachment,
  ComposerProjectFileAttachment,
} from "../lib/state";
import type {
  ModeSelection,
  PermissionMode,
  TaskIntent,
} from "@cemeworm/shared";
import { ApprovalRequestCard } from "./ApprovalRequestCard";
import { ClarificationPanel } from "./ClarificationPanel";
import { PlanDecisionPanel } from "./PlanDecisionPanel";
import { PlanStepsTray } from "./PlanStepsTray";
import type { OraStateSnapshot } from "../lib/runtimeClient";
import type { DesktopRunInteractionState } from "../lib/runInteractionState";
import {
  CHAT_SURFACE_FRAME_WIDTH_CLASS,
  CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS,
  CHAT_SURFACE_VIEWPORT_GUTTER_CLASS,
} from "./chatSurfaceLayout";

type SkillDescriptor = OraSkillRegistry["skills"][number];

export interface ChatInputContextChip {
  id: string;
  label: string;
  tone?: "widget";
  onRemove?: () => void;
}

interface ChatInputProps {
  sessionId: string;
  composerPrompt: string;
  isLoading: boolean;
  runInteractionState: DesktopRunInteractionState;
  activeMode?: ModeCard;
  modeOptions: ModeCard[];
  selectedModeSelection: ModeSelection;
  activeProvider?: OraProviderConfig;
  contextState?: OraStateSnapshot["contextState"];
  providerOptions: OraProviderConfig[];
  skillOptions: SkillDescriptor[];
  selectedSkillIds: string[];
  language?: AppLanguage;
  contextChips?: ChatInputContextChip[];
  placeholder?: string;
  selectedCustomAgentId?: string;
  projectFileAttachments: ComposerProjectFileAttachment[];
  localFileAttachments: ComposerLocalFileAttachment[];
  imageAttachments: ComposerImageAttachment[];
  onRemoveImageAttachment: (name: string) => void;
  onAddImageAttachment: (image: ComposerImageAttachment) => void;
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
  onFilesDropped?: (files: FileList) => void;
  onClearSelectedCustomAgent?: () => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  taskIntent: TaskIntent;
  onTaskIntentChange: (taskIntent: TaskIntent) => void;
  planDecisionPending?: boolean;
  planSteps?: TurnPlanListStep[];
  onConfirmPlanDecision?: () => void | boolean | Promise<void | boolean>;
  onDeclinePlanDecision?: () => void | boolean | Promise<void | boolean>;
  onOverlayHeightChange?: (height: number) => void;
  surfaceFrameWidthClassName?: string;
  onStartRun: () => void;
  onStopRun: () => void;
}

export function getComposerInteractivity({
  composerPrompt,
  runInteractionState,
}: {
  composerPrompt: string;
  runInteractionState: DesktopRunInteractionState;
}) {
  return {
    canEditText: true,
    canSubmit:
      composerPrompt.trim().length > 0 && runInteractionState.canSubmit,
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
  const showClarificationTray =
    !isLoading && clarificationCount > 0 && canSubmitClarifications;
  const showPlanDecisionTray =
    !showClarificationTray && hasPlanDecision && canResolvePlanDecision;
  const hideComposer =
    showPlanDecisionTray || Boolean(hasPlanDecision && showClarificationTray);
  return { showClarificationTray, showPlanDecisionTray, hideComposer };
}

export function getContextRingState({
  contextState,
  activeProvider,
}: {
  contextState?: OraStateSnapshot["contextState"];
  activeProvider?: OraProviderConfig;
}) {
  const contextWindow =
    contextState?.contextWindow ??
    activeProvider?.contextWindow ??
    activeProvider?.maxContextWindow ??
    (activeProvider ? inferProviderContextWindow(activeProvider) : undefined);
  const activeTokens = contextState?.activeTokenUsage?.totalTokens ?? 0;
  const showContextRing = contextWindow != null && contextWindow > 0;
  const contextPct = showContextRing
    ? Math.min(activeTokens / contextWindow, 1)
    : 0;

  return {
    contextWindow,
    activeTokens,
    showContextRing,
    contextPct,
  };
}

type ComposerEditableMetrics = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollLeft" | "scrollTop" | "style"
>;

type ComposerEditableScrollTarget = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
> & {
  getBoundingClientRect: () => Pick<DOMRect, "bottom">;
};

const COMPOSER_ZWSP = "\u200b";
const COMPOSER_BOTTOM_SAFE_AREA_PX = 72;
const COMPOSER_TEXT_INPUT_TYPES = new Set([
  "insertCompositionText",
  "insertFromPaste",
  "insertLineBreak",
  "insertParagraph",
  "insertText",
]);

const COMPOSER_UNDO_DEBOUNCE_MS = 800;

type ComposerTextSegment = {
  id: string;
  kind: "text";
  text: string;
};

type ComposerSkillChipSegment = {
  id: string;
  kind: "skill-chip";
  skillId: string;
  label: string;
};

type ComposerContextChipSegment = {
  id: string;
  kind: "context-chip";
  chipId: string;
  label: string;
  tone?: ChatInputContextChip["tone"];
};

type ComposerSegment =
  | ComposerTextSegment
  | ComposerSkillChipSegment
  | ComposerContextChipSegment;

type ComposerSelectionPoint = {
  segmentId: string;
  offset: number;
};

type ComposerSelectionBookmark = {
  start: ComposerSelectionPoint;
  end: ComposerSelectionPoint;
};

type ComposerSelectionLineInfo = {
  segmentId: string;
  segmentIndex: number;
  lineStart: number;
  lineText: string;
  caretOffset: number;
};

type ComposerChipDescriptor =
  | {
      key: string;
      kind: "skill-chip";
      skillId: string;
      label: string;
    }
  | {
      key: string;
      kind: "context-chip";
      chipId: string;
      label: string;
      tone?: ChatInputContextChip["tone"];
    };

let composerSegmentSeq = 0;

function nextComposerSegmentId() {
  composerSegmentSeq += 1;
  return `composer-segment-${composerSegmentSeq}`;
}

function createTextSegment(
  text = "",
  id = nextComposerSegmentId(),
): ComposerTextSegment {
  return { id, kind: "text", text };
}

function sanitizeEditableText(value: string) {
  return value.replaceAll(COMPOSER_ZWSP, "");
}

function skillChipKey(skillId: string) {
  return `skill:${skillId}`;
}

function contextChipKey(chipId: string) {
  return `context:${chipId}`;
}

function skillChipDescriptor(skill: SkillDescriptor): ComposerChipDescriptor {
  return {
    key: skillChipKey(skill.id),
    kind: "skill-chip",
    skillId: skill.id,
    label: skill.name,
  };
}

function contextChipDescriptor(
  chip: ChatInputContextChip,
): ComposerChipDescriptor {
  return {
    key: contextChipKey(chip.id),
    kind: "context-chip",
    chipId: chip.id,
    label: chip.label,
    tone: chip.tone,
  };
}

function composerSegmentSignature(segments: ComposerSegment[]) {
  return JSON.stringify(
    segments.map((segment) => {
      if (segment.kind === "text") {
        return ["text", segment.id, segment.text];
      }
      if (segment.kind === "skill-chip") {
        return ["skill", segment.id, segment.skillId, segment.label];
      }
      return [
        "context",
        segment.id,
        segment.chipId,
        segment.label,
        segment.tone ?? "",
      ];
    }),
  );
}

function arraysEqual<T>(left: T[], right: T[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeComposerSegments(segments: ComposerSegment[]) {
  const normalized: ComposerSegment[] = [];
  const appendText = (text: string, id?: string) => {
    const previous = normalized[normalized.length - 1];
    if (previous?.kind === "text") {
      previous.text += text;
      return;
    }
    normalized.push(createTextSegment(text, id));
  };

  for (const segment of segments) {
    if (segment.kind === "text") {
      appendText(segment.text, segment.id);
      continue;
    }
    if (
      normalized.length === 0 ||
      normalized[normalized.length - 1]?.kind !== "text"
    ) {
      normalized.push(createTextSegment(""));
    }
    normalized.push(segment);
  }

  if (normalized.length === 0) {
    return [createTextSegment("")];
  }
  if (normalized[normalized.length - 1]?.kind !== "text") {
    normalized.push(createTextSegment(""));
  }

  return normalized.reduce<ComposerSegment[]>((acc, segment) => {
    const previous = acc[acc.length - 1];
    if (segment.kind === "text" && previous?.kind === "text") {
      previous.text += segment.text;
      return acc;
    }
    acc.push(
      segment.kind === "text"
        ? { ...segment }
        : segment.kind === "skill-chip"
          ? { ...segment }
          : { ...segment },
    );
    return acc;
  }, []);
}

function buildComposerSegments({
  composerPrompt,
  selectedSkills,
  contextChips,
}: {
  composerPrompt: string;
  selectedSkills: SkillDescriptor[];
  contextChips: ChatInputContextChip[];
}) {
  return normalizeComposerSegments([
    ...contextChips.map((chip) => ({
      id: nextComposerSegmentId(),
      kind: "context-chip" as const,
      chipId: chip.id,
      label: chip.label,
      tone: chip.tone,
    })),
    ...selectedSkills.map((skill) => ({
      id: nextComposerSegmentId(),
      kind: "skill-chip" as const,
      skillId: skill.id,
      label: skill.name,
    })),
    createTextSegment(composerPrompt),
  ]);
}

function setComposerPromptOnSegments(segments: ComposerSegment[], prompt: string) {
  return normalizeComposerSegments([
    ...segments.filter((segment) => segment.kind !== "text"),
    createTextSegment(prompt),
  ]);
}

function reconcileComposerSegments({
  segments,
  composerPrompt,
  selectedSkills,
  contextChips,
}: {
  segments: ComposerSegment[];
  composerPrompt: string;
  selectedSkills: SkillDescriptor[];
  contextChips: ChatInputContextChip[];
}) {
  const desiredDescriptors = [
    ...contextChips.map(contextChipDescriptor),
    ...selectedSkills.map(skillChipDescriptor),
  ];
  const desiredByKey = new Map(
    desiredDescriptors.map((descriptor) => [descriptor.key, descriptor]),
  );
  const seenKeys = new Set<string>();

  const preserved: ComposerSegment[] = [];
  for (const segment of segments) {
    if (segment.kind === "text") {
      preserved.push({ ...segment });
      continue;
    }
    const key =
      segment.kind === "skill-chip"
        ? skillChipKey(segment.skillId)
        : contextChipKey(segment.chipId);
    const descriptor = desiredByKey.get(key);
    if (!descriptor) {
      continue;
    }
    seenKeys.add(key);
    preserved.push(
      descriptor.kind === "skill-chip"
        ? {
            ...segment,
            kind: "skill-chip",
            skillId: descriptor.skillId,
            label: descriptor.label,
          }
        : {
            ...segment,
            kind: "context-chip",
            chipId: descriptor.chipId,
            label: descriptor.label,
            tone: descriptor.tone,
          },
    );
  }

  const trailingText =
    preserved[preserved.length - 1]?.kind === "text"
      ? (preserved.pop() as ComposerTextSegment)
      : createTextSegment("");
  const nextSegments = [
    ...preserved,
    ...desiredDescriptors
      .filter((descriptor) => !seenKeys.has(descriptor.key))
      .map((descriptor) =>
        descriptor.kind === "skill-chip"
          ? ({
              id: nextComposerSegmentId(),
              kind: "skill-chip",
              skillId: descriptor.skillId,
              label: descriptor.label,
            } as ComposerSkillChipSegment)
          : ({
              id: nextComposerSegmentId(),
              kind: "context-chip",
              chipId: descriptor.chipId,
              label: descriptor.label,
              tone: descriptor.tone,
            } as ComposerContextChipSegment),
      ),
    trailingText,
  ];
  const normalized = normalizeComposerSegments(nextSegments);
  return segmentsToPrompt(normalized) === composerPrompt
    ? normalized
    : setComposerPromptOnSegments(normalized, composerPrompt);
}

function segmentsToPrompt(segments: ComposerSegment[]) {
  return segments
    .filter((segment): segment is ComposerTextSegment => segment.kind === "text")
    .map((segment) => segment.text)
    .join("");
}

function skillIdsFromSegments(segments: ComposerSegment[]) {
  return segments
    .filter(
      (segment): segment is ComposerSkillChipSegment =>
        segment.kind === "skill-chip",
    )
    .map((segment) => segment.skillId);
}

function contextIdsFromSegments(segments: ComposerSegment[]) {
  return segments
    .filter(
      (segment): segment is ComposerContextChipSegment =>
        segment.kind === "context-chip",
    )
    .map((segment) => segment.chipId);
}

function isSelectionCollapsed(bookmark: ComposerSelectionBookmark | null) {
  return Boolean(
    bookmark &&
      bookmark.start.segmentId === bookmark.end.segmentId &&
      bookmark.start.offset === bookmark.end.offset,
  );
}

function findTextSegmentIndexById(
  segments: ComposerSegment[],
  segmentId: string,
) {
  return segments.findIndex(
    (segment) => segment.kind === "text" && segment.id === segmentId,
  );
}

function getSelectionLineInfo(
  segments: ComposerSegment[],
  bookmark: ComposerSelectionBookmark | null,
): ComposerSelectionLineInfo | null {
  if (!bookmark || !isSelectionCollapsed(bookmark)) {
    return null;
  }
  const segmentIndex = findTextSegmentIndexById(segments, bookmark.end.segmentId);
  if (segmentIndex < 0) {
    return null;
  }
  const segment = segments[segmentIndex] as ComposerTextSegment;
  const caretOffset = Math.max(0, Math.min(bookmark.end.offset, segment.text.length));
  const beforeCursor = segment.text.slice(0, caretOffset);
  const lastNewline = beforeCursor.lastIndexOf("\n");
  const lineStart = lastNewline + 1;
  return {
    segmentId: segment.id,
    segmentIndex,
    lineStart,
    lineText: segment.text.slice(lineStart, caretOffset),
    caretOffset,
  };
}

function resizeComposerTextarea(target: ComposerEditableMetrics) {
  target.style.height = "auto";
  target.style.height = `${Math.min(target.scrollHeight, 220)}px`;
}

export function scrollComposerTextareaToBottom(
  target: ComposerEditableMetrics,
) {
  target.scrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
}

function getComposerCaretRect(target: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!target.contains(range.startContainer) || !target.contains(range.endContainer)) {
    return null;
  }

  const measurement = range.cloneRange();
  measurement.collapse(false);
  const rects =
    typeof measurement.getClientRects === "function"
      ? measurement.getClientRects()
      : [];
  if (rects.length > 0) {
    return rects[rects.length - 1] ?? null;
  }

  const rangeRect =
    typeof measurement.getBoundingClientRect === "function"
      ? measurement.getBoundingClientRect()
      : null;
  if (rangeRect && (rangeRect.height > 0 || rangeRect.width > 0)) {
    return rangeRect;
  }

  if (measurement.startContainer instanceof Element) {
    return measurement.startContainer.getBoundingClientRect();
  }
  return measurement.startContainer.parentElement?.getBoundingClientRect() ?? null;
}

export function scrollComposerCaretIntoSafeView(
  target: ComposerEditableScrollTarget,
  options: {
    caretRect?: Pick<DOMRect, "bottom"> | null;
    safeBottomSpace?: number;
  } = {},
) {
  const safeBottomSpace =
    options.safeBottomSpace ?? COMPOSER_BOTTOM_SAFE_AREA_PX;
  const caretRect =
    options.caretRect ??
    (target instanceof HTMLElement ? getComposerCaretRect(target) : null);
  if (!caretRect) {
    return false;
  }

  const editorRect = target.getBoundingClientRect();
  const visibleBottom = editorRect.bottom - safeBottomSpace;
  const overflow = caretRect.bottom - visibleBottom;
  if (overflow <= 0) {
    return false;
  }

  const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
  const nextScrollTop = Math.min(
    maxScrollTop,
    Math.max(0, target.scrollTop + Math.ceil(overflow)),
  );
  if (nextScrollTop === target.scrollTop) {
    return false;
  }

  target.scrollTop = nextScrollTop;
  return true;
}

export function getCurrentLineInfo(text: string, cursor: number) {
  const beforeCursor = text.slice(0, cursor);
  const lastNewline = beforeCursor.lastIndexOf("\n");
  const lineStart = lastNewline + 1;
  const lineText = text.slice(lineStart, cursor);
  return { lineStart, lineText };
}

function findDirectComposerChild(root: HTMLElement, node: Node | null) {
  let current = node;
  while (current && current.parentNode !== root) {
    current = current.parentNode;
  }
  return current;
}

function getTextSpanSelectionOffset(
  textElement: HTMLElement,
  container: Node,
  offset: number,
) {
  const range = document.createRange();
  range.selectNodeContents(textElement);
  try {
    range.setEnd(container, offset);
  } catch {
    return sanitizeEditableText(textElement.textContent ?? "").length;
  }
  return Math.min(
    sanitizeEditableText(range.toString()).length,
    sanitizeEditableText(textElement.textContent ?? "").length,
  );
}

function findNearestTextSegmentPoint(
  root: HTMLElement,
  childIndex: number,
): ComposerSelectionPoint | null {
  for (let index = childIndex; index < root.childNodes.length; index += 1) {
    const candidate = root.childNodes[index];
    if (
      candidate instanceof HTMLElement &&
      candidate.dataset.segmentKind === "text" &&
      candidate.dataset.segmentId
    ) {
      return { segmentId: candidate.dataset.segmentId, offset: 0 };
    }
  }

  for (let index = Math.min(childIndex - 1, root.childNodes.length - 1); index >= 0; index -= 1) {
    const candidate = root.childNodes[index];
    if (
      candidate instanceof HTMLElement &&
      candidate.dataset.segmentKind === "text" &&
      candidate.dataset.segmentId
    ) {
      return {
        segmentId: candidate.dataset.segmentId,
        offset: sanitizeEditableText(candidate.textContent ?? "").length,
      };
    }
  }

  return null;
}

function captureSelectionPoint(
  root: HTMLElement,
  container: Node,
  offset: number,
): ComposerSelectionPoint | null {
  const directChild = container === root ? null : findDirectComposerChild(root, container);
  if (container === root) {
    return findNearestTextSegmentPoint(root, offset);
  }
  if (
    directChild instanceof HTMLElement &&
    directChild.dataset.segmentKind === "text" &&
    directChild.dataset.segmentId
  ) {
    return {
      segmentId: directChild.dataset.segmentId,
      offset: getTextSpanSelectionOffset(directChild, container, offset),
    };
  }
  if (directChild) {
    const childIndex = Array.from(root.childNodes).indexOf(
      directChild as ChildNode,
    );
    const boundaryOffset = directChild === container ? childIndex + offset : childIndex;
    return findNearestTextSegmentPoint(root, Math.max(0, boundaryOffset));
  }
  return null;
}

function captureSelectionBookmark(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null;
  }
  const start = captureSelectionPoint(
    root,
    range.startContainer,
    range.startOffset,
  );
  const end = captureSelectionPoint(root, range.endContainer, range.endOffset);
  if (!start || !end) {
    return null;
  }
  return { start, end };
}

function restoreSelectionPoint(root: HTMLElement, point: ComposerSelectionPoint) {
  const textElement = root.querySelector<HTMLElement>(
    `[data-segment-id="${point.segmentId}"][data-segment-kind="text"]`,
  );
  if (!textElement) {
    return null;
  }
  const textNodes = Array.from(textElement.childNodes).filter(
    (node): node is Text => node.nodeType === Node.TEXT_NODE,
  );
  if (textNodes.length === 0) {
    // WebKit may leave a placeholder <br> inside an empty contentEditable span.
    // Restore against the wrapper element instead of the placeholder node.
    return { node: textElement, offset: 0 };
  }

  const clampedOffset = Math.max(0, point.offset);
  let remaining = clampedOffset;
  let lastContentNode: Text | null = null;

  for (const textNode of textNodes) {
    const rawText = textNode.textContent ?? "";
    const sanitizedLength = sanitizeEditableText(rawText).length;
    if (sanitizedLength === 0) {
      continue;
    }
    lastContentNode = textNode;
    if (remaining <= sanitizedLength) {
      return {
        node: textNode,
        offset: rawOffsetFromSanitizedOffset(rawText, remaining),
      };
    }
    remaining -= sanitizedLength;
  }

  if (!lastContentNode) {
    return { node: textNodes[0], offset: 0 };
  }

  return {
    node: lastContentNode,
    offset: rawOffsetFromSanitizedOffset(
      lastContentNode.textContent ?? "",
      sanitizeEditableText(lastContentNode.textContent ?? "").length,
    ),
  };
}

function rawOffsetFromSanitizedOffset(rawText: string, sanitizedOffset: number) {
  if (sanitizedOffset <= 0) {
    return 0;
  }
  let visibleCount = 0;
  for (let index = 0; index < rawText.length; index += 1) {
    if (rawText[index] === COMPOSER_ZWSP) {
      continue;
    }
    visibleCount += 1;
    if (visibleCount === sanitizedOffset) {
      return index + 1;
    }
  }
  return rawText.length;
}

export function restoreSelectionBookmark(
  root: HTMLElement,
  bookmark: ComposerSelectionBookmark | null,
) {
  if (!bookmark) {
    return;
  }
  const start = restoreSelectionPoint(root, bookmark.start);
  const end = restoreSelectionPoint(root, bookmark.end);
  if (!start || !end) {
    return;
  }
  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    // Selection restore is a best-effort UX enhancement and must never take
    // down the composer when the browser provides an unexpected placeholder DOM.
  }
}

function serializeEditableNode(
  node: Node,
  segments: ComposerSegment[],
): ComposerSegment[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [createTextSegment(sanitizeEditableText(node.textContent ?? ""))];
  }
  if (!(node instanceof HTMLElement)) {
    return [];
  }
  const kind = node.dataset.segmentKind;
  if (kind === "text") {
    return [
      createTextSegment(
        sanitizeEditableText(node.textContent ?? ""),
        node.dataset.segmentId,
      ),
    ];
  }
  if (kind === "skill-chip") {
    const segment = segments.find(
      (candidate): candidate is ComposerSkillChipSegment =>
        candidate.kind === "skill-chip" &&
        candidate.skillId === node.dataset.skillId,
    );
    return segment ? [{ ...segment }] : [];
  }
  if (kind === "context-chip") {
    const segment = segments.find(
      (candidate): candidate is ComposerContextChipSegment =>
        candidate.kind === "context-chip" &&
        candidate.chipId === node.dataset.chipId,
    );
    return segment ? [{ ...segment }] : [];
  }
  if (node.tagName === "BR") {
    return [createTextSegment("\n")];
  }
  return Array.from(node.childNodes).flatMap((child) =>
    serializeEditableNode(child, segments),
  );
}

function parseComposerEditorSegments(
  root: HTMLElement,
  currentSegments: ComposerSegment[],
) {
  return normalizeComposerSegments(
    Array.from(root.childNodes).flatMap((child) =>
      serializeEditableNode(child, currentSegments),
    ),
  );
}

export function ChatInput({
  sessionId,
  composerPrompt,
  isLoading,
  runInteractionState,
  activeMode,
  modeOptions,
  selectedModeSelection,
  activeProvider,
  contextState,
  providerOptions,
  skillOptions,
  selectedSkillIds,
  language = "en",
  contextChips = [],
  placeholder = "Message Ora",
  selectedCustomAgentId,
  projectFileAttachments,
  localFileAttachments,
  imageAttachments,
  onRemoveImageAttachment,
  onAddImageAttachment,
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
  onFilesDropped,
  onClearSelectedCustomAgent,
  permissionMode,
  onPermissionModeChange,
  taskIntent,
  onTaskIntentChange,
  planDecisionPending,
  planSteps = [],
  onConfirmPlanDecision,
  onDeclinePlanDecision,
  onOverlayHeightChange,
  surfaceFrameWidthClassName = CHAT_SURFACE_FRAME_WIDTH_CLASS,
  onStartRun,
  onStopRun,
}: ChatInputProps) {
  const { contextWindow, activeTokens, showContextRing, contextPct } =
    getContextRingState({ contextState, activeProvider });
  const contextWindowLabel = contextWindow?.toLocaleString() ?? "0";
  const localizedPlaceholder = useMemo(
    () => translateCopy(language, placeholder),
    [language, placeholder],
  );

  const overlayRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const lastOverlayHeightRef = useRef<number | undefined>(undefined);
  const shouldScrollPastedTextRef = useRef(false);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const pendingSelectionRef = useRef<ComposerSelectionBookmark | null>(null);
  const previousHideComposerRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  const isComposingRef = useRef(false);
  const [hasPendingUserInput, setHasPendingUserInput] = useState(false);
  const [openPicker, setOpenPicker] = useState<
    | "pattern"
    | "provider"
    | "skills"
    | "taskIntent"
    | "permissionMode"
    | undefined
  >();
  const [skillListExpanded, setSkillListExpanded] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [skillPickerIndex, setSkillPickerIndex] = useState(0);
  const [previewImage, setPreviewImage] =
    useState<ComposerImageAttachment | null>(null);
  const externallySelectedSkills = useMemo(
    () =>
      selectedSkillIds
        .map((skillId) =>
          skillOptions.find(
            (skill) => skill.id === skillId || skill.name === skillId,
          ),
        )
        .filter((skill): skill is SkillDescriptor => Boolean(skill)),
    [selectedSkillIds, skillOptions],
  );
  const [segments, setSegments] = useState<ComposerSegment[]>(() =>
    buildComposerSegments({
      composerPrompt,
      selectedSkills: externallySelectedSkills,
      contextChips,
    }),
  );
  const undoStackRef = useRef<ComposerSegment[][]>([]);
  const redoStackRef = useRef<ComposerSegment[][]>([]);
  const lastUndoSnapshotTimeRef = useRef<number>(0);
  const [selectionBookmark, setSelectionBookmark] =
    useState<ComposerSelectionBookmark | null>(null);
  const plainTextPrompt = useMemo(() => segmentsToPrompt(segments), [segments]);
  const selectedSkillIdSet = useMemo(
    () => new Set(skillIdsFromSegments(segments)),
    [segments],
  );
  const selectionLineInfo = useMemo(
    () => getSelectionLineInfo(segments, selectionBookmark),
    [segments, selectionBookmark],
  );
  const slashQuery =
    selectionLineInfo?.lineText.startsWith("/")
      ? selectionLineInfo.lineText.slice(1).trim().toLowerCase()
      : "";
  const interactivity = getComposerInteractivity({
    composerPrompt: plainTextPrompt,
    runInteractionState,
  });
  const showComposerPlaceholder =
    plainTextPrompt.length === 0 &&
    !runInteractionState.isProcessing &&
    !isComposingRef.current &&
    !hasPendingUserInput;
  const filteredSkillOptions = useMemo(() => {
    return skillOptions
      .filter((skill) => skill.enabled)
      .filter(
        (skill) =>
          !selectedSkillIdSet.has(skill.id) &&
          !selectedSkillIdSet.has(skill.name),
      )
      .filter((skill) => {
        if (!slashQuery) return true;
        return [skill.name, skill.description, skill.category].some((value) =>
          value.toLowerCase().includes(slashQuery),
        );
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
  const hiddenSkillCount =
    filteredSkillOptions.length - visibleSkillOptions.length;
  const showSkillPicker =
    openPicker === "skills" &&
    Boolean(selectionLineInfo?.lineText.startsWith("/")) &&
    filteredSkillOptions.length > 0;
  const hasFileChips =
    projectFileAttachments.length > 0 ||
    localFileAttachments.length > 0 ||
    imageAttachments.length > 0;
  const hasInlineContextChips = segments.some(
    (segment) => segment.kind !== "text",
  );
  const showApprovalTray =
    approvalActions.length > 0 && Boolean(onApprove && onCancelApproval);
  const { showClarificationTray, showPlanDecisionTray, hideComposer } =
    getComposerTrayVisibility({
      isLoading,
      clarificationCount: clarificationQuestions.length,
      canSubmitClarifications: Boolean(onSubmitAllClarifications),
      hasPlanDecision: Boolean(planDecisionPending),
      canResolvePlanDecision: Boolean(
        onConfirmPlanDecision && onDeclinePlanDecision,
      ),
    });

  useEffect(() => {
    if (sessionIdRef.current !== sessionId) {
      sessionIdRef.current = sessionId;
      pendingSelectionRef.current = null;
      setHasPendingUserInput(false);
      setSelectionBookmark(null);
      undoStackRef.current = [];
      redoStackRef.current = [];
      lastUndoSnapshotTimeRef.current = 0;
      setPreviewImage(null);
      setSegments(
        buildComposerSegments({
          composerPrompt,
          selectedSkills: externallySelectedSkills,
          contextChips,
        }),
      );
      return;
    }

    setSegments((current) => {
      const next = reconcileComposerSegments({
        segments: current,
        composerPrompt,
        selectedSkills: externallySelectedSkills,
        contextChips,
      });
      return composerSegmentSignature(next) === composerSegmentSignature(current)
        ? current
        : next;
    });
  }, [sessionId, composerPrompt, externallySelectedSkills, contextChips]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }
    const stillExists = imageAttachments.some(
      (image) =>
        image.name === previewImage.name &&
        image.dataUrl === previewImage.dataUrl,
    );
    if (!stillExists) {
      setPreviewImage(null);
    }
  }, [imageAttachments, previewImage]);

  useLayoutEffect(() => {
    const target = editorRef.current;
    if (!target) return;
    if (pendingSelectionRef.current && !isComposingRef.current) {
      restoreSelectionBookmark(target, pendingSelectionRef.current);
      pendingSelectionRef.current = null;
    }
    resizeComposerTextarea(target);
    target.scrollLeft = 0;
    if (shouldScrollPastedTextRef.current) {
      shouldScrollPastedTextRef.current = false;
      scrollComposerTextareaToBottom(target);
    } else if (!plainTextPrompt) {
      target.scrollTop = 0;
    }
    scrollComposerCaretIntoSafeView(target);
  }, [plainTextPrompt, segments, sessionId]);

  useEffect(() => {
    if (previousHideComposerRef.current && !hideComposer) {
      window.requestAnimationFrame(() => editorRef.current?.focus());
    }
    previousHideComposerRef.current = hideComposer;
  }, [hideComposer]);

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
    hasFileChips,
    plainTextPrompt,
    clarificationQuestions,
    approvalActions,
    planDecisionPending,
    planSteps,
  ]);

  useEffect(() => {
    setSkillPickerIndex(0);
  }, [slashQuery, showSkillPicker]);

  useEffect(() => {
    const shouldShowSkills =
      Boolean(selectionLineInfo?.lineText.startsWith("/")) &&
      filteredSkillOptions.length > 0;
    if (shouldShowSkills) {
      setOpenPicker((current) =>
        current && current !== "skills" ? current : "skills",
      );
      return;
    }
    if (openPicker === "skills") {
      setOpenPicker(undefined);
      setSkillListExpanded(false);
    }
  }, [filteredSkillOptions.length, openPicker, selectionLineInfo]);

  useEffect(() => {
    if (!showSkillPicker) return;
    const container = skillPickerRef.current;
    if (!container) return;
    const target = container.children[skillPickerIndex] as
      | HTMLElement
      | undefined;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest" });
    }
  }, [skillPickerIndex, showSkillPicker]);

  function pushUndoSegmentsSnapshot(currentSegments: ComposerSegment[]) {
    const now = Date.now();
    if (now - lastUndoSnapshotTimeRef.current < COMPOSER_UNDO_DEBOUNCE_MS) {
      return;
    }
    lastUndoSnapshotTimeRef.current = now;
    const snapshot = JSON.parse(JSON.stringify(currentSegments)) as ComposerSegment[];
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  }

  function applySegmentChange(
    nextSegments: ComposerSegment[],
    options: { focus?: boolean; selection?: ComposerSelectionBookmark | null; skipUndoSnapshot?: boolean } = {},
  ) {
    if (!options.skipUndoSnapshot) {
      pushUndoSegmentsSnapshot(segments);
    }
    const normalized = normalizeComposerSegments(nextSegments);
    const previousPrompt = segmentsToPrompt(segments);
    const nextPrompt = segmentsToPrompt(normalized);
    const previousSkillIds = skillIdsFromSegments(segments);
    const nextSkillIds = skillIdsFromSegments(normalized);
    const nextContextIds = new Set(contextIdsFromSegments(normalized));

    pendingSelectionRef.current = options.selection ?? null;
    setSelectionBookmark(options.selection ?? null);
    setSegments(normalized);
    if (nextPrompt.length > 0 || !isComposingRef.current) {
      setHasPendingUserInput(false);
    }

    if (nextPrompt !== previousPrompt) {
      onPromptChange(nextPrompt);
    }
    if (!arraysEqual(previousSkillIds, nextSkillIds)) {
      onSelectedSkillIdsChange([...new Set(nextSkillIds)]);
    }
    for (const contextId of contextIdsFromSegments(segments)) {
      if (!nextContextIds.has(contextId)) {
        contextChips.find((chip) => chip.id === contextId)?.onRemove?.();
      }
    }
    if (options.focus) {
      window.requestAnimationFrame(() => editorRef.current?.focus());
    }
  }

  function refreshSelectionState() {
    const editor = editorRef.current;
    if (!editor) return;
    setSelectionBookmark(captureSelectionBookmark(editor));
  }

  function parseAndCommitEditorState() {
    if (isComposingRef.current) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const nextBookmark = captureSelectionBookmark(editor);
    const nextSegments = parseComposerEditorSegments(editor, segments);
    applySegmentChange(nextSegments, { selection: nextBookmark });
  }

  function insertTextAtSelection(text: string) {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      return;
    }
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    parseAndCommitEditorState();
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
    setHasPendingUserInput(true);
  }

  function handleCompositionEnd(_e: CompositionEvent<HTMLDivElement>) {
    isComposingRef.current = false;
    window.requestAnimationFrame(() => {
      refreshSelectionState();
      parseAndCommitEditorState();
    });
  }

  function handleBeforeInput(e: FormEvent<HTMLDivElement>) {
    const nativeEvent = e.nativeEvent as InputEvent;
    if (COMPOSER_TEXT_INPUT_TYPES.has(nativeEvent.inputType ?? "")) {
      setHasPendingUserInput(true);
    }
  }

  function handleBlur() {
    if (!plainTextPrompt) {
      setHasPendingUserInput(false);
    }
  }

  function markPendingInputFromKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.key.length !== 1 ||
      e.nativeEvent.isComposing ||
      isComposingRef.current
    ) {
      return;
    }
    setHasPendingUserInput(true);
  }

  function removeBoundaryChip(direction: "backward" | "forward") {
    if (!selectionLineInfo) {
      return false;
    }

    const textSegment = segments[
      selectionLineInfo.segmentIndex
    ] as ComposerTextSegment;
    if (direction === "backward") {
      if (selectionLineInfo.caretOffset !== 0 || selectionLineInfo.segmentIndex < 2) {
        return false;
      }
      const previousChip = segments[selectionLineInfo.segmentIndex - 1];
      const previousText = segments[
        selectionLineInfo.segmentIndex - 2
      ] as ComposerTextSegment | undefined;
      if (!previousChip || previousChip.kind === "text" || !previousText) {
        return false;
      }

      const mergedText: ComposerTextSegment = {
        ...textSegment,
        text: previousText.text + textSegment.text,
      };
      applySegmentChange(
        [
          ...segments.slice(0, selectionLineInfo.segmentIndex - 2),
          mergedText,
          ...segments.slice(selectionLineInfo.segmentIndex + 1),
        ],
        {
          focus: true,
          selection: {
            start: {
              segmentId: mergedText.id,
              offset: previousText.text.length,
            },
            end: {
              segmentId: mergedText.id,
              offset: previousText.text.length,
            },
          },
        },
      );
      return true;
    }

    if (
      selectionLineInfo.caretOffset !== textSegment.text.length ||
      selectionLineInfo.segmentIndex > segments.length - 3
    ) {
      return false;
    }
    const nextChip = segments[selectionLineInfo.segmentIndex + 1];
    const nextText = segments[
      selectionLineInfo.segmentIndex + 2
    ] as ComposerTextSegment | undefined;
    if (!nextChip || nextChip.kind === "text" || !nextText) {
      return false;
    }

    const mergedText: ComposerTextSegment = {
      ...textSegment,
      text: textSegment.text + nextText.text,
    };
    applySegmentChange(
      [
        ...segments.slice(0, selectionLineInfo.segmentIndex),
        mergedText,
        ...segments.slice(selectionLineInfo.segmentIndex + 3),
      ],
      {
        focus: true,
        selection: {
          start: {
            segmentId: mergedText.id,
            offset: textSegment.text.length,
          },
          end: {
            segmentId: mergedText.id,
            offset: textSegment.text.length,
          },
        },
      },
    );
    return true;
  }

  function removeFinalCharacterFromTextSegment(
    direction: "backward" | "forward",
  ) {
    if (!selectionLineInfo) {
      return false;
    }

    const textSegment = segments[
      selectionLineInfo.segmentIndex
    ] as ComposerTextSegment;
    if (textSegment.text.length !== 1) {
      return false;
    }

    const isBackwardDelete =
      direction === "backward" && selectionLineInfo.caretOffset === 1;
    const isForwardDelete =
      direction === "forward" && selectionLineInfo.caretOffset === 0;
    if (!isBackwardDelete && !isForwardDelete) {
      return false;
    }

    const emptiedTextSegment: ComposerTextSegment = {
      ...textSegment,
      text: "",
    };
    applySegmentChange(
      [
        ...segments.slice(0, selectionLineInfo.segmentIndex),
        emptiedTextSegment,
        ...segments.slice(selectionLineInfo.segmentIndex + 1),
      ],
      {
        focus: true,
        selection: {
          start: { segmentId: emptiedTextSegment.id, offset: 0 },
          end: { segmentId: emptiedTextSegment.id, offset: 0 },
        },
      },
    );
    return true;
  }

  function removeExpandedSelection() {
    if (!selectionBookmark || isSelectionCollapsed(selectionBookmark)) {
      return false;
    }

    const startSegmentIndex = findTextSegmentIndexById(
      segments,
      selectionBookmark.start.segmentId,
    );
    const endSegmentIndex = findTextSegmentIndexById(
      segments,
      selectionBookmark.end.segmentId,
    );
    if (startSegmentIndex < 0 || endSegmentIndex < 0) {
      return false;
    }

    const [fromIndex, toIndex] =
      startSegmentIndex <= endSegmentIndex
        ? [startSegmentIndex, endSegmentIndex]
        : [endSegmentIndex, startSegmentIndex];
    const fromPoint =
      fromIndex === startSegmentIndex
        ? selectionBookmark.start
        : selectionBookmark.end;
    const toPoint =
      toIndex === endSegmentIndex
        ? selectionBookmark.end
        : selectionBookmark.start;

    const startSegment = segments[fromIndex] as ComposerTextSegment;
    const endSegment = segments[toIndex] as ComposerTextSegment;
    const startOffset = Math.max(
      0,
      Math.min(fromPoint.offset, startSegment.text.length),
    );
    const endOffset = Math.max(
      0,
      Math.min(toPoint.offset, endSegment.text.length),
    );
    const mergedText: ComposerTextSegment = {
      ...startSegment,
      text:
        startSegment.text.slice(0, startOffset) +
        endSegment.text.slice(endOffset),
    };

    applySegmentChange(
      [
        ...segments.slice(0, fromIndex),
        mergedText,
        ...segments.slice(toIndex + 1),
      ],
      {
        focus: true,
        selection: {
          start: { segmentId: mergedText.id, offset: startOffset },
          end: { segmentId: mergedText.id, offset: startOffset },
        },
      },
    );
    return true;
  }

  function confirmSkillPickerSelection() {
    if (
      hiddenSkillCount > 0 &&
      skillPickerIndex === visibleSkillOptions.length
    ) {
      setSkillListExpanded(true);
      setSkillPickerIndex(0);
      return;
    }
    if (visibleSkillOptions[skillPickerIndex]) {
      selectSkill(visibleSkillOptions[skillPickerIndex]);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    markPendingInputFromKeyDown(e);
    if (isComposingRef.current || e.nativeEvent.isComposing) {
      return;
    }
    // Undo: Cmd+Z / Ctrl+Z
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      if (undoStackRef.current.length === 0) return;
      const currentSnapshot = JSON.parse(JSON.stringify(segments)) as ComposerSegment[];
      redoStackRef.current.push(currentSnapshot);
      const restored = undoStackRef.current.pop()!;
      applySegmentChange(restored, { focus: true, skipUndoSnapshot: true });
      return;
    }

    // Redo: Cmd+Shift+Z / Ctrl+Shift+Z
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
      e.preventDefault();
      if (redoStackRef.current.length === 0) return;
      const currentSnapshot = JSON.parse(JSON.stringify(segments)) as ComposerSegment[];
      undoStackRef.current.push(currentSnapshot);
      const restored = redoStackRef.current.pop()!;
      applySegmentChange(restored, { focus: true, skipUndoSnapshot: true });
      return;
    }

    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      if (openPicker === "skills") {
        confirmSkillPickerSelection();
      }
      return;
    }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      const nextIntent: TaskIntent =
        taskIntent === "chat" ? "plan"
        : taskIntent === "plan" ? "implement"
        : "plan";
      onTaskIntentChange(nextIntent);
      return;
    }
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      !isSelectionCollapsed(selectionBookmark)
    ) {
      if (removeExpandedSelection()) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Backspace" && isSelectionCollapsed(selectionBookmark)) {
      if (removeBoundaryChip("backward")) {
        e.preventDefault();
        return;
      }
      if (removeFinalCharacterFromTextSegment("backward")) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Delete" && isSelectionCollapsed(selectionBookmark)) {
      if (removeBoundaryChip("forward")) {
        e.preventDefault();
        return;
      }
      if (removeFinalCharacterFromTextSegment("forward")) {
        e.preventDefault();
        return;
      }
    }

    if (e.key === "Escape" && openPicker === "skills") {
      setOpenPicker(undefined);
      return;
    }
    if (e.key === "ArrowDown" && openPicker === "skills") {
      e.preventDefault();
      const maxIndex =
        hiddenSkillCount > 0
          ? visibleSkillOptions.length
          : visibleSkillOptions.length - 1;
      setSkillPickerIndex((prev) => (prev >= maxIndex ? 0 : prev + 1));
      return;
    }
    if (e.key === "ArrowUp" && openPicker === "skills") {
      e.preventDefault();
      const maxIndex =
        hiddenSkillCount > 0
          ? visibleSkillOptions.length
          : visibleSkillOptions.length - 1;
      setSkillPickerIndex((prev) => (prev <= 0 ? maxIndex : prev - 1));
      return;
    }
    if (e.key === "Enter" && openPicker === "skills") {
      e.preventDefault();
      confirmSkillPickerSelection();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (runInteractionState.isProcessing) {
        onStopRun();
        return;
      }
      if (interactivity.canSubmit) {
        onStartRun();
      }
    }
  }

  function selectSkill(skill: SkillDescriptor) {
    if (!selectionLineInfo) {
      return;
    }
    const currentTextSegment = segments[
      selectionLineInfo.segmentIndex
    ] as ComposerTextSegment;
    const leadingText = createTextSegment(
      currentTextSegment.text.slice(0, selectionLineInfo.lineStart),
      currentTextSegment.id,
    );
    const trailingText = createTextSegment(
      currentTextSegment.text.slice(selectionLineInfo.caretOffset),
    );
    const nextSkillSegment: ComposerSkillChipSegment = {
      id: nextComposerSegmentId(),
      kind: "skill-chip",
      skillId: skill.id,
      label: skill.name,
    };

    applySegmentChange(
      [
        ...segments.slice(0, selectionLineInfo.segmentIndex),
        leadingText,
        nextSkillSegment,
        trailingText,
        ...segments.slice(selectionLineInfo.segmentIndex + 1),
      ],
      {
        focus: true,
        selection: {
          start: { segmentId: trailingText.id, offset: 0 },
          end: { segmentId: trailingText.id, offset: 0 },
        },
      },
    );
    setOpenPicker(undefined);
    setSkillListExpanded(false);
  }

  const modeTriggerLabel =
    selectedModeSelection === "auto" ? "自动" : (activeMode?.label ?? "默认");

  const taskIntentOptions = [
    {
      value: "implement" as TaskIntent,
      label: "实施",
      icon: <Play size={13} />,
      description: "可以修改文件，帮助完成任务",
    },
    {
      value: "plan" as TaskIntent,
      label: "计划",
      icon: <ClipboardList size={13} />,
      description: "分析问题并输出执行计划，不修改文件",
    },
    {
      value: "chat" as TaskIntent,
      label: "对话",
      icon: <MessagesSquare size={13} />,
      description: "问答模式，不能修改任何文件",
    },
  ];

  const permissionModeOptions = [
    {
      value: "full_access" as PermissionMode,
      label: "完全访问",
      icon: <Unlock size={13} />,
      description: "所有操作自动批准，不询问",
    },
    {
      value: "default" as PermissionMode,
      label: "默认",
      icon: <Shield size={13} />,
      description: "高风险操作需要确认",
    },
    {
      value: "auto_review" as PermissionMode,
      label: "自动审查",
      icon: <Bot size={13} />,
      description: "自动批准并记录，不打断工作",
    },
  ];

  return (
    <div
      ref={overlayRef}
      className={cn(
        "pointer-events-none absolute bottom-0 left-0 right-0 z-30 flex justify-center",
        CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS,
      )}
    >
      <div
        className={cn(
          "pointer-events-none relative mx-auto",
          CHAT_SURFACE_VIEWPORT_GUTTER_CLASS,
        )}
      >
        <div
          data-testid="chat-input-surface-frame"
          className={cn(
            "pointer-events-none relative mx-auto",
            surfaceFrameWidthClassName,
          )}
        >
          {showSkillPicker && (
            <div
              ref={skillPickerRef}
              className="pointer-events-auto absolute bottom-full left-3 z-50 mb-2 max-h-[min(32rem,calc(100vh-12rem))] w-[min(26rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lift"
            >
              {visibleSkillOptions.map((skill, idx) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => selectSkill(skill)}
                  onMouseMove={() => setSkillPickerIndex(idx)}
                  className={`w-full rounded-md px-3 py-2 text-left transition hover:bg-accent ${
                    idx === skillPickerIndex ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {skill.name}
                    </span>
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
                  onMouseMove={() =>
                    setSkillPickerIndex(visibleSkillOptions.length)
                  }
                  className={`mt-1 w-full rounded-md bg-transparent px-3 py-2 text-left text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground ${
                    skillPickerIndex === visibleSkillOptions.length
                      ? "bg-accent text-foreground"
                      : ""
                  }`}
                >
                  Show all {filteredSkillOptions.length} skills
                </button>
              )}
            </div>
          )}
        {planSteps.length > 0 ? (
          <div className="pointer-events-auto">
            <PlanStepsTray planSteps={planSteps} />
          </div>
        ) : null}
        {showApprovalTray ? (
          <div className="pointer-events-auto mb-2">
            <ApprovalRequestCard
              actions={approvalActions}
              onResume={onApprove!}
              onCancel={onCancelApproval!}
              disabled={approvalDisabled}
            />
          </div>
        ) : null}
        {showClarificationTray ? (
          <div className="pointer-events-auto mb-2">
            <ClarificationPanel
              pendingClarifications={clarificationQuestions}
              onSubmitAll={onSubmitAllClarifications!}
              disabled={isLoading}
            />
          </div>
        ) : null}
        {showPlanDecisionTray ? (
          <div className="pointer-events-auto mb-2">
            <PlanDecisionPanel
              onConfirm={onConfirmPlanDecision!}
              onDecline={onDeclinePlanDecision!}
              disabled={isLoading}
            />
          </div>
        ) : null}
        {hideComposer ? null : (
          <div
            data-testid="chat-input-surface-card"
            className={cn(
              "pointer-events-auto w-full rounded-2xl border bg-card/96 shadow-lift backdrop-blur-sm transition-[background-color,border-color,box-shadow] duration-300",
              isDragOver
                ? "border-amber-200 ring-2 ring-amber-200/50"
                : "border-border",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isDragOver) setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setIsDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);
              const files = e.dataTransfer.files;
              if (files.length > 0 && onFilesDropped) {
                onFilesDropped(files);
              }
            }}
          >
            <div
              className={cn(
                "relative",
                hasFileChips ? "min-h-[156px]" : "min-h-[96px]",
              )}
            >
              {hasFileChips && (
                <div
                  data-testid="composer-attachment-rail"
                  className="absolute left-3 right-3 top-3 z-10 flex max-h-16 flex-wrap items-center gap-1.5 overflow-y-auto pr-1"
                >
                  {projectFileAttachments.map((file) => (
                    <button
                      key={`${file.projectId}:${file.path}`}
                      type="button"
                      onClick={() => onRemoveProjectFileAttachment(file.path)}
                      className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-full border border-border bg-background/80 px-2.5 text-xs font-medium text-muted-foreground shadow-[0_1px_2px_rgba(23,23,23,0.04)] transition hover:bg-accent hover:text-accent-foreground active:scale-95"
                      title={`Remove ${file.path}`}
                    >
                      <FileText size={12} />
                      <span className="truncate text-foreground">
                        {file.name}
                      </span>
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
                      <span className="truncate text-foreground">
                        {file.name}
                      </span>
                      <X size={11} />
                    </button>
                  ))}
                  {imageAttachments.map((img) => (
                    <div
                      key={`image:${img.name}`}
                      className="inline-flex h-7 max-w-[240px] items-stretch overflow-hidden rounded-full border border-border bg-background/80 text-xs font-medium text-muted-foreground shadow-[0_1px_2px_rgba(23,23,23,0.04)]"
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewImage(img)}
                        className="inline-flex min-w-0 flex-1 items-center gap-1.5 pl-1 pr-1.5 transition hover:bg-accent hover:text-accent-foreground"
                        title={`Preview ${img.name}`}
                        aria-label={`Preview ${img.name}`}
                      >
                        <img
                          src={img.dataUrl}
                          alt={img.name}
                          className="h-5 w-5 rounded-full object-cover"
                        />
                        <span className="truncate text-foreground">
                          {img.name}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveImageAttachment(img.name);
                        }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center transition hover:bg-accent hover:text-accent-foreground active:scale-95"
                        title={`Remove ${img.name}`}
                        aria-label={`Remove ${img.name}`}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div
                ref={editorRef}
                contentEditable={interactivity.canEditText}
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                data-testid="chat-input-editor"
                className={cn(
                  "max-h-[220px] w-full overflow-y-auto bg-transparent px-4 text-sm leading-5 outline-none",
                  "whitespace-pre-wrap break-words",
                  interactivity.canEditText
                    ? "cursor-text"
                    : "cursor-not-allowed opacity-60",
                  hasFileChips ? "min-h-[124px] pt-14" : "min-h-[96px] pt-4",
                )}
                style={{
                  height: "auto",
                  paddingBottom: `${COMPOSER_BOTTOM_SAFE_AREA_PX}px`,
                }}
                onBeforeInput={handleBeforeInput}
                onInput={parseAndCommitEditorState}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onKeyDown={handleKeyDown}
                onKeyUp={refreshSelectionState}
                onMouseUp={refreshSelectionState}
                onFocus={refreshSelectionState}
                onBlur={handleBlur}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (items) {
                    const imageItems: File[] = [];
                    for (const item of items) {
                      if (
                        item.kind === "file" &&
                        item.type.startsWith("image/")
                      ) {
                        const file = item.getAsFile();
                        if (file) imageItems.push(file);
                      }
                    }
                    if (imageItems.length > 0) {
                      e.preventDefault();
                      let pasteSeq = 0;
                      for (const file of imageItems) {
                        const reader = new FileReader();
                        const seq = pasteSeq++;
                        reader.onload = () => {
                          onAddImageAttachment({
                            dataUrl: reader.result as string,
                            mimeType: file.type,
                            name:
                              file.name ||
                              `screenshot-${Date.now()}-${seq}.png`,
                            sizeBytes: file.size,
                          });
                        };
                        reader.readAsDataURL(file);
                      }
                      return;
                    }
                  }

                  const text = e.clipboardData?.getData("text/plain") ?? "";
                  if (!text) {
                    return;
                  }
                  e.preventDefault();
                  setHasPendingUserInput(true);
                  shouldScrollPastedTextRef.current = true;
                  insertTextAtSelection(text);
                }}
              >
                {segments.map((segment, index) => {
                  if (segment.kind === "text") {
                    const placeholderText =
                      showComposerPlaceholder &&
                      index === segments.length - 1
                        ? localizedPlaceholder
                        : undefined;
                    return (
                      <span
                        key={segment.id}
                        data-segment-kind="text"
                        data-segment-id={segment.id}
                        data-placeholder={placeholderText}
                        className={cn(
                          "inline whitespace-pre-wrap break-words",
                          placeholderText &&
                            "after:pointer-events-none after:text-muted-foreground after:content-[attr(data-placeholder)]",
                        )}
                      >
                        {segment.text || COMPOSER_ZWSP}
                      </span>
                    );
                  }

                  if (segment.kind === "context-chip") {
                    return (
                      <span
                        key={segment.id}
                        data-segment-kind="context-chip"
                        data-chip-id={segment.chipId}
                        contentEditable={false}
                        className={cn(
                          "mx-0.5 inline-flex max-w-[220px] items-center gap-1 rounded-full border px-2 py-0.5 align-baseline text-sm font-medium",
                          segment.tone === "widget"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-border bg-background/80 text-muted-foreground",
                        )}
                      >
                        <PanelTop size={14} />
                        <span className="truncate">{segment.label}</span>
                      </span>
                    );
                  }

                  return (
                    <span
                      key={segment.id}
                      data-segment-kind="skill-chip"
                      data-skill-id={segment.skillId}
                      contentEditable={false}
                      className="mx-0.5 inline-flex max-w-[220px] items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 align-baseline text-sm font-medium text-violet-700"
                    >
                      <Sparkles size={14} />
                      <span className="truncate">{segment.label}</span>
                    </span>
                  );
                })}
              </div>
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
                        {taskIntentOptions.find((o) => o.value === taskIntent)
                          ?.icon ?? <Play size={13} />}
                        <span className="hidden xl:inline">任务</span>
                        <span className="max-w-[100px] truncate text-foreground">
                          {taskIntentOptions.find((o) => o.value === taskIntent)
                            ?.label ?? "实施"}
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
                        {permissionModeOptions.find(
                          (o) => o.value === permissionMode,
                        )?.icon ?? <Shield size={13} />}
                        <span className="hidden xl:inline">权限</span>
                        <span className="max-w-[100px] truncate text-foreground">
                          {permissionModeOptions.find(
                            (o) => o.value === permissionMode,
                          )?.label ?? "默认"}
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
                        <span className="hidden xl:inline">模式</span>
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
                        <span>自动</span>
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          路由
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                        由 Ora 从当前模式列表中自动选择最适合本轮的 模式。
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
                        </div>
                        <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                          {mode.summary}
                        </div>
                      </button>
                    ))}
                  </Picker>
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
                              {provider.type}
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
                  {showContextRing && (
                    <ContextRing
                      activeTokens={activeTokens}
                      contextPct={contextPct}
                      contextWindowLabel={contextWindowLabel}
                    />
                  )}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="rounded-full"
                  onClick={
                    runInteractionState.isProcessing ? onStopRun : onStartRun
                  }
                  disabled={
                    !runInteractionState.isProcessing &&
                    !interactivity.canSubmit
                  }
                  title={
                    runInteractionState.isProcessing
                      ? "Stop run"
                      : "Send message"
                  }
                >
                  {runInteractionState.isProcessing ? (
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
        <Dialog
          open={Boolean(previewImage)}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewImage(null);
            }
          }}
        >
          <DialogContent
            className="relative max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] border-0 bg-transparent p-0 shadow-none"
            data-testid="composer-image-preview-dialog"
          >
            {previewImage ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  aria-label="Close image preview"
                  className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg transition hover:bg-black/70 active:scale-95"
                >
                  <X size={16} />
                </button>
                <img
                  src={previewImage.dataUrl}
                  alt={previewImage.name}
                  className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] rounded-xl object-contain"
                />
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
        <p className="pb-3 pt-2 text-center text-[11px] text-muted-foreground">
          Ora may be wrong, check the results before adoption.
        </p>
        </div>
      </div>
    </div>
  );
}

function ContextRing({
  activeTokens,
  contextPct,
  contextWindowLabel,
}: {
  activeTokens: number;
  contextPct: number;
  contextWindowLabel: string;
}) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const stroke =
    contextPct <= 0.5 ? "#10b981" : contextPct <= 0.8 ? "#d97706" : "#ef4444";

  return (
    <div
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center"
      title={`${activeTokens.toLocaleString()} / ${contextWindowLabel} tokens (${Math.round(contextPct * 100)}%)`}
    >
      <svg
        width={18}
        height={18}
        viewBox="0 0 20 20"
        className="block"
        aria-hidden="true"
      >
        <circle
          cx={10}
          cy={10}
          r={radius}
          fill="none"
          stroke="#d4d4d4"
          strokeWidth={2.5}
        />
        <circle
          cx={10}
          cy={10}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - contextPct)}
          transform="rotate(-90 10 10)"
          style={{
            transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease",
          }}
        />
      </svg>
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
