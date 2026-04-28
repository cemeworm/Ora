import {
  Bot,
  Check,
  ClipboardCheck,
  Download,
  FileUp,
  FlaskConical,
  GitCompareArrows,
  History,
  Loader2,
  MessageSquare,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkbench } from "../lib/state";
import type {
  OraEvaluationAnnotationTask,
  OraEvaluationBaseline,
  OraEvaluationBlueprint,
  OraEvaluationBlueprintCompileResult,
  OraEvaluationDataset,
  OraEvaluationDatasetDetail,
  OraEvaluationFeedbackRecord,
  OraEvaluationRun,
  OraEvaluationRunDetail,
  OraEvaluationSpec,
  RuntimeClient,
} from "../lib/runtimeClient";
import { runnableProviderOptions } from "../lib/providerOptions";
import { cn } from "../lib/utils";
import type { RuntimeBridgeStatus } from "../types";
import { Field } from "./ui/field";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";

type Selection =
  | { kind: "new" }
  | { kind: "blueprint"; id: string }
  | { kind: "run"; id: string }
  | { kind: "annotation"; id: string };

type EvalProfile = "outcome" | "orchestration" | "task_completion";

const PROFILE_OPTIONS: Array<{ id: EvalProfile; label: string }> = [
  { id: "outcome", label: "结果质量" },
  { id: "orchestration", label: "协作过程" },
  { id: "task_completion", label: "任务完成" },
];

const MODE_OPTIONS = ["orchestrator_subagent", "agent_teams", "generator_verifier"];

