# Task Manager Plugin: Agent Startup Summary

This document is a fast, high-signal guide for future agents working in this repository.

## 1) Purpose and Scope

This Obsidian plugin manages project/task notes by:

- reconciling task transitions (`[ ]` <-> `[x]`) and `next-action` tagging
- writing completion metadata on completed tasks
- creating recurring task follow-ups from repeat fields
- offering editor autocomplete for `due::` date entry
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

- `src/tasks/task-processor.ts`: runtime orchestration for file modify events and command-triggered processing.
- `src/tasks/task-state-store.ts`: in-memory state (tasks/status maps + pending write guards + path rekey logic).
- `src/routing/status-routing.ts`: status extraction, predicted status logic, and routable-status validation.
- `src/routing/task-routing.ts`: destination root resolution, relative path preservation, folder creation, merge conflict prompt, and empty-folder cleanup.
- `src/tasks/reconciler.ts`: task-level reconciliation (completion/uncompletion/deletion + recurring-task clone insertion).
- `src/dashboard/date-dashboard.ts`: right sidebar date dashboard view registration, refresh scheduling, data collection, sorting, and rendering.
- `src/editor/due-date-suggest.ts`: editor suggest provider for `due::` date completion.
- `src/tasks/task-utils.ts`: task parsing/diff helpers and tag manipulation helpers.
- `src/settings/settings-ui.ts`: plugin settings tab renderer.
- `src/settings/settings-utils.ts`: settings defaults + normalization.

Typing source:

- Obsidian API typings are sourced from the `obsidian` npm package in `devDependencies`.

## 4) Command and Event Flow

Commands:

- `Process Tasks`: applies processing to all markdown files under all configured task folders.
- `Process File`: processes only the currently active markdown file.

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

1. `main.ts` registers `DueDateEditorSuggest` during plugin load.
2. Typing `due::` triggers suggestions for dates from today through +30 days.
3. Selected suggestion inserts `YYYY-MM-DD` at the cursor.

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
- Filename display strips `.md` and leading numeric archival prefixes.
- Task display strips inline fields and hashtag tags (e.g. `#next-action`).

Compatibility cleanup:

- Legacy inline dashboard DOM nodes (older reading-view injection) are removed during refresh.

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
3. Recurring completion creates next open task with expected due date.
4. Status change triggers automatic routing to correct destination.
5. Move preserves subpath and does not flatten unexpectedly.
6. Merge conflict prompt appears when destination file exists.
7. Empty source directories are cleaned up after successful move/merge.
8. Date dashboard appears in sidebar for date note and renders Due/Completed correctly.
9. Due table sorted ascending by due date and shows `MM-DD` column.
10. Dashboard text cleanup removes inline fields/tags; filename display cleanup is applied.
11. Typing `due::` shows date suggestions starting from today and inserts `YYYY-MM-DD`.

## 11) Known Constraints

- Final pane placement is ultimately controlled by Obsidian layout state; plugin can only prefer split side-leaf defaults.
