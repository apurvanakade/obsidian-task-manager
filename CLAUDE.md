# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An Obsidian plugin (Task Manager) that automates task lifecycle management: state transitions, completion metadata stamping, recurring task creation, file routing by status (including a one-way `archived` exit for abandoned Someday-Maybe ideas), editor autocomplete for date fields, a right-sidebar date dashboard, a live Inbox tab, a live Projects Summary tab (each of the last two with a priority filter and collapsible sections), and a generated Obsidian Bases "Tasks Summary" file for reviewing Projects/Waiting/Someday-Maybe/Scheduled. The Inbox tab supports bundling selected inbox captures into a new or existing project — the one write-capable action Bases can't do.

## Commands

```bash
npm run dev      # watch mode — rebuilds main.js on file changes via esbuild
npm run build    # type-check (tsc --noEmit --skipLibCheck) + production bundle → main.js
npm test         # runs tests/repeat-rules.test.ts via tsx (node:assert/strict, no framework)
```

There is no lint command in this repo. `npm test` is the only test suite — plain table-driven tests over the pure repeat-rule parser and date math in `src/tasks/repeat-rules.ts` (see Recurring Tasks below); nothing else in the codebase has test coverage. After any build, reload the plugin in Obsidian to verify behavior — the `verify` skill or manual reload is the only way to confirm runtime correctness here.

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
    task-line-metadata.ts        ← Canonical task-line parser (parseTaskLineStructured) + display-text helpers; task-utils.ts and reconciler.ts build on this instead of their own regexes; repeat-field extraction delegates to repeat-rules.ts
    frontmatter-utils.ts         ← Pure single-field frontmatter parser over a content string (shared by status-routing.ts and file-priority.ts; deliberately NOT metadataCache-based, see Obsidian API Usage below)
    derived-frontmatter.ts       ← Pure computeDerivedFields()/derivedFieldsMatchContent()/applyDerivedFields(): mirrors next-due/next-action/open-tasks from task lines into frontmatter so Bases/Dataview/search can see them — see Derived Frontmatter Fields below
    repeat-rules.ts              ← Pure Todoist-level recurring-rule parser (intervals, weekday/month-day sets, nth-weekday, yearly dates, every/every!/until modifiers), alias normalizer, and next-occurrence calculator — see Recurring Tasks below
    task-utils.ts                ← Pure parsing/diffing utilities (no side effects); task-line parsing delegates to task-line-metadata.ts
    next-actions.ts              ← Pure findActionableTaskLines(): the file's first open task line, if any
    task-state-store.ts          ← In-memory snapshot cache (tasks + status per file)
    due-date-modal.ts            ← Modal for collecting due date + file priority for the first incomplete task; submit is keyed by the captured task-line index, not string equality
  summary/
    inbox-data.ts                ← Pure(ish) data layer: collects every open-task row from the configured Inbox File for the Inbox tab (no writes)
    inbox-view.ts                ← On-demand main-panel ItemView controller/renderer for the Inbox tab (priority filter + collapsible section + search box + selection checkboxes/inbox-to-project actions + auto-refresh)
    inbox-actions.ts             ← removeInboxLines()/appendTasksToProject(): the inbox-to-project write path used by inbox-view.ts
    summary-file-io.ts           ← Shared pure isInFolder/isExcludedSummaryFile, used by projects-summary-data.ts and random-project.ts
  routing/
    status-routing.ts            ← Pure status extraction, validation, routable-status constants (six: todo/completed/waiting/someday-maybe/scheduled/archived)
    task-routing.ts              ← File movement: destination resolution, folder creation, merge handling
  projects/
    add-project-modal.ts         ← Modal and helpers for creating a new project note; also accepts optional initialTasks to prefill the tasks textarea (used by the Inbox tab's inbox-to-project flow)
    random-project.ts            ← Lists Someday-Maybe project files and picks one at random
  tables/
    grouped-task-table.ts        ← Pure grouped task-table model shared by dashboard and summary
  dashboard/
    date-dashboard.ts            ← Right-sidebar ItemView controller + renderer
    dashboard-task-data.ts       ← Task parsing/filtering/sorting for dashboard display
  editor/
    due-date-suggest.ts          ← EditorSuggest for due:: and created:: inline fields
  date/
    date-utils.ts                ← Pure shared date formatting and ISO date helpers
    date-suggestions.ts          ← Canonical date suggestion list (ISO dates + human labels)
  settings/
    settings-utils.ts            ← TaskManagerSettings type, DEFAULT_SETTINGS, normalizeSettings()
    settings-ui.ts               ← PluginSettingTab renderer
    settings-field-definitions.ts← Declarative metadata for settings controls
    folder-picker.ts             ← FuzzySuggestModal wrappers for vault folder/file pickers
  bases/
    base-file-content.ts         ← Pure buildTaskBaseFileContent(): the .base YAML string (five table views over the configured folders, plus properties: displayName overrides) — see Bases Integration below
    create-tasks-summary.ts      ← I/O for the "Create Tasks Summary" command: Bases-core-plugin detection (undocumented `App.internalPlugins`), vault write (overwrites an existing file without confirmation)
  commands/
    register-task-commands.ts    ← Registers "Reset Tasks", "Open Inbox", "Add New Project", "Open Random Someday-Maybe Project", "Quick Capture Task", "Open Projects Summary", "Stamp Waiting-Since For Existing Waiting Projects", "Stamp Derived Fields For All Projects", "Create Tasks Summary"
  review/
    projects-summary-view.ts     ← On-demand main-panel ItemView controller/renderer for the Projects Summary tab (priority filter + collapsible sections, Someday-Maybe collapsed by default); auto-refreshes (debounced) on relevant vault modify/rename/delete events while a tab is open
    projects-summary-data.ts     ← Collects Active Projects/Waiting/Someday-Maybe/Scheduled rows; stamps the `reviewed` field, promotes Scheduled items early, and sets a project's status directly (Someday-Maybe's Promote to Active/Archive row actions)
  ui/
    search-filter.ts             ← Shared search-box UI, used by date-dashboard.ts, projects-summary-view.ts, and inbox-view.ts
    priority-filter.ts           ← Shared priority-filter dropdown UI + row filter, used by date-dashboard.ts, projects-summary-view.ts, and inbox-view.ts
    collapsible-section.ts       ← Shared <details>/<summary> collapsible-section UI, used by projects-summary-view.ts and inbox-view.ts
