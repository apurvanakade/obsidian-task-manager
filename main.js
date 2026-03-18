const { Plugin } = require("obsidian");

module.exports = class TaskManagerPlugin extends Plugin {
  async onload() {
    console.log("Loading Task Manager plugin");
  }

  onunload() {
    console.log("Unloading Task Manager plugin");
  }
};