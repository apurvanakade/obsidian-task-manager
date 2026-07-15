/**
 * Purpose:
 * - render the on-demand Tasks Summary tab: every actionable open task across
 *   Projects, Waiting, Someday-Maybe, and the Inbox.
 *
 * Responsibilities:
 * - registers and opens a main-panel ItemView (not a persistent sidebar leaf, and not
 *   a generated markdown note — see CLAUDE.md's Tasks Summary section for why)
 * - renders one grouped task table per section, reusing the same Folder/Filename/Task/
 *   Priority/Recurrence/Context/Due columns and hide-keyword display cleanup as the
 *   date dashboard
 * - offers a live Context filter dropdown (session-only, mirroring the date dashboard's)
 * - while a Tasks Summary tab is open, auto-refreshes it (debounced) whenever a
 *   relevant task file is modified/renamed/deleted elsewhere
 *
 * Dependencies:
 * - depends on tasks-summary.ts for row collection
 * - Obsidian ItemView/workspace/vault APIs
 *
 * Side Effects:
 * - manipulates view DOM only; no vault writes
 */
import { App, ItemView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";
import { isInFolder } from "./summary-file-io";
import { collectTaskSummarySections, TaskSummaryRow, TaskSummarySection } from "./tasks-summary";
import { buildGroupedTaskTable, formatMonthDay } from "../tables/grouped-task-table";

type TasksSummaryControllerOptions = {
  app: App;
  getSettings: () => TaskManagerSettings;
  getKnownContexts: () => string[];
};

export class TasksSummaryController {
  static readonly VIEW_TYPE = "task-manager-tasks-summary";

  private readonly app: App;
  private readonly getSettings: () => TaskManagerSettings;
  private readonly getKnownContexts: () => string[];
  private selectedContext: string | null = null;
  private refreshHandle: number | null = null;

  constructor(options: TasksSummaryControllerOptions) {
    this.app = options.app;
    this.getSettings = options.getSettings;
    this.getKnownContexts = options.getKnownContexts;
  }

  onload(plugin: Plugin): void {
    plugin.registerView(TasksSummaryController.VIEW_TYPE, (leaf) => new TasksSummaryView(leaf, this));
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
  }

  onunload(): void {
    if (this.refreshHandle !== null) {
      window.clearTimeout(this.refreshHandle);
      this.refreshHandle = null;
    }
  }

  /** Opens the Tasks Summary tab, reusing an existing one if already open. */
  async openView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(TasksSummaryController.VIEW_TYPE)[0];
    if (existingLeaf) {
      this.app.workspace.revealLeaf(existingLeaf);
      if (existingLeaf.view instanceof TasksSummaryView) {
        await existingLeaf.view.refresh();
      }
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: TasksSummaryController.VIEW_TYPE, active: true });
  }

  refreshSoon(): void {
    this.queueRefresh();
  }

  async renderContent(container: HTMLElement): Promise<void> {
    container.innerHTML = "";
    container.classList.add("markdown-rendered");

    const settings = this.getSettings();
    const section = document.createElement("section");

    const title = document.createElement("h2");
    title.textContent = "Tasks Summary";
    section.appendChild(title);

    this.appendContextFilter(section);

    const sections = await collectTaskSummarySections(this.app, settings);
    for (const taskSection of sections) {
      this.appendSection(section, taskSection, settings);
    }

    container.appendChild(section);
  }

  private appendContextFilter(container: HTMLElement): void {
    const knownContexts = this.getKnownContexts();
    if (knownContexts.length === 0) {
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "10px";

    const label = document.createElement("label");
    label.textContent = "Context: ";
    wrapper.appendChild(label);

    const select = document.createElement("select");
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All";
    select.appendChild(allOption);

    for (const context of knownContexts) {
      const option = document.createElement("option");
      option.value = context;
      option.textContent = context;
      select.appendChild(option);
    }

    select.value = this.selectedContext ?? "";
    select.addEventListener("change", () => {
      this.selectedContext = select.value.length > 0 ? select.value : null;
      this.refreshSoon();
    });

    label.appendChild(select);
    container.appendChild(wrapper);
  }

  private filterByContext(rows: TaskSummaryRow[]): TaskSummaryRow[] {
    if (!this.selectedContext) {
      return rows;
    }

    return rows.filter((row) => row.contexts.includes(this.selectedContext!));
  }

  private appendSection(container: HTMLElement, taskSection: TaskSummarySection, settings: TaskManagerSettings): void {
    const heading = document.createElement("h3");
    heading.textContent = taskSection.title;
    container.appendChild(heading);

    const rows = this.filterByContext(taskSection.rows);
    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No tasks.";
      container.appendChild(emptyState);
      return;
    }

    const folderGroups = buildGroupedTaskTable(rows, settings.dashboardHideKeywords);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Folder", "Filename", "Task", "Priority", "Recurrence", "Context", "Due"]) {
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
            const fileCell = this.createFileCell(fileGroup.displayFileName, row.file.path);
            if (fileGroup.rows.length > 1) {
              fileCell.rowSpan = fileGroup.rows.length;
            }
            tableRow.appendChild(fileCell);
          }

          tableRow.appendChild(this.createTaskCell(row.task, row.priority));
          tableRow.appendChild(this.createTextElement("td", String(row.priority)));
          tableRow.appendChild(this.createTextElement("td", row.recurrence));
          tableRow.appendChild(this.createTextElement("td", row.contexts.join(", ")));
          tableRow.appendChild(this.createTextElement("td", formatMonthDay(row.dueDate)));
          tbody.appendChild(tableRow);
        }
      }
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  private createFileCell(displayFileName: string, filePath: string): HTMLTableCellElement {
    const fileCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = displayFileName;
    link.classList.add("internal-link");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(filePath, "");
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
    if (priority === 1) {
      taskCell.style.fontWeight = "700";
    } else if (priority === 2) {
      taskCell.style.fontStyle = "italic";
    }
    return taskCell;
  }

  private isRelevantFile(file: unknown): boolean {
    if (!(file instanceof TFile)) return false;

    const settings = this.getSettings();
    const roots = [settings.projectsFolder, settings.waitingProjectsFolder, settings.somedayMaybeProjectsFolder].filter(Boolean);
    const inTaskFolder = roots.some((root) => isInFolder(file.path, root));
    const isInbox = !!settings.inboxFile && file.path === settings.inboxFile;
    return inTaskFolder || isInbox;
  }

  private queueRefresh(): void {
    if (this.refreshHandle !== null) {
      window.clearTimeout(this.refreshHandle);
    }

    this.refreshHandle = window.setTimeout(() => {
      this.refreshHandle = null;
      void this.refreshOpenViews();
    }, 50);
  }

  private async refreshOpenViews(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(TasksSummaryController.VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof TasksSummaryView) {
        await leaf.view.refresh();
      }
    }
  }
}

class TasksSummaryView extends ItemView {
  private readonly controller: TasksSummaryController;

  constructor(leaf: WorkspaceLeaf, controller: TasksSummaryController) {
    super(leaf);
    this.controller = controller;
  }

  getViewType(): string {
    return TasksSummaryController.VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Tasks Summary";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.controller.renderContent(this.contentEl);
  }
}
