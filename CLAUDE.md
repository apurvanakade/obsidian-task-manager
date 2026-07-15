# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An Obsidian plugin (Task Manager) that automates task lifecycle management: state transitions, completion metadata stamping, recurring task creation, file routing by status, editor autocomplete for date fields, a right-sidebar date dashboard, and live Tasks Summary and Weekly Review tabs.

## Commands

```bash
npm run dev      # watch mode — rebuilds main.js on file changes via esbuild
npm run build    # type-check (tsc --noEmit --skipLibCheck) + production bundle → main.js
```

There are no test or lint commands in this repo. After any build, reload the plugin in Obsidian to verify behavior — the `verify` skill or manual reload is the only way to confirm runtime correctness here.

Bundling: `esbuild.config.mjs` bundles `main.ts` → `main.js` (CommonJS, ES2018). `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, and Node builtins are marked external and must never be bundled.

## Architecture

### Module Map

```
main.ts                          ← Plugin entry point; wires all services
src/
  tasks/
    task-processor.ts            ← Primary orchestrator; vault.modify handler + command runner
    reconciler.ts                ← Task transition logic (completion, uncompletion, deletion, recurring)
    file-priority.ts             ← Pure file-priority parser
    task-line-metadata.ts        ← Canonical task-line parser (parseTaskLineStructured) + display-text helpers; task-utils.ts and reconciler.ts build on this instead of their own regexes
    frontmatter-utils.ts         ← Pure single-field frontmatter parser over a content string (shared by status-routing.ts and file-priority.ts; deliberately NOT metadataCache-based, see Obsidian API Usage below)
    repeat-rules.ts              ← Pure recurring-rule parser, alias normalizer, and due-date calculator
    task-utils.ts                ← Pure parsing/diffing utilities (no side effects); task-line parsing delegates to task-line-metadata.ts
    next-actions.ts              ← Pure findActionableTaskLines(): single first-open-line by default, or one line per context group when settings.enableMultipleNextActions is on
    task-state-store.ts          ← In-memory snapshot cache (tasks + status per file)
    due-date-modal.ts            ← Modal for collecting due date + file priority for the first incomplete task; submit is keyed by the captured task-line index, not string equality
  summary/
    tasks-summary.ts             ← Pure(ish) data layer: collects actionable-task rows for the Tasks Summary tab (no writes)
    tasks-summary-view.ts        ← On-demand main-panel ItemView controller/renderer for the Tasks Summary tab (live Context filter + auto-refresh)
    summary-file-io.ts           ← Shared pure isInFolder/isExcludedSummaryFile, used by tasks-summary.ts, weekly-review-data.ts, and random-project.ts
  routing/
    status-routing.ts            ← Pure status extraction, validation, routable-status constants
    task-routing.ts              ← File movement: destination resolution, folder creation, merge handling
  projects/
    add-project-modal.ts         ← Modal and helpers for creating a new project note
    random-project.ts            ← Lists Someday-Maybe project files and picks one at random
  tables/
    grouped-task-table.ts        ← Pure grouped task-table model shared by dashboard and summary
  dashboard/
    date-dashboard.ts            ← Right-sidebar ItemView controller + renderer
    dashboard-task-data.ts       ← Task parsing/filtering/sorting for dashboard display
  editor/
    due-date-suggest.ts          ← EditorSuggest for due:: and created:: inline fields
    context-suggest.ts           ← EditorSuggest for context::/contexts::, sourced from settings.knownContexts
  date/
    date-utils.ts                ← Pure shared date formatting and ISO date helpers
    date-suggestions.ts          ← Canonical date suggestion list (ISO dates + human labels)
  settings/
    settings-utils.ts            ← TaskManagerSettings type, DEFAULT_SETTINGS, normalizeSettings()
    settings-ui.ts               ← PluginSettingTab renderer
    settings-field-definitions.ts← Declarative metadata for settings controls
    folder-picker.ts             ← FuzzySuggestModal wrappers for vault folder/file pickers
  commands/
    register-task-commands.ts    ← Registers "Reset Tasks", "Open Tasks Summary", "Add New Project", "Open Random Someday-Maybe Project", "Quick Capture Task", "Open Weekly Review", "Stamp Waiting-Since For Existing Waiting Projects"
  review/
    weekly-review-view.ts        ← On-demand main-panel ItemView controller/renderer for the Weekly Review tab; auto-refreshes (debounced) on relevant vault modify/rename/delete events while a tab is open
    weekly-review-data.ts        ← Collects Active Projects/Waiting/Someday-Maybe staleness rows; stamps the `reviewed` frontmatter field
