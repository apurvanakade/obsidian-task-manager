/**
 * Purpose:
 * - orchestrate the "Create Task Bases" command.
 *
 * Responsibilities:
 * - warns (but doesn't block) when the Bases core plugin isn't enabled
 * - prompts before overwriting an existing generated file — the whole point of Bases is
 *   the user customizing views in its UI afterward, so the plugin never touches the file
 *   again without asking
 * - writes buildTaskBaseFileContent()'s output to the configured path
 *
 * Dependencies:
 * - base-file-content.ts (pure YAML builder)
 * - task-routing.ts (ensureParentFoldersExist, reused as-is)
 * - Obsidian vault/workspace APIs
 *
 * Side Effects:
 * - creates/overwrites a vault file; shows Notices and, on collision, a confirm modal
 */
import { App, Modal, Notice, TFile } from "obsidian";
import { buildTaskBaseFileContent } from "./base-file-content";
import { TaskManagerSettings } from "../settings/settings-utils";
import { ensureParentFoldersExist } from "../routing/task-routing";

export async function runCreateTaskBases(app: App, settings: TaskManagerSettings): Promise<void> {
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

  if (existing instanceof TFile) {
    const shouldOverwrite = await promptOverwriteConfirm(app, settings.basesFilePath);
    if (!shouldOverwrite) {
      return;
    }
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

async function promptOverwriteConfirm(app: App, path: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    class OverwriteConfirmModal extends Modal {
      private resolved = false;

      onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        const title = document.createElement("h3");
        title.textContent = "Overwrite Existing Bases File?";
        contentEl.appendChild(title);

        const message = document.createElement("p");
        message.textContent = `'${path}' already exists. Regenerating it will discard any view customizations you've made in the Bases UI.`;
        contentEl.appendChild(message);

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.marginTop = "12px";

        const overwriteButton = document.createElement("button");
        overwriteButton.textContent = "Overwrite";
        overwriteButton.addEventListener("click", () => {
          this.resolved = true;
          resolve(true);
          this.close();
        });

        const cancelButton = document.createElement("button");
        cancelButton.textContent = "Cancel";
        cancelButton.addEventListener("click", () => {
          this.resolved = true;
          resolve(false);
          this.close();
        });

        actions.appendChild(overwriteButton);
        actions.appendChild(cancelButton);
        contentEl.appendChild(actions);
      }

      onClose(): void {
        if (!this.resolved) {
          resolve(false);
        }
      }
    }

    new OverwriteConfirmModal(app).open();
  });
}
