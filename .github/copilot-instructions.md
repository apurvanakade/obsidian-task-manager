# Copilot Instructions

This is an **Obsidian plugin** called Task Manager that automates task lifecycle management: state transitions, completion metadata stamping, recurring task creation, file routing by status, editor autocomplete for date fields, and a right-sidebar date dashboard.

## Build Commands

```bash
npm run dev      # watch mode — rebuilds main.js on file changes
npm run build    # type-check (tsc --noEmit --skipLibCheck) + production bundle → main.js
```

No test or lint commands exist. After any build, reload the plugin in Obsidian to verify behavior.

The build outputs a single `main.js` (CommonJS, esbuild-bundled). The Obsidian runtime provides `obsidian`, `@codemirror/*`, `@lezer/*`, and Node builtins — these are external and must never be bundled.

## Architecture

### Module Map

```
main.ts                          ← Plugin entry point; wires all services
src/
  tasks/
    task-processor.ts            ← Primary orchestrator; vault.modify handler + command runner
    reconciler.ts                ← Task transition logic (completion, uncompletion, deletion, recurring)
    task-utils.ts                ← Pure parsing/diffing utilities (no side effects)
    task-state-store.ts          ← In-memory snapshot cache (tasks + status per file)
    due-date-modal.ts            ← Modal for collecting due date + priority on next-action assignment
  routing/
    status-routing.ts            ← Pure status extraction, validation, routable-status constants
    task-routing.ts              ← File movement: destination resolution, folder creation, merge handling
  dashboard/
    date-dashboard.ts            ← Right-sidebar ItemView controller + renderer
    dashboard-task-data.ts       ← Task parsing/filtering/sorting for dashboard display
  editor/
    due-date-suggest.ts          ← EditorSuggest for due:: and created:: inline fields
  date/
    date-suggestions.ts          ← Canonical date suggestion list (ISO dates + human labels)
  settings/
    settings-utils.ts            ← TaskManagerSettings type, DEFAULT_SETTINGS, normalizeSettings()
    settings-ui.ts               ← PluginSettingTab renderer
    settings-field-definitions.ts← Declarative metadata for settings controls
    folder-picker.ts             ← FuzzySuggestModal wrappers for vault folder/file pickers
  commands/
    register-task-commands.ts    ← Registers "Process Tasks", "Process File", "Reset Tasks"
```

### Key Data Flow

1. **vault `modify` event** → `TaskProcessor.handleFileModify()` reads file fresh (non-cached) via `vault.read`, diffs against state-store snapshot, calls `reconciler` to apply transition rules, calls `task-routing` if status changed → writes back → state-store updated/rekeyed
2. **Pending-path guards** in `TaskStateStore` prevent re-triggering the modify handler on self-writes
3. **Commands** bypass the event path and call `TaskProcessor.processTasks()` / `processCurrentFile()` / `resetCurrentFileTasks()` directly
4. **Dashboard** is refreshed on `file-open`, `layout-change`, vault `rename`/`delete` events, and after settings changes

### Commands

- **Process Tasks** — applies processing to all markdown files under all four configured task-folder roots
- **Process File** — processes only the currently active file; silently does nothing if the file is not inside one of the four configured roots
- **Reset Tasks** — in the active file, marks all tasks open (`[ ]`) and strips `[due:: ...]`, `[completion-date:: ...]`, `[completion-time:: ...]`, and `[created:: ...]` from task lines, then runs the same flow as Process File

### Settings Persistence

Settings live in `data.json` (loaded/saved via `plugin.loadData()` / `plugin.saveData()`). After a settings change, call `plugin.updateSetting()` — it persists, re-primes task state, and refreshes the dashboard. Settings are normalized on load/save via `normalizeSettings()`.

Configurable paths: Projects Folder, Completed Projects Folder, Waiting Projects Folder, Someday-Maybe Projects Folder, Inbox File (file picker, not folder).

Other settings: Next Action Tag (default `#next-action`), Completed Status Field (default `status`), Dashboard Filename Hide Keywords (comma-separated keywords stripped from dashboard display names).

### Status Routing

