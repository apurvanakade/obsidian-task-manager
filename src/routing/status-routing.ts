/**
 * Purpose:
 * - derive and validate routable status values for task files.
 *
 * Responsibilities:
 * - reads status values from frontmatter/status fields
 * - predicts effective status from task-state transitions
 * - validates whether a status maps to a routable destination bucket
 *
 * Dependencies:
 * - settings shape and task-routing destination resolution
 *
 * Side Effects:
 * - none (pure decision logic)
 */
import { TaskManagerSettings } from "../settings/settings-utils";
import { readFrontmatterField } from "../tasks/frontmatter-utils";
import { getDestinationRootForStatus } from "./task-routing";

export const ROUTABLE_STATUSES = ["todo", "completed", "waiting", "someday-maybe", "scheduled", "archived"] as const;

export type RoutableStatus = (typeof ROUTABLE_STATUSES)[number];

export function isRoutableStatus(value: string): value is RoutableStatus {
  return (ROUTABLE_STATUSES as readonly string[]).includes(value);
}

export function readStatusValue(content: string, statusField: string): string | null {
  const value = readFrontmatterField(content, statusField);
  return value === null ? null : value.toLowerCase();
}

export function predictFinalStatus(currentStatus: string | null, hasOpenTasks: boolean): string | null {
  if (hasOpenTasks) {
    if (currentStatus !== null && currentStatus !== "completed") {
      return currentStatus;
    }

    return "todo";
  }

  return "completed";
}

export function assertConfiguredDestinationForStatus(status: string | null, settings: TaskManagerSettings): void {
  if (!status || !isRoutableStatus(status)) {
    return;
  }

  const destinationRoot = getDestinationRootForStatus(settings, status);
  if (!destinationRoot) {
    throw new Error(`Set destination folder for status '${status}' in Task Manager settings.`);
  }
}