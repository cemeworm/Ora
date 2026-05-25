// @vitest-environment jsdom

import {
  $createRangeSelection,
  $isElementNode,
  $getRoot,
  $setSelection,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  REDO_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
  UNDO_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  act,
  createElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatInput,
  getComposerTrayVisibility,
  getContextRingState,
  getCurrentLineInfo,
  restoreSelectionBookmark,
  scrollComposerCaretIntoSafeView,
  scrollComposerTextareaToBottom,
} from "./ChatInput";
import { $isComposerChipNode } from "./chatInput/ComposerChipNode";
import {
  CHAT_SURFACE_FRAME_WIDTH_CLASS,
  CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS,
  CHAT_SURFACE_VIEWPORT_GUTTER_CLASS,
} from "./chatSurfaceLayout";

const BASE_RUN_INTERACTION_STATE = {
  status: "idle" as const,
  isProcessing: false,
  canSubmit: true,
  canStop: false,
  canResume: false,
  canRebuild: false,
  authority: "session_summary" as const,
};

const BASE_MODE = {
  id: "single_agent",
  family: "single_agent" as const,
  label: "单智能体",
  summary: "默认模式",
  recommendedUse: "默认",
  failureMode: "无",
  isPreset: true,
};

const SKILL_OPTIONS = [
  {
    id: "release-helper",
    name: "release-helper",
    description: "Helps release work",
    category: "private",
    enabled: true,
  },
  {
    id: "doc-helper",
    name: "doc-helper",
    description: "Helps documentation work",
    category: "private",
    enabled: true,
  },
];

const cleanupCallbacks: Array<() => void> = [];

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

if (typeof Text !== "undefined") {
  const textPrototype = Text.prototype as Text & {
    getBoundingClientRect?: () => DOMRect;
    getClientRects?: () => DOMRectList;
  };
  if (typeof textPrototype.getBoundingClientRect !== "function") {
    textPrototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  }
  if (typeof textPrototype.getClientRects !== "function") {
    textPrototype.getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      }) as unknown as DOMRectList;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  while (cleanupCallbacks.length > 0) {
    cleanupCallbacks.pop()?.();
  }
  document.body.innerHTML = "";
});

function createBaseProps(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    composerPrompt: "",
    isLoading: false,
    runInteractionState: BASE_RUN_INTERACTION_STATE,
    activeMode: BASE_MODE,
    modeOptions: [],
    selectedModeSelection: "manual",
    activeProvider: undefined,
    contextState: undefined,
    providerOptions: [],
    skillOptions: SKILL_OPTIONS,
    selectedSkillIds: [],
    contextChips: [],
    placeholder: "Message Ora",
    selectedCustomAgentId: undefined,
    projectFileAttachments: [],
    localFileAttachments: [],
    imageAttachments: [],
    onRemoveImageAttachment: () => {},
    onAddImageAttachment: () => {},
    approvalActions: [],
    approvalDisabled: false,
    onApprove: undefined,
    onCancelApproval: undefined,
    clarificationQuestions: [],
    onSubmitAllClarifications: undefined,
    onModeChange: () => {},
    onModeSelectionChange: () => {},
    onProviderChange: () => {},
    onPromptChange: () => {},
    onSelectedSkillIdsChange: () => {},
    onRemoveProjectFileAttachment: () => {},
    onRemoveLocalFileAttachment: () => {},
    onOpenLocalFiles: () => {},
    onFilesDropped: undefined,
    onClearSelectedCustomAgent: undefined,
    permissionMode: "default",
    onPermissionModeChange: () => {},
    taskIntent: "implement",
    onTaskIntentChange: () => {},
    planDecisionPending: false,
    planSteps: [],
    onConfirmPlanDecision: undefined,
    onDeclinePlanDecision: undefined,
    onOverlayHeightChange: undefined,
    surfaceFrameWidthClassName: undefined,
    onStartRun: () => {},
    onStopRun: () => {},
    ...overrides,
  };
}

