/**
 * Purpose:
 * - shared priority-filter UI used by the Date Dashboard, Tasks Summary, and Projects
 *   Summary views: a dropdown rendered above a view's content that narrows displayed
 *   rows to priority 1 only or priority 1-2, hiding priority-3 rows on demand.
 *
 * Responsibilities:
 * - renders a priority filter select wired to an onChange callback
 * - provides a pure filter for row-shaped data carrying a numeric `priority`
 *
 * Dependencies:
 * - none (pure DOM)
 *
 * Side Effects:
 * - manipulates DOM only
 *
 * Notes:
 * - Selection is session-only UI state held by the caller (mirroring the removed
 *   Context filter's pattern) — never persisted to settings.
 */

/** null means "All priorities" (no filtering). */
export type PriorityFilterValue = 1 | 2 | null;

/** Renders a priority filter dropdown into `container`; calls `onChange` on selection. */
export function appendPriorityFilter(
  container: HTMLElement,
  selected: PriorityFilterValue,
  onChange: (value: PriorityFilterValue) => void,
): void {
  const wrapper = document.createElement("div");
  wrapper.style.marginBottom = "10px";

  const label = document.createElement("label");
  label.textContent = "Priority: ";
  wrapper.appendChild(label);

  const select = document.createElement("select");
  const options: { value: string; text: string }[] = [
    { value: "", text: "All priorities" },
    { value: "1", text: "Priority 1 only" },
    { value: "2", text: "Priority 1-2" },
  ];
  for (const option of options) {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.text;
    select.appendChild(optionEl);
  }

  select.value = selected === null ? "" : String(selected);
  select.addEventListener("change", () => {
    onChange(select.value === "" ? null : (Number(select.value) as 1 | 2));
  });

  label.appendChild(select);
  container.appendChild(wrapper);
}

/** Keeps only rows with priority <= maxPriority; `null` (All) passes every row through unchanged. */
export function filterByMaxPriority<T extends { priority: number }>(rows: T[], maxPriority: PriorityFilterValue): T[] {
  if (maxPriority === null) {
    return rows;
  }

  return rows.filter((row) => row.priority <= maxPriority);
}