```

### Key Data Flow

1. **vault `modify` event** → `TaskProcessor.handleFileModify()` processes only markdown files inside the configured task roots or the configured Inbox File, reads file fresh (non-cached) via `vault.read`, diffs against state-store snapshot, calls `reconciler` to apply transition rules, calls `task-routing` if status changed → writes back → state-store updated/rekeyed
2. **Pending-path guards** in `TaskStateStore` prevent re-triggering the modify handler on self-writes
3. **Line-count guard**: `findNewlyCompletedTask()`/`findNewlyUncompletedTask()` (`task-utils.ts`) compare snapshots purely by line **index**, which is only trustworthy when the document's total line count hasn't changed since the last snapshot (`TaskStateStore.getLineCount()`, updated in lockstep with task state via `TaskProcessor.snapshotTaskState()`). Deleting or inserting a line shifts every subsequent line's index, which can make an unrelated, already-completed line look like it just transitioned — e.g. a completed recurring task's historical entry (which keeps its `[repeat:: ...]` field forever) can appear "newly completed" after a line above it is deleted, spawning another clone, which looks like a deleted task "coming back." When the line count has changed, `handleFileModify()` skips the completion/uncompletion special-case paths entirely and falls back to generic `reconcileFile()`.
4. **vault `rename`/`delete` events** → `main.ts` also calls `TaskProcessor.handleFileRename()`/`handleFileDelete()`, which rekey/delete the corresponding `TaskStateStore` entries. This exists specifically so external renames/deletes (file explorer, sync, other plugins) don't leave a stale snapshot under the old path — internal moves driven by routing already call `stateStore.rekey()` directly, but external ones previously had no path to keep the store in sync.
5. **Commands** call `TaskProcessor.resetCurrentFileTasks()` directly
6. **Status changes** and **DueDateModal submits** call `TasksSummaryController.refreshSoon()` (a debounced no-op if no Tasks Summary tab is open) after routing/due-date-priority updates
7. **Dashboard** is refreshed on `file-open`, `layout-change`, vault `rename`/`delete` events, and after settings changes
8. **Tasks Summary and Weekly Review tabs**, while open, independently auto-refresh (debounced) on their own vault `modify`/`rename`/`delete` listeners registered in `onload()` — see their respective sections below

### Commands

- **Reset Tasks** — in the active file, marks all tasks open (`[ ]`), strips `[due:: ...]`, `[completion-date:: ...]`, `[completion-time:: ...]`, and `[created:: ...]` from task lines, then re-runs the normal task reconciliation and routing flow for that file
- **Open Tasks Summary** — opens (or reveals, if already open) a `TasksSummaryController`-registered `ItemView` in a full main-panel tab via `workspace.getLeaf(true)`, not a sidebar leaf or generated note — see Tasks Summary below
- **Add New Project** — opens a modal asking for Name, Folder, Priority, Status (`todo`, `waiting`, or `someday-maybe`), and optional starter tasks; the Folder field shows matching vault folders as you type; the command creates the project file, writes status/priority to frontmatter, creates missing parent folders, and opens the new file
- **Open Random Someday-Maybe Project** — lists markdown files under the configured Someday-Maybe Projects Folder (excluding the Inbox file, in case it's misconfigured into that folder), picks one uniformly at random via `getSomedayMaybeProjectFiles()`/`pickRandomFile()` in `src/projects/random-project.ts`, and opens it in a new leaf. Also bound to a `shuffle` ribbon icon (`main.ts` `addRibbonIcon`) calling the same handler. Shows a `Notice` instead of opening a file when the folder setting is empty or no candidate files exist.
- **Quick Capture Task** — opens `QuickCaptureModal` (`src/tasks/quick-capture-modal.ts`), a single-input modal. Enter or the Capture button submits. `parseQuickCaptureShorthand()` repeatedly peels recognized trailing tokens (a `due:<value>` token and/or one or more `@context` tokens, in any order) off the raw input — `due:` is resolved via the shared `resolveDateInput()` (`src/date/date-suggestions.ts`); an unresolvable `due:` token, or any token that isn't a recognized shorthand, stops the peel and is left in the task text unchanged rather than dropped. `main.ts`'s `runQuickCapture()` inserts `- [ ] <text> [due:: ...] [context:: ...]` (fields included only when present) as the **first task line** in the configured Inbox File — via the module-level `prependTaskLine()` helper, which inserts right after the frontmatter block if the file has one, otherwise at byte 0 — creating the file (and its parent folders via `ensureParentFoldersExist()`) if it doesn't exist yet. Uses `vault.read()` + `vault.modify()` rather than `vault.append()`, since Obsidian's `Vault.append()` can only add to the end of a file. Also bound to a `list-plus` ribbon icon. Shows a `Notice` instead of opening the modal when the Inbox File setting is empty. Because the Inbox File is already tracked by `TaskProcessor.shouldTrackFile()` and the dashboard's `isRelevantFile()`, the write flows through the normal `vault.on("modify")` pipeline with no additional state-tracking or refresh code needed.
- **Open Weekly Review** — opens (or reveals, if already open) a `WeeklyReviewController`-registered `ItemView` in a full main-panel tab via `workspace.getLeaf(true)`, not a sidebar leaf or generated note — see Weekly Review below.
- **Stamp Waiting-Since For Existing Waiting Projects** — one-time backfill via `TaskProcessor.backfillWaitingSince()`: scans `settings.waitingProjectsFolder` and stamps `waiting-since` (today's date) on any file missing it. Idempotent — already-stamped files are skipped.

### Settings Persistence

Settings live in `data.json` (loaded/saved via `plugin.loadData()` / `plugin.saveData()`). After a settings change, call `plugin.updateSetting()` — it persists, re-primes task state, and refreshes the dashboard. Settings are normalized on load/save via `normalizeSettings()`.

Configurable paths: Projects Folder, Completed Projects Folder, Waiting Projects Folder, Someday-Maybe Projects Folder, Inbox File (file picker, not folder).

Other settings: Completed Status Field (default `status`), Dashboard Filename Hide Keywords (comma-separated keywords stripped from display names in the dashboard and Tasks Summary tab), Known Contexts (comma-separated, default empty; powers the Context filter dropdown in both the dashboard and the Tasks Summary tab, plus `context::`/`contexts::` editor autocomplete, via `parseContextList()`), Enable Multiple Next Actions (boolean, default off; gates `findActionableTaskLines()`'s plural per-context behavior — see Multiple Next Actions above), Someday-Maybe Review Cadence Days and Waiting Staleness Threshold Days (both stored as strings, default `"30"`/`"7"`, normalized via `normalizePositiveIntegerString()` and parsed at the Weekly Review's point of use — see Weekly Review below).

There is deliberately no persisted Tasks Summary context-filter setting — unlike the date dashboard's context filter, and now the Tasks Summary tab's own context filter, selection is session-only UI state held on the controller instance (`selectedContext`), not written to `data.json`.

### Status Routing

Four routable statuses: `todo`, `completed`, `waiting`, `someday-maybe`. Each maps to a configured folder. **Relative sub-path from the matched source root is preserved at the destination** — compute it from the matched configured root, not a hardcoded single root, or files will collapse to the destination root. Missing destination parent folders are created automatically. On path collision, a `MergeConflictModal` prompts merge or skip. Empty folders left behind after a move are deleted (with safety checks). The configured Inbox File is not routable and must never be moved by status changes. When plugin-driven frontmatter metadata edits touch a project file, they also add `priority: 3` if the priority field is missing. `TaskProcessor.updateWaitingSinceStamp()` additionally stamps `waiting-since` (today's date, via `getCurrentDateString()`) on transition into `waiting`, and deletes that field on transition out — called from `routeAfterStatusChange()` for any status change, not just routable ones, since `waiting` itself is what's being detected.

## Weekly Review

An on-demand main-panel `ItemView` (`src/review/weekly-review-view.ts`), deliberately not a persistent sidebar leaf (unlike the date dashboard) — it needs interactive per-row actions and full table width that an always-visible sidebar panel doesn't fit well, and it's meant to be a deliberate, occasional activity rather than something glanced at constantly.

- `WeeklyReviewController.openView()` reuses an existing leaf of `WeeklyReviewController.VIEW_TYPE` if one is already open (via `workspace.getLeavesOfType()` + `revealLeaf()`), refreshing it in place; otherwise opens a new full tab via `workspace.getLeaf(true)`.
- While a leaf of this view type is open, `WeeklyReviewController` auto-refreshes it: `onload()` registers debounced (50ms, via `queueRefresh()`) vault `modify`/`rename`/`delete` listeners — `modify` is filtered through `isRelevantFile()` (file under Projects/Waiting/Someday-Maybe folders), while `rename`/`delete` trigger unconditionally since a file could be moving into or out of a relevant folder. `refreshOpenViews()` iterates `getLeavesOfType()` and no-ops when the tab isn't open, so there's no cost to the listeners when nobody's looking. This mirrors the date dashboard's `queueRefresh()`/debounce pattern.
- `src/review/weekly-review-data.ts` is the pure(ish) data layer (one write function, `stampReviewedDate()`, otherwise read-only):
  - `collectReviewRows()` (private) is the generic reviewed-staleness scanner shared by Active Projects and Someday-Maybe: scans a given folder, reads `REVIEWED_FRONTMATTER_FIELD` (`"reviewed"`, owned by this module) via `readFrontmatterField()`, computes `daysSinceReview`, and sorts most-stale-first.
  - `collectActiveProjectReviewRows()` calls `collectReviewRows()` against `settings.projectsFolder` with no filtering — every active project is always included, sorted least-recently-reviewed first. No cadence/threshold concept, unlike Someday-Maybe.
  - `collectSomedayReviewRows()` calls the same `collectReviewRows()` against `settings.somedayMaybeProjectsFolder`, then maps in a `needsReview` flag (never reviewed, or past `settings.somedayMaybeReviewCadenceDays`) — the one place `ReviewRow` is extended into `SomedayReviewRow`.
  - `collectWaitingReviewRows()` is separate (different field, different flag semantics): scans `settings.waitingProjectsFolder`, reads `WAITING_SINCE_FRONTMATTER_FIELD` (imported from `task-processor.ts`, the field's owner/writer), and computes `daysWaiting` and `isNewlyStale` (via `crossesThresholdWithinCurrentWeek()`, `date-utils.ts`, parameterized by `settings.waitingStalenessThresholdDays`).
  - All three sort most-stale-first; rows with no timestamp at all sort first of all, ahead of any numeric staleness — implemented by treating `null` as `Number.POSITIVE_INFINITY` in the shared `compareByStaleness()` comparator.
- Rows are file-shaped (one row per file, with staleness/timestamp columns), not task-line-shaped, so they don't fit `grouped-task-table.ts`'s `GroupedTaskTableRow` model (which is keyed on task/priority/dueDate/recurrence per checkbox line) — the view renders flat, un-grouped `<table>`s instead.
- `appendActiveProjectsSection()` and the Someday-Maybe table's **Mark Reviewed** buttons both call `stampReviewedDate()` directly then invoke the view's `onNeedsRefresh` callback (passed into `renderContent()`), which re-renders in place — no command re-run needed. Active Projects and Someday-Maybe share the same `reviewed` field and write path; only the Someday-Maybe table additionally shows a cadence-derived "Needs Review" column, since Active Projects intentionally has no threshold — the full list is always shown, ordered by staleness.
- `renderContent()` renders Active Projects first, then Waiting, then Someday-Maybe — matching the typical GTD review order of current commitments before the waiting-for list and the someday-maybe backlog.
- `runOpenRandomSomedayMaybeProject()` in `main.ts` also calls `stampReviewedDate()` before opening the file, so the existing random-picker doubles as a lightweight review mechanism at no extra UI cost — this was a deliberate design choice, not an accidental side effect. This only applies to Someday-Maybe; there's no equivalent random-pick command for Active Projects.
- `getEndOfWeek()` (`date-utils.ts`, previously unused anywhere in the codebase) now has two consumers: framing the view's "Week ending ..." header, and inside `crossesThresholdWithinCurrentWeek()`'s current-week bounds check.

## Task Reconciliation Rules

### Inline Field Format

Tasks use standard markdown checkboxes. Inline fields use Dataview-style double-colon syntax and appear on the same line as the task:

- `[due:: YYYY-MM-DD]` — due date
- `[completion-date:: YYYY-MM-DD]` — stamped on completion
- `[completion-time:: HH:MM:SS]` — stamped on completion
- `[repeat:: X]` / `[repeats:: X]` — recurring interval; accepts singular/plural aliases, adjective aliases (`daily`, `weekly`, `monthly`, `yearly`), numeric intervals like `2 weeks`, weekday names like `Monday`, and ordinal month-days like `5th`; `every` is optional for backward compatibility
- `[created:: YYYY-MM-DD]` — creation date (editor suggest only; not used by reconciler)
- `[context:: @home]` / `[contexts:: @home, @calls]` — one or more comma-separated task contexts, parsed by `getContexts()`/`parseContextList()` in `task-line-metadata.ts`; each token is lowercased and auto-prefixed with `@` if missing. Stripped from display text by the same generic `INLINE_FIELD_REGEX` that strips `due`/`repeat`/etc — no special-casing needed there.

Project priority is stored in file frontmatter as `priority: N`, where `1` is highest and missing/invalid values default to `3`.

By default, the first incomplete task in a file is treated as the current actionable task — `findActionableTaskLines()` in `src/tasks/next-actions.ts` returns exactly this single line when `settings.enableMultipleNextActions` is off (the default), so this remains the observed behavior unless that setting is explicitly turned on. See **Multiple Next Actions** below for the per-context variant.

### Completion (`[ ]` → `[x]`)

- Append `[completion-date:: YYYY-MM-DD]` and `[completion-time:: HH:MM:SS]` to the completed task line
- Move the completed task line into the `## Completed Tasks` section of the same file; if that section doesn't exist, it is appended to the end of the file
- The first remaining open task becomes the current actionable task implicitly; if none remain, status becomes `completed`
- When status becomes `completed`, also stamp `completion-date` and `completion-time` into the **file frontmatter** (in addition to the task-line inline fields)

