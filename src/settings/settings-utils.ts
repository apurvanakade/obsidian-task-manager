/**
 * Purpose:
 * - provide settings types, defaults, and normalization behavior.
 *
 * Responsibilities:
 * - defines TaskManagerSettings shape and key aliases
 * - provides plugin defaults for first-run and missing values
 * - normalizes status-field, folder-path, and file-path inputs for safe runtime usage
 *
 * Dependencies:
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure normalization helpers)
 *
 * Notes:
 * - Supports a file-path setting for Inbox File.
 */
export type TaskManagerSettings = {
  statusField: string;
  projectsFolder: string;
  completedProjectsFolder: string;
  waitingProjectsFolder: string;
  somedayMaybeProjectsFolder: string;
  scheduledProjectsFolder: string;
  archivedProjectsFolder: string;
  inboxFile: string;
  dashboardHideKeywords: string;
  somedayMaybeReviewCadenceDays: string;
  waitingStalenessThresholdDays: string;
  basesFilePath: string;
  boardFilePath: string;
};

export type FolderSettingKey = keyof Pick<
  TaskManagerSettings,
  "projectsFolder" | "completedProjectsFolder" | "waitingProjectsFolder" | "somedayMaybeProjectsFolder" | "scheduledProjectsFolder" | "archivedProjectsFolder" | "inboxFile"
>;

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  statusField: "status",
  projectsFolder: "",
  completedProjectsFolder: "",
  waitingProjectsFolder: "",
  somedayMaybeProjectsFolder: "",
  scheduledProjectsFolder: "",
  archivedProjectsFolder: "",
  inboxFile: "",
  dashboardHideKeywords: "",
  somedayMaybeReviewCadenceDays: "30",
  waitingStalenessThresholdDays: "7",
  basesFilePath: "Tasks/Tasks.base",
  boardFilePath: "Tasks/Board.canvas",
};

function normalizeStatusField(field: string | null | undefined): string {
  const trimmedField = String(field || "").trim();
  return trimmedField || DEFAULT_SETTINGS.statusField;
}

function normalizeFolder(folder: string | null | undefined): string {
  return String(folder || "").trim().replace(/^\/+|\/+$/g, "");
}

function normalizePositiveIntegerString(value: string | null | undefined, fallback: string): string {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : fallback;
}

export function normalizeSettings(rawSettings: Partial<TaskManagerSettings>): TaskManagerSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    statusField: normalizeStatusField(rawSettings.statusField),
    projectsFolder: normalizeFolder(rawSettings.projectsFolder),
    completedProjectsFolder: normalizeFolder(rawSettings.completedProjectsFolder),
    waitingProjectsFolder: normalizeFolder(rawSettings.waitingProjectsFolder),
    somedayMaybeProjectsFolder: normalizeFolder(rawSettings.somedayMaybeProjectsFolder),
    scheduledProjectsFolder: normalizeFolder(rawSettings.scheduledProjectsFolder),
    archivedProjectsFolder: normalizeFolder(rawSettings.archivedProjectsFolder),
    inboxFile: normalizeFolder(rawSettings.inboxFile),
    dashboardHideKeywords: String(rawSettings.dashboardHideKeywords ?? ""),
    somedayMaybeReviewCadenceDays: normalizePositiveIntegerString(rawSettings.somedayMaybeReviewCadenceDays, DEFAULT_SETTINGS.somedayMaybeReviewCadenceDays),
    waitingStalenessThresholdDays: normalizePositiveIntegerString(rawSettings.waitingStalenessThresholdDays, DEFAULT_SETTINGS.waitingStalenessThresholdDays),
    basesFilePath: normalizeFolder(rawSettings.basesFilePath) || DEFAULT_SETTINGS.basesFilePath,
    boardFilePath: normalizeFolder(rawSettings.boardFilePath) || DEFAULT_SETTINGS.boardFilePath,
  };
}
