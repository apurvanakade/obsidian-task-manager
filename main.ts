import { Plugin } from "obsidian";

export default class TaskManagerPlugin extends Plugin {
  async onload(): Promise<void> {
    console.log("Loading Task Manager plugin");
  }

  onunload(): void {
    console.log("Unloading Task Manager plugin");
  }
}