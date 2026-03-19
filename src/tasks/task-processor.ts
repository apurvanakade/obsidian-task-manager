/**
 * Purpose:
 * - orchestrate end-to-end task processing for events and commands.
 *
 * Responsibilities:
 * - coordinates state lookup, reconciliation, status updates, and routing decisions
 * - enforces pending-write guards to prevent event feedback loops
 * - supports processing one file or all files under configured roots
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
import {
  extractTaskState,
  findDeletedTaggedTask,
  findNewlyCompletedTask,
  findNewlyUncompletedTask
} from "./task-utils";
import {
  applyCompletionRules,
  applyDeletedTagRules,
  applyUncompletionRules,
  processProjectsFolder,
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
      const content = await this.app.vault.cachedRead(file);
      this.stateStore.setTaskState(file.path, extractTaskState(content, settings.nextActionTag));
      this.stateStore.setStatus(file.path, readStatusValue(content, settings.statusField));
    }
  }

  async handleFileModify(file: TFile): Promise<void> {
    if (file.extension !== "md" || this.stateStore.isPending(file.path)) {
      return;
    }

    const settings = this.getSettings();
    const content = await this.app.vault.cachedRead(file);
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

  async processCurrentFile(): Promise<string> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      throw new Error("No active file.");
    }

    return await this.processAndRouteFile(file);
  }

  async processTasks(): Promise<string> {
    const settings = this.getSettings();
    if (getTaskFolderRoots(settings).length === 0) {
      throw new Error("Set at least one task folder in Task Manager settings first.");
    }

    const count = await processProjectsFolder({
      settings,
      getMarkdownFiles: () => this.app.vault.getMarkdownFiles(),
      reconcileOneFile: async (file) => {
        await this.processAndRouteFile(file);
      }
    });

    return `Processed ${count} project file${count === 1 ? "" : "s"}.`;
  }

  private async processAndRouteFile(file: TFile): Promise<string> {
    const settings = this.getSettings();
    const initialContent = await this.app.vault.cachedRead(file);
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
      settings,
      app: this.app,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.stateStore.setTaskState(filePath, nextState);
      }
    });
  }

  private async routeAfterStatusChange(file: TFile, previousStatus: string | null, settings: TaskManagerSettings): Promise<void> {
    const latestContent = await this.app.vault.cachedRead(file);
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
    const status = statusOverride ?? readStatusValue(await this.app.vault.cachedRead(file), settings.statusField);
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
    const destinationContent = await this.app.vault.cachedRead(destinationFile);
    const sourceContent = await this.app.vault.cachedRead(sourceFile);
    const mergedContent = destinationContent.includes(sourceContent)
      ? destinationContent
      : `${destinationContent.trimEnd()}\n\n---\n\n${sourceContent}`;

    this.stateStore.markPending(destinationFile.path);
    this.stateStore.markPending(sourceFile.path);

    try {
      await this.app.vault.modify(destinationFile, mergedContent);
      await this.app.vault.delete(sourceFile);
      this.stateStore.delete(sourceFile.path);
      this.stateStore.setTaskState(
        destinationFile.path,
        extractTaskState(mergedContent, settings.nextActionTag)
      );
      this.stateStore.setStatus(destinationFile.path, readStatusValue(mergedContent, settings.statusField));
      await deleteEmptyParentFolders(this.app, getTaskFolderRoots(settings), sourcePath);
    } finally {
      window.setTimeout(() => {
        this.stateStore.unmarkPending(destinationFile.path);
        this.stateStore.unmarkPending(sourceFile.path);
      }, 0);
    }
  }

  private async applyCompletionRules(file: TFile, content: string, completedLine: number, settings: TaskManagerSettings): Promise<void> {
    await applyCompletionRules({
      file,
      content,
      completedLine,
      settings,
      app: this.app,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.stateStore.setTaskState(filePath, nextState);
      }
    });
  }

  private async applyUncompletionRules(file: TFile, content: string, uncompletedLine: number, settings: TaskManagerSettings): Promise<void> {
    await applyUncompletionRules({
      file,
      content,
      uncompletedLine,
      settings,
      app: this.app,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.stateStore.setTaskState(filePath, nextState);
      }
    });
  }

  private async applyDeletedTagRules(file: TFile, content: string, deletedTaggedTaskLine: number, settings: TaskManagerSettings): Promise<void> {
    await applyDeletedTagRules({
      file,
      content,
      deletedTaggedTaskLine,
      settings,
      app: this.app,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.stateStore.setTaskState(filePath, nextState);
      }
    });
  }

  private async writeFileContent(file: TFile, content: string, settings: TaskManagerSettings): Promise<void> {
    this.stateStore.markPending(file.path);

    try {
      await this.app.vault.modify(file, content);
      this.stateStore.setTaskState(file.path, extractTaskState(content, settings.nextActionTag));
      this.stateStore.setStatus(file.path, readStatusValue(content, settings.statusField));
    } finally {
      window.setTimeout(() => {
        this.stateStore.unmarkPending(file.path);
      }, 0);
    }
  }

  private async setFileStatus(file: TFile, status: string, settings: TaskManagerSettings): Promise<void> {
    this.stateStore.markPending(file.path);

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
        frontmatter[settings.statusField] = status;
      });
      this.stateStore.setStatus(file.path, status);
    } finally {
      window.setTimeout(() => {
        this.stateStore.unmarkPending(file.path);
      }, 0);
    }
  }
}