import {
  ArrowUp,
  Bot,
  BrainCircuit,
  ClipboardList,
  FileText,
  LoaderCircle,
  MessagesSquare,
  Paperclip,
  PanelTop,
  Play,
  Rocket,
  Shield,
  Sparkles,
  Square,
  Unlock,
  X,
} from "lucide-react";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
  type CompositionEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import {
  $createComposerChipNode,
  $isComposerChipNode,
  ComposerChipNode,
} from "./chatInput/ComposerChipNode";
import { $createComposerTextNode, ComposerTextNode } from "./chatInput/ComposerTextNode";

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

type ComposerSelectionPoint = {
  segmentId: string;
  offset: number;
};

type ComposerSelectionBookmark = {
  start: ComposerSelectionPoint;
  end: ComposerSelectionPoint;
};

type SlashTriggerContext = {
  nodeKey: NodeKey;
  caretOffset: number;
  replaceStartOffset: number;
  rawText: string;
  query: string;
};

type EditorProjection = {
  prompt: string;
  skillIds: string[];
  contextIds: string[];
  slashContext: SlashTriggerContext | null;
};

const COMPOSER_BOTTOM_SAFE_AREA_PX = 72;
const COMPOSER_UNDO_DEBOUNCE_MS = 800;

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

function arraysEqual<T>(left: T[], right: T[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildSeedToken({
  sessionId,
  composerPrompt,
  selectedSkills,
  contextChips,
}: {
  sessionId: string;
  composerPrompt: string;
  selectedSkills: SkillDescriptor[];
  contextChips: ChatInputContextChip[];
}) {
  return JSON.stringify({
    sessionId,
    composerPrompt,
    skills: selectedSkills.map((skill) => [skill.id, skill.name]),
    contexts: contextChips.map((chip) => [chip.id, chip.label, chip.tone ?? ""]),
  });
}

function buildContentSnapshot({
  composerPrompt,
  selectedSkills,
  contextChips,
}: {
  composerPrompt: string;
  selectedSkills: SkillDescriptor[];
  contextChips: ChatInputContextChip[];
}) {
  return {
    prompt: composerPrompt,
    skillIds: selectedSkills.map((skill) => skill.id),
    contextIds: contextChips.map((chip) => chip.id),
  };
}

function buildInitialProjection({
  composerPrompt,
  selectedSkills,
  contextChips,
}: {
  composerPrompt: string;
  selectedSkills: SkillDescriptor[];
  contextChips: ChatInputContextChip[];
}): EditorProjection {
  return {
    prompt: composerPrompt,
    skillIds: selectedSkills.map((skill) => skill.id),
    contextIds: contextChips.map((chip) => chip.id),
    slashContext: null,
  };
}

function populateEditorFromSeed({
  composerPrompt,
  selectedSkills,
  contextChips,
}: {
  composerPrompt: string;
  selectedSkills: SkillDescriptor[];
  contextChips: ChatInputContextChip[];
}) {
  const root = $getRoot();
  root.clear();
  const lines = composerPrompt.split("\n");
  const firstParagraph = $createParagraphNode();
  root.append(firstParagraph);
  for (const chip of contextChips) {
    firstParagraph.append(
      $createComposerChipNode({
        chipId: chip.id,
        chipKind: "context",
        label: chip.label,
        tone: chip.tone,
      }),
    );
  }
  for (const skill of selectedSkills) {
    firstParagraph.append(
      $createComposerChipNode({
        chipId: skill.id,
        chipKind: "skill",
        label: skill.name,
      }),
    );
  }
  firstParagraph.append($createComposerTextNode(lines[0] ?? ""));
  for (const line of lines.slice(1)) {
    const paragraph = $createParagraphNode();
    paragraph.append($createComposerTextNode(line));
    root.append(paragraph);
  }
}

function collectNodes(
  node: LexicalNode,
  sink: {
    promptParts: string[];
    skillIds: string[];
    contextIds: string[];
  },
) {
  if ($isLineBreakNode(node)) {
    sink.promptParts.push("\n");
    return;
  }
  if ($isComposerChipNode(node)) {
    if (node.getChipKind() === "skill") {
      sink.skillIds.push(node.getChipId());
    } else {
      sink.contextIds.push(node.getChipId());
    }
    return;
  }
  if ($isTextNode(node)) {
    sink.promptParts.push(node.getTextContent());
    return;
  }
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      collectNodes(child, sink);
    }
  }
}

