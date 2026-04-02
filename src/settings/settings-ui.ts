/**
 * Purpose:
 * - render and bind the plugin settings tab UI.
 *
 * Responsibilities:
 * - renders folder and text setting controls from declarative definitions
 * - binds UI events to plugin updateSetting persistence hooks
 * - delegates folder and file browsing to the folder-picker helper
 *
 * Dependencies:
 * - depends on settings definitions/utilities and picker helper
 * - Obsidian Setting/TextComponent APIs
 *
 * Side Effects:
 * - mutates settings container DOM and persists setting values
 *
 * Notes:
 * - Uses file picker for Inbox File, folder picker for other folder settings.
 */
import { PluginSettingTab, Setting, TextComponent, TextAreaComponent } from "obsidian";
import { openFolderPicker, openFilePicker } from "./folder-picker";
import { getFolderSettingConfigs, getTextSettingConfigs, FolderSettingConfig, TextSettingConfig } from "./settings-field-definitions";
import { FolderSettingKey, TaskManagerSettings } from "./settings-utils";

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

    for (const folderSetting of getFolderSettingConfigs(settings)) {
      this.addFolderSetting(containerEl, folderSetting);
    }

    for (const textSetting of getTextSettingConfigs(settings)) {
      this.addTextSetting(containerEl, textSetting);
    }
  }

  private addFolderSetting(containerEl: HTMLElement, config: FolderSettingConfig): void {
    const isInboxFile = config.key === "inboxFile";
    new Setting(containerEl)
      .setName(config.name)
      .setDesc(`${config.description} Use Browse to pick a vault ${isInboxFile ? "file" : "path"}.`)
      .addText((text) => {
        this.configureFolderTextInput(text, config.key, config.value, config.placeholder);
      })
      .addButton((button) => {
        button
          .setButtonText("Browse")
          .onClick(() => {
            if (isInboxFile) {
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

  private addTextSetting(containerEl: HTMLElement, config: TextSettingConfig): void {
    const setting = new Setting(containerEl)
      .setName(config.name)
      .setDesc(config.description);

    if (config.multiLine) {
      setting.addTextArea((textArea: TextAreaComponent) => {
        textArea
          .setPlaceholder(config.placeholder)
          .setValue(config.value)
          .onChange(async (value) => {
            await this.plugin.updateSetting(config.key, value);
          });
      });
    } else {
      setting.addText((text) => {
        text
          .setPlaceholder(config.placeholder)
          .setValue(config.value)
          .onChange(async (value) => {
            await this.plugin.updateSetting(config.key, value);
          });
      });
    }
  }

  private configureFolderTextInput(
    text: TextComponent,
    settingKey: FolderSettingKey,
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