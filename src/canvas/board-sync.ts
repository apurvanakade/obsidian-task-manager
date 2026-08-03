/**
 * Purpose:
 * - keep the plugin-generated Task Board canvas in sync with project status, in both
 *   directions.
 *
 * Responsibilities:
 * - plugin → canvas: regenerates the board (debounced) whenever a tracked project file
 *   is created/modified/renamed/deleted, but only while the board file already exists —
 *   opening the board is opt-in, nothing is created behind the user's back
 * - canvas → plugin: on an edit to the board file itself, diffs card placement against
 *   on-disk status and writes `status` frontmatter for anything that moved column; the
 *   resulting vault `modify` event flows through the normal TaskProcessor status-change
 *   routing pipeline exactly like a manual frontmatter edit — this module never routes
 *   files itself (same division of responsibility as projects-summary-data.ts's
 *   promoteScheduledFileNow()/setProjectStatus())
 * - "Open Task Board" command: creates the file if missing, opens it either way
 *
 * Dependencies:
 * - canvas-model.ts (pure layout/diff), routing/task-routing.ts (ensureParentFoldersExist),
 *   routing/status-routing.ts (readStatusValue), file-priority.ts (readFilePriority)
 *
 * Side Effects:
 * - reads/writes the board file; writes project status frontmatter; shows Notices
 */
import { App, Notice, Plugin, TFile } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";
import { ensureParentFoldersExist } from "../routing/task-routing";
import { readStatusValue } from "../routing/status-routing";
import { readFilePriority } from "../tasks/file-priority";
import {
  BoardProject,
  buildBoardData,
  diffBoardStatuses,
  parseCanvas,
  serializeCanvas,
  STATUS_COLUMNS,
} from "./canvas-model";

type BoardSyncControllerOptions = {
  app: App;
  getSettings: () => TaskManagerSettings;
};

const REGENERATE_DEBOUNCE_MS = 300;

export class BoardSyncController {
  private readonly app: App;
  private readonly getSettings: () => TaskManagerSettings;
  private regenerateHandle: number | null = null;
  /** Own-write guard: the board file is outside TaskStateStore's domain (non-.md), so this controller tracks its own last write. */
  private lastWrittenJson: string | null = null;

  constructor(options: BoardSyncControllerOptions) {
    this.app = options.app;
    this.getSettings = options.getSettings;
  }

  onload(plugin: Plugin): void {
    plugin.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }

      if (this.isBoardFile(file)) {
        void this.handleBoardFileModified(file);
        return;
      }

