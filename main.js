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
var import_obsidian10 = require("obsidian");

// src/commands/register-task-commands.ts
function registerTaskCommands(plugin, handlers) {
  plugin.addCommand({
    id: "process-tasks",
    name: "Process Tasks",
    callback: handlers.processTasks
  });
  plugin.addCommand({
    id: "process-current-file",
    name: "Process File",
    callback: handlers.processCurrentFile
  });
  plugin.addCommand({
    id: "reset-current-file-tasks",
    name: "Reset Tasks",
    callback: handlers.resetCurrentFileTasks
  });
  plugin.addCommand({
    id: "create-tasks-summary",
    name: "Tasks Summary",
    callback: handlers.createTasksSummary
  });
}

// src/dashboard/date-dashboard.ts
var import_obsidian2 = require("obsidian");

// src/dashboard/dashboard-task-data.ts
var import_obsidian = require("obsidian");
var EMPTY_DUE_DATE_SORT_VALUE = "9999-99-99";
var MARKDOWN_EXTENSION_REGEX = /\.md$/i;
var DATE_FILE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
var TASK_LINE_REGEX = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
var DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;
var COMPLETION_DATE_FIELD_REGEX = /\[completion-date::\s*([^\]]+?)\s*\]/i;
var PRIORITY_FIELD_REGEX = /\[priority::\s*([^\]]+?)\s*\]/i;
var REPEAT_FIELD_REGEX = /\[(?:repeat|repeats)::\s*[^\]]+?\]/i;
var INLINE_FIELD_REGEX = /\s*\[[^\]]+::\s*[^\]]*\]/g;
var TAG_REGEX = /(^|\s)#[^\s#]+/g;
var MULTISPACE_REGEX = /\s+/g;
var DEFAULT_PRIORITY = 3;
function getDateStringFromFileName(fileName) {
  const baseName = fileName.replace(MARKDOWN_EXTENSION_REGEX, "");
  return DATE_FILE_REGEX.test(baseName) ? baseName : null;
}
async function collectTasksForDate(app, taskFolderRoots, dateString) {
  const dueTasks = [];
  const completedTasks = [];
  const files = app.vault.getMarkdownFiles().filter(
    (file) => taskFolderRoots.some((root) => file.path.startsWith(`${root}/`))
  );
  for (const file of files) {
    const content = await app.vault.read(file);
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const parsedTask = parseDashboardTaskLine(line);
      if (!parsedTask) {
        continue;
      }
      if (parsedTask.status === "open" && parsedTask.dueDate !== null && parsedTask.dueDate <= dateString) {
        dueTasks.push({
          file,
          task: parsedTask.text,
          dueDate: parsedTask.dueDate,
          priority: parsedTask.priority,
          isRecurring: parsedTask.isRecurring
        });
      }
      if (parsedTask.completedDate === dateString) {
        completedTasks.push({
          file,
          task: parsedTask.text,
          dueDate: null,
          priority: parsedTask.priority,
          isRecurring: parsedTask.isRecurring
        });
      }
    }
  }
  dueTasks.sort(compareDueRows);
  completedTasks.sort(compareRows);
  return { dueTasks, completedTasks };
}
async function collectInboxTasks(app, inboxFile) {
  if (!inboxFile) return [];
  const file = app.vault.getAbstractFileByPath(inboxFile);
  if (!file || !(file instanceof import_obsidian.TFile)) return [];
  const content = await app.vault.read(file);
  const lines = content.split(/\r?\n/);
  const inboxTasks = [];
  for (const line of lines) {
    const match = line.match(TASK_LINE_REGEX);
    if (!match) continue;
    const status = match[1].trim().toLowerCase() === "x" ? "completed" : "open";
    if (status !== "open") continue;
    const taskBody = match[2].trim();
    const priority = parsePriorityValue(readInlineFieldValue(taskBody, PRIORITY_FIELD_REGEX));
    inboxTasks.push({
      file,
      task: cleanDashboardTaskText(taskBody),
      dueDate: null,
      priority,
      isRecurring: false
    });
  }
  inboxTasks.sort(compareRows);
  return inboxTasks;
}
function parseDashboardTaskLine(line) {
  const match = line.match(TASK_LINE_REGEX);
  if (!match) {
    return null;
  }
  const status = match[1].trim().toLowerCase() === "x" ? "completed" : "open";
  const taskBody = match[2].trim();
  const dueDate = readInlineFieldValue(taskBody, DUE_FIELD_REGEX);
  const completedDate = readInlineFieldValue(taskBody, COMPLETION_DATE_FIELD_REGEX);
  const priority = parsePriorityValue(readInlineFieldValue(taskBody, PRIORITY_FIELD_REGEX));
  if (!dueDate && !completedDate) {
    return null;
  }
  return {
    text: cleanDashboardTaskText(taskBody),
    status,
    dueDate,
    completedDate,
    priority,
    isRecurring: REPEAT_FIELD_REGEX.test(taskBody)
  };
}
function parsePriorityValue(value) {
  if (!value) {
    return DEFAULT_PRIORITY;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3) {
    return DEFAULT_PRIORITY;
  }
  return parsed;
}
function readInlineFieldValue(taskBody, fieldRegex) {
  const match = taskBody.match(fieldRegex);
  return match ? match[1].trim() : null;
}
function cleanDashboardTaskText(taskBody) {
  return taskBody.replace(INLINE_FIELD_REGEX, "").replace(TAG_REGEX, "$1").replace(MULTISPACE_REGEX, " ").trim();
}
function compareRows(left, right) {
  const priorityCompare = left.priority - right.priority;
  if (priorityCompare !== 0) {
    return priorityCompare;
  }
  const pathCompare = left.file.path.localeCompare(right.file.path);
  if (pathCompare !== 0) {
    return pathCompare;
  }
  return left.task.localeCompare(right.task);
}
function compareDueRows(left, right) {
  var _a, _b;
  const priorityCompare = left.priority - right.priority;
  if (priorityCompare !== 0) {
    return priorityCompare;
  }
  const leftDueDate = (_a = left.dueDate) != null ? _a : EMPTY_DUE_DATE_SORT_VALUE;
  const rightDueDate = (_b = right.dueDate) != null ? _b : EMPTY_DUE_DATE_SORT_VALUE;
  const dueDateCompare = leftDueDate.localeCompare(rightDueDate);
  if (dueDateCompare !== 0) {
    return dueDateCompare;
  }
  return compareRows(left, right);
}

