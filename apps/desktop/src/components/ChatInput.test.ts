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
import { afterEach, describe, expect, it } from "vitest";
import {
  ChatInput,
  getComposerTrayVisibility,
  getContextRingState,
  getCurrentLineInfo,
  scrollComposerTextareaToBottom,
} from "./ChatInput";

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
    contentWidthClassName: undefined,
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

function dispatchComposition(editor: HTMLElement, type: "compositionstart" | "compositionend", data = "") {
  act(() => {
    editor.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
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
      scrollHeight: 640,
      scrollTop: 0,
      style: { height: "" },
    } as HTMLElement;

    scrollComposerTextareaToBottom(target);

    expect(target.scrollTop).toBe(640);
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
});
