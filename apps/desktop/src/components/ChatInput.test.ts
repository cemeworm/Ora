// @vitest-environment jsdom

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

function sanitizeText(value: string | null | undefined) {
  return (value ?? "").replaceAll("\u200b", "");
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

function getTextSegments(editor: HTMLElement) {
  return Array.from(
    editor.querySelectorAll<HTMLElement>('[data-segment-kind="text"]'),
  );
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

function setCaret(textSegment: HTMLElement, offset: number) {
  const textNode = textSegment.firstChild ?? textSegment;
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function setSelectionRange(
  textSegment: HTMLElement,
  startOffset: number,
  endOffset: number,
) {
  const textNode = textSegment.firstChild ?? textSegment;
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(textNode, startOffset);
  range.setEnd(textNode, endOffset);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function flushSelection(editor: HTMLElement) {
  act(() => {
    editor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

function dispatchEditorKey(editor: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...init }));
  });
}

function dispatchEditorInput(editor: HTMLElement) {
  act(() => {
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  });
}

function dispatchEditorInputWithType(
  editor: HTMLElement,
  inputType: string,
  data: string | null = null,
) {
  act(() => {
    editor.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType, data }),
    );
  });
}

function dispatchBeforeInput(
  editor: HTMLElement,
  inputType: string,
  data: string | null = null,
) {
  act(() => {
    editor.dispatchEvent(
      new InputEvent("beforeinput", { bubbles: true, inputType, data }),
    );
  });
}

function dispatchComposition(editor: HTMLElement, type: "compositionstart" | "compositionend", data = "") {
  act(() => {
    editor.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
  });
}

