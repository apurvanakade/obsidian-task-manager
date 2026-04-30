/**
 * Purpose:
 * - collect metadata for creating a new project note from a command.
 *
 * Responsibilities:
 * - gathers project name, folder path, file priority, status, and starter tasks
 * - offers typeahead folder suggestions for vault paths
 * - normalizes multiline task input into one task per line
 *
 * Dependencies:
 * - Obsidian modal APIs, plugin settings, and vault folder metadata
 *
 * Side Effects:
 * - opens modal UI and forwards validated input to the submit callback
 */
import { App, Modal, Notice } from "obsidian";
import { TFolder } from "obsidian";
import { getDestinationRootForStatus } from "../routing/task-routing";
import { TaskManagerSettings } from "../settings/settings-utils";

const SECTION_SPACING_STYLES = {
  marginBottom: "14px",
} as const;

const LABEL_STYLES = {
  display: "block",
  marginBottom: "6px",
  fontWeight: "bold",
} as const;

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

const STATUS_OPTIONS = ["todo", "waiting", "someday-maybe"] as const;
const PRIORITY_OPTIONS = ["1", "2", "3"] as const;

export type NewProjectStatus = (typeof STATUS_OPTIONS)[number];

export type AddProjectInput = {
  name: string;
  folder: string;
  priority: 1 | 2 | 3;
  status: NewProjectStatus;
  tasks: string[];
};

type AddProjectModalOptions = {
  app: App;
  settings: TaskManagerSettings;
  onSubmit: (input: AddProjectInput) => Promise<void>;
};

export class AddProjectModal extends Modal {
  private readonly settings: TaskManagerSettings;
  private readonly onSubmit: (input: AddProjectInput) => Promise<void>;
  private readonly folderSuggestions: string[];
  private nameInput: HTMLInputElement | null = null;
  private folderInput: HTMLInputElement | null = null;
  private prioritySelect: HTMLSelectElement | null = null;
  private statusSelect: HTMLSelectElement | null = null;
  private tasksInput: HTMLTextAreaElement | null = null;
  private folderEdited = false;

  constructor(options: AddProjectModalOptions) {
    super(options.app);
    this.settings = options.settings;
    this.onSubmit = options.onSubmit;
    this.folderSuggestions = this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map((folder) => folder.path)
      .sort((left, right) => left.localeCompare(right));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Add New Project" });

    this.createNameSection(contentEl);
    this.createFolderSection(contentEl);
    this.createPrioritySection(contentEl);
    this.createStatusSection(contentEl);
    this.createTasksSection(contentEl);
    this.createActionButtons(contentEl);

    if (this.nameInput) {
      this.nameInput.focus();
    }
  }

  private createNameSection(container: HTMLElement): void {
    const section = container.createEl("div");
    applyStyles(section, SECTION_SPACING_STYLES);
    this.createLabel(section, "Name");

    this.nameInput = section.createEl("input", {
      type: "text",
      placeholder: "Project name",
    });
    applyStyles(this.nameInput, INPUT_STYLES);
  }

  private createFolderSection(container: HTMLElement): void {
    const section = container.createEl("div");
    applyStyles(section, SECTION_SPACING_STYLES);
    this.createLabel(section, "Folder");

    const listId = `task-manager-folder-options-${Date.now()}`;
    const folderList = section.createEl("datalist");
    folderList.id = listId;

    for (const folderPath of this.folderSuggestions) {
      folderList.createEl("option", {
        value: folderPath,
      });
    }

    this.folderInput = section.createEl("input", {
      type: "text",
      placeholder: "Projects",
      value: getDefaultFolderForStatus(this.settings, "todo"),
    });
    this.folderInput.setAttribute("list", listId);
    applyStyles(this.folderInput, INPUT_STYLES);
    this.folderInput.addEventListener("input", () => {
      this.folderEdited = true;
    });
  }

  private createPrioritySection(container: HTMLElement): void {
    const section = container.createEl("div");
    applyStyles(section, SECTION_SPACING_STYLES);
    this.createLabel(section, "Priority");

    this.prioritySelect = section.createEl("select");
    applyStyles(this.prioritySelect, INPUT_STYLES);

    for (const priority of PRIORITY_OPTIONS) {
      const option = this.prioritySelect.createEl("option", {
        text: priority,
        value: priority,
      });
      if (priority === "3") {
        option.selected = true;
      }
    }
  }

