import { ArrowLeft, Check, Copy, GitBranchPlus, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ActionRiskLevelSchema,
  CoordinationPatternSchema,
  ensureModeNodePositions,
  getModeNodeRuntimeTemplateDefinition,
  getPatternDefinition,
  type CoordinationPattern,
} from "@ora/shared";
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
  patchModeNodePosition,
  removeModeEdges,
  resetModeDraftFamily,
  validateCanvasConnection,
  type ModeCanvasNodeData,
} from "../lib/modeCanvas";
import { useWorkbench } from "../lib/state";
import type { OraModeCreateParams, OraModeSpec, OraModeValidationResult, RuntimeClient } from "../lib/runtimeClient";
import { cn } from "../lib/utils";

type EditorMode = "gallery" | "create" | "edit";

const NODE_TYPES = {
  modeNode: ModeCanvasNode,
};

export function ModesView({ runtimeClient }: { runtimeClient: RuntimeClient }) {
  const { state, dispatch } = useWorkbench();
  const [modes, setModes] = useState<OraModeSpec[]>(state.modes);
  const [atoms, setAtoms] = useState<Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>("gallery");
  const [draft, setDraft] = useState<OraModeSpec | undefined>();
  const [editingModeId, setEditingModeId] = useState<string | undefined>();
  const [validation, setValidation] = useState<OraModeValidationResult | undefined>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [pendingTemplate, setPendingTemplate] = useState<string>("");

  useEffect(() => {
    setModes(state.modes);
  }, [state.modes]);

  useEffect(() => {
    void refreshModes();
  }, [runtimeClient]);

  useEffect(() => {
    void refreshAtoms();
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
    if (selectedNodeId && draft.nodes.some((node) => node.id === selectedNodeId)) {
      return;
    }
    setSelectedNodeId(draft.nodes[0]?.id);
  }, [draft, selectedNodeId]);

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
    if (!window.confirm(`Delete mode '${modeId}'?`)) {
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

  function exitEditor() {
    setDraft(undefined);
    setSelectedNodeId(undefined);
    setEditingModeId(undefined);
    setValidation(undefined);
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
          <select
            value={pendingTemplate}
            onChange={(event) => setPendingTemplate(event.target.value)}
            className="h-10 rounded-md border border-bench-200 bg-white px-3 text-sm outline-none"
          >
            {allowedTemplates.map((template) => (
              <option key={template} value={template}>{template}</option>
            ))}
          </select>
          <button
            onClick={handleAddNode}
            disabled={!allowedTemplates.length}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} />
            Add stage
          </button>
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

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 bg-transparent">
      <aside className="flex w-[21rem] shrink-0 flex-col border-r border-border bg-sidebar/92">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Modes</p>
              <h2 className="text-lg font-semibold">Mode Studio</h2>
            </div>
            <button
              onClick={() => void refreshModes()}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold transition hover:bg-bench-50"
            >
              <RefreshCcw size={14} className={cn(busy === "refresh" && "animate-spin")} />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => startDraft(undefined, true)}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-bench-900 px-3 text-sm font-semibold text-white transition hover:bg-bench-800"
            >
              <Plus size={14} />
              New mode
            </button>
            {selectedMode && (
              <button
                onClick={() => void clonePreset(selectedMode)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold transition hover:bg-bench-50"
              >
                <Copy size={14} />
                Clone preset
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-2">
            {modes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => dispatch({ type: "SET_MODE", modeId: mode.id })}
                className={cn(
                  "w-full rounded-xl border px-3 py-3 text-left transition",
                  state.selectedModeId === mode.id
                    ? "border-bench-400 bg-white shadow-pane"
                    : "border-transparent bg-white/70 hover:border-bench-200 hover:bg-white",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{mode.label}</div>
                  <span className="rounded-full border border-bench-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-bench-700">
                    {mode.systemPreset ? "preset" : mode.family}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-bench-700">{mode.summary}</p>
              </button>
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
                    <h3 className="mt-1 text-2xl font-semibold">{selectedMode.label}</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-bench-700">{selectedMode.summary}</p>
                    {selectedMode.recommendedUse && (
                      <p className="mt-3 max-w-2xl text-sm leading-6 text-bench-800">
                        Use: {selectedMode.recommendedUse}
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
                  </div>
                </div>
              </div>

              <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <CanvasPanel
                  mode={previewMode}
                  readOnly
                  selectedNodeId={undefined}
                  onSelectNode={() => undefined}
                  onClearSelection={() => undefined}
                />
                <ModeOverviewInspector
                  mode={previewMode}
                  atoms={atoms}
                  definition={selectedDefinition}
                  executionPreview={getExecutionPreview(previewMode)}
                />
              </section>
            </section>
          ) : draft ? (
            <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <CanvasPanel
                mode={draft}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onClearSelection={() => setSelectedNodeId(undefined)}
                onConnect={handleConnect}
                onDeleteEdges={(edges) => patchDraft((current) => removeModeEdges(current, edges.map((edge) => edge.id)))}
                onMoveNode={(node) => patchDraft((current) => patchModeNodePosition(current, node.id, node.position))}
              />
              <div className="space-y-5">
                {selectedNode ? (
                  <NodeInspector
                    draft={draft}
                    node={selectedNode}
                    atoms={atoms}
                    allowedTemplates={allowedTemplates}
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
                ) : (
                  <ModeInspector
                    draft={draft}
                    atoms={atoms}
                    editingModeId={editingModeId}
                    definition={draftDefinition}
                    executionPreview={executionPreview}
                    onPatchDraft={patchDraft}
                    onDeleteMode={editingModeId ? () => void deleteMode(editingModeId) : undefined}
                  />
                )}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function CanvasPanel({
  mode,
  readOnly = false,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
  onMoveNode,
  onConnect,
  onDeleteEdges,
}: {
  mode: OraModeSpec;
  readOnly?: boolean;
  selectedNodeId?: string;
  onSelectNode: (nodeId?: string) => void;
  onClearSelection: () => void;
  onMoveNode?: (node: Node<ModeCanvasNodeData>) => void;
  onConnect?: (connection: Connection) => void;
  onDeleteEdges?: (edges: Edge[]) => void;
}) {
  const nodes = useMemo(
    () => buildModeFlowNodes(mode).map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    [mode, selectedNodeId],
  );
  const edges = useMemo(() => buildModeFlowEdges(mode), [mode]);
  const canvasHeight = useMemo(() => {
    if (!readOnly) {
      return 680;
    }

    const positionedNodes = mode.nodes.filter((node) => node.position);
    if (positionedNodes.length === 0) {
      return 420;
    }

    const top = Math.min(...positionedNodes.map((node) => node.position!.y));
    const bottom = Math.max(...positionedNodes.map((node) => node.position!.y + 248));
    return Math.max(320, Math.min(520, bottom - top + 120));
  }, [mode.nodes, readOnly]);

  return (
    <div className="min-w-0 w-full overflow-hidden rounded-[1.5rem] bg-white shadow-pane ring-1 ring-inset ring-bench-200">
      <div className="border-b border-bench-200/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">
              {readOnly ? "Canvas preview" : "Canvas"}
            </p>
            <h4 className="mt-1 text-base font-semibold">{mode.label}</h4>
          </div>
          <div className="rounded-full bg-bench-100 px-3 py-1 text-xs font-semibold text-bench-800">
            {mode.nodes.filter((node) => node.enabled).length} enabled nodes
          </div>
        </div>
      </div>
      <div
        className="bg-[radial-gradient(circle_at_top,rgba(245,247,249,0.9),rgba(236,240,243,0.55)_45%,rgba(250,251,252,1)_100%)]"
        style={{ height: canvasHeight }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          onPaneClick={onClearSelection}
          onNodeClick={(_event, node) => onSelectNode(node.id)}
          onNodeDragStop={(_event, node) => onMoveNode?.(node)}
          onConnect={readOnly ? undefined : onConnect}
          onEdgesDelete={readOnly ? undefined : onDeleteEdges}
          panOnScroll
          selectionOnDrag={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1.1} color="#d5dde3" />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => (node.data.enabled ? "#1f2937" : "#c2cbd4")}
            maskColor="rgba(246, 248, 250, 0.7)"
            className="!rounded-xl !border !border-bench-200 !bg-white/90 !shadow-none"
          />
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
}: {
  mode: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  definition: ReturnType<typeof getPatternDefinition> | undefined;
  executionPreview: ReturnType<typeof getExecutionPreview>;
}) {
  return (
    <div className="space-y-5">
      <ModeSummaryCards mode={mode} atoms={atoms} definition={definition} executionPreview={executionPreview} />
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
  editingModeId,
  definition,
  executionPreview,
  onPatchDraft,
  onDeleteMode,
}: {
  draft: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  editingModeId?: string;
  definition: ReturnType<typeof getPatternDefinition> | undefined;
  executionPreview: ReturnType<typeof getExecutionPreview> | undefined;
  onPatchDraft: (updater: (current: OraModeSpec) => OraModeSpec) => void;
  onDeleteMode?: () => void;
}) {
  return (
    <>
      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <h4 className="text-sm font-semibold">Mode settings</h4>
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
            <select
              value={draft.family}
              onChange={(event) => onPatchDraft((current) => resetModeDraftFamily(current, event.target.value as CoordinationPattern))}
              className="h-10 rounded-md border border-bench-200 px-3 outline-none"
            >
              {CoordinationPatternSchema.options.map((family) => (
                <option key={family} value={family}>{family}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-bench-700">Stop policy</span>
            <select
              value={draft.stopPolicy.type}
              onChange={(event) => onPatchDraft((current) => ({
                ...current,
                stopPolicy: { ...current.stopPolicy, type: event.target.value as OraModeSpec["stopPolicy"]["type"] },
              }))}
              className="h-10 rounded-md border border-bench-200 px-3 outline-none"
            >
              {draft.editorConstraints.allowedNodeTemplates.length > 0 && getPatternDefinition(draft.family) && (
                getModeStopPolicies(draft.family).map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))
              )}
            </select>
          </label>
        </div>
      </div>

      <ModeSummaryCards mode={draft} atoms={atoms} definition={definition} executionPreview={executionPreview} />

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

function ModeSummaryCards({
  mode,
  atoms,
  definition,
  executionPreview,
}: {
  mode: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  definition: ReturnType<typeof getPatternDefinition> | undefined;
  executionPreview: ReturnType<typeof getExecutionPreview> | undefined;
}) {
  const activeModeAtoms = resolveModeAtoms(mode, atoms, "mode");
  const activeNodeAtoms = resolveModeAtoms(mode, atoms, "node");

  return (
    <>
      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <h4 className="text-sm font-semibold">Runtime defaults</h4>
        <div className="mt-3 grid gap-3 text-sm text-bench-700">
          <p>Approval: {mode.capabilityFlags.approvalMode}</p>
          <p>Skills: {mode.capabilityFlags.skillIds.join(", ") || "none"}</p>
          <p>Tools: {mode.capabilityFlags.toolIds.join(", ") || "none"}</p>
          <p>Stop policy: {formatStopPolicy(mode.stopPolicy)}</p>
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
                  {atom.label}
                </span>
              )) : (
                <span className="text-sm text-bench-700">none</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Stage atoms</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeNodeAtoms.length > 0 ? activeNodeAtoms.map((atom) => (
                <span key={atom.id} className="rounded-full bg-bench-100 px-3 py-1 text-xs font-medium text-bench-800">
                  {atom.label}
                </span>
              )) : (
                <span className="text-sm text-bench-700">none</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {definition && (
        <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
          <h4 className="text-sm font-semibold">Details</h4>
          <div className="mt-3 grid gap-3 text-sm text-bench-700">
            <p>Use: {mode.recommendedUse ?? definition.recommendedUse}</p>
            <p>Failure: {mode.failureMode ?? definition.failureMode}</p>
            <p>Stop: {describeStopPolicy(mode.stopPolicy)}</p>
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
                  <div key={node.id} className="rounded-lg border border-bench-200 bg-white px-3 py-2 text-sm text-bench-900">
                    {index + 1}. {node.label} · {node.template}
                  </div>
                ))}
                {executionPreview.nodes.length === 0 && (
                  <p className="text-sm text-bench-700">No enabled stages.</p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-bench-200 bg-bench-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Active edges</div>
              <div className="mt-3 space-y-2">
                {executionPreview.edges.map((edge) => (
                  <div key={edge.id} className="rounded-lg border border-bench-200 bg-white px-3 py-2 text-sm text-bench-900">
                    {edge.source} → {edge.target}
                  </div>
                ))}
                {executionPreview.edges.length === 0 && (
                  <p className="text-sm text-bench-700">A single enabled stage does not create an active edge.</p>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-bench-200 bg-bench-50 p-4 text-sm leading-6 text-bench-700">
              <p>Behavior: {describeStopPolicy(mode.stopPolicy)}</p>
              {executionPreview.disabledNodes.length > 0 && (
                <p className="mt-2">Disabled stages: {executionPreview.disabledNodes.map((node) => node.label).join(", ")}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NodeInspector({
  draft,
  node,
  atoms,
  allowedTemplates,
  onPatchNode,
  onDeleteNode,
}: {
  draft: OraModeSpec;
  node: OraModeSpec["nodes"][number];
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  allowedTemplates: OraModeSpec["editorConstraints"]["allowedNodeTemplates"];
  onPatchNode: (updater: (current: OraModeSpec["nodes"][number]) => OraModeSpec["nodes"][number]) => void;
  onDeleteNode: () => void;
}) {
  const definition = getModeNodeRuntimeTemplateDefinition(draft.family, node.template);
  const canDisable = canDisableModeNode(draft, node.id);
  const canDelete = canDeleteModeNode(draft, node.id);
  const nodeAtoms = resolveNodeAtoms(node, atoms);

  return (
    <>
      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Inspector</p>
            <h4 className="mt-1 text-base font-semibold">{node.label}</h4>
          </div>
          <div className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold",
            node.enabled ? "bg-emerald-100 text-emerald-900" : "bg-bench-100 text-bench-700",
          )}>
            {node.enabled ? "Enabled" : "Disabled"}
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
            <select
              value={node.template}
              onChange={(event) => onPatchNode((current) => ({
                ...current,
                template: event.target.value as OraModeSpec["nodes"][number]["template"],
              }))}
              className="h-10 rounded-md border border-bench-200 px-3 outline-none"
            >
              {allowedTemplates.map((template) => (
                <option key={template} value={template}>{template}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-bench-700">Owner agent</span>
            <input
              value={node.ownerAgentId ?? ""}
              onChange={(event) => onPatchNode((current) => ({ ...current, ownerAgentId: event.target.value || undefined }))}
              className="h-10 rounded-md border border-bench-200 px-3 outline-none"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-bench-700">Risk level</span>
            <select
              value={node.riskLevel ?? ""}
              onChange={(event) => onPatchNode((current) => ({
                ...current,
                riskLevel: event.target.value ? event.target.value as OraModeSpec["nodes"][number]["riskLevel"] : undefined,
              }))}
              className="h-10 rounded-md border border-bench-200 px-3 outline-none"
            >
              <option value="">runtime default</option>
              {ActionRiskLevelSchema.options.map((risk) => (
                <option key={risk} value={risk}>{risk}</option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center justify-between rounded-xl border border-bench-200 bg-bench-50 px-3 py-3 text-sm">
            <span className="font-medium text-bench-800">Enabled</span>
            <input
              type="checkbox"
              checked={node.enabled}
              disabled={!canDisable}
              onChange={(event) => onPatchNode((current) => ({ ...current, enabled: event.target.checked }))}
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
              placeholder={promptOverridePlaceholder(draft.family, node.template)}
            />
          </label>
          <div className="grid gap-1 text-sm">
            <span className="text-bench-700">Default runtime prompt</span>
            <div className="rounded-md border border-dashed border-bench-200 bg-bench-50 px-3 py-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-bench-800">
                {defaultRuntimePromptPreview(draft.family, node.template)}
              </pre>
            </div>
          </div>
          <div className="grid gap-2 text-sm">
            <span className="text-bench-700">Stage atoms</span>
            <div className="rounded-md border border-bench-200 bg-bench-50 px-3 py-3">
              {nodeAtoms.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {nodeAtoms.map((atom) => (
                    <span key={atom.id} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-bench-800 ring-1 ring-inset ring-bench-200">
                      {atom.label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-bench-700">No stage atoms enabled for this node.</p>
              )}
            </div>
          </div>
          <p className="text-xs leading-5 text-bench-700">{promptOverrideHint(draft.family, node.template)}</p>
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

function ModeCanvasNode({ data, selected }: NodeProps<ModeCanvasNodeData>) {
  return (
    <div className={cn(
      "relative w-[248px] rounded-[1.25rem] border bg-white px-4 py-3 shadow-[0_18px_40px_-28px_rgba(17,24,39,0.45)] transition",
      data.enabled ? "border-bench-200 text-bench-950" : "border-bench-200/80 bg-bench-100/90 text-bench-600 opacity-80",
      selected && "border-bench-500 shadow-[0_24px_56px_-30px_rgba(15,23,42,0.55)]",
    )}>
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

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-bench-600">{data.template}</div>
          <div className="mt-1 text-sm font-semibold leading-5">{data.label}</div>
          <div className="mt-2 text-xs text-bench-600">{data.ownerAgentId ?? "runtime-owned"}</div>
        </div>
        <div className={cn(
          "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em]",
          data.enabled ? "bg-emerald-100 text-emerald-900" : "bg-bench-200 text-bench-700",
        )}>
          {data.enabled ? "live" : "off"}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-bench-600">
        <span className="rounded-full bg-bench-100 px-2.5 py-1">{data.required ? "Required" : "Optional"}</span>
      </div>
    </div>
  );
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

function toCreateParams(spec: OraModeSpec): OraModeCreateParams {
  const { id, family, label, summary, description, recommendedUse, failureMode, nodes, edges, stopPolicy, capabilityFlags, editorConstraints, defaultBudget, profiles, runtimeAtoms } = spec;
  return {
    id,
    family,
    label,
    summary,
    description,
    recommendedUse,
    failureMode,
    nodes,
    edges,
    stopPolicy,
    capabilityFlags,
    editorConstraints,
    defaultBudget,
    profiles,
    runtimeAtoms,
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

function promptOverridePlaceholder(family: CoordinationPattern, template: OraModeSpec["nodes"][number]["template"]): string {
  const definition = getModeNodeRuntimeTemplateDefinition(family, template);
  if (!definition.supportsPromptOverride) {
    return "This stage does not currently consume a prompt override in the runtime interpreter.";
  }
  return definition.fallbackPrompt ?? "Override the runtime prompt template for this stage.";
}

function promptOverrideHint(family: CoordinationPattern, template: OraModeSpec["nodes"][number]["template"]): string {
  const definition = getModeNodeRuntimeTemplateDefinition(family, template);
  if (!definition.supportsPromptOverride) {
    return definition.description;
  }
  const variables = definition.promptVariables.map((variable) => `{{${variable}}}`);
  return variables.length > 0
    ? `${definition.description} Available runtime variables: ${variables.join(", ")}.`
    : definition.description;
}

function defaultRuntimePromptPreview(family: CoordinationPattern, template: OraModeSpec["nodes"][number]["template"]): string {
  const definition = getModeNodeRuntimeTemplateDefinition(family, template);
  return definition.fallbackPrompt ?? "This stage currently relies on runtime behavior rather than a prompt template.";
}

function formatStopPolicy(policy: OraModeSpec["stopPolicy"]): string {
  switch (policy.type) {
    case "max_iterations":
      return `max_iterations (${policy.maxIterations ?? "default"})`;
    case "converged":
      return `converged (${policy.idleCycles ?? "default"} idle cycles)`;
    default:
      return policy.type;
  }
}

function describeStopPolicy(policy: OraModeSpec["stopPolicy"]): string {
  if (policy.detail) {
    return policy.detail;
  }
  switch (policy.type) {
    case "max_iterations":
      return `Stop after ${policy.maxIterations ?? 3} passes if verification does not accept the result earlier.`;
    case "queue_drained":
      return "Stop after all enabled stages complete and no queued work remains.";
    case "converged":
      return `Stop when the shared board stops changing for ${policy.idleCycles ?? 2} idle cycles.`;
    case "manual":
      return "Stop only when a user or operator explicitly ends the run.";
  }
}
