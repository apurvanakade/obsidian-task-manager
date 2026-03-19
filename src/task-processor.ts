import { App, Notice, TFile, TFolder } from "obsidian";
import { TaskManagerSettings } from "./settings-utils";
import {
  extractTaskState,
  findDeletedTaggedTask,
  findNewlyCompletedTask,
  findNewlyUncompletedTask,
  TaskState
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
} from "./task-routing";

type TaskProcessorOptions = {
  app: App;
  getSettings: () => TaskManagerSettings;
};

export class TaskProcessor {
  private static readonly ROUTABLE_STATUSES = ["todo", "completed", "waiting", "scheduled", "someday-maybe"] as const;

  private readonly app: App;
  private readonly getSettings: () => TaskManagerSettings;
  private readonly taskStateByPath = new Map<string, TaskState[]>();
  private readonly statusByPath = new Map<string, string | null>();
  private readonly pendingPaths = new Set<string>();

  constructor(options: TaskProcessorOptions) {
    this.app = options.app;
    this.getSettings = options.getSettings;
  }

  onunload(): void {
    this.taskStateByPath.clear();
    this.statusByPath.clear();
    this.pendingPaths.clear();
  }

  async primeState(): Promise<void> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const settings = this.getSettings();
    this.statusByPath.clear();

