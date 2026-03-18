import { App, FuzzySuggestModal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, TextComponent } from "obsidian";

const TASK_LINE_REGEX = /^(\s*[-*+]\s+\[( |x|X)\]\s+)(.*)$/;

type TaskState = {
  line: number;
  completed: boolean;
  hasNextAction: boolean;
};

type TaskManagerSettings = {
  nextActionTag: string;
  statusField: string;
  projectsFolder: string;
};

const DEFAULT_SETTINGS: TaskManagerSettings = {
  nextActionTag: "#next-action",
  statusField: "status",
  projectsFolder: ""
};

export default class TaskManagerPlugin extends Plugin {
  private readonly taskStateByPath = new Map<string, TaskState[]>();

  private readonly pendingPaths = new Set<string>();

  private settings: TaskManagerSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.addSettingTab(new TaskManagerSettingTab(this.app, this));
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
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loadedData ?? {})
    };
    this.settings.nextActionTag = this.normalizeTag(this.settings.nextActionTag);
    this.settings.statusField = this.normalizeStatusField(this.settings.statusField);
    this.settings.projectsFolder = this.normalizeFolder(this.settings.projectsFolder);
  }

  async saveSettings(): Promise<void> {
    this.settings.nextActionTag = this.normalizeTag(this.settings.nextActionTag);
    this.settings.statusField = this.normalizeStatusField(this.settings.statusField);
    this.settings.projectsFolder = this.normalizeFolder(this.settings.projectsFolder);
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
      this.taskStateByPath.set(file.path, this.extractTaskState(content));
    }
  }

  private async handleFileModify(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      return;
    }

    if (this.pendingPaths.has(file.path)) {
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const nextState = this.extractTaskState(content);
    const previousState = this.taskStateByPath.get(file.path) ?? [];
    const completion = this.findNewlyCompletedTask(previousState, nextState);
    const deletedTaggedTaskLine = this.findDeletedTaggedTask(previousState, nextState);

    this.taskStateByPath.set(file.path, nextState);

    if (completion !== null) {
      await this.applyCompletionRules(file, content, completion);
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

    const files = this.app.vault.getMarkdownFiles().filter((file) => this.isInProjectsFolder(file));
    for (const file of files) {
      await this.reconcileFile(file);
    }

    new Notice(`Initialized ${files.length} project file${files.length === 1 ? "" : "s"}.`);
  }

  private extractTaskState(content: string): TaskState[] {
    const lines = content.split(/\r?\n/);
    const taskState: TaskState[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(TASK_LINE_REGEX);
      if (!match) {
        continue;
      }

      taskState.push({
        line: index,
        completed: match[2].toLowerCase() === "x",
        hasNextAction: this.lineHasTag(lines[index])
      });
    }

    return taskState;
  }

  private findNewlyCompletedTask(previousState: TaskState[], nextState: TaskState[]): number | null {
    const previousByLine = new Map(previousState.map((task) => [task.line, task.completed]));

    for (const task of nextState) {
      const wasCompleted = previousByLine.get(task.line);
      if (wasCompleted === false && task.completed) {
        return task.line;
      }
    }

    return null;
  }

  private findDeletedTaggedTask(previousState: TaskState[], nextState: TaskState[]): number | null {
    const previousTaggedTask = previousState.find((task) => task.hasNextAction);
    if (!previousTaggedTask) {
      return null;
    }

    const hasCurrentTaggedTask = nextState.some((task) => task.hasNextAction);
    if (hasCurrentTaggedTask) {
      return null;
    }

    const sameLineStillExists = nextState.some((task) => task.line === previousTaggedTask.line);
    if (sameLineStillExists) {
      return null;
    }

    return previousTaggedTask.line;
  }

  private async applyCompletionRules(file: TFile, content: string, completedLine: number): Promise<void> {
    const lines = content.split(/\r?\n/);
    const nextTaskLine = this.findNextIncompleteTaskLine(lines, completedLine);
    const cleanedLines = this.stripNextActionTags(lines);
    let updatedContent = cleanedLines.join("\n");

    if (nextTaskLine !== null) {
      updatedContent = this.addNextActionTag(cleanedLines, nextTaskLine);
    }

    if (updatedContent !== content) {
      await this.writeFileContent(file, updatedContent);
    }

    await this.setFileStatus(file, nextTaskLine === null ? "completed" : "todo");
    const refreshedContent = await this.app.vault.cachedRead(file);
    this.taskStateByPath.set(file.path, this.extractTaskState(refreshedContent));
  }

  private async applyDeletedTagRules(file: TFile, content: string, deletedTaggedTaskLine: number): Promise<void> {
    const lines = content.split(/\r?\n/);
    const cleanedLines = this.stripNextActionTags(lines);
    const previousTaskLine = this.findPreviousIncompleteTaskLine(cleanedLines, deletedTaggedTaskLine);

    if (previousTaskLine === null) {
      await this.setFileStatus(file, "completed");
      const refreshedContent = await this.app.vault.cachedRead(file);
      this.taskStateByPath.set(file.path, this.extractTaskState(refreshedContent));
      return;
    }

    const updatedContent = this.addNextActionTag(cleanedLines, previousTaskLine);
    if (updatedContent !== content) {
      await this.writeFileContent(file, updatedContent);
    }

    await this.setFileStatus(file, "todo");
    const refreshedContent = await this.app.vault.cachedRead(file);
    this.taskStateByPath.set(file.path, this.extractTaskState(refreshedContent));
  }

  private async reconcileFile(file: TFile): Promise<void> {
    const content = await this.app.vault.cachedRead(file);
    const lines = content.split(/\r?\n/);
    const cleanedLines = this.stripNextActionTags(lines);
    const firstIncompleteTaskLine = this.findFirstIncompleteTaskLine(cleanedLines);
    let updatedContent = cleanedLines.join("\n");
    let nextStatus = "completed";

    if (firstIncompleteTaskLine !== null) {
      updatedContent = this.addNextActionTag(cleanedLines, firstIncompleteTaskLine);
      nextStatus = "todo";
    }

    if (updatedContent !== content) {
      await this.writeFileContent(file, updatedContent);
    }

    await this.setFileStatus(file, nextStatus);
    const refreshedContent = await this.app.vault.cachedRead(file);
    this.taskStateByPath.set(file.path, this.extractTaskState(refreshedContent));
  }

  private findNextIncompleteTaskLine(lines: string[], completedLine: number): number | null {
    for (let index = completedLine + 1; index < lines.length; index += 1) {
      const match = lines[index].match(TASK_LINE_REGEX);
      if (!match) {
        continue;
      }

      if (match[2] === " ") {
        return index;
      }
    }

    return null;
  }

  private findPreviousIncompleteTaskLine(lines: string[], referenceLine: number): number | null {
    for (let index = Math.min(referenceLine - 1, lines.length - 1); index >= 0; index -= 1) {
      const match = lines[index].match(TASK_LINE_REGEX);
      if (!match) {
        continue;
      }

      if (match[2] === " ") {
        return index;
      }
    }

    return this.findFirstIncompleteTaskLine(lines);
  }

  private findFirstIncompleteTaskLine(lines: string[]): number | null {
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(TASK_LINE_REGEX);
      if (match?.[2] === " ") {
        return index;
      }
    }

    return null;
  }

  private stripNextActionTags(lines: string[]): string[] {
    return lines.map((line) => {
      if (!this.lineHasTag(line) || !line.match(TASK_LINE_REGEX)) {
        return line;
      }

      return line.replace(this.getTagReplaceRegex(), "");
    });
  }

  private addNextActionTag(lines: string[], targetLine: number): string {
    const nextLines = [...lines];
    const targetLineContent = nextLines[targetLine];
    if (!this.lineHasTag(targetLineContent)) {
      nextLines[targetLine] = `${targetLineContent} ${this.settings.nextActionTag}`;
    }

    return nextLines.join("\n");
  }

  private lineHasTag(line: string): boolean {
    return this.getTagPresenceRegex().test(line);
  }

  private getTagPresenceRegex(): RegExp {
    return new RegExp(`(^|\\s)${this.escapeRegExp(this.settings.nextActionTag)}(?=$|\\s)`);
  }

  private getTagReplaceRegex(): RegExp {
    return new RegExp(`\\s+${this.escapeRegExp(this.settings.nextActionTag)}(?=$|\\s)`, "g");
  }

  private normalizeTag(tag: string): string {
    const trimmedTag = tag.trim();
    if (!trimmedTag) {
      return DEFAULT_SETTINGS.nextActionTag;
    }

    return trimmedTag.startsWith("#") ? trimmedTag : `#${trimmedTag}`;
  }

  private normalizeStatusField(field: string): string {
    const trimmedField = field.trim();
    return trimmedField || DEFAULT_SETTINGS.statusField;
  }

  private normalizeFolder(folder: string): string {
    return folder.trim().replace(/^\/+|\/+$/g, "");
  }

  private isInProjectsFolder(file: TFile): boolean {
    return file.path === this.settings.projectsFolder || file.path.startsWith(`${this.settings.projectsFolder}/`);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async writeFileContent(file: TFile, content: string): Promise<void> {
    this.pendingPaths.add(file.path);

    try {
      await this.app.vault.modify(file, content);
      this.taskStateByPath.set(file.path, this.extractTaskState(content));
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

class TaskManagerSettingTab extends PluginSettingTab {
  private readonly plugin: TaskManagerPlugin;

  constructor(app: App, plugin: TaskManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.getSettings();
    containerEl.empty();

    new Setting(containerEl)
      .setName("Projects Folder")
      .setDesc("Folder scanned recursively by the Initialize command. Use Browse to pick a vault path.")
      .addText((text) => {
        this.configureFolderTextInput(text, settings.projectsFolder);
      })
      .addButton((button) => {
        button
          .setButtonText("Browse")
          .onClick(() => {
            new ProjectsFolderSuggestModal(this.app, async (folderPath) => {
              await this.plugin.updateSetting("projectsFolder", folderPath);
              this.display();
            }).open();
          });
      });

    new Setting(containerEl)
      .setName("Next action tag")
      .setDesc("Tag added to the active next task.")
      .addText((text) => {
        text
          .setPlaceholder("#next-action")
          .setValue(settings.nextActionTag)
          .onChange(async (value) => {
            await this.plugin.updateSetting("nextActionTag", value);
          });
      });

    new Setting(containerEl)
      .setName("Completed status field")
      .setDesc("Frontmatter field updated when the file has no remaining incomplete tasks.")
      .addText((text) => {
        text
          .setPlaceholder("status")
          .setValue(settings.statusField)
          .onChange(async (value) => {
            await this.plugin.updateSetting("statusField", value);
          });
      });
  }

  private configureFolderTextInput(text: TextComponent, folderPath: string): void {
    text
      .setPlaceholder("Projects")
      .setValue(folderPath)
      .onChange(async (value) => {
        await this.plugin.updateSetting("projectsFolder", value);
      });
  }
}

class ProjectsFolderSuggestModal extends FuzzySuggestModal<string> {
  private readonly onChoose: (folderPath: string) => Promise<void>;

  constructor(app: App, onChoose: (folderPath: string) => Promise<void>) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Select a folder");
  }

  getItems(): string[] {
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map((folder) => folder.path)
      .sort((left, right) => left.localeCompare(right));

    return ["", ...folders];
  }

  getItemText(folderPath: string): string {
    return folderPath || "/";
  }

  onChooseItem(folderPath: string): void {
    void this.onChoose(folderPath);
  }
}