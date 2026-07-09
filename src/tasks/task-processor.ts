/**
 * Purpose:
 * - orchestrate end-to-end task processing for events and commands.
 *
 * Responsibilities:
 * - coordinates state lookup, reconciliation, status updates, and routing decisions
 * - enforces pending-write guards to prevent event feedback loops
 * - supports file-level reset, reconciliation, and routing flows
 * - persists state-store updates after writes and path moves
 *
 * Dependencies:
 * - state store, reconciler, routing modules, and Obsidian vault APIs
 *
 * Side Effects:
 * - reads/writes files, updates routing destinations, and emits notices
 */
import { App, Notice, TFile, TFolder } from "obsidian";
import { getCurrentDateString } from "../date/date-utils";
import { readFrontmatterField } from "./frontmatter-utils";
import { TaskManagerSettings } from "../settings/settings-utils";
import { DEFAULT_PRIORITY, FilePriority, PRIORITY_FRONTMATTER_FIELD } from "./file-priority";
import {
  extractTaskState,
  findNewlyCompletedTask,
  findNewlyUncompletedTask,
  normalizeForComparison,
  resetTaskContent,
  TaskState,
} from "./task-utils";
import {
  applyCompletionRules,
  applyUncompletionRules,
  getCompletionDateString,
  getCompletionTimeString,
  reconcileFile
} from "./reconciler";
import {
  buildDestinationPath,
  deleteEmptyParentFolders,
  ensureParentFoldersExist,
  getDestinationRootForStatus,
  getTaskFolderRoots,
  promptMergeOrSkip
} from "../routing/task-routing";
import {
  assertConfiguredDestinationForStatus,
  isRoutableStatus,
  predictFinalStatus,
  readStatusValue
} from "../routing/status-routing";
import { TaskStateStore } from "./task-state-store";

/** Stamped onto a project's frontmatter while its status is `waiting`; cleared otherwise. */
export const WAITING_SINCE_FRONTMATTER_FIELD = "waiting-since";

type TaskProcessorOptions = {
  app: App;
  getSettings: () => TaskManagerSettings;
  onFileStatusChanged?: () => Promise<void>;
  onTaskPropertiesChanged?: () => Promise<void>;
};

export class TaskProcessor {
  private readonly app: App;
  private readonly getSettings: () => TaskManagerSettings;
  private readonly onFileStatusChanged?: () => Promise<void>;
  private readonly onTaskPropertiesChanged?: () => Promise<void>;
  private readonly stateStore = new TaskStateStore();

  constructor(options: TaskProcessorOptions) {
    this.app = options.app;
    this.getSettings = options.getSettings;
    this.onFileStatusChanged = options.onFileStatusChanged;
    this.onTaskPropertiesChanged = options.onTaskPropertiesChanged;
  }

  onunload(): void {
    this.stateStore.clear();
  }

  async primeState(): Promise<void> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const settings = this.getSettings();
    this.stateStore.clear();

