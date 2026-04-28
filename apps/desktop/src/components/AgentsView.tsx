import { ArrowLeft, Bot, MessageSquarePlus, Pencil, Plus, RefreshCcw, Send, Sparkles, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { autoLayoutModeSpec, createModeSpecFromPattern, type CoordinationPattern } from "@ora/shared";
import { useWorkbench } from "../lib/state";
import type { OraAgentCatalogResult, OraCustomAgentGenerateDraftResult, OraCustomAgentSummary, OraModeCreateParams, RuntimeClient } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

type AgentEditorMode = "gallery" | "create" | "edit" | "edit-system" | "team";
type AgentGalleryTab = "built-in" | "custom";

interface AgentDraft {
  name: string;
  description: string;
  model: string;
  toolGroupsText: string;
  toolIds: string[];
  skillIds: string[];
  soul: string;
}

interface AgentDraftChatMessage {
  role: "user" | "assistant";
  content: string;
}

const EMPTY_DRAFT: AgentDraft = {
  name: "",
  description: "",
  model: "",
  toolGroupsText: "",
  toolIds: [],
  skillIds: [],
  soul: "",
};

const TEAM_FAMILIES: CoordinationPattern[] = [
  "generator_verifier",
  "agent_teams",
  "message_bus",
  "shared_state",
];
const DEFAULT_AGENT_MODEL_REF = "local/smoke-model";

function explicitAgentModelRef(modelRef: string | undefined): string | undefined {
  return modelRef === DEFAULT_AGENT_MODEL_REF ? undefined : modelRef;
}

export function AgentsView({
  runtimeClient,
  selectedCustomAgentId,
  onStartChat,
  onClearSelectedCustomAgent,
}: {
  runtimeClient: RuntimeClient;
  selectedCustomAgentId?: string;
  onStartChat: (agentId: string) => Promise<void> | void;
  onClearSelectedCustomAgent: () => void;
}) {
  const { state, dispatch } = useWorkbench();
  const [agents, setAgents] = useState<OraCustomAgentSummary[]>([]);
  const [catalog, setCatalog] = useState<OraAgentCatalogResult>({ systemAgents: [], customAgents: [] });
  const [activeTab, setActiveTab] = useState<AgentGalleryTab>("built-in");
  const [mode, setMode] = useState<AgentEditorMode>("gallery");
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const [draftChat, setDraftChat] = useState<AgentDraftChatMessage[]>([{
    role: "assistant",
    content: "告诉我你想创建什么样的智能体：它负责什么任务、输出要长什么样、需要哪些工具。我会生成一版可确认的草稿。",
  }]);
  const [draftInput, setDraftInput] = useState("");
  const [draftIssues, setDraftIssues] = useState<OraCustomAgentGenerateDraftResult["issues"]>([]);
  const [teamLabel, setTeamLabel] = useState("Agent Team");
  const [teamFamily, setTeamFamily] = useState<CoordinationPattern>("agent_teams");
  const [teamAssignments, setTeamAssignments] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<string | undefined>();
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const selectableTools = useMemo(
    () => (state.toolRegistry?.tools ?? []).filter((tool) => tool.implemented !== false),
    [state.toolRegistry],
  );
  const selectableSkills = useMemo(
    () => (state.skillRegistry?.skills ?? []).filter((skill) => skill.enabled),
    [state.skillRegistry],
  );

  async function loadAgents() {
    setBusy("refresh");
    try {
      const nextCatalog = await runtimeClient.agentCatalog();
      setCatalog(nextCatalog);
      setAgents(nextCatalog.customAgents);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void loadAgents().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to load custom agents.");
    });
  }, [runtimeClient]);

  function resetEditor(nextMode: AgentEditorMode = "gallery") {
    setMode(nextMode);
    setDraft(EMPTY_DRAFT);
    setDraftChat([{
      role: "assistant",
      content: "告诉我你想创建什么样的智能体：它负责什么任务、输出要长什么样、需要哪些工具。我会生成一版可确认的草稿。",
    }]);
    setDraftInput("");
    setDraftIssues([]);
    setEditingName(undefined);
    setError("");
    if (nextMode === "team") {
      setTeamAssignments({});
      setTeamLabel("Agent Team");
      setTeamFamily("agent_teams");
    }
  }

  async function startEdit(name: string) {
    setBusy(`edit:${name}`);
    setError("");
    try {
      const agent = await runtimeClient.getAgent(name);
      setDraft({
        name: agent.name,
        description: agent.description,
        model: agent.model ?? "",
        toolGroupsText: (agent.toolGroups ?? []).join(", "),
        toolIds: agent.toolIds,
        skillIds: agent.skillIds,
        soul: agent.soul,
      });
      setEditingName(agent.name);
      setMode("edit");
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Editing custom agent ${agent.name}.` });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load custom agent.");
    } finally {
      setBusy("");
    }
  }

  async function generateDraftFromChat() {
    const message = draftInput.trim();
    if (!message) {
      return;
    }

    const provider = state.providerRegistry?.providers.find((entry) => entry.id === state.selectedProviderId);
    const nextChat: AgentDraftChatMessage[] = [...draftChat, { role: "user", content: message }];
    setDraftChat(nextChat);
    setDraftInput("");
    setBusy("draft-generate");
    setError("");
    setDraftIssues([]);

    try {
      const result = await runtimeClient.generateAgentDraft({
        messages: nextChat,
        partialDraft: draftFromEditor(draft),
        providerId: state.selectedProviderId,
        providerConfig: provider,
        modelRef: provider?.modelId ?? "local/smoke-model",
      });
      setDraftChat((current) => [...current, { role: "assistant", content: result.assistantMessage }]);
      setDraftIssues(result.issues ?? []);
      if (result.draft) {
        setDraft(editorDraftFromGenerated(result.draft));
      }
      dispatch({
        type: "SET_COMMAND_FEEDBACK",
        feedback: result.status === "draft_ready"
          ? "Generated a custom agent draft. Review it before creating."
          : "Ora needs a little more detail before creating the agent draft.",
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to generate custom agent draft.");
    } finally {
      setBusy("");
    }
  }

  async function saveAgent() {
    const normalizedName = draft.name.trim().toLowerCase();
    if (!normalizedName) {
      setError(mode === "edit-system" ? "System agent label is required." : "Custom agent name is required.");
      return;
    }

    const toolGroups = parseToolGroups(draft.toolGroupsText);
    setBusy(mode === "create" ? "create" : "save");
    setError("");

    try {
      if (mode === "edit-system") {
        if (!editingName) {
          throw new Error("System agent id is missing.");
        }
        await runtimeClient.updateSystemAgentOverride({
          agentId: editingName,
          label: draft.name.trim(),
          role: draft.description.trim() || undefined,
          modelRef: draft.model.trim() || null,
          toolIds: draft.toolIds.length > 0 ? draft.toolIds : null,
          skillIds: draft.skillIds.length > 0 ? draft.skillIds : null,
          soul: draft.soul,
        });
        dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Updated built-in agent ${editingName}.` });
      } else if (mode === "create") {
        const check = await runtimeClient.checkAgentName(normalizedName);
        if (!check.available) {
          throw new Error(`Custom agent '${check.name}' already exists.`);
        }
        await runtimeClient.createAgent({
          name: normalizedName,
          description: draft.description,
          model: draft.model.trim() || undefined,
          toolGroups,
          toolIds: draft.toolIds,
          skillIds: draft.skillIds,
          soul: draft.soul,
        });
        dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Created custom agent ${normalizedName}.` });
      } else {
        await runtimeClient.updateAgent({
          name: editingName ?? normalizedName,
          description: draft.description,
          model: draft.model.trim() ? draft.model.trim() : null,
          toolGroups: toolGroups.length > 0 ? toolGroups : null,
          toolIds: draft.toolIds,
          skillIds: draft.skillIds,
          soul: draft.soul,
        });
        dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Updated custom agent ${editingName ?? normalizedName}.` });
      }

      await loadAgents();
      resetEditor();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save agent.");
    } finally {
      setBusy("");
    }
  }

  function startEditSystemAgent(agent: OraAgentCatalogResult["systemAgents"][number]) {
    const modelRef = explicitAgentModelRef(agent.modelRef);
    setDraft({
      name: agent.label,
      description: agent.role,
      model: modelRef ?? "",
      toolGroupsText: "",
      toolIds: agent.toolIds,
      skillIds: agent.skillIds,
      soul: agent.soul,
    });
    setEditingName(agent.id);
    setMode("edit-system");
    setError("");
    dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Editing built-in agent ${agent.id}.` });
  }

  async function resetSystemAgent(agentId: string) {
    setBusy(`reset:${agentId}`);
    setError("");
    try {
      await runtimeClient.resetSystemAgentOverride(agentId);
      await loadAgents();
      resetEditor();
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Reset built-in agent ${agentId}.` });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to reset built-in agent.");
    } finally {
      setBusy("");
    }
  }

  async function deleteAgent(name: string) {
    if (!window.confirm(`Delete custom agent '${name}'?`)) {
      return;
    }

    setBusy(`delete:${name}`);
    setError("");
    try {
      await runtimeClient.deleteAgent(name);
      if (selectedCustomAgentId === name) {
        onClearSelectedCustomAgent();
      }
      if (editingName === name) {
        resetEditor();
      }
      await loadAgents();
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Deleted custom agent ${name}.` });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete custom agent.");
    } finally {
      setBusy("");
    }
  }

  async function startChat(name: string) {
    setBusy(`chat:${name}`);
    setError("");
    try {
      await onStartChat(name);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to open chat with the selected agent.");
    } finally {
      setBusy("");
    }
  }

  async function saveTeamMode() {
    const base = createModeSpecFromPattern(teamFamily);
    const modeId = slugifyModeId(teamLabel);
    if (!modeId) {
      setError("Team mode name is required.");
      return;
    }

    setBusy("team-save");
    setError("");
    try {
      const assignedProfiles = base.profiles.map((profile) => {
        const customAgentId = teamAssignments[profile.id];
        const agent = agents.find((item) => item.name === customAgentId);
        return agent
          ? {
              ...profile,
              label: agent.name,
              role: agent.description || profile.role,
              customAgentId,
              toolIds: agent.toolIds,
              skillIds: agent.skillIds,
            }
          : profile;
      });
      const nextMode = autoLayoutModeSpec({
        ...base,
        id: modeId,
        label: teamLabel.trim(),
        summary: `${teamLabel.trim()} composed from Ora custom agents.`,
        description: "Custom multi-agent team composed from saved Ora agents.",
        recommendedUse: base.recommendedUse,
        failureMode: base.failureMode,
        systemPreset: false,
        nodes: base.nodes.map((node) => ({
          ...node,
          config: {
            ...node.config,
            ...(node.ownerAgentId && teamAssignments[node.ownerAgentId]
              ? { customAgentId: teamAssignments[node.ownerAgentId] }
              : {}),
          },
        })),
        profiles: assignedProfiles,
        createdAt: 0,
        updatedAt: 0,
      });
      const { systemPreset: _systemPreset, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = nextMode;
      await runtimeClient.createMode(payload satisfies OraModeCreateParams);
      const nextModes = await runtimeClient.listModes();
      dispatch({ type: "SET_MODES", modes: nextModes });
      dispatch({ type: "SET_MODE", modeId });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Created team mode ${teamLabel.trim()}.` });
      resetEditor();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save team mode.");
    } finally {
      setBusy("");
    }
  }

  const teamBase = useMemo(() => createModeSpecFromPattern(teamFamily), [teamFamily]);
  const teamRoles = useMemo(
    () => teamBase.profiles.filter((profile) =>
      teamBase.nodes.some((node) => node.ownerAgentId === profile.id),
    ),
    [teamBase],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-transparent">
      <div className="border-b border-border bg-sidebar/92 px-6 py-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {mode !== "gallery" && (
              <button
                onClick={() => resetEditor()}
                className="rounded-md border border-bench-200 bg-white p-2 text-bench-700 shadow-sm transition hover:text-bench-900 active:scale-95"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Agents</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void loadAgents()}
              disabled={busy.length > 0}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw size={16} className={cn(busy === "refresh" && "animate-spin")} />
              Refresh
            </button>
            <button
              onClick={() => resetEditor("create")}
              disabled={busy.length > 0}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={16} />
              New agent
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="w-full space-y-6">
          {error && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              {error}
            </section>
          )}

          {mode === "gallery" ? (
            <section className="space-y-4">
              <div className="inline-flex rounded-lg bg-bench-100 p-1">
                {([
                  ["built-in", `Built-in (${catalog.systemAgents.length})`],
                  ["custom", `Custom (${catalog.customAgents.length})`],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "h-9 rounded-md px-3 text-xs font-semibold transition active:scale-95",
                      activeTab === tab ? "bg-white text-bench-900 shadow-xs" : "text-bench-700 hover:text-bench-900",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === "built-in" ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {catalog.systemAgents.map((agent) => (
                    <article key={agent.id} className="rounded-[20px] bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-semibold">{agent.label}</h4>
                            <span className="rounded-full bg-bench-50 px-2 py-0.5 text-[11px] font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                              built-in
                            </span>
                            {agent.overridden && (
                              <span className="rounded-full bg-lime-50 px-2 py-0.5 text-[11px] font-semibold text-bench-900 ring-1 ring-inset ring-lime-200">
                                overridden
                              </span>
                            )}
                          </div>
                          <p className="mt-1 font-mono text-[11px] text-bench-600">{agent.id}</p>
                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-bench-700">{agent.role}</p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2 text-xs text-bench-700">
                        <div>Model: {explicitAgentModelRef(agent.modelRef) ?? "未指定"}</div>
                        <div>Tools: {agent.toolIds.length > 0 ? agent.toolIds.join(", ") : "inherit mode tools"}</div>
                        <div>Skills: {agent.skillIds.length > 0 ? agent.skillIds.join(", ") : "inherit mode skills"}</div>
                        <AgentUsageList usages={agent.usages} />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          onClick={() => startEditSystemAgent(agent)}
                          disabled={busy.length > 0}
                          className="inline-flex h-9 items-center gap-2 rounded-md bg-bench-900 px-3 text-xs font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                        <button
                          onClick={() => void resetSystemAgent(agent.id)}
                          disabled={busy.length > 0 || !agent.overridden}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition hover:bg-bench-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RefreshCcw size={14} />
                          Reset
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : agents.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-bench-200 bg-white px-6 py-12 text-center shadow-pane">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bench-50 text-bench-700 ring-1 ring-inset ring-bench-200">
                    <Bot size={22} />
                  </div>
                  <h4 className="mt-4 text-base font-semibold">No custom agents yet</h4>
                  <p className="mt-2 text-sm leading-6 text-bench-700">
                    Start with a small persona card: name, description, model hint, tool groups, and SOUL instructions.
                  </p>
                  <button
                    onClick={() => resetEditor("create")}
                    className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition"
                  >
                    <Plus size={16} />
                    Create first agent
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {agents.map((agent) => (
                    <article key={agent.name} className="rounded-[20px] bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-semibold">{agent.name}</h4>
                            {selectedCustomAgentId === agent.name && (
                              <span className="rounded-full bg-lime-50 px-2 py-0.5 text-[11px] font-semibold text-bench-900 ring-1 ring-inset ring-lime-200">
                                selected
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-3 text-sm leading-6 text-bench-700">
                            {agent.description || "No description yet."}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2 text-xs text-bench-700">
                        <div>Model: {agent.model ?? "inherit current chat model"}</div>
                        <div>Tools: {agent.toolIds.length > 0 ? agent.toolIds.join(", ") : "inherit mode tools"}</div>
                        <div>Skills: {agent.skillIds.length > 0 ? agent.skillIds.join(", ") : "inherit mode skills"}</div>
                        {agent.toolGroups && agent.toolGroups.length > 0 && (
                          <div>Legacy groups: {agent.toolGroups.join(", ")}</div>
                        )}
                        <AgentUsageList usages={catalog.customAgents.find((item) => item.name === agent.name)?.usages ?? []} />
                        <div>Updated: {formatDate(agent.updatedAt)}</div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          onClick={() => void startChat(agent.name)}
                          disabled={busy.length > 0}
                          className="inline-flex h-9 items-center gap-2 rounded-md bg-bench-900 px-3 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <MessageSquarePlus size={14} />
                          Chat
                        </button>
                        <button
                          onClick={() => void startEdit(agent.name)}
                          disabled={busy.length > 0}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                        <button
                          onClick={() => void deleteAgent(agent.name)}
                          disabled={busy.length > 0}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : mode === "team" ? (
            <section className="rounded-[24px] bg-white p-6 shadow-pane ring-1 ring-inset ring-bench-200">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Create agent team</h3>
                  <p className="mt-1 text-xs text-bench-700">Compose a multi-agent mode from saved custom agents.</p>
                </div>
                <button
                  onClick={() => void saveTeamMode()}
                  disabled={busy.length > 0 || !teamLabel.trim() || agents.length === 0}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save team
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Team Name</span>
                  <input
                    value={teamLabel}
                    onChange={(event) => setTeamLabel(event.target.value)}
                    placeholder="Product Review Team"
                    className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Pattern</span>
                  <select
                    value={teamFamily}
                    onChange={(event) => {
                      setTeamFamily(event.target.value as CoordinationPattern);
                      setTeamAssignments({});
                    }}
                    className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                  >
                    {TEAM_FAMILIES.map((family) => (
                      <option key={family} value={family}>{family.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {teamRoles.map((role) => (
                  <label key={role.id} className="rounded-lg border border-bench-200 bg-bench-50 p-4">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">{role.label}</span>
                    <p className="mt-1 min-h-10 text-sm leading-5 text-bench-700">{role.role}</p>
                    <select
                      value={teamAssignments[role.id] ?? ""}
                      onChange={(event) => setTeamAssignments((current) => ({
                        ...current,
                        [role.id]: event.target.value,
                      }))}
                      className="mt-3 h-10 w-full rounded-md border border-bench-200 bg-white px-3 text-sm outline-none transition focus:border-bench-900"
                    >
                      <option value="">Use default role persona</option>
                      {agents.map((agent) => (
                        <option key={agent.name} value={agent.name}>{agent.name}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          ) : mode === "edit" || mode === "edit-system" ? (
            <section className="rounded-[24px] bg-white p-6 shadow-pane ring-1 ring-inset ring-bench-200">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{mode === "edit-system" ? `Edit built-in ${editingName}` : `Edit ${editingName}`}</h3>
                  <p className="mt-1 text-xs text-bench-700">
                    {mode === "edit-system"
                      ? "Changes are saved as a file-backed global override with `config.yaml` and `SOUL.md`."
                      : "This v1 editor writes `config.yaml` and `SOUL.md` directly into `.ora/agents/&lt;name&gt;`."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {mode === "edit-system" && editingName && (
                    <button
                      onClick={() => void resetSystemAgent(editingName)}
                      disabled={busy.length > 0}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCcw size={16} />
                      Reset
                    </button>
                  )}
                  <button
                    onClick={saveAgent}
                    disabled={busy.length > 0 || !draft.name.trim()}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save changes
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {mode === "edit-system" && (
                  <label className="space-y-1.5">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">System ID</span>
                    <input
                      value={editingName ?? ""}
                      disabled
                      className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </label>
                )}
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">{mode === "edit-system" ? "Label" : "Name"}</span>
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    disabled={mode === "edit"}
                    placeholder={mode === "edit-system" ? "Research Subagent" : "researcher-hk"}
                    className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Model Hint</span>
                  <input
                    value={draft.model}
                    onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                    placeholder="claude-sonnet-4-20250514"
                    className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                  />
                </label>
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Description</span>
                  <textarea
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    rows={3}
                    placeholder="What this agent is for, how it should behave, and what good output looks like."
                    className="w-full rounded-md border border-bench-200 bg-bench-50 px-3 py-2 text-sm outline-none transition focus:border-bench-900"
                  />
                </label>
                {mode !== "edit-system" && (
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Tool Groups</span>
                    <input
                      value={draft.toolGroupsText}
                      onChange={(event) => setDraft((current) => ({ ...current, toolGroupsText: event.target.value }))}
                      placeholder="web, shell, github"
                      className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                    />
                  </label>
                )}
                <AgentCapabilitySelectors
                  draft={draft}
                  tools={selectableTools}
                  skills={selectableSkills}
                  onChange={setDraft}
                />
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">
                    SOUL
                  </span>
                  <textarea
                    value={draft.soul}
                    onChange={(event) => setDraft((current) => ({ ...current, soul: event.target.value }))}
                    rows={14}
                    placeholder={mode === "edit-system" ? "Long-form built-in override instructions written into SOUL.md." : "Long-form persona instructions written into SOUL.md."}
                    className="w-full rounded-md border border-bench-200 bg-bench-50 px-3 py-2 font-mono text-sm outline-none transition focus:border-bench-900"
                  />
                </label>
              </div>
            </section>
          ) : (
            <section className="rounded-[24px] bg-white p-6 shadow-pane ring-1 ring-inset ring-bench-200">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">
                    <Sparkles size={13} />
                    Guided creation
                  </p>
                  <h3 className="mt-2 text-sm font-semibold">Create custom agent</h3>
                  <p className="mt-1 text-xs text-bench-700">
                    Describe the agent in natural language. Ora will generate a draft, then you confirm before anything is written.
                  </p>
                </div>
                <button
                  onClick={saveAgent}
                  disabled={busy.length > 0 || !canConfirmDraft(draft)}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create agent
                </button>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)]">
                <div className="flex min-h-[520px] flex-col rounded-lg border border-bench-200 bg-bench-50">
                  <div className="flex-1 space-y-3 overflow-y-auto p-4">
                    {draftChat.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={cn(
                          "max-w-[92%] rounded-lg px-3 py-2 text-sm leading-6",
                          message.role === "user"
                            ? "ml-auto bg-bench-900 text-white"
                            : "mr-auto bg-white text-bench-900 ring-1 ring-inset ring-bench-200",
                        )}
                      >
                        {message.content}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-bench-200 bg-white p-3">
                    <div className="flex items-end gap-2">
                      <textarea
                        value={draftInput}
                        onChange={(event) => setDraftInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void generateDraftFromChat();
                          }
                        }}
                        rows={3}
                        placeholder="例如：帮我创建一个香港市场研究智能体，输出要带来源、风险和下一步建议。"
                        className="min-h-20 flex-1 resize-none rounded-md border border-bench-200 bg-bench-50 px-3 py-2 text-sm outline-none transition focus:border-bench-900"
                      />
                      <button
                        onClick={() => void generateDraftFromChat()}
                        disabled={busy.length > 0 || !draftInput.trim()}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                        title="Generate draft"
                      >
                        <Send size={15} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {draftIssues.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                      {draftIssues.map((issue) => issue.message).join(" ")}
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Name</span>
                      <input
                        value={draft.name}
                        onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="researcher-hk"
                        className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Model Hint</span>
                      <input
                        value={draft.model}
                        onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                        placeholder={state.providerRegistry?.providers.find((entry) => entry.id === state.selectedProviderId)?.modelId ?? "inherit current chat model"}
                        className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 font-mono text-sm outline-none transition focus:border-bench-900"
                      />
                    </label>
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Description</span>
                      <textarea
                        value={draft.description}
                        onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                        rows={3}
                        placeholder="What this agent is for, how it should behave, and what good output looks like."
                        className="w-full rounded-md border border-bench-200 bg-bench-50 px-3 py-2 text-sm outline-none transition focus:border-bench-900"
                      />
                    </label>
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Tool Groups</span>
                      <input
                        value={draft.toolGroupsText}
                        onChange={(event) => setDraft((current) => ({ ...current, toolGroupsText: event.target.value }))}
                        placeholder="web, shell, github"
                        className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                      />
                    </label>
                    <AgentCapabilitySelectors
                      draft={draft}
                      tools={selectableTools}
                      skills={selectableSkills}
                      onChange={setDraft}
                    />
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">SOUL</span>
                      <textarea
                        value={draft.soul}
                        onChange={(event) => setDraft((current) => ({ ...current, soul: event.target.value }))}
                        rows={14}
                        placeholder="Generated long-form persona instructions will appear here."
                        className="w-full rounded-md border border-bench-200 bg-bench-50 px-3 py-2 font-mono text-sm outline-none transition focus:border-bench-900"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentUsageList({ usages }: { usages: OraAgentCatalogResult["systemAgents"][number]["usages"] }) {
  if (usages.length === 0) {
    return <div>Used by modes: none</div>;
  }
  const preview = usages.slice(0, 3).map((usage) =>
    usage.profileLabel
      ? `${usage.modeLabel} / ${usage.profileLabel}`
      : usage.nodeLabel
        ? `${usage.modeLabel} / ${usage.nodeLabel}`
        : usage.modeLabel,
  );
  return (
    <div>
      Used by modes: {preview.join(", ")}
      {usages.length > preview.length ? ` +${usages.length - preview.length}` : ""}
    </div>
  );
}

function AgentCapabilitySelectors({
  draft,
  tools,
  skills,
  onChange,
}: {
  draft: AgentDraft;
  tools: Array<{ id: string; label: string; category: string; riskLevel: string }>;
  skills: Array<{ id: string; name: string; description: string }>;
  onChange: Dispatch<SetStateAction<AgentDraft>>;
}) {
  return (
    <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
      <CapabilityChecklist
        title="Tools"
        emptyLabel="Inherit mode tools"
        selectedIds={draft.toolIds}
        items={tools.map((tool) => ({
          id: tool.id,
          label: tool.label,
          detail: `${tool.category} · ${tool.riskLevel.replace(/_/g, " ")}`,
        }))}
        onToggle={(toolId) => onChange((current) => ({
          ...current,
          toolIds: toggleId(current.toolIds, toolId),
        }))}
      />
      <CapabilityChecklist
        title="Skills"
        emptyLabel="Inherit mode skills"
        selectedIds={draft.skillIds}
        items={skills.map((skill) => ({
          id: skill.id,
          label: skill.name,
          detail: skill.description,
        }))}
        onToggle={(skillId) => onChange((current) => ({
          ...current,
          skillIds: toggleId(current.skillIds, skillId),
        }))}
      />
    </div>
  );
}

function CapabilityChecklist({
  title,
  emptyLabel,
  selectedIds,
  items,
  onToggle,
}: {
  title: string;
  emptyLabel: string;
  selectedIds: string[];
  items: Array<{ id: string; label: string; detail: string }>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-bench-200 bg-bench-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">{title}</span>
        <span className="text-[11px] font-semibold text-bench-600">
          {selectedIds.length > 0 ? `${selectedIds.length} selected` : emptyLabel}
        </span>
      </div>
      <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto pr-1">
        {items.map((item) => {
          const checked = selectedIds.includes(item.id);
          return (
            <label
              key={item.id}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm transition",
                checked ? "border-bench-400 bg-white" : "border-transparent bg-white/60 hover:bg-white",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(item.id)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block font-semibold text-bench-900">{item.label}</span>
                <span className="block truncate text-xs text-bench-600">{item.detail}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function parseToolGroups(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index);
}

function toggleId(values: string[], id: string): string[] {
  return values.includes(id)
    ? values.filter((value) => value !== id)
    : [...values, id];
}

function draftFromEditor(draft: AgentDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    model: draft.model.trim() || undefined,
    toolGroups: parseToolGroups(draft.toolGroupsText),
    toolIds: draft.toolIds,
    skillIds: draft.skillIds,
    soul: draft.soul.trim(),
  };
}

function editorDraftFromGenerated(draft: Partial<ReturnType<typeof draftFromEditor>>): AgentDraft {
  return {
    name: draft.name ?? "",
    description: draft.description ?? "",
    model: draft.model ?? "",
    toolGroupsText: (draft.toolGroups ?? []).join(", "),
    toolIds: draft.toolIds ?? [],
    skillIds: draft.skillIds ?? [],
    soul: draft.soul ?? "",
  };
}

function canConfirmDraft(draft: AgentDraft): boolean {
  return Boolean(
    draft.name.trim() &&
    draft.description.trim() &&
    draft.soul.trim() &&
    /^[a-z0-9-]+$/.test(draft.name.trim()),
  );
}

function slugifyModeId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `team-${slug}` : "";
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
