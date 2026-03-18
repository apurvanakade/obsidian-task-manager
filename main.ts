import { App, Modal, Notice, Plugin, PluginSettingTab, TFile, TFolder } from "obsidian";
import { normalizeSettings, TaskManagerSettings } from "./src/settings-utils";
import {
  extractTaskState,
  findDeletedTaggedTask,
  findNewlyCompletedTask,
  findNewlyUncompletedTask,
  TaskState
} from "./src/task-utils";
import { TaskManagerSettingTabRenderer } from "./src/settings-ui";
import {
  applyCompletionRules,
  applyDeletedTagRules,
  applyUncompletionRules,
  processProjectsFolder,
  reconcileFile
} from "./src/reconciler";

export default class TaskManagerPlugin extends Plugin {
  private readonly taskStateByPath = new Map<string, TaskState[]>();
  private readonly statusByPath = new Map<string, string | null>();

  // Prevent re-processing of writes triggered by this plugin itself.
  private readonly pendingPaths = new Set<string>();

  private settings: TaskManagerSettings = normalizeSettings({});

  private static readonly ROUTABLE_STATUSES = ["todo", "completed", "waiting", "scheduled", "someday-maybe"] as const;

  private isRoutableStatus(value: string): value is (typeof TaskManagerPlugin.ROUTABLE_STATUSES)[number] {
    return (TaskManagerPlugin.ROUTABLE_STATUSES as readonly string[]).includes(value);
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.addSettingTab(new BaseTaskManagerSettingTab(this.app, this));
    this.addCommand({
      id: "process-tasks",
      name: "Process Tasks",
      callback: () => {
        void this.processTasks();
      }
    });
    this.addCommand({
      id: "process-current-file",
      name: "Process file",
      callback: () => {
        void this.processCurrentFile();
      }
    });
    this.registerEvent(this.app.vault.on("modify", (file) => {
      void this.handleFileModify(file);
    }));
    await this.primeTaskState();
  }

  onunload(): void {
    this.taskStateByPath.clear();
    this.statusByPath.clear();
    this.pendingPaths.clear();
    console.log("Unloading Task Manager plugin");
  }

  async loadSettings(): Promise<void> {
    const loadedData = await this.loadData() as Partial<TaskManagerSettings> | null;
    this.settings = normalizeSettings(loadedData ?? {});
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    await this.primeTaskState();
  }

  getSettings(): TaskManagerSettings {
    return { ...this.settings };
  }

  async updateSetting<K extends keyof TaskManagerSettings>(key: K, value: TaskManagerSettings[K]): Promise<void> {
    this.settings[key] = value;
    await this.saveSettings();
  }

  private async primeTaskState(): Promise<void> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    this.statusByPath.clear();

