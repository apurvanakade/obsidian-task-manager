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
  openTasksSummary: () => void;
  addNewProject: () => void;
  openRandomSomedayMaybeProject: () => void;
  quickCapture: () => void;
  openProjectsSummary: () => void;
  backfillWaitingSince: () => void;
  backfillDerivedFrontmatter: () => void;
  createTaskBases: () => void;
};

export function registerTaskCommands(plugin: Plugin, handlers: TaskCommandHandlers): void {
  plugin.addCommand({
    id: "reset-current-file-tasks",
    name: "Reset Tasks",
    callback: handlers.resetCurrentFileTasks,
  });

  plugin.addCommand({
    id: "open-tasks-summary",
    name: "Open Tasks Summary",
    callback: handlers.openTasksSummary,
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
    id: "open-projects-summary",
    name: "Open Projects Summary",
    callback: handlers.openProjectsSummary,
  });

  plugin.addCommand({
    id: "backfill-waiting-since",
    name: "Stamp Waiting-Since For Existing Waiting Projects",
    callback: handlers.backfillWaitingSince,
  });

  plugin.addCommand({
    id: "backfill-derived-frontmatter",
    name: "Stamp Derived Fields For All Projects",
    callback: handlers.backfillDerivedFrontmatter,
  });

  plugin.addCommand({
    id: "create-task-bases",
    name: "Create Task Bases",
    callback: handlers.createTaskBases,
  });
}