function renderElement(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  const cleanup = () => {
    act(() => {
      root.unmount();
    });
    container.remove();
  };
  cleanupCallbacks.push(cleanup);

  return {
    container,
    rerender(nextElement: ReturnType<typeof createElement>) {
      act(() => {
        root.render(nextElement);
      });
    },
    unmount: cleanup,
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitFor(ms: number) {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  });
}

function getEditor(container: HTMLElement) {
  const editor = container.querySelector(
    '[data-testid="chat-input-editor"]',
  ) as HTMLDivElement | null;
  expect(editor).toBeTruthy();
  return editor!;
}

function getAttachmentRail(container: HTMLElement) {
  const rail = container.querySelector(
    '[data-testid="composer-attachment-rail"]',
  ) as HTMLDivElement | null;
  expect(rail).toBeTruthy();
  return rail!;
}

function getImagePreviewDialog() {
  return document.body.querySelector(
    '[data-testid="composer-image-preview-dialog"]',
  ) as HTMLDivElement | null;
}

function getSkillChips(editor: HTMLElement) {
  return Array.from(
    editor.querySelectorAll<HTMLElement>('[data-segment-kind="skill-chip"]'),
  );
}

function getContextChips(editor: HTMLElement) {
  return Array.from(
    editor.querySelectorAll<HTMLElement>('[data-segment-kind="context-chip"]'),
  );
}

function getPlaceholder(container: HTMLElement) {
  return Array.from(container.querySelectorAll("div")).find(
    (node) =>
      node.className.includes("text-muted-foreground") &&
      node.textContent?.includes("Ora"),
  ) as HTMLDivElement | undefined;
}

function dispatchEditorKey(
  editor: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
) {
  act(() => {
    editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...init }));
  });
}

function dispatchComposition(
  editor: HTMLElement,
  type: "compositionstart" | "compositionend",
  data = "",
) {
  act(() => {
    editor.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
  });
}

function sanitizeText(value: string | null | undefined) {
  return (value ?? "").replaceAll("\u200b", "");
}

function withLexicalEditor<T>(
  editorElement: HTMLElement,
  run: (editor: LexicalEditor) => T,
): T {
  const editor = (
    editorElement as HTMLElement & { __oraLexicalEditor?: LexicalEditor }
  ).__oraLexicalEditor;
  if (!editor) {
    throw new Error("Expected a Lexical editor for chat input");
  }
  return run(editor);
}

function setSelectionByTextOffsets(
  editorElement: HTMLElement,
  start: number,
  end = start,
) {
  act(() => {
    withLexicalEditor(editorElement, (editor) => {
      editor.update(() => {
        const root = $getRoot();
        const selection = $createRangeSelection();

        function resolvePoint(offset: number) {
          let remaining = offset;
          const paragraphs = root.getChildren();
          for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
            const paragraph = paragraphs[paragraphIndex];
            if ($isElementNode(paragraph)) {
              const children = paragraph.getChildren();
              for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
                const node = children[childIndex];
                if ($isTextNode(node) && !$isComposerChipNode(node)) {
                  const length = node.getTextContentSize();
                  if (remaining <= length) {
                    return { key: node.getKey(), offset: remaining, type: "text" as const };
                  }
                  remaining -= length;
                }
              }
              if (paragraphIndex < paragraphs.length - 1) {
                if (remaining === 0) {
                  return {
                    key: paragraph.getKey(),
                    offset: children.length,
                    type: "element" as const,
                  };
                }
                remaining -= 1;
              }
            }
          }

          const lastParagraph = paragraphs[paragraphs.length - 1];
          if (lastParagraph && $isElementNode(lastParagraph)) {
            const children = lastParagraph.getChildren();
            const lastTextNode = [...children]
              .reverse()
              .find((child) => $isTextNode(child) && !$isComposerChipNode(child));
            if (lastTextNode && $isTextNode(lastTextNode)) {
              return {
                key: lastTextNode.getKey(),
                offset: lastTextNode.getTextContentSize(),
                type: "text" as const,
              };
            }
            return {
              key: lastParagraph.getKey(),
              offset: children.length,
              type: "element" as const,
            };
          }
          return null;
        }

        const anchor = resolvePoint(start);
        const focus = resolvePoint(end);

        if (anchor) {
          selection.anchor.set(anchor.key, anchor.offset, anchor.type);
        }
        if (focus) {
          selection.focus.set(focus.key, focus.offset, focus.type);
        }

        $setSelection(selection);
      });
    });
  });
}

