/**
 * Purpose:
 * - compose and bootstrap Task Manager services at plugin startup.
 *
 * Responsibilities:
 * - bootstraps long-lived plugin services (task processor, dashboard controller, editor suggest)
 * - loads and persists normalized plugin settings
 * - wires command registration and file-modify event handling
 * - coordinates lifecycle transitions through onload/onunload
 *
 * Dependencies:
 * - composes feature modules from src/*
 * - Obsidian Plugin API for lifecycle/events/commands
 *
 * Side Effects:
 * - registers commands/events/views and writes persisted plugin settings
 */
import { App, Notice, Plugin, PluginSettingTab, TFile } from "obsidian";
import { registerTaskCommands } from "./src/commands/register-task-commands";
import { runCreateTasksSummary } from "./src/bases/create-tasks-summary";
import { AddProjectInput, AddProjectModal, buildProjectFileContent, buildProjectFilePath } from "./src/projects/add-project-modal";
import { DateDashboardController } from "./src/dashboard/date-dashboard";
import { CreatedDateEditorSuggest, DueDateEditorSuggest } from "./src/editor/due-date-suggest";
import { getSomedayMaybeProjectFiles, pickRandomFile } from "./src/projects/random-project";
import { ProjectsSummaryController } from "./src/review/projects-summary-view";
import { stampReviewedDate } from "./src/review/projects-summary-data";
import { normalizeSettings, TaskManagerSettings } from "./src/settings/settings-utils";
import { QuickCaptureModal } from "./src/tasks/quick-capture-modal";
import { CapturedTasksController } from "./src/journal/captured-tasks-view";
import { DAILY_NOTE_TASKS_HEADER, getDailyNotePathForToday } from "./src/journal/daily-note-config";
import { TaskManagerSettingTabRenderer } from "./src/settings/settings-ui";
import { ensureParentFoldersExist, getSurfacedTaskFolderRoots } from "./src/routing/task-routing";
import { TaskProcessor } from "./src/tasks/task-processor";
import { getTodayDateString } from "./src/date/date-utils";

export default class TaskManagerPlugin extends Plugin {
  private taskProcessor: TaskProcessor | null = null;
  private dateDashboard: DateDashboardController | null = null;
  private projectsSummary: ProjectsSummaryController | null = null;
  private capturedTasks: CapturedTasksController | null = null;
  private dueDateSuggest: DueDateEditorSuggest | null = null;
  private createdDateSuggest: CreatedDateEditorSuggest | null = null;

  private pluginSettings: TaskManagerSettings = normalizeSettings({});

  async onload(): Promise<void> {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.taskProcessor = new TaskProcessor({
      app: this.app,
      getSettings: () => this.getSettings(),
      onFileStatusChanged: async () => {
        this.capturedTasks?.refreshSoon();
      },
      onTaskPropertiesChanged: async () => {
        this.capturedTasks?.refreshSoon();
      },
    });
    this.dateDashboard = new DateDashboardController({
      app: this.app,
      getTaskFolderRoots: () => getSurfacedTaskFolderRoots(this.pluginSettings),
      getHideKeywords: () => this.pluginSettings.dashboardHideKeywords,
      openCapturedTasksView: () => {
        void this.capturedTasks?.openView();
      },
    });
    this.capturedTasks = new CapturedTasksController({
      app: this.app,
      getSettings: () => this.getSettings(),
      createProject: (input) => this.createProjectFile(input),
    });
    this.projectsSummary = new ProjectsSummaryController({
      app: this.app,
      getSettings: () => this.getSettings(),
    });
    this.dueDateSuggest = new DueDateEditorSuggest(this.app);
    this.createdDateSuggest = new CreatedDateEditorSuggest(this.app);
    this.registerEditorSuggest(this.dueDateSuggest);
    this.registerEditorSuggest(this.createdDateSuggest);
    this.addSettingTab(new BaseTaskManagerSettingTab(this.app, this));
    registerTaskCommands(this, {
      resetCurrentFileTasks: () => {
        void this.runResetCurrentFileTasks();
      },
      organizeCapturedTasks: () => {
        void this.capturedTasks?.openView();
      },
      addNewProject: () => {
        this.runAddNewProject();
      },
      openRandomSomedayMaybeProject: () => {
        void this.runOpenRandomSomedayMaybeProject();
      },
      quickCapture: () => {
        this.runQuickCapture();
      },
      openProjectsSummary: () => {
        void this.projectsSummary?.openView();
      },
      backfillWaitingSince: () => {
        void this.runBackfillWaitingSince();
      },
      backfillDerivedFrontmatter: () => {
        void this.runBackfillDerivedFrontmatter();
      },
      createTasksSummary: () => {
        void runCreateTasksSummary(this.app, this.getSettings());
      },
    });
    this.addRibbonIcon("shuffle", "Open Random Someday-Maybe Project", () => {
      void this.runOpenRandomSomedayMaybeProject();
    });
    this.addRibbonIcon("list-plus", "Quick Capture Task", () => {
      this.runQuickCapture();
    });
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }

