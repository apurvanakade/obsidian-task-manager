import { TaskState } from "./task-utils";

export class TaskStateStore {
  private readonly taskStateByPath = new Map<string, TaskState[]>();
  private readonly statusByPath = new Map<string, string | null>();
  private readonly pendingPaths = new Set<string>();

  clear(): void {
    this.taskStateByPath.clear();
    this.statusByPath.clear();
    this.pendingPaths.clear();
  }

  getTaskState(filePath: string): TaskState[] {
    return this.taskStateByPath.get(filePath) ?? [];
  }

  setTaskState(filePath: string, taskState: TaskState[]): void {
    this.taskStateByPath.set(filePath, taskState);
  }

  getStatus(filePath: string): string | null {
    return this.statusByPath.get(filePath) ?? null;
  }

  setStatus(filePath: string, status: string | null): void {
    this.statusByPath.set(filePath, status);
  }

  delete(filePath: string): void {
    this.taskStateByPath.delete(filePath);
    this.statusByPath.delete(filePath);
    this.pendingPaths.delete(filePath);
  }

  rekey(oldPath: string, newPath: string): void {
    const existingTaskState = this.taskStateByPath.get(oldPath);
    this.taskStateByPath.delete(oldPath);
    if (existingTaskState) {
      this.taskStateByPath.set(newPath, existingTaskState);
    }

    const existingStatus = this.statusByPath.get(oldPath) ?? null;
    this.statusByPath.delete(oldPath);
    this.statusByPath.set(newPath, existingStatus);

    const wasPending = this.pendingPaths.delete(oldPath);
    if (wasPending) {
      this.pendingPaths.add(newPath);
    }
  }

  isPending(filePath: string): boolean {
    return this.pendingPaths.has(filePath);
  }

  markPending(filePath: string): void {
    this.pendingPaths.add(filePath);
  }

  unmarkPending(filePath: string): void {
    this.pendingPaths.delete(filePath);
  }
}