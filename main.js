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
var import_obsidian5 = require("obsidian");

// src/date-dashboard.ts
var import_obsidian = require("obsidian");
var _DateDashboardController = class _DateDashboardController {
  constructor(options) {
    this.refreshHandle = null;
    this.app = options.app;
    this.getTaskFolderRoots = options.getTaskFolderRoots;
  }
  async onload(plugin) {
    plugin.registerView(_DateDashboardController.VIEW_TYPE, (leaf) => new DateDashboardView(leaf, this));
    plugin.registerEvent(this.app.vault.on("modify", () => {
      this.queueRefresh();
    }));
    plugin.registerEvent(this.app.vault.on("rename", () => {
      this.queueRefresh();
    }));
    plugin.registerEvent(this.app.vault.on("delete", () => {
      this.queueRefresh();
    }));
    plugin.registerEvent(this.app.workspace.on("file-open", () => {
      this.queueRefresh();
    }));
    plugin.registerEvent(this.app.workspace.on("layout-change", () => {
      this.queueRefresh();
    }));
    this.removeLegacyDashboardElements();
    await this.ensureView();
    await this.refreshView();
  }
  onunload() {
    if (this.refreshHandle !== null) {
      window.clearTimeout(this.refreshHandle);
      this.refreshHandle = null;
    }
  }
  refreshSoon() {
    this.queueRefresh();
  }
  async renderContent(container) {
    container.innerHTML = "";
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      container.appendChild(this.createEmptyState());
      return;
    }
    const dateString = this.getDateStringFromFileName(activeFile.name);
    if (!dateString) {
      container.appendChild(this.createEmptyState());
      return;
    }
    const dashboard = document.createElement("section");
    dashboard.style.padding = "0.75rem";
    const title = document.createElement("h2");
    title.textContent = `Tasks for ${dateString}`;
    dashboard.appendChild(title);
    const tasks = await this.collectTasksForDate(dateString);
    this.appendTaskTable(dashboard, "Due", tasks.dueTasks, activeFile.path, true);
    this.appendTaskTable(dashboard, "Completed", tasks.completedTasks, activeFile.path, false);
    container.appendChild(dashboard);
  }
  queueRefresh() {
    if (this.refreshHandle !== null) {
      window.clearTimeout(this.refreshHandle);
    }
    this.refreshHandle = window.setTimeout(() => {
      this.refreshHandle = null;
      this.removeLegacyDashboardElements();
      void this.refreshView();
    }, 50);
  }
  removeLegacyDashboardElements() {
    document.querySelectorAll(`.${_DateDashboardController.LEGACY_DATE_DASHBOARD_CLASS}`).forEach((element) => {
      element.remove();
    });
  }
  async ensureView() {
    const existingLeaf = this.app.workspace.getLeavesOfType(_DateDashboardController.VIEW_TYPE)[0];
    if (existingLeaf) {
      return;
    }
    const leaf = await this.app.workspace.ensureSideLeaf(_DateDashboardController.VIEW_TYPE, "right", {
      active: false,
      reveal: true,
      // Prefer a split side leaf so the dashboard starts in a half-height sidebar pane.
      split: true
    });
    await leaf.setViewState({ type: _DateDashboardController.VIEW_TYPE, active: false });
  }
  async refreshView() {
    const leaves = this.app.workspace.getLeavesOfType(_DateDashboardController.VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof DateDashboardView) {
        await view.refresh();
      }
    }
  }
  createEmptyState() {
    const emptyState = document.createElement("p");
    emptyState.textContent = "Open a date note named like YYYY-MM-DD to view the dashboard.";
    return emptyState;
  }
  getDateStringFromFileName(fileName) {
    const baseName = fileName.replace(/\.md$/i, "");
    return _DateDashboardController.DATE_FILE_REGEX.test(baseName) ? baseName : null;
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
          dueTasks.push({ file, task: parsedTask.text, dueDate: parsedTask.dueDate });
        }
        if (parsedTask.completedDate === dateString) {
          completedTasks.push({ file, task: parsedTask.text, dueDate: null });
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
    const sortDueRows = (left, right) => {
      var _a, _b;
      const leftDueDate = (_a = left.dueDate) != null ? _a : "9999-99-99";
      const rightDueDate = (_b = right.dueDate) != null ? _b : "9999-99-99";
      const dueDateCompare = leftDueDate.localeCompare(rightDueDate);
      if (dueDateCompare !== 0) {
        return dueDateCompare;
      }
      return sortRows(left, right);
    };
    dueTasks.sort(sortDueRows);
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
    const fieldRegex = new RegExp(`\\[${escapeRegExp(fieldName)}::\\s*([^\\]]+?)\\s*\\]`, "i");
    const match = taskBody.match(fieldRegex);
    return match ? match[1].trim() : null;
  }
  cleanDashboardTaskText(taskBody) {
    return taskBody.replace(/\s*\[[^\]]+::\s*[^\]]*\]/g, "").replace(/(^|\s)#[^\s#]+/g, "$1").replace(/\s+/g, " ").trim();
  }
  appendTaskTable(container, title, rows, sourcePath, showDueDate) {
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
    const labels = showDueDate ? ["Filename", "Task", "Due"] : ["Filename", "Task"];
    for (const label of labels) {
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
      link.textContent = this.getDisplayFileName(row.file.name);
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
      if (showDueDate) {
        const dueDateCell = document.createElement("td");
        dueDateCell.style.padding = "0.5rem";
        dueDateCell.style.verticalAlign = "top";
        dueDateCell.textContent = this.formatMonthDay(row.dueDate);
        tableRow.appendChild(dueDateCell);
      }
      tbody.appendChild(tableRow);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }
  formatMonthDay(dateString) {
    if (!dateString) {
      return "";
    }
    const match = dateString.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return match ? `${match[1]}-${match[2]}` : dateString;
  }
  getDisplayFileName(fileName) {
    const withoutExtension = fileName.replace(/\.md$/i, "");
    const withoutArchivePrefix = withoutExtension.replace(/^\d+[\s._-]*/, "");
    return withoutArchivePrefix || withoutExtension;
  }
};
_DateDashboardController.DATE_FILE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
_DateDashboardController.LEGACY_DATE_DASHBOARD_CLASS = "task-manager-date-dashboard";
_DateDashboardController.VIEW_TYPE = "task-manager-date-dashboard";
var DateDashboardController = _DateDashboardController;
var DateDashboardView = class extends import_obsidian.ItemView {
  constructor(leaf, controller) {
    super(leaf);
    this.controller = controller;
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
    await this.controller.renderContent(this.contentEl);
  }
};
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