function setSelectionByParagraphChildOffset(
  editorElement: HTMLElement,
  childOffset: number,
  paragraphIndex = 0,
) {
  act(() => {
    withLexicalEditor(editorElement, (editor) => {
      editor.update(() => {
        const root = $getRoot();
        const paragraph = root.getChildAtIndex(paragraphIndex);
        if (!$isElementNode(paragraph)) {
          return;
        }
        const selection = $createRangeSelection();
        selection.anchor.set(paragraph.getKey(), childOffset, "element");
        selection.focus.set(paragraph.getKey(), childOffset, "element");
        $setSelection(selection);
      });
    });
  });
}

function insertTextViaLexical(editorElement: HTMLElement, text: string) {
  act(() => {
    withLexicalEditor(editorElement, (editor) => {
      editor.update(
        () => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertText(text);
          }
        },
        {
          discrete: true,
          tag: [SKIP_DOM_SELECTION_TAG, SKIP_SCROLL_INTO_VIEW_TAG],
        },
      );
    });
  });
}

async function typeTextViaKeyboard(editorElement: HTMLElement, text: string) {
  for (const char of text) {
    dispatchEditorKey(editorElement, char);
    insertTextViaLexical(editorElement, char);
    await flushMicrotasks();
  }
}

function getPlainPromptFromEditor(editorElement: HTMLElement) {
  return withLexicalEditor(editorElement, (editor) =>
    editor.getEditorState().read(() => sanitizeText($getRoot().getTextContent())),
  );
}

type HarnessState = {
  prompt: string;
  selectedSkillIds: string[];
  contextIds: string[];
};

