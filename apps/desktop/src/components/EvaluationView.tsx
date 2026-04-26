import { BarChart3, Check, Download, FileUp, FlaskConical, GitCompareArrows, Loader2, MessageSquareWarning, Trophy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWorkbench } from "../lib/state";
import type {
  OraEvaluationBaseline,
  OraEvaluationCaseResult,
  OraEvaluationDataset,
  OraEvaluationDatasetDetail,
  OraEvaluationFeedbackRecord,
  OraEvaluationRun,
  OraEvaluationRunDetail,
  OraEvaluationSpec,
  RuntimeClient,
} from "../lib/runtimeClient";
import type { RuntimeBridgeStatus } from "../types";
import { runnableProviderOptions } from "../lib/providerOptions";
import { cn } from "../lib/utils";
import { ChoiceCard } from "./ui/choice-card";
import { Field } from "./ui/field";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

type EvaluationTab = "overview" | "regression" | "lab" | "feedback";
type EvaluationStep = "samples" | "target" | "run" | "review";

const PROFILE_OPTIONS: Array<{ id: "outcome" | "orchestration" | "task_completion"; label: string; description: string }> = [
  { id: "outcome", label: "结果质量", description: "重点看最终回答是否满足用户目标。" },
  { id: "orchestration", label: "协作过程", description: "重点看工具调用、交接、澄清和执行轨迹。" },
  { id: "task_completion", label: "任务完成", description: "重点看环境任务是否被完整完成。" },
];

