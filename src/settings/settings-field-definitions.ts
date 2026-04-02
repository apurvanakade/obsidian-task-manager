/**
 * Purpose:
 * - define declarative metadata for settings controls.
 *
 * Responsibilities:
 * - provides folder-setting metadata (including file-path for Inbox File)
 * - provides text-setting metadata
 * - keeps configuration shape separate from rendering logic
 *
 * Dependencies:
 * - settings type definitions from settings-utils.ts
 *
 * Side Effects:
 * - none (pure data definitions)
 *
 * Notes:
 * - Inbox File uses a file picker, not a folder picker, in settings UI.
 */
import { FolderSettingKey, TaskManagerSettings } from "./settings-utils";


export type FolderSettingConfig = {
  name: string;
  description: string;
  key: FolderSettingKey;
  value: string;
  placeholder: string;
};

export type TextSettingConfig = {
  name: string;
  description: string;
  placeholder: string;
  key: keyof Pick<TaskManagerSettings, "nextActionTag" | "statusField" | "dashboardHideKeywords">;
  value: string;
  multiLine?: boolean;
};

export function getFolderSettingConfigs(settings: TaskManagerSettings): FolderSettingConfig[] {
  return [
    {
      name: "Projects Folder",
      description: "Folder scanned recursively by the Process Tasks command.",
      key: "projectsFolder",
      value: settings.projectsFolder,
      placeholder: "Projects",
    },
    {
      name: "Completed Projects Folder",
      description: "Destination folder for completed projects.",
      key: "completedProjectsFolder",
      value: settings.completedProjectsFolder,
      placeholder: "Projects/Completed",
    },
    {
      name: "Waiting Projects Folder",
      description: "Destination folder for waiting projects.",
      key: "waitingProjectsFolder",
      value: settings.waitingProjectsFolder,
      placeholder: "Projects/Waiting",
    },
    {
      name: "Someday-Maybe Projects Folder",
      description: "Destination folder for someday-maybe projects.",
      key: "somedayMaybeProjectsFolder",
      value: settings.somedayMaybeProjectsFolder,
      placeholder: "Projects/Someday-Maybe",
    },
    {
      name: "Inbox File",
      description: "Path to the inbox file (used for Inbox section in dashboard).",
      key: "inboxFile",
      value: settings.inboxFile,
      placeholder: "Inbox.md",
    },
  ];
}

export function getTextSettingConfigs(settings: TaskManagerSettings): TextSettingConfig[] {
  return [
    {
      name: "Next Action Tag",
      description: "Tag added to the active next task.",
      placeholder: "#next-action",
      key: "nextActionTag",
      value: settings.nextActionTag,
    },
    {
      name: "Completed Status Field",
      description: "Frontmatter field updated when the file has no remaining incomplete tasks.",
      placeholder: "status",
      key: "statusField",
      value: settings.statusField,
    },
    {
      name: "Dashboard Filename Hide Keywords",
      description: "Comma-separated list of keywords to remove from filenames shown in the date dashboard (e.g. \"2024, draft, archive\").",
      placeholder: "e.g. draft, archive, 2024",
      key: "dashboardHideKeywords",
      value: settings.dashboardHideKeywords,
      multiLine: false,
    },
  ];
}