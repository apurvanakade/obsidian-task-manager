const { Plugin, PluginSettingTab, Setting, TFile } = require("obsidian");

const TASK_LINE_REGEX = /^(\s*[-*+]\s+\[( |x|X)\]\s+)(.*)$/;
const DEFAULT_SETTINGS = {
  nextActionTag: "#next-action",
  statusField: "status"
};

module.exports = class TaskManagerPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.taskStateByPath = new Map();
    this.pendingPaths = new Set();
    this.settings = DEFAULT_SETTINGS;
  }

  async onload() {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.addSettingTab(new TaskManagerSettingTab(this.app, this));
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
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedData
    };
    this.settings.nextActionTag = this.normalizeTag(this.settings.nextActionTag);
    this.settings.statusField = this.normalizeStatusField(this.settings.statusField);
  }

  async saveSettings() {
    this.settings.nextActionTag = this.normalizeTag(this.settings.nextActionTag);
    this.settings.statusField = this.normalizeStatusField(this.settings.statusField);
    await this.saveData(this.settings);
    await this.primeTaskState();
  }

  async primeTaskState() {
    const markdownFiles = this.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      const content = await this.app.vault.cachedRead(file);
      this.taskStateByPath.set(file.path, this.extractTaskState(content));
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
    const nextState = this.extractTaskState(content);
    const previousState = this.taskStateByPath.get(file.path) || [];
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

  extractTaskState(content) {
    const lines = content.split(/\r?\n/);
    const taskState = [];

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

  findNewlyCompletedTask(previousState, nextState) {
    const previousByLine = new Map(previousState.map((task) => [task.line, task.completed]));

    for (const task of nextState) {
      const wasCompleted = previousByLine.get(task.line);
      if (wasCompleted === false && task.completed) {
        return task.line;
      }
    }

    return null;
  }

  findDeletedTaggedTask(previousState, nextState) {
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

  async applyCompletionRules(file, content, completedLine) {
    const lines = content.split(/\r?\n/);
    const nextTaskLine = this.findNextIncompleteTaskLine(lines, completedLine);
    const cleanedLines = this.stripNextActionTags(lines);
    let updatedContent = cleanedLines.join("\n");

    if (nextTaskLine !== null) {
      updatedContent = this.addNextActionTag(cleanedLines, nextTaskLine);
    }

    if (updatedContent !== content) {
      await this.writeFileContent(file, updatedContent);
      content = updatedContent;
    }

    if (nextTaskLine === null) {
      await this.setFileStatusCompleted(file);
      const refreshedContent = await this.app.vault.cachedRead(file);
      this.taskStateByPath.set(file.path, this.extractTaskState(refreshedContent));
    }
  }

  async applyDeletedTagRules(file, content, deletedTaggedTaskLine) {
    const lines = content.split(/\r?\n/);
    const cleanedLines = this.stripNextActionTags(lines);
    const previousTaskLine = this.findPreviousIncompleteTaskLine(cleanedLines, deletedTaggedTaskLine);

    if (previousTaskLine === null) {
      return;
    }

    const updatedContent = this.addNextActionTag(cleanedLines, previousTaskLine);
    if (updatedContent !== content) {
      await this.writeFileContent(file, updatedContent);
    }
  }

  findNextIncompleteTaskLine(lines, completedLine) {
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

  findPreviousIncompleteTaskLine(lines, referenceLine) {
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

  findFirstIncompleteTaskLine(lines) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(TASK_LINE_REGEX);
      if (match && match[2] === " ") {
        return index;
      }
    }

    return null;
  }

  stripNextActionTags(lines) {
    return lines.map((line) => {
      if (!this.lineHasTag(line) || !line.match(TASK_LINE_REGEX)) {
        return line;
      }

      return line.replace(this.getTagReplaceRegex(), "");
    });
  }

  addNextActionTag(lines, targetLine) {
    const nextLines = [...lines];
    const targetLineContent = nextLines[targetLine];
    if (!this.lineHasTag(targetLineContent)) {
      nextLines[targetLine] = `${targetLineContent} ${this.settings.nextActionTag}`;
    }

    return nextLines.join("\n");
  }

  lineHasTag(line) {
    return this.getTagPresenceRegex().test(line);
  }

  getTagPresenceRegex() {
    return new RegExp(`(^|\\s)${this.escapeRegExp(this.settings.nextActionTag)}(?=$|\\s)`);
  }

  getTagReplaceRegex() {
    return new RegExp(`\\s+${this.escapeRegExp(this.settings.nextActionTag)}(?=$|\\s)`, "g");
  }

  normalizeTag(tag) {
    const trimmedTag = tag.trim();
    if (!trimmedTag) {
      return DEFAULT_SETTINGS.nextActionTag;
    }

    return trimmedTag.startsWith("#") ? trimmedTag : `#${trimmedTag}`;
  }

  normalizeStatusField(field) {
    const trimmedField = field.trim();
    return trimmedField || DEFAULT_SETTINGS.statusField;
  }

  escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async writeFileContent(file, content) {
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

  async setFileStatusCompleted(file) {
    this.pendingPaths.add(file.path);

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[this.settings.statusField] = "completed";
      });
    } finally {
      window.setTimeout(() => {
        this.pendingPaths.delete(file.path);
      }, 0);
    }
  }
};

class TaskManagerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Next action tag")
      .setDesc("Tag added to the active next task.")
      .addText((text) => {
        text
          .setPlaceholder("#next-action")
          .setValue(this.plugin.settings.nextActionTag)
          .onChange(async (value) => {
            this.plugin.settings.nextActionTag = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Completed status field")
      .setDesc("Frontmatter field updated when the file has no later incomplete tasks.")
      .addText((text) => {
        text
          .setPlaceholder("status")
          .setValue(this.plugin.settings.statusField)
          .onChange(async (value) => {
            this.plugin.settings.statusField = value;
            await this.plugin.saveSettings();
          });
      });
  }
}