      if (this.isTrackedProjectFile(file)) {
        this.queueRegenerate();
      }
    }));
    plugin.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && this.isTrackedProjectFile(file)) {
        this.queueRegenerate();
      }
    }));
    // rename/delete trigger unconditionally, like ProjectsSummaryController's listeners —
    // a file could be moving into or out of a tracked folder either way.
    plugin.registerEvent(this.app.vault.on("rename", (file) => {
      if (file instanceof TFile) {
        this.queueRegenerate();
      }
    }));
    plugin.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) {
        this.queueRegenerate();
      }
    }));
  }

  onunload(): void {
    if (this.regenerateHandle !== null) {
      window.clearTimeout(this.regenerateHandle);
      this.regenerateHandle = null;
    }
  }

  /** Creates the board file from a live vault scan if it doesn't exist yet, then opens it. */
  async openBoard(): Promise<void> {
    const settings = this.getSettings();
    if (!settings.boardFilePath) {
      new Notice("Set Board File Path in plugin settings first.");
      return;
    }

    let file = this.app.vault.getAbstractFileByPath(settings.boardFilePath);
    if (file && !(file instanceof TFile)) {
      new Notice(`'${settings.boardFilePath}' is a folder, not a file.`);
      return;
    }

    if (!file) {
      const projects = await this.collectTrackedProjects(settings);
      const json = serializeCanvas(buildBoardData(projects, null));
      await ensureParentFoldersExist(this.app, settings.boardFilePath);
      file = await this.app.vault.create(settings.boardFilePath, json);
      this.lastWrittenJson = json;
    }

    await this.app.workspace.getLeaf(true).openFile(file as TFile);
  }

  private isBoardFile(file: TFile): boolean {
    const settings = this.getSettings();
    return !!settings.boardFilePath && file.path === settings.boardFilePath;
  }

  private isTrackedProjectFile(file: TFile): boolean {
    if (file.extension !== "md") {
      return false;
    }

    const settings = this.getSettings();
    return this.statusFolderRoots(settings).some((root) => file.path === root || file.path.startsWith(`${root}/`));
  }

  private statusFolderRoots(settings: TaskManagerSettings): string[] {
    return STATUS_COLUMNS.map((column) => this.folderForStatus(settings, column.status)).filter(
      (folder): folder is string => !!folder,
    );
  }

  private folderForStatus(settings: TaskManagerSettings, status: string): string {
    switch (status) {
      case "todo":
        return settings.projectsFolder;
      case "waiting":
        return settings.waitingProjectsFolder;
      case "someday-maybe":
        return settings.somedayMaybeProjectsFolder;
      case "scheduled":
        return settings.scheduledProjectsFolder;
      default:
        return "";
    }
  }

  private queueRegenerate(): void {
    if (this.regenerateHandle !== null) {
      window.clearTimeout(this.regenerateHandle);
    }

    this.regenerateHandle = window.setTimeout(() => {
      this.regenerateHandle = null;
      void this.regenerate();
    }, REGENERATE_DEBOUNCE_MS);
  }

  /** No-op when the board file doesn't exist yet — the board is opt-in. */
  private async regenerate(): Promise<void> {
    const settings = this.getSettings();
    if (!settings.boardFilePath) {
      return;
    }

    const boardFile = this.app.vault.getAbstractFileByPath(settings.boardFilePath);
    if (!(boardFile instanceof TFile)) {
      return;
    }

    const existingJson = await this.app.vault.read(boardFile);
    const existingData = parseCanvas(existingJson);
    const projects = await this.collectTrackedProjects(settings);
    const nextJson = serializeCanvas(buildBoardData(projects, existingData));

    if (nextJson === existingJson) {
      return;
    }

    this.lastWrittenJson = nextJson;
    await this.app.vault.modify(boardFile, nextJson);
  }

  private async handleBoardFileModified(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    if (content === this.lastWrittenJson) {
      // Our own write (from regenerate() or openBoard()) — nothing to sync.
      return;
    }

    const data = parseCanvas(content);
    if (!data) {
      // Malformed JSON mid-edit; ignore, the next valid save will be processed normally.
      return;
    }

    const settings = this.getSettings();
    const projects = await this.collectTrackedProjects(settings);
    const statusByPath = new Map(projects.map((project) => [project.path, project.status]));
    const { changes, duplicatePaths } = diffBoardStatuses(data, statusByPath);

    if (duplicatePaths.length > 0) {
      new Notice(
        `Task Board: ${duplicatePaths.length} project${duplicatePaths.length === 1 ? " appears" : "s appear"} on more than one card — delete the duplicate card(s) and edit the board again.`,
      );
    }

    for (const change of changes) {
      const target = this.app.vault.getAbstractFileByPath(change.path);
      if (target instanceof TFile) {
        await this.setProjectStatus(target, change.newStatus, settings);
      }
    }

    // Whether anything changed or not, a regenerate reconciles layout/positions and
    // heals any stale file references — the status writes above (if any) also trigger
    // their own modify events that route through the normal pipeline independently.
    this.queueRegenerate();
  }

  private async setProjectStatus(file: TFile, status: string, settings: TaskManagerSettings): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
      frontmatter[settings.statusField] = status;
    });
  }

  private async collectTrackedProjects(settings: TaskManagerSettings): Promise<BoardProject[]> {
    const roots = this.statusFolderRoots(settings);
    if (roots.length === 0) {
      return [];
    }

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => roots.some((root) => file.path === root || file.path.startsWith(`${root}/`)));

    const projects: BoardProject[] = [];
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const status = readStatusValue(content, settings.statusField);
      if (!status) {
        continue;
      }

      projects.push({
        path: file.path,
        status,
        priority: readFilePriority(content),
        basename: file.basename,
      });
    }

    return projects;
  }
}