export function EvaluationView({
  runtimeClient,
  bridgeStatus,
}: {
  runtimeClient: RuntimeClient;
  bridgeStatus: RuntimeBridgeStatus;
}) {
  const { state } = useWorkbench();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<EvaluationTab>("regression");
  const [activeStep, setActiveStep] = useState<EvaluationStep>("samples");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [datasets, setDatasets] = useState<OraEvaluationDataset[]>([]);
  const [runs, setRuns] = useState<OraEvaluationRun[]>([]);
  const [baselines, setBaselines] = useState<OraEvaluationBaseline[]>([]);
  const [feedbackRecords, setFeedbackRecords] = useState<OraEvaluationFeedbackRecord[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [selectedCaseKey, setSelectedCaseKey] = useState<string>("");
  const [selectedProfileId, setSelectedProfileId] = useState<"outcome" | "orchestration" | "task_completion">("outcome");
  const [selectedPatterns, setSelectedPatterns] = useState<string[]>(["orchestrator_subagent", "agent_teams"]);
  const [repetitions, setRepetitions] = useState(1);
  const [baselineId, setBaselineId] = useState<string>("");
  const [modelRef, setModelRef] = useState("local/smoke-model");
  const [runDetail, setRunDetail] = useState<OraEvaluationRunDetail | undefined>();
  const [datasetDetail, setDatasetDetail] = useState<OraEvaluationDatasetDetail | undefined>();
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const providerOptions = runnableProviderOptions(state.providerRegistry?.providers ?? [], state.providerSecretStatuses);
  const activeProvider = providerOptions.find((provider) => provider.id === state.selectedProviderId) ?? providerOptions[0];

  async function refreshIndex() {
    const [nextDatasetsResult, nextRunsResult, nextBaselinesResult, nextFeedbackResult] = await Promise.all([
      runtimeClient.listEvaluationDatasets(),
      runtimeClient.listEvaluationRuns(),
      runtimeClient.listEvaluationBaselines(),
      runtimeClient.listEvaluationFeedback({ limit: 200 }),
    ]);
    const nextDatasets = Array.isArray(nextDatasetsResult) ? nextDatasetsResult : [];
    const nextRuns = Array.isArray(nextRunsResult) ? nextRunsResult : [];
    const nextBaselines = Array.isArray(nextBaselinesResult) ? nextBaselinesResult : [];
    const nextFeedback = Array.isArray(nextFeedbackResult) ? nextFeedbackResult : [];
    if (!Array.isArray(nextDatasetsResult) || !Array.isArray(nextRunsResult) || !Array.isArray(nextBaselinesResult) || !Array.isArray(nextFeedbackResult)) {
      setError("Evaluation index returned an invalid response.");
    }
    setDatasets(nextDatasets);
    setRuns(nextRuns);
    setBaselines(nextBaselines);
    setFeedbackRecords(nextFeedback);
    if (!selectedDatasetId && nextDatasets[0]) {
      setSelectedDatasetId(nextDatasets[0].id);
    }
    if (!selectedRunId && nextRuns[0]) {
      setSelectedRunId(nextRuns[0].id);
    }
  }

  useEffect(() => {
    void refreshIndex().catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Failed to load evaluation index."));
  }, []);

  useEffect(() => {
    if (!selectedDatasetId) {
      setDatasetDetail(undefined);
      return;
    }
    void runtimeClient.getEvaluationDataset(selectedDatasetId)
      .then(setDatasetDetail)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Failed to load evaluation dataset."));
  }, [runtimeClient, selectedDatasetId]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(undefined);
      return;
    }
    void runtimeClient.getEvaluationRun(selectedRunId)
      .then((detail) => {
        setRunDetail(detail);
        if (!selectedCaseKey && detail.run.caseResults[0]) {
          setSelectedCaseKey(`${detail.run.caseResults[0].caseId}:${detail.run.caseResults[0].configId}`);
        }
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Failed to load evaluation run."));
  }, [runtimeClient, selectedRunId]);

  const runBaselines = useMemo(() => baselines.filter((baseline) => !selectedDatasetId || baseline.datasetId === selectedDatasetId), [baselines, selectedDatasetId]);
  const caseDetails = useMemo(() => {
    if (!runDetail) return [];
    const grouped = new Map<string, { caseId: string; results: OraEvaluationCaseResult[] }>();
    for (const result of runDetail.run.caseResults) {
      const entry = grouped.get(result.caseId) ?? { caseId: result.caseId, results: [] };
      entry.results.push(result);
      grouped.set(result.caseId, entry);
    }
    return [...grouped.values()];
  }, [runDetail]);
  const selectedCase = useMemo(() => {
    const [caseId] = selectedCaseKey.split(":");
    return caseDetails.find((entry) => entry.caseId === caseId);
  }, [caseDetails, selectedCaseKey]);
  const selectedDataset = datasetDetail?.dataset ?? datasets.find((dataset) => dataset.id === selectedDatasetId);
  const pendingFeedback = useMemo(() => feedbackRecords.filter((record) => record.status === "pending" || record.status === "failed"), [feedbackRecords]);
  const selectedDatasetRuns = useMemo(() => runs.filter((run) => !selectedDatasetId || run.spec.datasetId === selectedDatasetId), [runs, selectedDatasetId]);
  const bestConfig = useMemo(() => {
    if (!runDetail?.run.scorecard.configSummaries.length) return undefined;
    return [...runDetail.run.scorecard.configSummaries].sort((left, right) => right.overallScore - left.overallScore)[0];
  }, [runDetail]);
  const topFailureTags = useMemo(() => {
    if (!runDetail) return [];
    const counts = new Map<string, number>();
    for (const summary of runDetail.run.scorecard.configSummaries) {
      for (const [tag, count] of Object.entries(summary.failureTagCounts)) {
        counts.set(tag, (counts.get(tag) ?? 0) + count);
      }
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4);
  }, [runDetail]);
  const canRunEvaluation = Boolean(selectedDatasetId && selectedPatterns.length > 0 && busy.length === 0);
  const nextAction = !selectedDatasetId
    ? "先准备样本"
    : selectedPatterns.length === 0
      ? "选择评测对象"
      : runDetail
        ? "复盘这次结果"
        : "运行这组评测";

  async function handleImportDataset(file: File) {
    setBusy("import");
    setError("");
    try {
      const detail = await runtimeClient.importEvaluationDataset({
        name: file.name.replace(/\.[^.]+$/, ""),
        sourceFileName: file.name,
        content: await file.text(),
        sourceFormat: inferSourceFormat(file.name),
      });
      await refreshIndex();
      setSelectedDatasetId(detail.dataset.id);
      setActiveStep("target");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to import dataset.");
    } finally {
      setBusy("");
    }
  }

  async function handleRunEvaluation() {
    if (!selectedDatasetId || selectedPatterns.length === 0) return;
    setBusy("run");
    setError("");
    try {
      const spec: OraEvaluationSpec = {
        datasetId: selectedDatasetId,
        profileId: selectedProfileId,
        repetitions,
        concurrency: 1,
        baselineId: baselineId || undefined,
        metadata: {},
        configs: selectedPatterns.map((pattern) => ({
          id: `${pattern}-${activeProvider?.id ?? "local-smoke"}`,
          label: `${pattern.replace(/_/g, " ")} · ${activeProvider?.label ?? "Smoke"}`,
          runConfig: {
            pattern: pattern as OraEvaluationSpec["configs"][number]["runConfig"]["pattern"],
            providerId: activeProvider?.id ?? "local-smoke",
            modelRef,
          },
        })),
      };
      const detail = await runtimeClient.startEvaluationRun(spec);
      await refreshIndex();
      setSelectedRunId(detail.run.id);
      setRunDetail(detail);
      setActiveStep("review");
      setTab("overview");
      if (detail.run.caseResults[0]) {
        setSelectedCaseKey(`${detail.run.caseResults[0].caseId}:${detail.run.caseResults[0].configId}`);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to start evaluation run.");
    } finally {
      setBusy("");
    }
  }

  async function handlePromoteBaseline(configId: string) {
    if (!runDetail) return;
    setBusy(`baseline:${configId}`);
    setError("");
    try {
      const baseline = await runtimeClient.promoteEvaluationBaseline(runDetail.run.id, configId);
      await refreshIndex();
      setBaselineId(baseline.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to promote baseline.");
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
      setError(nextError instanceof Error ? nextError.message : "Failed to export evaluation run.");
    } finally {
      setBusy("");
    }
  }

  async function handleAcceptFeedback(feedbackId: string) {
    setBusy(`feedback-accept:${feedbackId}`);
    setError("");
    try {
      const record = await runtimeClient.acceptEvaluationFeedback(feedbackId);
      await refreshIndex();
      setSelectedDatasetId(record.datasetId ?? "feedback-chat");
      setActiveStep("target");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to accept feedback.");
    } finally {
      setBusy("");
    }
  }

  async function handleRejectFeedback(feedbackId: string) {
    setBusy(`feedback-reject:${feedbackId}`);
    setError("");
    try {
      await runtimeClient.rejectEvaluationFeedback(feedbackId);
      await refreshIndex();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to reject feedback.");
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
            <h2 className="mt-1 text-xl font-semibold text-bench-900">评测工作台</h2>
            <p className="mt-1 text-sm leading-6 text-bench-700">按步骤把聊天反馈和数据集转成可复盘的 Agent 质量回归。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50 active:scale-[0.98]"
            >
              <FileUp size={16} />
              导入数据集
            </button>
            <button
              onClick={() => {
                if (!selectedDatasetId) {
                  setActiveStep("samples");
                  fileInputRef.current?.click();
                } else if (selectedPatterns.length === 0) {
                  setActiveStep("target");
                } else if (runDetail) {
                  setActiveStep("review");
                } else {
                  setActiveStep("run");
                  void handleRunEvaluation();
                }
              }}
              disabled={busy.length > 0}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
            >
              {busy === "run" ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
              {nextAction}
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

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 lg:overflow-hidden">
        <div className="grid gap-2 md:grid-cols-4">
          <WorkflowStepButton
            active={activeStep === "samples"}
            complete={Boolean(selectedDatasetId)}
            index="1"
            title="准备样本"
            description={selectedDataset ? `${selectedDataset.caseCount} cases ready` : "导入数据或审核反馈"}
            onClick={() => setActiveStep("samples")}
          />
          <WorkflowStepButton
            active={activeStep === "target"}
            complete={selectedPatterns.length > 0}
            index="2"
            title="选择对象"
            description={`${selectedPatterns.length} modes · ${PROFILE_OPTIONS.find((profile) => profile.id === selectedProfileId)?.label}`}
            onClick={() => setActiveStep("target")}
          />
          <WorkflowStepButton
            active={activeStep === "run"}
            complete={Boolean(runDetail)}
            index="3"
            title="运行评测"
            description={selectedDatasetId ? "配置就绪后执行" : "等待样本"}
            onClick={() => setActiveStep("run")}
          />
          <WorkflowStepButton
            active={activeStep === "review"}
            complete={Boolean(runDetail)}
            index="4"
            title="复盘沉淀"
            description={runDetail ? `${formatPercent(runDetail.run.scorecard.overallScore)} overall` : "查看结论和失败样本"}
            onClick={() => setActiveStep("review")}
          />
        </div>

        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_21rem] lg:overflow-hidden">
          <section className="min-h-[34rem] min-w-0 overflow-hidden rounded-[20px] border border-black/[0.035] bg-sidebar shadow-[0_1px_1px_rgba(23,23,23,0.04),0_8px_18px_rgba(23,23,23,0.024)]">
            <div className="flex h-full min-h-0 flex-col overflow-y-auto px-5 py-5">
              {activeStep === "samples" && (
                <div className="space-y-5">
                  <div className="grid gap-3 xl:grid-cols-[1fr_1.25fr]">
                    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Step 1</p>
                          <h3 className="mt-2 text-lg font-semibold">准备可复盘的样本</h3>
                          <p className="mt-2 text-sm leading-6 text-bench-700">样本可以来自文件，也可以来自聊天里的自然语言反馈。先把问题沉淀成 case，再去跑模式对比。</p>
                        </div>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-bench-900 px-3 text-xs font-semibold text-white transition active:scale-[0.98]"
                        >
                          <FileUp size={14} />
                          导入
                        </button>
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <QuickStat label="数据集" value={String(datasets.length)} />
                        <QuickStat label="待审反馈" value={String(pendingFeedback.length)} />
                        <QuickStat label="已运行" value={String(runs.length)} />
                      </div>
                    </div>

                    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Feedback Inbox</p>
                          <h3 className="mt-2 text-lg font-semibold">先处理聊天反馈</h3>
                        </div>
                        {pendingFeedback.length > 0 ? (
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">{pendingFeedback.length} pending</span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">clean</span>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-bench-700">接受后的反馈会进入 `feedback-chat` 数据集，下一步可以直接用于回归评测。</p>
                      <div className="mt-4">
                        <FeedbackInbox
                          records={feedbackRecords}
                          busy={busy}
                          compact
                          onAccept={(feedbackId) => void handleAcceptFeedback(feedbackId)}
                          onReject={(feedbackId) => void handleRejectFeedback(feedbackId)}
                        />
                      </div>
                    </div>
                  </div>

                  <Section title="可用数据集" description="选择一个数据集作为这次评测的样本来源。">
                    {datasets.length === 0 ? (
                      <EmptyState title="还没有数据集" description="导入 JSON / JSONL / CSV，或先从聊天反馈接受一个 case，Ora 会生成 feedback-chat 数据集。" />
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {datasets.map((dataset) => (
                          <DatasetCard
                            key={dataset.id}
                            dataset={dataset}
                            active={dataset.id === selectedDatasetId}
                            runCount={runs.filter((run) => run.spec.datasetId === dataset.id).length}
                            onClick={() => {
                              setSelectedDatasetId(dataset.id);
                              setActiveStep("target");
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </Section>
                </div>
              )}

              {activeStep === "target" && (
                <div className="space-y-5">
                  <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Step 2</p>
                    <h3 className="mt-2 text-lg font-semibold">选择要验证的 Agent 行为</h3>
                    <p className="mt-2 text-sm leading-6 text-bench-700">默认用当前设置里的 provider，选择评测目标和模式矩阵即可。基线、模型引用和重复次数收在高级设置里。</p>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[19rem_1fr]">
                    <div className="space-y-4 rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                      <Field label="样本集">
                        <Select aria-label="Dataset" value={selectedDatasetId} onChange={(event) => setSelectedDatasetId(event.target.value)}>
                          <option value="">选择数据集</option>
                          {datasets.map((dataset) => (
                            <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
                          ))}
                        </Select>
                      </Field>
                      {selectedDataset ? (
                        <div className="rounded-md bg-bench-50 px-3 py-3 ring-1 ring-inset ring-bench-200">
                          <div className="text-sm font-semibold">{selectedDataset.name}</div>
                          <div className="mt-1 text-xs text-bench-700">{selectedDataset.caseCount} cases · {selectedDataset.sourceFormat.toUpperCase()}</div>
                          {datasetDetail && datasetDetail.metadataKeys.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {datasetDetail.metadataKeys.map((key) => (
                                <span key={key} className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">{key}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <Field label="评测目标" hint={PROFILE_OPTIONS.find((profile) => profile.id === selectedProfileId)?.description}>
                        <Select aria-label="Profile" value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value as typeof selectedProfileId)}>
                          {PROFILE_OPTIONS.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.label}</option>
                          ))}
                        </Select>
                      </Field>
                    </div>

                    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold">Agent modes</h3>
                          <p className="mt-1 text-xs leading-5 text-bench-700">选择一个或多个模式，Ora 会为每个模式生成一组评测配置。</p>
                        </div>
                        <span className="rounded-full bg-bench-50 px-2.5 py-1 text-xs font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">{selectedPatterns.length} selected</span>
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-2">
                        {state.patterns.map((pattern) => (
                          <ChoiceCard
                            key={pattern.id}
                            title={pattern.label}
                            description={pattern.summary}
                            checked={selectedPatterns.includes(pattern.id)}
                            onChange={(event) => setSelectedPatterns((current) => event.target.checked ? [...current, pattern.id] : current.filter((item) => item !== pattern.id))}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((current) => !current)}
                      className="flex w-full items-center justify-between text-left text-sm font-semibold"
                    >
                      高级设置
                      <span className="text-xs text-bench-700">{showAdvanced ? "收起" : "展开"}</span>
                    </button>
                    {showAdvanced ? (
                      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Field label="Provider" hint="v1 使用 Settings 中选中的提供方。">
                          <Select aria-label="Provider" value={activeProvider?.id ?? ""} disabled>
                            {providerOptions.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.label}</option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Baseline">
                          <Select aria-label="Baseline" value={baselineId} onChange={(event) => setBaselineId(event.target.value)}>
                            <option value="">No baseline</option>
                            {runBaselines.map((baseline) => (
                              <option key={baseline.id} value={baseline.id}>{baseline.name}</option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Model ref">
                          <Input aria-label="Model ref" value={modelRef} onChange={(event) => setModelRef(event.target.value)} className="font-mono" />
                        </Field>
                        <Field label="Repetitions">
                          <Input
                            aria-label="Repetitions"
                            type="number"
                            min={1}
                            max={5}
                            value={repetitions}
                            onChange={(event) => setRepetitions(Math.max(1, Math.min(5, Number(event.target.value) || 1)))}
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button onClick={() => setActiveStep("run")} className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition active:scale-[0.98]">
                      下一步：运行评测
                    </button>
                  </div>
                </div>
              )}

              {activeStep === "run" && (
                <div className="space-y-5">
                  <div className="rounded-xl bg-white p-5 ring-1 ring-inset ring-bench-200">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Step 3</p>
                    <h3 className="mt-2 text-lg font-semibold">运行这组评测</h3>
                    <p className="mt-2 text-sm leading-6 text-bench-700">确认样本、目标和模式矩阵后，Ora 会复用现有 runs.start 路径执行每个 case，并生成 scorecard、trace id 和可导出的结果。</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
                      <QuickStat label="样本" value={selectedDataset ? String(selectedDataset.caseCount) : "0"} />
                      <QuickStat label="模式" value={String(selectedPatterns.length)} />
                      <QuickStat label="重复" value={String(repetitions)} />
                      <QuickStat label="Provider" value={activeProvider?.label ?? "Smoke"} />
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void handleRunEvaluation()}
                        disabled={!canRunEvaluation}
                        className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
                      >
                        {busy === "run" ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
                        运行这组评测
                      </button>
                      {!selectedDatasetId ? <p className="text-sm text-red-700">请先选择或导入数据集。</p> : null}
                      {selectedPatterns.length === 0 ? <p className="text-sm text-red-700">请至少选择一个 Agent mode。</p> : null}
                    </div>
                  </div>

                  <Section title="最近运行" description="可以直接打开历史运行继续复盘。">
                    {selectedDatasetRuns.length === 0 ? (
                      <EmptyState title="还没有运行记录" description="运行完成后会自动进入复盘页。" />
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {selectedDatasetRuns.slice(0, 6).map((run) => (
                          <button
                            key={run.id}
                            onClick={() => {
                              setSelectedRunId(run.id);
                              setActiveStep("review");
                              setTab("overview");
                            }}
                            className={cn(
                              "rounded-xl bg-white p-4 text-left ring-1 ring-inset transition hover:bg-bench-50 active:scale-[0.99]",
                              run.id === selectedRunId ? "ring-bench-400" : "ring-bench-200",
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-mono text-xs font-semibold text-bench-700">{run.id}</span>
                              <span className="rounded-full bg-bench-50 px-2 py-0.5 text-[11px] font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">{run.status}</span>
                            </div>
                            <div className="mt-3 text-sm font-semibold">{formatPercent(run.scorecard.overallScore)} overall</div>
                            <div className="mt-1 text-xs text-bench-700">{run.totalAttempts} attempts · {run.spec.configs.length} configs</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </Section>
                </div>
              )}

              {activeStep === "review" && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Step 4</p>
                      <h3 className="mt-1 text-lg font-semibold">复盘沉淀</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select aria-label="Evaluation run" value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)} wrapperClassName="min-w-[14rem]">
                        <option value="">选择评测运行</option>
                        {runs.map((run) => (
                          <option key={run.id} value={run.id}>{run.id} · {run.spec.profileId}</option>
                        ))}
                      </Select>
                      <button onClick={() => void handleExport("json")} disabled={!runDetail || busy.startsWith("export")} className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50">
                        <Download size={15} />
                        JSON
                      </button>
                      <button onClick={() => void handleExport("csv")} disabled={!runDetail || busy.startsWith("export")} className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50">
                        <Download size={15} />
                        CSV
                      </button>
                    </div>
                  </div>

                  {tab === "feedback" ? (
                    <div>
                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        <TabButton active={false} label="Overview" icon={Trophy} onClick={() => setTab("overview")} />
                        <TabButton active={false} label="Regression" icon={GitCompareArrows} onClick={() => setTab("regression")} />
                        <TabButton active={false} label="Lab" icon={BarChart3} onClick={() => setTab("lab")} />
                        <TabButton active label="Feedback" icon={MessageSquareWarning} onClick={() => setTab("feedback")} />
                      </div>
                      <FeedbackInbox
                        records={feedbackRecords}
                        busy={busy}
                        onAccept={(feedbackId) => void handleAcceptFeedback(feedbackId)}
                        onReject={(feedbackId) => void handleRejectFeedback(feedbackId)}
                      />
                    </div>
                  ) : runDetail ? (
                    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
                      <EvaluationResultPanel
                        runDetail={runDetail}
                        tab={tab}
                        bestConfig={bestConfig}
                        topFailureTags={topFailureTags}
                        selectedCaseKey={selectedCaseKey}
                        busy={busy}
                        onTabChange={setTab}
                        onPromoteBaseline={(configId) => void handlePromoteBaseline(configId)}
                        onSelectCase={(result) => setSelectedCaseKey(`${result.caseId}:${result.configId}`)}
                      />
                      <CaseDetailPanel datasetDetail={datasetDetail} selectedCase={selectedCase} />
                    </div>
                  ) : (
                    <EmptyState title="还没有可复盘的评测" description="先完成一次运行，或者从右上角选择历史评测运行。" />
                  )}
                </div>
              )}
            </div>
          </section>

          <aside className="min-h-0 overflow-hidden rounded-[20px] border border-black/[0.035] bg-sidebar p-4 shadow-[0_1px_1px_rgba(23,23,23,0.04)]">
            <div className="flex h-full min-h-0 flex-col overflow-y-auto">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Current state</p>
              <h3 className="mt-1 text-base font-semibold">下一步：{nextAction}</h3>
              <div className="mt-4 grid gap-2">
                <QuickStat label="当前数据集" value={selectedDataset?.name ?? "未选择"} />
                <QuickStat label="待审反馈" value={String(pendingFeedback.length)} />
                <QuickStat label="最近运行" value={runs[0]?.id ?? "无"} />
                <QuickStat label="Provider" value={activeProvider?.label ?? bridgeStatus.mode} />
              </div>
              {runDetail ? (
                <div className="mt-4 rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Latest insight</p>
                  <div className="mt-2 text-2xl font-semibold">{formatPercent(runDetail.run.scorecard.overallScore)}</div>
                  <p className="mt-2 text-sm leading-6 text-bench-700">
                    {bestConfig ? `${bestConfig.label} 当前最高，${runDetail.run.scorecard.regressionCount} 个退化样本需要复盘。` : "运行已完成，可以进入结果页复盘。"}
                  </p>
                </div>
              ) : null}
              {error ? <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function WorkflowStepButton({
  active,
  complete,
  index,
  title,
  description,
  onClick,
}: {
  active: boolean;
  complete: boolean;
  index: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-h-[5rem] items-start gap-3 rounded-[14px] bg-sidebar px-4 py-3 text-left ring-1 ring-inset transition hover:bg-bench-50 active:scale-[0.99]",
        active ? "ring-bench-400 shadow-[0_1px_3px_rgba(23,23,23,0.08)]" : "ring-bench-200",
      )}
    >
      <span className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset",
        complete ? "bg-bench-900 text-white ring-bench-900" : "bg-white text-bench-700 ring-bench-200",
      )}>
        {complete ? <Check size={14} /> : index}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-bench-900">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-bench-700">{description}</span>
      </span>
    </button>
  );
}

function QuickStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-bench-50 px-3 py-2 ring-1 ring-inset ring-bench-200">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-bench-900">{value}</div>
    </div>
  );
}

function DatasetCard({
  dataset,
  active,
  runCount,
  onClick,
}: {
  dataset: OraEvaluationDataset;
  active: boolean;
  runCount: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl bg-white p-4 text-left ring-1 ring-inset transition hover:bg-bench-50 active:scale-[0.99]",
        active ? "ring-bench-400 shadow-[0_1px_3px_rgba(23,23,23,0.08)]" : "ring-bench-200",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{dataset.name}</div>
          <div className="mt-1 text-xs text-bench-700">{dataset.caseCount} cases · {dataset.sourceFormat.toUpperCase()}</div>
        </div>
        <span className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
          active ? "bg-bench-900 text-white ring-bench-900" : "bg-bench-50 text-bench-700 ring-bench-200",
        )}>
          {active ? "selected" : "ready"}
        </span>
      </div>
      <div className="mt-3 text-xs text-bench-700">{runCount} evaluation runs</div>
    </button>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl bg-white px-4 py-6 text-sm ring-1 ring-inset ring-bench-200">
      <div className="font-semibold text-bench-900">{title}</div>
      <p className="mt-2 leading-6 text-bench-700">{description}</p>
    </div>
  );
}

function EvaluationResultPanel({
  runDetail,
  tab,
  bestConfig,
  topFailureTags,
  selectedCaseKey,
  busy,
  onTabChange,
  onPromoteBaseline,
  onSelectCase,
}: {
  runDetail: OraEvaluationRunDetail;
  tab: EvaluationTab;
  bestConfig?: OraEvaluationRunDetail["run"]["scorecard"]["configSummaries"][number];
  topFailureTags: Array<[string, number]>;
  selectedCaseKey: string;
  busy: string;
  onTabChange: (tab: EvaluationTab) => void;
  onPromoteBaseline: (configId: string) => void;
  onSelectCase: (result: OraEvaluationCaseResult) => void;
}) {
  return (
    <div className="min-w-0 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center gap-2">
        <TabButton active={tab === "overview"} label="Overview" icon={Trophy} onClick={() => onTabChange("overview")} />
        <TabButton active={tab === "regression"} label="Regression" icon={GitCompareArrows} onClick={() => onTabChange("regression")} />
        <TabButton active={tab === "lab"} label="Lab" icon={BarChart3} onClick={() => onTabChange("lab")} />
        <TabButton active={tab === "feedback"} label="Feedback" icon={MessageSquareWarning} onClick={() => onTabChange("feedback")} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <SummaryCard label="Overall score" value={formatPercent(runDetail.run.scorecard.overallScore)} accent="Score" />
        <SummaryCard label="Pass rate" value={formatPercent(runDetail.run.scorecard.passRate)} accent="Pass" />
        <SummaryCard label="Regressions" value={String(runDetail.run.scorecard.regressionCount)} accent="Diff" />
        <SummaryCard label="Avg runtime" value={`${runDetail.run.scorecard.averageRuntimeMs} ms`} accent="Latency" />
        <SummaryCard label="Avg cost" value={`$${runDetail.run.scorecard.averageCostUsd.toFixed(4)}`} accent="Cost" />
      </div>

      {tab === "overview" ? (
        <>
          <Section title="本次结论" description="先看哪一组表现最好，再决定是否提升 baseline 或继续看失败样本。">
            <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Recommended readout</div>
                <h4 className="mt-2 text-base font-semibold">{bestConfig ? bestConfig.label : "No winning config yet"}</h4>
                <p className="mt-2 text-sm leading-6 text-bench-700">
                  {bestConfig
                    ? `${formatPercent(bestConfig.overallScore)} overall, ${formatPercent(bestConfig.passRate)} pass rate. Use this as the baseline only if the case-level failures look acceptable.`
                    : "Run details did not include config summaries."}
                </p>
                {bestConfig ? (
                  <button
                    onClick={() => onPromoteBaseline(bestConfig.configId)}
                    disabled={busy === `baseline:${bestConfig.configId}`}
                    className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition disabled:opacity-50 active:scale-[0.98]"
                  >
                    {busy === `baseline:${bestConfig.configId}` ? <Loader2 size={13} className="animate-spin" /> : <Trophy size={13} />}
                    Promote baseline
                  </button>
                ) : null}
              </div>
              <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Failure themes</div>
                {topFailureTags.length === 0 ? (
                  <p className="mt-2 text-sm leading-6 text-bench-700">No failure tags were reported.</p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {topFailureTags.map(([tag, count]) => (
                      <span key={tag} className="rounded-full bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-200">{tag} · {count}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Section>
          <Section title="Case Browser" description="从失败或低分样本开始看，右侧会展示预期、judge 理由和 trace id。">
            <CaseTable results={runDetail.run.caseResults} selectedCaseKey={selectedCaseKey} onSelect={onSelectCase} />
          </Section>
        </>
      ) : null}

      {tab === "regression" ? (
        <>
          <Section title="Config Comparison" description="Compare score, pass rate, cost, and regressions across the current config matrix.">
            <ConfigComparisonTable runDetail={runDetail} busy={busy} onPromoteBaseline={onPromoteBaseline} />
          </Section>
          <Section title="Regressions" description="Cases that scored below the selected baseline under the current run.">
            <CaseTable
              results={runDetail.run.caseResults.filter((result) => result.comparisonToBaseline?.regressed)}
              selectedCaseKey={selectedCaseKey}
              onSelect={onSelectCase}
            />
          </Section>
        </>
      ) : null}

      {tab === "lab" ? (
        <>
          <Section title="Experiment Matrix" description="Leaderboard-style comparison across the current eval configs.">
            <div className="grid gap-3 md:grid-cols-3">
              {[...runDetail.run.scorecard.configSummaries]
                .sort((left, right) => right.overallScore - left.overallScore)
                .map((summary) => (
                  <div key={summary.configId} className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                    <div className="text-sm font-semibold">{summary.label}</div>
                    <div className="mt-2 text-2xl font-semibold">{formatPercent(summary.overallScore)}</div>
                    <div className="mt-2 text-xs leading-5 text-bench-700">
                      Pass {formatPercent(summary.passRate)} · {summary.caseCount} cases · {summary.averageRuntimeMs} ms
                    </div>
                  </div>
                ))}
            </div>
          </Section>
          <Section title="Slice Analysis" description="Break scores down by tags, difficulty, and task type metadata.">
            <SliceAnalysisTable runDetail={runDetail} />
          </Section>
          <Section title="Failure Clusters" description="Group the current run's attempts by failure tag to highlight dominant error modes.">
            <div className="grid gap-3 md:grid-cols-3">
              {runDetail.run.scorecard.configSummaries.flatMap((summary) =>
                Object.entries(summary.failureTagCounts).map(([tag, count]) => (
                  <div key={`${summary.configId}:${tag}`} className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">{summary.label}</div>
                    <div className="mt-2 text-lg font-semibold">{tag}</div>
                    <div className="mt-1 text-sm text-bench-700">{count} attempts flagged</div>
                  </div>
                ))
              )}
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}

function ConfigComparisonTable({
  runDetail,
  busy,
  onPromoteBaseline,
}: {
  runDetail: OraEvaluationRunDetail;
  busy: string;
  onPromoteBaseline: (configId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-inset ring-bench-200">
      <table className="min-w-full text-sm">
        <thead className="bg-bench-50 text-left text-xs uppercase tracking-[0.08em] text-bench-700">
          <tr>
            <th className="px-4 py-3">Config</th>
            <th className="px-4 py-3">Overall</th>
            <th className="px-4 py-3">Pass</th>
            <th className="px-4 py-3">Runtime</th>
            <th className="px-4 py-3">Cost</th>
            <th className="px-4 py-3">Regressions</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {runDetail.run.scorecard.configSummaries.map((summary) => (
            <tr key={summary.configId} className="border-t border-bench-100">
              <td className="px-4 py-3 font-medium">{summary.label}</td>
              <td className="px-4 py-3">{formatPercent(summary.overallScore)}</td>
              <td className="px-4 py-3">{formatPercent(summary.passRate)}</td>
              <td className="px-4 py-3">{summary.averageRuntimeMs} ms</td>
              <td className="px-4 py-3">${summary.averageCostUsd.toFixed(4)}</td>
              <td className="px-4 py-3">{summary.regressionCount}</td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => onPromoteBaseline(summary.configId)}
                  disabled={busy === `baseline:${summary.configId}`}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition disabled:opacity-50"
                >
                  {busy === `baseline:${summary.configId}` ? <Loader2 size={12} className="animate-spin" /> : <Trophy size={12} />}
                  Promote baseline
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SliceAnalysisTable({ runDetail }: { runDetail: OraEvaluationRunDetail }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-inset ring-bench-200">
      <table className="min-w-full text-sm">
        <thead className="bg-bench-50 text-left text-xs uppercase tracking-[0.08em] text-bench-700">
          <tr>
            <th className="px-4 py-3">Dimension</th>
            <th className="px-4 py-3">Value</th>
            <th className="px-4 py-3">Config</th>
            <th className="px-4 py-3">Cases</th>
            <th className="px-4 py-3">Overall</th>
          </tr>
        </thead>
        <tbody>
          {runDetail.run.scorecard.slices.map((slice) => (
            <tr key={`${slice.dimension}:${slice.value}:${slice.configId}`} className="border-t border-bench-100">
              <td className="px-4 py-3 font-medium">{slice.dimension}</td>
              <td className="px-4 py-3">{slice.value}</td>
              <td className="px-4 py-3">{slice.configId}</td>
              <td className="px-4 py-3">{slice.caseCount}</td>
              <td className="px-4 py-3">{formatPercent(slice.overallScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaseDetailPanel({
  datasetDetail,
  selectedCase,
}: {
  datasetDetail?: OraEvaluationDatasetDetail;
  selectedCase?: { caseId: string; results: OraEvaluationCaseResult[] };
}) {
  const sourceCase = selectedCase ? datasetDetail?.cases.find((item) => item.id === selectedCase.caseId) : undefined;
  return (
    <aside className="min-h-0 overflow-y-auto rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
      <h3 className="text-sm font-semibold">Case Detail</h3>
      {!selectedCase ? (
        <p className="mt-2 text-sm leading-6 text-bench-700">Select a case row to inspect why it passed or failed.</p>
      ) : (
        <div className="mt-4 space-y-4 text-sm">
          <div className="rounded-lg bg-bench-50 p-3 ring-1 ring-inset ring-bench-200">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">User task</div>
            <p className="mt-2 whitespace-pre-wrap leading-6 text-bench-900">{sourceCase?.input.prompt ?? selectedCase.caseId}</p>
          </div>
          <div className="rounded-lg bg-bench-50 p-3 ring-1 ring-inset ring-bench-200">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Expected</div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-bench-700">
              {JSON.stringify(sourceCase?.expected ?? null, null, 2)}
            </pre>
          </div>
          {selectedCase.results.map((result) => (
            <div key={`${result.caseId}:${result.configId}`} className="rounded-lg bg-bench-50 p-3 ring-1 ring-inset ring-bench-200">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{result.configId}</div>
                  <div className="mt-1 text-xs text-bench-700">{formatPercent(result.averageScore.overallScore)} overall</div>
                </div>
                <div className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                  {result.traceRunIds.length} trace{result.traceRunIds.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-bench-700">
                <Metric label="Outcome" value={formatPercent(result.averageScore.outcomeScore)} />
                <Metric label="Process" value={formatPercent(result.averageScore.processScore)} />
                <Metric label="Efficiency" value={formatPercent(result.averageScore.efficiencyScore)} />
                <Metric label="Safety" value={formatPercent(result.averageScore.safetyScore)} />
              </div>
              <p className="mt-3 text-xs leading-5 text-bench-700">{result.averageScore.judgeRationale}</p>
              {result.traceRunIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {result.traceRunIds.map((runId) => (
                    <span key={runId} className="rounded-full bg-white px-2 py-1 font-mono text-[11px] text-bench-700 ring-1 ring-inset ring-bench-200">{runId}</span>
                  ))}
                </div>
              ) : null}
              {result.averageScore.failureTags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {result.averageScore.failureTags.map((tag) => (
                    <span key={tag} className="rounded-full bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-200">{tag}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function FeedbackInbox({
  records,
  busy,
  compact = false,
  onAccept,
  onReject,
}: {
  records: OraEvaluationFeedbackRecord[];
  busy: string;
  compact?: boolean;
  onAccept: (feedbackId: string) => void;
  onReject: (feedbackId: string) => void;
}) {
  const pending = records.filter((record) => record.status === "pending" || record.status === "failed");
  const reviewed = records.filter((record) => record.status === "accepted" || record.status === "rejected");
  const visibleRecords = compact ? pending.slice(0, 3) : [...pending, ...reviewed];
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", compact ? "" : "px-5 py-5")}>
      {!compact ? <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Pending drafts" value={String(pending.length)} accent="Inbox" />
        <SummaryCard label="Accepted cases" value={String(records.filter((record) => record.status === "accepted").length)} accent="Dataset" />
        <SummaryCard label="Rejected drafts" value={String(records.filter((record) => record.status === "rejected").length)} accent="Archive" />
        <SummaryCard label="Curator fallback" value={String(records.filter((record) => record.draft.curatorStatus !== "generated").length)} accent="Quality" />
      </div> : null}

      <Section title="Feedback Inbox" description="Review natural-language chat feedback after Ora converts it into a structured evaluation draft.">
        {records.length === 0 ? (
          <div className="rounded-xl bg-white px-4 py-6 text-sm text-bench-700 ring-1 ring-inset ring-bench-200">
            No feedback has been submitted from chat yet.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleRecords.map((record) => (
              <div key={record.id} className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-bench-700">{record.id}</span>
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                        record.status === "accepted"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : record.status === "rejected"
                            ? "bg-red-50 text-red-700 ring-red-200"
                            : record.status === "failed"
                              ? "bg-amber-50 text-amber-700 ring-amber-200"
                              : "bg-bench-50 text-bench-700 ring-bench-200",
                      )}>
                        {record.status}
                      </span>
                      <span className="rounded-full bg-bench-50 px-2 py-0.5 text-[11px] font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
                        {record.draft.curatorStatus}
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-bench-900">{record.feedbackText}</p>
                  </div>
                  {(record.status === "pending" || record.status === "failed") ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => onReject(record.id)}
                        disabled={busy === `feedback-reject:${record.id}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-bench-200 bg-white px-3 text-xs font-semibold transition disabled:opacity-50"
                      >
                        {busy === `feedback-reject:${record.id}` ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                        Reject
                      </button>
                      <button
                        onClick={() => onAccept(record.id)}
                        disabled={busy === `feedback-accept:${record.id}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-bench-900 px-3 text-xs font-semibold text-white transition disabled:opacity-50"
                      >
                        {busy === `feedback-accept:${record.id}` ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        Accept
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-md bg-bench-50 p-3 ring-1 ring-inset ring-bench-200">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Draft Case</div>
                    <div className="mt-2 text-sm font-semibold">{record.draft.case.id}</div>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-bench-700">{record.draft.case.input.prompt}</p>
                  </div>
                  <div className="rounded-md bg-bench-50 p-3 ring-1 ring-inset ring-bench-200">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">Structured Expected</div>
                    <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs leading-5 text-bench-700">
                      {JSON.stringify(record.draft.case.expected?.structured ?? record.draft.case.expected ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
                {record.draft.curatorRationale ? <p className="mt-3 text-xs leading-5 text-bench-700">{record.draft.curatorRationale}</p> : null}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function TabButton({ active, label, icon: Icon, onClick }: { active: boolean; label: string; icon: typeof BarChart3; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold transition",
        active ? "bg-bench-900 text-white" : "bg-white text-bench-700 ring-1 ring-inset ring-bench-200 hover:bg-bench-50",
      )}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">{accent}</div>
      <div className="mt-3 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-bench-700">{label}</div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-bench-700">{description}</p>
      </div>
      {children}
    </section>
  );
}

function CaseTable({
  results,
  selectedCaseKey,
  onSelect,
}: {
  results: OraEvaluationCaseResult[];
  selectedCaseKey: string;
  onSelect: (result: OraEvaluationCaseResult) => void;
}) {
  if (results.length === 0) {
    return <div className="rounded-xl bg-white px-4 py-6 text-sm text-bench-700 ring-1 ring-inset ring-bench-200">No cases matched this view.</div>;
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-inset ring-bench-200">
      <table className="min-w-full text-sm">
        <thead className="bg-bench-50 text-left text-xs uppercase tracking-[0.08em] text-bench-700">
          <tr>
            <th className="px-4 py-3">Case</th>
            <th className="px-4 py-3">Config</th>
            <th className="px-4 py-3">Overall</th>
            <th className="px-4 py-3">Judge</th>
            <th className="px-4 py-3">Trace</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => {
            const active = selectedCaseKey === `${result.caseId}:${result.configId}`;
            return (
              <tr
                key={`${result.caseId}:${result.configId}`}
                onClick={() => onSelect(result)}
                className={cn("cursor-pointer border-t border-bench-100 transition hover:bg-bench-50", active && "bg-bench-50")}
              >
                <td className="px-4 py-3 font-medium">{result.caseId}</td>
                <td className="px-4 py-3">{result.configId}</td>
                <td className="px-4 py-3">{formatPercent(result.averageScore.overallScore)}</td>
                <td className="px-4 py-3 text-xs text-bench-700">{result.averageScore.judgeRationale}</td>
                <td className="px-4 py-3 font-mono text-xs text-bench-700">{result.traceRunIds.join(", ") || "n/a"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-bench-50 px-2.5 py-2 ring-1 ring-inset ring-bench-200">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bench-700">{label}</div>
      <div className="mt-1 text-sm font-semibold text-bench-900">{value}</div>
    </div>
  );
}

function inferSourceFormat(fileName: string): "json" | "jsonl" | "csv" | "inline" {
  const lowered = fileName.toLowerCase();
  if (lowered.endsWith(".jsonl")) return "jsonl";
  if (lowered.endsWith(".csv")) return "csv";
  if (lowered.endsWith(".json")) return "json";
  return "inline";
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
