/**
 * Purpose:
 * - shared collapsible-section UI used by the Tasks Summary and Projects Summary
 *   views: a native <details>/<summary> wrapper around a section's content, with the
 *   section's total row count shown in the summary line so a collapsed section still
 *   communicates its size.
 *
 * Responsibilities:
 * - renders a <details> element and returns it so the caller can append its section
 *   content (table, list, empty-state paragraph, ...) inside
 * - reports open/close toggles back to the caller via onToggle, so open/closed state
 *   can be tracked per-section across re-renders
 *
 * Dependencies:
 * - none (pure DOM)
 *
 * Side Effects:
 * - manipulates DOM only
 *
 * Notes:
 * - Open/closed state is session-only UI state held by the caller (a controller-instance
 *   Set of open section titles), never persisted to settings.
 */

/**
 * Renders `<details open?><summary>title (count)</summary></details>` into `container`
 * and returns the `<details>` element for the caller to append content into.
 */
export function appendCollapsibleSection(
  container: HTMLElement,
  title: string,
  count: number,
  isOpen: boolean,
  onToggle: (open: boolean) => void,
): HTMLElement {
  const details = document.createElement("details");
  details.open = isOpen;

  const summary = document.createElement("summary");
  summary.textContent = `${title} (${count})`;
  details.appendChild(summary);

  details.addEventListener("toggle", () => {
    onToggle(details.open);
  });

  container.appendChild(details);
  return details;
}