```

### Key Data Flow

1. **vault `modify` event** → `TaskProcessor.handleFileModify()` processes only markdown files inside the configured task roots or the configured Inbox File, reads file fresh (non-cached) via `vault.read`, diffs against state-store snapshot, calls `reconciler` to apply transition rules, calls `task-routing` if status changed → writes back → state-store updated/rekeyed
2. **Pending-path guards** in `TaskStateStore` prevent re-triggering the modify handler on self-writes
3. **Line-count guard**: `findNewlyCompletedTask()`/`findNewlyUncompletedTask()` (`task-utils.ts`) compare snapshots purely by line **index**, which is only trustworthy when the document's total line count hasn't changed since the last snapshot (`TaskStateStore.getLineCount()`, updated in lockstep with task state via `TaskProcessor.snapshotTaskState()`). Deleting or inserting a line shifts every subsequent line's index, which can make an unrelated, already-completed line look like it just transitioned — e.g. a completed recurring task's historical entry (which keeps its `[repeat:: ...]` field forever) can appear "newly completed" after a line above it is deleted, spawning another clone, which looks like a deleted task "coming back." When the line count has changed, `handleFileModify()` skips the completion/uncompletion special-case paths entirely and falls back to generic `reconcileFile()`.
4. **vault `rename`/`delete` events** → `main.ts` also calls `TaskProcessor.handleFileRename()`/`handleFileDelete()`, which rekey/delete the corresponding `TaskStateStore` entries. This exists specifically so external renames/deletes (file explorer, sync, other plugins) don't leave a stale snapshot under the old path — internal moves driven by routing already call `stateStore.rekey()` directly, but external ones previously had no path to keep the store in sync.
5. **Commands** call `TaskProcessor.resetCurrentFileTasks()` directly
6. **Status changes** and **DueDateModal submits** call `InboxController.refreshSoon()` (a debounced no-op if no Inbox tab is open) after routing/due-date-priority updates — relevant when the modified file is the Inbox File itself; harmless as a no-op refresh otherwise
7. **Dashboard** is refreshed on `file-open`, `layout-change`, vault `rename`/`delete` events, and after settings changes
8. **Inbox and Projects Summary tabs**, while open, independently auto-refresh (debounced) on their own vault `modify`/`rename`/`delete` listeners registered in `onload()` — see their respective sections below
9. **Scheduled-date promotion** happens two ways: once at plugin load, `main.ts` calls `TaskProcessor.checkScheduledPromotions()` (after `primeState()`) to sweep the whole Scheduled folder for anything already due; and on every `handleFileModify()` call, `maybePromoteScheduledFile()` runs first and short-circuits the rest of that modify pass if it promotes the file — see Status Routing above
10. **Derived-frontmatter stamping** — `TaskProcessor.stampDerivedFrontmatter()` (private) runs at the tail of `routeAfterStatusChange()` (both the no-status-change and post-routing paths), inside `maybePromoteScheduledFile()`'s success path, and in `handleFileCreate()` — see Derived Frontmatter Fields below for why it always ends by re-reading the file and calling `snapshotTaskState()` regardless of whether it wrote anything

### Commands

- **Reset Tasks** — in the active file, marks all tasks open (`[ ]`), strips `[due:: ...]`, `[completion-date:: ...]`, `[completion-time:: ...]`, and `[created:: ...]` from task lines, then re-runs the normal task reconciliation and routing flow for that file
- **Open Inbox** — opens (or reveals, if already open) an `InboxController`-registered `ItemView` in a full main-panel tab via `workspace.getLeaf(true)`, not a sidebar leaf or generated note — see Inbox below
- **Add New Project** — opens a modal asking for Name, Folder, Priority, Status (`todo`, `waiting`, `someday-maybe`, or `scheduled`), a Scheduled Date field (shown only when Status is `scheduled`; required, `YYYY-MM-DD`; written as `[due:: YYYY-MM-DD]` on the first starter task rather than to frontmatter — see Status Routing below — which is why Status `scheduled` also requires at least one starter task), and optional starter tasks; the Folder field shows matching vault folders as you type; the command creates the project file, writes status/priority to frontmatter, creates missing parent folders, and opens the new file
- **Open Random Someday-Maybe Project** — lists markdown files under the configured Someday-Maybe Projects Folder (excluding the Inbox file, in case it's misconfigured into that folder), picks one uniformly at random via `getSomedayMaybeProjectFiles()`/`pickRandomFile()` in `src/projects/random-project.ts`, and opens it in a new leaf. Also bound to a `shuffle` ribbon icon (`main.ts` `addRibbonIcon`) calling the same handler. Shows a `Notice` instead of opening a file when the folder setting is empty or no candidate files exist.
- **Quick Capture Task** — opens `QuickCaptureModal` (`src/tasks/quick-capture-modal.ts`), a single-input modal. Enter or the Capture button submits. `parseQuickCaptureShorthand()` peels a recognized trailing `due:<value>` token off the raw input — resolved via the shared `resolveDateInput()` (`src/date/date-suggestions.ts`); an unresolvable `due:` token, or any other trailing token, is left in the task text unchanged rather than dropped. `main.ts`'s `runQuickCapture()` inserts `- [ ] <text> [due:: ...]` (the due-date field included only when present) as the **first task line** in the configured Inbox File — via the module-level `prependTaskLine()` helper, which inserts right after the frontmatter block if the file has one, otherwise at byte 0 — creating the file (and its parent folders via `ensureParentFoldersExist()`) if it doesn't exist yet. Uses `vault.read()` + `vault.modify()` rather than `vault.append()`, since Obsidian's `Vault.append()` can only add to the end of a file. Also bound to a `list-plus` ribbon icon. Shows a `Notice` instead of opening the modal when the Inbox File setting is empty. Because the Inbox File is already tracked by `TaskProcessor.shouldTrackFile()` and the dashboard's `isRelevantFile()`, the write flows through the normal `vault.on("modify")` pipeline with no additional state-tracking or refresh code needed.
- **Open Projects Summary** — opens (or reveals, if already open) a `ProjectsSummaryController`-registered `ItemView` in a full main-panel tab via `workspace.getLeaf(true)`, not a sidebar leaf or generated note — see Projects Summary below.
- **Stamp Waiting-Since For Existing Waiting Projects** — one-time backfill via `TaskProcessor.backfillWaitingSince()`: scans `settings.waitingProjectsFolder` and stamps `waiting-since` (today's date) on any file missing it. Idempotent — already-stamped files are skipped.
- **Stamp Derived Fields For All Projects** — resync via `TaskProcessor.backfillDerivedFrontmatter()`: iterates every file `shouldTrackFile()` accepts (minus the Inbox File), calling the same `stampDerivedFrontmatter()` the modify pipeline uses, and reports how many were actually stamped vs. already current. Unlike the waiting-since backfill, this is framed as a general resync rather than a one-time migration, since derived fields can drift any time task lines are edited outside the plugin's own write paths (e.g. bulk find/replace, sync from another device before this file was reconciled) — see Derived Frontmatter Fields below.
- **Create Tasks Summary** — `src/bases/create-tasks-summary.ts`'s `runCreateTasksSummary()`: checks whether the Bases core plugin is enabled (Notice-only warning, doesn't block), then writes `buildTaskBaseFileContent(settings)`'s output via `ensureParentFoldersExist()` + `vault.create()`/`vault.modify()`, overwriting an existing file at `settings.basesFilePath` without confirmation — re-running the command is meant to be a cheap, frequent way to pick up folder-setting changes. See Bases Integration below.

### Settings Persistence

Settings live in `data.json` (loaded/saved via `plugin.loadData()` / `plugin.saveData()`). After a settings change, call `plugin.updateSetting()` — it persists, re-primes task state, and refreshes the dashboard. Settings are normalized on load/save via `normalizeSettings()`.

Configurable paths: Projects Folder, Completed Projects Folder, Waiting Projects Folder, Someday-Maybe Projects Folder, Scheduled Projects Folder, Archived Projects Folder, Inbox File (file picker, not folder).

Other settings: Completed Status Field (default `status`), Dashboard Filename Hide Keywords (comma-separated keywords stripped from display names in the dashboard), Someday-Maybe Review Cadence Days and Waiting Staleness Threshold Days (both stored as strings, default `"30"`/`"7"`, normalized via `normalizePositiveIntegerString()` and parsed at the Projects Summary's point of use — see Projects Summary below), Bases File Path (default `Tasks/Tasks Summary.base`, normalized via `normalizeFolder()` like the folder settings even though it's a file path, since the same trim/no-leading-or-trailing-slash treatment applies — see Bases Integration below).

There is deliberately no persisted priority-filter or collapsed-section setting for any of the three views (date dashboard, Inbox, Projects Summary) — selection/collapse state is session-only UI state held on each controller instance (`selectedMaxPriority`, `collapsedSections`/`collapsed`), not written to `data.json`. Same rationale as the removed Context filter used to follow.

### Status Routing

Six routable statuses: `todo`, `completed`, `waiting`, `someday-maybe`, `scheduled`, `archived`. Each maps to a configured folder. **Relative sub-path from the matched source root is preserved at the destination** — compute it from the matched configured root, not a hardcoded single root, or files will collapse to the destination root. Missing destination parent folders are created automatically. On path collision, a `MergeConflictModal` prompts merge or skip. Empty folders left behind after a move are deleted (with safety checks). The configured Inbox File is not routable and must never be moved by status changes; it's also exempt from completion-stamping — reconciliation forces its status to stay `todo` even when it has zero open tasks (see Completion below). When plugin-driven frontmatter metadata edits touch a project file, they also add `priority: 3` if the priority field is missing. `TaskProcessor.updateWaitingSinceStamp()` additionally stamps `waiting-since` (today's date, via `getCurrentDateString()`) on transition into `waiting`, and deletes that field on transition out — called from `routeAfterStatusChange()` for any status change, not just routable ones, since `waiting` itself is what's being detected.

`task-routing.ts` exposes two folder-root lists over the six settings, deliberately kept distinct: `getTaskFolderRoots()` (all six, including Scheduled and Archived — used by `TaskProcessor.shouldTrackFile()`, `buildDestinationPath()`'s relative-path matching, and `deleteEmptyParentFolders()`'s protected-roots set, since Scheduled/Archived files still need to be tracked, routed, and protected like any other status folder) versus `getSurfacedTaskFolderRoots()` (only the original four — Projects/Completed/Waiting/Someday-Maybe — used only by `main.ts`'s date-dashboard wiring, so Due/Completed scanning never surfaces a scheduled or archived project). Don't collapse these into one list; the whole point of `scheduled` and `archived` is that the file is tracked and routable but not surfaced. `projects-summary-data.ts` enumerates specific folder settings directly rather than using either helper, so Scheduled/Archived files are automatically invisible there too without any extra exclusion logic. `inbox-data.ts` doesn't scan folders at all — it only reads the configured Inbox File — so this exclusion doesn't apply to it either.

**Archived projects** are a one-way exit from the Someday-Maybe review rotation: `status: archived`, routed to the configured **Archived Projects Folder**. Unlike `scheduled`, there's no promotion logic or special due-date handling — a file just sits there, excluded from the dashboard, the generated Tasks Summary Base, and every section of the Projects Summary, until someone manually changes its status again (there's no command to create a project directly as `archived`; reach it via the Projects Summary's Someday-Maybe **Archive** row action — see Projects Summary below — or by hand-editing frontmatter). This exists because Someday-Maybe review previously had no "no, never mind" outcome short of marking a project `completed` (which means "done," not "abandoned," and would mix genuinely finished projects with abandoned ideas in the Completed folder).

**Scheduled projects** are a GTD-style tickler: `status: scheduled` with its promotion date read off the `[due:: YYYY-MM-DD]` on the file's **first open task** — `task-utils.ts`'s `getFirstTaskDueDate()` (finds the first incomplete task line via `findFirstIncompleteTaskLine()`, then reads its due field) — deliberately **not** a separate frontmatter field, so there's one source of truth for "when" instead of two that could drift. This means Status `scheduled` has no meaning without at least one task carrying a due date; `AddProjectModal`'s conditional Scheduled Date field enforces this by requiring at least one starter task and writing the date onto the first one (see Commands above), but a scheduled file whose first task has no due date is inert — it just sits in the Scheduled folder like a Someday-Maybe item until one is added or **Promote Now** is clicked. `TaskProcessor.maybePromoteScheduledFile()` checks whether today has entered the promotion window — the due date minus `SCHEDULED_PROMOTION_LEAD_DAYS` (a module constant in `task-processor.ts`, currently 7) via `addDaysToDateString()` (`date-utils.ts`), then string-compared against `getCurrentDateString()` since both are `YYYY-MM-DD` — and if so sets status to `todo` and routes the file; the due date itself is left untouched since it's now just an ordinary task due date. Promotion fires a full week before the actual date by design (the user explicitly asked for lead time so a scheduled item can't silently slip by unseen). It's checked from two places: `checkScheduledPromotions()` (a one-time full-folder scan invoked from `main.ts`'s `onload()`, after `primeState()`, so items don't sit un-promoted just because Obsidian was closed when the lead window opened) and inline at the top of `handleFileModify()` for every modify event on a tracked file (so editing a scheduled file, or the file being touched by anything else, also triggers promotion once the window opens). When `maybePromoteScheduledFile()` promotes a file it returns `true` and `handleFileModify()` snapshots the pass's task state (so a task-line edit that happened to land in the same event as the promotion doesn't leave a stale state-store entry — see `snapshotTaskState()` call site) before returning early — the promotion's own frontmatter write goes through `runWithPendingPaths()` like any other plugin-driven write, and doesn't re-enter this handler. `projects-summary-data.ts`'s `promoteScheduledFileNow()` offers a manual early-promotion path (the Projects Summary's "Promote Now" button) — it's a plain `processFrontMatter()` write with no routing call of its own, since the vault `modify` event it triggers flows through `TaskProcessor.handleFileModify()`'s ordinary status-change routing exactly like a manual frontmatter edit would.

## Projects Summary

An on-demand main-panel `ItemView` (`src/review/projects-summary-view.ts`), deliberately not a persistent sidebar leaf (unlike the date dashboard) — it needs interactive per-row actions and full table width that an always-visible sidebar panel doesn't fit well, and it's meant to be a deliberate, occasional activity rather than something glanced at constantly.

- `ProjectsSummaryController.openView()` reuses an existing leaf of `ProjectsSummaryController.VIEW_TYPE` if one is already open (via `workspace.getLeavesOfType()` + `revealLeaf()`), refreshing it in place; otherwise opens a new full tab via `workspace.getLeaf(true)`.
- While a leaf of this view type is open, `ProjectsSummaryController` auto-refreshes it: `onload()` registers debounced (50ms, via `queueRefresh()`) vault `modify`/`rename`/`delete` listeners — `modify` is filtered through `isRelevantFile()` (file under Projects/Waiting/Someday-Maybe/Scheduled folders), while `rename`/`delete` trigger unconditionally since a file could be moving into or out of a relevant folder. `refreshOpenViews()` iterates `getLeavesOfType()` and no-ops when the tab isn't open, so there's no cost to the listeners when nobody's looking. This mirrors the date dashboard's `queueRefresh()`/debounce pattern.
- `src/review/projects-summary-data.ts` is the pure(ish) data layer (write functions `stampReviewedDate()`, `promoteScheduledFileNow()`, and `setProjectStatus()`, otherwise read-only):
  - `collectReviewRows()` (private) is the generic reviewed-staleness scanner shared by Active Projects and Someday-Maybe: scans a given folder, reads `REVIEWED_FRONTMATTER_FIELD` (`"reviewed"`, owned by this module) via `readFrontmatterField()`, computes `daysSinceReview`, and sorts most-stale-first.
  - `collectActiveProjectReviewRows()` calls `collectReviewRows()` against `settings.projectsFolder` with no filtering — every active project is always included, sorted least-recently-reviewed first. No cadence/threshold concept, unlike Someday-Maybe.
  - `collectSomedayReviewRows()` calls the same `collectReviewRows()` against `settings.somedayMaybeProjectsFolder`, then maps in a `needsReview` flag (never reviewed, or past `settings.somedayMaybeReviewCadenceDays`) — the one place `ReviewRow` is extended into `SomedayReviewRow`.
  - `collectWaitingReviewRows()` is separate (different field, different flag semantics): scans `settings.waitingProjectsFolder`, reads `WAITING_SINCE_FRONTMATTER_FIELD` (imported from `task-processor.ts`, the field's owner/writer), and computes `daysWaiting` and `isNewlyStale` (via `crossesThresholdWithinCurrentWeek()`, `date-utils.ts`, parameterized by `settings.waitingStalenessThresholdDays`).
  - `collectScheduledReviewRows()` scans `settings.scheduledProjectsFolder`, reads each file's promotion date via `getFirstTaskDueDate()` (imported from `task-utils.ts` — the first open task's `[due:: ...]`, not a frontmatter field), and computes `daysUntil` (negated `daysBetween()` — positive/future rather than the other rows' positive/past framing). It sorts soonest-first with a custom inline comparator rather than the shared `compareByStaleness()`, because rows whose first task has no due date sort **last** here (nothing to act on) instead of first (most stale) — the opposite convention from Waiting/Someday-Maybe.
  - The three staleness-style lists (Active Projects, Waiting, Someday-Maybe) sort most-stale-first; rows with no timestamp at all sort first of all, ahead of any numeric staleness — implemented by treating `null` as `Number.POSITIVE_INFINITY` in the shared `compareByStaleness()` comparator. Ties (equal staleness) are broken by `priority` ascending (1, the highest priority, sorts first) — `compareByStaleness<T extends { priority: FilePriority }>` only falls back to this when the staleness values are exactly equal. Scheduled uses its own comparator as described above and does not have this tiebreak.
- Rows are file-shaped (one row per file, with staleness/timestamp columns), not task-line-shaped, so they don't fit `grouped-task-table.ts`'s `GroupedTaskTableRow` model (which is keyed on task/priority/dueDate/recurrence per checkbox line) — the view renders flat, un-grouped `<table>`s instead. Each row type (`ReviewRow`, `WaitingReviewRow`, `ScheduledReviewRow`) still carries a `priority: FilePriority` field, read via `readFilePriority()` alongside the row's other frontmatter reads — all four tables (Active Projects, Waiting, Someday-Maybe, Scheduled) show a numeric **Priority** column, and the Project cell's file link uses the same shared `applyPriorityStyle()` from `grouped-task-table.ts` as the date dashboard (bold for 1, italic for 2), via `createFileLinkCell(file, priority)`.
- `appendActiveProjectsSection()` and the Someday-Maybe table's **Mark Reviewed** buttons both call `stampReviewedDate()` directly then invoke the view's `onNeedsRefresh` callback (passed into `renderContent()`), which re-renders in place — no command re-run needed. Active Projects and Someday-Maybe share the same `reviewed` field and write path; only the Someday-Maybe table additionally shows a cadence-derived "Needs Review" column, since Active Projects intentionally has no threshold — the full list is always shown, ordered by staleness. The Scheduled table's **Promote Now** button follows the same call-then-refresh pattern but calls `promoteScheduledFileNow()` instead (see Status Routing above for why that function doesn't route the file itself).
- The Someday-Maybe table has two additional row actions beyond Mark Reviewed, both following the same call-`setProjectStatus()`-then-`onNeedsRefresh()` pattern: **Promote to Active** (`setProjectStatus(..., "todo")`) moves the project back into active work; **Archive** (`setProjectStatus(..., "archived")`) is the one-way exit from the review rotation — see Status Routing above. `setProjectStatus()` is a plain `processFrontMatter()` write with no routing call of its own, mirroring `promoteScheduledFileNow()`; the resulting vault `modify` event flows through `TaskProcessor.handleFileModify()`'s ordinary status-change routing.
- `renderContent()` renders Active Projects first, then Waiting, then Someday-Maybe, then Scheduled — matching the typical GTD review order of current commitments before the waiting-for list, the someday-maybe backlog, and finally the tickler file. Every section is wrapped in a `<details>`/`<summary>` via the shared `src/ui/collapsible-section.ts` (`appendCollapsible()` helper method), with the total row count shown in the summary line; `ProjectsSummaryController.collapsedSections` (a `Set<string>` of collapsed section titles) defaults to `new Set(["Someday-Maybe"])` — every other section starts open — and survives auto-refresh re-renders since it's read on each render rather than reset.
- **Priority filter**: `src/ui/priority-filter.ts`'s `appendPriorityFilter()`/`filterByMaxPriority()`, identical pattern to the date dashboard and Inbox — a controller-instance `selectedMaxPriority` field (session-only), applied to all four row sets via `filterRows()` before `filterBySearch()`.
- **Search**: same shared `src/ui/search-filter.ts` module as the date dashboard and Inbox (see Search under Date Dashboard above). `renderContent()` fetches all four row sets once per real refresh into `this.cached` (alongside `settings` and the `onNeedsRefresh` callback it was passed) and builds a dedicated `resultsContainer`; typing in the search box calls `renderResults()`, which re-filters `this.cached` via `filterBySearch()` (matches a row's `file.basename`/`file.path`) and rebuilds only `resultsContainer` — the search `<input>` itself is untouched, so it keeps focus while typing. `emptyMessage()` swaps each section's "No ... projects." text for "No matches." when the query is non-empty, so an empty result reads as a filtered-out state rather than a genuinely empty folder.
- `runOpenRandomSomedayMaybeProject()` in `main.ts` also calls `stampReviewedDate()` before opening the file, so the existing random-picker doubles as a lightweight review mechanism at no extra UI cost — this was a deliberate design choice, not an accidental side effect. This only applies to Someday-Maybe; there's no equivalent random-pick command for Active Projects.
- `getEndOfWeek()` (`date-utils.ts`, previously unused anywhere in the codebase) now has two consumers: framing the view's "Week ending ..." header, and inside `crossesThresholdWithinCurrentWeek()`'s current-week bounds check.

## Bases Integration

The plugin generates an [Obsidian Bases](https://help.obsidian.md/bases) file (`.base`) — native, user-editable table views over frontmatter — via the **Create Tasks Summary** command, at the configured **Bases File Path** (default `Tasks/Tasks Summary.base`). This replaced an earlier live "Tasks Summary" `ItemView` tab (see the Inbox section's History note below) as the read-only review surface for Projects/Waiting/Someday-Maybe/Scheduled — Bases can't do everything that tab did (see Inbox below for the one piece that was kept, the inbox-to-project bundling flow), but it's a strict upgrade for pure review: native sort/filter UI, no plugin code to maintain per-column, and it stays open as a normal file tab rather than a special view type.

Re-running the command **overwrites the file without confirmation** — it's meant to be a cheap, frequently-re-run way to pick up folder-setting changes or a `basesFilePath` rename, not a one-time scaffold. Any manual view customizations made from Bases' own UI are discarded on re-run; this is a deliberate tradeoff for a simpler, prompt-free command (an earlier version of this command *did* prompt before overwriting — that confirmation was removed). There is no `registerBasesView`/plugin-API integration — Bases API typings landed in Obsidian versions well past this plugin's `manifest.json` `minAppVersion` (1.5.0) and `obsidian@^1.7.2` devDependency typings, and a `.base` file needs none of that; it's inert YAML the Bases core plugin reads.

- `src/bases/base-file-content.ts`'s `buildTaskBaseFileContent(settings)` is a pure string builder (no Obsidian imports) producing five `type: table` views: **Active projects** (`status == "todo"` in the Projects folder, sorted by priority ascending), **Next actions** (any Projects-folder file with a non-null `next-due`, sorted by `next-due` ascending), **Waiting** (sorted by `waiting-since` ascending), **Someday-Maybe review** (sorted by `reviewed` ascending), **Scheduled** (sorted by `next-due` ascending). Every view's `order:` starts with `file.folder` then `file.name` — both bare `file.*` properties, no `formulas:` indirection needed — matching the Folder-first column convention the date dashboard/Projects Summary use. Folder paths (for the `file.inFolder()` filter) are always interpolated from `settings` — never hardcoded — so the generated file tracks whatever the user has configured. A view's folder filter is simply omitted if that folder setting is blank, rather than producing broken YAML.
- **Every hyphenated derived field is routed through a `formulas:` entry, never referenced as raw `note["hyphenated-field"]` bracket notation in `order:`/`sort:`.** This was a two-round empirical correction, not a guess kept from day one — worth understanding both rounds since the failure mode was non-obvious:
  1. **Round 1**: bracket notation seemed to work — Bases' own UI round-tripped `note["next-action"]`-style `order:`/`sort:` entries unchanged, and even added new `sort:` entries on bracket-notation properties when the user clicked a column header. But with no `properties:` override, the column *header* showed the raw expression text instead of a friendly label — reported as "I only see the text `note["next-action"]` instead of what the next action is."
  2. **Round 2**: adding `properties:` displayName overrides (keyed by the bracket-notation string, e.g. `note["next-due"]:`) fixed nothing — after regenerating, *every* bracket-notation column still showed the raw expression as its header, **and every cell in that column was empty**, even though the underlying frontmatter had real values and the column had rendered fine as a filter/sort target. Conclusion: `note["hyphenated-field"]` bracket notation is accepted as an *expression* (filters, sort-key references) but is not a valid direct *column data binding* — something about `order:`'s column-rendering path doesn't resolve it into a cell value, independent of whether a `properties:` override exists.
  - **The fix**: wrap each hyphenated property in a named `formulas:` entry — `formulas: { nextDue: 'note["next-due"]', nextAction: 'note["next-action"]', openTasks: 'note["open-tasks"]', waitingSince: 'note["waiting-since"]' }` (camelCase names, so referencing them as `formula.nextDue` never itself needs bracket notation) — then reference `formula.nextDue` etc. everywhere: `order:`, `sort:`, `filters:` (e.g. `formula.nextDue != null`), and `properties:` displayNames. This matches Obsidian's own documented example verbatim (a `formulas: formatted_price: '...'` entry referenced as `formula.formatted_price` in both `order:` and a `properties:` displayName) — the one part of this schema with a first-party worked example instead of inference, which is exactly why it was the fallback once bracket notation was empirically ruled out for column data.
- `properties:` (top-level, sibling to `views:`/`formulas:`) maps each `formula.*` reference to a `displayName` override — `DISPLAY_NAMES` in `base-file-content.ts` covers all four (`formula.nextDue` → "Next due", `formula.nextAction` → "Next action", `formula.openTasks` → "Open tasks", `formula.waitingSince` → "Waiting since"). Bare dotted properties (`priority`, `status`, `reviewed`, `file.name`) already render with a clean header and don't need an entry.
- `src/bases/create-tasks-summary.ts`'s `runCreateTasksSummary()` is the I/O shell: Notice-only (non-blocking) warning via `isBasesCorePluginEnabled()` — which reaches past the public `App` typings into `(app as unknown as {...}).internalPlugins?.plugins?.bases?.enabled`, since Bases' enabled/disabled state isn't part of the typed API surface — then the write via `ensureParentFoldersExist()` (reused from `task-routing.ts`) + `vault.create()`/`vault.modify()` (`modify()` when `settings.basesFilePath` already exists, unconditionally — no confirm modal).
- Because the generated views reference `next-due`/`next-action`/`open-tasks`, this feature is functionally downstream of [Derived Frontmatter Fields](#derived-frontmatter-fields) below — a vault that's never had `stampDerivedFrontmatter()` run against it (e.g. right after upgrading) should run **Stamp Derived Fields For All Projects** before **Create Tasks Summary** for the generated views to show non-empty data immediately, though this isn't enforced — the fields will simply populate on the next natural edit to each file either way.

## Task Reconciliation Rules

### Inline Field Format

Tasks use standard markdown checkboxes. Inline fields use Dataview-style double-colon syntax and appear on the same line as the task:

- `[due:: YYYY-MM-DD]` — due date
- `[completion-date:: YYYY-MM-DD]` — stamped on completion
- `[completion-time:: HH:MM:SS]` — stamped on completion
- `[repeat:: X]` / `[repeats:: X]` — recurring rule; a Todoist-level grammar covering intervals, weekday/month-day sets, nth-weekday-of-month, and yearly dates, with `every`/`every!`/`until` modifiers for anchoring and end bounds — see **Recurring Tasks** below, including which module owns the field's extraction regex
- `[created:: YYYY-MM-DD]` — creation date (editor suggest only; not used by reconciler)

Project priority is stored in file frontmatter as `priority: N`, where `1` is highest and missing/invalid values default to `3`.

**Note**: an earlier version of this plugin supported `[context:: @home]`/`[contexts:: @home, @calls]` inline fields (a Context filter in the dashboard/Tasks Summary, `context::` editor autocomplete, and a per-context "Multiple Next Actions" mode). The whole feature was removed as unused — `getContexts()`/`parseContextList()`, `ContextEditorSuggest`, the Known Contexts setting, and `enableMultipleNextActions` are all gone. Vault files written before the removal may still contain `[context:: ...]` fields; they still render as clean task text via the generic `INLINE_FIELD_REGEX` stripping (same as any other unrecognized inline field) — no special-casing needed, and no migration required.

### Derived Frontmatter Fields

`src/tasks/derived-frontmatter.ts` mirrors three fields, derived from a file's task lines, into that same file's frontmatter — `next-due`, `next-action`, `open-tasks` (constants `NEXT_DUE_FIELD`/`NEXT_ACTION_FIELD`/`OPEN_TASKS_FIELD`) — so file-level tools that can only see frontmatter (Bases, Dataview, vault search) can surface task-level data that otherwise only lives inside `[due:: ...]` inline fields. The task line stays the single source of truth; these fields are a read-only, auto-managed mirror, never hand-edited. Unprefixed and hyphenated to match every other plugin-owned field (`waiting-since`, `completion-date`, ...) rather than a `tm-`-style namespace.

`computeDerivedFields(content)` reuses `getFirstTaskDueDate()` (`task-utils.ts`) for `next-due` and `findFirstIncompleteTaskLine()` + `parseTaskLineStructured()` + `cleanTaskText()` for `next-action`; `open-tasks` is a plain count of open `parseTaskLineStructured()` matches. `next-due`/`next-action` are deleted from frontmatter (not written empty) when there's no open task; `open-tasks` is always written, including `0`, since a completed project legitimately has none. `derivedFieldsMatchContent(content, fields)` reads back the currently-stamped values via `readFrontmatterField()` (trim-normalized on both sides) and is the idempotency gate that keeps stamping from writing — and therefore from re-triggering a `modify` event — when nothing changed.

`TaskProcessor.stampDerivedFrontmatter()` (private) is the write path: fresh `vault.read()` → compute → conditionally `processFrontMatter()` inside `runWithPendingPaths()` → **always** re-read and call `snapshotTaskState()`, whether or not it wrote. That unconditional re-snapshot is load-bearing: a stamp changes the file's line count, and every call site sits at the tail of a modify pass that the state-store's line-count guard depends on for the *next* edit (see Key Data Flow #3) — skipping the refresh on a no-op stamp would silently break the completion/uncompletion special-case paths, and therefore the DueDateModal, on the file's next checkbox toggle. It's called from three sites: the tail of `routeAfterStatusChange()` (both when status didn't change, and after routing when it did — so it runs on every modify pass, not just status changes), the success path of `maybePromoteScheduledFile()` (whose own outer `snapshotTaskState()` call in `handleFileModify()` was removed in favor of this — see the comment there), and `handleFileCreate()`. It no-ops for the configured Inbox File, matching the completion-stamping exemption. `TaskProcessor.backfillDerivedFrontmatter()` drives the same method over every tracked file for the "Stamp Derived Fields For All Projects" command.

### Task Notes (note blocks)

A plain indented line (no checkbox) written directly under a task is that task's **note block** — free-text context/description, not itself a task. `task-utils.ts`'s `findNoteBlockEnd(lines, taskLineIndex)` computes the exclusive end index of the run of lines immediately below a task line that are indented deeper than the task line's own leading whitespace and are neither checkbox lines (`parseTaskLineStructured(line) !== null`) nor headings; blank lines are permitted *within* the block (multi-paragraph notes) but trailing blank lines are excluded from the boundary. It returns `taskLineIndex + 1` (no block) for the common case, so behavior for tasks with no trailing indented lines is unchanged.

Note blocks are invisible everywhere else in the codebase by construction — `parseTaskLineStructured` never matches a non-checkbox line, so note lines are already excluded from `extractTaskState`, `findFirstIncompleteTaskLine`, `findActionableTaskLines`, and every table-row builder (dashboard, Inbox, Projects Summary) without any special-casing. The only place a note block is handled specially is `moveTaskToCompletedSection` (`task-utils.ts`), which now moves the task line **and** its note block together as one spliced unit into `## Completed Tasks`, instead of orphaning the note behind when only the task line moved. Recurring-task cloning in `reconciler.ts`'s `applyCompletionRules` reads the source line's note block via `findNoteBlockEnd`, splices a copy of it (unmodified — no due-date/completion-field rewriting) directly beneath the new open clone, then deletes the original copy from beneath the (about-to-be-completed) source line before `moveTaskToCompletedSection` runs — so the note effectively *moves* to the new occurrence rather than being duplicated on both; a multi-line recurring task (e.g. a checklist or reference info kept in its note) carries that content forward into every future occurrence instead of accumulating dead copies in `## Completed Tasks` history.

