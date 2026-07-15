/**
 * Purpose:
 * - shared file-scanning helpers reused across the live Tasks Summary/Weekly Review
 *   tabs and other features that enumerate task/project files by configured folder.
 *
 * Responsibilities:
 * - folder-membership and excluded-file checks
 *
 * Dependencies:
 * - normalized plugin settings
 *
 * Side Effects:
 * - none (pure helpers)
 */
import { TaskManagerSettings } from "../settings/settings-utils";

export function isInFolder(filePath: string, folderPath: string): boolean {
  return filePath.startsWith(`${folderPath}/`);
}

export function isExcludedSummaryFile(filePath: string, settings: TaskManagerSettings): boolean {
  return filePath === settings.inboxFile;
}
