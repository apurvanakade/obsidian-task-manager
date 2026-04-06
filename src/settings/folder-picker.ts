/**
 * Purpose:
 * - expose reusable vault-folder and vault-file pickers for settings flows.
 *
 * Responsibilities:
 * - wraps Obsidian FuzzySuggestModal for selecting folder or file paths
 * - gracefully handles environments where picker APIs are unavailable
 * - returns the selected path through a callback contract
 *
 * Dependencies:
 * - Obsidian App, Notice, FuzzySuggestModal, TFolder, TFile APIs
 *
 * Side Effects:
 * - opens a modal UI and triggers callback when a folder or file is selected
 *
 * Notes:
 * - openFilePicker is used for Inbox File; openFolderPicker for folder settings.
 */
import { App, FuzzySuggestModal, Notice, TFile, TFolder } from "obsidian";

export function openFilePicker(app: App, onChoose: (filePath: string) => Promise<void>): void {
  if (typeof FuzzySuggestModal !== "function") {
    new Notice("File picker is not available in this Obsidian version.");
    return;
  }
  new FileSuggestModal(app, onChoose).open();
}

class FileSuggestModal extends FuzzySuggestModal<string> {
  private readonly onChoose: (filePath: string) => Promise<void>;

  constructor(app: App, onChoose: (filePath: string) => Promise<void>) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Select a file");
  }

  getItems(): string[] {
    return this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFile => file instanceof TFile)
      .map((file) => file.path)
      .sort((left, right) => left.localeCompare(right));
  }

  getItemText(filePath: string): string {
    return filePath;
  }

  onChooseItem(filePath: string): void {
    void this.onChoose(filePath);
  }
}

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
