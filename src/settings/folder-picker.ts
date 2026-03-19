/**
 * Purpose:
 * - expose a reusable vault-folder picker for settings flows.
 *
 * Responsibilities:
 * - wraps Obsidian FuzzySuggestModal for selecting folder paths
 * - gracefully handles environments where picker APIs are unavailable
 * - returns the selected folder path through a callback contract
 *
 * Dependencies:
 * - Obsidian App, Notice, and FuzzySuggestModal APIs
 *
 * Side Effects:
 * - opens a modal UI and triggers callback when a folder is selected
 */
import { App, FuzzySuggestModal, Notice, TFolder } from "obsidian";

export function openFolderPicker(app: App, onChoose: (folderPath: string) => Promise<void>): void {
  // Guard against Obsidian API differences that can break plugin startup.
  if (typeof FuzzySuggestModal !== "function") {
    new Notice("Folder picker is not available in this Obsidian version.");
    return;
  }

  new FolderSuggestModal(app, onChoose).open();
}

class FolderSuggestModal extends FuzzySuggestModal<string> {
  private readonly onChoose: (folderPath: string) => Promise<void>;

  constructor(app: App, onChoose: (folderPath: string) => Promise<void>) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Select a folder");
  }

  getItems(): string[] {
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map((folder) => folder.path)
      .sort((left, right) => left.localeCompare(right));

    return ["", ...folders];
  }

  getItemText(folderPath: string): string {
    return folderPath || "/";
  }

  onChooseItem(folderPath: string): void {
    void this.onChoose(folderPath);
  }
}