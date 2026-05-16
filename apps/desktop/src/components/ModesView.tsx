import { ArrowLeft, Check, Copy, Database, FileText, GitBranchPlus, Globe, Layers3, ListTree, PencilLine, Plug, Plus, RefreshCcw, Route, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, Terminal, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionRiskLevelSchema,
  BuiltInCoordinationPatternSchema,
  CoordinationPatternSchema,
  completionPolicyForPreset,
  ensureModeNodePositions,
  getModeNodeRuntimeTemplateDefinition,
  getPatternDefinition,
  RecoveryActionSchema,
  RecoveryErrorTypeSchema,
  type BuiltInCoordinationPattern,
  type CoordinationPattern,
} from "@cemeworm/shared";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  addModeEdge,
  addModeNode,
  autoLayoutDraft,
  buildModeFlowEdges,
  buildModeFlowNodes,
  canDeleteModeNode,
  canDisableModeNode,
  getExecutionPreview,
  hydrateModeDraft,
  modeCapabilitySourceHandlePositions,
  modeCanvasStagePositionToStoredPosition,
  MODE_CAPABILITY_TARGET_HANDLE_ID,
  MODE_CAPABILITY_NODE_PREFIX,
  NODE_ATTACHMENT_NODE_PREFIX,
  patchModeNodePosition,
  removeModeEdges,
  RUNTIME_ANCHOR_NODE_ID,
  resetModeDraftFamily,
  validateCanvasConnection,
  type ModeCanvasNodeData,
} from "../lib/modeCanvas";
import { translateCopy, type AppLanguage } from "../lib/i18n";
import { useWorkbench } from "../lib/state";
import type { OraCustomAgentSummary, OraModeCreateParams, OraModeSpec, OraModeStudioDraftBundle, OraModeValidationResult, OraRunHandle, RuntimeClient } from "../lib/runtimeClient";
import { cn } from "../lib/utils";
import { PageHeader } from "./PageHeader";
import { Checkbox } from "./ui/checkbox";
import { Select } from "./ui/select";

type EditorMode = "gallery" | "create" | "edit";
type ModeInspectorSection = "overview" | "agents" | "capabilities" | "safety" | "advanced";

const NODE_TYPES = {
  modeNode: ModeCanvasNode,
};

