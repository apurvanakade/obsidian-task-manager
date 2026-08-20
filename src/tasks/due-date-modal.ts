/**
 * Purpose:
 * - collect a due date and file priority for the current first incomplete task.
 *
 * Responsibilities:
 * - presents a navigable month calendar, file-priority selection, and manual date input
 * - immediately submits on calendar-day click
 * - forwards selected dates to reconciler-provided callbacks
 *
 * Dependencies:
 * - Obsidian Modal APIs
 * - shared date suggestion builder
 *
 * Side Effects:
 * - opens modal UI, updates input state, and calls async submit callbacks
 */
import { App, Modal, Notice } from "obsidian";
import { buildDateSuggestions, resolveDateInput } from "../date/date-suggestions";
import {
  buildMonthGrid,
  getCurrentDateString,
  parseIsoDate,
  shiftMonth,
  WEEKDAY_LABELS,
} from "../date/date-utils";
import { parseRepeatRule } from "./repeat-rules";

const spacingStyles = {
  description: { marginBottom: "20px" },
  taskPreview: {
    marginBottom: "16px",
    padding: "10px",
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "6px",
    backgroundColor: "var(--background-secondary)",
  },
  section: { marginBottom: "15px" },
  label: {
    display: "block",
    marginBottom: "8px",
    fontWeight: "bold",
  },
} as const;

const inputStyles = {
  width: "100%",
  padding: "8px",
  boxSizing: "border-box",
  marginBottom: "10px",
} as const;

const calendarStyles = {
  container: { marginBottom: "15px" },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "8px",
  },
  monthLabel: { fontWeight: "bold" },
  navButton: {
    padding: "2px 10px",
    cursor: "pointer",
    background: "none",
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "4px",
    boxShadow: "none",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: "2px",
  },
  weekdayCell: {
    textAlign: "center",
    fontSize: "0.8em",
    color: "var(--text-muted)",
    padding: "4px 0",
  },
  dayButton: {
    padding: "6px 0",
    cursor: "pointer",
    background: "none",
    border: "1px solid transparent",
    borderRadius: "4px",
    boxShadow: "none",
  },
  today: {
    border: "2px solid var(--interactive-accent)",
    fontWeight: "bold",
  },
  selected: {
    backgroundColor: "var(--interactive-accent)",
    color: "var(--text-on-accent)",
  },
  pastDay: {
    color: "var(--text-faint)",
    cursor: "not-allowed",
  },
  padding: { visibility: "hidden" },
} as const;

const actionRowStyles = {
  display: "flex",
  gap: "10px",
  justifyContent: "flex-end",
} as const;

const buttonStyles = {
  base: {
    padding: "8px 16px",
    cursor: "pointer",
  },
  primary: {
    backgroundColor: "#4CAF50",
    color: "white",
    border: "none",
    borderRadius: "4px",
  },
  secondary: {
    backgroundColor: "#f0f0f0",
    border: "1px solid #000",
    borderRadius: "4px",
  },
} as const;

type DueDateModalOptions = {
  app: App;
  taskLine: string;
  taskLineIndex: number;
  initialPriority: "1" | "2" | "3";
  initialDueDate?: string | null;
  initialRepeat?: string | null;
  onSubmit: (taskLineIndex: number, taskLine: string, dueDate: string, priority: "1" | "2" | "3", repeat: string | null) => Promise<void>;
};

export class DueDateModal extends Modal {
  private readonly taskLine: string;
  private readonly taskLineIndex: number;
  private readonly initialPriority: "1" | "2" | "3";
  private readonly initialDueDate: string;
  private readonly initialRepeat: string;
  private readonly onSubmit: (taskLineIndex: number, taskLine: string, dueDate: string, priority: "1" | "2" | "3", repeat: string | null) => Promise<void>;
  private readonly dateSuggestions = buildDateSuggestions();
  private inputElement: HTMLInputElement | null = null;
  private prioritySelectElement: HTMLSelectElement | null = null;
  private repeatInputElement: HTMLInputElement | null = null;
  private calendarGridElement: HTMLElement | null = null;
  private calendarLabelElement: HTMLElement | null = null;
  private previousMonthButton: HTMLButtonElement | null = null;
  private visibleYear: number;
  private visibleMonthIndex: number;

