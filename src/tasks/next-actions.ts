/**
 * Purpose:
 * - find "actionable" task lines in a file, optionally supporting multiple parallel
 *   next actions grouped by context.
 *
 * Responsibilities:
 * - findActionableTaskLines(): the first open line in the file, plus (only when
 *   multiple-next-actions is enabled) the first open line within each additional
 *   context group encountered among the file's open tasks
 *
 * Dependencies:
 * - task-line-metadata.ts for line parsing and context extraction
 *
 * Side Effects:
 * - none (pure function over an array of lines)
 */
import { getContexts, parseTaskLineStructured } from "./task-line-metadata";

/**
 * Returns the indices of all actionable open task lines, in document order.
 *
 * When `enableMultipleNextActions` is false, this is always at most a single index —
 * the first open line — identical to the legacy single-next-action model.
 *
 * When true: the first open line is always actionable (so context-less files behave
 * exactly as before), plus the first open line bearing each distinct context found
 * among the file's open tasks. A project with open tasks tagged `@home` and `@calls`
 * then surfaces one actionable line per context, instead of only the first line.
 */
export function findActionableTaskLines(lines: string[], enableMultipleNextActions: boolean): number[] {
  const openLines: { index: number; contexts: string[] }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const structured = parseTaskLineStructured(lines[index]);
    if (!structured || structured.status !== "open") {
      continue;
    }

    openLines.push({ index, contexts: getContexts(structured.body) });
  }

  if (openLines.length === 0) {
    return [];
  }

  if (!enableMultipleNextActions) {
    return [openLines[0].index];
  }

  const actionableIndices = new Set<number>([openLines[0].index]);
  const firstIndexByContext = new Map<string, number>();

  for (const openLine of openLines) {
    for (const context of openLine.contexts) {
      if (!firstIndexByContext.has(context)) {
        firstIndexByContext.set(context, openLine.index);
      }
    }
  }

  for (const index of firstIndexByContext.values()) {
    actionableIndices.add(index);
  }

  return [...actionableIndices].sort((a, b) => a - b);
}