function ChatInputHarness({
  sessionId = "session-1",
  initialPrompt = "",
  initialSkillIds = [],
  initialContextChips = [],
  onStartRun = () => {},
  onStateChange,
}: {
  sessionId?: string;
  initialPrompt?: string;
  initialSkillIds?: string[];
  initialContextChips?: Array<{ id: string; label: string; tone?: "widget" }>;
  onStartRun?: () => void;
  onStateChange: (state: HarnessState) => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [selectedSkillIds, setSelectedSkillIds] = useState(initialSkillIds);
  const [contextIds, setContextIds] = useState(
    initialContextChips.map((chip) => chip.id),
  );
  const contextChipMap = useMemo(
    () => new Map(initialContextChips.map((chip) => [chip.id, chip])),
    [initialContextChips],
  );
  const contextChips = contextIds
    .map((id) => contextChipMap.get(id))
    .filter((chip): chip is NonNullable<typeof chip> => Boolean(chip))
    .map((chip) => ({
      id: chip.id,
      label: chip.label,
      tone: chip.tone,
      onRemove: () => {
        setContextIds((current) => current.filter((value) => value !== chip.id));
      },
    }));

  useEffect(() => {
    onStateChange({ prompt, selectedSkillIds, contextIds });
  }, [contextIds, onStateChange, prompt, selectedSkillIds]);

  return createElement(
    ChatInput as any,
    createBaseProps({
      sessionId,
      composerPrompt: prompt,
      selectedSkillIds,
      contextChips,
      onPromptChange: setPrompt,
      onSelectedSkillIdsChange: setSelectedSkillIds,
      onStartRun,
    }),
  );
}

describe("chat input tray visibility", () => {
  it("prioritizes clarification over plan decision", () => {
    expect(
      getComposerTrayVisibility({
        isLoading: false,
        clarificationCount: 2,
        canSubmitClarifications: true,
        hasPlanDecision: true,
        canResolvePlanDecision: true,
      }),
    ).toEqual({
      showClarificationTray: true,
      showPlanDecisionTray: false,
      hideComposer: true,
    });
  });

  it("shows plan decision after clarifications are resolved", () => {
    expect(
      getComposerTrayVisibility({
        isLoading: false,
        clarificationCount: 0,
        canSubmitClarifications: true,
        hasPlanDecision: true,
        canResolvePlanDecision: true,
      }),
    ).toEqual({
      showClarificationTray: false,
      showPlanDecisionTray: true,
      hideComposer: true,
    });
  });

  it("restores the composer after a declined plan decision clears the gate", () => {
    expect(
      getComposerTrayVisibility({
        isLoading: false,
        clarificationCount: 0,
        canSubmitClarifications: true,
        hasPlanDecision: false,
        canResolvePlanDecision: false,
      }),
    ).toEqual({
      showClarificationTray: false,
      showPlanDecisionTray: false,
      hideComposer: false,
    });
  });

  it("keeps the composer available for ordinary clarification resumes", () => {
    expect(
      getComposerTrayVisibility({
        isLoading: false,
        clarificationCount: 1,
        canSubmitClarifications: true,
        hasPlanDecision: false,
        canResolvePlanDecision: false,
      }),
    ).toEqual({
      showClarificationTray: true,
      showPlanDecisionTray: false,
      hideComposer: false,
    });
  });
});

describe("chat input surface layout", () => {
  it("uses the shared surface frame width inside the overlay-safe chat coordinate space", () => {
    const html = renderToStaticMarkup(
      createElement(ChatInput as any, createBaseProps()),
    );

    expect(html).toContain('data-testid="chat-input-surface-frame"');
    expect(html).toContain('data-testid="chat-input-surface-card"');
    expect(html).toContain(CHAT_SURFACE_FRAME_WIDTH_CLASS);
    expect(html).toContain(CHAT_SURFACE_VIEWPORT_GUTTER_CLASS);
    expect(html).toContain(CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS);
    expect(html).not.toContain("lg:-mr-4");
    expect(html).not.toContain("xl:-mr-6");
    expect(html).not.toContain("max-w-[88rem]");
  });

  it("keeps overlay padding symmetric so the composer stays centered", () => {
    expect(CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS).toContain("lg:px-4");
    expect(CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS).toContain("xl:px-6");
    expect(CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS).not.toContain("lg:pr-4");
    expect(CHAT_SURFACE_OVERLAY_SCROLLBAR_PADDING_CLASS).not.toContain("xl:pr-6");
  });
});

describe("chat input context ring", () => {
  it("uses session context window and token usage when context state is available", () => {
    expect(
      getContextRingState({
        contextState: {
          activeTokenUsage: {
            inputTokens: 400,
            outputTokens: 100,
            totalTokens: 500,
            source: "estimate",
          },
          contextWindow: 1_000,
          compactedHistory: [],
          compactedThroughTurnIndex: 0,
          compactionCount: 0,
        },
        activeProvider: {
          id: "provider-1",
          type: "openai",
          label: "Provider",
          modelId: "model-1",
          contextWindow: 2_000,
        } as any,
      }),
    ).toMatchObject({
      contextWindow: 1_000,
      activeTokens: 500,
      showContextRing: true,
      contextPct: 0.5,
    });
  });

  it("shows an empty ring when only the provider context window is available", () => {
    expect(
      getContextRingState({
        activeProvider: {
          id: "provider-1",
          type: "openai",
          label: "Provider",
          modelId: "model-1",
          contextWindow: 2_000,
        } as any,
      }),
    ).toMatchObject({
      contextWindow: 2_000,
      activeTokens: 0,
      showContextRing: true,
      contextPct: 0,
    });
  });
});

describe("chat input scrolling", () => {
  it("scrolls pasted overflow content to the bottom", () => {
    const target = {
      clientHeight: 220,
      scrollHeight: 640,
      scrollTop: 0,
      style: { height: "" },
    } as HTMLElement;

    scrollComposerTextareaToBottom(target);

    expect(target.scrollTop).toBe(420);
  });

  it("pushes the caret back above the bottom safe area when it falls under the toolbar", () => {
    const target = {
      clientHeight: 220,
      scrollHeight: 640,
      scrollTop: 120,
      getBoundingClientRect: () => ({ bottom: 300 }),
    } as any;

    const adjusted = scrollComposerCaretIntoSafeView(target, {
      caretRect: { bottom: 286 },
      safeBottomSpace: 72,
    });

    expect(adjusted).toBe(true);
    expect(target.scrollTop).toBe(178);
  });
});

describe("getCurrentLineInfo", () => {
  it("returns the current line text before cursor", () => {
    expect(getCurrentLineInfo("hello world", 5)).toEqual({
      lineStart: 0,
      lineText: "hello",
    });
  });

  it("handles multi-line text with cursor on the second line", () => {
    expect(getCurrentLineInfo("first\nsecond\nthird", 11)).toEqual({
      lineStart: 6,
      lineText: "secon",
    });
  });
});

describe("selection bookmark helper", () => {
  it("does not throw when restoring a selection into an empty text segment with a placeholder br", () => {
    const root = document.createElement("div");
    const segment = document.createElement("span");
    segment.dataset.segmentKind = "text";
    segment.dataset.segmentId = "segment-1";
    segment.appendChild(document.createElement("br"));
    root.appendChild(segment);
    document.body.appendChild(root);

    expect(() =>
      restoreSelectionBookmark(root, {
        start: { segmentId: "segment-1", offset: 0 },
        end: { segmentId: "segment-1", offset: 0 },
      }),
    ).not.toThrow();
  });
});

describe("ChatInput Lexical core behavior", () => {
  it("renders widget context chips and selected skill chips after hydration", async () => {
    const { container } = renderElement(
      createElement(
        ChatInput as any,
        createBaseProps({
          selectedSkillIds: ["release-helper"],
          contextChips: [
            { id: "widget-1", label: "任务清单 · 3 待办", tone: "widget" },
          ],
        }),
      ),
    );

    await flushMicrotasks();
    const editor = getEditor(container);
    expect(editor.textContent).toContain("任务清单 · 3 待办");
    expect(editor.textContent).toContain("release-helper");
  });

  it("shows the translated placeholder outside the text node model", () => {
    const { container } = renderElement(
      createElement(ChatInput as any, createBaseProps({ language: "zh" })),
    );

    expect(getPlaceholder(container)?.textContent).toBe("给 Ora 发消息");
  });

  it("hides placeholder on composition start and restores it when composition ends without committed text", async () => {
    const { container } = renderElement(
      createElement(ChatInput as any, createBaseProps({ language: "zh" })),
    );

    const editor = getEditor(container);
    expect(getPlaceholder(container)?.textContent).toBe("给 Ora 发消息");

    dispatchComposition(editor, "compositionstart", "ni");
    expect(getPlaceholder(container)?.textContent ?? "").toBe("");

    dispatchComposition(editor, "compositionend", "");
    await flushMicrotasks();

    expect(getPlaceholder(container)?.textContent).toBe("给 Ora 发消息");
  });

  it("treats empty editor Backspace/Delete as no-op instead of crashing", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    dispatchEditorKey(editor, "Backspace");
    dispatchEditorKey(editor, "Delete");
    await flushMicrotasks();

    expect(latestState.prompt).toBe("");
    expect(() => getEditor(container)).not.toThrow();
  });

  it("removes the final character with Backspace through Lexical command handling", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "a",
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, 1);
    dispatchEditorKey(editor, "Backspace");
    await flushMicrotasks();

    expect(latestState.prompt).toBe("");
    expect(getPlainPromptFromEditor(editor)).toBe("");
  });

  it("clears an expanded text selection with Backspace", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "clear me",
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, 0, "clear me".length);
    dispatchEditorKey(editor, "Backspace");
    await flushMicrotasks();

    expect(latestState.prompt).toBe("");
  });

  it("replaces the slash query with a skill chip while keeping trailing text", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "/rel world",
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, 4);
    await flushMicrotasks();
    dispatchEditorKey(editor, "Enter");
    await flushMicrotasks();

    expect(latestState.selectedSkillIds).toEqual(["release-helper"]);
    expect(latestState.prompt).toBe(" world");
  });

  it("keeps one trailing space after selecting a skill so continued input appends after the chip", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "/rel",
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, 4);
    await flushMicrotasks();
    dispatchEditorKey(editor, "Enter");
    await flushMicrotasks();

    expect(latestState.selectedSkillIds).toEqual(["release-helper"]);
    expect(latestState.prompt).toBe(" ");

    // jsdom does not reliably preserve Lexical's collapsed selection after
    // structural chip insertion, so we re-anchor to the exported trailing space
    // before simulating the next text insertion.
    setSelectionByTextOffsets(editor, 1);
    insertTextViaLexical(editor, "next");
    await flushMicrotasks();

    expect(latestState.prompt).toBe(" next");
  });

  it("shows the skill picker after typing a slash trigger", async () => {
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "",
        onStateChange: () => {},
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, 0);
    insertTextViaLexical(editor, "/");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(container.textContent).toContain("release-helper");
    expect(getEditor(container)).toBe(editor);
  });

  it("shows the skill picker at the start of the second line", async () => {
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "第一行\n",
        onStateChange: () => {},
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, "第一行\n".length);
    await typeTextViaKeyboard(editor, "/");
    await flushMicrotasks();

    expect(container.textContent).toContain("release-helper");
  });

  it("shows the skill picker after creating a second line with Shift+Enter", async () => {
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "第一行",
        onStateChange: () => {},
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, "第一行".length);
    dispatchEditorKey(editor, "Enter", { shiftKey: true });
    await flushMicrotasks();

    await typeTextViaKeyboard(editor, "/");
    await flushMicrotasks();

    expect(container.textContent).toContain("release-helper");
  });

  it("does not show the skill picker when slash appears after text on the second line", async () => {
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "第一行\n已有文字",
        onStateChange: () => {},
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, "第一行\n已有文字".length);
    insertTextViaLexical(editor, "/");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(container.textContent).not.toContain("release-helper");
  });

  it("shows the skill picker again after a selected skill", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "/rel",
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, 4);
    await flushMicrotasks();
    dispatchEditorKey(editor, "Enter");
    await flushMicrotasks();

    expect(latestState.selectedSkillIds).toEqual(["release-helper"]);
    expect(latestState.prompt).toBe(" ");

    await typeTextViaKeyboard(editor, "/");
    await flushMicrotasks();

    expect(container.textContent).toContain("doc-helper");
  });

  it("does not show the skill picker after a selected skill once text exists before slash", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "/rel",
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, 4);
    await flushMicrotasks();
    dispatchEditorKey(editor, "Enter");
    await flushMicrotasks();

    expect(latestState.selectedSkillIds).toEqual(["release-helper"]);

    insertTextViaLexical(editor, "abc/");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(container.textContent).not.toContain("doc-helper");
  });

  it("replaces only the current slash query on the second line", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "第一行\n/rel world",
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, "第一行\n/rel".length);
    await flushMicrotasks();
    dispatchEditorKey(editor, "Enter");
    await flushMicrotasks();

    expect(latestState.selectedSkillIds).toEqual(["release-helper"]);
    expect(latestState.prompt).toBe("第一行\n world");
  });

  it("removes the left skill chip with Backspace at the chip boundary", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialSkillIds: ["release-helper", "doc-helper"],
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByParagraphChildOffset(editor, 1);
    dispatchEditorKey(editor, "Backspace");
    await flushMicrotasks();

    expect(latestState.selectedSkillIds).toEqual(["doc-helper"]);
    expect(getSkillChips(getEditor(container))).toHaveLength(1);
  });

  it("removes the right skill chip with Delete at the chip boundary", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialSkillIds: ["release-helper", "doc-helper"],
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByParagraphChildOffset(editor, 0);
    dispatchEditorKey(editor, "Delete");
    await flushMicrotasks();

    expect(latestState.selectedSkillIds).toEqual(["doc-helper"]);
    expect(getSkillChips(getEditor(container))).toHaveLength(1);
  });

  it("removes a context chip from the adjacent boundary", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialContextChips: [
          { id: "widget-1", label: "任务清单 · 3 待办", tone: "widget" },
        ],
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByParagraphChildOffset(editor, 1);
    dispatchEditorKey(editor, "Backspace");
    await flushMicrotasks();

    expect(latestState.contextIds).toEqual([]);
    expect(getContextChips(getEditor(container))).toHaveLength(0);
  });

  it("inserts a single newline on Shift+Enter and does not submit", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    let startRunCount = 0;
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "第一行",
        onStartRun: () => {
          startRunCount += 1;
        },
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, "第一行".length);
    dispatchEditorKey(editor, "Enter", { shiftKey: true });
    await flushMicrotasks();

    expect(latestState.prompt).toBe("第一行\n");
    expect(startRunCount).toBe(0);
  });

  it("does not submit on Enter while IME composition is active", async () => {
    let startRunCount = 0;
    const { container } = renderElement(
      createElement(
        ChatInput as any,
        createBaseProps({
          composerPrompt: "已有文本",
          onStartRun: () => {
            startRunCount += 1;
          },
        }),
      ),
    );

    const editor = getEditor(container);
    dispatchComposition(editor, "compositionstart", "ni");
    dispatchEditorKey(editor, "Enter");
    dispatchComposition(editor, "compositionend", "你");
    await flushMicrotasks();

    expect(startRunCount).toBe(0);
  });

  it("suppresses prompt export during IME composition and flushes on composition end", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    setSelectionByTextOffsets(editor, 0);
    dispatchComposition(editor, "compositionstart", "ni");
    insertTextViaLexical(editor, "你");
    await flushMicrotasks();

    expect(latestState.prompt).toBe("");

    dispatchComposition(editor, "compositionend", "你");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(latestState.prompt).toBe("你");
  });

  it("rebuilds the editor state when sessionId changes", async () => {
    const initialProps = createBaseProps({
      sessionId: "session-1",
      composerPrompt: "旧提示",
      selectedSkillIds: ["release-helper", "doc-helper"],
      onPromptChange: () => {},
      onSelectedSkillIdsChange: () => {},
    });
    const { container, rerender } = renderElement(
      createElement(ChatInput as any, initialProps),
    );

    const editor = getEditor(container);
    expect(editor.textContent).toContain("旧提示");

    rerender(
      createElement(
        ChatInput as any,
        createBaseProps({
          sessionId: "session-2",
          composerPrompt: "新提示",
          selectedSkillIds: ["doc-helper"],
          onPromptChange: () => {},
          onSelectedSkillIdsChange: () => {},
        }),
      ),
    );
    await flushMicrotasks();

    const nextEditor = getEditor(container);
    expect(nextEditor.textContent).toContain("新提示");
    expect(nextEditor.textContent).toContain("doc-helper");
    expect(nextEditor.textContent).not.toContain("release-helper");
  });

  it("dispatches undo/redo history commands without corrupting the composer state", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "abc",
        onStateChange: (state) => {
          latestState = state;
        },
      }),
    );

    const editorElement = getEditor(container);
    setSelectionByTextOffsets(editorElement, 3);
    dispatchEditorKey(editorElement, "Backspace");
    await flushMicrotasks();
    await waitFor(850);
    await flushMicrotasks();

    expect(latestState.prompt).toBe("ab");

    act(() => {
      withLexicalEditor(editorElement, (editor) => {
        editor.dispatchCommand(UNDO_COMMAND, undefined);
      });
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(["ab", "abc"]).toContain(latestState.prompt);

    act(() => {
      withLexicalEditor(editorElement, (editor) => {
        editor.dispatchCommand(REDO_COMMAND, undefined);
      });
    });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(["ab", "abc"]).toContain(latestState.prompt);
  });
});

