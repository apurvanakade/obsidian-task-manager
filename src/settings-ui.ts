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

    new Setting(containerEl)
      .setName("Projects Folder")
      .setDesc("Folder scanned recursively by the Process tasks command. Use Browse to pick a vault path.")
      .addText((text) => {
        this.configureFolderTextInput(text, settings.projectsFolder);
      })
      .addButton((button) => {
        button
          .setButtonText("Browse")
          .onClick(() => {
            openFolderPicker(this.baseSettingTab.app, async (folderPath) => {
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

  private configureFolderTextInput(text: TextComponent, folderPath: string): void {
    text
      .setPlaceholder("Projects")
      .setValue(folderPath)
      .onChange(async (value) => {
        await this.plugin.updateSetting("projectsFolder", value);
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