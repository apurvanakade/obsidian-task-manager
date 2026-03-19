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
 * - depends on dashboard-task-data.ts for data collection/parsing.
 * - Obsidian view/workspace/vault APIs for lifecycle and rendering
 *
 * Side Effects:
 * - manipulates dashboard DOM and opens links in workspace
 */
import { App, ItemView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { collectTasksForDate, DashboardRow, getDateStringFromFileName } from "./dashboard-task-data";

const MARKDOWN_EXTENSION_REGEX = /\.md$/i;
const MONTH_DAY_REGEX = /^\d{4}-(\d{2})-(\d{2})$/;
const LEADING_ARCHIVE_MARKER_PATTERN = /^(?:[\s._-]*(?:\d{4}[-_. ]\d{1,2}[-_. ]\d{1,2}|\d{1,2}[-_:]\d{2}(?:[-_:]\d{2})?|\d+(?:-\d+)+|\d+))+[\s._-]*/;

type DateDashboardControllerOptions = {
  app: App;
  getTaskFolderRoots: () => string[];
};

export class DateDashboardController {
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

    const dateString = getDateStringFromFileName(activeFile.name);
    if (!dateString) {
      container.appendChild(this.createEmptyState());
      return;
    }

    const dashboard = document.createElement("section");

    const title = document.createElement("h2");
    title.textContent = `Tasks for ${dateString}`;
    dashboard.appendChild(title);

    const tasks = await collectTasksForDate(this.app, this.getTaskFolderRoots(), dateString);
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