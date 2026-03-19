import { App, ItemView, Plugin, TFile, WorkspaceLeaf } from "obsidian";

const EMPTY_DUE_DATE_SORT_VALUE = "9999-99-99";
const MARKDOWN_EXTENSION_REGEX = /\.md$/i;
const TASK_LINE_REGEX = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;
const COMPLETION_DATE_FIELD_REGEX = /\[completion-date::\s*([^\]]+?)\s*\]/i;
const INLINE_FIELD_REGEX = /\s*\[[^\]]+::\s*[^\]]*\]/g;
const TAG_REGEX = /(^|\s)#[^\s#]+/g;
const MULTISPACE_REGEX = /\s+/g;
const MONTH_DAY_REGEX = /^\d{4}-(\d{2})-(\d{2})$/;
const LEADING_ARCHIVE_MARKER_PATTERN = /^(?:[\s._-]*(?:\d{4}[-_. ]\d{1,2}[-_. ]\d{1,2}|\d{1,2}[-_:]\d{2}(?:[-_:]\d{2})?|\d+(?:-\d+)+|\d+))+[\s._-]*/;

type DateDashboardControllerOptions = {
  app: App;
  getTaskFolderRoots: () => string[];
};

type DashboardRow = {
  file: TFile;
  task: string;
  dueDate: string | null;
};

type ParsedDashboardTask = {
  text: string;
  status: "open" | "completed";
  dueDate: string | null;
  completedDate: string | null;
};

export class DateDashboardController {
  private static readonly DATE_FILE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  static readonly VIEW_TYPE = "task-manager-date-dashboard";

  private readonly app: App;
  private readonly getTaskFolderRoots: () => string[];
  private refreshHandle: number | null = null;

  constructor(options: DateDashboardControllerOptions) {
    this.app = options.app;
    this.getTaskFolderRoots = options.getTaskFolderRoots;
  }

  async onload(plugin: Plugin): Promise<void> {
    plugin.registerView(DateDashboardController.VIEW_TYPE, (leaf) => new DateDashboardView(leaf, this));
    plugin.registerEvent(this.app.vault.on("modify", () => {
      this.queueRefresh();
    }));
    plugin.registerEvent(this.app.vault.on("rename", () => {
      this.queueRefresh();
    }));
    plugin.registerEvent(this.app.vault.on("delete", () => {
      this.queueRefresh();
    }));
    plugin.registerEvent(this.app.workspace.on("file-open", () => {
      this.queueRefresh();
    }));
    plugin.registerEvent(this.app.workspace.on("layout-change", () => {
      this.queueRefresh();
    }));

    await this.ensureView();
    await this.refreshView();
  }

  onunload(): void {
    if (this.refreshHandle !== null) {
      window.clearTimeout(this.refreshHandle);
      this.refreshHandle = null;
    }
  }

  refreshSoon(): void {
    this.queueRefresh();
  }

  async renderContent(container: HTMLElement): Promise<void> {
    container.innerHTML = "";
    container.classList.add("markdown-rendered");

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      container.appendChild(this.createEmptyState());
      return;
    }

    const dateString = this.getDateStringFromFileName(activeFile.name);
    if (!dateString) {
      container.appendChild(this.createEmptyState());
      return;
    }

    const dashboard = document.createElement("section");

    const title = document.createElement("h2");
    title.textContent = `Tasks for ${dateString}`;
    dashboard.appendChild(title);

    const tasks = await this.collectTasksForDate(dateString);
    this.appendTaskTable(dashboard, "Due", tasks.dueTasks, activeFile.path, true);
    this.appendTaskTable(dashboard, "Completed", tasks.completedTasks, activeFile.path, false);

