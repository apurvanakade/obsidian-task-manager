/**
 * Purpose:
 * - expose a reusable vault-folder picker for settings flows.
 *
 * Responsibilities:
 * - wraps Obsidian FuzzySuggestModal for selecting a folder path
 * - gracefully handles environments where the picker API is unavailable
 * - returns the selected path through a callback contract
 *
 * Dependencies:
 * - Obsidian App, Notice, FuzzySuggestModal, TFolder APIs
 *
 * Side Effects:
 * - opens a modal UI and triggers callback when a folder is selected
 */
import { App, FuzzySuggestModal, Notice, TFolder } from "obsidian";

export function openFolderPicker(app: App, onChoose: (folderPath: string) => Promise<void>): void {
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
