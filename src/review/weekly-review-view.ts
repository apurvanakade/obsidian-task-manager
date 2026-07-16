/**
 * Purpose:
 * - render the on-demand Weekly Review tab: Active Projects and Someday-Maybe items
 *   due for review, stale Waiting items, and upcoming Scheduled (tickler) items.
 *
 * Responsibilities:
 * - registers and opens a main-panel ItemView (not a persistent sidebar leaf)
 * - renders four flat, staleness-sorted tables (Active Projects, Waiting, Someday-Maybe,
 *   Scheduled)
 * - offers a per-row "Mark Reviewed" action for Active Projects/Someday-Maybe items and
 *   a "Promote Now" action for Scheduled items, writing frontmatter directly and
 *   refreshing in place
 * - while a Weekly Review tab is open, auto-refreshes it (debounced) whenever a
 *   relevant project file is modified/renamed/deleted elsewhere, so the tab doesn't
 *   go stale between manual "Mark Reviewed" clicks or re-runs of the open command
 *
 * Dependencies:
 * - depends on weekly-review-data.ts for data collection and the reviewed-date write
 * - Obsidian ItemView/workspace/vault APIs
 *
 * Side Effects:
 * - manipulates view DOM; "Mark Reviewed" writes frontmatter via stampReviewedDate()
 */
import { App, ItemView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { getEndOfWeek } from "../date/date-utils";
import { TaskManagerSettings } from "../settings/settings-utils";
import { isInFolder } from "../summary/summary-file-io";
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
} from "./weekly-review-data";

type WeeklyReviewControllerOptions = {
  app: App;
  getSettings: () => TaskManagerSettings;
};

export class WeeklyReviewController {
  static readonly VIEW_TYPE = "task-manager-weekly-review";

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

  constructor(options: WeeklyReviewControllerOptions) {
    this.app = options.app;
    this.getSettings = options.getSettings;
  }

  onload(plugin: Plugin): void {
    plugin.registerView(WeeklyReviewController.VIEW_TYPE, (leaf) => new WeeklyReviewView(leaf, this));
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

  /** Opens the Weekly Review tab, reusing an existing one if already open. */
  async openView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(WeeklyReviewController.VIEW_TYPE)[0];
    if (existingLeaf) {
      this.app.workspace.revealLeaf(existingLeaf);
      if (existingLeaf.view instanceof WeeklyReviewView) {
        await existingLeaf.view.refresh();
      }
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: WeeklyReviewController.VIEW_TYPE, active: true });
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
    const leaves = this.app.workspace.getLeavesOfType(WeeklyReviewController.VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof WeeklyReviewView) {
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
    title.textContent = "Weekly Review";
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
    thead.appendChild(this.createRow(["Project", "Days Since Review", "Last Reviewed", ""], "th"));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.appendChild(this.createCell(this.createFileLinkCell(row.file), "td"));
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
    thead.appendChild(this.createRow(["Project", "Days Waiting", "Waiting Since", ""], "th"));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = this.createRow([
        this.createFileLinkCell(row.file),
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
    thead.appendChild(this.createRow(["Project", "Days Since Review", "Last Reviewed", "Needs Review", ""], "th"));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.appendChild(this.createCell(this.createFileLinkCell(row.file), "td"));
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
    thead.appendChild(this.createRow(["Project", "Scheduled Date", "Days Until", ""], "th"));
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.appendChild(this.createCell(this.createFileLinkCell(row.file), "td"));
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

  private createFileLinkCell(file: TFile): HTMLAnchorElement {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = file.basename;
    link.classList.add("internal-link");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(file.path, "");
    });
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

class WeeklyReviewView extends ItemView {
  private readonly controller: WeeklyReviewController;

  constructor(leaf: WorkspaceLeaf, controller: WeeklyReviewController) {
    super(leaf);
    this.controller = controller;
  }

  getViewType(): string {
    return WeeklyReviewController.VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Weekly Review";
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
