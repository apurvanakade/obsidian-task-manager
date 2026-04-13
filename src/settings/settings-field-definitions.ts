/**
 * Purpose:
 * - define declarative metadata for settings controls.
 *
 * Responsibilities:
 * - provides folder-setting metadata (including file-path settings)
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
 * - Inbox File and Tasks Summary File use file pickers, not folder pickers, in settings UI.
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

export type ToggleSettingConfig = {
  name: string;
  description: string;
  key: keyof Pick<TaskManagerSettings, "openSummaryAfterGeneration">;
  value: boolean;
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
    {
      name: "Tasks Summary File",
      description: "Path to the markdown file written by the Tasks Summary command.",
      key: "tasksSummaryFile",
      value: settings.tasksSummaryFile,
      placeholder: "Tasks Summary.md",
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

export function getToggleSettingConfigs(settings: TaskManagerSettings): ToggleSettingConfig[] {
  return [
    {
      name: "Open Tasks Summary After Generation",
      description: "Open the Tasks Summary file automatically after the Tasks Summary command finishes.",
      key: "openSummaryAfterGeneration",
      value: settings.openSummaryAfterGeneration,
    },
  ];
}
