export type TaskManagerSettings = {
  nextActionTag: string;
  statusField: string;
  projectsFolder: string;
  completedProjectsFolder: string;
  waitingProjectsFolder: string;
  somedayMaybeProjectsFolder: string;
};

export const DEFAULT_SETTINGS: TaskManagerSettings = {
  nextActionTag: "#next-action",
  statusField: "status",
  projectsFolder: "",
  completedProjectsFolder: "",
  waitingProjectsFolder: "",
  somedayMaybeProjectsFolder: ""
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
    somedayMaybeProjectsFolder: normalizeFolder(rawSettings.somedayMaybeProjectsFolder)
  };
}