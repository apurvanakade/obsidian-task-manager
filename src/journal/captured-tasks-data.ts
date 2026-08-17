/**
 * Purpose:
 * - collect open captured-task rows from daily notes for the "Organize Captured Tasks
 *   into Projects" tab.
 *
 * Responsibilities:
 * - resolves the Journal folder from Obsidian's core Daily Notes plugin config
 * - scans every daily note (filename YYYY-MM-DD) within today ± CAPTURE_SCAN_WINDOW_DAYS
 * - reads every open task line in each candidate file (not scoped to any section — a
 *   daily note's open checkboxes anywhere are fair game for organizing into projects,
 *   not just ones inserted via Quick Capture)
 * - each row carries the exact raw task line text and its source file, used by
 *   captured-tasks-actions.ts to find-and-remove the original line per-file
 *
 * Dependencies:
 * - Obsidian vault APIs, daily-note-config.ts for the Journal folder, date-utils.ts for
 *   the window bound
 *
 * Side Effects:
 * - reads files from the vault (no writes — rendering lives in captured-tasks-view.ts)
 */
import { App, TFile } from "obsidian";
import { addDaysToDateString, getTodayDateString } from "../date/date-utils";
import { readFilePriority } from "../tasks/file-priority";
import { cleanTaskText, getRecurrenceLabel, parseTaskLine, readInlineFieldValue } from "../tasks/task-line-metadata";
import { getDailyNotesConfig } from "./daily-note-config";

const DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;
const DAILY_NOTE_FILENAME_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** How far before/after today to scan daily notes for open tasks — a fixed bound, not a setting. */
const CAPTURE_SCAN_WINDOW_DAYS = 365;

export type CapturedTaskRow = {
  file: TFile;
  /** The source daily note's date (its basename), e.g. "2026-08-16". */
  date: string;
  task: string;
  dueDate: string | null;
  priority: number;
  recurrence: string;
  /** The exact, unmodified task line text — used to find-and-remove the original line. */
  rawLine: string;
};

/** True when `file` is a daily note within the configured Journal folder and the scan window. */
export function isCapturedTaskFile(app: App, file: TFile): boolean {
  const config = getDailyNotesConfig(app);
  if (!config?.folder || !file.path.startsWith(`${config.folder}/`)) {
    return false;
  }
  if (!DAILY_NOTE_FILENAME_REGEX.test(file.basename)) {
    return false;
  }

  const today = getTodayDateString();
  const windowStart = addDaysToDateString(today, -CAPTURE_SCAN_WINDOW_DAYS) ?? today;
  const windowEnd = addDaysToDateString(today, CAPTURE_SCAN_WINDOW_DAYS) ?? today;
  return file.basename >= windowStart && file.basename <= windowEnd;
}

function getCapturedTaskCandidateFiles(app: App): TFile[] {
  return app.vault.getMarkdownFiles().filter((file) => isCapturedTaskFile(app, file));
}

export async function collectCapturedTaskRows(app: App): Promise<CapturedTaskRow[]> {
  const files = getCapturedTaskCandidateFiles(app);
  const rows: CapturedTaskRow[] = [];

  for (const file of files) {
    const content = await app.vault.read(file);
    const priority = readFilePriority(content);
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const parsedTask = parseTaskLine(line);
      if (!parsedTask || parsedTask.status !== "open") {
        continue;
      }

      rows.push({
        file,
        date: file.basename,
        task: cleanTaskText(parsedTask.taskBody),
        dueDate: readInlineFieldValue(parsedTask.taskBody, DUE_FIELD_REGEX),
        priority,
        recurrence: getRecurrenceLabel(parsedTask.taskBody),
        rawLine: line,
      });
    }
  }

  rows.sort((left, right) => right.date.localeCompare(left.date));
  return rows;
}
