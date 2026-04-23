import { ArrowLeft, Bot, MessageSquarePlus, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useWorkbench } from "../lib/state";
import type { OraCustomAgentSummary, RuntimeClient } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

type AgentEditorMode = "gallery" | "create" | "edit";

interface AgentDraft {
  name: string;
  description: string;
  model: string;
  toolGroupsText: string;
  soul: string;
}

const EMPTY_DRAFT: AgentDraft = {
  name: "",
  description: "",
  model: "",
  toolGroupsText: "",
  soul: "",
};

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
  const { dispatch } = useWorkbench();
  const [agents, setAgents] = useState<OraCustomAgentSummary[]>([]);
  const [mode, setMode] = useState<AgentEditorMode>("gallery");
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const [editingName, setEditingName] = useState<string | undefined>();
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.name === selectedCustomAgentId),
    [agents, selectedCustomAgentId],
  );

  async function loadAgents() {
    setBusy("refresh");
    try {
      const nextAgents = await runtimeClient.listAgents();
      setAgents(nextAgents);
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
    setEditingName(undefined);
    setError("");
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

  async function saveAgent() {
    const normalizedName = draft.name.trim().toLowerCase();
    if (!normalizedName) {
      setError("Custom agent name is required.");
      return;
    }

    const toolGroups = parseToolGroups(draft.toolGroupsText);
    setBusy(mode === "create" ? "create" : "save");
    setError("");

    try {
      if (mode === "create") {
        const check = await runtimeClient.checkAgentName(normalizedName);
        if (!check.available) {
          throw new Error(`Custom agent '${check.name}' already exists.`);
        }
        await runtimeClient.createAgent({
          name: normalizedName,
          description: draft.description,
          model: draft.model.trim() || undefined,
          toolGroups,
          soul: draft.soul,
        });
        dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Created custom agent ${normalizedName}.` });
      } else {
        await runtimeClient.updateAgent({
          name: editingName ?? normalizedName,
          description: draft.description,
          model: draft.model.trim() ? draft.model.trim() : null,
          toolGroups: toolGroups.length > 0 ? toolGroups : null,
          soul: draft.soul,
        });
        dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Updated custom agent ${editingName ?? normalizedName}.` });
      }

      await loadAgents();
      resetEditor();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save custom agent.");
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
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
              <h2 className="text-lg font-semibold">Custom agent workspace</h2>
              <p className="mt-1 text-xs text-bench-700">
                Manage DeerFlow-style agent personas backed by `.ora/agents`, then start a chat with that persona overlay.
              </p>
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
          <section className="rounded-lg bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Selected Persona</h3>
                <p className="mt-1 text-xs text-bench-700">
                  The selected agent becomes the default persona overlay for the next run you start from chat.
                </p>
              </div>
              {selectedAgent ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-bench-200 bg-bench-50 px-3 py-1.5 text-xs font-semibold text-bench-900">
                    <Bot size={13} />
                    {selectedAgent.name}
                  </span>
                  <button
                    onClick={onClearSelectedCustomAgent}
                    className="h-8 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition hover:bg-bench-50"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <span className="rounded-full bg-bench-50 px-3 py-1.5 text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                  No custom agent selected
                </span>
              )}
            </div>
            {selectedAgent?.description && (
              <p className="mt-3 text-sm leading-6 text-bench-700">{selectedAgent.description}</p>
            )}
          </section>

          {error && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              {error}
            </section>
          )}

          {mode === "gallery" ? (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Agent Gallery</h3>
                  <p className="mt-1 text-xs text-bench-700">Create, revise, delete, or start a new chat with a reusable persona.</p>
                </div>
                <span className="rounded-full bg-bench-50 px-3 py-1.5 text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                  {agents.length} agent{agents.length === 1 ? "" : "s"}
                </span>
              </div>

              {agents.length === 0 ? (
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
                        <div>Tool groups: {agent.toolGroups?.join(", ") || "inherit runtime defaults"}</div>
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
          ) : (
            <section className="rounded-[24px] bg-white p-6 shadow-pane ring-1 ring-inset ring-bench-200">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{mode === "create" ? "Create custom agent" : `Edit ${editingName}`}</h3>
                  <p className="mt-1 text-xs text-bench-700">This v1 editor writes `config.yaml` and `SOUL.md` directly into `.ora/agents/&lt;name&gt;`.</p>
                </div>
                <button
                  onClick={saveAgent}
                  disabled={busy.length > 0 || !draft.name.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mode === "create" ? "Create agent" : "Save changes"}
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Name</span>
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    disabled={mode === "edit"}
                    placeholder="researcher-hk"
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
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Tool Groups</span>
                  <input
                    value={draft.toolGroupsText}
                    onChange={(event) => setDraft((current) => ({ ...current, toolGroupsText: event.target.value }))}
                    placeholder="web, shell, github"
                    className="h-10 w-full rounded-md border border-bench-200 bg-bench-50 px-3 text-sm outline-none transition focus:border-bench-900"
                  />
                </label>
                <label className="space-y-1.5 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">SOUL</span>
                  <textarea
                    value={draft.soul}
                    onChange={(event) => setDraft((current) => ({ ...current, soul: event.target.value }))}
                    rows={14}
                    placeholder="Long-form persona instructions written into SOUL.md."
                    className="w-full rounded-md border border-bench-200 bg-bench-50 px-3 py-2 font-mono text-sm outline-none transition focus:border-bench-900"
                  />
                </label>
              </div>
            </section>
          )}
        </div>
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

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
