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

- [x] Add instrumentation for desktop submit/pending/handle/stream timing.
- [x] Add instrumentation for runtime `startStreamingRun` pre-handle phases.
- [x] Add instrumentation for provider first frame / first text delta / fallback mode.
- [x] Add instrumentation for tool-first and progress narration timing.
- [x] Add shared/state tests for latency contract and desktop stream timing merge.
- [x] Run focused tests and typecheck.
- [x] Add/confirm view-model tests for progress-vs-answer priority and progress-only placeholders.
- [x] Capture timing output from at least one manual mode and one auto mode run.
- [x] Choose first repair based on timing evidence.
- [x] Implement targeted repair: defer/guard progress narration so it cannot run before first assistant text or occupy the main answer slot.
- [x] Re-run focused verification and update this journal for first repair.
- [x] Add developer-facing latency diagnostics display in Trails.
- [ ] Run full DONE gate after remaining functional UX/tool-first checks.

## Progress Log

- 2026-05-01 15:26 CST - Task journal placeholder created.
  Next: Fill in Goal, Scope, Plan, and list Active Files.

- 2026-05-01 15:45 CST - Filled this task journal with complete chain map, hypotheses, implementation plan, active files, checkpoints, and verification strategy. This file is now the authoritative source for the first-token latency workstream.
  Next: 1) add desktop/runtime/provider timing instrumentation; 2) add viewModel/state/provider tests for metric semantics; 3) run manual timing comparison for auto vs manual mode.

- 2026-05-01 16:40 CST - Implemented first instrumentation pass: shared `RunLatencyDiagnostics`, desktop submit/pending/handle/getState/stream-receive marks, runtime `startStreamingRun` pre-handle marks, first live event/text/progress/tool marks, provider stream event marks for SSE/fallback/local smoke, and state merge preservation. Added shared contract test and desktop state tests for latency merging/stream receive marks. Verification passed: shared contracts, desktop focused tests, shared typecheck/build, runtime typecheck, desktop typecheck, and `git diff --check`.
  Next: 1) add/confirm view-model progress-vs-answer tests; 2) run real manual-mode and auto-mode prompts to capture timing; 3) choose first repair from measured bottleneck.

- 2026-05-01 16:52 CST - Confirmed and strengthened viewModel progress-vs-answer priority coverage. Renamed the runtime-status test to make the intent explicit, and added assertions that progress-only status remains `liveProgressText`, streamed `message.delta` becomes the assistant content, and the answer content does not equal or contain the prior progress status. Verification passed: `pnpm --filter @ora/desktop test -- viewModel.test.ts` and `pnpm --filter @ora/desktop typecheck`.
  Next: 1) capture real manual-mode timing marks; 2) capture real auto-mode timing marks; 3) choose the first repair from measured bottleneck.

- 2026-05-01 17:06 CST - Captured runtime-chain latency marks using built runtime + `InMemoryRunStore` for one manual and one auto run with `local-smoke`. Manual: client start->handle 36ms, first stream receipt 35ms, runtime enter->first text 50ms; segments: modeSelection 1ms, memoryPrompt 9ms, kernelScheduled->firstEvent 22ms, firstEvent->providerCall 14ms, providerCall->firstFrame 1ms, firstFrame->firstText 2ms. Auto: client start->handle 13ms, first stream receipt 12ms, runtime enter->first text 21ms; segments: modeSelection 2ms, memoryPrompt 0ms, kernelScheduled->firstEvent 8ms, firstEvent->providerCall 9ms, providerCall->firstFrame 1ms, firstFrame->firstText 0ms. Control with `progressNarration:false`: manual enter->firstText 45ms, auto enter->firstText 21ms. First repair decision: progress narration currently happens before first assistant text (`firstProgressNarration` appears before `providerCallStarted`/`firstTextDelta`), so the first code change should defer/guard progress narration until after first assistant text or keep it out of the main answer slot. Auto router was not a bottleneck in local-smoke capture, but still needs real provider confirmation later.
  Next: 1) implement progress narration guard/defer; 2) verify progress-only UI still works for deterministic runtime status; 3) rerun focused tests and capture latency again.

