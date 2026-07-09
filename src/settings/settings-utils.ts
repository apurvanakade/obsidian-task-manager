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
 * - Supports file-path settings for Inbox File, Tasks Summary File, and Project Summary File.
 */
export type TaskManagerSettings = {
  statusField: string;
  projectsFolder: string;
  completedProjectsFolder: string;
  waitingProjectsFolder: string;
  somedayMaybeProjectsFolder: string;
  inboxFile: string;
  tasksSummaryFile: string;
  projectSummaryFile: string;
  openSummaryAfterGeneration: boolean;
  dashboardHideKeywords: string;
  knownContexts: string;
  enableMultipleNextActions: boolean;
  somedayMaybeReviewCadenceDays: string;
  waitingStalenessThresholdDays: string;
};

export type FolderSettingKey = keyof Pick<
  TaskManagerSettings,
  "projectsFolder" | "completedProjectsFolder" | "waitingProjectsFolder" | "somedayMaybeProjectsFolder" | "inboxFile" | "tasksSummaryFile" | "projectSummaryFile"
>;

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  statusField: "status",
  projectsFolder: "",
  completedProjectsFolder: "",
  waitingProjectsFolder: "",
  somedayMaybeProjectsFolder: "",
  inboxFile: "",
  tasksSummaryFile: "Tasks Summary.md",
  projectSummaryFile: "Project Summary.md",
  openSummaryAfterGeneration: false,
  dashboardHideKeywords: "",
  knownContexts: "",
  enableMultipleNextActions: false,
  somedayMaybeReviewCadenceDays: "30",
  waitingStalenessThresholdDays: "7",
};

function normalizeStatusField(field: string | null | undefined): string {
  const trimmedField = String(field || "").trim();
  return trimmedField || DEFAULT_SETTINGS.statusField;
}

function normalizeFolder(folder: string | null | undefined): string {
  return String(folder || "").trim().replace(/^\/+|\/+$/g, "");
}

function normalizeBoolean(value: boolean | null | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
    inboxFile: normalizeFolder(rawSettings.inboxFile),
    tasksSummaryFile: normalizeFolder(rawSettings.tasksSummaryFile) || DEFAULT_SETTINGS.tasksSummaryFile,
    projectSummaryFile: normalizeFolder(rawSettings.projectSummaryFile) || DEFAULT_SETTINGS.projectSummaryFile,
    openSummaryAfterGeneration: normalizeBoolean(rawSettings.openSummaryAfterGeneration, DEFAULT_SETTINGS.openSummaryAfterGeneration),
    dashboardHideKeywords: String(rawSettings.dashboardHideKeywords ?? ""),
    knownContexts: String(rawSettings.knownContexts ?? ""),
    enableMultipleNextActions: normalizeBoolean(rawSettings.enableMultipleNextActions, DEFAULT_SETTINGS.enableMultipleNextActions),
    somedayMaybeReviewCadenceDays: normalizePositiveIntegerString(rawSettings.somedayMaybeReviewCadenceDays, DEFAULT_SETTINGS.somedayMaybeReviewCadenceDays),
    waitingStalenessThresholdDays: normalizePositiveIntegerString(rawSettings.waitingStalenessThresholdDays, DEFAULT_SETTINGS.waitingStalenessThresholdDays),
  };
}
