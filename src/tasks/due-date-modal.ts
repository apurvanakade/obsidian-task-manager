import { App, Modal } from "obsidian";
import { buildDateSuggestions } from "../date/date-suggestions";

const spacingStyles = {
  description: { marginBottom: "20px" },
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
    border: "1px solid #ccc",
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
  onSubmit: (taskLine: string, dueDate: string) => Promise<void>;
};

export class DueDateModal extends Modal {
  private readonly taskLine: string;
  private readonly onSubmit: (taskLine: string, dueDate: string) => Promise<void>;
  private inputElement: HTMLInputElement | null = null;

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
    this.createInputSection(contentEl);
    this.createSuggestionsSection(contentEl);
    this.createActionButtons(contentEl);

    this.inputElement?.focus();
  }

  private createDescription(container: HTMLElement): void {
    const description = container.createEl("p", {
      text: "Would you like to add a due date for this task?",
    });
    applyStyles(description, spacingStyles.description);
  }

  private createInputSection(container: HTMLElement): void {
    const inputContainer = container.createEl("div");
    applyStyles(inputContainer, spacingStyles.section);

    this.createSectionLabel(inputContainer, "Due Date (YYYY-MM-DD):");

    this.inputElement = inputContainer.createEl("input", {
      type: "text",
      placeholder: "e.g., 2026-03-20",
    });
    applyStyles(this.inputElement, inputStyles);
  }

  private createSuggestionsSection(container: HTMLElement): void {
    this.createSectionLabel(container, "Suggested Dates:");

    const suggestionsContainer = container.createEl("div");
    applyStyles(suggestionsContainer, suggestionsGridStyles);

    for (const suggestion of buildDateSuggestions().slice(0, 10)) {
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

    if (!dateValue) {
      return;
    }

    try {
      await this.onSubmit(this.taskLine, dateValue);
      this.close();
    } catch (error) {
      console.error("Failed to add due date:", error);
    }
  }
}

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}
