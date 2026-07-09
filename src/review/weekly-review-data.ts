/**
 * Purpose:
 * - pure(ish) data collection for the Weekly Review view: stale Waiting items and
 *   Someday-Maybe items due for review.
 *
 * Responsibilities:
 * - scans the configured Waiting/Someday-Maybe folders
 * - computes days-waiting / days-since-review staleness from frontmatter timestamps
 * - sorts each list most-overdue-first, with never-stamped items sorting first
 * - stamps the `reviewed` frontmatter field (the one write operation in this module)
 *
 * Dependencies:
 * - Obsidian vault/file-manager APIs, shared date-utils, summary-file-io folder scan,
 *   and task-processor.ts's WAITING_SINCE_FRONTMATTER_FIELD
 *
 * Side Effects:
 * - reads markdown files from the vault; stampReviewedDate() writes frontmatter
 */
import { App, TFile } from "obsidian";
import { crossesThresholdWithinCurrentWeek, getTodayDateString, parseIsoDate } from "../date/date-utils";
import { isInFolder } from "../summary/summary-file-io";
import { readFrontmatterField } from "../tasks/frontmatter-utils";
import { WAITING_SINCE_FRONTMATTER_FIELD } from "../tasks/task-processor";
import { TaskManagerSettings } from "../settings/settings-utils";

export const REVIEWED_FRONTMATTER_FIELD = "reviewed";

export type WaitingReviewRow = {
  file: TFile;
  waitingSince: string | null;
  daysWaiting: number | null;
  /** Crosses the configured staleness threshold within the current (Sun-ending) week. */
  isNewlyStale: boolean;
};

export type SomedayReviewRow = {
  file: TFile;
  reviewed: string | null;
  daysSinceReview: number | null;
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
      waitingSince,
      daysWaiting: daysBetween(waitingSince, today),
      isNewlyStale: waitingSince !== null && crossesThresholdWithinCurrentWeek(waitingSince, thresholdDays),
    });
  }

  return rows.sort(compareByStaleness((row) => row.daysWaiting));
}

export async function collectSomedayReviewRows(app: App, settings: TaskManagerSettings): Promise<SomedayReviewRow[]> {
  const folderPath = settings.somedayMaybeProjectsFolder;
  if (!folderPath) {
    return [];
  }

  const cadenceDays = Number.parseInt(settings.somedayMaybeReviewCadenceDays, 10);
  const today = getTodayDateString();
  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows: SomedayReviewRow[] = [];

  for (const file of files) {
    const content = await app.vault.read(file);
    const reviewed = readFrontmatterField(content, REVIEWED_FRONTMATTER_FIELD);
    const daysSinceReview = daysBetween(reviewed, today);
    rows.push({
      file,
      reviewed,
      daysSinceReview,
      needsReview: daysSinceReview === null || daysSinceReview >= cadenceDays,
    });
  }

  return rows.sort(compareByStaleness((row) => row.daysSinceReview));
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
