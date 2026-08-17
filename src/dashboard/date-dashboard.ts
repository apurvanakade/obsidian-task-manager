/**
 * Purpose:
 * - render and refresh the right-sidebar date dashboard view.
 *
 * Responsibilities:
 * - registers and refreshes the custom dashboard view
 * - reacts to vault/workspace events with debounced refresh scheduling
 * - renders Due and Completed sections for YYYY-MM-DD active notes, plus a link into the
 *   "Organize Captured Tasks into Projects" tab
 * - formats display fields (filename cleanup, recurrence labels, and MM-DD due-date rendering)
 *
 * Dependencies:
 * - depends on dashboard-task-data.ts for data collection/parsing (Due/Completed logic).
 * - Obsidian view/workspace/vault APIs for lifecycle and rendering
 *
 * Side Effects:
 * - manipulates dashboard DOM and opens links in workspace
 *
 * Notes:
 * - Captured tasks (Quick Capture writes to today's daily note, not a dedicated inbox
 *   file) are reviewed via the "Organize Captured Tasks into Projects" tab, linked from
 *   this dashboard.
 */
import { App, ItemView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { getTodayDateString } from "../date/date-utils";
import { collectTasksForDate, DashboardRow, getDateStringFromFileName } from "./dashboard-task-data";
import { applyPriorityStyle, buildGroupedTaskTable, formatMonthDay } from "../tables/grouped-task-table";
import { appendSearchBox, matchesSearch } from "../ui/search-filter";
import { appendPriorityFilter, filterByMaxPriority, PriorityFilterValue } from "../ui/priority-filter";

const MARKDOWN_EXTENSION_REGEX = /\.md$/i;

type DateDashboardControllerOptions = {
  app: App;
  getTaskFolderRoots: () => string[];
  getHideKeywords: () => string;
  openCapturedTasksView: () => void;
};

export class DateDashboardController {
  static readonly VIEW_TYPE = "task-manager-date-dashboard";

  private readonly app: App;
  private readonly getTaskFolderRoots: () => string[];
  private refreshHandle: number | null = null;
  private readonly getHideKeywords: () => string;
  private readonly openCapturedTasksView: () => void;
  private searchQuery = "";
  private selectedMaxPriority: PriorityFilterValue = null;
  private cached: {
    sourcePath: string;
    dueTasks: DashboardRow[];
    completedTasks: DashboardRow[];
  } | null = null;
  private resultsContainer: HTMLElement | null = null;

  constructor(options: DateDashboardControllerOptions) {
    this.app = options.app;
    this.getTaskFolderRoots = options.getTaskFolderRoots;
    this.getHideKeywords = options.getHideKeywords;
    this.openCapturedTasksView = options.openCapturedTasksView;
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

    this.appendPriorityFilterControl(dashboard);
    this.appendSearchFilter(dashboard);

    const resultsContainer = document.createElement("div");
    dashboard.appendChild(resultsContainer);
    this.resultsContainer = resultsContainer;

    const tasks = await collectTasksForDate(this.app, this.getTaskFolderRoots(), dateString);

    this.cached = {
      sourcePath,
      dueTasks: tasks.dueTasks,
      completedTasks: tasks.completedTasks,
    };
    this.renderResults();

    container.innerHTML = "";
    container.appendChild(dashboard);
  }

  private appendPriorityFilterControl(container: HTMLElement): void {
    appendPriorityFilter(container, this.selectedMaxPriority, (value) => {
      this.selectedMaxPriority = value;
      this.renderResults();
    });
  }

  private appendSearchFilter(container: HTMLElement): void {
    appendSearchBox(container, this.searchQuery, (query) => {
      this.searchQuery = query;
      this.renderResults();
    });
  }

  /** Re-renders just the section content from already-fetched data — no refetch, no input rebuild (preserves focus while typing). */
  private renderResults(): void {
    if (!this.resultsContainer || !this.cached) return;

    const { sourcePath, dueTasks, completedTasks } = this.cached;
    const container = this.resultsContainer;
    container.innerHTML = "";

    this.appendDueSection(container, this.filterRows(dueTasks), sourcePath);
    this.appendOrganizeCapturedTasksLink(container);
    this.appendTaskTable(container, "Completed", this.filterRows(completedTasks), sourcePath, false);
  }

  private filterRows(rows: DashboardRow[]): DashboardRow[] {
    return this.filterBySearch(filterByMaxPriority(rows, this.selectedMaxPriority));
  }

  private filterBySearch(rows: DashboardRow[]): DashboardRow[] {
    if (!this.searchQuery.trim()) {
      return rows;
    }

    return rows.filter((row) => matchesSearch(this.searchQuery, row.task));
  }

  /**
   * Entry point into the "Organize Captured Tasks into Projects" tab. Quick Capture
   * writes to today's daily note; this link is where the full ±1yr backlog across all
   * daily notes gets reviewed and bundled into projects.
   */
  private appendOrganizeCapturedTasksLink(container: HTMLElement): void {
    const organizeLink = document.createElement("a");
    organizeLink.href = "#";
    organizeLink.textContent = "Organize Captured Tasks into Projects";
    organizeLink.classList.add("internal-link");
    organizeLink.addEventListener("click", (event) => {
      event.preventDefault();
      this.openCapturedTasksView();
    });
    container.appendChild(organizeLink);
  }

  private emptyMessage(): string {
    return this.searchQuery.trim() ? "No matches." : "No tasks.";
  }

  private appendDueSection(container: HTMLElement, rows: DashboardRow[], sourcePath: string): void {
    const heading = document.createElement("h3");
    heading.textContent = "Due";
    container.appendChild(heading);

    this.appendTaskTableContent(container, rows, sourcePath, true);
  }

  private isRelevantFile(file: unknown): boolean {
    if (!(file instanceof TFile)) return false;
    if (!MARKDOWN_EXTENSION_REGEX.test(file.name)) return false;
    const roots = this.getTaskFolderRoots().filter(Boolean);
    return roots.some((root) => file.path.startsWith(`${root}/`));
  }

  private queueRefresh(): void {
    if (this.refreshHandle !== null) {
      window.clearTimeout(this.refreshHandle);
    }

    this.refreshHandle = window.setTimeout(() => {
      this.refreshHandle = null;
      void this.refreshView();
    }, 300);
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

  private appendTaskTableContent(container: HTMLElement, rows: DashboardRow[], sourcePath: string, showDueDate: boolean): void {
    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = this.emptyMessage();
      container.appendChild(emptyState);
      return;
    }

    const folderGroups = buildGroupedTaskTable(rows, this.getHideKeywords());

    const table = document.createElement("table");

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const labels = showDueDate
      ? ["Folder", "Project", "Task", "Priority", "Recurrence", "Due"]
      : ["Folder", "Project", "Task", "Priority", "Recurrence"];
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
            const fileCell = this.createFileCell(fileGroup.displayFileName, row.file.path, sourcePath, row.priority);
            if (fileGroup.rows.length > 1) {
              fileCell.rowSpan = fileGroup.rows.length;
            }
            tableRow.appendChild(fileCell);
          }

          tableRow.appendChild(this.createTaskCell(row.task));
          tableRow.appendChild(this.createTextElement("td", String(row.priority)));
          tableRow.appendChild(this.createTextElement("td", row.recurrence));
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

  private createFileCell(displayFileName: string, filePath: string, sourcePath: string, priority: number): HTMLTableCellElement {
    const fileCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = displayFileName;
    link.classList.add("internal-link");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(filePath, sourcePath);
    });
    applyPriorityStyle(link, priority);
    fileCell.appendChild(link);
    return fileCell;
  }

  private createTextElement<K extends keyof HTMLElementTagNameMap>(tagName: K, text: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tagName);
    element.textContent = text;
    return element;
  }

  private createTaskCell(task: string): HTMLTableCellElement {
    const taskCell = document.createElement("td");
    taskCell.textContent = task;
    return taskCell;
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
