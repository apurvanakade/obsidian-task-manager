/**
 * Purpose:
 * - centralize file-level priority parsing helpers.
 *
 * Responsibilities:
 * - reads project priority from frontmatter
 *
 * Dependencies:
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure parsing/normalization helpers)
 */
import { readFrontmatterField } from "./frontmatter-utils";

export const PRIORITY_FRONTMATTER_FIELD = "priority";
export const DEFAULT_PRIORITY = 3 as const;

export type FilePriority = 1 | 2 | 3;

export function readFilePriority(content: string): FilePriority {
  return readFrontmatterPriority(content) ?? DEFAULT_PRIORITY;
}

function readFrontmatterPriority(content: string): FilePriority | null {
  const priorityValue = readFrontmatterField(content, PRIORITY_FRONTMATTER_FIELD);
  return priorityValue === null ? null : parsePriorityValue(priorityValue);
}

function parsePriorityValue(value: string): FilePriority {
  const parsed = Number.parseInt(value, 10);
  if (parsed === 1 || parsed === 2 || parsed === 3) {
    return parsed;
  }

  return DEFAULT_PRIORITY;
}
