import { App, ItemView, Plugin, TFile, WorkspaceLeaf } from "obsidian";

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
  private static readonly LEGACY_DATE_DASHBOARD_CLASS = "task-manager-date-dashboard";
  private static readonly VIEW_TYPE = "task-manager-date-dashboard";

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

    this.removeLegacyDashboardElements();
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
    dashboard.style.padding = "0.75rem";

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
      this.removeLegacyDashboardElements();
      void this.refreshView();
    }, 50);
  }

  private removeLegacyDashboardElements(): void {
    document.querySelectorAll(`.${DateDashboardController.LEGACY_DATE_DASHBOARD_CLASS}`).forEach((element) => {
      element.remove();
    });
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
    const baseName = fileName.replace(/\.md$/i, "");
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

    const sortRows = (left: DashboardRow, right: DashboardRow): number => {
      const pathCompare = left.file.path.localeCompare(right.file.path);
      if (pathCompare !== 0) {
        return pathCompare;
      }

      return left.task.localeCompare(right.task);
    };

    const sortDueRows = (left: DashboardRow, right: DashboardRow): number => {
      const leftDueDate = left.dueDate ?? "9999-99-99";
      const rightDueDate = right.dueDate ?? "9999-99-99";
      const dueDateCompare = leftDueDate.localeCompare(rightDueDate);
      if (dueDateCompare !== 0) {
        return dueDateCompare;
      }

      return sortRows(left, right);
    };

    dueTasks.sort(sortDueRows);
    completedTasks.sort(sortRows);

    return { dueTasks, completedTasks };
  }

  private parseDashboardTaskLine(line: string): ParsedDashboardTask | null {
    const match = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (!match) {
      return null;
    }

    const status = match[1].trim().toLowerCase() === "x" ? "completed" : "open";
    const taskBody = match[2].trim();
    const dueDate = this.readInlineFieldValue(taskBody, "due");
    const completedDate = this.readInlineFieldValue(taskBody, "completion-date");

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

  private readInlineFieldValue(taskBody: string, fieldName: string): string | null {
    const fieldRegex = new RegExp(`\\[${escapeRegExp(fieldName)}::\\s*([^\\]]+?)\\s*\\]`, "i");
    const match = taskBody.match(fieldRegex);
    return match ? match[1].trim() : null;
  }

  private cleanDashboardTaskText(taskBody: string): string {
    return taskBody
      .replace(/\s*\[[^\]]+::\s*[^\]]*\]/g, "")
      .replace(/(^|\s)#[^\s#]+/g, "$1")
      .replace(/\s+/g, " ")
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
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.marginBottom = "1rem";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const labels = showDueDate ? ["Filename", "Task", "Due"] : ["Filename", "Task"];
    for (const label of labels) {
      const headerCell = document.createElement("th");
      headerCell.textContent = label;
      headerCell.style.textAlign = "left";
      headerCell.style.borderBottom = "1px solid var(--background-modifier-border)";
      headerCell.style.padding = "0.5rem";
      headerRow.appendChild(headerCell);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tableRow = document.createElement("tr");

      const fileCell = document.createElement("td");
      fileCell.style.padding = "0.5rem";
      fileCell.style.verticalAlign = "top";
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = this.getDisplayFileName(row.file.name);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.app.workspace.openLinkText(row.file.path, sourcePath);
      });
      fileCell.appendChild(link);

      const taskCell = document.createElement("td");
      taskCell.style.padding = "0.5rem";
      taskCell.style.verticalAlign = "top";
      taskCell.textContent = row.task;

      tableRow.appendChild(fileCell);
      tableRow.appendChild(taskCell);

      if (showDueDate) {
        const dueDateCell = document.createElement("td");
        dueDateCell.style.padding = "0.5rem";
        dueDateCell.style.verticalAlign = "top";
        dueDateCell.textContent = this.formatMonthDay(row.dueDate);
        tableRow.appendChild(dueDateCell);
      }

      tbody.appendChild(tableRow);
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  private formatMonthDay(dateString: string | null): string {
    if (!dateString) {
      return "";
    }

    const match = dateString.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return match ? `${match[1]}-${match[2]}` : dateString;
  }

  private getDisplayFileName(fileName: string): string {
    const withoutExtension = fileName.replace(/\.md$/i, "");
    const withoutArchivePrefix = withoutExtension.replace(/^\d+[\s._-]*/, "");
    return withoutArchivePrefix || withoutExtension;
  }
}

class DateDashboardView extends ItemView {
  private readonly controller: DateDashboardController;

  constructor(leaf: WorkspaceLeaf, controller: DateDashboardController) {
    super(leaf);
    this.controller = controller;
  }

  getViewType(): string {
    return "task-manager-date-dashboard";
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}