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
  projectsFolder: "",
  completedProjectsFolder: "",
  waitingProjectsFolder: "",
  scheduledProjectsFolder: "",
  somedayMaybeProjectsFolder: ""
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
    projectsFolder: normalizeFolder(rawSettings.projectsFolder),
    completedProjectsFolder: normalizeFolder(rawSettings.completedProjectsFolder),
    waitingProjectsFolder: normalizeFolder(rawSettings.waitingProjectsFolder),
    scheduledProjectsFolder: normalizeFolder(rawSettings.scheduledProjectsFolder),
    somedayMaybeProjectsFolder: normalizeFolder(rawSettings.somedayMaybeProjectsFolder)
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
    this.addFolderSetting(
      containerEl,
      "Projects Folder",
      "Folder scanned recursively by the Process Tasks command.",
      "projectsFolder",
      settings.projectsFolder,
      "Projects"
    );
    this.addFolderSetting(
      containerEl,
      "Completed Projects Folder",
      "Destination folder for completed projects.",
      "completedProjectsFolder",
      settings.completedProjectsFolder,
      "Projects/Completed"
    );
    this.addFolderSetting(
      containerEl,
      "Waiting Projects Folder",
      "Destination folder for waiting projects.",
      "waitingProjectsFolder",
      settings.waitingProjectsFolder,
      "Projects/Waiting"
    );
    this.addFolderSetting(
      containerEl,
      "Scheduled Projects Folder",
      "Destination folder for scheduled projects.",
      "scheduledProjectsFolder",
      settings.scheduledProjectsFolder,
      "Projects/Scheduled"
    );
    this.addFolderSetting(
      containerEl,
      "Someday-Maybe Projects Folder",
      "Destination folder for someday-maybe projects.",
      "somedayMaybeProjectsFolder",
      settings.somedayMaybeProjectsFolder,
      "Projects/Someday-Maybe"
    );
    new import_obsidian.Setting(containerEl).setName("Next Action Tag").setDesc("Tag added to the active next task.").addText((text) => {
      text.setPlaceholder("#next-action").setValue(settings.nextActionTag).onChange(async (value) => {
        await this.plugin.updateSetting("nextActionTag", value);
      });
    });
    new import_obsidian.Setting(containerEl).setName("Completed Status Field").setDesc("Frontmatter field updated when the file has no remaining incomplete tasks.").addText((text) => {
      text.setPlaceholder("status").setValue(settings.statusField).onChange(async (value) => {
        await this.plugin.updateSetting("statusField", value);
      });
    });
  }
  addFolderSetting(containerEl, name, description, settingKey, folderPath, placeholder) {
    new import_obsidian.Setting(containerEl).setName(name).setDesc(`${description} Use Browse to pick a vault path.`).addText((text) => {
      this.configureFolderTextInput(text, settingKey, folderPath, placeholder);
    }).addButton((button) => {
      button.setButtonText("Browse").onClick(() => {
        openFolderPicker(this.baseSettingTab.app, async (selectedFolderPath) => {
          await this.plugin.updateSetting(settingKey, selectedFolderPath);
          this.display();
        });
      });
    });
  }
  configureFolderTextInput(text, settingKey, folderPath, placeholder) {
    text.setPlaceholder(placeholder).setValue(folderPath).onChange(async (value) => {
      await this.plugin.updateSetting(settingKey, value);
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
  const currentStatus = readFrontmatterStatus(content, settings.statusField);
  const lines = content.split(/\r?\n/);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(cleanedLines);
  let updatedContent = cleanedLines.join("\n");
  let nextStatus = "completed";
  if (firstIncompleteTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, firstIncompleteTaskLine, settings.nextActionTag);
    nextStatus = currentStatus !== null && currentStatus !== "completed" ? null : "todo";
  }
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }
  if (nextStatus !== null) {
    await setFileStatus(file, nextStatus);
  }
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
}
async function processProjectsFolder(context) {
  const { settings } = context;
  const activeFolders = [
    settings.projectsFolder,
    settings.completedProjectsFolder,
    settings.waitingProjectsFolder,
    settings.scheduledProjectsFolder,
    settings.somedayMaybeProjectsFolder
  ].filter(Boolean);
  const files = context.getMarkdownFiles().filter(
    (file) => activeFolders.some((folder) => isInProjectsFolder(file.path, folder))
  );
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
function readFrontmatterStatus(content, statusField) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return null;
  }
  const lines = frontmatterMatch[1].split(/\r?\n/);
  const fieldRegex = new RegExp(`^\\s*${escapeRegExp2(statusField)}\\s*:\\s*(.*?)\\s*$`, "i");
  for (const line of lines) {
    const match = line.match(fieldRegex);
    if (!match) {
      continue;
    }
    return match[1].replace(/^['\"]|['\"]$/g, "").trim().toLowerCase();
  }
  return null;
}
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// main.ts
var _TaskManagerPlugin = class _TaskManagerPlugin extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.taskStateByPath = /* @__PURE__ */ new Map();
    this.statusByPath = /* @__PURE__ */ new Map();
    this.dateDashboardRefreshHandle = null;
    // Prevent re-processing of writes triggered by this plugin itself.
    this.pendingPaths = /* @__PURE__ */ new Set();
    this.settings = normalizeSettings({});
  }
  isRoutableStatus(value) {
    return _TaskManagerPlugin.ROUTABLE_STATUSES.includes(value);
  }
  async onload() {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.registerView(_TaskManagerPlugin.DATE_DASHBOARD_VIEW_TYPE, (leaf) => new DateDashboardView(leaf, this));
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
      void this.handleFileModify(file).finally(() => {
        this.queueDateDashboardRefresh();
      });
    }));
    this.registerEvent(this.app.vault.on("rename", () => {
      this.queueDateDashboardRefresh();
    }));
    this.registerEvent(this.app.vault.on("delete", () => {
      this.queueDateDashboardRefresh();
    }));
    this.registerEvent(this.app.workspace.on("file-open", () => {
      this.queueDateDashboardRefresh();
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.queueDateDashboardRefresh();
    }));
    await this.primeTaskState();
    this.removeLegacyDateDashboardElements();
    await this.ensureDateDashboardView();
    await this.refreshDateDashboardView();
  }
  onunload() {
    this.taskStateByPath.clear();
    this.statusByPath.clear();
    this.pendingPaths.clear();
    if (this.dateDashboardRefreshHandle !== null) {
      window.clearTimeout(this.dateDashboardRefreshHandle);
      this.dateDashboardRefreshHandle = null;
    }
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
    this.statusByPath.clear();
    for (const file of markdownFiles) {
      const content = await this.app.vault.cachedRead(file);
      this.taskStateByPath.set(file.path, extractTaskState(content, this.settings.nextActionTag));
      this.statusByPath.set(file.path, this.readStatusValue(content));
    }
  }
  async handleFileModify(file) {
    var _a, _b;
    if (file.extension !== "md" || this.pendingPaths.has(file.path)) {
      return;
    }
    const content = await this.app.vault.cachedRead(file);
    const nextState = extractTaskState(content, this.settings.nextActionTag);
    const previousState = (_a = this.taskStateByPath.get(file.path)) != null ? _a : [];
    const previousStatus = (_b = this.statusByPath.get(file.path)) != null ? _b : null;
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
  async processCurrentFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian2.Notice("No active file.");
      return;
    }
    try {
      const result = await this.processAndRouteFile(file);
      new import_obsidian2.Notice(result);
    } catch (error) {
      new import_obsidian2.Notice(error instanceof Error ? error.message : "Failed to process file.");
    }
  }
  async processTasks() {
    const { projectsFolder, completedProjectsFolder, waitingProjectsFolder, scheduledProjectsFolder, somedayMaybeProjectsFolder } = this.settings;
    const hasAnyFolder = [projectsFolder, completedProjectsFolder, waitingProjectsFolder, scheduledProjectsFolder, somedayMaybeProjectsFolder].some(Boolean);
    if (!hasAnyFolder) {
      new import_obsidian2.Notice("Set at least one task folder in Task Manager settings first.");
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
      new import_obsidian2.Notice(`Processed ${count} project file${count === 1 ? "" : "s"}.`);
    } catch (error) {
      new import_obsidian2.Notice(error instanceof Error ? error.message : "Failed to process tasks.");
    }
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
  async processAndRouteFile(file) {
    const initialContent = await this.app.vault.cachedRead(file);
    const initialStatus = this.readStatusValue(initialContent);
    const hasOpenTasks = extractTaskState(initialContent, this.settings.nextActionTag).some((task) => task.status === "open");
    const predictedStatus = this.predictFinalStatus(initialStatus, hasOpenTasks);
    this.assertConfiguredDestinationForStatus(predictedStatus);
    await this.reconcileSingleFile(file);
    const moveResult = await this.routeFileByStatus(file);
    return moveResult != null ? moveResult : `Processed ${file.name}.`;
  }
  async routeAfterStatusChange(file, previousStatus) {
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
      new import_obsidian2.Notice(error instanceof Error ? error.message : "Failed to route file after status change.");
    }
  }
  async routeFileByStatus(file, statusOverride) {
    const status = statusOverride != null ? statusOverride : this.readStatusValue(await this.app.vault.cachedRead(file));
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
    if (destinationEntry instanceof import_obsidian2.TFolder) {
      throw new Error(`Cannot move '${file.path}' because '${destinationPath}' is a folder.`);
    }
    if (destinationEntry instanceof import_obsidian2.TFile) {
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
  readStatusValue(content) {
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
  predictFinalStatus(currentStatus, hasOpenTasks) {
    if (hasOpenTasks) {
      if (currentStatus !== null && currentStatus !== "completed") {
        return currentStatus;
      }
      return "todo";
    }
    return "completed";
  }
  assertConfiguredDestinationForStatus(status) {
    if (!status || !this.isRoutableStatus(status)) {
      return;
    }
    const destinationRoot = this.getDestinationRootForStatus(status);
    if (!destinationRoot) {
      throw new Error(`Set destination folder for status '${status}' in Task Manager settings.`);
    }
  }
  getDestinationRootForStatus(status) {
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
  buildDestinationPath(file, destinationRoot) {
    var _a;
    const relativePath = (_a = this.getRelativeProjectPath(file.path)) != null ? _a : file.name;
    return this.joinPath(destinationRoot, relativePath);
  }
  getRelativeProjectPath(filePath) {
    const matchingRoot = this.getTaskFolderRoots().filter((root) => filePath.startsWith(`${root}/`)).sort((a, b) => b.length - a.length)[0];
    if (!matchingRoot) {
      return null;
    }
    return filePath.slice(matchingRoot.length + 1);
  }
  joinPath(root, childPath) {
    const normalizedRoot = root.replace(/\/+$/g, "");
    const normalizedChild = childPath.replace(/^\/+/, "");
    return normalizedRoot ? `${normalizedRoot}/${normalizedChild}` : normalizedChild;
  }
  async ensureParentFoldersExist(targetFilePath) {
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
      if (existing instanceof import_obsidian2.TFile) {
        throw new Error(`Cannot create folder '${currentPath}' because a file already exists at that path.`);
      }
    }
  }
  getParentPath(path) {
    const slashIndex = path.lastIndexOf("/");
    return slashIndex === -1 ? "" : path.slice(0, slashIndex);
  }
  async mergeIntoExistingFile(sourceFile, destinationFile) {
    const sourcePath = sourceFile.path;
    const destinationContent = await this.app.vault.cachedRead(destinationFile);
    const sourceContent = await this.app.vault.cachedRead(sourceFile);
    const mergedContent = destinationContent.includes(sourceContent) ? destinationContent : `${destinationContent.trimEnd()}

---

${sourceContent}`;
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
  getTaskFolderRoots() {
    const roots = [
      this.settings.projectsFolder,
      this.settings.completedProjectsFolder,
      this.settings.waitingProjectsFolder,
      this.settings.scheduledProjectsFolder,
      this.settings.somedayMaybeProjectsFolder
    ].filter(Boolean);
    return [...new Set(roots)];
  }
  async deleteEmptyParentFolders(sourceFilePath) {
    const protectedRoots = new Set(this.getTaskFolderRoots());
    let currentPath = this.getParentPath(sourceFilePath);
    while (currentPath) {
      if (protectedRoots.has(currentPath)) {
        return;
      }
      const entry = this.app.vault.getAbstractFileByPath(currentPath);
      if (!(entry instanceof import_obsidian2.TFolder)) {
        return;
      }
      const hasDescendants = this.app.vault.getAllLoadedFiles().some((candidate) => candidate.path !== currentPath && candidate.path.startsWith(`${currentPath}/`));
      if (hasDescendants) {
        return;
      }
      await this.app.vault.delete(entry, true);
      currentPath = this.getParentPath(currentPath);
    }
  }
  rekeyTaskState(oldPath, newPath) {
    var _a;
    const existing = this.taskStateByPath.get(oldPath);
    this.taskStateByPath.delete(oldPath);
    if (existing) {
      this.taskStateByPath.set(newPath, existing);
    }
    const existingStatus = (_a = this.statusByPath.get(oldPath)) != null ? _a : null;
    this.statusByPath.delete(oldPath);
    this.statusByPath.set(newPath, existingStatus);
  }
  async promptMergeOrSkip(sourcePath, destinationPath) {
    return await new Promise((resolve) => {
      class MergeConflictModal extends import_obsidian2.Modal {
        constructor() {
          super(...arguments);
          this.resolved = false;
        }
        onOpen() {
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
        onClose() {
          if (!this.resolved) {
            resolve(false);
          }
        }
      }
      new MergeConflictModal(this.app).open();
    });
  }
  escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  queueDateDashboardRefresh() {
    if (this.dateDashboardRefreshHandle !== null) {
      window.clearTimeout(this.dateDashboardRefreshHandle);
    }
    this.dateDashboardRefreshHandle = window.setTimeout(() => {
      this.dateDashboardRefreshHandle = null;
      this.removeLegacyDateDashboardElements();
      void this.refreshDateDashboardView();
    }, 50);
  }
  removeLegacyDateDashboardElements() {
    document.querySelectorAll(`.${_TaskManagerPlugin.LEGACY_DATE_DASHBOARD_CLASS}`).forEach((element) => {
      element.remove();
    });
  }
  async ensureDateDashboardView() {
    const existingLeaf = this.app.workspace.getLeavesOfType(_TaskManagerPlugin.DATE_DASHBOARD_VIEW_TYPE)[0];
    if (existingLeaf) {
      return;
    }
    const leaf = await this.app.workspace.ensureSideLeaf(_TaskManagerPlugin.DATE_DASHBOARD_VIEW_TYPE, "right", {
      active: false,
      reveal: true,
      split: false
    });
    await leaf.setViewState({ type: _TaskManagerPlugin.DATE_DASHBOARD_VIEW_TYPE, active: false });
  }
  async refreshDateDashboardView() {
    const leaves = this.app.workspace.getLeavesOfType(_TaskManagerPlugin.DATE_DASHBOARD_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof DateDashboardView) {
        await view.refresh();
      }
    }
  }
  async renderDateDashboardContent(container) {
    container.innerHTML = "";
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "Open a date note named like YYYY-MM-DD to view the dashboard.";
      container.appendChild(emptyState);
      return;
    }
    const dateString = this.getDateStringFromFileName(activeFile.name);
    if (!dateString) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "Open a date note named like YYYY-MM-DD to view the dashboard.";
      container.appendChild(emptyState);
      return;
    }
    const sourcePath = activeFile.path;
    const tasks = await this.collectTasksForDate(dateString);
    const dashboard = document.createElement("section");
    dashboard.style.padding = "0.75rem";
    const title = document.createElement("h2");
    title.textContent = `Tasks for ${dateString}`;
    dashboard.appendChild(title);
    this.appendTaskTable(dashboard, "Due", tasks.dueTasks, sourcePath);
    this.appendTaskTable(dashboard, "Completed", tasks.completedTasks, sourcePath);
    container.appendChild(dashboard);
  }
  getDateStringFromFileName(fileName) {
    const baseName = fileName.replace(/\.md$/i, "");
    return _TaskManagerPlugin.DATE_FILE_REGEX.test(baseName) ? baseName : null;
  }
  async collectTasksForDate(dateString) {
    const dueTasks = [];
    const completedTasks = [];
    const taskFolderRoots = this.getTaskFolderRoots();
    const files = this.app.vault.getMarkdownFiles().filter(
      (file) => taskFolderRoots.some((root) => file.path.startsWith(`${root}/`))
    );
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const parsedTask = this.parseDashboardTaskLine(line);
        if (!parsedTask) {
          continue;
        }
        if (parsedTask.status === "open" && parsedTask.dueDate !== null && parsedTask.dueDate <= dateString) {
          dueTasks.push({ file, task: parsedTask.text });
        }
        if (parsedTask.completedDate === dateString) {
          completedTasks.push({ file, task: parsedTask.text });
        }
      }
    }
    const sortRows = (left, right) => {
      const pathCompare = left.file.path.localeCompare(right.file.path);
      if (pathCompare !== 0) {
        return pathCompare;
      }
      return left.task.localeCompare(right.task);
    };
    dueTasks.sort(sortRows);
    completedTasks.sort(sortRows);
    return { dueTasks, completedTasks };
  }
  parseDashboardTaskLine(line) {
    const match = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (!match) {
      return null;
    }
    const status = match[1].trim().toLowerCase() === "x" ? "completed" : "open";
    const taskBody = match[2].trim();
    const dueDate = this.readInlineFieldValue(taskBody, "due");
    const completedDate = this.readInlineFieldValue(taskBody, "completion-date");
    if (!dueDate && !completedDate) {
      return null;
    }
    return {
      text: this.cleanDashboardTaskText(taskBody),
      status,
      dueDate,
      completedDate
    };
  }
  readInlineFieldValue(taskBody, fieldName) {
    const fieldRegex = new RegExp(`\\[${this.escapeRegExp(fieldName)}::\\s*([^\\]]+?)\\s*\\]`, "i");
    const match = taskBody.match(fieldRegex);
    return match ? match[1].trim() : null;
  }
  cleanDashboardTaskText(taskBody) {
    return taskBody.replace(/\s*\[[^\]]+::\s*[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
  }
  appendTaskTable(container, title, rows, sourcePath) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    container.appendChild(heading);
    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No tasks.";
      container.appendChild(emptyState);
      return;
    }
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.marginBottom = "1rem";
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Filename", "Task"]) {
      const headerCell = document.createElement("th");
      headerCell.textContent = label;
      headerCell.style.textAlign = "left";
      headerCell.style.borderBottom = "1px solid var(--background-modifier-border)";
      headerCell.style.padding = "0.5rem";
      headerRow.appendChild(headerCell);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tableRow = document.createElement("tr");
      const fileCell = document.createElement("td");
      fileCell.style.padding = "0.5rem";
      fileCell.style.verticalAlign = "top";
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = row.file.name;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.app.workspace.openLinkText(row.file.path, sourcePath);
      });
      fileCell.appendChild(link);
      const taskCell = document.createElement("td");
      taskCell.style.padding = "0.5rem";
      taskCell.style.verticalAlign = "top";
      taskCell.textContent = row.task;
      tableRow.appendChild(fileCell);
      tableRow.appendChild(taskCell);
      tbody.appendChild(tableRow);
    }
    table.appendChild(tbody);
    container.appendChild(table);
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
      this.statusByPath.set(file.path, this.readStatusValue(content));
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
      this.statusByPath.set(file.path, status);
    } finally {
      window.setTimeout(() => {
        this.pendingPaths.delete(file.path);
      }, 0);
    }
  }
};
_TaskManagerPlugin.DATE_FILE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
_TaskManagerPlugin.LEGACY_DATE_DASHBOARD_CLASS = "task-manager-date-dashboard";
_TaskManagerPlugin.DATE_DASHBOARD_VIEW_TYPE = "task-manager-date-dashboard";
_TaskManagerPlugin.ROUTABLE_STATUSES = ["todo", "completed", "waiting", "scheduled", "someday-maybe"];
var TaskManagerPlugin = _TaskManagerPlugin;
var BaseTaskManagerSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.renderer = new TaskManagerSettingTabRenderer(this, plugin);
  }
  display() {
    this.renderer.display();
  }
};
var DateDashboardView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return "task-manager-date-dashboard";
  }
  getDisplayText() {
    return "Date Dashboard";
  }
  async onOpen() {
    await this.refresh();
  }
  async refresh() {
    await this.plugin.renderDateDashboardContent(this.contentEl);
  }
};