- 2026-05-01 17:47 CST - Implemented first repair in `apps/runtime/src/harness/runtime-progress.ts`: `emitRuntimeProgressNarration` now returns before calling the provider unless prior events already include a non-empty assistant `message.delta`. This preserves deterministic `runtime_status` progress but prevents LLM-authored progress narration from running before first assistant text. Updated `apps/runtime/test/runtime-progress.test.ts` with a guard test and kept incomplete-sentence filtering covered after assistant text starts. Focused verification: exact runtime progress test file passed, runtime typecheck passed, runtime build passed, `git diff --check` passed. A broad `pnpm --filter @ora/runtime test -- runtime-progress.test.ts` invocation ran unrelated suites and failed on pre-existing/parallel desktop copy expectations, so the exact-file command was used for this change. Recaptured latency: manual firstProgressNarration moved after firstText (firstText 44ms, progressNarration 61ms); auto firstText 40ms, progressNarration 66ms. First repair succeeded structurally: no LLM-authored progress narration before the first assistant text.
  Next: 1) decide whether to keep progress narration after first text or make it fire-and-forget; 2) perform behavior-level UI check; 3) run full DONE gate when unrelated test drift is resolved or scoped.

- 2026-05-01 18:20 CST - Added a developer-facing `延迟` tab to Trails. `buildLatencyDiagnostics()` now derives summary, key segments, raw marks, provider mode, and recommendations from `StateSnapshot.latency.marks`; `TrailsTabs` renders summary cards, segment status pills, and raw mark details. Added trail view-model tests for normal latency and progress-before-text detection. Verification passed: `pnpm --filter @ora/desktop exec vitest run src/lib/trailViewModel.test.ts`, `pnpm --filter @ora/desktop typecheck`, and `git diff --check`.
  Next: 1) open a real run in desktop Trails and confirm the latency tab is readable; 2) capture tool-first timing; 3) decide whether post-first-text progress narration should become fire-and-forget.

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

- [x] Code compiles/runs without errors for touched packages.
- [x] Focused unit tests pass.
- [x] Type checks pass.
- [x] Shared contract rebuild completed before downstream checks.

**Output:** See `Verification / Commands run + outputs` below.

### Functional Verification (Feature Works)

- [x] Manual mode simple prompt produces timing breakdown.
- [x] Auto mode simple prompt produces timing breakdown and identifies router cost.
- [ ] Tool-first run distinguishes first tool event from first assistant natural text.
- [x] Fallback provider is marked as non-true-streaming at provider callback/runtime event level (`fallback_started` / `fallback_response`, `streamMode: fallback_single`).
- [x] LLM-authored progress narration no longer runs before first assistant text in runtime-chain capture.
- [ ] UI visually distinguishes progress placeholder from assistant answer.

**Output:** Runtime-chain manual/auto timing captured with built runtime + `InMemoryRunStore` using `local-smoke`; external provider latency still needs confirmation if the fix does not resolve user-visible delay.

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
- Status: [x] Pass / [ ] Fail
- Evidence: Shared `RunLatencyDiagnostics` added; desktop marks submit/pending/handle/getState/stream receive; runtime marks pre-handle phases, first live event, first text/user-readable text, progress narration, tool detection; provider marks SSE first frame, fallback start/response, local smoke start. Manual timing capture is tracked as a separate TODO before repair selection.

### Checkpoint 4: Regression tests added
- Requirement: Tests cover progress-only, text-after-progress, tool-first, fallback provider, and SSE non-text-first cases.
- Verification method: Focused test command output pasted under Verification.
- Status: [ ] Pass / [ ] Fail
- Evidence: Partial. Added shared contract test for latency diagnostics, desktop state tests for latency mark preservation and stream-receive first text marks, and strengthened viewModel coverage for progress-only status vs streamed assistant answer priority. Remaining before full checkpoint pass: behavior-level tool-first/manual/auto timing capture and any provider-specific stream tests if needed after real timing results.

### Checkpoint 5: Targeted repair selected by evidence
- Requirement: Repair choice cites measured bottleneck, not intuition.
- Verification method: Progress Log records timing results and chosen fix.
- Status: [x] Pass / [ ] Fail
- Evidence: Local runtime-chain timing captured at 17:06 CST. Manual enter->firstText 50ms; auto enter->firstText 21ms; local-smoke auto router was not a bottleneck. First repair chosen: defer/guard progress narration because `firstProgressNarration` occurs before `providerCallStarted`/`firstTextDelta`, which would become an extra pre-answer model call with real providers.

### Checkpoint 6: Functional UX verified
- Requirement: User sees immediate feedback; progress-only state is not confused with final answer; final assistant text replaces progress.
- Verification method: Manual verification scenarios recorded under Functional Verification.
- Status: [ ] Pass / [ ] Fail
- Evidence: Pending implementation.

