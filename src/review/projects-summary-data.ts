/**
 * Purpose:
 * - pure(ish) data collection for the Projects Summary view: stale Waiting items,
 *   review-staleness for Active Projects and Someday-Maybe items, and upcoming
 *   Scheduled (tickler) items.
 *
 * Responsibilities:
 * - scans the configured Projects/Waiting/Someday-Maybe/Scheduled folders
 * - computes days-waiting / days-since-review / days-until staleness from frontmatter
 *   timestamps
 * - sorts each list most-overdue-first (Scheduled: soonest-first), with
 *   never-stamped items sorting first (Scheduled: last, since there's no date to act on)
 * - stamps the `reviewed` frontmatter field, and promotes a Scheduled item to `todo`
 *   ahead of its date (the two write operations in this module)
 *
 * Dependencies:
 * - Obsidian vault/file-manager APIs, shared date-utils, summary-file-io folder scan,
 *   task-processor.ts's WAITING_SINCE_FRONTMATTER_FIELD, and task-utils.ts's
 *   getFirstTaskDueDate() (Scheduled's promotion date, derived from the first task's
 *   due date rather than a separate frontmatter field)
 *
 * Side Effects:
 * - reads markdown files from the vault; stampReviewedDate()/promoteScheduledFileNow()
 *   write frontmatter
 */
import { App, TFile } from "obsidian";
import { crossesThresholdWithinCurrentWeek, getTodayDateString, parseIsoDate } from "../date/date-utils";
import { isInFolder } from "../summary/summary-file-io";
import { readFrontmatterField } from "../tasks/frontmatter-utils";
import { FilePriority, readFilePriority } from "../tasks/file-priority";
import { getFirstTaskDueDate } from "../tasks/task-utils";
import { WAITING_SINCE_FRONTMATTER_FIELD } from "../tasks/task-processor";
import { TaskManagerSettings } from "../settings/settings-utils";

export const REVIEWED_FRONTMATTER_FIELD = "reviewed";

export type WaitingReviewRow = {
  file: TFile;
  priority: FilePriority;
  waitingSince: string | null;
  daysWaiting: number | null;
  /** Crosses the configured staleness threshold within the current (Sun-ending) week. */
  isNewlyStale: boolean;
};

export type ReviewRow = {
  file: TFile;
  priority: FilePriority;
  reviewed: string | null;
  daysSinceReview: number | null;
};

export type SomedayReviewRow = ReviewRow & {
  /** Never reviewed, or past the configured review cadence. */
  needsReview: boolean;
};

export async function collectWaitingReviewRows(app: App, settings: TaskManagerSettings): Promise<WaitingReviewRow[]> {
  const folderPath = settings.waitingProjectsFolder;
  if (!folderPath) {
    return [];
  }

  const thresholdDays = Number.parseInt(settings.waitingStalenessThresholdDays, 10);
  const today = getTodayDateString();
  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows: WaitingReviewRow[] = [];

  for (const file of files) {
    const content = await app.vault.read(file);
    const waitingSince = readFrontmatterField(content, WAITING_SINCE_FRONTMATTER_FIELD);
    rows.push({
      file,
      priority: readFilePriority(content),
      waitingSince,
      daysWaiting: daysBetween(waitingSince, today),
      isNewlyStale: waitingSince !== null && crossesThresholdWithinCurrentWeek(waitingSince, thresholdDays),
    });
  }

  return rows.sort(compareByStaleness((row) => row.daysWaiting));
}

/** Generic reviewed-staleness scan shared by Active Projects and Someday-Maybe. */
async function collectReviewRows(app: App, folderPath: string): Promise<ReviewRow[]> {
  if (!folderPath) {
    return [];
  }

  const today = getTodayDateString();
  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows: ReviewRow[] = [];

  for (const file of files) {
    const content = await app.vault.read(file);
    const reviewed = readFrontmatterField(content, REVIEWED_FRONTMATTER_FIELD);
    rows.push({
      file,
      priority: readFilePriority(content),
      reviewed,
      daysSinceReview: daysBetween(reviewed, today),
    });
  }

  return rows.sort(compareByStaleness((row) => row.daysSinceReview));
}

