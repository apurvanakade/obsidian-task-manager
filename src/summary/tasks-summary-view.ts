/**
 * Purpose:
 * - render the on-demand Tasks Summary tab: the first actionable open task across
 *   Projects, Waiting, and the Inbox (Someday-Maybe is deliberately excluded — see
 *   tasks-summary.ts).
 *
 * Responsibilities:
 * - registers and opens a main-panel ItemView (not a persistent sidebar leaf, and not
 *   a generated markdown note — see CLAUDE.md's Tasks Summary section for why)
 * - renders one grouped task table per section, reusing the same Folder/Filename/Task/
 *   Priority/Recurrence/Due columns and hide-keyword display cleanup as the date dashboard
 * - the Inbox section renders a dedicated per-task table with a selection checkbox per
 *   row, plus "Create project from selected" / "Move to existing project" actions —
 *   the inbox-to-project flow (see inbox-actions.ts)
 * - while a Tasks Summary tab is open, auto-refreshes it (debounced) whenever a
 *   relevant task file is modified/renamed/deleted elsewhere
 *
 * Dependencies:
 * - depends on tasks-summary.ts for row collection and inbox-actions.ts for the
 *   inbox-to-project writes
 * - Obsidian ItemView/workspace/vault APIs
 *
 * Side Effects:
 * - manipulates view DOM; the inbox-to-project actions write to the Inbox file and to
 *   project files (new or existing) via inbox-actions.ts and the injected createProject
 *   callback
 */