### Uncompletion (`[x]` → `[ ]`)

- If the reopened task is actionable per `findActionableTaskLines()` (the first open task overall, or — with Multiple Next Actions on — the first open task in its context group), it becomes the current actionable task implicitly
- Reconciliation also strips stale `[completion-date:: ...]` and `[completion-time:: ...]` from open tasks

### Multiple Next Actions

`settings.enableMultipleNextActions` (default `false`) gates `findActionableTaskLines()`'s plural behavior in both `reconciler.ts` and `tasks-summary.ts`. Off, the function always returns at most one line (the first open line) — byte-identical to pre-Phase-3 behavior. On, it returns the first open line plus the first open line for each distinct `[context:: ...]` value found among the file's open tasks.

- **`reconciler.ts`'s `applyCompletionRules`**: before mutating anything, it reconstructs the pre-completion actionable set by taking the current content with the just-completed line temporarily forced back open (`forceLineOpen()`), and diffs that against the post-completion actionable set (matched by task **body text**, not line index, since `moveTaskToCompletedSection`/recurring-task insertion shift indices). The modal only opens if (a) the just-completed task was itself actionable before completion, and (b) completion promoted a task that wasn't already actionable. If more than one task is newly promoted at once (e.g. completing a task that anchored two context groups), only the first is shown — no modal queue.
- **`reconciler.ts`'s `applyUncompletionRules`**: simplified to a single flow — reopens the task, then checks whether the reopened line is now in `findActionableTaskLines(workingLines, enableMultipleNextActions)`; if so, shows the modal. With the setting off this is exactly equivalent to the old "is it the first open task" check.
- **`tasks-summary.ts`**: `findActionableRows()` (formerly `findFirstIncompleteRow()`, singular) now returns `SummaryRow[]` — one row per actionable line — via `collectActionableRowsForFolder()`/`collectActionableRowsForInbox()`. With the setting off, each file still contributes at most one row.
- **`task-processor.ts`**: no longer threads a `previousFirstIncompleteLine` through `applyCompletionRules` — `findFirstIncompleteTaskStateLine()` was removed from `task-utils.ts` as dead code once the reconciler started reconstructing the previous actionable set from `content` itself instead of from `TaskStateStore`'s line+status-only snapshots (which can't carry per-task context, so they were never sufficient for this diff in the first place).

