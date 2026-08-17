/**
 * Purpose:
 * - reconcile task-line transitions and apply task semantics.
 *
 * Responsibilities:
 * - detects completion/uncompletion/deletion effects from prior/current task state
 * - applies completion metadata updates and first-incomplete-task status updates
 * - inserts/updates recurring follow-up tasks based on repeat fields
 * - triggers due-date collection behavior for newly exposed first incomplete tasks
 *
 * Dependencies:
 * - task utilities, status helpers, and due-date modal callback integration
 *
 * Side Effects:
 * - returns updated content/state and can trigger modal-driven async due-date writes
 */
import { App, Notice, TFile } from "obsidian";
import { getCurrentDateString, getCurrentTimeString } from "../date/date-utils";
import { FilePriority, readFilePriority } from "./file-priority";
import { parseTaskLine, parseTaskLineStructured, readInlineFieldValue } from "./task-line-metadata";
import { findActionableTaskLines } from "./next-actions";
import {
  DUE_FIELD_REGEX,
  findFirstIncompleteTaskLine,
  findNoteBlockEnd,
  moveTaskToCompletedSection
} from "./task-utils";
import { TaskManagerSettings } from "../settings/settings-utils";
import { readStatusValue } from "../routing/status-routing";
import { DueDateModal } from "./due-date-modal";
import { getNextRepeatDate, getRepeatFieldValue, parseRepeatRule } from "./repeat-rules";

type ReconcilerContext = {
  file: TFile;
  settings: TaskManagerSettings;
  readFile: (file: TFile) => Promise<string>;
  writeFileContent: (file: TFile, content: string) => Promise<void>;
  setFileStatus: (file: TFile, status: string) => Promise<void>;
  setFilePriority: (file: TFile, priority: FilePriority) => Promise<void>;
  setTaskState: (filePath: string, content: string) => void;
  onTaskPropertiesChanged?: () => Promise<void>;
  app?: App;
};

type CompletionContext = ReconcilerContext & {
  content: string;
  completedLine: number;
};

type UncompletionContext = ReconcilerContext & {
  content: string;
  uncompletedLine: number;
};

async function showDueDateModalForFirstIncompleteTask(
  file: TFile,
  taskLineIndex: number,
  updatedContent: string,
  context: ReconcilerContext
): Promise<void> {
  const { app, readFile, writeFileContent, setTaskState } = context;

  if (!app) {
    return;
  }

  const lines = updatedContent.split(/\r?\n/);
  const taskLine = lines[taskLineIndex];
  if (!taskLine) {
    return;
  }

  // Skip if task is repeating (it already has a due date assigned)
  const isRepeating = parseRepeatRule(taskLine) !== null;
  if (isRepeating) {
    return;
  }

  const modalContent = await readFile(file);
  const initialPriority = String(readFilePriority(modalContent)) as "1" | "2" | "3";
  const initialDueDateMatch = taskLine.match(/\[due::\s*([^\]]*?)\s*\]/i);
  const initialDueDate = initialDueDateMatch ? initialDueDateMatch[1].trim() : null;
  // Prefilling surfaces an existing-but-unparseable repeat value for repair — the modal
  // only opens for lines whose repeat field is absent or failed to parse (see the
  // isRepeating check above), so a parseable repeat never reaches here.
  const initialRepeat = getRepeatFieldValue(taskLine);

  const modal = new DueDateModal({
    app,
    taskLine,
    taskLineIndex,
    initialPriority,
    initialDueDate,
    initialRepeat,
    onSubmit: async (targetLineIndex, taskLine, dueDate, priority, repeat) => {
      // Validate date format
      if (!isValidDateFormat(dueDate)) {
        return;
      }

      const currentContent = await readFile(file);
      const updatedLines = currentContent.split(/\r?\n/);

      // Prefer the line index captured when the modal opened; it's only trustworthy if
      // that line is still an open task line. Otherwise fall back to matching the exact
      // original line text, since content may have shifted during the async modal gap.
      let targetIndex: number | null = null;
      if (targetLineIndex < updatedLines.length && parseTaskLine(updatedLines[targetLineIndex])?.status === "open") {
        targetIndex = targetLineIndex;
      } else {
        const fallbackIndex = updatedLines.indexOf(taskLine);
        targetIndex = fallbackIndex === -1 ? null : fallbackIndex;
      }

      if (targetIndex === null) {
        new Notice(`Could not find "${taskLine.trim()}" in ${file.name}; the due date was not saved.`);
        return;
      }

      // Check if task already has a due date
      if (updatedLines[targetIndex].includes("[due::")) {
        updatedLines[targetIndex] = updatedLines[targetIndex].replace(/\[due::\s*[^\]]*\]/g, `[due:: ${dueDate}]`);
      } else {
        updatedLines[targetIndex] = `${updatedLines[targetIndex].trimEnd()} [due:: ${dueDate}]`;
      }

      if (repeat !== null) {
        if (updatedLines[targetIndex].match(/\[(?:repeat|repeats)::\s*[^\]]*\]/i)) {
          updatedLines[targetIndex] = updatedLines[targetIndex].replace(/\[(?:repeat|repeats)::\s*[^\]]*\]/gi, `[repeat:: ${repeat}]`);
        } else {
          updatedLines[targetIndex] = `${updatedLines[targetIndex].trimEnd()} [repeat:: ${repeat}]`;
        }
      }

      const nextContent = updatedLines.join("\n");
      await writeFileContent(file, nextContent);
      await context.setFilePriority(file, Number.parseInt(priority, 10) as FilePriority);
      setTaskState(file.path, nextContent);
      await context.onTaskPropertiesChanged?.();
    },
  });
  modal.open();
}