    for (const file of markdownFiles) {
      if (!this.shouldTrackFile(file, settings)) {
        continue;
      }

      const content = await this.app.vault.read(file);
      this.updateFileSnapshot(file.path, content, settings);
    }
  }

  async handleFileCreate(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      return;
    }

    const settings = this.getSettings();
    if (!this.shouldTrackFile(file, settings)) {
      return;
    }

    const content = await this.app.vault.read(file);
    this.updateFileSnapshot(file.path, content, settings);
  }

  handleFileRename(file: TFile, oldPath: string): void {
    if (file.extension !== "md") {
      return;
    }

    this.stateStore.rekey(oldPath, file.path);
  }

  handleFileDelete(file: TFile): void {
    if (file.extension !== "md") {
      return;
    }

    this.stateStore.delete(file.path);
  }

  async handleFileModify(file: TFile): Promise<void> {
    if (file.extension !== "md" || this.stateStore.isPending(file.path)) {
      return;
    }

    const settings = this.getSettings();
    if (!this.shouldTrackFile(file, settings)) {
      return;
    }

    const content = await this.app.vault.read(file);
    const nextState = extractTaskState(content);
    const previousState = this.stateStore.getTaskState(file.path);
    const previousStatus = this.stateStore.getStatus(file.path);
    const currentStatus = readStatusValue(content, settings.statusField);
    const completion = findNewlyCompletedTask(previousState, nextState);
    const uncompleted = findNewlyUncompletedTask(previousState, nextState);

    this.stateStore.setTaskState(file.path, nextState);
    this.stateStore.setStatus(file.path, currentStatus);

    if (completion !== null) {
      await this.applyCompletionRules(file, content, completion, settings);
      await this.routeAfterStatusChange(file, previousStatus, settings);
      return;
    }

    if (uncompleted !== null) {
      await this.applyUncompletionRules(file, content, uncompleted, settings);
      await this.routeAfterStatusChange(file, previousStatus, settings);
      return;
    }

    await this.reconcileSingleFile(file, settings);
    await this.routeAfterStatusChange(file, previousStatus, settings);
  }

  async resetCurrentFileTasks(): Promise<string> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      throw new Error("No active file.");
    }

    const settings = this.getSettings();
    const initialContent = await this.app.vault.read(file);
    const resetResult = resetTaskContent(initialContent);
    if (!resetResult.changed) {
      return `No tasks needed reset in ${file.name}.`;
    }

    await this.writeFileContent(file, resetResult.content, settings);

    const processResult = await this.processAndRouteFile(file);
    return `Reset ${resetResult.taskCount} task${resetResult.taskCount === 1 ? "" : "s"} in ${file.name}. ${processResult}`;
  }

  private async processAndRouteFile(file: TFile): Promise<string> {
    const settings = this.getSettings();
    const initialContent = await this.app.vault.read(file);
    const initialStatus = readStatusValue(initialContent, settings.statusField);
    const hasOpenTasks = extractTaskState(initialContent).some((task) => task.status === "open");
    const predictedStatus = predictFinalStatus(initialStatus, hasOpenTasks);

    await this.reconcileSingleFile(file, settings);

    if (this.isInboxFile(file, settings)) {
      return `Processed ${file.name}.`;
    }

    assertConfiguredDestinationForStatus(predictedStatus, settings);

    const moveResult = await this.routeFileByStatus(file, settings);
    return moveResult ?? `Processed ${file.name}.`;
  }

  private async reconcileSingleFile(file: TFile, settings: TaskManagerSettings): Promise<void> {
    await reconcileFile({
      file,
      ...this.createReconcilerServices(settings),
    });
  }

  private async routeAfterStatusChange(file: TFile, previousStatus: string | null, settings: TaskManagerSettings): Promise<void> {
    const latestContent = await this.app.vault.read(file);
    const latestStatus = readStatusValue(latestContent, settings.statusField);
    this.stateStore.setStatus(file.path, latestStatus);

    if (latestStatus === previousStatus) {
      return;
    }

    if (this.isInboxFile(file, settings)) {
      return;
    }

    await this.updateWaitingSinceStamp(file, latestStatus, previousStatus);

    try {
      assertConfiguredDestinationForStatus(latestStatus, settings);
      await this.routeFileByStatus(file, settings, latestStatus);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to route file after status change.");
    }

    try {
      await this.onFileStatusChanged?.();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to update summary files after status change.");
    }
  }

  /**
   * Stamps `waiting-since` on transition into `waiting`, clears it on transition out.
   * Powers the Weekly Review's waiting-staleness calculation.
   */
  private async updateWaitingSinceStamp(file: TFile, latestStatus: string | null, previousStatus: string | null): Promise<void> {
    const enteringWaiting = latestStatus === "waiting" && previousStatus !== "waiting";
    const leavingWaiting = latestStatus !== "waiting" && previousStatus === "waiting";
    if (!enteringWaiting && !leavingWaiting) {
      return;
    }

    await this.runWithPendingPaths([file.path], async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
        if (enteringWaiting) {
          frontmatter[WAITING_SINCE_FRONTMATTER_FIELD] = getCurrentDateString();
        } else {
          delete frontmatter[WAITING_SINCE_FRONTMATTER_FIELD];
        }
      });
    });
  }

  /**
   * One-time backfill for files already in the Waiting folder before this feature
   * shipped: stamps today's date on any waiting file missing `waiting-since`, so it
   * isn't stuck without staleness data until its next status change.
   */
  async backfillWaitingSince(): Promise<string> {
    const settings = this.getSettings();
    const folderPath = settings.waitingProjectsFolder;
    if (!folderPath) {
      throw new Error("Set Waiting Projects Folder in plugin settings first.");
    }

    const files = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${folderPath}/`));
    let stampedCount = 0;

    for (const file of files) {
      const content = await this.app.vault.read(file);
      if (readFrontmatterField(content, WAITING_SINCE_FRONTMATTER_FIELD) !== null) {
        continue;
      }

      await this.runWithPendingPaths([file.path], async () => {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
          frontmatter[WAITING_SINCE_FRONTMATTER_FIELD] = getCurrentDateString();
        });
      });
      stampedCount += 1;
    }

    return `Stamped waiting-since on ${stampedCount} file${stampedCount === 1 ? "" : "s"}.`;
  }

  private async routeFileByStatus(file: TFile, settings: TaskManagerSettings, statusOverride?: string | null): Promise<string | null> {
    if (this.isInboxFile(file, settings)) {
      return null;
    }

    const status = statusOverride ?? readStatusValue(await this.app.vault.read(file), settings.statusField);
    if (!status || !isRoutableStatus(status)) {
      return null;
    }

    const destinationRoot = getDestinationRootForStatus(settings, status);
    if (!destinationRoot) {
      throw new Error(`Set destination folder for status '${status}' in Task Manager settings.`);
    }

    const destinationPath = buildDestinationPath(file, destinationRoot, getTaskFolderRoots(settings));
    if (destinationPath === file.path) {
      return null;
    }

    await ensureParentFoldersExist(this.app, destinationPath);
    const destinationEntry = this.app.vault.getAbstractFileByPath(destinationPath);

    if (destinationEntry instanceof TFolder) {
      throw new Error(`Cannot move '${file.path}' because '${destinationPath}' is a folder.`);
    }

    if (destinationEntry instanceof TFile) {
      const shouldMerge = await promptMergeOrSkip(this.app, file.path, destinationPath);

      if (!shouldMerge) {
        return `Skipped ${file.name} (destination exists).`;
      }

      await this.mergeIntoExistingFile(file, destinationEntry, settings);
      return `Merged ${file.name} into ${destinationPath}.`;
    }

    const sourcePath = file.path;
    await this.app.fileManager.renameFile(file, destinationPath);
    this.stateStore.rekey(sourcePath, destinationPath);
    await deleteEmptyParentFolders(this.app, getTaskFolderRoots(settings), sourcePath);
    return `Moved ${file.name} to ${destinationRoot}.`;
  }

  private async mergeIntoExistingFile(sourceFile: TFile, destinationFile: TFile, settings: TaskManagerSettings): Promise<void> {
    const sourcePath = sourceFile.path;
    const destinationContent = await this.app.vault.read(destinationFile);
    const sourceContent = await this.app.vault.read(sourceFile);
    const mergedContent = normalizeForComparison(destinationContent).includes(normalizeForComparison(sourceContent))
      ? destinationContent
      : `${destinationContent.trimEnd()}\n\n---\n\n${sourceContent}`;

    await this.runWithPendingPaths([destinationFile.path, sourceFile.path], async () => {
      await this.app.vault.modify(destinationFile, mergedContent);
      await this.app.vault.delete(sourceFile);
      this.stateStore.delete(sourceFile.path);
      this.updateFileSnapshot(destinationFile.path, mergedContent, settings);
      await deleteEmptyParentFolders(this.app, getTaskFolderRoots(settings), sourcePath);
    });
  }

  private async applyCompletionRules(
    file: TFile,
    content: string,
    completedLine: number,
    settings: TaskManagerSettings,
  ): Promise<void> {
    await applyCompletionRules({
      file,
      content,
      completedLine,
      ...this.createReconcilerServices(settings),
    });
  }

  private async applyUncompletionRules(file: TFile, content: string, uncompletedLine: number, settings: TaskManagerSettings): Promise<void> {
    await applyUncompletionRules({
      file,
      content,
      uncompletedLine,
      ...this.createReconcilerServices(settings),
    });
  }

  private createReconcilerServices(settings: TaskManagerSettings) {
    return {
      settings,
      app: this.app,
      readFile: (target: TFile) => this.app.vault.read(target),
      writeFileContent: (target: TFile, nextContent: string) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target: TFile, status: string) => this.setFileStatus(target, status, settings),
      setFilePriority: (target: TFile, priority: FilePriority) => this.setFilePriority(target, priority),
      setTaskState: (filePath: string, nextState: TaskState[]) => {
        this.stateStore.setTaskState(filePath, nextState);
      },
      onTaskPropertiesChanged: async () => {
        await this.onTaskPropertiesChanged?.();
      },
    };
  }

  private updateFileSnapshot(filePath: string, content: string, settings: TaskManagerSettings): void {
    this.stateStore.setTaskState(filePath, extractTaskState(content));
    this.stateStore.setStatus(filePath, readStatusValue(content, settings.statusField));
  }

  private shouldTrackFile(file: TFile, settings: TaskManagerSettings): boolean {
    if (settings.tasksSummaryFile && file.path === settings.tasksSummaryFile) {
      return false;
    }

    if (settings.projectSummaryFile && file.path === settings.projectSummaryFile) {
      return false;
    }

    if (this.isInboxFile(file, settings)) {
      return true;
    }

    const taskFolderRoots = getTaskFolderRoots(settings);
    return taskFolderRoots.some((root) => file.path.startsWith(`${root}/`));
  }

  private isInboxFile(file: TFile, settings: TaskManagerSettings): boolean {
    return !!settings.inboxFile && file.path === settings.inboxFile;
  }

  private async runWithPendingPaths(filePaths: string[], action: () => Promise<void>): Promise<void> {
    filePaths.forEach((filePath) => this.stateStore.markPending(filePath));

    try {
      await action();
    } finally {
      window.setTimeout(() => {
        filePaths.forEach((filePath) => this.stateStore.unmarkPending(filePath));
      }, 0);
    }
  }

  private async writeFileContent(file: TFile, content: string, settings: TaskManagerSettings): Promise<void> {
    await this.runWithPendingPaths([file.path], async () => {
      await this.app.vault.modify(file, content);
      this.updateFileSnapshot(file.path, content, settings);
    });
  }

  private async setFileStatus(file: TFile, status: string, settings: TaskManagerSettings): Promise<void> {
    await this.runWithPendingPaths([file.path], async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string | number>) => {
        frontmatter[settings.statusField] = status;
        this.ensureDefaultPriority(frontmatter);
        if (status === "completed") {
          frontmatter["completion-date"] = getCompletionDateString();
          frontmatter["completion-time"] = getCompletionTimeString();
        } else {
          delete frontmatter["completion-date"];
          delete frontmatter["completion-time"];
        }
      });
      this.stateStore.setStatus(file.path, status);
    });
  }

  private ensureDefaultPriority(frontmatter: Record<string, string | number>): void {
    const existingPriority = frontmatter[PRIORITY_FRONTMATTER_FIELD];
    if (existingPriority === undefined || existingPriority === null || String(existingPriority).trim() === "") {
      frontmatter[PRIORITY_FRONTMATTER_FIELD] = DEFAULT_PRIORITY;
    }
  }

  private async setFilePriority(file: TFile, priority: FilePriority): Promise<void> {
    await this.runWithPendingPaths([file.path], async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string | number>) => {
        frontmatter[PRIORITY_FRONTMATTER_FIELD] = priority;
      });
    });
  }
}