export function ModesView({ runtimeClient }: { runtimeClient: RuntimeClient }) {
  const { state, dispatch } = useWorkbench();
  const [modes, setModes] = useState<OraModeSpec[]>(state.modes);
  const [atoms, setAtoms] = useState<Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"]>([]);
  const [customAgents, setCustomAgents] = useState<OraCustomAgentSummary[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>("gallery");
  const [draft, setDraft] = useState<OraModeSpec | undefined>();
  const [editingModeId, setEditingModeId] = useState<string | undefined>();
  const [validation, setValidation] = useState<OraModeValidationResult | undefined>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [pendingTemplate, setPendingTemplate] = useState<string>("");
  const [builderInput, setBuilderInput] = useState("");
  const [builderMessages, setBuilderMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [builderBundle, setBuilderBundle] = useState<OraModeStudioDraftBundle | undefined>();
  const [builderRun, setBuilderRun] = useState<OraRunHandle | undefined>();
  const [previewNodeId, setPreviewNodeId] = useState<string | undefined>();

  useEffect(() => {
    setModes(state.modes);
  }, [state.modes]);

  useEffect(() => {
    void refreshModes();
  }, [runtimeClient]);

  useEffect(() => {
    void refreshAtoms();
  }, [runtimeClient]);

  useEffect(() => {
    void refreshCustomAgents();
  }, [runtimeClient]);

  const selectedMode = useMemo(
    () => modes.find((mode) => mode.id === state.selectedModeId) ?? modes[0],
    [modes, state.selectedModeId],
  );
  const previewMode = useMemo(
    () => selectedMode ? ensureModeNodePositions(selectedMode) : undefined,
    [selectedMode],
  );
  const activeMode = draft ?? previewMode;
  const draftDefinition = draft ? getPatternDefinition(draft.family) : undefined;
  const selectedDefinition = previewMode ? getPatternDefinition(previewMode.family) : undefined;
  const selectedNode = draft?.nodes.find((node) => node.id === selectedNodeId);
  const selectedModeAtom = draft && selectedNodeId?.startsWith(MODE_CAPABILITY_NODE_PREFIX)
    ? atoms.find((atom) => atom.scope === "mode" && `${MODE_CAPABILITY_NODE_PREFIX}${atom.id}` === selectedNodeId)
    : undefined;
  const selectedNodeAttachment = draft && selectedNodeId?.startsWith(NODE_ATTACHMENT_NODE_PREFIX)
    ? (() => {
      const raw = selectedNodeId.slice(NODE_ATTACHMENT_NODE_PREFIX.length);
      const divider = raw.lastIndexOf(":");
      if (divider === -1) return undefined;
      const sourceNodeId = raw.slice(0, divider);
      const atomId = raw.slice(divider + 1);
      const sourceNode = draft.nodes.find((node) => node.id === sourceNodeId);
      const atom = atoms.find((candidate) => candidate.scope === "node" && candidate.id === atomId);
      return sourceNode && atom ? { sourceNode, atom } : undefined;
    })()
    : undefined;
  const allowedTemplates = draft?.editorConstraints.allowedNodeTemplates ?? [];
  const executionPreview = draft ? getExecutionPreview(draft) : undefined;

  useEffect(() => {
    if (!draft) {
      setPendingTemplate("");
      return;
    }
    if (pendingTemplate && allowedTemplates.includes(pendingTemplate as OraModeSpec["nodes"][number]["template"])) {
      return;
    }
    setPendingTemplate(allowedTemplates[0] ?? "");
  }, [allowedTemplates, draft, pendingTemplate]);

  useEffect(() => {
    if (!draft) {
      setSelectedNodeId(undefined);
      return;
    }
    if (selectedNodeId && canvasSelectionExists(draft, atoms, selectedNodeId)) {
      return;
    }
    if (selectedNodeId) {
      setSelectedNodeId(draft.nodes[0]?.id);
    }
  }, [atoms, draft, selectedNodeId]);

  useEffect(() => {
    if (!previewMode) {
      setPreviewNodeId(undefined);
      return;
    }
    if (previewNodeId && previewMode.nodes.some((node) => node.id === previewNodeId)) {
      return;
    }
    setPreviewNodeId(undefined);
  }, [previewMode, previewNodeId]);

  async function refreshModes() {
    setBusy("refresh");
    try {
      const nextModes = await runtimeClient.listModes();
      setModes(nextModes);
      dispatch({ type: "SET_MODES", modes: nextModes });
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load modes.");
    } finally {
      setBusy("");
    }
  }

  async function refreshAtoms() {
    try {
      const bootstrap = await runtimeClient.bootstrap();
      setAtoms(bootstrap.atoms);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load runtime atoms.");
    }
  }

  async function refreshCustomAgents() {
    try {
      setCustomAgents(await runtimeClient.listAgents());
    } catch {
      setCustomAgents([]);
    }
  }

  function startDraft(source?: OraModeSpec, forceCreate = false) {
    const base = source ?? selectedMode;
    if (!base) return;

    setError("");
    setValidation(undefined);

    const seed = forceCreate || base.systemPreset
      ? {
        ...base,
        id: `${base.id}-custom`,
        label: `${base.label} Custom`,
        systemPreset: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      : base;
    const nextDraft = hydrateModeDraft(seed);
    setDraft(nextDraft);
    setSelectedNodeId(nextDraft.nodes[0]?.id);
    setEditingModeId(forceCreate || base.systemPreset ? undefined : base.id);
    setEditorMode(forceCreate || base.systemPreset ? "create" : "edit");
  }

  function patchDraft(updater: (current: OraModeSpec) => OraModeSpec) {
    setDraft((current) => current ? { ...updater(current), updatedAt: Date.now() } : current);
  }

  async function runValidation(nextDraft = draft) {
    if (!nextDraft) return;
    setBusy("validate");
    try {
      const result = await runtimeClient.validateMode(nextDraft);
      setValidation(result);
      setError("");
      return result;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Validation failed.");
      return undefined;
    } finally {
      setBusy("");
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy("save");
    try {
      const result = await runtimeClient.validateMode(draft);
      setValidation(result);
      if (!result.valid) {
        setError(result.errors.join(" "));
        return;
      }

      const payload = toCreateParams(draft);
      const saved = editingModeId
        ? await runtimeClient.updateMode(editingModeId, payload)
        : await runtimeClient.createMode(payload);
      const nextModes = await runtimeClient.listModes();
      setModes(nextModes);
      dispatch({ type: "SET_MODES", modes: nextModes });
      dispatch({ type: "SET_MODE", modeId: saved.id });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `${saved.label} saved and selected for the next turn.` });
      setDraft(undefined);
      setSelectedNodeId(undefined);
      setEditingModeId(undefined);
      setEditorMode("gallery");
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save mode.");
    } finally {
      setBusy("");
    }
  }

  async function deleteMode(modeId: string) {
    const target = modes.find((mode) => mode.id === modeId);
    if (target?.systemPreset) {
      setError("System presets cannot be deleted. Customize it first to create an editable mode.");
      return;
    }
    if (!window.confirm(`Delete mode '${target?.label ?? modeId}'?`)) {
      return;
    }
    setBusy(`delete:${modeId}`);
    try {
      await runtimeClient.deleteMode(modeId);
      const nextModes = await runtimeClient.listModes();
      setModes(nextModes);
      dispatch({ type: "SET_MODES", modes: nextModes });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `Deleted mode ${modeId}.` });
      setDraft(undefined);
      setSelectedNodeId(undefined);
      setEditingModeId(undefined);
      setEditorMode("gallery");
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete mode.");
    } finally {
      setBusy("");
    }
  }

  async function clonePreset(mode: OraModeSpec) {
    setBusy(`clone:${mode.id}`);
    try {
      const cloned = await runtimeClient.cloneModeFromPreset(mode.id);
      const nextModes = await runtimeClient.listModes();
      setModes(nextModes);
      dispatch({ type: "SET_MODES", modes: nextModes });
      dispatch({ type: "SET_MODE", modeId: cloned.id });
      startDraft(cloned);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to clone mode preset.");
    } finally {
      setBusy("");
    }
  }

  function startBuilderFlow() {
    setDraft(undefined);
    setEditingModeId(undefined);
    setSelectedNodeId(undefined);
    setValidation(undefined);
    setBuilderInput("");
    setBuilderMessages([]);
    setBuilderBundle(undefined);
    setBuilderRun(undefined);
    setError("");
    setEditorMode("create");
  }

  async function submitBuilder(promptOverride?: string) {
    const content = (promptOverride ?? builderInput).trim();
    if (!content) return;
    const nextMessages = [
      ...builderMessages,
      { role: "user" as const, content },
    ];
    setBuilderInput("");
    setBuilderMessages(nextMessages);
    setBusy("builder");
    try {
      const provider = state.providerRegistry?.providers.find((entry) => entry.id === state.selectedProviderId);
      const handle = await runtimeClient.startModeStudioBuilderRun({
        operation: builderBundle ? "refine" : "generate",
        messages: nextMessages,
        baseModeId: selectedMode?.id,
        currentDraft: draft,
        draftBundle: builderBundle,
        providerId: state.selectedProviderId,
        providerConfig: provider,
        modelRef: provider?.modelId ?? "local/smoke-model",
      });
      setBuilderRun(handle);
      const result = await runtimeClient.modeStudioBuilderResult(handle.runId);
      if (!result.draftBundle) {
        throw new Error(result.issues[0]?.message ?? "Mode builder did not return a draft.");
      }
      setBuilderBundle(result.draftBundle);
      setBuilderMessages([...nextMessages, { role: "assistant", content: result.draftBundle.guidance.assistantMessage }]);
      setDraft(hydrateModeDraft(result.draftBundle.modeDraft));
      setValidation(result.draftBundle.validation);
      setEditorMode(editingModeId ? "edit" : "create");
      setSelectedNodeId(result.draftBundle.modeDraft.nodes[0]?.id);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Mode builder failed.");
    } finally {
      setBusy("");
    }
  }

  async function applyBuilderBundle() {
    if (!builderBundle) return;
    setBusy("builder:apply");
    try {
      const bundle = draft
        ? { ...builderBundle, modeDraft: draft }
        : builderBundle;
      const result = await runtimeClient.applyModeStudioDraft({
        draftBundle: bundle,
        updateModeId: editingModeId,
        saveAgentDrafts: true,
      });
      const nextModes = await runtimeClient.listModes();
      setModes(nextModes);
      dispatch({ type: "SET_MODES", modes: nextModes });
      dispatch({ type: "SET_MODE", modeId: result.mode.id });
      dispatch({ type: "SET_COMMAND_FEEDBACK", feedback: `${result.mode.label} generated and selected for the next turn.` });
      setBuilderBundle(undefined);
      setBuilderRun(undefined);
      setDraft(undefined);
      setSelectedNodeId(undefined);
      setEditingModeId(undefined);
      setEditorMode("gallery");
      void refreshCustomAgents();
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to apply generated mode.");
    } finally {
      setBusy("");
    }
  }

  function exitEditor() {
    setDraft(undefined);
    setSelectedNodeId(undefined);
    setEditingModeId(undefined);
    setValidation(undefined);
    setBuilderInput("");
    setBuilderMessages([]);
    setBuilderBundle(undefined);
    setError("");
    setEditorMode("gallery");
  }

  function handleAddNode() {
    if (!draft) return;
    let nextNodeId: string | undefined;
    patchDraft((current) => {
      const next = addModeNode(
        current,
        pendingTemplate
          ? pendingTemplate as OraModeSpec["nodes"][number]["template"]
          : undefined,
      );
      nextNodeId = next.nodes.find((node) => !current.nodes.some((item) => item.id === node.id))?.id;
      return next;
    });
    if (nextNodeId) {
      setSelectedNodeId(nextNodeId);
    }
  }

  function handleConnect(connection: Connection) {
    if (!draft) return;
    const reason = validateCanvasConnection(draft, connection);
    if (reason) {
      setError(reason);
      return;
    }
    setError("");
    patchDraft((current) => addModeEdge(current, connection));
  }

  function renderEditorToolbar() {
    if (!draft) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-pane ring-1 ring-inset ring-bench-200">
        <div className="flex items-center gap-3">
          <button
            onClick={exitEditor}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold transition hover:bg-bench-50"
          >
            <ArrowLeft size={15} />
            Back
          </button>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">{draft.family}</p>
            <h3 className="text-base font-semibold">{editingModeId ? draft.label : `Create ${draft.label}`}</h3>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void runValidation()}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50"
          >
            <Check size={14} />
            Validate
          </button>
          <button
            onClick={() => patchDraft((current) => autoLayoutDraft(current))}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50"
          >
            <RefreshCcw size={14} />
            Auto layout
          </button>
          <Select
            aria-label="Node template"
            value={pendingTemplate}
            onChange={(event) => setPendingTemplate(event.target.value)}
            className="bg-white"
          >
            {allowedTemplates.map((template) => (
              <option key={template} value={template}>{template}</option>
            ))}
          </Select>
          <button
            onClick={handleAddNode}
            disabled={!allowedTemplates.length}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} />
            Add stage
          </button>
          {editingModeId && (
            <button
              onClick={() => void deleteMode(editingModeId)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
            >
              <Trash2 size={14} />
              Delete mode
            </button>
          )}
          <button
            onClick={() => void saveDraft()}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition hover:bg-bench-800"
          >
            <Save size={14} />
            Save mode
          </button>
        </div>
      </div>
    );
  }

  function renderBuilderPanel(compact = false) {
    return (
      <div className={cn(
        "rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200",
        !compact && "mx-auto max-w-3xl",
      )}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-bench-900 text-white">
              <Sparkles size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Builder agent</p>
              <h3 className="mt-1 text-base font-semibold">Create a mode from natural language</h3>
              <p className="mt-1 text-sm leading-6 text-bench-700">Describe the workflow, roles, tools, and handoff style you want.</p>
            </div>
          </div>
          {!compact && (
            <button
              onClick={exitEditor}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold transition hover:bg-bench-50"
            >
              <ArrowLeft size={14} />
              Back
            </button>
          )}
        </div>

        <textarea
          value={builderInput}
          onChange={(event) => setBuilderInput(event.target.value)}
          rows={compact ? 3 : 5}
          placeholder="Describe the mode you want..."
          className="mt-4 min-h-24 w-full resize-none rounded-md border border-bench-200 bg-bench-50 px-3 py-2 text-sm outline-none transition focus:border-bench-500 focus:bg-white"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void submitBuilder()}
            disabled={busy === "builder" || !builderInput.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-bench-900 px-3 text-sm font-semibold text-white transition hover:bg-bench-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={14} className={cn(busy === "builder" && "animate-pulse")} />
            {builderBundle ? "Refine" : "Generate"}
          </button>
          {builderBundle && (
            <button
              onClick={() => void applyBuilderBundle()}
              disabled={busy === "builder:apply" || builderBundle.needsInput || !builderBundle.validation.valid}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={14} />
              Apply
            </button>
          )}
        </div>

        {builderBundle && (
          <div className="mt-4 space-y-3">
            {builderRun && (
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-bench-600">
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
                  Runtime run {builderRun.status}
                </span>
                <span className="rounded-full bg-bench-100 px-2 py-1 text-bench-700">
                  {builderRun.runId}
                </span>
              </div>
            )}
            <div className="rounded-md bg-bench-50 px-3 py-2 text-sm leading-6 text-bench-800">
              {builderBundle.guidance.assistantMessage}
            </div>
            {builderBundle.guidance.choices.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {builderBundle.guidance.choices.map((choice) => (
                  <button
                    key={choice.id}
                    onClick={() => void submitBuilder(choice.prompt)}
                    className="rounded-md border border-bench-200 bg-white px-2.5 py-1.5 text-left text-xs font-semibold text-bench-800 transition hover:bg-bench-50"
                    title={choice.description}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}
            {builderBundle.changeSummary.length > 0 && (
              <ul className="space-y-1 text-xs leading-5 text-bench-700">
                {builderBundle.changeSummary.slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-transparent">
      <PageHeader
        title="模式"
        actions={(
          <>
            <button
              onClick={() => void refreshModes()}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50"
            >
              <RefreshCcw size={16} className={cn(busy === "refresh" && "animate-spin")} />
            </button>
            <button
              onClick={startBuilderFlow}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition hover:bg-bench-800"
            >
              <Plus size={16} />
              New mode
            </button>
            {selectedMode && (
              <button
                onClick={() => void clonePreset(selectedMode)}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50"
              >
                <Copy size={16} />
                Clone preset
              </button>
            )}
          </>
        )}
      />

      <div className="flex min-h-0 min-w-0 flex-1 bg-transparent">
        <aside className="flex w-[21rem] shrink-0 flex-col border-r border-border bg-sidebar/92">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-2">
            {modes.map((mode) => (
              <div
                key={mode.id}
                className={cn(
                  "w-full rounded-xl border px-3 py-3 text-left transition",
                  state.selectedModeId === mode.id
                    ? "border-bench-400 bg-white shadow-pane"
                    : "border-transparent bg-white/70 hover:border-bench-200 hover:bg-white",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => dispatch({ type: "SET_MODE", modeId: mode.id })}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="font-semibold">{displayText(state.language, mode.label)}</div>
                    <p className="mt-1 text-xs leading-5 text-bench-700">{displayText(state.language, mode.summary)}</p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="rounded-full border border-bench-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-bench-700">
                      {mode.systemPreset
                        ? translateCopy(state.language, "preset")
                        : state.language === "zh"
                          ? formatEnumLabel(state.language, mode.family)
                          : mode.family}
                    </span>
                    {!mode.systemPreset && (
                      <button
                        type="button"
                        onClick={() => void deleteMode(mode.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-rose-600 opacity-70 transition hover:bg-rose-50 hover:opacity-100"
                        aria-label={`Delete ${displayText(state.language, mode.label)}`}
                        title="Delete mode"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="min-w-0 space-y-5">
          {draft ? renderEditorToolbar() : null}

          {error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{error}</div>
          )}

          {validation && (
            <div className={cn(
              "rounded-xl px-4 py-3 text-sm",
              validation.valid ? "border border-emerald-200 bg-emerald-50 text-emerald-900" : "border border-rose-200 bg-rose-50 text-rose-900",
            )}>
              {validation.valid ? "Validation passed." : validation.errors.join(" ")}
              {validation.warnings.length > 0 && <p className="mt-2 text-xs opacity-80">{validation.warnings.join(" ")}</p>}
            </div>
          )}

          {editorMode === "gallery" && selectedMode && previewMode ? (
            <section className="space-y-5">
              <div className="rounded-2xl bg-white p-6 shadow-pane ring-1 ring-inset ring-bench-200">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">{selectedMode.family}</p>
                    <h3 className="mt-1 text-2xl font-semibold">{displayText(state.language, selectedMode.label)}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-bench-700">{displayText(state.language, selectedMode.summary)}</p>
                    {selectedMode.recommendedUse && (
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-bench-800">
                        {translateCopy(state.language, "Use:")} {displayText(state.language, selectedMode.recommendedUse)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => dispatch({ type: "SET_MODE", modeId: selectedMode.id })}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50"
                    >
                      <Check size={15} />
                      Use in chat
                    </button>
                    <button
                      onClick={() => startDraft(selectedMode)}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition hover:bg-bench-800"
                    >
                      <GitBranchPlus size={15} />
                      {selectedMode.systemPreset ? "Customize" : "Edit"}
                    </button>
                    {!selectedMode.systemPreset && (
                      <button
                        onClick={() => void deleteMode(selectedMode.id)}
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                      >
                        <Trash2 size={15} />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <ModeRunStoryPanel
                mode={previewMode}
                atoms={atoms}
                executionPreview={getExecutionPreview(previewMode)}
                language={state.language}
              />

              <section className="grid min-w-0 items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <CanvasPanel
                  mode={previewMode}
                  atoms={atoms}
                  language={state.language}
                  readOnly
                  selectedNodeId={previewNodeId}
                  onSelectNode={setPreviewNodeId}
                  onClearSelection={() => setPreviewNodeId(undefined)}
                />
                <ModeOverviewInspector
                  mode={previewMode}
                  atoms={atoms}
                  definition={selectedDefinition}
                  executionPreview={getExecutionPreview(previewMode)}
                  language={state.language}
                  selectedNode={previewMode.nodes.find((node) => node.id === previewNodeId)}
                />
              </section>
            </section>
          ) : draft ? (
            <section className="space-y-5">
              {builderBundle ? renderBuilderPanel(true) : null}
              <div className="grid min-w-0 items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <CanvasPanel
                  mode={draft}
                  atoms={atoms}
                  language={state.language}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  onClearSelection={() => setSelectedNodeId(undefined)}
                  onConnect={handleConnect}
                  onDeleteEdges={(edges) => patchDraft((current) => removeModeEdges(current, edges.map((edge) => edge.id)))}
                  onMoveNode={(node, canvasWidth) => {
                    if (node.data.kind !== "stage") return;
                    patchDraft((current) => patchModeNodePosition(
                      current,
                      node.id,
                      modeCanvasStagePositionToStoredPosition(current, atoms, node.position, canvasWidth),
                    ));
                  }}
                />
                <div className="space-y-5">
                  {selectedNode ? (
                    <NodeInspector
                      draft={draft}
                      node={selectedNode}
                      atoms={atoms}
                      customAgents={customAgents}
                      allowedTemplates={allowedTemplates}
                      language={state.language}
                      onPatchNode={(updater) => patchDraft((current) => ({
                        ...current,
                        nodes: current.nodes.map((item) => item.id === selectedNode.id ? updater(item) : item),
                      }))}
                      onDeleteNode={() => {
                        if (!canDeleteModeNode(draft, selectedNode.id)) return;
                        patchDraft((current) => ({
                          ...current,
                          nodes: current.nodes.filter((node) => node.id !== selectedNode.id),
                          edges: current.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
                        }));
                        setSelectedNodeId(undefined);
                      }}
                    />
                  ) : selectedModeAtom ? (
                    <CapabilityInspector
                      mode={draft}
                      atom={selectedModeAtom}
                      language={state.language}
                      onToggle={() => patchDraft((current) => ({
                        ...current,
                        runtimeAtoms: current.runtimeAtoms.includes(selectedModeAtom.id)
                          ? current.runtimeAtoms.filter((atomId) => atomId !== selectedModeAtom.id)
                          : [...current.runtimeAtoms, selectedModeAtom.id],
                      }))}
                    />
                  ) : selectedNodeAttachment ? (
                    <CapabilityInspector
                      mode={draft}
                      atom={selectedNodeAttachment.atom}
                      sourceNode={selectedNodeAttachment.sourceNode}
                      language={state.language}
                      onToggle={() => patchDraft((current) => ({
                        ...current,
                        nodes: current.nodes.map((node) =>
                          node.id !== selectedNodeAttachment.sourceNode.id
                            ? node
                            : {
                                ...node,
                                config: {
                                  ...node.config,
                                  atoms: toggleNodeAtom(node, selectedNodeAttachment.atom.id),
                                },
                              },
                        ),
                      }))}
                    />
                  ) : (
                    <ModeInspector
                      draft={draft}
                      atoms={atoms}
                      toolRegistry={state.toolRegistry}
                      customAgents={customAgents}
                      editingModeId={editingModeId}
                      definition={draftDefinition}
                      executionPreview={executionPreview}
                      language={state.language}
                      onPatchDraft={patchDraft}
                      onDeleteMode={editingModeId ? () => void deleteMode(editingModeId) : undefined}
                    />
                  )}
                </div>
              </div>
            </section>
          ) : editorMode === "create" ? (
            renderBuilderPanel()
          ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function CanvasPanel({
  mode,
  atoms,
  language,
  readOnly = false,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  onMoveNode,
  onConnect,
  onDeleteEdges,
}: {
  mode: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  language: AppLanguage;
  readOnly?: boolean;
  selectedNodeId?: string;
  onSelectNode: (nodeId?: string) => void;
  onClearSelection: () => void;
  onMoveNode?: (node: Node<ModeCanvasNodeData>, canvasWidth: number) => void;
  onConnect?: (connection: Connection) => void;
  onDeleteEdges?: (edges: Edge[]) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(1120);
  const nodes = useMemo(
    () => buildModeFlowNodes(mode, atoms, canvasWidth).map((node) => ({
      ...node,
      data: localizeCanvasNodeData(language, node.data),
      selected: node.id === selectedNodeId,
    })),
    [atoms, canvasWidth, language, mode, selectedNodeId],
  );
  const edges = useMemo(() => buildModeFlowEdges(mode, atoms), [atoms, mode]);
  const fitCanvasView = useCallback(() => {
    window.requestAnimationFrame(() => {
      flowInstanceRef.current?.fitView({
        padding: readOnly ? 0.12 : 0.16,
        duration: 160,
      });
    });
  }, [readOnly]);

  useEffect(() => {
    fitCanvasView();
  }, [edges, fitCanvasView, nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (typeof nextWidth === "number") {
        setCanvasWidth((current) => Math.abs(current - nextWidth) > 1 ? nextWidth : current);
      }
      fitCanvasView();
    });
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [fitCanvasView]);

  return (
    <div
      className={cn(
        "flex h-full min-w-0 w-full flex-col overflow-hidden rounded-[1.5rem] bg-white shadow-pane ring-1 ring-inset ring-bench-200",
        readOnly ? "min-h-[560px]" : "min-h-[680px]",
      )}
    >
      <div className="border-b border-bench-200/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">
              {readOnly ? "Canvas preview" : "Canvas"}
            </p>
            <h4 className="mt-1 text-base font-semibold">{displayText(language, mode.label)}</h4>
          </div>
          <div className="rounded-full bg-bench-100 px-3 py-1 text-xs font-semibold text-bench-800">
            {mode.nodes.filter((node) => node.enabled).length} {translateCopy(language, "enabled nodes")}
          </div>
        </div>
      </div>
      <div
        ref={canvasRef}
        className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(245,247,249,0.9),rgba(236,240,243,0.55)_45%,rgba(250,251,252,1)_100%)]"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: readOnly ? 0.12 : 0.16 }}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          minZoom={0.2}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          onPaneClick={onClearSelection}
          onNodeClick={(_event, node) => onSelectNode(node.id)}
          onNodeDragStop={(_event, node) => onMoveNode?.(node, canvasWidth)}
          onConnect={readOnly ? undefined : onConnect}
          onEdgesDelete={readOnly ? undefined : onDeleteEdges}
          onInit={(instance) => {
            flowInstanceRef.current = instance;
            fitCanvasView();
          }}
          panOnScroll
          selectionOnDrag={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1.1} color="#d5dde3" />
          {!readOnly && (
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => (node.data.enabled ? "#1f2937" : "#c2cbd4")}
              maskColor="rgba(246, 248, 250, 0.7)"
              className="!rounded-xl !border !border-bench-200 !bg-white/90 !shadow-none"
            />
          )}
          <Controls showInteractive={!readOnly} className="!rounded-xl !border !border-bench-200 !bg-white/90 !shadow-none" />
        </ReactFlow>
      </div>
    </div>
  );
}

function ModeOverviewInspector({
  mode,
  atoms,
  definition,
  executionPreview,
  language,
  selectedNode,
}: {
  mode: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  definition: ReturnType<typeof getPatternDefinition> | undefined;
  executionPreview: ReturnType<typeof getExecutionPreview>;
  language: AppLanguage;
  selectedNode?: OraModeSpec["nodes"][number];
}) {
  const [activeSection, setActiveSection] = useState<ModeInspectorSection>("overview");

  return (
    <div className="space-y-4">
      <InspectorSectionTabs activeSection={activeSection} onChange={setActiveSection} language={language} />
      {activeSection === "overview" && (
        <>
          {selectedNode ? (
            <StageExplanationPanel mode={mode} node={selectedNode} atoms={atoms} language={language} />
          ) : (
            <>
              <ModeContractPanel mode={mode} atoms={atoms} executionPreview={executionPreview} language={language} />
              <ModeTranscriptLayoutPreview mode={mode} language={language} />
            </>
          )}
          {definition && (
            <ModePurposePanel mode={mode} definition={definition} language={language} />
          )}
        </>
      )}
      {activeSection === "agents" && <ReadOnlyAgentsPanel mode={mode} language={language} />}
      {activeSection === "capabilities" && <ReadOnlyCapabilitiesPanel mode={mode} atoms={atoms} language={language} />}
      {activeSection === "safety" && <ReadOnlySafetyPanel mode={mode} executionPreview={executionPreview} language={language} />}
      {activeSection === "advanced" && (
        <ModeSummaryCards mode={mode} atoms={atoms} definition={definition} executionPreview={executionPreview} language={language} />
      )}
      {mode.systemPreset && (
        <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
          <h4 className="text-sm font-semibold">Preset status</h4>
          <p className="mt-3 text-sm leading-6 text-bench-700">
            System presets stay read-only on canvas. Choose <span className="font-semibold text-bench-900">Customize</span> to clone this layout into an editable mode.
          </p>
        </div>
      )}
    </div>
  );
}

function ModeInspector({
  draft,
  atoms,
  toolRegistry,
  customAgents,
  editingModeId,
  definition,
  executionPreview,
  language,
  onPatchDraft,
  onDeleteMode,
}: {
  draft: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  toolRegistry: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["toolRegistry"] | undefined;
  customAgents: OraCustomAgentSummary[];
  editingModeId?: string;
  definition: ReturnType<typeof getPatternDefinition> | undefined;
  executionPreview: ReturnType<typeof getExecutionPreview> | undefined;
  language: AppLanguage;
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
  onDeleteMode?: () => void;
}) {
  const [activeSection, setActiveSection] = useState<ModeInspectorSection>("overview");

  return (
    <>
      <InspectorSectionTabs activeSection={activeSection} onChange={setActiveSection} language={language} />

      {activeSection === "overview" && (
        <>
          <ModeContractPanel mode={draft} atoms={atoms} executionPreview={executionPreview} language={language} />
          <ModeTranscriptLayoutPreview mode={draft} language={language} />
          <ModeSettingsPanel
            draft={draft}
            editingModeId={editingModeId}
            onPatchDraft={onPatchDraft}
            language={language}
          />
        </>
      )}

      {activeSection === "agents" && (
        <ModeAgentRosterPanel
          draft={draft}
          customAgents={customAgents}
          language={language}
          onPatchDraft={onPatchDraft}
        />
      )}

      {activeSection === "capabilities" && (
        <>
          <ModeCapabilityPanel
            draft={draft}
            atoms={atoms}
            language={language}
            onPatchDraft={onPatchDraft}
          />
          {toolRegistry && (
            <WorkspaceToolsPanel
              draft={draft}
              toolRegistry={toolRegistry}
              onPatchDraft={onPatchDraft}
            />
          )}
          <MemoryPolicyPanel
            draft={draft}
            onPatchDraft={onPatchDraft}
          />
        </>
      )}

      {activeSection === "safety" && (
        <>
          <RuntimeStrategyPolicyPanel
            draft={draft}
            onPatchDraft={onPatchDraft}
          />
          <CompletionPolicyPanel
            draft={draft}
            onPatchDraft={onPatchDraft}
          />
          <RecoveryPolicyPanel
            draft={draft}
            onPatchDraft={onPatchDraft}
          />
        </>
      )}

      {activeSection === "advanced" && (
        <ModeSummaryCards mode={draft} atoms={atoms} definition={definition} executionPreview={executionPreview} language={language} />
      )}

      {onDeleteMode && (
        <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-rose-200">
          <button
            onClick={onDeleteMode}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
          >
            <Trash2 size={14} />
            Delete mode
          </button>
        </div>
      )}
    </>
  );
}

function ModeTranscriptLayoutPreview({
  mode,
  language,
}: {
  mode: OraModeSpec;
  language: AppLanguage;
}) {
  const stages = mode.stages ?? [];
  const layout = mode.transcriptLayout;
  if (stages.length === 0 && !layout) {
    return null;
  }
  const previewStages = stages.slice(0, 5);
  const hiddenCount = Math.max(0, stages.length - previewStages.length);

  return (
    <section className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">{translateCopy(language, "Transcript layout")}</p>
          <h4 className="mt-1 text-sm font-semibold">{displayText(language, layout?.groupLabel ?? mode.label)}</h4>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-bench-800">
          <span className="rounded-full bg-bench-100 px-3 py-1">{formatEnumLabel(language, layout?.style ?? "stage_list")}</span>
          <span className="rounded-full bg-bench-100 px-3 py-1">{stages.length} {translateCopy(language, "stages")}</span>
        </div>
      </div>
      {previewStages.length > 0 && (
        <div className="mt-4 grid gap-2">
          {previewStages.map((stage, index) => (
            <div key={stage.id} className="flex items-start gap-3 rounded-lg border border-bench-200 bg-bench-50/80 px-3 py-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-xs font-semibold text-bench-800 ring-1 ring-inset ring-bench-200">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-bench-950">{displayText(language, stage.label)}</p>
                  {stage.stance && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                      {layout?.stanceLabels?.[stage.stance] ?? stage.stance}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-bench-700">
                  {displayText(language, stage.speakerLabel ?? stage.speakerId ?? ownerForStage(mode, stage) ?? stage.nodeId)}
                  {" · "}
                  {stage.nodeId}
                </p>
              </div>
            </div>
          ))}
          {hiddenCount > 0 && (
            <p className="text-xs font-medium text-bench-600">+{hiddenCount} {translateCopy(language, "more")}</p>
          )}
        </div>
      )}
    </section>
  );
}

function InspectorSectionTabs({
  activeSection,
  onChange,
  language,
}: {
  activeSection: ModeInspectorSection;
  onChange: (section: ModeInspectorSection) => void;
  language: AppLanguage;
}) {
  const sections: Array<{ id: ModeInspectorSection; label: string; icon: typeof Route }> = [
    { id: "overview", label: "Overview", icon: Route },
    { id: "agents", label: "Agents", icon: Users },
    { id: "capabilities", label: "Capabilities", icon: Layers3 },
    { id: "safety", label: "Safety", icon: ShieldCheck },
    { id: "advanced", label: "Advanced", icon: SlidersHorizontal },
  ];

  return (
    <div className="rounded-2xl bg-white p-2 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="grid grid-cols-5 gap-1">
        {sections.map((section) => {
          const Icon = section.icon;
          const active = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onChange(section.id)}
              className={cn(
                "inline-flex h-10 items-center justify-center rounded-md transition active:scale-95",
                active ? "bg-bench-900 text-white" : "text-bench-600 hover:bg-bench-100 hover:text-bench-950",
              )}
              title={translateCopy(language, section.label)}
              aria-label={translateCopy(language, section.label)}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModeRunStoryPanel({
  mode,
  atoms,
  executionPreview,
  language,
}: {
  mode: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  executionPreview: ReturnType<typeof getExecutionPreview>;
  language: AppLanguage;
}) {
  const steps = buildModeRunStory(mode, atoms, executionPreview, language);
  const mountedCapabilities = resolveModeAtoms(mode, atoms, "mode").length + resolveModeAtoms(mode, atoms, "node").length;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">{translateCopy(language, "Run story")}</p>
          <h3 className="mt-1 text-lg font-semibold">{translateCopy(language, "How this mode runs")}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-bench-700">
            {translateCopy(language, "Read this as the mode's operating path: request, stages, runtime capabilities, and stop condition.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-bench-800">
          <span className="rounded-full bg-bench-100 px-3 py-1">{executionPreview.nodes.length} {translateCopy(language, "stages")}</span>
          <span className="rounded-full bg-bench-100 px-3 py-1">{mode.profiles.length} {translateCopy(language, "agents")}</span>
          <span className="rounded-full bg-bench-100 px-3 py-1">{mountedCapabilities} {translateCopy(language, "capabilities")}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-5">
        {steps.map((step, index) => (
          <div
            key={`${step.title}:${index}`}
            className={cn(
              "relative min-h-[11rem] rounded-xl border bg-bench-50/80 p-4",
              step.riskLevel ? riskSurfaceClassName(step.riskLevel) : "border-bench-200",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bench-900 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-bench-700 ring-1 ring-inset ring-bench-200">
                {step.kind}
              </span>
            </div>
            <h4 className="mt-4 text-sm font-semibold leading-5 text-bench-950">{step.title}</h4>
            <p className="mt-2 text-xs leading-5 text-bench-700">{step.description}</p>
            {step.meta.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {step.meta.map((item) => (
                  <span key={item} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-bench-700 ring-1 ring-inset ring-bench-200">
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ModeContractPanel({
  mode,
  atoms,
  executionPreview,
  language,
}: {
  mode: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  executionPreview: ReturnType<typeof getExecutionPreview> | undefined;
  language: AppLanguage;
}) {
  const enabledTools = mode.capabilityFlags.toolIds.length;
  const enabledSkills = mode.capabilityFlags.skillIds.length;
  const activeAtoms = resolveModeAtoms(mode, atoms, "mode");
  const riskyNodes = mode.nodes.filter((node) => node.enabled && node.riskLevel);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">{translateCopy(language, "Run contract")}</p>
      <h4 className="mt-1 text-sm font-semibold">{translateCopy(language, "What the runtime promises")}</h4>
      <div className="mt-4 grid gap-3">
        <ContractRow
          icon={Users}
          label={translateCopy(language, "Owners")}
          value={mode.profiles.map((profile) => displayText(language, profile.label)).join(", ") || translateCopy(language, "Runtime default")}
        />
        <ContractRow
          icon={Layers3}
          label={translateCopy(language, "Capabilities")}
          value={activeAtoms.map((atom) => displayText(language, atom.label)).join(", ") || translateCopy(language, "none")}
        />
        <ContractRow
          icon={Terminal}
          label={translateCopy(language, "Tool envelope")}
          value={`${enabledTools} ${translateCopy(language, "tools")} · ${enabledSkills} ${translateCopy(language, "skills")}`}
        />
        <ContractRow
          icon={ShieldCheck}
          label={translateCopy(language, "Safety boundary")}
          value={`${formatEnumLabel(language, mode.capabilityFlags.approvalMode)} · ${riskyNodes.length} ${translateCopy(language, "risky stages")}`}
        />
        <ContractRow
          icon={Check}
          label={translateCopy(language, "Stops when")}
          value={describeStopPolicy(language, mode.stopPolicy)}
        />
        {executionPreview && executionPreview.disabledNodes.length > 0 && (
          <ContractRow
            icon={SlidersHorizontal}
            label={translateCopy(language, "Disabled stages")}
            value={executionPreview.disabledNodes.map((node) => displayText(language, node.label)).join(", ")}
          />
        )}
      </div>
    </div>
  );
}

function ContractRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Route;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-bench-200 bg-bench-50/80 px-3 py-3">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-bench-800 ring-1 ring-inset ring-bench-200">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-600">{label}</p>
        <p className="mt-1 text-sm leading-5 text-bench-900">{value}</p>
      </div>
    </div>
  );
}

function ModePurposePanel({
  mode,
  definition,
  language,
}: {
  mode: OraModeSpec;
  definition: ReturnType<typeof getPatternDefinition>;
  language: AppLanguage;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <h4 className="text-sm font-semibold">{translateCopy(language, "Mode fit")}</h4>
      <div className="mt-3 grid gap-3 text-sm leading-6 text-bench-700">
        <p>{translateCopy(language, "Use:")} {displayText(language, mode.recommendedUse ?? definition.recommendedUse)}</p>
        <p>{translateCopy(language, "Failure:")} {displayText(language, mode.failureMode ?? definition.failureMode)}</p>
      </div>
    </div>
  );
}

function StageExplanationPanel({
  mode,
  node,
  atoms,
  language,
}: {
  mode: OraModeSpec;
  node: OraModeSpec["nodes"][number];
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  language: AppLanguage;
}) {
  const owner = ownerDisplayName(mode, node, language);
  const nodeAtoms = resolveNodeAtoms(node, atoms);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">{translateCopy(language, "Selected stage")}</p>
      <h4 className="mt-1 text-base font-semibold">{displayText(language, node.label)}</h4>
      <p className="mt-3 text-sm leading-6 text-bench-700">{nodeStoryDescription(language, mode, node)}</p>
      <div className="mt-4 grid gap-2 text-sm text-bench-800">
        <p><span className="font-semibold">{translateCopy(language, "Owner:")}</span> {owner}</p>
        <p><span className="font-semibold">{translateCopy(language, "Template:")}</span> {formatEnumLabel(language, node.template)}</p>
        <p><span className="font-semibold">{translateCopy(language, "Stage instructions:")}</span> {stageInstructionsPreview(language, mode.family, node)}</p>
        <p><span className="font-semibold">{translateCopy(language, "Attached capabilities:")}</span> {nodeAtoms.map((atom) => displayText(language, atom.label)).join(", ") || translateCopy(language, "none")}</p>
        <p><span className="font-semibold">{translateCopy(language, "Failure handling:")}</span> {stageFailureSummary(language, mode, node)}</p>
      </div>
    </div>
  );
}

function ReadOnlyAgentsPanel({
  mode,
  language,
}: {
  mode: OraModeSpec;
  language: AppLanguage;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <h4 className="text-sm font-semibold">{translateCopy(language, "Agent roster")}</h4>
      <div className="mt-4 grid gap-3">
        {mode.profiles.map((profile) => (
          <div key={profile.id} className="rounded-lg border border-bench-200 bg-bench-50 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-bench-950">{displayText(language, profile.label)}</p>
              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-bench-700 ring-1 ring-inset ring-bench-200">{profile.id}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-bench-700">{displayText(language, profile.role)}</p>
            {profile.customAgentId && (
              <p className="mt-2 text-[11px] font-medium text-bench-600">{translateCopy(language, "Bound saved agent:")} {profile.customAgentId}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadOnlyCapabilitiesPanel({
  mode,
  atoms,
  language,
}: {
  mode: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  language: AppLanguage;
}) {
  const modeAtoms = resolveModeAtoms(mode, atoms, "mode");
  const nodeAtoms = resolveModeAtoms(mode, atoms, "node");

  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <h4 className="text-sm font-semibold">{translateCopy(language, "Runtime capabilities")}</h4>
      <CapabilityChipGroup title={translateCopy(language, "Mode capabilities")} atoms={modeAtoms} language={language} />
      <CapabilityChipGroup title={translateCopy(language, "Stage capabilities")} atoms={nodeAtoms} language={language} />
      <div className="mt-4 rounded-lg border border-bench-200 bg-bench-50 px-3 py-3 text-sm leading-6 text-bench-700">
        {translateCopy(language, "Mode capabilities mount on the runtime harness. Stage capabilities mount only on their source stage.")}
      </div>
    </div>
  );
}

function CapabilityChipGroup({
  title,
  atoms,
  language,
}: {
  title: string;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  language: AppLanguage;
}) {
  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {atoms.length > 0 ? atoms.map((atom) => (
          <span key={atom.id} className="rounded-full bg-bench-100 px-3 py-1 text-xs font-medium text-bench-800">
            {displayText(language, atom.label)}
          </span>
        )) : (
          <span className="text-sm text-bench-700">{translateCopy(language, "none")}</span>
        )}
      </div>
    </div>
  );
}

function ReadOnlySafetyPanel({
  mode,
  executionPreview,
  language,
}: {
  mode: OraModeSpec;
  executionPreview: ReturnType<typeof getExecutionPreview> | undefined;
  language: AppLanguage;
}) {
  const riskyNodes = mode.nodes.filter((node) => node.enabled && node.riskLevel);
  const recoveryEnabled = mode.runtimeAtoms.includes("recovery_policy");
  const memoryEnabled = mode.runtimeAtoms.includes("long_term_memory") && mode.memoryPolicy.enabled;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <h4 className="text-sm font-semibold">{translateCopy(language, "Safety and completion")}</h4>
      <div className="mt-4 grid gap-3 text-sm leading-6 text-bench-700">
        <p>{translateCopy(language, "Approval:")} {formatEnumLabel(language, mode.capabilityFlags.approvalMode)}</p>
        <p>{translateCopy(language, "Risky stages:")} {riskyNodes.length > 0 ? riskyNodes.map((node) => displayText(language, node.label)).join(", ") : translateCopy(language, "none")}</p>
        <p>{translateCopy(language, "Recovery:")} {translateCopy(language, recoveryEnabled ? "Enabled" : "Disabled")}</p>
        <p>{translateCopy(language, "Memory:")} {translateCopy(language, memoryEnabled ? "Enabled" : "Disabled")}</p>
        <p>{translateCopy(language, "Stop:")} {describeStopPolicy(language, mode.stopPolicy)}</p>
        {executionPreview && executionPreview.disabledNodes.length > 0 && (
          <p>{translateCopy(language, "Disabled stages:")} {executionPreview.disabledNodes.map((node) => displayText(language, node.label)).join(", ")}</p>
        )}
      </div>
    </div>
  );
}

function ModeSettingsPanel({
  draft,
  editingModeId,
  language,
  onPatchDraft,
}: {
  draft: OraModeSpec;
  editingModeId?: string;
  language: AppLanguage;
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <h4 className="text-sm font-semibold">{translateCopy(language, "Mode settings")}</h4>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-bench-700">Mode id</span>
          <input
            value={draft.id}
            disabled={Boolean(editingModeId)}
            onChange={(event) => onPatchDraft((current) => ({ ...current, id: event.target.value }))}
            className="h-10 rounded-md border border-bench-200 px-3 outline-none disabled:bg-bench-50"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-bench-700">Label</span>
          <input
            value={draft.label}
            onChange={(event) => onPatchDraft((current) => ({ ...current, label: event.target.value }))}
            className="h-10 rounded-md border border-bench-200 px-3 outline-none"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-bench-700">Summary</span>
          <textarea
            value={draft.summary}
            onChange={(event) => onPatchDraft((current) => ({ ...current, summary: event.target.value }))}
            rows={3}
            className="rounded-md border border-bench-200 px-3 py-2 outline-none"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-bench-700">Family</span>
          <Select
            aria-label="Mode family"
            value={draft.family}
            onChange={(event) => onPatchDraft((current) => resetModeDraftFamily(current, event.target.value as BuiltInCoordinationPattern))}
          >
            {BuiltInCoordinationPatternSchema.options.map((family) => (
              <option key={family} value={family}>{family}</option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-bench-700">Stop policy</span>
          <Select
            aria-label="Stop policy"
            value={draft.stopPolicy.type}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              stopPolicy: { ...current.stopPolicy, type: event.target.value as OraModeSpec["stopPolicy"]["type"] },
            }))}
          >
            {draft.editorConstraints.allowedNodeTemplates.length > 0 && getPatternDefinition(draft.family) && (
              getModeStopPolicies(draft.family).map((type) => (
                <option key={type} value={type}>{type}</option>
              ))
            )}
          </Select>
        </label>
      </div>
    </div>
  );
}

function ModeAgentRosterPanel({
  draft,
  customAgents,
  language,
  onPatchDraft,
}: {
  draft: OraModeSpec;
  customAgents: OraCustomAgentSummary[];
  language: AppLanguage;
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Agents</p>
          <h4 className="mt-1 text-sm font-semibold">Team roster</h4>
        </div>
        <span className="rounded-full bg-bench-100 px-2.5 py-1 text-[11px] font-semibold text-bench-700">
          {draft.profiles.length}
        </span>
      </div>
      <div className="mt-4 grid gap-3">
        {draft.profiles.map((profile) => {
          const boundAgent = customAgents.find((agent) => agent.name === profile.customAgentId);
          return (
            <div key={profile.id} className="rounded-lg border border-bench-200 bg-bench-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-bench-900">{profile.label}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-bench-700">{profile.role}</p>
                  {profile.systemPrompt && (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-bench-600">{profile.systemPrompt}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-bench-700 ring-1 ring-inset ring-bench-200">
                  {profile.id}
                </span>
              </div>
              <Select
                aria-label={`Bind custom agent for ${profile.label}`}
                value={profile.customAgentId ?? ""}
                onChange={(event) => {
                  const customAgentId = event.target.value || undefined;
                  const agent = customAgents.find((item) => item.name === customAgentId);
                  onPatchDraft((current) => ({
                    ...current,
                    profiles: current.profiles.map((item) =>
                      item.id !== profile.id
                        ? item
                        : {
                            ...item,
                            customAgentId,
                            label: agent?.name ?? item.label,
                            role: agent?.description || item.role,
                            toolIds: agent?.toolIds ?? [],
                            skillIds: agent?.skillIds ?? [],
                          },
                    ),
                  }));
                }}
                className="mt-3"
              >
                <option value="">Use mode profile</option>
                {customAgents.map((agent) => (
                  <option key={agent.name} value={agent.name}>{agent.name}</option>
                ))}
              </Select>
              <label className="mt-3 grid gap-1 text-sm">
                <span className="text-bench-700">{translateCopy(language, "System prompt")}</span>
                <textarea
                  value={profile.systemPrompt ?? ""}
                  onChange={(event) => onPatchDraft((current) => ({
                    ...current,
                    profiles: current.profiles.map((item) =>
                      item.id === profile.id ? { ...item, systemPrompt: event.target.value || undefined } : item,
                    ),
                  }))}
                  rows={4}
                  className="rounded-md border border-bench-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-bench-500"
                  placeholder="Configure this agent's system prompt."
                />
              </label>
              <div className="mt-2 space-y-1 text-[11px] leading-5 text-bench-600">
                <p>Tools: {profile.toolIds.length > 0 ? profile.toolIds.join(", ") : "inherit mode tools"}</p>
                <p>Skills: {profile.skillIds.length > 0 ? profile.skillIds.join(", ") : "inherit mode skills"}</p>
                {boundAgent && <p>Bound to saved agent: {boundAgent.name}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModeCapabilityPanel({
  draft,
  atoms,
  language,
  onPatchDraft,
}: {
  draft: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  language: AppLanguage;
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
}) {
  const compatibleAtoms = atoms.filter((atom) => atom.scope === "mode" && atom.compatibleFamilies.includes(draft.family));
  if (compatibleAtoms.length === 0) {
    return null;
  }

  const activeCount = compatibleAtoms.filter((atom) => draft.runtimeAtoms.includes(atom.id)).length;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Attached to Runtime</p>
          <h4 className="mt-1 text-sm font-semibold">Mode capabilities</h4>
        </div>
        <span className="rounded-full bg-bench-100 px-2.5 py-1 text-[11px] font-semibold text-bench-700">
          {activeCount}/{compatibleAtoms.length}
        </span>
      </div>

      <div className="mt-4 grid gap-2">
        {compatibleAtoms.map((atom) => {
          const active = draft.runtimeAtoms.includes(atom.id);
          const available = atomRequirementsSatisfied(draft, atom);
          return (
            <button
              key={atom.id}
              type="button"
              disabled={!available}
              onClick={() => onPatchDraft((current) => ({
                ...current,
                runtimeAtoms: active
                  ? current.runtimeAtoms.filter((atomId) => atomId !== atom.id)
                  : [...new Set([...current.runtimeAtoms, atom.id])],
              }))}
              className={cn(
                "flex min-h-[4rem] w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition active:scale-[0.99]",
                active
                  ? "border-sky-200 bg-sky-50 text-slate-950"
                  : "border-bench-200 bg-white text-bench-800 hover:bg-bench-50",
                !available && "cursor-not-allowed opacity-50 hover:bg-white",
              )}
            >
              <span className={cn(
                "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                active ? "bg-sky-600 text-white" : "bg-bench-100 text-bench-700",
              )}>
                {active ? "ON" : "OFF"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-sm font-semibold">{displayText(language, atom.label)}</span>
                <span className="mt-1 block text-xs leading-5 text-bench-700">{displayText(language, atom.description)}</span>
                <span className="mt-2 block text-[11px] font-medium text-bench-600">
                  {translateCopy(language, "Attached to Runtime")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceToolsPanel({
  draft,
  toolRegistry,
  onPatchDraft,
}: {
  draft: OraModeSpec;
  toolRegistry: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["toolRegistry"];
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
}) {
  const toolIcons = {
    "file.read": FileText,
    "file.list": ListTree,
    "file.glob": Search,
    "file.grep": Search,
    "file.write": PencilLine,
    "file.patch": PencilLine,
    "shell.execute": Terminal,
    "web.fetch": Globe,
    "web.search": Globe,
    "mcp.listTools": Plug,
    "mcp.readResource": Plug,
    "mcp.call": Plug,
  };
  const tools = toolRegistry.tools
    .filter((tool) => tool.implemented !== false)
    .filter((tool) => ["file", "shell", "network", "mcp", "package"].includes(tool.category))
    .map((tool) => ({
      ...tool,
      icon: toolIcons[tool.id as keyof typeof toolIcons] ?? FileText,
    }));
  const groupedTools = [
    { risk: "safe", label: "Safe", tools: tools.filter((tool) => tool.riskLevel === "safe") },
    { risk: "low_risk", label: "Low risk", tools: tools.filter((tool) => tool.riskLevel === "low_risk") },
    { risk: "requires_approval", label: "Approval", tools: tools.filter((tool) => tool.riskLevel === "requires_approval") },
  ].filter((group) => group.tools.length > 0);

  if (tools.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Workspace tools</p>
          <h4 className="mt-1 text-sm font-semibold">Project folder access</h4>
        </div>
        <span className="rounded-full bg-bench-100 px-2.5 py-1 text-[11px] font-semibold text-bench-700">
          {draft.capabilityFlags.toolIds.filter((toolId) => tools.some((tool) => tool.id === toolId)).length}/{tools.length}
        </span>
      </div>

      <div className="mt-4 grid gap-4">
        {groupedTools.map((group) => (
          <div key={group.risk} className="grid gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-bench-500">{group.label}</p>
            {group.tools.map((tool) => {
              const active = draft.capabilityFlags.toolIds.includes(tool.id);
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => onPatchDraft((current) => ({
                    ...current,
                    capabilityFlags: {
                      ...current.capabilityFlags,
                      toolIds: active
                        ? current.capabilityFlags.toolIds.filter((toolId) => toolId !== tool.id)
                        : [...new Set([...current.capabilityFlags.toolIds, tool.id])],
                    },
                  }))}
                  className={cn(
                    "flex min-h-[4.5rem] w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition active:scale-[0.99]",
                    active
                      ? "border-bench-400 bg-bench-50 text-bench-950"
                      : "border-bench-200 bg-white text-bench-800 hover:bg-bench-50",
                  )}
                >
                  <span className={cn(
                    "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    active ? "bg-bench-900 text-white" : "bg-bench-100 text-bench-700",
                  )}>
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{tool.label}</span>
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                        active ? "bg-emerald-100 text-emerald-900" : "bg-bench-100 text-bench-600",
                      )}>
                        {active ? "on" : "off"}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-bench-700">{tool.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function RuntimeStrategyPolicyPanel({
  draft,
  onPatchDraft,
}: {
  draft: OraModeSpec;
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Runtime strategy</p>
          <h4 className="mt-1 text-sm font-semibold">Derived thinking policy</h4>
        </div>
        <span className="rounded-full bg-bench-100 px-2.5 py-1 text-[11px] font-semibold text-bench-700">
          {draft.runtimePolicy.budgetProfile}
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs text-bench-700">
          <span>Thinking depth</span>
          <Select
            aria-label="Thinking depth"
            value={draft.runtimePolicy.thinking}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              runtimePolicy: {
                ...current.runtimePolicy,
                thinking: event.target.value as OraModeSpec["runtimePolicy"]["thinking"],
                reasoningEffort: event.target.value === "off" ? "none" : current.runtimePolicy.reasoningEffort,
                providerThinking: event.target.value === "off" ? "disabled" : current.runtimePolicy.providerThinking,
              },
            }))}
            className="h-9 bg-white text-sm"
          >
            <option value="off">Off</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
          </Select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-bench-700">
            <span>Reasoning effort</span>
            <Select
              aria-label="Reasoning effort"
              value={draft.runtimePolicy.reasoningEffort}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                runtimePolicy: {
                  ...current.runtimePolicy,
                  reasoningEffort: event.target.value as OraModeSpec["runtimePolicy"]["reasoningEffort"],
                },
              }))}
              className="h-9 bg-white text-sm"
            >
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </label>

          <label className="grid gap-1 text-xs text-bench-700">
            <span>Budget profile</span>
            <Select
              aria-label="Budget profile"
              value={draft.runtimePolicy.budgetProfile}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                runtimePolicy: {
                  ...current.runtimePolicy,
                  budgetProfile: event.target.value as OraModeSpec["runtimePolicy"]["budgetProfile"],
                },
              }))}
              className="h-9 bg-white text-sm"
            >
              <option value="fast">Fast</option>
              <option value="balanced">Balanced</option>
              <option value="deep">Deep</option>
            </Select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-xs text-bench-700">
            <span>Planning</span>
            <Select
              aria-label="Planning"
              value={draft.runtimePolicy.planning}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                runtimePolicy: {
                  ...current.runtimePolicy,
                  planning: event.target.value as OraModeSpec["runtimePolicy"]["planning"],
                },
              }))}
              className="h-9 bg-white text-sm"
            >
              <option value="none">None</option>
              <option value="light">Light</option>
              <option value="explicit">Explicit</option>
            </Select>
          </label>

          <label className="grid gap-1 text-xs text-bench-700">
            <span>Delegation</span>
            <Select
              aria-label="Delegation"
              value={draft.runtimePolicy.delegation}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                runtimePolicy: {
                  ...current.runtimePolicy,
                  delegation: event.target.value as OraModeSpec["runtimePolicy"]["delegation"],
                },
              }))}
              className="h-9 bg-white text-sm"
            >
              <option value="none">None</option>
              <option value="allowed">Allowed</option>
              <option value="preferred">Preferred</option>
            </Select>
          </label>

          <label className="grid gap-1 text-xs text-bench-700">
            <span>Provider thinking</span>
            <Select
              aria-label="Provider thinking"
              value={draft.runtimePolicy.providerThinking}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                runtimePolicy: {
                  ...current.runtimePolicy,
                  providerThinking: event.target.value as OraModeSpec["runtimePolicy"]["providerThinking"],
                },
              }))}
              className="h-9 bg-white text-sm"
            >
              <option value="disabled">Disabled</option>
              <option value="auto">Auto</option>
              <option value="required">Required</option>
            </Select>
          </label>
        </div>
      </div>
    </div>
  );
}

function CompletionPolicyPanel({
  draft,
  onPatchDraft,
}: {
  draft: OraModeSpec;
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
}) {
  const loopGuardEnabled = draft.runtimeAtoms.includes("loop_guard");

  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Completion</p>
          <h4 className="mt-1 text-sm font-semibold">Answer control</h4>
        </div>
        <button
          type="button"
          onClick={() => onPatchDraft((current) => ({
            ...current,
            runtimeAtoms: current.runtimeAtoms.includes("loop_guard")
              ? current.runtimeAtoms.filter((atomId) => atomId !== "loop_guard")
              : [...current.runtimeAtoms, "loop_guard"],
          }))}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition",
            loopGuardEnabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-bench-200 bg-white text-bench-700 hover:bg-bench-50",
          )}
        >
          <Check size={13} />
          {loopGuardEnabled ? "On" : "Off"}
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs text-bench-700">
          <span>Preset</span>
          <Select
            aria-label="Completion preset"
            value={draft.completionPolicy.preset}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              completionPolicy: completionPolicyForPreset(event.target.value as OraModeSpec["completionPolicy"]["preset"]),
            }))}
            className="h-9 bg-white text-sm"
          >
            <option value="decisive">Decisive</option>
            <option value="balanced">Balanced</option>
            <option value="persistent">Persistent</option>
          </Select>
        </label>

        <label className="grid gap-1 text-xs text-bench-700">
          <span>Max tool calls</span>
          <input
            type="number"
            min={0}
            value={draft.defaultBudget.maxToolCalls}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              defaultBudget: {
                ...current.defaultBudget,
                maxToolCalls: Math.max(0, Number(event.target.value) || 0),
              },
            }))}
            className="h-9 rounded-md border border-bench-200 px-2 text-sm outline-none"
          />
        </label>

        {loopGuardEnabled && (
          <div className="grid gap-3 rounded-lg border border-bench-200 bg-bench-50/70 p-3">
            <label className="grid gap-1 text-xs text-bench-700">
              <span>Duplicate tolerance</span>
              <input
                type="number"
                min={1}
                max={50}
                value={draft.completionPolicy.maxRepeatedToolCalls}
                onChange={(event) => onPatchDraft((current) => ({
                  ...current,
                  completionPolicy: {
                    ...current.completionPolicy,
                    maxRepeatedToolCalls: Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                  },
                }))}
                className="h-9 rounded-md border border-bench-200 bg-white px-2 text-sm outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-bench-700">
              <Checkbox
                checked={draft.completionPolicy.forceFinalOnRepeatedTool}
                onChange={(event) => onPatchDraft((current) => ({
                  ...current,
                  completionPolicy: {
                    ...current.completionPolicy,
                    forceFinalOnRepeatedTool: event.target.checked,
                  },
                }))}
              />
              Force final after repeated tools
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-bench-700">
              <Checkbox
                checked={draft.completionPolicy.forceFinalOnBudgetExhausted}
                onChange={(event) => onPatchDraft((current) => ({
                  ...current,
                  completionPolicy: {
                    ...current.completionPolicy,
                    forceFinalOnBudgetExhausted: event.target.checked,
                  },
                }))}
              />
              Force final when budget is exhausted
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-bench-700">
              <Checkbox
                checked={draft.completionPolicy.allowToolCallsAfterUsefulResult}
                onChange={(event) => onPatchDraft((current) => ({
                  ...current,
                  completionPolicy: {
                    ...current.completionPolicy,
                    allowToolCallsAfterUsefulResult: event.target.checked,
                  },
                }))}
              />
              Allow more tools after a useful result
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryPolicyPanel({
  draft,
  onPatchDraft,
}: {
  draft: OraModeSpec;
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
}) {
  const memoryAtom: OraModeSpec["runtimeAtoms"][number] = "long_term_memory";
  const memoryEnabled = draft.runtimeAtoms.includes("long_term_memory") && draft.memoryPolicy.enabled;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Memory</p>
          <h4 className="mt-1 text-sm font-semibold">Long-term memory policy</h4>
        </div>
        <button
          type="button"
          onClick={() => onPatchDraft((current) => {
            const nextEnabled = !(current.runtimeAtoms.includes(memoryAtom) && current.memoryPolicy.enabled);
            return {
              ...current,
              runtimeAtoms: nextEnabled
                ? [...new Set([...current.runtimeAtoms, memoryAtom])]
                : current.runtimeAtoms.filter((atomId) => atomId !== memoryAtom),
              memoryPolicy: {
                ...current.memoryPolicy,
                enabled: nextEnabled,
              },
            };
          })}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition",
            memoryEnabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-bench-200 bg-white text-bench-700 hover:bg-bench-50",
          )}
        >
          <Database size={13} />
          {memoryEnabled ? "On" : "Off"}
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-xs text-bench-700">
          <span>Updater</span>
          <Select
            aria-label="Memory updater"
            value={draft.memoryPolicy.updater}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              memoryPolicy: {
                ...current.memoryPolicy,
                updater: event.target.value as OraModeSpec["memoryPolicy"]["updater"],
              },
            }))}
            className="h-9 text-sm"
          >
            <option value="provider">provider JSON patch</option>
            <option value="heuristic">heuristic fallback</option>
          </Select>
        </label>

        <label className="grid gap-1 text-xs text-bench-700">
          <span>Updater provider id</span>
          <input
            value={draft.memoryPolicy.updaterProviderId ?? ""}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              memoryPolicy: {
                ...current.memoryPolicy,
                updaterProviderId: event.target.value.trim() || undefined,
              },
            }))}
            placeholder="inherit selected provider"
            className="h-9 rounded-md border border-bench-200 px-2 text-sm outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs text-bench-700">
            <span>Debounce ms</span>
            <input
              type="number"
              min={0}
              max={60000}
              value={draft.memoryPolicy.debounceMs}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                memoryPolicy: {
                  ...current.memoryPolicy,
                  debounceMs: Math.max(0, Math.min(60000, Number(event.target.value) || 0)),
                },
              }))}
              className="h-9 rounded-md border border-bench-200 px-2 text-sm outline-none"
            />
          </label>
          <label className="grid gap-1 text-xs text-bench-700">
            <span>Confidence</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={draft.memoryPolicy.factConfidenceThreshold}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                memoryPolicy: {
                  ...current.memoryPolicy,
                  factConfidenceThreshold: Math.max(0, Math.min(1, Number(event.target.value) || 0)),
                },
              }))}
              className="h-9 rounded-md border border-bench-200 px-2 text-sm outline-none"
            />
          </label>
          <label className="grid gap-1 text-xs text-bench-700">
            <span>Max facts</span>
            <input
              type="number"
              min={1}
              max={500}
              value={draft.memoryPolicy.maxFacts}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                memoryPolicy: {
                  ...current.memoryPolicy,
                  maxFacts: Math.max(1, Math.min(500, Number(event.target.value) || 1)),
                },
              }))}
              className="h-9 rounded-md border border-bench-200 px-2 text-sm outline-none"
            />
          </label>
          <label className="grid gap-1 text-xs text-bench-700">
            <span>Inject facts</span>
            <input
              type="number"
              min={1}
              max={100}
              value={draft.memoryPolicy.injectionMaxFacts}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                memoryPolicy: {
                  ...current.memoryPolicy,
                  injectionMaxFacts: Math.max(1, Math.min(100, Number(event.target.value) || 1)),
                },
              }))}
              className="h-9 rounded-md border border-bench-200 px-2 text-sm outline-none"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function RecoveryPolicyPanel({
  draft,
  onPatchDraft,
}: {
  draft: OraModeSpec;
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
}) {
  const recoveryEnabled = draft.runtimeAtoms.includes("recovery_policy");
  const enabledTools = draft.capabilityFlags.toolIds;
  const nodeTemplates = [...new Set(draft.nodes.map((node) => node.template))];

  return (
    <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Recovery</p>
          <h4 className="mt-1 text-sm font-semibold">Runtime policy</h4>
        </div>
        <button
          type="button"
          onClick={() => onPatchDraft((current) => ({
            ...current,
            runtimeAtoms: current.runtimeAtoms.includes("recovery_policy")
              ? current.runtimeAtoms.filter((atomId) => atomId !== "recovery_policy")
              : [...current.runtimeAtoms, "recovery_policy"],
          }))}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition",
            recoveryEnabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-bench-200 bg-white text-bench-700 hover:bg-bench-50",
          )}
        >
          <Check size={13} />
          {recoveryEnabled ? "On" : "Off"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-xs text-bench-700">
          <span>Attempts</span>
          <input
            type="number"
            min={0}
            value={draft.recoveryPolicy.defaults.maxAttempts}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              recoveryPolicy: {
                ...current.recoveryPolicy,
                defaults: {
                  ...current.recoveryPolicy.defaults,
                  maxAttempts: Math.max(0, Number(event.target.value) || 0),
                },
              },
            }))}
            className="h-9 rounded-md border border-bench-200 px-2 text-sm outline-none"
          />
        </label>
        <label className="grid gap-1 text-xs text-bench-700">
          <span>Backoff ms</span>
          <input
            type="number"
            min={0}
            value={draft.recoveryPolicy.defaults.backoffMs}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              recoveryPolicy: {
                ...current.recoveryPolicy,
                defaults: {
                  ...current.recoveryPolicy.defaults,
                  backoffMs: Math.max(0, Number(event.target.value) || 0),
                },
              },
            }))}
            className="h-9 rounded-md border border-bench-200 px-2 text-sm outline-none"
          />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs font-medium text-bench-700">
        <Checkbox
          checked={draft.recoveryPolicy.defaults.fallbackArtifact}
          onChange={(event) => onPatchDraft((current) => ({
            ...current,
            recoveryPolicy: {
              ...current.recoveryPolicy,
              defaults: {
                ...current.recoveryPolicy.defaults,
                fallbackArtifact: event.target.checked,
              },
            },
          }))}
        />
        Degraded artifact
      </label>

      <div className="mt-5 grid gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-bench-500">Rules</p>
          <button
            type="button"
            onClick={() => onPatchDraft((current) => ({
              ...current,
              recoveryPolicy: {
                ...current.recoveryPolicy,
                rules: [
                  ...current.recoveryPolicy.rules,
                  {
                    id: `custom-${current.recoveryPolicy.rules.length + 1}`,
                    enabled: true,
                    errorTypes: ["tool_error"],
                    nodeIds: [],
                    nodeTemplates: [],
                    toolIds: [],
                    action: "fallback_artifact",
                    alternateToolIds: [],
                    skipAllowed: false,
                  },
                ],
              },
            }))}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold text-bench-800 transition hover:bg-bench-50"
          >
            <Plus size={13} />
            Add
          </button>
        </div>

        {draft.recoveryPolicy.rules.map((rule, index) => (
          <div key={rule.id} className="grid gap-3 rounded-lg border border-bench-200 bg-bench-50/70 p-3">
            <div className="flex items-center gap-2">
              <input
                value={rule.id}
                onChange={(event) => onPatchDraft((current) => ({
                  ...current,
                  recoveryPolicy: {
                    ...current.recoveryPolicy,
                    rules: current.recoveryPolicy.rules.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, id: event.target.value } : item,
                    ),
                  },
                }))}
                className="h-8 min-w-0 flex-1 rounded-md border border-bench-200 px-2 text-xs outline-none"
              />
              <button
                type="button"
                onClick={() => onPatchDraft((current) => ({
                  ...current,
                  recoveryPolicy: {
                    ...current.recoveryPolicy,
                    rules: current.recoveryPolicy.rules.filter((_item, itemIndex) => itemIndex !== index),
                  },
                }))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-bench-200 bg-white text-bench-700 transition hover:bg-bench-50"
                title="Delete rule"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                aria-label="Recovery error type"
                value={rule.errorTypes[0] ?? "tool_error"}
                onChange={(event) => onPatchRecoveryRule(onPatchDraft, index, { errorTypes: [event.target.value as OraModeSpec["recoveryPolicy"]["rules"][number]["errorTypes"][number]] })}
                className="h-8 bg-white text-xs"
              >
                {RecoveryErrorTypeSchema.options.map((errorType) => (
                  <option key={errorType} value={errorType}>{errorType}</option>
                ))}
              </Select>
              <Select
                aria-label="Recovery action"
                value={rule.action}
                onChange={(event) => onPatchRecoveryRule(onPatchDraft, index, { action: event.target.value as OraModeSpec["recoveryPolicy"]["rules"][number]["action"] })}
                className="h-8 bg-white text-xs"
              >
                {RecoveryActionSchema.options.map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </Select>
              <Select
                aria-label="Recovery node template"
                value={rule.nodeTemplates[0] ?? ""}
                onChange={(event) => onPatchRecoveryRule(onPatchDraft, index, { nodeTemplates: event.target.value ? [event.target.value] : [] })}
                className="h-8 bg-white text-xs"
              >
                <option value="">any node</option>
                {nodeTemplates.map((template) => (
                  <option key={template} value={template}>{template}</option>
                ))}
              </Select>
              <Select
                aria-label="Recovery alternate tool"
                value={rule.alternateToolIds[0] ?? ""}
                onChange={(event) => onPatchRecoveryRule(onPatchDraft, index, { alternateToolIds: event.target.value ? [event.target.value] : [] })}
                className="h-8 bg-white text-xs"
              >
                <option value="">no alternate</option>
                {enabledTools.map((toolId) => (
                  <option key={toolId} value={toolId}>{toolId}</option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs text-bench-700">
              <Checkbox
                checked={rule.skipAllowed}
                onChange={(event) => onPatchRecoveryRule(onPatchDraft, index, { skipAllowed: event.target.checked })}
              />
              Skip allowed
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function onPatchRecoveryRule(
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void,
  index: number,
  patch: Partial<OraModeSpec["recoveryPolicy"]["rules"][number]>,
) {
  onPatchDraft((current) => ({
    ...current,
    recoveryPolicy: {
      ...current.recoveryPolicy,
      rules: current.recoveryPolicy.rules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    },
  }));
}

function ModeSummaryCards({
  mode,
  atoms,
  definition,
  executionPreview,
  language,
}: {
  mode: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  definition: ReturnType<typeof getPatternDefinition> | undefined;
  executionPreview: ReturnType<typeof getExecutionPreview> | undefined;
  language: AppLanguage;
}) {
  const activeModeAtoms = resolveModeAtoms(mode, atoms, "mode");
  const activeNodeAtoms = resolveModeAtoms(mode, atoms, "node");
  const riskyNodes = mode.nodes.filter((node) => node.enabled && node.riskLevel);

  return (
    <>
      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <h4 className="text-sm font-semibold">Runtime defaults</h4>
        <div className="mt-3 grid gap-3 text-sm text-bench-700">
          <p>{translateCopy(language, "Approval:")} {formatEnumLabel(language, mode.capabilityFlags.approvalMode)}</p>
          <p>
            {translateCopy(language, "Risky stages:")} {riskyNodes.length > 0
              ? riskyNodes.map((node) => `${displayText(language, node.label)} (${formatRiskLabel(language, node.riskLevel!)})`).join(", ")
              : translateCopy(language, "none")}
          </p>
          <p>{translateCopy(language, "Skills:")} {mode.capabilityFlags.skillIds.join(", ") || translateCopy(language, "none")}</p>
          <p>{translateCopy(language, "Tools:")} {mode.capabilityFlags.toolIds.join(", ") || translateCopy(language, "none")}</p>
          <p>{translateCopy(language, "Stop policy:")} {formatStopPolicy(language, mode.stopPolicy)}</p>
          <p>
            {translateCopy(language, "Completion:")} {formatEnumLabel(language, mode.completionPolicy.preset)} · {mode.defaultBudget.maxToolCalls} {translateCopy(language, "tools")} · {translateCopy(language, "duplicate tolerance")} {mode.completionPolicy.maxRepeatedToolCalls}
          </p>
          <p>
            Strategy: {formatEnumLabel(language, mode.runtimePolicy.thinking)} · {formatEnumLabel(language, mode.runtimePolicy.reasoningEffort)} reasoning · {formatEnumLabel(language, mode.runtimePolicy.planning)} planning · {formatEnumLabel(language, mode.runtimePolicy.delegation)} delegation
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <h4 className="text-sm font-semibold">Atoms</h4>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Mode atoms</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeModeAtoms.length > 0 ? activeModeAtoms.map((atom) => (
                <span key={atom.id} className="rounded-full bg-bench-100 px-3 py-1 text-xs font-medium text-bench-800">
                  {displayText(language, atom.label)}
                </span>
              )) : (
                <span className="text-sm text-bench-700">{translateCopy(language, "none")}</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Stage atoms</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeNodeAtoms.length > 0 ? activeNodeAtoms.map((atom) => (
                <span key={atom.id} className="rounded-full bg-bench-100 px-3 py-1 text-xs font-medium text-bench-800">
                  {displayText(language, atom.label)}
                </span>
              )) : (
                <span className="text-sm text-bench-700">{translateCopy(language, "none")}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {definition && (
        <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
          <h4 className="text-sm font-semibold">Details</h4>
          <div className="mt-3 grid gap-3 text-sm text-bench-700">
            <p>{translateCopy(language, "Use:")} {displayText(language, mode.recommendedUse ?? definition.recommendedUse)}</p>
            <p>{translateCopy(language, "Failure:")} {displayText(language, mode.failureMode ?? definition.failureMode)}</p>
            <p>{translateCopy(language, "Stop:")} {describeStopPolicy(language, mode.stopPolicy)}</p>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <h4 className="text-sm font-semibold">Rules</h4>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-bench-800">
          <span className="rounded-full bg-bench-100 px-3 py-1">Required nodes locked</span>
          <span className="rounded-full bg-bench-100 px-3 py-1">Family-safe templates only</span>
          <span className="rounded-full bg-bench-100 px-3 py-1">Cycles blocked before save</span>
          <span className="rounded-full bg-bench-100 px-3 py-1">Layout stored per node</span>
        </div>
      </div>

      {executionPreview && (
        <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
          <h4 className="text-sm font-semibold">Execution preview</h4>
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-bench-200 bg-bench-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Enabled stages</div>
              <div className="mt-3 space-y-2">
                {executionPreview.nodes.map((node, index) => (
                  <div
                    key={node.id}
                    className={cn(
                      "rounded-lg border bg-white px-3 py-2 text-sm text-bench-900",
                      node.riskLevel ? riskSurfaceClassName(node.riskLevel) : "border-bench-200",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>{index + 1}. {displayText(language, node.label)} · {formatEnumLabel(language, node.template)}</span>
                      {node.riskLevel ? (
                        <span className={cn(
                          "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
                          riskBadgeClassName(node.riskLevel),
                        )}>
                          {formatRiskLabel(language, node.riskLevel)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {executionPreview.nodes.length === 0 && (
                  <p className="text-sm text-bench-700">{translateCopy(language, "No enabled stages.")}</p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-bench-200 bg-bench-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Active edges</div>
              <div className="mt-3 space-y-2">
                {executionPreview.edges.map((edge) => (
                  <div key={edge.id} className="rounded-lg border border-bench-200 bg-white px-3 py-2 text-sm text-bench-900">
                    {displayText(language, edge.source)} → {displayText(language, edge.target)}
                  </div>
                ))}
                {executionPreview.edges.length === 0 && (
                  <p className="text-sm text-bench-700">{translateCopy(language, "A single enabled stage does not create an active edge.")}</p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-bench-200 bg-bench-50 p-4 text-sm leading-6 text-bench-700">
              <p>{translateCopy(language, "Behavior:")} {describeStopPolicy(language, mode.stopPolicy)}</p>
              {executionPreview.disabledNodes.length > 0 && (
                <p className="mt-2">{translateCopy(language, "Disabled stages:")} {executionPreview.disabledNodes.map((node) => displayText(language, node.label)).join(", ")}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {executionPreview?.preview && executionPreview.preview.warnings.length > 0 && (
        <div className="rounded-2xl bg-amber-50 p-5 shadow-pane ring-1 ring-inset ring-amber-200">
          <h4 className="text-sm font-semibold text-amber-900">Runtime compatibility warnings</h4>
          <div className="mt-3 space-y-2">
            {executionPreview.preview.warnings.map((warning, index) => (
              <div key={index} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800">
                {warning}
              </div>
            ))}
          </div>
          {executionPreview.preview.conditionalEdges.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-amber-700">
                Conditional edges ({executionPreview.preview.conditionalEdges.filter(e => !e.consumed).length} of {executionPreview.preview.conditionalEdges.length} will be ignored)
              </p>
              <div className="mt-2 space-y-1">
                {executionPreview.preview.conditionalEdges.map((edge) => (
                  <div key={edge.id} className={cn(
                    "rounded border px-2 py-1 text-xs",
                    edge.consumed ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800",
                  )}>
                    {edge.source} → {edge.target}: {edge.condition}
                    {!edge.consumed && " (ignored at runtime)"}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function NodeInspector({
  draft,
  node,
  atoms,
  customAgents,
  allowedTemplates,
  language,
  onPatchNode,
  onDeleteNode,
}: {
  draft: OraModeSpec;
  node: OraModeSpec["nodes"][number];
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  customAgents: OraCustomAgentSummary[];
  allowedTemplates: OraModeSpec["editorConstraints"]["allowedNodeTemplates"];
  language: AppLanguage;
  onPatchNode: (updater: (current: OraModeSpec["nodes"][number]) => OraModeSpec["nodes"][number]) => void;
  onDeleteNode: () => void;
}) {
  const definition = getModeNodeRuntimeTemplateDefinition(draft.family, node.template);
  const canDisable = canDisableModeNode(draft, node.id);
  const canDelete = canDeleteModeNode(draft, node.id);
  const nodeAtoms = resolveNodeAtoms(node, atoms);
  const compatibleNodeAtoms = atoms.filter((atom) => atom.scope === "node" && atom.compatibleFamilies.includes(draft.family));
  const ownerProfile = draft.profiles.find((profile) => profile.id === node.ownerAgentId);
  const ownerCustomAgent = customAgents.find((agent) => agent.name === ownerProfile?.customAgentId);

  return (
    <>
      <StageExplanationPanel mode={draft} node={node} atoms={atoms} language={language} />

      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Inspector</p>
            <h4 className="mt-1 text-base font-semibold">{displayText(language, node.label)}</h4>
          </div>
          <div className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold",
            node.enabled ? "bg-emerald-100 text-emerald-900" : "bg-bench-100 text-bench-700",
          )}>
            {translateCopy(language, node.enabled ? "Enabled" : "Disabled")}
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-bench-700">Label</span>
            <input
              value={node.label}
              onChange={(event) => onPatchNode((current) => ({ ...current, label: event.target.value, title: event.target.value }))}
              className="h-10 rounded-md border border-bench-200 px-3 outline-none"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-bench-700">Template</span>
            <Select
              aria-label="Node template"
              value={node.template}
              onChange={(event) => onPatchNode((current) => ({
                ...current,
                template: event.target.value as OraModeSpec["nodes"][number]["template"],
              }))}
            >
              {allowedTemplates.map((template) => (
                <option key={template} value={template}>{template}</option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-bench-700">Owner agent</span>
            <Select
              aria-label="Owner agent"
              value={node.ownerAgentId ?? ""}
              onChange={(event) => onPatchNode((current) => ({ ...current, ownerAgentId: event.target.value || undefined }))}
            >
              <option value="">Runtime default</option>
              {draft.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label} ({profile.id})
                </option>
              ))}
            </Select>
            {ownerProfile && (
              <span className="text-xs leading-5 text-bench-600">
                {ownerCustomAgent
                  ? `Bound saved agent: ${ownerCustomAgent.name}`
                  : "Uses this mode profile without a saved-agent binding."}
              </span>
            )}
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-bench-700">Risk level</span>
            <Select
              aria-label="Node risk level"
              value={node.riskLevel ?? ""}
              onChange={(event) => onPatchNode((current) => ({
                ...current,
                riskLevel: event.target.value ? event.target.value as OraModeSpec["nodes"][number]["riskLevel"] : undefined,
              }))}
            >
              <option value="">runtime default</option>
              {ActionRiskLevelSchema.options.map((risk) => (
                <option key={risk} value={risk}>{formatEnumLabel(language, risk)}</option>
              ))}
            </Select>
          </label>
          <label className="inline-flex items-center justify-between rounded-xl border border-bench-200 bg-bench-50 px-3 py-3 text-sm">
            <span className="font-medium text-bench-800">Enabled</span>
            <Checkbox
              checked={node.enabled}
              disabled={!canDisable}
              onChange={(event) => onPatchNode((current) => ({ ...current, enabled: event.target.checked }))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-bench-700">{translateCopy(language, "Stage instructions")}</span>
            <textarea
              value={node.instructions ?? ""}
              onChange={(event) => onPatchNode((current) => ({ ...current, instructions: event.target.value || undefined }))}
              rows={4}
              className="rounded-md border border-bench-200 px-3 py-2 outline-none"
              placeholder={defaultRuntimeInstructionsPreview(language, draft.family, node.template)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-bench-700">Prompt override</span>
            <textarea
              value={node.prompt ?? ""}
              onChange={(event) => onPatchNode((current) => ({ ...current, prompt: event.target.value || undefined }))}
              rows={5}
              disabled={!definition.supportsPromptOverride}
              className="rounded-md border border-bench-200 px-3 py-2 outline-none disabled:bg-bench-50"
              placeholder={promptOverridePlaceholder(language, draft.family, node.template)}
            />
          </label>
          <div className="grid gap-1 text-sm">
            <span className="text-bench-700">Default runtime prompt</span>
            <div className="rounded-md border border-dashed border-bench-200 bg-bench-50 px-3 py-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-bench-800">
                {defaultRuntimePromptPreview(language, draft.family, node.template)}
              </pre>
            </div>
          </div>
          <div className="grid gap-2 text-sm">
            <span className="text-bench-700">Stage atoms</span>
            <div className="rounded-md border border-bench-200 bg-bench-50 px-3 py-3">
              <div className="flex flex-wrap gap-2">
                {compatibleNodeAtoms.map((atom) => {
                  const active = nodeAtoms.some((entry) => entry.id === atom.id);
                  const available = atomRequirementsSatisfied(draft, atom);
                  return (
                    <button
                      key={atom.id}
                      type="button"
                      disabled={!available}
                      onClick={() => onPatchNode((current) => ({
                        ...current,
                        config: {
                          ...current.config,
                          atoms: toggleNodeAtom(current, atom.id),
                        },
                      }))}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition",
                        active
                          ? "bg-bench-900 text-white ring-bench-900"
                          : "bg-white text-bench-800 ring-bench-200 hover:bg-bench-100",
                        !available && "cursor-not-allowed opacity-50 hover:bg-white",
                      )}
                    >
                      {displayText(language, atom.label)}
                    </button>
                  );
                })}
              </div>
              {compatibleNodeAtoms.length === 0 && (
                <p className="text-sm text-bench-700">{translateCopy(language, "No stage atoms are compatible with this family.")}</p>
              )}
            </div>
          </div>
          <p className="text-xs leading-5 text-bench-700">{promptOverrideHint(language, draft.family, node.template)}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <h4 className="text-sm font-semibold">Node actions</h4>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={onDeleteNode}
            disabled={!canDelete}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={14} />
            Delete node
          </button>
        </div>
      </div>
    </>
  );
}

function CapabilityInspector({
  mode,
  atom,
  sourceNode,
  language,
  onToggle,
}: {
  mode: OraModeSpec;
  atom: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"][number];
  sourceNode?: OraModeSpec["nodes"][number];
  language: AppLanguage;
  onToggle: () => void;
}) {
  const active = sourceNode
    ? resolveNodeAtoms(sourceNode, [atom]).length > 0
    : mode.runtimeAtoms.includes(atom.id);
  const available = atomRequirementsSatisfied(mode, atom);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">
              {translateCopy(language, sourceNode ? "Stage capability" : "Mode capability")}
            </p>
            <h4 className="mt-1 text-base font-semibold">{displayText(language, atom.label)}</h4>
          </div>
          <div className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold",
            active ? "bg-emerald-100 text-emerald-900" : "bg-bench-100 text-bench-700",
          )}>
            {translateCopy(language, active ? "Enabled" : "Disabled")}
          </div>
        </div>

        <p className="mt-3 text-sm leading-6 text-bench-700">{displayText(language, atom.description)}</p>
        {sourceNode && (
          <p className="mt-3 text-xs leading-5 text-bench-700">
            {translateCopy(language, "Attached stage:")} <span className="font-semibold text-bench-900">{displayText(language, sourceNode.label)}</span>
          </p>
        )}

        <div className="mt-4 grid gap-3 text-sm text-bench-700">
          <p>{translateCopy(language, "Presentation:")} {formatEnumLabel(language, atom.topology.presentation)}</p>
          <p>{translateCopy(language, "Edge:")} {formatEnumLabel(language, atom.topology.edgeKind)}{atom.topology.edgeLabel ? ` · ${displayText(language, atom.topology.edgeLabel)}` : ""}</p>
          <p>{translateCopy(language, "Requires tools:")} {atom.requiresTools.join(", ") || translateCopy(language, "none")}</p>
          <p>{translateCopy(language, "Requires flags:")} {atom.requiresFlags.join(", ") || translateCopy(language, "none")}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <h4 className="text-sm font-semibold">Capability action</h4>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!available}
            onClick={onToggle}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold transition",
              active
                ? "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                : "bg-bench-900 text-white hover:bg-bench-800",
              !available && "cursor-not-allowed opacity-50 hover:bg-white",
            )}
          >
            {translateCopy(language, active ? "Disable capability" : "Enable capability")}
          </button>
          {!available && (
            <p className="text-xs leading-5 text-amber-700">
              {translateCopy(language, "This capability is blocked until its required flags/tools are enabled.")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeCanvasNode({ data, selected }: NodeProps<ModeCanvasNodeData>) {
  const stageNode = data.kind === "stage";
  const runtimeAnchor = data.kind === "runtime-anchor";
  const runtimeCapabilityHandles = runtimeAnchor
    ? modeCapabilitySourceHandlePositions(data.capabilityCount ?? 1, data.capabilityColumns)
    : [];
  return (
    <div className={cn(
      "relative rounded-[1.25rem] border bg-white px-4 py-3 shadow-[0_18px_40px_-28px_rgba(17,24,39,0.45)] transition",
      stageNode
        ? "min-h-[152px] w-[248px]"
        : runtimeAnchor
          ? "min-h-[120px] w-[248px]"
          : data.kind === "node-attachment"
            ? "min-h-[118px] w-[184px]"
            : "min-h-[126px] w-[204px]",
      stageNode
        ? data.enabled
          ? cn("text-bench-950", data.riskLevel ? riskSurfaceClassName(data.riskLevel) : "border-bench-200")
          : "border-bench-200/80 bg-bench-100/90 text-bench-600 opacity-80"
        : runtimeAnchor
          ? "border-slate-300 bg-white text-slate-950"
        : data.active
          ? "border-sky-200 bg-sky-50 text-slate-950"
          : "border-dashed border-bench-300 bg-bench-100/90 text-bench-600",
      selected && "border-bench-500 shadow-[0_24px_56px_-30px_rgba(15,23,42,0.55)]",
    )}>
      {stageNode && data.enabled && data.riskLevel ? (
        <div
          className={cn(
            "absolute inset-x-4 top-0 h-1 rounded-b-full",
            riskAccentClassName(data.riskLevel),
          )}
        />
      ) : null}
      {stageNode && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            isConnectable={data.enabled}
            className="!h-3 !w-3 !border-2 !border-white !bg-bench-600"
          />
          <Handle
            type="source"
            position={Position.Right}
            isConnectable={data.enabled}
            className="!h-3 !w-3 !border-2 !border-white !bg-bench-600"
          />
        </>
      )}
      {runtimeCapabilityHandles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="source"
          position={Position.Bottom}
          isConnectable={false}
          style={{ left: `${handle.leftPercent}%` }}
          className="!h-3 !w-3 !border-2 !border-white !bg-slate-500"
        />
      ))}
      {(data.kind === "mode-capability" || data.kind === "node-attachment") && (
        <Handle
          id={data.kind === "mode-capability" ? MODE_CAPABILITY_TARGET_HANDLE_ID : undefined}
          type="target"
          position={Position.Top}
          isConnectable={false}
          className="!h-3 !w-3 !border-2 !border-white !bg-sky-500"
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-bench-600">
            {stageNode ? data.template : runtimeAnchor ? "runtime anchor" : data.atomPresentation?.replace(/_/g, " ") ?? "capability"}
          </div>
          <div className="mt-1 text-sm font-semibold leading-5">{data.label}</div>
          <div className="mt-2 text-xs text-bench-600">
            {stageNode
              ? data.ownerAgentId ?? "runtime-owned"
              : runtimeAnchor
                ? `${data.capabilityCount ?? 0} mounted capabilities`
              : data.sourceNodeId
                ? `attached to ${data.sourceNodeId}`
                : data.atomScope ?? "runtime"}
          </div>
        </div>
        <div className={cn(
          "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em]",
          stageNode
            ? data.enabled
              ? "bg-emerald-100 text-emerald-900"
              : "bg-bench-200 text-bench-700"
            : data.active
              ? "bg-sky-100 text-sky-900"
              : "bg-bench-200 text-bench-700",
        )}>
          {stageNode ? (data.enabled ? "live" : "off") : runtimeAnchor ? "root" : (data.active ? "on" : "off")}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-bench-600">
        <span className="rounded-full bg-bench-100 px-2.5 py-1">
          {stageNode ? (data.required ? "Required" : "Optional") : runtimeAnchor ? "Runtime" : (data.kind === "node-attachment" ? "Attachment" : "Capability")}
        </span>
        {stageNode && data.riskLevel && (
          <span className={cn(
            "rounded-full px-2.5 py-1 font-semibold uppercase tracking-[0.08em]",
            riskBadgeClassName(data.riskLevel),
          )}>
            {formatRiskLabel("en", data.riskLevel)}
          </span>
        )}
      </div>
    </div>
  );
}

function buildModeRunStory(
  mode: OraModeSpec,
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"],
  executionPreview: ReturnType<typeof getExecutionPreview>,
  language: AppLanguage,
) {
  const enabledNodes = executionPreview.nodes;
  const modeAtoms = resolveModeAtoms(mode, atoms, "mode");
  const steps: Array<{
    kind: string;
    title: string;
    description: string;
    meta: string[];
    riskLevel?: NonNullable<OraModeSpec["nodes"][number]["riskLevel"]>;
  }> = [
    {
      kind: translateCopy(language, "Input"),
      title: translateCopy(language, "User request enters the mode"),
      description: displayText(language, mode.summary) || translateCopy(language, "The runtime receives the request and applies this mode's default contract before work begins."),
      meta: [
        formatEnumLabel(language, mode.family),
        `${mode.profiles.length} ${translateCopy(language, "agents")}`,
      ],
    },
  ];

  const visibleNodes = enabledNodes.length <= 3
    ? enabledNodes
    : [enabledNodes[0], enabledNodes[Math.floor(enabledNodes.length / 2)], enabledNodes[enabledNodes.length - 1]];

  visibleNodes.forEach((node, index) => {
    const skippedCount = enabledNodes.length > 3 && index === 1 ? enabledNodes.length - 3 : 0;
    steps.push({
      kind: skippedCount > 0 ? translateCopy(language, "Middle") : translateCopy(language, "Stage"),
      title: skippedCount > 0
        ? translateCopy(language, "Middle stages coordinate the work")
        : displayText(language, node.label),
      description: skippedCount > 0
        ? translateCopy(language, `This section compresses ${skippedCount + 1} enabled stages so the operating path stays readable.`)
        : nodeStoryDescription(language, mode, node),
      meta: [
        ownerDisplayName(mode, node, language),
        formatEnumLabel(language, node.template),
        ...(node.riskLevel ? [formatRiskLabel(language, node.riskLevel)] : []),
      ],
      riskLevel: node.riskLevel,
    });
  });

  steps.push({
    kind: translateCopy(language, "Finish"),
    title: translateCopy(language, "Runtime stops and publishes the answer"),
    description: describeStopPolicy(language, mode.stopPolicy),
    meta: [
      `${mode.capabilityFlags.toolIds.length} ${translateCopy(language, "tools")}`,
      `${modeAtoms.length} ${translateCopy(language, "runtime capabilities")}`,
    ],
  });

  return steps.slice(0, 5);
}

function ownerDisplayName(mode: OraModeSpec, node: OraModeSpec["nodes"][number], language: AppLanguage): string {
  const ownerProfile = mode.profiles.find((profile) => profile.id === node.ownerAgentId);
  if (ownerProfile) {
    return displayText(language, ownerProfile.label);
  }
  return node.ownerAgentId ? displayText(language, node.ownerAgentId) : translateCopy(language, "Runtime default");
}

function ownerForStage(mode: OraModeSpec, stage: NonNullable<OraModeSpec["stages"]>[number]): string | undefined {
  const profile = stage.speakerId ? mode.profiles.find((candidate) => candidate.id === stage.speakerId) : undefined;
  if (profile) {
    return profile.label;
  }
  const node = mode.nodes.find((candidate) => candidate.id === stage.nodeId);
  const ownerProfile = node?.ownerAgentId ? mode.profiles.find((candidate) => candidate.id === node.ownerAgentId) : undefined;
  return ownerProfile?.label ?? node?.ownerAgentId;
}

function nodeStoryDescription(
  language: AppLanguage,
  mode: OraModeSpec,
  node: OraModeSpec["nodes"][number],
): string {
  const owner = ownerDisplayName(mode, node, language);
  const generated = modeNodeGeneratedStory(node);
  if (generated) {
    return generated;
  }

  const definition = getModeNodeRuntimeTemplateDefinition(mode.family, node.template);
  const story = interpolateModeNodeStory(definition.display.story || definition.description, owner);
  return translateCopy(language, story);
}

function modeNodeGeneratedStory(node: OraModeSpec["nodes"][number]): string | undefined {
  const story = node.config?.story;
  if (!story || typeof story !== "object" || Array.isArray(story)) {
    return undefined;
  }
  const summary = (story as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : undefined;
}

function interpolateModeNodeStory(story: string, owner: string): string {
  return story.replace(/\{\{\s*owner\s*\}\}/g, owner);
}

function stageFailureSummary(
  language: AppLanguage,
  mode: OraModeSpec,
  node: OraModeSpec["nodes"][number],
): string {
  const matchingRules = mode.recoveryPolicy.rules.filter((rule) =>
    rule.enabled
    && (
      rule.nodeIds.includes(node.id)
      || rule.nodeTemplates.includes(node.template)
      || (rule.nodeIds.length === 0 && rule.nodeTemplates.length === 0)
    ),
  );
  if (mode.runtimeAtoms.includes("recovery_policy") && matchingRules.length > 0) {
    return matchingRules.map((rule) => formatEnumLabel(language, rule.action)).join(", ");
  }
  if (node.riskLevel) {
    return translateCopy(language, "Risk level may trigger approval or guarded execution.");
  }
  return translateCopy(language, "Uses the mode default recovery behavior.");
}

function resolveModeAtoms(
  mode: OraModeSpec,
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"],
  scope: "mode" | "node",
) {
  const wanted = new Set(
    scope === "mode"
      ? mode.runtimeAtoms
      : mode.nodes.flatMap((node) =>
          Array.isArray(node.config?.atoms)
            ? node.config.atoms.filter((value): value is string => typeof value === "string")
            : [],
        ),
  );
  return atoms.filter((atom) => atom.scope === scope && wanted.has(atom.id));
}

function resolveNodeAtoms(
  node: OraModeSpec["nodes"][number],
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"],
) {
  const wanted = new Set(
    Array.isArray(node.config?.atoms)
      ? node.config.atoms.filter((value): value is string => typeof value === "string")
      : [],
  );
  return atoms.filter((atom) => atom.scope === "node" && wanted.has(atom.id));
}

function atomRequirementsSatisfied(
  mode: OraModeSpec,
  atom: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"][number],
) {
  return atom.requiresFlags.every((flag) => Boolean(mode.capabilityFlags[flag as keyof OraModeSpec["capabilityFlags"]]))
    && atom.requiresTools.every((toolId) => mode.capabilityFlags.toolIds.includes(toolId));
}

function toggleNodeAtom(
  node: OraModeSpec["nodes"][number],
  atomId: string,
) {
  const current = Array.isArray(node.config?.atoms)
    ? node.config.atoms.filter((value): value is string => typeof value === "string")
    : [];
  return current.includes(atomId)
    ? current.filter((value) => value !== atomId)
    : [...current, atomId];
}

function canvasSelectionExists(
  mode: OraModeSpec,
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"],
  selectedId: string,
) {
  if (selectedId === RUNTIME_ANCHOR_NODE_ID) {
    return atoms.some((atom) => atom.scope === "mode" && atom.compatibleFamilies.includes(mode.family));
  }
  if (mode.nodes.some((node) => node.id === selectedId)) {
    return true;
  }
  if (selectedId.startsWith(MODE_CAPABILITY_NODE_PREFIX)) {
    return atoms.some((atom) => atom.scope === "mode" && atom.compatibleFamilies.includes(mode.family) && `${MODE_CAPABILITY_NODE_PREFIX}${atom.id}` === selectedId);
  }
  if (selectedId.startsWith(NODE_ATTACHMENT_NODE_PREFIX)) {
    const raw = selectedId.slice(NODE_ATTACHMENT_NODE_PREFIX.length);
    const divider = raw.lastIndexOf(":");
    if (divider === -1) {
      return false;
    }
    const sourceNodeId = raw.slice(0, divider);
    const atomId = raw.slice(divider + 1);
    const sourceNode = mode.nodes.find((node) => node.id === sourceNodeId);
    if (!sourceNode) {
      return false;
    }
    const configured = Array.isArray(sourceNode.config?.atoms)
      ? sourceNode.config.atoms.filter((value): value is string => typeof value === "string")
      : [];
    return configured.includes(atomId);
  }
  return false;
}

function toCreateParams(spec: OraModeSpec): OraModeCreateParams {
  const { id, family, label, summary, description, recommendedUse, failureMode, visibility, nodes, edges, stopPolicy, capabilityFlags, editorConstraints, defaultBudget, profiles, runtimeAtoms, stages, transcriptLayout, completionPolicy, runtimePolicy, recoveryPolicy, memoryPolicy, toolLimits } = spec;
  return {
    id,
    family,
    label,
    summary,
    description,
    recommendedUse,
    failureMode,
    visibility,
    nodes,
    edges,
    stopPolicy,
    capabilityFlags,
    editorConstraints,
    defaultBudget,
    profiles,
    runtimeAtoms,
    stages,
    transcriptLayout,
    completionPolicy,
    runtimePolicy,
    recoveryPolicy,
    memoryPolicy,
    toolLimits,
  };
}

function getModeStopPolicies(family: CoordinationPattern): OraModeSpec["stopPolicy"]["type"][] {
  switch (family) {
    case "generator_verifier":
      return ["max_iterations", "manual"];
    case "shared_state":
      return ["converged", "manual"];
    default:
      return ["queue_drained", "manual"];
  }
}

function displayText(language: AppLanguage, value: string | undefined): string {
  return value ? translateCopy(language, value) : "";
}

function localizeCanvasNodeData(language: AppLanguage, data: ModeCanvasNodeData): ModeCanvasNodeData {
  return {
    ...data,
    label: displayText(language, data.label),
    ownerAgentId: data.ownerAgentId ? displayText(language, data.ownerAgentId) : data.ownerAgentId,
    sourceNodeId: data.sourceNodeId ? displayText(language, data.sourceNodeId) : data.sourceNodeId,
  };
}

function formatEnumLabel(language: AppLanguage, value: string): string {
  return translateCopy(language, value.replace(/_/g, " "));
}

function promptOverridePlaceholder(language: AppLanguage, family: CoordinationPattern, template: OraModeSpec["nodes"][number]["template"]): string {
  const definition = getModeNodeRuntimeTemplateDefinition(family, template);
  if (!definition.supportsPromptOverride) {
    return translateCopy(language, "This stage does not currently consume a prompt override in the runtime interpreter.");
  }
  return definition.fallbackPrompt ?? translateCopy(language, "Override the runtime prompt template for this stage.");
}

function promptOverrideHint(language: AppLanguage, family: CoordinationPattern, template: OraModeSpec["nodes"][number]["template"]): string {
  const definition = getModeNodeRuntimeTemplateDefinition(family, template);
  const description = translateCopy(language, definition.description);
  if (!definition.supportsPromptOverride) {
    return description;
  }
  const variables = definition.promptVariables.map((variable) => `{{${variable}}}`);
  return variables.length > 0
    ? `${description} ${translateCopy(language, "Available runtime variables:")} ${variables.join(", ")}.`
    : description;
}

function stageInstructionsPreview(
  language: AppLanguage,
  family: CoordinationPattern,
  node: OraModeSpec["nodes"][number],
): string {
  return node.instructions
    ?? defaultRuntimeInstructionsPreview(language, family, node.template);
}

function defaultRuntimeInstructionsPreview(language: AppLanguage, family: CoordinationPattern, template: OraModeSpec["nodes"][number]["template"]): string {
  const definition = getModeNodeRuntimeTemplateDefinition(family, template);
  return definition.fallbackInstructions ?? translateCopy(language, "This stage currently relies on the owning agent's system prompt.");
}

function defaultRuntimePromptPreview(language: AppLanguage, family: CoordinationPattern, template: OraModeSpec["nodes"][number]["template"]): string {
  const definition = getModeNodeRuntimeTemplateDefinition(family, template);
  return definition.fallbackPrompt ?? translateCopy(language, "This stage currently relies on runtime behavior rather than a prompt template.");
}

function formatStopPolicy(language: AppLanguage, policy: OraModeSpec["stopPolicy"]): string {
  switch (policy.type) {
    case "max_iterations":
      return `${formatEnumLabel(language, "max_iterations")} (${policy.maxIterations ?? translateCopy(language, "default")})`;
    case "converged":
      return `${formatEnumLabel(language, "converged")} (${policy.idleCycles ?? translateCopy(language, "default")} ${translateCopy(language, "idle cycles")})`;
    default:
      return formatEnumLabel(language, policy.type);
  }
}

function formatRiskLabel(language: AppLanguage, riskLevel: NonNullable<OraModeSpec["nodes"][number]["riskLevel"]>): string {
  return formatEnumLabel(language, riskLevel);
}

function riskBadgeClassName(riskLevel: NonNullable<OraModeSpec["nodes"][number]["riskLevel"]>): string {
  switch (riskLevel) {
    case "high":
      return "bg-rose-100 text-rose-900";
    case "medium":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function riskSurfaceClassName(riskLevel: NonNullable<OraModeSpec["nodes"][number]["riskLevel"]>): string {
  switch (riskLevel) {
    case "high":
      return "border-rose-300 bg-rose-50/80";
    case "medium":
      return "border-amber-300 bg-amber-50/90";
    default:
      return "border-slate-300 bg-slate-50/90";
  }
}

function riskAccentClassName(riskLevel: NonNullable<OraModeSpec["nodes"][number]["riskLevel"]>): string {
  switch (riskLevel) {
    case "high":
      return "bg-rose-400";
    case "medium":
      return "bg-amber-400";
    default:
      return "bg-slate-400";
  }
}

function describeStopPolicy(language: AppLanguage, policy: OraModeSpec["stopPolicy"]): string {
  if (policy.detail) {
    return translateCopy(language, policy.detail);
  }
  switch (policy.type) {
    case "max_iterations":
      return translateCopy(language, `Stop after ${policy.maxIterations ?? 3} passes if verification does not accept the result earlier.`);
    case "queue_drained":
      return translateCopy(language, "Stop after all enabled stages complete and no queued work remains.");
    case "converged":
      return translateCopy(language, `Stop when the shared board stops changing for ${policy.idleCycles ?? 2} idle cycles.`);
    case "manual":
      return translateCopy(language, "Stop only when a user or operator explicitly ends the run.");
  }
}