    for (const file of markdownFiles) {
      const content = await this.app.vault.cachedRead(file);
      this.taskStateByPath.set(file.path, extractTaskState(content, settings.nextActionTag));
      this.statusByPath.set(file.path, this.readStatusValue(content, settings.statusField));
    }
  }

  async handleFileModify(file: TFile): Promise<void> {
    if (file.extension !== "md" || this.pendingPaths.has(file.path)) {
      return;
    }

    const settings = this.getSettings();
    const content = await this.app.vault.cachedRead(file);
    const nextState = extractTaskState(content, settings.nextActionTag);
    const previousState = this.taskStateByPath.get(file.path) ?? [];
    const previousStatus = this.statusByPath.get(file.path) ?? null;
    const currentStatus = this.readStatusValue(content, settings.statusField);
    const completion = findNewlyCompletedTask(previousState, nextState);
    const uncompleted = findNewlyUncompletedTask(previousState, nextState);
    const deletedTaggedTaskLine = findDeletedTaggedTask(previousState, nextState);

    this.taskStateByPath.set(file.path, nextState);
    this.statusByPath.set(file.path, currentStatus);

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
    const { projectsFolder, completedProjectsFolder, waitingProjectsFolder, scheduledProjectsFolder, somedayMaybeProjectsFolder } = settings;
    const hasAnyFolder = [projectsFolder, completedProjectsFolder, waitingProjectsFolder, scheduledProjectsFolder, somedayMaybeProjectsFolder].some(Boolean);
    if (!hasAnyFolder) {
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

  private isRoutableStatus(value: string): value is (typeof TaskProcessor.ROUTABLE_STATUSES)[number] {
    return (TaskProcessor.ROUTABLE_STATUSES as readonly string[]).includes(value);
  }

  private async processAndRouteFile(file: TFile): Promise<string> {
    const settings = this.getSettings();
    const initialContent = await this.app.vault.cachedRead(file);
    const initialStatus = this.readStatusValue(initialContent, settings.statusField);
    const hasOpenTasks = extractTaskState(initialContent, settings.nextActionTag).some((task) => task.status === "open");
    const predictedStatus = this.predictFinalStatus(initialStatus, hasOpenTasks);
    this.assertConfiguredDestinationForStatus(predictedStatus, settings);

    await this.reconcileSingleFile(file, settings);

    const moveResult = await this.routeFileByStatus(file, settings);
    return moveResult ?? `Processed ${file.name}.`;
  }

  private async reconcileSingleFile(file: TFile, settings: TaskManagerSettings): Promise<void> {
    await reconcileFile({
      file,
      settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.taskStateByPath.set(filePath, nextState);
      }
    });
  }

  private async routeAfterStatusChange(file: TFile, previousStatus: string | null, settings: TaskManagerSettings): Promise<void> {
    const latestContent = await this.app.vault.cachedRead(file);
    const latestStatus = this.readStatusValue(latestContent, settings.statusField);
    this.statusByPath.set(file.path, latestStatus);

    if (latestStatus === previousStatus) {
      return;
    }

    try {
      this.assertConfiguredDestinationForStatus(latestStatus, settings);
      await this.routeFileByStatus(file, settings, latestStatus);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to route file after status change.");
    }
  }

  private async routeFileByStatus(file: TFile, settings: TaskManagerSettings, statusOverride?: string | null): Promise<string | null> {
    const status = statusOverride ?? this.readStatusValue(await this.app.vault.cachedRead(file), settings.statusField);
    if (!status || !this.isRoutableStatus(status)) {
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
    this.rekeyTaskState(sourcePath, destinationPath);
    await deleteEmptyParentFolders(this.app, getTaskFolderRoots(settings), sourcePath);
    return `Moved ${file.name} to ${destinationRoot}.`;
  }

  private readStatusValue(content: string, statusField: string): string | null {
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) {
      return null;
    }

    const fieldRegex = new RegExp(`^\\s*${this.escapeRegExp(statusField)}\\s*:\\s*(.*?)\\s*$`, "i");
    const lines = frontmatterMatch[1].split(/\r?\n/);

    for (const line of lines) {
      const match = line.match(fieldRegex);
      if (!match) {
        continue;
      }

      return match[1].replace(/^['\"]|['\"]$/g, "").trim().toLowerCase();
    }

    return null;
  }

  private predictFinalStatus(currentStatus: string | null, hasOpenTasks: boolean): string | null {
    if (hasOpenTasks) {
      if (currentStatus !== null && currentStatus !== "completed") {
        return currentStatus;
      }

      return "todo";
    }

    return "completed";
  }

  private assertConfiguredDestinationForStatus(status: string | null, settings: TaskManagerSettings): void {
    if (!status || !this.isRoutableStatus(status)) {
      return;
    }

    const destinationRoot = getDestinationRootForStatus(settings, status);
    if (!destinationRoot) {
      throw new Error(`Set destination folder for status '${status}' in Task Manager settings.`);
    }
  }

  private async mergeIntoExistingFile(sourceFile: TFile, destinationFile: TFile, settings: TaskManagerSettings): Promise<void> {
    const sourcePath = sourceFile.path;
    const destinationContent = await this.app.vault.cachedRead(destinationFile);
    const sourceContent = await this.app.vault.cachedRead(sourceFile);
    const mergedContent = destinationContent.includes(sourceContent)
      ? destinationContent
      : `${destinationContent.trimEnd()}\n\n---\n\n${sourceContent}`;

    this.pendingPaths.add(destinationFile.path);
    this.pendingPaths.add(sourceFile.path);

    try {
      await this.app.vault.modify(destinationFile, mergedContent);
      await this.app.vault.delete(sourceFile);
      this.taskStateByPath.delete(sourceFile.path);
      this.statusByPath.delete(sourceFile.path);
      this.taskStateByPath.set(
        destinationFile.path,
        extractTaskState(mergedContent, settings.nextActionTag)
      );
      this.statusByPath.set(destinationFile.path, this.readStatusValue(mergedContent, settings.statusField));
      await deleteEmptyParentFolders(this.app, getTaskFolderRoots(settings), sourcePath);
    } finally {
      window.setTimeout(() => {
        this.pendingPaths.delete(destinationFile.path);
        this.pendingPaths.delete(sourceFile.path);
      }, 0);
    }
  }

  private rekeyTaskState(oldPath: string, newPath: string): void {
    const existing = this.taskStateByPath.get(oldPath);
    this.taskStateByPath.delete(oldPath);
    if (existing) {
      this.taskStateByPath.set(newPath, existing);
    }

    const existingStatus = this.statusByPath.get(oldPath) ?? null;
    this.statusByPath.delete(oldPath);
    this.statusByPath.set(newPath, existingStatus);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async applyCompletionRules(file: TFile, content: string, completedLine: number, settings: TaskManagerSettings): Promise<void> {
    await applyCompletionRules({
      file,
      content,
      completedLine,
      settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.taskStateByPath.set(filePath, nextState);
      }
    });
  }

  private async applyUncompletionRules(file: TFile, content: string, uncompletedLine: number, settings: TaskManagerSettings): Promise<void> {
    await applyUncompletionRules({
      file,
      content,
      uncompletedLine,
      settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.taskStateByPath.set(filePath, nextState);
      }
    });
  }

  private async applyDeletedTagRules(file: TFile, content: string, deletedTaggedTaskLine: number, settings: TaskManagerSettings): Promise<void> {
    await applyDeletedTagRules({
      file,
      content,
      deletedTaggedTaskLine,
      settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.taskStateByPath.set(filePath, nextState);
      }
    });
  }

  private async writeFileContent(file: TFile, content: string, settings: TaskManagerSettings): Promise<void> {
    this.pendingPaths.add(file.path);

    try {
      await this.app.vault.modify(file, content);
      this.taskStateByPath.set(file.path, extractTaskState(content, settings.nextActionTag));
      this.statusByPath.set(file.path, this.readStatusValue(content, settings.statusField));
    } finally {
      window.setTimeout(() => {
        this.pendingPaths.delete(file.path);
      }, 0);
    }
  }

  private async setFileStatus(file: TFile, status: string, settings: TaskManagerSettings): Promise<void> {
    this.pendingPaths.add(file.path);

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
        frontmatter[settings.statusField] = status;
      });
      this.statusByPath.set(file.path, status);
    } finally {
      window.setTimeout(() => {
        this.pendingPaths.delete(file.path);
      }, 0);
    }
  }
}