    for (const file of markdownFiles) {
      const content = await this.app.vault.cachedRead(file);
      this.taskStateByPath.set(file.path, extractTaskState(content, this.settings.nextActionTag));
      this.statusByPath.set(file.path, this.readStatusValue(content));
    }
  }

  private async handleFileModify(file: TFile): Promise<void> {
    if (file.extension !== "md" || this.pendingPaths.has(file.path)) {
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const nextState = extractTaskState(content, this.settings.nextActionTag);
    const previousState = this.taskStateByPath.get(file.path) ?? [];
    const previousStatus = this.statusByPath.get(file.path) ?? null;
    const currentStatus = this.readStatusValue(content);
    const completion = findNewlyCompletedTask(previousState, nextState);
    const uncompleted = findNewlyUncompletedTask(previousState, nextState);
    const deletedTaggedTaskLine = findDeletedTaggedTask(previousState, nextState);

    this.taskStateByPath.set(file.path, nextState);
    this.statusByPath.set(file.path, currentStatus);

    if (completion !== null) {
      await this.applyCompletionRules(file, content, completion);
      await this.routeAfterStatusChange(file, previousStatus);
      return;
    }

    if (uncompleted !== null) {
      await this.applyUncompletionRules(file, content, uncompleted);
      await this.routeAfterStatusChange(file, previousStatus);
      return;
    }

    if (deletedTaggedTaskLine !== null) {
      await this.applyDeletedTagRules(file, content, deletedTaggedTaskLine);
      await this.routeAfterStatusChange(file, previousStatus);
      return;
    }

    await this.routeAfterStatusChange(file, previousStatus);
  }

  private async processCurrentFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file.");
      return;
    }

    try {
      const result = await this.processAndRouteFile(file);
      new Notice(result);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to process file.");
    }
  }

  private async processTasks(): Promise<void> {
    const { projectsFolder, completedProjectsFolder, waitingProjectsFolder, scheduledProjectsFolder, somedayMaybeProjectsFolder } = this.settings;
    const hasAnyFolder = [projectsFolder, completedProjectsFolder, waitingProjectsFolder, scheduledProjectsFolder, somedayMaybeProjectsFolder].some(Boolean);
    if (!hasAnyFolder) {
      new Notice("Set at least one task folder in Task Manager settings first.");
      return;
    }

    try {
      const count = await processProjectsFolder({
        settings: this.settings,
        getMarkdownFiles: () => this.app.vault.getMarkdownFiles(),
        reconcileOneFile: async (file) => {
          await this.processAndRouteFile(file);
        }
      });

      new Notice(`Processed ${count} project file${count === 1 ? "" : "s"}.`);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to process tasks.");
    }
  }

  private async reconcileSingleFile(file: TFile): Promise<void> {
    await reconcileFile({
      file,
      settings: this.settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent),
      setFileStatus: (target, status) => this.setFileStatus(target, status),
      setTaskState: (filePath, nextState) => {
        this.taskStateByPath.set(filePath, nextState);
      }
    });
  }

  private async processAndRouteFile(file: TFile): Promise<string> {
    const initialContent = await this.app.vault.cachedRead(file);
    const initialStatus = this.readStatusValue(initialContent);
    const hasOpenTasks = extractTaskState(initialContent, this.settings.nextActionTag).some((task) => task.status === "open");
    const predictedStatus = this.predictFinalStatus(initialStatus, hasOpenTasks);
    this.assertConfiguredDestinationForStatus(predictedStatus);

    await this.reconcileSingleFile(file);

    const moveResult = await this.routeFileByStatus(file);
    return moveResult ?? `Processed ${file.name}.`;
  }

  private async routeAfterStatusChange(file: TFile, previousStatus: string | null): Promise<void> {
    const latestContent = await this.app.vault.cachedRead(file);
    const latestStatus = this.readStatusValue(latestContent);
    this.statusByPath.set(file.path, latestStatus);

    if (latestStatus === previousStatus) {
      return;
    }

    try {
      this.assertConfiguredDestinationForStatus(latestStatus);
      await this.routeFileByStatus(file, latestStatus);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to route file after status change.");
    }
  }

  private async routeFileByStatus(file: TFile, statusOverride?: string | null): Promise<string | null> {
    const status = statusOverride ?? this.readStatusValue(await this.app.vault.cachedRead(file));
    if (!status || !this.isRoutableStatus(status)) {
      return null;
    }

    const destinationRoot = this.getDestinationRootForStatus(status);
    if (!destinationRoot) {
      throw new Error(`Set destination folder for status '${status}' in Task Manager settings.`);
    }

    const destinationPath = this.buildDestinationPath(file, destinationRoot);
    if (destinationPath === file.path) {
      return null;
    }

    await this.ensureParentFoldersExist(destinationPath);
    const destinationEntry = this.app.vault.getAbstractFileByPath(destinationPath);

    if (destinationEntry instanceof TFolder) {
      throw new Error(`Cannot move '${file.path}' because '${destinationPath}' is a folder.`);
    }

    if (destinationEntry instanceof TFile) {
      const shouldMerge = await this.promptMergeOrSkip(file.path, destinationPath);

      if (!shouldMerge) {
        return `Skipped ${file.name} (destination exists).`;
      }

      await this.mergeIntoExistingFile(file, destinationEntry);
      return `Merged ${file.name} into ${destinationPath}.`;
    }

    const sourcePath = file.path;
    await this.app.fileManager.renameFile(file, destinationPath);
    this.rekeyTaskState(sourcePath, destinationPath);
    await this.deleteEmptyParentFolders(sourcePath);
    return `Moved ${file.name} to ${destinationRoot}.`;
  }

  private readStatusValue(content: string): string | null {
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) {
      return null;
    }

    const statusField = this.settings.statusField;
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

  private assertConfiguredDestinationForStatus(status: string | null): void {
    if (!status || !this.isRoutableStatus(status)) {
      return;
    }

    const destinationRoot = this.getDestinationRootForStatus(status);
    if (!destinationRoot) {
      throw new Error(`Set destination folder for status '${status}' in Task Manager settings.`);
    }
  }

  private getDestinationRootForStatus(status: (typeof TaskManagerPlugin.ROUTABLE_STATUSES)[number]): string {
    switch (status) {
      case "todo":
        return this.settings.projectsFolder;
      case "completed":
        return this.settings.completedProjectsFolder;
      case "waiting":
        return this.settings.waitingProjectsFolder;
      case "scheduled":
        return this.settings.scheduledProjectsFolder;
      case "someday-maybe":
        return this.settings.somedayMaybeProjectsFolder;
      default:
        return "";
    }
  }

  private buildDestinationPath(file: TFile, destinationRoot: string): string {
    const relativePath = this.getRelativeProjectPath(file.path) ?? file.name;
    return this.joinPath(destinationRoot, relativePath);
  }

  private getRelativeProjectPath(filePath: string): string | null {
    const matchingRoot = this.getTaskFolderRoots()
      .filter((root) => filePath.startsWith(`${root}/`))
      .sort((a, b) => b.length - a.length)[0];

    if (!matchingRoot) {
      return null;
    }

    return filePath.slice(matchingRoot.length + 1);
  }

  private joinPath(root: string, childPath: string): string {
    const normalizedRoot = root.replace(/\/+$/g, "");
    const normalizedChild = childPath.replace(/^\/+/, "");
    return normalizedRoot ? `${normalizedRoot}/${normalizedChild}` : normalizedChild;
  }

  private async ensureParentFoldersExist(targetFilePath: string): Promise<void> {
    const parentPath = this.getParentPath(targetFilePath);
    if (!parentPath) {
      return;
    }

    const parts = parentPath.split("/").filter(Boolean);
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (!existing) {
        await this.app.vault.createFolder(currentPath);
        continue;
      }

      if (existing instanceof TFile) {
        throw new Error(`Cannot create folder '${currentPath}' because a file already exists at that path.`);
      }
    }
  }

  private getParentPath(path: string): string {
    const slashIndex = path.lastIndexOf("/");
    return slashIndex === -1 ? "" : path.slice(0, slashIndex);
  }

  private async mergeIntoExistingFile(sourceFile: TFile, destinationFile: TFile): Promise<void> {
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
        extractTaskState(mergedContent, this.settings.nextActionTag)
      );
      this.statusByPath.set(destinationFile.path, this.readStatusValue(mergedContent));
      await this.deleteEmptyParentFolders(sourcePath);
    } finally {
      window.setTimeout(() => {
        this.pendingPaths.delete(destinationFile.path);
        this.pendingPaths.delete(sourceFile.path);
      }, 0);
    }
  }

  private getTaskFolderRoots(): string[] {
    const roots = [
      this.settings.projectsFolder,
      this.settings.completedProjectsFolder,
      this.settings.waitingProjectsFolder,
      this.settings.scheduledProjectsFolder,
      this.settings.somedayMaybeProjectsFolder,
    ].filter(Boolean);
    return [...new Set(roots)];
  }

  private async deleteEmptyParentFolders(sourceFilePath: string): Promise<void> {
    const protectedRoots = new Set(this.getTaskFolderRoots());
    let currentPath = this.getParentPath(sourceFilePath);

    while (currentPath) {
      if (protectedRoots.has(currentPath)) {
        return;
      }

      const entry = this.app.vault.getAbstractFileByPath(currentPath);
      if (!(entry instanceof TFolder)) {
        return;
      }

      const hasDescendants = this.app.vault
        .getAllLoadedFiles()
        .some((candidate) => candidate.path !== currentPath && candidate.path.startsWith(`${currentPath}/`));

      if (hasDescendants) {
        return;
      }

      await this.app.vault.delete(entry, true);
      currentPath = this.getParentPath(currentPath);
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

  private async promptMergeOrSkip(sourcePath: string, destinationPath: string): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      class MergeConflictModal extends Modal {
        private resolved = false;

        onOpen(): void {
          const { contentEl } = this;
          contentEl.empty();

          const title = document.createElement("h3");
          title.textContent = "File Already Exists";
          contentEl.appendChild(title);

          const message = document.createElement("p");
          message.textContent = "A destination file already exists. Choose how to proceed:";
          contentEl.appendChild(message);

          const sourceLabel = document.createElement("p");
          sourceLabel.textContent = `Source: ${sourcePath}`;
          contentEl.appendChild(sourceLabel);

          const destinationLabel = document.createElement("p");
          destinationLabel.textContent = `Destination: ${destinationPath}`;
          contentEl.appendChild(destinationLabel);

          const actions = document.createElement("div");
          actions.style.display = "flex";
          actions.style.gap = "8px";
          actions.style.marginTop = "12px";

          const mergeButton = document.createElement("button");
          mergeButton.textContent = "Merge";
          mergeButton.addEventListener("click", () => {
            this.resolved = true;
            resolve(true);
            this.close();
          });

          const skipButton = document.createElement("button");
          skipButton.textContent = "Do Nothing";
          skipButton.addEventListener("click", () => {
            this.resolved = true;
            resolve(false);
            this.close();
          });

          actions.appendChild(mergeButton);
          actions.appendChild(skipButton);
          contentEl.appendChild(actions);
        }

        onClose(): void {
          if (!this.resolved) {
            resolve(false);
          }
        }
      }

      new MergeConflictModal(this.app).open();
    });
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async applyCompletionRules(
    file: TFile,
    content: string,
    completedLine: number
  ): Promise<void> {
    await applyCompletionRules({
      file,
      content,
      completedLine,
      settings: this.settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent),
      setFileStatus: (target, status) => this.setFileStatus(target, status),
      setTaskState: (filePath, nextState) => {
        this.taskStateByPath.set(filePath, nextState);
      }
    });
  }

  private async applyUncompletionRules(file: TFile, content: string, uncompletedLine: number): Promise<void> {
    await applyUncompletionRules({
      file,
      content,
      uncompletedLine,
      settings: this.settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent),
      setFileStatus: (target, status) => this.setFileStatus(target, status),
      setTaskState: (filePath, nextState) => {
        this.taskStateByPath.set(filePath, nextState);
      }
    });
  }

  private async applyDeletedTagRules(file: TFile, content: string, deletedTaggedTaskLine: number): Promise<void> {
    await applyDeletedTagRules({
      file,
      content,
      deletedTaggedTaskLine,
      settings: this.settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent),
      setFileStatus: (target, status) => this.setFileStatus(target, status),
      setTaskState: (filePath, nextState) => {
        this.taskStateByPath.set(filePath, nextState);
      }
    });
  }

  private async writeFileContent(file: TFile, content: string): Promise<void> {
    this.pendingPaths.add(file.path);

    try {
      await this.app.vault.modify(file, content);
      this.taskStateByPath.set(file.path, extractTaskState(content, this.settings.nextActionTag));
      this.statusByPath.set(file.path, this.readStatusValue(content));
    } finally {
      window.setTimeout(() => {
        this.pendingPaths.delete(file.path);
      }, 0);
    }
  }

  private async setFileStatus(file: TFile, status: string): Promise<void> {
    this.pendingPaths.add(file.path);

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
        frontmatter[this.settings.statusField] = status;
      });
      this.statusByPath.set(file.path, status);
    } finally {
      window.setTimeout(() => {
        this.pendingPaths.delete(file.path);
      }, 0);
    }
  }
}

class BaseTaskManagerSettingTab extends PluginSettingTab {
  private readonly renderer: TaskManagerSettingTabRenderer;

  constructor(app: App, plugin: TaskManagerPlugin) {
    super(app, plugin);
    this.renderer = new TaskManagerSettingTabRenderer(this, plugin);
  }

  display(): void {
    this.renderer.display();
  }
}