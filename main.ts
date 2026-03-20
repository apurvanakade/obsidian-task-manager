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
import { DateDashboardController } from "./src/dashboard/date-dashboard";
import { CreatedDateEditorSuggest, DueDateEditorSuggest } from "./src/editor/due-date-suggest";
import { normalizeSettings, TaskManagerSettings } from "./src/settings/settings-utils";
import { TaskManagerSettingTabRenderer } from "./src/settings/settings-ui";
import { getTaskFolderRoots } from "./src/routing/task-routing";
import { TaskProcessor } from "./src/tasks/task-processor";

export default class TaskManagerPlugin extends Plugin {
  private taskProcessor: TaskProcessor | null = null;
  private dateDashboard: DateDashboardController | null = null;
  private dueDateSuggest: DueDateEditorSuggest | null = null;
  private createdDateSuggest: CreatedDateEditorSuggest | null = null;

  private settings: TaskManagerSettings = normalizeSettings({});

  async onload(): Promise<void> {
    await this.loadSettings();
    console.log("Loading Task Manager plugin");
    this.taskProcessor = new TaskProcessor({
      app: this.app,
      getSettings: () => this.getSettings(),
    });
    this.dateDashboard = new DateDashboardController({
      app: this.app,
      getTaskFolderRoots: () => this.getTaskFolderRoots(),
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
    });
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }

      void this.taskProcessor?.handleFileModify(file);
    }));
    await this.taskProcessor.primeState();
    await this.dateDashboard.onload(this);
  }

  onunload(): void {
    this.taskProcessor?.onunload();
    this.taskProcessor = null;
    this.dateDashboard?.onunload();
    this.dateDashboard = null;
    this.dueDateSuggest = null;
    this.createdDateSuggest = null;
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

  private async runProcessCurrentFile(): Promise<void> {
    try {
      const result = await this.taskProcessor!.processCurrentFile();
      new Notice(result);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to Process File.");
    }
  }

  private async runProcessTasks(): Promise<void> {
    try {
      const result = await this.taskProcessor!.processTasks();
      new Notice(result);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to process tasks.");
    }
  }

  private async runResetCurrentFileTasks(): Promise<void> {
    try {
      const result = await this.taskProcessor!.resetCurrentFileTasks();
      new Notice(result);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to reset tasks.");
    }
  }

  private getTaskFolderRoots(): string[] {
    return getTaskFolderRoots(this.settings);
  }
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