  constructor(options: DueDateModalOptions) {
    super(options.app);
    this.taskLine = options.taskLine;
    this.taskLineIndex = options.taskLineIndex;
    this.initialPriority = options.initialPriority;
    this.initialDueDate = options.initialDueDate?.trim() ?? "";
    this.initialRepeat = options.initialRepeat?.trim() ?? "";
    this.onSubmit = options.onSubmit;

    // Defaults to the current month, unless a prefilled due date lives in a later one —
    // otherwise its highlight would be off-screen when the modal opens.
    const today = new Date();
    const prefilled = parseIsoDate(this.initialDueDate);
    const startFrom = prefilled !== null && prefilled > today ? prefilled : today;
    this.visibleYear = startFrom.getFullYear();
    this.visibleMonthIndex = startFrom.getMonth();
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Add Due Date" });

    this.createDescription(contentEl);
    this.createTaskPreview(contentEl);
    this.createPrioritySection(contentEl);
    this.createInputSection(contentEl);
    this.createRepeatSection(contentEl);
    this.createCalendarSection(contentEl);
    this.createActionButtons(contentEl);

    this.prioritySelectElement?.focus();
  }

  private createDescription(container: HTMLElement): void {
    const description = container.createEl("p", {
      text: "Would you like to add a due date for this task and set the project priority?",
    });
    applyStyles(description, spacingStyles.description);
  }

  private createTaskPreview(container: HTMLElement): void {
    const taskPreview = container.createEl("div");
    applyStyles(taskPreview, spacingStyles.taskPreview);

    const taskLabel = taskPreview.createEl("strong", { text: "Task:" });
    taskLabel.style.display = "block";
    taskLabel.style.marginBottom = "4px";

    taskPreview.createEl("span", {
      text: this.getTaskDisplayText(),
    });
  }