Four routable statuses: `todo`, `completed`, `waiting`, `someday-maybe`. Each maps to a configured folder. **Relative sub-path from the matched source root is preserved at the destination** — compute it from the matched configured root, not a hardcoded single root, or files will collapse to the destination root. Missing destination parent folders are created automatically. On path collision, a `MergeConflictModal` prompts merge or skip. Empty folders left behind after a move are deleted (with safety checks).

## Task Reconciliation Rules

### Inline Field Format

Tasks use standard markdown checkboxes. Inline fields use Dataview-style double-colon syntax and appear on the same line as the task:

- `[due:: YYYY-MM-DD]` — due date
- `[completion-date:: YYYY-MM-DD]` — stamped on completion
- `[completion-time:: HH:MM:SS]` — stamped on completion
- `[repeat:: every X]` / `[repeats:: every X]` — recurring interval (`day`, `week`, `month`, `year`)
- `[priority:: N]` — 1–4, where 1 is highest; default 4
- `[created:: YYYY-MM-DD]` — creation date (editor suggest only; not used by reconciler)

The next-action tag (default `#next-action`) marks the single active task in a file. Only one task per file should have this tag.

### Completion (`[ ]` → `[x]`)

- Append `[completion-date:: YYYY-MM-DD]` and `[completion-time:: HH:MM:SS]` to the completed task line
- Move the completed task line into the `## Completed Tasks` section of the same file; if that section doesn't exist, it is appended to the end of the file
- Move `#next-action` tag to the first remaining open task; if none remain, status becomes `completed`
- When status becomes `completed`, also stamp `completion-date` and `completion-time` into the **file frontmatter** (in addition to the task-line inline fields)

### Uncompletion (`[x]` → `[ ]`)

- If the reopened task is the first open task, retag it as `#next-action` and clear the tag from others
- `Process File` / `Process Tasks` also strips stale `[completion-date:: ...]` and `[completion-time:: ...]` from open tasks

### Tagged-Task Deletion

- Reassign `#next-action` to the nearest preceding open task if one exists; otherwise status becomes `completed` behaviorally

### Recurring Tasks

On completion of a task with `[repeat:: every X]` or `[repeats:: every X]`, a new open copy is inserted above the completed task with a computed due date:

- `every day` → tomorrow
- `every week` → +7 days
- `every month` → +1 month (date clamped to last day of month)
- `every year` → +1 year (date clamped)

### Next-Action Assignment & DueDateModal

When `#next-action` is newly assigned to a task, a `DueDateModal` is shown offering:

- A preview of the task text
- A priority dropdown (values 1–4, default 4)
- Suggested dates from today through +30 days with Today/Tomorrow/weekday labels — clicking one immediately applies it
- A text input for custom YYYY-MM-DD or natural-language terms (today, tomorrow, weekday names); Enter submits
- Input autocomplete sourced from the shared `buildDateSuggestions()` list
- A Skip option to dismiss without adding a due date

Modal submit writes both `[due:: YYYY-MM-DD]` and `[priority:: N]` to the task line (updating existing values if present).

**Modal is skipped when**: the assignment was unchanged (task was already `#next-action` before reconcile), the task is recurring, or the task already has a `[due:: ...]` field.

## Date Dashboard

### Activation

If the active note name (without `.md`) matches `YYYY-MM-DD`, the dashboard uses that date. Otherwise it defaults to today's local date.

### Placement

Registered as a custom right-sidebar `ItemView`. Creation prefers `split: true` (half-height side-leaf). Final placement is controlled by Obsidian's layout state.

### Sections

**Due** — open tasks with `[due:: YYYY-MM-DD]` where due date ≤ active date, scanned from configured task-folder roots only. Sorted by: priority ascending (missing = 4), then due date, then file path.

**Inbox** — all incomplete tasks from the configured Inbox File (regardless of date). Rendered as a heading, a link to the file, and an unordered list (no table, no priority column). Shows "No tasks." when empty.

**Completed** — tasks with `[completion-date:: YYYY-MM-DD]` equal to the active date, scanned from configured roots. Sorted by: priority ascending, then file path.

### Display Formatting