function slashContextFromSelection(): SlashTriggerContext | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return null;
  }

  const anchorNode = selection.anchor.getNode();
  const anchorOffset = selection.anchor.offset;
  if ($isTextNode(anchorNode) && !$isComposerChipNode(anchorNode)) {
    return buildSlashTriggerContext(
      anchorNode as ComposerTextNode,
      anchorOffset,
    );
  }

  if ($isTextNode(anchorNode) && !$isComposerChipNode(anchorNode)) {
    return null;
  }

  if (!$isElementNode(anchorNode)) {
    return null;
  }

  const candidates: Array<{
    textNode: ComposerTextNode;
    caretOffset: number;
  }> = [];

  const previousChild =
    anchorOffset > 0 ? anchorNode.getChildAtIndex(anchorOffset - 1) : null;
  const previousTextNode = findBoundaryTextNode(previousChild, "end");
  if (previousTextNode) {
    candidates.push({
      textNode: previousTextNode,
      caretOffset: previousTextNode.getTextContentSize(),
    });
  }

  const nextChild = anchorNode.getChildAtIndex(anchorOffset);
  const nextTextNode = findBoundaryTextNode(nextChild, "start");
  if (nextTextNode) {
    candidates.push({
      textNode: nextTextNode,
      caretOffset: 0,
    });
  }

  for (const candidate of candidates) {
    const slashContext = buildSlashTriggerContext(
      candidate.textNode,
      candidate.caretOffset,
    );
    if (slashContext) {
      return slashContext;
    }
  }

  return null;
}

function findBoundaryTextNode(
  node: LexicalNode | null,
  direction: "start" | "end",
): ComposerTextNode | null {
  if (!node) {
    return null;
  }
  if ($isTextNode(node) && !$isComposerChipNode(node)) {
    return node as ComposerTextNode;
  }
  if (!$isElementNode(node)) {
    return null;
  }

  const children = node.getChildren();
  const orderedChildren =
    direction === "start" ? children : [...children].reverse();
  for (const child of orderedChildren) {
    const textNode = findBoundaryTextNode(child, direction);
    if (textNode) {
      return textNode;
    }
  }
  return null;
}

function getPrefixSinceSlashBoundary(
  textNode: ComposerTextNode,
) {
  const parent = textNode.getParent();
  if (!$isElementNode(parent)) {
    return "";
  }

  let prefix = "";
  for (const child of parent.getChildren()) {
    if (child.is(textNode)) {
      break;
    }
    if ($isLineBreakNode(child)) {
      prefix = "";
      continue;
    }
    if ($isComposerChipNode(child)) {
      prefix = child.getChipKind() === "skill" ? "" : `${prefix}\u0000`;
      continue;
    }
    if ($isTextNode(child)) {
      const text = child.getTextContent();
      const lastNewline = text.lastIndexOf("\n");
      if (lastNewline >= 0) {
        prefix = text.slice(lastNewline + 1);
      } else {
        prefix += text;
      }
    }
  }
  return prefix;
}

function buildSlashTriggerContext(
  textNode: ComposerTextNode,
  caretOffset: number,
): SlashTriggerContext | null {
  const textBeforeCaret = textNode.getTextContent().slice(0, caretOffset);
  const localBoundaryOffset = textBeforeCaret.lastIndexOf("\n") + 1;
  const textSinceLocalBoundary = textBeforeCaret.slice(localBoundaryOffset);
  const prefixBeforeNode =
    localBoundaryOffset > 0 ? "" : getPrefixSinceSlashBoundary(textNode);
  const candidateText = `${prefixBeforeNode}${textSinceLocalBoundary}`;
  const leadingWhitespaceLength =
    candidateText.match(/^\s*/)?.[0].length ?? 0;

  if (candidateText.slice(leadingWhitespaceLength, leadingWhitespaceLength + 1) !== "/") {
    return null;
  }

  const slashOffsetInNode = textSinceLocalBoundary.lastIndexOf("/");
  if (slashOffsetInNode < 0) {
    return null;
  }

  const rawText = candidateText.slice(leadingWhitespaceLength);
  return {
    nodeKey: textNode.getKey(),
    caretOffset,
    replaceStartOffset: localBoundaryOffset + slashOffsetInNode,
    rawText,
    query: rawText.slice(1).trim().toLowerCase(),
  };
}

function readEditorProjection(): EditorProjection {
  const root = $getRoot();
  const promptParts: string[] = [];
  const skillIds: string[] = [];
  const contextIds: string[] = [];
  const children = root.getChildren();
  children.forEach((child, index) => {
    if (index > 0) {
      promptParts.push("\n");
    }
    collectNodes(child, { promptParts, skillIds, contextIds });
  });
  return {
    prompt: promptParts.join("").replaceAll("\u200b", ""),
    skillIds,
    contextIds,
    slashContext: slashContextFromSelection(),
  };
}

function getLastComposerParagraph() {
  const root = $getRoot();
  const existing = root.getLastChild();
  if ($isElementNode(existing)) {
    return existing;
  }
  root.clear();
  const paragraph = $createParagraphNode();
  root.append(paragraph);
  return paragraph;
}

