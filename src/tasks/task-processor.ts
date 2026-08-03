/**
 * Purpose:
 * - orchestrate end-to-end task processing for events and commands.
 *
 * Responsibilities:
 * - coordinates state lookup, reconciliation, status updates, and routing decisions
 * - enforces pending-write guards to prevent event feedback loops
 * - supports file-level reset, reconciliation, and routing flows
 * - persists state-store updates after writes and path moves
 *
 * Dependencies:
 * - state store, reconciler, routing modules, and Obsidian vault APIs
 *
 * Side Effects:
 * - reads/writes files, updates routing destinations, and emits notices
 */
import { App, Notice, TFile, TFolder } from "obsidian";
import { addDaysToDateString, getCurrentDateString } from "../date/date-utils";
import { readFrontmatterField } from "./frontmatter-utils";
import { applyDerivedFields, computeDerivedFields, derivedFieldsMatchContent } from "./derived-frontmatter";
import { TaskManagerSettings } from "../settings/settings-utils";
import { DEFAULT_PRIORITY, FilePriority, PRIORITY_FRONTMATTER_FIELD } from "./file-priority";
import {
  extractTaskState,
  findNewlyCompletedTask,
  findNewlyUncompletedTask,
  getFirstTaskDueDate,
  normalizeForComparison,
  resetTaskContent,
} from "./task-utils";
import {
  applyCompletionRules,
  applyUncompletionRules,
  getCompletionDateString,
  getCompletionTimeString,
  reconcileFile
} from "./reconciler";
import {
  buildDestinationPath,
  deleteEmptyParentFolders,
  ensureParentFoldersExist,
  getDestinationRootForStatus,
  getTaskFolderRoots,
  promptMergeOrSkip
} from "../routing/task-routing";
import {
  assertConfiguredDestinationForStatus,
  isRoutableStatus,
  predictFinalStatus,
  readStatusValue
} from "../routing/status-routing";
import { TaskStateStore } from "./task-state-store";

/** Stamped onto a project's frontmatter while its status is `waiting`; cleared otherwise. */
export const WAITING_SINCE_FRONTMATTER_FIELD = "waiting-since";

/**
 * Promote a scheduled file this many days ahead of its promotion date (the `[due:: ...]`
 * on its first open task — see `getFirstTaskDueDate()`), rather than exactly on it — so
 * it surfaces in the Projects folder with enough lead time to catch it before the actual
 * date, instead of risking it getting missed.
 */
const SCHEDULED_PROMOTION_LEAD_DAYS = 7;

type TaskProcessorOptions = {
  app: App;
  getSettings: () => TaskManagerSettings;
  onFileStatusChanged?: () => Promise<void>;
  onTaskPropertiesChanged?: () => Promise<void>;
};

export class TaskProcessor {
  private readonly app: App;
  private readonly getSettings: () => TaskManagerSettings;
  private readonly onFileStatusChanged?: () => Promise<void>;
  private readonly onTaskPropertiesChanged?: () => Promise<void>;
  private readonly stateStore = new TaskStateStore();

  constructor(options: TaskProcessorOptions) {
    this.app = options.app;
    this.getSettings = options.getSettings;
    this.onFileStatusChanged = options.onFileStatusChanged;
    this.onTaskPropertiesChanged = options.onTaskPropertiesChanged;
  }

  onunload(): void {
    this.stateStore.clear();
  }

  async primeState(): Promise<void> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const settings = this.getSettings();
    this.stateStore.clear();

