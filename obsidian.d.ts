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

  export class WorkspaceLeaf {
    view: unknown;
    setViewState(viewState: { type: string; active?: boolean }): Promise<void>;
  }

  export interface EventRef {}

  export interface Vault {
    getMarkdownFiles(): TFile[];
    getAllLoadedFiles(): TAbstractFile[];
    getAbstractFileByPath(path: string): TAbstractFile | null;
    cachedRead(file: TFile): Promise<string>;
    modify(file: TFile, content: string): Promise<void>;
    createFolder(path: string): Promise<TFolder>;
    delete(file: TAbstractFile, force?: boolean): Promise<void>;
    on(name: "modify", callback: (file: TFile) => void | Promise<void>): EventRef;
    on(name: "rename", callback: (file: TAbstractFile, oldPath: string) => void | Promise<void>): EventRef;
    on(name: "delete", callback: (file: TAbstractFile) => void | Promise<void>): EventRef;
  }

  export interface FileManager {
    processFrontMatter(file: TFile, fn: (frontmatter: Record<string, string>) => void): Promise<void>;
    renameFile(file: TAbstractFile, newPath: string): Promise<void>;
  }

  export interface Workspace {
    getActiveFile(): TFile | null;
    openLinkText(linktext: string, sourcePath: string, newLeaf?: boolean): Promise<void>;
    on(name: "file-open", callback: (file: TFile | null) => void | Promise<void>): EventRef;
    on(name: "layout-change", callback: () => void | Promise<void>): EventRef;
    getLeavesOfType(viewType: string): WorkspaceLeaf[];
    ensureSideLeaf(type: string, side: string, options?: { active?: boolean; split?: boolean; reveal?: boolean; state?: unknown }): Promise<WorkspaceLeaf>;
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
    registerView(type: string, viewCreator: (leaf: WorkspaceLeaf) => unknown): void;
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
  }

  export class ItemView {
    contentEl: ObsidianHTMLElement;
    constructor(leaf: WorkspaceLeaf);
    getViewType(): string;
    getDisplayText(): string;
    onOpen(): Promise<void> | void;
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

  export class Modal {
    app: App;
    contentEl: ObsidianHTMLElement;
    constructor(app: App);
    open(): void;
    close(): void;
    onOpen(): void;
    onClose(): void;
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