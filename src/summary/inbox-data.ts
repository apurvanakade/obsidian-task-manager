/**
 * Purpose:
 * - collect open Inbox task rows for the Inbox tab.
 *
 * Responsibilities:
 * - reads every open task line in the configured Inbox File (not just the first — the
 *   Inbox is a flat capture list, not a project with a single actionable next action, and
 *   the inbox-to-project flow needs every capture individually selectable)
 * - each row carries the exact raw task line text (rawLine), used by inbox-actions.ts
 *   to find-and-remove the original line after it's bundled into a project
 *
 * Dependencies:
 * - Obsidian vault APIs and normalized plugin settings
 *
 * Side Effects:
 * - reads the Inbox file from the vault (no writes — rendering lives in inbox-view.ts)
 */
import { App, TFile } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";
import { readFilePriority } from "../tasks/file-priority";
import { cleanTaskText, getRecurrenceLabel, parseTaskLine, readInlineFieldValue } from "../tasks/task-line-metadata";

const DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;

export type InboxRow = {
  file: TFile;
  task: string;
  dueDate: string | null;
  priority: number;
  recurrence: string;
  /** The exact, unmodified task line text — used to find-and-remove the original line. */
  rawLine: string;
};

export async function collectInboxRows(app: App, settings: TaskManagerSettings): Promise<InboxRow[]> {
  if (!settings.inboxFile) {
    return [];
  }

  const inboxFile = app.vault.getAbstractFileByPath(settings.inboxFile);
  if (!(inboxFile instanceof TFile)) {
    return [];
  }

  const content = await app.vault.read(inboxFile);
  const priority = readFilePriority(content);
  const lines = content.split(/\r?\n/);

  const rows: InboxRow[] = [];
  for (const line of lines) {
    const parsedTask = parseTaskLine(line);
    if (!parsedTask || parsedTask.status !== "open") {
      continue;
    }

    rows.push({
      file: inboxFile,
      task: cleanTaskText(parsedTask.taskBody),
      dueDate: readInlineFieldValue(parsedTask.taskBody, DUE_FIELD_REGEX),
      priority,
      recurrence: getRecurrenceLabel(parsedTask.taskBody),
      rawLine: line,
    });
  }

  return rows;
}