describe("chat input attachments and preview", () => {
  it("adds top spacing for attachment chips when images are present", () => {
    const { container } = renderElement(
      createElement(
        ChatInput as any,
        createBaseProps({
          imageAttachments: [
            {
              dataUrl: "data:image/png;base64,preview",
              mimeType: "image/png",
              name: "image.png",
              sizeBytes: 128,
            },
          ],
        }),
      ),
    );

    const rail = getAttachmentRail(container);
    const editor = getEditor(container);

    expect(rail.className).toContain("top-3");
    expect(editor.className).toContain("pt-14");
    expect(editor.className).toContain("min-h-[140px]");
  });

  it("uses a taller empty-state editor height before the first character is typed", () => {
    const { container } = renderElement(
      createElement(ChatInput as any, createBaseProps()),
    );

    const editor = getEditor(container);
    expect(editor.className).toContain("min-h-[112px]");
    expect(editor.className).toContain("pt-5");
  });

  it("opens an image preview dialog without removing the image when the chip body is clicked", () => {
    const onRemoveImageAttachment = vi.fn();
    const { container } = renderElement(
      createElement(
        ChatInput as any,
        createBaseProps({
          imageAttachments: [
            {
              dataUrl: "data:image/png;base64,preview",
              mimeType: "image/png",
              name: "image.png",
              sizeBytes: 128,
            },
          ],
          onRemoveImageAttachment,
        }),
      ),
    );

    const previewButton = container.querySelector(
      'button[aria-label="Preview image.png"]',
    ) as HTMLButtonElement | null;
    expect(previewButton).toBeTruthy();

    act(() => {
      previewButton!.click();
    });

    const dialog = getImagePreviewDialog();
    expect(onRemoveImageAttachment).not.toHaveBeenCalled();
    expect(dialog).toBeTruthy();
    expect(dialog?.querySelector('img[alt="image.png"]')).toBeTruthy();
  });

  it("removes the image without opening the preview dialog when the chip X is clicked", () => {
    const onRemoveImageAttachment = vi.fn();
    const { container } = renderElement(
      createElement(
        ChatInput as any,
        createBaseProps({
          imageAttachments: [
            {
              dataUrl: "data:image/png;base64,preview",
              mimeType: "image/png",
              name: "image.png",
              sizeBytes: 128,
            },
          ],
          onRemoveImageAttachment,
        }),
      ),
    );

    const removeButton = container.querySelector(
      'button[aria-label="Remove image.png"]',
    ) as HTMLButtonElement | null;
    expect(removeButton).toBeTruthy();

    act(() => {
      removeButton!.click();
    });

    expect(onRemoveImageAttachment).toHaveBeenCalledWith("image.png");
    expect(getImagePreviewDialog()).toBeNull();
  });

  it("keeps pasted image attachment creation working", () => {
    const onAddImageAttachment = vi.fn();
    const OriginalFileReader = globalThis.FileReader;

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload:
        | ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
        | null = null;

      readAsDataURL(_file: File) {
        this.result = "data:image/png;base64,mock-image";
        this.onload?.call(
          this as unknown as FileReader,
          new ProgressEvent("load") as ProgressEvent<FileReader>,
        );
      }
    }

    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;

    try {
      const { container } = renderElement(
        createElement(
          ChatInput as any,
          createBaseProps({
            onAddImageAttachment,
          }),
        ),
      );

      const editor = getEditor(container);
      const file = new File(["image-bytes"], "clipboard.png", {
        type: "image/png",
      });
      const pasteEvent = new Event("paste", {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(pasteEvent, "clipboardData", {
        value: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => file,
            },
          ],
          getData: () => "",
        },
      });

      act(() => {
        editor.dispatchEvent(pasteEvent);
      });

      expect(onAddImageAttachment).toHaveBeenCalledWith({
        dataUrl: "data:image/png;base64,mock-image",
        mimeType: "image/png",
        name: "clipboard.png",
        sizeBytes: file.size,
      });
    } finally {
      globalThis.FileReader = OriginalFileReader;
    }
  });
});

describe("chat input keyboard shortcuts", () => {
  it("toggles taskIntent from implement to plan on Shift+Tab", () => {
    const onTaskIntentChange = vi.fn();
    const { container } = renderElement(
      createElement(
        ChatInput as any,
        createBaseProps({
          taskIntent: "implement",
          onTaskIntentChange,
        }),
      ),
    );

    const editor = getEditor(container);
    dispatchEditorKey(editor, "Tab", { shiftKey: true });

    expect(onTaskIntentChange).toHaveBeenCalledWith("plan");
  });

  it("prevents default focus navigation on Tab without Shift", () => {
    const onTaskIntentChange = vi.fn();
    const { container } = renderElement(
      createElement(
        ChatInput as any,
        createBaseProps({
          onTaskIntentChange,
        }),
      ),
    );
    const editor = getEditor(container);
    dispatchEditorKey(editor, "Tab");
    expect(onTaskIntentChange).not.toHaveBeenCalled();
  });
});
