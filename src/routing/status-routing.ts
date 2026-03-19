import { TaskManagerSettings } from "../settings/settings-utils";
import { getDestinationRootForStatus } from "./task-routing";

export const ROUTABLE_STATUSES = ["todo", "completed", "waiting", "scheduled", "someday-maybe"] as const;

export type RoutableStatus = (typeof ROUTABLE_STATUSES)[number];

export function isRoutableStatus(value: string): value is RoutableStatus {
  return (ROUTABLE_STATUSES as readonly string[]).includes(value);
}

export function readStatusValue(content: string, statusField: string): string | null {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const fieldRegex = new RegExp(`^\\s*${escapeRegExp(statusField)}\\s*:\\s*(.*?)\\s*$`, "i");
  const lines = frontmatterMatch[1].split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(fieldRegex);
    if (!match) {
      continue;
    }

    return match[1].replace(/^['\"]|['\"]$/g, "").trim().toLowerCase();
  }

  return null;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}