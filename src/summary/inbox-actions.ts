/**
 * Purpose:
 * - move selected Inbox task lines into a project: either bundled into a brand-new
 *   project (via AddProjectModal, prefilled) or appended onto an existing one.
 *
 * Responsibilities:
 * - removeInboxLines(): re-reads the Inbox file fresh and strips exact-matching task
 *   lines, skipping (and reporting via Notice) any that no longer match — e.g. a line
 *   edited or already removed elsewhere between the Tasks Summary snapshot and the
 *   button click
 * - appendTasksToProject(): inserts task lines into an existing project file's open-task
 *   area, immediately above "## Completed Tasks" if present, else at the end of the file
 *
 * Dependencies:
 * - Obsidian vault/Notice APIs, normalized plugin settings, the shared
 *   "## Completed Tasks" header constant from task-utils.ts
 *
 * Side Effects:
 * - reads and writes markdown files in the vault; shows a Notice when a line can't be
 *   removed
 */
import { App, Notice, TFile } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";
import { COMPLETED_SECTION_HEADER } from "../tasks/task-utils";

/**
 * Removes exact-matching task lines from the configured Inbox File. Re-reads the file
 * fresh (never from a cached snapshot) so a line that was edited or already removed
 * elsewhere is safely skipped rather than corrupting an unrelated line. If a duplicate
 * line appears more than once in the file, at most one occurrence is removed per
 * matching entry in `linesToRemove` — an accepted v1 limitation for identical-text
 * duplicates.
 */
export async function removeInboxLines(app: App, settings: TaskManagerSettings, linesToRemove: string[]): Promise<void> {
  if (!settings.inboxFile || linesToRemove.length === 0) {
    return;
  }

  const inboxFile = app.vault.getAbstractFileByPath(settings.inboxFile);
  if (!(inboxFile instanceof TFile)) {
    return;
  }

  const content = await app.vault.read(inboxFile);
  const lines = content.split(/\r?\n/);
  const pending = [...linesToRemove];
  const keptLines: string[] = [];
  let removedCount = 0;

  for (const line of lines) {
    const pendingIndex = pending.indexOf(line);
    if (pendingIndex !== -1) {
      pending.splice(pendingIndex, 1);
      removedCount += 1;
      continue;
    }

    keptLines.push(line);
  }

  await app.vault.modify(inboxFile, keptLines.join("\n"));

  if (pending.length > 0) {
    new Notice(`${pending.length} inbox task(s) had already changed and were left in place.`);
  } else if (removedCount === 0) {
    // Nothing matched at all — surface it rather than silently no-opping.
    new Notice("Selected inbox task(s) had already changed and were left in place.");
  }
}

/**
 * Inserts task lines into `file`'s open-task area: immediately above the
 * "## Completed Tasks" heading if present, otherwise at the end of the file.
 */
export async function appendTasksToProject(app: App, file: TFile, linesToAppend: string[]): Promise<void> {
  if (linesToAppend.length === 0) {
    return;
  }

  const content = await app.vault.read(file);
  const lines = content.split(/\r?\n/);
  const sectionIndex = lines.findIndex((line) => line.trim() === COMPLETED_SECTION_HEADER);

  const result = [...lines];
  if (sectionIndex !== -1) {
    result.splice(sectionIndex, 0, ...linesToAppend);
  } else {
    if (result.length > 0 && result[result.length - 1].trim() !== "") {
      result.push("");
    }
    result.push(...linesToAppend);
  }

  await app.vault.modify(file, result.join("\n"));
}
