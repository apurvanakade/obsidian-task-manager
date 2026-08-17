/**
 * Purpose:
 * - move selected captured-task lines (from daily notes) into a project: either
 *   bundled into a brand-new project (via AddProjectModal, prefilled) or appended
 *   onto an existing one.
 *
 * Responsibilities:
 * - removeCapturedTaskLines(): re-reads each affected daily note fresh and strips
 *   exact-matching task lines, grouped by source file since selected rows can span
 *   multiple daily notes; skips (and reports via Notice) any line that no longer
 *   matches — e.g. a task edited or already removed elsewhere between the tab's
 *   snapshot and the button click
 * - appendTasksToProject(): inserts task lines into an existing project file's
 *   open-task area, immediately above the file's current first open task (so the
 *   moved task becomes the new next action) — or, if the file has no open task,
 *   above "## Completed Tasks" if present, else at the end of the file
 *
 * Dependencies:
 * - Obsidian vault/Notice APIs, the shared "## Completed Tasks" header constant from
 *   task-utils.ts
 *
 * Side Effects:
 * - reads and writes markdown files in the vault; shows a Notice when a line can't be
 *   removed
 */
import { App, Notice, TFile } from "obsidian";
import { COMPLETED_SECTION_HEADER, findFirstIncompleteTaskLine } from "../tasks/task-utils";
import { CapturedTaskRow } from "./captured-tasks-data";

/**
 * Removes exact-matching task lines from each row's source daily note. Re-reads each
 * file fresh (never from a cached snapshot) so a line already edited or removed
 * elsewhere is safely skipped rather than corrupting an unrelated line. If a duplicate
 * line appears more than once in a file, at most one occurrence is removed per matching
 * row — an accepted v1 limitation for identical-text duplicates.
 */
export async function removeCapturedTaskLines(app: App, rows: CapturedTaskRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const linesByFile = new Map<TFile, string[]>();
  for (const row of rows) {
    const existing = linesByFile.get(row.file);
    if (existing) {
      existing.push(row.rawLine);
    } else {
      linesByFile.set(row.file, [row.rawLine]);
    }
  }

  let staleCount = 0;

  for (const [file, linesToRemove] of linesByFile) {
    const content = await app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const pending = [...linesToRemove];
    const keptLines: string[] = [];

    for (const line of lines) {
      const pendingIndex = pending.indexOf(line);
      if (pendingIndex !== -1) {
        pending.splice(pendingIndex, 1);
        continue;
      }

      keptLines.push(line);
    }

    await app.vault.modify(file, keptLines.join("\n"));
    staleCount += pending.length;
  }

  if (staleCount > 0) {
    new Notice(`${staleCount} task(s) had already changed and were left in place.`);
  }
}

/**
 * Inserts task lines into `file`'s open-task area, immediately above the file's
 * current first open task — so a moved-in task becomes the new next action rather
 * than landing after whatever was already actionable. Falls back to immediately
 * above the "## Completed Tasks" heading (or the end of the file, if no such
 * heading exists) when the file has no open task at all.
 */
export async function appendTasksToProject(app: App, file: TFile, linesToAppend: string[]): Promise<void> {
  if (linesToAppend.length === 0) {
    return;
  }

  const content = await app.vault.read(file);
  const lines = content.split(/\r?\n/);
  const firstOpenTaskIndex = findFirstIncompleteTaskLine(lines);

  const result = [...lines];
  if (firstOpenTaskIndex !== null) {
    result.splice(firstOpenTaskIndex, 0, ...linesToAppend);
  } else {
    const sectionIndex = result.findIndex((line) => line.trim() === COMPLETED_SECTION_HEADER);
    if (sectionIndex !== -1) {
      result.splice(sectionIndex, 0, ...linesToAppend);
    } else {
      if (result.length > 0 && result[result.length - 1].trim() !== "") {
        result.push("");
      }
      result.push(...linesToAppend);
    }
  }

  await app.vault.modify(file, result.join("\n"));
}
