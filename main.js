"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TaskManagerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/settings-utils.ts
var DEFAULT_SETTINGS = {
  nextActionTag: "#next-action",
  statusField: "status",
  projectsFolder: ""
};
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
function normalizeSettings(rawSettings) {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    nextActionTag: normalizeTag(rawSettings.nextActionTag),
    statusField: normalizeStatusField(rawSettings.statusField),
    projectsFolder: normalizeFolder(rawSettings.projectsFolder)
  };
}

// src/task-utils.ts
var TASK_LINE_REGEX = /^(\s*[-*+]\s+\[( |x|X)\]\s+)(.*)$/;
function extractTaskState(content, nextActionTag) {
  const lines = content.split(/\r?\n/);
  const taskState = [];
  function getTaskStatus(checkboxChar) {
    const char = checkboxChar.toLowerCase();
    if (char === "x") return "completed";
    return "open";
  }
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (!match) {
      continue;
    }
    taskState.push({
      line: index,
      status: getTaskStatus(match[2]),
      hasNextAction: lineHasTag(lines[index], nextActionTag)
    });
  }
  return taskState;
}
function findNewlyCompletedTask(previousState, nextState) {
  const previousByLine = new Map(previousState.map((task) => [task.line, task.status]));
  for (const task of nextState) {
    const wasStatus = previousByLine.get(task.line);
    if (wasStatus === "open" && task.status === "completed") {
      return task.line;
    }
  }
  return null;
}
function findNewlyUncompletedTask(previousState, nextState) {
  const previousByLine = new Map(previousState.map((task) => [task.line, task.status]));
  for (const task of nextState) {
    const wasStatus = previousByLine.get(task.line);
    if (wasStatus === "completed" && task.status === "open") {
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
function findPreviousIncompleteTaskLine(lines, referenceLine) {
  for (let index = Math.min(referenceLine - 1, lines.length - 1); index >= 0; index -= 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match && match[2].toLowerCase() !== "x") {
      return index;
    }
  }
  return findFirstIncompleteTaskLine(lines);
}
function findFirstIncompleteTaskLine(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match && match[2].toLowerCase() !== "x") {
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

// src/settings-ui.ts
var import_obsidian = require("obsidian");
var TaskManagerSettingTabRenderer = class {
  constructor(baseSettingTab, plugin) {
    this.baseSettingTab = baseSettingTab;
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this.baseSettingTab;
    const settings = this.plugin.getSettings();
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Projects Folder").setDesc("Folder scanned recursively by the Process tasks command. Use Browse to pick a vault path.").addText((text) => {
      this.configureFolderTextInput(text, settings.projectsFolder);
    }).addButton((button) => {
      button.setButtonText("Browse").onClick(() => {
        openFolderPicker(this.baseSettingTab.app, async (folderPath) => {
          await this.plugin.updateSetting("projectsFolder", folderPath);
          this.display();
        });
      });
    });
    new import_obsidian.Setting(containerEl).setName("Next action tag").setDesc("Tag added to the active next task.").addText((text) => {
      text.setPlaceholder("#next-action").setValue(settings.nextActionTag).onChange(async (value) => {
        await this.plugin.updateSetting("nextActionTag", value);
      });
    });
    new import_obsidian.Setting(containerEl).setName("Completed status field").setDesc("Frontmatter field updated when the file has no remaining incomplete tasks.").addText((text) => {
      text.setPlaceholder("status").setValue(settings.statusField).onChange(async (value) => {
        await this.plugin.updateSetting("statusField", value);
      });
    });
  }
  configureFolderTextInput(text, folderPath) {
    text.setPlaceholder("Projects").setValue(folderPath).onChange(async (value) => {
      await this.plugin.updateSetting("projectsFolder", value);
    });
  }
};
function openFolderPicker(app, onChoose) {
  if (typeof import_obsidian.FuzzySuggestModal !== "function") {
    new import_obsidian.Notice("Folder picker is not available in this Obsidian version.");
    return;
  }
  class ProjectsFolderSuggestModal extends import_obsidian.FuzzySuggestModal {
    constructor() {
      super(app);
      this.setPlaceholder("Select a folder");
    }
    getItems() {
      const folders = this.app.vault.getAllLoadedFiles().filter((file) => file instanceof import_obsidian.TFolder).map((folder) => folder.path).sort((left, right) => left.localeCompare(right));
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

// src/reconciler.ts
function isInProjectsFolder(filePath, projectsFolder) {
  return filePath === projectsFolder || filePath.startsWith(`${projectsFolder}/`);
}
async function applyCompletionRules(context) {
  const { file, content, completedLine, settings, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  const nextLines = [...lines];
  const sourceTaskLine = lines[completedLine];
  let completedLineIndex = completedLine;
  const repeatRule = getRepeatRule(sourceTaskLine);
  if (repeatRule !== null) {
    const repeatedTaskLine = buildRepeatedTaskLine(sourceTaskLine, repeatRule);
    if (repeatedTaskLine !== null) {
      nextLines.splice(completedLine, 0, repeatedTaskLine);
      completedLineIndex += 1;
    }
  }
  nextLines[completedLineIndex] = addCompletionFields(nextLines[completedLineIndex]);
  const cleanedLines = stripNextActionTags(nextLines, settings.nextActionTag);
  const nextTaskLine = findFirstIncompleteTaskLine(cleanedLines);
  const newStatus = nextTaskLine === null ? "completed" : "todo";
  let updatedContent = cleanedLines.join("\n");
  if (nextTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, nextTaskLine, settings.nextActionTag);
  }
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }
  await setFileStatus(file, newStatus);
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
}
async function applyUncompletionRules(context) {
  const { file, content, uncompletedLine, settings, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  lines[uncompletedLine] = stripCompletionFields(lines[uncompletedLine]);
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(lines);
  if (firstIncompleteTaskLine !== uncompletedLine) {
    const updatedContent2 = lines.join("\n");
    if (updatedContent2 !== content) {
      await writeFileContent(file, updatedContent2);
    }
    await setFileStatus(file, "todo");
    setTaskState(file.path, extractTaskState(updatedContent2, settings.nextActionTag));
    return;
  }
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const updatedContent = addNextActionTag(cleanedLines, uncompletedLine, settings.nextActionTag);
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }
  await setFileStatus(file, "todo");
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
}
async function applyDeletedTagRules(context) {
  const { file, content, deletedTaggedTaskLine, settings, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const previousTaskLine = findPreviousIncompleteTaskLine(cleanedLines, deletedTaggedTaskLine);
  if (previousTaskLine === null) {
    await setFileStatus(file, "completed");
    setTaskState(file.path, extractTaskState(content, settings.nextActionTag));
    return;
  }
  const updatedContent = addNextActionTag(cleanedLines, previousTaskLine, settings.nextActionTag);
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }
  await setFileStatus(file, "todo");
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
}
async function reconcileFile(context) {
  const { file, settings, readFile, writeFileContent, setFileStatus, setTaskState } = context;
  const content = await readFile(file);
  const lines = content.split(/\r?\n/);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(cleanedLines);
  let updatedContent = cleanedLines.join("\n");
  let nextStatus = "completed";
  if (firstIncompleteTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, firstIncompleteTaskLine, settings.nextActionTag);
    nextStatus = "todo";
  }
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }
  await setFileStatus(file, nextStatus);
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
}
async function processProjectsFolder(context) {
  const files = context.getMarkdownFiles().filter((file) => isInProjectsFolder(file.path, context.settings.projectsFolder));
  for (const file of files) {
    await context.reconcileOneFile(file);
  }
  return files.length;
}
function getCompletionDateString() {
  return formatDate(/* @__PURE__ */ new Date());
}
function getCompletionTimeString() {
  const now = /* @__PURE__ */ new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const mins = String(now.getMinutes()).padStart(2, "0");
  const secs = String(now.getSeconds()).padStart(2, "0");
  return `${hours}:${mins}:${secs}`;
}
function addCompletionFields(line) {
  const cleaned = stripCompletionFields(line);
  return `${cleaned} [completion-date:: ${getCompletionDateString()}] [completion-time:: ${getCompletionTimeString()}]`;
}
function stripCompletionFields(line) {
  return line.replace(/\s*\[completion-date::[^\]]*\]/g, "").replace(/\s*\[completion-time::[^\]]*\]/g, "");
}
function getRepeatRule(line) {
  const match = line.match(/\[(?:repeat|repeats)::\s*every\s+(day|week|month|year)\s*\]/i);
  return match ? match[1].toLowerCase() : null;
}
function buildRepeatedTaskLine(completedLine, repeatRule) {
  const cleaned = stripCompletionFields(completedLine);
  if (!cleaned.match(/^(\s*[-*+]\s+\[)[^\]](\]\s*)/)) {
    return null;
  }
  const openTask = cleaned.replace(/^(\s*[-*+]\s+\[)[^\]](\]\s*)/, "$1 $2");
  const taskBodyWithoutDue = openTask.replace(/\s*\[due::\s*[^\]]*\]/g, "").trimEnd();
  const dueDate = getRepeatDueDate(repeatRule);
  return `${taskBodyWithoutDue} [due:: ${dueDate}]`;
}
function getRepeatDueDate(repeatRule) {
  const now = /* @__PURE__ */ new Date();
  switch (repeatRule) {
    case "day":
      return formatDate(addDays(now, 1));
    case "week":
      return formatDate(addDays(now, 7));
    case "month":
      return formatDate(addMonthsClamped(now, 1));
    case "year":
      return formatDate(addMonthsClamped(now, 12));
    default:
      return formatDate(now);
  }
}
function addDays(baseDate, days) {
  const nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}