- Due and Completed tables have columns: **Folder** | **Filename** | **Task** | **Priority** | (Due only) **Due** in `MM-DD` format
- Rows are grouped first by parent folder (alphabetically), then by filename; `rowspan` is used for grouping cells
- Folder display uses the immediate parent directory segment; Filename strips `.md`
- **Dashboard Filename Hide Keywords**: each comma-separated keyword is removed case-insensitively from both folder and filename display. No automatic date/number stripping is applied.
- Task text strips all inline fields and hashtag tags (e.g. `#next-action`)
- Styling relies on native Obsidian markdown/theme rendering — no plugin-specific dashboard CSS

## Editor Autocomplete

`DueDateEditorSuggest` triggers on `due::` and `CreatedDateEditorSuggest` triggers on `created::`. Both extend a shared `DateFieldEditorSuggest` base and source suggestions from `buildDateSuggestions()`.

- `due::` — suggests today through +30 days, labeled Today/Tomorrow/weekday names; matches on ISO date string or natural-language label
- `created::` — suggests today only
- Selected suggestion inserts ` YYYY-MM-DD` (single space prefix), normalizing fields as `due:: YYYY-MM-DD`

## Key Conventions

### Pure vs. Side-Effecting Code

`task-utils.ts`, `status-routing.ts`, and `date-suggestions.ts` are intentionally pure (no Obsidian API calls, no I/O). Keep them that way. All I/O and Obsidian API usage belongs in `task-processor.ts`, `reconciler.ts`, `task-routing.ts`, or the dashboard layer.

### Obsidian API Usage

- File reads: always `await app.vault.read(file)` — never `cachedRead` for task processing (stale data causes reconciliation bugs)
- File writes: `await app.vault.modify(file, newContent)`
- Frontmatter updates: `await app.fileManager.processFrontMatter(file, fn)` for the `status` field
- File moves: `await app.fileManager.renameFile(file, newPath)` — not `vault.rename`, which does not preserve links

### TypeScript Conventions

- Strict mode (`strict: true`); no `any` without explicit justification
- `async`/`await` for all async operations — no `.then()` chains
- Constants: `SCREAMING_SNAKE_CASE` for module-level constants and regex patterns
- Dependency injection: services receive `app` and callbacks rather than importing globals
- Thrown errors are caught at command-handler boundaries and surfaced via `new Notice()`

### When Changing Routing Logic

- Verify both command-driven and event-driven routing still work
- Verify relative-path preservation across all four configured roots
- Verify empty-folder cleanup safety boundaries

### When Changing Reconciliation Logic

- Ensure metadata stamping and tag reassignment remain idempotent
- Verify recurring insertion index and that the completed task line is not mutated as the clone source

### When Changing Dashboard Logic

- Preserve date-note activation behavior and the fallback-to-today default
- Preserve `due <=` semantics (overdue tasks must still appear)
- Preserve configured-root scan restriction (do not scan the whole vault)
- Preserve open-task-only gate for Due rows

## Regression Checklist

Run after meaningful logic changes:

1. `npm run build` succeeds
2. `Process File` updates tags/status correctly for complete, uncomplete, and delete cases; when the last task is completed, `completion-date` and `completion-time` are stamped in both the task line and the file frontmatter
3. Task completion triggers the DueDateModal for the newly assigned `#next-action` task
4. Modal shows task text preview; clicking a suggested date immediately applies it; manual date input (YYYY-MM-DD or natural-language) works via Add Due Date / Enter
5. Submitted due date written as `[due:: YYYY-MM-DD]`; priority written as `[priority:: N]` (default 4)
6. Modal Skip dismisses without modifying the task
7. Recurring completion inserts new open task above completed task with correct due date
8. Status change routes file to correct destination folder
9. Move preserves sub-path; files do not flatten to destination root
10. Merge conflict prompt appears when destination file exists
11. Empty source directories cleaned up after move/merge
12. Date dashboard renders Due/Completed for active date-named notes; defaults to today on non-date notes
13. Due and Completed tables show Priority column; missing priority treated as 4
14. Due table sorted by priority then due date; shows MM-DD Due column
15. Dashboard task text strips inline fields and tags; filename/folder display applies hide-keywords
16. Typing `due::` shows suggestions from today, matches ISO and weekday labels, inserts ` YYYY-MM-DD`
17. Typing `created::` shows today suggestion and inserts ` YYYY-MM-DD`
18. `Reset Tasks` reopens all tasks, removes due/completion/created inline fields, then runs Process File flow
