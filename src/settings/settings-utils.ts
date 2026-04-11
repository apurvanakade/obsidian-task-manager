/**
 * Purpose:
 * - provide settings types, defaults, and normalization behavior.
 *
 * Responsibilities:
 * - defines TaskManagerSettings shape and key aliases
 * - provides plugin defaults for first-run and missing values
 * - normalizes tag, status-field, folder-path, and file-path inputs for safe runtime usage
 *
 * Dependencies:
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure normalization helpers)
 *
 * Notes:
 * - Supports file-path settings for Inbox File and Tasks Summary File.
 */
export type TaskManagerSettings = {
  nextActionTag: string;
  statusField: string;
  projectsFolder: string;
  completedProjectsFolder: string;
  waitingProjectsFolder: string;
  somedayMaybeProjectsFolder: string;
  inboxFile: string;
  tasksSummaryFile: string;
  dashboardHideKeywords: string;
};

export type FolderSettingKey = keyof Pick<
  TaskManagerSettings,
  "projectsFolder" | "completedProjectsFolder" | "waitingProjectsFolder" | "somedayMaybeProjectsFolder" | "inboxFile" | "tasksSummaryFile"
>;

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  nextActionTag: "#next-action",
  statusField: "status",
  projectsFolder: "",
  completedProjectsFolder: "",
  waitingProjectsFolder: "",
  somedayMaybeProjectsFolder: "",
  inboxFile: "",
  tasksSummaryFile: "Tasks Summary.md",
  dashboardHideKeywords: "",
};

function normalizeTag(tag: string | null | undefined): string {
  const trimmedTag = String(tag || "").trim();
  if (!trimmedTag) {
    return DEFAULT_SETTINGS.nextActionTag;
  }

  return trimmedTag.startsWith("#") ? trimmedTag : `#${trimmedTag}`;
}

function normalizeStatusField(field: string | null | undefined): string {
  const trimmedField = String(field || "").trim();
  return trimmedField || DEFAULT_SETTINGS.statusField;
}

function normalizeFolder(folder: string | null | undefined): string {
  return String(folder || "").trim().replace(/^\/+|\/+$/g, "");
}

export function normalizeSettings(rawSettings: Partial<TaskManagerSettings>): TaskManagerSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    nextActionTag: normalizeTag(rawSettings.nextActionTag),
    statusField: normalizeStatusField(rawSettings.statusField),
    projectsFolder: normalizeFolder(rawSettings.projectsFolder),
    completedProjectsFolder: normalizeFolder(rawSettings.completedProjectsFolder),
    waitingProjectsFolder: normalizeFolder(rawSettings.waitingProjectsFolder),
    somedayMaybeProjectsFolder: normalizeFolder(rawSettings.somedayMaybeProjectsFolder),
    inboxFile: normalizeFolder(rawSettings.inboxFile),
    tasksSummaryFile: normalizeFolder(rawSettings.tasksSummaryFile) || DEFAULT_SETTINGS.tasksSummaryFile,
    dashboardHideKeywords: String(rawSettings.dashboardHideKeywords ?? ""),
  };
}