function ensureParagraphTextNode(paragraph: LexicalNode) {
  if (!$isElementNode(paragraph)) {
    const textNode = $createComposerTextNode("");
    const root = $getRoot();
    const fallbackParagraph = $createParagraphNode();
    fallbackParagraph.append(textNode);
    root.append(fallbackParagraph);
    return textNode;
  }
  const children = paragraph.getChildren();
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if ($isTextNode(child) && !$isComposerChipNode(child)) {
      return child as ComposerTextNode;
    }
  }
  const textNode = $createComposerTextNode("");
  paragraph.append(textNode);
  return textNode;
}

function ensureTrailingComposerTextNode() {
  return ensureParagraphTextNode(getLastComposerParagraph());
}

function ensureParagraphShape(paragraph: LexicalNode | null) {
  if (!$isElementNode(paragraph)) {
    return null;
  }
  return ensureParagraphTextNode(paragraph);
}

function selectParagraphStart(paragraph: LexicalNode | null) {
  if (!$isElementNode(paragraph)) {
    return;
  }
  const firstTextNode = findBoundaryTextNode(
    paragraph.getFirstChild(),
    "start",
  );
  if (firstTextNode) {
    firstTextNode.select(0, 0);
    return;
  }
  paragraph.select(0, 0);
}

function moveNodesIntoParagraph(
  startNode: LexicalNode | null,
  targetParagraph: ReturnType<typeof $createParagraphNode>,
) {
  let current = startNode;
  while (current) {
    const next = current.getNextSibling();
    targetParagraph.append(current);
    current = next;
  }
}

function mergeParagraphBoundary(
  anchorNode: LexicalNode,
  isBackward: boolean,
) {
  if (!$isElementNode(anchorNode)) {
    return false;
  }

  const sourceParagraph = isBackward
    ? anchorNode
    : anchorNode.getNextSibling();
  const targetParagraph = isBackward
    ? anchorNode.getPreviousSibling()
    : anchorNode;

  if (!$isElementNode(sourceParagraph) || !$isElementNode(targetParagraph)) {
    return false;
  }

  const caretNode = ensureParagraphTextNode(
    targetParagraph,
  );
  const caretOffset = caretNode.getTextContentSize();
  while (sourceParagraph.getFirstChild()) {
    targetParagraph.append(sourceParagraph.getFirstChild()!);
  }
  sourceParagraph.remove();
  caretNode.select(caretOffset, caretOffset);
  return true;
}

function splitParagraphAtSelection() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }

  const anchorNode = selection.anchor.getNode();
  const anchorOffset = selection.anchor.offset;

  if ($isTextNode(anchorNode) && !$isComposerChipNode(anchorNode)) {
    const paragraph = anchorNode.getTopLevelElementOrThrow();
    if (!$isElementNode(paragraph)) {
      return false;
    }

    const newParagraph = $createParagraphNode();
    paragraph.insertAfter(newParagraph);

    const textNode = anchorNode as ComposerTextNode;
    if (anchorOffset < textNode.getTextContentSize()) {
      const splitNodes = textNode.splitText(anchorOffset);
      const trailingNode = splitNodes[1] ?? null;
      moveNodesIntoParagraph(trailingNode, newParagraph);
    } else {
      moveNodesIntoParagraph(textNode.getNextSibling(), newParagraph);
    }

    selectParagraphStart(newParagraph);
    return true;
  }

  if ($isComposerChipNode(anchorNode)) {
    const paragraph = anchorNode.getTopLevelElementOrThrow();
    if (!$isElementNode(paragraph)) {
      return false;
    }

    const newParagraph = $createParagraphNode();
    paragraph.insertAfter(newParagraph);
    moveNodesIntoParagraph(anchorNode.getNextSibling(), newParagraph);
    selectParagraphStart(newParagraph);
    return true;
  }

  if ($isElementNode(anchorNode)) {
    const paragraph = anchorNode.getTopLevelElementOrThrow();
    if (!$isElementNode(paragraph) || !anchorNode.is(paragraph)) {
      return false;
    }

    const newParagraph = $createParagraphNode();
    paragraph.insertAfter(newParagraph);
    moveNodesIntoParagraph(paragraph.getChildAtIndex(anchorOffset), newParagraph);
    selectParagraphStart(newParagraph);
    return true;
  }

  return false;
}

function finalizeDeletionFallback() {
  const trailingTextNode = ensureTrailingComposerTextNode();
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    trailingTextNode.select(
      trailingTextNode.getTextContentSize(),
      trailingTextNode.getTextContentSize(),
    );
  }
}

