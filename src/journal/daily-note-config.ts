/**
 * Purpose:
 * - resolve today's daily note path from Obsidian's core Daily Notes plugin config.
 *
 * Responsibilities:
 * - reaches past the public App typings to read the core Daily Notes plugin's
 *   folder/format options (undocumented API, same cast pattern as
 *   src/bases/create-tasks-summary.ts's isBasesCorePluginEnabled())
 * - formats today's date against that format via Obsidian's bundled moment
 * - owns DAILY_NOTE_TASKS_HEADER, the single source of truth for the heading Quick
 *   Capture writes under and captured-tasks-data.ts scans for
 *
 * Dependencies:
 * - Obsidian App/moment
 *
 * Side Effects:
 * - none (reads in-memory plugin config only)
 */
import { App, moment } from "obsidian";

export const DAILY_NOTE_TASKS_HEADER = "## Tasks";

export type DailyNotesConfig = { folder: string; format: string };

/**
 * The core Daily Notes plugin's options aren't part of the typed API surface, so this
 * reaches past the typings the same way isBasesCorePluginEnabled() does. Defensive by
 * construction: any missing shape (plugin disabled, older Obsidian) just falls through
 * to null, which callers surface as a Notice rather than throwing.
 */
export function getDailyNotesConfig(app: App): DailyNotesConfig | null {
  const internalPlugins = (app as unknown as {
    internalPlugins?: {
      plugins?: Record<string, { enabled?: boolean; instance?: { options?: { folder?: string; format?: string } } }>;
    };
  }).internalPlugins;

  const plugin = internalPlugins?.plugins?.["daily-notes"];
  if (!plugin?.enabled) {
    return null;
  }

  const options = plugin.instance?.options;
  return {
    folder: (options?.folder ?? "").trim().replace(/^\/+|\/+$/g, ""),
    format: options?.format?.trim() || "YYYY-MM-DD",
  };
}

/** Today's daily note path (e.g. `Journal/2026/2026-08/2026-08-16.md`), or null if the core Daily Notes plugin is disabled/unconfigured. */
export function getDailyNotePathForToday(app: App): string | null {
  const config = getDailyNotesConfig(app);
  if (!config) {
    return null;
  }

  const fileName = `${moment().format(config.format)}.md`;
  return config.folder ? `${config.folder}/${fileName}` : fileName;
}
