# TASK-20260501-1526-message-flow-to-first-token

**Created:** 2026-05-01 15:26 CST  
**Status:** In Progress  
**Owner:** Ora implementation agents  
**Single Source of Truth:** This file supersedes chat summaries and `/Users/quintenchen/.workbuddy/plans/stellar-forging-lovelace.md` for this workstream.

---

## Goal

彻底摸排 Ora 从“用户发送内容”到“首个可见输出 / 首个 token / 首个用户可读自然语言”的端到端链路，建立可量化的时序诊断，然后基于证据做手术式修复，降低用户感知等待时间，并避免首屏只出现生硬运行进度而没有自然语言语境。

核心原则：**先观测、再判断、后修改**。当前不能把 `task.progress` 或工具状态伪装成模型首 token；必须区分真正的 runtime 事件、模型文本 delta、用户可读 assistant 文本。

## Scope / Out of scope

### In scope

- 桌面端消息提交、pending 占位、run subscription、stream merge、view model、assistant turn rendering。
- Runtime JSON-RPC `runs.startStreaming`、`queuedStreams`、run store 启动路径、kernel streaming、provider streaming、tool loop、progress narration。
- 为关键路径增加 timing 观测，能分段定位耗时。
- 为 UI 文本 / 进度的优先级补测试，锁定“首个用户可读自然语言”的定义。
- 根据观测结果优化：auto router、clarification preflight、progress narration、provider fallback、工具先行 UI 状态。

### Out of scope

- 不重写整个 streaming 架构。
- 不删除 `stdio.ts` 的 `queuedStreams` 防乱序机制。
- 不为了“看起来快”强迫模型在工具前输出无意义自然语言。
- 不把进度事件当作真正 assistant token 上报。
- 不引入大范围抽象或多文件重构，除非观测证明必要。

## Definitions / Metrics

后续所有讨论必须明确使用以下指标：

1. **First run event**：runtime 产生并送达 UI 的第一个 `OraRunEventStream`。
2. **First text delta**：第一个 `message.delta` / `token.delta`，不论内容是否适合用户阅读。
3. **First user-readable assistant text**：Chat 主气泡中出现非进度、非工具状态、非空的 assistant 自然语言文本。
4. **Pending paint**：用户提交后，UI 中 pending user + pending assistant 占位实际完成绘制。
5. **Handle received**：desktop 收到 `runs.startStreaming` 返回的 `RunHandle`。
6. **Provider first frame**：provider SSE / stream 收到第一帧。
7. **Provider first non-empty text delta**：provider stream 中第一次解析到非空文本 delta。

## Confirmed Chain

### 1. UI submit path

- `apps/desktop/src/components/ChatInput.tsx`
  - Enter 或发送按钮触发 `onStartRun`。
  - 关键位置：`handleKeyDown()`、发送按钮 `onClick={isRunning ? onStopRun : onStartRun}`。
- `apps/desktop/src/lib/useRunActions.ts`
  - `startRun()`：
    - `flushSync(BEGIN_RUN_REQUEST)` 创建 pending user + pending assistant 占位。
    - `CLEAR_PROMPT_IF_MATCH` 清空输入框。
    - `await waitForPendingRunPaint()` 等首屏 pending 绘制。
    - auto 模式时 `SET_PENDING_RUN_PROGRESS` -> “正在选择合适的工作模式”。
    - 调 `runtimeClient.startStreamingRun(...)`。
    - 收到 handle 后又调 `runtimeClient.getRunState(handle.runId)`。
    - 再 `SELECT_TURN` / `refreshCurrentSession(...)`。
- `apps/desktop/src/lib/runtimeClient.ts`
  - `startStreamingRun()` 调 JSON-RPC `runs.startStreaming`。
  - `subscribeRunEvents()` 监听 runtime 推送事件。
  - `streamRun()` 可拉取 `runs.stream`。
- `apps/desktop/src/App.tsx`
  - `useEffect` 订阅 run events。
  - 收到 stream 后 `dispatch({ type: "APPLY_RUN_STREAM", stream })`。
  - 同时 `mergeRunStreamSnapshot(current[stream.runId], stream)` 写入 `turnSnapshots`。

### 2. Runtime JSON-RPC and stream path

- `apps/runtime/src/json-rpc.ts`
  - `runs.startStreaming` -> `store.startStreamingRun(params, { onStream: options.onRunStream })`。
  - `runs.stream` -> `store.streamRun(params)`。
