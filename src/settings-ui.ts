import { App, FuzzySuggestModal, PluginSettingTab, Setting, TFolder, TextComponent } from "obsidian";
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
      .setDesc("Folder scanned recursively by the Initialize command. Use Browse to pick a vault path.")
      .addText((text) => {
        this.configureFolderTextInput(text, settings.projectsFolder);
      })
      .addButton((button) => {
        button
          .setButtonText("Browse")
          .onClick(() => {
            new ProjectsFolderSuggestModal(this.baseSettingTab.app, async (folderPath) => {
              await this.plugin.updateSetting("projectsFolder", folderPath);
              this.display();
            }).open();
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

class ProjectsFolderSuggestModal extends FuzzySuggestModal<string> {
  private readonly onChoose: (folderPath: string) => Promise<void>;

  constructor(app: App, onChoose: (folderPath: string) => Promise<void>) {
    super(app);
    this.onChoose = onChoose;
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
    void this.onChoose(folderPath);
  }
}