/**
 * Purpose:
 * - provide shared date suggestions for editor autocomplete and due-date modal UI.
 *
 * Responsibilities:
 * - provides canonical suggestion values in YYYY-MM-DD format
 * - provides human-friendly labels (Today, Tomorrow, weekday names)
 * - provides normalized search text for fuzzy matching in suggestion UIs
 *
 * Dependencies:
 * - JavaScript Date and Intl APIs
 *
 * Side Effects:
 * - none (pure value generation)
 */
export type DateSuggestion = {
  value: string;
  label: string;
  searchText: string;
};

export const DEFAULT_LOOKAHEAD_DAYS = 30;

const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});

export function buildDateSuggestions(lookaheadDays: number = DEFAULT_LOOKAHEAD_DAYS): DateSuggestion[] {
  const today = startOfDay(new Date());
  const suggestions: DateSuggestion[] = [];

  for (let offset = 0; offset <= lookaheadDays; offset += 1) {
    const date = addDays(today, offset);
    const value = formatDate(date);
    const label = getDateLabel(date, offset);

    suggestions.push({
      value,
      label,
      searchText: `${value} ${label}`.toLowerCase(),
    });
  }

  return suggestions;
}

export function resolveDateInput(
  input: string,
  lookaheadDays: number = DEFAULT_LOOKAHEAD_DAYS
): string | null {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  if (isValidIsoDate(normalized)) {
    return normalized;
  }

  const suggestions = buildDateSuggestions(lookaheadDays);
  const exactMatch = suggestions.find((suggestion) => {
    return suggestion.value.toLowerCase() === normalized || suggestion.label.toLowerCase() === normalized;
  });

  if (exactMatch) {
    return exactMatch.value;
  }

  const fuzzyMatch = suggestions.find((suggestion) => suggestion.searchText.includes(normalized));
  return fuzzyMatch?.value ?? null;
}

function getDateLabel(date: Date, offset: number): string {
  if (offset === 0) {
    return "Today";
  }

  if (offset === 1) {
    return "Tomorrow";
  }

  return weekdayFormatter.format(date);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearPart, monthPart, dayPart] = value.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}