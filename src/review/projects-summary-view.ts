/**
 * Purpose:
 * - render the on-demand Projects Summary tab (formerly "Weekly Review" — the rename
 *   covers file names, class names, VIEW_TYPE, and command name, not just display text):
 *   Active Projects and Someday-Maybe items due for review, stale Waiting items, and
 *   upcoming Scheduled (tickler) items.
 *
 * Responsibilities:
 * - registers and opens a main-panel ItemView (not a persistent sidebar leaf)
 * - renders four flat, staleness-sorted tables (Active Projects, Waiting, Someday-Maybe,
 *   Scheduled), each showing project Priority alongside its staleness columns
 * - offers a per-row "Mark Reviewed" action for Active Projects/Someday-Maybe items and
 *   a "Promote Now" action for Scheduled items, writing frontmatter directly and
 *   refreshing in place
 * - while the tab is open, auto-refreshes it (debounced) whenever a relevant project
 *   file is modified/renamed/deleted elsewhere, so the tab doesn't go stale between
 *   manual "Mark Reviewed" clicks or re-runs of the open command
 *
 * Dependencies:
 * - depends on projects-summary-data.ts for data collection and the reviewed-date write
 * - Obsidian ItemView/workspace/vault APIs
 *
 * Side Effects:
 * - manipulates view DOM; "Mark Reviewed" writes frontmatter via stampReviewedDate()
 */
