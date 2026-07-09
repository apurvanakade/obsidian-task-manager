/**
 * Purpose:
 * - locate and select a random project file from the Someday-Maybe Projects Folder.
 *
 * Responsibilities:
 * - scans the configured Someday-Maybe Projects Folder for markdown project files
 * - excludes generated summary files that might be misconfigured into that folder
 * - picks a uniformly random file from the candidate list
 *
 * Dependencies:
 * - Obsidian vault API for markdown file listing
 *
 * Side Effects:
 * - none (reads in-memory vault index only; does not open or modify files)
 */
import { App, TFile } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";

export function getSomedayMaybeProjectFiles(app: App, settings: TaskManagerSettings): TFile[] {
  const folderPath = settings.somedayMaybeProjectsFolder;
  if (!folderPath) {
    return [];
  }

  return app.vault.getMarkdownFiles().filter((file) =>
    isInFolder(file.path, folderPath) && !isExcludedSummaryFile(file.path, settings),
  );
}

export function pickRandomFile(files: TFile[]): TFile | null {
  if (files.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * files.length);
  return files[index];
}

function isInFolder(filePath: string, folderPath: string): boolean {
  return filePath.startsWith(`${folderPath}/`);
}

function isExcludedSummaryFile(filePath: string, settings: TaskManagerSettings): boolean {
  return filePath === settings.tasksSummaryFile
    || filePath === settings.projectSummaryFile
    || filePath === settings.inboxFile;
}