- `apps/runtime/src/stdio.ts`
  - response 写出前，`onRunStream()` 产生的 stream 被放进 `queuedStreams`。
  - response 写出后再 flush queued streams。
  - 这个机制避免 JSON-RPC 通知早于响应，但也意味着 handle 返回前的事件不会立即被 UI 收到。
- `apps/runtime/src/run-store.ts`
  - `startStreamingRun()` 在返回 handle 前同步执行：
    - `StartRunParamsSchema.parse(...)`
    - `ensureSessionForRun(...)`
    - `enrichInputForSession(...)`
    - `resolveModeSelection(...)`
    - `withMemoryPrompt(...)`
    - `buildConversationMessages(...)`
    - `createRunningRunSnapshot(...)`
    - `persistRun(...)`
  - 然后异步启动：`void executeTracedKernelRun({ streamProvider: true, onEvent: applyLiveEvent })`。
  - `applyLiveEvent()`：`applyStreamingRunEvent(...)` -> `cacheRun(...)` -> `publishRunStream(...)`。

### 3. Kernel / provider text streaming

- `apps/runtime/src/harness/runtime-kernel.ts`
  - 初始阶段会 emit topology/profile/plan/todo。
  - auto 模式下会 emit `task.progress` source=`runtime_status`。
  - 如果启用 clarification preflight，可能先执行 `requestIntentClarificationQuestion(...)`，这是一次非流式 provider 调用。
- `apps/runtime/src/harness/node-runtime-loop.ts`
  - `streamProvider=true` 时选 `invokeRunProviderStream`。
  - `onTextDelta` emit：
    - `message.delta` with `{ role: "assistant", content, delta, streaming: true }`
    - `token.delta` with `{ text: delta, streaming: true }`
  - 如果第一次模型响应是 tool call：
    - 会先产生 `action.updated`、tool 状态、`task.progress` 等。
    - 用户自然语言要等工具执行完和后续 provider final answer。
- `apps/runtime/src/providers/registry.ts`
  - provider 有 `.stream` 则走真流式。
  - 没有 `.stream` 则走 `streamFallback(...)`。
- `apps/runtime/src/providers/streaming.ts`
  - `streamFallback(...)` 等完整非流式 response 返回后一次性 emit delta。
- `apps/runtime/src/providers/openai-compatible.ts` / `apps/runtime/src/providers/anthropic.ts`
  - 只在 SSE 解析出非空文本 delta 时调用 `emitTextDelta(...)`。
  - reasoning / tool call / 空 delta 不会产生 `message.delta`。

### 4. UI stream merge and rendering

- `apps/desktop/src/lib/state.tsx`
  - `BEGIN_RUN_REQUEST` 创建 `pendingRun`，默认 progressText 为“正在准备”。
  - `SET_PENDING_RUN_PROGRESS` 更新 pending progress。
  - `APPLY_RUN_STREAM` 合并 stream 到 active snapshot，必要时清除 pendingRun。
- `apps/desktop/src/lib/viewModel.ts`
  - `adaptPendingRunMessages()`：runtime handle 前展示 pending user + pending assistant。
  - `assistantTextFromSnapshot()` / `streamingAssistantTextFromSnapshot()`：从最后一个非空 `message.delta.payload.content` 取主文本。
  - `progressTextFromSnapshot()`：从 `task.progress` 且 `kind=chat_progress`、`source=progress_narrator|runtime_status` 取 live progress 文案。
  - `isVisibleChatProgressSource()` 当前只接受 `progress_narrator` 和 `runtime_status`。
- `apps/desktop/src/components/AssistantTurnCard.tsx`
  - 先渲染“运行进度”折叠卡。
  - 再渲染 `MarkdownContent(content)`。
  - 当 content 实际是 progress 文案时，视觉上容易被用户理解为“没有自然语言回答，只有运行进度”。

## Current Hypotheses

### H1: Handle 前同步工作导致首事件延迟

Evidence:
- `startStreamingRun()` 返回前同步做 mode selection、memory prompt、conversation build、persist。
- `stdio.ts` response 前缓存 queued streams，因此即使 runtime 已产生事件，UI 也可能等 handle response 后才收到。

Need proof:
- 记录 `startStreamingRun.enter -> handle.return` 分段耗时。
- 特别量化 `resolveModeSelection`、`withMemoryPrompt`、`persistRun`。

