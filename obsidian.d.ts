declare module "obsidian" {
  export interface ObsidianHTMLElement extends HTMLElement {
    empty(): void;
  }

  export class TAbstractFile {
    path: string;
  }

  export class TFile extends TAbstractFile {
    extension: string;
    name: string;
  }

  export class TFolder extends TAbstractFile {}

  export interface EventRef {}

  export interface Vault {
    getMarkdownFiles(): TFile[];
    getAllLoadedFiles(): TAbstractFile[];
    cachedRead(file: TFile): Promise<string>;
    modify(file: TFile, content: string): Promise<void>;
    on(name: "modify", callback: (file: TFile) => void | Promise<void>): EventRef;
  }

  export interface FileManager {
    processFrontMatter(file: TFile, fn: (frontmatter: Record<string, string>) => void): Promise<void>;
  }

  export interface Workspace {
    getActiveFile(): TFile | null;
  }

  export interface App {
    vault: Vault;
    fileManager: FileManager;
    workspace: Workspace;
  }

  export class Plugin {
    app: App;
    constructor(app: App, manifest: unknown);
    addCommand(command: { id: string; name: string; callback: () => void }): void;
    addSettingTab(settingTab: PluginSettingTab): void;
    registerEvent(eventRef: EventRef): void;
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
  }

  export class PluginSettingTab {
    app: App;
    containerEl: ObsidianHTMLElement;
    constructor(app: App, plugin: Plugin);
    display(): void;
  }

  export interface TextComponent {
    setPlaceholder(value: string): this;
    setValue(value: string): this;
    onChange(callback: (value: string) => void | Promise<void>): this;
  }

  export interface ButtonComponent {
    setButtonText(value: string): this;
    onClick(callback: () => void): this;
  }

  export class Setting {
    constructor(containerEl: HTMLElement);
    setName(name: string): this;
    setDesc(description: string): this;
    addText(callback: (component: TextComponent) => void): this;
    addButton(callback: (component: ButtonComponent) => void): this;
  }

  export class Notice {
    constructor(message: string);
  }

  export class FuzzySuggestModal<T> {
    app: App;
    constructor(app: App);
    open(): void;
    setPlaceholder(value: string): void;
    getItems(): T[];
    getItemText(item: T): string;
    onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;
  }
}