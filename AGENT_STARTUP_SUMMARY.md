# Task Manager Plugin: Agent Startup Summary

This document is a fast, high-signal guide for future agents working in this repository.

## 1) Purpose and Scope

This Obsidian plugin manages project/task notes by:

- reconciling task transitions (`[ ]` <-> `[x]`) and `next-action` tagging
- writing completion metadata on completed tasks
- creating recurring task follow-ups from repeat fields
- offering editor autocomplete for `due::` and `created::` date entry
- updating status and routing files between configured folders
- rendering a date-note dashboard (`YYYY-MM-DD`) in a right sidebar view

## 2) Build and Validation

Primary validation command:

```bash
npm run build
```

What it does:

- `tsc --noEmit --skipLibCheck`
- `node esbuild.config.mjs production`

Expected output artifact:

- `main.js` bundle used by Obsidian

## 3) Runtime Architecture

Entrypoint:

- `main.ts`: orchestrates setup, command registration, settings lifecycle, and delegates behavior to controllers/services.

Core modules:

- `src/commands/register-task-commands.ts`: command registration for `Process Tasks` and `Process File`.
- `src/tasks/task-processor.ts`: runtime orchestration for file modify events and command-triggered processing.
- `src/tasks/task-state-store.ts`: in-memory state (tasks/status maps + pending write guards + path rekey logic).
- `src/routing/status-routing.ts`: status extraction, predicted status logic, and routable-status validation.
- `src/routing/task-routing.ts`: destination root resolution, relative path preservation, folder creation, merge conflict prompt, and empty-folder cleanup.
- `src/tasks/reconciler.ts`: task-level reconciliation (completion/uncompletion/deletion + recurring-task clone insertion + due-date modal on next-action assignment).
- `src/tasks/due-date-modal.ts`: modal dialog for adding due dates to newly assigned `next-action` tasks.
- `src/dashboard/dashboard-task-data.ts`: dashboard task parsing, filtering, cleanup, and sorting helpers.
- `src/dashboard/date-dashboard.ts`: right sidebar date dashboard view registration, refresh scheduling, and rendering.
- `src/editor/due-date-suggest.ts`: editor suggest providers for `due::` and `created::` completion.
- `src/settings/folder-picker.ts`: vault folder picker modal used by the settings UI.
- `src/settings/settings-field-definitions.ts`: declarative folder/text setting definitions consumed by the settings UI.
- `src/tasks/task-utils.ts`: task parsing/diff helpers and tag manipulation helpers.
- `src/settings/settings-ui.ts`: plugin settings tab renderer.
- `src/settings/settings-utils.ts`: settings defaults + normalization.

Typing source:

- Obsidian API typings are sourced from the `obsidian` npm package in `devDependencies`.

## 4) Command and Event Flow

Commands:

- `Process Tasks`: applies processing to all markdown files under all configured task folders.
- `Process File`: processes only the currently active markdown file.
- `Reset Tasks`: in the active markdown file, marks all tasks open (`[ ]`) and removes inline fields `[due:: ...]`, `[completion-date:: ...]`, `[completion-time:: ...]`, and `[created:: ...]` from task lines, then runs `Process File` behavior on that file.

Command registration:

- `main.ts` wires plugin services together and delegates command registration to `src/commands/register-task-commands.ts`.

Event-driven flow:

1. `vault.modify` event triggers `TaskProcessor.handleFileModify`.
2. Processor compares previous and current task snapshots.
3. Reconciler applies task transition logic.
4. Status is updated/predicted.
5. File may be routed to another configured folder when status becomes routable.
6. In-memory store is refreshed/rekeyed to avoid stale path references.

Loop prevention:

- Pending-path guards prevent self-trigger loops from plugin-induced file writes/moves.

Editor suggest flow:

1. `main.ts` registers `DueDateEditorSuggest` and `CreatedDateEditorSuggest` during plugin load.
2. Typing `due::` triggers suggestions for dates from today through +30 days, labeled as Today/Tomorrow/weekday names.
3. Typing `created::` triggers a today-date suggestion.
4. Autocomplete matching works against both the ISO date and natural-language labels where available.
5. Selected suggestion inserts a single-space-prefixed date (` YYYY-MM-DD`) so field values are normalized as `due:: YYYY-MM-DD` and `created:: YYYY-MM-DD`.

## 5) Status and Routing Rules

Routable statuses:

- `todo`
- `completed`
- `waiting`
- `someday-maybe`

Routing behavior:

- Destination folder root is selected by status.
- Relative hierarchy from the matched source task root is preserved at destination.
- Missing destination parent folders are created automatically.
- If destination file exists, merge/skip prompt is shown.
- Empty folders left behind after move/merge are deleted (with safety checks).

Important implementation detail:

- Relative path must be computed from the matched configured root, not a hardcoded single root, otherwise files can collapse to destination root.

## 6) Task Reconciliation Details

Completion (`[ ]` -> `[x]`):

- append/update completion metadata:
  - `[completion-date:: YYYY-MM-DD]`
  - `[completion-time:: HH:MM:SS]`
- move `next-action` tag to first open task (if any), else status can become `completed`.

Next-Action Assignment (triggered when `#next-action` is newly assigned):

