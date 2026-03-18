const { Notice, Plugin, PluginSettingTab, TFile } = require("obsidian");
const { normalizeSettings } = require("./runtime/settings-utils");
const {
  extractTaskState,
  findNewlyCompletedTask,
  findDeletedTaggedTask
} = require("./runtime/task-utils");
const {
  applyCompletionRules,
  applyDeletedTagRules,
  initializeProjectsFolder,
  reconcileFile
} = require("./runtime/reconciler");
const { TaskManagerSettingTab } = require("./runtime/settings-ui");

module.exports = class TaskManagerPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.taskStateByPath = new Map();
    // Prevent re-processing of writes triggered by this plugin itself.
    this.pendingPaths = new Set();
    this.settings = normalizeSettings({});
  }

  async onload() {
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

  onunload() {
    this.taskStateByPath.clear();
    this.pendingPaths.clear();
    console.log("Unloading Task Manager plugin");
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = normalizeSettings(loadedData || {});
  }

  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    await this.primeTaskState();
  }

  getSettings() {
    return { ...this.settings };
  }

  async updateSetting(key, value) {
    this.settings[key] = value;
    await this.saveSettings();
  }

  async primeTaskState() {
    const markdownFiles = this.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      const content = await this.app.vault.cachedRead(file);
      this.taskStateByPath.set(file.path, extractTaskState(content, this.settings.nextActionTag));
    }
  }

  async handleFileModify(file) {
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    if (this.pendingPaths.has(file.path)) {
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const nextState = extractTaskState(content, this.settings.nextActionTag);
    const previousState = this.taskStateByPath.get(file.path) || [];
    const completion = findNewlyCompletedTask(previousState, nextState);
    const deletedTaggedTaskLine = findDeletedTaggedTask(previousState, nextState);

    this.taskStateByPath.set(file.path, nextState);

    if (completion !== null) {
      await this.applyCompletionRules(file, content, completion);
      return;
    }

    if (deletedTaggedTaskLine !== null) {
      await this.applyDeletedTagRules(file, content, deletedTaggedTaskLine);
    }
  }

  async initializeProjectsFolder() {
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
          },
          extractTaskState
        });
      }
    });

    new Notice(`Initialized ${count} project file${count === 1 ? "" : "s"}.`);
  }

  async applyCompletionRules(file, content, completedLine) {
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
      },
      extractTaskState
    });
  }

  async applyDeletedTagRules(file, content, deletedTaggedTaskLine) {
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
      },
      extractTaskState
    });
  }

  async writeFileContent(file, content) {
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

  async setFileStatus(file, status) {
    this.pendingPaths.add(file.path);

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[this.settings.statusField] = status;
      });
    } finally {
      window.setTimeout(() => {
        this.pendingPaths.delete(file.path);
      }, 0);
    }
  }
};

class BaseTaskManagerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.settingsTab = new TaskManagerSettingTab(this, plugin);
  }

  display() {
    this.settingsTab.display();
  }
}