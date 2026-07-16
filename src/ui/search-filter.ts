/**
 * Purpose:
 * - shared search-box UI used by the Date Dashboard, Weekly Review, and Tasks Summary
 *   views: a text input rendered above a view's content that narrows displayed rows.
 *
 * Responsibilities:
 * - renders a search input wired to an onQueryChange callback
 * - provides a case-insensitive substring matcher for filtering row-shaped data
 *
 * Dependencies:
 * - none (pure DOM)
 *
 * Side Effects:
 * - manipulates DOM only
 */

/** Renders a search box into `container`, prefilled with `query`; calls `onQueryChange` on input. */
export function appendSearchBox(container: HTMLElement, query: string, onQueryChange: (query: string) => void): HTMLInputElement {
  const wrapper = document.createElement("div");
  wrapper.style.marginBottom = "10px";

  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search";
  input.value = query;
  input.style.width = "100%";
  input.addEventListener("input", () => onQueryChange(input.value));

  wrapper.appendChild(input);
  container.appendChild(wrapper);
  return input;
}

/** Case-insensitive substring match against any of `texts`; an empty/whitespace query matches everything. */
export function matchesSearch(query: string, ...texts: string[]): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  return texts.some((text) => text.toLowerCase().includes(trimmed));
}
