/**
 * Purpose:
 * - centralize command registration for task-processing actions.
 *
 * Responsibilities:
 * - registers user-facing commands with the command palette
 * - maps command callbacks to host-provided handlers
 *
 * Dependencies:
 * - Obsidian Plugin command registration API
 *
 * Side Effects:
 * - adds commands to the active plugin instance
 *
 * Notes:
 * - keeps command declaration details out of the plugin entrypoint.
 */
import { Plugin } from "obsidian";

type TaskCommandHandlers = {
  resetCurrentFileTasks: () => void;
  createTasksSummary: () => void;
  addNewProject: () => void;
  openRandomSomedayMaybeProject: () => void;
  quickCapture: () => void;
  openWeeklyReview: () => void;
  backfillWaitingSince: () => void;
};

export function registerTaskCommands(plugin: Plugin, handlers: TaskCommandHandlers): void {
  plugin.addCommand({
    id: "reset-current-file-tasks",
    name: "Reset Tasks",
    callback: handlers.resetCurrentFileTasks,
  });

  plugin.addCommand({
    id: "create-tasks-summary",
    name: "Tasks and Projects Summary",
    callback: handlers.createTasksSummary,
  });

  plugin.addCommand({
    id: "add-new-project",
    name: "Add New Project",
    callback: handlers.addNewProject,
  });

  plugin.addCommand({
    id: "open-random-someday-maybe-project",
    name: "Open Random Someday-Maybe Project",
    callback: handlers.openRandomSomedayMaybeProject,
  });

  plugin.addCommand({
    id: "quick-capture-task",
    name: "Quick Capture Task",
    callback: handlers.quickCapture,
  });

  plugin.addCommand({
    id: "open-weekly-review",
    name: "Open Weekly Review",
    callback: handlers.openWeeklyReview,
  });

  plugin.addCommand({
    id: "backfill-waiting-since",
    name: "Stamp Waiting-Since For Existing Waiting Projects",
    callback: handlers.backfillWaitingSince,
  });
}