// src/dashboard/date-dashboard.ts
var MARKDOWN_EXTENSION_REGEX2 = /\.md$/i;
var MONTH_DAY_REGEX = /^\d{4}-(\d{2})-(\d{2})$/;
var _DateDashboardController = class _DateDashboardController {
  constructor(options) {
    this.refreshHandle = null;
    this.app = options.app;
    this.getTaskFolderRoots = options.getTaskFolderRoots;
    this.getInboxFile = options.getInboxFile;
    this.getHideKeywords = options.getHideKeywords;
  }
  async onload(plugin) {
    plugin.registerView(_DateDashboardController.VIEW_TYPE, (leaf) => new DateDashboardView(leaf, this));
    plugin.registerEvent(this.app.vault.on("modify", (file) => {
      if (this.isRelevantFile(file)) {
        this.queueRefresh();
      }
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
    var _a, _b;
    container.innerHTML = "";
    container.classList.add("markdown-rendered");
    const activeFile = this.app.workspace.getActiveFile();
    const dateString = activeFile ? (_a = getDateStringFromFileName(activeFile.name)) != null ? _a : this.getTodayDateString() : this.getTodayDateString();
    const sourcePath = (_b = activeFile == null ? void 0 : activeFile.path) != null ? _b : "";
    const dashboard = document.createElement("section");
    const title = document.createElement("h2");
    title.textContent = `Tasks for ${dateString}`;
    dashboard.appendChild(title);
    const tasks = await collectTasksForDate(this.app, this.getTaskFolderRoots(), dateString);
    this.appendDueSection(dashboard, tasks.dueTasks, sourcePath);
    const inboxFile = this.getInboxFile();
    const inboxTasks = await collectInboxTasks(this.app, inboxFile);
    this.appendInboxSection(dashboard, inboxFile, inboxTasks);
    this.appendTaskTable(dashboard, "Completed", tasks.completedTasks, sourcePath, false);
    container.appendChild(dashboard);
  }
  /**
   * Renders the Inbox section: heading, link to inbox file, and a plain list of tasks (no table, no priorities).
   */
  appendInboxSection(container, inboxFile, inboxTasks) {
    const heading = document.createElement("h3");
    heading.textContent = "Inbox";
    container.appendChild(heading);
    if (inboxFile) {
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = `Open inbox file`;
      link.classList.add("internal-link");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.app.workspace.openLinkText(inboxFile, "");
      });
      container.appendChild(link);
    }
    if (inboxTasks.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No tasks.";
      container.appendChild(emptyState);
      return;
    }
    const ul = document.createElement("ul");
    for (const row of inboxTasks) {
      const li = document.createElement("li");
      li.textContent = row.task;
      ul.appendChild(li);
    }
    container.appendChild(ul);
  }
  appendDueSection(container, rows, sourcePath) {
    const heading = document.createElement("h3");
    heading.textContent = "Due";
    container.appendChild(heading);
    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No tasks.";
      container.appendChild(emptyState);
      return;
    }
    const nonRecurringRows = rows.filter((row) => !row.isRecurring);
    const recurringRows = rows.filter((row) => row.isRecurring);
    this.appendTaskTableGroup(container, "Non-recurring Tasks", nonRecurringRows, sourcePath, true);
    this.appendTaskTableGroup(container, "Recurring Tasks", recurringRows, sourcePath, true);
  }
  isRelevantFile(file) {
    if (!(file instanceof import_obsidian2.TFile)) return false;
    if (!MARKDOWN_EXTENSION_REGEX2.test(file.name)) return false;
    const roots = this.getTaskFolderRoots().filter(Boolean);
    const inboxFile = this.getInboxFile();
    const inTaskFolder = roots.some((root) => file.path.startsWith(`${root}/`));
    const isInbox = !!inboxFile && file.path === inboxFile;
    return inTaskFolder || isInbox;
  }
  queueRefresh() {
    if (this.refreshHandle !== null) {
      window.clearTimeout(this.refreshHandle);
    }
    this.refreshHandle = window.setTimeout(() => {
      this.refreshHandle = null;
      void this.refreshView();
    }, 50);
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
  getTodayDateString() {
    const now = /* @__PURE__ */ new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  appendTaskTable(container, title, rows, sourcePath, showDueDate) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    container.appendChild(heading);
    this.appendTaskTableContent(container, rows, sourcePath, showDueDate);
  }
  appendTaskTableGroup(container, title, rows, sourcePath, showDueDate) {
    const heading = document.createElement("h4");
    heading.textContent = title;
    container.appendChild(heading);
    this.appendTaskTableContent(container, rows, sourcePath, showDueDate);
  }
  appendTaskTableContent(container, rows, sourcePath, showDueDate) {
    var _a, _b;
    if (rows.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No tasks.";
      container.appendChild(emptyState);
      return;
    }
    const folderMap = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const folderPath = (_b = (_a = row.file.parent) == null ? void 0 : _a.path) != null ? _b : "";
      const filePath = row.file.path;
      if (!folderMap.has(folderPath)) {
        folderMap.set(folderPath, /* @__PURE__ */ new Map());
      }
      const fileMap = folderMap.get(folderPath);
      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, []);
      }
      fileMap.get(filePath).push(row);
    }
    const sortedFolderEntries = [...folderMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const labels = showDueDate ? ["Folder", "Filename", "Task", "Priority", "Due"] : ["Folder", "Filename", "Task", "Priority"];
    for (const label of labels) {
      headerRow.appendChild(this.createTextElement("th", label));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const [folderPath, fileMap] of sortedFolderEntries) {
      const sortedFileEntries = [...fileMap.entries()].sort(([a], [b]) => a.localeCompare(b));
      const folderRowCount = sortedFileEntries.reduce((sum, [, fileRows]) => sum + fileRows.length, 0);
      let folderCellEmitted = false;
      for (const [, fileRows] of sortedFileEntries) {
        for (let i = 0; i < fileRows.length; i++) {
          const row = fileRows[i];
          const tableRow = document.createElement("tr");
          if (!folderCellEmitted) {
            const folderCell = this.createTextElement("td", this.getDisplayFolderName(folderPath));
            if (folderRowCount > 1) {
              folderCell.rowSpan = folderRowCount;
            }
            tableRow.appendChild(folderCell);
            folderCellEmitted = true;
          }
          if (i === 0) {
            const fileCell = this.createFileCell(row, sourcePath);
            if (fileRows.length > 1) {
              fileCell.rowSpan = fileRows.length;
            }
            tableRow.appendChild(fileCell);
          }
          tableRow.appendChild(this.createTaskCell(row.task, row.priority));
          tableRow.appendChild(this.createTextElement("td", String(row.priority)));
          if (showDueDate) {
            tableRow.appendChild(this.createTextElement("td", this.formatMonthDay(row.dueDate)));
          }
          tbody.appendChild(tableRow);
        }
      }
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }
  createFileCell(row, sourcePath) {
    const fileCell = document.createElement("td");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = this.getDisplayFileName(row.file.name);
    link.classList.add("internal-link");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void this.app.workspace.openLinkText(row.file.path, sourcePath);
    });
    fileCell.appendChild(link);
    return fileCell;
  }
  createTextElement(tagName, text) {
    const element = document.createElement(tagName);
    element.textContent = text;
    return element;
  }
  createTaskCell(task, priority) {
    const taskCell = document.createElement("td");
    taskCell.textContent = task;
    this.applyPriorityTextStyle(taskCell, priority);
    return taskCell;
  }
  formatMonthDay(dateString) {
    if (!dateString) {
      return "";
    }
    const match = dateString.match(MONTH_DAY_REGEX);
    return match ? `${match[1]}-${match[2]}` : dateString;
  }
  applyPriorityTextStyle(element, priority) {
    if (priority === 1) {
      element.style.fontWeight = "700";
      return;
    }
    if (priority === 2) {
      element.style.fontStyle = "italic";
    }
  }
  applyHideKeywords(name) {
    const keywords = this.getHideKeywords().split(",").map((k) => k.trim()).filter((k) => k.length > 0);
    if (keywords.length === 0) {
      return name;
    }
    let result = name;
    for (const keyword of keywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(escaped, "gi"), "");
    }
    result = result.replace(/\s+/g, " ").trim();
    return result || name;
  }
  getDisplayFileName(fileName) {
    const withoutExtension = fileName.replace(MARKDOWN_EXTENSION_REGEX2, "");
    return this.applyHideKeywords(withoutExtension);
  }
  getDisplayFolderName(folderPath) {
    var _a;
    const lastSegment = (_a = folderPath.split("/").pop()) != null ? _a : folderPath;
    return this.applyHideKeywords(lastSegment);
  }
};
_DateDashboardController.VIEW_TYPE = "task-manager-date-dashboard";
var DateDashboardController = _DateDashboardController;
var DateDashboardView = class extends import_obsidian2.ItemView {
  constructor(leaf, controller) {
    super(leaf);
    this.controller = controller;
  }
  getViewType() {
    return DateDashboardController.VIEW_TYPE;
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

// src/editor/due-date-suggest.ts
var import_obsidian3 = require("obsidian");

// src/date/date-suggestions.ts
var DEFAULT_LOOKAHEAD_DAYS = 30;
var weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long"
});
function buildDateSuggestions(lookaheadDays = DEFAULT_LOOKAHEAD_DAYS) {
  const today = startOfDay(/* @__PURE__ */ new Date());
  const suggestions = [];
  for (let offset = 0; offset <= lookaheadDays; offset += 1) {
    const date = addDays(today, offset);
    const value = formatDate(date);
    const label = getDateLabel(date, offset);
    suggestions.push({
      value,
      label,
      searchText: `${value} ${label}`.toLowerCase()
    });
  }
  return suggestions;
}
function resolveDateInput(input, lookaheadDays = DEFAULT_LOOKAHEAD_DAYS) {
  var _a;
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }
  if (isValidIsoDate(normalized)) {
    return normalized;
  }
  const suggestions = buildDateSuggestions(lookaheadDays);
  const exactMatch = suggestions.find((suggestion) => {
    return suggestion.value.toLowerCase() === normalized || suggestion.label.toLowerCase() === normalized;
  });
  if (exactMatch) {
    return exactMatch.value;
  }
  const fuzzyMatch = suggestions.find((suggestion) => suggestion.searchText.includes(normalized));
  return (_a = fuzzyMatch == null ? void 0 : fuzzyMatch.value) != null ? _a : null;
}
function getDateLabel(date, offset) {
  if (offset === 0) {
    return "Today";
  }
  if (offset === 1) {
    return "Tomorrow";
  }
  return weekdayFormatter.format(date);
}
function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [yearPart, monthPart, dayPart] = value.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// src/editor/due-date-suggest.ts
var DateFieldEditorSuggest = class extends import_obsidian3.EditorSuggest {
  constructor(app, fieldName, suggestionFactory) {
    super(app);
    this.triggerInfo = null;
    this.activeEditor = null;
    this.fieldName = fieldName;
    this.suggestionFactory = suggestionFactory;
    this.triggerRegex = buildTriggerRegex(this.fieldName);
    this.setInstructions([
      {
        command: "Enter",
        purpose: "Insert date"
      },
      {
        command: "Esc",
        purpose: "Close suggestions"
      }
    ]);
  }
  onTrigger(cursor, editor) {
    var _a, _b;
    const linePrefix = editor.getLine(cursor.line).slice(0, cursor.ch);
    const triggerMatch = linePrefix.match(this.triggerRegex);
    if (!triggerMatch) {
      this.triggerInfo = null;
      this.activeEditor = null;
      return null;
    }
    const query = (_a = triggerMatch[3]) != null ? _a : "";
    const typedWhitespace = (_b = triggerMatch[2]) != null ? _b : "";
    const startCh = linePrefix.length - typedWhitespace.length - query.length;
    const trigger = {
      start: { line: cursor.line, ch: startCh },
      end: cursor,
      query
    };
    this.triggerInfo = trigger;
    this.activeEditor = editor;
    return trigger;
  }
  getSuggestions(context) {
    const normalizedQuery = context.query.trim().toLowerCase();
    return this.buildSuggestions().filter((suggestion) => {
      return normalizedQuery.length === 0 || suggestion.searchText.includes(normalizedQuery);
    });
  }
  renderSuggestion(value, el) {
    el.createDiv({ text: value.value });
    el.createEl("small", { text: value.label });
  }
  selectSuggestion(value) {
    if (!this.activeEditor || !this.triggerInfo) {
      return;
    }
    this.activeEditor.replaceRange(` ${value.value}`, this.triggerInfo.start, this.triggerInfo.end);
    this.close();
  }
  close() {
    super.close();
    this.triggerInfo = null;
    this.activeEditor = null;
  }
  buildSuggestions() {
    return this.suggestionFactory();
  }
};
var dueSuggestionFactory = createDailySuggestionFactory();
var DueDateEditorSuggest = class extends DateFieldEditorSuggest {
  constructor(app) {
    super(app, "due", dueSuggestionFactory);
  }
};
var CreatedDateEditorSuggest = class extends DateFieldEditorSuggest {
  constructor(app) {
    super(app, "created", createTodaySuggestionFactory());
  }
};
function buildTriggerRegex(fieldName) {
  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(${escapedFieldName}::)(\\s*)([a-z0-9-]*)$`, "i");
}
function createDailySuggestionFactory() {
  let cachedSuggestions = null;
  let cachedSuggestionsDate = "";
  return () => {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (cachedSuggestions !== null && cachedSuggestionsDate === today) {
      return cachedSuggestions;
    }
    cachedSuggestions = buildDateSuggestions(DEFAULT_LOOKAHEAD_DAYS);
    cachedSuggestionsDate = today;
    return cachedSuggestions;
  };
}
function createTodaySuggestionFactory() {
  let cachedSuggestion = null;
  let cachedSuggestionDate = "";
  return () => {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (cachedSuggestion !== null && cachedSuggestionDate === today) {
      return cachedSuggestion;
    }
    cachedSuggestion = [
      {
        value: today,
        label: "Today",
        searchText: `${today} today`
      }
    ];
    cachedSuggestionDate = today;
    return cachedSuggestion;
  };
}

// src/settings/settings-utils.ts
var DEFAULT_SETTINGS = {
  nextActionTag: "#next-action",
  statusField: "status",
  projectsFolder: "",
  completedProjectsFolder: "",
  waitingProjectsFolder: "",
  somedayMaybeProjectsFolder: "",
  inboxFile: "",
  tasksSummaryFile: "Tasks Summary.md",
  openSummaryAfterGeneration: false,
  dashboardHideKeywords: ""
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
function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function normalizeSettings(rawSettings) {
  var _a;
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    nextActionTag: normalizeTag(rawSettings.nextActionTag),
    statusField: normalizeStatusField(rawSettings.statusField),
    projectsFolder: normalizeFolder(rawSettings.projectsFolder),
    completedProjectsFolder: normalizeFolder(rawSettings.completedProjectsFolder),
    waitingProjectsFolder: normalizeFolder(rawSettings.waitingProjectsFolder),
    somedayMaybeProjectsFolder: normalizeFolder(rawSettings.somedayMaybeProjectsFolder),
    inboxFile: normalizeFolder(rawSettings.inboxFile),
    tasksSummaryFile: normalizeFolder(rawSettings.tasksSummaryFile) || DEFAULT_SETTINGS.tasksSummaryFile,
    openSummaryAfterGeneration: normalizeBoolean(rawSettings.openSummaryAfterGeneration, DEFAULT_SETTINGS.openSummaryAfterGeneration),
    dashboardHideKeywords: String((_a = rawSettings.dashboardHideKeywords) != null ? _a : "")
  };
}

// src/summary/tasks-summary.ts
var import_obsidian5 = require("obsidian");

// src/routing/task-routing.ts
var import_obsidian4 = require("obsidian");
function getDestinationRootForStatus(settings, status) {
  switch (status) {
    case "todo":
      return settings.projectsFolder;
    case "completed":
      return settings.completedProjectsFolder;
    case "waiting":
      return settings.waitingProjectsFolder;
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
    if (existing instanceof import_obsidian4.TFile) {
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
    if (!(entry instanceof import_obsidian4.TFolder)) {
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
    class MergeConflictModal extends import_obsidian4.Modal {
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

// src/summary/tasks-summary.ts
var TASK_LINE_REGEX2 = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
var DUE_FIELD_REGEX2 = /\[due::\s*([^\]]+?)\s*\]/i;
var PRIORITY_FIELD_REGEX2 = /\[priority::\s*([^\]]+?)\s*\]/i;
var REPEAT_FIELD_REGEX2 = /\[(?:repeat|repeats)::\s*[^\]]+?\]/i;
var INLINE_FIELD_REGEX2 = /\s*\[[^\]]+::\s*[^\]]*\]/g;
var TAG_REGEX2 = /(^|\s)#[^\s#]+/g;
var MULTISPACE_REGEX2 = /\s+/g;
var MARKDOWN_EXTENSION_REGEX3 = /\.md$/i;
var MONTH_DAY_REGEX2 = /^\d{4}-(\d{2})-(\d{2})$/;
var DEFAULT_PRIORITY2 = 3;
async function writeTasksSummary(app, settings, summaryFilePath) {
  const sections = await buildSummarySections(app, settings);
  const summaryContent = renderSummary(sections, settings.dashboardHideKeywords);
  await writeSummaryFile(app, summaryFilePath, summaryContent);
  return summaryFilePath;
}
async function buildSummarySections(app, settings) {
  return [
    {
      title: "Projects",
      rows: await collectNextActionRowsForFolder(app, settings.projectsFolder, settings.nextActionTag)
    },
    {
      title: "Waiting",
      rows: await collectNextActionRowsForFolder(app, settings.waitingProjectsFolder, settings.nextActionTag)
    },
    {
      title: "Someday-Maybe",
      rows: await collectNextActionRowsForFolder(app, settings.somedayMaybeProjectsFolder, settings.nextActionTag)
    },
    {
      title: "Inbox",
      rows: await collectNextActionRowsForInbox(app, settings.inboxFile, settings.nextActionTag)
    }
  ];
}
async function collectNextActionRowsForFolder(app, folderPath, nextActionTag) {
  if (!folderPath) {
    return [];
  }
  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows = [];
  for (const file of files) {
    const row = await findNextActionRow(app, file, nextActionTag);
    if (row) {
      rows.push(row);
    }
  }
  return rows.sort(compareSummaryRows);
}
async function collectNextActionRowsForInbox(app, inboxFilePath, nextActionTag) {
  if (!inboxFilePath) {
    return [];
  }
  const inboxFile = app.vault.getAbstractFileByPath(inboxFilePath);
  if (!(inboxFile instanceof import_obsidian5.TFile)) {
    return [];
  }
  const row = await findNextActionRow(app, inboxFile, nextActionTag);
  return row ? [row] : [];
}
async function findNextActionRow(app, file, nextActionTag) {
  const content = await app.vault.read(file);
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseNextActionTaskLine(line, nextActionTag);
    if (!parsed) {
      continue;
    }
    return {
      file,
      task: parsed.task,
      dueDate: parsed.dueDate,
      priority: parsed.priority,
      isRecurring: parsed.isRecurring
    };
  }
  return null;
}
function parseNextActionTaskLine(line, nextActionTag) {
  const match = line.match(TASK_LINE_REGEX2);
  if (!match) {
    return null;
  }
  const status = match[1].trim().toLowerCase() === "x" ? "completed" : "open";
  if (status !== "open") {
    return null;
  }
  const taskBody = match[2].trim();
  if (!hasTag(taskBody, nextActionTag)) {
    return null;
  }
  return {
    task: cleanTaskText(taskBody),
    dueDate: readInlineFieldValue2(taskBody, DUE_FIELD_REGEX2),
    priority: parsePriorityValue2(readInlineFieldValue2(taskBody, PRIORITY_FIELD_REGEX2)),
    isRecurring: REPEAT_FIELD_REGEX2.test(taskBody)
  };
}
function renderSummary(sections, hideKeywords) {
  const lines = ["# Tasks Summary", ""];
  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    if (section.title === "Projects") {
      appendProjectSubsections(lines, section.rows, hideKeywords);
    } else {
      appendSectionTable(lines, section.rows, hideKeywords);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
async function writeSummaryFile(app, summaryFilePath, summaryContent) {
  await ensureParentFoldersExist(app, summaryFilePath);
  const existing = app.vault.getAbstractFileByPath(summaryFilePath);
  if (!existing) {
    const createdFile = await app.vault.create(summaryFilePath, summaryContent);
    await stampSummaryMetadata(app, createdFile);
    return;
  }
  if (existing instanceof import_obsidian5.TFile) {
    await app.vault.modify(existing, summaryContent);
    await stampSummaryMetadata(app, existing);
    return;
  }
  throw new Error(`Cannot write summary to '${summaryFilePath}' because a folder already exists at that path.`);
}
function compareSummaryRows(left, right) {
  var _a, _b, _c, _d;
  const folderCompare = ((_b = (_a = left.file.parent) == null ? void 0 : _a.path) != null ? _b : "").localeCompare((_d = (_c = right.file.parent) == null ? void 0 : _c.path) != null ? _d : "");
  if (folderCompare !== 0) {
    return folderCompare;
  }
  return left.file.path.localeCompare(right.file.path);
}
function appendProjectSubsections(lines, rows, hideKeywords) {
  const buckets = splitProjectRows(rows);
  appendNamedSubsection(lines, "Recurring Tasks", buckets.recurring, hideKeywords);
  appendNamedSubsection(lines, "Tasks Due This Week", buckets.dueThisWeek, hideKeywords);
  appendNamedSubsection(lines, "Tasks Scheduled But Not Due This Week", buckets.scheduledLater, hideKeywords);
  appendNamedSubsection(lines, "Unscheduled Tasks", buckets.unscheduled, hideKeywords);
}
function appendNamedSubsection(lines, title, rows, hideKeywords) {
  lines.push(`### ${title}`, "");
  appendSectionTable(lines, rows, hideKeywords);
}
function appendSectionTable(lines, rows, hideKeywords) {
  var _a, _b;
  if (rows.length === 0) {
    lines.push("No tasks.", "");
    return;
  }
  lines.push("| Folder | Filename | Task | Priority | Due |");
  lines.push("| --- | --- | --- | --- | --- |");
  let previousFolder = "";
  for (const row of rows) {
    const folderName = getDisplayFolderName((_b = (_a = row.file.parent) == null ? void 0 : _a.path) != null ? _b : "", hideKeywords);
    const displayFolder = folderName === previousFolder ? "" : folderName;
    previousFolder = folderName;
    lines.push(
      `| ${escapePipes(displayFolder)} | ${buildFileLink(row.file, hideKeywords)} | ${buildWeightedTaskText(row.task, row.priority)} | ${row.priority} | ${formatMonthDay(row.dueDate)} |`
    );
  }
  lines.push("");
}
function splitProjectRows(rows) {
  const endOfWeek = getEndOfWeek(/* @__PURE__ */ new Date());
  const buckets = {
    recurring: [],
    dueThisWeek: [],
    scheduledLater: [],
    unscheduled: []
  };
  for (const row of rows) {
    if (row.isRecurring) {
      buckets.recurring.push(row);
      continue;
    }
    if (!row.dueDate) {
      buckets.unscheduled.push(row);
      continue;
    }
    const dueDate = parseIsoDate(row.dueDate);
    if (dueDate !== null && dueDate <= endOfWeek) {
      buckets.dueThisWeek.push(row);
    } else {
      buckets.scheduledLater.push(row);
    }
  }
  return buckets;
}
function isInFolder(filePath, folderPath) {
  return filePath.startsWith(`${folderPath}/`);
}
function hasTag(taskBody, tag) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escapedTag}(?=$|\\s)`).test(taskBody);
}
function readInlineFieldValue2(taskBody, fieldRegex) {
  const match = taskBody.match(fieldRegex);
  return match ? match[1].trim() : null;
}
function parsePriorityValue2(value) {
  if (!value) {
    return DEFAULT_PRIORITY2;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3) {
    return DEFAULT_PRIORITY2;
  }
  return parsed;
}
function cleanTaskText(taskBody) {
  return taskBody.replace(INLINE_FIELD_REGEX2, "").replace(TAG_REGEX2, "$1").replace(MULTISPACE_REGEX2, " ").trim();
}
function buildFileLink(file, hideKeywords) {
  const displayName = getDisplayFileName(file.name, hideKeywords);
  return `[${escapeLinkText(displayName)}](<${file.path}>)`;
}
function getDisplayFileName(fileName, hideKeywords) {
  return applyHideKeywords(fileName.replace(MARKDOWN_EXTENSION_REGEX3, ""), hideKeywords);
}
function getDisplayFolderName(folderPath, hideKeywords) {
  var _a;
  const lastSegment = (_a = folderPath.split("/").pop()) != null ? _a : folderPath;
  return applyHideKeywords(lastSegment || "/", hideKeywords);
}
function applyHideKeywords(name, hideKeywords) {
  const keywords = hideKeywords.split(",").map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0);
  if (keywords.length === 0) {
    return name;
  }
  let result = name;
  for (const keyword of keywords) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escapedKeyword, "gi"), "");
  }
  result = result.replace(/\s+/g, " ").trim();
  return result || name;
}
function formatMonthDay(dateString) {
  if (!dateString) {
    return "";
  }
  const match = dateString.match(MONTH_DAY_REGEX2);
  return match ? `${match[1]}-${match[2]}` : dateString;
}
function escapePipes(value) {
  return value.replace(/\|/g, "\\|");
}
function escapeLinkText(value) {
  return value.replace(/([\\[\]])/g, "\\$1");
}
function buildWeightedTaskText(task, priority) {
  const escapedTask = escapePipes(task);
  if (priority === 1) {
    return `**${escapedTask}**`;
  }
  if (priority === 2) {
    return `*${escapedTask}*`;
  }
  return escapedTask;
}
async function stampSummaryMetadata(app, file) {
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    frontmatter["creation-date"] = getCurrentDateString();
    frontmatter["creation-time"] = getCurrentTimeString();
  });
}
function getEndOfWeek(baseDate) {
  const endOfWeek = new Date(baseDate);
  const daysUntilSunday = (7 - endOfWeek.getDay()) % 7;
  endOfWeek.setHours(23, 59, 59, 999);
  endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
  return endOfWeek;
}
function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function getCurrentDateString() {
  const now = /* @__PURE__ */ new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getCurrentTimeString() {
  const now = /* @__PURE__ */ new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

// src/settings/settings-ui.ts
var import_obsidian7 = require("obsidian");

// src/settings/folder-picker.ts
var import_obsidian6 = require("obsidian");
function openFilePicker(app, onChoose) {
  if (typeof import_obsidian6.FuzzySuggestModal !== "function") {
    new import_obsidian6.Notice("File picker is not available in this Obsidian version.");
    return;
  }
  new FileSuggestModal(app, onChoose).open();
}
var FileSuggestModal = class extends import_obsidian6.FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Select a file");
  }
  getItems() {
    return this.app.vault.getAllLoadedFiles().filter((file) => file instanceof import_obsidian6.TFile).map((file) => file.path).sort((left, right) => left.localeCompare(right));
  }
  getItemText(filePath) {
    return filePath;
  }
  onChooseItem(filePath) {
    void this.onChoose(filePath);
  }
};
function openFolderPicker(app, onChoose) {
  if (typeof import_obsidian6.FuzzySuggestModal !== "function") {
    new import_obsidian6.Notice("Folder picker is not available in this Obsidian version.");
    return;
  }
  new FolderSuggestModal(app, onChoose).open();
}
var FolderSuggestModal = class extends import_obsidian6.FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Select a folder");
  }
  getItems() {
    const folders = this.app.vault.getAllLoadedFiles().filter((file) => file instanceof import_obsidian6.TFolder).map((folder) => folder.path).sort((left, right) => left.localeCompare(right));
    return ["", ...folders];
  }
  getItemText(folderPath) {
    return folderPath || "/";
  }
  onChooseItem(folderPath) {
    void this.onChoose(folderPath);
  }
};

// src/settings/settings-field-definitions.ts
function getFolderSettingConfigs(settings) {
  return [
    {
      name: "Projects Folder",
      description: "Folder scanned recursively by the Process Tasks command.",
      key: "projectsFolder",
      value: settings.projectsFolder,
      placeholder: "Projects"
    },
    {
      name: "Completed Projects Folder",
      description: "Destination folder for completed projects.",
      key: "completedProjectsFolder",
      value: settings.completedProjectsFolder,
      placeholder: "Projects/Completed"
    },
    {
      name: "Waiting Projects Folder",
      description: "Destination folder for waiting projects.",
      key: "waitingProjectsFolder",
      value: settings.waitingProjectsFolder,
      placeholder: "Projects/Waiting"
    },
    {
      name: "Someday-Maybe Projects Folder",
      description: "Destination folder for someday-maybe projects.",
      key: "somedayMaybeProjectsFolder",
      value: settings.somedayMaybeProjectsFolder,
      placeholder: "Projects/Someday-Maybe"
    },
    {
      name: "Inbox File",
      description: "Path to the inbox file (used for Inbox section in dashboard).",
      key: "inboxFile",
      value: settings.inboxFile,
      placeholder: "Inbox.md"
    },
    {
      name: "Tasks Summary File",
      description: "Path to the markdown file written by the Tasks Summary command.",
      key: "tasksSummaryFile",
      value: settings.tasksSummaryFile,
      placeholder: "Tasks Summary.md"
    }
  ];
}
function getTextSettingConfigs(settings) {
  return [
    {
      name: "Next Action Tag",
      description: "Tag added to the active next task.",
      placeholder: "#next-action",
      key: "nextActionTag",
      value: settings.nextActionTag
    },
    {
      name: "Completed Status Field",
      description: "Frontmatter field updated when the file has no remaining incomplete tasks.",
      placeholder: "status",
      key: "statusField",
      value: settings.statusField
    },
    {
      name: "Dashboard Filename Hide Keywords",
      description: 'Comma-separated list of keywords to remove from filenames shown in the date dashboard (e.g. "2024, draft, archive").',
      placeholder: "e.g. draft, archive, 2024",
      key: "dashboardHideKeywords",
      value: settings.dashboardHideKeywords,
      multiLine: false
    }
  ];
}
function getToggleSettingConfigs(settings) {
  return [
    {
      name: "Open Tasks Summary After Generation",
      description: "Open the Tasks Summary file automatically after the Tasks Summary command finishes.",
      key: "openSummaryAfterGeneration",
      value: settings.openSummaryAfterGeneration
    }
  ];
}

// src/settings/settings-ui.ts
var TaskManagerSettingTabRenderer = class {
  constructor(baseSettingTab, plugin) {
    this.baseSettingTab = baseSettingTab;
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this.baseSettingTab;
    const settings = this.plugin.getSettings();
    containerEl.empty();
    for (const folderSetting of getFolderSettingConfigs(settings)) {
      this.addFolderSetting(containerEl, folderSetting);
    }
    for (const textSetting of getTextSettingConfigs(settings)) {
      this.addTextSetting(containerEl, textSetting);
    }
    for (const toggleSetting of getToggleSettingConfigs(settings)) {
      this.addToggleSetting(containerEl, toggleSetting);
    }
  }
  addFolderSetting(containerEl, config) {
    const isFilePathSetting = config.key === "inboxFile" || config.key === "tasksSummaryFile";
    new import_obsidian7.Setting(containerEl).setName(config.name).setDesc(`${config.description} Use Browse to pick a vault ${isFilePathSetting ? "file" : "path"}.`).addText((text) => {
      this.configureFolderTextInput(text, config.key, config.value, config.placeholder);
    }).addButton((button) => {
      button.setButtonText("Browse").onClick(() => {
        if (isFilePathSetting) {
          openFilePicker(this.baseSettingTab.app, async (selectedFilePath) => {
            await this.plugin.updateSetting(config.key, selectedFilePath);
            this.display();
          });
        } else {
          openFolderPicker(this.baseSettingTab.app, async (selectedFolderPath) => {
            await this.plugin.updateSetting(config.key, selectedFolderPath);
            this.display();
          });
        }
      });
    });
  }
  addTextSetting(containerEl, config) {
    const setting = new import_obsidian7.Setting(containerEl).setName(config.name).setDesc(config.description);
    if (config.multiLine) {
      setting.addTextArea((textArea) => {
        textArea.setPlaceholder(config.placeholder).setValue(config.value).onChange(async (value) => {
          await this.plugin.updateSetting(config.key, value);
        });
      });
    } else {
      setting.addText((text) => {
        text.setPlaceholder(config.placeholder).setValue(config.value).onChange(async (value) => {
          await this.plugin.updateSetting(config.key, value);
        });
      });
    }
  }
  addToggleSetting(containerEl, config) {
    new import_obsidian7.Setting(containerEl).setName(config.name).setDesc(config.description).addToggle((toggle) => {
      toggle.setValue(config.value).onChange(async (value) => {
        await this.plugin.updateSetting(config.key, value);
      });
    });
  }
  configureFolderTextInput(text, settingKey, folderPath, placeholder) {
    text.setPlaceholder(placeholder).setValue(folderPath).onChange(async (value) => {
      await this.plugin.updateSetting(settingKey, value);
    });
  }
};

// src/tasks/task-processor.ts
var import_obsidian9 = require("obsidian");

// src/tasks/task-utils.ts
var TASK_LINE_REGEX3 = /^(\s*[-*+]\s+\[( |x|X)\]\s+)(.*)$/;
function extractTaskState(content, nextActionTag) {
  const lines = content.split(/\r?\n/);
  const taskState = [];
  function getTaskStatus(checkboxChar) {
    const char = checkboxChar.toLowerCase();
    if (char === "x") return "completed";
    return "open";
  }
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX3);
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
    const match = lines[index].match(TASK_LINE_REGEX3);
    if (match && match[2].toLowerCase() !== "x") {
      return index;
    }
  }
  return findFirstIncompleteTaskLine(lines);
}
function findFirstIncompleteTaskLine(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX3);
    if (match && match[2].toLowerCase() !== "x") {
      return index;
    }
  }
  return null;
}
function stripNextActionTags(lines, nextActionTag) {
  return lines.map((line) => {
    if (!lineHasTag(line, nextActionTag) || !line.match(TASK_LINE_REGEX3)) {
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
var COMPLETED_SECTION_HEADER = "## Completed Tasks";
function moveTaskToCompletedSection(lines, taskLineIndex) {
  if (isLineInCompletedSection(lines, taskLineIndex)) {
    return lines;
  }
  const taskLine = lines[taskLineIndex];
  const result = [...lines];
  result.splice(taskLineIndex, 1);
  const sectionIdx = result.findIndex((l) => l.trim() === COMPLETED_SECTION_HEADER);
  if (sectionIdx !== -1) {
    let insertAt = sectionIdx + 1;
    for (let i = sectionIdx + 1; i < result.length; i++) {
      if (/^#{1,2}\s/.test(result[i])) break;
      if (result[i].trim() !== "") insertAt = i + 1;
    }
    result.splice(insertAt, 0, taskLine);
  } else {
    if (result.length > 0 && result[result.length - 1].trim() !== "") {
      result.push("");
    }
    result.push(COMPLETED_SECTION_HEADER);
    result.push(taskLine);
  }
  return result;
}
function isLineInCompletedSection(lines, lineIndex) {
  let inSection = false;
  for (let i = 0; i < lineIndex; i++) {
    if (lines[i].trim() === COMPLETED_SECTION_HEADER) {
      inSection = true;
    } else if (inSection && /^#{1,2}\s/.test(lines[i])) {
      inSection = false;
    }
  }
  return inSection;
}
function resetTaskContent(content) {
  const lines = content.split(/\r?\n/);
  let changed = false;
  let taskCount = 0;
  const nextLines = lines.map((line) => {
    const match = line.match(TASK_LINE_REGEX3);
    if (!match) {
      return line;
    }
    taskCount += 1;
    const openPrefix = match[1].replace(/\[( |x|X)\]/, "[ ]");
    const cleanedBody = stripResetTaskFields(match[3]);
    const nextLine = `${openPrefix}${cleanedBody}`.trimEnd();
    if (nextLine !== line) {
      changed = true;
    }
    return nextLine;
  });
  return {
    content: nextLines.join("\n"),
    taskCount,
    changed
  };
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
function stripResetTaskFields(taskBody) {
  return taskBody.replace(/\s*\[(?:due|completion-date|completion-time|created|priority)::\s*[^\]]*\]/gi, "").replace(/\s{2,}/g, " ").trimEnd();
}

// src/routing/status-routing.ts
var ROUTABLE_STATUSES = ["todo", "completed", "waiting", "someday-maybe"];
function isRoutableStatus(value) {
  return ROUTABLE_STATUSES.includes(value);
}
function readStatusValue(content, statusField) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return null;
  }
  const fieldRegex = new RegExp(`^\\s*${escapeRegExp2(statusField)}\\s*:\\s*(.*?)\\s*$`, "i");
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
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/tasks/due-date-modal.ts
var import_obsidian8 = require("obsidian");
var spacingStyles = {
  description: { marginBottom: "20px" },
  taskPreview: {
    marginBottom: "16px",
    padding: "10px",
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "6px",
    backgroundColor: "var(--background-secondary)"
  },
  section: { marginBottom: "15px" },
  label: {
    display: "block",
    marginBottom: "8px",
    fontWeight: "bold"
  }
};
var inputStyles = {
  width: "100%",
  padding: "8px",
  boxSizing: "border-box",
  marginBottom: "10px"
};
var suggestionsGridStyles = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "8px",
  marginBottom: "15px"
};
var actionRowStyles = {
  display: "flex",
  gap: "10px",
  justifyContent: "flex-end"
};
var buttonStyles = {
  base: {
    padding: "8px 16px",
    cursor: "pointer"
  },
  primary: {
    backgroundColor: "#4CAF50",
    color: "white",
    border: "none",
    borderRadius: "4px"
  },
  secondary: {
    backgroundColor: "#f0f0f0",
    border: "1px solid #000",
    borderRadius: "4px"
  },
  suggestion: {
    padding: "8px",
    cursor: "pointer"
  }
};
var DueDateModal = class extends import_obsidian8.Modal {
  constructor(options) {
    super(options.app);
    this.dateSuggestions = buildDateSuggestions();
    this.inputElement = null;
    this.prioritySelectElement = null;
    this.taskLine = options.taskLine;
    this.onSubmit = options.onSubmit;
  }
  onOpen() {
    var _a;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Add Due Date" });
    this.createDescription(contentEl);
    this.createTaskPreview(contentEl);
    this.createPrioritySection(contentEl);
    this.createInputSection(contentEl);
    this.createSuggestionsSection(contentEl);
    this.createActionButtons(contentEl);
    (_a = this.prioritySelectElement) == null ? void 0 : _a.focus();
  }
  createDescription(container) {
    const description = container.createEl("p", {
      text: "Would you like to add a due date for this task?"
    });
    applyStyles(description, spacingStyles.description);
  }
  createTaskPreview(container) {
    const taskPreview = container.createEl("div");
    applyStyles(taskPreview, spacingStyles.taskPreview);
    const taskLabel = taskPreview.createEl("strong", { text: "Task:" });
    taskLabel.style.display = "block";
    taskLabel.style.marginBottom = "4px";
    taskPreview.createEl("span", {
      text: this.getTaskDisplayText()
    });
  }
  getTaskDisplayText() {
    const withoutTaskPrefix = this.taskLine.replace(/^\s*[-*+]\s+\[[^\]]\]\s*/, "").trim();
    return withoutTaskPrefix.length > 0 ? withoutTaskPrefix : this.taskLine.trim();
  }
  createInputSection(container) {
    const inputContainer = container.createEl("div");
    applyStyles(inputContainer, spacingStyles.section);
    this.createSectionLabel(inputContainer, "Due Date (YYYY-MM-DD or natural language):");
    const listId = `task-manager-due-date-options-${Date.now()}`;
    const dateList = inputContainer.createEl("datalist");
    dateList.id = listId;
    for (const suggestion of this.dateSuggestions) {
      dateList.createEl("option", {
        value: suggestion.value
      });
      dateList.createEl("option", {
        value: suggestion.label.toLowerCase()
      });
    }
    this.inputElement = inputContainer.createEl("input", {
      type: "text",
      placeholder: "e.g., 2026-03-20, today, tomorrow, monday"
    });
    this.inputElement.setAttribute("list", listId);
    this.inputElement.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      void this.submitDate();
    });
    applyStyles(this.inputElement, inputStyles);
  }
  createPrioritySection(container) {
    const priorityContainer = container.createEl("div");
    applyStyles(priorityContainer, spacingStyles.section);
    this.createSectionLabel(priorityContainer, "Priority:");
    const selectElement = priorityContainer.createEl("select");
    applyStyles(selectElement, inputStyles);
    ["1", "2", "3"].forEach((priority) => {
      const option = selectElement.createEl("option", {
        text: priority,
        value: priority
      });
      if (priority === "3") {
        option.selected = true;
      }
    });
    this.prioritySelectElement = selectElement;
  }
  createSuggestionsSection(container) {
    this.createSectionLabel(container, "Suggested Dates:");
    const suggestionsContainer = container.createEl("div");
    applyStyles(suggestionsContainer, suggestionsGridStyles);
    for (const suggestion of this.dateSuggestions.slice(0, 10)) {
      const button = suggestionsContainer.createEl("button", {
        text: `${suggestion.value} (${suggestion.label})`
      });
      applyStyles(button, buttonStyles.suggestion);
      button.onclick = () => {
        if (this.inputElement) {
          this.inputElement.value = suggestion.value;
        }
        void this.submitDate(suggestion.value);
      };
    }
  }
  createActionButtons(container) {
    const buttonContainer = container.createEl("div");
    applyStyles(buttonContainer, actionRowStyles);
    const addButton = buttonContainer.createEl("button", { text: "Add Due Date" });
    applyStyles(addButton, buttonStyles.base);
    applyStyles(addButton, buttonStyles.primary);
    addButton.onclick = () => {
      void this.submitDate();
    };
    const skipButton = buttonContainer.createEl("button", { text: "Skip" });
    applyStyles(skipButton, buttonStyles.base);
    applyStyles(skipButton, buttonStyles.secondary);
    skipButton.onclick = () => {
      this.close();
    };
  }
  createSectionLabel(container, text) {
    const label = container.createEl("label");
    label.textContent = text;
    applyStyles(label, spacingStyles.label);
    return label;
  }
  async submitDate(dateOverride) {
    var _a, _b, _c, _d;
    const dateValue = (_b = dateOverride != null ? dateOverride : (_a = this.inputElement) == null ? void 0 : _a.value.trim()) != null ? _b : "";
    const priority = (_d = (_c = this.prioritySelectElement) == null ? void 0 : _c.value) != null ? _d : "3";
    if (!dateValue) {
      return;
    }
    const resolvedDate = resolveDateInput(dateValue);
    if (!resolvedDate) {
      new import_obsidian8.Notice("Enter YYYY-MM-DD or a natural date like today, tomorrow, or a weekday.");
      return;
    }
    try {
      await this.onSubmit(this.taskLine, resolvedDate, priority);
      this.close();
    } catch (error) {
      console.error("Failed to add due date:", error);
    }
  }
};
function applyStyles(element, styles) {
  Object.assign(element.style, styles);
}

// src/tasks/repeat-rules.ts
var REPEAT_FIELD_REGEX3 = /\[(?:repeat|repeats)::\s*(?:every\s+)?([^\]]+?)\s*\]/i;
var COUNT_AND_KEYWORD_REGEX = /^(\d+)\s+([a-z-]+)$/i;
var KEYWORD_ONLY_REGEX = /^([a-z-]+)$/i;
var REPEAT_KEYWORD_TO_UNIT = {
  day: "day",
  days: "day",
  daily: "day",
  week: "week",
  weeks: "week",
  weekly: "week",
  month: "month",
  months: "month",
  monthly: "month",
  year: "year",
  years: "year",
  yearly: "year"
};
var WEEKDAY_KEYWORD_TO_INDEX = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6
};
function parseRepeatRule(line) {
  const fieldMatch = line.match(REPEAT_FIELD_REGEX3);
  if (!fieldMatch) {
    return null;
  }
  return parseRepeatExpression(fieldMatch[1]);
}
function getRepeatDueDate(rule, baseDate = /* @__PURE__ */ new Date()) {
  switch (rule.kind) {
    case "interval":
      switch (rule.unit) {
        case "day":
          return formatDate2(addDays2(baseDate, rule.interval));
        case "week":
          return formatDate2(addDays2(baseDate, rule.interval * 7));
        case "month":
          return formatDate2(addMonthsClamped(baseDate, rule.interval));
        case "year":
          return formatDate2(addMonthsClamped(baseDate, rule.interval * 12));
      }
    case "weekday":
      return formatDate2(getNextWeekday(baseDate, rule.weekday));
    case "month-day":
      return formatDate2(getNextMonthDay(baseDate, rule.dayOfMonth));
  }
}
function parseRepeatExpression(expression) {
  const normalized = expression.trim().toLowerCase();
  const countedMatch = normalized.match(COUNT_AND_KEYWORD_REGEX);
  if (countedMatch) {
    const interval = Number.parseInt(countedMatch[1], 10);
    const unit = REPEAT_KEYWORD_TO_UNIT[countedMatch[2]];
    if (!Number.isFinite(interval) || interval < 1 || !unit) {
      return null;
    }
    return { kind: "interval", interval, unit };
  }
  const keywordMatch = normalized.match(KEYWORD_ONLY_REGEX);
  if (keywordMatch) {
    const intervalUnit = REPEAT_KEYWORD_TO_UNIT[keywordMatch[1]];
    if (intervalUnit) {
      return { kind: "interval", interval: 1, unit: intervalUnit };
    }
    const weekday = WEEKDAY_KEYWORD_TO_INDEX[keywordMatch[1]];
    if (weekday !== void 0) {
      return { kind: "weekday", weekday };
    }
    const ordinalDay = parseOrdinalDay(keywordMatch[1]);
    if (ordinalDay !== null) {
      return { kind: "month-day", dayOfMonth: ordinalDay };
    }
  }
  return null;
}
function addDays2(baseDate, days) {
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
function getNextWeekday(baseDate, weekday) {
  const currentWeekday = baseDate.getDay();
  const delta = (weekday - currentWeekday + 7) % 7 || 7;
  return addDays2(baseDate, delta);
}
function getNextMonthDay(baseDate, dayOfMonth) {
  const currentDay = baseDate.getDate();
  if (currentDay < dayOfMonth) {
    return buildMonthDayDate(baseDate.getFullYear(), baseDate.getMonth(), dayOfMonth);
  }
  const nextMonth = addMonthsClamped(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1), 1);
  return buildMonthDayDate(nextMonth.getFullYear(), nextMonth.getMonth(), dayOfMonth);
}
function buildMonthDayDate(year, month, dayOfMonth) {
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(dayOfMonth, lastDayOfMonth));
}
function parseOrdinalDay(value) {
  const match = value.match(/^([1-9]|[12][0-9]|3[01])(st|nd|rd|th)$/);
  if (!match) {
    return null;
  }
  const day = Number.parseInt(match[1], 10);
  return Number.isFinite(day) ? day : null;
}
function formatDate2(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// src/tasks/reconciler.ts
function isInProjectsFolder(filePath, projectsFolder) {
  return filePath === projectsFolder || filePath.startsWith(`${projectsFolder}/`);
}
async function showDueDateModalForNextAction(file, taskLineIndex, previousContent, updatedContent, context) {
  const { app, settings, readFile, writeFileContent, setTaskState } = context;
  if (!app) {
    return;
  }
  const lines = updatedContent.split(/\r?\n/);
  const taskLine = lines[taskLineIndex];
  if (!taskLine) {
    return;
  }
  const previousLines = previousContent.split(/\r?\n/);
  if (previousLines.includes(taskLine)) {
    return;
  }
  const isRepeating = parseRepeatRule(taskLine) !== null;
  if (isRepeating) {
    return;
  }
  if (taskLine.includes("[due::")) {
    return;
  }
  const modal = new DueDateModal({
    app,
    taskLine,
    onSubmit: async (taskLine2, dueDate, priority) => {
      if (!isValidDateFormat(dueDate)) {
        return;
      }
      const currentContent = await readFile(file);
      const updatedLines = currentContent.split(/\r?\n/);
      let taskFound = false;
      for (let i = 0; i < updatedLines.length; i++) {
        if (updatedLines[i] === taskLine2) {
          if (updatedLines[i].includes("[due::")) {
            updatedLines[i] = updatedLines[i].replace(/\[due::\s*[^\]]*\]/g, `[due:: ${dueDate}]`);
          } else {
            updatedLines[i] = `${updatedLines[i].trimEnd()} [due:: ${dueDate}]`;
          }
          if (updatedLines[i].includes("[priority::")) {
            updatedLines[i] = updatedLines[i].replace(/\[priority::\s*[^\]]*\]/g, `[priority:: ${priority}]`);
          } else {
            updatedLines[i] = `${updatedLines[i].trimEnd()} [priority:: ${priority}]`;
          }
          taskFound = true;
          break;
        }
      }
      if (taskFound) {
        await writeFileContent(file, updatedLines.join("\n"));
        setTaskState(file.path, extractTaskState(updatedLines.join("\n"), settings.nextActionTag));
      }
    }
  });
  modal.open();
}
async function applyCompletionRules(context) {
  const { file, content, completedLine, settings, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  const nextLines = [...lines];
  const sourceTaskLine = lines[completedLine];
  let completedLineIndex = completedLine;
  const repeatRule = parseRepeatRule(sourceTaskLine);
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
  let workingLines = cleanedLines;
  if (nextTaskLine !== null) {
    workingLines = addNextActionTag(cleanedLines, nextTaskLine, settings.nextActionTag).split(/\r?\n/);
  }
  const stampedLine = workingLines[completedLineIndex];
  const actualCompletedLineIndex = workingLines.indexOf(stampedLine, completedLineIndex);
  if (actualCompletedLineIndex !== -1) {
    workingLines = moveTaskToCompletedSection(workingLines, actualCompletedLineIndex);
  }
  const updatedContent = workingLines.join("\n");
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }
  await setFileStatus(file, newStatus);
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
  if (nextTaskLine !== null) {
    const nextTaskLineInFinal = findFirstIncompleteTaskLine(workingLines);
    if (nextTaskLineInFinal !== null) {
      await showDueDateModalForNextAction(file, nextTaskLineInFinal, content, updatedContent, context);
    }
  }
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
  await showDueDateModalForNextAction(file, uncompletedLine, content, updatedContent, context);
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
  await showDueDateModalForNextAction(file, previousTaskLine, content, updatedContent, context);
}
async function reconcileFile(context) {
  const { file, settings, readFile, writeFileContent, setFileStatus, setTaskState } = context;
  const content = await readFile(file);
  const currentStatus = readStatusValue(content, settings.statusField);
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*[-*+]\s+\[)( |x|X)(\]\s*.*)$/);
    if (!match) {
      return line;
    }
    if (match[2].toLowerCase() === "x") {
      return line;
    }
    return stripCompletionFields(line);
  });
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
  if (firstIncompleteTaskLine !== null) {
    await showDueDateModalForNextAction(file, firstIncompleteTaskLine, content, updatedContent, context);
  }
}
async function processProjectsFolder(context) {
  const { settings } = context;
  const activeFolders = [
    settings.projectsFolder,
    settings.completedProjectsFolder,
    settings.waitingProjectsFolder,
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
  const now = /* @__PURE__ */ new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
function isValidDateFormat(dateStr) {
  const trimmed = dateStr.trim();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(trimmed)) {
    return false;
  }
  const date = /* @__PURE__ */ new Date(trimmed + "T00:00:00Z");
  return !isNaN(date.getTime());
}

// src/tasks/task-state-store.ts
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

// src/tasks/task-processor.ts
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
      const content = await this.app.vault.read(file);
      this.stateStore.setTaskState(file.path, extractTaskState(content, settings.nextActionTag));
      this.stateStore.setStatus(file.path, readStatusValue(content, settings.statusField));
    }
  }
  async handleFileCreate(file) {
    if (file.extension !== "md") {
      return;
    }
    const settings = this.getSettings();
    const content = await this.app.vault.read(file);
    this.stateStore.setTaskState(file.path, extractTaskState(content, settings.nextActionTag));
    this.stateStore.setStatus(file.path, readStatusValue(content, settings.statusField));
  }
  async handleFileModify(file) {
    if (file.extension !== "md" || this.stateStore.isPending(file.path)) {
      return;
    }
    const settings = this.getSettings();
    const content = await this.app.vault.read(file);
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
      return "No active file.";
    }
    const settings = this.getSettings();
    const taskFolderRoots = getTaskFolderRoots(settings);
    const inProjectsFolder = taskFolderRoots.some((root) => file.path.startsWith(`${root}/`) || file.path === root);
    if (!inProjectsFolder) {
      return "";
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
  async resetCurrentFileTasks() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      throw new Error("No active file.");
    }
    const settings = this.getSettings();
    const initialContent = await this.app.vault.read(file);
    const resetResult = resetTaskContent(initialContent);
    if (!resetResult.changed) {
      return `No tasks needed reset in ${file.name}.`;
    }
    await this.writeFileContent(file, resetResult.content, settings);
    const processResult = await this.processAndRouteFile(file);
    return `Reset ${resetResult.taskCount} task${resetResult.taskCount === 1 ? "" : "s"} in ${file.name}. ${processResult}`;
  }
  async processAndRouteFile(file) {
    const settings = this.getSettings();
    const initialContent = await this.app.vault.read(file);
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
      app: this.app,
      readFile: (target) => this.app.vault.read(target),
      writeFileContent: (target, nextContent) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target, status) => this.setFileStatus(target, status, settings),
      setTaskState: (filePath, nextState) => {
        this.stateStore.setTaskState(filePath, nextState);
      }
    });
  }
  async routeAfterStatusChange(file, previousStatus, settings) {
    const latestContent = await this.app.vault.read(file);
    const latestStatus = readStatusValue(latestContent, settings.statusField);
    this.stateStore.setStatus(file.path, latestStatus);
    if (latestStatus === previousStatus) {
      return;
    }
    try {
      assertConfiguredDestinationForStatus(latestStatus, settings);
      await this.routeFileByStatus(file, settings, latestStatus);
    } catch (error) {
      new import_obsidian9.Notice(error instanceof Error ? error.message : "Failed to route file after status change.");
    }
  }
  async routeFileByStatus(file, settings, statusOverride) {
    const status = statusOverride != null ? statusOverride : readStatusValue(await this.app.vault.read(file), settings.statusField);
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
    if (destinationEntry instanceof import_obsidian9.TFolder) {
      throw new Error(`Cannot move '${file.path}' because '${destinationPath}' is a folder.`);
    }
    if (destinationEntry instanceof import_obsidian9.TFile) {
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
    const destinationContent = await this.app.vault.read(destinationFile);
    const sourceContent = await this.app.vault.read(sourceFile);
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
      app: this.app,
      readFile: (target) => this.app.vault.read(target),
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
      app: this.app,
      readFile: (target) => this.app.vault.read(target),
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
      app: this.app,
      readFile: (target) => this.app.vault.read(target),
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
        if (status === "completed") {
          frontmatter["completion-date"] = getCompletionDateString();
          frontmatter["completion-time"] = getCompletionTimeString();
        } else {
          delete frontmatter["completion-date"];
          delete frontmatter["completion-time"];
        }
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
var TaskManagerPlugin = class extends import_obsidian10.Plugin {
  constructor() {
    super(...arguments);
    this.taskProcessor = null;
    this.dateDashboard = null;
    this.dueDateSuggest = null;
    this.createdDateSuggest = null;
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
      getTaskFolderRoots: () => this.getTaskFolderRoots(),
      getInboxFile: () => this.settings.inboxFile,
      getHideKeywords: () => this.settings.dashboardHideKeywords
    });
    this.dueDateSuggest = new DueDateEditorSuggest(this.app);
    this.createdDateSuggest = new CreatedDateEditorSuggest(this.app);
    this.registerEditorSuggest(this.dueDateSuggest);
    this.registerEditorSuggest(this.createdDateSuggest);
    this.addSettingTab(new BaseTaskManagerSettingTab(this.app, this));
    registerTaskCommands(this, {
      processTasks: () => {
        void this.runProcessTasks();
      },
      processCurrentFile: () => {
        void this.runProcessCurrentFile();
      },
      resetCurrentFileTasks: () => {
        void this.runResetCurrentFileTasks();
      },
      createTasksSummary: () => {
        this.runCreateTasksSummary();
      }
    });
    this.registerEvent(this.app.vault.on("create", (file) => {
      var _a;
      if (!(file instanceof import_obsidian10.TFile)) {
        return;
      }
      void ((_a = this.taskProcessor) == null ? void 0 : _a.handleFileCreate(file));
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      var _a;
      if (!(file instanceof import_obsidian10.TFile)) {
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
    this.dueDateSuggest = null;
    this.createdDateSuggest = null;
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
      new import_obsidian10.Notice(result);
    } catch (error) {
      new import_obsidian10.Notice(error instanceof Error ? error.message : "Failed to Process File.");
    }
  }
  async runProcessTasks() {
    try {
      const result = await this.taskProcessor.processTasks();
      new import_obsidian10.Notice(result);
    } catch (error) {
      new import_obsidian10.Notice(error instanceof Error ? error.message : "Failed to process tasks.");
    }
  }
  async runResetCurrentFileTasks() {
    try {
      const result = await this.taskProcessor.resetCurrentFileTasks();
      new import_obsidian10.Notice(result);
    } catch (error) {
      new import_obsidian10.Notice(error instanceof Error ? error.message : "Failed to reset tasks.");
    }
  }
  async runCreateTasksSummary() {
    const settings = this.getSettings();
    if (!settings.tasksSummaryFile) {
      new import_obsidian10.Notice("Set Tasks Summary File in plugin settings before running Tasks Summary.");
      return;
    }
    try {
      const writtenPath = await writeTasksSummary(this.app, settings, settings.tasksSummaryFile);
      if (settings.openSummaryAfterGeneration) {
        const summaryFile = this.app.vault.getAbstractFileByPath(writtenPath);
        if (summaryFile instanceof import_obsidian10.TFile) {
          await this.app.workspace.getLeaf(true).openFile(summaryFile);
        }
      }
      new import_obsidian10.Notice(`Tasks Summary written to ${writtenPath}.`);
    } catch (error) {
      new import_obsidian10.Notice(error instanceof Error ? error.message : "Failed to create Tasks Summary.");
    }
  }
  getTaskFolderRoots() {
    return getTaskFolderRoots(this.settings);
  }
};
var BaseTaskManagerSettingTab = class extends import_obsidian10.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.renderer = new TaskManagerSettingTabRenderer(this, plugin);
  }
  display() {
    this.renderer.display();
  }
};
