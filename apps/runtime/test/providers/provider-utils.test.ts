import { describe, expect, it } from "vitest";
import {
  buildModelRequestCacheDiagnostics,
  normalizeMessages,
  openAiSystemMessages,
  splitStableSystemPrompt,
} from "../../src/providers/provider-utils.js";
import { buildAgentPromptContext } from "../../src/harness/prompt-context.js";
import { turnLocalMetadataGuidancePrompt } from "../../src/harness/runtime-prompts.js";

describe("provider cache diagnostics", () => {
  it("appends the current prompt after prior conversation messages", () => {
    expect(normalizeMessages({
      messages: [
        { role: "user", content: "Original user request." },
        { role: "assistant", content: "Prior assistant reply." },
      ],
      prompt: "Current delegated subtask.",
    })).toEqual([
      { role: "user", content: "Original user request." },
      { role: "assistant", content: "Prior assistant reply." },
      { role: "user", content: "Current delegated subtask." },
    ]);
  });

  it("does not duplicate the prompt when it already matches the latest user message", () => {
    expect(normalizeMessages({
      messages: [
        { role: "assistant", content: "Prior assistant reply." },
        { role: "user", content: "Current delegated subtask." },
      ],
      prompt: "Current delegated subtask.",
    })).toEqual([
      { role: "assistant", content: "Prior assistant reply." },
      { role: "user", content: "Current delegated subtask." },
    ]);
  });

  it("splits the stable system prefix from the volatile suffix", () => {
    expect(splitStableSystemPrompt(
      [
        "Stable identity block",
        "Capability contract",
        "Dynamic stage instruction",
      ].join("\n\n"),
      [
        "Stable identity block",
        "Capability contract",
      ].join("\n\n"),
    )).toEqual({
      stablePrefix: "Stable identity block\n\nCapability contract",
      suffix: "Dynamic stage instruction",
    });
  });

  it("keeps volatile derived blocks in the provider's dynamic instruction tail", () => {
    const messages = openAiSystemMessages({
      system: [
        "Stable identity block",
        "Capability contract",
        "Task Mode Block",
        "Model State Block",
      ].join("\n\n"),
      stableSystemPrefix: [
        "Stable identity block",
        "Capability contract",
      ].join("\n\n"),
      derivedContextBlocks: [
        {
          id: "task_mode",
          title: "Task Mode Block",
          content: "Task Mode Block",
          placement: "volatile_suffix",
        },
        {
          id: "model_state",
          title: "Model State Block",
          content: "Model State Block",
          placement: "volatile_suffix",
        },
      ],
      stablePrefixRole: "developer",
    });

    expect(messages).toEqual([
      {
        role: "developer",
        content: "Stable identity block\n\nCapability contract",
        source: "stable_prefix",
      },
      {
        role: "system",
        content: "Task Mode Block\n\nModel State Block",
        source: "volatile_suffix",
      },
    ]);
  });

  it("rejects volatile derived blocks that leak into the stable prefix", () => {
    expect(() => openAiSystemMessages({
      system: [
        "Stable identity block",
        "Capability contract",
        "Task Mode Block",
      ].join("\n\n"),
      stableSystemPrefix: [
        "Stable identity block",
        "Capability contract",
        "Task Mode Block",
      ].join("\n\n"),
      derivedContextBlocks: [
        {
          id: "task_mode",
          title: "Task Mode Block",
          content: "Task Mode Block",
          placement: "volatile_suffix",
        },
      ],
      stablePrefixRole: "developer",
    })).toThrow(/task_mode.*stable system prefix/i);
  });

  it("rejects history-event derived blocks on provider instruction surfaces", () => {
    expect(() => openAiSystemMessages({
      system: [
        "Stable identity block",
        "Capability contract",
        "Compaction event summary",
      ].join("\n\n"),
      stableSystemPrefix: [
        "Stable identity block",
        "Capability contract",
      ].join("\n\n"),
      derivedContextBlocks: [
        {
          id: "compaction_event",
          title: "Compaction Event Block",
          content: "Compaction event summary",
          placement: "history_event",
        },
      ],
      stablePrefixRole: "developer",
    })).toThrow(/compaction_event.*history_event/i);
  });

  it("captures hashes for stable prefix, runtime blocks, volatile suffix, tools, and turn-local metadata", () => {
    const diagnostics = buildModelRequestCacheDiagnostics({
      system: [
        "Stable identity block",
        "Capability contract",
        "Dynamic stage instruction",
      ].join("\n\n"),
      providerCache: {
        stableSystemPrefix: [
          "Stable identity block",
          "Capability contract",
        ].join("\n\n"),
      },
      cacheDiagnosticsContext: {
        derivedContextBlocks: [
          {
            id: "task_mode",
            title: "Task Mode Block",
            content: "Plan mode constraint",
            placement: "volatile_suffix",
          },
          {
            id: "available_skills",
            title: "Available Skills Block",
            content: "<available_skills><skill>deep-research</skill></available_skills>",
            placement: "volatile_suffix",
          },
          {
            id: "activated_skills",
            title: "Activated Skills Block",
            content: "Activated skill snippet",
            placement: "volatile_suffix",
          },
          {
            id: "model_state",
            title: "Model State Block",
            content: "Current runtime model state:\n- Model: openai/gpt-5.2",
            placement: "volatile_suffix",
          },
          {
            id: "compression_state",
            title: "Compression State Block",
            content: "Current session compression state:\n- Compaction count: 1",
            placement: "volatile_suffix",
          },
        ],
      },
      tools: [
        {
          id: "file.read",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            "<turn_local_metadata>",
            "Current local date: 2026-05-09",
            "</turn_local_metadata>",
            "Say hello.",
          ].join("\n"),
        },
      ],
    });

    expect(diagnostics.stableSystemPrefixHash).toBeDefined();
    expect(diagnostics.stableSystemPrefixChars).toBeGreaterThan(0);
    expect(diagnostics.volatileSystemSuffixHash).toBeDefined();
    expect(diagnostics.volatileSystemSuffixChars).toBeGreaterThan(0);
    expect(diagnostics.derivedContextBlocksHash).toBeDefined();
    expect(diagnostics.derivedContextBlocksChars).toBeGreaterThan(0);
    expect(diagnostics.derivedContextBlockHashes.task_mode).toBeDefined();
    expect(diagnostics.derivedContextBlockChars.task_mode).toBeGreaterThan(0);
    expect(diagnostics.derivedContextBlockHashes.available_skills).toBeDefined();
    expect(diagnostics.derivedContextBlockChars.available_skills).toBeGreaterThan(0);
    expect(diagnostics.derivedContextBlockHashes.activated_skills).toBeDefined();
    expect(diagnostics.derivedContextBlockChars.activated_skills).toBeGreaterThan(0);
    expect(diagnostics.derivedContextBlockHashes.model_state).toBeDefined();
    expect(diagnostics.derivedContextBlockChars.model_state).toBeGreaterThan(0);
    expect(diagnostics.derivedContextBlockHashes.compression_state).toBeDefined();
    expect(diagnostics.derivedContextBlockChars.compression_state).toBeGreaterThan(0);
    expect(diagnostics.toolsHash).toBeDefined();
    expect(diagnostics.latestTurnMetadataHash).toBeDefined();
    expect(diagnostics.latestTurnMetadataChars).toBeGreaterThan(0);
  });

  it("keeps the stable prefix hash fixed across derived-context-block mutations", () => {
    const buildDiagnostics = (params: {
      taskIntentContext?: string;
      modelStateContext?: string;
      availableSkills?: Array<{
        id: string;
        name: string;
        description: string;
        path: string;
      }>;
      skillSnippets?: string[];
      compressionStateContext?: string;
    }) => {
      const context = buildAgentPromptContext({
        agentId: "researcher",
        stageSystem: "You are the researcher.",
        turnLocalMetadataGuidance: turnLocalMetadataGuidancePrompt(),
        taskIntentContext: params.taskIntentContext,
        modelStateContext: params.modelStateContext,
        availableSkills: params.availableSkills?.map((skill) => ({
          ...skill,
          category: "public",
          enabled: true,
          editable: true,
          allowedPatterns: [],
          tags: [],
        })),
        skillSnippets: params.skillSnippets,
        compressionStateContext: params.compressionStateContext,
      });
      return buildModelRequestCacheDiagnostics({
        system: context.system,
        providerCache: {
          stableSystemPrefix: context.stablePrefix,
        },
        cacheDiagnosticsContext: context.cacheDiagnosticsContext,
      });
    };

    const baseline = buildDiagnostics({
      taskIntentContext: "Plan mode constraint",
      modelStateContext: "Current runtime model state:\n- Model: openai/gpt-5.2",
      availableSkills: [{
        id: "deep-research",
        name: "deep-research",
        description: "Research workflow.",
        path: "skills/deep-research/SKILL.md",
      }],
      skillSnippets: ["Skill instructions here."],
      compressionStateContext: "Current session compression state:\n- Compaction count: 1",
    });
    const matrix = [
      {
        label: "task mode",
        next: buildDiagnostics({
          taskIntentContext: "Implement mode constraint",
          modelStateContext: "Current runtime model state:\n- Model: openai/gpt-5.2",
          availableSkills: [{
            id: "deep-research",
            name: "deep-research",
            description: "Research workflow.",
            path: "skills/deep-research/SKILL.md",
          }],
          skillSnippets: ["Skill instructions here."],
          compressionStateContext: "Current session compression state:\n- Compaction count: 1",
        }),
        changedBlockId: "task_mode",
      },
      {
        label: "model state",
        next: buildDiagnostics({
          taskIntentContext: "Plan mode constraint",
          modelStateContext: "Current runtime model state:\n- Model: anthropic/claude-sonnet-4.5",
          availableSkills: [{
            id: "deep-research",
            name: "deep-research",
            description: "Research workflow.",
            path: "skills/deep-research/SKILL.md",
          }],
          skillSnippets: ["Skill instructions here."],
          compressionStateContext: "Current session compression state:\n- Compaction count: 1",
        }),
        changedBlockId: "model_state",
      },
      {
        label: "available skills",
        next: buildDiagnostics({
          taskIntentContext: "Plan mode constraint",
          modelStateContext: "Current runtime model state:\n- Model: openai/gpt-5.2",
          availableSkills: [{
            id: "code-review",
            name: "code-review",
            description: "Review workflow.",
            path: "skills/code-review/SKILL.md",
          }],
          skillSnippets: ["Skill instructions here."],
          compressionStateContext: "Current session compression state:\n- Compaction count: 1",
        }),
        changedBlockId: "available_skills",
      },
      {
        label: "activated skills",
        next: buildDiagnostics({
          taskIntentContext: "Plan mode constraint",
          modelStateContext: "Current runtime model state:\n- Model: openai/gpt-5.2",
          availableSkills: [{
            id: "deep-research",
            name: "deep-research",
            description: "Research workflow.",
            path: "skills/deep-research/SKILL.md",
          }],
          skillSnippets: ["Different skill instructions."],
          compressionStateContext: "Current session compression state:\n- Compaction count: 1",
        }),
        changedBlockId: "activated_skills",
      },
      {
        label: "compression state",
        next: buildDiagnostics({
          taskIntentContext: "Plan mode constraint",
          modelStateContext: "Current runtime model state:\n- Model: openai/gpt-5.2",
          availableSkills: [{
            id: "deep-research",
            name: "deep-research",
            description: "Research workflow.",
            path: "skills/deep-research/SKILL.md",
          }],
          skillSnippets: ["Skill instructions here."],
          compressionStateContext: "Current session compression state:\n- Compaction count: 2",
        }),
        changedBlockId: "compression_state",
      },
    ];

    for (const entry of matrix) {
      expect(entry.next.stableSystemPrefixHash, entry.label).toBe(baseline.stableSystemPrefixHash);
      expect(entry.next.derivedContextBlockHashes[entry.changedBlockId], entry.label).not.toBe(
        baseline.derivedContextBlockHashes[entry.changedBlockId],
      );
    }
  });

  it("keeps the current-turn metadata hash when later synthetic user messages are appended", () => {
    const diagnostics = buildModelRequestCacheDiagnostics({
      messages: [
        {
          role: "user",
          content: [
            "<turn_local_metadata>",
            "Current local date: 2026-05-09",
            "</turn_local_metadata>",
            "Implement the accepted plan.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "The user declined the previous plan from this same run.",
            "Revise the plan instead of implementing it.",
          ].join("\n"),
        },
        {
          role: "assistant",
          content: "Working through the runtime state.",
        },
      ],
    });

    expect(diagnostics.latestTurnMetadataHash).toBeDefined();
    expect(diagnostics.latestTurnMetadataChars).toBeGreaterThan(0);
  });

  it("does not reuse a previous-turn metadata block when the current turn has none", () => {
    const diagnostics = buildModelRequestCacheDiagnostics({
      messages: [
        {
          role: "user",
          content: [
            "<turn_local_metadata>",
            "Current local date: 2026-05-08",
            "</turn_local_metadata>",
            "Yesterday's request.",
          ].join("\n"),
        },
        {
          role: "assistant",
          content: "Handled.",
        },
        {
          role: "user",
          content: "Fresh request without metadata.",
        },
      ],
    });

    expect(diagnostics.latestTurnMetadataHash).toBeUndefined();
    expect(diagnostics.latestTurnMetadataChars).toBe(0);
  });

  it("preserves the stable prefix hash across append-only session history growth", () => {
    const system = [
      "Stable identity block",
      "Capability contract",
      "Dynamic stage instruction",
    ].join("\n\n");
    const stableSystemPrefix = [
      "Stable identity block",
      "Capability contract",
    ].join("\n\n");

    const initial = buildModelRequestCacheDiagnostics({
      system,
      providerCache: { stableSystemPrefix },
      messages: [{ role: "user", content: "First request." }],
    });
    const followUp = buildModelRequestCacheDiagnostics({
      system,
      providerCache: { stableSystemPrefix },
      messages: [
        { role: "user", content: "First request." },
        { role: "assistant", content: "First answer." },
        { role: "user", content: "Follow-up request." },
      ],
    });

    expect(followUp.stableSystemPrefixHash).toBe(initial.stableSystemPrefixHash);
    expect(followUp.volatileSystemSuffixHash).toBe(initial.volatileSystemSuffixHash);
  });
});
