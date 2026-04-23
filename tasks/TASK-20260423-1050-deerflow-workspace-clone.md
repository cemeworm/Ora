# TASK-20260423-1050-deerflow-workspace-clone

**Created:** 2026-04-23 10:50 CST
**Status:** Done

---

## Goal
- Rework `apps/desktop` so the main Ora desktop workspace closely follows DeerFlow's Workspace UI: collapsible left sidebar, centered chat workspace, floating prompt input, welcome state, DeerFlow-like message spacing, and a right-side details/artifacts panel, while preserving Ora's existing runtime client and action contracts.

## Scope / Out of scope
- In scope: `apps/desktop` workspace shell, visual tokens, sidebar, chat header, chat messages, prompt input, details drawer, and the minimal local UI primitives required to support the DeerFlow look.
- Out of scope: DeerFlow landing/docs/blog pages, Next.js App Router, LangGraph SDK thread APIs, auth, i18n migration, and real DeerFlow model/agent management.

## Constraints
- Compatibility: keep Vite, React 18, Tailwind 3, Tauri 2, and Ora runtime API unchanged.
- Performance: avoid broad dependency and architectural churn; use static/controlled components where Ora data already exists.
- Risk: DeerFlow uses Tailwind 4 and Next APIs, so classes and route behavior must be translated to Vite/Tailwind 3 equivalents.
- Tool/Environment limits: edits are local; final verification must include desktop typecheck/build and a dev-server visual smoke check if feasible.

## Plan
1. Add local UI primitives and DeerFlow-inspired design tokens under `apps/desktop/src/components/ui`, `apps/desktop/src/lib/utils.ts`, `apps/desktop/src/styles.css`, and Tailwind config.
2. Adapt shell/sidebar/chat workspace components (`AppShell`, `Sidebar`, `ChatView`, `ChatHeader`, `ChatMessages`, `MessageBubble`, `ChatInput`) to DeerFlow workspace layout while preserving props and state actions.
3. Restyle the right details drawer as a DeerFlow artifacts-style panel and verify typecheck/build plus responsive smoke behavior.