**All checkpoints must pass before marking task DONE.**

## Compressed State (<= 20 lines)

- Objective: Diagnose and fix Ora send-to-first-token / first-user-readable-text latency and progress-only first-screen UX.
- Current truth: First instrumentation pass is implemented and verified at code/type/test level.
- Added shared contract: `StateSnapshot.latency?: { marks }` with `RunLatencyMark` source=`desktop|runtime|provider`.
- Desktop marks: submit, pending painted, startStreamingRun called, handle received, getRunState received, first stream received, first message delta, first non-progress assistant text.
- Runtime marks: startStreamingRun enter, mode selection done, memory prompt done, conversation messages done, snapshot created/persisted, kernel scheduled, first live event/text/progress/tool/provider markers.
- Provider marks: SSE first frame, fallback started/response, local smoke stream started.
- Tests added: shared latency contract; desktop state latency merge and stream receive marks.
- Verification passed: shared contracts, desktop focused tests, shared typecheck/build, runtime typecheck, desktop typecheck, `git diff --check`.
- ViewModel coverage confirmed: progress-only status remains live progress; streamed `message.delta` wins as assistant content and is not treated as progress.
- Runtime-chain timing captured: manual enter->firstText 50ms; auto enter->firstText 21ms; no local-smoke auto-router bottleneck.
- First repair selected: defer/guard progress narration before first assistant text.
- First repair implemented: LLM-authored progress narration is skipped until a non-empty assistant `message.delta` exists.
- Recapture after repair: manual firstText 44ms, firstProgressNarration 61ms; auto firstText 40ms, firstProgressNarration 66ms.
- Trails latency tab added: summary, key segments, raw marks, provider mode, and recommendations from `StateSnapshot.latency.marks`.
- Not done: behavior-level UI check, tool-first scenario check, full DONE gate; external provider confirmation remains a follow-up if needed.
- Active task file: `tasks/TASK-20260501-1526-message-flow-to-first-token.md`.
- Next actions: 1) open real run in desktop Trails and inspect latency tab; 2) tool-first timing scenario; 3) decide whether post-text progress narration should be fire-and-forget.
- Blockers/Risks: Need real timing output; avoid touching `queuedStreams` prematurely; avoid fake pre-tool natural language.
- Verification status: Phase 1 instrumentation verified; Phase 2/3 pending.

## Verification

### Evidence Requirements

Must provide the following evidence before DONE:

- [x] Code Verification output (compilation/tests/lint)
- [ ] Functional Verification output (manual mode / auto mode / tool-first / provider fallback / UI behavior)
- [x] Timing output with segment breakdown
- [x] Retrospective evidence
- [x] Comparison evidence
- [x] Checkpoints evidence for completed checkpoints

### Environment

- Environment: macOS / workspace `/Users/quintenchen/developer/ora`
- Current date: 2026-05-01

### Commands run + outputs

- `pnpm --filter @ora/shared test -- contracts.test.ts`
  - Result: passed. `test/contracts.test.ts` 89 tests passed.
- `pnpm --filter @ora/desktop test -- state.test.ts`
  - Result: passed. 12 test files, 93 tests passed. Includes `src/lib/state.test.ts` 17 tests.
- `pnpm --filter @ora/shared typecheck`
  - Result: passed.
- `pnpm --filter @ora/shared build`
  - Result: passed. Required because downstream packages consume `@ora/shared` through built `dist` declarations.
- `pnpm --filter @ora/runtime typecheck`
  - Result: passed.
- `pnpm --filter @ora/desktop typecheck`
  - Result: passed.
- `git diff --check`
  - Result: passed, no whitespace/conflict marker issues.
- `pnpm --filter @ora/desktop test -- viewModel.test.ts`
  - Result: passed. 12 test files, 93 tests passed. Strengthened `src/lib/viewModel.test.ts` progress-vs-answer priority assertions.
- `pnpm --filter @ora/desktop typecheck`
  - Result: passed after viewModel test update.
- `pnpm --filter @ora/runtime build`
  - Result: passed. Built runtime so the diagnostic script could import `dist` modules and consume shared `dist` exports.
