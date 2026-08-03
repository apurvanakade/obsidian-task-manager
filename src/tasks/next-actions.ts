/**
 * Purpose:
 * - find the "actionable" task line in a file.
 *
 * Responsibilities:
 * - findActionableTaskLines(): the first open line in the file, if any
 *
 * Dependencies:
 * - task-line-metadata.ts for line parsing
 *
 * Side Effects:
 * - none (pure function over an array of lines)
 */
import { parseTaskLineStructured } from "./task-line-metadata";

/**
 * Returns the index of the first open task line, as a single-element array (or empty
 * if there are no open tasks). Kept as an array return type so callers that diff
 * actionable sets don't need to special-case a scalar vs. list shape.
 */
export function findActionableTaskLines(lines: string[]): number[] {
  for (let index = 0; index < lines.length; index += 1) {
    const structured = parseTaskLineStructured(lines[index]);
    if (structured && structured.status === "open") {
      return [index];
    }
  }

  return [];
}
