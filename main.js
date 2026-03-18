const { FuzzySuggestModal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } = require("obsidian");

const DEFAULT_SETTINGS = {
  nextActionTag: "#next-action",
  statusField: "status",
  projectsFolder: ""
};

const TASK_LINE_REGEX = /^(\s*[-*+]\s+\[( |x|X)\]\s+)(.*)$/;

function normalizeSettings(rawSettings) {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    nextActionTag: normalizeTag(rawSettings?.nextActionTag),
    statusField: normalizeStatusField(rawSettings?.statusField),
    projectsFolder: normalizeFolder(rawSettings?.projectsFolder)
  };
}

function normalizeTag(tag) {
  const trimmedTag = String(tag || "").trim();
  if (!trimmedTag) {
    return DEFAULT_SETTINGS.nextActionTag;
  }

  return trimmedTag.startsWith("#") ? trimmedTag : `#${trimmedTag}`;
}

function normalizeStatusField(field) {
  const trimmedField = String(field || "").trim();
  return trimmedField || DEFAULT_SETTINGS.statusField;
}

function normalizeFolder(folder) {
  return String(folder || "").trim().replace(/^\/+|\/+$/g, "");
}

function extractTaskState(content, nextActionTag) {
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
      hasNextAction: lineHasTag(lines[index], nextActionTag)
    });
  }

  return taskState;
}

function findNewlyCompletedTask(previousState, nextState) {
  const previousByLine = new Map(previousState.map((task) => [task.line, task.completed]));

  for (const task of nextState) {
    const wasCompleted = previousByLine.get(task.line);
    if (wasCompleted === false && task.completed) {
      return task.line;
    }
  }

  return null;
}

function findNewlyUncompletedTask(previousState, nextState) {
  const previousByLine = new Map(previousState.map((task) => [task.line, task.completed]));

  for (const task of nextState) {
    const wasCompleted = previousByLine.get(task.line);
    if (wasCompleted === true && !task.completed) {
      return task.line;
    }
  }

  return null;
}

function findDeletedTaggedTask(previousState, nextState) {
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

function findNextIncompleteTaskLine(lines, completedLine) {
  for (let index = completedLine + 1; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match?.[2] === " ") {
      return index;
    }
  }

  return null;
}

function findPreviousIncompleteTaskLine(lines, referenceLine) {
  for (let index = Math.min(referenceLine - 1, lines.length - 1); index >= 0; index -= 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match?.[2] === " ") {
      return index;
    }
  }

  return findFirstIncompleteTaskLine(lines);
}

function findFirstIncompleteTaskLine(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match?.[2] === " ") {
      return index;
    }
  }

  return null;
}

function stripNextActionTags(lines, nextActionTag) {
  return lines.map((line) => {
    if (!lineHasTag(line, nextActionTag) || !line.match(TASK_LINE_REGEX)) {
      return line;
    }

    return line.replace(getTagReplaceRegex(nextActionTag), "");
  });
}

function addNextActionTag(lines, targetLine, nextActionTag) {
  const nextLines = [...lines];
  const targetLineContent = nextLines[targetLine];
  if (!lineHasTag(targetLineContent, nextActionTag)) {
    nextLines[targetLine] = `${targetLineContent} ${nextActionTag}`;
  }

  return nextLines.join("\n");
}

function lineHasTag(line, nextActionTag) {
  return getTagPresenceRegex(nextActionTag).test(line);
}

function getTagPresenceRegex(nextActionTag) {
  return new RegExp(`(^|\\s)${escapeRegExp(nextActionTag)}(?=$|\\s)`);
}

function getTagReplaceRegex(nextActionTag) {
  return new RegExp(`\\s+${escapeRegExp(nextActionTag)}(?=$|\\s)`, "g");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isInProjectsFolder(filePath, projectsFolder) {
  return filePath === projectsFolder || filePath.startsWith(`${projectsFolder}/`);
}

function getCompletionDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCompletionTimeString() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const mins = String(now.getMinutes()).padStart(2, "0");
  const secs = String(now.getSeconds()).padStart(2, "0");
  return `${hours}:${mins}:${secs}`;
}

function addCompletionFields(line) {
  const cleaned = stripCompletionFields(line);
  return `${cleaned} [completion:: ${getCompletionDateString()}] [completition-time:: ${getCompletionTimeString()}]`;
}

function stripCompletionFields(line) {
  return line
    .replace(/\s*\[completion::[^\]]*\]/g, "")
    .replace(/\s*\[completition-time::[^\]]*\]/g, "");
}