### Recurring Tasks

On completion of a task with `[repeat:: X]` or `[repeats:: X]`, a new open copy is inserted above the completed task with a computed due date:

- `day` → tomorrow
- `2 days` → +2 days
- `week` → +7 days
- `2 weeks` → +14 days
- `month` → +1 month (date clamped to last day of month)
- `3 months` → +3 months (date clamped to last day of month)
- `year` → +1 year (date clamped)
- `2 years` → +2 years (date clamped)
- `Monday` / `Mon` → next matching weekday
- `1st` / `5th` → next occurrence of that day-of-month (clamped to the last day when needed)

Accepted aliases are normalized automatically:

- Day: `day`, `days`, `daily`
- Week: `week`, `weeks`, `weekly`
- Month: `month`, `months`, `monthly`
- Year: `year`, `years`, `yearly`
- Weekdays: full or short names like `monday` / `mon`
- Month days: ordinal forms `1st` through `31st`

Weekday and ordinal repeats resolve to the **next future occurrence**. So `Monday` completed on a Monday becomes next Monday, and `5th` completed on the 5th becomes next month's 5th.

### First-Incomplete Assignment & DueDateModal

When a task newly becomes actionable after completion or uncompletion (see **Multiple Next Actions** above), a `DueDateModal` is shown offering:

- A preview of the task text
- A project priority dropdown (values 1–3, default 3)
- Suggested dates from today through +30 days with Today/Tomorrow/weekday labels — clicking one immediately applies it
- A text input for custom YYYY-MM-DD or natural-language terms (today, tomorrow, weekday names); Enter submits. If the task already has a due date, it is prefilled there.
- A Repeat text field with no default value for rules like `daily`, `2 weeks`, `Monday`, or `5th`
- Input autocomplete sourced from the shared `buildDateSuggestions()` list
- A Skip option to dismiss without adding a due date

Modal submit writes `[due:: YYYY-MM-DD]` to the task line, adds `[repeat:: X]` when provided, and writes `priority: N` to the file frontmatter.
That submit also refreshes any open Tasks Summary tab (via `TasksSummaryController.refreshSoon()`).

**Modal is skipped when**: the actionable task set was unchanged by this completion/uncompletion, or the newly actionable task is recurring.

## Date Dashboard

### Activation

If the active note name (without `.md`) matches `YYYY-MM-DD`, the dashboard uses that date. Otherwise it defaults to today's local date.

### Placement

Registered as a custom right-sidebar `ItemView`. Creation prefers `split: true` (half-height side-leaf). Final placement is controlled by Obsidian's layout state.

### Sections

**Due** — open tasks with `[due:: YYYY-MM-DD]` where due date ≤ active date, scanned from the configured Projects / Completed / Waiting / Someday-Maybe folders plus the configured Inbox File. Rendered as a single table sorted by: file priority ascending (missing = 3), then due date, then file path.

**Current Page** — all open tasks written directly on the active date note itself. Rendered as a heading and an unordered list so date-note tasks still appear even when the note is outside configured task folders.

**Inbox** — all incomplete tasks from the configured Inbox File (regardless of date). Rendered as a heading, a link to the file, and an unordered list (no table, no priority column). Shows "No tasks." when empty.

**Completed** — tasks with `[completion-date:: YYYY-MM-DD]` equal to the active date, scanned from the configured Projects / Completed / Waiting / Someday-Maybe folders plus the configured Inbox File. Sorted by: file priority ascending, then file path.

### Display Formatting

- Due and Completed tables have columns: **Folder** | **Filename** | **Task** | **Priority** | **Recurrence** | **Context** | (Due only) **Due** in `MM-DD` format
- Rows are grouped by parent folder and filename with `rowspan`, preserving priority-first row ordering
- Folder display uses the immediate parent directory segment; Filename strips `.md`
- **Dashboard Filename Hide Keywords**: each comma-separated keyword is removed case-insensitively from both folder and filename display. No automatic date/number stripping is applied.
- Task text strips all inline fields and hashtag tags and is rendered as **bold** for priority 1, *italic* for priority 2, and default styling for priority 3 using the file's frontmatter priority
- Styling relies on native Obsidian markdown/theme rendering — no plugin-specific dashboard CSS