export async function applyCompletionRules(context: CompletionContext): Promise<void> {
  const { file, content, completedLine, writeFileContent, setFileStatus, setTaskState, settings } = context;
  const lines = content.split(/\r?\n/);
  const nextLines = [...lines];
  const sourceTaskLine = lines[completedLine];
  let completedLineIndex = completedLine;

  // Snapshot what was actionable immediately before this completion (the completed
  // line is still "x" in `lines` at this point, so temporarily force it back open to
  // reconstruct the pre-completion view) — used below to find newly-promoted tasks.
  const previousLines = [...lines];
  previousLines[completedLine] = forceLineOpen(previousLines[completedLine]);
  const previousActionableLines = findActionableTaskLines(previousLines);
  const wasCompletedLineActionable = previousActionableLines.includes(completedLine);
  const previousActionableBodies = new Set(
    previousActionableLines
      .filter((index) => index !== completedLine)
      .map((index) => getLineBody(previousLines[index])),
  );

  const repeatFieldValue = getRepeatFieldValue(sourceTaskLine);
  if (repeatFieldValue !== null) {
    const repeatRule = parseRepeatRule(sourceTaskLine);
    if (repeatRule === null) {
      new Notice(`Unrecognized repeat rule "${repeatFieldValue}" — no recurring copy created.`);
    } else {
      const previousDueDate = readInlineFieldValue(sourceTaskLine, DUE_FIELD_REGEX);
      const nextDate = getNextRepeatDate(repeatRule, { previousDueDate });
      if (nextDate === null) {
        new Notice(`Recurrence ended (until ${repeatRule.until}) — no new copy created.`);
      } else {
        const repeatedTaskLine = buildRepeatedTaskLine(sourceTaskLine, nextDate);
        if (repeatedTaskLine !== null) {
          // Move the completed task's note block (see Task Notes in CLAUDE.md) onto the
          // new occurrence instead of duplicating it — a note attached to a recurring task
          // is usually reusable instructions/context for the task itself, not a record of
          // this specific completion, so it belongs with the next occurrence, not this one.
          const noteBlockEnd = findNoteBlockEnd(lines, completedLine);
          const noteBlockLines = lines.slice(completedLine + 1, noteBlockEnd);
          const repeatedBlock = [repeatedTaskLine, ...noteBlockLines];
          nextLines.splice(completedLine, 0, ...repeatedBlock);
          completedLineIndex += repeatedBlock.length;
          if (noteBlockLines.length > 0) {
            // The original note block is still sitting just below the completed task's
            // shifted position (untouched by the splice above) — remove it from there now
            // that a copy lives with the new occurrence, so it isn't left on both.
            nextLines.splice(completedLineIndex + 1, noteBlockLines.length);
          }
        }
      }
    }
  }

  // Stamp completion metadata on the completed task.
  nextLines[completedLineIndex] = addCompletionFields(nextLines[completedLineIndex]);

  let workingLines = nextLines;
  const newStatus = findFirstIncompleteTaskLine(workingLines) === null ? "completed" : "todo";

  // Move the stamped completed task into the "## Completed Tasks" section.
  // completedLineIndex may have shifted if a recurring task was inserted above it,
  // so search for the exact stamped line to get the current index.
  const stampedLine = workingLines[completedLineIndex];
  const actualCompletedLineIndex = workingLines.indexOf(stampedLine, completedLineIndex);
  if (actualCompletedLineIndex !== -1) {
    workingLines = moveTaskToCompletedSection(workingLines, actualCompletedLineIndex);
  }

  const updatedContent = workingLines.join("\n");

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, newStatus);
  setTaskState(file.path, updatedContent);

  // Only pop the modal when completing this task actually promoted a new actionable
  // task (i.e. the completed task was itself actionable, and the task that's actionable
  // now wasn't before).
  if (wasCompletedLineActionable) {
    const finalActionableLines = findActionableTaskLines(workingLines);
    const newlyActionableLine = finalActionableLines.find(
      (index) => !previousActionableBodies.has(getLineBody(workingLines[index])),
    );

    if (newlyActionableLine !== undefined) {
      await showDueDateModalForFirstIncompleteTask(file, newlyActionableLine, updatedContent, context);
    }
  }
}