/** Every active project, sorted least-recently-reviewed first. No filtering/threshold. */
export async function collectActiveProjectReviewRows(app: App, settings: TaskManagerSettings): Promise<ReviewRow[]> {
  return collectReviewRows(app, settings.projectsFolder);
}

export async function collectSomedayReviewRows(app: App, settings: TaskManagerSettings): Promise<SomedayReviewRow[]> {
  const cadenceDays = Number.parseInt(settings.somedayMaybeReviewCadenceDays, 10);
  const rows = await collectReviewRows(app, settings.somedayMaybeProjectsFolder);

  return rows.map((row) => ({
    ...row,
    needsReview: row.daysSinceReview === null || row.daysSinceReview >= cadenceDays,
  }));
}

export type ScheduledReviewRow = {
  file: TFile;
  priority: FilePriority;
  /** The `[due:: ...]` on the file's first open task — its promotion date. */
  scheduledDate: string | null;
  /** Negative when overdue (already past its promotion window but not yet promoted). */
  daysUntil: number | null;
};

/**
 * Scheduled projects, soonest-to-arrive first. A project's date is its first open
 * task's `[due:: ...]` field (see `getFirstTaskDueDate()`) — there's no separate
 * frontmatter field. Rows with no due date on their first task (an
 * incomplete/misconfigured entry) sort last, unlike Waiting/Someday-Maybe where a
 * missing timestamp means "most stale" — here it just means "no date to act on."
 */
export async function collectScheduledReviewRows(app: App, settings: TaskManagerSettings): Promise<ScheduledReviewRow[]> {
  const folderPath = settings.scheduledProjectsFolder;
  if (!folderPath) {
    return [];
  }

  const today = getTodayDateString();
  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows: ScheduledReviewRow[] = [];

  for (const file of files) {
    const content = await app.vault.read(file);
    const scheduledDate = getFirstTaskDueDate(content);
    const daysPastScheduled = daysBetween(scheduledDate, today);
    rows.push({
      file,
      priority: readFilePriority(content),
      scheduledDate,
      daysUntil: daysPastScheduled === null ? null : -daysPastScheduled,
    });
  }

  return rows.sort((left, right) => {
    if (left.daysUntil === null && right.daysUntil === null) return 0;
    if (left.daysUntil === null) return 1;
    if (right.daysUntil === null) return -1;
    return left.daysUntil - right.daysUntil;
  });
}

/**
 * Manually promotes a scheduled project to `todo` ahead of its first task's due date.
 * The due date itself is left alone — it becomes an ordinary task due date once the
 * file is `todo`. This is a plain frontmatter write (not routed here) — the resulting
 * vault `modify` event flows through TaskProcessor.handleFileModify's normal
 * status-change routing, exactly like any other manual status edit.
 */
export async function promoteScheduledFileNow(app: App, file: TFile, settings: TaskManagerSettings): Promise<void> {
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
    frontmatter[settings.statusField] = "todo";
  });
}

export async function stampReviewedDate(app: App, file: TFile): Promise<void> {
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
    frontmatter[REVIEWED_FRONTMATTER_FIELD] = getTodayDateString();
  });
}

function daysBetween(dateString: string | null, todayString: string): number | null {
  if (!dateString) {
    return null;
  }

  const date = parseIsoDate(dateString);
  const today = parseIsoDate(todayString);
  if (!date || !today) {
    return null;
  }

  const millisPerDay = 24 * 60 * 60 * 1000;
  return Math.round((today.getTime() - date.getTime()) / millisPerDay);
}

/** Sorts most-stale first; rows with no timestamp (never stamped) sort first of all. */
function compareByStaleness<T>(getDays: (row: T) => number | null): (left: T, right: T) => number {
  return (left, right) => {
    const leftDays = getDays(left) ?? Number.POSITIVE_INFINITY;
    const rightDays = getDays(right) ?? Number.POSITIVE_INFINITY;
    return rightDays - leftDays;
  };
}