- prompt user with due-date modal offering:
  - suggested dates (today through +30 days with Today/Tomorrow/weekday labels)
  - clicking a suggested date immediately adds that due date
  - text input field for custom date (YYYY-MM-DD format)
  - skip option to dismiss without adding due date
  - **modal is skipped if**: assignment was unchanged (already tagged before reconcile), assigned task is repeating, or task already has a due date
- occurs on task completion, uncompletion, tagged task deletion, and during reconciliation (e.g., `process file` or `process tasks`)

Uncompletion (`[x]` -> `[ ]`):

- if reopened task is first open task, retag it as `next-action` and clear tag from others.
- status resets toward `todo` behavior.

Tagged task deletion:

- reassign `next-action` to nearest preceding open task if available; otherwise status becomes `completed` behaviorally.

Recurring task handling:

- fields: `[repeat:: ...]` or `[repeats:: ...]`
- on completion, create a new open copy above completed task with computed due date:
  - every day -> tomorrow
  - every week -> +7 days
  - every month -> +1 month (date clamped)
  - every year -> +1 year (date clamped)

## 7) Date Dashboard Behavior

Activation condition:

- Active note name (without `.md`) must match `YYYY-MM-DD`.

Placement:

- Dashboard is a custom view in right sidebar.
- Creation prefers split side-leaf (`split: true`) so it opens in half-height pane by default when layout permits.

Data scope:

- Scans only markdown files under configured task-folder roots.

Sections:

- `Due`
- `Completed`

Due table inclusion:

- task status is open
- has `[due:: YYYY-MM-DD]`
- due date `<=` active date note

Completed table inclusion:

- has `[completion-date:: YYYY-MM-DD]` equal to active date note

Sorting:

- Due rows: ascending by due date, then path/task tie-breakers.
- Completed rows: path then task.

Display formatting:

- Due includes a `Due` column in `MM-DD` format.
- Filename display strips `.md` and removes leading archival-style dates, timestamps, and numeric fragments from the displayed name.
- Task display strips inline fields and hashtag tags (e.g. `#next-action`).
- Dashboard rendering relies on native Obsidian markdown/theme styling instead of plugin-specific dashboard CSS.

## 8) Settings Model and Practical Defaults

Key configurable paths:

- Projects Folder
- Completed Projects Folder
- Waiting Projects Folder
- Someday-Maybe Projects Folder

Other key settings:

- Next Action Tag (default `#next-action`)
- Completed Status Field (default `status`)

Normalization:

- settings are normalized on load/save via `normalizeSettings`.

## 9) Safe Editing Guidance for Future Agents

Maintenance rule (required):

- After any code change that affects behavior, architecture, commands, settings, data flow, file organization, or validation steps, update this file in the same change set before finishing.
- Keep updates minimal but explicit: revise affected sections and (when relevant) add/adjust regression checklist items.
- Do not leave this summary stale relative to `main.ts` and `src/{tasks,routing,settings,dashboard,editor}/*` runtime behavior.

Current file-organization principle:

- Prefer small, focused files with dependency direction reflected by folder/module boundaries (for example, `settings-ui.ts` depends on `settings-field-definitions.ts` and `folder-picker.ts`, while those helper modules remain isolated from settings rendering; `date-dashboard.ts` depends on `dashboard-task-data.ts`, which stays free of view concerns).

When changing routing logic:

- verify both command-driven and status-change-driven routing still work
- verify path preservation across all configured roots
- verify empty-folder cleanup safety boundaries

When changing task parsing/reconcile logic:

- ensure metadata stamping and tag reassignment remain idempotent
- verify recurring insertion index and clone-source immutability assumptions

When changing dashboard logic:

- preserve date-note activation behavior
- preserve due `<=` semantics
- preserve configured-root scan restriction
- preserve open-task-only gate for Due rows

## 10) Quick Regression Checklist

Run after meaningful logic changes:

1. `npm run build` succeeds.
2. `Process File` updates tags/status correctly on complete/uncomplete/delete cases.
3. Task completion triggers due-date modal for newly assigned `next-action` task.
4. Due-date modal immediately adds a clicked suggested date, or allows manual date entry via the input and Add Due Date button.
5. Selected/entered due date is correctly added to task as `[due:: YYYY-MM-DD]`.
6. Modal skip action dismisses without modifying task.
7. Recurring completion creates next open task with expected due date.
8. Status change triggers automatic routing to correct destination.
9. Move preserves subpath and does not flatten unexpectedly.
10. Merge conflict prompt appears when destination file exists.
11. Empty source directories are cleaned up after successful move/merge.
12. Date dashboard appears in sidebar for date note and renders Due/Completed correctly.
13. Due table sorted ascending by due date and shows `MM-DD` column.
14. Dashboard text cleanup removes inline fields/tags; filename display cleanup is applied.
15. Typing `due::` shows date suggestions starting from today, matches on ISO dates and weekday labels, and inserts ` YYYY-MM-DD` (single space after `::`).
16. Typing `created::` shows today suggestion and inserts ` YYYY-MM-DD` (single space after `::`).
17. `Reset Tasks` (active file) reopens all tasks, removes due/completion/created inline metadata from task lines, and then runs the same processing flow as `Process File`.

## 11) Known Constraints

- Final pane placement is ultimately controlled by Obsidian layout state; plugin can only prefer split side-leaf defaults.