export async function applyUncompletionRules(context: UncompletionContext): Promise<void> {
  const { file, content, uncompletedLine, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  // Reopened tasks must lose completion metadata.
  lines[uncompletedLine] = stripCompletionFields(lines[uncompletedLine]);
  const workingLines = lines;
  const isActionable = findActionableTaskLines(workingLines).includes(uncompletedLine);

  const updatedContent = workingLines.join("\n");
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, "todo");
  setTaskState(file.path, updatedContent);

  if (isActionable) {
    await showDueDateModalForFirstIncompleteTask(file, uncompletedLine, updatedContent, context);
  }
}

export async function reconcileFile(context: ReconcilerContext): Promise<void> {
  const { file, settings, readFile, writeFileContent, setFileStatus, setTaskState } = context;
  const content = await readFile(file);
  const currentStatus = readStatusValue(content, settings.statusField);
  const lines = content
    .split(/\r?\n/)
    .map((line) => {
      const structured = parseTaskLineStructured(line);
      if (!structured || structured.status === "completed") {
        return line;
      }

      // Open tasks should never keep completion metadata when reconciled.
      return stripCompletionFields(line);
    });
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(lines);
  const updatedContent = lines.join("\n");
  let nextStatus: string | null = "completed";

  if (firstIncompleteTaskLine !== null) {
    nextStatus = currentStatus !== null && currentStatus !== "completed" ? null : "todo";
  }

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  if (nextStatus !== null) {
    await setFileStatus(file, nextStatus);
  }
  setTaskState(file.path, updatedContent);
}

export function getCompletionDateString(): string {
  return getCurrentDateString();
}

export function getCompletionTimeString(): string {
  return getCurrentTimeString();
}

function addCompletionFields(line: string): string {
  const cleaned = stripCompletionFields(line);
  return `${cleaned} [completion-date:: ${getCompletionDateString()}] [completion-time:: ${getCompletionTimeString()}]`;
}

function stripCompletionFields(line: string): string {
  return line
    .replace(/\s*\[completion-date::[^\]]*\]/g, "")
    .replace(/\s*\[completion-time::[^\]]*\]/g, "");
}

/** Forces a checkbox line back to its open ("[ ]") form, preserving prefix/body. */
function forceLineOpen(line: string): string {
  const structured = parseTaskLineStructured(line);
  if (!structured || structured.status === "open") {
    return line;
  }

  return `${structured.prefix} ${structured.bracketSuffix}${structured.body}`;
}

/** Task body (post-checkbox text), used to compare task identity across line-index shifts. */
function getLineBody(line: string): string {
  return parseTaskLineStructured(line)?.body ?? line;
}

function buildRepeatedTaskLine(completedLine: string, nextDueDate: string): string | null {
  const cleaned = stripCompletionFields(completedLine);
  const structured = parseTaskLineStructured(cleaned);
  if (!structured) {
    return null;
  }

  const openTask = `${structured.prefix} ${structured.bracketSuffix}${structured.body}`;
  const taskBodyWithoutDue = openTask.replace(/\s*\[due::\s*[^\]]*\]/g, "").trimEnd();
  return `${taskBodyWithoutDue} [due:: ${nextDueDate}]`;
}

function isValidDateFormat(dateStr: string): boolean {
  const trimmed = dateStr.trim();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(trimmed)) {
    return false;
  }

  const date = new Date(trimmed + "T00:00:00Z");
  return !isNaN(date.getTime());
}