## Active Files
- apps/desktop/package.json
- apps/desktop/tsconfig.json
- apps/desktop/vite.config.ts
- apps/desktop/tailwind.config.ts
- apps/desktop/src/styles.css
- apps/desktop/src/lib/state.tsx
- apps/desktop/src/lib/utils.ts
- apps/desktop/src/components/ui/*
- apps/desktop/src/components/AppShell.tsx
- apps/desktop/src/components/Sidebar.tsx
- apps/desktop/src/components/ChatView.tsx
- apps/desktop/src/components/ChatHeader.tsx
- apps/desktop/src/components/ChatMessages.tsx
- apps/desktop/src/components/MessageBubble.tsx
- apps/desktop/src/components/ChatInput.tsx
- apps/desktop/src/components/DetailDrawer.tsx

## Decisions
- Decision: Keep Vite/React 18/Tailwind 3 and translate DeerFlow visual primitives locally.
  - Why: The plan explicitly avoids a stack upgrade and Ora desktop is already a Tauri/Vite app.
  - Alternatives: Next.js/React 19 migration or pure skinning of old components.
  - Tradeoffs: Less source-level 1:1 than a full DeerFlow port, but lower risk and preserves Ora runtime behavior.

## Progress Log
- 2026-04-23 10:50 CST - Task created
  Next: Fill in Goal, Scope, Plan, and list Active Files
- 2026-04-23 10:52 CST - Filled execution plan and constraints after confirming target scope from the approved plan.
  Next: Add UI primitives/design tokens; refactor shell/sidebar; refactor chat workspace.
- 2026-04-23 10:54 CST - Added minimal desktop UI dependencies: `clsx`, `tailwind-merge`, `class-variance-authority`, and `@radix-ui/react-slot`.
  Next: Add UI primitives/design tokens; refactor shell/sidebar; refactor chat workspace.
- 2026-04-23 11:08 CST - Implemented DeerFlow-inspired tokens, UI primitives, AI element stubs, sidebar, chat header/messages/input, welcome state, and details panel.
  Next: Run desktop typecheck/build; perform browser smoke; fix responsive issues.
- 2026-04-23 11:16 CST - Verified desktop and mobile browser smoke; fixed mobile Details panel so it opens full-width instead of toggling invisibly.
  Next: Finalize verification evidence; clear TODO; stop dev server.
- 2026-04-23 11:20 CST - Added desktop TS/Vite alias for `@ora/shared` to source so desktop checks do not rely on prebuilt `packages/shared/dist`.
  Next: Re-run final typecheck/build; final response.

## Open Issues
- None.

## TODO
- None.

## Retrospective
- Record 0-3 highest-value pitfalls from this task.
- Leave reusable operational lessons here even when they later get promoted into a skill.

### Item 1
- Pitfall: Desktop-first panels can accidentally become invisible on mobile when the trigger remains visible.
- Symptom: The Details button changed active state at ~375px width but the panel did not appear.
- Root Cause: The panel used `hidden md:block` while the header trigger remained available below `md`.
- Reusable Guardrail: When a responsive panel trigger is visible, verify the controlled panel is visible at the same breakpoint or hide/replace the trigger.
- Evidence: Mobile smoke via Chrome window bounds `{80,80,455,900}` showed missing panel; patch changed Details drawer to mobile full-width and desktop right panel.
- Scope: local_only
- Suggested Writeback Target: none
- Status: local_only

## Functional Verification

### Code Verification (Code Correctness)
- [x] Code compiles/runs without errors
- [ ] Unit tests pass
- [ ] Lint checks pass

**Output**:
- `pnpm --filter @ora/desktop typecheck`
  - `tsc --noEmit` completed with exit code 0.
- `pnpm --filter @ora/desktop build`
  - `tsc && vite build`
  - `✓ 1620 modules transformed.`
  - `✓ built in 1.78s`
- Notes:
  - Initial run showed `@ora/shared` dist was missing in a fresh local install; added desktop TS/Vite alias to source and re-ran checks successfully.
  - No desktop-specific unit or lint script exists beyond `typecheck`/`build`.

### Functional Verification (Feature Works)
- [x] Core functionality verification (browser smoke at `http://127.0.0.1:1420`)
- [x] Edge cases verification
- [x] Error handling verification

**Output**:
- Desktop Chrome smoke at `http://127.0.0.1:1420/`: sidebar, Recent Chats, header actions, centered messages, floating prompt input, and Details trigger rendered.
- Clicked Details: right-side DeerFlow-like panel opened with tabs and Ora `DetailTabs` content.
- Mobile-width smoke via Chrome bounds `{80, 80, 455, 900}`: sidebar collapsed out of layout, chat content and prompt did not overlap.
- Mobile Details edge case: initial smoke found invisible panel; after fix, Details opens as a full-width overlay with close button and tabs.

**Examples**:
- Database: `SELECT * FROM table WHERE field_name IS NOT NULL LIMIT 5;`
- API: `curl "url" | jq '.results[0].field_name'`
- UI: Manual test steps and results
- Bug fix: Verification bug is fixed

## Comparison (If Applicable)

### Reference
- Reference implementation/template/similar task: DeerFlow frontend workspace at commit `c43c803f66f595d16fb8227fea241d887a0f30dc`.

### Comparison Points
- [x] Workspace shell/sidebar visual structure.
- [x] Chat page header/message/input composition.
- [x] Details/artifacts panel behavior adapted to Ora data.

### Findings
- Consistency: Ora now uses the DeerFlow-style soft background, collapsible sidebar, centered chat, floating prompt input, and right-side detail panel.
- Differences: Kept Vite/React 18/Tailwind 3 and Ora runtime state; did not migrate Next.js routing, LangGraph thread APIs, or DeerFlow auth/i18n.
- Conclusion: Workspace UI parity is implemented at the approved scope while preserving Ora contracts.

## Checkpoints

### Checkpoint 1: Visual System + Primitives
- Requirement: DeerFlow-like tokens and minimal UI/AI primitives exist without stack migration.
- Verification method: code review + build.
- Status: [x] Pass
- Evidence: Added `src/lib/utils.ts`, `components/ui/*`, `components/ai-elements/*`, CSS variables, and Tailwind token mapping; build passed.

### Checkpoint 2: Workspace Interaction
- Requirement: Sidebar, chat, floating input, and details panel work at desktop and mobile widths.
- Verification method: Chrome smoke test at desktop width and ~375px width.
- Status: [x] Pass
- Evidence: Desktop Details opens as right panel; mobile Details opens as full-width panel after fix; no observed content/input overlap.

**All checkpoints must pass before marking task DONE!**

## Compressed State (<= 20 lines)
- Objective: Rework Ora desktop workspace to DeerFlow Workspace visual/layout patterns without changing runtime APIs.
- Done: DeerFlow-inspired UI tokens/primitives, sidebar, chat workspace, floating prompt, message styling, Details panel, mobile panel fix, and desktop `@ora/shared` source alias.
- In-progress: None.
- Active files: desktop package/config/styles/state/components plus task journal.
- Next actions (top 3; exact file/function): none; task complete.
- Blockers/Risks: `AGENTS.md` remains pre-existing untracked user file; gstack browse not set up, so visual smoke used Chrome desktop automation.
- Verification status: `@ora/desktop` typecheck/build passed; desktop and mobile browser smoke passed.

## Verification

### Evidence Requirements
Must provide the following evidence:
- [x] Code Verification output (compilation/tests/lint)
- [x] Functional Verification output (feature verification)
- [x] Retrospective Evidence (if applicable)
- [x] Comparison Evidence (if applicable)
- [x] Checkpoints Evidence (if applicable)

### Environment
- Environment: macOS desktop, Vite dev server `http://127.0.0.1:1420`, Chrome visual smoke, pnpm 10.11.0.

### Commands run + outputs
- `pnpm install`
  - Completed after registry retry; installed workspace dependencies and `better-sqlite3` native package.
- `pnpm --filter @ora/shared build`
  - `tsc -p tsconfig.json` completed with exit code 0 before the desktop alias was added.
- `pnpm --filter @ora/desktop typecheck`
  - `tsc --noEmit` completed with exit code 0.
- `pnpm --filter @ora/desktop build`
  - `✓ 1620 modules transformed.`
  - `✓ built in 1.78s`
- `pnpm --filter @ora/desktop dev`
  - Vite ready at `http://127.0.0.1:1420/`.
- `bash skills/long-task-protocol/scripts/todo_scan.sh`
  - No output.