### Context Filter

When **Known Contexts** is non-empty, `DateDashboardController.appendContextFilter()` renders a `<select>` above the sections (All + one option per known context). The selection is held in `DateDashboardController.selectedContext` — a controller-instance field, not a plugin setting — because there's a single shared controller instance for the plugin's lifetime (see `main.ts`'s `this.dateDashboard`), so this is simpler than threading state through the `ItemView`. Changing it calls `refreshSoon()` and `filterByContext()` narrows all four sections' rows (Due, Current Page, Inbox, Completed) to rows whose `contexts: string[]` includes the selected value. Current Page and Inbox render as plain lists, so their context is shown inline via `formatTaskListText()` (task text + `(@context, ...)`) rather than a table column.

## Tasks Summary

An on-demand main-panel `ItemView` (`src/summary/tasks-summary-view.ts`), same placement pattern as Weekly Review — deliberately not a generated markdown note (it used to be one; see below) and not a persistent sidebar leaf. Unlike the date dashboard's Due section, it is **not** date-scoped: it shows every actionable open task regardless of due date, which is the whole reason it was split out as its own view instead of folded into the dashboard.

- `TasksSummaryController.openView()` reuses an existing leaf of `TasksSummaryController.VIEW_TYPE` if one is already open, refreshing it in place; otherwise opens a new full tab via `workspace.getLeaf(true)`.
- `src/summary/tasks-summary.ts` is the pure(ish) read-only data layer — `collectTaskSummarySections()` scans Projects/Waiting/Someday-Maybe folders and the Inbox file and returns `TaskSummarySection[]` (Projects, Waiting, Someday-Maybe, Inbox), each holding `TaskSummaryRow[]` sorted by file priority ascending, then due date, then file path. This is the same row-collection logic the old note-writer used, ported as-is — see Selection Rules below.
- `TasksSummaryController.renderContent()` renders one HTML `<table>` per section via `buildGroupedTaskTable()` (shared with the date dashboard), with columns Folder | Filename | Task | Priority | Recurrence | Context | Due (`MM-DD`). Folder/filename display reuses the dashboard's hide-keyword cleanup; task text is **bold** for priority 1, *italic* for priority 2, default for priority 3.
- **Context filter**: when Known Contexts is non-empty, `appendContextFilter()` renders the same `<select>`-based filter as the date dashboard, backed by a controller-instance `selectedContext` field (session-only, not persisted) and a `filterByContext()` helper — copied pattern, not shared code, since the two controllers don't share a base class.
- **Auto-refresh**: `onload()` registers debounced vault `modify`/`rename`/`delete` listeners, identical in structure to the Weekly Review's — `modify` is filtered through `isRelevantFile()` (Projects/Waiting/Someday-Maybe folders or the Inbox File), `rename`/`delete` trigger unconditionally. `main.ts` also calls `tasksSummary.refreshSoon()` directly from `TaskProcessor`'s `onFileStatusChanged`/`onTaskPropertiesChanged` callbacks (status routing and DueDateModal submits), so those two triggers don't have to wait out the debounce window on their own vault-event path.

### Selection Rules

- Includes the **first incomplete task** per file (or, with Enable Multiple Next Actions on, one row per actionable task per file — see Multiple Next Actions above)
- Files without an incomplete task are omitted
- The Context filter (see above) narrows displayed rows client-side at render time; it is not a persisted setting

### History

This used to be a **Tasks Summary** command that wrote a generated markdown note (configured via a since-removed "Tasks Summary File" setting), regenerated silently after status changes and DueDateModal submits. It was converted to a live view because the note only ever refreshed on those two triggers — a completed task that didn't change file status left the note stale until the next manual run — and because a live view gets a session-only context filter for free, matching the date dashboard, instead of a separately-persisted filter setting. If you find references to `writeTasksSummary`, `resolveSummaryFile`, `overwriteSummaryFile`, `tasksSummaryFile`, or `openSummaryAfterGeneration` anywhere, they're stale — those were fully removed.

## Editor Autocomplete

`DueDateEditorSuggest` triggers on `due::` and `CreatedDateEditorSuggest` triggers on `created::`. Both extend a shared `DateFieldEditorSuggest` base and source suggestions from `buildDateSuggestions()`.

- `due::` — suggests today through +30 days, labeled Today/Tomorrow/weekday names; matches on ISO date string or natural-language label
- `created::` — suggests today only
- Selected suggestion inserts ` YYYY-MM-DD` (single space prefix), normalizing fields as `due:: YYYY-MM-DD`

`ContextEditorSuggest` (`src/editor/context-suggest.ts`) triggers on `context::`/`contexts::` and is a separate, independent `EditorSuggest` implementation (not built on `DateFieldEditorSuggest`, since its suggestion source is a string list rather than dates). It sources suggestions from `settings.knownContexts` (via `parseContextList()`), filters case-insensitively as you type, and inserts ` @context` on selection. It only re-triggers right after `::`, so it does not offer suggestions for a second, comma-separated context typed after the first — that's an accepted v1 limitation, not a bug.

## Key Conventions

### Pure vs. Side-Effecting Code

`task-utils.ts`, `task-line-metadata.ts`, `repeat-rules.ts`, `status-routing.ts`, `date-utils.ts`, and `date-suggestions.ts` are intentionally pure (no Obsidian API calls, no I/O). Keep them that way. All I/O and Obsidian API usage belongs in `task-processor.ts`, `reconciler.ts`, `task-routing.ts`, or the dashboard layer.

### Obsidian API Usage

- File reads: always `await app.vault.read(file)` — never `cachedRead` for task processing (stale data causes reconciliation bugs)
- File writes: `await app.vault.modify(file, newContent)`
- Frontmatter updates: `await app.fileManager.processFrontMatter(file, fn)` for the `status` field
- File moves: `await app.fileManager.renameFile(file, newPath)` — not `vault.rename`, which does not preserve links
- Status/priority frontmatter reads (`status-routing.ts`'s `readStatusValue`, `file-priority.ts`'s `readFilePriority`) deliberately parse the raw content string via `frontmatter-utils.ts`'s `readFrontmatterField` rather than `app.metadataCache.getFileCache(file)?.frontmatter`. Both are called from `TaskProcessor.handleFileModify()` immediately after `vault.read()` on a `modify` event, before there's any guarantee the metadataCache has reparsed the just-written file — using the cache there would risk reading stale values. Reserve `metadataCache` for read-only call sites that already hold a `TFile` and aren't racing a just-completed write.

### TypeScript Conventions

- Strict mode (`strict: true`); no `any` without explicit justification
- `async`/`await` for all async operations — no `.then()` chains
- Constants: `SCREAMING_SNAKE_CASE` for module-level constants and regex patterns
- Dependency injection: services receive `app` and callbacks rather than importing globals
- Thrown errors are caught at command-handler boundaries and surfaced via `new Notice()`

### Keeping README.md Up to Date

**After every change that affects user-visible behavior, update `README.md` immediately.** This includes:

- New or removed commands
- New, changed, or removed settings
- Changes to task reconciliation behavior (completion, uncompletion, deletion, recurring)
- Changes to the Due Date Modal (fields, skip conditions, defaults)
- Changes to inline field names or formats
- Changes to editor autocomplete triggers or behavior
- Changes to dashboard sections, columns, sorting, or display rules
- Changes to file routing logic or destination folder behavior

Also update the **Code Organization table** and **Dependency Graph** in `README.md` when modules are added, removed, or renamed.

Do not defer README updates to a follow-up task — keep them in the same commit as the code change.

### When Changing Routing Logic

- Verify both command-driven and event-driven routing still work
- Verify relative-path preservation across all four configured roots
- Verify empty-folder cleanup safety boundaries

### When Changing Reconciliation Logic

- Ensure metadata stamping and first-incomplete-task behavior remain idempotent
- Verify recurring insertion index and that the completed task line is not mutated as the clone source

### When Changing Dashboard Logic

- Preserve date-note activation behavior and the fallback-to-today default
- Preserve `due <=` semantics (overdue tasks must still appear)
- Preserve configured-root scan restriction (do not scan the whole vault)
- Preserve open-task-only gate for Due rows

## Regression Checklist

Run after meaningful logic changes:

1. `npm run build` succeeds
2. Event-driven reconciliation updates first-incomplete selection/status correctly for complete, uncomplete, and delete cases; when the last task is completed, `completion-date` and `completion-time` are stamped in both the task line and the file frontmatter
3. Task completion triggers the DueDateModal for the newly exposed first incomplete task
4. Modal shows task text preview; clicking a suggested date immediately applies it; manual date input (YYYY-MM-DD or natural-language) works via Add Due Date / Enter
5. Submitted due date written as `[due:: YYYY-MM-DD]`; priority written as `priority: N` in file frontmatter (default 3)
6. Modal Skip dismisses without modifying the task
7. Recurring completion inserts new open task above completed task with correct due date for legacy, alias, and numeric repeat forms
8. Status change routes file to correct destination folder
9. Move preserves sub-path; files do not flatten to destination root
10. Merge conflict prompt appears when destination file exists
11. Empty source directories cleaned up after move/merge
12. Date dashboard renders Due/Completed for active date-named notes; defaults to today on non-date notes
13. Due and Completed tables show Priority column; missing file priority treated as 3
14. Due table sorted by file priority then due date; shows MM-DD Due column
15. Dashboard task text strips inline fields and tags; filename/folder display applies hide-keywords
16. Typing `due::` shows suggestions from today, matches ISO and weekday labels, inserts ` YYYY-MM-DD`
17. Typing `created::` shows today suggestion and inserts ` YYYY-MM-DD`
18. `Reset Tasks` reopens all tasks, removes due/completion/created inline fields, then re-runs file reconciliation and routing
19. `Open Tasks Summary` opens a full main-panel tab (not a sidebar leaf or generated note), reusing an already-open tab instead of duplicating it, and renders live task tables for Projects/Waiting/Someday-Maybe/Inbox with no separate generation step
20. `Add New Project` creates a new file at the chosen folder path, writes status/priority frontmatter, and converts each task textarea line into an open task
21. `Open Random Someday-Maybe Project` (command and ribbon icon) opens a file from the configured Someday-Maybe Projects Folder; shows a Notice instead of opening a file when the folder is unset or empty
22. Renaming or deleting a tracked file from Obsidian's file explorer (not via a plugin-driven move) keeps subsequent reconciliation correct — completing/uncompleting a task in the renamed file does not spuriously re-trigger recurring-task insertion from stale state
23. If a Due Date Modal's target task line is edited (or the file is otherwise modified) while the modal is still open, submitting either still updates the correct line or shows a Notice explaining the due date wasn't saved — it never silently no-ops
24. Routing a file onto an existing destination merges by content rather than duplicating: retrying an already-merged move does not re-append a second `---`-divided copy
25. `Quick Capture Task` (command and ribbon icon) opens from any file, inserts the entered text as an open task **at the top** of the Inbox File — right after the frontmatter block if one exists, otherwise as the literal first line (creating the file if missing) — without requiring the Inbox File to be open; a trailing `due:tomorrow`/`due:YYYY-MM-DD` token is converted to `[due:: YYYY-MM-DD]` and stripped from the task text; a trailing `@context` token (in any order relative to `due:`) is converted to `[context:: @context]` and stripped; an unrecognized trailing `due:` token is left in the task text; shows a Notice instead of opening the modal when the Inbox File setting is empty
26. `[context:: @home]`/`[contexts:: @a, @b]` on a task line is parsed into a Context column (Due/Completed tables, Tasks Summary) and inline in Current Page/Inbox list items; missing contexts render as an empty cell, not an error
27. Dashboard Context filter dropdown only appears when Known Contexts is non-empty; selecting a context narrows all four dashboard sections to matching rows; selecting "All" restores the full list; the selection persists across dashboard refreshes within the session but is not saved to settings
28. Typing `context::` or `contexts::` shows suggestions from Known Contexts, filtered as you type, and inserts ` @context`
29. With Enable Multiple Next Actions **off**: completion/uncompletion modal triggering and Tasks Summary rows are byte-identical to pre-Phase-3 behavior (exactly one actionable task per file)
30. With Enable Multiple Next Actions **on**: a project with open tasks in two different contexts surfaces one row per context in Tasks Summary; completing the file's only task in one context pops the Due Date Modal for the next task in that same context (not an unrelated task in a different context that was already actionable); completing a task that isn't currently actionable does not pop the modal
31. Moving a project's status to `waiting` stamps `waiting-since` with today's date; moving it away from `waiting` removes that field; `Stamp Waiting-Since For Existing Waiting Projects` stamps only files missing the field and reports the count, and is safe to re-run
32. `Open Weekly Review` opens a full main-panel tab (not a sidebar leaf), reusing an already-open tab instead of duplicating it; Waiting rows sort most-days-waiting-first with never-stamped files first; Someday-Maybe rows sort most-days-since-review-first with never-reviewed files first; a Waiting row is flagged "Newly stale" only when its threshold-crossing date falls within the current week
33. Clicking "Mark Reviewed" on a Someday-Maybe row stamps `reviewed` with today's date and the table re-sorts/re-renders in place without re-running the command; `Open Random Someday-Maybe Project` also stamps `reviewed` on the file it opens
34. `Open Weekly Review`'s Active Projects section lists every file in the configured Projects Folder unconditionally (no threshold/filter), sorted least-recently-reviewed first with never-reviewed files first; it has no "Needs Review" column, unlike Someday-Maybe; clicking "Mark Reviewed" stamps `reviewed` and the row moves toward the bottom of the list on the next render
35. Deleting a task line (the open instance of a recurring task, its completed historical entry, or any other task line) never spawns a phantom duplicate of an unrelated task, even when the deletion shifts other completed/recurring lines to new indices — completing/uncompleting a task still works normally via a plain checkbox toggle (no line-count change)
36. The Tasks Summary tab's Context filter dropdown only appears when Known Contexts is non-empty; selecting a context narrows every section (Projects/Waiting/Someday-Maybe/Inbox) to rows whose task carries that `[context:: ...]` value; selecting "All" restores the full list; the selection persists across refreshes within the session but is not saved to settings
37. With a Tasks Summary tab open: completing/uncompleting a task in a tracked file, changing a project's status, and submitting the Due Date Modal all refresh the open tab without needing to close/reopen it or re-run the command; with no Tasks Summary tab open, none of those trigger any visible action or error
38. With a Weekly Review tab open: editing a file in the Projects/Waiting/Someday-Maybe folders elsewhere (including a status-change move) refreshes the open tab in place; with no Weekly Review tab open, the same edits trigger no visible action or error
39. No settings UI, `data.json`, or code path references `tasksSummaryFile`, `openSummaryAfterGeneration`, or a persisted Tasks Summary context filter — all three were removed when Tasks Summary became a live view
