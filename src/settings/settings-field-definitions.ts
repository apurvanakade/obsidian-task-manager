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
  key: keyof Pick<TaskManagerSettings, "statusField" | "dashboardHideKeywords" | "knownContexts" | "somedayMaybeReviewCadenceDays" | "waitingStalenessThresholdDays">;
  value: string;
  multiLine?: boolean;
};

export type ToggleSettingConfig = {
  name: string;
  description: string;
  key: keyof Pick<TaskManagerSettings, "enableMultipleNextActions">;
  value: boolean;
};

export function getFolderSettingConfigs(settings: TaskManagerSettings): FolderSettingConfig[] {
  return [
    {
      name: "Projects Folder",
      description: "Root folder for active project notes.",
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
      name: "Completed Status Field",
      description: "Frontmatter field updated when the file has no remaining incomplete tasks.",
      placeholder: "status",
      key: "statusField",
      value: settings.statusField,
    },
    {
      name: "Dashboard Filename Hide Keywords",
      description: "Comma-separated list of keywords to remove from filenames shown in the date dashboard and Tasks Summary (e.g. \"2024, draft, archive\").",
      placeholder: "e.g. draft, archive, 2024",
      key: "dashboardHideKeywords",
      value: settings.dashboardHideKeywords,
      multiLine: false,
    },
    {
      name: "Known Contexts",
      description: "Comma-separated list of task contexts for the dashboard/Tasks Summary filter and `context::` editor autocomplete (e.g. \"@home, @calls, @errands, @computer\"). The \"@\" prefix is added automatically if omitted.",
      placeholder: "e.g. @home, @calls, @errands, @computer",
      key: "knownContexts",
      value: settings.knownContexts,
      multiLine: false,
    },
    {
      name: "Someday-Maybe Review Cadence (days)",
      description: "How many days a Someday-Maybe project can go without being reviewed before the Weekly Review flags it. Invalid or non-positive values fall back to 30.",
      placeholder: "30",
      key: "somedayMaybeReviewCadenceDays",
      value: settings.somedayMaybeReviewCadenceDays,
      multiLine: false,
    },
    {
      name: "Waiting Staleness Threshold (days)",
      description: "How many days a project can stay in Waiting before the Weekly Review flags it as stale. Invalid or non-positive values fall back to 7.",
      placeholder: "7",
      key: "waitingStalenessThresholdDays",
      value: settings.waitingStalenessThresholdDays,
      multiLine: false,
    },
  ];
}

export function getToggleSettingConfigs(settings: TaskManagerSettings): ToggleSettingConfig[] {
  return [
    {
      name: "Enable Multiple Next Actions",
      description: "Let a project surface one actionable task per context (in addition to the file's first open task) instead of only ever one actionable task per file. Affects the Due Date Modal trigger and the Tasks Summary tab. Off by default to preserve existing single-next-action behavior.",
      key: "enableMultipleNextActions",
      value: settings.enableMultipleNextActions,
    },
  ];
}