function addMonthsClamped(baseDate, monthsToAdd) {
  const startYear = baseDate.getFullYear();
  const startMonth = baseDate.getMonth();
  const targetMonthIndex = startMonth + monthsToAdd;
  const targetYear = startYear + Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12 + 12) % 12;
  const day = baseDate.getDate();
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return new Date(targetYear, targetMonth, clampedDay);
}
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// main.ts
var TaskManagerPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.taskStateByPath = /* @__PURE__ */ new Map();
    // Prevent re-processing of writes triggered by this plugin itself.
    this.pendingPaths = /* @__PURE__ */ new Set();
    this.settings = normalizeSettings({});
  }
  async onload() {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.addSettingTab(new BaseTaskManagerSettingTab(this.app, this));
    this.addCommand({
      id: "process-tasks",
      name: "Process tasks",
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
  onunload() {
    this.taskStateByPath.clear();
    this.pendingPaths.clear();
    console.log("Unloading Task Manager plugin");
  }
  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = normalizeSettings(loadedData != null ? loadedData : {});
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
    var _a;
    if (file.extension !== "md" || this.pendingPaths.has(file.path)) {
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    const nextState = extractTaskState(content, this.settings.nextActionTag);
    const previousState = (_a = this.taskStateByPath.get(file.path)) != null ? _a : [];
    const completion = findNewlyCompletedTask(previousState, nextState);
    const uncompleted = findNewlyUncompletedTask(previousState, nextState);
    const deletedTaggedTaskLine = findDeletedTaggedTask(previousState, nextState);
    this.taskStateByPath.set(file.path, nextState);
    if (completion !== null) {
      await this.applyCompletionRules(file, content, completion);
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
  async processCurrentFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian2.Notice("No active file.");
      return;
    }
    await this.reconcileSingleFile(file);
    new import_obsidian2.Notice(`Processed ${file.name}.`);
  }
  async processTasks() {
    const projectsFolder = this.settings.projectsFolder;
    if (!projectsFolder) {
      new import_obsidian2.Notice("Set Projects Folder in Task Manager settings first.");
      return;
    }
    const count = await processProjectsFolder({
      settings: this.settings,
      getMarkdownFiles: () => this.app.vault.getMarkdownFiles(),
      reconcileOneFile: async (file) => {
        await this.reconcileSingleFile(file);
      }
    });
    new import_obsidian2.Notice(`Processed ${count} project file${count === 1 ? "" : "s"}.`);
  }
  async reconcileSingleFile(file) {
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
      }
    });
  }
  async applyUncompletionRules(file, content, uncompletedLine) {
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
      }
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
var BaseTaskManagerSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.renderer = new TaskManagerSettingTabRenderer(this, plugin);
  }
  display() {
    this.renderer.display();
  }
};