    container.appendChild(dashboard);
  }

  private queueRefresh(): void {
    if (this.refreshHandle !== null) {
      window.clearTimeout(this.refreshHandle);
    }

    this.refreshHandle = window.setTimeout(() => {
      this.refreshHandle = null;
      void this.refreshView();
    }, 50);
  }

  private async ensureView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(DateDashboardController.VIEW_TYPE)[0];
    if (existingLeaf) {
      return;
    }

    const leaf = await this.app.workspace.ensureSideLeaf(DateDashboardController.VIEW_TYPE, "right", {
      active: false,
      reveal: true,
      // Prefer a split side leaf so the dashboard starts in a half-height sidebar pane.
      split: true,
    });
    await leaf.setViewState({ type: DateDashboardController.VIEW_TYPE, active: false });
  }

  private async refreshView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(DateDashboardController.VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof DateDashboardView) {
        await view.refresh();
      }
    }
  }

  private createEmptyState(): HTMLParagraphElement {
    const emptyState = document.createElement("p");
    emptyState.textContent = "Open a date note named like YYYY-MM-DD to view the dashboard.";
    return emptyState;
  }

  private getDateStringFromFileName(fileName: string): string | null {
    const baseName = fileName.replace(MARKDOWN_EXTENSION_REGEX, "");
    return DateDashboardController.DATE_FILE_REGEX.test(baseName) ? baseName : null;
  }

  private async collectTasksForDate(dateString: string): Promise<{
    dueTasks: DashboardRow[];
    completedTasks: DashboardRow[];
  }> {
    const dueTasks: DashboardRow[] = [];
    const completedTasks: DashboardRow[] = [];
    const taskFolderRoots = this.getTaskFolderRoots();
    const files = this.app.vault.getMarkdownFiles().filter((file) =>
      taskFolderRoots.some((root) => file.path.startsWith(`${root}/`))
    );

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const lines = content.split(/\r?\n/);

      for (const line of lines) {
        const parsedTask = this.parseDashboardTaskLine(line);
        if (!parsedTask) {
          continue;
        }

        if (parsedTask.status === "open" && parsedTask.dueDate !== null && parsedTask.dueDate <= dateString) {
          dueTasks.push({ file, task: parsedTask.text, dueDate: parsedTask.dueDate });
        }

        if (parsedTask.completedDate === dateString) {
          completedTasks.push({ file, task: parsedTask.text, dueDate: null });
        }
      }
    }

    dueTasks.sort(DateDashboardController.compareDueRows);
    completedTasks.sort(DateDashboardController.compareRows);

    return { dueTasks, completedTasks };
  }

  private parseDashboardTaskLine(line: string): ParsedDashboardTask | null {
    const match = line.match(TASK_LINE_REGEX);
    if (!match) {
      return null;
    }

    const status = match[1].trim().toLowerCase() === "x" ? "completed" : "open";
    const taskBody = match[2].trim();
    const dueDate = this.readInlineFieldValue(taskBody, DUE_FIELD_REGEX);
    const completedDate = this.readInlineFieldValue(taskBody, COMPLETION_DATE_FIELD_REGEX);

    if (!dueDate && !completedDate) {
      return null;
    }

    return {
      text: this.cleanDashboardTaskText(taskBody),
      status,
      dueDate,
      completedDate,
    };
  }

  private readInlineFieldValue(taskBody: string, fieldRegex: RegExp): string | null {
    const match = taskBody.match(fieldRegex);
    return match ? match[1].trim() : null;
  }

  private cleanDashboardTaskText(taskBody: string): string {
    return taskBody
      .replace(INLINE_FIELD_REGEX, "")
      .replace(TAG_REGEX, "$1")
      .replace(MULTISPACE_REGEX, " ")
      .trim();
  }

  private appendTaskTable(container: HTMLElement, title: string, rows: DashboardRow[], sourcePath: string, showDueDate: boolean): void {
    const heading = document.createElement("h3");
    heading.textContent = title;
    container.appendChild(heading);

    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No tasks.";
      container.appendChild(emptyState);
      return;
    }

    const table = document.createElement("table");

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const labels = showDueDate ? ["Filename", "Task", "Due"] : ["Filename", "Task"];
    for (const label of labels) {
      headerRow.appendChild(this.createTextElement("th", label));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      tbody.appendChild(this.createTaskRow(row, sourcePath, showDueDate));
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  private createTaskRow(row: DashboardRow, sourcePath: string, showDueDate: boolean): HTMLTableRowElement {
    const tableRow = document.createElement("tr");
    tableRow.appendChild(this.createFileCell(row, sourcePath));
    tableRow.appendChild(this.createTextElement("td", row.task));

    if (showDueDate) {
      tableRow.appendChild(this.createTextElement("td", this.formatMonthDay(row.dueDate)));
    }

    return tableRow;
  }

  private createFileCell(row: DashboardRow, sourcePath: string): HTMLTableCellElement {
    const fileCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = this.getDisplayFileName(row.file.name);
    link.classList.add("internal-link");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(row.file.path, sourcePath);
    });
    fileCell.appendChild(link);
    return fileCell;
  }

  private createTextElement<K extends keyof HTMLElementTagNameMap>(tagName: K, text: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    element.textContent = text;
    return element;
  }

  private formatMonthDay(dateString: string | null): string {
    if (!dateString) {
      return "";
    }

    const match = dateString.match(MONTH_DAY_REGEX);
    return match ? `${match[1]}-${match[2]}` : dateString;
  }

  private getDisplayFileName(fileName: string): string {
    const withoutExtension = fileName.replace(MARKDOWN_EXTENSION_REGEX, "");
    const withoutArchiveMarkers = withoutExtension
      .replace(LEADING_ARCHIVE_MARKER_PATTERN, "")
      .replace(/^[\s._-]+/, "")
      .replace(/[\s._-]+$/, "")
      .replace(/[._-]{2,}/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return withoutArchiveMarkers || withoutExtension;
  }

  private static compareRows(left: DashboardRow, right: DashboardRow): number {
    const pathCompare = left.file.path.localeCompare(right.file.path);
    if (pathCompare !== 0) {
      return pathCompare;
    }

    return left.task.localeCompare(right.task);
  }

  private static compareDueRows(left: DashboardRow, right: DashboardRow): number {
    const leftDueDate = left.dueDate ?? EMPTY_DUE_DATE_SORT_VALUE;
    const rightDueDate = right.dueDate ?? EMPTY_DUE_DATE_SORT_VALUE;
    const dueDateCompare = leftDueDate.localeCompare(rightDueDate);
    if (dueDateCompare !== 0) {
      return dueDateCompare;
    }

    return DateDashboardController.compareRows(left, right);
  }
}

class DateDashboardView extends ItemView {
  private readonly controller: DateDashboardController;

  constructor(leaf: WorkspaceLeaf, controller: DateDashboardController) {
    super(leaf);
    this.controller = controller;
  }

  getViewType(): string {
    return DateDashboardController.VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Date Dashboard";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.controller.renderContent(this.contentEl);
  }
}