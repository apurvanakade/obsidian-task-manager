# Task Manager Plugin

## How To Use

1. Open Obsidian and enable the `Task Manager` plugin.
2. Open plugin settings and configure:
   - `Projects Folder`: root folder to scan for project notes.
   - `Next action tag`: tag applied to the current actionable task (default `#next-action`).
   - `Completed status field`: frontmatter field name to update (default `status`).
3. Run the `Initialize` command from the Command Palette:
   - Scans all Markdown files under `Projects Folder` recursively.
   - Ensures each file has at most one next-action tag on an incomplete task.
   - Sets frontmatter status to `todo` if an incomplete task exists, otherwise `completed`.
4. During normal editing, the plugin reacts to task changes automatically:
   - **Task cycle**: tasks are managed as a 3-state flow (`[ ]` open -> `[/]` started -> `[x]` completed).
   - **Task completed**: stamps completion metadata on the completed task and moves the next-action tag to the first incomplete task anywhere in the file; if none, sets status to `completed`.
   - **Task uncompleted**: if the reopened task is now the first open task in the file, strips the tag from all other tasks and applies it to this one; status is reset to `todo`.
   - **Tagged task deleted**: moves the next-action tag to the nearest preceding incomplete task; if none, sets status to `completed`.

### Completion Metadata

When a task becomes completed, the plugin appends:

- `[completion-date:: YYYY-MM-DD]`
- `[completition-time:: HH:MM:SS]`

## Code Organization

- `main.ts`: TypeScript source entrypoint (source of truth).
- `main.js`: bundled runtime output loaded by Obsidian (`npm run build` regenerates this file).
- `src/settings-utils.ts`: settings type, defaults, and normalization helpers.
- `src/task-utils.ts`: task parsing, state diffing, and tag manipulation utilities.
- `src/reconciler.ts`: completion, uncompletion, deletion, and initialization reconciliation workflows.
- `src/settings-ui.ts`: settings tab rendering and folder picker UI.
- `manifest.json`: Obsidian plugin metadata.
- `obsidian.d.ts`: local Obsidian type shim used in this workspace.
