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
import { TaskManagerSettings } from "../settings/settings-utils";
import { FilePriority, PRIORITY_FRONTMATTER_FIELD } from "./file-priority";
import {
  extractTaskState,
  findDeletedTaggedTask,
  findNewlyCompletedTask,
  findNewlyUncompletedTask,
  resetTaskContent,
  TaskState,
} from "./task-utils";
import {
  applyCompletionRules,
  applyDeletedTagRules,
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

type TaskProcessorOptions = {
  app: App;
  getSettings: () => TaskManagerSettings;
};

export class TaskProcessor {
  private readonly app: App;
  private readonly getSettings: () => TaskManagerSettings;
  private readonly stateStore = new TaskStateStore();

  constructor(options: TaskProcessorOptions) {
    this.app = options.app;
    this.getSettings = options.getSettings;
  }

  onunload(): void {
    this.stateStore.clear();
  }

  async primeState(): Promise<void> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const settings = this.getSettings();
    this.stateStore.clear();

    for (const file of markdownFiles) {
      const content = await this.app.vault.read(file);
      this.updateFileSnapshot(file.path, content, settings);
    }
  }

  async handleFileCreate(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      return;
    }

    const settings = this.getSettings();
    const content = await this.app.vault.read(file);
    this.updateFileSnapshot(file.path, content, settings);
  }

  async handleFileModify(file: TFile): Promise<void> {
    if (file.extension !== "md" || this.stateStore.isPending(file.path)) {
      return;
    }

    const settings = this.getSettings();
    const content = await this.app.vault.read(file);
    const nextState = extractTaskState(content, settings.nextActionTag);
    const previousState = this.stateStore.getTaskState(file.path);
    const previousStatus = this.stateStore.getStatus(file.path);
    const currentStatus = readStatusValue(content, settings.statusField);
    const completion = findNewlyCompletedTask(previousState, nextState);
    const uncompleted = findNewlyUncompletedTask(previousState, nextState);
    const deletedTaggedTaskLine = findDeletedTaggedTask(previousState, nextState);

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

    if (deletedTaggedTaskLine !== null) {
      await this.applyDeletedTagRules(file, content, deletedTaggedTaskLine, settings);
      await this.routeAfterStatusChange(file, previousStatus, settings);
      return;
    }

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
    const hasOpenTasks = extractTaskState(initialContent, settings.nextActionTag).some((task) => task.status === "open");
    const predictedStatus = predictFinalStatus(initialStatus, hasOpenTasks);
    assertConfiguredDestinationForStatus(predictedStatus, settings);

    await this.reconcileSingleFile(file, settings);

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

    try {
      assertConfiguredDestinationForStatus(latestStatus, settings);
      await this.routeFileByStatus(file, settings, latestStatus);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to route file after status change.");
    }
  }

  private async routeFileByStatus(file: TFile, settings: TaskManagerSettings, statusOverride?: string | null): Promise<string | null> {
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
    const mergedContent = destinationContent.includes(sourceContent)
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

  private async applyCompletionRules(file: TFile, content: string, completedLine: number, settings: TaskManagerSettings): Promise<void> {
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

  private async applyDeletedTagRules(file: TFile, content: string, deletedTaggedTaskLine: number, settings: TaskManagerSettings): Promise<void> {
    await applyDeletedTagRules({
      file,
      content,
      deletedTaggedTaskLine,
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
      }
    };
  }

  private updateFileSnapshot(filePath: string, content: string, settings: TaskManagerSettings): void {
    this.stateStore.setTaskState(filePath, extractTaskState(content, settings.nextActionTag));
    this.stateStore.setStatus(filePath, readStatusValue(content, settings.statusField));
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
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
        frontmatter[settings.statusField] = status;
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

  private async setFilePriority(file: TFile, priority: FilePriority): Promise<void> {
    await this.runWithPendingPaths([file.path], async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string | number>) => {
        frontmatter[PRIORITY_FRONTMATTER_FIELD] = priority;
      });
    });
  }
}