function deleteTextCharacterBoundary(
  _textNode: ComposerTextNode,
  _isBackward: boolean,
) {
  // Plain text character deletion is deferred to Lexical's default editing path.
  // Returning false lets KEY_BACKSPACE_COMMAND / KEY_DELETE_COMMAND continue
  // propagation so the built-in PlainTextPlugin handles the deletion natively.
  return false;
}

function deleteSiblingBoundary(
  node: LexicalNode,
  isBackward: boolean,
  fallbackTextNode?: ComposerTextNode,
) {
  const sibling = isBackward ? node.getPreviousSibling() : node.getNextSibling();
  if (!sibling) {
    const parent = node.getParent();
    return parent ? mergeParagraphBoundary(parent, isBackward) : false;
  }
  if ($isComposerChipNode(sibling)) {
    sibling.remove();
    if (fallbackTextNode) {
      const offset = isBackward ? 0 : fallbackTextNode.getTextContentSize();
      fallbackTextNode.select(offset, offset);
    }
    return true;
  }
  if ($isTextNode(sibling) && !$isComposerChipNode(sibling)) {
    return deleteTextCharacterBoundary(sibling as ComposerTextNode, isBackward);
  }
  return false;
}

function handleCollapsedDeletion(isBackward: boolean) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }

  const anchorNode = selection.anchor.getNode();
  const anchorOffset = selection.anchor.offset;

  if ($isTextNode(anchorNode) && !$isComposerChipNode(anchorNode)) {
    const textNode = anchorNode as ComposerTextNode;
    const textLength = textNode.getTextContentSize();
    if ((isBackward && anchorOffset > 0) || (!isBackward && anchorOffset < textLength)) {
      // Plain text deletion — let Lexical's built-in editing path handle it.
      return false;
    }
    return deleteSiblingBoundary(textNode, isBackward, textNode);
  }

  if ($isComposerChipNode(anchorNode)) {
    const paragraph = anchorNode.getParent();
    const index = anchorNode.getIndexWithinParent();
    anchorNode.remove();
    if ($isElementNode(paragraph)) {
      ensureParagraphShape(paragraph);
      const nextOffset = isBackward ? Math.max(0, index - 1) : index;
      paragraph.select(nextOffset, nextOffset);
    }
    return true;
  }

  if ($isElementNode(anchorNode)) {
    const childIndex = isBackward ? anchorOffset - 1 : anchorOffset;
    const child = anchorNode.getChildAtIndex(childIndex);
    if (!child) {
      return mergeParagraphBoundary(anchorNode, isBackward) || true;
    }
    if ($isComposerChipNode(child)) {
      child.remove();
      ensureParagraphShape(anchorNode);
      const nextOffset = isBackward
        ? Math.max(0, anchorOffset - 1)
        : anchorOffset;
      anchorNode.select(nextOffset, nextOffset);
      return true;
    }
    if ($isTextNode(child) && !$isComposerChipNode(child)) {
      const textNode = child as ComposerTextNode;
      const textLength = textNode.getTextContentSize();
      if (textLength === 0) {
        return deleteSiblingBoundary(textNode, isBackward, textNode);
      }
      // Plain text deletion on an adjacent text node — let Lexical handle it.
      return false;
    }
  }

  return false;
}

function handleDeleteCommand(isBackward: boolean) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    finalizeDeletionFallback();
    return true;
  }

  if (!selection.isCollapsed()) {
    // If the selection spans chips, we must handle removal structurally.
    // Otherwise, let Lexical's built-in deletion handle plain text ranges.
    const nodes = selection.getNodes();
    const hasChip = nodes.some((node) => $isComposerChipNode(node));
    if (!hasChip) {
      return false;
    }
    selection.removeText();
    finalizeDeletionFallback();
    return true;
  }

  const handled = handleCollapsedDeletion(isBackward);
  if (handled) {
    finalizeDeletionFallback();
  }
  return handled;
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

function findTextOffset(textElement: HTMLElement, container: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(textElement);
  try {
    range.setEnd(container, offset);
  } catch {
    return (textElement.textContent ?? "").length;
  }
  return Math.min(range.toString().length, (textElement.textContent ?? "").length);
}

function findNearestTextElement(root: HTMLElement, childIndex: number) {
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
        offset: (candidate.textContent ?? "").length,
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
  if (container === root) {
    return findNearestTextElement(root, offset);
  }
  let current: Node | null = container;
  while (current && current.parentNode !== root) {
    current = current.parentNode;
  }
  if (
    current instanceof HTMLElement &&
    current.dataset.segmentKind === "text" &&
    current.dataset.segmentId
  ) {
    return {
      segmentId: current.dataset.segmentId,
      offset: findTextOffset(current, container, offset),
    };
  }
  if (current) {
    const childIndex = Array.from(root.childNodes).indexOf(current as ChildNode);
    return findNearestTextElement(root, Math.max(0, childIndex + offset));
  }
  return null;
}

