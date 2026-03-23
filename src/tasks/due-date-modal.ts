/**
 * Purpose:
 * - collect a due date for newly assigned next-action tasks.
 *
 * Responsibilities:
 * - presents quick date suggestions and manual date input
 * - immediately submits on suggested-date click
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

const suggestionsGridStyles = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "8px",
  marginBottom: "15px",
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
  suggestion: {
    padding: "8px",
    cursor: "pointer",
  },
} as const;

type DueDateModalOptions = {
  app: App;
  taskLine: string;
  onSubmit: (taskLine: string, dueDate: string, priority: "1" | "2" | "3" | "4") => Promise<void>;
};

export class DueDateModal extends Modal {
  private readonly taskLine: string;
  private readonly onSubmit: (taskLine: string, dueDate: string, priority: "1" | "2" | "3" | "4") => Promise<void>;
  private readonly dateSuggestions = buildDateSuggestions();
  private inputElement: HTMLInputElement | null = null;
  private prioritySelectElement: HTMLSelectElement | null = null;

  constructor(options: DueDateModalOptions) {
    super(options.app);
    this.taskLine = options.taskLine;
    this.onSubmit = options.onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Add Due Date" });

    this.createDescription(contentEl);
    this.createTaskPreview(contentEl);
    this.createPrioritySection(contentEl);
    this.createInputSection(contentEl);
    this.createSuggestionsSection(contentEl);
    this.createActionButtons(contentEl);

    this.prioritySelectElement?.focus();
  }

  private createDescription(container: HTMLElement): void {
    const description = container.createEl("p", {
      text: "Would you like to add a due date for this task?",
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
    });
    this.inputElement.setAttribute("list", listId);
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

    this.createSectionLabel(priorityContainer, "Priority:");

    const selectElement = priorityContainer.createEl("select");
    applyStyles(selectElement, inputStyles);

    (["1", "2", "3", "4"] as const).forEach((priority) => {
      const option = selectElement.createEl("option", {
        text: priority,
        value: priority,
      });
      if (priority === "4") {
        option.selected = true;
      }
    });

    this.prioritySelectElement = selectElement;
  }

  private createSuggestionsSection(container: HTMLElement): void {
    this.createSectionLabel(container, "Suggested Dates:");

    const suggestionsContainer = container.createEl("div");
    applyStyles(suggestionsContainer, suggestionsGridStyles);

    for (const suggestion of this.dateSuggestions.slice(0, 10)) {
      const button = suggestionsContainer.createEl("button", {
        text: `${suggestion.value} (${suggestion.label})`,
      });
      applyStyles(button, buttonStyles.suggestion);
      button.onclick = () => {
        if (this.inputElement) {
          this.inputElement.value = suggestion.value;
        }
        void this.submitDate(suggestion.value);
      };
    }
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
    const priority = (this.prioritySelectElement?.value ?? "4") as "1" | "2" | "3" | "4";

    if (!dateValue) {
      return;
    }

    const resolvedDate = resolveDateInput(dateValue);
    if (!resolvedDate) {
      new Notice("Enter YYYY-MM-DD or a natural date like today, tomorrow, or a weekday.");
      return;
    }

    try {
      await this.onSubmit(this.taskLine, resolvedDate, priority);
      this.close();
    } catch (error) {
      console.error("Failed to add due date:", error);
    }
  }
}

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}
