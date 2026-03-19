import { App, Modal } from "obsidian";

type DueDateModalOptions = {
  app: App;
  taskLine: string;
  onSubmit: (taskLine: string, dueDate: string) => Promise<void>;
};

function buildDateSuggestions(): { value: string; label: string }[] {
  const suggestions: { value: string; label: string }[] = [];
  const today = new Date();

  for (let i = 0; i < 30; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateStr = formatDate(date);
    const rel = i === 0 ? "Today" : i === 1 ? "Tomorrow" : `+${i}d`;
    suggestions.push({
      value: dateStr,
      label: `${dateStr} (${rel})`
    });
  }

  return suggestions;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class DueDateModal extends Modal {
  private taskLine: string;
  private onSubmit: (taskLine: string, dueDate: string) => Promise<void>;
  private selectedDate: string = "";
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

    const descEl = contentEl.createEl("p", {
      text: "Would you like to add a due date for this task?"
    });
    descEl.style.marginBottom = "20px";

    // Create input field
    const inputContainer = contentEl.createEl("div");
    inputContainer.style.marginBottom = "15px";

    const label = inputContainer.createEl("label");
    label.style.display = "block";
    label.style.marginBottom = "8px";
    label.style.fontWeight = "bold";
    label.textContent = "Due Date (YYYY-MM-DD):";

    this.inputElement = inputContainer.createEl("input", {
      type: "text",
      placeholder: "e.g., 2026-03-20"
    });
    this.inputElement.style.width = "100%";
    this.inputElement.style.padding = "8px";
    this.inputElement.style.boxSizing = "border-box";
    this.inputElement.style.marginBottom = "10px";

    // Suggested dates section
    const suggestionsLabel = contentEl.createEl("label");
    suggestionsLabel.style.display = "block";
    suggestionsLabel.style.marginBottom = "8px";
    suggestionsLabel.style.fontWeight = "bold";
    suggestionsLabel.textContent = "Suggested Dates:";

    const suggestionsContainer = contentEl.createEl("div");
    suggestionsContainer.style.display = "grid";
    suggestionsContainer.style.gridTemplateColumns = "1fr 1fr";
    suggestionsContainer.style.gap = "8px";
    suggestionsContainer.style.marginBottom = "15px";

    const suggestions = buildDateSuggestions().slice(0, 10);
    suggestions.forEach((suggestion) => {
      const btn = suggestionsContainer.createEl("button", {
        text: suggestion.label
      });
      btn.style.padding = "8px";
      btn.style.cursor = "pointer";
      btn.onclick = () => {
        this.selectedDate = suggestion.value;
        if (this.inputElement) {
          this.inputElement.value = suggestion.value;
        }
      };
    });

    // Action buttons
    const buttonContainer = contentEl.createEl("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "10px";
    buttonContainer.style.justifyContent = "flex-end";

    const addBtn = buttonContainer.createEl("button", { text: "Add Due Date" });
    addBtn.style.padding = "8px 16px";
    addBtn.style.cursor = "pointer";
    addBtn.style.backgroundColor = "#4CAF50";
    addBtn.style.color = "white";
    addBtn.style.border = "none";
    addBtn.style.borderRadius = "4px";
    addBtn.onclick = () => {
      void this.submitDate();
    };

    const skipBtn = buttonContainer.createEl("button", { text: "Skip" });
    skipBtn.style.padding = "8px 16px";
    skipBtn.style.cursor = "pointer";
    skipBtn.style.backgroundColor = "#f0f0f0";
    skipBtn.style.border = "1px solid #ccc";
    skipBtn.style.borderRadius = "4px";
    skipBtn.onclick = () => {
      this.close();
    };

    if (this.inputElement) {
      this.inputElement.focus();
    }
  }

  private async submitDate(): Promise<void> {
    const dateValue = this.inputElement?.value.trim() ?? this.selectedDate;

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