- Runtime-chain diagnostic script via `node --input-type=module` against built runtime + `InMemoryRunStore`
  - Result: initial `tsx -e` attempts failed due top-level await/CJS and package exports resolution; switched to built `dist` modules.
  - Manual local-smoke: client start->handle 36ms; first stream receipt 35ms; runtime enter->first text 50ms; modeSelection 1ms; memoryPrompt 9ms; kernelScheduled->firstEvent 22ms; firstEvent->providerCall 14ms; providerCall->firstFrame 1ms; firstFrame->firstText 2ms.
  - Auto local-smoke: client start->handle 13ms; first stream receipt 12ms; runtime enter->first text 21ms; modeSelection 2ms; memoryPrompt 0ms; kernelScheduled->firstEvent 8ms; firstEvent->providerCall 9ms; providerCall->firstFrame 1ms; firstFrame->firstText 0ms.
  - Control with `progressNarration:false`: manual enter->firstText 45ms; auto enter->firstText 21ms.
  - Decision: first repair is progress narration guard/defer. In both normal runs `firstProgressNarration` appears before the first assistant text path, so real providers can pay a full extra model-call cost and show progress before answer.
- `pnpm --filter @ora/runtime exec vitest run test/runtime-progress.test.ts`
  - Result: passed. 1 test file, 2 tests passed. Confirms provider is not called before first assistant text, and incomplete narration is still filtered after assistant text starts.
- `pnpm --filter @ora/runtime typecheck`
  - Result: passed.
- `pnpm --filter @ora/runtime build`
  - Result: passed.
- Post-repair runtime-chain recapture via built runtime + `InMemoryRunStore`
  - Manual local-smoke: firstText 44ms, firstProgressNarration 61ms.
  - Auto local-smoke: firstText 40ms, firstProgressNarration 66ms.
  - Result: `firstProgressNarration` now occurs after first assistant text in both cases.
- `git diff --check`
  - Result: passed after first repair.
- `pnpm --filter @ora/runtime test -- runtime-progress.test.ts`
  - Result: broad invocation unexpectedly ran unrelated suites and failed on existing/parallel desktop copy expectation drift (Chinese punctuation/label changes). Not used as evidence for this targeted repair; exact-file command above passed.
- `pnpm --filter @ora/desktop exec vitest run src/lib/trailViewModel.test.ts`
  - Result: passed. 1 test file, 11 tests passed. Covers latency diagnostics summary and progress-before-text detection.
- `pnpm --filter @ora/desktop typecheck`
  - Result: passed after Trails latency tab implementation.
- `git diff --check`
  - Result: passed after Trails latency tab implementation.

### Changed files in this phase

- `packages/shared/src/runtime.ts` — added `RunLatencyMarkSchema`, `RunLatencyDiagnosticsSchema`, and optional `StateSnapshot.latency`.
- `packages/shared/test/contracts.test.ts` — added latency diagnostics contract test.
- `apps/desktop/src/App.tsx` — records stream receipt timestamp before dispatch.
- `apps/desktop/src/lib/useRunActions.ts` — adds desktop submit/pending/handle/getState latency marks.
- `apps/desktop/src/lib/state.tsx` — preserves latency marks across snapshot/stream merges and records first stream/message/user-readable text receipt marks.
- `apps/desktop/src/lib/state.test.ts` — tests latency merge and stream-receive latency marks.
- `apps/runtime/src/run-store.ts` — records runtime pre-handle phases and first live event/text/tool/progress/provider markers.
- `apps/runtime/src/harness/node-runtime-loop.ts` — forwards provider stream callback events as runtime events for diagnostics.
- `apps/runtime/src/providers/types.ts` — adds `ModelStreamEvent` / `onStreamEvent` callback contract.
- `apps/runtime/src/providers/streaming.ts` — marks fallback start/response.
- `apps/runtime/src/providers/openai.ts`, `openai-compatible.ts`, `anthropic.ts` — mark first SSE frame.
- `apps/runtime/src/providers/local-smoke.ts` — marks local smoke stream start.
- `apps/runtime/src/harness/runtime-progress.ts` — skips LLM-authored progress narration until an assistant `message.delta` exists.
- `apps/runtime/test/runtime-progress.test.ts` — covers the pre-first-text guard and preserves incomplete narration filtering after first text starts.
- `apps/desktop/src/lib/trailViewModel.ts` — adds `buildLatencyDiagnostics()` and latency segment/recommendation model.
- `apps/desktop/src/components/TrailsTabs.tsx` — adds developer-facing `延迟` tab with summary, segments, and raw marks.
- `apps/desktop/src/lib/trailViewModel.test.ts` — covers latency diagnostics and progress-before-text warning.
