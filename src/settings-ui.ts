import { App, FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFolder, TextComponent } from "obsidian";
import { TaskManagerSettings } from "./settings-utils";

type SettingsHost = {
  getSettings(): TaskManagerSettings;
  updateSetting<K extends keyof TaskManagerSettings>(key: K, value: TaskManagerSettings[K]): Promise<void>;
};

export class TaskManagerSettingTabRenderer {
  private readonly baseSettingTab: PluginSettingTab;

  private readonly plugin: SettingsHost;

  constructor(baseSettingTab: PluginSettingTab, plugin: SettingsHost) {
    this.baseSettingTab = baseSettingTab;
    this.plugin = plugin;
  }

  display(): void {
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

    new Setting(containerEl)
      .setName("Next Action Tag")
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
      .setName("Completed Status Field")
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

  private addFolderSetting(
    containerEl: HTMLElement,
    name: string,
    description: string,
    settingKey: "projectsFolder" | "completedProjectsFolder" | "waitingProjectsFolder" | "scheduledProjectsFolder" | "somedayMaybeProjectsFolder",
    folderPath: string,
    placeholder: string
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(`${description} Use Browse to pick a vault path.`)
      .addText((text) => {
        this.configureFolderTextInput(text, settingKey, folderPath, placeholder);
      })
      .addButton((button) => {
        button
          .setButtonText("Browse")
          .onClick(() => {
            openFolderPicker(this.baseSettingTab.app, async (selectedFolderPath) => {
              await this.plugin.updateSetting(settingKey, selectedFolderPath);
              this.display();
            });
          });
      });
  }

  private configureFolderTextInput(
    text: TextComponent,
    settingKey: "projectsFolder" | "completedProjectsFolder" | "waitingProjectsFolder" | "scheduledProjectsFolder" | "somedayMaybeProjectsFolder",
    folderPath: string,
    placeholder: string
  ): void {
    text
      .setPlaceholder(placeholder)
      .setValue(folderPath)
      .onChange(async (value) => {
        await this.plugin.updateSetting(settingKey, value);
      });
  }
}

function openFolderPicker(app: App, onChoose: (folderPath: string) => Promise<void>): void {
  // Guard against Obsidian API differences that can break plugin startup.
  if (typeof FuzzySuggestModal !== "function") {
    new Notice("Folder picker is not available in this Obsidian version.");
    return;
  }

  class ProjectsFolderSuggestModal extends FuzzySuggestModal<string> {
    constructor() {
      super(app);
      this.setPlaceholder("Select a folder");
    }

    getItems(): string[] {
      const folders = this.app.vault.getAllLoadedFiles()
        .filter((file): file is TFolder => file instanceof TFolder)
        .map((folder) => folder.path)
        .sort((left, right) => left.localeCompare(right));

      return ["", ...folders];
    }

    getItemText(folderPath: string): string {
      return folderPath || "/";
    }

    onChooseItem(folderPath: string): void {
      void onChoose(folderPath);
    }
  }

  new ProjectsFolderSuggestModal().open();
}