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
import { AddProjectModal, buildProjectFileContent, buildProjectFilePath } from "./src/projects/add-project-modal";
import { DateDashboardController } from "./src/dashboard/date-dashboard";
import { ContextEditorSuggest } from "./src/editor/context-suggest";
import { CreatedDateEditorSuggest, DueDateEditorSuggest } from "./src/editor/due-date-suggest";
import { getSomedayMaybeProjectFiles, pickRandomFile } from "./src/projects/random-project";
import { ProjectsSummaryController } from "./src/review/projects-summary-view";
import { stampReviewedDate } from "./src/review/projects-summary-data";
import { normalizeSettings, TaskManagerSettings } from "./src/settings/settings-utils";
import { parseContextList } from "./src/tasks/task-line-metadata";
import { QuickCaptureModal } from "./src/tasks/quick-capture-modal";
import { TasksSummaryController } from "./src/summary/tasks-summary-view";
import { TaskManagerSettingTabRenderer } from "./src/settings/settings-ui";
import { ensureParentFoldersExist, getSurfacedTaskFolderRoots } from "./src/routing/task-routing";
import { TaskProcessor } from "./src/tasks/task-processor";

export default class TaskManagerPlugin extends Plugin {
  private taskProcessor: TaskProcessor | null = null;
  private dateDashboard: DateDashboardController | null = null;
  private projectsSummary: ProjectsSummaryController | null = null;
  private tasksSummary: TasksSummaryController | null = null;
  private dueDateSuggest: DueDateEditorSuggest | null = null;
  private createdDateSuggest: CreatedDateEditorSuggest | null = null;
  private contextSuggest: ContextEditorSuggest | null = null;

  private settings: TaskManagerSettings = normalizeSettings({});

