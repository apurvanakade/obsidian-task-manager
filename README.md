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
4. During normal editing, when a task is completed:
   - The plugin moves the next-action tag to the next relevant incomplete task.
   - If no next task remains, it updates status to `completed`.

## Code Organization

- `main.js`: runtime plugin entrypoint for Obsidian (loaded directly).
- `main.ts`: TypeScript source entrypoint mirroring runtime behavior.
- `runtime/settings-utils.js`: settings defaults and normalization.
- `runtime/task-utils.js`: task parsing/state detection and tag operations.
- `runtime/reconciler.js`: completion and initialization reconciliation workflows.
- `runtime/settings-ui.js`: settings tab rendering and folder picker UI.
- `src/settings-utils.ts`: TypeScript settings helpers.
- `src/task-utils.ts`: TypeScript task utility helpers.
- `src/reconciler.ts`: TypeScript reconciliation workflows.
- `src/settings-ui.ts`: TypeScript settings UI logic.
- `manifest.json`: Obsidian plugin metadata.
- `versions.json`: plugin-to-minimum-Obsidian version map.
- `obsidian.d.ts`: local Obsidian type shim used in this workspace.