export function EvaluationView({
  runtimeClient,
  bridgeStatus,
}: {
  runtimeClient: RuntimeClient;
  bridgeStatus: RuntimeBridgeStatus;
}) {
  const { state } = useWorkbench();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "new" });
  const [datasets, setDatasets] = useState<OraEvaluationDataset[]>([]);
  const [blueprints, setBlueprints] = useState<OraEvaluationBlueprint[]>([]);
  const [runs, setRuns] = useState<OraEvaluationRun[]>([]);
  const [baselines, setBaselines] = useState<OraEvaluationBaseline[]>([]);
  const [feedback, setFeedback] = useState<OraEvaluationFeedbackRecord[]>([]);
  const [annotations, setAnnotations] = useState<OraEvaluationAnnotationTask[]>([]);
  const [datasetDetail, setDatasetDetail] = useState<OraEvaluationDatasetDetail | undefined>();
  const [runDetail, setRunDetail] = useState<OraEvaluationRunDetail | undefined>();
  const [compiled, setCompiled] = useState<OraEvaluationBlueprintCompileResult | undefined>();
  const [plannerInput, setPlannerInput] = useState("评估当前 agent modes 在真实任务和失败反馈上的完成质量，包含启发式规则、LLM judge 和必要的人工标注。");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<EvalProfile>("outcome");
  const [selectedModes, setSelectedModes] = useState<string[]>(["orchestrator_subagent", "agent_teams"]);
  const [modelRef, setModelRef] = useState("local/smoke-model");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const providerOptions = runnableProviderOptions(state.providerRegistry?.providers ?? [], state.providerSecretStatuses);
  const activeProvider = providerOptions.find((provider) => provider.id === state.selectedProviderId) ?? providerOptions[0];
  const selectedBlueprint = selection.kind === "blueprint" ? blueprints.find((blueprint) => blueprint.id === selection.id) : undefined;
  const selectedAnnotation = selection.kind === "annotation" ? annotations.find((task) => task.id === selection.id) : undefined;
  const pendingAnnotations = annotations.filter((task) => task.status === "pending");
  const pendingFeedback = feedback.filter((record) => record.status === "pending" || record.status === "failed");
  const readyBlueprints = blueprints.filter((blueprint) => blueprint.status === "ready");
  const draftBlueprints = blueprints.filter((blueprint) => blueprint.status === "draft");

  async function refresh() {
    const [nextDatasets, nextRuns, nextBaselines, nextFeedback, nextBlueprints, nextAnnotations] = await Promise.all([
      runtimeClient.listEvaluationDatasets(),
      runtimeClient.listEvaluationRuns(),
      runtimeClient.listEvaluationBaselines(),
      runtimeClient.listEvaluationFeedback({ limit: 200 }),
      runtimeClient.listEvaluationBlueprints({ limit: 200 }),
      runtimeClient.listEvaluationAnnotations({ limit: 200 }),
    ]);
    setDatasets(nextDatasets);
    setRuns(nextRuns);
    setBaselines(nextBaselines);
    setFeedback(nextFeedback);
    setBlueprints(nextBlueprints);
    setAnnotations(nextAnnotations);
    if (!selectedDatasetId && nextDatasets[0]) setSelectedDatasetId(nextDatasets[0].id);
  }

  useEffect(() => {
    void refresh().catch((nextError) => setError(errorText(nextError, "Failed to load evaluation workspace.")));
  }, []);

  useEffect(() => {
    if (!selectedDatasetId) {
      setDatasetDetail(undefined);
      return;
    }
    void runtimeClient.getEvaluationDataset(selectedDatasetId)
      .then(setDatasetDetail)
      .catch((nextError) => setError(errorText(nextError, "Failed to load dataset.")));
  }, [runtimeClient, selectedDatasetId]);

  useEffect(() => {
    if (selection.kind !== "run") {
      setRunDetail(undefined);
      return;
    }
    void runtimeClient.getEvaluationRun(selection.id)
      .then(setRunDetail)
      .catch((nextError) => setError(errorText(nextError, "Failed to load evaluation run.")));
  }, [runtimeClient, selection]);

  useEffect(() => {
    setCompiled(undefined);
  }, [selectedDatasetId, selectedBlueprint?.id, selectedModes, modelRef, activeProvider?.id]);

  async function handlePlannerTurn(blueprintId?: string) {
    if (!plannerInput.trim()) return;
    setBusy("planner");
    setError("");
    try {
      const result = await runtimeClient.planEvaluationBlueprintTurn({
        blueprintId,
        message: plannerInput,
        providerId: activeProvider?.id ?? "local-smoke",
        modelRef,
      });
      await refresh();
      setSelection({ kind: "blueprint", id: result.blueprint.id });
      setPlannerInput("");
    } catch (nextError) {
      setError(errorText(nextError, "Failed to plan evaluation."));
    } finally {
      setBusy("");
    }
  }

  async function handleImportDataset(file: File) {
    setBusy("import");
    setError("");
    try {
      const detail = await runtimeClient.importEvaluationDataset({
        name: file.name.replace(/\.[^.]+$/, ""),
        sourceFileName: file.name,
        sourceFormat: inferSourceFormat(file.name),
        content: await file.text(),
      });
      setSelectedDatasetId(detail.dataset.id);
      await refresh();
    } catch (nextError) {
      setError(errorText(nextError, "Failed to import dataset."));
    } finally {
      setBusy("");
    }
  }

  async function compileBlueprint(blueprint: OraEvaluationBlueprint) {
    const result = await runtimeClient.compileEvaluationBlueprint({
      blueprintId: blueprint.id,
      datasetId: selectedDatasetId || blueprint.datasetPlan.datasetId,
      providerId: activeProvider?.id ?? "local-smoke",
      modelRef,
      modeIds: blueprint.recipe === "mode_comparison" ? selectedModes : undefined,
    });
    setCompiled(result);
    return result;
  }

  async function handleRunBlueprint(blueprint: OraEvaluationBlueprint) {
    setBusy("run");
    setError("");
    try {
      const result = compiled ?? await compileBlueprint(blueprint);
      const spec: OraEvaluationSpec = {
        ...result.spec,
        profileId: selectedProfileId,
        concurrency: 1,
      };
      const detail = await runtimeClient.startEvaluationRun(spec);
      await runtimeClient.updateEvaluationBlueprint({
        blueprintId: blueprint.id,
        updates: {
          status: "ready",
          linkedRunIds: [...new Set([...blueprint.linkedRunIds, detail.run.id])],
        },
      });
      await refresh();
      setRunDetail(detail);
      setSelection({ kind: "run", id: detail.run.id });
    } catch (nextError) {
      setError(errorText(nextError, "Failed to run evaluation."));
    } finally {
      setBusy("");
    }
  }

  async function handleExport(format: "json" | "csv") {
    if (!runDetail) return;
    setBusy(`export:${format}`);
    try {
      const result = await runtimeClient.exportEvaluationRun(runDetail.run.id, format);
      const blob = new Blob([result.content], { type: format === "json" ? "application/json" : "text/csv" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${runDetail.run.id}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (nextError) {
      setError(errorText(nextError, "Failed to export evaluation run."));
    } finally {
      setBusy("");
    }
  }

  async function handleSubmitAnnotation(task: OraEvaluationAnnotationTask, passed: boolean) {
    setBusy(`annotation:${task.id}`);
    setError("");
    try {
      await runtimeClient.submitEvaluationAnnotation({
        taskId: task.id,
        score: { value: passed, normalizedScore: passed ? 1 : 0, passed, failureTags: passed ? [] : ["human_rejected"] },
        comment: passed ? "Accepted during local review." : "Rejected during local review.",
      });
      await refresh();
    } catch (nextError) {
      setError(errorText(nextError, "Failed to submit annotation."));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-transparent">
      <div className="border-b border-border bg-sidebar/92 px-6 py-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Evaluation</p>
            <h2 className="mt-1 text-xl font-semibold text-bench-900">Evaluation Studio</h2>
            <p className="mt-1 text-sm leading-6 text-bench-700">历史任务、planner 对话、evaluator 和复盘结果集中在一个工作台。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50" onClick={() => fileInputRef.current?.click()}>
              <FileUp size={16} />
              导入数据集
            </button>
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition active:scale-[0.98]" onClick={() => setSelection({ kind: "new" })}>
              <Sparkles size={16} />
              新建评测
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.jsonl,.csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportDataset(file);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-2 overflow-hidden p-2 lg:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <HistorySidebar
          selection={selection}
          drafts={draftBlueprints}
          ready={readyBlueprints}
          runs={runs}
          annotations={pendingAnnotations}
          feedbackCount={pendingFeedback.length}
          onSelect={setSelection}
        />

        <main className="min-h-0 overflow-hidden rounded-[20px] border border-black/[0.035] bg-sidebar shadow-[0_1px_1px_rgba(23,23,23,0.04),0_8px_18px_rgba(23,23,23,0.024)]">
          <div className="h-full min-h-0 overflow-y-auto p-5">
            {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {selection.kind === "new" && (
              <PlannerPanel
                title="和 Evaluation Planner 规划这次评测"
                plannerInput={plannerInput}
                busy={busy}
                onPlannerInput={setPlannerInput}
                onSubmit={() => void handlePlannerTurn()}
              />
            )}
            {selectedBlueprint && (
              <BlueprintDetail
                blueprint={selectedBlueprint}
                datasets={datasets}
                datasetDetail={datasetDetail}
                selectedDatasetId={selectedDatasetId}
                selectedProfileId={selectedProfileId}
                selectedModes={selectedModes}
                modelRef={modelRef}
                compiled={compiled}
                busy={busy}
                onDatasetChange={setSelectedDatasetId}
                onProfileChange={setSelectedProfileId}
                onModelRefChange={setModelRef}
                onModeToggle={(modeId) => setSelectedModes((current) => current.includes(modeId) ? current.filter((id) => id !== modeId) : [...current, modeId])}
                onPlannerInput={setPlannerInput}
                plannerInput={plannerInput}
                onPlan={() => void handlePlannerTurn(selectedBlueprint.id)}
                onCompile={() => void compileBlueprint(selectedBlueprint).catch((nextError) => setError(errorText(nextError, "Failed to compile blueprint.")))}
                onRun={() => void handleRunBlueprint(selectedBlueprint)}
              />
            )}
            {selection.kind === "run" && runDetail && (
              <RunDetail detail={runDetail} busy={busy} onExport={handleExport} />
            )}
            {selection.kind === "annotation" && selectedAnnotation && (
              <AnnotationDetail task={selectedAnnotation} busy={busy} onSubmit={handleSubmitAnnotation} />
            )}
          </div>
        </main>

        <ContextPanel
          bridgeStatus={bridgeStatus}
          selection={selection}
          datasets={datasets}
          blueprints={blueprints}
          runs={runs}
          baselines={baselines}
          annotations={annotations}
          activeProvider={activeProvider?.label ?? activeProvider?.id ?? "local-smoke"}
        />
      </div>
    </div>
  );
}

function HistorySidebar({
  selection,
  drafts,
  ready,
  runs,
  annotations,
  feedbackCount,
  onSelect,
}: {
  selection: Selection;
  drafts: OraEvaluationBlueprint[];
  ready: OraEvaluationBlueprint[];
  runs: OraEvaluationRun[];
  annotations: OraEvaluationAnnotationTask[];
  feedbackCount: number;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <aside className="min-h-0 overflow-hidden rounded-[20px] border border-black/[0.035] bg-sidebar shadow-[0_1px_1px_rgba(23,23,23,0.04)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-bench-200/70 p-4">
          <button
            onClick={() => onSelect({ kind: "new" })}
            className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold transition", selection.kind === "new" ? "bg-bench-900 text-white" : "bg-white text-bench-900 ring-1 ring-inset ring-bench-200 hover:bg-bench-50")}
          >
            <Sparkles size={15} />
            新建评测
          </button>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <MiniStat label="反馈" value={feedbackCount} />
            <MiniStat label="待标注" value={annotations.length} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <HistoryGroup title="Draft Plans" items={drafts} empty="没有草稿">
            {(blueprint) => (
              <HistoryButton
                key={blueprint.id}
                active={selection.kind === "blueprint" && selection.id === blueprint.id}
                icon={<MessageSquare size={14} />}
                title={blueprint.title}
                meta={`${blueprint.recipe} · ${evaluatorKinds(blueprint).join(", ")}`}
                onClick={() => onSelect({ kind: "blueprint", id: blueprint.id })}
              />
            )}
          </HistoryGroup>
          <HistoryGroup title="Ready to Run" items={ready} empty="没有 ready blueprint">
            {(blueprint) => (
              <HistoryButton
                key={blueprint.id}
                active={selection.kind === "blueprint" && selection.id === blueprint.id}
                icon={<ClipboardCheck size={14} />}
                title={blueprint.title}
                meta={`${blueprint.datasetPlan.datasetId ?? "no dataset"} · ${blueprint.linkedRunIds.length} runs`}
                onClick={() => onSelect({ kind: "blueprint", id: blueprint.id })}
              />
            )}
          </HistoryGroup>
          <HistoryGroup title="Runs" items={runs} empty="还没有运行记录">
            {(run) => (
              <HistoryButton
                key={run.id}
                active={selection.kind === "run" && selection.id === run.id}
                icon={<FlaskConical size={14} />}
                title={run.id}
                meta={`${percent(run.scorecard.overallScore)} · ${run.scorecard.pendingAnnotationCount} pending`}
                onClick={() => onSelect({ kind: "run", id: run.id })}
              />
            )}
          </HistoryGroup>
          <HistoryGroup title="Needs Review" items={annotations} empty="没有待人工标注">
            {(task) => (
              <HistoryButton
                key={task.id}
                active={selection.kind === "annotation" && selection.id === task.id}
                icon={<UserCheck size={14} />}
                title={task.caseId}
                meta={`${task.evaluatorId} · ${task.scoreType}`}
                onClick={() => onSelect({ kind: "annotation", id: task.id })}
              />
            )}
          </HistoryGroup>
        </div>
      </div>
    </aside>
  );
}

function PlannerPanel({
  title,
  plannerInput,
  busy,
  onPlannerInput,
  onSubmit,
}: {
  title: string;
  plannerInput: string;
  busy: string;
  onPlannerInput: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Planner Agent</p>
        <h3 className="mt-2 text-lg font-semibold text-bench-950">{title}</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-bench-700">第一步先说清楚要评什么。Planner 会把目标拆成样本来源、heuristic、LLM judge、人工标注和复盘方式。</p>
      </div>
      <Textarea
        value={plannerInput}
        onChange={(event) => onPlannerInput(event.target.value)}
        className="min-h-[9rem] resize-none bg-white text-sm"
        placeholder="例如：评估 Auto Router 是否能在多轮上下文里选择正确 mode，需要 LLM judge 和人工复核低置信度 case。"
      />
      <button
        onClick={onSubmit}
        disabled={busy === "planner" || !plannerInput.trim()}
        className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy === "planner" ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
        让 Planner 生成 blueprint
      </button>
    </section>
  );
}

function BlueprintDetail({
  blueprint,
  datasets,
  datasetDetail,
  selectedDatasetId,
  selectedProfileId,
  selectedModes,
  modelRef,
  compiled,
  busy,
  plannerInput,
  onDatasetChange,
  onProfileChange,
  onModelRefChange,
  onModeToggle,
  onPlannerInput,
  onPlan,
  onCompile,
  onRun,
}: {
  blueprint: OraEvaluationBlueprint;
  datasets: OraEvaluationDataset[];
  datasetDetail?: OraEvaluationDatasetDetail;
  selectedDatasetId: string;
  selectedProfileId: EvalProfile;
  selectedModes: string[];
  modelRef: string;
  compiled?: OraEvaluationBlueprintCompileResult;
  busy: string;
  plannerInput: string;
  onDatasetChange: (value: string) => void;
  onProfileChange: (value: EvalProfile) => void;
  onModelRefChange: (value: string) => void;
  onModeToggle: (modeId: string) => void;
  onPlannerInput: (value: string) => void;
  onPlan: () => void;
  onCompile: () => void;
  onRun: () => void;
}) {
  const messages = plannerMessages(blueprint);
  const canRun = Boolean(selectedDatasetId || blueprint.datasetPlan.datasetId);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Blueprint</p>
          <h3 className="mt-2 text-xl font-semibold text-bench-950">{blueprint.title}</h3>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-bench-700">{blueprint.goal}</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-bench-800 ring-1 ring-inset ring-bench-200">{blueprint.status}</span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <Panel title="Planner Transcript" icon={<MessageSquare size={15} />}>
            <div className="space-y-2">
              {messages.length === 0 ? (
                <EmptyState title="还没有 planner 对话" description="继续输入评测目标，Planner 会更新这个 blueprint。" />
              ) : messages.map((message) => (
                <div key={message.id} className={cn("rounded-md px-3 py-2 text-sm leading-6 ring-1 ring-inset", message.role === "user" ? "bg-bench-900 text-white ring-bench-900" : "bg-white text-bench-800 ring-bench-200")}>
                  <div className="text-[11px] font-semibold uppercase opacity-70">{message.role}</div>
                  {message.content}
                </div>
              ))}
              <Textarea value={plannerInput} onChange={(event) => onPlannerInput(event.target.value)} className="min-h-[6rem] resize-none bg-white text-sm" placeholder="继续告诉 Planner 要调整的 evaluator、样本或运行对象。" />
              <button onClick={onPlan} disabled={busy === "planner" || !plannerInput.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-bench-900 px-3 text-sm font-semibold text-white disabled:opacity-50">
                {busy === "planner" ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}
                更新计划
              </button>
            </div>
          </Panel>

          <Panel title="Evaluator Mix" icon={<GitCompareArrows size={15} />}>
            <div className="grid gap-2 md:grid-cols-3">
              {evaluatorSpecs(blueprint).map((evaluator) => (
                <div key={evaluator.id} className="rounded-md bg-white p-3 ring-1 ring-inset ring-bench-200">
                  <div className="text-sm font-semibold text-bench-900">{evaluator.label}</div>
                  <div className="mt-1 text-xs font-semibold uppercase text-bench-600">{evaluator.kind}</div>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-bench-700">
                    {evaluator.kind === "heuristic" ? `${evaluator.metrics.length} metrics · ${evaluator.assertions.length} assertions` : evaluator.kind === "llm_judge" ? evaluator.rubric : evaluator.instructions}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <Panel title="Run Setup" icon={<FlaskConical size={15} />}>
          <div className="space-y-3">
            <Field label="数据集">
              <Select value={selectedDatasetId} onChange={(event) => onDatasetChange(event.target.value)}>
                <option value="">选择数据集</option>
                {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.caseCount}</option>)}
              </Select>
            </Field>
            <Field label="评测 Profile">
              <Select value={selectedProfileId} onChange={(event) => onProfileChange(event.target.value as EvalProfile)}>
                {PROFILE_OPTIONS.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
              </Select>
            </Field>
            <Field label="Model Ref">
              <input value={modelRef} onChange={(event) => onModelRefChange(event.target.value)} className="h-10 w-full rounded-md border border-bench-200 bg-white px-3 text-sm outline-none focus:border-bench-400" />
            </Field>
            {blueprint.recipe === "mode_comparison" && (
              <div>
                <div className="mb-2 text-xs font-semibold text-bench-700">Modes</div>
                <div className="flex flex-wrap gap-2">
                  {MODE_OPTIONS.map((modeId) => (
                    <button key={modeId} onClick={() => onModeToggle(modeId)} className={cn("rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset", selectedModes.includes(modeId) ? "bg-bench-900 text-white ring-bench-900" : "bg-white text-bench-800 ring-bench-200")}>{modeId}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Cases" value={datasetDetail?.dataset.caseCount ?? 0} />
              <MiniStat label="Missing" value={blueprint.missingInformation.length} />
            </div>
            <button onClick={onCompile} disabled={!canRun || busy.length > 0} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-bench-200 bg-white text-sm font-semibold disabled:opacity-50">
              <ClipboardCheck size={15} />
              预览 spec
            </button>
            <button onClick={onRun} disabled={!canRun || busy === "run"} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-bench-900 text-sm font-semibold text-white disabled:opacity-50">
              {busy === "run" ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />}
              运行评测
            </button>
          </div>
        </Panel>
      </div>

      {compiled && (
        <Panel title="Spec Preview" icon={<ClipboardCheck size={15} />}>
          <pre className="max-h-80 overflow-auto rounded-md bg-bench-950 p-3 text-xs leading-5 text-white">{JSON.stringify(compiled.spec, null, 2)}</pre>
        </Panel>
      )}
    </section>
  );
}

function RunDetail({ detail, busy, onExport }: { detail: OraEvaluationRunDetail; busy: string; onExport: (format: "json" | "csv") => void }) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Evaluation Run</p>
          <h3 className="mt-2 text-xl font-semibold text-bench-950">{detail.run.id}</h3>
          <p className="mt-2 text-sm text-bench-700">{detail.dataset.name} · {detail.run.totalAttempts} attempts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onExport("json")} disabled={busy === "export:json"} className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold"><Download size={15} />JSON</button>
          <button onClick={() => onExport("csv")} disabled={busy === "export:csv"} className="inline-flex h-9 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold"><Download size={15} />CSV</button>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <QuickStat label="Overall" value={percent(detail.run.scorecard.overallScore)} />
        <QuickStat label="Pass rate" value={percent(detail.run.scorecard.passRate)} />
        <QuickStat label="Regressions" value={String(detail.run.scorecard.regressionCount)} />
        <QuickStat label="Pending human" value={String(detail.run.scorecard.pendingAnnotationCount)} />
      </div>
      <Panel title="Config Scorecard" icon={<GitCompareArrows size={15} />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="text-xs uppercase text-bench-600">
              <tr><th className="py-2">Config</th><th>Score</th><th>Pass</th><th>Runtime</th><th>Failures</th></tr>
            </thead>
            <tbody>
              {detail.run.scorecard.configSummaries.map((summary) => (
                <tr key={summary.configId} className="border-t border-bench-200/70">
                  <td className="py-2 font-semibold">{summary.label}</td>
                  <td>{percent(summary.overallScore)}</td>
                  <td>{percent(summary.passRate)}</td>
                  <td>{summary.averageRuntimeMs}ms</td>
                  <td className="text-xs text-bench-700">{Object.keys(summary.failureTagCounts).join(", ") || "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Case Results" icon={<History size={15} />}>
        <div className="space-y-2">
          {detail.run.caseResults.map((result) => (
            <div key={`${result.caseId}:${result.configId}`} className="rounded-md bg-white p-3 ring-1 ring-inset ring-bench-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">{result.caseId} · {result.configId}</div>
                <span className="text-sm font-semibold">{percent(result.averageScore.overallScore)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {result.evaluatorResults.map((evaluator) => (
                  <span key={evaluator.evaluatorId} className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", evaluator.status === "pending" ? "bg-amber-50 text-amber-700" : evaluator.passed === false ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>{evaluator.evaluatorKind}: {evaluator.status}</span>
                ))}
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-bench-700">{result.averageScore.judgeRationale}</p>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function AnnotationDetail({ task, busy, onSubmit }: { task: OraEvaluationAnnotationTask; busy: string; onSubmit: (task: OraEvaluationAnnotationTask, passed: boolean) => void }) {
  return (
    <section className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Human Annotation</p>
        <h3 className="mt-2 text-xl font-semibold text-bench-950">{task.caseId}</h3>
        <p className="mt-2 text-sm leading-6 text-bench-700">{task.instructions}</p>
      </div>
      <Panel title="Case Evidence" icon={<UserCheck size={15} />}>
        <div className="grid gap-3 xl:grid-cols-2">
          <pre className="max-h-80 overflow-auto rounded-md bg-white p-3 text-xs leading-5 ring-1 ring-inset ring-bench-200">{JSON.stringify({ input: task.input, expected: task.expected }, null, 2)}</pre>
          <pre className="max-h-80 overflow-auto rounded-md bg-white p-3 text-xs leading-5 ring-1 ring-inset ring-bench-200">{JSON.stringify(task.output, null, 2)}</pre>
        </div>
      </Panel>
      {task.status === "pending" ? (
        <div className="flex gap-2">
          <button disabled={busy === `annotation:${task.id}`} onClick={() => onSubmit(task, true)} className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white"><Check size={15} />通过</button>
          <button disabled={busy === `annotation:${task.id}`} onClick={() => onSubmit(task, false)} className="inline-flex h-10 items-center gap-2 rounded-md bg-red-700 px-4 text-sm font-semibold text-white">不通过</button>
        </div>
      ) : (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">Annotation submitted.</div>
      )}
    </section>
  );
}

function ContextPanel({
  bridgeStatus,
  selection,
  datasets,
  blueprints,
  runs,
  baselines,
  annotations,
  activeProvider,
}: {
  bridgeStatus: RuntimeBridgeStatus;
  selection: Selection;
  datasets: OraEvaluationDataset[];
  blueprints: OraEvaluationBlueprint[];
  runs: OraEvaluationRun[];
  baselines: OraEvaluationBaseline[];
  annotations: OraEvaluationAnnotationTask[];
  activeProvider: string;
}) {
  return (
    <aside className="min-h-0 overflow-hidden rounded-[20px] border border-black/[0.035] bg-sidebar shadow-[0_1px_1px_rgba(23,23,23,0.04)]">
      <div className="h-full overflow-y-auto p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Current State</p>
        <h3 className="mt-2 text-lg font-semibold text-bench-950">{selection.kind === "new" ? "规划新评测" : selection.kind}</h3>
        <div className="mt-4 space-y-2">
          <QuickStat label="Runtime" value={bridgeStatus.ok ? "ready" : bridgeStatus.mode} />
          <QuickStat label="Provider" value={activeProvider} />
          <QuickStat label="Datasets" value={String(datasets.length)} />
          <QuickStat label="Blueprints" value={String(blueprints.length)} />
          <QuickStat label="Runs" value={String(runs.length)} />
          <QuickStat label="Baselines" value={String(baselines.length)} />
          <QuickStat label="Pending human" value={String(annotations.filter((task) => task.status === "pending").length)} />
        </div>
      </div>
    </aside>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-bench-900">{icon}{title}</div>
      {children}
    </section>
  );
}

function HistoryGroup<T>({ title, items, empty, children }: { title: string; items: T[]; empty: string; children: (item: T) => ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-600">{title}</div>
      <div className="space-y-1.5">
        {items.length === 0 ? <div className="rounded-md px-2 py-2 text-xs text-bench-600">{empty}</div> : items.map(children)}
      </div>
    </div>
  );
}

function HistoryButton({ active, icon, title, meta, onClick }: { active: boolean; icon: ReactNode; title: string; meta: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("w-full rounded-md px-2.5 py-2 text-left transition", active ? "bg-bench-900 text-white" : "text-bench-800 hover:bg-white")}>
      <div className="flex items-center gap-2 text-sm font-semibold">{icon}<span className="truncate">{title}</span></div>
      <div className={cn("mt-1 truncate text-xs", active ? "text-white/70" : "text-bench-600")}>{meta}</div>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-md bg-white px-2 py-1.5 ring-1 ring-inset ring-bench-200"><div className="text-[10px] font-semibold uppercase text-bench-600">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-white p-3 ring-1 ring-inset ring-bench-200"><div className="text-[11px] font-semibold uppercase text-bench-600">{label}</div><div className="mt-1 break-words text-sm font-semibold text-bench-900">{value}</div></div>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-md border border-dashed border-bench-200 bg-bench-50/60 px-3 py-4"><div className="text-sm font-semibold">{title}</div><p className="mt-1 text-sm leading-6 text-bench-700">{description}</p></div>;
}

function plannerMessages(blueprint: OraEvaluationBlueprint) {
  const raw = blueprint.reviewPlan.metadata.plannerMessages;
  if (!Array.isArray(raw)) return [];
  return raw.filter((message): message is { id: string; role: "user" | "assistant"; content: string; createdAt: number } => {
    if (!message || typeof message !== "object") return false;
    const record = message as Record<string, unknown>;
    return typeof record.id === "string" && (record.role === "user" || record.role === "assistant") && typeof record.content === "string" && typeof record.createdAt === "number";
  });
}

function evaluatorSpecs(blueprint: OraEvaluationBlueprint) {
  if (blueprint.evaluatorPlan.evaluators.length > 0) return blueprint.evaluatorPlan.evaluators;
  return [{
    id: "heuristic",
    kind: "heuristic" as const,
    label: "Heuristic Rules",
    metrics: blueprint.evaluatorPlan.metrics,
    assertions: blueprint.evaluatorPlan.assertions,
    weight: 1,
    metadata: {},
  }];
}

function evaluatorKinds(blueprint: OraEvaluationBlueprint) {
  return [...new Set(evaluatorSpecs(blueprint).map((evaluator) => evaluator.kind))];
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function inferSourceFormat(fileName: string): "json" | "jsonl" | "csv" | "inline" {
  const lowered = fileName.toLowerCase();
  if (lowered.endsWith(".jsonl")) return "jsonl";
  if (lowered.endsWith(".csv")) return "csv";
  if (lowered.endsWith(".json")) return "json";
  return "inline";
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
