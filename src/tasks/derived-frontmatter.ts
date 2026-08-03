/**
 * Purpose:
 * - derive Bases/Dataview-visible frontmatter fields from a project file's task lines.
 *
 * Responsibilities:
 * - computes next-due / next-action / open-tasks from file content
 * - compares computed fields against a file's existing frontmatter for idempotent stamping
 * - applies computed fields onto a frontmatter object during processFrontMatter
 *
 * Dependencies:
 * - task-utils.ts (findFirstIncompleteTaskLine, getFirstTaskDueDate)
 * - task-line-metadata.ts (parseTaskLineStructured, cleanTaskText)
 * - frontmatter-utils.ts (readFrontmatterField)
 *
 * Side Effects:
 * - none (pure)
 *
 * Notes:
 * - The task line remains the single source of truth for due dates/next actions; these
 *   fields are a read-only mirror into frontmatter so file-level tools (Bases, Dataview,
 *   search) can see task-level data they otherwise can't reach. TaskProcessor recomputes
 *   and re-stamps them on every relevant modify pass — see stampDerivedFrontmatter().
 */
import { findFirstIncompleteTaskLine, getFirstTaskDueDate } from "./task-utils";
import { cleanTaskText, parseTaskLineStructured } from "./task-line-metadata";
import { readFrontmatterField } from "./frontmatter-utils";

export const NEXT_DUE_FIELD = "next-due";
export const NEXT_ACTION_FIELD = "next-action";
export const OPEN_TASKS_FIELD = "open-tasks";

export type DerivedFields = {
  nextDue: string | null;
  nextAction: string | null;
  openTasks: number;
};

export function computeDerivedFields(content: string): DerivedFields {
  const lines = content.split(/\r?\n/);
  const firstIncompleteIndex = findFirstIncompleteTaskLine(lines);
  const nextActionBody = firstIncompleteIndex !== null
    ? parseTaskLineStructured(lines[firstIncompleteIndex])?.body ?? null
    : null;
  const nextAction = nextActionBody !== null ? cleanTaskText(nextActionBody) || null : null;

  let openTasks = 0;
  for (const line of lines) {
    const structured = parseTaskLineStructured(line);
    if (structured && structured.status === "open") {
      openTasks += 1;
    }
  }

  return {
    nextDue: getFirstTaskDueDate(content),
    nextAction,
    openTasks,
  };
}

/**
 * Compares computed fields against what's already stamped in `content`'s frontmatter.
 * The idempotency gate that keeps stampDerivedFrontmatter() from writing (and therefore
 * from re-triggering a modify pass) when nothing actually changed.
 */
export function derivedFieldsMatchContent(content: string, fields: DerivedFields): boolean {
  const currentNextDue = normalizeStoredValue(readFrontmatterField(content, NEXT_DUE_FIELD));
  const currentNextAction = normalizeStoredValue(readFrontmatterField(content, NEXT_ACTION_FIELD));
  const currentOpenTasks = normalizeStoredValue(readFrontmatterField(content, OPEN_TASKS_FIELD));

  return (
    currentNextDue === normalizeStoredValue(fields.nextDue) &&
    currentNextAction === normalizeStoredValue(fields.nextAction) &&
    currentOpenTasks === String(fields.openTasks)
  );
}

export function applyDerivedFields(frontmatter: Record<string, unknown>, fields: DerivedFields): void {
  if (fields.nextDue) {
    frontmatter[NEXT_DUE_FIELD] = fields.nextDue;
  } else {
    delete frontmatter[NEXT_DUE_FIELD];
  }

  if (fields.nextAction) {
    frontmatter[NEXT_ACTION_FIELD] = fields.nextAction;
  } else {
    delete frontmatter[NEXT_ACTION_FIELD];
  }

  frontmatter[OPEN_TASKS_FIELD] = fields.openTasks;
}

function normalizeStoredValue(value: string | null): string {
  return (value ?? "").trim();
}
