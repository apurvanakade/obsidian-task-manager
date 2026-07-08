# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

An Obsidian plugin (Task Manager) that automates task lifecycle management: state transitions, completion metadata stamping, recurring task creation, file routing by status, editor autocomplete for date fields, a right-sidebar date dashboard, and generated task/project summary notes.

**Read `.github/copilot-instructions.md` first.** It is the authoritative, actively maintained architecture reference for this repo (module map, data flow, reconciliation rules, dashboard/summary behavior, conventions, and a regression checklist). `README.md` documents the same behavior from a user-facing angle. This CLAUDE.md only summarizes the essentials and points at gaps not covered elsewhere.

## Commands

```bash
npm run dev      # watch mode — rebuilds main.js on file changes via esbuild
npm run build    # type-check (tsc --noEmit --skipLibCheck) + production bundle → main.js
```

There are no test or lint commands in this repo. After any build, reload the plugin in Obsidian to verify behavior — the `verify` skill or manual reload is the only way to confirm runtime correctness here.

Bundling: `esbuild.config.mjs` bundles `main.ts` → `main.js` (CommonJS, ES2018). `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, and Node builtins are marked external and must never be bundled.

## Architecture essentials

- **Entry point**: `main.ts` wires all services and event listeners.
- **Core flow**: vault `modify` events go through `TaskProcessor.handleFileModify()` (`src/tasks/task-processor.ts`), which reads the file fresh (`vault.read`, never `cachedRead`), diffs against a per-file snapshot in `TaskStateStore` (`src/tasks/task-state-store.ts`), applies transition rules via `reconciler.ts`, runs status-based routing (`src/routing/`), writes back, and updates state. Pending-path guards in the state store prevent the writer from re-triggering itself.
- **Pure vs. side-effecting split is intentional and load-bearing**: `task-utils.ts`, `task-line-metadata.ts`, `repeat-rules.ts`, `status-routing.ts`, `date-utils.ts`, and `date-suggestions.ts` must stay free of Obsidian API calls and I/O. All I/O and Obsidian API usage belongs in `task-processor.ts`, `reconciler.ts`, `task-routing.ts`, or the dashboard layer.
- **Obsidian API conventions**: reads via `app.vault.read` (not `cachedRead`), writes via `app.vault.modify`, frontmatter edits via `app.fileManager.processFrontMatter`, file moves via `app.fileManager.renameFile` (not `vault.rename`, which drops link updates).
- **Settings**: persisted in `data.json` via `plugin.loadData()`/`plugin.saveData()`, normalized through `normalizeSettings()` in `src/settings/settings-utils.ts`. Settings changes must go through `plugin.updateSetting()`, which persists, re-primes task state, and refreshes the dashboard.
- **Status routing and summary regeneration are coupled**: status changes and DueDateModal submits silently regenerate both the Tasks Summary and Project Summary notes in the background — this is easy to break accidentally when touching routing or modal code.

## Required upkeep when changing behavior

Per `.github/copilot-instructions.md`, any change to user-visible behavior (commands, settings, reconciliation rules, Due Date Modal, inline field formats, autocomplete, dashboard, or routing) must update `README.md` (including its Code Organization table) **in the same commit**, not a follow-up. When adding/removing/renaming modules, also update the module map in `.github/copilot-instructions.md`.

Before considering a logic change to reconciliation, routing, or the dashboard complete, walk the Regression Checklist at the end of `.github/copilot-instructions.md` — there is no automated test suite, so this checklist is the closest thing to one.
