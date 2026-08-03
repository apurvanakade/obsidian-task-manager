/**
 * Purpose:
 * - orchestrate the "Create Tasks Summary" command.
 *
 * Responsibilities:
 * - warns (but doesn't block) when the Bases core plugin isn't enabled
 * - writes buildTaskBaseFileContent()'s output to the configured path, overwriting
 *   without confirmation if a file already exists there — the command is meant to be
 *   re-run freely to pick up folder-setting changes, so there's no prompt in the way
 *
 * Dependencies:
 * - base-file-content.ts (pure YAML builder)
 * - task-routing.ts (ensureParentFoldersExist, reused as-is)
 * - Obsidian vault/workspace APIs
 *
 * Side Effects:
 * - creates/overwrites a vault file; shows Notices
 */
import { App, Notice, TFile } from "obsidian";
import { buildTaskBaseFileContent } from "./base-file-content";
import { TaskManagerSettings } from "../settings/settings-utils";
import { ensureParentFoldersExist } from "../routing/task-routing";

export async function runCreateTasksSummary(app: App, settings: TaskManagerSettings): Promise<void> {
  if (!settings.basesFilePath) {
    new Notice("Set Bases File Path in plugin settings first.");
    return;
  }

  if (!isBasesCorePluginEnabled(app)) {
    new Notice("Enable the Bases core plugin (Settings → Core plugins; requires Obsidian 1.9+) to use the generated file.");
  }

  const existing = app.vault.getAbstractFileByPath(settings.basesFilePath);
  if (existing && !(existing instanceof TFile)) {
    new Notice(`'${settings.basesFilePath}' is a folder, not a file.`);
    return;
  }

  const content = buildTaskBaseFileContent(settings);
  await ensureParentFoldersExist(app, settings.basesFilePath);

  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(settings.basesFilePath, content);
  }

  new Notice(`Created ${settings.basesFilePath}.`);
}

/**
 * The Bases core plugin isn't part of the public Obsidian API surface (no typed
 * `App.internalPlugins`), so this reaches past the typings the same way community plugins
 * commonly do for core-plugin detection. Defensive by construction: any missing shape
 * (older Obsidian versions, internal API changes) just falls through to `false`, which
 * only produces an extra Notice — it never blocks file generation.
 */
function isBasesCorePluginEnabled(app: App): boolean {
  const internalPlugins = (app as unknown as {
    internalPlugins?: { plugins?: Record<string, { enabled?: boolean }> };
  }).internalPlugins;

  return internalPlugins?.plugins?.bases?.enabled === true;
}
