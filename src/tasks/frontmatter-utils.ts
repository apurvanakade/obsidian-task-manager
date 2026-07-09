/**
 * Purpose:
 * - parse a single frontmatter field from a raw file-content string.
 *
 * Responsibilities:
 * - extracts the frontmatter block and reads one field's raw (untransformed) value
 *
 * Dependencies:
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure parsing helper)
 *
 * Notes:
 * - Deliberately operates on a content string rather than Obsidian's metadataCache.
 *   Callers on the vault-modify hot path (status-routing, file-priority) need the value
 *   from content just read via vault.read(), before the cache is guaranteed to have
 *   reparsed the file — using metadataCache there would risk reading stale values.
 */
const FRONTMATTER_BLOCK_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

export function readFrontmatterField(content: string, fieldName: string): string | null {
  const frontmatterMatch = content.match(FRONTMATTER_BLOCK_REGEX);
  if (!frontmatterMatch) {
    return null;
  }

  const fieldRegex = new RegExp(`^\\s*${escapeRegExp(fieldName)}\\s*:\\s*(.*?)\\s*$`, "i");
  const lines = frontmatterMatch[1].split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(fieldRegex);
    if (!match) {
      continue;
    }

    return match[1].replace(/^['"]|['"]$/g, "").trim();
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
