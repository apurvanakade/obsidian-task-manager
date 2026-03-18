const { Notice, Setting, TFolder, FuzzySuggestModal } = require("obsidian");

class TaskManagerSettingTab {
  constructor(baseSettingTab, plugin) {
    this.baseSettingTab = baseSettingTab;
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this.baseSettingTab;
    const settings = this.plugin.getSettings();
    containerEl.empty();

    new Setting(containerEl)
      .setName("Projects Folder")
      .setDesc("Folder scanned recursively by the Initialize command. Use Browse to pick a vault path.")
      .addText((text) => {
        text
          .setPlaceholder("Projects")
          .setValue(settings.projectsFolder)
          .onChange(async (value) => {
            await this.plugin.updateSetting("projectsFolder", value);
          });
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
}

function openFolderPicker(app, onChoose) {
  // Guard against Obsidian API differences that can break plugin startup.
  if (typeof FuzzySuggestModal !== "function") {
    new Notice("Folder picker is not available in this Obsidian version.");
    return;
  }

  class ProjectsFolderSuggestModal extends FuzzySuggestModal {
    constructor() {
      super(app);
      this.setPlaceholder("Select a folder");
    }

    getItems() {
      const folders = this.app.vault.getAllLoadedFiles()
        .filter((file) => file instanceof TFolder)
        .map((folder) => folder.path)
        .sort((left, right) => left.localeCompare(right));

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

module.exports = {
  TaskManagerSettingTab
};