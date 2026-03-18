import { App, Notice, Plugin, PluginSettingTab, TFile } from "obsidian";
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
  initializeProjectsFolder,
  reconcileFile
} from "./src/reconciler";

export default class TaskManagerPlugin extends Plugin {
  private readonly taskStateByPath = new Map<string, TaskState[]>();

  // Prevent re-processing of writes triggered by this plugin itself.
  private readonly pendingPaths = new Set<string>();

  private settings: TaskManagerSettings = normalizeSettings({});

  async onload(): Promise<void> {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.addSettingTab(new BaseTaskManagerSettingTab(this.app, this));
    this.addCommand({
      id: "initialize-projects-folder",
      name: "Initialize",
      callback: () => {
        void this.initializeProjectsFolder();
      }
    });
    this.registerEvent(this.app.vault.on("modify", (file) => {
      void this.handleFileModify(file);
    }));
    await this.primeTaskState();
  }

  onunload(): void {
    this.taskStateByPath.clear();
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

    for (const file of markdownFiles) {
      const content = await this.app.vault.cachedRead(file);
      this.taskStateByPath.set(file.path, extractTaskState(content, this.settings.nextActionTag));
    }
  }

  private async handleFileModify(file: TFile): Promise<void> {
    if (file.extension !== "md" || this.pendingPaths.has(file.path)) {
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const nextState = extractTaskState(content, this.settings.nextActionTag);
    const previousState = this.taskStateByPath.get(file.path) ?? [];
    const completion = findNewlyCompletedTask(previousState, nextState);
    const uncompleted = findNewlyUncompletedTask(previousState, nextState);
    const deletedTaggedTaskLine = findDeletedTaggedTask(previousState, nextState);

    this.taskStateByPath.set(file.path, nextState);

    if (completion !== null) {
      await this.applyCompletionRules(file, content, completion, previousState, nextState);
      return;
    }

    if (uncompleted !== null) {
      await this.applyUncompletionRules(file, content, uncompleted);
      return;
    }

    if (deletedTaggedTaskLine !== null) {
      await this.applyDeletedTagRules(file, content, deletedTaggedTaskLine);
    }
  }

  private async initializeProjectsFolder(): Promise<void> {
    const projectsFolder = this.settings.projectsFolder;
    if (!projectsFolder) {
      new Notice("Set Projects Folder in Task Manager settings first.");
      return;
    }

    const count = await initializeProjectsFolder({
      settings: this.settings,
      getMarkdownFiles: () => this.app.vault.getMarkdownFiles(),
      reconcileOneFile: async (file) => {
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
    });

    new Notice(`Initialized ${count} project file${count === 1 ? "" : "s"}.`);
  }

  private async applyCompletionRules(
    file: TFile,
    content: string,
    completedLine: number,
    previousState: TaskState[],
    nextState: TaskState[]
  ): Promise<void> {
    await applyCompletionRules({
      file,
      content,
      completedLine,
      previousState,
      nextState,
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