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
  processTasks: () => void;
  processCurrentFile: () => void;
};

export function registerTaskCommands(plugin: Plugin, handlers: TaskCommandHandlers): void {
  plugin.addCommand({
    id: "process-tasks",
    name: "Process Tasks",
    callback: handlers.processTasks,
  });

  plugin.addCommand({
    id: "process-current-file",
    name: "Process File",
    callback: handlers.processCurrentFile,
  });
}