  private getTaskDisplayText(): string {
    const withoutTaskPrefix = this.taskLine
      .replace(/^\s*[-*+]\s+\[[^\]]\]\s*/, "")
      .trim();
    return withoutTaskPrefix.length > 0 ? withoutTaskPrefix : this.taskLine.trim();
  }

  private createInputSection(container: HTMLElement): void {
    const inputContainer = container.createEl("div");
    applyStyles(inputContainer, spacingStyles.section);

    this.createSectionLabel(inputContainer, "Due Date (YYYY-MM-DD or natural language):");

    const listId = `task-manager-due-date-options-${Date.now()}`;
    const dateList = inputContainer.createEl("datalist");
    dateList.id = listId;

    for (const suggestion of this.dateSuggestions) {
      dateList.createEl("option", {
        value: suggestion.value,
      });

      dateList.createEl("option", {
        value: suggestion.label.toLowerCase(),
      });
    }

    this.inputElement = inputContainer.createEl("input", {
      type: "text",
      placeholder: "e.g., 2026-03-20, today, tomorrow, monday",
      value: this.initialDueDate,
    });
    this.inputElement.setAttribute("list", listId);
    this.inputElement.addEventListener("input", () => {
      this.syncCalendarToInput();
    });
    this.inputElement.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      void this.submitDate();
    });
    applyStyles(this.inputElement, inputStyles);
  }

  private createPrioritySection(container: HTMLElement): void {
    const priorityContainer = container.createEl("div");
    applyStyles(priorityContainer, spacingStyles.section);

    this.createSectionLabel(priorityContainer, "Project Priority:");

    const selectElement = priorityContainer.createEl("select");
    applyStyles(selectElement, inputStyles);

    (["1", "2", "3"] as const).forEach((priority) => {
      const option = selectElement.createEl("option", {
        text: priority,
        value: priority,
      });
      if (priority === this.initialPriority) {
        option.selected = true;
      }
    });

    this.prioritySelectElement = selectElement;
  }

  private createRepeatSection(container: HTMLElement): void {
    const repeatContainer = container.createEl("div");
    applyStyles(repeatContainer, spacingStyles.section);

    this.createSectionLabel(repeatContainer, "Repeat (optional):");

    this.repeatInputElement = repeatContainer.createEl("input", {
      type: "text",
      placeholder: "e.g., daily, 2 weeks, mon, wed, fri, 1st wed, last workday, jan 27",
      value: this.initialRepeat,
    });
    applyStyles(this.repeatInputElement, inputStyles);
  }

  private createCalendarSection(container: HTMLElement): void {
    this.createSectionLabel(container, "Pick a Date:");

    const calendarContainer = container.createEl("div");
    applyStyles(calendarContainer, calendarStyles.container);

    const header = calendarContainer.createEl("div");
    applyStyles(header, calendarStyles.header);

    this.previousMonthButton = header.createEl("button", { text: "\u2039" });
    this.previousMonthButton.setAttribute("aria-label", "Previous month");
    applyStyles(this.previousMonthButton, calendarStyles.navButton);
    this.previousMonthButton.onclick = () => {
      this.changeVisibleMonth(-1);
    };

    this.calendarLabelElement = header.createEl("span");
    applyStyles(this.calendarLabelElement, calendarStyles.monthLabel);

    const nextButton = header.createEl("button", { text: "\u203a" });
    nextButton.setAttribute("aria-label", "Next month");
    applyStyles(nextButton, calendarStyles.navButton);
    nextButton.onclick = () => {
      this.changeVisibleMonth(1);
    };

    this.calendarGridElement = calendarContainer.createEl("div");
    applyStyles(this.calendarGridElement, calendarStyles.grid);

    this.renderCalendar();
  }

  /** Keeps the calendar showing (and highlighting) whatever date the input resolves to. */
  private syncCalendarToInput(): void {
    const selectedDate = this.getSelectedDate();
    const parsed = selectedDate === null ? null : parseIsoDate(selectedDate);
    if (parsed) {
      this.visibleYear = parsed.getFullYear();
      this.visibleMonthIndex = parsed.getMonth();
    }

    this.renderCalendar();
  }

  private changeVisibleMonth(delta: number): void {
    const shifted = shiftMonth(this.visibleYear, this.visibleMonthIndex, delta);
    this.visibleYear = shifted.year;
    this.visibleMonthIndex = shifted.monthIndex;
    this.renderCalendar();
  }

  private renderCalendar(): void {
    const gridElement = this.calendarGridElement;
    if (!gridElement) {
      return;
    }

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonthIndex = today.getMonth();

    const grid = buildMonthGrid(this.visibleYear, this.visibleMonthIndex);
    if (this.calendarLabelElement) {
      this.calendarLabelElement.textContent = grid.label;
    }

    gridElement.empty();

    for (const weekdayLabel of WEEKDAY_LABELS) {
      const weekdayCell = gridElement.createEl("div", { text: weekdayLabel });
      applyStyles(weekdayCell, calendarStyles.weekdayCell);
    }

    const todayDate = getCurrentDateString();
    const selectedDate = this.getSelectedDate();

    // Nothing before today is selectable, so there is nowhere useful to go back to
    // once the current month is on screen.
    if (this.previousMonthButton) {
      const isCurrentMonthOrEarlier =
        grid.year < todayYear
        || (grid.year === todayYear && grid.monthIndex <= todayMonthIndex);
      this.previousMonthButton.disabled = isCurrentMonthOrEarlier;
      this.previousMonthButton.style.opacity = isCurrentMonthOrEarlier ? "0.4" : "1";
      this.previousMonthButton.style.cursor = isCurrentMonthOrEarlier ? "not-allowed" : "pointer";
    }

    for (const week of grid.weeks) {
      for (const cell of week) {
        if (cell.date === null) {
          const placeholder = gridElement.createEl("div");
          applyStyles(placeholder, calendarStyles.padding);
          continue;
        }

        const dayButton = gridElement.createEl("button", {
          text: String(cell.dayOfMonth),
        });
        applyStyles(dayButton, calendarStyles.dayButton);

        // ISO date strings compare lexicographically, so this is a plain past-date check.
        const isPast = cell.date < todayDate;
        if (isPast) {
          applyStyles(dayButton, calendarStyles.pastDay);
          dayButton.disabled = true;
        }
        if (cell.date === todayDate) {
          applyStyles(dayButton, calendarStyles.today);
        }
        if (cell.date === selectedDate) {
          applyStyles(dayButton, calendarStyles.selected);
        }

        if (isPast) {
          continue;
        }

        const dateValue = cell.date;
        dayButton.onclick = () => {
          if (this.inputElement) {
            this.inputElement.value = dateValue;
          }
          void this.submitDate(dateValue);
        };
      }
    }
  }

  /** The currently typed date, when it resolves — used to highlight a calendar day. */
  private getSelectedDate(): string | null {
    const rawValue = this.inputElement?.value.trim() ?? this.initialDueDate;
    if (rawValue.length === 0) {
      return null;
    }

    const resolved = resolveDateInput(rawValue);
    return resolved !== null && parseIsoDate(resolved) !== null ? resolved : null;
  }

  private createActionButtons(container: HTMLElement): void {
    const buttonContainer = container.createEl("div");
    applyStyles(buttonContainer, actionRowStyles);

    const addButton = buttonContainer.createEl("button", { text: "Add Due Date" });
    applyStyles(addButton, buttonStyles.base);
    applyStyles(addButton, buttonStyles.primary);
    addButton.onclick = () => {
      void this.submitDate();
    };

    const skipButton = buttonContainer.createEl("button", { text: "Skip" });
    applyStyles(skipButton, buttonStyles.base);
    applyStyles(skipButton, buttonStyles.secondary);
    skipButton.onclick = () => {
      this.close();
    };
  }

  private createSectionLabel(container: HTMLElement, text: string): HTMLLabelElement {
    const label = container.createEl("label");
    label.textContent = text;
    applyStyles(label, spacingStyles.label);
    return label;
  }

  private async submitDate(dateOverride?: string): Promise<void> {
    const dateValue = dateOverride ?? this.inputElement?.value.trim() ?? "";
    const priority = (this.prioritySelectElement?.value ?? "3") as "1" | "2" | "3";
    const repeatValue = this.repeatInputElement?.value.trim() ?? "";

    if (!dateValue) {
      return;
    }

    const resolvedDate = resolveDateInput(dateValue);
    if (!resolvedDate) {
      new Notice("Enter YYYY-MM-DD or a natural date like today, tomorrow, or a weekday.");
      return;
    }

    const repeat = repeatValue.length > 0 ? repeatValue : null;
    // Validate against a standalone synthetic line, not one built from this.taskLine —
    // when repairing an already-broken repeat value, this.taskLine still carries the old
    // (unparseable) [repeat::] field, and the regex would match that one first, making
    // every entry fail validation.
    if (repeat !== null && parseRepeatRule(`- [ ] x [repeat:: ${repeat}]`) === null) {
      new Notice(
        "Enter a valid repeat rule like daily, every! 3 days, mon, fri, 1st wed, last workday, or jan 27 until 2026-12-31.",
      );
      return;
    }

    try {
      await this.onSubmit(this.taskLineIndex, this.taskLine, resolvedDate, priority, repeat);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to add due date.");
    }
  }
}

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}