An indented **checkbox** line under a task (`  - [ ]`) is not a note block member — `findNoteBlockEnd` stops at it — and is parsed and treated exactly like any other independent top-level task line. There is no separate sub-task/child-task concept in this plugin; sequential steps toward one outcome are expected to be modeled as consecutive top-level task lines in the same file instead (the first open one is automatically the actionable task).

The first incomplete task in a file is always treated as the current actionable task — `findActionableTaskLines()` in `src/tasks/next-actions.ts` returns exactly this single line (or an empty array if the file has no open tasks).

### Completion (`[ ]` → `[x]`)

- Append `[completion-date:: YYYY-MM-DD]` and `[completion-time:: HH:MM:SS]` to the completed task line
- Move the completed task line — along with its note block, if any (see **Task Notes** above) — into the `## Completed Tasks` section of the same file; if that section doesn't exist, it is appended to the end of the file
- The first remaining open task becomes the current actionable task implicitly; if none remain, status becomes `completed` — except for the configured Inbox File, which is exempt from this and stays `todo` (see Status Routing above; `reconciler.ts`'s `isInboxFile()` guard in `applyCompletionRules`/`reconcileFile` forces `todo` instead of `completed` for it)
- When status becomes `completed`, also stamp `completion-date` and `completion-time` into the **file frontmatter** (in addition to the task-line inline fields); this stamping is likewise skipped for the Inbox File since its status never becomes `completed`

### Uncompletion (`[x]` → `[ ]`)

- If the reopened task is actionable per `findActionableTaskLines()` (i.e. it's now the file's first open task), it becomes the current actionable task implicitly
- Reconciliation also strips stale `[completion-date:: ...]` and `[completion-time:: ...]` from open tasks

`reconciler.ts` retains its actionable-set diffing mechanism even though it always operates on a single-element set now (a leftover of a since-removed "Multiple Next Actions" feature that let a project surface more than one actionable task at once, one per `[context:: ...]` group — see the Inline Field Format note above for why that was removed): before mutating anything, `applyCompletionRules` reconstructs the pre-completion actionable set by taking the current content with the just-completed line temporarily forced back open (`forceLineOpen()`), and diffs that against the post-completion actionable set (matched by task **body text**, not line index, since `moveTaskToCompletedSection`/recurring-task insertion shift indices). The modal only opens if (a) the just-completed task was itself actionable before completion, and (b) completion promoted a task that wasn't already actionable. `applyUncompletionRules` is simpler — reopens the task, then checks whether the reopened line is now in `findActionableTaskLines(workingLines)`; if so, shows the modal.

### Recurring Tasks

`src/tasks/repeat-rules.ts` is a pure module (no Obsidian API, only imports `date-utils.ts`) that parses `[repeat:: X]`/`[repeats:: X]` into a `RepeatRule = { spec: RepeatSpec; anchor: "due" | "completion"; until: string | null; raw: string }` and computes the next occurrence via `getNextRepeatDate(rule, { previousDueDate, now? })`. It's also the sole owner of the field's extraction regex (`getRepeatFieldValue()`, `REPEAT_FIELD_PRESENT_REGEX`) — `task-line-metadata.ts` imports from here rather than duplicating it, which matters because the old duplicated-regex version used to half-strip an `every!` prefix down to `!`.

**Grammar** (`RepeatSpec` kind, matched via an ordered token-matcher pipeline in `matchExpression()` — comma-separated input always means a set; matcher order resolves ambiguity, e.g. `1st wed` (nth-weekday) vs bare `1st` (month-day), or `27 jan` (yearly-date) vs a malformed counted-interval):

| `RepeatSpec.kind` | Example | Computed next date |
|---|---|---|
| `interval` | `daily`, `2 weeks`, `other month`, `quarterly`, `2 quarters` | anchor + N units (`other X` = 2×; quarter/quarters/quarterly resolve to 3 months via `REPEAT_KEYWORD_TO_UNIT`'s multiplier) |
| `workday-interval` | `weekday`/`workday`, `3 workdays` | Nth workday (Mon–Fri) strictly after the floor date |
| `weekday-set` | `Monday`, `mon, wed, fri` | next day in the set, scanned floor+1..floor+7 |
| `month-day-set` | `5th`, `2, 15, 27` | next day-of-month in the set, clamped per month, scanned up to 48 months |
| `last-day` / `last-workday` | `last day`, `last workday` | end of month (last-workday walks back to Friday if it lands on a weekend) |
| `nth-weekday` | `1st wed`, `last friday` | that weekday's Nth (or last) occurrence, monthly, scanned up to 24 months |
| `yearly-nth-weekday` | `3rd thu jul`, `3rd thursday of july` | same, restricted to one named month, scanned up to 8 years |
| `yearly-date` | `jan 27`, `27 jan`, `january 27th` | that calendar date each year, clamped (`feb 29` → `feb 28` in non-leap years), scanned up to 8 years |

**Anchoring** (`RepeatAnchorMode`): a plain rule, or an explicit `every`/`ev` prefix, anchors to the task's **previous `[due:: ...]` value** (`anchor: "due"`) — `reconciler.ts`'s `applyCompletionRules` reads this off `sourceTaskLine` via `readInlineFieldValue(sourceTaskLine, DUE_FIELD_REGEX)` (`DUE_FIELD_REGEX` exported from `task-utils.ts`) *before* the line is stripped for the clone. An `every!`/`ev!` prefix, or `after N <unit>` (which additionally requires the parsed spec to be `interval`/`workday-interval`, enforced by `requireIntervalOnly` in `parseRepeatExpression`), anchors to the completion date (`anchor: "completion"`) instead. `getNextRepeatDate()`'s algorithm: `anchor = (mode === "due") ? parseIsoDate(previousDueDate) ?? today : today`; `floor = max(anchor, today)`; the next occurrence is the first one strictly after `floor`. This guarantees a long-overdue recurring task never spawns an already-overdue clone, and a due-anchored task completed early still keeps its original cadence (floor becomes the future anchor itself). For month/year `interval` specs, catch-up is computed as `anchor + k*step` directly (`nextByMonthStep` iterates `k` from 1, not chaining through intermediate clamped dates), so a monthly task due Jan 31 caught up in April lands on Apr 30, not a drifted Apr 28.

**End bound**: an optional trailing `until YYYY-MM-DD` / `ending YYYY-MM-DD` (ISO only — parsed in `parseRepeatExpression`'s suffix pass, stored as `RepeatRule.until`) makes `getNextRepeatDate()` return `null` once the computed next date would exceed it (inclusive: `next === until` still recurs). Both the anchor prefix and the until suffix are stripped before the core expression is tokenized, so `every! 3 days until 2026-12-31` parses prefix → suffix → `3 days`.

**Failure handling in `applyCompletionRules`**: if `getRepeatFieldValue(sourceTaskLine)` is non-null but `parseRepeatRule()` returns null, a `Notice` names the unrecognized raw value and no clone is created (completion stamping/routing proceeds normally either way). If the rule parses but `getNextRepeatDate()` returns null (the `until` bound was reached), a different `Notice` reports the recurrence ended. `buildRepeatedTaskLine(completedLine, nextDueDate)` takes the already-computed date string rather than a `RepeatRule`, so the two null-outcomes stay distinguishable at the call site in `applyCompletionRules`.

Weekday, month-day, nth-weekday, and yearly-date specs always resolve to the **next future occurrence** relative to the anchor (never the anchor date itself, since the scan is strictly-after). So `Monday` completed on a Monday becomes next Monday, and `5th` completed on the 5th becomes next month's 5th.

`tests/repeat-rules.test.ts` (run via `npm test`, uses `tsx` + `node:assert/strict`, no framework) is the only test file in the repo — table-driven coverage of the parse grammar and the anchoring/clamping/bound date math described above.

### First-Incomplete Assignment & DueDateModal

When a task newly becomes actionable after completion or uncompletion, a `DueDateModal` is shown offering:

- A preview of the task text
- A project priority dropdown (values 1–3, default 3)
- Suggested dates from today through +30 days with Today/Tomorrow/weekday labels — clicking one immediately applies it
- A text input for custom YYYY-MM-DD or natural-language terms (today, tomorrow, weekday names); Enter submits. If the task already has a due date, it is prefilled there.
- A Repeat text field for rules like `daily`, `2 weeks`, `mon, fri`, `1st wed`, `last workday`, or `jan 27` (see Recurring Tasks above for the full grammar) — prefilled from `getRepeatFieldValue(taskLine)` when the task already carries a repeat value (the modal only opens when that value is absent or failed to parse, so this surfaces a broken value for repair); validated on submit by round-tripping through `parseRepeatRule()` against a standalone synthetic line (`- [ ] x [repeat:: ${repeat}]`), not `this.taskLine` itself — using `this.taskLine` would match its own pre-existing (broken) repeat field first and reject every entry
- Input autocomplete sourced from the shared `buildDateSuggestions()` list
- A Skip option to dismiss without adding a due date

Modal submit writes `[due:: YYYY-MM-DD]` to the task line, adds `[repeat:: X]` when provided, and writes `priority: N` to the file frontmatter.
That submit also refreshes any open Inbox tab (via `InboxController.refreshSoon()`) — a no-op unless the edited file is the Inbox File.

**Modal is skipped when**: the actionable task set was unchanged by this completion/uncompletion, or the newly actionable task is recurring.

## Date Dashboard

### Activation

If the active note name (without `.md`) matches `YYYY-MM-DD`, the dashboard uses that date. Otherwise it defaults to today's local date.

### Placement

Registered as a custom right-sidebar `ItemView`. Creation prefers `split: true` (half-height side-leaf). Final placement is controlled by Obsidian's layout state.

### Sections

**Due** — open tasks with `[due:: YYYY-MM-DD]` where due date ≤ active date, scanned from the configured Projects / Completed / Waiting / Someday-Maybe folders plus the configured Inbox File (via `getSurfacedTaskFolderRoots()` — deliberately excludes the Scheduled and Archived folders, see Status Routing above). Rendered as a single table sorted by: file priority ascending (missing = 3), then due date, then file path.

**Current Page** — all open tasks written directly on the active date note itself. Rendered as a heading and an unordered list so date-note tasks still appear even when the note is outside configured task folders.

**Inbox** — all incomplete tasks from the configured Inbox File (regardless of date). Rendered as a heading, a link to the file, and an unordered list (no table, no priority column). Shows "No tasks." when empty.

**Completed** — tasks with `[completion-date:: YYYY-MM-DD]` equal to the active date, scanned from the configured Projects / Completed / Waiting / Someday-Maybe folders plus the configured Inbox File. Sorted by: file priority ascending, then file path.

### Display Formatting

- Due and Completed tables have columns: **Folder** | **Project** | **Task** | **Priority** | **Recurrence** | (Due only) **Due** in `MM-DD` format
- Rows are grouped by parent folder and filename with `rowspan`, preserving priority-first row ordering
- Folder display uses the immediate parent directory segment; the Project column strips `.md` from the filename
- **Dashboard Filename Hide Keywords**: each comma-separated keyword is removed case-insensitively from both folder and filename display. No automatic date/number stripping is applied.
- Task text strips all inline fields and hashtag tags; it is **not** priority-decorated — priority is a project (file) property, not a task property
- The **Project** cell's link is rendered as **bold** for priority 1, *italic* for priority 2, and default styling for priority 3, using the file's frontmatter priority (via `applyPriorityStyle()` in `grouped-task-table.ts`) — this decoration is shared verbatim by the Projects Summary tab (see its section below), so a project's name reads the same way everywhere it's listed. The Inbox tab has no such decoration — every row is the same file, so there's no per-row Project link to style.
- Styling relies on native Obsidian markdown/theme rendering — no plugin-specific dashboard CSS

### Priority Filter

`src/ui/priority-filter.ts`'s `appendPriorityFilter()` renders a `<select>` above the sections (All priorities / Priority 1 only / Priority 1-2). The selection is held in `DateDashboardController.selectedMaxPriority` — a controller-instance field, not a plugin setting — because there's a single shared controller instance for the plugin's lifetime (see `main.ts`'s `this.dateDashboard`), so this is simpler than threading state through the `ItemView`. Changing it calls `renderResults()`; `filterRows()` composes `filterByMaxPriority()` (from `priority-filter.ts`) with `filterBySearch()` and applies the result to all four sections (Due, Current Page, Inbox, Completed).

### Search

`src/ui/search-filter.ts` provides the shared search box (rendered via `appendSearchBox()`), used identically by the date dashboard, Inbox, and Projects Summary. There is deliberately no keyboard shortcut wired to it — an earlier attempt to bind Ctrl+F/Cmd+F to focus the box (via a scoped `keydown` listener) didn't reliably fire, likely pre-empted by Obsidian's own hotkey handling before it reached the view's `contentEl`; the box is click-to-use only. `DateDashboardController` holds the query in a controller-instance `searchQuery` field and, on data-fetching `renderContent()` passes, caches the fetched rows on `this.cached` before building the `resultsContainer` DOM once via `renderResults()`. Typing in the search box (or changing the priority filter) calls `renderResults()` directly — it re-filters `this.cached` and rebuilds only `resultsContainer`, never touching the search `<input>` element itself, so keystroke-to-keystroke typing doesn't lose focus (a full `renderContent()` rebuild, which real vault events still trigger, does destroy and recreate the input — that's unavoidable and unrelated to typing). `filterBySearch()` matches `matchesSearch()` (case-insensitive substring) against a row's `task` text.

## Inbox

An on-demand main-panel `ItemView` (`src/summary/inbox-view.ts`), same placement pattern as Projects Summary — not a generated markdown note and not a persistent sidebar leaf. It shows every open task in the configured Inbox File and exists specifically for the inbox-to-project bundling flow below, which no other surface (including the generated Tasks Summary Base) can do — Bases only displays existing frontmatter, it can't write new files from raw task lines. Reviewing Projects/Waiting/Someday-Maybe/Scheduled now lives entirely in the generated Tasks Summary Bases file instead (see Bases Integration above) — see History below for what this view used to be.

- `InboxController.openView()` reuses an existing leaf of `InboxController.VIEW_TYPE` if one is already open, refreshing it in place; otherwise opens a new full tab via `workspace.getLeaf(true)`.
- `src/summary/inbox-data.ts` is the pure(ish) read-only data layer — `collectInboxRows()` reads every open task line in the configured Inbox File and returns `InboxRow[]`, unsorted (in file order — every capture needs to stay individually selectable, so there's no priority/due-date sort to apply). Every row carries a `rawLine: string` field — the exact, unmodified task line text — used by `inbox-actions.ts` to find-and-remove the original line after an inbox-to-project action.
- `InboxController.renderContent()` renders a single collapsible section via `appendInboxSection()` — see Inbox-to-Project Flow below.
- **Priority filter**: `src/ui/priority-filter.ts`'s `appendPriorityFilter()`/`filterByMaxPriority()`, identical pattern to the date dashboard and Projects Summary — a controller-instance `selectedMaxPriority` field (session-only). Every row shares the Inbox file's own frontmatter priority, so in practice this filters all-or-nothing rather than row-by-row; kept for UI consistency with the other two views.
- **Collapsible section**: the Inbox section is wrapped in a `<details>`/`<summary>` via the shared `src/ui/collapsible-section.ts`, with the total (unfiltered) row count shown in the summary line. `collapsed: boolean` defaults `false` (starts open) and survives auto-refresh re-renders.
- **Search**: same shared `src/ui/search-filter.ts` module and `resultsContainer`-only re-render pattern as the date dashboard (see Search under Date Dashboard above) — `lastRows` caches the last `collectInboxRows()` fetch, `searchQuery` holds the query, and `filterBySearch()` matches against a row's `task` and `file.path`.
- **Auto-refresh**: `onload()` registers debounced vault `modify`/`rename`/`delete` listeners, identical in structure to the Projects Summary's — `modify` is filtered through `isRelevantFile()` (the file must be the configured Inbox File), `rename`/`delete` trigger unconditionally. `main.ts` also calls `inbox.refreshSoon()` directly from `TaskProcessor`'s `onFileStatusChanged`/`onTaskPropertiesChanged` callbacks (status routing and DueDateModal submits), so those two triggers don't have to wait out the debounce window on their own vault-event path — this only actually re-renders anything when the affected file is the Inbox File itself, but it's a cheap no-op otherwise.

### Inbox-to-Project Flow

`appendInboxSection()` renders a dedicated per-task table (no Folder/Project columns — every row is the same file): a leading selection checkbox, then Task | Priority | Recurrence | Due. Checking a row adds its `rawLine` to `InboxController.selectedInboxLines: Set<string>` (session-only, cleared after any successful action) and re-renders (`renderResults()`) so all checkbox state and the two action buttons below stay in sync without a full data refetch. `pruneSelectedInboxLines()` runs after every fresh `collectInboxRows()` fetch (in `renderContent()`) and drops any selected line no longer present in the current data — e.g. a task that was completed or edited elsewhere between selection and action.

Two buttons render below the Inbox table, both disabled when the selection is empty:

- **Create project from selected** opens `AddProjectModal` with `initialTasks` set to the selected rows' raw lines (prefilling the Tasks textarea — checkbox prefix stripped, inline fields like `[due:: ...]` kept, via the modal's existing `parseTaskLines()`). On successful submit, it calls the injected `createProject` callback (see below), then `removeInboxLines()` for the selected originals, then `refreshSoon()`.
- **Move to existing project** opens a `ProjectFileSuggestModal` (a small `FuzzySuggestModal<TFile>` local to `inbox-view.ts`) listing markdown files under the Projects/Waiting/Someday-Maybe/Scheduled roots. Picking a file calls `appendTasksToProject()` (inserts the raw lines above `## Completed Tasks` if present, else at end of file) then `removeInboxLines()` then `refreshSoon()`.

`src/summary/inbox-actions.ts` holds the two write helpers: `removeInboxLines(app, settings, linesToRemove)` re-reads the Inbox file fresh (never from a cached snapshot) and strips exact-matching lines, so a line already edited or removed elsewhere is safely skipped (reported via `Notice`) rather than corrupting an unrelated line — the line-count change this produces makes the next `handleFileModify()` pass take the safe generic `reconcileFile()` path, per the existing line-count guard (see Key Data Flow above). `appendTasksToProject(app, file, linesToAppend)` inserts lines into the target file's open-task area.

`InboxController` doesn't create project files itself — it's constructed with an injected `createProject: (input: AddProjectInput) => Promise<TFile>` callback (dependency injection, same convention as the rest of the plugin). `main.ts` supplies `(input) => this.createProjectFile(input)`, a method extracted from the pre-existing `runAddNewProject()` command handler so both paths share the same file-creation logic — including the `taskProcessor.handleFileCreate()` call that primes the state-store snapshot for the new file, which the Inbox controller has no direct access to.

### History

This view used to be a **Tasks Summary** tab: a live `ItemView` rendering Projects/Waiting/Inbox sections (Someday-Maybe was already excluded, living in Projects Summary instead), each with its own priority filter and collapsible section. Before *that*, it was a command that wrote a generated markdown note (configured via a since-removed "Tasks Summary File" setting), regenerated silently after status changes and DueDateModal submits — converted to a live view because the note only ever refreshed on those two triggers, leaving it stale after a completed task that didn't change file status.

The Projects/Waiting review tables were removed and replaced by the generated Tasks Summary Bases file once Bases became available (see Bases Integration above) — Bases' native sort/filter UI made maintaining bespoke plugin code for that same job redundant. Only the Inbox section survived, since bundling captures into a project is a write action Bases can't perform; it was renamed from "Tasks Summary" to "Inbox" to free up the "Tasks Summary" name for the generated Base. If you find references to `writeTasksSummary`, `resolveSummaryFile`, `overwriteSummaryFile`, `tasksSummaryFile`, `openSummaryAfterGeneration`, `TasksSummaryController`, `collectTaskSummarySections`, or `src/summary/tasks-summary.ts`/`tasks-summary-view.ts` anywhere, they're stale — those were fully removed. A later revision also removed a session-only Context filter this section used to describe here — see the Inline Field Format note above.

## Editor Autocomplete

`DueDateEditorSuggest` triggers on `due::` and `CreatedDateEditorSuggest` triggers on `created::`. Both extend a shared `DateFieldEditorSuggest` base and source suggestions from `buildDateSuggestions()`.

- `due::` — suggests today through +30 days, labeled Today/Tomorrow/weekday names; matches on ISO date string or natural-language label
- `created::` — suggests today only
- Selected suggestion inserts ` YYYY-MM-DD` (single space prefix), normalizing fields as `due:: YYYY-MM-DD`

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
- Verify relative-path preservation across all configured roots (Projects/Completed/Waiting/Someday-Maybe/Scheduled/Archived)
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

1. `npm run build` succeeds; `npm test` passes
2. Event-driven reconciliation updates first-incomplete selection/status correctly for complete, uncomplete, and delete cases; when the last task is completed, `completion-date` and `completion-time` are stamped in both the task line and the file frontmatter
3. Task completion triggers the DueDateModal for the newly exposed first incomplete task
4. Modal shows task text preview; clicking a suggested date immediately applies it; manual date input (YYYY-MM-DD or natural-language) works via Add Due Date / Enter
5. Submitted due date written as `[due:: YYYY-MM-DD]`; priority written as `priority: N` in file frontmatter (default 3)
6. Modal Skip dismisses without modifying the task
7. Recurring completion inserts new open task above completed task with correct due date for legacy, alias, numeric, workday, set (weekday/month-day), last-day/last-workday, nth-weekday, and yearly-date repeat forms (`5th` in particular — previously broken); if the completed task had a note block, it moves onto the new open clone and is not left behind on the completed task in `## Completed Tasks`
7a. A due-anchored repeat (`every`/`ev`, or no prefix) computes the next date from the task's previous `[due:: ...]`, not the completion date — completing early keeps the original cadence, and completing an overdue task never produces an already-past due date on the clone; an `every!`/`ev!`/`after N ...` prefix anchors to the completion date instead; a long-overdue monthly/yearly interval catches up directly from the anchor without accumulating clamp drift
7b. A `[repeat:: ...]` field with an `until`/`ending YYYY-MM-DD` bound stops recurring (no clone, completion still stamps normally) once the computed next date exceeds it, with a Notice; an unparseable `[repeat:: ...]` value likewise produces no clone and a distinct Notice naming the bad value, and the Due Date Modal's Repeat field prefills that value the next time it opens for that task
8. Status change routes file to correct destination folder
9. Move preserves sub-path; files do not flatten to destination root
10. Merge conflict prompt appears when destination file exists
11. Empty source directories cleaned up after move/merge
12. Date dashboard renders Due/Completed for active date-named notes; defaults to today on non-date notes
13. Due and Completed tables show Priority column; missing file priority treated as 3
14. Due table sorted by file priority then due date; shows MM-DD Due column
15. Dashboard task text strips inline fields and tags (and is not priority-decorated); folder/project display applies hide-keywords; the Project cell's link is bold for priority 1, italic for priority 2, default for priority 3 — same behavior in the Projects Summary tab (the Inbox tab has no per-row Project link to decorate)
16. Typing `due::` shows suggestions from today, matches ISO and weekday labels, inserts ` YYYY-MM-DD`
17. Typing `created::` shows today suggestion and inserts ` YYYY-MM-DD`
18. `Reset Tasks` reopens all tasks, removes due/completion/created inline fields, then re-runs file reconciliation and routing
19. `Open Inbox` opens a full main-panel tab (not a sidebar leaf or generated note), reusing an already-open tab instead of duplicating it, and renders every open task in the configured Inbox File with no separate generation step
20. `Add New Project` creates a new file at the chosen folder path, writes status/priority frontmatter, and converts each task textarea line into an open task
21. `Open Random Someday-Maybe Project` (command and ribbon icon) opens a file from the configured Someday-Maybe Projects Folder; shows a Notice instead of opening a file when the folder is unset or empty
22. Renaming or deleting a tracked file from Obsidian's file explorer (not via a plugin-driven move) keeps subsequent reconciliation correct — completing/uncompleting a task in the renamed file does not spuriously re-trigger recurring-task insertion from stale state
23. If a Due Date Modal's target task line is edited (or the file is otherwise modified) while the modal is still open, submitting either still updates the correct line or shows a Notice explaining the due date wasn't saved — it never silently no-ops
24. Routing a file onto an existing destination merges by content rather than duplicating: retrying an already-merged move does not re-append a second `---`-divided copy
25. `Quick Capture Task` (command and ribbon icon) opens from any file, inserts the entered text as an open task **at the top** of the Inbox File — right after the frontmatter block if one exists, otherwise as the literal first line (creating the file if missing) — without requiring the Inbox File to be open; a trailing `due:tomorrow`/`due:YYYY-MM-DD` token is converted to `[due:: YYYY-MM-DD]` and stripped from the task text; an unrecognized trailing `due:` token is left in the task text; shows a Notice instead of opening the modal when the Inbox File setting is empty
26. No settings UI, `data.json`, or code path references the removed Context/Multiple-Next-Actions feature (`knownContexts`, `enableMultipleNextActions`, `getContexts`/`parseContextList`, `ContextEditorSuggest`, `src/editor/context-suggest.ts` — see the Inline Field Format note above for the full removal history); a pre-existing `[context:: ...]` inline field still renders as clean task text everywhere
27. Moving a project's status to `waiting` stamps `waiting-since` with today's date; moving it away from `waiting` removes that field; `Stamp Waiting-Since For Existing Waiting Projects` stamps only files missing the field and reports the count, and is safe to re-run
28. `Open Projects Summary` opens a full main-panel tab titled "Projects Summary" (not a sidebar leaf), reusing an already-open tab instead of duplicating it; Waiting rows sort most-days-waiting-first with never-stamped files first; Someday-Maybe rows sort most-days-since-review-first with never-reviewed files first; a Waiting row is flagged "Newly stale" only when its threshold-crossing date falls within the current week; all four tables (Active Projects, Waiting, Someday-Maybe, Scheduled) show a Priority column, and the Project cell's file link is bold for priority 1, italic for priority 2, matching the date dashboard decoration; the Someday-Maybe section is collapsed by default (see item 45)
29. Clicking "Mark Reviewed" on a Someday-Maybe row stamps `reviewed` with today's date and the table re-sorts/re-renders in place without re-running the command; `Open Random Someday-Maybe Project` also stamps `reviewed` on the file it opens
30. `Open Projects Summary`'s Active Projects section lists every file in the configured Projects Folder unconditionally (no threshold/filter), sorted least-recently-reviewed first with never-reviewed files first; it has no "Needs Review" column, unlike Someday-Maybe; clicking "Mark Reviewed" stamps `reviewed` and the row moves toward the bottom of the list on the next render
31. Deleting a task line (the open instance of a recurring task, its completed historical entry, or any other task line) never spawns a phantom duplicate of an unrelated task, even when the deletion shifts other completed/recurring lines to new indices — completing/uncompleting a task still works normally via a plain checkbox toggle (no line-count change)
32. The Inbox tab has no Context filter (removed) — see item 19 for what it shows and items 44-45 for the priority filter/collapsible section it does have
33. With an Inbox tab open: completing/uncompleting a task in the Inbox File, and submitting the Due Date Modal for an Inbox task, both refresh the open tab without needing to close/reopen it or re-run the command; with no Inbox tab open, none of those trigger any visible action or error
34. With a Projects Summary tab open: editing a file in the Projects/Waiting/Someday-Maybe/Scheduled folders elsewhere (including a status-change move) refreshes the open tab in place; with no Projects Summary tab open, the same edits trigger no visible action or error
35. No settings UI, `data.json`, or code path references `tasksSummaryFile`, `openSummaryAfterGeneration`, a persisted Tasks Summary context filter, or the old `TasksSummaryController`/`tasks-summary.ts`/`tasks-summary-view.ts` (see the Inbox section's History note for the full removal chain)
36. Checking off the last open task in the configured Inbox File (via the completion path) or editing it down to zero open tasks by any other means (via the generic `reconcileFile()` path) never stamps `status: completed` or `completion-date`/`completion-time` frontmatter on it — status stays `todo`; the same file with tasks under Projects/Waiting/Someday-Maybe still gets stamped `completed` normally
37. `Add New Project` with Status set to `scheduled` shows a required Scheduled Date field (hidden for the other three statuses) and requires at least one starter task; submitting writes `status: scheduled` to frontmatter (no `scheduled-date` field), writes `[due:: YYYY-MM-DD]` onto the first starter task only, and routes the file to the configured Scheduled Projects Folder; submitting with no starter tasks shows a Notice instead of creating the file
38. A file in the Scheduled or Archived folder whose first open task has a future due date (Scheduled) or which is simply archived never appears in the date dashboard's Due/Completed sections or the generated Tasks Summary Base's views, even on/around a Scheduled file's due date's neighbors; a Scheduled file does appear in the Projects Summary's Scheduled section, sorted soonest-first, with rows whose first task has no due date sorted last (not first); an Archived file appears in none of the review surfaces at all
39. A Scheduled file is auto-promoted to `todo` (and routed to the Projects Folder, due date left as-is on the task) once today is within `SCHEDULED_PROMOTION_LEAD_DAYS` (7) days of its first open task's due date — not on the date itself — either the next time Obsidian loads the plugin or the next time that file is modified in any way, whichever comes first; a file more than 7 days out, or whose first task has no due date at all, is left untouched; this happens without user action and without an error notice
40. Clicking "Promote Now" on a Projects Summary Scheduled row immediately flips that file's status to `todo` and routes it to the Projects Folder, ahead of its first task's due date, leaving that due date unchanged
41. Changing the due date on a Scheduled project's first task (or reordering which task is first) changes what the Projects Summary's Scheduled section and the promotion check treat as its date — there is no separate `scheduled-date` field anywhere to fall out of sync
42. In each of the date dashboard, Inbox, and Projects Summary: typing in the search box above the sections narrows displayed rows to matches (case-insensitive) without losing input focus or cursor position mid-typing; clearing the box restores the full list; typing into the search box alongside a priority-filter selection narrows by both simultaneously; searching in Projects Summary swaps a section's "No ... projects."/"No tasks." message for "No matches." only when the query is non-empty and nothing matched. There is no keyboard shortcut bound to the search box — it's click-to-use only (a Ctrl+F/Cmd+F attempt was tried and removed, see Search under Date Dashboard above)
43. Two projects tied on Days Since Review (Active Projects/Someday-Maybe) or Days Waiting (Waiting) sort by priority ascending as the tiebreak — the priority-1 project appears above the priority-3 project when their staleness values are identical (including both null/never-stamped); Scheduled's Days Until sort has no such tiebreak
44. Each of the date dashboard, Inbox, and Projects Summary shows a priority-filter dropdown (All priorities / Priority 1 only / Priority 1-2) above its sections; selecting a value narrows every section/table in that view to matching rows, composing with a concurrent search query; the selection is session-only per view (not saved to settings) and resets on plugin reload
45. In Inbox and Projects Summary, every section is wrapped in a collapsible `<details>`/`<summary>` showing the section's total row count in the heading (e.g. "Someday-Maybe (34)"); clicking the heading toggles it; Someday-Maybe starts collapsed in Projects Summary, the Inbox tab's single section starts open; toggling a section, then triggering an auto-refresh from an unrelated edit, leaves the toggle state unchanged
46. Setting a project's status frontmatter to `archived` (directly, or via the Someday-Maybe **Archive** button below) routes the file to the configured Archived Projects Folder, preserving its relative sub-path; the file never appears in the date dashboard, the generated Tasks Summary Base's views, or any Projects Summary section afterward, but completing/uncompleting/recurring-cloning its own tasks still works normally if you open and edit it directly
47. On a Projects Summary Someday-Maybe row: "Promote to Active" flips status to `todo` and routes the file to the Projects Folder (it then appears in Active Projects and, since Bases queries frontmatter live, the Tasks Summary Base's Active projects view with no command re-run needed); "Archive" flips status to `archived` and routes it to the Archived Projects Folder (it disappears from every review surface); both refresh the Someday-Maybe table in place without re-running the command, same pattern as "Mark Reviewed"
48. In the Inbox tab: each row has a selection checkbox; checking one or more enables "Create project from selected" and "Move to existing project" (both show a running count and are disabled at zero selections); "Create project from selected" opens the Add New Project modal prefilled with the selected tasks' text (checkbox prefix stripped, inline fields like `[due:: ...]` kept) and, on successful creation, removes the originals from the Inbox file and refreshes the tab; "Move to existing project" opens a fuzzy picker over markdown files under the Projects/Waiting/Someday-Maybe/Scheduled folders and, on pick, appends the selected tasks above `## Completed Tasks` in that file (or at the end if no such section) and removes the originals from the Inbox; if a selected task line was edited or removed elsewhere before either action completes, that one line is safely skipped (reported via a Notice) instead of corrupting an unrelated line, and the rest of the selection still proceeds
49. Editing a tracked project file's first open task's due date, text, or completion state updates `next-due`/`next-action`/`open-tasks` in its frontmatter within that same modify pass; re-triggering a modify event with nothing task-relevant changed writes nothing (watch mtime — idempotent); a file with zero open tasks has no `next-due`/`next-action` fields and `open-tasks: 0`; the Inbox File never receives any of the three fields, including via the backfill command below. Critically, **after** a derived-field stamp, a plain checkbox toggle on the same file still triggers the completion/uncompletion path and pops the DueDateModal when applicable — this is the regression a broken state-store re-snapshot after stamping would cause, and it must be checked explicitly, not just the frontmatter values themselves
50. "Stamp Derived Fields For All Projects" reports a count of stamped vs. already-current files, is safe to re-run (a second run reports 0 stamped), and doesn't trigger routing, the DueDateModal, or any other reconciliation side effect
51. "Create Tasks Summary" with the Bases core plugin disabled still creates/overwrites the configured `.base` file and shows an "enable Bases" Notice rather than failing or silently no-oping; with Bases enabled, opening the generated file renders five named views with no schema-error banner, using folder paths from the plugin's actual settings (not hardcoded paths); re-running the command when the file already exists overwrites it immediately with **no** confirm modal (any manual view customizations are discarded); the four `formula.*` columns (Next due, Next action, Open tasks, Waiting since) show both their friendly `displayName` **and** actual populated cell values — not the raw `note["..."]`/`formula...` expression as the header, and not blank cells (this is the regression that bracket-notation-as-column-reference caused; verify actual data appears, not just a clean header); every view's first column is Folder, showing the file's parent path
52. Changing Bases File Path in settings and re-running "Create Tasks Summary" creates/targets the file at the new path (not the old default), overwriting without confirmation if a file already exists there too; the default path is `Tasks/Tasks Summary.base`