import { App, FuzzySuggestModal, ItemView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";
import { AddProjectInput, AddProjectModal } from "../projects/add-project-modal";
import { isInFolder } from "./summary-file-io";
import { collectTaskSummarySections, TaskSummaryRow, TaskSummarySection } from "./tasks-summary";
import { appendTasksToProject, removeInboxLines } from "./inbox-actions";
import { applyPriorityStyle, buildGroupedTaskTable, formatMonthDay } from "../tables/grouped-task-table";
import { appendSearchBox, matchesSearch } from "../ui/search-filter";
import { appendPriorityFilter, filterByMaxPriority, PriorityFilterValue } from "../ui/priority-filter";
import { appendCollapsibleSection } from "../ui/collapsible-section";

const INBOX_SECTION_TITLE = "Inbox";

type TasksSummaryControllerOptions = {
  app: App;
  getSettings: () => TaskManagerSettings;
  /** Creates a new project file from AddProjectModal's submitted input and returns it. */
  createProject: (input: AddProjectInput) => Promise<TFile>;
};

export class TasksSummaryController {
  static readonly VIEW_TYPE = "task-manager-tasks-summary";

  private readonly app: App;
  private readonly getSettings: () => TaskManagerSettings;
  private readonly createProject: (input: AddProjectInput) => Promise<TFile>;
  private searchQuery = "";
  private selectedMaxPriority: PriorityFilterValue = null;
  // Every section starts open; a title is added here only when the user collapses it.
  private collapsedSections: Set<string> = new Set();
  // Raw Inbox task lines currently checked for the inbox-to-project actions.
  private selectedInboxLines: Set<string> = new Set();
  private lastSections: TaskSummarySection[] = [];
  private resultsContainer: HTMLElement | null = null;
  private currentSettings: TaskManagerSettings | null = null;
  private refreshHandle: number | null = null;

  constructor(options: TasksSummaryControllerOptions) {
    this.app = options.app;
    this.getSettings = options.getSettings;
    this.createProject = options.createProject;
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
    this.currentSettings = settings;
    const section = document.createElement("section");

    const title = document.createElement("h2");
    title.textContent = "Tasks Summary";
    section.appendChild(title);

    this.appendPriorityFilterControl(section);
    this.appendSearchFilter(section);

    const resultsContainer = document.createElement("div");
    section.appendChild(resultsContainer);
    this.resultsContainer = resultsContainer;

    this.lastSections = await collectTaskSummarySections(this.app, settings);
    this.pruneSelectedInboxLines();
    this.renderResults();

    container.appendChild(section);
  }

  /** Drops any checked Inbox line that no longer exists in the freshly-fetched data (edited/removed elsewhere). */
  private pruneSelectedInboxLines(): void {
    const inboxSection = this.lastSections.find((section) => section.title === INBOX_SECTION_TITLE);
    const currentLines = new Set((inboxSection?.rows ?? []).map((row) => row.rawLine));
    for (const line of this.selectedInboxLines) {
      if (!currentLines.has(line)) {
        this.selectedInboxLines.delete(line);
      }
    }
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

  /** Re-renders just the section tables from already-fetched data — no refetch, no input rebuild (preserves focus while typing). */
  private renderResults(): void {
    if (!this.resultsContainer || !this.currentSettings) return;

    this.resultsContainer.innerHTML = "";
    for (const taskSection of this.lastSections) {
      if (taskSection.title === INBOX_SECTION_TITLE) {
        this.appendInboxSection(this.resultsContainer, taskSection, this.currentSettings);
      } else {
        this.appendSection(this.resultsContainer, taskSection, this.currentSettings);
      }
    }
  }

  private filterBySearch(rows: TaskSummaryRow[]): TaskSummaryRow[] {
    if (!this.searchQuery.trim()) {
      return rows;
    }

    return rows.filter((row) => matchesSearch(this.searchQuery, row.task, row.file.path));
  }

  private appendSection(container: HTMLElement, taskSection: TaskSummarySection, settings: TaskManagerSettings): void {
    const rows = this.filterBySearch(filterByMaxPriority(taskSection.rows, this.selectedMaxPriority));
    const details = appendCollapsibleSection(
      container,
      taskSection.title,
      taskSection.rows.length,
      !this.collapsedSections.has(taskSection.title),
      (open) => {
        if (open) {
          this.collapsedSections.delete(taskSection.title);
        } else {
          this.collapsedSections.add(taskSection.title);
        }
      },
    );

    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = this.searchQuery.trim() ? "No matches." : "No tasks.";
      details.appendChild(emptyState);
      return;
    }

    const folderGroups = buildGroupedTaskTable(rows, settings.dashboardHideKeywords);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Folder", "Project", "Task", "Priority", "Recurrence", "Due"]) {
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
            const fileCell = this.createFileCell(fileGroup.displayFileName, row.file.path, row.priority);
            if (fileGroup.rows.length > 1) {
              fileCell.rowSpan = fileGroup.rows.length;
            }
            tableRow.appendChild(fileCell);
          }

          tableRow.appendChild(this.createTaskCell(row.task));
          tableRow.appendChild(this.createTextElement("td", String(row.priority)));
          tableRow.appendChild(this.createTextElement("td", row.recurrence));
          tableRow.appendChild(this.createTextElement("td", formatMonthDay(row.dueDate)));
          tbody.appendChild(tableRow);
        }
      }
    }

    table.appendChild(tbody);
    details.appendChild(table);
  }

  /**
   * Inbox rows get a dedicated per-task table (no Folder/Project columns — every row is
   * the same file) with a leading selection checkbox, plus the inbox-to-project action
   * buttons below the table.
   */
  private appendInboxSection(container: HTMLElement, taskSection: TaskSummarySection, settings: TaskManagerSettings): void {
    const rows = this.filterBySearch(filterByMaxPriority(taskSection.rows, this.selectedMaxPriority));
    const details = appendCollapsibleSection(
      container,
      taskSection.title,
      taskSection.rows.length,
      !this.collapsedSections.has(taskSection.title),
      (open) => {
        if (open) {
          this.collapsedSections.delete(taskSection.title);
        } else {
          this.collapsedSections.add(taskSection.title);
        }
      },
    );

    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = this.searchQuery.trim() ? "No matches." : "No tasks.";
      details.appendChild(emptyState);
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerRow.appendChild(this.createTextElement("th", ""));
    for (const label of ["Task", "Priority", "Recurrence", "Due"]) {
      headerRow.appendChild(this.createTextElement("th", label));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tableRow = document.createElement("tr");

      const checkboxCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.selectedInboxLines.has(row.rawLine);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedInboxLines.add(row.rawLine);
        } else {
          this.selectedInboxLines.delete(row.rawLine);
        }
        this.renderResults();
      });
      checkboxCell.appendChild(checkbox);
      tableRow.appendChild(checkboxCell);

      tableRow.appendChild(this.createTaskCell(row.task));
      tableRow.appendChild(this.createTextElement("td", String(row.priority)));
      tableRow.appendChild(this.createTextElement("td", row.recurrence));
      tableRow.appendChild(this.createTextElement("td", formatMonthDay(row.dueDate)));
      tbody.appendChild(tableRow);
    }

    table.appendChild(tbody);
    details.appendChild(table);

    this.appendInboxActionButtons(details, settings);
  }

  private appendInboxActionButtons(container: HTMLElement, settings: TaskManagerSettings): void {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.margin = "8px 0 16px";

    const selectionCount = this.selectedInboxLines.size;

    const createButton = document.createElement("button");
    createButton.textContent = selectionCount > 0 ? `Create project from selected (${selectionCount})` : "Create project from selected";
    createButton.disabled = selectionCount === 0;
    createButton.addEventListener("click", () => {
      this.openCreateProjectFromSelection(settings);
    });
    row.appendChild(createButton);

    const moveButton = document.createElement("button");
    moveButton.textContent = selectionCount > 0 ? `Move to existing project (${selectionCount})` : "Move to existing project";
    moveButton.disabled = selectionCount === 0;
    moveButton.addEventListener("click", () => {
      this.openMoveToExistingProject(settings);
    });
    row.appendChild(moveButton);

    container.appendChild(row);
  }

  private getSelectedInboxRows(): TaskSummaryRow[] {
    const inboxSection = this.lastSections.find((section) => section.title === INBOX_SECTION_TITLE);
    if (!inboxSection) {
      return [];
    }

    return inboxSection.rows.filter((row) => this.selectedInboxLines.has(row.rawLine));
  }

  private openCreateProjectFromSelection(settings: TaskManagerSettings): void {
    const selectedRows = this.getSelectedInboxRows();
    if (selectedRows.length === 0) {
      return;
    }

    const rawLines = selectedRows.map((row) => row.rawLine);
    const modal = new AddProjectModal({
      app: this.app,
      settings,
      initialTasks: rawLines,
      onSubmit: async (input) => {
        await this.createProject(input);
        await removeInboxLines(this.app, settings, rawLines);
        this.selectedInboxLines.clear();
        new Notice(`Created project from ${selectedRows.length} inbox task${selectedRows.length === 1 ? "" : "s"}.`);
        this.refreshSoon();
      },
    });

    modal.open();
  }

  private openMoveToExistingProject(settings: TaskManagerSettings): void {
    const selectedRows = this.getSelectedInboxRows();
    if (selectedRows.length === 0) {
      return;
    }

    const roots = [
      settings.projectsFolder,
      settings.waitingProjectsFolder,
      settings.somedayMaybeProjectsFolder,
      settings.scheduledProjectsFolder,
    ].filter(Boolean);
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => roots.some((root) => isInFolder(file.path, root)))
      .sort((left, right) => left.path.localeCompare(right.path));

    if (files.length === 0) {
      new Notice("No project files found to move tasks into.");
      return;
    }

    const rawLines = selectedRows.map((row) => row.rawLine);
    new ProjectFileSuggestModal(this.app, files, (file) => {
      void (async () => {
        await appendTasksToProject(this.app, file, rawLines);
        await removeInboxLines(this.app, settings, rawLines);
        this.selectedInboxLines.clear();
        new Notice(`Moved ${selectedRows.length} task${selectedRows.length === 1 ? "" : "s"} to ${file.basename}.`);
        this.refreshSoon();
      })();
    }).open();
  }

  private createFileCell(displayFileName: string, filePath: string, priority: number): HTMLTableCellElement {
    const fileCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = displayFileName;
    link.classList.add("internal-link");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(filePath, "");
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

  private isRelevantFile(file: unknown): boolean {
    if (!(file instanceof TFile)) return false;

    const settings = this.getSettings();
    const roots = [settings.projectsFolder, settings.waitingProjectsFolder].filter(Boolean);
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

/** Fuzzy-picks one project file, used by "Move to existing project". */
class ProjectFileSuggestModal extends FuzzySuggestModal<TFile> {
  private readonly files: TFile[];
  private readonly onChoose: (file: TFile) => void;

  constructor(app: App, files: TFile[], onChoose: (file: TFile) => void) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.setPlaceholder("Select a project to move the selected task(s) into");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