### H2: Auto router / clarification preflight 引入额外非流式模型调用

Evidence:
- `mode-selection.ts:resolveModeSelection()` auto 模式会 `routeAutoMode()`，调用 `invokeRunProvider(...)`。
- `runtime-kernel.ts` 在 clarification preflight 下调用 `requestIntentClarificationQuestion(...)`，也是 `invokeRunProvider(...)`。

Need proof:
- 区分 auto mode vs manual mode 的 submit->handle、handle->first delta。
- 记录 preflight 是否运行、运行耗时、是否实际产生 clarification。

### H3: Provider 不是流式或首个文本 delta 晚于首个 SSE/tool frame

Evidence:
- provider 无 `.stream` 时 `streamFallback` 等完整响应。
- SSE parser 只对非空文本 delta emit；reasoning/tool call/空 delta 不会变成 `message.delta`。

Need proof:
- 记录 stream mode、first SSE frame、first non-empty text delta。
- 标记 fallback provider。

### H4: Progress narration 抢首屏或增加额外 provider 开销

Evidence:
- `runtime-progress.ts` 在 `metadata.progressNarration === true` 时调用 provider 生成 progress summary。
- desktop `useRunActions.ts` 默认设置 `progressNarration: true`。
- UI 会显示 source=`progress_narrator|runtime_status` 的 chat progress。

Need proof:
- 记录 progress narration 调用时机、耗时、是否发生在 first assistant text 前。
- 对比关闭 progressNarration 后的首屏。

### H5: 工具先行不是 streaming 故障，而是交互表达问题

Evidence:
- `node-runtime-loop.ts` 第一次模型响应可能是 tool call；自然语言 final answer 要等工具结果后第二轮模型调用。
- UI 当前把 process steps 放在主气泡前，progress 文案与最终回答视觉差异不够强。

Need proof:
- 记录 first tool call detected 与 first text delta 的相对顺序。
- 构造工具先行测试场景。

## Plan

### Phase 1: Add latency instrumentation without changing behavior

