/**
 * Purpose:
 * - collect a single line of task text (with an optional due-date shorthand) for capture.
 *
 * Responsibilities:
 * - presents a minimal single-input capture modal, submit on Enter
 * - recognizes a trailing `due:<value>` shorthand token and resolves it via the shared
 *   date-suggestion resolver, splitting it out of the captured task text
 * - Note: contexts are not a supported concept in this plugin; a trailing `@token` is
 *   left as ordinary task text.
 *
 * Dependencies:
 * - Obsidian Modal APIs
 * - shared date-suggestion resolver (src/date/date-suggestions.ts)
 *
 * Side Effects:
 * - opens modal UI and forwards the parsed result to the submit callback
 */
import { App, Modal, Notice } from "obsidian";
import { resolveDateInput } from "../date/date-suggestions";

const INPUT_STYLES = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px",
} as const;

const ACTION_ROW_STYLES = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "18px",
} as const;

const PRIMARY_BUTTON_STYLES = {
  backgroundColor: "#4CAF50",
  color: "white",
  border: "none",
  borderRadius: "4px",
  padding: "8px 16px",
} as const;

const SECONDARY_BUTTON_STYLES = {
  backgroundColor: "#f0f0f0",
  border: "1px solid #000",
  borderRadius: "4px",
  padding: "8px 16px",
} as const;

const DUE_TOKEN_REGEX = /^due:(\S+)$/i;

export type QuickCaptureResult = {
  text: string;
  dueDate: string | null;
};

/**
 * Peels a recognized trailing `due:<value>` shorthand token off the end of the raw
 * input, resolved via the shared date-suggestion resolver. An unresolvable `due:` token
 * is left in place as ordinary task text rather than being dropped.
 */
export function parseQuickCaptureShorthand(rawInput: string): QuickCaptureResult {
  const remaining = rawInput.trim();
  const lastSpaceIndex = remaining.lastIndexOf(" ");
  const lastToken = lastSpaceIndex === -1 ? remaining : remaining.slice(lastSpaceIndex + 1);

  const dueMatch = lastToken.match(DUE_TOKEN_REGEX);
  if (dueMatch) {
    const resolvedDate = resolveDateInput(dueMatch[1]);
    if (resolvedDate) {
      const textWithoutDue = lastSpaceIndex === -1 ? "" : remaining.slice(0, lastSpaceIndex);
      return { text: textWithoutDue.trim(), dueDate: resolvedDate };
    }
  }

  return { text: remaining, dueDate: null };
}

type QuickCaptureModalOptions = {
  app: App;
  onSubmit: (result: QuickCaptureResult) => Promise<void>;
};

export class QuickCaptureModal extends Modal {
  private readonly onSubmit: (result: QuickCaptureResult) => Promise<void>;
  private inputElement: HTMLInputElement | null = null;

  constructor(options: QuickCaptureModalOptions) {
    super(options.app);
    this.onSubmit = options.onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Capture Task" });
    contentEl.createEl("p", {
      text: "Added to today's daily note as an open task. Optionally end with due:tomorrow / due:2026-07-20.",
    });

    this.inputElement = contentEl.createEl("input", {
      type: "text",
      placeholder: "e.g., Call the dentist due:tomorrow",
    });
    applyStyles(this.inputElement, INPUT_STYLES);
    this.inputElement.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      void this.submit();
    });

    this.createActionButtons(contentEl);
    this.inputElement.focus();
  }

  private createActionButtons(container: HTMLElement): void {
    const row = container.createEl("div");
    applyStyles(row, ACTION_ROW_STYLES);

    const cancelButton = row.createEl("button", { text: "Cancel" });
    applyStyles(cancelButton, SECONDARY_BUTTON_STYLES);
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    const captureButton = row.createEl("button", { text: "Capture" });
    applyStyles(captureButton, PRIMARY_BUTTON_STYLES);
    captureButton.addEventListener("click", () => {
      void this.submit();
    });
  }

  private async submit(): Promise<void> {
    const rawInput = this.inputElement?.value ?? "";
    if (!rawInput.trim()) {
      return;
    }

    const result = parseQuickCaptureShorthand(rawInput);
    if (!result.text) {
      new Notice("Enter some task text.");
      return;
    }

    try {
      await this.onSubmit(result);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to capture task.");
    }
  }
}

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}
