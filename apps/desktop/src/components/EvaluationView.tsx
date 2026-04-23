import { BarChart3, Download, FileUp, FlaskConical, GitCompareArrows, Loader2, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWorkbench } from "../lib/state";
import type {
  OraEvaluationBaseline,
  OraEvaluationCaseResult,
  OraEvaluationDataset,
  OraEvaluationDatasetDetail,
  OraEvaluationRun,
  OraEvaluationRunDetail,
  OraEvaluationSpec,
  RuntimeClient,
} from "../lib/runtimeClient";
import type { RuntimeBridgeStatus } from "../types";
import { cn } from "../lib/utils";

type EvaluationTab = "regression" | "lab";

const PROFILE_OPTIONS: Array<{ id: "outcome" | "orchestration" | "task_completion"; label: string; description: string }> = [
  { id: "outcome", label: "Outcome", description: "Final-result focused scoring." },
  { id: "orchestration", label: "Orchestration", description: "Tool/handoff/process focused scoring." },
  { id: "task_completion", label: "Task Completion", description: "Environment task completion focused scoring." },
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
  const [datasets, setDatasets] = useState<OraEvaluationDataset[]>([]);
  const [runs, setRuns] = useState<OraEvaluationRun[]>([]);
  const [baselines, setBaselines] = useState<OraEvaluationBaseline[]>([]);
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

  const providerOptions = state.providerRegistry?.providers ?? [];
  const activeProvider = providerOptions.find((provider) => provider.id === state.selectedProviderId) ?? providerOptions[0];

  async function refreshIndex() {
    const [nextDatasets, nextRuns, nextBaselines] = await Promise.all([
      runtimeClient.listEvaluationDatasets(),
      runtimeClient.listEvaluationRuns(),
      runtimeClient.listEvaluationBaselines(),
    ]);
    setDatasets(nextDatasets);
    setRuns(nextRuns);
    setBaselines(nextBaselines);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="border-b border-border bg-sidebar/92 px-6 py-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-bench-700">Evaluation</p>
            <h2 className="text-lg font-semibold">Benchmark datasets, batch runs, and regression analysis</h2>
            <p className="mt-1 text-xs text-bench-700">
              {bridgeStatus.detail}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-4 text-sm font-semibold transition hover:bg-bench-50"
            >
              <FileUp size={16} />
              Import dataset
            </button>
            <button
              onClick={handleRunEvaluation}
              disabled={busy.length > 0 || !selectedDatasetId || selectedPatterns.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-bench-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "run" ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
              New evaluation
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

      <div className="flex min-h-0 flex-1 gap-0.5 p-1.5 md:p-2">
        <section className="flex w-[22rem] shrink-0 flex-col overflow-hidden rounded-[24px] border border-black/[0.025] bg-sidebar shadow-[0_1px_1px_rgba(23,23,23,0.04),0_8px_18px_rgba(23,23,23,0.024)]">
          <div className="border-b border-border px-4 py-4">
            <h3 className="text-sm font-semibold">Setup</h3>
            <p className="mt-1 text-xs leading-5 text-bench-700">Import a dataset, pick a profile, then expand a config matrix across Ora agent modes.</p>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Dataset</span>
              <select
                value={selectedDatasetId}
                onChange={(event) => setSelectedDatasetId(event.target.value)}
                className="h-10 w-full rounded-md border border-bench-200 bg-white px-3"
              >
                <option value="">Select dataset</option>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Profile</span>
              <select
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value as typeof selectedProfileId)}
                className="h-10 w-full rounded-md border border-bench-200 bg-white px-3"
              >
                {PROFILE_OPTIONS.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
              <p className="text-xs text-bench-700">{PROFILE_OPTIONS.find((profile) => profile.id === selectedProfileId)?.description}</p>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Baseline</span>
              <select
                value={baselineId}
                onChange={(event) => setBaselineId(event.target.value)}
                className="h-10 w-full rounded-md border border-bench-200 bg-white px-3"
              >
                <option value="">No baseline</option>
                {runBaselines.map((baseline) => (
                  <option key={baseline.id} value={baseline.id}>{baseline.name}</option>
                ))}
              </select>
            </label>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Agent modes</span>
              <div className="grid gap-2">
                {state.patterns.map((pattern) => {
                  const checked = selectedPatterns.includes(pattern.id);
                  return (
                    <label key={pattern.id} className="flex items-start gap-2 rounded-md border border-bench-200 bg-white px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setSelectedPatterns((current) => event.target.checked ? [...current, pattern.id] : current.filter((item) => item !== pattern.id))}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm font-medium">{pattern.label}</span>
                        <span className="block text-xs leading-5 text-bench-700">{pattern.summary}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Provider</span>
              <select
                value={activeProvider?.id ?? ""}
                onChange={(event) => state.providerRegistry && state.providerRegistry.providers.some((provider) => provider.id === event.target.value) && state.providerRegistry.defaultProviderId}
                className="h-10 w-full rounded-md border border-bench-200 bg-white px-3"
                disabled
              >
                {providerOptions.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
              <p className="text-xs text-bench-700">Uses the provider selected in Settings for v1.</p>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Model ref</span>
              <input
                value={modelRef}
                onChange={(event) => setModelRef(event.target.value)}
                className="h-10 w-full rounded-md border border-bench-200 bg-white px-3 font-mono text-sm"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Repetitions</span>
              <input
                type="number"
                min={1}
                max={5}
                value={repetitions}
                onChange={(event) => setRepetitions(Math.max(1, Math.min(5, Number(event.target.value) || 1)))}
                className="h-10 w-full rounded-md border border-bench-200 bg-white px-3"
              />
            </label>

            {datasetDetail && (
              <div className="rounded-md bg-white px-3 py-3 ring-1 ring-inset ring-bench-200">
                <div className="text-sm font-semibold">{datasetDetail.dataset.name}</div>
                <div className="mt-1 text-xs text-bench-700">{datasetDetail.dataset.caseCount} cases · {datasetDetail.dataset.sourceFormat.toUpperCase()}</div>
                {datasetDetail.metadataKeys.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {datasetDetail.metadataKeys.map((key) => (
                      <span key={key} className="rounded-full bg-bench-50 px-2 py-1 text-[11px] font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">{key}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-black/[0.025] bg-sidebar shadow-[0_1px_1px_rgba(23,23,23,0.04),0_8px_18px_rgba(23,23,23,0.024)]">
          <div className="border-b border-border px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <TabButton active={tab === "regression"} label="Regression" icon={GitCompareArrows} onClick={() => setTab("regression")} />
                <TabButton active={tab === "lab"} label="Lab" icon={BarChart3} onClick={() => setTab("lab")} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedRunId}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                  className="h-10 min-w-[14rem] rounded-md border border-bench-200 bg-white px-3 text-sm"
                >
                  <option value="">Select evaluation run</option>
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>{run.id} · {run.spec.profileId}</option>
                  ))}
                </select>
                <button
                  onClick={() => void handleExport("json")}
                  disabled={!runDetail || busy.startsWith("export")}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download size={15} />
                  JSON
                </button>
                <button
                  onClick={() => void handleExport("csv")}
                  disabled={!runDetail || busy.startsWith("export")}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-bench-200 bg-white px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download size={15} />
                  CSV
                </button>
              </div>
            </div>
          </div>

          {!runDetail ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="max-w-md text-center">
                <h3 className="text-lg font-semibold">No evaluation run selected</h3>
                <p className="mt-2 text-sm leading-6 text-bench-700">Import a benchmark dataset, choose a profile and one or more agent modes, then start a new evaluation to compare configs and drill into traces.</p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-5 py-5">
                <div className="grid gap-3 md:grid-cols-5">
                  <SummaryCard label="Overall score" value={formatPercent(runDetail.run.scorecard.overallScore)} accent="Score" />
                  <SummaryCard label="Pass rate" value={formatPercent(runDetail.run.scorecard.passRate)} accent="Pass" />
                  <SummaryCard label="Regressions" value={String(runDetail.run.scorecard.regressionCount)} accent="Diff" />
                  <SummaryCard label="Avg runtime" value={`${runDetail.run.scorecard.averageRuntimeMs} ms`} accent="Latency" />
                  <SummaryCard label="Avg cost" value={`$${runDetail.run.scorecard.averageCostUsd.toFixed(4)}`} accent="Cost" />
                </div>

                {tab === "regression" ? (
                  <>
                    <Section title="Config Comparison" description="Compare score, pass rate, cost, and regressions across the current config matrix.">
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
                                    onClick={() => void handlePromoteBaseline(summary.configId)}
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
                    </Section>

                    <Section title="Regressions" description="Cases that scored below the selected baseline under the current run.">
                      <CaseTable
                        results={runDetail.run.caseResults.filter((result) => result.comparisonToBaseline?.regressed)}
                        selectedCaseKey={selectedCaseKey}
                        onSelect={(result) => setSelectedCaseKey(`${result.caseId}:${result.configId}`)}
                      />
                    </Section>
                  </>
                ) : (
                  <>
                    <Section title="Experiment Matrix" description="Leaderboard-style comparison across the current eval configs.">
                      <div className="grid gap-3 md:grid-cols-3">
                        {runDetail.run.scorecard.configSummaries
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
                )}

                <Section title="Case Browser" description="Inspect outputs, scores, and trace links for every case/config result in this run.">
                  <CaseTable
                    results={runDetail.run.caseResults}
                    selectedCaseKey={selectedCaseKey}
                    onSelect={(result) => setSelectedCaseKey(`${result.caseId}:${result.configId}`)}
                  />
                </Section>
              </div>

              <aside className="w-[26rem] shrink-0 border-l border-border bg-card/72 px-4 py-5 backdrop-blur-sm">
                <h3 className="text-sm font-semibold">Case Detail</h3>
                {!selectedCase ? (
                  <p className="mt-2 text-sm leading-6 text-bench-700">Select a case row to inspect input, expectation, per-config outputs, and the trace links generated by the underlying Ora runs.</p>
                ) : (
                  <div className="mt-4 space-y-4 text-sm">
                    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Input</div>
                      <p className="mt-2 whitespace-pre-wrap leading-6 text-bench-900">
                        {datasetDetail?.cases.find((item) => item.id === selectedCase.caseId)?.input.prompt ?? selectedCase.caseId}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Expected</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-bench-700">
                        {JSON.stringify(datasetDetail?.cases.find((item) => item.id === selectedCase.caseId)?.expected ?? null, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-bench-700">Metadata</div>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-bench-700">
                        {JSON.stringify(datasetDetail?.cases.find((item) => item.id === selectedCase.caseId)?.metadata ?? {}, null, 2)}
                      </pre>
                    </div>
                    {selectedCase.results.map((result) => (
                      <div key={`${result.caseId}:${result.configId}`} className="rounded-xl bg-white p-4 ring-1 ring-inset ring-bench-200">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{result.configId}</div>
                            <div className="mt-1 text-xs text-bench-700">{formatPercent(result.averageScore.overallScore)} overall</div>
                          </div>
                          <div className="rounded-full bg-bench-50 px-2.5 py-1 text-[11px] font-semibold text-bench-700 ring-1 ring-inset ring-bench-200">
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
                        {result.traceRunIds.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {result.traceRunIds.map((runId) => (
                              <span key={runId} className="rounded-full bg-bench-50 px-2 py-1 font-mono text-[11px] text-bench-700 ring-1 ring-inset ring-bench-200">
                                {runId}
                              </span>
                            ))}
                          </div>
                        )}
                        {result.averageScore.failureTags.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {result.averageScore.failureTags.map((tag) => (
                              <span key={tag} className="rounded-full bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 ring-1 ring-inset ring-red-200">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          )}
        </section>
      </div>
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