// Updates or inserts a YAML frontmatter field directly in a markdown string,
// avoiding a separate processFrontMatter round-trip.
function setFrontMatterField(content, field, value) {
  const fieldPattern = new RegExp(`^(${escapeRegExp(field)}):.*$`, "m");
  const fmBlockRegex = /^---\n([\s\S]*?)\n---(?:\n|$)/;

  if (fmBlockRegex.test(content)) {
    if (fieldPattern.test(content)) {
      return content.replace(fieldPattern, `${field}: ${value}`);
    }
    // Frontmatter block exists but this field is not in it — insert it.
    return content.replace(/^---\n/, `---\n${field}: ${value}\n`);
  }

  // No frontmatter at all — prepend a new block.
  return `---\n${field}: ${value}\n---\n${content}`;
}

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
    // Read all files in parallel instead of sequentially.
    await Promise.all(markdownFiles.map(async (file) => {
      const content = await this.app.vault.cachedRead(file);
      this.taskStateByPath.set(file.path, extractTaskState(content, this.settings.nextActionTag));
    }));
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

    const uncompleted = findNewlyUncompletedTask(previousState, nextState);
    if (uncompleted !== null) {
      await this.applyUncompletionRules(file, content, uncompleted);
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

    const files = this.app.vault.getMarkdownFiles().filter((file) => isInProjectsFolder(file.path, projectsFolder));
    for (const file of files) {
      await this.reconcileFile(file);
    }

    new Notice(`Initialized ${files.length} project file${files.length === 1 ? "" : "s"}.`);
  }

  async applyCompletionRules(file, content, completedLine) {
    const lines = content.split(/\r?\n/);
    const nextTaskLine = findNextIncompleteTaskLine(lines, completedLine);
    const cleanedLines = stripNextActionTags(lines, this.settings.nextActionTag);
    // Stamp completion date and time onto the completed task line.
    cleanedLines[completedLine] = addCompletionFields(cleanedLines[completedLine]);
    const newStatus = nextTaskLine === null ? "completed" : "todo";

    let updatedContent = nextTaskLine !== null
      ? addNextActionTag(cleanedLines, nextTaskLine, this.settings.nextActionTag)
      : cleanedLines.join("\n");
    updatedContent = setFrontMatterField(updatedContent, this.settings.statusField, newStatus);

    if (updatedContent !== content) {
      await this.writeFileContent(file, updatedContent);
    }
  }

  async applyUncompletionRules(file, content, uncompletedLine) {
    const lines = content.split(/\r?\n/);
    const firstIncompleteTaskLine = findFirstIncompleteTaskLine(lines);
    // Always strip completion fields from the reopened task.
    lines[uncompletedLine] = stripCompletionFields(lines[uncompletedLine]);

    if (firstIncompleteTaskLine !== uncompletedLine) {
      // Not the first open task — only strip completion fields, no tag or status change.
      const updatedContent = lines.join("\n");
      if (updatedContent !== content) {
        await this.writeFileContent(file, updatedContent);
      }
      return;
    }

    const cleanedLines = stripNextActionTags(lines, this.settings.nextActionTag);
    let updatedContent = addNextActionTag(cleanedLines, uncompletedLine, this.settings.nextActionTag);
    updatedContent = setFrontMatterField(updatedContent, this.settings.statusField, "todo");

    if (updatedContent !== content) {
      await this.writeFileContent(file, updatedContent);
    }
  }

  async applyDeletedTagRules(file, content, deletedTaggedTaskLine) {
    const lines = content.split(/\r?\n/);
    const cleanedLines = stripNextActionTags(lines, this.settings.nextActionTag);
    const previousTaskLine = findPreviousIncompleteTaskLine(cleanedLines, deletedTaggedTaskLine);

    let updatedContent;
    if (previousTaskLine === null) {
      updatedContent = setFrontMatterField(cleanedLines.join("\n"), this.settings.statusField, "completed");
    } else {
      updatedContent = addNextActionTag(cleanedLines, previousTaskLine, this.settings.nextActionTag);
      updatedContent = setFrontMatterField(updatedContent, this.settings.statusField, "todo");
    }

    if (updatedContent !== content) {
      await this.writeFileContent(file, updatedContent);
    }
  }

  async reconcileFile(file) {
    const content = await this.app.vault.cachedRead(file);
    const lines = content.split(/\r?\n/);
    const cleanedLines = stripNextActionTags(lines, this.settings.nextActionTag);
    const firstIncompleteTaskLine = findFirstIncompleteTaskLine(cleanedLines);

    let updatedContent;
    if (firstIncompleteTaskLine !== null) {
      updatedContent = addNextActionTag(cleanedLines, firstIncompleteTaskLine, this.settings.nextActionTag);
      updatedContent = setFrontMatterField(updatedContent, this.settings.statusField, "todo");
    } else {
      updatedContent = setFrontMatterField(cleanedLines.join("\n"), this.settings.statusField, "completed");
    }

    if (updatedContent !== content) {
      await this.writeFileContent(file, updatedContent);
    }
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

class TaskManagerSettingTab {
  constructor(baseSettingTab, plugin) {
    this.baseSettingTab = baseSettingTab;
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this.baseSettingTab;
    const settings = this.plugin.getSettings();
    containerEl.empty();

    new Setting(containerEl)
      .setName("Projects Folder")
      .setDesc("Folder scanned recursively by the Initialize command. Use Browse to pick a vault path.")
      .addText((text) => {
        text
          .setPlaceholder("Projects")
          .setValue(settings.projectsFolder)
          .onChange(async (value) => {
            await this.plugin.updateSetting("projectsFolder", value);
          });
      })
      .addButton((button) => {
        button
          .setButtonText("Browse")
          .onClick(() => {
            this.openFolderPicker(async (folderPath) => {
              await this.plugin.updateSetting("projectsFolder", folderPath);
              this.display();
            });
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

  openFolderPicker(onChoose) {
    if (typeof FuzzySuggestModal !== "function") {
      new Notice("Folder picker is not available in this Obsidian version.");
      return;
    }

    const app = this.baseSettingTab.app;
    class ProjectsFolderSuggestModal extends FuzzySuggestModal {
      constructor() {
        super(app);
        this.setPlaceholder("Select a folder");
      }

      getItems() {
        const folders = this.app.vault.getAllLoadedFiles()
          .filter((file) => file instanceof TFolder)
          .map((folder) => folder.path)
          .sort((left, right) => left.localeCompare(right));

        return ["", ...folders];
      }

      getItemText(folderPath) {
        return folderPath || "/";
      }

      onChooseItem(folderPath) {
        void onChoose(folderPath);
      }
    }

    new ProjectsFolderSuggestModal().open();
  }
}