function insertTextAtCurrentSelection(editor: HTMLElement, text: string) {
  act(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      throw new Error("Expected an active selection before inserting text");
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
    );
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
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
  onStateChange,
}: {
  sessionId?: string;
  initialPrompt?: string;
  initialSkillIds?: string[];
  initialContextChips?: Array<{ id: string; label: string; tone?: "widget" }>;
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

  it("focuses the editor when the plan decision tray closes and the composer returns", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    try {
      const { container, rerender } = renderElement(
        createElement(
          ChatInput as any,
          createBaseProps({
            planDecisionPending: true,
            onConfirmPlanDecision: () => {},
            onDeclinePlanDecision: () => {},
          }),
        ),
      );

      expect(
        container.querySelector('[data-testid="chat-input-editor"]'),
      ).toBeNull();

      rerender(
        createElement(
          ChatInput as any,
          createBaseProps({
            planDecisionPending: false,
            onConfirmPlanDecision: () => {},
            onDeclinePlanDecision: () => {},
          }),
        ),
      );

      await flushMicrotasks();

      const editor = getEditor(container);
      expect(document.activeElement).toBe(editor);
    } finally {
      requestAnimationFrameSpy.mockRestore();
    }
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

  it("infers a ring window for saved DeepSeek v4 providers without explicit context metadata", () => {
    expect(
      getContextRingState({
        activeProvider: {
          id: "deepseek",
          type: "openai_compatible",
          label: "DeepSeek",
          modelId: "deepseek-v4-pro",
          baseUrl: "https://api.deepseek.com",
        } as any,
      }),
    ).toMatchObject({
      contextWindow: 1_048_576,
      activeTokens: 0,
      showContextRing: true,
      contextPct: 0,
    });
  });

  it("still prefers explicit context metadata over inferred provider defaults", () => {
    expect(
      getContextRingState({
        activeProvider: {
          id: "deepseek",
          type: "openai_compatible",
          label: "DeepSeek",
          modelId: "deepseek-v4-pro",
          baseUrl: "https://api.deepseek.com",
          contextWindow: 128_000,
        } as any,
      }).contextWindow,
    ).toBe(128_000);
  });

  it("does not show a ring without any context window", () => {
    expect(
      getContextRingState({
        activeProvider: {
          id: "provider-1",
          type: "openai",
          label: "Provider",
          modelId: "model-1",
        } as any,
      }),
    ).toMatchObject({
      contextWindow: undefined,
      activeTokens: 0,
      showContextRing: false,
      contextPct: 0,
    });
  });

  it("clamps the context percentage at full usage", () => {
    expect(
      getContextRingState({
        contextState: {
          activeTokenUsage: {
            inputTokens: 1_200,
            outputTokens: 100,
            totalTokens: 1_300,
            source: "estimate",
          },
          contextWindow: 1_000,
          compactedHistory: [],
          compactedThroughTurnIndex: 0,
          compactionCount: 0,
        },
      }).contextPct,
    ).toBe(1);
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
  it("returns empty line at the start of text", () => {
    expect(getCurrentLineInfo("hello", 0)).toEqual({
      lineStart: 0,
      lineText: "",
    });
  });

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

  it("returns empty lineText when cursor is right after a newline", () => {
    expect(getCurrentLineInfo("first\n", 6)).toEqual({
      lineStart: 6,
      lineText: "",
    });
  });

  it("handles slash prefix for skill triggering", () => {
    expect(getCurrentLineInfo("/commit", 7)).toEqual({
      lineStart: 0,
      lineText: "/commit",
    });
  });

  it("returns empty when text is empty", () => {
    expect(getCurrentLineInfo("", 0)).toEqual({
      lineStart: 0,
      lineText: "",
    });
  });
});

describe("ChatInput content editable chips", () => {
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

    const selection = window.getSelection();
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).startContainer).toBe(segment);
    expect(selection?.getRangeAt(0).startOffset).toBe(0);
  });

  it("renders widget context chips and selected skill chips inside the editor flow", () => {
    const html = renderToStaticMarkup(
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

    expect(html).toContain("任务清单 · 3 待办");
    expect(html).toContain("release-helper");
    expect(html).toContain('contenteditable="true"');
  });

  it("translates the empty composer placeholder for Chinese", () => {
    const { container } = renderElement(
      createElement(ChatInput as any, createBaseProps({ language: "zh" })),
    );

    const editor = getEditor(container);
    const trailingTextSegment = getTextSegments(editor).at(-1);
    expect(trailingTextSegment?.getAttribute("data-placeholder")).toBe(
      "给 Ora 发消息",
    );
  });

  it("hides the placeholder as soon as IME composition starts", () => {
    const { container } = renderElement(
      createElement(ChatInput as any, createBaseProps({ language: "zh" })),
    );

    const editor = getEditor(container);
    const textSegment = getTextSegments(editor)[0];
    expect(textSegment?.getAttribute("data-placeholder")).toBe("给 Ora 发消息");

    dispatchComposition(editor, "compositionstart", "ni");

    const refreshedTextSegment = getTextSegments(getEditor(container))[0];
    expect(refreshedTextSegment?.getAttribute("data-placeholder")).toBeNull();
  });

  it("restores the placeholder when composition ends with no committed text", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    );
    const { container } = renderElement(
      createElement(ChatInput as any, createBaseProps({ language: "zh" })),
    );

    const editor = getEditor(container);
    dispatchComposition(editor, "compositionstart", "ni");
    act(() => {
      getTextSegments(editor)[0]!.textContent = "";
    });
    dispatchEditorInput(editor);
    dispatchComposition(editor, "compositionend", "");
    await flushMicrotasks();

    const refreshedTextSegment = getTextSegments(getEditor(container)).at(-1);
    expect(refreshedTextSegment?.getAttribute("data-placeholder")).toBe(
      "给 Ora 发消息",
    );
  });

  it("hides the placeholder on the first keydown before prompt state is committed", () => {
    const { container } = renderElement(
      createElement(ChatInput as any, createBaseProps({ language: "zh" })),
    );

    const editor = getEditor(container);
    dispatchEditorKey(editor, "d");

    const refreshedTextSegment = getTextSegments(getEditor(container))[0];
    expect(refreshedTextSegment?.getAttribute("data-placeholder")).toBeNull();
  });

  it("deletes the left chip with Backspace when the caret is between two chips", () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialSkillIds: ["release-helper", "doc-helper"],
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    const betweenChipText = getTextSegments(editor)[1];
    setCaret(betweenChipText, 0);
    flushSelection(editor);
    dispatchEditorKey(editor, "Backspace");

    expect(latestState.selectedSkillIds).toEqual(["doc-helper"]);
    expect(getSkillChips(editor)).toHaveLength(1);
    expect(editor.textContent).not.toContain("release-helper");
  });

  it("deletes the right chip with Delete when the caret is between two chips", () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialSkillIds: ["release-helper", "doc-helper"],
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    const betweenChipText = getTextSegments(editor)[1];
    setCaret(betweenChipText, 0);
    flushSelection(editor);
    dispatchEditorKey(editor, "Delete");

    expect(latestState.selectedSkillIds).toEqual(["release-helper"]);
    expect(getSkillChips(editor)).toHaveLength(1);
    expect(editor.textContent).not.toContain("doc-helper");
  });

  it("serializes text inserted before, between, and after chips back into composerPrompt", () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialSkillIds: ["release-helper", "doc-helper"],
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);

    let textSegments = getTextSegments(editor);
    textSegments[0]!.textContent = "前";
    dispatchEditorInput(editor);

    textSegments = getTextSegments(editor);
    textSegments[1]!.textContent = "中";
    dispatchEditorInput(editor);

    textSegments = getTextSegments(editor);
    textSegments[2]!.textContent = "后";
    dispatchEditorInput(editor);

    expect(latestState.prompt).toBe("前中后");
    expect(
      getTextSegments(editor).map((segment) => sanitizeText(segment.textContent)).join(""),
    ).toBe("前中后");
  });

  it("keeps appending text in the trailing segment after a context chip and skill chip", () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialSkillIds: ["release-helper"],
        initialContextChips: [
          { id: "widget-1", label: "任务清单 · 3 待办", tone: "widget" },
        ],
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);

    let textSegments = getTextSegments(editor);
    textSegments[1]!.textContent = "middle";
    dispatchEditorInput(editor);

    textSegments = getTextSegments(editor);
    const trailingText = textSegments[2]!;
    setCaret(trailingText, 0);
    flushSelection(editor);

    insertTextAtCurrentSelection(editor, "a");
    insertTextAtCurrentSelection(editor, "b");

    const nextTextSegments = getTextSegments(editor).map((segment) =>
      sanitizeText(segment.textContent),
    );
    expect(nextTextSegments).toEqual(["", "middle", "ab"]);
    expect(latestState.prompt).toBe("middleab");
  });

  it.each([
    {
      name: "an empty text node",
      applyEmptyDom(textSegment: HTMLElement, _editor: HTMLElement) {
        textSegment.textContent = "";
        setCaret(textSegment, 0);
      },
    },
    {
      name: "a placeholder br inside the text segment",
      applyEmptyDom(textSegment: HTMLElement, _editor: HTMLElement) {
        textSegment.replaceChildren(document.createElement("br"));
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(textSegment, 0);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      },
    },
  ])(
    "stays stable when parsing an emptied text segment left as $name",
    ({ applyEmptyDom }) => {
      let latestState: HarnessState = {
        prompt: "",
        selectedSkillIds: [],
        contextIds: [],
      };
      const { container } = renderElement(
        createElement(ChatInputHarness, {
          initialPrompt: "ab",
          onStateChange: (state: HarnessState) => {
            latestState = state;
          },
        }),
      );

      const editor = getEditor(container);
      const originalTextSegment = getTextSegments(editor)[0]!;
      originalTextSegment.textContent = "a";
      setCaret(originalTextSegment, 1);
      dispatchEditorInputWithType(editor, "deleteContentBackward");

      expect(latestState.prompt).toBe("a");

      const nextTextSegment = getTextSegments(editor)[0]!;
      applyEmptyDom(nextTextSegment, editor);
      flushSelection(editor);
      dispatchEditorInputWithType(editor, "deleteContentBackward");

      expect(() => getEditor(container)).not.toThrow();
      expect(latestState.prompt).toBe("");
      expect(
        getTextSegments(getEditor(container)).map((segment) =>
          sanitizeText(segment.textContent),
        ),
      ).toEqual([""]);
    },
  );

  it("removes the final character with Backspace without letting the browser collapse the editor DOM", () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "a",
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    const textSegment = getTextSegments(editor)[0]!;
    setCaret(textSegment, 1);
    flushSelection(editor);
    dispatchEditorKey(editor, "Backspace");

    expect(latestState.prompt).toBe("");
    expect(
      getTextSegments(getEditor(container)).map((segment) =>
        sanitizeText(segment.textContent),
      ),
    ).toEqual([""]);
  });

  it("clears a full text selection with Backspace without crashing", () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "clear me",
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    const textSegment = getTextSegments(editor)[0]!;
    setSelectionRange(textSegment, 0, "clear me".length);
    flushSelection(editor);
    dispatchEditorKey(editor, "Backspace");

    expect(latestState.prompt).toBe("");
    expect(
      getTextSegments(getEditor(container)).map((segment) =>
        sanitizeText(segment.textContent),
      ),
    ).toEqual([""]);
  });

  it("replaces the current slash query with a skill chip without disturbing trailing text", () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        initialPrompt: "/rel world",
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    const textSegment = getTextSegments(editor)[0];
    setCaret(textSegment, 4);
    flushSelection(editor);
    dispatchEditorKey(editor, "Enter");

    expect(latestState.selectedSkillIds).toEqual(["release-helper"]);
    expect(latestState.prompt).toBe(" world");
    expect(editor.textContent).toContain("release-helper");
  });

  it("removes a context chip when Backspace targets it from the adjacent text boundary", () => {
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
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    const trailingText = getTextSegments(editor)[1];
    setCaret(trailingText, 0);
    flushSelection(editor);
    dispatchEditorKey(editor, "Backspace");

    expect(latestState.contextIds).toEqual([]);
    expect(getContextChips(editor)).toHaveLength(0);
  });

  it("rebuilds local mixed segments when sessionId changes", () => {
    const initialProps = createBaseProps({
      sessionId: "session-1",
      selectedSkillIds: ["release-helper", "doc-helper"],
      onPromptChange: () => {},
      onSelectedSkillIdsChange: () => {},
    });
    const { container, rerender } = renderElement(
      createElement(ChatInput as any, initialProps),
    );

    const editor = getEditor(container);
    const middleText = getTextSegments(editor)[1];
    middleText.textContent = "旧";
    dispatchEditorInput(editor);

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

    const nextEditor = getEditor(container);
    expect(
      getTextSegments(nextEditor)
        .map((segment) => sanitizeText(segment.textContent))
        .join(""),
    ).toBe("新提示");
    expect(getSkillChips(nextEditor)).toHaveLength(1);
    expect(nextEditor.textContent).not.toContain("旧");
    expect(nextEditor.textContent).toContain("doc-helper");
  });

  it("delays prompt commits until IME composition ends", async () => {
    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    const textSegment = getTextSegments(editor)[0];
    setCaret(textSegment, 0);
    flushSelection(editor);

    dispatchComposition(editor, "compositionstart", "ni");
    textSegment.textContent = "你";
    dispatchEditorInput(editor);
    expect(latestState.prompt).toBe("");

    dispatchComposition(editor, "compositionend", "你");
    await flushMicrotasks();

    expect(latestState.prompt).toBe("你");
  });

  it("keeps the last line above the toolbar safe area after pasted content grows", async () => {
    const originalGetClientRects = Range.prototype.getClientRects;
    const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getClientRects = vi.fn(() => [{ bottom: 286 }]) as any;
    Range.prototype.getBoundingClientRect = vi
      .fn()
      .mockReturnValueOnce({ bottom: 286, height: 20, width: 40 })
      .mockReturnValue({ bottom: 300, height: 220, width: 500 }) as any;

    let latestState: HarnessState = {
      prompt: "",
      selectedSkillIds: [],
      contextIds: [],
    };
    const { container } = renderElement(
      createElement(ChatInputHarness, {
        onStateChange: (state: HarnessState) => {
          latestState = state;
        },
      }),
    );

    const editor = getEditor(container);
    Object.defineProperty(editor, "clientHeight", {
      configurable: true,
      value: 220,
    });
    Object.defineProperty(editor, "scrollHeight", {
      configurable: true,
      value: 640,
    });
    editor.scrollTop = 0;

    const textSegment = getTextSegments(editor)[0];
    setCaret(textSegment, 0);
    flushSelection(editor);

    act(() => {
      textSegment.textContent = "第一行\n第二行\n第三行";
    });
    dispatchBeforeInput(editor, "insertFromPaste", "第一行\n第二行\n第三行");
    dispatchEditorInputWithType(editor, "insertFromPaste", "第一行\n第二行\n第三行");
    await flushMicrotasks();

    const refreshedEditor = getEditor(container);
    const trailingTextSegment = getTextSegments(refreshedEditor).at(-1)!;
    setCaret(
      trailingTextSegment,
      sanitizeText(trailingTextSegment.textContent).length,
    );
    flushSelection(refreshedEditor);

    dispatchEditorKey(refreshedEditor, "Enter", { shiftKey: true });
    await flushMicrotasks();

    expect(latestState.prompt).toBe("第一行\n第二行\n第三行\n");
    expect(getEditor(container).scrollTop).toBeGreaterThan(0);

    Range.prototype.getClientRects = originalGetClientRects;
    Range.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("does not submit on Enter while IME composition is active", () => {
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

    expect(startRunCount).toBe(0);
  });

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
    expect(editor.className).toContain("min-h-[124px]");
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
    expect(container.contains(dialog)).toBe(false);
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

  it("closes the preview dialog on Escape, close button, and backdrop click", () => {
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

    const previewButton = container.querySelector(
      'button[aria-label="Preview image.png"]',
    ) as HTMLButtonElement | null;
    expect(previewButton).toBeTruthy();

    act(() => {
      previewButton!.click();
    });
    expect(getImagePreviewDialog()).toBeTruthy();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(getImagePreviewDialog()).toBeNull();

    act(() => {
      previewButton!.click();
    });

    let dialog = getImagePreviewDialog();
    expect(dialog).toBeTruthy();

    const closeButton = document.body.querySelector(
      'button[aria-label="Close image preview"]',
    ) as HTMLButtonElement | null;
    expect(closeButton).toBeTruthy();

    act(() => {
      closeButton!.click();
    });
    expect(getImagePreviewDialog()).toBeNull();

    act(() => {
      previewButton!.click();
    });

    dialog = getImagePreviewDialog();
    expect(dialog).toBeTruthy();

    act(() => {
      dialog!.parentElement?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
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

  it("toggles taskIntent from plan to implement on Shift+Tab", () => {
    const onTaskIntentChange = vi.fn();
    const { container } = renderElement(
      createElement(
        ChatInput as any,
        createBaseProps({
          taskIntent: "plan",
          onTaskIntentChange,
        }),
      ),
    );

    const editor = getEditor(container);
    dispatchEditorKey(editor, "Tab", { shiftKey: true });

    expect(onTaskIntentChange).toHaveBeenCalledWith("implement");
  });

  it("switches from chat to plan on Shift+Tab", () => {
    const onTaskIntentChange = vi.fn();
    const { container } = renderElement(
      createElement(
        ChatInput as any,
        createBaseProps({
          taskIntent: "chat",
          onTaskIntentChange,
        }),
      ),
    );

    const editor = getEditor(container);
    dispatchEditorKey(editor, "Tab", { shiftKey: true });

    expect(onTaskIntentChange).toHaveBeenCalledWith("plan");
  });
});
