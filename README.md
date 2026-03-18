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
   - **Task completed**: moves the next-action tag to the next incomplete task below; if none, sets status to `completed`.
   - **Task uncompleted**: if the reopened task is now the first open task in the file, strips the tag from all other tasks and applies it to this one; status is reset to `todo`.
   - **Tagged task deleted**: moves the next-action tag to the nearest preceding incomplete task; if none, sets status to `completed`.

## Code Organization

- `main.js`: self-contained runtime entrypoint loaded directly by Obsidian.
- `main.ts`: TypeScript source entrypoint (development reference only, not loaded by Obsidian).
- `src/settings-utils.ts`: settings type, defaults, and normalization helpers.
- `src/task-utils.ts`: task parsing, state diffing, and tag manipulation utilities.
- `src/reconciler.ts`: completion, uncompletion, deletion, and initialization reconciliation workflows.
- `src/settings-ui.ts`: settings tab rendering and folder picker UI.
- `manifest.json`: Obsidian plugin metadata.
- `obsidian.d.ts`: local Obsidian type shim used in this workspace.
