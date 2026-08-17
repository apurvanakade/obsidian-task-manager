/**
 * Purpose:
 * - shared file-scanning helper reused across the live Tasks Summary/Projects Summary
 *   tabs and other features that enumerate task/project files by configured folder.
 *
 * Responsibilities:
 * - folder-membership check
 *
 * Dependencies:
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure helper)
 */
export function isInFolder(filePath: string, folderPath: string): boolean {
  return filePath.startsWith(`${folderPath}/`);
}