    for (const file of markdownFiles) {
      if (!this.shouldTrackFile(file, settings)) {
        continue;
      }

      const content = await this.app.vault.read(file);
      this.updateFileSnapshot(file.path, content, settings);
    }
  }

  async handleFileCreate(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      return;
    }

    const settings = this.getSettings();
    if (!this.shouldTrackFile(file, settings)) {
      return;
    }

    const content = await this.app.vault.read(file);
    this.updateFileSnapshot(file.path, content, settings);
    await this.stampDerivedFrontmatter(file, settings);
  }

  handleFileRename(file: TFile, oldPath: string): void {
    if (file.extension !== "md") {
      return;
    }

    this.stateStore.rekey(oldPath, file.path);
  }

  handleFileDelete(file: TFile): void {
    if (file.extension !== "md") {
      return;
    }

    this.stateStore.delete(file.path);
  }

  async handleFileModify(file: TFile): Promise<void> {
    if (file.extension !== "md" || this.stateStore.isPending(file.path)) {
      return;
    }

    const settings = this.getSettings();
    if (!this.shouldTrackFile(file, settings)) {
      return;
    }

    const content = await this.app.vault.read(file);

    if (await this.maybePromoteScheduledFile(file, content, settings)) {
      // maybePromoteScheduledFile() ends with stampDerivedFrontmatter(), which always
      // re-reads the file and refreshes the state-store snapshot from that fresh read —
      // covering both the promotion's own writes and any task-line edit that happened to
      // land in the same event — so there's nothing left to snapshot here.
      return;
    }

    const nextState = extractTaskState(content);
    const nextLineCount = this.countLines(content);
    const previousState = this.stateStore.getTaskState(file.path);
    const previousLineCount = this.stateStore.getLineCount(file.path);
    const previousStatus = this.stateStore.getStatus(file.path);
    const currentStatus = readStatusValue(content, settings.statusField);

    // Line-index-based completion/uncompletion diffing is only trustworthy when the
    // document's line count hasn't changed since the last snapshot. An insertion or
    // deletion shifts every subsequent line's index, which can make an unrelated,
    // already-completed line look like it just transitioned — e.g. a completed
    // recurring task's historical entry (which keeps its [repeat:: ...] field forever)
    // can appear "newly completed" after a deletion above it, spawning another clone.
    const lineCountUnchanged = previousLineCount !== null && previousLineCount === nextLineCount;
    const completion = lineCountUnchanged ? findNewlyCompletedTask(previousState, nextState) : null;
    const uncompleted = lineCountUnchanged ? findNewlyUncompletedTask(previousState, nextState) : null;

    this.stateStore.setTaskState(file.path, nextState);
    this.stateStore.setLineCount(file.path, nextLineCount);
    this.stateStore.setStatus(file.path, currentStatus);

    if (completion !== null) {
      await this.applyCompletionRules(file, content, completion, settings);
      await this.routeAfterStatusChange(file, previousStatus, settings);
      return;
    }

    if (uncompleted !== null) {
      await this.applyUncompletionRules(file, content, uncompleted, settings);
      await this.routeAfterStatusChange(file, previousStatus, settings);
      return;
    }

    await this.reconcileSingleFile(file, settings);
    await this.routeAfterStatusChange(file, previousStatus, settings);
  }

  async resetCurrentFileTasks(): Promise<string> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      throw new Error("No active file.");
    }

    const settings = this.getSettings();
    const initialContent = await this.app.vault.read(file);
    const resetResult = resetTaskContent(initialContent);
    if (!resetResult.changed) {
      return `No tasks needed reset in ${file.name}.`;
    }

    await this.writeFileContent(file, resetResult.content, settings);

    const processResult = await this.processAndRouteFile(file);
    return `Reset ${resetResult.taskCount} task${resetResult.taskCount === 1 ? "" : "s"} in ${file.name}. ${processResult}`;
  }

  private async processAndRouteFile(file: TFile): Promise<string> {
    const settings = this.getSettings();
    const initialContent = await this.app.vault.read(file);
    const initialStatus = readStatusValue(initialContent, settings.statusField);
    const hasOpenTasks = extractTaskState(initialContent).some((task) => task.status === "open");
    const predictedStatus = predictFinalStatus(initialStatus, hasOpenTasks);

    await this.reconcileSingleFile(file, settings);

    if (this.isInboxFile(file, settings)) {
      return `Processed ${file.name}.`;
    }

    assertConfiguredDestinationForStatus(predictedStatus, settings);

    const moveResult = await this.routeFileByStatus(file, settings);
    return moveResult ?? `Processed ${file.name}.`;
  }

  private async reconcileSingleFile(file: TFile, settings: TaskManagerSettings): Promise<void> {
    await reconcileFile({
      file,
      ...this.createReconcilerServices(settings),
    });
  }

  private async routeAfterStatusChange(file: TFile, previousStatus: string | null, settings: TaskManagerSettings): Promise<void> {
    const latestContent = await this.app.vault.read(file);
    const latestStatus = readStatusValue(latestContent, settings.statusField);
    this.stateStore.setStatus(file.path, latestStatus);

    if (latestStatus === previousStatus) {
      // No status change, but a plain task-line edit (e.g. a due-date change) still
      // needs next-due/next-action/open-tasks refreshed.
      await this.stampDerivedFrontmatter(file, settings);
      return;
    }

    if (this.isInboxFile(file, settings)) {
      return;
    }

    await this.updateWaitingSinceStamp(file, latestStatus, previousStatus);

    try {
      assertConfiguredDestinationForStatus(latestStatus, settings);
      await this.routeFileByStatus(file, settings, latestStatus);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to route file after status change.");
    }

    // Stamp after routing so it lands on the file at its final (post-move) path.
    await this.stampDerivedFrontmatter(file, settings);

    try {
      await this.onFileStatusChanged?.();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to update summary files after status change.");
    }
  }

  /**
   * Stamps `waiting-since` on transition into `waiting`, clears it on transition out.
   * Powers the Projects Summary's waiting-staleness calculation.
   */
  private async updateWaitingSinceStamp(file: TFile, latestStatus: string | null, previousStatus: string | null): Promise<void> {
    const enteringWaiting = latestStatus === "waiting" && previousStatus !== "waiting";
    const leavingWaiting = latestStatus !== "waiting" && previousStatus === "waiting";
    if (!enteringWaiting && !leavingWaiting) {
      return;
    }

    await this.runWithPendingPaths([file.path], async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
        if (enteringWaiting) {
          frontmatter[WAITING_SINCE_FRONTMATTER_FIELD] = getCurrentDateString();
        } else {
          delete frontmatter[WAITING_SINCE_FRONTMATTER_FIELD];
        }
      });
    });
  }

  /**
   * (Re)stamps next-due/next-action/open-tasks — see derived-frontmatter.ts — from the
   * file's current task lines, so file-level tools (Bases, Dataview, search) can see
   * task-level data they otherwise can't reach. A no-op write (idempotency gate) when
   * nothing actually changed, but the state-store snapshot is always refreshed from a
   * fresh read regardless: this sits at the tail of every modify pass (see call sites in
   * routeAfterStatusChange / maybePromoteScheduledFile / handleFileCreate), and those
   * callers rely on it to leave TaskStateStore consistent with on-disk content — a stamp
   * changes line count, and a stale snapshot would break the line-count guard that gates
   * the completion/uncompletion special-case paths (and therefore the DueDateModal) on
   * the file's next edit. Returns whether it wrote, for backfillDerivedFrontmatter()'s count.
   */
  private async stampDerivedFrontmatter(file: TFile, settings: TaskManagerSettings): Promise<boolean> {
    if (this.isInboxFile(file, settings)) {
      return false;
    }

    const content = await this.app.vault.read(file);
    const fields = computeDerivedFields(content);
    const alreadyCurrent = derivedFieldsMatchContent(content, fields);

    if (!alreadyCurrent) {
      await this.runWithPendingPaths([file.path], async () => {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
          applyDerivedFields(frontmatter, fields);
        });
      });
    }

    const latest = await this.app.vault.read(file);
    this.snapshotTaskState(file.path, latest);

    return !alreadyCurrent;
  }

  /**
   * Resync command: (re)stamps derived fields on every tracked project file, skipping the
   * Inbox File. Unlike backfillWaitingSince, this isn't a one-time migration for files that
   * predate a feature — it's a safe-to-re-run resync for whenever frontmatter and task
   * lines have drifted (e.g. after bulk edits made outside Obsidian).
   */
  async backfillDerivedFrontmatter(): Promise<string> {
    const settings = this.getSettings();
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.shouldTrackFile(file, settings) && !this.isInboxFile(file, settings));

    let stampedCount = 0;
    for (const file of files) {
      if (await this.stampDerivedFrontmatter(file, settings)) {
        stampedCount += 1;
      }
    }

    const unchangedCount = files.length - stampedCount;
    return `Stamped derived fields on ${stampedCount} file${stampedCount === 1 ? "" : "s"} (${unchangedCount} already current).`;
  }

  /**
   * Scans the configured Scheduled folder and promotes any file whose first task's due
   * date has entered the promotion window. Called once at plugin load so tickler items
   * don't sit un-promoted indefinitely just because nobody touched the file while
   * Obsidian was closed.
   */
  async checkScheduledPromotions(): Promise<void> {
    const settings = this.getSettings();
    const folderPath = settings.scheduledProjectsFolder;
    if (!folderPath) {
      return;
    }

    const files = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${folderPath}/`));
    for (const file of files) {
      const content = await this.app.vault.read(file);
      await this.maybePromoteScheduledFile(file, content, settings);
    }
  }

  /**
   * Promotes a `scheduled` file to `todo` (and routes it accordingly) once its first
   * open task's `[due:: ...]` date is within the promotion lead window. The due date
   * itself is left untouched — once promoted, it's just an ordinary task due date the
   * dashboard picks up normally. Returns true if it promoted the file, so callers
   * mid-modify-event can skip the rest of normal reconciliation for this pass — the
   * promotion's own frontmatter write fires a fresh `modify` event that gets processed
   * normally once the pending-path guard clears.
   */
  private async maybePromoteScheduledFile(file: TFile, content: string, settings: TaskManagerSettings): Promise<boolean> {
    if (this.isInboxFile(file, settings)) {
      return false;
    }

    const status = readStatusValue(content, settings.statusField);
    if (status !== "scheduled") {
      return false;
    }

    const scheduledDate = getFirstTaskDueDate(content);
    if (!scheduledDate) {
      return false;
    }

    const promotionThreshold = addDaysToDateString(scheduledDate, -SCHEDULED_PROMOTION_LEAD_DAYS);
    if (!promotionThreshold || promotionThreshold > getCurrentDateString()) {
      return false;
    }

    await this.setFileStatus(file, "todo", settings);

    try {
      assertConfiguredDestinationForStatus("todo", settings);
      await this.routeFileByStatus(file, settings, "todo");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to route promoted scheduled file.");
    }

    await this.stampDerivedFrontmatter(file, settings);

    try {
      await this.onFileStatusChanged?.();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to update summary files after promotion.");
    }

    return true;
  }

  /**
   * One-time backfill for files already in the Waiting folder before this feature
   * shipped: stamps today's date on any waiting file missing `waiting-since`, so it
   * isn't stuck without staleness data until its next status change.
   */
  async backfillWaitingSince(): Promise<string> {
    const settings = this.getSettings();
    const folderPath = settings.waitingProjectsFolder;
    if (!folderPath) {
      throw new Error("Set Waiting Projects Folder in plugin settings first.");
    }

    const files = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${folderPath}/`));
    let stampedCount = 0;

    for (const file of files) {
      const content = await this.app.vault.read(file);
      if (readFrontmatterField(content, WAITING_SINCE_FRONTMATTER_FIELD) !== null) {
        continue;
      }

      await this.runWithPendingPaths([file.path], async () => {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
          frontmatter[WAITING_SINCE_FRONTMATTER_FIELD] = getCurrentDateString();
        });
      });
      stampedCount += 1;
    }

    return `Stamped waiting-since on ${stampedCount} file${stampedCount === 1 ? "" : "s"}.`;
  }

  private async routeFileByStatus(file: TFile, settings: TaskManagerSettings, statusOverride?: string | null): Promise<string | null> {
    if (this.isInboxFile(file, settings)) {
      return null;
    }

    const status = statusOverride ?? readStatusValue(await this.app.vault.read(file), settings.statusField);
    if (!status || !isRoutableStatus(status)) {
      return null;
    }

    const destinationRoot = getDestinationRootForStatus(settings, status);
    if (!destinationRoot) {
      throw new Error(`Set destination folder for status '${status}' in Task Manager settings.`);
    }

    const destinationPath = buildDestinationPath(file, destinationRoot, getTaskFolderRoots(settings));
    if (destinationPath === file.path) {
      return null;
    }

    await ensureParentFoldersExist(this.app, destinationPath);
    const destinationEntry = this.app.vault.getAbstractFileByPath(destinationPath);

    if (destinationEntry instanceof TFolder) {
      throw new Error(`Cannot move '${file.path}' because '${destinationPath}' is a folder.`);
    }

    if (destinationEntry instanceof TFile) {
      const shouldMerge = await promptMergeOrSkip(this.app, file.path, destinationPath);

      if (!shouldMerge) {
        return `Skipped ${file.name} (destination exists).`;
      }

      await this.mergeIntoExistingFile(file, destinationEntry, settings);
      return `Merged ${file.name} into ${destinationPath}.`;
    }

    const sourcePath = file.path;
    await this.app.fileManager.renameFile(file, destinationPath);
    this.stateStore.rekey(sourcePath, destinationPath);
    await deleteEmptyParentFolders(this.app, getTaskFolderRoots(settings), sourcePath);
    return `Moved ${file.name} to ${destinationRoot}.`;
  }

  private async mergeIntoExistingFile(sourceFile: TFile, destinationFile: TFile, settings: TaskManagerSettings): Promise<void> {
    const sourcePath = sourceFile.path;
    const destinationContent = await this.app.vault.read(destinationFile);
    const sourceContent = await this.app.vault.read(sourceFile);
    const mergedContent = normalizeForComparison(destinationContent).includes(normalizeForComparison(sourceContent))
      ? destinationContent
      : `${destinationContent.trimEnd()}\n\n---\n\n${sourceContent}`;

    await this.runWithPendingPaths([destinationFile.path, sourceFile.path], async () => {
      await this.app.vault.modify(destinationFile, mergedContent);
      await this.app.vault.delete(sourceFile);
      this.stateStore.delete(sourceFile.path);
      this.updateFileSnapshot(destinationFile.path, mergedContent, settings);
      await deleteEmptyParentFolders(this.app, getTaskFolderRoots(settings), sourcePath);
    });
  }

  private async applyCompletionRules(
    file: TFile,
    content: string,
    completedLine: number,
    settings: TaskManagerSettings,
  ): Promise<void> {
    await applyCompletionRules({
      file,
      content,
      completedLine,
      ...this.createReconcilerServices(settings),
    });
  }

  private async applyUncompletionRules(file: TFile, content: string, uncompletedLine: number, settings: TaskManagerSettings): Promise<void> {
    await applyUncompletionRules({
      file,
      content,
      uncompletedLine,
      ...this.createReconcilerServices(settings),
    });
  }

  private createReconcilerServices(settings: TaskManagerSettings) {
    return {
      settings,
      app: this.app,
      readFile: (target: TFile) => this.app.vault.read(target),
      writeFileContent: (target: TFile, nextContent: string) => this.writeFileContent(target, nextContent, settings),
      setFileStatus: (target: TFile, status: string) => this.setFileStatus(target, status, settings),
      setFilePriority: (target: TFile, priority: FilePriority) => this.setFilePriority(target, priority),
      setTaskState: (filePath: string, content: string) => {
        this.snapshotTaskState(filePath, content);
      },
      onTaskPropertiesChanged: async () => {
        await this.onTaskPropertiesChanged?.();
      },
    };
  }

  /** Always update task-state and line-count together — never one without the other. */
  private snapshotTaskState(filePath: string, content: string): void {
    this.stateStore.setTaskState(filePath, extractTaskState(content));
    this.stateStore.setLineCount(filePath, this.countLines(content));
  }

  private countLines(content: string): number {
    return content.split(/\r?\n/).length;
  }

  private updateFileSnapshot(filePath: string, content: string, settings: TaskManagerSettings): void {
    this.snapshotTaskState(filePath, content);
    this.stateStore.setStatus(filePath, readStatusValue(content, settings.statusField));
  }

  private shouldTrackFile(file: TFile, settings: TaskManagerSettings): boolean {
    if (this.isInboxFile(file, settings)) {
      return true;
    }

    const taskFolderRoots = getTaskFolderRoots(settings);
    return taskFolderRoots.some((root) => file.path.startsWith(`${root}/`));
  }

  private isInboxFile(file: TFile, settings: TaskManagerSettings): boolean {
    return !!settings.inboxFile && file.path === settings.inboxFile;
  }

  private async runWithPendingPaths(filePaths: string[], action: () => Promise<void>): Promise<void> {
    filePaths.forEach((filePath) => this.stateStore.markPending(filePath));

    try {
      await action();
    } finally {
      window.setTimeout(() => {
        filePaths.forEach((filePath) => this.stateStore.unmarkPending(filePath));
      }, 0);
    }
  }

  private async writeFileContent(file: TFile, content: string, settings: TaskManagerSettings): Promise<void> {
    await this.runWithPendingPaths([file.path], async () => {
      await this.app.vault.modify(file, content);
      this.updateFileSnapshot(file.path, content, settings);
    });
  }

  private async setFileStatus(file: TFile, status: string, settings: TaskManagerSettings): Promise<void> {
    await this.runWithPendingPaths([file.path], async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string | number>) => {
        frontmatter[settings.statusField] = status;
        this.ensureDefaultPriority(frontmatter);
        if (status === "completed") {
          frontmatter["completion-date"] = getCompletionDateString();
          frontmatter["completion-time"] = getCompletionTimeString();
        } else {
          delete frontmatter["completion-date"];
          delete frontmatter["completion-time"];
        }
      });
      this.stateStore.setStatus(file.path, status);
    });
  }

  private ensureDefaultPriority(frontmatter: Record<string, string | number>): void {
    const existingPriority = frontmatter[PRIORITY_FRONTMATTER_FIELD];
    if (existingPriority === undefined || existingPriority === null || String(existingPriority).trim() === "") {
      frontmatter[PRIORITY_FRONTMATTER_FIELD] = DEFAULT_PRIORITY;
    }
  }

  private async setFilePriority(file: TFile, priority: FilePriority): Promise<void> {
    await this.runWithPendingPaths([file.path], async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string | number>) => {
        frontmatter[PRIORITY_FRONTMATTER_FIELD] = priority;
      });
    });
  }
}