import { App, ItemView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { getEndOfWeek } from "../date/date-utils";
import { TaskManagerSettings } from "../settings/settings-utils";
import { isInFolder } from "../summary/summary-file-io";
import { applyPriorityStyle } from "../tables/grouped-task-table";
import { FilePriority } from "../tasks/file-priority";
import { appendSearchBox, matchesSearch } from "../ui/search-filter";
import {
  collectActiveProjectReviewRows,
  collectScheduledReviewRows,
  collectSomedayReviewRows,
  collectWaitingReviewRows,
  promoteScheduledFileNow,
  ReviewRow,
  ScheduledReviewRow,
  SomedayReviewRow,
  stampReviewedDate,
  WaitingReviewRow,
} from "./projects-summary-data";

type ProjectsSummaryControllerOptions = {
  app: App;
  getSettings: () => TaskManagerSettings;
};

export class ProjectsSummaryController {
  static readonly VIEW_TYPE = "task-manager-projects-summary";

  private readonly app: App;
  private readonly getSettings: () => TaskManagerSettings;
  private searchQuery = "";
  private cached: {
    settings: TaskManagerSettings;
    activeProjectRows: ReviewRow[];
    waitingRows: WaitingReviewRow[];
    somedayRows: SomedayReviewRow[];
    scheduledRows: ScheduledReviewRow[];
  } | null = null;
  private resultsContainer: HTMLElement | null = null;
  private onNeedsRefresh: (() => void) | null = null;
  private refreshHandle: number | null = null;

  constructor(options: ProjectsSummaryControllerOptions) {
    this.app = options.app;
    this.getSettings = options.getSettings;
  }

  onload(plugin: Plugin): void {
    plugin.registerView(ProjectsSummaryController.VIEW_TYPE, (leaf) => new ProjectsSummaryView(leaf, this));
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

  /** Opens the Projects Summary tab, reusing an existing one if already open. */
  async openView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(ProjectsSummaryController.VIEW_TYPE)[0];
    if (existingLeaf) {
      this.app.workspace.revealLeaf(existingLeaf);
      if (existingLeaf.view instanceof ProjectsSummaryView) {
        await existingLeaf.view.refresh();
      }
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: ProjectsSummaryController.VIEW_TYPE, active: true });
  }

  private isRelevantFile(file: unknown): boolean {
    if (!(file instanceof TFile)) return false;

    const settings = this.getSettings();
    const roots = [
      settings.projectsFolder,
      settings.waitingProjectsFolder,
      settings.somedayMaybeProjectsFolder,
      settings.scheduledProjectsFolder,
    ].filter(Boolean);
    return roots.some((root) => isInFolder(file.path, root));
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
    const leaves = this.app.workspace.getLeavesOfType(ProjectsSummaryController.VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof ProjectsSummaryView) {
        await leaf.view.refresh();
      }
    }
  }

  async renderContent(container: HTMLElement, onNeedsRefresh: () => void): Promise<void> {
    container.innerHTML = "";
    container.classList.add("markdown-rendered");
    this.onNeedsRefresh = onNeedsRefresh;

    const settings = this.getSettings();
    const section = document.createElement("section");

    const title = document.createElement("h2");
    title.textContent = "Projects Summary";
    section.appendChild(title);

    const weekLabel = document.createElement("p");
    weekLabel.textContent = `Week ending ${formatDate(getEndOfWeek(new Date()))}`;
    section.appendChild(weekLabel);

    this.appendSearchFilter(section);

    const resultsContainer = document.createElement("div");
    section.appendChild(resultsContainer);
    this.resultsContainer = resultsContainer;

    this.cached = {
      settings,
      activeProjectRows: await collectActiveProjectReviewRows(this.app, settings),
      waitingRows: await collectWaitingReviewRows(this.app, settings),
      somedayRows: await collectSomedayReviewRows(this.app, settings),
      scheduledRows: await collectScheduledReviewRows(this.app, settings),
    };
    this.renderResults();

    container.appendChild(section);
  }

  private appendSearchFilter(container: HTMLElement): void {
    appendSearchBox(container, this.searchQuery, (query) => {
      this.searchQuery = query;
      this.renderResults();
    });
  }

  private filterBySearch<T extends { file: TFile }>(rows: T[]): T[] {
    if (!this.searchQuery.trim()) {
      return rows;
    }

    return rows.filter((row) => matchesSearch(this.searchQuery, row.file.basename, row.file.path));
  }

  private emptyMessage(defaultText: string): string {
    return this.searchQuery.trim() ? "No matches." : defaultText;
  }

  /** Re-renders just the section tables from already-fetched data — no refetch, no input rebuild (preserves focus while typing). */
  private renderResults(): void {
    if (!this.resultsContainer || !this.cached || !this.onNeedsRefresh) return;

    const { settings, activeProjectRows, waitingRows, somedayRows, scheduledRows } = this.cached;
    const onNeedsRefresh = this.onNeedsRefresh;
    const container = this.resultsContainer;
    container.innerHTML = "";

    this.appendActiveProjectsSection(container, this.filterBySearch(activeProjectRows), settings, onNeedsRefresh);
    this.appendWaitingSection(container, this.filterBySearch(waitingRows), settings);
    this.appendSomedaySection(container, this.filterBySearch(somedayRows), settings, onNeedsRefresh);
    this.appendScheduledSection(container, this.filterBySearch(scheduledRows), settings, onNeedsRefresh);
  }

  private appendActiveProjectsSection(
    container: HTMLElement,
    rows: ReviewRow[],
    settings: TaskManagerSettings,
    onNeedsRefresh: () => void,
  ): void {
    const heading = document.createElement("h3");
    heading.textContent = "Active Projects";
    container.appendChild(heading);

    if (!settings.projectsFolder) {
      container.appendChild(this.createParagraph("Set Projects Folder in plugin settings to see active projects here."));
      return;
    }

    if (rows.length === 0) {
      container.appendChild(this.createParagraph(this.emptyMessage("No active projects.")));
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.appendChild(this.createRow(["Project", "Priority", "Days Since Review", "Last Reviewed", ""], "th"));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.appendChild(this.createCell(this.createFileLinkCell(row.file, row.priority), "td"));
      tr.appendChild(this.createCell(String(row.priority), "td"));
      tr.appendChild(this.createCell(row.daysSinceReview === null ? "—" : String(row.daysSinceReview), "td"));
      tr.appendChild(this.createCell(row.reviewed ?? "Never", "td"));

      const actionCell = document.createElement("td");
      const button = document.createElement("button");
      button.textContent = "Mark Reviewed";
      button.addEventListener("click", () => {
        void (async () => {
          await stampReviewedDate(this.app, row.file);
          onNeedsRefresh();
        })();
      });
      actionCell.appendChild(button);
      tr.appendChild(actionCell);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  private appendWaitingSection(container: HTMLElement, rows: WaitingReviewRow[], settings: TaskManagerSettings): void {
    const heading = document.createElement("h3");
    heading.textContent = "Waiting";
    container.appendChild(heading);

    if (!settings.waitingProjectsFolder) {
      container.appendChild(this.createParagraph("Set Waiting Projects Folder in plugin settings to see waiting items here."));
      return;
    }

    if (rows.length === 0) {
      container.appendChild(this.createParagraph(this.emptyMessage("No waiting projects.")));
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.appendChild(this.createRow(["Project", "Priority", "Days Waiting", "Waiting Since", ""], "th"));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = this.createRow([
        this.createFileLinkCell(row.file, row.priority),
        String(row.priority),
        row.daysWaiting === null ? "—" : String(row.daysWaiting),
        row.waitingSince ?? "—",
        row.isNewlyStale ? "Newly stale" : "",
      ], "td");
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  private appendSomedaySection(
    container: HTMLElement,
    rows: SomedayReviewRow[],
    settings: TaskManagerSettings,
    onNeedsRefresh: () => void,
  ): void {
    const heading = document.createElement("h3");
    heading.textContent = "Someday-Maybe";
    container.appendChild(heading);

    if (!settings.somedayMaybeProjectsFolder) {
      container.appendChild(this.createParagraph("Set Someday-Maybe Projects Folder in plugin settings to see items here."));
      return;
    }

    if (rows.length === 0) {
      container.appendChild(this.createParagraph(this.emptyMessage("No someday-maybe projects.")));
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.appendChild(this.createRow(["Project", "Priority", "Days Since Review", "Last Reviewed", "Needs Review", ""], "th"));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.appendChild(this.createCell(this.createFileLinkCell(row.file, row.priority), "td"));
      tr.appendChild(this.createCell(String(row.priority), "td"));
      tr.appendChild(this.createCell(row.daysSinceReview === null ? "—" : String(row.daysSinceReview), "td"));
      tr.appendChild(this.createCell(row.reviewed ?? "Never", "td"));
      tr.appendChild(this.createCell(row.needsReview ? "Yes" : "", "td"));

      const actionCell = document.createElement("td");
      const button = document.createElement("button");
      button.textContent = "Mark Reviewed";
      button.addEventListener("click", () => {
        void (async () => {
          await stampReviewedDate(this.app, row.file);
          onNeedsRefresh();
        })();
      });
      actionCell.appendChild(button);
      tr.appendChild(actionCell);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  private appendScheduledSection(
    container: HTMLElement,
    rows: ScheduledReviewRow[],
    settings: TaskManagerSettings,
    onNeedsRefresh: () => void,
  ): void {
    const heading = document.createElement("h3");
    heading.textContent = "Scheduled";
    container.appendChild(heading);

    if (!settings.scheduledProjectsFolder) {
      container.appendChild(this.createParagraph("Set Scheduled Projects Folder in plugin settings to see items here."));
      return;
    }

    if (rows.length === 0) {
      container.appendChild(this.createParagraph(this.emptyMessage("No scheduled projects.")));
      return;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.appendChild(this.createRow(["Project", "Priority", "Scheduled Date", "Days Until", ""], "th"));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.appendChild(this.createCell(this.createFileLinkCell(row.file, row.priority), "td"));
      tr.appendChild(this.createCell(String(row.priority), "td"));
      tr.appendChild(this.createCell(row.scheduledDate ?? "—", "td"));
      tr.appendChild(this.createCell(formatDaysUntil(row.daysUntil), "td"));

      const actionCell = document.createElement("td");
      const button = document.createElement("button");
      button.textContent = "Promote Now";
      button.addEventListener("click", () => {
        void (async () => {
          await promoteScheduledFileNow(this.app, row.file, settings);
          onNeedsRefresh();
        })();
      });
      actionCell.appendChild(button);
      tr.appendChild(actionCell);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  private createFileLinkCell(file: TFile, priority: FilePriority): HTMLAnchorElement {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = file.basename;
    link.classList.add("internal-link");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(file.path, "");
    });
    applyPriorityStyle(link, priority);
    return link;
  }

  private createRow(cells: Array<string | HTMLElement>, tag: "th" | "td"): HTMLTableRowElement {
    const tr = document.createElement("tr");
    for (const cell of cells) {
      tr.appendChild(this.createCell(cell, tag));
    }
    return tr;
  }

  private createCell(content: string | HTMLElement, tag: "th" | "td"): HTMLTableCellElement {
    const cell = document.createElement(tag);
    if (typeof content === "string") {
      cell.textContent = content;
    } else {
      cell.appendChild(content);
    }
    return cell;
  }

  private createParagraph(text: string): HTMLParagraphElement {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDaysUntil(daysUntil: number | null): string {
  if (daysUntil === null) return "—";
  if (daysUntil === 0) return "Today";
  if (daysUntil < 0) return `${-daysUntil} day${daysUntil === -1 ? "" : "s"} overdue`;
  return `in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
}

class ProjectsSummaryView extends ItemView {
  private readonly controller: ProjectsSummaryController;

  constructor(leaf: WorkspaceLeaf, controller: ProjectsSummaryController) {
    super(leaf);
    this.controller = controller;
  }

  getViewType(): string {
    return ProjectsSummaryController.VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Projects Summary";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.controller.renderContent(this.contentEl, () => {
      void this.refresh();
    });
  }
}
