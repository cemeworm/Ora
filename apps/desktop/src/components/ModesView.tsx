import { ArrowLeft, Check, Copy, Database, FileText, GitBranchPlus, Globe, ListTree, PencilLine, Plug, Plus, RefreshCcw, Save, Search, Terminal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionRiskLevelSchema,
  CoordinationPatternSchema,
  completionPolicyForPreset,
  ensureModeNodePositions,
  getModeNodeRuntimeTemplateDefinition,
  getPatternDefinition,
  RecoveryActionSchema,
  RecoveryErrorTypeSchema,
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
  modeCanvasStagePositionToStoredPosition,
  MODE_CAPABILITY_NODE_PREFIX,
  NODE_ATTACHMENT_NODE_PREFIX,
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
    setSelectedNodeId(draft.nodes[0]?.id);
  }, [atoms, draft, selectedNodeId]);

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

              <section className="grid min-w-0 items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
                <CanvasPanel
                  mode={previewMode}
                  atoms={atoms}
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
            <section className="grid min-w-0 items-stretch gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <CanvasPanel
                mode={draft}
                atoms={atoms}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onClearSelection={() => setSelectedNodeId(undefined)}
                onConnect={handleConnect}
                onDeleteEdges={(edges) => patchDraft((current) => removeModeEdges(current, edges.map((edge) => edge.id)))}
                onMoveNode={(node) => {
                  if (node.data.kind !== "stage") return;
                  patchDraft((current) => patchModeNodePosition(
                    current,
                    node.id,
                    modeCanvasStagePositionToStoredPosition(current, atoms, node.position),
                  ));
                }}
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
                ) : selectedModeAtom ? (
                  <CapabilityInspector
                    mode={draft}
                    atom={selectedModeAtom}
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
  atoms,
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
  readOnly?: boolean;
  selectedNodeId?: string;
  onSelectNode: (nodeId?: string) => void;
  onClearSelection: () => void;
  onMoveNode?: (node: Node<ModeCanvasNodeData>) => void;
  onConnect?: (connection: Connection) => void;
  onDeleteEdges?: (edges: Edge[]) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const nodes = useMemo(
    () => buildModeFlowNodes(mode, atoms).map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    [atoms, mode, selectedNodeId],
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

    const resizeObserver = new ResizeObserver(() => fitCanvasView());
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
            <h4 className="mt-1 text-base font-semibold">{mode.label}</h4>
          </div>
          <div className="rounded-full bg-bench-100 px-3 py-1 text-xs font-semibold text-bench-800">
            {mode.nodes.filter((node) => node.enabled).length} enabled nodes
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
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          onPaneClick={onClearSelection}
          onNodeClick={(_event, node) => onSelectNode(node.id)}
          onNodeDragStop={(_event, node) => onMoveNode?.(node)}
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
  toolRegistry,
  editingModeId,
  definition,
  executionPreview,
  onPatchDraft,
  onDeleteMode,
}: {
  draft: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  toolRegistry: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["toolRegistry"] | undefined;
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

      {toolRegistry && (
        <WorkspaceToolsPanel
          draft={draft}
          toolRegistry={toolRegistry}
          onPatchDraft={onPatchDraft}
        />
      )}

      <CompletionPolicyPanel
        draft={draft}
        onPatchDraft={onPatchDraft}
      />

      <RecoveryPolicyPanel
        draft={draft}
        onPatchDraft={onPatchDraft}
      />

      <MemoryPolicyPanel
        draft={draft}
        onPatchDraft={onPatchDraft}
      />

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
    .filter((tool) => ["file", "shell", "network", "mcp"].includes(tool.category))
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
          <select
            value={draft.completionPolicy.preset}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              completionPolicy: completionPolicyForPreset(event.target.value as OraModeSpec["completionPolicy"]["preset"]),
            }))}
            className="h-9 rounded-md border border-bench-200 bg-white px-2 text-sm outline-none"
          >
            <option value="decisive">Decisive</option>
            <option value="balanced">Balanced</option>
            <option value="persistent">Persistent</option>
          </select>
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
                max={10}
                value={draft.completionPolicy.maxRepeatedToolCalls}
                onChange={(event) => onPatchDraft((current) => ({
                  ...current,
                  completionPolicy: {
                    ...current.completionPolicy,
                    maxRepeatedToolCalls: Math.max(1, Math.min(10, Number(event.target.value) || 1)),
                  },
                }))}
                className="h-9 rounded-md border border-bench-200 bg-white px-2 text-sm outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-bench-700">
              <input
                type="checkbox"
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
              <input
                type="checkbox"
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
              <input
                type="checkbox"
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
          <select
            value={draft.memoryPolicy.updater}
            onChange={(event) => onPatchDraft((current) => ({
              ...current,
              memoryPolicy: {
                ...current.memoryPolicy,
                updater: event.target.value as OraModeSpec["memoryPolicy"]["updater"],
              },
            }))}
            className="h-9 rounded-md border border-bench-200 px-2 text-sm outline-none"
          >
            <option value="provider">provider JSON patch</option>
            <option value="heuristic">heuristic fallback</option>
          </select>
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
        <input
          type="checkbox"
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
              <select
                value={rule.errorTypes[0] ?? "tool_error"}
                onChange={(event) => onPatchRecoveryRule(onPatchDraft, index, { errorTypes: [event.target.value as OraModeSpec["recoveryPolicy"]["rules"][number]["errorTypes"][number]] })}
                className="h-8 rounded-md border border-bench-200 bg-white px-2 text-xs outline-none"
              >
                {RecoveryErrorTypeSchema.options.map((errorType) => (
                  <option key={errorType} value={errorType}>{errorType}</option>
                ))}
              </select>
              <select
                value={rule.action}
                onChange={(event) => onPatchRecoveryRule(onPatchDraft, index, { action: event.target.value as OraModeSpec["recoveryPolicy"]["rules"][number]["action"] })}
                className="h-8 rounded-md border border-bench-200 bg-white px-2 text-xs outline-none"
              >
                {RecoveryActionSchema.options.map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </select>
              <select
                value={rule.nodeTemplates[0] ?? ""}
                onChange={(event) => onPatchRecoveryRule(onPatchDraft, index, { nodeTemplates: event.target.value ? [event.target.value] : [] })}
                className="h-8 rounded-md border border-bench-200 bg-white px-2 text-xs outline-none"
              >
                <option value="">any node</option>
                {nodeTemplates.map((template) => (
                  <option key={template} value={template}>{template}</option>
                ))}
              </select>
              <select
                value={rule.alternateToolIds[0] ?? ""}
                onChange={(event) => onPatchRecoveryRule(onPatchDraft, index, { alternateToolIds: event.target.value ? [event.target.value] : [] })}
                className="h-8 rounded-md border border-bench-200 bg-white px-2 text-xs outline-none"
              >
                <option value="">no alternate</option>
                {enabledTools.map((toolId) => (
                  <option key={toolId} value={toolId}>{toolId}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-bench-700">
              <input
                type="checkbox"
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
}: {
  mode: OraModeSpec;
  atoms: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"];
  definition: ReturnType<typeof getPatternDefinition> | undefined;
  executionPreview: ReturnType<typeof getExecutionPreview> | undefined;
}) {
  const activeModeAtoms = resolveModeAtoms(mode, atoms, "mode");
  const activeNodeAtoms = resolveModeAtoms(mode, atoms, "node");
  const riskyNodes = mode.nodes.filter((node) => node.enabled && node.riskLevel);

  return (
    <>
      <div className="rounded-2xl bg-white p-5 shadow-pane ring-1 ring-inset ring-bench-200">
        <h4 className="text-sm font-semibold">Runtime defaults</h4>
        <div className="mt-3 grid gap-3 text-sm text-bench-700">
          <p>Approval: {mode.capabilityFlags.approvalMode}</p>
          <p>
            Risky stages: {riskyNodes.length > 0
              ? riskyNodes.map((node) => `${node.label} (${formatRiskLabel(node.riskLevel!)})`).join(", ")
              : "none"}
          </p>
          <p>Skills: {mode.capabilityFlags.skillIds.join(", ") || "none"}</p>
          <p>Tools: {mode.capabilityFlags.toolIds.join(", ") || "none"}</p>
          <p>Stop policy: {formatStopPolicy(mode.stopPolicy)}</p>
          <p>Completion: {mode.completionPolicy.preset} · {mode.defaultBudget.maxToolCalls} tools · duplicate tolerance {mode.completionPolicy.maxRepeatedToolCalls}</p>
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
                  <div
                    key={node.id}
                    className={cn(
                      "rounded-lg border bg-white px-3 py-2 text-sm text-bench-900",
                      node.riskLevel ? riskSurfaceClassName(node.riskLevel) : "border-bench-200",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>{index + 1}. {node.label} · {node.template}</span>
                      {node.riskLevel ? (
                        <span className={cn(
                          "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
                          riskBadgeClassName(node.riskLevel),
                        )}>
                          {formatRiskLabel(node.riskLevel)}
                        </span>
                      ) : null}
                    </div>
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
  const compatibleNodeAtoms = atoms.filter((atom) => atom.scope === "node" && atom.compatibleFamilies.includes(draft.family));

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
                      {atom.label}
                    </button>
                  );
                })}
              </div>
              {compatibleNodeAtoms.length === 0 && (
                <p className="text-sm text-bench-700">No stage atoms are compatible with this family.</p>
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

function CapabilityInspector({
  mode,
  atom,
  sourceNode,
  onToggle,
}: {
  mode: OraModeSpec;
  atom: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"][number];
  sourceNode?: OraModeSpec["nodes"][number];
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
              {sourceNode ? "Stage capability" : "Mode capability"}
            </p>
            <h4 className="mt-1 text-base font-semibold">{atom.label}</h4>
          </div>
          <div className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold",
            active ? "bg-emerald-100 text-emerald-900" : "bg-bench-100 text-bench-700",
          )}>
            {active ? "Enabled" : "Disabled"}
          </div>
        </div>

        <p className="mt-3 text-sm leading-6 text-bench-700">{atom.description}</p>
        {sourceNode && (
          <p className="mt-3 text-xs leading-5 text-bench-700">
            Attached stage: <span className="font-semibold text-bench-900">{sourceNode.label}</span>
          </p>
        )}

        <div className="mt-4 grid gap-3 text-sm text-bench-700">
          <p>Presentation: {atom.topology.presentation}</p>
          <p>Edge: {atom.topology.edgeKind}{atom.topology.edgeLabel ? ` · ${atom.topology.edgeLabel}` : ""}</p>
          <p>Requires tools: {atom.requiresTools.join(", ") || "none"}</p>
          <p>Requires flags: {atom.requiresFlags.join(", ") || "none"}</p>
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
            {active ? "Disable capability" : "Enable capability"}
          </button>
          {!available && (
            <p className="text-xs leading-5 text-amber-700">
              This capability is blocked until its required flags/tools are enabled.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeCanvasNode({ data, selected }: NodeProps<ModeCanvasNodeData>) {
  const stageNode = data.kind === "stage";
  return (
    <div className={cn(
      "relative rounded-[1.25rem] border bg-white px-4 py-3 shadow-[0_18px_40px_-28px_rgba(17,24,39,0.45)] transition",
      stageNode ? "w-[248px]" : "w-[196px]",
      stageNode
        ? data.enabled
          ? cn("text-bench-950", data.riskLevel ? riskSurfaceClassName(data.riskLevel) : "border-bench-200")
          : "border-bench-200/80 bg-bench-100/90 text-bench-600 opacity-80"
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

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-bench-600">
            {stageNode ? data.template : data.atomPresentation?.replace(/_/g, " ") ?? "capability"}
          </div>
          <div className="mt-1 text-sm font-semibold leading-5">{data.label}</div>
          <div className="mt-2 text-xs text-bench-600">
            {stageNode
              ? data.ownerAgentId ?? "runtime-owned"
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
          {stageNode ? (data.enabled ? "live" : "off") : (data.active ? "on" : "off")}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-bench-600">
        <span className="rounded-full bg-bench-100 px-2.5 py-1">
          {stageNode ? (data.required ? "Required" : "Optional") : (data.kind === "node-attachment" ? "Attachment" : "Capability")}
        </span>
        {stageNode && data.riskLevel && (
          <span className={cn(
            "rounded-full px-2.5 py-1 font-semibold uppercase tracking-[0.08em]",
            riskBadgeClassName(data.riskLevel),
          )}>
            {formatRiskLabel(data.riskLevel)}
          </span>
        )}
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

function atomRequirementsSatisfied(
  mode: OraModeSpec,
  atom: Awaited<ReturnType<RuntimeClient["bootstrap"]>>["atoms"][number],
) {
  return atom.requiresFlags.every((flag) => Boolean(mode.capabilityFlags[flag as keyof OraModeSpec["capabilityFlags"]]));
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
  const { id, family, label, summary, description, recommendedUse, failureMode, nodes, edges, stopPolicy, capabilityFlags, editorConstraints, defaultBudget, profiles, runtimeAtoms, completionPolicy, recoveryPolicy, memoryPolicy } = spec;
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
    completionPolicy,
    recoveryPolicy,
    memoryPolicy,
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

function formatRiskLabel(riskLevel: NonNullable<OraModeSpec["nodes"][number]["riskLevel"]>): string {
  return riskLevel.replace(/_/g, " ");
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