  private createStatusSection(container: HTMLElement): void {
    const section = container.createEl("div");
    applyStyles(section, SECTION_SPACING_STYLES);
    this.createLabel(section, "Status");

    this.statusSelect = section.createEl("select");
    applyStyles(this.statusSelect, INPUT_STYLES);

    for (const status of STATUS_OPTIONS) {
      const option = this.statusSelect.createEl("option", {
        text: status,
        value: status,
      });
      if (status === "todo") {
        option.selected = true;
      }
    }

    this.statusSelect.addEventListener("change", () => {
      if (!this.folderInput || this.folderEdited) {
        return;
      }

      this.folderInput.value = getDefaultFolderForStatus(this.settings, this.statusSelect!.value as NewProjectStatus);
    });
  }

  private createTasksSection(container: HTMLElement): void {
    const section = container.createEl("div");
    applyStyles(section, SECTION_SPACING_STYLES);
    this.createLabel(section, "Tasks");

    this.tasksInput = section.createEl("textarea", {
      placeholder: "One task per line",
    });
    applyStyles(this.tasksInput, INPUT_STYLES);
    this.tasksInput.rows = 6;
    this.tasksInput.style.resize = "vertical";
  }

  private createActionButtons(container: HTMLElement): void {
    const row = container.createEl("div");
    applyStyles(row, ACTION_ROW_STYLES);

    const cancelButton = row.createEl("button", { text: "Cancel" });
    applyStyles(cancelButton, SECONDARY_BUTTON_STYLES);
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    const createButton = row.createEl("button", { text: "Create Project" });
    applyStyles(createButton, PRIMARY_BUTTON_STYLES);
    createButton.addEventListener("click", () => {
      void this.submit();
    });
  }

  private createLabel(container: HTMLElement, text: string): HTMLLabelElement {
    const label = container.createEl("label");
    label.textContent = text;
    applyStyles(label, LABEL_STYLES);
    return label;
  }

  private async submit(): Promise<void> {
    const name = this.nameInput?.value.trim() ?? "";
    const folder = normalizePathSegment(this.folderInput?.value ?? "");
    const priorityValue = this.prioritySelect?.value ?? "3";
    const status = (this.statusSelect?.value ?? "todo") as NewProjectStatus;
    const tasks = parseTaskLines(this.tasksInput?.value ?? "");

    if (!name) {
      new Notice("Enter a project name.");
      return;
    }

    const priority = Number.parseInt(priorityValue, 10);
    if (priority !== 1 && priority !== 2 && priority !== 3) {
      new Notice("Choose priority 1, 2, or 3.");
      return;
    }

    try {
      await this.onSubmit({
        name,
        folder,
        priority,
        status,
        tasks,
      });
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to create project.");
    }
  }
}

export function buildProjectFilePath(folderPath: string, name: string): string {
  const trimmedName = name.trim().replace(/\.md$/i, "");
  const fileName = sanitizeFileName(trimmedName);
  if (!fileName) {
    throw new Error("Project name must include at least one valid filename character.");
  }

  return folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
}

export function buildProjectFileContent(
  input: AddProjectInput,
  statusField: string,
): string {
  const lines = [
    "---",
    `${statusField}: ${input.status}`,
    `priority: ${input.priority}`,
    "---",
    "",
    `# ${input.name.trim().replace(/\.md$/i, "")}`,
  ];

  if (input.tasks.length > 0) {
    lines.push("");
    input.tasks.forEach((task) => {
      lines.push(`- [ ] ${task}`);
    });
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function parseTaskLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line
      .replace(/^[-*+]\s+\[(?: |x|X)\]\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .trim())
    .filter((line) => line.length > 0);
}

function getDefaultFolderForStatus(settings: TaskManagerSettings, status: NewProjectStatus): string {
  return getDestinationRootForStatus(settings, status) || "";
}

function normalizePathSegment(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}
