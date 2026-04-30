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
};

export function registerTaskCommands(plugin: Plugin, handlers: TaskCommandHandlers): void {
  plugin.addCommand({
    id: "reset-current-file-tasks",
    name: "Reset Tasks",
    callback: handlers.resetCurrentFileTasks,
  });

  plugin.addCommand({
    id: "create-tasks-summary",
    name: "Tasks Summary",
    callback: handlers.createTasksSummary,
  });

  plugin.addCommand({
    id: "add-new-project",
    name: "Add New Project",
    callback: handlers.addNewProject,
  });
}