Files:
- `apps/desktop/src/lib/useRunActions.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/state.tsx`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/harness/node-runtime-loop.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/runtime-progress.ts`
- `apps/runtime/src/providers/streaming.ts`
- `apps/runtime/src/providers/openai-compatible.ts`
- `apps/runtime/src/providers/anthropic.ts`

Objectives:
1. Capture desktop timings:
   - `submitAt`
   - `pendingPaintedAt`
   - `startStreamingRunCalledAt`
   - `handleReceivedAt`
   - `getRunStateReceivedAt`
   - `firstRunStreamReceivedAt`
   - `firstMessageDeltaAt`
   - `firstNonProgressAssistantTextAt`
2. Capture runtime timings:
   - `startStreamingRun.enter`
   - `modeSelection.done`
   - `memoryPrompt.done`
   - `snapshotPersisted`
   - `kernelScheduled`
   - `firstApplyLiveEvent`
   - `providerCallStarted`
   - `firstTextDelta`
   - `firstToolCallDetected`
   - `finalTextProduced`
3. Capture provider timings:
   - `streamMode: sse | fallback_single`
   - `firstSseFrameAt`
   - `firstNonEmptyTextDeltaAt`
4. Keep output local/debug-oriented:
   - Prefer run trace / metadata / debug event field.
   - Do not expose noisy timing to normal users unless dev UI or diagnostics panel requests it.

### Phase 2: Add tests for metric semantics and UI priority

Files:
- `apps/desktop/src/lib/viewModel.test.ts`
- `apps/desktop/src/lib/state.test.ts`
- Runtime/provider tests as available near `apps/runtime/src/providers` or existing runtime test structure.

Test cases:
1. `task.progress` without `message.delta`:
   - UI may show progress placeholder.
   - It must not be counted as assistant natural text.
2. `message.delta` after progress:
   - assistant text wins over old progress.
   - process steps remain visible but secondary.
3. Tool-first sequence:
   - process steps show tool activity.
   - no fake assistant answer is created.
   - final `message.delta` replaces placeholder/progress.
4. Provider fallback:
   - `streamFallback` is detectable as `fallback_single`.
5. SSE non-text first frames:
   - first frame can be earlier than first text delta.
   - only non-empty text delta counts as first text delta.

### Phase 3: Analyze timings and choose targeted fix

Decision matrix:

- If `submit -> handle` dominates:
  - Optimize `run-store.startStreamingRun()` return path.
  - Consider moving auto router / memory prompt / heavy persistence after initial handle, or adding timeout/fallback.
- If auto router dominates:
  - Add short timeout and fallback in `mode-selection.ts`.
  - Prefer manual selected mode or recent mode reuse when confidence can be inferred cheaply.
- If clarification preflight dominates:
  - Add timeout / stricter trigger in `runtime-clarifications.ts` and `runtime-kernel.ts`.
- If provider fallback dominates:
  - Surface `fallback_single` in diagnostics / UI copy.
  - Avoid claiming true streaming for that provider.
- If progress narration dominates or抢首屏:
  - Make first-screen progress cheap and deterministic.
  - Defer LLM-authored progress narration until after first assistant text, or run it fire-and-forget if safe.
- If tool-first dominates:
  - Improve UI language: “需要先读取/搜索/检查相关信息” as explicit processing state.
  - Do not force useless pre-tool natural language.

### Phase 4: Implement first repair batch

Recommended initial repair direction, pending timing evidence:

1. **Diagnostics first**：merge instrumentation and tests.
2. **Cheap first screen**：ensure pending UI appears immediately and distinguishes progress from answer.
3. **Timeout/fallback for pre-answer model calls**：auto router and clarification preflight should not create unbounded pre-token waits.
4. **Progress narration hygiene**：avoid progress narrator blocking or stealing first natural-language slot.
5. **Provider transparency**：fallback providers and non-text-first SSE frames should be visible in diagnostics.

### Phase 5: Verify end-to-end

Manual scenarios:
1. Manual mode + no tool simple question.
2. Auto mode simple question.
3. Tool-first request requiring file/search/tool.
4. Provider with true SSE stream.
5. Provider using fallback single response.
6. Clarification preflight enabled but no clarification needed.
7. Clarification actually required.

Expected evidence:
- Timing table shows each segment.
- First run event, first text delta, first user-readable assistant text are separately reported.
- User sees immediate pending feedback.
- Progress-only state is visually distinct from assistant answer.
- Final assistant text replaces progress correctly.

## Active Files

Likely modification targets:

- `apps/desktop/src/components/ChatInput.tsx`
- `apps/desktop/src/components/AssistantTurnCard.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/lib/useRunActions.ts`
- `apps/desktop/src/lib/runtimeClient.ts`
- `apps/desktop/src/lib/state.tsx`
- `apps/desktop/src/lib/viewModel.ts`
- `apps/desktop/src/lib/viewModel.test.ts`
- `apps/desktop/src/lib/state.test.ts`
- `apps/runtime/src/json-rpc.ts`
- `apps/runtime/src/stdio.ts`
- `apps/runtime/src/run-store.ts`
- `apps/runtime/src/run-state-operations.ts`
- `apps/runtime/src/mode-selection.ts`
- `apps/runtime/src/harness/runtime-kernel.ts`
- `apps/runtime/src/harness/node-runtime-loop.ts`
- `apps/runtime/src/harness/runtime-progress.ts`
- `apps/runtime/src/harness/runtime-clarifications.ts`
- `apps/runtime/src/providers/registry.ts`
- `apps/runtime/src/providers/streaming.ts`
- `apps/runtime/src/providers/openai-compatible.ts`
- `apps/runtime/src/providers/anthropic.ts`
- `packages/shared/src/runtime.ts`
- `packages/shared/src/rpc.ts`

Reference / context files:

- `/Users/quintenchen/.workbuddy/plans/stellar-forging-lovelace.md`
- `tasks/TASK-20260424-2303-ora-true-streaming-output.md`
- `tasks/TASK-20260426-1953-ora-agent-authored-progress-body.md`
- `tasks/TASK-20260426-2213-ora-clarify-first-guard.md`
- `tasks/TASK-20260426-0101-ora-auto-agent-mode-router.md`
- `tasks/TASK-20260428-2121-ora-continuation-runtime.md`

## Decisions

- Decision: Use timing instrumentation before behavior changes.
  - Why: The symptom can be caused by UI paint, JSON-RPC queued stream, auto router, clarification preflight, provider fallback, tool-first response, or progress narration. Without timing, any patch is guesswork.
  - Alternatives: Directly disable progress narration or auto router.
  - Tradeoffs: Slower first implementation step, but reduces risk of fixing the wrong layer.

- Decision: Treat “首个事件 / 首个文本 delta / 首个用户可读自然语言” as separate metrics.
  - Why: Current user-visible complaint blends transport latency and UX semantics. Separating metrics prevents progress events from being mislabeled as model output.
  - Alternatives: Track only first `message.delta`.
  - Tradeoffs: More fields/tests, but diagnostics become actionable.

- Decision: Do not remove `queuedStreams` as a first fix.
  - Why: It protects JSON-RPC response/notification ordering. Removing it may reintroduce stream order bugs.
  - Alternatives: Emit notifications before response.
  - Tradeoffs: Keep ordering safety; measure its latency impact instead.

- Decision: Do not force pre-tool natural language.
  - Why: Tool-first can be correct agent behavior. The fix should be UX clarity, not fake content.
  - Alternatives: Prompt model to always say a sentence before tools.
  - Tradeoffs: Honest UI state over artificial chatter.

## Open Issues

- [ ] Need measured breakdown for current slow path on a real run.
- [ ] Need to confirm whether current selected provider supports true `.stream` or falls back to `fallback_single`.
- [ ] Need to confirm whether auto mode is the common path when user observes long wait.
- [ ] Need to confirm how often `clarificationPreflight` runs and whether it delays non-ambiguous tasks.
- [ ] Need to decide where latency data should live long term: trace metadata, debug events, diagnostics panel, or run trail.

## TODO

- [ ] Add instrumentation for desktop submit/pending/handle/stream timing.
- [ ] Add instrumentation for runtime `startStreamingRun` pre-handle phases.
- [ ] Add instrumentation for provider first frame / first text delta / fallback mode.
- [ ] Add instrumentation for tool-first and progress narration timing.
- [ ] Add view model/state tests for metric semantics and progress-vs-answer priority.
- [ ] Run focused tests and typecheck.
- [ ] Capture timing output from at least one manual mode and one auto mode run.
- [ ] Choose first repair based on timing evidence.
- [ ] Implement targeted repair.
- [ ] Re-run verification and update this journal before DONE.

## Progress Log

- 2026-05-01 15:26 CST - Task journal placeholder created.
  Next: Fill in Goal, Scope, Plan, and list Active Files.

- 2026-05-01 15:45 CST - Filled this task journal with complete chain map, hypotheses, implementation plan, active files, checkpoints, and verification strategy. This file is now the authoritative source for the first-token latency workstream.
  Next: 1) add desktop/runtime/provider timing instrumentation; 2) add viewModel/state/provider tests for metric semantics; 3) run manual timing comparison for auto vs manual mode.

## Retrospective

### Item 1
- Pitfall: “首 token 慢”容易被误诊为单一 streaming bug。
- Symptom: 用户感知是等待很久或只看到运行进度，但实际可能分别来自 handle 前同步工作、provider 非流式、工具先行、progress narration 或 UI 文案优先级。
- Root Cause: 没有把 first event、first text delta、first user-readable assistant text 分开度量。
- Reusable Guardrail: 流式体验问题先定义分层指标并打时序点，再改具体行为。
- Evidence: 当前链路中至少 7 个可能延迟段已定位，分布在 desktop、runtime、provider、UI view model。
- Scope: Ora streaming / agent UX / run lifecycle diagnostics。
- Suggested Writeback Target: 如果本轮完成后证明有效，可沉淀为 Ora streaming latency debug skill。
- Status: candidate_for_skill

## Functional Verification

### Code Verification (Code Correctness)

- [ ] Code compiles/runs without errors
- [ ] Unit tests pass
- [ ] Lint/type checks pass

**Output:** Pending implementation.

### Functional Verification (Feature Works)

- [ ] Manual mode simple prompt produces timing breakdown.
- [ ] Auto mode simple prompt produces timing breakdown and identifies router cost.
- [ ] Tool-first run distinguishes first tool event from first assistant natural text.
- [ ] Fallback provider is marked as non-true-streaming.
- [ ] UI visually distinguishes progress placeholder from assistant answer.

**Output:** Pending implementation.

## Comparison

### Reference

- `tasks/TASK-20260424-2303-ora-true-streaming-output.md`: true streaming and queued notification ordering.
- `tasks/TASK-20260426-1953-ora-agent-authored-progress-body.md`: progress narration design, final answer priority.
- `tasks/TASK-20260426-2213-ora-clarify-first-guard.md`: clarification preflight behavior.
- `tasks/TASK-20260426-0101-ora-auto-agent-mode-router.md`: auto mode router behavior.
- `tasks/TASK-20260428-2121-ora-continuation-runtime.md`: continuation / runtime conversation state.

### Comparison Points

- [ ] Streaming ordering constraints are preserved.
- [ ] Progress narration remains opt-in / cosmetic and cannot fail or block the run.
- [ ] Clarification preflight remains useful but not unbounded before first output.
- [ ] Auto router remains useful but does not dominate first visible feedback.
- [ ] Runtime continuation semantics are not changed by timing instrumentation.

### Findings

- Consistency: The current plan preserves prior architecture decisions: `queuedStreams`, streaming notifications, progress narration as cosmetic, and continuation state as execution state.
- Differences: This work introduces explicit timing semantics not previously tracked.
- Conclusion: Compatible with existing architecture if instrumentation is additive and repairs are gated by measured evidence.

## Checkpoints

### Checkpoint 1: Chain map complete
- Requirement: Document submit -> runtime -> provider -> stream -> UI render chain with files/functions.
- Verification method: Review this journal's “Confirmed Chain” and “Active Files”.
- Status: [x] Pass / [ ] Fail
- Evidence: Key paths and responsibilities are listed above.

### Checkpoint 2: Metrics defined before implementation
- Requirement: Define first event, first text delta, and first user-readable assistant text separately.
- Verification method: Review “Definitions / Metrics”.
- Status: [x] Pass / [ ] Fail
- Evidence: Seven timing concepts are explicitly defined.

### Checkpoint 3: Instrumentation added
- Requirement: Desktop, runtime, and provider timing data are captured.
- Verification method: Tests and manual run output show timing table.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

### Checkpoint 4: Regression tests added
- Requirement: Tests cover progress-only, text-after-progress, tool-first, fallback provider, and SSE non-text-first cases.
- Verification method: Focused test command output pasted under Verification.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

### Checkpoint 5: Targeted repair selected by evidence
- Requirement: Repair choice cites measured bottleneck, not intuition.
- Verification method: Progress Log records timing results and chosen fix.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

### Checkpoint 6: Functional UX verified
- Requirement: User sees immediate feedback; progress-only state is not confused with final answer; final assistant text replaces progress.
- Verification method: Manual verification scenarios recorded under Functional Verification.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

**All checkpoints must pass before marking task DONE.**

## Compressed State (<= 20 lines)

- Objective: Diagnose and fix Ora send-to-first-token / first-user-readable-text latency and progress-only first-screen UX.
- Current truth: Chain mapped across ChatInput/useRunActions/runtimeClient/App/state/viewModel/runtime json-rpc/stdio/run-store/kernel/node loop/providers.
- Key distinction: first run event != first text delta != first user-readable assistant text.
- Main suspects: pre-handle work, auto router, queuedStreams boundary, clarification preflight, progress narration, provider fallback/non-text SSE, tool-first responses.
- First implementation step: add timing instrumentation before behavior changes.
- Likely tests: desktop viewModel/state; runtime provider streaming/fallback; tool-first event sequence.
- Repair direction: choose based on timing; likely cheap first-screen + timeout/fallback for pre-answer model calls + progress narration hygiene.
- Active task file: `tasks/TASK-20260501-1526-message-flow-to-first-token.md`.
- Next actions: 1) instrument `useRunActions.ts` and `run-store.ts`; 2) instrument provider stream first-frame/delta; 3) add viewModel/state tests for progress-vs-answer semantics.
- Blockers/Risks: Need real timing output; avoid touching `queuedStreams` prematurely; avoid fake pre-tool natural language.
- Verification status: Planning complete; implementation pending.

## Verification

### Evidence Requirements

Must provide the following evidence before DONE:

- [ ] Code Verification output (compilation/tests/lint)
- [ ] Functional Verification output (manual mode / auto mode / tool-first / provider fallback)
- [ ] Timing output with segment breakdown
- [ ] Retrospective evidence
- [ ] Comparison evidence
- [ ] Checkpoints evidence

### Environment

- Environment: macOS / workspace `/Users/quintenchen/developer/ora`
- Current date: 2026-05-01

### Commands run + outputs

- Pending implementation.
