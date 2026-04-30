/**
 * Purpose:
 * - render and refresh the right-sidebar date dashboard view.
 *
 * Responsibilities:
 * - registers and refreshes the custom dashboard view
 * - reacts to vault/workspace events with debounced refresh scheduling
 * - renders Due and Completed task tables for YYYY-MM-DD active notes
 * - formats display fields (filename cleanup and MM-DD due-date rendering)
 *
 * Dependencies:
 * - depends on dashboard-task-data.ts for data collection/parsing (including inbox file logic).
 * - Obsidian view/workspace/vault APIs for lifecycle and rendering
 *
 * Side Effects:
 * - manipulates dashboard DOM and opens links in workspace
 *
 * Notes:
 * - Inbox section now lists all open tasks from the configured inbox file (set in settings).
 */
import { App, ItemView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { getTodayDateString } from "../date/date-utils";
import { collectTasksForDate, collectInboxTasks, DashboardRow, getDateStringFromFileName } from "./dashboard-task-data";
import { buildGroupedTaskTable, formatMonthDay } from "../tables/grouped-task-table";

const MARKDOWN_EXTENSION_REGEX = /\.md$/i;

type DateDashboardControllerOptions = {
  app: App;
  getTaskFolderRoots: () => string[];
  getInboxFile: () => string;
  getHideKeywords: () => string;
};

export class DateDashboardController {
  static readonly VIEW_TYPE = "task-manager-date-dashboard";

  private readonly app: App;
  private readonly getTaskFolderRoots: () => string[];
  private refreshHandle: number | null = null;
  private readonly getInboxFile: () => string;
  private readonly getHideKeywords: () => string;

  constructor(options: DateDashboardControllerOptions) {
    this.app = options.app;
    this.getTaskFolderRoots = options.getTaskFolderRoots;
    this.getInboxFile = options.getInboxFile;
    this.getHideKeywords = options.getHideKeywords;
  }

  async onload(plugin: Plugin): Promise<void> {
    plugin.registerView(DateDashboardController.VIEW_TYPE, (leaf) => new DateDashboardView(leaf, this));
    plugin.registerEvent(this.app.vault.on("modify", (file) => {
      if (this.isRelevantFile(file)) {
        this.queueRefresh();
      }
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
    const dateString = activeFile
      ? getDateStringFromFileName(activeFile.name) ?? getTodayDateString()
      : getTodayDateString();
    const sourcePath = activeFile?.path ?? "";

    const dashboard = document.createElement("section");

    const title = document.createElement("h2");
    title.textContent = `Tasks for ${dateString}`;
    dashboard.appendChild(title);

    // Due tasks
    const tasks = await collectTasksForDate(this.app, this.getTaskFolderRoots(), dateString);
    this.appendDueSection(dashboard, tasks.dueTasks, sourcePath);

    // Inbox section (from inbox file)
    const inboxFile = this.getInboxFile();
    const inboxTasks = await collectInboxTasks(this.app, inboxFile);
    this.appendInboxSection(dashboard, inboxFile, inboxTasks);
    // Completed tasks
    this.appendTaskTable(dashboard, "Completed", tasks.completedTasks, sourcePath, false);

    container.appendChild(dashboard);
  }

  /**
   * Renders the Inbox section: heading, link to inbox file, and a plain list of tasks (no table, no priorities).
   */
  private appendInboxSection(container: HTMLElement, inboxFile: string, inboxTasks: DashboardRow[]): void {
    const heading = document.createElement("h3");
    heading.textContent = "Inbox";
    container.appendChild(heading);

    if (inboxFile) {
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = `Open inbox file`;
      link.classList.add("internal-link");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.app.workspace.openLinkText(inboxFile, "");
      });
      container.appendChild(link);
    }

    if (inboxTasks.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No tasks.";
      container.appendChild(emptyState);
      return;
    }

    const ul = document.createElement("ul");
    for (const row of inboxTasks) {
      const li = document.createElement("li");
      li.textContent = row.task;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  private appendDueSection(container: HTMLElement, rows: DashboardRow[], sourcePath: string): void {
    const heading = document.createElement("h3");
    heading.textContent = "Due";
    container.appendChild(heading);

    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No tasks.";
      container.appendChild(emptyState);
      return;
    }

    const nonRecurringRows = rows.filter((row) => !row.isRecurring);
    const recurringRows = rows.filter((row) => row.isRecurring);

    this.appendTaskTableGroup(container, "Non-recurring Tasks", nonRecurringRows, sourcePath, true);
    this.appendTaskTableGroup(container, "Recurring Tasks", recurringRows, sourcePath, true);
  }

  private isRelevantFile(file: unknown): boolean {
    if (!(file instanceof TFile)) return false;
    if (!MARKDOWN_EXTENSION_REGEX.test(file.name)) return false;
    const roots = this.getTaskFolderRoots().filter(Boolean);
    const inboxFile = this.getInboxFile();
    const inTaskFolder = roots.some((root) => file.path.startsWith(`${root}/`));
    const isInbox = !!inboxFile && file.path === inboxFile;
    return inTaskFolder || isInbox;
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

  private appendTaskTable(container: HTMLElement, title: string, rows: DashboardRow[], sourcePath: string, showDueDate: boolean): void {
    const heading = document.createElement("h3");
    heading.textContent = title;
    container.appendChild(heading);

    this.appendTaskTableContent(container, rows, sourcePath, showDueDate);
  }

  private appendTaskTableGroup(
    container: HTMLElement,
    title: string,
    rows: DashboardRow[],
    sourcePath: string,
    showDueDate: boolean,
  ): void {
    const heading = document.createElement("h4");
    heading.textContent = title;
    container.appendChild(heading);

    this.appendTaskTableContent(container, rows, sourcePath, showDueDate);
  }

  private appendTaskTableContent(container: HTMLElement, rows: DashboardRow[], sourcePath: string, showDueDate: boolean): void {
    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No tasks.";
      container.appendChild(emptyState);
      return;
    }

    const folderGroups = buildGroupedTaskTable(rows, this.getHideKeywords());

    const table = document.createElement("table");

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const labels = showDueDate
      ? ["Folder", "Filename", "Task", "Priority", "Due"]
      : ["Folder", "Filename", "Task", "Priority"];
    for (const label of labels) {
      headerRow.appendChild(this.createTextElement("th", label));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    for (const folderGroup of folderGroups) {
      let folderCellEmitted = false;

      for (const fileGroup of folderGroup.files) {
        for (let i = 0; i < fileGroup.rows.length; i++) {
          const row = fileGroup.rows[i];
          const tableRow = document.createElement("tr");

          if (!folderCellEmitted) {
            const folderCell = this.createTextElement("td", folderGroup.displayFolderName);
            if (folderGroup.rowCount > 1) {
              folderCell.rowSpan = folderGroup.rowCount;
            }
            tableRow.appendChild(folderCell);
            folderCellEmitted = true;
          }

          if (i === 0) {
            const fileCell = this.createFileCell(fileGroup.displayFileName, row.file.path, sourcePath);
            if (fileGroup.rows.length > 1) {
              fileCell.rowSpan = fileGroup.rows.length;
            }
            tableRow.appendChild(fileCell);
          }

          tableRow.appendChild(this.createTaskCell(row.task, row.priority));
          tableRow.appendChild(this.createTextElement("td", String(row.priority)));
          if (showDueDate) {
            tableRow.appendChild(this.createTextElement("td", formatMonthDay(row.dueDate)));
          }
          tbody.appendChild(tableRow);
        }
      }
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  private createFileCell(displayFileName: string, filePath: string, sourcePath: string): HTMLTableCellElement {
    const fileCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = displayFileName;
    link.classList.add("internal-link");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(filePath, sourcePath);
    });
    fileCell.appendChild(link);
    return fileCell;
  }

  private createTextElement<K extends keyof HTMLElementTagNameMap>(tagName: K, text: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    element.textContent = text;
    return element;
  }

  private createTaskCell(task: string, priority: number): HTMLTableCellElement {
    const taskCell = document.createElement("td");
    taskCell.textContent = task;
    this.applyPriorityTextStyle(taskCell, priority);
    return taskCell;
  }

  private applyPriorityTextStyle(element: HTMLElement, priority: number): void {
    if (priority === 1) {
      element.style.fontWeight = "700";
      return;
    }

    if (priority === 2) {
      element.style.fontStyle = "italic";
    }
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