export function restoreSelectionBookmark(
  root: HTMLElement,
  bookmark: ComposerSelectionBookmark | null,
) {
  if (!bookmark) {
    return;
  }
  const start = root.querySelector<HTMLElement>(
    `[data-segment-id="${bookmark.start.segmentId}"]`,
  );
  const end = root.querySelector<HTMLElement>(
    `[data-segment-id="${bookmark.end.segmentId}"]`,
  );
  if (!start || !end) {
    return;
  }
  try {
    const range = document.createRange();
    const startNode = start.firstChild ?? start;
    const endNode = end.firstChild ?? end;
    range.setStart(startNode, Math.min(bookmark.start.offset, startNode.textContent?.length ?? 0));
    range.setEnd(endNode, Math.min(bookmark.end.offset, endNode.textContent?.length ?? 0));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } catch {
    // Best effort helper for tests and DOM edge-case validation.
  }
}

function syncDomSelectionToLexicalState(
  root: HTMLElement | null,
  editor: LexicalEditor | null,
) {
  if (!root || !editor) {
    return;
  }

  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      return;
    }

    const anchorNode = selection.anchor.getNode();
    let targetNode: Node | null = null;
    let targetOffset = 0;

    if ($isTextNode(anchorNode) && !$isComposerChipNode(anchorNode)) {
      const target = root.querySelector<HTMLElement>(
        `[data-segment-id="${anchorNode.getKey()}"]`,
      );
      targetNode = target?.firstChild ?? target ?? null;
      targetOffset = Math.min(
        selection.anchor.offset,
        targetNode?.textContent?.length ?? 0,
      );
    } else if ($isElementNode(anchorNode)) {
      const child = anchorNode.getChildAtIndex(selection.anchor.offset);
      const boundaryTextNode =
        findBoundaryTextNode(child, "start") ??
        findBoundaryTextNode(
          selection.anchor.offset > 0
            ? anchorNode.getChildAtIndex(selection.anchor.offset - 1)
            : null,
          "end",
        );
      if (boundaryTextNode) {
        const target = root.querySelector<HTMLElement>(
          `[data-segment-id="${boundaryTextNode.getKey()}"]`,
        );
        targetNode = target?.firstChild ?? target ?? null;
        targetOffset =
          boundaryTextNode.getKey() === child?.getKey()
            ? 0
            : boundaryTextNode.getTextContentSize();
      }
    }

    if (!targetNode) {
      return;
    }

    try {
      const range = document.createRange();
      range.setStart(targetNode, targetOffset);
      range.collapse(true);
      const domSelection = window.getSelection();
      domSelection?.removeAllRanges();
      domSelection?.addRange(range);
    } catch {
      // Best effort sync for host DOM selection after structural editor edits.
    }
  });
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

function EditorHandlePlugin({
  onReady,
}: {
  onReady: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    onReady(editor);
  }, [editor, onReady]);

  return null;
}

function EditorEnterPlugin({
  onEnter,
  onShiftEnter,
  isComposing,
}: {
  onEnter: () => boolean;
  onShiftEnter: () => boolean;
  isComposing: () => boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (isComposing() || event?.isComposing) {
            // Block the host's default Enter behaviour during IME composition
            // to prevent stray newline insertion or premature submission.
            event?.preventDefault();
            return true;
          }
          event?.preventDefault();
          if (event?.shiftKey) {
            return onShiftEnter();
          }
          return onEnter();
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, isComposing, onEnter, onShiftEnter],
  );

  return null;
}

function EditorDeletePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      () => handleDeleteCommand(true),
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterDelete = editor.registerCommand(
      KEY_DELETE_COMMAND,
      () => handleDeleteCommand(false),
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterBackspace();
      unregisterDelete();
    };
  }, [editor]);

  return null;
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

  const [editorRevision, setEditorRevision] = useState(0);
  const [editorProjection, setEditorProjection] = useState<EditorProjection>(() =>
    buildInitialProjection({
      composerPrompt,
      selectedSkills: externallySelectedSkills,
      contextChips,
    }),
  );
  const editorSeedVersionRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const editorApiRef = useRef<LexicalEditor | null>(null);
  const lastOverlayHeightRef = useRef<number | undefined>(undefined);
  const shouldScrollPastedTextRef = useRef(false);
  const previousHideComposerRef = useRef(false);
  const lastExportedRef = useRef(
    buildContentSnapshot({
      composerPrompt,
      selectedSkills: externallySelectedSkills,
      contextChips,
    }),
  );
  const lastAppliedSeedTokenRef = useRef(
    buildSeedToken({
      sessionId,
      composerPrompt,
      selectedSkills: externallySelectedSkills,
      contextChips,
    }),
  );
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
  const [hasPendingUserInput, setHasPendingUserInput] = useState(false);
  const isComposingRef = useRef(false);
  const contextChipMapRef = useRef(new Map<string, ChatInputContextChip>());

  contextChipMapRef.current = new Map(contextChips.map((chip) => [chip.id, chip]));

  const plainTextPrompt = editorProjection.prompt;
  const selectedSkillIdSet = useMemo(
    () => new Set(editorProjection.skillIds),
    [editorProjection.skillIds],
  );
  const slashQuery = editorProjection.slashContext?.query ?? "";
  const interactivity = getComposerInteractivity({
    composerPrompt: plainTextPrompt,
    runInteractionState,
  });
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
    Boolean(editorProjection.slashContext) &&
    filteredSkillOptions.length > 0;
  const hasFileChips =
    projectFileAttachments.length > 0 ||
    localFileAttachments.length > 0 ||
    imageAttachments.length > 0;
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
    const incomingSnapshot = buildContentSnapshot({
      composerPrompt,
      selectedSkills: externallySelectedSkills,
      contextChips,
    });
    const incomingSeedToken = buildSeedToken({
      sessionId,
      composerPrompt,
      selectedSkills: externallySelectedSkills,
      contextChips,
    });
    const shouldReset =
      sessionId !== JSON.parse(lastAppliedSeedTokenRef.current).sessionId ||
      composerPrompt !== lastExportedRef.current.prompt ||
      !arraysEqual(incomingSnapshot.skillIds, lastExportedRef.current.skillIds) ||
      !arraysEqual(
        incomingSnapshot.contextIds,
        lastExportedRef.current.contextIds,
      ) ||
      incomingSeedToken !== lastAppliedSeedTokenRef.current;

    if (!shouldReset) {
      return;
    }

    lastAppliedSeedTokenRef.current = incomingSeedToken;
    lastExportedRef.current = incomingSnapshot;
    editorSeedVersionRef.current += 1;
    setEditorProjection(
      buildInitialProjection({
        composerPrompt,
        selectedSkills: externallySelectedSkills,
        contextChips,
      }),
    );
    setHasPendingUserInput(false);
    setOpenPicker((current) => (current === "skills" ? undefined : current));
    setSkillListExpanded(false);
    setSkillPickerIndex(0);
    setEditorRevision((current) => current + 1);
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
    const target = editorRootRef.current;
    if (!target) return;
    resizeComposerTextarea(target);
    target.scrollLeft = 0;
    if (shouldScrollPastedTextRef.current) {
      shouldScrollPastedTextRef.current = false;
      scrollComposerTextareaToBottom(target);
    } else if (!plainTextPrompt) {
      target.scrollTop = 0;
    }
    scrollComposerCaretIntoSafeView(target);
  }, [plainTextPrompt, editorRevision]);

  useEffect(() => {
    if (previousHideComposerRef.current && !hideComposer) {
      window.requestAnimationFrame(() => editorRootRef.current?.focus());
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
      Boolean(editorProjection.slashContext) &&
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
  }, [filteredSkillOptions.length, openPicker, editorProjection.slashContext]);

  function syncProjection(nextProjection: EditorProjection) {
    // Guard against projection-equivalent re-exports when only the selection
    // changed but the derived projection fields (prompt, skills, contexts,
    // slashContext) stayed identical.
    const current = editorProjection;
    if (
      nextProjection.prompt === current.prompt &&
      arraysEqual(nextProjection.skillIds, current.skillIds) &&
      arraysEqual(nextProjection.contextIds, current.contextIds) &&
      slashContextEqual(nextProjection.slashContext, current.slashContext)
    ) {
      return;
    }

    const previous = lastExportedRef.current;
    const nextSelectedSkills = nextProjection.skillIds
      .map((skillId) =>
        skillOptions.find(
          (skill) => skill.id === skillId || skill.name === skillId,
        ),
      )
      .filter((skill): skill is SkillDescriptor => Boolean(skill));
    const nextContextChips = nextProjection.contextIds
      .map((contextId) => contextChipMapRef.current.get(contextId))
      .filter((chip): chip is ChatInputContextChip => Boolean(chip));
    // During IME composition we suppress all state updates to avoid
    // contaminating the dedupe guard (which would otherwise see an
    // already-stale current projection and skip the post-composition
    // export).
    if (isComposingRef.current) {
      return;
    }

    const currentSeedVersion = editorSeedVersionRef.current;
    setEditorProjection(nextProjection);
    if (nextProjection.prompt.length > 0) {
      setHasPendingUserInput(false);
    }

    lastExportedRef.current = {
      prompt: nextProjection.prompt,
      skillIds: nextProjection.skillIds,
      contextIds: nextProjection.contextIds,
    };
    lastAppliedSeedTokenRef.current = buildSeedToken({
      sessionId,
      composerPrompt: nextProjection.prompt,
      selectedSkills: nextSelectedSkills,
      contextChips: nextContextChips,
    });
    if (currentSeedVersion !== editorSeedVersionRef.current) {
      return;
    }
    if (nextProjection.prompt !== previous.prompt) {
      onPromptChange(nextProjection.prompt);
    }
    if (!arraysEqual(previous.skillIds, nextProjection.skillIds)) {
      onSelectedSkillIdsChange([...new Set(nextProjection.skillIds)]);
    }
    for (const contextId of previous.contextIds) {
      if (!nextProjection.contextIds.includes(contextId)) {
        contextChipMapRef.current.get(contextId)?.onRemove?.();
      }
    }
  }

  function slashContextEqual(
    a: SlashTriggerContext | null,
    b: SlashTriggerContext | null,
  ): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    return (
      a.nodeKey === b.nodeKey &&
      a.caretOffset === b.caretOffset &&
      a.replaceStartOffset === b.replaceStartOffset &&
      a.rawText === b.rawText &&
      a.query === b.query
    );
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

  function selectSkill(skill: SkillDescriptor) {
    const editor = editorApiRef.current;
    const slashContext = editorProjection.slashContext;
    if (!editor || !slashContext) {
      return;
    }
    editor.update(
      () => {
        const node = $getNodeByKey(slashContext.nodeKey);
        if (!$isTextNode(node) || $isComposerChipNode(node)) {
          return;
        }
        const text = node.getTextContent();
        const beforeLine = text.slice(0, slashContext.replaceStartOffset);
        const rawTrailing = text
          .slice(slashContext.caretOffset)
          .replace(/^\s+/, "");
        const trailingText =
          rawTrailing.length === 0
            ? " "
            : rawTrailing.startsWith(" ")
              ? rawTrailing
              : ` ${rawTrailing}`;

        const chipNode = $createComposerChipNode({
          chipId: skill.id,
          chipKind: "skill",
          label: skill.name,
        });
        const nextTextNode = $createComposerTextNode(trailingText);

        if (beforeLine.length > 0) {
          node.setTextContent(beforeLine);
          node.insertAfter(chipNode);
        } else {
          node.replace(chipNode);
        }
        chipNode.insertAfter(nextTextNode);
        const trailingCaretOffset =
          trailingText.startsWith(" ") && trailingText.length > 0 ? 1 : 0;
        nextTextNode.select(trailingCaretOffset, trailingCaretOffset);
      },
      { discrete: true },
    );
    setOpenPicker(undefined);
    setSkillListExpanded(false);
    window.requestAnimationFrame(() => {
      syncDomSelectionToLexicalState(
        editorRootRef.current,
        editorApiRef.current,
      );
      editorRootRef.current?.focus();
    });
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      event.key.length === 1 &&
      !event.nativeEvent.isComposing &&
      !isComposingRef.current
    ) {
      setHasPendingUserInput(true);
    }

    if (isComposingRef.current || event.nativeEvent.isComposing) {
      return;
    }

    // Tab only overrides default focus navigation when the skill picker is open.
    if (event.key === "Tab" && !event.shiftKey && openPicker === "skills") {
      event.preventDefault();
      confirmSkillPickerSelection();
      return;
    }

    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      const nextIntent =
        taskIntent === "implement"
          ? "plan"
          : taskIntent === "plan"
            ? "implement"
            : "plan";
      onTaskIntentChange(nextIntent);
      return;
    }

    if (event.key === "Escape" && openPicker === "skills") {
      setOpenPicker(undefined);
      return;
    }
    if (event.key === "ArrowDown" && openPicker === "skills") {
      event.preventDefault();
      const maxIndex =
        hiddenSkillCount > 0
          ? visibleSkillOptions.length
          : visibleSkillOptions.length - 1;
      setSkillPickerIndex((prev) => (prev >= maxIndex ? 0 : prev + 1));
      return;
    }
    if (event.key === "ArrowUp" && openPicker === "skills") {
      event.preventDefault();
      const maxIndex =
        hiddenSkillCount > 0
          ? visibleSkillOptions.length
          : visibleSkillOptions.length - 1;
      setSkillPickerIndex((prev) => (prev <= 0 ? maxIndex : prev - 1));
      return;
    }
    if (event.key === "Enter" && openPicker === "skills") {
      event.preventDefault();
      return;
    }
  }

  function handleEnterCommand() {
    if (openPicker === "skills") {
      confirmSkillPickerSelection();
      return true;
    }
    if (runInteractionState.isProcessing) {
      onStopRun();
      return true;
    }
    if (interactivity.canSubmit) {
      onStartRun();
      return true;
    }
    return true;
  }

  function handleShiftEnterCommand() {
    editorApiRef.current?.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return;
        }
        if (!selection.isCollapsed()) {
          selection.removeText();
        }
        if (!splitParagraphAtSelection()) {
          selection.insertParagraph();
          const root = $getRoot();
          for (const child of root.getChildren()) {
            ensureParagraphShape(child);
          }
        }
      },
      { discrete: true },
    );
    return true;
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

  const initialConfig = useMemo(
    () => ({
      namespace: "ora-chat-input",
      editable: true,
      nodes: [ComposerChipNode, ComposerTextNode],
      onError: (error: Error) => {
        throw error;
      },
      editorState: (editor: LexicalEditor) => {
        editor.update(() => {
          populateEditorFromSeed({
            composerPrompt,
            selectedSkills: externallySelectedSkills,
            contextChips,
          });
        });
      },
    }),
    [composerPrompt, contextChips, externallySelectedSkills],
  );

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
            <div className="pointer-events-auto absolute bottom-full left-3 z-50 mb-2 max-h-[min(32rem,calc(100vh-12rem))] w-[min(26rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lift">
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
                <LexicalComposer key={editorRevision} initialConfig={initialConfig}>
                  <PlainTextPlugin
                    contentEditable={
                      <ContentEditable
                        ref={editorRootRef}
                        role="textbox"
                        aria-multiline="true"
                        data-testid="chat-input-editor"
                        className={cn(
                          "max-h-[220px] w-full overflow-y-auto bg-transparent px-4 text-sm leading-5 outline-none",
                          "whitespace-pre-wrap break-words",
                          "[&_p]:m-0",
                          interactivity.canEditText
                            ? "cursor-text"
                            : "cursor-not-allowed opacity-60",
                          hasFileChips ? "min-h-[140px] pt-14" : "min-h-[112px] pt-5",
                        )}
                        style={{
                          height: "auto",
                          paddingBottom: `${COMPOSER_BOTTOM_SAFE_AREA_PX}px`,
                        }}
                        onKeyDown={handleEditorKeyDown}
                        onCompositionStart={() => {
                          isComposingRef.current = true;
                          setHasPendingUserInput(true);
                        }}
                        onCompositionEnd={(_event: CompositionEvent<HTMLDivElement>) => {
                          isComposingRef.current = false;
                          setHasPendingUserInput(false);
                          // The final IME commit fires OnChangePlugin *before* the
                          // compositionend DOM event reaches this handler, while
                          // isComposingRef is still true, so OnChangePlugin suppressed
                          // the export.  We must perform exactly one flush here now
                          // that the flag is cleared.  OnChangePlugin will not trigger
                          // again because the editor state stays unchanged after
                          // compositionend.
                          editorApiRef.current?.update(() => {
                            syncProjection(readEditorProjection());
                          });
                          window.requestAnimationFrame(() => {
                            scrollComposerCaretIntoSafeView(
                              editorRootRef.current as ComposerEditableScrollTarget,
                            );
                          });
                        }}
                        onBlur={() => {
                          if (!plainTextPrompt) {
                            setHasPendingUserInput(false);
                          }
                        }}
                        onPaste={(event) => {
                          const items = event.clipboardData?.items;
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
                              event.preventDefault();
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
                          shouldScrollPastedTextRef.current = true;
                          setHasPendingUserInput(true);
                        }}
                      />
                    }
                    placeholder={
                      <div className="pointer-events-none absolute left-4 top-4 text-sm text-muted-foreground">
                        {!runInteractionState.isProcessing &&
                        !isComposingRef.current &&
                        !hasPendingUserInput &&
                        plainTextPrompt.length === 0
                          ? localizedPlaceholder
                          : null}
                      </div>
                    }
                    ErrorBoundary={LexicalErrorBoundary}
                  />
                  <HistoryPlugin delay={COMPOSER_UNDO_DEBOUNCE_MS} />
                  <OnChangePlugin
                    ignoreHistoryMergeTagChange={false}
                    ignoreSelectionChange={false}
                    onChange={(editorState) => {
                      editorState.read(() => {
                        syncProjection(readEditorProjection());
                      });
                    }}
                  />
                  <EditorHandlePlugin
                    onReady={(editor) => {
                      editorApiRef.current = editor;
                      if (editorRootRef.current) {
                        (
                          editorRootRef.current as HTMLDivElement & {
                            __oraLexicalEditor?: LexicalEditor;
                          }
                        ).__oraLexicalEditor = editor;
                      }
                    }}
                  />
                  <EditorEnterPlugin
                    onEnter={handleEnterCommand}
                    onShiftEnter={handleShiftEnterCommand}
                    isComposing={() => isComposingRef.current}
                  />
                  <EditorDeletePlugin />
                </LexicalComposer>
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