  async onload(): Promise<void> {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.taskProcessor = new TaskProcessor({
      app: this.app,
      getSettings: () => this.getSettings(),
      onFileStatusChanged: async () => {
        this.tasksSummary?.refreshSoon();
      },
      onTaskPropertiesChanged: async () => {
        this.tasksSummary?.refreshSoon();
      },
    });
    this.dateDashboard = new DateDashboardController({
      app: this.app,
      getTaskFolderRoots: () => getSurfacedTaskFolderRoots(this.settings),
      getInboxFile: () => this.settings.inboxFile,
      getHideKeywords: () => this.settings.dashboardHideKeywords,
      getKnownContexts: () => this.getKnownContexts(),
    });
    this.tasksSummary = new TasksSummaryController({
      app: this.app,
      getSettings: () => this.getSettings(),
      getKnownContexts: () => this.getKnownContexts(),
    });
    this.projectsSummary = new ProjectsSummaryController({
      app: this.app,
      getSettings: () => this.getSettings(),
    });
    this.dueDateSuggest = new DueDateEditorSuggest(this.app);
    this.createdDateSuggest = new CreatedDateEditorSuggest(this.app);
    this.contextSuggest = new ContextEditorSuggest(this.app, () => this.getKnownContexts());
    this.registerEditorSuggest(this.dueDateSuggest);
    this.registerEditorSuggest(this.createdDateSuggest);
    this.registerEditorSuggest(this.contextSuggest);
    this.addSettingTab(new BaseTaskManagerSettingTab(this.app, this));
    registerTaskCommands(this, {
      resetCurrentFileTasks: () => {
        void this.runResetCurrentFileTasks();
      },
      openTasksSummary: () => {
        void this.tasksSummary?.openView();
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
    this.tasksSummary.onload(this);
    await this.taskProcessor.primeState();
    await this.taskProcessor.checkScheduledPromotions();
    await this.dateDashboard.onload(this);
  }

  onunload(): void {
    this.taskProcessor?.onunload();
    this.taskProcessor = null;
    this.dateDashboard?.onunload();
    this.dateDashboard = null;
    this.projectsSummary?.onunload();
    this.projectsSummary = null;
    this.tasksSummary?.onunload();
    this.tasksSummary = null;
    this.dueDateSuggest = null;
    this.createdDateSuggest = null;
    this.contextSuggest = null;
    console.log("Unloading Task Manager plugin");
  }

  async loadSettings(): Promise<void> {
    const loadedData = await this.loadData() as Partial<TaskManagerSettings> | null;
    this.settings = normalizeSettings(loadedData ?? {});
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    await this.taskProcessor?.primeState();
    this.dateDashboard?.refreshSoon();
  }

  getSettings(): TaskManagerSettings {
    return { ...this.settings };
  }

  async updateSetting<K extends keyof TaskManagerSettings>(key: K, value: TaskManagerSettings[K]): Promise<void> {
    this.settings[key] = value;
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

  private runAddNewProject(): void {
    const settings = this.getSettings();
    const modal = new AddProjectModal({
      app: this.app,
      settings,
      onSubmit: async (input) => {
        const projectPath = buildProjectFilePath(input.folder, input.name);
        const existingEntry = this.app.vault.getAbstractFileByPath(projectPath);
        if (existingEntry) {
          throw new Error(`A file or folder already exists at '${projectPath}'.`);
        }

        await ensureParentFoldersExist(this.app, projectPath);
        const content = buildProjectFileContent(input, settings.statusField);
        const file = await this.app.vault.create(projectPath, content);
        await this.taskProcessor?.handleFileCreate(file);
        await this.app.workspace.getLeaf(true).openFile(file);
        new Notice(`Created ${projectPath}.`);
      },
    });

    modal.open();
  }

  private runQuickCapture(): void {
    const settings = this.getSettings();
    if (!settings.inboxFile) {
      new Notice("Set Inbox File in plugin settings before capturing tasks.");
      return;
    }

    const modal = new QuickCaptureModal({
      app: this.app,
      onSubmit: async (result) => {
        const dueSuffix = result.dueDate ? ` [due:: ${result.dueDate}]` : "";
        const contextSuffix = result.contexts.length > 0 ? ` [context:: ${result.contexts.join(", ")}]` : "";
        const taskLine = `- [ ] ${result.text}${dueSuffix}${contextSuffix}`;

        const existingEntry = this.app.vault.getAbstractFileByPath(settings.inboxFile);
        if (existingEntry instanceof TFile) {
          const content = await this.app.vault.read(existingEntry);
          await this.app.vault.modify(existingEntry, prependTaskLine(content, taskLine));
        } else if (existingEntry) {
          throw new Error(`'${settings.inboxFile}' is a folder, not a file.`);
        } else {
          await ensureParentFoldersExist(this.app, settings.inboxFile);
          await this.app.vault.create(settings.inboxFile, `${taskLine}\n`);
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

  private getKnownContexts(): string[] {
    return parseContextList(this.settings.knownContexts);
  }
}

const FRONTMATTER_BLOCK_REGEX = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Inserts a captured task as the first task line in the file: right after the
 * frontmatter block if present, otherwise at the very start of the file.
 */
function prependTaskLine(content: string, taskLine: string): string {
  const frontmatterMatch = content.match(FRONTMATTER_BLOCK_REGEX);
  if (frontmatterMatch) {
    const frontmatterBlock = frontmatterMatch[0];
    const rest = content.slice(frontmatterBlock.length);
    // Preserve any blank line(s) that already separate frontmatter from the body —
    // otherwise that separator ends up stuck between the new task and the old first
    // line instead of between the frontmatter and the new task.
    const blankLines = rest.match(/^(\r?\n)*/)?.[0] ?? "";
    const afterBlankLines = rest.slice(blankLines.length);
    return `${frontmatterBlock}${blankLines}${taskLine}\n${afterBlankLines}`;
  }

  return content.length > 0 ? `${taskLine}\n${content}` : `${taskLine}\n`;
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