      void this.taskProcessor?.handleFileCreate(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }

      void this.taskProcessor?.handleFileModify(file);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile)) {
        return;
      }

      this.taskProcessor?.handleFileRename(file, oldPath);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }

      this.taskProcessor?.handleFileDelete(file);
    }));
    this.projectsSummary.onload(this);
    await this.taskProcessor.primeState();
    await this.taskProcessor.checkScheduledPromotions();
    await this.dateDashboard.onload(this);
    await this.capturedTasks.onload(this);
  }

  onunload(): void {
    this.taskProcessor?.onunload();
    this.taskProcessor = null;
    this.dateDashboard?.onunload();
    this.dateDashboard = null;
    this.projectsSummary?.onunload();
    this.projectsSummary = null;
    this.capturedTasks?.onunload();
    this.capturedTasks = null;
    this.dueDateSuggest = null;
    this.createdDateSuggest = null;
    console.log("Unloading Task Manager plugin");
  }

  async loadSettings(): Promise<void> {
    const loadedData = await this.loadData() as Partial<TaskManagerSettings> | null;
    this.pluginSettings = normalizeSettings(loadedData ?? {});
  }

  async saveSettings(): Promise<void> {
    this.pluginSettings = normalizeSettings(this.pluginSettings);
    await this.saveData(this.pluginSettings);
    await this.taskProcessor?.primeState();
    this.dateDashboard?.refreshSoon();
  }

  getSettings(): TaskManagerSettings {
    return { ...this.pluginSettings };
  }

  async updateSetting<K extends keyof TaskManagerSettings>(key: K, value: TaskManagerSettings[K]): Promise<void> {
    this.pluginSettings[key] = value;
    await this.saveSettings();
  }

  private async runResetCurrentFileTasks(): Promise<void> {
    try {
      const result = await this.taskProcessor!.resetCurrentFileTasks();
      new Notice(result);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to reset tasks.");
    }
  }

  /**
   * Creates a project file from AddProjectModal's submitted input: resolves the
   * destination path, writes frontmatter/starter tasks, and primes the task-state store
   * via handleFileCreate() so subsequent reconciliation on this file has a baseline
   * snapshot. Shared by the "Add New Project" command and the "Organize Captured Tasks
   * into Projects" tab's "Create project from selected" action.
   */
  private async createProjectFile(input: AddProjectInput): Promise<TFile> {
    const settings = this.getSettings();
    const projectPath = buildProjectFilePath(input.folder, input.name);
    const existingEntry = this.app.vault.getAbstractFileByPath(projectPath);
    if (existingEntry) {
      throw new Error(`A file or folder already exists at '${projectPath}'.`);
    }

    await ensureParentFoldersExist(this.app, projectPath);
    const content = buildProjectFileContent(input, settings.statusField);
    const file = await this.app.vault.create(projectPath, content);
    await this.taskProcessor?.handleFileCreate(file);
    return file;
  }

  private runAddNewProject(): void {
    const settings = this.getSettings();
    const modal = new AddProjectModal({
      app: this.app,
      settings,
      onSubmit: async (input) => {
        const file = await this.createProjectFile(input);
        await this.app.workspace.getLeaf(true).openFile(file);
        new Notice(`Created ${file.path}.`);
      },
    });

    modal.open();
  }

  private runQuickCapture(): void {
    const dailyNotePath = getDailyNotePathForToday(this.app);
    if (!dailyNotePath) {
      new Notice("Enable and configure Obsidian's core Daily Notes plugin before capturing tasks.");
      return;
    }

    const modal = new QuickCaptureModal({
      app: this.app,
      onSubmit: async (result) => {
        const dueSuffix = result.dueDate ? ` [due:: ${result.dueDate}]` : "";
        const taskLine = `- [ ] ${result.text}${dueSuffix} [created:: ${getTodayDateString()}]`;

        const existingEntry = this.app.vault.getAbstractFileByPath(dailyNotePath);
        if (existingEntry instanceof TFile) {
          const content = await this.app.vault.read(existingEntry);
          await this.app.vault.modify(existingEntry, insertCapturedTaskLine(content, taskLine));
        } else if (existingEntry) {
          throw new Error(`'${dailyNotePath}' is a folder, not a file.`);
        } else {
          await ensureParentFoldersExist(this.app, dailyNotePath);
          await this.app.vault.create(dailyNotePath, insertCapturedTaskLine("", taskLine));
        }

        new Notice(`Captured: ${result.text}`);
      },
    });

    modal.open();
  }

  private async runOpenRandomSomedayMaybeProject(): Promise<void> {
    const settings = this.getSettings();
    if (!settings.somedayMaybeProjectsFolder) {
      new Notice("Set Someday-Maybe Projects Folder in plugin settings first.");
      return;
    }

    const file = pickRandomFile(getSomedayMaybeProjectFiles(this.app, settings));
    if (!file) {
      new Notice("No project files found in the Someday-Maybe Projects Folder.");
      return;
    }

    // Opening a random someday-maybe project doubles as a casual review: stamp it
    // reviewed so the Projects Summary's staleness tracking reflects this glance at it.
    await stampReviewedDate(this.app, file);
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  private async runBackfillWaitingSince(): Promise<void> {
    try {
      const result = await this.taskProcessor!.backfillWaitingSince();
      new Notice(result);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to stamp waiting-since.");
    }
  }

  private async runBackfillDerivedFrontmatter(): Promise<void> {
    try {
      const result = await this.taskProcessor!.backfillDerivedFrontmatter();
      new Notice(result);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to stamp derived fields.");
    }
  }

}

/**
 * Inserts a captured task under the daily note's "## Tasks" section, prepended
 * newest-first — creating that section if missing. A missing section is created at the
 * **end** of the file (not near the top, past frontmatter/title) so captures stay out of
 * the way of the note's own content; for a brand-new daily note (empty string) this is
 * simply the whole file.
 */
function insertCapturedTaskLine(content: string, taskLine: string): string {
  const lines = content.length > 0 ? content.split(/\r?\n/) : [];

  const tasksHeaderIndex = lines.findIndex((line) => line.trim() === DAILY_NOTE_TASKS_HEADER);
  if (tasksHeaderIndex !== -1) {
    lines.splice(tasksHeaderIndex + 1, 0, taskLine);
    return lines.join("\n");
  }

  if (lines.length === 0) {
    return [DAILY_NOTE_TASKS_HEADER, taskLine, ""].join("\n");
  }

  // Trim trailing blank lines so they don't stack with our own separator below.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  lines.push("", DAILY_NOTE_TASKS_HEADER, taskLine, "");
  return lines.join("\n");
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