// src/settings-ui.ts
var import_obsidian2 = require("obsidian");
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
    new import_obsidian2.Setting(containerEl).setName("Next Action Tag").setDesc("Tag added to the active next task.").addText((text) => {
      text.setPlaceholder("#next-action").setValue(settings.nextActionTag).onChange(async (value) => {
        await this.plugin.updateSetting("nextActionTag", value);
      });
    });
    new import_obsidian2.Setting(containerEl).setName("Completed Status Field").setDesc("Frontmatter field updated when the file has no remaining incomplete tasks.").addText((text) => {
      text.setPlaceholder("status").setValue(settings.statusField).onChange(async (value) => {
        await this.plugin.updateSetting("statusField", value);
      });
    });
  }
  addFolderSetting(containerEl, name, description, settingKey, folderPath, placeholder) {
    new import_obsidian2.Setting(containerEl).setName(name).setDesc(`${description} Use Browse to pick a vault path.`).addText((text) => {
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
  if (typeof import_obsidian2.FuzzySuggestModal !== "function") {
    new import_obsidian2.Notice("Folder picker is not available in this Obsidian version.");
    return;
  }
  class ProjectsFolderSuggestModal extends import_obsidian2.FuzzySuggestModal {
    constructor() {
      super(app);
      this.setPlaceholder("Select a folder");
    }
    getItems() {
      const folders = this.app.vault.getAllLoadedFiles().filter((file) => file instanceof import_obsidian2.TFolder).map((folder) => folder.path).sort((left, right) => left.localeCompare(right));
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

// src/task-routing.ts
var import_obsidian3 = require("obsidian");
function getDestinationRootForStatus(settings, status) {
  switch (status) {
    case "todo":
      return settings.projectsFolder;
    case "completed":
      return settings.completedProjectsFolder;
    case "waiting":
      return settings.waitingProjectsFolder;
    case "scheduled":
      return settings.scheduledProjectsFolder;
    case "someday-maybe":
      return settings.somedayMaybeProjectsFolder;
    default:
      return "";
  }
}
function getTaskFolderRoots(settings) {
  const roots = [
    settings.projectsFolder,
    settings.completedProjectsFolder,
    settings.waitingProjectsFolder,
    settings.scheduledProjectsFolder,
    settings.somedayMaybeProjectsFolder
  ].filter(Boolean);
  return [...new Set(roots)];
}
function buildDestinationPath(file, destinationRoot, taskFolderRoots) {
  var _a;
  const relativePath = (_a = getRelativeProjectPath(file.path, taskFolderRoots)) != null ? _a : file.name;
  return joinPath(destinationRoot, relativePath);
}
async function ensureParentFoldersExist(app, targetFilePath) {
  const parentPath = getParentPath(targetFilePath);
  if (!parentPath) {
    return;
  }
  const parts = parentPath.split("/").filter(Boolean);
  let currentPath = "";
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(currentPath);
    if (!existing) {
      await app.vault.createFolder(currentPath);
      continue;
    }
    if (existing instanceof import_obsidian3.TFile) {
      throw new Error(`Cannot create folder '${currentPath}' because a file already exists at that path.`);
    }
  }
}
async function deleteEmptyParentFolders(app, protectedRoots, sourceFilePath) {
  const protectedRootSet = new Set(protectedRoots);
  let currentPath = getParentPath(sourceFilePath);
  while (currentPath) {
    if (protectedRootSet.has(currentPath)) {
      return;
    }
    const entry = app.vault.getAbstractFileByPath(currentPath);
    if (!(entry instanceof import_obsidian3.TFolder)) {
      return;
    }
    const hasDescendants = app.vault.getAllLoadedFiles().some((candidate) => candidate.path !== currentPath && candidate.path.startsWith(`${currentPath}/`));
    if (hasDescendants) {
      return;
    }
    await app.vault.delete(entry, true);
    currentPath = getParentPath(currentPath);
  }
}
async function promptMergeOrSkip(app, sourcePath, destinationPath) {
  return await new Promise((resolve) => {
    class MergeConflictModal extends import_obsidian3.Modal {
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
    new MergeConflictModal(app).open();
  });
}
function getRelativeProjectPath(filePath, taskFolderRoots) {
  const matchingRoot = taskFolderRoots.filter((root) => filePath.startsWith(`${root}/`)).sort((left, right) => right.length - left.length)[0];
  if (!matchingRoot) {
    return null;
  }
  return filePath.slice(matchingRoot.length + 1);
}
function joinPath(root, childPath) {
  const normalizedRoot = root.replace(/\/+$/g, "");
  const normalizedChild = childPath.replace(/^\/+/, "");
  return normalizedRoot ? `${normalizedRoot}/${normalizedChild}` : normalizedChild;
}
function getParentPath(path) {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex === -1 ? "" : path.slice(0, slashIndex);
}

// src/task-processor.ts
var import_obsidian4 = require("obsidian");

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
  return new RegExp(`(^|\\s)${escapeRegExp2(nextActionTag)}(?=$|\\s)`);
}
function getTagReplaceRegex(nextActionTag) {
  return new RegExp(`\\s+${escapeRegExp2(nextActionTag)}(?=$|\\s)`, "g");
}
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/status-routing.ts
var ROUTABLE_STATUSES = ["todo", "completed", "waiting", "scheduled", "someday-maybe"];
function isRoutableStatus(value) {
  return ROUTABLE_STATUSES.includes(value);
}
function readStatusValue(content, statusField) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return null;
  }
  const fieldRegex = new RegExp(`^\\s*${escapeRegExp3(statusField)}\\s*:\\s*(.*?)\\s*$`, "i");
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
function predictFinalStatus(currentStatus, hasOpenTasks) {
  if (hasOpenTasks) {
    if (currentStatus !== null && currentStatus !== "completed") {
      return currentStatus;
    }
    return "todo";
  }
  return "completed";
}
function assertConfiguredDestinationForStatus(status, settings) {
  if (!status || !isRoutableStatus(status)) {
    return;
  }
  const destinationRoot = getDestinationRootForStatus(settings, status);
  if (!destinationRoot) {
    throw new Error(`Set destination folder for status '${status}' in Task Manager settings.`);
  }
}
function escapeRegExp3(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const currentStatus = readStatusValue(content, settings.statusField);
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

// src/task-state-store.ts
var TaskStateStore = class {
  constructor() {
    this.taskStateByPath = /* @__PURE__ */ new Map();
    this.statusByPath = /* @__PURE__ */ new Map();
    this.pendingPaths = /* @__PURE__ */ new Set();
  }
  clear() {
    this.taskStateByPath.clear();
    this.statusByPath.clear();
    this.pendingPaths.clear();
  }
  getTaskState(filePath) {
    var _a;
    return (_a = this.taskStateByPath.get(filePath)) != null ? _a : [];
  }
  setTaskState(filePath, taskState) {
    this.taskStateByPath.set(filePath, taskState);
  }
  getStatus(filePath) {
    var _a;
    return (_a = this.statusByPath.get(filePath)) != null ? _a : null;
  }
  setStatus(filePath, status) {
    this.statusByPath.set(filePath, status);
  }
  delete(filePath) {
    this.taskStateByPath.delete(filePath);
    this.statusByPath.delete(filePath);
    this.pendingPaths.delete(filePath);
  }
  rekey(oldPath, newPath) {
    var _a;
    const existingTaskState = this.taskStateByPath.get(oldPath);
    this.taskStateByPath.delete(oldPath);
    if (existingTaskState) {
      this.taskStateByPath.set(newPath, existingTaskState);
    }
    const existingStatus = (_a = this.statusByPath.get(oldPath)) != null ? _a : null;
    this.statusByPath.delete(oldPath);
    this.statusByPath.set(newPath, existingStatus);
    const wasPending = this.pendingPaths.delete(oldPath);
    if (wasPending) {
      this.pendingPaths.add(newPath);
    }
  }
  isPending(filePath) {
    return this.pendingPaths.has(filePath);
  }
  markPending(filePath) {
    this.pendingPaths.add(filePath);
  }
  unmarkPending(filePath) {
    this.pendingPaths.delete(filePath);
  }
};

// src/task-processor.ts
var TaskProcessor = class {
  constructor(options) {
    this.stateStore = new TaskStateStore();
    this.app = options.app;
    this.getSettings = options.getSettings;
  }
  onunload() {
    this.stateStore.clear();
  }
  async primeState() {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const settings = this.getSettings();
    this.stateStore.clear();
    for (const file of markdownFiles) {
      const content = await this.app.vault.cachedRead(file);
      this.stateStore.setTaskState(file.path, extractTaskState(content, settings.nextActionTag));
      this.stateStore.setStatus(file.path, readStatusValue(content, settings.statusField));
    }
  }
  async handleFileModify(file) {
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
  async processCurrentFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      throw new Error("No active file.");
    }
    return await this.processAndRouteFile(file);
  }
  async processTasks() {
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
  async processAndRouteFile(file) {
    const settings = this.getSettings();
    const initialContent = await this.app.vault.cachedRead(file);
    const initialStatus = readStatusValue(initialContent, settings.statusField);
    const hasOpenTasks = extractTaskState(initialContent, settings.nextActionTag).some((task) => task.status === "open");
    const predictedStatus = predictFinalStatus(initialStatus, hasOpenTasks);
    assertConfiguredDestinationForStatus(predictedStatus, settings);
    await this.reconcileSingleFile(file, settings);
    const moveResult = await this.routeFileByStatus(file, settings);
    return moveResult != null ? moveResult : `Processed ${file.name}.`;
  }
  async reconcileSingleFile(file, settings) {
    await reconcileFile({
      file,
      settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.stateStore.setTaskState(filePath, nextState);
      }
    });
  }
  async routeAfterStatusChange(file, previousStatus, settings) {
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
      new import_obsidian4.Notice(error instanceof Error ? error.message : "Failed to route file after status change.");
    }
  }
  async routeFileByStatus(file, settings, statusOverride) {
    const status = statusOverride != null ? statusOverride : readStatusValue(await this.app.vault.cachedRead(file), settings.statusField);
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
    if (destinationEntry instanceof import_obsidian4.TFolder) {
      throw new Error(`Cannot move '${file.path}' because '${destinationPath}' is a folder.`);
    }
    if (destinationEntry instanceof import_obsidian4.TFile) {
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
  async mergeIntoExistingFile(sourceFile, destinationFile, settings) {
    const sourcePath = sourceFile.path;
    const destinationContent = await this.app.vault.cachedRead(destinationFile);
    const sourceContent = await this.app.vault.cachedRead(sourceFile);
    const mergedContent = destinationContent.includes(sourceContent) ? destinationContent : `${destinationContent.trimEnd()}

---

${sourceContent}`;
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
  async applyCompletionRules(file, content, completedLine, settings) {
    await applyCompletionRules({
      file,
      content,
      completedLine,
      settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.stateStore.setTaskState(filePath, nextState);
      }
    });
  }
  async applyUncompletionRules(file, content, uncompletedLine, settings) {
    await applyUncompletionRules({
      file,
      content,
      uncompletedLine,
      settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.stateStore.setTaskState(filePath, nextState);
      }
    });
  }
  async applyDeletedTagRules(file, content, deletedTaggedTaskLine, settings) {
    await applyDeletedTagRules({
      file,
      content,
      deletedTaggedTaskLine,
      settings,
      readFile: (target) => this.app.vault.cachedRead(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.stateStore.setTaskState(filePath, nextState);
      }
    });
  }
  async writeFileContent(file, content, settings) {
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
  async setFileStatus(file, status, settings) {
    this.stateStore.markPending(file.path);
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[settings.statusField] = status;
      });
      this.stateStore.setStatus(file.path, status);
    } finally {
      window.setTimeout(() => {
        this.stateStore.unmarkPending(file.path);
      }, 0);
    }
  }
};

// main.ts
var TaskManagerPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.taskProcessor = null;
    this.dateDashboard = null;
    this.settings = normalizeSettings({});
  }
  async onload() {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.taskProcessor = new TaskProcessor({
      app: this.app,
      getSettings: () => this.getSettings()
    });
    this.dateDashboard = new DateDashboardController({
      app: this.app,
      getTaskFolderRoots: () => this.getTaskFolderRoots()
    });
    this.addSettingTab(new BaseTaskManagerSettingTab(this.app, this));
    this.addCommand({
      id: "process-tasks",
      name: "Process Tasks",
      callback: () => {
        void this.runProcessTasks();
      }
    });
    this.addCommand({
      id: "process-current-file",
      name: "Process File",
      callback: () => {
        void this.runProcessCurrentFile();
      }
    });
    this.registerEvent(this.app.vault.on("modify", (file) => {
      var _a;
      if (!(file instanceof import_obsidian5.TFile)) {
        return;
      }
      void ((_a = this.taskProcessor) == null ? void 0 : _a.handleFileModify(file));
    }));
    await this.taskProcessor.primeState();
    await this.dateDashboard.onload(this);
  }
  onunload() {
    var _a, _b;
    (_a = this.taskProcessor) == null ? void 0 : _a.onunload();
    this.taskProcessor = null;
    (_b = this.dateDashboard) == null ? void 0 : _b.onunload();
    this.dateDashboard = null;
    console.log("Unloading Task Manager plugin");
  }
  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = normalizeSettings(loadedData != null ? loadedData : {});
  }
  async saveSettings() {
    var _a, _b;
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    await ((_a = this.taskProcessor) == null ? void 0 : _a.primeState());
    (_b = this.dateDashboard) == null ? void 0 : _b.refreshSoon();
  }
  getSettings() {
    return { ...this.settings };
  }
  async updateSetting(key, value) {
    this.settings[key] = value;
    await this.saveSettings();
  }
  async runProcessCurrentFile() {
    try {
      const result = await this.taskProcessor.processCurrentFile();
      new import_obsidian5.Notice(result);
    } catch (error) {
      new import_obsidian5.Notice(error instanceof Error ? error.message : "Failed to Process File.");
    }
  }
  async runProcessTasks() {
    try {
      const result = await this.taskProcessor.processTasks();
      new import_obsidian5.Notice(result);
    } catch (error) {
      new import_obsidian5.Notice(error instanceof Error ? error.message : "Failed to process tasks.");
    }
  }
  getTaskFolderRoots() {
    return getTaskFolderRoots(this.settings);
  }
};
var BaseTaskManagerSettingTab = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.renderer = new TaskManagerSettingTabRenderer(this, plugin);
  }
  display() {
    this.renderer.display();
  }
};
